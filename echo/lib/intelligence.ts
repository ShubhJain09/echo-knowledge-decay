import type { Answer, Card, Comparison, Relation } from './types';
import { compareKnowledge } from './ai/provider';
import { validateCitations } from './intelligence/citation';
/** Function words dropped before token comparison, so wording differences do not read as content differences. */
const stop = new Set(
  'the a an is are to of for and in it on after every now should how we with do use using what i our'.split(' '),
);
function tokens(text: string) {
  return new Set(
    text
      .toLowerCase()
      .match(/[a-z0-9]+/g)
      ?.filter(w => w.length > 1 && !stop.has(w)) || [],
  );
}
export function relevantCards(question: string, cards: Card[]): Card[] {
  const q = tokens(question);
  return cards
    .filter(c => c.status === 'verified')
    .map(card => {
      const text = tokens(`${card.title} ${card.statement} ${card.topic}`);
      return { card, score: [...q].filter(t => text.has(t)).length };
    })
    .filter(r => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map(r => r.card);
}
const numbers = (text: string) => new Set(text.match(/\d+(?:[.,]\d+)?/g) || []);
const sameSet = (a: Set<string>, b: Set<string>) => a.size === b.size && [...a].every(t => b.has(t));
const subsetOf = (a: Set<string>, b: Set<string>) => [...a].every(t => b.has(t));
const withoutNumbers = (a: Set<string>) => new Set([...a].filter(t => !/^\d/.test(t)));
/** Whole-word matcher. Substring matching previously made "platform" and "information" match the "form" rule. */
const words = (...list: string[]) => new RegExp(`\\b(?:${list.join('|')})\\b`, 'i');
/** Sentence spans carry offsets so every extracted quote stays an exact substring of the source. */
function sentences(text: string) {
  const spans: { start: number; end: number }[] = [];
  for (const match of text.matchAll(/[^.!?\n]*[^\s.!?\n][^.!?\n]*(?:[.!?]+|\n|$)/g))
    if (match[0].trim()) spans.push({ start: match.index, end: match.index + match[0].length });
  return spans.length ? spans : [{ start: 0, end: text.length }];
}
/** The run of up to three consecutive sentences that best matches the card, returned as an exact substring. */
export function bestPassage(card: Pick<Card, 'title' | 'statement'>, evidence: string, limit = 1200) {
  const target = tokens(`${card.title} ${card.statement}`);
  const spans = sentences(evidence);
  let best = { start: 0, end: Math.min(evidence.length, limit), score: -1 };
  for (let i = 0; i < spans.length; i++) {
    for (let n = 1; n <= 3 && i + n <= spans.length; n++) {
      const start = spans[i].start,
        end = spans[i + n - 1].end;
      if (end - start > limit) continue;
      // Prefer the tightest passage that still covers the overlap.
      const score = [...tokens(evidence.slice(start, end))].filter(t => target.has(t)).length - n * 0.1;
      if (score > best.score) best = { start, end, score };
    }
  }
  return evidence.slice(best.start, best.end).trim() || evidence.slice(0, limit).trim();
}
/**
 * Transparent lexical rules for offline rehearsal. These compare wording, not meaning, and are
 * deliberately conservative: an unmatched difference becomes adds_context, never a silent pass.
 */
const antonyms: readonly (readonly [string, string])[] = [
  ['enabled', 'disabled'],
  ['enable', 'disable'],
  ['allowed', 'forbidden'],
  ['allowed', 'blocked'],
  ['required', 'optional'],
  ['supported', 'unsupported'],
  ['available', 'unavailable'],
  ['active', 'inactive'],
  ['approved', 'rejected'],
  ['valid', 'invalid'],
  ['secure', 'insecure'],
  ['granted', 'revoked'],
  ['included', 'excluded'],
  ['succeeds', 'fails'],
  ['increased', 'decreased'],
  ['open', 'closed'],
];
const negated = words('no longer', 'never', 'cannot', 'discontinued', 'ceased', 'reverted');
const temporal = words(
  'cancelled',
  'canceled',
  'postponed',
  'rescheduled',
  'delayed',
  'extended',
  'expired',
  'expires',
  'lapsed',
  'suspended',
  'until further notice',
  'effective immediately',
);
export function demoCompare(card: Card, evidence: string): Comparison {
  const old = card.statement,
    next = evidence;
  const oldTokens = tokens(old),
    nextTokens = tokens(next);
  const cardTokens = tokens(`${card.title} ${card.statement} ${card.topic}`);
  const passage = bestPassage(card, evidence);
  const out = (relation: Relation, explanation: string): Comparison => {
    const needsReview = !['unrelated', 'consistent'].includes(relation);
    // A short document is its own proposal; a long one contributes only the matching passage.
    return {
      relation,
      needsReview,
      explanation,
      oldQuote: card.statement,
      newQuote: passage,
      engine: 'demo',
      proposedStatement: needsReview ? (evidence.length <= 2000 ? evidence : passage) : '',
    };
  };
  if (![...nextTokens].some(t => cardTokens.has(t)))
    return out(
      'unrelated',
      'The demo rules found no shared terms between this evidence and the selected knowledge. Enable a live model for semantic comparison.',
    );
  if (next.toLowerCase().includes(old.toLowerCase()) || sameSet(oldTokens, nextTokens))
    return out(
      'consistent',
      'The evidence carries the same significant terms as the current statement, so the demo rules treat it as a rewording rather than a change. This compares wording, not truth.',
    );
  if (words('manual', 'manually').test(old) && words('automatic', 'automatically', 'automates', 'automated').test(next))
    return out(
      'process_change',
      'The verified procedure requires a manual step, while the new evidence describes automation. A reviewer should confirm whether the manual step is still needed.',
    );
  if (words('email', 'emails', 'form', 'forms').test(old) && words('portal').test(next))
    return out(
      'process_change',
      'The evidence describes a portal-based workflow, while the current procedure uses a form or email. Verify the new submission route.',
    );
  if (
    /\bv\d+\b/i.test(old) &&
    (words('deprecated', 'deprecation', 'sunset', 'end of life').test(next) ||
      [...next.matchAll(/\bv(\d+)\b/gi)].some(m => !new RegExp(`\\bv${m[1]}\\b`, 'i').test(old)))
  )
    return out(
      'dependency_change',
      'The current knowledge pins a version that the evidence describes as changed or deprecated. Verify the supported version before updating.',
    );
  if (
    words('server', 'servers', 'host', 'hosted', 'database', 'instance', 'datacenter', 'cluster').test(old) &&
    words('migrated', 'migration', 'migrating', 'managed', 'moved', 'relocated', 'serverless').test(next)
  )
    return out(
      'environment_change',
      'The evidence describes a migration or hosting change that may make the recorded location outdated.',
    );
  if (temporal.test(next))
    return out(
      'time_sensitive',
      'The evidence changes a date, schedule or validity window on this knowledge. Confirm the new timing before renewing it.',
    );
  const flipped = antonyms.find(
    ([a, b]) => (words(a).test(old) && words(b).test(next)) || (words(b).test(old) && words(a).test(next)),
  );
  if (flipped)
    return out(
      'contradiction',
      `The evidence reverses a stated condition ("${flipped[0]}" versus "${flipped[1]}"). A reviewer should confirm which state is correct.`,
    );
  const oldNumbers = numbers(old),
    nextNumbers = numbers(next);
  if (oldNumbers.size && !sameSet(oldNumbers, nextNumbers) && sameSet(withoutNumbers(oldTokens), withoutNumbers(nextTokens)))
    return out(
      'contradiction',
      `The wording matches the current knowledge but a figure differs (${[...oldNumbers].join(', ')} versus ${[...nextNumbers].join(', ') || 'no figure'}). Confirm which value is correct.`,
    );
  if (negated.test(next) && !negated.test(old))
    return out(
      'contradiction',
      'The evidence negates part of the current knowledge. A reviewer should confirm whether the recorded procedure still applies.',
    );
  if (subsetOf(oldTokens, nextTokens))
    return out(
      'adds_context',
      'The evidence repeats the current knowledge and adds further detail. No conflicting claim was found by the demo rules.',
    );
  return out(
    'adds_context',
    'The evidence shares terms with this card but the demo rules cannot establish a semantic conflict. Enable a live model (ECHO_AI=groq) or review the passage manually.',
  );
}
export async function compare(card: Card, evidence: string): Promise<Comparison> {
  if (process.env.ECHO_AI === 'demo') return demoCompare(card, evidence);
  const provider = process.env.ECHO_AI === 'bedrock' ? 'bedrock' : 'groq';
  const result = await compareKnowledge({
    knowledge: card,
    evidence: { text: evidence, sourceName: 'Uploaded evidence' },
    provider,
  });
  return { ...result, proposedStatement: result.proposedStatement || '', engine: provider };
}
export async function ask(question: string, cards: Card[]): Promise<Answer> {
  const current = relevantCards(question, cards).filter(
    c => (!c.validFrom || Date.parse(c.validFrom) <= Date.now()) && (!c.validUntil || Date.parse(c.validUntil) > Date.now()),
  );
  if (!current.length)
    return {
      text: 'There is insufficient current verified knowledge to answer this question.',
      engine: 'extractive',
      citations: [],
    };
  // Extractive answers deliberately avoid model paraphrases and unsupported factual claims.
  const text = current.map((c, i) => `${c.statement.replace(/\r?\n+/g, ' ')} [${i + 1}]`).join('\n\n');
  validateCitations(
    text,
    current.map(c => ({ cardId: c.id, version: c.version, status: c.status })),
    current.map(c => c.id),
  );
  return {
    text,
    engine: 'extractive',
    citations: current.map(c => ({
      cardId: c.id,
      title: c.title,
      version: c.version,
      source: c.source,
      verifiedAt: c.lastVerifiedAt || c.updatedAt,
    })),
  };
}

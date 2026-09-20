import type { Answer, Card, Comparison, Relation } from './types';
import { compareKnowledge } from './ai/provider';
import { validateCitations } from './intelligence/citation';
const stop = new Set([
  'the',
  'a',
  'an',
  'is',
  'are',
  'to',
  'of',
  'for',
  'and',
  'in',
  'it',
  'on',
  'after',
  'every',
  'now',
  'should',
  'how',
  'we',
  'with',
  'do',
  'use',
  'using',
  'what',
  'i',
  'our',
]);
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
export function demoCompare(card: Card, evidence: string): Comparison {
  const old = card.statement.toLowerCase();
  const next = evidence.toLowerCase();
  const relevant = relevantCards(evidence, [card]).length > 0;
  let relation: Relation = 'unrelated';
  let explanation =
    'The local demo could not link this evidence to the selected knowledge. Bedrock mode supports semantic comparison.';
  if (relevant) {
    if (next.includes(old)) {
      relation = 'consistent';
      explanation =
        'The evidence contains the existing statement. This limited local check found no change; it cannot establish whether the statement is true.';
    } else if (/manual/.test(old) && /automatic|automates|automatically/.test(next)) {
      relation = 'process_change';
      explanation =
        'The verified procedure requires a manual step, while the new evidence describes automation. A reviewer should confirm whether the manual step is still needed.';
    } else if (/v1/.test(old) && /v2|deprecat/.test(next)) {
      relation = 'dependency_change';
      explanation =
        'The current knowledge relies on API v1, while the evidence describes a version change or deprecation. Verify the supported version before updating.';
    } else if (/server a/.test(old) && /managed|migrat/.test(next)) {
      relation = 'environment_change';
      explanation = 'The evidence describes a database migration that may make the recorded hosting location outdated.';
    } else if (/email|form/.test(old) && /portal/.test(next)) {
      relation = 'process_change';
      explanation =
        'The evidence describes a portal-based workflow, while the current procedure uses a form or email. Verify the new submission route.';
    } else {
      relation = 'adds_context';
      explanation =
        'The evidence shares terms with this card but differs from its statement. The local demo cannot establish a semantic conflict; review the evidence or enable Bedrock.';
    }
  }
  return {
    relation,
    needsReview: !['unrelated', 'consistent'].includes(relation),
    explanation,
    oldQuote: card.statement,
    newQuote: evidence.slice(0, 8000),
    proposedStatement: evidence.slice(0, 8000),
    engine: 'demo',
  };
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

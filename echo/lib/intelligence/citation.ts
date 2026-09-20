import { AppError } from '../errors';
export type CitationSource = { cardId: string; version: number; status: 'verified' | 'archived' };
/** Strict [1] or [1, 2] grammar. Source indexes refer to the unchanged retrieval list. */
export function validateCitations(text: string, sources: CitationSource[], citedIds: string[]): number[] {
  const fail = () => { throw new AppError(502, 'The answer returned invalid source references. Try again.'); };
  if (!text.trim() || text.length > 10000 || /[<>]|\]\(|```/.test(text)) return fail();
  const references: number[] = [];
  for (const match of text.matchAll(/\[([^\[\]]*)\]/g)) {
    if (!/^[1-9]\d*(?:, ?[1-9]\d*)*$/.test(match[1])) return fail();
    for (const n of match[1].split(',').map(Number)) {
      if (!Number.isSafeInteger(n) || !sources[n - 1] || sources[n - 1].status !== 'verified') return fail();
      references.push(n);
    }
  }
  if (!references.length || /[\[\]]/.test(text.replace(/\[[^\[\]]*\]/g, ''))) return fail();
  const ids = new Set(references.map(n => sources[n - 1].cardId));
  if (ids.size !== new Set(citedIds).size || citedIds.some(id => !ids.has(id))) return fail();
  // Every nonempty claim paragraph must end in source references. This validates structure, not semantic truth.
  if (text.split(/\n+/).filter(p => p.trim()).some(p => !/\[[1-9]\d*(?:, ?[1-9]\d*)*\][.!?]?\s*$/.test(p))) return fail();
  return [...new Set(references)];
}

import { z } from 'zod';
import { AppError } from '../errors';
import { groq } from './groq';
import { bedrock } from './bedrock';
import { comparisonPrompt } from './prompts/compare';
export const relationSchema = z.enum(['contradiction', 'process_change', 'environment_change', 'dependency_change', 'time_sensitive', 'adds_context', 'consistent', 'unrelated']);
export const comparisonSchema = z.object({ relation: relationSchema, needsReview: z.boolean(), explanation: z.string().min(10).max(3000), oldQuote: z.string().min(1).max(8000), newQuote: z.string().min(1).max(8000), proposedStatement: z.string().max(8000).nullable() }).strict();
export type CompareInput = { knowledge: { statement: string; title: string; topic: string }; evidence: { text: string; sourceName: string }; provider: 'groq' | 'bedrock' };
export type Model = (system: string, input: unknown) => Promise<string>;
export class ModelValidationError extends AppError {
  readonly code = 'INVALID_MODEL_OUTPUT';
  constructor() { super(502, 'The model returned a quote that could not be verified against the sources. Retry the comparison.'); }
}
export function validateComparison(raw: string, input: CompareInput) {
  let data: unknown;
  try { data = JSON.parse(raw); } catch { throw new ModelValidationError(); }
  const parsed = comparisonSchema.safeParse(data);
  if (!parsed.success) throw new ModelValidationError();
  const result = parsed.data;
  if (!input.knowledge.statement.includes(result.oldQuote) || !input.evidence.text.includes(result.newQuote)) throw new ModelValidationError();
  const needsReview = !['consistent', 'unrelated'].includes(result.relation);
  if (needsReview && !result.proposedStatement?.trim()) throw new ModelValidationError();
  return { ...result, needsReview, proposedStatement: needsReview ? result.proposedStatement : null };
}
export async function compareKnowledge(input: CompareInput, model: Model = input.provider === 'groq' ? groq : bedrock) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = await model(comparisonPrompt + (attempt ? '\nRETRY: Return only strict JSON. Copy exact source substrings; do not normalize punctuation, spacing or quotes.' : ''), input);
    try { return validateComparison(raw, input); } catch (error) { if (!(error instanceof ModelValidationError) || attempt === 1) throw error; }
  }
  throw new ModelValidationError();
}

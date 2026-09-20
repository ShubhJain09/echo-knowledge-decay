import { z } from 'zod';
import { AppError } from '../errors';
export const text = (max: number) => z.string().trim().min(1).max(max);
export const cardSchema = z.object({ title: text(120), topic: text(80), owner: text(100), statement: text(8000), source: text(200), volatility: z.enum(['high','medium','low','event']).default('medium'), sensitivity: z.enum(['Public','Internal','Confidential','Restricted']).default('Internal'), validFrom: z.iso.datetime().optional(), validUntil: z.iso.datetime().optional() }).strict().refine(v => !v.validUntil || !v.validFrom || Date.parse(v.validUntil) > Date.parse(v.validFrom), 'Validity end must follow its start.');
export const evidenceSchema = z.object({ cardId: text(100), name: text(160), content: z.string().min(1).max(2800000), encoding: z.enum(['text','base64']) }).strict();
export const decisionSchema = z.object({ decision: z.enum(['update','keep','archive']), expectedVersion: z.number().int().positive(), note: text(1000), statement: text(8000).optional() }).strict();
export function valid<T>(schema: z.ZodType<T>, data: unknown): T { const result = schema.safeParse(data); if (!result.success) throw new AppError(400, result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')); return result.data; }

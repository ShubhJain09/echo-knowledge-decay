import { z } from 'zod';
export const sourceEventSchema = z
  .object({
    provider: z.enum(['github', 'slack', 'notion', 'google-drive', 'jira', 'confluence']),
    externalId: z.string().min(1),
    sourceName: z.string().min(1),
    text: z.string().min(10).max(30000),
    occurredAt: z.iso.datetime(),
  })
  .strict();
// Phase 2 scaffold. Tenant identity must come from a verified server-side connector binding.
export interface SourceConnector {
  provider: z.infer<typeof sourceEventSchema>['provider'];
  verify(rawBody: Buffer, headers: Headers): Promise<boolean>;
  normalize(rawBody: Buffer): Promise<z.infer<typeof sourceEventSchema>[]>;
}
export const connectorStatus = { github: 'planned', slack: 'planned', notion: 'planned', 'google-drive': 'planned' } as const;

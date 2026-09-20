import { createHash } from 'node:crypto';
import { AppError } from '../errors';
import type { Actor } from '../auth/rbac';
import type { Repository } from '../repository';
import type { Data } from '../types';

export interface ApiResult {
  status?: number;
  body?: unknown;
  bytes?: Buffer;
  mime?: string;
  name?: string;
  url?: string;
}

/** Everything a route handler is allowed to touch. The repository is already tenant-scoped. */
export interface RouteContext {
  actor: Actor;
  repo: Repository;
  body: unknown;
}

/**
 * Idempotency key for a comparison. Tenant, card, card version and evidence hash all participate, so
 * re-comparing the same evidence against the same card version reuses the existing review instead of
 * creating a second one.
 */
export const comparisonKey = (org: string, cardId: string, version: number, hash: string) =>
  createHash('sha256')
    .update(JSON.stringify([org, cardId, version, hash]))
    .digest('hex');

export function activeCard(data: Data, id: string) {
  const card = data.cards.find(c => c.id === id && c.status === 'verified');
  if (!card) throw new AppError(404, 'Choose an active knowledge card.');
  return card;
}

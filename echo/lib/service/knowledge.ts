import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { conflict } from '../repository';
import { AppError } from '../errors';
import { authorize } from '../auth/rbac';
import { nextReview } from '../intelligence/freshness';
import { seedCards } from '../seed';
import { cardSchema, text, valid } from '../types/schemas';
import type { Card } from '../types';
import type { ApiResult, RouteContext } from './shared';

const rollbackSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    version: z.number().int().positive(),
    reason: text(1000),
  })
  .strict();

/** Loads the Service X example. Never overwrites knowledge that already exists. */
export async function seedWorkspace({ actor, repo, body }: RouteContext): Promise<ApiResult> {
  authorize(actor.role, 'admin');
  valid(z.object({}).strict(), body);
  const cards = seedCards(actor.organizationId);
  await repo.mutate(actor, 'knowledge.seed', 'service-x', data => {
    for (const card of cards) if (!data.cards.some(existing => existing.id === card.id)) data.cards.push(card);
  });
  return { body: { ok: true } };
}

export async function createCard({ actor, repo, body }: RouteContext): Promise<ApiResult> {
  authorize(actor.role, 'create');
  const input = valid(cardSchema, body);
  const now = new Date().toISOString();
  const card: Card = {
    ...input,
    id: randomUUID(),
    organizationId: actor.organizationId,
    version: 1,
    status: 'verified',
    updatedAt: now,
    lastVerifiedAt: now,
    nextReviewAt: nextReview(now, input.volatility),
    history: [
      {
        organizationId: actor.organizationId,
        version: 1,
        statement: input.statement,
        source: input.source,
        createdAt: now,
        author: actor.name,
        note: 'Initial human-verified knowledge',
        status: 'verified',
      },
    ],
  };
  await repo.mutate(actor, 'knowledge.created', card.id, data => data.cards.push(card));
  return { status: 201, body: card };
}

/** Restoring an earlier version is itself a new version. Nothing is ever rewritten in place. */
export async function rollbackCard({ actor, repo, body }: RouteContext, cardId: string): Promise<ApiResult> {
  authorize(actor.role, 'review');
  const input = valid(rollbackSchema, body);
  const card = await repo.mutate(actor, 'knowledge.rollback', cardId, data => {
    const current = data.cards.find(c => c.id === cardId);
    if (!current) throw new AppError(404, 'Knowledge not found.');
    if (current.version !== input.expectedVersion) throw conflict();
    const target = current.history.find(v => v.version === input.version);
    if (!target) throw new AppError(404, 'Version not found.');
    const now = new Date().toISOString();
    current.history.forEach(v => {
      v.status = 'archived';
    });
    current.version++;
    current.statement = target.statement;
    current.source = target.source;
    current.status = 'verified';
    current.updatedAt = now;
    current.lastVerifiedAt = now;
    current.nextReviewAt = nextReview(now, current.volatility);
    current.history.push({
      ...target,
      status: 'verified',
      version: current.version,
      author: actor.name,
      createdAt: now,
      note: input.reason,
      supersedesVersion: input.expectedVersion,
      rollbackFrom: input.version,
    });
    return current;
  });
  return { body: card };
}

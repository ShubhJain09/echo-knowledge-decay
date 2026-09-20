import { z } from 'zod';
import { conflict } from '../repository';
import { AppError } from '../errors';
import { authorize } from '../auth/rbac';
import { nextReview } from '../intelligence/freshness';
import { decisionSchema, text, valid } from '../types/schemas';
import type { ApiResult, RouteContext } from './shared';

const MAX_SNOOZE_DAYS = 90;

const manageSchema = z
  .object({
    assignedTo: text(100).optional(),
    snoozedUntil: z.iso.datetime().optional(),
    evidenceRequested: text(1000).optional(),
  })
  .strict()
  .refine(v => Object.keys(v).length > 0);

/**
 * The single place knowledge becomes canonical. The whole decision — card, new version, review record
 * and audit event — is one conditional transaction, so a concurrent approval fails rather than
 * overwriting a version someone else just created.
 */
export async function decideReview({ actor, repo, body }: RouteContext, reviewId: string): Promise<ApiResult> {
  authorize(actor.role, 'review');
  const input = valid(decisionSchema, body);
  const result = await repo.mutate(actor, `review.${input.decision}`, reviewId, data => {
    const review = data.reviews.find(r => r.id === reviewId);
    if (!review) throw new AppError(404, 'Review not found.');
    const card = data.cards.find(c => c.id === review.cardId);
    if (
      review.status !== 'pending' ||
      !card ||
      card.version !== input.expectedVersion ||
      review.cardVersion !== input.expectedVersion ||
      card.status !== 'verified'
    )
      throw conflict();

    const now = new Date().toISOString();
    if (input.decision !== 'keep') {
      if (input.decision === 'update' && !input.statement)
        throw new AppError(400, 'Write the verified statement before updating.');
      card.history.forEach(v => {
        v.status = 'archived';
      });
      card.version = input.expectedVersion + 1;
      card.status = input.decision === 'archive' ? 'archived' : 'verified';
      card.statement = input.decision === 'update' ? input.statement! : card.statement;
      card.source = input.decision === 'update' ? review.evidenceName : card.source;
      card.updatedAt = now;
      card.history.push({
        organizationId: actor.organizationId,
        version: card.version,
        statement: card.statement,
        source: card.source,
        createdAt: now,
        author: actor.name,
        note: input.note,
        evidenceId: review.evidenceId || undefined,
        status: card.status,
        supersedesVersion: input.expectedVersion,
      });
    }
    // "Keep" still counts as a verification: it refreshes the clock without creating a version.
    card.lastVerifiedAt = now;
    card.nextReviewAt = nextReview(now, card.volatility);
    Object.assign(review, {
      status: 'resolved',
      decision: input.decision,
      resolvedAt: now,
      reviewer: actor.name,
      note: input.note,
    });
    return { card, review };
  });
  return { body: result };
}

/** Assignment, snoozing and evidence requests. None of these change what is currently verified. */
export async function manageReview({ actor, repo, body }: RouteContext, reviewId: string): Promise<ApiResult> {
  authorize(actor.role, 'review');
  const input = valid(manageSchema, body);
  if (
    input.snoozedUntil &&
    (Date.parse(input.snoozedUntil) <= Date.now() || Date.parse(input.snoozedUntil) > Date.now() + MAX_SNOOZE_DAYS * 86400000)
  )
    throw new AppError(400, 'Snooze for a future date within 90 days.');
  await repo.mutate(actor, 'review.managed', reviewId, data => {
    const review = data.reviews.find(r => r.id === reviewId && r.status === 'pending');
    if (!review) throw new AppError(404, 'Pending review not found.');
    Object.assign(review, input);
  });
  return { body: { ok: true } };
}

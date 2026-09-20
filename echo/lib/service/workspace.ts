import { z } from 'zod';
import { authorize, can } from '../auth/rbac';
import { ask } from '../intelligence';
import { text, valid } from '../types/schemas';
import { comparisonKey, type ApiResult, type RouteContext } from './shared';

const askSchema = z.object({ question: text(1000) }).strict();

/** The whole tenant snapshot. Audit events are withheld from roles without audit permission. */
export async function readWorkspace({ actor, repo }: RouteContext): Promise<ApiResult> {
  const data = await repo.snapshot();
  return { body: { ...data, audit: can(actor.role, 'audit') ? data.audit : [] } };
}

/**
 * Manually triggered freshness sweep. It raises one policy review per card per verification period;
 * there is no scheduler, so nothing happens until someone asks for it.
 */
export async function runFreshnessSweep({ actor, repo, body }: RouteContext): Promise<ApiResult> {
  authorize(actor.role, 'review');
  valid(z.object({}).strict(), body);
  await repo.mutate(actor, 'review.freshness', 'scheduled', data => {
    const due = data.cards.filter(
      c =>
        c.status === 'verified' &&
        ((c.nextReviewAt && Date.parse(c.nextReviewAt) <= Date.now()) ||
          (c.validUntil && Date.parse(c.validUntil) <= Date.now())),
    );
    for (const card of due) {
      const id = comparisonKey(actor.organizationId, card.id, card.version, `freshness:${card.lastVerifiedAt}`);
      if (data.reviews.some(r => r.id === id)) continue;
      data.reviews.push({
        id,
        organizationId: actor.organizationId,
        cardId: card.id,
        cardVersion: card.version,
        evidenceId: '',
        evidenceName: 'Scheduled review policy',
        createdAt: new Date().toISOString(),
        status: 'pending',
        priority: 'medium',
        relation: 'time_sensitive',
        needsReview: true,
        explanation: 'The scheduled review date or validity window has elapsed. Verify the procedure before renewing it.',
        oldQuote: card.statement,
        newQuote: '',
        proposedStatement: card.statement,
        engine: 'policy',
      });
    }
  });
  return { body: { ok: true } };
}

export async function askQuestion({ repo, body }: RouteContext): Promise<ApiResult> {
  const { question } = valid(askSchema, body);
  return { body: await ask(question, (await repo.snapshot()).cards) };
}

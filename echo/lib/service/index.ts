import { AppError } from '../errors';
import { authorize, type Actor } from '../auth/rbac';
import { repository, type Repository } from '../repository';
import { createCard, rollbackCard, seedWorkspace } from './knowledge';
import { compareEvidence, downloadEvidence, ingestEvidence } from './evidence';
import { decideReview, manageReview } from './reviews';
import { askQuestion, readWorkspace, runFreshnessSweep } from './workspace';
import type { ApiResult, RouteContext } from './shared';

export { comparisonKey } from './shared';
export type { ApiResult, RouteContext } from './shared';

type Handler = (context: RouteContext, id: string) => Promise<ApiResult>;

/**
 * Route table. `:id` matches one path segment and is passed to the handler. Order does not matter:
 * patterns are matched by exact segment count, so no route can shadow another.
 */
const routes: Record<string, Handler> = {
  'GET workspace': readWorkspace,
  'POST seed': seedWorkspace,
  'POST knowledge': createCard,
  'POST knowledge/:id/rollback': rollbackCard,
  'POST evidence': ingestEvidence,
  'GET evidence/:id': downloadEvidence,
  'POST evidence/:id/compare': compareEvidence,
  'POST reviews/:id/decision': decideReview,
  'POST reviews/:id/manage': manageReview,
  'POST freshness': runFreshnessSweep,
  'POST ask': askQuestion,
};

function match(method: string, parts: string[]) {
  for (const [pattern, handler] of Object.entries(routes)) {
    const [routeMethod, path] = pattern.split(' ');
    const segments = path.split('/');
    if (routeMethod !== method || segments.length !== parts.length) continue;
    let id = '';
    if (segments.every((segment, i) => (segment === ':id' ? ((id = parts[i]), id.length > 0) : segment === parts[i])))
      return { handler, id };
  }
  return undefined;
}

/**
 * The single entry point for the knowledge API, used by both the Next.js route and the Lambda handler.
 * Tenant scoping is enforced here rather than trusted from the request body.
 */
export async function dispatch(
  method: string,
  pathname: string,
  body: unknown,
  actor: Actor,
  repo: Repository = repository(actor.organizationId),
): Promise<ApiResult> {
  if (actor.organizationId !== repo.organizationId) throw new AppError(403, 'Organization mismatch.');
  authorize(actor.role, 'read');
  const parts = pathname
    .replace(/^\/api\/?/, '')
    .split('/')
    .filter(Boolean);
  const route = match(method, parts);
  if (!route) throw new AppError(404, 'Endpoint not found.');
  return route.handler({ actor, repo, body }, route.id);
}

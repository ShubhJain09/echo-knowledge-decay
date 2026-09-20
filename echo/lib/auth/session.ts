import { getServerSession } from 'next-auth';
import { randomUUID } from 'node:crypto';
import { authOptions } from './options';
import { account } from './accounts';
import { AppError } from '../errors';
import type { Actor } from './rbac';
export async function requireActor(): Promise<Actor> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) throw new AppError(401, 'Sign in to open this workspace.');
  const row = await account(session.user.email);
  if (
    !row ||
    row.data.status !== 'active' ||
    row.data.sessionVersion !== (session as unknown as { sessionVersion: number }).sessionVersion
  )
    throw new AppError(401, 'Your session has expired. Sign in again.');
  const u = row.data;
  return { id: u.id, organizationId: u.organizationId, name: u.name, email: u.email, role: u.role, requestId: randomUUID() };
}
export async function requireRecentLogin() {
  const s = await getServerSession(authOptions);
  if (Date.now() - Number((s as unknown as { authenticatedAt: number })?.authenticatedAt || 0) > 15 * 60000)
    throw new AppError(401, 'Sign in again before changing security settings.');
}

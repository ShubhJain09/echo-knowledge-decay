import { createHash, randomUUID, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { store, type Row, type Write } from '../db/store';
import type { Organization, User } from '../types';
import { AppError } from '../errors';
import { repository } from '../repository';
import type { Actor } from './rbac';
export const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const pk = (email: string) => `ACCOUNT#${hash(email.toLowerCase())}`;
export function localVerificationEnabled() {
  return (
    process.env.ECHO_LOCAL_MAIL === 'true' &&
    process.env.ECHO_STORAGE !== 'aws' &&
    (process.env.NODE_ENV !== 'production' || process.env.CI === 'true')
  );
}
export function passwordHash(password: string) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}
// A non-hex stored hash must fail closed: Buffer.from() would silently truncate and timingSafeEqual would throw.
export function verifyPassword(password: string, encoded: string) {
  const [salt, expected] = encoded.split(':');
  if (!salt || !/^[0-9a-f]{128}$/i.test(expected || '')) return false;
  const actual = scryptSync(password, salt, 64);
  return timingSafeEqual(actual, Buffer.from(expected, 'hex'));
}
export const account = (email: string) => store().get<User>(pk(email), 'USER');
export async function organization(id: string) {
  return (await store().get<Organization>(`ORG#${id}`, 'ORGANIZATION'))?.data;
}
export async function members(org: string) {
  const rows = await store().list<{ email: string }>(`ORG#${org}`, 'MEMBER#');
  return (await Promise.all(rows.map(r => account(r.data.email))))
    .filter((r): r is Row<User> => !!r && r.data.organizationId === org)
    .map(r => publicUser(r.data));
}
export function publicUser(u: User) {
  const { passwordHash: _p, verificationHash: _v, verificationExpires: _e, ...safe } = u;
  return safe;
}
export async function saveUser(row: Row<User>, user: User) {
  await store().write([{ row: { ...row, revision: row.revision + 1, data: user }, expected: row.revision }]);
}
export async function createAccount(input: {
  name: string;
  email: string;
  password?: string;
  organizationName: string;
  provider: 'local' | 'cognito';
  subject?: string;
}) {
  const email = input.email.toLowerCase();
  if (await account(email)) throw new AppError(409, 'An account with this email already exists.');
  const now = new Date().toISOString();
  const orgId = randomUUID();
  const userId = input.subject || randomUUID();
  const code = randomBytes(24).toString('hex');
  const user: User = {
    id: userId,
    organizationId: orgId,
    name: input.name,
    email,
    role: 'Owner',
    status: input.provider === 'cognito' ? 'active' : 'pending',
    avatar: '',
    createdAt: now,
    lastSeenAt: now,
    sessionVersion: 0,
    timezone: 'UTC',
    notifications: true,
    identityProvider: input.provider,
    ...(input.password
      ? {
          passwordHash: passwordHash(input.password),
          verificationHash: hash(code),
          verificationExpires: new Date(Date.now() + 86400000).toISOString(),
        }
      : {}),
  };
  const org: Organization = {
    id: orgId,
    organizationId: orgId,
    name: input.organizationName,
    slug: `echo-${orgId.slice(0, 8)}`,
    createdAt: now,
    plan: 'starter',
    settings: { defaultReviewDays: 90 },
  };
  const writes: Write[] = [
    { row: { pk: pk(email), sk: 'USER', organizationId: orgId, revision: 0, data: user }, expected: -1 },
    { row: { pk: `ORG#${orgId}`, sk: 'ORGANIZATION', organizationId: orgId, revision: 0, data: org }, expected: -1 },
    { row: { pk: `ORG#${orgId}`, sk: `MEMBER#${userId}`, organizationId: orgId, revision: 0, data: { email } }, expected: -1 },
  ];
  await store().write(writes);
  if (input.provider === 'local') await sendVerification(email, code);
  return { user, code };
}
export async function sendVerification(email: string, code: string) {
  if (localVerificationEnabled()) return;
  if (!process.env.EMAIL_FROM)
    throw new AppError(503, 'Email delivery is not configured. An administrator must set EMAIL_FROM or use Cognito signup.');
  const link = `${process.env.NEXTAUTH_URL}/verify?email=${encodeURIComponent(email)}&token=${code}`;
  await new SESv2Client({}).send(
    new SendEmailCommand({
      FromEmailAddress: process.env.EMAIL_FROM,
      Destination: { ToAddresses: [email] },
      Content: {
        Simple: {
          Subject: { Data: 'Verify your Echo account' },
          Body: { Text: { Data: `Verify your email within 24 hours: ${link}` } },
        },
      },
    }),
  );
}
export async function auditAccount(user: User, action: string) {
  const actor: Actor = {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    organizationId: user.organizationId,
    requestId: randomUUID(),
  };
  await repository(user.organizationId).appendAudit(actor, action, user.id);
}

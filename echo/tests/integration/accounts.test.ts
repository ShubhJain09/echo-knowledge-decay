import { beforeAll, afterAll, it, expect } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { store, SqliteStore } from '../../lib/db/store';
import { account, createAccount, passwordHash, verifyPassword, saveUser, members } from '../../lib/auth/accounts';
import { rateLimit } from '../../lib/auth/security';
import { organizationAction } from '../../lib/service/organization';
import type { Actor } from '../../lib/auth/rbac';
import { applyPrismaMigrations } from './fixtures/apply-prisma-migrations';
let root: string;
let db: SqliteStore;
beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'echo-accounts-'));
  process.env.DATABASE_URL = `file:${root}/auth.db`;
  process.env.ECHO_STORAGE = 'sqlite';
  process.env.ECHO_LOCAL_MAIL = 'true';
  await applyPrismaMigrations(path.join(root, 'auth.db'));
  db = store() as SqliteStore;
});
afterAll(async () => {
  await db.db.$disconnect();
  if (root.startsWith(path.join(os.tmpdir(), 'echo-accounts-'))) await rm(root, { recursive: true, force: true });
});
it('password hashes are salted and constant-time verification rejects wrong passwords', () => {
  const a = passwordHash('Long-password-2026');
  const b = passwordHash('Long-password-2026');
  expect(a).not.toBe(b);
  expect(verifyPassword('Long-password-2026', a)).toBe(true);
  expect(verifyPassword('Wrong-password-2026', a)).toBe(false);
});
it('signup remains pending until verification; roles and organization come from server records', async () => {
  const { user, code } = await createAccount({
    name: 'Owner',
    email: 'owner@example.test',
    password: 'Long-password-2026',
    organizationName: 'A',
    provider: 'local',
  });
  expect(user.status).toBe('pending');
  expect(user.role).toBe('Owner');
  expect(code).toHaveLength(48);
  expect((await account(user.email))?.data.passwordHash).not.toBe('Long-password-2026');
});
it('durable limits survive calls and reject over-limit requests', async () => {
  await rateLimit('test', 2, 3600);
  await rateLimit('test', 2, 3600);
  await expect(rateLimit('test', 2, 3600)).rejects.toMatchObject({ status: 429 });
});
it('invitation tokens bind the email and role; role changes invalidate sessions', async () => {
  const own = (await account('owner@example.test'))!;
  await saveUser(own, { ...own.data, status: 'active' });
  const a: Actor = {
    id: own.data.id,
    email: own.data.email,
    name: own.data.name,
    role: 'Owner',
    organizationId: own.data.organizationId,
    requestId: 'invite-test',
  };
  const teammate = await createAccount({
    name: 'Teammate',
    email: 'member@example.test',
    organizationName: 'Personal',
    provider: 'cognito',
    subject: 'member-sub',
  });
  const b: Actor = {
    id: teammate.user.id,
    email: teammate.user.email,
    name: 'Teammate',
    role: 'Owner',
    organizationId: teammate.user.organizationId,
    requestId: 'accept-test',
  };
  process.env.NEXTAUTH_URL = 'http://127.0.0.1:3001';
  const invitation = (await organizationAction('invite', { email: b.email, role: 'Reviewer' }, a)) as { url: string };
  const token = new URL(invitation.url).searchParams.get('token')!;
  await expect(organizationAction('accept', { token }, a)).rejects.toMatchObject({ status: 400 });
  await organizationAction('accept', { token }, b);
  expect(await members(a.organizationId)).toHaveLength(2);
  await organizationAction('role', { email: b.email, role: 'Viewer' }, a);
  const updated = (await account(b.email))!.data;
  expect(updated.role).toBe('Viewer');
  expect(updated.sessionVersion).toBe(1);
  await expect(organizationAction('accept', { token }, b)).rejects.toMatchObject({ status: 400 });
});

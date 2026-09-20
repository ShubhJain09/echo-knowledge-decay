import { beforeAll, afterAll, it, expect } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { store, SqliteStore } from '../../lib/db/store';
import { account, createAccount, passwordHash, verifyPassword, saveUser, members } from '../../lib/auth/accounts';
import { rateLimit } from '../../lib/auth/security';
import { organizationAction } from '../../lib/service/organization';
import { POST as accountPost } from '../../app/api/account/[action]/route';
import type { Actor } from '../../lib/auth/rbac';
let root: string;
let db: SqliteStore;
beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'echo-accounts-'));
  process.env.DATABASE_URL = `file:${root}/auth.db`;
  process.env.ECHO_STORAGE = 'sqlite';
  process.env.ECHO_LOCAL_MAIL = 'true';
  db = store() as SqliteStore;
  await db.db.$executeRawUnsafe(
    'CREATE TABLE "Record" ("pk" TEXT NOT NULL,"sk" TEXT NOT NULL,"organizationId" TEXT NOT NULL,"revision" INTEGER NOT NULL,"data" TEXT NOT NULL,PRIMARY KEY ("pk","sk"))',
  );
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
it('signup returns a local verification token in CI production mode for non-AWS storage', async () => {
  const { NODE_ENV, CI, ECHO_STORAGE, ECHO_LOCAL_MAIL } = process.env;
  process.env.NODE_ENV = 'production';
  process.env.CI = 'true';
  process.env.ECHO_STORAGE = 'sqlite';
  process.env.ECHO_LOCAL_MAIL = 'true';
  try {
    const response = await accountPost(
      new NextRequest('http://127.0.0.1:3001/api/account/signup', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'http://127.0.0.1:3001', host: '127.0.0.1:3001' },
        body: JSON.stringify({
          name: 'CI Owner',
          email: 'ci-owner@example.test',
          password: 'Long-password-2026',
          organizationName: 'CI Workspace',
        }),
      }),
      { params: Promise.resolve({ action: 'signup' }) },
    );
    expect(response.status).toBe(201);
    const body = (await response.json()) as { localVerificationToken?: string };
    expect(body.localVerificationToken).toHaveLength(48);
  } finally {
    process.env.NODE_ENV = NODE_ENV;
    process.env.CI = CI;
    process.env.ECHO_STORAGE = ECHO_STORAGE;
    process.env.ECHO_LOCAL_MAIL = ECHO_LOCAL_MAIL;
  }
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

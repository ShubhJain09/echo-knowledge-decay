import { beforeAll, afterAll, it, expect } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { store, SqliteStore } from '../../lib/db/store';
import { POST as accountPost } from '../../app/api/account/[action]/route';

let root: string;
let db: SqliteStore;

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'echo-account-signup-ci-'));
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
  if (root.startsWith(path.join(os.tmpdir(), 'echo-account-signup-ci-'))) await rm(root, { recursive: true, force: true });
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

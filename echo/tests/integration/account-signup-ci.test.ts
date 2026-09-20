import { beforeAll, afterAll, it, expect } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { store, SqliteStore } from '../../lib/db/store';

let root: string;
let db: SqliteStore;

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'echo-account-signup-ci-'));
  process.env.DATABASE_URL = `file:${root}/auth.db`;
  process.env.ECHO_STORAGE = 'sqlite';
  process.env.ECHO_LOCAL_MAIL = 'true';
  const migration = await readFile(path.join(process.cwd(), 'prisma/migrations/20260920000000_initial/migration.sql'), 'utf8');
  const sqlite = new DatabaseSync(path.join(root, 'auth.db'));
  sqlite.exec(migration);
  sqlite.close();
  db = store() as SqliteStore;
});

afterAll(async () => {
  await db.db.$disconnect();
  if (root.startsWith(path.join(os.tmpdir(), 'echo-account-signup-ci-'))) await rm(root, { recursive: true, force: true });
});

it('signup returns a local verification token in CI production mode for non-AWS storage', async () => {
  const result = JSON.parse(
    execFileSync(
      process.execPath,
      [
        '--import',
        'tsx',
        '--input-type=module',
        '--eval',
        `
          import { NextRequest } from 'next/server';
          import { POST as accountPost } from './app/api/account/[action]/route.ts';
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
          console.log(JSON.stringify({ status: response.status, body: await response.json() }));
        `,
      ],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          DATABASE_URL: `file:${root}/auth.db`,
          ECHO_STORAGE: 'sqlite',
          ECHO_LOCAL_MAIL: 'true',
          NODE_ENV: 'production',
          CI: 'true',
        },
      },
    ).toString(),
  ) as { status: number; body: { localVerificationToken?: string } };
  expect(result.status).toBe(201);
  expect(result.body.localVerificationToken).toHaveLength(48);
});

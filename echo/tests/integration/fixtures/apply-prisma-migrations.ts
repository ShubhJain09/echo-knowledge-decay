import { mkdir, stat } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

export async function applyPrismaMigrations(databaseFile: string) {
  try {
    await stat(databaseFile);
    throw new Error(`applyPrismaMigrations requires a fresh database file: ${databaseFile}`);
  } catch (error) {
    if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error;
  }
  await mkdir(path.dirname(databaseFile), { recursive: true });
  const env = { ...process.env, DATABASE_URL: `file:${databaseFile}` };
  execFileSync(process.execPath, ['scripts/prepare-sqlite.mjs'], { cwd: process.cwd(), env, stdio: 'pipe' });
  execFileSync(path.join(process.cwd(), 'node_modules/.bin/prisma'), ['migrate', 'deploy', '--schema', 'prisma/schema.prisma'], {
    cwd: process.cwd(),
    env,
    stdio: 'pipe',
  });
}

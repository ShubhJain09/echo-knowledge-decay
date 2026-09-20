import { mkdir, open } from 'node:fs/promises';
import path from 'node:path';
try {
  process.loadEnvFile('.env');
} catch {}
if (process.env.ECHO_STORAGE === 'aws') process.exit(0);
const url = process.env.DATABASE_URL || 'file:./echo.db';
if (!url.startsWith('file:')) throw new Error('Local development requires a SQLite file URL.');
const filename = path.resolve('prisma', url.slice(5));
await mkdir(path.dirname(filename), { recursive: true });
const file = await open(filename, 'a', 0o600);
await file.close();

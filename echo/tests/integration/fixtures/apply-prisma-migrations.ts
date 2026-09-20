import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export async function applyPrismaMigrations(databaseFile: string) {
  const migrationsDir = path.join(process.cwd(), 'prisma', 'migrations');
  const entries = (await readdir(migrationsDir, { withFileTypes: true }))
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort();
  const sqlite = new DatabaseSync(databaseFile);
  try {
    for (const entry of entries) {
      const migrationPath = path.join(migrationsDir, entry, 'migration.sql');
      const sql = await readFile(migrationPath, 'utf8');
      sqlite.exec(sql);
    }
  } finally {
    sqlite.close();
  }
}

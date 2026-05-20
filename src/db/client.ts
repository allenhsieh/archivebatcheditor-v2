import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import path from 'node:path';
import fs from 'node:fs';
import * as schema from './schema';

function createDb() {
  const dbPath = process.env.DATABASE_PATH ?? './data/app.db';
  const dir = path.dirname(path.resolve(dbPath));
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const sqlite = new Database(dbPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');

  const db = drizzle(sqlite, { schema });

  const migrationsFolder = path.join(process.cwd(), 'src', 'db', 'migrations');
  if (fs.existsSync(migrationsFolder)) {
    migrate(db, { migrationsFolder });
  }

  return db;
}

const globalForDb = globalThis as typeof globalThis & {
  _db: ReturnType<typeof createDb> | undefined;
};

export const db = globalForDb._db ?? createDb();
if (process.env.NODE_ENV !== 'production') globalForDb._db = db;

export type AppDb = ReturnType<typeof createDb>;

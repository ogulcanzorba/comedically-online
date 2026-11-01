import Database from 'better-sqlite3';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

let instance: Database.Database | null = null;

/** Singleton SQLite connection. Schema is applied idempotently on first open. */
export function getDb(): Database.Database {
  if (instance) return instance;
  const file = process.env.SQLITE_FILE ?? join(process.cwd(), 'data', 'comedically.db');
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  instance = new Database(file);
  instance.pragma('journal_mode = WAL');
  const schema = readFileSync(join(process.cwd(), 'src', 'db', 'schema.sql'), 'utf8');
  instance.exec(schema);
  return instance;
}

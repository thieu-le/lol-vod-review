import Database from 'better-sqlite3';
import { paths } from '../../lib/paths';
import { createLogger } from '../../lib/logger';
import { runMigrations } from './migrate';

const logger = createLogger('db');

let db: Database.Database | null = null;

// Opens (once) the SQLite connection, applies pragmas + migrations.
export function getDb(): Database.Database {
  if (db) return db;
  const file = paths.database();
  logger.info('Opening database at', file);
  db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('synchronous = NORMAL');
  runMigrations(db);
  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}

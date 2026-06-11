import type Database from 'better-sqlite3';
import { createLogger } from '../../lib/logger';
import init001 from './migrations/001_init.sql?raw';
import init002 from './migrations/002_match_events_event_id.sql?raw';
import init003 from './migrations/003_matches_player_identities.sql?raw';

const logger = createLogger('migrate');

// Ordered list of migrations. Append new ones; never edit applied ones.
const MIGRATIONS: { version: number; name: string; sql: string }[] = [
  { version: 1, name: '001_init', sql: init001 },
  { version: 2, name: '002_match_events_event_id', sql: init002 },
  { version: 3, name: '003_matches_player_identities', sql: init003 },
];

export function runMigrations(db: Database.Database): void {
  db.exec(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       version INTEGER PRIMARY KEY,
       name TEXT NOT NULL,
       applied_at INTEGER NOT NULL
     );`
  );

  const appliedRow = db
    .prepare('SELECT COALESCE(MAX(version), 0) AS v FROM schema_migrations')
    .get() as { v: number };
  const current = appliedRow.v;

  const pending = MIGRATIONS.filter((m) => m.version > current).sort(
    (a, b) => a.version - b.version
  );

  if (pending.length === 0) {
    logger.info('Database up to date at version', current);
    return;
  }

  const record = db.prepare(
    'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)'
  );

  const apply = db.transaction((m: { version: number; name: string; sql: string }) => {
    db.exec(m.sql);
    record.run(m.version, m.name, Date.now());
  });

  for (const m of pending) {
    logger.info('Applying migration', m.name);
    apply(m);
  }
  logger.info('Migrations complete; now at version', pending[pending.length - 1].version);
}

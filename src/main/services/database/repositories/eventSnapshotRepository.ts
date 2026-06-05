import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { getDb } from '../db';

// Stores the verbatim Riot event payload so derived data can be rebuilt later.
export interface EventSnapshotRepository {
  append(matchId: string, rawJson: string): void;
  countForMatch(matchId: string): number;
}

class SqliteEventSnapshotRepository implements EventSnapshotRepository {
  constructor(private readonly db: Database.Database) {}

  append(matchId: string, rawJson: string): void {
    this.db
      .prepare(
        'INSERT INTO match_event_snapshots (id, match_id, raw_json, created_at) VALUES (?, ?, ?, ?)'
      )
      .run(randomUUID(), matchId, rawJson, Date.now());
  }

  countForMatch(matchId: string): number {
    const row = this.db
      .prepare('SELECT COUNT(*) AS c FROM match_event_snapshots WHERE match_id = ?')
      .get(matchId) as { c: number };
    return row.c;
  }
}

let instance: EventSnapshotRepository | null = null;
export function eventSnapshotRepository(): EventSnapshotRepository {
  if (!instance) instance = new SqliteEventSnapshotRepository(getDb());
  return instance;
}

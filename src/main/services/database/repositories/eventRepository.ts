import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { MatchEvent } from '@shared/types';
import { getDb } from '../db';
import type { ParsedEvent } from '../../riot/eventParser';

// Raw row shape as stored in SQLite (snake_case).
interface MatchEventRow {
  id: string;
  match_id: string;
  riot_event_id: number;
  event_type: string;
  event_time_seconds: number;
  wall_clock_at: number;
  killer_name: string | null;
  victim_name: string | null;
  assisters: string | null;
  payload: string | null;
  created_at: number;
}

function mapRow(r: MatchEventRow): MatchEvent {
  return {
    id: r.id,
    matchId: r.match_id,
    eventType: r.event_type,
    eventTimeSeconds: r.event_time_seconds,
    wallClockAt: r.wall_clock_at,
    killerName: r.killer_name,
    victimName: r.victim_name,
    assisters: r.assisters ? (JSON.parse(r.assisters) as string[]) : [],
    payload: r.payload ? JSON.parse(r.payload) : null,
    createdAt: r.created_at,
  };
}

// Persists parsed events and reads them back as domain MatchEvents.
// The swappable seam (sqlite today, postgres later) — no raw SQL outside here.
export interface EventRepository {
  appendEvents(matchId: string, events: ParsedEvent[]): number;
  listForMatch(matchId: string): MatchEvent[];
}

class SqliteEventRepository implements EventRepository {
  constructor(private readonly db: Database.Database) {}

  // Idempotent batch insert. Re-inserting an already-seen (match_id, EventID)
  // is a silent no-op via INSERT OR IGNORE on the unique index, so this is safe
  // to call every poll with the full replayed event list (incl. after a
  // reconnect). Returns the number of rows actually inserted.
  appendEvents(matchId: string, events: ParsedEvent[]): number {
    if (events.length === 0) return 0;
    const now = Date.now();
    const stmt = this.db.prepare(
      `INSERT OR IGNORE INTO match_events
         (id, match_id, riot_event_id, event_type, event_time_seconds,
          wall_clock_at, killer_name, victim_name, assisters, payload, created_at)
       VALUES
         (@id, @match_id, @riot_event_id, @event_type, @event_time_seconds,
          @wall_clock_at, @killer_name, @victim_name, @assisters, @payload, @created_at)`
    );
    const insertMany = this.db.transaction((rows: ParsedEvent[]) => {
      let inserted = 0;
      for (const e of rows) {
        const info = stmt.run({
          id: randomUUID(),
          match_id: matchId,
          riot_event_id: e.eventId,
          event_type: e.eventType,
          event_time_seconds: e.eventTimeSeconds,
          wall_clock_at: now,
          killer_name: e.killerName,
          victim_name: e.victimName,
          assisters: JSON.stringify(e.assisters),
          payload: JSON.stringify(e.payload),
          created_at: now,
        });
        inserted += info.changes;
      }
      return inserted;
    });
    return insertMany(events);
  }

  listForMatch(matchId: string): MatchEvent[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM match_events
         WHERE match_id = ?
         ORDER BY event_time_seconds ASC, riot_event_id ASC`
      )
      .all(matchId) as MatchEventRow[];
    return rows.map(mapRow);
  }
}

let instance: EventRepository | null = null;
export function eventRepository(): EventRepository {
  if (!instance) instance = new SqliteEventRepository(getDb());
  return instance;
}

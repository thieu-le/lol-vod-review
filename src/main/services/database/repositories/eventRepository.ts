import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { MatchEvent } from '@shared/types';
import type { MatchHighlights } from '@shared/ipc-contract';
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
  highlightsForMatches(matchIds: string[]): Record<string, MatchHighlights>;
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

  // Player-attributed highlight signals across many matches in one query.
  // FirstBlood/Ace don't populate killer_name (Riot uses Recipient/Acer keys),
  // so attribution reads the verbatim payload and compares against the match's
  // stored player_identities.
  highlightsForMatches(matchIds: string[]): Record<string, MatchHighlights> {
    const out: Record<string, MatchHighlights> = {};
    if (matchIds.length === 0) return out;

    const placeholders = matchIds.map(() => '?').join(',');
    const rows = this.db
      .prepare(
        `SELECT e.match_id, e.event_type, e.payload, m.player_identities
         FROM match_events e
         JOIN matches m ON m.id = e.match_id
         WHERE e.event_type IN ('FirstBlood', 'Multikill', 'Ace')
           AND e.match_id IN (${placeholders})`
      )
      .all(...matchIds) as {
      match_id: string;
      event_type: string;
      payload: string | null;
      player_identities: string | null;
    }[];

    for (const r of rows) {
      if (!r.player_identities || !r.payload) continue;
      let identities: string[];
      let payload: Record<string, unknown>;
      try {
        identities = JSON.parse(r.player_identities) as string[];
        payload = JSON.parse(r.payload) as Record<string, unknown>;
      } catch {
        continue;
      }
      const ids = new Set(identities);
      const isPlayer = (v: unknown) => typeof v === 'string' && ids.has(v);

      const h = (out[r.match_id] ??= { firstBlood: false, ace: false, killStreak: null });
      if (r.event_type === 'FirstBlood' && isPlayer(payload.Recipient)) {
        h.firstBlood = true;
      } else if (r.event_type === 'Ace' && isPlayer(payload.Acer)) {
        h.ace = true;
      } else if (r.event_type === 'Multikill' && isPlayer(payload.KillerName)) {
        const streak = typeof payload.KillStreak === 'number' ? payload.KillStreak : 2;
        h.killStreak = Math.max(h.killStreak ?? 0, streak);
      }
    }

    return out;
  }
}

let instance: EventRepository | null = null;
export function eventRepository(): EventRepository {
  if (!instance) instance = new SqliteEventRepository(getDb());
  return instance;
}

-- 002: rebuild match_events with riot_event_id NOT NULL (Phase 2).
--
-- match_events is empty in all Phase 1 databases (no writer existed — only
-- match_event_snapshots/matches/settings were written), so we recreate it
-- cleanly with a NOT NULL EventID column instead of ALTER TABLE ADD COLUMN.
-- ADD COLUMN cannot add a NOT NULL column without a non-NULL default, and a
-- sentinel default is unsafe here because Riot EventID 0 is a real value
-- (the first GameStart is typically EventID 0). Rebuilding an empty table
-- carries zero data-migration risk and gives a hard schema-level guarantee.
--
-- Riot replays the full accumulated event list every poll (and after a
-- reconnect). EventID is unique only WITHIN a game (it restarts at 0 each
-- match), so the uniqueness key is the composite (match_id, riot_event_id);
-- the repository dedupes across polls via INSERT OR IGNORE on this index.
--
-- match_events is a pure child table (nothing references it), so dropping and
-- recreating it is FK-safe. PRAGMA foreign_keys is intentionally not toggled
-- here — migrations run inside a transaction where it would be a no-op.

DROP TABLE IF EXISTS match_events;

CREATE TABLE match_events (
  id TEXT PRIMARY KEY,
  match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  riot_event_id INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  event_time_seconds REAL NOT NULL,
  wall_clock_at INTEGER NOT NULL,
  killer_name TEXT,
  victim_name TEXT,
  assisters TEXT,
  payload TEXT,
  created_at INTEGER NOT NULL
);

-- Enforces idempotency and is the conflict target for INSERT OR IGNORE.
CREATE UNIQUE INDEX idx_events_match_eventid
  ON match_events(match_id, riot_event_id);

-- Retained from 001: lookups by match.
CREATE INDEX idx_events_match ON match_events(match_id);

-- Supports chronological timeline reads (ORDER BY event_time_seconds per match).
CREATE INDEX idx_events_match_time
  ON match_events(match_id, event_time_seconds);

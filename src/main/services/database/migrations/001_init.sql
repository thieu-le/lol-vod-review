-- Phase 1 schema. Match metadata + raw Riot snapshots + parsed events + settings.

CREATE TABLE IF NOT EXISTS matches (
  id TEXT PRIMARY KEY,
  riot_game_id INTEGER,
  champion TEXT,
  game_mode TEXT,
  map_name TEXT,
  queue_id INTEGER,
  recording_started_at INTEGER NOT NULL,
  game_started_at INTEGER,
  ended_at INTEGER,
  duration_seconds INTEGER,
  result TEXT NOT NULL DEFAULT 'Unknown',
  kills INTEGER NOT NULL DEFAULT 0,
  deaths INTEGER NOT NULL DEFAULT 0,
  assists INTEGER NOT NULL DEFAULT 0,
  vod_local_path TEXT,
  vod_status TEXT NOT NULL DEFAULT 'recording',
  youtube_video_id TEXT,
  youtube_url TEXT,
  archived_at INTEGER,
  recording_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Verbatim Riot event stream so derived data can be rebuilt later.
CREATE TABLE IF NOT EXISTS match_event_snapshots (
  id TEXT PRIMARY KEY,
  match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  raw_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- Parsed/domain events (populated in Phase 2).
CREATE TABLE IF NOT EXISTS match_events (
  id TEXT PRIMARY KEY,
  match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  event_time_seconds REAL NOT NULL,
  wall_clock_at INTEGER NOT NULL,
  killer_name TEXT,
  victim_name TEXT,
  assisters TEXT,
  payload TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS upload_jobs (
  id TEXT PRIMARY KEY,
  match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_events_match ON match_events(match_id);
CREATE INDEX IF NOT EXISTS idx_snapshots_match ON match_event_snapshots(match_id);
CREATE INDEX IF NOT EXISTS idx_matches_status ON matches(vod_status);
CREATE INDEX IF NOT EXISTS idx_matches_started ON matches(recording_started_at DESC);

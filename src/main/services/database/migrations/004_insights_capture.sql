-- 004: Insights Capture becomes the recording source (replaces OBS).
--
-- vod_offset_seconds: seconds to add to an in-game time to get its position in
-- the VOD. Measured exactly from Insights' own game-clock/video-clock pairing;
-- can be negative (Insights usually starts a few seconds after GameStart).
-- NULL for OBS-era matches, which keep using the recording/game-start delta.
ALTER TABLE matches ADD COLUMN vod_offset_seconds REAL;
ALTER TABLE matches ADD COLUMN vod_duration_seconds REAL;
ALTER TABLE matches ADD COLUMN insights_video_uuid TEXT;

-- Which game the match is from. Everything before this migration is League.
-- Valorant matches come only from Insights (there is no Valorant Live Client
-- API); their event times are on the video clock (vod_offset_seconds = 0).
ALTER TABLE matches ADD COLUMN game TEXT NOT NULL DEFAULT 'lol';

CREATE INDEX IF NOT EXISTS idx_matches_insights_video ON matches(insights_video_uuid);

-- Every Insights file the watcher has handled, so each one is processed once.
-- match_id is NULL for files that were skipped (pre-existing backlog seeded on
-- first run, highlights/clips, non-ranked games in ranked-only mode). The file
-- path is the key because the file is the unit Insights hands us.
CREATE TABLE IF NOT EXISTS insights_ingested (
  file_path TEXT PRIMARY KEY,
  match_id TEXT REFERENCES matches(id) ON DELETE SET NULL,
  outcome TEXT NOT NULL,
  detail TEXT,
  ingested_at INTEGER NOT NULL
);

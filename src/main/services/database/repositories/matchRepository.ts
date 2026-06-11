import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { Match, MatchResult, VodStatus } from '@shared/types';
import { getDb } from '../db';

// Raw row shape as stored in SQLite (snake_case).
interface MatchRow {
  id: string;
  riot_game_id: number | null;
  champion: string | null;
  game_mode: string | null;
  map_name: string | null;
  queue_id: number | null;
  recording_started_at: number;
  game_started_at: number | null;
  ended_at: number | null;
  duration_seconds: number | null;
  result: string;
  kills: number;
  deaths: number;
  assists: number;
  player_identities: string | null;
  vod_local_path: string | null;
  vod_status: string;
  youtube_video_id: string | null;
  youtube_url: string | null;
  archived_at: number | null;
  recording_error: string | null;
  created_at: number;
  updated_at: number;
}

function mapRow(r: MatchRow): Match {
  return {
    id: r.id,
    riotGameId: r.riot_game_id,
    champion: r.champion,
    gameMode: r.game_mode,
    mapName: r.map_name,
    queueId: r.queue_id,
    recordingStartedAt: r.recording_started_at,
    gameStartedAt: r.game_started_at,
    endedAt: r.ended_at,
    durationSeconds: r.duration_seconds,
    result: r.result as MatchResult,
    kills: r.kills,
    deaths: r.deaths,
    assists: r.assists,
    playerIdentities: r.player_identities ? (JSON.parse(r.player_identities) as string[]) : [],
    vodLocalPath: r.vod_local_path,
    vodStatus: r.vod_status as VodStatus,
    youtubeVideoId: r.youtube_video_id,
    youtubeUrl: r.youtube_url,
    archivedAt: r.archived_at,
    recordingError: r.recording_error,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export interface CreateMatchInput {
  recordingStartedAt: number;
  vodStatus?: VodStatus;
  recordingError?: string | null;
}

export interface MatchMetaInput {
  champion?: string | null;
  gameMode?: string | null;
  mapName?: string | null;
  queueId?: number | null;
}

export interface FinalizeMatchInput {
  endedAt: number;
  durationSeconds: number | null;
  vodLocalPath: string | null;
  vodStatus: VodStatus;
  result?: MatchResult;
  recordingError?: string | null;
}

export interface UpdateKdaInput {
  kills: number;
  deaths: number;
  assists: number;
}

export interface SetYoutubeInput {
  videoId: string;
  url: string;
}

// Repository interface — the swappable seam (sqlite today, postgres later).
export interface MatchRepository {
  create(input: CreateMatchInput): Match;
  markGameStarted(id: string, gameStartedAt: number): void;
  updateMeta(id: string, meta: MatchMetaInput): void;
  updateKda(id: string, kda: UpdateKdaInput): void;
  setPlayerIdentities(id: string, identities: string[]): void;
  finalize(id: string, input: FinalizeMatchInput): Match | null;
  setRecordingError(id: string, message: string): void;
  setVodStatus(id: string, status: VodStatus): void;
  setYoutube(id: string, input: SetYoutubeInput): void;
  markArchived(id: string, archivedAt: number, vodLocalPath: string | null): void;
  get(id: string): Match | null;
  list(limit?: number): Match[];
  listByVodStatus(status: VodStatus): Match[];
  delete(id: string): void;
}

class SqliteMatchRepository implements MatchRepository {
  constructor(private readonly db: Database.Database) {}

  create(input: CreateMatchInput): Match {
    const now = Date.now();
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO matches
           (id, recording_started_at, vod_status, recording_error, result, created_at, updated_at)
         VALUES (@id, @recording_started_at, @vod_status, @recording_error, 'Unknown', @now, @now)`
      )
      .run({
        id,
        recording_started_at: input.recordingStartedAt,
        vod_status: input.vodStatus ?? 'recording',
        recording_error: input.recordingError ?? null,
        now,
      });
    return this.get(id)!;
  }

  markGameStarted(id: string, gameStartedAt: number): void {
    this.db
      .prepare(
        'UPDATE matches SET game_started_at = ?, updated_at = ? WHERE id = ? AND game_started_at IS NULL'
      )
      .run(gameStartedAt, Date.now(), id);
  }

  // Only fills fields that are still null, so live polling never clobbers data.
  updateMeta(id: string, meta: MatchMetaInput): void {
    this.db
      .prepare(
        `UPDATE matches SET
           champion = COALESCE(champion, @champion),
           game_mode = COALESCE(game_mode, @game_mode),
           map_name = COALESCE(map_name, @map_name),
           queue_id = COALESCE(queue_id, @queue_id),
           updated_at = @now
         WHERE id = @id`
      )
      .run({
        id,
        champion: meta.champion ?? null,
        game_mode: meta.gameMode ?? null,
        map_name: meta.mapName ?? null,
        queue_id: meta.queueId ?? null,
        now: Date.now(),
      });
  }

  // Overwrites KDA with the freshly recomputed totals. Always called with the
  // full deduped event set (never summed incrementally), so reconnect replays
  // can't inflate the count.
  updateKda(id: string, kda: UpdateKdaInput): void {
    this.db
      .prepare(
        `UPDATE matches SET kills = @kills, deaths = @deaths, assists = @assists, updated_at = @now
         WHERE id = @id`
      )
      .run({ id, kills: kda.kills, deaths: kda.deaths, assists: kda.assists, now: Date.now() });
  }

  // Only set once (first non-empty observation wins); identity doesn't change
  // mid-game, so later polls never need to overwrite it.
  setPlayerIdentities(id: string, identities: string[]): void {
    if (identities.length === 0) return;
    this.db
      .prepare(
        `UPDATE matches SET player_identities = ?, updated_at = ?
         WHERE id = ? AND player_identities IS NULL`
      )
      .run(JSON.stringify(identities), Date.now(), id);
  }

  finalize(id: string, input: FinalizeMatchInput): Match | null {
    this.db
      .prepare(
        `UPDATE matches SET
           ended_at = @ended_at,
           duration_seconds = @duration_seconds,
           vod_local_path = @vod_local_path,
           vod_status = @vod_status,
           result = COALESCE(@result, result),
           recording_error = COALESCE(@recording_error, recording_error),
           updated_at = @now
         WHERE id = @id`
      )
      .run({
        id,
        ended_at: input.endedAt,
        duration_seconds: input.durationSeconds,
        vod_local_path: input.vodLocalPath,
        vod_status: input.vodStatus,
        result: input.result ?? null,
        recording_error: input.recordingError ?? null,
        now: Date.now(),
      });
    return this.get(id);
  }

  setRecordingError(id: string, message: string): void {
    this.db
      .prepare('UPDATE matches SET recording_error = ?, updated_at = ? WHERE id = ?')
      .run(message, Date.now(), id);
  }

  setVodStatus(id: string, status: VodStatus): void {
    this.db
      .prepare('UPDATE matches SET vod_status = ?, updated_at = ? WHERE id = ?')
      .run(status, Date.now(), id);
  }

  setYoutube(id: string, input: SetYoutubeInput): void {
    this.db
      .prepare(
        `UPDATE matches SET youtube_video_id = @video_id, youtube_url = @url,
           vod_status = 'uploaded', updated_at = @now
         WHERE id = @id`
      )
      .run({ id, video_id: input.videoId, url: input.url, now: Date.now() });
  }

  // Records the archive transition. vodLocalPath is updated to the new archived
  // location (or null once the file is gone) so "Open VOD" keeps working.
  markArchived(id: string, archivedAt: number, vodLocalPath: string | null): void {
    this.db
      .prepare(
        `UPDATE matches SET archived_at = @archived_at, vod_local_path = @vod_local_path,
           vod_status = 'archived', updated_at = @now
         WHERE id = @id`
      )
      .run({ id, archived_at: archivedAt, vod_local_path: vodLocalPath, now: Date.now() });
  }

  get(id: string): Match | null {
    const row = this.db.prepare('SELECT * FROM matches WHERE id = ?').get(id) as
      | MatchRow
      | undefined;
    return row ? mapRow(row) : null;
  }

  list(limit = 100): Match[] {
    const rows = this.db
      .prepare('SELECT * FROM matches ORDER BY recording_started_at DESC LIMIT ?')
      .all(limit) as MatchRow[];
    return rows.map(mapRow);
  }

  listByVodStatus(status: VodStatus): Match[] {
    const rows = this.db
      .prepare('SELECT * FROM matches WHERE vod_status = ? ORDER BY recording_started_at DESC')
      .all(status) as MatchRow[];
    return rows.map(mapRow);
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM matches WHERE id = ?').run(id);
  }
}

let instance: MatchRepository | null = null;
export function matchRepository(): MatchRepository {
  if (!instance) instance = new SqliteMatchRepository(getDb());
  return instance;
}

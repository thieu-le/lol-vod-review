import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { UploadJob, UploadJobStatus } from '@shared/types';
import { getDb } from '../db';

interface UploadJobRow {
  id: string;
  match_id: string;
  status: string;
  attempts: number;
  last_error: string | null;
  created_at: number;
  updated_at: number;
}

function mapRow(r: UploadJobRow): UploadJob {
  return {
    id: r.id,
    matchId: r.match_id,
    status: r.status as UploadJobStatus,
    attempts: r.attempts,
    lastError: r.last_error,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

// Durable upload queue backed by the upload_jobs table. The queue survives app
// restarts; an interrupted ('running') job is requeued to 'pending' on boot.
export interface UploadJobRepository {
  enqueue(matchId: string): UploadJob;
  retry(matchId: string): UploadJob | null;
  getByMatch(matchId: string): UploadJob | null;
  nextPending(): UploadJob | null;
  markRunning(id: string): void;
  markDone(id: string): void;
  markFailed(id: string, error: string): void;
  deferToPending(id: string, note: string): void;
  requeueRunning(): number;
  list(): UploadJob[];
}

class SqliteUploadJobRepository implements UploadJobRepository {
  constructor(private readonly db: Database.Database) {}

  // At most one live job per match. A pending/running job is returned as-is; a
  // previously done/failed job is reset to pending so the match re-uploads.
  enqueue(matchId: string): UploadJob {
    const existing = this.getByMatch(matchId);
    if (existing && (existing.status === 'pending' || existing.status === 'running')) {
      return existing;
    }
    if (existing) {
      this.db
        .prepare(
          `UPDATE upload_jobs SET status = 'pending', last_error = NULL, updated_at = ? WHERE id = ?`
        )
        .run(Date.now(), existing.id);
      return this.getByMatch(matchId)!;
    }
    const now = Date.now();
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO upload_jobs (id, match_id, status, attempts, created_at, updated_at)
         VALUES (?, ?, 'pending', 0, ?, ?)`
      )
      .run(id, matchId, now, now);
    return this.getByMatch(matchId)!;
  }

  retry(matchId: string): UploadJob | null {
    const existing = this.getByMatch(matchId);
    if (!existing) return null;
    this.db
      .prepare(
        `UPDATE upload_jobs SET status = 'pending', last_error = NULL, updated_at = ? WHERE id = ?`
      )
      .run(Date.now(), existing.id);
    return this.getByMatch(matchId);
  }

  getByMatch(matchId: string): UploadJob | null {
    const row = this.db
      .prepare('SELECT * FROM upload_jobs WHERE match_id = ? ORDER BY created_at DESC LIMIT 1')
      .get(matchId) as UploadJobRow | undefined;
    return row ? mapRow(row) : null;
  }

  nextPending(): UploadJob | null {
    const row = this.db
      .prepare(`SELECT * FROM upload_jobs WHERE status = 'pending' ORDER BY created_at ASC LIMIT 1`)
      .get() as UploadJobRow | undefined;
    return row ? mapRow(row) : null;
  }

  markRunning(id: string): void {
    this.db
      .prepare(`UPDATE upload_jobs SET status = 'running', updated_at = ? WHERE id = ?`)
      .run(Date.now(), id);
  }

  markDone(id: string): void {
    this.db
      .prepare(`UPDATE upload_jobs SET status = 'done', last_error = NULL, updated_at = ? WHERE id = ?`)
      .run(Date.now(), id);
  }

  markFailed(id: string, error: string): void {
    this.db
      .prepare(
        `UPDATE upload_jobs SET status = 'failed', attempts = attempts + 1, last_error = ?, updated_at = ? WHERE id = ?`
      )
      .run(error, Date.now(), id);
  }

  // Return a job to the queue without counting it as a failed attempt. Used when
  // an upload can't proceed for a transient, non-fault reason (quota spent); the
  // note is surfaced in the UI so the user knows it's waiting, not broken.
  deferToPending(id: string, note: string): void {
    this.db
      .prepare(`UPDATE upload_jobs SET status = 'pending', last_error = ?, updated_at = ? WHERE id = ?`)
      .run(note, Date.now(), id);
  }

  // Recover jobs interrupted by a crash/quit: anything left 'running' is retried.
  requeueRunning(): number {
    const info = this.db
      .prepare(`UPDATE upload_jobs SET status = 'pending', updated_at = ? WHERE status = 'running'`)
      .run(Date.now());
    return info.changes;
  }

  list(): UploadJob[] {
    const rows = this.db
      .prepare('SELECT * FROM upload_jobs ORDER BY created_at DESC')
      .all() as UploadJobRow[];
    return rows.map(mapRow);
  }
}

let instance: UploadJobRepository | null = null;
export function uploadJobRepository(): UploadJobRepository {
  if (!instance) instance = new SqliteUploadJobRepository(getDb());
  return instance;
}

import type Database from 'better-sqlite3';
import { getDb } from '../db';

// What happened to an Insights file the watcher has seen.
//  - ingested: linked to a match (and queued for upload when auto-upload is on)
//  - seeded:   already in the folder when the integration was first enabled;
//              never uploaded, so turning this on doesn't flood YouTube
//  - skipped:  not a League full-match recording, or filtered out (ranked-only)
export type IngestOutcome = 'ingested' | 'seeded' | 'skipped';

export interface InsightsIngestedRepository {
  has(filePath: string): boolean;
  record(filePath: string, outcome: IngestOutcome, matchId: string | null, detail?: string): void;
  count(): number;
}

// Windows paths are case-insensitive; normalize so "T:\Videos" and "t:\videos"
// are the same key.
function key(filePath: string): string {
  return process.platform === 'win32' ? filePath.toLowerCase() : filePath;
}

class SqliteInsightsIngestedRepository implements InsightsIngestedRepository {
  constructor(private readonly db: Database.Database) {}

  has(filePath: string): boolean {
    return (
      this.db.prepare('SELECT 1 FROM insights_ingested WHERE file_path = ?').get(key(filePath)) !==
      undefined
    );
  }

  record(filePath: string, outcome: IngestOutcome, matchId: string | null, detail?: string): void {
    this.db
      .prepare(
        `INSERT INTO insights_ingested (file_path, match_id, outcome, detail, ingested_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(file_path) DO UPDATE SET
           match_id = excluded.match_id, outcome = excluded.outcome,
           detail = excluded.detail, ingested_at = excluded.ingested_at`
      )
      .run(key(filePath), matchId, outcome, detail ?? null, Date.now());
  }

  count(): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM insights_ingested').get() as { n: number }).n;
  }
}

let instance: InsightsIngestedRepository | null = null;
export function insightsIngestedRepository(): InsightsIngestedRepository {
  if (!instance) instance = new SqliteInsightsIngestedRepository(getDb());
  return instance;
}

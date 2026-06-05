import { copyFileSync, existsSync, mkdirSync, renameSync, unlinkSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { Match } from '@shared/types';
import { paths } from '../../lib/paths';
import { createLogger } from '../../lib/logger';
import { matchRepository } from '../database/repositories/matchRepository';
import { settingsRepository } from '../database/repositories/settingsRepository';

const logger = createLogger('retention');

const ARCHIVE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

// Move across (possibly different) filesystems: rename first, fall back to
// copy+unlink when the source and destination live on different volumes.
function moveFile(src: string, dest: string): void {
  try {
    renameSync(src, dest);
  } catch {
    copyFileSync(src, dest);
    unlinkSync(src);
  }
}

// Applies the configured retention policy to a freshly-uploaded match. Never
// deletes before an upload has produced a YouTube video id — the guard below is
// the last line of defence against losing a VOD.
export function applyPostUpload(match: Match): void {
  if (!match.youtubeVideoId) return; // safety: only after a confirmed upload
  const policy = settingsRepository().getRetention();
  const path = match.vodLocalPath;
  if (!path || !existsSync(path)) return;

  if (policy === 'keep-forever') return;

  if (policy === 'delete-after-upload') {
    try {
      unlinkSync(path);
      matchRepository().setVodStatus(match.id, 'deleted');
      logger.info('Deleted local VOD after upload', match.id);
    } catch (err) {
      logger.error('Failed to delete local VOD', match.id, err);
    }
    return;
  }

  // archive-then-delete-30d: move to the archive dir and stamp archived_at.
  try {
    mkdirSync(paths.archiveDir(), { recursive: true });
    const dest = join(paths.archiveDir(), `${match.id}-${basename(path)}`);
    moveFile(path, dest);
    matchRepository().markArchived(match.id, Date.now(), dest);
    logger.info('Archived local VOD', match.id);
  } catch (err) {
    logger.error('Failed to archive local VOD', match.id, err);
  }
}

// Deletes archived VODs whose retention window has elapsed. Safe to run on every
// app start: only touches 'archived' rows with a YouTube id and an aged
// archived_at. Returns how many files were removed.
export function sweepExpired(now: number = Date.now()): number {
  let removed = 0;
  for (const m of matchRepository().listByVodStatus('archived')) {
    if (!m.youtubeVideoId) continue;
    if (m.archivedAt === null || now - m.archivedAt < ARCHIVE_RETENTION_MS) continue;
    if (m.vodLocalPath && existsSync(m.vodLocalPath)) {
      try {
        unlinkSync(m.vodLocalPath);
      } catch (err) {
        logger.error('Failed to delete expired VOD', m.id, err);
        continue;
      }
    }
    matchRepository().setVodStatus(m.id, 'deleted');
    removed += 1;
  }
  if (removed > 0) logger.info('Retention sweep removed', removed, 'file(s)');
  return removed;
}

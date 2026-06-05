import { EventEmitter } from 'node:events';
import type { Match, UploadJob } from '@shared/types';
import { createLogger } from '../../lib/logger';
import { toMessage } from '../../lib/errors';
import { matchRepository } from '../database/repositories/matchRepository';
import { eventRepository } from '../database/repositories/eventRepository';
import { settingsRepository } from '../database/repositories/settingsRepository';
import { uploadJobRepository } from '../database/repositories/uploadJobRepository';
import { applyPostUpload } from '../files/retention';
import { getAuthorizedClient } from './auth';
import { buildDescription } from './chapters';
import { uploadVideo } from './uploader';

const logger = createLogger('upload');

// "Champion KDA Result - Date", e.g. "Ahri 8/2/10 Win - 6/5/2026".
// Result is omitted while unknown; KDA reflects the recomputed match totals.
function buildTitle(match: Match): string {
  const champ = match.champion ?? 'League of Legends';
  const kda = `${match.kills}/${match.deaths}/${match.assists}`;
  const result = match.result !== 'Unknown' ? ` ${match.result}` : '';
  const date = new Date(match.recordingStartedAt).toLocaleDateString();
  return `${champ} ${kda}${result} - ${date}`;
}

// YouTube Data API quota errors (HTTP 403). When the daily quota or per-user
// upload limit is spent, the upload can't succeed again until the quota window
// resets at midnight Pacific — so we defer rather than fail the job.
function isQuotaError(err: unknown): boolean {
  const e = err as {
    code?: number | string;
    errors?: Array<{ reason?: string }>;
    response?: { status?: number; data?: { error?: { errors?: Array<{ reason?: string }> } } };
  };
  const status = Number(e?.code ?? e?.response?.status);
  const reasons = [...(e?.errors ?? []), ...(e?.response?.data?.error?.errors ?? [])].map(
    (x) => x?.reason
  );
  const quotaReasons = [
    'quotaExceeded',
    'uploadLimitExceeded',
    'dailyLimitExceeded',
    'rateLimitExceeded',
    'userRateLimitExceeded',
  ];
  if (reasons.some((r) => r && quotaReasons.includes(r))) return true;
  if (status !== 403) return false;
  const msg = toMessage(err).toLowerCase();
  return msg.includes('quota') || msg.includes('exceeded the number of videos');
}

// Epoch ms of the next midnight in America/Los_Angeles, when YouTube quota
// resets. Computed from the current PT wall clock so it tracks PST/PDT without a
// tz library; a small buffer is added by the caller.
function nextPacificMidnightMs(now = Date.now()): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(now));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  let hour = get('hour');
  if (hour === 24) hour = 0; // some runtimes emit "24" for midnight
  const secsIntoDay = hour * 3600 + get('minute') * 60 + get('second');
  const secsUntilMidnight = 24 * 3600 - secsIntoDay;
  return now + secsUntilMidnight * 1000;
}

// In-game seconds -> recording-relative seconds for chapter alignment.
function recordingOffsetSeconds(match: Match): number {
  if (!match.gameStartedAt) return 0;
  return Math.max(0, Math.round((match.gameStartedAt - match.recordingStartedAt) / 1000));
}

// Serial upload queue. Drains pending upload_jobs one at a time so a large
// upload never overlaps another. Emits 'progress' ({matchId,pct}) and 'changed'
// (match state moved — renderer should refresh).
export class UploadController extends EventEmitter {
  private processing = false;
  // While quota is spent, the queue is paused until this epoch-ms instant
  // (the next Pacific midnight). Pending jobs wait and drain oldest-first then.
  private pausedUntil = 0;
  private resumeTimer: NodeJS.Timeout | null = null;

  start(): void {
    // Recover jobs interrupted by a crash/quit, then drain.
    uploadJobRepository().requeueRunning();
    void this.pump();
  }

  // True while the queue is paused waiting for the daily quota to reset.
  private isPaused(): boolean {
    return this.pausedUntil > Date.now();
  }

  // Pause the queue until YouTube's quota resets at midnight Pacific, then
  // auto-resume. Re-entrant: repeated quota hits just keep the same window.
  private pauseUntilQuotaReset(): void {
    const resumeAt = nextPacificMidnightMs() + 60_000; // small buffer past midnight
    this.pausedUntil = resumeAt;
    if (this.resumeTimer) clearTimeout(this.resumeTimer);
    const delay = Math.max(0, resumeAt - Date.now());
    logger.warn(
      `YouTube quota reached; pausing uploads until ${new Date(resumeAt).toISOString()} ` +
        `(${Math.round(delay / 60000)} min)`
    );
    this.resumeTimer = setTimeout(() => {
      this.resumeTimer = null;
      this.pausedUntil = 0;
      logger.info('Quota window reset; resuming uploads');
      void this.pump();
    }, delay);
  }

  enqueueIfAuto(matchId: string): void {
    if (settingsRepository().getUploadMode() !== 'auto') return;
    this.enqueue(matchId);
  }

  enqueue(matchId: string): void {
    uploadJobRepository().enqueue(matchId);
    this.emit('changed');
    void this.pump();
  }

  retry(matchId: string): void {
    uploadJobRepository().retry(matchId);
    this.emit('changed');
    void this.pump();
  }

  getJobForMatch(matchId: string): UploadJob | null {
    return uploadJobRepository().getByMatch(matchId);
  }

  private async pump(): Promise<void> {
    if (this.processing || this.isPaused()) return;
    this.processing = true;
    try {
      let job = uploadJobRepository().nextPending();
      while (job && !this.isPaused()) {
        await this.runJob(job);
        job = uploadJobRepository().nextPending();
      }
    } finally {
      this.processing = false;
    }
  }

  private async runJob(job: UploadJob): Promise<void> {
    const jobs = uploadJobRepository();
    const matches = matchRepository();
    jobs.markRunning(job.id);

    const match = matches.get(job.matchId);
    if (!match) {
      jobs.markFailed(job.id, 'Match not found');
      return;
    }
    if (!match.vodLocalPath) {
      jobs.markFailed(job.id, 'No local recording to upload');
      matches.setVodStatus(match.id, 'failed');
      this.emit('changed');
      return;
    }

    try {
      const auth = getAuthorizedClient();
      matches.setVodStatus(match.id, 'uploading');
      this.emit('changed');

      const events = eventRepository().listForMatch(match.id);
      const { description } = buildDescription(events, recordingOffsetSeconds(match));

      const result = await uploadVideo(
        auth,
        { filePath: match.vodLocalPath, title: buildTitle(match), description },
        (pct) => this.emit('progress', { matchId: match.id, pct })
      );

      matches.setYoutube(match.id, { videoId: result.videoId, url: result.url });
      jobs.markDone(job.id);

      // Re-fetch so the retention guard sees the stored YouTube id before any
      // local deletion happens.
      const uploaded = matches.get(match.id);
      if (uploaded) applyPostUpload(uploaded);

      this.emit('changed');
      logger.info('Uploaded match', match.id, '->', result.url);
    } catch (err) {
      const msg = toMessage(err);
      if (isQuotaError(err)) {
        // Quota for the day is spent — this isn't a real failure. Keep the job
        // pending (don't burn an attempt) and pause the queue; it resumes at the
        // next Pacific-midnight reset and drains oldest-first, catching up over
        // days. Reset the match to its clean pre-upload state, not 'failed'.
        jobs.deferToPending(job.id, `Waiting for YouTube quota reset: ${msg}`);
        matches.setVodStatus(match.id, 'recorded');
        this.pauseUntilQuotaReset();
        this.emit('changed');
        logger.warn('Upload deferred (quota)', match.id, msg);
        return;
      }
      jobs.markFailed(job.id, msg);
      matches.setVodStatus(match.id, 'failed');
      this.emit('changed');
      logger.error('Upload failed', match.id, msg);
    }
  }
}

export const uploadController = new UploadController();

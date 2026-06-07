import { EventEmitter } from 'node:events';
import type {
  Match,
  MatchResult,
  ObsConnectionState,
  RecorderState,
  RecorderStatus,
} from '@shared/types';
import { config } from '../../lib/config';
import { createLogger } from '../../lib/logger';
import { toMessage } from '../../lib/errors';
import { obsClient } from '../obs/obsClient';
import { riotLiveClient, resolveActiveChampion } from '../riot/liveClient';
import type { LiveAllGameData } from '../riot/liveClient';
import { lcuClient } from '../riot/lcuClient';
import { parseEvents, computeKda, activePlayerIdentities } from '../riot/eventParser';
import { settingsRepository } from '../database/repositories/settingsRepository';
import { matchRepository } from '../database/repositories/matchRepository';
import { eventRepository } from '../database/repositories/eventRepository';
import { eventSnapshotRepository } from '../database/repositories/eventSnapshotRepository';
import { decideTransition } from './matchStateMachine';

const logger = createLogger('recorder');

// Orchestrates: poll Riot -> drive OBS record start/stop -> persist match rows.
// Emits 'status' (RecorderStatus), 'matchStarted' (Match), 'matchEnded' (Match).
export class RecorderController extends EventEmitter {
  private state: RecorderState = 'idle';
  private currentMatchId: string | null = null;
  private consecutiveFailures = 0;
  private lastError: string | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private ticking = false;
  // Set when ranked-only mode tells us to skip the current (non-ranked) game.
  // We then wait, debounced, for that game to end before recording can resume.
  private ignoringGame = false;

  start(): void {
    // Keep OBS connected and start polling Riot.
    void obsClient.start();
    obsClient.on('stateChanged', () => this.emitStatus());
    this.scheduleTick(0);
    logger.info('RecorderController started');
  }

  stop(): void {
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.pollTimer = null;
    void obsClient.stop();
  }

  getStatus(): RecorderStatus {
    return {
      state: this.state,
      obs: obsClient.getState() as ObsConnectionState,
      currentMatchId: this.currentMatchId,
      lastError: this.lastError,
    };
  }

  // Manual overrides exposed via IPC.
  async startManual(): Promise<void> {
    if (this.state === 'idle') await this.beginMatch();
  }
  async stopManual(): Promise<void> {
    if (this.state === 'in_game') await this.endMatch();
  }

  private scheduleTick(delay: number = config.recorder.pollIntervalMs): void {
    this.pollTimer = setTimeout(() => void this.tick(), delay);
  }

  private async tick(): Promise<void> {
    if (this.ticking) {
      this.scheduleTick();
      return;
    }
    this.ticking = true;
    try {
      const gameActive = await riotLiveClient.isGameActive();

      // Ranked-only: once we've decided to skip a game, just wait (debounced)
      // for it to end so we don't re-query the client API every poll.
      if (this.ignoringGame) {
        if (gameActive) {
          this.consecutiveFailures = 0;
        } else if (++this.consecutiveFailures >= config.recorder.endDebounceFailures) {
          this.ignoringGame = false;
          this.consecutiveFailures = 0;
          logger.info('Ignored (non-ranked) game ended; recorder back to idle');
        }
        return;
      }

      // Gate a fresh game on the ranked-only setting before starting a match.
      if (this.state === 'idle' && gameActive && (await this.shouldSkipGame())) {
        this.ignoringGame = true;
        this.consecutiveFailures = 0;
        return;
      }

      // While in a game, capture data each poll.
      if (this.state === 'in_game' && gameActive && this.currentMatchId) {
        await this.captureDuringGame(this.currentMatchId);
      }

      const decision = decideTransition({
        state: this.state,
        gameActive,
        consecutiveFailures: this.consecutiveFailures,
        endDebounceFailures: config.recorder.endDebounceFailures,
      });

      this.consecutiveFailures = decision.resetFailures
        ? 0
        : this.consecutiveFailures + 1;

      if (decision.action === 'startMatch') {
        await this.beginMatch();
      } else if (decision.action === 'endMatch') {
        await this.endMatch();
      }
    } catch (err) {
      this.lastError = toMessage(err);
      logger.error('tick error', err);
      this.emitStatus();
    } finally {
      this.ticking = false;
      this.scheduleTick();
    }
  }

  // Ranked-only gate. Returns true only on a POSITIVE non-ranked determination.
  // If the League client API can't be reached we record anyway, so a flaky
  // client never causes a ranked game to be silently missed.
  private async shouldSkipGame(): Promise<boolean> {
    if (!settingsRepository().getRankedOnly()) return false;
    const queue = await lcuClient.getCurrentQueue();
    if (queue === null) {
      logger.warn('Ranked-only on, but League client queue is unknown; recording anyway');
      return false;
    }
    if (!queue.isRanked) {
      logger.info(`Ranked-only: skipping non-ranked queue (${queue.queueId ?? '?'})`);
      return true;
    }
    return false;
  }

  private async beginMatch(): Promise<void> {
    const now = Date.now();
    const match = matchRepository().create({ recordingStartedAt: now });
    this.currentMatchId = match.id;
    this.state = 'in_game';
    this.consecutiveFailures = 0;
    this.lastError = null;
    logger.info('Match started', match.id);

    // Drive OBS. If OBS is down, keep the metadata row and flag the error.
    try {
      if (obsClient.isConnected()) {
        await obsClient.startRecording();
      } else {
        matchRepository().setRecordingError(match.id, 'OBS not connected at game start');
        logger.warn('OBS not connected; recording not started');
      }
    } catch (err) {
      matchRepository().setRecordingError(match.id, toMessage(err));
      logger.error('startRecording failed', err);
    }

    this.emit('matchStarted', matchRepository().get(match.id));
    this.emitStatus();
  }

  private async endMatch(): Promise<void> {
    const matchId = this.currentMatchId;
    this.state = 'post_game';
    this.emitStatus();
    if (!matchId) {
      this.state = 'idle';
      return;
    }

    const endedAt = Date.now();
    const existing = matchRepository().get(matchId);
    const durationSeconds = existing?.gameStartedAt
      ? Math.round((endedAt - existing.gameStartedAt) / 1000)
      : existing
        ? Math.round((endedAt - existing.recordingStartedAt) / 1000)
        : null;

    let vodLocalPath: string | null = null;
    let recordingError: string | null = null;
    try {
      if (obsClient.isConnected() && (await obsClient.isRecording())) {
        vodLocalPath = await obsClient.stopRecording();
      }
    } catch (err) {
      recordingError = toMessage(err);
      logger.error('stopRecording failed', err);
    }

    const finalized = matchRepository().finalize(matchId, {
      endedAt,
      durationSeconds,
      vodLocalPath,
      vodStatus: 'recorded',
      recordingError,
    });

    logger.info('Match ended', matchId, 'vod:', vodLocalPath ?? '(none)');
    this.currentMatchId = null;
    this.state = 'idle';
    this.consecutiveFailures = 0;
    if (finalized) this.emit('matchEnded', finalized);
    this.emitStatus();
  }

  // Snapshot raw events + backfill light metadata (champion, mode, gameStartedAt).
  private async captureDuringGame(matchId: string): Promise<void> {
    const all = await riotLiveClient.getAllGameData();
    if (!all) return;

    // Persist the verbatim payload for later reprocessing.
    eventSnapshotRepository().append(matchId, JSON.stringify(all));

    const events = all.events?.Events ?? [];

    // Parse + persist structured events (idempotent across polls/reconnects),
    // then recompute KDA over the full deduped set — never summed incrementally,
    // so reconnect replays can't inflate the totals.
    const parsed = parseEvents(events);
    eventRepository().appendEvents(matchId, parsed);
    const kda = computeKda(parsed, activePlayerIdentities(all.activePlayer));
    matchRepository().updateKda(matchId, kda);

    const match = matchRepository().get(matchId);
    if (!match) return;

    // Backfill light metadata while it's still missing (champion can take a
    // few polls to appear in allPlayers as the game loads).
    if (match.champion === null || match.gameMode === null) {
      matchRepository().updateMeta(matchId, {
        champion: resolveActiveChampion(all),
        gameMode: all.gameData?.gameMode ?? null,
        mapName: all.gameData?.mapName ?? null,
      });
    }

    // Mark game start the first time we see the GameStart event.
    if (match.gameStartedAt === null) {
      const gameStart = events.find((e) => e.EventName === 'GameStart');
      if (gameStart) {
        // Approximate wall-clock GameStart = now - in-game elapsed seconds.
        const elapsed = all.gameData?.gameTime ?? 0;
        matchRepository().markGameStarted(matchId, Date.now() - Math.round(elapsed * 1000));
      }
    }

    this.maybeBackfillMeta(matchId, match, all, events.some((e) => e.EventName === 'GameEnd') ? events : undefined);
  }

  private maybeBackfillMeta(
    matchId: string,
    match: Match,
    all: LiveAllGameData,
    endEvents?: { EventName: string; Result?: string }[]
  ): void {
    let result: MatchResult | undefined;
    if (endEvents) {
      const end = endEvents.find((e) => e.EventName === 'GameEnd');
      if (end?.Result === 'Win') result = 'Win';
      else if (end?.Result === 'Lose') result = 'Lose';
    }

    // Phase 1 keeps this light: only persist result when GameEnd is seen.
    // Champion/mode/KDA backfill is fleshed out in Phase 2's event parser.
    if (result && match.result === 'Unknown') {
      matchRepository().finalize(matchId, {
        endedAt: match.endedAt ?? Date.now(),
        durationSeconds: match.durationSeconds,
        vodLocalPath: match.vodLocalPath,
        vodStatus: match.vodStatus,
        result,
      });
    }
    void all;
  }

  private emitStatus(): void {
    this.emit('status', this.getStatus());
  }
}

export const recorderController = new RecorderController();

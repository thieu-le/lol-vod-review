import type { BackfillSummary } from '@shared/ipc-contract';
import { createLogger } from '../../lib/logger';
import type { LiveAllGameData } from '../riot/liveClient';
import { resolveActiveChampion } from '../riot/liveClient';
import { parseEvents, computeKda, activePlayerIdentities } from '../riot/eventParser';
import type { ParsedEvent } from '../riot/eventParser';
import { matchRepository } from '../database/repositories/matchRepository';
import { eventRepository } from '../database/repositories/eventRepository';
import { eventSnapshotRepository } from '../database/repositories/eventSnapshotRepository';

const logger = createLogger('backfill');

function parseSnapshot(raw: string): LiveAllGameData | null {
  try {
    return JSON.parse(raw) as LiveAllGameData;
  } catch {
    return null;
  }
}

// Reprocesses a single match's stored snapshots: re-parses every captured
// payload, re-persists structured events (idempotent), and recomputes KDA,
// champion/mode/map, and result. Safe to run repeatedly — the same parser and
// INSERT OR IGNORE dedup that run live are reused here.
export function retroBackfillMatch(matchId: string): number {
  const snapshots = eventSnapshotRepository().listForMatch(matchId);
  if (snapshots.length === 0) return 0;

  // Union events across all snapshots, deduped by EventID. The full accumulated
  // set is what KDA must be computed over (never summed per snapshot).
  const byEventId = new Map<number, ParsedEvent>();
  let last: LiveAllGameData | null = null;
  for (const raw of snapshots) {
    const all = parseSnapshot(raw);
    if (!all) continue;
    last = all;
    for (const e of parseEvents(all.events?.Events ?? [])) {
      if (!byEventId.has(e.eventId)) byEventId.set(e.eventId, e);
    }
  }

  const events = [...byEventId.values()];
  const inserted = eventRepository().appendEvents(matchId, events);

  const match = matchRepository().get(matchId);
  if (!match) return inserted;

  // Recompute KDA from the full deduped set using the latest known identity.
  const identities = activePlayerIdentities(last?.activePlayer);
  if (identities.length > 0) {
    matchRepository().updateKda(matchId, computeKda(events, identities));
    matchRepository().setPlayerIdentities(matchId, identities);
  }

  // Backfill light metadata (COALESCE in updateMeta preserves existing values).
  if (last) {
    matchRepository().updateMeta(matchId, {
      champion: resolveActiveChampion(last),
      gameMode: last.gameData?.gameMode ?? null,
      mapName: last.gameData?.mapName ?? null,
    });
  }

  // Set result from GameEnd if still Unknown.
  if (match.result === 'Unknown') {
    const end = events.find((e) => e.eventType === 'GameEnd');
    const r = end?.payload.Result;
    const result = r === 'Win' ? 'Win' : r === 'Lose' ? 'Lose' : undefined;
    if (result) {
      matchRepository().finalize(matchId, {
        endedAt: match.endedAt ?? Date.now(),
        durationSeconds: match.durationSeconds,
        vodLocalPath: match.vodLocalPath,
        vodStatus: match.vodStatus,
        result,
      });
    }
  }

  return inserted;
}

// Reprocesses every match. Returns counts for UI feedback.
export function retroBackfillAll(): BackfillSummary {
  const matches = matchRepository().list(1000);
  let eventsInserted = 0;
  for (const m of matches) {
    eventsInserted += retroBackfillMatch(m.id);
  }
  logger.info('Retro-backfill complete', matches.length, 'matches,', eventsInserted, 'events');
  return { matchesProcessed: matches.length, eventsInserted };
}

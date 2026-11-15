import type { Match } from './types';

// Converts in-game seconds to a position in the VOD. Shared by the chapter
// builder (main) and the timeline/seek UI (renderer) so they can never drift.
//
//   vodSeconds = gameSeconds + vodOffsetSeconds(match)
//
// Preferred source is the measured offset stored at ingest (Insights Capture
// records the game clock against its own video clock, so it is exact). Older
// OBS-era matches have no stored offset; for those the offset is the pre-game
// buffer between record start and GameStart, as before.
export function vodOffsetSeconds(
  match: Pick<Match, 'vodOffsetSeconds' | 'gameStartedAt' | 'recordingStartedAt'>
): number {
  if (match.vodOffsetSeconds !== null && Number.isFinite(match.vodOffsetSeconds)) {
    return match.vodOffsetSeconds;
  }
  if (!match.gameStartedAt) return 0;
  return Math.max(0, (match.gameStartedAt - match.recordingStartedAt) / 1000);
}

// Total VOD length in seconds, for laying out timeline markers.
export function vodSpanSeconds(
  match: Pick<
    Match,
    | 'vodDurationSeconds'
    | 'vodOffsetSeconds'
    | 'gameStartedAt'
    | 'recordingStartedAt'
    | 'endedAt'
    | 'durationSeconds'
  >
): number {
  if (match.vodDurationSeconds !== null && match.vodDurationSeconds > 0) {
    return match.vodDurationSeconds;
  }
  if (match.vodOffsetSeconds === null && match.endedAt) {
    return Math.max(1, Math.round((match.endedAt - match.recordingStartedAt) / 1000));
  }
  return Math.max(1, vodOffsetSeconds(match) + (match.durationSeconds ?? 0));
}

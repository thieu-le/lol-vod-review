// Static configuration knobs for the recorder pipeline.

export const config = {
  // Riot Live Client API
  riot: {
    baseUrl: 'https://127.0.0.1:2999/liveclientdata',
    host: '127.0.0.1',
    port: 2999,
    requestTimeoutMs: 2000,
  },
  // Match detection poll loop
  recorder: {
    pollIntervalMs: 1000,
    // Consecutive failed polls (while in-game) before declaring game end.
    // Debounces transient Live Client blips / reconnects.
    endDebounceFailures: 5,
  },
  // Insights Capture folder watcher
  insights: {
    scanIntervalMs: 20_000,
    // A file must be unchanged (size + mtime) for this long before we touch it.
    quietMs: 20_000,
    // If Insights' database never lists the file (DB unreadable, schema
    // changed), ingest anyway once it has been quiet this long.
    noDbQuietMs: 10 * 60_000,
    // Match a live-tracked League game to its recording: Live Client detection
    // (loading screen) happens before Insights starts recording.
    matchWindowBeforeMs: 10 * 60_000,
    matchWindowAfterMs: 5 * 60_000,
  },
} as const;

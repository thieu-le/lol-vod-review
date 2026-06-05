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
  // OBS WebSocket reconnect backoff
  obs: {
    reconnectBaseMs: 1000,
    reconnectMaxMs: 30000,
  },
} as const;

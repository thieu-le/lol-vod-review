import { useCallback, useEffect, useState } from 'react';
import type { Match, RecorderStatus } from '@shared/types';

// Subscribes to recorder status + keeps a live match list in sync with push events.
export function useRecorder() {
  const [status, setStatus] = useState<RecorderStatus | null>(null);
  const [matches, setMatches] = useState<Match[]>([]);

  const refreshMatches = useCallback(async () => {
    setMatches(await window.api.matches.list(100));
  }, []);

  useEffect(() => {
    void window.api.recorder.getStatus().then(setStatus);
    void refreshMatches();

    const offStatus = window.api.recorder.onStatusChanged(setStatus);
    const offStarted = window.api.recorder.onMatchStarted(() => void refreshMatches());
    const offEnded = window.api.recorder.onMatchEnded(() => void refreshMatches());

    return () => {
      offStatus();
      offStarted();
      offEnded();
    };
  }, [refreshMatches]);

  return { status, matches, refreshMatches };
}

import { useCallback, useEffect, useState } from 'react';
import type { Match, MatchEvent } from '@shared/types';

// Loads a single match plus its parsed event timeline.
export function useMatch(matchId: string) {
  const [match, setMatch] = useState<Match | null>(null);
  const [events, setEvents] = useState<MatchEvent[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const [m, ev] = await Promise.all([
      window.api.matches.get(matchId),
      window.api.matches.getEvents(matchId),
    ]);
    setMatch(m);
    setEvents(ev);
    setLoading(false);
  }, [matchId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { match, events, loading, refresh };
}

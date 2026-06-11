import { TrendingUp } from 'lucide-react';
import type { Match } from '@shared/types';

// Current win streak: consecutive wins from the most recent match downward.
// Unknown results (in-progress / unparsed) are skipped; a loss ends the streak.
function winStreak(matches: Match[]): number {
  let streak = 0;
  for (const m of matches) {
    if (m.result === 'Unknown') continue;
    if (m.result !== 'Win') break;
    streak += 1;
  }
  return streak;
}

export function WinStreakCard({ matches }: { matches: Match[] }) {
  const streak = winStreak(matches);
  if (streak < 2) return null;

  return (
    <div className="glass-card fixed bottom-6 right-6 z-10 flex items-center gap-3 px-4 py-3">
      <span className="rounded-lg bg-win/15 p-2 text-win-text">
        <TrendingUp size={16} />
      </span>
      <div>
        <div className="font-label text-[10px] uppercase tracking-widest text-gold-bright">
          Win Streak
        </div>
        <div className="font-heading text-sm font-bold text-white">{streak} Match Record</div>
      </div>
    </div>
  );
}

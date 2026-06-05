import type { RecorderState } from '@shared/types';

// Pure transition logic for the match lifecycle. No side effects — the
// controller maps these actions onto OBS/DB operations. Keeping it pure makes
// the debounce + edge behavior trivially testable.

export type RecorderAction = 'none' | 'startMatch' | 'endMatch';

export interface TransitionInput {
  state: RecorderState;
  gameActive: boolean;
  // Consecutive failed "is game active" polls observed while in_game.
  consecutiveFailures: number;
  endDebounceFailures: number;
}

export interface TransitionResult {
  action: RecorderAction;
  nextState: RecorderState;
  // Reset the failure counter after this tick?
  resetFailures: boolean;
}

export function decideTransition(input: TransitionInput): TransitionResult {
  const { state, gameActive, consecutiveFailures, endDebounceFailures } = input;

  switch (state) {
    case 'idle':
      if (gameActive) {
        return { action: 'startMatch', nextState: 'in_game', resetFailures: true };
      }
      return { action: 'none', nextState: 'idle', resetFailures: true };

    case 'in_game':
      if (gameActive) {
        return { action: 'none', nextState: 'in_game', resetFailures: true };
      }
      // Game appears gone — require N consecutive misses before ending.
      if (consecutiveFailures + 1 >= endDebounceFailures) {
        return { action: 'endMatch', nextState: 'idle', resetFailures: true };
      }
      return { action: 'none', nextState: 'in_game', resetFailures: false };

    case 'post_game':
      // Transient finalizing state; controller drives it back to idle.
      return { action: 'none', nextState: 'idle', resetFailures: true };

    default:
      return { action: 'none', nextState: 'idle', resetFailures: true };
  }
}

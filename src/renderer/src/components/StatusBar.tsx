import type { RecorderStatus } from '@shared/types';

const STATE_LABEL: Record<string, string> = {
  idle: 'Idle',
  in_game: 'Recording',
  post_game: 'Finalizing',
};

const STATE_COLOR: Record<string, string> = {
  idle: 'bg-gray-500',
  in_game: 'bg-red-500 animate-pulse',
  post_game: 'bg-yellow-500',
};

const OBS_COLOR: Record<string, string> = {
  connected: 'text-green-400',
  connecting: 'text-yellow-400',
  disconnected: 'text-red-400',
};

export function StatusBar({ status }: { status: RecorderStatus | null }) {
  const state = status?.state ?? 'idle';
  const obs = status?.obs ?? 'disconnected';

  return (
    <div className="flex items-center justify-between border-b border-edge bg-panel px-6 py-3">
      <div className="flex items-center gap-3">
        <span className={`h-3 w-3 rounded-full ${STATE_COLOR[state]}`} />
        <span className="font-semibold text-white">{STATE_LABEL[state]}</span>
      </div>
      <div className="flex items-center gap-6 text-sm">
        <span>
          OBS: <span className={OBS_COLOR[obs]}>{obs}</span>
        </span>
        {status?.lastError && (
          <span className="text-red-400" title={status.lastError}>
            ⚠ error
          </span>
        )}
      </div>
    </div>
  );
}

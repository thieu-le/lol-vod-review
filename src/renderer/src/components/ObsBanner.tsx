import type { RecorderStatus } from '@shared/types';

// Shown when OBS isn't connected: without it, games won't record. We treat
// "connecting" as transient and stay quiet, only nagging on a hard disconnect.
export function ObsBanner({
  status,
  onOpenSettings,
}: {
  status: RecorderStatus | null;
  onOpenSettings: () => void;
}) {
  const obs = status?.obs ?? 'disconnected';
  if (obs !== 'disconnected') return null;

  return (
    <div className="flex items-center justify-between gap-4 border-b border-yellow-700/40 bg-yellow-500/10 px-6 py-2 text-sm text-yellow-200">
      <span>
        <span className="font-semibold">OBS isn’t connected.</span> Games won’t record until you
        enable the OBS WebSocket server (Tools → WebSocket Server Settings) and connect here.
      </span>
      <button
        onClick={onOpenSettings}
        className="shrink-0 rounded border border-yellow-600/50 px-3 py-1 text-yellow-100 hover:bg-yellow-500/20"
      >
        Open settings
      </button>
    </div>
  );
}

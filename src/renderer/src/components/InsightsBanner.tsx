import type { RecorderStatus } from '@shared/types';

// Shown when the Insights Capture video folder can't be found: without it, no
// recordings reach the library or YouTube.
export function InsightsBanner({
  status,
  onOpenSettings,
}: {
  status: RecorderStatus | null;
  onOpenSettings: () => void;
}) {
  if (!status || status.insights.state !== 'folder_missing') return null;

  return (
    <div className="flex items-center justify-between gap-4 border-b border-yellow-700/40 bg-yellow-500/10 px-6 py-2 text-sm text-yellow-200">
      <span>
        <span className="font-semibold">Insights Capture folder not found.</span> New recordings
        won’t be picked up until the folder exists or you point Settings at the right one
        {status.insights.videoDir ? ` (looking in ${status.insights.videoDir})` : ''}.
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

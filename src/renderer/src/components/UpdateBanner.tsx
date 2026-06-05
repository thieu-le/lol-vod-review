import { useEffect, useState } from 'react';

// Shown once the main process reports a downloaded update. Offers a one-click
// restart that applies it; the app otherwise installs on the next quit anyway.
export function UpdateBanner() {
  const [version, setVersion] = useState<string | null>(null);
  const [restarting, setRestarting] = useState(false);

  useEffect(() => window.api.updater.onUpdateDownloaded(setVersion), []);

  if (!version) return null;

  return (
    <div className="flex items-center justify-between gap-3 border-b border-emerald-700 bg-emerald-900/40 px-6 py-2 text-sm text-emerald-200">
      <span>
        Update <span className="font-semibold">v{version}</span> downloaded and ready to install.
      </span>
      <div className="flex items-center gap-2">
        <button
          onClick={() => {
            setRestarting(true);
            void window.api.updater.quitAndInstall();
          }}
          disabled={restarting}
          className="rounded bg-emerald-600 px-3 py-1 font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
        >
          {restarting ? 'Restarting…' : 'Restart & update'}
        </button>
        <button
          onClick={() => setVersion(null)}
          className="rounded px-2 py-1 text-emerald-300 hover:text-white"
        >
          Later
        </button>
      </div>
    </div>
  );
}

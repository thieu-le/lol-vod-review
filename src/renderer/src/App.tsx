import { useState } from 'react';
import { useRecorder } from './hooks/useRecorder';
import { StatusBar } from './components/StatusBar';
import { MatchList } from './components/MatchList';
import { ObsSettingsCard } from './components/ObsSettingsCard';

type Tab = 'matches' | 'settings';

export default function App() {
  const { status, matches } = useRecorder();
  const [tab, setTab] = useState<Tab>('matches');
  const inGame = status?.state === 'in_game';

  return (
    <div className="flex h-full flex-col bg-ink text-gray-200">
      <StatusBar status={status} />

      <div className="flex items-center justify-between border-b border-edge px-6 py-2">
        <nav className="flex gap-1">
          {(['matches', 'settings'] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded px-3 py-1 text-sm capitalize ${
                tab === t ? 'bg-panel text-white' : 'text-gray-400 hover:text-white'
              }`}
            >
              {t}
            </button>
          ))}
        </nav>
        <div className="flex gap-2">
          <button
            onClick={() => void window.api.recorder.startManual()}
            disabled={inGame}
            className="rounded bg-red-600 px-3 py-1 text-sm text-white hover:bg-red-500 disabled:opacity-40"
          >
            Manual Start
          </button>
          <button
            onClick={() => void window.api.recorder.stopManual()}
            disabled={!inGame}
            className="rounded border border-edge px-3 py-1 text-sm text-white hover:bg-panel disabled:opacity-40"
          >
            Manual Stop
          </button>
        </div>
      </div>

      <main className="flex-1 overflow-y-auto">
        {tab === 'matches' ? (
          <MatchList matches={matches} />
        ) : (
          <div className="p-6">
            <ObsSettingsCard />
          </div>
        )}
      </main>
    </div>
  );
}

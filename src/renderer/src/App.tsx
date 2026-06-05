import { useState } from 'react';
import { useRecorder } from './hooks/useRecorder';
import { StatusBar } from './components/StatusBar';
import { ObsBanner } from './components/ObsBanner';
import { UpdateBanner } from './components/UpdateBanner';
import { MatchList } from './components/MatchList';
import { ObsSettingsCard } from './components/ObsSettingsCard';
import { RecordingSettingsCard } from './components/RecordingSettingsCard';
import { YoutubeSettingsCard } from './components/YoutubeSettingsCard';
import { MatchDetailPage } from './pages/MatchDetailPage';

type Tab = 'matches' | 'settings';

export default function App() {
  const { status, matches, refreshMatches } = useRecorder();
  const [tab, setTab] = useState<Tab>('matches');
  const [selectedMatchId, setSelectedMatchId] = useState<string | null>(null);
  const inGame = status?.state === 'in_game';

  return (
    <div className="flex h-full flex-col bg-ink text-gray-200">
      <StatusBar status={status} />
      <UpdateBanner />
      <ObsBanner status={status} onOpenSettings={() => setTab('settings')} />

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
          selectedMatchId ? (
            <MatchDetailPage
              matchId={selectedMatchId}
              onBack={() => setSelectedMatchId(null)}
              onDeleted={() => {
                setSelectedMatchId(null);
                void refreshMatches();
              }}
            />
          ) : (
            <MatchList matches={matches} onSelect={setSelectedMatchId} />
          )
        ) : (
          <div className="space-y-6 p-6">
            <ObsSettingsCard />
            <YoutubeSettingsCard />
            <RecordingSettingsCard />
          </div>
        )}
      </main>
    </div>
  );
}

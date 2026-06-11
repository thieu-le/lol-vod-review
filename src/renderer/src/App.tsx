import { useState } from 'react';
import { useRecorder } from './hooks/useRecorder';
import { Sidebar, type Tab } from './components/Sidebar';
import { TopBar } from './components/TopBar';
import { ObsBanner } from './components/ObsBanner';
import { UpdateBanner } from './components/UpdateBanner';
import { MatchList } from './components/MatchList';
import { ObsSettingsCard } from './components/ObsSettingsCard';
import { RecordingSettingsCard } from './components/RecordingSettingsCard';
import { YoutubeSettingsCard } from './components/YoutubeSettingsCard';
import { MatchDetailPage } from './pages/MatchDetailPage';

export default function App() {
  const { status, matches, refreshMatches } = useRecorder();
  const [tab, setTab] = useState<Tab>('matches');
  const [selectedMatchId, setSelectedMatchId] = useState<string | null>(null);

  function switchTab(next: Tab) {
    setTab(next);
    setSelectedMatchId(null);
  }

  return (
    <div className="flex h-full bg-ink text-gray-200">
      <Sidebar tab={tab} onTab={switchTab} status={status} />

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar status={status} />
        <UpdateBanner />
        <ObsBanner status={status} onOpenSettings={() => switchTab('settings')} />

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
              <header>
                <h1 className="font-heading text-2xl font-bold uppercase tracking-tight text-white">
                  Application Settings
                </h1>
                <p className="mt-1 text-sm text-gray-500">
                  Configure your capture pipeline, YouTube integration, and retention policies.
                </p>
              </header>
              <ObsSettingsCard />
              <YoutubeSettingsCard />
              <RecordingSettingsCard />
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

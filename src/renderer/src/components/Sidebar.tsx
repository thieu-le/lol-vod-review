import { LayoutGrid, Settings } from 'lucide-react';
import type { RecorderStatus } from '@shared/types';

export type Tab = 'matches' | 'settings';

const OBS_DOT: Record<string, string> = {
  connected: 'bg-win',
  connecting: 'bg-yellow-400',
  disconnected: 'bg-loss',
};

const OBS_LABEL: Record<string, string> = {
  connected: 'OBS connected',
  connecting: 'OBS connecting…',
  disconnected: 'OBS offline',
};

function NavItem({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`relative flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left font-label text-sm transition ${
        active
          ? 'bg-gradient-to-r from-primary/15 to-transparent text-white'
          : 'text-gray-400 hover:bg-white/5 hover:text-white'
      }`}
    >
      {active && <span className="absolute inset-y-1 left-0 w-1 rounded-full bg-primary" />}
      <span className={active ? 'text-primary' : 'text-gray-500'}>{icon}</span>
      {label}
    </button>
  );
}

export function Sidebar({
  tab,
  onTab,
  status,
}: {
  tab: Tab;
  onTab: (tab: Tab) => void;
  status: RecorderStatus | null;
}) {
  const obs = status?.obs ?? 'disconnected';

  return (
    <aside className="flex w-[220px] shrink-0 flex-col border-r border-edge bg-panel/60 backdrop-blur-md">
      <div className="px-5 pb-2 pt-6">
        <h1 className="font-heading text-[24px] font-extrabold uppercase leading-[0.95] tracking-tight text-white">
          Never Tilt
          <span className="block text-primary">Again</span>
        </h1>
        <p className="mt-2 font-label text-[10px] uppercase tracking-[0.2em] text-gray-500">
          VOD Analyst
        </p>
      </div>

      <nav className="mt-4 flex flex-col gap-1 px-3">
        <NavItem
          active={tab === 'matches'}
          icon={<LayoutGrid size={16} />}
          label="Match Library"
          onClick={() => onTab('matches')}
        />
        <NavItem
          active={tab === 'settings'}
          icon={<Settings size={16} />}
          label="Settings"
          onClick={() => onTab('settings')}
        />
      </nav>

      <div className="mt-auto border-t border-edge px-5 py-4">
        <div className="flex items-center gap-2 font-label text-xs text-gray-400">
          <span className={`h-2 w-2 rounded-full ${OBS_DOT[obs]}`} />
          {OBS_LABEL[obs]}
        </div>
      </div>
    </aside>
  );
}

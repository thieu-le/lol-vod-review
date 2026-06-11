import type { MatchEvent } from '@shared/types';

// YouTube renders chapters only when the description contains >= 3 timestamps,
// the first one is 00:00, they ascend, and each chapter is >= 10s long.
const MIN_CHAPTERS = 3;
const MIN_CHAPTER_GAP_SECONDS = 10;

// Events worth a chapter. Plain ChampionKill / TurretKilled are excluded — they
// are too frequent and would bury the meaningful moments.
const CHAPTER_LABELS: Record<string, string> = {
  GameStart: 'Game start',
  FirstBlood: 'First Blood',
  DragonKill: 'Dragon',
  HeraldKill: 'Rift Herald',
  BaronKill: 'Baron',
  AtakhanKill: 'Atakhan',
  InhibKilled: 'Inhibitor',
  GameEnd: 'Game end',
};

export interface ChapterLine {
  atSeconds: number;
  label: string;
}

export interface BuiltDescription {
  description: string;
  chapterCount: number;
}

// mm:ss, or h:mm:ss past an hour. Seconds always two digits; minutes two
// digits only when an hour component is present (YouTube accepts both).
export function formatTimestamp(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const ss = String(sec).padStart(2, '0');
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${ss}`;
  return `${m}:${ss}`;
}

function labelFor(e: MatchEvent): string | null {
  const base = CHAPTER_LABELS[e.eventType];
  if (!base) return null;
  if (e.killerName && (e.eventType === 'DragonKill' || e.eventType === 'BaronKill')) {
    return `${base} (${e.killerName})`;
  }
  if (e.eventType === 'FirstBlood' && e.killerName) {
    return `${base} — ${e.killerName}`;
  }
  return base;
}

// Convert match events into ordered, spacing-valid chapter lines.
// `offsetSeconds` shifts in-game time to recording-relative time
// (offset = (gameStartedAt - recordingStartedAt) / 1000).
export function buildChapterLines(events: MatchEvent[], offsetSeconds: number): ChapterLine[] {
  const candidates: ChapterLine[] = [];
  for (const e of events) {
    const label = labelFor(e);
    if (!label) continue;
    candidates.push({ atSeconds: Math.max(0, offsetSeconds + e.eventTimeSeconds), label });
  }
  candidates.sort((a, b) => a.atSeconds - b.atSeconds);

  // YouTube requires the first chapter at 0:00. Always anchor one there.
  const lines: ChapterLine[] = [{ atSeconds: 0, label: 'Game start' }];
  // A captured GameStart becomes that anchor rather than a second "Game start"
  // line a few seconds in (the pre-game buffer is absorbed into chapter one).
  if (candidates.length > 0 && candidates[0].label === 'Game start') {
    candidates.shift();
  }
  for (const c of candidates) {
    const last = lines[lines.length - 1];
    if (!last) {
      lines.push(c);
      continue;
    }
    // Skip chapters that would violate the minimum length. Keep the existing
    // one (chronologically first) rather than the later duplicate.
    if (c.atSeconds - last.atSeconds >= MIN_CHAPTER_GAP_SECONDS) {
      lines.push(c);
    }
  }
  return lines;
}

// Build the full YouTube description. When too few valid chapters exist we omit
// timestamps entirely (YouTube would ignore a <3 set anyway) and return a plain
// description so the upload still succeeds.
export function buildDescription(events: MatchEvent[], offsetSeconds: number): BuiltDescription {
  const lines = buildChapterLines(events, offsetSeconds);
  const footer = 'Recorded automatically with Never Tilt Again.';

  if (lines.length < MIN_CHAPTERS) {
    return { description: footer, chapterCount: 0 };
  }

  const body = lines.map((l) => `${formatTimestamp(l.atSeconds)} ${l.label}`).join('\n');
  return { description: `${body}\n\n${footer}`, chapterCount: lines.length };
}

// Maps a match to artwork URLs for the library cards and detail header.
//
// Champion art comes from Riot's Data Dragon CDN. We deliberately use the
// *versionless* splash/loading-art endpoints (under /cdn/img/champion/...),
// which are stable across patches — so there's no Data Dragon version string to
// keep in sync, and no extra network call to discover the latest patch. Only the
// square-icon endpoint is version-pinned, which we avoid for that reason.
//
// Once a match has been uploaded to YouTube, we switch the card to the real
// YouTube thumbnail (i.ytimg.com) so it matches what the user sees on YouTube.

import type { Match } from '@shared/types';

const DDRAGON = 'https://ddragon.leagueoflegends.com/cdn/img/champion';

// Data Dragon champion keys are mostly the display name with spaces/punctuation
// removed, but several are irregular (renamed, or with non-obvious casing after
// an apostrophe). Look these up explicitly; everything else falls back to a
// straight punctuation strip that preserves casing (e.g. "Miss Fortune" →
// "MissFortune", "Jarvan IV" → "JarvanIV").
const KEY_OVERRIDES: Record<string, string> = {
  wukong: 'MonkeyKing',
  nunuwillump: 'Nunu',
  renataglasc: 'Renata',
  leblanc: 'Leblanc',
  chogath: 'Chogath',
  kaisa: 'Kaisa',
  khazix: 'Khazix',
  velkoz: 'Velkoz',
  belveth: 'Belveth',
  kogmaw: 'KogMaw',
  reksai: 'RekSai',
  ksante: 'KSante',
  drmundo: 'DrMundo',
};

function lookupNormalize(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function championKey(name: string): string {
  const override = KEY_OVERRIDES[lookupNormalize(name)];
  if (override) return override;
  return name.replace(/[^a-zA-Z0-9]/g, '');
}

// Landscape key art (~16:9). Used for library cards so champion-art and YouTube
// thumbnails share the same aspect.
export function championSplashUrl(name: string): string {
  return `${DDRAGON}/splash/${championKey(name)}_0.jpg`;
}

// Portrait loading art. Used for the detail-page header portrait.
export function championLoadingUrl(name: string): string {
  return `${DDRAGON}/loading/${championKey(name)}_0.jpg`;
}

export function youtubeThumbUrl(videoId: string): string {
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}

// Best available card image for a match: the real YouTube thumbnail once
// uploaded, otherwise champion splash art, otherwise null (caller shows a
// fallback tile).
export function matchThumbUrl(match: Match): string | null {
  if (match.youtubeVideoId) return youtubeThumbUrl(match.youtubeVideoId);
  if (match.champion) return championSplashUrl(match.champion);
  return null;
}

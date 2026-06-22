// In-app player for a match VOD, rendered in an Electron <webview>.
//
// Why the watch page and not /embed/: videos uploaded through an unverified
// YouTube Data API project are not embeddable — YouTube refuses them at the
// /embed/ endpoint with player error "152", even though they play fine on their
// normal watch page. A <webview> is a real top-level browser context (not a
// third-party iframe), so the watch page plays the (Unlisted) video regardless.
//
// Because we own the guest page, we drive it directly with executeJavaScript:
//   - Seeking sets the HTML5 video's currentTime in place — no reload, no flash.
//   - Event "bookmarks" are injected as pips onto YouTube's own progress bar.
// A best-effort insertCSS pass trims the watch-page chrome down to the player.

import { useEffect, useMemo, useRef, useState } from 'react';
import type { MatchEvent } from '@shared/types';
import { describeEvent } from './EventTimeline';
import { KAD_HEX, KAD_LABEL, personalMarkers } from '../lib/playerEvents';

export interface SeekRequest {
  seconds: number;
  nonce: number;
}

// Electron's <webview> element methods we use (host → guest, allowed cross-origin).
type WebviewEl = HTMLElement & {
  insertCSS?: (css: string) => Promise<string>;
  executeJavaScript?: (code: string) => Promise<unknown>;
};

// Hides the heaviest watch-page chrome so the player is the focus. Best-effort:
// if YouTube renames these selectors the rule simply matches nothing.
const FOCUS_PLAYER_CSS = `
  #masthead-container, ytd-masthead,
  #related, #comments, #secondary, ytd-watch-metadata,
  tp-yt-app-drawer, ytd-mini-guide-renderer { display: none !important; }
  ytd-watch-flexy { --ytd-watch-flexy-max-player-width: 100vw !important; }
  html, body { overflow: hidden !important; background: #000 !important; }
`;

function fmtClock(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

// Marker colour by event category (raw hex — injected into the guest DOM, which
// has no Tailwind). Mirrors SeekerTimeline.markerColor.
function markerColorHex(t: string): string {
  if (t === 'BaronKill' || t === 'DragonKill' || t === 'HeraldKill' || t === 'AtakhanKill')
    return '#c084fc';
  if (t === 'ChampionKill' || t === 'FirstBlood' || t === 'Multikill' || t === 'Ace')
    return '#f0bf5c';
  if (t === 'TurretKilled' || t === 'InhibKilled') return '#4cd6ff';
  return '#9ca3af';
}

// Self-contained script run in the YouTube page: places one pointer-events:none
// pip per event on the native .ytp-progress-bar, positioned by recording-second
// over the real video duration. Retries until the player is ready and re-adds
// the layer if YouTube re-renders the bar (theater/resize). Never throws.
function buildMarkerScript(markers: { t: number; c: string; title: string }[]): string {
  return `(function(){try{
    var M=${JSON.stringify(markers)},ID='__ntaMarkers';
    var old=document.getElementById(ID); if(old) old.remove();
    function build(){
      var bar=document.querySelector('.ytp-progress-bar'),v=document.querySelector('video');
      if(!bar||!v||!isFinite(v.duration)||v.duration<=0) return false;
      if(document.getElementById(ID)) return true;
      var layer=document.createElement('div'); layer.id=ID;
      layer.style.cssText='position:absolute;left:0;top:0;right:0;bottom:0;pointer-events:none;z-index:60';
      for(var i=0;i<M.length;i++){var m=M[i];
        var pct=Math.max(0,Math.min(100,(m.t/v.duration)*100));
        var p=document.createElement('div'); p.title=m.title||'';
        p.style.cssText='position:absolute;top:50%;left:'+pct+'%;transform:translate(-50%,-50%);width:3px;height:13px;border-radius:2px;pointer-events:none;box-shadow:0 0 2px rgba(0,0,0,.8);background:'+m.c;
        layer.appendChild(p);
      }
      bar.appendChild(layer); return true;
    }
    if(window.__ntaIv) clearInterval(window.__ntaIv);
    var tries=0; window.__ntaIv=setInterval(function(){ if(build()||++tries>40){clearInterval(window.__ntaIv);window.__ntaIv=null;} },500);
    if(window.__ntaObs) window.__ntaObs.disconnect();
    window.__ntaObs=new MutationObserver(function(){ if(!document.getElementById(ID)) build(); });
    window.__ntaObs.observe(document.body,{childList:true,subtree:true});
  }catch(e){}})();`;
}

export function YoutubeEmbed({
  videoId,
  seek,
  events,
  identities,
  offsetSeconds,
}: {
  videoId: string;
  seek: SeekRequest | null;
  events: MatchEvent[];
  // Active player's identity strings — drives K/A/D attribution for the pips.
  identities: string[];
  // Pre-game recording buffer added to each event's game time to get its
  // position within the recording (= the uploaded video's timeline).
  offsetSeconds: number;
}) {
  const ref = useRef<WebviewEl | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  // The webview mounts once per match (key = videoId) and is never torn down to
  // seek — seeking is done in place via executeJavaScript below.
  const src = `https://www.youtube.com/watch?v=${videoId}`;
  const watchUrl = src;

  // Prefer the player's own kills/assists/deaths; fall back to all game events
  // by category when the player's identity isn't known (un-backfilled match).
  const markers = useMemo(() => {
    const personal = personalMarkers(events, identities, offsetSeconds);
    if (personal.length > 0) {
      return personal.map((p) => ({
        t: p.recSeconds,
        c: KAD_HEX[p.kind],
        title: `${fmtClock(p.gameSeconds)} · ${KAD_LABEL[p.kind]}`,
      }));
    }
    return events.map((e) => ({
      t: offsetSeconds + e.eventTimeSeconds,
      c: markerColorHex(e.eventType),
      title: `${fmtClock(e.eventTimeSeconds)} · ${describeEvent(e)}`,
    }));
  }, [events, identities, offsetSeconds]);

  // Attach guest lifecycle listeners once per video. On dom-ready: trim chrome
  // and reveal the player. On a hard navigation failure: show the fallback.
  useEffect(() => {
    setReady(false);
    setLoadError(null);
    const el = ref.current;
    if (!el) return;
    const onReady = () => {
      try {
        el.insertCSS?.(FOCUS_PLAYER_CSS);
      } catch {
        /* best-effort */
      }
      setReady(true);
    };
    const onFail = (e: Event) => {
      const ev = e as unknown as { errorCode?: number; errorDescription?: string };
      if (ev.errorCode === -3) return; // ERR_ABORTED on normal navigation
      setLoadError(ev.errorDescription || 'Could not load the player');
    };
    el.addEventListener('dom-ready', onReady);
    el.addEventListener('did-fail-load', onFail);
    return () => {
      el.removeEventListener('dom-ready', onReady);
      el.removeEventListener('did-fail-load', onFail);
    };
  }, [videoId]);

  // Inject / refresh the scrubber pips once the page is ready (and whenever the
  // marker set changes — events can arrive slightly after mount).
  useEffect(() => {
    if (!ready || markers.length === 0) return;
    void ref.current?.executeJavaScript?.(buildMarkerScript(markers)).catch(() => {});
  }, [ready, markers]);

  // Seek in place — set the video's currentTime without reloading the page.
  useEffect(() => {
    if (!seek) return;
    const t = Math.max(0, Math.floor(seek.seconds));
    const code = `(function(){var v=document.querySelector('video.html5-main-video')||document.querySelector('video');if(v){try{v.currentTime=${t};var p=v.play();if(p&&p.catch)p.catch(function(){});}catch(e){}}})()`;
    void ref.current?.executeJavaScript?.(code).catch(() => {});
  }, [seek]);

  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-lg border border-edge bg-black">
      <webview
        key={videoId}
        ref={ref}
        src={src}
        className={`h-full w-full transition-opacity duration-200 ${ready ? 'opacity-100' : 'opacity-0'}`}
        partition="persist:youtube"
        webpreferences="autoplayPolicy=no-user-gesture-required"
      />
      {loadError && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/80 p-6 text-center">
          <p className="text-sm text-gray-300">Couldn&apos;t play in-app: {loadError}</p>
          <a
            href={watchUrl}
            target="_blank"
            rel="noreferrer"
            className="rounded bg-primary px-3 py-1.5 text-sm font-medium text-ink hover:bg-primary-dim"
          >
            Watch on YouTube
          </a>
        </div>
      )}
    </div>
  );
}

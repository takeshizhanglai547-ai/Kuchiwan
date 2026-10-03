// src/core/hints.js — live-play input/performance hints (owner: lead engine). Styles: css/main.css.
//
// 1. MOUSE CAPTURE CHIP (bottom centre, live play only, never in the test harness / captures):
//      'CLICK TO AIM / クリックで照準操作'  while playing and the mouse is not captured (Pointer Lock
//                                          refused after Esc/Esc, lost on alt-tab, or still pending)
//      'DRAG TO AIM / ドラッグで照準操作'    in the drag-look fallback (lock unavailable)
//    Shown after the lock has been missing for SHOW_DELAY s (the LAUNCH click's own lock request
//    resolves well inside that), hidden at once when the lock is held.
// 2. LOW FRAME RATE CALLOUT: once per page load, when the rendered frame rate stays under
//    LOW_FPS for LOW_FOR s (and LOW_FRAMES frames: one long hitch is not enough) of play and
//    GRAPHICS QUALITY is not LOW yet, a HUD callout points
//    at Esc -> OPTIONS -> GRAPHICS QUALITY -> LOW.
// Pure DOM; no sim state (the chip timing uses the wall clock, never the sim clock).
const SHOW_DELAY = 0.6;   // s without the lock before the chip appears
const LOW_FPS = 20;       // callout threshold (smoothed fps)
const LOW_FOR = 5;        // s below the threshold
const LOW_FRAMES = 10;    // ...and at least this many frames

export default function hintsSystem(game) {
  let el = null, en = null, jp = null, shown = '', missingSince = -1;
  let ema = 1 / 60, slowT = 0, slowN = 0, lowNoted = false, lastWall = -1;

  function setChip(kind) {
    if (kind === shown) return;
    shown = kind;
    if (!kind) { el.style.display = 'none'; return; }
    const drag = kind === 'drag';
    en.textContent = drag ? 'DRAG TO AIM' : 'CLICK TO AIM';
    jp.textContent = drag ? 'ドラッグで照準操作' : 'クリックで照準操作';
    el.classList.toggle('drag', drag);
    el.style.display = '';
  }

  return {
    name: 'hints',
    order: 905,
    init(g) {
      el = document.createElement('div');
      el.className = 'iw-aimhint';
      el.setAttribute('role', 'status');
      el.style.display = 'none';
      el.innerHTML = '<i class="iw-mouse"></i><span class="en"></span><em class="jp"></em>';
      en = el.querySelector('.en'); jp = el.querySelector('.jp');
      g.overlay.appendChild(el);
    },
    reset() { missingSince = -1; setChip(''); },
    frame() {
      const g = game, inp = g.input;
      const live = !g.manual && !g.params.test;
      const playing = g.state === 'playing';
      // ---- mouse capture chip
      if (live && playing && inp.wantPointerLock && !inp.pointerLocked) {
        const now = performance.now() / 1000; // wall clock: UI timing only, never the sim
        if (missingSince < 0) missingSince = now;
        setChip(now - missingSince >= SHOW_DELAY ? (inp.dragLook ? 'drag' : 'click') : '');
      } else { missingSince = -1; setChip(''); }
      // ---- low frame rate callout (wall-clock frame intervals: the engine clamps realDt)
      // (a hidden tab / lost focus pauses the game, which resets the measurement)
      if (!live || !playing || lowNoted) { slowT = 0; slowN = 0; lastWall = -1; return; }
      const wall = performance.now() / 1000;
      const fdt = lastWall < 0 ? 0 : Math.min(1, wall - lastWall);
      lastWall = wall;
      if (fdt <= 0) return; // first frame after (re)entering play: not a measurement
      ema += (fdt - ema) * 0.1;
      if (1 / Math.max(1e-4, ema) < LOW_FPS) { slowT += fdt; slowN++; } else { slowT = 0; slowN = 0; }
      const q = g.pipeline && g.pipeline.quality;
      if (slowT >= LOW_FOR && slowN >= LOW_FRAMES && q && q !== 'low') {
        lowNoted = true;
        g.hud.callout('LOW FRAME RATE · SET GRAPHICS QUALITY TO LOW', '動作が重いとき：Esc → OPTIONS → 画質を LOW に', 'info', 6);
      }
    },
    /** Debug / tests: what the chip currently shows ('' | 'click' | 'drag'). */
    get chip() { return shown; },
    dispose() { if (el && el.parentNode) el.parentNode.removeChild(el); },
  };
}

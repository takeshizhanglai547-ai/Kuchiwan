// src/ui/hud.js — HTML overlay HUD (owner: mission/HUD designer). Styles: css/ui.css.
//
// Layout (design px at 1280x720; everything scales with --u, see css/ui.css):
//   .hud-compass     top centre: heading tape, enemy blips, objective bearing
//   .hud-boss        top centre: rival rig name, long AP bar (+ damage ghost), STAGGER bar
//   .hud-objective   top left: phase, objective EN/JP, progress pips, mission clock
//   .hud-log         under the objective: kill confirmations
//   .hud-center      reticle, FCS lock frame, hit markers, damage-direction arcs
//   .hud-weapon[data-slot=LB|RB|L|R]  weapon blocks at the FCS frame corners
//                    (ammo, reserve, reload/cooldown bar, missile lock pips, fire flash)
//   .hud-spd / .hud-alt   speed and altitude, left / right of the FCS frame
//   .hud-vitals      under the frame: AP number + bar, own STAGGER bar (always drawn), EN bar
//                    (redline; QB cooldown = 2 px amber sweep inside it), transient BOOST /
//                    ASSAULT BOOST tag (fades in + out over 1.5 s on a mode change)
//   .hud-markers     pooled enemy markers (.mk; .locked, .locking, .missile, .obj, .boss).
//                    Symbology (one symbol per state): hostile = red diamond; missile lock =
//                    4 amber corner ticks that fill clockwise (.mk-lk.n0..n4) + lock order
//                    digit; FCS target = white corner brackets only, whose corners turn amber
//                    clockwise with the missile lock (.mk-brk.n0..n4) instead of extra ticks.
//   .hud-target      readout beside the lock (name, range, AP bar, STAGGER bar). Placed by
//                    layout.js placeReadout: 8 slots around the bracket, HARD obstacles = own
//                    bracket + lock digit, other markers, reticle; SOFT = own rig, fixed HUD
//                    blocks; scored away from the nearest other marker; 4% safe margin. A slot
//                    that turns soft-blocked is held 0.35 s (readoutHold); a slot change fades
//                    out 80 ms, jumps, fades in 120 ms. When every slot collides it docks under
//                    the compass (.dock).
//   .hud-leader      1 px dog-leg leader from the readout corner to its own bracket corner
//                    Markers that fall inside a fixed HUD block fade to 35% (.mk.occl).
//   .hud-arrows      off-screen threat arrows
//   .hud-warnings    persistent alerts in 3 FIXED slots (never re-centre): left = STAGGERED /
//                    EN DEPLETED, centre = MISSILE ALERT (any enemy missile homing on the player,
//                    from launch) / LOCK WARNING (boss missile tell), right = AP CRITICAL.
//                    Chips fade in 80 ms / out 150 ms on the sim clock; only frames and chevrons blink.
//   .hud-banner      callouts (objective updates, warnings from other systems); warn/bad kinds sit
//                    on a 50% plate between hazard-stripe rules, only the rules blink
//   .hud-end         MISSION COMPLETE / FAILED end card
//   .hud-radio       handler LEDGER subtitles (EN + JP)
//   .hud-kits / .hud-sys   repair kits (bottom left) / FCS + boost mode (bottom right)
//
// API (game.hud): setVisible(bool|null), callout(text, jp, kind = 'info'|'warn'|'good'|'bad',
//   seconds), damageFrom(worldPoint), radio(key | {en, jp, hold}), endCard(status, jp),
//   setOpacity(0.5..1) (OPTIONS: HUD opacity), setSubtitles('off'|'s'|'m'|'l') (OPTIONS).
// All animation is driven by the sim clock (game.rawTime) in frame(), never by CSS keyframes,
// so staged captures are deterministic. DOM writes happen only when a value changes.
import * as THREE from 'three';
import { RADIO, SPEAKER } from './radio.js';
import { loadFonts } from './fonts.js';
import { placeReadout, readoutHold, readoutCandidate, readoutLeader, overlap, jpWrap, READOUT_DOCK } from './layout.js';

const _v = new THREE.Vector3(), _p = new THREE.Vector3(), _d = new THREE.Vector3(), _hd = new THREE.Vector3();
const _rv = new THREE.Vector3();
const SLOTS = ['LB', 'RB', 'L', 'R'];
const DEG = 180 / Math.PI;
const CMP = { ppd: 3.1, half: 210, span: 64 }; // compass: design px per degree, half width
const MARKERS = 24, ARROWS = 8, BLIPS = 16, LOG = 4, DMG = 4;
const THREAT_RANGE = 240;                   // off-screen arrows for enemies closer than this
// Internal enemy type ids -> JP names used by the kill log (ids stay 'mt', 'drone', ...).
const KIND_JP = { mt: 'ピケット', drone: 'ナット', turret: '中継ジェネレーター', boss: '敵リグ' };
const LK_CLS = ['mk-lk n0', 'mk-lk n1', 'mk-lk n2', 'mk-lk n3', 'mk-lk n4'];
const BRK_CLS = ['mk-brk n0', 'mk-brk n1', 'mk-brk n2', 'mk-brk n3', 'mk-brk n4'];
// Target readout placement (design px = rem * 10). Marker keep-out half size, readout size,
// candidate offsets from the target centre, fixed HUD blocks (centre-relative rects).
const TG = {
  w: 124, h: 50,                  // readout box (css .hud-target: 12.4rem x 5rem, border-box)
  wBoss: 60, hBoss: 20,           // boss: range tag only (name + bars live in the boss panel)
  keep: 24,                       // half size of any other marker's keep-out box (ticks + digit)
  brk: 24, pad: 6,                // own bracket half size (css .mk-brk 4.8rem) + keep-out pad
  idx: [26, 10, 36, 27],          // own lock-order digit box rel. to the target (css .mk.locked .mk-idx)
  idxBoss: [34, 18, 45, 35],      // ...on the 1.35x boss bracket
  d: 10, e: 12,                   // slot offsets = leader dog-leg: 45-degree run d, then e straight
  far: 160, step: 6,              // side-away scoring: distance cap, preference step per slot
  leaderMax: 60,                  // longest leader drawn (design px)
  // reticle ink (screen centre): ring box, side ticks bar, bottom tick (css .reticle svg)
  reticle: [[-17, -17, 17, 17], [-31, -2, 31, 2], [-2, 0, 2, 28]],
  margin: 0.04,                   // safe area
  snap: 0.05,                     // dt above which chips snap instead of fading
  gap: 0.099,                     // dt at/above which the readout re-evaluates at once (capture / stall)
  hold: 0.35,                     // keep a slot that turned soft-blocked this long (sim s)
  fadeOut: 0.08, fadeIn: 0.12,    // slot change: fade out, jump, fade in (never glide over the target)
  rigPad: 8,                      // keep-out padding around the player's projected rig box
  dockY: 92, dockW: 276,          // docked slot under the compass (60% of the boss panel width)
  dockYBoss: 140,                 // ...below the boss panel while it is shown
};
// [x0, y0, x1, y1] relative to the screen centre, in design px (see css/ui.css).
// Weapon blocks are 15rem wide but their text hugs the inner edge: the rects cover the ink.
const TG_STATIC = [
  [-280, -115, -180, -52], [180, -115, 266, -62],   // L-BACK (+ lock row) / R-BACK
  [-266, 66, -180, 115], [180, 66, 266, 115],       // L-ARM / R-ARM
  [-254, -21, -180, 18], [180, -21, 246, 18],       // SPD / ALT
  [-268, 122, 176, 212],                            // vitals (label column hangs left of the bars)
  [-372, -164, 372, -136],                          // warnings row (only while a warning shows)
  [-260, -224, 260, -164],                          // callout banner (only while shown)
];
const TG_STATIC_FIXED = 7;
const NAME_SHOW = 2.0;            // weapon model names: seconds shown after a reload / at sortie
const WN_FADE = { in: 0.08, out: 0.15 };
const RADIO_BARS = 7;
const BOOT = { delay: 0.15, step: 0.06, fade: 0.28, total: 1.2 }; // sortie boot-in (s of mission time)
// Callouts replaced by a persistent warning chip (their state is shown continuously).
const PERSISTENT = new Set(['EN DEPLETED', 'STAGGERED']);
const MK_MODS = ['locked', 'locking', 'missile', 'obj', 'boss', 'far', 'stagger', 'occl'];
const W_MODS = ['busy', 'empty', 'fire', 'locked', 'named'];
const BLIP_MODS = ['boss', 'obj'];
const ARW_MODS = ['boss', 'near'];
const TG_MODS = ['side-l', 'stagger', 'boss', 'dock'];

function el(tag, cls, parent, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  if (parent) parent.appendChild(e);
  return e;
}

export function fmtClock(t) {
  t = Math.max(0, t);
  const m = Math.floor(t / 60), s = Math.floor(t % 60), cs = Math.floor((t * 100) % 100);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}
// Formatters for num(): hoisted so the per-frame path creates no closures.
const F = {
  clock: (n) => fmtClock(n / 100),
  limit: (n) => (n > 0 ? `/ ${fmtClock(n).slice(0, 5)}` : ''),
  phase: (n) => (n ? `PHASE ${n % 100}/${(n / 100) | 0}` : ''),
  count: (n) => (n === -1 ? 'PRIORITY TARGET' : n < 0 ? '' : `${(n / 100) | 0} / ${n % 100}`),
  pad3: (n) => String(n).padStart(3, ' '),
  head: (n) => String(n).padStart(3, '0'),
  mag: (n) => (n < 0 ? '∞' : String(n).padStart(2, '0')),
  res: (n) => (n < 0 ? '' : String(n).padStart(3, '0')),
  lock: (n) => (n ? `LOCK ${n}` : 'NO LOCK'),
  times: (n) => `×${n}`,
  idx: (n) => (n > 0 ? String(n) : ''),
  dist: (n) => (n < 0 ? '' : `${n}`),
  m: (n) => `${n}m`,
  m2: (n) => `${n} m`,
};
const fmtInt = (n) => String(Math.max(0, Math.round(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const px05 = (v) => (Math.round(v) + 0.5).toFixed(1);
/** Append rect [x0, y0, x1, y1] at slot n of `arr`; returns n + 1 (no closure per frame). */
function pushRect(arr, n, x0, y0, x1, y1) { const q = n * 4; arr[q] = x0; arr[q + 1] = y0; arr[q + 2] = x1; arr[q + 3] = y1; return n + 1; }

/**
 * Voice visualiser bar levels (HUD radio + briefing comm panel). With audio running, the bars
 * follow the comm-voice level (game.audio.level(), the voice bus analyser) spread over the bars
 * with a speech-band hump; without audio (tests, muted) a deterministic speech-like envelope.
 * Attack 30 ms, release 120 ms; bars rest at 0.1. Writes `out` in place (no allocation).
 */
export function voiceLevels(out, level, live, talking, now, dt) {
  const n = out.length;
  for (let i = 0; i < n; i++) {
    const shape = 0.5 + 0.5 * Math.sin(((i + 0.5) / n) * Math.PI);
    const wob = Math.abs(Math.sin(now * (7 + i * 2.3) + i * 1.7) * Math.sin(now * 3.1 + i));
    let target = live ? Math.min(1, level * shape * (0.7 + 0.6 * wob)) : talking ? shape * (0.3 + 0.7 * wob) : 0;
    if (target < 0.1) target = 0.1;
    const tau = target > out[i] ? 0.03 : 0.12;
    out[i] = dt >= 0.05 || dt <= 0 ? target : out[i] + (target - out[i]) * (1 - Math.exp(-dt / tau));
  }
  return out;
}

export default function hudSystem(game) {
  let root, E = {};
  const cache = new Map();             // element -> {key: last written value}
  const markers = [], arrows = [], blips = [], logs = [], dmg = [];
  const bars = [];                     // ghost-bar state objects
  const banners = [];                  // callout queue
  let banner = null, bannerT = -1;
  let visible = true, forced = null;
  let W = 1280, H = 720, U = 1;
  let lastNow = 0;
  const hitFx = { t: -9, kill: false };
  const hurt = { t: -9, amt: 0 };
  const radio = { line: null, t: -9, queue: [] };
  const end = { status: '', t: -9, jp: '' };
  const objFx = { t: -9, stage: -1 };
  const wpnFlash = { LB: -9, RB: -9, L: -9, R: -9 };
  const nameT = { LB: -9, RB: -9, L: -9, R: -9 };  // weapon model name shown until nameT + NAME_SHOW
  const rig = { x0: 0, y0: 0, x1: 0, y1: 0, on: false }; // player's projected rig box (px)
  // target readout placement (see layout.js); obstacle rects are rebuilt every frame
  const tgRects = new Float32Array(4 * (MARKERS + TG_STATIC.length + 4));
  const tgOthers = new Float32Array(MARKERS * 2);
  const tgView = { x0: 0, y0: 0, x1: 0, y1: 0 };
  const tgGeo = { k: 24, d: 10, e: 12, far: 160, step: 6 };
  const tgOut = { x: 0, y: 0, side: -1, score: 0, prevHard: false, prevSoft: false, px: 0, py: 0 };
  const tgHold = { side: -1, t: 0 };                // committed slot + soft-collision timer (layout.js)
  const tgPos = { x: 0, y: 0, side: -1, actor: null, shown: false, alpha: 1 }; // displayed slot + fade
  const tgC = { x: 0, y: 0 };
  const tgLd = { x0: 0, y0: 0, x1: 0, y1: 0, x2: 0, y2: 0, len: 0 };
  const mkXY = new Float32Array(MARKERS * 2);
  const mkR = new Float32Array(MARKERS * 4);        // each marker's visible box (chevron / ticks + digit)
  const tgDbg = { n: 0, nHard: 0, tx: 0, ty: 0 };   // last placement inputs (debug / probes)
  const rdLv = new Float32Array(RADIO_BARS);   // radio visualiser bar levels (attack/release)
  let acsVis = 0;                              // own STAGGER row emphasis (sim-clock fade)
  const mode = { boost: false, ab: false, t: -9, init: false }; // transient boost-mode tag

  function set(elm, key, value) {
    let c = cache.get(elm);
    if (!c) { c = {}; cache.set(elm, c); }
    if (c[key] === value) return false;
    c[key] = value;
    if (key === 'text') elm.textContent = value;
    else if (key === 'class') elm.className = value;
    else if (key === 'html') elm.innerHTML = value;
    else if (key.charCodeAt(0) === 64) elm.setAttribute(key.slice(1), value); // '@attr'
    else elm.style[key] = value;
    return true;
  }
  /** scaleX a bar fill; quantised so tiny changes don't rewrite the DOM. */
  function fill(elm, frac, axis = 'X') {
    const q = Math.round(clamp01(frac) * 1000);
    let c = cache.get(elm);
    if (!c) { c = {}; cache.set(elm, c); }
    if (c.q === q) return;
    c.q = q;
    elm.style.transform = axis === 'X' ? `scaleX(${q / 1000})` : `scaleY(${q / 1000})`;
  }
  function num(elm, n, fmt) { // text from a number, formatted only when it changed
    let c = cache.get(elm);
    if (!c) { c = {}; cache.set(elm, c); }
    if (c.n === n) return;
    c.n = n;
    elm.textContent = fmt ? fmt(n) : String(n);
  }
  function show(elm, on) { set(elm, 'display', on ? '' : 'none'); }
  /** className from a bitmask of modifier classes; the string is built only when the mask changes. */
  function mods(elm, base, names, mask) {
    let c = cache.get(elm);
    if (!c) { c = {}; cache.set(elm, c); }
    if (c.m === mask) return;
    c.m = mask;
    let str = base;
    for (let i = 0; i < names.length; i++) if (mask & (1 << i)) str += ' ' + names[i];
    elm.className = str;
  }
  function flag(elm, cls, on) {
    let c = cache.get(elm);
    if (!c) { c = {}; cache.set(elm, c); }
    const k = 'c:' + cls;
    if (c[k] === on) return;
    c[k] = on;
    elm.classList.toggle(cls, on);
  }

  /** Bar with a lagging "damage ghost": .bar > i.ghost + i.fill (+ optional ticks). */
  function makeBar(parent, cls, ticks = 0, withGhost = true) {
    const b = el('div', `bar ${cls}`, parent);
    const ghost = withGhost ? el('i', 'ghost', b) : null, f = el('i', 'fill', b);
    if (ticks) el('i', `ticks t${ticks}`, b);
    const st = { el: b, ghost, fill: f, g: -1, v: 1, drop: -9 };
    bars.push(st);
    return st;
  }
  function barSet(st, frac, now, dt) {
    frac = clamp01(frac);
    fill(st.fill, frac);
    if (!st.ghost) return;
    if (st.g < 0) st.g = frac; // first value after a reset: no ghost
    if (frac < st.v - 1e-4) st.drop = now;
    st.v = frac;
    if (frac >= st.g) st.g = frac;
    else if (now - st.drop > 0.45) st.g = Math.max(frac, st.g - dt * 0.9);
    fill(st.ghost, st.g);
  }

  // ------------------------------------------------------------------------------ build
  function build(parent) {
    root = el('div', 'hud', parent);
    root.id = 'hud';
    E.hurt = el('div', 'hud-hurt', root);

    // compass
    const cmp = el('div', 'hud-compass', root);
    E.cmp = cmp;
    const win = el('div', 'cmp-window', cmp);
    E.cmpStrip = el('div', 'cmp-strip', win);
    const names = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
    let strip = '';
    for (let d = -180; d <= 540; d += 5) {
      const n = ((d % 360) + 360) % 360;
      const x = ((d + 180) * CMP.ppd / 10).toFixed(2); // rem (1rem = 10 design px)
      const major = n % 15 === 0;
      strip += `<i class="${names[n] !== undefined ? 'card' : major ? 'maj' : 'min'}" style="left:${x}rem"></i>`;
      if (names[n] !== undefined) strip += `<b class="${n % 90 ? 'ic' : 'c'}" style="left:${x}rem">${names[n]}</b>`;
      else if (n % 30 === 0) strip += `<b class="n" style="left:${x}rem">${String(n).padStart(3, '0')}</b>`;
    }
    E.cmpStrip.innerHTML = strip;
    E.cmpBlips = el('div', 'cmp-blips', win);
    for (let i = 0; i < BLIPS; i++) { const b = el('i', 'blip', E.cmpBlips); b.style.display = 'none'; blips.push(b); }
    E.cmpObj = el('div', 'cmp-obj', win, '<i></i><span></span>');
    E.cmpObjDist = E.cmpObj.querySelector('span');
    el('div', 'cmp-caret', cmp);
    E.cmpHead = el('div', 'cmp-heading', cmp);

    // boss
    // hierarchy: [name  JP ........ AP value] / AP bar / [STAGGER label ... state] / STAGGER bar;
    // both bars span the same width (shared edges), the stagger bar is 60% of the AP thickness
    E.boss = el('div', 'hud-boss', root);
    const bh = el('div', 'bs-head', E.boss);
    E.bsName = el('span', 'bs-name', bh);
    E.bsJp = el('span', 'bs-jp', bh);
    const bn = el('span', 'bs-ap-val', bh, '<b class="lbl">AP</b>');
    E.bsApNum = el('span', 'bs-apnum', bn);
    E.bsAp = makeBar(E.boss, 'bs-ap', 10);
    const bf = el('div', 'bs-sub', E.boss);
    el('span', 'bs-lbl', bf, 'STAGGER<em>姿勢</em>');
    E.bsState = el('span', 'bs-state', bf, 'STAGGERED<em>姿勢崩壊</em>');
    E.bsAcs = makeBar(E.boss, 'bs-acs', 0, false);
    E.boss.style.display = 'none';

    // objective + kill log share one top-left column (the log always sits under the plate)
    const tl = el('div', 'hud-tl', root);
    E.tl = tl;
    E.obj = el('div', 'hud-objective', tl);
    const oh = el('div', 'obj-head', E.obj);
    el('span', 'obj-label', oh, 'OBJECTIVE<em>作戦目標</em>');
    E.objTitle = el('div', 'obj-title', E.obj);
    E.objJp = el('div', 'obj-jp', E.obj);
    const op = el('div', 'obj-prog', E.obj);
    E.objPips = el('div', 'obj-pips', op);
    E.objCount = el('span', 'obj-count', op);
    // footer row: phase + mission clock (the phase never shares a row with the title)
    const oc = el('div', 'obj-clock', E.obj);
    E.objPhase = el('span', 'obj-phase', oc);
    el('span', 'lbl', oc, 'TIME');
    E.clock = el('span', 'clk', oc);
    E.clockLim = el('span', 'lim', oc);

    // kill log
    E.log = el('div', 'hud-log', tl);
    for (let i = 0; i < LOG; i++) {
      const l = el('div', 'log-line', E.log, '<b></b><span></span>');
      l.style.display = 'none';
      logs.push({ el: l, name: l.querySelector('b'), jp: l.querySelector('span'), t: -9 });
    }

    // markers (under the centre cluster)
    E.markers = el('div', 'hud-markers', root);
    for (let i = 0; i < MARKERS; i++) {
      const m = el('div', 'mk', E.markers,
        '<i class="mk-dia"></i><div class="mk-lk n0"><i></i><i></i><i></i><i></i></div>' +
        '<div class="mk-brk"><i></i><i></i><i></i><i></i></div><b class="mk-idx"></b><span class="mk-dist"></span>');
      m.style.display = 'none';
      markers.push({ el: m, dia: m.querySelector('.mk-dia'), lk: m.querySelector('.mk-lk'), brk: m.querySelector('.mk-brk'), idx: m.querySelector('.mk-idx'), dist: m.querySelector('.mk-dist') });
    }
    // readout: [name .... range] / AP bar + value / STAGGER bar (60% thickness, same edges) + state
    E.target = el('div', 'hud-target', root);
    const th = el('div', 'tg-head', E.target);
    E.tgName = el('span', 'tg-name', th);
    E.tgDist = el('span', 'tg-dist', th);
    const ta = el('div', 'tg-row', E.target);
    E.tgAp = makeBar(ta, 'tg-ap');
    E.tgApNum = el('span', 'tg-apnum', ta);
    const ts = el('div', 'tg-row acs', E.target);
    E.tgAcs = makeBar(ts, 'tg-acs', 0, false);
    E.tgState = el('span', 'tg-state', ts, 'STAGGER');
    E.target.style.display = 'none';
    // leader from the readout to its own bracket (1 px dog-leg, layout.js readoutLeader)
    E.leader = el('div', 'hud-leader', root, '<svg><path></path></svg>');
    E.leaderPath = E.leader.querySelector('path');
    E.leader.style.display = 'none';

    E.arrows = el('div', 'hud-arrows', root);
    for (let i = 0; i < ARROWS; i++) { const a = el('div', 'arw', E.arrows, '<i></i>'); a.style.display = 'none'; arrows.push(a); }

    // centre cluster
    const c = el('div', 'hud-center', root);
    E.center = c;
    el('div', 'fcs-frame', c, '<i class="tl"></i><i class="tr"></i><i class="bl"></i><i class="br"></i><b class="t"></b><b class="b"></b>');
    E.reticle = el('div', 'reticle', c,
      '<svg viewBox="-40 -40 80 80"><circle class="ring" r="15"></circle>' +
      '<path class="tick" d="M-30 0H-21M21 0H30M0 21V27"></path><circle class="dot" r="1.3"></circle></svg>');
    E.hit = el('div', 'hitmark', c, '<i></i><i></i><i></i><i></i>');
    E.damage = el('div', 'hud-damage', c);
    for (let i = 0; i < DMG; i++) {
      const d = el('div', 'dmg', E.damage, '<svg viewBox="-150 -150 300 300"><path class="glow" d="M-52.6 -112.8A124.5 124.5 0 0 1 52.6 -112.8"></path><path class="core" d="M-52.6 -112.8A124.5 124.5 0 0 1 52.6 -112.8"></path></svg>');
      d.style.opacity = '0';
      dmg.push({ el: d, t: -9, angle: 0 });
    }

    // weapon blocks
    E.wpn = {};
    for (const s of SLOTS) {
      const w = el('div', 'hud-weapon', root);
      w.dataset.slot = s;
      const o = { box: w };
      const hd = el('div', 'w-head', w);
      o.label = el('span', 'w-label', hd);
      o.name = el('span', 'w-name', hd);
      const am = el('div', 'w-ammo', w);
      o.mag = el('span', 'w-mag', am);
      o.res = el('span', 'w-res', am);
      o.state = el('span', 'w-state', am);
      o.bar = makeBar(w, 'w-bar', 0, false);
      if (s === 'LB') {
        const lk = el('div', 'w-locks', w);
        o.pips = [];
        for (let i = 0; i < 4; i++) o.pips.push(el('i', '', lk));
        o.lockTxt = el('span', 'w-locktxt', lk);
      }
      E.wpn[s] = o;
    }

    // speed / altitude
    const spd = el('div', 'hud-spd', root);
    E.spdBox = spd;
    E.spd = el('span', 'val', spd);
    el('span', 'unit', spd, 'km/h');
    el('span', 'lbl', spd, 'SPD');
    const alt = el('div', 'hud-alt', root);
    E.altBox = alt;
    E.alt = el('span', 'val', alt);
    el('span', 'unit', alt, 'm');
    el('span', 'lbl', alt, 'ALT');

    // vitals: ONE grid [label | bar]. One right-aligned label column (AP, STAGGER, EN) ending
    // 1.2rem left of the bars; every bar sits in column 2, so AP, STAGGER and EN share both
    // edges; the large AP number sits above the AP bar's left end. The STAGGER row is always
    // drawn (dim track + 60% label) and brightens while the gauge holds something. QB cooldown
    // = a 2 px sweep inside the EN bar; boost mode changes show as one transient tag.
    const vt = el('div', 'hud-vitals', root);
    E.vitals = vt;
    E.apNum = el('span', 'ap-num', vt);
    E.vTag = el('span', 'v-tag', vt);
    el('span', 'lbl v-l-ap', vt, 'AP');
    E.apBar = makeBar(vt, 'ap-bar', 10);
    E.acsLbl = el('span', 'lbl v-l-acs', vt, 'STAGGER<em>姿勢</em>');
    E.acsBar = makeBar(vt, 'acs-bar', 0, false);
    E.enLbl = el('span', 'lbl v-l-en', vt, 'EN');
    E.enBar = makeBar(vt, 'en-bar', 20, false);
    E.enQB = el('i', 'qb', E.enBar.el);

    // warnings
    // three FIXED slots (each 24rem; an empty slot keeps its width), chips centred in their slot
    E.warn = el('div', 'hud-warnings', root);
    const wl = el('div', 'wn-slot l', E.warn), wm = el('div', 'wn-slot m', E.warn), wr = el('div', 'wn-slot r', E.warn);
    const W_DEF = [ // [key, EN, JP, slot]; within a slot the later entry has priority
      ['en', 'EN DEPLETED', 'エネルギー切れ', wl],
      ['stagger', 'STAGGERED', '体勢崩壊', wl],
      ['lockwarn', 'LOCK WARNING', '被ロック警報', wm],
      ['missile', 'MISSILE ALERT', 'ミサイル接近', wm],
      ['ap', 'AP CRITICAL', '機体損傷', wr],
    ];
    E.wn = {};
    for (const [k, en, jp, cell] of W_DEF) {
      const w = el('div', `wn wn-${k}`, cell, `<i class="l"></i><b>${en}</b><em>${jp}</em><span class="n"></span><i class="r"></i>`);
      w.style.visibility = 'hidden'; w.style.opacity = '0';
      E.wn[k] = { el: w, n: w.querySelector('.n'), a: 0, on: false };
    }

    // callout banner + end card
    E.banner = el('div', 'hud-banner', root, '<div class="bn-rule"></div><div class="bn-plate"><i class="bn-chev l"></i><div class="bn-text"></div><div class="bn-jp"></div><div class="bn-sub"></div><i class="bn-chev r"></i></div><div class="bn-rule"></div>');
    E.bnText = E.banner.querySelector('.bn-text');
    E.bnJp = E.banner.querySelector('.bn-jp');
    E.bnSub = E.banner.querySelector('.bn-sub');
    E.banner.style.opacity = '0';
    E.end = el('div', 'hud-end', root, '<div class="end-rule"></div><div class="end-text"></div><div class="end-jp"></div><div class="end-rule"></div>');
    E.endText = E.end.querySelector('.end-text');
    E.endJp = E.end.querySelector('.end-jp');
    E.end.style.display = 'none';

    // radio
    E.radio = el('div', 'hud-radio', root);
    const rh = el('div', 'rd-head', E.radio);
    E.rdWave = el('span', 'rd-wave', rh, '<i></i>'.repeat(RADIO_BARS));
    E.rdBars = [...E.rdWave.children];
    el('span', 'rd-name', rh, `${SPEAKER.en}<em>${SPEAKER.jp}</em>`);
    el('span', 'rd-tag', rh, SPEAKER.tag);
    E.rdEn = el('div', 'rd-en', E.radio);
    E.rdJp = el('div', 'rd-jp', E.radio);
    E.radio.style.opacity = '0';

    // kits / system
    const kits = el('div', 'hud-kits', root);
    E.kits = kits;
    el('span', 'lbl', kits, 'REPAIR<em>修復キット</em>');
    E.kitPips = el('span', 'pips', kits);
    E.kitNum = el('span', 'num', kits);
    const sys = el('div', 'hud-sys', root);
    E.sysAssist = el('span', 'chip', sys, 'TARGET ASSIST');
    E.sysFcs = el('span', 'fcs', sys);
    // boot-in order at sortie: frame first, then the outer blocks, then the vitals (hud.frame)
    E.boot = [E.center, E.cmp, E.tl, E.wpn.LB, E.wpn.RB, E.spdBox, E.altBox, E.wpn.L, E.wpn.R, E.vitals, E.kits, sys].map((o) => (o && o.box) || o);
  }

  // ------------------------------------------------------------------------------ helpers
  function logKill(a) {
    let slot = logs[0];
    for (const l of logs) if (l.t < slot.t) slot = l;
    slot.t = game.rawTime;
    slot.name.textContent = `${a.name} DESTROYED`;
    slot.jp.textContent = `${KIND_JP[a.type] || ''}撃破`;
    slot.el.style.order = String(Math.round(-slot.t * 100));
  }

  /** Alert chip in its fixed slot: fade in 80 ms / out 150 ms on the sim clock (snaps after a
   *  frame gap, so captures are exact); `dim` = blink phase (frame + chevrons only). */
  function warnChip(w, on, dim, dt) {
    if (dt >= TG.snap) w.a = on ? 1 : 0;
    else w.a = on ? Math.min(1, w.a + dt / WN_FADE.in) : Math.max(0, w.a - dt / WN_FADE.out);
    const q = Math.round(w.a * 20) / 20;
    set(w.el, 'opacity', q >= 1 ? '1' : q.toFixed(2));
    set(w.el, 'visibility', q > 0 ? 'visible' : 'hidden');
    flag(w.el, 'dim', on && dim);
  }

  /** Player rig's projected screen box (px) into `rig`, padded; false when off-screen/behind. */
  function projectRig(p, cam) {
    rig.on = false;
    if (!p || !p.alive || !p.root || !p.root.visible) return false;
    const o = p.root.position, r = Math.max(2.6, (p.radius || 2) * 1.5), h = p.height || 10;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < 8; i++) {
      _rv.set(o.x + (i & 1 ? r : -r), o.y + (i & 2 ? h : 0), o.z + (i & 4 ? r : -r)).applyMatrix4(cam.matrixWorldInverse);
      if (_rv.z > -0.5) return false;
      _rv.applyMatrix4(cam.projectionMatrix);
      const x = (_rv.x * 0.5 + 0.5) * W, y = (-_rv.y * 0.5 + 0.5) * H;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    const pad = TG.rigPad * U;
    rig.x0 = x0 - pad; rig.y0 = y0 - pad; rig.x1 = x1 + pad; rig.y1 = y1 + pad; rig.on = true;
    return true;
  }

  function radioBars(barEls, lv, talking, now, dt) {
    const au = game.audio;
    const live = !!(au && au.unlocked && au.level);
    voiceLevels(lv, live ? au.level() : 0, live, talking, now, dt);
    for (let i = 0; i < barEls.length; i++) fill(barEls[i], lv[i], 'Y');
  }

  let bannerEnd = -9, radioEnd = -9;
  function nextBanner(now) {
    banner = banners.shift() || null;
    if (!banner) return;
    // Starts when it was queued (sim clock) unless another banner was still showing.
    bannerT = Math.min(now, Math.max(banner.t, bannerEnd));
    E.bnText.textContent = banner.text;
    E.bnJp.textContent = banner.jp;
    E.bnSub.textContent = banner.sub || '';
    E.banner.className = `hud-banner ${banner.kind}`;
    cache.delete(E.banner);
  }

  function nextRadio(now) {
    const line = radio.queue.shift();
    if (!line) { radio.line = null; return; }
    radio.line = line; radio.t = Math.min(now, Math.max(line._t, radioEnd));
    E.rdEn.textContent = line.en;
    E.rdJp.textContent = jpWrap(line.jp);
    if (game.audio.radio) game.audio.radio(line.hold, line); // LEDGER comm voice-over (audio lane; matched by line.en)
  }

  const api = {
    name: 'hud',
    order: 900,
    get root() { return root; },
    /** Debug / probe: last target-readout placement inputs and result (px). */
    get _readout() { return { ...tgDbg, rects: Array.from(tgRects.subarray(0, tgDbg.n * 4)), out: { ...tgOut }, hold: { ...tgHold }, pos: { ...tgPos, actor: undefined }, U, W, H }; },
    async init(g) {
      await loadFonts(g);
      build(g.overlay);
      g.hud = api;
      forced = g.params.hud; // null = automatic
      const resize = () => { W = window.innerWidth || 1280; H = window.innerHeight || 720; U = Math.min(W / 1280, H / 720); };
      resize();
      g.events.on('game:resize', resize);
      g.events.on('game:state', () => api._applyVisibility());
      g.events.on('actor:hit', (e) => {
        const p = g.player;
        if (!p) return;
        if (e.target === p) {
          if (e.result && e.result.damage > 0) { hurt.t = g.rawTime; hurt.amt = Math.min(1, 0.35 + e.result.damage / 900); }
        } else if (e.hit && e.hit.source === p && e.result && e.result.damage > 0) {
          hitFx.t = g.rawTime; hitFx.kill = !!e.result.killed;
        }
      });
      g.events.on('actor:killed', (e) => { if (e.team === 'enemy' && e.actor) logKill(e.actor); });
      g.events.on('weapon:fired', (e) => { if (e.owner === g.player && wpnFlash[e.slot] !== undefined) wpnFlash[e.slot] = g.rawTime; });
      // the weapon's model name only shows briefly after a reload (combat view: slot + ammo + bar)
      g.events.on('weapon:reloaded', (e) => { if (e.owner === g.player && nameT[e.slot] !== undefined) nameT[e.slot] = g.rawTime; });
      g.events.on('mission:stage', (e) => {
        objFx.t = g.rawTime; objFx.stage = e.stage;
        // A new phase supersedes older radio traffic (the mission queues the phase's own line
        // right after this event), so subtitles always match the current fight.
        radio.queue.length = 0;
        if (radio.line) { radio.line = null; radioEnd = g.rawTime; set(E.radio, 'opacity', '0'); }
      });
      g.events.on('mission:progress', () => { objFx.t = g.rawTime; });
      api._applyVisibility();
    },
    reset() {
      banners.length = 0; banner = null; bannerT = -1; bannerEnd = -9; radioEnd = -9;
      radio.queue.length = 0; radio.line = null; radio.t = -9;
      end.status = ''; end.t = -9;
      hitFx.t = -9; hurt.t = -9; objFx.t = -9; lastNow = 0;
      for (const k in wpnFlash) wpnFlash[k] = -9;
      // live sortie: names show during the boot-in; staged captures show the settled combat HUD
      for (const k in nameT) nameT[k] = game.manual ? -9 : game.rawTime + 0.6;
      for (const k in E.wn) { const w = E.wn[k]; w.a = 0; w.on = false; w.el.style.opacity = '0'; w.el.style.visibility = 'hidden'; }
      rig.on = false;
      for (const l of logs) { l.t = -9; l.el.style.display = 'none'; }
      for (const d of dmg) { d.t = -9; d.el.style.opacity = '0'; }
      for (const b of bars) { b.g = -1; b.v = 1; b.drop = -9; }
      tgPos.side = -1; tgPos.actor = null; tgPos.shown = false; tgPos.alpha = 1; tgHold.side = -1; tgHold.t = 0;
      rdLv.fill(0); acsVis = 0; mode.init = false; mode.t = -9;
      cache.clear();
      E.banner.style.opacity = '0'; E.radio.style.opacity = '0'; E.end.style.display = 'none';
    },
    setVisible(v) { forced = v; api._applyVisibility(); },
    /** OPTIONS: overall HUD opacity (0.5..1). */
    setOpacity(v) { if (root) root.style.opacity = v >= 0.999 ? '' : String(Math.max(0.5, Math.min(1, v))); },
    /** OPTIONS: radio subtitles 'off' | 's' | 'm' | 'l' (the speaker tag + visualiser stay). */
    setSubtitles(mode) { if (E.radio) E.radio.className = `hud-radio sub-${mode === 'off' || mode === 's' || mode === 'l' ? mode : 'm'}`; },
    _applyVisibility() {
      const st = game.state;
      const auto = st === 'playing'; // pause / results screens cover the view
      visible = forced === null || forced === undefined ? auto : forced;
      root.style.display = visible ? '' : 'none';
    },
    callout(text, jp = '', kind = 'info', seconds = 2.2) {
      if (PERSISTENT.has(text)) return; // shown by the warning chips
      banners.push({ text, jp, kind, seconds, sub: '', t: game.rawTime });
      if (banners.length > 4) banners.shift();
    },
    /** Objective banner with the new objective as a sub-line. */
    objectiveBanner(title, jp, sub, seconds = 3) {
      banners.push({ text: title, jp, kind: 'info', seconds, sub, t: game.rawTime });
    },
    radio(key) {
      const line = typeof key === 'string' ? RADIO[key] : key;
      if (!line) return;
      // (audio lane) hold the subtitle at least as long as LEDGER's recorded line + squelch tail
      const vo = game.audio.voDuration ? game.audio.voDuration(line) : 0;
      radio.queue.push({ en: line.en, jp: line.jp, hold: Math.max(line.hold, vo ? vo + 0.35 : 0), _t: game.rawTime });
      if (radio.queue.length > 3) radio.queue.shift();
    },
    endCard(status, jp) { end.status = status; end.jp = jp; end.t = game.rawTime; },
    damageFrom(point) {
      const p = game.player;
      if (!p) return;
      // Bearing relative to the aim (sim rate; the render camera may be stale between frames).
      if (p.getAimDir) p.getAimDir(_d); else game.camera.getWorldDirection(_d);
      const camYaw = Math.atan2(_d.x, _d.z);
      const hitYaw = Math.atan2(point.x - p.pos.x, point.z - p.pos.z);
      let rel = hitYaw - camYaw;
      rel = Math.atan2(Math.sin(rel), Math.cos(rel));
      let slot = dmg[0];
      for (const d of dmg) if (d.t < slot.t) slot = d;
      slot.t = game.rawTime;
      slot.angle = -rel; // screen: clockwise positive
      hurt.t = game.rawTime; hurt.amt = Math.max(hurt.amt, 0.5);
    },

    frame() {
      if (!visible || !root) return;
      const g = game, p = g.player;
      const now = g.rawTime;
      const dt = Math.min(0.1, Math.max(0, now - lastNow));
      lastNow = now;
      const blink = ((now * 5) | 0) % 2 === 0;
      const fast = ((now * 8) | 0) % 2 === 0;
      const cx = W * 0.5, cy = H * 0.5;
      const m = g.mission;
      const lock = g.lockon;
      const tgt = lock && lock.target && lock.target.alive ? lock.target : null;
      let warnOn = false;

      // ---- objective
      let objType = null;
      if (m) {
        const L = m.logic, o = L.objective();
        const active = m.status === 'active';
        objType = active && L.current ? L.current.target : null;
        set(E.objTitle, 'text', m.status === 'complete' ? 'MISSION COMPLETE' : m.status === 'failed' ? 'MISSION FAILED' : o.title);
        set(E.objJp, 'text', m.status === 'complete' ? '作戦完了' : m.status === 'failed' ? '作戦失敗' : o.jp);
        num(E.objPhase, active ? L.stages.length * 100 + L.stage + 1 : 0, F.phase);
        if (active && o.count > 1) {
          const key = o.progress * 100 + o.count;
          let c = cache.get(E.objPips); if (!c) { c = {}; cache.set(E.objPips, c); }
          if (c.h !== key) { c.h = key; E.objPips.innerHTML = '<i class="on"></i>'.repeat(o.progress) + '<i></i>'.repeat(Math.max(0, o.count - o.progress)); }
          num(E.objCount, key, F.count);
        } else {
          const key = active ? -1 : -2;
          let c = cache.get(E.objPips); if (!c) { c = {}; cache.set(E.objPips, c); }
          if (c.h !== key) { c.h = key; E.objPips.innerHTML = ''; }
          num(E.objCount, key, F.count);
        }
        num(E.clock, Math.floor(L.time * 100), F.clock);
        num(E.clockLim, L.timeLimit, F.limit);
        flag(E.obj, 'flash', now - objFx.t < 0.9 && blink);
        flag(E.obj, 'late', L.timeLimit > 0 && L.timeLimit - L.time < 60);
      }

      // ---- HUD boot-in at sortie (live play only: staged captures always show the settled HUD)
      if (m && !g.manual) {
        const t = m.logic.time;
        if (t < BOOT.total + 0.2) {
          for (let i = 0; i < E.boot.length; i++) {
            const k = clamp01((t - BOOT.delay - i * BOOT.step) / BOOT.fade);
            set(E.boot[i], 'opacity', k >= 1 ? '' : (((k * 20) | 0) / 20).toFixed(2));
          }
        }
      }

      // ---- kill log
      for (const l of logs) {
        const age = now - l.t;
        const on = age >= 0 && age < 4.5;
        show(l.el, on);
        if (on) set(l.el, 'opacity', String(age < 3.8 ? 1 : Math.max(0, (4.5 - age) / 0.7).toFixed(2)));
      }

      if (p) {
        const mo = p.motor;
        // ---- vitals
        const apF = p.ap / p.apMax;
        num(E.apNum, Math.ceil(p.ap), fmtInt);
        barSet(E.apBar, apF, now, dt);
        flag(E.vitals, 'ap-low', apF < 0.3);
        flag(E.vitals, 'ap-pulse', apF < 0.3 && blink);
        barSet(E.acsBar, p.acs.frac, now, dt);
        // own STAGGER row: always drawn; the label brightens 60% -> 100% (0.15 s) while it holds
        const acsOn = p.acs.frac > 0.01 || p.acs.staggered;
        if (dt >= TG.snap) acsVis = acsOn ? 1 : 0; // first frame after a gap (captures): no half fade
        else acsVis = acsOn ? Math.min(1, acsVis + dt / 0.15) : Math.max(0, acsVis - dt / 0.6);
        set(E.acsLbl, 'opacity', (0.6 + 0.4 * acsVis).toFixed(2));
        flag(E.vitals, 'acs-on', acsOn);
        flag(E.vitals, 'stagger', p.acs.staggered);
        barSet(E.enBar, mo.en.frac, now, dt);
        flag(E.vitals, 'redline', mo.en.redline);
        flag(E.vitals, 'redline-blink', mo.en.redline && fast);
        // QB cooldown sweep inside the EN bar (full right after a quick boost, gone when ready)
        const qbCd = mo.cfg.qbCooldown || 0.5;
        fill(E.enQB, clamp01(mo.qbCooldown / qbCd));
        // boost mode tag: only on a change (BOOST on / off, ASSAULT BOOST), 1.5 s envelope
        if (!mode.init) { mode.init = true; mode.boost = mo.boostOn; mode.ab = mo.abActive; }
        if (mo.abActive !== mode.ab || mo.boostOn !== mode.boost) {
          const txt = mo.abActive && !mode.ab ? 'ASSAULT BOOST' : mo.boostOn !== mode.boost ? (mo.boostOn ? 'BOOST' : 'BOOST OFF') : '';
          mode.ab = mo.abActive; mode.boost = mo.boostOn;
          if (txt) { set(E.vTag, 'text', txt); mode.t = now; }
        }
        { const ta = now - mode.t;
          const k = ta < 0 || ta >= 1.5 ? 0 : ta < 0.15 ? ta / 0.15 : ta > 1.1 ? (1.5 - ta) / 0.4 : 1;
          set(E.vTag, 'opacity', (Math.round(k * 20) / 20).toFixed(2)); }
        // speed / altitude
        num(E.spd, Math.round(Math.hypot(mo.vel.x, mo.vel.y, mo.vel.z) * 3.6), F.pad3);
        num(E.alt, Math.max(0, Math.round(p.pos.y - g.physics.groundHeight(p.pos.x, p.pos.z))), F.pad3);

        // ---- weapons
        for (const s of SLOTS) {
          const slot = p.loadout.slots[s], o = E.wpn[s];
          if (!slot) continue;
          const d = slot.def;
          set(o.label, 'text', d.label);
          set(o.name, 'text', d.name);
          let state = '', wmask = 0;
          if (d.type === 'blade') {
            set(o.mag, 'text', '');
            set(o.res, 'text', '');
            if (slot.bladePhase) { state = 'ACTIVE'; wmask = 1; }
            else if (slot.cooldownT > 0) { state = 'CHARGING'; wmask = 1; }
            else state = 'READY';
          } else {
            num(o.mag, slot.mag === Infinity ? -1 : slot.mag, F.mag);
            num(o.res, slot.ammo === Infinity ? -1 : slot.ammo, F.res);
            if (slot.ammo <= 0) { state = 'EMPTY'; wmask = 2; }
            else if (slot.reloadT > 0) { state = 'RELOAD'; wmask = 1; }
          }
          set(o.state, 'text', state);
          const frac = slot.readyFrac;
          fill(o.bar.fill, frac);
          let locks = 0;
          if (o.pips) {
            locks = lock ? lock.missileLocks.length : 0;
            for (let i = 0; i < 4; i++) flag(o.pips[i], 'on', i < locks);
            num(o.lockTxt, locks, F.lock);
          }
          const named = now - nameT[s] < NAME_SHOW && now >= nameT[s];
          mods(o.box, 'hud-weapon', W_MODS, wmask | (now - wpnFlash[s] < 0.09 ? 4 : 0) | (locks ? 8 : 0) | (named ? 16 : 0));
        }

        // ---- warnings (fixed slots; only frames / chevrons blink, the text never dims)
        // Missile alert from LAUNCH at any range: every enemy missile whose target is the player
        // (projectiles.incomingMissiles only counts them after the homing delay within 260 m).
        let inc = 0;
        const pr = g.projectiles;
        if (pr) {
          if (pr.activeList && pr.activeCount) {
            const L = pr.activeList(), nP = pr.activeCount();
            for (let i = 0; i < nP; i++) { const q = L[i]; if (q.kind === 'missile' && q.target === p && q.team !== 'player') inc++; }
          }
          if (pr.incomingMissiles > inc) inc = pr.incomingMissiles;
        }
        // pre-alert during the rival rig's missile tell (shoulder glint, ~0.7 s before the salvo)
        const bs = g.enemies && g.enemies.boss;
        const lockWarn = inc === 0 && !!(bs && bs.alive && bs.atk === 'missiles' && bs.atkStage === 'tell');
        const apCrit = p.alive && apF < 0.25;
        if (inc > 0) num(E.wn.missile.n, inc, F.times);
        warnChip(E.wn.missile, inc > 0, !fast, dt);
        warnChip(E.wn.lockwarn, lockWarn, !fast, dt);
        warnChip(E.wn.stagger, p.acs.staggered, !blink, dt);
        warnChip(E.wn.en, mo.en.redline && !p.acs.staggered, !blink, dt);
        warnChip(E.wn.ap, apCrit, !blink, dt);
        warnOn = inc > 0 || lockWarn || p.acs.staggered || mo.en.redline || apCrit;

        // ---- kits / system
        { let c = cache.get(E.kitPips); if (!c) { c = {}; cache.set(E.kitPips, c); }
          if (c.k !== p.repairKits) { c.k = p.repairKits; E.kitPips.innerHTML = '<i class="on"></i>'.repeat(p.repairKits) + '<i></i>'.repeat(Math.max(0, 3 - p.repairKits)); } }
        num(E.kitNum, p.repairKits, F.times);
        const hard = !!(p.controller && p.controller.hardLock);
        flag(E.sysAssist, 'on', hard);
        set(E.sysFcs, 'text', tgt ? 'FCS LOCK' : 'FCS SEARCH');
        flag(E.sysFcs, 'lock', !!tgt);

        // ---- damage vignette
        const ha = now - hurt.t;
        const hurtA = ha < 0.6 ? hurt.amt * (1 - ha / 0.6) : 0;
        const lowA = p.alive && apF < 0.3 ? 0.18 + 0.12 * Math.sin(now * 5) : 0;
        set(E.hurt, 'opacity', Math.max(hurtA, lowA).toFixed(2));
      }

      // ---- boss panel
      const boss = g.enemies && g.enemies.boss;
      const bossOn = !!(boss && boss.alive && boss.spawned !== false && m && m.stage === 2);
      show(E.boss, bossOn);
      if (bossOn) {
        set(E.bsName, 'text', boss.name);
        set(E.bsJp, 'text', 'シンダーハウンド');
        barSet(E.bsAp, boss.ap / boss.apMax, now, dt);
        barSet(E.bsAcs, boss.acs.frac, now, dt);
        num(E.bsApNum, Math.ceil(boss.ap), fmtInt);
        show(E.bsState, boss.acs.staggered);
        flag(E.boss, 'stagger', boss.acs.staggered);
        flag(E.bsState, 'dim', !fast);
      }

      // ---- markers, target readout, compass blips, threat arrows
      const cam = g.camera;
      cam.updateMatrixWorld(); // camera placed this frame; renderer refreshes matrices later
      cam.getWorldDirection(_d);
      const heading = ((Math.atan2(_d.x, -_d.z) * DEG) + 360) % 360;
      set(E.cmpStrip, 'transform', `translateX(${((CMP.half - (heading + 180) * CMP.ppd) * U).toFixed(1)}px)`);
      num(E.cmpHead, Math.round(heading) % 360, F.head);

      let mi = 0, ai = 0, bi = 0, tgtIdx = -1;
      let tgtX = 0, tgtY = 0, tgtOn = false, tgtMIdx = -1;
      let objBest = null, objDist = Infinity;
      const ppx = p ? p.pos.x : 0, ppz = p ? p.pos.z : 0;
      for (const a of g.actors) {
        if (a === p || !a.alive || !a.targetable || a.team === 'player') continue;
        const dx = a.pos.x - ppx, dz = a.pos.z - ppz;
        const dist = Math.hypot(dx, dz);
        const isObj = objType !== null && a.type === objType;
        if (isObj && dist < objDist) { objDist = dist; objBest = a; }
        // compass blip
        if (bi < BLIPS && dist < 420) {
          let rel = Math.atan2(dx, -dz) * DEG - heading;
          rel = ((rel + 540) % 360) - 180;
          if (Math.abs(rel) < CMP.span) {
            const b = blips[bi++];
            show(b, true);
            set(b, 'transform', `translateX(${((CMP.half + rel * CMP.ppd) * U).toFixed(1)}px)`);
            mods(b, 'blip', BLIP_MODS, a.type === 'boss' ? 1 : isObj ? 2 : 0);
          }
        }
        a.aimPoint(_p);
        _v.copy(_p).applyMatrix4(cam.matrixWorldInverse);
        const vz = _v.z;
        _v.copy(_p).project(cam);
        const onScreen = vz < -0.5 && _v.x > -1 && _v.x < 1 && _v.y > -1 && _v.y < 1;
        if (onScreen) {
          if (mi >= MARKERS) continue;
          const mk = markers[mi];
          const x = (_v.x * 0.5 + 0.5) * W, y = (-_v.y * 0.5 + 0.5) * H;
          mkXY[mi * 2] = x; mkXY[mi * 2 + 1] = y;
          const mr = mi * 4;
          if (a === tgt) tgtIdx = mi;
          mi++;
          show(mk.el, true);
          set(mk.el, 'transform', `translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0)`);
          const lp = a.lockProgress || 0;
          const mIdx = lock ? lock.missileLocks.indexOf(a) : -1;
          const far = dist > 360;
          let occl = false;
          if (a === tgt) { tgtOn = true; tgtX = x; tgtY = y; tgtMIdx = mIdx; }
          else {
            // (enemy-ai r3, critic S: diamonds centred on 15-30 px walkers hid them) the non-locked
            // chevron floats ~8 px above the unit's screen-space head, never on the body
            _hd.set(a.pos.x, a.pos.y + (a.markerTop !== undefined ? a.markerTop : (a.height || 4)), a.pos.z).project(cam);
            const hy = (-_hd.y * 0.5 + 0.5) * H;
            const mt = Math.max(-140, Math.min(-6, hy - y - 8 * U));
            set(mk.dia, 'marginTop', `${mt.toFixed(0)}px`);
            // visible box for the readout placement: lock ticks + digit, or chevron down to the unit
            const kp = TG.keep * U;
            mkR[mr] = x - kp; mkR[mr + 2] = x + kp; mkR[mr + 3] = y + kp;
            mkR[mr + 1] = lp > 0.01 || mIdx >= 0 ? y - kp : Math.min(y - kp, y + mt - 10 * U);
            // a marker inside a fixed HUD block (weapon plates, SPD/ALT, vitals) fades to 35% and
            // drops its range text, so it never fights the block's own text
            const lockR = lp > 0.01 || mIdx >= 0 ? 14 * U : 0, my = lockR ? y : y + mt, r = lockR || 6 * U;
            for (let j = 0; j < TG_STATIC_FIXED && !occl; j++) {
              const s = TG_STATIC[j];
              occl = overlap(x - r, my - r, x + r, my + r, cx + s[0] * U, cy + s[1] * U, cx + s[2] * U, cy + s[3] * U) > 0;
            }
          }
          mods(mk.el, 'mk', MK_MODS, (a === tgt ? 1 : 0) | (lp > 0.01 ? 2 : 0) | (mIdx >= 0 ? 4 : 0) | (isObj ? 8 : 0) | (a.type === 'boss' ? 16 : 0) | (far ? 32 : 0) | (a.acs && a.acs.staggered ? 64 : 0) | (occl ? 128 : 0));
          // missile lock: 4 corner ticks light up clockwise with the lock progress
          // (on the FCS target the bracket corners carry the same count instead: one symbol)
          const lkN = mIdx >= 0 ? 4 : Math.min(4, Math.floor(lp * 4 + 1e-3));
          if (a === tgt) set(mk.brk, 'class', BRK_CLS[lkN]);
          else set(mk.lk, 'class', LK_CLS[lkN]);
          num(mk.idx, mIdx + 1, F.idx);
          num(mk.dist, a === tgt || occl ? -1 : Math.round(dist), F.dist);
        } else if (ai < ARROWS && dist < THREAT_RANGE) {
          // off-screen threat arrow on an ellipse around the reticle
          _v.copy(_p).applyMatrix4(cam.matrixWorldInverse);
          let ang = Math.atan2(_v.x, _v.y);
          if (vz > 0 && Math.abs(_v.x) < 1e-3 && Math.abs(_v.y) < 1e-3) ang = Math.PI;
          const ar = arrows[ai++];
          const ex = cx + Math.sin(ang) * W * 0.36, ey = cy - Math.cos(ang) * H * 0.38;
          show(ar, true);
          set(ar, 'transform', `translate3d(${ex.toFixed(1)}px,${ey.toFixed(1)}px,0) rotate(${ang.toFixed(3)}rad)`);
          mods(ar, 'arw', ARW_MODS, (a.type === 'boss' ? 1 : 0) | (dist < 90 ? 2 : 0));
        }
      }
      for (let i = mi; i < MARKERS; i++) show(markers[i].el, false);
      for (let i = ai; i < ARROWS; i++) show(arrows[i], false);
      for (let i = bi; i < BLIPS; i++) show(blips[i], false);

      // objective bearing on the compass
      if (objBest) {
        let rel = Math.atan2(objBest.pos.x - ppx, -(objBest.pos.z - ppz)) * DEG - heading;
        rel = ((rel + 540) % 360) - 180;
        const clampRel = Math.max(-CMP.span, Math.min(CMP.span, rel));
        show(E.cmpObj, true);
        set(E.cmpObj, 'transform', `translateX(${((CMP.half + clampRel * CMP.ppd) * U).toFixed(1)}px)`);
        flag(E.cmpObj, 'edge', clampRel !== rel);
        num(E.cmpObjDist, Math.round(objDist), F.m);
      } else show(E.cmpObj, false);

      // target readout beside the lock brackets: collision-tested placement + slot hysteresis
      // (layout.js); a slot change fades out, jumps and fades in (never glides over the target)
      let tgShow = tgtOn, ldOn = false;
      if (tgtOn) {
        const isBoss = tgt.type === 'boss';
        const tw = (isBoss ? TG.wBoss : TG.w) * U, th = (isBoss ? TG.hBoss : TG.h) * U;
        const k = TG.brk * U * (isBoss ? 1.35 : 1), pad = TG.pad * U;
        let n = 0, no = 0;
        // HARD: own bracket (+ pad), own lock-order digit, every other marker, the reticle
        n = pushRect(tgRects, n, tgtX - k - pad, tgtY - k - pad, tgtX + k + pad, tgtY + k + pad);
        if (tgtMIdx >= 0) { const q = isBoss ? TG.idxBoss : TG.idx; n = pushRect(tgRects, n, tgtX + q[0] * U, tgtY + q[1] * U, tgtX + q[2] * U, tgtY + q[3] * U); }
        for (let i = 0; i < mi; i++) {
          if (i === tgtIdx) continue;
          n = pushRect(tgRects, n, mkR[i * 4], mkR[i * 4 + 1], mkR[i * 4 + 2], mkR[i * 4 + 3]);
          tgOthers[no * 2] = mkXY[i * 2]; tgOthers[no * 2 + 1] = mkXY[i * 2 + 1]; no++;
        }
        for (let j = 0; j < TG.reticle.length; j++) { const r = TG.reticle[j]; n = pushRect(tgRects, n, cx + r[0] * U, cy + r[1] * U, cx + r[2] * U, cy + r[3] * U); }
        const nHard = n;
        tgDbg.nHard = nHard;
        // SOFT: the player's own rig, the fixed HUD blocks (+ warning row / banner while shown)
        if (projectRig(p, cam)) n = pushRect(tgRects, n, rig.x0, rig.y0, rig.x1, rig.y1);
        const dyn = (warnOn ? 1 : 0) | (banner ? 2 : 0);
        for (let j = 0; j < TG_STATIC.length; j++) {
          if (j >= TG_STATIC_FIXED && !(dyn & (1 << (j - TG_STATIC_FIXED)))) continue; // hidden rows
          const s = TG_STATIC[j];
          n = pushRect(tgRects, n, cx + s[0] * U, cy + s[1] * U, cx + s[2] * U, cy + s[3] * U);
        }
        tgView.x0 = W * TG.margin; tgView.y0 = H * TG.margin; tgView.x1 = W * (1 - TG.margin); tgView.y1 = H * (1 - TG.margin);
        tgGeo.k = k; tgGeo.d = TG.d * U; tgGeo.e = TG.e * U; tgGeo.far = TG.far * U; tgGeo.step = TG.step * U;
        const same = tgPos.shown && tgPos.actor === tgt, gap = dt >= TG.gap;
        if (!same) { tgHold.side = -1; tgHold.t = 0; }
        tgDbg.n = n; tgDbg.tx = tgtX; tgDbg.ty = tgtY;
        placeReadout(tgtX, tgtY, tw, th, tgGeo, tgRects, n, nHard, tgOthers, no, tgView, tgHold.side, tgOut);
        const want = readoutHold(tgHold, tgOut, dt, gap ? 0 : TG.hold);
        if (!same || gap) { tgPos.side = want; tgPos.alpha = 1; }
        else if (want !== tgPos.side) {
          tgPos.alpha -= dt / TG.fadeOut;                       // fade out at the old slot...
          if (tgPos.alpha <= 0) { tgPos.alpha = 0; tgPos.side = want; } // ...then jump
        } else if (tgPos.alpha < 1) tgPos.alpha = Math.min(1, tgPos.alpha + dt / TG.fadeIn);
        const side = tgPos.side, dock = side === READOUT_DOCK;
        if (dock) {
          // every slot beside the brackets is taken: fixed slot under the compass (the boss panel
          // owns that slot during the duel, so the boss range tag just hides instead)
          if (isBoss) tgShow = false;
          tgPos.x = cx - TG.dockW * 0.5 * U; tgPos.y = (bossOn ? TG.dockYBoss : TG.dockY) * U;
        } else {
          readoutCandidate(side, tgtX, tgtY, tw, th, k, tgGeo.d, tgGeo.e, tgC);
          tgPos.x = Math.min(tgView.x1 - tw, Math.max(tgView.x0, tgC.x));
          tgPos.y = Math.min(tgView.y1 - th, Math.max(tgView.y0, tgC.y));
          readoutLeader(side, tgtX, tgtY, k, tgPos.x, tgPos.y, tw, th, tgLd);
          ldOn = tgShow && tgLd.len > 2 * U && tgLd.len <= TG.leaderMax * U && tgPos.alpha > 0.05;
          if (ldOn) {
            const r = px05;  // hairline on the pixel grid
            set(E.leaderPath, '@d', `M${r(tgLd.x0)} ${r(tgLd.y0)}L${r(tgLd.x1)} ${r(tgLd.y1)}L${r(tgLd.x2)} ${r(tgLd.y2)}`);
          }
        }
        tgPos.actor = tgt; tgPos.shown = true;
        const op = tgPos.alpha >= 1 ? '' : (Math.round(tgPos.alpha * 20) / 20).toFixed(2);
        set(E.target, 'opacity', op);
        set(E.leader, 'opacity', op);
        set(E.target, 'transform', `translate3d(${tgPos.x.toFixed(1)}px,${tgPos.y.toFixed(1)}px,0)`);
        const sideL = side === 1 || side === 3 || side === 5;
        mods(E.target, 'hud-target', TG_MODS, (sideL ? 1 : 0) | (tgt.acs.staggered ? 2 : 0) | (isBoss ? 4 : 0) | (dock ? 8 : 0));
        set(E.tgName, 'text', tgt.name);
        num(E.tgDist, Math.round(Math.hypot(tgt.pos.x - ppx, tgt.pos.z - ppz)), F.m2);
        barSet(E.tgAp, tgt.ap / tgt.apMax, now, dt);
        num(E.tgApNum, Math.ceil(tgt.ap), fmtInt);
        barSet(E.tgAcs, tgt.acs.frac, now, dt);
        flag(E.tgState, 'dim', !fast);
      } else { tgPos.shown = false; tgHold.side = -1; }
      show(E.leader, ldOn);
      show(E.target, tgShow);
      flag(E.reticle, 'locked', !!tgt);
      // lock bracket on the aim point: the bracket frames it, so the reticle ring steps aside and
      // the unit inside stays visible (ticks + dot remain)
      flag(E.reticle, 'merged', tgtOn && Math.abs(tgtX - cx) < 26 * U && Math.abs(tgtY - cy) < 26 * U);

      // ---- hit marker
      const hA = now - hitFx.t;
      const hitOn = hA >= 0 && hA < (hitFx.kill ? 0.35 : 0.12);
      flag(E.hit, 'on', hitOn);
      flag(E.hit, 'kill', hitOn && hitFx.kill);

      // ---- damage direction arcs
      for (const d of dmg) {
        const age = now - d.t;
        const op = age >= 0 && age < 1.4 ? 1 - age / 1.4 : 0;
        set(d.el, 'opacity', op.toFixed(2));
        if (op > 0) set(d.el, 'transform', `rotate(${d.angle.toFixed(3)}rad)`);
      }

      // ---- callout banner (fade in 0.15 s, hold, fade out 0.35 s)
      if (banner && now - bannerT > banner.seconds + 0.35) { banner = null; bannerEnd = now; }
      if (!banner && banners.length) nextBanner(now);
      if (banner) {
        const age = now - bannerT;
        const a = age < 0.15 ? age / 0.15 : age > banner.seconds ? 1 - (age - banner.seconds) / 0.35 : 1;
        // warn/bad: the text holds full opacity; only the hazard rules + chevrons blink (css .blink)
        flag(E.banner, 'blink', (banner.kind === 'warn' || banner.kind === 'bad') && age < banner.seconds && !blink);
        set(E.banner, 'opacity', clamp01(a).toFixed(2));
        set(E.banner, 'transform', `translateX(-50%) translateY(${((1 - clamp01(a)) * -6 * U).toFixed(1)}px)`);
      } else set(E.banner, 'opacity', '0');

      // ---- end card
      const eA = now - end.t;
      show(E.end, !!end.status && eA >= 0);
      if (end.status && eA >= 0) {
        set(E.end, 'class', end.status === 'complete' ? 'hud-end complete' : 'hud-end failed');
        set(E.endText, 'text', end.status === 'complete' ? 'MISSION COMPLETE' : 'MISSION FAILED');
        set(E.endJp, 'text', end.jp);
        const k = clamp01(eA / 0.5);
        set(E.end, 'opacity', k.toFixed(2));
        set(E.endText, 'letterSpacing', `${(0.5 - 0.18 * k).toFixed(3)}em`);
      }

      // ---- radio subtitles
      if (radio.line && now - radio.t > radio.line.hold + 0.4) { radio.line = null; radioEnd = now; }
      if (!radio.line && radio.queue.length) nextRadio(now);
      if (radio.line) {
        const age = now - radio.t;
        const a = age < 0.25 ? age / 0.25 : age > radio.line.hold ? 1 - (age - radio.line.hold) / 0.4 : 1;
        set(E.radio, 'opacity', clamp01(a).toFixed(2));
        radioBars(E.rdBars, rdLv, age < radio.line.hold - 0.3, now, dt);
      } else set(E.radio, 'opacity', '0');
    },
  };
  return api;
}

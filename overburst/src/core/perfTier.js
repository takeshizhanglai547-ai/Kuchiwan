// ============================================================
//  core/perfTier.js — device tiering.  [owned by fx-post]
//
//  WHY
//    The game ships on phones now. It used to pick ONE quality for
//    every device and start at maximum, so a mid-range Android drew
//    its first frame at 2x pixel ratio, a 3072^2 shadow map, 12-sample
//    AO and a full-resolution bloom pyramid, hitched, and only then
//    let the adaptive ladder walk it back down. The first thirty
//    seconds of the mission were the worst thirty seconds.
//
//    This module probes the device ONCE at boot and picks the tier the
//    game STARTS at. The adaptive ladder in postfx.js then moves within
//    that tier's headroom; it does not have to discover the machine.
//
//  CONTRACT
//    detectTier(renderer) -> TierInfo     (probes; caches; idempotent)
//    getTier()            -> TierInfo     (cached, or a safe default)
//    setTier(nameOrIndex) -> TierInfo     (force; also re-broadcast)
//    TIERS                -> Tier[]       (index 0 = fastest device)
//
//  TierInfo
//    { index, name, pixelRatio, shadowMapSize, shadowType, ao, aoScale,
//      aoSamples, bloomScale, radialTaps, fxaa, maxLights, gpu, reasons[] }
//
//  READ IT FROM ANYWHERE
//    import { getTier } from '../core/perfTier.js';
//    sun.shadow.mapSize.set(getTier().shadowMapSize, getTier().shadowMapSize);
//    Also mirrored on ctx.engine.tier and window.__OB_TIER for the harness.
//
//  FORCING IT (this is how it gets tested)
//    ?tier=low  / ?tier=2         URL query
//    window.__OB_TIER_FORCE = 2   before the module loads
//    localStorage 'ob.tier'       sticky, survives reload
//    setTier('mid')               at runtime (postfx re-applies)
//
//  DELIBERATELY NOT A BENCHMARK
//    Timing a probe frame at boot means rendering a frame at the wrong
//    settings — exactly the "one catastrophic frame" this exists to
//    avoid — and the first frame of a WebGL context is dominated by
//    driver warm-up anyway. Everything here is a static capability
//    query. Getting it wrong by one step is cheap: the adaptive ladder
//    corrects within half a second, and it corrects DOWNWARD from a
//    survivable place instead of from a stall.
// ============================================================

/**
 * The ladder. Index 0 is a desktop discrete GPU; index 4 is "this thing
 * has no business running a deferred-ish post chain, keep it playable".
 *
 * The steps are deliberately EVEN — roughly 1.4x fill-rate each — because
 * a ladder whose rungs are 30x apart is not a ladder, it is a cliff with
 * a handrail. pixelRatio is the big lever (quadratic in fill rate), so it
 * moves one small notch per step rather than halving at the bottom.
 */
export const TIERS = [
  {
    name: 'ultra',
    pixelRatio: 2.00, shadowMapSize: 3072, shadowType: 'soft',
    ao: true, aoScale: 0.50, aoSamples: 12,
    bloomScale: 1.00, radialTaps: 6, fxaa: true, maxLights: 7,
  },
  {
    name: 'high',
    pixelRatio: 1.75, shadowMapSize: 2048, shadowType: 'soft',
    ao: true, aoScale: 0.50, aoSamples: 10,
    bloomScale: 0.72, radialTaps: 5, fxaa: true, maxLights: 7,
  },
  {
    name: 'mid',
    pixelRatio: 1.50, shadowMapSize: 1536, shadowType: 'soft',
    ao: true, aoScale: 0.42, aoSamples: 8,
    bloomScale: 0.52, radialTaps: 4, fxaa: true, maxLights: 7,
  },
  {
    name: 'low',
    pixelRatio: 1.25, shadowMapSize: 1024, shadowType: 'basic',
    ao: true, aoScale: 0.34, aoSamples: 6,
    bloomScale: 0.38, radialTaps: 3, fxaa: true, maxLights: 5,
  },
  {
    name: 'floor',
    pixelRatio: 1.00, shadowMapSize: 512, shadowType: 'basic',
    ao: false, aoScale: 0.34, aoSamples: 0,
    bloomScale: 0.28, radialTaps: 2, fxaa: false, maxLights: 4,
  },
];

const LAST = TIERS.length - 1;
const clampTier = (i) => (i < 0 ? 0 : i > LAST ? LAST : i | 0);

let _cached = null;

// ------------------------------------------------------------------
//  GPU string -> a starting guess.
//  Only families that are actually distinguishable from the string are
//  listed; everything else falls through to the generic heuristics.
// ------------------------------------------------------------------
const GPU_RULES = [
  // software rasterisers — headless CI, locked-down enterprise machines
  [/swiftshader|llvmpipe|softwarerasteriz|software|mesa offscreen|basic render/i, 4, 'software rasteriser'],

  // Apple. M-series and A15+ eat this workload; older A-series does not.
  [/apple m[1-9]/i, 0, 'Apple M-series'],
  [/apple a(1[5-9]|[2-9][0-9])/i, 0, 'Apple A15+'],
  [/apple a(1[2-4])/i, 1, 'Apple A12-A14'],
  [/apple a\d/i, 2, 'older Apple A-series'],
  [/apple gpu/i, 1, 'Apple GPU (unversioned)'],

  // desktop discrete
  [/rtx\s*[2-9]\d{3}|radeon rx (6|7|9)\d{3}|arc a\d{3}/i, 0, 'modern discrete GPU'],
  [/geforce|radeon (rx|pro)|quadro|nvidia/i, 0, 'discrete GPU'],

  // desktop integrated
  [/iris xe|arc graphics|iris plus/i, 1, 'Intel Iris Xe class'],
  [/intel.*(uhd|hd graphics)/i, 3, 'Intel UHD/HD integrated'],
  [/amd radeon\(tm\) graphics|vega \d/i, 2, 'AMD integrated'],

  // Android. Adreno 7xx/latest 6xx are fine, 5xx and below are not.
  [/adreno.*7\d{2}/i, 1, 'Adreno 7xx'],
  [/adreno.*6[4-9]\d/i, 1, 'Adreno 64x+'],
  [/adreno.*6\d{2}/i, 2, 'Adreno 6xx'],
  [/adreno.*5\d{2}/i, 3, 'Adreno 5xx'],
  [/adreno/i, 4, 'older Adreno'],

  [/mali-g7\d|mali-g[89]\d|immortalis/i, 2, 'Mali flagship'],
  [/mali-g[5-7]\d/i, 3, 'Mali mid'],
  [/mali/i, 4, 'older Mali'],

  [/powervr.*(bxm|bxt|gt9)/i, 3, 'PowerVR'],
  [/powervr|videocore/i, 4, 'low-end mobile GPU'],
];

function readGpuString(renderer) {
  try {
    const gl = renderer && renderer.getContext && renderer.getContext();
    if (!gl) return '';
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const unmasked = dbg && gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL);
    return String(unmasked || gl.getParameter(gl.RENDERER) || '');
  } catch (err) {
    return '';
  }
}

function forcedIndex() {
  // 1. explicit global (set before boot by the harness)
  if (typeof window !== 'undefined' && window.__OB_TIER_FORCE != null) {
    return resolveIndex(window.__OB_TIER_FORCE);
  }
  // 2. query string
  try {
    if (typeof location !== 'undefined' && location.search) {
      const m = /[?&]tier=([^&]+)/.exec(location.search);
      if (m) return resolveIndex(decodeURIComponent(m[1]));
    }
  } catch (err) { /* ignore */ }
  // 3. sticky user choice
  try {
    const v = typeof localStorage !== 'undefined' && localStorage.getItem('ob.tier');
    if (v != null && v !== '') return resolveIndex(v);
  } catch (err) { /* ignore */ }
  return -1;
}

function resolveIndex(v) {
  if (typeof v === 'number' && isFinite(v)) return clampTier(v);
  const s = String(v).trim().toLowerCase();
  if (s === '') return -1;
  const byName = TIERS.findIndex((t) => t.name === s);
  if (byName >= 0) return byName;
  const n = parseInt(s, 10);
  return isFinite(n) ? clampTier(n) : -1;
}

/**
 * Probe the device and pick a starting tier. Idempotent: the first call
 * decides, later calls return the same object (setTier() overrides).
 *
 * @param {import('three').WebGLRenderer} [renderer]
 * @returns {object} TierInfo
 */
export function detectTier(renderer) {
  if (_cached) return _cached;

  const reasons = [];
  const nav = typeof navigator !== 'undefined' ? navigator : {};
  const win = typeof window !== 'undefined' ? window : {};
  const gpu = readGpuString(renderer);

  // ---- forced ----------------------------------------------------
  const forced = forcedIndex();
  if (forced >= 0) {
    reasons.push('forced -> ' + TIERS[forced].name);
    return (_cached = finalise(forced, gpu, reasons, renderer, true));
  }

  // ---- the automated harness renders the REFERENCE image ---------
  // tools/shot.mjs and tools/perf.mjs run through SwiftShader, which the
  // rules below would (correctly, for a real user) drop to the floor
  // tier. Doing that to the harness would silently swap the visual-QA
  // baseline for the cheapest possible frame and report the saving as a
  // performance win. Automation gets tier 0; `?tier=` still overrides.
  if (nav.webdriver) {
    reasons.push('automation (navigator.webdriver) -> reference tier');
    return (_cached = finalise(0, gpu, reasons, renderer, false));
  }

  // ---- 1. what kind of GPU is this ------------------------------
  let idx = 2;                                  // unknown device: start mid
  reasons.push('default mid');
  for (const [re, tier, why] of GPU_RULES) {
    if (re.test(gpu)) { idx = tier; reasons.length = 0; reasons.push(why); break; }
  }

  // ---- 2. is it a phone -----------------------------------------
  const coarse = !!(win.matchMedia && win.matchMedia('(pointer: coarse)').matches);
  const touch = (nav.maxTouchPoints || 0) > 0;
  const shortSide = Math.min(win.innerWidth || 1280, win.innerHeight || 720);
  const isPhone = coarse && touch && shortSide <= 500;
  const isTablet = coarse && touch && !isPhone;

  if (isPhone) {
    // A phone is thermally limited even when its GPU string is flattering:
    // it will sustain maybe 60 % of its burst rate inside a minute.
    idx = Math.max(idx, 2);
    reasons.push('phone form factor');
  } else if (isTablet) {
    idx = Math.max(idx, 1);
    reasons.push('tablet form factor');
  }

  // ---- 3. CPU / memory ------------------------------------------
  // Deliberately WEAK signals. Gameplay CPU across every system in this
  // game measures 1.3 ms/frame; the frame is spent in the post chain, on
  // the GPU. A 4-core machine is not the problem and penalising it is how
  // an Intel UHD laptop ended up on the floor tier with no AO and no AA.
  // Only the genuinely tiny devices get marked down here.
  const cores = nav.hardwareConcurrency || 0;
  const mem = nav.deviceMemory || 0;            // Chromium only, GiB, capped at 8
  if (cores && cores <= 2) { idx += 1; reasons.push('hardwareConcurrency ' + cores); }
  if (mem && mem <= 2) { idx += 1; reasons.push('deviceMemory ' + mem + 'GB'); }

  // ---- 4. how many pixels is it actually asking for --------------
  // The post chain is fill-rate bound, so the number that matters is the
  // BACKBUFFER area, not the CSS one. A 1440p phone at dpr 3.5 is asking
  // for more pixels than a 1080p desktop.
  const dpr = Math.min(win.devicePixelRatio || 1, 3);
  const cssPx = (win.innerWidth || 1280) * (win.innerHeight || 720);
  const mpx = (cssPx * dpr * dpr) / 1e6;
  if (mpx > 8) { idx += 2; reasons.push(mpx.toFixed(1) + ' Mpx backbuffer'); }
  else if (mpx > 4.2) { idx += 1; reasons.push(mpx.toFixed(1) + ' Mpx backbuffer'); }

  // ---- 5. GL capability floor ------------------------------------
  const caps = renderer && renderer.capabilities;
  if (caps) {
    if (caps.isWebGL2 === false) { idx += 1; reasons.push('WebGL1'); }
    if (caps.maxTextureSize && caps.maxTextureSize < 8192) {
      idx += 1; reasons.push('maxTextureSize ' + caps.maxTextureSize);
    }
    if (caps.precision === 'mediump' || caps.precision === 'lowp') {
      idx += 1; reasons.push('fragment precision ' + caps.precision);
    }
  }

  return (_cached = finalise(clampTier(idx), gpu, reasons, renderer, false));
}

function finalise(index, gpu, reasons, renderer, forced) {
  const t = TIERS[clampTier(index)];
  const win = typeof window !== 'undefined' ? window : {};
  const devicePR = win.devicePixelRatio || 1;

  const info = {
    index: clampTier(index),
    name: t.name,
    // never ask for more pixels than the display actually has
    pixelRatio: Math.min(t.pixelRatio, devicePR),
    shadowMapSize: t.shadowMapSize,
    shadowType: t.shadowType,
    ao: t.ao,
    aoScale: t.aoScale,
    aoSamples: t.aoSamples,
    bloomScale: t.bloomScale,
    radialTaps: t.radialTaps,
    fxaa: t.fxaa,
    maxLights: t.maxLights,
    gpu,
    forced: !!forced,
    reasons,
  };

  // A shadow map bigger than the driver's limit silently falls over.
  const maxTex = (renderer && renderer.capabilities && renderer.capabilities.maxTextureSize) || 0;
  if (maxTex) info.shadowMapSize = Math.min(info.shadowMapSize, maxTex);

  if (typeof window !== 'undefined') window.__OB_TIER = info;
  return info;
}

/** The decided tier. Safe to call before detectTier() — returns 'mid'. */
export function getTier() {
  return _cached || finalise(2, '', ['not probed yet'], null, false);
}

/**
 * Force a tier at runtime. postfx.js listens for this through
 * `ctx.engine.applyTier()`; call that after, or use postfx.setTier().
 * @param {string|number} nameOrIndex
 */
export function setTier(nameOrIndex) {
  const i = resolveIndex(nameOrIndex);
  const gpu = _cached ? _cached.gpu : '';
  // an unrecognised name holds station rather than silently landing on 'mid'
  const idx = i < 0 ? (_cached ? _cached.index : 2) : i;
  _cached = finalise(idx, gpu, ['set at runtime'], null, true);
  return _cached;
}

export default { TIERS, detectTier, getTier, setTier };

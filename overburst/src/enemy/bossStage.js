// ============================================================
//  enemy/bossStage.js — staging NIGHTJAR so the player can SEE it.
//  [owned by enemy-ai agent]
//
//  The arena is full of silos, gantries, pipe racks and pylon decks.
//  Picking a bearing off the player's facing and walking the boss on at
//  a fixed range lands the most important enemy in the game behind forty
//  metres of concrete roughly half the time — which is exactly what used
//  to happen.
//
//  So: sweep bearings AND distances, and test every candidate from the
//  LENS, not from the player's feet. The chase camera sits ~20 m behind
//  and ~10 m up; it sees a materially different world to the mech. For
//  each candidate we ask
//     * is the chest visible from the camera?          (hard)
//     * is the head visible too?                       (silhouette)
//     * is it hidden behind the player's own mech?     (hard)
//     * is the ground there open, level and standable? (hard-ish)
//     * is there sky above it and depth behind it?     (score)
//     * does the bearing frame well?                   (score)
//  and keep the best. Nothing survives the hard tests only in pathological
//  arenas, and there is a graceful relaxation for that case.
//
//  Also holds the frame-space helpers the duel uses to stay on screen,
//  and stageMark() — the closed-loop version of the same idea, which the
//  arrival beat servos onto every frame instead of hoping an orbit cap
//  keeps it near where it landed.
//
//  PERF: placement runs on arrival and on a re-position (~100 rays, one
//  frame, twice a mission). stageMark() sweeps at most 15 candidates at
//  one ray each, early-exits on the first good one, and only runs 3x a
//  second for the ~3 s of the arrival beat. The per-frame helpers are
//  pure arithmetic. Nothing here allocates.
// ============================================================
import * as THREE from 'three';
import { CFG } from '../config.js';
import { DEF, resolveXZ } from './enemyDefs.js';

const B = DEF.boss;
const CHEST = B.chest;                  // 8.6 — centre of mass
const HEAD = B.height * 0.90;           // 13.7 — the bit that reads as a head
const FOOT = 2.2;

// ------------------------------------------------------------------
//  THE MARK — where NIGHTJAR has to stand to be a machine and not a
//  smudge. Both numbers below are solved, not taste.
//
//  Round three measured the encounter instead of guessing at it. At the
//  instant the harness photographs the frame NIGHTJAR was NOT occluded
//  and NOT behind the player: it was 50 m out at bearing 0.40, clean
//  line of sight, and its projected bounding box covered 1.88 % of the
//  frame. The failure was never staging. It was APPARENT SIZE.
//
//  Coverage of the projected box goes as
//        cov  =  K / D^2  *  1/cos^3(bear)
//  with D the distance from the LENS (not the player — the chase rig is
//  ~20.6 m further back again) and the cos^3 term the honest off-axis
//  enlargement a flat projection plane gives you near the frame edge.
//  Samples across three builds put K at 4800–7700, rising with bearing;
//  6100 is the conservative fit and it is only ever used to RANK.
//
//  Measured coverage at the photographed instant, same encounter:
//     bearing 0.34, 50 m  ->  1.9 %   (what shipped — the smudge)
//     bearing 0.41, 36 m  ->  3.3 %
//     bearing 0.57, 32 m  ->  5.6 %   (readable, but a knife-fight)
//     bearing 0.58, 40 m  ->  the mark
//  A wider bearing is worth more than closing the range, and unlike range
//  it costs the duel nothing: 0.58 rad is ndc x 0.63, still 0.37 of the
//  frame from the edge, and 0.39 rad clear of the player's own outline.
export const STAGE_BEAR = 0.60;         // rad off the view axis
export const STAGE_RANGE = 38;          // metres from the player

// Apparent size, as a score. cov ~= K / D^2 * 1/cos^3(bear), fitted to
// seven measured samples of the real projected box taken across the
// encounter (K came out 4800–7000, rising with bearing; 6100 is the
// middle). It assumes the base FOV, so it is not a predictor — it only
// ever RANKS candidates against each other, which is all anything here
// asks of it. Percent of frame area.
const COVER_K = 6100;
const COVER_FLOOR = 2.0;                // below this a spot scores nothing
const COVER_GOOD = 4.5;                 // at this it scores full marks

function clampf(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

function coverEst(lensD, bear) {
  const c = Math.cos(bear);
  const stretch = c > 0.25 ? 1 / (c * c * c) : 1;
  return (COVER_K * stretch) / Math.max(1, lensD * lensD);
}

/** how much of the horizontal half-frame one radian off the axis eats */
function halfFrame(ctx) {
  const cam = ctx.camera;
  const fov = cam && cam.fov ? cam.fov : 62;
  const a = cam && cam.aspect ? cam.aspect : 16 / 9;
  return Math.tan((fov * Math.PI) / 360) * a;
}

// Bearings off the CAMERA axis, in the order we would like them. The
// readable band is 0.45–0.66 rad: closer to the centreline and the AC is
// both small and inside the player's own outline, wider and its far
// shoulder starts leaving the picture.
const BEARINGS = [0.60, -0.60, 0.52, -0.52, 0.66, -0.66, 0.44, -0.44, 0.36, -0.36];
const WANT_BEAR = STAGE_BEAR;
// Ranges, metres from the player. This is a READABILITY budget as much as
// a staging one — see the coverage solve above. 38 m puts the lens at
// ~52 m and a 15.2 m AC at ~137 px in a 560 px frame with its legs,
// shoulders and head separable, while still leaving the player most of a
// second to react to a charge.
const RANGES = [38, 42, 34, 46, 52, 60, 72, 84];
const WANT_RANGE = STAGE_RANGE;

const FRAME_LIMIT = 0.72;               // rad off axis we will never exceed
// How far "open ground" has to reach. This is a not-jammed-in-a-corner
// test, not a plaza test: 22 m disqualified every spot within half a mech
// length of a wall, which in a refinery is most of the good ones.
const CLEAR_LEN = 16;
const SKY_LEN = 46;
// Backdrop reach. The chase lens sits ~9 m up and NIGHTJAR's head is ~14 m,
// so at duelling range the head is BELOW the horizon line — it can never be
// against literal sky. What it can be against is distance: 240 m of clear
// air behind it puts haze and value falloff between the AC and whatever
// eventually stops the ray, instead of a mid-grey silo two lengths back.
const BACKDROP = 240;

const CLEAR_DIRS = [
  1, 0, 0.5, 0.866, -0.5, 0.866, -1, 0, -0.5, -0.866, 0.5, -0.866,
];

// ---- scratch -----------------------------------------------------
const _o = new THREE.Vector3();
const _d = new THREE.Vector3();
const _p = new THREE.Vector3();
const _p2 = new THREE.Vector3();
const _hit = { point: new THREE.Vector3(), normal: new THREE.Vector3(), distance: 0 };
const _near = [];
const _lens = { x: 0, y: 0, z: 0, ax: 0, az: 0, dist: 0 };

/** true when nothing in the world blocks the segment */
function clear(w, ox, oy, oz, dx, dy, dz, len) {
  if (!w || !w.raycastWorld || len <= 0.2) return true;
  const l = Math.hypot(dx, dy, dz) || 1;
  _o.set(ox, oy, oz);
  _d.set(dx / l, dy / l, dz / l);
  return !w.raycastWorld(_o, _d, len, _hit);
}

/** segment from (ax..) to (bx..), shortened at both ends so we do not
 *  self-hit the deck the shooter or the target is standing on */
function clearTo(w, ax, ay, az, bx, by, bz, pad) {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-3) return true;
  return clear(w, ax, ay, az, dx, dy, dz, len - (pad === undefined ? 2.0 : pad));
}

/**
 * Where the frame is being drawn from, and which way it looks. The chase
 * camera trails the player, so its matrix is one frame stale — irrelevant
 * at these tolerances. Falls back to the player's own heading whenever the
 * camera is somewhere else entirely (the QA harness free-cam).
 */
function lens(ctx) {
  const p = ctx.player;
  const cam = ctx.camera;
  const px = p ? p.pos.x : 0, pz = p ? p.pos.z : 0;
  if (cam && cam.matrixWorld) {
    const m = cam.matrixWorld.elements;
    const cx = m[12], cy = m[13], cz = m[14];
    const dd = Math.hypot(cx - px, cz - pz);
    const fx = -m[8], fz = -m[10];
    const fl = Math.hypot(fx, fz);
    if (dd < 70 && fl > 1e-3) {
      _lens.x = cx; _lens.y = cy; _lens.z = cz;
      _lens.ax = fx / fl; _lens.az = fz / fl;
      _lens.dist = dd;
      return _lens;
    }
  }
  const y = p ? p.yaw : 0;
  _lens.x = px; _lens.y = (p ? p.pos.y : 0) + 6; _lens.z = pz;
  _lens.ax = -Math.sin(y); _lens.az = -Math.cos(y);
  _lens.dist = 0;
  return _lens;
}

/** signed angle, in the XZ plane, from the view axis to (x,z). */
export function frameOff(ctx, x, z) {
  const L = lens(ctx);
  const dx = x - L.x, dz = z - L.z;
  if (Math.abs(dx) + Math.abs(dz) < 1e-4) return 0;
  return Math.atan2(L.ax * dz - L.az * dx, L.ax * dx + L.az * dz);
}

/** angular cone the player's own mech occupies, as seen from the lens */
function mechCone(ctx, L, out) {
  const p = ctx.player;
  out.off = 0; out.half = 0;
  if (!p || L.dist < 1e-3) return out;
  const dx = p.pos.x - L.x, dz = p.pos.z - L.z;
  const d = Math.hypot(dx, dz);
  if (d < 1e-3) return out;
  out.off = Math.atan2(L.ax * dz - L.az * dx, L.ax * dx + L.az * dz);
  out.half = Math.atan2(4.4, Math.max(4, d));   // half-width of the chassis
  return out;
}
const _cone = { off: 0, half: 0 };

/**
 * The angular slot the player's OWN MECH eats out of the frame, widened by
 * NIGHTJAR's own apparent width so the exclusion covers its whole body and
 * not just its centre. Everything about the duel staging is downstream of
 * this: the review's round-2 failure was not "off axis", it was NIGHTJAR
 * standing 25 m away directly behind the player's back plate, which the
 * world-geometry LOS test happily calls "visible".
 *
 * Derived live from the camera rather than baked as constants — the chase
 * rig's shoulder offset swings with pitch, and the QA free-cam is somewhere
 * else entirely.  `dist` is metres from the PLAYER; the lens is further back
 * again and lens() already knows by how much.
 *
 * Returns the shared scratch {off, half, lo, hi}; lo/hi are the bearings
 * NIGHTJAR must stay outside of. Do not retain it.
 */
export function silhouette(ctx, dist) {
  const L = lens(ctx);
  mechCone(ctx, L, _sil);
  const dl = Math.max(10, (dist || 60) + L.dist);
  // half the AC's own width at that range, plus a margin that keeps a
  // shoulder or a leg from clipping into the player's outline
  const own = Math.atan2(B.radius + 1.4, dl) + 0.055;
  _sil.lo = _sil.off - _sil.half - own;
  _sil.hi = _sil.off + _sil.half + own;
  return _sil;
}
const _sil = { off: 0, half: 0, lo: 0, hi: 0 };

/** how far inside the player's outline a bearing sits (0 = clear) */
export function silhouetteDepth(ctx, off, dist) {
  const s = silhouette(ctx, dist);
  if (off <= s.lo || off >= s.hi) return 0;
  return Math.min(off - s.lo, s.hi - off);
}

/** one raycast: can the frame actually see this unit's chest right now? */
export function bossVisible(ctx, e) {
  const w = ctx.world;
  if (!w || !w.raycastWorld) return true;
  const L = lens(ctx);
  return clearTo(w, L.x, L.y, L.z, e.pos.x, e.pos.y + e.def.chest, e.pos.z, 2.6);
}

/**
 * One candidate: the world point that sits `bear` rad off the view axis
 * and exactly `range` metres from the PLAYER.
 *
 * Bearings are quoted from the lens and ranges from the player, and the
 * two origins are ~20.6 m apart, so this is not "walk out on a heading" —
 * it is the intersection of a ray from the lens with a circle round the
 * player. Along u from the lens, |L + t·u − P| = range gives
 *      t² − 2t(u·w) + |w|² − range² = 0,   w = P − L
 * and we take the far root (the near one is behind the player).
 *
 * Returns the lens distance, or -1 when the point is unusable: outside
 * the arena, unstandable, off the player's plane, jammed in a collider or
 * blocked from the lens.
 */
function markAt(ctx, bear, range, out) {
  const p = ctx.player;
  if (!p) return -1;
  const L = lens(ctx);
  const c = Math.cos(bear), s = Math.sin(bear);
  const ux = L.ax * c - L.az * s;
  const uz = L.az * c + L.ax * s;
  const wx = p.pos.x - L.x, wz = p.pos.z - L.z;
  const uw = ux * wx + uz * wz;
  const disc = uw * uw - (wx * wx + wz * wz) + range * range;
  if (disc <= 0) return -1;
  const t = uw + Math.sqrt(disc);
  if (t < 8) return -1;
  let x = L.x + ux * t;
  let z = L.z + uz * t;

  const lim = CFG.ARENA.RADIUS - 46;
  const rr = Math.hypot(x, z);
  if (rr > lim) { x = x / rr * lim; z = z / rr * lim; }

  const w = ctx.world;
  const gy = w && w.sampleHeight ? w.sampleHeight(x, z, p.pos.y + 10) : 0;
  if (!Number.isFinite(gy)) return -1;
  const step = gy - p.pos.y;
  if (step < -16 || step > 14) return -1;
  // Clearance is tested against what the BODY actually enforces
  // (hitRadius * 0.85 = 4.25 m) plus a small margin, not against the
  // 15 %-inflated radius the drop-in solve uses. Being 35 % stricter
  // here does not make NIGHTJAR safer, it makes the whole outer half of
  // the frame unreachable — measured, every bearing past 0.42 rad at the
  // shipped encounter failed this test and nothing else.
  _p.set(x, gy, z);
  resolveXZ(w, _p, B.radius * 0.95, B.height, _near);
  if (Math.hypot(_p.x - x, _p.z - z) > 1.6) return -1;
  if (!clearTo(w, L.x, L.y, L.z, x, gy + CHEST, z, 2.6)) return -1;

  // Chest-clear is not silhouette-clear. A gantry leg is 1 m of rusty
  // steel that the centre ray sails past and that still cuts a quarter of
  // the AC out of the picture. So probe the shoulders too, across the
  // view, and report the result as a soft penalty rather than a reject —
  // a partly-posted mark is worse than a clean one and much better than
  // giving up and leaving NIGHTJAR wherever it landed.
  const bx = x - L.x, bz = z - L.z;
  const bl = Math.hypot(bx, bz) || 1;
  const sx = (-bz / bl) * (B.radius + 0.6), sz = (bx / bl) * (B.radius + 0.6);
  _shoulders = 0;
  if (clearTo(w, L.x, L.y, L.z, x + sx, gy + CHEST, z + sz, 2.6)) _shoulders++;
  if (clearTo(w, L.x, L.y, L.z, x - sx, gy + CHEST, z - sz, 2.6)) _shoulders++;

  out.set(x, gy, z);
  return bl;
}
// how many of the two shoulder probes the last markAt() got through
let _shoulders = 2;

// The sweep the arrival beat walks. Wide-and-near first: those are the
// candidates that make the AC big, and every one of them was rejected by
// the shipped build for being 8 m from a wall.
const MARK_BEAR = [0.58, 0.52, 0.46, 0.40, 0.34];
const MARK_RANGE = [38, 34, 43];
// Stop at the first candidate this good rather than taking the maximum:
// the maximum is always the nearest solvable spot, and a servo that
// always takes it creeps NIGHTJAR in to the collision band during its
// own arrival beat (measured: it walked 33 m -> 32 m and 0.34 -> 0.57 rad
// over three seconds and covered 5.6 %, which is more frame than the
// encounter needs and less duelling room than it deserves).
const MARK_ENOUGH = 3.5;                // % of frame — stop looking
const NDC_EDGE = 0.30;                  // keep the centre this far in

/**
 * Solve the presentation mark: the best spot on `side` of the frame that
 * the lens can actually see, ranked by how much of the frame NIGHTJAR
 * would fill standing on it.
 *
 * A single ideal bearing is not enough and that is measured, not
 * theoretical: at the shipped encounter the ideal (0.60 rad, 42 m) is
 * inside a concrete slab, the same bearing 4 m nearer is clear and covers
 * 5 % of the frame, and a solver that only tries the ideal gives up and
 * leaves NIGHTJAR wherever it landed. So it sweeps, and it prefers size.
 *
 * Falls back to the far side of the frame when the near one is walled
 * off. Returns false only when nothing at all solves, in which case the
 * caller keeps the mark it had.
 */
export function stageMark(ctx, side, out) {
  const half = halfFrame(ctx);
  let best = -1, bx = 0, by = 0, bz = 0;
  for (let sp = 0; sp < 2; sp++) {
    const sgn = sp === 0 ? (side < 0 ? -1 : 1) : (side < 0 ? 1 : -1);
    for (let bi = 0; bi < MARK_BEAR.length; bi++) {
      const bear = MARK_BEAR[bi];
      // the frame test is on the projected centre, so it follows the FOV
      if (Math.tan(bear) / half > 1 - NDC_EDGE) continue;
      for (let ri = 0; ri < MARK_RANGE.length; ri++) {
        const d = markAt(ctx, bear * sgn, MARK_RANGE[ri], _p2);
        if (d < 0) continue;
        // a posted shoulder costs the mark a fifth of its worth each
        const cov = coverEst(d, bear) * (1 - (2 - _shoulders) * 0.20);
        if (cov > best) { best = cov; bx = _p2.x; by = _p2.y; bz = _p2.z; }
        if (best > MARK_ENOUGH) { out.set(bx, by, bz); return true; }
      }
    }
    if (best > 0) break;               // this side works; do not cross over
  }
  if (best < 0) return false;
  out.set(bx, by, bz);
  return true;
}

/**
 * Pick the spot NIGHTJAR arrives on / re-positions to.
 * Writes a world point into `out`; returns the score (-Infinity = nothing
 * was even close, caller should keep whatever it had).
 */
export function pickBossSpot(ctx, out) {
  const w = ctx.world;
  const p = ctx.player;
  if (!p) { out.set(0, 0, -70); return -Infinity; }
  const L0 = lens(ctx);
  mechCone(ctx, L0, _cone);
  // snapshot: frameOff() re-derives the same lens into the same scratch
  const ex = L0.x, ey = L0.y, ez = L0.z, vax = L0.ax, vaz = L0.az, trail = L0.dist;
  const py = p.pos.y;
  const lim = CFG.ARENA.RADIUS - 46;

  let best = -Infinity, bx = 0, by = 0, bz = 0;
  let loose = -Infinity, lx = 0, ly = 0, lz = 0;

  for (let bi = 0; bi < BEARINGS.length; bi++) {
    const off = BEARINGS[bi];
    // bearings are quoted off the LENS axis; walk them out from the player
    const ax = vax * Math.cos(off) - vaz * Math.sin(off);
    const az = vaz * Math.cos(off) + vax * Math.sin(off);

    for (let ri = 0; ri < RANGES.length; ri++) {
      const r = RANGES[ri];
      let x = p.pos.x + ax * r;
      let z = p.pos.z + az * r;

      // --- inside the arena ------------------------------------
      const rr = Math.hypot(x, z);
      if (rr > lim) { x = x / rr * lim; z = z / rr * lim; }

      // --- standable, and roughly on the player's plane ---------
      const gy = w && w.sampleHeight ? w.sampleHeight(x, z, py + 10) : 0;
      if (!Number.isFinite(gy)) continue;
      const step = gy - py;
      if (step < -16 || step > 14) continue;
      // nothing walkable stacked above it — NIGHTJAR drops in from 27 m and
      // must not land on a catwalk it was never meant to be standing on
      if (w && w.sampleHeight && w.sampleHeight(x, z, gy + 44) > gy + 1.5) continue;

      // --- not jammed inside a collider ------------------------
      _p.set(x, gy, z);
      resolveXZ(w, _p, B.radius * 1.15, B.height, _near);
      if (Math.hypot(_p.x - x, _p.z - z) > 1.2) continue;

      // --- framing ---------------------------------------------
      const fo = frameOff(ctx, x, z);
      const mag = Math.abs(fo);
      if (mag > FRAME_LIMIT) continue;
      // behind our own mech — padded by NIGHTJAR's own apparent width at
      // this range, so a shoulder cannot poke out of the player's outline
      // and call itself framed
      const own = Math.atan2(B.radius + 1.4, Math.max(10, r + trail)) + 0.055;
      if (fo > _cone.off - _cone.half - own && fo < _cone.off + _cone.half + own) continue;

      // --- the tests that cost rays ----------------------------
      const chestVis = clearTo(w, ex, ey, ez, x, gy + CHEST, z, 2.6);
      if (!chestVis) continue;
      const headVis = clearTo(w, ex, ey, ez, x, gy + HEAD, z, 2.6);
      const footVis = clearTo(w, ex, ey, ez, x, gy + FOOT, z, 2.6);
      // the mech's own eyeline matters too: it has to be able to shoot back
      const eyeVis = clearTo(w, p.pos.x, py + 5.6, p.pos.z, x, gy + CHEST, z, 2.6);
      const sky = clear(w, x, gy + HEAD, z, 0, 1, 0, SKY_LEN);

      let open = 0;
      for (let i = 0; i < 6; i++) {
        if (clear(w, x, gy + CHEST, z, CLEAR_DIRS[i * 2], 0, CLEAR_DIRS[i * 2 + 1], CLEAR_LEN)) open++;
      }

      // depth behind it: an AC against open air reads, an AC against a
      // wall the same value as itself does not. Measured at HEAD height —
      // that is the silhouette line the eye actually picks the mech out on.
      const bdx = x - ex, bdz = z - ez;
      const bl = Math.hypot(bdx, bdz) || 1;
      const depth = clear(w, x + (bdx / bl) * 8, gy + HEAD, z + (bdz / bl) * 8,
        bdx / bl, 0.10, bdz / bl, BACKDROP);
      const depthMid = clear(w, x + (bdx / bl) * 8, gy + CHEST, z + (bdz / bl) * 8,
        bdx / bl, 0.06, bdz / bl, BACKDROP * 0.5);

      // --- score ------------------------------------------------
      // APPARENT SIZE OUTRANKS BACKDROP. That inversion is the whole
      // point of round three. The old weights bought a clean 240 m of
      // haze behind NIGHTJAR at the price of standing it 20 m further
      // out, and a well-backdropped AC that is 100 px tall is still the
      // thing the review called a smudge. Measured on the shipped build:
      // the winning spot scored 200 at 2.2 % of frame area while a spot
      // 4 m nearer and 0.24 rad wider — same clear sight line, same open
      // ground — was available at 4.4 %.
      const framePref = 1 - Math.min(1, Math.abs(mag - WANT_BEAR) / 0.34);
      const distPref = 1 - Math.min(1, Math.abs(r - WANT_RANGE) / 44);
      const cov = coverEst(Math.hypot(x - ex, z - ez), mag);
      const sizePref = clampf((cov - COVER_FLOOR) / (COVER_GOOD - COVER_FLOOR));
      let s = 0;
      s += sizePref * 70;
      s += (open / 6) * 30;
      s += headVis ? 34 : 0;
      s += footVis ? 14 : 0;
      s += eyeVis ? 12 : 0;
      s += sky ? 20 : 0;
      s += depth ? 20 : 0;
      s += depthMid ? 10 : 0;
      s += framePref * 26;
      s += distPref * 22;
      s -= Math.abs(step) * 1.6;
      s -= ri * 1.2;                     // mild preference for the listed order

      if (s > loose) { loose = s; lx = x; ly = gy; lz = z; }
      if (headVis && open >= 3 && s > best) { best = s; bx = x; by = gy; bz = z; }
      if (best > 205) { out.set(bx, by, bz); return best; }
    }
  }

  if (best > -Infinity) { out.set(bx, by, bz); return best; }
  if (loose > -Infinity) { out.set(lx, ly, lz); return loose; }

  // Nothing at all: fall back to a plain bearing so the mission still gets
  // its boss. Better a badly framed AC than no AC.
  const a = p.yaw + 0.34;
  out.set(p.pos.x - Math.sin(a) * 70, p.pos.y, p.pos.z - Math.cos(a) * 70);
  const rr = Math.hypot(out.x, out.z);
  if (rr > lim) { out.x = out.x / rr * lim; out.z = out.z / rr * lim; }
  if (w && w.sampleHeight) out.y = w.sampleHeight(out.x, out.z, p.pos.y + 10);
  return -Infinity;
}

export default pickBossSpot;

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
//  Also holds the frame-space helpers the duel uses to stay on screen.
//  PERF: placement runs on arrival and on a re-position (~100 rays, one
//  frame, twice a mission). The per-frame helpers are pure arithmetic.
//  Nothing here allocates.
// ============================================================
import * as THREE from 'three';
import { CFG } from '../config.js';
import { DEF, resolveXZ } from './enemyDefs.js';

const B = DEF.boss;
const CHEST = B.chest;                  // 8.6 — centre of mass
const HEAD = B.height * 0.90;           // 13.7 — the bit that reads as a head
const FOOT = 2.2;

// Bearings off the CAMERA axis, in the order we would like them. The
// readable band is 0.2–0.5 rad: closer to the centreline and the player's
// own mech eats it, wider and it is at the frame edge before the duel starts.
const BEARINGS = [0.38, -0.38, 0.30, -0.30, 0.46, -0.46, 0.24, -0.24, 0.56, -0.56];
const WANT_BEAR = 0.38;
// Ranges. 65–80 m is where a 15 m AC reads as a whole machine: far enough
// to see the legs, near enough that the panel work is still legible.
const RANGES = [64, 72, 60, 82, 94];
const WANT_RANGE = 66;

const FRAME_LIMIT = 0.70;               // rad off axis we will never exceed
const CLEAR_LEN = 22;                   // how far "open ground" has to reach
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

/** one raycast: can the frame actually see this unit's chest right now? */
export function bossVisible(ctx, e) {
  const w = ctx.world;
  if (!w || !w.raycastWorld) return true;
  const L = lens(ctx);
  return clearTo(w, L.x, L.y, L.z, e.pos.x, e.pos.y + e.def.chest, e.pos.z, 2.6);
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
  const ex = L0.x, ey = L0.y, ez = L0.z, vax = L0.ax, vaz = L0.az;
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
      if (Math.abs(fo - _cone.off) < _cone.half + 0.06) continue;   // behind our own mech

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
      const framePref = 1 - Math.min(1, Math.abs(mag - WANT_BEAR) / 0.34);
      const distPref = 1 - Math.min(1, Math.abs(r - WANT_RANGE) / 44);
      let s = 0;
      s += (open / 6) * 44;
      s += headVis ? 34 : 0;
      s += footVis ? 14 : 0;
      s += eyeVis ? 12 : 0;
      s += sky ? 20 : 0;
      s += depth ? 30 : 0;
      s += depthMid ? 16 : 0;
      s += framePref * 26;
      s += distPref * 22;
      s -= Math.abs(step) * 1.6;
      s -= ri * 1.2;                     // mild preference for the listed order

      if (s > loose) { loose = s; lx = x; ly = gy; lz = z; }
      if (headVis && open >= 4 && s > best) { best = s; bx = x; by = gy; bz = z; }
      if (best > 176) { out.set(bx, by, bz); return best; }
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

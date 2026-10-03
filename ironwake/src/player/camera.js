// src/player/camera.js — third-person chase camera (owner: movement designer).
//
// Model: the camera ORBITS a point just above the rig's head along the player's aim (~37 m back,
// 2.2 m to the right so the right-arm rifle clears the torso), so the view axis (reticle) always
// passes over the shoulders and the rig sits in the lower-centre third (22-30% of frame height,
// see `npm run telemetry`). Rotation is 1:1 with the aim;
// translation LAGS through critically damped springs per camera axis (side / up / forward),
// so a quick boost darts the rig off-centre for a moment and the camera catches up.
// Everything is computed at the fixed sim rate in lateUpdate (deterministic, shot-safe);
// frame() only interpolates between the last two sim poses.
//
// Motor reactions (read from game.player.motor.flags every step, no calls needed):
//   quick boost    FOV punch (+qbFovKick, instant attack, ease-out ~0.2 s), a directional jolt
//                  (0.012 rad, gone in 0.15 s), a 0.4 m camera kick opposite to the burst, roll
//                  away from the burst
//   AB wind-up     FOV narrows + camera creeps in while the boosters charge (telegraph)
//   AB launch      big FOV kick on top of the sustained AB FOV + shake + flight rumble; in flight
//                  the camera rises 1.6 m to look down onto the pitched torso and boosters
//   landing        underdamped camera dip scaled by the impact speed (+ shake when hard)
//   ground boost   sustained FOV widening (spring), looser follow = speed read
//   hover / drops  a smaller sustained widening at fast vertical speed (fovClimb)
// Collision: 5 rays (centre + near-plane corners) from the orbit point. A blocker that a lift of
// up to 4.5 m clears (roof edges, container stacks skimming the line) raises the camera instead;
// otherwise pull-in is instant (never clips) and eases back out slowly. The orbit point itself is
// kept out of geometry. Thin props do not pull the camera in (no popping).
// Occluder avoid: 26 rays from the camera to the rig's silhouette; a prop on them makes the
// camera SLIDE (smallest clear offset, up to 4 m sideways / 2.5 m up, critically damped ~0.2 s).
// Whatever no slide clears is cut out (clean hard-edged hole on the arena materials, cutout.js).
// Thin props the camera itself skims past (within ~7 m) are cut near the eye too (cutout.js).
//
// API (game.cam):
//   shake(amount 0..1)                 trauma-based shake (adds up, decays)
//   fovKick(deg, seconds)              temporary FOV widening
//   setOverride({pos, look, fov})      free camera (staged shots, title, cutscenes)
//   clearOverride()
//   snap()                             drop smoothing (after teleports/restarts)
//   pivot                              THREE.Vector3 lagged orbit point
//   metrics                            {fov, dist, lag, lagSide, rigFrac, rigSil, rigTopNdc, rigMidNdc, shake, dip,
//                                       kick (FOV punch deg), sustain (boost/AB FOV deg), lift (m)}
//                                      (sim-rate telemetry, read by tools/telemetry.mjs)
import * as THREE from 'three';
import { CAMERA as C } from './tuning.js';
import { makeHit } from '../core/physics.js';
import { installCutout, updateCutout, updateNearCut } from './cutout.js';

const HFOV_CAP_TAN = Math.tan(Math.PI / 3); // tan(120 deg / 2): chase-camera horizontal FOV cap
const _desired = new THREE.Vector3(), _dir = new THREE.Vector3(), _aim = new THREE.Vector3();
const _right = new THREE.Vector3(), _fwd = new THREE.Vector3(), _target = new THREE.Vector3();
const _m = new THREE.Matrix4(), _o = new THREE.Vector3(), _camUp = new THREE.Vector3(), _camRight = new THREE.Vector3();
const _zero = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0), _q = new THREE.Quaternion();
const _e = new THREE.Euler(0, 0, 0, 'YXZ'), _p = new THREE.Vector3(), _qi = new THREE.Quaternion();
const _hit = makeHit(), _o2 = new THREE.Vector3();
const _base = new THREE.Vector3(), _c0 = new THREE.Vector3(), _t0 = new THREE.Vector3(), _d0 = new THREE.Vector3();
const NO_GROUND = { ground: false };
const PROBES = [[0, 0], [1, 1], [-1, 1], [1, -1], [-1, -1]];
const ATTRACT_FOV = 50;   // title / briefing orbit keeps its own lens (independent of the gameplay FOV)

/** Smooth deterministic noise in [-1,1] (sum of sines). */
function noise(t, seed) {
  return (Math.sin(t * 1.7 + seed) * 0.5 + Math.sin(t * 3.1 + seed * 2.3) * 0.3 + Math.sin(t * 7.3 + seed * 4.1) * 0.2);
}
/** Poles, masts, beams, cables: at least two half-extents under 1 m. */
function isThin(c) {
  if (!c || !c.half) return false;
  const h = c.half;
  return (h.x < 1 ? 1 : 0) + (h.y < 1 ? 1 : 0) + (h.z < 1 ? 1 : 0) >= 2;
}
/**
 * Blocking distance along a camera probe ray. Thin colliders (lamp masts, gantry legs) do not
 * pull the camera in (no popping when a pole sweeps past) unless the camera itself would end
 * up touching one.
 */
function probe(physics, origin, dir, want, pad) {
  let start = 0;
  _o2.copy(origin);
  for (let k = 0; k < 4; k++) {
    if (!physics.raycast(_o2, dir, want + pad - start, _hit, { ground: true })) return want;
    const d = start + _hit.dist;
    if (!isThin(_hit.collider)) return d - pad;
    const thick = 2 * Math.max(_hit.collider.half.x, _hit.collider.half.z) + 0.2;
    if (want > d - pad - 1 && want < d + thick + pad) return d - pad; // camera would touch it
    start = d + thick;
    _o2.copy(origin).addScaledVector(dir, start);
  }
  return want;
}
/** Rig height above its feet from the actual vertices (flames and FX excluded). */
function measureRigHeight(p) {
  const root = p.rig.root, v = new THREE.Vector3();
  let top = -Infinity;
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    const pa = o.isMesh && o.geometry && !o.name.startsWith('flame_') && o.geometry.attributes.position;
    if (!pa) return;
    for (let i = 0; i < pa.count; i++) {
      v.fromBufferAttribute(pa, i).applyMatrix4(o.matrixWorld);
      if (v.y > top) top = v.y;
    }
  });
  return top === -Infinity ? 10.5 : Math.max(4, top - root.getWorldPosition(v).y);
}
/**
 * Pose-aware framing probe (movement r4): per rig mesh, the 14 vertices that are extreme along the
 * 6 axes and 8 diagonals (local space). Projected every step they bound the rig's real silhouette
 * height (a pitched AB pose, trailing legs, a crouch), not an upright H-tall box. Flames excluded.
 */
const EXT_DIRS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
  [1, 1, 1], [1, 1, -1], [1, -1, 1], [1, -1, -1], [-1, 1, 1], [-1, 1, -1], [-1, -1, 1], [-1, -1, -1]];
function collectRigExtremes(p) {
  const out = [], v = new THREE.Vector3();
  p.rig.root.traverse((o) => {
    const pa = o.isMesh && o.geometry && !o.name.startsWith('flame_') && o.name !== 'contact_shadow' && o.geometry.attributes.position;
    if (!pa || !pa.count) return;
    const pts = [];
    for (const d of EXT_DIRS) {
      let best = -Infinity, bi = 0;
      for (let i = 0; i < pa.count; i++) {
        v.fromBufferAttribute(pa, i);
        const s = v.x * d[0] + v.y * d[1] + v.z * d[2];
        if (s > best) { best = s; bi = i; }
      }
      const q = new THREE.Vector3().fromBufferAttribute(pa, bi);
      if (!pts.some((e) => e.distanceToSquared(q) < 1e-6)) pts.push(q);
    }
    out.push({ o, pts });
  });
  return out;
}
function damp(cur, target, lambda, dt) { return cur + (target - cur) * (1 - Math.exp(-lambda * dt)); }
/** Exact critically damped spring toward 0: returns [x, v] through the out array. */
function critToZero(x, v, omega, dt, out) {
  const j1 = v + x * omega, e = Math.exp(-omega * dt);
  out[0] = e * (x + j1 * dt);
  out[1] = e * (v - j1 * omega * dt);
  return out;
}

export default function cameraSystem(game) {
  const pivot = new THREE.Vector3();
  const lagOff = new THREE.Vector3(), lagVel = new THREE.Vector3(), prevTarget = new THREE.Vector3();
  const prevPos = new THREE.Vector3(), curPos = new THREE.Vector3();
  const prevQuat = new THREE.Quaternion(), curQuat = new THREE.Quaternion();
  const sp = [0, 0];
  let prevFov = C.fov, curFov = C.fov;
  let trauma = 0, rumble = 0;
  let kickDeg = 0, kickT = 1e3, kickHold = 0.04, kickDecay = 0.2;
  let roll = 0, rollV = 0;
  let joltT = 1e3, joltSide = 0, joltFwd = 0, kickR = 0, kickRV = 0, kickF = 0, kickFV = 0;
  let dip = 0, dipV = 0;
  let sustain = 0, pull = 0, bank = 0, prevYaw = 0;
  let dist = C.distance;
  let needSnap = true;
  let override = null;
  let attractAngle = 0;
  let rigHeight = 0, rigExt = null, rigExtOf = null;
  let cutK = 0;
  let lift = 0, rise = 0;
  // occluder-avoid slide: current offset + velocity (spring), target, timers
  let slideX = 0, slideY = 0, slideVX = 0, slideVY = 0, slideTX = 0, slideTY = 0;
  let blockT = 0, homeT = 0, searchCd = 0;
  const CANDS = [];   // [side, up] offsets, cheapest first
  for (let iu = 0; iu <= C.slideStepsUp; iu++) {
    for (let is = -C.slideStepsSide; is <= C.slideStepsSide; is++) {
      CANDS.push([(is / C.slideStepsSide) * C.slideMaxSide, (iu / C.slideStepsUp) * C.slideMaxUp]);
    }
  }
  const CCOST = new Float64Array(CANDS.length), CDONE = new Uint8Array(CANDS.length);
  // rig silhouette samples [right m, up m] from the feet (C.slideRows)
  const SAMPLES = [];
  for (const [y, hw, n] of C.slideRows) for (let i = 0; i < n; i++) SAMPLES.push([n > 1 ? -hw + (2 * hw * i) / (n - 1) : 0, y]);
  const metrics = { fov: C.fov, dist: C.distance, lag: 0, lagSide: 0, rigFrac: 0, rigSil: 0, rigTopNdc: 0, rigMidNdc: 0, shake: 0, kickCam: 0, dip: 0, kick: 0, sustain: 0, lift: 0, slide: 0, occluded: 0, nearCut: 0 };

  function kick(deg, hold, decay) {
    // a new kick replaces a weaker, older one; never stacks past the larger
    const cur = kickT < kickHold ? kickDeg : kickDeg * Math.exp(-Math.max(0, kickT - kickHold) * 3 / Math.max(0.01, kickDecay));
    kickDeg = Math.max(deg, cur); kickT = 0; kickHold = hold; kickDecay = decay;
  }

  /** Collision probes for the desired camera at `lift` m above its normal height: sets _dir /
   *  probeWant and returns the allowed distance along _dir from the pivot. */
  let probeWant = 0;
  function probeLift(D, h) {
    _desired.copy(pivot).addScaledVector(_aim, -D);
    _desired.y += C.heightOffset + h + rise + slideY;
    _desired.addScaledVector(_right, C.shoulder + slideX);
    _dir.subVectors(_desired, pivot);
    probeWant = _dir.length();
    _dir.multiplyScalar(1 / Math.max(probeWant, 1e-4));
    // near-plane probe offsets in the camera's right/up plane
    _camRight.crossVectors(_dir, _up); if (_camRight.lengthSq() < 1e-6) _camRight.set(1, 0, 0); _camRight.normalize();
    _camUp.crossVectors(_camRight, _dir).normalize();
    let a = probeWant;
    for (let i = 0; i < PROBES.length; i++) {
      _o.copy(pivot).addScaledVector(_camRight, PROBES[i][0] * C.probeRadius).addScaledVector(_camUp, PROBES[i][1] * C.probeRadius * 0.6);
      a = Math.min(a, probe(game.physics, _o, _dir, a, C.collisionPadding));
    }
    return a;
  }

  /** Rig silhouette rays a camera at `base` + right*ox + up*oy has blocked (stops at `limit`).
   *  `lead` s: camera and rig both advanced along the rig's velocity (predicted occlusion). */
  function blocked(base, feet, vel, lead, ox, oy, limit) {
    _c0.copy(base).addScaledVector(_right, ox).addScaledVector(vel, lead); _c0.y += oy;
    let n = 0;
    for (let i = 0; i < SAMPLES.length; i++) {
      _t0.set(feet.x, feet.y + SAMPLES[i][1], feet.z).addScaledVector(_right, SAMPLES[i][0]).addScaledVector(vel, lead);
      _d0.subVectors(_t0, _c0);
      const len = _d0.length();
      if (len < 3) continue;
      _d0.multiplyScalar(1 / len);
      if (game.physics.raycast(_c0, _d0, len - 1.2, _hit, NO_GROUND) && ++n >= limit) return n;
    }
    return n;
  }
  /** Clear now AND at the predicted pose slideLead s ahead (a sweeping mast is passed in ONE move). */
  function clearAt(base, feet, vel, ox, oy) {
    return blocked(base, feet, vel, 0, ox, oy, 1) === 0 && blocked(base, feet, vel, C.slideLead, ox, oy, 1) === 0;
  }
  /** Occluder avoid: pick the slide target, then spring toward it (sim rate, deterministic). Only a
   *  FULLY clear offset is taken (a partial dodge would swing the camera and still need the cut). */
  function updateSlide(dt, base, feet, vel) {
    const n = clearAt(base, feet, vel, slideTX, slideTY) ? 0 : 1;
    metrics.occluded = n;
    if (n === 0) {
      blockT = 0;
      if (slideTX !== 0 || slideTY !== 0) {
        if (clearAt(base, feet, vel, 0, 0)) {
          homeT += dt;
          if (homeT >= C.slideHome) { slideTX = 0; slideTY = 0; homeT = 0; }
        } else homeT = 0;
      }
    } else {
      homeT = 0; blockT += dt; searchCd -= dt;
      if (blockT >= C.slidePersist && searchCd <= 0) {
        // cheapest clear candidate: distance from the current target, then size
        for (let i = 0; i < CANDS.length; i++) {
          const c = CANDS[i];
          CCOST[i] = (Math.abs(c[0] - slideTX) + Math.abs(c[1] - slideTY)) * 0.4 + (Math.abs(c[0]) + Math.abs(c[1])) * 0.2;
          CDONE[i] = c[0] === slideTX && c[1] === slideTY ? 1 : 0;
        }
        let found = -1;
        for (let k = 0; k < CANDS.length && found < 0; k++) {
          let bi = -1;
          for (let i = 0; i < CANDS.length; i++) if (!CDONE[i] && (bi < 0 || CCOST[i] < CCOST[bi])) bi = i;
          if (bi < 0) break;
          CDONE[bi] = 1;
          if (clearAt(base, feet, vel, CANDS[bi][0], CANDS[bi][1])) found = bi;
        }
        if (found >= 0) { slideTX = CANDS[found][0]; slideTY = CANDS[found][1]; blockT = 0; }
        else { slideTX = 0; slideTY = 0; searchCd = C.slideRetry; }   // no slide clears it: the cutout does
      }
    }
    critToZero(slideX - slideTX, slideVX, C.slideOmega, dt, sp); slideX = sp[0] + slideTX; slideVX = sp[1];
    critToZero(slideY - slideTY, slideVY, C.slideOmega, dt, sp); slideY = sp[0] + slideTY; slideVY = sp[1];
  }

  const api = {
    name: 'camera',
    order: 800,
    pivot,
    metrics,
    get override() { return override; },
    init(g) {
      g.cam = api;
      // before the pipeline warm-up compiles the arena programs (camera inits before pipeline)
      if (g.arena && g.arena.root) api.cutoutMaterials = installCutout(g.arena.root);
    },
    cutoutMaterials: 0,
    reset() { lift = 0; rise = 0; needSnap = true; slideX = slideY = slideVX = slideVY = slideTX = slideTY = 0; blockT = homeT = searchCd = 0; trauma = 0; rumble = 0; kickT = 1e3; kickDeg = 0; joltT = 1e3; kickR = kickRV = kickF = kickFV = 0; roll = rollV = 0; dip = dipV = 0; sustain = 0; pull = 0; bank = 0; },
    shake(amount) { trauma = Math.min(1, trauma + amount); },
    fovKick(deg, seconds = 0.3) { kick(deg, 0.03, seconds); },
    setOverride(o) {
      override = { pos: o.pos.clone(), look: o.look.clone(), fov: o.fov || C.fov };
      api.applyOverride();
    },
    clearOverride() { override = null; needSnap = true; },
    snap() { needSnap = true; },
    /** Reticle ray: origin = camera position (sim-rate), dir = player aim. */
    getAimRay(outOrigin, outDir) {
      const p = game.player;
      if (!p) return false;
      p.getAimDir(outDir);
      if (override || needSnap) api.estimateCameraPos(outOrigin);
      else outOrigin.copy(curPos);
      return true;
    },
    /** Where the chase camera would be (no smoothing/collision) for the current aim. */
    estimateCameraPos(out) {
      const p = game.player;
      p.getAimDir(_aim);
      out.set(p.pos.x, p.pos.y + C.pivotHeight + C.heightOffset, p.pos.z).addScaledVector(_aim, -C.distance);
      const yaw = p.controller.aimYaw;
      out.x += -Math.cos(yaw) * C.shoulder; out.z += Math.sin(yaw) * C.shoulder;
      return out;
    },

    applyOverride() {
      const cam = game.camera;
      cam.position.copy(override.pos);
      cam.up.set(0, 1, 0);
      cam.lookAt(override.look);
      if (cam.fov !== override.fov) { cam.fov = override.fov; cam.updateProjectionMatrix(); }
      if (game.env) game.env.focus.copy(override.look);
    },

    lateUpdate(dt) {
      const p = game.player;
      trauma = Math.max(0, trauma - dt * C.shakeDecay);
      kickT += dt;
      if (!p || !p.spawned) return;
      const m = p.motor, f = m.flags;
      // occlusion cutout strength (sim-rate ease; full at once after a snap)
      const cutT = !override && p.root.visible ? 1 : 0;
      cutK = needSnap ? cutT : damp(cutK, cutT, C.cutEase, dt);
      p.getAimDir(_aim);
      const yaw = p.controller.aimYaw;
      let yawRate = needSnap ? 0 : (yaw - prevYaw); yawRate = Math.atan2(Math.sin(yawRate), Math.cos(yawRate)) / Math.max(dt, 1e-4);
      prevYaw = yaw;
      _right.set(-Math.cos(yaw), 0, Math.sin(yaw));
      _fwd.set(Math.sin(yaw), 0, Math.cos(yaw));

      // --- one-step motor events
      joltT += dt;
      if (f.qb) {
        kick(C.qbFovKick, C.qbFovHold, C.qbFovDecay);
        trauma = Math.min(1, trauma + C.qbShake);
        // roll away from the burst (camera banks against the jolt, then springs back)
        const side = f.qb.x * _right.x + f.qb.z * _right.z;
        rollV += -side * C.qbRoll * 40;
        // jolt: the view yaws against the burst for a few frames (impulse, not a wobble), and the
        // camera body is kicked OPPOSITE to it (critically damped: peak qbKickDist at 1/omega)
        joltT = 0; joltSide = side; joltFwd = f.qb.x * _fwd.x + f.qb.z * _fwd.z;
        const v0 = C.qbKickDist * C.qbKickOmega * Math.E;
        kickRV -= side * v0; kickFV -= joltFwd * v0;
      }
      critToZero(kickR, kickRV, C.qbKickOmega, dt, sp); kickR = sp[0]; kickRV = sp[1];
      critToZero(kickF, kickFV, C.qbKickOmega, dt, sp); kickF = sp[0]; kickFV = sp[1];
      if (f.abLaunch) {
        sustain = C.fovAB; // the launch snaps wide, the kick overshoots on top of it
        kick(C.abLaunchKick, 0.06, C.abLaunchDecay); trauma = Math.min(1, trauma + C.abLaunchShake);
      }
      if (f.landed > 4) {
        dipV -= Math.min(C.landDipMax, f.landed * C.landDipPerMs) * 13;
        if (f.landed > 14) trauma = Math.min(1, trauma + f.landed * C.landShakePerMs);
      }
      rumble = damp(rumble, m.mode === 'ab' && !m.abCharging ? C.abFlightShake : m.abCharging ? C.abFlightShake * m.abCharge : 0, 6, dt);

      // --- lagged orbit point (critically damped per camera axis)
      _target.set(p.pos.x, p.pos.y + C.pivotHeight, p.pos.z);
      if (needSnap) { lagOff.set(0, 0, 0); lagVel.set(0, 0, 0); }
      else {
        lagOff.x -= _target.x - prevTarget.x; lagOff.y -= _target.y - prevTarget.y; lagOff.z -= _target.z - prevTarget.z;
        const sx = lagOff.dot(_right), sy = lagOff.y, sz = lagOff.dot(_fwd);
        const vx = lagVel.dot(_right), vy = lagVel.y, vz = lagVel.dot(_fwd);
        critToZero(sx, vx, C.lagOmegaSide, dt, sp); const nsx = sp[0], nvx = sp[1];
        critToZero(sy, vy, C.lagOmegaUp, dt, sp); const nsy = sp[0], nvy = sp[1];
        critToZero(sz, vz, C.lagOmegaFwd, dt, sp); const nsz = sp[0], nvz = sp[1];
        lagOff.set(0, nsy, 0).addScaledVector(_right, nsx).addScaledVector(_fwd, nsz);
        lagVel.set(0, nvy, 0).addScaledVector(_right, nvx).addScaledVector(_fwd, nvz);
        if (lagOff.y > C.maxLagUp) lagOff.y = C.maxLagUp; else if (lagOff.y < -C.maxLagUp) lagOff.y = -C.maxLagUp;
        const l = lagOff.length();
        if (l > C.maxLag) lagOff.multiplyScalar(C.maxLag / l);
      }
      prevTarget.copy(_target);
      pivot.copy(_target).add(lagOff);

      // --- landing dip (underdamped) + roll kick spring
      dipV += (-150 * dip - 2 * 0.45 * 12.2 * dipV) * dt; dip += dipV * dt;
      rollV += (-220 * roll - 2 * 0.5 * 14.8 * rollV) * dt; roll += rollV * dt;
      const fastK = Math.min(1, Math.max(0, (m.speedH - C.bankMinSpeed) / 40));
      bank = damp(bank, Math.max(-C.bankMax, Math.min(C.bankMax, yawRate * C.bankPerRad)) * fastK, 5, dt);
      pivot.y += dip;

      // keep the orbit point out of geometry (e.g. under a conveyor): ray from the chest
      _o.set(p.pos.x, p.pos.y + 5.5, p.pos.z);
      _dir.subVectors(pivot, _o);
      let pl = _dir.length();
      if (pl > 1e-3) {
        _dir.multiplyScalar(1 / pl);
        if (game.physics.raycast(_o, _dir, pl + 0.6, _hit, { ground: true })) pivot.copy(_o).addScaledVector(_dir, Math.max(0, _hit.dist - 0.6));
      }

      // --- FOV: sustained (boost / AB / wind-up) + kick envelope
      const speed = m.speedH;
      let wide = 0;
      if (m.mode === 'ab') wide = m.abCharging ? C.abChargeFov * m.abCharge : C.fovAB;
      else if (m.mode === 'boost' || m.mode === 'qb' || (m.mode === 'air' && speed > 60)) wide = C.fovBoost * Math.min(1, Math.max(0, (speed - 35) / 45));
      // fast vertical travel (hover climb, long drops) widens a touch too: the climb has thrust
      if (!m.grounded && m.mode !== 'ab') wide = Math.max(wide, C.fovClimb * Math.min(1, Math.max(0, (Math.abs(m.vel.y) - 20) / 35)));
      sustain = damp(sustain, wide, 1 / C.fovTau, dt);
      const env = kickT < kickHold ? 1 : Math.exp(-(kickT - kickHold) * 3 / Math.max(0.01, kickDecay));
      const fov = C.fov + sustain + kickDeg * env;
      const pullT = m.mode === 'ab' ? (m.abCharging ? C.abChargePull * m.abCharge : C.abFlightPull) : 0;
      pull = damp(pull, pullT, m.abCharging ? 4 : 3, dt);
      rise = damp(rise, m.mode === 'ab' && !m.abCharging ? C.abFlightRise : 0, 3, dt);

      // --- desired camera position + collision. Low blockers (a roof edge or container stack
      // skimming the camera line) first LIFT the camera over them (keeps the distance and the
      // framing); only what lifting cannot clear pulls the camera in.
      const D = C.distance - pull;
      // occluder avoid (before the collision probes, so a slide never pushes into geometry)
      _base.copy(pivot).addScaledVector(_aim, -D);
      _base.y += C.heightOffset + lift + rise;
      _base.addScaledVector(_right, C.shoulder);
      if (needSnap) { slideX = slideY = slideVX = slideVY = slideTX = slideTY = 0; homeT = searchCd = 0; blockT = C.slidePersist; }
      updateSlide(dt, _base, p.pos, m.vel);
      if (needSnap) { slideX = slideTX; slideY = slideTY; }
      let liftT = 0;
      if (probeLift(D, lift) < probeWant - 0.3 || lift > 0.05) {
        // smallest lift step that clears the whole line (none clears: stay low and pull in)
        liftT = 0;
        for (let k = 0; k <= C.liftSteps; k++) {
          const h = (k / C.liftSteps) * C.liftMax;
          if (probeLift(D, h) >= probeWant - 0.3) { liftT = h; break; }
        }
      }
      lift = needSnap ? liftT : damp(lift, liftT, liftT > lift ? C.liftUpLambda : C.liftDownLambda, dt);
      let allowed = probeLift(D, lift);
      allowed = Math.max(C.minDistance, allowed);
      if (needSnap || allowed < dist) dist = allowed;               // pull in instantly: never clip
      else dist = damp(dist, allowed, C.pushOutLambda, dt);          // ease back out

      prevPos.copy(curPos); prevQuat.copy(curQuat); prevFov = curFov;
      curPos.copy(pivot).addScaledVector(_dir, dist);
      // QB kick (after the collision probes: a few dm, pulled toward the pivot when it would clip)
      if (kickR !== 0 || kickF !== 0) {
        _o.copy(_right).multiplyScalar(kickR).addScaledVector(_fwd, kickF);
        const kl = _o.length();
        if (kl > 1e-4) {
          _o.multiplyScalar(1 / kl);
          const room = game.physics.raycast(curPos, _o, kl + C.collisionPadding, _hit, { ground: true }) ? Math.max(0, _hit.dist - C.collisionPadding) : kl;
          curPos.addScaledVector(_o, Math.min(kl, room));
        }
      }
      const gy = game.physics.groundHeight ? game.physics.groundHeight(curPos.x, curPos.z) : 0;
      if (curPos.y < gy + 1.2) curPos.y = gy + 1.2;

      // orientation: look down the aim + shake + roll kick (all sim-rate, deterministic)
      _m.lookAt(_zero, _aim, _up);
      curQuat.setFromRotationMatrix(_m);
      const tr = Math.min(1, trauma + rumble);
      const amp = C.shakeMaxRot * Math.pow(tr, C.shakeExp);
      const ts = game.time * C.shakeFreq;
      // QB jolt: (1 - t/T)^2 envelope; yaw starts AGAINST the burst at full amplitude (frame 1)
      const jk = joltT < C.qbJoltDur ? (1 - joltT / C.qbJoltDur) * (1 - joltT / C.qbJoltDur) : 0;
      const ja = C.qbJoltRot * jk, jph = Math.cos(joltT * C.qbJoltFreq * Math.PI * 2);
      const jy = ja * (joltSide * jph * 0.85 + noise(ts * 1.3, 9.1) * 0.3);
      const jp = ja * (joltFwd * jph * 0.6 + noise(ts * 1.3, 5.3) * 0.6);
      _e.set(noise(ts, 1.3) * amp + jp, noise(ts, 7.1) * amp + jy, noise(ts, 3.7) * amp * 1.3 + roll + bank);
      curQuat.multiply(_q.setFromEuler(_e));
      curFov = fov;
      if (needSnap) { prevPos.copy(curPos); prevQuat.copy(curQuat); prevFov = curFov; needSnap = false; }
      if (game.env) game.env.focus.copy(p.pos);

      // --- metrics (telemetry): distance to the rig, lag, projected rig height
      if (!rigHeight && p.rig) rigHeight = measureRigHeight(p);   // once (vertex-precise)
      if (p.rig && rigExtOf !== p.rig) { rigExtOf = p.rig; rigExt = collectRigExtremes(p); }   // once per rig
      const H = rigHeight || 10;
      const th = Math.tan(THREE.MathUtils.degToRad(fov) * 0.5);
      _qi.copy(curQuat).invert();
      // rig HEIGHT in frame (the benchmark's "mech fills 22-30% of frame height": the 10.7 m
      // upright rig from feet to head top, at the rig's own position)
      _p.set(p.pos.x, p.pos.y + H, p.pos.z).sub(curPos).applyQuaternion(_qi);
      const top = _p.y / (-_p.z * th);
      _p.set(p.pos.x, p.pos.y, p.pos.z).sub(curPos).applyQuaternion(_qi);
      const bot = _p.y / (-_p.z * th);
      // rig SILHOUETTE in frame (pose-aware: back weapons, pitched AB torso, trailing legs, crouch)
      let sTop = -Infinity, sBot = Infinity;
      if (rigExt) {
        for (let i = 0; i < rigExt.length; i++) {
          const e = rigExt[i], mw = e.o.matrixWorld;
          for (let j = 0; j < e.pts.length; j++) {
            _p.copy(e.pts[j]).applyMatrix4(mw).sub(curPos).applyQuaternion(_qi);
            if (_p.z > -0.5) continue;
            const y = _p.y / (-_p.z * th);
            if (y > sTop) sTop = y;
            if (y < sBot) sBot = y;
          }
        }
      }
      metrics.rigSil = sTop > sBot ? (sTop - sBot) * 0.5 : 0;
      metrics.fov = fov;
      metrics.dist = Math.hypot(curPos.x - p.pos.x, curPos.y - (p.pos.y + H * 0.5), curPos.z - p.pos.z);
      metrics.lag = lagOff.length();
      metrics.lagSide = lagOff.dot(_right);
      metrics.rigFrac = (top - bot) * 0.5;
      metrics.rigTopNdc = top;
      metrics.rigMidNdc = (top + bot) * 0.5;
      metrics.shake = amp + ja;
      metrics.kickCam = Math.hypot(kickR, kickF);
      metrics.dip = dip;
      metrics.kick = kickDeg * env;
      metrics.sustain = sustain;
      metrics.lift = lift;
      metrics.slide = Math.hypot(slideX, slideY);
    },

    frame(alpha, realDt) {
      const cam = game.camera;
      const p = game.player;
      if (override) { api.applyOverride(); cutK = 0; updateCutout(cam, _zero, 1, C, 0); updateNearCut(cam, null, C, isThin, false); return; }
      if ((game.state === 'title' || game.state === 'briefing') && p && p.spawned) {
        // Attract mode: slow orbit around the parked mech.
        attractAngle += realDt * 0.12;
        const a = attractAngle + p.yaw + 2.4;
        cam.position.set(p.pos.x + Math.sin(a) * 26, p.pos.y + 6.5, p.pos.z + Math.cos(a) * 26);
        _target.set(p.pos.x, p.pos.y + 5.5, p.pos.z);
        cam.up.set(0, 1, 0);
        cam.lookAt(_target);
        if (cam.fov !== ATTRACT_FOV) { cam.fov = ATTRACT_FOV; cam.updateProjectionMatrix(); }
        if (game.env) game.env.focus.copy(p.pos);
        cutK = 0; updateCutout(cam, _zero, 1, C, 0); updateNearCut(cam, null, C, isThin, false);
        return;
      }
      cam.position.lerpVectors(prevPos, curPos, alpha);
      cam.quaternion.slerpQuaternions(prevQuat, curQuat, alpha);
      // ultrawide windows (wider than ~21:9): cap the horizontal FOV at 120 deg (lead engine,
      // QA r1), a fixed vertical FOV would otherwise fisheye the edges; 16:9-21:9 never hit it
      const fovCap = 2 * Math.atan(HFOV_CAP_TAN / Math.max(1e-3, cam.aspect)) * (180 / Math.PI);
      const fov = Math.min(prevFov + (curFov - prevFov) * alpha, fovCap);
      if (Math.abs(cam.fov - fov) > 0.01) { cam.fov = fov; cam.updateProjectionMatrix(); }
      // occlusion cutout around the rendered rig (only under the chase camera)
      if (p && p.spawned) {
        cam.updateMatrixWorld();
        updateCutout(cam, p.root.position, rigHeight || 10.5, C, cutK);
        metrics.nearCut = updateNearCut(cam, game.physics, C, isThin, cutK > 0.5);
      }
    },
  };
  return api;
}

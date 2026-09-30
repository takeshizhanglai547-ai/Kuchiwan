// src/player/camera.js — third-person chase camera (owner: movement designer).
//
// Rigid orbit around a SMOOTHED pivot above the mech along the player's aim (so rotation
// is 1:1 responsive while translation lags a little and sells speed). Collision: a ray
// from the pivot to the desired position pulls the camera in front of static geometry.
//
// API (game.cam):
//   shake(amount 0..1)                 trauma-based shake (adds up, decays)
//   fovKick(deg, seconds)              temporary FOV widening (QB / AB)
//   setOverride({pos, look, fov})      free camera (staged shots, title, cutscenes)
//   clearOverride()
//   snap()                             drop smoothing (after teleports/restarts)
//   pivot                              THREE.Vector3 smoothed pivot
import * as THREE from 'three';
import { CAMERA } from './tuning.js';
import { makeHit } from '../core/physics.js';

const _desired = new THREE.Vector3(), _dir = new THREE.Vector3(), _aim = new THREE.Vector3();
const _right = new THREE.Vector3(), _target = new THREE.Vector3(), _m = new THREE.Matrix4();
const _zero = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0), _q = new THREE.Quaternion();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _hit = makeHit();

/** Smooth deterministic noise in [-1,1] (sum of sines). */
function noise(t, seed) {
  return (Math.sin(t * 1.7 + seed) * 0.5 + Math.sin(t * 3.1 + seed * 2.3) * 0.3 + Math.sin(t * 7.3 + seed * 4.1) * 0.2);
}

export default function cameraSystem(game) {
  const pivot = new THREE.Vector3();
  const prevPos = new THREE.Vector3(), curPos = new THREE.Vector3();
  const prevQuat = new THREE.Quaternion(), curQuat = new THREE.Quaternion();
  let trauma = 0, shakeTime = 0;
  let kick = 0, kickT = 0, kickDur = 0.3;
  let dist = CAMERA.distance;
  let needSnap = true;
  let override = null;
  let attractAngle = 0;
  let abWide = 0; // smoothed extra FOV while assault boosting

  const api = {
    name: 'camera',
    order: 800,
    pivot,
    get override() { return override; },
    init(g) { g.cam = api; },
    reset() { needSnap = true; trauma = 0; kick = 0; kickT = 0; abWide = 0; },
    shake(amount) { trauma = Math.min(1, trauma + amount); },
    fovKick(deg, seconds = 0.3) { kick = Math.max(kick, deg); kickT = seconds; kickDur = seconds; },
    setOverride(o) {
      override = { pos: o.pos.clone(), look: o.look.clone(), fov: o.fov || CAMERA.fov };
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
      out.set(p.pos.x, p.pos.y + CAMERA.pivotHeight + CAMERA.heightOffset, p.pos.z).addScaledVector(_aim, -CAMERA.distance);
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
      trauma = Math.max(0, trauma - dt * 1.6);
      shakeTime += dt;
      if (kickT > 0) kickT -= dt;
      if (!p || !p.spawned) return;

      _target.set(p.pos.x, p.pos.y + CAMERA.pivotHeight, p.pos.z);
      const m = p.motor;
      const wideTarget = !m ? 0 : m.mode === 'ab' ? CAMERA.fovAB : (m.mode === 'boost' || m.mode === 'qb') && m.speedH > m.cfg.boostSpeed * 0.6 ? CAMERA.fovBoost : 0;
      abWide += (wideTarget - abWide) * (1 - Math.exp(-CAMERA.fovLambda * dt));
      const boosting = m && (m.mode === 'ab' || m.mode === 'qb' || m.mode === 'boost');
      if (needSnap) {
        pivot.copy(_target);
      } else {
        const lambda = boosting ? CAMERA.boostLagLambda : CAMERA.followLambda;
        pivot.lerp(_target, 1 - Math.exp(-lambda * dt));
        // never lag more than a few meters
        _dir.subVectors(pivot, _target);
        const lag = _dir.length();
        if (lag > CAMERA.maxLag) pivot.copy(_target).addScaledVector(_dir, CAMERA.maxLag / lag);
      }

      p.getAimDir(_aim);
      _right.set(-Math.cos(p.controller.aimYaw), 0, Math.sin(p.controller.aimYaw));
      _desired.copy(pivot).addScaledVector(_aim, -CAMERA.distance);
      _desired.y += CAMERA.heightOffset;
      _desired.addScaledVector(_right, CAMERA.shoulder);

      // Collision: pull in front of static geometry (smoothly back out).
      _dir.subVectors(_desired, pivot);
      const want = _dir.length();
      _dir.multiplyScalar(1 / Math.max(want, 1e-4));
      let allowed = want;
      if (game.physics.raycast(pivot, _dir, want + CAMERA.collisionPadding, _hit, { ground: true })) {
        allowed = Math.max(CAMERA.minDistance, _hit.dist - CAMERA.collisionPadding);
      }
      dist = allowed < dist ? allowed : dist + (allowed - dist) * (1 - Math.exp(-6 * dt));
      if (needSnap) dist = allowed;

      prevPos.copy(curPos); prevQuat.copy(curQuat);
      curPos.copy(pivot).addScaledVector(_dir, dist);
      _m.lookAt(_zero, _aim, _up);
      curQuat.setFromRotationMatrix(_m);
      if (needSnap) { prevPos.copy(curPos); prevQuat.copy(curQuat); needSnap = false; }
      if (game.env) game.env.focus.copy(p.pos);
    },

    frame(alpha, realDt) {
      const cam = game.camera;
      if (override) { api.applyOverride(); return; }
      const p = game.player;
      if ((game.state === 'title' || game.state === 'briefing') && p && p.spawned) {
        // Attract mode: slow orbit around the parked mech.
        attractAngle += realDt * 0.12;
        const a = attractAngle + p.yaw + 2.4;
        cam.position.set(p.pos.x + Math.sin(a) * 26, p.pos.y + 6.5, p.pos.z + Math.cos(a) * 26);
        _target.set(p.pos.x, p.pos.y + 5.5, p.pos.z);
        cam.up.set(0, 1, 0);
        cam.lookAt(_target);
        if (cam.fov !== CAMERA.fov) { cam.fov = CAMERA.fov; cam.updateProjectionMatrix(); }
        if (game.env) game.env.focus.copy(p.pos);
        return;
      }
      cam.position.lerpVectors(prevPos, curPos, alpha);
      cam.quaternion.slerpQuaternions(prevQuat, curQuat, alpha);
      // Shake (rotation only, trauma^2 falloff)
      const s = trauma * trauma;
      if (s > 1e-4) {
        _e.set(noise(shakeTime * 9, 1.3) * 0.035 * s, noise(shakeTime * 9, 7.1) * 0.035 * s, noise(shakeTime * 9, 3.7) * 0.05 * s);
        cam.quaternion.multiply(_q.setFromEuler(_e));
      }
      const k = kickT > 0 ? kick * Math.sin(Math.min(1, kickT / kickDur) * Math.PI * 0.5) : 0;
      const fov = CAMERA.fov + k + abWide;
      if (Math.abs(cam.fov - fov) > 0.01) { cam.fov = fov; cam.updateProjectionMatrix(); }
    },
  };
  return api;
}

// ============================================================
//  core/postfxShake.js — camera trauma / screen shake.
//  [owned by fx-post]
//
//  ART_DIRECTION §5: "Screen shake is short and sharp (a decaying noise,
//  not a sine wave), and never rotates more than ~1 degree."
//
//  Model: a 0..1 `trauma` accumulator. Displacement uses trauma^2 so the
//  tail dies fast and the hit reads as a punch rather than a wobble. The
//  signal itself is 2-octave value noise at 30 Hz / 71 Hz — at 60 fps that
//  steps roughly half a noise cell per frame, which looks like a rattling
//  gun mount, not an oscillator.
//
//  The rig mutates the camera in place immediately before the composer
//  renders, then restores it, so nothing downstream (player camera, lock-on
//  projection, HUD world-space markers) ever sees the shaken transform.
// ============================================================
import * as THREE from 'three';

const MAX_ROT = 0.01571;   // 0.90 deg — the hard ceiling from the art bible
const POS_AMP = 0.62;      // metres of translation at full trauma

// ---- deterministic random table -> 1D value noise --------------------
const TABLE = new Float32Array(512);
{
  let s = 0x9e3779b9 >>> 0;
  for (let i = 0; i < 512; i++) {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;  s >>>= 0;
    TABLE[i] = (s / 4294967296) * 2 - 1;
  }
}

function vnoise(x) {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  const a = TABLE[i & 511];
  const b = TABLE[(i + 1) & 511];
  return a + (b - a) * u;
}

/** 2-octave noise on its own time axis. `off` decorrelates the channels. */
function axis(t, off) {
  return vnoise(t * 30 + off) * 0.66 + vnoise(t * 71 + off * 1.7) * 0.34;
}

export class CameraShake {
  constructor() {
    this.trauma = 0;
    this.rate = 4.2;          // trauma units per second
    this.t = 0;
    this.active = false;

    this._savePos = new THREE.Vector3();
    this._saveQuat = new THREE.Quaternion();
    this._off = new THREE.Vector3();
    this._euler = new THREE.Euler();
    this._q = new THREE.Quaternion();
  }

  reset() {
    this.trauma = 0;
    this.active = false;
    this.rate = 4.2;
  }

  /** @param {number} amount 0..1 trauma to inject
   *  @param {number} duration seconds this shake should take to die out */
  add(amount = 0.4, duration = 0.28) {
    const a = Math.min(1, Math.max(0, amount));
    if (a <= 0) return;
    // a bigger hit is allowed to redefine how long the rattle lasts
    if (a >= this.trauma * 0.6) {
      this.rate = 1 / Math.min(1.4, Math.max(0.07, duration || 0.28));
    }
    this.trauma = Math.min(1, this.trauma + a);
  }

  /** Decay + apply. Returns true if the camera was displaced (caller must
   *  then call restore() after rendering). `rdt` is REAL seconds — shake
   *  must not slow down during a hit-freeze. */
  apply(camera, rdt, scale = 1) {
    this.t += rdt;
    this.trauma = Math.max(0, this.trauma - this.rate * rdt);
    const s = this.trauma * this.trauma;
    if (s < 1.5e-4 || scale <= 0) { this.active = false; return false; }

    this._savePos.copy(camera.position);
    this._saveQuat.copy(camera.quaternion);

    const t = this.t;
    const amp = POS_AMP * s * scale;
    this._off.set(
      axis(t, 0)   * amp,
      axis(t, 137) * amp * 0.80,
      axis(t, 311) * amp * 0.34,
    ).applyQuaternion(camera.quaternion);
    camera.position.add(this._off);

    const ra = MAX_ROT * s * scale;
    this._euler.set(
      axis(t, 523) * ra * 0.45,   // pitch
      axis(t, 761) * ra * 0.45,   // yaw
      axis(t, 907) * ra * 0.90,   // roll — the readable one
      'XYZ',
    );
    this._q.setFromEuler(this._euler);
    camera.quaternion.multiply(this._q);

    this.active = true;
    return true;
  }

  restore(camera) {
    if (!this.active) return;
    camera.position.copy(this._savePos);
    camera.quaternion.copy(this._saveQuat);
    this.active = false;
  }
}

export default CameraShake;

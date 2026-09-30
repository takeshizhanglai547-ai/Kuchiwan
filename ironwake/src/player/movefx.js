// src/player/movefx.js — movement feedback particles for the player rig (owner: movement
// designer). Registers a few MOVEMENT-specific effects on game.fx (names prefixed `mv_`, so they
// never collide with the VFX artist's library) and emits them from motor state:
//   mv_skid      directional ground spray + foot-pad sparks (hard turns, braking skids)
//   mv_wake      low rooster-tail dust behind the feet while ground boosting
//   mv_qb_ring   ground pressure ring under a quick boost near the ground
//   mv_land      landing dust ring + grit, scaled by impact speed
//   mv_ab_charge nozzle heat sparks during the assault-boost wind-up
//   mv_ab_launch launch blast behind the rig (burst + smoke + ring)
//   mv_speed     faint streaks passing the camera at high speed (speed read)
// All positional randomness uses the RNG stream 'movefx' (deterministic, independent).
import * as THREE from 'three';

// Parts use the VFX lane's particle format (src/fx/library.js header): lit, noise-ERODED billow
// puffs (never flat discs: combat r1 tell), low alpha, strongly varied sizes, fade-in, swirl, so
// overlapping puffs read as one ragged volume; grit is 3D chunks, sparks are heat-ramped streaks.
// Albedo colours (lit) match the slab: ash-concrete dust, a touch warmer / darker than the ground.
const DUST = [0.3, 0.27, 0.235], DUST_D = [0.24, 0.22, 0.2], DUST_L = [0.36, 0.33, 0.29];
const HOT = [3.8, 1.6, 0.38], HOT_D = [1.3, 0.24, 0.03];
export const MOVE_FX = {
  mv_skid: [
    { shape: 'puff', count: [2, 3], life: [0.7, 1.5], speed: [8, 24], dirMode: 'dir', cone: 34, size: [0.9, 6.5], sizePow: 2.4, color0: DUST, alpha: [0.44, 0], fadeIn: 0.06, erode: [0.05, 0.66], drag: 2.8, rise: 1.0, turb: 1.4, lit: true, jitter: 1.0, spin: [-0.9, 0.9] },
    { shape: 'puff', count: [0, 1], life: [0.35, 0.6], speed: [16, 30], dirMode: 'dir', cone: 22, size: [0.5, 2.4], sizePow: 2, color0: DUST_D, alpha: [0.4, 0], erode: [0.12, 0.72], drag: 4, lit: true, spin: [-2, 2] },
    { shape: 'chunk', count: [1, 2], life: [0.3, 0.6], speed: [12, 26], dirMode: 'dir', cone: 30, size: [0.2, 0.16], color0: [0.3, 0.28, 0.25], variant: [0, 11], gravity: 30, collide: true, bounce: 0.3, spin: [-15, 15] },
    { shape: 'spark', count: [2, 4], life: [0.1, 0.28], speed: [16, 42], dirMode: 'dir', cone: 40, size: [0.14, 0.05], stretch: 0.035, color0: HOT, color1: HOT_D, heat: [1, 0.3], gravity: 26, drag: 1.2, collide: true, bounce: 0.3 },
  ],
  mv_wake: [
    // rooster tail: a few big slow billows + small fast kicked puffs, all ragged
    { shape: 'puff', count: [1, 2], life: [0.9, 1.8], speed: [4, 14], dirMode: 'dir', cone: 34, size: [0.8, 7.5], sizePow: 2.6, color0: DUST, alpha: [0.4, 0], fadeIn: 0.08, erode: [0.04, 0.66], drag: 2.4, rise: 1.6, turb: 1.6, lit: true, jitter: 1.1, spin: [-0.6, 0.6] },
    // ground-hugging wash: flat eroded sheets sliding out behind the feet
    { shape: 'puff', count: [0, 1], life: [0.5, 0.9], speed: [8, 18], dirMode: 'dir', cone: 18, size: [2.0, 8.5], sizePow: 1.8, color0: DUST_D, alpha: [0.3, 0], fadeIn: 0.05, erode: [0.1, 0.7], drag: 3, orient: 'up', lit: true, spin: [-0.4, 0.4] },
    { shape: 'puff', count: [0, 1], life: [0.3, 0.55], speed: [14, 26], dirMode: 'dir', cone: 20, size: [0.4, 2.2], sizePow: 2, color0: DUST_L, alpha: [0.3, 0], erode: [0.15, 0.75], drag: 4, lit: true, spin: [-2, 2] },
    { shape: 'chunk', count: [0, 1], life: [0.3, 0.55], speed: [10, 20], dirMode: 'dir', cone: 25, size: [0.16, 0.14], color0: [0.3, 0.28, 0.25], variant: [0, 11], gravity: 30, collide: true, bounce: 0.3, spin: [-15, 15] },
  ],
  mv_qb_ring: [
    { shape: 'puff', count: [14, 14], life: [0.4, 0.8], speed: [24, 44], dirMode: 'ring', size: [1.0, 5.2], sizePow: 2.4, color0: DUST, alpha: [0.46, 0], fadeIn: 0.04, erode: [0.06, 0.7], drag: 4.5, rise: 0.8, turb: 1.4, lit: true, jitter: 0.8, spin: [-1, 1], scaleCount: false },
    { shape: 'puff', count: [6, 6], life: [0.25, 0.45], speed: [40, 60], dirMode: 'ring', size: [0.6, 2.6], sizePow: 2, color0: DUST_L, alpha: [0.3, 0], erode: [0.15, 0.75], drag: 5, lit: true, spin: [-2, 2], scaleCount: false },
    { shape: 'chunk', count: [5, 7], life: [0.35, 0.7], speed: [18, 34], dirMode: 'ring', size: [0.2, 0.16], color0: [0.3, 0.28, 0.25], variant: [0, 11], gravity: 30, collide: true, bounce: 0.3, spin: [-15, 15], scaleCount: false },
  ],
  mv_land: [
    { shape: 'puff', count: [12, 12], life: [0.7, 1.4], speed: [12, 30], dirMode: 'ring', size: [1.2, 6.5], sizePow: 2.5, color0: DUST, alpha: [0.52, 0], fadeIn: 0.05, erode: [0.05, 0.68], drag: 3.2, rise: 1.2, turb: 1.4, lit: true, jitter: 1.0, spin: [-1, 1], scaleCount: false },
    { shape: 'puff', count: [4, 4], life: [0.35, 0.6], speed: [26, 40], dirMode: 'ring', size: [0.6, 2.8], sizePow: 2, color0: DUST_L, alpha: [0.34, 0], erode: [0.15, 0.75], drag: 4.5, lit: true, spin: [-2, 2], scaleCount: false },
    { shape: 'chunk', count: [6, 10], life: [0.5, 0.9], speed: [8, 18], dirMode: 'up', cone: 70, size: [0.26, 0.22], color0: [0.3, 0.28, 0.25], variant: [0, 11], gravity: 32, collide: true, bounce: 0.3, spin: [-15, 15] },
  ],
  mv_ab_charge: [
    { shape: 'spark', count: [1, 2], life: [0.06, 0.12], speed: [4, 14], dirMode: 'dir', cone: 20, size: [0.8, 0.25], stretch: 0.02, color0: [3.2, 1.5, 0.45], color1: [1, 0.3, 0.06], heat: [1, 0.6], nosoft: true },
    { shape: 'spark', count: [0, 1], life: [0.15, 0.3], speed: [6, 16], dirMode: 'sphere', size: [0.12, 0.03], stretch: 0.03, color0: HOT, color1: HOT_D, heat: [1, 0.3], gravity: 8 },
  ],
  mv_ab_launch: [
    { shape: 'spark', count: [12, 16], life: [0.08, 0.22], speed: [30, 95], dirMode: 'dir', cone: 20, size: [0.8, 0.25], stretch: 0.015, color0: [2.2, 1.05, 0.35], color1: [0.8, 0.22, 0.05], heat: [1, 0.5], drag: 2.5, jitter: 0.6 },
    { shape: 'puff', count: [4, 5], life: [0.08, 0.16], speed: [30, 60], dirMode: 'dir', cone: 12, size: [1.2, 4.2], sizePow: 2, color0: [0.035, 0.034, 0.034], alpha: [0.9, 0], heat: [1, 0.5], add: [1, 0.9], erode: [0.12, 0.85], drag: 5, spin: [-4, 4] },
    { shape: 'puff', count: [6, 8], life: [0.8, 1.6], speed: [5, 16], dirMode: 'dir', cone: 40, size: [2, 9], sizePow: 2.5, color0: [0.42, 0.4, 0.37], alpha: [0.36, 0], fadeIn: 0.05, erode: [0.05, 0.66], drag: 2.8, rise: 1.2, turb: 1.5, lit: true, jitter: 1.2, spin: [-0.8, 0.8] },
    // pressure wave as refraction only (a bright camera-facing ring read as a UI hologram)
    { kind: 'distort', shape: 'ring', size: [2, 18], life: 0.28, strength: 0.6 },
  ],
  mv_speed: [
    // ash motes smeared by speed (not crisp 'rain' lines): warm grey, short, faint
    { shape: 'spark', count: [1, 1], life: [0.16, 0.26], speed: [40, 55], dirMode: 'dir', cone: 2, size: [0.16, 0.08], color0: [1.0, 0.9, 0.78], color1: [0.5, 0.44, 0.38], alpha: [0.3, 0], stretch: 0.09, nosoft: true },
  ],
  mv_speed_ab: [
    // assault boost: longer, brighter ash streaks rushing past the lens + a faint smeared mote
    { shape: 'spark', count: [1, 1], life: [0.14, 0.22], speed: [70, 95], dirMode: 'dir', cone: 2, size: [0.2, 0.1], color0: [1.2, 1.05, 0.9], color1: [0.55, 0.48, 0.4], alpha: [0.38, 0], stretch: 0.1, nosoft: true },
    { shape: 'puff', count: [0, 1], life: [0.25, 0.4], speed: [50, 70], dirMode: 'dir', cone: 4, size: [0.6, 1.8], color0: [0.36, 0.33, 0.29], alpha: [0.12, 0], erode: [0.2, 0.8], stretch: 0.03, lit: true },
  ],
};

const _v = new THREE.Vector3(), _d = new THREE.Vector3(), _c = new THREE.Vector3(), _r = new THREE.Vector3();

export class MoveFx {
  constructor(game) {
    this.game = game;
    this.rng = game.rng.stream('movefx');
    this.t = 0; this.speedT = 0; this.wakeT = 0; this.chargeT = 0; this.washT = 0;
  }

  /** Register the effects (call when game.fx is live; idempotent). */
  register() {
    const fx = this.game.fx;
    if (!fx.register) return;
    for (const k in MOVE_FX) fx.register(k, MOVE_FX[k]);
  }

  reset() { this.t = 0; this.speedT = 0; this.wakeT = 0; this.chargeT = 0; this.washT = 0; }

  /** One-shot: quick boost onset. dir = world burst direction. */
  qb(player, dir) {
    const fx = this.game.fx, p = player.pos;
    const h = p.y - this.game.physics.groundHeight(p.x, p.z);
    if (h < 6) fx.spawn('mv_qb_ring', _v.set(p.x, p.y + 0.4, p.z), null, 1 - h / 12);
    if (player.motor.grounded) fx.spawn('mv_skid', _v.set(p.x, p.y + 0.5, p.z), _d.set(-dir.x, 0.25, -dir.z), 1.6);
  }

  land(player, speed) {
    const p = player.pos, s = Math.min(2.2, 0.5 + speed / 25);
    this.game.fx.spawn('mv_land', _v.set(p.x, p.y + 0.3, p.z), null, s);
  }

  abLaunch(player, dir) {
    const p = player.pos;
    _v.set(p.x - dir.x * 3, p.y + 6.5, p.z - dir.z * 3);
    this.game.fx.spawn('mv_ab_launch', _v, _d.set(-dir.x, -dir.y - 0.1, -dir.z), 1);
    const h = p.y - this.game.physics.groundHeight(p.x, p.z);
    if (h < 8) this.game.fx.spawn('mv_qb_ring', _v.set(p.x, p.y + 0.4, p.z), null, 1.2);
  }

  /** Continuous emitters, once per fixed step. */
  step(dt, player) {
    const game = this.game, fx = game.fx, m = player.motor, rig = player.rig, rng = this.rng;
    if (!rig) return;
    this.t += dt;
    const sp = m.speedH;
    const v = m.vel;
    // ground wake + skid from the feet
    if (m.grounded && (m.mode === 'boost' || m.mode === 'qb' || m.skid > 0.05) && sp > 20) {
      const rate = m.skid > 0.3 ? 44 : m.mode === 'qb' ? 40 : 30 * Math.min(1, sp / 85);
      this.wakeT -= dt * rate;
      while (this.wakeT <= 0) {
        this.wakeT += 1;
        const foot = rng.chance(0.5) ? 'foot_L' : 'foot_R';
        rig.getNodeWorld(foot, _v); _v.y = player.pos.y + 0.4;
        const k = 1 / Math.max(1, sp);
        if (m.skid > 0.3) {
          // spray forward-out along the slide (the feet are braking against it)
          _d.set(v.x * k + rng.sym(0.3), 0.35, v.z * k + rng.sym(0.3));
          fx.spawn('mv_skid', _v, _d, 0.8 + m.skid * 0.7);
        } else {
          _d.set(-v.x * k, 0.45, -v.z * k);
          fx.spawn('mv_wake', _v, _d, 0.7 + 0.5 * Math.min(1, sp / 85));
        }
      }
    }
    // thruster wash: low flight (AB / air boost) kicks dust up from the slab below
    const alt = player.pos.y - game.physics.groundHeight(player.pos.x, player.pos.z);
    if (!m.grounded && alt < 16 && ((m.mode === 'ab' && !m.abCharging) || (m.mode === 'qb') || m.mode === 'hover')) {
      this.washT -= dt * 55 * (1 - alt / 16);
      while (this.washT <= 0) {
        this.washT += 1;
        _v.set(player.pos.x - v.x * 0.03 + rng.sym(3), game.physics.groundHeight(player.pos.x, player.pos.z) + 0.4, player.pos.z - v.z * 0.03 + rng.sym(3));
        const k = 1 / Math.max(1, sp);
        _d.set(-v.x * k * 0.8 + rng.sym(0.5), 0.3, -v.z * k * 0.8 + rng.sym(0.5));
        fx.spawn('mv_wake', _v, _d, 1.3 - alt / 20);
      }
    }
    // AB wind-up: sparks from the rear nozzles, growing with the charge
    if (m.abCharging) {
      this.chargeT -= dt * (12 + 40 * m.abCharge);
      while (this.chargeT <= 0) {
        this.chargeT += 1;
        const nz = rig.nozzles.length ? rig.nozzles[rng.int(0, rig.nozzles.length - 1)] : null;
        if (!nz || nz.group !== 'back') continue;
        nz.node.getWorldPosition(_v);
        nz.node.getWorldDirection(_d).negate();
        fx.spawn('mv_ab_charge', _v, _d, 0.6 + m.abCharge * 0.8);
      }
    }
    // speed streaks near the camera path (AB / QB / fast boost)
    const fast = (m.mode === 'ab' && !m.abCharging) || m.mode === 'qb' || sp > 70;
    // (gameplay camera only: under a staged/free camera they would read as rain)
    if (fast && game.cam && game.cam.getAimRay && !game.cam.override) {
      const ab = m.mode === 'ab';
      const rate = ab ? 200 : m.mode === 'qb' ? 70 : 28;
      this.speedT -= dt * rate;
      if (this.speedT <= 0) game.cam.getAimRay(_c, _r);
      while (this.speedT <= 0) {
        this.speedT += 1;
        // a point ahead of the camera, off the view axis (never in the rig's face)
        const ahead = rng.range(18, 60), side = rng.sym(1), up = rng.sym(1);
        _v.copy(_c).addScaledVector(_r, ahead);
        const sgn = side < 0 ? -1 : 1, lat = sgn * (7 + ahead * 0.22 + Math.abs(side) * ahead * 0.35);
        _v.x += (-_r.z) * lat + rng.sym(2);
        _v.z += (_r.x) * lat + rng.sym(2);
        _v.y += up * (4 + ahead * 0.3);
        const gy = game.physics.groundHeight(_v.x, _v.z);
        if (_v.y < gy + 0.5) _v.y = gy + 0.5 + rng.range(0, 2);
        // motes stream radially out of the view centre (the focus of expansion) and back past
        // the camera, so the billboard stretch draws classic speed lines
        _d.copy(_v).sub(_c).addScaledVector(_r, -ahead);            // radial offset from the view axis
        const rl = _d.length() || 1;
        _d.multiplyScalar(0.75 / rl).addScaledVector(_r, -0.65);
        fx.spawn(ab ? 'mv_speed_ab' : 'mv_speed', _v, _d, 1);
      }
    }
  }
}

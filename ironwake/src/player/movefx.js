// src/player/movefx.js — movement feedback particles for the player rig (owner: movement
// designer). Registers a few MOVEMENT-specific effects on game.fx (names prefixed `mv_`, so they
// never collide with the VFX artist's library) and emits them from motor state:
//   mv_skid      directional ground spray + foot-pad sparks (hard turns, braking skids)
//   mv_wake      low rooster-tail dust behind the feet while ground boosting
//   mv_wash      thruster downwash under low flight (AB / QB / hover): flattened dust sheets
//   mv_qb_ring   ground pressure ring under a quick boost near the ground
//   mv_land      landing dust ring + grit, scaled by impact speed
//   mv_ab_charge nozzle heat sparks during the assault-boost wind-up
//   mv_ab_launch launch blast behind the rig (burst + smoke ring around the flight axis)
//   mv_ab_ring   flat dust blast on the slab under an assault-boost launch
//   mv_speed     faint streaks passing the camera at high speed (speed read)
// All positional randomness uses the RNG stream 'movefx' (deterministic, independent).
import * as THREE from 'three';

// Parts use the VFX lane's particle format (src/fx/library.js header): lit, noise-ERODED billow
// puffs (never flat discs: combat r1 tell), low alpha, strongly varied sizes, fade-in, swirl, so
// overlapping puffs read as one ragged volume; grit is 3D chunks, sparks are heat-ramped streaks.
// Albedo colours (lit) match the slab: ash-concrete dust, a touch warmer / darker than the ground.
const DUST = [0.3, 0.27, 0.235], DUST_D = [0.24, 0.22, 0.2], DUST_L = [0.36, 0.33, 0.29];
const DUST_W = [0.44, 0.4, 0.35];   // fresh, fine dust thrown up by the boost: lighter than the slab
const GRIT = [0.12, 0.11, 0.1];      // chunks are unlit sprites: keep them dark (light ones read as white pellets)
const HOT = [3.8, 1.6, 0.38], HOT_D = [1.3, 0.24, 0.03];
export const MOVE_FX = {
  mv_skid: [
    { shape: 'puff', count: [2, 3], life: [0.7, 1.5], speed: [8, 24], dirMode: 'dir', cone: 34, size: [0.9, 6.5], sizePow: 2.4, stretch: 0.08, color0: DUST, alphaPow: 0.7, alpha: [0.34, 0], fadeIn: 0.06, erode: [0.08, 0.6], drag: 2.8, rise: 1.0, turb: 1.6, lit: true, jitter: 1.0 },
    { shape: 'puff', count: [0, 1], life: [0.35, 0.6], speed: [16, 30], dirMode: 'dir', cone: 22, size: [0.5, 2.4], sizePow: 2, color0: DUST_D, alphaPow: 0.7, alpha: [0.4, 0], erode: [0.12, 0.6], drag: 4, lit: true, spin: [-2, 2] },
    { shape: 'chunk', count: [1, 2], life: [0.3, 0.6], speed: [12, 26], dirMode: 'dir', cone: 30, size: [0.2, 0.16], color0: GRIT, variant: [0, 11], gravity: 30, collide: true, bounce: 0.3, spin: [-15, 15] },
    { shape: 'spark', count: [2, 4], life: [0.1, 0.28], speed: [16, 42], dirMode: 'dir', cone: 40, size: [0.14, 0.05], stretch: 0.035, color0: HOT, color1: HOT_D, heat: [1, 0.3], gravity: 26, drag: 1.2, collide: true, bounce: 0.3 },
  ],
  mv_wake: [
    // rooster tail (combat r2: a CONTINUOUS low spray, not a breadcrumb of round puffs): emitted
    // every step from the feet, thrown back + up and smeared along its own velocity (stretch), so
    // overlapping low-alpha billows read as one ragged, streaming sheet
    { shape: 'puff', count: [1, 1], life: [0.8, 1.6], speed: [12, 26], dirMode: 'dir', cone: 22, size: [1.0, 6.0], sizePow: 2.3, stretch: 0.11, color0: DUST_W, alpha: [0.4, 0], alphaPow: 0.7, fadeIn: 0.05, erode: [0.08, 0.6], drag: 3.2, rise: 1.5, turb: 1.8, lit: true, jitter: 0.9 },
    // ground-hugging wash: flat eroded sheets sliding out behind the feet
    { shape: 'puff', count: [0, 1], life: [0.6, 1.2], speed: [6, 14], dirMode: 'dir', cone: 26, size: [1.8, 8], sizePow: 1.8, color0: DUST, alphaPow: 0.7, alpha: [0.3, 0], fadeIn: 0.08, erode: [0.12, 0.6], drag: 3, orient: 'up', lit: true, spin: [-0.4, 0.4] },
    // kicked grit streaks + the odd chip
    { shape: 'puff', count: [0, 1], life: [0.25, 0.45], speed: [22, 36], dirMode: 'dir', cone: 16, size: [0.3, 1.4], sizePow: 2, stretch: 0.06, color0: DUST_L, alphaPow: 0.7, alpha: [0.3, 0], erode: [0.2, 0.6], drag: 4, lit: true },
    { shape: 'chunk', count: [0, 1], life: [0.3, 0.55], speed: [10, 20], dirMode: 'dir', cone: 25, size: [0.16, 0.14], color0: GRIT, variant: [0, 11], gravity: 30, collide: true, bounce: 0.3, spin: [-15, 15] },
  ],
  mv_wash: [
    // thruster downwash under a low flight (AB / QB / hover): the dust is FLATTENED and slides out
    // sideways (ground-oriented eroded sheets + low streaks). Nothing billows up into the chase
    // camera's path (combat r2: a rising puff column read as a stack of cotton balls)
    { shape: 'puff', count: [1, 1], life: [0.4, 0.8], speed: [14, 28], dirMode: 'dir', cone: 55, size: [2.0, 9], sizePow: 1.6, color0: DUST, alphaPow: 0.7, alpha: [0.22, 0], fadeIn: 0.06, erode: [0.14, 0.6], drag: 3.5, orient: 'up', lit: true, spin: [-0.6, 0.6] },
    { shape: 'puff', count: [0, 1], life: [0.3, 0.55], speed: [24, 44], dirMode: 'dir', cone: 65, size: [0.6, 2.6], sizePow: 2, stretch: 0.08, color0: DUST_W, alphaPow: 0.7, alpha: [0.24, 0], erode: [0.16, 0.6], drag: 4, rise: 0.3, lit: true },
  ],
  mv_qb_ring: [
    // pressure blast flattening the dust outward: radial streaks (stretched by their speed) + a
    // few slower billows, many at low alpha so no single puff outline reads
    { shape: 'puff', count: [18, 18], life: [0.4, 0.85], speed: [24, 48], dirMode: 'ring', size: [0.9, 4.6], sizePow: 2.4, stretch: 0.07, color0: DUST, alphaPow: 0.7, alpha: [0.3, 0], fadeIn: 0.04, erode: [0.1, 0.6], drag: 4.5, rise: 0.8, turb: 1.6, lit: true, jitter: 1.2, scaleCount: false },
    { shape: 'puff', count: [8, 8], life: [0.25, 0.45], speed: [44, 66], dirMode: 'ring', size: [0.5, 2.2], sizePow: 2, stretch: 0.06, color0: DUST_L, alphaPow: 0.7, alpha: [0.24, 0], erode: [0.18, 0.6], drag: 5, lit: true, scaleCount: false },
    { shape: 'chunk', count: [5, 7], life: [0.35, 0.7], speed: [18, 34], dirMode: 'ring', size: [0.2, 0.16], color0: GRIT, variant: [0, 11], gravity: 30, collide: true, bounce: 0.3, spin: [-15, 15], scaleCount: false },
  ],
  mv_ab_ring: [
    // assault-boost launch blast on the slab: FLAT sheets + low streaks racing outward (the chase
    // camera passes right over this spot a moment later, so nothing billows up into its path)
    { shape: 'puff', count: [10, 10], life: [0.35, 0.7], speed: [30, 55], dirMode: 'ring', size: [1.5, 7.5], sizePow: 1.8, color0: DUST, alphaPow: 0.7, alpha: [0.26, 0], fadeIn: 0.04, erode: [0.12, 0.6], drag: 4.5, orient: 'up', lit: true, spin: [-1, 1], scaleCount: false },
    { shape: 'puff', count: [8, 8], life: [0.25, 0.45], speed: [44, 66], dirMode: 'ring', size: [0.5, 2.2], sizePow: 2, stretch: 0.06, color0: DUST_L, alphaPow: 0.7, alpha: [0.22, 0], erode: [0.18, 0.6], drag: 5, rise: 0.3, lit: true, scaleCount: false },
  ],
  mv_land: [
    // landing: radial streaked billows + flat sheets hugging the slab (no translucent dome), dark grit
    { shape: 'puff', count: [8, 8], life: [0.6, 1.2], speed: [14, 32], dirMode: 'ring', size: [1.2, 6], sizePow: 2.4, stretch: 0.06, color0: DUST, alphaPow: 0.7, alpha: [0.38, 0], fadeIn: 0.05, erode: [0.08, 0.6], drag: 3.4, rise: 1.0, turb: 1.6, lit: true, jitter: 1.4, scaleCount: false },
    { shape: 'puff', count: [6, 6], life: [0.5, 0.9], speed: [18, 36], dirMode: 'ring', size: [2, 8], sizePow: 1.8, color0: DUST_D, alphaPow: 0.7, alpha: [0.28, 0], fadeIn: 0.04, erode: [0.12, 0.6], drag: 4, orient: 'up', lit: true, spin: [-1, 1], scaleCount: false },
    { shape: 'puff', count: [4, 4], life: [0.35, 0.6], speed: [26, 40], dirMode: 'ring', size: [0.6, 2.4], sizePow: 2, stretch: 0.06, color0: DUST_L, alphaPow: 0.7, alpha: [0.3, 0], erode: [0.15, 0.6], drag: 4.5, lit: true, scaleCount: false },
    { shape: 'chunk', count: [5, 8], life: [0.5, 0.9], speed: [8, 18], dirMode: 'up', cone: 70, size: [0.26, 0.22], color0: GRIT, variant: [0, 11], gravity: 32, collide: true, bounce: 0.3, spin: [-15, 15] },
  ],
  mv_ab_charge: [
    { shape: 'spark', count: [1, 2], life: [0.06, 0.12], speed: [4, 14], dirMode: 'dir', cone: 20, size: [0.8, 0.25], stretch: 0.02, color0: [3.2, 1.5, 0.45], color1: [1, 0.3, 0.06], heat: [1, 0.6], nosoft: true },
    { shape: 'spark', count: [0, 1], life: [0.15, 0.3], speed: [6, 16], dirMode: 'sphere', size: [0.12, 0.03], stretch: 0.03, color0: HOT, color1: HOT_D, heat: [1, 0.3], gravity: 8 },
  ],
  mv_ab_launch: [
    { shape: 'spark', count: [12, 16], life: [0.06, 0.16], speed: [30, 75], dirMode: 'dir', cone: 20, size: [0.8, 0.25], stretch: 0.015, color0: [2.2, 1.05, 0.35], color1: [0.8, 0.22, 0.05], heat: [1, 0.5], drag: 2.5, jitter: 0.6 },
    { shape: 'puff', count: [4, 5], life: [0.08, 0.16], speed: [30, 60], dirMode: 'dir', cone: 12, size: [1.2, 4.2], sizePow: 2, color0: [0.035, 0.034, 0.034], alpha: [0.9, 0], heat: [1, 0.5], add: [1, 0.9], erode: [0.12, 0.6], drag: 5, spin: [-4, 4] },
    // launch smoke: a pressure ring blown out AROUND the flight axis, short-lived (the chase camera
    // flies through this spot ~0.25 s later at 130 m/s; billows on its path read as cotton balls)
    { shape: 'puff', count: [6, 7], life: [0.35, 0.7], speed: [16, 32], dirMode: 'ringAxis', size: [2, 8], sizePow: 2.2, stretch: 0.05, color0: [0.42, 0.4, 0.37], alphaPow: 0.7, alpha: [0.3, 0], fadeIn: 0.05, erode: [0.1, 0.6], drag: 3.5, rise: 0.6, turb: 1.5, lit: true, jitter: 1.2 },
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
    { shape: 'puff', count: [0, 1], life: [0.25, 0.4], speed: [50, 70], dirMode: 'dir', cone: 4, size: [0.6, 1.8], color0: [0.36, 0.33, 0.29], alphaPow: 0.7, alpha: [0.12, 0], erode: [0.2, 0.6], stretch: 0.03, lit: true },
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
    if (h < 8) this.game.fx.spawn('mv_ab_ring', _v.set(p.x, p.y + 0.4, p.z), null, 1.2);
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
      // one spray per step at full speed (spacing ~1.4 m at 85 m/s, so the billows overlap
      // into one continuous tail); mostly from the trailing foot (rigmotion.trailSide)
      const rate = m.skid > 0.3 ? 50 : m.mode === 'qb' ? 60 : 58 * Math.min(1, sp / 85);
      this.wakeT -= dt * rate;
      const trailL = rig.motion && rig.motion.trailSide > 0;
      while (this.wakeT <= 0) {
        this.wakeT += 1;
        const foot = rng.chance(0.7) === trailL ? 'foot_L' : 'foot_R';
        rig.getNodeWorld(foot, _v); _v.y = player.pos.y + 0.4;
        const k = 1 / Math.max(1, sp);
        if (m.skid > 0.3) {
          // spray forward-out along the slide (the feet are braking against it)
          _d.set(v.x * k + rng.sym(0.3), 0.35, v.z * k + rng.sym(0.3));
          fx.spawn('mv_skid', _v, _d, 0.8 + m.skid * 0.7);
        } else {
          _d.set(-v.x * k + rng.sym(0.12), 0.32, -v.z * k + rng.sym(0.12));
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
        _d.set(-v.x * k * 0.8 + rng.sym(0.5), 0.06, -v.z * k * 0.8 + rng.sym(0.5));
        fx.spawn('mv_wash', _v, _d, 1.3 - alt / 20);
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

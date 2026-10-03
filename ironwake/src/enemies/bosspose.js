// src/enemies/bosspose.js — CINDERHOUND pilot pose layer (owner: enemy AI designer).
//
// Runs as rig.onPose (rig.js calls it at the end of rig.update, after rigmotion's lean / skate /
// flight poses and the mech lane's fall + posture layers, before the matrix update), so it adds
// the BOSS-specific body language on top of the shared procedural animation:
//   SAG     stagger window: the frame slumps — rifle arm drops ~35 deg, head ~15 deg down, torso
//           ~10 deg forward, knees give ~25 % (crouch spring pushed to a new equilibrium), a slow
//           drunken sway; recovers over ~0.3 s when the window closes
//   DRAW    blade tell: the blade arm is drawn back ~60 deg with the torso wound up away from the
//           target, so the lunge reads as a coiled strike 0.5 s before it lands; released (fast
//           forward arc) when the lunge starts
//   BRACE   assault-boost charge / plunge tell: shoulders hunched forward, arms tucked
//   ENTRY   intro descent: knees bent ~15 deg under the braking boosters, then a heavy landing
//   RUSH    (r4, critic: "the blade approach holds one locked crouch for 0.7 s+: a sliding statue")
//           the boost-in before the blade tell: the blade arm is progressively drawn back (0 -> 35
//           deg over ~0.35 s), the trailing leg flutters (4 deg, 2 Hz) and the torso weaves with the
//           lateral acceleration; carries on (blended) through the tell, so the lunge snaps out of
//           a body that is still alive
// Weights are critically damped springs (no pops when states change). Deterministic.
import * as THREE from 'three';
import { RIG_MOTION } from '../mech/rigmotion.js';

export const BOSS_POSE = {
  sag: { in: 10, out: 5, armR: 0.62, armL: 0.32, forearmR: 0.35, head: 0.26, torso: 0.17, roll: 0.07, crouch: 0.6, sway: 0.06, swayHz: 0.55 },
  draw: { in: 9, out: 16, arm: 1.05, armRoll: 0.32, forearm: 0.55, torsoYaw: 0.42, torsoPitch: -0.08, armR: 0.25 },
  brace: { in: 6, out: 5, torso: 0.16, head: -0.12, arms: 0.3 },
  entry: { in: 6, out: 4, thigh: -0.3, shin: 0.55, arms: 0.22, sway: 0.07 },
  rush: { in: 6, out: 10, arm: 0.61, forearm: 0.25, flutter: 0.07, flutterHz: 2, weave: 0.09, weaveAcc: 1 / 110, weaveHz: 1.3, rate: 8 },
};

const _q = new THREE.Quaternion(), _e = new THREE.Euler(0, 0, 0, 'YXZ');

function rot(node, x, y, z) {
  if (!node || (x === 0 && y === 0 && z === 0)) return;
  _e.set(x, y, z);
  node.quaternion.multiply(_q.setFromEuler(_e));
}
/** Critically damped weight toward target (rate in 1/s). */
function chase(w, target, rateIn, rateOut, dt) {
  const r = target > w ? rateIn : rateOut;
  return w + (target - w) * (1 - Math.exp(-r * dt));
}

export class BossPose {
  constructor(boss) {
    this.boss = boss;
    this.sag = 0; this.draw = 0; this.brace = 0; this.entry = 0; this.rush = 0; this.weave = 0;
    this.t = 0;
    this.apply = this.apply.bind(this);
  }
  reset() { this.sag = this.draw = this.brace = this.entry = this.rush = this.weave = 0; this.t = 0; }

  /** Before rig.update: push the crouch spring's equilibrium (knees give during the sag). */
  preStep(dt) {
    const m = this.boss.rig.motion;
    if (!m || this.sag < 1e-3) return;
    const w = RIG_MOTION.crouchOmega;
    m.crouchV += w * w * BOSS_POSE.sag.crouch * this.sag * dt;
  }

  /** rig.onPose: the extra joint rotations. */
  apply(dt, pose) {
    const b = this.boss, N = b.rig.nodes, P = BOSS_POSE;
    this.t += dt;
    const mode = pose.mode;
    // --- weights
    const staggered = mode === 'stagger';
    const drawing = b.atk === 'blade' && b.atkStage === 'tell' || b.atkStage === 'abBladeTell';
    const bracing = (b.atk === 'charge' && (b.atkStage === 'tell' || b.motor.abCharging)) || (b.atk === 'plunge' && b.atkStage === 'tell');
    const entering = b.state === 'intro' && !pose.grounded;
    this.sag = chase(this.sag, staggered ? 1 : 0, P.sag.in, P.sag.out, dt);
    this.draw = chase(this.draw, drawing ? 1 : 0, P.draw.in, P.draw.out, dt);
    this.brace = chase(this.brace, bracing ? 1 : 0, P.brace.in, P.brace.out, dt);
    this.entry = chase(this.entry, entering ? 1 : 0, P.entry.in, P.entry.out, dt);
    const rushing = b.atk === 'blade' && (b.atkStage === 'close' || b.atkStage === 'tell');
    this.rush = chase(this.rush, rushing ? 1 : 0, P.rush.in, P.rush.out, dt);

    // --- SAG (stagger)
    const s = this.sag;
    if (s > 1e-3) {
      const S = P.sag, sw = Math.sin(this.t * Math.PI * 2 * S.swayHz), sw2 = Math.sin(this.t * Math.PI * 2 * S.swayHz * 1.7 + 1.1);
      rot(N.torso, S.torso * s + S.sway * 0.4 * sw2 * s, 0, S.roll * s * sw);
      rot(N.head, S.head * s, 0.08 * s * sw2, -S.roll * 0.5 * s * sw);
      rot(N.arm_R, S.armR * s, 0, 0.12 * s);
      rot(N.forearm_R, S.forearmR * s, 0, 0);
      rot(N.arm_L, S.armL * s, 0, -0.1 * s);
      rot(N.shoulder_L, 0.18 * s, 0, 0); rot(N.shoulder_R, 0.22 * s, 0, 0);
    }
    // --- DRAW (blade wind-up: arm back + up-and-out, torso twisted away, rifle arm swings across)
    const d = this.draw;
    if (d > 1e-3) {
      const D = P.draw;
      rot(N.torso, D.torsoPitch * d, D.torsoYaw * d, 0);
      rot(N.arm_L, D.arm * d, -0.2 * d, D.armRoll * d);
      rot(N.forearm_L, -D.forearm * d, 0, 0);
      rot(N.arm_R, -D.armR * d, 0.15 * d, 0);
    }
    // --- RUSH (blade approach: progressive arm draw, trailing-leg flutter, lateral weave)
    const r = this.rush;
    if (r > 1e-3) {
      const R = P.rush, a = pose.accelLocal;
      const lat = a ? Math.max(-1, Math.min(1, -a.x * R.weaveAcc)) : 0;
      const wt = lat * R.weave + Math.sin(this.t * Math.PI * 2 * R.weaveHz) * R.weave * 0.35;
      this.weave += (wt - this.weave) * (1 - Math.exp(-R.rate * dt));
      const fl = Math.sin(this.t * Math.PI * 2 * R.flutterHz) * R.flutter * r;
      const armK = r * (1 - d);                         // the tell's DRAW takes over the arm
      rot(N.arm_L, R.arm * armK, 0, 0.12 * armK);
      rot(N.forearm_L, -R.forearm * armK, 0, 0);
      rot(N.thigh_R, fl, 0, 0); rot(N.shin_R, -fl * 0.6, 0, 0);
      rot(N.thigh_L, -fl * 0.35, 0, 0);
      rot(N.torso, 0, this.weave * 0.4 * r, this.weave * r);
      rot(N.pelvis, 0, 0, -this.weave * 0.4 * r);
    }
    // --- BRACE (charge / plunge wind-up)
    const c = this.brace;
    if (c > 1e-3) {
      const B = P.brace;
      rot(N.torso, B.torso * c, 0, 0);
      rot(N.head, B.head * c, 0, 0);
      rot(N.arm_L, B.arms * c, 0, -0.12 * c); rot(N.arm_R, B.arms * 0.5 * c, 0, 0.12 * c);
    }
    // --- ENTRY (intro descent on the brakes: knees bent, arms out for balance)
    const en = this.entry;
    if (en > 1e-3) {
      const E = P.entry;
      rot(N.thigh_L, E.thigh * en, 0, 0.06 * en); rot(N.thigh_R, E.thigh * 0.7 * en, 0, -0.06 * en);
      rot(N.shin_L, E.shin * en, 0, 0); rot(N.shin_R, E.shin * 0.8 * en, 0, 0);
      rot(N.foot_L, -E.shin * 0.45 * en, 0, 0); rot(N.foot_R, -E.shin * 0.4 * en, 0, 0);
      rot(N.arm_L, 0, 0, E.arms * en); rot(N.arm_R, 0, 0, -E.arms * en);
      // hanging on the brakes: the frame sways under the thrust (two incommensurate periods)
      const t = this.t;
      rot(N.pelvis, E.sway * 0.6 * Math.sin(t * 2.3) * en, 0, E.sway * Math.sin(t * 1.7 + 0.8) * en);
      rot(N.torso, E.sway * 0.5 * Math.sin(t * 2.9 + 1.4) * en, 0, -E.sway * 0.6 * Math.sin(t * 1.7 + 0.8) * en);
    }
  }
}

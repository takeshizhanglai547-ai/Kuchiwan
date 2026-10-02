// src/fx/status.js — event-driven VFX watchers (owner: weapons/VFX artist).
//
//   actor:stagger   electric overload burst + crawling arcs over the target while it is staggered
//   (poll)          low-AP enemies spit sparks (< 35% AP) and lick flames (< 18% AP)
//   weapon:blade    blade beam ignition (windup) + swept slash arc (slash)
//   player:qb       afterimage of the rig (fx/ghost.js) + per-nozzle fire tongues
//   actor:hit       HULL FLASH: a brief white-orange flash over an enemy the player hits, sized to
//                   the target and placed in front of it, so rifle hits read at 75-300 m even under
//                   the lock marker (the impact light relights the hull at the same time)
//   (poll)          per lit nozzle: a small exit glow + an exhaust JET (fx.jet: core cone -> orange
//                   flame, min on-screen length, so the chase camera always sees the plume)
//   (poll)          assault-boost heated-air wake ribbon behind the player's back boosters (off)
// update() runs AFTER the particle sim each step (fx/particles.js), so one-step sprites render.
import * as THREE from 'three';

const ARC = [2.6, 4.2, 7.5];
const AB_WAKE = false;
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _p = new THREE.Vector3(), _d = new THREE.Vector3();
/** Exhaust-jet tuning (m; main = bells with exit radius >= mainRadius). */
export const JET = { mainRadius: 0.3, exitOffset: 0.35, lenIdle: 0.8, lenBoost: 4.4, abMul: 1.4, qbMul: 0.5, width: 1.2, widthAB: 1.7, verMax: 1.2, verGain: 0.6,
  hazeRate: 15, hazeLife: 0.25, hazeBoost: 0.35, hazeAB: 0.55 };
/** Quick-boost jet: length len0 + len1 x align^2 (m), life s, half width (x exit radius), flash. */
export const QB_JET = { life: 0.07, len0: 2.0, len1: 5.5, width: 1.5, minHalfWidth: 0.3, gain: 1.35, flash: 70, flashColor: [1, 0.62, 0.3] };

export class Status {
  constructor(game, fx) {
    this.game = game; this.fx = fx;
    this.rng = game.rng.stream('fx_status');
    this.stag = [];          // {actor, t, arcT}
    this.hurtT = new Map();  // actor -> timer
    this.abTrail = [-1, -1];
    this.prepared = null;
    const ev = game.events;
    this.off = [
      ev.on('actor:stagger', (e) => this._onStagger(e)),
      ev.on('weapon:blade', (e) => this._onBlade(e)),
      ev.on('player:qb', (f) => this._onQb(f)),
      ev.on('actor:hit', (e) => this._onHit(e)),
    ];
    this.flashT = new Map();   // target -> last hull-flash time (rate limit)
    this.time = 0;
    this.hazeT = 0;
    this.qbJets = [];          // active quick-boost jets {nz, t, life, align, seed}
  }

  reset() {
    this.stag.length = 0;
    this.hurtT.clear();
    this.flashT.clear(); this.time = 0; this.hazeT = 0;
    for (const j of this.qbJets) j.t = j.life = 0;
    this.abTrail[0] = this.abTrail[1] = -1;
  }

  _onStagger(e) {
    const t = e.target;
    if (!t || !t.alive) return;
    // deferred one step: a hit that staggers AND kills gets the death explosion only
    let s = this.stag.find((x) => x.actor === t);
    if (!s) { s = { actor: t, t: 0, arcT: 0, burst: true }; this.stag.push(s); }
    s.t = 0; s.arcT = 0.03; s.burst = true;
  }

  _onHit(e) {
    const t = e && e.target, h = e && e.hit;
    if (!t || !t.alive || t.team === 'player' || !h || !h.source || h.source.team !== 'player') return;
    const last = this.flashT.get(t);
    if (last !== undefined && this.time - last < 0.07) return;
    this.flashT.set(t, this.time);
    const cam = this.game.camera.position;
    t.aimPoint(_p);
    _c.copy(cam).sub(_p);
    const dist = _c.length() || 1;
    // (enemy-ai r3, critic: "HitFlash turns the whole unit milky cream") inside ~60 m the local
    // hit pulse on the struck plating (src/enemies/hitvol.js) + the sparks carry the hit; the
    // hull-sized glow is only needed where those shrink below a few pixels (the rival rig opts out
    // too: a 6 m cream glow per round washed its whole torso out under sustained rifle fire)
    if (dist < 60 && (t.flash || t.ownHitFx)) return;
    _p.addScaledVector(_c, Math.min(dist * 0.5, (t.radius || 2.5) * 1.1) / dist);
    // the flash grows a little with distance (stays readable at range) and with the hit weight
    const w = Math.min(1.6, 0.7 + (h.impact || 100) / 400);
    this.fx.spawn('hull_flash', _p, null, Math.max(0.8, (t.radius || 2.5) / 2.6) * w * Math.max(1, dist / 90));
  }

  _onBlade(e) {
    const o = e.owner;
    if (!o) return;
    if (e.phase === 'windup') this.fx.slashes.ignite(o, 1.0);
    else if (e.phase === 'slash') { this.fx.slashes.slash(o); this.fx.slashes.ignite(o, 0.3); }
  }

  _onQb(f) {
    const p = this.game.player;
    if (!p || !p.rig) return;
    if (p.syncSim) p.syncSim();   // sim pose, not the last interpolated render pose
    // afterimage: ONE faint heat-smear copy (combat r1: bright edge-lit copies read as a hologram)
    this.fx.ghosts.trigger(p.rig.root, 0.16);
    const q = f && f.qb;
    if (!q || !p.rig.nozzles) return;
    const ql = Math.hypot(q.x, q.y, q.z) || 1;
    // ground pressure ring at the feet when the burst fires near the slab
    const gh = this.game.physics.groundHeight(p.pos.x, p.pos.z);
    if (p.pos.y - gh < 4) this.fx.spawn('qb_ground_ring', _c.set(p.pos.x, gh + 0.5, p.pos.z), null, 1);
    // white-hot DIRECTIONAL JET out of every nozzle that faces away from the burst (combat r2: the
    // burst read as a beige cloud): a 3-4 frame fx.jet streak, 5-8 m for a fully opposed bell,
    // re-emitted on the live nozzle every step (see update), + an exit flash and an ash wisp
    _a.set(0, 0, 0); let nf = 0;
    for (const nz of p.rig.nozzles) {
      if (!nz.node) continue;
      nz.node.getWorldPosition(_p); nz.node.getWorldDirection(_d); _d.negate();   // exhaust = -Z
      const align = -(_d.x * q.x + _d.y * q.y + _d.z * q.z) / ql;
      if (align < 0.45) continue;
      _p.addScaledVector(_d, Math.max(0.25, (nz.radius || 0.3) * 0.6));
      this.fx.spawn('qb_jet', _p, _d, (0.6 + 0.6 * align) * Math.min(1.3, Math.max(0.8, (nz.radius || 0.3) / 0.3)));
      const j = this.qbJets.find((x) => x.t >= x.life) || (this.qbJets.length < 16 ? this.qbJets[this.qbJets.push({}) - 1] : null);
      if (j) { j.nz = nz; j.t = 0; j.life = QB_JET.life; j.align = align; j.seed = this.rng.next(); }
      _a.add(_p); nf++;
    }
    // a short warm flash on the firing side (lights the rig flank, not the whole yard)
    if (nf) { _a.multiplyScalar(1 / nf); this.fx.flash(_a, QB_JET.flashColor, QB_JET.flash, 22, 0.08); }
  }

  /** Jagged bolt from a to b (world), n segments, jitter m. */
  _bolt(a, b, n, jit, life, width) {
    const r = this.rng;
    let px = a.x, py = a.y, pz = a.z;
    for (let i = 1; i <= n; i++) {
      const f = i / n;
      const w = i === n ? 0 : jit * Math.sin(f * Math.PI);
      const x = a.x + (b.x - a.x) * f + r.sym(w), y = a.y + (b.y - a.y) * f + r.sym(w), z = a.z + (b.z - a.z) * f + r.sym(w);
      this.fx.bolt(px, py, pz, x, y, z, life, ARC, width);
      px = x; py = y; pz = z;
    }
  }

  update(dt) {
    const g = this.game, fx = this.fx, r = this.rng;
    this.time += dt;
    // eager afterimage build (keeps scene object counts constant across restarts)
    if (!this.prepared && g.player && g.player.rig) { this.prepared = g.player.rig.root; fx.ghosts.trigger(this.prepared, 0); fx.ghosts.clear(); }
    if (fx.freeze) return;
    // --- staggered targets: crawling electric arcs
    for (let i = this.stag.length - 1; i >= 0; i--) {
      const s = this.stag[i], a = s.actor;
      s.t += dt;
      if (!a.alive || !a.staggered || s.t > 4) { this.stag.splice(i, 1); continue; }
      if (s.burst) {
        s.burst = false; a.aimPoint(_p);
        fx.spawn('stagger_burst', _p, null, Math.max(0.8, (a.radius || 3) / 3.2));
        // discharge: a crown of bolts leaping off the hull
        const rb = Math.max(2.5, (a.radius || 2.5) * 1.6);
        for (let k = 0; k < 7; k++) {
          r.onSphere(_b); _b.y = Math.abs(_b.y) * 0.8; _b.multiplyScalar(rb * r.range(0.8, 1.4)).add(_p);
          this._bolt(_p, _b, r.int(5, 8), 0.7, r.range(0.06, 0.12), r.range(0.12, 0.22));
        }
      }
      s.arcT -= dt;
      if (s.arcT > 0) continue;
      s.arcT = r.range(0.03, 0.07);
      if (a.ownArcs) continue;   // (enemy-ai r3) the rival rig draws its own branching joint-to-joint bolts (boss.js _bolts)
      a.aimPoint(_c);
      const rad = Math.max(1.5, (a.radius || 2.5) * 0.9), hh = Math.max(1.5, (a.height || 5) * 0.45);
      const nb = r.int(2, 3);
      for (let k = 0; k < nb; k++) {
        r.onSphere(_a); _a.x *= rad; _a.y *= hh; _a.z *= rad; _a.add(_c);
        r.onSphere(_b); _b.x *= rad * 1.2; _b.y *= hh * 1.1; _b.z *= rad * 1.2; _b.add(_c);
        this._bolt(_a, _b, r.int(4, 7), 0.5, r.range(0.05, 0.1), r.range(0.1, 0.2));
      }
      if (r.chance(0.35)) fx.spawn('arc_spark', _a, null, 1);
    }
    // --- low-AP damage feedback on enemies (the enemy lane also emits damage smoke)
    for (const a of g.actors) {
      if (!a.alive || a.team === 'player' || !a.apMax) continue;
      const f = a.ap / a.apMax;
      if (f > 0.35) continue;
      let t = (this.hurtT.get(a) || 0) - dt;
      if (t <= 0) {
        t = f < 0.18 ? r.range(0.12, 0.3) : r.range(0.35, 0.9);
        a.aimPoint(_p);
        _p.x += r.sym(a.radius || 2); _p.y += r.sym(1.5); _p.z += r.sym(a.radius || 2);
        fx.spawn('arc_spark', _p, null, 0.8);
        if (f < 0.18) fx.spawn('fire_lick', _p, null, 1);
      }
      this.hurtT.set(a, t);
    }
    // --- assault boost: the plumes run long and white-hot for the whole flight (rig.flare is
    //     the rig's public burst knob; it decays on its own when the boost ends)
    const plm = g.player && g.player.motor;
    if (plm && plm.mode === 'ab' && g.player.rig && g.player.rig.flare) g.player.rig.flare(plm.abCharging ? 0.25 * (plm.abCharge || 0) : 0.85);
    // --- quick-boost jets: 3-4 frames, long white-hot streak collapsing back into the bell
    for (const j of this.qbJets) {
      if (j.t >= j.life || !j.nz || !j.nz.node) continue;
      const k = 1 - j.t / j.life; j.t += dt;
      const nz = j.nz, r = nz.radius || 0.3;
      nz.node.getWorldPosition(_p); nz.node.getWorldDirection(_d); _d.negate();
      _p.addScaledVector(_d, r * JET.exitOffset);
      const len = (QB_JET.len0 + QB_JET.len1 * j.align * j.align) * Math.min(1.25, Math.max(0.8, r / 0.3)) * (0.55 + 0.45 * k);
      fx.jet(_p, _d.x, _d.y, _d.z, len, Math.max(QB_JET.minHalfWidth, r * QB_JET.width) * (0.8 + 0.2 * k), 1.3, QB_JET.gain * k * k, j.seed);
    }
    // --- booster exhaust (combat r3): per lit nozzle a small exit glow (clamped to ~1.3x the bell
    //     diameter: no glare ball) + an EXHAUST JET (fx.jet, shaders.js shape 9): white-hot core
    //     cone -> orange flame, length from thrust (idle ~0.8 m, boost 2-4 m, AB 6-10 m), never
    //     shorter than ~28 px on screen, so it still reads from the chase camera looking straight
    //     down the jet. The ray-marched lathe plume (fx/flame.js) adds the volumetric outer flame.
    const t = this.time;
    this.hazeT -= dt;
    const hazeTick = this.hazeT <= 0;
    if (hazeTick) this.hazeT += 1 / JET.hazeRate;
    for (const a of g.actors) {
      const rig = a.rig;
      if (!a.alive || !rig || !rig.nozzles) continue;
      const m = a.motor, ab = m && m.mode === 'ab' && !m.abCharging;
      const qf = rig.qbFlash || 0;
      for (let k = 0; k < rig.nozzles.length; k++) {
        const nz = rig.nozzles[k];
        const L = nz.level;
        if (L < 0.12 || !nz.node) continue;
        const r = nz.radius || 0.4, main = r >= JET.mainRadius;
        nz.node.getWorldPosition(_p); nz.node.getWorldDirection(_d); _d.negate();   // exhaust = -Z
        _p.addScaledVector(_d, r * JET.exitOffset);
        const rs = r / 0.45;
        const gl = Math.min(1, L * 1.4) * (1 + 0.35 * qf);
        if (L > 0.2) fx.spawn('nozzle_glow', _p, null, Math.max(0.3, rs) * gl);
        const flick = 0.9 + 0.07 * Math.sin(t * 53 + k * 1.9) + 0.05 * Math.sin(t * 131 + k * 4.1);
        let len, hw, gain;
        if (main) {
          len = rs * (JET.lenIdle + JET.lenBoost * Math.pow(L, 1.2)) * (ab ? JET.abMul : 1) * (1 + JET.qbMul * qf);
          hw = r * (ab ? JET.widthAB : JET.width) * (1 + 0.15 * qf); gain = 1;
        } else {
          len = Math.min(JET.verMax, 0.25 + 1.0 * L) * (1 + 0.6 * qf);
          hw = Math.max(0.1, r * 1.1); gain = JET.verGain;
        }
        fx.jet(_p, _d.x, _d.y, _d.z, len * flick, hw, Math.min(1.3, L * (1 + 0.4 * qf) + (ab ? 0.25 : 0)), gain, k * 0.137 + (a === g.player ? 0 : 0.5));
        // heat haze: main bells only, ~15 sprites/s each, riding with the rig a third of the way down
        // the jet and drifting slowly out along it (refraction of the background through the plume)
        if (main && L > 0.35 && hazeTick) {
          const v = m ? m.vel : null;
          _a.copy(_p).addScaledVector(_d, len * 0.35);
          const hs = r * (ab ? 3.4 : 2.6);
          fx.distortion.add(0, _a, hs * 0.6, hs * 1.4, JET.hazeLife, (ab ? JET.hazeAB : JET.hazeBoost) * Math.min(1, L),
            (v ? v.x * 0.97 : 0) + _d.x * 9, (v ? v.y * 0.97 : 0) + _d.y * 9, (v ? v.z * 0.97 : 0) + _d.z * 9);
        }
      }
    }
    // --- assault boost wake: heated-air ribbons from the back boosters (off: seen end-on
    //     from the chase camera it only veils the rig; the plume + streaks carry the read)
    const pl = g.player;
    const m = pl && pl.motor;
    const ab = AB_WAKE && m && m.mode === 'ab' && !m.abCharging && pl.alive;
    for (let k = 0; k < 2; k++) {
      if (ab) {
        if (this.abTrail[k] < 0) this.abTrail[k] = fx.trails.begin('ab');
        const nz = this._backNozzle(pl.rig, k);
        if (nz) { nz.node.getWorldPosition(_p); nz.node.getWorldDirection(_d); _p.addScaledVector(_d, -1.5); }
        else { _p.copy(pl.pos); _p.y += 6; }
        fx.trails.push(this.abTrail[k], _p);
      } else if (this.abTrail[k] >= 0) { fx.trails.end(this.abTrail[k]); this.abTrail[k] = -1; }
    }
  }

  _backNozzle(rig, k) {
    if (!rig || !rig.nozzles) return null;
    let n = 0;
    for (const nz of rig.nozzles) { if (nz.group === 'back') { if (n === k) return nz; n++; } }
    return rig.nozzles[k] || null;
  }

  dispose() { for (const f of this.off) f(); this.off.length = 0; }
}

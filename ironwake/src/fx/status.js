// src/fx/status.js — event-driven VFX watchers (owner: weapons/VFX artist).
//
//   actor:stagger   electric overload burst + crawling arcs over the target while it is staggered
//   (poll)          low-AP enemies spit sparks (< 35% AP) and lick flames (< 18% AP)
//   weapon:blade    blade beam ignition (windup) + swept slash arc (slash)
//   player:qb       afterimage of the rig (fx/ghost.js) + per-nozzle fire tongues
//   actor:hit       HULL FLASH: a brief white-orange flash over an enemy the player hits, sized to
//                   the target and placed in front of it, so rifle hits read at 75-300 m even under
//                   the lock marker (the impact light relights the hull at the same time)
//   (poll)          per lit nozzle: exit glow; main bells also an end-on exhaust core (white core
//                   + shock rings) and a tapered jet streak; assault boost adds a wide heat halo
//   (poll)          assault-boost heated-air wake ribbon behind the player's back boosters (off)
// update() runs AFTER the particle sim each step (fx/particles.js), so one-step sprites render.
import * as THREE from 'three';

const ARC = [2.6, 4.2, 7.5];
const AB_WAKE = false;
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _p = new THREE.Vector3(), _d = new THREE.Vector3();
const _jetOpts = { scale: 1, vel: null, normal: null, yaw: 0, incoming: null };

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
  }

  reset() {
    this.stag.length = 0;
    this.hurtT.clear();
    this.flashT.clear(); this.time = 0;
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
    // jet flare out of every nozzle that faces away from the burst (located on the real
    // nozzles, so it reads from any camera side instead of hiding behind the body)
    const q = f && f.qb;
    if (!q || !p.rig.nozzles) return;
    const ql = Math.hypot(q.x, q.y, q.z) || 1;
    for (const nz of p.rig.nozzles) {
      if (!nz.node) continue;
      nz.node.getWorldPosition(_p); nz.node.getWorldDirection(_d); _d.negate();   // exhaust = -Z
      const align = -(_d.x * q.x + _d.y * q.y + _d.z * q.z) / ql;
      if (align < 0.45) continue;
      _p.addScaledVector(_d, Math.max(0.25, (nz.radius || 0.3) * 0.6));
      this.fx.spawn('qb_jet', _p, _d, (0.6 + 0.8 * align) * Math.min(1.3, Math.max(0.8, (nz.radius || 0.3) / 0.3)));
    }
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
    // --- nozzle exit glows (the plume seen end-on still reads as a hot core + halo)
    for (const a of g.actors) {
      const rig = a.rig;
      if (!a.alive || !rig || !rig.nozzles) continue;
      for (let k = 0; k < rig.nozzles.length; k++) {
        const nz = rig.nozzles[k];
        if (nz.level < 0.2 || !nz.node) continue;
        nz.node.getWorldPosition(_p); nz.node.getWorldDirection(_d);
        _p.addScaledVector(_d, -Math.max(0.3, (nz.radius || 0.4) * 0.8));
        // seen end-on the plume shell vanishes (fresnel), so the exit glow grows to carry it
        _c.copy(g.camera.position).sub(_p).normalize();
        const endOn = Math.max(0, -_c.dot(_d));
        const gs = Math.max(0.35, (nz.radius || 0.4) / 0.45) * Math.min(1.4, nz.level * (1 + (rig.qbFlash || 0))) * (1 + 1.3 * endOn * endOn);
        fx.spawn('nozzle_glow', _p, null, gs);
        // main bells seen end-on (chase camera behind a boost): blinding core + shock-diamond rings,
        // so the exhaust reads as a jet looking INTO the camera instead of collapsing to dots
        if (nz.radius >= 0.3 && endOn > 0.25 && nz.level > 0.3) {
          const ec = (0.2 + 0.9 * nz.level * nz.level) * (endOn - 0.25) / 0.75 * Math.max(0.7, nz.radius / 0.45) * (1 + 0.6 * (rig.qbFlash || 0));
          _p.addScaledVector(_d, -Math.max(0.2, nz.radius * 0.6));
          fx.spawn('exhaust_core', _p, null, ec);
        }
        // main bells in a strong burn: a tapered white-hot JET streak riding the rig (head at the
        // exit, tail out along the exhaust; spawned with its velocity pointing INTO the bell so the
        // streak's trailing tail is the jet). Long in AB, shorter in a ground boost.
        if (nz.radius >= 0.3 && nz.level > 0.45) {
          const ab = a.motor && a.motor.mode === 'ab' && !a.motor.abCharging;
          _jetOpts.scale = nz.level * (ab ? 1.35 : 0.75) * Math.max(0.7, nz.radius / 0.44);
          _b.copy(_d);   // +Z of the nozzle = into the bell
          fx.spawn('exhaust_jet', _p, _b, _jetOpts);
        }
        // assault boost: the main boosters wear a wide heat halo (reads from the chase camera)
        if (a === g.player && nz.group === 'back' && a.motor && a.motor.mode === 'ab' && !a.motor.abCharging && nz.radius > 0.3) {
          fx.spawn('ab_halo', _p, null, 0.8 + 0.6 * endOn);
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

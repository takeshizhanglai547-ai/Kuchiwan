// ============================================================
//  mission/director.js — hostile pacing for OP-317.
//  [owned by mission agent]
//
//  The enemy system owns AI and spawning; this only decides WHEN and WHAT.
//  Every call into ctx.enemies is guarded — that system is authored in
//  parallel and this file must never be the thing that throws.
//
//  Pacing contract
//    · calling spawnWave() once permanently disarms the enemy system's own
//      auto-director, so the mission takes ownership on the first escalation
//      and must keep the field populated from then on.
//    · escalate(n) fires once per destroyed coolant pylon: n = 1, 2, 3.
//    · tick() is a slow drip that only fires when the arena has gone quiet,
//      so clearing fast is rewarded with pressure, not with an empty map.
// ============================================================
import * as THREE from 'three';
import { CFG } from '../config.js';

const _v = new THREE.Vector3();

// reinforcement drip: cadence (s) and the wave rotation, per act
const DRIP_GAP = [0, 30, 26, 0];          // indexed by act (1..3); 0 = off
const DRIP_ROTA = ['armour', 'air', 'garrison', 'armour', 'air'];
const QUIET = 3;                          // combatants at or below this = quiet

export class Director {
  constructor(ctx) {
    this.ctx = ctx;
    this.reset();
  }

  reset() {
    this.dripT = 0;
    this.dripN = 0;
    this.turretsAwake = false;
    this.owned = false;         // true once we have taken pacing off the enemy system
    this.spawnedTurrets = 0;
  }

  // ----------------------------------------------------------------
  //  guarded enemy-system access
  // ----------------------------------------------------------------
  _wave(name) {
    const en = this.ctx.enemies;
    if (!en || typeof en.spawnWave !== 'function') return null;
    try {
      this.owned = true;
      return en.spawnWave(name);
    } catch (e) { return null; }
  }

  _spawn(kind, x, y, z, opts) {
    const en = this.ctx.enemies;
    if (!en || typeof en.spawn !== 'function') return null;
    _v.set(x, y, z);
    try { return en.spawn(kind, _v, opts); } catch (e) { return null; }
  }

  /** live hostiles that are not objective structures */
  combatants() {
    const en = this.ctx.enemies;
    if (!en) return 0;
    try {
      if (typeof en.combatants === 'function') return en.combatants();
      if (typeof en.alive === 'function') {
        const a = en.alive();
        let n = 0;
        for (let i = 0; i < a.length; i++) if (a[i] && a[i].kind !== 'pylon') n++;
        return n;
      }
    } catch (e) { /* enemy system mid-build */ }
    return 0;
  }

  pylonList() {
    const en = this.ctx.enemies;
    if (!en || !en.pylons) return null;
    return en.pylons;
  }

  /**
   * Make sure the three objective structures are standing AND take pacing
   * ownership away from the enemy system's own director in one call — the
   * pylon wave is idempotent, so this never double-spawns.
   */
  ensurePylons() { return this._wave('pylons'); }

  // ----------------------------------------------------------------
  //  escalation — one step per coolant pylon destroyed
  // ----------------------------------------------------------------
  escalate(step) {
    if (step === 1) {
      // the air wing scrambles: heli + drone screen
      this._wave('air');
      this._postTurrets(1);
    } else if (step === 2) {
      // the garrison commits and the picket grid comes up hot
      this._wave('garrison');
      this._wave('armour');
      this._postTurrets(2);
      this.turretsAwake = true;
    } else if (step === 3) {
      // everything left in the complex converges before NIGHTJAR arrives
      this._wave('air');
    }
    this.dripT = 0;
  }

  /**
   * Wake picket turrets on the decks that are still standing. Pylon decks
   * are the arena's authored high ground, so a turret there actually covers
   * the approach instead of shooting a wall.
   */
  _postTurrets(count) {
    const list = this.pylonList();
    if (!list || !list.length) return;
    let placed = 0;
    for (let i = 0; i < list.length && placed < count; i++) {
      const p = list[i];
      if (!p || !p.alive || !p.pos) continue;
      const a = (i * 2.4) + Math.random() * 1.2;
      const r = 26 + Math.random() * 10;
      const t = this._spawn('turret',
        p.pos.x + Math.cos(a) * r, p.pos.y, p.pos.z + Math.sin(a) * r,
        { alert: true, anchor: p.pos });
      if (t) { placed++; this.spawnedTurrets++; }
    }
    // if every deck is already dark, drop the picket near the player instead
    if (!placed) {
      const pl = this.ctx.player;
      if (!pl || !pl.pos) return;
      const a = Math.random() * Math.PI * 2;
      this._spawn('turret',
        pl.pos.x + Math.cos(a) * 120, 0, pl.pos.z + Math.sin(a) * 120,
        { alert: true });
    }
  }

  // ----------------------------------------------------------------
  //  slow reinforcement drip
  // ----------------------------------------------------------------
  tick(dt, act) {
    const gap = DRIP_GAP[act] || 0;
    if (!gap) return;
    this.dripT += dt;
    if (this.dripT < gap) return;
    if (this.combatants() > QUIET) { this.dripT = gap * 0.55; return; }
    this.dripT = 0;
    this._wave(DRIP_ROTA[this.dripN % DRIP_ROTA.length]);
    this.dripN++;
  }

  // ----------------------------------------------------------------
  //  ACT 3 — NIGHTJAR
  // ----------------------------------------------------------------
  /** returns the boss entity, or null if the enemy system cannot make one */
  callBoss() {
    const en = this.ctx.enemies;
    if (!en) return null;
    this.owned = true;
    try {
      if (typeof en.forceBoss === 'function') return en.forceBoss();
      if (typeof en.spawnWave === 'function') {
        const w = en.spawnWave('boss');
        if (w && w.length) return w[0];
      }
      if (typeof en.spawn === 'function') {
        const p = this.ctx.player;
        const d = 46;
        const x = p ? p.pos.x - Math.sin(p.yaw) * d : 0;
        const z = p ? p.pos.z - Math.cos(p.yaw) * d : -d;
        return this._spawn('boss', x, 0, z, { alert: true });
      }
    } catch (e) { /* fall through */ }
    return null;
  }

  boss() {
    const en = this.ctx.enemies;
    return (en && en.boss) || null;
  }

  bossSpawned() {
    const en = this.ctx.enemies;
    return !!(en && en.bossSpawned);
  }

  /** clean-up guard: never let the arena hold more than the cap can chew */
  get cap() { return CFG.MISSION.PYLONS; }
}

export default Director;

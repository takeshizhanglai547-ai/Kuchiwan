// ============================================================
//  EnemyManager — spawning, waves, AI dispatch, the boss AC and
//  every hit query the projectile system routes through us.
//  [owned by enemy-ai agent]
//
//  CONTRACT
//    new EnemyManager(ctx); .init(); .update(dt); .reset()
//    .alive() -> Enemy[]        (each: {id, kind, name, pos, ap, apMax, acs,
//                                acsMax, staggered, alive, root, takeDamage})
//    .spawn(kind, position, opts) -> Enemy
//    .spawnWave(name) -> Enemy[]
//    .forceBoss() -> Enemy
//    .boss -> Enemy|null
//    .queryHit(origin, dir, maxDist) -> {enemy, point, normal, distance}|null
//  Emits 'kill', 'stagger', 'damage', 'phase' (+ 'explode'/'fire'/'shake'
//  for presentation) on the bus.
//
//  EXTRAS (safe for mission/HUD to read)
//    .pylons[]  .pylonsAlive()  .combatants()  .killed  .score
//    .bossSpawned  .waves (names accepted by spawnWave)
//    .autoDirector — true until the mission calls spawnWave()/forceBoss(),
//      then this system stops scripting itself and does exactly what it
//      is told. So a stub mission still gets a full engagement arc.
//
//  PERF
//    * Enemy mechs are pooled per kind: a wave costs Object3D clones, not
//      geometry. Templates for every kind are pre-warmed at init().
//    * The AI runs on a budget: everything animates, but only the closest
//      AI_BUDGET units cast perception rays on a given frame (round robin).
//    * Nothing in the update path allocates.
// ============================================================
import * as THREE from 'three';
import { buildEnemyMech } from '../mech/mechModel.js';
import { volumeOf, rayCapsule, closestOnAxis, makeVolume } from '../combat/targets.js';
import { rand } from '../util/math.js';
import { DEF, HELP_RADIUS } from './enemyDefs.js';
import { Enemy } from './enemyUnit.js';
import { BRAINS } from './enemyAI.js';
import { brainBoss } from './bossAI.js';
import { pickBossSpot } from './bossStage.js';
import { buildPylon, disposePylonTemplate } from './pylonModel.js';

// NIGHTJAR drops in from above rather than walking on: from this height,
// with this much downward speed, gravity gives a ~0.6 s descent — long
// enough to read as a landing, short enough not to stall the encounter.
const BOSS_DROP_H = 27;
const BOSS_DROP_V = 22;

// Opening picket line: [lateral, forward, kind] along the insertion lane.
// `wake` is the delay before that echelon takes its first shot — the
// player gets a beat to move before the whole corridor opens up, and the
// volume of fire ramps instead of arriving as one wall.
const CONTACT = [
  [0, 84, 'mt', 1.1], [-36, 116, 'drone', 1.9], [32, 152, 'mt', 2.6],
  [-28, 198, 'mt', 3.4], [26, 244, 'drone', 4.2], [-16, 290, 'mt', 5.0], [18, 326, 'mt', 5.8],
];
const MAX_UNITS = 22;          // hard cap on concurrent hostiles
const AI_BUDGET = 10;          // perception raycasts per frame
const SEPARATION = 1.0;        // ground units shove each other apart

const _v = new THREE.Vector3();
const _spawn = new THREE.Vector3();
const _vol = makeVolume();
const _n = new THREE.Vector3();

export class EnemyManager {
  constructor(ctx) {
    this.ctx = ctx;
    this.list = [];
    this.pylons = [];
    this.boss = null;
    this.bossSpawned = false;
    this.killed = 0;
    this.score = 0;

    this._alive = [];
    this._dirty = true;
    this._pool = new Map();
    this._rr = 0;
    this._gc = false;
    this.autoDirector = true;

    this._queue = [];
    this._stageT = 0;
    this._elapsed = 0;

    this._qh = {
      enemy: null, entity: null, distance: 0,
      point: new THREE.Vector3(), normal: new THREE.Vector3(0, 0, 1),
    };
    this.waves = ['contact', 'armour', 'air', 'garrison', 'pylons', 'boss'];
  }

  // ================================================================
  init() {
    // Pre-warm the heavy templates so a wave (or the boss walking on)
    // never costs a geometry build mid-fight.
    this._warm('mt');
    this._warm('boss');
  }

  _warm(kind) {
    const m = buildEnemyMech(kind);
    m.root.visible = false;
    this._give(kind, m);
  }

  reset() {
    for (let i = 0; i < this.list.length; i++) this._release(this.list[i]);
    this.list.length = 0;
    this.pylons.length = 0;
    this._alive.length = 0;
    this._dirty = true;
    this.boss = null;
    this.bossSpawned = false;
    this.killed = 0;
    this.score = 0;
    this._rr = 0;
    this._stageT = 0;
    this._elapsed = 0;
    this.autoDirector = true;
    this._queue.length = 0;
    this._queue.push('armour', 'air', 'garrison');

    // opening state of the stage: the three objective pylons with their
    // garrison, plus the contact group between the player and the first one.
    this._wave('pylons');
    this._wave('contact');
  }

  // ================================================================
  //  roster
  // ================================================================
  alive() {
    if (this._dirty) {
      const a = this._alive;
      a.length = 0;
      for (let i = 0; i < this.list.length; i++) {
        const e = this.list[i];
        if (e.alive) a.push(e);
      }
      this._dirty = false;
    }
    return this._alive;
  }

  /** live hostiles that are not objective structures */
  combatants() {
    const a = this.alive();
    let n = 0;
    for (let i = 0; i < a.length; i++) if (a[i].kind !== 'pylon') n++;
    return n;
  }

  pylonsAlive() {
    let n = 0;
    for (let i = 0; i < this.pylons.length; i++) if (this.pylons[i].alive) n++;
    return n;
  }

  // ================================================================
  //  spawning
  // ================================================================
  spawn(kind, position, opts = {}) {
    const k = DEF[kind] ? kind : 'mt';
    if (this.list.length >= MAX_UNITS + 8) this._compact();
    if (this.alive().length >= MAX_UNITS && k !== 'boss' && k !== 'pylon') return null;

    const def = DEF[k];
    const w = this.ctx.world;
    _spawn.copy(position);
    if (w && w.sampleHeight) {
      // reference the requested height, not the absolute top: a unit posted on
      // a deck must not teleport onto the catwalk above it
      const gy = w.sampleHeight(_spawn.x, _spawn.z, _spawn.y + 6);
      if (Number.isFinite(gy)) _spawn.y = gy + (def.flying ? (def.hoverY || 20) : 0.02);
    }
    if (opts.dropY) _spawn.y += opts.dropY;

    const e = new Enemy(this, k, _spawn, opts);
    if (k === 'pylon') {
      const p = buildPylon(this.ctx.world.materials, {
        shieldRadius: def.shieldRadius, shieldY: def.shieldY,
      });
      e.attachPylon(p);
      e._pylonInst = p;
      this.pylons.push(e);
    } else {
      const mech = this._take(k);
      e.attachMech(mech);
    }
    e.brain = k === 'boss' ? brainBoss : (BRAINS[k] || BRAINS.mt);
    e.b = {
      state: k === 'boss' ? 'intro' : 'engage', t: 0,
      side: Math.random() < 0.5 ? -1 : 1,
      fireCd: opts.wake !== undefined ? opts.wake : rand(0.2, 1.4),
    };
    if (opts.lead !== undefined) e.b.lead = opts.lead;
    if (opts.dropY) {
      e.b.dropIn = true;
      e.vel.y = -(opts.dropVel || 0);
      e.grounded = false;
    }

    this.ctx.scene.add(e.root);
    this.list.push(e);
    this._dirty = true;
    if (k === 'boss') { this.boss = e; this.bossSpawned = true; }
    return e;
  }

  /**
   * Named wave. The mission owns pacing — the first external call switches
   * this system's own director off for good.
   */
  spawnWave(name) {
    this.autoDirector = false;
    return this._wave(name);
  }

  /** wipe the roster (for a mission that wants to script every spawn itself) */
  clear(keepPylons = false) {
    this.autoDirector = false;
    for (let i = 0; i < this.list.length; i++) {
      const e = this.list[i];
      if (keepPylons && e.kind === 'pylon' && e.alive) continue;
      e.alive = false; e.dying = false; e.dead = true;
      this._release(e);
    }
    if (!keepPylons) this.pylons.length = 0;
    // whatever we just wiped, the boss went with it — leaving a dead one
    // hanging off .boss makes the mission read it as "NIGHTJAR destroyed"
    if (this.boss && !this.boss.alive) { this.boss = null; this.bossSpawned = false; }
    this._compact();
  }

  _wave(name) {
    const out = [];
    const w = this.ctx.world;
    const p = this.ctx.player;
    switch (name) {
      // ----------------------------------------------------------
      case 'pylons': {
        // idempotent: reset() already posts the objective structures, so a
        // mission that asks for them again gets the ones already standing
        if (this.pylons.length) {
          for (let i = 0; i < this.pylons.length; i++) if (this.pylons[i].alive) out.push(this.pylons[i]);
          break;
        }
        const spots = (w && w.spawnPoints && w.spawnPoints.pylons) || [];
        for (let i = 0; i < spots.length; i++) {
          const s = spots[i];
          const py = this.spawn('pylon', s, { name: `IB-C10 PYLON ${String.fromCharCode(65 + i)}` });
          if (py) out.push(py);
          // garrison: MTs posted on the pylon deck, plus a picket turret
          for (let g = 0; g < 1; g++) {
            const a = rand(0, Math.PI * 2);
            _v.set(s.x + Math.cos(a) * rand(12, 18), s.y, s.z + Math.sin(a) * rand(12, 18));
            const mt = this.spawn('mt', _v, { anchor: s, anchorRadius: 90 });
            if (mt) out.push(mt);
          }
          if (i === 0) {
            _v.set(s.x + rand(-30, 30), s.y, s.z + rand(-30, 30));
            const t = this.spawn('turret', _v, { anchor: s });
            if (t) out.push(t);
          }
        }
        break;
      }
      // ----------------------------------------------------------
      case 'contact': {
        // The insertion lane is DEFENDED IN DEPTH, not garrisoned at one range:
        // the player boosts at 62 u/s, so a single picket line is behind them
        // three seconds in. Echelons every ~45 m keep the corridor hot.
        const fx = p ? -Math.sin(p.yaw) : 0, fz = p ? -Math.cos(p.yaw) : -1;
        const ox = p ? p.pos.x : 0, oz = p ? p.pos.z : 0;
        const yaw = Math.atan2(fx, fz);                 // facing back at the player
        for (let i = 0; i < CONTACT.length; i++) {
          const side = CONTACT[i][0], fwd = CONTACT[i][1], kind = CONTACT[i][2];
          _v.set(ox + fx * fwd - fz * side, 0, oz + fz * fwd + fx * side);
          const e = this.spawn(kind, _v, { alert: true, yaw, wake: CONTACT[i][3] });
          if (e) out.push(e);
        }
        break;
      }
      // ----------------------------------------------------------
      case 'armour': {
        this._atSpawnPoints(out, ['mt', 'mt', 'mt', 'drone'], 120, 300);
        break;
      }
      case 'air': {
        this._atSpawnPoints(out, ['heli', 'drone', 'drone'], 150, 330);
        break;
      }
      case 'garrison': {
        this._atSpawnPoints(out, ['mt', 'turret', 'mt', 'heli'], 130, 320);
        break;
      }
      // ----------------------------------------------------------
      case 'boss': {
        const b = this.forceBoss();
        if (b) out.push(b);
        break;
      }
      default:
        this._atSpawnPoints(out, ['mt', 'mt', 'drone'], 110, 320);
        break;
    }
    return out;
  }

  /** drop a squad on the arena's authored spawn points, away from the player */
  _atSpawnPoints(out, kinds, minD, maxD) {
    const w = this.ctx.world;
    const p = this.ctx.player;
    const pts = (w && w.spawnPoints && w.spawnPoints.enemies) || [];
    if (!pts.length) return;
    // rank by distance band to the player
    let bi = 0, bs = -Infinity;
    for (let i = 0; i < pts.length; i++) {
      const s = pts[i];
      const d = p ? Math.hypot(s.x - p.pos.x, s.z - p.pos.z) : 200;
      const score = (d > minD && d < maxD ? 100 : 0) - Math.abs(d - (minD + maxD) * 0.5) * 0.35 + Math.random() * 40;
      if (score > bs) { bs = score; bi = i; }
    }
    const base = pts[bi];
    for (let i = 0; i < kinds.length; i++) {
      const a = (i / kinds.length) * Math.PI * 2 + Math.random();
      _v.set(base.x + Math.cos(a) * rand(8, 34), base.y, base.z + Math.sin(a) * rand(8, 34));
      const e = this.spawn(kinds[i], _v, { alert: true });
      if (e) out.push(e);
    }
  }

  /** drop NIGHTJAR into clear line of sight and start the duel */
  forceBoss() {
    this.autoDirector = false;
    if (this.boss && this.boss.alive) return this.boss;
    if (this.bossSpawned && this.boss && !this.boss.alive) return this.boss;
    const p = this.ctx.player;

    // Placement is a real search, not a bearing guess — see bossStage.js.
    // It sweeps bearings AND ranges, raycasts each candidate from the LENS,
    // and scores open ground, headroom and backdrop. This is the single most
    // important spawn in the game; it is worth ~100 rays, once.
    _v.set(0, 0, -70);
    if (p) pickBossSpot(this.ctx, _v);

    const b = this.spawn('boss', _v, {
      alert: true, name: DEF.boss.name, lead: 0.9,
      dropY: BOSS_DROP_H, dropVel: BOSS_DROP_V,
    });
    if (b && p) b.yaw = Math.atan2(-(p.pos.x - b.pos.x), -(p.pos.z - b.pos.z));
    this.ctx.bus.emit('hud', { type: 'radio', speaker: 'HANDLER', text: 'AC signature on the deck. That is NIGHTJAR — do not let it close.', dur: 4.2 });
    this.ctx.bus.emit('hud', { type: 'warning', text: 'HOSTILE AC', dur: 2.6, level: 'danger', id: 'boss' });
    return b;
  }

  // ================================================================
  //  aggro
  // ================================================================
  alertNear(pos, src) {
    const a = this.alive();
    for (let i = 0; i < a.length; i++) {
      const e = a[i];
      if (e === src || e.alert || e.kind === 'pylon') continue;
      const dx = e.pos.x - pos.x, dz = e.pos.z - pos.z;
      if (dx * dx + dz * dz < HELP_RADIUS * HELP_RADIUS) e.alert = true;
    }
  }

  // ================================================================
  //  hit queries — every projectile in the game lands here
  // ================================================================
  queryHit(origin, dir, maxDist = 500) {
    const a = this.alive();
    let best = Infinity, ent = null;
    for (let i = 0; i < a.length; i++) {
      const e = a[i];
      if (!volumeOf(e, _vol)) continue;
      const t = rayCapsule(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, maxDist, _vol, 0);
      if (t >= 0 && t < best) { best = t; ent = e; }
    }
    if (!ent) return null;
    const q = this._qh;
    q.enemy = ent; q.entity = ent; q.distance = best;
    q.point.set(origin.x + dir.x * best, origin.y + dir.y * best, origin.z + dir.z * best);
    volumeOf(ent, _vol);
    closestOnAxis(_vol, q.point.x, q.point.y, q.point.z, _n);
    _n.set(q.point.x - _n.x, q.point.y - _n.y, q.point.z - _n.z);
    if (_n.lengthSq() < 1e-6) _n.set(-dir.x, -dir.y, -dir.z);
    q.normal.copy(_n).normalize();
    return q;
  }

  // ================================================================
  //  death bookkeeping
  // ================================================================
  onKill(e) {
    this._dirty = true;
    this.killed++;
    this.score += e.def.score || 0;
    if (e === this.boss) {
      const vfx = this.ctx.vfx;
      if (vfx && vfx.endTrail) vfx.endTrail('boss_ab');
      this.ctx.bus.emit('hud', { type: 'radio', speaker: 'HANDLER', text: 'NIGHTJAR is down. Clean work.', dur: 4 });
    } else if (e.kind === 'pylon') {
      this.ctx.bus.emit('hud', { type: 'banner', text: 'PYLON DESTROYED', sub: e.name, dur: 1.8 });
      this.alertNear(e.pos, e);
    }
  }

  /** called by the unit once its detonation has played */
  retire(e) {
    this._release(e);
    e.dead = true;
    this._gc = true;
    this._dirty = true;
  }

  _release(e) {
    if (!e.root) return;
    this.ctx.scene.remove(e.root);
    if (e.mech) { this._give(e.kind, e.mech); e.mech = null; }
    if (e._pylonInst) { e._pylonInst.api.dispose(); e._pylonInst = null; e.pylon = null; }
    e.root = null;
  }

  _compact() {
    let n = 0;
    for (let i = 0; i < this.list.length; i++) {
      const e = this.list[i];
      if (e.dead) continue;
      this.list[n++] = e;
    }
    this.list.length = n;
    this._gc = false;
    this._dirty = true;
  }

  // ---- mech pool --------------------------------------------------
  _take(kind) {
    const p = this._pool.get(kind);
    if (p && p.length) {
      const m = p.pop();
      m.root.visible = true;
      m.root.rotation.set(0, 0, 0);
      return m;
    }
    return buildEnemyMech(kind);
  }

  _give(kind, mech) {
    if (!mech) return;
    mech.root.visible = false;
    mech.api.setDamage(0);
    mech.api.setWeaponPose({ rifleRecoil: 0, bladeSwing: 0, bladeCharge: 0, cannonCharge: 0, missileOpen: 0 });
    let p = this._pool.get(kind);
    if (!p) { p = []; this._pool.set(kind, p); }
    if (p.length < 6) p.push(mech);
    else mech.api.dispose();
  }

  // ================================================================
  //  update
  // ================================================================
  update(dt) {
    if (dt <= 0) return;
    const d = Math.min(dt, 0.1);
    this._elapsed += d;
    this._stageT += d;

    const list = this.list;
    const n = list.length;
    // perception budget: a rolling window, so everything gets a ray
    // eventually but no single frame pays for the whole roster
    const budget = Math.min(AI_BUDGET, n);
    const start = n ? this._rr % n : 0;
    this._rr = (this._rr + budget) % Math.max(1, n);

    for (let i = 0; i < n; i++) {
      const e = list[i];
      if (e.dead) continue;
      const rel = (i - start + n) % n;
      e.update(d, rel < budget || e.kind === 'boss');
    }

    this._separate(d);
    if (this._gc) this._compact();
    if (this.autoDirector) this._director(d);
  }

  /** keep ground units from stacking into one silhouette */
  _separate(dt) {
    const a = this.alive();
    const n = a.length;
    for (let i = 0; i < n; i++) {
      const e = a[i];
      if (e.kind === 'pylon' || e.kind === 'turret' || e.free) continue;
      for (let j = i + 1; j < n; j++) {
        const o = a[j];
        if (o.kind === 'pylon' || o.kind === 'turret' || o.free) continue;
        const dx = o.pos.x - e.pos.x, dz = o.pos.z - e.pos.z;
        const min = (e.hitRadius + o.hitRadius) * 0.92;
        const d2 = dx * dx + dz * dz;
        if (d2 > min * min || d2 < 1e-4) continue;
        const dd = Math.sqrt(d2);
        const push = (min - dd) * SEPARATION * dt * 6;
        const ux = dx / dd, uz = dz / dd;
        e.pos.x -= ux * push; e.pos.z -= uz * push;
        o.pos.x += ux * push; o.pos.z += uz * push;
      }
    }
  }

  /**
   * Self-driving stage script. Runs only while no mission has taken over:
   * opening fight -> reinforcements as the field thins -> NIGHTJAR once the
   * pylons are down. Guarantees a complete arc with a stub mission.
   */
  _director() {
    if (this.ctx.state !== 'playing') return;
    const fighters = this.combatants();

    if (this._queue.length && (fighters <= 2 || (this._stageT > 46 && fighters < 7))) {
      this._wave(this._queue.shift());
      this._stageT = 0;
      return;
    }

    if (this.bossSpawned) return;
    const pyl = this.pylonsAlive();
    const ready = (!this._queue.length && pyl === 0 && fighters <= 2) || this._elapsed > 260;
    if (ready) {
      const keep = this.autoDirector;
      this.forceBoss();
      this.autoDirector = keep;    // forceBoss() disarms the director; we own this one
    }
  }

  // ================================================================
  dispose() {
    for (let i = 0; i < this.list.length; i++) this._release(this.list[i]);
    this.list.length = 0;
    for (const [, arr] of this._pool) for (const m of arr) m.api.dispose();
    this._pool.clear();
    disposePylonTemplate();
  }
}

export default EnemyManager;

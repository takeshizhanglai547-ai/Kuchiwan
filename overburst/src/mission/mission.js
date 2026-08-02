// ============================================================
//  Mission — OP-317 "SLAG CROWN": objectives, act script, timer,
//  win/lose rules, radio chatter and result scoring.
//  [owned by mission agent]
//
//  CONTRACT
//    new Mission(ctx); .init(); .update(dt); .reset()
//    .objectives -> [{ id, text, state:'pending'|'active'|'done'|'failed', count, of }]
//    .timeLeft, .score, .phase
//    Emits 'objective' when an objective changes, 'hud' for radio lines,
//    and drives ctx.game.setState('win'|'lose').
//
//  EXTRAS (safe to read)
//    .act (1..3)  .result  .stats  .started  .over
//    .result -> { win, reason, rank:'S'..'E', rating, score, time, timeLeft,
//                 dealt, taken, kills, staggers, pylons, kits, byKind,
//                 breakdown:[[label, points], ...] }
//
//  THE STAGE
//    ACT 1  INFILTRATE  — punch down the insertion lane into the basin.
//    ACT 2  COOLANT     — three defended pylons; every kill escalates the
//                         garrison (air wing, then the turret grid).
//    ACT 3  NIGHTJAR    — the hostile AC arrives on a scripted camera move
//                         and the duel decides the contract.
//
//  DESIGN RULES OBSERVED HERE
//    * Every call into ctx.enemies is guarded (see mission/director.js) —
//      that system is written in parallel and must never break the stage.
//    * Nothing in update() allocates: event payloads are reused objects and
//      the roster scans walk pre-built arrays.
//    * The mission never soft-locks. Every gate has a distance escape, a
//      timeout escape, or both.
// ============================================================
import { CFG } from '../config.js';
import { clamp } from '../util/math.js';
import { RADIO } from './script.js';
import { Scoring } from './scoring.js';
import { Director } from './director.js';
import { BossEntry } from './bossEntry.js';

const M = CFG.MISSION;

// --- act 1 gates ---------------------------------------------------
// The picket is spawned along the insertion heading, so the lane roster is
// everything the enemy system put in a corridor down that bearing. Killing
// it is the intended completion; the rest are escapes so the act can never
// stall on a unit stuck behind a silo.
const LANE_HALF = 80;       // m half-width of the insertion corridor
const LANE_MIN = 20;        // m ahead before a unit counts as "on the lane"
const LANE_MAX = 380;       // m ahead of the drop point the corridor reaches
const LANE_PUSH = 260;      // m travelled that counts as "through the lane"
const PYLON_NEAR = 55;      // m from a pylon deck that counts as "arrived"
const LANE_SHAKE = 110;     // no live picket this close = the lane is behind you
const ACT1_CAP = 85;        // s before the lane is declared clear regardless
const CONTACT_R = 210;      // m at which the first-contact call goes out

// --- timer warnings: [seconds, edge-bar text, severity] -------------
const TIME_MARKS = [
  [120, 'MISSION TIME 02:00', 'warn'],
  [60, 'MISSION TIME 01:00', 'danger'],
  [30, '30 SECONDS REMAINING', 'danger'],
];

// --- fail-safes ----------------------------------------------------
const NO_PYLON_GRACE = 22;  // s to wait for pylons before skipping act 2
const BOSS_RETRY = 2.5;     // s between attempts to put NIGHTJAR on the deck
const BOSS_TRIES = 4;

const LOW_AP = 0.25;

export class Mission {
  constructor(ctx) {
    this.ctx = ctx;

    this.objectives = [];
    this.timeLeft = M.TIME_LIMIT;
    this.score = 0;
    this.phase = 1;
    this.act = 1;
    this.result = null;
    this.started = false;
    this.over = false;

    this.scoring = new Scoring();
    this.director = new Director(ctx);
    this.bossEntry = new BossEntry(ctx);
    this.stats = this.scoring;

    // --- reused event payloads: emit() is synchronous, listeners copy ---
    this._radioEvt = { type: 'radio', speaker: '', text: '', dur: 0 };
    this._warnEvt = { type: 'warning', text: '', dur: 2.2, level: 'warn', id: 'time' };
    this._objEvt = { id: '', state: '', text: '' };

    this._q = [];               // pending radio lines
    this._radioCd = 0;
    this._lane = [];            // the act-1 picket roster
    this._laneOf = 0;
    this._pylonRoster = null;
    this._pylonTotal = M.PYLONS;

    this._t = 0;
    this._actT = 0;
    this._startX = 0;
    this._startZ = 0;

    this._escalated = 0;
    this._timeMark = 0;
    this._saidOpen = false;
    this._saidContact = false;
    this._saidLowAp = false;
    this._saidBossStagger = false;
    this._bossPhase = 0;
    this._bossByMe = false;
    this._bossTries = 0;
    this._bossT = 0;
    this._objShown = false;
    this._saidBossAdopted = false;
    this._pendWin = false;
    this._pendReason = '';
    this._scan = 0;
    this._pendObj = null;      // objective whose 'active' banner is queued
    this._pendObjT = 0;
  }

  // ================================================================
  init() {
    const bus = this.ctx.bus;
    bus.on('damage', (e) => this._onDamage(e));
    bus.on('kill', (e) => this._onKill(e));
    bus.on('stagger', (e) => this._onStagger(e));
    bus.on('phase', (e) => this._onPhase(e));
    this._buildObjectives();
  }

  // ================================================================
  reset() {
    const ctx = this.ctx;

    this.timeLeft = M.TIME_LIMIT;
    this.score = 0;
    this.phase = 1;
    this.act = 1;
    this.result = null;
    this.started = true;
    this.over = false;

    this.scoring.reset();
    this.director.reset();
    this.bossEntry.reset();

    this._q.length = 0;
    this._radioCd = 0;
    this._t = 0;
    this._actT = 0;
    this._escalated = 0;
    this._timeMark = 0;
    this._saidOpen = false;
    this._saidContact = false;
    this._saidLowAp = false;
    this._saidBossStagger = false;
    this._bossPhase = 0;
    this._bossByMe = false;
    this._bossTries = 0;
    this._bossT = 0;
    this._objShown = false;
    this._saidBossAdopted = false;
    this._pendWin = false;
    this._pendReason = '';
    this._scan = 0;
    this._pendObj = null;
    this._pendObjT = 0;

    const p = ctx.player;
    this._startX = p && p.pos ? p.pos.x : 0;
    this._startZ = p && p.pos ? p.pos.z : 0;

    // Take pacing ownership from the enemy system's self-director. This is
    // idempotent for the pylons — they are already standing after its reset.
    this.director.ensurePylons();

    // The opening picket: everything the enemy system posted in a corridor
    // down the insertion heading. Pylon-deck garrisons sit off that bearing
    // and belong to act 2, so they are deliberately not counted here.
    this._captureLane(p);

    const en = ctx.enemies;
    this._pylonRoster = (en && en.pylons) || null;
    this._pylonTotal = (this._pylonRoster && this._pylonRoster.length) || M.PYLONS;

    this._buildObjectives();
    this._say(RADIO.open);
  }

  /** roster the insertion-lane picket off the player's drop heading */
  _captureLane(p) {
    const lane = this._lane;
    lane.length = 0;
    const en = this.ctx.enemies;
    if (!en || typeof en.alive !== 'function') { this._laneOf = 0; return; }

    let all = null;
    try { all = en.alive(); } catch (err) { all = null; }
    if (!all || !all.length) { this._laneOf = 0; return; }

    const yaw = p && typeof p.yaw === 'number' ? p.yaw : 0;
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    for (let i = 0; i < all.length; i++) {
      const e = all[i];
      if (!e || e.kind === 'pylon' || !e.pos) continue;
      const rx = e.pos.x - this._startX, rz = e.pos.z - this._startZ;
      const along = rx * fx + rz * fz;
      const lat = Math.abs(rx * fz - rz * fx);
      if (along > LANE_MIN && along < LANE_MAX && lat < LANE_HALF) lane.push(e);
    }
    // nothing on the bearing (an enemy system that spawns elsewhere) —
    // fall back to the whole opening roster so the counter still means something
    if (!lane.length) {
      for (let i = 0; i < all.length; i++) {
        const e = all[i];
        if (e && e.kind !== 'pylon') lane.push(e);
      }
    }
    this._laneOf = lane.length;
  }

  _buildObjectives() {
    const o = this.objectives;
    o.length = 0;
    o.push({ id: 'infiltrate', text: 'CLEAR THE INSERTION LANE', state: 'active', count: 0, of: this._laneOf || 0 });
    o.push({ id: 'pylons', text: 'DESTROY THE COOLANT PYLONS', state: 'pending', count: 0, of: this._pylonTotal || M.PYLONS });
    o.push({ id: 'nightjar', text: 'ELIMINATE AC NIGHTJAR', state: 'pending', count: 0, of: 0 });
  }

  // ================================================================
  update(dt) {
    if (dt <= 0) return;
    const d = dt > 0.1 ? 0.1 : dt;
    if (this.over) { this._pumpRadio(d); return; }

    this._t += d;
    this._actT += d;
    this.timeLeft = M.TIME_LIMIT - this._t;
    if (this.timeLeft < 0) this.timeLeft = 0;
    this.score = this.scoring.live;

    this._pumpRadio(d);
    this._pumpObjective(d);
    this._timeWarnings();
    this._lowApCall();

    if (this.bossEntry.active) this.bossEntry.update(d);

    // objective panel wakes a beat after the drop so it does not collide
    // with the opening transmission
    if (!this._objShown && this._t > 1.0) {
      this._objShown = true;
      this._emitObjective(this.objectives[0]);
    }

    if (this.act === 1) this._act1();
    else if (this.act === 2) this._act2();
    else this._act3(d);

    this.director.tick(d, this.act);
    this._checkEnd();
  }

  // ================================================================
  //  ACT 1 — INFILTRATE
  // ================================================================
  _act1() {
    const o = this.objectives[0];
    const down = this._laneDown();
    o.count = down;

    if (!this._saidContact && (this._t > 1.6) && this._laneNear(CONTACT_R)) {
      this._saidContact = true;
      this._say(RADIO.contact);
    }

    if (this._act1Done(down)) this._toAct2();
  }

  _act1Done(down) {
    // intended completion: the picket that engaged you is dead
    if (this._laneOf > 0 && down >= this._laneOf) return true;
    if (this._actT > ACT1_CAP) return true;
    if (this._pylonsDown() > 0) return true;          // player skipped ahead

    const p = this.ctx.player;
    if (!p || !p.pos) return false;

    // ...or you left them behind. Never declare a lane clear with a live
    // picket still shooting at your back.
    const dx = p.pos.x - this._startX, dz = p.pos.z - this._startZ;
    let through = dx * dx + dz * dz > LANE_PUSH * LANE_PUSH;
    if (!through) {
      const list = this._pylonRoster;
      if (list) {
        for (let i = 0; i < list.length && !through; i++) {
          const py = list[i];
          if (!py || !py.pos) continue;
          const ex = py.pos.x - p.pos.x, ez = py.pos.z - p.pos.z;
          if (ex * ex + ez * ez < PYLON_NEAR * PYLON_NEAR) through = true;
        }
      }
    }
    return through && !this._laneWithin(LANE_SHAKE, p);
  }

  /** unthrottled: is any live picket unit inside `r` of the player */
  _laneWithin(r, p) {
    const r2 = r * r;
    for (let i = 0; i < this._lane.length; i++) {
      const e = this._lane[i];
      if (!e || e.alive === false || !e.pos) continue;
      const dx = e.pos.x - p.pos.x, dz = e.pos.z - p.pos.z;
      if (dx * dx + dz * dz < r2) return true;
    }
    return false;
  }

  _toAct2() {
    const o = this.objectives;
    o[0].count = o[0].of;
    o[0].state = 'done';
    this._emitObjective(o[0]);
    o[1].state = 'active';
    this._queueObjective(o[1], 1.8);
    this.act = 2;
    this.phase = 2;
    this._actT = 0;
    this._say(RADIO.act1Done);
  }

  /** how many of the opening picket are down */
  _laneDown() {
    let n = 0;
    for (let i = 0; i < this._lane.length; i++) {
      const e = this._lane[i];
      if (!e || e.alive === false) n++;
    }
    return n;
  }

  /** throttled proximity test used for the first-contact call */
  _laneNear(r) {
    if (--this._scan > 0) return false;
    this._scan = 6;
    const p = this.ctx.player;
    if (!p || !p.pos) return false;
    return this._laneWithin(r, p);
  }

  // ================================================================
  //  ACT 2 — DESTROY THE COOLANT PYLONS
  // ================================================================
  _act2() {
    const o = this.objectives[1];
    const total = o.of || M.PYLONS;

    if (!this._pylonRoster || !this._pylonRoster.length) {
      // the enemy system never put objective structures on the field —
      // do not deadlock the stage on them
      if (this._actT > NO_PYLON_GRACE) { o.count = total; this._toAct3(); }
      return;
    }

    const down = this._pylonsDown();
    o.count = down < 0 ? 0 : down;

    while (this._escalated < down && this._escalated < 3) {
      this._escalated++;
      this.director.escalate(this._escalated);
      const beat = this._escalated === 1 ? RADIO.pylon1
        : this._escalated === 2 ? RADIO.pylon2 : RADIO.pylon3;
      this._say(beat);
    }

    if (down >= total) this._toAct3();
  }

  _pylonsDown() {
    const list = this._pylonRoster;
    if (!list || !list.length) return 0;
    let n = 0;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (!e || e.alive === false) n++;
    }
    return n;
  }

  _toAct3() {
    const o = this.objectives;
    o[1].count = o[1].of;
    o[1].state = 'done';
    this._emitObjective(o[1]);
    o[2].state = 'active';
    this._queueObjective(o[2], 2.0);
    this.act = 3;
    this.phase = 3;
    this._actT = 0;
    this._bossT = BOSS_RETRY;    // call it in on the next frame
  }

  // ================================================================
  //  ACT 3 — ELIMINATE NIGHTJAR
  // ================================================================
  _act3(dt) {
    const dir = this.director;
    if (!dir.bossSpawned()) {
      this._bossT += dt;
      if (this._bossT >= BOSS_RETRY && this._bossTries < BOSS_TRIES) {
        this._bossT = 0;
        this._bossTries++;
        const b = dir.callBoss();
        if (b) {
          this._bossByMe = true;
          this.bossEntry.begin(b);
          // NIGHTJAR walking on outranks anything still queued behind it
          this._say(RADIO.boss, true);
        }
      } else if (this._bossTries >= BOSS_TRIES) {
        // no hostile AC can be produced — the contract is still satisfied
        this._pendWin = true;
        this._pendReason = 'boss';
      }
      return;
    }

    // The boss may have been dropped by something other than us (the visual
    // QA harness calls forceBoss directly). Adopt it without a cinematic.
    if (!this._bossByMe) {
      this._bossByMe = true;
      if (!this._saidBossAdopted) { this._saidBossAdopted = true; this._say(RADIO.boss, true); }
    }

    const b = dir.boss();
    if (b && b.alive === false) { this._pendWin = true; this._pendReason = 'boss'; }
  }

  // ================================================================
  //  bus handlers — flag only, resolved inside update()
  // ================================================================
  _onDamage(e) {
    if (!e || this.over || this.ctx.state !== 'playing') return;
    const amt = e.amount || 0;
    if (amt <= 0) return;
    if (e.isPlayer || e.entity === this.ctx.player) this.scoring.damageTaken(amt);
    else this.scoring.damageDealt(amt);
    if (!this._saidContact && this.act === 1) {
      this._saidContact = true;
      this._say(RADIO.contact);
    }
  }

  _onKill(e) {
    if (!e || this.over) return;
    const ent = e.entity;
    if (ent === this.ctx.player) return;
    const kind = e.kind || (ent && ent.kind) || 'mt';
    this.scoring.kill(kind);
    if (kind === 'boss') { this._pendWin = true; this._pendReason = 'boss'; }
  }

  _onStagger(e) {
    if (!e || this.over) return;
    const ent = e.entity;
    if (ent === this.ctx.player) return;
    this.scoring.stagger();
    if (ent && ent.kind === 'boss' && !this._saidBossStagger) {
      this._saidBossStagger = true;
      this._say(RADIO.bossStagger);
    }
  }

  _onPhase(e) {
    if (!e || this.over) return;
    const ent = e.entity;
    if (!ent || ent.kind !== 'boss') return;
    const n = e.phase || 0;
    if (n <= this._bossPhase) return;
    this._bossPhase = n;
    // a reconfiguration beat is the most important thing on the channel
    if (n === 1) this._say(RADIO.bossPhase2, true);
    else if (n >= 2) this._say(RADIO.bossPhase3, true);
  }

  // ================================================================
  //  pressure calls
  // ================================================================
  _timeWarnings() {
    while (this._timeMark < TIME_MARKS.length && this.timeLeft <= TIME_MARKS[this._timeMark][0]) {
      const mark = TIME_MARKS[this._timeMark];
      this._timeMark++;
      const w = this._warnEvt;
      w.text = mark[1];
      w.dur = mark[0] <= 30 ? 3.0 : 2.4;
      w.level = mark[2];
      w.id = 'time';
      this.ctx.bus.emit('hud', w);
      this._say(mark[0] === 120 ? RADIO.time120 : mark[0] === 60 ? RADIO.time60 : RADIO.time30, true);
    }
  }

  _lowApCall() {
    if (this._saidLowAp) return;
    const p = this.ctx.player;
    if (!p || typeof p.ap !== 'number') return;
    const max = p.apMax || CFG.PLAYER.AP;
    if (p.ap > 0 && p.ap / max < LOW_AP) {
      this._saidLowAp = true;
      this._say(RADIO.lowAp, true);
    }
  }

  // ================================================================
  //  radio pump — one line at a time, paced to the HUD's typing speed
  // ================================================================
  _say(beat, urgent) {
    if (!beat || !beat.length) return;
    if (urgent) { this._q.length = 0; this._radioCd = 0; }
    else if (this._q.length > 3) this._q.splice(0, this._q.length - 3);
    for (let i = 0; i < beat.length; i++) this._q.push(beat[i]);
  }

  _pumpRadio(dt) {
    if (this._radioCd > 0) { this._radioCd -= dt; return; }
    if (!this._saidOpen && this._t < 0.15) return;   // beat the HUD's own seed line
    const line = this._q.shift();
    if (!line) return;
    this._saidOpen = true;
    const r = this._radioEvt;
    r.speaker = line.s; r.text = line.t; r.dur = line.d;
    this.ctx.bus.emit('hud', r);
    // typing runs at ~46 chars/s inside the HUD, then it holds
    this._radioCd = line.t.length / 46 + line.d + 0.25;
  }

  _emitObjective(o) {
    if (!o) return;
    const e = this._objEvt;
    e.id = o.id; e.state = o.state; e.text = o.text;
    this.ctx.bus.emit('objective', e);
  }

  /** hold a 'NEW OBJECTIVE' banner back so it does not stomp the previous one */
  _queueObjective(o, delay) {
    this._pendObj = o;
    this._pendObjT = delay;
  }

  _pumpObjective(dt) {
    if (!this._pendObj) return;
    this._pendObjT -= dt;
    if (this._pendObjT > 0) return;
    const o = this._pendObj;
    this._pendObj = null;
    if (o.state === 'active') this._emitObjective(o);
  }

  // ================================================================
  //  resolution
  // ================================================================
  _checkEnd() {
    if (this.over) return;
    const p = this.ctx.player;
    if (p && (p.alive === false || (typeof p.ap === 'number' && p.ap <= 0))) {
      this._end(false, 'destroyed');
      return;
    }
    if (this.timeLeft <= 0) { this._end(false, 'timeout'); return; }
    if (this._pendWin) this._end(true, this._pendReason || 'boss');
  }

  _end(win, reason) {
    if (this.over) return;
    this.over = true;
    this.bossEntry.reset();

    // close the objective board honestly
    const o = this.objectives;
    for (let i = 0; i < o.length; i++) {
      if (o[i].state !== 'active') continue;
      if (win) { o[i].state = 'done'; o[i].count = o[i].of; }
      else o[i].state = 'failed';
      this._emitObjective(o[i]);
    }

    const p = this.ctx.player;
    const total = CFG.PLAYER.REPAIR_KITS || 0;
    const left = p && typeof p.repairKits === 'number' ? p.repairKits : total;
    const kits = clamp(total - left, 0, total);

    this.result = this.scoring.compute(win, this._t, this.timeLeft, kits, reason);
    this.score = this.result.score;
    this.phase = win ? 4 : 0;

    // the sign-off has to land immediately — update() is about to stop
    const beat = win ? RADIO.win : reason === 'timeout' ? RADIO.loseTime : RADIO.loseDead;
    this._q.length = 0;
    this._radioCd = 0;
    for (let i = 0; i < beat.length; i++) {
      const r = this._radioEvt;
      r.speaker = beat[i].s; r.text = beat[i].t; r.dur = beat[i].d;
      this.ctx.bus.emit('hud', r);
    }

    try { this.ctx.game.setState(win ? 'win' : 'lose'); } catch (e) { /* ignore */ }
  }
}

export default Mission;

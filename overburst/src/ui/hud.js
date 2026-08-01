// ============================================================
//  HUD — every piece of 2D interface: title/briefing, combat HUD,
//  world-space overlays, result screen.
//  Owns all DOM inside #ui-root and the styles in ui/hud.css.
//
//  CONTRACT
//    new HUD(ctx); .init(); .update(dt); .reset()
//    Reacts to bus: 'state' 'objective' 'damage' 'kill' 'lock' 'hud'
//                   'phase' 'hit' 'stagger'
//    Calls ctx.game.startMission() from the title screen action.
//
//  PUBLIC API (other systems may call these directly)
//    hud.radio(speaker, text, dur)
//    hud.warn(text, dur, level, id)      // edge WARNING bars
//         level: 'info'(cyan) | 'warn'(amber) | 'danger'(red, default)
//         id:    channel key — same id replaces, lower severity never
//                interrupts a live higher-severity warning
//    hud.banner(text, sub, dur)          // short centre callout
//    hud.damageNumber(worldPos, amount, direct)
//    hud.damageFrom(worldPos)            // directional damage arc
//    hud.hitMarker(kill)
//    hud.setLock(targets, hard)
//    hud.target                          // current readout entity
//
//  'hud' bus events understood (all fields optional):
//    { type:'radio',   speaker, text, dur }
//    { type:'banner'|'toast', text, sub, dur }
//    { type:'warning'|'alert', text, dur, level, id, amber }
//    { type:'missile' }                          -> MISSILE ALERT
//    { type:'repair',  kits, done }
//    { type:'qb' } { type:'ab', on }             -> read live off ctx.player
//    { type:'hitmarker', kill }
//    { type:'damage', position, amount, direct }
//    { type:'arc', position }
// ============================================================
import * as THREE from 'three';
import { CFG } from '../config.js';
import { TitleScreen } from './titleScreen.js';
import { CombatHud } from './combatHud.js';
import { Overlays } from './overlays.js';
import { ResultScreen } from './resultScreen.js';

const SCAN_FRAMES = 5;
const PEND = 16;
const _tmp = new THREE.Vector3();

export class HUD {
  constructor(ctx) {
    this.ctx = ctx;
    this.title = new TitleScreen(ctx);
    this.combat = new CombatHud(ctx);
    this.overlays = new Overlays(ctx);
    this.result = new ResultScreen(ctx);

    this.target = null;
    this.lockTargets = [];
    this.locks = this.lockTargets;
    this.hardLock = false;

    this.stats = { time: 0, dealt: 0, taken: 0, kills: 0, staggers: 0, kits: 0 };

    this.w = 0; this.h = 0;
    this._scan = 0;
    this._radioSeeded = false;
    this._pend = [];
    for (let i = 0; i < PEND; i++) this._pend.push({ e: null, x: 0, y: 0, z: 0, dmg: 0, direct: false, used: true });
    this._pendN = 0;
  }

  // ------------------------------------------------------------------
  init() {
    const root = this.ctx.uiRoot;
    if (!root) return;
    root.innerHTML = '';
    root.appendChild(this.title.build());
    root.appendChild(this.combat.build());
    root.appendChild(this.overlays.build());
    root.appendChild(this.result.build());

    this._resize();
    window.addEventListener('resize', () => this._resize());

    const bus = this.ctx.bus;
    bus.on('state', (e) => this._onState(e));
    bus.on('hit', (e) => this._onHit(e));
    bus.on('damage', (e) => this._onDamage(e));
    bus.on('kill', (e) => this._onKill(e));
    bus.on('stagger', (e) => this._onStagger(e));
    bus.on('lock', (e) => this._onLock(e));
    bus.on('objective', (e) => this._onObjective(e));
    bus.on('phase', (e) => this._onPhase(e));
    bus.on('hud', (e) => this._onHudEvent(e));

    this._applyState(this.ctx.state);
  }

  reset() {
    this.combat.reset();
    this.overlays.reset();
    this.target = null;
    this.lockTargets.length = 0;
    this.hardLock = false;
    this.stats.time = 0; this.stats.dealt = 0; this.stats.taken = 0;
    this.stats.kills = 0; this.stats.staggers = 0; this.stats.kits = 0;
    this._pendN = 0;
    for (let i = 0; i < PEND; i++) this._pend[i].used = true;
    this._radioSeeded = false;
    this._scan = 0;
  }

  // ------------------------------------------------------------------
  //  public API
  // ------------------------------------------------------------------
  radio(speaker, text, dur) { this._radioSeeded = true; this.combat.radio(speaker, text, dur); }
  warn(text, dur, amber) { this.combat.warn(text, dur, amber); }
  banner(text, sub, dur) { this.combat.banner(text, sub, dur); }
  damageNumber(pos, amount, direct) { this.overlays.damageNumber(pos, amount, direct); }
  damageFrom(pos) { this.overlays.damageFrom(pos); }
  hitMarker(kill) { this.overlays.hitMarker(kill); }
  setLock(targets, hard) {
    this.lockTargets.length = 0;
    if (targets && targets.length) for (let i = 0; i < targets.length; i++) {
      const t = targets[i];
      const e = t && t.pos ? t : (t && t.target && t.target.pos ? t.target : null);
      if (e) this.lockTargets.push(e);
    }
    this.hardLock = !!hard;
  }

  // ------------------------------------------------------------------
  update(dt) {
    if (window.innerWidth !== this.w || window.innerHeight !== this.h) this._resize();

    const st = this.ctx.state;
    // prefer the player's live lock list — it mutates without re-emitting 'lock'
    const p = this.ctx.player;
    this.locks = (p && p.lockList && p.lockList.length) ? p.lockList : this.lockTargets;
    if (st === 'playing') {
      this._pickTarget();
      this.combat.update(dt, this.target);
      this._flushPending();
      if (!this._radioSeeded && this.ctx.time > 0.55) {
        this._radioSeeded = true;
        this.combat.radio('HANDLER', 'OP-317 IS LIVE. THE SLAG CROWN IS BURNING AND EVERYTHING IN IT WANTS YOU DEAD. MOVE.');
      }
    }
    this.overlays.update(dt, st === 'playing' ? this.target : null, this.locks);
  }

  // ------------------------------------------------------------------
  //  layout
  // ------------------------------------------------------------------
  _resize() {
    const w = window.innerWidth || 1600;
    const h = window.innerHeight || 900;
    this.w = w; this.h = h;
    let s = Math.min(w / 1600, h / 900);
    if (s < 0.74) s = 0.74; else if (s > 1.45) s = 1.45;
    document.documentElement.style.fontSize = (s * 16).toFixed(2) + 'px';
    this.overlays.resize(w, h);
  }

  // ------------------------------------------------------------------
  //  state machine
  // ------------------------------------------------------------------
  _onState(e) { this._applyState(e && e.to); }

  _applyState(to) {
    const titleOn = to === 'title' || to === 'boot';
    const play = to === 'playing';
    const over = to === 'win' || to === 'lose';
    this.title.show(titleOn);
    this.combat.show(play);
    this.overlays.show(play);
    this.result.show(over);
    if (over) {
      const p = this.ctx.player;
      this.stats.time = this.ctx.time || 0;
      const total = CFG.PLAYER.REPAIR_KITS || 0;
      const left = p && typeof p.repairKits === 'number' ? p.repairKits : total;
      this.stats.kits = Math.max(0, total - left);
      this.result.present(to === 'win', this.stats);
    }
  }

  // ------------------------------------------------------------------
  //  target selection — hard lock wins, otherwise a soft in-view scan
  //  so the readout is always populated even while other systems stub.
  // ------------------------------------------------------------------
  _pickTarget() {
    const p = this.ctx.player;
    const hard = p && p.lockTarget && p.lockTarget.alive !== false ? p.lockTarget : null;
    if (hard) { this.target = this._named(hard); return; }
    const l0 = this.lockTargets.length ? this.lockTargets[0] : null;
    if (l0 && l0.alive !== false) { this.target = this._named(l0); return; }
    if (this.target && this.target.alive === false) this.target = null;
    if (--this._scan > 0) return;          // rescan on a fixed cadence, never per-frame
    this._scan = SCAN_FRAMES;
    this.target = this._named(this._scanBest());
  }

  _scanBest() {
    const c = this.ctx;
    const cam = c.camera;
    let list = null;
    try { list = c.enemies && c.enemies.alive ? c.enemies.alive() : null; } catch (err) { list = null; }
    if (!list || !list.length || !cam) return null;
    _tmp.set(0, 0, -1).applyQuaternion(cam.quaternion);
    const fx = _tmp.x, fy = _tmp.y, fz = _tmp.z;
    const cx = cam.position.x, cy = cam.position.y, cz = cam.position.z;
    let best = null, bestS = -1e9;
    const range = (CFG.LOCK.RANGE || 420) * 1.5;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (!e || e.alive === false || !e.pos) continue;
      const dx = e.pos.x - cx, dy = e.pos.y - cy, dz = e.pos.z - cz;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d < 1e-3 || d > range) continue;
      const dot = (dx * fx + dy * fy + dz * fz) / d;
      if (dot < 0.55) continue;
      const s = dot * 3 - d / 700;
      if (s > bestS) { bestS = s; best = e; }
    }
    return best;
  }

  /** Cache a display name on the entity, re-deriving it if the kind changed
   *  (enemy objects may be pooled and re-used for a different kind). */
  _named(e) {
    if (e && (!e.__hudName || e.__hudKind !== e.kind)) {
      try {
        e.__hudKind = e.kind;
        e.__hudName = e.name || NAMES[e.kind] || (e.kind ? String(e.kind).toUpperCase() : 'HOSTILE');
      } catch (err) { /* frozen entity — readout falls back to UNKNOWN */ }
    }
    return e || null;
  }

  // ------------------------------------------------------------------
  //  bus handlers
  // ------------------------------------------------------------------
  _onHit(e) {
    if (!e) return;
    const t = e.target;
    if (!t) return;
    if (t === this.ctx.player || e.isPlayer) {
      const src = e.point || (e.source && e.source.pos) || null;
      if (src) this.overlays.damageFrom(src);
      return;
    }
    // stash for the matching 'damage' event; flushed at end of frame if unused
    const r = this._pend[this._pendN % PEND];
    this._pendN++;
    r.e = t; r.dmg = e.damage || 0; r.direct = !!e.direct; r.used = false;
    const pt = e.point || t.pos;
    if (pt) { r.x = pt.x; r.y = pt.y; r.z = pt.z; } else { r.x = r.y = r.z = 0; }
  }

  _onDamage(e) {
    if (!e) return;
    const amt = e.amount || 0;
    const isP = e.isPlayer || e.entity === this.ctx.player;
    if (isP) {
      this.stats.taken += amt;
      const s = e.source;
      if (s) {
        const at = s.pos || s.position || (typeof s.x === 'number' ? s : null);
        if (at) this.overlays.damageFrom(at);
      }
      return;
    }
    this.stats.dealt += amt;
    const ent = e.entity;
    let px = 0, py = 0, pz = 0, has = false, direct = !!e.direct;
    for (let i = 0; i < PEND; i++) {
      const r = this._pend[i];
      if (!r.used && r.e === ent) {
        r.used = true; px = r.x; py = r.y; pz = r.z; has = true;
        direct = direct || r.direct;
        break;
      }
    }
    if (!has && ent && ent.pos) {
      px = ent.pos.x; py = ent.pos.y + 5; pz = ent.pos.z; has = true;
    }
    if (has && amt > 0) {
      _tmp.set(px, py, pz);
      this.overlays.damageNumber(_tmp, amt, direct, !!e.staggered);
    }
    this.overlays.hitMarker(false);
  }

  /** Any 'hit' with no matching 'damage' still produces a number. */
  _flushPending() {
    for (let i = 0; i < PEND; i++) {
      const r = this._pend[i];
      if (r.used) continue;
      r.used = true;
      if (r.dmg > 0) {
        this.stats.dealt += r.dmg;
        _tmp.set(r.x, r.y, r.z);
        this.overlays.damageNumber(_tmp, r.dmg, r.direct);
        this.overlays.hitMarker(false);
      }
    }
  }

  _onKill(e) {
    const ent = e && e.entity;
    if (ent === this.ctx.player) return;
    this.stats.kills++;
    this.overlays.hitMarker(true);
    const kind = (e && e.kind) || (ent && ent.kind);
    if (kind === 'boss') this.combat.banner('TARGET DESTROYED', 'HOSTILE AC NEUTRALISED', 2.4);
    else if (kind === 'pylon') this.combat.banner('PYLON DESTROYED', '', 1.5);
    if (this.target === ent) this.target = null;
  }

  _onStagger(e) {
    const ent = e && e.entity;
    if (ent === this.ctx.player) return;   // player raises its own ACS FAILURE warning
    this.stats.staggers++;
    this.combat.banner('STAGGER', '', 1.1);
  }

  _onLock(e) {
    if (!e) return;
    this.setLock(e.targets, e.hard);
    const t = e.target;
    if (t && t.pos) {
      const i = this.lockTargets.indexOf(t);
      if (i > 0) { this.lockTargets[i] = this.lockTargets[0]; this.lockTargets[0] = t; }
      else if (i < 0) this.lockTargets.unshift(t);
    }
  }

  _onObjective(e) {
    if (!e) return;
    if (e.state === 'done') this.combat.banner('OBJECTIVE COMPLETE', e.text || '', 2.0);
    else if (e.state === 'failed') this.combat.banner('OBJECTIVE FAILED', e.text || '', 2.0);
    else if (e.state === 'active') this.combat.banner('NEW OBJECTIVE', e.text || '', 1.8);
  }

  _onPhase(e) {
    if (!e) return;
    const ent = e.entity;
    if (ent && ent.kind === 'boss') this.combat.banner('PHASE ' + ((e.phase || 0) + 1), 'HOSTILE AC RECONFIGURING', 2.0);
  }

  _onHudEvent(e) {
    if (!e || !e.type) return;
    switch (e.type) {
      case 'radio':
        this._radioSeeded = true;
        this.combat.radio(e.speaker || 'HANDLER', e.text, e.dur);
        break;
      case 'banner':
      case 'toast':
        this.combat.banner(e.text, e.sub, e.dur);
        break;
      case 'warning':
      case 'alert':
        this.combat.warn(e.text || 'WARNING', e.dur,
          e.level != null ? e.level : (e.amber ? 'warn' : 'danger'), e.id);
        break;
      case 'missile':
        this.combat.warn('MISSILE ALERT', e.dur == null ? 1.6 : e.dur, 'warn', 'missile');
        break;
      case 'repair':
        this.combat.banner(e.done ? 'REPAIR COMPLETE' : 'REPAIRING',
          'KITS ' + (typeof e.kits === 'number' ? e.kits : 0) + ' REMAINING', e.done ? 1.4 : 1.0);
        break;
      case 'qb':
      case 'ab':
        break;   // read live off ctx.player — no HUD state to latch
      case 'hitmarker':
        this.overlays.hitMarker(!!e.kill);
        break;
      case 'damage':
        if (e.position) this.overlays.damageNumber(e.position, e.amount || 0, !!e.direct);
        break;
      case 'arc':
        if (e.position) this.overlays.damageFrom(e.position);
        break;
      default: break;
    }
  }
}

const NAMES = {
  mt: 'MT-A21 SLAGHAND',
  drone: 'AD-08 CINDER',
  heli: 'RH-19 KESTREL',
  turret: 'AT-44 PICKET',
  pylon: 'IB-C10 COOLANT PYLON',
  boss: 'AC 04 CROWNBREAKER',
};

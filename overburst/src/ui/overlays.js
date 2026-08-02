// ============================================================
//  ui/overlays.js — everything that needs world -> screen space.
//    · centre reticle (+ spread, + lock state)
//    · hit marker
//    · lock target frames (corner ticks, stacked for multi-lock)
//    · world-space damage numbers
//    · directional damage arcs
//
//  Projection is done here with ctx.camera; all elements are pooled
//  and animated with transform/opacity only.
// ============================================================
import * as THREE from 'three';
import { h, q, setText, setOp, setTF, tog, clamp01 } from './dom.js';
import { RETICLE_SVG, HITMARK_SVG, LOCKBOX_SVG, arcMask } from './icons.js';

const MAX_NUM = 24;
const MAX_ARC = 5;
const MAX_BOX = 8;
const MAX_SEC = 4;            // secondary lock brackets drawn at once

const ARC_LIFE = 0.78;        // gone well inside a second
const ARC_PEAK = 0.80;        // hot at the border, nothing in the middle third
const ARC_MERGE = 0.36;       // rad — a bearing this close refreshes the live arc

const RAD2DEG = 57.29577951308232;
const TAU = Math.PI * 2;

const _v = new THREE.Vector3();
const _d = new THREE.Vector3();
const _q = new THREE.Quaternion();

export class Overlays {
  constructor(ctx) {
    this.ctx = ctx;
    this.w = 1; this.h = 1;
    this.nums = []; this.numHead = 0;
    this.arcs = []; this.arcHead = 0;
    this.boxes = [];
    this._hit = 0; this._hitKill = false;
    this._spread = 0;
    this._mvi = new THREE.Matrix4();
    this._proj = new THREE.Matrix4();
    this._px = 0; this._py = 0;
    // pooled nearest-N scratch for the secondary lock brackets
    this._sec = [];
    for (let i = 0; i < MAX_SEC; i++) this._sec.push({ e: null, d: 0 });
    this._dm = -1; this._dmS = '';   // memoised "###M" readout string
  }

  build() {
    const el = h(
      '<div id="overlay-layer">' +
        '<div id="lock-layer"></div>' +
        '<div id="arc-layer"></div>' +
        '<div id="dmg-layer"></div>' +
        '<div id="reticle">' + RETICLE_SVG + '<div id="hitmark">' + HITMARK_SVG + '</div></div>' +
      '</div>',
    );
    el.style.cssText = 'position:absolute;inset:0';

    this.el = el;
    this.ret = q(el, '#reticle');
    this.retSpread = q(el, '#ret-spread');
    this.hitEl = q(el, '#hitmark');
    this.lockLayer = q(el, '#lock-layer');
    this.arcLayer = q(el, '#arc-layer');
    this.numLayer = q(el, '#dmg-layer');

    for (let i = 0; i < MAX_NUM; i++) {
      const n = h('<div class="dmgnum"></div>');
      this.numLayer.appendChild(n);
      this.nums.push({ el: n, t: 1e9, life: 1, x: 0, y: 0, rise: 0 });
    }
    for (let i = 0; i < MAX_ARC; i++) {
      const a = h('<div class="dmgarc hidden"></div>');
      this.arcLayer.appendChild(a);
      this.arcs.push({ el: a, t: 1e9, life: 1, ang: 0 });
    }
    for (let i = 0; i < MAX_BOX; i++) {
      const b = h('<div class="lockbox">' + LOCKBOX_SVG + '<b>LOCK</b><i></i></div>');
      this.lockLayer.appendChild(b);
      this.boxes.push({ el: b, tag: b.querySelector('b'), sub: b.querySelector('i'), on: false });
    }
    return el;
  }

  show(on) { if (this.el) this.el.classList.toggle('hidden', !on); }

  reset() {
    for (let i = 0; i < this.nums.length; i++) { this.nums[i].t = 1e9; setOp(this.nums[i].el, 0); }
    for (let i = 0; i < this.arcs.length; i++) {
      this.arcs[i].t = 1e9; setOp(this.arcs[i].el, 0); tog(this.arcs[i].el, 'hidden', true);
    }
    for (let i = 0; i < this.boxes.length; i++) { this.boxes[i].on = false; setOp(this.boxes[i].el, 0); }
    this._hit = 0;
  }

  resize(w, hgt) { this.w = w; this.h = hgt; }

  // ------------------------------------------------------------------
  //  world -> screen. Returns false if behind the camera.
  //  out = {x, y, s}  (s = perspective scale, 1 at ~40 m)
  // ------------------------------------------------------------------
  project(world) {
    const cam = this.ctx.camera;
    if (!cam || !world) return false;
    _v.copy(world).applyMatrix4(this._mvi);
    const depth = -_v.z;
    if (depth < 0.25) return false;
    _v.applyMatrix4(this._proj);           // applyMatrix4 divides by w -> NDC
    this._px = (_v.x * 0.5 + 0.5) * this.w;
    this._py = (-_v.y * 0.5 + 0.5) * this.h;
    this._pd = depth;
    return true;
  }

  // ------------------------------------------------------------------
  //  spawn API (called by HUD from bus events)
  // ------------------------------------------------------------------
  damageNumber(worldPos, amount, direct, big) {
    if (!worldPos) return;
    if (!this.project(worldPos)) return;
    const n = this.nums[this.numHead++ % MAX_NUM];
    n.t = 0;
    n.life = 0.95 + (direct ? 0.25 : 0);
    n.x = this._px + (Math.random() * 26 - 13);
    n.y = this._py + (Math.random() * 14 - 7);
    n.rise = 34 + Math.random() * 16;
    setText(n.el, String(Math.max(0, Math.round(amount))));
    tog(n.el, 'direct', !!direct && !big);
    tog(n.el, 'crit', !!big);
  }

  /** Red bearing arc pointing at a world position (or a raw camera-space angle). */
  damageFrom(worldPos) {
    const cam = this.ctx.camera;
    const p = this.ctx.player;
    if (!cam) return;
    const from = p && p.pos ? p.pos : cam.position;
    if (!worldPos) return;
    _d.copy(worldPos).sub(from);
    if (_d.lengthSq() < 1e-6) return;
    _q.copy(cam.quaternion).invert();
    _d.applyQuaternion(_q);
    this.damageAngle(Math.atan2(_d.x, -_d.z));
  }

  /** 0 = dead ahead, +right, radians. */
  damageAngle(ang) {
    // Fold a repeat bearing into the arc already burning there. Six hits from
    // one firing line must read as one hot edge, never as a stack of crescents.
    for (let i = 0; i < MAX_ARC; i++) {
      const a = this.arcs[i];
      if (a.t > a.life) continue;
      let dd = ang - a.ang;
      while (dd > Math.PI) dd -= TAU;
      while (dd < -Math.PI) dd += TAU;
      if (dd < ARC_MERGE && dd > -ARC_MERGE) { if (a.t > 0.08) a.t = 0.08; return; }
    }
    const a = this.arcs[this.arcHead++ % MAX_ARC];
    a.t = 0; a.life = ARC_LIFE; a.ang = ang;
    const deg = ang * RAD2DEG;
    const el = a.el;
    // the wedge is the only thing that moves — the edge falloff lives in CSS
    if (el.__ad !== deg) {
      el.__ad = deg;
      const m = arcMask(deg);
      el.style.webkitMaskImage = m;
      el.style.maskImage = m;
    }
    tog(el, 'hidden', false);
  }

  hitMarker(kill) {
    this._hit = kill ? 0.42 : 0.22;
    this._hitKill = !!kill;
    tog(this.hitEl, 'kill', !!kill);
  }

  // ------------------------------------------------------------------
  update(dt, target, locks) {
    const cam = this.ctx.camera;
    if (cam) {
      cam.updateMatrixWorld();
      this._mvi.copy(cam.matrixWorld).invert();
      this._proj.copy(cam.projectionMatrix);
    }
    this._reticle(dt, target);
    this._locks(target, locks);
    this._numbers(dt);
    this._arcsTick(dt);
  }

  // ---- reticle -------------------------------------------------------
  _reticle(dt, target) {
    const W = this.ctx.weapons && this.ctx.weapons.state;
    const r = W && W.rifle;
    let want = 0;
    if (r && typeof r.cooldown === 'number' && r.cooldown > 0) want = 1;
    const p = this.ctx.player;
    if (p && p.abActive) want = Math.max(want, 0.8);
    this._spread += (want - this._spread) * Math.min(1, dt * 9);
    const s = 1 + this._spread * 0.45;
    setTF(this.retSpread, 'scale(' + s.toFixed(3) + ')');

    // amber = HARD lock only; a soft target keeps the reticle cyan
    tog(this.ret, 'locked', !!(p && p.hardLock && p.lockTarget));

    if (this._hit > 0) {
      this._hit -= dt;
      const k = clamp01(this._hit / (this._hitKill ? 0.42 : 0.22));
      setOp(this.hitEl, k);
      setTF(this.hitEl, 'scale(' + (1.5 - k * 0.5).toFixed(3) + ')');
    } else setOp(this.hitEl, 0);
  }

  // ---- lock frames ---------------------------------------------------
  //  Exactly ONE labelled bracket — the primary target. Everything else is
  //  a bare bracket, culled to the nearest few that are actually on screen
  //  and faded out with range, so a busy sky never becomes a wall of text.
  _locks(target, locks) {
    let used = 0;
    const p = this.ctx.player;
    const hard = !!(p && p.hardLock && p.lockTarget && p.lockTarget === target);

    // stacked boxes = one per missile lock held on the primary target
    const W = this.ctx.weapons && this.ctx.weapons.state;
    const ml = (W && W.missile && W.missile.locks && W.missile.locks.length) ? W.missile.locks : null;

    // primary target box
    if (target && target.pos) used += this._box(used, target, hard, true, ml);
    // secondary brackets — nearest first, bracket only, no label
    const n = this._gatherSecondary(target, locks);
    for (let i = 0; i < n && used < MAX_BOX; i++) {
      used += this._box(used, this._sec[i].e, false, false, null);
    }
    for (let i = used; i < MAX_BOX; i++) {
      const b = this.boxes[i];
      if (b.on) { b.on = false; setOp(b.el, 0); }
    }
  }

  /** Nearest MAX_SEC lock candidates, ascending by range. Pooled, no alloc. */
  _gatherSecondary(target, locks) {
    const cam = this.ctx.camera;
    if (!locks || !locks.length || !cam) return 0;
    const cx = cam.position.x, cy = cam.position.y, cz = cam.position.z;
    let n = 0;
    for (let i = 0; i < locks.length; i++) {
      const e = locks[i];
      if (!e || !e.pos || e === target || e.alive === false) continue;
      const dx = e.pos.x - cx, dy = e.pos.y - cy, dz = e.pos.z - cz;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      let j;
      if (n < MAX_SEC) j = n++;
      else if (d < this._sec[MAX_SEC - 1].d) j = MAX_SEC - 1;
      else continue;
      for (; j > 0 && this._sec[j - 1].d > d; j--) {
        this._sec[j].e = this._sec[j - 1].e;
        this._sec[j].d = this._sec[j - 1].d;
      }
      this._sec[j].e = e; this._sec[j].d = d;
    }
    return n;
  }

  _box(idx, e, hard, primary, locks) {
    const b0 = this.boxes[idx];
    const y = (e.hudY != null) ? e.hudY : (e.kind === 'boss' ? 9 : e.kind === 'drone' ? 2 : 5);
    _v.set(e.pos.x, e.pos.y + y, e.pos.z);
    if (!this.project(_v)) {
      if (b0 && b0.on) { b0.on = false; setOp(b0.el, 0); }
      return 0;
    }
    const x = this._px, sy = this._py, d = this._pd;
    // an unlabelled bracket off the side of the frame is pure noise — drop it
    // and let the slot go to a target the pilot can actually see.
    if (!primary && (x < -24 || x > this.w + 24 || sy < -24 || sy > this.h + 24)) {
      if (b0 && b0.on) { b0.on = false; setOp(b0.el, 0); }
      return 0;
    }
    // multi-lock: stack N nested boxes on the same target
    let n = 1;
    if (primary && locks && locks.length) {
      n = 0;
      for (let i = 0; i < locks.length; i++) {
        const L = locks[i];
        if (L === e || (L && L.target === e)) n++;
      }
      if (n < 1) n = 1;
      if (n > 3) n = 3;
    }
    const base = Math.max(30, Math.min(230, 2600 / Math.max(6, d)));
    // distance fade: near contacts read, far ones sink into the frame
    const fade = primary ? 1 : (0.54 - clamp01((d - 70) / 400) * 0.38);
    let used = 0;
    for (let k = 0; k < n && idx + used < MAX_BOX; k++) {
      const b = this.boxes[idx + used];
      const sz = base * (1 + k * 0.16);
      b.el.style.width = sz.toFixed(1) + 'px';
      b.el.style.height = sz.toFixed(1) + 'px';
      setTF(b.el, 'translate(' + (x - sz * 0.5).toFixed(1) + 'px,' + (sy - sz * 0.5).toFixed(1) + 'px)');
      setOp(b.el, k === 0 ? fade : fade * 0.40);
      tog(b.el, 'hard', hard);
      tog(b.el, 'soft', !hard);
      tog(b.el, 'sec', !primary);
      const lead = primary && k === 0;
      setText(b.tag, lead ? (hard ? 'LOCK' : 'TARGET') : '');
      setText(b.sub, lead ? this._distStr(d) : '');
      // keep the label clear of the target readout when the bracket rides high
      tog(b.el, 'lo', lead && (sy - sz * 0.5) < this.h * 0.17);
      b.on = true;
      used++;
    }
    return used;
  }

  /** "###M", memoised — the readout is rewritten every frame otherwise. */
  _distStr(d) {
    const m = Math.round(d);
    if (m !== this._dm) { this._dm = m; this._dmS = m + 'M'; }
    return this._dmS;
  }

  // ---- damage numbers --------------------------------------------------
  _numbers(dt) {
    for (let i = 0; i < this.nums.length; i++) {
      const n = this.nums[i];
      if (n.t > n.life) { if (n.el.__o !== '0.000') setOp(n.el, 0); continue; }
      n.t += dt;
      const k = clamp01(n.t / n.life);
      const ease = 1 - (1 - k) * (1 - k);
      setTF(n.el, 'translate(' + n.x.toFixed(1) + 'px,' + (n.y - n.rise * ease).toFixed(1) + 'px)');
      setOp(n.el, k < 0.12 ? k / 0.12 : 1 - (k - 0.12) / 0.88);
    }
  }

  // ---- directional damage arcs ------------------------------------------
  //  A soft wedge of edge glow, brightest at the incoming bearing and gone
  //  inside 0.8 s. Opacity is the only thing animated — rotating the element
  //  would tilt the screen-hugging falloff with it.
  _arcsTick(dt) {
    for (let i = 0; i < this.arcs.length; i++) {
      const a = this.arcs[i];
      if (a.t > a.life) {
        if (a.el.__o !== '0.000') { setOp(a.el, 0); tog(a.el, 'hidden', true); }
        continue;
      }
      a.t += dt;
      const k = clamp01(a.t / a.life);
      let env;
      if (k < 0.07) env = k / 0.07;                       // 55 ms snap in
      else { const f = 1 - (k - 0.07) / 0.93; env = f * f; }
      setOp(a.el, env * ARC_PEAK);
    }
  }
}

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
const MAX_ARC = 3;            // three wedges max — more reads as a red frame
const MAX_BOX = 8;
const MAX_SEC = 3;            // secondary lock brackets drawn at once

const ARC_LIFE = 0.78;        // gone well inside a second
const ARC_PEAK = 0.62;        // low: a tint on the border, never a red shape
const ARC_CROWD = 0.55;       // each already-burning arc dims the next one
const ARC_MERGE = 0.52;       // rad (~30 deg) — this close just refreshes the live arc

const RAD2DEG = 57.29577951308232;
const TAU = Math.PI * 2;

/** Lock bracket edge length in px at camera depth `d`. */
function boxSize(d) {
  const s = 2600 / (d > 6 ? d : 6);
  return s < 30 ? 30 : s > 230 ? 230 : s;
}

/** HUD anchor height above an entity's origin. */
function anchorY(e) {
  return (e.hudY != null) ? e.hudY : (e.kind === 'boss' ? 9 : e.kind === 'drone' ? 2 : 5);
}

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
    this._px = 0; this._py = 0; this._pd = 0;
    // pooled nearest-N scratch for the secondary lock brackets
    this._sec = [];
    for (let i = 0; i < MAX_SEC; i++) this._sec.push({ e: null, d: 0, x: 0, y: 0, r: 0 });
    // primary bracket footprint in screen space — secondaries keep off it
    this._pmx = 1e9; this._pmy = 1e9; this._pmr = 0;
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
      this.arcs.push({ el: a, t: 1e9, life: 1, ang: 0, peak: ARC_PEAK });
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
    // A fresh bearing opened while others still burn comes in dimmer: taking
    // fire from every quarter must not close the border into a red frame.
    let live = 0;
    for (let i = 0; i < MAX_ARC; i++) {
      const b = this.arcs[i];
      if (b !== a && b.t <= b.life) live++;
    }
    a.t = 0; a.life = ARC_LIFE; a.ang = ang;
    a.peak = ARC_PEAK / (1 + live * ARC_CROWD);
    // 3-degree buckets: the wedge is 70 wide, so finer steps only churn masks
    const deg = Math.round(ang * RAD2DEG / 3) * 3;
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

    // primary target box — the only one that carries text
    this._pmx = 1e9; this._pmy = 1e9; this._pmr = 0;
    if (target && target.pos) {
      const u = this._box(used, target, hard, true, ml);
      if (u > 0) {
        // _box leaves its own projection in _px/_py/_pd; the label sits ~1rem
        // outside the frame, so reserve for it too.
        this._pmx = this._px; this._pmy = this._py;
        this._pmr = boxSize(this._pd) * 0.5 + 18;
      }
      used += u;
    }
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

  /**
   * Nearest MAX_SEC lock candidates that are actually *in frame*, ascending
   * by camera depth, with any bracket that would stack on the primary or on
   * a nearer sibling discarded. Pooled, no alloc.
   */
  _gatherSecondary(target, locks) {
    const cam = this.ctx.camera;
    if (!locks || !locks.length || !cam) return 0;
    const mx = this.w * 0.05, my = this.h * 0.05;   // brackets stay off the frame edge
    let n = 0;
    for (let i = 0; i < locks.length; i++) {
      const e = locks[i];
      if (!e || !e.pos || e === target || e.alive === false) continue;
      _v.set(e.pos.x, e.pos.y + anchorY(e), e.pos.z);
      if (!this.project(_v)) continue;                              // behind camera
      const x = this._px, y = this._py, d = this._pd;
      if (x < mx || x > this.w - mx || y < my || y > this.h - my) continue;
      const r = boxSize(d) * 0.5;
      // never stack on the primary bracket or the text hanging off it
      if (Math.abs(x - this._pmx) < r + this._pmr && Math.abs(y - this._pmy) < r + this._pmr) continue;
      let j;
      if (n < MAX_SEC) j = n++;
      else if (d < this._sec[MAX_SEC - 1].d) j = MAX_SEC - 1;
      else continue;
      for (; j > 0 && this._sec[j - 1].d > d; j--) {
        const a = this._sec[j], b = this._sec[j - 1];
        a.e = b.e; a.d = b.d; a.x = b.x; a.y = b.y; a.r = b.r;
      }
      const s = this._sec[j];
      s.e = e; s.d = d; s.x = x; s.y = y; s.r = r;
    }
    // compact in place, dropping anything that overlaps an already-kept (nearer)
    // bracket — two frames sharing screen space read as one broken frame.
    let m = 0;
    for (let i = 0; i < n; i++) {
      const s = this._sec[i];
      let ok = true;
      for (let k = 0; k < m; k++) {
        const t = this._sec[k];
        const sep = s.r + t.r;
        if (Math.abs(s.x - t.x) < sep && Math.abs(s.y - t.y) < sep) { ok = false; break; }
      }
      if (!ok) continue;
      if (m !== i) {
        const a = this._sec[m];
        a.e = s.e; a.d = s.d; a.x = s.x; a.y = s.y; a.r = s.r;
      }
      m++;
    }
    return m;
  }

  _box(idx, e, hard, primary, locks) {
    const b0 = this.boxes[idx];
    _v.set(e.pos.x, e.pos.y + anchorY(e), e.pos.z);
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
    const base = boxSize(d);
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
      setOp(a.el, env * a.peak);
    }
  }
}

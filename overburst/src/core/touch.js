// ============================================================
//  Touch controls — a full control surface for phones and tablets.
//
//  An AC needs both hands doing different things at once, so this is
//  not a keyboard emulator: the left thumb flies the mech on an
//  analogue stick, the right thumb aims by dragging anywhere on the
//  open right half, and the weapons sit under the right thumb as a
//  fixed cluster it can reach without looking.
//
//  Feeds the same Input instance the desktop path writes to, so no
//  gameplay system knows or cares which one is driving.
// ============================================================
import { ACTIONS } from './input.js';

const STICK_R = 62;        // px — outer ring radius
const STICK_DEAD = 0.16;   // fraction of the ring that reads as centred
const LOOK_SCALE = 0.42;   // drag px -> look px. Measured: at 1.35 a 108 px
                           // thumb drag swung the heading 100 degrees.
const TAP_MS = 220;        // press shorter than this is a tap (quick boost)
const TAP_SLOP = 14;       // px a tap may drift

/**
 * Pointer capture keeps a drag alive when the thumb leaves the element, but
 * it throws on a pointer the browser does not consider active. It is an
 * optimisation — never let it abort the handler that actually reads input.
 */
function capture(el, id) {
  try { el.setPointerCapture(id); } catch { /* drag still works, just uncaptured */ }
}

export class TouchControls {
  constructor(ctx) {
    this.ctx = ctx;
    this.input = ctx.input;
    this.enabled = false;
    this.root = null;
    this._stickId = null;
    this._lookId = null;
    this._lookX = 0;
    this._lookY = 0;
    this._sx = 0; this._sy = 0;
    this._held = new Map();   // pointerId -> action (weapon buttons)
    this._qbDown = Infinity;
    this._qbMoved = false;
  }

  /** Only mount on a device that actually has a touchscreen. */
  static shouldMount() {
    if (typeof window === 'undefined') return false;
    if (window.__OB_FORCE_TOUCH) return true;
    const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    return coarse && (navigator.maxTouchPoints || 0) > 0;
  }

  mount() {
    if (this.enabled) return;
    this.enabled = true;

    const root = document.createElement('div');
    root.id = 'touch';
    root.innerHTML = `
      <div id="tc-stick"><i></i><b></b></div>
      <div id="tc-look"></div>
      <div id="tc-pad">
        <button class="tc-b tc-fire" data-a="rifle">FIRE</button>
        <button class="tc-b" data-a="missile">MSL</button>
        <button class="tc-b" data-a="cannon">CNN</button>
        <button class="tc-b" data-a="blade">BLD</button>
      </div>
      <div id="tc-left">
        <button class="tc-b tc-tall" data-a="ascend">RISE</button>
        <button class="tc-b" data-a="descend">DROP</button>
      </div>
      <div id="tc-top">
        <button class="tc-b tc-sm" data-a="lock">LOCK</button>
        <button class="tc-b tc-sm" data-a="repair">KIT</button>
      </div>
      <div id="tc-hint">LEFT STICK MOVE &nbsp;·&nbsp; TAP STICK = QUICK BOOST &nbsp;·&nbsp; HOLD = ASSAULT BOOST &nbsp;·&nbsp; DRAG RIGHT TO AIM</div>`;
    document.body.appendChild(root);
    this.root = root;

    this.stick = root.querySelector('#tc-stick');
    this.knob = root.querySelector('#tc-stick b');
    this.look = root.querySelector('#tc-look');

    // ---- movement stick ------------------------------------------
    this.stick.addEventListener('pointerdown', (e) => {
      if (this._stickId !== null) return;
      this._stickId = e.pointerId;
      capture(this.stick, e.pointerId);
      const r = this.stick.getBoundingClientRect();
      this._sx = r.left + r.width / 2;
      this._sy = r.top + r.height / 2;
      this._qbDown = performance.now();
      this._qbMoved = false;
      this._moveStick(e.clientX, e.clientY);
      e.preventDefault();
    });
    this.stick.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this._stickId) return;
      this._moveStick(e.clientX, e.clientY);
      e.preventDefault();
    });
    const endStick = (e) => {
      if (e.pointerId !== this._stickId) return;
      const dt = performance.now() - this._qbDown;
      // A quick flick of the stick is a quick boost in that direction:
      // the impulse the whole game is built around, on one thumb.
      if (dt < TAP_MS && this._qbMoved) this._pulse(ACTIONS.QB, 90);
      this._stickId = null;
      this._release(ACTIONS.FORWARD); this._release(ACTIONS.BACK);
      this._release(ACTIONS.LEFT); this._release(ACTIONS.RIGHT);
      this._release(ACTIONS.QB);
      this.knob.style.transform = 'translate(-50%,-50%)';
      e.preventDefault();
    };
    this.stick.addEventListener('pointerup', endStick);
    this.stick.addEventListener('pointercancel', endStick);

    // ---- look surface --------------------------------------------
    this.look.addEventListener('pointerdown', (e) => {
      if (this._lookId !== null) return;
      this._lookId = e.pointerId;
      capture(this.look, e.pointerId);
      this._lookX = e.clientX; this._lookY = e.clientY;
      e.preventDefault();
    });
    this.look.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this._lookId) return;
      this.input.scriptedTouchLook(
        (e.clientX - this._lookX) * LOOK_SCALE,
        (e.clientY - this._lookY) * LOOK_SCALE,
      );
      this._lookX = e.clientX; this._lookY = e.clientY;
      e.preventDefault();
    });
    const endLook = (e) => {
      if (e.pointerId !== this._lookId) return;
      this._lookId = null;
      e.preventDefault();
    };
    this.look.addEventListener('pointerup', endLook);
    this.look.addEventListener('pointercancel', endLook);

    // ---- buttons --------------------------------------------------
    for (const b of root.querySelectorAll('.tc-b')) {
      const a = b.dataset.a;
      b.addEventListener('pointerdown', (e) => {
        capture(b, e.pointerId);
        this._held.set(e.pointerId, a);
        b.classList.add('on');
        this._press(a);
        e.preventDefault();
      });
      const up = (e) => {
        if (!this._held.has(e.pointerId)) return;
        this._held.delete(e.pointerId);
        b.classList.remove('on');
        this._release(a);
        e.preventDefault();
      };
      b.addEventListener('pointerup', up);
      b.addEventListener('pointercancel', up);
    }

    // Kill the browser's own gestures so a drag never scrolls or zooms.
    root.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
    root.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });

    const hint = root.querySelector('#tc-hint');
    setTimeout(() => hint.classList.add('gone'), 9000);
  }

  show(on) { if (this.root) this.root.classList.toggle('on', !!on); }

  // ------------------------------------------------------------------
  _moveStick(x, y) {
    let dx = (x - this._sx) / STICK_R;
    let dy = (y - this._sy) / STICK_R;
    const m = Math.hypot(dx, dy);
    if (m > 1) { dx /= m; dy /= m; }
    if (m > STICK_DEAD) this._qbMoved = true;

    this.knob.style.transform =
      `translate(calc(-50% + ${dx * STICK_R}px), calc(-50% + ${dy * STICK_R}px))`;

    const d = STICK_DEAD;
    this._set(ACTIONS.RIGHT, dx > d);
    this._set(ACTIONS.LEFT, dx < -d);
    this._set(ACTIONS.FORWARD, dy < -d);
    this._set(ACTIONS.BACK, dy > d);
    // Pushed to the rim and held: that is the assault-boost gesture.
    this._set(ACTIONS.QB, m > 0.93 && performance.now() - this._qbDown > TAP_MS);
  }

  _set(a, on) { if (on) this._press(a); else this._release(a); }
  _press(a) { this.input.touchSet(a, true); }
  _release(a) { this.input.touchSet(a, false); }
  _pulse(a, ms) {
    this._press(a);
    setTimeout(() => this._release(a), ms);
  }
}

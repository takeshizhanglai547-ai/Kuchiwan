// Input: keyboard + mouse (pointer lock) + gamepad + touch, unified into actions.
//
// The important part of this file is the INPUT BUFFER. A soulslike lives or dies
// on whether a press made during the recovery frames of the previous action is
// remembered and fired the instant the character can act. Without it, committed
// animations feel like the game is ignoring you; with it, they feel weighty.

// How long a press stays "pending", in GAME seconds.
//
// Deliberately measured on the simulation clock rather than the wall clock: the
// buffer's job is "remember this press for the next few simulation steps", and
// tying it to real time makes it expire before it is ever polled whenever the
// frame rate collapses (or the tab is throttled).
// 0.22s: long enough that a combo input pressed during the middle of a swing is
// still live when the cancel window opens, short enough that it does not queue a
// swing the player has already changed their mind about.
const BUFFER = 0.22;

export const ACTIONS = [
  'light', 'heavy', 'roll', 'guard', 'sprint', 'lockon', 'heal',
  'interact', 'cycleL', 'cycleR', 'pause',
];

class Input {
  constructor() {
    this.move = { x: 0, y: 0 };       // -1..1, y+ = forward
    this.look = { x: 0, y: 0 };       // consumed-per-frame mouse/stick delta
    this.held = Object.create(null);
    this.pressedAt = Object.create(null);
    this.releasedAt = Object.create(null);
    this.consumedAt = Object.create(null);
    this.enabled = true;
    this.pointerLocked = false;
    /**
     * Real play gates mouse combat behind pointer lock, so a click that is only
     * re-capturing the cursor never also swings the sword. The automated capture
     * harness cannot obtain a pointer lock in headless Chromium, so it clears
     * this flag to drive the same code path.
     */
    this.requirePointerLock = true;
    this.sensitivity = 0.0022;
    this.gamepadIndex = null;
    this.touch = null;
    /** Simulation clock, advanced by update(dt). All buffering is measured on it. */
    this.now = 0;
    this.anyInputSinceBoot = false;
    this._t = 0;
    this._keymap = {
      KeyW: 'up', KeyS: 'down', KeyA: 'left', KeyD: 'right',
      ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
      Space: 'roll', ShiftLeft: 'sprint', ShiftRight: 'sprint',
      KeyJ: 'light', KeyK: 'heavy', KeyL: 'guard',
      KeyQ: 'lockon', KeyR: 'heal', KeyF: 'heal', KeyE: 'interact',
      Tab: 'cycleR', Escape: 'pause', KeyP: 'pause',
    };
  }

  init(canvas) {
    this.canvas = canvas;
    const dirs = { up: 0, down: 0, left: 0, right: 0 };
    this._dirs = dirs;

    addEventListener('keydown', (e) => {
      const a = this._keymap[e.code];
      if (!a) return;
      if (e.code === 'Tab' || e.code === 'Space') e.preventDefault();
      if (e.repeat) return;
      this.anyInputSinceBoot = true;
      if (a in dirs) dirs[a] = 1; else this._press(a);
    });
    addEventListener('keyup', (e) => {
      const a = this._keymap[e.code];
      if (!a) return;
      if (a in dirs) dirs[a] = 0; else this._release(a);
    });

    // Mouse: LMB light, RMB guard, MMB cycle target.
    canvas.addEventListener('mousedown', (e) => {
      if (this.requirePointerLock && !this.pointerLocked) return;
      this.anyInputSinceBoot = true;
      if (e.button === 0) this._press(e.shiftKey ? 'heavy' : 'light');
      else if (e.button === 2) this._press('guard');
      else if (e.button === 1) this._press('cycleR');
    });
    addEventListener('mouseup', (e) => {
      if (e.button === 0) { this._release('light'); this._release('heavy'); }
      else if (e.button === 2) this._release('guard');
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('wheel', (e) => { if (this.pointerLocked) e.preventDefault(); }, { passive: false });

    addEventListener('mousemove', (e) => {
      if (this.requirePointerLock && !this.pointerLocked) return;
      this.look.x += e.movementX * this.sensitivity;
      this.look.y += e.movementY * this.sensitivity;
    });

    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === canvas;
      if (!this.pointerLocked) this.onFocusLost?.();
    });

    // Losing focus mid-combo must not leave a key stuck down.
    addEventListener('blur', () => this.releaseAll());

    this._initTouch();
  }

  requestPointerLock() {
    this.canvas?.requestPointerLock?.();
  }

  releaseAll() {
    for (const k in this.held) this.held[k] = false;
    for (const k in this._dirs) this._dirs[k] = 0;
  }

  _press(a) {
    this.held[a] = true;
    // Stamped with the current simulation time. An event arriving between steps
    // is stamped with the last step's time, so it is always still inside the
    // buffer window when the next step polls it.
    this.pressedAt[a] = this.now;
  }
  _release(a) {
    this.held[a] = false;
    this.releasedAt[a] = this.now;
  }

  // --- query API used by gameplay code ---------------------------------------

  isHeld(a) { return !!this.held[a]; }

  /** True if `a` was pressed within the buffer window and not yet consumed. */
  buffered(a) {
    const t = this.pressedAt[a];
    if (t === undefined) return false;
    if (this.consumedAt[a] === t) return false;
    return this.now - t <= BUFFER;
  }

  /** Consume a buffered press (so it fires exactly once). */
  consume(a) {
    const t = this.pressedAt[a];
    if (t === undefined) return false;
    if (this.consumedAt[a] === t) return false;
    if (this.now - t > BUFFER) return false;
    this.consumedAt[a] = t;
    return true;
  }

  /** How long `a` has been held, in seconds (0 if not held). Used for charged heavies. */
  heldFor(a) {
    if (!this.held[a]) return 0;
    return this.now - (this.pressedAt[a] ?? this.now);
  }

  /** Seconds since `a` was released (Infinity if never). Used for tap-vs-hold. */
  sinceRelease(a) {
    const t = this.releasedAt[a];
    return t === undefined ? Infinity : this.now - t;
  }

  sincePress(a) {
    const t = this.pressedAt[a];
    return t === undefined ? Infinity : this.now - t;
  }

  clearBuffer() {
    for (const a of ACTIONS) this.consumedAt[a] = this.pressedAt[a];
  }

  // --- per-frame -------------------------------------------------------------

  update(dt = 1 / 60) {
    this.now += dt;
    const d = this._dirs;
    let mx = (d.right - d.left), my = (d.up - d.down);

    this._pollGamepad();
    if (this._padMove) { mx += this._padMove.x; my += this._padMove.y; }
    if (this.touch?.active) { mx += this.touch.x; my += this.touch.y; }

    const len = Math.hypot(mx, my);
    if (len > 1) { mx /= len; my /= len; }
    this.move.x = mx; this.move.y = my;
    if (len > 0.05) this.anyInputSinceBoot = true;
  }

  /** Camera look delta for this frame; reading it clears it. */
  takeLook(out) {
    out.x = this.look.x; out.y = this.look.y;
    this.look.x = 0; this.look.y = 0;
    if (this._padLook) { out.x += this._padLook.x; out.y += this._padLook.y; }
    if (this.touch?.lookDx) {
      out.x += this.touch.lookDx; out.y += this.touch.lookDy;
      this.touch.lookDx = 0; this.touch.lookDy = 0;
    }
    return out;
  }

  _pollGamepad() {
    const pads = navigator.getGamepads?.();
    if (!pads) return;
    let pad = null;
    for (const p of pads) if (p && p.connected) { pad = p; break; }
    if (!pad) { this._padMove = null; this._padLook = null; return; }

    const dz = (v) => (Math.abs(v) < 0.18 ? 0 : (v - Math.sign(v) * 0.18) / 0.82);
    this._padMove = { x: dz(pad.axes[0] || 0), y: -dz(pad.axes[1] || 0) };
    this._padLook = { x: dz(pad.axes[2] || 0) * 0.05, y: dz(pad.axes[3] || 0) * 0.05 };

    // Xbox-ish layout: RB light, RT heavy, A roll, LB guard, X heal, Y lock-on
    const map = { 5: 'light', 7: 'heavy', 0: 'roll', 4: 'guard', 6: 'guard',
                  2: 'heal', 3: 'lockon', 1: 'interact', 9: 'pause' };
    this._padPrev = this._padPrev || {};
    for (const i in map) {
      const b = pad.buttons[i];
      if (!b) continue;
      const down = b.pressed || b.value > 0.5;
      if (down && !this._padPrev[i]) { this._press(map[i]); this.anyInputSinceBoot = true; }
      else if (!down && this._padPrev[i]) this._release(map[i]);
      this._padPrev[i] = down;
    }
    // sprint = hold A
    this.held.sprint = this.held.sprint || (pad.buttons[0]?.pressed ?? false);
  }

  // --- touch (mobile fallback) -----------------------------------------------

  _initTouch() {
    if (!('ontouchstart' in window)) return;
    const t = { active: false, x: 0, y: 0, id: -1, ox: 0, oy: 0, lookId: -1, lookDx: 0, lookDy: 0 };
    this.touch = t;

    const root = document.createElement('div');
    root.id = 'touch-controls';
    root.innerHTML = `
      <div class="tc-stick"><i></i></div>
      <div class="tc-btns">
        <button data-a="light">攻</button>
        <button data-a="heavy">強</button>
        <button data-a="roll">回避</button>
        <button data-a="guard">防</button>
        <button data-a="lockon">◎</button>
        <button data-a="heal">灯</button>
        <button data-a="interact">E</button>
      </div>`;
    const css = document.createElement('style');
    css.textContent = `
      #touch-controls{position:fixed;inset:0;pointer-events:none;z-index:50;font-family:system-ui,sans-serif}
      .tc-stick{position:absolute;left:5vmin;bottom:6vmin;width:32vmin;height:32vmin;border-radius:50%;
        border:1px solid rgba(201,189,166,.25);background:rgba(20,22,28,.35);pointer-events:auto}
      .tc-stick i{position:absolute;left:50%;top:50%;width:12vmin;height:12vmin;margin:-6vmin 0 0 -6vmin;
        border-radius:50%;background:rgba(201,189,166,.3)}
      .tc-btns{position:absolute;right:4vmin;bottom:5vmin;width:44vmin;display:flex;flex-wrap:wrap-reverse;
        gap:1.6vmin;justify-content:flex-end;pointer-events:auto}
      .tc-btns button{width:12.5vmin;height:12.5vmin;border-radius:50%;border:1px solid rgba(201,189,166,.3);
        background:rgba(30,28,34,.55);color:#c9bda6;font-size:3.4vmin;touch-action:none}
      .tc-btns button:active{background:rgba(255,106,30,.35)}`;
    document.head.appendChild(css);
    document.body.appendChild(root);

    const stick = root.querySelector('.tc-stick');
    const knob = stick.querySelector('i');
    const R = () => stick.getBoundingClientRect();

    stick.addEventListener('touchstart', (e) => {
      const to = e.changedTouches[0];
      t.id = to.identifier; t.active = true;
      const r = R(); t.ox = r.left + r.width / 2; t.oy = r.top + r.height / 2;
      e.preventDefault();
    }, { passive: false });

    addEventListener('touchmove', (e) => {
      for (const to of e.changedTouches) {
        if (to.identifier === t.id) {
          const r = R(), max = r.width / 2;
          let dx = to.clientX - t.ox, dy = to.clientY - t.oy;
          const l = Math.hypot(dx, dy);
          if (l > max) { dx = dx / l * max; dy = dy / l * max; }
          t.x = dx / max; t.y = -dy / max;
          knob.style.transform = `translate(${dx}px,${dy}px)`;
        } else if (to.identifier === t.lookId) {
          t.lookDx += (to.clientX - t.lx) * 0.006;
          t.lookDy += (to.clientY - t.ly) * 0.006;
          t.lx = to.clientX; t.ly = to.clientY;
        }
      }
    }, { passive: false });

    const end = (e) => {
      for (const to of e.changedTouches) {
        if (to.identifier === t.id) { t.active = false; t.x = t.y = 0; t.id = -1; knob.style.transform = ''; }
        if (to.identifier === t.lookId) t.lookId = -1;
      }
    };
    addEventListener('touchend', end); addEventListener('touchcancel', end);

    // Anywhere on the right half that isn't a button drags the camera.
    addEventListener('touchstart', (e) => {
      if (t.lookId >= 0) return;
      const to = e.changedTouches[0];
      if (to.identifier === t.id) return;
      if (to.clientX < innerWidth * 0.4) return;
      if (e.target.closest?.('.tc-btns')) return;
      t.lookId = to.identifier; t.lx = to.clientX; t.ly = to.clientY;
    }, { passive: true });

    for (const b of root.querySelectorAll('button')) {
      const a = b.dataset.a;
      b.addEventListener('touchstart', (e) => { this._press(a); this.anyInputSinceBoot = true; e.preventDefault(); }, { passive: false });
      b.addEventListener('touchend', (e) => { this._release(a); e.preventDefault(); }, { passive: false });
    }
    this.touchRoot = root;
  }
}

export const input = new Input();
export default input;

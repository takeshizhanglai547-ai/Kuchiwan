// src/core/input.js — keyboard / mouse / gamepad -> ACTIONS.
//
// Gameplay code never looks at keys. It reads actions, sampled once per FIXED step:
//   input.down('fire_r')       held this step
//   input.pressed('quick_boost')   rising edge this step (taps shorter than a step are latched)
//   input.released('jump')
//   input.moveAxis(out)        {x: right, y: forward} in [-1,1], keyboard + left stick
//   input.consumeLook(out)     accumulated mouse delta in pixels since last consume
//   input.lookRate(out)        [-1,1] rate from right stick / arrow keys (scale by dt yourself)
//
// Mouse look uses Pointer Lock. When Pointer Lock is unavailable (sandboxed iframe,
// denied, or unsupported) the input falls back to DRAG-LOOK: moving the mouse while any
// button is held turns the camera (arrow keys always work too). While playing without the
// lock (refused after Esc/Esc, lost on alt-tab, denied twice) every mouse button press on the
// game screen retries it, so one click re-captures the mouse; only an iframe that refused it
// or a browser without the API stops retrying. (The HUD-side hint lives in core/hints.js.)
//
// UI code (menus) listens to game.events 'input:action' {action, code, source}, which is
// emitted immediately on key/button down (not tied to fixed steps). While input is disabled
// (menus up), the gamepad also emits menu navigation: d-pad / left stick -> look_up/down/left/
// right, B -> pause (= back). resume() (engine, on every switch to 'playing') drops presses
// latched while the menus were up, so keys pressed in the pause menu never fire on resume.
//
// Test API: input.setOverride(action, bool) forces an action (used by window.__iw.press()).

export const ACTIONS = [
  'move_forward', 'move_back', 'move_left', 'move_right',
  'fire_r', 'fire_l', 'fire_lb', 'fire_rb',
  'quick_boost', 'jump', 'assault_boost', 'boost_toggle',
  'lock_switch', 'repair', 'pause', 'confirm',
  'look_left', 'look_right', 'look_up', 'look_down',
  'debug_overlay',
  'hard_lock',            // TARGET ASSIST toggle (movement designer: src/player/controller.js)
];

/** Keyboard `code` / mouse button -> action. */
export const DEFAULT_BINDINGS = {
  KeyW: 'move_forward', KeyS: 'move_back', KeyA: 'move_left', KeyD: 'move_right',
  Mouse0: 'fire_r', Mouse2: 'fire_l', Mouse1: 'lock_switch',
  KeyQ: 'fire_lb', KeyE: 'fire_rb',
  ShiftLeft: 'quick_boost', ShiftRight: 'quick_boost',
  Space: 'jump', KeyF: 'assault_boost', KeyC: 'boost_toggle',
  Tab: 'lock_switch', KeyR: 'repair',
  Escape: 'pause', KeyP: 'pause', Enter: 'confirm', NumpadEnter: 'confirm',
  ArrowLeft: 'look_left', ArrowRight: 'look_right', ArrowUp: 'look_up', ArrowDown: 'look_down',
  Backquote: 'debug_overlay',
  KeyV: 'hard_lock',
};

/** Gamepad "standard" mapping button index -> action. */
export const PAD_BINDINGS = {
  0: 'jump', 1: 'quick_boost', 2: 'repair', 3: 'lock_switch',
  4: 'fire_lb', 5: 'fire_rb', 6: 'fire_l', 7: 'fire_r',
  8: 'boost_toggle', 9: 'pause', 10: 'assault_boost', 11: 'hard_lock',
};

/** Gamepad buttons that only navigate menus (emitted while input is disabled). */
const PAD_MENU = { 12: 'look_up', 13: 'look_down', 14: 'look_left', 15: 'look_right', 1: 'pause' };
const STICK_NAV = ['look_up', 'look_down', 'look_left', 'look_right'];

const PAD_DEADZONE = 0.18;
const PREVENT_DEFAULT = new Set(['Tab', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Backquote']);

export class Input {
  constructor(events) {
    this.events = events;
    this.bindings = { ...DEFAULT_BINDINGS };
    this.padBindings = { ...PAD_BINDINGS };
    const n = ACTIONS.length;
    this.index = Object.create(null);
    ACTIONS.forEach((a, i) => { this.index[a] = i; });
    this.raw = new Uint8Array(n);      // physical state (keys/buttons/pad) right now
    this.latch = new Uint8Array(n);    // went down at least once since last step
    this.cur = new Uint8Array(n);      // sampled state for this step
    this.prev = new Uint8Array(n);     // sampled state of previous step
    this.override = new Int8Array(n).fill(-1); // -1 none, 0 forced up, 1 forced down
    this.keys = Object.create(null);   // code -> bool
    this.padButtons = new Uint8Array(32);
    this.padPrev = new Uint8Array(32);
    this.padAxes = [0, 0, 0, 0];
    this.lookAccum = { x: 0, y: 0 };
    this.enabled = true;               // false while menus are up
    this.wantPointerLock = false;      // set by the engine while playing
    this.pointerLocked = false;
    this.dragLook = false;             // fallback mode active
    this.mouseButtonsDown = 0;
    this.canvas = null;
    this._requestedLock = false;
    this._lockUnavailable = false;     // no API, or an iframe refused it: stop retrying
    this._padNav = 15;                 // left-stick menu navigation edge state (bit per direction; set = held)
    this._handlers = [];
  }

  /** Attach DOM listeners. Call once. */
  attach(canvas) {
    this.canvas = canvas;
    const on = (target, type, fn, opts) => {
      target.addEventListener(type, fn, opts);
      this._handlers.push([target, type, fn, opts]);
    };
    on(window, 'keydown', (e) => this._onKey(e, true));
    on(window, 'keyup', (e) => this._onKey(e, false));
    on(window, 'blur', () => this.releaseAll());
    on(canvas, 'mousedown', (e) => this._onMouseButton(e, true));
    on(window, 'mouseup', (e) => this._onMouseButton(e, false));
    on(window, 'mousemove', (e) => this._onMouseMove(e));
    on(canvas, 'contextmenu', (e) => e.preventDefault());
    on(canvas, 'wheel', (e) => e.preventDefault(), { passive: false });
    on(document, 'pointerlockchange', () => this._onLockChange());
    on(document, 'pointerlockerror', () => this._onLockError('pointerlockerror'));
  }

  detach() {
    for (const [t, type, fn, opts] of this._handlers) t.removeEventListener(type, fn, opts);
    this._handlers.length = 0;
  }

  // ---------------------------------------------------------------- DOM handlers
  _onKey(e, down) {
    const code = e.code;
    const action = this.bindings[code];
    if (action && PREVENT_DEFAULT.has(code)) e.preventDefault();
    if (down && e.repeat) return;
    this.keys[code] = down;
    if (!action) return;
    const i = this.index[action];
    if (down) {
      this.latch[i] = 1;
      this.events.emit('input:action', { action, code, source: 'keyboard' });
    }
  }

  _onMouseButton(e, down) {
    const code = 'Mouse' + e.button;
    if (down) {
      this.mouseButtonsDown |= (1 << e.button);
      // Retry the lock on every press on the game screen while playing (also in drag-look
      // mode: a refusal can be a temporary browser cooldown, e.g. right after Esc).
      if (this.wantPointerLock && !this.pointerLocked && !this._lockUnavailable) this.requestPointerLock();
    } else {
      this.mouseButtonsDown &= ~(1 << e.button);
    }
    this.keys[code] = down;
    const action = this.bindings[code];
    if (!action) return;
    if (e.button === 1) e.preventDefault(); // middle-click autoscroll
    if (down) {
      this.latch[this.index[action]] = 1;
      this.events.emit('input:action', { action, code, source: 'mouse' });
    }
  }

  _onMouseMove(e) {
    if (this.pointerLocked || (this.dragLook && this.mouseButtonsDown)) {
      // Clamp crazy spikes (some browsers report huge deltas on lock/unlock).
      const dx = Math.max(-300, Math.min(300, e.movementX || 0));
      const dy = Math.max(-300, Math.min(300, e.movementY || 0));
      this.lookAccum.x += dx;
      this.lookAccum.y += dy;
    }
  }

  requestPointerLock() {
    const c = this.canvas;
    if (!c || !c.requestPointerLock) { this._lockUnavailable = true; this._enableDragLook('unsupported'); return; }
    this._requestedLock = true;
    try {
      const p = c.requestPointerLock();
      if (p && typeof p.catch === 'function') p.catch(() => this._onLockError('rejected'));
    } catch (err) {
      this._onLockError('threw');
    }
  }

  _onLockError(reason) {
    // A single failure can be a browser cooldown (re-locking right after Esc); the next click
    // retries. Inside iframes (often sandboxed without allow-pointer-lock) or after repeated
    // failures, fall back to drag-look.
    this._requestedLock = false;
    this._lockFailures = (this._lockFailures || 0) + 1;
    let inIframe = false;
    try { inIframe = window.self !== window.top; } catch (e) { inIframe = true; }
    if (inIframe) this._lockUnavailable = true; // sandboxed iframes refuse every request
    if (inIframe || this._lockFailures >= 2) this._enableDragLook(reason);
  }

  exitPointerLock() {
    this._requestedLock = false;
    if (document.pointerLockElement && document.exitPointerLock) document.exitPointerLock();
  }

  _enableDragLook(reason) {
    if (this.dragLook) return;
    this.dragLook = true;
    console.warn(`[input] Pointer Lock unavailable (${reason}); using drag-look (hold a mouse button and move) + arrow keys.`);
    this.events.emit('input:draglook', { reason });
  }

  _onLockChange() {
    const locked = document.pointerLockElement === this.canvas;
    const was = this.pointerLocked;
    this.pointerLocked = locked;
    if (was && !locked) {
      // Lock lost (Esc pressed, alt-tab...). The engine pauses the game.
      this.releaseAll();
      this.events.emit('input:pointerlock-lost', {});
    }
    if (locked) { this.dragLook = false; this._lockFailures = 0; }
  }

  releaseAll() {
    for (const k in this.keys) this.keys[k] = false;
    this.mouseButtonsDown = 0;
    this.raw.fill(0);
  }

  // ---------------------------------------------------------------- polling
  /** Poll gamepads (call once per rendered frame). Emits 'input:action' on pad presses. */
  pollGamepad() {
    this.padPrev.set(this.padButtons);
    this.padButtons.fill(0);
    this.padAxes[0] = this.padAxes[1] = this.padAxes[2] = this.padAxes[3] = 0;
    const pads = (typeof navigator !== 'undefined' && navigator.getGamepads) ? navigator.getGamepads() : null;
    if (!pads) return;
    for (const pad of pads) {
      if (!pad || !pad.connected) continue;
      const nb = Math.min(pad.buttons.length, 32);
      for (let b = 0; b < nb; b++) if (pad.buttons[b].pressed || pad.buttons[b].value > 0.5) this.padButtons[b] = 1;
      for (let a = 0; a < 4 && a < pad.axes.length; a++) {
        const v = pad.axes[a];
        this.padAxes[a] = Math.abs(v) < PAD_DEADZONE ? 0 : (v - Math.sign(v) * PAD_DEADZONE) / (1 - PAD_DEADZONE);
      }
      break; // first connected pad only
    }
    for (let b = 0; b < 32; b++) {
      if (this.padButtons[b] && !this.padPrev[b]) {
        const action = this.padBindings[b];
        if (action) {
          this.latch[this.index[action]] = 1;
          this.events.emit('input:action', { action, code: 'Pad' + b, source: 'gamepad' });
        }
        // menus: d-pad moves the selection, B goes back (never latched for gameplay)
        if (!this.enabled) {
          const nav = PAD_MENU[b];
          if (nav) this.events.emit('input:action', { action: nav, code: 'Pad' + b, source: 'gamepad' });
        }
      }
    }
    // menus: left stick past 0.6 = one selection step (re-armed below 0.3)
    let nav = this._padNav;
    if (!this.enabled) {
      const ax = this.padAxes[0], ay = this.padAxes[1];
      for (let k = 0; k < 4; k++) {
        const v = k === 0 ? -ay : k === 1 ? ay : k === 2 ? -ax : ax; // up, down, left, right
        const bit = 1 << k;
        if (v > 0.6 && !(nav & bit)) { nav |= bit; this.events.emit('input:action', { action: STICK_NAV[k], code: 'PadStick', source: 'gamepad' }); }
        else if (v < 0.3) nav &= ~bit;
      }
    } else nav = 15; // while playing: re-arm only after the stick returns to centre (a stick held
    // forward when the pause menu opens must not move its selection)
    this._padNav = nav;
  }

  /** Physical state (keys, mouse buttons, pad buttons) -> this.raw. */
  _sampleRaw() {
    const raw = this.raw;
    raw.fill(0);
    for (const code in this.keys) {
      if (!this.keys[code]) continue;
      const a = this.bindings[code];
      if (a) raw[this.index[a]] = 1;
    }
    for (let b = 0; b < 32; b++) {
      if (!this.padButtons[b]) continue;
      const a = this.padBindings[b];
      if (a) raw[this.index[a]] = 1;
    }
    return raw;
  }

  /** Sample actions for this fixed step (engine calls before systems update). */
  beginStep() {
    const raw = this._sampleRaw();
    for (let i = 0; i < raw.length; i++) {
      let v = (this.enabled && (raw[i] || this.latch[i])) ? 1 : 0;
      if (this.override[i] >= 0) v = this.override[i];
      this.cur[i] = v;
    }
  }

  /** Engine calls after all systems updated this step. */
  endStep() {
    this.prev.set(this.cur);
    this.latch.fill(0);
  }

  // ---------------------------------------------------------------- queries
  down(action) { return this.cur[this.index[action]] === 1; }
  pressed(action) { const i = this.index[action]; return this.cur[i] === 1 && this.prev[i] === 0; }
  released(action) { const i = this.index[action]; return this.cur[i] === 0 && this.prev[i] === 1; }

  /** Movement intent {x: right, y: forward}, length <= 1. */
  moveAxis(out) {
    let x = (this.down('move_right') ? 1 : 0) - (this.down('move_left') ? 1 : 0);
    let y = (this.down('move_forward') ? 1 : 0) - (this.down('move_back') ? 1 : 0);
    if (this.enabled) { x += this.padAxes[0]; y -= this.padAxes[1]; }
    const len = Math.hypot(x, y);
    if (len > 1) { x /= len; y /= len; }
    out.x = x; out.y = y;
    return out;
  }

  /** Mouse delta (pixels) accumulated since the last call; resets the accumulator. */
  consumeLook(out) {
    out.x = this.enabled ? this.lookAccum.x : 0;
    out.y = this.enabled ? this.lookAccum.y : 0;
    this.lookAccum.x = 0; this.lookAccum.y = 0;
    return out;
  }

  /** Rate-based look in [-1,1] (right stick + arrow keys). x: right, y: up. */
  lookRate(out) {
    let x = (this.down('look_right') ? 1 : 0) - (this.down('look_left') ? 1 : 0);
    let y = (this.down('look_up') ? 1 : 0) - (this.down('look_down') ? 1 : 0);
    if (this.enabled) { x += this.padAxes[2]; y -= this.padAxes[3]; }
    out.x = Math.max(-1, Math.min(1, x));
    out.y = Math.max(-1, Math.min(1, y));
    return out;
  }

  // ---------------------------------------------------------------- test overrides
  setOverride(action, value) {
    const i = this.index[action];
    if (i === undefined) throw new Error(`[input] unknown action "${action}"`);
    this.override[i] = value === null || value === undefined ? -1 : (value ? 1 : 0);
  }
  clearOverrides() { this.override.fill(-1); }

  /**
   * Play (re)starts (engine: every switch to 'playing'). Presses latched while the menus were
   * up are dropped (Q / Space / R in the pause menu must not fire on resume), and buttons still
   * held from the menu (pad A on RESUME, B = back) count as already held: no rising edge, so no
   * jump / quick boost / missile volley on the first step. Held state (W, triggers) still works.
   */
  resume() {
    this.latch.fill(0);
    this.lookAccum.x = this.lookAccum.y = 0;
    const raw = this._sampleRaw();
    for (let i = 0; i < raw.length; i++) if (raw[i]) this.prev[i] = 1;
  }

  /** Reset per-session edge state (called on restart). */
  reset() {
    this.cur.fill(0); this.prev.fill(0); this.latch.fill(0);
    this.lookAccum.x = this.lookAccum.y = 0;
  }
}

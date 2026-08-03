// ============================================================
//  Input — pointer lock mouse look + keyboard action mapping.
//  Also exposes a scripted-input channel used by the automated
//  screenshot harness (tools/shot.mjs).
// ============================================================

export const ACTIONS = {
  FORWARD: 'forward', BACK: 'back', LEFT: 'left', RIGHT: 'right',
  QB: 'qb', ASCEND: 'ascend', DESCEND: 'descend',
  RIFLE: 'rifle', BLADE: 'blade', MISSILE: 'missile', CANNON: 'cannon',
  LOCK: 'lock', REPAIR: 'repair', RELOAD: 'reload', PAUSE: 'pause',
};

const KEYMAP = {
  KeyW: ACTIONS.FORWARD, KeyS: ACTIONS.BACK, KeyA: ACTIONS.LEFT, KeyD: ACTIONS.RIGHT,
  ArrowUp: ACTIONS.FORWARD, ArrowDown: ACTIONS.BACK, ArrowLeft: ACTIONS.LEFT, ArrowRight: ACTIONS.RIGHT,
  ShiftLeft: ACTIONS.QB, ShiftRight: ACTIONS.QB,
  Space: ACTIONS.ASCEND,
  ControlLeft: ACTIONS.DESCEND, ControlRight: ACTIONS.DESCEND, KeyC: ACTIONS.DESCEND,
  KeyE: ACTIONS.MISSILE, KeyQ: ACTIONS.CANNON,
  Tab: ACTIONS.LOCK, KeyF: ACTIONS.LOCK,
  KeyR: ACTIONS.RELOAD, KeyV: ACTIONS.REPAIR,
  Escape: ACTIONS.PAUSE,
};

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.down = new Set();      // actions currently held
    this.pressed = new Set();   // actions that went down this frame
    this.released = new Set();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.locked = false;
    this.enabled = true;
    this.scripted = null;       // { down:Set, dx, dy } — harness override

    this._onKeyDown = (e) => {
      const a = KEYMAP[e.code];
      if (!a) return;
      if (e.code === 'Tab' || e.code === 'Space') e.preventDefault();
      if (!this.down.has(a)) this.pressed.add(a);
      this.down.add(a);
    };
    this._onKeyUp = (e) => {
      const a = KEYMAP[e.code];
      if (!a) return;
      this.down.delete(a);
      this.released.add(a);
    };
    this._onMouseDown = (e) => {
      const a = e.button === 0 ? ACTIONS.RIFLE : e.button === 2 ? ACTIONS.BLADE : ACTIONS.MISSILE;
      if (!this.down.has(a)) this.pressed.add(a);
      this.down.add(a);
    };
    this._onMouseUp = (e) => {
      const a = e.button === 0 ? ACTIONS.RIFLE : e.button === 2 ? ACTIONS.BLADE : ACTIONS.MISSILE;
      this.down.delete(a);
      this.released.add(a);
    };
    // Fallback aiming for contexts where pointer lock is refused — an
    // embedded iframe without allow="pointer-lock", for instance. The cursor
    // offset from screen centre becomes a turn RATE, which is playable
    // without the pointer ever needing to be captured.
    this.freeAim = false;
    this._cx = 0; this._cy = 0;
    this._onMouseMove = (e) => {
      if (this.locked) {
        this.mouseDX += e.movementX || 0;
        this.mouseDY += e.movementY || 0;
      } else if (this.freeAim) {
        this._cx = e.clientX - window.innerWidth * 0.5;
        this._cy = e.clientY - window.innerHeight * 0.5;
      }
    };
    this._onLockChange = () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (this.locked) this.freeAim = false;
      else this.down.clear();
    };

    window.addEventListener('keydown', this._onKeyDown, { passive: false });
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('mousedown', this._onMouseDown);
    window.addEventListener('mouseup', this._onMouseUp);
    window.addEventListener('mousemove', this._onMouseMove);
    window.addEventListener('blur', () => this.down.clear());
    document.addEventListener('pointerlockchange', this._onLockChange);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  requestLock() {
    if (this.locked) return;
    if (!this.canvas.requestPointerLock) { this.freeAim = true; return; }
    let p;
    try { p = this.canvas.requestPointerLock(); } catch { this.freeAim = true; return; }
    if (p && p.catch) p.catch(() => { this.freeAim = true; });
    // Some embedders reject silently rather than rejecting the promise.
    setTimeout(() => { if (!this.locked) this.freeAim = true; }, 700);
  }
  exitLock() { if (document.exitPointerLock) document.exitPointerLock(); }

  isDown(a) { return this.scripted ? this.scripted.down.has(a) : this.down.has(a); }
  wasPressed(a) { return this.scripted ? this.scripted.pressed.has(a) : this.pressed.has(a); }
  wasReleased(a) { return this.scripted ? this.scripted.released.has(a) : this.released.has(a); }

  // In free-aim the cursor offset is a rate, so it must be scaled by frame
  // time. dt is set by the consumer each frame via setDelta().
  get dx() {
    if (this.scripted) return this.scripted.dx;
    if (this.mouseDX) return this.mouseDX;          // pointer lock or touch drag
    if (!this.locked && this.freeAim) return this._rate(this._cx, window.innerWidth);
    return 0;
  }
  get dy() {
    if (this.scripted) return this.scripted.dy;
    if (this.mouseDY) return this.mouseDY;
    if (!this.locked && this.freeAim) return this._rate(this._cy, window.innerHeight);
    return 0;
  }

  setDelta(dt) { this._dt = dt; }

  /** dead-zoned, squared response so the centre of the screen is calm */
  _rate(off, span) {
    const half = span * 0.5;
    let t = off / half;                       // -1 .. 1
    const dead = 0.10;
    if (Math.abs(t) < dead) return 0;
    t = (t - Math.sign(t) * dead) / (1 - dead);
    return Math.sign(t) * t * t * 1250 * (this._dt || 0.016);
  }

  // Normalised movement axes in local space (x = strafe, z = forward).
  axes(out = { x: 0, z: 0 }) {
    out.x = (this.isDown(ACTIONS.RIGHT) ? 1 : 0) - (this.isDown(ACTIONS.LEFT) ? 1 : 0);
    out.z = (this.isDown(ACTIONS.FORWARD) ? 1 : 0) - (this.isDown(ACTIONS.BACK) ? 1 : 0);
    const m = Math.hypot(out.x, out.z);
    if (m > 1) { out.x /= m; out.z /= m; }
    return out;
  }

  endFrame() {
    this.pressed.clear();
    this.released.clear();
    this.mouseDX = 0;
    this.mouseDY = 0;
    if (this.scripted) { this.scripted.pressed.clear(); this.scripted.released.clear(); this.scripted.dx = 0; this.scripted.dy = 0; }
  }

  // --- touch support ---------------------------------------------------
  // Touch writes into the same down/pressed/released sets the keyboard uses,
  // so every consumer stays unaware of the input device.
  touchSet(action, isDown) {
    if (isDown) {
      if (!this.down.has(action)) this.pressed.add(action);
      this.down.add(action);
    } else if (this.down.has(action)) {
      this.down.delete(action);
      this.released.add(action);
    }
  }
  /** drag deltas from the touch look surface, in the same units as mouse look */
  scriptedTouchLook(dx, dy) { this.mouseDX += dx; this.mouseDY += dy; }

  // --- harness support -------------------------------------------------
  useScripted(on) {
    this.scripted = on ? { down: new Set(), pressed: new Set(), released: new Set(), dx: 0, dy: 0 } : null;
  }
  scriptSet(action, isDown) {
    if (!this.scripted) this.useScripted(true);
    if (isDown) { if (!this.scripted.down.has(action)) this.scripted.pressed.add(action); this.scripted.down.add(action); }
    else { this.scripted.down.delete(action); this.scripted.released.add(action); }
  }
  scriptLook(dx, dy) { if (!this.scripted) this.useScripted(true); this.scripted.dx += dx; this.scripted.dy += dy; }
}

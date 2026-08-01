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
    this._onMouseMove = (e) => {
      if (!this.locked) return;
      this.mouseDX += e.movementX || 0;
      this.mouseDY += e.movementY || 0;
    };
    this._onLockChange = () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (!this.locked) this.down.clear();
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
    if (!this.locked && this.canvas.requestPointerLock) {
      const p = this.canvas.requestPointerLock();
      if (p && p.catch) p.catch(() => {});
    }
  }
  exitLock() { if (document.exitPointerLock) document.exitPointerLock(); }

  isDown(a) { return this.scripted ? this.scripted.down.has(a) : this.down.has(a); }
  wasPressed(a) { return this.scripted ? this.scripted.pressed.has(a) : this.pressed.has(a); }
  wasReleased(a) { return this.scripted ? this.scripted.released.has(a) : this.released.has(a); }

  get dx() { return this.scripted ? this.scripted.dx : this.mouseDX; }
  get dy() { return this.scripted ? this.scripted.dy : this.mouseDY; }

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

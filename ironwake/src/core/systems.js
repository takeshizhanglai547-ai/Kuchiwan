// src/core/systems.js — subsystem registry.
//
// A subsystem module's DEFAULT export is either a system object or a factory
// `(game) => system`. A system is:
//   {
//     name: 'hud',            // unique; also reachable as game.systems.get('hud')
//     order: 900,             // update order (low first). See docs/ARCHITECTURE.md
//     init(game),             // once at boot (may be async). Create meshes/pools/listeners here.
//     reset(game),            // at every mission (re)start. Clear per-session state. (optional)
//     update(dt),             // fixed 60 Hz sim step, dt already scaled by timeScale (optional)
//     lateUpdate(dt),         // after every system's update() in the same step (optional)
//     frame(alpha, realDt),   // once per rendered frame (interpolation, DOM, camera) (optional)
//     dispose(),              // teardown (optional)
//   }
//
// Modules are loaded with dynamic import() inside try/catch: a module that fails to load,
// init, or throws during a phase logs ONE console.error and is disabled ("faulted"), while
// the rest of the game keeps running. (The smoke test fails on any console error, so
// faults never go unnoticed.)
export class SystemRegistry {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.byName = new Map();
    this.failed = [];      // names that failed to load/init
  }

  /**
   * @param {{name:string, load:()=>Promise<any>}[]} modules  (use static string import() so esbuild bundles them)
   */
  async loadAll(modules) {
    const loaded = await Promise.all(modules.map(async (m) => {
      try {
        const mod = await m.load();
        let sys = mod.default;
        if (typeof sys === 'function') sys = sys(this.game);
        if (!sys || typeof sys !== 'object') throw new Error('module has no default export system');
        sys.name = sys.name || m.name;
        if (typeof sys.order !== 'number') sys.order = m.order ?? 500;
        return sys;
      } catch (err) {
        console.error(`[systems] failed to load "${m.name}":`, err);
        this.failed.push(m.name);
        return null;
      }
    }));
    for (const sys of loaded) if (sys) this.register(sys);
    this.list.sort((a, b) => a.order - b.order);
    for (const sys of this.list) {
      if (!sys.init) continue;
      try { await sys.init(this.game); }
      catch (err) { this._fault(sys, 'init', err); this.failed.push(sys.name); }
    }
  }

  register(sys) {
    if (this.byName.has(sys.name)) throw new Error(`[systems] duplicate system "${sys.name}"`);
    sys.faulted = false;
    this.list.push(sys);
    this.byName.set(sys.name, sys);
    return sys;
  }

  get(name) { return this.byName.get(name) || null; }

  _fault(sys, phase, err) {
    sys.faulted = true;
    console.error(`[systems] "${sys.name}" threw in ${phase}() and was disabled:`, err);
  }

  reset() {
    for (const sys of this.list) {
      if (sys.faulted || !sys.reset) continue;
      try { sys.reset(this.game); } catch (err) { this._fault(sys, 'reset', err); }
    }
  }

  update(dt) {
    const l = this.list;
    for (let i = 0; i < l.length; i++) {
      const s = l[i];
      if (s.faulted || !s.update) continue;
      try { s.update(dt); } catch (err) { this._fault(s, 'update', err); }
    }
  }

  lateUpdate(dt) {
    const l = this.list;
    for (let i = 0; i < l.length; i++) {
      const s = l[i];
      if (s.faulted || !s.lateUpdate) continue;
      try { s.lateUpdate(dt); } catch (err) { this._fault(s, 'lateUpdate', err); }
    }
  }

  frame(alpha, realDt) {
    const l = this.list;
    for (let i = 0; i < l.length; i++) {
      const s = l[i];
      if (s.faulted || !s.frame) continue;
      try { s.frame(alpha, realDt); } catch (err) { this._fault(s, 'frame', err); }
    }
  }

  dispose() {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const s = this.list[i];
      if (!s.dispose) continue;
      try { s.dispose(); } catch (err) { console.error(`[systems] "${s.name}" dispose failed:`, err); }
    }
  }

  /** Summary for debug/test API. */
  describe() {
    return this.list.map((s) => ({ name: s.name, order: s.order, faulted: s.faulted }));
  }
}

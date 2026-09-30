// src/core/events.js — tiny synchronous event bus.
//
//   const off = game.events.on('actor:killed', (e) => {...});   off() to unsubscribe
//   game.events.emit('actor:killed', { actor, by });
//
// Event names are documented in docs/ARCHITECTURE.md (section "Events"). Handlers run
// synchronously in registration order; an exception in one handler is logged and does
// not stop the others. listenerCount() is used by the smoke test to detect leaks across
// restarts, so subscribe ONCE in init(), not in reset().
export class EventBus {
  constructor() { this.map = new Map(); }

  on(name, fn) {
    let list = this.map.get(name);
    if (!list) { list = []; this.map.set(name, list); }
    list.push(fn);
    return () => this.off(name, fn);
  }

  once(name, fn) {
    const off = this.on(name, (payload) => { off(); fn(payload); });
    return off;
  }

  off(name, fn) {
    const list = this.map.get(name);
    if (!list) return;
    const i = list.indexOf(fn);
    if (i >= 0) list.splice(i, 1);
  }

  emit(name, payload) {
    const list = this.map.get(name);
    if (!list || !list.length) return;
    // Snapshot so handlers that (un)subscribe during emit don't skip or double-call others.
    const snap = list.length === 1 ? list : list.slice();
    for (let i = 0; i < snap.length; i++) {
      try { snap[i](payload); } catch (err) { console.error(`[events] handler for "${name}" threw:`, err); }
    }
  }

  /** Total listeners (or for one event). Used by leak checks. */
  listenerCount(name) {
    if (name) return (this.map.get(name) || []).length;
    let n = 0;
    for (const list of this.map.values()) n += list.length;
    return n;
  }

  clear() { this.map.clear(); }
}

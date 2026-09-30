// src/core/pool.js — allocation-free object pools.
//
//   const pool = new Pool(() => ({ pos: new THREE.Vector3(), life: 0 }), 256);
//   const p = pool.acquire();  if (!p) return;      // null when exhausted (by design)
//   ... later ... pool.release(p);
//   pool.forEachActive((p) => ...)                   // or iterate pool.active[0..count)
//
// Items live in a dense `active` array; release swaps with the last active item, so
// iteration order is NOT stable. When iterating and releasing in the same loop, iterate
// BACKWARDS (for (let i = pool.count - 1; i >= 0; i--)).
export class Pool {
  /**
   * @param {() => object} create   factory (called up-front for all `capacity` items)
   * @param {number} capacity       hard cap; acquire() returns null past it
   * @param {(item:object)=>void} [onRelease] optional reset hook
   */
  constructor(create, capacity, onRelease = null) {
    this.capacity = capacity;
    this.onRelease = onRelease;
    this.items = new Array(capacity);
    this.active = new Array(capacity);
    this.free = new Array(capacity);
    for (let i = 0; i < capacity; i++) {
      const it = create(i);
      it.__poolIndex = -1; // index in `active` while acquired, -1 while free
      this.items[i] = it;
      this.free[i] = it;
    }
    this.freeCount = capacity;
    this.count = 0; // number of active items
  }

  acquire() {
    if (this.freeCount === 0) return null;
    const it = this.free[--this.freeCount];
    it.__poolIndex = this.count;
    this.active[this.count++] = it;
    return it;
  }

  release(it) {
    const idx = it.__poolIndex;
    if (idx < 0) return; // double release guard
    const last = this.active[--this.count];
    this.active[idx] = last;
    last.__poolIndex = idx;
    this.active[this.count] = undefined;
    it.__poolIndex = -1;
    this.free[this.freeCount++] = it;
    if (this.onRelease) this.onRelease(it);
  }

  /** Release everything (e.g. on restart). */
  releaseAll() {
    for (let i = this.count - 1; i >= 0; i--) this.release(this.active[i]);
  }

  forEachActive(fn) {
    for (let i = this.count - 1; i >= 0; i--) fn(this.active[i], i);
  }
}

// ============================================================
//  Tiny synchronous event bus. Zero allocation on emit.
// ============================================================

export class EventBus {
  constructor() { this.map = new Map(); }

  on(type, fn) {
    let l = this.map.get(type);
    if (!l) { l = []; this.map.set(type, l); }
    l.push(fn);
    return () => this.off(type, fn);
  }

  off(type, fn) {
    const l = this.map.get(type);
    if (!l) return;
    const i = l.indexOf(fn);
    if (i >= 0) l.splice(i, 1);
  }

  emit(type, payload) {
    const l = this.map.get(type);
    if (!l) return;
    for (let i = 0; i < l.length; i++) l[i](payload);
  }

  clear() { this.map.clear(); }
}

/*  Canonical event catalogue — keep in sync with ARCHITECTURE.md
 *
 *  'hit'        { target, point, normal, damage, impact, acs, source, weapon, direct }
 *  'damage'     { entity, amount, isPlayer, staggered }
 *  'stagger'    { entity }
 *  'kill'       { entity, kind }
 *  'explode'    { position, radius, power, color, kind }
 *  'fire'       { weapon, origin, dir, owner }
 *  'shake'      { amount, duration }
 *  'lock'       { targets, hard }
 *  'objective'  { id, state, text }
 *  'phase'      { entity, phase }
 *  'state'      { from, to }        // game state machine
 *  'hud'        { type, ... }       // generic HUD ping (toast, warning...)
 */

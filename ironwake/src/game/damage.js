// src/game/damage.js — AP damage + ACS impact / STAGGER math. Pure (unit-tested in
// tests/damage.test.mjs). Owner: lead gameplay (weapons/enemy designers tune numbers).
//
// Model (genre-standard):
//   * AP (armor points): reaching 0 destroys the actor.
//   * ACS gauge: every hit adds IMPACT. When the gauge fills, the target is STAGGERED
//     for staggerTime seconds: it can't act, and DIRECT hits deal bonus damage
//     (hit.directHitMul, default DAMAGE.directHitMul). The gauge is locked during stagger
//     and empties afterwards.
//   * The gauge decays after decayDelay seconds without impact, at decayRate * max per s.
//     Staggered => gauge reset, so players must keep up the pressure to re-stagger.

export const DAMAGE = {
  directHitMul: 1.85,       // default bonus vs. staggered targets for direct hits (benchmark: 185%)
  splashFalloffMin: 0.25,   // splash damage at the edge of the radius (fraction)
};

export const DEFAULT_ACS = { max: 1000, decayDelay: 0.6, decayRate: 0.28, staggerTime: 1.8 };

export class AcsGauge {
  constructor(cfg = {}) {
    this.cfg = { ...DEFAULT_ACS, ...cfg };
    this.reset();
  }
  reset() { this.value = 0; this.delay = 0; this.staggerT = 0; }
  get staggered() { return this.staggerT > 0; }
  get frac() { return this.value / this.cfg.max; }

  /** Add impact. Returns true if this hit triggered a stagger. */
  addImpact(impact) {
    if (this.staggerT > 0 || impact <= 0) return false;
    this.value += impact;
    this.delay = this.cfg.decayDelay;
    if (this.value >= this.cfg.max) {
      this.value = this.cfg.max;
      this.staggerT = this.cfg.staggerTime;
      return true;
    }
    return false;
  }

  update(dt) {
    if (this.staggerT > 0) {
      this.staggerT -= dt;
      if (this.staggerT <= 0) { this.staggerT = 0; this.value = 0; }
      return;
    }
    if (this.delay > 0) { this.delay -= dt; return; }
    if (this.value > 0) this.value = Math.max(0, this.value - this.cfg.decayRate * this.cfg.max * dt);
  }
}

/**
 * Apply a hit to a damageable {ap, apMax, acs: AcsGauge, invulnerable?}.
 * hit = { damage, impact, direct (bool), directHitMul? , splashFrac? (0..1 falloff multiplier) }
 * Returns a result object (reuse `out` to avoid allocations).
 */
export function applyHit(target, hit, out = { damage: 0, staggered: false, killed: false, wasStaggered: false }) {
  out.damage = 0; out.staggered = false; out.killed = false;
  out.wasStaggered = target.acs.staggered;
  if (target.ap <= 0) return out;
  const scale = hit.splashFrac === undefined ? 1 : hit.splashFrac;
  let dmg = hit.damage * scale;
  if (hit.direct && target.acs.staggered) dmg *= (hit.directHitMul || DAMAGE.directHitMul);
  out.staggered = target.acs.addImpact(hit.impact * scale);
  if (!target.invulnerable) {
    dmg = Math.round(dmg);
    target.ap = Math.max(0, target.ap - dmg);
    out.damage = dmg;
    out.killed = target.ap <= 0;
  }
  return out;
}

/** Linear splash falloff: 1 at the center .. splashFalloffMin at the edge. */
export function splashFalloff(dist, radius) {
  if (dist >= radius) return 0;
  const t = Math.max(0, dist) / radius;
  return 1 - t * (1 - DAMAGE.splashFalloffMin);
}

// src/mech/energy.js — EN (energy) gauge logic. Pure (no DOM/three), unit-tested
// in tests/energy.test.mjs. Owner: movement designer.
//
// Behaviour:
//   * spend(cost) for instant costs (quick boost, jump, AB ignition); drain(amount) for
//     continuous costs (hover, assault boost). Both refuse while REDLINED (depleted).
//   * Any consumption resets a short regen delay (regenDelay).
//   * Hitting 0 => REDLINE: nothing can consume EN for redlineDelay seconds, then EN
//     regenerates, and consumption unlocks again once value >= max * redlineUnlockFrac.
//   * When the redline delay ends, redlineRestore EN is granted instantly.
//   * Regen can be slower in the air (airRegenMul).
export const DEFAULT_EN = {
  max: 100,
  regenRate: 55,          // per second on the ground
  airRegenMul: 0.55,      // multiplier while airborne
  regenDelay: 0.45,       // seconds after any consumption before regen starts
  redlineDelay: 1.6,      // seconds of lockout after hitting 0
  redlineUnlockFrac: 0.5, // must recover to this fraction of max to leave redline
  redlineRegenMul: 1.35,  // faster regen while recovering from redline
  redlineRestore: 0,      // EN restored INSTANTLY when the redline delay ends ("post-recovery supply")
};

export class EnergyGauge {
  constructor(cfg = DEFAULT_EN) {
    this.cfg = { ...DEFAULT_EN, ...cfg };
    this.reset();
  }

  reset() {
    this.value = this.cfg.max;
    this.delay = 0;
    this.redline = false;
    this.justDepleted = false; // true for the step EN hit 0
  }

  get max() { return this.cfg.max; }
  get frac() { return this.value / this.cfg.max; }
  /** Can anything consume EN right now? */
  get usable() { return !this.redline && this.value > 0; }

  _consume(amount) {
    this.value -= amount;
    this.delay = Math.max(this.delay, this.cfg.regenDelay);
    if (this.value <= 0) {
      this.value = 0;
      this.redline = true;
      this.justDepleted = true;
      this.delay = this.cfg.redlineDelay;
    }
  }

  /** Instant cost. Allowed if usable (may overdraw into redline). Returns success. */
  spend(cost) {
    if (!this.usable) return false;
    this._consume(cost);
    return true;
  }

  /** Continuous cost (amount already multiplied by dt). Returns success. */
  drain(amount) {
    if (!this.usable) return false;
    this._consume(amount);
    return true;
  }

  /** Advance timers/regen. Call once per step. */
  update(dt, grounded = true) {
    this.justDepleted = false;
    const c = this.cfg;
    if (this.delay > 0) {
      this.delay -= dt;
      if (this.delay <= 0 && this.redline && c.redlineRestore > 0) {
        this.value = Math.min(c.max, this.value + c.redlineRestore);
        if (this.value >= c.max * c.redlineUnlockFrac) this.redline = false;
      }
      return;
    }
    let rate = c.regenRate * (grounded ? 1 : c.airRegenMul);
    if (this.redline) rate *= c.redlineRegenMul;
    this.value = Math.min(c.max, this.value + rate * dt);
    if (this.redline && this.value >= c.max * c.redlineUnlockFrac) this.redline = false;
  }
}

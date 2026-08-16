// ============================================================
//  ObCore — the EN economy.
//
//  Ported from overburst/src/mech/player.js (_spendEN / _drainEN /
//  _redline and the recharge block at the tail of update()). The shape of
//  this system is the AC6 punish: EN is not a bar that merely runs out, it
//  is a bar that PUNISHES you for running it out. Emptying it does not
//  stall you for a frame — it locks the whole economy for
//  EN_REDLINE_DELAY, during which nothing recharges and every boost verb
//  is refused, and it hands you back only 30 % of capacity afterwards.
//
//  Ordering matters and is part of the contract:
//      TickTimers(dt)   at the TOP of the frame  (delays + lockout)
//      Spend / Drain    during the frame          (each re-arms the delay)
//      Recharge(dt, g)  at the BOTTOM of the frame
//  That is exactly the order player.js runs them in, and it is why a spend
//  always costs you the full recovery delay: the delay is re-armed after
//  it was decremented, so the recharge at the bottom of the same frame
//  cannot fire.
//
//  ZERO Unreal dependencies. Verified by unreal/tests/test_movement.cpp.
// ============================================================
#pragma once

// ObTypes.h FIRST, deliberately: ObConfig.h uses uint8_t without including
// <cstdint> itself, so it only compiles behind ObTypes.h. Do not "tidy" the
// order here — fix it in ObConfig.h (owned elsewhere) and then this note goes.
#include "ObTypes.h"
#include "ObConfig.h"

namespace ob {

/**
 * The player mech's energy tank. `MechMover` owns one (the web build's
 * Player owns the same state); `UObEnergyComponent` is a read-only view
 * onto it plus the HUD conversions.
 */
struct EnergyState {
  float en = cfg::Player::EnCap;
  float cap = cfg::Player::EnCap;

  /** s remaining before recharge may resume. Re-armed by every spend. */
  float recoverDelay = 0.0f;
  /** s remaining on the redline lockout. Non-zero means EVERYTHING is refused. */
  float lockout = 0.0f;
  /** Latched while the lockout runs — this is what puts the mech in walk mode. */
  bool overload = false;

  /** Edge flags for the host's HUD/VFX. Cleared by TickTimers each frame. */
  bool justRedlined = false;
  bool justRestored = false;

  /** Fraction of capacity handed back when the lockout expires. */
  static constexpr float RestoreFrac = 0.30f;

  void Reset();

  bool Locked() const { return lockout > 0.0f; }
  float Frac() const { return cap > EPS ? Saturate(en / cap) : 0.0f; }

  /**
   * True if `amount` can be paid right now. Note the STRICT comparison:
   * paying exactly your last joule redlines you rather than succeeding,
   * which is what makes the tenth quick boost on a full tank the one that
   * kills you.
   */
  bool CanAfford(float amount) const { return !Locked() && amount < en; }

  /** One-shot cost (quick boost, assault-boost ignition). False = refused. */
  bool Spend(float amount);

  /** Sustained cost (assault boost, hover). False = refused, and you just redlined. */
  bool Drain(float rate, float dt);

  /** Top of frame: age the delays, and lift the lockout when it expires. */
  void TickTimers(float dt);

  /** Bottom of frame: recharge, at the grounded or the airborne rate. */
  void Recharge(float dt, bool grounded);

  /** Convenience for a frame with no spends in it — timers, then recharge. */
  void Tick(float dt, bool grounded) {
    TickTimers(dt);
    Recharge(dt, grounded);
  }

  /** Trip the lockout. Idempotent while it is already tripped. */
  void Redline();
};

}  // namespace ob

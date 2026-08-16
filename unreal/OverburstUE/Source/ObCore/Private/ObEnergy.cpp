// ============================================================
//  ObCore — EN economy implementation.
//  Line-for-line port of player.js's _spendEN / _drainEN / _redline and
//  the recharge block. Every branch here exists in the web build.
// ============================================================
#include "ObEnergy.h"

namespace ob {

void EnergyState::Reset() {
  en = cap;
  recoverDelay = 0.0f;
  lockout = 0.0f;
  overload = false;
  justRedlined = false;
  justRestored = false;
}

bool EnergyState::Spend(float amount) {
  if (Locked()) return false;
  // The delay is armed even when the spend fails: attempting the boost is
  // what interrupts the recharge, not succeeding at it.
  recoverDelay = cfg::Player::EnRecoveryDelay;
  if (amount >= en) {
    en = 0.0f;
    Redline();
    return false;
  }
  en -= amount;
  return true;
}

bool EnergyState::Drain(float rate, float dt) {
  if (Locked()) return false;
  const float a = rate * dt;
  recoverDelay = cfg::Player::EnRecoveryDelay;
  if (a >= en) {
    en = 0.0f;
    Redline();
    return false;
  }
  en -= a;
  return true;
}

void EnergyState::Redline() {
  if (overload) return;
  overload = true;
  lockout = cfg::Player::EnRedlineDelay;
  justRedlined = true;
}

void EnergyState::TickTimers(float dt) {
  justRedlined = false;
  justRestored = false;

  if (recoverDelay > 0.0f) recoverDelay -= dt;

  if (lockout > 0.0f) {
    lockout -= dt;
    if (lockout <= 0.0f) {
      lockout = 0.0f;
      overload = false;
      // You are handed back a third of a tank, not a full one. The rest is
      // earned back through the ordinary recharge.
      en = cap * RestoreFrac;
      recoverDelay = 0.0f;
      justRestored = true;
    }
  }
}

void EnergyState::Recharge(float dt, bool grounded) {
  if (lockout > 0.0f || recoverDelay > 0.0f || en >= cap) return;
  const float rate = grounded ? cfg::Player::EnRecharge : cfg::Player::EnRechargeAir;
  en += rate * dt;
  if (en > cap) en = cap;
}

}  // namespace ob

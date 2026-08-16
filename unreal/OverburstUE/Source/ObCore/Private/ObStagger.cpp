// ============================================================
//  ObCore — ACS / stagger implementation.
//  Port of player.js's ACS block, takeDamage() and _stagger().
// ============================================================
#include "ObStagger.h"

namespace ob {

void StaggerState::Reset() {
  acs = 0.0f;
  decayDelay = 0.0f;
  staggerTimer = 0.0f;
  staggered = false;
  justStaggered = false;
  justRecovered = false;
}

void StaggerState::Tick(float dt) {
  justStaggered = false;
  justRecovered = false;

  // The delay is aged first, so the frame it lapses is the frame decay
  // starts — matching the timer block at the top of player.js update().
  if (decayDelay > 0.0f) decayDelay -= dt;

  if (staggered) {
    staggerTimer -= dt;
    if (staggerTimer <= 0.0f) {
      staggerTimer = 0.0f;
      staggered = false;
      acs = 0.0f;  // clean slate on recovery, never a hair trigger
      justRecovered = true;
    }
    return;
  }

  if (acs > 0.0f && decayDelay <= 0.0f) {
    acs -= cfg::Player::AcsDecay * dt;
    if (acs < 0.0f) acs = 0.0f;
  }
}

bool StaggerState::AddStrain(float amount) {
  // A staggered target takes no further strain — the gauge is pinned full
  // for the whole window, so chaining hits cannot extend it.
  if (staggered) return false;

  acs += amount;
  if (acs > cap) acs = cap;
  decayDelay = cfg::Player::AcsDecayDelay;

  if (acs >= cap) {
    ForceStagger();
    return true;
  }
  return false;
}

HitResult StaggerState::TakeHit(float baseDamage, float acsStrain, bool direct) {
  HitResult r;
  // Read the multiplier BEFORE the strain lands: the hit that breaks the
  // stance is not itself a punish hit.
  r.wasStaggered = staggered;
  r.multiplier = DamageMultiplier(direct);
  r.damage = baseDamage * r.multiplier;
  r.causedStagger = AddStrain(acsStrain);
  return r;
}

void StaggerState::ForceStagger() {
  if (staggered) return;
  staggered = true;
  staggerTimer = cfg::Player::StaggerTime;
  acs = cap;
  justStaggered = true;
}

}  // namespace ob

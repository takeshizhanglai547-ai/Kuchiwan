// ============================================================
//  ObCore — the ACS / stagger model.
//
//  Ported from overburst/src/mech/player.js (takeDamage / _stagger and
//  the ACS block in update()). This is the combat loop of the genre: you
//  do not kill an AC by chipping its AP, you fill its ACS gauge faster
//  than it decays, break its stance, and then land the one hit that is
//  worth 1.62x.
//
//  The rules, exactly as the web build implements them:
//    * strain accumulates to a cap and re-arms a decay DELAY on every hit,
//      so sustained fire holds the gauge up and a lull gives it back
//    * once the delay lapses, the gauge bleeds at ACS_DECAY per second
//    * filling the gauge staggers for STAGGER_TIME, during which the gauge
//      is pinned full and takes no further strain
//    * recovery zeroes the gauge — you get a clean slate, not a hair trigger
//    * a hit on a STAGGERED target is multiplied by DIRECT_HIT_MULT; a
//      direct hit on a standing target gets the smaller 1.18x
//    * the hit that CAUSES the stagger does not get the bonus. The
//      multiplier is read from the state the target was in when it was hit.
//
//  Used by the player and by every hostile — an AC duel is symmetric.
//  ZERO Unreal dependencies. Verified by unreal/tests/test_movement.cpp.
// ============================================================
#pragma once

// ObTypes.h first — see the note in ObEnergy.h (ObConfig.h needs <cstdint>).
#include "ObTypes.h"
#include "ObConfig.h"

namespace ob {

/** What one hit did. Returned by StaggerState::TakeHit. */
struct HitResult {
  /** Damage after the stagger / direct-hit multiplier. */
  float damage = 0.0f;
  float multiplier = 1.0f;
  /** The target was ALREADY staggered when this landed (the 1.62x case). */
  bool wasStaggered = false;
  /** This hit is the one that filled the gauge. */
  bool causedStagger = false;
};

struct StaggerState {
  float acs = 0.0f;
  float cap = cfg::Player::AcsCap;

  /** s before the gauge starts bleeding again. Re-armed by every hit. */
  float decayDelay = 0.0f;
  /** s left in the stagger window. */
  float staggerTimer = 0.0f;
  bool staggered = false;

  /** Edge flags for the host's HUD/VFX. Cleared by Tick each frame. */
  bool justStaggered = false;
  bool justRecovered = false;

  /** Direct hit on a target that is still standing. player.js takeDamage(). */
  static constexpr float DirectBonus = 1.18f;
  /** Fallback strain when a weapon quotes impact but not ACS. */
  static constexpr float ImpactToAcs = 0.55f;

  void Reset();

  /** Age the decay delay and the stagger window; bleed the gauge. */
  void Tick(float dt);

  float Frac() const { return cap > EPS ? Saturate(acs / cap) : 0.0f; }

  /** The multiplier a hit landing RIGHT NOW would be scaled by. */
  float DamageMultiplier(bool direct) const {
    return staggered ? cfg::Player::DirectHitMult : (direct ? DirectBonus : 1.0f);
  }

  /** Add strain. Returns true if this is the hit that broke the target. */
  bool AddStrain(float amount);

  /** Damage scaling and strain in one call — the whole rule, one place. */
  HitResult TakeHit(float baseDamage, float acsStrain, bool direct);

  /** Break the stance outright (a blade finisher, a scripted beat). */
  void ForceStagger();

  static float StrainFromImpact(float impact) { return impact * ImpactToAcs; }
};

}  // namespace ob

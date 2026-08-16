// ============================================================
//  ObCore — the mech movement solver.
//
//  Ported from overburst/src/mech/player.js (update / _move / _bounds /
//  _quickBoost / _updateAssault) and playerCollide.js (the capsule
//  resolution). This is the system that decides whether the game feels
//  like an Armored Core, so it is ported FAITHFULLY, not improved.
//
//  ------------------------------------------------------------------
//  THE MODEL — from the web build's own header
//
//    Drag is applied FIRST, then acceleration only tops the velocity up TO
//    the wish speed along the wish direction — it never subtracts. That is
//    what makes a quick boost feel like a real impulse: the overspeed is
//    preserved and bleeds off through drag instead of being lerped away,
//    and reduced drag during the QB window carries it.
//
//  A UE FloatingPawnMovement or CharacterMovementComponent cannot
//  reproduce this: both drive velocity toward a target, which flattens a
//  118 m/s injection back to walking pace inside two frames. The pawn ticks
//  this solver instead and applies the resulting transform.
//
//  ------------------------------------------------------------------
//  UNITS
//  METRES and seconds throughout, matching the web build 1:1 so the two
//  targets stay comparable. The Unreal layer multiplies by ob::M_TO_UU
//  once, at the component boundary, and swizzles Y-up to Z-up there too.
//
//  ------------------------------------------------------------------
//  WHY THE FEEL CONSTANTS LIVE HERE AND NOT IN ObConfig.h
//  ObConfig.h mirrors overburst/src/config.js 1:1 — that mirroring is the
//  reason it can be trusted. The constants below are the ones player.js
//  keeps in its own "feel constants that are local to this system" block,
//  so their faithful home is the solver's header. Same numbers, same
//  place in the structure, nothing invented.
// ============================================================
#pragma once

// ObTypes.h first — see the note in ObEnergy.h (ObConfig.h needs <cstdint>).
#include "ObTypes.h"
#include "ObConfig.h"
#include "ObEnergy.h"
#include "ObWorldQuery.h"

namespace ob {

// ------------------------------------------------------------------
//  Local feel constants — mirrors player.js's local block and the
//  playerCollide.js resolution constants.
// ------------------------------------------------------------------
namespace mv {

constexpr float AbHold = 0.15f;         // s of held QB before assault boost ignites
constexpr float AccelGround = 190.0f;   // m/s^2 boost-glide on the deck
constexpr float AccelWalk = 118.0f;     // m/s^2 while EN is redlined
constexpr float AccelAir = 112.0f;      // m/s^2 airborne authority
constexpr float AirVDrag = 0.42f;       // vertical bleed: falls read heavy, not stony
constexpr float VTerminal = -155.0f;    // m/s
constexpr float VAscendMax = 44.0f;     // m/s hover ceiling rate
constexpr float QbTail = 150.0f;        // m/s^2 thrust tail during the QB window
constexpr float StaggerAuth = 0.22f;    // input authority while staggered
constexpr float RepairAuth = 0.42f;     // ...and while a repair kit runs
constexpr float MinAuthSpeed = 0.25f;   // wish speed never scales below this
constexpr float LandHard = 22.0f;       // |vy| that counts as a hard landing
constexpr float EyeHeight = 8.9f;       // m — sensor head, origin of the aim ray

// arena boundary (player.js _bounds)
constexpr float WallMargin = 56.0f;     // soft wall starts this far inside the radius
constexpr float WallWarnMargin = 18.0f; // ...and the HUD warning further out still
constexpr float WallTurn = 2.1f;        // rad/s the boundary may carve the run
constexpr float WallYaw = 1.4f;         // rad/s the heading follows that carve
constexpr float WallCarveSpan = 42.0f;  // m over which the shove ramps to full
constexpr float WallPush = 150.0f;      // m/s^2 inward shove at full strength
constexpr float WallHardOver = 6.0f;    // m past the radius that is hard-clamped
constexpr float WallCarveMinSpeed = 3.0f;
constexpr float WallWarnHold = 4.0f;    // s of warning hysteresis
constexpr float WallSlamSpeed = 46.0f;  // normal speed that counts as a slam

// capsule resolution (playerCollide.js)
/** Anything this far above the feet is walked ONTO, not walked into. The host's
 *  SweepCapsule must use the same band, or a ledge is both climbable and a wall. */
constexpr float StepHeight = 3.5f;
/** SampleHeight tolerance: surfaces above yRef + this are not "under" you. */
constexpr float HeightTolerance = 3.0f;
/** Fraction of the killed normal speed converted into a tangential glide. */
constexpr float Deflect = 0.42f;
constexpr float DeflectMax = 30.0f;     // m/s — a chain of contacts cannot pump energy
constexpr float Skin = 0.01f;           // m of separation kept after a contact
constexpr int MaxSlideIters = 4;        // slide passes per sub-step
constexpr int MaxSubSteps = 8;
/** Longest translation allowed in one sub-step. Under the capsule radius by
 *  construction: at AB_SPEED (146 m/s) and the 0.1 s frame clamp that is
 *  2.09 m against a 4.2 m radius, so nothing tunnels. */
constexpr float SubStepSpan = cfg::Player::Radius * 0.55f;
constexpr float GroundSnapDrop = 1.6f;  // m of step-down that stays glued
constexpr float GroundSnapVy = 0.5f;    // ...only while not climbing

// quick boost internals (player.js _quickBoost)
constexpr float QbPerpScrub = 0.42f;    // perpendicular speed scrubbed on a direction change
constexpr float QbAlongKeep = 0.52f;    // how much of the impulse stacks on existing speed
constexpr float QbGroundHop = 4.5f;     // m/s of lift a grounded QB gives
constexpr float QbFallCut = 0.42f;      // downward speed retained by an airborne QB

// drag selection
constexpr float AbDragGround = 0.9f;
constexpr float AbDragAir = 0.55f;
constexpr float WalkDragScale = 0.62f;  // redlined ground drag
constexpr float StaggerDragScale = 1.6f;
constexpr float AbSteerAuthority = 0.22f;  // lateral steering allowed during AB
constexpr float AbIgnitionMargin = 1.1f;   // EN headroom demanded before igniting
constexpr float BoostingSpeedFrac = 1.15f; // speed/WALK above which the rig reads "boosting"

// frame clamp
constexpr float MaxFrameDt = 0.1f;
constexpr float FallbackDt = 1.0f / 60.0f;

}  // namespace mv

// ------------------------------------------------------------------
//  Input for one step. The host fills this from Enhanced Input (or from
//  a test script) and owns nothing else about movement.
// ------------------------------------------------------------------
struct MoveInput {
  /** Strafe / forward axes, -1..1. Normalised internally when the pair
   *  exceeds unit length, exactly as the web build's input.axes() does. */
  float moveX = 0.0f;
  float moveZ = 0.0f;

  /** RAW look deltas (mouse pixels / stick counts). Sensitivity is applied
   *  here so the Unreal layer never owns a piece of the aim maths. */
  float lookDx = 0.0f;
  float lookDy = 0.0f;

  bool qbHeld = false;      // quick-boost button state
  bool qbPressed = false;   // ...and its rising edge this frame
  bool ascend = false;
  bool ascendPressed = false;
  bool descend = false;

  /** Fed back from ObStagger / the repair kit / the AP pool. They gate the
   *  solver's authority, so the solver must be told, not guess. */
  bool staggered = false;
  bool repairing = false;
  bool alive = true;
};

// ------------------------------------------------------------------
//  Everything the host needs to react to this step: VFX, camera kicks,
//  audio, HUD. Plain flags, cleared at the top of every Step — no
//  allocation, no event bus, no Unreal delegate in the hot path.
// ------------------------------------------------------------------
struct MoveEvents {
  bool quickBoosted = false;
  float qbDirX = 0.0f, qbDirZ = 0.0f;
  /** The QB button was pressed and the boost did NOT happen (reload, EN,
   *  stagger). The HUD wants this: a refused boost is information. */
  bool qbRefused = false;

  bool abIgnited = false;
  bool abEnded = false;

  bool landed = false;
  float landingVy = 0.0f;   // negative; the descent rate at touchdown
  bool hardLanding = false;

  bool wallImpact = false;
  float impactSpeed = 0.0f;             // m/s into the surface
  float impactNx = 0.0f, impactNz = 0.0f;

  bool redlined = false;
  bool enRestored = false;
  bool boundsWarning = false;

  /** Strongest screen shake this step. The amounts come from player.js so
   *  the Unreal layer applies a number rather than re-deriving one. */
  float shake = 0.0f;
  float shakeTime = 0.0f;

  void Clear();
  void Shake(float amount, float duration);
};

// ------------------------------------------------------------------
//  The solver.
//
//  Owns position/velocity/orientation, the ground state and the EN tank
//  (the web build's Player owns EN for the same reason: the boost verbs
//  are the things that spend it). ObStagger is NOT owned here — an AC duel
//  is symmetric and hostiles need the same gauge — so stagger arrives
//  through MoveInput.
// ------------------------------------------------------------------
struct MechMover {
  Vec3 pos{0.0f, 0.0f, 0.0f};
  Vec3 vel{0.0f, 0.0f, 0.0f};
  float yaw = 0.0f;
  float pitch = -0.06f;

  bool grounded = true;
  bool boosting = false;
  bool abActive = false;

  float qbTimer = 0.0f;      // s left in the thrust window
  float qbCooldown = 0.0f;   // s left on the reload
  float qbDirX = 0.0f;
  float qbDirZ = -1.0f;
  float qbHeldTime = 0.0f;   // s the QB button has been held (assault-boost fuse)

  float speed = 0.0f;        // horizontal magnitude, cached each step
  float prevVy = 0.0f;       // vertical speed before this step's vertical pass
  float elapsed = 0.0f;      // s simulated — the rig's animation phase

  bool outOfBounds = false;
  float boundsWarn = 0.0f;

  EnergyState energy;
  MoveEvents events;

  void Reset(const Vec3& spawn, float startYaw);

  /**
   * Advance one frame.
   *
   * `dt` is clamped to 0.1 s and sub-stepped internally, so a hitching
   * host cannot tunnel the mech through a blast wall at assault-boost
   * speed. Calls into `world` only through IWorldQuery.
   */
  void Step(const MoveInput& in, const IWorldQuery& world, float dt);

  /** Sensor head, in metres. Origin of every firing ray. */
  Vec3 EyePos() const { return Vec3{pos.x, pos.y + mv::EyeHeight, pos.z}; }
  Vec3 AimDir() const { return DirFromYawPitch(yaw, pitch); }

  /** 0..1 quick-boost readiness, for the HUD's reload pips. */
  float QbReady() const {
    return qbCooldown <= 0.0f ? 1.0f : 1.0f - qbCooldown / cfg::Player::QbReload;
  }

  /** Knockback / explosion shove. Not clamped: the ACS model is the limiter. */
  void AddImpulse(const Vec3& v) { vel += v; }
  void Knockback(const Vec3& from, float power);

  /** Input authority for the current state — 1 normal, less when broken. */
  static float Authority(const MoveInput& in);

 private:
  bool TryQuickBoost(float dx, float dz);
  void UpdateAssault(float d, bool qbHeld, bool qbTap, float az, float auth,
                     const MoveInput& in);
  void EndAssault();
  void Integrate(const IWorldQuery& world, float d, bool ascend);
  void SlideStep(const IWorldQuery& world, float sdt, float& hitSpeed, float& hnx,
                 float& hnz);
  bool ResolveGround(const IWorldQuery& world, float prevY, bool snap);
  void ApplyArenaBounds(float d);
};

}  // namespace ob

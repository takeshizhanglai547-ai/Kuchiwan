// ============================================================
//  ObCore — the FIXED loadout and its firing state machines.
//
//    R-arm   MG-014 LANCET   burst rifle
//    L-arm   PB-03 VERGE     pulse blade
//    R-back  VP-60LCS        vertical missile rack
//    L-back  BML-SB PYRE     plasma siege cannon
//
//  No assembly, by design. Ported from overburst/src/combat/weapons.js.
//
//  FEEL — the four things that must survive the port
//    * The rifle is an ACCUMULATOR, not a per-frame gate: 545 rpm is
//      honoured exactly whatever dt does. Each round pushes the aim up
//      (bled back over ~1 s, so a burst climbs then settles) and widens
//      the cone; sustained fire is a real accuracy cost.
//    * The blade CHARGES while held, then lunges: windup -> active ->
//      recover. The dash WRITES the firer's velocity — it is an impulse,
//      not a nudge.
//    * The rack builds one lock at a time up to six, then salvos with a
//      stagger between tubes. A full rack lets go on its own.
//    * The cannon charges, vents if you tap it, and shoves the whole
//      mech backwards when it lets go.
//
//  ObCore owns the maths and the state; the host owns the camera, the
//  rig and the VFX. Aim deltas and impulses come back through
//  WeaponOutput — this module never touches an actor.
// ============================================================
#pragma once

#include "ObTypes.h"
#include "ObBallistics.h"
#include "ObConfig.h"

namespace ob {

/** Hardpoints, in HUD order. Indexes FirerState::muzzle. */
enum class Hardpoint : uint8_t { RArm = 0, LArm = 1, RBack = 2, LBack = 3, Count = 4 };

// ------------------------------------------------------------------
//  Feel constants local to this system.
//
//  These mirror weapons.js's own local block one for one. The TUNING
//  numbers (damage, rpm, ranges, timings) live in ObConfig.h and are
//  referenced, never copied.
// ------------------------------------------------------------------
namespace wpn {

constexpr float RifleInterval = 60.0f / cfg::Rifle::Rpm;   // 0.110092 s @ 545 rpm
constexpr float RifleHeatShot = 0.088f;                    // heat per round
constexpr float RifleHeatDecay = 1.55f;                    // per second, trigger released
constexpr float RifleSpreadGrowth = 3.4f;                  // x base spread at full heat
/**
 * Recoil bleed, PROPORTIONAL: the owed climb decays by 1 - e^(-k*dt) each
 * step, so a burst climbs to a plateau and then settles over about a second.
 *
 * The web build spent this same 1.75 as an absolute rad/s. Measured, that is
 * ~20x the accumulation rate (a round adds at most 0.0088 rad and 545 rpm
 * only pays in 0.08 rad/s), so the climb was handed back inside a single
 * frame and never accumulated at all — the opposite of what its own comment
 * described. Read as a rate constant it plateaus at 0.08 / 1.75 = 0.046 rad
 * (2.6 degrees) under sustained fire, which is the intended feel.
 */
constexpr float RifleRecoilRecover = 1.75f;
constexpr int RifleMaxCatchup = 3;                         // rounds one frame may owe
constexpr float RifleRange = 780.0f;
constexpr float RifleDrop = 1.4f;                          // m/s^2 (see BulletSpawn::drop)
constexpr float RifleWidth = 0.34f;
constexpr float RifleAirSpread = 1.35f;                    // airborne accuracy cost
constexpr float RifleAbSpread = 2.2f;                      // assault-boost accuracy cost
constexpr float RifleKickDecay = 7.5f;                     // pose kick bleed, per second
constexpr float RifleDryInterval = 0.55f;

constexpr float BladeChargeTime = 0.80f;
constexpr float BladeMaxHold = 2.6f;
constexpr float BladeRecover = 0.26f;
constexpr float BladeArc = 2.45f;                          // radians swept
constexpr float BladeReach = 15.5f;
constexpr float BladePivotY = 5.9f;
constexpr float BladeRadius = 3.6f;
constexpr float BladeLungeRange = cfg::Blade::Range * 2.6f;
constexpr int BladeMaxHits = 4;      // per sweep step
constexpr int BladeHitMemory = 16;   // per swing; one swing never bites the same frame twice

constexpr float MissFirst = cfg::Missile::LockTime * 0.52f;   // 0.286 s to the first lock
constexpr float MissStep = cfg::Missile::LockTime * 0.40f;    // 0.220 s per extra lock
constexpr float MissAutoDwell = 0.16f;                        // full rack -> auto salvo
constexpr float MissTubeSpread = 0.62f;
constexpr float MissLob = 230.0f;                             // unlocked lob range cap
constexpr float MissLaunchSpeed = 32.0f;
constexpr int MissLoopGuard = 8;

constexpr float CannonMinCharge = 0.34f;   // below this a release VENTS instead of firing
constexpr float CannonAutoDwell = 0.10f;   // a full chamber lets go on its own
constexpr float CannonPushBase = 15.0f;    // m/s of shove at minimum charge
constexpr float CannonPushCharge = 9.0f;
constexpr float CannonPushLift = 0.35f;    // how much of the shove goes vertical
constexpr float CannonPushLiftMin = -5.0f;
constexpr float CannonPushLiftMax = 7.0f;
constexpr float CannonDamageFloor = 0.55f; // damage scale at zero charge
constexpr float CannonDamageGain = 0.45f;
constexpr float CannonBoltRadius = 1.45f;  // fat bolt: uncharged
constexpr float CannonBoltRadiusGain = 0.65f;
constexpr float CannonBlastFloor = 0.78f;  // blast radius scale at zero charge
constexpr float CannonBlastGain = 0.22f;

}  // namespace wpn

// ==================================================================
//  State — the HUD reads every one of these
// ==================================================================
enum class BladePhase : uint8_t { Idle, Charge, Windup, Active, Recover };

struct RifleState {
  int ammo = cfg::Rifle::Ammo;
  int mag = cfg::Rifle::Magazine;
  bool reloading = false;
  bool firing = false;
  float cooldown = 0.0f;          // the ACCUMULATOR: seconds owed before the next round
  float reloadT = 0.0f;
  float reloadProgress = 1.0f;
  float heat = 0.0f;              // 0..1, drives spread
  float spread = cfg::Rifle::Spread;
};

struct BladeState {
  float cooldown = 0.0f;
  float charge = 0.0f;            // 0..1
  BladePhase phase = BladePhase::Idle;
  bool active = false;            // the damaging window
  bool ready = true;
};

struct MissileState {
  int ammo = cfg::Missile::Ammo;
  int racked = cfg::Missile::Count;
  bool reloading = false;
  bool holding = false;
  float cooldown = 0.0f;
  float reloadT = 0.0f;
  float reloadProgress = 1.0f;
  float lockProgress = 0.0f;
  int lockCount = 0;
  const void* locks[cfg::Missile::Count] = {};
};

struct CannonState {
  int ammo = cfg::Cannon::Ammo;
  float charge = 0.0f;            // 0..1
  float cooldown = 0.0f;
  bool charging = false;
  bool ready = true;
};

struct WeaponsState {
  RifleState rifle;
  BladeState blade;
  MissileState missile;
  CannonState cannon;
};

/** Drives the rig. The host applies it; ObCore never poses a mesh. */
struct WeaponPose {
  float rifleRecoil = 0.0f;
  float bladeSwing = 0.0f;
  float bladeCharge = 0.0f;
  float cannonCharge = 0.0f;
  float missileOpen = 0.0f;
};

// ==================================================================
//  Per-frame I/O
// ==================================================================
/** Held button states. Edges are detected inside — the host just reports held. */
struct WeaponInput {
  bool rifle = false;
  bool blade = false;
  bool missile = false;
  bool cannon = false;
  bool reload = false;
};

/**
 * Everything the loadout needs to know about the machine carrying it.
 * All firing geometry converges on `aimPoint`, so what the reticle covers
 * is what the muzzles hit even though they are metres apart.
 */
struct FirerState {
  Vec3 pos;                       // feet
  Vec3 eye;                       // aim ray origin
  Vec3 aimDir{0.0f, 0.0f, -1.0f}; // unit
  Vec3 aimPoint;                  // world point under the reticle
  Vec3 forward{0.0f, 0.0f, -1.0f};// yaw basis
  Vec3 right{1.0f, 0.0f, 0.0f};
  Vec3 muzzle[static_cast<int>(Hardpoint::Count)];
  float pitch = 0.0f;             // current camera pitch, for the recoil clamp
  bool grounded = true;
  bool abActive = false;
  bool blocked = false;           // dead / staggered / repairing
  /** The firer's own opaque handle, so its rounds never bite it. */
  const void* self = nullptr;
  const void* lockTarget = nullptr;
  const void* const* lockList = nullptr;
  int lockCount = 0;
};

/** What the host must apply this frame. Zeroed at the top of every Update. */
struct WeaponOutput {
  float pitchDelta = 0.0f;        // radians, recoil climb net of the bleed-back
  float yawDelta = 0.0f;
  Vec3 impulse;                   // cannon shove: ADD to the firer's velocity
  bool dash = false;              // blade lunge: WRITE the firer's velocity
  Vec3 dashVelocity;
  bool leaveGround = false;
  float shake = 0.0f;
  float shakeDuration = 0.0f;
  int rifleRounds = 0;
  int missilesLaunched = 0;
  int bladeHits = 0;
  bool bladeSwingStarted = false;
  bool cannonFired = false;
  bool cannonVented = false;
  bool reloadStarted = false;
  bool reloadFinished = false;
  bool dryFire = false;
};

// ==================================================================
//  The system
// ==================================================================
class WeaponSystem {
 public:
  explicit WeaponSystem(uint32_t seed = 0x4F1E2D3Bu) : rng_(seed) {}

  void Reset();

  /**
   * One tick of all four hardpoints. Spawns through `ballistics`; damage
   * and detonations reach the host through `ctx.sink`.
   */
  void Update(float dt, const WeaponInput& in, const FirerState& firer,
              Ballistics& ballistics, const CombatContext& ctx, WeaponOutput& out);

  const WeaponsState& State() const { return state_; }
  const WeaponPose& Pose() const { return pose_; }

  /** Rounds owed but not yet fired — the accumulator's debt, for diagnostics. */
  float RifleCooldown() const { return state_.rifle.cooldown; }

 private:
  void UpdateRifle(float dt, const WeaponInput& in, const FirerState& firer,
                   Ballistics& ballistics, const CombatContext& ctx, WeaponOutput& out);
  void FireRifle(const FirerState& firer, Ballistics& ballistics, WeaponOutput& out);
  void BeginReload(WeaponOutput& out);

  void UpdateBlade(float dt, const WeaponInput& in, const FirerState& firer,
                   Ballistics& ballistics, const CombatContext& ctx, WeaponOutput& out);
  void StartSwing(const FirerState& firer, const CombatContext& ctx, WeaponOutput& out);
  void Dash(const FirerState& firer, float scale, WeaponOutput& out);
  Vec3 ArcTip(const FirerState& firer, float u) const;

  void UpdateMissile(float dt, const WeaponInput& in, const FirerState& firer,
                     Ballistics& ballistics, const CombatContext& ctx, WeaponOutput& out);
  void BeginSalvo(WeaponOutput& out);
  void AddLock(const FirerState& firer);
  const void* PickLockTarget(const FirerState& firer) const;
  void LaunchMissile(const FirerState& firer, int tube, Ballistics& ballistics,
                     const CombatContext& ctx, WeaponOutput& out);
  void ReleaseLocks();

  void UpdateCannon(float dt, const WeaponInput& in, const FirerState& firer,
                    Ballistics& ballistics, WeaponOutput& out);
  void FireCannon(const FirerState& firer, Ballistics& ballistics, WeaponOutput& out);
  void VentCannon(WeaponOutput& out);

  /** Muzzle -> the direction that converges on the reticle. */
  Vec3 Solve(const FirerState& firer, Hardpoint hp) const;
  static Vec3 Muzzle(const FirerState& firer, Hardpoint hp) {
    return firer.muzzle[static_cast<int>(hp)];
  }
  /** Add `kick` to the aim, respecting the camera pitch clamp. */
  void ApplyRecoil(float kick, WeaponOutput& out);

  WeaponsState state_;
  WeaponPose pose_;
  Rng rng_;

  // rifle
  float recoilOwed_ = 0.0f;       // climb still to be handed back
  float dryT_ = 0.0f;
  float pitchCursor_ = 0.0f;      // running camera pitch inside the frame

  // blade
  float bladeT_ = 0.0f;
  float bladeHold_ = 0.0f;
  float bladeMult_ = 1.0f;
  float bladeSide_ = 1.0f;
  Vec3 bladeDir_{0.0f, 0.0f, -1.0f};
  Vec3 bladeTipPrev_;
  const void* swingHits_[wpn::BladeHitMemory] = {};
  int swingHitCount_ = 0;

  // missile
  bool mHold_ = false;
  bool mLatch_ = false;
  float mT_ = 0.0f;
  int salvoLeft_ = 0;
  int salvoTube_ = 0;
  float salvoT_ = 0.0f;

  // cannon
  float cT_ = 0.0f;
  float cFull_ = 0.0f;

  WeaponInput prev_;              // for edge detection
};

}  // namespace ob

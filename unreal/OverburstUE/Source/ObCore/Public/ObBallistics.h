// ============================================================
//  ObCore — ballistics.
//
//  Swept-segment bullets, proportional-navigation missiles, the fat
//  plasma bolt, melee sweeps, and splash falloff. Ported from
//  overburst/src/combat/projectiles.js + targets.js, which were tuned
//  in a playable build; the numbers stay identical so the two targets
//  can be compared shot for shot.
//
//  ZERO Unreal headers, no exceptions, no RTTI, no per-frame heap
//  allocation: every pool is a fixed member array, every query takes
//  its scratch by value.
//
//  THE MODEL
//    * Bullets are SWEPT SEGMENTS. Every step, the segment from the
//      previous position to the new one is tested against hostile
//      capsules and IWorldQuery. Nothing tunnels, at any speed or any
//      frame rate — that is the whole reason this is not a point test.
//    * Missiles: an arming phase where they climb off the rack and the
//      nose falls over, then lead-compensated proportional navigation
//      under a HARD turn-rate limit.
//    * The plasma bolt is a fat swept sphere with splash on contact.
//    * DIRECT HIT: a staggered target takes cfg::Player::DirectHitMult
//      damage; the multiplier is applied HERE, once, and the event
//      carries `direct` so the host never applies it twice.
//
//  Authored in METRES. The Unreal layer converts at the boundary.
// ============================================================
#pragma once

// ObTypes.h first: ObConfig.h uses uint8_t and does not include <cstdint>
// itself, so it only compiles behind a header that already pulled it in.
#include "ObTypes.h"
#include "ObConfig.h"
#include "ObWorldQuery.h"

namespace ob {

/**
 * Longest step any combat system integrates in one go. A hitch must make
 * the simulation run SLOW, never teleport a projectile past a target.
 * Mirrors the web build's `Math.min(dt, 0.1)`.
 */
constexpr float kMaxStep = 0.1f;

// ==================================================================
//  Hit volumes
//
//  Every entity in OVERBURST resolves to a VERTICAL CAPSULE whose axis
//  endpoints are already inset by r, so its extent is exactly the
//  entity's [base, base + height]. Same convention as targets.js.
// ==================================================================
struct HitCapsule {
  Vec3 a;                 // low axis end
  Vec3 b;                 // high axis end
  float r = 1.0f;

  Vec3 Centre() const { return (a + b) * 0.5f; }
};

/** Capsule for a frame standing with its feet at `feet` (roots are feet-at-0). */
HitCapsule StandingCapsule(const Vec3& feet, float radius, float height,
                           float baseOffset = 0.0f);

/** Entry distance along a UNIT ray into the sphere, or -1. */
float RaySphere(const Vec3& origin, const Vec3& dir, float tmax,
                const Vec3& centre, float radius);

/** Entry distance along a UNIT ray into `c` grown by `pad`, or -1. Analytic. */
float RayCapsule(const Vec3& origin, const Vec3& dir, float tmax,
                 const HitCapsule& c, float pad);

/** Closest point on the capsule AXIS (not the skin). */
Vec3 ClosestOnAxis(const HitCapsule& c, const Vec3& p);

/** Distance from p to the capsule SKIN. Negative when inside. */
float SurfaceDist(const HitCapsule& c, const Vec3& p);

/** Perturb a unit direction inside a cone of half-angle `spread`. */
Vec3 JitterCone(const Vec3& dir, float spread, Rng& rng);

// ---- splash falloff ----------------------------------------------
// Full damage inside a core of kSplashCore * radius, then (1 - t)^kSplashExp
// out to the rim, so a direct contact is worth roughly three times a graze.
constexpr float kSplashCore = 0.32f;
constexpr float kSplashExp = 1.6f;
constexpr float kSplashCutoff = 0.02f;   // below this a target is skipped entirely

/** Splash weight 0..1 for a target whose SKIN is `surfaceDistance` from the blast. */
float SplashFalloff(float surfaceDistance, float radius);

// ==================================================================
//  Targets — a non-owning view over host storage
//
//  ObCore never allocates, never owns, and never dereferences
//  `userData`: it is the host's opaque handle for the thing that got
//  hit (an AActor* in Unreal, a test rig in the runner).
// ==================================================================
enum class Owner : uint8_t { Player, Enemy };

enum class WeaponId : uint8_t { Rifle, Blade, Missile, Cannon, Blast, Other };

struct CombatTarget {
  HitCapsule vol;
  Vec3 vel;                       // used for missile lead compensation
  const void* userData = nullptr;
  bool alive = true;
  bool staggered = false;         // direct-hit multiplier applies
};

struct TargetView {
  CombatTarget* items = nullptr;
  int count = 0;

  TargetView() = default;
  TargetView(CombatTarget* p, int n) : items(p), count(n) {}
};

/** Index of the live target carrying `userData`, or -1. O(n) over a small n. */
int FindTargetIndex(const TargetView& view, const void* userData);

// ==================================================================
//  Events — the host's window into what the maths decided
// ==================================================================
struct HitEvent {
  const void* target = nullptr;   // null => world geometry / a whiff
  int targetIndex = -1;
  Vec3 point;
  Vec3 normal{0.0f, 1.0f, 0.0f};
  float damage = 0.0f;            // already includes the direct-hit multiplier
  float impact = 0.0f;
  float acs = 0.0f;
  bool direct = false;
  bool splash = false;
  Owner owner = Owner::Player;
  WeaponId weapon = WeaponId::Other;
  const void* source = nullptr;
};

struct ExplosionEvent {
  Vec3 position;
  float radius = 0.0f;
  float power = 1.0f;
  Owner owner = Owner::Player;
  WeaponId weapon = WeaponId::Blast;
  const void* source = nullptr;
};

/** Implemented by the host to receive damage and detonations. */
class ICombatSink {
 public:
  virtual ~ICombatSink() = default;
  virtual void OnHit(const HitEvent&) {}
  virtual void OnExplosion(const ExplosionEvent&) {}
};

/** Everything a projectile step needs from outside ObCore. */
struct CombatContext {
  TargetView enemies;             // what PLAYER-owned fire may hit
  TargetView players;             // what ENEMY-owned fire may hit
  const IWorldQuery* world = nullptr;
  ICombatSink* sink = nullptr;

  const TargetView& Hostiles(Owner o) const { return o == Owner::Enemy ? players : enemies; }
};

// ==================================================================
//  Cast result
// ==================================================================
struct CastHit {
  bool hit = false;
  bool world = false;             // true => static geometry, not an entity
  float t = 0.0f;                 // distance along the cast direction
  Vec3 point;
  Vec3 normal{0.0f, 1.0f, 0.0f};
  int targetIndex = -1;
  const void* userData = nullptr;
};

// ==================================================================
//  Projectile records. Public so the presentation layer can read
//  positions without duplicating a single line of the maths.
// ==================================================================
struct Bullet {
  bool used = false;
  Vec3 pos;
  Vec3 prev;
  Vec3 vel;
  float drop = 0.0f;              // m/s^2, downward (see BulletSpawn)
  float life = 0.0f;
  float travelled = 0.0f;
  float maxDist = 0.0f;
  float radius = 0.0f;            // sweep pad; 0 = a true line segment
  float damage = 0.0f, impact = 0.0f, acs = 0.0f;
  Owner owner = Owner::Player;
  WeaponId weapon = WeaponId::Rifle;
  const void* source = nullptr;
};

struct GuidedMissile {
  bool used = false;
  Vec3 pos;
  Vec3 prev;
  Vec3 dir{0.0f, 1.0f, 0.0f};
  float speed = 0.0f;
  float maxSpeed = 0.0f;
  float accel = 0.0f;
  float turn = 0.0f;              // rad/s — the HARD limit, never exceeded
  float armT = 0.0f;
  float life = 0.0f;
  const void* target = nullptr;
  bool hasAim = false;            // no lock: guide onto a fixed world point
  Vec3 aim;
  Vec3 drift;                     // rack fan-out during the arming phase
  float damage = 0.0f, impact = 0.0f, acs = 0.0f, blast = 0.0f;
  Owner owner = Owner::Player;
  WeaponId weapon = WeaponId::Missile;
  const void* source = nullptr;
};

struct PlasmaBolt {
  bool used = false;
  Vec3 pos;
  Vec3 prev;
  Vec3 dir{0.0f, 0.0f, -1.0f};
  float speed = 0.0f;
  float radius = 1.6f;
  float life = 0.0f;
  float damage = 0.0f, impact = 0.0f, acs = 0.0f, blast = 0.0f;
  float power = 1.0f;
  Owner owner = Owner::Player;
  WeaponId weapon = WeaponId::Cannon;
  const void* source = nullptr;
};

// ---- spawn parameters --------------------------------------------
struct BulletSpawn {
  Vec3 origin;
  Vec3 dir{0.0f, 0.0f, -1.0f};
  float speed = 620.0f;
  float damage = 0.0f, impact = 0.0f, acs = -1.0f;   // acs < 0 => impact * 0.55
  float maxDist = 720.0f;
  float life = 3.2f;
  /**
   * Ballistic drop, m/s^2 on the velocity.
   *
   * DEVIATION, deliberate: the web build rotated the DIRECTION by
   * `drop` rad/s, which at 620 m/s bends the round ~50 degrees over its
   * flight and is frame-step dependent. ObCore integrates it as gravity
   * on the velocity instead — same "a hair of drop" intent, correct
   * units, and frame-rate independent.
   */
  float drop = 0.0f;
  float radius = 0.0f;
  Owner owner = Owner::Player;
  WeaponId weapon = WeaponId::Rifle;
  const void* source = nullptr;
};

struct MissileSpawn {
  Vec3 origin;
  Vec3 dir{0.0f, 1.0f, 0.0f};
  const void* target = nullptr;
  bool hasAim = false;
  Vec3 aim;                       // fallback guidance point when there is no lock
  Vec3 drift;
  float launchSpeed = 32.0f;
  float speed = cfg::Missile::Speed;
  float accel = cfg::Missile::Accel;
  float turnRate = cfg::Missile::TurnRate;
  float armTime = cfg::Missile::ArmTime;
  float life = 9.0f;
  float damage = cfg::Missile::Damage;
  float impact = cfg::Missile::Impact;
  float acs = cfg::Missile::Acs;
  float blastRadius = cfg::Missile::BlastRadius;
  Owner owner = Owner::Player;
  WeaponId weapon = WeaponId::Missile;
  const void* source = nullptr;
};

struct PlasmaSpawn {
  Vec3 origin;
  Vec3 dir{0.0f, 0.0f, -1.0f};
  float speed = cfg::Cannon::Speed;
  float radius = 1.6f;
  float life = 6.0f;
  float damage = cfg::Cannon::Damage;
  float impact = cfg::Cannon::Impact;
  float acs = cfg::Cannon::Acs;
  float blastRadius = cfg::Cannon::BlastRadius;
  float power = 1.0f;
  Owner owner = Owner::Player;
  WeaponId weapon = WeaponId::Cannon;
  const void* source = nullptr;
};

struct ExplosionSpawn {
  Vec3 position;
  float radius = 10.0f;
  float damage = 0.0f;
  float impact = -1.0f;           // < 0 => damage * 1.2
  float acs = -1.0f;              // < 0 => damage * 0.65
  float power = 1.0f;
  Owner owner = Owner::Player;
  WeaponId weapon = WeaponId::Blast;
  const void* source = nullptr;
};

/**
 * Swept-capsule melee query. `exclude` is a host-owned fixed array the
 * sweep appends to, so one blade swing can never hit the same frame twice.
 */
struct MeleeSweepParams {
  Vec3 from;
  Vec3 to;
  float radius = 3.6f;
  float damage = 0.0f, impact = 0.0f, acs = 0.0f;
  Owner owner = Owner::Player;
  WeaponId weapon = WeaponId::Blade;
  const void* source = nullptr;
  const void** exclude = nullptr;
  int* excludeCount = nullptr;
  int excludeCapacity = 0;
  int maxHits = 4;
};

// ==================================================================
//  The system
// ==================================================================
class Ballistics {
 public:
  static constexpr int MaxBullets = 320;
  static constexpr int MaxMissiles = 48;
  static constexpr int MaxBolts = 12;

  struct Counts {
    int bullets = 0;
    int missiles = 0;
    int bolts = 0;
  };

  Ballistics() = default;

  void Reset();

  bool SpawnBullet(const BulletSpawn& s);
  bool SpawnMissile(const MissileSpawn& s);
  bool SpawnPlasma(const PlasmaSpawn& s);

  /** Detonation + splash. Safe to call from inside a sink callback (depth-guarded). */
  void Explode(const ExplosionSpawn& s, const CombatContext& ctx);

  /** Returns the number of targets bitten. Appends them to `p.exclude`. */
  int MeleeSweep(const MeleeSweepParams& p, const CombatContext& ctx);

  /**
   * Nearest hostile / world intersection along origin + dir * t, t in [0, len].
   * `dir` must be unit. This is the single source of truth for every hit.
   */
  CastHit Cast(const Vec3& origin, const Vec3& dir, float len, Owner owner,
               float pad, const void* ignore, const CombatContext& ctx) const;

  void Update(float dt, const CombatContext& ctx);

  const Counts& GetCounts() const { return counts_; }
  const Bullet* Bullets() const { return bullets_; }
  const GuidedMissile* Missiles() const { return missiles_; }
  const PlasmaBolt* Bolts() const { return bolts_; }
  const Vec3& LastMeleeHit() const { return lastMeleeHit_; }

 private:
  void UpdateBullets(float dt, const CombatContext& ctx);
  void UpdateMissiles(float dt, const CombatContext& ctx);
  void UpdateBolts(float dt, const CombatContext& ctx);

  void DetonateMissile(GuidedMissile& m, const Vec3& at, const Vec3& normal,
                       int targetIndex, const CombatContext& ctx);
  void DetonateBolt(PlasmaBolt& b, const Vec3& at, const Vec3& normal,
                    int targetIndex, const CombatContext& ctx);

  float ApplyHit(CombatTarget& tgt, int index, const Vec3& point, const Vec3& normal,
                 float damage, float impact, float acs, WeaponId weapon,
                 const void* source, Owner owner, bool splash,
                 const CombatContext& ctx) const;
  void WorldHit(const Vec3& point, const Vec3& normal, float impact, WeaponId weapon,
                const void* source, Owner owner, const CombatContext& ctx) const;

  Bullet bullets_[MaxBullets];
  GuidedMissile missiles_[MaxMissiles];
  PlasmaBolt bolts_[MaxBolts];

  int bulletCursor_ = 0;
  int missileCursor_ = 0;
  int boltCursor_ = 0;
  int explodeDepth_ = 0;

  Counts counts_;
  Vec3 lastMeleeHit_;
};

}  // namespace ob

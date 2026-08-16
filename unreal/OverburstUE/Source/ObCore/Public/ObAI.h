// ============================================================
//  ObCore — enemy steering.
//
//  Ported from overburst/src/enemy/enemyAI.js (the MT / drone / turret /
//  heli brains), enemyUnit.js (_body — the hostile integrator), and
//  bossAI.js + bossStage.js (the AC duel). The three hostile AC frames
//  are new work for this target, specified by AC_DESIGN.md section 7.
//
//  ------------------------------------------------------------------
//  WHAT AN AC IS, MECHANICALLY
//
//  An MT walks at you. An AC uses the PLAYER'S movement vocabulary: it
//  quick-boosts to reposition, assault-boosts to close, and hovers. It
//  does not approach — it holds a DUELLING BAND and fights inside it.
//  That difference is the whole reason ObAI is not just "steer toward
//  the target", and it is why the band controller below is two-sided:
//  it backs off as readily as it closes.
//
//  ------------------------------------------------------------------
//  THE TWO BUGS THE WEB BUILD HIT. Both are fixed here BY CONSTRUCTION,
//  not by tuning, and both are measured in unreal/tests/test_ai.cpp.
//
//  (1) LATERAL VELOCITY MUST BE CAPPED, RADIAL MUST NOT.
//      bossAI.js, strafe():
//        "At 78 m/s and a 40 m duelling band a free orbit is 1.5 rad/s —
//         the whole frame in under a second."
//      An AC at full rated speed crosses the entire frame in one quick
//      boost. So the TANGENTIAL component of an AC's velocity is bounded
//      to an ANGULAR rate about the player, while the RADIAL component
//      (closing and backing off) is left at full speed — closing does not
//      move the target across the frame, so capping it would only make the
//      duel sluggish for nothing.
//
//      The web build capped the *wish* vector. That is necessary but not
//      sufficient: a quick boost is an impulse added straight to velocity,
//      so it sails past a wish-space cap. ClampLateral() therefore closes
//      the loop on the INTEGRATED VELOCITY, after impulses, every step.
//      That turns "we scaled the boost power so the sweep is about right"
//      into a hard guarantee the test can assert on.
//
//  (2) THE VIEW AXIS IS A HOLE, NOT A TARGET.
//      bossAI.js:
//        "the chase camera's shoulder offset parks the player's own mech
//         across roughly [-0.38, +0.03] rad, so the view axis is the one
//         bearing where NIGHTJAR is guaranteed to be invisible."
//      A world-geometry line-of-sight ray sails straight through the
//      player's own mech and happily reports a clean sight line, so
//      nothing complains while the most important enemy in the mission
//      stands behind the player's back plate. The player's outline is
//      therefore derived from the camera rig every frame (PlayerSilhouette),
//      padded by the AC's own apparent width at its current range, and
//      treated as hard occlusion: the AC holds a visible LOBE to one side
//      of it and is vetoed from quick-boosting into it.
//
//      The silhouette is DERIVED, not baked: with cfg::Cam's 20.6 m trail
//      and 3.6 m shoulder offset it reproduces the web build's measured
//      [-0.38, +0.03] rad hole, and it stays correct as the duel closes,
//      where the player's mech covers far more of the frame.
//
//  ------------------------------------------------------------------
//  UNITS: METRES and seconds, matching the web build 1:1. The Unreal
//  layer converts once at the component boundary (ob::M_TO_UU).
//
//  WHY THE BEHAVIOUR TUNING LIVES HERE AND NOT IN ObConfig.h
//  Same reason ObMovement.h keeps its feel block: ObConfig.h mirrors
//  overburst/src/config.js 1:1, and that mirroring is what makes it
//  trustworthy. The web build keeps per-kind behaviour tuning in
//  enemy/enemyDefs.js, not in config.js, so its faithful home is this
//  system's header. Same numbers, same place in the structure.
//
//  ZERO Unreal dependencies. No exceptions, no RTTI, no heap in the tick
//  path. Verified by unreal/tests/test_ai.cpp.
// ============================================================
#pragma once

// ObTypes.h first — ObConfig.h depends on <cstdint> coming in ahead of it.
#include "ObTypes.h"
#include "ObConfig.h"
// ObMovement.h is included for mv::EyeHeight ONLY: the chase camera pivots
// on the player's sensor head, so that constant is the honest source of
// truth for where the lens sits. Copying the number here instead would put
// the duel's framing one edit away from silently disagreeing with the rig.
#include "ObMovement.h"
#include "ObWorldQuery.h"

namespace ob {

// ------------------------------------------------------------------
//  Local behaviour constants — mirrors enemyDefs.js and the staging
//  block at the top of bossAI.js / bossStage.js.
// ------------------------------------------------------------------
namespace ai {

// ---- the hostile body (enemyUnit.js _body) ----
constexpr float Gravity = 64.0f;          // m/s^2 — hostiles, not the player
constexpr float Terminal = -145.0f;       // m/s
constexpr float FlyFloor = 6.0f;          // m above ground a flyer never drops below
constexpr float FlyClimbRate = 34.0f;     // m/s cap on hover correction
constexpr float FlyClimbGain = 1.5f;      // proportional gain on altitude error
constexpr float FlyClimbDamp = 3.4f;      // s^-1 smoothing on the climb rate
constexpr float GroundSnap = 0.4f;        // m of tolerance that counts as standing
constexpr float GroundGlue = 16.0f;       // s^-1 smoothing when settling onto a step
constexpr float WallClimbBlock = 3.4f;    // m of step a walker refuses to climb
constexpr float StaggerDrag = 0.86f;      // per-step velocity scale while broken
constexpr float StaggerAuthority = 0.2f;  // wish-speed scale while broken
constexpr float ArenaMargin = 14.0f;      // m inside the radius hostiles are held
constexpr float ArenaBounce = 0.4f;       // velocity kept on touching the containment
constexpr float MaxFrameDt = 0.1f;        // s — the frame clamp, as the web build

// ---- the AC duel: framing (bossAI.js) ----
/** Distance floor on the lateral cap. Without it the linear bound goes to
 *  zero at contact range and an AC can never sidestep out of a corner.
 *  Below this range the ANGULAR guarantee weakens by construction — which
 *  is fine, because every duelling band in the game sits above it. */
constexpr float AngMinRadius = 24.0f;     // m
/** rad past which an AC counts as out of shot entirely. */
constexpr float FrameLost = 1.30f;
/** s an AC may stay unseen before it repositions to somewhere visible. */
constexpr float BlindMax = 1.5f;
/** minimum s between two reposition solves — a servo, not a jitter. */
constexpr float RepickGap = 2.6f;
/** m: while inside the player's outline, never press closer than this. */
constexpr float Standoff = 26.0f;
/** The radial weight the band controller pushes with, relative to the
 *  tangential unit. bossAI.js strafe(): closing outranks orbiting. */
constexpr float RadialWeight = 1.35f;
/** Clearance kept outside the measured silhouette when picking a lobe. */
constexpr float LobeMargin = 0.05f;
/** Hysteresis so the lobe choice cannot chatter across the hole. */
constexpr float LobeSwapIn = 0.06f;
constexpr float LobeSwapOut = 0.14f;
/** Padding added to the player's outline: half the AC's own apparent
 *  width plus a margin, so a shoulder cannot poke out of the player's
 *  silhouette and call itself framed. bossStage.js silhouette(). */
constexpr float SilhouettePad = 1.4f;     // m added to the AC's radius
constexpr float SilhouetteBias = 0.055f;  // rad of flat margin
/** Half-width of the player's chassis as the camera sees it. */
constexpr float PlayerHalfWidth = cfg::Player::Radius + 0.2f;   // 4.4 m, as the web
/** Lens height above the player's feet. cfg::Cam::Height is quoted from
 *  the rig's pivot, which rides at the sensor head. */
constexpr float LensHeight = mv::EyeHeight + cfg::Cam::Height;  // 11.1 m
/** The aim point on the player's mech — centre of mass, the target every
 *  hostile line-of-sight ray is drawn to. enemyDefs.js leadPoint(). */
constexpr float PlayerChest = 5.6f;

// ---- shared brain timing ----
constexpr float SideFlipMin = 1.6f;       // s between idle strafe-direction flips
constexpr float SideFlipMax = 3.0f;
constexpr float LosPollGap = 0.22f;       // s between line-of-sight rays

// ---- cover (enemyAI.js findCover, re-solved against IWorldQuery) ----
/** The web build read the world's collider list directly. IWorldQuery
 *  deliberately does not expose one — ObCore never knows what a level is —
 *  so cover is solved by PROBING: sample a ring of standable candidates
 *  and keep the nearest one that actually breaks line of sight.
 *  PERF: CoverBearings * CoverRadii rays, run ONCE on entering the cover
 *  state, never per frame. Nothing here allocates. */
constexpr int CoverBearings = 12;
constexpr int CoverRadii = 3;
constexpr float CoverRadius[CoverRadii] = {18.0f, 32.0f, 46.0f};
constexpr float CoverMaxStep = 12.0f;     // m of height change a candidate may sit on
constexpr float CoverArrive = 5.0f;       // m that counts as "in cover"
constexpr float CoverTimeout = 3.2f;      // s before the move is abandoned

}  // namespace ai

// ------------------------------------------------------------------
//  The frame, as the AI understands it.
//
//  ObCore has no camera. It has cfg::Cam, which fully determines where
//  the chase rig sits relative to the player, and that is all the duel
//  needs: bearings are quoted off the LENS, not off the player's feet,
//  because those two origins are ~20 m apart and disagree about what is
//  on screen.
// ------------------------------------------------------------------
struct ViewFrame {
  Vec3 lensPos;
  float axisX = 0.0f, axisZ = -1.0f;   // unit view direction, XZ
  float trail = 0.0f;                  // m from the lens to the player

  /** Signed angle in the XZ plane from the view axis to (x, z). */
  float Bearing(float x, float z) const;
};

/** Where the chase camera sits for a player at `pos` facing `yaw`. */
ViewFrame MakeViewFrame(const Vec3& playerPos, float playerYaw);

/**
 * The angular slot the player's OWN MECH eats out of the frame, widened
 * by the observing AC's apparent width at `acDist`.
 *
 * `lo`/`hi` are the bearings an AC must stay OUTSIDE of. This is bug (2)
 * in one function: everything about the duel staging is downstream of it.
 */
struct Silhouette {
  float off = 0.0f;    // bearing of the player's own mech from the lens
  float half = 0.0f;   // half-width of the chassis at that range
  float lo = 0.0f;     // the hole, low edge
  float hi = 0.0f;     // ...and high edge

  bool Contains(float bearing) const { return bearing > lo && bearing < hi; }
};

Silhouette PlayerSilhouette(const ViewFrame& view, const Vec3& playerPos, float acDist,
                            float acRadius);

// ------------------------------------------------------------------
//  What the AI is allowed to know about the player. The host fills this
//  once per frame and every agent reads the same copy.
// ------------------------------------------------------------------
struct AiPerception {
  Vec3 pos;
  Vec3 vel;
  float yaw = 0.0f;
  /** Player aim direction, unit. Drives KITE's "boosts out of your
   *  reticle when you commit" — an AC that ignores where the gun is
   *  pointing is not duelling, it is orbiting. */
  Vec3 aimDir{0.0f, 0.0f, -1.0f};
  bool alive = true;

  float SpeedXZ() const { return vel.LengthXZ(); }
};

// ------------------------------------------------------------------
//  Everything the host reacts to this step: VFX, weapons, audio, HUD.
//  Plain flags, cleared at the top of every Step — no allocation, no
//  delegate, no event bus in the tick path. Same contract as MoveEvents.
// ------------------------------------------------------------------
struct AiEvents {
  bool quickBoosted = false;
  float qbDirX = 0.0f, qbDirZ = 0.0f, qbPower = 0.0f;
  /** A quick boost was WANTED and refused because it would have carried
   *  the AC into the player's silhouette. The duel's most important veto. */
  bool qbVetoed = false;

  bool assaultBoosted = false;
  bool hovering = false;

  bool firedPrimary = false;   // rifle round / chin gun
  bool firedHeavy = false;     // shell, plasma, beam tick
  bool firedMissile = false;
  bool bladeSwing = false;

  bool phaseChanged = false;
  int phase = 0;

  bool alerted = false;
  bool enteredCover = false;
  bool repositioned = false;

  void Clear();
};

// ------------------------------------------------------------------
//  Per-kind behaviour tuning. Mirrors enemyDefs.js DEF{}; the three AC
//  rows are authored for this target against AC_DESIGN.md section 7.
// ------------------------------------------------------------------
struct AiProfile {
  float keepMin, keepMax;   // the band the unit holds, m
  float tooClose;           // m at which a non-AC backs off outright
  float fireRange;          // m
  float sight;              // m at which it wakes up
  float turn;               // rad/s chassis yaw rate
  float accel;              // s^-1 — damp lambda on the wish velocity
  float hoverY;             // m above ground for flyers; 0 = walker
  float eye;                // m — sensor height, origin of LOS rays
  float radius;             // m — chassis half-width
  bool  flying;

  // firing rhythm
  float windup;             // s of visible tell before anything hurts
  int   burst;
  float burstGap;
  float recover;

  // --- AC only (zero for everything else) ---
  float angMax;             // rad/s lateral orbit cap — bug (1)
  float angEscape;          // ...suspended to this while inside the hole
  float qbCooldown;         // s between quick boosts
  float qbPower;            // m/s impulse injected
  float speedMul;           // fraction of rated speed the band controller uses
  float bearMin;            // rad — the narrow end of the duelling lobe
  float bearEdge;           // rad — ...and the wide end
  float hoverHold;          // s it hovers to stabilise before a heavy shot
};

const AiProfile& Profile(cfg::EnemyKind kind);

// ------------------------------------------------------------------
//  Brain states. One enum across every kind: the non-AC brains use the
//  first block, the AC brains the second. Keeping them in one enum lets
//  the HUD and the animation layer switch on a single value.
// ------------------------------------------------------------------
enum class AiState : uint8_t {
  Idle,        // unaware, holding its post
  Engage,      // in the band, looking for an opening
  Windup,      // the tell
  Burst,       // firing
  Recover,     // reload beat
  Cover,       // moving to a spot that breaks line of sight
  Stagger,     // ACS blown, no authority
  // --- AC ---
  Stalk,       // holding the duelling band
  Reposition,  // boosting to somewhere the frame can see it
  Shift,       // the beat between boss phases
  ChargeUp,    // assault-boost wind-up
  ChargeGo,    // ...committed
  BladeUp,
  BladeGo,
  Count
};

const char* AiStateName(AiState s);

// ------------------------------------------------------------------
//  One hostile: steering, brain state and body, in one object.
//
//  The Unreal layer's AObEnemyAC / AObEnemyMT tick this and apply the
//  resulting transform. It owns no gameplay maths of its own — which is
//  the whole point of the ObCore split.
// ------------------------------------------------------------------
struct AiAgent {
  // ---- identity ----
  cfg::EnemyKind kind = cfg::EnemyKind::MT;
  int id = 0;

  // ---- body ----
  Vec3 pos;
  Vec3 vel;
  float yaw = 0.0f;
  float aimYaw = 0.0f;
  float aimPitch = 0.0f;
  bool grounded = true;
  bool flying = false;

  // ---- health / gauge, fed by the host's damage model ----
  float ap = 0.0f;
  float apMax = 0.0f;
  bool staggered = false;

  // ---- awareness ----
  bool alert = false;
  bool los = false;            // last polled line of sight to the player
  float dist = 0.0f;           // horizontal range to the player, cached

  // ---- the duelling band. Defaults from the profile; the host (or a
  //      test) may order a different one. This is what "hold a 30-50 m
  //      band" means as an instruction. ----
  float bandMin = 0.0f;
  float bandMax = 0.0f;
  /** Latched radial direction. Released at the band centre, so the AC
   *  converges INTO the band instead of buzzing along its edge. */
  int radialLatch = 0;

  // ---- brain ----
  AiState state = AiState::Idle;
  float stateT = 0.0f;
  int phase = 0;               // boss only: 0, 1, 2
  Rng rng;

  // ---- framing (AC only) ----
  float bearing = 0.0f;        // signed offset from the view axis
  int lobe = 1;                // which side of the hole it duels in
  int side = 1;                // strafe direction, +1 or -1
  int toward = 1;              // ...and which way is back toward the lobe
  bool hidden = false;         // inside the player's own outline
  float drift = 0.0f;          // how hard the lobe band is being violated
  float blindT = 0.0f;         // s spent unseen
  float repickT = 0.0f;
  float markX = 0.0f, markZ = 0.0f;   // the spot a reposition is servoing onto
  bool hovering = false;
  float hoverT = 0.0f;

  // ---- internal timers ----
  float sideT = 0.0f;
  float fireCd = 0.0f;
  float qbCd = 0.0f;
  float shotT = 0.0f;
  int rounds = 0;
  float losT = 0.0f;
  /** s until the next attack may be selected — the duel's cadence. */
  float gap = 0.0f;
  /** KITE: s the player's reticle has been held on this AC. The fuse for
   *  "boosts out of your reticle when you commit". */
  float aimT = 0.0f;
  /** BULWARK: s the player has been effectively stationary. The fuse for
   *  "punishes standing still". */
  float stillT = 0.0f;
  /** s of "I have been shot recently", set by OnDamaged(). An MT that is
   *  under fire seeks cover deterministically rather than on a coin flip. */
  float underFireT = 0.0f;
  /** The attack currently selected (an internal Move id). */
  uint8_t move = 0;
  float coverX = 0.0f, coverZ = 0.0f;
  float committedX = 0.0f, committedZ = 0.0f;   // locked dash heading
  bool committed = false;                        // velocity is scripted, not steered

  // ---- steering scratch, written by the brain, consumed by the body ----
  float wishX = 0.0f, wishZ = 0.0f, wishSpeed = 0.0f;

  AiEvents events;

  /** Place an agent of `kind` and give it its default band. */
  void Spawn(cfg::EnemyKind k, const Vec3& where, int agentId);

  /** Order a duelling band explicitly. Both ends are enforced. */
  void SetBand(float minRange, float maxRange);

  /** The host calls this when the agent takes a hit. It wakes the unit and
   *  arms the "under fire" window that sends an MT looking for cover. */
  void OnDamaged() {
    alert = true;
    underFireT = 3.0f;
  }

  /**
   * Advance one frame: think, then integrate.
   *
   * `dt` is clamped to ai::MaxFrameDt, matching the web build, so a
   * hitching host cannot teleport a hostile through a blast wall.
   * Calls into `world` only through IWorldQuery.
   */
  void Step(const AiPerception& player, const IWorldQuery& world, float dt);

  /** Rated speed for this kind, from ObConfig. */
  float Speed() const { return cfg::Enemy(kind).speed; }
  const AiProfile& Prof() const { return Profile(kind); }
  bool IsAC() const { return cfg::Enemy(kind).isAC; }

  Vec3 EyePos() const { return Vec3{pos.x, pos.y + Prof().eye, pos.z}; }

  /**
   * Signed angular rate about the player, rad/s, from the CURRENT
   * velocity. This is the quantity bug (1) bounds, and the quantity
   * test_ai.cpp measures.
   */
  float AngularRate(const Vec3& playerPos) const;

 private:
  // ---- steering primitives (enemyUnit.js) ----
  void MoveDir(float dx, float dz, float mul);
  float MoveTo(float x, float z, float mul);
  void Hold();
  void FaceTo(float x, float z, float dt, float rateMul);
  void Impulse(float dx, float dz, float power, float up);

  // ---- the AC band controller ----
  /** -1 back off, 0 hold, +1 close. Two-sided ON PURPOSE: a close-only
   *  term lets every recovery walk the range up and never walk it back.
   *  Latched, so it converges into the band rather than onto its edge. */
  int BandRadial();
  /** Tangential + radial steering with the lateral cap. Bug (1), wish side. */
  void Strafe(float nx, float nz, int radial, float mul);
  /** Bug (1), velocity side: bound the orbit rate after impulses. */
  void ClampLateral(const Vec3& playerPos);
  /** Bug (2): pick and hold a visible lobe off the view axis. */
  void UpdateFraming(const ViewFrame& view, const AiPerception& player);
  /** Fire a quick boost, unless it would carry us into the hole. */
  bool TryQuickBoost(float dx, float dz, float power, const ViewFrame& view,
                     const AiPerception& player);

  // ---- brains ----
  void BrainMT(const AiPerception& player, const IWorldQuery& world, float dt);
  void BrainDrone(const AiPerception& player, float dt);
  void BrainTurret(const AiPerception& player, float dt);
  void BrainHeli(const AiPerception& player, float dt);
  void BrainAC(const AiPerception& player, const IWorldQuery& world, float dt);

  bool SeekCover(const AiPerception& player, const IWorldQuery& world);
  bool StaggerGate();
  void Body(const Vec3& playerPos, const IWorldQuery& world, float dt);
};

}  // namespace ob

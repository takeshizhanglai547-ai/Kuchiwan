// ============================================================
//  ObCore — enemy steering. See ObAI.h for the contract and for the
//  two web-build bugs this file is built around.
// ============================================================
#include "ObAI.h"

namespace ob {

namespace {

// ------------------------------------------------------------------
//  Per-kind behaviour tuning.
//
//  The MT / drone / turret / heli / pylon rows are enemyDefs.js DEF{}
//  transcribed. The three AC rows are new work for this target: they are
//  derived from AC_DESIGN.md section 7 and from the loadout ranges in
//  ObConfig.h, and the reasoning for each is written down next to it,
//  because "it felt right" is not a thing a later reader can check.
// ------------------------------------------------------------------
constexpr AiProfile kProfiles[static_cast<int>(cfg::EnemyKind::Count)] = {
    // ---- MT-A21 SLAGHAND — enemyDefs.js DEF.mt -------------------
    {/*keepMin*/ 54.0f, /*keepMax*/ 108.0f, /*tooClose*/ 44.0f, /*fireRange*/ 168.0f,
     /*sight*/ 330.0f, /*turn*/ 2.3f, /*accel*/ 4.6f, /*hoverY*/ 0.0f, /*eye*/ 4.4f,
     /*radius*/ 3.0f, /*flying*/ false,
     /*windup*/ 0.50f, /*burst*/ 4, /*burstGap*/ 0.125f, /*recover*/ 1.90f,
     /*angMax*/ 0.0f, /*angEscape*/ 0.0f, /*qbCooldown*/ 0.0f, /*qbPower*/ 0.0f,
     /*speedMul*/ 1.0f, /*bearMin*/ 0.0f, /*bearEdge*/ 0.0f, /*hoverHold*/ 0.0f},

    // ---- AD-08 CINDER — DEF.drone --------------------------------
    {26.0f, 58.0f, 0.0f, 130.0f, 300.0f, 4.2f, 5.4f, 15.0f, 1.2f, 1.9f, true,
     0.26f, 3, 0.10f, 1.05f,
     0.0f, 0.0f, 0.0f, 0.0f, 1.0f, 0.0f, 0.0f, 0.0f},

    // ---- AT-44 PICKET — DEF.turret. Emplaced: no band, no legs. --
    {0.0f, 0.0f, 0.0f, 240.0f, 300.0f, 1.15f, 4.0f, 0.0f, 2.7f, 2.5f, false,
     1.15f, 1, 0.085f, 1.75f,
     0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f},

    // ---- RH-19 KESTREL — DEF.heli --------------------------------
    {78.0f, 145.0f, 0.0f, 210.0f, 360.0f, 2.4f, 3.2f, 42.0f, 2.0f, 3.6f, true,
     0.85f, 4, 0.16f, 2.40f,
     0.0f, 0.0f, 0.0f, 0.0f, 1.0f, 0.0f, 0.0f, 0.0f},

    // ---- IB-C10 COOLANT PYLON — DEF.pylon. Inert by design. ------
    {0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 9.0f, 5.0f, false,
     0.0f, 0, 0.0f, 0.0f,
     0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f},

    // ---- SHRIKE (AcLight) ----------------------------------------
    //  "closes to blade range, never stops moving, constant quick
    //   boosting" — AC_DESIGN.md 7.
    //  Band 12-30 m brackets cfg::Blade::Range (26 m): it lives inside
    //  its own blade reach and is therefore always a threat, which is
    //  what makes it "the one that teaches you to lead your shots".
    //  angMax 0.90 rad/s is the loosest cap in the roster — SHRIKE is
    //  meant to be frantic — but it is still a cap, because 96 m/s at
    //  20 m is 4.8 rad/s and would cross the frame in a third of a
    //  second. What it keeps is the RADIAL speed: uncapped, so it darts
    //  in and out at full rate rather than smearing sideways.
    //  qbCooldown 0.42 s is the PLAYER's cfg::Player::QbReload — the
    //  frame that mirrors the player's vocabulary most closely.
    {/*keepMin*/ 12.0f, /*keepMax*/ 30.0f, /*tooClose*/ 0.0f, /*fireRange*/ 120.0f,
     /*sight*/ 420.0f, /*turn*/ 3.6f, /*accel*/ 6.2f, /*hoverY*/ 0.0f, /*eye*/ 6.4f,
     /*radius*/ 3.4f, /*flying*/ false,
     /*windup*/ 0.24f, /*burst*/ 3, /*burstGap*/ 0.10f, /*recover*/ 0.62f,
     /*angMax*/ 0.90f, /*angEscape*/ 2.4f, /*qbCooldown*/ 0.42f, /*qbPower*/ 92.0f,
     /*speedMul*/ 1.0f, /*bearMin*/ 0.30f, /*bearEdge*/ 0.66f, /*hoverHold*/ 0.0f},

    // ---- KITE (AcMid) --------------------------------------------
    //  "mid-range trading, strafes, boosts out of your reticle when you
    //   commit" — AC_DESIGN.md 7. The baseline duellist.
    //  Band 38-68 m is rifle country: inside cfg::Rifle's useful range
    //  for both parties, outside blade reach, so the exchange is a trade.
    //  The reticle dodge is the signature: it watches the player's aim
    //  axis, and once the player has held it for ReticleFuse seconds it
    //  spends a quick boost getting off that line.
    {38.0f, 68.0f, 0.0f, 190.0f, 420.0f, 3.0f, 5.4f, 0.0f, 7.4f, 4.0f, false,
     0.34f, 4, 0.115f, 0.95f,
     /*angMax*/ 0.55f, 2.4f, /*qbCooldown*/ 0.80f, /*qbPower*/ 78.0f,
     /*speedMul*/ 0.92f, 0.34f, 0.64f, 0.0f},

    // ---- BULWARK (AcHeavy) ---------------------------------------
    //  "barely moves, hovers to stabilise, punishes standing still with
    //   heavy shells" — AC_DESIGN.md 7. A tetrapod: no waist pinch, no
    //   dodging, all gun.
    //  speedMul 0.28 and angMax 0.16 rad/s are the "barely moves" in
    //  numbers — at 70 m that is 11 m/s of drift. It hovers before a
    //  heavy shot (hoverHold) because a tetrapod on thrusters is a
    //  stable firing platform, and the hover is the tell.
    {55.0f, 90.0f, 0.0f, 240.0f, 440.0f, 1.6f, 3.4f, 0.0f, 6.2f, 5.6f, false,
     0.70f, 2, 0.30f, 1.60f,
     /*angMax*/ 0.16f, 1.2f, /*qbCooldown*/ 2.60f, /*qbPower*/ 46.0f,
     /*speedMul*/ 0.28f, 0.34f, 0.62f, /*hoverHold*/ 0.85f},

    // ---- NIGHTJAR (Boss) — enemyDefs.js DEF.boss -----------------
    //  keepMin/keepMax 32/44 and the framing band are the web build's
    //  measured apparent-size budget, transcribed. angMax 0.44 rad/s and
    //  angEscape 2.4 are bossAI.js ANG_MAX / ANG_ESCAPE verbatim.
    {32.0f, 44.0f, 0.0f, 300.0f, 460.0f, 3.1f, 5.0f, 0.0f, 11.0f, 5.0f, false,
     0.42f, 4, 0.115f, 1.05f,
     /*angMax*/ 0.44f, 2.4f, /*qbCooldown*/ 1.55f, /*qbPower*/ 64.0f,
     /*speedMul*/ 1.0f, /*bearMin*/ 0.36f, /*bearEdge*/ 0.62f, 0.0f},
};

// ---- NIGHTJAR phase tables (bossAI.js) ---------------------------
/** seconds between attacks, per phase */
constexpr float kBossGap[3] = {1.35f, 1.00f, 0.62f};
/** quick-boost cooldown, per phase */
constexpr float kBossQbCd[3] = {1.55f, 1.20f, 0.85f};
/** AP fraction at which each phase begins */
constexpr float kBossPhase2 = 0.66f;
constexpr float kBossPhase3 = 0.33f;
/** the reconfiguration beat between phases */
constexpr float kShiftTime = 0.85f;

/** The distinct movesets. Phase 0 is a gunfight, phase 1 adds ordnance
 *  and the assault-boost charge, phase 2 adds the blade and the sweep. */
enum Move : uint8_t { MoveRifle, MoveMissile, MoveCharge, MoveBlade, MoveSweep, MoveBurstQb };
constexpr uint8_t kMoves0[] = {MoveRifle, MoveRifle, MoveRifle, MoveBurstQb};
constexpr uint8_t kMoves1[] = {MoveRifle, MoveMissile, MoveCharge, MoveRifle, MoveMissile};
constexpr uint8_t kMoves2[] = {MoveBlade, MoveRifle, MoveSweep, MoveCharge, MoveBlade, MoveMissile};
constexpr const uint8_t* kMoveList[3] = {kMoves0, kMoves1, kMoves2};
constexpr int kMoveCount[3] = {4, 5, 6};

// ---- AC feel constants that are local to one frame's personality ----
/** KITE: how far off the player's aim axis still counts as "in the
 *  reticle", and how long the player must hold it before KITE leaves. */
constexpr float kReticleCos = 0.985f;   // ~0.174 rad half-angle
constexpr float kReticleFuse = 0.42f;   // s
/** BULWARK: player speed under this reads as "standing still", and how
 *  long it must persist before the heavy shell is the answer. */
constexpr float kStillSpeed = 6.0f;     // m/s
constexpr float kStillFuse = 1.20f;     // s
/** SHRIKE: the wish-speed floor that makes "never stops moving" true
 *  rather than aspirational. Fraction of rated speed. */
constexpr float kShrikeFloor = 0.22f;
/** SHRIKE: seconds between blade commitments. Must exceed the blade cycle
 *  itself (~1.4 s) by a real stalking beat, or the frame degenerates into
 *  an uninterruptible blade loop. */
constexpr float kShrikeBladeGap = 2.2f;

/** The dashes. bossAI.js DEF.boss.charge / .blade. */
constexpr float kChargeWindup = 0.72f, kChargeDash = 1.05f, kChargeSpeed = 138.0f;
constexpr float kChargeRadius = 12.0f, kChargeRecover = 1.15f;
constexpr float kBladeWindup = 0.52f, kBladeDash = 0.42f, kBladeSpeed = 152.0f;
constexpr float kBladeRecover = 0.92f;

/** Candidate sweep for a reposition. Wide-and-near first: those are the
 *  bearings that make an AC big in frame. bossStage.js MARK_BEAR/RANGE. */
constexpr float kMarkBear[5] = {0.58f, 0.52f, 0.46f, 0.40f, 0.34f};
constexpr float kMarkRange[3] = {38.0f, 34.0f, 43.0f};

inline float Hypot2(float x, float z) { return std::sqrt(x * x + z * z); }

}  // namespace

const AiProfile& Profile(cfg::EnemyKind kind) {
  const int i = static_cast<int>(kind);
  const int n = static_cast<int>(cfg::EnemyKind::Count);
  return kProfiles[(i >= 0 && i < n) ? i : 0];
}

const char* AiStateName(AiState s) {
  switch (s) {
    case AiState::Idle: return "idle";
    case AiState::Engage: return "engage";
    case AiState::Windup: return "windup";
    case AiState::Burst: return "burst";
    case AiState::Recover: return "recover";
    case AiState::Cover: return "cover";
    case AiState::Stagger: return "stagger";
    case AiState::Stalk: return "stalk";
    case AiState::Reposition: return "reposition";
    case AiState::Shift: return "shift";
    case AiState::ChargeUp: return "charge_up";
    case AiState::ChargeGo: return "charge_go";
    case AiState::BladeUp: return "blade_up";
    case AiState::BladeGo: return "blade_go";
    default: return "?";
  }
}

// ==================================================================
//  The frame
// ==================================================================
float ViewFrame::Bearing(float x, float z) const {
  const float dx = x - lensPos.x;
  const float dz = z - lensPos.z;
  if (std::fabs(dx) + std::fabs(dz) < 1e-4f) return 0.0f;
  return std::atan2(axisX * dz - axisZ * dx, axisX * dx + axisZ * dz);
}

ViewFrame MakeViewFrame(const Vec3& playerPos, float playerYaw) {
  ViewFrame v;
  const Vec3 fwd = ForwardFromYaw(playerYaw);
  const Vec3 right = RightFromYaw(playerYaw);
  // The chase rig trails the player by cfg::Cam::Dist and sits offset over
  // one shoulder. That shoulder offset is the whole reason the view axis is
  // a hole rather than a centreline: it parks the player's own mech OFF
  // centre, leaving one wide clear lobe and one narrow one.
  v.lensPos = Vec3{playerPos.x - fwd.x * cfg::Cam::Dist + right.x * cfg::Cam::Shoulder,
                   playerPos.y + ai::LensHeight,
                   playerPos.z - fwd.z * cfg::Cam::Dist + right.z * cfg::Cam::Shoulder};
  v.axisX = fwd.x;
  v.axisZ = fwd.z;
  v.trail = Hypot2(playerPos.x - v.lensPos.x, playerPos.z - v.lensPos.z);
  return v;
}

Silhouette PlayerSilhouette(const ViewFrame& view, const Vec3& playerPos, float acDist,
                            float acRadius) {
  Silhouette s;
  const float dx = playerPos.x - view.lensPos.x;
  const float dz = playerPos.z - view.lensPos.z;
  const float d = Hypot2(dx, dz);
  if (d < 1e-3f) return s;

  s.off = std::atan2(view.axisX * dz - view.axisZ * dx, view.axisX * dx + view.axisZ * dz);
  s.half = std::atan2(ai::PlayerHalfWidth, d > 4.0f ? d : 4.0f);

  // Widen by the AC's OWN apparent half-width at its range, so the
  // exclusion covers its whole body and not just its centre — a shoulder
  // poking out of the player's outline is not "framed".
  const float lensD = acDist + view.trail;
  const float own = std::atan2(acRadius + ai::SilhouettePad, lensD > 10.0f ? lensD : 10.0f) +
                    ai::SilhouetteBias;
  s.lo = s.off - s.half - own;
  s.hi = s.off + s.half + own;
  return s;
}

// ==================================================================
void AiEvents::Clear() {
  quickBoosted = false;
  qbDirX = qbDirZ = qbPower = 0.0f;
  qbVetoed = false;
  assaultBoosted = false;
  hovering = false;
  firedPrimary = firedHeavy = firedMissile = bladeSwing = false;
  phaseChanged = false;
  alerted = enteredCover = repositioned = false;
}

// ==================================================================
//  Lifecycle
// ==================================================================
void AiAgent::Spawn(cfg::EnemyKind k, const Vec3& where, int agentId) {
  const AiProfile& pr = Profile(k);
  kind = k;
  id = agentId;
  pos = where;
  vel.Zero();
  yaw = 0.0f;
  aimYaw = 0.0f;
  aimPitch = 0.0f;
  grounded = !pr.flying;
  flying = pr.flying;

  ap = apMax = cfg::Enemy(k).ap;
  staggered = false;
  alert = false;
  los = false;
  dist = 0.0f;

  bandMin = pr.keepMin;
  bandMax = pr.keepMax;

  state = AiState::Idle;
  stateT = 0.0f;
  phase = 0;
  // Seeded off the id so a hostile replays identically run to run. No
  // std::rand anywhere in ObCore: a test that cannot be replayed cannot
  // be trusted.
  rng = Rng(static_cast<uint32_t>(0x9E3779B9u + 2654435761u * static_cast<uint32_t>(agentId + 1)));

  bearing = 0.0f;
  lobe = 1;
  side = 1;
  toward = 1;
  hidden = false;
  drift = 0.0f;
  blindT = 0.0f;
  repickT = 0.0f;
  markX = where.x;
  markZ = where.z;
  hovering = false;
  hoverT = 0.0f;

  sideT = 0.0f;
  fireCd = 0.0f;
  qbCd = 0.0f;
  shotT = 0.0f;
  rounds = 0;
  losT = 0.0f;
  gap = 0.0f;
  aimT = 0.0f;
  stillT = 0.0f;
  underFireT = 0.0f;
  move = 0;
  coverX = where.x;
  coverZ = where.z;
  committedX = 0.0f;
  committedZ = 0.0f;
  committed = false;

  wishX = wishZ = wishSpeed = 0.0f;
  events.Clear();
}

void AiAgent::SetBand(float minRange, float maxRange) {
  bandMin = minRange < maxRange ? minRange : maxRange;
  bandMax = minRange < maxRange ? maxRange : minRange;
}

// ==================================================================
//  Steering primitives — enemyUnit.js moveDir / moveTo / hold / faceTo
// ==================================================================
void AiAgent::MoveDir(float dx, float dz, float mul) {
  const float d = Hypot2(dx, dz);
  if (d < 1e-4f) {
    Hold();
    return;
  }
  wishX = dx / d;
  wishZ = dz / d;
  wishSpeed = Speed() * mul * (staggered ? ai::StaggerAuthority : 1.0f);
}

float AiAgent::MoveTo(float x, float z, float mul) {
  const float dx = x - pos.x;
  const float dz = z - pos.z;
  const float d = Hypot2(dx, dz);
  if (d < 0.4f) {
    Hold();
    return d;
  }
  wishX = dx / d;
  wishZ = dz / d;
  wishSpeed = Speed() * mul * (staggered ? ai::StaggerAuthority : 1.0f);
  return d;
}

void AiAgent::Hold() { wishX = wishZ = wishSpeed = 0.0f; }

void AiAgent::FaceTo(float x, float z, float dt, float rateMul) {
  const float want = std::atan2(-(x - pos.x), -(z - pos.z));
  const float rate = Prof().turn * rateMul * dt;
  yaw += Clamp(AngleDelta(yaw, want), -rate, rate);
}

void AiAgent::Impulse(float dx, float dz, float power, float up) {
  const float d = Hypot2(dx, dz);
  if (d < 1e-4f) return;
  vel.x += (dx / d) * power;
  vel.z += (dz / d) * power;
  if (up > 0.0f) {
    vel.y += up;
    grounded = false;
  }
}

// ==================================================================
//  The AC duelling band
// ==================================================================
/**
 * The one range term: -1 back off, 0 hold, +1 close.
 *
 * TWO-SIDED ON PURPOSE. bossAI.js: the firing states used to run a
 * close-only variant that could not back off, "which is how the duel
 * settled at 50-54 m and stayed there — every recovery walked the range
 * up and nothing walked it back down".
 *
 * WITH HYSTERESIS, which the web build did not have. A bare
 * (d < min | d > max) test is a bang-bang controller whose switching
 * surface IS the band edge, so it does not converge INTO the band — it
 * converges ONTO the boundary and chatters across it, flipping the
 * radial wish every frame. Measured before this latch was added: ordered
 * to hold 30-50 m the AC settled at 49.98 m and sat there.
 *
 * So leaving the band latches a direction, and the latch is only released
 * at the band CENTRE. The result is a slow limit cycle about the middle
 * of the band instead of a buzz along its edge.
 */
int AiAgent::BandRadial() {
  const float centre = (bandMin + bandMax) * 0.5f;
  if (dist > bandMax) radialLatch = 1;
  else if (dist < bandMin) radialLatch = -1;
  else if (radialLatch > 0 && dist <= centre) radialLatch = 0;
  else if (radialLatch < 0 && dist >= centre) radialLatch = 0;
  return radialLatch;
}

/**
 * BUG (1), WISH SIDE. bossAI.js strafe(), ported.
 *
 * The wish vector is built in a (tangential, radial) basis and the
 * TANGENTIAL weight is scaled so that, after normalisation, the lateral
 * fraction of the resulting unit direction is at most `r` — the ratio of
 * the permitted lateral speed to the speed we are actually asking for.
 *
 *   lateral fraction = wt / sqrt(wt^2 + wr^2) <= r
 *     =>  wt = |wr| * r / sqrt(1 - r^2)
 *
 * With no radial component there is nothing to trade against, so the whole
 * move is slowed instead. The radial weight is never touched: closing and
 * backing off do not move the AC across the frame.
 */
void AiAgent::Strafe(float nx, float nz, int radial, float mul) {
  const AiProfile& pr = Prof();
  float wr = static_cast<float>(radial) * ai::RadialWeight;

  // Never press INTO the hole. Inside the player's outline the AC is
  // invisible at any range, and closing only makes that worse.
  if (hidden && wr > 0.0f && dist < ai::Standoff + 14.0f) wr = 0.0f;

  const float full = Speed() * mul > 1e-3f ? Speed() * mul : 1e-3f;
  const float radiusForCap = dist > ai::AngMinRadius ? dist : ai::AngMinRadius;
  const float latMax = (hidden ? pr.angEscape : pr.angMax) * radiusForCap;
  const float r = latMax / full < 1.0f ? latMax / full : 1.0f;

  float wt = 1.0f;
  float m = mul;
  if (r < 0.995f) {
    if (radial == 0) {
      m = mul * r;   // pure orbit: there is nothing to trade, so slow down
    } else {
      const float denom = std::sqrt(1.0f - r * r);
      const float want = denom > EPS ? (std::fabs(wr) * r) / denom : 1.0f;
      wt = want < 1.0f ? want : 1.0f;
    }
  }

  const float s = static_cast<float>(side);
  const float tx = -nz * s * wt + nx * wr;
  const float tz = nx * s * wt + nz * wr;
  if (std::fabs(tx) + std::fabs(tz) < 1e-4f) {
    Hold();
    return;
  }
  MoveDir(tx, tz, m);
}

/**
 * BUG (1), VELOCITY SIDE — the half the web build did not have.
 *
 * A quick boost is an impulse added straight to velocity, so it sails
 * straight past a wish-space cap: that is exactly how "an AC orbiting at
 * speed crosses the whole frame in one quick boost" happens. Closing the
 * loop on the integrated velocity turns the bound into a guarantee.
 *
 * Decompose velocity into radial (player -> AC) and tangential, clamp the
 * tangential magnitude to angMax * radius, and rebuild. The radial
 * component is passed through untouched at full speed.
 *
 * A scripted dash (charge / blade rush) is exempt: it owns velocity
 * outright, is heavily telegraphed, and is over in under a second.
 */
void AiAgent::ClampLateral(const Vec3& playerPos) {
  const AiProfile& pr = Prof();
  if (pr.angMax <= 0.0f) return;   // not an AC
  if (committed) return;

  float rx = pos.x - playerPos.x;
  float rz = pos.z - playerPos.z;
  const float d = Hypot2(rx, rz);
  if (d < EPS) return;
  rx /= d;
  rz /= d;

  const float tx = -rz;   // tangential unit, right-handed about +Y
  const float tz = rx;
  const float radialV = vel.x * rx + vel.z * rz;
  const float latV = vel.x * tx + vel.z * tz;

  const float radiusForCap = d > ai::AngMinRadius ? d : ai::AngMinRadius;
  const float cap = (hidden ? pr.angEscape : pr.angMax) * radiusForCap;
  if (std::fabs(latV) <= cap) return;

  const float clamped = latV > 0.0f ? cap : -cap;
  vel.x = rx * radialV + tx * clamped;
  vel.z = rz * radialV + tz * clamped;
}

/**
 * BUG (2). The view axis is a HOLE, not a target.
 *
 * The player's own mech is measured from the camera rig every frame and
 * padded by this AC's apparent width. The AC picks a LOBE — the clear
 * angular band to one side of that hole — and duels inside it. `side` is
 * the strafe direction that walks the bearing back toward the lobe;
 * `toward` is the same answer for a quick boost, which sweeps far more
 * bearing than a strafe does and must never be pointed by a coin flip.
 */
void AiAgent::UpdateFraming(const ViewFrame& view, const AiPerception& player) {
  const AiProfile& pr = Prof();
  bearing = view.Bearing(pos.x, pos.z);
  const Silhouette sil = PlayerSilhouette(view, player.pos, dist, pr.radius);

  const float bearMin = pr.bearMin;
  const float edge = pr.bearEdge;
  const float lift = sil.hi + ai::LobeMargin > bearMin ? sil.hi + ai::LobeMargin : bearMin;
  const float drop = sil.lo - ai::LobeMargin < -bearMin ? sil.lo - ai::LobeMargin : -bearMin;

  // The hole grows as the duel closes — at 18 m it spans nearly 0.8 rad —
  // and it is not centred, so the NARROW lobe can be squeezed out of
  // existence entirely while the wide one is still perfectly good. A lobe
  // with no room in it is not somewhere to duel: it is a guarantee of
  // being hidden, which is the bug this whole mechanism exists to stop.
  // So a collapsed lobe is never chosen, and the AC lives in the one that
  // has space. (The wide lobe is the right-hand one, because the chase
  // rig's shoulder offset pushes the player's outline to the left.)
  const bool leftUsable = drop > -edge + ai::LobeMargin;
  const bool rightUsable = lift < edge - ai::LobeMargin;
  if (!leftUsable && rightUsable) lobe = 1;
  else if (!rightUsable && leftUsable) lobe = -1;
  else if (leftUsable && rightUsable) {
    // lobe hysteresis, so the choice cannot chatter across the hole
    if (lobe > 0 && bearing < drop - ai::LobeSwapIn) lobe = -1;
    else if (lobe < 0 && bearing > drop + ai::LobeSwapOut) lobe = 1;
  }

  hidden = sil.Contains(bearing);
  if (hidden) {
    // Inside the player's outline there is no band to hold — the only
    // question is which way out is shorter, biased toward the wide lobe.
    const int want = (bearing - sil.lo) < (sil.hi - bearing) * 0.55f ? 1 : -1;
    side = want;
    if (sideT < 0.5f) sideT = 0.5f;   // do not let the idle flip undo it
    lobe = want > 0 ? -1 : 1;
    drift = 1.0f;                     // reads as a hard framing violation
    toward = want;
    return;
  }

  const float lo = lobe > 0 ? lift : -edge;
  const float hi = lobe > 0 ? edge : drop;
  const int want = bearing > hi ? 1 : (bearing < lo ? -1 : 0);
  if (want != 0 && side != want) {
    side = want;
    sideT = rng.Range(1.5f, 2.8f);
  }
  drift = bearing > hi ? bearing - hi : (bearing < lo ? lo - bearing : 0.0f);
  toward = bearing > (lo + hi) * 0.5f ? 1 : -1;
}

/**
 * A quick boost that would carry the AC into the player's silhouette is
 * refused. This is the veto bug (2) asks for: the hole is not somewhere
 * to be steered around, it is somewhere it is not legal to enter.
 */
bool AiAgent::TryQuickBoost(float dx, float dz, float power, const ViewFrame& view,
                            const AiPerception& player) {
  const AiProfile& pr = Prof();
  if (qbCd > 0.0f || staggered) return false;

  const float d = Hypot2(dx, dz);
  if (d < 1e-4f) return false;
  const float ux = dx / d;
  const float uz = dz / d;

  // Where this boost would put us, roughly: the impulse decays, so the
  // landing point is well short of power * 1 s. Half a second of it is a
  // good enough probe to keep the AC out of the hole.
  if (!hidden) {
    const float probeX = pos.x + ux * power * 0.5f;
    const float probeZ = pos.z + uz * power * 0.5f;
    const Silhouette sil = PlayerSilhouette(view, player.pos, dist, pr.radius);
    if (sil.Contains(view.Bearing(probeX, probeZ))) {
      events.qbVetoed = true;
      return false;
    }
  }

  Impulse(ux, uz, power, grounded ? 7.0f : 2.0f);
  qbCd = IsAC() && kind == cfg::EnemyKind::Boss ? kBossQbCd[phase] : pr.qbCooldown;
  events.quickBoosted = true;
  events.qbDirX = ux;
  events.qbDirZ = uz;
  events.qbPower = power;
  return true;
}

float AiAgent::AngularRate(const Vec3& playerPos) const {
  float rx = pos.x - playerPos.x;
  float rz = pos.z - playerPos.z;
  const float d = Hypot2(rx, rz);
  if (d < EPS) return 0.0f;
  rx /= d;
  rz /= d;
  return (vel.x * -rz + vel.z * rx) / d;
}

// ==================================================================
//  Cover — enemyAI.js findCover, re-solved against the IWorldQuery seam.
//
//  The web build walked the world's collider list. IWorldQuery does not
//  expose one on purpose, so this PROBES instead: a ring of standable
//  candidates, each tested for whether it actually breaks line of sight
//  to the player. That is a stricter test than "stand behind that box" —
//  it asks the question the behaviour is named after.
// ==================================================================
bool AiAgent::SeekCover(const AiPerception& player, const IWorldQuery& world) {
  const AiProfile& pr = Prof();
  const Vec3 target{player.pos.x, player.pos.y + ai::PlayerChest, player.pos.z};

  bool found = false;
  float bestCost = 1e30f;
  float bx = 0.0f, bz = 0.0f;

  for (int ri = 0; ri < ai::CoverRadii; ++ri) {
    const float r = ai::CoverRadius[ri];
    for (int bi = 0; bi < ai::CoverBearings; ++bi) {
      const float a = (TAU * static_cast<float>(bi)) / static_cast<float>(ai::CoverBearings);
      const float cx = pos.x + std::cos(a) * r;
      const float cz = pos.z + std::sin(a) * r;

      // inside the arena
      if (Hypot2(cx, cz) > cfg::Arena::Radius - ai::ArenaMargin) continue;

      // standable, and roughly on our own plane
      const float gy = world.SampleHeight(cx, cz, pos.y + 4.0f);
      if (!std::isfinite(gy)) continue;
      if (std::fabs(gy - pos.y) > ai::CoverMaxStep) continue;

      // the whole point: does it actually break line of sight?
      const Vec3 eye{cx, gy + pr.eye, cz};
      if (world.LineOfSight(eye, target)) continue;

      // nearest usable spot wins — an MT that sprints 46 m to hide has
      // spent the reload beat crossing open ground
      const float cost = Hypot2(cx - pos.x, cz - pos.z);
      if (cost < bestCost) {
        bestCost = cost;
        bx = cx;
        bz = cz;
        found = true;
      }
    }
    if (found) break;   // prefer the closest ring that works
  }

  if (found) {
    coverX = bx;
    coverZ = bz;
  }
  return found;
}

bool AiAgent::StaggerGate() {
  if (!staggered) return false;
  Hold();
  if (state != AiState::Stagger) {
    state = AiState::Stagger;
    stateT = 0.0f;
  }
  committed = false;
  return true;
}

// ==================================================================
//  MT — the backbone. Strafes at mid range, burst-fires with a tell,
//  backs off when the player closes, ducks behind cover to reload.
// ==================================================================
void AiAgent::BrainMT(const AiPerception& player, const IWorldQuery& world, float dt) {
  const AiProfile& pr = Prof();
  if (StaggerGate()) return;
  if (state == AiState::Stagger) {
    state = AiState::Engage;
    fireCd = 0.5f;
  }

  if (fireCd > 0.0f) fireCd -= dt;
  if (sideT > 0.0f) sideT -= dt;
  else {
    sideT = rng.Range(1.9f, 3.6f);
    side = -side;
  }

  // --- unaware: hold the ground it was posted on ---------------
  if (!alert || !player.alive) {
    Hold();
    if (dist < pr.sight * 0.55f && los) {
      alert = true;
      events.alerted = true;
    }
    return;
  }

  FaceTo(player.pos.x, player.pos.z, dt, state == AiState::Burst ? 1.4f : 1.0f);

  const float dx = player.pos.x - pos.x;
  const float dz = player.pos.z - pos.z;
  const float d = dist > EPS ? dist : 1.0f;
  const float nx = dx / d;
  const float nz = dz / d;
  const float s = static_cast<float>(side);

  switch (state) {
    case AiState::Engage: {
      // hold the band: close if far, back off if crowded, shuffle inside.
      // A walker that ORBITS at full speed leaves the fight it is supposed
      // to be holding, so inside the band it shuffles.
      if (dist > bandMax) MoveDir(nx, nz, 1.0f);
      else if (dist < pr.tooClose) MoveDir(-nx, -nz, 1.05f);
      else MoveDir(-nz * s + nx * 0.12f, nx * s + nz * 0.12f, 0.42f);

      if (los && dist < pr.fireRange && fireCd <= 0.0f) {
        state = AiState::Windup;
        stateT = 0.0f;
      }
      break;
    }
    case AiState::Windup: {
      // plant, raise the gun, glow in the barrel — the tell. NOTHING that
      // hurts the player happens without this first.
      if (dist < pr.tooClose) MoveDir(-nx, -nz, 0.6f);
      else MoveDir(-nz * s, nx * s, 0.28f);
      if (stateT >= pr.windup) {
        state = AiState::Burst;
        stateT = 0.0f;
        rounds = pr.burst;
        shotT = 0.0f;
      }
      break;
    }
    case AiState::Burst: {
      MoveDir(-nz * s * 0.4f, nx * s * 0.4f, 0.25f);
      shotT -= dt;
      if (shotT <= 0.0f && rounds > 0) {
        shotT = pr.burstGap;
        --rounds;
        events.firedPrimary = true;
      }
      if (rounds <= 0) {
        state = AiState::Recover;
        stateT = 0.0f;
        fireCd = pr.recover;
        // Under fire, break contact and use the terrain. This is the
        // behaviour that makes an MT read as a soldier rather than a
        // target: it reloads behind a pipe rack, not in the open.
        const bool wantsCover = underFireT > 0.0f || rng.Unit() < 0.45f;
        if (wantsCover && SeekCover(player, world)) {
          state = AiState::Cover;
          stateT = 0.0f;
          events.enteredCover = true;
        }
      }
      break;
    }
    case AiState::Cover: {
      const float md = MoveTo(coverX, coverZ, 1.05f);
      if (md < ai::CoverArrive || stateT > ai::CoverTimeout) {
        state = AiState::Engage;
        stateT = 0.0f;
      }
      break;
    }
    case AiState::Recover:
    default: {
      if (dist > bandMax) MoveDir(nx, nz, 1.0f);
      else if (dist < pr.tooClose) MoveDir(-nx, -nz, 1.0f);
      else MoveDir(-nz * s, nx * s, 0.5f);
      if (fireCd <= 0.0f) {
        state = AiState::Engage;
        stateT = 0.0f;
      }
      break;
    }
  }
}

// ==================================================================
//  DRONE — fast orbiting harasser. Weaves, dodges, dies to a sneeze.
// ==================================================================
void AiAgent::BrainDrone(const AiPerception& player, float dt) {
  const AiProfile& pr = Prof();
  if (StaggerGate()) return;
  if (state == AiState::Stagger) state = AiState::Engage;
  if (fireCd > 0.0f) fireCd -= dt;
  if (sideT > 0.0f) sideT -= dt;

  if (!alert || !player.alive) {
    Hold();
    if (dist < pr.sight && los) {
      alert = true;
      events.alerted = true;
    }
    return;
  }

  const float d = dist > EPS ? dist : 1.0f;
  const float nx = (player.pos.x - pos.x) / d;
  const float nz = (player.pos.z - pos.z) / d;

  // orbit: tangential, plus a radial correction toward the preferred band
  const float want = (bandMin + bandMax) * 0.5f;
  const float radial = Clamp((dist - want) / 30.0f, -1.0f, 1.0f);
  const float s = static_cast<float>(side);
  MoveDir(-nz * s + nx * radial, nx * s + nz * radial, 1.0f);
  FaceTo(player.pos.x, player.pos.z, dt, 1.4f);

  // a hard lateral kick, not a lerp
  if (sideT <= 0.0f && dist < 130.0f && los) {
    sideT = rng.Range(1.4f, 2.6f);
    side = -side;
    Impulse(-nz * static_cast<float>(side), nx * static_cast<float>(side), 30.0f,
            rng.Range(0.0f, 10.0f));
  }

  switch (state) {
    case AiState::Windup:
      if (stateT >= pr.windup) {
        state = AiState::Burst;
        stateT = 0.0f;
        rounds = pr.burst;
        shotT = 0.0f;
      }
      break;
    case AiState::Burst:
      shotT -= dt;
      if (shotT <= 0.0f && rounds > 0) {
        shotT = pr.burstGap;
        --rounds;
        events.firedPrimary = true;
      }
      if (rounds <= 0) {
        state = AiState::Engage;
        stateT = 0.0f;
        fireCd = pr.recover;
      }
      break;
    default:
      if (los && dist < pr.fireRange && fireCd <= 0.0f) {
        state = AiState::Windup;
        stateT = 0.0f;
      }
      break;
  }
}

// ==================================================================
//  TURRET — emplaced. Sweeping tracking beam with a charge tell.
// ==================================================================
void AiAgent::BrainTurret(const AiPerception& player, float dt) {
  const AiProfile& pr = Prof();
  Hold();
  if (StaggerGate()) return;
  if (state == AiState::Stagger) state = AiState::Idle;

  if (!alert || !player.alive || (!los && state != AiState::Burst)) {
    // idle scan
    aimYaw = yaw + std::sin(stateT * 0.35f + static_cast<float>(id)) * 1.1f;
    aimPitch = -0.05f;
    if (alert && los && dist < pr.fireRange) {
      state = AiState::Windup;
      stateT = 0.0f;
    } else if (state != AiState::Idle) {
      state = AiState::Idle;
      stateT = 0.0f;
    }
    if (!alert && los && dist < pr.sight) {
      alert = true;
      events.alerted = true;
    }
    return;
  }

  aimYaw = std::atan2(-(player.pos.x - pos.x), -(player.pos.z - pos.z));

  switch (state) {
    case AiState::Windup:
      // the capacitors fill and a thin aiming line grows toward the target
      if (stateT >= pr.windup) {
        state = AiState::Burst;
        stateT = 0.0f;
        side = rng.Unit() < 0.5f ? -1 : 1;
        shotT = 0.0f;
      }
      break;
    case AiState::Burst: {
      // sweep 45 deg across the target's bearing — standing still is fatal
      const float k = Clamp(stateT / 1.05f, 0.0f, 1.0f);
      aimYaw += (k - 0.5f) * 0.8f * static_cast<float>(side);
      shotT -= dt;
      if (shotT <= 0.0f) {
        shotT = pr.burstGap;
        events.firedHeavy = true;
      }
      if (stateT >= 1.05f) {
        state = AiState::Recover;
        stateT = 0.0f;
      }
      break;
    }
    case AiState::Recover:
      if (stateT >= pr.recover) {
        state = AiState::Windup;
        stateT = 0.0f;
      }
      break;
    default:
      state = AiState::Windup;
      stateT = 0.0f;
      break;
  }
}

// ==================================================================
//  HELI — circles at altitude, rocket salvos, chin gun in between.
// ==================================================================
void AiAgent::BrainHeli(const AiPerception& player, float dt) {
  const AiProfile& pr = Prof();
  if (StaggerGate()) return;
  if (state == AiState::Stagger) state = AiState::Engage;
  if (fireCd > 0.0f) fireCd -= dt;

  if (!alert || !player.alive) {
    Hold();
    if (dist < pr.sight && los) {
      alert = true;
      events.alerted = true;
    }
    return;
  }

  const float d = dist > EPS ? dist : 1.0f;
  const float nx = (player.pos.x - pos.x) / d;
  const float nz = (player.pos.z - pos.z) / d;
  const float radial = Clamp((dist - (bandMin + bandMax) * 0.5f) / 45.0f, -1.0f, 1.0f);
  const float s = static_cast<float>(side);
  MoveDir(-nz * s + nx * radial, nx * s + nz * radial, 1.0f);
  FaceTo(player.pos.x, player.pos.z, dt, 1.0f);

  switch (state) {
    case AiState::Windup:
      if (stateT >= pr.windup) {
        state = AiState::Burst;
        stateT = 0.0f;
        rounds = pr.burst;
        shotT = 0.0f;
      }
      break;
    case AiState::Burst:
      shotT -= dt;
      if (shotT <= 0.0f && rounds > 0) {
        shotT = pr.burstGap;
        --rounds;
        events.firedMissile = true;
      }
      if (rounds <= 0) {
        state = AiState::Engage;
        stateT = 0.0f;
        fireCd = pr.recover;
      }
      break;
    default:
      if (los && dist < pr.fireRange && fireCd <= 0.0f) {
        state = AiState::Windup;
        stateT = 0.0f;
        break;
      }
      // chin gun harassment while the rack reloads
      if (los && shotT <= 0.0f && dist < 170.0f) {
        shotT = 0.16f;
        events.firedPrimary = true;
      }
      shotT -= dt;
      break;
  }
}

// ==================================================================
//  THE AC DUEL — SHRIKE / KITE / BULWARK / NIGHTJAR.
//
//  One controller, four personalities. Everything they share lives here:
//  the two-sided band, the capped orbit, the lobe off the view axis, the
//  quick-boost veto and the blind watchdog. What differs is the band, the
//  cap, the cadence, and what they do with an opening.
// ==================================================================
void AiAgent::BrainAC(const AiPerception& player, const IWorldQuery& world, float dt) {
  const AiProfile& pr = Prof();
  const bool isBoss = (kind == cfg::EnemyKind::Boss);

  // NB: an AC's attack cadence is `gap`, and its recovery beat is timed by
  // shotT inside AiState::Recover. fireCd belongs to the walker brains and
  // is deliberately untouched here.
  if (qbCd > 0.0f) qbCd -= dt;
  if (gap > 0.0f) gap -= dt;
  if (repickT > 0.0f) repickT -= dt;
  if (sideT > 0.0f) sideT -= dt;
  else {
    sideT = rng.Range(ai::SideFlipMin, ai::SideFlipMax);
    side = -side;
  }

  // --- the frame. Bug (2) is enforced from here down. -----------
  const ViewFrame view = MakeViewFrame(player.pos, player.yaw);
  UpdateFraming(view, player);

  // Three ways to be invisible: behind geometry, off the side of the
  // frame, and standing inside the player's own outline. The third is the
  // one a world-geometry ray cannot see, and it counts double.
  const bool onScreen = los && !hidden && std::fabs(bearing) < ai::FrameLost;
  if (onScreen) blindT = 0.0f;
  else blindT += dt * (hidden ? 1.9f : 1.0f);

  if (StaggerGate()) return;
  if (state == AiState::Stagger) {
    state = AiState::Stalk;
    gap = 0.55f;
  }

  // --- phase gates (NIGHTJAR) ----------------------------------
  if (isBoss && apMax > EPS) {
    const float f = ap / apMax;
    int wantPhase = phase;
    if (phase < 1 && f <= kBossPhase2) wantPhase = 1;
    else if (phase < 2 && f <= kBossPhase3) wantPhase = 2;
    if (wantPhase != phase) {
      phase = wantPhase;
      gap = 0.9f;
      state = AiState::Shift;
      stateT = 0.0f;
      committed = false;
      vel.x *= 0.2f;
      vel.z *= 0.2f;
      events.phaseChanged = true;
      events.phase = phase;
    }
  }
  events.phase = phase;

  const float d = dist > EPS ? dist : 1.0f;
  const float nx = (player.pos.x - pos.x) / d;
  const float nz = (player.pos.z - pos.z) / d;
  const int press = BandRadial();

  // face the player except while committed to a dash
  if (!committed) FaceTo(player.pos.x, player.pos.z, dt, 1.0f);
  aimYaw = std::atan2(-(player.pos.x - pos.x), -(player.pos.z - pos.z));

  // --- lost the frame for too long: go somewhere it can be seen --
  const bool interruptible = (state == AiState::Stalk || state == AiState::Engage ||
                              state == AiState::Recover);
  if (blindT > ai::BlindMax && repickT <= 0.0f && interruptible) {
    repickT = ai::RepickGap;
    blindT = 0.0f;
    // Solve a mark the lens can actually see: sweep bearings off the view
    // axis at duelling range and keep the first clear one. Wide-and-near
    // first — those are the candidates that make the AC big in frame.
    const int sgn = lobe < 0 ? -1 : 1;
    bool solved = false;
    for (int bi = 0; bi < 5 && !solved; ++bi) {
      for (int ri = 0; ri < 3 && !solved; ++ri) {
        const float bear = kMarkBear[bi] * static_cast<float>(sgn);
        const float ca = std::cos(bear);
        const float sa = std::sin(bear);
        const float ux = view.axisX * ca - view.axisZ * sa;
        const float uz = view.axisZ * ca + view.axisX * sa;
        const float cx = player.pos.x + ux * kMarkRange[ri];
        const float cz = player.pos.z + uz * kMarkRange[ri];
        if (Hypot2(cx, cz) > cfg::Arena::Radius - ai::ArenaMargin) continue;
        const float gy = world.SampleHeight(cx, cz, pos.y + 6.0f);
        if (!std::isfinite(gy) || std::fabs(gy - player.pos.y) > 16.0f) continue;
        const Vec3 chest{cx, gy + pr.eye, cz};
        if (!world.LineOfSight(view.lensPos, chest)) continue;
        markX = cx;
        markZ = cz;
        solved = true;
      }
    }
    if (!solved) {
      // Nothing solves: fall back to the lobe's ideal bearing. Better a
      // badly framed AC than an AC nobody can find.
      const float bear = pr.bearEdge * static_cast<float>(sgn);
      const float ca = std::cos(bear);
      const float sa = std::sin(bear);
      markX = player.pos.x + (view.axisX * ca - view.axisZ * sa) * (bandMin + bandMax) * 0.5f;
      markZ = player.pos.z + (view.axisZ * ca + view.axisX * sa) * (bandMin + bandMax) * 0.5f;
    }
    state = AiState::Reposition;
    stateT = 0.0f;
    events.repositioned = true;
  }

  // --- per-frame personality timers ----------------------------
  // KITE watches the player's aim axis; BULWARK watches the player's feet.
  const float toAcX = -nx, toAcZ = -nz;
  const float onAim = player.aimDir.x * toAcX + player.aimDir.z * toAcZ;
  if (onAim > kReticleCos && los) aimT += dt;
  else aimT = 0.0f;
  if (player.SpeedXZ() < kStillSpeed) stillT += dt;
  else stillT = 0.0f;

  // Hovering is re-decided every frame. Latching it is a trap: the phase
  // -shift beat below raises thrusters for its own duration, and if that
  // flag survived the beat NIGHTJAR would float at hover height for the
  // rest of the duel — a walker permanently off the deck.
  hovering = false;

  // BULWARK hovers to stabilise. For it, that stance IS the steady state:
  // the tetrapod settles onto its thrusters and stays there, which is both
  // the tell for the heavy shell and the reason it barely moves.
  if (pr.hoverHold > 0.0f) {
    hoverT += dt;
    hovering = hoverT > pr.hoverHold;
    if (hovering) events.hovering = true;
  }

  // ------------------------------------------------------------
  //  THE QUICK BOOST — shared by every state that is not committed.
  //
  //  This is the difference between an AC and an MT, so it does not
  //  belong to one state. An AC boosts while it is trading, while it is
  //  recovering and while it is repositioning, exactly as the player
  //  does. It is excluded only from a WIND-UP (the wind-up is the tell,
  //  and a tell that slides across the arena is not a tell) and from the
  //  scripted dashes, which own velocity outright.
  //
  //  A lateral boost sweeps a large arc, so it is fired TOWARD the middle
  //  of the lobe — never on `side`, which the idle timer flips at random —
  //  and its power is scaled with range so the sweep stays bounded.
  //  ClampLateral() catches whatever this does not.
  // ------------------------------------------------------------
  const bool mayBoost = !committed && state != AiState::Windup && state != AiState::Shift &&
                        state != AiState::ChargeUp && state != AiState::BladeUp;
  if (mayBoost && qbCd <= 0.0f) {
    const bool reticleDodge = (kind == cfg::EnemyKind::AcMid) && aimT > kReticleFuse;
    const bool shrikeDart = (kind == cfg::EnemyKind::AcLight);
    const float chance = shrikeDart ? 2.6f : 1.6f;
    if (reticleDodge || drift > 0.02f || rng.Unit() < dt * chance) {
      const float tw = static_cast<float>(toward);
      const bool lateral = reticleDodge || drift > 0.02f || rng.Unit() < 0.62f;
      if (lateral) {
        const float power = Clamp(dist * 0.85f, 30.0f, pr.qbPower);
        if (TryQuickBoost(-nz * tw, nx * tw, power, view, player) && reticleDodge) {
          aimT = 0.0f;
        }
      } else {
        const float sgn = press < 0 ? -1.0f : 1.0f;
        TryQuickBoost(nx * sgn, nz * sgn, pr.qbPower * (press < 0 ? 0.85f : 1.0f), view,
                      player);
      }
    }
  }

  switch (state) {
    // ------------------------------------------------------------
    case AiState::Reposition: {
      const float md = MoveTo(markX, markZ, 1.0f);
      TryQuickBoost(markX - pos.x, markZ - pos.z, pr.qbPower * 0.9f, view, player);
      if ((onScreen && stateT > 0.5f) || md < 10.0f || stateT > 2.6f) {
        state = AiState::Stalk;
        stateT = 0.0f;
        gap = 0.45f;
        blindT = 0.0f;
      }
      break;
    }
    // ------------------------------------------------------------
    case AiState::Shift: {
      // the reconfiguration beat between phases: hover, vent, re-engage
      Strafe(nx, nz, press, 0.5f);
      hovering = true;
      events.hovering = true;
      if (stateT > kShiftTime) {
        state = AiState::Stalk;
        stateT = 0.0f;
      }
      break;
    }
    // ------------------------------------------------------------
    case AiState::Stalk: {
      // Hold the duelling band, strafe inside it, boost off the line.
      float mul = press != 0 ? 1.0f : 0.8f;
      mul *= pr.speedMul;
      Strafe(nx, nz, press, mul);

      // SHRIKE never stops moving. The orbit cap can drive a pure-orbit
      // wish down toward nothing, so it gets a floor — this is what makes
      // "never stands still" true rather than aspirational.
      if (kind == cfg::EnemyKind::AcLight) {
        const float floorSpeed = Speed() * kShrikeFloor;
        if (wishSpeed < floorSpeed) {
          if (std::fabs(wishX) + std::fabs(wishZ) < 1e-4f) {
            wishX = -nz * static_cast<float>(side);
            wishZ = nx * static_cast<float>(side);
          }
          wishSpeed = floorSpeed;
        }
      }

      // --- pick an opening ---------------------------------------
      // Gated on FIRE RANGE, not just line of sight. Without that an AC
      // ordered to close from 200 m opens its attack cycle immediately
      // and spends the whole approach in a firing state at a third of
      // its speed — measured, it closed at 34 m/s of a rated 78.
      if (gap <= 0.0f && dist < pr.fireRange && (los || dist < 60.0f)) {
        if (isBoss) {
          const uint8_t* list = kMoveList[phase];
          const int n = kMoveCount[phase];
          uint8_t pick = list[rng.RangeInt(0, n - 1)];
          if (pick == move && rng.Unit() < 0.7f) pick = list[rng.RangeInt(0, n - 1)];
          // range sanity: no blade from 120 m, no charge from 15 m
          if (pick == MoveBlade && dist > 95.0f) pick = MoveCharge;
          if (pick == MoveCharge && dist < 34.0f) pick = MoveRifle;
          if (pick == MoveSweep && dist > 160.0f) pick = MoveRifle;
          move = pick;
          gap = kBossGap[phase];
          switch (pick) {
            case MoveCharge:
              state = AiState::ChargeUp;
              stateT = 0.0f;
              break;
            case MoveBlade:
              state = AiState::BladeUp;
              stateT = 0.0f;
              break;
            case MoveBurstQb: {
              const float tw = static_cast<float>(toward);
              TryQuickBoost(-nz * tw, nx * tw, Clamp(dist * 1.2f, 44.0f, 84.0f), view, player);
              gap = 0.5f;
              break;
            }
            default:
              state = AiState::Windup;
              stateT = 0.0f;
              break;
          }
        } else if (kind == cfg::EnemyKind::AcLight && dist <= cfg::Blade::Range) {
          // SHRIKE closes to blade range and uses it. That is its whole
          // reason to be inside 30 m.
          state = AiState::BladeUp;
          stateT = 0.0f;
          // The gap has to outlast the whole blade cycle (wind-up, dash
          // and recovery, ~1.4 s) or SHRIKE re-commits the instant it
          // lands and never stalks at all — measured, it spent 91 % of a
          // run inside the blade loop and 0.4 % holding its band, which
          // is neither "never stops moving" nor a duel.
          gap = kShrikeBladeGap;
        } else if (kind == cfg::EnemyKind::AcHeavy) {
          // BULWARK punishes standing still. A player who has not moved
          // for kStillFuse seconds gets the shell; a moving one gets a
          // slower, more readable cadence.
          const bool punish = stillT > kStillFuse && hovering;
          if (punish || rng.Unit() < dt * 0.9f) {
            state = AiState::Windup;
            stateT = punish ? pr.windup * 0.45f : 0.0f;
            move = punish ? MoveSweep : MoveRifle;
            gap = punish ? pr.recover * 0.7f : pr.recover;
          }
        } else {
          state = AiState::Windup;
          stateT = 0.0f;
          move = MoveRifle;
          gap = pr.recover;
        }
      }
      break;
    }
    // ------------------------------------------------------------
    case AiState::Windup: {
      Strafe(nx, nz, press, 0.35f * pr.speedMul);
      if (stateT >= pr.windup) {
        state = AiState::Burst;
        stateT = 0.0f;
        rounds = (move == MoveMissile) ? 6 : pr.burst;
        shotT = 0.0f;
      }
      break;
    }
    case AiState::Burst: {
      Strafe(nx, nz, press, 0.4f * pr.speedMul);
      shotT -= dt;
      if (shotT <= 0.0f && rounds > 0) {
        shotT = (move == MoveMissile) ? 0.085f : pr.burstGap;
        --rounds;
        if (move == MoveMissile) events.firedMissile = true;
        else if (move == MoveSweep) events.firedHeavy = true;
        else events.firedPrimary = true;
      }
      if (rounds <= 0) {
        state = AiState::Recover;
        stateT = 0.0f;
        // shotT carries the recover DURATION here. Comparing stateT
        // against fireCd instead would halve the beat, because fireCd is
        // counting down while stateT counts up and the two meet in the
        // middle — measured, a 0.92 s recovery ran for 0.46 s.
        shotT = pr.recover;
        if (kind == cfg::EnemyKind::AcHeavy) hoverT = 0.0f;
      }
      break;
    }
    case AiState::Recover: {
      Strafe(nx, nz, press, 0.6f * pr.speedMul);
      if (stateT >= shotT) {
        state = AiState::Stalk;
        stateT = 0.0f;
      }
      break;
    }
    // ------------------------------------------------------------
    case AiState::ChargeUp: {
      Hold();
      if (stateT >= kChargeWindup) {
        state = AiState::ChargeGo;
        stateT = 0.0f;
        committed = true;
        committedX = nx;
        committedZ = nz;
        vel.x = nx * kChargeSpeed;
        vel.z = nz * kChargeSpeed;
        vel.y = 5.0f;
        events.assaultBoosted = true;
      }
      break;
    }
    case AiState::ChargeGo: {
      // steer a little, but committed — this is dodgeable on purpose
      committedX = Damp(committedX, nx, 2.4f, dt);
      committedZ = Damp(committedZ, nz, 2.4f, dt);
      const float l = Hypot2(committedX, committedZ);
      if (l > EPS) {
        vel.x = (committedX / l) * kChargeSpeed;
        vel.z = (committedZ / l) * kChargeSpeed;
        yaw = std::atan2(-committedX / l, -committedZ / l);
      }
      if (dist < kChargeRadius || stateT >= kChargeDash) {
        if (dist < kChargeRadius) events.firedHeavy = true;
        state = AiState::Recover;
        stateT = 0.0f;
        shotT = kChargeRecover;
        committed = false;
        vel.x *= 0.3f;
        vel.z *= 0.3f;
      }
      break;
    }
    // ------------------------------------------------------------
    case AiState::BladeUp: {
      MoveDir(nx, nz, 0.30f * pr.speedMul);
      if (stateT >= kBladeWindup) {
        state = AiState::BladeGo;
        stateT = 0.0f;
        committed = true;
        committedX = nx;
        committedZ = nz;
        vel.x = nx * kBladeSpeed;
        vel.z = nz * kBladeSpeed;
        vel.y = 4.0f;
      }
      break;
    }
    case AiState::BladeGo: {
      committedX = Damp(committedX, nx, 3.4f, dt);
      committedZ = Damp(committedZ, nz, 3.4f, dt);
      const float l = Hypot2(committedX, committedZ);
      if (l > EPS) {
        vel.x = (committedX / l) * kBladeSpeed;
        vel.z = (committedZ / l) * kBladeSpeed;
        yaw = std::atan2(-committedX / l, -committedZ / l);
      }
      if (dist < cfg::Blade::Range * 0.6f) events.bladeSwing = true;
      if (events.bladeSwing || stateT >= kBladeDash) {
        state = AiState::Recover;
        stateT = 0.0f;
        shotT = kBladeRecover;
        committed = false;
        vel.x *= 0.25f;
        vel.z *= 0.25f;
      }
      break;
    }
    // ------------------------------------------------------------
    default: {
      state = AiState::Stalk;
      stateT = 0.0f;
      break;
    }
  }
}

// ==================================================================
//  Body — enemyUnit.js _body, ported.
// ==================================================================
void AiAgent::Body(const Vec3& playerPos, const IWorldQuery& world, float dt) {
  const AiProfile& pr = Prof();

  if (!committed) {
    vel.x = Damp(vel.x, wishX * wishSpeed, pr.accel, dt);
    vel.z = Damp(vel.z, wishZ * wishSpeed, pr.accel, dt);
  }

  // BUG (1): the bound is closed HERE, between the last thing that can
  // write velocity and the integration that turns it into motion.
  //
  // Clamping after the position update instead leaks exactly one frame of
  // uncapped travel every time the brain fires an impulse, and one frame
  // is all a 78 m/s quick boost needs: measured with the clamp at the end
  // of Step(), the orbit rate peaked at 1.23 rad/s against a 0.55 cap
  // while the *velocity* was dutifully bounded a moment too late.
  ClampLateral(playerPos);

  const float px = pos.x;
  const float pz = pos.z;
  pos.x += vel.x * dt;
  pos.z += vel.z * dt;

  // --- arena containment ---------------------------------------
  const float lim = cfg::Arena::Radius - ai::ArenaMargin;
  const float rr = Hypot2(pos.x, pos.z);
  if (rr > lim && rr > EPS) {
    pos.x = pos.x / rr * lim;
    pos.z = pos.z / rr * lim;
    vel.x *= ai::ArenaBounce;
    vel.z *= ai::ArenaBounce;
  }

  // --- vertical -------------------------------------------------
  const float gy = world.SampleHeight(pos.x, pos.z, pos.y + 2.5f);
  if (flying || hovering) {
    const float floorY = gy + ai::FlyFloor;
    const float hoverTarget = flying ? pr.hoverY : 3.0f;   // a hovering AC sits low
    const float want = floorY > gy + hoverTarget ? floorY : gy + hoverTarget;
    const float climb = Clamp((want - pos.y) * ai::FlyClimbGain, -ai::FlyClimbRate,
                              ai::FlyClimbRate);
    vel.y = Damp(vel.y, climb, ai::FlyClimbDamp, dt);
    pos.y += vel.y * dt;
    if (pos.y < floorY) {
      pos.y = floorY;
      if (vel.y < 0.0f) vel.y = 0.0f;
    }
    grounded = false;
  } else {
    // block a horizontal move that would climb a wall
    if (gy > pos.y + ai::WallClimbBlock) {
      pos.x = px;
      pos.z = pz;
      vel.x *= 0.15f;
      vel.z *= 0.15f;
    }
    const float g2 = world.SampleHeight(pos.x, pos.z, pos.y + 2.5f);
    if (pos.y <= g2 + ai::GroundSnap && vel.y <= 0.1f) {
      pos.y = g2 <= pos.y ? Damp(pos.y, g2, ai::GroundGlue, dt) : g2;
      vel.y = 0.0f;
      grounded = true;
    } else {
      vel.y -= ai::Gravity * dt;
      if (vel.y < ai::Terminal) vel.y = ai::Terminal;
      pos.y += vel.y * dt;
      grounded = false;
      if (pos.y < g2) {
        pos.y = g2;
        vel.y = 0.0f;
        grounded = true;
      }
    }
  }

  if (staggered) {
    vel.x *= ai::StaggerDrag;
    vel.z *= ai::StaggerDrag;
  }
}

// ==================================================================
//  Step
// ==================================================================
void AiAgent::Step(const AiPerception& player, const IWorldQuery& world, float dt) {
  events.Clear();
  if (dt <= 0.0f) return;
  const float d = dt > ai::MaxFrameDt ? ai::MaxFrameDt : dt;

  stateT += d;
  if (underFireT > 0.0f) underFireT -= d;

  // A pylon is a structure, not a soldier. It has no brain and no body.
  if (kind == cfg::EnemyKind::Pylon) return;

  dist = Hypot2(player.pos.x - pos.x, player.pos.z - pos.z);

  // --- line of sight, polled rather than asked every frame ------
  losT -= d;
  if (losT <= 0.0f) {
    losT = ai::LosPollGap;
    const Vec3 target{player.pos.x, player.pos.y + ai::PlayerChest, player.pos.z};
    los = world.LineOfSight(EyePos(), target);
  }

  switch (kind) {
    case cfg::EnemyKind::MT: BrainMT(player, world, d); break;
    case cfg::EnemyKind::Drone: BrainDrone(player, d); break;
    case cfg::EnemyKind::Turret: BrainTurret(player, d); break;
    case cfg::EnemyKind::Heli: BrainHeli(player, d); break;
    default: BrainAC(player, world, d); break;
  }

  // Body() closes bug (1)'s velocity bound immediately before integrating,
  // so no frame of motion can ever use an over-cap lateral velocity.
  Body(player.pos, world, d);

  dist = Hypot2(player.pos.x - pos.x, player.pos.z - pos.z);
}

}  // namespace ob

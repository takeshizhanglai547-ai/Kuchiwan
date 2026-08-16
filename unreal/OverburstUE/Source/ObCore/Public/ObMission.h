// ============================================================
//  ObCore — OP-317 "SLAG CROWN": act progression, objective state,
//  the timer, win/lose rules and letter-rank scoring.
//
//  Ported from overburst/src/mission/mission.js, scoring.js and
//  director.js. The scoring curve is transcribed EXACTLY: the result
//  screen and the mission must never disagree about what letter the
//  player earned.
//
//  ------------------------------------------------------------------
//  THE STAGE
//    ACT 1  INFILTRATE — punch down the insertion lane into the basin.
//    ACT 2  COOLANT    — three defended pylons; every kill escalates the
//                        garrison (air wing, then the turret grid).
//    ACT 3  NIGHTJAR   — the hostile AC arrives and the duel decides the
//                        contract.
//
//  ------------------------------------------------------------------
//  THE RULE THIS FILE EXISTS TO ENFORCE: THE MISSION NEVER SOFT-LOCKS.
//
//  mission.js states it as a design rule and the web build learned it the
//  hard way. Every gate below has a distance escape, a timeout escape, or
//  both, and the mission clock is the backstop under all of them:
//
//    act 1  · the picket is dead                      (intended)
//           · OR the roster was empty                 (fast escape)
//           · OR the player pushed past the lane and nothing live is
//             still shooting at their back            (distance escape)
//           · OR the player reached a pylon deck       (distance escape)
//           · OR a pylon is already down — skipped ahead
//           · OR Act1Cap seconds elapsed               (timeout escape)
//    act 2  · every pylon is down                     (intended)
//           · OR no pylons exist at all, after a grace (timeout escape)
//           · OR the mission clock runs out            (terminal: LOSE)
//    act 3  · NIGHTJAR dies                           (intended: WIN)
//           · OR no hostile AC can be produced after BossTries attempts,
//             in which case the contract is satisfied anyway rather than
//             leaving the player in an empty arena     (escape: WIN)
//           · OR the mission clock runs out            (terminal: LOSE)
//
//  A gate that can only be passed by killing something is a gate that can
//  be stood in front of forever by one unit stuck behind a silo.
//
//  ------------------------------------------------------------------
//  UNITS: METRES and seconds. ZERO Unreal dependencies. No exceptions,
//  no RTTI, no heap in the tick path — the objective board and the event
//  payloads are fixed-size members. Verified by unreal/tests/test_ai.cpp.
// ============================================================
#pragma once

#include "ObTypes.h"
#include "ObConfig.h"

namespace ob {

namespace mission {

// --- act 1 gates (mission.js) ---------------------------------------
constexpr float LanePush = 260.0f;    // m travelled that counts as "through"
constexpr float PylonNear = 55.0f;    // m from a deck that counts as "arrived"
constexpr float LaneShake = 110.0f;   // no live picket this close = lane is behind you
constexpr float Act1Cap = 85.0f;      // s before the lane is declared clear regardless
constexpr float ContactRange = 210.0f;

// --- fail-safes ------------------------------------------------------
constexpr float NoPylonGrace = 22.0f;   // s to wait for pylons before skipping act 2
constexpr float NoLaneGrace = 3.0f;     // s to wait for a picket that never spawned
constexpr float BossRetry = 2.5f;       // s between attempts to put NIGHTJAR on the deck
constexpr int BossTries = 4;

constexpr float LowApFrac = 0.25f;

// --- scoring weights (scoring.js) ------------------------------------
constexpr float PtsPerDamageDealt = 0.05f;
constexpr float PtsPerDamageTaken = 0.06f;
constexpr int PtsPerStagger = 250;
constexpr int PtsPerSecondLeft = 12;
constexpr int KitCost = 400;

}  // namespace mission

// ------------------------------------------------------------------
//  Objectives
// ------------------------------------------------------------------
enum class ObjId : uint8_t { Infiltrate, Pylons, Nightjar, Count };
enum class ObjState : uint8_t { Pending, Active, Done, Failed };

struct Objective {
  ObjId id = ObjId::Infiltrate;
  ObjState state = ObjState::Pending;
  int count = 0;
  int of = 0;
};

/** Why the sortie ended. */
enum class EndReason : uint8_t { None, Boss, Timeout, Destroyed };

/** Radio beats, as ids. ObCore does not hold UI copy — the Unreal layer
 *  maps these to localised lines, exactly as script.js holds them today. */
enum class RadioBeat : uint8_t {
  None, Open, Contact, Act1Done, Pylon1, Pylon2, Pylon3,
  Boss, BossStagger, BossPhase2, BossPhase3, LowAp,
  Time120, Time60, Time30, Win, LoseTime, LoseDead
};

// ------------------------------------------------------------------
//  The host seam.
//
//  ObCore does not know what an entity is, so the mission asks the host
//  the roster questions and the host answers them. Mirrors the guarded
//  ctx.enemies access in mission/director.js: every one of these may fail
//  or return nothing, and the act logic must survive that.
// ------------------------------------------------------------------
class IMissionFeed {
 public:
  virtual ~IMissionFeed() = default;

  // ---- act 1: the insertion-lane picket ----
  virtual int LaneTotal() const = 0;
  virtual int LaneDown() const = 0;
  /** Any LIVE picket unit within `radius` of the player. */
  virtual bool LaneWithin(float radius) const = 0;

  // ---- act 2: the coolant pylons ----
  virtual int PylonTotal() const = 0;
  virtual int PylonDown() const = 0;
  virtual bool NearAnyPylon(float radius) const = 0;
  /** Escalate the garrison. step = 1, 2, 3 — one per destroyed pylon. */
  virtual void Escalate(int step) = 0;

  // ---- act 3: NIGHTJAR ----
  virtual bool BossSpawned() const = 0;
  virtual bool BossAlive() const = 0;
  /** Put NIGHTJAR on the deck. False when no hostile AC can be produced. */
  virtual bool RequestBoss() = 0;
};

// ------------------------------------------------------------------
//  Per-frame input from the host.
// ------------------------------------------------------------------
struct MissionInput {
  Vec3 playerPos;
  float playerAp = cfg::Player::AP;
  float playerApMax = cfg::Player::AP;
  int repairKitsLeft = cfg::Player::RepairKits;
  bool playerAlive = true;
};

// ------------------------------------------------------------------
//  What changed this step. Flags only, cleared at the top of every
//  Update — same contract as MoveEvents and AiEvents.
// ------------------------------------------------------------------
struct MissionEvents {
  bool objectiveChanged = false;
  ObjId objective = ObjId::Infiltrate;
  ObjState objectiveState = ObjState::Pending;

  bool actChanged = false;
  int act = 1;

  bool radio = false;
  RadioBeat beat = RadioBeat::None;
  bool radioUrgent = false;

  bool warning = false;
  int warningSeconds = 0;

  bool finished = false;
  bool win = false;

  void Clear();
};

// ------------------------------------------------------------------
//  The final report.
// ------------------------------------------------------------------
struct MissionResult {
  bool win = false;
  EndReason reason = EndReason::None;
  char rank = 'E';
  int rating = 0;
  int score = 0;
  float time = 0.0f;
  float timeLeft = 0.0f;
  float dealt = 0.0f;
  float taken = 0.0f;
  int kills = 0;
  int staggers = 0;
  int pylons = 0;
  int kits = 0;

  // the breakdown the result screen prints, in order
  int ptsTargets = 0;
  int ptsDamage = 0;
  int ptsStaggers = 0;
  int ptsTimeBonus = 0;
  int ptsTaken = 0;      // negative
  int ptsKits = 0;       // negative
};

// ------------------------------------------------------------------
//  The combat log. scoring.js, transcribed.
// ------------------------------------------------------------------
struct MissionScore {
  float dealt = 0.0f;
  float taken = 0.0f;
  int kills = 0;
  int staggers = 0;
  int pylons = 0;
  int killPoints = 0;
  int byKind[static_cast<int>(cfg::EnemyKind::Count)] = {};
  int live = 0;

  void Reset();
  void DamageDealt(float n);
  void DamageTaken(float n);
  void Stagger();
  void Kill(cfg::EnemyKind kind);

  /**
   * The letter rank. This curve is duplicated from the web build's result
   * screen ON PURPOSE and must stay identical to it: the rank the player
   * reads and the rank the mission recorded can never disagree.
   */
  MissionResult Compute(bool win, float elapsed, float timeLeft, int kits,
                        EndReason reason, float apMax) const;

 private:
  void UpdateLive();
};

// ------------------------------------------------------------------
//  The mission.
// ------------------------------------------------------------------
struct Mission {
  // ---- public state, read by the HUD ----
  int act = 1;
  float timeLeft = cfg::Mission::TimeLimit;
  int score = 0;
  bool started = false;
  bool over = false;
  MissionResult result;
  MissionScore log;
  Objective objectives[static_cast<int>(ObjId::Count)];
  MissionEvents events;

  /** Begin (or restart) the sortie. `feed` is retained; it must outlive
   *  the mission, exactly as the host's roster does. */
  void Begin(IMissionFeed* feed, const Vec3& playerStart);

  /** Advance one frame. dt is clamped to 0.1 s, as the web build does. */
  void Update(const MissionInput& in, float dt);

  // ---- host-driven feeds ----
  void OnDamage(float amount, bool toPlayer);
  void OnKill(cfg::EnemyKind kind);
  void OnStagger(bool isBoss);
  /** NIGHTJAR reconfigured. n = 1 or 2. */
  void OnBossPhase(int n);

  float Elapsed() const { return elapsed; }
  const Objective& Obj(ObjId id) const { return objectives[static_cast<int>(id)]; }

 private:
  IMissionFeed* feed = nullptr;
  Vec3 start;
  float elapsed = 0.0f;
  float actT = 0.0f;

  int escalated = 0;
  int timeMark = 0;
  int bossTries = 0;
  float bossT = 0.0f;
  int bossPhase = 0;
  bool bossByMe = false;
  bool saidContact = false;
  bool saidLowAp = false;
  bool saidBossStagger = false;
  bool pendWin = false;
  EndReason pendReason = EndReason::None;

  void BuildObjectives();
  void Say(RadioBeat beat, bool urgent);
  void SetObjective(ObjId id, ObjState st);

  void Act1(const MissionInput& in);
  bool Act1Done(int down, const MissionInput& in) const;
  void ToAct2();
  void Act2();
  void ToAct3();
  void Act3(const MissionInput& in, float dt);

  void TimeWarnings();
  void LowApCall(const MissionInput& in);
  void CheckEnd(const MissionInput& in);
  void End(bool win, EndReason reason, const MissionInput& in);
};

}  // namespace ob

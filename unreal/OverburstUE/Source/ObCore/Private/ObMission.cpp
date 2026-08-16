// ============================================================
//  ObCore — OP-317 "SLAG CROWN". See ObMission.h for the stage, the
//  scoring contract and the no-soft-lock rule this file enforces.
// ============================================================
#include "ObMission.h"

namespace ob {

namespace {

/**
 * JavaScript's Math.round, exactly: half rounds toward +infinity.
 *
 * std::round() rounds half AWAY FROM ZERO, so the two disagree on every
 * negative half-integer. The score breakdown carries negative terms, and
 * the whole point of transcribing scoring.js rather than reinventing it
 * is that the two targets produce the same letter for the same sortie.
 */
inline int JsRound(float v) { return static_cast<int>(std::floor(v + 0.5f)); }

inline float MinF(float a, float b) { return a < b ? a : b; }

/** Time marks the HUD warns on, in seconds remaining. */
constexpr float kTimeMarks[3] = {120.0f, 60.0f, 30.0f};
constexpr RadioBeat kTimeBeats[3] = {RadioBeat::Time120, RadioBeat::Time60,
                                     RadioBeat::Time30};

}  // namespace

// ==================================================================
//  Events
// ==================================================================
void MissionEvents::Clear() {
  objectiveChanged = false;
  actChanged = false;
  radio = false;
  beat = RadioBeat::None;
  radioUrgent = false;
  warning = false;
  warningSeconds = 0;
  finished = false;
  win = false;
}

// ==================================================================
//  Scoring — scoring.js, transcribed
// ==================================================================
void MissionScore::Reset() {
  dealt = taken = 0.0f;
  kills = staggers = pylons = killPoints = 0;
  for (int i = 0; i < static_cast<int>(cfg::EnemyKind::Count); ++i) byKind[i] = 0;
  live = 0;
}

void MissionScore::UpdateLive() {
  const float v = static_cast<float>(killPoints) + dealt * mission::PtsPerDamageDealt +
                  static_cast<float>(staggers * mission::PtsPerStagger) -
                  taken * mission::PtsPerDamageTaken;
  const int r = JsRound(v);
  live = r > 0 ? r : 0;
}

void MissionScore::DamageDealt(float n) {
  if (n <= 0.0f) return;
  dealt += n;
  UpdateLive();
}

void MissionScore::DamageTaken(float n) {
  if (n <= 0.0f) return;
  taken += n;
  UpdateLive();
}

void MissionScore::Stagger() {
  ++staggers;
  UpdateLive();
}

void MissionScore::Kill(cfg::EnemyKind kind) {
  ++kills;
  const int i = static_cast<int>(kind);
  if (i >= 0 && i < static_cast<int>(cfg::EnemyKind::Count)) {
    ++byKind[i];
    if (kind == cfg::EnemyKind::Pylon) ++pylons;
    killPoints += cfg::Enemy(kind).score;
  } else {
    killPoints += 100;
  }
  UpdateLive();
}

MissionResult MissionScore::Compute(bool win, float elapsedTime, float left, int kits,
                                    EndReason reason, float apMax) const {
  MissionResult r;
  const float lim = cfg::Mission::TimeLimit;
  const float apRef = apMax > EPS ? apMax : cfg::Player::AP;
  const float leftClamped = left > 0.0f ? left : 0.0f;

  r.ptsTimeBonus = win ? JsRound(leftClamped * static_cast<float>(mission::PtsPerSecondLeft)) : 0;
  r.ptsKits = -(kits * mission::KitCost);
  r.ptsDamage = JsRound(dealt * mission::PtsPerDamageDealt);
  r.ptsStaggers = staggers * mission::PtsPerStagger;
  r.ptsTaken = -JsRound(taken * mission::PtsPerDamageTaken);
  r.ptsTargets = killPoints;

  const int total = r.ptsTargets + r.ptsDamage + r.ptsStaggers + r.ptsTimeBonus + r.ptsTaken +
                    r.ptsKits;
  r.score = total > 0 ? total : 0;

  // --- letter rank: identical curve to the web result screen ---
  float v = 0.0f;
  v += MinF(38.0f, static_cast<float>(kills) * 5.5f);                       // aggression
  v += MinF(16.0f, static_cast<float>(staggers) * 3.2f);                    // control
  v += MinF(26.0f, (1.0f - MinF(1.0f, taken / apRef)) * 26.0f);             // survivability
  v += MinF(20.0f, (1.0f - MinF(1.0f, elapsedTime / lim)) * 20.0f);         // speed
  v -= static_cast<float>(kits) * 3.0f;
  if (!win) v *= 0.42f;

  r.rank = v >= 88.0f ? 'S' : v >= 76.0f ? 'A' : v >= 60.0f ? 'B'
           : v >= 42.0f ? 'C' : v >= 22.0f ? 'D' : 'E';
  r.rating = JsRound(v);
  r.win = win;
  r.reason = reason;
  r.time = elapsedTime;
  r.timeLeft = leftClamped;
  r.dealt = dealt;
  r.taken = taken;
  r.kills = kills;
  r.staggers = staggers;
  r.pylons = pylons;
  r.kits = kits;
  return r;
}

// ==================================================================
//  Lifecycle
// ==================================================================
void Mission::Begin(IMissionFeed* missionFeed, const Vec3& playerStart) {
  feed = missionFeed;
  start = playerStart;

  act = 1;
  timeLeft = cfg::Mission::TimeLimit;
  score = 0;
  started = true;
  over = false;
  result = MissionResult{};
  log.Reset();
  events.Clear();

  elapsed = 0.0f;
  actT = 0.0f;
  escalated = 0;
  timeMark = 0;
  bossTries = 0;
  bossT = 0.0f;
  bossPhase = 0;
  bossByMe = false;
  saidContact = false;
  saidLowAp = false;
  saidBossStagger = false;
  pendWin = false;
  pendReason = EndReason::None;

  BuildObjectives();
  Say(RadioBeat::Open, false);
}

void Mission::BuildObjectives() {
  const int laneOf = feed ? feed->LaneTotal() : 0;
  int pylonOf = feed ? feed->PylonTotal() : 0;
  if (pylonOf <= 0) pylonOf = cfg::Mission::Pylons;

  objectives[0] = Objective{ObjId::Infiltrate, ObjState::Active, 0, laneOf};
  objectives[1] = Objective{ObjId::Pylons, ObjState::Pending, 0, pylonOf};
  objectives[2] = Objective{ObjId::Nightjar, ObjState::Pending, 0, 0};
}

void Mission::Say(RadioBeat b, bool urgent) {
  // One beat surfaces per frame. The host paces the typing; ObCore only
  // owns the ORDER, and an urgent beat outranks whatever is queued behind
  // it — NIGHTJAR walking on is more important than a reload callout.
  events.radio = true;
  events.beat = b;
  events.radioUrgent = urgent;
}

void Mission::SetObjective(ObjId id, ObjState st) {
  Objective& o = objectives[static_cast<int>(id)];
  o.state = st;
  if (st == ObjState::Done) o.count = o.of;
  events.objectiveChanged = true;
  events.objective = id;
  events.objectiveState = st;
}

// ==================================================================
//  Update
// ==================================================================
void Mission::Update(const MissionInput& in, float dt) {
  events.Clear();
  if (!started || dt <= 0.0f) return;
  const float d = dt > 0.1f ? 0.1f : dt;
  if (over) return;

  elapsed += d;
  actT += d;
  timeLeft = cfg::Mission::TimeLimit - elapsed;
  if (timeLeft < 0.0f) timeLeft = 0.0f;
  score = log.live;

  TimeWarnings();
  LowApCall(in);

  if (act == 1) Act1(in);
  else if (act == 2) Act2();
  else Act3(in, d);

  CheckEnd(in);
}

// ==================================================================
//  ACT 1 — INFILTRATE
// ==================================================================
void Mission::Act1(const MissionInput& in) {
  const int down = feed ? feed->LaneDown() : 0;
  objectives[0].count = down;

  if (!saidContact && elapsed > 1.6f && feed &&
      feed->LaneWithin(mission::ContactRange)) {
    saidContact = true;
    Say(RadioBeat::Contact, false);
  }

  if (Act1Done(down, in)) ToAct2();
}

bool Mission::Act1Done(int down, const MissionInput& in) const {
  if (!feed) return actT > mission::NoLaneGrace;

  const int of = feed->LaneTotal();

  // intended completion: the picket that engaged you is dead
  if (of > 0 && down >= of) return true;

  // The enemy system never put a picket on the bearing. The web build
  // burned the full Act1Cap here; there is nothing to wait for, so the
  // stage moves on after a short grace instead of donating 85 s of the
  // mission clock to an empty corridor. Act1Cap remains the backstop.
  if (of <= 0 && actT > mission::NoLaneGrace) return true;

  if (actT > mission::Act1Cap) return true;          // timeout escape
  if (feed->PylonDown() > 0) return true;            // player skipped ahead

  // ...or you left them behind. Never declare a lane clear with a live
  // picket still shooting at your back — that is the distance escape and
  // its safety catch, together.
  const float dx = in.playerPos.x - start.x;
  const float dz = in.playerPos.z - start.z;
  bool through = (dx * dx + dz * dz) > (mission::LanePush * mission::LanePush);
  if (!through) through = feed->NearAnyPylon(mission::PylonNear);
  return through && !feed->LaneWithin(mission::LaneShake);
}

void Mission::ToAct2() {
  SetObjective(ObjId::Infiltrate, ObjState::Done);
  SetObjective(ObjId::Pylons, ObjState::Active);
  act = 2;
  actT = 0.0f;
  events.actChanged = true;
  events.act = 2;
  Say(RadioBeat::Act1Done, false);
}

// ==================================================================
//  ACT 2 — DESTROY THE COOLANT PYLONS
// ==================================================================
void Mission::Act2() {
  Objective& o = objectives[1];
  const int total = o.of > 0 ? o.of : cfg::Mission::Pylons;

  if (!feed || feed->PylonTotal() <= 0) {
    // The enemy system never put objective structures on the field. Do
    // NOT deadlock the stage on them.
    if (actT > mission::NoPylonGrace) {
      o.count = total;
      ToAct3();
    }
    return;
  }

  const int down = feed->PylonDown();
  o.count = down > 0 ? down : 0;

  while (escalated < down && escalated < 3) {
    ++escalated;
    feed->Escalate(escalated);
    Say(escalated == 1   ? RadioBeat::Pylon1
        : escalated == 2 ? RadioBeat::Pylon2
                         : RadioBeat::Pylon3,
        false);
  }

  if (down >= total) ToAct3();
}

void Mission::ToAct3() {
  SetObjective(ObjId::Pylons, ObjState::Done);
  SetObjective(ObjId::Nightjar, ObjState::Active);
  act = 3;
  actT = 0.0f;
  events.actChanged = true;
  events.act = 3;
  bossT = mission::BossRetry;   // call it in on the next frame
}

// ==================================================================
//  ACT 3 — ELIMINATE NIGHTJAR
// ==================================================================
void Mission::Act3(const MissionInput&, float dt) {
  if (!feed) {
    // No roster at all: the contract cannot be checked, so it is not
    // held against the player. Terminate rather than hang.
    pendWin = true;
    pendReason = EndReason::Boss;
    return;
  }

  if (!feed->BossSpawned()) {
    bossT += dt;
    if (bossT >= mission::BossRetry && bossTries < mission::BossTries) {
      bossT = 0.0f;
      ++bossTries;
      if (feed->RequestBoss()) {
        bossByMe = true;
        // NIGHTJAR walking on outranks anything still queued behind it
        Say(RadioBeat::Boss, true);
      }
    } else if (bossTries >= mission::BossTries) {
      // No hostile AC can be produced. The contract is still satisfied —
      // better a win the player earned against the garrison than a stage
      // nobody can finish.
      pendWin = true;
      pendReason = EndReason::Boss;
    }
    return;
  }

  // The boss may have been dropped by something other than us (a QA
  // harness calling it in directly). Adopt it without a cinematic.
  if (!bossByMe) {
    bossByMe = true;
    Say(RadioBeat::Boss, true);
  }

  if (!feed->BossAlive()) {
    pendWin = true;
    pendReason = EndReason::Boss;
  }
}

// ==================================================================
//  Host-driven feeds
// ==================================================================
void Mission::OnDamage(float amount, bool toPlayer) {
  if (over || amount <= 0.0f) return;
  if (toPlayer) log.DamageTaken(amount);
  else log.DamageDealt(amount);
  if (!saidContact && act == 1) {
    saidContact = true;
    Say(RadioBeat::Contact, false);
  }
}

void Mission::OnKill(cfg::EnemyKind kind) {
  if (over) return;
  log.Kill(kind);
  if (kind == cfg::EnemyKind::Boss) {
    pendWin = true;
    pendReason = EndReason::Boss;
  }
}

void Mission::OnStagger(bool isBoss) {
  if (over) return;
  log.Stagger();
  if (isBoss && !saidBossStagger) {
    saidBossStagger = true;
    Say(RadioBeat::BossStagger, false);
  }
}

void Mission::OnBossPhase(int n) {
  if (over || n <= bossPhase) return;
  bossPhase = n;
  // a reconfiguration beat is the most important thing on the channel
  Say(n == 1 ? RadioBeat::BossPhase2 : RadioBeat::BossPhase3, true);
}

// ==================================================================
//  Pressure calls
// ==================================================================
void Mission::TimeWarnings() {
  while (timeMark < 3 && timeLeft <= kTimeMarks[timeMark]) {
    const int m = timeMark;
    ++timeMark;
    events.warning = true;
    events.warningSeconds = static_cast<int>(kTimeMarks[m]);
    Say(kTimeBeats[m], true);
  }
}

void Mission::LowApCall(const MissionInput& in) {
  if (saidLowAp) return;
  const float maxAp = in.playerApMax > EPS ? in.playerApMax : cfg::Player::AP;
  if (in.playerAp > 0.0f && in.playerAp / maxAp < mission::LowApFrac) {
    saidLowAp = true;
    Say(RadioBeat::LowAp, true);
  }
}

// ==================================================================
//  Resolution
// ==================================================================
void Mission::CheckEnd(const MissionInput& in) {
  if (over) return;
  if (!in.playerAlive || in.playerAp <= 0.0f) {
    End(false, EndReason::Destroyed, in);
    return;
  }
  if (timeLeft <= 0.0f) {
    End(false, EndReason::Timeout, in);
    return;
  }
  if (pendWin) End(true, pendReason, in);
}

void Mission::End(bool won, EndReason reason, const MissionInput& in) {
  if (over) return;
  over = true;

  // close the objective board honestly
  for (int i = 0; i < static_cast<int>(ObjId::Count); ++i) {
    if (objectives[i].state != ObjState::Active) continue;
    if (won) {
      objectives[i].state = ObjState::Done;
      objectives[i].count = objectives[i].of;
    } else {
      objectives[i].state = ObjState::Failed;
    }
  }

  const int total = cfg::Player::RepairKits;
  int leftKits = in.repairKitsLeft;
  if (leftKits < 0) leftKits = 0;
  if (leftKits > total) leftKits = total;
  const int kitsUsed = total - leftKits;

  result = log.Compute(won, elapsed, timeLeft, kitsUsed, reason, in.playerApMax);
  score = result.score;

  events.finished = true;
  events.win = won;
  Say(won ? RadioBeat::Win
          : (reason == EndReason::Timeout ? RadioBeat::LoseTime : RadioBeat::LoseDead),
      true);
}

}  // namespace ob

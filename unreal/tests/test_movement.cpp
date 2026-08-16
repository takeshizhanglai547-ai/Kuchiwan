// ============================================================
//  ObCore — movement / EN / ACS verification.
//
//  This is Tier 1: everything in this file is COMPILED AND RUN in the
//  authoring container. Unreal is not installed and cannot be, so this
//  runner is the only place a number about the Unreal target can come
//  from honestly.
//
//  These suites are deliberately measurement-first. "PASS" on its own is
//  nearly worthless for a feel system — the quick-boost decay curve is
//  printed sample by sample, the assault-boost ramp is printed, the
//  frame-rate independence error is printed as a percentage. If the feel
//  ever drifts, the diff in these numbers is what shows it.
// ============================================================
#include <cstdarg>

#include "ObTypes.h"  // must precede ObConfig.h — see the note in ObEnergy.h
#include "ObConfig.h"
#include "ObEnergy.h"
#include "ObMovement.h"
#include "ObStagger.h"
#include "ObTest.h"
#include "ObWorldQuery.h"

using namespace ob;

namespace {

// ==================================================================
//  Test world: a flat deck plus axis-aligned boxes.
//
//  Implements the IWorldQuery seam the same way the Unreal host must:
//    * SampleHeight  — the highest walkable top under (x,z), ignoring
//                      anything more than mv::HeightTolerance above yRef
//    * SweepCapsule  — swept AABB (the capsule taken as its bounding box),
//                      with the web build's step banding: a solid whose top
//                      is at or below feet + mv::StepHeight is walked ONTO,
//                      not into, and one whose bottom is above the chest is
//                      walked UNDER. A ledge is either climbable or a wall,
//                      never both.
//  Reporting depth on a standing overlap exercises the solver's
//  depenetration path as well as its sweep path.
// ==================================================================
struct Box {
  Vec3 centre;
  Vec3 half;
};

class BoxWorld final : public IWorldQuery {
 public:
  float groundY = 0.0f;
  Box boxes[8];
  int count = 0;

  void Add(const Vec3& c, const Vec3& h) {
    if (count < 8) {
      boxes[count].centre = c;
      boxes[count].half = h;
      ++count;
    }
  }

  float SampleHeight(float x, float z, float yRef) const override {
    float best = groundY;
    for (int i = 0; i < count; ++i) {
      const Box& b = boxes[i];
      if (x < b.centre.x - b.half.x || x > b.centre.x + b.half.x) continue;
      if (z < b.centre.z - b.half.z || z > b.centre.z + b.half.z) continue;
      const float top = b.centre.y + b.half.y;
      if (top > yRef + mv::HeightTolerance) continue;
      if (top > best) best = top;
    }
    return best;
  }

  RayHit Raycast(const Vec3&, const Vec3&, float) const override { return {}; }

  SweepHit SweepCapsule(const Vec3& from, const Vec3& delta, float radius,
                        float height) const override {
    SweepHit best;
    const float bandLo = from.y + mv::StepHeight;
    const float bandHi = from.y + height * 0.92f;
    const float cy = from.y + height * 0.5f;
    const float da[3] = {delta.x, delta.y, delta.z};
    float bestT = 1.0f;

    for (int i = 0; i < count; ++i) {
      const Box& b = boxes[i];
      const float top = b.centre.y + b.half.y;
      const float bot = b.centre.y - b.half.y;
      if (top <= bandLo || bot >= bandHi) continue;

      const float ea[3] = {b.half.x + radius, b.half.y + height * 0.5f, b.half.z + radius};
      const float pa[3] = {from.x - b.centre.x, cy - b.centre.y, from.z - b.centre.z};

      // Standing overlap -> report a depenetration along the shallowest axis.
      if (std::fabs(pa[0]) < ea[0] && std::fabs(pa[1]) < ea[1] && std::fabs(pa[2]) < ea[2]) {
        int axis = 0;
        float least = 1e30f;
        for (int a = 0; a < 3; ++a) {
          const float push = ea[a] - std::fabs(pa[a]);
          if (push < least) {
            least = push;
            axis = a;
          }
        }
        SweepHit h;
        h.hit = true;
        h.time = 0.0f;
        h.depth = least;
        h.normal = Vec3{axis == 0 ? Sign(pa[0]) : 0.0f, axis == 1 ? Sign(pa[1]) : 0.0f,
                        axis == 2 ? Sign(pa[2]) : 0.0f};
        h.point = Vec3{from.x, cy, from.z};
        return h;
      }

      float tEnter = 0.0f;
      float tExit = 1.0f;
      int enterAxis = -1;
      float enterSign = 0.0f;
      bool miss = false;
      for (int a = 0; a < 3; ++a) {
        if (std::fabs(da[a]) < 1e-9f) {
          if (std::fabs(pa[a]) > ea[a]) {
            miss = true;
            break;
          }
          continue;
        }
        const float inv = 1.0f / da[a];
        float t1 = (-ea[a] - pa[a]) * inv;
        float t2 = (ea[a] - pa[a]) * inv;
        float sgn = -1.0f;  // entered through the -E face
        if (t1 > t2) {
          const float tmp = t1;
          t1 = t2;
          t2 = tmp;
          sgn = 1.0f;
        }
        if (t1 > tEnter) {
          tEnter = t1;
          enterAxis = a;
          enterSign = sgn;
        }
        if (t2 < tExit) tExit = t2;
        if (tEnter > tExit) {
          miss = true;
          break;
        }
      }
      if (miss || enterAxis < 0) continue;
      if (tEnter < 0.0f || tEnter > 1.0f) continue;
      if (tEnter < bestT) {
        bestT = tEnter;
        best.hit = true;
        best.time = tEnter;
        best.depth = 0.0f;
        best.normal = Vec3{enterAxis == 0 ? enterSign : 0.0f, enterAxis == 1 ? enterSign : 0.0f,
                           enterAxis == 2 ? enterSign : 0.0f};
        best.point = Vec3{from.x + delta.x * tEnter, cy + delta.y * tEnter,
                          from.z + delta.z * tEnter};
      }
    }
    return best;
  }
};

// ------------------------------------------------------------------
//  Small helpers. Nothing clever: the tests must be readable as a
//  description of the feel they are protecting.
// ------------------------------------------------------------------
MoveInput HoldForward() {
  MoveInput in;
  in.moveZ = 1.0f;
  return in;
}

/**
 * Run EXACTLY `secs` of simulation at `dt`, closing with a short frame when
 * the step size does not divide the duration. Without that final partial
 * frame a 33 ms run overshoots a 2 s target by 13 ms, and comparing it
 * against a 5 ms run then measures the overshoot rather than the solver.
 */
void Run(MechMover& m, const IWorldQuery& w, MoveInput in, float secs, float dt) {
  float t = 0.0f;
  while (t + dt <= secs + 1e-6f) {
    m.Step(in, w, dt);
    t += dt;
  }
  if (secs - t > 1e-6f) m.Step(in, w, secs - t);
}

void Line(const char* f, ...) {
  char buf[512];
  va_list a;
  va_start(a, f);
  std::vsnprintf(buf, sizeof(buf), f, a);
  va_end(a);
  std::printf("       %s\n", buf);
}

const float kFlat = 0.0f;  // ground plane height used by every flat-deck test

}  // namespace

// ==================================================================
void Suite_Movement() {
  obtest::Suite("ObMovement — quick boost");

  const float dt = 1.0f / 240.0f;
  BoxWorld flat;
  flat.groundY = kFlat;

  // ---- 1. the impulse ---------------------------------------------
  {
    MechMover m;
    m.Reset(Vec3{0.0f, kFlat, 0.0f}, 0.0f);
    MoveInput in = HoldForward();
    in.qbPressed = true;
    in.qbHeld = true;
    m.Step(in, flat, dt);

    // yaw 0 faces -Z, so a forward quick boost is a -Z impulse.
    const float along = -m.vel.z;
    const float perp = std::fabs(m.vel.x);
    obtest::Near("QB from rest injects QB_IMPULSE", m.speed, cfg::Player::QbImpulse,
                 cfg::Player::QbImpulse * 0.01, " m/s");
    obtest::Near("...along the input direction", along, m.speed, 1e-3, " m/s");
    obtest::Less("...with no lateral leak", perp, 1e-3, " m/s");
    obtest::True("QB reported to the host", m.events.quickBoosted);
    obtest::Near("QB costs QB_EN_COST", cfg::Player::EnCap - m.energy.en, cfg::Player::QbEnCost,
                 1.0, " EN");
    // The reload is armed inside the boost, which runs AFTER the frame's
    // timer decrement — so a fresh QB shows the full QB_RELOAD, not one
    // frame less.
    obtest::Near("QB arms the reload", m.qbCooldown, cfg::Player::QbReload, 1e-3, " s");
    obtest::True("QB leaves the ground", !m.grounded);
    Line("impulse %.2f m/s (config %.0f), lateral %.2g m/s, EN %.0f -> %.0f", m.speed,
         static_cast<double>(cfg::Player::QbImpulse), perp,
         static_cast<double>(cfg::Player::EnCap), m.energy.en);
  }

  // ---- 2. the decay curve — the whole reason for the model ---------
  {
    MechMover m;
    m.Reset(Vec3{0.0f, kFlat, 0.0f}, 0.0f);
    MoveInput in = HoldForward();
    in.qbPressed = true;
    in.qbHeld = true;
    m.Step(in, flat, dt);
    in.qbPressed = false;
    in.qbHeld = false;

    const float sampleAt[5] = {0.0f, 0.100f, 0.250f, 0.400f, 0.800f};
    float v[5] = {0, 0, 0, 0, 0};
    v[0] = m.speed;
    float peak = m.speed;
    float peakAt = 0.0f;
    float t = 0.0f;
    for (int s = 1; s < 5; ++s) {
      while (t < sampleAt[s] - dt * 0.5f) {
        m.Step(in, flat, dt);
        t += dt;
        if (m.speed > peak) {
          peak = m.speed;
          peakAt = t;
        }
      }
      v[s] = m.speed;
    }

    Line("QB decay:  0 ms %.1f | 100 ms %.1f | 250 ms %.1f | 400 ms %.1f | 800 ms %.1f  (m/s)",
         v[0], v[1], v[2], v[3], v[4]);
    Line("peak %.1f m/s at %.0f ms — the QB_TAIL thrust briefly outruns drag, then it all bleeds",
         peak, peakAt * 1000.0);
    Line("BOOST_SPEED is %.0f m/s — the curve must fall THROUGH it, not be clamped to it",
         static_cast<double>(cfg::Player::BoostSpeed));

    obtest::Greater("overspeed survives 100 ms", v[1], cfg::Player::BoostSpeed * 1.4, " m/s");
    obtest::Greater("still above BOOST_SPEED at 250 ms", v[2], cfg::Player::BoostSpeed, " m/s");
    // NOT monotonic from t=0: the quadratic thrust tail holds the burst up
    // for the length of the QB window and only then does drag win. What the
    // model must never do is CLAMP — so the peak has to sit inside the
    // thrust window and everything after it has to fall.
    obtest::Less("the peak sits inside the QB thrust window", peakAt, cfg::Player::QbDuration,
                 " s");
    obtest::True("...and past it the curve only falls", v[2] < v[1] && v[3] < v[2] && v[4] <= v[3]);
    obtest::InRange("settled to BOOST_SPEED by 800 ms", v[4], cfg::Player::BoostSpeed * 0.97,
                    cfg::Player::BoostSpeed * 1.03, " m/s");
  }

  // ---- 3. drag-then-top-up NEVER subtracts -------------------------
  {
    // Overspeeding along the wish direction: the accelerate pass must
    // contribute exactly nothing, leaving pure exponential drag. If the
    // solver ever lerps toward the wish speed, this number moves.
    MechMover m;
    m.Reset(Vec3{0.0f, kFlat, 0.0f}, 0.0f);
    m.vel = Vec3{0.0f, 0.0f, -100.0f};  // 100 m/s forward, well over BOOST_SPEED
    MoveInput in = HoldForward();
    m.Step(in, flat, dt);
    const double pureDrag = 100.0 * std::exp(-cfg::Player::BoostDrag * dt);
    obtest::Near("overspeed bleeds by drag alone, not by a lerp", m.speed, pureDrag, 1e-3,
                 " m/s");
    Line("100 m/s -> %.4f m/s in one %.2f ms frame; pure drag predicts %.4f", m.speed,
         dt * 1000.0, pureDrag);
  }

  // ---- 4. reload gate ---------------------------------------------
  {
    MechMover m;
    m.Reset(Vec3{0.0f, kFlat, 0.0f}, 0.0f);
    MoveInput in = HoldForward();
    in.qbPressed = true;
    m.Step(in, flat, dt);
    in.qbPressed = false;

    Run(m, flat, in, 0.30f, dt);  // inside QB_RELOAD (0.42 s)
    const float before = m.speed;
    const float enBefore = m.energy.en;
    in.qbPressed = true;
    m.Step(in, flat, dt);
    const bool refused = !m.events.quickBoosted && m.events.qbRefused;
    obtest::True("second QB inside QB_RELOAD is refused", refused);
    obtest::Less("...and costs no velocity", std::fabs(m.speed - before), 5.0, " m/s");
    obtest::Greater("...and costs no EN", m.energy.en - enBefore, -1e-3, " EN");
    Line("t=0.30 s: cooldown %.3f s remaining -> refused, EN %.0f untouched", m.qbCooldown,
         m.energy.en);

    in.qbPressed = false;
    Run(m, flat, in, 0.20f, dt);  // now past QB_RELOAD
    const float pre = m.speed;
    in.qbPressed = true;
    m.Step(in, flat, dt);
    obtest::True("a QB after QB_RELOAD is allowed", m.events.quickBoosted);
    obtest::Greater("...and injects speed", m.speed - pre, 40.0, " m/s");
    Line("t=0.50 s: cooldown clear -> boosted, %.1f -> %.1f m/s", pre, m.speed);
  }

  // ---- 5. insufficient EN ------------------------------------------
  {
    MechMover m;
    m.Reset(Vec3{0.0f, kFlat, 0.0f}, 0.0f);
    m.energy.en = cfg::Player::QbEnCost - 100.0f;  // 300 of the 400 needed
    MoveInput in = HoldForward();
    in.qbPressed = true;
    m.Step(in, flat, dt);

    obtest::True("QB with insufficient EN is refused",
                 !m.events.quickBoosted && m.events.qbRefused);
    obtest::Less("...and injects no speed", m.speed, 2.0, " m/s");
    obtest::Near("...and empties the tank", m.energy.en, 0.0, 1e-3, " EN");
    obtest::True("...and redlines", m.energy.overload && m.events.redlined);
    Line("300 EN vs a %.0f EN boost: refused, tank emptied, lockout %.2f s (the AC6 punish)",
         static_cast<double>(cfg::Player::QbEnCost), m.energy.lockout);
  }

  // ---- 6. neutral QB is a backstep ---------------------------------
  {
    MechMover m;
    m.Reset(Vec3{0.0f, kFlat, 0.0f}, 0.0f);
    MoveInput in;  // no stick input at all
    in.qbPressed = true;
    m.Step(in, flat, dt);
    obtest::Greater("a neutral QB kicks BACKWARD (yaw 0 faces -Z)", m.vel.z, 100.0, " m/s");
    Line("neutral QB velocity (%.1f, %.1f, %.1f) m/s", m.vel.x, m.vel.y, m.vel.z);
  }

  // ==================================================================
  obtest::Suite("ObMovement — assault boost");
  {
    MechMover m;
    m.Reset(Vec3{0.0f, kFlat, 0.0f}, 0.0f);
    MoveInput in = HoldForward();
    in.qbHeld = true;  // held, never tapped

    float ignitedAt = -1.0f;
    float enAtIgnition = 0.0f;
    float t = 0.0f;
    float vAt[4] = {0, 0, 0, 0};
    const float at[4] = {0.5f, 1.0f, 2.0f, 3.0f};
    int next = 0;
    while (t < 3.0f - 1e-6f) {
      m.Step(in, flat, dt);
      t += dt;
      if (m.events.abIgnited) {
        ignitedAt = t;
        enAtIgnition = m.energy.en;
      }
      if (next < 4 && t >= at[next] - dt * 0.5f) vAt[next++] = m.speed;
    }

    const float abTime = t - ignitedAt;
    const float predicted = cfg::Player::EnCap - cfg::Player::AbIgnition -
                            cfg::Player::AbEnDrain * abTime;

    obtest::Near("assault boost ignites after AB_HOLD", ignitedAt, mv::AbHold, 2.0 * dt, " s");
    obtest::Near("ignition costs AB_IGNITION", cfg::Player::EnCap - enAtIgnition,
                 cfg::Player::AbIgnition, 1.0, " EN");
    obtest::Near("AB reaches AB_SPEED", m.speed, cfg::Player::AbSpeed,
                 cfg::Player::AbSpeed * 0.02, " m/s");
    obtest::Near("EN spent is AB_IGNITION + drain*t", m.energy.en, predicted, 2.0, " EN");
    obtest::True("AB is still lit at 3 s", m.abActive);
    Line("AB ramp:  0.5 s %.1f | 1.0 s %.1f | 2.0 s %.1f | 3.0 s %.1f  (m/s, AB_SPEED %.0f)",
         vAt[0], vAt[1], vAt[2], vAt[3], static_cast<double>(cfg::Player::AbSpeed));
    Line("EN after %.2f s of AB: %.1f  (predicted %.0f - %.0f - %.0f*%.2f = %.1f)", abTime,
         m.energy.en, static_cast<double>(cfg::Player::EnCap),
         static_cast<double>(cfg::Player::AbIgnition), static_cast<double>(cfg::Player::AbEnDrain),
         abTime, predicted);

    // releasing the button drops it
    in.qbHeld = false;
    m.Step(in, flat, dt);
    obtest::True("releasing the button ends the AB", !m.abActive && m.events.abEnded);
  }

  // ==================================================================
  obtest::Suite("ObMovement — frame-rate independence");
  {
    // Same 2 s of identical input at 5 ms and at 33 ms. The QB is fired on
    // frame 0 in both runs so the discrete event lands at the same instant
    // and only the integration differs.
    auto run = [&](float step) {
      MechMover m;
      m.Reset(Vec3{0.0f, kFlat, 0.0f}, 0.0f);
      MoveInput in = HoldForward();
      in.qbPressed = true;
      m.Step(in, flat, step);
      in.qbPressed = false;
      Run(m, flat, in, 2.0f - step, step);  // exactly 2.000 s of sim in both runs
      return m.pos;
    };
    const Vec3 a = run(0.005f);
    const Vec3 b = run(0.033f);
    const float travelled = a.Length();
    const float err = Distance(a, b);
    const double pct = 100.0 * err / travelled;

    Line("2 s, QB + sustained boost:  5 ms -> (%.2f, %.2f, %.2f)", a.x, a.y, a.z);
    Line("                           33 ms -> (%.2f, %.2f, %.2f)", b.x, b.y, b.z);
    Line("travelled %.2f m, endpoint disagreement %.3f m = %.3f %%", travelled, err, pct);
    obtest::Less("5 ms vs 33 ms land within 2 %", pct, 2.0, " %");

    // ...and the same without the discrete event, isolating the solver.
    auto plain = [&](float step) {
      MechMover m;
      m.Reset(Vec3{0.0f, kFlat, 0.0f}, 0.0f);
      const MoveInput in = HoldForward();
      Run(m, flat, in, 2.0f, step);
      return m.pos;
    };
    const Vec3 c = plain(0.005f);
    const Vec3 e = plain(0.033f);
    const double pct2 = 100.0 * Distance(c, e) / c.Length();
    Line("sustained boost only: %.2f m vs %.2f m = %.3f %% apart", c.Length(), e.Length(), pct2);
    obtest::Less("...and so does a plain 2 s boost run", pct2, 2.0, " %");
  }

  // ==================================================================
  obtest::Suite("ObMovement — collision");
  {
    // Sub-step sizing: this is the guarantee against tunnelling.
    const float worstLen = cfg::Player::AbSpeed * mv::MaxFrameDt;
    const int steps = static_cast<int>(std::ceil(worstLen / mv::SubStepSpan));
    const float span = worstLen / static_cast<float>(steps);
    obtest::Less("worst-case sub-step is shorter than the capsule radius", span,
                 cfg::Player::Radius, " m");
    Line("at AB_SPEED and the %.0f ms frame clamp: %.2f m of motion / %d sub-steps = %.2f m each"
         " (radius %.1f m)",
         mv::MaxFrameDt * 1000.0, worstLen, steps, span,
         static_cast<double>(cfg::Player::Radius));

    // A blast wall 200 m ahead, 30 m tall and spanning the arena — clearly
    // not a step to climb, not a catwalk to duck under, and (deliberately)
    // not something the mech can drive around: a finite wall gets FLANKED
    // once the contact deflection slides the mech off its end, which is
    // correct behaviour but would make this test measure the wrong thing.
    // Drive into it at assault boost, at three frame rates including the
    // worst one the solver will ever be handed.
    const float wallZ = -200.0f;
    const float faceZ = wallZ + 4.0f + cfg::Player::Radius;  // nearest the capsule can sit
    const float testDt[3] = {1.0f / 120.0f, 1.0f / 30.0f, mv::MaxFrameDt};
    for (int k = 0; k < 3; ++k) {
      BoxWorld w;
      w.groundY = kFlat;
      w.Add(Vec3{0.0f, 15.0f, wallZ}, Vec3{600.0f, 15.0f, 4.0f});

      MechMover m;
      m.Reset(Vec3{0.0f, kFlat, 0.0f}, 0.0f);
      MoveInput in = HoldForward();
      in.qbHeld = true;
      float deepest = 0.0f;
      float topSpeed = 0.0f;
      const int n = static_cast<int>(6.0f / testDt[k]);
      for (int i = 0; i < n; ++i) {
        m.Step(in, w, testDt[k]);
        if (m.speed > topSpeed) topSpeed = m.speed;
        if (m.pos.z < deepest) deepest = m.pos.z;
      }
      const float overrun = faceZ - deepest;  // >0 means it got inside the face
      obtest::Less(
          obtest::Fmt("AB into a blast wall never enters it (dt %.0f ms)", testDt[k] * 1000.0)
              .c_str(),
          overrun, 0.05, " m of penetration");
      Line("dt %5.1f ms: peak %.1f m/s, %.2f m of travel per sub-step, deepest z %.3f m vs face"
           " %.3f m -> %+.4f m",
           testDt[k] * 1000.0, topSpeed,
           topSpeed * testDt[k] /
               std::fmax(1.0f, std::ceil(topSpeed * testDt[k] / mv::SubStepSpan)),
           deepest, faceZ, -overrun);
    }

    // A standing overlap must be pushed out, not tolerated.
    {
      BoxWorld w;
      w.groundY = kFlat;
      w.Add(Vec3{0.0f, 15.0f, -20.0f}, Vec3{20.0f, 15.0f, 6.0f});
      MechMover m;
      m.Reset(Vec3{0.0f, kFlat, -22.0f}, 0.0f);  // spawned INSIDE the box
      MoveInput in;
      for (int i = 0; i < 60; ++i) m.Step(in, w, 1.0f / 60.0f);
      const float clear = std::fabs(m.pos.z + 20.0f) - (6.0f + cfg::Player::Radius);
      obtest::Greater("a standing overlap is depenetrated", clear, -0.05, " m");
      Line("spawned 2 m inside a solid: ejected to z %.2f m, %.2f m clear of the surface",
           m.pos.z, clear);
    }
  }

  // ==================================================================
  obtest::Suite("ObMovement — vertical and arena");
  {
    // Terminal velocity. Gravity 68 m/s^2 against a 0.42 vertical drag
    // asymptotes at 161.9 m/s, so the V_TERMINAL clamp at 155 is what
    // actually binds — but only after a very long drop, so this one needs a
    // deep world, not the arena.
    BoxWorld deep;
    deep.groundY = -10000.0f;
    MechMover m;
    m.Reset(Vec3{0.0f, 0.0f, 0.0f}, 0.0f);
    m.grounded = false;
    const MoveInput in;
    float fastest = 0.0f;
    Run(m, deep, in, 12.0f, 1.0f / 120.0f);
    fastest = m.vel.y;
    obtest::Near("a long free fall settles at V_TERMINAL", fastest, mv::VTerminal, 0.5, " m/s");
    Line("12 s of free fall: %.2f m/s (gravity %.0f m/s^2 vs %.2f vertical drag asymptotes at"
         " %.1f, clamped to %.0f)",
         fastest, static_cast<double>(cfg::Player::Gravity), static_cast<double>(mv::AirVDrag),
         static_cast<double>(cfg::Player::Gravity / mv::AirVDrag),
         static_cast<double>(mv::VTerminal));

    // ...and the drop the player can actually take: the flight ceiling to
    // the deck. Worth knowing that it does NOT reach terminal velocity.
    MechMover c;
    c.Reset(Vec3{0.0f, cfg::Arena::Ceiling, 0.0f}, 0.0f);
    c.grounded = false;
    float impact = 0.0f;
    for (int i = 0; i < 2000; ++i) {
      c.Step(in, flat, 1.0f / 120.0f);
      if (c.vel.y < impact) impact = c.vel.y;
      if (c.grounded) break;
    }
    obtest::True("a fall from the flight ceiling is reported as a hard landing",
                 c.events.landed && c.events.hardLanding);
    obtest::Less("...and it never reaches terminal velocity", -impact, -mv::VTerminal, " m/s");
    Line("ceiling (%.0f m) to the deck: impact %.1f m/s, shake %.2f for %.2f s — short of the"
         " %.0f m/s clamp, so the ceiling is not high enough to terminal out",
         static_cast<double>(cfg::Arena::Ceiling), impact, c.events.shake, c.events.shakeTime,
         static_cast<double>(-mv::VTerminal));
  }
  {
    // jump apex
    MechMover m;
    m.Reset(Vec3{0.0f, kFlat, 0.0f}, 0.0f);
    MoveInput in;
    in.ascend = true;
    in.ascendPressed = true;
    m.Step(in, flat, 1.0f / 240.0f);
    // JUMP_IMPULSE is 46 m/s but V_ASCEND_MAX caps every climb at 44, so the
    // jump leaves the deck at 44. That is the web build's behaviour, not a
    // rounding artefact — the two constants genuinely disagree and the cap
    // wins. Asserted at its real value so a future change to either one is
    // caught here rather than felt in the cockpit.
    obtest::Near("a jump leaves the deck at the ascend cap", m.vel.y, mv::VAscendMax, 0.1,
                 " m/s");
    obtest::Greater("...because JUMP_IMPULSE exceeds it", cfg::Player::JumpImpulse,
                    mv::VAscendMax, " m/s");
    in.ascend = false;
    in.ascendPressed = false;
    float apex = 0.0f;
    for (int i = 0; i < 600; ++i) {
      m.Step(in, flat, 1.0f / 240.0f);
      if (m.pos.y > apex) apex = m.pos.y;
      if (m.grounded && i > 10) break;
    }
    obtest::InRange("jump apex clears the mech's own height", apex, cfg::Player::Height, 30.0,
                    " m");
    Line("jump: %.1f m/s off the deck (JUMP_IMPULSE %.0f clamped by V_ASCEND_MAX %.0f), apex"
         " %.2f m — the mech is %.0f m tall",
         static_cast<double>(mv::VAscendMax), static_cast<double>(cfg::Player::JumpImpulse),
         static_cast<double>(mv::VAscendMax), apex, static_cast<double>(cfg::Player::Height));
  }
  {
    // hover: climb rate cap and EN drain
    MechMover m;
    m.Reset(Vec3{0.0f, kFlat, 0.0f}, 0.0f);
    MoveInput in;
    in.ascend = true;
    in.ascendPressed = true;
    const float step = 1.0f / 120.0f;
    Run(m, flat, in, 1.5f, step);
    obtest::Near("hover climb is capped at V_ASCEND_MAX", m.vel.y, mv::VAscendMax, 0.5, " m/s");
    const float used = cfg::Player::EnCap - m.energy.en;
    obtest::Near("hover drains HOVER_EN_DRAIN per second", used / 1.5f,
                 cfg::Player::HoverEnDrain, 12.0, " EN/s");
    Line("1.5 s of hover: vy %.2f m/s (cap %.0f), %.0f EN used = %.0f EN/s (config %.0f)",
         m.vel.y, static_cast<double>(mv::VAscendMax), used, used / 1.5f,
         static_cast<double>(cfg::Player::HoverEnDrain));

    // ...and the ceiling holds
    MechMover c;
    c.Reset(Vec3{0.0f, cfg::Arena::Ceiling - 20.0f, 0.0f}, 0.0f);
    c.grounded = false;
    c.energy.cap = 1e9f;
    c.energy.en = 1e9f;
    Run(c, flat, in, 4.0f, step);
    obtest::Near("the flight ceiling holds", c.pos.y, cfg::Arena::Ceiling, 0.01, " m");
    Line("held ascend into the ceiling: y %.3f m (ceiling %.0f m), vy %.2f m/s", c.pos.y,
         static_cast<double>(cfg::Arena::Ceiling), c.vel.y);
  }
  {
    // arena soft wall: carve inward, never past the hard clamp
    MechMover m;
    m.Reset(Vec3{0.0f, kFlat, 300.0f}, PI);  // yaw PI faces +Z, outward
    MoveInput in = HoldForward();
    in.qbHeld = true;
    float maxR = 0.0f;
    bool warned = false;
    for (int i = 0; i < 900; ++i) {
      m.Step(in, flat, 1.0f / 120.0f);
      const float r = std::sqrt(m.pos.x * m.pos.x + m.pos.z * m.pos.z);
      if (r > maxR) maxR = r;
      if (m.events.boundsWarning) warned = true;
    }
    const float hard = cfg::Arena::Radius + mv::WallHardOver;
    obtest::Less("the soft wall holds an assault boost inside the arena", maxR, hard + 0.5,
                 " m");
    obtest::True("...and warns the pilot first", warned);
    Line("AB straight at the boundary: max radius %.2f m (soft wall %.0f m, hard clamp %.0f m)",
         maxR, static_cast<double>(cfg::Arena::Radius - mv::WallMargin),
         static_cast<double>(hard));
  }
  {
    // walk mode: a redlined mech is limited to WALK_SPEED
    MechMover m;
    m.Reset(Vec3{0.0f, kFlat, 0.0f}, 0.0f);
    m.energy.en = 10.0f;
    m.energy.Redline();
    const MoveInput in = HoldForward();
    Run(m, flat, in, 1.0f, 1.0f / 120.0f);
    obtest::Near("a redlined mech is held to WALK_SPEED", m.speed, cfg::Player::WalkSpeed, 1.0,
                 " m/s");
    Line("redlined: %.2f m/s (WALK_SPEED %.0f, BOOST_SPEED %.0f)", m.speed,
         static_cast<double>(cfg::Player::WalkSpeed),
         static_cast<double>(cfg::Player::BoostSpeed));
  }
  {
    // long scripted run: nothing may go non-finite
    MechMover m;
    m.Reset(Vec3{0.0f, kFlat, 120.0f}, 0.4f);
    Rng rng(20260816u);
    bool finite = true;
    for (int i = 0; i < 3000; ++i) {
      MoveInput in;
      in.moveX = rng.Signed();
      in.moveZ = rng.Signed();
      in.lookDx = rng.Signed() * 40.0f;
      in.lookDy = rng.Signed() * 40.0f;
      in.qbHeld = rng.Unit() > 0.55f;
      in.qbPressed = rng.Unit() > 0.9f;
      in.ascend = rng.Unit() > 0.7f;
      in.ascendPressed = rng.Unit() > 0.95f;
      in.descend = rng.Unit() > 0.85f;
      in.staggered = rng.Unit() > 0.93f;
      m.Step(in, flat, rng.Range(0.004f, 0.05f));
      if (!m.pos.IsFinite() || !m.vel.IsFinite() || !std::isfinite(m.yaw)) {
        finite = false;
        break;
      }
    }
    obtest::True("3000 frames of scripted chaos stay finite", finite);
    obtest::InRange("...and stay inside the arena", std::sqrt(m.pos.x * m.pos.x + m.pos.z * m.pos.z),
                    0.0, cfg::Arena::Radius + mv::WallHardOver + 0.5, " m");
    Line("after 3000 randomised frames: pos (%.1f, %.1f, %.1f), speed %.1f m/s, EN %.0f", m.pos.x,
         m.pos.y, m.pos.z, m.speed, m.energy.en);
  }
}

// ==================================================================
void Suite_Energy() {
  obtest::Suite("ObEnergy — spend, recharge, redline");

  const float dt = 1.0f / 1000.0f;

  // ---- how many quick boosts a full tank buys ----------------------
  {
    EnergyState e;
    int ok = 0;
    while (e.Spend(cfg::Player::QbEnCost)) ++ok;
    obtest::Near("a full tank buys 9 quick boosts, and the 10th redlines you", ok, 9.0, 0.0,
                 " boosts");
    obtest::True("...the refused one redlines", e.overload && e.en == 0.0f);
    Line("EN_CAP %.0f / QB_EN_COST %.0f: %d land, the next empties the tank",
         static_cast<double>(cfg::Player::EnCap), static_cast<double>(cfg::Player::QbEnCost), ok);
  }

  // ---- recovery delay ---------------------------------------------
  {
    EnergyState e;
    e.Spend(1000.0f);
    const float after = e.en;
    float t = 0.0f;
    while (e.en <= after && t < 1.0f) {
      e.Tick(dt, true);
      t += dt;
    }
    obtest::Near("recharge resumes after EN_RECOVERY_DELAY", t, cfg::Player::EnRecoveryDelay,
                 2.0 * dt, " s");
    Line("spend -> first recharge tick at %.3f s (config %.2f s)", t,
         static_cast<double>(cfg::Player::EnRecoveryDelay));
  }

  // ---- grounded vs airborne recharge -------------------------------
  {
    EnergyState g;
    g.en = 0.5f * cfg::Player::EnCap;
    for (int i = 0; i < 1000; ++i) g.Tick(dt, true);
    const float grounded = (g.en - 0.5f * cfg::Player::EnCap);

    EnergyState a;
    a.en = 0.5f * cfg::Player::EnCap;
    for (int i = 0; i < 1000; ++i) a.Tick(dt, false);
    const float air = (a.en - 0.5f * cfg::Player::EnCap);

    obtest::Near("grounded recharge is EN_RECHARGE/s", grounded, cfg::Player::EnRecharge, 2.0,
                 " EN/s");
    obtest::Near("airborne recharge is EN_RECHARGE_AIR/s", air, cfg::Player::EnRechargeAir, 2.0,
                 " EN/s");
    obtest::Greater("standing still recharges faster than flying", grounded, air, " EN/s");
    Line("1 s of recharge: grounded %.1f EN, airborne %.1f EN (%.0f %% of grounded)", grounded,
         air, 100.0 * air / grounded);
  }

  // ---- the redline lockout ----------------------------------------
  {
    EnergyState e;
    // drain to zero the way an assault boost does
    float drained = 0.0f;
    while (e.Drain(cfg::Player::AbEnDrain, dt)) drained += dt;
    obtest::True("draining to zero engages the redline", e.overload && e.Locked());
    obtest::Near("...after EN_CAP / AB_EN_DRAIN seconds", drained,
                 cfg::Player::EnCap / cfg::Player::AbEnDrain, 3.0 * dt, " s");
    obtest::Near("...for EN_REDLINE_DELAY", e.lockout, cfg::Player::EnRedlineDelay, 1e-3, " s");

    // recharge must be blocked for exactly that long
    float t = 0.0f;
    bool leaked = false;
    while (e.en <= 0.0f && t < 5.0f) {
      e.Tick(dt, true);
      t += dt;
      if (e.Locked() && e.en > 0.0f) leaked = true;
    }
    obtest::Near("recharge is blocked for exactly EN_REDLINE_DELAY", t,
                 cfg::Player::EnRedlineDelay, 2.0 * dt, " s");
    obtest::True("...not a single joule leaks during the lockout", !leaked);
    obtest::Near("...and the tank comes back at 30 % of capacity", e.en / cfg::Player::EnCap,
                 EnergyState::RestoreFrac, 0.01);
    Line("%.3f s of AB drains the tank; lockout %.2f s; recharge resumed at %.3f s with %.0f EN"
         " (%.0f %%)",
         drained, static_cast<double>(cfg::Player::EnRedlineDelay), t, e.en,
         100.0 * e.en / cfg::Player::EnCap);

    // ...and everything is refused while it runs
    EnergyState f;
    f.Drain(1e9f, 1.0f);
    obtest::True("every spend is refused while redlined",
                 !f.Spend(1.0f) && !f.Drain(1.0f, dt) && !f.CanAfford(1.0f));
  }

  // ---- the same thing through the mover ----------------------------
  {
    BoxWorld flat;
    flat.groundY = kFlat;
    MechMover m;
    m.Reset(Vec3{0.0f, kFlat, 0.0f}, 0.0f);
    MoveInput in = HoldForward();
    in.qbHeld = true;
    const float step = 1.0f / 120.0f;
    float t = 0.0f;
    float redlinedAt = -1.0f;
    float restoredAt = -1.0f;
    // A held AB redlines over and over; only the FIRST cycle is measured, or
    // the arithmetic straddles two different lockouts.
    for (int i = 0; i < 1600 && restoredAt < 0.0f; ++i) {
      m.Step(in, flat, step);
      t += step;
      if (m.events.redlined && redlinedAt < 0.0f) redlinedAt = t;
      if (m.events.enRestored && redlinedAt > 0.0f) restoredAt = t;
    }
    obtest::Greater("a sustained assault boost eventually redlines the mech", redlinedAt, 0.0,
                    " s");
    obtest::Near("...and the lockout lasts EN_REDLINE_DELAY", restoredAt - redlinedAt,
                 cfg::Player::EnRedlineDelay, 3.0 * step, " s");
    Line("held AB from full: redlined at %.2f s, EN restored at %.2f s (%.2f s locked out)",
         redlinedAt, restoredAt, restoredAt - redlinedAt);
  }
}

// ==================================================================
void Suite_Stagger() {
  obtest::Suite("ObStagger — ACS, decay and the punish");

  const float dt = 1.0f / 1000.0f;

  // ---- fill -------------------------------------------------------
  {
    StaggerState s;
    const float perHit = cfg::Rifle::Acs;
    int hits = 0;
    while (!s.staggered && hits < 100) {
      s.AddStrain(perHit);
      ++hits;
    }
    obtest::True("sustained rifle fire staggers", s.staggered);
    obtest::Near("...after ACS_CAP / rifle ACS hits", hits,
                 std::ceil(cfg::Player::AcsCap / perHit), 0.0, " hits");
    obtest::Near("the gauge is pinned full while staggered", s.acs, cfg::Player::AcsCap, 1e-3);
    obtest::Near("the stagger window is STAGGER_TIME", s.staggerTimer, cfg::Player::StaggerTime,
                 1e-3, " s");
    Line("%d rifle hits at %.0f ACS fill the %.0f gauge -> staggered for %.1f s", hits,
         static_cast<double>(perHit), static_cast<double>(cfg::Player::AcsCap),
         static_cast<double>(cfg::Player::StaggerTime));
  }

  // ---- decay delay + rate (measured) -------------------------------
  {
    StaggerState s;
    s.AddStrain(2000.0f);
    const float filled = s.acs;
    float t = 0.0f;
    float startedAt = -1.0f;
    float atDelay = 0.0f;
    while (t < cfg::Player::AcsDecayDelay - 2.0f * dt) {
      s.Tick(dt);
      t += dt;
    }
    atDelay = s.acs;
    // now let it bleed for exactly 1 s past the delay
    while (t < cfg::Player::AcsDecayDelay + 1.0f) {
      const float before = s.acs;
      s.Tick(dt);
      t += dt;
      if (startedAt < 0.0f && s.acs < before - 1e-4f) startedAt = t;
    }
    const float bled = atDelay - s.acs;

    obtest::Near("the gauge does not move before ACS_DECAY_DELAY", atDelay, filled, 1e-3);
    obtest::Near("decay starts at ACS_DECAY_DELAY", startedAt, cfg::Player::AcsDecayDelay,
                 3.0 * dt, " s");
    obtest::Near("...and runs at ACS_DECAY per second", bled, cfg::Player::AcsDecay, 3.0);
    Line("held at %.0f for %.2f s (config %.2f), then bled %.1f ACS in 1 s (config %.0f/s)",
         filled, startedAt, static_cast<double>(cfg::Player::AcsDecayDelay), bled,
         static_cast<double>(cfg::Player::AcsDecay));
  }

  // ---- sustained fire holds the gauge up ---------------------------
  {
    StaggerState s;
    float t = 0.0f;
    float sinceShot = 0.0f;
    float brokeAt = -1.0f;
    const float rof = 60.0f / cfg::Rifle::Rpm;
    while (t < 8.0f) {
      s.Tick(dt);
      t += dt;
      sinceShot += dt;
      if (sinceShot >= rof) {
        sinceShot -= rof;
        if (s.AddStrain(cfg::Rifle::Acs) && brokeAt < 0.0f) brokeAt = t;
      }
    }
    obtest::Greater("a held trigger outruns the decay", brokeAt, 0.0, " s");
    // The rifle's cadence (110 ms) is well inside ACS_DECAY_DELAY (550 ms),
    // so sustained fire never lets the decay start at all — the gauge fills
    // at the full rate. Break time is ACS_CAP / (ACS per second).
    obtest::Near("...staggering in ACS_CAP / rifle ACS-per-second", brokeAt,
                 cfg::Player::AcsCap / (cfg::Rifle::Acs * cfg::Rifle::Rpm / 60.0f), 0.15, " s");
    Line("LANCET at %.0f rpm = %.0f ACS/s vs %.0f ACS/s decay (never engaged: %.0f ms cadence"
         " < %.0f ms delay) -> stagger at %.2f s",
         static_cast<double>(cfg::Rifle::Rpm), cfg::Rifle::Acs * cfg::Rifle::Rpm / 60.0,
         static_cast<double>(cfg::Player::AcsDecay), rof * 1000.0,
         cfg::Player::AcsDecayDelay * 1000.0, brokeAt);
  }

  // ---- the direct-hit multiplier -----------------------------------
  {
    StaggerState s;
    const float base = cfg::Cannon::Damage;

    const HitResult plain = s.TakeHit(base, 0.0f, false);
    obtest::Near("a normal hit on a standing target is unscaled", plain.damage, base, 1e-2,
                 " AP");

    const HitResult direct = s.TakeHit(base, 0.0f, true);
    obtest::Near("a direct hit on a standing target is 1.18x", direct.damage,
                 base * StaggerState::DirectBonus, 1e-2, " AP");

    s.Reset();
    s.ForceStagger();
    const HitResult punish = s.TakeHit(base, 0.0f, false);
    obtest::Near("a hit on a STAGGERED target is exactly DIRECT_HIT_MULT x base", punish.damage,
                 base * cfg::Player::DirectHitMult, 1e-2, " AP");
    obtest::Near("...and the multiplier is reported as DIRECT_HIT_MULT", punish.multiplier,
                 cfg::Player::DirectHitMult, 1e-4);
    obtest::True("...and it is flagged as a punish hit", punish.wasStaggered);
    Line("PYRE cannon %.0f AP base -> %.0f standing, %.0f direct, %.0f into a stagger (%.2fx)",
         static_cast<double>(base), plain.damage, direct.damage, punish.damage,
         static_cast<double>(cfg::Player::DirectHitMult));
  }

  // ---- the hit that causes the stagger does not get the bonus -------
  {
    StaggerState s;
    s.acs = cfg::Player::AcsCap - 10.0f;
    const HitResult breaker = s.TakeHit(1000.0f, 50.0f, false);
    obtest::Near("the breaking hit itself is NOT multiplied", breaker.damage, 1000.0, 1e-2,
                 " AP");
    obtest::True("...but it does cause the stagger", breaker.causedStagger && s.staggered);
    const HitResult next = s.TakeHit(1000.0f, 50.0f, false);
    obtest::Near("...and the very next one is", next.damage, 1000.0 * cfg::Player::DirectHitMult,
                 1e-2, " AP");
    Line("gauge at %.0f/%.0f: breaking hit %.0f AP, follow-up %.0f AP",
         static_cast<double>(cfg::Player::AcsCap - 10.0f),
         static_cast<double>(cfg::Player::AcsCap), breaker.damage, next.damage);
  }

  // ---- the window closes and the gauge resets ----------------------
  {
    StaggerState s;
    s.ForceStagger();
    float t = 0.0f;
    while (s.staggered && t < 5.0f) {
      s.Tick(dt);
      t += dt;
    }
    obtest::Near("the stagger window lasts STAGGER_TIME", t, cfg::Player::StaggerTime,
                 2.0 * dt, " s");
    obtest::Near("...and recovery zeroes the gauge", s.acs, 0.0, 1e-4);
    obtest::True("...and reports the recovery", s.justRecovered);

    // strain during the window is ignored
    StaggerState p;
    p.ForceStagger();
    p.AddStrain(9999.0f);
    obtest::Near("strain during a stagger cannot extend it", p.staggerTimer,
                 cfg::Player::StaggerTime, 1e-4, " s");
    Line("stagger held %.3f s (config %.1f), gauge back to %.0f on recovery", t,
         static_cast<double>(cfg::Player::StaggerTime), s.acs);
  }

  // ---- a staggered mech can barely move ----------------------------
  {
    BoxWorld flat;
    flat.groundY = kFlat;
    MoveInput free = HoldForward();
    MoveInput broken = HoldForward();
    broken.staggered = true;

    MechMover a;
    a.Reset(Vec3{0.0f, kFlat, 0.0f}, 0.0f);
    Run(a, flat, free, 1.5f, 1.0f / 120.0f);

    MechMover b;
    b.Reset(Vec3{0.0f, kFlat, 0.0f}, 0.0f);
    Run(b, flat, broken, 1.5f, 1.0f / 120.0f);

    obtest::Less("a staggered mech is a sitting duck", b.speed, a.speed * 0.35, " m/s");
    Line("1.5 s of forward input: %.1f m/s standing, %.1f m/s staggered (authority %.2f)",
         a.speed, b.speed, static_cast<double>(mv::StaggerAuth));
  }
}

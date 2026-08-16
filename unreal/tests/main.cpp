// ============================================================
//  ObCore test runner.
//
//  Every suite is registered here. Systems are added by their owning
//  agent as they land; a suite that does not exist yet is simply not
//  listed, and the runner still gates on what does.
// ============================================================
#include <cstdarg>
#include "ObTest.h"
#include "ObTypes.h"
#include "ObConfig.h"
#include "ObWorldQuery.h"

using namespace ob;

void Suite_Types() {
  obtest::Suite("ObTypes");

  Vec3 v{3.0f, 4.0f, 0.0f};
  obtest::Near("length of (3,4,0)", v.Length(), 5.0, 1e-5);
  obtest::Near("normalised length", v.Normalised().Length(), 1.0, 1e-5);

  // Yaw convention must match the web build or every ported number shifts.
  Vec3 f = ForwardFromYaw(0.0f);
  obtest::Near("forward at yaw 0 is -Z", f.z, -1.0, 1e-5);
  Vec3 r = RightFromYaw(0.0f);
  obtest::Near("right at yaw 0 is +X", r.x, 1.0, 1e-5);
  obtest::Near("forward and right are perpendicular", Dot(f, r), 0.0, 1e-5);

  // The turn-rate limiter every guided weapon goes through.
  Vec3 a{1.0f, 0.0f, 0.0f};
  Vec3 b{0.0f, 0.0f, 1.0f};                       // 90 degrees away
  Vec3 t = TurnToward(a, b, 0.1f);
  obtest::Near("turn limited to 0.1 rad", std::acos(Clamp(Dot(a, t), -1.0f, 1.0f)), 0.1, 1e-4, " rad");
  obtest::Near("turn preserves unit length", t.Length(), 1.0, 1e-5);
  Vec3 t2 = TurnToward(a, b, 2.0f);               // more than needed
  obtest::Near("overshoot snaps to target", Dot(t2, b), 1.0, 1e-5);
  Vec3 t3 = TurnToward(a, -a, 0.1f);              // anti-parallel: must not NaN
  obtest::True("anti-parallel turn stays finite", t3.IsFinite());

  Rng rng(12345u);
  double sum = 0.0; float lo = 1e9f, hi = -1e9f;
  for (int i = 0; i < 20000; ++i) { const float u = rng.Unit(); sum += u; lo = std::fmin(lo, u); hi = std::fmax(hi, u); }
  obtest::Near("rng mean over 20k", sum / 20000.0, 0.5, 0.02);
  obtest::InRange("rng stays in [0,1)", hi, 0.9, 1.0);
  obtest::InRange("rng reaches low end", lo, 0.0, 0.1);
  Rng r1(999u), r2(999u);
  obtest::True("rng is deterministic per seed", r1.NextU32() == r2.NextU32());
}

void Suite_Config() {
  obtest::Suite("ObConfig — parity with the web build");
  // These are the numbers the web build was tuned to. A silent drift here
  // makes the two targets incomparable, so they are asserted, not trusted.
  obtest::Near("quick boost impulse", cfg::Player::QbImpulse, 118.0, 1e-4, " m/s");
  obtest::Near("quick boost EN cost", cfg::Player::QbEnCost, 400.0, 1e-4);
  obtest::Near("EN capacity", cfg::Player::EnCap, 4000.0, 1e-4);
  obtest::Near("assault boost top speed", cfg::Player::AbSpeed, 146.0, 1e-4, " m/s");
  obtest::Near("direct hit multiplier", cfg::Player::DirectHitMult, 1.62, 1e-4);
  obtest::Near("mech height", cfg::Player::Height, 11.0, 1e-4, " m");

  obtest::True("a light AC outguns an MT",
               cfg::Enemy(cfg::EnemyKind::AcLight).ap > cfg::Enemy(cfg::EnemyKind::MT).ap * 2.0f);
  obtest::True("every AC class is flagged as an AC",
               cfg::Enemy(cfg::EnemyKind::AcLight).isAC && cfg::Enemy(cfg::EnemyKind::AcMid).isAC
               && cfg::Enemy(cfg::EnemyKind::AcHeavy).isAC && cfg::Enemy(cfg::EnemyKind::Boss).isAC);
  obtest::True("MTs are not ACs", !cfg::Enemy(cfg::EnemyKind::MT).isAC);
  obtest::True("NIGHTJAR is the toughest frame",
               cfg::Enemy(cfg::EnemyKind::Boss).ap > cfg::Enemy(cfg::EnemyKind::AcHeavy).ap);
  obtest::Near("metres to Unreal units", M_TO_UU, 100.0, 1e-6);
}

// Suites added by their owning agents as systems land:
//   Suite_Movement();  Suite_Energy();  Suite_Stagger();
//   Suite_Ballistics(); Suite_AI();     Suite_Mission();

int main() {
  std::printf("\033[1mObCore test runner\033[0m — engine-free verification of the Unreal target\n");
  Suite_Types();
  Suite_Config();
  return obtest::Report();
}

// ============================================================
//  ObCore — combat suite: ObBallistics + ObWeapons.
//
//  Everything here is EXECUTED. The numbers this prints are the only
//  numbers about the loadout and the projectile maths that anyone may
//  quote: the Unreal module that consumes them cannot be compiled in
//  this container and is reviewed, not run.
//
//  The proofs that matter, in order of how much they would hurt if they
//  regressed:
//    1. 545 rpm is honoured at any frame rate (the accumulator).
//    2. Nothing tunnels — a 620 m/s round hits a target 400 m away even
//       when the step is 100 ms and covers 62 m.
//    3. A missile fired 90 degrees off-axis converges on a moving
//       target, and never turns faster than TurnRate doing it.
//    4. Splash is full at the epicentre and nothing at the rim.
// ============================================================
#include <cstdarg>
#include <cstdio>

#include "ObTest.h"

#include "ObTypes.h"
#include "ObBallistics.h"
#include "ObConfig.h"
#include "ObWeapons.h"
#include "ObWorldQuery.h"

using namespace ob;

namespace {

constexpr int kMaxTargets = 16;

// ------------------------------------------------------------------
//  Harness
// ------------------------------------------------------------------
struct Recorder final : public ICombatSink {
  int hits = 0;
  int worldHits = 0;
  int splashHits = 0;
  int directHits = 0;
  int explosions = 0;
  float total = 0.0f;
  float splashTotal = 0.0f;
  float perTarget[kMaxTargets] = {};
  Vec3 lastPoint;
  Vec3 lastWorldPoint;
  Vec3 lastExplosion;
  float lastExplosionRadius = 0.0f;
  WeaponId lastWeapon = WeaponId::Other;

  void OnHit(const HitEvent& e) override {
    if (!e.target) { ++worldHits; lastWorldPoint = e.point; return; }
    ++hits;
    total += e.damage;
    if (e.splash) { ++splashHits; splashTotal += e.damage; }
    if (e.direct) ++directHits;
    if (e.targetIndex >= 0 && e.targetIndex < kMaxTargets) perTarget[e.targetIndex] += e.damage;
    lastPoint = e.point;
    lastWeapon = e.weapon;
  }
  void OnExplosion(const ExplosionEvent& e) override {
    ++explosions;
    lastExplosion = e.position;
    lastExplosionRadius = e.radius;
  }
  void Clear() {
    hits = worldHits = splashHits = directHits = explosions = 0;
    total = splashTotal = 0.0f;
    for (int i = 0; i < kMaxTargets; ++i) perTarget[i] = 0.0f;
  }
};

/**
 * A deck at y = 0 plus one vertical wall, so the IWorldQuery seam — the only
 * thing standing between ObCore and a real level — is actually exercised.
 */
struct WallWorld final : public IWorldQuery {
  float wallZ = -200.0f;      // plane z = wallZ, normal +Z
  float groundY = 0.0f;

  float SampleHeight(float, float, float) const override { return groundY; }
  RayHit Raycast(const Vec3& origin, const Vec3& dir, float maxDist) const override {
    RayHit h;
    if (std::fabs(dir.z) < 1e-6f) return h;
    const float t = (wallZ - origin.z) / dir.z;
    if (t < 0.0f || t > maxDist) return h;
    h.hit = true;
    h.distance = t;
    h.point = origin + dir * t;
    h.normal = Vec3{0.0f, 0.0f, 1.0f};
    return h;
  }
  SweepHit SweepCapsule(const Vec3&, const Vec3&, float, float) const override { return {}; }
};

/** A world with a deck at y = 0 and nothing else in it. */
struct Scene {
  CombatTarget targets[kMaxTargets];
  int handles[kMaxTargets] = {};
  int count = 0;
  Recorder rec;
  EmptyWorld world;
  CombatContext ctx;

  Scene() {
    ctx.world = &world;
    ctx.sink = &rec;
    Sync();
  }

  void Sync() { ctx.enemies = TargetView(targets, count); }
  void SetWorld(const IWorldQuery* w) { ctx.world = w; }

  int AddStanding(const Vec3& feet, float radius, float height) {
    const int i = count++;
    targets[i] = CombatTarget{};
    targets[i].vol = StandingCapsule(feet, radius, height, 0.0f);
    targets[i].userData = &handles[i];
    Sync();
    return i;
  }
  /** A point-sized target: splash sampling with no capsule geometry in the way. */
  static constexpr float kPointRadius = 0.01f;
  int AddPoint(const Vec3& at) {
    const int i = count++;
    targets[i] = CombatTarget{};
    targets[i].vol.a = at;
    targets[i].vol.b = at;
    targets[i].vol.r = kPointRadius;
    targets[i].userData = &handles[i];
    Sync();
    return i;
  }
  const void* Handle(int i) const { return &handles[i]; }
};

static void MoveTarget(CombatTarget& t, float dt) {
  t.vol.a.AddScaled(t.vel, dt);
  t.vol.b.AddScaled(t.vel, dt);
}

/** A firer looking down `aim`, muzzles placed per AC_DESIGN's hardpoints. */
static FirerState MakeFirer(const Vec3& pos, const Vec3& aim) {
  FirerState f;
  const Vec3 d = aim.Normalised();
  const float yaw = std::atan2(-d.x, -d.z);
  f.pos = pos;
  f.eye = pos + Vec3{0.0f, 8.9f, 0.0f};
  f.aimDir = d;
  f.aimPoint = f.eye + d * 900.0f;
  f.forward = ForwardFromYaw(yaw);
  f.right = RightFromYaw(yaw);
  f.pitch = std::asin(Clamp(d.y, -1.0f, 1.0f));
  f.muzzle[0] = pos + f.right * 3.1f + f.forward * 2.2f + Vec3{0.0f, 7.6f, 0.0f};  // R-arm
  f.muzzle[1] = pos - f.right * 3.1f + f.forward * 2.2f + Vec3{0.0f, 7.6f, 0.0f};  // L-arm
  f.muzzle[2] = pos + f.right * 2.4f + Vec3{0.0f, 9.8f, 0.0f};                     // R-back
  f.muzzle[3] = pos - f.right * 2.4f + f.forward * 1.2f + Vec3{0.0f, 9.8f, 0.0f};  // L-back
  return f;
}

// ==================================================================
//  1. The rifle accumulator — frame-rate independence
// ==================================================================
struct BurstResult {
  int rounds = 0;
  int frames = 0;
  double elapsed = 0.0;
  double firstShot = -1.0;
  double lastShot = -1.0;
};

/** Hold the trigger for exactly `seconds`; the tail frame is shortened to land on it. */
static BurstResult HoldTrigger(double seconds, double dt) {
  WeaponSystem w;
  Ballistics b;
  Scene sc;
  const FirerState f = MakeFirer(Vec3{0.0f, 0.0f, 0.0f}, Vec3{0.0f, 0.0f, -1.0f});
  WeaponInput in;
  in.rifle = true;
  WeaponOutput out;

  BurstResult r;
  while (r.elapsed < seconds - 1e-9) {
    double step = dt;
    if (r.elapsed + step > seconds) step = seconds - r.elapsed;
    w.Update(static_cast<float>(step), in, f, b, sc.ctx, out);
    r.elapsed += step;
    ++r.frames;
    if (out.rifleRounds > 0) {
      if (r.firstShot < 0.0) r.firstShot = r.elapsed;
      r.lastShot = r.elapsed;
      r.rounds += out.rifleRounds;
    }
  }
  return r;
}

static void TestRifleRate() {
  obtest::Suite("ObWeapons — MG-014 LANCET rate, frame-rate independence");

  const double nominal = cfg::Rifle::Rpm / 60.0;   // 9.0833 rounds in 1.000 s
  const double dts[3] = {0.008, 0.016, 0.050};
  int counts[3] = {0, 0, 0};

  for (int i = 0; i < 3; ++i) {
    const BurstResult r = HoldTrigger(1.0, dts[i]);
    counts[i] = r.rounds;
    obtest::Near(obtest::Fmt("1.000 s held at dt=%.0f ms", dts[i] * 1000.0).c_str(),
                 r.rounds, nominal, 1.0, " rounds");
    std::printf("       %3d frames, %d rounds, first at %.4f s, last at %.4f s\n",
                r.frames, r.rounds, r.firstShot, r.lastShot);
  }
  obtest::True("count identical at 125 / 62.5 / 20 fps",
               counts[0] == counts[1] && counts[1] == counts[2],
               obtest::Fmt("8 ms -> %d,  16 ms -> %d,  50 ms -> %d", counts[0], counts[1], counts[2]));

  // The exact rate: 24 rounds is 23 intervals. Sampled at 1 ms so the
  // measurement error is under 0.25 rpm.
  const BurstResult mag = HoldTrigger(2.60, 0.001);
  const double span = mag.lastShot - mag.firstShot;
  const double rpm = span > 0.0 ? (mag.rounds - 1) * 60.0 / span : 0.0;
  obtest::Near("measured rpm over a full magazine", rpm, cfg::Rifle::Rpm, 1.0, " rpm");
  std::printf("       %d rounds over %.4f s  ->  interval %.5f s (nominal %.5f s)\n",
              mag.rounds, span, span / (mag.rounds - 1), 60.0 / cfg::Rifle::Rpm);

  // A 10 s hold crosses several magazines and reloads at every frame rate.
  int longCounts[3] = {0, 0, 0};
  for (int i = 0; i < 3; ++i) longCounts[i] = HoldTrigger(10.0, dts[i]).rounds;
  const int lo = longCounts[0] < longCounts[1]
                     ? (longCounts[0] < longCounts[2] ? longCounts[0] : longCounts[2])
                     : (longCounts[1] < longCounts[2] ? longCounts[1] : longCounts[2]);
  const int hi = longCounts[0] > longCounts[1]
                     ? (longCounts[0] > longCounts[2] ? longCounts[0] : longCounts[2])
                     : (longCounts[1] > longCounts[2] ? longCounts[1] : longCounts[2]);
  obtest::True("10 s hold, magazines + reloads, agrees across dt", hi - lo <= 1,
               obtest::Fmt("8 ms -> %d,  16 ms -> %d,  50 ms -> %d rounds",
                           longCounts[0], longCounts[1], longCounts[2]));
}

// ==================================================================
//  2. Magazine, reload, and the damage a magazine is worth
// ==================================================================
static void TestMagazineAndReload() {
  obtest::Suite("ObWeapons — magazine, reload, magazine damage");

  {
    WeaponSystem w;
    Ballistics b;
    Scene sc;
    const FirerState f = MakeFirer(Vec3{0.0f, 0.0f, 0.0f}, Vec3{0.0f, 0.0f, -1.0f});
    WeaponInput in;
    in.rifle = true;
    WeaponOutput out;

    const double dt = 0.001;
    double t = 0.0;
    int rounds = 0;
    int roundsAtReload = -1;
    double reloadStart = -1.0;
    double reloadEnd = -1.0;
    int ammoAfter = -1;
    int magAfter = -1;

    while (t < 8.0) {
      w.Update(static_cast<float>(dt), in, f, b, sc.ctx, out);
      t += dt;
      rounds += out.rifleRounds;
      if (out.reloadStarted && reloadStart < 0.0) {
        reloadStart = t;
        roundsAtReload = rounds;
      }
      if (out.reloadFinished && reloadStart >= 0.0) {
        reloadEnd = t;
        ammoAfter = w.State().rifle.ammo;
        magAfter = w.State().rifle.mag;
        break;
      }
    }
    obtest::Near("magazine empties at Magazine rounds", roundsAtReload, cfg::Rifle::Magazine, 0.0,
                 " rounds");
    obtest::Near("reload takes ReloadTime", reloadEnd - reloadStart, cfg::Rifle::ReloadTime, 0.002,
                 " s");
    obtest::Near("magazine is full again", magAfter, cfg::Rifle::Magazine, 0.0);
    obtest::Near("reserve drops by one magazine", ammoAfter,
                 cfg::Rifle::Ammo - cfg::Rifle::Magazine, 0.0, " rounds");
  }

  // ---- total damage of one magazine --------------------------------
  {
    WeaponSystem w;
    Ballistics b;
    Scene sc;
    sc.AddStanding(Vec3{0.0f, -2.0f, -60.0f}, 8.0f, 24.0f);   // a barn door at 60 m
    const FirerState f = MakeFirer(Vec3{0.0f, 0.0f, 0.0f}, Vec3{0.0f, 0.0f, -1.0f});
    WeaponInput in;
    in.rifle = true;
    WeaponOutput out;

    const float dt = 0.004f;
    int rounds = 0;
    bool emptied = false;
    for (int i = 0; i < 4000; ++i) {
      w.Update(dt, in, f, b, sc.ctx, out);
      rounds += out.rifleRounds;
      b.Update(dt, sc.ctx);
      if (out.reloadStarted) { emptied = true; in.rifle = false; }
      if (emptied && b.GetCounts().bullets == 0) break;
    }
    const float want = cfg::Rifle::Damage * static_cast<float>(cfg::Rifle::Magazine);
    obtest::Near("rounds fired before the magazine ran dry", rounds, cfg::Rifle::Magazine, 0.0);
    obtest::Near("full magazine damage == Damage * Magazine", sc.rec.total, want, 0.5);
    obtest::Near("every round connected", sc.rec.hits, cfg::Rifle::Magazine, 0.0, " hits");
    std::printf("       %d rounds x %.0f = %.0f dealt (%.0f expected), spread cone %.5f rad at heat %.2f\n",
                rounds, static_cast<double>(cfg::Rifle::Damage), static_cast<double>(sc.rec.total),
                static_cast<double>(want), static_cast<double>(w.State().rifle.spread),
                static_cast<double>(w.State().rifle.heat));
  }

  // ---- the whole load, down to the dry click ------------------------
  {
    WeaponSystem w;
    Ballistics b;
    Scene sc;
    const FirerState f = MakeFirer(Vec3{0.0f, 0.0f, 0.0f}, Vec3{0.0f, 0.0f, -1.0f});
    WeaponInput in;
    in.rifle = true;
    WeaponOutput out;

    const float dt = 0.02f;
    int rounds = 0;
    int reloads = 0;
    double t = 0.0;
    bool dry = false;
    for (int i = 0; i < 20000; ++i) {
      w.Update(dt, in, f, b, sc.ctx, out);
      t += dt;
      rounds += out.rifleRounds;
      if (out.reloadStarted) ++reloads;
      if (out.dryFire) { dry = true; break; }
    }
    obtest::True("the rifle eventually runs dry", dry);
    obtest::Near("the whole load is Magazine + Ammo", rounds,
                 cfg::Rifle::Magazine + cfg::Rifle::Ammo, 0.0, " rounds");
    std::printf("       %d rounds over %.1f s through %d reloads = %.0f damage if every one lands\n",
                rounds, t, reloads,
                static_cast<double>(rounds) * static_cast<double>(cfg::Rifle::Damage));
  }

  // ---- recoil accumulates and bleeds back ---------------------------
  {
    WeaponSystem w;
    Ballistics b;
    Scene sc;
    FirerState f = MakeFirer(Vec3{0.0f, 0.0f, 0.0f}, Vec3{0.0f, 0.0f, -1.0f});
    WeaponInput in;
    in.rifle = true;
    WeaponOutput out;

    const float dt = 0.004f;
    float pitch = 0.0f;
    float peak = 0.0f;
    float spreadPeak = 0.0f;
    for (int i = 0; i < 250; ++i) {            // 1.0 s on the trigger
      f.pitch = pitch;
      w.Update(dt, in, f, b, sc.ctx, out);
      pitch += out.pitchDelta;
      peak = std::fmax(peak, pitch);
      spreadPeak = std::fmax(spreadPeak, w.State().rifle.spread);
    }
    const float climbed = pitch;
    in.rifle = false;
    float halfSecond = 0.0f;
    for (int i = 0; i < 750; ++i) {            // 3.0 s of recovery
      f.pitch = pitch;
      w.Update(dt, in, f, b, sc.ctx, out);
      pitch += out.pitchDelta;
      if (i == 125) halfSecond = pitch;
    }
    obtest::Greater("a 1 s burst climbs the aim", climbed, 0.02, " rad");
    obtest::Less("half the climb is gone within 0.5 s", halfSecond, climbed * 0.5f, " rad");
    obtest::Less("the climb is fully handed back", std::fabs(pitch), 0.002, " rad");
    obtest::Greater("spread grows with sustained fire", spreadPeak, cfg::Rifle::Spread * 1.5,
                    " rad");
    std::printf("       climb %.4f rad (%.2f deg, peak %.4f), %.4f rad after 0.5 s, %.5f after 3 s\n",
                static_cast<double>(climbed), static_cast<double>(climbed) * 180.0 / 3.14159265,
                static_cast<double>(peak), static_cast<double>(halfSecond),
                static_cast<double>(pitch));
    std::printf("       spread %.5f -> %.5f rad (x%.2f) at heat 1.0\n",
                static_cast<double>(cfg::Rifle::Spread), static_cast<double>(spreadPeak),
                static_cast<double>(spreadPeak / cfg::Rifle::Spread));
  }
}

// ==================================================================
//  3. The tunnelling proof
// ==================================================================
struct ShotResult {
  bool hit = false;
  float dist = 0.0f;
  float drop = 0.0f;
  Vec3 point;
  int frames = 0;
  double flight = 0.0;
};

static ShotResult FireAtRange(double dt, float range) {
  Scene sc;
  sc.AddStanding(Vec3{0.0f, 0.0f, -range}, 4.0f, 11.0f);
  const Vec3 muzzle{0.0f, sc.targets[0].vol.Centre().y, 0.0f};

  Ballistics b;
  BulletSpawn s;
  s.origin = muzzle;
  s.dir = Vec3{0.0f, 0.0f, -1.0f};
  s.speed = cfg::Rifle::Speed;
  s.damage = cfg::Rifle::Damage;
  s.impact = cfg::Rifle::Impact;
  s.acs = cfg::Rifle::Acs;
  s.maxDist = wpn::RifleRange;
  s.drop = wpn::RifleDrop;
  b.SpawnBullet(s);

  ShotResult r;
  for (int i = 0; i < 4000; ++i) {
    b.Update(static_cast<float>(dt), sc.ctx);
    ++r.frames;
    r.flight += dt;
    if (sc.rec.hits > 0) {
      r.hit = true;
      r.point = sc.rec.lastPoint;
      r.dist = (r.point - muzzle).Length();
      r.drop = muzzle.y - r.point.y;
      break;
    }
    if (b.GetCounts().bullets == 0) break;
  }
  return r;
}

/** What a naive per-frame POINT test would have done with the same steps. */
static bool NaivePointTest(double dt, float range) {
  const HitCapsule cap = StandingCapsule(Vec3{0.0f, 0.0f, -range}, 4.0f, 11.0f);
  Vec3 p{0.0f, cap.Centre().y, 0.0f};
  Vec3 v{0.0f, 0.0f, -cfg::Rifle::Speed};
  for (int i = 0; i < 4000; ++i) {
    v.y -= wpn::RifleDrop * static_cast<float>(dt);
    p.AddScaled(v, static_cast<float>(dt));
    if (SurfaceDist(cap, p) <= 0.0f) return true;
    if (p.z < -(range + 200.0f)) return false;
  }
  return false;
}

static void TestTunnelling() {
  obtest::Suite("ObBallistics — swept segments do not tunnel");

  const float range = 400.0f;
  const ShotResult fine = FireAtRange(0.001, range);
  const ShotResult normal = FireAtRange(0.016, range);
  const ShotResult coarse = FireAtRange(0.100, range);

  obtest::True("620 m/s round connects at 400 m, dt = 1 ms", fine.hit,
               obtest::Fmt("hit at %.2f m after %d frames", fine.dist, fine.frames));
  obtest::True("...and at dt = 16 ms", normal.hit,
               obtest::Fmt("hit at %.2f m after %d frames", normal.dist, normal.frames));
  obtest::True("...and at dt = 100 ms (62 m of travel per step)", coarse.hit,
               obtest::Fmt("hit at %.2f m after %d frames", coarse.dist, coarse.frames));
  obtest::Near("hit distance is the same at 1 ms and 100 ms", coarse.dist, fine.dist, 0.5, " m");

  // Beyond kMaxStep the sim deliberately runs SLOW rather than teleporting:
  // a 500 ms hitch is integrated as a 100 ms step, so the line still holds.
  const ShotResult hitch = FireAtRange(0.500, range);
  obtest::True("a 500 ms hitch still cannot tunnel (dt is clamped to kMaxStep)", hitch.hit,
               obtest::Fmt("hit at %.2f m after %d frames", hitch.dist, hitch.frames));

  const bool naiveFine = NaivePointTest(0.001, range);
  const bool naiveCoarse = NaivePointTest(0.100, range);
  obtest::True("a naive point test misses at dt = 100 ms — this is what the sweep is for",
               !naiveCoarse, obtest::Fmt("naive: 1 ms -> %s, 100 ms -> %s",
                                         naiveFine ? "hit" : "MISS", naiveCoarse ? "hit" : "MISS"));

  std::printf("       step at dt=100 ms is %.1f m; target capsule is r=4.0 m, %.1f m tall\n",
              static_cast<double>(cfg::Rifle::Speed) * 0.1, 11.0);
  std::printf("       swept hit points: 1 ms (%.3f, %.3f, %.3f) | 100 ms (%.3f, %.3f, %.3f)\n",
              static_cast<double>(fine.point.x), static_cast<double>(fine.point.y),
              static_cast<double>(fine.point.z), static_cast<double>(coarse.point.x),
              static_cast<double>(coarse.point.y), static_cast<double>(coarse.point.z));
  std::printf("       ballistic drop at the impact point: %.3f m (1 ms) / %.3f m (100 ms)\n",
              static_cast<double>(fine.drop), static_cast<double>(coarse.drop));
}

// ==================================================================
//  3b. The host seam — level geometry stops rounds, the deck stops missiles
// ==================================================================
static void TestWorldSeam() {
  obtest::Suite("ObBallistics — the IWorldQuery seam");

  // A wall at 200 m in front of a target at 400 m: the round must die on
  // the wall and the target must take nothing.
  {
    Scene sc;
    WallWorld wall;
    wall.wallZ = -200.0f;
    sc.SetWorld(&wall);
    sc.AddStanding(Vec3{0.0f, 0.0f, -400.0f}, 4.0f, 11.0f);

    Ballistics b;
    BulletSpawn s;
    s.origin = Vec3{0.0f, 5.5f, 0.0f};
    s.dir = Vec3{0.0f, 0.0f, -1.0f};
    s.speed = cfg::Rifle::Speed;
    s.damage = cfg::Rifle::Damage;
    s.impact = cfg::Rifle::Impact;
    s.maxDist = wpn::RifleRange;
    b.SpawnBullet(s);
    for (int i = 0; i < 200 && b.GetCounts().bullets >= 0; ++i) {
      b.Update(0.016f, sc.ctx);
      if (sc.rec.worldHits > 0 || sc.rec.hits > 0) break;
    }
    obtest::Near("cover stops the round", sc.rec.worldHits, 1.0, 0.0, " world hits");
    obtest::Near("the target behind it takes nothing", sc.rec.perTarget[0], 0.0, 1e-6);
    obtest::Near("...and it dies on the wall plane", sc.rec.lastWorldPoint.z, -200.0, 0.01, " m");
  }

  // Same shot, wall moved behind the target: the entity is nearer, so it wins.
  {
    Scene sc;
    WallWorld wall;
    wall.wallZ = -500.0f;
    sc.SetWorld(&wall);
    sc.AddStanding(Vec3{0.0f, 0.0f, -400.0f}, 4.0f, 11.0f);

    Ballistics b;
    BulletSpawn s;
    s.origin = Vec3{0.0f, 5.5f, 0.0f};
    s.dir = Vec3{0.0f, 0.0f, -1.0f};
    s.speed = cfg::Rifle::Speed;
    s.damage = cfg::Rifle::Damage;
    s.impact = cfg::Rifle::Impact;
    s.maxDist = wpn::RifleRange;
    b.SpawnBullet(s);
    for (int i = 0; i < 200; ++i) {
      b.Update(0.016f, sc.ctx);
      if (sc.rec.worldHits > 0 || sc.rec.hits > 0) break;
    }
    obtest::Near("a nearer frame wins over geometry behind it", sc.rec.perTarget[0],
                 cfg::Rifle::Damage, 0.01);
    obtest::Near("and no world hit is reported", sc.rec.worldHits, 0.0, 0.0);
  }

  // A missile with nothing to chase falls on a ballistic arc and strikes the deck.
  {
    Scene sc;
    Ballistics b;
    MissileSpawn m;
    m.origin = Vec3{0.0f, 60.0f, 0.0f};
    m.dir = Vec3{0.0f, 0.0f, -1.0f};
    m.armTime = 0.0f;
    b.SpawnMissile(m);
    double t = 0.0;
    for (int i = 0; i < 2000 && sc.rec.explosions == 0; ++i) {
      b.Update(0.004f, sc.ctx);
      t += 0.004;
    }
    obtest::Near("an unguided missile detonates on the deck", sc.rec.explosions, 1.0, 0.0);
    obtest::Near("at deck level", sc.rec.lastExplosion.y, 0.4, 0.05, " m");
    std::printf("       ballistic fall from 60 m took %.3f s, burst at y = %.2f m, radius %.1f m\n",
                t, static_cast<double>(sc.rec.lastExplosion.y),
                static_cast<double>(sc.rec.lastExplosionRadius));
  }
}

// ==================================================================
//  4. Missiles — convergence, turn-rate limit, arming
// ==================================================================
struct MissileRun {
  bool detonated = false;
  double time = 0.0;
  float minSurface = 1e9f;      // closest sampled approach to the target's SKIN
  float missSkin = 0.0f;        // detonation point -> target SKIN
  float missAxis = 0.0f;        // detonation point -> target AXIS
  float maxTurnRate = 0.0f;     // rad/s, over the guided part of the flight
  float turnedDuringArm = 0.0f; // total heading change while arming
  float armEndHeadingErr = 0.0f;// how far off the target it still points at handover
  int frames = 0;
};

/** Well-conditioned angle between two unit vectors — acos() is not, near 0. */
static float AngleBetween(const Vec3& a, const Vec3& b) {
  return std::atan2(Cross(a, b).Length(), Dot(a, b));
}

static MissileRun RunMissile(const Vec3& launchPos, const Vec3& launchDir, const Vec3& drift,
                             float armTime, const Vec3& targetFeet, const Vec3& targetVel,
                             double dt, double maxTime) {
  Scene sc;
  const int ti = sc.AddStanding(targetFeet, 4.0f, 11.0f);
  sc.targets[ti].vel = targetVel;

  Ballistics b;
  MissileSpawn m;
  m.origin = launchPos;
  m.dir = launchDir;
  m.drift = drift;
  m.target = sc.Handle(ti);
  m.armTime = armTime;
  b.SpawnMissile(m);

  MissileRun r;
  bool armed = false;
  while (r.time < maxTime) {
    // the live missile, before the step
    const GuidedMissile* live = nullptr;
    for (int i = 0; i < Ballistics::MaxMissiles; ++i) {
      if (b.Missiles()[i].used) { live = &b.Missiles()[i]; break; }
    }
    if (!live) break;
    const Vec3 prevDir = live->dir;
    const bool wasArming = live->armT > 0.0f;

    MoveTarget(sc.targets[ti], static_cast<float>(dt));
    b.Update(static_cast<float>(dt), sc.ctx);
    r.time += dt;
    ++r.frames;

    live = nullptr;
    for (int i = 0; i < Ballistics::MaxMissiles; ++i) {
      if (b.Missiles()[i].used) { live = &b.Missiles()[i]; break; }
    }
    if (!live) {
      r.detonated = sc.rec.explosions > 0;
      if (r.detonated) {
        const HitCapsule& v = sc.targets[ti].vol;
        r.missAxis = (sc.rec.lastExplosion - ClosestOnAxis(v, sc.rec.lastExplosion)).Length();
        r.missSkin = SurfaceDist(v, sc.rec.lastExplosion);
        r.minSurface = std::fmin(r.minSurface, r.missSkin);
      }
      break;
    }

    const float turned = AngleBetween(prevDir, live->dir);
    if (wasArming) {
      r.turnedDuringArm += turned;
    } else {
      if (!armed) {
        armed = true;
        const Vec3 los = (sc.targets[ti].vol.Centre() - live->pos).Normalised();
        r.armEndHeadingErr = AngleBetween(los, live->dir);
      }
      r.maxTurnRate = std::fmax(r.maxTurnRate, turned / static_cast<float>(dt));
    }
    r.minSurface = std::fmin(r.minSurface, SurfaceDist(sc.targets[ti].vol, live->pos));
  }
  return r;
}

static void TestMissiles() {
  obtest::Suite("ObBallistics — VP-60LCS proportional navigation");

  // Launched along +X at a target 220 m away in -Z: exactly 90 degrees
  // off-axis, crossing at 30 m/s.
  const MissileRun cross = RunMissile(Vec3{0.0f, 30.0f, 0.0f}, Vec3{1.0f, 0.0f, 0.0f}, Vec3{},
                                      cfg::Missile::ArmTime, Vec3{0.0f, 24.5f, -220.0f},
                                      Vec3{30.0f, 0.0f, 0.0f}, 0.002, 12.0);
  obtest::True("90-degree off-axis launch intercepts a 30 m/s crosser", cross.detonated,
               obtest::Fmt("detonated after %.3f s", cross.time));
  obtest::Less("miss distance from the hull", cross.missSkin, 2.0f, " m");
  obtest::Less("...which is well inside the blast radius", cross.missSkin,
               cfg::Missile::BlastRadius * kSplashCore, " m");
  std::printf("       intercept at %.3f s, %d steps; miss %.3f m from the hull "
              "(%.3f m from the capsule axis, r = 4.0 m)\n",
              cross.time, cross.frames, static_cast<double>(cross.missSkin),
              static_cast<double>(cross.missAxis));
  std::printf("       heading error when guidance took over: %.1f deg (arming turned it %.1f deg)\n",
              static_cast<double>(cross.armEndHeadingErr) * 180.0 / 3.14159265,
              static_cast<double>(cross.turnedDuringArm) * 180.0 / 3.14159265);

  // A static target 150 m directly BEHIND the missile: the hardest turn the
  // seeker can be asked for, so the limiter is what is actually measured.
  const MissileRun reverse = RunMissile(Vec3{0.0f, 40.0f, 0.0f}, Vec3{0.0f, 0.0f, -1.0f}, Vec3{},
                                        0.0f, Vec3{6.0f, 34.5f, 150.0f}, Vec3{}, 0.001, 12.0);
  obtest::True("a missile asked to reverse still intercepts", reverse.detonated,
               obtest::Fmt("detonated after %.3f s", reverse.time));
  obtest::InRange("achieved turn rate never exceeds TurnRate", reverse.maxTurnRate, 0.0,
                  cfg::Missile::TurnRate + 1e-3, " rad/s");
  obtest::Greater("...and it does saturate the limit", reverse.maxTurnRate,
                  cfg::Missile::TurnRate * 0.98, " rad/s");
  std::printf("       peak %.5f rad/s against a hard limit of %.5f rad/s (%.2f%% of cap), "
              "miss %.3f m\n",
              static_cast<double>(reverse.maxTurnRate), static_cast<double>(cfg::Missile::TurnRate),
              100.0 * static_cast<double>(reverse.maxTurnRate / cfg::Missile::TurnRate),
              static_cast<double>(reverse.missSkin));

  // The arming phase must NOT guide: it climbs off the rack and lets the nose
  // fall over. Launch direction and drift as the rack actually produces them.
  const Vec3 rackDir = Vec3{-0.09f, 1.0f, -0.20f}.Normalised();
  const Vec3 rackDrift{-0.52f, 0.0f, -0.5f};
  const MissileRun armed = RunMissile(Vec3{0.0f, 30.0f, 0.0f}, rackDir, rackDrift,
                                      cfg::Missile::ArmTime, Vec3{0.0f, 24.5f, -180.0f}, Vec3{},
                                      0.001, 12.0);
  obtest::True("a vertical rack launch still lands", armed.detonated,
               obtest::Fmt("detonated after %.3f s, miss %.3f m", armed.time, armed.missSkin));
  obtest::Greater("the seeker is still off-target when arming ends", armed.armEndHeadingErr, 0.9,
                  " rad");
  obtest::Greater("the arming phase does tip the nose over", armed.turnedDuringArm, 0.05, " rad");
  std::printf("       vertical launch: armed at %.2f s pointing %.1f deg off the target, "
              "nose fell %.1f deg, intercept %.3f s\n",
              static_cast<double>(cfg::Missile::ArmTime),
              static_cast<double>(armed.armEndHeadingErr) * 180.0 / 3.14159265,
              static_cast<double>(armed.turnedDuringArm) * 180.0 / 3.14159265, armed.time);
}

// ==================================================================
//  5. Splash falloff
// ==================================================================
static void TestSplash() {
  obtest::Suite("ObBallistics — splash falloff");

  Scene sc;
  const float R = cfg::Missile::BlastRadius;   // 9 m
  const float samples[] = {0.0f, 1.0f, 2.0f, 2.88f, 3.5f, 4.5f, 5.5f, 6.5f, 7.5f, 8.5f, R, 10.0f};
  const int n = static_cast<int>(sizeof(samples) / sizeof(samples[0]));
  for (int i = 0; i < n; ++i) sc.AddPoint(Vec3{samples[i], 5.0f, 0.0f});

  Ballistics b;
  ExplosionSpawn ex;
  ex.position = Vec3{0.0f, 5.0f, 0.0f};
  ex.radius = R;
  ex.damage = 1000.0f;
  b.Explode(ex, sc.ctx);

  std::printf("       blast radius %.1f m, core %.2f m, curve (1-t)^%.1f, 1000 dmg at the centre\n",
              static_cast<double>(R), static_cast<double>(R * kSplashCore),
              static_cast<double>(kSplashExp));
  bool monotonic = true;
  float prev = 1e9f;
  for (int i = 0; i < n; ++i) {
    const float got = sc.rec.perTarget[i];
    std::printf("         %5.2f m -> %7.1f dmg  (%5.1f %%)\n", static_cast<double>(samples[i]),
                static_cast<double>(got), static_cast<double>(got) * 0.1);
    if (got > prev + 1e-3f) monotonic = false;
    prev = got;
  }

  obtest::Near("epicentre takes full damage", sc.rec.perTarget[0], 1000.0, 0.5);
  obtest::Near("the full-damage core reaches 0.32 * radius", sc.rec.perTarget[3], 1000.0, 1.0);
  obtest::Less("at BlastRadius the damage is gone", sc.rec.perTarget[10], 1.0);
  obtest::Near("beyond BlastRadius nothing is touched", sc.rec.perTarget[11], 0.0, 1e-6);
  obtest::True("the curve is monotonic", monotonic);
  // falloff is measured to the SKIN, so a 1 cm test hull sits 4.49 m out
  obtest::Near("halfway out (4.5 m) matches the falloff curve", sc.rec.perTarget[5] / 1000.0,
               static_cast<double>(SplashFalloff(4.5f - Scene::kPointRadius, R)), 1e-4);
  std::printf("       a target under %.0f %% weight is skipped entirely, which is why 8.5 m "
              "reads 0 rather than %.1f\n",
              static_cast<double>(kSplashCutoff) * 100.0,
              static_cast<double>(SplashFalloff(8.5f, R)) * 1000.0);
}

// ==================================================================
//  6. The rack — multi-lock and the salvo
// ==================================================================
static void TestMissileRack() {
  obtest::Suite("ObWeapons — VP-60LCS multi-lock and salvo");

  WeaponSystem w;
  Ballistics b;
  Scene sc;
  const void* lockList[8] = {};
  for (int i = 0; i < 8; ++i) {
    sc.AddStanding(Vec3{static_cast<float>(i * 14 - 49), 0.0f, -160.0f}, 4.0f, 11.0f);
    lockList[i] = sc.Handle(i);
  }

  FirerState f = MakeFirer(Vec3{0.0f, 0.0f, 0.0f}, Vec3{0.0f, 0.0f, -1.0f});
  f.lockTarget = lockList[0];
  f.lockList = lockList;
  f.lockCount = 8;

  WeaponInput in;
  in.missile = true;
  WeaponOutput out;

  const float dt = 0.001f;
  double t = 0.0;
  int maxLocks = 0;
  int launched = 0;
  double firstLaunch = -1.0;
  double lastLaunch = -1.0;
  double lockTimes[cfg::Missile::Count] = {};
  int seenLocks = 0;
  double salvoStart = -1.0;
  double reloadDone = -1.0;
  const void* lockSnapshot[cfg::Missile::Count] = {};

  for (int i = 0; i < 12000; ++i) {
    w.Update(dt, in, f, b, sc.ctx, out);
    b.Update(dt, sc.ctx);
    t += dt;
    const MissileState& ms = w.State().missile;
    if (ms.lockCount > maxLocks) {
      maxLocks = ms.lockCount;
      if (seenLocks < cfg::Missile::Count) lockTimes[seenLocks++] = t;
      // the salvo clears the rack, so read the locks while they are still up
      for (int k = 0; k < ms.lockCount; ++k) lockSnapshot[k] = ms.locks[k];
    }
    if (out.missilesLaunched > 0) {
      if (firstLaunch < 0.0) { firstLaunch = t; salvoStart = t; }
      lastLaunch = t;
      launched += out.missilesLaunched;
    }
    if (salvoStart > 0.0 && !ms.reloading && launched == cfg::Missile::Count && reloadDone < 0.0
        && t > salvoStart + 0.5) {
      reloadDone = t;
      break;
    }
  }

  obtest::Near("multi-lock caps at Count", maxLocks, cfg::Missile::Count, 0.0, " locks");
  obtest::Near("the salvo fires every tube", launched, cfg::Missile::Count, 0.0, " missiles");
  obtest::Near("stagger between tubes", (lastLaunch - firstLaunch) / (cfg::Missile::Count - 1),
               cfg::Missile::Salvo, 0.002, " s");
  obtest::Near("reserve drops by the salvo", w.State().missile.ammo,
               cfg::Missile::Ammo - cfg::Missile::Count, 0.0);
  obtest::Near("rack reload", reloadDone - lastLaunch, cfg::Missile::Reload, 0.01, " s");

  // locks are spread across the cone rather than stacked on one frame
  int distinct = 0;
  for (int i = 0; i < cfg::Missile::Count; ++i) {
    bool dup = false;
    for (int k = 0; k < i; ++k) if (lockSnapshot[k] == lockSnapshot[i]) dup = true;
    if (!dup && lockSnapshot[i]) ++distinct;
  }
  std::printf("       locks at:");
  for (int i = 0; i < seenLocks; ++i) std::printf(" %.3f", lockTimes[i]);
  std::printf(" s  (first %.3f, step %.3f)\n", static_cast<double>(wpn::MissFirst),
              static_cast<double>(wpn::MissStep));
  std::printf("       salvo %.4f -> %.4f s, %d tubes, %d distinct targets of 8 offered\n",
              firstLaunch, lastLaunch, launched, distinct);

  obtest::Near("locks spread across the offered targets", distinct, 6.0, 0.0, " targets");
}

// ==================================================================
//  7. The cannon and the blade
// ==================================================================
struct BladeRun {
  int hits = 0;
  float damage = 0.0f;
  float chargeAtSwing = 0.0f;
  double swingAt = -1.0;
  double activeStart = -1.0;
  double activeEnd = -1.0;
  float dashPeak = 0.0f;
  float travelled = 0.0f;
  float cooldown = 0.0f;
};

/** One swing at a stationary frame `distance` metres ahead. The host applies the lunge. */
static BladeRun RunBlade(float distance, float dt, bool charged) {
  WeaponSystem w;
  Ballistics b;
  Scene sc;
  sc.AddStanding(Vec3{0.0f, 0.0f, -distance}, 4.0f, 11.0f);
  FirerState f = MakeFirer(Vec3{0.0f, 0.0f, 0.0f}, Vec3{0.0f, 0.0f, -1.0f});
  f.lockTarget = sc.Handle(0);
  const Vec3 start = f.pos;

  WeaponInput in;
  in.blade = true;
  WeaponOutput out;

  BladeRun r;
  double t = 0.0;
  bool released = false;
  const double holdFor = charged ? wpn::BladeChargeTime : 0.05;
  for (int i = 0; i < 3000; ++i) {
    if (!released && t >= holdFor) { in.blade = false; released = true; }
    w.Update(dt, in, f, b, sc.ctx, out);
    b.Update(dt, sc.ctx);
    t += dt;
    if (out.dash) {
      r.dashPeak = std::fmax(r.dashPeak, out.dashVelocity.Length());
      f.pos.AddScaled(out.dashVelocity, dt);      // the lunge moves the machine
      f.eye = f.pos + Vec3{0.0f, 8.9f, 0.0f};
      f.muzzle[1] = f.pos - f.right * 3.1f + f.forward * 2.2f + Vec3{0.0f, 7.6f, 0.0f};
    }
    if (out.bladeSwingStarted) {
      r.swingAt = t;
      r.chargeAtSwing = w.State().blade.charge;   // the charge the swing was paid at
    }
    if (w.State().blade.active && r.activeStart < 0.0) r.activeStart = t;
    if (r.activeStart > 0.0 && !w.State().blade.active && r.activeEnd < 0.0) {
      r.activeEnd = t;
      r.cooldown = cfg::Blade::Cooldown;          // armed when recovery completes
    }
    if (r.swingAt > 0.0 && w.State().blade.phase == BladePhase::Idle) {
      r.cooldown = w.State().blade.cooldown;
      break;
    }
  }
  r.hits = sc.rec.hits;
  r.damage = sc.rec.total;
  r.travelled = (f.pos - start).Length();
  return r;
}

/** Nearest (or furthest) whole metre at which a charged swing connects. */
static float BladeBand(bool nearEdge) {
  float first = 0.0f;
  float last = 0.0f;
  for (int d = 8; d <= 70; ++d) {
    if (RunBlade(static_cast<float>(d), 0.002f, true).hits > 0) {
      if (first == 0.0f) first = static_cast<float>(d);
      last = static_cast<float>(d);
    }
  }
  return nearEdge ? first : last;
}

static void TestCannonAndBlade() {
  obtest::Suite("ObWeapons — BML-SB PYRE and PB-03 VERGE");

  // ---- a tap vents, it does not fire -------------------------------
  {
    WeaponSystem w;
    Ballistics b;
    Scene sc;
    const FirerState f = MakeFirer(Vec3{0.0f, 0.0f, 0.0f}, Vec3{0.0f, 0.0f, -1.0f});
    WeaponInput in;
    WeaponOutput out;
    const float dt = 0.004f;
    bool vented = false;
    bool fired = false;
    in.cannon = true;
    for (int i = 0; i < 50; ++i) w.Update(dt, in, f, b, sc.ctx, out);   // 0.20 s held
    in.cannon = false;
    for (int i = 0; i < 10; ++i) {
      w.Update(dt, in, f, b, sc.ctx, out);
      vented = vented || out.cannonVented;
      fired = fired || out.cannonFired;
    }
    obtest::True("a tap under CannonMinCharge vents", vented && !fired);
    obtest::Near("a vent costs no ammunition", w.State().cannon.ammo, cfg::Cannon::Ammo, 0.0);
  }

  // ---- a full charge fires, shoves, and lands ----------------------
  {
    WeaponSystem w;
    Ballistics b;
    Scene sc;
    sc.AddStanding(Vec3{0.0f, 0.0f, -100.0f}, 4.0f, 11.0f);
    const FirerState f = MakeFirer(Vec3{0.0f, 0.0f, 0.0f}, Vec3{0.0f, 0.0f, -1.0f});
    WeaponInput in;
    in.cannon = true;
    WeaponOutput out;

    const float dt = 0.004f;
    double t = 0.0;
    double fireAt = -1.0;
    float chargeAtFire = 0.0f;
    Vec3 shove;
    for (int i = 0; i < 800; ++i) {
      const float before = w.State().cannon.charge;
      w.Update(dt, in, f, b, sc.ctx, out);
      b.Update(dt, sc.ctx);
      t += dt;
      if (out.cannonFired && fireAt < 0.0) {
        fireAt = t;
        chargeAtFire = before;
        shove = out.impulse;
      }
      if (fireAt > 0.0 && sc.rec.explosions > 0) break;
    }
    obtest::Near("charge time", fireAt, cfg::Cannon::ChargeTime + wpn::CannonAutoDwell, 0.01, " s");
    obtest::Near("a full chamber lets go at charge 1.0", chargeAtFire, 1.0, 0.01);
    obtest::Near("the shove is backwards along the aim", shove.z,
                 wpn::CannonPushBase + wpn::CannonPushCharge, 0.01, " m/s");
    obtest::Near("bolt lands full damage on the plate", sc.rec.perTarget[0],
                 cfg::Cannon::Damage * (1.0 + 0.42 * SplashFalloff(0.0f, cfg::Cannon::BlastRadius)),
                 1.0);
    obtest::Near("ammunition spent", w.State().cannon.ammo, cfg::Cannon::Ammo - 1, 0.0);
    std::printf("       fired at %.3f s, shove %.2f m/s, direct %.0f + splash %.0f = %.0f dmg\n",
                fireAt, static_cast<double>(shove.Length()),
                static_cast<double>(sc.rec.total - sc.rec.splashTotal),
                static_cast<double>(sc.rec.splashTotal), static_cast<double>(sc.rec.total));
  }

  // ---- the blade charges, lunges, and bites once -------------------
  const float lo = BladeBand(true);
  const float hi = BladeBand(false);
  obtest::True("the lunge + arc has a real engagement band", hi > lo,
               obtest::Fmt("connects from %.0f m to %.0f m against a stationary frame", lo, hi));

  const BladeRun run = RunBlade((lo + hi) * 0.5f, 0.002f, true);
  const float want = cfg::Blade::Damage * cfg::Blade::ChargeMult;
  obtest::Near("a full charge multiplies damage by ChargeMult", run.damage, want, 1.0);
  obtest::Near("the target is bitten exactly once per swing", run.hits, 1.0, 0.0, " hits");
  obtest::Near("charge to swing", run.swingAt, wpn::BladeChargeTime, 0.005, " s");
  obtest::Near("windup before the damaging window", run.activeStart - run.swingAt,
               cfg::Blade::Windup, 0.005, " s");
  obtest::Near("active window", run.activeEnd - run.activeStart, cfg::Blade::Active, 0.005, " s");
  obtest::Near("lunge speed", run.dashPeak, cfg::Blade::DashSpeed, 1.5, " m/s");
  obtest::Near("cooldown is armed on recovery", run.cooldown, cfg::Blade::Cooldown, 0.01, " s");
  std::printf("       swing at %.3f s, active %.3f..%.3f s, lunge peak %.1f m/s carrying "
              "the frame %.1f m\n",
              run.swingAt, run.activeStart, run.activeEnd, static_cast<double>(run.dashPeak),
              static_cast<double>(run.travelled));
  std::printf("       %.0f dmg at %.0f m (base %.0f x %.2f charge), connects %.0f..%.0f m\n",
              static_cast<double>(run.damage), static_cast<double>((lo + hi) * 0.5f),
              static_cast<double>(cfg::Blade::Damage), static_cast<double>(cfg::Blade::ChargeMult),
              static_cast<double>(lo), static_cast<double>(hi));

  const BladeRun tapped = RunBlade((lo + hi) * 0.5f, 0.002f, false);
  const float tapWant =
      cfg::Blade::Damage * (1.0f + (cfg::Blade::ChargeMult - 1.0f) * tapped.chargeAtSwing);
  obtest::Near("damage scales linearly with the charge held", tapped.damage, tapWant, 1.0);
  obtest::Less("a tap is worth much less than a full charge", tapped.damage, run.damage * 0.55f);
  std::printf("       tap held %.3f s -> charge %.3f -> %.0f dmg (full charge is %.0f)\n",
              tapped.swingAt, static_cast<double>(tapped.chargeAtSwing),
              static_cast<double>(tapped.damage), static_cast<double>(run.damage));
}

// ==================================================================
//  8. Loadout parity with the web build, and the direct-hit rule
// ==================================================================
static void TestLoadoutParity() {
  obtest::Suite("ObWeapons — the fixed loadout, and direct hits");

  obtest::Near("LANCET rate", cfg::Rifle::Rpm, 545.0, 1e-4, " rpm");
  obtest::Near("LANCET magazine", cfg::Rifle::Magazine, 24.0, 0.0);
  obtest::Near("LANCET muzzle velocity", cfg::Rifle::Speed, 620.0, 1e-4, " m/s");
  obtest::Near("VERGE charge multiplier", cfg::Blade::ChargeMult, 2.15, 1e-4);
  obtest::Near("VP-60LCS tubes", cfg::Missile::Count, 6.0, 0.0);
  obtest::Near("VP-60LCS turn rate", cfg::Missile::TurnRate, 3.1, 1e-4, " rad/s");
  obtest::Near("PYRE charge time", cfg::Cannon::ChargeTime, 1.05, 1e-4, " s");
  obtest::Near("rifle interval derived from rpm", wpn::RifleInterval, 60.0 / 545.0, 1e-7, " s");

  // A staggered target takes DirectHitMult, applied once, inside ObCore.
  Scene sc;
  sc.AddStanding(Vec3{0.0f, 0.0f, -50.0f}, 4.0f, 11.0f);
  sc.targets[0].staggered = true;

  Ballistics b;
  BulletSpawn s;
  s.origin = Vec3{0.0f, sc.targets[0].vol.Centre().y, 0.0f};
  s.dir = Vec3{0.0f, 0.0f, -1.0f};
  s.speed = cfg::Rifle::Speed;
  s.damage = cfg::Rifle::Damage;
  s.impact = cfg::Rifle::Impact;
  s.acs = cfg::Rifle::Acs;
  s.maxDist = wpn::RifleRange;
  b.SpawnBullet(s);
  for (int i = 0; i < 200 && sc.rec.hits == 0; ++i) b.Update(0.004f, sc.ctx);

  obtest::Near("a direct hit on a staggered frame", sc.rec.total,
               cfg::Rifle::Damage * cfg::Player::DirectHitMult, 0.01);
  obtest::Near("and it is flagged as direct", sc.rec.directHits, 1.0, 0.0);
}

}  // namespace

void Suite_Combat() {
  TestLoadoutParity();
  TestRifleRate();
  TestMagazineAndReload();
  TestTunnelling();
  TestWorldSeam();
  TestMissiles();
  TestSplash();
  TestMissileRack();
  TestCannonAndBlade();
}

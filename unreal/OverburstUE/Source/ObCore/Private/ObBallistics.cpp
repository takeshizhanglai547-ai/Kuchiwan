// ============================================================
//  ObCore — ballistics implementation.
//  See ObBallistics.h for the model. Ported from
//  overburst/src/combat/{projectiles,targets}.js.
// ============================================================
#include "ObBallistics.h"

namespace ob {

// ---- detonation splits, mirroring projectiles.js -------------------
static constexpr float kMissileSplashOnBody = 0.35f;   // splash after a direct bite
static constexpr float kMissileSplashFree = 0.55f;     // splash when it hits nothing
static constexpr float kMissileSplashImpact = 0.45f;
static constexpr float kBoltSplashOnBody = 0.42f;
static constexpr float kBoltSplashFree = 0.62f;
static constexpr float kBoltSplashImpact = 0.5f;
static constexpr float kBoltSplashPower = 1.35f;

// ---- missile guidance ---------------------------------------------
static constexpr float kMissileFall = 34.0f;      // ballistic pitch-down once guidance is gone
static constexpr float kMissileArmTilt = 1.35f;   // nose falls over off the rack
static constexpr float kMissileArmSpeedFrac = 0.55f;
static constexpr float kMissileMaxLead = 2.2f;    // seconds of lead the seeker will take
static constexpr float kMissileFuse = 1.8f;       // proximity fuse, metres to the skin
static constexpr float kMissileCastPad = 1.1f;
static constexpr float kMissileFreeAimGain = 0.9f;
static constexpr float kMissileDeckClear = 0.6f;

static constexpr int kMaxExplodeDepth = 4;        // a splash kill can detonate a corpse

// ==================================================================
//  Geometry
// ==================================================================
HitCapsule StandingCapsule(const Vec3& feet, float radius, float height, float baseOffset) {
  HitCapsule c;
  c.r = radius > 0.05f ? radius : 0.05f;
  float lo = feet.y + baseOffset + c.r;
  float hi = feet.y + baseOffset + height - c.r;
  if (hi < lo) {
    const float mid = (lo + hi) * 0.5f;
    lo = mid;
    hi = mid;
  }
  c.a = Vec3{feet.x, lo, feet.z};
  c.b = Vec3{feet.x, hi, feet.z};
  return c;
}

float RaySphere(const Vec3& origin, const Vec3& dir, float tmax,
                const Vec3& centre, float radius) {
  const Vec3 e = origin - centre;
  const float b = Dot(e, dir);
  const float c = e.LengthSq() - radius * radius;
  const float h = b * b - c;
  if (h < 0.0f) return -1.0f;
  const float sh = std::sqrt(h);
  float t = -b - sh;
  if (t < 0.0f) t = (-b + sh) > 0.0f ? 0.0f : -1.0f;
  if (t < 0.0f || t > tmax) return -1.0f;
  return t;
}

float RayCapsule(const Vec3& origin, const Vec3& dir, float tmax,
                 const HitCapsule& c, float pad) {
  const float r = c.r + pad;
  const Vec3 ba = c.b - c.a;
  const float baba = ba.LengthSq();
  if (baba < 1e-8f) return RaySphere(origin, dir, tmax, c.a, r);

  const Vec3 oa = origin - c.a;
  const float bard = Dot(ba, dir);
  const float baoa = Dot(ba, oa);
  const float rdoa = Dot(dir, oa);
  const float oaoa = oa.LengthSq();

  const float qa = baba - bard * bard;
  const float qb = baba * rdoa - baoa * bard;
  const float qc = baba * oaoa - baoa * baoa - r * r * baba;

  float y = baoa;                       // axis parameter of the entry, scaled by baba
  if (qa > 1e-8f) {
    const float h = qb * qb - qa * qc;
    if (h < 0.0f) return -1.0f;         // misses the infinite cylinder => misses
    const float sh = std::sqrt(h);
    const float t = (-qb - sh) / qa;
    y = baoa + t * bard;
    if (y > 0.0f && y < baba) {
      if (t > tmax) return -1.0f;
      if (t >= 0.0f) return t;
      return ((-qb + sh) / qa) > 0.0f ? 0.0f : -1.0f;   // origin already inside
    }
  }
  // the entry lands past an end: solve the correct cap sphere
  const bool low = y <= 0.0f;
  return RaySphere(origin, dir, tmax, low ? c.a : c.b, r);
}

Vec3 ClosestOnAxis(const HitCapsule& c, const Vec3& p) {
  const Vec3 ba = c.b - c.a;
  const float den = ba.LengthSq();
  float t = 0.0f;
  if (den > 1e-8f) t = Clamp(Dot(p - c.a, ba) / den, 0.0f, 1.0f);
  return c.a + ba * t;
}

float SurfaceDist(const HitCapsule& c, const Vec3& p) {
  return (p - ClosestOnAxis(c, p)).Length() - c.r;
}

Vec3 JitterCone(const Vec3& dir, float spread, Rng& rng) {
  if (!(spread > 1e-6f)) return dir;
  const Vec3 up = std::fabs(dir.y) > 0.93f ? Vec3{1.0f, 0.0f, 0.0f} : Vec3{0.0f, 1.0f, 0.0f};
  Vec3 jr = Cross(dir, up);
  if (jr.LengthSq() < 1e-8f) jr = Vec3{1.0f, 0.0f, 0.0f};
  else jr.Normalise();
  const Vec3 ju = Cross(dir, jr).Normalised();
  const float ang = rng.Unit() * TAU;
  const float rad = std::tan(spread) * std::sqrt(rng.Unit());
  Vec3 out = dir;
  out.AddScaled(jr, std::cos(ang) * rad);
  out.AddScaled(ju, std::sin(ang) * rad);
  return out.Normalised();
}

float SplashFalloff(float surfaceDistance, float radius) {
  if (radius <= EPS) return 0.0f;
  if (surfaceDistance > radius) return 0.0f;
  const float core = radius * kSplashCore;
  if (surfaceDistance <= core) return 1.0f;
  const float t = Saturate((surfaceDistance - core) / std::fmax(1e-3f, radius - core));
  return std::pow(1.0f - t, kSplashExp);
}

int FindTargetIndex(const TargetView& view, const void* userData) {
  if (!userData || !view.items) return -1;
  for (int i = 0; i < view.count; ++i) {
    if (view.items[i].userData == userData && view.items[i].alive) return i;
  }
  return -1;
}

// ==================================================================
//  Ballistics
// ==================================================================
void Ballistics::Reset() {
  for (int i = 0; i < MaxBullets; ++i) bullets_[i].used = false;
  for (int i = 0; i < MaxMissiles; ++i) {
    missiles_[i].used = false;
    missiles_[i].target = nullptr;
    missiles_[i].source = nullptr;
  }
  for (int i = 0; i < MaxBolts; ++i) {
    bolts_[i].used = false;
    bolts_[i].source = nullptr;
  }
  bulletCursor_ = 0;
  missileCursor_ = 0;
  boltCursor_ = 0;
  explodeDepth_ = 0;
  counts_ = Counts{};
  lastMeleeHit_.Zero();
}

// ---- spawners -----------------------------------------------------
bool Ballistics::SpawnBullet(const BulletSpawn& s) {
  Bullet* slot = nullptr;
  for (int k = 0; k < MaxBullets; ++k) {
    bulletCursor_ = (bulletCursor_ + 1) % MaxBullets;
    if (!bullets_[bulletCursor_].used) { slot = &bullets_[bulletCursor_]; break; }
  }
  if (!slot) return false;

  Vec3 d = s.dir;
  if (d.LengthSq() < 1e-8f) d = Vec3{0.0f, 0.0f, -1.0f};
  else d.Normalise();

  Bullet& b = *slot;
  b.used = true;
  b.pos = s.origin;
  b.prev = s.origin;
  b.vel = d * s.speed;
  b.drop = s.drop;
  b.life = s.life;
  b.travelled = 0.0f;
  b.maxDist = s.maxDist;
  b.radius = s.radius;
  b.damage = s.damage;
  b.impact = s.impact;
  b.acs = s.acs >= 0.0f ? s.acs : s.impact * 0.55f;
  b.owner = s.owner;
  b.weapon = s.weapon;
  b.source = s.source;
  return true;
}

bool Ballistics::SpawnMissile(const MissileSpawn& s) {
  GuidedMissile* slot = nullptr;
  for (int k = 0; k < MaxMissiles; ++k) {
    missileCursor_ = (missileCursor_ + 1) % MaxMissiles;
    if (!missiles_[missileCursor_].used) { slot = &missiles_[missileCursor_]; break; }
  }
  if (!slot) return false;

  Vec3 d = s.dir;
  if (d.LengthSq() < 1e-8f) d = Vec3{0.0f, 1.0f, 0.0f};
  else d.Normalise();

  GuidedMissile& m = *slot;
  m.used = true;
  m.pos = s.origin;
  m.prev = s.origin;
  m.dir = d;
  m.speed = s.launchSpeed;
  m.maxSpeed = s.speed;
  m.accel = s.accel;
  m.turn = s.turnRate;
  m.armT = s.armTime;
  m.life = s.life;
  m.target = s.target;
  m.hasAim = s.hasAim && s.target == nullptr;
  m.aim = s.aim;
  m.drift = s.drift;
  m.damage = s.damage;
  m.impact = s.impact;
  m.acs = s.acs;
  m.blast = s.blastRadius;
  m.owner = s.owner;
  m.weapon = s.weapon;
  m.source = s.source;
  return true;
}

bool Ballistics::SpawnPlasma(const PlasmaSpawn& s) {
  PlasmaBolt* slot = nullptr;
  for (int k = 0; k < MaxBolts; ++k) {
    boltCursor_ = (boltCursor_ + 1) % MaxBolts;
    if (!bolts_[boltCursor_].used) { slot = &bolts_[boltCursor_]; break; }
  }
  if (!slot) return false;

  Vec3 d = s.dir;
  if (d.LengthSq() < 1e-8f) d = Vec3{0.0f, 0.0f, -1.0f};
  else d.Normalise();

  PlasmaBolt& b = *slot;
  b.used = true;
  b.pos = s.origin;
  b.prev = s.origin;
  b.dir = d;
  b.speed = s.speed;
  b.radius = s.radius;
  b.life = s.life;
  b.damage = s.damage;
  b.impact = s.impact;
  b.acs = s.acs;
  b.blast = s.blastRadius;
  b.power = s.power;
  b.owner = s.owner;
  b.weapon = s.weapon;
  b.source = s.source;
  return true;
}

// ---- damage -------------------------------------------------------
float Ballistics::ApplyHit(CombatTarget& tgt, int index, const Vec3& point, const Vec3& normal,
                           float damage, float impact, float acs, WeaponId weapon,
                           const void* source, Owner owner, bool splash,
                           const CombatContext& ctx) const {
  if (!tgt.alive) return 0.0f;
  const bool direct = tgt.staggered;
  const float shown = damage * (direct ? cfg::Player::DirectHitMult : 1.0f);

  HitEvent e;
  e.target = tgt.userData;
  e.targetIndex = index;
  e.point = point;
  e.normal = normal;
  e.damage = shown;
  e.impact = impact;
  e.acs = acs;
  e.direct = direct;
  e.splash = splash;
  e.owner = owner;
  e.weapon = weapon;
  e.source = source;
  if (ctx.sink) ctx.sink->OnHit(e);
  return shown;
}

void Ballistics::WorldHit(const Vec3& point, const Vec3& normal, float impact, WeaponId weapon,
                          const void* source, Owner owner, const CombatContext& ctx) const {
  if (!ctx.sink) return;
  HitEvent e;
  e.point = point;
  e.normal = normal;
  e.impact = impact;
  e.owner = owner;
  e.weapon = weapon;
  e.source = source;
  ctx.sink->OnHit(e);
}

// ---- the swept query ----------------------------------------------
CastHit Ballistics::Cast(const Vec3& origin, const Vec3& dir, float len, Owner owner,
                         float pad, const void* ignore, const CombatContext& ctx) const {
  CastHit out;
  if (len <= 0.0f) return out;

  float best = len + 1.0f;
  int bestIndex = -1;
  const TargetView& list = ctx.Hostiles(owner);
  for (int i = 0; i < list.count; ++i) {
    const CombatTarget& e = list.items[i];
    if (!e.alive) continue;
    if (e.userData && e.userData == ignore) continue;
    const float t = RayCapsule(origin, dir, len, e.vol, pad);
    if (t >= 0.0f && t < best) { best = t; bestIndex = i; }
  }
  const bool entityHit = bestIndex >= 0;

  // world: only trace as far as the nearest entity hit
  const float wlen = entityHit ? std::fmin(len, best) : len;
  if (ctx.world && wlen > 1e-5f) {
    const RayHit h = ctx.world->Raycast(origin, dir, wlen);
    if (h.hit && h.distance < (entityHit ? best : len + 1.0f)) {
      out.hit = true;
      out.world = true;
      out.t = h.distance;
      out.point = h.point;
      out.normal = h.normal;
      out.targetIndex = -1;
      out.userData = h.userData;
      return out;
    }
  }
  if (!entityHit) return out;

  const Vec3 p = origin + dir * best;
  // surface normal: away from the capsule axis, biased a little back down the
  // incoming ray so grazing hits still spark toward the camera
  Vec3 n = p - ClosestOnAxis(list.items[bestIndex].vol, p);
  if (n.LengthSq() < 1e-6f) n = -dir;
  n.Normalise();
  n.AddScaled(dir, -0.35f);
  n.Normalise();

  out.hit = true;
  out.world = false;
  out.t = best;
  out.point = p;
  out.normal = n;
  out.targetIndex = bestIndex;
  out.userData = list.items[bestIndex].userData;
  return out;
}

// ---- splash -------------------------------------------------------
void Ballistics::Explode(const ExplosionSpawn& s, const CombatContext& ctx) {
  if (explodeDepth_ >= kMaxExplodeDepth) return;
  ++explodeDepth_;

  ExplosionEvent ev;
  ev.position = s.position;
  ev.radius = s.radius;
  ev.power = s.power;
  ev.owner = s.owner;
  ev.weapon = s.weapon;
  ev.source = s.source;
  if (ctx.sink) ctx.sink->OnExplosion(ev);

  if (s.damage > 0.0f) {
    const float impact = s.impact >= 0.0f ? s.impact : s.damage * 1.2f;
    const float acs = s.acs >= 0.0f ? s.acs : s.damage * 0.65f;
    const TargetView& list = ctx.Hostiles(s.owner);
    for (int i = 0; i < list.count; ++i) {
      CombatTarget& e = list.items[i];
      if (!e.alive) continue;
      const float dist = SurfaceDist(e.vol, s.position);
      const float f = SplashFalloff(dist, s.radius);
      if (f <= kSplashCutoff) continue;
      // contact point on the target's skin, facing the blast
      const Vec3 axis = ClosestOnAxis(e.vol, s.position);
      Vec3 n = s.position - axis;
      if (n.LengthSq() < 1e-6f) n = Vec3{0.0f, 1.0f, 0.0f};
      else n.Normalise();
      const Vec3 point = axis + n * e.vol.r;
      ApplyHit(e, i, point, n, s.damage * f, impact * f, acs * f, s.weapon,
               s.source, s.owner, true, ctx);
    }
  }
  --explodeDepth_;
}

// ---- melee --------------------------------------------------------
int Ballistics::MeleeSweep(const MeleeSweepParams& p, const CombatContext& ctx) {
  Vec3 d = p.to - p.from;
  float len = d.Length();
  if (len < 1e-4f) { d = Vec3{0.0f, 0.0f, -1.0f}; len = 1e-3f; }
  else d = d / len;

  const TargetView& list = ctx.Hostiles(p.owner);
  int n = 0;
  for (int i = 0; i < list.count; ++i) {
    CombatTarget& e = list.items[i];
    if (!e.alive) continue;
    bool skip = false;
    if (p.exclude && p.excludeCount) {
      for (int k = 0; k < *p.excludeCount; ++k) {
        if (p.exclude[k] == e.userData) { skip = true; break; }
      }
    }
    if (skip) continue;
    const float t = RayCapsule(p.from, d, len, e.vol, p.radius);
    if (t < 0.0f) continue;

    const Vec3 at = p.from + d * t;
    const Vec3 axis = ClosestOnAxis(e.vol, at);
    Vec3 nrm = at - axis;
    if (nrm.LengthSq() < 1e-6f) nrm = -d;
    else nrm.Normalise();
    // land the flash on the armour, not in the air
    lastMeleeHit_ = axis + nrm * e.vol.r;

    if (p.exclude && p.excludeCount && *p.excludeCount < p.excludeCapacity) {
      p.exclude[(*p.excludeCount)++] = e.userData;
    }
    ApplyHit(e, i, lastMeleeHit_, nrm, p.damage, p.impact, p.acs, p.weapon,
             p.source, p.owner, false, ctx);
    ++n;
    if (p.maxHits > 0 && n >= p.maxHits) break;
  }
  return n;
}

// ==================================================================
//  Integration
// ==================================================================
void Ballistics::Update(float dt, const CombatContext& ctx) {
  if (!(dt > 0.0f)) return;
  const float d = std::fmin(dt, kMaxStep);
  UpdateBullets(d, ctx);
  UpdateBolts(d, ctx);
  UpdateMissiles(d, ctx);
}

void Ballistics::UpdateBullets(float dt, const CombatContext& ctx) {
  int live = 0;
  for (int i = 0; i < MaxBullets; ++i) {
    Bullet& b = bullets_[i];
    if (!b.used) continue;
    b.life -= dt;
    if (b.life <= 0.0f) { b.used = false; continue; }

    b.prev = b.pos;
    if (b.drop > 0.0f) b.vel.y -= b.drop * dt;

    const float speed = b.vel.Length();
    if (speed < EPS) { b.used = false; continue; }
    const Vec3 dir = b.vel / speed;

    float step = speed * dt;
    if (b.travelled + step > b.maxDist) step = b.maxDist - b.travelled;
    if (step <= 0.0f) { b.used = false; continue; }

    // THE SWEEP: the whole segment travelled this step, not the endpoint.
    const CastHit h = Cast(b.pos, dir, step, b.owner, b.radius, b.source, ctx);
    if (h.hit) {
      if (h.targetIndex >= 0) {
        ApplyHit(ctx.Hostiles(b.owner).items[h.targetIndex], h.targetIndex, h.point, h.normal,
                 b.damage, b.impact, b.acs, b.weapon, b.source, b.owner, false, ctx);
      } else {
        WorldHit(h.point, h.normal, b.impact, b.weapon, b.source, b.owner, ctx);
      }
      b.pos = h.point;
      b.used = false;
      continue;
    }

    b.pos.AddScaled(dir, step);
    b.travelled += step;
    if (b.travelled >= b.maxDist - 1e-4f) { b.used = false; continue; }
    ++live;
  }
  counts_.bullets = live;
}

void Ballistics::UpdateMissiles(float dt, const CombatContext& ctx) {
  int live = 0;
  for (int i = 0; i < MaxMissiles; ++i) {
    GuidedMissile& m = missiles_[i];
    if (!m.used) continue;
    m.life -= dt;
    if (m.life <= 0.0f) {
      DetonateMissile(m, m.pos, Vec3{0.0f, 1.0f, 0.0f}, -1, ctx);
      continue;
    }
    m.prev = m.pos;

    const TargetView& list = ctx.Hostiles(m.owner);
    const int tgtIndex = FindTargetIndex(list, m.target);
    if (m.target && tgtIndex < 0) m.target = nullptr;   // it died or left the world

    if (m.armT > 0.0f) {
      // off the rack: climb, fan out, and let the nose fall over
      m.armT -= dt;
      m.dir.y -= kMissileArmTilt * dt;
      m.dir.x += m.drift.x * dt;
      m.dir.z += m.drift.z * dt;
      m.dir.Normalise();
      m.speed = std::fmin(m.maxSpeed * kMissileArmSpeedFrac, m.speed + m.accel * kMissileArmSpeedFrac * dt);
    } else {
      bool guided = false;
      if (tgtIndex >= 0) {
        const CombatTarget& tgt = list.items[tgtIndex];
        const Vec3 centre = tgt.vol.Centre();
        Vec3 want = centre - m.pos;
        const float range = want.Length();
        if (range > 1e-3f) {
          want = want / range;
          // lead-compensated proportional navigation: aim at where the target
          // will be when we arrive, then clamp the turn to the hard limit.
          const float closing = std::fmax(m.speed * 0.35f, m.speed - Dot(tgt.vel, want));
          const float lead = std::fmin(range / closing, kMissileMaxLead);
          const Vec3 aimAt = centre + tgt.vel * lead;
          const Vec3 toAim = aimAt - m.pos;
          want = toAim.LengthSq() > 1e-6f ? toAim.Normalised() : m.dir;
          // HARD LIMIT. The web build multiplied this by 1.9 inside 40 m for
          // terminal guidance; ObCore does not, so "never turns faster than
          // TurnRate" is an invariant the test runner can actually assert.
          m.dir = TurnToward(m.dir, want, m.turn * dt);
          guided = true;
        }
      } else if (m.hasAim) {
        // no lock: guide onto the point that was under the reticle at launch
        Vec3 want = m.aim - m.pos;
        const float range = want.Length();
        if (range > 1e-3f) {
          m.dir = TurnToward(m.dir, want / range, m.turn * kMissileFreeAimGain * dt);
          guided = true;
        }
        if (range < m.blast * 0.30f) {
          DetonateMissile(m, m.pos, Vec3{0.0f, 1.0f, 0.0f}, -1, ctx);
          continue;
        }
      }
      if (!guided) {
        // nothing left to chase: fall on a ballistic arc, never sail away
        m.dir.y -= kMissileFall * dt;
        m.dir.Normalise();
      }
      m.speed = std::fmin(m.maxSpeed, m.speed + m.accel * dt);
    }

    const float step = m.speed * dt;
    const CastHit h = Cast(m.pos, m.dir, step + 1.2f, m.owner, kMissileCastPad, m.source, ctx);
    if (h.hit) {
      DetonateMissile(m, m.pos + m.dir * h.t, h.normal, h.targetIndex, ctx);
      continue;
    }
    m.pos.AddScaled(m.dir, step);

    // proximity fuse
    if (tgtIndex >= 0 && m.armT <= 0.0f) {
      const CombatTarget& tgt = list.items[tgtIndex];
      if (SurfaceDist(tgt.vol, m.pos) < kMissileFuse) {
        Vec3 n = m.pos - ClosestOnAxis(tgt.vol, m.pos);
        if (n.LengthSq() < 1e-6f) n = Vec3{0.0f, 1.0f, 0.0f};
        else n.Normalise();
        DetonateMissile(m, m.pos, n, tgtIndex, ctx);
        continue;
      }
    }
    // deck strike
    if (ctx.world) {
      const float gy = ctx.world->SampleHeight(m.pos.x, m.pos.z, m.pos.y);
      if (std::isfinite(gy) && m.pos.y <= gy + kMissileDeckClear && m.dir.y < 0.0f) {
        DetonateMissile(m, Vec3{m.pos.x, gy + 0.4f, m.pos.z}, Vec3{0.0f, 1.0f, 0.0f}, -1, ctx);
        continue;
      }
    }
    ++live;
  }
  counts_.missiles = live;
}

void Ballistics::UpdateBolts(float dt, const CombatContext& ctx) {
  int live = 0;
  for (int i = 0; i < MaxBolts; ++i) {
    PlasmaBolt& b = bolts_[i];
    if (!b.used) continue;
    b.life -= dt;
    if (b.life <= 0.0f) {
      DetonateBolt(b, b.pos, Vec3{0.0f, 1.0f, 0.0f}, -1, ctx);
      continue;
    }
    b.prev = b.pos;
    const float step = b.speed * dt;
    const CastHit h = Cast(b.pos, b.dir, step + b.radius, b.owner, b.radius * 0.85f, b.source, ctx);
    if (h.hit) {
      // pull the burst back out of the surface so the fireball is not buried
      const float back = std::fmin(h.t, b.radius * 0.7f);
      DetonateBolt(b, b.pos + b.dir * (h.t - back), h.normal, h.targetIndex, ctx);
      continue;
    }
    b.pos.AddScaled(b.dir, step);
    ++live;
  }
  counts_.bolts = live;
}

// ---- detonations ---------------------------------------------------
void Ballistics::DetonateMissile(GuidedMissile& m, const Vec3& at, const Vec3& normal,
                                 int targetIndex, const CombatContext& ctx) {
  const TargetView& list = ctx.Hostiles(m.owner);
  const bool onBody = targetIndex >= 0 && targetIndex < list.count;
  if (onBody) {
    ApplyHit(list.items[targetIndex], targetIndex, at, normal, m.damage, m.impact, m.acs,
             m.weapon, m.source, m.owner, false, ctx);
  }
  ExplosionSpawn ex;
  ex.position = at;
  ex.radius = m.blast;
  ex.power = 1.0f;
  ex.damage = m.damage * (onBody ? kMissileSplashOnBody : kMissileSplashFree);
  ex.impact = m.impact * kMissileSplashImpact;
  ex.acs = m.acs * kMissileSplashImpact;
  ex.owner = m.owner;
  ex.weapon = m.weapon;
  ex.source = m.source;

  m.used = false;
  m.target = nullptr;
  m.source = nullptr;
  Explode(ex, ctx);
}

void Ballistics::DetonateBolt(PlasmaBolt& b, const Vec3& at, const Vec3& normal,
                              int targetIndex, const CombatContext& ctx) {
  const TargetView& list = ctx.Hostiles(b.owner);
  const bool onBody = targetIndex >= 0 && targetIndex < list.count;
  // a direct plate hit lands its full bar before the splash rolls out
  if (onBody) {
    ApplyHit(list.items[targetIndex], targetIndex, at, normal, b.damage, b.impact, b.acs,
             b.weapon, b.source, b.owner, false, ctx);
  }
  ExplosionSpawn ex;
  ex.position = at;
  ex.radius = b.blast;
  ex.power = kBoltSplashPower * b.power;
  ex.damage = b.damage * (onBody ? kBoltSplashOnBody : kBoltSplashFree);
  ex.impact = b.impact * kBoltSplashImpact;
  ex.acs = b.acs * kBoltSplashImpact;
  ex.owner = b.owner;
  ex.weapon = b.weapon;
  ex.source = b.source;

  b.used = false;
  b.source = nullptr;
  Explode(ex, ctx);
}

}  // namespace ob

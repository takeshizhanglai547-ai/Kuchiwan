// ============================================================
//  ObCore — the fixed loadout, implemented.
//  Ported from overburst/src/combat/weapons.js. See ObWeapons.h.
// ============================================================
#include "ObWeapons.h"

namespace ob {

// ==================================================================
//  lifecycle
// ==================================================================
void WeaponSystem::Reset() {
  state_ = WeaponsState{};
  pose_ = WeaponPose{};

  recoilOwed_ = 0.0f;
  dryT_ = 0.0f;
  pitchCursor_ = 0.0f;

  bladeT_ = 0.0f;
  bladeHold_ = 0.0f;
  bladeMult_ = 1.0f;
  bladeSide_ = 1.0f;
  bladeDir_ = Vec3{0.0f, 0.0f, -1.0f};
  bladeTipPrev_.Zero();
  swingHitCount_ = 0;

  mHold_ = false;
  mLatch_ = false;
  mT_ = 0.0f;
  salvoLeft_ = 0;
  salvoTube_ = 0;
  salvoT_ = 0.0f;

  cT_ = 0.0f;
  cFull_ = 0.0f;

  prev_ = WeaponInput{};
}

void WeaponSystem::Update(float dt, const WeaponInput& in, const FirerState& firer,
                          Ballistics& ballistics, const CombatContext& ctx, WeaponOutput& out) {
  out = WeaponOutput{};
  if (!(dt > 0.0f)) return;
  const float d = std::fmin(dt, kMaxStep);

  // One reticle solve per frame. A convergence point inside the mech's own
  // reach is degenerate — push it out along the eye ray instead.
  FirerState f = firer;
  if (DistanceSq(f.aimPoint, f.eye) < 900.0f) {
    f.aimPoint = f.eye;
    f.aimPoint.AddScaled(f.aimDir, 260.0f);
  }

  pitchCursor_ = f.pitch;

  UpdateRifle(d, in, f, ballistics, ctx, out);
  UpdateBlade(d, in, f, ballistics, ctx, out);
  UpdateMissile(d, in, f, ballistics, ctx, out);
  UpdateCannon(d, in, f, ballistics, out);

  pose_.bladeCharge = state_.blade.charge;
  pose_.cannonCharge = state_.cannon.charge;

  out.pitchDelta = pitchCursor_ - f.pitch;
  prev_ = in;
}

// ---- shared aim geometry ------------------------------------------
Vec3 WeaponSystem::Solve(const FirerState& firer, Hardpoint hp) const {
  const Vec3 origin = Muzzle(firer, hp);
  const Vec3 d = firer.aimPoint - origin;
  const float l2 = d.LengthSq();
  if (l2 < 400.0f) return firer.aimDir.Normalised();   // degenerate: use the eye ray
  return d / std::sqrt(l2);
}

void WeaponSystem::ApplyRecoil(float kick, WeaponOutput& out) {
  (void)out;
  pitchCursor_ = Clamp(pitchCursor_ + kick, cfg::Cam::PitchMin, cfg::Cam::PitchMax);
  recoilOwed_ += kick;
}

// ==================================================================
//  R-ARM — MG-014 LANCET
//
//  The accumulator. `cooldown` is SECONDS OWED, not a per-frame gate:
//  a frame that runs long pays down several rounds, a frame that runs
//  short pays down none, and the rate comes out at exactly 545 rpm
//  either way.
// ==================================================================
void WeaponSystem::UpdateRifle(float dt, const WeaponInput& in, const FirerState& firer,
                               Ballistics& ballistics, const CombatContext& ctx,
                               WeaponOutput& out) {
  (void)ctx;
  RifleState& s = state_.rifle;

  // Recoil recovery — the climb is handed back over ~1 s. Exponential, so the
  // bleed is identical at any frame rate, and proportional, so sustained fire
  // reaches a climb plateau instead of being cancelled on the next frame.
  if (recoilOwed_ > 0.0f) {
    float k = recoilOwed_ * (1.0f - std::exp(-wpn::RifleRecoilRecover * dt));
    if (recoilOwed_ - k < 1e-4f) k = recoilOwed_;   // snap the last hair to zero
    recoilOwed_ -= k;
    pitchCursor_ = Clamp(pitchCursor_ - k, cfg::Cam::PitchMin, cfg::Cam::PitchMax);
  }
  if (pose_.rifleRecoil > 0.0f) {
    pose_.rifleRecoil = std::fmax(0.0f, pose_.rifleRecoil - dt * wpn::RifleKickDecay);
  }

  // THE RATE CLOCK, and the one line that makes 545 rpm exact.
  //
  // The debt is decremented UNCONDITIONALLY — including on the frame the
  // trigger goes down, which starts at zero debt and fires immediately. The
  // web build only decremented a positive cooldown, which silently threw away
  // the first frame's dt and made the count depend on the frame length (9
  // rounds/s at 60 fps, 10 at 125 fps). Every path that is not actively firing
  // clamps the debt back to zero below, so nothing banks rounds across a
  // reload or a released trigger.
  s.cooldown -= dt;

  if (s.reloading) {
    if (s.cooldown < 0.0f) s.cooldown = 0.0f;
    s.reloadT -= dt;
    s.reloadProgress = Saturate(1.0f - s.reloadT / cfg::Rifle::ReloadTime);
    if (s.reloadT <= 0.0f) {
      const int want = s.ammo < cfg::Rifle::Magazine ? s.ammo : cfg::Rifle::Magazine;
      s.ammo -= want;
      s.mag = want;
      s.reloading = false;
      s.reloadT = 0.0f;
      s.reloadProgress = 1.0f;
      s.heat = 0.0f;
      out.reloadFinished = true;
    }
    s.firing = false;
    return;
  }

  const bool wantFire = !firer.blocked && in.rifle;

  // heat / spread bleed off the moment the trigger is released
  if (!wantFire && s.heat > 0.0f) {
    s.heat = std::fmax(0.0f, s.heat - wpn::RifleHeatDecay * dt);
  }
  s.spread = cfg::Rifle::Spread * (1.0f + s.heat * wpn::RifleSpreadGrowth);

  if (in.reload && !prev_.reload && s.mag < cfg::Rifle::Magazine && s.ammo > 0) {
    if (s.cooldown < 0.0f) s.cooldown = 0.0f;
    BeginReload(out);
    return;
  }
  if (!wantFire) {
    s.firing = false;
    if (s.cooldown < 0.0f) s.cooldown = 0.0f;   // a released trigger banks nothing
    return;
  }
  if (s.mag <= 0) {
    s.firing = false;
    if (s.cooldown < 0.0f) s.cooldown = 0.0f;
    if (s.ammo > 0) {
      BeginReload(out);
    } else {
      dryT_ -= dt;
      if (dryT_ <= 0.0f) { dryT_ = wpn::RifleDryInterval; out.dryFire = true; }
    }
    return;
  }
  s.firing = true;

  // THE ACCUMULATOR. Bounded catch-up: a hitch must not dump the magazine.
  int shots = 0;
  while (s.cooldown <= 0.0f && s.mag > 0 && shots < wpn::RifleMaxCatchup) {
    FireRifle(firer, ballistics, out);
    s.cooldown += wpn::RifleInterval;
    ++shots;
  }
  out.rifleRounds = shots;
  if (s.mag <= 0 && s.ammo > 0) BeginReload(out);
}

void WeaponSystem::BeginReload(WeaponOutput& out) {
  RifleState& s = state_.rifle;
  if (s.reloading || s.ammo <= 0 || s.mag >= cfg::Rifle::Magazine) return;
  s.reloading = true;
  s.reloadT = cfg::Rifle::ReloadTime;
  s.reloadProgress = 0.0f;
  s.firing = false;
  out.reloadStarted = true;
}

void WeaponSystem::FireRifle(const FirerState& firer, Ballistics& ballistics, WeaponOutput& out) {
  RifleState& s = state_.rifle;

  Vec3 dir = Solve(firer, Hardpoint::RArm);
  // airborne and assault boost cost accuracy on top of sustained fire
  float spread = s.spread;
  if (firer.abActive) spread *= wpn::RifleAbSpread;
  else if (!firer.grounded) spread *= wpn::RifleAirSpread;
  dir = JitterCone(dir, spread, rng_);

  BulletSpawn b;
  b.origin = Muzzle(firer, Hardpoint::RArm);
  b.dir = dir;
  b.speed = cfg::Rifle::Speed;
  b.damage = cfg::Rifle::Damage;
  b.impact = cfg::Rifle::Impact;
  b.acs = cfg::Rifle::Acs;
  b.maxDist = wpn::RifleRange;
  b.drop = wpn::RifleDrop;
  b.owner = Owner::Player;
  b.weapon = WeaponId::Rifle;
  b.source = firer.self;
  ballistics.SpawnBullet(b);

  --s.mag;
  s.heat = std::fmin(1.0f, s.heat + wpn::RifleHeatShot);

  // recoil pushes the aim up and wanders it sideways; both are paid back
  const float kick = cfg::Rifle::Recoil * (0.75f + s.heat * 0.85f);
  ApplyRecoil(kick, out);
  out.yawDelta += rng_.Signed() * kick * 0.5f;
  pose_.rifleRecoil = 1.0f;
}

// ==================================================================
//  L-ARM — PB-03 VERGE pulse blade
// ==================================================================
void WeaponSystem::UpdateBlade(float dt, const WeaponInput& in, const FirerState& firer,
                               Ballistics& ballistics, const CombatContext& ctx,
                               WeaponOutput& out) {
  BladeState& s = state_.blade;
  if (s.cooldown > 0.0f) s.cooldown = std::fmax(0.0f, s.cooldown - dt);
  s.ready = s.cooldown <= 0.0f && !firer.blocked;

  switch (s.phase) {
    case BladePhase::Idle: {
      pose_.bladeSwing = std::fmax(0.0f, pose_.bladeSwing - dt * 5.0f);
      if (s.charge > 0.0f) s.charge = std::fmax(0.0f, s.charge - dt * 3.0f);
      if (s.cooldown <= 0.0f && !firer.blocked && in.blade && !prev_.blade) {
        s.phase = BladePhase::Charge;
        s.charge = 0.0f;
        bladeHold_ = 0.0f;
      }
      break;
    }
    case BladePhase::Charge: {
      bladeHold_ += dt;
      s.charge = Saturate(bladeHold_ / wpn::BladeChargeTime);
      if (firer.blocked || !in.blade || bladeHold_ >= wpn::BladeMaxHold) {
        StartSwing(firer, ctx, out);
      }
      break;
    }
    case BladePhase::Windup: {
      bladeT_ -= dt;
      pose_.bladeSwing = Saturate(0.28f * (1.0f - bladeT_ / std::fmax(1e-3f, cfg::Blade::Windup)));
      Dash(firer, 0.62f, out);
      if (bladeT_ <= 0.0f) {
        bladeT_ = cfg::Blade::Active;
        s.phase = BladePhase::Active;
        s.active = true;
        bladeTipPrev_ = ArcTip(firer, 0.0f);
      }
      break;
    }
    case BladePhase::Active: {
      bladeT_ -= dt;
      const float u = Saturate(1.0f - bladeT_ / std::fmax(1e-3f, cfg::Blade::Active));
      pose_.bladeSwing = 0.3f + u * 0.7f;
      Dash(firer, 1.0f - u * 0.55f, out);

      const Vec3 tip = ArcTip(firer, u);
      MeleeSweepParams p;
      p.from = bladeTipPrev_;
      p.to = tip;
      p.radius = wpn::BladeRadius;
      p.damage = cfg::Blade::Damage * bladeMult_;
      p.impact = cfg::Blade::Impact * bladeMult_;
      p.acs = cfg::Blade::Acs * bladeMult_;
      p.owner = Owner::Player;
      p.weapon = WeaponId::Blade;
      p.source = firer.self;
      p.exclude = swingHits_;
      p.excludeCount = &swingHitCount_;
      p.excludeCapacity = wpn::BladeHitMemory;
      p.maxHits = wpn::BladeMaxHits;
      const int n = ballistics.MeleeSweep(p, ctx);
      if (n > 0) {
        out.bladeHits += n;
        out.shake = std::fmax(out.shake, 0.85f);
        out.shakeDuration = std::fmax(out.shakeDuration, 0.28f);
      }
      bladeTipPrev_ = tip;

      if (bladeT_ <= 0.0f) {
        bladeT_ = wpn::BladeRecover;
        s.phase = BladePhase::Recover;
        s.active = false;
      }
      break;
    }
    case BladePhase::Recover: {
      bladeT_ -= dt;
      pose_.bladeSwing = std::fmax(0.0f, pose_.bladeSwing - dt * 3.2f);
      if (bladeT_ <= 0.0f) {
        s.phase = BladePhase::Idle;
        s.charge = 0.0f;
        s.cooldown = cfg::Blade::Cooldown;
      }
      break;
    }
  }
}

void WeaponSystem::StartSwing(const FirerState& firer, const CombatContext& ctx,
                              WeaponOutput& out) {
  BladeState& s = state_.blade;
  bladeMult_ = 1.0f + (cfg::Blade::ChargeMult - 1.0f) * s.charge;
  swingHitCount_ = 0;
  bladeSide_ = rng_.Unit() < 0.5f ? -1.0f : 1.0f;

  // lunge vector: the locked frame if it is anywhere near, else the reticle
  bool got = false;
  const int idx = FindTargetIndex(ctx.enemies, firer.lockTarget);
  if (idx >= 0) {
    const Vec3 pivot{firer.pos.x, firer.pos.y + wpn::BladePivotY, firer.pos.z};
    const Vec3 to = ctx.enemies.items[idx].vol.Centre() - pivot;
    if (to.LengthSq() < wpn::BladeLungeRange * wpn::BladeLungeRange) {
      bladeDir_ = to.Normalised();
      got = true;
    }
  }
  if (!got) {
    bladeDir_ = firer.aimDir;
    bladeDir_.y = Clamp(bladeDir_.y, -0.35f, 0.35f);
    bladeDir_.Normalise();
  }

  bladeT_ = cfg::Blade::Windup;
  s.phase = BladePhase::Windup;
  s.active = false;

  out.bladeSwingStarted = true;
  out.shake = std::fmax(out.shake, 0.22f);
  out.shakeDuration = std::fmax(out.shakeDuration, 0.14f);
}

/** The lunge: a hard velocity WRITE, not an acceleration nudge. */
void WeaponSystem::Dash(const FirerState& firer, float scale, WeaponOutput& out) {
  (void)firer;
  const float sp = cfg::Blade::DashSpeed * scale;
  out.dash = true;
  out.dashVelocity = Vec3{bladeDir_.x * sp,
                          Clamp(bladeDir_.y * sp * 0.72f, -46.0f, 40.0f),
                          bladeDir_.z * sp};
  if (bladeDir_.y > 0.06f) out.leaveGround = true;
}

/** Blade tip at sweep parameter u (0..1): a diagonal, high shoulder -> low hip. */
Vec3 WeaponSystem::ArcTip(const FirerState& firer, float u) const {
  const float a = (u - 0.5f) * wpn::BladeArc * bladeSide_;
  const float el = 0.34f - u * 0.62f;
  const float ca = std::cos(a);
  const float sa = std::sin(a);

  float dx = bladeDir_.x;
  float dz = bladeDir_.z;
  if (dx * dx + dz * dz < 1e-4f) { dx = firer.forward.x; dz = firer.forward.z; }
  float rx = dx * ca - dz * sa;
  float rz = dx * sa + dz * ca;
  const float flat = std::sqrt(rx * rx + rz * rz);
  const float inv = flat > EPS ? 1.0f / flat : 1.0f;
  rx *= inv;
  rz *= inv;

  const float ce = std::cos(el);
  const float se = std::sin(el);
  return Vec3{firer.pos.x + rx * ce * wpn::BladeReach,
              firer.pos.y + wpn::BladePivotY + se * wpn::BladeReach,
              firer.pos.z + rz * ce * wpn::BladeReach};
}

// ==================================================================
//  R-BACK — VP-60LCS vertical rack
// ==================================================================
void WeaponSystem::UpdateMissile(float dt, const WeaponInput& in, const FirerState& firer,
                                 Ballistics& ballistics, const CombatContext& ctx,
                                 WeaponOutput& out) {
  MissileState& s = state_.missile;

  // ---- salvo in progress: one tube every cfg::Missile::Salvo seconds ----
  if (salvoLeft_ > 0) {
    salvoT_ -= dt;
    int guard = 0;
    while (salvoLeft_ > 0 && salvoT_ <= 0.0f && guard++ < wpn::MissLoopGuard) {
      LaunchMissile(firer, salvoTube_, ballistics, ctx, out);
      ++salvoTube_;
      --salvoLeft_;
      salvoT_ += cfg::Missile::Salvo;
    }
    if (salvoLeft_ <= 0) {
      ReleaseLocks();
      s.reloading = true;
      s.reloadT = cfg::Missile::Reload;
      s.reloadProgress = 0.0f;
    }
  }

  if (s.reloading) {
    s.reloadT -= dt;
    s.reloadProgress = Saturate(1.0f - s.reloadT / cfg::Missile::Reload);
    if (s.reloadT <= 0.0f) {
      s.reloading = false;
      s.reloadT = 0.0f;
      s.reloadProgress = 1.0f;
    }
  }
  s.cooldown = s.reloadT;
  s.racked = s.reloading ? 0 : (s.ammo < cfg::Missile::Count ? s.ammo : cfg::Missile::Count);

  // ---- lock building -------------------------------------------------
  // The latch is what makes "hold" mean HOLD: keeping the button down
  // re-arms the rack the instant the reload finishes.
  if (in.missile && !prev_.missile) mLatch_ = true;
  if (!in.missile) mLatch_ = false;

  const bool can = !firer.blocked && !s.reloading && s.ammo > 0 && salvoLeft_ <= 0;
  if (!mHold_ && can && mLatch_) {
    mHold_ = true;
    mT_ = 0.0f;
    ReleaseLocks();
  }

  if (mHold_) {
    if (!can) {
      mHold_ = false;
      ReleaseLocks();
    } else if (!in.missile) {
      mHold_ = false;
      if (s.lockCount > 0) BeginSalvo(out);
      else ReleaseLocks();
    } else {
      mT_ += dt;
      const int maxLocks = s.ammo < cfg::Missile::Count ? s.ammo : cfg::Missile::Count;
      int guard = 0;
      while (s.lockCount < maxLocks && guard++ < wpn::MissLoopGuard &&
             mT_ >= wpn::MissFirst + static_cast<float>(s.lockCount) * wpn::MissStep) {
        AddLock(firer);
      }
      const bool full = s.lockCount >= maxLocks;
      const float next = wpn::MissFirst + static_cast<float>(s.lockCount) * wpn::MissStep;
      s.lockProgress = full ? 1.0f : Saturate((mT_ - (next - wpn::MissStep)) / wpn::MissStep);
      // a fully locked rack lets go on its own — hold does not mean hoard
      const float autoAt = wpn::MissFirst + static_cast<float>(maxLocks - 1) * wpn::MissStep
                         + wpn::MissAutoDwell;
      if (full && mT_ >= autoAt) {
        mHold_ = false;
        BeginSalvo(out);
      }
    }
  } else if (salvoLeft_ <= 0) {
    s.lockProgress = 0.0f;
  }
  s.holding = mHold_;

  const float openWant = (mHold_ || salvoLeft_ > 0) ? 1.0f : 0.0f;
  pose_.missileOpen += (openWant - pose_.missileOpen) * std::fmin(1.0f, dt * 9.0f);
}

void WeaponSystem::BeginSalvo(WeaponOutput& out) {
  MissileState& s = state_.missile;
  if (s.lockCount <= 0) return;
  salvoLeft_ = s.lockCount;
  salvoTube_ = 0;
  salvoT_ = 0.0f;
  s.lockProgress = 1.0f;
  out.shake = std::fmax(out.shake, 0.20f);
  out.shakeDuration = std::fmax(out.shakeDuration, 0.18f);
}

void WeaponSystem::AddLock(const FirerState& firer) {
  MissileState& s = state_.missile;
  if (s.lockCount >= cfg::Missile::Count) return;
  s.locks[s.lockCount] = PickLockTarget(firer);
  ++s.lockCount;
}

/** Spread locks across everything in the cone, stacking once all are taken. */
const void* WeaponSystem::PickLockTarget(const FirerState& firer) const {
  const MissileState& s = state_.missile;
  const int listCount = firer.lockList ? firer.lockCount : 0;
  const void* best = nullptr;
  int bestN = 1 << 30;

  for (int c = 0; c <= listCount; ++c) {
    const void* cand = (c == 0) ? firer.lockTarget : firer.lockList[c - 1];
    if (!cand) continue;
    if (c > 0 && cand == firer.lockTarget) continue;          // the hard lock already ran
    bool dup = false;
    for (int k = 0; k + 1 < c; ++k) {
      if (firer.lockList[k] == cand) { dup = true; break; }
    }
    if (dup) continue;

    int n = 0;
    for (int k = 0; k < s.lockCount; ++k) if (s.locks[k] == cand) ++n;
    if (n < bestN) { bestN = n; best = cand; }
    if (n == 0) break;
  }
  return best;
}

void WeaponSystem::LaunchMissile(const FirerState& firer, int tube, Ballistics& ballistics,
                                 const CombatContext& ctx, WeaponOutput& out) {
  MissileState& s = state_.missile;
  if (s.ammo <= 0) { salvoLeft_ = 0; return; }
  const void* target = (tube >= 0 && tube < s.lockCount) ? s.locks[tube] : nullptr;

  // fan the tubes across the rack
  const float side = ((tube & 1) ? 1.0f : -1.0f) * (0.45f + static_cast<float>(tube >> 1) * 0.55f);
  Vec3 origin = Muzzle(firer, Hardpoint::RBack);
  origin.AddScaled(firer.right, side * wpn::MissTubeSpread);
  origin.y += 0.5f;

  Vec3 dir{0.0f, 1.0f, 0.0f};
  dir.AddScaled(firer.right, side * 0.20f);
  dir.AddScaled(firer.forward, 0.20f);
  dir.Normalise();

  MissileSpawn m;
  m.origin = origin;
  m.dir = dir;
  m.target = target;
  m.drift = Vec3{firer.right.x * side * 1.15f + firer.forward.x * 0.5f, 0.0f,
                 firer.right.z * side * 1.15f + firer.forward.z * 0.5f};
  m.launchSpeed = wpn::MissLaunchSpeed;
  m.owner = Owner::Player;
  m.weapon = WeaponId::Missile;
  m.source = firer.self;

  if (!target) {
    // No lock at all: a lob onto whatever the reticle covers, scattered a
    // little per tube so the salvo walks across the impact area. The reticle
    // can land on the far plane, and a rack that chases that just leaves the
    // map — so an unlocked lob tops out at MissLob.
    Vec3 to = firer.aimPoint - firer.pos;
    const float d = to.Length();
    Vec3 aimAt;
    if (d > wpn::MissLob && d > EPS) {
      aimAt = firer.pos + to * (wpn::MissLob / d);
      if (ctx.world) {
        const float gy = ctx.world->SampleHeight(aimAt.x, aimAt.z, 1e9f);
        if (std::isfinite(gy)) aimAt.y = gy + 1.5f;
      }
    } else {
      aimAt = firer.pos + to;
    }
    aimAt.x += firer.right.x * side * 5.5f + rng_.Range(-3.5f, 3.5f);
    aimAt.z += firer.right.z * side * 5.5f + rng_.Range(-3.5f, 3.5f);
    m.hasAim = true;
    m.aim = aimAt;
  }

  ballistics.SpawnMissile(m);
  --s.ammo;
  ++out.missilesLaunched;
}

void WeaponSystem::ReleaseLocks() {
  MissileState& s = state_.missile;
  for (int i = 0; i < cfg::Missile::Count; ++i) s.locks[i] = nullptr;
  s.lockCount = 0;
  s.lockProgress = 0.0f;
}

// ==================================================================
//  L-BACK — BML-SB PYRE plasma cannon
// ==================================================================
void WeaponSystem::UpdateCannon(float dt, const WeaponInput& in, const FirerState& firer,
                                Ballistics& ballistics, WeaponOutput& out) {
  CannonState& s = state_.cannon;
  if (s.cooldown > 0.0f) s.cooldown = std::fmax(0.0f, s.cooldown - dt);
  s.ready = s.cooldown <= 0.0f && s.ammo > 0 && !firer.blocked;

  if (!s.charging) {
    if (s.ready && in.cannon && !prev_.cannon) {
      s.charging = true;
      s.charge = 0.0f;
      cT_ = 0.0f;
      cFull_ = 0.0f;
    }
    return;
  }

  if (firer.blocked || s.ammo <= 0) { VentCannon(out); return; }

  if (!in.cannon) {
    // tapped: the chamber vents instead of coughing out a dud
    if (s.charge >= wpn::CannonMinCharge) FireCannon(firer, ballistics, out);
    else VentCannon(out);
    return;
  }

  cT_ += dt;
  s.charge = Saturate(cT_ / cfg::Cannon::ChargeTime);
  if (s.charge >= 1.0f) {
    cFull_ += dt;
    // a full chamber lets go rather than cooking off inside the mech
    if (cFull_ >= wpn::CannonAutoDwell) FireCannon(firer, ballistics, out);
  }
}

void WeaponSystem::FireCannon(const FirerState& firer, Ballistics& ballistics,
                              WeaponOutput& out) {
  CannonState& s = state_.cannon;
  const float k = wpn::CannonDamageFloor + wpn::CannonDamageGain * s.charge;
  const Vec3 dir = Solve(firer, Hardpoint::LBack);

  PlasmaSpawn p;
  p.origin = Muzzle(firer, Hardpoint::LBack);
  p.dir = dir;
  p.speed = cfg::Cannon::Speed;
  p.radius = wpn::CannonBoltRadius + wpn::CannonBoltRadiusGain * s.charge;
  p.damage = cfg::Cannon::Damage * k;
  p.impact = cfg::Cannon::Impact * k;
  p.acs = cfg::Cannon::Acs * k;                 // reliable stagger at full charge
  p.blastRadius = cfg::Cannon::BlastRadius * (wpn::CannonBlastFloor + wpn::CannonBlastGain * s.charge);
  p.power = k;
  p.owner = Owner::Player;
  p.weapon = WeaponId::Cannon;
  p.source = firer.self;
  ballistics.SpawnPlasma(p);

  const float charged = s.charge;
  --s.ammo;
  s.cooldown = cfg::Cannon::Cooldown;
  s.charging = false;
  s.charge = 0.0f;
  cT_ = 0.0f;
  cFull_ = 0.0f;

  out.cannonFired = true;
  out.shake = std::fmax(out.shake, 0.95f + charged * 0.45f);
  out.shakeDuration = std::fmax(out.shakeDuration, 0.42f);

  // the recoil actually moves the mech
  const float push = wpn::CannonPushBase + charged * wpn::CannonPushCharge;
  out.impulse += Vec3{-dir.x * push,
                      Clamp(-dir.y * push * wpn::CannonPushLift,
                            wpn::CannonPushLiftMin, wpn::CannonPushLiftMax),
                      -dir.z * push};
}

void WeaponSystem::VentCannon(WeaponOutput& out) {
  CannonState& s = state_.cannon;
  s.charging = false;
  s.charge = 0.0f;
  cT_ = 0.0f;
  cFull_ = 0.0f;
  out.cannonVented = true;
}

}  // namespace ob

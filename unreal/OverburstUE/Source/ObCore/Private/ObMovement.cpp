// ============================================================
//  ObCore — mech movement solver implementation.
//
//  Port of overburst/src/mech/player.js update()/_move()/_bounds()/
//  _quickBoost()/_updateAssault() and playerCollide.js.
//
//  The one structural difference from the web build, and the reason for
//  it: the web solver is handed a LIST of colliders and pushes the capsule
//  out of each overlap. ObCore is handed a SWEEP (IWorldQuery::SweepCapsule)
//  because that is the seam that both Unreal's UWorld traces and the test
//  harness's analytic box world can implement honestly. So the same
//  behaviour — kill the into-surface velocity, deflect part of it into a
//  tangential glide, keep the tangential speed — is driven by
//  collide-and-slide instead of push-out. The velocity response below is
//  the web build's, unchanged; only the way contacts are discovered moved.
//  Depenetration is still handled: a host that reports a t=0 overlap with a
//  depth gets pushed out by exactly that depth.
// ============================================================
#include "ObMovement.h"

namespace ob {

// ------------------------------------------------------------------
void MoveEvents::Clear() {
  *this = MoveEvents{};
}

void MoveEvents::Shake(float amount, float duration) {
  // One shake channel per frame; the loudest thing that happened wins.
  if (amount > shake) {
    shake = amount;
    shakeTime = duration;
  }
}

// ------------------------------------------------------------------
void MechMover::Reset(const Vec3& spawn, float startYaw) {
  pos = spawn;
  vel.Zero();
  yaw = startYaw;
  pitch = -0.05f;
  grounded = true;
  boosting = false;
  abActive = false;
  qbTimer = 0.0f;
  qbCooldown = 0.0f;
  qbDirX = 0.0f;
  qbDirZ = -1.0f;
  qbHeldTime = 0.0f;
  speed = 0.0f;
  prevVy = 0.0f;
  elapsed = 0.0f;
  outOfBounds = false;
  boundsWarn = 0.0f;
  energy.Reset();
  events.Clear();
}

float MechMover::Authority(const MoveInput& in) {
  if (!in.alive) return 0.0f;
  if (in.staggered) return mv::StaggerAuth;
  if (in.repairing) return mv::RepairAuth;
  return 1.0f;
}

void MechMover::Knockback(const Vec3& from, float power) {
  Vec3 away{pos.x - from.x, 0.0f, pos.z - from.z};
  const float l = away.Length();
  if (l < 1e-3f) return;
  vel.x += away.x * (power / l);
  vel.z += away.z * (power / l);
}

// ==================================================================
//  main step
// ==================================================================
void MechMover::Step(const MoveInput& in, const IWorldQuery& world, float dt) {
  events.Clear();

  // A hitching host must not be able to teleport the mech. Same clamp the
  // web build uses, and the sub-stepper below is sized against it.
  float d = dt;
  if (!(d > 0.0f)) d = mv::FallbackDt;
  if (d > mv::MaxFrameDt) d = mv::MaxFrameDt;
  elapsed += d;

  // ---- look ------------------------------------------------------
  if (in.alive) {
    yaw -= in.lookDx * cfg::Cam::Sens;
    pitch = Clamp(pitch - in.lookDy * cfg::Cam::Sens, cfg::Cam::PitchMin, cfg::Cam::PitchMax);
  }

  // ---- timers ----------------------------------------------------
  if (qbCooldown > 0.0f) qbCooldown -= d;
  if (qbTimer > 0.0f) qbTimer -= d;
  energy.TickTimers(d);
  if (energy.justRestored) events.enRestored = true;

  // ---- basis -----------------------------------------------------
  const Vec3 fwd = ForwardFromYaw(yaw);
  const Vec3 right = RightFromYaw(yaw);

  // ---- input -----------------------------------------------------
  const bool dead = !in.alive;
  float ax = dead ? 0.0f : in.moveX;
  float az = dead ? 0.0f : in.moveZ;
  {
    const float m = std::sqrt(ax * ax + az * az);
    if (m > 1.0f) {
      ax /= m;
      az /= m;
    }
  }

  const float auth = Authority(in);
  const bool qbHeld = !dead && in.qbHeld;
  const bool qbTap = !dead && in.qbPressed;
  const bool ascend = !dead && auth > 0.5f && in.ascend;
  const bool ascendTap = !dead && auth > 0.5f && in.ascendPressed;
  const bool descend = !dead && in.descend;
  qbHeldTime = qbHeld ? qbHeldTime + d : 0.0f;

  const bool moving = (ax != 0.0f || az != 0.0f) && auth > 0.0f;
  Vec3 wish{};
  if (moving) {
    wish = fwd * az + right * ax;
    if (wish.LengthSq() > 1e-6f) wish.Normalise();
  }

  // ---- quick boost -----------------------------------------------
  // Runs BEFORE the assault-boost update, so a tap during an assault boost
  // both fires the quick boost and cancels the AB — the AC6 escape hatch.
  if (qbTap) {
    bool ok = false;
    if (!dead && !in.staggered && !in.repairing && qbCooldown <= 0.0f && !energy.Locked()) {
      // Neutral quick boost is a BACKSTEP: with no stick input the mech
      // kicks away from its facing rather than refusing the verb.
      ok = moving ? TryQuickBoost(wish.x, wish.z) : TryQuickBoost(-fwd.x, -fwd.z);
    }
    if (!ok) events.qbRefused = true;
  }

  // ---- assault boost ---------------------------------------------
  UpdateAssault(d, qbHeld, qbTap, az, auth, in);

  // ---- horizontal drive ------------------------------------------
  const bool walkMode = energy.overload;
  float wishSpeed;
  float accel;
  Vec3 driveWish = wish;
  if (abActive) {
    wishSpeed = cfg::Player::AbSpeed;
    accel = cfg::Player::AbAccel;
    // Assault boost tracks the facing; steering authority is deliberately
    // low, which is what makes it a commitment rather than a fast walk.
    driveWish = fwd + right * (ax * mv::AbSteerAuthority);
    driveWish.y = 0.0f;
    if (driveWish.LengthSq() > 1e-6f) driveWish.Normalise();
  } else if (walkMode) {
    wishSpeed = cfg::Player::WalkSpeed;
    accel = grounded ? mv::AccelWalk : mv::AccelAir;
  } else {
    wishSpeed = cfg::Player::BoostSpeed;
    accel = grounded ? mv::AccelGround : mv::AccelAir;
  }
  wishSpeed *= (auth == 1.0f) ? 1.0f : (auth > mv::MinAuthSpeed ? auth : mv::MinAuthSpeed);
  accel *= auth;

  // --- THE MODEL: drag first, then top up. Never subtract. ---------
  float drag;
  if (abActive) {
    drag = grounded ? mv::AbDragGround : mv::AbDragAir;
  } else if (!grounded) {
    drag = cfg::Player::AirDrag;
  } else if (moving) {
    drag = walkMode ? cfg::Player::GroundDrag * mv::WalkDragScale : cfg::Player::BoostDrag;
  } else {
    drag = cfg::Player::GroundDrag;
  }
  if (qbTimer > 0.0f) drag *= cfg::Player::QbDragBoost;  // the window that carries the burst
  if (in.staggered) drag *= mv::StaggerDragScale;

  const float dk = std::exp(-drag * d);
  vel.x *= dk;
  vel.z *= dk;

  if (abActive || moving) {
    const float cur = vel.x * driveWish.x + vel.z * driveWish.z;
    const float room = wishSpeed - cur;
    if (room > 0.0f) {
      // min(accel*d, room): tops up TO the wish speed, never past it, and
      // never back down to it. An overspeeding mech gets nothing here and
      // keeps every metre per second the boost gave it.
      const float add = (accel * d < room) ? accel * d : room;
      vel.x += driveWish.x * add;
      vel.z += driveWish.z * add;
    }
  }

  // quick-boost thrust tail — short, quadratic, keeps the burst alive
  if (qbTimer > 0.0f) {
    const float k = qbTimer / cfg::Player::QbDuration;
    const float a = mv::QbTail * k * k * d;
    vel.x += qbDirX * a;
    vel.z += qbDirZ * a;
  }

  // ---- vertical ---------------------------------------------------
  prevVy = vel.y;
  if (ascend && energy.Drain(cfg::Player::HoverEnDrain, d)) {
    if (ascendTap && grounded) {
      vel.y = vel.y > cfg::Player::JumpImpulse ? vel.y : cfg::Player::JumpImpulse;
    } else {
      vel.y += cfg::Player::HoverThrust * d;
    }
    if (vel.y > mv::VAscendMax) vel.y = mv::VAscendMax;
    grounded = false;
  } else {
    if (!grounded) {
      vel.y -= cfg::Player::Gravity * d;
      if (descend) vel.y -= cfg::Player::DescendThrust * d;
      vel.y *= std::exp(-mv::AirVDrag * d);
      if (vel.y < mv::VTerminal) vel.y = mv::VTerminal;
    } else if (vel.y > 0.0f) {
      vel.y -= cfg::Player::Gravity * d;
    }
  }

  // Whichever verb emptied the tank this frame — boost, ignition or hover —
  // the redline kills the assault boost with it.
  if (energy.justRedlined) {
    events.redlined = true;
    EndAssault();
  }

  // ---- integrate + collide ---------------------------------------
  Integrate(world, d, ascend);

  // ---- arena bounds -----------------------------------------------
  ApplyArenaBounds(d);

  // ---- EN recharge, at the bottom of the frame --------------------
  energy.Recharge(d, grounded);

  // ---- derived ----------------------------------------------------
  speed = vel.LengthXZ();
  boosting = !grounded || abActive || qbTimer > 0.0f ||
             speed > cfg::Player::WalkSpeed * mv::BoostingSpeedFrac;
}

// ==================================================================
//  quick boost — the core verb
// ==================================================================
bool MechMover::TryQuickBoost(float dx, float dz) {
  const float l = std::sqrt(dx * dx + dz * dz);
  if (l < 1e-4f) return false;
  dx /= l;
  dz /= l;

  // Note the ordering: the EN is committed BEFORE any velocity changes, so
  // a refused boost leaves the mech untouched — but a boost you could not
  // afford still empties the tank and redlines you. That is the punish.
  if (!energy.Spend(cfg::Player::QbEnCost)) return false;

  const float along = vel.x * dx + vel.z * dz;
  // Scrub part of the perpendicular so 8-way direction changes are crisp.
  const float px = vel.x - dx * along;
  const float pz = vel.z - dz * along;
  vel.x -= px * mv::QbPerpScrub;
  vel.z -= pz * mv::QbPerpScrub;

  // Hard injection: always at least the full impulse in the new direction,
  // and boosting along your existing run stacks a little on top of it.
  const float stacked = along + cfg::Player::QbImpulse * mv::QbAlongKeep;
  const float target = stacked > cfg::Player::QbImpulse ? stacked : cfg::Player::QbImpulse;
  vel.x += dx * (target - along);
  vel.z += dz * (target - along);

  if (grounded) {
    vel.y = vel.y > mv::QbGroundHop ? vel.y : mv::QbGroundHop;
  } else if (vel.y < 0.0f) {
    vel.y *= mv::QbFallCut;
  }

  qbTimer = cfg::Player::QbDuration;
  qbCooldown = cfg::Player::QbReload;
  qbDirX = dx;
  qbDirZ = dz;
  grounded = false;

  events.quickBoosted = true;
  events.qbDirX = dx;
  events.qbDirZ = dz;
  events.Shake(0.30f, 0.14f);
  return true;
}

// ==================================================================
//  assault boost
// ==================================================================
void MechMover::UpdateAssault(float d, bool qbHeld, bool qbTap, float az, float auth,
                              const MoveInput& in) {
  if (abActive) {
    const bool stop = !qbHeld || qbTap || az < 0.2f || in.staggered || in.repairing ||
                      !in.alive || auth < 1.0f;
    // Short-circuit is deliberate: on the frame the AB stops, no EN is drained.
    if (stop || !energy.Drain(cfg::Player::AbEnDrain, d)) EndAssault();
    return;
  }

  if (!qbHeld || qbTap || az < 0.5f || auth < 1.0f) return;
  if (qbHeldTime < mv::AbHold || qbTimer > 0.0f) return;
  if (in.staggered || in.repairing || energy.Locked()) return;
  // Refuse to ignite on fumes: lighting the AB and instantly redlining is a
  // worse outcome than not lighting it.
  if (energy.en < cfg::Player::AbIgnition * mv::AbIgnitionMargin) return;
  if (!energy.Spend(cfg::Player::AbIgnition)) return;

  abActive = true;
  events.abIgnited = true;
  events.Shake(0.24f, 0.30f);
}

void MechMover::EndAssault() {
  if (!abActive) return;
  abActive = false;
  events.abEnded = true;
}

// ==================================================================
//  translation, sub-stepped so nothing tunnels at 146 m/s
// ==================================================================
void MechMover::Integrate(const IWorldQuery& world, float d, bool ascend) {
  const bool wasGrounded = grounded;
  const float len = vel.Length() * d;

  int steps = static_cast<int>(std::ceil(len / mv::SubStepSpan));
  if (steps < 1) steps = 1;
  if (steps > mv::MaxSubSteps) steps = mv::MaxSubSteps;
  const float sdt = d / static_cast<float>(steps);
  const bool snap = wasGrounded && !ascend;

  bool g = false;
  float hitSpeed = 0.0f;
  float hnx = 0.0f;
  float hnz = 0.0f;

  for (int i = 0; i < steps; ++i) {
    const float prevPosY = pos.y;
    SlideStep(world, sdt, hitSpeed, hnx, hnz);
    g = ResolveGround(world, prevPosY, snap && vel.y <= mv::GroundSnapVy);
  }

  if (pos.y > cfg::Arena::Ceiling) {
    pos.y = cfg::Arena::Ceiling;
    if (vel.y > 0.0f) vel.y = 0.0f;
  }

  // --- wall slam: costs no ACS, but it shakes the frame and can kill an
  //     assault boost outright.
  if (hitSpeed > mv::WallSlamSpeed) {
    const float k = Saturate(hitSpeed / 150.0f);
    events.wallImpact = true;
    events.impactSpeed = hitSpeed;
    events.impactNx = hnx;
    events.impactNz = hnz;
    events.Shake(0.28f + k * 0.5f, 0.16f + k * 0.12f);
    if (abActive && k > 0.5f) EndAssault();
  }

  // --- landing -----------------------------------------------------
  if (g && !wasGrounded) {
    events.landed = true;
    events.landingVy = prevVy;
    if (-prevVy > mv::LandHard) {
      const float k = Saturate(-prevVy / 110.0f);
      events.hardLanding = true;
      events.Shake(0.22f + k * 0.62f, 0.18f + k * 0.14f);
    }
  }
  grounded = g;
}

// ------------------------------------------------------------------
//  Collide-and-slide for one sub-step.
//
//  Velocity response is playerCollide.js's push(), unchanged: cancel only
//  the component driving into the face, then hand part of the killed speed
//  back as a tangential glide so a 2 m stanchion shoulders the mech aside
//  instead of gluing it in place — capped so a chain of contacts cannot
//  pump energy into the frame.
// ------------------------------------------------------------------
void MechMover::SlideStep(const IWorldQuery& world, float sdt, float& hitSpeed, float& hnx,
                          float& hnz) {
  Vec3 remaining = vel * sdt;

  for (int it = 0; it < mv::MaxSlideIters; ++it) {
    // Note the `it > 0`: a STATIONARY mech still queries once. The web
    // build's push() runs every sub-step regardless of speed, so an overlap
    // it did not create itself — a bad spawn, a knockback into a pillar,
    // geometry moving into the mech — is ejected rather than tolerated. A
    // zero-length sweep is exactly that overlap test.
    if (it > 0 && remaining.LengthSq() < EPS * EPS) return;

    const SweepHit h =
        world.SweepCapsule(pos, remaining, cfg::Player::Radius, cfg::Player::Height);
    if (!h.hit) {
      pos += remaining;
      return;
    }

    Vec3 n = h.normal;
    const float nl = n.Length();
    if (nl < EPS) return;  // degenerate normal: stop rather than teleport
    n = n / nl;

    const float t = Clamp(h.time, 0.0f, 1.0f);
    pos.AddScaled(remaining, t);
    // Separation, plus depenetration if the host reported a standing overlap.
    pos.AddScaled(n, mv::Skin + (h.depth > 0.0f ? h.depth : 0.0f));

    // --- horizontal response (playerCollide.js push()) --------------
    float nx = n.x;
    float nz = n.z;
    const float hl = std::sqrt(nx * nx + nz * nz);
    if (hl > EPS) {
      nx /= hl;
      nz /= hl;
      const float vn = vel.x * nx + vel.z * nz;
      if (vn < 0.0f) {
        const float pre = std::sqrt(vel.x * vel.x + vel.z * vel.z);
        vel.x -= nx * vn;
        vel.z -= nz * vn;

        const float tx = -nz;
        const float tz = nx;
        const float s = (vel.x * tx + vel.z * tz) >= 0.0f ? 1.0f : -1.0f;
        const float cur = std::sqrt(vel.x * vel.x + vel.z * vel.z);
        float give = -vn * mv::Deflect;
        if (give > mv::DeflectMax) give = mv::DeflectMax;
        const float headroom = pre - cur;
        if (give > headroom) give = headroom;
        if (give > 0.0f) {
          vel.x += tx * s * give;
          vel.z += tz * s * give;
        }

        if (-vn > hitSpeed) {
          hitSpeed = -vn;
          hnx = nx;
          hnz = nz;
        }
      }
    }

    // --- vertical response ------------------------------------------
    if (n.y < -EPS && vel.y > 0.0f) vel.y = 0.0f;  // head bump under a deck
    if (n.y > EPS && vel.y < 0.0f) vel.y = 0.0f;   // swept onto a surface

    // Slide the leftover motion along the contact plane and try again.
    Vec3 left = remaining * (1.0f - t);
    left.AddScaled(n, -Dot(left, n));
    remaining = left;
  }
  // Out of iterations in a crevice: the remaining motion is dropped, which
  // is always safe. Losing a centimetre beats ending up inside a wall.
}

// ------------------------------------------------------------------
//  Vertical: land on the highest walkable surface under the capsule.
//  SampleHeight is the authority here, not the sweep — that is what lets a
//  mech walk up a ramp or a low step instead of being stopped by it.
// ------------------------------------------------------------------
bool MechMover::ResolveGround(const IWorldQuery& world, float prevY, bool snap) {
  const float ref = (prevY > pos.y ? prevY : pos.y) + 0.5f;
  const float gy = world.SampleHeight(pos.x, pos.z, ref);

  if (pos.y <= gy) {
    pos.y = gy;
    if (vel.y < 0.0f) vel.y = 0.0f;
    return true;
  }
  // Walking down a slope or off a low step: stay glued instead of hopping.
  if (snap && pos.y - gy <= mv::GroundSnapDrop) {
    pos.y = gy;
    if (vel.y < 0.0f) vel.y = 0.0f;
    return true;
  }
  return false;
}

// ==================================================================
//  arena boundary — carve, don't brake
// ==================================================================
void MechMover::ApplyArenaBounds(float d) {
  const float r = std::sqrt(pos.x * pos.x + pos.z * pos.z);

  // The shove starts INSIDE the nominal radius: the perimeter structures
  // sit right on it, and a 146 m/s slam into a blast wall is a worse "you
  // have left the operation area" than a firm push.
  const float R = cfg::Arena::Radius - mv::WallMargin;

  if (boundsWarn > 0.0f) boundsWarn -= d;
  if (r > cfg::Arena::Radius - mv::WallWarnMargin) {
    outOfBounds = true;
    if (boundsWarn <= 0.0f) {
      boundsWarn = mv::WallWarnHold;
      events.boundsWarning = true;
    }
  } else if (r <= R) {
    outOfBounds = false;
  }
  if (r <= R) return;

  const float inv = 1.0f / (r > 1e-3f ? r : 1e-3f);
  const float nx = -pos.x * inv;
  const float nz = -pos.z * inv;
  const float k = Saturate((r - R) / mv::WallCarveSpan);

  // Rotate the velocity toward the inside at a bounded rate — speed is
  // preserved exactly — and let the heading follow a beat later, so a
  // boundary run reads as a banked high-speed turn, not a face-plant.
  const float spd = std::sqrt(vel.x * vel.x + vel.z * vel.z);
  if (spd > mv::WallCarveMinSpeed) {
    const float cur = std::atan2(vel.z, vel.x);
    const float want = std::atan2(nz, nx);
    const float lim = mv::WallTurn * k * d;
    const float step = Clamp(AngleDelta(cur, want), -lim, lim);
    const float cs = std::cos(step);
    const float sn = std::sin(step);
    const float vx = vel.x;
    const float vz = vel.z;
    vel.x = vx * cs - vz * sn;
    vel.z = vx * sn + vz * cs;

    const float wantYaw = std::atan2(-nx, -nz);
    const float yStep = mv::WallYaw * k * d;
    yaw += Clamp(AngleDelta(yaw, wantYaw), -yStep, yStep);
  }

  vel.x += nx * mv::WallPush * k * d;
  vel.z += nz * mv::WallPush * k * d;

  const float hard = cfg::Arena::Radius + mv::WallHardOver;
  if (r > hard) {
    pos.x += nx * (r - hard);
    pos.z += nz * (r - hard);
    const float vn = vel.x * nx + vel.z * nz;
    if (vn < 0.0f) {
      vel.x -= nx * vn;
      vel.z -= nz * vn;
    }
  }
}

}  // namespace ob

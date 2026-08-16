// ============================================================
//  ObCore — the ONLY seam between the simulation and its host.
//
//  ObCore has no idea what a level is. The host answers spatial
//  questions: Unreal answers them with UWorld traces, the test harness
//  answers them with an analytic box world. That is what makes the
//  movement solver testable without an engine.
// ============================================================
#pragma once

#include "ObTypes.h"

namespace ob {

struct RayHit {
  bool hit = false;
  Vec3 point;
  Vec3 normal{0.0f, 1.0f, 0.0f};
  float distance = 0.0f;
  /** Opaque host handle for the thing that was hit; ObCore never dereferences it. */
  const void* userData = nullptr;
};

struct SweepHit {
  bool hit = false;
  Vec3 point;
  Vec3 normal{0.0f, 1.0f, 0.0f};
  /** Fraction of the requested motion completed before contact, 0..1. */
  float time = 1.0f;
  float depth = 0.0f;
  const void* userData = nullptr;
};

/**
 * Implemented by the host.
 *
 * All positions and distances are ObCore METRES. The Unreal implementation
 * converts to centimetres on the way in and back on the way out.
 */
class IWorldQuery {
 public:
  virtual ~IWorldQuery() = default;

  /**
   * Highest walkable surface under (x, z).
   *
   * `yRef` is the querying entity's current height: surfaces more than a
   * few metres above it are ignored, so a mech can walk UNDER a catwalk
   * instead of being teleported onto it. Pass a huge value for the
   * absolute top surface.
   */
  virtual float SampleHeight(float x, float z, float yRef) const = 0;

  /** First solid hit along a ray. */
  virtual RayHit Raycast(const Vec3& origin, const Vec3& dir, float maxDist) const = 0;

  /**
   * Sweep a vertical capsule from `from` by `delta`. The movement solver
   * uses this for collide-and-slide; it may be called several times per
   * frame as the solver resolves.
   */
  virtual SweepHit SweepCapsule(const Vec3& from, const Vec3& delta,
                                float radius, float height) const = 0;

  /** True if the straight segment a->b is unobstructed. Used for AI LOS. */
  virtual bool LineOfSight(const Vec3& a, const Vec3& b) const {
    const Vec3 d = b - a;
    const float len = d.Length();
    if (len < EPS) return true;
    return !Raycast(a, d / len, len).hit;
  }
};

/** A world with nothing in it. Lets a system be exercised before a level exists. */
class EmptyWorld final : public IWorldQuery {
 public:
  float groundY = 0.0f;

  float SampleHeight(float, float, float) const override { return groundY; }
  RayHit Raycast(const Vec3&, const Vec3&, float) const override { return {}; }
  SweepHit SweepCapsule(const Vec3&, const Vec3&, float, float) const override { return {}; }
};

}  // namespace ob

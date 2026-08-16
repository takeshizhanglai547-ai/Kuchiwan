// ============================================================
//  ObCore — foundation types.
//
//  ZERO Unreal dependencies, by contract. This header must compile
//  with `g++ -std=c++17 -Wall -Wextra` on a machine with no engine
//  installed, because that is how every number in ObCore is verified.
//
//  Authored in METRES to match the web build's tuning 1:1. The Unreal
//  layer converts to centimetres exactly once, at the component
//  boundary (OB_M_TO_UU).
// ============================================================
#pragma once

#include <cmath>
#include <cstdint>

namespace ob {

constexpr float PI = 3.14159265358979323846f;
constexpr float TAU = PI * 2.0f;
constexpr float EPS = 1e-6f;

/** ObCore metres -> Unreal units. Apply at the boundary, never inside gameplay. */
constexpr float M_TO_UU = 100.0f;
constexpr float UU_TO_M = 0.01f;

inline float Clamp(float v, float lo, float hi) { return v < lo ? lo : (v > hi ? hi : v); }
inline float Saturate(float v) { return Clamp(v, 0.0f, 1.0f); }
inline float Lerp(float a, float b, float t) { return a + (b - a) * t; }
inline float Sign(float v) { return v < 0.0f ? -1.0f : (v > 0.0f ? 1.0f : 0.0f); }
inline float Sq(float v) { return v * v; }

/** Frame-rate independent exponential smoothing. */
inline float Damp(float a, float b, float lambda, float dt) {
  return Lerp(a, b, 1.0f - std::exp(-lambda * dt));
}

inline float WrapAngle(float a) {
  while (a > PI) a -= TAU;
  while (a < -PI) a += TAU;
  return a;
}

inline float AngleDelta(float from, float to) { return WrapAngle(to - from); }

inline float MoveTowards(float cur, float target, float maxDelta) {
  const float d = target - cur;
  if (std::fabs(d) <= maxDelta) return target;
  return cur + Sign(d) * maxDelta;
}

// ------------------------------------------------------------------
//  Vec3 — right-handed, Y up, matching the web build so the two
//  targets can be compared number for number. The Unreal layer swizzles
//  to Z-up at the boundary alongside the unit conversion.
// ------------------------------------------------------------------
struct Vec3 {
  float x = 0.0f, y = 0.0f, z = 0.0f;

  constexpr Vec3() = default;
  constexpr Vec3(float ix, float iy, float iz) : x(ix), y(iy), z(iz) {}

  Vec3 operator+(const Vec3& o) const { return {x + o.x, y + o.y, z + o.z}; }
  Vec3 operator-(const Vec3& o) const { return {x - o.x, y - o.y, z - o.z}; }
  Vec3 operator*(float s) const { return {x * s, y * s, z * s}; }
  Vec3 operator/(float s) const { const float i = 1.0f / s; return {x * i, y * i, z * i}; }
  Vec3 operator-() const { return {-x, -y, -z}; }

  Vec3& operator+=(const Vec3& o) { x += o.x; y += o.y; z += o.z; return *this; }
  Vec3& operator-=(const Vec3& o) { x -= o.x; y -= o.y; z -= o.z; return *this; }
  Vec3& operator*=(float s) { x *= s; y *= s; z *= s; return *this; }

  bool operator==(const Vec3& o) const { return x == o.x && y == o.y && z == o.z; }

  float LengthSq() const { return x * x + y * y + z * z; }
  float Length() const { return std::sqrt(LengthSq()); }

  /** Horizontal (XZ) magnitude — the one that matters for boost speed. */
  float LengthXZ() const { return std::sqrt(x * x + z * z); }

  Vec3 Normalised() const {
    const float l = Length();
    return l > EPS ? (*this / l) : Vec3{};
  }

  void Normalise() {
    const float l = Length();
    if (l > EPS) { const float i = 1.0f / l; x *= i; y *= i; z *= i; }
  }

  void Zero() { x = y = z = 0.0f; }
  bool IsFinite() const { return std::isfinite(x) && std::isfinite(y) && std::isfinite(z); }

  void AddScaled(const Vec3& v, float s) { x += v.x * s; y += v.y * s; z += v.z * s; }
};

inline Vec3 operator*(float s, const Vec3& v) { return v * s; }
inline float Dot(const Vec3& a, const Vec3& b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
inline Vec3 Cross(const Vec3& a, const Vec3& b) {
  return {a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x};
}
inline float Distance(const Vec3& a, const Vec3& b) { return (a - b).Length(); }
inline float DistanceSq(const Vec3& a, const Vec3& b) { return (a - b).LengthSq(); }
inline Vec3 Lerp(const Vec3& a, const Vec3& b, float t) {
  return {Lerp(a.x, b.x, t), Lerp(a.y, b.y, t), Lerp(a.z, b.z, t)};
}

/** Heading -> unit forward, matching the web build's yaw convention. */
inline Vec3 ForwardFromYaw(float yaw) { return {-std::sin(yaw), 0.0f, -std::cos(yaw)}; }
inline Vec3 RightFromYaw(float yaw) { return {std::cos(yaw), 0.0f, -std::sin(yaw)}; }

/** Aim direction from yaw + pitch. */
inline Vec3 DirFromYawPitch(float yaw, float pitch) {
  const float cp = std::cos(pitch);
  return {-std::sin(yaw) * cp, std::sin(pitch), -std::cos(yaw) * cp};
}

/**
 * Rotate `dir` toward `target` by at most `maxRad`. The turn-rate limiter
 * every guided weapon and every AI heading goes through.
 */
Vec3 TurnToward(const Vec3& dir, const Vec3& target, float maxRad);

// ------------------------------------------------------------------
//  Deterministic PRNG. Gameplay must not depend on the host's rand():
//  a test that cannot be replayed cannot be trusted.
// ------------------------------------------------------------------
struct Rng {
  uint32_t state = 0x9E3779B9u;

  explicit Rng(uint32_t seed = 0x9E3779B9u) : state(seed ? seed : 1u) {}

  uint32_t NextU32() {
    state += 0x6D2B79F5u;
    uint32_t t = state;
    t = (t ^ (t >> 15)) * (1u | t);
    t ^= t + (t ^ (t >> 7)) * (61u | t);
    return t ^ (t >> 14);
  }
  float Unit() { return static_cast<float>(NextU32()) * (1.0f / 4294967296.0f); }
  float Range(float lo, float hi) { return lo + Unit() * (hi - lo); }
  int RangeInt(int lo, int hi) { return lo + static_cast<int>(Unit() * static_cast<float>(hi - lo + 1)); }
  float Signed() { return Unit() * 2.0f - 1.0f; }
};

}  // namespace ob

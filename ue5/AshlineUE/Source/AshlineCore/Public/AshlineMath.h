/* ==========================================================================
   AshlineMath.h — コアの数学。UEにもThree.jsにも依存しない。

   角度の約束（Web版 game.js と同一。ここを崩すと全部の向きが狂う）
     yaw y に対する前方向 = (-sin y, 0, -cos y)
     dirToYaw(x, z)       = atan2(-x, -z)
     yaw 0 は -Z を向く。
   ========================================================================== */
#pragma once

#include <cmath>

namespace Ashline {

inline constexpr float kPi = 3.14159265358979323846f;
inline constexpr float kDeg = kPi / 180.0f;

struct Vec2 {
  float x = 0.0f, z = 0.0f;
};
struct Vec3 {
  float x = 0.0f, y = 0.0f, z = 0.0f;
};

inline float Clamp(float v, float a, float b) { return v < a ? a : (v > b ? b : v); }
inline float Lerp(float a, float b, float t) { return a + (b - a) * t; }

/* フレームレート非依存の指数追従。game.js の smooth() と同一。
   tau が 0 だと発散するので下限を切る。 */
inline float Smooth(float a, float b, float tau, float dt) {
  const float t = tau > 1e-6f ? tau : 1e-6f;
  return b + (a - b) * std::exp(-dt / t);
}

/* 角度を (-pi, pi] に畳む */
inline float ShortAngle(float a) {
  while (a > kPi) a -= kPi * 2.0f;
  while (a < -kPi) a += kPi * 2.0f;
  return a;
}

/* cur を target へ rate[rad/s] で近づける。回り込みは常に短い方。 */
inline float ApproachAngle(float cur, float target, float rate, float dt) {
  const float d = ShortAngle(target - cur);
  const float m = rate * dt;
  if (d > m) return cur + m;
  if (d < -m) return cur - m;
  return target;
}

inline float YawDirX(float y) { return -std::sin(y); }
inline float YawDirZ(float y) { return -std::cos(y); }
inline float DirToYaw(float x, float z) { return std::atan2(-x, -z); }

inline float Hypot2(float a, float b) { return std::sqrt(a * a + b * b); }
inline float Hypot3(float a, float b, float c) { return std::sqrt(a * a + b * b + c * c); }

/* 決定的な擬似乱数。テストで同じ弾道を再現できるようにする。
   std::rand は実装依存なので使わない。 */
class Rng {
 public:
  explicit Rng(unsigned int seed = 1u) : s_(seed ? seed : 1u) {}
  void Seed(unsigned int seed) { s_ = seed ? seed : 1u; }
  /* xorshift32 */
  unsigned int NextU32() {
    s_ ^= s_ << 13;
    s_ ^= s_ >> 17;
    s_ ^= s_ << 5;
    return s_;
  }
  /* [0,1) */
  float Next() { return static_cast<float>(NextU32() & 0x00ffffffu) / 16777216.0f; }
  float Range(float a, float b) { return a + (b - a) * Next(); }

 private:
  unsigned int s_;
};

}  // namespace Ashline

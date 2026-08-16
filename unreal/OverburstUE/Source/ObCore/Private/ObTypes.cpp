#include "ObTypes.h"

namespace ob {

Vec3 TurnToward(const Vec3& dir, const Vec3& target, float maxRad) {
  const Vec3 a = dir.Normalised();
  const Vec3 b = target.Normalised();
  if (a.LengthSq() < EPS || b.LengthSq() < EPS) return a;

  const float d = Clamp(Dot(a, b), -1.0f, 1.0f);
  const float angle = std::acos(d);
  if (angle <= maxRad || angle < EPS) return b;

  // Slerp by exactly maxRad. Anti-parallel has no unique plane, so pick any
  // perpendicular rather than returning NaN.
  Vec3 axis = Cross(a, b);
  if (axis.LengthSq() < EPS) {
    axis = Cross(a, Vec3{0.0f, 1.0f, 0.0f});
    if (axis.LengthSq() < EPS) axis = Cross(a, Vec3{1.0f, 0.0f, 0.0f});
  }
  axis.Normalise();

  const float c = std::cos(maxRad);
  const float s = std::sin(maxRad);
  // Rodrigues
  return a * c + Cross(axis, a) * s + axis * (Dot(axis, a) * (1.0f - c));
}

}  // namespace ob

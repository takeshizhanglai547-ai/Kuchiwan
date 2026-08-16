#include "AshlineWorld.h"

#include <algorithm>

namespace Ashline {

void World::Build() {
  boxes_.clear();
  faces_.clear();

  for (int i = 0; i < Cfg::kCoverCount; ++i) {
    const Cfg::CoverDef& c = Cfg::kCovers[i];
    Box b;
    b.minx = c.x - c.hx;
    b.maxx = c.x + c.hx;
    b.minz = c.z - c.hz;
    b.maxz = c.z + c.hz;
    b.top = c.h;
    b.coverIndex = i;
    boxes_.push_back(b);

    const bool low = c.h <= Cfg::cover::lowMaxH;
    /* 4面。a->b の並びは game.js と一字一句同じ順序であること。 */
    AddFace(i, 0, 1, c.x - c.hx, c.z + c.hz, c.x + c.hx, c.z + c.hz, low);
    AddFace(i, 0, -1, c.x + c.hx, c.z - c.hz, c.x - c.hx, c.z - c.hz, low);
    AddFace(i, 1, 0, c.x + c.hx, c.z + c.hz, c.x + c.hx, c.z - c.hz, low);
    AddFace(i, -1, 0, c.x - c.hx, c.z - c.hz, c.x - c.hx, c.z + c.hz, low);
  }

  /* 外周壁。遮蔽としては使わず、移動と弾だけを止める。 */
  const float hx = Cfg::arena::hx, hz = Cfg::arena::hz, wallH = Cfg::arena::wallH;
  const float t = 0.6f;
  const float wall[4][4] = {
    { -hx - t, -hx, -hz - t, hz + t },
    { hx, hx + t, -hz - t, hz + t },
    { -hx - t, hx + t, -hz - t, -hz },
    { -hx - t, hx + t, hz, hz + t },
  };
  for (const auto& w : wall) {
    Box b;
    b.minx = w[0];
    b.maxx = w[1];
    b.minz = w[2];
    b.maxz = w[3];
    b.top = wallH;
    b.coverIndex = -1;
    boxes_.push_back(b);
  }
}

void World::AddFace(int coverIndex, float nx, float nz,
                    float ax, float az, float bx, float bz, bool low) {
  Face f;
  const float dx = bx - ax, dz = bz - az;
  const float len = Hypot2(dx, dz);
  f.nx = nx;
  f.nz = nz;
  f.ax = ax;
  f.az = az;
  f.tx = dx / len;
  f.tz = dz / len;
  f.len = len;
  f.coverIndex = coverIndex;
  f.low = low;
  faces_.push_back(f);
}

bool World::ResolveCircle(float px, float pz, float r, float& outX, float& outZ) const {
  bool moved = false;
  for (int it = 0; it < 3; ++it) {
    bool any = false;
    for (const Box& b : boxes_) {
      const float cx = Clamp(px, b.minx, b.maxx);
      const float cz = Clamp(pz, b.minz, b.maxz);
      const float dx = px - cx, dz = pz - cz;
      const float d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      any = true;
      moved = true;
      const float d = std::sqrt(d2);
      if (d > 1e-5f) {
        px = cx + dx / d * r;
        pz = cz + dz / d * r;
      } else {
        /* 中心が箱の内側に入ってしまった場合は、一番近い面へ逃がす。 */
        const float l = px - b.minx, rr = b.maxx - px;
        const float u = pz - b.minz, dn = b.maxz - pz;
        const float m = std::min(std::min(l, rr), std::min(u, dn));
        if (m == l) px = b.minx - r;
        else if (m == rr) px = b.maxx + r;
        else if (m == u) pz = b.minz - r;
        else pz = b.maxz + r;
      }
    }
    if (!any) break;
  }
  outX = px;
  outZ = pz;
  return moved;
}

float World::RayBox(float ox, float oy, float oz, float dx, float dy, float dz, const Box& b) {
  float t0 = 0.0f, t1 = kInf;
  float inv, a, bb;

  if (std::fabs(dx) < 1e-8f) {
    if (ox < b.minx || ox > b.maxx) return kInf;
  } else {
    inv = 1.0f / dx;
    a = (b.minx - ox) * inv;
    bb = (b.maxx - ox) * inv;
    if (a > bb) std::swap(a, bb);
    t0 = std::max(t0, a);
    t1 = std::min(t1, bb);
  }

  if (std::fabs(dy) < 1e-8f) {
    if (oy < 0.0f || oy > b.top) return kInf;
  } else {
    inv = 1.0f / dy;
    a = (0.0f - oy) * inv;
    bb = (b.top - oy) * inv;
    if (a > bb) std::swap(a, bb);
    t0 = std::max(t0, a);
    t1 = std::min(t1, bb);
  }

  if (std::fabs(dz) < 1e-8f) {
    if (oz < b.minz || oz > b.maxz) return kInf;
  } else {
    inv = 1.0f / dz;
    a = (b.minz - oz) * inv;
    bb = (b.maxz - oz) * inv;
    if (a > bb) std::swap(a, bb);
    t0 = std::max(t0, a);
    t1 = std::min(t1, bb);
  }

  if (t1 < t0 || t1 < 0.0f) return kInf;
  return t0 > 0.0f ? t0 : kInf;
}

float World::RayBoxY(float ox, float oy, float oz, float dx, float dy, float dz,
                     const Box& b, float y0, float y1) {
  Box slab = b;
  /* RayBox は y を 0..top で見るので、帯を作るには原点を下げて渡す。 */
  slab.top = y1 - y0;
  return RayBox(ox, oy - y0, oz, dx, dy, dz, slab);
}

CoverQuery World::FindCover(float px, float pz, float maxD) const {
  CoverQuery q;
  float bestScore = kInf;
  for (int i = 0; i < static_cast<int>(faces_.size()); ++i) {
    const Face& f = faces_[i];
    const float rx = px - f.ax, rz = pz - f.az;
    const float side = rx * f.nx + rz * f.nz;      // 面の外側にいるか
    if (side < 0.02f || side > maxD) continue;
    const float t = (rx * f.tx + rz * f.tz) / f.len;
    if (t < -0.25f || t > 1.25f) continue;
    const float tc = Clamp(t, 0.0f, 1.0f);
    const float cx = f.ax + f.tx * f.len * tc;
    const float cz = f.az + f.tz * f.len * tc;
    const float d = Hypot2(px - cx, pz - cz);
    if (d > maxD) continue;
    /* 面の正面にいるほど優先する。横から掠める面を拾わないための項。 */
    const float score = d + std::fabs(t - tc) * 2.0f;
    if (score < bestScore) {
      bestScore = score;
      q.faceIndex = i;
      q.t = tc;
    }
  }
  return q;
}

CoverAnchor World::AnchorOn(const Face& f, float t) const {
  CoverAnchor a;
  const float so = Cfg::cover::standOff;
  a.minT = Clamp(Cfg::player::radius * 0.55f / f.len, 0.0f, 0.49f);
  a.t = Clamp(t, a.minT, 1.0f - a.minT);
  a.x = f.ax + f.tx * f.len * a.t + f.nx * so;
  a.z = f.az + f.tz * f.len * a.t + f.nz * so;
  return a;
}

float World::RayWorld(float ox, float oy, float oz, float dx, float dy, float dz,
                      float maxT) const {
  float best = maxT;
  for (const Box& b : boxes_) {
    const float t = RayBox(ox, oy, oz, dx, dy, dz, b);
    if (t < best) best = t;
  }
  /* 床 */
  if (dy < -1e-8f) {
    const float tf = -oy / dy;
    if (tf > 0.0f && tf < best) best = tf;
  }
  return best;
}

}  // namespace Ashline

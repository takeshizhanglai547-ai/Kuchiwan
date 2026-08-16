/* ==========================================================================
   AshlineWorld.h — 衝突と射線。Web版 game.js の boxes/faces をそのまま移した。

   ここは「遮蔽が本当に弾を止めるか」を決める場所で、5本柱のうち
   柱1（止まって撃つ）と柱2（遮蔽が意味を持つ）が物理的に成立する唯一の層。
   見た目は後から差し替えられるが、ここがずれると差し替えでは直らない。
   ========================================================================== */
#pragma once

#include "AshlineConfig.generated.h"
#include "AshlineMath.h"

#include <limits>
#include <vector>

namespace Ashline {

inline constexpr float kInf = std::numeric_limits<float>::infinity();

/* 立体。y は常に 0..top（床から生えた箱しかない）。 */
struct Box {
  float minx = 0, maxx = 0, minz = 0, maxz = 0, top = 0;
  int coverIndex = -1;   // -1 = 外周壁（遮蔽としては使えない）
};

/* 遮蔽の一面。a->b は「壁を向いて立ったときのプレイヤーの左->右」。
   この向きの約束が崩れると、乗り出しの左右が反転する。 */
struct Face {
  float nx = 0, nz = 0;      // 外向き法線（軸平行なので ±1 / 0）
  float ax = 0, az = 0;      // 端点 a
  float tx = 0, tz = 0;      // a->b の単位方向
  float len = 0;
  int coverIndex = -1;
  bool low = false;          // 低い遮蔽＝上から撃てる
};

/* 遮蔽の吸着先。faceIndex < 0 は「近くに遮蔽が無い」。 */
struct CoverQuery {
  int faceIndex = -1;
  float t = 0.0f;
};

/* 面上の立ち位置。端に寄りすぎて体が飛び出さないよう minT で内側に寄せる。 */
struct CoverAnchor {
  float x = 0.0f, z = 0.0f, t = 0.0f, minT = 0.0f;
};

class World {
 public:
  World() { Build(); }

  void Build();

  const std::vector<Box>& Boxes() const { return boxes_; }
  const std::vector<Face>& Faces() const { return faces_; }

  /* 円 vs AABB の押し出し（XZ平面）。押し出したら true。 */
  bool ResolveCircle(float px, float pz, float r, float& outX, float& outZ) const;

  /* Ray vs AABB（スラブ法）。当たらなければ kInf。 */
  static float RayBox(float ox, float oy, float oz, float dx, float dy, float dz, const Box& b);

  /* 世界（箱すべて＋床）に対するレイ。maxT を超える交点は返さない。 */
  float RayWorld(float ox, float oy, float oz, float dx, float dy, float dz,
                 float maxT = kInf) const;

  /* 高さ帯 [y0,y1] に限定した Ray vs AABB。敵の当たり判定（胴/頭）に使う。 */
  static float RayBoxY(float ox, float oy, float oz, float dx, float dy, float dz,
                       const Box& b, float y0, float y1);

  /* (px,pz) から maxD 以内で最も素直に付ける遮蔽面を探す。 */
  CoverQuery FindCover(float px, float pz, float maxD) const;

  /* 面 f の媒介変数 t における立ち位置。 */
  CoverAnchor AnchorOn(const Face& f, float t) const;

 private:
  void AddFace(int coverIndex, float nx, float nz,
               float ax, float az, float bx, float bz, bool low);

  std::vector<Box> boxes_;
  std::vector<Face> faces_;
};

}  // namespace Ashline

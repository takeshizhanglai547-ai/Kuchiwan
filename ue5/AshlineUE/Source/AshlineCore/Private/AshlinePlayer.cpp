/* ==========================================================================
   AshlinePlayer.cpp — 移動・遮蔽・ロール・乗り換え・乗り越え、そして
   それらに追従するカメラと手続き的アニメーション。

   Web版 game.js の updateLook / freeUpdate / moveAndCollide / enterCover /
   toCoverUpdate / coverUpdate / leaveCover / startRollOrSwap / rollUpdate /
   swapUpdate / findVault / vaultUpdate / findSlamCover / updateCamera /
   updateAnim を一対一で移したもの。数値は AshlineConfig.generated.h から
   引く（あれは game.js から機械生成しているので、こちらに直値を書いた瞬間に
   「両版が同じ数字を使っている」保証が切れる）。

   単位は メートル / Y-up / three-style yaw。cm も Z-up もここには無い。

   game.js との差分（意図的なもの。詳細は各所の TODO(統合) を見ること）
     ・JS の P.face（オブジェクト参照）は faceIndex（World::Faces() の添字）。
     ・SFX 呼び出しはコアに無い。音は UE5 側が状態遷移を見て鳴らす。
     ・カメラの肩寄せ・距離・当たり・揺れは描画層の話なので Camera 構造体に
       持たせていない。ここでは状態として残る量だけを更新する。
   ========================================================================== */
#include "AshlineSim.h"

#include <algorithm>
#include <cmath>

namespace Ashline {

namespace {

/* 吸着カーブ：予備動作(わずかに引く) → 主要動作 → 余韻(小さくオーバーシュート)。
   等速で寄せると「吸い込まれた」ではなく「ワープした」に見えるため。 */
float CoverCurve(float s) {
  const float a = 0.16f;
  if (s < a) return -0.055f * std::sin(kPi * s / a);
  const float u = (s - a) / (1.0f - a);
  return (1.0f - std::pow(1.0f - u, 3.0f)) + 0.09f * std::sin(kPi * u) * u * (1.0f - u);
}

/* 乗り越えの着地点。JS の vaultTargetFor() の戻り値 {face,lx,lz,top}。 */
struct VaultTarget {
  int faceIndex = -1;
  float lx = 0.0f, lz = 0.0f, top = 0.0f;
};

/* (wx,wz) 方向に、越えられる低い遮蔽があるか。見つからなければ false。 */
bool VaultTargetFor(const World& world, float px, float pz, float wx, float wz,
                    VaultTarget& out) {
  const std::vector<Face>& faces = world.Faces();
  int best = -1;
  float bestD = kInf, bt = 0.0f;
  for (int i = 0; i < static_cast<int>(faces.size()); ++i) {
    const Face& f = faces[i];
    if (!f.low) continue;                                  // 高い遮蔽は越えられない
    if (wx * f.nx + wz * f.nz > -0.55f) continue;          // その面に向かっていること
    const float rx = px - f.ax, rz = pz - f.az;
    const float side = rx * f.nx + rz * f.nz;
    if (side < 0.02f || side > Cfg::vault::range) continue;
    const float t = (rx * f.tx + rz * f.tz) / f.len;
    if (t < 0.03f || t > 0.97f) continue;                  // 角では跳ばない
    if (side < bestD) { bestD = side; best = i; bt = t; }
  }
  if (best < 0) return false;

  const Face& bf = faces[best];
  const Cfg::CoverDef& c = Cfg::kCovers[bf.coverIndex];
  const float depth = std::fabs(bf.nx) > 0.5f ? c.hx * 2.0f : c.hz * 2.0f;
  const float span = depth + Cfg::cover::standOff;
  const float px0 = bf.ax + bf.tx * bf.len * bt;
  const float pz0 = bf.az + bf.tz * bf.len * bt;
  const float lxp = px0 - bf.nx * span, lzp = pz0 - bf.nz * span;

  /* 着地点が塞がっていたら跳ばせない。壁の向こうが埋まっているのに
     跳ぶのは理不尽だし、跳んだ先で押し出されると位置が信用できなくなる。 */
  float ox = 0.0f, oz = 0.0f;
  world.ResolveCircle(lxp, lzp, Cfg::player::radius, ox, oz);
  if (Hypot2(ox - lxp, oz - lzp) > 0.06f) return false;

  out.faceIndex = best;
  out.lx = lxp;
  out.lz = lzp;
  out.top = c.h;
  return true;
}

/* 乗り越え開始。跳んでいる間は遮蔽から切り離し、完全に無防備にする。 */
void StartVault(Player& p, const VaultTarget& v) {
  p.state = PlayerState::Vault;
  p.faceIndex = -1;
  p.sprint = false;
  p.sprintArmed = false;
  p.ax0 = p.x; p.az0 = p.z;
  p.ax1 = v.lx; p.az1 = v.lz;
  p.actT = 0.0f;
  p.actDur = Cfg::vault::time;
  p.vaultTop = v.top;
  p.vx = 0.0f; p.vz = 0.0f;
  p.peek = 0.0f;
  p.peekMode = PeekMode::None;
  p.blindT = 0.0f;
}

}  // namespace

/* ---------- look ---------------------------------------------------------- */
void Sim::UpdateLook(const Input& in, float dt) {
  float dx = in.lookDX, dy = in.lookDY;

  /* 自分でカメラを触り始めたら、遮蔽の自動アライン（UpdateCamera）は諦める。
     判定は「動かした量」ではなく「指が乗っているか」。動かした量で見ると、
     指を置いたまま静止している人の向きを勝手に回してしまう。 */
  if (in.look) player_.coverAlignT = 0.0f;

  if (player_.sprint) { dx = 0.0f; dy = 0.0f; }   // ダッシュ中はカメラを預ける
  if (dx != 0.0f || dy != 0.0f) {
    // 感度の加速度カーブ：速いスワイプほど1pxあたりの回転が増える
    const float spd = Hypot2(dx, dy) / std::max(dt, 1e-3f) / 1000.0f;   // px/ms
    const float k = 1.0f + Cfg::cam::sensAccel * Clamp(spd / Cfg::cam::sensRef, 0.0f, 1.0f);
    /* 吸着対象が近いほど感度を鈍らせる。実体は射撃層(AshlineWeapon.cpp)。
       これを掛け忘れると、狙っている最中だけ感度が最大55%速すぎる。 */
    const float s = Cfg::cam::sens * k * MagnetSlowdown();
    camera_.yaw -= dx * s;
    camera_.pitch = Clamp(camera_.pitch - dy * s, Cfg::cam::pitchMin, Cfg::cam::pitchMax);
  }
}

/* ---------- FREE ---------------------------------------------------------- */
void Sim::FreeUpdate(const Input& in, float dt) {
  const float sx = in.stickX, sy = in.stickY, mag = in.stickMag;

  if (in.actionEdge) {
    // 1) 低い障害物が正面にあれば乗り越え。
    //    壁に向かってダッシュしても意味が無いので、ダッシュより先に見る。
    if (mag > 0.35f && TryVault(sx, sy)) {
      VaultUpdate(dt);   // 押したフレームのうちに動き出させる（1フレーム待たせない）
      return;
    }
    // 2) 移動中ならダッシュ
    if (mag > 0.25f) {
      player_.sprint = true;
      player_.sprintArmed = false;
    } else {
      const CoverQuery q = world_.FindCover(player_.x, player_.z, Cfg::cover::snapDist);
      if (q.faceIndex >= 0) {
        EnterCover(q.faceIndex, q.t);
        ToCoverUpdate(dt);
        return;
      }
      player_.sprintArmed = true;   // 遮蔽が無いときは空振りさせない
    }
  }
  if (player_.sprintArmed && mag > 0.25f) {
    player_.sprint = true;
    player_.sprintArmed = false;
  }
  if (!in.action) { player_.sprint = false; player_.sprintArmed = false; }
  if (mag < 0.12f) player_.sprint = false;
  if (player_.state != PlayerState::Free) return;

  // カメラ相対の移動
  const float fx = YawDirX(camera_.yaw), fz = YawDirZ(camera_.yaw);
  const float rx = -fz, rz = fx;
  float wx = rx * sx + fx * sy, wz = rz * sx + fz * sy;
  const float wl = Hypot2(wx, wz);
  if (wl > 1e-5f) { wx /= wl; wz /= wl; }

  float speed;
  if (player_.sprint) {
    speed = Cfg::move::sprint;
  } else {
    // 前後左右で最高速を変える（後退は遅い）
    const float fwdAmt = sy, latAmt = std::fabs(sx);
    const float sp = fwdAmt >= 0.0f
        ? Lerp(Cfg::move::strafe, Cfg::move::walk, Clamp(fwdAmt, 0.0f, 1.0f))
        : Lerp(Cfg::move::strafe, Cfg::move::back, Clamp(-fwdAmt, 0.0f, 1.0f));
    speed = sp * (1.0f - 0.15f * latAmt);
  }
  const float tvx = wx * speed * mag, tvz = wz * speed * mag;
  /* 立ち上がりと停止で別の加速度を使う。止まるときに余韻を残すため。 */
  const float rate = (mag > 0.05f) ? (player_.sprint ? Cfg::move::sprintAccel : Cfg::move::accel)
                                   : Cfg::move::decel;
  const float mx = tvx - player_.vx, mz = tvz - player_.vz;
  const float ml = Hypot2(mx, mz), step = rate * dt;
  if (ml <= step || ml < 1e-6f) {
    player_.vx = tvx;
    player_.vz = tvz;
  } else {
    player_.vx += mx / ml * step;
    player_.vz += mz / ml * step;
  }

  MoveAndCollide(dt);

  // ダッシュで遮蔽に突っ込んだら、そのまま貼り付く
  if (player_.sprint && TrySlamCover()) {
    ToCoverUpdate(dt);
    return;
  }

  // 体の向き：ダッシュ中は進行方向、通常は照準方向
  if (player_.sprint && (std::fabs(player_.vx) + std::fabs(player_.vz)) > 0.4f) {
    player_.yaw = ApproachAngle(player_.yaw, DirToYaw(player_.vx, player_.vz),
                                Cfg::move::sprintTurn, dt);
    camera_.yaw = ApproachAngle(camera_.yaw, player_.yaw, 2.6f, dt);   // カメラが背後へ回り込む
  } else {
    player_.yaw = ApproachAngle(player_.yaw, camera_.yaw, Cfg::move::faceTurn, dt);
  }
  player_.peek = Smooth(player_.peek, 0.0f, 0.06f, dt);
}

void Sim::MoveAndCollide(float dt) {
  const float nx = player_.x + player_.vx * dt;
  const float nz = player_.z + player_.vz * dt;
  float ox = 0.0f, oz = 0.0f;
  world_.ResolveCircle(nx, nz, Cfg::player::radius, ox, oz);
  // 壁ずり：押し戻された分だけ速度を殺す（殺さないと壁に張り付いたまま加速し続ける）
  if (std::fabs(ox - nx) > 1e-6f) player_.vx = 0.0f;
  if (std::fabs(oz - nz) > 1e-6f) player_.vz = 0.0f;
  player_.x = ox;
  player_.z = oz;
}

/* ---------- cover entry / snap ------------------------------------------- */
void Sim::EnterCover(int faceIndex, float t) {
  if (faceIndex < 0 || faceIndex >= static_cast<int>(world_.Faces().size())) return;
  const Face& f = world_.Faces()[faceIndex];
  const CoverAnchor a = world_.AnchorOn(f, t);

  player_.state = PlayerState::ToCover;
  player_.faceIndex = faceIndex;
  player_.t = a.t;
  player_.snapT = 0.0f;
  /* JS の snapFrom / snapTo。TOCOVER 中は ROLL/SWAP が ax0..az1 を使わないので、
     専用のフィールドを増やさずここに置いている。 */
  player_.ax0 = player_.x;
  player_.az0 = player_.z;
  player_.ax1 = a.x;
  player_.az1 = a.z;
  player_.sprint = false;
  player_.vx = 0.0f;
  player_.vz = 0.0f;
  player_.peek = 0.0f;
  player_.peekMode = PeekMode::None;
  player_.coverAlignT = Cfg::cover::camBlend;   // 壁越しを向くまでカメラを寄せ続ける
}

void Sim::ToCoverUpdate(float dt) {
  if (player_.faceIndex < 0) { player_.state = PlayerState::Free; return; }
  player_.snapT += dt;
  const float s = Clamp(player_.snapT / Cfg::cover::snapTime, 0.0f, 1.0f);
  const float k = CoverCurve(s);
  player_.x = Lerp(player_.ax0, player_.ax1, k);
  player_.z = Lerp(player_.az0, player_.az1, k);

  const Face& f = world_.Faces()[player_.faceIndex];
  const float wantYaw = DirToYaw(-f.nx, -f.nz);            // 壁を向く
  player_.yaw = ApproachAngle(player_.yaw, wantYaw, 16.0f, dt);
  if (s >= 1.0f) {
    player_.state = PlayerState::Cover;
    player_.x = player_.ax1;
    player_.z = player_.az1;
  }
}

/* ---------- COVER --------------------------------------------------------- */
void Sim::CoverUpdate(const Input& in, float dt) {
  if (player_.faceIndex < 0) { LeaveCover(); return; }
  const Face& f = world_.Faces()[player_.faceIndex];

  /* スティックは遮蔽ローカルで解釈する。カメラ相対だと
     「左を押したら遮蔽から飛び出す」事故が起きる。
     カメラは壁越しを向いているので、画面基準 ≒ 遮蔽基準とみなせる。 */
  const float mag = in.stickMag;
  const float lx = in.stickX, ly = in.stickY;

  CoverAnchor anc = world_.AnchorOn(f, player_.t);
  /* 「端にいるか」は t の比ではなくメートルで見る。
     そうしないと長い壁と細い柱で挙動が変わる。 */
  const float eps = Cfg::cover::edgeEps;
  const bool atL = (player_.t - anc.minT) * f.len <= eps;
  const bool atR = (1.0f - anc.minT - player_.t) * f.len <= eps;

  if (in.actionEdge) {
    if (mag > 0.35f) {
      // 低い遮蔽で前に倒していれば、ロールではなく乗り越え
      VaultTarget vv;
      const bool wantVault = f.low && ly > 0.50f && std::fabs(lx) < 0.60f &&
                             VaultTargetFor(world_, player_.x, player_.z, -f.nx, -f.nz, vv);
      if (wantVault) {
        StartVault(player_, vv);
        VaultUpdate(dt);
        return;
      }
      StartRollOrSwap(lx, ly);
    } else {
      LeaveCover();
    }
    if (player_.state != PlayerState::Cover) return;
  }

  /* --- 端からの身体乗り出し / 低い遮蔽からの立ち撃ち --------------------- */
  // 入りは固く、抜けは緩く（ヒステリシス）。撃たれている最中に暴発させないため。
  int wantMode = 0, wantSide = 0;
  const bool peeking = player_.peekMode != PeekMode::None;
  const float th = peeking ? Cfg::cover::exitThresh : Cfg::cover::enterThresh;
  const float dth = peeking ? 0.34f : 0.55f;
  if (mag >= th) {
    if (f.low && ly > dth && std::fabs(lx) < 0.75f) { wantMode = 2; wantSide = 0; }
    else if (lx > dth && atR) { wantMode = 1; wantSide = 1; }
    else if (lx < -dth && atL) { wantMode = 1; wantSide = -1; }
  }
  if (wantMode) {
    player_.peekMode = static_cast<PeekMode>(wantMode);
    player_.peekSide = wantSide;
  }
  const float target = wantMode ? 1.0f : 0.0f;
  player_.peek = Smooth(player_.peek, target,
                        target > player_.peek ? Cfg::cover::peekIn / 2.2f
                                              : Cfg::cover::peekOut / 2.2f,
                        dt);
  if (player_.peek < 0.02f && !wantMode) {
    player_.peek = 0.0f;
    player_.peekMode = PeekMode::None;
  }

  /* --- ブラインドファイア：隠れたまま銃だけ上げて撃つ -------------------- */
  // 頭を出さないので当たらない。撃たれ続けている時に「何もできない」を無くす手段。
  const bool wantBlind = (wantMode == 0 && player_.peek < 0.15f && in.fire);
  player_.blindT = Smooth(player_.blindT, wantBlind ? 1.0f : 0.0f,
                          (wantBlind ? Cfg::blind::raise : Cfg::blind::lower) / 2.2f, dt);
  if (!wantBlind && player_.blindT < 0.02f) player_.blindT = 0.0f;

  /* --- 遮蔽に沿った横移動 ------------------------------------------------ */
  if (!wantMode && std::fabs(lx) > 0.12f) {
    const float dtt = (lx * Cfg::move::coverSlide * dt) / f.len;
    player_.t = Clamp(player_.t + dtt, anc.minT, 1.0f - anc.minT);
  }
  anc = world_.AnchorOn(f, player_.t);
  player_.x = anc.x;
  player_.z = anc.z;
  player_.vx = 0.0f;
  player_.vz = 0.0f;

  // 体の向き：隠れている間は壁向き、乗り出したら照準方向
  const float hide = DirToYaw(-f.nx, -f.nz);
  const float wy = player_.peek > 0.35f ? camera_.yaw : hide;
  player_.yaw = ApproachAngle(player_.yaw, wy, 11.0f, dt);
}

void Sim::LeaveCover() {
  player_.state = PlayerState::Free;
  player_.faceIndex = -1;
  player_.peek = 0.0f;
  player_.peekMode = PeekMode::None;
  player_.blindT = 0.0f;
  player_.vx = 0.0f;
  player_.vz = 0.0f;
}

/* ---------- roll / swap --------------------------------------------------- */
void Sim::StartRollOrSwap(float lx, float ly) {
  if (player_.faceIndex < 0) return;
  const Face& f = world_.Faces()[player_.faceIndex];

  // 遮蔽ローカル -> ワールド。プレイヤーの前方は -n。
  float wx = f.tx * lx + (-f.nx) * ly;
  float wz = f.tz * lx + (-f.nz) * ly;
  const float l = Hypot2(wx, wz);
  if (l < 1e-5f) return;
  wx /= l;
  wz /= l;

  /* その方向に別の遮蔽があれば「乗り換え」。無ければ素のロール。
     面上を 3点だけ試すのは、JS の for(s=0.15; s<=0.85; s+=0.35) と同じ刻み。 */
  static const float kSamples[3] = { 0.15f, 0.50f, 0.85f };
  const std::vector<Face>& faces = world_.Faces();
  int best = -1;
  float bestD = kInf, bt = 0.0f;
  for (int i = 0; i < static_cast<int>(faces.size()); ++i) {
    const Face& g = faces[i];
    if (g.coverIndex == f.coverIndex) continue;            // 同じ箱の別の面へは乗り換えない
    for (float s : kSamples) {
      const float gx = g.ax + g.tx * g.len * s + g.nx * Cfg::cover::standOff;
      const float gz = g.az + g.tz * g.len * s + g.nz * Cfg::cover::standOff;
      const float dx = gx - player_.x, dz = gz - player_.z;
      const float d = Hypot2(dx, dz);
      if (d < 0.8f || d > Cfg::roll::swapMax) continue;
      if ((dx / d) * wx + (dz / d) * wz < 0.72f) continue;             // 進行方向に限る
      if (world_.RayWorld(player_.x, 0.9f, player_.z, dx / d, 0.0f, dz / d, d - 0.3f) < d - 0.35f)
        continue;                                                       // 遮られていない
      if (d < bestD) { bestD = d; best = i; bt = s; }
    }
  }

  player_.ax0 = player_.x;
  player_.az0 = player_.z;
  player_.actT = 0.0f;
  player_.peek = 0.0f;
  player_.peekMode = PeekMode::None;

  if (best >= 0) {
    const CoverAnchor a = world_.AnchorOn(faces[best], bt);
    player_.state = PlayerState::Swap;
    player_.swapFaceIndex = best;
    player_.swapTgt = a.t;
    player_.ax1 = a.x;
    player_.az1 = a.z;
    /* 距離に応じて所要時間を伸ばす。長い乗り換えほど無防備な時間が長い＝判断の対価。 */
    player_.actDur = Cfg::roll::swapTime * Clamp(bestD / 3.2f, 0.55f, 1.35f);
  } else {
    float dist = Cfg::roll::dist;
    const float hit = world_.RayWorld(player_.x, 0.9f, player_.z, wx, 0.0f, wz,
                                      dist + Cfg::player::radius);
    // 壁の中へロールしないよう、当たる手前で止める
    if (hit < dist + Cfg::player::radius) dist = std::max(0.5f, hit - Cfg::player::radius - 0.05f);
    player_.state = PlayerState::Roll;
    player_.ax1 = player_.x + wx * dist;
    player_.az1 = player_.z + wz * dist;
    player_.actDur = Cfg::roll::time * Clamp(dist / Cfg::roll::dist, 0.45f, 1.0f);
    player_.faceIndex = -1;
  }
}

void Sim::RollUpdate(float dt) {
  player_.actT += dt;
  const float s = Clamp(player_.actT / player_.actDur, 0.0f, 1.0f);
  // 予備動作(少し引く) → 主要動作(転がる)。減速は 2.2 乗で「着地して止まる」感じにする。
  const float k = s < 0.12f ? -0.04f * std::sin(kPi * s / 0.12f)
                            : (1.0f - std::pow(1.0f - (s - 0.12f) / 0.88f, 2.2f));
  const float nx = Lerp(player_.ax0, player_.ax1, k);
  const float nz = Lerp(player_.az0, player_.az1, k);
  float ox = 0.0f, oz = 0.0f;
  world_.ResolveCircle(nx, nz, Cfg::player::radius, ox, oz);
  player_.x = ox;
  player_.z = oz;
  player_.yaw = ApproachAngle(player_.yaw,
                              DirToYaw(player_.ax1 - player_.ax0, player_.az1 - player_.az0),
                              12.0f, dt);
  player_.roll = std::sin(s * kPi) * 0.9f;
  if (s >= 1.0f) {
    player_.state = PlayerState::Free;
    player_.roll = 0.0f;
    player_.vx = 0.0f;
    player_.vz = 0.0f;
  }
}

void Sim::SwapUpdate(float dt) {
  if (player_.swapFaceIndex < 0) { player_.state = PlayerState::Free; return; }
  player_.actT += dt;
  const float s = Clamp(player_.actT / player_.actDur, 0.0f, 1.0f);
  const float k = CoverCurve(s);
  player_.x = Lerp(player_.ax0, player_.ax1, k);
  player_.z = Lerp(player_.az0, player_.az1, k);
  player_.roll = std::sin(s * kPi) * 0.55f;

  const Face& sf = world_.Faces()[player_.swapFaceIndex];
  const float wantYaw = DirToYaw(-sf.nx, -sf.nz);
  player_.yaw = ApproachAngle(player_.yaw, wantYaw, 14.0f, dt);
  if (s >= 1.0f) {
    player_.state = PlayerState::Cover;
    player_.faceIndex = player_.swapFaceIndex;
    player_.t = player_.swapTgt;
    player_.roll = 0.0f;
    player_.x = player_.ax1;
    player_.z = player_.az1;
    player_.coverAlignT = Cfg::cover::camBlend;
  }
}

/* ---------- vault --------------------------------------------------------- */
bool Sim::TryVault(float sx, float sy) {
  // スティックをカメラ相対でワールド方向に直す（freeUpdate の findVault 相当）
  const float fx = YawDirX(camera_.yaw), fz = YawDirZ(camera_.yaw);
  const float rx = -fz, rz = fx;
  const float wx = rx * sx + fx * sy, wz = rz * sx + fz * sy;
  const float wl = Hypot2(wx, wz);
  if (wl < 1e-5f) return false;

  VaultTarget v;
  if (!VaultTargetFor(world_, player_.x, player_.z, wx / wl, wz / wl, v)) return false;
  StartVault(player_, v);
  return true;
}

void Sim::VaultUpdate(float dt) {
  player_.actT += dt;
  const float s = Clamp(player_.actT / player_.actDur, 0.0f, 1.0f);
  // 予備動作(踏み切りで少し溜める) → 主要動作(跳ぶ) → 余韻(着地の沈み込み)
  const float k = s < 0.14f ? (s / 0.14f) * 0.10f
                            : 0.10f + 0.90f * (1.0f - std::pow(1.0f - (s - 0.14f) / 0.86f, 1.8f));
  player_.x = Lerp(player_.ax0, player_.ax1, k);
  player_.z = Lerp(player_.az0, player_.az1, k);
  // 障害物の天面より少し高く弧を描く。擦って見えると「越えた」感が消える。
  player_.y = std::sin(Clamp((s - 0.10f) / 0.82f, 0.0f, 1.0f) * kPi) * (player_.vaultTop + 0.10f);
  player_.yaw = ApproachAngle(player_.yaw,
                              DirToYaw(player_.ax1 - player_.ax0, player_.az1 - player_.az0),
                              16.0f, dt);
  player_.roll = std::sin(s * kPi) * 0.42f;
  if (s >= 1.0f) {
    player_.state = PlayerState::Free;
    player_.y = 0.0f;
    player_.roll = 0.0f;
    player_.landDip = 1.0f;
    player_.x = player_.ax1;
    player_.z = player_.az1;
    player_.vx = 0.0f;
    player_.vz = 0.0f;
  }
}

/* ---------- ダッシュで遮蔽に突っ込んだときの自動吸着 --------------------- */
bool Sim::TrySlamCover() {
  const float sp = Hypot2(player_.vx, player_.vz);
  if (sp < 2.5f) return false;
  const float dx = player_.vx / sp, dz = player_.vz / sp;

  const std::vector<Face>& faces = world_.Faces();
  int best = -1;
  float bestD = kInf, bt = 0.0f;
  for (int i = 0; i < static_cast<int>(faces.size()); ++i) {
    const Face& f = faces[i];
    // 面に正面から突っ込んでいる時だけ。壁沿いに走り抜ける時に捕まらないように。
    if (dx * f.nx + dz * f.nz > -Cfg::slam::cone) continue;
    const float rx = player_.x - f.ax, rz = player_.z - f.az;
    const float side = rx * f.nx + rz * f.nz;
    if (side < 0.02f || side > Cfg::slam::dist) continue;
    const float t = (rx * f.tx + rz * f.tz) / f.len;
    if (t < 0.0f || t > 1.0f) continue;
    if (side < bestD) { bestD = side; best = i; bt = t; }
  }
  if (best < 0) return false;

  EnterCover(best, bt);
  player_.landDip = 1.0f;   // ぶつかった衝撃を体に出す
  return true;
}

/* =============================================================================
   ANIMATION（手続き的。予備 → 主要 → 余韻）
   ========================================================================== */
void Sim::UpdateAnim(float dt) {
  const float sp = Hypot2(player_.vx, player_.vz);
  /* 歩幅の位相。足音は位相が半周するたびに鳴らすので、UE5 側はこの値の
     floor(stride / pi) が変わった瞬間を見ればよい。 */
  player_.stride += sp * dt * (player_.sprint ? 1.55f : 2.05f);

  /* 加速度から前傾を作り、バネで戻す。こうすると停止時に余韻(オーバーシュート)が出る。
     バネの速度は Sim ごとに持つ（関数内 static にすると、同一スレッドで
     2つ動かしたときに前傾だけが混線する）。 */
  const float fx = YawDirX(player_.yaw), fz = YawDirZ(player_.yaw);
  const float accF = (player_.vx * fx + player_.vz * fz) / std::max(Cfg::move::sprint, 1.0f);
  const float tgtLean = Clamp(accF, -1.0f, 1.0f) * (player_.sprint ? 0.30f : 0.16f);
  const float k = 120.0f, c = 15.0f;
  player_.leanV += (-(player_.lean - tgtLean) * k - player_.leanV * c) * dt;
  player_.lean += player_.leanV * dt;

  /* しゃがみ。低い遮蔽では乗り出すまで完全にしゃがみ、高い遮蔽では立ったまま
     （下げ切ると画面が壁で埋まる）。 */
  float crouchT;
  if (player_.state == PlayerState::Cover) {
    const bool low = player_.faceIndex >= 0 && world_.Faces()[player_.faceIndex].low;
    crouchT = low ? (1.0f - std::max(player_.peek, player_.blindT * 0.35f)) : 0.15f;
  } else if (player_.state == PlayerState::Vault) {
    crouchT = 0.35f;
  } else {
    crouchT = player_.sprint ? 0.55f : 0.0f;
  }
  player_.crouch = Smooth(player_.crouch, crouchT, 0.09f, dt);
  player_.recoil = Smooth(player_.recoil, 0.0f, 0.055f, dt);   // 0.16秒で収まる余韻
}

/* =============================================================================
   CAMERA
   ここで更新するのは「次のフレームに持ち越す状態」だけ。
   肩の左右寄せ・追従距離・注視点の高さ・壁への当たり・ダッシュ中の上下揺れは、
   毎フレーム作り直せる派生量なので、Camera 構造体には持たせず描画層に任せる。
   ========================================================================== */
void Sim::UpdateCamera(float dt) {
  // 反動の減衰
  camera_.kickP = Smooth(camera_.kickP, 0.0f, Cfg::fire::kickTau, dt);
  camera_.kickY = Smooth(camera_.kickY, 0.0f, Cfg::fire::kickTau, dt);

  /* FOV。Web版は sprintBlend を平滑化してから FOV を lerp するが、
     lerp も平滑化もブレンドに対して1次なので、FOV を同じ時定数で目標値へ
     追わせれば値は一致する。中間状態を1つ減らすための書き換え。 */
  const float tgtFov = player_.sprint ? Cfg::sprintCam::fovSprint : Cfg::sprintCam::fovBase;
  camera_.fov = Smooth(camera_.fov, tgtFov, Cfg::sprintCam::fovTau, dt);

  // 遮蔽ブレンド（0.25秒）
  const bool inCover =
      (player_.state == PlayerState::Cover || player_.state == PlayerState::ToCover);
  camera_.coverBlend =
      Smooth(camera_.coverBlend, inCover ? 1.0f : 0.0f, Cfg::cover::camBlend / 2.2f, dt);

  /* 遮蔽に入ったら、壁越しを見る向きまでカメラを寄せる（§7のブレンド時間）。
     プレイヤーが自分でスワイプしたら割り込まない（coverAlignT は UpdateLook が折る）。 */
  if (player_.coverAlignT > 0.0f && player_.faceIndex >= 0 && inCover) {
    player_.coverAlignT -= dt;
    const Face& f = world_.Faces()[player_.faceIndex];
    const float tgt = camera_.yaw + ShortAngle(DirToYaw(-f.nx, -f.nz) - camera_.yaw);
    camera_.yaw = Smooth(camera_.yaw, tgt, Cfg::cover::camBlend / 2.6f, dt);
  }

  /* ピボットは常に平滑化しておく。吸着の瞬間にカメラがワープしないように。 */
  const float lateral = (player_.peekMode == PeekMode::Side)
                            ? player_.peekSide * player_.peek * Cfg::cover::peekLateral * 0.8f
                            : 0.0f;
  const float fx = YawDirX(player_.yaw), fz = YawDirZ(player_.yaw);
  const float rx = -fz, rz = fx;
  const float tx = player_.x + rx * lateral, tz = player_.z + rz * lateral;
  // 吸着・乗り換え中だけ少し鈍らせる（速い横移動をカメラが追い越さないように）
  const float tau = (player_.state == PlayerState::ToCover || player_.state == PlayerState::Swap)
                        ? 0.055f
                        : 0.035f;
  camera_.px = Smooth(camera_.px, tx, tau, dt);
  camera_.pz = Smooth(camera_.pz, tz, tau, dt);
}

}  // namespace Ashline

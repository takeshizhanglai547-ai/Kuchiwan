/* ==========================================================================
   AshlineSim.cpp — 統合の背骨。各サブシステムの呼ぶ順序だけをここで決める。

   順序を変えてはいけない理由（Web版 update() と同一にしてある）
     カメラを射撃より先に確定させる。照準はカメラから引くので、1フレーム
     遅れると「見ている所と当たる所がずれる」＝エイムアシストが嘘をつく。
   ========================================================================== */
#include "AshlineSim.h"

#include <algorithm>

namespace Ashline {

Sim::Sim() : rng_(1u) {
  enemies_.resize(Cfg::kMaxEnemies);
  for (int i = 0; i < Cfg::kMaxEnemies; ++i) {
    Enemy& e = enemies_[i];
    e.type = Cfg::EnemyType::rusher;
    e.maxHp = Cfg::kEnemyDefs[0].hp;
    e.hp = e.maxHp;
    e.active = false;
    e.dead = true;
    e.fall = 1.0f;
    e.x = 0.0f;
    e.z = -18.0f;
  }
}

void Sim::Step(const Input& in, float dt) {
  if (hitstop_ > 0.0f) {
    hitstop_ -= dt;
    return;   // ヒットストップ中は世界を止める
  }
  dt = std::min(dt, 0.05f);

  UpdateLook(in, dt);

  switch (player_.state) {
    case PlayerState::Free:    FreeUpdate(in, dt); break;
    case PlayerState::ToCover: ToCoverUpdate(dt); break;
    case PlayerState::Cover:   CoverUpdate(in, dt); break;
    case PlayerState::Roll:    RollUpdate(dt); break;
    case PlayerState::Swap:    SwapUpdate(dt); break;
    case PlayerState::Vault:   VaultUpdate(dt); break;
  }
  player_.landDip = Smooth(player_.landDip, 0.0f, 0.10f, dt);

  UpdateAnim(dt);
  UpdateCamera(dt);
  UpdateWeapon(in, dt);
  UpdateEnemies(dt);
}

void Sim::SetCombatEnabled(bool v) {
  combat_.enabled = v;
  if (!v) {
    combat_.on = false;
    combat_.state = CombatState::Idle;
  }
}

void Sim::Teleport(float x, float z, float yaw) {
  player_.x = x;
  player_.y = 0.0f;
  player_.z = z;
  player_.vx = 0.0f;
  player_.vz = 0.0f;
  player_.state = PlayerState::Free;
  player_.faceIndex = -1;
  player_.peek = 0.0f;
  player_.peekMode = PeekMode::None;
  player_.sprint = false;
  player_.blindT = 0.0f;
  player_.landDip = 0.0f;
  player_.yaw = yaw;
  camera_.yaw = yaw;
  camera_.px = x;
  camera_.pz = z;
}

/* ---- 共通の小物 --------------------------------------------------------- */

float Sim::PlayerTopY() const {
  return player_.y + Cfg::player::height - player_.crouch * 0.55f +
         (player_.peekMode == PeekMode::Over ? player_.peek * Cfg::cover::peekRise : 0.0f);
}

float Sim::PlayerAimY() const {
  return player_.y + Cfg::player::chest - player_.crouch * 0.30f +
         (player_.peekMode == PeekMode::Over ? player_.peek * Cfg::cover::peekRise : 0.0f);
}

void Sim::PlayerLatOff(float& ox, float& oz) const {
  const float lat = (player_.peekMode == PeekMode::Side)
                        ? player_.peekSide * player_.peek * Cfg::cover::peekLateral
                        : 0.0f;
  const float fx = YawDirX(player_.yaw), fz = YawDirZ(player_.yaw);
  ox = player_.x + (-fz) * lat;
  oz = player_.z + fx * lat;
}

float Sim::Exposure() const {
  if (player_.state == PlayerState::Cover) {
    if (player_.peekMode != PeekMode::None) return player_.peek;
    return player_.blindT * 0.22f;    // 腕だけ出している
  }
  if (player_.state == PlayerState::ToCover)
    return 1.0f - player_.snapT / Cfg::cover::snapTime * 0.85f;
  return 1.0f;
}

bool Sim::IsBlind() const {
  return player_.state == PlayerState::Cover &&
         player_.peekMode == PeekMode::None &&
         player_.blindT >= Cfg::blind::ready;
}

}  // namespace Ashline

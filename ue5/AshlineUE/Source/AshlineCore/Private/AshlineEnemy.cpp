/* ==========================================================================
   AshlineEnemy.cpp — 敵AI・波の進行・被弾。Web版 game.js の COMBAT 節の移植。

   ここが持っている責任
     「敵が止まって撃つ」「遮蔽が敵の射線を本当に止める」の2つを、描画から
     切り離した状態で成立させる。見た目（リグ・当たり判定メッシュ・エフェクト）
     が無くても同じ判断が出るように、必要な数値はすべて Cfg から引く。

   単位と向き（AshlineConfig.generated.h と同じ約束。混ぜないこと）
     メートル / Y-up / yaw y に対する前方向 = (-sin y, 0, -cos y)

   乱数について
     必ず rng_ を通す。std::rand や random_device を混ぜると、同じ入力から
     同じ弾道が再現できなくなり、回帰テストが「たまに落ちる」ものに変わる。
   ========================================================================== */
#include "AshlineSim.h"

#include <algorithm>
#include <cmath>

namespace Ashline {
namespace {

/* --- バナーID -------------------------------------------------------------
   コアはUI文言を持たない（多言語化はUE5側のテーブルの仕事）ので、
   「どの報せか」だけを小さな整数で渡す。対応は次の通り。
     0      … 表示なし（初期値。コアからこの値を書くことはない）
     1,2,3  … 「1 波」「2 波」「3 波」 ＝ kBannerWave1 + 波番号
     10     … 「倒れた ── 画面をタップで再挑戦」
     11     … 「制圧 ── 画面をタップでもう一度」
   波の番号を id に埋め込んでいるのは、UE5 側が「N 波」を1つの書式文字列
   （"%d 波"）で扱えるようにするため。id を増やしても意味が壊れない。 */
constexpr int kBannerWave1 = 1;
constexpr int kBannerDead = 10;
constexpr int kBannerClear = 11;
constexpr float kBannerHold = 3.2f;   // 表示時間[秒]

/* 敵の状態。Enemy::st の値。game.js の文字列と一対一で対応する。 */
constexpr int kStIdle = 0;
constexpr int kStAdvance = 1;
constexpr int kStAim = 2;
constexpr int kStFire = 3;
constexpr int kStCover = 4;

/* 敵の胸の高さ。
   Web版は敵リグの実メッシュから作った当たり判定 e.hb.chest を使うが、
   コアには描画モデルが無い。プレイヤーの胸高を型ごとの体格でスケールして
   代用する。射線の起点がここなので、値がずれると「壁越しに撃たれる／
   撃てない」が変わる。UE5ビルドでは、この式ではなく実際のスケルタルメッシュの
   ソケット（もしくはカプセルの中心高さ）から取った値に差し替えること。 */
float EnemyChestY(const Enemy& e) {
  return Cfg::player::chest * Cfg::kEnemyDefs[static_cast<int>(e.type)].scale;
}

/* 遮蔽の陰になる立ち位置を探す。見つからなければ false。
   Sim の private に触らないよう、必要な物だけ引数で受け取る。 */
bool FindEnemyCover(const World& world, float px, float pz, const Enemy& e,
                    float& outX, float& outZ) {
  bool found = false;
  float bestScore = 1e9f;
  const Cfg::EnemyDef& def = Cfg::kEnemyDefs[static_cast<int>(e.type)];
  const std::vector<Face>& faces = world.Faces();
  for (const Face& f : faces) {
    const float fx = f.ax + f.tx * f.len * 0.5f + f.nx * 0.5f;
    const float fz = f.az + f.tz * f.len * 0.5f + f.nz * 0.5f;
    const float dp = Hypot2(fx - px, fz - pz);
    if (dp < 4.0f) continue;              // プレイヤーの目の前は遮蔽にならない
    const float de = Hypot2(fx - e.x, fz - e.z);
    if (de > 14.0f) continue;             // 遠すぎる遮蔽へは走らない
    /* プレイヤー側から見て面の裏にあること。表側に立っても隠れられない。 */
    const float toP = (px - fx) * f.nx + (pz - fz) * f.nz;
    if (toP > 0.0f) continue;
    const float score = de + std::fabs(dp - def.keep) * 0.6f;
    if (score < bestScore) {
      bestScore = score;
      outX = fx;
      outZ = fz;
      found = true;
    }
  }
  return found;
}

}  // namespace

/* --------------------------------------------------------------------------
   射線 — 敵の射線が通るか。通らない＝遮蔽が効いている、という一点で柱1を支える。
   戻り値は距離（0 なら見えていない）。JS の truthy 判定をそのまま活かすため、
   bool ではなく距離を返す形を維持する。
   -------------------------------------------------------------------------- */
float Sim::EnemySeesPlayer(const Enemy& e) const {
  float px = 0.0f, pz = 0.0f;
  PlayerLatOff(px, pz);                   // 乗り出し中は体が横にずれている
  const float ey = EnemyChestY(e);
  const float dx = px - e.x, dy = PlayerAimY() - ey, dz = pz - e.z;
  const float d = Hypot3(dx, dy, dz);
  if (d > Cfg::ai::sight) return 0.0f;
  /* 0.25m の余裕は、プレイヤーの体の手前で射線が止まるのを「命中」と
     取り違えないため。ここを詰めると遮蔽の縁で見えたり見えなかったりする。 */
  if (world_.RayWorld(e.x, ey, e.z, dx / d, dy / d, dz / d, d) < d - 0.25f) return 0.0f;
  return d;
}

/* --------------------------------------------------------------------------
   敵の発砲
   -------------------------------------------------------------------------- */
void Sim::EnemyShoot(Enemy& e) {
  const Cfg::EnemyDef& def = Cfg::kEnemyDefs[static_cast<int>(e.type)];
  e.fireCd = 60.0f / def.rpm;
  e.burst--;

  float px = 0.0f, pz = 0.0f;
  PlayerLatOff(px, pz);
  const float ey = EnemyChestY(e);
  const float mx = e.x + YawDirX(e.yaw) * 0.45f;
  const float mz = e.z + YawDirZ(e.yaw) * 0.45f;
  float dx = px - mx, dy = PlayerAimY() - ey, dz = pz - mz;
  float d = Hypot3(dx, dy, dz);
  if (d < 1e-5f) d = 1e-5f;
  dx /= d; dy /= d; dz /= d;

  /* 拡散。円板上の一様サンプル（r に sqrt を掛けるのはそのため）。
     ここを r = random()*sp にすると中心に寄りすぎて、敵の弾が当たりすぎる。
     乱数の消費順（先に角度、後に半径）も Web版と揃えておくこと。 */
  const float sp = def.spread * kDeg;
  const float a = rng_.Next() * kPi * 2.0f;
  const float r = std::sqrt(rng_.Next()) * sp;

  /* 射線に垂直な2軸。rt は水平面内、uu はそれと射線の外積。 */
  float rtx = -dz, rtz = dx;
  const float rl = Hypot2(rtx, rtz);
  if (rl > 1e-6f) { rtx /= rl; rtz /= rl; }
  else { rtx = 1.0f; rtz = 0.0f; }        // 真上/真下を向いた縮退。ほぼ起きない
  float ux = -rtz * dy;
  float uy = rtz * dx - rtx * dz;
  float uz = rtx * dy;
  const float ul = Hypot3(ux, uy, uz);
  if (ul > 1e-6f) { ux /= ul; uy /= ul; uz /= ul; }

  const float ca = std::cos(a) * r, sa = std::sin(a) * r;
  float vx = dx + rtx * ca + ux * sa;
  float vy = dy + uy * sa;
  float vz = dz + rtz * ca + uz * sa;
  const float vl = Hypot3(vx, vy, vz);
  if (vl > 1e-6f) { vx /= vl; vy /= vl; vz /= vl; }

  const float wallT = world_.RayWorld(mx, ey, mz, vx, vy, vz, 60.0f);
  /* プレイヤーの当たり判定（乗り出し分の横ずれを含む）。 */
  Box pb;
  pb.minx = px - 0.34f;
  pb.maxx = px + 0.34f;
  pb.minz = pz - 0.30f;
  pb.maxz = pz + 0.30f;
  pb.top = PlayerTopY();
  const float pt = World::RayBox(mx, ey, mz, vx, vy, vz, pb);
  /* 壁より手前でプレイヤーに当たったときだけ通る。着弾点の演出（曳光・
     着弾・発砲音）はコアの外＝UE5側の仕事なので、ここでは何も残さない。 */
  if (pt <= wallT) DamagePlayer(def.dmg, vx, vz);
}

/* --------------------------------------------------------------------------
   被弾
   -------------------------------------------------------------------------- */
void Sim::DamagePlayer(float dmg, float dx, float dz) {
  if (!combat_.on || player_.dead) return;
  player_.hp -= dmg;
  player_.hurtT = 0.0f;
  player_.dmgFlash = 1.0f;
  /* ノックバック。押し戻しは小さく、痛みはカメラで出す。
     ここを強くすると遮蔽から引き剥がされ、柱2（遮蔽が意味を持つ）が壊れる。 */
  player_.vx -= dx * Cfg::hurt::knock * 0.25f;
  player_.vz -= dz * Cfg::hurt::knock * 0.25f;
  camera_.kickP += Cfg::hurt::camKick * (0.6f + rng_.Next() * 0.8f);
  camera_.kickY += (rng_.Next() < 0.5f ? -1.0f : 1.0f) * Cfg::hurt::camKick;
  hitstop_ = std::max(hitstop_, 0.045f);
  if (player_.hp <= 0.0f) {
    player_.hp = 0.0f;
    player_.dead = true;
    player_.deadT = 0.0f;
    combat_.state = CombatState::Dead;
    combat_.bannerId = kBannerDead;
    combat_.bannerT = kBannerHold;
  }
}

void Sim::DamageEnemy(Enemy& e, float dmg, float dx, float dz, bool head) {
  e.hp -= dmg;
  e.flash = 1.0f;
  e.knock = 1.0f;
  e.knockX = dx;
  e.knockZ = dz;
  /* 発砲のキックは縦。命中は軸を変えて横に打つことで、命中と非命中を
     体で区別させる。数字の出ない画面でも「当たった」が手に返る。 */
  camera_.kickY += (rng_.Next() < 0.5f ? -1.0f : 1.0f) * (head ? 0.62f : 0.34f) * kDeg;
  camera_.kickP += (head ? 0.55f : 0.22f) * kDeg;
  if (e.hp <= 0.0f && !e.dead) {
    e.dead = true;
    e.fall = 0.0f;
  }
}

/* --------------------------------------------------------------------------
   敵AI
   -------------------------------------------------------------------------- */
void Sim::UpdateEnemyAI(Enemy& e, float dt) {
  const Cfg::EnemyDef& def = Cfg::kEnemyDefs[static_cast<int>(e.type)];
  const float los = EnemySeesPlayer(e);
  e.stT += dt;
  if (e.fireCd > 0.0f) e.fireCd -= dt;

  const float dpx = player_.x - e.x, dpz = player_.z - e.z;
  float dp = Hypot2(dpx, dpz);
  if (dp < 1e-5f) dp = 1e-5f;

  switch (e.st) {
    case kStIdle:
      if (dp < Cfg::ai::sight) { e.st = kStAdvance; e.stT = 0.0f; }
      break;
    case kStAdvance:
      /* keep 距離を保つ位置まで詰める。型ごとの keep が間合いの性格を作る。 */
      e.tgtX = player_.x - dpx / dp * def.keep;
      e.tgtZ = player_.z - dpz / dp * def.keep;
      if (los > 0.0f && dp <= def.fireRange && e.fireCd <= 0.0f) {
        e.st = kStAim; e.stT = 0.0f; e.aimT = 0.0f;
      } else if (los <= 0.0f && e.stT > 3.0f) {
        e.stT = 0.0f;                    // 見えないなら詰め続ける
      }
      break;
    case kStAim:
      e.tgtX = e.x; e.tgtZ = e.z;        // 撃つ前は止まる（柱1）
      e.aimT += dt;
      if (los <= 0.0f) { e.st = kStAdvance; e.stT = 0.0f; }
      else if (e.aimT >= def.tell) { e.st = kStFire; e.stT = 0.0f; e.burst = def.burst; }
      break;
    case kStFire:
      e.tgtX = e.x; e.tgtZ = e.z;
      if (los <= 0.0f || e.burst <= 0) {
        /* 狙撃型だけは撃ち終わりに遮蔽へ退く。突撃型が退くと圧が消える。 */
        const bool marksman = (e.type == Cfg::EnemyType::marksman);
        e.st = marksman ? kStCover : kStAdvance;
        e.stT = 0.0f;
        float cx = 0.0f, cz = 0.0f;
        if (marksman && FindEnemyCover(world_, player_.x, player_.z, e, cx, cz)) {
          e.tgtX = cx; e.tgtZ = cz;
        }
      } else if (e.fireCd <= 0.0f) {
        EnemyShoot(e);
      }
      break;
    case kStCover:
      if (e.stT > Cfg::ai::coverHold) { e.st = kStAdvance; e.stT = 0.0f; }
      break;
    default:
      break;
  }

  /* 移動 */
  const float mvx = e.tgtX - e.x, mvz = e.tgtZ - e.z;
  const float ml = Hypot2(mvx, mvz);
  const float want = (ml > 0.35f) ? def.speed : 0.0f;
  const float tvx = (ml > 1e-4f) ? mvx / ml * want : 0.0f;
  const float tvz = (ml > 1e-4f) ? mvz / ml * want : 0.0f;
  /* 狙い・射撃中は強く踏みとどまる。柱1（止まって撃つ）は敵にも同じ条件で課す。
     7.0では最高速3.7m/sから止まるのに0.53秒かかり、突撃兵の予備動作0.40秒に
     間に合わない＝動きながら撃つ敵になる。ここは18.0でなければならない。 */
  const float acc = ((e.st == kStAim || e.st == kStFire) ? 18.0f : 7.0f) * dt;
  const float ddx = tvx - e.vx, ddz = tvz - e.vz;
  const float dl = Hypot2(ddx, ddz);
  if (dl <= acc || dl < 1e-6f) { e.vx = tvx; e.vz = tvz; }
  else { e.vx += ddx / dl * acc; e.vz += ddz / dl * acc; }
  float nx = 0.0f, nz = 0.0f;
  world_.ResolveCircle(e.x + e.vx * dt, e.z + e.vz * dt, 0.42f, nx, nz);
  e.x = nx;
  e.z = nz;
  e.stride += Hypot2(e.vx, e.vz) * dt * 2.2f;

  /* 向き：交戦中はプレイヤー、それ以外は進行方向。
     交戦中に進行方向を向くと、横歩きしながら顔だけ別を向く不自然が出る。 */
  const float wy = (e.st == kStAim || e.st == kStFire || los > 0.0f)
                       ? DirToYaw(dpx, dpz)
                       : ((std::fabs(e.vx) + std::fabs(e.vz) > 0.3f) ? DirToYaw(e.vx, e.vz)
                                                                     : e.yaw);
  e.yaw = ApproachAngle(e.yaw, wy, 4.5f, dt);
}

/* --------------------------------------------------------------------------
   波の進行
   -------------------------------------------------------------------------- */
void Sim::SpawnWave(int n) {
  if (n < 0 || n >= Cfg::kWaveCount) return;
  const Cfg::WaveDef& w = Cfg::kWaves[n];
  /* 敵プールの全スロットを必ず舐めること。波の人数（2/3/5）より短い配列を
     回すと、多い波が黙って切り詰められる。使わないスロットは「死んで倒れ
     きった状態」に固定して、AIにも描画にも拾わせない。 */
  const int slots = static_cast<int>(enemies_.size());
  for (int i = 0; i < slots; ++i) {
    Enemy& e = enemies_[i];
    if (i < w.count) {
      const Cfg::SpawnDef& d = w.slots[i];
      e.type = d.type;
      e.x = d.x;
      e.z = d.z;
      e.maxHp = Cfg::kEnemyDefs[static_cast<int>(d.type)].hp;
      e.hp = e.maxHp;
      e.dead = false;
      e.fall = 0.0f;
      e.active = true;
      e.st = kStIdle;
      e.stT = 0.0f;
      e.vx = 0.0f;
      e.vz = 0.0f;
      e.yaw = 0.0f;
      e.fireCd = 0.0f;
      /* 目標を湧き位置に置く（makeEnemy の初期値と同じ）。前の波の目標が
         残ったまま1フレームだけ走り出すのを防ぐ。 */
      e.tgtX = d.x;
      e.tgtZ = d.z;
    } else {
      e.active = false;
      e.dead = true;
      e.fall = 1.0f;
    }
  }
  combat_.bannerId = kBannerWave1 + n;
  combat_.bannerT = kBannerHold;
}

void Sim::UpdateCombat(float dt) {
  if (combat_.bannerT > 0.0f) combat_.bannerT -= dt;
  if (!combat_.on) return;
  if (combat_.state == CombatState::Dead) { player_.deadT += dt; return; }
  if (combat_.state == CombatState::Clear) return;

  /* 体力の自然回復。段階表示は演出側の仕事で、ここは数字だけを戻す。 */
  if (!player_.dead) {
    player_.hurtT += dt;
    if (player_.hurtT > Cfg::hurt::regenDelay && player_.hp < Cfg::hurt::hp)
      player_.hp = std::min(Cfg::hurt::hp, player_.hp + Cfg::hurt::regenRate * dt);
  }
  player_.dmgFlash = Smooth(player_.dmgFlash, 0.0f, 0.35f, dt);

  int alive = 0;
  for (const Enemy& e : enemies_)
    if (e.active && !e.dead) alive++;
  if (alive == 0) {
    /* 全滅から1.6秒の間。倒し切った余韻を見せてから次の波を出す。 */
    combat_.t += dt;
    if (combat_.t > 1.6f) {
      combat_.t = 0.0f;
      if (combat_.wave + 1 < Cfg::kWaveCount) {
        combat_.wave++;
        SpawnWave(combat_.wave);
      } else {
        combat_.state = CombatState::Clear;
        combat_.bannerId = kBannerClear;
        combat_.bannerT = kBannerHold;
      }
    }
  } else {
    combat_.t = 0.0f;
  }
}

void Sim::StartCombat() {
  combat_.on = true;
  combat_.wave = 0;
  combat_.state = CombatState::Fight;
  combat_.t = 0.0f;

  player_.hp = Cfg::hurt::hp;
  player_.dead = false;
  player_.hurtT = 0.0f;
  player_.dmgFlash = 0.0f;
  player_.ammo = static_cast<int>(Cfg::fire::mag);
  player_.reloadT = 0.0f;
  player_.dmgMul = 1.0f;
  player_.x = Cfg::spawn::x;
  player_.z = Cfg::spawn::z;
  player_.yaw = Cfg::spawn::yaw;
  camera_.yaw = Cfg::spawn::yaw;
  player_.state = PlayerState::Free;
  player_.faceIndex = -1;               // 遮蔽から手を離す
  player_.peek = 0.0f;
  player_.peekMode = PeekMode::None;
  /* カメラの追従位置も飛ばす。持ち越すと開始の1フレームで画面が流れる。 */
  camera_.px = player_.x;
  camera_.pz = player_.z;

  SpawnWave(0);
}

/* --------------------------------------------------------------------------
   毎フレームの敵更新
   -------------------------------------------------------------------------- */
void Sim::UpdateEnemies(float dt) {
  UpdateCombat(dt);
  for (Enemy& e : enemies_) {
    e.flash = std::max(0.0f, e.flash - dt * 6.0f);
    e.knock = Smooth(e.knock, 0.0f, 0.09f, dt);
    if (e.dead) {
      e.fall = std::min(1.0f, e.fall + dt * 3.2f);
      /* 戦闘中は復活しない。Web版は検証用の的モードで復活させるが、
         コアの Enemy は respawn を持たないので、ここでは倒れきるだけ。 */
      continue;
    }
    if (combat_.on && combat_.state == CombatState::Fight && e.active && !player_.dead)
      UpdateEnemyAI(e, dt);
  }
}

}  // namespace Ashline

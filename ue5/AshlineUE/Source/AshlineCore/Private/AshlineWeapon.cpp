/* ==========================================================================
   AshlineWeapon.cpp — 射撃・エイムアシスト・アクティブリロード。

   game.js の updateWeapon / shoot / muzzlePos / blindMuzzle / blindDir /
   activeReloadTap / canFire / currentSpread / assistScale / snapMaxRad /
   acquireTarget / magnetSlowdown / enemyRay をそのまま移したもの。
   Web版は112項目の実行済みリグレッションで裏が取れている。挙動が仕様であり、
   ここで「良くする」ことはしない。数値も一切いじらない。

   この層で一番壊れやすいのは「2段階ヒットスキャン」（shoot 参照）。
   カメラの射線で着弾点を決め、そこへ銃口から撃ち直す。撃ち直しは必ず全射程で
   行う。ここをカメラ側の距離で打ち切ると、正確に狙った弾ほど無効化される。

   単位はメートル / Y-up / three-style yaw（前方向 = (-sin y, 0, -cos y)）。
   ========================================================================== */
#include "AshlineSim.h"

#include <algorithm>
#include <cmath>

namespace Ashline {

namespace {

/* game.js の FAR。弾の最大到達距離。 */
constexpr float kFar = 90.0f;

/* エイムアシストの強度段階。Web版は3段階を設定UIで選べるが、コアは設定を
   持たない層なので既定の「標準」（snap 1.00 / magnet 1.00）に固定する。
   段階を可変にしたくなったら Sim ではなく UE5 側の設定として渡すこと。 */
constexpr float kAssistSnapMul = 1.0f;
constexpr float kAssistMagnetMul = 1.0f;

/* 吸着判定は「画面上の距離」で決まるので、視野の縦横比が要る。
   横方向は幅に対する割合（magnetFrac）なので比に依存しないが、縦方向だけは
   アスペクトが効く。UE5 側では実ビューポートの比を渡すべき値。
   ここでは 16:9 を既定に置く。 */
constexpr float kViewAspect = 16.0f / 9.0f;

/* 頭部優先の許容距離。game.js の enemyRay と同じ 0.35m。
   これは「レイに沿った距離」なので敵の大きさで拡縮してはいけない。 */
constexpr float kHeadPriorityT = 0.35f;

/* --------------------------------------------------------------------------
   敵の当たり判定

   ★ UE5 移植時の申し送り ★
   Web版はレンダリング済みのモデル実寸から当たり判定を導出している
   （hitboxFromRig）。「見えているのに当たらない／見えないのに当たる」を
   潰すためで、実際に突撃型は実幅1.38mなのに判定が0.68mだった不具合があった。
   コアにはモデルが無いので、ここでは game.js の HB_DEFAULT を敵種別の
   scale で拡縮した箱を使う。UE5 では CapsuleComponent もしくは
   SkeletalMesh のボーン境界から同じ形の箱を作って差し替えること。
   差し替えるときも、下の EnemyRay にある「頭部優先（0.35m以内なら胴より
   手前でも頭部命中）」の規則だけは必ず残すこと。これを外すと、頭に照準を
   合わせても肩口の胴命中になり、プレイヤーの狙いが報われなくなる。
   -------------------------------------------------------------------------- */
struct Hitbox {
  float halfX, halfZ, bodyTop, headTop, headHalf, chest;
};

Hitbox HitboxOf(const Enemy& e) {
  const float s = Cfg::kEnemyDefs[static_cast<int>(e.type)].scale;
  Hitbox hb;
  hb.halfX = 0.34f * s;
  hb.halfZ = 0.26f * s;
  hb.bodyTop = 1.52f * s;
  hb.headTop = 1.86f * s;
  hb.headHalf = 0.16f * s;
  hb.chest = 1.15f * s;
  return hb;
}

struct EnemyHit {
  float t = kInf;
  bool head = false;
};

EnemyHit EnemyRay(const Enemy& e, float ox, float oy, float oz,
                  float dx, float dy, float dz) {
  const Hitbox hb = HitboxOf(e);

  Box body;
  body.minx = e.x - hb.halfX;
  body.maxx = e.x + hb.halfX;
  body.minz = e.z - hb.halfZ;
  body.maxz = e.z + hb.halfZ;
  body.top = hb.bodyTop;

  Box headB;
  headB.minx = e.x - hb.headHalf;
  headB.maxx = e.x + hb.headHalf;
  headB.minz = e.z - hb.headHalf;
  headB.maxz = e.z + hb.headHalf;
  headB.top = hb.headTop;

  /* RayBox は y=0..top を仮定するので、頭は下限を持つ専用判定にする。 */
  const float tb = World::RayBox(ox, oy, oz, dx, dy, dz, body);
  const float th = World::RayBoxY(ox, oy, oz, dx, dy, dz, headB, hb.bodyTop, hb.headTop);

  EnemyHit r;
  /* 頭部を優先する。弾は銃口（頭より0.6m低い）から出るので、頭を狙った射線は
     必ず胴の箱の肩口を先に掠る。素直に近い方を採ると、頭に照準を合わせても
     胴命中になり、プレイヤーの狙いが報われない。 */
  if (th < kInf && th <= tb + kHeadPriorityT) {
    r.t = th;
    r.head = true;
  } else if (th < tb) {
    r.t = th;
    r.head = true;
  } else {
    r.t = tb;
    r.head = false;
  }
  return r;
}

/* --------------------------------------------------------------------------
   カメラの視点姿勢

   照準はカメラのレティクル位置から引くので、視点の world 座標が要る。
   Web版は three.js の camera オブジェクトが持っているが、コアの Camera 構造体は
   ピボット(px,pz)しか持たない。そのため updateCamera の最終段と同じ式で
   ここで組み直す。値が二重に定義されるのは望ましくないので、本来は
   Camera に視点座標を持たせて UpdateCamera が書き込むべき（報告済み）。

   組み直せない量は3つあり、それぞれ次のように扱う。
     CAM.py       : 平滑化前の目標値をそのまま使う（追従tau=0.05なので差は小さい）
     CAM.side     : 平滑化前の wantSide をそのまま使う（判定式はWeb版と同一）
     bob          : ダッシュ揺れ。ダッシュ中は canFire も assistScale も 0 なので
                    射撃・吸着には効かない。0 とする。
   -------------------------------------------------------------------------- */
struct CamPose {
  float x = 0, y = 0, z = 0;      // 視点の world 座標
  float yaw = 0, pitch = 0;       // 反動込みの姿勢
  float fov = Cfg::sprintCam::fovBase;
};

/* three.js の Euler 'YXZ'（R = Ry * Rx）でベクトルを回す。 */
void RotYXZ(float yaw, float pitch, float vx, float vy, float vz,
            float& ox, float& oy, float& oz) {
  const float cp = std::cos(pitch), sp = std::sin(pitch);
  const float ax = vx;
  const float ay = vy * cp - vz * sp;
  const float az = vy * sp + vz * cp;
  const float cy = std::cos(yaw), sy = std::sin(yaw);
  ox = cy * ax + sy * az;
  oy = ay;
  oz = -sy * ax + cy * az;
}

/* 上の逆回転（world -> カメラ空間）。 */
void InvRotYXZ(float yaw, float pitch, float vx, float vy, float vz,
               float& ox, float& oy, float& oz) {
  const float cy = std::cos(yaw), sy = std::sin(yaw);
  const float ax = cy * vx - sy * vz;
  const float ay = vy;
  const float az = sy * vx + cy * vz;
  const float cp = std::cos(pitch), sp = std::sin(pitch);
  ox = ax;
  oy = ay * cp + az * sp;
  oz = -ay * sp + az * cp;
}

CamPose CameraEye(const Sim& sim) {
  const World& w = sim.GetWorld();
  const Player& p = sim.GetPlayer();
  const Camera& c = sim.GetCamera();

  CamPose o;
  o.fov = c.fov;
  o.pitch = Clamp(c.pitch + c.kickP, Cfg::cam::pitchMin - 0.2f, Cfg::cam::pitchMax + 0.2f);
  o.yaw = c.yaw + c.kickY;

  const bool inCover = (p.state == PlayerState::Cover || p.state == PlayerState::ToCover);
  const Face* face = nullptr;
  if (p.faceIndex >= 0 && p.faceIndex < static_cast<int>(w.Faces().size()))
    face = &w.Faces()[p.faceIndex];

  /* 肩の左右。既定は右肩。端に寄っているときだけ、その端の側へ寄せて視界を稼ぐ。 */
  float sideSign = 1.0f;
  if (inCover && face) {
    if (p.peekMode == PeekMode::Side) {
      sideSign = static_cast<float>(p.peekSide);
    } else if (p.peekMode == PeekMode::Over) {
      sideSign = 1.0f;                       // 低い遮蔽の立ち撃ちは既定の右肩
    } else {
      const CoverAnchor a = w.AnchorOn(*face, p.t);
      const float dL = (p.t - a.minT) * face->len;
      const float dR = (1.0f - a.minT - p.t) * face->len;
      sideSign = (dL < 1.0f && dL < dR) ? -1.0f : 1.0f;
    }
  }

  const float coverUp = (face && face->low) ? Cfg::cam::coverUpLow : Cfg::cam::coverUpHigh;
  const float shoulder = Lerp(Cfg::cam::shoulder, Cfg::cam::coverShoulder, c.coverBlend) * sideSign;
  const float dist = Lerp(Cfg::cam::dist, Cfg::cam::coverDist, c.coverBlend);
  const float up = Lerp(Cfg::cam::up, coverUp, c.coverBlend) - p.crouch * 0.16f;

  /* 注視の支点。py は胸の高さ（乗り出し分を含む）、up との差でカメラ高を作る。 */
  const float py = Cfg::player::chest + p.y * 0.35f +
                   (p.peekMode == PeekMode::Over ? p.peek * Cfg::cover::peekRise : 0.0f);
  const float pvx = c.px;
  const float pvy = py + (up - Cfg::player::chest);
  const float pvz = c.pz;

  /* カメラの当たり：支点から所望位置へレイを飛ばし、壁にめり込む分だけ引き寄せる。 */
  float ox, oy, oz;
  RotYXZ(o.yaw, o.pitch, shoulder, 0.0f, dist, ox, oy, oz);
  const float ol = Hypot3(ox, oy, oz);
  const float ux = ox / ol, uy = oy / ol, uz = oz / ol;
  const float hit = w.RayWorld(pvx, pvy, pvz, ux, uy, uz, ol + 0.25f);
  const float use = std::min(ol, std::max(0.55f, hit - 0.18f));
  o.x = pvx + ux * use;
  o.y = pvy + uy * use;
  o.z = pvz + uz * use;
  return o;
}

/* レティクル位置(NDC)からのカメラレイ。画面中央ではなく少し上（reticleNdcY）
   にレティクルがあるので、その分だけカメラ前方より上を向く。 */
void AimRay(const CamPose& cp, float& dx, float& dy, float& dz) {
  const float tanHalf = std::tan(cp.fov * 0.5f * kDeg);
  const float ly = Cfg::cam::reticleNdcY * tanHalf;
  const float inv = 1.0f / Hypot3(0.0f, ly, 1.0f);
  RotYXZ(cp.yaw, cp.pitch, 0.0f, ly * inv, -inv, dx, dy, dz);
}

/* world 座標を NDC へ。カメラの後ろなら false。 */
bool ProjectPoint(const CamPose& cp, float wx, float wy, float wz,
                  float& ndcX, float& ndcY) {
  float vx, vy, vz;
  InvRotYXZ(cp.yaw, cp.pitch, wx - cp.x, wy - cp.y, wz - cp.z, vx, vy, vz);
  if (vz > -1e-4f) return false;                 // three.js の ndc.z > 1 に相当
  const float tanHalf = std::tan(cp.fov * 0.5f * kDeg);
  const float w = -vz;
  ndcX = (vx / w) / (tanHalf * kViewAspect);
  ndcY = (vy / w) / tanHalf;
  return true;
}

float Dot3(float ax, float ay, float az, float bx, float by, float bz) {
  return ax * bx + ay * by + az * bz;
}

void Cross3(float ax, float ay, float az, float bx, float by, float bz,
            float& ox, float& oy, float& oz) {
  ox = ay * bz - az * by;
  oy = az * bx - ax * bz;
  oz = ax * by - ay * bx;
}

void Normalize3(float& x, float& y, float& z) {
  const float l = Hypot3(x, y, z);
  if (l > 1e-9f) {
    x /= l;
    y /= l;
    z /= l;
  }
}

/* --------------------------------------------------------------------------
   吸着対象（エイムアシスト）

   ★ 本来は Sim のメンバ変数であるべき状態 ★
   Web版は aimTarget / aimTargetDist をモジュール変数に持っている。コア側でも
   Sim のメンバにしたいが、AshlineSim.h は他が持っているため触れない。
   やむを得ず翻訳単位ローカルに置き、どの Sim が書いたかを控えて、別インスタンス
   から読まれたら「対象なし」を返す（複数 Sim を同時に回しても嘘をつかない）。
   AshlineSim.h に宣言を足せるようになったら、最終報告のとおり Sim へ移すこと。
   -------------------------------------------------------------------------- */
const Sim* gAimSim = nullptr;
int gAimTarget = -1;          // enemies_ の添字。-1 = 吸着対象なし
float gAimTargetDist = 1.0f;  // 0=画面中央 1=吸着円の縁

/* 着弾補正の上限角。§6の3°を上限に、状態と設定段階で縮める。 */
float SnapMaxRad(const Sim& sim) {
  return Cfg::aim::snapDeg * kDeg * sim.AssistScale() * kAssistSnapMul;
}

void AcquireTarget(const Sim& sim) {
  gAimSim = &sim;
  gAimTarget = -1;

  const float scale = sim.AssistScale();
  if (scale <= 0.0f) return;

  const CamPose cp = CameraEye(sim);
  const World& w = sim.GetWorld();
  const std::vector<Enemy>& es = sim.GetEnemies();

  float best = kInf;
  for (int i = 0; i < static_cast<int>(es.size()); ++i) {
    const Enemy& e = es[i];
    if (e.dead || !e.active) continue;
    const float chest = HitboxOf(e).chest;

    float ndcX = 0, ndcY = 0;
    if (!ProjectPoint(cp, e.x, chest, e.z, ndcX, ndcY)) continue;

    /* Web版は画面ピクセルで測る（半径 R = 画面幅 * magnetFrac）。
       幅で割って正規化すると画面解像度が消え、縦横比だけが残る。 */
    const float rx = ndcX * 0.5f;
    const float ry = (ndcY - Cfg::cam::reticleNdcY) * 0.5f / kViewAspect;
    const float ratio = Hypot2(rx, ry) / Cfg::aim::magnetFrac;
    if (ratio > 1.0f) continue;

    /* 遮蔽越しの敵は吸着対象にしない */
    const float dx = e.x - cp.x, dy = chest - cp.y, dz = e.z - cp.z;
    const float dd = Hypot3(dx, dy, dz);
    if (dd < 1e-5f) continue;
    if (w.RayWorld(cp.x, cp.y, cp.z, dx / dd, dy / dd, dz / dd, dd) < dd - 0.2f) continue;

    if (ratio < best) {
      best = ratio;
      gAimTarget = i;
      gAimTargetDist = ratio;
    }
  }
}

/* 有効な吸着対象があれば添字、無ければ -1。 */
int AimTargetOf(const Sim& sim) {
  if (gAimSim != &sim) return -1;
  if (gAimTarget < 0 || gAimTarget >= static_cast<int>(sim.GetEnemies().size())) return -1;
  const Enemy& e = sim.GetEnemies()[gAimTarget];
  if (e.dead || !e.active) return -1;
  return gAimTarget;
}

}  // namespace

/* --------------------------------------------------------------------------
   視点回転の減速（エイムマグネット）

   UpdateLook（AshlinePlayer.cpp）から呼ばれる。本来は Sim のメンバにしたいが
   AshlineSim.h を触れないため、名前空間スコープの関数として出す。
   呼ぶ側は自分の TU で float MagnetSlowdown(const Sim&); と前方宣言すること。
   assistScale を今の状態から引き直すのは Web版と同じ（被弾ノックバックで
   速度が変わった直後でも、減速量が1フレーム古くならないようにするため）。
   -------------------------------------------------------------------------- */
float MagnetSlowdown(const Sim& sim) {
  if (AimTargetOf(sim) < 0) return 1.0f;
  const float s = sim.AssistScale() * kAssistMagnetMul;
  return 1.0f - Cfg::aim::magnetSlow * s * (1.0f - gAimTargetDist);
}

/* --------------------------------------------------------------------------
   状態による可否と補正量
   -------------------------------------------------------------------------- */

/* 状態によるエイムアシスト倍率。ここが柱1(止まって撃つ)を守る要。 */
float Sim::AssistScale() const {
  if (player_.sprint) return 0.0f;   // ダッシュ中は補正ゼロ（かつ射撃不可）
  if (IsBlind()) return 0.0f;        // 見ていないのだから補正しない
  if (player_.state == PlayerState::Roll || player_.state == PlayerState::Swap ||
      player_.state == PlayerState::Vault)
    return 0.0f;
  if (player_.state == PlayerState::Cover) return 1.0f;   // 遮蔽中・乗り出し中は最大
  const float sp = Hypot2(player_.vx, player_.vz);
  // 静止0.90 → 全速歩行0.15。走りながらの乱射を最適解にしないための減衰。
  return 0.15f + 0.75f * Clamp(1.0f - sp / Cfg::move::walk, 0.0f, 1.0f);
}

bool Sim::CanFire() const {
  if (player_.sprint) return false;
  if (player_.state == PlayerState::Roll || player_.state == PlayerState::Swap ||
      player_.state == PlayerState::ToCover || player_.state == PlayerState::Vault)
    return false;
  if (player_.reloadT > 0.0f || player_.ammo <= 0) return false;
  // 隠れたままなら、銃を上げ切った後だけ撃てる（ブラインドファイア）
  if (player_.state == PlayerState::Cover && player_.peek < 0.5f) return IsBlind();
  return true;
}

float Sim::CurrentSpread() const {
  if (IsBlind()) return Cfg::blind::spread;   // 当てる手段ではない
  const float sp = Hypot2(player_.vx, player_.vz) / Cfg::move::walk;
  float base = Lerp(Cfg::fire::spreadStill, Cfg::fire::spreadMove, Clamp(sp, 0.0f, 1.0f));
  if (player_.state == PlayerState::Cover) base = Cfg::fire::spreadStill * 0.75f;
  return base;
}

/* --------------------------------------------------------------------------
   アクティブリロード

   §6「画面下部のバーをどこでもいい1タップ」。親指位置に依存させないため、
   リロード中の最初のタップは場所を問わず受け付ける。
   成功しても弾倉が即座に強くなるわけではなく、リロードが「完了した時点」で
   dmgMul に arBonus が入る（UpdateWeapon 側）。ここを即時適用にすると、
   失敗時の停止ペナルティと釣り合わなくなる。
   -------------------------------------------------------------------------- */
bool Sim::ActiveReloadTap() {
  if (player_.reloadT <= 0.0f || player_.arDone) return false;
  player_.arDone = true;   // 1回のリロードにつき最初の1タップだけを見る

  const float prog = 1.0f - player_.reloadT / Cfg::fire::reload;   // 0..1
  const float w0 = Cfg::fire::arAt;
  const float w1 = w0 + Cfg::fire::arWin / Cfg::fire::reload;
  if (prog >= w0 && prog <= w1) {
    player_.arOk = true;
    player_.reloadT = std::max(0.02f, player_.reloadT - Cfg::fire::arGain);
  } else {
    player_.arFail = 1.0f;
    player_.reloadT = Cfg::fire::arFail;   // 失敗＝停止ペナルティ
  }
  return true;
}

/* --------------------------------------------------------------------------
   銃口
   -------------------------------------------------------------------------- */
void Sim::MuzzlePos(float& mx, float& my, float& mz) const {
  const float fx = YawDirX(player_.yaw), fz = YawDirZ(player_.yaw);
  const float rx = -fz, rz = fx;
  const float y = player_.y + Cfg::player::chest + 0.10f - player_.crouch * 0.35f +
                  (player_.peekMode == PeekMode::Over ? player_.peek * Cfg::cover::peekRise : 0.0f);
  const float lat = (player_.peekMode == PeekMode::Side)
                        ? player_.peekSide * player_.peek * Cfg::cover::peekLateral
                        : 0.0f;
  mx = player_.x + fx * 0.42f + rx * (0.24f + lat);
  my = y;
  mz = player_.z + fz * 0.42f + rz * (0.24f + lat);
}

namespace {

/* ブラインドファイアの銃口：遮蔽の天端より上へ出す（自分の壁を撃たないため） */
void BlindMuzzle(const Player& p, const Face& f, float& mx, float& my, float& mz) {
  mx = p.x - f.nx * 0.30f;
  my = Cfg::kCovers[f.coverIndex].h + Cfg::blind::muzzleUp;
  mz = p.z - f.nz * 0.30f;
}

/* ブラインドファイアの向き：遮蔽の正面から±75°まで。俯角仰角はほぼ水平に潰す。
   狙っていないのだから、カメラの射線をそのまま使ってはいけない。 */
void BlindDir(const Camera& c, const Face& f, float& dx, float& dy, float& dz) {
  const float base = DirToYaw(-f.nx, -f.nz);
  const float yaw = base + Clamp(ShortAngle(c.yaw - base), -75.0f * kDeg, 75.0f * kDeg);
  const float pitch = Clamp(c.pitch, -5.0f * kDeg, 8.0f * kDeg);
  const float cp = std::cos(pitch);
  dx = -std::sin(yaw) * cp;
  dy = std::sin(pitch);
  dz = -std::cos(yaw) * cp;
}

}  // namespace

/* --------------------------------------------------------------------------
   毎フレームの武器更新
   -------------------------------------------------------------------------- */
void Sim::UpdateWeapon(const Input& in, float dt) {
  /* 発砲は1フレーム限りの出来事として扱う。UE5 側は fired を見て演出を出す。 */
  lastShot_.fired = false;

  /* Web版はポインタイベント（＝update より前）でタップを処理している。
     時間の進み方を合わせるため、リロード残時間を減らす前に見る。 */
  if (in.tap) ActiveReloadTap();

  if (player_.fireCd > 0.0f) player_.fireCd -= dt;

  if (player_.reloadT > 0.0f) {
    player_.reloadT -= dt;
    if (player_.reloadT <= 0.0f) {
      player_.ammo = static_cast<int>(Cfg::fire::mag);
      // 成功なら次の弾倉が+20%。成立するのは「完了した瞬間」であって、
      // タップした瞬間ではない。
      player_.dmgMul = player_.arOk ? Cfg::fire::arBonus : 1.0f;
    }
  } else if (player_.ammo <= 0) {
    player_.reloadT = Cfg::fire::reload;
    player_.arDone = false;
    player_.arOk = false;
    player_.arFail = 0.0f;
    player_.dmgMul = 1.0f;
  }

  AcquireTarget(*this);

  /* Web版の want は IN.fire.on または（オートファイア設定 && 吸着対象あり）。
     オートファイアは設定UIの話なのでコアには持たせない。 */
  const bool want = in.fire;
  if (want && CanFire() && player_.fireCd <= 0.0f) Shoot();
}

/* --------------------------------------------------------------------------
   1発撃つ

   ここが2段階ヒットスキャンの本体。順序を変えないこと。
     1) カメラの射線で「プレイヤーが見ている着弾点」を求める
     2) 銃口からその着弾点へ向け直す
     3) 銃口から【全射程で】撃つ
   3) を 1) の距離で打ち切ってはいけない。打ち切ると、正確に狙った弾ほど
      「カメラの当たった距離の手前で何も無い」ことになり、静かに消える。
   -------------------------------------------------------------------------- */
void Sim::Shoot() {
  player_.fireCd = 60.0f / Cfg::fire::rpm;
  player_.ammo--;
  player_.recoil = 1.0f;

  const Face* face = nullptr;
  if (player_.faceIndex >= 0 && player_.faceIndex < static_cast<int>(world_.Faces().size()))
    face = &world_.Faces()[player_.faceIndex];

  /* IsBlind は state==Cover を要求するので face は必ずあるはずだが、
     万一無ければ通常射撃に落とす（銃口が原点に湧くよりは無害）。 */
  const bool blind = IsBlind() && face != nullptr;

  float mx = 0, my = 0, mz = 0;
  float dx = 0, dy = 0, dz = 0;
  bool head = false;

  if (blind) {
    /* 隠れたまま：カメラの射線は使わない。銃だけを遮蔽の上へ出して、
       おおよその方向へばらまく。狙っていないのだから当たらないのが正しい。 */
    BlindMuzzle(player_, *face, mx, my, mz);
    BlindDir(camera_, *face, dx, dy, dz);
  } else {
    /* 1) カメラから着弾点を求める（プレイヤーが見ている先） */
    const CamPose cp = CameraEye(*this);
    AimRay(cp, dx, dy, dz);

    const int ti = AimTargetOf(*this);
    if (ti >= 0) {   // スナップ補正（最大3°）
      const Enemy& tgt = enemies_[ti];
      const float chest = HitboxOf(tgt).chest;
      float tx = tgt.x - cp.x, ty = chest - cp.y, tz = tgt.z - cp.z;
      const float tl = Hypot3(tx, ty, tz);
      if (tl > 1e-5f) {
        tx /= tl;
        ty /= tl;
        tz /= tl;
        const float ang = std::acos(Clamp(Dot3(dx, dy, dz, tx, ty, tz), -1.0f, 1.0f));
        if (ang <= SnapMaxRad(*this) && ang > 1e-5f) {
          dx = tx;
          dy = ty;
          dz = tz;
        }
      }
    }

    const float tW = world_.RayWorld(cp.x, cp.y, cp.z, dx, dy, dz, kFar);
    float tE = kInf;
    for (const Enemy& e : enemies_) {
      if (e.dead || !e.active) continue;
      const EnemyHit r = EnemyRay(e, cp.x, cp.y, cp.z, dx, dy, dz);
      if (r.t < tE) tE = r.t;
    }
    const float camT = std::min(tW, tE);
    const float ix = cp.x + dx * camT;
    const float iy = cp.y + dy * camT;
    const float iz = cp.z + dz * camT;

    /* 2) 銃口から着弾点へ向け直す。カメラの射線が通っていても、
          銃が遮蔽の裏にあれば壁に当たる ＝ 遮蔽を撃ち抜かない。 */
    MuzzlePos(mx, my, mz);
    dx = ix - mx;
    dy = iy - my;
    dz = iz - mz;
    Normalize3(dx, dy, dz);
  }

  /* 拡散は最後に、銃口から出る向きに対してかける */
  const float sp = CurrentSpread();
  if (sp > 1e-6f) {
    const float ra = rng_.Next() * kPi * 2.0f;
    const float rr = std::sqrt(rng_.Next()) * sp;
    /* 真上/真下を向いているときに基準ベクトルが縮退しないよう軸を選び替える */
    const float hx = (std::fabs(dy) < 0.9f) ? 0.0f : 1.0f;
    const float hy = (std::fabs(dy) < 0.9f) ? 1.0f : 0.0f;
    float rtx, rty, rtz, uux, uuy, uuz;
    Cross3(dx, dy, dz, hx, hy, 0.0f, rtx, rty, rtz);
    Normalize3(rtx, rty, rtz);
    Cross3(rtx, rty, rtz, dx, dy, dz, uux, uuy, uuz);
    Normalize3(uux, uuy, uuz);
    const float ca = std::cos(ra) * rr, sa = std::sin(ra) * rr;
    dx += rtx * ca + uux * sa;
    dy += rty * ca + uuy * sa;
    dz += rtz * ca + uuz * sa;
    Normalize3(dx, dy, dz);
  }

  /* 3) 銃口から実際に飛ばす。射程は必ず kFar（カメラ側の距離で切らない）。 */
  const float blocked = world_.RayWorld(mx, my, mz, dx, dy, dz, kFar);
  float mE = kInf;
  int hitIndex = -1;
  bool mHead = false;
  for (int j = 0; j < static_cast<int>(enemies_.size()); ++j) {
    const Enemy& e2 = enemies_[j];
    if (e2.dead || !e2.active) continue;
    const EnemyHit r2 = EnemyRay(e2, mx, my, mz, dx, dy, dz);
    if (r2.t < mE) {
      mE = r2.t;
      hitIndex = j;
      mHead = r2.head;
    }
  }

  float endT;
  if (mE <= blocked) {
    endT = mE;
    head = mHead;
  } else {
    endT = blocked;
    hitIndex = -1;   // 手前の壁が止めた
  }

  const float ex = mx + dx * endT;
  const float ey = my + dy * endT;
  const float ez = mz + dz * endT;

  const float dmg = (head ? Cfg::fire::dmgHead : Cfg::fire::dmg) * player_.dmgMul;

  /* 診断と演出の唯一の出口。UE5 の Niagara / デカール / 命中音はこれだけを見る。
     何に当たったのかをここに書き出しておかないと、当たらない不具合の原因を
     推測で探すことになる。 */
  lastShot_.fired = true;
  lastShot_.muzzleX = mx;
  lastShot_.muzzleY = my;
  lastShot_.muzzleZ = mz;
  lastShot_.hitX = ex;
  lastShot_.hitY = ey;
  lastShot_.hitZ = ez;
  lastShot_.hitEnemy = (hitIndex >= 0);
  lastShot_.headshot = (hitIndex >= 0) && head;
  lastShot_.enemyIndex = hitIndex;
  lastShot_.damage = (hitIndex >= 0) ? dmg : 0.0f;

  if (hitIndex >= 0) {
    DamageEnemy(enemies_[hitIndex], dmg, dx, dz, head);
    hitstop_ = head ? Cfg::hitstop::heavy : Cfg::hitstop::light;
  }

  /* カメラキック（ブラインドファイアは狙っていないので反動の見え方も鈍い） */
  camera_.kickP += Cfg::fire::kickPitch * (blind ? 0.55f : 1.0f);
  camera_.kickY += (rng_.Next() * 2.0f - 1.0f) * Cfg::fire::kickYaw * (blind ? 1.6f : 1.0f);
}

}  // namespace Ashline

/* ==========================================================================
   AshlineSim.h — ゲームのルール層すべて。UE にも Three.js にも依存しない。

   この層の役割
     「遮蔽に入る」「乗り出す」「撃つ」「敵が寄ってくる」といった判断を、
     描画エンジンから完全に切り離して持つ。UE5 側は毎フレーム Step() を呼び、
     出てきた座標と状態を Actor に反映するだけにする。
     こうしておくと、UE5 が無いこの環境でもルールを実行して検証できる。

   単位と向き（AshlineConfig.generated.h と同じ約束。混ぜないこと）
     メートル / Y-up / yaw y に対する前方向 = (-sin y, 0, -cos y)
     Unreal(cm / Z-up) への変換は AshlineBridge だけが行う。

   入力について
     コアは「スティックがどちらに倒れているか」しか知らない。
     タッチかゲームパッドかキーボードかは、この層の外側の話にする。
   ========================================================================== */
#pragma once

#include "AshlineConfig.generated.h"
#include "AshlineMath.h"
#include "AshlineWorld.h"

#include <vector>

namespace Ashline {

/* プレイヤーの状態機械。Web版 game.js の ST と一対一で対応する。 */
enum class PlayerState {
  Free,      // 自由移動
  ToCover,   // 遮蔽へ吸着中（0.165秒）
  Cover,     // 遮蔽に付いている
  Roll,      // 離脱ロール
  Swap,      // 隣の遮蔽への乗り換え
  Vault,     // 低い遮蔽の乗り越え
};

/* 乗り出しの種類。0=していない / 1=横（端から） / 2=上（低い遮蔽から立つ） */
enum class PeekMode : int { None = 0, Side = 1, Over = 2 };

/* 1フレーム分の入力。 */
struct Input {
  float stickX = 0.0f;   // -1..1 カメラ相対の左右
  float stickY = 0.0f;   // -1..1 カメラ相対の前後（+が前）
  float stickMag = 0.0f; // 0..1
  /* 視点の移動量。単位は「ピクセル相当の生の移動量」であって角度ではない。
     UpdateLook が Cfg::cam::sens（rad/px）と速度に応じた加速カーブを内側で
     掛けるので、ここにラジアンを入れると約240分の1の速さになる。
     Web版はタッチのスワイプ距離(px)をそのまま渡している。UE5では
     マウス/スティックの入力値に、この感度カーブが前提とする尺度を合わせること。 */
  float lookDX = 0.0f;
  float lookDY = 0.0f;
  bool fire = false;
  bool action = false;      // 遮蔽/ダッシュ/乗り越えの共用ボタン
  bool actionEdge = false;  // このフレームで押された瞬間か
  bool tap = false;         // アクティブリロード用の「どこでもいい1タップ」
  /* 視点操作に指（またはスティック）が触れているか。動かしていなくても true。
     遮蔽に入った直後の向き自動補正は、これが立っている間は打ち切る。
     「動かした量」で判定すると、指を置いたまま静止している人の向きを
     勝手に回してしまう。 */
  bool look = false;
};

/* 撃った結果。演出側（UE5のNiagara等）はこれだけを見る。 */
struct ShotResult {
  bool fired = false;
  float muzzleX = 0, muzzleY = 0, muzzleZ = 0;
  float hitX = 0, hitY = 0, hitZ = 0;
  bool hitEnemy = false;
  bool headshot = false;
  int enemyIndex = -1;
  float damage = 0.0f;
};

struct Enemy {
  Cfg::EnemyType type = Cfg::EnemyType::rusher;
  float x = 0, z = 0, yaw = kPi;
  float vx = 0, vz = 0;
  float hp = 0, maxHp = 0;
  bool active = false, dead = false;
  float fall = 0, flash = 0, knock = 0, knockX = 0, knockZ = 0;
  float stride = 0;

  /* AI */
  int st = 0;              // 0 idle / 1 advance / 2 aim / 3 fire / 4 cover
  float stT = 0, aimT = 0, fireCd = 0;
  int burst = 0;
  float tgtX = 0, tgtZ = 0;
};

struct Player {
  float x = Cfg::spawn::x, y = 0, z = Cfg::spawn::z;
  float vx = 0, vz = 0;
  float yaw = Cfg::spawn::yaw;

  PlayerState state = PlayerState::Free;
  bool sprint = false, sprintArmed = false;

  /* 遮蔽 */
  int faceIndex = -1;      // -1 = 付いていない
  float t = 0.5f;          // 面上の位置 0..1
  float snapT = 0;
  float coverAlignT = 0;
  float peek = 0;
  int peekSide = 0;        // -1 左 / +1 右
  PeekMode peekMode = PeekMode::None;

  /* ロール・乗り換え・乗り越え */
  float actT = 0, actDur = 0;
  float ax0 = 0, az0 = 0, ax1 = 0, az1 = 0;
  int swapFaceIndex = -1;
  float swapTgt = 0;
  float vaultTop = 0;

  /* 戦闘 */
  float hp = Cfg::hurt::hp;
  int ammo = static_cast<int>(Cfg::fire::mag);
  float reloadT = 0, fireCd = 0;
  float hurtT = 0, dmgFlash = 0;
  bool dead = false;
  float deadT = 0;
  bool arDone = false, arOk = false;
  float arFail = 0;
  float dmgMul = 1.0f;
  float blindT = 0;

  float flash = 0;         // マズルフラッシュの残りフレーム

  /* 見た目に渡す量。
     leanV は前傾の「速度」。前傾は2次のバネ(k=120,c=15)で、停止時に
     行き過ぎてから戻ることが重さの表現そのものなので、速度を毎フレーム
     持ち越さないと挙動が別物になる。Sim ごとに持つ必要がある
     （関数内の static にすると、同一スレッドで2つ動かしたとき混線する）。*/
  float lean = 0, leanV = 0, roll = 0, stride = 0, crouch = 0, landDip = 0, recoil = 0;
};

struct Camera {
  float yaw = Cfg::spawn::yaw;
  float pitch = 0;
  float kickP = 0, kickY = 0;
  float fov = Cfg::sprintCam::fovBase;   // 垂直画角（度）。UEは水平画角なので要変換
  float coverBlend = 0;
  float sprintBlend = 0;
  float bobT = 0;

  /* 注視の支点（追従位置）。吸着の瞬間にワープしないよう常に平滑化する。 */
  float px = Cfg::spawn::x, pz = Cfg::spawn::z;
  float py = Cfg::player::chest;

  /* 肩の左右。既定は右(+1)。遮蔽の端に寄っているときだけその側へ寄せて視界を稼ぐ。 */
  float side = 1;

  /* --- ここから下は UpdateCamera が毎フレーム書く「確定した見え方」 ---
     視点位置と最終的な向き。射撃の照準はここから引く。
     以前は射撃層とUE5層がそれぞれ独立に再構成していたが、同じ式を2箇所に
     持つと必ず片方だけ直されて食い違う。書く場所を1つに決める。 */
  float ex = 0, ey = 0, ez = 0;     // 視点のワールド座標
  float rotPitch = 0, rotYaw = 0;   // 反動と揺れを含んだ最終的な向き
};

enum class CombatState { Idle, Fight, Dead, Clear };

struct Combat {
  bool on = false;
  bool enabled = true;
  int wave = 0;
  CombatState state = CombatState::Idle;
  float t = 0;
  float bannerT = 0;
  int bannerId = 0;   // 文言はUE側のローカライズに任せ、コアはIDだけ持つ
};

/* --------------------------------------------------------------------------
   シミュレーション本体。UE5 の GameMode / Character はこれを1つ持つ。
   -------------------------------------------------------------------------- */
class Sim {
 public:
  Sim();

  /* 固定ステップで1フレーム進める。dt は秒。 */
  void Step(const Input& in, float dt);

  void StartCombat();
  void SetCombatEnabled(bool v);

  /* 検証用：状態を直接置く。ゲーム本編からは呼ばない。 */
  void Teleport(float x, float z, float yaw);
  void SetSeed(unsigned int s) { rng_.Seed(s); }

  const World& GetWorld() const { return world_; }
  const Player& GetPlayer() const { return player_; }
  const Camera& GetCamera() const { return camera_; }
  const Combat& GetCombat() const { return combat_; }
  const std::vector<Enemy>& GetEnemies() const { return enemies_; }
  const ShotResult& LastShot() const { return lastShot_; }
  float Hitstop() const { return hitstop_; }

  /* 露出度 0=完全に隠れている 1=遮蔽なし */
  float Exposure() const;
  bool IsBlind() const;
  bool CanFire() const;
  float CurrentSpread() const;
  float AssistScale() const;

  /* アクティブリロードの入力。受け付けたら true。
     注意：成功窓の2つの設定値は単位が違う。Web版から引き継いだ形。
       Cfg::fire::arAt  … バー全長に対する比 0..1（そのまま使う）
       Cfg::fire::arWin … 秒（比に直すには reload で割る）
     窓は [arAt, arAt + arWin/reload]。HUDを描くときも必ずこの式を使うこと。 */
  bool ActiveReloadTap();

  /* 検証用の書き込み口 */
  Player& MutablePlayer() { return player_; }
  Camera& MutableCamera() { return camera_; }
  std::vector<Enemy>& MutableEnemies() { return enemies_; }

 private:
  /* --- 移動と遮蔽（AshlinePlayer.cpp） --- */
  void UpdateLook(const Input& in, float dt);
  void FreeUpdate(const Input& in, float dt);
  void MoveAndCollide(float dt);
  void EnterCover(int faceIndex, float t);
  void ToCoverUpdate(float dt);
  void CoverUpdate(const Input& in, float dt);
  void LeaveCover();
  void StartRollOrSwap(float lx, float ly);
  void RollUpdate(float dt);
  void SwapUpdate(float dt);
  bool TryVault(float sx, float sy);
  void VaultUpdate(float dt);
  bool TrySlamCover();

  /* --- 射撃（AshlineWeapon.cpp） --- */
  void UpdateWeapon(const Input& in, float dt);
  void Shoot();
  void MuzzlePos(float& mx, float& my, float& mz) const;
  /* 吸着対象が画面中央に近いほど視点の回転を鈍らせる係数（1.0＝鈍らせない）。
     視点操作(UpdateLook)がこれを掛けるので、射撃層が持ちながら移動層から呼ばれる。
     これを落とすと、狙っている最中の感度が最大55%速すぎる状態になる。 */
  float MagnetSlowdown() const;

  /* --- 敵と波（AshlineEnemy.cpp） --- */
  void UpdateEnemies(float dt);
  void UpdateEnemyAI(Enemy& e, float dt);
  void UpdateCombat(float dt);
  void SpawnWave(int n);
  float EnemySeesPlayer(const Enemy& e) const;
  void EnemyShoot(Enemy& e);
  void DamagePlayer(float dmg, float dx, float dz);
  void DamageEnemy(Enemy& e, float dmg, float dx, float dz, bool head);

  /* --- 共通 --- */
  float PlayerAimY() const;
  float PlayerTopY() const;
  void PlayerLatOff(float& ox, float& oz) const;
  void UpdateCamera(float dt);
  void UpdateAnim(float dt);

  World world_;
  Player player_;
  Camera camera_;
  Combat combat_;
  std::vector<Enemy> enemies_;
  ShotResult lastShot_;
  float hitstop_ = 0;
  Rng rng_;
};

}  // namespace Ashline

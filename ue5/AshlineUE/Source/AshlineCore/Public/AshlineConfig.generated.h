/* ==========================================================================
   AshlineConfig.generated.h — 自動生成。手で編集しないこと。
   生成元: ashline/game.js   生成器: ue5/tools/gen_config.js

   単位系: メートル / Y-up / three-style yaw
     yaw y に対する前方向は (-sin y, 0, -cos y)。
     Unreal (cm / Z-up / 左手系) への変換は AshlineBridge が一手に引き受ける。
     コアの内部では絶対に cm を使わない。混ぜた時点で追跡不能になる。
   ========================================================================== */
#pragma once

namespace Ashline {
namespace Cfg {

  namespace player {
    inline constexpr float radius = 0.4f;
    inline constexpr float height = 1.8f;
    inline constexpr float chest = 1.15f;
    inline constexpr float head = 1.62f;
  }
  namespace move {
    inline constexpr float walk = 3.05f;
    inline constexpr float strafe = 2.55f;
    inline constexpr float back = 2.1f;
    inline constexpr float accel = 9.5f;
    inline constexpr float decel = 13.0f;
    inline constexpr float sprint = 6.3f;
    inline constexpr float sprintAccel = 7.5f;
    inline constexpr float coverSlide = 1.85f;
    inline constexpr float faceTurn = 13.0f;
    inline constexpr float sprintTurn = 5.2f;
  }
  namespace cover {
    inline constexpr float snapTime = 0.165f;
    inline constexpr float snapDist = 1.2f;
    inline constexpr float standOff = 0.44f;
    inline constexpr float camBlend = 0.25f;
    inline constexpr float peekIn = 0.18f;
    inline constexpr float peekOut = 0.14f;
    inline constexpr float peekLateral = 0.6f;
    inline constexpr float peekRise = 0.46f;
    inline constexpr float enterThresh = 0.55f;
    inline constexpr float exitThresh = 0.35f;
    inline constexpr float edgeEps = 0.34f;
    inline constexpr float lowMaxH = 1.25f;
  }
  namespace sprintCam {
    inline constexpr float fovBase = 65.0f;
    inline constexpr float fovSprint = 78.0f;
    inline constexpr float fovTau = 0.136363636364f;
    inline constexpr float bobAmp = 0.0436332312999f;
    inline constexpr float bobPeriod = 0.45f;
  }
  namespace fire {
    inline constexpr float rpm = 640.0f;
    inline constexpr float flashFrames = 2.0f;
    inline constexpr float kickPitch = 0.0209439510239f;
    inline constexpr float kickYaw = 0.00698131700798f;
    inline constexpr float kickTau = 0.0833333333333f;
    inline constexpr float spreadStill = 0.00523598775598f;
    inline constexpr float spreadMove = 0.0453785605519f;
    inline constexpr float spreadTau = 0.1f;
    inline constexpr float mag = 30.0f;
    inline constexpr float dmg = 11.0f;
    inline constexpr float dmgHead = 28.0f;
    inline constexpr float reload = 1.1f;
    inline constexpr float arAt = 0.58f;
    inline constexpr float arWin = 0.12f;
    inline constexpr float arBonus = 1.2f;
    inline constexpr float arGain = 0.35f;
    inline constexpr float arFail = 1.6f;
  }
  namespace hurt {
    inline constexpr float hp = 100.0f;
    inline constexpr float regenDelay = 4.0f;
    inline constexpr float regenRate = 26.0f;
    inline constexpr float knock = 2.4f;
    inline constexpr float camKick = 0.0279252680319f;
  }
  namespace ai {
    inline constexpr float sight = 34.0f;
    inline constexpr float thinkMin = 0.35f;
    inline constexpr float thinkMax = 0.9f;
    inline constexpr float aimTell = 0.55f;
    inline constexpr float coverHold = 1.4f;
  }
  namespace hitstop {
    inline constexpr float light = 0.035f;
    inline constexpr float heavy = 0.12f;
    inline constexpr float spec = 0.04f;
  }
  namespace aim {
    inline constexpr float magnetFrac = 0.08f;
    inline constexpr float snapDeg = 3.0f;
    inline constexpr float magnetSlow = 0.55f;
  }
  namespace cam {
    inline constexpr float dist = 3.05f;
    inline constexpr float up = 1.42f;
    inline constexpr float shoulder = 0.58f;
    inline constexpr float coverDist = 2.6f;
    inline constexpr float coverUpLow = 1.26f;
    inline constexpr float coverUpHigh = 1.62f;
    inline constexpr float coverShoulder = 0.98f;
    inline constexpr float pitchMin = -0.872664625997f;
    inline constexpr float pitchMax = 0.628318530718f;
    inline constexpr float sens = 0.0042f;
    inline constexpr float sensAccel = 0.85f;
    inline constexpr float sensRef = 2.4f;
    inline constexpr float reticleNdcY = 0.05f;
  }
  namespace roll {
    inline constexpr float dist = 3.1f;
    inline constexpr float time = 0.55f;
    inline constexpr float swapMax = 4.0f;
    inline constexpr float swapTime = 0.52f;
  }
  namespace vault {
    inline constexpr float range = 1.15f;
    inline constexpr float time = 0.58f;
    inline constexpr float rise = 0.34f;
    inline constexpr float clearance = 0.12f;
  }
  namespace slam {
    inline constexpr float dist = 0.95f;
    inline constexpr float cone = 0.62f;
  }
  namespace blind {
    inline constexpr float raise = 0.12f;
    inline constexpr float lower = 0.1f;
    inline constexpr float ready = 0.85f;
    inline constexpr float spread = 0.12217304764f;
    inline constexpr float muzzleUp = 0.25f;
  }

  namespace arena {
    inline constexpr float hx = 20.0f;
    inline constexpr float hz = 20.0f;
    inline constexpr float wallH = 4.6f;
  }
  namespace spawn {
    inline constexpr float x = 0.0f;
    inline constexpr float z = 16.0f;
    inline constexpr float yaw = 0.0f;
  }
  inline constexpr int kMaxEnemies = 6;

  struct CoverDef { float x, z, hx, hz, h; };
  inline constexpr int kCoverCount = 24;
  inline constexpr CoverDef kCovers[kCoverCount] = {
    { 0.0f, 12.0f, 2.6f, 0.35f, 1.05f },   // 0
    { -4.6f, 13.6f, 0.75f, 0.75f, 1.05f },   // 1
    { 4.6f, 13.6f, 0.75f, 0.75f, 2.05f },   // 2
    { -9.0f, 10.4f, 0.4f, 2.2f, 1.05f },   // 3
    { 9.0f, 10.4f, 0.4f, 2.2f, 1.05f },   // 4
    { 0.0f, 2.0f, 2.6f, 0.35f, 1.05f },   // 5
    { -5.4f, -0.4f, 0.4f, 0.95f, 2.05f },   // 6
    { 5.4f, -0.4f, 0.4f, 0.95f, 2.05f },   // 7
    { -3.2f, 5.2f, 1.9f, 0.35f, 1.05f },   // 8
    { 3.2f, 5.2f, 1.9f, 0.35f, 1.05f },   // 9
    { -3.2f, -5.2f, 1.9f, 0.35f, 1.05f },   // 10
    { 3.2f, -5.2f, 1.9f, 0.35f, 1.05f },   // 11
    { 0.0f, -9.4f, 2.3f, 0.4f, 2.05f },   // 12
    { -12.6f, 4.0f, 0.4f, 2.6f, 2.05f },   // 13
    { -12.6f, -3.0f, 0.4f, 2.2f, 1.05f },   // 14
    { -15.4f, 8.0f, 0.75f, 0.75f, 1.05f },   // 15
    { -14.0f, -9.6f, 2.2f, 0.4f, 1.05f },   // 16
    { 12.6f, 4.0f, 0.4f, 2.6f, 2.05f },   // 17
    { 12.6f, -3.0f, 0.4f, 2.2f, 1.05f },   // 18
    { 15.4f, 8.0f, 0.75f, 0.75f, 1.05f },   // 19
    { 14.0f, -9.6f, 2.2f, 0.4f, 1.05f },   // 20
    { -7.0f, -14.0f, 2.2f, 0.4f, 2.05f },   // 21
    { 7.0f, -14.0f, 2.2f, 0.4f, 2.05f },   // 22
    { 0.0f, -16.6f, 1.6f, 0.4f, 1.05f }   // 23
  };

  enum class EnemyType : int { rusher = 0, marksman = 1, heavy = 2, Count = 3 };
  struct EnemyDef {
    float hp, speed, keep, fireRange, dmg, rpm, spread, tell, scale;
    int burst;
  };
  inline constexpr EnemyDef kEnemyDefs[(int)EnemyType::Count] = {
    { 90.0f, 3.7f, 3.2f, 14.0f, 7.0f, 420.0f, 3.4f, 0.4f, 1.0f, 5 },   // rusher
    { 70.0f, 2.4f, 15.0f, 30.0f, 15.0f, 70.0f, 1.1f, 0.85f, 1.0f, 1 },   // marksman
    { 220.0f, 1.9f, 6.0f, 18.0f, 10.0f, 260.0f, 4.6f, 0.55f, 1.18f, 8 }   // heavy
  };
  inline constexpr const char* kEnemyNames[(int)EnemyType::Count] = { "rusher", "marksman", "heavy" };

  struct SpawnDef { EnemyType type; float x, z; };
  struct WaveDef { int count; SpawnDef slots[5]; };
  inline constexpr int kWaveCount = 3;
  inline constexpr WaveDef kWaves[kWaveCount] = {
    { 2, { { EnemyType::rusher, -3.0f, -12.0f }, { EnemyType::rusher, 3.0f, -12.0f } } },
    { 3, { { EnemyType::marksman, -14.0f, -8.0f }, { EnemyType::marksman, 14.0f, -8.0f }, { EnemyType::rusher, 0.0f, -15.0f } } },
    { 5, { { EnemyType::rusher, -5.0f, -14.0f }, { EnemyType::rusher, 5.0f, -14.0f }, { EnemyType::marksman, -15.0f, -2.0f }, { EnemyType::marksman, 15.0f, -2.0f }, { EnemyType::heavy, 0.0f, -16.0f } } }
  };

} // namespace Cfg
} // namespace Ashline

// ============================================================
//  ObCore — every tuning constant, in METRES and seconds.
//
//  Mirrors overburst/src/config.js 1:1 on purpose. The web build's
//  numbers were tuned against Armored Core VI's feel and verified in a
//  playable build; starting the Unreal port from a different set would
//  throw that away and make the two targets incomparable.
//
//  If a number changes here, change it there too, and say so.
// ============================================================
#pragma once

namespace ob {
namespace cfg {

// ---- arena ----------------------------------------------------------
struct Arena {
  static constexpr float Radius   = 460.0f;   // playable radius (soft wall beyond)
  static constexpr float Wall     = 500.0f;   // hard kill wall
  static constexpr float Ceiling  = 300.0f;   // flight ceiling
  static constexpr float GroundY  = 0.0f;
};

// ---- player mech ----------------------------------------------------
struct Player {
  static constexpr float AP               = 11200.0f;
  static constexpr float EnCap            = 4000.0f;
  static constexpr float EnRecharge       = 1450.0f;  // per second, grounded
  static constexpr float EnRechargeAir    = 1080.0f;
  static constexpr float EnRecoveryDelay  = 0.28f;    // s before recharge resumes
  static constexpr float EnRedlineDelay   = 1.35f;    // s lockout at full depletion

  static constexpr float WalkSpeed        = 26.0f;
  static constexpr float BoostSpeed       = 62.0f;
  static constexpr float AbSpeed          = 146.0f;
  static constexpr float AbAccel          = 190.0f;
  static constexpr float AbEnDrain        = 560.0f;
  static constexpr float AbIgnition       = 380.0f;   // one-shot cost

  // The quick boost. This is the game.
  static constexpr float QbImpulse        = 118.0f;   // velocity injected, m/s
  static constexpr float QbEnCost         = 400.0f;
  static constexpr float QbReload         = 0.42f;
  static constexpr float QbDuration       = 0.24f;    // thrust window
  static constexpr float QbDragBoost      = 0.72f;    // drag multiplier during it

  static constexpr float JumpImpulse      = 46.0f;
  static constexpr float HoverThrust      = 118.0f;
  static constexpr float HoverEnDrain     = 380.0f;
  static constexpr float DescendThrust    = 92.0f;

  static constexpr float Gravity          = 68.0f;
  static constexpr float GroundDrag       = 6.2f;
  static constexpr float AirDrag          = 1.05f;
  static constexpr float BoostDrag        = 2.6f;

  static constexpr float Radius           = 4.2f;     // capsule
  static constexpr float Height           = 11.0f;

  static constexpr float AcsCap           = 2600.0f;
  static constexpr float AcsDecay         = 620.0f;   // per second
  static constexpr float AcsDecayDelay    = 0.55f;
  static constexpr float StaggerTime      = 2.2f;
  static constexpr float DirectHitMult    = 1.62f;

  static constexpr int   RepairKits       = 3;
  static constexpr float RepairAmount     = 3800.0f;
  static constexpr float RepairTime       = 0.9f;
};

// ---- camera ---------------------------------------------------------
struct Cam {
  static constexpr float Dist      = 20.6f;
  static constexpr float Height    = 2.2f;
  static constexpr float Shoulder  = 3.6f;
  static constexpr float Fov       = 62.0f;
  static constexpr float FovAb     = 88.0f;
  static constexpr float PitchMin  = -1.15f;
  static constexpr float PitchMax  = 1.05f;
  static constexpr float Sens      = 0.0022f;
  static constexpr float Lag       = 16.0f;
  static constexpr float LookLag   = 22.0f;
};

// ---- lock-on --------------------------------------------------------
struct Lock {
  static constexpr float FovSoft     = 0.30f;  // radians, half-angle
  static constexpr float FovHard     = 0.40f;
  static constexpr float Range       = 420.0f;
  static constexpr float Assist      = 0.55f;
  static constexpr float MultiSpread = 0.22f;
};

// ---- the fixed loadout. No assembly, by design. ---------------------
struct Rifle {   // R-arm  MG-014 LANCET
  static constexpr float Damage = 148.0f, Impact = 172.0f, Acs = 96.0f;
  static constexpr float Rpm = 545.0f, Spread = 0.0042f, Speed = 620.0f;
  static constexpr int   Magazine = 24, Ammo = 480;
  static constexpr float ReloadTime = 1.55f, Recoil = 0.0055f;
};
struct Blade {   // L-arm  PB-03 VERGE
  static constexpr float Damage = 1180.0f, Impact = 1400.0f, Acs = 900.0f;
  static constexpr float Cooldown = 1.9f, Range = 26.0f, DashSpeed = 128.0f;
  static constexpr float Windup = 0.16f, Active = 0.22f, ChargeMult = 2.15f;
};
struct Missile { // R-back VP-60LCS RACK
  static constexpr float Damage = 212.0f, Impact = 260.0f, Acs = 148.0f;
  static constexpr int   Count = 6, Ammo = 96;
  static constexpr float Salvo = 0.055f, Reload = 3.1f;
  static constexpr float Speed = 96.0f, Accel = 240.0f, TurnRate = 3.1f;
  static constexpr float LockTime = 0.55f, ArmTime = 0.28f, BlastRadius = 9.0f;
};
struct Cannon {  // L-back BML-SB PYRE
  static constexpr float Damage = 1640.0f, Impact = 2050.0f, Acs = 1250.0f;
  static constexpr float ChargeTime = 1.05f, Cooldown = 2.6f;
  static constexpr int   Ammo = 14;
  static constexpr float Speed = 320.0f, BlastRadius = 17.0f;
};

// ---- hostiles -------------------------------------------------------
// MTs are cannon fodder. ACs are duels: thousands of AP, the player's full
// movement vocabulary, and an arrival that changes the mission's temperature.
// See AC_DESIGN.md section 7.
enum class EnemyKind : uint8_t {
  MT, Drone, Turret, Heli, Pylon,
  AcLight,    // SHRIKE  — reverse-joint, twin blades, never stops moving
  AcMid,      // KITE    — the baseline duellist
  AcHeavy,    // BULWARK — tetrapod, shoulder cannons, barely moves
  Boss,       // NIGHTJAR
  Count
};

struct EnemyDef {
  float ap;
  float speed;
  float dps;
  int   score;
  bool  isAC;      // uses quick boost / assault boost / hover
};

inline constexpr EnemyDef kEnemy[static_cast<int>(EnemyKind::Count)] = {
  /* MT      */ { 1750.0f,  13.0f,  46.0f,  100, false },
  /* Drone   */ {  620.0f,  30.0f,  30.0f,   60, false },
  /* Turret  */ { 2400.0f,   0.0f,  62.0f,  120, false },
  /* Heli    */ { 2900.0f,  26.0f,  70.0f,  180, false },
  /* Pylon   */ { 5200.0f,   0.0f,   0.0f,  400, false },
  /* AcLight */ { 5200.0f,  96.0f,  84.0f,  900, true  },
  /* AcMid   */ { 7400.0f,  78.0f, 102.0f, 1300, true  },
  /* AcHeavy */ {11000.0f,  44.0f, 138.0f, 1800, true  },
  /* Boss    */ {24000.0f,  78.0f, 130.0f, 3000, true  },
};

inline constexpr const EnemyDef& Enemy(EnemyKind k) {
  return kEnemy[static_cast<int>(k)];
}

// ---- mission --------------------------------------------------------
struct Mission {
  static constexpr float TimeLimit = 600.0f;
  static constexpr int   Pylons    = 3;
};

}  // namespace cfg
}  // namespace ob

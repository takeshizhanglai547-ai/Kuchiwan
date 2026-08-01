// ============================================================
//  OVERBURST — central tuning constants.
//  Every gameplay number lives here. Modules import { CFG }.
// ============================================================

export const CFG = {
  // ---- world ----
  ARENA: {
    RADIUS: 460,        // playable radius (soft wall beyond)
    WALL: 500,          // hard kill-wall radius
    CEILING: 300,       // max flight altitude
    GROUND_Y: 0,
  },

  // ---- player mech ----
  PLAYER: {
    AP: 11200,              // armor points
    EN_CAP: 3400,           // energy capacity
    EN_RECHARGE: 1450,      // EN/s while grounded & not boosting
    EN_RECHARGE_AIR: 1080,  // EN/s while airborne
    EN_RECOVERY_DELAY: 0.28,// s before recharge resumes after spend
    EN_REDLINE_DELAY: 1.35, // s lockout after full depletion (overload)

    WALK_SPEED: 26,
    BOOST_SPEED: 62,        // sustained boost ground speed
    AB_SPEED: 146,          // assault boost top speed
    AB_ACCEL: 190,
    AB_EN_DRAIN: 620,       // EN/s
    AB_IGNITION: 380,       // one-shot EN cost

    QB_IMPULSE: 118,        // quick-boost velocity injection
    QB_EN_COST: 400,
    QB_RELOAD: 0.42,        // s between quick boosts
    QB_DURATION: 0.24,      // s of thrust window
    QB_DRAG_BOOST: 0.72,    // drag multiplier during QB (keeps speed longer)

    JUMP_IMPULSE: 46,
    HOVER_THRUST: 118,      // upward accel while holding jump
    HOVER_EN_DRAIN: 380,
    DESCEND_THRUST: 92,

    GRAVITY: 68,
    GROUND_DRAG: 6.2,
    AIR_DRAG: 1.05,
    BOOST_DRAG: 2.6,

    RADIUS: 4.2,            // collision capsule radius
    HEIGHT: 11.0,

    ACS_CAP: 2600,          // stagger gauge
    ACS_DECAY: 620,         // per second
    ACS_DECAY_DELAY: 0.55,
    STAGGER_TIME: 2.2,
    DIRECT_HIT_MULT: 1.62,

    REPAIR_KITS: 3,
    REPAIR_AMOUNT: 3800,
    REPAIR_TIME: 0.9,
  },

  // ---- camera ----
  CAM: {
    DIST: 21.5,
    HEIGHT: 6.4,
    SHOULDER: 3.1,
    FOV: 62,
    FOV_AB: 88,
    PITCH_MIN: -1.15,
    PITCH_MAX: 1.05,
    SENS: 0.0022,
    LAG: 16,            // position follow stiffness
    LOOK_LAG: 22,
  },

  // ---- fixed loadout (no assembly — by design) ----
  WEAPONS: {
    RIFLE: {           // R-arm : RF-024 class burst rifle
      name: 'MG-014 LANCET',
      damage: 148, impact: 172, acs: 96,
      rpm: 545, spread: 0.0042, speed: 620,
      magazine: 24, reloadTime: 1.55, ammo: 480,
      recoil: 0.0055,
    },
    BLADE: {           // L-arm : pulse blade
      name: 'PB-03 VERGE',
      damage: 1180, impact: 1400, acs: 900,
      cooldown: 1.9, range: 26, dashSpeed: 128, windup: 0.16, active: 0.22,
      chargeMult: 2.15,
    },
    MISSILE: {         // R-shoulder : vertical missile rack
      name: 'VP-60LCS RACK',
      damage: 212, impact: 260, acs: 148,
      count: 6, salvo: 0.055, reload: 3.1, ammo: 96,
      speed: 96, accel: 240, turnRate: 3.1, lockTime: 0.55, armTime: 0.28,
      blastRadius: 9,
    },
    CANNON: {          // L-shoulder : plasma siege cannon
      name: 'BML-SB PYRE',
      damage: 1640, impact: 2050, acs: 1250,
      chargeTime: 1.05, cooldown: 2.6, ammo: 14,
      speed: 320, blastRadius: 17,
    },
  },

  // ---- lock-on ----
  LOCK: {
    FOV_SOFT: 0.30,     // radians half-angle for soft assist
    FOV_HARD: 0.40,
    RANGE: 420,
    ASSIST: 0.55,       // 0..1 aim convergence while hard-locked
    MULTI_SPREAD: 0.22, // multi-lock reticle sweep
  },

  // ---- enemies ----
  ENEMY: {
    MT:     { ap: 1750, speed: 13,  dps: 46,  score: 100 },
    DRONE:  { ap: 620,  speed: 30,  dps: 30,  score: 60  },
    TURRET: { ap: 2400, speed: 0,   dps: 62,  score: 120 },
    HELI:   { ap: 2900, speed: 26,  dps: 70,  score: 180 },
    PYLON:  { ap: 5200, speed: 0,   dps: 0,   score: 400 },
    BOSS:   { ap: 24000, speed: 78, dps: 130, score: 3000 },
  },

  // ---- mission ----
  MISSION: {
    ID: 'OP-317',
    CODENAME: 'SLAG CROWN',
    TIME_LIMIT: 600,       // seconds
    PYLONS: 3,
  },

  // ---- presentation ----
  FX: {
    BLOOM_STRENGTH: 0.62,
    BLOOM_RADIUS: 0.55,
    BLOOM_THRESHOLD: 0.82,
    EXPOSURE: 1.06,
    VIGNETTE: 0.42,
    CA: 0.0016,            // chromatic aberration
    GRAIN: 0.045,
    SHAKE_SCALE: 1.0,
  },

  COLORS: {
    PLAYER_ACCENT: 0x4fd9ff,
    ENEMY_ACCENT:  0xff5a2b,
    BOSS_ACCENT:   0xd93cff,
    HUD_PRIMARY:   '#5ff4ff',
    HUD_WARN:      '#ffb020',
    HUD_DANGER:    '#ff3b30',
  },

  DEBUG: false,
};

export default CFG;

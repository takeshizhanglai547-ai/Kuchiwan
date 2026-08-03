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
    EN_CAP: 4000,           // energy capacity (~10 quick boosts, ~6 s of AB)
    EN_RECHARGE: 1450,      // EN/s while grounded & not boosting
    EN_RECHARGE_AIR: 1080,  // EN/s while airborne
    EN_RECOVERY_DELAY: 0.28,// s before recharge resumes after spend
    EN_REDLINE_DELAY: 1.35, // s lockout after full depletion (overload)

    WALK_SPEED: 26,
    BOOST_SPEED: 62,        // sustained boost ground speed
    AB_SPEED: 146,          // assault boost top speed
    AB_ACCEL: 190,
    AB_EN_DRAIN: 560,       // EN/s
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
    DIST: 20.6,
    HEIGHT: 2.2,          // above the chest pivot — lens sits at shoulder height
    SHOULDER: 3.6,
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

  // ---- presentation (owned by core/postfx.js) ----
  FX: {
    BLOOM_STRENGTH: 0.84,
    BLOOM_RADIUS: 0.20,    // LOW on purpose. UnrealBloom's lerpBloomFactor()
                           // mirrors the mip weights around 0.6, so a high
                           // radius gives the 31x17 bottom mip nearly as much
                           // say as the sharp one — and that mip's blur
                           // iso-contour is the octagon that showed up around
                           // bright cores. Low radius + the ramp below keeps
                           // the core sharp and round.
    BLOOM_MIPS: [1.00, 0.68, 0.40, 0.20, 0.08],
    BLOOM_THRESHOLD: 0.82, // DISPLAY-referred; postfx converts to the linear
                           // scene cutoff so only real emissives bloom
    EXPOSURE: 1.02,
    VIGNETTE: 0.30,
    EDGE_DESAT: 0.12,
    CA: 0.0013,            // chromatic aberration (~0.2 % at the corners)
    CA_MIX: 0.40,          // how much of the fringe survives inside a streak
    GRAIN: 0.026,
    HI_DITHER: 0.007,      // highlight-only dither — dissolves the 8-bit
                           // contour ring that made bloom cores read as a
                           // flat-topped polygon
    SCAN: 0.020,           // horizontal scan modulation depth
    SPEED_BLUR: 0.240,     // radial blur reach at setSpeedLines(1), BEFORE the
                           // depth weight below (which averages ~0.3)
    SPEED_NEAR: 60,        // world units. weight = FLOOR + (1-FLOOR)*(N/(d+N))^2
                           // -> 0.584 at 20 u (ground at the mech's feet),
                           //    0.076 at 300 u, 0.050 at the sky: near ground
                           //    smears 7.6x harder than mid-field and 11.6x
                           //    harder than the horizon
    SPEED_FLOOR: 0.05,     // the sky still creeps, it does not freeze
    SPEED_PEAK: 0.22,      // how much of the streak keeps its brightest tap
    SHAKE_SCALE: 1.0,
    ADAPTIVE: true,        // rolling frame-time fallback (bloom res + AO only)

    // Nothing in this world resolves to a void. AC6 shadows are deep but the
    // overcast smog sky always bounces something back into them. Applied after
    // every multiplicative screen effect so no vignette/grain combination can
    // undo it. 0.026 display ~= RGB 7.
    // Measured: the toe-protected contrast below is what actually stopped the
    // crush. This pedestal was redundant on top of it, and probing it out
    // recovered 1.65x local contrast in the darkest quartile (std .0197 ->
    // .0326) while pure black stayed at 0.000%. A lifted floor reads as a flat
    // grey cutout, which is exactly what the second panel scored it as.
    BLACK_FLOOR: 0.0,
    BLACK_FLOOR_KNEE: 0.075,

    // ---- ambient occlusion (half-res, from the shared depth buffer) ----
    // The mech is 11 units tall, so RADIUS 2.8 is roughly one shin: the scale
    // at which foot/ground, knee, backpack and pillar-base contacts read.
    AO: {
      ENABLED: true,
      SCALE: 0.5,          // render resolution fraction
      SAMPLES: 12,
      RADIUS: 2.8,
      BIAS: 0.035,
      INTENSITY: 1.25,
      POWER: 1.40,
      AMOUNT: 0.95,        // final blend weight in the composite
      FADE_START: 260,     // world units — beyond this AO tapers out so the
      FADE_END: 620,       // hazed background does not read as grime
      EMISSIVE_LO: 1.6,    // linear luma above which AO backs off (a furnace
      EMISSIVE_HI: 6.0,    // mouth is not occluded by its own wall)
    },

    // Colour grade — this is what pulls the frame back to ASH-GREY
    // INDUSTRIAL. Applied in display/gamma space after the filmic tonemap.
    GRADE: {
      gain:       [0.985, 0.992, 1.018],   // red down / blue up: kills the sherbet
      offset:     [0.008, 0.010, 0.020],   // cool lift in the deep shadows
      power:      [1.000, 1.000, 0.990],
      contrast:   1.085,
      contrastToe: 0.120,                  // below this the contrast fades out
                                           // instead of driving values negative
      saturation: 0.820,
      shadowTint: [0.910, 0.960, 1.075],   // cool shadows
      highTint:   [1.078, 1.006, 0.902],   // warm key in the highlights
      shadowAmt:  0.42,
      highAmt:    0.52,
      lift:       0.0,                     // see BLACK_FLOOR above — redundant, and it flattened the shadows
      liftKnee:   0.210,
      liftTint:   [0.780, 0.920, 1.170],
      shoulder:   0.860,                   // highlight rolloff knee
      white:      1.000,                   // asymptote — nothing ever clips
      bleach:     0.260,                   // how much the very top goes white
      kneeLin:    3.000,                   // log knee on the LINEAR peak: keeps
      logK:       0.700,                   // a gradient across a bloom core
    },
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

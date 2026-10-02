// src/player/tuning.js — ALL movement / camera / aim tunables in one place.
// Owner: movement designer. Units: meters, seconds, radians. The boss reuses MOVE with
// overrides (see src/enemies/boss.js), so tune the player first.
//
// Numbers follow docs/AC6_BENCHMARK.md §3.4 "(a2) [ADAPTED] targets" (mid-weight rig, 10 m):
//   walk 20 · ground boost 85 (90% in ~0.33 s, no EN), stop to walk in ~0.46 s with a skid
//   QB = max(105, |v|+30) set INSTANTLY, held 0.35 s, then decays with tau 0.12 s;
//        17% EN, 0.55 s cooldown (6 chained from full) -> ~37 m of jet travel, ~44 m with the skid
//   jump apex ~16 m (1.0 s up), hover climb 60 m/s at 21% EN/s, gravity 32, glide sink 5
//   AB: 0.6 s wind-up (brakes + charges), then launches at 110 and settles at 130 m/s;
//       10% start cost + 13% EN/s
//   EN: regen delay 1.3 s, redline lockout 2.0 s then +20% instantly, refill ~130%/s
//   Camera: vertical FOV 61 (+6 boost, +10 AB, +3.5 fast climb / drop, spring 0.25 s), orbit 31 m behind (+2.2 m to the
//           right of) a point just above the head, so the rig sits in the lower-centre at 22-30%
//           of frame height and the right-arm rifle clears the torso. Thin props between the
//           camera and the rig dissolve (screen-door cutout, camera.js) instead of hiding it.
// Every curve is plotted by `npm run telemetry` (.shots/telemetry.png).
// EN is expressed in % (max 100).
import { DEFAULT_EN } from '../mech/energy.js';

export const MOVE = {
  // Body / collision capsule (feet at pos)
  radius: 2.6,
  height: 9.6,

  // Gravity (heavy but snappy)
  gravity: 32,
  maxFallSpeed: 90,

  // Walking (boost toggled OFF)
  walkSpeed: 20,
  walkTau: 0.22,            // exponential approach time constant (s)
  walkAccel: 60,            // cap (m/s^2)

  // Ground boost (boost toggled ON — default). Velocity approaches the target exponentially
  // (tau) with an acceleration cap, so starts are strong, top speed settles, and reversals /
  // hard turns scrub speed through a skid instead of flipping like an FPS strafe.
  boostDefaultOn: true,
  boostSpeed: 85,
  boostTau: 0.13,           // 0 -> 90% of 85 m/s in ~0.33 s (with the cap)
  boostAccel: 340,          // accel cap (m/s^2): a 180 deg reversal takes ~0.5 s
  boostEnDrain: 0,          // EN/s while ground boosting (0 = free, genre norm)
  brakeTau: 0.4,            // no input on the ground: v' = -v/brakeTau - brakeLinear
  brakeLinear: 25,          //   85 -> 20 m/s in ~0.46 s, full stop in ~0.9 s (~25 m skid)
  skidAngle: 0.9,           // rad between velocity and input that counts as a hard turn (skid FX)

  // Air control (horizontal air boost is free; glides with a slow sink)
  airSpeed: 75,
  airTau: 0.35,
  airAccel: 140,
  airDragTau: 1.6,          // no input in the air: momentum bleeds slowly (heavy)
  airGlideSink: 5,          // max sink speed (m/s) while air-boosting with move input (0 = off)

  // Jump & hover (hold jump in the air)
  jumpVelocity: 32,         // apex ~16 m with gravity 32, 1.0 s to apex
  jumpEnCost: 3,
  hoverAccel: 150,          // upward thrust accel (gravity still applies)
  hoverMaxRise: 60,         // max climb speed while hovering
  hoverEnDrain: 21,         // EN/s
  hoverReleaseBrake: 70,    // extra down-accel (m/s^2) while still rising after the hover is released

  // Quick boost (instant directional burst, chainable)
  qbSpeed: 105,             // burst speed = max(qbSpeed, |v| + qbAddSpeed), set in ONE step
  qbAddSpeed: 30,
  qbDuration: 0.35,         // seconds the burst speed is held (the jet)
  qbDecayTau: 0.12,         // then the over-speed decays toward normal locomotion with this tau
  qbBrakeTau: 0.08,         // ... or, with no stick input on the ground, the rig digs in and stops
  qbBrakeLinear: 70,        //     (exp tau + linear m/s^2): a standstill QB covers ~44 m in total
  qbCooldown: 0.55,         // min seconds between quick boosts (chain rhythm)
  qbEnCost: 17,             // 5 full + 1 overdraw = 6 chained QBs from full (then REDLINE)
  qbGravityScale: 0.1,      // near-weightless during the burst (air QB "hangs")
  qbSteer: 0.1,             // how much input may bend the burst direction

  // Assault boost (toggle): wind-up (brake + charge), then launch into fast flight that
  // follows the aim.
  abSpeed: 130,
  abLaunchSpeed: 110,       // velocity SET at the end of the wind-up (the launch "kick")
  abTau: 0.35,              // then approaches abSpeed with this tau
  abAccel: 200,             // accel cap in flight (also limits how hard the heading can bend)
  abIgnition: 0.6,          // wind-up (flare charge) before launch
  abWindupBrakeTau: 0.5,    // horizontal speed bleeds off during the wind-up (~30% kept)
  abWindupGravityScale: 0.15,
  abStartCost: 10,
  abEnDrain: 13,            // EN/s (flight only)
  abTurnRate: 1.6,          // rad/s the AB heading follows the aim
  abPitchFollow: 0.8,       // 0..1 how much the aim pitch tilts the AB flight path
  abGravityScale: 0.0,
  abEndTau: 0.45,           // momentum bleed after AB ends

  // Landing
  hardLandSpeed: 34,        // fall speed (m/s) that causes landing lag (a plain jump lands at ~32)
  landLag: 0.25,            // seconds of reduced control
  landLagSpeedMul: 0.3,

  // Facing
  turnRate: 12,             // body yaw follow speed (exp. damping lambda)

  // Stagger
  staggerSpeedMul: 0.2,

  // Blade lunge
  lungeSpeed: 120,

  // Energy gauge (percent units)
  en: { ...DEFAULT_EN, max: 100, regenRate: 128, airRegenMul: 1, regenDelay: 1.3, redlineDelay: 2.0, redlineRestore: 20, redlineUnlockFrac: 0.2, redlineRegenMul: 1.0 },
};

// Framing note: the benchmark's three camera numbers (FOV 50, 26-32 m, rig 22-30% of frame
// height) cannot all hold for a 10.7 m rig: at FOV 50 a 22-30% rig needs a 40-55 m camera.
// Combat r1 critic: the 41 m camera hid the rifle behind the torso and let props cover the rig.
// So the DISTANCE (31.6 m to the rig centre) and the FRAMING (~29%) are kept and the vertical FOV
// is widened to 61 (a common third-person value; it also doubles the optic flow of the ground
// near the camera = more speed read). Boost / AB widen it by the benchmark's increments.
export const CAMERA = {
  fov: 61,                  // vertical FOV (see the framing note above)
  fovBoost: 6,              // sustained extra FOV while ground boosting fast (benchmark +6)
  fovAB: 10,                // sustained extra FOV during assault boost flight (benchmark +10)
  fovClimb: 3.5,            // sustained extra FOV at fast vertical speed (hover climb ~60 m/s, drops)
  fovTau: 0.25,             // sustained-FOV spring (s)
  pivotHeight: 11.6,        // the camera ORBITS this point above the feet (~0.9 m over the head),
                            // so the reticle always sits just above the rig's shoulders
  distance: 30.6,           // behind the orbit point (31.7 m to the rig centre)
  shoulder: 2.2,            // lateral offset (+ = camera to the mech's right): the right-arm rifle and
                            // its muzzle flash clear the torso silhouette; the rig sits a touch left
  heightOffset: 0.4,        // extra lift of the camera (keeps the rig low in frame when aiming up)
  pitchMin: -1.2, pitchMax: 1.25,

  // Follow lag: critically damped springs on the orbit point, per camera axis (rad/s).
  // Steady lag at speed v is 2v/omega: QB (105 m/s) sideways -> ~7 m, then catches up.
  lagOmegaSide: 30,
  lagOmegaFwd: 40,          // forward lag mostly shrinks the rig, so keep it tighter
  lagOmegaUp: 16,
  maxLag: 9,                // hard cap (m)
  maxLagUp: 4.5,            // vertical cap (m): the rig never leaves the lower half on a climb

  // Occlusion cutout: arena surfaces that sit between the camera and the rig (lamp masts, gantry
  // legs, pipes, container stacks) dissolve with a screen-door dither inside a feathered box around
  // the rig's projected silhouette, so thin props never hide it and the camera never has to pop.
  // Floors / lids (up-facing surfaces) are never cut.
  cutPad: 1.0,              // m of clearance around the rig's box
  cutFeather: 2.6,          // m of dither ramp outside that box
  cutDepthMargin: 1.5,      // only surfaces at least this far in FRONT of the rig's near side
  cutHalfDepth: 3.0,        // m, half depth of the rig (backpack to gun muzzle)
  cutStrength: 1.0,         // share of occluder pixels removed inside the box (the feather dithers)
  cutHalfWidth: 4.4,        // m, half width of the rig's silhouette (arms + back weapons)
  cutEase: 6,               // 1/s fade of the whole effect when it switches on/off

  // Collision: rays from the orbit point (centre + 4 near-plane corners). A blocker that a small
  // LIFT clears (roof edges, container stacks under the camera line) raises the camera instead of
  // pulling it in, so the framing survives; anything else pulls in instantly (never clips).
  liftMax: 4.5, liftSteps: 3,   // m, candidate lifts 0 / 1.5 / 3 / 4.5
  liftUpLambda: 12, liftDownLambda: 2.5,
  collisionPadding: 0.9,
  probeRadius: 1.1,
  minDistance: 4,
  pushInLambda: 30,         // pull-in is near-instant, ease back out slowly
  pushOutLambda: 5,

  // Quick boost: FOV punch (instant attack, ease-out decay) + micro shake + jolt
  qbFovKick: 6,             // degrees
  qbFovHold: 0.06,          // s at full punch (covers the first frames of the jet)
  qbFovDecay: 0.45,         // then eases out (half at ~0.16 s, gone by the end of the 0.35 s jet)
  qbShake: 0.3,             // trauma
  qbRoll: 0.02,             // rad of camera roll away from the QB direction (decays with the kick)

  // Assault boost: wind-up narrows the view a touch, launch punches it wide
  abChargeFov: -3,
  abChargePull: 2.5,        // m the camera creeps in during the wind-up
  abFlightPull: 3.5,        // m closer during AB flight (keeps the rig >= 22% of frame at +10 FOV)
  abFlightRise: 1.6,        // m higher during AB flight: looks down onto the pitched torso + boosters
  abLaunchKick: 7,          // degrees on top of the sustained fovAB
  abLaunchDecay: 0.55,
  abLaunchShake: 0.45,
  abFlightShake: 0.08,      // continuous rumble while flying

  // Landing: camera dips with the rig (underdamped), scaled by fall speed
  landDipPerMs: 0.045,      // m of dip per m/s of impact speed
  landDipMax: 1.8,
  landShakePerMs: 0.012,

  // Shake response: angle = maxRot * trauma^shakeExp
  shakeExp: 1.5,
  shakeMaxRot: 0.045,       // rad (pitch/yaw); roll is 1.3x
  shakeFreq: 22,            // Hz-ish
  shakeDecay: 1.8,          // trauma per second

  // Bank: the camera rolls slightly into fast turns (aim yaw rate) at speed
  bankPerRad: 0.035,        // rad of roll per rad/s of yaw rate
  bankMax: 0.05,
  bankMinSpeed: 50,

  lookSensitivity: 0.0022,  // rad per mouse pixel
  padLookSpeed: 3.2,        // rad/s at full stick
  keyLookSpeed: 2.2,        // rad/s arrow keys
  invertY: false,
};

export const AIM = {
  fcsRange: 360,            // lock-on range (m)
  fcsConeDeg: 26,           // half-angle of the FCS cone around the aim
  // Soft lock assist (default): when the locked target is near the reticle, the aim is
  // carried along with the target's apparent motion (feed-forward, so QB strafing keeps it
  // framed) plus a gentle pull toward the centre.
  assistConeDeg: 12,
  assistFeedForward: 0.9,   // 0..1 share of the target's angular velocity added to the aim
  assistPull: 3.0,          // 1/s proportional pull toward the target
  assistYawRate: 1.6,       // rad/s cap of the proportional pull
  // Hard lock ("TARGET ASSIST", V / R3 toggles): the camera yaw/pitch track the target
  // through a critically damped spring (~0.2 s lag); mouse input nudges within a small cone.
  hardLockOmega: 10,        // rad/s (lag for a moving target ~ 2/omega = 0.2 s)
  hardLockNudgeDeg: 6,      // how far mouse input may push the aim off the target
  hardLockRange: 480,       // keeps tracking a bit beyond FCS range
  missileLockTime: 0.5,     // seconds a target must stay in the cone to be missile-locked
  bladeLungeRange: 80,      // max lunge distance toward a locked target
};

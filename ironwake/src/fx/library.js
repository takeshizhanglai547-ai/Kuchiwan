// src/fx/library.js — the effect library (owner: weapons/VFX artist). Plain data: tune freely.
//
// An effect is an array of PARTS. A particle part (all fields optional except count/life/size):
//   shape    'glow'|'spark'|'puff'|'star'|'ring'|'chunk'|'flare'|'bolt'|'fire'
//            ('fire' = volumetric flipbook fireball -> soot, fx_fire.jpg: `erode` [a,b] is the
//            flipbook phase over life, `heat` the temperature multiplier, color0 the soot albedo)
//            (legacy: blend 'add' => glow/spark, blend 'alpha' => puff)
//   count [min,max]   life [min,max] s   speed [min,max] m/s   delay [min,max] s (staggered layers)
//   dirMode  'dir' cone around dir | 'hemi' | 'sphere' | 'up' | 'ring' (horizontal) |
//            'ringAxis' (ring around dir) | 'side' (right of dir) | 'ricochet' (mirror of the
//            incoming dir about the normal) | 'arc' (blade sweep)          cone deg
//   size [start,end] m  sizePow (ease-out growth)   color0/color1 [r,g,b] HDR (albedo for lit puffs)
//   alpha [start,end]   alphaPow   fadeIn (fraction of life)
//   heat [start,end]  0..1 fire temperature (puff/chunk/glow/spark)   add [start,end] additive 0..1
//   erode [start,end] puff dissolve threshold   lit (sun-lit smoke)   nosoft
//   drag 1/s  gravity m/s^2  rise m/s  turb m/s^2 (smooth swirl)  spin [min,max]  jitter m
//   stretch (velocity streak)  orient 'dir'|'up' (world-oriented quad)  inherit 0..1 (owner vel)
//   collide / bounce (ground)  legible (grow with camera distance so hits read at 300 m)
//   variant [min,max]  scaleCount (default true)
//   attach   follow the spawn's anchor node (opts.anchor = fx.anchor(node, pos)) — muzzle flashes
// Non-particle parts: { kind: 'light' | 'decal' | 'chunks' | 'distort' | 'shake', ... }
//
// Colours are LINEAR. Palette (docs/AC6_BENCHMARK.md s5): combustion core #FFF4D6 -> #FFB04A ->
// #FF6A1A -> #7A2A10, kinetic tracer #FFD27A, missile smoke #C8C4BE -> #6D6A66, energy rim #7FD8FF.

const DUST = [0.3, 0.27, 0.235], DUST_D = [0.24, 0.22, 0.2];
const SOOT = [0.035, 0.034, 0.034], SOOT_L = [0.075, 0.073, 0.072];
const FB_SOOT = [0.05, 0.047, 0.045], FB_SOOT_L = [0.075, 0.071, 0.067]; // flipbook smoke albedo (lit)
const MSMOKE0 = [0.578, 0.552, 0.515], MSMOKE1 = [0.153, 0.144, 0.133];
const HOT = [3.4, 1.25, 0.24], HOT_D = [1.2, 0.2, 0.025];   // molten sparks: orange halo, white-hot core (shader)
const E_CORE = [3.2, 4.6, 6.5], E_RIM = [0.35, 1.2, 2.4];

export const EFFECTS = {
  // ------------------------------------------------------------------ muzzles
  muzzle: [   // generic (enemy guns)
    { shape: 'star', count: [1, 1], life: [0.04, 0.05], size: [1.9, 2.3], color0: [5, 2.6, 1.0], alpha: [1, 0.6], variant: [0, 3], inherit: 1, nosoft: true },
    { shape: 'glow', count: [1, 1], life: [0.06, 0.07], size: [2.6, 1.4], color0: [2.4, 1.1, 0.35], alpha: [0.9, 0], heat: [1, 1], inherit: 1, nosoft: true },
    { shape: 'fire', count: [1, 1], life: [0.05, 0.07], speed: [20, 35], dirMode: 'dir', cone: 6, size: [1.2, 2.0], stretch: 0.02, color0: FB_SOOT, alpha: [1, 0], heat: [1.0, 0.9], erode: [0.04, 0.2], drag: 6, inherit: 1, nosoft: true },
    { shape: 'spark', count: [2, 3], life: [0.03, 0.05], speed: [50, 90], dirMode: 'dir', cone: 5, size: [0.45, 0.2], stretch: 0.018, color0: [5, 2.8, 1.1], heat: [1, 1], inherit: 1 },
    { shape: 'puff', count: [1, 2], life: [0.5, 0.9], speed: [2, 6], dirMode: 'dir', cone: 35, size: [0.6, 2.6], sizePow: 2, color0: [0.34, 0.32, 0.3], alpha: [0.22, 0], fadeIn: 0.08, erode: [0.05, 0.6], drag: 3, rise: 1, lit: true, spin: [-1, 1] },
    { kind: 'light', color: [1, 0.62, 0.3], intensity: 30, range: 16, dur: 0.05 },
  ],
  muzzle_rifle: [   // RF-24: 1-2 frame star + brake vents + fire tongue + smoke + casing ('attach': rides the barrel)
    { shape: 'star', count: [1, 1], life: [0.034, 0.042], size: [3.2, 4.0], color0: [6, 3.2, 1.25], alpha: [1, 0.7], variant: [0, 3], attach: true, nosoft: true },
    { shape: 'glow', count: [1, 1], life: [0.045, 0.055], size: [3.6, 1.8], color0: [3.2, 1.5, 0.45], alpha: [0.85, 0], heat: [1, 1], attach: true, nosoft: true },
    { shape: 'flare', count: [1, 1], life: [0.03, 0.036], size: [6, 5], color0: [2.0, 1.1, 0.45], alpha: [0.6, 0], attach: true, nosoft: true },
    { shape: 'spark', count: [3, 4], life: [0.035, 0.06], speed: [70, 130], dirMode: 'dir', cone: 4, size: [0.55, 0.25], stretch: 0.02, color0: [6, 3.4, 1.2], heat: [1, 1], inherit: 1 },
    { shape: 'spark', count: [4, 6], life: [0.03, 0.05], speed: [30, 55], dirMode: 'ringAxis', size: [0.35, 0.15], stretch: 0.02, color0: [5, 2.6, 0.9], heat: [1, 1], inherit: 1 },
    { shape: 'fire', count: [1, 2], life: [0.045, 0.07], speed: [25, 45], dirMode: 'dir', cone: 6, size: [1.4, 2.6], stretch: 0.02, color0: FB_SOOT, alpha: [1, 0], heat: [1.0, 0.9], erode: [0.04, 0.2], drag: 6, attach: true, nosoft: true },
    { shape: 'puff', count: [2, 3], life: [1.0, 1.8], speed: [3, 9], dirMode: 'dir', cone: 30, size: [0.7, 3.8], sizePow: 2.2, color0: [0.42, 0.4, 0.37], alpha: [0.38, 0], fadeIn: 0.05, erode: [0.05, 0.62], drag: 3.2, rise: 1.2, turb: 1.2, lit: true, spin: [-1.2, 1.2], inherit: 0.35 },
    { shape: 'chunk', count: [1, 1], life: [1.1, 1.4], speed: [7, 10], dirMode: 'side', cone: 22, size: [0.32, 0.32], color0: [1.3, 0.85, 0.32], variant: [12, 15], gravity: 26, bounce: 0.35, collide: true, spin: [-28, 28], inherit: 0.85, nosoft: true },
    { kind: 'light', color: [1, 0.64, 0.32], intensity: 90, range: 22, dur: 0.05 },
  ],
  muzzle_cannon: [  // HC-90: blast star, fire tongue, side-venting smoke ring, sparks, pressure wave
    { shape: 'star', count: [1, 1], life: [0.045, 0.055], size: [8, 9], color0: [7, 3.6, 1.3], alpha: [1, 0.6], variant: [0, 3], attach: true, nosoft: true },
    { shape: 'glow', count: [1, 1], life: [0.08, 0.1], size: [10, 5], color0: [3.6, 1.7, 0.5], alpha: [1, 0], heat: [1, 1], attach: true, nosoft: true },
    { shape: 'flare', count: [1, 1], life: [0.05, 0.06], size: [18, 14], color0: [2.5, 1.3, 0.5], alpha: [0.8, 0], attach: true, nosoft: true },
    // muzzle blast: flipbook fire tongues thrown forward, collapsing into soot
    { shape: 'fire', count: [3, 4], life: [0.22, 0.36], speed: [25, 60], dirMode: 'dir', cone: 10, size: [5, 9], sizePow: 1.5, stretch: 0.012, color0: FB_SOOT, alpha: [1, 0], alphaPow: 1.5, heat: [1.0, 0.9], erode: [0.03, 0.5], drag: 6, jitter: 0.4, lit: true },
    { shape: 'puff', count: [9, 12], life: [1.4, 2.6], speed: [12, 26], dirMode: 'ringAxis', size: [1.5, 7], sizePow: 2.5, color0: [0.3, 0.285, 0.265], alpha: [0.5, 0], fadeIn: 0.05, erode: [0.02, 0.62], drag: 3.2, rise: 1.4, turb: 1.5, lit: true, spin: [-0.8, 0.8], scaleCount: false },
    { shape: 'fire', count: [2, 3], life: [2.0, 3.0], speed: [10, 30], dirMode: 'dir', cone: 16, size: [7, 13], sizePow: 1.3, color0: [0.2, 0.19, 0.18], alpha: [0.55, 0], alphaPow: 1.3, fadeIn: 0.08, heat: [0, 0], erode: [0.5, 1.0], drag: 2.8, rise: 1.4, turb: 1.5, lit: true, delay: [0.05, 0.12] },
    { shape: 'spark', count: [10, 14], life: [0.15, 0.35], speed: [60, 130], dirMode: 'dir', cone: 16, size: [0.3, 0.1], stretch: 0.03, color0: HOT, color1: HOT_D, heat: [1, 0.4], gravity: 20, drag: 1.5 },
    { shape: 'ring', count: [1, 1], life: [0.16, 0.16], size: [2, 11], sizePow: 2, color0: [1.6, 1.25, 0.95], alpha: [0.4, 0], add: [1, 1], orient: 'dir', erode: [0.5, 0.5], scaleCount: false },
    { kind: 'distort', shape: 'ring', size: [2, 16], life: 0.3, strength: 0.65 },
    { kind: 'light', color: [1, 0.6, 0.28], intensity: 600, range: 45, dur: 0.12 },
  ],
  muzzle_missile: [ // launch: motor ignition flash + dense launch smoke that lingers
    { shape: 'glow', count: [1, 1], life: [0.07, 0.09], size: [3, 1.5], color0: [4, 2, 0.6], alpha: [1, 0], heat: [1, 1], inherit: 0.8, nosoft: true },
    { shape: 'star', count: [1, 1], life: [0.035, 0.04], size: [2.4, 2.6], color0: [5, 2.6, 1], variant: [0, 3], inherit: 0.8, nosoft: true },
    { shape: 'puff', count: [3, 4], life: [1.4, 2.6], speed: [3, 10], dirMode: 'hemi', size: [1, 4.6], sizePow: 2.4, color0: [0.52, 0.5, 0.47], alpha: [0.5, 0], fadeIn: 0.05, erode: [0.02, 0.62], heat: [0.2, 0], coolPow: 4, drag: 2.4, rise: 1.2, turb: 1.4, lit: true, spin: [-1, 1], inherit: 0.4 },
    { shape: 'spark', count: [3, 5], life: [0.1, 0.2], speed: [15, 35], dirMode: 'hemi', size: [0.2, 0.08], stretch: 0.03, color0: HOT, color1: HOT_D, heat: [1, 0.5], gravity: 18 },
    { kind: 'light', color: [1, 0.6, 0.3], intensity: 60, range: 18, dur: 0.07 },
  ],
  muzzle_energy: [
    { shape: 'glow', count: [1, 1], life: [0.07, 0.09], size: [3, 1.6], color0: E_CORE, alpha: [1, 0], heat: [1, 1], nosoft: true },
    { shape: 'ring', count: [1, 1], life: [0.1, 0.1], size: [0.6, 3], color0: E_RIM, alpha: [0.7, 0], add: [1, 1], erode: [0.3, 0.3] },
    { shape: 'spark', count: [3, 5], life: [0.05, 0.1], speed: [20, 50], dirMode: 'dir', cone: 30, size: [0.2, 0.08], stretch: 0.025, color0: E_CORE, color1: E_RIM, heat: [1, 1] },
    { kind: 'light', color: [0.45, 0.75, 1], intensity: 40, range: 16, dur: 0.07 },
  ],

  // ------------------------------------------------------------------ impacts
  impact_sparks: [  // generic metal (actor hit)
    { shape: 'glow', count: [1, 1], life: [0.05, 0.06], size: [2.6, 1.2], color0: [6, 3.4, 1.4], alpha: [1, 0], heat: [1, 1], legible: 1, nosoft: true },
    { shape: 'star', count: [1, 1], life: [0.035, 0.04], size: [2.4, 2.8], color0: [5, 3, 1.3], variant: [0, 3], legible: 1, nosoft: true },
    { shape: 'spark', count: [14, 20], life: [0.18, 0.5], speed: [18, 70], dirMode: 'hemi', size: [0.14, 0.05], stretch: 0.035, color0: HOT, color1: HOT_D, heat: [1, 0.3], gravity: 30, drag: 1.4, collide: true, bounce: 0.4 },
    { shape: 'spark', count: [3, 5], life: [0.08, 0.16], speed: [90, 150], dirMode: 'ricochet', cone: 14, size: [0.2, 0.08], stretch: 0.03, color0: HOT, color1: HOT_D, heat: [1, 0.5], gravity: 10 },
    { shape: 'chunk', count: [2, 4], life: [0.5, 0.9], speed: [8, 22], dirMode: 'hemi', size: [0.28, 0.22], color0: [0.12, 0.11, 0.1], variant: [0, 11], gravity: 30, collide: true, bounce: 0.3, spin: [-20, 20] },
    { shape: 'puff', count: [1, 2], life: [0.08, 0.14], speed: [3, 8], dirMode: 'hemi', cone: 40, size: [0.9, 2.4], sizePow: 2, color0: SOOT, alpha: [0.9, 0], heat: [1, 0.5], add: [1, 0.8], erode: [0.1, 0.8], legible: 0.7, spin: [-4, 4] },
    { shape: 'puff', count: [2, 2], life: [1.0, 1.8], speed: [2, 7], dirMode: 'hemi', size: [0.9, 4.2], sizePow: 2.2, color0: [0.22, 0.21, 0.2], alpha: [0.5, 0], fadeIn: 0.06, erode: [0.05, 0.62], heat: [0.3, 0], coolPow: 4, drag: 3, rise: 1.2, turb: 1, lit: true, spin: [-1, 1] },
    { shape: 'glow', count: [3, 5], life: [0.35, 0.7], speed: [4, 14], dirMode: 'hemi', size: [0.3, 0.12], color0: [4, 1.6, 0.35], alpha: [1, 0], heat: [1, 0.4], gravity: 16, drag: 1.5, collide: true, bounce: 0.3 },
    { kind: 'light', color: [1, 0.6, 0.3], intensity: 60, range: 14, dur: 0.06 },
  ],
  impact_ground: [  // concrete / ash slab: dust burst, chips, few sparks, scorch mark
    { shape: 'glow', count: [1, 1], life: [0.04, 0.05], size: [1.8, 1], color0: [4, 2.4, 1.0], alpha: [1, 0], heat: [1, 1], legible: 1, nosoft: true },
    { shape: 'puff', count: [3, 4], life: [1.0, 2.0], speed: [4, 13], dirMode: 'hemi', cone: 40, size: [0.8, 4.6], sizePow: 2.6, color0: DUST, alpha: [0.6, 0], fadeIn: 0.04, erode: [0.02, 0.62], drag: 3.2, rise: 0.8, turb: 1, lit: true, spin: [-1, 1] },
    { shape: 'puff', count: [1, 1], life: [0.35, 0.5], speed: [16, 26], dirMode: 'hemi', cone: 15, size: [0.5, 2.6], sizePow: 2, color0: DUST_D, alpha: [0.55, 0], erode: [0.1, 0.7], drag: 4, lit: true },
    { shape: 'chunk', count: [5, 8], life: [0.6, 1.2], speed: [10, 26], dirMode: 'hemi', cone: 45, size: [0.24, 0.2], color0: [0.36, 0.33, 0.29], variant: [0, 11], gravity: 32, collide: true, bounce: 0.3, spin: [-18, 18] },
    { shape: 'spark', count: [3, 6], life: [0.1, 0.3], speed: [20, 55], dirMode: 'hemi', size: [0.12, 0.05], stretch: 0.035, color0: HOT, color1: HOT_D, heat: [1, 0.3], gravity: 30, collide: true, bounce: 0.3 },
    { kind: 'decal', size: [0.9, 1.4], life: 14, glow: 0.5 },
  ],
  impact_wall: [    // vertical static geometry
    { shape: 'glow', count: [1, 1], life: [0.04, 0.05], size: [1.8, 1], color0: [4, 2.4, 1.0], alpha: [1, 0], heat: [1, 1], legible: 1, nosoft: true },
    { shape: 'puff', count: [2, 3], life: [0.9, 1.7], speed: [4, 11], dirMode: 'hemi', cone: 35, size: [0.8, 4], sizePow: 2.6, color0: [0.32, 0.3, 0.27], alpha: [0.5, 0], fadeIn: 0.04, erode: [0.02, 0.62], drag: 3.2, rise: 0.6, turb: 1, lit: true, spin: [-1, 1] },
    { shape: 'chunk', count: [4, 6], life: [0.6, 1.1], speed: [10, 24], dirMode: 'hemi', cone: 45, size: [0.22, 0.18], color0: [0.34, 0.31, 0.28], variant: [0, 11], gravity: 32, collide: true, bounce: 0.3, spin: [-18, 18] },
    { shape: 'spark', count: [6, 10], life: [0.12, 0.35], speed: [20, 60], dirMode: 'hemi', size: [0.13, 0.05], stretch: 0.035, color0: HOT, color1: HOT_D, heat: [1, 0.3], gravity: 30, collide: true, bounce: 0.35 },
    { shape: 'spark', count: [2, 3], life: [0.08, 0.14], speed: [80, 140], dirMode: 'ricochet', cone: 16, size: [0.18, 0.07], stretch: 0.03, color0: HOT, color1: HOT_D, heat: [1, 0.5], gravity: 10 },
    { kind: 'decal', size: [0.8, 1.2], life: 14, glow: 0.6 },
  ],
  impact_energy: [
    { shape: 'glow', count: [1, 1], life: [0.08, 0.1], size: [4, 2], color0: E_CORE, alpha: [1, 0], heat: [1, 1], legible: 1, nosoft: true },
    { shape: 'ring', count: [1, 1], life: [0.16, 0.16], size: [0.6, 4.5], sizePow: 2, color0: E_RIM, alpha: [0.8, 0], add: [1, 1], erode: [0.4, 0.4], legible: 1 },
    { shape: 'spark', count: [8, 12], life: [0.1, 0.3], speed: [15, 45], dirMode: 'hemi', size: [0.14, 0.05], stretch: 0.03, color0: E_CORE, color1: E_RIM, heat: [1, 0.5], gravity: 12, drag: 2 },
    { shape: 'puff', count: [1, 1], life: [0.5, 0.8], speed: [1, 3], dirMode: 'hemi', size: [0.8, 2.6], color0: [0.3, 0.3, 0.32], alpha: [0.25, 0], erode: [0.05, 0.6], drag: 3, rise: 1, lit: true },
    { kind: 'light', color: [0.45, 0.75, 1], intensity: 30, range: 14, dur: 0.08 },
  ],

  // ------------------------------------------------------------------ explosions
  explosion_small: [ // missile warhead: flash, flipbook fireball, lingering smoke, sparks, embers, scorch
    { shape: 'glow', count: [1, 1], life: [0.045, 0.05], size: [9, 6], color0: [5, 3, 1.3], alpha: [1, 0], heat: [1, 1], legible: 0.8, nosoft: true },
    { shape: 'star', count: [1, 1], life: [0.035, 0.04], size: [7, 8], color0: [4, 2.4, 1.0], variant: [0, 3], legible: 0.8, nosoft: true },
    { shape: 'fire', count: [2, 3], life: [1.0, 1.35], speed: [2, 6], dirMode: 'sphere', size: [11, 15], sizePow: 1.5, color0: FB_SOOT, alpha: [1, 0], alphaPow: 3, heat: [0.95, 0.95], erode: [0.0, 0.95], drag: 2.5, rise: 2, jitter: 1.0, lit: true },
    { shape: 'fire', count: [2, 3], life: [2.8, 4.0], speed: [3, 7], dirMode: 'up', cone: 35, size: [11, 19], sizePow: 1.3, color0: FB_SOOT_L, alpha: [0.8, 0], alphaPow: 1.4, fadeIn: 0.1, heat: [0, 0], erode: [0.5, 1.0], drag: 1.2, rise: 3.2, turb: 1.4, jitter: 1.5, lit: true, delay: [0.18, 0.35] },
    { shape: 'puff', count: [3, 4], life: [2.6, 3.8], speed: [3, 8], dirMode: 'sphere', size: [2.4, 9], sizePow: 2, color0: SOOT_L, alpha: [0.5, 0], fadeIn: 0.1, coolPow: 3, erode: [0.0, 0.64], drag: 2.2, rise: 2.8, turb: 1.6, jitter: 1.2, lit: true, spin: [-0.5, 0.5], delay: [0.1, 0.3] },
    { shape: 'spark', count: [14, 20], life: [0.3, 0.8], speed: [20, 70], dirMode: 'sphere', size: [0.13, 0.05], stretch: 0.03, color0: HOT, color1: HOT_D, heat: [1, 0.3], gravity: 28, drag: 2.2, collide: true, bounce: 0.35, delay: [0, 0.04] },
    { shape: 'glow', count: [5, 8], life: [0.8, 1.6], speed: [8, 22], dirMode: 'sphere', size: [0.35, 0.15], color0: [4, 1.5, 0.3], alpha: [1, 0], heat: [1, 0.4], gravity: 9, drag: 1, collide: true, bounce: 0.3 },
    { shape: 'puff', count: [8, 10], life: [0.9, 1.6], speed: [16, 26], dirMode: 'ring', size: [1.5, 5], sizePow: 2.4, color0: DUST, alpha: [0.45, 0], fadeIn: 0.03, erode: [0.02, 0.64], drag: 3.5, rise: 0.6, lit: true, spin: [-1, 1], ground: 5, scaleCount: false },
    { kind: 'chunks', count: 3, speed: [14, 30], size: [0.18, 0.4], hot: 0.8 },
    { kind: 'decal', size: [5, 7], life: 24, glow: 1, ground: 7 },
    { kind: 'distort', shape: 'ring', size: [2, 16], life: 0.3, strength: 0.44 },
    { kind: 'light', color: [1, 0.55, 0.25], intensity: 700, range: 45, dur: 0.3, linger: 0.25 },
    { kind: 'shake', amount: 0.28, range: 80 },
  ],
  explosion_large: [ // cannon shell / enemy death: flash, flipbook fireball, smoke column, debris, dust ring, fire, scorch
    { shape: 'glow', count: [1, 1], life: [0.05, 0.06], size: [14, 9], color0: [4, 2.2, 0.8], alpha: [1, 0], heat: [1, 1], legible: 0.6, nosoft: true },
    { shape: 'star', count: [1, 1], life: [0.035, 0.04], size: [18, 20], color0: [4.5, 2.6, 1.1], variant: [0, 3], legible: 0.6, nosoft: true },
    { shape: 'flare', count: [1, 1], life: [0.05, 0.06], size: [36, 28], color0: [1.6, 0.9, 0.4], alpha: [0.6, 0], nosoft: true },
    // fireball: a few big volumetric flipbook billows (ignition -> roll -> soot) + delayed upper lobes
    { shape: 'fire', count: [4, 5], life: [1.5, 1.9], speed: [2, 7], dirMode: 'sphere', size: [26, 33], sizePow: 1.5, color0: FB_SOOT, alpha: [1, 0], alphaPow: 3, heat: [0.95, 0.95], erode: [0.0, 0.95], drag: 2, rise: 3, jitter: 2.5, lit: true },
    { shape: 'fire', count: [3, 4], life: [1.6, 2.1], speed: [7, 14], dirMode: 'up', cone: 55, size: [19, 27], sizePow: 1.4, color0: FB_SOOT, alpha: [1, 0], alphaPow: 3, heat: [0.85, 0.85], erode: [0.03, 0.95], drag: 2.2, rise: 5, jitter: 3, lit: true, delay: [0.04, 0.12] },
    // smoke column: the flipbook's soot stage, rising and spreading for 4-6.5 s
    { shape: 'fire', count: [5, 7], life: [4.2, 6.5], speed: [7, 13], dirMode: 'up', cone: 18, size: [22, 38], sizePow: 1.2, color0: FB_SOOT_L, alpha: [0.85, 0], alphaPow: 1.5, fadeIn: 0.1, heat: [0, 0], erode: [0.5, 1.0], drag: 0.8, rise: 5, turb: 2.2, jitter: 3, lit: true, delay: [0.35, 0.8] },
    { shape: 'puff', count: [8, 10], life: [3.5, 6], speed: [4, 13], dirMode: 'sphere', size: [4.5, 19], sizePow: 2, color0: [0.045, 0.045, 0.047], alpha: [0.6, 0], fadeIn: 0.08, coolPow: 3, erode: [0.0, 0.62], drag: 1.6, rise: 5, turb: 2.2, jitter: 3, lit: true, spin: [-0.4, 0.4], delay: [0.2, 0.5] },
    { shape: 'puff', count: [14, 18], life: [1.4, 2.4], speed: [28, 46], dirMode: 'ring', size: [3, 10], sizePow: 2.4, color0: DUST, alpha: [0.38, 0], fadeIn: 0.05, erode: [0.12, 0.7], drag: 3.2, rise: 0.8, turb: 1.2, lit: true, spin: [-1, 1], ground: 6, scaleCount: false },
    { shape: 'spark', count: [26, 36], life: [0.4, 1.2], speed: [25, 95], dirMode: 'sphere', size: [0.15, 0.05], stretch: 0.032, color0: HOT, color1: HOT_D, heat: [1, 0.3], gravity: 25, drag: 1.8, collide: true, bounce: 0.35, delay: [0, 0.05] },
    { shape: 'glow', count: [14, 20], life: [1.2, 2.8], speed: [12, 36], dirMode: 'up', cone: 70, size: [0.45, 0.18], color0: [4, 1.5, 0.3], alpha: [1, 0], heat: [1, 0.3], gravity: 12, drag: 0.8, collide: true, bounce: 0.3 },
    // lingering fire on the wreck / ground
    { shape: 'fire', count: [3, 4], life: [1.8, 2.8], speed: [0.5, 2], dirMode: 'up', cone: 50, size: [6, 9], color0: FB_SOOT, alpha: [1, 0], alphaPow: 2, fadeIn: 0.12, heat: [1.1, 0.7], erode: [0.1, 0.42], rise: 2, turb: 1.5, jitter: 3.5, lit: true, delay: [0.3, 0.7] },
    { kind: 'chunks', count: 8, speed: [16, 44], size: [0.2, 0.6], hot: 1 },
    { kind: 'decal', size: [11, 15], life: 40, glow: 1, ground: 10 },
    { kind: 'distort', shape: 'ring', size: [4, 40], life: 0.45, strength: 0.55 },
    { kind: 'light', color: [1, 0.52, 0.22], intensity: 1600, range: 90, dur: 0.5, linger: 0.35 },
    { kind: 'shake', amount: 0.85, range: 170 },
  ],
  shockwave: [       // ground pressure wave (boss death)
    { shape: 'ring', count: [1, 1], life: [0.35, 0.35], size: [3, 42], sizePow: 2, color0: [1.4, 1.1, 0.85], alpha: [0.55, 0], add: [1, 1], orient: 'up', erode: [0.7, 0.7], scaleCount: false },
    { shape: 'puff', count: [24, 24], life: [1.2, 2.2], speed: [45, 65], dirMode: 'ring', size: [3, 9], sizePow: 2.5, color0: DUST, alpha: [0.5, 0], erode: [0.02, 0.64], drag: 3.5, rise: 0.6, lit: true, spin: [-1, 1], scaleCount: false },
    { kind: 'distort', shape: 'ring', size: [4, 60], life: 0.5, strength: 0.72 },
  ],
  debris: [
    { kind: 'chunks', count: 5, speed: [12, 32], size: [0.25, 0.7], hot: 0.8 },
    { shape: 'chunk', count: [8, 12], life: [0.8, 1.6], speed: [10, 30], dirMode: 'up', cone: 60, size: [0.35, 0.3], color0: [0.05, 0.047, 0.045], variant: [0, 11], gravity: 32, collide: true, bounce: 0.3, spin: [-12, 12] },
  ],

  // ------------------------------------------------------------------ smoke / dust
  smoke: [           // damage smoke, wreck smoulder, generic
    { shape: 'puff', count: [1, 1], life: [3, 4.6], speed: [0.8, 2.4], dirMode: 'up', cone: 40, size: [1.6, 7.5], sizePow: 1.7, color0: [0.06, 0.056, 0.052], alpha: [0.7, 0], fadeIn: 0.12, erode: [0.0, 0.64], drag: 0.8, rise: 4, turb: 1.8, lit: true, spin: [-0.5, 0.5] },
  ],
  dust_kick: [
    { shape: 'puff', count: [8, 11], life: [0.8, 1.5], speed: [8, 17], dirMode: 'ring', size: [1.4, 6], sizePow: 2.4, color0: DUST, alpha: [0.5, 0], fadeIn: 0.05, erode: [0.02, 0.62], drag: 3, rise: 1, turb: 1, lit: true, jitter: 0.8, spin: [-1, 1] },
    { shape: 'chunk', count: [2, 4], life: [0.4, 0.8], speed: [6, 12], dirMode: 'up', cone: 60, size: [0.22, 0.2], color0: [0.3, 0.28, 0.25], variant: [0, 11], gravity: 32, collide: true, bounce: 0.3, spin: [-15, 15] },
  ],

  // ------------------------------------------------------------------ boosters
  boost_flame: [     // per nozzle @30 Hz, scale = nozzle level, dir = exhaust direction
    { shape: 'spark', count: [1, 1], life: [0.05, 0.08], speed: [40, 70], dirMode: 'dir', cone: 3, size: [0.34, 0.2], stretch: 0.028, color0: [4, 2.1, 0.7], color1: [1.6, 0.4, 0.08], heat: [1, 0.6], inherit: 1, nosoft: true },
    { shape: 'puff', count: [0, 1], life: [0.05, 0.09], speed: [26, 40], dirMode: 'dir', cone: 5, size: [0.3, 1.0], sizePow: 2, color0: SOOT, alpha: [0.7, 0], heat: [1, 0.5], add: [1, 1], erode: [0.25, 0.85], inherit: 0.95, spin: [-6, 6], nosoft: true },
    { kind: 'distort', shape: 'puff', size: [1.0, 2.6], life: 0.16, strength: 0.22, speed: 34, inherit: 0.9, offset: 2.5 },
  ],
  nozzle_glow: [     // one per lit nozzle per step (fx/status.js): hot exit core + halo
    { shape: 'glow', count: [1, 1], life: [0.016, 0.016], size: [1.6, 1.6], color0: [3.2, 1.7, 0.6], alpha: [0.75, 0.75], heat: [1, 1], nosoft: true },
    { shape: 'glow', count: [1, 1], life: [0.016, 0.016], size: [4.2, 4.2], color0: [1.1, 0.42, 0.1], alpha: [0.35, 0.35], nosoft: true },
  ],
  ab_halo: [        // assault boost: wide bloom-like heat halo around each main booster exit (per step)
    { shape: 'glow', count: [1, 1], life: [0.016, 0.016], size: [7.5, 7.5], color0: [1.5, 0.6, 0.14], alpha: [0.28, 0.28], nosoft: true },
    { shape: 'glow', count: [1, 1], life: [0.016, 0.016], size: [2.4, 2.4], color0: [3.2, 1.9, 0.8], alpha: [0.6, 0.6], heat: [1, 1], nosoft: true },
  ],
  ab_trail: [        // assault boost (sustained): the ray-marched plume carries the read; this adds
                     // short hot gas tongues, rare embers and the heated-air wake (no long streak fans)
    { shape: 'spark', count: [0, 1], life: [0.08, 0.14], speed: [30, 60], dirMode: 'dir', cone: 8, size: [0.12, 0.05], stretch: 0.012, color0: HOT, color1: HOT_D, heat: [1, 0.5], inherit: 0.85 },
    { kind: 'distort', shape: 'puff', size: [1.2, 3.4], life: 0.2, strength: 0.3, speed: 50, inherit: 0.95, offset: 3 },
  ],
  qb_jet: [          // per nozzle on a quick boost (fx/status.js): exit flash + fat flame streak + tongue
    { shape: 'glow', count: [1, 1], life: [0.05, 0.06], size: [4.2, 2], color0: [4.0, 1.9, 0.55], alpha: [1, 0], heat: [0.8, 0.8], nosoft: true },
    { shape: 'star', count: [1, 1], life: [0.034, 0.04], size: [3.6, 4.2], color0: [3.6, 1.7, 0.5], variant: [0, 3], nosoft: true },
    { shape: 'spark', count: [2, 2], life: [0.05, 0.075], speed: [70, 110], dirMode: 'dir', cone: 4, size: [1.4, 0.6], stretch: 0.06, color0: [3.4, 1.2, 0.22], color1: [1.3, 0.3, 0.04], alpha: [1, 0.25], heat: [0.5, 0.15], drag: 3, nosoft: true },
    { shape: 'fire', count: [1, 1], life: [0.08, 0.12], speed: [35, 55], dirMode: 'dir', cone: 6, size: [3.2, 5.6], sizePow: 1.5, stretch: 0.03, color0: FB_SOOT, alpha: [1, 0], heat: [1.0, 0.85], erode: [0.04, 0.3], drag: 6, nosoft: true },
  ],
  qb_burst: [        // quick boost: flash + directional jet blast + exhaust smoke + pressure ring + heat
    { shape: 'glow', count: [1, 1], life: [0.05, 0.06], size: [7.5, 3], color0: [3.8, 1.6, 0.42], alpha: [0.9, 0], heat: [0.6, 0.6], nosoft: true },
    { shape: 'star', count: [1, 1], life: [0.035, 0.04], size: [7, 7.5], color0: [4.2, 2.0, 0.65], variant: [0, 3], nosoft: true },
    { shape: 'flare', count: [1, 1], life: [0.035, 0.04], size: [12, 9], color0: [1.6, 0.75, 0.28], alpha: [0.45, 0], nosoft: true },
    // jet blast: fat white-cored flame streaks shoved out of the nozzles (3-5 frames)
    { shape: 'spark', count: [3, 4], life: [0.05, 0.085], speed: [90, 140], dirMode: 'dir', cone: 7, size: [1.8, 0.8], stretch: 0.06, color0: [3.4, 1.15, 0.2], color1: [1.4, 0.3, 0.04], alpha: [1, 0.2], heat: [0.35, 0.1], drag: 2, jitter: 0.5, nosoft: true },
    { shape: 'spark', count: [4, 6], life: [0.07, 0.13], speed: [80, 140], dirMode: 'dir', cone: 12, size: [0.25, 0.1], stretch: 0.016, color0: [4.5, 2.2, 0.6], color1: [1.4, 0.35, 0.06], heat: [1, 0.5], drag: 5, jitter: 0.6 },
    // exhaust smoke left hanging where the burst fired (moves away from the rig, never veils it)
    { shape: 'puff', count: [4, 6], life: [0.6, 1.1], speed: [12, 26], dirMode: 'dir', cone: 28, size: [1.4, 5.5], sizePow: 2.4, color0: [0.4, 0.38, 0.36], alpha: [0.32, 0], fadeIn: 0.05, erode: [0.05, 0.68], drag: 4.5, rise: 0.8, turb: 1.2, lit: true, spin: [-1.2, 1.2], jitter: 0.8 },
    { shape: 'ring', count: [1, 1], life: [0.12, 0.12], size: [1.5, 9], sizePow: 2, color0: [1.4, 1.0, 0.7], alpha: [0.35, 0], add: [1, 1], orient: 'dir', erode: [0.6, 0.6], scaleCount: false },
    { kind: 'distort', shape: 'ring', size: [2, 14], life: 0.22, strength: 0.6 },
    { kind: 'distort', shape: 'puff', size: [2, 4.5], life: 0.25, strength: 0.4, speed: 30, offset: 2 },
    { kind: 'light', color: [1, 0.6, 0.3], intensity: 90, range: 26, dur: 0.1 },
  ],

  // ------------------------------------------------------------------ blade / stagger
  blade_arc: [       // legacy particle arc (the swept ribbon itself is drawn by fx/slash.js)
    { shape: 'glow', count: [1, 1], life: [0.06, 0.08], size: [3.5, 2], color0: [1.6, 2.3, 3.2], alpha: [0.7, 0], heat: [1, 1], nosoft: true },
    { kind: 'light', color: [0.5, 0.75, 1], intensity: 220, range: 30, dur: 0.18 },
  ],
  blade_hit: [       // slash connects: white-cyan flash, molten + electric sparks sprayed along the cut, ring
    { shape: 'glow', count: [1, 1], life: [0.06, 0.07], size: [5.5, 3], color0: [1.6, 2.3, 3.6], alpha: [0.85, 0], heat: [0.7, 0.7], nosoft: true },
    { shape: 'star', count: [1, 1], life: [0.04, 0.05], size: [7, 8], color0: [2.2, 3.0, 4.6], variant: [0, 3], nosoft: true },
    { shape: 'flare', count: [1, 1], life: [0.05, 0.06], size: [14, 10], color0: [0.6, 1.2, 2.2], alpha: [0.45, 0], nosoft: true },
    { shape: 'spark', count: [30, 40], life: [0.2, 0.6], speed: [30, 95], dirMode: 'hemi', size: [0.2, 0.07], stretch: 0.028, color0: [5, 5.8, 7], color1: E_RIM, heat: [1, 0.3], gravity: 24, drag: 1.6, collide: true, bounce: 0.35 },
    { shape: 'spark', count: [12, 16], life: [0.25, 0.7], speed: [20, 65], dirMode: 'hemi', size: [0.2, 0.07], stretch: 0.03, color0: HOT, color1: HOT_D, heat: [1, 0.3], gravity: 28, drag: 1.4, collide: true, bounce: 0.35 },
    { shape: 'glow', count: [6, 9], life: [0.4, 0.9], speed: [6, 18], dirMode: 'hemi', size: [0.3, 0.12], color0: [4, 1.6, 0.35], alpha: [1, 0], heat: [1, 0.4], gravity: 16, drag: 1.5, collide: true, bounce: 0.3 },
    { shape: 'ring', count: [1, 1], life: [0.16, 0.16], size: [2, 11], sizePow: 2, color0: E_RIM, alpha: [0.35, 0], add: [1, 1], erode: [0.5, 0.5], scaleCount: false },
    // dark smoke boiling off the cut
    { shape: 'puff', count: [3, 4], life: [1.2, 2.2], speed: [3, 9], dirMode: 'hemi', size: [1.5, 6], sizePow: 2.2, color0: [0.12, 0.115, 0.11], alpha: [0.45, 0], fadeIn: 0.08, erode: [0.02, 0.64], drag: 2.4, rise: 2, turb: 1.5, lit: true, spin: [-1, 1], delay: [0.05, 0.15] },
    { kind: 'chunks', count: 4, speed: [12, 26], size: [0.2, 0.5], hot: 1 },
    { kind: 'distort', shape: 'ring', size: [2, 18], life: 0.25, strength: 0.55 },
    { kind: 'light', color: [0.55, 0.78, 1], intensity: 260, range: 30, dur: 0.16 },
  ],
  blade_glow: [      // pulse-blade beam halo (spawned every step while the blade is lit)
    { shape: 'glow', count: [1, 1], life: [0.016, 0.016], size: [4.2, 4.2], color0: [0.5, 1.4, 3.0], alpha: [0.55, 0.4], heat: [0.5, 0.5], nosoft: true },
  ],
  stagger_burst: [   // ACS overload: electric flash + spark spray + ground shock + refraction (arcs: fx/status.js)
    { shape: 'glow', count: [1, 1], life: [0.07, 0.09], size: [7, 3.5], color0: [1.6, 2.5, 4.2], alpha: [0.85, 0], heat: [0.8, 0.8], nosoft: true },
    { shape: 'star', count: [1, 1], life: [0.035, 0.045], size: [6, 7], color0: [2.0, 2.8, 4.4], variant: [0, 3], nosoft: true },
    { shape: 'ring', count: [1, 1], life: [0.26, 0.26], size: [2, 12], sizePow: 1.6, color0: [0.7, 1.5, 3.0], alpha: [0.26, 0], add: [1, 1], orient: 'up', erode: [0.75, 0.75], scaleCount: false },
    { shape: 'spark', count: [16, 22], life: [0.12, 0.45], speed: [12, 45], dirMode: 'sphere', size: [0.14, 0.05], stretch: 0.022, color0: [4, 5.5, 8], color1: E_RIM, heat: [1, 0.3], gravity: 22, drag: 2.2, collide: true, bounce: 0.35 },
    { shape: 'spark', count: [6, 9], life: [0.25, 0.6], speed: [10, 30], dirMode: 'hemi', size: [0.16, 0.06], stretch: 0.025, color0: HOT, color1: HOT_D, heat: [1, 0.3], gravity: 26, drag: 1.5, collide: true, bounce: 0.35 },
    { shape: 'puff', count: [2, 3], life: [0.8, 1.4], speed: [2, 6], dirMode: 'up', cone: 60, size: [1.5, 5], sizePow: 2, color0: [0.18, 0.18, 0.19], alpha: [0.35, 0], fadeIn: 0.1, erode: [0.05, 0.66], drag: 2, rise: 1.5, turb: 1.4, lit: true, spin: [-1, 1] },
    { kind: 'distort', shape: 'ring', size: [2, 16], life: 0.3, strength: 0.5 },
    { kind: 'light', color: [0.5, 0.75, 1], intensity: 260, range: 32, dur: 0.28 },
  ],
  arc_spark: [       // tiny electrical spit (low-AP / staggered targets)
    { shape: 'spark', count: [4, 7], life: [0.08, 0.25], speed: [10, 35], dirMode: 'sphere', size: [0.12, 0.05], stretch: 0.035, color0: [4, 5, 7], color1: E_RIM, heat: [1, 0.5], gravity: 18, drag: 1.5 },
    { shape: 'glow', count: [1, 1], life: [0.05, 0.07], size: [1.4, 0.6], color0: [2.5, 3.5, 5.5], alpha: [1, 0], heat: [1, 1], nosoft: true },
  ],
  fire_lick: [       // low-AP burning damage
    { shape: 'puff', count: [1, 1], life: [0.35, 0.6], speed: [2, 5], dirMode: 'up', cone: 25, size: [0.8, 2], color0: SOOT, alpha: [0.95, 0], heat: [1, 0.35], add: [0.95, 0.5], erode: [0.12, 0.8], rise: 2.5, turb: 2, lit: true, spin: [-3, 3] },
  ],

  // ------------------------------------------------------------------ projectile trails
  missile_trail: [   // puffs that fill out the ribbon (fx/trails.js draws the continuous core)
    { shape: 'puff', count: [1, 1], life: [1.8, 3.2], speed: [0.5, 2.5], dirMode: 'sphere', size: [0.9, 3.8], sizePow: 1.8, color0: MSMOKE0, color1: MSMOKE1, alpha: [0.36, 0], fadeIn: 0.05, erode: [0.02, 0.64], drag: 1, rise: 0.5, turb: 1.4, lit: true, spin: [-1, 1] },
  ],
  shell_trail: [     // heavy cannon slug: short hot wake + thin smoke
    { shape: 'puff', count: [1, 1], life: [0.6, 1.1], speed: [0.5, 2], dirMode: 'sphere', size: [0.6, 2.4], sizePow: 2, color0: [0.34, 0.32, 0.3], alpha: [0.3, 0], erode: [0.05, 0.64], drag: 1.2, rise: 0.4, turb: 1.2, lit: true, heat: [0.5, 0], coolPow: 6, spin: [-1, 1] },
    { shape: 'glow', count: [1, 1], life: [0.08, 0.12], speed: [0, 0], size: [1.6, 0.6], color0: [3, 1.4, 0.4], alpha: [0.8, 0], heat: [1, 1] },
  ],
  tracer: [
    { shape: 'spark', count: [1, 1], life: [0.08, 0.08], speed: [300, 300], dirMode: 'dir', cone: 0, size: [0.3, 0.3], color0: [4, 2.6, 0.8], stretch: 0.03, heat: [1, 1] },
  ],
};

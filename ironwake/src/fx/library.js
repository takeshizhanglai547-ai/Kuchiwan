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
//   variant [min,max]  (puffs: 0-3 thick billows, 4-7 wispy torn dust/ash)  scaleCount (default true)
//   sizeVar v  per-particle size multiplier in [1-v, 1+v] (mixed gauge sparks, mixed-scale puffs)
//   attach   follow the spawn's anchor node (opts.anchor = fx.anchor(node, pos)) — muzzle flashes
//   offset   m along dir before emission (muzzle side-flash past the rig silhouette)
// Non-particle parts: { kind: 'light' | 'decal' | 'pool' | 'chunks' | 'distort' | 'shake', ... }
//   light = {color, intensity, range, dur, linger?, decay? (2 = physical; <2 = broad blast flash)}
//   pool = brief additive warm light pool on the ground (fx/decals.js addPool): size m, life s, intensity
//
// Colours are LINEAR. Palette (docs/AC6_BENCHMARK.md s5): combustion core #FFF4D6 -> #FFB04A ->
// #FF6A1A -> #7A2A10, kinetic tracer #FFD27A, missile smoke #C8C4BE -> #6D6A66, energy rim #7FD8FF.

const DUST = [0.3, 0.27, 0.235], DUST_D = [0.24, 0.22, 0.2];
const WISP = [4, 7], BILLOW = [0, 3];   // puff atlas cells (fx_puff.webp): torn dust / thick smoke
const SOOT = [0.035, 0.034, 0.034], SOOT_L = [0.075, 0.073, 0.072];
const FB_SOOT = [0.062, 0.058, 0.055], FB_SOOT_L = [0.08, 0.076, 0.071]; // flipbook smoke albedo (lit)
const MSMOKE0 = [0.578, 0.552, 0.515], MSMOKE1 = [0.153, 0.144, 0.133];
const HOT = [3.4, 1.25, 0.24], HOT_D = [1.2, 0.2, 0.025];   // molten sparks: orange halo, white-hot core (shader)
const E_CORE = [3.2, 4.6, 6.5], E_RIM = [0.35, 1.2, 2.4];

export const EFFECTS = {
  // ------------------------------------------------------------------ muzzles
  muzzle: [   // generic (enemy guns)
    { shape: 'star', count: [1, 1], life: [0.04, 0.05], size: [1.9, 2.3], color0: [5, 2.6, 1.0], alpha: [1, 0.6], variant: [0, 3], inherit: 1, nosoft: true },
    { shape: 'glow', count: [1, 1], life: [0.06, 0.07], size: [2.6, 1.4], color0: [2.4, 1.1, 0.35], alpha: [0.9, 0], heat: [1, 1], inherit: 1, nosoft: true },
    { shape: 'fire', count: [1, 1], life: [0.05, 0.07], speed: [20, 35], dirMode: 'dir', cone: 6, size: [1.2, 2.0], stretch: 0.02, color0: FB_SOOT, alpha: [1, 0], heat: [1.0, 0.9], add: [0.85, 0.5], erode: [0.04, 0.2], drag: 6, inherit: 1, nosoft: true },
    { shape: 'spark', count: [2, 3], life: [0.03, 0.05], speed: [50, 90], dirMode: 'dir', cone: 5, size: [0.45, 0.2], stretch: 0.018, color0: [5, 2.8, 1.1], heat: [1, 1], inherit: 1 },
    { shape: 'puff', count: [1, 2], life: [0.5, 0.9], speed: [2, 6], dirMode: 'dir', cone: 35, size: [0.6, 2.6], sizePow: 2, color0: [0.34, 0.32, 0.3], alpha: [0.2, 0], fadeIn: 0.08, erode: [0.12, 0.66], drag: 3, rise: 1, lit: true, spin: [-1, 1], variant: WISP },
    { kind: 'light', color: [1, 0.62, 0.3], intensity: 30, range: 16, dur: 0.05 },
  ],
  muzzle_rifle: [   // RF-24: 1-2 frame star + brake vents + fire tongue + smoke + casing ('attach': rides the barrel)
    { shape: 'star', count: [1, 1], life: [0.034, 0.042], size: [3.6, 4.4], color0: [6, 3.2, 1.25], alpha: [1, 0.7], variant: [0, 3], attach: true, nosoft: true },
    { shape: 'glow', count: [1, 1], life: [0.045, 0.055], size: [4.2, 2.0], color0: [3.2, 1.5, 0.45], alpha: [0.85, 0], heat: [1, 1], attach: true, nosoft: true },
    { shape: 'flare', count: [1, 1], life: [0.03, 0.036], size: [5, 4], color0: [1.6, 0.9, 0.38], alpha: [0.45, 0], attach: true, nosoft: true },
    // side-flash 1.3 m down-range: pokes past the rig's silhouette so the chase camera sees each shot
    { shape: 'star', count: [1, 1], life: [0.03, 0.038], size: [2.8, 3.4], color0: [5, 2.7, 1.0], alpha: [1, 0.5], variant: [0, 3], offset: 1.3, attach: true, nosoft: true },
    { shape: 'glow', count: [1, 1], life: [0.04, 0.05], size: [3.2, 1.6], color0: [2.6, 1.3, 0.4], alpha: [0.7, 0], heat: [1, 1], offset: 1.0, attach: true, nosoft: true },
    { shape: 'spark', count: [3, 4], life: [0.035, 0.06], speed: [70, 130], dirMode: 'dir', cone: 4, size: [0.55, 0.25], sizeVar: 0.4, stretch: 0.02, color0: [6, 3.4, 1.2], heat: [1, 1], inherit: 1 },
    { shape: 'spark', count: [4, 6], life: [0.03, 0.05], speed: [30, 55], dirMode: 'ringAxis', size: [0.35, 0.15], sizeVar: 0.4, stretch: 0.02, color0: [5, 2.6, 0.9], heat: [1, 1], inherit: 1 },
    { shape: 'fire', count: [1, 2], life: [0.045, 0.07], speed: [25, 45], dirMode: 'dir', cone: 6, size: [1.6, 2.8], stretch: 0.02, color0: FB_SOOT, alpha: [1, 0], heat: [1.0, 0.9], add: [0.85, 0.5], erode: [0.04, 0.2], drag: 6, attach: true, nosoft: true },
    // (combat r4) muzzle smoke: grey wisps that ride along with the rig (inherit), 0.6-1.2 s
    { shape: 'puff', count: [3, 4], life: [0.6, 1.2], speed: [3, 9], dirMode: 'dir', cone: 30, size: [1.0, 4.4], sizePow: 2.2, sizeVar: 0.35, color0: [0.42, 0.4, 0.375], alpha: [0.38, 0], fadeIn: 0.05, erode: [0.12, 0.64], drag: 3.2, rise: 1.2, turb: 1.2, lit: true, spin: [-1.2, 1.2], inherit: 0.8, variant: WISP, offset: 0.6 },
    { kind: 'light', color: [1, 0.64, 0.32], intensity: 140, range: 24, dur: 0.05 },
  ],
  casing_rifle: [   // (combat r4) spent case thrown right + up out of the receiver (weapons.js casingFx): a hot
                    // brass glint smeared by its tumble, cooling to dull brass, bouncing on the slab
    { shape: 'glow', count: [1, 1], life: [1.3, 1.6], speed: [6, 8], dirMode: 'side', cone: 18, size: [0.24, 0.18], stretch: 0.035, color0: [3.4, 2.0, 0.65], color1: [0.6, 0.4, 0.16], colPow: 0.6, alpha: [1, 0.85], heat: [0.7, 0], add: [0.9, 0.2], gravity: 22, drag: 0.4, collide: true, bounce: 0.35, inherit: 0.85, nosoft: true },
  ],
  muzzle_cannon: [  // HC-90: blast star, fire tongue, side-venting smoke ring, sparks, pressure wave
    { shape: 'star', count: [1, 1], life: [0.045, 0.055], size: [8, 9], color0: [7, 3.6, 1.3], alpha: [1, 0.6], variant: [0, 3], attach: true, nosoft: true },
    { shape: 'glow', count: [1, 1], life: [0.08, 0.1], size: [10, 5], color0: [3.6, 1.7, 0.5], alpha: [1, 0], heat: [1, 1], attach: true, nosoft: true },
    { shape: 'flare', count: [1, 1], life: [0.05, 0.06], size: [16, 12], color0: [2.0, 1.1, 0.45], alpha: [0.6, 0], attach: true, nosoft: true },
    // muzzle blast: flipbook fire tongues thrown forward, collapsing into soot
    { shape: 'fire', count: [3, 4], life: [0.22, 0.36], speed: [25, 60], dirMode: 'dir', cone: 10, size: [5, 9], sizePow: 1.5, sizeVar: 0.3, stretch: 0.012, color0: FB_SOOT, alpha: [1, 0], alphaPow: 1.5, heat: [1.0, 0.9], erode: [0.03, 0.5], drag: 6, jitter: 0.4, lit: true },
    { shape: 'puff', count: [12, 16], life: [1.4, 2.6], speed: [12, 26], dirMode: 'ringAxis', size: [1.5, 7], sizePow: 2.5, sizeVar: 0.35, color0: [0.3, 0.285, 0.265], alpha: [0.34, 0], fadeIn: 0.05, erode: [0.1, 0.66], drag: 3.2, rise: 1.4, turb: 1.5, lit: true, spin: [-0.8, 0.8], scaleCount: false },
    { shape: 'fire', count: [2, 3], life: [2.0, 3.0], speed: [10, 30], dirMode: 'dir', cone: 16, size: [7, 13], sizePow: 1.3, color0: [0.2, 0.19, 0.18], alpha: [0.5, 0], alphaPow: 1.3, fadeIn: 0.08, heat: [0, 0], erode: [0.5, 1.0], drag: 2.8, rise: 1.4, turb: 1.5, lit: true, delay: [0.05, 0.12] },
    { shape: 'spark', count: [10, 14], life: [0.15, 0.35], speed: [60, 130], dirMode: 'dir', cone: 16, size: [0.3, 0.1], sizeVar: 0.5, stretch: 0.03, color0: HOT, color1: HOT_D, heat: [1, 0.4], gravity: 20, drag: 1.5 },
    { shape: 'ring', count: [1, 1], life: [0.16, 0.16], size: [2, 11], sizePow: 2, color0: [1.6, 1.25, 0.95], alpha: [0.3, 0], add: [1, 1], orient: 'dir', erode: [0.5, 0.5], scaleCount: false },
    { kind: 'distort', shape: 'ring', size: [2, 16], life: 0.3, strength: 0.75 },
    { kind: 'light', color: [1, 0.6, 0.28], intensity: 1200, range: 50, dur: 0.12 },
  ],
  muzzle_missile: [ // launch: motor ignition flash + dense launch smoke that lingers
    { shape: 'glow', count: [1, 1], life: [0.07, 0.09], size: [3, 1.5], color0: [4, 2, 0.6], alpha: [1, 0], heat: [1, 1], inherit: 0.8, nosoft: true },
    { shape: 'star', count: [1, 1], life: [0.035, 0.04], size: [2.4, 2.6], color0: [5, 2.6, 1], variant: [0, 3], inherit: 0.8, nosoft: true },
    { shape: 'fire', count: [1, 1], life: [0.08, 0.12], speed: [10, 20], dirMode: 'dir', cone: 20, size: [1.6, 3.2], color0: FB_SOOT, alpha: [1, 0], heat: [1.0, 0.8], add: [0.8, 0.4], erode: [0.04, 0.3], drag: 6, inherit: 0.8, nosoft: true },
    { shape: 'puff', count: [5, 6], life: [1.8, 3.2], speed: [3, 10], dirMode: 'hemi', size: [1, 5], sizePow: 2.4, sizeVar: 0.35, color0: [0.52, 0.5, 0.47], alpha: [0.32, 0], fadeIn: 0.05, erode: [0.1, 0.68], heat: [0.2, 0], coolPow: 4, drag: 2.4, rise: 1.2, turb: 1.4, lit: true, spin: [-1, 1], inherit: 0.4 },
    { shape: 'spark', count: [3, 5], life: [0.1, 0.2], speed: [15, 35], dirMode: 'hemi', size: [0.2, 0.08], sizeVar: 0.5, stretch: 0.03, color0: HOT, color1: HOT_D, heat: [1, 0.5], gravity: 18 },
    { kind: 'light', color: [1, 0.6, 0.3], intensity: 90, range: 18, dur: 0.07 },
  ],
  muzzle_energy: [
    { shape: 'glow', count: [1, 1], life: [0.07, 0.09], size: [3, 1.6], color0: E_CORE, alpha: [1, 0], heat: [1, 1], nosoft: true },
    { shape: 'ring', count: [1, 1], life: [0.1, 0.1], size: [0.6, 3], color0: E_RIM, alpha: [0.7, 0], add: [1, 1], erode: [0.3, 0.3] },
    { shape: 'spark', count: [3, 5], life: [0.05, 0.1], speed: [20, 50], dirMode: 'dir', cone: 30, size: [0.2, 0.08], stretch: 0.025, color0: E_CORE, color1: E_RIM, heat: [1, 1] },
    { kind: 'light', color: [0.45, 0.75, 1], intensity: 40, range: 16, dur: 0.07 },
  ],

  // ------------------------------------------------------------------ impacts
  impact_sparks: [  // metal (actor hit): legible at range — hot flash, white star, ricochet streaks that
                    // leave the target's footprint, molten spray along the normal, a light that relights the hull
    { shape: 'glow', count: [1, 1], life: [0.05, 0.065], size: [3.2, 1.4], color0: [6, 3.4, 1.4], alpha: [1, 0], heat: [1, 1], legible: 1.4, nosoft: true },
    { shape: 'star', count: [1, 1], life: [0.035, 0.042], size: [2.8, 3.2], color0: [5, 3, 1.3], variant: [0, 3], legible: 1.3, nosoft: true },
    { shape: 'glow', count: [1, 1], life: [0.09, 0.12], size: [5, 3], color0: [1.6, 0.6, 0.14], alpha: [0.5, 0], legible: 1.2, nosoft: true },
    // molten afterglow on the hull: keeps a sustained burst readable between rounds (3.4 shots/s)
    { shape: 'glow', count: [1, 1], life: [0.18, 0.26], size: [2.0, 0.7], color0: [2.6, 1.0, 0.22], alpha: [0.75, 0], heat: [0.5, 0.2], legible: 1.0, nosoft: true },
    { shape: 'spark', count: [14, 20], life: [0.18, 0.55], speed: [18, 70], dirMode: 'hemi', size: [0.16, 0.05], sizeVar: 0.55, stretch: 0.035, color0: HOT, color1: HOT_D, heat: [1, 0.3], gravity: 24, drag: 1.4, collide: true, bounce: 0.4 },
    { shape: 'spark', count: [8, 12], life: [0.12, 0.24], speed: [110, 180], dirMode: 'ricochet', cone: 24, size: [0.28, 0.1], sizeVar: 0.45, stretch: 0.04, color0: [5, 2.6, 0.7], color1: HOT_D, heat: [1, 0.5], gravity: 10, legible: 0.9 },
    { shape: 'chunk', count: [2, 4], life: [0.5, 0.9], speed: [8, 22], dirMode: 'hemi', size: [0.28, 0.22], color0: [0.12, 0.11, 0.1], variant: [0, 11], gravity: 30, collide: true, bounce: 0.3, spin: [-20, 20] },
    { shape: 'puff', count: [1, 2], life: [0.08, 0.14], speed: [3, 8], dirMode: 'hemi', cone: 40, size: [0.9, 2.4], sizePow: 2, color0: SOOT, alpha: [0.9, 0], heat: [1, 0.5], add: [1, 0.8], erode: [0.1, 0.8], legible: 0.7, spin: [-4, 4] },
    { shape: 'puff', count: [2, 3], life: [1.0, 1.8], speed: [2, 7], dirMode: 'hemi', size: [0.9, 4.2], sizePow: 2.2, sizeVar: 0.3, color0: [0.22, 0.21, 0.2], alpha: [0.34, 0], fadeIn: 0.06, erode: [0.12, 0.66], heat: [0.3, 0], coolPow: 4, drag: 3, rise: 1.2, turb: 1, lit: true, spin: [-1, 1] },
    { shape: 'glow', count: [3, 5], life: [0.35, 0.7], speed: [4, 14], dirMode: 'hemi', size: [0.3, 0.12], color0: [4, 1.6, 0.35], alpha: [1, 0], heat: [1, 0.4], gravity: 16, drag: 1.5, collide: true, bounce: 0.3 },
    { kind: 'light', color: [1, 0.6, 0.3], intensity: 420, range: 16, dur: 0.06 },
  ],
  hull_flash: [     // fx/status.js on a player hit: the struck hull flashes white-orange for ~3 frames
    { shape: 'glow', count: [1, 1], life: [0.05, 0.065], size: [6, 4.5], color0: [2.4, 1.5, 0.75], alpha: [0.38, 0], heat: [0.4, 0.4], nosoft: true },
  ],
  impact_ground: [  // concrete / ash slab: dust burst, chips, few sparks, scorch mark
    { shape: 'glow', count: [1, 1], life: [0.04, 0.05], size: [1.8, 1], color0: [4, 2.4, 1.0], alpha: [1, 0], heat: [1, 1], legible: 1, nosoft: true },
    { shape: 'puff', count: [6, 8], life: [1.0, 2.0], speed: [4, 13], dirMode: 'hemi', cone: 40, size: [0.8, 4.6], sizePow: 2.6, sizeVar: 0.35, color0: DUST, alpha: [0.26, 0], fadeIn: 0.04, erode: [0.18, 0.7], drag: 3.2, rise: 0.8, turb: 1, lit: true, spin: [-1, 1], variant: WISP },
    { shape: 'puff', count: [2, 3], life: [0.35, 0.5], speed: [16, 26], dirMode: 'hemi', cone: 15, size: [0.5, 2.6], sizePow: 2, stretch: 0.03, color0: DUST_D, alpha: [0.3, 0], erode: [0.2, 0.7], drag: 4, lit: true, variant: WISP },
    { shape: 'chunk', count: [5, 8], life: [0.6, 1.2], speed: [10, 26], dirMode: 'hemi', cone: 45, size: [0.24, 0.2], sizeVar: 0.4, color0: [0.2, 0.19, 0.17], variant: [0, 11], gravity: 32, collide: true, bounce: 0.3, spin: [-18, 18] },
    { shape: 'spark', count: [3, 6], life: [0.1, 0.3], speed: [20, 55], dirMode: 'hemi', size: [0.12, 0.05], sizeVar: 0.5, stretch: 0.035, color0: HOT, color1: HOT_D, heat: [1, 0.3], gravity: 30, collide: true, bounce: 0.3 },
    { kind: 'decal', size: [0.9, 1.4], life: 14, glow: 0.5 },
  ],
  impact_wall: [    // vertical static geometry
    { shape: 'glow', count: [1, 1], life: [0.04, 0.05], size: [1.8, 1], color0: [4, 2.4, 1.0], alpha: [1, 0], heat: [1, 1], legible: 1, nosoft: true },
    { shape: 'puff', count: [4, 6], life: [0.9, 1.7], speed: [4, 11], dirMode: 'hemi', cone: 35, size: [0.8, 4], sizePow: 2.6, sizeVar: 0.35, color0: [0.32, 0.3, 0.27], alpha: [0.26, 0], fadeIn: 0.04, erode: [0.18, 0.7], drag: 3.2, rise: 0.6, turb: 1, lit: true, spin: [-1, 1], variant: WISP },
    { shape: 'chunk', count: [4, 6], life: [0.6, 1.1], speed: [10, 24], dirMode: 'hemi', cone: 45, size: [0.22, 0.18], sizeVar: 0.4, color0: [0.2, 0.19, 0.17], variant: [0, 11], gravity: 32, collide: true, bounce: 0.3, spin: [-18, 18] },
    { shape: 'spark', count: [6, 10], life: [0.12, 0.35], speed: [20, 60], dirMode: 'hemi', size: [0.13, 0.05], sizeVar: 0.5, stretch: 0.035, color0: HOT, color1: HOT_D, heat: [1, 0.3], gravity: 30, collide: true, bounce: 0.35 },
    { shape: 'spark', count: [2, 3], life: [0.08, 0.14], speed: [80, 140], dirMode: 'ricochet', cone: 16, size: [0.18, 0.07], stretch: 0.03, color0: HOT, color1: HOT_D, heat: [1, 0.5], gravity: 10 },
    { kind: 'decal', size: [0.8, 1.2], life: 14, glow: 0.6 },
  ],
  impact_energy: [
    { shape: 'glow', count: [1, 1], life: [0.08, 0.1], size: [4, 2], color0: E_CORE, alpha: [1, 0], heat: [1, 1], legible: 1, nosoft: true },
    { shape: 'ring', count: [1, 1], life: [0.16, 0.16], size: [0.6, 4.5], sizePow: 2, color0: E_RIM, alpha: [0.8, 0], add: [1, 1], erode: [0.4, 0.4], legible: 1 },
    { shape: 'spark', count: [8, 12], life: [0.1, 0.3], speed: [15, 45], dirMode: 'hemi', size: [0.14, 0.05], stretch: 0.03, color0: E_CORE, color1: E_RIM, heat: [1, 0.5], gravity: 12, drag: 2 },
    { shape: 'puff', count: [1, 1], life: [0.5, 0.8], speed: [1, 3], dirMode: 'hemi', size: [0.8, 2.6], color0: [0.3, 0.3, 0.32], alpha: [0.2, 0], erode: [0.12, 0.66], drag: 3, rise: 1, lit: true },
    { kind: 'light', color: [0.45, 0.75, 1], intensity: 60, range: 14, dur: 0.08 },
  ],

  // ------------------------------------------------------------------ explosions
  explosion_small: [ // missile warhead: hot star, flipbook fireball, lingering smoke, sparks, embers, scorch
    { shape: 'glow', count: [2, 2], life: [0.026, 0.034], speed: [20, 35], dirMode: 'sphere', size: [5.5, 3], sizeVar: 0.3, stretch: 0.09, color0: [4.6, 2.7, 1.1], alpha: [1, 0.3], heat: [1, 1], jitter: 1.2, legible: 0.8, nosoft: true, scaleCount: false },
    { shape: 'star', count: [1, 1], life: [0.03, 0.035], size: [9, 10], color0: [5, 3, 1.3], variant: [0, 3], legible: 0.8, nosoft: true },
    { shape: 'fire', count: [1, 1], life: [0.16, 0.2], size: [5, 10], sizePow: 0.6, color0: FB_SOOT, alpha: [1, 0], heat: [1.25, 1.0], add: [1, 0.7], erode: [0.0, 0.14], nosoft: true },
    { shape: 'fire', count: [2, 3], life: [1.0, 1.35], speed: [2, 6], dirMode: 'sphere', size: [11, 15], sizePow: 1.5, sizeVar: 0.25, color0: FB_SOOT, alpha: [1, 0], alphaPow: 3, heat: [1.0, 0.95], erode: [0.0, 0.95], drag: 2.5, rise: 2, jitter: 1.0, lit: true },
    { shape: 'fire', count: [4, 6], life: [0.5, 0.8], speed: [8, 18], dirMode: 'sphere', size: [3.5, 7], sizePow: 1.4, sizeVar: 0.35, color0: FB_SOOT, alpha: [1, 0], alphaPow: 2, heat: [1.0, 0.9], erode: [0.02, 0.8], drag: 4, rise: 2, jitter: 1.2, lit: true },
    // smoke (combat r4: a compact black ball): a looser column of mixed-size, lighter soot puffs
    // rising ~3 m/s and drifting apart
    { shape: 'fire', count: [2, 2], life: [2.8, 4.0], speed: [3, 7], dirMode: 'up', cone: 40, size: [9, 17], sizePow: 1.3, sizeVar: 0.4, color0: [0.13, 0.122, 0.112], alpha: [0.5, 0], alphaPow: 1.4, fadeIn: 0.1, heat: [0, 0], erode: [0.5, 1.0], drag: 1.2, rise: 3.0, turb: 1.6, jitter: 2.2, lit: true, delay: [0.18, 0.35] },
    { shape: 'puff', count: [5, 7], life: [2.6, 4.0], speed: [3, 9], dirMode: 'sphere', size: [2.2, 9.5], sizePow: 2, sizeVar: 0.6, color0: [0.16, 0.15, 0.14], alpha: [0.3, 0], fadeIn: 0.1, coolPow: 3, erode: [0.08, 0.68], drag: 1.8, rise: 3.0, turb: 2.0, jitter: 2.4, lit: true, spin: [-0.3, 0.3], delay: [0.1, 0.35], variant: [0, 7] },
    { shape: 'spark', count: [18, 24], life: [0.5, 0.85], speed: [22, 40], dirMode: 'up', cone: 80, size: [0.18, 0.05], sizeVar: 0.6, stretch: 0.035, color0: HOT, color1: HOT_D, heat: [1, 0.3], gravity: 20, drag: 0.6, collide: true, bounce: 0.35, delay: [0, 0.04] },
    { shape: 'glow', count: [3, 5], life: [0.8, 1.6], speed: [8, 22], dirMode: 'sphere', size: [0.35, 0.15], sizeVar: 0.4, color0: [4, 1.5, 0.3], alpha: [1, 0], heat: [1, 0.4], gravity: 9, drag: 1, collide: true, bounce: 0.3 },
    { shape: 'puff', count: [12, 14], life: [0.9, 1.6], speed: [16, 26], dirMode: 'ring', size: [1.5, 5], sizePow: 2.4, sizeVar: 0.35, stretch: 0.03, color0: DUST, alpha: [0.22, 0], fadeIn: 0.03, erode: [0.18, 0.7], drag: 3.5, rise: 0.6, lit: true, spin: [-1, 1], ground: 5, scaleCount: false, variant: WISP },
    { kind: 'chunks', count: 3, speed: [14, 30], size: [0.18, 0.4], hot: 0.8 },
    { kind: 'decal', size: [5, 7], life: 24, glow: 0.7, ground: 7 },
    { kind: 'pool', size: 16, life: 0.26, intensity: 0.55, ground: 8 },
    { kind: 'distort', shape: 'ring', size: [2, 16], life: 0.3, strength: 0.5 },
    { kind: 'light', color: [1, 0.55, 0.25], intensity: 650, range: 60, dur: 0.15, linger: 0.3, decay: 1.4 },
    { kind: 'shake', amount: 0.28, range: 80 },
  ],
  explosion_large: [ // cannon shell / enemy death: flash, ignition core, flipbook fireball of mixed scale,
                     // fire tongues, smoke column, debris, dust ring, lingering fire, scorch, light pool
    // flash: 2 frames, three offset anisotropic glows (combat r2: one round dome read as a halo sprite)
    { shape: 'glow', count: [3, 3], life: [0.026, 0.034], speed: [30, 50], dirMode: 'sphere', size: [7, 4], sizeVar: 0.35, stretch: 0.09, color0: [4.2, 2.4, 0.95], alpha: [0.9, 0.25], heat: [1, 1], jitter: 2.2, legible: 0.5, nosoft: true, scaleCount: false },
    { shape: 'star', count: [1, 1], life: [0.03, 0.034], size: [14, 16], color0: [4.0, 2.3, 1.0], variant: [0, 3], legible: 0.5, nosoft: true },
    { shape: 'flare', count: [1, 1], life: [0.03, 0.036], size: [22, 16], color0: [1.3, 0.75, 0.34], alpha: [0.4, 0], nosoft: true },
    // ignition core: white-hot, collapses into the fireball within ~0.25 s
    { shape: 'fire', count: [2, 3], life: [0.13, 0.18], size: [6, 14], sizePow: 0.6, sizeVar: 0.3, color0: FB_SOOT, alpha: [1, 0], alphaPow: 1.5, heat: [1.0, 0.82], add: [0.9, 0.45], erode: [0.0, 0.14], jitter: 1.8, nosoft: true, scaleCount: false },
    // fireball: a few big volumetric flipbook billows (ignition -> roll -> soot) + delayed upper lobes
    // (combat r4: 3-4 billows read as 2-3 discrete popcorn lobes) 8-10 overlapping billows of
    // mixed size at staggered flipbook phases (erodeVar) merge into one rolling mass
    { shape: 'fire', count: [8, 10], life: [1.4, 1.95], speed: [3, 9], dirMode: 'sphere', size: [17, 26], sizePow: 1.5, sizeVar: 0.5, color0: FB_SOOT, alpha: [1, 0], alphaPow: 3, heat: [1.0, 0.95], erode: [0.0, 0.95], erodeVar: 0.12, drag: 2.2, rise: 3, jitter: 3.4, lit: true, scaleCount: false },
    { shape: 'fire', count: [2, 3], life: [1.6, 2.1], speed: [7, 14], dirMode: 'up', cone: 55, size: [17, 24], sizePow: 1.4, sizeVar: 0.2, color0: FB_SOOT, alpha: [1, 0], alphaPow: 3, heat: [0.9, 0.85], erode: [0.03, 0.95], drag: 2.2, rise: 5, jitter: 3, lit: true, delay: [0.04, 0.12] },
    // fire tongues: a FEW large flipbook billows thrown out and rolling (combat r2: 10-14 small
    // ones read as popcorn at 200%)
    { shape: 'fire', count: [4, 5], life: [0.6, 1.05], speed: [12, 26], dirMode: 'sphere', size: [7, 13], sizePow: 1.3, sizeVar: 0.4, color0: FB_SOOT, alpha: [1, 0], alphaPow: 2, heat: [0.95, 0.85], erode: [0.01, 0.75], erodeVar: 0.1, drag: 4.5, rise: 3, jitter: 2.5, lit: true, scaleCount: false },
    // smoke column: the flipbook's soot stage, rising and spreading for 4-6.5 s
    { shape: 'fire', count: [5, 7], life: [4.2, 6.5], speed: [7, 13], dirMode: 'up', cone: 18, size: [22, 38], sizePow: 1.2, sizeVar: 0.25, color0: FB_SOOT_L, alpha: [0.85, 0], alphaPow: 1.5, fadeIn: 0.1, heat: [0, 0], erode: [0.5, 1.0], drag: 0.8, rise: 5, turb: 2.2, jitter: 3, lit: true, delay: [0.35, 0.8] },
    { shape: 'puff', count: [8, 10], life: [3.5, 6], speed: [4, 13], dirMode: 'sphere', size: [4.5, 19], sizePow: 2, sizeVar: 0.35, color0: [0.045, 0.045, 0.047], alpha: [0.5, 0], fadeIn: 0.08, coolPow: 3, erode: [0.08, 0.66], drag: 1.6, rise: 5, turb: 2.2, jitter: 3, lit: true, spin: [-0.4, 0.4], delay: [0.2, 0.5], variant: BILLOW },
    { shape: 'puff', count: [22, 26], life: [1.4, 2.4], speed: [28, 46], dirMode: 'ring', size: [3, 10], sizePow: 2.4, sizeVar: 0.4, stretch: 0.025, color0: DUST, alpha: [0.24, 0], fadeIn: 0.05, erode: [0.2, 0.72], drag: 3.2, rise: 0.8, turb: 1.2, lit: true, spin: [-1, 1], ground: 6, scaleCount: false, variant: WISP },
    { shape: 'spark', count: [34, 42], life: [0.6, 0.9], speed: [25, 40], dirMode: 'up', cone: 75, size: [0.22, 0.07], sizeVar: 0.6, stretch: 0.035, color0: HOT, color1: HOT_D, heat: [1, 0.3], gravity: 20, drag: 0.5, collide: true, bounce: 0.35, delay: [0, 0.05] },
    { shape: 'spark', count: [8, 10], life: [0.25, 0.5], speed: [60, 100], dirMode: 'sphere', size: [0.2, 0.06], sizeVar: 0.5, stretch: 0.035, color0: HOT, color1: HOT_D, heat: [1, 0.3], gravity: 20, drag: 1.8, collide: true, bounce: 0.35 },
    { shape: 'glow', count: [9, 11], life: [1.2, 2.6], speed: [12, 32], dirMode: 'up', cone: 70, size: [0.42, 0.18], sizeVar: 0.45, color0: [4, 1.5, 0.3], alpha: [1, 0], heat: [1, 0.3], gravity: 12, drag: 0.8, collide: true, bounce: 0.3 },
    // lingering fire on the wreck / ground
    { shape: 'fire', count: [4, 5], life: [1.8, 2.8], speed: [0.5, 2], dirMode: 'up', cone: 50, size: [4, 9], sizeVar: 0.35, color0: FB_SOOT, alpha: [1, 0], alphaPow: 2, fadeIn: 0.12, heat: [1.1, 0.7], erode: [0.1, 0.42], rise: 2, turb: 1.5, jitter: 3.5, lit: true, delay: [0.3, 0.7] },
    { kind: 'chunks', count: 8, speed: [16, 44], size: [0.2, 0.6], hot: 1 },
    { kind: 'decal', size: [11, 15], life: 40, glow: 0.8, ground: 10 },
    { kind: 'pool', size: 32, life: 0.34, intensity: 0.85, ground: 12 },
    { kind: 'distort', shape: 'ring', size: [4, 40], life: 0.45, strength: 0.65 },
    { kind: 'light', color: [1, 0.52, 0.22], intensity: 950, range: 110, dur: 0.22, linger: 0.35, decay: 1.2 },
    { kind: 'shake', amount: 0.85, range: 170 },
  ],
  shockwave: [       // ground pressure wave (boss death)
    { shape: 'ring', count: [1, 1], life: [0.35, 0.35], size: [3, 42], sizePow: 2, color0: [1.4, 1.1, 0.85], alpha: [0.45, 0], add: [1, 1], orient: 'up', erode: [0.7, 0.7], scaleCount: false },
    { shape: 'puff', count: [36, 36], life: [1.2, 2.2], speed: [45, 65], dirMode: 'ring', size: [3, 9], sizePow: 2.5, sizeVar: 0.4, stretch: 0.025, color0: DUST, alpha: [0.26, 0], erode: [0.2, 0.72], drag: 3.5, rise: 0.6, lit: true, spin: [-1, 1], scaleCount: false, variant: WISP },
    { kind: 'distort', shape: 'ring', size: [4, 60], life: 0.5, strength: 0.72 },
  ],
  debris: [
    { kind: 'chunks', count: 5, speed: [12, 32], size: [0.25, 0.7], hot: 0.8 },
    { shape: 'chunk', count: [8, 12], life: [0.8, 1.6], speed: [10, 30], dirMode: 'up', cone: 60, size: [0.35, 0.3], sizeVar: 0.4, color0: [0.05, 0.047, 0.045], variant: [0, 11], gravity: 32, collide: true, bounce: 0.3, spin: [-12, 12] },
  ],

  // ------------------------------------------------------------------ smoke / dust
  smoke: [           // damage smoke, wreck smoulder, generic
    { shape: 'puff', count: [1, 1], life: [3, 4.6], speed: [0.8, 2.4], dirMode: 'up', cone: 40, size: [1.6, 7.5], sizePow: 1.7, sizeVar: 0.3, color0: [0.06, 0.056, 0.052], alpha: [0.55, 0], fadeIn: 0.12, erode: [0.06, 0.66], drag: 0.8, rise: 4, turb: 1.8, lit: true, spin: [-0.5, 0.5], variant: BILLOW },
  ],
  dust_kick: [       // landing / stomp: many low-alpha torn wisps hugging the ground (never a ring of discs)
    { shape: 'puff', count: [16, 22], life: [0.8, 1.5], speed: [8, 17], dirMode: 'ring', size: [1.2, 6], sizePow: 2.4, sizeVar: 0.4, stretch: 0.05, color0: DUST, alpha: [0.22, 0], fadeIn: 0.05, erode: [0.2, 0.72], drag: 3, rise: 0.7, turb: 1, lit: true, jitter: 0.8, spin: [-1, 1], variant: WISP },
    { shape: 'puff', count: [3, 4], life: [0.6, 1.1], speed: [3, 7], dirMode: 'ring', size: [3, 9], sizePow: 1.8, color0: DUST_D, alpha: [0.18, 0], fadeIn: 0.06, erode: [0.22, 0.7], drag: 3, orient: 'up', lit: true, spin: [-0.5, 0.5], variant: WISP },
    { shape: 'chunk', count: [2, 4], life: [0.4, 0.8], speed: [6, 12], dirMode: 'up', cone: 60, size: [0.22, 0.2], sizeVar: 0.4, color0: [0.2, 0.19, 0.17], variant: [0, 11], gravity: 32, collide: true, bounce: 0.3, spin: [-15, 15] },
  ],

  // ------------------------------------------------------------------ boosters
  boost_flame: [     // per nozzle @30 Hz, scale = nozzle level, dir = exhaust direction
    { shape: 'spark', count: [1, 1], life: [0.05, 0.08], speed: [40, 70], dirMode: 'dir', cone: 3, size: [0.34, 0.2], stretch: 0.028, color0: [4, 2.1, 0.7], color1: [1.6, 0.4, 0.08], heat: [1, 0.6], inherit: 1, nosoft: true },
    { shape: 'puff', count: [0, 1], life: [0.05, 0.09], speed: [26, 40], dirMode: 'dir', cone: 5, size: [0.3, 1.0], sizePow: 2, color0: SOOT, alpha: [0.7, 0], heat: [1, 0.5], add: [1, 1], erode: [0.25, 0.85], inherit: 0.95, spin: [-6, 6], nosoft: true },
  ],
  nozzle_glow: [     // one per lit nozzle per step (fx/status.js, scale = radius/0.45 x level): hot exit
                     // core + faint halo, clamped to ~1.3x the bell diameter (combat r2 tell: glare ball)
    { shape: 'glow', count: [1, 1], life: [0.016, 0.016], size: [1.5, 1.5], color0: [2.6, 1.7, 0.75], alpha: [0.55, 0.55], heat: [0.6, 0.6], nosoft: true },
    { shape: 'glow', count: [1, 1], life: [0.016, 0.016], size: [2.6, 2.6], color0: [1.1, 0.42, 0.09], alpha: [0.12, 0.12], nosoft: true },
  ],
  ab_trail: [        // assault boost (sustained): the exhaust jets (fx/status.js) carry the read; this adds
                     // hot gas tongues and rare embers (heat haze: fx/status.js, main bells only)
    { shape: 'spark', count: [0, 1], life: [0.08, 0.14], speed: [30, 60], dirMode: 'dir', cone: 8, size: [0.12, 0.05], stretch: 0.012, color0: HOT, color1: HOT_D, heat: [1, 0.5], inherit: 0.85 },
    { shape: 'puff', count: [0, 1], life: [0.06, 0.1], speed: [40, 60], dirMode: 'dir', cone: 4, size: [1.4, 3.2], stretch: 0.03, color0: SOOT, alpha: [0.9, 0], heat: [1.0, 0.5], add: [1, 0.85], erode: [0.08, 0.55], inherit: 0.9, spin: [-4, 4], variant: BILLOW, nosoft: true },
  ],
  qb_jet: [          // per opposite-facing nozzle on a quick boost (fx/status.js): exit flash only; the
                     // white-hot directional JET itself is fx.jet (status.js qbJets), smoke left behind
    { shape: 'glow', count: [1, 1], life: [0.04, 0.05], size: [1.9, 1.0], color0: [3.2, 2.1, 0.9], alpha: [0.85, 0], heat: [1, 1], nosoft: true },
    { shape: 'star', count: [1, 1], life: [0.03, 0.036], size: [1.4, 1.6], color0: [4.6, 3.6, 2.4], variant: [0, 3], nosoft: true },
    { shape: 'spark', count: [1, 2], life: [0.05, 0.09], speed: [50, 90], dirMode: 'dir', cone: 12, size: [0.16, 0.06], sizeVar: 0.5, stretch: 0.012, color0: [4.5, 2.4, 0.7], color1: [1.4, 0.35, 0.06], heat: [1, 0.5], drag: 5 },
    { shape: 'puff', count: [1, 2], life: [0.45, 0.8], speed: [10, 18], dirMode: 'dir', cone: 18, size: [1.0, 3.8], sizePow: 2.2, sizeVar: 0.3, color0: [0.16, 0.14, 0.125], alpha: [0.16, 0], fadeIn: 0.1, erode: [0.12, 0.6], drag: 4.5, rise: 0.6, turb: 1, lit: true, spin: [-1.5, 1.5], variant: WISP },
  ],
  qb_burst: [        // quick boost (once, beside the rig opposite the burst): brief warm flash, ash smoke,
                     // pressure ring + ground ring, refraction, light (no fire puffs: they read as a peach cloud)
    { shape: 'glow', count: [1, 1], life: [0.04, 0.05], size: [4.5, 2], color0: [2.6, 1.3, 0.4], alpha: [0.5, 0], heat: [0.6, 0.6], nosoft: true },
    { shape: 'flare', count: [1, 1], life: [0.03, 0.036], size: [9, 6], color0: [1.4, 0.75, 0.3], alpha: [0.3, 0], nosoft: true },
    { shape: 'spark', count: [2, 3], life: [0.06, 0.11], speed: [60, 110], dirMode: 'dir', cone: 16, size: [0.18, 0.07], sizeVar: 0.5, stretch: 0.012, color0: [4.5, 2.2, 0.6], color1: [1.4, 0.35, 0.06], heat: [1, 0.5], drag: 5, jitter: 0.6 },
    // exhaust smoke left hanging where the burst fired: ash, low alpha (never a beige cloud)
    { shape: 'puff', count: [4, 5], life: [0.6, 1.1], speed: [12, 24], dirMode: 'dir', cone: 26, size: [1.4, 5], sizePow: 2.4, sizeVar: 0.35, color0: [0.16, 0.14, 0.125], alpha: [0.16, 0], fadeIn: 0.08, erode: [0.14, 0.62], drag: 4.5, rise: 0.8, turb: 1.2, lit: true, spin: [-1.2, 1.2], jitter: 0.8, variant: WISP },
    { shape: 'ring', count: [1, 1], life: [0.12, 0.12], size: [1.5, 8], sizePow: 2, color0: [1.3, 0.95, 0.7], alpha: [0.18, 0], add: [1, 1], orient: 'dir', erode: [0.6, 0.6], scaleCount: false },
    { kind: 'distort', shape: 'ring', size: [2, 14], life: 0.22, strength: 0.7 },
    { kind: 'distort', shape: 'puff', size: [2.5, 5.5], life: 0.3, strength: 0.4, speed: 30, offset: 3 },
    { kind: 'light', color: [1, 0.6, 0.3], intensity: 260, range: 28, dur: 0.08 },
  ],

  qb_ground_ring: [  // quick boost near the slab (fx/status.js, at the feet): soft pressure ring, ~1 -> 9 m in 0.18 s
    { shape: 'ring', count: [1, 1], life: [0.18, 0.18], size: [1, 9], sizePow: 2, color0: [1.1, 0.9, 0.72], alpha: [0.25, 0], add: [0.6, 0.6], orient: 'up', erode: [0.8, 0.8], scaleCount: false },
  ],

  // ------------------------------------------------------------------ blade / stagger
  blade_arc: [       // legacy particle arc (the swept ribbon itself is drawn by fx/slash.js)
    { shape: 'glow', count: [1, 1], life: [0.06, 0.08], size: [3.5, 2], color0: [1.6, 2.3, 3.2], alpha: [0.7, 0], heat: [1, 1], nosoft: true },
    { kind: 'light', color: [0.5, 0.75, 1], intensity: 220, range: 30, dur: 0.18 },
  ],
  blade_hit: [       // slash connects: white-cyan flash, molten + electric sparks sprayed along the cut, ring
    { shape: 'glow', count: [1, 1], life: [0.05, 0.06], size: [4.6, 2.6], color0: [1.6, 2.3, 3.6], alpha: [0.7, 0], heat: [0.7, 0.7], nosoft: true },
    { shape: 'star', count: [1, 1], life: [0.04, 0.05], size: [7, 8], color0: [2.2, 3.0, 4.6], variant: [0, 3], nosoft: true },
    { shape: 'flare', count: [1, 1], life: [0.05, 0.06], size: [12, 9], color0: [0.6, 1.2, 2.2], alpha: [0.4, 0], nosoft: true },
    { shape: 'spark', count: [30, 40], life: [0.2, 0.6], speed: [30, 95], dirMode: 'hemi', size: [0.2, 0.07], sizeVar: 0.55, stretch: 0.028, color0: [5, 5.8, 7], color1: E_RIM, heat: [1, 0.3], gravity: 24, drag: 1.6, collide: true, bounce: 0.35 },
    { shape: 'spark', count: [12, 16], life: [0.25, 0.7], speed: [20, 65], dirMode: 'hemi', size: [0.2, 0.07], sizeVar: 0.55, stretch: 0.03, color0: HOT, color1: HOT_D, heat: [1, 0.3], gravity: 28, drag: 1.4, collide: true, bounce: 0.35 },
    { shape: 'glow', count: [6, 9], life: [0.4, 0.9], speed: [6, 18], dirMode: 'hemi', size: [0.3, 0.12], color0: [4, 1.6, 0.35], alpha: [1, 0], heat: [1, 0.4], gravity: 16, drag: 1.5, collide: true, bounce: 0.3 },
    { shape: 'ring', count: [1, 1], life: [0.16, 0.16], size: [2, 11], sizePow: 2, color0: E_RIM, alpha: [0.3, 0], add: [1, 1], erode: [0.5, 0.5], scaleCount: false },
    // dark smoke boiling off the cut
    { shape: 'puff', count: [4, 5], life: [1.2, 2.2], speed: [3, 9], dirMode: 'hemi', size: [1.5, 6], sizePow: 2.2, sizeVar: 0.3, color0: [0.12, 0.115, 0.11], alpha: [0.34, 0], fadeIn: 0.08, erode: [0.1, 0.68], drag: 2.4, rise: 2, turb: 1.5, lit: true, spin: [-1, 1], delay: [0.05, 0.15] },
    { kind: 'chunks', count: 4, speed: [12, 26], size: [0.2, 0.5], hot: 1 },
    { kind: 'distort', shape: 'ring', size: [2, 18], life: 0.25, strength: 0.55 },
    { kind: 'light', color: [0.55, 0.78, 1], intensity: 300, range: 30, dur: 0.16 },
  ],
  blade_edge: [      // (combat r4) one of 5 spawns along the cut (weapons.js): sparks thrown along the sweep
    { shape: 'spark', count: [9, 12], life: [0.25, 0.65], speed: [25, 70], dirMode: 'dir', cone: 32, size: [0.2, 0.06], sizeVar: 0.5, stretch: 0.03, color0: [5, 5.8, 7], color1: HOT_D, heat: [1, 0.3], gravity: 22, drag: 1.6, collide: true, bounce: 0.35, scaleCount: false },
    { shape: 'glow', count: [1, 1], life: [0.1, 0.14], size: [1.6, 0.9], color0: [2.6, 1.3, 0.4], alpha: [0.8, 0], heat: [1, 0.5], nosoft: true },
  ],
  blade_glow: [      // pulse-blade beam halo (spawned every step while the blade is lit)
    { shape: 'glow', count: [1, 1], life: [0.016, 0.016], size: [4.2, 4.2], color0: [0.5, 1.4, 3.0], alpha: [0.55, 0.4], heat: [0.5, 0.5], nosoft: true },
  ],
  stagger_burst: [   // ACS overload: electric flash + spark spray + ground shock + refraction (arcs: fx/status.js)
    { shape: 'glow', count: [1, 1], life: [0.07, 0.09], size: [7, 3.5], color0: [1.6, 2.5, 4.2], alpha: [0.85, 0], heat: [0.8, 0.8], nosoft: true },
    { shape: 'star', count: [1, 1], life: [0.035, 0.045], size: [6, 7], color0: [2.0, 2.8, 4.4], variant: [0, 3], nosoft: true },
    // (enemy-ai r3, critic: the flat 'up' ring spawned at chest height read edge-on as a screen-wide band) camera-facing, smaller, fainter
    { shape: 'ring', count: [1, 1], life: [0.24, 0.24], size: [2, 6], sizePow: 1.6, color0: [0.7, 1.5, 3.0], alpha: [0.12, 0], add: [1, 1], erode: [0.75, 0.75], scaleCount: false, nosoft: true },
    { shape: 'spark', count: [16, 22], life: [0.12, 0.45], speed: [12, 45], dirMode: 'sphere', size: [0.14, 0.05], sizeVar: 0.5, stretch: 0.022, color0: [4, 5.5, 8], color1: E_RIM, heat: [1, 0.3], gravity: 22, drag: 2.2, collide: true, bounce: 0.35 },
    { shape: 'spark', count: [6, 9], life: [0.25, 0.6], speed: [10, 30], dirMode: 'hemi', size: [0.16, 0.06], stretch: 0.025, color0: HOT, color1: HOT_D, heat: [1, 0.3], gravity: 26, drag: 1.5, collide: true, bounce: 0.35 },
    { shape: 'puff', count: [3, 4], life: [0.8, 1.4], speed: [2, 6], dirMode: 'up', cone: 60, size: [1.5, 5], sizePow: 2, color0: [0.18, 0.18, 0.19], alpha: [0.26, 0], fadeIn: 0.1, erode: [0.12, 0.7], drag: 2, rise: 1.5, turb: 1.4, lit: true, spin: [-1, 1] },
    { kind: 'distort', shape: 'ring', size: [2, 16], life: 0.3, strength: 0.5 },
    { kind: 'light', color: [0.5, 0.75, 1], intensity: 420, range: 32, dur: 0.28 },
  ],
  arc_spark: [       // tiny electrical spit (low-AP / staggered targets)
    { shape: 'spark', count: [4, 7], life: [0.08, 0.25], speed: [10, 35], dirMode: 'sphere', size: [0.12, 0.05], stretch: 0.035, color0: [4, 5, 7], color1: E_RIM, heat: [1, 0.5], gravity: 18, drag: 1.5 },
    { shape: 'glow', count: [1, 1], life: [0.05, 0.07], size: [1.4, 0.6], color0: [2.5, 3.5, 5.5], alpha: [1, 0], heat: [1, 1], nosoft: true },
  ],
  fire_lick: [       // low-AP burning damage: a small flipbook flame tongue + soot wisp
    { shape: 'fire', count: [1, 1], life: [0.4, 0.7], speed: [2, 5], dirMode: 'up', cone: 25, size: [1.2, 3.2], sizeVar: 0.3, color0: FB_SOOT, alpha: [1, 0], alphaPow: 1.5, heat: [1.05, 0.6], add: [0.9, 0.4], erode: [0.06, 0.4], rise: 2.5, turb: 2, lit: true },
    { shape: 'puff', count: [0, 1], life: [0.8, 1.4], speed: [1, 3], dirMode: 'up', cone: 25, size: [1, 3.5], sizePow: 1.6, color0: [0.05, 0.047, 0.045], alpha: [0.4, 0], fadeIn: 0.15, erode: [0.1, 0.68], rise: 3, turb: 1.8, lit: true, spin: [-1, 1], variant: BILLOW, delay: [0.15, 0.3] },
  ],

  // ------------------------------------------------------------------ projectile trails
  missile_trail: [   // puffs that fill out the ribbon (fx/trails.js draws the continuous core)
    // emitted by DISTANCE (weapons.js trailStep, ~1.8 m): overlapping, so each puff is faint
    { shape: 'puff', count: [1, 1], life: [2.2, 3.4], speed: [0.3, 1.8], dirMode: 'sphere', size: [0.9, 5.4], sizePow: 1.6, sizeVar: 0.4, color0: MSMOKE0, color1: MSMOKE1, colPow: 0.55, alpha: [0.26, 0], fadeIn: 0.04, erode: [0.1, 0.66], drag: 1, rise: 0.5, turb: 1.6, wind: 2, lit: true, spin: [-0.3, 0.3] },
  ],
  shell_trail: [     // heavy cannon slug: short hot wake + thin smoke
    { shape: 'puff', count: [1, 1], life: [0.6, 1.1], speed: [0.5, 2], dirMode: 'sphere', size: [0.6, 2.4], sizePow: 2, color0: [0.34, 0.32, 0.3], alpha: [0.24, 0], erode: [0.12, 0.66], drag: 1.2, rise: 0.4, turb: 1.2, lit: true, heat: [0.5, 0], coolPow: 6, spin: [-1, 1], variant: WISP },
    { shape: 'glow', count: [1, 1], life: [0.08, 0.12], speed: [0, 0], size: [1.6, 0.6], color0: [3, 1.4, 0.4], alpha: [0.8, 0], heat: [1, 1] },
  ],
  tracer: [
    { shape: 'spark', count: [1, 1], life: [0.08, 0.08], speed: [300, 300], dirMode: 'dir', cone: 0, size: [0.3, 0.3], color0: [4, 2.6, 0.8], stretch: 0.03, heat: [1, 1] },
  ],
};

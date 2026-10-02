// src/audio/sfx.js — layered procedural SFX recipes (owner: audio designer).
//
// Each entry of SFX is DATA (mix metadata) + a render(ac, out, t, r) recipe that builds a
// node graph on any BaseAudioContext starting at absolute time t (r = seeded PRNG, so every
// round-robin variant differs a little). audio.js pre-renders `variants` buffers per id into
// OfflineAudioContexts at unlock and plays those (cheap, sample-accurate); until a buffer is
// ready the recipe runs live instead. tools/audio_sheet.mjs renders the very same recipes.
//
// Frequency plan (benchmark §3.8: readable = bands separated):
//   sub 25-90 Hz ....... explosions, cannon, landings, footfalls (weight)
//   low-mid 90-900 Hz .. gun bodies, booster roar, servo, music bass
//   mid 1-4 kHz ........ gun cracks, mechanical clacks, whoosh peaks
//   high 2-6 kHz ....... UI / FCS chirps ONLY sit here as pure tones (never masked by noise)
//
// Metadata
//   bus     'sfx' | 'impact' (not ducked, triggers ducks) | 'ui' (dry, centred) | 'stinger'
//   spatial panned + distance-attenuated from opts.pos (default true for sfx / impact)
//   ref     PannerNode refDistance (m) — how far the sound stays at full level
//   send    reverb send (0..1); distance adds more
//   prio    0..10 voice-steal priority;  max  concurrent voices of this id;  gap  min seconds between plays
//   pv / vv per-play pitch variance (cents) / volume variance (dB);  variants  round-robin count
//   dur     rendered length (s);  gain  mix level;  duck [depth, hold, release] ducks music + sfx
//   delay   speed-of-sound delay for distant sources (explosions)
//   layers  [[t, label], ...] documentation only: layer onsets, drawn on tools/audio_sheet.mjs
import {
  gain, filt, chain, shaper, thump, noiseHit, modal, fm, crackle, whoosh, tone, tremolo, noiseSrc, sweep, points, nwave,
  resonator, brass, ringMod, makeRng, hashStr, normalizeBuffer, midiHz,
} from './dsp.js';

// Reusable metal part sets (Hz, amp, decay s) — tuned by ear to read as heavy steel.
const CLACK_BOLT = [[1850, 0.5, 0.03], [2930, 0.35, 0.045], [4410, 0.22, 0.025], [6230, 0.12, 0.018]];
const FRAME_STEEL = [[182, 0.6, 0.42], [291, 0.45, 0.36], [466, 0.34, 0.28], [757, 0.22, 0.2], [1213, 0.12, 0.14]];
const PLATE = [[421, 0.6, 0.22], [786, 0.45, 0.16], [1233, 0.3, 0.12], [1897, 0.18, 0.08]];

function detuned(parts, r, cents) { return parts.map(([f, a, d]) => [f * r.cents(cents), a * r.range(0.8, 1.15), d * r.range(0.85, 1.15)]); }

const SCRAP = [1, 1.59, 2.14, 2.83, 3.9]; // inharmonic plate-mode ratios (each mode ±15 % per strike)

/**
 * Scatter n debris impacts between t0 and t1: torn plate and girder chunks (noise-excited
 * resonators: gritty bands, never pure pings), concrete lumps (dull low thuds) and a grit
 * crackle under each landing.
 */
function debris(ac, out, t, r, n, t0, t1, heavy, g) {
  for (let i = 0; i < n; i++) {
    const u = Math.pow(r(), 1.4), tt = t + t0 + (t1 - t0) * u;
    const kind = r();
    const vol = g * r.range(0.25, 0.8) * (1 - 0.6 * u); // later pieces are smaller / farther
    if (heavy && kind < 0.35) {        // girder / armour chunk: low, long, heavy
      thump(ac, out, tt, { f0: r.range(110, 160), f1: 60, sweep: 0.04, dur: 0.12, gain: vol * 1.1 });
      resonator(ac, out, tt, r, { f: r.range(170, 420), ratios: SCRAP, Q: [14, 30], decay: [0.08, 0.25], burstF: 1400, gain: vol * 1.2 });
    } else if (kind < 0.62) {           // torn plate / bolt fragment: mid-high clank, short
      resonator(ac, out, tt, r, { f: r.range(700, 1900), ratios: SCRAP, Q: [12, 24], decay: [0.04, 0.12], burstF: 3200, gain: vol * 0.75 });
    } else {                           // concrete lump: dull thud + chip, no ring
      thump(ac, out, tt, { f0: r.range(130, 200), f1: 70, sweep: 0.03, dur: 0.06, gain: vol * 0.7 });
      noiseHit(ac, out, tt, r, { kind: 'pink', type: 'bandpass', f0: r.range(700, 1500), Q: 1.1, attack: 0.0005, decay: 0.05, gain: vol * 0.9 });
    }
    crackle(ac, out, tt + 0.002, r, { type: 'bandpass', f: r.range(2500, 4500), Q: 0.8, attack: 0.002, decay: r.range(0.05, 0.14), gain: vol * 0.45 }); // grit
  }
}

// foot plate modes (Hz 421/786/1233/1897 as ratios) and the leg frame
const PLATE_R = [1, 1.867, 2.929, 4.506], FRAME_R = [1, 1.6, 2.56, 4.16, 6.66];
const FOOT_MIX = { thud: 0.5, frame: 0.9, plate: 1.0, plateSteel: 1.1, clank: 2.4, clankRing: 1.9, deck: 0.9, servo: 0.2 };

/** Rig footfall: shared by footstep (concrete) and footstep_steel (deck). */
function footfall(ac, out, t, r, steel) {
  const pre = gain(ac, 0.9); chain(pre, shaper(ac, 2.4), out);
  thump(ac, pre, t, { f0: steel ? 82 : 70, f1: steel ? 46 : 36, sweep: 0.07, dur: steel ? 0.12 : 0.16, gain: steel ? 0.45 : FOOT_MIX.thud });
  noiseHit(ac, pre, t, r, { kind: 'pink', type: 'lowpass', f0: 1400, f1: 220, attack: 0.001, decay: steel ? 0.05 : 0.08, gain: steel ? 0.6 : 1.0 });
  if (!steel) noiseHit(ac, pre, t, r, { kind: 'white', type: 'bandpass', f0: 820, f1: 380, Q: 0.8, attack: 0.0008, decay: 0.09, gain: 0.55 }); // concrete crunch
  const M = FOOT_MIX;
  resonator(ac, out, t + 0.003, r, { f: 150 * r.range(0.92, 1.08), ratios: FRAME_R, Q: [14, 30], decay: [0.08, 0.22], burstF: 900, gain: M.frame });              // leg frame
  resonator(ac, out, t + 0.002, r, { f: 421 * r.range(0.94, 1.06), ratios: PLATE_R, Q: [16, 30], decay: steel ? [0.12, 0.38] : [0.05, 0.18], burstF: 1800, gain: steel ? M.plateSteel : M.plate }); // foot plate
  noiseHit(ac, out, t + 0.001, r, { kind: 'white', type: 'bandpass', f0: 2000 * r.range(0.9, 1.1), Q: 1.1, attack: 0.0004, decay: 0.03, gain: M.clank });      // sole clank 1.1-3.6 kHz
  resonator(ac, out, t + 0.001, r, { f: 1100 * r.range(0.95, 1.05), ratios: [1, 1.73, 2.42, 3.27], Q: [12, 22], decay: [0.03, 0.08], burstF: 2600, gain: M.clankRing });
  if (steel) resonator(ac, out, t + 0.004, r, { f: 92 * r.range(0.9, 1.1), ratios: [1, 1.52, 2.27], Q: [18, 30], decay: [0.18, 0.42], burstF: 600, gain: M.deck }); // hollow deck
  crackle(ac, out, t + 0.005, r, { type: 'lowpass', f: 2500, attack: 0.002, decay: steel ? 0.06 : 0.12, gain: steel ? 0.18 : 0.34 });                          // grit
  tone(ac, out, t + 0.03, { type: 'sawtooth', f0: 900 * r.range(0.94, 1.06), f1: 700, fdur: 0.09, attack: 0.012, decay: r.range(0.06, 0.11), bp: [900, 760, 4], gain: M.servo }); // ankle servo
  noiseHit(ac, out, t + 0.05, r, { kind: 'white', type: 'highpass', f0: 4200, attack: 0.02, decay: 0.1, gain: 0.06 });                                       // hydraulic hiss
}

export const SFX = {
  // ------------------------------------------------------------------ player weapons
  rifle: {
    bus: 'sfx', ref: 22, send: 0.3, prio: 6, max: 6, gap: 0.03, pv: 70, vv: 1.5, variants: 4, dur: 0.8, gain: 0.62,
    layers: [[0, 'N-wave+crack'], [0.001, 'sub punch'], [0.034, 'bolt clack'], [0.12, 'air tail']],
    render(ac, out, t, r) {
      const dr = shaper(ac, 2.4, 0.08); const pre = gain(ac, 0.8); chain(pre, dr, out);
      nwave(ac, out, t, 1.3 * r.range(0.9, 1.1), 0.75);                                                                           // shock front
      noiseHit(ac, out, t, r, { kind: 'white', type: 'highpass', f0: 2600, Q: 0.7, attack: 0.0004, decay: 0.02, gain: 1.1 });     // crack
      noiseHit(ac, pre, t, r, { kind: 'white', type: 'bandpass', f0: 1900 * r.range(0.9, 1.1), f1: 1100, Q: 1.0, attack: 0.0006, decay: 0.055, gain: 2.3 }); // mid snap (cuts through the booster roar)
      noiseHit(ac, pre, t, r, { kind: 'white', type: 'bandpass', f0: 950 * r.range(0.9, 1.1), f1: 520, Q: 0.8, attack: 0.0008, decay: 0.07, gain: 1.6 }); // blast (low-mid punch)
      noiseHit(ac, pre, t, r, { kind: 'pink', type: 'lowpass', f0: 6500, f1: 700, Q: 0.9, attack: 0.001, decay: 0.1, gain: 1.5 }); // blast body
      thump(ac, pre, t, { f0: 160 * r.range(0.95, 1.05), f1: 52, sweep: 0.05, dur: 0.11, gain: 0.85 });                         // sub punch
      tone(ac, pre, t, { type: 'square', f0: 96, f1: 58, decay: 0.08, lp: [900, 300, 0.8], gain: 0.2 });                          // chest
      modal(ac, out, t + r.range(0.028, 0.04), r, { partials: detuned(CLACK_BOLT, r, 60), gain: 0.32, clickF: 4200 });         // bolt clack
      noiseHit(ac, out, t + 0.008, r, { kind: 'brown', type: 'lowpass', f0: 950, f1: 120, attack: 0.012, decay: 0.55, gain: 0.5 }); // air tail
    },
  },
  enemy_gun: {
    bus: 'sfx', ref: 26, send: 0.35, prio: 4, max: 8, gap: 0.035, pv: 90, vv: 2, variants: 4, dur: 0.6, gain: 0.5,
    render(ac, out, t, r) {
      const pre = gain(ac, 0.8); chain(pre, shaper(ac, 2), out);
      nwave(ac, out, t, 0.9 * r.range(0.9, 1.1), 0.6);
      noiseHit(ac, out, t, r, { kind: 'white', type: 'highpass', f0: 3200, attack: 0.0004, decay: 0.012, gain: 0.8 });
      noiseHit(ac, pre, t, r, { kind: 'pink', type: 'lowpass', f0: 5200, f1: 700, Q: 1.1, attack: 0.001, decay: 0.08, gain: 1 });
      noiseHit(ac, pre, t, r, { kind: 'white', type: 'bandpass', f0: 2300 * r.range(0.9, 1.1), f1: 1400, Q: 1.4, attack: 0.0006, decay: 0.035, gain: 1.2 });
      thump(ac, pre, t, { f0: 210 * r.range(0.92, 1.08), f1: 80, sweep: 0.05, dur: 0.09, gain: 0.55 });
      modal(ac, out, t + r.range(0.02, 0.03), r, { partials: [[2380, 0.4, 0.025], [3710, 0.3, 0.02], [5200, 0.2, 0.015]], gain: 0.14 });
      noiseHit(ac, out, t + 0.005, r, { kind: 'brown', type: 'lowpass', f0: 1200, f1: 200, attack: 0.01, decay: 0.35, gain: 0.35 });
    },
  },
  enemy_laser: {
    bus: 'sfx', ref: 24, send: 0.3, prio: 4, max: 6, gap: 0.04, pv: 110, vv: 2, variants: 3, dur: 0.5, gain: 0.34,
    render(ac, out, t, r) {
      fm(ac, out, t, { f: 2300 * r.range(0.95, 1.05), f1: 380, fdur: 0.16, ratio: 1.5, idx0: 2.5, idx1: 0.2, decay: 0.2, gain: 0.45, type: 'sawtooth' });
      tone(ac, out, t, { type: 'sine', f0: 5200, f1: 2900, decay: 0.05, gain: 0.12 });
      crackle(ac, out, t, r, { type: 'bandpass', f: 3400, Q: 0.9, attack: 0.002, decay: 0.22, gain: 0.5 });
      thump(ac, out, t, { f0: 280, f1: 90, sweep: 0.06, dur: 0.12, gain: 0.5 });
    },
  },
  blade: {
    bus: 'sfx', ref: 20, send: 0.25, prio: 7, max: 2, gap: 0.1, pv: 50, vv: 1, variants: 3, dur: 0.95, gain: 0.62,
    layers: [[0, 'plasma ignition'], [0.12, 'arc whoosh'], [0.4, 'hum decay']],
    render(ac, out, t, r) {
      // plasma ignition hum: two detuned saws + sub-octave square, filter opens then settles
      const g = gain(ac, 0);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.7, t + 0.03);
      g.gain.setTargetAtTime(0.45, t + 0.1, 0.1); g.gain.setTargetAtTime(0, t + 0.42, 0.09);
      const f = filt(ac, 'lowpass', 400, 4);
      f.frequency.setValueAtTime(400, t); f.frequency.exponentialRampToValueAtTime(4200, t + 0.12); f.frequency.exponentialRampToValueAtTime(900, t + 0.6);
      const hp = filt(ac, 'highpass', 90, 0.7);
      chain(f, shaper(ac, 2.6), hp, g, out);
      for (const [type, fr, dt, a] of [['sawtooth', 110, 0, 1], ['sawtooth', 110, 14, 1], ['square', 55, 0, 0.35]]) {
        const o = ac.createOscillator(); o.type = type; o.frequency.value = fr * r.cents(15); o.detune.value = dt;
        const og = gain(ac, a); chain(o, og, f); o.start(t); o.stop(t + 0.95);
      }
      whoosh(ac, out, t, r, { f0: 450, f1: 3400, f2: 800, Q: 1.3, attack: 0.12, decay: 0.38, gain: 0.8 });
      crackle(ac, out, t + 0.02, r, { type: 'highpass', f: 3000, attack: 0.03, decay: 0.45, gain: 0.35 });
      tone(ac, out, t, { type: 'sine', f0: 880, f1: 1750, fdur: 0.3, attack: 0.05, decay: 0.35, gain: 0.08 });
    },
  },
  blade_hit: {
    bus: 'impact', ref: 30, send: 0.4, prio: 9, max: 2, gap: 0.08, pv: 40, vv: 1, variants: 3, dur: 1.6, gain: 0.85,
    layers: [[0, 'sub thump+burn'], [0, 'FM metal shear'], [0.02, 'plasma sizzle']],
    duck: [0.38, 0.2, 0.8],
    render(ac, out, t, r) {
      const pre = gain(ac, 0.9); chain(pre, shaper(ac, 3.2, 0.1), out);
      thump(ac, pre, t, { f0: 88, f1: 30, sweep: 0.2, dur: 0.45, gain: 0.7 });
      noiseHit(ac, pre, t, r, { kind: 'pink', type: 'lowpass', f0: 7500, f1: 800, attack: 0.001, decay: 0.28, gain: 1.4 });
      fm(ac, out, t, { f: 1150 * r.range(0.95, 1.05), ratio: 1.414, idx0: 4, idx1: 0.4, decay: 0.7, gain: 0.36 });
      modal(ac, out, t, r, { partials: [[640, 0.5, 0.5], [1370, 0.4, 0.4], [2210, 0.3, 0.3], [3480, 0.2, 0.22]], gain: 0.42, detune: 40, grit: 0.45 });
      crackle(ac, out, t, r, { type: 'bandpass', f: 2100, Q: 0.8, attack: 0.003, decay: 0.65, gain: 0.75 });
      noiseHit(ac, out, t + 0.02, r, { kind: 'white', type: 'highpass', f0: 4800, attack: 0.02, decay: 0.7, gain: 0.18 });
    },
  },
  missile_launch: {
    bus: 'sfx', ref: 22, send: 0.3, prio: 5, max: 8, gap: 0.02, pv: 130, vv: 2, variants: 4, dur: 1.1, gain: 0.46,
    layers: [[0, 'tube pop'], [0.01, 'ignition'], [0.2, 'motor whoosh + flutter']],
    render(ac, out, t, r) {
      thump(ac, out, t, { f0: 190, f1: 70, sweep: 0.04, dur: 0.07, gain: 0.7 });                                              // tube pop
      noiseHit(ac, out, t, r, { kind: 'white', type: 'highpass', f0: 900, attack: 0.0005, decay: 0.035, gain: 0.7 });
      crackle(ac, out, t + 0.01, r, { type: 'bandpass', f: 2600, Q: 0.8, attack: 0.005, decay: 0.16, gain: 0.5 });          // ignition
      whoosh(ac, out, t + 0.015, r, { f0: 700, f1: 2700 * r.range(0.9, 1.1), f2: 1300, Q: 1.4, attack: 0.18, decay: 0.7, gain: 0.8 });
      const am = tremolo(ac, t, 1, 36 * r.range(0.9, 1.1), 0.5, 'square');                                               // rocket flutter
      am.connect(out);
      noiseHit(ac, am, t + 0.02, r, { kind: 'brown', type: 'lowpass', f0: 1200, f1: 480, attack: 0.03, decay: 0.75, gain: 0.8 });
    },
  },
  cannon: {
    bus: 'impact', ref: 32, send: 0.45, prio: 9, max: 2, gap: 0.2, pv: 40, vv: 1, variants: 3, dur: 2.6, gain: 0.95,
    duck: [0.42, 0.22, 0.9],
    layers: [[0, 'shock+sub boom'], [0.16, 'breech clank'], [0.55, 'casing clinks'], [1.0, 'rumble']],
    render(ac, out, t, r) {
      const pre = gain(ac, 0.85); chain(pre, shaper(ac, 3, 0.1), out);
      nwave(ac, out, t, 2.6, 0.9);                                                                                         // shock front
      noiseHit(ac, out, t, r, { kind: 'white', type: 'highpass', f0: 1900, attack: 0.0004, decay: 0.03, gain: 1.2 });           // crack
      noiseHit(ac, pre, t, r, { kind: 'white', type: 'bandpass', f0: 1100, f1: 420, Q: 0.7, attack: 0.0006, decay: 0.14, gain: 1.4 }); // mid blast
      noiseHit(ac, pre, t, r, { kind: 'pink', type: 'lowpass', f0: 5600, f1: 220, Q: 0.8, attack: 0.001, decay: 0.6, gain: 2.0 }); // blast
      thump(ac, pre, t, { f0: 74, f1: 28, sweep: 0.25, dur: 0.7, gain: 0.9 });                                              // sub
      tone(ac, pre, t, { type: 'sawtooth', f0: 58, f1: 34, decay: 0.38, lp: [420, 160, 0.9], gain: 0.5 });                  // chest
      modal(ac, out, t, r, { partials: [[311, 0.5, 0.7], [846, 0.35, 0.5], [1593, 0.2, 0.4]], gain: 0.07, click: 0, grit: 0.5 });       // barrel ring
      const tb = t + 0.16 + r.range(-0.01, 0.02);                                                                            // breech clank
      thump(ac, out, tb, { f0: 150, f1: 95, sweep: 0.03, dur: 0.06, gain: 0.35 });
      modal(ac, out, tb, r, { partials: detuned([[720, 0.6, 0.14], [1183, 0.45, 0.12], [1962, 0.35, 0.09], [2871, 0.2, 0.06]], r, 40), gain: 0.3, grit: 0.7 });
      const te = t + 0.55 + r.range(0, 0.06);                                                                                // casing clinks
      modal(ac, out, te, r, { partials: detuned([[2950, 0.5, 0.3], [4420, 0.35, 0.24], [6610, 0.2, 0.16]], r, 50), gain: 0.1, clickF: 6000, grit: 0.45, gritQ: 45 });
      modal(ac, out, te + 0.16, r, { partials: detuned([[3010, 0.5, 0.2], [4510, 0.3, 0.15]], r, 50), gain: 0.05, clickF: 6000, grit: 0.45, gritQ: 45 });
      noiseHit(ac, out, t + 0.02, r, { kind: 'brown', type: 'lowpass', f0: 320, f1: 60, attack: 0.05, decay: 1.7, gain: 0.8 }); // rumble
    },
  },
  reload: {
    bus: 'sfx', ref: 14, send: 0.15, prio: 3, max: 2, gap: 0.2, pv: 40, vv: 1, variants: 3, dur: 0.6, gain: 0.34,
    layers: [[0, 'latch'], [0.05, 'mag slide'], [0.24, 'seat'], [0.35, 'bolt']],
    render(ac, out, t, r) {
      modal(ac, out, t, r, { partials: detuned([[1620, 0.5, 0.05], [2710, 0.4, 0.04], [4130, 0.25, 0.03]], r, 50), gain: 0.4, grit: 0.6 });
      noiseHit(ac, out, t + 0.05, r, { kind: 'white', type: 'bandpass', f0: 900, f1: 1900, Q: 2.5, attack: 0.03, decay: 0.15, gain: 0.55 }); // magazine slides out/in
      crackle(ac, out, t + 0.05, r, { type: 'bandpass', f: 2400, Q: 0.9, attack: 0.02, decay: 0.16, gain: 0.3 });                   // rail friction
      tone(ac, out, t + 0.06, { type: 'sawtooth', f0: 300, f1: 420, decay: 0.14, bp: [700, 900, 4], attack: 0.02, gain: 0.06 });     // feed servo (faint)
      thump(ac, out, t + 0.24, { f0: 180, f1: 110, sweep: 0.03, dur: 0.05, gain: 0.5 });
      modal(ac, out, t + 0.24, r, { partials: detuned([[980, 0.6, 0.08], [1720, 0.45, 0.06], [2960, 0.3, 0.04]], r, 50), gain: 0.5, grit: 0.6 });
      resonator(ac, out, t + 0.35, r, { f: 2300, ratios: [1, 1.43, 2.2], Q: [12, 22], decay: [0.02, 0.05], burstF: 4500, gain: 0.35 });
    },
  },

  // ------------------------------------------------------------------ explosions
  explosion_small: {
    bus: 'sfx', ref: 30, send: 0.42, prio: 6, max: 6, gap: 0.03, pv: 120, vv: 2, variants: 4, dur: 1.8, gain: 0.72,
    delay: true, duck: [0.7, 0.1, 0.45],
    layers: [[0, 'crack+low boom'], [0.02, 'fire crackle'], [0.15, 'debris'], [0.6, 'rumble']],
    render(ac, out, t, r) {
      const pre = gain(ac, 0.85); chain(pre, shaper(ac, 2.8, 0.1), out);
      noiseHit(ac, out, t, r, { kind: 'white', type: 'highpass', f0: 1500, attack: 0.0005, decay: 0.03, gain: 0.9 });
      thump(ac, pre, t, { f0: 96 * r.range(0.9, 1.1), f1: 34, sweep: 0.14, dur: 0.36, gain: 0.8 });
      noiseHit(ac, pre, t, r, { kind: 'white', type: 'bandpass', f0: 1300, f1: 500, Q: 0.7, attack: 0.001, decay: 0.2, gain: 1.1 });  // crunch
      noiseHit(ac, pre, t, r, { kind: 'pink', type: 'lowpass', f0: 3800, f1: 300, attack: 0.002, decay: 0.62, gain: 1.5 });
      crackle(ac, out, t + 0.015, r, { type: 'highpass', f: 1300, attack: 0.02, decay: 0.95, gain: 0.62 });
      debris(ac, out, t, r, 6 + Math.floor(r() * 4), 0.12, 0.9, false, 0.13);
      noiseHit(ac, out, t + 0.03, r, { kind: 'brown', type: 'lowpass', f0: 260, f1: 90, attack: 0.04, decay: 1.1, gain: 0.55 });
    },
  },
  explosion_large: {
    bus: 'impact', ref: 45, send: 0.5, prio: 10, max: 4, gap: 0.05, pv: 80, vv: 1.5, variants: 4, dur: 4.2, gain: 1.0,
    delay: true, duck: [0.22, 0.4, 1.5],
    layers: [[0, 'blast+sub boom'], [0.1, 'crackle'], [0.2, 'debris rain'], [0.8, 'delayed rumble']],
    render(ac, out, t, r) {
      const pre = gain(ac, 0.9); chain(pre, shaper(ac, 3.6, 0.12), out);
      noiseHit(ac, out, t, r, { kind: 'white', type: 'highpass', f0: 1000, attack: 0.0005, decay: 0.05, gain: 1 });
      thump(ac, pre, t, { f0: 64 * r.range(0.92, 1.08), f1: 26, sweep: 0.4, dur: 1.1, gain: 0.85 });
      noiseHit(ac, pre, t, r, { kind: 'white', type: 'bandpass', f0: 1000, f1: 320, Q: 0.6, attack: 0.002, decay: 0.38, gain: 1.6 });  // crunch
      noiseHit(ac, pre, t, r, { kind: 'pink', type: 'lowpass', f0: 2600, f1: 160, attack: 0.004, decay: 1.35, gain: 2.0 });
      noiseHit(ac, out, t + 0.01, r, { kind: 'brown', type: 'lowpass', f0: 760, f1: 80, attack: 0.03, decay: 2.7, gain: 0.6 });
      crackle(ac, out, t + 0.02, r, { type: 'highpass', f: 900, attack: 0.03, decay: 1.9, gain: 0.66 });
      crackle(ac, out, t + 0.1, r, { type: 'bandpass', f: 420, Q: 0.8, attack: 0.1, decay: 1.6, gain: 0.5, rate: 0.6 });
      debris(ac, out, t, r, 15 + Math.floor(r() * 5), 0.18, 2.4, true, 0.15);
      noiseHit(ac, out, t + 0.35, r, { kind: 'brown', type: 'lowpass', f0: 170, f1: 70, attack: 0.45, decay: 2.9, gain: 0.7 }); // delayed rumble
    },
  },

  // ------------------------------------------------------------------ bullet impacts / flybys
  // (played by audio.js from 'projectile:impact' and from the projectile pool scan)
  impact_metal: {
    bus: 'sfx', ref: 14, send: 0.28, prio: 4, max: 5, gap: 0.025, pv: 140, vv: 2.5, variants: 5, dur: 0.5, gain: 0.5,
    layers: [[0, 'crack'], [0.002, 'armour ping'], [0.01, 'sparks']],
    render(ac, out, t, r) {
      const pre = gain(ac, 0.8); chain(pre, shaper(ac, 2.6, 0.1), out);
      nwave(ac, out, t, 0.5, 0.5);                                                                                            // slug strike
      noiseHit(ac, out, t, r, { kind: 'white', type: 'highpass', f0: 3800, attack: 0.0003, decay: 0.008, gain: 0.8 });
      const b = r.range(1150, 1700);                                                                                          // inharmonic plate modes
      modal(ac, out, t + 0.001, r, { partials: [[b, 0.55, 0.09], [b * 1.59, 0.4, 0.07], [b * 2.38, 0.3, 0.05], [b * 3.71, 0.18, 0.035]], gain: 0.7, clickF: 5200, grit: 0.35, gritQ: 40 });
      thump(ac, pre, t, { f0: 300, f1: 140, sweep: 0.02, dur: 0.045, gain: 0.35 });                                           // plate mass
      noiseHit(ac, pre, t, r, { kind: 'pink', type: 'bandpass', f0: 1400, f1: 600, Q: 1.1, attack: 0.0005, decay: 0.05, gain: 0.9 });
      crackle(ac, out, t + 0.008, r, { type: 'highpass', f: 3400, attack: 0.004, decay: 0.16, gain: 0.32 });                 // spark shower
    },
  },
  impact_ground: {
    bus: 'sfx', ref: 12, send: 0.3, prio: 2, max: 4, gap: 0.03, pv: 160, vv: 3, variants: 4, dur: 0.6, gain: 0.42,
    layers: [[0, 'chip+thud'], [0.02, 'grit'], [0.08, 'gravel patter']],
    render(ac, out, t, r) {
      const pre = gain(ac, 0.9); chain(pre, shaper(ac, 2.2), out);
      noiseHit(ac, out, t, r, { kind: 'white', type: 'bandpass', f0: 2600, Q: 0.8, attack: 0.0004, decay: 0.016, gain: 1.4 }); // concrete chip
      thump(ac, pre, t, { f0: 160, f1: 70, sweep: 0.03, dur: 0.07, gain: 0.35 });                                            // thud
      noiseHit(ac, pre, t, r, { kind: 'pink', type: 'lowpass', f0: 2800, f1: 300, attack: 0.001, decay: 0.09, gain: 1 });       // dirt burst
      crackle(ac, out, t + 0.02, r, { type: 'lowpass', f: 4500, attack: 0.02, decay: 0.32, gain: 0.45, rate: 0.8 });         // grit rain
      for (let i = 0; i < 3; i++) modal(ac, out, t + 0.06 + r() * 0.25, r, { partials: [[r.range(2500, 5200), 0.5, 0.012]], gain: 0.05, click: 0.3, clickF: 4000 });
    },
  },
  ricochet: {
    bus: 'sfx', ref: 14, send: 0.35, prio: 3, max: 2, gap: 0.12, pv: 200, vv: 2, variants: 4, dur: 0.7, gain: 0.3,
    layers: [[0, 'strike'], [0.005, 'tumbling-slug whine']],
    render(ac, out, t, r) {
      noiseHit(ac, out, t, r, { kind: 'white', type: 'highpass', f0: 3000, attack: 0.0003, decay: 0.006, gain: 0.8 });
      const f0 = r.range(3600, 5200), f1 = f0 * r.range(0.35, 0.5);
      fm(ac, out, t + 0.004, { f: f0, f1, fdur: 0.42, ratio: 1.41, idx0: 0.35, idx1: 0.08, decay: 0.45, attack: 0.01, gain: 0.35 });
      whoosh(ac, out, t, r, { f0: f0 * 0.9, f1, Q: 6, attack: 0.01, decay: 0.4, gain: 0.25, kind: 'white' });
    },
  },
  whiz: {
    bus: 'sfx', ref: 5, send: 0.15, prio: 5, max: 3, gap: 0.035, pv: 120, vv: 2, variants: 4, dur: 0.35, gain: 0.42,
    layers: [[0, 'Mach snap'], [0.03, 'air tear (doppler fall)']],
    render(ac, out, t, r) {
      nwave(ac, out, t, 0.45, 0.55);                                                                                          // supersonic snap
      noiseHit(ac, out, t, r, { kind: 'white', type: 'highpass', f0: 5000, attack: 0.0003, decay: 0.005, gain: 0.7 });
      whoosh(ac, out, t, r, { f0: 4200, f1: 3400 * r.range(0.9, 1.1), f2: 800, Q: 2.2, attack: 0.03, decay: 0.18, gain: 0.9, kind: 'white' });
      tone(ac, out, t + 0.01, { type: 'sine', f0: 3100, f1: 1300, fdur: 0.14, attack: 0.01, decay: 0.15, gain: 0.08 });
    },
  },

  // ------------------------------------------------------------------ hits / state
  hit_confirm: {
    bus: 'ui', spatial: false, prio: 3, max: 2, gap: 0.05, pv: 30, vv: 1, variants: 2, dur: 0.12, gain: 0.2,
    render(ac, out, t, r) {
      tone(ac, out, t, { f0: 3100, decay: 0.03, gain: 0.5 });
      tone(ac, out, t + 0.004, { f0: 4650, decay: 0.022, gain: 0.25 });
      noiseHit(ac, out, t, r, { kind: 'white', type: 'bandpass', f0: 6000, Q: 1, attack: 0.0003, decay: 0.004, gain: 0.4 });
    },
  },
  kill_confirm: {
    // FCS "target destroyed": relay clack + two falling ring-modulated telemetry blips (cockpit
    // electronics, not a chime), band-limited to the UI band
    bus: 'ui', spatial: false, prio: 5, max: 2, gap: 0.1, pv: 0, vv: 0.5, variants: 1, dur: 0.35, gain: 0.22,
    layers: [[0, 'relay clack'], [0.004, 'RM blip 1'], [0.072, 'RM blip 2']],
    render(ac, out, t, r) {
      const rm = ringMod(ac, t, 0.3, 97, 'square');
      const bp = filt(ac, 'bandpass', 1900, 1.1), lp = filt(ac, 'lowpass', 4200, 0.7);
      const dry = gain(ac, 0.35);
      chain(rm, bp, lp, out); chain(dry, lp);
      const blip = (tt, f, d) => { const g = tone(ac, rm, tt, { type: 'square', f0: f, decay: d, attack: 0.002, gain: 0.55 }); g.connect(dry); };
      blip(t + 0.004, 1760, 0.045);
      blip(t + 0.072, 1318, 0.11);
      noiseHit(ac, out, t, r, { kind: 'white', type: 'bandpass', f0: 4600, Q: 1.2, attack: 0.0003, decay: 0.004, gain: 0.35 });
      resonator(ac, out, t, r, { f: 900, ratios: [1, 1.73, 2.6], Q: [14, 22], decay: [0.015, 0.035], burstF: 2600, gain: 0.35 }); // relay clack
    },
  },
  damage_taken: {
    bus: 'sfx', spatial: false, send: 0.15, prio: 7, max: 3, gap: 0.06, pv: 80, vv: 2, variants: 4, dur: 0.5, gain: 0.55,
    layers: [[0, 'hull thud'], [0, 'plate ring'], [0.001, 'crackle']],
    render(ac, out, t, r) {
      const pre = gain(ac, 0.8); chain(pre, shaper(ac, 3), out);
      thump(ac, pre, t, { f0: 135, f1: 60, sweep: 0.05, dur: 0.11, gain: 0.6 });
      noiseHit(ac, pre, t, r, { kind: 'pink', type: 'lowpass', f0: 4200, f1: 800, attack: 0.0006, decay: 0.08, gain: 0.9 });
      modal(ac, out, t, r, { partials: detuned(PLATE, r, 70), gain: 0.8, grit: 0.55 });
      crackle(ac, out, t, r, { type: 'highpass', f: 2000, attack: 0.001, decay: 0.2, gain: 0.4 });
    },
  },
  stagger: {
    bus: 'impact', ref: 30, send: 0.35, prio: 8, max: 2, gap: 0.2, pv: 30, vv: 1, variants: 2, dur: 1.3, gain: 0.7,
    duck: [0.6, 0.1, 0.5],
    render(ac, out, t, r) {
      const pre = gain(ac, 0.8); chain(pre, shaper(ac, 3), out);
      thump(ac, pre, t, { f0: 92, f1: 36, sweep: 0.15, dur: 0.28, gain: 0.55 });
      noiseHit(ac, pre, t, r, { kind: 'pink', type: 'lowpass', f0: 5000, f1: 600, attack: 0.001, decay: 0.15, gain: 1.1 });
      const am = tremolo(ac, t, 1.2, 17, 0.9, 'square'); am.connect(out);
      crackle(ac, am, t, r, { type: 'bandpass', f: 1500, Q: 0.8, attack: 0.005, decay: 0.7, gain: 0.7 });
      const am2 = tremolo(ac, t, 1.2, 23, 0.8); am2.connect(pre);
      tone(ac, am2, t + 0.02, { type: 'sawtooth', f0: 1100, f1: 140, fdur: 0.75, decay: 0.8, bp: [1200, 300, 2.5], gain: 0.35 });
      tone(ac, out, t + 0.05, { type: 'triangle', f0: 640, f1: 210, decay: 0.55, gain: 0.1 });
    },
  },

  // ------------------------------------------------------------------ movement
  qb: {
    bus: 'sfx', ref: 24, send: 0.3, prio: 8, max: 3, gap: 0.05, pv: 80, vv: 1.2, variants: 4, dur: 0.8, gain: 0.8,
    layers: [[0, 'air slam+thump'], [0.004, 'jet whoosh'], [0.05, 'turbine zip']],
    render(ac, out, t, r) {
      const pre = gain(ac, 0.85); chain(pre, shaper(ac, 2.4, 0.1), out);
      noiseHit(ac, pre, t, r, { kind: 'white', type: 'highpass', f0: 380, attack: 0.0008, decay: 0.055, gain: 1 });           // air slam
      thump(ac, pre, t, { f0: 115 * r.range(0.95, 1.05), f1: 42, sweep: 0.06, dur: 0.13, gain: 0.85 });                       // thump
      whoosh(ac, out, t + 0.004, r, { f0: 1700, f1: 1900, f2: 480, Q: 0.9, attack: 0.012, decay: 0.42, gain: 1.3 });          // jet whoosh
      noiseHit(ac, out, t + 0.002, r, { kind: 'white', type: 'highpass', f0: 2400, attack: 0.004, decay: 0.24, gain: 0.42 }); // compressed-air hiss
      noiseHit(ac, pre, t + 0.003, r, { kind: 'brown', type: 'lowpass', f0: 1900, f1: 280, attack: 0.006, decay: 0.48, gain: 0.7 }); // roar
      crackle(ac, out, t, r, { type: 'highpass', f: 2600, attack: 0.002, decay: 0.13, gain: 0.35 });                         // igniter
      tone(ac, out, t, { type: 'sawtooth', f0: 430, f1: 175, decay: 0.26, bp: [1200, 500, 3.5], gain: 0.12 });              // turbine zip
    },
  },
  jump: {
    bus: 'sfx', ref: 20, send: 0.25, prio: 5, max: 2, gap: 0.08, pv: 60, vv: 1, variants: 3, dur: 0.7, gain: 0.5,
    render(ac, out, t, r) {
      thump(ac, out, t, { f0: 92, f1: 52, sweep: 0.06, dur: 0.12, gain: 0.8 });
      whoosh(ac, out, t, r, { f0: 380, f1: 1350, f2: 700, Q: 1.1, attack: 0.05, decay: 0.4, gain: 0.7 });
      noiseHit(ac, out, t, r, { kind: 'brown', type: 'lowpass', f0: 1300, f1: 400, attack: 0.02, decay: 0.45, gain: 0.7 });
      crackle(ac, out, t, r, { type: 'highpass', f: 2400, attack: 0.005, decay: 0.12, gain: 0.25 });
    },
  },
  land: {
    bus: 'sfx', ref: 20, send: 0.3, prio: 6, max: 2, gap: 0.12, pv: 60, vv: 1, variants: 4, dur: 1.1, gain: 0.78,
    layers: [[0, 'sub thud'], [0.004, 'frame steel ring'], [0.06, 'servo sigh'], [0.09, 'hydraulic bleed']],
    render(ac, out, t, r) {
      const pre = gain(ac, 0.9); chain(pre, shaper(ac, 2.8, 0.1), out);
      thump(ac, pre, t, { f0: 78, f1: 30, sweep: 0.12, dur: 0.32, gain: 0.9 });
      noiseHit(ac, pre, t, r, { kind: 'pink', type: 'lowpass', f0: 1600, f1: 200, attack: 0.001, decay: 0.13, gain: 1 });
      modal(ac, out, t + 0.004, r, { partials: detuned(FRAME_STEEL, r, 60), gain: 0.7, clickF: 1600, grit: 0.6 });
      noiseHit(ac, pre, t, r, { kind: 'white', type: 'bandpass', f0: 800, f1: 400, Q: 0.7, attack: 0.001, decay: 0.12, gain: 0.7 }); // concrete crunch
      crackle(ac, out, t + 0.01, r, { type: 'lowpass', f: 3200, attack: 0.004, decay: 0.3, gain: 0.45 });                  // grit
      noiseHit(ac, out, t + 0.09, r, { kind: 'white', type: 'highpass', f0: 3600, attack: 0.05, decay: 0.5, gain: 0.1 });  // hydraulic bleed
      tone(ac, out, t + 0.06, { type: 'sawtooth', f0: 260, f1: 180, attack: 0.03, decay: 0.3, bp: [700, 500, 4], gain: 0.08 }); // servo sigh
    },
  },
  footstep: {
    // 60 t rig foot on CONCRETE: sub thud + crunch, leg frame + foot plate ring (noise-excited,
    // so the metal reads as mass, not pings), a 1.1-3.6 kHz sole clank and the ankle servo whine
    bus: 'sfx', ref: 14, send: 0.22, prio: 4, max: 3, gap: 0.12, pv: 70, vv: 1.5, variants: 5, dur: 0.6, gain: 0.58,
    layers: [[0, 'thud+crunch'], [0.002, 'sole clank'], [0.003, 'frame+plate'], [0.03, 'servo whine'], [0.05, 'hiss']],
    render(ac, out, t, r) { footfall(ac, out, t, r, false); },
  },
  footstep_steel: {
    // the same foot on a STEEL deck (containers, gantries, the carrier): less crunch, a hollow
    // deck boom and a longer plate ring
    bus: 'sfx', ref: 16, send: 0.28, prio: 4, max: 3, gap: 0.12, pv: 70, vv: 1.5, variants: 4, dur: 0.8, gain: 0.6,
    layers: [[0, 'thud'], [0.002, 'sole clank'], [0.003, 'deck boom+plate'], [0.03, 'servo whine']],
    render(ac, out, t, r) { footfall(ac, out, t, r, true); },
  },
  boost_ignite: {
    bus: 'sfx', ref: 20, send: 0.22, prio: 4, max: 2, gap: 0.2, pv: 60, vv: 1, variants: 3, dur: 0.6, gain: 0.42,
    render(ac, out, t, r) {
      thump(ac, out, t, { f0: 120, f1: 60, sweep: 0.04, dur: 0.08, gain: 0.5 });
      crackle(ac, out, t, r, { type: 'bandpass', f: 2800, Q: 0.8, attack: 0.002, decay: 0.12, gain: 0.45 });
      whoosh(ac, out, t, r, { f0: 600, f1: 2300, f2: 900, Q: 1, attack: 0.04, decay: 0.35, gain: 0.7 });
    },
  },
  ab_start: {
    bus: 'sfx', ref: 24, send: 0.3, prio: 8, max: 1, gap: 0.3, pv: 30, vv: 0.5, variants: 2, dur: 1.6, gain: 0.72,
    layers: [[0, 'turbine spool-up'], [0.58, 'ignition boom']],
    render(ac, out, t, r) {
      const W = 0.58; // matches MOVE.abIgnition wind-up
      const g = gain(ac, 0);
      g.gain.setValueAtTime(0.02, t); g.gain.exponentialRampToValueAtTime(0.5, t + W); g.gain.setTargetAtTime(0, t + W, 0.12);
      const bp = filt(ac, 'bandpass', 500, 3);
      sweep(bp.frequency, t, 500, 2600, W);
      chain(bp, shaper(ac, 2), g, out);
      for (const dt of [0, 9, -7]) {
        const o = ac.createOscillator(); o.type = 'sawtooth'; o.detune.value = dt;
        sweep(o.frequency, t, 150, 860, W); o.connect(bp); o.start(t); o.stop(t + W + 0.6);
      }
      const ng = gain(ac, 0);
      ng.gain.setValueAtTime(0.02, t); ng.gain.exponentialRampToValueAtTime(0.7, t + W); ng.gain.setTargetAtTime(0, t + W, 0.08);
      const nb = filt(ac, 'bandpass', 600, 1.2); sweep(nb.frequency, t, 600, 3400, W);
      chain(noiseSrc(ac, 'pink', t, W + 0.5, r), nb, ng, out);
      crackle(ac, out, t + W * 0.5, r, { type: 'highpass', f: 3000, attack: W * 0.5, decay: 0.1, gain: 0.35 });
      // ignition boom at launch
      const pre = gain(ac, 0.9); chain(pre, shaper(ac, 2.6), out);
      thump(ac, pre, t + W, { f0: 80, f1: 30, sweep: 0.12, dur: 0.4, gain: 1.2 });
      noiseHit(ac, pre, t + W, r, { kind: 'brown', type: 'lowpass', f0: 2600, f1: 500, attack: 0.004, decay: 0.85, gain: 1 });
      noiseHit(ac, out, t + W, r, { kind: 'white', type: 'highpass', f0: 600, attack: 0.001, decay: 0.08, gain: 0.7 });
    },
  },

  // ------------------------------------------------------------------ FCS / cockpit alerts (UI band)
  lock: {
    bus: 'ui', spatial: false, prio: 4, max: 1, gap: 0.08, pv: 0, vv: 0, variants: 1, dur: 0.16, gain: 0.2,
    render(ac, out, t) {
      tone(ac, out, t, { f0: 2093, decay: 0.035, gain: 0.5, type: 'square', lp: [5200, 5200, 0.7] });
      tone(ac, out, t + 0.06, { f0: 2637, decay: 0.05, gain: 0.5, type: 'square', lp: [5200, 5200, 0.7] });
    },
  },
  lock_switch: {
    bus: 'ui', spatial: false, prio: 4, max: 1, gap: 0.06, pv: 0, vv: 0, variants: 1, dur: 0.1, gain: 0.18,
    render(ac, out, t, r) {
      tone(ac, out, t, { f0: 1500, f1: 2350, fdur: 0.04, decay: 0.05, gain: 0.5, type: 'triangle' });
      noiseHit(ac, out, t, r, { kind: 'white', type: 'bandpass', f0: 5000, Q: 1, attack: 0.0003, decay: 0.004, gain: 0.3 });
    },
  },
  missile_lock: {
    bus: 'ui', spatial: false, prio: 4, max: 2, gap: 0.04, pv: 0, vv: 0, variants: 1, dur: 0.08, gain: 0.16,
    render(ac, out, t) { tone(ac, out, t, { f0: 2960, decay: 0.028, gain: 0.5, type: 'triangle' }); },
  },
  missile_alert: {
    bus: 'ui', spatial: false, prio: 9, max: 1, gap: 0.2, pv: 0, vv: 0, variants: 1, dur: 0.24, gain: 0.26,
    render(ac, out, t) {
      for (const dt of [0, 0.11]) tone(ac, out, t + dt, { f0: 1245, decay: 0.06, gain: 0.5, type: 'square', lp: [3200, 3200, 0.7] });
    },
  },
  en_depleted: {
    bus: 'ui', spatial: false, prio: 8, max: 1, gap: 0.5, pv: 0, vv: 0, variants: 1, dur: 0.9, gain: 0.34,
    render(ac, out, t, r) {
      tone(ac, out, t, { type: 'sawtooth', f0: 520, f1: 85, fdur: 0.55, decay: 0.6, lp: [1800, 300, 1], gain: 0.4 });
      for (const [dt, f] of [[0, 466], [0.17, 370]]) tone(ac, out, t + dt, { type: 'square', f0: f, decay: 0.1, attack: 0.004, bp: [1200, 1200, 1.2], gain: 0.5 });
      noiseHit(ac, out, t + 0.3, r, { kind: 'white', type: 'highpass', f0: 3000, attack: 0.05, decay: 0.4, gain: 0.08 });
    },
  },
  ap_warning: {
    bus: 'ui', spatial: false, prio: 8, max: 1, gap: 1, pv: 0, vv: 0, variants: 1, dur: 0.5, gain: 0.22,
    render(ac, out, t) {
      for (const [dt, f] of [[0, 659], [0.2, 494]]) tone(ac, out, t + dt, { type: 'square', f0: f, attack: 0.004, decay: 0.16, lp: [2400, 2400, 0.7], gain: 0.5 });
    },
  },
  repair: {
    // field repair kit: injector clamps on, hydraulic sealant bleeds off, ratchet x3, clamp seats,
    // ONE low system confirm tone (machinery, not an arpeggio)
    bus: 'ui', spatial: false, send: 0.2, prio: 6, max: 1, gap: 0.4, pv: 0, vv: 0, variants: 1, dur: 1.0, gain: 0.36,
    layers: [[0, 'hydraulic bleed'], [0.06, 'ratchet x3'], [0.3, 'clamp seat'], [0.38, 'confirm tone']],
    render(ac, out, t, r) {
      noiseHit(ac, out, t, r, { kind: 'white', type: 'highpass', f0: 2500, attack: 0.015, decay: 0.42, gain: 0.3 });              // bleed
      noiseHit(ac, out, t, r, { kind: 'white', type: 'bandpass', f0: 5400, f1: 2600, Q: 1.4, attack: 0.02, decay: 0.36, gain: 0.22 }); // pressure falls
      for (let i = 0; i < 3; i++) {
        const tt = t + 0.06 + i * 0.075;
        resonator(ac, out, tt, r, { f: 1650 * (1 + i * 0.04), ratios: [1, 1.62, 2.3, 3.1], Q: [14, 26], decay: [0.02, 0.06], burstF: 4200, gain: 0.5 });
        thump(ac, out, tt, { f0: 240, f1: 150, sweep: 0.01, dur: 0.025, gain: 0.28 });
      }
      thump(ac, out, t + 0.3, { f0: 150, f1: 80, sweep: 0.03, dur: 0.08, gain: 0.5 });                                               // clamp seats
      resonator(ac, out, t + 0.3, r, { f: 360, ratios: SCRAP, Q: [14, 24], decay: [0.06, 0.14], burstF: 1200, gain: 0.45 });
      tone(ac, out, t + 0.38, { type: 'square', f0: 440, decay: 0.3, attack: 0.006, lp: [1500, 800, 0.8], gain: 0.2 });           // confirm
      tone(ac, out, t + 0.38, { type: 'sine', f0: 880, decay: 0.16, attack: 0.006, gain: 0.05 });
    },
  },
  alarm: {
    bus: 'ui', spatial: false, send: 0.15, prio: 9, max: 1, gap: 0.8, pv: 0, vv: 0, variants: 1, dur: 1.6, gain: 0.3,
    render(ac, out, t) {
      const bp = filt(ac, 'bandpass', 1400, 0.9); const sat = shaper(ac, 2.5); chain(bp, sat, out);
      for (let i = 0; i < 8; i++) {
        const f = i % 2 ? 587 : 740;
        tone(ac, bp, t + i * 0.18, { type: 'square', f0: f, attack: 0.006, decay: 0.17, gain: 0.55 });
      }
    },
  },
  objective: {
    bus: 'stinger', spatial: false, send: 0.3, prio: 8, max: 1, gap: 0.5, pv: 0, vv: 0, variants: 1, dur: 1.6, gain: 0.34,
    render(ac, out, t, r) {
      noiseHit(ac, out, t, r, { kind: 'white', type: 'bandpass', f0: 2600, Q: 0.8, attack: 0.001, decay: 0.03, gain: 0.25 }); // squelch blip
      fm(ac, out, t + 0.03, { f: 784, ratio: 3.5, idx0: 1.2, idx1: 0.05, decay: 0.8, gain: 0.35 });
      fm(ac, out, t + 0.2, { f: 1175, ratio: 3.5, idx0: 1.2, idx1: 0.05, decay: 1.1, gain: 0.35 });
      tone(ac, out, t, { type: 'sawtooth', f0: midiHz(50), detune: 9, attack: 0.3, decay: 1.1, lp: [300, 900, 0.8], gain: 0.2 });
    },
  },
  objective_tick: {
    bus: 'ui', spatial: false, prio: 5, max: 2, gap: 0.05, pv: 0, vv: 0, variants: 1, dur: 0.12, gain: 0.2,
    render(ac, out, t, r) {
      tone(ac, out, t, { f0: 1760, decay: 0.045, gain: 0.5 });
      tone(ac, out, t, { f0: 3520, decay: 0.025, gain: 0.2 });
      noiseHit(ac, out, t, r, { kind: 'white', type: 'bandpass', f0: 4500, Q: 1, attack: 0.0003, decay: 0.003, gain: 0.3 });
    },
  },

  // ------------------------------------------------------------------ mission stingers (stereo)
  mission_complete: {
    bus: 'stinger', spatial: false, stereo: true, send: 0.45, prio: 10, max: 1, gap: 2, pv: 0, vv: 0, variants: 1, dur: 5.5, gain: 0.62,
    duck: [0.25, 3.5, 1.5],
    render(ac, out, t, r) {
      const pre = gain(ac, 0.8); chain(pre, shaper(ac, 2.5), out);
      thump(ac, pre, t, { f0: 62, f1: 29, sweep: 0.3, dur: 1.1, gain: 1.1 });
      noiseHit(ac, pre, t, r, { kind: 'pink', type: 'lowpass', f0: 2200, f1: 100, attack: 0.003, decay: 1.2, gain: 0.8 });
      // D major add9 swell (Picardy resolution of the D-minor score)
      const notes = [50, 57, 62, 66, 69, 76];
      notes.forEach((m, i) => {
        const pan = ac.createStereoPanner(); pan.pan.value = (i / (notes.length - 1)) * 1.2 - 0.6; pan.connect(out);
        const g = gain(ac, 0);
        g.gain.setValueAtTime(0, t + 0.12); g.gain.linearRampToValueAtTime(0.16, t + 0.7); g.gain.setTargetAtTime(0, t + 2.6, 0.7);
        const f = filt(ac, 'lowpass', 300, 0.8); points(f.frequency, t + 0.12, [[0, 300, 's'], [0.9, 2600, 'e'], [3.5, 700, 'e']]);
        chain(f, g, pan);
        for (const dt of [-8, 7]) { const o = ac.createOscillator(); o.type = 'sawtooth'; o.frequency.value = midiHz(m); o.detune.value = dt; o.connect(f); o.start(t); o.stop(t + 5.4); }
      });
      fm(ac, out, t + 0.35, { f: midiHz(81), ratio: 3.5, idx0: 1.4, idx1: 0.05, decay: 2.2, gain: 0.18 });
      fm(ac, out, t + 0.55, { f: midiHz(86), ratio: 3.5, idx0: 1.2, idx1: 0.05, decay: 2.4, gain: 0.14 });
    },
  },
  boss_stinger: {
    bus: 'stinger', spatial: false, stereo: true, send: 0.5, prio: 10, max: 1, gap: 5, pv: 0, vv: 0, variants: 1, dur: 4.5, gain: 0.6,
    layers: [[0, 'noise swell'], [0.85, 'hit + phrygian brass']],
    duck: [0.3, 1.2, 1.2],
    render(ac, out, t, r) {
      const S = 0.85; // swell length: the hit lands on the boss reveal
      const sw = noiseSrc(ac, 'white', t, S + 0.05, r), bp = filt(ac, 'bandpass', 400, 1.2);
      sweep(bp.frequency, t, 400, 7000, S);
      const sg = gain(ac, 0); sg.gain.setValueAtTime(0, t); sg.gain.linearRampToValueAtTime(0.35, t + S * 0.85); sg.gain.linearRampToValueAtTime(0.6, t + S - 0.01); sg.gain.setValueAtTime(0, t + S);
      chain(sw, bp, sg, out);
      const h = t + S;
      const pre = gain(ac, 0.85); chain(pre, shaper(ac, 3), out);
      thump(ac, pre, h, { f0: 70, f1: 24, sweep: 0.35, dur: 1.4, gain: 1.2 });
      noiseHit(ac, pre, h, r, { kind: 'pink', type: 'lowpass', f0: 3000, f1: 120, attack: 0.002, decay: 1.2, gain: 0.8 });
      // FM brass cluster stab D-Eb-A-D (phrygian), wide: 2 players per note (ensemble spread)
      [38, 50, 51, 57, 62].forEach((m, i) => {
        const pan = ac.createStereoPanner(); pan.pan.value = (i - 2) * 0.28; pan.connect(out);
        for (const det of [-6, 7]) {
          brass(ac, pan, h + r.range(0, 0.012), r, { f: midiHz(m) * Math.pow(2, det / 1200), dur: 1.5, release: 0.9, gain: 0.07, idx: m < 45 ? 2.6 : 3.5, blat: 0.06, scoop: 45 });
        }
      });
      modal(ac, out, h, r, { partials: [[97, 0.6, 2.4], [232, 0.45, 1.8], [366, 0.3, 1.2], [591, 0.2, 0.8]], gain: 0.35, clickF: 1500 });
    },
  },
  mission_failed: {
    bus: 'stinger', spatial: false, stereo: true, send: 0.45, prio: 10, max: 1, gap: 2, pv: 0, vv: 0, variants: 1, dur: 5.5, gain: 0.62,
    duck: [0.25, 3.5, 1.5],
    render(ac, out, t, r) {
      const pre = gain(ac, 0.8); chain(pre, shaper(ac, 3), out);
      thump(ac, pre, t, { f0: 55, f1: 21, sweep: 0.5, dur: 1.4, gain: 1.2 });
      noiseHit(ac, pre, t, r, { kind: 'brown', type: 'lowpass', f0: 900, f1: 60, attack: 0.01, decay: 2.2, gain: 0.8 });
      // dissonant cluster D / Eb / G# / A that sags a minor third (dying reactor)
      [38, 39, 44, 45, 50].forEach((m, i) => {
        const pan = ac.createStereoPanner(); pan.pan.value = (i % 2 ? 1 : -1) * 0.25 * (i + 1) / 2; pan.connect(out);
        const g = gain(ac, 0);
        g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.16, t + 0.25); g.gain.setTargetAtTime(0, t + 2.8, 0.8);
        const f = filt(ac, 'lowpass', 1400, 1.5); sweep(f.frequency, t, 1400, 180, 4.5);
        chain(f, shaper(ac, 2), g, pan);
        const o = ac.createOscillator(); o.type = 'sawtooth'; o.frequency.value = midiHz(m);
        o.detune.setValueAtTime(0, t + 0.3); o.detune.linearRampToValueAtTime(-300, t + 4.8);
        o.connect(f); o.start(t); o.stop(t + 5.4);
      });
      fm(ac, out, t + 0.1, { f: 300, f1: 170, fdur: 3, ratio: 2.73, idx0: 2, idx1: 0.4, decay: 3.2, attack: 0.6, gain: 0.12 });
    },
  },

  // ------------------------------------------------------------------ menus (UI band, short)
  ui_select: {
    bus: 'ui', spatial: false, prio: 2, max: 2, gap: 0.03, pv: 20, vv: 0.5, variants: 2, dur: 0.06, gain: 0.14,
    render(ac, out, t, r) {
      tone(ac, out, t, { f0: 2600, decay: 0.014, gain: 0.5 });
      noiseHit(ac, out, t, r, { kind: 'white', type: 'highpass', f0: 4000, attack: 0.0003, decay: 0.004, gain: 0.35 });
    },
  },
  ui_confirm: {
    bus: 'ui', spatial: false, send: 0.1, prio: 5, max: 1, gap: 0.05, pv: 0, vv: 0, variants: 1, dur: 0.35, gain: 0.3,
    render(ac, out, t, r) {
      thump(ac, out, t, { f0: 170, f1: 90, sweep: 0.03, dur: 0.06, gain: 0.55 });
      modal(ac, out, t, r, { partials: [[323, 0.6, 0.08], [611, 0.4, 0.06], [1042, 0.3, 0.05]], gain: 0.3, clickF: 2500 });
      tone(ac, out, t + 0.01, { f0: 1800, f1: 2700, fdur: 0.04, decay: 0.06, gain: 0.3, type: 'triangle' });
      tone(ac, out, t + 0.08, { f0: 2700, decay: 0.08, gain: 0.25, type: 'triangle' });
    },
  },

  // ------------------------------------------------------------------ comms / ambience (internal ids)
  radio_open: {
    bus: 'voice', spatial: false, prio: 6, max: 1, gap: 0.1, pv: 30, vv: 0, variants: 2, dur: 0.12, gain: 0.3,
    render(ac, out, t, r) {
      tone(ac, out, t, { f0: 1900, decay: 0.03, gain: 0.25, type: 'square', lp: [3000, 3000, 0.7] });
      noiseHit(ac, out, t + 0.02, r, { kind: 'white', type: 'bandpass', f0: 2300, Q: 0.7, attack: 0.001, decay: 0.07, gain: 0.5 });
    },
  },
  radio_close: {
    bus: 'voice', spatial: false, prio: 6, max: 1, gap: 0.1, pv: 30, vv: 0, variants: 2, dur: 0.2, gain: 0.3,
    render(ac, out, t, r) {
      noiseHit(ac, out, t, r, { kind: 'white', type: 'bandpass', f0: 1800, Q: 0.6, attack: 0.002, decay: 0.14, gain: 0.55 });
      tone(ac, out, t + 0.1, { f0: 1400, decay: 0.03, gain: 0.2, type: 'square', lp: [2600, 2600, 0.7] });
    },
  },
  distant_clang: {
    bus: 'sfx', ref: 60, send: 0.9, prio: 1, max: 2, gap: 1.5, pv: 200, vv: 3, variants: 3, dur: 3.0, gain: 0.5,
    render(ac, out, t, r) {
      const base = r.range(95, 150);
      thump(ac, out, t, { f0: 90, f1: 45, sweep: 0.1, dur: 0.3, gain: 0.6 });
      modal(ac, out, t, r, { partials: [[base, 0.6, 2.2], [base * 2.39, 0.45, 1.6], [base * 3.77, 0.3, 1.1], [base * 6.1, 0.2, 0.6]], gain: 0.4, clickF: 1200, grit: 0.4, gritQ: 60 });
    },
  },
};

export const SFX_IDS = Object.keys(SFX);

/** Render order at unlock: what the player hears first renders first. */
export const PRERENDER_ORDER = [
  'ui_confirm', 'ui_select', 'rifle', 'qb', 'footstep', 'footstep_steel', 'land', 'boost_ignite', 'jump', 'enemy_gun', 'hit_confirm',
  'impact_metal', 'impact_ground', 'whiz',
  'explosion_small', 'missile_launch', 'cannon', 'explosion_large', 'lock', 'lock_switch', 'missile_lock', 'damage_taken',
  'ricochet',
  'blade', 'blade_hit', 'ab_start', 'enemy_laser', 'reload', 'objective_tick', 'objective', 'radio_open', 'radio_close',
  'alarm', 'missile_alert', 'ap_warning', 'en_depleted', 'stagger', 'repair', 'kill_confirm', 'distant_clang', 'boss_stinger', 'mission_complete', 'mission_failed',
];
for (const id of SFX_IDS) if (!PRERENDER_ORDER.includes(id)) PRERENDER_ORDER.push(id);

/**
 * Render one round-robin variant of `id` offline. Returns an AudioBuffer (peak-normalised to
 * 0.9, so `gain` alone sets the mix level). OAC = OfflineAudioContext constructor.
 */
export async function renderSfx(OAC, id, variant, sampleRate) {
  const def = SFX[id];
  const ch = def.stereo ? 2 : 1;
  const ac = new OAC(ch, Math.ceil(def.dur * sampleRate), sampleRate);
  const out = ac.createGain();
  // DC blocker + sub-sonic cut: the asymmetric (even-harmonic) shapers add DC that would only
  // eat limiter headroom and pump the glue compressor
  chain(out, filt(ac, 'highpass', 26, 0.6), ac.destination);
  def.render(ac, out, 0.001, makeRng(hashStr(id) * 7 + variant * 7919 + 1));
  const buf = await ac.startRendering();
  const peak = normalizeBuffer(buf, 0.9);
  return { buffer: buf, peak };
}

/** Live render (fallback while the variant bank is still rendering). */
export function renderSfxLive(ac, out, t, id, seed) {
  SFX[id].render(ac, out, t, makeRng(seed));
}

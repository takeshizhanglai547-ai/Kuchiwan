// src/audio/reverb.js — generated impulse responses (owner: audio designer).
//
// makeFoundryIR(ac, opts) builds a stereo IR for a ConvolverNode that models Pier 7: a huge,
// half-open industrial hall / refinery yard.
//   * early reflections: 18 sparse taps between 7 and 95 ms (walls, gantry legs, containers),
//     decorrelated left / right, each slightly low-passed
//   * slap echoes off far structures (blast furnace, sea wall) at ~0.2 / 0.36 / 0.55 s
//     (the "environmental echo tail" of gunfire), darker with every bounce
//   * late tail: three bands of noise with their own RT60 (lows ring longest, highs die
//     fast: steel + concrete + open sky) and a 45 ms build-up, so it never sounds like a
//     plate. A faint metallic comb (resonant sheds) colours the mid band.
// Pure JS arrays (no nodes) — cheap at unlock and deterministic.
import { makeRng } from './dsp.js';

export const FOUNDRY_IR = {
  seconds: 3.6,
  rt60: { low: 3.3, mid: 2.2, high: 0.85 },   // seconds per band
  split: { low: 380, high: 3200 },            // Hz band edges (one-pole)
  bandGain: { low: 1.0, mid: 0.8, high: 0.42 },
  buildUp: 0.045,
  early: { taps: 18, from: 0.007, to: 0.095, gain: 0.55 },
  echoes: [[0.205, 0.32, 2600], [0.365, 0.2, 1800], [0.55, 0.12, 1100]], // [t, gain, lowpass Hz]
  comb: { hz: 147, fb: 0.35 },
};

function onePoleCoef(fc, sr) { return 1 - Math.exp(-2 * Math.PI * fc / sr); }

export function makeFoundryIR(ac, o = FOUNDRY_IR, seed = 7) {
  const sr = ac.sampleRate;
  const n = Math.floor(o.seconds * sr);
  const buf = ac.createBuffer(2, n, sr);
  const aL = onePoleCoef(o.split.low, sr), aH = onePoleCoef(o.split.high, sr);
  const kLow = -6.9078 / (o.rt60.low * sr), kMid = -6.9078 / (o.rt60.mid * sr), kHigh = -6.9078 / (o.rt60.high * sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    const r = makeRng(seed * 131 + ch * 977);
    // --- late tail (3-band decay)
    let lpL = 0, lpH = 0;
    const comb = new Float32Array(Math.max(1, Math.floor(sr / o.comb.hz)));
    let ci = 0;
    const bu = o.buildUp * sr;
    for (let i = 0; i < n; i++) {
      const w = r() * 2 - 1;
      lpL += aL * (w - lpL); lpH += aH * (w - lpH);
      const low = lpL, mid = lpH - lpL, high = w - lpH;
      // metallic comb on the mid band
      const cm = mid + comb[ci] * o.comb.fb; comb[ci] = cm; ci = (ci + 1) % comb.length;
      let s = low * o.bandGain.low * Math.exp(kLow * i) + cm * o.bandGain.mid * Math.exp(kMid * i) + high * o.bandGain.high * Math.exp(kHigh * i);
      if (i < bu) s *= (i / bu) * (i / bu);
      d[i] = s * 0.32;
    }
    // --- early reflections
    for (let k = 0; k < o.early.taps; k++) {
      const tt = o.early.from + (o.early.to - o.early.from) * Math.pow(r(), 0.8);
      const idx = Math.floor(tt * sr);
      const amp = o.early.gain * (1 - (tt - o.early.from) / (o.early.to - o.early.from) * 0.7) * (0.5 + r() * 0.5) * r.sign();
      const smear = Math.floor(sr * (0.0004 + r() * 0.0012));
      for (let j = 0; j < smear && idx + j < n; j++) d[idx + j] += amp * Math.exp(-j / (smear * 0.35)) * (j === 0 ? 1 : 0.6);
    }
    // --- slap echoes off far structures (low-passed noise bursts ~6 ms)
    for (const [et, eg, lp] of o.echoes) {
      const idx = Math.floor((et + (ch ? 0.011 : 0) + r() * 0.004) * sr);
      const a = onePoleCoef(lp, sr);
      let y = 0;
      const len = Math.floor(sr * 0.03);
      for (let j = 0; j < len && idx + j < n; j++) {
        const x = j < sr * 0.004 ? (r() * 2 - 1) : 0;
        y += a * (x - y);
        d[idx + j] += y * eg * 3.2;
      }
    }
  }
  // energy normalisation: unit-ish RMS so wet level is controlled by the send gains
  let e = 0;
  for (let ch = 0; ch < 2; ch++) { const d = buf.getChannelData(ch); for (let i = 0; i < n; i++) e += d[i] * d[i]; }
  const k = 1 / Math.sqrt(e / 2 / (sr * 0.35));
  for (let ch = 0; ch < 2; ch++) { const d = buf.getChannelData(ch); for (let i = 0; i < n; i++) d[i] *= k * 0.18; }
  return buf;
}

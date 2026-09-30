// src/audio/beds.js — continuous sound beds driven every frame (owner: audio designer).
//
//   createJetBed(ac, dest, r)     booster: roar bed (brown noise, LP by thrust) + high hiss +
//                                 detuned turbine saws (pitch by speed) + compressor whine +
//                                 AM rumble (AB / hover flutter) + air rush by speed.
//                                 .set(targets, t, tau) glides every parameter.
//   jetTargets(m, out)            motor state -> targets (pure, allocation-free)
//   createServoBed(ac, dest)      actuator whine (torso / arm servos), driven by aim slew rate
//   createAmbience(ac, dest, r)   Pier 7 ash-storm wind, sea wash, foundry drone
//   renderBedDemo(OAC, name, sr)  offline demo for tools/audio_sheet.mjs
import { gain, filt, chain, shaper, noiseSrc, makeRng } from './dsp.js';

/** Per-mode booster targets (gains are pre-bus linear). Speeds in m/s. */
export const JET = {
  roarByMode: { idle: 0, walk: 0, boost: 0.3, hover: 0.5, air: 0.04, qb: 0.85, ab: 0.78, abCharge: 0.16, lunge: 0.7, stagger: 0, dead: 0 },
  hissByMode: { idle: 0, walk: 0, boost: 0.026, hover: 0.05, air: 0.02, qb: 0.22, ab: 0.16, abCharge: 0.12, lunge: 0.18, stagger: 0, dead: 0 },
  turbByMode: { idle: 0.022, walk: 0.028, boost: 0.075, hover: 0.08, air: 0.03, qb: 0.12, ab: 0.1, abCharge: 0.13, lunge: 0.1, stagger: 0.01, dead: 0 },
  roarCut: { base: 420, perMs: 13, qb: 2600, ab: 1900, hover: 950 },
  turbF: { base: 70, perMs: 1.55, abCharge: [150, 520] },
  whine: { base: 1150, perMs: 13, gain: 0.012, abGain: 0.026 },
  rumble: { ab: [27, 0.36], hover: [12, 0.22], qb: [34, 0.3], abCharge: [19, 0.3] },
  wind: { from: 18, span: 115, gain: 0.34, f0: 380, perMs: 16 },
};

export function makeJetTargets() {
  return { roar: 0, roarCut: 400, hiss: 0, turb: 0, turbF: 70, whine: 0, whineF: 1150, rumbleF: 12, rumble: 0, wind: 0, windF: 400 };
}

/**
 * m: {mode, speedH, vy, abCharging, abCharge, skid, grounded}. Writes into out, returns it.
 */
export function jetTargets(m, out) {
  const J = JET, sp = m.speedH || 0;
  let mode = m.mode || 'idle';
  if (mode === 'ab' && m.abCharging) mode = 'abCharge';
  if (mode === 'air' && (m.vy || 0) > 5) mode = 'hover'; // jump thrust
  out.roar = (J.roarByMode[mode] ?? 0) * (mode === 'boost' ? 0.75 + Math.min(1, sp / 90) * 0.45 + (m.skid || 0) * 0.3 : 1);
  out.hiss = (J.hissByMode[mode] ?? 0) * (mode === 'boost' ? 0.7 + Math.min(1, sp / 90) * 0.6 : 1);
  out.turb = J.turbByMode[mode] ?? 0;
  out.roarCut = mode === 'qb' || mode === 'lunge' ? J.roarCut.qb : mode === 'ab' ? J.roarCut.ab + Math.max(0, sp - 100) * 12
    : mode === 'hover' ? J.roarCut.hover : J.roarCut.base + sp * J.roarCut.perMs;
  if (mode === 'abCharge') {
    const k = Math.min(1, m.abCharge || 0);
    out.turbF = J.turbF.abCharge[0] + (J.turbF.abCharge[1] - J.turbF.abCharge[0]) * k * k;
    out.roarCut = 350 + 500 * k;
  } else out.turbF = J.turbF.base + sp * J.turbF.perMs + (mode === 'hover' ? 40 : 0);
  out.whineF = J.whine.base + sp * J.whine.perMs;
  out.whine = mode === 'ab' ? J.whine.abGain : mode === 'idle' || mode === 'walk' ? J.whine.gain * 0.35 : mode === 'dead' ? 0 : J.whine.gain;
  const ru = J.rumble[mode];
  out.rumbleF = ru ? ru[0] : 12; out.rumble = ru ? ru[1] : 0;
  const w = Math.max(0, Math.min(1, (sp - J.wind.from) / J.wind.span));
  out.wind = w * w * J.wind.gain;
  out.windF = J.wind.f0 + sp * J.wind.perMs;
  return out;
}

/** Booster bed graph. dest = bed bus (or a PannerNode for other rigs). */
export function createJetBed(ac, dest, r = makeRng(99), scale = 1) {
  const t = ac.currentTime;
  const out = gain(ac, scale);
  const bus = gain(ac, 1);
  chain(bus, shaper(ac, 1.7, 0.05), out, dest);
  // roar
  const roarSrc = noiseSrc(ac, 'brown', t, 1e6, r);
  const roarLP = filt(ac, 'lowpass', 400, 0.8);
  const roarAM = gain(ac, 1);
  const roarG = gain(ac, 0);
  chain(roarSrc, roarLP, roarAM, roarG, bus);
  const lfo = ac.createOscillator(); lfo.frequency.value = 12;
  const lfoG = gain(ac, 0);
  chain(lfo, lfoG); lfoG.connect(roarAM.gain);
  // hiss
  const hissSrc = noiseSrc(ac, 'white', t, 1e6, r);
  const hissHP = filt(ac, 'highpass', 3400, 0.7);
  const hissPk = filt(ac, 'peaking', 6500, 0.8, 4);
  const hissG = gain(ac, 0);
  chain(hissSrc, hissHP, hissPk, hissG, bus);
  // turbine (two detuned saws + a sub square) through a tracking bandpass
  const turbBP = filt(ac, 'bandpass', 180, 2.2);
  const turbG = gain(ac, 0);
  chain(turbBP, turbG, bus);
  const o1 = ac.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = 70;
  const o2 = ac.createOscillator(); o2.type = 'sawtooth'; o2.frequency.value = 70; o2.detune.value = 11;
  const o3 = ac.createOscillator(); o3.type = 'square'; o3.frequency.value = 35;
  const o3g = gain(ac, 0.35);
  o1.connect(turbBP); o2.connect(turbBP); chain(o3, o3g, turbBP);
  // compressor whine (sine with slight vibrato)
  const wh = ac.createOscillator(); wh.frequency.value = 1150;
  const vib = ac.createOscillator(); vib.frequency.value = 5.3;
  const vibG = gain(ac, 6);
  chain(vib, vibG); vibG.connect(wh.frequency);
  const whG = gain(ac, 0);
  chain(wh, whG, bus);
  // air rush
  const windSrc = noiseSrc(ac, 'pink', t, 1e6, r);
  const windBP = filt(ac, 'bandpass', 500, 0.55);
  const windG = gain(ac, 0);
  chain(windSrc, windBP, windG, out); // after the shaper: clean air
  for (const o of [lfo, o1, o2, o3, wh, vib]) o.start(t);

  const P = [roarG.gain, roarLP.frequency, hissG.gain, turbG.gain, o1.frequency, o2.frequency, o3.frequency, turbBP.frequency, whG.gain, wh.frequency, lfo.frequency, lfoG.gain, windG.gain, windBP.frequency];
  const last = new Float32Array(P.length).fill(-1);
  const put = (i, v, tt, tau) => {
    const lv = last[i];
    if (lv >= 0 && Math.abs(v - lv) <= Math.abs(lv) * 0.004 + 1e-5) return;
    last[i] = v; P[i].setTargetAtTime(v, tt, tau);
  };
  return {
    out,
    /** Glide to targets (from jetTargets) with time constant tau (s). */
    set(x, tt, tau = 0.08) {
      put(0, x.roar, tt, tau); put(1, x.roarCut, tt, tau * 1.2); put(2, x.hiss, tt, tau);
      put(3, x.turb, tt, tau * 1.5); put(4, x.turbF, tt, tau * 2.5); put(5, x.turbF, tt, tau * 2.5); put(6, x.turbF * 0.5, tt, tau * 2.5);
      put(7, x.turbF * 2.2, tt, tau * 2.5); put(8, x.whine, tt, tau * 2); put(9, x.whineF, tt, tau * 3);
      put(10, x.rumbleF, tt, tau); put(11, x.rumble, tt, tau); put(12, x.wind, tt, tau * 2); put(13, x.windF, tt, tau * 2);
    },
    stop(tt) { for (const s of [roarSrc, hissSrc, windSrc, lfo, o1, o2, o3, wh, vib]) { try { s.stop(tt); } catch (e) { /* already stopped */ } } },
  };
}

/** Servo / actuator whine: .set(amount 0..1, speed 0..1, t). */
export function createServoBed(ac, dest) {
  const t = ac.currentTime;
  const g = gain(ac, 0);
  const bp = filt(ac, 'bandpass', 900, 4.5);
  const pk = filt(ac, 'peaking', 2400, 3, 5);
  chain(bp, pk, g, dest);
  const a = ac.createOscillator(); a.type = 'sawtooth'; a.frequency.value = 420;
  const b = ac.createOscillator(); b.type = 'triangle'; b.frequency.value = 840; b.detune.value = 7;
  const bg = gain(ac, 0.6);
  const wob = ac.createOscillator(); wob.frequency.value = 31;
  const wobG = gain(ac, 9);
  chain(wob, wobG); wobG.connect(a.frequency);
  a.connect(bp); chain(b, bg, bp);
  for (const o of [a, b, wob]) o.start(t);
  let lastA = -1, lastS = -1;
  return {
    set(amount, speed, tt) {
      if (Math.abs(amount - lastA) > 0.004) { lastA = amount; g.gain.setTargetAtTime(amount * 0.11, tt, 0.05); }
      if (Math.abs(speed - lastS) > 0.01) {
        lastS = speed;
        const f = 380 + speed * 520;
        a.frequency.setTargetAtTime(f, tt, 0.07); b.frequency.setTargetAtTime(f * 2, tt, 0.07); bp.frequency.setTargetAtTime(f * 2.1, tt, 0.07);
      }
    },
  };
}

/** Pier 7 ambience: ash-storm wind (two slowly swept bands), sea wash, foundry drone. */
export function createAmbience(ac, dest, r = makeRng(1234)) {
  const t = ac.currentTime;
  const out = gain(ac, 1); out.connect(dest);
  const mkWind = (f, q, rate, depth, g0) => {
    const s = noiseSrc(ac, 'pink', t, 1e6, r);
    const bp = filt(ac, 'bandpass', f, q);
    const lfo = ac.createOscillator(); lfo.frequency.value = rate;
    const lg = gain(ac, depth); chain(lfo, lg); lg.connect(bp.frequency);
    const am = gain(ac, g0);
    const alfo = ac.createOscillator(); alfo.frequency.value = rate * 1.7;
    const ag = gain(ac, g0 * 0.5); chain(alfo, ag); ag.connect(am.gain);
    chain(s, bp, am, out);
    lfo.start(t); alfo.start(t);
  };
  mkWind(420, 0.7, 0.043, 160, 0.16);
  mkWind(1500, 1.4, 0.071, 500, 0.045); // gusty whistle through gantries
  // sea wash
  const sea = noiseSrc(ac, 'brown', t, 1e6, r);
  const seaLP = filt(ac, 'lowpass', 230, 0.7);
  const seaG = gain(ac, 0.12);
  const wave = ac.createOscillator(); wave.frequency.value = 0.09;
  const waveG = gain(ac, 0.09); chain(wave, waveG); waveG.connect(seaG.gain);
  chain(sea, seaLP, seaG, out);
  wave.start(t);
  // foundry drone (A1 = fifth of the D-minor score, so it never fights the music)
  const dr = filt(ac, 'lowpass', 130, 1.2);
  const drG = gain(ac, 0.05);
  chain(dr, drG, out);
  for (const d of [0, 6]) { const o = ac.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 55; o.detune.value = d; o.connect(dr); o.start(t); }
  return { out };
}

/**
 * Pooled spatial emitter for enemy machinery (the engine keeps 4, assigned to the nearest
 * enemies each frame): drone rotor buzz (blade-pass AM), walker hydraulics / servo hum,
 * relay-generator mains hum. dest = a PannerNode.
 *   .set(kind, amount 0..1, speed m/s, t)   kind: 'drone' | 'mt' | 'turret' | null (off)
 */
export const EMIT = {
  drone: { rotor: 0.16, rotorF: 74, perMs: 1.6, am: 41, hum: 0.018, humF: 620, air: 0.06, airF: 1100 },
  mt: { rotor: 0, rotorF: 60, perMs: 0, am: 20, hum: 0.05, humF: 132, air: 0.025, airF: 420 },
  turret: { rotor: 0.035, rotorF: 50, perMs: 0, am: 100, hum: 0.06, humF: 100, air: 0.012, airF: 3000 },
};
export function createEmitter(ac, dest, r = makeRng(3)) {
  const t = ac.currentTime;
  const out = gain(ac, 0); out.connect(dest);
  const rotor = ac.createOscillator(); rotor.type = 'sawtooth'; rotor.frequency.value = 70;
  const rbp = filt(ac, 'bandpass', 220, 1.4);
  const ram = gain(ac, 0.5);
  const lfo = ac.createOscillator(); lfo.type = 'triangle'; lfo.frequency.value = 40;
  const lg = gain(ac, 0.5); chain(lfo, lg); lg.connect(ram.gain);
  const rg = gain(ac, 0);
  chain(rotor, rbp, ram, rg, out);
  // slow rotor-speed wander (governor hunting) so the buzz never reads as a held synth note
  const wob = ac.createOscillator(); wob.frequency.value = 0.63 + r() * 0.3;
  const wg = gain(ac, 3.5); chain(wob, wg); wg.connect(rotor.frequency);
  const wob2 = ac.createOscillator(); wob2.frequency.value = 1.7 + r() * 0.5;
  const wg2 = gain(ac, 1.6); chain(wob2, wg2); wg2.connect(rotor.frequency);
  const hum = ac.createOscillator(); hum.type = 'triangle'; hum.frequency.value = 130;
  const hum2 = ac.createOscillator(); hum2.type = 'sawtooth'; hum2.frequency.value = 260; hum2.detune.value = 5;
  const hlp = filt(ac, 'lowpass', 900, 1.2);
  const hg = gain(ac, 0);
  const h2g = gain(ac, 0.35); chain(hum2, h2g, hlp);
  chain(hum, hlp, hg, out);
  const air = noiseSrc(ac, 'pink', t, 1e6, r);
  const abp = filt(ac, 'bandpass', 800, 1.1);
  const ag = gain(ac, 0);
  chain(air, abp, ag, out);
  for (const o of [rotor, lfo, hum, hum2, wob, wob2]) o.start(t);
  let kind = null;
  return {
    get kind() { return kind; },
    set(k, amount, speed, tt) {
      const E = k && EMIT[k];
      if (!E) { if (kind) out.gain.setTargetAtTime(0, tt, 0.08); kind = null; return; }
      if (k !== kind) {
        kind = k;
        rotor.frequency.setTargetAtTime(E.rotorF, tt, 0.05); lfo.frequency.setTargetAtTime(E.am, tt, 0.05);
        hum.frequency.setTargetAtTime(E.humF, tt, 0.05); hum2.frequency.setTargetAtTime(E.humF * 2, tt, 0.05);
        abp.frequency.setTargetAtTime(E.airF, tt, 0.05);
        rg.gain.setTargetAtTime(E.rotor, tt, 0.05); hg.gain.setTargetAtTime(E.hum, tt, 0.05); ag.gain.setTargetAtTime(E.air, tt, 0.05);
      }
      if (E.perMs) rotor.frequency.setTargetAtTime(E.rotorF + speed * E.perMs, tt, 0.1);
      out.gain.setTargetAtTime(amount, tt, 0.08);
    },
  };
}

// ------------------------------------------------------------------ offline demos (sheet)
export const BED_DEMOS = ['booster: walk > boost ramp > QB > AB charge > AB flight > stop', 'ambience: Pier 7 wind / sea / drone',
  'enemy machinery: Gnat drone fly-by 10 m (pooled 3D emitter, stereo L>R) then relay generator hum'];

export async function renderBedDemo(OAC, name, sr) {
  if (name.startsWith('enemy')) {
    const T = 8, ac = new OAC(2, Math.ceil(sr * T), sr);
    const pan = ac.createPanner(); pan.panningModel = 'equalpower'; pan.distanceModel = 'inverse'; pan.refDistance = 18;
    pan.connect(ac.destination);
    const em = createEmitter(ac, pan);
    em.set('drone', 1, 20, 0);
    pan.positionX.setValueAtTime(-90, 0); pan.positionX.linearRampToValueAtTime(90, 5);
    pan.positionZ.value = -10; pan.positionY.value = 4;
    em.set('turret', 1, 0, 5.2);
    pan.positionX.setValueAtTime(15, 5.2);
    return { buffer: await ac.startRendering(), marks: [[0.1, 'drone 90 m L'], [2.5, 'closest 10 m'], [5.2, 'generator 18 m']] };
  }
  if (name.startsWith('ambience')) {
    const ac = new OAC(1, Math.ceil(sr * 8), sr);
    createAmbience(ac, ac.destination);
    return { buffer: await ac.startRendering(), marks: [] };
  }
  const T = 11;
  const ac = new OAC(1, Math.ceil(sr * T), sr);
  const bed = createJetBed(ac, ac.destination);
  const x = makeJetTargets();
  const m = { mode: 'idle', speedH: 0, vy: 0, abCharging: false, abCharge: 0, skid: 0 };
  const marks = [[0.3, 'walk'], [1.2, 'boost'], [4.4, 'QB'], [5.0, 'AB charge'], [5.6, 'AB'], [9.2, 'release']];
  for (let i = 0; i < T * 60; i++) {
    const tt = i / 60;
    m.abCharging = false;
    if (tt < 0.3) { m.mode = 'idle'; m.speedH = 0; }
    else if (tt < 1.2) { m.mode = 'walk'; m.speedH = 8; }
    else if (tt < 4.4) { m.mode = 'boost'; m.speedH = Math.min(88, 8 + (tt - 1.2) * 45); }
    else if (tt < 4.7) { m.mode = 'qb'; m.speedH = 120; }
    else if (tt < 5.0) { m.mode = 'boost'; m.speedH = 90; }
    else if (tt < 5.6) { m.mode = 'ab'; m.abCharging = true; m.abCharge = (tt - 5.0) / 0.6; m.speedH = 90 * Math.exp(-(tt - 5) / 0.5); }
    else if (tt < 9.2) { m.mode = 'ab'; m.speedH = Math.min(130, 110 + (tt - 5.6) * 12); }
    else { m.mode = 'idle'; m.speedH = Math.max(0, 130 - (tt - 9.2) * 90); }
    bed.set(jetTargets(m, x), tt, 0.08);
  }
  return { buffer: await ac.startRendering(), marks };
}

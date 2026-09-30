#!/usr/bin/env node
// tools/audio_sheet.mjs — offline-render every procedural sound and write contact sheets
// (waveform + log-frequency spectrogram per sound) so critics can inspect envelopes and
// spectral content without speakers. Owner: audio designer.
//
//   node tools/audio_sheet.mjs [--out .shots] [--ids rifle,qb] [--only sfx|music] [--wav]
//
// Renders in headless Chromium with OfflineAudioContext, using the SAME recipe code the game
// runs (src/audio/sfx.js, music.js, beds.js, reverb.js). Writes:
//   <out>/audio_sheet.png         every SFX id (variant 0) — the main sheet
//   <out>/audio_sheet_music.png   adaptive music layers + full mix, booster beds, reverb IR
//   <out>/audio_sheet.json        per-sound stats (peak / RMS dBFS, crest, band energy split)
//   --wav                          also writes <out>/audio/<id>.wav (16-bit) for listening
//   --live                         instead: boot the real game (no autoplay flag), verify audio is
//                                  locked before and running after the FIRST user gesture, the
//                                  variant bank + music layers render, zero console errors
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { start as startServer } from './serve.mjs';
import { CHROMIUM_ARGS } from './shoot.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const OUT = path.resolve(ROOT, arg('--out', '.shots'));
const IDS = arg('--ids', '') ? arg('--ids', '').split(',').filter(Boolean) : null;
const ONLY = arg('--only', '');
const WAV = argv.includes('--wav');

// ------------------------------------------------------------------ in-page renderer
async function pageMain(opts) {
  const base = location.origin + '/';
  const sfxMod = await import(base + 'src/audio/sfx.js');
  const SR = 48000;
  const OAC = window.OfflineAudioContext;

  // ---- analysis helpers
  function fft(re, im) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
      for (let i = 0; i < n; i += len) {
        let cr = 1, ci = 0;
        for (let k = 0; k < len / 2; k++) {
          const a = i + k, b = a + len / 2;
          const xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
          re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
          const ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr;
        }
      }
    }
  }
  const N = 2048, HANN = new Float32Array(N);
  for (let i = 0; i < N; i++) HANN[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1));
  function mono(buf) {
    const d0 = buf.getChannelData(0);
    if (buf.numberOfChannels === 1) return d0;
    const d1 = buf.getChannelData(1), m = new Float32Array(d0.length);
    for (let i = 0; i < m.length; i++) m[i] = 0.5 * (d0[i] + d1[i]);
    return m;
  }
  function stats(x) {
    let pk = 0, e = 0;
    for (let i = 0; i < x.length; i++) { const a = Math.abs(x[i]); if (a > pk) pk = a; e += x[i] * x[i]; }
    // band energy split via one-pole splits (sub<90, low 90-900, mid 0.9-4k, high>4k)
    const sr = SR, c = (f) => 1 - Math.exp(-2 * Math.PI * f / sr);
    const a1 = c(90), a2 = c(900), a3 = c(4000);
    let l1 = 0, l2 = 0, l3 = 0; const E = [0, 0, 0, 0];
    for (let i = 0; i < x.length; i++) {
      const v = x[i]; l1 += a1 * (v - l1); l2 += a2 * (v - l2); l3 += a3 * (v - l3);
      E[0] += l1 * l1; E[1] += (l2 - l1) ** 2; E[2] += (l3 - l2) ** 2; E[3] += (v - l3) ** 2;
    }
    const tot = E[0] + E[1] + E[2] + E[3] || 1;
    // active RMS: RMS over samples within 40 dB of peak envelope (ignores the silent tail)
    const rms = Math.sqrt(e / x.length);
    return { peakDb: 20 * Math.log10(pk + 1e-12), rmsDb: 20 * Math.log10(rms + 1e-12), crest: 20 * Math.log10((pk + 1e-12) / (rms + 1e-12)), bands: E.map((v) => Math.round(100 * v / tot)) };
  }
  // magma-like colormap
  const CM = [[0, 0, 4], [28, 16, 68], [79, 18, 123], [129, 37, 129], [181, 54, 122], [229, 80, 100], [251, 135, 97], [254, 194, 135], [252, 253, 191]];
  function cmap(v) {
    v = Math.max(0, Math.min(1, v)) * (CM.length - 1);
    const i = Math.min(CM.length - 2, Math.floor(v)), f = v - i, a = CM[i], b = CM[i + 1];
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
  }
  const FMIN = 20, FMAX = 20000;
  function drawCell(ctx, x0, y0, w, h, title, sub, x, sr, st, opt = {}) {
    const WH = Math.round(h * 0.3), SH = h - WH - 34 - 14;
    ctx.fillStyle = '#0d1114'; ctx.fillRect(x0, y0, w, h);
    ctx.fillStyle = '#e6eef0'; ctx.font = '600 15px monospace'; ctx.fillText(title, x0 + 8, y0 + 16);
    ctx.fillStyle = '#9fb3ba'; ctx.font = '11px monospace'; ctx.fillText(sub, x0 + 8, y0 + 29);
    const bx = x0 + 34, bw = w - 42, wy = y0 + 34, sy = wy + WH + 2;
    // waveform (min/max per column) + dB envelope
    ctx.fillStyle = '#12181c'; ctx.fillRect(bx, wy, bw, WH);
    ctx.strokeStyle = '#2a3238'; ctx.beginPath(); ctx.moveTo(bx, wy + WH / 2); ctx.lineTo(bx + bw, wy + WH / 2); ctx.stroke();
    const spp = x.length / bw;
    ctx.fillStyle = '#7fd8ff';
    for (let c = 0; c < bw; c++) {
      let mn = 1, mx = -1;
      const a = Math.floor(c * spp), b = Math.min(x.length, Math.floor((c + 1) * spp));
      for (let i = a; i < b; i++) { const v = x[i]; if (v < mn) mn = v; if (v > mx) mx = v; }
      if (b <= a) continue;
      const ya = wy + WH / 2 - mx * WH / 2, yb = wy + WH / 2 - mn * WH / 2;
      ctx.fillRect(bx + c, ya, 1, Math.max(1, yb - ya));
    }
    // RMS envelope in dB (-60..0) as an orange line
    ctx.strokeStyle = '#ffb400'; ctx.lineWidth = 1.2; ctx.beginPath();
    for (let c = 0; c < bw; c++) {
      const a = Math.floor(c * spp), b = Math.min(x.length, Math.floor((c + 1) * spp) + 64);
      let e = 0; for (let i = a; i < b; i++) e += x[i] * x[i];
      const db = 10 * Math.log10(e / Math.max(1, b - a) + 1e-12);
      const y = wy + WH - Math.max(0, Math.min(1, (db + 60) / 60)) * WH;
      if (c === 0) ctx.moveTo(bx + c, y); else ctx.lineTo(bx + c, y);
    }
    ctx.stroke(); ctx.lineWidth = 1;
    ctx.fillStyle = '#9fb3ba'; ctx.font = '9px monospace';
    ctx.fillText('0dB', x0 + 4, wy + 8); ctx.fillText('-60', x0 + 4, wy + WH - 1);
    // spectrogram (log frequency)
    const img = ctx.createImageData(bw, SH);
    const hop = Math.max(1, (x.length - N) / bw);
    const re = new Float32Array(N), im = new Float32Array(N), mag = new Float32Array(N / 2);
    const rowBin = new Float32Array(SH);
    for (let yy = 0; yy < SH; yy++) { const f = FMIN * Math.pow(FMAX / FMIN, 1 - yy / (SH - 1)); rowBin[yy] = f / (sr / N); }
    for (let c = 0; c < bw; c++) {
      const s0 = Math.floor(c * hop) - N / 4;
      for (let i = 0; i < N; i++) { const k = s0 + i; re[i] = (k >= 0 && k < x.length ? x[k] : 0) * HANN[i]; im[i] = 0; }
      fft(re, im);
      for (let k = 0; k < N / 2; k++) mag[k] = Math.sqrt(re[k] * re[k] + im[k] * im[k]) / (N / 4);
      for (let yy = 0; yy < SH; yy++) {
        const bf = rowBin[yy], k0 = Math.floor(bf), fr = bf - k0;
        // average neighbouring bins at high freq (bin spacing << pixel spacing)
        const span = Math.max(1, Math.floor(bf * 0.012));
        let m = 0; for (let j = -span; j <= span; j++) m = Math.max(m, mag[Math.min(N / 2 - 1, Math.max(0, k0 + j))]);
        if (span === 1) m = mag[Math.min(N / 2 - 1, k0)] * (1 - fr) + mag[Math.min(N / 2 - 1, k0 + 1)] * fr;
        const db = 20 * Math.log10(m + 1e-9);
        const [R, G, B] = cmap((db + 90) / 84);
        const o = (yy * bw + c) * 4;
        img.data[o] = R; img.data[o + 1] = G; img.data[o + 2] = B; img.data[o + 3] = 255;
      }
    }
    ctx.putImageData(img, bx, sy);
    // axes
    ctx.fillStyle = '#9fb3ba'; ctx.font = '9px monospace'; ctx.strokeStyle = 'rgba(230,238,240,0.18)';
    for (const [f, l] of [[50, '50'], [100, '100'], [300, '300'], [1000, '1k'], [3000, '3k'], [10000, '10k']]) {
      const yy = sy + (1 - Math.log(f / FMIN) / Math.log(FMAX / FMIN)) * (SH - 1);
      ctx.fillText(l, x0 + 4, yy + 3);
      ctx.beginPath(); ctx.moveTo(bx, yy); ctx.lineTo(bx + bw, yy); ctx.stroke();
    }
    const dur = x.length / sr;
    const step = dur > 12 ? 4 : dur > 4 ? 1 : dur > 1.5 ? 0.25 : dur > 0.4 ? 0.1 : 0.02;
    for (let tt = 0; tt <= dur + 1e-6; tt += step) {
      const xx = bx + (tt / dur) * bw;
      ctx.fillRect(xx, sy + SH, 1, 4);
      if (tt > 0) ctx.fillText(step < 0.1 ? `${Math.round(tt * 1000)}ms` : `${+tt.toFixed(2)}s`, xx - 12, sy + SH + 13);
    }
    if (opt.marks) for (const [tt, label] of opt.marks) {
      const xx = bx + (tt / dur) * bw; ctx.fillStyle = 'rgba(255,180,0,0.8)'; ctx.fillRect(xx, wy, 1, WH + SH);
      ctx.fillText(label, xx + 3, wy + 10);
    }
  }
  function sheet(items, cols, cw, ch, title) {
    const rows = Math.ceil(items.length / cols), pad = 8, head = 56;
    const cv = document.createElement('canvas');
    cv.width = cols * (cw + pad) + pad; cv.height = head + rows * (ch + pad + 14) + pad;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#070a0c'; ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.fillStyle = '#e6eef0'; ctx.font = '600 22px monospace'; ctx.fillText(title, pad, 30);
    ctx.fillStyle = '#9fb3ba'; ctx.font = '12px monospace';
    ctx.fillText('waveform (cyan, ±1 FS) + RMS envelope (orange, -60..0 dB) · spectrogram: log freq 20 Hz-20 kHz, 2048-pt Hann, -90..-6 dBFS magma · 48 kHz offline render of the in-game recipe', pad, 48);
    items.forEach((it, i) => {
      const cx = pad + (i % cols) * (cw + pad), cy = head + Math.floor(i / cols) * (ch + pad + 14);
      drawCell(ctx, cx, cy, cw, ch + 14, it.title, it.sub, it.x, SR, it.st, it);
    });
    return cv.toDataURL('image/png');
  }

  const out = { sheets: {}, stats: {}, wavs: {} };
  const keep = (id, buf) => { if (opts.wav) out.wavs[id] = Array.from(new Int16Array(mono(buf).map((v) => Math.max(-1, Math.min(1, v)) * 32767))); };

  if (opts.only !== 'music') {
    const ids = opts.ids || sfxMod.SFX_IDS;
    const items = [];
    for (const id of ids) {
      const def = sfxMod.SFX[id];
      if (!def) continue;
      const { buffer, peak } = await sfxMod.renderSfx(OAC, id, 0, SR);
      // show at mix level (gain), so relative loudness between sounds is visible
      const x = mono(buffer).map((v) => v * def.gain);
      const st = stats(x);
      out.stats[id] = { ...st, bus: def.bus, prio: def.prio, variants: def.variants, rawPeak: +(20 * Math.log10(peak)).toFixed(1) };
      items.push({ x, st, title: id, sub: `${def.bus}${def.spatial === false ? '' : ` 3D ref${def.ref || 20}m`} prio${def.prio} ×${def.variants} ±${def.pv || 0}c rv${def.send || 0}${def.duck ? ' DUCK' : ''}  pk ${st.peakDb.toFixed(1)} rms ${st.rmsDb.toFixed(1)} dBFS  sub/low/mid/hi ${st.bands.join('/')}%` });
      keep(id, buffer);
    }
    out.sheets.sfx = sheet(items, 3, 620, 250, 'IRONWAKE — SFX contact sheet (procedural, variant 0 at mix gain)');
  }
  if (opts.only !== 'sfx') {
    const items = [];
    try {
      const mus = await import(base + 'src/audio/music.js');
      const layers = {};
      for (const name of mus.LAYER_NAMES) {
        const tt0 = performance.now();
        const buf = await mus.renderLayer(OAC, name, SR);
        console.log(`music layer ${name}: ${((performance.now() - tt0) / 1000).toFixed(2)} s render`);
        layers[name] = buf;
        const x = mono(buf);
        const st = stats(x);
        out.stats['music_' + name] = st;
        items.push({ x, st, title: `music: ${name}`, sub: `layer loop ${(x.length / SR).toFixed(1)} s  pk ${st.peakDb.toFixed(1)} rms ${st.rmsDb.toFixed(1)} dBFS  sub/low/mid/hi ${st.bands.join('/')}%` });
      }
      // full boss-intensity mix (what stage 3 sounds like)
      const n = layers[mus.LAYER_NAMES[0]].length, mix = new Float32Array(n);
      const eng0 = await import(base + 'src/audio/engine.js');
      const busG = eng0.MIXER.bus.music;
      for (const name of mus.LAYER_NAMES) { const x = mono(layers[name]); const g = (mus.MIX.boss[name] ?? 0) * busG; for (let i = 0; i < n; i++) mix[i] += x[i] * g; }
      const st = stats(mix);
      items.push({ x: mix, st, title: 'music: BOSS state mix (all 5 layers at music-bus gain)', sub: `pk ${st.peakDb.toFixed(1)} rms ${st.rmsDb.toFixed(1)} dBFS  sub/low/mid/hi ${st.bands.join('/')}%` });
      if (opts.wav) out.wavs.music_boss_mix = Array.from(new Int16Array(mix.map((v) => Math.max(-1, Math.min(1, v)) * 32767)));
    } catch (e) { console.error('music render failed', e && e.stack || e); }
    try {
      const beds = await import(base + 'src/audio/beds.js');
      for (const demo of beds.BED_DEMOS) {
        const { buffer, marks } = await beds.renderBedDemo(OAC, demo, SR);
        const x = mono(buffer), st = stats(x);
        items.push({ x, st, marks, title: `bed: ${demo}`, sub: `continuous graph driven by motor state  pk ${st.peakDb.toFixed(1)} rms ${st.rmsDb.toFixed(1)} dBFS  sub/low/mid/hi ${st.bands.join('/')}%` });
        keep('bed_' + demo, buffer);
      }
    } catch (e) { console.error('bed render failed', e && e.stack || e); }
    try {
      const rv = await import(base + 'src/audio/reverb.js');
      const ac = new OAC(2, SR, SR);
      const ir = rv.makeFoundryIR(ac);
      const x = mono(ir), st = stats(x);
      items.push({ x, st, title: 'reverb IR: Pier 7 foundry yard', sub: `early taps + slap echoes 0.2/0.37/0.55 s + 3-band tail (RT60 lo ${rv.FOUNDRY_IR.rt60.low}s mid ${rv.FOUNDRY_IR.rt60.mid}s hi ${rv.FOUNDRY_IR.rt60.high}s)` });
      const v = await import(base + 'src/audio/voice.js');
      const { buffer } = await v.renderVoiceDemo(OAC, SR);
      const vx = mono(buffer), vst = stats(vx);
      items.push({ x: vx, st: vst, title: 'comms: LEDGER radio voice (procedural)', sub: `formant babble -> 350-3200 Hz radio chain + squelch  pk ${vst.peakDb.toFixed(1)} dBFS` });
      keep('voice_demo', buffer);
    } catch (e) { console.error('ir/voice render failed', e && e.stack || e); }
    // ---- a scripted combat scene through the REAL mixer (engine.js): spatialisation, air
    // absorption, distance delay, reverb, voice limiting and sidechain ducking all active.
    try {
      const eng = await import(base + 'src/audio/engine.js');
      const beds = await import(base + 'src/audio/beds.js');
      const T = 14;
      const IDM = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; // listener at origin, facing -Z
      let shared = null;
      const scene = async (musicOnly) => {
        const ac = new OAC(2, Math.ceil(T * SR), SR);
        const E = new eng.AudioEngine(ac, { seed: 7 });
        if (!shared) { await E.renderAll(OAC); shared = { bank: E.bank, norm: E.norm, music: E.music.buffers }; }
        else { for (const [k, v] of shared.bank) E.bank.set(k, v); for (const k in shared.music) E.music.add(k, shared.music[k]); }
        E.setListenerMatrix(IDM);
        E.music.setState('combat2', 0.05);
        if (musicOnly) { for (const k of ['sfx', 'impact', 'ui', 'stinger', 'voice', 'bed', 'amb']) E.bus[k].gain.value = 0; E.reverbRet.gain.value = 0; }
        const jt = beds.makeJetTargets(), m = { mode: 'boost', speedH: 80, vy: 0, abCharging: false, abCharge: 0, skid: 0 };
        for (let i = 0; i < T * 30; i++) {
          const tt = i / 30;
          m.mode = tt < 2.8 ? 'boost' : tt < 3.1 ? 'qb' : tt < 8.3 ? 'boost' : tt < 8.5 ? 'air' : tt < 11 ? 'walk' : 'idle';
          m.speedH = m.mode === 'qb' ? 120 : m.mode === 'walk' ? 8 : m.mode === 'idle' ? 0 : 82;
          E.jet.set(beds.jetTargets(m, jt), tt, 0.08);
        }
        const P = (x, y, z) => ({ x, y, z });
        const near = P(0, 4, -12);
        const marks = [];
        const at = (t, id, o, label) => { E.play(id, o, t); if (label) marks.push([t, label]); };
        for (let k = 0; k < 7; k++) at(0.5 + k * 0.294, 'rifle', { pos: near }, k ? '' : 'rifle x7');
        for (let k = 0; k < 5; k++) at(1.3 + k * 0.12, 'enemy_gun', { pos: P(-120, 6, -140) }, k ? '' : 'MT gun 185m L');
        at(2.8, 'qb', { pos: near }, 'QB');
        for (let k = 0; k < 6; k++) at(3.3 + k * 0.07, 'missile_launch', { pos: near }, k ? '' : 'missiles x6');
        at(4.6, 'explosion_small', { pos: P(100, 10, -110) }, 'expl small 150m R');
        at(4.9, 'explosion_small', { pos: P(110, 12, -120) });
        at(5.6, 'cannon', { pos: near }, 'cannon');
        at(6.9, 'explosion_large', { pos: P(-20, 5, -60) }, 'expl large 63m (duck)');
        at(8.5, 'land', { pos: near }, 'land');
        for (let k = 0; k < 4; k++) at(9.0 + k * 0.45, 'footstep', { pos: near }, k ? '' : 'steps');
        at(10.9, 'blade', { pos: near }, 'blade');
        at(11.25, 'blade_hit', { pos: P(0, 5, -20) });
        at(11.6, 'explosion_large', { pos: P(250, 20, -260) }, 'expl large 360m (delayed)');
        at(12.6, 'alarm', null, 'alarm');
        return { buffer: await ac.startRendering(), marks };
      };
      const full = await scene(false);
      const x = mono(full.buffer), st = stats(x);
      items.push({ x, st, marks: full.marks, title: 'MIX: scripted combat scene through the in-game mixer', sub: `music combat2 + booster bed + SFX, 3D + air absorption + reverb + limiter  pk ${st.peakDb.toFixed(1)} rms ${st.rmsDb.toFixed(1)} dBFS` });
      if (opts.wav) out.wavs.scene_mix = Array.from(new Int16Array(x.map((v) => Math.max(-1, Math.min(1, v)) * 32767)));
      const mo = await scene(true);
      const mx = mono(mo.buffer), mst = stats(mx);
      items.push({ x: mx, st: mst, marks: mo.marks, title: 'MIX: music stem of the same scene (sidechain ducking)', sub: `SFX buses muted: dips = ducks under cannon / explosions / blade hit / alarm  pk ${mst.peakDb.toFixed(1)} dBFS` });
      out.stats.scene_mix = st; out.stats.scene_music_stem = mst;
      // ---- isolated engine demos (no music / beds): round-robin variance and distance cues
      const demo = async (T2, script) => {
        const ac = new OAC(2, Math.ceil(T2 * SR), SR);
        const E = new eng.AudioEngine(ac, { seed: 11 });
        for (const [k, v] of shared.bank) E.bank.set(k, v);
        E.setListenerMatrix(IDM);
        E.bus.amb.gain.value = 0; E.bus.bed.gain.value = 0;
        const marks = [];
        script((t, id, o, label) => { E.play(id, o, t); if (label) marks.push([t, label]); });
        return { buffer: await ac.startRendering(), marks };
      };
      const burst = await demo(3.4, (at) => { for (let k = 0; k < 8; k++) at(0.1 + k * 0.294, 'rifle', { pos: { x: 0, y: 4, z: -12 } }, `#${k + 1}`); });
      const bx = mono(burst.buffer), bst = stats(bx);
      items.push({ x: bx, st: bst, marks: burst.marks, title: 'ENGINE: rifle x8 at 3.4 rps, as played in-game', sub: `4 round-robin variants, never the same twice in a row, ±70 cents, ±1.5 dB, 0-4 ms jitter, 12 m + foundry reverb` });
      const dist = await demo(6, (at) => {
        at(0.1, 'explosion_small', { pos: { x: 0, y: 5, z: -20 } }, '20 m');
        at(2.0, 'explosion_small', { pos: { x: 60, y: 8, z: -110 } }, '125 m');
        at(3.9, 'explosion_small', { pos: { x: -200, y: 10, z: -230 } }, '305 m (+0.6 s sound delay)');
      });
      const dx = mono(dist.buffer), dst = stats(dx);
      items.push({ x: dx, st: dst, marks: dist.marks, title: 'ENGINE: explosion_small at 20 / 125 / 305 m', sub: 'inverse distance model + air-absorption low-pass + distance reverb + speed-of-sound delay (equal-power 3D pan)' });
    } catch (e) { console.error('scene render failed', e && e.stack || e); }
    if (items.length) out.sheets.music = sheet(items, 2, 940, 250, 'IRONWAKE — adaptive music layers · booster beds · reverb IR · comms · full mix');
  }
  return out;
}

function writeWav(file, samples, sr = 48000) {
  const n = samples.length, b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVE', 8); b.write('fmt ', 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(sr, 24);
  b.writeUInt32LE(sr * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(samples[i], 44 + i * 2);
  fs.writeFileSync(file, b);
}

async function live() {
  const server = await startServer({ root: ROOT });
  const browser = await chromium.launch({ args: CHROMIUM_ARGS.filter((x) => !x.startsWith('--autoplay')) });
  const rows = [];
  const rec = (name, pass, detail) => rows.push({ name, pass, detail });
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(server.url + 'index.html?quality=low', { waitUntil: 'load' });
    await page.waitForSelector('.menu-title .menu-btn.primary', { state: 'visible', timeout: 180000 });
    const a0 = await page.evaluate(() => window.__game.audio.debug());
    rec('locked before any gesture', a0.state === 'locked', `state=${a0.state}`);
    await page.mouse.click(12, 12);
    await page.waitForTimeout(250);
    const a1 = await page.evaluate(() => window.__game.audio.debug());
    rec('running after the first gesture', a1.state === 'running', `state=${a1.state} sampleRate=${a1.sampleRate}`);
    const t0 = Date.now();
    await page.waitForFunction(() => { const d = window.__game.audio.debug(); return d.bank >= d.bankTotal && d.musicLayers >= 5; }, null, { timeout: 240000 }).catch(() => {});
    const a2 = await page.evaluate(() => window.__game.audio.debug());
    rec('variant bank + music layers rendered', a2.bank >= a2.bankTotal && a2.musicLayers >= 5, `${a2.bank}/${a2.bankTotal} sfx ids, ${a2.musicLayers}/5 layers in ${((Date.now() - t0) / 1000).toFixed(1)} s (headless CPU), music=${a2.musicState}`);
    await page.click('.menu-title .menu-btn.primary', { timeout: 120000 });
    await page.waitForSelector('.menu-briefing .menu-btn.primary', { state: 'visible', timeout: 120000 });
    await page.waitForFunction(() => window.__game.audio.debug().musicState === 'briefing', null, { timeout: 30000 }).catch(() => {});
    const a3 = await page.evaluate(() => window.__game.audio.debug());
    rec('briefing: score crossfades + LEDGER comm voice', a3.musicState === 'briefing' && a3.radio, `music=${a3.musicState} radio=${a3.radio}`);
    await page.click('.menu-briefing .menu-btn.primary', { timeout: 120000 });
    await page.waitForFunction(() => /explore|combat/.test(window.__game.audio.debug().musicState), null, { timeout: 30000 }).catch(() => {});
    const a4 = await page.evaluate(() => ({ d: window.__game.audio.debug(), s: window.__game.state }));
    rec('mission: combat score running', a4.s === 'playing' && /explore|combat/.test(a4.d.musicState), `state=${a4.s} music=${a4.d.musicState} plays=${JSON.stringify(a4.d.counts)}`);
    rec('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  } finally {
    await browser.close(); await server.stop();
  }
  for (const r of rows) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}  ${r.detail || ''}`);
  if (rows.some((r) => !r.pass)) process.exitCode = 1;
}

async function main() {
  if (argv.includes('--live')) return live();
  fs.mkdirSync(OUT, { recursive: true });
  const server = await startServer({ root: ROOT });
  const browser = await chromium.launch({ args: CHROMIUM_ARGS });
  const t0 = Date.now();
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); else if (m.type() === 'log') console.log('  [page]', m.text()); });
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(server.url + 'src/audio/dsp.js');
    const res = await page.evaluate(pageMain, { ids: IDS, only: ONLY, wav: WAV });
    const files = [];
    for (const [k, dataUrl] of Object.entries(res.sheets)) {
      const f = path.join(OUT, k === 'sfx' ? 'audio_sheet.png' : `audio_sheet_${k}.png`);
      fs.writeFileSync(f, Buffer.from(dataUrl.split(',')[1], 'base64'));
      files.push(f);
    }
    fs.writeFileSync(path.join(OUT, 'audio_sheet.json'), JSON.stringify(res.stats, null, 1));
    if (WAV) {
      const dir = path.join(OUT, 'audio'); fs.mkdirSync(dir, { recursive: true });
      for (const [id, s] of Object.entries(res.wavs)) writeWav(path.join(dir, `${id}.wav`), s);
    }
    const clip = Object.entries(res.stats).filter(([, s]) => s.peakDb > -0.1).map(([k]) => k);
    console.log(`audio sheet: ${Object.keys(res.stats).length} sounds in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    for (const f of files) console.log('  wrote', path.relative(ROOT, f));
    if (clip.length) console.log('  WARNING near full scale:', clip.join(', '));
    if (errors.length) { console.log('  page errors:\n   ' + errors.join('\n   ')); process.exitCode = 1; }
  } finally {
    await browser.close();
    await server.stop();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });

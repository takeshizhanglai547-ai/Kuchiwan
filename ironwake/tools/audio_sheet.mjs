#!/usr/bin/env node
// tools/audio_sheet.mjs — offline-render every procedural sound and write contact sheets
// (waveform + log-frequency spectrogram per sound) so critics can inspect envelopes and
// spectral content without speakers. Owner: audio designer.
//
//   node tools/audio_sheet.mjs [--out .shots] [--ids rifle,qb] [--only sfx|music] [--wav]
//
// Renders in headless Chromium with OfflineAudioContext, using the SAME recipe code the game
// runs (src/audio/sfx.js, music.js, beds.js, reverb.js, engine.js). Writes:
//   <out>/audio_sheet.png         band-plan panel + every SFX id (variant 0) grouped by category,
//                                 layer onsets marked, spectrogram window sized to each sound
//   <out>/audio_sheet_music.png   adaptive music layers + boss mix, beds / 3D emitters (Doppler
//                                 missile fly-by), reverb IR, comms voice, a scripted combat scene
//                                 through the real mixer + its stems + the measured duck gains,
//                                 engine demos (round robin, distance, flybys, occlusion)
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
// Sound categories (sheet sections + band-plan colours). Ids missing here land in OTHER.
const CATS = [
  ['WEAPONS', '#ff9a3c', ['rifle', 'cannon', 'missile_launch', 'blade', 'reload', 'enemy_gun', 'enemy_laser']],
  ['IMPACTS · FLYBYS · EXPLOSIONS', '#ff5a4a', ['impact_metal', 'impact_ground', 'ricochet', 'whiz', 'blade_hit', 'damage_taken', 'stagger', 'explosion_small', 'explosion_large']],
  ['MOVEMENT · BOOSTERS', '#5ad1ff', ['qb', 'boost_ignite', 'ab_start', 'jump', 'land', 'footstep', 'footstep_steel']],
  ['FCS · COCKPIT ALERTS (UI band)', '#8cff6a', ['hit_confirm', 'kill_confirm', 'lock', 'lock_switch', 'missile_lock', 'missile_alert', 'en_depleted', 'ap_warning', 'alarm', 'repair']],
  ['MISSION · MENUS · STINGERS', '#d68cff', ['objective', 'objective_tick', 'stage_stinger', 'boss_stinger', 'mission_complete', 'mission_failed', 'ui_select', 'ui_confirm']],
  ['COMMS · AMBIENCE', '#c8c8c8', ['radio_open', 'radio_close', 'distant_clang']],
];

async function pageMain(opts) {
  const CATS = opts.cats;
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
  const HANN = {};
  const hann = (N) => HANN[N] || (HANN[N] = Float32Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1))));
  /** Spectrogram window: short sounds get short windows (time resolution), long ones long (frequency). */
  const fftSizeFor = (dur) => (dur < 0.25 ? 256 : dur < 0.7 ? 512 : dur < 2.5 ? 1024 : 2048);
  function mono(buf) {
    const d0 = buf.getChannelData(0);
    if (buf.numberOfChannels === 1) return d0;
    const d1 = buf.getChannelData(1), m = new Float32Array(d0.length);
    for (let i = 0; i < m.length; i++) m[i] = 0.5 * (d0[i] + d1[i]);
    return m;
  }
  /** Energy-weighted spectral percentiles (Hz): where 10 / 50 / 90 % of the sound's energy lies. */
  function percentiles(x) {
    const N = 2048, w = hann(N), P = new Float64Array(N / 2);
    const re = new Float32Array(N), im = new Float32Array(N);
    for (let s0 = 0; s0 < Math.max(1, x.length - N / 2); s0 += N / 2) {
      for (let i = 0; i < N; i++) { const k = s0 + i; re[i] = (k < x.length ? x[k] : 0) * w[i]; im[i] = 0; }
      fft(re, im);
      for (let k = 1; k < N / 2; k++) P[k] += re[k] * re[k] + im[k] * im[k];
    }
    let tot = 0; for (let k = 1; k < N / 2; k++) tot += P[k];
    const out = [0, 0, 0], q = [0.1, 0.5, 0.9];
    let acc = 0, j = 0;
    for (let k = 1; k < N / 2 && j < 3; k++) { acc += P[k]; while (j < 3 && acc >= q[j] * tot) out[j++] = k * SR / N; }
    return out.map((f) => Math.max(20, Math.round(f)));
  }
  function stats(x) {
    let pk = 0, e = 0;
    for (let i = 0; i < x.length; i++) { const a = Math.abs(x[i]); if (a > pk) pk = a; e += x[i] * x[i]; }
    // band energy split via one-pole splits (sub<90, low 90-900, mid 0.9-4k, high>4k)
    const c = (f) => 1 - Math.exp(-2 * Math.PI * f / SR);
    const a1 = c(90), a2 = c(900), a3 = c(4000);
    let l1 = 0, l2 = 0, l3 = 0; const E = [0, 0, 0, 0];
    for (let i = 0; i < x.length; i++) {
      const v = x[i]; l1 += a1 * (v - l1); l2 += a2 * (v - l2); l3 += a3 * (v - l3);
      E[0] += l1 * l1; E[1] += (l2 - l1) ** 2; E[2] += (l3 - l2) ** 2; E[3] += (v - l3) ** 2;
    }
    const tot = E[0] + E[1] + E[2] + E[3] || 1;
    const rms = Math.sqrt(e / x.length);
    return { peakDb: 20 * Math.log10(pk + 1e-12), rmsDb: 20 * Math.log10(rms + 1e-12), crest: 20 * Math.log10((pk + 1e-12) / (rms + 1e-12)), bands: E.map((v) => Math.round(100 * v / tot)) };
  }
  /** Short-term RMS (dB) of x resampled to `cols` columns (window = max(column, 20 ms)). */
  function rmsCurve(x, cols) {
    const out = new Float32Array(cols), spp = x.length / cols, win = Math.max(spp, SR * 0.02);
    for (let c = 0; c < cols; c++) {
      const mid = (c + 0.5) * spp, a = Math.max(0, Math.floor(mid - win / 2)), b = Math.min(x.length, Math.floor(mid + win / 2));
      let e = 0; for (let i = a; i < b; i++) e += x[i] * x[i];
      out[c] = 10 * Math.log10(e / Math.max(1, b - a) + 1e-12);
    }
    return out;
  }
  /** Gain (dB) of a probe signal resampled to `cols` columns (column mean). */
  function gainCurve(x, cols) {
    const out = new Float32Array(cols), spp = x.length / cols;
    for (let c = 0; c < cols; c++) {
      const a = Math.floor(c * spp), b = Math.max(a + 1, Math.floor((c + 1) * spp));
      let m = 0; for (let i = a; i < b && i < x.length; i++) m += x[i];
      out[c] = 20 * Math.log10(Math.max(1e-4, m / (b - a)));
    }
    return out;
  }
  // magma-like colormap
  const CM = [[0, 0, 4], [28, 16, 68], [79, 18, 123], [129, 37, 129], [181, 54, 122], [229, 80, 100], [251, 135, 97], [254, 194, 135], [252, 253, 191]];
  function cmap(v) {
    v = Math.max(0, Math.min(1, v)) * (CM.length - 1);
    const i = Math.min(CM.length - 2, Math.floor(v)), f = v - i, a = CM[i], b = CM[i + 1];
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
  }
  const FMIN = 20, FMAX = 20000;
  const fy = (f, y0, h) => y0 + (1 - Math.log(f / FMIN) / Math.log(FMAX / FMIN)) * (h - 1);

  /**
   * One sound: header, waveform (+ RMS envelope, layer onsets, event marks, overlay curves),
   * log-frequency spectrogram with a duration-adaptive window. it: {title, sub, x, accent,
   * layers, marks, curves:[{v (dB per column), color, label, lo, hi}], noSpec}
   */
  function drawCell(ctx, x0, y0, w, h, it) {
    const x = it.x, sr = SR;
    const subs = Array.isArray(it.sub) ? it.sub : [it.sub], HD = 21 + subs.length * 13;
    const WH = it.noSpec ? h - HD - 16 : Math.round(h * 0.3), SH = it.noSpec ? 0 : h - WH - HD - 14;
    ctx.fillStyle = '#0d1114'; ctx.fillRect(x0, y0, w, h);
    if (it.accent) { ctx.fillStyle = it.accent; ctx.fillRect(x0, y0, 3, h); }
    ctx.fillStyle = '#e6eef0'; ctx.font = '600 15px monospace'; ctx.fillText(it.title, x0 + 8, y0 + 16);
    ctx.fillStyle = '#9fb3ba'; ctx.font = '11px monospace'; subs.forEach((l, i) => ctx.fillText(l, x0 + 8, y0 + 29 + i * 13));
    const bx = x0 + 34, bw = w - 42, wy = y0 + HD, sy = wy + WH + 2;
    const dur = x.length / sr;
    // waveform (min/max per column) + RMS envelope (dB)
    ctx.fillStyle = '#12181c'; ctx.fillRect(bx, wy, bw, WH);
    ctx.strokeStyle = '#2a3238'; ctx.beginPath(); ctx.moveTo(bx, wy + WH / 2); ctx.lineTo(bx + bw, wy + WH / 2); ctx.stroke();
    const spp = x.length / bw;
    if (!it.noWave) {
      ctx.fillStyle = '#7fd8ff';
      for (let c = 0; c < bw; c++) {
        let mn = 1, mx = -1;
        const a = Math.floor(c * spp), b = Math.min(x.length, Math.floor((c + 1) * spp));
        for (let i = a; i < b; i++) { const v = x[i]; if (v < mn) mn = v; if (v > mx) mx = v; }
        if (b <= a) continue;
        const ya = wy + WH / 2 - mx * WH / 2, yb = wy + WH / 2 - mn * WH / 2;
        ctx.fillRect(bx + c, ya, 1, Math.max(1, yb - ya));
      }
      const env = rmsCurve(x, bw);
      ctx.strokeStyle = '#ffb400'; ctx.lineWidth = 1.2; ctx.beginPath();
      for (let c = 0; c < bw; c++) {
        const y = wy + WH - Math.max(0, Math.min(1, (env[c] + 60) / 60)) * WH;
        if (c === 0) ctx.moveTo(bx + c, y); else ctx.lineTo(bx + c, y);
      }
      ctx.stroke(); ctx.lineWidth = 1;
      ctx.fillStyle = '#9fb3ba'; ctx.font = '9px monospace';
      ctx.fillText('0dB', x0 + 6, wy + 8); ctx.fillText('-60', x0 + 6, wy + WH - 1);
    }
    // overlay curves (dB) with their own range + legend
    if (it.curves) {
      let ly = wy + 12;
      for (const cv of it.curves) {
        const lo = cv.lo ?? -60, hi = cv.hi ?? 0;
        ctx.strokeStyle = cv.color; ctx.lineWidth = cv.width || 1.6; ctx.setLineDash(cv.dash || []); ctx.beginPath();
        for (let c = 0; c < bw; c++) {
          const y = wy + WH - Math.max(0, Math.min(1, (cv.v[c] - lo) / (hi - lo))) * WH;
          if (c === 0) ctx.moveTo(bx + c, y); else ctx.lineTo(bx + c, y);
        }
        ctx.stroke(); ctx.setLineDash([]); ctx.lineWidth = 1;
        ctx.fillStyle = cv.color; ctx.font = '600 11px monospace';
        ctx.fillText(cv.label, bx + bw - ctx.measureText(cv.label).width - 6, ly); ly += 13;
      }
      if (it.noWave) {
        ctx.fillStyle = '#9fb3ba'; ctx.font = '9px monospace';
        const c0 = it.curves[0], lo = c0.lo ?? -60, hi = c0.hi ?? 0;
        for (let db = Math.ceil(lo / 6) * 6; db <= hi; db += 6) {
          const y = wy + WH - (db - lo) / (hi - lo) * WH;
          ctx.fillText(`${db}`, x0 + 8, y + 3);
          ctx.strokeStyle = 'rgba(230,238,240,0.08)'; ctx.beginPath(); ctx.moveTo(bx, y); ctx.lineTo(bx + bw, y); ctx.stroke();
        }
      }
    }
    // spectrogram (log frequency, duration-adaptive window)
    if (!it.noSpec) {
      const N = fftSizeFor(dur), HN = hann(N);
      const img = ctx.createImageData(bw, SH);
      const hop = Math.max(1, (x.length - N) / bw);
      const re = new Float32Array(N), im = new Float32Array(N), mag = new Float32Array(N / 2);
      const rowBin = new Float32Array(SH);
      for (let yy = 0; yy < SH; yy++) { const f = FMIN * Math.pow(FMAX / FMIN, 1 - yy / (SH - 1)); rowBin[yy] = f / (sr / N); }
      for (let c = 0; c < bw; c++) {
        const s0 = Math.floor(c * hop) - N / 4;
        for (let i = 0; i < N; i++) { const k = s0 + i; re[i] = (k >= 0 && k < x.length ? x[k] : 0) * HN[i]; im[i] = 0; }
        fft(re, im);
        for (let k = 0; k < N / 2; k++) mag[k] = Math.sqrt(re[k] * re[k] + im[k] * im[k]) / (N / 4);
        for (let yy = 0; yy < SH; yy++) {
          const bf = rowBin[yy], k0 = Math.floor(bf), fr = bf - k0;
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
      ctx.fillStyle = '#9fb3ba'; ctx.font = '9px monospace'; ctx.strokeStyle = 'rgba(230,238,240,0.18)';
      for (const [f, l] of [[50, '50'], [100, '100'], [300, '300'], [1000, '1k'], [3000, '3k'], [10000, '10k']]) {
        const yy = fy(f, sy, SH);
        ctx.fillText(l, x0 + 6, yy + 3);
        ctx.beginPath(); ctx.moveTo(bx, yy); ctx.lineTo(bx + bw, yy); ctx.stroke();
      }
      ctx.fillStyle = 'rgba(159,179,186,0.75)'; ctx.fillText(`${N}-pt`, bx + bw - 40, sy + SH - 4);
    }
    // time axis
    const ty = it.noSpec ? wy + WH : sy + SH;
    ctx.fillStyle = '#9fb3ba'; ctx.font = '9px monospace';
    const step = dur > 12 ? 2 : dur > 4 ? 1 : dur > 1.5 ? 0.25 : dur > 0.4 ? 0.1 : 0.02;
    for (let tt = 0; tt <= dur + 1e-6; tt += step) {
      const xx = bx + (tt / dur) * bw;
      ctx.fillRect(xx, ty, 1, 4);
      if (tt > 0) ctx.fillText(step < 0.1 ? `${Math.round(tt * 1000)}ms` : `${+tt.toFixed(2)}s`, xx - 12, ty + 13);
    }
    // layer onsets (green, dotted, from SFX[id].layers) and scene event marks (amber)
    const fullH = it.noSpec ? WH : WH + SH + 2;
    if (it.layers) {
      ctx.font = '600 10px monospace';
      it.layers.forEach(([tt, label], k) => {
        const xx = bx + (tt / dur) * bw;
        ctx.strokeStyle = 'rgba(124,255,178,0.85)'; ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.moveTo(xx + 0.5, wy); ctx.lineTo(xx + 0.5, wy + fullH); ctx.stroke(); ctx.setLineDash([]);
        const tw = ctx.measureText(label).width, lx = Math.min(xx + 3, bx + bw - tw - 2), ly = wy + 10 + (k % 4) * 11;
        ctx.fillStyle = 'rgba(8,12,14,0.75)'; ctx.fillRect(lx - 1, ly - 9, tw + 2, 11);
        ctx.fillStyle = '#7cffb2'; ctx.fillText(label, lx, ly);
      });
    }
    if (it.marks) {
      ctx.font = '10px monospace';
      it.marks.forEach(([tt, label], k) => {
        const xx = bx + (tt / dur) * bw; ctx.fillStyle = 'rgba(255,180,0,0.8)'; ctx.fillRect(xx, wy, 1, fullH);
        if (!label) return;
        const ly = wy + 10 + (k % 3) * 11, tw = ctx.measureText(label).width;
        ctx.fillStyle = 'rgba(8,12,14,0.7)'; ctx.fillRect(xx + 2, ly - 9, tw + 2, 11);
        ctx.fillStyle = 'rgba(255,196,64,0.95)'; ctx.fillText(label, xx + 3, ly);
      });
    }
  }

  /** Band plan: energy-weighted 10-90 % spectral span (bar) + median (dot) per SFX, by category. */
  function drawBandPlan(ctx, x0, y0, w, rows) {
    const half = Math.ceil(rows.length / 2), RH = 15, colW = (w - 16) / 2, labW = 150;
    const h = 46 + half * RH + 26;
    ctx.fillStyle = '#0d1114'; ctx.fillRect(x0, y0, w, h);
    ctx.fillStyle = '#e6eef0'; ctx.font = '600 15px monospace';
    ctx.fillText('BAND PLAN — where each sound\'s energy lies (bar = 10-90 % of spectral energy, dot = median)', x0 + 8, y0 + 17);
    ctx.fillStyle = '#9fb3ba'; ctx.font = '11px monospace';
    ctx.fillText('weapons / impacts / boosters own sub+low-mid weight; FCS + UI chirps are pure tones parked in 1.2-5 kHz (music EQ carves 2.8 kHz) so alerts read through combat', x0 + 8, y0 + 31);
    for (let col = 0; col < 2; col++) {
      const cx = x0 + 8 + col * (colW + 8), ax = cx + labW, aw = colW - labW - 8, top = y0 + 42;
      const fx = (f) => ax + Math.log(Math.max(FMIN, f) / FMIN) / Math.log(FMAX / FMIN) * aw;
      // guide bands
      ctx.fillStyle = 'rgba(255,154,60,0.07)'; ctx.fillRect(fx(20), top, fx(90) - fx(20), half * RH);
      ctx.fillStyle = 'rgba(140,255,106,0.08)'; ctx.fillRect(fx(1200), top, fx(5000) - fx(1200), half * RH);
      ctx.strokeStyle = 'rgba(230,238,240,0.12)';
      ctx.font = '9px monospace'; ctx.fillStyle = '#9fb3ba';
      for (const [f, l] of [[20, '20'], [50, '50'], [100, '100'], [300, '300'], [1000, '1k'], [3000, '3k'], [10000, '10k'], [20000, '20k']]) {
        ctx.beginPath(); ctx.moveTo(fx(f) + 0.5, top); ctx.lineTo(fx(f) + 0.5, top + half * RH); ctx.stroke();
        ctx.fillText(l, fx(f) - 8, top + half * RH + 11);
      }
      ctx.fillStyle = 'rgba(255,154,60,0.8)'; ctx.fillText('SUB weight', fx(24), top + half * RH + 22);
      ctx.fillStyle = 'rgba(140,255,106,0.85)'; ctx.fillText('UI / FCS chirp band', fx(1300), top + half * RH + 22);
      rows.slice(col * half, col * half + half).forEach((r, i) => {
        const y = top + i * RH + RH / 2;
        ctx.fillStyle = r.color; ctx.font = '11px monospace'; ctx.fillText(r.id, cx, y + 4);
        ctx.fillStyle = r.color; ctx.globalAlpha = 0.55; ctx.fillRect(fx(r.p[0]), y - 3, Math.max(2, fx(r.p[2]) - fx(r.p[0])), 6); ctx.globalAlpha = 1;
        ctx.beginPath(); ctx.arc(fx(r.p[1]), y, 4, 0, Math.PI * 2); ctx.fill();
      });
    }
    return h;
  }

  /** Sections of cells: [{name, color, items}] -> PNG data URL. */
  function sheet(sections, cols, cw, ch, title, legend, top = null) {
    const pad = 8, head = 62, secH = 24;
    let H = head;
    const topH = top ? top.measure : 0;
    H += topH + (top ? pad : 0);
    for (const s of sections) H += (s.name ? secH : 0) + Math.ceil(s.items.length / cols) * (ch + 14 + pad);
    const cv = document.createElement('canvas');
    cv.width = cols * (cw + pad) + pad; cv.height = H + pad;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#070a0c'; ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.fillStyle = '#e6eef0'; ctx.font = '600 22px monospace'; ctx.fillText(title, pad, 30);
    ctx.fillStyle = '#9fb3ba'; ctx.font = '12px monospace';
    legend.forEach((l, i) => ctx.fillText(l, pad, 46 + i * 14));
    let y = head;
    if (top) { top.draw(ctx, pad, y, cv.width - pad * 2); y += topH + pad; }
    for (const s of sections) {
      if (s.name) {
        ctx.fillStyle = s.color || '#e6eef0'; ctx.fillRect(pad, y + 4, 4, 16);
        ctx.font = '600 15px monospace'; ctx.fillText(s.name, pad + 12, y + 18);
        y += secH;
      }
      s.items.forEach((it, i) => {
        const cx = pad + (i % cols) * (cw + pad), cy = y + Math.floor(i / cols) * (ch + pad + 14);
        drawCell(ctx, cx, cy, cw, ch + 14, it);
      });
      y += Math.ceil(s.items.length / cols) * (ch + 14 + pad);
    }
    return cv.toDataURL('image/png');
  }

  const out = { sheets: {}, stats: {}, wavs: {} };
  const keep = (id, buf) => { if (opts.wav) out.wavs[id] = Array.from(new Int16Array(mono(buf).map((v) => Math.max(-1, Math.min(1, v)) * 32767))); };
  const LEGEND = [
    'waveform (cyan, ±1 FS) + short-term RMS (orange, -60..0 dB) · green dotted = layer onsets (SFX[id].layers) · amber = scripted events',
    'spectrogram: log freq 20 Hz-20 kHz, Hann window sized to the sound (256-pt for chirps .. 2048-pt for beds), -90..-6 dBFS magma · 48 kHz offline render of the in-game code',
  ];

  if (opts.only !== 'music') {
    const SFX = sfxMod.SFX;
    const want = opts.ids || sfxMod.SFX_IDS;
    const placed = new Set();
    const cats = CATS.map(([name, color, ids]) => ({ name, color, ids: ids.filter((id) => SFX[id] && want.includes(id)) }));
    const rest = want.filter((id) => SFX[id] && !cats.some((c) => c.ids.includes(id)));
    if (rest.length) cats.push({ name: 'OTHER', color: '#e6eef0', ids: rest });
    const sections = [], bandRows = [];
    for (const c of cats) {
      if (!c.ids.length) continue;
      const items = [];
      for (const id of c.ids) {
        if (placed.has(id)) continue;
        placed.add(id);
        const def = SFX[id];
        const { buffer, peak } = await sfxMod.renderSfx(OAC, id, 0, SR);
        // show at mix level (gain), so relative loudness between sounds is visible
        const x = mono(buffer).map((v) => v * def.gain);
        const st = stats(x), p = percentiles(x);
        out.stats[id] = { ...st, p10_50_90Hz: p, bus: def.bus, prio: def.prio, variants: def.variants, rawPeak: +(20 * Math.log10(peak)).toFixed(1) };
        bandRows.push({ id, color: c.color, p });
        items.push({
          x, st, accent: c.color, layers: def.layers, title: id,
          sub: [`bus ${def.bus}${def.spatial === false ? ' (2D)' : ` 3D ref ${def.ref || 20} m`} · prio ${def.prio} max ${def.max || 4} · ${def.variants} variants ±${def.pv || 0} c ±${def.vv || 0} dB · rev ${def.send || 0}${def.duck ? ` · DUCK ${def.duck[0]}` : ''}${def.delay ? ' · c-delay' : ''}`,
            `pk ${st.peakDb.toFixed(1)} rms ${st.rmsDb.toFixed(1)} dBFS · energy sub/lo/mid/hi ${st.bands.join('/')} % · 10/50/90 % at ${p.map((f) => (f >= 1000 ? (f / 1000).toFixed(1) + 'k' : f)).join('/')} Hz`],
        });
        keep(id, buffer);
      }
      sections.push({ name: c.name, color: c.color, items });
    }
    const top = { measure: 46 + Math.ceil(bandRows.length / 2) * 15 + 26, draw: (ctx, x, y, w) => drawBandPlan(ctx, x, y, w, bandRows) };
    out.sheets.sfx = sheet(sections, 3, 620, 250, `IRONWAKE — SFX contact sheet: ${placed.size} procedural sounds (variant 0 at mix gain)`, LEGEND, top);
  }

  if (opts.only !== 'sfx') {
    const secMusic = [], secBeds = [], secMix = [], secEngine = [], secVo = [];
    let shared = null;
    try {
      const mus = await import(base + 'src/audio/music.js');
      const eng0 = await import(base + 'src/audio/engine.js');
      // every layer: its three 16-bar sections A | B | C side by side (rendered at the sheet rate)
      const secs = {}, SEGN = Math.round(mus.SEG * SR);
      for (const name of mus.LAYER_NAMES) {
        const tt0 = performance.now();
        secs[name] = [];
        for (let k = 0; k < 3; k++) secs[name].push(await mus.renderSection(OAC, name, k, SR));
        console.log(`music layer ${name}: 3 sections ${((performance.now() - tt0) / 1000).toFixed(2)} s render`);
        const x = new Float32Array(SEGN * 3);
        for (let k = 0; k < 3; k++) x.set(mono(secs[name][k]).subarray(0, SEGN), k * SEGN);
        const st = stats(x);
        out.stats['music_' + name] = st;
        const states = Object.entries(mus.MIX).filter(([, m]) => (m[name] || 0) > 0).map(([k, m]) => `${k} ${m[name]}`).join(' · ');
        secMusic.push({ x, st, accent: '#d68cff', marks: [[0, 'A'], [mus.SEG, 'B'], [mus.SEG * 2, 'C']], title: `music layer: ${name} - sections A | B | C (16 bars each)`, sub: [`${mus.SEG.toFixed(1)} s per section, ${mus.BPM} BPM, rendered at ${mus.LAYER_SR[name] / 1000} kHz in game · pk ${st.peakDb.toFixed(1)} rms ${st.rmsDb.toFixed(1)} dBFS · sub/lo/mid/hi ${st.bands.join('/')} %`, `layer gain by music state: ${states}`] });
      }
      // a BOSS-state run of the form the player sequences (the hit of the boss stinger jumps to C,
      // then the music RNG picks): C -> B -> A, every layer at boss gain, tails overlapping
      const FORM = [2, 1, 0], n = SEGN * FORM.length + Math.round(3.5 * SR), mix = new Float32Array(n);
      const busG = eng0.MIXER.bus.music;
      for (const name of mus.LAYER_NAMES) {
        const g = (mus.MIX.boss[name] ?? 0) * busG;
        FORM.forEach((k, j) => { const x = mono(secs[name][k]); for (let i = 0; i < x.length && j * SEGN + i < n; i++) mix[j * SEGN + i] += x[i] * g; });
      }
      const st = stats(mix);
      secMusic.push({ x: mix, st, accent: '#d68cff', marks: [[0, 'C'], [mus.SEG, 'B'], [mus.SEG * 2, 'A']], title: 'music: BOSS state, sequenced form C -> B -> A (all 5 layers at music-bus gain)', sub: `no section repeats inside 87 s; next sections are drawn by the music RNG (weights A/B/C .20/.35/.45 at boss intensity, never 3x the same)  pk ${st.peakDb.toFixed(1)} rms ${st.rmsDb.toFixed(1)} dBFS  sub/lo/mid/hi ${st.bands.join('/')}%` });
      if (opts.wav) out.wavs.music_boss_mix = Array.from(new Int16Array(mix.map((v) => Math.max(-1, Math.min(1, v)) * 32767)));
      // the boss layer alone (bowed KS low strings + brass + war drums) for its spectrum
      const bx = new Float32Array(SEGN * 3);
      for (let k = 0; k < 3; k++) bx.set(mono(secs.boss[k]).subarray(0, SEGN), k * SEGN);
      if (opts.wav) out.wavs.music_boss_layer = Array.from(new Int16Array(bx.map((v) => Math.max(-1, Math.min(1, v)) * 32767)));
    } catch (e) { console.error('music render failed', e && e.stack || e); }
    try {
      const beds = await import(base + 'src/audio/beds.js');
      const eng0 = await import(base + 'src/audio/engine.js');
      const B = eng0.MIXER.bus;
      for (const demo of beds.BED_DEMOS) {
        const { buffer, marks } = await beds.renderBedDemo(OAC, demo, SR);
        const g = demo.startsWith('booster') ? B.bed : demo.startsWith('ambience') ? B.amb : B.sfx;
        const x = mono(buffer).map((v) => v * g), st = stats(x);
        secBeds.push({ x, st, marks, accent: '#5ad1ff', title: `bed: ${demo}`, sub: `continuous graph, at in-game bus gain ×${g}  pk ${st.peakDb.toFixed(1)} rms ${st.rmsDb.toFixed(1)}  sub/lo/mid/hi ${st.bands.join('/')}%` });
        keep('bed_' + demo, buffer);
      }
    } catch (e) { console.error('bed render failed', e && e.stack || e); }
    try {
      const rv = await import(base + 'src/audio/reverb.js');
      const ac = new OAC(2, SR, SR);
      const ir = rv.makeFoundryIR(ac);
      const x = mono(ir), st = stats(x);
      secBeds.push({ x, st, accent: '#c8c8c8', title: 'reverb IR: Pier 7 foundry yard (generated)', sub: `18 early taps 7-95 ms + slap echoes 0.2/0.37/0.55 s + 3-band tail (RT60 lo ${rv.FOUNDRY_IR.rt60.low}s mid ${rv.FOUNDRY_IR.rt60.mid}s hi ${rv.FOUNDRY_IR.rt60.high}s) + 147 Hz shed comb` });
      const v = await import(base + 'src/audio/voice.js');
      const { buffer } = await v.renderVoiceDemo(OAC, SR);
      const vx = mono(buffer), vst = stats(vx);
      secBeds.push({ x: vx, st: vst, accent: '#c8c8c8', title: 'comms FALLBACK: procedural voice (only if a line has no recorded VO)', sub: `formant babble -> 380-3100 Hz radio chain, saturation, static + squelch  pk ${vst.peakDb.toFixed(1)} dBFS` });
      keep('voice_demo', buffer);
    } catch (e) { console.error('ir/voice render failed', e && e.stack || e); }
    // ---- handler LEDGER voice-over: the shipped MP3 lines (assets/audio/build_vo.py) decoded and
    // played through the live comm dressing (voice.js transmit: squelch, static bed, RF crackle)
    try {
      const v = await import(base + 'src/audio/voice.js');
      const { VO_TABLE } = await import(base + 'src/audio/vo_table.js');
      const SHOW = ['boss', 'start', 'boss_stagger', 'failed', 'brief'];
      for (const key of SHOW) {
        const L = VO_TABLE[key];
        if (!L) continue;
        const bytes = await (await fetch(base + `assets/audio/vo/${L.id}.mp3`)).arrayBuffer();
        let vo = await new OAC(1, SR, SR).decodeAudioData(bytes);
        if (key === 'brief') { // first 12 s of the 29 s briefing (the sheet column is fixed width)
          const ac = new OAC(1, Math.ceil(12 * SR), SR); const s0 = ac.createBufferSource(); s0.buffer = vo; s0.connect(ac.destination); s0.start(0); vo = await ac.startRendering();
        }
        const { buffer } = await v.renderTransmission(OAC, SR, vo, 77, key === 'brief' ? v.COMM_BRIEF : v.COMM);
        const x = mono(buffer), st = stats(x);
        out.stats['vo_' + key] = st;
        const txt = L.en.length > 118 ? L.en.slice(0, 115) + '...' : L.en;
        const chainTxt = (key === 'brief' ? 'Pico TTS -> WORLD re-performance (authored F0, timing, formants x0.88) -> recorded-message chain HP 200 / AGC 3:1 / LP 5.2 kHz' : 'Pico TTS -> WORLD re-performance (authored F0, timing, formants x0.88) -> radio chain HP 300 / +4 dB 2.4 kHz / AGC 4:1 / tanh / LP 4.2 kHz');
        secVo.push({ x, st, accent: '#e6eef0', title: `LEDGER VO "${key}" ${L.dur.toFixed(1)} s${key === 'brief' ? ' (first 12 s of the briefing)' : ''}`, sub: [`"${txt}"`, `${chainTxt}, MP3 16 kHz 24 kbps; live squelch + static + RF ticks  pk ${st.peakDb.toFixed(1)} rms ${st.rmsDb.toFixed(1)} dBFS`] });
        keep('vo_' + key, buffer);
      }
    } catch (e) { console.error('vo render failed', e && e.stack || e); }

    // ---- a scripted combat scene through the REAL mixer (engine.js): spatialisation, air
    // absorption, distance delay, reverb, voice limiting and sidechain ducking all active.
    // Rendered 5x: full mix, three stems (music / booster+ambience beds / SFX) and a gain probe
    // that taps the two duck stages directly (so the sidechain curve is drawn, not inferred).
    try {
      const eng = await import(base + 'src/audio/engine.js');
      const beds = await import(base + 'src/audio/beds.js');
      const T = 14;
      const IDM = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; // listener at origin, facing -Z
      const ALL = ['sfx', 'impact', 'ui', 'stinger', 'voice', 'bed', 'amb', 'music'];
      const KEEP = { full: ALL, music: ['music'], beds: ['bed', 'amb'], sfx: ['sfx', 'impact', 'ui', 'stinger'], voice: ['voice'], probe: [] };
      // LEDGER line during the scene (the shipped VO through the live comm dressing)
      let voLine = null;
      try {
        const { VO_TABLE } = await import(base + 'src/audio/vo_table.js');
        const bytes = await (await fetch(base + `assets/audio/vo/${VO_TABLE.mt_half.id}.mp3`)).arrayBuffer();
        voLine = await new OAC(1, SR, SR).decodeAudioData(bytes);
      } catch (e) { console.error('scene VO load failed', e && e.stack || e); }
      const scene = async (mode) => {
        const ac = new OAC(2, Math.ceil(T * SR), SR);
        const E = new eng.AudioEngine(ac, { seed: 7 });
        if (!shared) { await E.renderAll(OAC, undefined, 1); shared = { bank: E.bank, norm: E.norm, music: E.music.buffers }; }
        else { for (const [k, v] of shared.bank) E.bank.set(k, v); for (const k in shared.music) shared.music[k].forEach((b, sec) => b && E.music.add(k, b, sec)); }
        E.setListenerMatrix(IDM);
        E.music.setState('combat2', 0.05);
        for (const k of ALL) if (!KEEP[mode].includes(k)) E.bus[k].gain.value = 0;
        if (mode === 'music' || mode === 'beds' || mode === 'voice') E.reverbRet.gain.value = 0;
        if (mode === 'probe') {
          // DC through the two duck gain stages -> L = music duck, R = world (sfx bus + beds) duck
          E.masterG.gain.value = 0;
          E.duckMusic.disconnect(); E.duckWorld.disconnect();
          const mg = ac.createChannelMerger(2); mg.connect(ac.destination);
          E.duckMusic.connect(mg, 0, 0); E.duckWorld.connect(mg, 0, 1);
          const dc = ac.createConstantSource(); dc.offset.value = 1; dc.connect(E.duckMusic); dc.connect(E.duckWorld); dc.start(0);
        }
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
        for (let k = 0; k < 7; k++) { at(0.5 + k * 0.294, 'rifle', { pos: near }, k ? '' : 'rifle x7'); at(0.5 + k * 0.294 + 0.14, 'impact_metal', { pos: P(14, 6, -70) }); }
        for (let k = 0; k < 5; k++) at(1.3 + k * 0.12, 'enemy_gun', { pos: P(-120, 6, -140) }, k ? '' : 'MT gun 185m L');
        for (let k = 0; k < 3; k++) at(1.8 + k * 0.12, 'whiz', { pos: P(-3 + k * 2, 5, -6) }, k ? '' : 'whiz-bys');
        at(2.8, 'qb', { pos: near }, 'QB');
        for (let k = 0; k < 6; k++) at(3.3 + k * 0.07, 'missile_launch', { pos: near }, k ? '' : 'missiles x6');
        at(4.6, 'explosion_small', { pos: P(100, 10, -110) }, 'expl 150m R');
        at(4.9, 'explosion_small', { pos: P(110, 12, -120) });
        at(5.6, 'cannon', { pos: near }, 'cannon');
        at(6.9, 'explosion_large', { pos: P(-20, 5, -60) }, 'expl large 63m');
        at(8.5, 'land', { pos: near }, 'land');
        for (let k = 0; k < 4; k++) at(9.0 + k * 0.45, 'footstep', { pos: near }, k ? '' : 'steps');
        at(10.9, 'blade', { pos: near }, 'blade');
        at(11.25, 'blade_hit', { pos: P(0, 5, -20) });
        at(11.6, 'explosion_large', { pos: P(250, 20, -260) }, 'expl 360m (+0.6 s)');
        at(12.6, 'alarm', null, 'alarm');
        if (voLine) { E.radio(4, 7.6, voLine); marks.push([7.6, 'LEDGER VO']); }
        return { buffer: await ac.startRendering(), marks };
      };
      const full = await scene('full');
      const x = mono(full.buffer), st = stats(x);
      secMix.push({ x, st, marks: full.marks, accent: '#ffb400', title: 'MIX: scripted 14 s combat scene through the in-game mixer', sub: `music combat2 + booster bed + SFX, 3D pan + air absorption + reverb + glue comp + limiter  pk ${st.peakDb.toFixed(1)} rms ${st.rmsDb.toFixed(1)} dBFS` });
      if (opts.wav) out.wavs.scene_mix = Array.from(new Int16Array(x.map((v) => Math.max(-1, Math.min(1, v)) * 32767)));
      out.stats.scene_mix = st;
      const stems = {};
      for (const k of ['music', 'beds', 'sfx', 'voice']) stems[k] = mono((await scene(k)).buffer);
      const probe = (await scene('probe')).buffer;
      const COLS = 940 - 42;
      secMix.push({
        x: stems.sfx, noWave: true, noSpec: true, accent: '#ffb400', marks: full.marks,
        title: 'MIX HIERARCHY: short-term loudness of each stem in the same scene',
        sub: 'SFX transients stand clear above music and booster bed; ducking pulls music + beds down under cannon / explosions / blade hit / alarm; the LEDGER voice (white) sits above music + beds and ducks the music',
        curves: [
          { v: rmsCurve(stems.sfx, COLS), color: '#ffb400', label: 'SFX stem (dB)', lo: -54, hi: 0, width: 1.4 },
          { v: rmsCurve(stems.voice, COLS), color: '#f4f7f8', label: 'LEDGER comm voice', lo: -54, hi: 0, width: 1.6 },
          { v: rmsCurve(stems.beds, COLS), color: '#5ad1ff', label: 'booster + ambience beds', lo: -54, hi: 0 },
          { v: rmsCurve(stems.music, COLS), color: '#d68cff', label: 'music stem', lo: -54, hi: 0 },
        ],
      });
      const pm = probe.getChannelData(0), pw = probe.getChannelData(1);
      const mst = stats(stems.music);
      secMix.push({
        x: stems.music, marks: full.marks, accent: '#d68cff', title: 'SIDECHAIN: music stem + measured duck gains (probe through the duck stages)',
        sub: `green = music duck gain, cyan dashed = SFX-bus/bed duck gain (dB, -24..+3 scale)  music pk ${mst.peakDb.toFixed(1)} dBFS`,
        curves: [
          { v: gainCurve(pm, COLS), color: '#7cffb2', label: 'music duck gain', lo: -24, hi: 3, width: 2 },
          { v: gainCurve(pw, COLS), color: '#5ad1ff', label: 'world duck gain', lo: -24, hi: 3, width: 1.6, dash: [5, 3] },
        ],
      });
      out.stats.scene_stems = { music: stats(stems.music), beds: stats(stems.beds), sfx: stats(stems.sfx), voice: stats(stems.voice) };

      // ---- isolated engine demos (no music / beds): round-robin variance, distance, flybys, occlusion
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
      const bx = mono(burst.buffer);
      secEngine.push({ x: bx, marks: burst.marks, accent: '#ff9a3c', title: 'ENGINE: rifle x8 at 3.4 rps, as played in-game', sub: '4 round-robin variants (never the same twice in a row), ±70 cents, ±1.5 dB, 0-4 ms jitter, 12 m + foundry reverb' });
      const dist = await demo(6, (at) => {
        at(0.1, 'explosion_small', { pos: { x: 0, y: 5, z: -20 } }, '20 m');
        at(2.0, 'explosion_small', { pos: { x: 60, y: 8, z: -110 } }, '125 m');
        at(3.9, 'explosion_small', { pos: { x: -200, y: 10, z: -230 } }, '305 m (+0.6 s sound delay)');
      });
      secEngine.push({ x: mono(dist.buffer), marks: dist.marks, accent: '#ff5a4a', title: 'ENGINE: explosion_small at 20 / 125 / 305 m', sub: 'inverse distance model + air-absorption low-pass + distance reverb + speed-of-sound delay (equal-power 3D pan)' });
      const fly = await demo(3.2, (at) => {
        for (let k = 0; k < 5; k++) at(0.1 + k * 0.12, 'enemy_gun', { pos: { x: -90, y: 6, z: -120 } }, k ? '' : 'MT burst 150 m');
        const arrive = 0.1 + 150 / 360;
        for (let k = 0; k < 5; k++) {
          const t = arrive + k * 0.12;
          if (k === 1 || k === 3) at(t, 'impact_metal', { pos: { x: 0, y: 5, z: -9 } }, k === 1 ? 'hits armour' : '');
          else at(t, 'whiz', { pos: { x: (k - 2) * 2.5, y: 5.5, z: -8 } }, k ? '' : 'whiz-bys L/R');
        }
        at(1.6, 'impact_ground', { pos: { x: 6, y: 0.2, z: 14 } }, 'misses: ground');
        at(1.75, 'impact_ground', { pos: { x: -10, y: 0.2, z: 22 } });
        at(1.9, 'ricochet', { pos: { x: 14, y: 4, z: 18 } }, 'ricochet off a wall');
      });
      secEngine.push({ x: mono(fly.buffer), marks: fly.marks, accent: '#ff5a4a', title: 'ENGINE: enemy fire reaching the player (what audio.js derives from the projectile pool)', sub: 'muzzle at 150 m, then supersonic whiz-bys past the chest, armour pings, ground hits, ricochet whine' });
      const occ = await demo(4.4, (at) => {
        at(0.1, 'explosion_small', { pos: { x: -80, y: 6, z: -90 } }, '120 m, clear line of sight');
        at(2.2, 'explosion_small', { pos: { x: -80, y: 6, z: -90 }, occl: 1 }, 'same, behind a foundry block');
      });
      secEngine.push({ x: mono(occ.buffer), marks: occ.marks, accent: '#ff5a4a', title: 'ENGINE: line-of-sight occlusion A/B', sub: 'occluded (camera->source raycast blocked): low-pass x0.22, -5 dB dry, +0.3 reverb send (heard around the wall)' });
    } catch (e) { console.error('scene render failed', e && e.stack || e); }
    const sections = [
      { name: 'ADAPTIVE SCORE "WAKE PROTOCOL" — vertical layers crossfaded by game state / stage / boss / combat activity', color: '#d68cff', items: secMusic },
      { name: 'COMMS — handler LEDGER voice-over (recorded lines, live radio dressing)', color: '#e6eef0', items: secVo },
      { name: 'CONTINUOUS BEDS · 3D EMITTERS · REVERB · COMMS', color: '#5ad1ff', items: secBeds },
      { name: 'MIX — the in-game engine.js mixer rendered offline', color: '#ffb400', items: secMix },
      { name: 'ENGINE DEMOS — variance, distance, flybys, occlusion', color: '#ff5a4a', items: secEngine },
    ].filter((s) => s.items.length);
    if (sections.length) out.sheets.music = sheet(sections, 2, 940, 250, 'IRONWAKE — adaptive music · beds & emitters · reverb · comms · in-game mix', LEGEND);
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
    const warns = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); else if (m.type() === 'warning') warns.push(m.text()); });
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
    await page.waitForFunction(() => window.__game.audio.debug().comm === 'vo', null, { timeout: 8000 }).catch(() => {});
    const a3b = await page.evaluate(() => window.__game.audio.debug());
    rec('briefing: LEDGER recorded voice-over playing (not the synth fallback)', a3b.comm === 'vo', `comm=${a3b.comm} decoded VO lines=${a3b.vo}`);
    await page.click('.menu-briefing .menu-btn.primary', { timeout: 120000 });
    await page.waitForFunction(() => /explore|combat/.test(window.__game.audio.debug().musicState), null, { timeout: 30000 }).catch(() => {});
    const a4 = await page.evaluate(() => ({ d: window.__game.audio.debug(), s: window.__game.state }));
    rec('mission: combat score running', a4.s === 'playing' && /explore|combat/.test(a4.d.musicState), `state=${a4.s} music=${a4.d.musicState} plays=${JSON.stringify(a4.d.counts)}`);
    rec('leaving the briefing cut its voice-over', a4.d.comm !== 'vo' || a4.d.radio, `comm=${a4.d.comm}`);
    // the first radio beat fires 0.8 s of SIM time into the mission (slow on a CPU rasterizer)
    await page.waitForFunction(() => ((document.querySelector('.rd-en') || {}).textContent || '').length > 0, null, { timeout: 120000 }).catch(() => {});
    const a5 = await page.evaluate(() => ({ d: window.__game.audio.debug(), sub: (document.querySelector('.rd-en') || {}).textContent || '', t: window.__game.rawTime }));
    rec('mission start: LEDGER VO plays with the HUD subtitle', a5.d.comm === 'vo', `comm=${a5.d.comm} sim t=${(+a5.t).toFixed(1)} s subtitle="${a5.sub.slice(0, 60)}"`);
    // the B / C score sections render in the background; then a stage change jumps the score
    const t6 = Date.now();
    await page.waitForFunction(() => window.__game.audio.debug().musicSections >= 3, null, { timeout: 300000 }).catch(() => {});
    const a6 = await page.evaluate(() => window.__game.audio.debug());
    rec('music sections A/B/C rendered for all layers', a6.musicSections >= 3, `${a6.musicSections}/3 sections, +${((Date.now() - t6) / 1000).toFixed(1)} s, form so far "${a6.musicForm}"`);
    await page.evaluate(() => { const m = window.__game.mission; if (m && m.forceStage) m.forceStage(1); });
    await page.waitForFunction(() => /B$/.test(window.__game.audio.debug().musicForm), null, { timeout: 20000 }).catch(() => {});
    const a7 = await page.evaluate(() => window.__game.audio.debug());
    rec('stage 1: stinger + score jumps to section B on its hit', /B$/.test(a7.musicForm) && a7.counts && a7.counts.stage_stinger > 0, `form "${a7.musicForm}" music=${a7.musicState} stinger plays=${a7.counts && a7.counts.stage_stinger}`);
    rec('no console errors', errors.length === 0, errors.slice(0, 3).join(' | ') || `${warns.length} warning(s)${warns.length ? ': ' + warns.slice(0, 3).map((w) => w.slice(0, 160)).join(' | ') : ''}`);
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
    const res = await page.evaluate(pageMain, { ids: IDS, only: ONLY, wav: WAV, cats: CATS });
    const files = [];
    for (const [k, dataUrl] of Object.entries(res.sheets)) {
      const f = path.join(OUT, k === 'sfx' ? 'audio_sheet.png' : `audio_sheet_${k}.png`);
      fs.writeFileSync(f, Buffer.from(dataUrl.split(',')[1], 'base64'));
      files.push(f);
    }
    fs.writeFileSync(path.join(OUT, 'audio_sheet.json'), JSON.stringify(res.stats, null, 1));
    if (WAV) {
      const dir = path.join(OUT, 'audio'); fs.mkdirSync(dir, { recursive: true });
      for (const [id, s] of Object.entries(res.wavs)) writeWav(path.join(dir, `${id.replace(/[^\w.-]+/g, '_').slice(0, 48)}.wav`), s);
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

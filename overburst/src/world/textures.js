// ============================================================
//  world/textures.js — procedural CanvasTexture library.
//  Everything is generated at boot from code; zero external assets.
//  Owned by the world agent.
// ============================================================
import * as THREE from 'three';
import { mulberry32, smoothstep, clamp } from '../util/math.js';

// world units covered by one repeat of the ground texture.
// Deliberately large: the arena is 1 km across and mip-minification eats
// small-scale albedo detail long before it reaches the player's eye.
export const GROUND_TILE = 40;

const CACHE = new Map();
export function once(key, fn) {
  let v = CACHE.get(key);
  if (v === undefined) { v = fn(); CACHE.set(key, v); }
  return v;
}
export function disposeTextures() {
  for (const v of CACHE.values()) {
    if (!v) continue;
    if (v.isTexture) v.dispose();
    else for (const k in v) v[k]?.isTexture && v[k].dispose();
  }
  CACHE.clear();
}

// ------------------------------------------------------------------
//  canvas helpers
// ------------------------------------------------------------------
export function canvas2d(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

const hex = (r, g, b) => `rgb(${r | 0},${g | 0},${b | 0})`;

/** Seamless value-noise field (Float32Array, 0..1). */
function valueTile(size, freq, rnd) {
  freq = Math.max(2, freq | 0);
  const grid = new Float32Array(freq * freq);
  for (let i = 0; i < grid.length; i++) grid[i] = rnd();
  const out = new Float32Array(size * size);
  const sc = freq / size;
  for (let y = 0; y < size; y++) {
    const fy = y * sc, y0 = Math.floor(fy), ty = smoothstep(fy - y0);
    const ra = (y0 % freq) * freq, rb = ((y0 + 1) % freq) * freq;
    const row = y * size;
    for (let x = 0; x < size; x++) {
      const fx = x * sc, x0 = Math.floor(fx), tx = smoothstep(fx - x0);
      const xa = x0 % freq, xb = (x0 + 1) % freq;
      const a = grid[ra + xa], b = grid[ra + xb], c = grid[rb + xa], d = grid[rb + xb];
      const t0 = a + (b - a) * tx, t1 = c + (d - c) * tx;
      out[row + x] = t0 + (t1 - t0) * ty;
    }
  }
  return out;
}

/** Seamless fbm field in [0,1]. */
export function fbmField(size, { octaves = 5, base = 4, gain = 0.5, seed = 1 } = {}) {
  const rnd = mulberry32(seed >>> 0);
  const out = new Float32Array(size * size);
  let amp = 1, sum = 0, freq = base;
  for (let o = 0; o < octaves; o++) {
    const layer = valueTile(size, freq, rnd);
    for (let i = 0; i < out.length; i++) out[i] += layer[i] * amp;
    sum += amp; amp *= gain; freq *= 2;
  }
  const inv = 1 / sum;
  for (let i = 0; i < out.length; i++) out[i] *= inv;
  return out;
}

/** Ridged variant — good for cracks / crust. */
export function ridgeField(size, opts) {
  const f = fbmField(size, opts);
  for (let i = 0; i < f.length; i++) f[i] = 1 - Math.abs(f[i] * 2 - 1);
  return f;
}

function grayCanvas(size, field, lo = 0, hi = 255) {
  const c = canvas2d(size), g = c.getContext('2d');
  const img = g.createImageData(size, size), d = img.data;
  for (let i = 0, p = 0; i < field.length; i++, p += 4) {
    const v = lo + field[i] * (hi - lo);
    d[p] = d[p + 1] = d[p + 2] = v; d[p + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c;
}

/** Sobel a height canvas into a tangent-space normal map canvas. */
export function normalFromHeight(heightCanvas, strength = 2.2, size = 512) {
  const hc = canvas2d(size), hg = hc.getContext('2d');
  hg.drawImage(heightCanvas, 0, 0, size, size);
  const src = hg.getImageData(0, 0, size, size).data;
  const c = canvas2d(size), g = c.getContext('2d');
  const out = g.createImageData(size, size), d = out.data;
  const H = (x, y) => src[((((y % size) + size) % size) * size + (((x % size) + size) % size)) * 4] * 0.00392157;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (H(x + 1, y) - H(x - 1, y)) * strength;
      const dy = (H(x, y + 1) - H(x, y - 1)) * strength;
      const nx = -dx, ny = dy, nz = 1;
      const inv = 1 / Math.sqrt(nx * nx + ny * ny + 1);
      const i = (y * size + x) * 4;
      d[i] = (nx * inv * 0.5 + 0.5) * 255;
      d[i + 1] = (ny * inv * 0.5 + 0.5) * 255;
      d[i + 2] = (nz * inv * 0.5 + 0.5) * 255;
      d[i + 3] = 255;
    }
  }
  g.putImageData(out, 0, 0);
  return c;
}

export function tex(canvas, { srgb = false, repeat = 1, aniso = 16 } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  t.needsUpdate = true;
  return t;
}

// ------------------------------------------------------------------
//  GROUND — cracked concrete slabs, expansion joints, ash aggregate,
//  scorch, oil.  Albedo 1024 / normal 512 / roughness 512.
// ------------------------------------------------------------------
export function groundTextures() {
  return once('ground', () => {
    const S = 1024, rnd = mulberry32(1337);
    const c = canvas2d(S), g = c.getContext('2d');

    const macro = fbmField(S >> 1, { octaves: 5, base: 3, seed: 11 });
    const grit = fbmField(S >> 1, { octaves: 4, base: 24, seed: 12 });
    const ash = fbmField(S >> 1, { octaves: 5, base: 5, seed: 13 });

    // --- base concrete with macro mottling ---
    const base = canvas2d(S >> 1), bg = base.getContext('2d');
    const img = bg.createImageData(S >> 1, S >> 1), d = img.data;
    for (let i = 0, p = 0; i < macro.length; i++, p += 4) {
      const m = macro[i], gr = grit[i];
      const v = 90 + m * 66 + (gr - 0.5) * 34;
      d[p] = v * 1.015; d[p + 1] = v * 1.0; d[p + 2] = v * 0.955; d[p + 3] = 255;
    }
    bg.putImageData(img, 0, 0);
    g.imageSmoothingEnabled = true;
    g.drawImage(base, 0, 0, S, S);

    // --- slab grid (3x3 per tile) with per-slab tint + joints ---
    const N = 2, cell = S / N;
    for (let sy = 0; sy < N; sy++) {
      for (let sx = 0; sx < N; sx++) {
        const t = (rnd() - 0.5) * 0.30;
        g.globalCompositeOperation = t > 0 ? 'lighter' : 'multiply';
        g.globalAlpha = Math.abs(t);
        g.fillStyle = t > 0 ? '#3a352e' : '#c9c2b6';
        g.fillRect(sx * cell + 2, sy * cell + 2, cell - 4, cell - 4);
      }
    }
    g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;

    // expansion joints — dark recess + bright chamfer lip
    for (let i = 0; i <= N; i++) {
      const p = i * cell;
      g.strokeStyle = 'rgba(12,10,8,1.0)'; g.lineWidth = 11;
      g.beginPath(); g.moveTo(p, 0); g.lineTo(p, S); g.moveTo(0, p); g.lineTo(S, p); g.stroke();
      g.strokeStyle = 'rgba(214,206,190,0.55)'; g.lineWidth = 4.0;
      g.beginPath();
      g.moveTo(p - 7.5, 0); g.lineTo(p - 7.5, S); g.moveTo(0, p - 7.5); g.lineTo(S, p - 7.5);
      g.stroke();
      g.strokeStyle = 'rgba(26,22,18,0.6)'; g.lineWidth = 3.0;
      g.beginPath();
      g.moveTo(p + 7.2, 0); g.lineTo(p + 7.2, S); g.moveTo(0, p + 7.2); g.lineTo(S, p + 7.2);
      g.stroke();
    }

    // --- cracks: jittered random walks, some hugging joints ---
    g.lineCap = 'round';
    for (let k = 0; k < 22; k++) {
      let x = rnd() * S, y = rnd() * S, a = rnd() * Math.PI * 2;
      const len = 90 + rnd() * 330, w = 2.0 + rnd() * 3.4;
      g.strokeStyle = `rgba(16,13,11,${0.7 + rnd() * 0.3})`;
      g.lineWidth = w;
      g.beginPath(); g.moveTo(x, y);
      const steps = (len / 9) | 0;
      for (let s = 0; s < steps; s++) {
        a += (rnd() - 0.5) * 0.9;
        x += Math.cos(a) * 9; y += Math.sin(a) * 9;
        g.lineTo(x, y);
        if (rnd() < 0.08) { g.stroke(); g.beginPath(); g.moveTo(x, y); g.lineWidth = w * 0.55; }
      }
      g.stroke();
    }

    // --- spall patches: chipped concrete showing aggregate ---
    for (let k = 0; k < 20; k++) {
      const x = rnd() * S, y = rnd() * S, r = 6 + rnd() * 26;
      g.fillStyle = `rgba(46,41,35,${0.35 + rnd() * 0.3})`;
      g.beginPath();
      for (let i = 0; i <= 9; i++) {
        const a = (i / 9) * Math.PI * 2, rr = r * (0.6 + rnd() * 0.7);
        const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr;
        i ? g.lineTo(px, py) : g.moveTo(px, py);
      }
      g.closePath(); g.fill();
      g.fillStyle = 'rgba(168,160,146,0.5)';
      for (let i = 0; i < 26; i++) {
        g.fillRect(x + (rnd() - 0.5) * r * 1.6, y + (rnd() - 0.5) * r * 1.6, 1.6, 1.6);
      }
    }

    // --- ash drift overlay ---
    const ashC = canvas2d(S >> 1), ag = ashC.getContext('2d');
    const ai = ag.createImageData(S >> 1, S >> 1), ad = ai.data;
    for (let i = 0, p = 0; i < ash.length; i++, p += 4) {
      const m = clamp((ash[i] - 0.62) * 3.6, 0, 1);
      ad[p] = 142; ad[p + 1] = 138; ad[p + 2] = 130;
      ad[p + 3] = m * 120 * (0.35 + grit[i] * 0.7);
    }
    ag.putImageData(ai, 0, 0);
    g.drawImage(ashC, 0, 0, S, S);

    // --- scorch + oil ---
    for (let k = 0; k < 9; k++) {
      const x = rnd() * S, y = rnd() * S, r = 40 + rnd() * 150;
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      const dark = rnd() < 0.5;
      gr.addColorStop(0, dark ? 'rgba(16,13,11,0.6)' : 'rgba(58,38,24,0.4)');
      gr.addColorStop(0.55, dark ? 'rgba(16,13,11,0.22)' : 'rgba(58,38,24,0.16)');
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
    }

    // --- fine aggregate speckle ---
    for (let i = 0; i < 9000; i++) {
      const v = 40 + rnd() * 150, a = 0.05 + rnd() * 0.22;
      g.fillStyle = `rgba(${v},${v * 0.96},${v * 0.88},${a})`;
      g.fillRect(rnd() * S, rnd() * S, 1 + (rnd() < 0.15 ? 1 : 0), 1);
    }

    // --- height / roughness ---
    const hc = canvas2d(S >> 1), hg = hc.getContext('2d');
    const hi = hg.createImageData(S >> 1, S >> 1), hd = hi.data;
    for (let i = 0, p = 0; i < macro.length; i++, p += 4) {
      const v = 118 + (grit[i] - 0.5) * 90 + (macro[i] - 0.5) * 40 + clamp((ash[i] - 0.62) * 3.6, 0, 1) * 30;
      hd[p] = hd[p + 1] = hd[p + 2] = v; hd[p + 3] = 255;
    }
    hg.putImageData(hi, 0, 0);
    // stamp joints + cracks into height
    const hs = S >> 1, hcell = hs / N;
    hg.strokeStyle = '#080808'; hg.lineWidth = 6;
    for (let i = 0; i <= N; i++) {
      const p = i * hcell;
      hg.beginPath(); hg.moveTo(p, 0); hg.lineTo(p, hs); hg.moveTo(0, p); hg.lineTo(hs, p); hg.stroke();
    }
    hg.globalAlpha = 0.7; hg.drawImage(c, 0, 0, hs, hs); hg.globalAlpha = 1;

    const rc = canvas2d(S >> 2), rg = rc.getContext('2d');
    const rf = fbmField(S >> 2, { octaves: 4, base: 8, seed: 21 });
    const ri = rg.createImageData(S >> 2, S >> 2), rd = ri.data;
    for (let i = 0, p = 0; i < rf.length; i++, p += 4) {
      const v = 196 + rf[i] * 52;
      rd[p] = rd[p + 1] = rd[p + 2] = v; rd[p + 3] = 255;
    }
    rg.putImageData(ri, 0, 0);

    return {
      map: tex(c, { srgb: true }),
      normalMap: tex(normalFromHeight(hc, 2.6, 512)),
      roughnessMap: tex(rc),
    };
  });
}

// ------------------------------------------------------------------
//  CONCRETE — board-formed brutalist wall, tie holes, streaks.
//  Deliberately dirty: the previous pass read as chalk because the only
//  value variation was at the board-band frequency. Everything big here
//  (blooms, wash-down, soot fields) exists to break a 60 m wall into
//  patches so it does not read as one flat pour.
// ------------------------------------------------------------------
export function concreteTextures() {
  return once('concrete', () => {
    const S = 1024, rnd = mulberry32(4242);
    const c = canvas2d(S), g = c.getContext('2d');
    const macro = fbmField(S >> 1, { octaves: 5, base: 4, seed: 31 });
    const blot = fbmField(S >> 1, { octaves: 4, base: 2, seed: 33 });
    const grit = fbmField(S >> 1, { octaves: 4, base: 30, seed: 32 });

    const base = canvas2d(S >> 1), bg = base.getContext('2d');
    const im = bg.createImageData(S >> 1, S >> 1), d = im.data;
    for (let i = 0, p = 0; i < macro.length; i++, p += 4) {
      // big blotches carry +-28 % of the value: this is the single biggest
      // reason the wall stops looking like an untextured box.
      const bl = (blot[i] - 0.5) * 2.0;
      let v = 132 + macro[i] * 54 + (grit[i] - 0.5) * 24 + bl * 42;
      // soot loading in the low areas, bleached calcite in the high ones
      const soot = clamp(-bl * 1.4, 0, 1);
      v *= 1 - soot * 0.34;
      d[p] = v * (1.005 + soot * 0.03);
      d[p + 1] = v * (1.0 - soot * 0.01);
      d[p + 2] = v * (0.972 - soot * 0.05);
      d[p + 3] = 255;
    }
    bg.putImageData(im, 0, 0);
    g.drawImage(base, 0, 0, S, S);

    // horizontal shutter-board bands
    const bands = 12, bh = S / bands;
    for (let i = 0; i < bands; i++) {
      const y = i * bh;
      g.fillStyle = `rgba(${rnd() < 0.5 ? '255,252,246' : '20,17,14'},${0.03 + rnd() * 0.06})`;
      g.fillRect(0, y, S, bh);
      g.strokeStyle = 'rgba(18,15,13,0.62)'; g.lineWidth = 2.6;
      g.beginPath(); g.moveTo(0, y); g.lineTo(S, y); g.stroke();
      g.strokeStyle = 'rgba(198,190,176,0.13)'; g.lineWidth = 1.2;
      g.beginPath(); g.moveTo(0, y + 2.8); g.lineTo(S, y + 2.8); g.stroke();
    }

    // construction-joint / lift lines every fourth board, with a wash-down
    // stain hanging under each one
    for (let i = 0; i < bands; i += 4) {
      const y = i * bh;
      g.strokeStyle = 'rgba(14,11,9,0.7)'; g.lineWidth = 5.5;
      g.beginPath(); g.moveTo(0, y); g.lineTo(S, y); g.stroke();
      const gr = g.createLinearGradient(0, y, 0, y + bh * 1.4);
      gr.addColorStop(0, 'rgba(26,22,18,0.42)');
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.fillRect(0, y, S, bh * 1.4);
    }

    // form-tie holes on a grid
    for (let y = bh * 0.5; y < S; y += bh * 2) {
      for (let x = S / 16; x < S; x += S / 8) {
        const r = 4.5;
        g.fillStyle = 'rgba(20,17,14,0.85)';
        g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
        g.fillStyle = 'rgba(196,188,174,0.18)';
        g.beginPath(); g.arc(x - 1, y - 1.2, r * 0.8, 0, Math.PI * 2); g.fill();
        // rust weep out of the tie hole
        const gr = g.createLinearGradient(0, y, 0, y + 34);
        gr.addColorStop(0, 'rgba(72,42,22,0.4)');
        gr.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = gr; g.fillRect(x - 2.6, y, 5.2, 34);
      }
    }

    // vertical rust / water streaks — longer and denser than before
    for (let k = 0; k < 72; k++) {
      const x = rnd() * S, w = 2 + rnd() * 20, y0 = rnd() * S * 0.8, h = 120 + rnd() * 620;
      const gr = g.createLinearGradient(0, y0, 0, y0 + h);
      const warm = rnd() < 0.42;
      gr.addColorStop(0, warm ? 'rgba(80,46,24,0.46)' : 'rgba(24,21,18,0.44)');
      gr.addColorStop(0.35, warm ? 'rgba(80,46,24,0.22)' : 'rgba(24,21,18,0.2)');
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.fillRect(x, y0, w, h);
    }

    // chipped edges / spall showing dark aggregate
    for (let k = 0; k < 40; k++) {
      const x = rnd() * S, y = rnd() * S, r = 4 + rnd() * 16;
      g.fillStyle = `rgba(44,39,33,${0.45 + rnd() * 0.35})`;
      g.beginPath();
      for (let i = 0; i <= 7; i++) {
        const a = (i / 7) * Math.PI * 2, rr = r * (0.55 + rnd() * 0.8);
        const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr;
        i ? g.lineTo(px, py) : g.moveTo(px, py);
      }
      g.closePath(); g.fill();
      g.fillStyle = 'rgba(180,172,158,0.26)';
      g.beginPath(); g.arc(x - r * 0.3, y - r * 0.36, r * 0.5, 0, Math.PI * 2); g.fill();
      for (let i = 0; i < 12; i++) {
        g.fillStyle = `rgba(${(90 + rnd() * 90) | 0},${(84 + rnd() * 84) | 0},${(76 + rnd() * 76) | 0},0.5)`;
        g.fillRect(x + (rnd() - 0.5) * r * 1.5, y + (rnd() - 0.5) * r * 1.5, 1.7, 1.7);
      }
    }

    // a couple of sprayed stencils — unit codes on the pour
    stencilBlock(g, S * 0.16, S * 0.31, 130, 'B-07', 'rgba(28,24,20,0.5)');
    stencilBlock(g, S * 0.63, S * 0.74, 112, 'K4', 'rgba(150,116,44,0.34)');

    const hc = grayCanvas(S >> 1, grit, 96, 168);
    const hg2 = hc.getContext('2d');
    hg2.globalAlpha = 0.8; hg2.drawImage(c, 0, 0, S >> 1, S >> 1); hg2.globalAlpha = 1;

    return { map: tex(c, { srgb: true }), normalMap: tex(normalFromHeight(hc, 1.6, 512)) };
  });
}

/** Sprayed stencil lettering + frame, eroded on an offscreen alpha canvas and
 *  then composited. (Eroding in place with destination-out would punch holes
 *  in the albedo underneath and leave black speckles.)
 *  Deliberately low-contrast: at 17 m per texture repeat these are ~1 m tall
 *  marks and must not fight the silhouette. */
function stencilBlock(g, x, y, size, text, color, seed = 991) {
  const w = Math.ceil(size * 1.5), h = Math.ceil(size * 0.66);
  const c = canvas2d(w, h), s = c.getContext('2d');
  s.fillStyle = color;
  s.strokeStyle = color;
  s.lineWidth = Math.max(2, size * 0.035);
  s.strokeRect(size * 0.04, size * 0.04, w - size * 0.08, h - size * 0.08);
  s.font = `bold ${Math.round(size * 0.4)}px monospace`;
  s.textBaseline = 'middle';
  s.textAlign = 'center';
  s.fillText(text, w / 2, h / 2);
  // break the paint up so it reads as worn spray, not a decal
  s.globalCompositeOperation = 'destination-out';
  let st = seed >>> 0;
  const r = () => { st = (st * 9301 + 49297) % 233280; return st / 233280; };
  for (let i = 0; i < 110; i++) {
    s.fillStyle = `rgba(0,0,0,${0.2 + r() * 0.75})`;
    s.beginPath();
    s.arc(r() * w, r() * h, 1 + r() * size * 0.055, 0, Math.PI * 2);
    s.fill();
  }
  g.drawImage(c, x, y);
}

// ------------------------------------------------------------------
//  STEEL — rusted / repainted plate with panel lines and rivets.
// ------------------------------------------------------------------
export function steelTextures() {
  return once('steel', () => {
    const S = 1024, rnd = mulberry32(909);
    const c = canvas2d(S), g = c.getContext('2d');
    const macro = fbmField(S >> 1, { octaves: 5, base: 5, seed: 41 });
    const rustF = fbmField(S >> 1, { octaves: 5, base: 7, seed: 42 });
    const grit = fbmField(S >> 1, { octaves: 4, base: 34, seed: 43 });

    const base = canvas2d(S >> 1), bg = base.getContext('2d');
    const im = bg.createImageData(S >> 1, S >> 1), d = im.data;
    for (let i = 0, p = 0; i < macro.length; i++, p += 4) {
      // painted steel base
      let r = 132 + macro[i] * 52, gg = 130 + macro[i] * 48, b = 126 + macro[i] * 44;
      // rust bloom
      const rz = clamp((rustF[i] - 0.44) * 3.4, 0, 1) * (0.45 + grit[i] * 0.8);
      r = r + (162 - r) * rz; gg = gg + (84 - gg) * rz; b = b + (48 - b) * rz;
      const sp = (grit[i] - 0.5) * 26;
      d[p] = r + sp; d[p + 1] = gg + sp * 0.9; d[p + 2] = b + sp * 0.8; d[p + 3] = 255;
    }
    bg.putImageData(im, 0, 0);
    g.drawImage(base, 0, 0, S, S);

    // panel lines + rivet rows
    const P = 4, ps = S / P;
    for (let i = 0; i <= P; i++) {
      const p = i * ps;
      g.strokeStyle = 'rgba(18,15,13,0.6)'; g.lineWidth = 3;
      g.beginPath(); g.moveTo(p, 0); g.lineTo(p, S); g.moveTo(0, p); g.lineTo(S, p); g.stroke();
      g.strokeStyle = 'rgba(196,190,178,0.13)'; g.lineWidth = 1.4;
      g.beginPath(); g.moveTo(p + 2.2, 0); g.lineTo(p + 2.2, S); g.moveTo(0, p + 2.2); g.lineTo(S, p + 2.2); g.stroke();
      for (let q = 8; q < S; q += 26) {
        for (const [rx, ry] of [[p, q], [q, p]]) {
          g.fillStyle = 'rgba(210,204,192,0.16)';
          g.beginPath(); g.arc(rx - 1, ry - 1, 2.6, 0, Math.PI * 2); g.fill();
          g.fillStyle = 'rgba(24,20,17,0.4)';
          g.beginPath(); g.arc(rx + 0.8, ry + 0.8, 2.2, 0, Math.PI * 2); g.fill();
        }
      }
    }

    // oil drips
    for (let k = 0; k < 56; k++) {
      const x = rnd() * S, w = 1.5 + rnd() * 11, y0 = rnd() * S, h = 60 + rnd() * 340;
      const gr = g.createLinearGradient(0, y0, 0, y0 + h);
      gr.addColorStop(0, 'rgba(18,13,10,0.58)');
      gr.addColorStop(0.3, 'rgba(18,13,10,0.26)');
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.fillRect(x, y0, w, h);
    }
    // scratches
    for (let k = 0; k < 70; k++) {
      g.strokeStyle = `rgba(198,192,180,${0.05 + rnd() * 0.14})`;
      g.lineWidth = 0.8 + rnd();
      g.beginPath();
      const x = rnd() * S, y = rnd() * S, a = rnd() * Math.PI * 2, l = 12 + rnd() * 90;
      g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
    }
    // stencilled unit marks + a hazard flash
    stencilBlock(g, S * 0.07, S * 0.11, 150, 'MK-2', 'rgba(24,20,17,0.55)', 4001);
    stencilBlock(g, S * 0.55, S * 0.58, 128, '017', 'rgba(168,128,44,0.4)', 4002);
    stencilBlock(g, S * 0.30, S * 0.80, 110, 'DK', 'rgba(30,26,22,0.45)', 4003);

    const hc = grayCanvas(S >> 1, grit, 104, 152);
    const h2 = hc.getContext('2d');
    h2.strokeStyle = '#1a1a1a'; h2.lineWidth = 2;
    for (let i = 0; i <= P; i++) {
      const p = i * ((S >> 1) / P);
      h2.beginPath(); h2.moveTo(p, 0); h2.lineTo(p, S >> 1); h2.moveTo(0, p); h2.lineTo(S >> 1, p); h2.stroke();
    }
    h2.globalAlpha = 0.55; h2.drawImage(c, 0, 0, S >> 1, S >> 1); h2.globalAlpha = 1;

    const rc = canvas2d(256), rg = rc.getContext('2d');
    const rf = fbmField(256, { octaves: 4, base: 9, seed: 44 });
    const rim = rg.createImageData(256, 256), rd = rim.data;
    for (let i = 0, p = 0; i < rf.length; i++, p += 4) {
      const v = 112 + rf[i] * 120;
      rd[p] = rd[p + 1] = rd[p + 2] = v; rd[p + 3] = 255;
    }
    rg.putImageData(rim, 0, 0);

    return {
      map: tex(c, { srgb: true }),
      normalMap: tex(normalFromHeight(hc, 1.5, 512)),
      roughnessMap: tex(rc),
    };
  });
}

// ------------------------------------------------------------------
//  PAINTED PANEL — neutral base meant to be tinted by material.color
//  (containers, tanks, rolling stock).
// ------------------------------------------------------------------
export function paintTextures() {
  return once('paint', () => {
    const S = 512, rnd = mulberry32(77);
    const c = canvas2d(S), g = c.getContext('2d');
    const macro = fbmField(S, { octaves: 5, base: 5, seed: 51 });
    const wear = fbmField(S, { octaves: 5, base: 11, seed: 52 });
    const im = g.createImageData(S, S), d = im.data;
    for (let i = 0, p = 0; i < macro.length; i++, p += 4) {
      const v = 124 + macro[i] * 78;
      const rz = clamp((wear[i] - 0.52) * 3.4, 0, 1);
      const r = v + (126 - v) * rz, gg = v + (66 - v) * rz, b = v + (38 - v) * rz;
      d[p] = r; d[p + 1] = gg; d[p + 2] = b; d[p + 3] = 255;
    }
    g.putImageData(im, 0, 0);
    // scuffs & drips
    for (let k = 0; k < 60; k++) {
      const x = rnd() * S, y0 = rnd() * S, w = 1 + rnd() * 6, h = 20 + rnd() * 150;
      const gr = g.createLinearGradient(0, y0, 0, y0 + h);
      gr.addColorStop(0, 'rgba(48,32,20,0.4)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.fillRect(x, y0, w, h);
    }
    for (let k = 0; k < 34; k++) {
      g.strokeStyle = `rgba(60,54,46,${0.1 + rnd() * 0.3})`;
      g.lineWidth = 0.8 + rnd() * 2;
      const x = rnd() * S, y = rnd() * S, a = rnd() * Math.PI * 2, l = 10 + rnd() * 70;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
    }
    return { map: tex(c, { srgb: true }) };
  });
}

// ------------------------------------------------------------------
//  CONTAINER SKIN — weathered painted box steel.
//  NO corrugation baked in: the container prop carries real corrugated
//  geometry, and a second set of ribs from a normal map at a different
//  world phase would beat against it. What this carries is the stuff
//  geometry cannot: rust bloom, chalked paint, chipping, weld seams,
//  stencil blocks and the dirt that separates one box from the next.
//  Kept near-neutral in hue so the per-instance tint reads.
// ------------------------------------------------------------------
export function containerTextures() {
  return once('container', () => {
    const S = 512, rnd = mulberry32(3113);
    const c = canvas2d(S), g = c.getContext('2d');
    const macro = fbmField(S, { octaves: 5, base: 4, seed: 91 });
    const rust = fbmField(S, { octaves: 5, base: 9, seed: 92 });
    const grit = fbmField(S, { octaves: 4, base: 28, seed: 93 });

    const im = g.createImageData(S, S), d = im.data;
    for (let i = 0, p = 0; i < macro.length; i++, p += 4) {
      // chalked paint: uneven fade, never one flat value
      let v = 150 + macro[i] * 74 + (grit[i] - 0.5) * 22;
      let r = v, gg = v * 0.995, b = v * 0.985;
      // rust bloom — saturated enough that it survives a desaturated tint
      const rz = clamp((rust[i] - 0.50) * 3.6, 0, 1) * (0.4 + grit[i] * 0.9);
      r += (196 - r) * rz; gg += (92 - gg) * rz; b += (44 - b) * rz;
      // soot in the crevices
      const soot = clamp((0.36 - macro[i]) * 3.0, 0, 1);
      r *= 1 - soot * 0.4; gg *= 1 - soot * 0.42; b *= 1 - soot * 0.44;
      d[p] = r; d[p + 1] = gg; d[p + 2] = b; d[p + 3] = 255;
    }
    g.putImageData(im, 0, 0);

    // vertical rust runs (the read that says "this has stood outside")
    for (let k = 0; k < 60; k++) {
      const x = rnd() * S, w = 1.4 + rnd() * 9, y0 = rnd() * S, h = 50 + rnd() * 300;
      const gr = g.createLinearGradient(0, y0, 0, y0 + h);
      const warm = rnd() < 0.62;
      gr.addColorStop(0, warm ? 'rgba(124,62,26,0.5)' : 'rgba(22,18,15,0.46)');
      gr.addColorStop(0.4, warm ? 'rgba(124,62,26,0.2)' : 'rgba(22,18,15,0.18)');
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.fillRect(x, y0, w, h);
    }
    // paint chipped off to bare, rusting steel
    for (let k = 0; k < 54; k++) {
      const x = rnd() * S, y = rnd() * S, r = 2.5 + rnd() * 12;
      g.fillStyle = `rgba(${(96 + rnd() * 60) | 0},${(48 + rnd() * 26) | 0},${(24 + rnd() * 16) | 0},${0.4 + rnd() * 0.45})`;
      g.beginPath();
      for (let i = 0; i <= 6; i++) {
        const a = (i / 6) * Math.PI * 2, rr = r * (0.5 + rnd() * 0.9);
        const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr;
        i ? g.lineTo(px, py) : g.moveTo(px, py);
      }
      g.closePath(); g.fill();
    }
    // dents / creases
    for (let k = 0; k < 30; k++) {
      g.strokeStyle = `rgba(30,26,22,${0.12 + rnd() * 0.24})`;
      g.lineWidth = 1 + rnd() * 3;
      const x = rnd() * S, y = rnd() * S, a = rnd() * Math.PI * 2, l = 14 + rnd() * 70;
      g.beginPath(); g.moveTo(x, y);
      g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
    }
    // stencils: an owner code and a box number
    stencilBlock(g, S * 0.05, S * 0.12, 96, 'RBC', 'rgba(232,226,214,0.42)', 7701);
    stencilBlock(g, S * 0.58, S * 0.63, 84, '4471', 'rgba(228,222,210,0.34)', 7702);
    stencilBlock(g, S * 0.34, S * 0.40, 70, 'MAX', 'rgba(18,15,12,0.45)', 7703);

    // roughness: rust is rough, surviving paint is satin
    const rc = canvas2d(S >> 1), rg = rc.getContext('2d');
    const ri = rg.createImageData(S >> 1, S >> 1), rd = ri.data;
    const rf = fbmField(S >> 1, { octaves: 4, base: 9, seed: 94 });
    for (let i = 0, p = 0; i < rf.length; i++, p += 4) {
      const v = 150 + rf[i] * 92;
      rd[p] = rd[p + 1] = rd[p + 2] = v; rd[p + 3] = 255;
    }
    rg.putImageData(ri, 0, 0);

    const hc = grayCanvas(S, grit, 108, 150);
    const hg = hc.getContext('2d');
    hg.globalAlpha = 0.5; hg.drawImage(c, 0, 0, S, S); hg.globalAlpha = 1;

    return {
      map: tex(c, { srgb: true }),
      normalMap: tex(normalFromHeight(hc, 1.1, 256)),
      roughnessMap: tex(rc),
    };
  });
}

// ------------------------------------------------------------------
//  GROUND STAIN ATLAS — 2x2 quadrants of alpha-masked grime laid over
//  the tiled apron so a 900 m plain never reads as one repeating slab.
//    (0,0) soft ash drift    (1,0) slag / oil pool with a crusted rim
//    (0,1) wind-blown streak (1,1) tyre + track marks
//  UVs are inset 3 % per quadrant so mip filtering cannot bleed one
//  quadrant into its neighbour.
// ------------------------------------------------------------------
export const STAIN_UV = [
  [0.015, 0.015], [0.515, 0.015], [0.015, 0.515], [0.515, 0.515],
];
export const STAIN_SPAN = 0.47;

export function stainAtlas() {
  return once('stains', () => {
    const S = 512, Q = S >> 1, rnd = mulberry32(4649);
    const c = canvas2d(S), g = c.getContext('2d');
    g.clearRect(0, 0, S, S);

    const soft = fbmField(Q, { octaves: 5, base: 3, seed: 101 });
    const pool = ridgeField(Q, { octaves: 4, base: 4, seed: 102 });
    const fine = fbmField(Q, { octaves: 4, base: 14, seed: 103 });

    const put = (qx, qy, fn) => {
      const q = canvas2d(Q), qg = q.getContext('2d');
      const im = qg.createImageData(Q, Q), dd = im.data;
      for (let y = 0; y < Q; y++) {
        for (let x = 0; x < Q; x++) {
          const i = y * Q + x, p = i * 4;
          // radial falloff so every patch has a soft edge into the ground
          const dx = (x / Q - 0.5) * 2, dy = (y / Q - 0.5) * 2;
          const edge = clamp(1 - Math.sqrt(dx * dx + dy * dy), 0, 1);
          fn(x / Q, y / Q, i, edge, dd, p);
        }
      }
      qg.putImageData(im, 0, 0);
      g.drawImage(q, qx * Q, qy * Q);
    };

    // (0,0) soft ash drift — pale, dusty
    put(0, 0, (u, v, i, edge, dd, p) => {
      const a = clamp((soft[i] - 0.34) * 2.0, 0, 1) * Math.pow(edge, 1.5);
      dd[p] = 255; dd[p + 1] = 250; dd[p + 2] = 240; dd[p + 3] = a * 255;
    });
    // (1,0) slag / oil pool — hard crusted rim, dark wet centre
    put(1, 0, (u, v, i, edge, dd, p) => {
      const core = clamp((soft[i] * 0.6 + edge * 0.9 - 0.52) * 4.2, 0, 1);
      const rim = clamp(1 - Math.abs(core - 0.42) * 4.0, 0, 1);
      const a = clamp(core * 0.95 + rim * 0.35, 0, 1) * Math.pow(edge, 0.7);
      const crust = clamp(pool[i] * 1.3 - 0.2, 0, 1);
      dd[p] = 255 * (0.5 + crust * 0.5);
      dd[p + 1] = 255 * (0.42 + crust * 0.5);
      dd[p + 2] = 255 * (0.38 + crust * 0.5);
      dd[p + 3] = a * 255;
    });
    // (0,1) wind-blown streak — stretched along U
    put(0, 1, (u, v, i, edge, dd, p) => {
      const s = soft[(((v * Q) | 0) * Q + (((u * Q * 0.28) | 0) % Q))] || soft[i];
      const band = clamp((s - 0.36) * 2.4, 0, 1);
      const a = band * Math.pow(clamp(1 - Math.abs(v - 0.5) * 2.1, 0, 1), 1.2)
        * clamp(1 - Math.abs(u - 0.5) * 2.0, 0, 1);
      dd[p] = 255; dd[p + 1] = 246; dd[p + 2] = 232; dd[p + 3] = a * 230;
    });
    // (1,1) tyre / track marks — two treaded bands
    put(1, 1, (u, v, i, edge, dd, p) => {
      const lane = Math.min(Math.abs(v - 0.31), Math.abs(v - 0.69));
      const across = clamp(1 - lane * 9.0, 0, 1);
      const tread = 0.55 + 0.45 * Math.sin(u * Math.PI * 2 * 26 + (v > 0.5 ? 1.3 : 0));
      const a = across * tread * clamp(1 - Math.abs(u - 0.5) * 2.05, 0, 1)
        * (0.55 + fine[i] * 0.8);
      dd[p] = 255; dd[p + 1] = 248; dd[p + 2] = 240; dd[p + 3] = clamp(a, 0, 1) * 255;
    });

    const t = tex(c);
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    return t;
  });
}

/** Vertical corrugation normal map (containers, silos, cladding). */
export function corrugatedNormal(ribs = 22) {
  return once('corr' + ribs, () => {
    const S = 256, c = canvas2d(S), g = c.getContext('2d');
    const im = g.createImageData(S, S), d = im.data;
    for (let x = 0; x < S; x++) {
      const t = (x / S) * ribs * Math.PI * 2;
      const nx = Math.sin(t) * 0.85;
      const inv = 1 / Math.sqrt(nx * nx + 1);
      const r = (nx * inv * 0.5 + 0.5) * 255, b = (inv * 0.5 + 0.5) * 255;
      for (let y = 0; y < S; y++) {
        const p = (y * S + x) * 4;
        d[p] = r; d[p + 1] = 128; d[p + 2] = b; d[p + 3] = 255;
      }
    }
    g.putImageData(im, 0, 0);
    return tex(c);
  });
}

// ------------------------------------------------------------------
//  SLAG — dark vitrified crust with molten cracks (albedo + emissive)
// ------------------------------------------------------------------
export function slagTextures() {
  return once('slag', () => {
    const S = 512;
    const crust = fbmField(S, { octaves: 5, base: 6, seed: 61 });
    const veins = ridgeField(S, { octaves: 4, base: 5, seed: 62 });
    const fine = fbmField(S, { octaves: 4, base: 26, seed: 63 });

    const c = canvas2d(S), g = c.getContext('2d');
    const im = g.createImageData(S, S), d = im.data;
    const ec = canvas2d(S), eg = ec.getContext('2d');
    const eim = eg.createImageData(S, S), ed = eim.data;
    const rc = canvas2d(S), rg = rc.getContext('2d');
    const rim = rg.createImageData(S, S), rd = rim.data;

    for (let i = 0, p = 0; i < crust.length; i++, p += 4) {
      const heat = clamp((veins[i] - 0.72) * 5.2, 0, 1) * clamp(crust[i] * 1.6, 0, 1);
      const k = 24 + crust[i] * 26 + (fine[i] - 0.5) * 18;
      d[p] = k * 1.15 + heat * 150;
      d[p + 1] = k * 0.95 + heat * 62;
      d[p + 2] = k * 0.86 + heat * 16;
      d[p + 3] = 255;
      const e = Math.pow(heat, 1.35);
      ed[p] = 255 * e; ed[p + 1] = 108 * e * e; ed[p + 2] = 26 * e * e * e; ed[p + 3] = 255;
      const rv = 210 - heat * 130 + (fine[i] - 0.5) * 40;
      rd[p] = rd[p + 1] = rd[p + 2] = rv; rd[p + 3] = 255;
    }
    g.putImageData(im, 0, 0);
    eg.putImageData(eim, 0, 0);
    rg.putImageData(rim, 0, 0);

    const hc = grayCanvas(S, crust, 70, 190);
    return {
      map: tex(c, { srgb: true }),
      emissiveMap: tex(ec, { srgb: true }),
      roughnessMap: tex(rc),
      normalMap: tex(normalFromHeight(hc, 3.0, 256)),
    };
  });
}

// ------------------------------------------------------------------
//  Emissive strips / hazard / markings
// ------------------------------------------------------------------
export function windowStripTexture() {
  return once('windows', () => {
    const W = 512, H = 128, rnd = mulberry32(2211);
    const c = canvas2d(W, H), g = c.getContext('2d');
    g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
    const cols = 32, rows = 3;
    for (let r = 0; r < rows; r++) {
      for (let i = 0; i < cols; i++) {
        const on = rnd();
        const x = i * (W / cols) + 2, y = r * (H / rows) + 5, w = W / cols - 5, h = H / rows - 11;
        if (on > 0.62) {
          const v = 0.35 + rnd() * 0.65;
          g.fillStyle = `rgba(255,${(176 + rnd() * 50) | 0},${(96 + rnd() * 60) | 0},${v})`;
        } else if (on > 0.4) {
          g.fillStyle = `rgba(52,48,44,0.7)`;
        } else {
          g.fillStyle = `rgba(10,9,8,1)`;
        }
        g.fillRect(x, y, w, h);
      }
    }
    return tex(c, { srgb: true });
  });
}

export function hazardTexture() {
  return once('hazard', () => {
    const S = 256, rnd = mulberry32(5); const c = canvas2d(S), g = c.getContext('2d');
    g.fillStyle = '#2a2723'; g.fillRect(0, 0, S, S);
    g.save(); g.translate(S / 2, S / 2); g.rotate(-Math.PI / 4); g.translate(-S, -S);
    for (let i = 0; i < 16; i++) {
      g.fillStyle = i % 2 ? '#b8891f' : '#231f1b';
      g.fillRect(i * (S * 2 / 16), 0, S * 2 / 16, S * 2);
    }
    g.restore();
    for (let k = 0; k < 200; k++) {
      g.fillStyle = `rgba(${30 + rnd() * 60},${28 + rnd() * 50},${24 + rnd() * 40},${rnd() * 0.5})`;
      const x = rnd() * S, y = rnd() * S, r = 1 + rnd() * 12;
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    }
    return tex(c, { srgb: true });
  });
}

/** Road markings — transparent, tiles along the road's length (v axis). */
export function markingTexture() {
  return once('marking', () => {
    const W = 256, H = 256, rnd = mulberry32(88);
    const c = canvas2d(W, H), g = c.getContext('2d');
    g.clearRect(0, 0, W, H);
    // edge lines
    g.fillStyle = 'rgba(214,206,188,0.68)';
    g.fillRect(10, 0, 7, H); g.fillRect(W - 17, 0, 7, H);
    // dashed centre
    g.fillStyle = 'rgba(206,176,96,0.62)';
    for (let y = 0; y < H; y += 64) g.fillRect(W / 2 - 4, y + 8, 8, 40);
    // chevrons near one edge
    g.strokeStyle = 'rgba(198,158,60,0.4)'; g.lineWidth = 5;
    for (let y = 0; y < H; y += 32) {
      g.beginPath(); g.moveTo(30, y); g.lineTo(58, y + 16); g.lineTo(30, y + 32); g.stroke();
    }
    // wear: punch holes out of the paint
    g.globalCompositeOperation = 'destination-out';
    for (let k = 0; k < 420; k++) {
      const x = rnd() * W, y = rnd() * H, r = 1 + rnd() * 9;
      g.fillStyle = `rgba(0,0,0,${0.25 + rnd() * 0.7})`;
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    }
    g.globalCompositeOperation = 'source-over';
    return tex(c, { srgb: true });
  });
}

/** Steel walkway grating. */
export function grateTextures() {
  return once('grate', () => {
    const S = 256, c = canvas2d(S), g = c.getContext('2d');
    g.fillStyle = '#211e1b'; g.fillRect(0, 0, S, S);
    g.strokeStyle = '#6a635a'; g.lineWidth = 6;
    for (let i = 0; i < 8; i++) {
      const p = i * (S / 8) + 3;
      g.beginPath(); g.moveTo(p, 0); g.lineTo(p, S); g.stroke();
    }
    g.strokeStyle = '#4a443c'; g.lineWidth = 3;
    for (let i = 0; i < 16; i++) {
      const p = i * (S / 16) + 2;
      g.beginPath(); g.moveTo(0, p); g.lineTo(S, p); g.stroke();
    }
    const hc = canvas2d(S), hg = hc.getContext('2d');
    hg.fillStyle = '#303030'; hg.fillRect(0, 0, S, S);
    hg.drawImage(c, 0, 0);
    return { map: tex(c, { srgb: true }), normalMap: tex(normalFromHeight(hc, 2.0, 256)) };
  });
}

// ------------------------------------------------------------------
//  Sprite / volumetric helpers
// ------------------------------------------------------------------
export function smokeTexture() {
  return once('smoke', () => {
    const S = 128, c = canvas2d(S), g = c.getContext('2d');
    const f = fbmField(S, { octaves: 5, base: 4, seed: 71 });
    const im = g.createImageData(S, S), d = im.data;
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const i = y * S + x, p = i * 4;
        const dx = (x / S - 0.5) * 2, dy = (y / S - 0.5) * 2;
        const r = Math.sqrt(dx * dx + dy * dy);
        const edge = clamp(1 - r, 0, 1);
        const a = Math.pow(edge, 1.7) * (0.42 + f[i] * 0.9);
        d[p] = 255; d[p + 1] = 255; d[p + 2] = 255;
        d[p + 3] = clamp(a, 0, 1) * 255;
      }
    }
    g.putImageData(im, 0, 0);
    return tex(c);
  });
}

export function glowTexture() {
  return once('glow', () => {
    const S = 64, c = canvas2d(S), g = c.getContext('2d');
    const gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.18, 'rgba(255,255,255,0.82)');
    gr.addColorStop(0.45, 'rgba(255,255,255,0.22)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, S, S);
    return tex(c);
  });
}

export function hazeTexture() {
  return once('haze', () => {
    const S = 256, c = canvas2d(S), g = c.getContext('2d');
    const f = fbmField(S, { octaves: 5, base: 3, seed: 81 });
    const f2 = fbmField(S, { octaves: 4, base: 9, seed: 82 });
    const im = g.createImageData(S, S), d = im.data;
    for (let i = 0, p = 0; i < f.length; i++, p += 4) {
      const a = clamp((f[i] * 0.7 + f2[i] * 0.3 - 0.36) * 2.1, 0, 1);
      d[p] = 255; d[p + 1] = 244; d[p + 2] = 228; d[p + 3] = a * 255;
    }
    g.putImageData(im, 0, 0);
    return tex(c);
  });
}

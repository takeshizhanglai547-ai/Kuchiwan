// src/render/proctex.js — procedural canvas textures for PLACEHOLDER art
// (owner: render engineer). Deterministic (fixed internal seeds), cached per key.
// Real art should come from Blender bakes / texture files listed in src/manifest.js.
import * as THREE from 'three';
import { RandomStream } from '../core/rng.js';

const cache = new Map();

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function finish(canvas, { srgb = true, repeat = true } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  t.userData.shared = true; // cached: never disposed by disposeObject()
  return t;
}

/** Value-noise grain + blotches into ImageData (in place). */
function grain(ctx, w, h, r, amount, blotches, blotchAlpha) {
  for (let i = 0; i < blotches; i++) {
    const x = r.next() * w, y = r.next() * h, rad = r.range(8, w * 0.18);
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    const dark = r.chance(0.6);
    g.addColorStop(0, dark ? `rgba(20,16,12,${blotchAlpha})` : `rgba(255,245,230,${blotchAlpha * 0.5})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (r.next() - 0.5) * amount;
    d[i] = Math.max(0, Math.min(255, d[i] + n));
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n));
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n));
  }
  ctx.putImageData(img, 0, 0);
}

/** Concrete slabs with seams, oil stains and faded paint lines. */
export function concreteTexture(size = 512) {
  const key = 'concrete' + size;
  if (cache.has(key)) return cache.get(key);
  const r = new RandomStream(101);
  const c = makeCanvas(size, size), ctx = c.getContext('2d');
  ctx.fillStyle = '#6b6862'; ctx.fillRect(0, 0, size, size);
  grain(ctx, size, size, r, 26, 60, 0.18);
  // Slab seams
  ctx.strokeStyle = 'rgba(25,22,20,0.7)'; ctx.lineWidth = 2;
  const slabs = 4;
  for (let i = 0; i <= slabs; i++) {
    const p = (i / slabs) * size;
    ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, size); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(size, p); ctx.stroke();
  }
  // Cracks
  ctx.strokeStyle = 'rgba(30,26,22,0.5)'; ctx.lineWidth = 1;
  for (let k = 0; k < 14; k++) {
    let x = r.next() * size, y = r.next() * size;
    ctx.beginPath(); ctx.moveTo(x, y);
    for (let s = 0; s < 8; s++) { x += r.sym(18); y += r.sym(18); ctx.lineTo(x, y); }
    ctx.stroke();
  }
  const t = finish(c);
  cache.set(key, t);
  return t;
}

/** Diagonal hazard stripes (yellow / black) with wear. */
export function hazardTexture(size = 256) {
  const key = 'hazard' + size;
  if (cache.has(key)) return cache.get(key);
  const r = new RandomStream(202);
  const c = makeCanvas(size, size), ctx = c.getContext('2d');
  ctx.fillStyle = '#1a1816'; ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = '#c9a019';
  const w = size / 4;
  for (let i = -4; i < 8; i++) {
    ctx.beginPath();
    ctx.moveTo(i * w * 2, 0); ctx.lineTo(i * w * 2 + w, 0);
    ctx.lineTo(i * w * 2 + w + size, size); ctx.lineTo(i * w * 2 + size, size);
    ctx.closePath(); ctx.fill();
  }
  grain(ctx, size, size, r, 40, 40, 0.35);
  const t = finish(c);
  cache.set(key, t);
  return t;
}

/** Painted / weathered metal panels. base: css color. */
export function metalTexture(base = '#4a4d50', size = 512, seed = 303) {
  const key = `metal${base}${size}${seed}`;
  if (cache.has(key)) return cache.get(key);
  const r = new RandomStream(seed);
  const c = makeCanvas(size, size), ctx = c.getContext('2d');
  ctx.fillStyle = base; ctx.fillRect(0, 0, size, size);
  grain(ctx, size, size, r, 18, 50, 0.22);
  // Panel lines
  ctx.strokeStyle = 'rgba(10,10,10,0.55)'; ctx.lineWidth = 2;
  for (let i = 0; i < 6; i++) {
    const x = r.int(0, size), y = r.int(0, size);
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, size); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(size, y); ctx.stroke();
  }
  // Rust streaks
  for (let i = 0; i < 24; i++) {
    const x = r.next() * size, y = r.next() * size, len = r.range(20, 120);
    const g = ctx.createLinearGradient(x, y, x, y + len);
    g.addColorStop(0, 'rgba(110,55,25,0.45)'); g.addColorStop(1, 'rgba(110,55,25,0)');
    ctx.fillStyle = g; ctx.fillRect(x, y, r.range(2, 6), len);
  }
  // Scratches
  ctx.strokeStyle = 'rgba(200,200,190,0.25)'; ctx.lineWidth = 1;
  for (let i = 0; i < 40; i++) {
    const x = r.next() * size, y = r.next() * size;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + r.sym(30), y + r.sym(6)); ctx.stroke();
  }
  const t = finish(c);
  cache.set(key, t);
  return t;
}

/** Soft round sprite (white, alpha falloff) — default particle texture. */
export function softDotTexture(size = 64) {
  const key = 'dot' + size;
  if (cache.has(key)) return cache.get(key);
  const c = makeCanvas(size, size), ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.6)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
  const t = finish(c, { srgb: false, repeat: false });
  cache.set(key, t);
  return t;
}

/** Puffy smoke sprite (white, noisy alpha). */
export function smokeTexture(size = 128) {
  const key = 'smoke' + size;
  if (cache.has(key)) return cache.get(key);
  const r = new RandomStream(404);
  const c = makeCanvas(size, size), ctx = c.getContext('2d');
  for (let i = 0; i < 26; i++) {
    const a = r.next() * Math.PI * 2, d = r.range(0, size * 0.22);
    const x = size / 2 + Math.cos(a) * d, y = size / 2 + Math.sin(a) * d, rad = r.range(size * 0.12, size * 0.3);
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, 'rgba(255,255,255,0.28)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
  }
  const t = finish(c, { srgb: false, repeat: false });
  cache.set(key, t);
  return t;
}

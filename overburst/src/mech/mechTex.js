// ============================================================
//  mechTex — procedural CanvasTexture generation + the shared
//  material set every mech is built from.
//  [owned by mech-model agent]
//
//  Everything here is drawn in code. No image files, no network.
//  Textures are generated once and cached at module scope; each mech
//  gets its OWN cloned material set (so setDamage / setThrust are
//  per-unit) but they all reference the same GPU textures.
// ============================================================
import * as THREE from 'three';
import { mulberry32 } from '../util/math.js';

// ------------------------------------------------------------------
//  decal atlas tile ids (4x4 grid, row 0 = top row of the canvas)
// ------------------------------------------------------------------
export const DECAL = {
  CHEVRON_Y: 0, CHEVRON_O: 1, NUM_07: 2, NUM_24: 3,
  CODE: 4, WARNTRI: 5, DATAPLATE: 6, ARROW: 7,
  ROUNDEL: 8, GRATE: 9, BOLTRING: 10, BARCODE: 11,
  TREAD: 12, STRIPE: 13, DANGER: 14, SCUFF: 15,
};

const TAU = Math.PI * 2;
let CACHE = null;

function mkCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function tex(canvas, { srgb = true, repeat = true, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.anisotropy = aniso;
  t.needsUpdate = true;
  return t;
}

// draw fn nine times so localised marks wrap across the tile seam
function wrapped(g, S, fn) {
  for (let ox = -1; ox <= 1; ox++) {
    for (let oy = -1; oy <= 1; oy++) {
      if (ox === 0 && oy === 0) { fn(); continue; }
      g.save(); g.translate(ox * S, oy * S); fn(); g.restore();
    }
  }
}

// ==================================================================
//  1. HULL SURFACE  — albedo + ORM, drawn from the same RNG stream so
//     the two maps line up exactly.
//     1 tile == HULL_TILE world units.
// ==================================================================
export const HULL_TILE = 4.0;

function panelLayout(S, seed) {
  const R = mulberry32(seed);
  const out = [];
  (function split(x, y, w, h, depth) {
    if (depth <= 0 || (w < S * 0.075 && h < S * 0.075) || (depth < 4 && R() < 0.22)) {
      out.push({ x, y, w, h, v: R() });
      return;
    }
    if (w >= h) {
      const t = w * (0.3 + R() * 0.4);
      split(x, y, t, h, depth - 1); split(x + t, y, w - t, h, depth - 1);
    } else {
      const t = h * (0.3 + R() * 0.4);
      split(x, y, w, t, depth - 1); split(x, y + t, w, h - t, depth - 1);
    }
  })(0, 0, S, S, 6);
  return out;
}

// mode: 'albedo' | 'orm'
function drawHull(S, mode) {
  const cv = mkCanvas(S, S);
  const g = cv.getContext('2d');
  const R = mulberry32(20250801);
  const A = mode === 'albedo';

  // ---- base coat -------------------------------------------------
  // orm: R = AO, G = roughness, B = metalness
  g.fillStyle = A ? '#d2d5d9' : 'rgb(255,132,112)';
  g.fillRect(0, 0, S, S);

  // ---- large scale paint mottling --------------------------------
  g.globalAlpha = A ? 0.22 : 0.10;
  for (let i = 0; i < 26; i++) {
    const x = R() * S, y = R() * S, r = S * (0.06 + R() * 0.16);
    const dark = R() < 0.5;
    wrapped(g, S, () => {
      const grd = g.createRadialGradient(x, y, 0, x, y, r);
      const c = A ? (dark ? '28,30,35' : '250,251,255') : (dark ? '255,176,86' : '255,112,140');
      grd.addColorStop(0, `rgba(${c},1)`);
      grd.addColorStop(1, `rgba(${c},0)`);
      g.fillStyle = grd; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
    });
  }
  g.globalAlpha = 1;

  // ---- panels ----------------------------------------------------
  const panels = panelLayout(S, 7717);
  for (const p of panels) {
    // plate value variance
    const j = (p.v - 0.5) * (A ? 20 : 10);
    if (A) {
      g.fillStyle = `rgb(${(208 + j * 1.4) | 0},${(210 + j * 1.4) | 0},${(214 + j * 1.4) | 0})`;
    } else {
      g.fillStyle = `rgb(255,${(132 + j) | 0},${(112 - j * 0.5) | 0})`;
    }
    g.globalAlpha = 0.55;
    g.fillRect(p.x + 1, p.y + 1, p.w - 2, p.h - 2);
    g.globalAlpha = 1;
  }

  // panel grooves — dark core + a bright catch-light on the lower lip
  const gw = Math.max(3, S / 190);
  for (const p of panels) {
    // groove (drawn as an inset dark rounded rect stroke)
    g.lineWidth = gw;
    g.strokeStyle = A ? 'rgba(24,26,30,0.94)' : 'rgba(96,212,74,0.92)';
    g.strokeRect(p.x + gw * 0.5, p.y + gw * 0.5, p.w - gw, p.h - gw);
    // soft AO bleed either side of the groove
    g.lineWidth = gw * 3.2;
    g.strokeStyle = A ? 'rgba(36,38,42,0.3)' : 'rgba(140,196,86,0.36)';
    g.strokeRect(p.x + gw * 0.5, p.y + gw * 0.5, p.w - gw, p.h - gw);
    // catch-light
    g.lineWidth = Math.max(1, gw * 0.42);
    g.strokeStyle = A ? 'rgba(252,252,248,0.3)' : 'rgba(255,92,250,0.6)';
    g.beginPath();
    g.moveTo(p.x + gw * 1.4, p.y + p.h - gw * 1.4);
    g.lineTo(p.x + p.w - gw * 1.4, p.y + p.h - gw * 1.4);
    g.moveTo(p.x + p.w - gw * 1.4, p.y + gw * 1.4);
    g.lineTo(p.x + p.w - gw * 1.4, p.y + p.h - gw * 1.4);
    g.stroke();
  }

  // ---- rivet / bolt rows along some panel edges -------------------
  const rr = Math.max(2.0, S / 300);
  for (const p of panels) {
    if (R() > 0.34) continue;
    const n = Math.max(2, Math.round(p.w / (S * 0.045)));
    const yy = p.y + (R() < 0.5 ? gw * 3.0 : p.h - gw * 3.0);
    for (let i = 0; i < n; i++) {
      const xx = p.x + p.w * ((i + 0.5) / n);
      if (A) {
        g.fillStyle = 'rgba(26,27,30,0.55)';
        g.beginPath(); g.arc(xx, yy + rr * 0.85, rr * 1.15, 0, TAU); g.fill();
        g.fillStyle = 'rgba(222,222,216,0.7)';
        g.beginPath(); g.arc(xx, yy, rr, 0, TAU); g.fill();
      } else {
        g.fillStyle = 'rgba(255,90,250,0.85)';
        g.beginPath(); g.arc(xx, yy, rr, 0, TAU); g.fill();
      }
    }
  }

  // ---- vertical grime / oil streaks (V axis == world down) --------
  for (let i = 0; i < 90; i++) {
    const x = R() * S, y = R() * S;
    const w = S * (0.004 + R() * 0.016);
    const h = S * (0.05 + R() * 0.30);
    const a = 0.07 + R() * 0.22;
    wrapped(g, S, () => {
      const grd = g.createLinearGradient(0, y, 0, y + h);
      const c = A ? '26,22,18' : '150,216,64';
      grd.addColorStop(0, `rgba(${c},${a})`);
      grd.addColorStop(0.25, `rgba(${c},${a * 0.75})`);
      grd.addColorStop(1, `rgba(${c},0)`);
      g.fillStyle = grd;
      g.fillRect(x, y, w, h);
    });
  }

  // ---- rust / scorch blooms --------------------------------------
  for (let i = 0; i < 16; i++) {
    const x = R() * S, y = R() * S, r = S * (0.012 + R() * 0.04);
    wrapped(g, S, () => {
      const grd = g.createRadialGradient(x, y, 0, x, y, r);
      const c = A ? '104,60,38' : '182,236,40';
      grd.addColorStop(0, `rgba(${c},0.26)`);
      grd.addColorStop(1, `rgba(${c},0)`);
      g.fillStyle = grd; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
    });
  }

  // ---- chipped paint speckle (bare metal) ------------------------
  for (let i = 0; i < 620; i++) {
    const x = R() * S, y = R() * S;
    const w = 1 + R() * (S / 220), h = 1 + R() * (S / 260);
    g.fillStyle = A
      ? (R() < 0.45 ? 'rgba(236,234,228,0.22)' : 'rgba(30,28,26,0.34)')
      : 'rgba(255,84,252,0.34)';
    g.fillRect(x, y, w, h);
  }

  // ---- fine noise ------------------------------------------------
  const img = g.getImageData(0, 0, S, S);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (R() - 0.5) * (A ? 15 : 8);
    d[i] += n * 1.05; d[i + 1] += n; d[i + 2] += n * 1.1;
  }
  g.putImageData(img, 0, 0);
  return cv;
}

// ==================================================================
//  2. EMBER map — mostly black with cracked veins. Used as the
//     emissiveMap so battle damage glows in patches, not uniformly.
// ==================================================================
function drawEmber(S) {
  const cv = mkCanvas(S, S);
  const g = cv.getContext('2d');
  const R = mulberry32(48211);
  g.fillStyle = '#000'; g.fillRect(0, 0, S, S);
  g.lineCap = 'round';
  for (let i = 0; i < 46; i++) {
    let x = R() * S, y = R() * S;
    let a = R() * TAU;
    const segs = 4 + ((R() * 7) | 0);
    wrapped(g, S, () => {
      let px = x, py = y, pa = a;
      for (let s = 0; s < segs; s++) {
        const len = S * (0.01 + R() * 0.045);
        const nx = px + Math.cos(pa) * len, ny = py + Math.sin(pa) * len;
        g.strokeStyle = `rgba(255,${180 + ((R() * 60) | 0)},${120 + ((R() * 80) | 0)},${0.5 + R() * 0.5})`;
        g.lineWidth = Math.max(1, S / 260) * (1.6 - s / segs);
        g.beginPath(); g.moveTo(px, py); g.lineTo(nx, ny); g.stroke();
        px = nx; py = ny; pa += (R() - 0.5) * 1.4;
      }
    });
  }
  // soft hot blooms behind the veins
  g.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 30; i++) {
    const x = R() * S, y = R() * S, r = S * (0.015 + R() * 0.05);
    wrapped(g, S, () => {
      const grd = g.createRadialGradient(x, y, 0, x, y, r);
      grd.addColorStop(0, 'rgba(255,150,60,0.55)');
      grd.addColorStop(1, 'rgba(255,80,20,0)');
      g.fillStyle = grd; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
    });
  }
  return cv;
}

// ==================================================================
//  3. DECAL ATLAS (RGBA, alpha-tested) — stencils, hazard chevrons,
//     data plates, tread, grates.
// ==================================================================
function drawDecals(S) {
  const cv = mkCanvas(S, S);
  const g = cv.getContext('2d');
  const T = S / 4;
  const R = mulberry32(3312);
  g.clearRect(0, 0, S, S);

  const cell = (idx, fn) => {
    const col = idx % 4, row = (idx / 4) | 0;
    g.save();
    g.translate(col * T, row * T);
    g.beginPath(); g.rect(0, 0, T, T); g.clip();
    fn(T);
    g.restore();
  };

  const grime = (t, amount = 0.35) => {
    g.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 90; i++) {
      g.fillStyle = `rgba(0,0,0,${R() * amount})`;
      g.fillRect(R() * t, R() * t, 1 + R() * (t / 16), 1 + R() * (t / 22));
    }
    g.globalCompositeOperation = 'source-over';
  };

  const chevrons = (t, c1, c2) => {
    g.fillStyle = c1; g.fillRect(0, t * 0.18, t, t * 0.64);
    g.save();
    g.beginPath(); g.rect(0, t * 0.18, t, t * 0.64); g.clip();
    g.fillStyle = c2;
    const w = t * 0.19;
    for (let x = -t; x < t * 2; x += w * 2) {
      g.beginPath();
      g.moveTo(x, t * 0.82); g.lineTo(x + w, t * 0.82);
      g.lineTo(x + w + t * 0.64, t * 0.18); g.lineTo(x + t * 0.64, t * 0.18);
      g.closePath(); g.fill();
    }
    g.restore();
    g.strokeStyle = 'rgba(20,20,20,0.85)'; g.lineWidth = Math.max(1, t / 42);
    g.strokeRect(0, t * 0.18, t, t * 0.64);
    grime(t, 0.5);
  };

  const stencil = (t, txt, size, color = '#e8e6df') => {
    g.fillStyle = color;
    g.font = `900 ${size}px "Arial Black", Impact, system-ui, sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(txt, t / 2, t / 2);
    // stencil bridges
    g.globalCompositeOperation = 'destination-out';
    g.fillStyle = '#000';
    g.fillRect(0, t * 0.47, t, t * 0.045);
    g.globalCompositeOperation = 'source-over';
    grime(t, 0.55);
  };

  cell(DECAL.CHEVRON_Y, (t) => chevrons(t, '#d8bc38', '#1b1b1c'));
  cell(DECAL.CHEVRON_O, (t) => chevrons(t, '#c85a22', '#1b1b1c'));
  cell(DECAL.NUM_07, (t) => stencil(t, '07', t * 0.62));
  cell(DECAL.NUM_24, (t) => stencil(t, '24', t * 0.62));

  cell(DECAL.CODE, (t) => {
    g.fillStyle = '#dcd9d0';
    g.font = `900 ${t * 0.24}px "Arial Black", Impact, sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('OB-01', t / 2, t * 0.38);
    g.font = `700 ${t * 0.13}px monospace`;
    g.fillText('REAVER // AC', t / 2, t * 0.62);
    g.strokeStyle = 'rgba(220,217,208,0.8)'; g.lineWidth = Math.max(1, t / 60);
    g.beginPath(); g.moveTo(t * 0.12, t * 0.5); g.lineTo(t * 0.88, t * 0.5); g.stroke();
    grime(t, 0.5);
  });

  cell(DECAL.WARNTRI, (t) => {
    g.fillStyle = '#d8bc38';
    g.beginPath();
    g.moveTo(t * 0.5, t * 0.12); g.lineTo(t * 0.92, t * 0.84); g.lineTo(t * 0.08, t * 0.84);
    g.closePath(); g.fill();
    g.fillStyle = '#17171a';
    g.beginPath();
    g.moveTo(t * 0.5, t * 0.26); g.lineTo(t * 0.80, t * 0.76); g.lineTo(t * 0.20, t * 0.76);
    g.closePath(); g.fill();
    g.fillStyle = '#d8bc38';
    g.fillRect(t * 0.465, t * 0.40, t * 0.07, t * 0.20);
    g.fillRect(t * 0.465, t * 0.645, t * 0.07, t * 0.065);
    grime(t, 0.5);
  });

  cell(DECAL.DATAPLATE, (t) => {
    g.fillStyle = 'rgba(40,42,46,0.92)'; g.fillRect(t * 0.06, t * 0.14, t * 0.88, t * 0.72);
    g.strokeStyle = 'rgba(200,198,190,0.7)'; g.lineWidth = Math.max(1, t / 60);
    g.strokeRect(t * 0.06, t * 0.14, t * 0.88, t * 0.72);
    g.fillStyle = 'rgba(215,213,205,0.9)';
    for (let i = 0; i < 6; i++) {
      const w = t * (0.28 + R() * 0.5);
      g.fillRect(t * 0.12, t * (0.22 + i * 0.107), w, t * 0.045);
    }
    grime(t, 0.45);
  });

  cell(DECAL.ARROW, (t) => {
    g.fillStyle = '#d9d6cd';
    g.beginPath();
    g.moveTo(t * 0.88, t * 0.5); g.lineTo(t * 0.46, t * 0.16); g.lineTo(t * 0.46, t * 0.36);
    g.lineTo(t * 0.10, t * 0.36); g.lineTo(t * 0.10, t * 0.64); g.lineTo(t * 0.46, t * 0.64);
    g.lineTo(t * 0.46, t * 0.84); g.closePath(); g.fill();
    grime(t, 0.5);
  });

  cell(DECAL.ROUNDEL, (t) => {
    g.strokeStyle = '#d6d3ca'; g.lineWidth = t * 0.05;
    g.beginPath(); g.arc(t / 2, t / 2, t * 0.36, 0, TAU); g.stroke();
    g.fillStyle = '#d6d3ca';
    g.beginPath(); g.arc(t / 2, t / 2, t * 0.13, 0, TAU); g.fill();
    for (let i = 0; i < 4; i++) {
      g.save(); g.translate(t / 2, t / 2); g.rotate(i * Math.PI / 2 + Math.PI / 4);
      g.fillRect(-t * 0.02, -t * 0.34, t * 0.04, t * 0.12); g.restore();
    }
    grime(t, 0.55);
  });

  cell(DECAL.GRATE, (t) => {
    g.fillStyle = 'rgba(14,15,17,0.96)'; g.fillRect(0, 0, t, t);
    g.fillStyle = 'rgba(150,152,156,0.75)';
    for (let i = 0; i < 9; i++) g.fillRect(0, t * (0.04 + i * 0.107), t, t * 0.026);
    g.fillStyle = 'rgba(120,122,126,0.5)';
    for (let i = 0; i < 5; i++) g.fillRect(t * (0.02 + i * 0.2), 0, t * 0.02, t);
    grime(t, 0.3);
  });

  cell(DECAL.BOLTRING, (t) => {
    const n = 10;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU, x = t / 2 + Math.cos(a) * t * 0.36, y = t / 2 + Math.sin(a) * t * 0.36;
      g.fillStyle = 'rgba(20,20,22,0.75)';
      g.beginPath(); g.arc(x, y + t * 0.018, t * 0.05, 0, TAU); g.fill();
      g.fillStyle = 'rgba(214,212,205,0.9)';
      g.beginPath(); g.arc(x, y, t * 0.042, 0, TAU); g.fill();
    }
    g.strokeStyle = 'rgba(24,24,26,0.6)'; g.lineWidth = t * 0.03;
    g.beginPath(); g.arc(t / 2, t / 2, t * 0.24, 0, TAU); g.stroke();
    grime(t, 0.45);
  });

  cell(DECAL.BARCODE, (t) => {
    g.fillStyle = 'rgba(226,224,216,0.9)'; g.fillRect(t * 0.06, t * 0.3, t * 0.88, t * 0.4);
    g.fillStyle = 'rgba(18,18,20,0.95)';
    let x = t * 0.1;
    while (x < t * 0.9) { const w = t * (0.012 + R() * 0.03); g.fillRect(x, t * 0.33, w, t * 0.34); x += w + t * (0.012 + R() * 0.026); }
    grime(t, 0.4);
  });

  cell(DECAL.TREAD, (t) => {
    g.fillStyle = 'rgba(60,62,66,0.55)'; g.fillRect(0, 0, t, t);
    g.fillStyle = 'rgba(196,196,190,0.55)';
    for (let r = 0; r < 6; r++) {
      for (let c = 0; c < 6; c++) {
        const x = (c + (r % 2 ? 0.5 : 0)) * t / 6, y = r * t / 6;
        g.save(); g.translate(x + t / 12, y + t / 12); g.rotate(r % 2 ? 0.6 : -0.6);
        g.fillRect(-t * 0.055, -t * 0.013, t * 0.11, t * 0.026);
        g.restore();
      }
    }
    g.fillStyle = 'rgba(16,16,18,0.5)';
    for (let r = 0; r < 6; r++) {
      for (let c = 0; c < 6; c++) {
        const x = (c + (r % 2 ? 0.5 : 0)) * t / 6, y = r * t / 6;
        g.save(); g.translate(x + t / 12, y + t / 12 + t * 0.014); g.rotate(r % 2 ? 0.6 : -0.6);
        g.fillRect(-t * 0.055, -t * 0.013, t * 0.11, t * 0.026);
        g.restore();
      }
    }
    grime(t, 0.35);
  });

  cell(DECAL.STRIPE, (t) => {
    g.fillStyle = '#c4c1b8'; g.fillRect(0, t * 0.40, t, t * 0.09);
    g.fillStyle = '#8e3a1e'; g.fillRect(0, t * 0.53, t, t * 0.05);
    grime(t, 0.6);
  });

  cell(DECAL.DANGER, (t) => {
    g.fillStyle = 'rgba(150,40,26,0.92)'; g.fillRect(t * 0.04, t * 0.30, t * 0.92, t * 0.40);
    g.fillStyle = '#efece3';
    g.font = `900 ${t * 0.22}px "Arial Black", Impact, sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('DANGER', t / 2, t * 0.5);
    grime(t, 0.55);
  });

  cell(DECAL.SCUFF, (t) => {
    for (let i = 0; i < 40; i++) {
      g.strokeStyle = `rgba(232,228,218,${0.06 + R() * 0.2})`;
      g.lineWidth = 1 + R() * (t / 60);
      const x = R() * t, y = R() * t, a = (R() - 0.5) * 0.8;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * t * (0.1 + R() * 0.4), y + Math.sin(a) * t * 0.1); g.stroke();
    }
  });

  return cv;
}

// ==================================================================
//  4. NOZZLE INTERIOR — heat-stained bell throat.
//     v = 0 at the throat (deep inside), v = 1 at the exit lip.
// ==================================================================
function drawThroat(S) {
  const cv = mkCanvas(S, S);
  const g = cv.getContext('2d');
  const R = mulberry32(9091);
  const grd = g.createLinearGradient(0, S, 0, 0);
  grd.addColorStop(0.00, '#0a0a0b');   // exit lip: carbon
  grd.addColorStop(0.16, '#14100f');
  grd.addColorStop(0.34, '#2a2130');   // temper: violet
  grd.addColorStop(0.50, '#26314a');   // temper: blue
  grd.addColorStop(0.66, '#5a4234');   // straw / bronze
  grd.addColorStop(0.82, '#8a4a22');
  grd.addColorStop(1.00, '#c2622a');   // throat: hot bronze
  g.fillStyle = grd; g.fillRect(0, 0, S, S);
  // soot streaks running along the bell
  for (let i = 0; i < 130; i++) {
    const x = R() * S, w = S * (0.004 + R() * 0.02);
    const h = S * (0.15 + R() * 0.7);
    const y = S - h * R();
    const lg = g.createLinearGradient(0, y, 0, y - h);
    lg.addColorStop(0, `rgba(8,8,9,${0.25 + R() * 0.45})`);
    lg.addColorStop(1, 'rgba(8,8,9,0)');
    g.fillStyle = lg; g.fillRect(x, y - h, w, h);
  }
  // cooling ribs
  g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = Math.max(1, S / 120);
  for (let i = 0; i < 7; i++) { const y = S * (0.08 + i * 0.13); g.beginPath(); g.moveTo(0, y); g.lineTo(S, y); g.stroke(); }
  return cv;
}

function drawThroatGlow(S) {
  const cv = mkCanvas(S, S);
  const g = cv.getContext('2d');
  const R = mulberry32(5150);
  const grd = g.createLinearGradient(0, S, 0, 0);
  grd.addColorStop(0.00, '#000000');
  grd.addColorStop(0.42, '#1a0f06');
  grd.addColorStop(0.70, '#8a4410');
  grd.addColorStop(0.88, '#e8a24a');
  grd.addColorStop(1.00, '#ffffff');
  g.fillStyle = grd; g.fillRect(0, 0, S, S);
  g.globalCompositeOperation = 'multiply';
  for (let i = 0; i < 60; i++) {
    const x = R() * S, w = S * (0.01 + R() * 0.03);
    g.fillStyle = `rgba(${(120 + R() * 130) | 0},${(120 + R() * 130) | 0},${(120 + R() * 130) | 0},1)`;
    g.fillRect(x, 0, w, S);
  }
  return cv;
}

// soft radial for thruster flame cards
function drawFlame(S) {
  const cv = mkCanvas(S, S);
  const g = cv.getContext('2d');
  const grd = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grd.addColorStop(0.00, 'rgba(255,255,255,1)');
  grd.addColorStop(0.22, 'rgba(215,244,255,0.95)');
  grd.addColorStop(0.48, 'rgba(110,200,255,0.55)');
  grd.addColorStop(0.78, 'rgba(40,110,220,0.16)');
  grd.addColorStop(1.00, 'rgba(20,60,160,0)');
  g.fillStyle = grd; g.fillRect(0, 0, S, S);
  return cv;
}

// ==================================================================
//  5. FALLBACK ENVIRONMENT — a dull smog sky so metals have something
//     to reflect even before the world module installs scene.environment.
// ==================================================================
function drawEnv(W, H) {
  const cv = mkCanvas(W, H);
  const g = cv.getContext('2d');
  const R = mulberry32(777);
  const grd = g.createLinearGradient(0, 0, 0, H);
  grd.addColorStop(0.00, '#4e5865');   // zenith slate
  grd.addColorStop(0.34, '#78797c');
  grd.addColorStop(0.47, '#a08f78');   // amber haze band
  grd.addColorStop(0.52, '#c2a480');
  grd.addColorStop(0.58, '#7d6e5c');
  grd.addColorStop(0.72, '#3c332c');   // ground
  grd.addColorStop(1.00, '#1d1815');
  g.fillStyle = grd; g.fillRect(0, 0, W, H);
  // diffuse sun disc behind haze
  const sx = W * 0.30, sy = H * 0.36;
  const sg = g.createRadialGradient(sx, sy, 0, sx, sy, H * 0.42);
  sg.addColorStop(0, 'rgba(255,246,225,1)');
  sg.addColorStop(0.16, 'rgba(255,228,182,0.6)');
  sg.addColorStop(1, 'rgba(255,200,145,0)');
  g.fillStyle = sg; g.fillRect(0, 0, W, H);
  // smoke columns / broken cloud so reflections aren't flat
  for (let i = 0; i < 26; i++) {
    const x = R() * W, y = H * (0.1 + R() * 0.4), r = H * (0.05 + R() * 0.2);
    const cg = g.createRadialGradient(x, y, 0, x, y, r);
    const v = R() < 0.5 ? '58,54,52' : '196,188,172';
    cg.addColorStop(0, `rgba(${v},0.35)`);
    cg.addColorStop(1, `rgba(${v},0)`);
    g.fillStyle = cg; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
  }
  return cv;
}

// ==================================================================
//  cache + material factory
// ==================================================================
export function mechTextures() {
  if (CACHE) return CACHE;
  const hullMap = tex(drawHull(1024, 'albedo'), { srgb: true });
  const hullORM = tex(drawHull(1024, 'orm'), { srgb: false });
  const emberMap = tex(drawEmber(512), { srgb: true });
  const decalMap = tex(drawDecals(1024), { srgb: true, repeat: false, aniso: 8 });
  const throatMap = tex(drawThroat(256), { srgb: true, repeat: false });
  const throatGlow = tex(drawThroatGlow(256), { srgb: true, repeat: false });
  const flameMap = tex(drawFlame(128), { srgb: true, repeat: false });
  const envMap = tex(drawEnv(512, 256), { srgb: true, repeat: false });
  envMap.mapping = THREE.EquirectangularReflectionMapping;
  CACHE = { hullMap, hullORM, emberMap, decalMap, throatMap, throatGlow, flameMap, envMap };
  return CACHE;
}

/**
 * One material set per mech instance (so damage/thrust are per-unit).
 * Textures are shared; only the small uniform blocks differ.
 */
export function makeMaterials(opts = {}) {
  const T = mechTextures();
  const accent = new THREE.Color(opts.accent ?? 0x4fd9ff);
  const hullTint = new THREE.Color(opts.hullTint ?? 0xffffff);
  const uvRepeat = opts.uvRepeat ?? 1;

  const hull = new THREE.MeshStandardMaterial({
    color: hullTint,
    map: T.hullMap,
    roughnessMap: T.hullORM,
    metalnessMap: T.hullORM,
    aoMap: T.hullORM,
    aoMapIntensity: 0.95,
    emissiveMap: T.emberMap,
    emissive: new THREE.Color(0x000000),
    emissiveIntensity: 1.0,
    roughness: 1.0,
    metalness: 1.0,
    envMap: T.envMap,
    envMapIntensity: (opts.envIntensity ?? 1.0) * 0.8,
    vertexColors: true,
    dithering: true,
  });

  // exposed mechanism: chromed rods, actuators, raw milled steel
  const mech = new THREE.MeshStandardMaterial({
    color: new THREE.Color(opts.mechTint ?? 0xb6bac0),
    map: T.hullMap,
    roughnessMap: T.hullORM,
    roughness: 0.33,
    metalness: 1.0,
    envMap: T.envMap,
    envMapIntensity: (opts.envIntensity ?? 1.0) * 1.15,
    vertexColors: true,
    dithering: true,
  });

  // rubber boots, canopy glass, deep-shadow inner frame
  const dark = new THREE.MeshStandardMaterial({
    color: new THREE.Color(opts.darkTint ?? 0x1c1e21),
    roughness: 0.72,
    metalness: 0.2,
    envMap: T.envMap,
    envMapIntensity: (opts.envIntensity ?? 1.0) * 0.34,
    vertexColors: true,
    dithering: true,
  });

  const glow = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0x05070a),
    emissive: accent.clone(),
    emissiveIntensity: 1.75,
    roughness: 0.28,
    metalness: 0.3,
    vertexColors: true,
    toneMapped: true,
  });

  const heat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: T.throatMap,
    emissiveMap: T.throatGlow,
    emissive: new THREE.Color(0xff6a1e),
    emissiveIntensity: 0.2,
    roughness: 0.55,
    metalness: 0.9,
    side: THREE.BackSide,
    envMap: T.envMap,
    envMapIntensity: 0.3,
    vertexColors: true,
  });

  const decal = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: T.decalMap,
    roughness: 0.62,
    metalness: 0.35,
    envMap: T.envMap,
    envMapIntensity: (opts.envIntensity ?? 1.0) * 0.45,
    transparent: false,
    alphaTest: 0.42,
    vertexColors: true,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
    side: THREE.DoubleSide,
  });

  const flame = new THREE.MeshBasicMaterial({
    color: new THREE.Color(opts.flameTint ?? 0x9fe4ff),
    transparent: true,
    opacity: 0.0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    vertexColors: true,
    toneMapped: false,
  });

  return { hull, mech, dark, glow, heat, decal, flame, _accent: accent, _hullTint: hullTint.clone(), _uvRepeat: uvRepeat };
}

export function disposeMaterials(mats) {
  for (const k of Object.keys(mats)) {
    const m = mats[k];
    if (m && m.isMaterial) m.dispose();
  }
}

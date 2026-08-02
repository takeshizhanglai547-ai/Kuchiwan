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
export const HULL_TILE = 4.6;

function panelLayout(S, seed) {
  const R = mulberry32(seed);
  const out = [];
  (function split(x, y, w, h, depth) {
    if (depth <= 0 || (w < S * 0.125 && h < S * 0.125) || (depth < 4 && R() < 0.30)) {
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
  })(0, 0, S, S, 5);
  return out;
}

// mode: 'albedo' | 'orm'
function drawHull(S, mode) {
  const cv = mkCanvas(S, S);
  const g = cv.getContext('2d');
  const R = mulberry32(20250801);
  const A = mode === 'albedo';

  // ---- base coat -------------------------------------------------
  //  ALBEDO is a LOW-value DETAIL map. The actual paint colour comes from
  //  the per-plate vertex colour (see mechKit.paint), which is the dark
  //  industrial palette; the two multiply. In OPEN DAYLIGHT the sky fill
  //  plus the IBL will happily lift a mid-grey map to white, so this base
  //  sits around 0.32 linear — dark painted steel, not primer.
  // orm: R = AO, G = roughness, B = metalness
  g.fillStyle = A ? '#9c9fa3' : 'rgb(250,120,152)';
  g.fillRect(0, 0, S, S);

  // ---- large scale paint mottling --------------------------------
  g.globalAlpha = A ? 0.34 : 0.16;
  for (let i = 0; i < 26; i++) {
    const x = R() * S, y = R() * S, r = S * (0.06 + R() * 0.16);
    const dark = R() < 0.62;
    wrapped(g, S, () => {
      const grd = g.createRadialGradient(x, y, 0, x, y, r);
      const c = A ? (dark ? '16,17,20' : '176,180,186') : (dark ? '176,150,116' : '255,102,182');
      grd.addColorStop(0, `rgba(${c},1)`);
      grd.addColorStop(1, `rgba(${c},0)`);
      g.fillStyle = grd; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
    });
  }
  g.globalAlpha = 1;

  // ---- panels ----------------------------------------------------
  //  Plate-to-plate variance is deliberately WIDE, in both value and in
  //  material: some panels are matte repaint, some are satin factory
  //  finish. That is what stops the frame reading as one moulded object.
  const panels = panelLayout(S, 7717);
  for (const p of panels) {
    const rj = p.v - 0.5;                         // -0.5 .. 0.5
    if (A) {
      const j = rj * 62;
      const warm = (p.v * 7919) % 1 - 0.5;        // faint hue drift per plate
      g.fillStyle = `rgb(${(156 + j + warm * 9) | 0},${(159 + j) | 0},${(164 + j - warm * 11) | 0})`;
    } else {
      // R = AO, G = roughness, B = metalness. Rougher plates are less
      // metallic (thicker paint), satin ones more — a real correlation.
      g.fillStyle = `rgb(${(250 - Math.abs(rj) * 34) | 0},${(120 + rj * 100) | 0},${(152 - rj * 126) | 0})`;
    }
    g.globalAlpha = 0.66;
    g.fillRect(p.x + 1, p.y + 1, p.w - 2, p.h - 2);
    g.globalAlpha = 1;
  }

  // panel grooves — WIDE and BLACK. This is the detail that has to carry
  // at 20–40 m (the range the player actually sees the mech from), so it
  // is authored in value, not in fine noise.
  const gw = Math.max(5, S / 74);
  for (const p of panels) {
    // soft AO bleed either side of the groove (drawn first, under it)
    g.lineWidth = gw * 4.6;
    g.strokeStyle = A ? 'rgba(15,16,19,0.54)' : 'rgba(108,198,108,0.50)';
    g.strokeRect(p.x + gw * 0.5, p.y + gw * 0.5, p.w - gw, p.h - gw);
    // the groove itself
    g.lineWidth = gw;
    g.strokeStyle = A ? 'rgba(4,5,7,0.99)' : 'rgba(20,230,58,0.97)';
    g.strokeRect(p.x + gw * 0.5, p.y + gw * 0.5, p.w - gw, p.h - gw);
    // dull catch-light on the lower/right lip of the plate above. This used
    // to be near-white and it outlined every panel like a moulding line.
    g.lineWidth = Math.max(1, gw * 0.26);
    g.strokeStyle = A ? 'rgba(150,154,160,0.30)' : 'rgba(255,70,238,0.7)';
    g.beginPath();
    g.moveTo(p.x + gw * 1.3, p.y + p.h - gw * 1.3);
    g.lineTo(p.x + p.w - gw * 1.3, p.y + p.h - gw * 1.3);
    g.moveTo(p.x + p.w - gw * 1.3, p.y + gw * 1.3);
    g.lineTo(p.x + p.w - gw * 1.3, p.y + p.h - gw * 1.3);
    g.stroke();
  }

  // ---- rivet / bolt rows along some panel edges -------------------
  const rr = Math.max(2.4, S / 250);
  for (const p of panels) {
    if (R() > 0.40) continue;
    const n = Math.max(2, Math.round(p.w / (S * 0.058)));
    const yy = p.y + (R() < 0.5 ? gw * 2.4 : p.h - gw * 2.4);
    for (let i = 0; i < n; i++) {
      const xx = p.x + p.w * ((i + 0.5) / n);
      if (A) {
        g.fillStyle = 'rgba(10,11,14,0.82)';
        g.beginPath(); g.arc(xx, yy + rr * 0.9, rr * 1.3, 0, TAU); g.fill();
        g.fillStyle = 'rgba(150,152,152,0.60)';
        g.beginPath(); g.arc(xx, yy, rr, 0, TAU); g.fill();
      } else {
        g.fillStyle = 'rgba(255,84,250,0.85)';
        g.beginPath(); g.arc(xx, yy, rr, 0, TAU); g.fill();
      }
    }
  }

  // ---- vertical grime / oil streaks (V axis == world down) --------
  for (let i = 0; i < 96; i++) {
    const x = R() * S, y = R() * S;
    const w = S * (0.005 + R() * 0.022);
    const h = S * (0.05 + R() * 0.34);
    const a = 0.12 + R() * 0.32;
    wrapped(g, S, () => {
      const grd = g.createLinearGradient(0, y, 0, y + h);
      const c = A ? '17,15,13' : '138,222,58';
      grd.addColorStop(0, `rgba(${c},${a})`);
      grd.addColorStop(0.25, `rgba(${c},${a * 0.75})`);
      grd.addColorStop(1, `rgba(${c},0)`);
      g.fillStyle = grd;
      g.fillRect(x, y, w, h);
    });
  }

  // ---- rust / scorch blooms --------------------------------------
  for (let i = 0; i < 18; i++) {
    const x = R() * S, y = R() * S, r = S * (0.014 + R() * 0.045);
    wrapped(g, S, () => {
      const grd = g.createRadialGradient(x, y, 0, x, y, r);
      const c = A ? '122,74,48' : '180,238,44';
      grd.addColorStop(0, `rgba(${c},0.34)`);
      grd.addColorStop(1, `rgba(${c},0)`);
      g.fillStyle = grd; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
    });
  }

  // ---- chipped paint speckle (bare metal) ------------------------
  for (let i = 0; i < 320; i++) {
    const x = R() * S, y = R() * S;
    const w = 1 + R() * (S / 190), h = 1 + R() * (S / 230);
    g.fillStyle = A
      ? (R() < 0.34 ? 'rgba(164,166,163,0.22)' : 'rgba(12,11,10,0.52)')
      : 'rgba(255,72,250,0.38)';
    g.fillRect(x, y, w, h);
  }

  // ---- fine noise ------------------------------------------------
  const img = g.getImageData(0, 0, S, S);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (R() - 0.5) * (A ? 10 : 6);
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
  //  A COLD nozzle is a black carbon hole. The old bright-bronze interior
  //  turned every bell into a glowing iris — the single worst read on the
  //  frame. Heat staining is kept, but at a fraction of the value.
  const grd = g.createLinearGradient(0, S, 0, 0);
  grd.addColorStop(0.00, '#040405');   // exit lip: soot
  grd.addColorStop(0.18, '#08080a');
  grd.addColorStop(0.36, '#100d13');   // temper: violet
  grd.addColorStop(0.52, '#0e1219');   // temper: blue
  grd.addColorStop(0.68, '#1e1712');   // straw
  grd.addColorStop(0.84, '#2e1c10');
  grd.addColorStop(1.00, '#43260f');   // throat: dark bronze
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
  //  Deliberately DIM. This is what every un-hosted mech (the MTs, the
  //  drones, the boss) reflects, and a bright smog dome turns every metal
  //  on the frame into pale grey. Rubicon's sky is thick, not luminous.
  const grd = g.createLinearGradient(0, 0, 0, H);
  grd.addColorStop(0.00, '#333a45');   // zenith slate
  grd.addColorStop(0.34, '#4f5053');
  grd.addColorStop(0.47, '#6b6052');   // amber haze band
  grd.addColorStop(0.52, '#816e56');
  grd.addColorStop(0.58, '#53483d');
  grd.addColorStop(0.72, '#26201b');   // ground
  grd.addColorStop(1.00, '#120f0d');
  g.fillStyle = grd; g.fillRect(0, 0, W, H);
  // diffuse sun disc behind haze — a bright core, but a small one
  const sx = W * 0.30, sy = H * 0.36;
  const sg = g.createRadialGradient(sx, sy, 0, sx, sy, H * 0.34);
  sg.addColorStop(0, 'rgba(255,244,220,0.86)');
  sg.addColorStop(0.14, 'rgba(226,196,152,0.34)');
  sg.addColorStop(1, 'rgba(180,138,96,0)');
  g.fillStyle = sg; g.fillRect(0, 0, W, H);
  // smoke columns / broken cloud so reflections aren't flat
  for (let i = 0; i < 26; i++) {
    const x = R() * W, y = H * (0.1 + R() * 0.4), r = H * (0.05 + R() * 0.2);
    const cg = g.createRadialGradient(x, y, 0, x, y, r);
    const v = R() < 0.55 ? '40,38,37' : '138,132,120';
    cg.addColorStop(0, `rgba(${v},0.38)`);
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
//  Relative IBL weight per material. The world hands us ONE intensity for
//  the whole unit (player.js: setEnvironment(env, 0.85)); without these
//  ratios that single number flattens rubber, paint and bare steel into the
//  same mirror and the sky fill lifts the frame to white.
//  Under the 6.3-intensity key the IBL is ~10 % of a lit face; inside a
//  cast shadow it is the ONLY fill there is. So it is tuned against the
//  shadow read, not the lit one — drop it far enough to stop the sky
//  washing the armour white and the mech becomes a black cut-out the
//  moment it walks under a gantry.
export const ENV_REL = { hull: 0.84, mech: 1.00, dark: 0.24, heat: 0.28, decal: 0.36 };

export function makeMaterials(opts = {}) {
  const T = mechTextures();
  const accent = new THREE.Color(opts.accent ?? 0x4fd9ff);
  const hullTint = new THREE.Color(opts.hullTint ?? 0xffffff);
  const uvRepeat = opts.uvRepeat ?? 1;
  const ei = opts.envIntensity ?? 1.0;

  const hull = new THREE.MeshStandardMaterial({
    color: hullTint,
    map: T.hullMap,
    roughnessMap: T.hullORM,
    metalnessMap: T.hullORM,
    aoMap: T.hullORM,
    // the vertex paint already carries a directional AO term; stacking a
    // full-strength baked AO on top of it closes the crevices to pure black
    aoMapIntensity: 0.86,
    emissiveMap: T.emberMap,
    emissive: new THREE.Color(0x000000),
    emissiveIntensity: 1.0,
    roughness: 1.0,
    metalness: 1.0,
    envMap: T.envMap,
    envMapIntensity: ei * ENV_REL.hull,
    vertexColors: true,
    dithering: true,
  });

  // exposed mechanism: milled steel rods, actuators, hydraulic chrome.
  //  Satin, NOT chrome: at roughness 0.30 x the ORM the pistons went to a
  //  mirror and mirrored the sky, which read as blue-white plastic tube.
  const mech = new THREE.MeshStandardMaterial({
    color: new THREE.Color(opts.mechTint ?? 0x9aa0a6),
    map: T.hullMap,
    roughnessMap: T.hullORM,
    roughness: 0.66,
    metalness: 1.0,
    envMap: T.envMap,
    envMapIntensity: ei * ENV_REL.mech,
    vertexColors: true,
    dithering: true,
  });

  //  Rubber boots, cable looms, deep throats. The material tint is a
  //  NEUTRAL: value is carried entirely by the per-primitive vertex paint,
  //  so a throat can be a true void while a rubber boot still shows form.
  const dark = new THREE.MeshStandardMaterial({
    color: new THREE.Color(opts.darkTint ?? 0xc6cace),
    roughness: 0.86,
    metalness: 0.12,
    envMap: T.envMap,
    envMapIntensity: ei * ENV_REL.dark,
    vertexColors: true,
    dithering: true,
  });

  const glow = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0x04060a),
    emissive: accent.clone(),
    emissiveIntensity: 2.35,
    roughness: 0.26,
    metalness: 0.25,
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
    envMapIntensity: ei * ENV_REL.heat,
    vertexColors: true,
  });

  //  Stencils are WORN paint, not fresh white vinyl — the atlas art is
  //  near-white so the tint is what keeps them off the top of the range.
  const decal = new THREE.MeshStandardMaterial({
    color: 0xa8a49c,
    map: T.decalMap,
    roughness: 0.74,
    metalness: 0.16,
    envMap: T.envMap,
    envMapIntensity: ei * ENV_REL.decal,
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

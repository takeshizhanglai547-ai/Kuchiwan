// src/fx/textures.js — VFX atlases (owner: weapons/VFX artist).
//
//   tex_fx_puff  assets/fx/fx_puff.webp  4x2 billow puffs: R density, GB normal, A 0.5+0.5*detail
//   tex_fx_misc  assets/fx/fx_misc.webp  R star flashes (2x2), G scorch decals (2x2),
//                                         B debris silhouettes (4x4), A 0.5+0.5*tileable fBm noise
// (lossless WebP; alpha kept >= 0.5 so image-upload premultiplication cannot quantise RGB)
// Both are baked by assets/fx/bake_fx.py (numpy, deterministic). Until they load (or if they
// are missing) small procedural stand-ins are used so the game never waits on VFX art.
import * as THREE from 'three';

let fallback = null;

function makeFallback() {
  const n = 64;
  const puff = new Uint8Array(n * n * 4), misc = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const i = (y * n + x) * 4;
    const u = ((x % 16) + 0.5) / 16 * 2 - 1, v = ((y % 32) + 0.5) / 32 * 2 - 1;
    const r = Math.min(1, Math.hypot(u, v));
    const d = Math.max(0, 1 - r) ** 1.5;
    puff[i] = d * 255; puff[i + 1] = 128 + u * 60 * d; puff[i + 2] = 128 + v * 60 * d; puff[i + 3] = 192;
    const s = Math.max(0, 1 - Math.hypot(((x % 32) + 0.5) / 16 - 1, ((y % 32) + 0.5) / 16 - 1));
    misc[i] = s * s * 255; misc[i + 1] = s * 255; misc[i + 2] = s > 0.3 ? 200 : 0; misc[i + 3] = 192;
  }
  const mk = (data) => {
    const t = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
    t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearFilter;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.needsUpdate = true;
    t.userData.shared = true;
    return t;
  };
  return { puff: mk(puff), misc: mk(misc) };
}

/** Returns {puff, misc} textures (loaded atlases, or procedural fallbacks). */
export async function loadFxTextures(game) {
  if (!fallback) fallback = makeFallback();
  const out = { puff: fallback.puff, misc: fallback.misc };
  try {
    const [puff, misc] = await Promise.all([
      game.assets.texture('tex_fx_puff', { linear: true, repeat: false }),
      game.assets.texture('tex_fx_misc', { linear: true, repeat: true }),
    ]);
    if (puff) { puff.anisotropy = 1; puff.userData.shared = true; out.puff = puff; }
    if (misc) { misc.anisotropy = 1; misc.userData.shared = true; out.misc = misc; }
  } catch (e) {
    console.warn('[fx] atlas load failed, using procedural stand-ins', e);
  }
  return out;
}

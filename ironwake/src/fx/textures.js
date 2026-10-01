// src/fx/textures.js — VFX atlases (owner: weapons/VFX artist).
//
//   tex_fx_puff  assets/fx/fx_puff.webp  4x2 billow puffs: R density, GB normal, A 0.5+0.5*detail
//   tex_fx_misc  assets/fx/fx_misc.webp  R star flashes (2x2), G scorch decals (2x2),
//                                         B debris silhouettes (4x4), A 0.5+0.5*tileable fBm noise
//   tex_fx_fire  assets/fx/fx_fire.jpg   8x8 volumetric FLIPBOOK of one explosion life (ignition ->
//                                         fireball -> cooling soot -> wisps): R opacity,
//                                         G temperature, B light from above (JPEG 4:4:4)
// (lossless WebP; alpha kept >= 0.5 so image-upload premultiplication cannot quantise RGB)
// puff/misc are baked by assets/fx/bake_fx.py, the flipbook by assets/fx/bake_fire.py (numpy,
// deterministic). Until they load (or if they are missing) small procedural stand-ins are used
// so the game never waits on VFX art.
import * as THREE from 'three';

let fallback = null;

function makeFallback() {
  const n = 64;
  const puff = new Uint8Array(n * n * 4), misc = new Uint8Array(n * n * 4), fire = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const i = (y * n + x) * 4;
    const u = ((x % 16) + 0.5) / 16 * 2 - 1, v = ((y % 32) + 0.5) / 32 * 2 - 1;
    const r = Math.min(1, Math.hypot(u, v));
    const d = Math.max(0, 1 - r) ** 1.5;
    puff[i] = d * 255; puff[i + 1] = 128 + u * 60 * d; puff[i + 2] = 128 + v * 60 * d; puff[i + 3] = 192;
    const s = Math.max(0, 1 - Math.hypot(((x % 32) + 0.5) / 16 - 1, ((y % 32) + 0.5) / 16 - 1));
    misc[i] = s * s * 255; misc[i + 1] = s * 255; misc[i + 2] = s > 0.3 ? 200 : 0; misc[i + 3] = 192;
    // 8x8 cells of 8 px: a soft ball that cools down the rows
    const fu = ((x % 8) + 0.5) / 4 - 1, fv = ((y % 8) + 0.5) / 4 - 1, row = Math.floor(y / 8) / 7;
    const fd = Math.max(0, 1 - Math.hypot(fu, fv) * 1.3);
    fire[i] = Math.min(1, fd * 3) * 255; fire[i + 1] = fd * (1 - row) * 255; fire[i + 2] = 160; fire[i + 3] = 255;
  }
  const mk = (data) => {
    const t = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
    t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearFilter;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.needsUpdate = true;
    t.userData.shared = true;
    return t;
  };
  const f = mk(fire);
  f.wrapS = f.wrapT = THREE.ClampToEdgeWrapping;
  return { puff: mk(puff), misc: mk(misc), fire: f };
}

/** Returns {puff, misc, fire} textures (loaded atlases, or procedural fallbacks). */
export async function loadFxTextures(game) {
  if (!fallback) fallback = makeFallback();
  const out = { puff: fallback.puff, misc: fallback.misc, fire: fallback.fire };
  try {
    const [puff, misc, fire] = await Promise.all([
      game.assets.texture('tex_fx_puff', { linear: true, repeat: false }),
      game.assets.texture('tex_fx_misc', { linear: true, repeat: true }),
      game.assets.texture('tex_fx_fire', { linear: true, repeat: false }),
    ]);
    if (puff) { puff.anisotropy = 1; puff.userData.shared = true; out.puff = puff; }
    if (misc) { misc.anisotropy = 1; misc.userData.shared = true; out.misc = misc; }
    if (fire) { fire.anisotropy = 1; fire.userData.shared = true; out.fire = fire; }
  } catch (e) {
    console.warn('[fx] atlas load failed, using procedural stand-ins', e);
  }
  return out;
}

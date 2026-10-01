// src/manifest.js — THE asset manifest. Every external file the game loads is listed here.
//
//   id: { url, type }        type: 'gltf' | 'texture' | 'audio' | 'json'
//
// Rules (see docs/ARCHITECTURE.md "Assets"):
//   * Add an entry ONLY when the file exists (tools/check.mjs fails on missing files).
//   * Code asks for assets by id: await game.assets.gltf('mech_player'). An id that is
//     not in the manifest (or fails to load) returns null / a procedural placeholder, so
//     the game never hard-crashes while art is still being produced.
//   * tools/build.mjs embeds every file listed here as a base64 data: URI in the single
//     file build (dist/ironwake.html). Keep the total under ~14 MB.
//   * URLs are relative to index.html.
//
// Suggested ids (owners add them when their files land):
//   mech_player, mech_boss        assets/mech/*.glb      (node contract: src/mech/rig.js)
//   wpn_rifle, wpn_blade, wpn_missile, wpn_cannon   assets/mech/*.glb (optional, attached to mounts)
//   arena                         assets/arena/arena.glb (COL_/SPAWN_/OBJ_ conventions: src/world/arena.js)
//   enemy_mt, enemy_drone, enemy_turret   assets/enemies/*.glb
//   tex_*                         assets/textures/*.png|jpg|ktx2
//   sfx_*, music_*                assets/audio/*.ogg|mp3
export const MANIFEST = {
  // arena (owner: arena artist) — blender/arena/build_arena.py + textures.py
  arena: { url: 'assets/arena/arena.glb', type: 'gltf' },
  tex_arena_concrete_a: { url: 'assets/arena/tex/concrete_a.webp', type: 'texture' },
  tex_arena_concrete_n: { url: 'assets/arena/tex/concrete_n.webp', type: 'texture' },
  tex_arena_concrete_d: { url: 'assets/arena/tex/concrete_d.webp', type: 'texture' },
  tex_arena_slab_a: { url: 'assets/arena/tex/slab_a.webp', type: 'texture' },
  tex_arena_slab_n: { url: 'assets/arena/tex/slab_n.webp', type: 'texture' },
  tex_arena_slab_d: { url: 'assets/arena/tex/slab_d.webp', type: 'texture' },
  tex_arena_ash_a: { url: 'assets/arena/tex/ash_a.webp', type: 'texture' },
  tex_arena_ash_n: { url: 'assets/arena/tex/ash_n.webp', type: 'texture' },
  tex_arena_ash_d: { url: 'assets/arena/tex/ash_d.webp', type: 'texture' },
  tex_arena_steel_a: { url: 'assets/arena/tex/steel_a.webp', type: 'texture' },
  tex_arena_steel_n: { url: 'assets/arena/tex/steel_n.webp', type: 'texture' },
  tex_arena_steel_d: { url: 'assets/arena/tex/steel_d.webp', type: 'texture' },
  tex_arena_corr_a: { url: 'assets/arena/tex/corr_a.webp', type: 'texture' },
  tex_arena_corr_n: { url: 'assets/arena/tex/corr_n.webp', type: 'texture' },
  tex_arena_corr_d: { url: 'assets/arena/tex/corr_d.webp', type: 'texture' },
  tex_arena_trim_a: { url: 'assets/arena/tex/trim_a.webp', type: 'texture' },
  tex_arena_trim_n: { url: 'assets/arena/tex/trim_n.webp', type: 'texture' },
  tex_arena_trim_d: { url: 'assets/arena/tex/trim_d.webp', type: 'texture' },
  tex_arena_detail: { url: 'assets/arena/tex/detail.webp', type: 'texture' },
  tex_arena_noise: { url: 'assets/arena/tex/noise.webp', type: 'texture' },
  tex_arena_decal: { url: 'assets/arena/tex/decal.webp', type: 'texture' },
  tex_arena_splat: { url: 'assets/arena/tex/splat.webp', type: 'texture' },
  tex_arena_water: { url: 'assets/arena/tex/water.webp', type: 'texture' },
  // mech lane (blender/mech/build_player.py, build_boss.py; node contract: src/mech/rig.js)
  mech_player: { url: 'assets/mech/mech_player.glb', type: 'gltf' },
  mech_boss: { url: 'assets/mech/mech_boss.glb', type: 'gltf' },
  // enemies lane (blender/enemies/build_*.py; node contract: src/enemies/models.js)
  enemy_mt: { url: 'assets/enemies/enemy_mt.glb', type: 'gltf' },
  enemy_drone: { url: 'assets/enemies/enemy_drone.glb', type: 'gltf' },
  enemy_relay: { url: 'assets/enemies/enemy_relay.glb', type: 'gltf' },
  // UI fonts (owner: mission/HUD designer; OFL, built by assets/fonts/build_fonts.py;
  // registered with the FontFace API by src/ui/fonts.js)
  font_label_400: { url: 'assets/fonts/barlow-condensed-400.woff2', type: 'binary' },
  font_label_500: { url: 'assets/fonts/barlow-condensed-500.woff2', type: 'binary' },
  font_label_600: { url: 'assets/fonts/barlow-condensed-600.woff2', type: 'binary' },
  font_label_700: { url: 'assets/fonts/barlow-condensed-700.woff2', type: 'binary' },
  font_mono_400: { url: 'assets/fonts/share-tech-mono-400.woff2', type: 'binary' },
  font_jp_400: { url: 'assets/fonts/noto-sans-jp-400-subset.woff2', type: 'binary' },
  font_jp_700: { url: 'assets/fonts/noto-sans-jp-700-subset.woff2', type: 'binary' },
  // weapons/VFX lane (assets/fx/bake_fx.py; channel layout in src/fx/textures.js)
  tex_fx_puff: { url: 'assets/fx/fx_puff.webp', type: 'texture' },
  tex_fx_misc: { url: 'assets/fx/fx_misc.webp', type: 'texture' },
  tex_fx_fire: { url: 'assets/fx/fx_fire.jpg', type: 'texture' },   // 8x8 fireball->smoke flipbook (assets/fx/bake_fire.py)
};

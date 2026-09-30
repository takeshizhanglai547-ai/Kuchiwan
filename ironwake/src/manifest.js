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
};

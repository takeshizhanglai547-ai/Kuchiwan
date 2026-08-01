# OVERBURST — architecture contract

**Read this before touching any file.** Every module is owned by exactly one agent.
Do not edit files you do not own — integration breaks otherwise.

## Target

An Armored Core VI–grade single-stage mech action game in Three.js.
Fixed loadout. No assembly/customisation (deliberate design decision — do not add it).
Deliverable: one playable stage with an arena, enemies, objectives and win/lose.

Pillars:
1. **Quick-Boost-first traversal.** Movement is the core verb. QB must feel like a
   hard impulse with weight and recovery, not an ease-in speed change.
2. **Brutal industrial design.** Heavy, welded, functional. Panel lines, greebles,
   exposed pistons, weathered steel, warning stencils. Never smooth sci-fi plastic.
3. **Readable violence.** Tracers, impact sparks, hitflash, ACS/stagger feedback,
   detonations that light the world.

## Run / verify

```bash
node tools/serve.mjs 8123          # http://127.0.0.1:8123/overburst/index.html
node tools/shot.mjs --out=shots/x  # headless screenshots + error report
node tools/build.mjs               # -> overburst.html (single file)
```

`tools/shot.mjs` **is the acceptance gate**: it fails (exit 1) on any console or
runtime error. Run it after every change. Read the PNGs it writes.

## Files & ownership

| file | owns |
|---|---|
| `src/config.js` | all tuning constants (shared, edit only your own section) |
| `src/util/math.js` | helpers (shared, additive only) |
| `src/core/bus.js` | event bus (frozen) |
| `src/core/engine.js` | renderer/camera/resize (frozen) |
| `src/core/input.js` | input mapping (frozen) |
| `src/main.js` | wiring + game loop + harness API (frozen) |
| `src/core/postfx.js` | post-processing chain |
| `src/core/audio.js` | procedural WebAudio |
| `src/world/*.js` | arena geometry, materials, sky, atmosphere |
| `src/mech/mechModel.js` | procedural mech construction (player + enemy) |
| `src/mech/player.js` | movement physics, EN, stagger, camera, lock-on |
| `src/combat/weapons.js` | fixed loadout firing logic |
| `src/combat/projectiles.js` | pooled projectiles + hit resolution |
| `src/vfx/vfx.js` | all particles/trails/explosions/decals |
| `src/enemy/enemies.js` | enemy AI, waves, boss |
| `src/ui/hud.js`, `src/ui/hud.css` | all 2D interface |
| `src/mission/mission.js` | objectives, timer, win/lose, scoring |

New files are fine **inside your own directory** (e.g. `src/vfx/particles.js`).
`src/world/`, `src/vfx/`, `src/enemy/`, `src/ui/`, `src/mission/` are single-owner dirs.

## Shared context (`ctx`)

Constructed in `main.js`, passed to every system constructor:

```
ctx.THREE ctx.CFG ctx.game ctx.bus ctx.clock ctx.time ctx.dt ctx.frame
ctx.state ('boot'|'title'|'playing'|'win'|'lose') ctx.timeScale ctx.uiRoot
ctx.engine ctx.renderer ctx.scene ctx.camera ctx.input
ctx.audio ctx.vfx ctx.world ctx.projectiles ctx.player ctx.weapons
ctx.enemies ctx.mission ctx.hud ctx.postfx
ctx.cameraOverride  // when true, player.updateCamera is skipped (harness)
```

## Update order (fixed, in `main.js`)

`player → weapons → enemies → projectiles → mission` (only while `playing`),
then always `world → vfx → audio → hud → camera → postfx.render`.

## System API contracts

Every system: `constructor(ctx)`, optional `init()`, `update(dt)`, `reset()`.
`reset()` is called on mission start — restore to a fresh combat state.
The per-file header comment in each stub is the authoritative contract for that
module. Keep the documented method names and shapes; add freely beyond them.

## Event catalogue (`ctx.bus`)

```
'hit'       { target, point, normal, damage, impact, acs, source, weapon, direct }
'damage'    { entity, amount, isPlayer, staggered }
'stagger'   { entity }
'kill'      { entity, kind }
'explode'   { position, radius, power, color, kind }
'fire'      { weapon, origin, dir, owner }
'shake'     { amount, duration }
'lock'      { targets, hard }
'objective' { id, state, text }
'phase'     { entity, phase }
'state'     { from, to }
'hud'       { type, ... }     // toasts, radio lines, warnings
```

## Hard rules

- **No network at runtime.** No CDN, no fetch, no external fonts/textures/audio.
  Everything is procedural or vendored under `overburst/vendor/`.
- **Three.js r180**, imported as `import * as THREE from 'three'` (import map).
  Addons: `import { X } from 'three/addons/postprocessing/X.js'`.
- **60 fps budget on a mid GPU.** Pool objects. No per-frame allocation in hot
  loops. Merge static geometry. Instance repeated props. Keep draw calls sane.
- Must stay bundle-safe for `tools/build.mjs` (no dynamic `import()` of paths,
  no `import.meta.url` asset loading).
- The game must render and be screenshot-able with **no pointer lock** — the
  harness never clicks into the canvas.
- Colour: author in linear/`SRGBColorSpace`-correct terms. Renderer already uses
  ACES tone mapping; emissive values above 1.0 are what drives bloom.

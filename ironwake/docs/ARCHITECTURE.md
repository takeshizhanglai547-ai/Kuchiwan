# IRONWAKE — Architecture & Contracts

This is the contract between all agents working on IRONWAKE. Read it before touching code.
Quality targets and numbers come from `docs/AC6_BENCHMARK.md`. That file is a quality bar only:
**no names, logos, factions or mech designs from the reference game** may appear in our content.
Genre terms such as AP, EN, Quick Boost, Assault Boost and stagger are fine.

- Stack: plain ES modules with Three.js r186 (WebGL2) and no framework.
- Dev build: `index.html` loads Three.js through an importmap from `vendor/three/`.
- Release build: `dist/ironwake.html` is a single file that runs from `file://`.

---

## 1. Quick start

All commands run from `ironwake/`. Node 22 lives at `/opt/node22/bin`.

| Command | What it does |
|---|---|
| `npm run serve` | Starts the dev server on a random free port and prints the URL. Open `…/index.html`. |
| `npm run check` | Runs an esbuild bundle-check of every import, a manifest check, the `Math.random` ban and the unit tests in `tests/*.test.mjs`. |
| `npm test` | Runs the unit tests only (`node --test`). |
| `npm run smoke` | Plays the game in headless Chromium through the TEST API and prints a PASS/FAIL table. `-- --dist` runs it on the single-file build. |
| `npm run shoot -- --shot gameplay_chase` | Renders staged shots to `.shots/*.png` plus a JSON sidecar. `--all`, `--frames 0,4,8`, `--contact`, `--cam x,y,z --look x,y,z --fov 50`, `--params "asset.mech_player=…"`. |
| `npm run build` | Builds `dist/ironwake.html` as a single file with JS, CSS and every manifest asset inlined. It warns when the file exceeds 14 MB. |
| `npm run vendor` | Re-copies Three.js into `vendor/three/`, closure-checked. Run it after any three version bump. |
| `npm run assets` | Runs `python3 blender/build_all.py` if that file exists. |

Rules every agent follows:

- **Before finishing:** `npm run check` and `npm run smoke` must pass with zero console errors.
- **For any visual work:** run `npm run shoot` on your shots and **look at the PNGs** with the Read tool.
- **Headless rendering:** it uses SwiftShader (CPU), and the harness only renders the frames it captures. Never run `playwright install`, because Chromium is already at `/opt/pw-browsers`.

URL parameters for `index.html`:

| Parameter | Effect |
|---|---|
| `?test=1` | TEST API, manual stepping, no RAF loop. |
| `&auto=1` | Test mode with the RAF loop running. |
| `&seed=N` | Sets the RNG seed. |
| `&shot=name` | Stages a shot. |
| `&cam=x,y,z&look=x,y,z&fov=50&t=2` | Free camera. `t` adds extra simulated seconds. |
| `&hud=0/1` | Hides or shows the HUD. |
| `&skip=1` | Skips the menus and starts the mission. |
| `&quality=low\|medium\|high` | Sets the quality level. |
| `&debug=1` | Shows the debug overlay (also toggled with the backquote key). |
| `&asset.<id>=<url>` | Swaps any manifest asset at runtime, e.g. `asset.mech_player=assets/mech/wip.glb`. |

---

## 2. Directory ownership

Each agent owns its files and only edits others' files through the documented APIs. If you need a change in someone else's file, keep it minimal and mention it in your report. **Shared** files are append-only: add entries, don't rewrite other people's entries.

| Owner | Files |
|---|---|
| **Lead engine** | `src/main.js`, `src/core/*` (engine, input, rng, events, assets, physics, pool, systems, debug, hints), `index.html`, `css/main.css`, `tools/*`, `package.json`, `docs/ARCHITECTURE.md`, `tests/{rng,physics,input}.test.mjs` |
| **Lead gameplay** (ask first) | `src/game/actor.js`, `src/game/combat.js`, `src/game/damage.js`, `tests/damage.test.mjs` |
| **Render engineer** | `src/render/*`: `pipeline.js` (post chain), `environment.js` (sky, fog, sun, shadows, env map), `proctex.js` (procedural placeholder textures) |
| **Arena artist** | `src/world/*`, `blender/arena/*`, `assets/arena/*` |
| **Mech modeler** | `src/mech/placeholder.js`, the visual parts of `src/mech/rig.js` (node contract, flame visuals), `blender/mech/*`, `assets/mech/*` |
| **Movement designer** | `src/player/*` (`tuning.js`, `controller.js`, `camera.js`, `player.js`), `src/mech/motor.js`, `src/mech/energy.js`, the procedural animation in `rig.js` `update()`, `tests/{motor,energy}.test.mjs` |
| **Weapons / VFX artist** | `src/weapons/*` (`weapons.js`, `projectiles.js`, `lockon.js`), `src/fx/*` |
| **Enemy AI designer** | `src/enemies/*` (`enemies.js`, `enemy.js`, `mt.js`, `drone.js`, `turret.js`, `boss.js`, `models.js`), `assets/enemies/*` |
| **Mission / HUD designer** | `src/game/mission.js`, `src/game/missionLogic.js`, `src/ui/*` (`hud.js`, `menus.js`), `css/ui.css`, `tests/mission.test.mjs` |
| **Audio designer** | `src/audio/*`, `assets/audio/*` |
| **Shared (append-only)** | `src/manifest.js`, `src/scenes/shots.js`, new `tests/<yours>.test.mjs` files |

Generated files that are never hand-edited: `vendor/three/**` (from `npm run vendor`), `dist/` (from `npm run build`) and `.shots/` (gitignored).

---

## 3. Runtime model

### 3.1 Boot (`src/main.js`)
1. `new Game(...)` creates the renderer, scene, camera, input, RNG, physics, assets and the system registry.
2. `game.init(SYSTEM_MODULES)`: every subsystem is a **dynamic `import()`** (a static string, so esbuild bundles it) inside try/catch. A module that fails to load or init logs one `console.error`, is skipped, and the game still runs. A system that throws later in `update`, `frame` or `reset` is disabled ("faulted") with one error log.
3. `installDebug(game)` installs the debug overlay and `window.__iw` (when `?test=1`).
4. `game.startSession({state:'title'})` runs every system's `reset()`, which prepares the stage behind the title screen. The menus show the title.

### 3.2 System interface (`src/core/systems.js`)
A module's `default` export is a system object or a factory `(game) => system`:
```js
export default function mySystem(game) {
  return {
    name: 'mything', order: 450,
    init(game) {},            // once at boot (may be async). Create meshes, pools and event listeners HERE.
    reset(game) {},           // every mission (re)start: clear per-session state, despawn things
    update(dt) {},            // fixed 60 Hz step; dt is already scaled by hitstop/slow-mo
    lateUpdate(dt) {},        // after every system's update in the same step
    frame(alpha, realDt) {},  // once per rendered frame: interpolation, DOM, camera placement
    dispose() {},
  };
}
```
Register it in `SYSTEM_MODULES` in `src/main.js` (ask the lead engine to add it).

**Update order** (lowest first):

| Order | System | Notes |
|---:|---|---|
| — | `input.beginStep()` | Called by the engine |
| 20 | environment | Sky, fog, sun |
| 30 | arena | Static world |
| 90 | lockon | Player FCS |
| 100 | player | Controller → motor → rig → weapons |
| 200 | enemies | AI, motors, weapons |
| 400 | projectiles | Move, collide, damage |
| 600 | mission | Objectives and win/lose |
| 700 | fx | Particles |
| 800 | camera | Uses `lateUpdate` |
| 900 | hud | Uses `frame` only |
| 905 | hints | `frame` only: live-play CLICK / DRAG TO AIM chip, one-time LOW FRAME RATE callout (`src/core/hints.js`) |
| 910 | menus | |
| 950 | audio | |
| 1000 | pipeline | Render |
| 2000 | debug | |

### 3.3 Clock
- Fixed step `FIXED_DT = 1/60`, run from an accumulator, with at most 8 steps per frame and a real-dt clamp of 8/60 s (excess time is dropped), so the game keeps real time down to 7.5 rendered fps.
- Each step runs `input.beginStep()`, then `systems.update(dt)`, then `systems.lateUpdate(dt)`, then `input.endStep()`.
- `dt = FIXED_DT * game.currentScale()`:
  - `game.hitstop(duration, scale)` gives an impact freeze.
  - `game.slowmo(scale, duration)` gives slow motion.
  - `game.timeScale` is a global scale.
- Both timers count **real** time. `game.rawDt` is always the unscaled step.
- Render: `systems.frame(alpha, realDt)`, then `pipeline.render()`. **Actors interpolate** `prevPos → pos` with `alpha` (`Actor.syncVisual`).
- **Sim vs. render transforms:** between frames, `actor.root` holds the *interpolated* transform. Before you query world-space node positions (muzzles, nozzles) during a step, call `actor.syncSim()`. `PlayerMech`, `Boss` and `Enemy.getMuzzle` already do this.

### 3.4 States and sessions

The state flow:

```
boot → title → briefing → playing ⇄ paused
                            └→ results (sim keeps running for explosions)
```

- `game.setState(s)` emits `game:state {from,to}`. The sim steps only in `playing` and `results`. Input is enabled only in `playing`.
  - Every switch to `playing` calls `input.resume()`: presses latched while the menus were up are dropped (keys pressed in the pause menu never fire on resume) and buttons still held from the menu count as already held (no rising edge: pad A on RESUME does not jump).
  - Live play (not `?test=1`) auto-pauses on `input:pointerlock-lost`, window `blur` and `visibilitychange` (hidden).
- `game.setQuality('low'|'medium'|'high')` switches GRAPHICS QUALITY at runtime (OPTIONS) and at boot (saved option, applied before the pipeline warms up): `pipeline.setQuality` (post chain), `env.setQuality` (near shadow map size, far cascade on/off + re-bake, ash flake count) and, in live play, the pixel ratio (LOW caps it at 1.0; `game.pixelRatioCap` = 0.5 on software rasterizers). `game.params.quality` follows it.
- `game.startSession({seed, state})` starts a new session. It:
  - re-seeds every RNG stream,
  - clears input overrides,
  - resets the clock,
  - runs every system's `reset()`,
  - emits `session:start`.

  **Restart must not leak.** The smoke test compares scene objects, actors, bodies, colliders, event listeners, GPU geometries and textures, and DOM nodes across 3 restarts. Subscribe to events in `init()`, never in `reset()`. Reuse pooled objects.

### 3.5 Services (no null checks needed)
`game.fx`, `game.audio`, `game.hud` and `game.cam` start as **no-op stubs** in `core/engine.js` and are replaced when their system inits. Other services are published by their system:

| Service | Contents |
|---|---|
| `game.player` | `PlayerMech` |
| `game.enemies` | Enemy manager |
| `game.projectiles` | Projectile system |
| `game.lockon` | Player FCS |
| `game.mission` | Mission system |
| `game.arena` | Stage geometry and spawns |
| `game.env` | Sky, fog, sun |
| `game.pipeline` | Post-processing chain |
| `game.menus` | Menu screens |

Also on the game object:
- `game.actors`: every Actor, player included.
- `game.physics`, `game.rng`, `game.events`, `game.assets`, `game.input`.

---

## 4. Coordinates, units, determinism

- **Meters, seconds, radians. +Y up.** Right-handed (Three.js).
- The arena is 500 m × 500 m, centred on the origin, with walls at ±250 and an altitude ceiling of 160.
- **Forward = +Z** for mechs, enemies and models (the glTF convention). Blender models face **−Y** and are exported with *+Y up*. **An actor's right is −X** in its local frame.
- Yaw: `forward = (sin yaw, 0, cos yaw)` and `right = (−cos yaw, 0, sin yaw)`. `root.rotation.y = yaw`.
- `actor.pos` is the **feet** position. Drones are the exception: their `pos` is the body centre.
- **Determinism:**
  - Never call `Math.random()` in `src/` (`npm run check` enforces this). Use named streams: `game.rng.stream('fx' | 'ai' | 'weapons' | …)`. Streams are independent, so adding FX randomness never changes AI decisions.
  - Never read `performance.now()` or `Date.now()` in the simulation.
  - The same URL and seed give the same frames. The smoke test verifies this.

---

## 5. Physics (`src/core/physics.js`)

**Static colliders** are oriented boxes (`addBox(center, half, quat?, tag, userData)`), stored in an XZ spatial hash with 16 m cells.
- **Ground:** `groundHeight(x,z)`, flat 0 by default. Terrain can be plugged in with `setGroundFunction(fn)`.
- **Bounds:** `setBounds({minX,maxX,minZ,maxZ,maxY})`.

Queries (all allocation-free; reuse `makeHit()` / `makeContact()` objects):

| Query | Purpose |
|---|---|
| `resolveCapsule(pos, radius, height, vel, contact)` | Pushes a vertical capsule (feet at `pos`) out of boxes, ground and bounds. Removes the velocity component into each contact. Sets the `grounded`, `wall` and `ceiling` flags. |
| `raycast(origin, dirUnit, maxDist, hit, {ground})` | Static colliders and ground, using a DDA over the hash. |
| `raycastBodies(origin, dirUnit, maxDist, filter, hit, pad)` | Actor bodies: vertical capsules or spheres. |
| `overlapBodies(center, r, filter, out)` | Bodies inside a sphere. |
| `distanceToBody(point, body)` | Distance from a point to a body. |
| `lineOfSight(a, b)` | Clear line between two points. |

**Bodies** are registered by `Actor.spawn()`: `{actor, kind:'capsule'|'sphere', radius, height, offsetY, team, enabled}`.

**COL_ convention (Blender → GLB):**
- Any node named `COL_*` becomes an **invisible box collider**:
  - For a **mesh**, the collider is its local bounding box transformed by its world matrix. Rotation and non-uniform scale are both supported.
  - For an **empty**, the world scale gives the half-extents.
- `COL_` nodes are removed from the render scene.
- A visible mesh with the custom property `iw_collider = 1` is also a collider.
- A static collider whose `userData.actor` is set belongs to that actor (for example the turret base), so projectiles hitting it damage the actor.

---

## 6. Actors, damage, stagger (`src/game/`)

`Actor` (in `actor.js`) is the base for the player and all enemies:
- Stats: `ap`/`apMax`, `acs` (an `AcsGauge`), `team` (`'player'`/`'enemy'`), `radius`, `height`, `aimHeight`, `targetable`, `invulnerable`.
- Kinematics: `pos`, `prevPos`, `vel`, `yaw`.
- `root`: the Group to add visuals to.
- Lifecycle: `spawn(pos,yaw)` → per step `preStep(); update(dt)` → per frame `syncVisual(alpha)` → `despawn()` / `dispose()`.
- Hooks: `onHit(hit,res)`, `onStagger(src)`, `onDeath(by)`. `kill(by)` emits `actor:killed`.
- `aimPoint(out)` returns the lock-on and aim point.

**All damage** goes through `combat.dealDamage(game, target, hit)` or `combat.dealSplash(...)`.
- `hit = {damage, impact, direct, directHitMul?, splashFrac?, point?, dir?, source?, weapon?}`.
- Pure math lives in `damage.js` (unit-tested):
  - AP damage.
  - **ACS / stagger:** impact fills the gauge. When the gauge is full, the target is staggered for `staggerTime`, and direct hits deal `directHitMul` extra (default 1.85). The gauge decays after `decayDelay` seconds.
- **UI naming:** call the gauge "STAGGER" / 姿勢, never "ACS". `acs` is an internal name only.
- `onDeath` must not call `dealSplash` synchronously, because the splash iterates a shared array.

---

## 7. Mech (`src/mech/`)

### 7.1 Node-name contract (mech GLBs: `mech_player`, `mech_boss`)
The canonical list is in the header of `src/mech/rig.js`. Summary:

- Units and orientation: meters, +Y up, faces +Z, right is −X, feet on y=0 at the origin, roughly 10 m tall.
- Joints are nodes at their pivots with **identity rest rotation**. Procedural animation rotates about local X (pitch), Y (yaw) and Z (roll).
- Hierarchy:
  ```
  root
  └ pelvis
    ├ thigh_L/R → shin_L/R → foot_L/R
    └ torso
       ├ head → eye
       ├ arm_L/R → forearm_L/R → hand_L/R → weapon_L/R → muzzle_L/R
       ├ shoulder_L/R (back-weapon mounts) → muzzle_LB/RB
       └ booster_back, booster_L, booster_R
  ```
- `nozzle_<group>_<n>` can sit anywhere. The exhaust direction is the nozzle's **local −Z**. Flame intensity is derived from the exhaust direction against the current thrust vector, so any placement works.
- Muzzles fire along local +Z. If a muzzle is missing, the weapon mount node is used.
- Missing nodes are auto-created as empty Groups and logged with `console.warn`.
- `src/mech/placeholder.js` builds a box mech that obeys the same contract.
- Rig API:
  - `MechRig.create(game, id, {palette})`
  - `rig.update(dt, pose)`
  - `kickRecoil(slot)`, `qbTwitch(x,z)`, `landImpact(s)`, `setThrust(localDir, amount)`
  - `getMuzzle(slot, pos, dir)`, `getNodeWorld(name, out)`
  - `nozzles[]`

### 7.2 Motor and tuning
- `MechMotor` (in `motor.js`) is the movement model shared by the player and the boss:
  - walk, ground boost (toggle), **quick boost** (instant velocity set, EN cost, cooldown, chainable)
  - **assault boost** (wind-up, then fast flight that follows the aim)
  - jump, hover and glide
  - gravity, landing lag, stagger and blade lunge
  - substepped capsule collision
- Input goes in through an **intent** (`makeIntent()`). Outputs are `pos`, `vel`, `yaw`, `grounded`, `mode` and the one-step `flags` (`qb`, `jumped`, `landed`, `abStart`, `abEnd`, `enDepleted`).
- `EnergyGauge` (in `energy.js`) handles EN: regen delay, redline lockout and the instant restore.
- **Every movement, camera and aim tunable lives in `src/player/tuning.js`** (`MOVE`, `CAMERA`, `AIM`). The values follow the benchmark's §3.4 (a2) "[ADAPTED]" targets. The boss uses `BOSS_MOVE = {...MOVE, overrides}`.
- Chase camera (movement lane r4, `src/player/camera.js`): vertical FOV 50 (+6 boost, +10 AB, AB launch peak 63, as benchmark §3.4), orbit ~37.7 m from the rig centre (the closest that keeps the rig at 23-30% of frame height at FOV 50, `npm run telemetry`). QB: FOV punch +5, a 0.012 rad directional jolt gone in 0.15 s, and a 0.4 m camera kick opposite to the burst. Ground dust (`src/player/movefx.js`): the drag streak is emitted by distance (every 0.6 m), and lit dust in the shade of a static collider uses a darker `_sh` twin. Occluders: the camera first SLIDES (26 rays to the rig silhouette, cheapest fully clear offset up to 4 m sideways / 2.5 m up, also clear 0.35 s ahead, critically damped ~0.2 s); what no slide clears is cut out by `src/player/cutout.js` (hard, clean-edged rounded hole on the arena materials, no dither). Shots `cam_slide` / `cam_occlusion` show both cases. Movement r4b: during a QB the verniers facing away from the burst throw a real jet (cap `FLAME.verLenQB` 3 m) and the main bells' floor drops 60% (`rig.js` `qbHold`), so a sideways QB reads as a sideways jet; AB flight pulls the camera 6.5 m in; speed motes stream LOW (slab to eye height), never across the sky; `cam.metrics.rigSil` / telemetry `rig_sil_pct` report the pose-aware silhouette next to the upright `rig_frame_pct`.

---

## 8. Weapons, projectiles, lock-on (`src/weapons/`)

**Fixed loadout** (`PLAYER_LOADOUT` in `weapons.js`):

| Slot | Weapon | Input |
|---|---|---|
| R | rifle (`rifle_ar`) | LMB, hold |
| L | pulse blade (`blade_pulse`) | RMB |
| LB | multi-lock missiles (`missile_pod`) | Q |
| RB | heavy cannon (`cannon_heavy`) | E |

- **Weapon defs** are plain data objects in `WEAPONS`. Types are `ballistic`, `missile`, `grenade` and `blade`. Enemy weapons are in the same table.
- `new Loadout(game, owner, map)` is called with `update(dt, triggers)` every step. The owner interface is:
  - `team`, `pos`, `alive`, `motor?`, `forward(out)`, `aimHeight`
  - `getMuzzle(slotKey, outPos, outDir)`
  - `getAimPoint(slotKey, projSpeed, out)` (lead-predicted)
  - `getLockTarget()`, `getMissileTargets()`
  - `onWeaponFired?`
- `game.projectiles.spawn(def, owner, pos, dir, target?)` uses a pool of 700. It sweeps a segment against static colliders and against bodies of the other team, then damages them via `combat`. Visuals are 2 InstancedMeshes, interpolated.
- `game.lockon` is the player FCS:
  - `target`, `missileLocks[]` (a lock takes `AIM.missileLockTime` in the cone), `candidates[]`
  - `switchTarget()` (Tab or middle mouse)
  - `leadPoint(S, target, speed, out)`
  - It writes `actor.lockProgress` and `actor.lockAngle` for the HUD.

---

## 9. FX (`src/fx/particles.js`, VFX lane)

`game.fx.spawn(name, pos, dir?, opts?)`. `opts` is either a number (scale) or `{scale, normal, yaw, vel, incoming}`; `vel` = owner velocity (parts with `inherit` ride along), `incoming` = projectile direction (ricochet sparks).
- Effects are data in `src/fx/library.js` (particle parts + `kind: light | decal | chunks | distort | shake` parts). Restyle there or via `game.fx.register(name, parts)`; the old part format (`blend: 'add'|'alpha'`) still works.
- ONE instanced batch, CPU-sorted back-to-front, premultiplied alpha (fire inside smoke layers correctly). Shapes: lit billow puffs (baked atlas `assets/fx/*.webp`, `assets/fx/bake_fx.py`), fire temperature ramp, star flashes, spark streaks, rings, chunks, flares, electric bolts, and `fire`: a 64-frame volumetric fireball->soot FLIPBOOK (`assets/fx/fx_fire.jpg`, baked by `assets/fx/bake_fire.py`; a part's `erode` range = flipbook phase, `heat` = temperature multiplier). Soft particles via the pipeline SOFT layer (`markSoft` / `depthUniforms`). Pool 8000 (long-lived smoke thins out above 75%). Deterministic (RNG stream `fx`).
- Anchors: `game.fx.anchor(node, pos)` returns a slot to pass as `opts.anchor`; parts with `attach: true` then follow that node for their (short) life (muzzle flashes ride the recoiling barrel; weapons.js does this for rig owners).
- Sub-systems on `game.fx`: `trails` (persistent smoke ribbons: `begin(style)/push(h,pos)/end(h)`), `decals` (scorch marks on static geometry), `debris` (3D chunks with burning trails), `distortion` (heat haze / shockwave refraction pass in the pipeline `pre_bloom` slot), `slashes` (pulse-blade arc + beam), `ghosts` (QB afterimage). `fx/status.js` reacts to `actor:stagger`, `weapon:blade`, `player:qb` and low-AP enemies.
- Two constant flash point lights (`game.fx.flash(...)`), so the light count never changes and no shader recompiles.
- Sprite-edge guarantees (combat r2): every particle shape is windowed to exactly 0 at its quad border; puffs erode their outline with the atlas detail + a per-particle fBm offset (puff atlas cells 0-3 thick billows, 4-7 torn dust: part `variant`); big puffs/fire average a 5-tap scene-depth soft fade and fade size-aware near the camera; thin streaks never rasterise below ~2.2 px (extra width paid with alpha). Dev URL knob `&fxdebug=edges` paints magenta any fragment that is non-zero at its quad border. Part kind `pool` = brief additive warm light pool on the slab under a blast (`fx.decals.addPool`); part field `sizeVar` = per-particle size spread.
- Combat r3 (VFX lane): **exhaust jets** `fx.jet(pos, dx,dy,dz, len, halfWidth, level, gain, seed)` (shape 9): a view-space quad from the nozzle exit to its tail projected onto the exit's depth plane, never shorter than 28 px on screen (a jet pointing at the chase camera still reads as a flame), core #FFF4D6 -> #FFB04A -> #FF6A1A -> #7A2A10 with scrolling turbulence and shock diamonds; `fx/status.js` emits one per lit nozzle per step (tunables `JET`, quick-boost bursts `QB_JET`) plus main-bell heat haze, and clamps the exit glow to ~1.3x the bell diameter. `rig.js FLAME.mainFloor`: main bells idle at 0.75 x thrust while boosting in any direction. Puffs use a soft-band erosion with a (1-r^2)^1.5 falloff (atlas rebaked with wide density ramps); world-aligned sheets cap at 0.3 alpha. Sparks are curved, tapered strips (the particle quad is 1x4 segments; iExtra.z = gravity/100, iSize.y = age). Flashes (glow/star/flare, nosoft) are pulled toward the eye by half their size. Part fields `offset` (m along dir). Missile puffs are emitted by distance (`trailStep` in the weapon def); tracers have a 20 px minimum screen length; weapon field `rigFlash` lights the firing shoulder.
- Combat r4 (VFX lane): `fx.jet(..., discR)` draws two sprites, the side-on flame blade (faded by `(1-|jetDir·view|)^0.7`, so an end-on jet no longer splays into a flat V) and an end-on **exit disc** (#FFF4D6 -> #FF6A1A, radius `discR` ≈ 1.2x the bell, 30 Hz stepped flicker, only when the jet points at the lens); the blade core runs 2/3 of the jet with three legible shock diamonds (0.3/0.6/0.9 of the core, 0.25 m, 1.6x). World-aligned puff sheets and velocity-streaked puffs never show the atlas outline (radial wobble window; sheets fade at grazing angles). Heat haze only refracts background ≥ 2 m behind the haze sprite, never samples a nearer surface, is damped inside the player-rig box, max 0.0025 UV. Plume shader (`fx/flame.js` `PLUME.levelMax`/`softCap`) caps the HDR peak and windows its mantle before the shell. Effect flashes are capped at `FLASH_CAP` irradiance on their own spawn point (particles.js). New part fields: `erodeVar` (per-particle flipbook phase offset), `colPow` (colour-over-life curve), `wind` (m/s drift along the ash wind). Effects `casing_rifle` (weapon field `casingFx`/`casingBack`), `blade_edge` (5 spark fans along the cut, weapons.js). Player rifle tracers: 45 px min length, 3 px min width, 3-frame afterglow after impact (projectiles.js). Slash arc: 125°, cutting edge ~11.7 m, tapered 0->1->0, scrolling erosion, 0.12 s + 2-frame afterglow (`fx/slash.js SLASH`). Missile ribbons darken to #6D6A66 by 2 s, fade by 3.6 s, drift downwind.
- **Effect names** (keep them): `muzzle, tracer, impact_sparks, explosion_small, explosion_large, smoke, boost_flame, qb_burst, ab_trail, dust_kick, blade_arc, missile_trail, shockwave, debris`, plus `muzzle_rifle/_cannon/_missile/_energy, impact_ground/_wall/_energy, blade_hit, blade_glow, stagger_burst, arc_spark, fire_lick, shell_trail, nozzle_glow`.
- `game.fx.freeze = true` stops the simulation (for staged shots). `clear()` and `activeCount()` are also available.
- Rig nozzle flames: geometry and levels in `rig.js`, plume shader in `src/fx/flame.js`: the lathe shell is a bounding volume and the shader RAY-MARCHES an emissive jet inside it (combustion ramp, 3D turbulence, mach diamonds, ragged tip), so plumes read end-on too. `fx/status.js` holds the plume flare up during assault boost via `rig.flare()`.

## 10. Audio (`src/audio/audio.js`)

`game.audio.play(id, {pos?, volume?, pitch?})` plays a one-shot.
- It stays silent until `unlock()`, which the menus call on the first click or key (browser autoplay policy).
- Continuous boost and AB hum is driven from the player motor in `frame()`.
- To use a sample instead of the synth, add a manifest entry `sfx_<id>`.
- **Sound ids:**
  `rifle, enemy_gun, enemy_laser, blade, blade_hit, missile_launch, cannon, explosion_small, explosion_large, hit_confirm, damage_taken, stagger, qb, jump, land, ab_start, en_depleted, repair, lock, lock_switch, objective, objective_tick, alarm, mission_complete, mission_failed, ui_select, ui_confirm, reload`.

## 11. Events (`game.events.on(name, fn)` returns `off()`)

| Event | Payload |
|---|---|
| `game:ready`, `game:booted` | — |
| `game:state` | `{from, to}` |
| `game:resize` | `{width, height}` |
| `session:before-reset` | `{sessionId}` |
| `session:start` | `{sessionId, seed}` |
| `input:action` | `{action, code, source}`, fired immediately on key/button down (menus use it) |
| `input:pointerlock-lost` | — (the engine pauses) |
| `input:draglook` | `{reason}` |
| `actor:added` / `actor:removed` | `{actor}` |
| `actor:hit` | `{target, hit, result}` — **payload reused, copy what you keep** |
| `actor:stagger` | `{target, source}` |
| `actor:killed` | `{actor, by, type, team}` |
| `enemy:spawned` | `{enemy, type}` |
| `enemy:hit` | `enemy` |
| `boss:intro` / `boss:engage` | `{boss}` |
| `weapon:fired` | `{owner, slot, weapon}` |
| `weapon:reloaded` | `{owner, slot}` |
| `weapon:blade` | `{owner, phase, hits?}` |
| `projectile:impact` | `{def, actor, point, team}` — **reused** |
| `lockon:switch` | `{target}` |
| `player:qb` | motor flags |
| `player:repair` | `{kitsLeft}` |
| `mission:stage` | `{stage, def}` |
| `mission:progress` | `{stage, progress, count}` |
| `mission:complete` / `mission:failed` | `{result}` |
| `mission:end` | `{result}`, sent after the outro delay; the results screen opens |

## 12. Assets (`src/manifest.js`, `src/core/assets.js`)

- `MANIFEST = { id: {url, type} }`, where `type` is one of `gltf`, `texture` or `audio`/`binary`.
  - Add an entry only when the file exists; `check` fails otherwise.
  - Ids not in the manifest resolve to `null` or the placeholder, with **no network request**. Load failures produce a `console.warn` and use the fallback.
- API:
  - `await game.assets.instantiate(id, placeholderFactory)` returns `{object, source}` (it clones skinned meshes correctly).
  - `gltf(id)`, `texture(id, {linear})`, `arrayBuffer(id)`, `preload(ids)`.
- Suggested ids: `mech_player`, `mech_boss`, `wpn_*`, `arena`, `enemy_mt`, `enemy_drone`, `enemy_turret`, `tex_*`, `sfx_*`, `music_*`.
- `dist/` build: every manifest file is base64-embedded, so keep the total under **14 MB**.
  - Compression: meshopt (`EXT_meshopt_compression`) is supported.
  - **Do not use Draco or KTX2.** They need side-loaded wasm that the single-file build cannot provide.
- **Arena GLB conventions** (see the `src/world/arena.js` header):

  | Node | Meaning |
  |---|---|
  | `COL_*` | Collider |
  | `SPAWN_player` | Player spawn. Faces its local +Z, which is Blender −Y. |
  | `SPAWN_mt_<n>`, `SPAWN_drone_<n>` | Enemy spawns |
  | `SPAWN_boss_<n>` | Boss entry candidates. The mission picks the one ~100 m from the player with line of sight. |
  | `OBJ_relay_<n>` | Stage-2 generators |

  Custom properties `iw_collider` and `iw_noshadow` are also read.
- **Contract fixtures:** `python3 tools/make_contract_fixtures.py -- .shots/fixtures` writes a minimal mech GLB and a minimal arena GLB that follow the contracts. Preview them with `npm run shoot -- --shot gameplay_chase --params "asset.mech_player=.shots/fixtures/test_mech.glb&asset.arena=.shots/fixtures/test_arena.glb"`. This is the reference for the Blender→three axis mapping. The path was verified in the dev build and in the single-file build (embedded data URIs).
- **Enemy GLBs** (`enemy_mt`, `enemy_drone`, `enemy_relay`; built by `blender/enemies/build_*.py`) must name these nodes (full contract in the header of `src/enemies/models.js`):
  - mt: `hull`, `turret`, `barrel`, `muzzle`, plus `eye`, `beacon`, `pelvis` and legs `thigh_L/R > shin_L/R > foot_L/R` (walk cycle) and `nozzle_back_*`
  - drone: `body`, `rotor` (+ `rotor_1`…: every `rotor` / `rotor_<n>` spins about its own +Y; a rest rotation = fan tilt; optional blade mesh `fanblades_<n>_geo` under it, swapped at speed for ghost blades + a streak disc), `muzzle`, `eye` (+ optional child `eye_rim`: iris halo with its own `iw_eye_color`)
  - turret (relay generator): `base`, `core` (+ optional mesh `core_glass*`: plasma-glass shader), `head`, `barrel`, `muzzle`, plus `eye`, `beacon`
  - mt `debris_<n>` extras: `iw_debris_speed` (launch speed scale; < 1 = big chunk that lands beside the wreck), `iw_half` (rest height)
  - Purely visual motion (gait IK, fan spin, recoil, stagger slump, death collapse, damage smoke) lives in `models.js` `makeAnimator()`; enemy classes call `this.anim.update(dt)`.

## 13. UI (`src/ui/`, `css/ui.css`)

The HUD is an HTML overlay under `#ui > #hud`. The class names listed in the header of `hud.js` are the styling contract. DOM writes happen only when values change.
- API: `game.hud.callout(text, jp, kind, seconds)`, `damageFrom(worldPoint)`, `setVisible(bool|null)`.
- Menus (`#menus`) provide the title (with controls in JP and EN), briefing, pause and results (rank) screens.
  - Enter confirms and Esc toggles pause. Gamepad (menus up, `core/input.js`): d-pad / left stick emit `look_*` (selection), A confirms, B = `pause` (back / resume), START = pause.
  - **Mouse contract:** the `#menus` container is click-through (`pointer-events: none`); only visible `.menu` screens and buttons catch the mouse, so during play every click reaches the canvas (fire, Pointer Lock re-capture, drag-look). The smoke real-time row asserts it (lock refused → chip, click fires, drag turns the aim, re-click locks).
  - `game.menus.show(name)`, `hideAll()`, `showResults(result)`.
- Fonts are system fallbacks for now. The benchmark §5 suggests vendoring `@fontsource/*` from npm.

## 14. Mission (`src/game/mission*.js`)

`MissionLogic` is pure and unit-tested. It runs these stages:
1. Destroy the MT squad (5 `mt`, plus 2 drones as harassment).
2. Destroy the 3 relay generators (`turret`, plus drones).
3. Destroy the rival rig (`boss`).

Then **MISSION COMPLETE**.
- **FAILED** when player AP reaches 0, or on the 15-minute time limit.
- **Rank S–D** is computed by `computeRank()` from the clear time (par 300 s), damage taken and repair kits used.
- `game.mission.forceStage(i)` is a debug hook.

## 15. TEST API (`window.__iw`, only with `?test=1`)

| Call | Returns / effect |
|---|---|
| `ready` | `true` once boot is done |
| `step(n, {render})` | Steps n fixed frames, renders once, returns `getState()` |
| `render()` | Renders without stepping |
| `setShot(name, opts)` | Promise of the state. Stages a shot. `opts`: `{seed, cam:[x,y,z], look:[x,y,z], fov, t, hud, fxFreeze}` |
| `advance(n)` | Steps n, re-applies the shot camera, renders |
| `getState()` | `{state, frame, time, player:{pos,vel,speed,ap,en,state,grounded,ammo…}, enemies:[…], mission:{stage,status,…}, lock, fx:{active}, projectiles, render:{calls,triangles,sceneCalls,sceneTriangles}}` |
| `press(a)` / `release(a)` / `tap(a)` / `releaseAll()` | Action overrides. Actions are listed in `core/input.js` `ACTIONS`. |
| `setAim(yaw,pitch)` / `aimAt([x,y,z])` / `teleport([x,y,z], yaw)` | Aim and position control |
| `godmode(bool)` / `killAll(type?)` / `damagePlayer(n)` / `restart()` / `startMission()` / `stage(i)` | Debug controls |
| `counts()` | Leak metrics |
| `shots()` / `shotInfo(name)` | Shot listing |
| `game` | The Game object |

## 16. Staged shots (`src/scenes/shots.js`)

Add an entry to `SHOTS`:
```js
my_shot: {
  desc: 'one line', frames: [0, 6, 12], hud: false,
  async setup(S) {
    S.begin({ clear: true });
    S.place(S.rel(55), S.yaw);
    S.hold('quick_boost', 1);
    S.steps(10);
  },
  camera(S, frame) { S.cam(S.rel(90, 20, 8), S.rel(55, 0, 4), 50); },  // optional
},
```
- **Author positions with `S.rel(forward, right, up)`**, relative to the arena's player spawn, so shots survive arena swaps.
- Helpers:
  - `begin`, `place`, `steps`, `hold`, `tap`, `press`/`release`
  - `aimAt`, `cam`, `orbit(target, yawDeg, pitchDeg, dist, fov)`
  - `spawn(type, pos, yaw)`, `clearEnemies`, `enemy(type)`, `yaw`, `rel`
- Existing shots (keep these names):
  `title, mech_front, mech_back, mech_three_quarter, arena_wide, arena_ground, gameplay_chase, boost_ground, qb_sequence, ab_flight, combat_rifle, combat_missiles, blade_hit, explosion, boss_intro, boss_fight, hud_full, results_win, results_lose`.

## 17. Performance budgets and code rules

**Budgets:**
- 60 fps on a mid-range GPU at 1080p.
- **≤ 600 draw calls** and **≤ 3M triangles** in the scene pass (`getState().render.sceneCalls`/`sceneTriangles`; the smoke test checks this).
- Shadow map 2048–4096 (currently 2048 on a single directional light that follows the player, texel-snapped).
- Pixel ratio ≤ 1.5.

**Code rules:**
- **No per-frame allocations in hot loops.**
  - Use module-level scratch `Vector3`s and pooled objects (`core/pool.js`).
  - Reuse event payloads for high-frequency events.
  - Hoist comparators and closures out of per-step code.
- Static geometry is merged per material (see `arena.js`). Many copies go into InstancedMesh.
- Keep the light count constant; toggle intensity instead of adding or removing lights.
- Every Three.js resource you create gets disposed in `dispose()`, or is marked `userData.shared = true` if it is cached or shared.
- Keep modules small with English comments. Tunables go in data objects, not in logic.

## 18. Known gaps / hooks for specialists

| Area | Gaps |
|---|---|
| Render | No SSAO/GTAO yet (`pipeline.setSlot('ao', pass)` is ready). No volumetrics, motion blur or ash particles in the air. The sky is a gradient shader. |
| Arena | Placeholder boxes. Replace with the `arena` GLB (COL_ and SPAWN_ conventions above). |
| Mech | Box placeholder that follows the contract. The rig animation is procedural and simple (no foot IK). |
| VFX | One baked fireball flipbook (all explosions share it, varied by size/rotation/mirroring/phase). Decals are quads (no projection onto curved meshes). Afterimage/heat haze are screen-space approximations. |
| Enemies | The MT is a tank placeholder (the benchmark suggests a 5 m walker). No hard-lock camera mode yet. |
| Audio | Synth placeholders only. |
| UI | System fonts. No compass tape or radio subtitles. |

## 19. Render pipeline, atmosphere and depth access (`src/render/`)

Owner: render engineer. This section supersedes the "Render" row of §18.

**Files.** `atmosphere.js` (ATMOS art-direction data, shared fog/sky GLSL, global shader-chunk patches), `environment.js` (lights, shadow cascades, sky, IBL, weather; `game.env`), `sky.js` (procedural dusk ash-storm sky + shared 256² noise texture), `weather.js` (falling ash/embers), `postfx.js` (post shaders), `pipeline.js` (render graph; `game.pipeline`), `proctex.js` (placeholder canvas textures).

**Frame graph** (`pipeline.render`): `env.preRender(camera)` (sky follow, near-cascade fit, one-time far-cascade bake, weather) → SCENE (camera layer 0, HalfFloat HDR + DepthTexture, MSAA ×4 on high) → SOFT (layer 1, see below) → stats snapshot → slots `ao`, `pre_bloom` → camera motion blur (reprojection from depth; the player rig's screen box stays sharp) → AO (½ res) → VOLUME (¼ res volumetric sun scattering through both shadow cascades, see below) → sun shafts (¼ res, only when the sun is ahead) → EYE ADAPTATION (64×36 log-luminance grid → 1×1 centre-weighted EV offset, see below) → bloom (½…1/64 mip chain, soft-knee threshold ≈ emissives only, compressive source clamp `look.bloom.clamp` so tiny super-bright sprites cannot flood the wide mips into halos) → slot `post_bloom` → COMPOSITE (AO (floored at `look.ao.floor`), volume (bilateral upsample), shafts, bloom, exposure × adaptation, edge-only CA (≤ 0.5 px, channel-clamped), AgX tone map + look (power 1.15 / sat 1.22) with a hue-preserving blend for near-primary HDR emissives (red sensors and beacons stay red, not salmon), split-tone grade (shadows desaturated and tinted cool, highlights toward #F2C79A at constant luminance), toe-protected contrast, vignette, **black-level lift** (display black = sRGB #1C2126 × `grade.liftAmt`, applied after the vignette so no pixel crushes to #000), grain, sRGB) → SMAA (high/medium) or FXAA (low) → canvas. Tone mapping happens only in the composite: `renderer.toneMapping` is not applied to the HDR target.

**Quality levels** (`&quality=`; costs are estimates at 1080p on a GTX 1660 / RX 6600 class GPU):

| Pass | high | medium | low |
|---|---|---|---|
| Scene MSAA (hardware GPUs only; off on CPU rasterizers, where it would triple the frame time) | ×4 (+0.8 ms) | off | off |
| Near shadow cascade (every frame, light-aligned box ~70 m, pushed ahead of the camera) | 4096² (~1.0 ms, draw-call bound) | 2048² | 2048² |
| Far shadow cascade (static arena, baked ONCE, 0 ms/frame) | 4096² | 2048² | off |
| AO (SAO-style, depth-reconstructed normals, 2 depth-aware blurs) | 12 taps @ ½ (~0.45 ms) | 8 taps | off |
| Volumetric sun scattering (fog ray-march × 2 shadow cascades + 2 depth-aware blurs) | 24 steps @ ¼ (~0.35 ms) | 16 steps | off |
| Sun shafts (sky mask + 2 radial blurs) | 36 taps @ ¼ (~0.15 ms) | 24 taps | off |
| Bloom (13-tap down / tent up) | 6 mips (~0.35 ms) | 6 mips | 5 mips |
| Camera motion blur (full res) | 8 taps (~0.25 ms) | 6 taps | off |
| Eye adaptation (64×36 + 1×1) | ~0.02 ms | same | same |
| Composite (+ per-pixel aerial-perspective chroma shift on high/medium: one `iwFogOD` + `iwFogInscatter` per pixel) | ~0.45 ms | same | ~0.3 ms (no aerial) |
| Sub-pixel resolve (r4: 2 full-res 9-tap passes before SMAA, see below) | on (~0.15 ms) | on | off |
| AA | SMAA 'high' preset (~0.45 ms) | SMAA | FXAA |
| Ash flakes (1 instanced draw) | 6000 | 3800 | 1800 |

Software rasterizers (SwiftShader / llvmpipe, i.e. no GPU): outside the test harness and without an explicit `&quality=`, `environment.js` switches to `low` and pixel ratio 0.5 (the arena pass is fill-rate bound on a CPU). The harness (`?test=1`) always renders the requested level (minus MSAA on a CPU rasterizer). Boot warm-up: `pipeline.init` bakes the far cascade and compiles the scene's programs before `ready`; the first rendered frame compiles the actors' programs and waits for the GPU.

Post total ≈ 2.75 ms high / 2.05 ms medium / 0.6 ms low at 1080p (plus the scene and near-shadow passes).

Dev-only URL knobs (not for players): `&tonemap=aces|agx`, `&exposure=`, `&msaa=0|4`, `&ao=0`, `&vol=0`, `&shafts=0`, `&mblur=0`, `&aa=smaa|fxaa|none`, `&postdebug=ao|bloom|vol`, `&ae=0` (no eye adaptation), `&aedebug=1` (console.warn the adapted EV + mean log2 luminance of the first frames), `&sun=azimuthDeg,elevationDeg`, `&look=grade.contrast:1.2,bloom.intensity:0.2` (any numeric `look` field), `&atmos=fog.sunStart:500,fog.cap:0.8` (any numeric `ATMOS` field, applied before the shaders bake it), `&postdebug=depth` (log2 view depth / 12, sky black), `&weather=0` (hide the falling ash), `&speckle=0` (no sub-pixel resolve).

**Atmosphere (global).** `installAtmosphereChunks()` replaces the `fog_*` chunks and the directional-light block of `lights_fragment_begin` once at boot (environment init, before any material compiles):
- *Key light*: low dusk sun, azimuth −68° / elevation 13° (`ATMOS.sun`): the mission is played facing +Z, so the sun sits ~68° to the player's right and slightly ahead — raking 3/4 back light, long shadows toward the camera, a warm sun side and a cool storm side in every wide frame. Shots that stage units in the sun (`shots.js` `stageSpot`) read `game.env.sunDir` and adapt.
- *Height fog*: two exponential layers (dense ground ash + thin high haze). In-scatter = ambient part + sun part `iwFogSunPart(dir, base)` (HG lobe + warm wash + a near-isotropic sunlit term, faint on the storm side). The ambient part depends on the view AZIMUTH (`iwSunSector(dir)`): warm grey `ATMOS.fog.far` within ~45-60° of the sun azimuth, cool slate `ATMOS.fog.cool` (#4E555C) on the storm side, so every wide frame has a warm sun side and a muted-blue storm side (§5 colour script). Geometry fully dissolves into the sky haze between `ATMOS.fog.farFade` (2.6-3.9 km) and the sky's haze scale reaches 1 at the horizon, so there is no horizon step. The VOLUME pass removes the sun part where the ray is in shadow and adds a near-field sunlit dust term (`look.volume.dust`, tight HG lobe g 0.72, `dustRange` 280 m, march ≤ 400 m: beams between shadows, not a veil over the whole sun side), so the analytic fog and the volumetric agree. Every built-in material and every `ShaderMaterial` with `fog: true` that includes `<fog_pars_fragment>` / `<fog_vertex>` gets it.
  - *Sun in-scatter start distance* (`ATMOS.fog.sunStart` 1400 m, `sunFloor` 0.05 since r4; cf. UE's directional-inscattering start distance): each metre of fog scatters sunlight with weight `floor + (1-floor)(1-e^{-t/sunStart})`. The analytic fog uses the ray average (`iwSunRamp(d)`, normalised to 1 at 4 km, so the sky/horizon glow is unchanged), the VOLUME pass integrates the same weight per step (`iwSunWeight(t)`). Fog within ~400 m adds ≤ ~30 % of the sun wash: sun-side structures at 100-300 m keep their lit/shadow separation.
  - *Sun transmittance into the ground layer* (`sunGroundShadow`): the haze hugging the ground is less sun-lit than the haze aloft (`iwSunT(y)`, ~0.6 at the ground, ~1 above 150 m); far tower bases sit in a darker ground band instead of a glowing bank (faded out before `farFade`, so the horizon still meets the sky haze).
  - *Storm side is thicker* (`stormDensity` 1.25 extinction multiplier away from the sun azimuth, `iwStormMul(dir)`): the far kit there layers into slate haze.
  - *Opacity cap* (`cap` 0.8 below `capRange` 1.7-2.6 km): far silhouettes keep a faint ground contact; `farFade` still dissolves everything into the sky haze by 3.9 km.
  - *Water* — **contract**: a material that defines `IW_FOG_WATER` (the sea in `world/water.js`: `mat.defines.IW_FOG_WATER = ''`) gets its in-scatter clamped toward the cool storm haze × `ATMOS.fog.water` (0.8) out to `waterRange` (1-3 km), so the dark sea never reads as warm sand; it blends back to the normal haze at the horizon.
  - *Aerial perspective (chroma)*: the composite shifts each surface's hue toward the haze hue at constant luminance by `look.aerial × fog opacity` (high/medium), so far paint/rust desaturates without the haze brightening it. Inside such fragment shaders `fogColor` is the in-scattered colour for the current fragment and `vFogDepth` an *equivalent exp2 depth*, so hand-written `1.0 - exp(-fogDensity*fogDensity*vFogDepth*vFogDepth)` code keeps working and matches. `scene.fog` (FogExp2) remains the runtime knob: `.density` = ground extinction (1/m), `.color` = far haze colour. The vertex side needs `mvPosition` in scope before `#include <fog_vertex>` (as in stock three).
- *Sun cascades*: directional light 0 (`game.env.sun`) = key light + near cascade; light 1 (`game.env.sunFar`, colour 0) only lends its baked shadow map. The patched lighting lights the sun once with a blended two-cascade, 9-tap bilinear PCF term. Do not add shadow-casting directional lights. Non-shadow directional lights added later still work (stock path).
- The static far cascade is baked from `game.arena.root` only (actors, particles hidden). Call `game.env.rebakeFarShadow()` if static arena geometry changes at runtime.
- `scene.environmentIntensity` drives IBL for every standard material that has no own `envMap` (three.js ignores `material.envMapIntensity` then). The PMREM is the sky dome with a warm ground-bounce lower hemisphere (`ATMOS.sky.bounce`), so shaded rigs keep a readable fill.
- Near cascade anchoring: centred on `game.env.focus` (player / subject) when the focus is within ~60 m of the camera, otherwise on the camera itself (free cameras looking at a far point still get crisp foreground shadows). Depth bias ≈ 4 cm world (the light-space depth range spans ~1.7 km); slope acne is handled by `normalBias`.
- Weather: `game.env.weather.mesh` (hide with `.visible = false`). It replaces the arena's placeholder `game.arena.ash` flakes (hidden automatically). Flakes are dark ash motes (art-directed lighting, not tied to the key intensity), capped at 4 px screen radius at 1080p and faded out within 3-7 m of the camera (they never read as snow or lens dirt). The wind drift alone keeps them round (a 14 cm-per-shutter dead zone: no horizontal 'scratch' dashes on the sky); camera boosts still streak them.
- *Light rig*: key sun 16 (AgX-relative units) at 13° elevation; fill = sky-dome IBL (`scene.environmentIntensity` 1.15) + cool hemisphere (#5C6E84 / #3B3530, 0.8). Shadow sides of concrete land at ~sRGB 42-55 with albedo readable; the composite lift guarantees no pure-black areas.

**Render r4 additions.**
- *Sub-pixel resolve* (`postfx.js` `speckleExcessMaterial` + `speckleSpreadMaterial`, high/medium, before SMAA; `look.speckle = {amount, gate, protect}`). Without MSAA/TAA (MSAA is off on CPU rasterizers and costs ~3.5x there), features thinner than a pixel — far lattice members, rails, crane stays, sun glints on thin edges, wet-slab glitter — rasterize as ISOLATED pixels (dotted lines, sparkles). Pass 1 flags a pixel whose value lies outside the [2nd-lowest, 2nd-highest] range of its 8 neighbours (per channel, linear light) and stores the signed excess; pass 2 redistributes every excess over a 3×3 tent (energy-preserving), i.e. the feature is drawn with its coverage: a dotted wire becomes a continuous faint line, a glint a soft point. Continuous 1-px lines and all larger shapes are untouched (SMAA does their edges). The composite writes alpha = 1 − smoothstep(`protect`) of the HDR luminance so hot emissive cores (lamps, beacons, eyes, muzzle cores) stay crisp. LDR targets: `ldrRT` (composite) → `spkE` (HalfFloat excess) → `ldrB` → SMAA/FXAA.
- *Thinner sun sector* (`ATMOS.fog.sunDensity` 0.58, extinction multiplier inside the warm sector; the storm side stays ×1.25): into-sun silhouettes at 100-500 m layer (dark near, lighter far) instead of dissolving into the glow; the VOLUME pass uses the same multiplier, so its dust beams are carved by tower / furnace shadows instead of veiling the frame.
- *Crepuscular shaft source* (`look.shafts.gap` 0.8, intensity 1.6 → 2.4): the shaft mask weights the sky near the sun by how much brighter it is than the local mean (the eye-adaptation 64×36 log-luminance grid, now computed BEFORE the shafts and linearly filtered), so thin spots of the ash deck feed rays and thick rolls / smoke plumes block them; the radial blur turns the deck structure around the sun into distinct shafts instead of one uniform glow.
- `look.grade.hiLift` 0.3 → 0.45 (more sun-lit faces reach the highlight band of the §5 value budget).
- *Harness fence*: in manual test mode (`?test=1` without `&auto=1`) `pipeline.render` ends with a 1-px `readPixels`, so a capture's (SwiftShader) GPU work completes inside the step/render call instead of inside `page.screenshot`'s 30 s timeout. Play and RAF modes are unaffected.

**Grade additions (r3).** `look.grade.hiLift` (0.3): a highlight shoulder lift above display luma 0.5 (sun-lit faces, glow, emissives) that leaves mids/shadows untouched. Sky (r3): curved storm deck (`+0.25` horizon bend caps the perspective squeeze of the noise at ~3:1), 2D domain warp + a 4th rotated fBm octave, tighter forward-scatter lobe (bright sun core, darker flanks), so the sun half is no longer one flat sepia band.

**Eye adaptation.** `look.autoExposure = {enabled, key, strength, down, up, speed}`. The centre-weighted mean log2 luminance of the HDR frame (before exposure) gives `ev = clamp(strength·(log2(key) − meanLog2), −down, +up)`; `exposure × 2^ev` feeds the bloom threshold and the composite. Partial compensation (strength 0.65, −1.0…+0.15 EV): into-sun frames come down ~0.5 EV, gameplay frames stay within ±0.15 EV. Consecutive frames adapt with a time constant of 1/`speed` s (sim time); a time jump (camera cut, harness capture) snaps, so captures are deterministic. The state lives in two 1×1 HalfFloat targets (no CPU read-back).

**Depth access for soft particles / refraction (`game.pipeline`).**

| Member | Meaning |
|---|---|
| `SOFT_LAYER` (= 1) | Camera layer drawn AFTER the opaque pass, with the opaque depth available as a texture. |
| `markSoft(object3d)` | Moves the object and its children to `SOFT_LAYER` and enables the depth copy (one full-screen pass per frame from then on). Objects on this layer must be unlit (they are drawn without the scene lights) and must not cast shadows. |
| `depthUniforms` | `{ tIwDepth, uIwDepthParams }` — merge the SAME objects into your ShaderMaterial uniforms (`Object.assign(mat.uniforms, pl.depthUniforms)`); the pipeline updates them. |
| `glsl.softDepth` | Prepend to a fragment shader: `float iwSceneDepth()` = linear view depth (m) of the opaque scene at this pixel; `float iwSoftFade(float fragViewDepth, float fadeMetres)` = 0 at contact → 1 when `fadeMetres` in front. `fragViewDepth` = `-mvPosition.z` from the vertex shader. |
| `depthTexture` | Linear view depth (metres, R channel, Float/HalfFloat, nearest) of the opaque scene, drawing-buffer size. Valid during the SOFT pass and all post passes of the frame. `null` until something is marked soft. |
| `sceneDepthTexture` | Raw non-linear DepthTexture of the scene pass (post passes only; never sample it while drawing the scene). |
| `sceneTexture` | HDR scene colour of the current frame (post passes only). |
| `setSlot('ao'\|'pre_bloom'\|'post_bloom', pass)` | Insert a THREE `Pass`-like object (`enabled`, `needsSwap`, `render(renderer, writeBuffer, readBuffer)`, `setSize`) into the HDR chain. |
| `look` | Live art-direction tunables (exposure, bloom, ao, volume, shafts, motionBlur, grade, vignette, ca, grain). |

**Volumetric sun scattering (VOLUME pass).** Quarter-res ray-march (squared step distribution, per-pixel IGN jitter, max 260 m) of the same height-fog density, sampling the near cascade (rigs, actors) and the far cascade (static arena) with hardware PCF compare. Output R = ∫σT(1−V)dt (in-shadow share of the fog's sun light), G = ∫σT·V dt (lit share), B = march-end view depth for the bilateral upsample. The composite applies `col += iwFogSunPart(dir)·(look.volume.lit·G − look.volume.occ·R) + sunColour·phase·look.volume.dust·G`. It reads `game.env.sun/sunFar.shadow.map.depthTexture` and `.shadow.matrix` — keep them PCF (`renderer.shadowMap.type`).

## 20. Release build, harness robustness and the Unreal hand-off (release engineer)

**Single-file build (`tools/build.mjs`).** `dist/ironwake.html` is the only file the end user plays, so it is **tracked in git**
(`.gitignore`: `dist/*` + `!dist/ironwake.html`); run `npm run build` before every commit that changes `src/`, `css/` or assets.
`dist/ironwake.html` = `css/main.css` inline (styles the boot screen at once) + ONE
base64 `<script type="application/octet-stream" id="iw-pack">` holding a gzip stream `[u32 header length][header JSON][payload]`
(payload = the esbuild bundle, the other stylesheets and every `src/manifest.js` file) + a ~2 KB ES5 boot loader. The loader
decodes the base64 (`Uint8Array.fromBase64` or `atob`), inflates with `DecompressionStream('gzip')`, injects the CSS, sets
`globalThis.__IW_EMBEDDED_ASSETS = {id: 'data:<mime>;base64,…'}` (via `FileReader.readAsDataURL`, so `src/core/assets.js` is
unchanged) and runs the bundle as an inline module script. No `DecompressionStream` (pre-2020 Chrome/Edge, pre-2023 Firefox,
pre-16.4 Safari) → a JP/EN "use the latest Chrome or Edge" screen. The build checks the round-trip (gunzip + byte compare) and
prints per-type ratios: meshopt GLBs deflate to ~70 % (the arena to ~30 %), JS to ~32 %; webp/jpg/mp3/woff2 stay ~100 %.
Budget (decimal MB): **warn > 14 MB, exit 1 > 15.5 MB** (16 MB hosting limit). 2026-10-03: 16.59 MB uncompressed → **12.09 MB**
(51 assets, 11.21 MB raw). Frames from the packed and the old layout are pixel-identical (PIL diff, 3 shots). `--no-compress`
writes the old layout for debugging. Assets are embedded byte-for-byte: no texture or audio was recompressed.

**Harness timeouts (`tools/shoot.mjs`, `tools/smoke.mjs`).** Exports `SHOT_TIMEOUT_MS` (120 s, env `IW_SHOT_TIMEOUT_MS`),
`PAGE_TIMEOUT_MS` (180 s, env `IW_PAGE_TIMEOUT_MS`), `isHarnessError(e)` and `screenshotWithRetry(page, opts)`.
`shoot`: every screenshot gets 120 s and one retry at 240 s; a shot whose capture still fails on a HARNESS error (timeout,
crashed/closed page, destroyed context) is retried once on a freshly loaded page; page boots are retried once. Console errors,
exceptions thrown by a shot and unknown shots are never retried and still exit 1. `smoke`: `page.setDefaultTimeout(180 s)` on
every page; the timing-based real-time check (RAF loop, clicks, keys) is retried once with 2.5x longer waits when it fails
without console errors.

**Unreal Engine 5 hand-off (`ue5/`, UNVERIFIED in Unreal: no UE in the build container).**

| Path | Content |
|---|---|
| `ue5/README_JA.md` | Non-programmer guide: install the latest UE 5.x + VS 2022, C++ Third Person project, import, basic third-person setup, Claude Code + VibeUE / UnrealClaude |
| `ue5/CLAUDE.md` | Design doc for Claude Code in the UE project (setting, specs, controls, naming BP_/M_/T_/SM_, do-not-do list) |
| `ue5/GAME_SPEC.md` | Every gameplay number of the web build with Unreal conversions (cm, Gravity Scale 3.263, horizontal FOV) |
| `ue5/PROMPTS_JA.md` | Copy-paste prompts, one small step each (rig → boosts/EN → camera → lock-on → weapons → AI → boss → HUD → mission → results) |
| `ue5/import_ironwake.py` | Unreal Editor Python: imports `ue5/assets` into `/Game/Ironwake`, builds M_IW_Rig / M_IW_Decal / M_IW_Arena + instances, places the arena (1,737 kit instances + 64 structures), markers, a PlayerStart and model previews in the open level. Dry-run tested against a fake `unreal` module only |
| `ue5/assets/` | ≤ 40 MB, regenerated by `tools/ue5_package.py`: `Player/ Rival/ Enemies/` FBX + `T_*_{BC.jpg,N,ORM,E}.png` + decal atlases, `Arena/` kit FBX + one-off FBX + `arena_layout.json`, `MANIFEST.json` |

Regeneration: the rig/enemy FBX come from each owner's full Blender build (`blender/mech/build_*.py`, `blender/enemies/build_*.py`
write `assets/ue5/`, gitignored); `python3 tools/ue5_export_arena.py` re-runs `blender/arena/build_arena.py` in-process (its GLB
export and splat write are stubbed, so no game file changes) and writes `assets/ue5/arena/`; `python3 tools/ue5_package.py`
then strips the FBX tangent/binormal layers (55 % of each file; Unreal recomputes MikkTSpace), re-deflates the FBX arrays at
zlib 9, relinks texture paths to bare file names, writes BC as JPEG q85 4:4:4 (PSNR ≥ 38 dB) and N/ORM/E/decals as lossless
PNG (oxipng when installed), and fails above 40 MB. Its binary FBX writer re-encodes an unmodified file byte-identically
(checked on every run); stripped files re-import in Blender with identical objects, triangles, UVs, custom normals and node
positions. `--arena-textures` additionally writes the arena tiling sets (`T_Arena_<Set>_{BC,N,ORM,H,M}`, ~11 MB; not
committed because of the 40 MB cap). Axes: Blender (x, y, z) m → Unreal (x, −y, z) cm; imported models face +Y.

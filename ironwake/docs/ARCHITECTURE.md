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
| **Lead engine** | `src/main.js`, `src/core/*` (engine, input, rng, events, assets, physics, pool, systems, debug), `index.html`, `css/main.css`, `tools/*`, `package.json`, `docs/ARCHITECTURE.md`, `tests/{rng,physics}.test.mjs` |
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
| 910 | menus | |
| 950 | audio | |
| 1000 | pipeline | Render |
| 2000 | debug | |

### 3.3 Clock
- Fixed step `FIXED_DT = 1/60`, run from an accumulator, with at most 5 steps per frame (excess time is dropped).
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
- ONE instanced batch, CPU-sorted back-to-front, premultiplied alpha (fire inside smoke layers correctly). Shapes: lit billow puffs (baked atlas `assets/fx/*.png`, `assets/fx/bake_fx.py`), fire temperature ramp, star flashes, spark streaks, rings, chunks, flares, electric bolts. Soft particles via the pipeline SOFT layer (`markSoft` / `depthUniforms`). Pool 8000 (long-lived smoke thins out above 75%). Deterministic (RNG stream `fx`).
- Sub-systems on `game.fx`: `trails` (persistent smoke ribbons: `begin(style)/push(h,pos)/end(h)`), `decals` (scorch marks on static geometry), `debris` (3D chunks with burning trails), `distortion` (heat haze / shockwave refraction pass in the pipeline `pre_bloom` slot), `slashes` (pulse-blade arc + beam), `ghosts` (QB afterimage). `fx/status.js` reacts to `actor:stagger`, `weapon:blade`, `player:qb` and low-AP enemies.
- Two constant flash point lights (`game.fx.flash(...)`), so the light count never changes and no shader recompiles.
- **Effect names** (keep them): `muzzle, tracer, impact_sparks, explosion_small, explosion_large, smoke, boost_flame, qb_burst, ab_trail, dust_kick, blade_arc, missile_trail, shockwave, debris`, plus `muzzle_rifle/_cannon/_missile/_energy, impact_ground/_wall/_energy, blade_hit, blade_glow, stagger_burst, arc_spark, fire_lick, shell_trail, nozzle_glow`.
- `game.fx.freeze = true` stops the simulation (for staged shots). `clear()` and `activeCount()` are also available.
- Rig nozzle flames: geometry and levels in `rig.js`, plume shader in `src/fx/flame.js` (combustion ramp, turbulence, mach diamonds, ragged tip).

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
  - drone: `body`, `rotor` (+ `rotor_1`…: every `rotor*` spins), `muzzle`, `eye`
  - turret (relay generator): `base`, `core`, `head`, `barrel`, `muzzle`, plus `eye`, `beacon`
  - Purely visual motion (gait IK, fan spin, recoil, stagger slump, death collapse, damage smoke) lives in `models.js` `makeAnimator()`; enemy classes call `this.anim.update(dt)`.

## 13. UI (`src/ui/`, `css/ui.css`)

The HUD is an HTML overlay under `#ui > #hud`. The class names listed in the header of `hud.js` are the styling contract. DOM writes happen only when values change.
- API: `game.hud.callout(text, jp, kind, seconds)`, `damageFrom(worldPoint)`, `setVisible(bool|null)`.
- Menus (`#menus`) provide the title (with controls in JP and EN), briefing, pause and results (rank) screens.
  - Enter confirms and Esc toggles pause.
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
| VFX | No flipbook fire (fire is a temperature-ramped eroding puff). Decals are quads (no projection onto curved meshes). Afterimage/heat haze are screen-space approximations. |
| Enemies | The MT is a tank placeholder (the benchmark suggests a 5 m walker). No hard-lock camera mode yet. |
| Audio | Synth placeholders only. |
| UI | System fonts. No compass tape or radio subtitles. |

## 19. Render pipeline, atmosphere and depth access (`src/render/`)

Owner: render engineer. This section supersedes the "Render" row of §18.

**Files.** `atmosphere.js` (ATMOS art-direction data, shared fog/sky GLSL, global shader-chunk patches), `environment.js` (lights, shadow cascades, sky, IBL, weather; `game.env`), `sky.js` (procedural dusk ash-storm sky + shared 256² noise texture), `weather.js` (falling ash/embers), `postfx.js` (post shaders), `pipeline.js` (render graph; `game.pipeline`), `proctex.js` (placeholder canvas textures).

**Frame graph** (`pipeline.render`): `env.preRender(camera)` (sky follow, near-cascade fit, one-time far-cascade bake, weather) → SCENE (camera layer 0, HalfFloat HDR + DepthTexture, MSAA ×4 on high) → SOFT (layer 1, see below) → stats snapshot → slots `ao`, `pre_bloom` → camera motion blur (reprojection from depth; the player rig's screen box stays sharp) → AO (½ res) → sun shafts (¼ res, only when the sun is ahead) → bloom (½…1/64 mip chain, soft-knee threshold ≈ emissives only) → slot `post_bloom` → COMPOSITE (AO, shafts, bloom, exposure, edge-only CA, AgX tone map + look, split-tone grade toward #1C2126 / #F2C79A, vignette, grain, sRGB) → SMAA (high/medium) or FXAA (low) → canvas. Tone mapping happens only in the composite: `renderer.toneMapping` is not applied to the HDR target.

**Quality levels** (`&quality=`; costs are estimates at 1080p on a GTX 1660 / RX 6600 class GPU):

| Pass | high | medium | low |
|---|---|---|---|
| Scene MSAA (hardware GPUs only; off on CPU rasterizers, where it would triple the frame time) | ×4 (+0.8 ms) | off | off |
| Near shadow cascade (every frame, light-aligned box ~70 m, pushed ahead of the camera) | 4096² (~1.0 ms, draw-call bound) | 2048² | 2048² |
| Far shadow cascade (static arena, baked ONCE, 0 ms/frame) | 4096² | 2048² | off |
| AO (SAO-style, depth-reconstructed normals, 2 depth-aware blurs) | 12 taps @ ½ (~0.45 ms) | 8 taps | off |
| Sun shafts (sky mask + 2 radial blurs) | 36 taps @ ¼ (~0.15 ms) | 24 taps | off |
| Bloom (13-tap down / tent up) | 6 mips (~0.35 ms) | 6 mips | 5 mips |
| Camera motion blur (full res) | 8 taps (~0.25 ms) | 6 taps | off |
| Composite | ~0.25 ms | same | same |
| AA | SMAA 'high' preset (~0.45 ms) | SMAA | FXAA |
| Ash flakes (1 instanced draw) | 6000 | 3800 | 1800 |

Software rasterizers (SwiftShader / llvmpipe, i.e. no GPU): outside the test harness and without an explicit `&quality=`, `environment.js` switches to `low` and pixel ratio 0.5 (the arena pass is fill-rate bound on a CPU). The harness (`?test=1`) always renders the requested level (minus MSAA on a CPU rasterizer). Boot warm-up: `pipeline.init` bakes the far cascade and compiles the scene's programs before `ready`; the first rendered frame compiles the actors' programs and waits for the GPU.

Dev-only URL knobs (not for players): `&tonemap=aces|agx`, `&exposure=`, `&msaa=0|4`, `&ao=0`, `&shafts=0`, `&mblur=0`, `&aa=smaa|fxaa|none`, `&postdebug=ao|bloom`, `&look=grade.contrast:1.2,bloom.intensity:0.2` (any numeric `look` field).

**Atmosphere (global).** `installAtmosphereChunks()` replaces the `fog_*` chunks and the directional-light block of `lights_fragment_begin` once at boot (environment init, before any material compiles):
- *Height fog*: two exponential layers (dense ground ash + thin high haze), sun in-scattering (HG lobe + warm wash), near→far colour grading. Every built-in material and every `ShaderMaterial` with `fog: true` that includes `<fog_pars_fragment>` / `<fog_vertex>` gets it. Inside such fragment shaders `fogColor` is the in-scattered colour for the current fragment and `vFogDepth` an *equivalent exp2 depth*, so hand-written `1.0 - exp(-fogDensity*fogDensity*vFogDepth*vFogDepth)` code keeps working and matches. `scene.fog` (FogExp2) remains the runtime knob: `.density` = ground extinction (1/m), `.color` = far haze colour. The vertex side needs `mvPosition` in scope before `#include <fog_vertex>` (as in stock three).
- *Sun cascades*: directional light 0 (`game.env.sun`) = key light + near cascade; light 1 (`game.env.sunFar`, colour 0) only lends its baked shadow map. The patched lighting lights the sun once with a blended two-cascade, 9-tap bilinear PCF term. Do not add shadow-casting directional lights. Non-shadow directional lights added later still work (stock path).
- The static far cascade is baked from `game.arena.root` only (actors, particles hidden). Call `game.env.rebakeFarShadow()` if static arena geometry changes at runtime.
- `scene.environmentIntensity` drives IBL for every standard material that has no own `envMap` (three.js ignores `material.envMapIntensity` then).
- Weather: `game.env.weather.mesh` (hide with `.visible = false`). It replaces the arena's placeholder `game.arena.ash` flakes (hidden automatically).

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
| `look` | Live art-direction tunables (exposure, bloom, ao, shafts, motionBlur, grade, vignette, ca, grain). |

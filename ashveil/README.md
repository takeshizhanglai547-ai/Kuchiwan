# ASHVEIL / 灰帷

A dark-fantasy 3D action RPG **vertical slice** — original IP, built to a
soulslike quality bar.

Runs in a browser. **No network, no CDN, no external assets.** Three.js r160 is
vendored into `vendor/`; every texture, mesh, animation, sound and piece of music
is generated procedurally at runtime.

---

## Run it

Any static file server, from the repository root:

```bash
cd ashveil
python3 -m http.server 8000
# then open http://localhost:8000/
```

It must be served over HTTP — ES modules and the import map will not load from a
`file://` URL.

Optional URL parameters:

| Parameter | Effect |
|---|---|
| `?quality=low\|med\|high` | Override the auto-detected quality tier |
| `?simlock=N` | Advance exactly N fixed simulation steps per rendered frame (used by the automated capture harness; not for play) |

---

## Controls

| Input | Action |
|---|---|
| **W A S D** | Move (camera-relative) |
| **Mouse** | Camera |
| **Shift** | Sprint |
| **Space** | Roll (with i-frames) · backstep if standing still |
| **LMB** | Light attack — 3-hit combo |
| **K** | Heavy attack — **hold to charge** into a guard-break |
| **RMB** | Guard (hold) · **tap just before a hit to deflect** |
| **Q** | Lock on / off |
| **Tab** | Cycle target |
| **R** or **F** | Drink from the Ember Flask |
| **E** | Interact (checkpoints, items, the winch) |
| **Esc** | Pause |

A gamepad is supported (Xbox layout), as is touch on mobile.

### Things that are not on the cheatsheet
- **Deflect** — tapping guard fresh opens a 0.2 s parry window. A successful
  deflect staggers the enemy; hit them again for a **riposte** (×3.0 damage).
- **Guard counter** — attacking within 0.55 s of a successful block hits harder.
- **Backstab** — a light attack from behind an unaware enemy (×2.4).
- **Running attack** — attacking while sprinting.

---

## The slice

```
spawn ledge (hero shot) → grand stair → PLAZA (checkpoint I, first Ash Thralls)
   → route split
        high: ramparts   — a Cinder-Caster, and the EMBER SHARD (+attack)
        low:  colonnade  — an Iron Vigil, and the ASHPLATE (+max HP)
   → cistern plaza (checkpoint II)
   → THE CISTERN (dungeon) — the VESSEL FRAGMENT (+1 flask), and the winch
   → the winch opens the EAST BRIDGE shortcut back to checkpoint II
   → fog gate → KILN COURT → VOLGA, THE KILNWARDEN → reward
```

All three upgrades are optional and off the critical path. See `DESIGN.md` for
the full design document and `BOSS_MOVESET.md` for the boss's fairness sheet.

---

## Project layout

```
index.html              shell, import map, boot error surface
vendor/                 Three.js r160 + postprocessing addons (vendored)
src/
  main.js               boot, render pipeline, fixed-step loop
  core/  input camera fx audio util
  ui/    hud.js hud.css
  world/ materials.js build.js level.js
  actors/ rig.js anim.js characters.js actor.js player.js enemy.js boss.js
  game/  combat.js director.js
tools/harness.js        automated play + screenshot harness
```

Simulation runs at a fixed 60 Hz with an accumulator; rendering is decoupled.
Hit detection resolves on the simulation step, so it never depends on framerate.

---

## Automated testing

`tools/harness.js` launches the real game in headless Chromium, drives it through
the actual input layer, and screenshots it. Scenarios: `smoke`, `opening`,
`combat`, `traverse`, `boss`, `fullrun`, `death`.

```bash
node tools/harness.js fullrun --out captures/run --w 960 --h 540 --simlock 6
```

`fullrun` is the Definition-of-Done test: it fails the process if the run does
not reach the victory state.

See `VERIFICATION.md` for what has actually been executed versus what has only
been reasoned about.

---

## Deliverables in this folder

| What | Where |
|---|---|
| Playable build | this folder — serve it and open `index.html` |
| Source | `src/` (engine, actors, world, game, UI) |
| Controls | above, and in-game bottom-right |
| Design document | `DESIGN.md` |
| Boss design + fairness sheet | `BOSS_MOVESET.md` |
| Screenshots | `captures/final/` — `world/`, `combat/`, `boss/` |
| Gameplay video | `captures/final/gameplay_combat_60fps.webm` |
| Verification status | `VERIFICATION.md` |
| Blind-review log + regression checklist | `REVIEW_LOG.md` |

**About the video**: 170 frames captured one-per-simulation-step and encoded at
60fps, so it is 2.8 seconds of genuine real-time gameplay — lock-on, a light
combo, a roll and a charged heavy. It took several minutes of wall-clock to
record because the capture machine has no GPU. The on-screen FPS counter in
every capture reflects that software renderer and is **not** a performance
result; see `VERIFICATION.md`.

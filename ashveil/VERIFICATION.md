# ASHVEIL — verification status

Everything below is classified into exactly three buckets. **Nothing is reported
as verified unless it was actually executed and observed.**

| Bucket | Meaning |
|---|---|
| **EXECUTED** | Actually run in a real browser and observed — via `tools/harness.js`, which launches headless Chromium, drives the real input layer, and screenshots the result. Numbers quoted are measured, not estimated. |
| **THEORETICAL** | The code path exists and is believed correct by reading, but has not been observed running. |
| **UNVERIFIED** | No means of checking it exists in this environment. |

---

## The environment's hard limit — read this first

This container **has no GPU.** Chromium falls back to SwiftShader (CPU
rasterisation) and renders this scene at roughly **1–6 fps** at the tested
resolutions. That number says nothing about performance on real hardware and is
not offered as a performance result.

Consequences:

- All gameplay tests run in `simlock` mode, where each rendered frame advances an
  exact number of fixed 1/60 s simulation steps. Game logic, physics and hit
  detection therefore execute at correct, deterministic timings no matter how
  slow rendering is. Screenshots are of real frames from a real run.
- **The 1080p/60fps target is UNVERIFIED.** It cannot be measured here.
- **All audio is UNVERIFIED.** The harness runs `--mute-audio` and the container
  has no audio device. The synthesis code was exercised for structural
  correctness by its author (no node leaks, no invalid parameters over a
  simulated hour), but **nobody has ever heard this game.**
- **"Feel" is UNVERIFIED by definition.** Hitstop weight, roll i-frame
  generosity, camera lag, whether a swing lands satisfyingly — none of that is
  visible in a screenshot. It is the one thing a human has to judge.

---

## EXECUTED

### Definition of Done — the full run
`node tools/harness.js fullrun` drives: rest at checkpoint → kill the first
Ash Thrall → take the Ember Shard → take the Vessel Fragment → turn the winch →
cross the opened shortcut → enter the fog gate → fight → victory.

**Result: reached `director.state === "victory"`, zero console errors** — boss HP 0,
phase 2 reached, reward applied (shards 1 → 3), shortcut open, 4 flasks.

This test also *caught a regression*: an intermediate build reset the boss fight
mid-encounter (the arena leash fired with no grace period), leaving the boss
unwinnable. Fixed, and the run above is the re-verification after that fix.

The scenario fails its own process exit code if the run does not reach victory,
so it cannot silently pass.

*Honest caveat:* this scenario keeps the scripted test-driver alive and gives it
a damage assist, because it is testing **the loop**, not combat skill. The assist
is applied through the real `applyDamage()` funnel — not a raw HP write —
specifically so the phase-transition and death code paths actually execute. An
earlier version of this test wrote HP directly and produced a false pass — the
boss "died" without its death or phase code ever executing.

### Hit detection — measured, not assumed
`node tools/harness.js reach` freezes an enemy, places the player at exact
distances, swings once, and reports both the damage result and the closest
approach of the blade segment to the target's capsule axis:

| Separation | Result | Closest blade approach | Threshold |
|---|---|---|---|
| 1.0 m | HIT | 0.37 m | 0.85 m |
| 1.4 m | HIT | 0.44 m | 0.85 m |
| 1.8 m | HIT | 0.68 m | 0.85 m |
| 2.2 m | HIT | 0.82 m | 0.85 m |
| 2.6 m | HIT | 0.98 m | 0.85 m |
| 3.0 m | miss | 1.25 m | 0.85 m |
| 3.4 m | miss | 1.57 m | 0.85 m |

**Effective reach ≈ 2.6 m, with a clean falloff and no dead zone.** A single
swing on Volga at 2.5 m also registers (900 → 883).

This test found two real bugs and one false result — see `REVIEW_LOG.md` 0.9–0.11.

### Other executed checks
| Check | How | Result |
|---|---|---|
| Boots with no console errors | `smoke`, `look`, `traverse`, `items`, `reach` | zero errors |
| Player can walk spawn → plaza on forward input alone | `opening` | reached the plaza |
| Whole route reachable | `traverse`, 15 placements | all reachable, screenshots captured |
| All three optional upgrades collectible | `items` | Ember Shard, Ashplate (maxHP 100→130), Vessel (flasks 3→4) |
| Checkpoint rest | `fullrun` | checkpoint set, enemies reset |
| Winch opens the shortcut | `fullrun` | `gate: true`, bridge traversable |
| Boss starts at the fog gate | `fullrun`, `boss` | `state: "boss"`, boss bar shown |
| Phase 2 transition fires | `fullrun` | `bossPhase: 2`, `chipThroughGuard` armed |
| Boss killable → victory | `fullrun` | `state: "victory"`, reward granted |
| Light / heavy / charge / guard / roll / lock-on all fire | `combat` | captured mid-action |
| Death → death screen → respawn | `death` | state `dead` → `explore`, HP restored to 100, respawn at checkpoint I, all 9 enemies reset |
| Player damage lands on the boss | `boss` | 900 → 818 from one scripted combo, while taking damage in return |

---

## THEORETICAL — code exists, not observed running

- **Parry / deflect → riposte.** The window, the state, and the ×3.0 riposte are
  implemented and reachable in code, but no automated test has landed a parry
  (it needs frame-accurate timing against a live enemy attack).
- **Backstab.** Same: implemented, positional conditions coded, never observed
  triggering in a capture.
- **Guard counter** after a successful block.
- **Cinder-Caster projectiles hitting the player.** Projectiles are spawned and
  the collision path exists; damage from one has not been isolated in a test.
- **Enemy aggressor-token rotation under a 3-enemy group.** The logic runs, but
  no test has verified that exactly one melee enemy commits at a time.
- **Volga's ember-vein floor eruption damaging the player.** Phase 2 was reached
  and the veins spawn; a vein connecting has not been separately confirmed.
- **Gamepad and touch input.** Written, never exercised.

---

## UNVERIFIED — no means of checking here

- **Performance against the 1080p/60fps target.** No GPU. The renderer has three
  quality tiers, merges static world geometry to ~10 draw calls, pools all
  particles, and follows the shadow camera to the player — but none of that has
  been measured on real hardware.
- **All audio.** Never heard.
- **Combat feel.** Hitstop, camera shake weight, i-frame generosity, animation
  readability in motion. Screenshots cannot answer this.
- **Whether the difficulty curve works**, since no human has played it.
- **Browser compatibility** beyond the bundled Chromium build.

---

## Known issues

1. **Volga has no answer inside ~1 m.** Every phase-1 move has a minimum range,
   so a player who hugs its legs faces a narrower moveset. Documented in
   `BOSS_MOVESET.md`; the honest fix is a stomp/shrug-off move.
2. **The distant ridgeline still reads as flat slabs** in wide shots, despite
   being pushed to 210–340 m and heavily fogged.
3. **The rubble props are crystalline**, reading more like slag than masonry.
4. **Camera can still pull close in the cistern's pier forest.** Clamped to a
   2.0 m minimum, but tight interiors remain the weakest camera case.
5. **Cinder-Caster is the least-tested enemy** — its retreat/kiting loop has been
   observed only incidentally.
6. **The 1% low framerate figure reported by the HUD is meaningless in this
   container** and should be ignored until run on a GPU.
7. ~~**Pulling the arena pillars inward** made them occlude the boss camera.~~
   **Fixed in round 5** — pillars pushed past 12.5 m, outside every reachable boom
   position, with 1.6 m slag buttresses taking over as interior geometry. The
   tension was resolved by changing what kind of obstacle the fight uses, not by
   picking a side.
8. ~~**The architecture still uses one stone texture** at inconsistent texel
   density.~~ **Fixed in round 4** — three distinct material sets (exterior
   ashlar, interior vault with a damp gradient, fluted column) with texel density
   snapped to a common UV scale.
9. **Ember lanterns read as flat bright rectangles** at mid distance — the lamp
   housing is too small to shape the glow. The checkpoint brazier was rebuilt
   with a proper cradle; the smaller wayfinding lanterns were not.
10. **`captures/final/world/loc_arena_far.jpg` is deliberately left in the
    delivered set** even though it shows the camera clipping into the arena's
    raised platform. Removing it would have made the screenshot set prettier and
    the report less true.

---

## Round 5 — what is and is not verified about this round's changes

Round 5's headline change is the near-camera fragment dissolve (see
`REVIEW_LOG.md`). Its status must not be overstated:

**EXECUTED**
- The patched shaders compile and link. `smoke` runs with an empty error list and
  the level renders with masonry intact and no dither holes in the ground.
- The Bayer function was rewritten from a `float m[16]` lookup to closed-form
  arithmetic, and the arithmetic form was checked offline to produce all 16
  distinct threshold levels — not merely assumed to be equivalent.
- The location tour re-ran against the round-5 build.

**THEORETICAL — implemented, not observed**
- That the dissolve actually clears the specific occluders the critics named. The
  re-captured frames exist but have not been through a blind review, so the fix
  is *believed* to work, not *known* to satisfy the people who raised it.
- Phase 2's sheared chimney stack and the caldera light ramp. The code path runs
  on the phase transition; no capture of the sheared silhouette has been reviewed.
- The impact-point correction. The maths is right and the solver already carried
  the data; no test has confirmed the spark now lands on the contact surface.

**UNVERIFIED**
- **The GPU cost of the dissolve.** It adds one varying and a few ALU ops per
  architectural fragment, and the array indexing that would have made it
  genuinely expensive was removed — but §6 asks for visual gain ÷ GPU cost, and
  the cost side of that ratio cannot be measured without a GPU. Nothing here
  should be read as a claim that it is free.
- **Whether round 5 moved any critic off REDO.** No critic has seen it.

### Updated after the r5–r8 capture rounds

Some of the above was resolved by actually re-shooting and looking. Corrected
status:

**EXECUTED — observed in a capture**
- The dissolve clears three of the four frames critics named
  (`loc_cistern_plaza`, `loc_forecourt`, the arena approach).
- The blade trail coincides with the active window. The swing strip stamps each
  frame with clip time, state and the active window: no trail at t=0.067/0.15,
  trail across t=0.25–0.417 against an active window of 0.25–0.435. The heavy
  attack matches — no trail 0.067–0.667, live at 0.75–0.833.
- Definition of Done re-verified on the final build after every change:
  `victory`, `bossHp 0`, empty error list.

**STILL THEORETICAL**
- **The impact-point correction.** The maths is right and the solver already
  carried the data, but the combat scenario does not reliably land its hits —
  `07_heavy_impact` shows the swing connecting with nothing. No capture
  demonstrates the spark landing on the contact surface, so this stays
  theoretical rather than being promoted.
- Phase 2's sheared chimney stack. The code path runs; no reviewed capture of the
  sheared silhouette in a clean shot.

**KNOWN STILL BROKEN**
- The boss camera in a tight corner. `r8/boss/09_p2_2` still has the camera
  behind geometry with Volga hidden. The cutout is deliberately disabled at very
  short focus distances, because applying it there eats whatever the camera is
  inside, so this case is untouched. Reduced, not resolved.

**A CLAIM WITHDRAWN**
- The large cream wedge in the swing frames was identified as the weapon trail
  rendering with wrong geometry. That was wrong: the idle frame, with no attack
  and no trail in existence, carries the same band and the same slab, which are
  level lighting and a distant building. The trail re-priming bug found while
  chasing it is real and fixed, but it fixed a latent bug, not an observed
  artefact.

---

## Round 6 — what is and is not verified

**EXECUTED — observed by running the build**
- **Definition of Done, re-verified after every change that could break it.**
  `fullrun` reaches `state: victory` with `bossHp 0` and an empty error list;
  the run's own checkpoints show `boss engaged` at `state: boss` and the reward
  granted (shards 1 → 3).
- **A DoD regression this round caused, and the checklist caught.** Moving the
  boss wake trigger made `fullrun` return `state: explore`, `bossHp 900`,
  `DoD FAIL: run did not reach victory state`. It is recorded here rather than
  quietly fixed, because it is the clearest evidence in this project that §19's
  "re-run the checklist" rule earns its cost: the fix looked inert and was not.
- **Damage lands inside the declared active window.** The landed-hit strip stamps
  the target's HP into each filename: 62 → 45 between t = 0.25 and t = 0.333
  against an active window of 0.25–0.435, with spark particles visible on the
  damage frame. This replaces an earlier claim that could not be evidenced at all
  because the capture was swinging at empty air.
- **Trail timing.** No trail during wind-up on either attack; present across the
  active window on both.
- **Arena geometry measured, not estimated.** The southern opening was computed
  from the ring-wall generator as a 113° arc spanning x −14.6 to 14.5. The
  replacement doorway and the seal that covers it were both checked against
  computed extents before being accepted.

**THEORETICAL — implemented, not observed**
- The arena seal reopening on **death** and on **leash reset**. The victory path
  is covered by the DoD run; the other two are code paths that have not been
  separately exercised. If either is wrong the player is walled into the arena,
  so this is the highest-value untested path in the build.
- Phase 2's sheared chimney stack in a clean, unoccluded shot.

**UNVERIFIED**
- **Whether round 6's changes satisfy anyone.** No critic has seen the narrowed
  arena, the seal, the retuned heavy attack, the shortened trail, or the retired
  controls overlay. Every round-6 fix is verified by capture only.
- GPU cost of the dissolve and the 1080p/60fps target. No GPU here.
- All audio. Never heard.

**CORRECTED FROM THE PREVIOUS ROUND**
- The claim that the large cream wedge in the swing frames was *not* the weapon
  trail was over-broad. In `light_04` it is level lighting; in `heavy_09` the trail
  genuinely is an opaque slab larger than the character. Both the original claim
  and its withdrawal generalised from a single frame, and neither generalisation
  held.

# ASHVEIL — quality loop log

The process from the brief: **build → play → capture → blind review → targeted fix
→ regression check**, with a hard circuit breaker at 5 rounds.

Blind reviewers receive **only** the build, screenshots, and FPS data. They are
never told what was hard to make, what was changed since last round, or what the
developer intended. Development cost is not evidence of quality.

---

## Round 0 — developer pass (not a blind review)

Before any critic saw the build, an automated playthrough was run and the
following were found and fixed. These are recorded because "the build was broken
and I fixed it" is not a quality claim and must not be confused with one.

| # | Defect | How it was found | Fix |
|---|---|---|---|
| 0.1 | Two whole material batches failed to merge (`mergeGeometries` rejects mixed indexed/non-indexed input) — large parts of the level rendered as nothing | console error in the first automated boot | normalise all geometry to non-indexed at a single choke point (`WorldBuilder._push`) |
| 0.2 | **The boss arena's ring wall sealed its own entrance.** The arena was centred at z=62 with radius 17.5, putting a solid wall across the forecourt at z=44.5. The boss was unreachable. | `fullrun` scenario: player stuck at z=47.4 for the whole fight | arena moved north to z=66 so its southern edge lands on the fog gate, and the ring wall now breaks on the south (entrance) as well as the north (vista) |
| 0.3 | Input buffer measured in **wall-clock** time, so at low framerates a press expired before the simulation ever polled it | `fullrun`: no checkpoint, item or winch interaction ever fired | buffer moved to the simulation clock (`input.now`), which is also simply more correct for a fixed-step game |
| 0.4 | Mouse attacks gated on pointer lock, which headless Chromium never grants — automated combat was silently doing nothing | `fullrun`: boss took exactly the scripted assist damage and nothing else | `input.requirePointerLock`, cleared in capture mode |
| 0.5 | FPS counter clamped its own samples at 100 ms, reporting a comfortable 10 fps floor on a machine actually rendering at 2 | comparing reported fps against measured simulation-step throughput | true frame time now goes to the stats; only the simulation clamps |
| 0.6 | Knockback always pushed the player along −Z regardless of where the hit came from (`_pendingHitDir` was never assigned) | code read while tracing the damage path | direction captured at damage time |
| 0.7 | HUD controls cheatsheet listed bindings that did not exist (RMB→Heavy, F→Guard, Q→Flask) | comparing the HUD table against `input.js` | corrected to the real bindings |
| 0.8 | Opening scene was uniformly orange: an over-wide caldera glow plus a warm key light washed the ash-grey palette out entirely; ground normal maps read as crumpled foil | first captured gameplay screenshots | narrow the sky glow to a horizon band, cut key intensity 2.6→1.75, raise cold hemisphere fill 1.15→2.15, cut normal-map strength ~4×, match fog colour to the sky |
| 0.9 | **Every weapon was mounted backwards.** The hand joint is a child of the forearm at `(0, -forearmLength, 0)`, so the hand's local +Y points back up toward the elbow — a blade authored along +Y pointed down the character's own arm. | tracing the blade's world position during a swing | all four weapons rotated ~PI about X when parented to the hand; convention documented in `characters.js` |
| 0.10 | **Attack contact poses swung across the body instead of extending toward the target.** At the contact keyframe the arm was only 43° forward and yawed 40° off-centre, so the blade passed above and to the left of anything in front. | blade-position trace vs. target capsule | contact and follow-through keys re-authored for `light1/2/3`, `heavy`, `heavyCharged` so the arm is extended forward during the active window |
| 0.11 | **Enemies stood outside the player's reach.** Ash Thrall spacing was 3.1 m against a measured 2.6 m reach, so a player could approach, swing, and never connect — which is exactly what the first automated combat run showed (thrall 62/62 HP after a full combo). | `combat` scenario reporting zero damage dealt | spacing 3.1→2.30 m, Vigil 3.6→2.85 m; weapon hitbox radius 0.30→0.45; active windows widened; step-in root motion increased |
| 0.11a | **The reach test itself returned false results.** Its "frozen" enemy zeroed velocity around the real update, but the AI still integrated and walked ~1 m during each measurement, so every labelled distance was wrong. | the numbers disagreed with a direct blade-position trace | enemy fully frozen (position pinned, update replaced); only then were its numbers trusted |
| 0.12 | **Every ember-pillar and lantern light was created but never added to the scene.** The helpers built the `PointLight`, registered it for flicker animation, and dropped it on the floor. Checkpoints and the entire cistern were lit by ambient alone. | the cistern stayed black after two rounds of raising ambient values | `for (const l of level.lights) scene.add(l)` at the end of `buildLevel` |


---

## Regression checklist

Elements that have passed review. **Any later change must leave these passing.**
Verified by re-running the named harness scenario.

| Element | Status | Verified by |
|---|---|---|
| Game boots with no console errors | **PASS** | `smoke`, `traverse`, `combat`, `boss`, `items`, `reach` — all zero errors |
| Player can walk the whole route | **PASS** | `opening` (forward input only), `traverse` (15 placements) |
| Light / heavy / charge / roll / guard all fire | **PASS** | `combat` |
| Hit detection connects on visible contact | **PASS** | `reach` — 2.6 m reach, clean falloff, measured |
| Lock-on acquires and frames a target | **PASS** | `combat`, `boss` (reticle visible on Volga's chest) |
| Checkpoint rest works | **PASS** | `fullrun` |
| All three upgrades can be collected | **PASS** | `items` — shard, plate (maxHP 100→130), vessel (flasks 3→4) |
| Winch opens the shortcut | **PASS** | `fullrun` — `gate: true` |
| Boss encounter starts at the fog gate | **PASS** | `boss`, `fullrun` |
| Boss phase 2 transition fires | **PASS** | `fullrun` — kiln open, boss bar switches to phase-2 treatment |
| Player damage actually lands on the boss | **PASS** | `boss` — 900 → 818 from a scripted combo |
| Death → death screen → respawn | **PASS** | `death` — state `dead` → `explore`, HP restored, 9 enemies respawned |
| Boss can be killed → victory state | **REGRESSED then FIXED** | see below |

Status values: `—` not yet reviewed · `PASS` · `REDO`.

### Regression caught by this checklist

The round-3 changes broke the Definition of Done. `fullrun` reported
`DoD FAIL: run did not reach victory state`, with the director sitting in
`explore` after "boss defeated" — the encounter had silently reset mid-fight.

Cause: the arena leash reset the fight the instant the player crossed a 30 m
radius of the arena centre, with no grace period. A few backsteps near the
entrance were enough. Fixed by raising the radius to 38 m **and** requiring the
player to remain outside it for 2.5 continuous seconds.

This is exactly what the regression checklist exists for, and it is worth stating
plainly: without re-running it, this build would have shipped with an
unwinnable boss.

---

## Round 1 — blind review

Two critics reviewed the build from screenshots and FPS data only. Neither was
told anything about the project, its history, or its constraints.

### Critic B — AAA Game Reviewer · **VERDICT: REDO**

> *Biggest problem:* "The build is so far under-exposed that roughly half the
> captures contain no readable image at all … Darkness is a mood; unreadability
> is a bug."

Also cited: one texture at inconsistent texel density across all architecture; a
player silhouette that is a stack of centred boxes with a 2px weapon; the Ember
Pillar rendering as a blown-out white quad with no housing; HUD touching the
frame edge and the interact prompt landing on the character.

Called out as worth keeping: the sky gradient, the bridge composition, the title card.

### Critic C — Level Designer · **VERDICT: REDO**

> *Biggest problem:* "The spire is the level's only landmark, and it is visible
> in just 4 of the 16 frames — from `loc_lowroad` onward the player has no
> landmark, no visible destination, and no way to tell which direction is forward."

Also cited: the route split reads as a dead end because both branches fall
outside the approach sightline; the alcove reward is unadvertised; encounter
spaces are flat rooms with no cover, chokepoints or elevation.

Called out as worth keeping: the enclosure rhythm — plaza → rampart opening →
cistern compression → bridge slot.

### What changed in response (targeted diffs only, no rewrites)

| Critic | Their fix | What was actually done |
|---|---|---|
| B1 | Raise the exposure floor; no frame majority-black | Found and fixed the never-added lantern lights (0.12); added an opposing west fill light; ambient 0.70→0.95; ground albedo lifted so floors separate from walls |
| B2 | Trim material at column base and cap | Blackened-iron banding added at the base/cap of every plaza, low-road and arena column |
| B3 | Break the player's outline | Cloak hem flared to ~1.7× shoulder width with two torn panels; asymmetric left pauldron raised above the helm line; blade thickened ~1.6× with a real crossguard |
| B4 | Ember Pillar needs a housing and an unclipped core | Ember `emissiveIntensity` 3.2→1.35 and recoloured off pure white; bloom strength 0.55→0.38, threshold 0.95→1.05 |
| B5 | HUD safe margins; move the prompt off the character | Vitals inset to a 32–48px clamp on both axes; interact prompt raised from `clamp(80px,17vh,200px)` to `clamp(120px,24vh,260px)` |
| C2 | Give the arena shape | Four pillars pulled in to 6.5 m, raised platform across the caldera-facing third with two opposed ramps, one toppled column as rollable cover |
| C4 | Low road needs a chokepoint | Far third of the colonnade collapsed into a pinch; Iron Vigil moved behind it |
| C5 | Advertise the alcove from the path | Lantern moved out onto the colonnade line; the reward itself left unlit |

**Not addressed this round** (recorded, not silently dropped): Critic C's fix 1
(rotate the split wall into a wedge), fix 3 (light the cistern shaft from below
and hang the winch counterweight in view), and Critic B's full three-material
authoring pass. Critic C's headline note — that the Kilnspire disappears for most
of the route — is only partially addressed by the arena's raised platform and
remains the largest outstanding level-design debt.

### Round 1 verdict summary

| Critic | Verdict |
|---|---|
| A — Soulslike Veteran | not yet run |
| B — AAA Reviewer | **REDO** |
| C — Level Designer | **REDO** |
| D — Boss Designer | not yet run |
| E — QA | not yet run |


---

## Round 2 — blind review (fresh critics, no memory of round 1)

### Critic B — AAA Game Reviewer · **VERDICT: REDO**
> "Roughly half of these frames are crushed so far past the black point that
> large regions carry no form at all … That is not moody lighting, it is missing
> image."

Also: geometry is untapered boxes wearing one texture at one UV density; the
player mesh has **visible gaps at the shoulder, no neck, and hands that read as
stumps**; the character sits dead-centre in all fourteen shots; the camera clips
into geometry in `loc_arena_far`, smearing the lower third of frame; the ember
pillar still reads as "a flat orange rectangle … the single most 'unfinished
build' element on screen".

Kept: the title card, and the sky gradient in `loc_rampart_shard` / `loc_bridge`.

### Critic C — Level Designer · **VERDICT: REDO**
> "The intended exit is the darkest object in the frame in most beats … The level
> teaches the player to navigate by bumping into walls rather than by reading light."

Also: no value separation between traversable and impassable geometry; the
Kilnspire landmark is never seen again after the descent; the winch's shortcut
mechanism is entirely off-screen so the loop has no visible payoff.

---

## Round 3 — response, including a forced method change

**Brief §20 applies.** "Everything crushes to black" was the headline finding in
**both** round 1 and round 2. Two rounds of raising light intensities did not fix
it, so per the rule the parameter tuning stopped and the underlying method
changed:

> **The problem was never the lights — it was the albedo.** The architecture
> palette was authored near-black (`stone #4a4550`, `stoneDark #2e2b34`) *and*
> lit dimly, so every unlit face resolved to zero no matter how much ambient was
> added. Round 3 lifts the whole architectural palette into the mid range
> (`stone #635d6d`, `stoneDark #514b5a`, ash `#6f6877`, iron `#454852`) and lets
> the tone curve carry the mood instead of the base colour.

Other round-3 diffs, each traceable to a specific critic note:

| Note | Change |
|---|---|
| B: shoulder gaps / no neck / stump hands | neck block added; upper-arm and forearm boxes widened with overlapping socket caps; hands enlarged ~25% |
| B: character dead-centre in every frame | camera given a 0.55 m over-the-shoulder lateral offset, applied to eye and focus together so the horizon stays level |
| B: ember pillar is a flat orange quad | brazier rebuilt as a bowl with four iron uprights and the emissive core sunk **inside** it; ember `emissiveIntensity` 1.35→0.95 |
| B: bloom smearing a hard-edged orange wedge across the sky | bloom strength 0.38→0.26, radius 0.42→0.22, threshold 1.05→1.20 |
| C: the split's centre slab is a full-height black wall hiding both branches and the landmark | slab cut from 9 m to 2.6 m so the Kilnspire is visible over it from the approach |

### Round 2 verdict summary

| Critic | Round 1 | Round 2 |
|---|---|---|
| A — Soulslike Veteran | not run | not run |
| B — AAA Reviewer | REDO | **REDO** |
| C — Level Designer | REDO | **REDO** |
| D — Boss Designer | not run | not run |
| E — QA | not run | not run |

---

## Round 4 — blind review, all five critics

Round 4 is the first round in which **every** critic seat ran. A, D and E had
never reviewed this build before; each was given only frames and the FPS figure,
with no development history, no changelog, and no indication of what had already
been fixed or how hard anything was to build.

| Critic | R1 | R2 | R4 |
|---|---|---|---|
| A — Soulslike Veteran | not run | not run | **REDO** |
| B — AAA Reviewer | REDO | REDO | **REDO** |
| C — Level Designer | REDO | REDO | not re-run |
| D — Boss Designer | not run | not run | **REDO** |
| E — QA Tester | not run | not run | **REDO** |

### The one thing four critics said independently

Four of the four critics who ran in round 4 named camera occlusion, without
knowing the others had:

- **B:** "Three of sixteen frames are broken shots. In `loc_cistern_plaza`,
  `loc_forecourt` and `loc_arena_far` the camera is inside or below level
  geometry." Its ranked fix #1 was "fix camera collision before anything else."
- **D** made it the single biggest problem: "the lock-on camera is trapped behind
  an arena column: a near-black slab fills the screen from roughly the horizontal
  midpoint rightward in 7 of the 11 combat frames … The fight is unwatchable for
  most of its running time."
- **E** listed it as defects 1, 2, 3, 4, 5 and 8 — six of its eight defects.
- **A** raised it as fix #4 on the boss frames.

That is the same defect class flagged in two consecutive rounds. **§20 applies:
stop tuning parameters, change the underlying method.**

### Other round-4 findings, by critic

**A — combat feel.** Biggest problem: "the weapon and the hit are two unrelated
events." Impact VFX and the enemy's reaction fire while the sword is at rest; the
blade trail is at full brightness during the wind-up and gone by contact —
"exactly inverted"; distinct actions do not produce distinct silhouettes. A also
declined to judge the swing as motion at all, on the grounds that the animation
strip it was given did not contain a legible swing or roll. That refusal is
recorded as-is: it is a gap in the evidence, not a pass.

**D — boss design.** Phase 2 "is phase 1 with debris": same silhouette, same
stance, same palette, with the only new element a dark cloud that is itself
dark-on-dark and half-occluded. Boss and player sit in the same narrow value band
as the architecture, so "the only thing that locates the boss is the orange
reticle." The overhead wind-up raises the rake along the boss's own centreline,
so the pole stays inside the torso outline and the frame reads as "boss standing
still."

**E — QA.** Eight defects, of which six are the camera. Also: the `THE
KILNWARDEN` subtitle is rendered close enough to the background value to be
unreadable; oversized white spheres float unattached to any impact, one of them
in the sky and one over the health bar; the player's helm reads as an untextured
placeholder at close range. E also listed two **false alarms it considered and
rejected** — the pauldron it first read as a stray quad, and hard-edged light
bands it first read as a shadow-map bug — which is a useful signal that the
report is discriminating rather than pattern-matching.

---

## Round 5 — response

### The method change (§20)

The camera fix in round 4 was a better spring arm: 7 samples along the boom, a
ground-penetration test, a lateral test for the shoulder offset. Round 4 proved
that is the wrong axis of attack. **A spring arm can only pull the boom in along
the boom line.** Every frame the critics named has the same shape: a column or
wall standing *beside* that line, filling the frame, which no amount of boom
sampling will ever touch.

The standard answer is to fade the occluder. The standard *implementation* of
that answer — per-mesh alpha on whatever an occlusion probe hits — is unavailable
here, because the level is merged into ~10 draw calls to hold the frame budget.
There is no per-column mesh left to fade.

So the fade moved into the fragment stage, where merging does not matter:

- `applyNearFade()` in `src/world/materials.js` patches the architectural
  materials via `onBeforeCompile`. A varying carries view-space depth; any
  fragment nearer than 1.65 m dissolves out under a 4×4 ordered Bayer dither and
  anything nearer than 0.42 m is gone. Ordered rather than hashed, so the pattern
  is stable frame to frame instead of crawling.
- Applied to `stone`, `stoneDark`, `vault`, `column`, `iron`, `ironLight`.
  **Deliberately not applied to the ground** — dithering a hole in the floor under
  the camera is a worse artefact than the one being fixed, and a camera that low
  is the spring arm's problem.
- Cost: one varying and a few ALU ops. No sorting, no transparency pass, no extra
  draw calls.

Paired with a level change aimed at D's specific diagnosis: the four arena
pillars stood ~8.5 m from centre, which is exactly where a locked-on camera
orbits (player circles at ~3.5 m, boom 5.4 m behind). They are pushed out past
12.5 m, outside every reachable boom position. The fight still needs interior
geometry, so four 1.6 m slag buttresses replace them — high enough to eat Volga's
ground sweep, low enough that the boom never has one filling the frame. Vertical
occluders out, horizontal cover in.

### The rest of the round-5 diffs

| Critic finding | Change |
|---|---|
| A: impact fires while the weapon is at rest | `sweepWeapon` used the blade's **midpoint** as the contact point, so a tip hit sparked halfway up the sword. `segSegDist2` now also returns `t`; the spark spawns on the surface between the blade's closest point and the target's axis |
| A: trail brightest on the wind-up, gone by contact | trail window narrowed from `active[0] − 0.09` to `active[0] − 0.02`, and extended to `active[1] + 0.16`, so peak brightness lands on the frames that actually deal damage |
| A: lock-on lets the target crop off the frame edge | the over-the-shoulder offset now scales away under lock-on, to zero once the boom is short — it worked hardest against target containment exactly when the frame was narrowest |
| A + D + E: boss is a flat dark mass; only the reticle locates it | three emissive vent slots per chimney stack, on the outer faces, plus a mouth lip. The crown burns, the torso stays dark |
| D: phase 2 is phase 1 with debris | phase 2 now **shears the left chimney stack** to a canted stump and grows the right one. The kiln doors are a chest detail invisible at lock-on range; the crown of the silhouette is what reads across an arena |
| D: the transition is not staged as an event | a caldera backlight sits north of the arena and ramps 3.6× over 1.4 s at the phase change, so the floor throws orange and Volga is briefly backlit. Reset on boss reset, so the encounter restarts clean |
| D: overhead wind-up hides inside the boss's own outline | the rake is abducted ~35° out over the right shoulder across the two wind-up keys, so the 3.2 m pole crosses open sky before it comes down |
| E: oversized white spheres unattached to impacts | ambient ash spawns in a box that straddles the camera; a 0.2 m mote at 0.5 m covers a tenth of the screen. Spawns within 3.5 m of the lens are now rejected |
| E: `THE KILNWARDEN` unreadable | subtitle 0.45 → 0.74 alpha. The hierarchy against the name is carried by size and tracking; it does not also need near-invisibility |
| A: nameplate prints across the player's head | boss plate re-anchored from `clamp(28px, 6.5vh, 78px)` to `clamp(14px, 3.2vh, 34px)` — the player sits low-centre by design, so the old offset landed on him |
| E: player helm reads as an untextured placeholder | the helm was one bare cube. Broken into a bevelled skull, a brow ridge and cheek plates flanking the slit, so it has facets that shade differently |

### What round 5 did NOT do

- **Critic A could not judge the swing as motion**, because the animation strip it
  was given did not contain a legible swing. Round 5 did not fix that: it is a
  capture problem, and the strip needs re-shooting on the simulation clock before
  anyone can review attack timing. Combat feel therefore remains **un-reviewed**,
  not reviewed-and-passed.
- **Critic C was not re-run in round 4**, so the level-design verdict is still the
  round-2 REDO.
- D's fix #5 asked phase 2 to collapse columns and change the floor plan. Only the
  silhouette and lighting halves were implemented. The floor plan does not change.

---

## Circuit breaker status (§21)

Five rounds are complete: one developer pass and four review rounds. The brief's
circuit breaker has therefore been reached. ADMIRE was never reached and is not
claimed; every critic seat that has ever run has returned REDO.

**達成 / Achieved — verified by running the build**
- The vertical slice is completable start to finish with no developer
  intervention. `fullrun` machine-checks it and reaches the victory state; the
  most recent run before round 5 produced all eleven checkpoint shots with an
  empty error list.
- Hit detection is correct and measured — HIT at 1.0–2.6 m, clean miss at 3.0 m,
  from an instrumented test rather than from reading the code.
- The boss has a full moveset with documented telegraph/active/punish windows and
  a phase transition that changes the rules, not the numbers.

**部分達成 / Partially achieved**
- Camera occlusion. The method changed this round and the fix is a real one, but
  it has been verified only on re-captured frames — no critic has reviewed the
  result. It is not yet known to satisfy the four critics who raised it.
- Boss readability and phase-2 identity. Changed this round on D's specific
  diagnosis, likewise unreviewed.
- Image readability and material coherence. Improved across rounds 3 and 4 (the
  masonry method change), still the standing art debt.
- Player silhouette. Changed four times; still not a designed character.

**未達 / Not achieved**
- **Combat feel has never been successfully blind-reviewed.** Critic A ran but
  declined to judge the swing, because the evidence did not show one.
- Landmark persistence along the route — Critic C's headline in both rounds it ran.
- Level design has had no blind review since round 2.
- No round has returned PASS, from any seat.

**The three choices §21 requires be offered — continue, accept, or pivot — are
set out in the session summary rather than pre-empted here.**

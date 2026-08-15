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

## Round 5 — what the re-captures actually showed

Round 5's diffs were verified by re-shooting the frames the critics named and
looking at them, which is the only way any of this gets checked. Four rounds of
capture were needed (r5–r8) because the first three each revealed something the
previous fix had missed or broken.

### Confirmed fixed

| Finding | Evidence |
|---|---|
| B/E: `loc_cistern_plaza` camera inside the floor, player absent | player in frame, brazier reads, near wall dissolving |
| E: `loc_forecourt` near top-down with a clipped band | normal third-person framing, enemy legible ahead |
| D: arena pillars park against the lens | arena is open; buttresses replace them |
| A: trail brightest during the wind-up, gone by contact | stamped strip: **no** trail at t=0.067/0.15, trail across t=0.25–0.417, active window 0.25–0.435. Heavy the same: no trail 0.067–0.667, live 0.75–0.833 |
| A/D/E: boss is a flat dark mass | chimney vents burn against the sky; the crown reads |
| D: overhead wind-up hides inside the torso outline | rake crosses open sky diagonally |
| A: nameplate prints across the player's head | plate at the bottom edge; epithet legible |
| Definition of Done still holds after every change | `fullrun` → `state: victory`, `bossHp: 0`, empty error list, on the final build |

### Fixed, but only after the first attempt made it worse

- **The dissolve, twice.** The near fade cleared occluders against the lens but
  not a wall standing several metres out, which is the case D actually described.
  Extending it to a subject cutout worked, but the first radius cut a narrow
  dithered slot rather than a hole. Widening that exposed a worse bug: `iron` and
  `ironLight` were in the dissolve list, and those are the player's cuirass and
  Volga's plating — with the cutout centred on the subject, the fix was eating
  the characters it exists to reveal. The r7 boss capture is unreadable because
  of it. Architecture only now, with the effect ramping in only once the shot is
  long enough for an occluder to fit between camera and subject.
- **The ash motes.** A 0.2 m sprite subtends ~58 px at 4 m, so E was looking at
  something genuinely mis-scaled on screen. Rejecting spawns near the lens was
  the wrong fix on its own — ambient motes drift, so one that spawned legally
  wanders in anyway. Fading on live view depth in the shader covers both cases.

### Claimed and then withdrawn

The large cream wedge in the swing frames was called out as the weapon trail
rendering with wrong geometry. **That was wrong.** The idle frame — no attack, no
trail in existence — carries the same tan band along the base of the right-hand
wall and the same pale slab at top centre. Both are level lighting and a distant
building. The actual trail is the modest white-and-orange streak along the
blade's sweep, correctly sized and correctly timed.

The trail's re-priming bug found while chasing it is real and is fixed
(re-priming happened only when a slot was freshly allocated, so a second swing
with the same weapon could streak from the previous swing's blade positions), but
**it fixed a latent bug, not an observed artefact**, and is recorded as such.

### Still broken

- **The boss camera in a corner.** `r8/boss/09_p2_2` still has the camera behind
  geometry with Volga hidden. The cutout is deliberately disabled at very short
  focus distances — applying it there just eats whatever the camera is inside —
  so the corner case is untouched. D's headline complaint is **reduced, not
  resolved**.
- **The combat scenario does not reliably land its hits.** `07_heavy_impact`
  shows the swing connecting with nothing, the enemy across the plaza. A's
  biggest problem — impact VFX firing while the weapon is at rest — is therefore
  still **unevidenced either way**. The impact-point fix is in the code and is
  correct on inspection; no capture demonstrates it.

---

## Round 6 — blind review, three seats, and the re-diagnosis that mattered

Critics A, D and E each reviewed the refreshed capture set with no development
history, no changelog, and no indication that anything had been changed since the
last time any of them looked. All three returned **REDO**.

### What round 6 found that five rounds of work had not

**The boss fight was not happening in the arena.** Critic D noticed that every
combat frame was shot in a narrow choke with tall masses flanking the camera,
while the open plaza built for the fight sat unused a few metres north. Checking
the capture's final player position confirmed it: `z = 50.2`, the arena's
southern lip.

This re-diagnoses four consecutive rounds of "camera occlusion" findings.
Measuring the geometry rather than trusting the reading:

- The wake trigger sat on the arch at `z = 48.5`, so Volga walked 18m south to
  meet a player still standing in the entrance.
- Worse, the arena's southern "entrance" was a **113-degree arc of missing ring
  wall, an opening nearly 29m wide** (x −14.6 to 14.5, measured, not estimated).

So the fight started in a doorway and then had a 29m hole to retreat through. The
black masses filling every boss frame across four rounds of review were the ring
wall segments either side of that hole. **A fight cannot stay in an arena that is
open along one whole side**, and no amount of camera work fixes that — the
occlusion was a symptom and the level geometry was the cause.

Three changes, each verified against the next:
1. Wake trigger moved to `z = 57` (arena floor), radius widened to 9m so a player
   hugging a wall still crosses it.
2. Ring wall threshold −0.55 → −0.94, leaving a ~12m doorway aligned with the
   arch. The Kiln Court becomes an enclosure with one way in.
3. An arena seal across that doorway, inert until the encounter starts. Opens
   again on victory, on death, **and** on leash reset — any one left closed turns
   the arena into a box the player cannot leave.

**The character folds through the floor during the heavy attack.** Critic E,
examining frames at 2–4× with brightness lift, found the player model lying flat
and half-buried in the ground for the entire damage window (t = 0.75–1.033 against
an active window of 0.695–0.92). These frames had been looked at directly in the
previous round and the defect was not seen.

Cause: `hips`, `spine` and `chest` are separate joints in a hierarchy, so their X
rotations **compound**. Each authored value reads as a modest lean; they sum to
1.30 rad on the heavy and 1.52 rad on the charged heavy — 74° and 87°. Both clips
retuned to a deliberate ~45–50° fold.

**The weapon trail, third attempt.** Critic A described it in `heavy_09` as an
opaque polygon larger than the character, occluding the wall behind it. Two real
causes, neither of them opacity:

- The base edge kept 25% alpha, so the ribbon was a *filled* quad. On a wide swing
  it folds over itself and `DoubleSide` stacks every fold toward opaque.
- It retained 22 samples ≈ 0.36s of history against damage windows of 0.185s and
  0.225s — so it was still carrying blade positions from the **wind-up**, when the
  blade pointed somewhere else entirely. Connecting those to the follow-through is
  what folded it into a sheet. No alpha value fixes a ribbon genuinely spanning
  two unrelated poses.

An earlier round had "fixed" this artefact by lowering its opacity, producing a
fainter giant sheet. That is precisely the parameter-tuning failure §20 exists to
prevent, committed anyway, and only caught because a blind reviewer described the
geometry instead of the brightness.

**The controls cheatsheet never retired.** Switched on at startup and never off,
so it covered the lower-right quadrant of the arena for the whole boss fight with
world geometry showing through the text. Correctly identified as a debug keybind
dump. It is onboarding, not HUD: it now retires after 26s or when the fight
begins.

### A claim withdrawn, then partly reinstated

An earlier round called a large cream wedge in the swing frames a broken weapon
trail, then withdrew it after finding the same band in an idle frame. Critic E
independently investigated the same band — cropping and brightening `light_01`
at t = 0.067 with no attack in progress — and concluded it is a lit ledge at the
base of the wall, with *"only the first ~190px out from the hand"* being actual
trail.

Both halves were partly wrong. In `light_04` the band **is** level lighting, so
the withdrawal was right for that frame. In `heavy_09` the trail genuinely **is**
a slab, so the withdrawal should not have covered that. The lesson recorded: a
finding was generalised from one frame in each direction, and neither
generalisation held.

### A regression this round caused, and the checklist caught

Moving the wake trigger **broke the Definition of Done**. The next `fullrun`
returned `state: explore`, `bossHp: 900`, `DoD FAIL: run did not reach victory
state` — the scripted walk stopped at `z = 50.1`, short of the new trigger, so the
encounter never started. Caught only because §19 requires re-running the
checklist rather than assuming a fix is inert. Fixed by widening the trigger and
lengthening the walk; DoD restored to `victory` / `bossHp 0` / no errors.

### Confirmed working, by capture

| Item | Evidence |
|---|---|
| Definition of Done | `fullrun` → `victory`, `bossHp 0`, no errors; `boss engaged` at `state: boss`, reward granted (shards 1 → 3) |
| Damage lands inside the active window | landed-hit strip stamps target HP per frame: 62 → 45 between t = 0.25 and t = 0.333, active window 0.25–0.435, sparks visible on the damage frame |
| Trail timing | no trail during wind-up; present across the active window on both light and heavy |
| Phase-2 frame that failed four rounds | `r12/boss/09_p2_2` shows both combatants, the open kiln glowing, and the reticle on target |

### Still outstanding

- Camera occlusion remains flagged by all three seats. The re-diagnosis is
  producing better results than three rounds of camera work did, but no critic has
  reviewed anything built after round 6.
- Enemies stand between camera and player at close range (A and E both). The
  dissolve is architecture-only by design, so characters do not fade.
- No hit-confirmation flash on the struck actor; the damage number renders as
  illegible grey.
- The light attack's damage window opens before the blade begins travelling.
- No round has returned PASS, from any seat.

---

## Round 6 resolved — the root cause was one collision constant

Four blind reviewers across four rounds reported the same thing: the boss fight
is shot through walls. The responses were a shader dissolve, a multi-sample
spring arm, relocated pillars, a moved wake trigger, a narrowed ring wall, and an
arena seal. **All six were treating a symptom.**

The cause: `CollisionWorld.resolveCircle` allowed an actor to pass a wall only if
its top was within **0.12 m** of the actor's feet, while `Actor.update` will lift
a grounded actor onto anything within **0.62 m**. Every stair in the level was
climbable by the ground query and blocked by the wall query, so an actor stopped
dead at the exact riser it was permitted to stand on.

Concretely: the cistern exit stair tops out at `y = 0.40` with its last riser at
`z = 50.45`. Walking north from the forecourt stopped at `z = 50.05`.

**The Kiln Court had never been enterable on foot.** The boss encounter only
appeared to work because its trigger fired at `z = 48.5`, before that riser — so
the fight always happened in the forecourt, and the black masses filling every
boss frame were forecourt arch piers. Critic D's "the fight is staged in the
corridor, not the arena" was not a framing complaint. It was a literal
description, and it was correct.

Fix: `STEP_OVER = 0.45`, named and bounded just under the actor's own tolerance so
nothing can pass a wall it cannot then stand on.

### How it was actually found

Three consecutive analytical fixes were wrong — the wake trigger left on the
arch, a 6 m seal across a 29 m opening, and a trigger radius that silently undid
its own relocation. Two of them broke the Definition of Done, and the regression
checklist caught both.

What worked was instrumenting the game instead of reasoning about it: a `probe`
scenario that walks the player north and reports position every 0.6 s, and a
`walls` scenario that dumps every collision segment near a point. The probe found
the exact stall coordinate on its first run; the dump named the culprit segment.
Both are now permanent harness scenarios.

| Probe, before | Probe, after |
|---|---|
| t=1.2s → z=50.05 `explore` | t=1.2s → z=52.25 **`boss`** |
| t=4.8s → z=50.05 `explore` | t=4.8s → z=67.01 `boss` |
| t=7.8s → z=50.05 `explore` | t=7.8s → z=72.26 `boss` |

### Verification on the resolved build

| Check | Result |
|---|---|
| Definition of Done | `victory`, `bossHp 0`, zero errors |
| Arena seal, all three exit paths | zero errors |
| Boss fight location | **z = 63**, arena centre `z = 66` |
| Location tour — every stair in the level | zero errors, 16 shots |

The tour mattered most: `STEP_OVER` affects every staircase, so unblocking the
arena while letting an actor walk through a low wall elsewhere would have been a
bad trade. Nothing regressed.

### Still open after round 6

- **Ash motes.** The near-lens fade removed the worst of it, but at 5–8 m a 0.2 m
  sprite is legitimately ~40 px and still reads as a soft white disc. The defect
  is now contrast and colour, not scale. Reduced, not closed.
- **Volga crowds the camera at very close range.** The subject cutout is
  deliberately disabled at short focus distances, because applying it there eats
  whatever the camera is inside, so tight quarters remain the weak case.
- **Enemies occluding the player** at close range (A and E). The dissolve is
  architecture-only by design.
- **No hit-confirmation flash** on the struck actor; damage numbers illegible.
- **The light attack's damage window opens before the blade travels.**

---

## Round 7 — blind review, three seats, and two false positives

Critics A, D and E reviewed the round-6 build blind. All three returned **REDO**.
This is the first round in which reviewers filed findings that turned out to be
wrong, and the first in which two reviewers contradicted each other.

### The disagreement, and how it resolved

Critic A filed the lock-on health bar as dividing by the target's HP at
acquisition rather than by its maximum, supported by pixel measurements: 163px
full at HP 62, 119px at HP 45. Critic E measured the same bar and **rejected the
finding**: *"The bar is exact — the Ash Thrall's max HP is 62, not 100. No bug."*

E is right, and A's own arithmetic proves it: 119/163 = 0.730 and 45/62 = 0.726.
A read the capture stamp `targetHp62` as "62 out of 100". No change was made to
the bar. The stamp now reads `targetHp45of62`, because evidence that invites a
wrong conclusion is the evidence's fault and not the reviewer's.

E's second rejection independently settled something this log had already
reversed itself on once: the long cream diagonal in the swing frames is the
sunlit parapet edge, present in idle frames with no trail, and *"the real trail is
only the segment above it, and it correctly traces the blade tip."* E also
checked every filename's damage-window encoding and found no timing defect
anywhere.

### The second false positive, and why it was acted on anyway

E reported the heavy trail inverting to *"a solid dark polygon that visibly
darkens the parapet brickwork"* mid-damage-window. Measured against a control
strip and a no-trail frame:

| Frame | Swept region | Control | Delta |
|---|---|---|---|
| t=0.75 | 15.9 | 4.6 | +11.3 |
| t=0.85 | 6.4 | 4.8 | +1.6 |
| t=1.1 (no trail) | 5.5 | 4.7 | +0.8 |

It never darkens — at t=0.85 it is still brighter than the same region with no
trail at all. But a ribbon that collapses from +11.3 to +1.6 in a single frame
reads as a glitch regardless of which direction it moves, so the falloff was
softened. **The observation was right even though the diagnosis was wrong**, which
is the most useful shape a review finding can have.

### Confirmed and fixed

| Finding | Seats | Resolution |
|---|---|---|
| The boss's own body hides the player — 5 of 14 fight frames | A, D, E | Volga rebuilt from cloned materials with his own cutout, focused on the PLAYER; a 4.6m boss stepping between camera and player now opens around them |
| Locked target renders directly behind the player | A, D | Structural: the boom sits ON the player→target axis. Fixed with lateral displacement of the EYE only — a deliberate toe-in |
| Ash motes read as opaque white spheres | D, E (and E in round 6) | See below |
| Charged heavy's held tell is pixel-static | A | Measured at 1–2% frame delta against 8.6% during the strike. The long tell stays; two keys add tremor and creep-back |
| Phase 2 is silhouette-identical to phase 1 | D | Right pauldron shed, apron burned back. Engine-asserted |

### The ash motes took three fixes on three different properties

This is worth recording because no amount of code reading would have found any of
them, and because the first two fixes were confidently wrong.

1. **Position.** Spawns within 3.5m of the lens rejected. Helped; insufficient —
   ambient motes drift, so one that spawned legally wanders in anyway.
2. **Brightness.** Measured 7:1 contrast against the ground — a mote at
   (122,114,127) over ground at (15,14,32). Alpha 0.24 → 0.11 and the tint
   darkened. Helped; still (61,58,65) against a near-black wall.
3. **Size.** E measured "2–3px in the distance, 50–90px near camera — a 25x scale
   swing." That 90px figure was literal: the vertex shader clamped `gl_PointSize`
   to 90px as a **fill-rate guard**, and near-camera ash was simply hitting the
   ceiling. E was reading the clamp. Ash and dust now cap at 20px; sparks and
   embers keep the old ceiling.

Each fix addressed a real property and none was sufficient alone, because the
defect was three defects wearing one description.

### Verification on the round-7 build

| Check | Result |
|---|---|
| Definition of Done | `victory`, `bossHp 0`, zero errors |
| Phase-2 silhouette assertions | pass — stacks sheared, pauldron hidden, apron at 0.34 |
| Boss capture | zero errors, fight in the arena |
| Location tour | zero errors, 16 shots |
| Combat + swing | zero errors |
| Landed hit | target visible beside the player, flashing white on the exact frame HP drops 62 → 45 |

### Still open after round 7

- Three location frames with the camera behind geometry: `loc_arena_far`,
  `loc_cistern_floor`, `loc_bridge`.
- The CONTROLS panel has no scrim and is illegible over sunlit paving.
- The arena is dark: A measured 59.9% of one boss frame below luminance 16/255.
- No seat has ever returned PASS, in seven rounds.

---

## Circuit breaker status (§21)

**Six rounds complete: one developer pass and five blind review rounds**, across
fourteen verification capture rounds. ADMIRE was never reached and is not claimed.
**Every critic seat that has ever run, in every round, has returned REDO.**

**達成 / Achieved — executed, not inferred**
- The vertical slice is completable start to finish with no developer
  intervention. Machine-checked repeatedly, including after each change that could
  plausibly break it: `victory`, `bossHp 0`, zero console errors, with the reward
  granted.
- Hit detection measured: HIT at 1.0–2.6 m, clean miss at 3.0 m.
- Damage lands inside the declared active window, evidenced by a strip that stamps
  the target's HP into every frame rather than asking a reader to infer it.
- Boss moveset with documented telegraph/active/punish windows, and a phase
  transition that changes the rules, the silhouette and the arena light.
- The Kiln Court is now an enclosure the fight cannot leave.

**部分達成 / Partially achieved**
- Camera occlusion. Correctly re-diagnosed in round 6 from a rendering problem to
  a level-geometry problem, which produced more progress in one round than three
  rounds of camera work. Not yet reviewed by anyone.
- Boss readability. The crown, the telegraph and the phase change read; close
  quarters are still the weak case.
- Material coherence and player silhouette. Improved every round, never passed.

**未達 / Not achieved**
- **Combat feel has still never been successfully blind-reviewed.** Round 6 was
  the first round where the evidence for it existed; A used it to find real
  animation defects, and those are now fixed and unreviewed.
- Level design has had no blind review since round 2.
- Enemies still occlude the player at close range.
- No hit-confirmation flash; damage numbers illegible.
- No round has returned PASS, from any seat.

**What the six rounds actually demonstrate.** The loop is not converging on
approval, and it should not be reported as if it were. What it is doing is finding
genuinely different real defects each round — the fight being staged outside its
own arena, a character folding through the floor, a trail spanning two unrelated
poses — several of which had been looked at directly and missed. Three of the most
consequential findings came from reviewers who were told nothing about the
project, which is the strongest available evidence that the information isolation
is doing its job rather than producing agreeable noise.

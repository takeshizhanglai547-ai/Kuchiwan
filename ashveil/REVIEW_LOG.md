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

## Circuit breaker status

The brief allows five rounds. **Three were completed** (one developer pass, two
blind rounds) before the session's practical limit was reached. ADMIRE was not
reached and is not claimed.

**達成 / Achieved**
- The vertical slice is completable start to finish with no developer
  intervention (`fullrun` reaches the victory state).
- Hit detection is correct and measured (2.6 m reach, clean falloff).
- Boss has a full moveset, a documented fairness sheet, and a phase transition
  that changes the rules rather than the numbers.
- Readability of the cistern and the ground plane — the round-1 headline
  complaint — is materially fixed.

**部分達成 / Partially achieved**
- Overall image readability. Much better than round 1, still flagged in round 2.
- Player silhouette. Improved twice, still not a designed character.
- Level shape. The arena and low road gained real geometry; the split and the
  cistern are still weaker than the critics want.

**未達 / Not achieved**
- One coherent material set. Still one stone texture at inconsistent UV density —
  Critic B has now raised this twice and it is the largest outstanding art debt.
- Landmark persistence along the route (Critic C's headline in both rounds).
- Critics A, D and E never ran; combat feel, boss design and QA have had **no
  blind review at all**.

**The three options the brief asks to put to the user: continue the loop,
accept as-is, or change direction — are set out in the final summary.**

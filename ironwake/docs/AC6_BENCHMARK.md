# IRONWAKE — AAA Benchmark & Critic Rubric (reference bar: AC6)

This is the quality rubric that every builder and every critic agent uses. "REF" below means the reference title (FromSoftware, 2023). REF is a **quality bar only**. No REF proper noun (game, faction, planet, character, part, manufacturer or mech name) may appear in IRONWAKE content, and no REF mech design may be copied. Genre terms (AP, EN, Quick Boost, Assault Boost, stagger) are fine.

Scale convention for the whole project: **1 world unit = 1 metre, time in seconds.** REF spec values are shown as the game displays them. The in-game speed unit is km/h: the community garage tool computes "EN per metre" as `3.6 × EN/s ÷ speed`, which only makes sense in km/h. Numbers marked **[DATA]** come from datamined part tables. **[OBS]** means community-measured. **[ADAPTED]** means our target, inferred and tuned for a browser game.

---

## 1. Sources

WebFetch was blocked in this container, so the facts below come from search-result extracts of these pages plus the raw datamined JSON (items 1-2).

1. Datamined REF part stats and spec formulas: https://raw.githubusercontent.com/matteosal/ac6-advanced-garage/master/src/Assets/PartsData.json, plus the formulas in the deployed bundle (gh-pages `static/js/main.*.js`). The tool's page is https://matteosal.github.io/ac6-advanced-garage/
2. Digital Foundry tech review (engine, resolution, modes): https://www.patreon.com/digitalfoundry/posts/early-access-6-x-88817224 · https://www.resetera.com/threads/digital-foundry-armored-core-6-df-tech-review-the-elden-ring-engine-returns-on-ps5-xbox-series-x-s.761559/
3. NXGamer / Binary Dinosaur technical review (GPU particles, SSAO, CSM, palette): https://binarydinosaur.co.uk/armored-core-6-nxg-tech
4. Reviews: https://www.windowscentral.com/gaming/armored-core-6-review · https://www.cgmagonline.com/review/game/armored-core-vi-fires-of-rubicon/ · https://gamingtrend.com/reviews/armored-core-vi-fires-of-the-rubicon-review-live-die-repeat/ · https://www.techradar.com/gaming/armored-core-6-review · https://www.theloadout.com/armored-core-6/review · https://n4g.com/news/2563984/armored-core-6-fires-of-rubicon-review-ign
5. Brutalism and scale essay: https://medium.com/@vehemently/nobody-lives-on-rubicon-a40d906cca4f · art book listing: https://armoredcore.fandom.com/wiki/ARMORED_CORE_VI_FIRES_OF_RUBICON_OFFICIAL_ART_WORKS
6. Sound design analysis: https://www.cartermenary.com/blog/armored-core-vi-design-sound-of-rubicon
7. HUD: https://samurai-gamers.com/armored-core-6-fires-of-rubicon/battle-screen-ui-guide/ · https://steamcommunity.com/app/1888160/discussions/0/3820795131609916171/ ("HUD too subtle?") · https://thegemsbok.com/art-reviews-and-articles/armored-core-vi-6-fromsoftware-critique-mechanics-analysis/
8. Lock-on / Target Assist: https://game8.co/games/armored-core-6/archives/425274 · https://onemoregame.ph/armored-core-vi-target-assist-normal-way-play/
9. Camera FOV (no FOV slider; a mod "expands the FOV from 45 to 65"): https://www.nexusmods.com/armoredcore6firesofrubicon/mods/302 · https://www.nexusmods.com/armoredcore6firesofrubicon/mods/232
10. Stagger timing: https://steamcommunity.com/app/1888160/discussions/0/6761670113854337278/ · https://primagames.com/tips/armored-core-6-how-to-make-the-most-of-enemy-acs-stagger-in-ac6
11. Boost colour and ground-boost cost: https://armoredcore.fandom.com/wiki/Boosters · https://steamcommunity.com/app/1888160/discussions/0/3827551164386926087/
12. Mech height (10-12 m): https://armoredcore.fandom.com/wiki/Armored_Core_(mecha)
13. Ranking: https://www.pushsquare.com/guides/armored-core-6-how-to-earn-mission-ranks · https://thefifthmatt.com/ac6-rank-calculator
14. Director interviews (stagger design intent, 3D map structure): https://blog.playstation.com/2023/08/21/interview-with-the-creators-of-armored-core-vi-fires-of-rubicon/ · https://www.animenewsnetwork.com/interview/2023-08-25/what-elden-ring-fans-need-to-know-before-playing-armored-core-vi/.201274
15. Enemy taxonomy: https://www.gamepressure.com/newsroom/enemies-list-in-armored-core-6-who-you-are-going-to-face/z35de5
16. PC settings list: https://www.pcgamesn.com/armored-core-6/best-settings-pc

### What reviewers credit for the "AAA read"
- "Muted yet imposing art design over technical chops." The engine is a mid-2010s-class deferred renderer, and the effects multiply the art. [3]
- GPU particles everywhere: weather (snow, ash, sand), embers, smoke plumes from debris, sparks with trails. Electric shots and explosions have "significant visual impact". [3] Reviewers describe "showers of particle effects… from snow to sparks" and explosions that "spray particle effects everywhere". [4]
- Palette: "bright whites, burnt oranges, muted blues, and blacks". [3]
- Rendering stack: SSAO, dynamic cascaded shadows, TAA, per-object and camera motion blur, bokeh DOF, volumetric fog, 4K60 target. [2][3][16]
- Scale: "monolithic structures spanning entire horizons", and the environment "constantly reframes the player to understand how small they are". [4][5]
- Momentum: "the momentum of these behemoth mechs hurtling through the air". The default mech handles "with fluidity and grace". [4]
- Readability: the audio splits frequencies (UI chirps high; guns, explosions and thrusters low/mid). The HUD is small, thin and pale, and some players call it "too subtle". [6][7]

---

## 2. Global scoring anchors (all domains)

| Score | Meaning |
|---|---|
| 1 | Programmer art: primitives, default materials, flat colour, no post. |
| 3 | Game-jam: some shading, clearly placeholder shapes and effects. |
| 5 | Competent indie: coherent style, simple textures, basic bloom and fog. A few AAA elements, but they are obviously cheap on inspection. |
| 7 | AA console: convincing at a glance and in motion. Falls apart in close-ups (tiling, low detail density, generic VFX). |
| 8 | High-end AA / low AAA: survives close-ups. Only a trained eye spots cost-cutting. |
| 9 | Indistinguishable from a REF capture of the equivalent moment in a blind side-by-side. |
| 10 | Exceeds REF: a critic would pick it over REF. |

A domain can only score **≥8 if none of its "instant tells" are present**. Any single instant tell caps that domain at **6**.

---

## 3. Per-domain rubric

### 3.1 MECH MODEL (player rig and enemy rigs)

**(a) What REF does**
- **Size:** 10-12 m tall humanoid war machines. [12] Detail must be authored for that scale, e.g. ladders, handholds, 30 cm stencil text and access hatches.
- **Proportions (bipedal, mid-weight):** the chest/core block is the dominant mass (widest element, roughly 1.3-1.6 × hip width). The head is small (≈ 1/9-1/10 of total height), set low between or in front of the shoulder masses, often visor-like or recessed. Shoulders are broad with thick pauldron plates. The waist is a narrow exposed mechanical joint. Thighs are heavy with long shins, often with a reverse-angle knee plate. Feet are large flat pads (≈ 1/5 of height in length). Arms hang heavy, with forearm housings bigger than the upper arm. There are two back-mounted weapon pylons above the shoulders and a boxy main booster pack on the back with 2-4 visible nozzles.
- **Silhouette:** reads at 64 px tall. It is asymmetric thanks to weapons (rifle on one arm, blade or shield housing on the other, launcher on one shoulder). The outline is angular, trapezoidal and chamfered, never a smooth capsule. It is top-heavy.
- **Panel breakup at three frequencies:** (1) primary armour plates of 1-3 m; (2) secondary insets, panel seams, vents and louvres of 0.2-0.6 m; (3) tertiary bolts, rivets, hinges, pipes, cable runs, warning labels, serial stencils and tow points. Exposed inner frame shows at every joint: pistons and hydraulic rams at knees, ankles, hips and shoulders, plus cable bundles and actuator discs.
- **Sensor "eye":** one or more small emissive lenses or a slit that blooms, the brightest point on the silhouette. The head is often built like a camera housing.
- **Materials:** painted steel with PBR roughness variation. Edge chipping reveals bare metal on convex edges. Grime and soot collect in crevices, with heat scorch near nozzles and gun muzzles. Rust streaks run below bolts. Decals include numbers, an emblem on one shoulder, hazard chevrons and manufacturer-style stencils. Paint uses 2-4 muted colours plus one small saturated accent.
- **Motion:** the mech has weight. Landings compress the knees deeply (≈ 15-25% height drop for 0.15-0.3 s) with a dust burst. The torso leans 5-15° into acceleration and pitches back on braking. Arms and weapons lag with a spring. The head tracks the target independently. Vernier nozzles swivel. Feet are IK-planted, and the legs trail behind during boost with toes pointed down.

**(b) Scale**
- 1: capsule/box body parts.
- 3: recognizable mech with smooth untextured parts.
- 5: correct proportions, basic panel lines, one colour and no wear.
- 7: all three detail frequencies present, wear and decals, but repetitive or blurry up close.
- 9: close-up reads like REF, with dense believable mechanical logic, correct material response under dusk light and weighty animation.

**(c) Instant tells (NOT AAA)**
- Visible low-poly cylinders (< 16 segments) on pistons or barrels. Faceted silhouettes on curved parts.
- Uniform single-colour paint, no edge wear, no grime gradient, fully clean metal.
- Joints that intersect or pop, with no exposed inner frame. Limbs that are simply boxes on boxes.
- Mech stands perfectly rigid, with no idle sway, no knee compression on landing and a T-pose-like stance.
- Eye with no bloom, or everything emissive.
- Proportions like a toy or chibi (big head, short legs), or like a slim anime mecha with no mass.
- No contact shadow or AO under the feet, so the mech floats.
- Texture shimmer or aliasing on panel lines at 1080p.

### 3.2 ARENA / ENVIRONMENT

**(a) What REF does**
- **Brutalist industrial megastructure:** massive concrete complexes, steel girders and heavy machinery. Walls and towers span the horizon at 100-500 m scale, "an industrialized world without need of anything remotely superfluous". [5] It is uninhabitable-looking; no human-scale comfort props.
- **Depth layers are always present:** (1) foreground detail within 0-60 m (grating, rubble, pipes, snow and ash drifts, debris, wrecked vehicles); (2) mid-ground structures at 60-400 m (tanks, stacks, cranes, catwalks, bridges); (3) far silhouettes at 400 m-3 km dissolving into haze; (4) sky.
- **Strong atmospheric perspective:** contrast halves roughly every 300-500 m, and far objects shift to the fog/haze colour. Visibility is never uniform.
- **Weather is omnipresent:** falling snow or ash, wind-driven streaks, embers near fires. Tall smoke columns rise from burning sites, hundreds of metres high, drifting with the wind.
- **Verticality:** multi-level platforms, rooftops, bridges and pits give 3D movement a purpose (the director emphasised a "three-dimensional map structure"). [14]
- **Industrial lighting motifs:** sodium-amber floodlights, red obstruction beacons on towers, warning strobes, fire glow and molten-slag emissive.
- **Surfaces:** stained concrete with water streaks, oil and rust runs, tiled but decal-broken. Metal grating shows parallax depth. Puddles and wet areas reflect.

**(b) Scale**
- 1: flat plane with boxes.
- 3: textured ground with scattered primitive props.
- 5: coherent kit but repeated, small scale and clear visibility to the edge.
- 7: convincing megastructure silhouettes and fog, but tiling is visible and foreground density is low.
- 9: every frame has all four depth layers, believable industrial function and weathering, and horizon-scale structures.

**(c) Instant tells**
- Ground is a single tiled texture with visible repetition. No decals, no dirt variation.
- Arena edge visible as a wall or void. Sky is a flat gradient or a cube map with seams.
- No fog, or fog with a linear band. Far objects are as crisp as near ones.
- Structures are plain extruded boxes without trim, rails, pipes, windows or damage.
- Everything is the same scale class (no > 100 m structures in view).
- No particles in the air. Static lifeless scene (no smoke, flicker or moving machinery).
- Z-fighting, flickering shadows, or light leaking through geometry.

### 3.3 LIGHTING + POST-FX

**(a) What REF does**
- **Low-angle or overcast key light:** dusk, snow-overcast, or ash-darkened sun. Highlights are warm and restrained. Shadows are cool, deep but never crushed to #000. Palette: "bright whites, burnt oranges, muted blues, and blacks". [3]
- **Rendering stack:** SSAO, dynamic cascaded shadows, TAA, volumetric fog (light shafts through dust), camera and per-object motion blur during fast movement, bokeh DOF in menus and cutscenes. There are also reflections, water and "effects quality" tiers. [2][3][16]
- **Bloom is tight and selective:** only emissives, muzzle flashes, explosions and boost flames bloom. Flash events briefly relight the scene with dynamic lights on the mech, ground and walls.
- **Tone mapping and grading:** filmic, highlights roll off, slight desaturation, cool shadow / warm highlight split. Exposure is on the dark side of mid.

**(b) Scale**
- 1: unlit or ambient-only.
- 3: single directional light with hard shadows and nothing else.
- 5: shadows, fog and generic bloom, but flat mood.
- 7: moody grade and AO present, with bloom a bit too broad or flash lights missing.
- 9: cinematic, directed light; every explosion relights its surroundings; the grade is consistent with REF's "muted but imposing" look.

**(c) Instant tells**
- Flat unlit colours or ambient-only surfaces.
- No shadows under mechs, or shadow acne / peter-panning.
- Emissive with no bloom, or bloom that hazes the entire frame (glow soup).
- Blown pure-white or pure-black areas over 5% of the frame (no tone mapping).
- Saturated primary colours (pure red, green or blue) in the environment.
- Explosions that do not light anything.
- Aliased edges or crawling specular (no AA).
- Uniform brightness from foreground to horizon.

### 3.4 MOVEMENT FEEL

**(a) What REF does**, reference mid-weight build ≈ 65 t (the default-frame class). All values are [DATA] computed with the tool's formulas.

| Spec | REF value | Typical range across builds |
|---|---|---|
| Boost speed (horizontal) | **313 km/h ≈ 87 m/s** | 250-410 km/h (95 t heavy → 40 t ultralight) |
| QB speed (initial burst) | **313 km/h ≈ 87 m/s**, instant | 245-445 km/h |
| QB jet duration | **0.39 s** | 0.26-0.54 s |
| QB reload (cooldown) | **0.60 s** | 0.30-0.91 s, grows with weight over the booster's ideal weight |
| QB EN cost | **379 EN** (480 base × core efficiency 0.79) | 480-740 base, ×0.74-1.24 |
| EN capacity | **2300** | 2240-4420 |
| Consecutive QBs from full EN | **7** | 3-13 (typically 5-8) |
| Upward (flight) speed | 271 km/h ≈ 75 m/s | 200-380 km/h |
| Upward EN drain | 630 EN/s base (≈ 500 after core adj) | 405-800 EN/s |
| Assault Boost speed | **482 km/h ≈ 134 m/s** | 390-560 km/h (40-95 t) |
| AB EN drain | 377 EN/s base | 320-435 EN/s |
| Melee lunge speed | ≈ 490 km/h ≈ 137 m/s | 370-840 km/h |
| EN recharge delay (after spending) | ≈ 1.4 s | 0.45-5.5 s |
| EN redline delay (after hitting 0) | ≈ 2.1 s, then instant +400 EN "post-recovery supply" | 1.1-4.2 s |
| EN refill rate once recharging | ≈ 3000 EN/s (full bar in < 1 s) | 1500-9000+ EN/s (scales with generator surplus) |

- **Ground boost costs no EN** and can run indefinitely. [11] Horizontal air boost also has no EN cost. EN is spent by QB, upward thrust, AB and melee. [DATA]
- **QB is an instant velocity set** (0 to about 87 m/s in one frame) toward the stick direction, from any state. It is the core defensive verb: it breaks lock tracking and sidesteps missiles. One QB carries the mech ≈ 30-45 m, about 3-4 body heights.
- **Hard lock (Target Assist)** keeps the camera centred on one enemy. The developers made it the default so newcomers "experience flying and combat" first. [8]
- **Camera:** no FOV slider. The default vertical FOV is ≈ 45° (a mod "expands the FOV from 45 to 65"). [9] The mech sits in the lower-centre third, with the reticle above its shoulders.

**(a2) [ADAPTED] targets for IRONWAKE** (fixed loadout, mid-weight, all m/s)
- Mech height is **10 m**.
- **Walk** 18-24 m/s. **Ground boost** top speed **85 m/s**, reaching 90% in 0.35 s, with no EN cost. Deceleration to walk takes ≈ 0.5 s, with a slide and dust.
- **QB** sets velocity instantly to **max(105 m/s, |v|+30)** in the input direction, holds it for **0.35 s**, then eases back to boost speed (τ ≈ 0.12 s). Each QB covers **35-45 m**, costs **16-17% EN**, and has a **0.55 s** cooldown. Up to 6 chained QBs are possible from full.
  - Why QB is set higher than REF's 87 m/s: our screen-space scale is smaller, so the burst must read clearly above boost speed.
- **Jump:** a tap gives a 15-20 m apex. Holding gives upward thrust at **55-70 m/s** for **~21% EN/s**. Gravity is **32 m/s²** (heavy but snappy). Air boost glides with a slow sink of about 4-6 m/s.
- **AB:** 0.6 s wind-up (flare charge, FOV +8°), then **130 m/s** level flight with **13% EN/s** drain plus a 10% start cost. Cancel by QB or melee.
- **EN:** recharge **delay 1.3 s** after the last spend. **Redline** (hit 0): the bar goes red, QB and upward thrust are locked, then after a **2.0 s** delay +20% EN is restored instantly, then refill continues at ≈ 130% per second.
- **Camera:** vertical FOV **50°** base (+6° in boost, +10° in AB, spring 0.25 s). Distance ≈ **26-32 m** behind and **≈ 6 m** above the pelvis, so the mech fills **22-30% of frame height**. Hard-lock mode yaw-tracks the target with 0.15-0.25 s lag. Shake: QB 0.15 s at low amplitude, landing scaled by fall speed, explosions scaled by 1/distance.

**(b) Scale** (judged from video or frame sequences)
- 1: constant-speed sliding.
- 3: acceleration but a floaty or no-weight feel.
- 5: responsive, but QB reads as a slow dash with no burst.
- 7: good speed, but missing camera, FOV and VFX reinforcement.
- 9: QB snaps like REF, and speed is sold by camera, particles, audio and animation together.

**(c) Instant tells**
- QB that ramps up over more than 2 frames, or has no flare, camera kick or sound.
- The mech turns instantly with no body lean, or strafes like an FPS character.
- Speed invisible: no ground-dust trail, no passing particles, no motion blur or FOV change.
- Camera rigidly parented to the mech, or clipping through geometry.
- Landing with no compression, or gravity so floaty that jump apexes last over 1.5 s.
- Frame-rate-dependent physics.

### 3.5 WEAPONS + VFX

**(a) What REF does.** Weapon numbers are [DATA]. Projectile speeds are in the tool's km/h units, converted to m/s.
- **Assault rifle:** 105-135 damage per shot, **3.4 shots/s**, 18-round magazine, 2.2 s reload. Tracer at **≈ 550 m/s**. Ideal range **≈ 170 m**, effective **≈ 310 m**. Direct-hit multiplier vs staggered target **185%**.
- **Machine gun:** 10 shots/s. **Gatling:** 14-20 shots/s. Bullet speed ≈ 500-580 m/s.
- **Missiles:** cruise at **≈ 250 m/s** after an initial kick. Lock time **0.3-0.8 s per lock**, 4-10 locks per volley, range up to 2.5 km. Blast radius 12-36 m.
- **Bazooka / grenade:** ≈ 320-420 m/s projectiles, 15-90 m blast, 900-1650 damage.
- **Lasers:** ≈ 500-700 m/s. **Plasma:** ≈ 280-410 m/s. Charge shots take 1.6-5 s.
- **Energy blades and melee:** 750-1700 damage with a 150-270% multiplier on staggered targets.
- **Muzzle:** 1-2 frame star-shaped flash with a white-hot core, lighting the rig. Smoke puffs drift, and casings eject from ballistic guns.
- **Tracers:** stretched streaks. Length ≈ speed × 1/60 s × 2-3, so 20-30 m for rifle rounds. Hot core with a coloured falloff.
- **Missiles:** launcher doors open. Missiles have a bright motor dot, a dense grey-white smoke ribbon that lingers 2-4 s and diffuses, and curving pursuit paths. Vertical missiles arc high and dive.
- **Explosions:** built in layers: a flash (1-3 frames) → a fireball flipbook (0.3-0.6 s) → dark smoke rising (3-6 s) → sparks and debris with trails → a ground dust ring or shockwave → a scorch decal → a dynamic light pulse and distance-scaled shake.
- **Impacts:** sparks on metal, with ricochet sparks at grazing angles. Dust and chips on concrete. Energy splash glow for lasers. Hits must be legible at 300 m.
- **Stagger feedback:** the director calls stagger the hinge of weapon synergy, with one weapon building stagger and another cashing it in. [14] When a target's ACS overloads it freezes and sags for **≈ 2 s**, with electrical-arc sparks and a bright flash, and the HUD gauge turns red. [10] The gauge fully resets ≈ 3.5 s after the stagger. [OBS] Each hit adds its Impact value to the gauge, but only its Accumulative Impact (≈ 40-65%) stays; the rest bleeds away quickly. [DATA]
- **Boost VFX:** flame colour is set by generator type: **orange** (combustion), **blue** (electrical), **red** (exotic). [11]
  - **Main nozzles:** a white-hot core cone inside a coloured outer flame, faint shock diamonds and a heat-haze shimmer.
  - **Ground boost:** skating low over the ground, the rig drags a rooster-tail of dust, snow or ash. Sparks come from foot pads during hard turns.
  - **QB:** a sharp flare from the opposite-facing nozzles, a pressure ring or dust ring, and a brief streak or afterimage.
  - **AB:** a charge-up flare, a sustained long plume, speed streaks and a widened FOV.

**(b) Scale**
- 1: spheres or lines as bullets, no flash.
- 3: sprites with additive blending but no layering.
- 5: flash, tracers and explosion present but generic and short-lived.
- 7: layered and lit, but smoke is thin, particle counts are low, or sprites repeat.
- 9: every shot, impact and boost is layered, lit, persistent (smoke lingers) and physically plausible, and could be swapped into a REF capture unnoticed.

**(c) Instant tells**
- Particles rendered as flat squares or circles, or visible sprite edges, or camera-facing quads that clip into geometry without soft-particle fade.
- An explosion that is a single expanding sphere.
- No smoke persistence. Missile trails as solid lines or tubes.
- Tracers as uniform-width cylinders. No impact effects, or identical impacts on all surfaces.
- Emissive VFX without bloom. No light emitted by flashes or fire.
- Flipbooks with visible looping, or 4-frame animations.
- Boost flame as a static cone mesh with no flicker or heat haze.

### 3.6 ENEMIES

**(a) What REF does.** Enemy classes [15]:
- **Mass-produced light walkers:** about half the player's height, cheap, in squads, dying in 1-3 s under focused fire.
- **Heavy quadruped walkers** with strong melee and cannons.
- **Twin-rotor gunships.**
- **Artillery and gatling emplacements** that "shred" a mech if ignored.
- **Suicide drone swarms.**
- **Rival full-size pilot rigs:** mirror-matched, AP ≈ 9-12k, using QB, AB and missiles.
- **Giant bosses** dwarfing the player.

Enemies are designed with the same material and detail discipline as the player rig. Faction colours are consistent and muted. Every enemy has a readable emissive sensor and muzzle telegraphs, and lock and missile warnings sound. Enemy rigs strafe, QB-dodge, keep their optimal range and flank. They never stand still waiting.

**(a2) [ADAPTED] combat numbers**
- **Player AP** 10,000, **stagger stability** 1,700. In our UI, call the gauge "STAGGER" / 姿勢, never "ACS".
- **Light walker:** 1,000 AP, 5 m tall.
- **Heavy quad:** 5,000 AP, 8 m tall.
- **Gunship:** 3,000 AP.
- **Turret:** 1,500 AP.
- **Boss / rival rig:** 18,000-24,000 AP, stagger stability 2,000.
- **Staggers:** 2.0 s windows with a 1.8-2.3× damage multiplier. A boss fight takes 60-150 s with 3-5 staggers.
- **Player rifle DPS:** ≈ 360.

**(b) Scale**
- 1: primitive dummies.
- 3: static targets.
- 5: moving and shooting, but generic and low-detail.
- 7: good models, predictable AI.
- 9: enemies look like shipped assets beside the player rig and fight with REF-like evasiveness and telegraphing.

**(c) Instant tells**
- Enemies rendered at lower fidelity than the player.
- Enemies that stand still, slide without animation, or turn instantly.
- Deaths that just delete the mesh, with no explosion, wreck or debris left.
- No hit reaction.
- Unreadable threats: shots invisible until they hit, or no lock warning.

### 3.7 HUD + UI

**(a) What REF does**
- The HUD is **compact, thin-line, pale near-white and semi-transparent**, clustered around the centre, so the eye never leaves the reticle. Players even call it "too subtle". [7]
- **Centre:** a small reticle inside a larger lock-range frame. Locked targets get a bracket box with the target's AP bar and stagger gauge beside it. Missile locks appear as small markers that fill in one by one.
- **Weapon blocks:** four small blocks hug the reticle: left arm and left back on the left, right arm and right back on the right. Each has an ammo count, a reload or overheat bar and a cooldown arc. Criticism: tying cooldowns to the reticle makes them move, and one colour is used for all bars. [7]
- **Lower centre:** the AP number and bar (left of centre), then the **ACS gauge above the EN gauge**. EN turns red when depleted. [7]
- **Speed and altitude** readouts (needed for some objectives), and a **compass tape at the top**.
- **Bosses:** name plus long AP and stagger bars at top centre.
- **Other text:** radio subtitles at the bottom with a speaker tag. Objective updates are small text.
- **Style:** menus use a monochrome grey-blue palette, thin rules, condensed technical sans with small caps, and terse English labels.

**(b) Scale**
- 1: default browser fonts or DOM buttons.
- 3: custom font but boxy, opaque panels.
- 5: clean but generic "sci-fi" HUD, too big or too colourful.
- 7: REF-like layout, but static (no animated fills, flashes or alerts) or with alignment and kerning flaws.
- 9: pixel-precise, animated, minimal, readable at 720p, with Japanese sub-labels typeset correctly.

**(c) Instant tells**
- Default serif or Arial fonts.
- Thick opaque panels covering more than 12% of the screen.
- Saturated rainbow bars. Emoji. Unaligned text, or text that overflows or overlaps.
- Numbers that jitter in width (not tabular).
- No damage or alert flashes.
- Mojibake or missing JP glyphs.
- HUD elements touching the screen edge with no safe margin (< 3%).
- Visible HTML focus rings or scrollbars.

### 3.8 AUDIO

**(a) What REF does**
- "Phenomenal… readable" sound. The frequency bands are separated: UI chirps sit high, while gunfire, explosions and thrusters occupy the lows and mids. [6]
- Movement sounds change with the legs: footsteps, movement starts, jumps and boosts. [6]
- **Booster:** a roar bed with high hiss.
- **QB:** a sharp "thump-whoosh" transient.
- **Footfalls:** heavy metallic, with servo whine.
- **Guns:** sub-bass punch plus an environmental echo tail. Explosions have a delayed distant rumble.
- **Radio operator voice:** band-limited and compressed.
- **Music:** industrial-electronic and orchestral, escalating at bosses.

**(b) Scale**
- 1: silence or beeps.
- 5: stock samples, no mixing.
- 7: layered, but no spatialisation or ducking.
- 9: every action has distinct, layered, spatialised audio with a sidechain duck under explosions.

**(c) Instant tells**
- No sound on QB.
- Identical repeated gunshot sample with no pitch or volume variation.
- Clipping.
- No distance attenuation or low-pass filtering.
- Music masking alerts.

### 3.9 MISSION FLOW

**(a) What REF does**
- **Briefing:** the handler's voice plays over an **audio-visualiser** on a sortie background, sometimes with silhouette images, instead of a map flythrough.
- **Mission:** a sortie drop-in, then objective updates with radio chatter, and optional checkpoints. The climax is usually a rival rig or a giant boss.
- **Result:** "complete" or "failed", then a **results screen** with clear time, rewards, repair (damage) cost and ammo cost, and a **rank from S to D**. Time is the heaviest factor, with hidden optional criteria. [13] Retry is instant.

**(a2) IRONWAKE flow**
1. Title.
2. Briefing: audio-visualiser plus typed text, JP+EN.
3. Sortie: a drop from a carrier with a landing impact.
4. Phase 1: destroy the security walker squads and 3 artillery turrets.
5. Phase 2: destroy N objective structures (generators or cranes) while a gunship harasses.
6. Phase 3: a rival rig or heavy boss duel.
7. MISSION ACCOMPLISHED / MISSION FAILED.
8. Results: time, AP remaining, ammo used, kills, S-D rank.
9. Retry.

**(b) Scale**
- 1: no win/lose.
- 5: text popups.
- 7: complete flow with plain screens.
- 9: every transition is staged with animated UI, audio stings and camera moves.

**(c) Instant tells**
- `alert()` dialogs, page reloads, or instant cuts with no fade.
- No pause.
- A results screen that is plain text.
- Softlock after death.

---

## 4. BLIND JUDGING PROTOCOL (critics)

Default stance: **every capture is "prototype" until the pixels prove otherwise.** You are a senior art director at a AAA studio, paid to find flaws.

1. **Blind intake.** Captures arrive labelled only A/B (or #1…#n). Ignore file names, code and commit messages. If an A/B pair contains two IRONWAKE builds, judge which one is better without guessing which is newer.
2. **Pre-register the reference.** Before looking, write 3-5 lines describing a typical REF capture of the same situation (e.g. "rig mid-QB at dusk, 150 m from an enemy walker, refinery towers in haze"), using §3(a). This is your side-by-side "B".
3. **Three-pass look.**
   - **Thumbnail pass:** view at 25% size. Does the value structure read (dark foreground, lit focal point, hazy depth)? Are silhouettes legible?
   - **Full-frame pass:** 100% size. Check composition, depth layers, grading and HUD.
   - **Zoom pass:** crop the mech, one VFX element and one environment surface at 200%. Check segmentation, texture density, aliasing and particle edges.
4. **Tell sweep.** Go through every §3(c) list. Cite each hit with a region ("upper-left 1/4, tower top: 8-segment cylinder"). Any hit caps that domain at 6.
5. **Score** each visible domain 1-10 using §2 and §3(b), and give a one-line justification per score naming concrete pixels.
6. **Side-by-side verdict.**
   - Question: "Shown next to your pre-registered REF frame, would 10 strangers pick ours as the shipped AAA game?" Answer as a percentage.
   - Classify as `SHIPPING-AAA-CAPTURE` (≥ 45% pick ours) or `PROTOTYPE`.
   - Second question: "Would this pass as a store-page screenshot?" (yes/no).
7. **Motion judging.** For movement and VFX, request frame sequences (e.g. 12 frames at 1/30 s spacing across a QB, a missile volley and an explosion). Judge ramp-up frames, persistence and camera response against §3.4 and §3.5.
8. **Output.**
   - Per-domain scores and tells found.
   - The **top 3 fixes by visual impact**, each concrete and implementable (e.g. "add 3-layer explosion: flash+fireball+smoke; smoke must live ≥ 3 s").
   - The verdict.
   - **Pass gate:** every visible domain ≥ 8, zero instant tells, and the side-by-side verdict is SHIPPING-AAA-CAPTURE. Otherwise the loop continues.
9. **Anti-leniency rules.**
   - Do not grade on the curve for "browser game", "no GPU" or "SwiftShader". Judge the pixels.
   - Do not raise a score because it improved since last time.
   - Do not accept promises ("will add later").
   - A 9 requires the judge to state they could not tell it from REF.

---

## 5. IRONWAKE original setting, palette and design language

**Setting.** *Halvard Deep Foundry, Pier 7* (ハルヴァルド深層鋳造港・第7埠頭). A derelict coastal foundry and refinery port on the **Cinder Littoral**, a coast where a continental smelting industry collapsed. Slag seams still burn under the ash storm. It is dusk, the sun is a smothered orange disc behind ash, and a grey sea churns against concrete breakwaters.

Set-piece structures:
- 300 m blast furnaces and cooling towers
- rail-mounted gantry cranes 80 m tall
- ore conveyors bridging across the arena
- tank farms
- a sea wall with stacked containers
- a half-sunk bulk carrier
- molten-slag channels (emissive, rim-lit smoke)

Brutalist concrete meets rusted steel and hazard paint.

**Factions and naming (original).**
- **Player:** the independent contractor callsign **WAKE-01**, piloting the rig **"IRONWAKE" (RIG-07)**. The mech class is called a **"Rig"**, in the forms *Assault Rig* / 強襲リグ.
- **Enemy:** **Grauwerk Consolidated Security** (グラウヴェルク統合保安部), the port's corporate owner, with these units:
  - **PK-2 "Picket"** sentry walkers (5 m)
  - **BW-4 "Bulwark"** quadruped walkers (8 m)
  - **HR-9 "Heron"** twin-rotor gunship
  - **"Gnat"** drone swarms
  - **SL-60 "Anvil"** artillery emplacements
- **Stage boss:** the rival rig **"CINDERHOUND" (GC-X1)**, or the 28 m crane-walker **"FOUNDRY WARDEN"** (鋳造所の番人).
- **Handler:** the operator codename **"LEDGER"**.

**Colour script (hex).**

| Role | Values |
|---|---|
| Sky zenith → horizon | #2B2F36 → #5A5550 → glow #B0643A / #D98A4E (sun behind ash) |
| Fog near → far | #6E6660 → #8A7A6C (warm-grey ash) |
| Concrete lit / shadow / stain | #7D7870 / #4A4744 / #3A342E |
| Rust steel | #6B3A22, #8C4A26, #A2562B |
| Galvanised steel | #8E9296 |
| Sea | #1E2A2E, foam #9AA3A1 |
| Hazard paint (worn) | yellow #D8A31A + black #1A1A1A |
| Sodium lamps | #FFB347 |
| Aviation beacons | #FF3B2F |
| Slag emissive | #FF7A1A → #FFD08A core |
| Player rig paint | primary slate gunmetal #3E4449, secondary bone #C9C2B4, accent signal orange #E8641E (≤ 5% of surface), sensor eye #8FF0FF |
| Player boost flame (combustion) | core #FFF4D6 → mid #FFB04A → outer #FF6A1A → fade #7A2A10 |
| Enemy (Grauwerk) paint | oxide #5C2E24, dirty cream #BDB39A, ID stripe #D8A31A, sensor #FF2A2A |
| Kinetic tracer | #FFD27A |
| Energy weapon | core white, rim #7FD8FF |
| Missile smoke | #C8C4BE → #6D6A66 |
| HUD | primary #E6EEF0 at 85% opacity, secondary #9FB3BA, caution #FFB400, alert #FF4A3D. Background plates at most #0B0F12 at 35% opacity |
| Grade | lift shadows toward #1C2126, push highlights toward #F2C79A |

**Value budget per frame:** ~60% dark-mid (L* 15-40), ~30% mid (L* 40-65), ~10% highlights (fire, emissives, sky glow). The focal point (enemy or explosion) should be the highest local contrast.

**Design language rules for our rigs.** Our rigs are *construction and foundry machinery turned to war*. They are **not** copies of REF frames.
- Plating looks like ladle and crane machinery.
- Exposed hydraulic rams take the place of sleek covers.
- Heat-shield louvres sit over the boosters.
- Lifting eyes and tow shackles appear as greebles.
- Parts are stencilled with load ratings ("MAX 40t", 「荷重注意」).
- Cab-like head modules carry a horizontal sensor slit plus 2 small round lenses.
- Enemy walkers share the same manufacturing logic (same bolts, stencils and paint wear) but in a different paint scheme.

**Fonts.** Vendor them locally from npm, since there is no CDN:
- `@fontsource/barlow-condensed` or `@fontsource/rajdhani` for labels
- `@fontsource/share-tech-mono` for tabular numbers
- `@fontsource/noto-sans-jp` for Japanese

All are OFL-licensed.

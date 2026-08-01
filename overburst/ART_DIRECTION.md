# OVERBURST — art direction bible

The bar is **Armored Core VI: Fires of Rubicon**. Not "sci-fi mech game". *That* game.
If a choice would look at home in a clean Gundam render, a mobile gacha mech, or a
Tron-style neon world, it is wrong. Everything here is heavy, welded, dirty and
functional.

## 1. The mech

**Silhouette.** Boxy torso ("core") with a *narrow waist*, wide shoulders carrying
two hard-mounted back units, a **small head** relative to the body (head is ~1/6 the
core's width), arms that are thick rectangular assemblies ending in a hard-mounted
weapon rather than a hand, and legs that are the single heaviest element — huge
thighs, armoured shins, splayed foot plates. Read the silhouette at 100 m: it must be
unmistakably a war machine, front-heavy on the shoulders, planted on the ground.

**Construction language.**
- Armour plates are *layered*, not extruded boxes: a base frame, then bevelled plates
  floating 2–6 cm off it with visible gaps and shadow lines.
- Chamfer every hard edge. Nothing is a raw 90° cube corner.
- Joints show mechanism: exposed pistons/hydraulic rods at knee, hip, elbow and
  shoulder; ribbed rubber boots at ankles; visible axles and hex bolts.
- Greebles: vents with slats, small hatches, cable bundles, antenna, latch handles,
  step plates, warning stencils, unit numbers.
- Back: 2–4 booster nozzles with visible bell throats and heat staining, plus radiator
  fins and side thrusters at the hips and shoulder blades.
- Head: a narrow horizontal visor slit or single main optic, side sensor pods, a
  chin vent. The optic is the *only* strongly saturated colour on the frame.

**Materials.** Satin painted steel: roughness 0.35–0.65, metalness 0.7–1.0. Never
mirror-smooth, never fully rough. Add:
- Panel-line darkening in the crevices.
- Edge wear — bare metal on chamfers and plate corners.
- Vertical grime/oil streaks under vents and joints.
- Stencil decals (numbers, hazard chevrons, tiny warning blocks).
- Slight colour variance plate-to-plate; a factory repaint is never perfectly uniform.

**Palette.** Desaturated industrial: gunmetal `#6d7076`, olive `#5a5c46`, rust
`#7a4a30`, sand `#9c9282`, deep charcoal `#2c2e31`. **One** saturated accent per unit:
player = cyan `#4fd9ff`, standard hostiles = orange `#ff5a2b`, boss = violet `#d93cff`.
Accent appears only on optics, thruster cores, seam lights and a few painted stripes.

**Scale cues.** Put human-scale details on the mech (a 40 cm hatch, ladder rungs,
handrails) so it reads as ~10 m tall. The camera is far enough back that fine detail
must be carried by *shape and value*, not tiny textures.

## 2. The world

Rubicon is a burned industrial planet. The arena is a **refinery / smelting complex**:

- Brutalist concrete megastructures, rusted steel superstructure, catwalks, pipe
  runs the size of trains, cooling towers, silos, cranes, rail spurs, container
  stacks, blast walls, ventilation stacks belching smoke.
- Ground: ash-grey aggregate, cracked concrete slabs with expansion joints, painted
  road markings gone to hell, scattered rubble, puddles of slag glow.
- **Verticality is mandatory.** Multi-level platforms, ramps, gantries, a central pit
  and towers tall enough that reaching the top is a boost decision.
- **Scale contrast.** At least a few structures 8–20× the mech's height. Distant
  silhouettes half-dissolved in haze establish depth.
- Emissive: sparse but strong — furnace mouths, molten channels, warning strobes
  (slow amber blink), window strips, hazard beacons on tower tops.

**Atmosphere.** Thick. Exponential fog tinted warm-grey, layered dust hanging in the
air, drifting ash particles, smoke columns bending with wind, heat shimmer over vents.
Sky is overcast smog: a dull amber band near the horizon fading to slate grey above,
sun a diffuse bright disc behind haze. No blue skies, no clean gradients, no stars.

**Lighting.** One strong low-angle key (warm, ~3400 K) raking across the arena, a
cool sky-fill ambient, and coloured local emissives. High contrast — deep shadow with
just enough bounce to read. Rim light on the mech from the sky is what sells the
silhouette.

## 3. Motion & VFX

**Quick Boost** is the signature. Every QB must produce, in this order, within ~250 ms:
1. A hard velocity impulse (not a lerp) — the camera lags a frame behind.
2. A bright blue-white nozzle flare that spikes then decays.
3. A flat ring/disc shockwave at the origin, oriented against the boost direction.
4. 2–4 ghosted afterimages of the mech, fading over ~0.15 s.
5. Dust kicked off the ground if low, sucked into the wake.
6. A short FOV punch and a lateral camera roll of 2–4°.

**Assault boost**: sustained flame, radial speed lines, FOV widening to ~88°, mild
motion blur/streak, heat-haze trail, and a low rising engine tone.

**Weapon fire.**
- Rifle: 4-point star muzzle flash lasting 2 frames, a hot yellow-white tracer that is
  a *stretched* billboard (long, thin, bright core, dimmer sheath), a puff of smoke,
  ejected casings, and a small camera kick.
- Missiles: launch smoke from the rack, corkscrewing white smoke ribbons that persist
  ~1.2 s, exhaust glow, then orange detonation.
- Plasma cannon: a visible charge-up glow that grows in the barrel with converging
  particles, then a thick beam/bolt with a bright core and a violent muzzle blast that
  shoves the camera.
- Pulse blade: a violet-white plasma edge, a swept ribbon afterimage tracing the arc,
  a bright flash and radial sparks on contact.

**Impacts.** Every hit: a brief flash sprite at the contact point, 8–20 sparks that
arc and bounce, a grey dust puff, a small decal/scorch, and a hit-marker on the HUD.
Hits on armour spark orange-white; hits on the ground kick grey dust and chips.

**Explosions.** Three-stage, over ~1.2 s: (1) 2-frame white-hot flash + expanding
shockwave ring, (2) orange-red fireball that rises and cools to dark, (3) black smoke
column with embers and tumbling debris chunks with their own smoke trails. Explosions
must **light the environment** (a real point light with a fast falloff curve).

**Stagger / ACS failure.** The target flashes hot, its ACS bar fills white, sparks
pour from the joints, motion stalls, and a direct hit lands with a slowed 3-frame
impact freeze, a screen-wide shock ring and a heavy hit sound.

## 4. HUD

Thin-stroke, angular, information-dense, and *sparse in colour*: pale cyan `#5ff4ff`
lines and white numerics on a dark scrim, amber `#ffb020` for warnings, red `#ff3b30`
for critical. No rounded corners. No drop shadows. No gradients beyond a faint
scanline/glow. Use clipped corners (`clip-path`) and 1 px strokes.

Required elements:
- **AP bar** bottom-left: long, segmented, with the numeric value; turns amber under
  40 %, red under 20 % with a slow pulse.
- **EN bar** directly under it: fills continuously, goes red and flashes `EN OVERLOAD`
  when depleted; a small QB-reload pip strip shows quick-boost readiness.
- **Weapon panel** bottom-right: four rows (R-ARM / L-ARM / R-BACK / L-BACK) with the
  unit name, an icon block, ammo count and a reload sweep.
- **Reticle** centre: a small hexagonal/bracket reticle; on lock it snaps to a boxed
  target frame with corner ticks and a `LOCK` tag; multi-lock draws a stack of boxes.
- **Target readout** top-centre: enemy name, AP bar, and an **ACS strain gauge**
  under it that flashes `STAGGER` when full.
- **Objective panel** top-left: mission code, objective lines with `▸`/`✓` states,
  and the mission timer.
- **Radio chatter** lower-centre: one line at a time, typed in, auto-fades.
- **Warnings**: `WARNING` / `MISSILE ALERT` / `AP CRITICAL` flashing bars at screen
  edges; a red directional damage indicator arc when hit from off-screen.
- **Damage numbers** in world space, small and monospace, white for normal and amber
  for direct hits.

## 5. Post-processing

ACES tone mapping, exposure ~1.05. Bloom only on genuinely emissive things
(threshold ≈ 0.8) — the world must not glow. Add: a subtle vignette, ~0.15 %
chromatic aberration at the edges, fine film grain, a faint horizontal scan
modulation, and radial speed lines/blur that ramp with assault boost. Screen shake is
short and sharp (a decaying noise, not a sine wave), and never rotates more than ~1°.

## 6. Anti-goals

- ✗ Purple/blue "space nebula" skies, starfields, neon grids.
- ✗ Flat untextured primitives, obvious cube-stacks, unchamfered boxes.
- ✗ Uniform ambient lighting with no shadow contrast.
- ✗ Sprite explosions that are just an expanding orange circle.
- ✗ Bloom smeared over everything; a hazy "dream" look.
- ✗ Rounded, friendly, toy-like proportions.
- ✗ Rainbow HUDs, thick borders, drop shadows, emoji, decorative fonts.

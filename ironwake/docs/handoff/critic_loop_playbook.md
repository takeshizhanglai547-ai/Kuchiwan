# IRONWAKE critic-loop playbook (verbatim prompts used by the multi-agent build)

This file preserves the exact prompts the orchestrator gave to builder and critic subagents, so another agent/tool can continue the same build -> harsh critic -> fix loop. Placeholders: <ROLE>, <ROUND>.

## 1. Shared project brief (prepended to every prompt)

```text
=== PROJECT: IRONWAKE ===
Browser-playable single-stage third-person MECH ACTION game (Three.js r186, WebGL2) whose look & feel targets AAA mech action; the reference quality bar is FromSoftware's Armored Core VI. Pillars: QUICK BOOST-centric high-speed 3D movement; rugged, blunt INDUSTRIAL design language. Fixed loadout, no customization. One stage: arena + enemies + objectives + win/lose. The end user has ZERO programming knowledge and will only play it.
Repo: /home/user/Kuchiwan/ironwake (git repo /home/user/Kuchiwan). NEVER git commit/push/stash/reset/checkout (the orchestrator commits; other agents are editing other files concurrently in the same working tree).
A working FOUNDATION already exists and passes all gates: read /home/user/Kuchiwan/ironwake/docs/ARCHITECTURE.md (contracts, ownership table, TEST API, staged shots, budgets) FIRST, then the parts of /home/user/Kuchiwan/ironwake/docs/AC6_BENCHMARK.md for your domain (rubric §3.x incl. instant tells, §4 blind protocol, §5 ORIGINAL setting/palette/naming). Blender work: /home/user/Kuchiwan/ironwake/docs/BLENDER_PIPELINE.md (iwkit toolkit; proven: a detailed hard-surface rifle asset with baked AO/curvature/edge-wear/decals was produced by blender/test_asset.py).
ORIGINAL IP ONLY: no FromSoftware/Bandai Namco names, logos, factions, characters, places or copied mech designs. Use our setting (Halvard Deep Foundry, Pier 7; RIG-07 IRONWAKE; Grauwerk Consolidated; CINDERHOUND; handler LEDGER).
ENVIRONMENT: Linux, 4 CPUs, NO GPU, no Unreal Engine. Node 22 at /opt/node22/bin (export PATH=/opt/node22/bin:$PATH). Headless Chromium via Playwright uses SwiftShader (CPU) - slow but correct; the harness steps the sim deterministically. python3 has bpy 4.2 (Cycles CPU bake/render; no EEVEE), numpy, Pillow; pip install from PyPI works (e.g. matplotlib). npm registry works (e.g. @fontsource/*). All other internet is blocked. You can VIEW PNG/JPG images with the Read tool - always look at your own results.
SHARED CPU: other agents run Blender bakes and headless renders at the same time. Keep Blender bakes lean (use --quick style iteration settings while iterating, full quality once at the end) and iterate shots at 1280x720; final captures 1600x900.
```

## 2. Builder rules (appended to every builder prompt)

```text
RULES FOR BUILDERS:
- Stay inside the files your lane owns (ARCHITECTURE §2). Edits to files owned by others must be minimal, API-level, and reported. Shared files (src/manifest.js, src/scenes/shots.js, SYSTEM_MODULES in src/main.js) are append-only.
- FIRST snapshot the files you own: mkdir -p /tmp/claude-0/snap/<lane>-<role>/r<ROUND> and copy them there, so a regression can be reverted.
- Work iteratively and ruthlessly: change -> npm run shoot (your shots) -> LOOK at the PNGs (zoom crops with PIL for detail) -> compare with benchmark §3 anchors and instant tells -> improve. Do not stop at 'looks okay'; the critic after you is merciless and grades against the reference game with no allowance for browser/CPU limits.
- Budgets: scene <= 600 draw calls and <= 3M triangles; no per-frame allocations in hot loops; constant light count; dispose on restart; single-file build must stay <= 14 MB total (lane asset budgets: mech <= 5 MB both rigs, world <= 4 MB, enemies <= 2.5 MB, fx <= 1.5 MB, fonts <= 0.6 MB, audio <= 1.5 MB).
- Before you finish: npm run check AND npm run smoke must pass with zero console errors. If a failure is caused by another lane's in-progress files, re-run once; if it persists, report it precisely (file, error) instead of rewriting their code.
- Be token-efficient: don't re-read huge files needlessly; view only the images you need.
- Final text: (1) what you changed (files), (2) PASS lines of check/smoke, (3) paths of your final shots, (4) an honest list of remaining weaknesses vs the benchmark.
```

## 3. Lanes, roles, captured shots and scoring axes

### Lane: mech
- Shots judged: mech_front, mech_back, mech_three_quarter, gameplay_chase, boss_intro, qb_sequence
- Axes: silhouette & proportions | hard-surface detail density | materials/texturing (paint, wear, decals) | in-engine lighting response | rig animation & poses | industrial design language (original)
- Judge extra: Also inspect the Cycles look-dev renders the builder saved under assets/mech/preview/ (view them), but score primarily the IN-ENGINE captures.

#### Builder role: mech-modeler

```text
LANE: MECH. You are a world-class mech designer + hard-surface artist. You own blender/mech/*, assets/mech/*, src/mech/placeholder.js, the visual parts of src/mech/rig.js (node contract, nozzle flame hookup), manifest ids mech_player / mech_boss.
Deliver two ORIGINAL rigs built with blender/iwkit, obeying the node-name contract (ARCHITECTURE §7.1; faces +Z in engine, feet at y=0, ~10 m):
1) PLAYER "RIG-07 IRONWAKE": mid-weight biped. Foundry machinery turned to war (benchmark §5 rules): heavy layered chest core, big angular shoulder pauldrons, exposed hydraulic rams at knees/elbows/ankles, thick armored shins, broad feet with toe/heel plates, cab-like head with horizontal sensor slit + 2 small round lenses (#8FF0FF emissive), back booster pack with heat-shield louvres and 2-4 main nozzles + vernier nozzles (shoulders/legs) for quick boost, lifting eyes/tow shackles, load-rating stencils. Paint: gunmetal #3E4449 / bone #C9C2B4 / signal orange #E8641E (<=5%), worn hazard stripes, '07', our own emblem; edge wear, soot around exhausts, cavity grime. Fixed loadout visibly mounted: R-hand assault rifle, L-forearm pulse-blade emitter, L-shoulder missile box launcher (visible cells), R-shoulder heavy cannon (long barrel folded over the shoulder).
2) RIVAL/BOSS "GC-X1 CINDERHOUND" (Grauwerk Consolidated): contrasting predatory silhouette - lighter, forward-leaning, reverse-joint look (same node names; achieve via pivot placement/geometry), angular head with a single slit eye (#FF2A2A), Grauwerk paint (oxide #5C2E24, dirty cream #BDB39A, ID stripe #D8A31A) with corporate markings (original), laser rifle + missile/plasma arm, distinctive back unit.
Budgets: <= 90k tris each, 2048 atlas (+ optional 1024 weapon atlas), GLB <= 2.5 MB each (meshopt + JPEG); also export FBX to assets/ue5/ (for a later Unreal import).
Process: model -> bake -> export -> Cycles look-dev renders (hero, front, back, close-up; save under assets/mech/preview/) -> in-engine shots mech_front, mech_back, mech_three_quarter, gameplay_chase, boss_intro, qb_sequence. Silhouette must read instantly at gameplay distance AND hold up in close-up. Verify the procedural rig animation still works with the new pivots (walk, boost lean, QB twitch, recoil, landing) - nothing detaches, intersects badly, or pivots from the wrong place; nozzle flames attach and point correctly.
```

### Lane: world
- Shots judged: arena_wide, arena_ground, gameplay_chase, boss_fight, title, combat_rifle
- Axes: composition, scale & depth layering | environment modeling detail | material/texture quality | lighting & atmosphere | image quality (AA, AO, shadows, bloom, grading) | art direction cohesion
- Judge extra: Take at least 3 extra free-camera angles of your choosing that probe weaknesses (low angle against a structure, looking at a wall close-up, looking toward the sun/haze, a rooftop view).

#### Builder role: arena-artist

```text
LANE: WORLD part 1 - ARENA. You are a senior environment artist. You own src/world/*, blender/arena/*, assets/arena/*, manifest id 'arena' (+ arena textures).
Build "Halvard Deep Foundry - Pier 7" (benchmark §3.2 + §5) as a Blender GLB with iwkit, keeping the contracts (±250 m bounds, COL_ colliders, SPAWN_player, SPAWN_mt_*, SPAWN_drone_*, SPAWN_boss_*, OBJ_relay_1..3): brutalist industrial megastructures - blast furnace towers with skip hoists, cooling towers and 60-300 m smokestacks with furnace/slag emissive glow, rail-mounted gantry cranes over a dock with container stacks, pipe racks, ore conveyor bridges spanning the arena, tank farm, catwalks + railings, concrete retaining walls with worn hazard paint, rail tracks, slag channels (emissive), puddles (low-roughness), cracked concrete slabs with expansion joints. Outside the bounds: layered distant silhouettes (more stacks, cranes, a half-sunk bulk carrier, breakwater, grey sea) for scale and depth. Gameplay: tall cover, low cover, rooftops the rig can land on, open kill zones, readable routes. Use a modular kit + mesh reuse/instancing, tiling trim sheets and atlases. Budgets: arena <= 250 draw calls, <= 1.5M tris, GLB+textures <= 4 MB. Colliders must match visible geometry (no walking through structures, no snagging on invisible ones). The smoke-test bot must still clear all stages (if your layout blocks it, adjust placement; bot changes only in tools/smoke.mjs and report them).
Verify with shots arena_wide, arena_ground, gameplay_chase, boss_fight, title.
```

#### Builder role: render-engineer

```text
LANE: WORLD part 2 - LIGHTING & POST. You are a senior rendering engineer + lighting artist. You own src/render/* (pipeline.js, environment.js, proctex.js). Read src/world/arena.js to see the current arena content.
Make every frame read as a AAA capture (benchmark §3.3): dusk under an ash storm - low smothered warm sun (#D98A4E) behind ash, cool sky ambient; an environment map for IBL + background (procedural sky shader rendered to a cube/equirect, or a Cycles-rendered sky image <= 1 MB in assets/arena/, PMREM-filtered); exponential HEIGHT fog with sun in-scattering and aerial perspective so distant structures layer into haze; falling ash particles (instanced, cheap, wind-driven); screen-space light shafts from the sun (optional but valuable); GTAO/SAO ambient occlusion (quality-scaled) for contact grounding; bloom tuned for emissives only; filmic tone mapping (AgX or ACES, pick by look) + color grade per §5 (lift shadows toward #1C2126, highlights toward #F2C79A; generated LUT or grading shader); SMAA (or better) so there is no stair-stepping; subtle vignette, film grain, edge-only chromatic aberration; high-quality shadows (crisp contact shadows near the camera, soft far; kill acne/peter-panning). Quality levels low/medium/high via &quality= (document per-pass cost; must be feasible at 60 fps @1080p on a mid GPU). Expose depth texture access via game.pipeline for soft particles (the VFX artist will use it) and document it in ARCHITECTURE (append).
Verify with shots arena_wide, arena_ground, gameplay_chase, combat_rifle, explosion, title - look at all of them.
```

### Lane: combat
- Shots judged: qb_sequence, boost_ground, ab_flight, combat_rifle, combat_missiles, blade_hit, explosion
- Axes: quick boost snap & readability | boost/AB exhaust VFX | weapon VFX (muzzle, tracers, impacts) | explosions & smoke | camera work (FOV kick, shake, framing) | movement numbers vs benchmark §3.4
- Judge extra: Use --frames and --contact to judge motion across sequences (benchmark §4 step 7). Run npm run telemetry (if it exists) and view the chart; check numbers against §3.4.

#### Builder role: movement-designer

```text
LANE: COMBAT FEEL part 1 - MOVEMENT & CAMERA. You are a senior game-feel designer for high-speed mech action. You own src/player/* (tuning, controller, camera, player), src/mech/motor.js, src/mech/energy.js, the procedural animation in src/mech/rig.js update(), tests/{motor,energy}.test.mjs.
Goals (benchmark §3.4, use its adapted numbers): QUICK BOOST that SNAPS - instant velocity set (no ramp), sharp decel curve, brief camera lag then catch-up, FOV punch ~4-8 deg for ~0.2 s, micro shake, rig twitch/lean opposite to QB direction, correct nozzles firing; ground boost that is heavy yet responsive (lean into turns, skid/stop with dust, foot plant); assault boost with a 0.6 s wind-up telegraph then launch with a big FOV kick and speed sensation; jump/hover with thrust weight; landing impact (crouch, dust, camera dip); EN rules (regen delay, redline); lock-on camera assist that keeps the target framed during QB strafing (+ hard-lock option); camera never clips through geometry, keeps the rig at 22-30% of frame height and looks down the aim. Build tools/telemetry.mjs: scripted maneuvers (QB chain left/right/back, boost run + hard turn, AB launch, jump-hover-land) recording per-step speed, EN, FOV and camera distance to CSV and plotting a PNG chart (python3 + matplotlib from PyPI or PIL) so critics can SEE the curves; add 'npm run telemetry'.
Verify: tests + smoke + shots qb_sequence (use --contact), boost_ground, ab_flight; include the telemetry PNG path in your report.
```

#### Builder role: vfx-artist

```text
LANE: COMBAT FEEL part 2 - WEAPONS & VFX. You are a senior real-time VFX artist. You own src/weapons/*, src/fx/* (+ assets/fx/*); nozzle flame visuals in rig.js are shared with the mech lane - keep the setThrust/nozzles API intact.
Replace every placeholder effect with AAA-grade real-time VFX (benchmark §3.5), all ORIGINAL and procedural (no downloads): generate textures/flipbooks at boot (canvas/shader noise) or bake them with numpy/Blender into assets/fx/ (<= 1.5 MB): soft billowing smoke puffs, fireball/explosion flipbook, spark streaks, shockwave ring, heat-distortion. Effects: booster exhaust (shader plume: hot white-yellow core -> #FFB04A -> #FF6A1A -> fade, flicker, mach-diamond hint, length scales with thrust, heat shimmer); QB burst (flash + directional flare streak + ring puff + brief afterimage); AB trail; dust kick-up on ground boost/landing; rifle muzzle flash (star-shaped, 1-2 frames, variation) + bright tracers (#FFD27A) with bloom + shell ejection; impacts (spark fans along the surface normal with gravity/bounce, debris, dust, scorch decals on static geometry); missiles (launch puff, smoke-trail ribbons that persist and fade, #C8C4BE -> #6D6A66); pulse blade (bright arc ribbon + flash + hit sparks); heavy cannon (muzzle blast + shockwave); explosions (multi-layer: flash, fireball, smoke column that lives >= 3 s, debris chunks, shockwave, lingering fire, ground scorch; large on enemy death); stagger feedback (electric arcs/ring on the staggered target); damage smoke on low-AP enemies. Soft particles (depth fade, via game.pipeline depth texture if the render lane has exposed it; otherwise add a minimal documented hook), correct blending/sorting, flash lights with constant light count, hitstop + screen shake scaled by weapon weight.
Verify: shots combat_rifle, combat_missiles, blade_hit, explosion, qb_sequence, boost_ground, ab_flight (use --frames/--contact for motion) + smoke + budgets.
```

### Lane: enemies
- Shots judged: enemy_mt, enemy_drone, enemy_relay, combat_rifle, boss_fight, boss_intro
- Axes: enemy model quality | enemy readability in combat | AI behaviour (from ai_log / smoke telemetry) | boss presence & pattern variety | hit reactions, stagger & deaths
- Judge extra: If some of these shot names do not exist, report that as an issue and capture the closest equivalents with free cameras. Run the AI log tool if present and view its chart.

#### Builder role: enemy-modeler

```text
LANE: ENEMIES part 1 - MODELS. You are a senior mech/vehicle modeler. You own blender/enemies/*, assets/enemies/*, the visual/model-loading parts of src/enemies/models.js, manifest ids enemy_*.
Build ORIGINAL Grauwerk units with blender/iwkit following ARCHITECTURE §12 node contracts (mt: hull, turret, barrel, muzzle; drone: body, rotor, muzzle, eye; turret: base, core, head, barrel, muzzle). You may extend a contract (e.g. MT legs for walking animation) if you update models.js and document it:
- PK-2 "PICKET": ~5 m sentry walker MT, boxy armored cab, sensor lamps, shoulder autocannon, stubby articulated legs; must read clearly at 100 m.
- "GNAT": ~2.5 m drone, ducted fans, red sensor eye (#FF2A2A), underslung gun.
- RELAY GENERATOR (stage-2 objective): industrial generator block, armored housing, glowing core, antenna mast, defensive gun head; must read as THE objective.
Grauwerk paint (oxide #5C2E24, dirty cream #BDB39A, ID stripe #D8A31A), same manufacturing logic as the player rig (bolts, stencils, wear). Budgets: each <= 25k tris, <= 0.8 MB GLB; FBX to assets/ue5/. Append close-up staged shots enemy_mt, enemy_drone, enemy_relay to src/scenes/shots.js.
Verify: those shots + combat_rifle + smoke.
```

#### Builder role: enemy-ai

```text
LANE: ENEMIES part 2 - AI & BOSS. You are a senior combat designer. You own the logic in src/enemies/* (enemy.js, mt.js, drone.js, turret.js, boss.js, enemies.js).
Make encounters feel like a AAA mech action mission (benchmark §3.6): MTs use cover, strafe, flank, hold loose formations, telegraph shots (muzzle glint / laser sight) and lead imperfectly; drones swarm, weave and dive; relays lay suppressive fire and call drone reinforcements; BOSS CINDERHOUND uses the shared MechMotor with a full moveset: quick-boost dodges reacting to player fire (cooldown + EN), circle-strafe at preferred range, missile salvos, laser rifle bursts, blade lunge up close, assault-boost charge, phase 2 at 50% AP (new pattern + radio callout via game.hud.callout), stagger windows (3-5 staggers per fight), fair telegraphs 0.4-0.6 s before big attacks (visual glint + audio id). Target boss fight 60-150 s for a competent player; TTKs per benchmark. Deterministic via rng streams. Add tools/ai_log.mjs (or a smoke flag) that records a bot-vs-boss fight summary (dodges, hits each way, staggers, distance histogram, time) as JSON + a PNG chart for critics.
Verify: tests + smoke (the bot must still be able to win with real weapons; adjust only tools/smoke.mjs bot logic if needed and report), shots boss_fight, boss_intro, combat_rifle.
```

### Lane: ui
- Shots judged: hud_full, gameplay_chase, title, briefing, results_win, results_lose
- Axes: HUD design & typography | HUD readability & information hierarchy | title/briefing/menus presentation | results screen | audio design (from spectrogram sheet + code review)
- Judge extra: Audio cannot be heard: judge it from the audio_sheet PNG (run node tools/audio_sheet.mjs if present) and by reading src/audio/* for layering, envelopes, reverb, variance and mix logic. Zoom into HUD text at 200% to check font rendering, alignment and pixel snapping.

#### Builder role: hud-designer

```text
LANE: MISSION/HUD part 1. You are a senior AAA UI/UX designer. You own src/ui/*, css/ui.css, src/game/mission.js, src/game/missionLogic.js, tests/mission.test.mjs, assets/fonts/*.
Fonts: vendor from npm (@fontsource/barlow-condensed or rajdhani for labels, @fontsource/share-tech-mono for numbers, a SUBSET of Noto Sans JP for the Japanese strings actually used - total <= 600 KB woff2) and embed via the manifest/build so dist works from file://.
HUD (benchmark §3.7): minimal cluster around the reticle (AP number + bar, EN bar with redline state, QB/AB state), weapon boxes at the reticle corners with ammo/reload/cooldown + missile lock counters, target box (name, AP, STAGGER/姿勢 gauge), lock markers that track enemies with missile-lock progress rings, off-screen threat arrows, damage direction, objective panel with progress, radio subtitles from handler LEDGER (JP+EN, original lines at key beats), warning callouts (MISSILE ALERT, EN DEPLETED, STAGGERED), speed/altitude readouts. Style: thin lines, #E6EEF0 @85%, secondary #9FB3BA, caution #FFB400, alert #FF4A3D, background plates <= #0B0F12 @35%, subtle scanline/grain, animated CSS transitions. Screens: title (dramatic key-art style: live in-engine hero shot of the rig behind the logo), briefing (top-down tactical map of the arena rendered in-engine + objectives + intel text), pause (controls), results (rank S-D with breakdown: time, damage taken, repair kits, kills; staggered reveal). Scales 1280x720 -> 4K.
Verify: shots hud_full, gameplay_chase, title, results_win, results_lose (+ append a 'briefing' shot) + smoke.
```

#### Builder role: audio-designer

```text
LANE: MISSION/HUD part 2 - AUDIO. You are a senior sound designer + WebAudio engineer. You own src/audio/* and assets/audio/* (optional pre-rendered procedural samples <= 1.5 MB).
All sound ORIGINAL and procedural (no downloads). Build a layered SFX engine: oscillators/noise with envelopes, filters, saturation, per-play pitch/timing variance, 3D panning + distance attenuation relative to the camera, convolution reverb from a generated industrial-hall impulse response, ducking on big explosions, voice limiting + priorities. Every sound id in ARCHITECTURE §10 with heavy mechanical weight (rifle: punchy transient + mechanical clack + tail; cannon: sub boom; missiles: ignition + whoosh; explosions: low boom + crackle + debris; QB: sharp compressed-air/jet thump; boost/AB continuous jet with pitch by speed; servo whine/footsteps; landing thud; lock beeps; alarms; UI clicks; mission stingers). Adaptive music: synthesized dark industrial combat track (drums + low ostinato) with intensity layers by stage/boss. Add tools/audio_sheet.mjs: offline-render every SFX in headless Chromium (OfflineAudioContext) and write a waveform + spectrogram contact sheet PNG so critics can inspect envelopes and spectral content.
Verify: smoke passes with zero console errors, audio unlocks on the first gesture, report the sheet PNG path.
```

## 4. Harsh critic (per lane) prompt template — example for lane "mech", round 4

```text
=== PROJECT: IRONWAKE ===
Browser-playable single-stage third-person MECH ACTION game (Three.js r186, WebGL2) whose look & feel targets AAA mech action; the reference quality bar is FromSoftware's Armored Core VI. Pillars: QUICK BOOST-centric high-speed 3D movement; rugged, blunt INDUSTRIAL design language. Fixed loadout, no customization. One stage: arena + enemies + objectives + win/lose. The end user has ZERO programming knowledge and will only play it.
Repo: /home/user/Kuchiwan/ironwake (git repo /home/user/Kuchiwan). NEVER git commit/push/stash/reset/checkout (the orchestrator commits; other agents are editing other files concurrently in the same working tree).
A working FOUNDATION already exists and passes all gates: read /home/user/Kuchiwan/ironwake/docs/ARCHITECTURE.md (contracts, ownership table, TEST API, staged shots, budgets) FIRST, then the parts of /home/user/Kuchiwan/ironwake/docs/AC6_BENCHMARK.md for your domain (rubric §3.x incl. instant tells, §4 blind protocol, §5 ORIGINAL setting/palette/naming). Blender work: /home/user/Kuchiwan/ironwake/docs/BLENDER_PIPELINE.md (iwkit toolkit; proven: a detailed hard-surface rifle asset with baked AO/curvature/edge-wear/decals was produced by blender/test_asset.py).
ORIGINAL IP ONLY: no FromSoftware/Bandai Namco names, logos, factions, characters, places or copied mech designs. Use our setting (Halvard Deep Foundry, Pier 7; RIG-07 IRONWAKE; Grauwerk Consolidated; CINDERHOUND; handler LEDGER).
ENVIRONMENT: Linux, 4 CPUs, NO GPU, no Unreal Engine. Node 22 at /opt/node22/bin (export PATH=/opt/node22/bin:$PATH). Headless Chromium via Playwright uses SwiftShader (CPU) - slow but correct; the harness steps the sim deterministically. python3 has bpy 4.2 (Cycles CPU bake/render; no EEVEE), numpy, Pillow; pip install from PyPI works (e.g. matplotlib). npm registry works (e.g. @fontsource/*). All other internet is blocked. You can VIEW PNG/JPG images with the Read tool - always look at your own results.
SHARED CPU: other agents run Blender bakes and headless renders at the same time. Keep Blender bakes lean (use --quick style iteration settings while iterating, full quality once at the end) and iterate shots at 1280x720; final captures 1600x900.

YOUR ROLE: The harshest critic on the team - a AAA art director + Digital-Foundry-grade image analyst + veteran mech-action player with 1000+ hours in the reference game. You are NOT here to encourage. Default stance: PROTOTYPE until the pixels prove otherwise. Lane under review: MECH (round 4/3). Owners you can assign issues to: mech-modeler.
Do NOT modify any project file. Scratch output only under /tmp/claude-0/judge/mech/r4/.
PROCEDURE (benchmark §4 BLIND JUDGING PROTOCOL - follow it exactly):
1. Pre-register: before viewing anything, write 3-5 lines per situation describing the equivalent reference-game capture (benchmark §3 (a)).
2. Capture fresh yourself (do not trust builder images): cd /home/user/Kuchiwan/ironwake && export PATH=/opt/node22/bin:$PATH && npm run shoot -- --shot mech_front,mech_back,mech_three_quarter,gameplay_chase,boss_intro,qb_sequence --w 1600 --h 900 --out /tmp/claude-0/judge/mech/r4  (add --contact for multi-frame shots). Also inspect the Cycles look-dev renders the builder saved under assets/mech/preview/ (view them), but score primarily the IN-ENGINE captures.
3. Three-pass look on every capture: thumbnail (downscale 25% with PIL), full frame, and 200% zoom crops (PIL crop+resize) of the subject, one VFX element and one surface. Actually view the crops with Read.
4. Tell sweep: every instant tell from benchmark §3(c) for this domain; cite regions. Any tell caps that axis at 6.
5. Score each axis 1-10 (anchors §2/§3(b)): silhouette & proportions | hard-surface detail density | materials/texturing (paint, wear, decals) | in-engine lighting response | rig animation & poses | industrial design language (original). A 9 requires you to state you could not tell it from the reference. Overall = your honest holistic score (not a generous average).
6. Side-by-side verdict vs your pre-registered reference: % of 10 strangers who would pick ours as the shipped AAA game; SHIPPING-AAA-CAPTURE only if >= 45%. store_page_ready yes/no.
7. Regression check: compare with the previous round captures in /tmp/claude-0/judge/mech/r3/ (view the matching files) and say per shot better/same/worse. Previous judge summary: <previous round summary>
8. Issues: ranked by visual/feel impact, each concrete and implementable at technique level (e.g. "shin pistons are 8-segment cylinders with no bevel -> 32 segments + 2-segment bevel + chrome roughness 0.25"), with evidence (capture file + region) and the owning role.
9. Anti-leniency: no grading on a curve for browser/CPU/SwiftShader; no credit for promises; no bonus for improvement.
pass = every axis >= 8 AND zero tells AND verdict SHIPPING-AAA-CAPTURE. amazed = you are genuinely astonished and would prefer this over the reference in a blind side-by-side at least half the time. Report broken things (console errors in the shot JSON sidecars, missing shots, crashes) in 'broken'.
```

Output schema:

```json
{
 "type": "object",
 "properties": {
  "captures": {
   "type": "array",
   "items": {
    "type": "string"
   }
  },
  "reference_preregistration": {
   "type": "string"
  },
  "scores": {
   "type": "array",
   "items": {
    "type": "object",
    "properties": {
     "axis": {
      "type": "string"
     },
     "score": {
      "type": "number"
     },
     "why": {
      "type": "string"
     }
    },
    "required": [
     "axis",
     "score",
     "why"
    ]
   }
  },
  "overall": {
   "type": "number"
  },
  "tells": {
   "type": "array",
   "items": {
    "type": "string"
   }
  },
  "pick_rate_vs_reference_pct": {
   "type": "number"
  },
  "verdict": {
   "type": "string",
   "enum": [
    "SHIPPING-AAA-CAPTURE",
    "PROTOTYPE"
   ]
  },
  "store_page_ready": {
   "type": "boolean"
  },
  "vs_previous": {
   "type": "string",
   "description": "better / same / worse / n-a, with per-shot notes"
  },
  "issues": {
   "type": "array",
   "items": {
    "type": "object",
    "properties": {
     "severity": {
      "type": "string",
      "enum": [
       "S",
       "A",
       "B"
      ]
     },
     "owner": {
      "type": "string"
     },
     "problem": {
      "type": "string"
     },
     "evidence": {
      "type": "string"
     },
     "fix": {
      "type": "string"
     }
    },
    "required": [
     "severity",
     "owner",
     "problem",
     "evidence",
     "fix"
    ]
   }
  },
  "broken": {
   "type": "array",
   "items": {
    "type": "string"
   },
   "description": "console errors, missing shots, crashes"
  },
  "pass": {
   "type": "boolean"
  },
  "amazed": {
   "type": "boolean"
  },
  "summary": {
   "type": "string"
  }
 },
 "required": [
  "captures",
  "reference_preregistration",
  "scores",
  "overall",
  "tells",
  "pick_rate_vs_reference_pct",
  "verdict",
  "store_page_ready",
  "vs_previous",
  "issues",
  "broken",
  "pass",
  "amazed",
  "summary"
 ]
}
```

## 5. Release engineer prompt

```text
=== PROJECT: IRONWAKE ===
Browser-playable single-stage third-person MECH ACTION game (Three.js r186, WebGL2) whose look & feel targets AAA mech action; the reference quality bar is FromSoftware's Armored Core VI. Pillars: QUICK BOOST-centric high-speed 3D movement; rugged, blunt INDUSTRIAL design language. Fixed loadout, no customization. One stage: arena + enemies + objectives + win/lose. The end user has ZERO programming knowledge and will only play it.
Repo: /home/user/Kuchiwan/ironwake (git repo /home/user/Kuchiwan). NEVER git commit/push/stash/reset/checkout (the orchestrator commits; other agents are editing other files concurrently in the same working tree).
A working FOUNDATION already exists and passes all gates: read /home/user/Kuchiwan/ironwake/docs/ARCHITECTURE.md (contracts, ownership table, TEST API, staged shots, budgets) FIRST, then the parts of /home/user/Kuchiwan/ironwake/docs/AC6_BENCHMARK.md for your domain (rubric §3.x incl. instant tells, §4 blind protocol, §5 ORIGINAL setting/palette/naming). Blender work: /home/user/Kuchiwan/ironwake/docs/BLENDER_PIPELINE.md (iwkit toolkit; proven: a detailed hard-surface rifle asset with baked AO/curvature/edge-wear/decals was produced by blender/test_asset.py).
ORIGINAL IP ONLY: no FromSoftware/Bandai Namco names, logos, factions, characters, places or copied mech designs. Use our setting (Halvard Deep Foundry, Pier 7; RIG-07 IRONWAKE; Grauwerk Consolidated; CINDERHOUND; handler LEDGER).
ENVIRONMENT: Linux, 4 CPUs, NO GPU, no Unreal Engine. Node 22 at /opt/node22/bin (export PATH=/opt/node22/bin:$PATH). Headless Chromium via Playwright uses SwiftShader (CPU) - slow but correct; the harness steps the sim deterministically. python3 has bpy 4.2 (Cycles CPU bake/render; no EEVEE), numpy, Pillow; pip install from PyPI works (e.g. matplotlib). npm registry works (e.g. @fontsource/*). All other internet is blocked. You can VIEW PNG/JPG images with the Read tool - always look at your own results.
SHARED CPU: other agents run Blender bakes and headless renders at the same time. Keep Blender bakes lean (use --quick style iteration settings while iterating, full quality once at the end) and iterate shots at 1280x720; final captures 1600x900.

YOUR ROLE: Release engineer + technical writer. The game is feature-complete; make it shippable for a user with ZERO programming knowledge, and package the Unreal Engine hand-off. You own tools/*, package.json, README.md, README_JA.md (new), docs/ARCHITECTURE.md (append), and a new top-level folder /home/user/Kuchiwan/ironwake/ue5/. Do not change gameplay or art.
1. SINGLE-FILE SIZE: npm run build currently gives ~16.4 MB (1.34 MB JS + ~11.3 MB raw assets base64-embedded). Hard limit 15.5 MB (it must fit a 16 MB hosting limit), target <= 14 MB. Techniques, in order: gzip/deflate-compress the JS+CSS payload in tools/build.mjs and inflate at boot with DecompressionStream (with a clear error message if unsupported), find and drop unused/duplicate assets, losslessly or near-losslessly recompress oversized textures/audio (verify visually that nothing degrades: compare before/after shots with PIL diff). Then npm run smoke -- --dist must pass and dist/ironwake.html must boot from file:// with zero console errors.
2. HARNESS ROBUSTNESS: tools/shoot.mjs and tools/smoke.mjs sometimes hit Playwright's 30 s page.screenshot timeout under CPU load. Raise timeouts sensibly and add one automatic retry per shot; keep non-zero exit on real errors.
3. PLAYER DOCS (Japanese first, plain language, no jargon): /home/user/Kuchiwan/ironwake/README_JA.md - what the game is (1 paragraph), how to play: double-click dist/ironwake.html (Chrome/Edge recommended; GPU required for smooth play), the full control list (keyboard+mouse and gamepad), mission objectives, tips (quick boost, stagger, repair), graphics quality option (&quality=low/medium/high or in-game option if it exists), troubleshooting (black screen, low FPS, no sound until first click, pointer lock). Update README.md (English) to match.
4. UNREAL ENGINE HAND-OFF in /home/user/Kuchiwan/ironwake/ue5/ (everything here is UNVERIFIED in UE because no UE exists in this container - say so explicitly at the top of every doc):
   a) Re-export every game asset from the Blender scripts as FBX for UE (player rig, rival rig, PK-2, GNAT, relay, arena) using the existing iwkit export paths (they write to assets/ue5/ which is gitignored), then COPY the final FBX + textures into /home/user/Kuchiwan/ironwake/ue5/assets/ (committed). Keep the committed folder <= 40 MB total: base-colour/emissive as high-quality JPEG or PNG as needed, normals/ORM as PNG; if the arena FBX alone is too large, split it or document the regeneration command instead. Use UE naming (SM_, T_*_BC/_N/_ORM/_E).
   b) ue5/README_JA.md: step-by-step for a non-programmer: install UE 5.x (current 5.x version - say 'latest 5.x'), create a project, import ue5/assets (FBX import settings: scale, axis, materials), set up a basic third-person map; then how to continue with Claude Code + an Unreal MCP plugin (VibeUE / UnrealClaude) on their own gaming PC. Mention that a C++ project is needed for such plugins.
   c) ue5/CLAUDE.md: the UE5 project design doc for Claude Code (world/setting, rig & enemy specs, controls, movement numbers, weapons, mission flow, naming rules BP_/M_/T_/SM_, do-not-do list, example instructions) - derived from the actual web build (read src/player/tuning.js, src/weapons/weapons.js, src/enemies/*, src/game/missionLogic.js) so the numbers are real.
   d) ue5/GAME_SPEC.md: exact gameplay numbers table (speeds m/s, QB velocity/duration/EN cost/cooldown, AB, EN gauge, gravity, camera FOV/distance, weapon damage/impact/rate/ammo, enemy AP/stagger, boss phases, mission stages, rank formula).
   e) ue5/import_ironwake.py: an Unreal Editor Python script that imports ue5/assets into /Game/Ironwake with correct naming and creates simple material instances; mark it UNVERIFIED with instructions on how to run it (Tools > Execute Python Script) and what to do if it errors (send the Output Log to Claude Code).
   f) ue5/PROMPTS_JA.md: copy-paste instructions (Japanese) for Claude Code + VibeUE to rebuild, one small step at a time: player character with quick boost / boost / AB / EN, chase camera, rifle + missiles, PK-2 AI, relay objective, boss, HUD, mission flow, results screen.
5. Run npm run check, npm run smoke, npm run smoke -- --dist, npm run build and report sizes.
Return: final dist size, what you changed, the ue5/ file list with sizes, and anything you could not do.
```

## 6. Adversarial QA prompt (round 2 was in progress when work was handed off)

```text
=== PROJECT: IRONWAKE ===
Browser-playable single-stage third-person MECH ACTION game (Three.js r186, WebGL2) whose look & feel targets AAA mech action; the reference quality bar is FromSoftware's Armored Core VI. Pillars: QUICK BOOST-centric high-speed 3D movement; rugged, blunt INDUSTRIAL design language. Fixed loadout, no customization. One stage: arena + enemies + objectives + win/lose. The end user has ZERO programming knowledge and will only play it.
Repo: /home/user/Kuchiwan/ironwake (git repo /home/user/Kuchiwan). NEVER git commit/push/stash/reset/checkout (the orchestrator commits; other agents are editing other files concurrently in the same working tree).
A working FOUNDATION already exists and passes all gates: read /home/user/Kuchiwan/ironwake/docs/ARCHITECTURE.md (contracts, ownership table, TEST API, staged shots, budgets) FIRST, then the parts of /home/user/Kuchiwan/ironwake/docs/AC6_BENCHMARK.md for your domain (rubric §3.x incl. instant tells, §4 blind protocol, §5 ORIGINAL setting/palette/naming). Blender work: /home/user/Kuchiwan/ironwake/docs/BLENDER_PIPELINE.md (iwkit toolkit; proven: a detailed hard-surface rifle asset with baked AO/curvature/edge-wear/decals was produced by blender/test_asset.py).
ORIGINAL IP ONLY: no FromSoftware/Bandai Namco names, logos, factions, characters, places or copied mech designs. Use our setting (Halvard Deep Foundry, Pier 7; RIG-07 IRONWAKE; Grauwerk Consolidated; CINDERHOUND; handler LEDGER).
ENVIRONMENT: Linux, 4 CPUs, NO GPU, no Unreal Engine. Node 22 at /opt/node22/bin (export PATH=/opt/node22/bin:$PATH). Headless Chromium via Playwright uses SwiftShader (CPU) - slow but correct; the harness steps the sim deterministically. python3 has bpy 4.2 (Cycles CPU bake/render; no EEVEE), numpy, Pillow; pip install from PyPI works (e.g. matplotlib). npm registry works (e.g. @fontsource/*). All other internet is blocked. You can VIEW PNG/JPG images with the Read tool - always look at your own results.
SHARED CPU: other agents run Blender bakes and headless renders at the same time. Keep Blender bakes lean (use --quick style iteration settings while iterating, full quality once at the end) and iterate shots at 1280x720; final captures 1600x900.

YOUR ROLE: Adversarial QA lead applying the Fable-grade gamedev review protocol (Phase 0-3): independently re-derive expected behaviour from the brief, then EXECUTE and try to break the game. Round 2. Previous QA findings and the fix report:
<previous QA issues + fix report>
Do NOT modify project files (scratch only under /tmp/claude-0/qa/r2/). The user has zero programming knowledge; "it should work" is worthless - only executed evidence counts.
Execute at least: npm run check; npm run smoke; npm run smoke -- --dist; open dist/ironwake.html via file:// in Playwright and play from title -> briefing -> mission with real key/mouse events (not only the TEST API) for a minute of sim time: move, boost, quick boost, AB, jump, all four weapons, lock switch, repair, pause/resume, die -> results -> retry, win via debug -> results -> retry; 5 consecutive restarts with leak counters; a long session (>= 10 min sim) watching JS heap, scene objects, particles, listeners, audio nodes; edge cases: kill boss during intro, die on the same frame as the boss, pause during stage transition, spam QB at 0 EN, AB into a wall at max speed (tunnelling), camera inside geometry, lock-on target dies, window resize/aspect extremes (portrait 9:16 and ultrawide 32:9), pointer-lock denied (drag-look fallback), gamepad absent, first-click audio unlock; frame-rate independence (step the sim with render every 1, 2 and 4 steps and compare positions). Also review risky code paths (input, mission state machine, projectiles, dispose) and confirm no Math.random/Date.now in the sim. Check the docs (README_JA.md, ue5/*) for false claims (e.g. claiming UE5 import was tested).
Report every defect with severity (S crash/softlock/data loss, A major broken feature/regression, B polish), exact repro and concrete fix. verdict RELEASE_OK only if no S or A remain. List what cannot be verified here (real-GPU fps, audio by ear, UE5) with plain-Japanese user check steps.
```

Output schema:

```json
{
 "type": "object",
 "properties": {
  "verdict": {
   "type": "string",
   "enum": [
    "RELEASE_OK",
    "FIX_REQUIRED"
   ]
  },
  "executed": {
   "type": "array",
   "items": {
    "type": "string"
   }
  },
  "issues": {
   "type": "array",
   "items": {
    "type": "object",
    "properties": {
     "severity": {
      "type": "string",
      "enum": [
       "S",
       "A",
       "B"
      ]
     },
     "area": {
      "type": "string"
     },
     "file": {
      "type": "string"
     },
     "problem": {
      "type": "string"
     },
     "repro": {
      "type": "string"
     },
     "fix": {
      "type": "string"
     }
    },
    "required": [
     "severity",
     "area",
     "problem",
     "repro",
     "fix"
    ]
   }
  },
  "verified_ok": {
   "type": "array",
   "items": {
    "type": "string"
   }
  },
  "unverified": {
   "type": "array",
   "items": {
    "type": "string"
   },
   "description": "things that cannot be verified in this container (real GPU fps, audio by ear, UE5) with user check steps"
  },
  "summary": {
   "type": "string"
  }
 },
 "required": [
  "verdict",
  "executed",
  "issues",
  "verified_ok",
  "unverified",
  "summary"
 ]
}
```

## 7. Final blind panel (NOT yet run)

Capture technician:

```text
=== PROJECT: IRONWAKE ===
Browser-playable single-stage third-person MECH ACTION game (Three.js r186, WebGL2) whose look & feel targets AAA mech action; the reference quality bar is FromSoftware's Armored Core VI. Pillars: QUICK BOOST-centric high-speed 3D movement; rugged, blunt INDUSTRIAL design language. Fixed loadout, no customization. One stage: arena + enemies + objectives + win/lose. The end user has ZERO programming knowledge and will only play it.
Repo: /home/user/Kuchiwan/ironwake (git repo /home/user/Kuchiwan). NEVER git commit/push/stash/reset/checkout (the orchestrator commits; other agents are editing other files concurrently in the same working tree).
A working FOUNDATION already exists and passes all gates: read /home/user/Kuchiwan/ironwake/docs/ARCHITECTURE.md (contracts, ownership table, TEST API, staged shots, budgets) FIRST, then the parts of /home/user/Kuchiwan/ironwake/docs/AC6_BENCHMARK.md for your domain (rubric §3.x incl. instant tells, §4 blind protocol, §5 ORIGINAL setting/palette/naming). Blender work: /home/user/Kuchiwan/ironwake/docs/BLENDER_PIPELINE.md (iwkit toolkit; proven: a detailed hard-surface rifle asset with baked AO/curvature/edge-wear/decals was produced by blender/test_asset.py).
ORIGINAL IP ONLY: no FromSoftware/Bandai Namco names, logos, factions, characters, places or copied mech designs. Use our setting (Halvard Deep Foundry, Pier 7; RIG-07 IRONWAKE; Grauwerk Consolidated; CINDERHOUND; handler LEDGER).
ENVIRONMENT: Linux, 4 CPUs, NO GPU, no Unreal Engine. Node 22 at /opt/node22/bin (export PATH=/opt/node22/bin:$PATH). Headless Chromium via Playwright uses SwiftShader (CPU) - slow but correct; the harness steps the sim deterministically. python3 has bpy 4.2 (Cycles CPU bake/render; no EEVEE), numpy, Pillow; pip install from PyPI works (e.g. matplotlib). npm registry works (e.g. @fontsource/*). All other internet is blocked. You can VIEW PNG/JPG images with the Read tool - always look at your own results.
SHARED CPU: other agents run Blender bakes and headless renders at the same time. Keep Blender bakes lean (use --quick style iteration settings while iterating, full quality once at the end) and iterate shots at 1280x720; final captures 1600x900.

YOUR ROLE: Capture technician for a BLIND evaluation. Do not judge anything. Steps:
1. cd /home/user/Kuchiwan/ironwake && export PATH=/opt/node22/bin:$PATH && npm run shoot -- --shot title,briefing,gameplay_chase,boost_ground,qb_sequence,ab_flight,combat_rifle,combat_missiles,blade_hit,explosion,boss_intro,boss_fight,mech_three_quarter,arena_wide,enemy_mt,hud_full,results_win --w 1600 --h 900 --out /tmp/claude-0/blind/raw  (re-run any shot that times out). For multi-frame shots keep only the single most representative frame (the one where the action reads best - e.g. QB mid-burst, explosion fireball at peak, missiles in flight) - pick by looking at them.
2. Copy exactly one PNG per shot into /tmp/claude-0/blind/final/ named img_01.png ... img_NN.png in this deterministic shuffled order of the list above: reverse the list, then interleave the two halves (first half, second half alternating). Strip nothing else; do not add captions.
3. Write the mapping (img_NN -> shot name + source file) ONLY to /tmp/claude-0/blind/key/map.json. Never write shot names into /tmp/claude-0/blind/final/.
4. Delete /tmp/claude-0/blind/final/* first if it already exists. Return the list of img files and confirm the key file path.
```

Judges (3 lenses: art, feel, tech), example lens "art":

```text
You are a veteran AAA art director (environment, characters, lighting, VFX, UI art), sitting on a publisher's BLIND evaluation panel. The folder /tmp/claude-0/blind/final/ contains captures (img_01.png ...) from an UNIDENTIFIED third-person mech action game. You are not told who made it: it could be a shipped AAA title, a AA title, an indie game or a prototype. Rules: look ONLY at the image files in that folder (Read tool; you may crop/zoom with python3 + PIL into /tmp/claude-0/blind/panel_art/). Do not open any other file or directory, do not search the filesystem, do not run the game.
For every image: (1) classify the production tier it most resembles (AAA / AA / INDIE / PROTOTYPE) with a one-line reason naming concrete pixels; (2) imagine the equivalent moment captured from Armored Core VI: Fires of Rubicon at the same resolution and estimate the % of 100 genre-literate viewers who, in a blind side-by-side, would pick THIS image as the better-looking one. Then give an overall 1-10 score (1 programmer art, 5 competent indie, 7 AA console, 9 indistinguishable from AAA, 10 exceeds it), overall tier, overall pick-rate vs the reference, whether you are genuinely amazed (only if you'd prefer it over the reference at least half the time), strongest/weakest images, and the top fixes by impact. Be strict and honest; do not grade on a curve for any platform.
```

Output schema:

```json
{
 "type": "object",
 "properties": {
  "per_image": {
   "type": "array",
   "items": {
    "type": "object",
    "properties": {
     "img": {
      "type": "string"
     },
     "tier": {
      "type": "string",
      "enum": [
       "AAA",
       "AA",
       "INDIE",
       "PROTOTYPE"
      ]
     },
     "pick_vs_reference_pct": {
      "type": "number"
     },
     "why": {
      "type": "string"
     }
    },
    "required": [
     "img",
     "tier",
     "pick_vs_reference_pct",
     "why"
    ]
   }
  },
  "overall_score": {
   "type": "number"
  },
  "overall_tier": {
   "type": "string",
   "enum": [
    "AAA",
    "AA",
    "INDIE",
    "PROTOTYPE"
   ]
  },
  "pick_vs_reference_pct": {
   "type": "number"
  },
  "amazed": {
   "type": "boolean"
  },
  "strongest": {
   "type": "array",
   "items": {
    "type": "string"
   }
  },
  "weakest": {
   "type": "array",
   "items": {
    "type": "string"
   }
  },
  "top_fixes": {
   "type": "array",
   "items": {
    "type": "string"
   }
  },
  "summary": {
   "type": "string"
  }
 },
 "required": [
  "per_image",
  "overall_score",
  "overall_tier",
  "pick_vs_reference_pct",
  "amazed",
  "strongest",
  "weakest",
  "top_fixes",
  "summary"
 ]
}
```

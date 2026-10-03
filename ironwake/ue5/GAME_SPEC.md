# IRONWAKE — gameplay numbers for the Unreal rebuild (GAME_SPEC)

> **UNVERIFIED IN UNREAL ENGINE.** Every number below is copied from the finished web build
> (Three.js) and is the "truth" of how the game plays. Nothing here has been tried inside Unreal
> (the hand-off was prepared in a Linux container without Unreal). Unit conversions to Unreal are
> given, but tuning in Unreal will still be needed (different physics, frame timing, camera model).
>
> 日本語メモ: このファイルはウェブ版の実際の数値表です。Claude Code に「GAME_SPEC.md の数値で作って」と伝えれば、この表を参照して作業します。

Source files in the web build (re-check here when in doubt): `src/player/tuning.js` (movement, camera, aim),
`src/mech/energy.js`, `src/player/player.js`, `src/weapons/weapons.js`, `src/enemies/{ai,mt,drone,turret,boss}.js`,
`src/game/damage.js`, `src/game/missionLogic.js`, `src/game/mission.js`, `src/core/input.js`.

## 0. Units and conversion to Unreal

| Web build | Unreal | Rule |
|---|---|---|
| metre (m) | centimetre (cm, uu) | × 100 |
| m/s | cm/s | × 100 (the HUD shows km/h = m/s × 3.6) |
| gravity 32 m/s² | **Gravity Scale 3.263** on the Character Movement (UE default gravity = 9.80665 m/s²) | 32 / 9.80665 |
| +Y up, forward +Z (three.js) | Z up, forward +X | the FBX assets already arrive in Unreal's Z-up frame; models face **+Y** after import → rotate the mesh **−90° yaw** inside the Blueprint (same as the UE mannequin) |
| vertical FOV | Unreal camera **Field Of View is horizontal** | horizontal = 2·atan(tan(v/2)·16/9) at 16:9 (table in §4) |
| fixed 60 Hz simulation step | variable frame time | use Character Movement / timers, not per-frame constants |
| EN in % (0-100) | float 0-100 | — |

## 1. Player rig — RIG-07 "IRONWAKE" (callsign WAKE-01)

| Stat | Value | Unreal |
|---|---|---|
| Height (model) | 10.4 m (bounding box 7.5 m wide incl. weapons) | 1040 cm |
| Collision capsule | radius 2.6 m, height 9.6 m (feet at the bottom) | Capsule radius 260, half height 480; mesh relative Z −480 |
| Aim / lock height | 6.2 m above the feet | 620 cm |
| AP (armour points) | 10,000 | — |
| Stagger gauge (player) | max 1,700 impact; decays after 0.5 s at 42 %/s; stagger lasts 1.2 s (no actions, speed × 0.2) | — |
| Repair kits | 3; each restores 38 % of max AP (3,800); 1 s cooldown; only when AP < max | — |
| Fixed loadout | R-ARM RF-24 BRASSWORK rifle · L-ARM PB-7 EMBERLINE pulse blade · L-BACK ML-6 HAILSTORM missiles · R-BACK HC-90 SLEDGE heavy cannon | §3 |

## 2. Movement (src/player/tuning.js `MOVE`)

| Mechanic | Value | Unreal hint |
|---|---|---|
| Gravity | 32 m/s², max fall 90 m/s | Gravity Scale 3.263, terminal 9000 |
| Walk (ground boost OFF) | 20 m/s (72 km/h); approach tau 0.22 s, accel cap 60 m/s² | Max Walk Speed 2000 |
| **Ground boost** (ON by default, toggle C) | **85 m/s (306 km/h)**, 90 % in ~0.33 s (tau 0.13 s, accel cap 340 m/s²), **costs no EN**; reversal ~0.5 s | Max Walk Speed 8500 while boosting, Max Acceleration ~34000 |
| Stop (no input, ground) | v' = −v/0.4 − 25 m/s²: 85 → 20 m/s in ~0.46 s, full stop ~0.9 s (~25 m skid) | Braking Deceleration Walking ~2500 + Ground Friction tuning |
| Air control | 75 m/s, tau 0.35 s, accel 140 m/s²; no input: momentum bleeds with tau 1.6 s; glide sink ≤ 5 m/s while air-boosting | Air Control ~0.6-0.8 |
| Jump | vertical speed 32 m/s (apex ~16 m in 1.0 s), costs 3 % EN | Jump Z Velocity 3200 |
| **Hover** (hold jump in the air) | up-thrust 150 m/s², max climb 60 m/s, **21 % EN per second**; on release while rising, extra 70 m/s² down | Launch Character / custom flying mode |
| **Quick boost (QB)** | burst speed = max(**105 m/s**, current speed + 30) **set in one step** in the input direction (no input = forward); held **0.35 s**, then decays (tau 0.12 s); with no input on the ground it digs in and stops (tau 0.08 s + 70 m/s²); **17 % EN**; **cooldown 0.55 s**; ~6 chained from full EN; gravity × 0.1 during the burst; input can bend the burst 10 % | Launch Character with XY override; ~37 m jet travel, ~44 m incl. skid |
| **Assault boost (AB)** (toggle F) | wind-up **0.6 s** (horizontal speed bleeds, tau 0.5 s, gravity × 0.15) → launch at **110 m/s** → settles at **130 m/s (468 km/h)** (tau 0.35 s, accel cap 200 m/s²); heading follows the aim at 1.6 rad/s, 80 % of the aim pitch; no gravity; **10 % EN to start + 13 %/s**; momentum bleeds with tau 0.45 s after it ends | custom movement mode (Flying) |
| Landing | fall speed > 34 m/s → 0.25 s landing lag (control × 0.3) | — |
| Body turn | yaw follows the aim, exponential damping 12 /s | — |
| Blade lunge | 120 m/s toward the locked target | — |

### EN gauge (src/mech/energy.js + `MOVE.en`)

| Rule | Value |
|---|---|
| Max | 100 |
| Regen | 128 %/s on ground and in the air, after **1.3 s** without any EN use |
| Redline | hitting 0 locks every EN action for **2.0 s**, then **+20 % instantly**, normal regen continues; usable again at ≥ 20 % |
| Costs | QB 17 · jump 3 · hover 21/s · AB 10 + 13/s · ground boost 0 |

## 3. Weapons (src/weapons/weapons.js, src/enemies/ai.js)

Damage model (src/game/damage.js): every hit subtracts **damage** from AP and adds **impact** to the target's
stagger gauge. When the gauge fills, the target is **staggered** for its stagger time: it cannot act and
**direct hits deal damage × directHitMul** (default 1.85). The gauge decays after a delay; it is empty again
after a stagger. Splash damage falls off linearly from 100 % at the centre to 25 % at the edge.

### Player

| Weapon | Type | Damage | Impact | ×staggered | Fire | Projectile | Ammo | Notes |
|---|---|---|---|---|---|---|---|---|
| **RF-24 BRASSWORK** (R-arm, LMB hold) | ballistic, auto | 105 | 62 | 1.85 | every 0.294 s (3.4 /s, ~357 DPS) | 550 m/s, range 360 m, spread 0.35° | mag 18, reserve 540, reload 2.2 s | lead-aims at the lock target |
| **PB-7 EMBERLINE** (L-arm, RMB) | blade | 1,600 | 1,000 | **2.5** | wind-up 0.1 s, cooldown 2.4 s | reach 14 m, 120° arc; lunges ≤ 80 m in 0.5 s at the lock target | ∞ | hit-stop 0.09 s |
| **ML-6 HAILSTORM** (L-back, Q) | homing missiles | 220 | 160 | 1.2 | volley of **6**, 0.07 s apart, spread over ≤ **4 locked** targets | 60 → 250 m/s (accel 700), turn 4.5 rad/s, homing after 0.15 s, life 5 s; splash 10 m × 0.5 | mag 6, total 120, reload 4.2 s | lock: target inside the FCS cone for 0.5 s |
| **HC-90 SLEDGE** (R-back, E) | arcing shell | 1,400 | 1,500 | 1.6 | one shot | 360 m/s, gravity 12 m/s², life 4 s; splash 18 m × 1.0 | mag 1, total 24, reload 4.6 s | recoil 1.2, hit-stop 0.07 s, FOV kick 3° |

### Enemies

| Weapon (user) | Damage | Impact | Burst | Projectile | Tell before firing |
|---|---|---|---|---|---|
| PK-2 AUTOCANNON (Picket) | 70 | 40 | 5 rounds × 0.12 s, every 2.6 s | 600 m/s, range 380 m, spread 1.0°; the burst **brackets** the predicted point | red laser sight 0.6 s + glint 0.16 s before |
| GNAT PULSE (drone) | 34 | 16 | 6 × 0.085 s, every 2.0 s | 190 m/s energy, range 300 m, spread 0.9° | cyan laser sight 0.5 s + glint |
| RELAY DEFENSE GUN (relay) | 80 | 50 | 6 × 0.1 s, every 3.0 s | 420 m/s, range 340 m | red sight 0.55 s + glint |
| RELAY SUPPRESSOR (relay) | 45 | 28 | 14 × 0.075 s, every 4.2 s (+ a sweep every 7-11 s) | 420 m/s, range 360 m, spread 2.2°, walks 34 m across the path | red sight 0.5 s |
| LR-3 SCORCHLINE laser rifle (boss R) | 175 | 85 | 3 × 0.11 s, every 0.9 s | 640 m/s energy, range 460 m, ×1.5 vs staggered | small glint 0.22 s |
| SM-4 EMBERLINE shoulder missiles (boss) | 240 | 150 | 2 salvos of 4 (left pod, right pod 0.4 s later, ±25° fan) | 70 → 215 m/s, turn 3.9 rad/s, splash 6.5 m, reload 6 s | glint + beeps 0.7 s |
| VM-8 CINDERFALL vertical barrage (boss, phase 2) | 170 | 140 | 8 cells, 0.06 s apart | 45 → 200 m/s, turn 3.4 rad/s, homing after 0.45 s, splash 7 m | glint + alarm 0.7 s |
| Boss blade | 1,400 | 900 | — | reach 13 m, 110° arc, lunge ≤ 70 m in 0.55 s, cooldown 5.5 s | arm drawn back + glint + hum 0.55 s (only within 42 m) |

## 4. Camera, aim and lock-on (`CAMERA`, `AIM`)

| Item | Value | Unreal |
|---|---|---|
| Base FOV | **50° vertical** | **79.3° horizontal** (16:9) |
| Ground boost | +6° → 56° v | 86.8° h |
| Assault boost flight | +10° → 60° v; launch peak 63° v | 91.5° / 94.9° h |
| Fast climb / drop | +3° | — |
| FOV spring | 0.25 s | interp speed ~4 |
| Orbit point | 11.6 m above the feet (~0.9 m over the head) | Spring Arm at Z +680 from the capsule centre |
| Distance | 36.8 m behind the orbit point (~37.6 m to the rig centre); rig fills 22-30 % of frame height | Target Arm Length 3680 |
| Shoulder offset | 2.2 m to the right; +0.4 m up | Socket Offset Y 220, Z 40 |
| Pitch limits | −1.2 … +1.25 rad | −69° … +72° |
| Follow lag | critically damped per axis: side 30, forward 40, up 16 rad/s; max 9 m (4.5 m up) | Camera Lag Speed ~8-10, Max Distance 900 |
| QB feedback | FOV +5° (hold 0.06 s, ease 0.45 s), 0.012 rad jolt over 0.15 s (16 Hz), camera kicked 0.4 m opposite the burst, 0.02 rad roll | camera shake asset + FOV curve |
| AB feedback | wind-up FOV −3° and 2.5 m closer; flight 6.5 m closer, 1.2 m higher; launch FOV +3° | — |
| Landing dip | 0.045 m per m/s of impact, max 1.8 m | — |
| Occluders | camera first slides ≤ 4 m sideways / 2.5 m up to clear thin props; else a clean cut-out around the rig | Spring Arm collision probe + custom |
| Mouse | 0.0022 rad per pixel; pad 3.2 rad/s; arrow keys 2.2 rad/s | — |
| FCS (lock-on) | range **360 m**, cone **26°** half-angle around the aim; Tab / MMB / pad Y cycles targets | — |
| Soft assist (default) | within 12° of the reticle: aim carried by 90 % of the target's angular velocity + pull 3 /s (cap 1.6 rad/s) | — |
| Target assist (V / R3) | camera tracks the target with a critically damped spring (10 rad/s, ~0.2 s lag), mouse nudges ≤ 6°, keeps tracking to 480 m | — |
| Missile lock | 0.5 s inside the cone per target, max 4 | — |

## 5. Enemies

| Unit | Size / hit volume | AP | Stagger gauge (max · time · decay) | Movement | Behaviour |
|---|---|---|---|---|---|
| **PK-2 "PICKET"** sentry walker (model `SM_enemy_mt`) | 5.75 m tall; collision r 2.3 m × 5 m (hit r 2.4 × 6) | 1,000 | 500 · 2.0 s · 30 %/s | walk 9.5 m/s, skate 24 m/s (repositions > 40 m), turret 2.4 rad/s | squad roles: anchors hold 75-115 m, flankers swing 75-120° around at 60-95 m, one rusher at 38-65 m; alerts at 230 m (squad within 160 m); takes cover when hurt (< 60 % AP, 35 %), peeks to fire; **evades** (75 %) with a 0.5 s skate at 24 m/s when you commit a cannon shot / missile lock; at most **2** Pickets telegraphing / firing at once (attack tokens; also GNAT 2, relays 2, 1 diving GNAT); secondary blast 0.55 s after death |
| **GNAT** drone (`SM_enemy_drone`) | 1.3 m; hit r 1.5 m | 450 | 240 · 1.2 s · 40 %/s | 30 m/s, orbits at 55-100 m, altitude 18-40 m, weaves | fires 6-round bursts from the orbit; **dives** every 3.5-6 s (0.45 s nose-over tell, 48 m/s, fires inside 85 m, pulls up) |
| **Relay generator** (`SM_enemy_relay`, stage-2 objective) | 17.4 m tall; r 5.8 m × 13 m | 1,500 | 1,200 · 2.0 s · 25 %/s | static; gun head turns 1.6 rad/s | wakes at 300 m; aimed bursts + a suppressive sweep every 7-11 s; **calls 2 drones** after 9-14 s of combat (twice as fast below 70 % AP), every 24 s, at most 2 calls, drone cap 7 |
| **GC-X1 "CINDERHOUND"** rival rig (`SM_mech_boss`) | 10.6 m; same capsule as the player | **24,000** | **2,000** · 2.0 s · decay 16 %/s after 0.8 s; **poise**: impact × 0.25 right after a stagger, back to × 1 over 20 s; phase 2 impact × 0.8 | own motor: boost 72 m/s, QB 96 m/s (15 % EN, 0.6 s cd), AB 118 m/s, jump 28 m/s, hover climb 30 m/s, EN regen 95 %/s. **Phase 2**: boost 80, QB 106 (0.46 s cd), AB 128, EN regen 110 | see §5.1 |

Boss armour (damage multiplier by weapon type; impact is NOT reduced): kinetic × 0.52 · energy × 0.54 ·
explosive (missiles, cannon) × **0.41** · blade × 0.54.

### 5.1 Boss brain (src/enemies/boss.js `BOSS_AI`)

| Layer | Phase 1 (AP > 50 %) | Phase 2 "limiter release" (AP ≤ 50 %) |
|---|---|---|
| Preferred range | 45-85 m | 25-60 m (stronger pull back into the band) |
| Strafe | circle-strafe with ground boost, flips every 1.7-3.3 s (70 % with a QB), jinks every 0.3-0.65 s, rhythm QBs every 0.75-1.5 s, jumps every 7-12 s | flips 1.4-2.8 s (80 % QB), rhythm 0.65-1.3 s, jumps 5-9 s |
| Reactive dodges (chance) | cannon 80 %, missiles 80 %, blade 75 %, sustained rifle 55 %; 0.9 s dodge cooldown; keeps ≥ 24 % EN | 85 / 88 / 80 / 60 %; 0.75 s cooldown |
| Attack weights | rifle 4.2 · missiles 2.4 · blade 2.2 · charge 2.2 | rifle 3.4 · missiles 0.9 · blade 2.6 · charge 2.2 · **barrage 2.2 · flank 2 · plunge 3.2** |
| Cooldowns | missiles 6.5 s, blade 5 s, charge 8 s | missiles 6, blade 3.8, charge 7, barrage 9, flank 7, plunge 9 |
| Telegraph (tell → hurt) | rifle 0.22 s · missiles 0.7 · barrage 0.7 · blade 0.55 · charge 0.8 · plunge 0.6 · AB→blade 0.5 — every big tell = glint + rising warning beeps (pitch 0.85 → 1.7, every 0.14 s) |
| Punish window | committed recovery 0.3-0.55 s after an attack, 0.55 s after a blade slash |

Attacks: **rifle** bursts; **missiles** (two-pod salvo, released early when you just spent a QB);
**blade** (rushes inside 42 m, then the 0.55 s tell, lunge + slash); **charge** (assault boost at you with strafing
fire, may chain into the blade); **barrage** (P2, 8 vertical cells from a hover); **plunge** (P2: climbs 24-32 m,
hangs + tells 0.6 s, assault-boosts down, air blade, 18 m landing shockwave); **flank** (P2: chained QBs around you,
burst from the side); **cover** (breaks line of sight after heavy burst damage).
Intro: drops in from **80 m** at 26 m/s, brakes at 30 m, invulnerable until it lands, picks the candidate spawn
`SPAWN_boss_n` closest to 100 m from the player with line of sight.

## 6. Mission flow (src/game/missionLogic.js, src/game/mission.js)

| Step | Content |
|---|---|
| Title → Briefing → LAUNCH | briefing: LEDGER intel, map, objectives, threats, loadout |
| **Phase 1 "DESTROY THE PICKET SQUAD"** | 5 × PK-2 at `SPAWN_mt_1..5` + 2 GNAT at `SPAWN_drone_1..2`; radio at 3 kills |
| (transition 1.0 s) **Phase 2 "DESTROY RELAY GENERATORS"** | 3 relays at `OBJ_relay_1..3` + GNATs at `SPAWN_drone_3..5` (+ relay reinforcement calls) |
| (warning "RIVAL RIG INBOUND" + alarm, 2.5 s) **Phase 3 "DESTROY RIVAL RIG CINDERHOUND"** | boss intro drop; radio at 50 % boss AP and at its first stagger |
| **MISSION COMPLETE** | → results 3.2 s later |
| **MISSION FAILED** | player AP 0 ("destroyed") or **15:00** time limit ("timeout") → results 3.2 s later |
| Results | rank, score, time, damage taken, kits used, kills, payout; RETRY / RETURN TO TITLE |

**Rank** (`computeRank`, par time 300 s, player max AP 10,000):

```
timeScore   = 40 × (1 − clamp((time − 300) / 600, 0, 1))        # full at ≤ 5:00, 0 at 15:00
damageScore = 40 × (1 − clamp(damageTaken / (1.5 × 10000), 0, 1))
kitScore    = max(0, 20 − 7 × kitsUsed)
score       = round(timeScore + damageScore + kitScore)          # 0..100
rank        = S ≥ 85, A ≥ 70, B ≥ 55, C ≥ 40, else D            # failed mission: rank "-", score 0
```

**Payout** (`computePayout`): reward 480,000 CR on completion − repair 12 CR per AP of damage − ammo
(rifle 45 CR/round, missile 380, cannon shell 2,600).

## 7. Arena (Halvard Deep Foundry, Pier 7)

- Playable pier deck 500 m × 500 m centred on the origin (walls at ±250 m), altitude ceiling 160 m; lower foundry
  yard 9 m below the deck, sea level −14 m. Outside the deck the web build adds a runtime terrain ring and
  far districts (0.5-2.8 km).
- Player start `SPAWN_player` at game (0, 0.4, −205) facing north (toward the sea) = Unreal (0, −20500, 40) cm facing +Y.
- Sun: low dusk key light, azimuth −68° / elevation 13° relative to the mission's forward direction (ahead-right of
  the player), warm #FFB347-ish; fog warm grey #6E6660 → #8A7A6C, storm side slate #4E555C.
- Markers in `ue5/assets/Arena/arena_layout.json`: `SPAWN_player`, `SPAWN_mt_1..5`, `SPAWN_drone_1..5`,
  `SPAWN_boss_1..6`, `OBJ_relay_1..3`, 172 `FX_*` (smoke plumes / light pools), 578 collider boxes (`size_cm`).

## 8. Model sockets (where to attach muzzles, thrusters, eye glow)

Positions in **cm, in the static mesh as imported** (model faces +Y, right side is −X, feet at Z 0). Inside a
Character Blueprint with the mesh rotated −90° yaw, +Y becomes forward (+X).

| Node | Player `SM_mech_player` | Boss `SM_mech_boss` |
|---|---|---|
| pelvis | (0, −5, 530) | (0, −30, 545) |
| torso | (0, −20, 618) | (0, −25, 630) |
| head / eye | (0, 98, 880) / (0, 142, 886) | (0, 162, 836) / (0, 308, 850) |
| muzzle_R (rifle) | (−260, 645, 502) | (−210, 735, 620) |
| muzzle_L (blade emitter) | (328, 291, 577) | (212, 432, 614) |
| muzzle_LB (missiles) | (140, 110, 960) | (95, 56, 920) |
| muzzle_RB (cannon / barrage) | (−190, 269, 901) | (−105, −56, 972) |
| booster_back / _L / _R | (0, −160, 755) / (162, −175, 705) / (−162, −175, 705) | (0, −80, 750) / (128, −95, 695) / (−128, −95, 695) |
| thrusters (`nozzle_*`) | 12: back, L, R, shoulders, legs, front (exhaust = node −Z in glTF) | 10 |

Enemies: Picket `muzzle` (−200, 322, 372), turret pivot (0, 0, 270), eye (0, 146, 345) · GNAT `muzzle` (0, 120, −37),
rotors at (±80, −2, 6), eye (0, 88, 0) · Relay `muzzle` (0, 632, 1137), head pivot (0, 0, 1025), core (0, 0, 810).
The FBX keeps the full joint hierarchy (`root > pelvis > thigh/shin/foot, torso > head, arm > forearm > hand >
weapon > muzzle, shoulder_L/R, booster_*`, plus `nozzle_*`). `import_ironwake.py` imports each model as ONE static
mesh (easy, but not animatable). For procedural animation like the web build's `src/mech/rig.js` (leg gait, torso
twist, recoil, boost poses), re-import with `RIG_COMBINE_MESHES = False` (one mesh per part) or as a rigid skeletal
mesh (each joint becomes a bone): untested, ask Claude Code to try both and keep what works.

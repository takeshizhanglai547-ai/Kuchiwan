# ASHVEIL / 灰帷 — Vertical Slice Design Document

**Genre**: Dark-fantasy 3D action RPG (soulslike)
**Scope**: 15–30 min vertical slice. Not an open world.
**Quality benchmark**: AAA action RPG feel. Original IP — no copied names, characters, geometry, music or UI.
**Platform**: Desktop browser (WebGL2 / Three.js r160, vendored — no CDN, no network at runtime).
**Perf DoD**: 1080p @ 60fps on a mid-range discrete GPU; graceful degradation via quality tiers.

---

## 1. Game Pillars

| # | Pillar | Concrete rule it imposes |
|---|--------|--------------------------|
| P1 | **Every swing has weight** | Attacks have anticipation → commit → recovery. No free cancels: light attacks may only cancel into the *next* light after the active frames, and into roll after `cancelFrom`. Stamina gates everything. |
| P2 | **Enemies are read, not shredded** | Every enemy attack has a telegraph pose ≥ 0.35s, a distinct silhouette during wind-up, and a punish window ≥ 0.45s after whiffing. |
| P3 | **A world worth exploring** | No single corridor. Minimum 2 routes to the boss; every 30–60s: a discovery, a decision, a fight, or a vista. Quiet stretches are intentional. |
| P4 | **The world tells the story** | Zero cutscenes, zero lore dumps. Meaning is carried by ruins, corpses, altars, ash-drifts, and enemy placement. |
| P5 | **The boss is the summit** | One bespoke boss: unique silhouette, unique moveset, delayed attacks, phase transition that changes the *rules*, not just the numbers. |

**Priority order when two goals conflict** (from the brief):
game runs → combat feel → camera → enemy combat → boss → level design → animation → environment → VFX → UI → polish.

---

## 2. Art Direction — one culture, one rulebook

**Setting**: *Ashveil* (灰帷), a cliff-side stone kingdom that mined **ember-glass** (燼硝子) from the body of a buried titan. The titan's ash killed the kingdom in a single night. The kilns never went out.

Every asset in the slice obeys these rules:

| Domain | Rule |
|---|---|
| **Architecture** | Basalt megaliths, corbelled (stepped) arches — never true domes or true round arches. Heavy lintels, squat proportions, 1:1.6 block ratios. |
| **Motif** | The *cinder-eye*: a vertical slit oval. Appears on shields, banners, keystones, the boss's kiln door. |
| **Palette** | Ash grey-violet stone `#4a4550`, cold sky `#1b2028`, ember orange `#ff6a1e` (the ONLY saturated hue), bone `#c9bda6`, blackened iron `#22242a`. Ember is used as an information channel: **orange = heat, danger, or interactivity**. |
| **Light** | One warm key from the caldera (low, raking), cold teal skylight, ember point lights on interactive/dangerous things. Volumetric-feel via layered fog + ash particles. |
| **Materials** | Rough stone (roughness 0.85), blackened iron (metal 0.9 / rough 0.45), ember-glass (emissive, thin). No shiny plastic, no pure white, no pure black. |
| **Costume** | Blackened plate over ash-cloth wraps; everyone in this world covers their mouth against ash. Player included — this reads at silhouette distance. |

**Naming**: Ashveil, the Kilnspire, the Cistern, Ember Pillar (checkpoint), Ash-bound (enemies), **VOLGA, THE KILNWARDEN** (boss).

---

## 3. Gameplay Architecture

```
main.js                 boot, fixed-step loop, quality tiers, pause/death/victory states
 ├─ core/input.js       keyboard+mouse+gamepad+touch → action buffer (120ms input buffer)
 ├─ core/camera.js      3rd-person spring arm, collision, lock-on, boss framing, shake
 ├─ core/fx.js          [Agent H] pooled particles, weapon trails, hitstop, decals
 ├─ core/audio.js       [Agent K] fully synthesized WebAudio — no sampled/copyrighted audio
 ├─ ui/hud.js           [Agent J] DOM HUD: hp/stamina/flask/lock-on/boss bar/prompts/screens
 ├─ world/materials.js  shared palette + material library (single source of colour truth)
 ├─ world/level.js      geometry, collision volumes, landmarks, props, triggers, shortcuts
 ├─ actors/rig.js       procedural humanoid/creature rig + pose interpolation
 ├─ actors/anim.js      clip library (anticipation / active / follow-through / recovery)
 ├─ actors/player.js    locomotion + attack state machine + stamina + i-frames
 ├─ actors/enemy.js     3 archetypes, shared AI brain w/ per-archetype behaviour tables
 ├─ actors/boss.js      VOLGA — moveset, combo tree, phase logic
 ├─ game/combat.js      capsule/OBB hit resolution, poise, stagger, backstab, parry, damage
 └─ game/director.js    checkpoints, respawn, enemy reset, progression, run completion
```

**Frame contract**: fixed 60Hz simulation with accumulator; render interpolated. Hitboxes are resolved in simulation steps so hit detection never depends on framerate.

### Combat state machine (player)
`idle/locomotion → attack(N) → [cancelFrom] → attack(N+1) | roll | guard`
Each attack clip declares: `anticipation`, `active[start,end]`, `recovery`, `cancelFrom`, `staminaCost`, `damage`, `poiseDamage`, `motion` (root-motion curve).

### Damage model
`damage = base * weaponScale * (1 + emberShards*0.15) * angleBonus`
- backstab ×2.4, riposte (post-parry) ×3.0, guard-counter ×1.6, jump attack ×1.35
- **Poise**: actors have a poise pool that regenerates; when depleted → stagger (long punish window). This is what makes heavy attacks meaningful against light enemies and makes light spam fail against armoured ones.

---

## 4. Content Spec

### 4.1 Player
Ash-cloaked knight, longsword + kite shield with cinder-eye.
- Light attack (3-hit combo, 3rd is a committed lunge)
- Heavy attack (chargeable → guard-break)
- Roll with i-frames (12 of 34 frames), directional, stamina-gated
- Sprint, guard (chip + stability), **parry** → riposte, **guard counter**, **backstab**, jump attack
- Stamina, 3 flasks (heal has a 0.75s vulnerable commit — healing is a *decision*)
- Lock-on with target cycling

### 4.2 Enemies (3 archetypes — each demands a different answer)

| Enemy | Threat | The lesson it teaches |
|---|---|---|
| **Ash Thrall** (灰兵) | Fast 2-hit combo, low poise, dies to anything | Timing of the roll; basic punish window |
| **Iron Vigil** (鉄面) | Shield-front (blocks frontal light attacks), huge delayed overhead, high poise | You cannot brute-force. Circle, bait the overhead, punish the recovery — or guard-break with charged heavy |
| **Cinder-Caster** (燼撒き) | Ranged ember bolts, retreats when closed on | Distance management; forces disengagement from melee, punishes tunnel vision |

Group rule: **only one enemy may hold the "aggressor" token at a time.** Others circle at spacing radius and telegraph before taking the token. This is the single most important AI rule in the slice.

### 4.3 Boss — VOLGA, THE KILNWARDEN (炉番ヴォルガ)
A kiln-priest fused to its own furnace: a hunched giant, a burning kiln door set into its chest, a long iron rake as a weapon. Silhouette reads instantly: asymmetric — one massive rake arm, one shrivelled arm, chest glowing.

**Phase 1 — sealed kiln.** Rake sweeps, an overhead slam, a *delayed* diagonal (the signature bait), a gap-closing drag-step, and an ember-lance that specifically punishes drinking a flask.
**Phase transition** — the kiln door bursts; the arena floor's ember veins light up. Both a spectacle beat and a rules change.
**Phase 2 — rules change (not just bigger numbers):**
1. **Ember veins erupt** along telegraphed floor lines — the arena itself now has geometry you must respect; standing still is punished.
2. **Guard no longer fully blocks** heat attacks (chip damage through guard) — the defensive answer shifts from guard to spacing/rolling.

Each attack has a documented reason it is dodgeable — see `BOSS_MOVESET.md` (per-move telegraph, active window, and punish window).

### 4.4 Level flow (target timings)
```
00:00  Cliff ledge. HERO SHOT: foreground broken arch / mid ruined plaza & stair /
       background the Kilnspire against caldera glow. The Kilnspire is reachable.
02:00  First Ash Thrall — combat taught by encounter design, not by a text wall.
04:00  Ember Pillar checkpoint #1.
05:00  ROUTE SPLIT — high ramparts (risk, Ember Shard +ATK) / low cistern mouth (safer)
08:00  Iron Vigil guarding the Cistern gate.
10:00  Ember Pillar checkpoint #2.
12:00  THE CISTERN (small dungeon): dark, vertical, Cinder-Casters on ledges,
       Vessel Fragment (+1 flask) rewards exploration.
18:00  SHORTCUT: raise the counterweight gate → opens straight back to the plaza.
20:00  Kiln Court — boss fog gate.
20–30  VOLGA.
Clear  Reward + a vista revealing the world continues beyond.
```

**Progression (the "I got stronger" beat)**: Ember Shard (+15% dmg, on the risky high route), Vessel Fragment (+1 flask, deep in the Cistern), Ashplate (+HP, behind the Iron Vigil). All three are optional — that is what makes finding them feel like a choice with a payoff.

---

## 5. Explicitly OUT of scope
Open world · dozens of weapons · crafting · multiplayer/PvP · quest system · NPC roster · voice acting · long narrative · magic school · mounts · online/live-service/monetisation. Dummy UI only where a system is implied but not built.

---

## 6. Agent split (parallel, disjoint file ownership)

| Agent | Owns (exclusive write) |
|---|---|
| Director (main session) | `main.js`, `core/input.js`, `core/camera.js`, `world/*`, `actors/*`, `game/*` |
| H — VFX | `core/fx.js` |
| K — Audio | `core/audio.js` |
| J — UI/UX | `ui/hud.js`, `ui/hud.css` |
| Critics A–E | write nothing — they receive only build + screenshots + FPS |

No two agents write the same file. Interfaces are frozen contracts (§7).

---

## 7. Frozen interfaces

```js
// core/fx.js
fx.init(THREE, scene)
fx.hit(pos, normal, {heavy, parry, guard})   // sparks + impact
fx.dust(pos, amount) · fx.ember(pos, amount) · fx.blood(pos, dir)   // "blood" = ash burst
fx.trail(boneMatrix, on)                      // weapon trail on/off
fx.hitstop(seconds) · fx.shake(amount, seconds)
fx.ring(pos, radius, color) · fx.slam(pos) · fx.phaseBurst(pos)
fx.update(dt, camera) · fx.timeScale()        // hitstop multiplier consumed by main loop

// core/audio.js  — everything synthesized, zero external files
audio.init() // must be called from a user gesture
audio.play(name, {pos, pitch, vol})
// names: step_stone, step_ash, cloth, armor, swing_light, swing_heavy, hit_flesh,
//        hit_shield, parry, guard, roll, drink, death, enemy_alert, enemy_swing,
//        boss_roar, boss_slam, ember, gate, pickup, checkpoint, victory
audio.music(state)  // 'ambient' | 'combat' | 'boss1' | 'boss2' | 'victory' | 'silence'
audio.listener(pos, forward)

// ui/hud.js
hud.init(root)
hud.setPlayer({hp,maxHp,stamina,maxStamina,flasks,maxFlasks})
hud.setTarget({name,hp,maxHp} | null)
hud.setBoss({name,hp,maxHp,phase} | null)
hud.setLockOn(screenX, screenY | null)
hud.prompt(text | null) · hud.toast(text) · hud.itemGet(title, subtitle)
hud.screen('none'|'death'|'victory'|'title') · hud.setFps(n) · hud.damageFlash()
```

---

## 8. Milestones & Definition of Done

| M | Milestone | Done when |
|---|---|---|
| M0 | Engine boots | Renders, 60fps, fixed-step loop, quality tiers |
| M1 | **Combat feel** | Player moves/attacks/rolls/guards with hitstop, trail, shake, sound. Feels weighty in a blind test. |
| M2 | Camera | Lock-on, collision, no fighting the camera vs. the boss |
| M3 | Enemies | 3 archetypes, aggressor token, readable telegraphs |
| M4 | Boss | Full moveset + phase 2 rules change |
| M5 | Level | Hero shot, 2 routes, dungeon, shortcut, checkpoints |
| M6 | Loop | Death/respawn/enemy reset/victory/reward — completable start to finish without dev help |
| M7 | Polish | Blind-review rounds until ADMIRE or circuit breaker at round 5 |

**DoD (the slice is "done")**: a player explores → fights → finds an item → opens a shortcut → clears the dungeon → reaches the boss → beats it → gets a reward, **with no developer intervention**, at 60fps, with every PASSed element still passing (§ Regression Checklist in `REVIEW_LOG.md`).

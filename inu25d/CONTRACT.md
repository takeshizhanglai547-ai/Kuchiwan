# もふもふ聖犬士イッヌ — 2.5D remake: module contract

This file is the single source of truth that every module author codes against.
If something you need is missing, add it to YOUR module under your own namespace and
note it in your final report — never silently change another module's API.

## 0. What we are building

A remake of `beltaction.html` (聖犬士イッヌ 〜ワンワン帝国の野望〜, a 2D canvas belt-scroll brawler)
as a **Pixar-style 3D, 2.5D belt-scroll action game** for **elementary-school kids**, playable on a
**smartphone** (touch) and on PC (keyboard).

- Same concept: the dog holy-knight イッヌ and his friends (7 dog heroes) save ワンダフル王国 from the
  ダークワンワン帝国, stage by stage, walking right, beating waves of enemies, then a boss.
- Look: **Pixar-like** soft 3D (warm key light, cool fill, rim light, soft contact shadows, rounded
  shapes, saturated but soft colours, squash & stretch animation) with **chiikawa-like chibi
  deformation** (huge round head ~55% of height, tiny bean body, stubby limbs, small dot eyes with a
  white highlight, pink blush, tiny mouth, thin dark outline). ORIGINAL characters only — never copy
  Chiikawa/Hachiware/Usagi designs; we only borrow the proportions and softness.
- Tone: kids. Enemies are not killed — a defeated foe gets dizzy, goes "ぽんっ" in a puff of smoke,
  a heart pops out and it becomes a happy little puppy that runs away (なかなおり). Bosses are
  "purified": a dark aura leaves them. No blood, no guns: firearms from the original are reskinned as
  toys (cork gun ⇒ star/cork popper, gatling ⇒ confetti cannon, bombing ⇒ fireworks / candy drops).
- Text for players: mostly hiragana/katakana + very simple kanji. Big readable rounded fonts.
- Audio: bright, happy, major-key BGM; cute SFX.

## 1. Technical rules (all modules)

- Three.js **r160**, loaded as the global `THREE` from
  `https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.min.js`. Do NOT use ES modules, `import`,
  or any `three/examples` addon. Only core THREE classes.
- Each source file in `inu25d/src/` is a classic script wrapped in an IIFE:
  ```js
  (function(){ 'use strict'; const G = window.G; const THREE = window.THREE;
    // ... your code ...
    G.fx = { ... };            // export ONLY through G
  })();
  ```
  Files are concatenated in filename order by `tools/build25d.js` into `beltaction25d.html`.
  Top-level names never leak; everything shared goes through `G`.
- Files and owners: `00_core` (lead), `10_look` (lead), `20_heroes`, `30_foes` (lead: framework),
  `31_zako` (common foe types), `35_bosses_a` (garm, shark, ghost, cerbe), `36_bosses_b` (slime, dragon,
  kuroinu, emperor), `40_stage`, `50_combat` (lead), `55_player` (lead), `60_fx`, `70_audio`, `80_ui`,
  `90_game` (lead). Only edit your own file(s).
- Load order = filename order. At load time a file may only *define*
  things. Anything that needs another module must run in `init()` (called by 90_game after all files
  loaded) or lazily at runtime.
- Every module exports an optional `init()`; `90_game` calls `G.look.init()`, `G.heroes.init()`, ...
  in load order after the renderer exists.
- **No** `localStorage`/`sessionStorage` without try/catch (the artifact sandbox may throw). No network
  fetches, no external images/fonts except Google Fonts CSS (in the shell). Textures are generated
  procedurally on a `<canvas>` (CanvasTexture) or are plain colours.
- Performance budget (mid-range phone, 60 fps): ≤ 150 draw calls in a busy scene, ≤ 120k triangles.
  Heroes/foes: sphere segments ≤ 24×16. Share geometries & materials through `G.look` caches.
  Never allocate `new THREE.Vector3()` etc. inside per-frame code — keep scratch objects at module
  scope. Objects removed from the scene must be released: call `rig.dispose()` which disposes only
  what that rig created for itself (never shared cached geometry/materials).
- The game logic runs at a **fixed 60 Hz tick**. All timers are in **frames** (1 frame = 1/60 s)
  unless the name ends in `Sec`. Velocities are in **units per frame**. Gravity `G.cfg.GRAV`.
- `Math.random` is fine for visuals. Gameplay randomness should use `G.rng()` (seedable, for tests).

## 2. World coordinates

- `x` = along the belt, right is +. `y` = up (0 = ground). `z` = depth, **+z is toward the camera**.
- 1 unit ≈ a hero's head diameter. A hero is ~1.25 units tall (head ≈ 0.7 of that visually),
  a normal foe ~1.1–1.6, bosses 2.5–5.
- The walkable belt is `G.cfg.ZMIN = -2.4` … `G.cfg.ZMAX = 2.0`. Stage x runs from 0 to `stage.length`.
- Camera looks from +z and above, perspective, and follows the player in x.
- Facing: `ent.face` is `+1` (right) or `-1` (left). Rigs turn the model so it faces its direction
  but stays turned ~35° toward the camera so the face is always visible.

## 3. Core services (`00_core.js`, owned by the lead)

```
G.cfg        { GRAV:-0.012, ZMIN, ZMAX, TICK:1/60, ... }
G.U          utils: clamp, lerp, invLerp, damp(a,b,k), approach(v,t,step), rand(a,b), randi(a,b),
             pick(arr), chance(p), sign, easeOutBack, easeOutCubic, easeInOutSine, TAU, vec3 scratch
G.rng()      seedable RNG in [0,1); G.seed(n)
G.bus        on(evt, fn) / off(evt, fn) / emit(evt, data)          — see §7 for events
G.renderer, G.scene, G.camera
G.lights     { hemi, key, rim, fill }   (stage may retint these via G.stage theme)
G.quality    { tier: 0|1|2, dpr, shadows:bool, fxScale:1|0.6|0.35 }   0 = best
G.cam        camera controller: G.cam.follow(ent), G.cam.lock(xmin,xmax) / unlock(),
             G.cam.shake(power, frames), G.cam.punch(zoomAmount, frames), G.cam.focus(x,y,z,frames)
             (cinematic look-at override, e.g. boss intro), G.cam.snap()
G.input      { x, z  (analog −1..1, z<0 = away from camera = screen-up),
               btn: { attack, jump, dodge, special, ult, pause, confirm } each:
                 { down:bool, pressed:bool (edge this tick), released:bool, held:frames } }
             G.input.touch — raw touch state written by 80_ui (see §9)
G.time       { tick (frames since boot), sceneTick }
G.hitStop    frames of world freeze (combat sets it; fx/camera still animate)
G.slowmo(frames, scale=0.35)   slow motion
G.scenes     registry: G.scenes.name = { enter(params), exit(), tick(), frame(dtSec) }
G.go(name, params)   switch scene ('title','select','play','ending', …)
G.world      { ents:[], add(ent), remove(ent), clear() }  — adds rig.root to scene, keeps lists
G.player     the hero entity while playing (null otherwise)
G.foesAlive() number of living team-1 entities
```

## 4. Entities

Plain objects. Created by `G.makeEnt(opts)` (core) which fills defaults:

```
id, kind:'hero'|'foe'|'boss'|'prop'|'pickup', type (hero id / foe type id), team: 0 hero, 1 foe, 2 neutral
x,y,z, vx,vy,vz, face:±1, onGround:true,
radius (0.35..), height (1.2..), weight (1 = normal; >1 knockback reduced)
hp, maxHp, dead:false,
state:'idle', stateT:0,            — gameplay state machine owned by player/foe logic
anim:'idle', animT:0, animLen:0, animHit:0.35,  — what the rig should show (see §5)
atk:null,                          — current attack instance (§6)
inv:0 (i-frames), stun:0, flashT:0 (white hit flash frames), hurtDir:±1,
armor:0 (hits it can absorb without flinching), poise, ...
rig: { root:THREE.Object3D, ... }  — visual (§5)
```

`G.world.add(ent)` places `ent.rig.root` in the scene. Each render frame core sets
`rig.root.position` from the entity (interpolated) — rigs must NOT set their own root position.
Rigs animate children only.

## 5. Rig interface (heroes & foes & bosses)

A rig is returned by `G.heroes.build(id)` / `G.foes.build(type)`:

```
rig.root            THREE.Group, origin at the feet (y=0 ground contact), model faces +x at rotation 0
rig.update(ent, dt) called once per tick after gameplay. Reads ent.anim / ent.animT / ent.animLen /
                    ent.animHit / ent.face / ent.vx / ent.vz / ent.vy / ent.onGround / ent.flashT /
                    ent.stun / ent.charge (0..1) / ent.dead and poses the model. Handles facing turn,
                    squash & stretch, blinking, hit flash (white emissive while ent.flashT>0),
                    dizzy stars when ent.stun>0 and anim==='dizzy'.
rig.height          number (units), top of head — used for HP bars / popups
rig.tip             THREE.Object3D at the weapon tip (or paw) — fx trails & projectiles spawn here
rig.base            THREE.Object3D at the weapon base/hand
rig.setAlpha(a)     fade whole model (used for poof / respawn blink). Optional but recommended.
rig.dispose()
```

Animation names. `animT` counts frames since the anim started (core resets it when `anim` changes via
`G.setAnim(ent, name, len, hitAt)`). For one-shot anims `animLen` = total frames and
`p = animT/animLen` in 0..1; `animHit` = the fraction of `p` where the hit becomes active (the
rig should reach the strike pose at `p≈animHit`, anticipation before, follow-through after).

Heroes: `idle, run, jump, fall, land, atk1, atk2, atk3, atk4, charge (holding, ent.charge 0..1),
chargeAtk, airAtk, airAtk2, dive, dodge, special, specialUp, specialDash, ult, hurt, down (lying),
getup, dizzy, ko, victory, pose (character-select / title idle, looping), cheer`.

Foes: `idle, walk, windup (telegraph, shake + lean back), attack, attack2, shoot, hurt, down, getup,
dizzy, ko, roar (bosses), special (bosses), cheer (run away happily after KO)`.
Any unknown anim name must fall back to `idle` without throwing.

## 6. Combat (`50_combat.js`, owned by the lead)

Attack definition (plain object, may be shared):

```
{ id:'inu_a1', anim:'atk1', len:18,           // total frames
  hits:[ { at:5, dur:3, x0:0.1, x1:1.25, zr:0.65, y0:0, y1:1.5,
           dmg:8, kb:0.10, up:0, stun:18, stop:4, kind:'slash', power:1 } ],
  move:[ {at:3, vx:0.10} ],                   // forward (× face) impulse at frame `at`
  proj:[ {at:6, kind:'wave', vx:0.35, dmg:10, ...} ],
  cancel:12,                                  // from this frame the next combo input chains
  armor:false, inv:null|[from,to], sp:1 }
```

`kind`: 'slash' | 'blunt' | 'magic' | 'star' | 'fire' | 'ice' | 'thunder' | 'wind' | 'pop'.
`power`: 1 light, 2 heavy, 3 finisher/ult — drives fx size, hitstop, sfx.

API:
```
G.combat.start(ent, def)        begin an attack (sets ent.atk, anim, len, animHit)
G.combat.tick()                 advances all attacks + projectiles + resolves hits (called by game)
G.combat.damage(target, amount, info)   info {src, kind, power, kb, up, stun, dir, x,y,z}
G.combat.shoot(opts)            projectile {owner, kind, x,y,z, vx,vy,vz, grav, dmg, r, life, pierce,
                                power, stun, kb, up}; visual from G.fx.makeProjectile(kind)
G.combat.area(opts)             instant/short radial hit {owner, x,z, r, y0,y1, dmg, delay, ...}
G.pickups.spawn(kind, x, z, opts)   kinds: 'bone' (heal 25%), 'cake' (heal 60%), 'coin', 'gem',
                                'star' (fills ひっさつ), 'heart' (full heal)
G.props.spawn(kind, x, z, drop)  breakables: 'crate','barrel','pot','pumpkin','crystal'
```

## 7. Events (`G.bus`)

Payloads are plain objects. Emitters are listed; fx/audio/ui subscribe.

| event | payload | emitted by |
|---|---|---|
| `hit` | {src, target, x,y,z, dmg, kind, power, dir, crit, blocked} | combat |
| `swing` | {ent, def, kind, power} | combat (attack active frame 0) |
| `shoot` | {ent, kind, x,y,z} | combat |
| `jump` | {ent, double} | player/foes |
| `land` | {ent, hard} | core physics |
| `step` | {ent} | rigs may emit on footfalls (optional) |
| `dodge` | {ent, just} | player |
| `hurt` | {ent, dmg} | combat (player took damage) |
| `down` | {ent} | combat (knocked down) |
| `ko` | {ent, x,y,z} | combat (a foe was defeated) |
| `heroKO` | {ent} | combat |
| `revive` | {ent} | game |
| `pickup` | {ent, kind, x,y,z, value} | combat/pickups |
| `special` | {ent, id, name} | player |
| `ult` | {ent, id, name, heroId} | player (fx shows the cut-in) |
| `combo` | {count, rank} | combat |
| `levelUp` | {ent, level} | game |
| `gauge` | {ent, sp, ult} | player |
| `wave` | {index, total} | stage |
| `waveClear` | {index} | stage |
| `go` | {} | stage (show GO→ arrow) |
| `bossIntro` | {boss, name, title} | stage |
| `bossPhase` | {boss, phase} | foes |
| `bossDown` | {boss} | combat |
| `stageStart` | {index, stage} | game |
| `stageClear` | {index, stars, time, coins} | game |
| `scene` | {name} | core |
| `cover` | {touch} | ui (the touch pad appeared / went away: `cam.usableW()` changed; a locked fight re-fits like on `resize`) |

## 8. Module APIs (implemented by module owners)

### 10_look.js — shared materials & builders
```
G.look.init()
G.look.mat(hexColor, opts)   cached MeshStandardMaterial with the "soft Pixar" shader tweak
                             (fresnel rim light + subtle warm subsurface tint). opts {rough, metal,
                             emissive, rim (0..1), sheen, flat, transparent}
G.look.matInstance(hex,opts) same but NOT cached (per-rig, for hit flash); caller disposes
G.look.outline(mesh, thickness=0.035, color='#3a2418')  inverted-hull outline child (shared mat)
G.look.geo.sphere(r, ws, hs) / capsule(r, len) / box / cylinder / cone / torus — cached by params
G.look.eye(size) → Group   glossy black dot eye with white highlight(s) (chiikawa style)
G.look.blush(size) → Mesh  soft pink cheek (transparent radial gradient decal)
G.look.blobShadow(radius) → Mesh  soft round contact shadow on the ground (y≈0.01)
G.look.canvasTex(w,h,drawFn) → CanvasTexture (cached by key if given)
G.look.pickupMesh(kind), G.look.propMesh(kind) → {obj, dispose}
```

### 20_heroes.js
```
G.heroes.list    [ {id, name, short, species, desc, color, stats:{hp, atk, spd, jump}, weapon,
                   specialName, ultName, voice:{f0,type}} ]   (7 heroes, order = select screen)
G.heroes.get(id)
G.heroes.build(id, opts) → rig   (§5). opts.menu = true for select-screen quality (can be same)
```

### 30_foes.js (framework, lead) + 31_zako / 35_bosses_a / 36_bosses_b (content)
```
G.foes.define(type, def)   register a foe/boss type. def:
  { name, hp, spd (walk units/frame ≈0.03–0.06), radius, height, weight (1; bosses 3+),
    score, xp, boss:false, title:'', armor:0 (hits absorbed before flinching; bosses use poise),
    poise: (bosses) damage needed to stagger, entrance:'walk'|'drop'|'burrow'|'none',
    build(ent) → rig,           model (§5). ent may be null (showcase)
    init(ent),                  optional, after spawn
    ai(ent),                    every tick while the foe is FREE (state 'idle'/'move'/'act'),
                                i.e. not in hurt/down/getup/dizzy/ko/spawn — those are handled by the framework
    onHurt(ent, info),          optional
    onKO(ent) → true to take over the KO (slime split, boss next form). Default: dizzy → poof → heart → happy puppy runs off
  }
G.foes.types[type]           the defs
G.foes.build(type) → rig
G.foes.spawn(type, x, z, opts) → ent   opts {entrance, face, y, boss:true, hpMul}
G.foes.tick(ent)             framework per-tick (reactions + calls def.ai)
G.foes.h                     helpers for ai():
  h.target(e) → hero ent or null      h.dx(e,t), h.dz(e,t), h.dist(e,t)
  h.face(e,t)                         turn toward t
  h.walkTo(e, x, z, spd)              sets vx/vz + anim 'walk'; returns true when arrived
  h.stop(e)                           vx=vz=0, anim 'idle'
  h.attack(e, def, windup)            windup frames of 'windup' anim + G.fx.alert(e) then G.combat.start(e, def)
                                      (e.state='act' until the attack ends). Returns false if busy.
  h.shoot(e, opts)                    G.combat.shoot with owner=e, team from e
  h.token(e) / h.release(e)           request/free an attack slot (max 2 attackers at once; 3 on つよい)
  h.wait(e, frames)                   idle for n frames (e.cool)
  h.spawnMinion(type, x, z)           spawn a helper (counts toward wave clear)
  h.say(e, text)                      speech bubble / onomatopoeia above the foe (G.fx.text 'onoma')
  h.rand()                            G.rng()
ent fields the framework maintains: e.state ('spawn','idle','move','act','hurt','down','getup','dizzy','ko'),
  e.stateT, e.cool (frames until next decision), e.def, e.phase (bosses, 0-based), e.hpMul.
```
Foes attack through `G.combat.start` / `G.combat.shoot` / `G.combat.area` only. Telegraph every attack
(`windup` ≥ 18 frames for normal foes, ≥ 30 for big boss moves) — `h.attack` does it for you.
Bosses: phases by HP (e.g. <50%): set `e.phase` and `G.bus.emit('bossPhase', {boss:e, phase})`.
Boss defs: `name` (banner + HP bar), `title` (HP bar subtitle), optional `short` — shown on the HP bar
instead of `name` when the full name would not fit (small phones), so a name is never cut to "…"; optional
`shortTitle` likewise for the title (without it the title drops its leading words until it fits).
Progress: `G.game.unlocked` = how many stages are cleared (0..7; 7 after the ending). The stage after them is open.

### 40_stage.js
```
G.stages         [ {id, name, kana, theme:{...}, length, waves:[...], boss:{type, x}} ] (see §10)
G.stage.load(index)   build the environment (sky, ground belt, props, lights tint, fog), reset
G.stage.unload()      dispose everything it created
G.stage.tick()        progression: triggers waves by player x, locks camera, spawns foes via
                      G.foes.spawn, emits wave/waveClear/go/bossIntro, spawns props/pickups
G.stage.bounds()      {xmin, xmax, zmin, zmax} currently walkable (camera lock aware)
G.stage.done          true once the boss is defeated
```

### 60_fx.js
```
G.fx.init(); G.fx.frame(dtSec)  (runs every render frame, also during hitstop)
G.fx.burst(kind, x,y,z, opts)   kinds: 'hit','hitBig','slash','sparkle','stars','hearts','dust',
                                'poof','ring','confetti','fireworks','heal','levelup','shock','magic'
G.fx.trail(ent) / G.fx.trailStop(ent)   weapon ribbon trail from rig.base→rig.tip while swinging
G.fx.text(str, x,y,z, style, opts)  onomatopoeia / damage number popups (DOM overlay), styles:
                                'dmg','crit','onoma','pow','heal','info','big'; opts {rank, lean, ent, life, color}.
                                'pow' = hit word: one per spot (a higher rank takes the slot over).
                                pow/onoma/crit words never sit on the hero nor on the HUD's top boxes
                                (boss bar block, hero panel): fx moves them off both
G.fx.alert(ent)                 "!" above a foe (telegraph)
G.fx.flash(color, alpha, frames) full-screen flash
G.fx.speedLines(frames)         anime speed lines overlay (ult, dash)
G.fx.cutin(heroId, name, done)  ult cut-in (DOM + CSS), calls done() when finished (~70 frames)
G.fx.makeProjectile(kind) → {obj, update(p), dispose()}   kinds: 'wave','star','ball','fire',
                                'ice','bolt','cork','confetti','bone','note','firework','rock','shadow'
```
Subscribes to bus events to auto-spawn hit sparks, KO poofs, heart pops, level-up sparkles etc.

### 70_audio.js
```
G.audio.unlock()                 call from the first user gesture (creates/resumes AudioContext)
G.audio.bgm(name)                'title','select','stage1'..'stage7','boss','final','clear','over','ending', null = stop
G.audio.sfx(name, opts)          'hit','hitBig','slash','swing','jump','land','dodge','coin','heal',
                                 'star','ko','poof','select','ok','cancel','go','alert','levelup',
                                 'special','ult','charge','shoot','pop','boing','bossRoar','clear'
G.audio.voice(heroId, kind)      short cute synthesized vocal chirp: 'atk','hurt','ult','win'
G.audio.muted / G.audio.setMuted(bool), G.audio.volume
```
Subscribes to bus events for automatic SFX. Must never throw if AudioContext is unavailable.

### 80_ui.js
```
G.ui.init()
G.ui.show(screen, data)   screens: 'title','select','hud','pause','result','over','ending','loading'
G.ui.hide(screen)
G.ui.banner(text, sub, frames)   big centered banner (ステージ名, "GO!", "ボス!")
G.ui.bossBar(ent|null)
G.ui.frame(dtSec)                per render frame (HUD numbers, gauges, combo)
Touch controls: writes G.input.touch (§9).
```

### 90_game.js — boot, scene flow, progression (lead)

## 9. Touch input contract

`G.input.touch = { x, z, attack, jump, dodge, special, ult, pause }` — x/z analog −1..1 from the
virtual stick (z<0 when the stick is pushed UP), buttons are booleans (true while held). Core merges
this with the keyboard each tick and derives edges. Multi-touch must work (stick + buttons at once;
track `Touch.identifier` / pointerId). Keyboard: arrows/WASD move, J/Z attack, K/Space jump,
L/Shift dodge, I/X special, U/C ult, P/Esc pause, Enter confirm.

## 10. Content

See `inu25d/CONCEPT.md` (heroes, moves, stages, foes, bosses, story, look & feel).

## 11. Building, viewing, testing

```bash
node tools/build25d.js                         # syntax-checks every module, writes beltaction25d.html
cd /tmp && NODE_PATH=/opt/node22/lib/node_modules node /home/user/Kuchiwan/tools/shot25d.js \
   --only 00,10,20,90 \                        # build ONLY these modules to a private temp page
   --eval "G.debug.showcase(['inu','shima']); G.debug.anim('run'); G.step(20); return 1" \
   --shot /tmp/claude-0/-home-user-Kuchiwan/97efd7eb-1351-50a3-859b-9860e69f5747/scratchpad/<you>_x.png
```
- Always pass `--only` with the core modules (00,10,90) + your own file(s) (+ modules you depend on
  that already exist) — other people's files may be half-written. The page opens with `#test`:
  no rAF loop; advance time with `G.step(n)` (runs n ticks, then renders once).
- `G.debug.showcase(items, {anim, len, hitAt, gap, zoom, face})` shows hero ids / foe type ids / functions
  returning a rig in a row on a lit ground; `G.debug.anim(name, len, hitAt)` switches their animation.
- Look at your screenshots with the Read tool. Iterate until it looks right at phone size too
  (`--size 844x390`).
- The tool prints page errors, `G.errors` and `renderer.info` (draw calls, triangles). Exit code 2 = errors.
- Scratch files go in `/tmp/claude-0/-home-user-Kuchiwan/97efd7eb-1351-50a3-859b-9860e69f5747/scratchpad/`.
- Do NOT commit or push; the lead integrates.

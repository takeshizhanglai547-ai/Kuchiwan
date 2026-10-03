# IRONWAKE — player guide

> 日本語版: [README_JA.md](README_JA.md) · Handoff / 引き継ぎ書: [HANDOFF.md](HANDOFF.md)

## What is it?

A heavy-mech action game that runs in your browser. You are the independent contractor WAKE-01, piloting the 10-metre assault rig "RIG-07 IRONWAKE" through Halvard Deep Foundry, Pier 7: a derelict foundry port under an ash storm at dusk. Dodge with instant sideways **quick boosts**, break the security squad with rifle, missiles, cannon and pulse blade, cut the relay generators, and finish with a duel against the rival rig "CINDERHOUND". One stage, fixed loadout, 5-15 minutes per sortie.

---

## Getting started

1. **Double-click `dist/ironwake.html`.**
   - Use **Google Chrome** or **Microsoft Edge** (latest version recommended).
   - If another browser opens, right-click the file > "Open with" > Chrome or Edge.
   - If the file came in a zip, extract the zip first.
2. After "LOADING / 読み込み中…" the title screen appears (it can take 10-30 seconds).
3. **START MISSION** > read the briefing > **LAUNCH**.
4. **Click the game once** to capture the mouse for aiming (the pointer disappears). **Esc** pauses and gives the pointer back.
5. **Sound starts after your first click or key press** (a browser rule).

> **A computer with a graphics card (GPU) is needed for smooth play.** Gaming PCs and recent laptops are fine. Without a GPU the game still runs, but it lowers quality and resolution automatically and stays slow.

---

## Controls

### Keyboard + mouse

| Key / button | Action |
|---|---|
| **W A S D** | Move |
| **Mouse** | Aim / look (arrow keys also turn the view) |
| **Left click** (hold) | Right-arm rifle |
| **Right click** | Left-arm pulse blade (lunges at the locked target and slashes) |
| **Q** | Left-back missiles (auto-lock targets inside the reticle frame) |
| **E** | Right-back heavy cannon (one big shell with blast) |
| **Shift** | **Quick boost** (an instant burst in the direction you are moving) |
| **Space** | Jump. **Hold to hover** (climb / hang in the air) |
| **F** | Assault boost (charge, then fast flight; press F again to stop) |
| **C** | Ground boost on / off (on by default; off = walk) |
| **Tab** or **middle click** | Switch lock target |
| **V** | Target assist on / off (the camera follows the locked target) |
| **R** | Repair kit (restores AP, 3 kits) |
| **Esc** or **P** | Pause |
| **Enter** | Confirm in menus |

### Gamepad (Xbox layout)

| Button | Action |
|---|---|
| **Left stick** | Move |
| **Right stick** | Aim / look |
| **RT** | Rifle |
| **LT** | Pulse blade |
| **LB** | Missiles |
| **RB** | Heavy cannon |
| **B** | Quick boost |
| **A** | Jump / hold to hover |
| **L3** (press left stick) | Assault boost |
| **View (Select)** | Ground boost on / off |
| **Y** | Switch lock target |
| **R3** (press right stick) | Target assist on / off |
| **X** | Repair kit |
| **Menu (Start)** | Pause |

- Press any button once after connecting the pad (browsers only see a gamepad after a button press).
- In menus: **D-pad or left stick** to select, **A** to confirm, **B** to go back (B resumes from the pause menu).

### Reading the HUD

| Display | Meaning |
|---|---|
| **AP** | Armour. At 0 the rig is destroyed and the mission fails |
| **EN** | Boost energy. Quick boosts, hover and assault boost use it; it refills quickly when you stop |
| **STAGGER / 姿勢** | Your posture gauge. Taking sustained hits fills it; when full you are briefly stunned |
| **OBJECTIVE** (top left) | Current task, count, elapsed time (limit 15:00) |
| Subtitles (bottom) | Radio from your handler LEDGER |

---

## Mission

Three phases, in order:

1. **Destroy the Picket squad**: five PK-2 "Picket" sentry walkers (GNAT drones harass you).
2. **Destroy the relay generators**: three towers on the far quay. They shoot back and call drones.
3. **Destroy the rival rig "CINDERHOUND"**: it drops in from the sky for a one-on-one duel.

- All three done: **MISSION COMPLETE**. AP 0 or 15 minutes elapsed: **MISSION FAILED**.
- The results screen gives a **rank S / A / B / C / D** from a 100-point score:
  - **clear time** (40 points): full at 5 minutes or less, 0 at 15 minutes;
  - **damage taken** (40 points): full with no damage, less the more you take;
  - **repair kits used** (20 points): minus 7 per kit.
  - S ≥ 85, A ≥ 70, B ≥ 55, C ≥ 40, otherwise D.
- **RETRY** on the results screen restarts immediately; **RESTART** is also in the pause menu.

---

## Tips

- **The quick boost (Shift) is everything.** Combined with a direction it throws the rig ~40 m in an instant. Enemies telegraph every burst with a **red (GNAT: blue) laser sight and a glint**: when you see it, quick-boost sideways.
  - One quick boost costs 17% EN; about six in a row from full.
  - Emptying EN **turns the bar red and locks boosting for about 2 seconds**. Keep a little in reserve.
- **Run with ground boost on (C toggles it).** Fast ground movement costs no EN.
- **Hover (hold Space)** to climb onto structures; **assault boost (F)** to cross the map. Both use EN.
- **Stagger enemies:** hits fill an enemy's posture gauge; when it fills, the enemy reels and **direct hits deal about 1.85x damage**. Follow up with the **cannon (E)** or the **blade (right click)**. Missiles and the cannon fill the gauge fastest.
- **Missiles (Q) lock up to 4 targets** that stay inside the reticle frame; fire when the corner ticks turn amber.
- **Repair kits (R): 3.** Each restores about 40% of max AP, but every kit costs rank points. Use one below ~30% AP.
- **No resupply:** rifle 540 rounds, missiles 120, cannon 24. Save cannon shells for staggered targets.
- **CINDERHOUND:** every big attack is announced by a **glint and a rising beeping**. Dodge with a quick boost, then punish the recovery. Its blast armour shrugs off missiles and the cannon; **the rifle and the blade hurt it most** (missiles and cannon still build stagger). Below half AP it releases its limiter: faster, more aggressive.

---

## Graphics and other options

**OPTIONS** on the title screen or the pause menu (saved in this browser):

| Option | What it does |
|---|---|
| **GRAPHICS QUALITY** | **LOW / MEDIUM / HIGH**. Use LOW if the game stutters; HIGH adds anti-aliasing, ambient occlusion, light shafts and motion blur |
| LOOK SENSITIVITY | Mouse / right-stick turn speed (default 1.0) |
| INVERT LOOK Y | Inverts vertical look |
| Volumes | Master, music, effects, voice |
| SUBTITLES | Radio subtitles on/off and size |
| CAMERA SHAKE | Shake strength |
| HUD OPACITY | HUD strength |

Advanced: add `?quality=low` (or `medium` / `high`) after the file name in the address bar and press Enter, e.g. `file:///C:/Users/you/Downloads/ironwake/dist/ironwake.html?quality=low`.

---

## Troubleshooting

**Black screen / stuck on "LOADING"**
- Wait about 30 seconds; the first start can be slow.
- Use the **latest Chrome or Edge**. Old browsers show "This browser cannot start the game".
- "The file is damaged": download the file again.
- "WebGL2 is not available": turn on hardware acceleration. Chrome: ⋮ > Settings > System > "Use graphics acceleration when available" > relaunch. Edge: … > Settings > System and performance > "Use graphics acceleration when available" > restart.
- Do not open the file from inside a zip; extract it first.

**Low frame rate**
- OPTIONS > GRAPHICS QUALITY > **LOW**.
- Close other apps and tabs; plug laptops into power.
- Laptops with two GPUs: Windows Settings > System > Display > Graphics > set Chrome / Edge to "High performance".
- Without a GPU the game drops quality and resolution by itself; play on a PC with a GPU if it is still slow.

**No sound**
- Click the screen or press a key once (browsers stay silent until you interact).
- Check the in-game volumes, the system volume and that the browser tab is not muted.

**The mouse does not turn the view / the pointer disappeared**
- Click the game to capture the mouse (the pointer hides). **Esc** releases it and pauses; choose **RESUME**, then click again.
- While the mouse is not captured, a **CLICK TO AIM** chip shows at the bottom of the screen; one click on the game captures it.
- If the browser refuses to capture the mouse, the game switches to **hold a mouse button and drag** to look (the chip reads **DRAG TO AIM**). Arrow keys always work.
- Switching to another window (Alt+Tab) pauses the game automatically.

**Gamepad not detected**: press a button once; a USB cable is the most reliable.

**Settings not saved**: private / incognito windows do not keep settings.

---

## For developers

All commands run from this folder with Node 22 (`export PATH=/opt/node22/bin:$PATH` in the build container).

| Command | What it does |
|---|---|
| `npm run serve` | Dev server (prints the URL of `index.html`) |
| `npm run check` | Bundle check, manifest check, `Math.random` ban, unit tests |
| `npm run smoke` | Plays the game headless (PASS/FAIL table); `npm run smoke -- --dist` tests the single file |
| `npm run shoot -- --shot gameplay_chase` | Staged screenshots in `.shots/` (`--all`, `--dist`, ...) |
| `npm run build` | Builds `dist/ironwake.html`: one self-contained file, gzip-packed (must stay under 15.5 MB; target 14 MB) |
| `npm run ue5:arena` / `npm run ue5:package` | Rebuild the Unreal hand-off folder `ue5/assets` (Python + Blender `bpy`; see `ue5/README_JA.md`) |

Release: `npm run check && npm run smoke && npm run build && npm run smoke -- --dist`, then ship `dist/ironwake.html` (the folder is gitignored; force-add the file for a release commit).

Architecture, contracts and budgets: `docs/ARCHITECTURE.md`. Quality bar: `docs/AC6_BENCHMARK.md` (a reference for quality only; IRONWAKE uses only its own original setting and names). Blender asset pipeline: `docs/BLENDER_PIPELINE.md`. Unreal Engine 5 hand-off (unverified in Unreal): `ue5/README_JA.md`, `ue5/CLAUDE.md`, `ue5/GAME_SPEC.md`.

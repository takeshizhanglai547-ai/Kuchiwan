// ASHVEIL — boot, render pipeline, and the fixed-step game loop.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import { Materials, PALETTE } from './world/materials.js';
import { buildLevel, buildSky } from './world/level.js';
import { GameCamera } from './core/camera.js';
import { input } from './core/input.js';
import { fx } from './core/fx.js';
import { audio } from './core/audio.js';
import { hud } from './ui/hud.js';
import { buildPlayer } from './actors/characters.js';
import { Player } from './actors/player.js';
import { Director } from './game/director.js';
import { FrameStats, clamp, damp } from './core/util.js';

const FIXED_DT = 1 / 60;
const MAX_STEPS = 5;          // never spiral: drop simulation time rather than stall

const game = {
  running: false,
  paused: false,
  started: false,
  quality: 'high',
  stats: new FrameStats(180),
  showFps: false,          // debug readout; enable with ?fps=1
};
window.ASHVEIL = game;        // debug + automated capture hook

boot().catch((e) => {
  document.getElementById('booterr').textContent = (e && e.stack) || String(e);
});

async function boot() {
  const progress = (p) => { document.getElementById('bootbar').style.width = (p * 100) + '%'; };
  progress(0.05);

  // --- quality tier --------------------------------------------------------
  // Chosen from the actual GPU string where available. The brief's perf DoD is
  // 1080p60, and the honest way to hold that is to scale, not to hope.
  const canvas = document.getElementById('view');
  const renderer = new THREE.WebGLRenderer({
    canvas, antialias: true, powerPreference: 'high-performance', stencil: false,
  });
  const gl = renderer.getContext();
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  const gpu = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : '';
  const soft = /SwiftShader|llvmpipe|Software|Microsoft Basic/i.test(gpu);
  game.gpu = gpu;
  game.quality = soft ? 'low' : (window.devicePixelRatio > 1.9 ? 'med' : 'high');
  const params = new URLSearchParams(location.search);
  const override = params.get('quality');
  if (override) game.quality = override;
  game.simLock = Math.max(0, parseInt(params.get('simlock') || '0', 10)) || 0;
  // The frame counter is a development readout and does not belong on screen in
  // anything shown to anyone else.
  game.showFps = params.get('fps') === '1' || !!game.simLock;

  renderer.setPixelRatio(game.quality === 'low' ? 1 : Math.min(devicePixelRatio, 1.5));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = game.quality === 'low' ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.32;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  game.renderer = renderer;
  progress(0.15);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, 0.12, 500);
  scene.add(camera);
  game.scene = scene;

  // --- content -------------------------------------------------------------
  const mats = new Materials(game.quality);
  progress(0.35);

  const sky = buildSky(scene, mats, game.quality);
  progress(0.45);

  const level = buildLevel(scene, mats);
  progress(0.65);

  fx.init(scene, { quality: game.quality, ambient: 0.35 });
  progress(0.72);

  hud.init(document.getElementById('ui'));
  hud.showFps(game.showFps);
  hud.setControlsVisible(true);
  let _controlsTimer = 0;   // counts up until the cheatsheet retires; -1 = retired
  progress(0.78);

  const playerChar = buildPlayer(mats);
  const player = new Player(playerChar);
  player.applyUpgrades();
  scene.add(player.group);

  // A short-range fill light on the player. Without it the protagonist is a black
  // cut-out against a dark world — the key light rakes from behind, which is
  // right for the environment and wrong for the character you must read.
  const playerFill = new THREE.PointLight(0xa8b0c4, 2.0, 6.5, 2.0);
  playerFill.position.set(0, 1.5, 0);
  player.group.add(playerFill);
  player.teleport(level.playerSpawn.x, level.playerSpawn.y, level.playerSpawn.z, level.playerSpawn.yaw);

  // Sweep the ribbon along the OUTER HALF of the blade only. Auto-derivation
  // spans pommel-to-tip, which produces a ribbon as wide as the whole sword.
  fx.setTrailAxis(playerChar.sword, new THREE.Vector3(0, 0.60, 0), new THREE.Vector3(0, 1.16, 0));

  const gameCam = new GameCamera(camera);
  gameCam.setCollision(level.collision);
  gameCam.snap(player);

  const director = new Director(scene, level, mats, fx, audio, hud, player);
  progress(0.9);

  // --- post processing -----------------------------------------------------
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  let bloom = null;
  if (game.quality !== 'low') {
    // Restrained: threshold is high enough that only ember-glass and fire bloom.
    // High threshold on purpose: only ember-glass, fire and the kiln should bloom.
    // Drop it and the sky blooms, which is what makes cheap scenes look hazy.
    bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.26, 0.22, 1.20);
    composer.addPass(bloom);
  }
  composer.addPass(new OutputPass());
  game.composer = composer;

  input.init(canvas);
  // In deterministic capture mode there is no pointer lock to be had.
  if (game.simLock) input.requirePointerLock = false;

  // --- shared context handed to every system each step ---------------------
  const ctx = {
    input, camera: gameCam, collision: level.collision, fx, audio, hud,
    player, actors: null, projectiles: director.projectiles,
    rules: director.rules,
    onEnemyKilled: (e) => { /* hook for future rewards */ },
    onPlayerDeath: () => director.onPlayerDeath(),
    onPlayerDrink: () => director.boss.onPlayerDrink(),
    onBossPhase: (p) => director.onBossPhase(p),
    onBossDefeated: (b) => director.onBossDefeated(b),
  };
  game.ctx = ctx;
  game.combat = ctxCombat;      // debug hook: lets the capture harness deal REAL damage
  game.director = director;
  game.player = player;
  game.gameCam = gameCam;
  game.level = level;

  // --- resize --------------------------------------------------------------
  const onResize = () => {
    const w = innerWidth, h = innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    composer.setSize(w, h);
    bloom?.setSize(w, h);
  };
  addEventListener('resize', onResize);
  onResize();

  // --- title / start -------------------------------------------------------
  hud.screen('title');
  hud.onScreenAction((action) => {
    if (action === 'start') startGame();
    else if (action === 'retry') director.respawn();
    else if (action === 'continue') {
      if (game.paused) { game.paused = false; hud.screen('none'); input.requestPointerLock(); }
      else location.reload();
    }
  });

  function startGame() {
    if (game.started) return;
    game.started = true;
    hud.screen('none');
    audio.init();
    audio.music('ambient');
    input.requestPointerLock();
  }

  // Clicking the canvas re-captures the mouse after Esc.
  canvas.addEventListener('click', () => {
    if (game.started && !game.paused && !input.pointerLocked) input.requestPointerLock();
  });
  input.onFocusLost = () => {
    if (game.simLock) return;
    if (game.started && !game.paused && director.state !== 'dead' && director.state !== 'victory') {
      game.paused = true;
      hud.screen('paused');
    }
  };

  progress(1);
  document.getElementById('boot').classList.add('gone');
  setTimeout(() => document.getElementById('boot').remove(), 900);

  // --- the loop ------------------------------------------------------------
  let last = performance.now();
  let acc = 0;
  const _rv = new THREE.Vector3();
  const _screen = { x: 0, y: 0 };

  function frame(now) {
    requestAnimationFrame(frame);

    // The TRUE frame time goes into the stats — clamping it here would let the
    // FPS readout report a comfortable 10fps floor on a machine actually
    // rendering at 2. Only the simulation clamps.
    const trueMs = now - last;
    last = now;
    game.stats.push(trueMs);
    game.frameCount = (game.frameCount || 0) + 1;

    if (!game.started || game.paused) { composer.render(); return; }

    const rawMs = Math.min(trueMs, 100);

    // Hitstop scales SIMULATION time only — the renderer keeps running so the
    // freeze reads as impact rather than as a dropped frame.
    const scale = fx.timeScale();

    let steps = 0;
    if (game.simLock) {
      // Deterministic mode (?simlock=N): every rendered frame advances exactly N
      // fixed steps regardless of wall-clock time. Used by the automated capture
      // harness so a slow software renderer cannot distort gameplay timing.
      for (let i = 0; i < game.simLock; i++) { simulate(FIXED_DT); steps++; }
    } else {
      acc += (rawMs / 1000) * scale;
      while (acc >= FIXED_DT && steps < MAX_STEPS) {
        simulate(FIXED_DT);
        acc -= FIXED_DT;
        steps++;
      }
      if (steps === MAX_STEPS) acc = 0;
    }
    game.simSteps = steps;
    game.totalSteps = (game.totalSteps || 0) + steps;
    game.rawMs = trueMs;

    const dt = game.simLock ? steps * FIXED_DT : rawMs / 1000;

    // Camera and FX run at render rate for smoothness.
    gameCam.update(dt, player, input, fx);
    fx.update(dt * scale, camera);
    audio.listener(camera.position, camera.getWorldDirection(_rv));

    updateShadowFollow(sky.key, player);
    updateHud(dt);

    // The controls cheatsheet is onboarding, not HUD. Left permanently on it
    // reads as a debug keybind dump — and it sat over the lower-right quadrant of
    // the arena for the entire boss fight, with world geometry showing through
    // the text. It now retires once the player has had time to read it.
    if (_controlsTimer >= 0) {
      _controlsTimer += dt;
      if (_controlsTimer > 26 || director.state === 'boss') {
        _controlsTimer = -1;
        hud.setControlsVisible(false);
      }
    }

    // Tell the architecture's dissolve what this shot is about, so anything
    // standing between the camera and the subject opens up. Locked on, the
    // subject is the target — the fight is the shot, not the player's back.
    const focus = gameCam.target && gameCam.target.alive ? gameCam.target : player;
    _rv.set(focus.pos.x, focus.pos.y + (focus.height || 1.8) * 0.5, focus.pos.z);
    mats.setFocus(camera, _rv);
    // Volga's own cutout tracks the player, so a 4.6m boss standing between the
    // camera and the player opens around them instead of swallowing them.
    _rv.set(player.pos.x, player.pos.y + 0.95, player.pos.z);
    mats.setBossFocus(camera, _rv);

    composer.render();
  }

  function simulate(dt) {
    input.update(dt);
    const actors = director.hittable;
    ctx.actors = actors;

    handleLockOn();

    player.update(dt, ctx);
    for (const e of director.enemies) if (e.alive || e.deadTime < 6) e.update(dt, ctx);
    if (director.boss.alive || director.boss.deadTime < 8) director.boss.update(dt, ctx);

    director.projectiles.update(dt, [player], level.collision, (t, info, owner) => {
      const { applyDamage } = ctxCombat;
      const res = applyDamage(t, info, owner, director.rules);
      if (res.dealt > 0) { fx.hitstop(0.05); fx.shake(0.2, 0.16); }
    });

    player.resolveReactions(ctx);
    director.update(dt, ctx);

    // A player who falls out of the world is put back, not left falling.
    if (player.pos.y < -25 && player.alive) {
      player.hp = Math.max(1, player.hp - 35);
      const c = director.checkpoint;
      player.respawn(c.x, c.y + 0.1, c.z, c.yaw ?? 0);
      hud.damageFlash(0.6);
    }
  }

  function handleLockOn() {
    if (input.consume('lockon')) {
      if (gameCam.target) {
        gameCam.target = null;
        player.lockTarget = null;
        audio.play('lockoff');
      } else {
        const t = gameCam.pickTarget(player, director.lockTargets);
        if (t) { gameCam.target = t; player.lockTarget = t; audio.play('lockon'); }
      }
    }
    if (input.consume('cycleR') && gameCam.target) {
      const t = gameCam.cycleTarget(player, director.lockTargets, 1);
      if (t) { gameCam.target = t; player.lockTarget = t; audio.play('lockon'); }
    }
    // Drop the lock when the target dies or leaves.
    if (gameCam.target && (!gameCam.target.alive ||
        player.distanceTo(gameCam.target) > 26)) {
      gameCam.target = null;
      player.lockTarget = null;
    }
  }

  function updateHud(dt) {
    hud.setPlayer({
      hp: player.hp, maxHp: player.hpMax,
      stamina: player.stamina, maxStamina: player.staminaMax,
      flasks: player.flasks, maxFlasks: player.flasksMax,
    });

    const t = gameCam.target;
    if (t && !t.isBoss && t.alive) {
      hud.setTarget({ name: t.name, hp: t.hp, maxHp: t.hpMax });
    } else {
      hud.setTarget(null);
    }

    if (t && t.alive) {
      _rv.set(t.pos.x, t.pos.y + (t.height || 1.8) * (t.isBoss ? 0.62 : 0.72), t.pos.z);
      const p = gameCam.project(_rv, _screen, innerWidth, innerHeight);
      hud.setLockOn(p ? p.x : null, p ? p.y : null);
    } else {
      hud.setLockOn(null);
    }

    if (game.showFps) hud.setFps(Math.round(game.stats.avgFps));
  }

  /**
   * The sun's shadow box follows the player. Without this a 140-unit level either
   * gets no shadows or gets a 8192px shadow map nobody can afford.
   */
  function updateShadowFollow(key, player) {
    key.target.position.set(player.pos.x, player.pos.y, player.pos.z);
    key.position.set(player.pos.x - 24, player.pos.y + 30, player.pos.z + 34);
    key.target.updateMatrixWorld();
  }

  requestAnimationFrame(frame);
}

// Imported lazily to avoid a cycle between main and combat.
import * as ctxCombat from './game/combat.js';

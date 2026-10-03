// src/main.js — boot only. Owner: lead engine programmer.
//
// SYSTEM LIST: every subsystem is loaded with a dynamic import() (static string, so the
// single-file build bundles it). A module that fails to load/init is logged and skipped;
// the rest of the game still runs. `order` = update order (see docs/ARCHITECTURE.md).
import { Game, parseParams } from './core/engine.js';
import { installDebug } from './core/debug.js';

export const SYSTEM_MODULES = [
  { name: 'environment', order: 20, load: () => import('./render/environment.js') },
  { name: 'arena', order: 30, load: () => import('./world/arena.js') },
  { name: 'lockon', order: 90, load: () => import('./weapons/lockon.js') },
  { name: 'player', order: 100, load: () => import('./player/player.js') },
  { name: 'enemies', order: 200, load: () => import('./enemies/enemies.js') },
  { name: 'projectiles', order: 400, load: () => import('./weapons/projectiles.js') },
  { name: 'mission', order: 600, load: () => import('./game/mission.js') },
  { name: 'fx', order: 700, load: () => import('./fx/particles.js') },
  { name: 'camera', order: 800, load: () => import('./player/camera.js') },
  { name: 'hud', order: 900, load: () => import('./ui/hud.js') },
  { name: 'hints', order: 905, load: () => import('./core/hints.js') },
  { name: 'menus', order: 910, load: () => import('./ui/menus.js') },
  { name: 'audio', order: 950, load: () => import('./audio/audio.js') },
  { name: 'pipeline', order: 1000, load: () => import('./render/pipeline.js') },
];

function showFatal(msg) {
  const el = document.getElementById('boot');
  if (el) {
    el.classList.add('error');
    el.innerHTML = `<div class="boot-title">IRONWAKE</div><div class="boot-msg">起動できませんでした / Failed to start</div><pre>${String(msg).replace(/</g, '&lt;')}</pre>`;
  }
}

function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2'));
  } catch (e) { return false; }
}

async function boot() {
  const params = parseParams(location.search);
  if (!webglAvailable()) { showFatal('WebGL2 is not available in this browser. / このブラウザはWebGL2に対応していません。'); return; }
  const canvas = document.getElementById('game-canvas');
  const overlay = document.getElementById('ui');
  const game = new Game({ canvas, overlay, params });
  window.__game = game; // handy in the devtools console
  await game.init(SYSTEM_MODULES);
  const api = installDebug(game);

  // Title state with the stage prepared behind it.
  game.startSession({ state: 'title' });
  if (params.skip) game.startSession({ state: 'playing' });
  else if (game.menus) game.menus.show('title');

  const bootEl = document.getElementById('boot');
  if (bootEl) bootEl.remove();

  game.start();
  if (params.shot) {
    await api.setShot(params.shot, { seed: params.seed, cam: params.cam, look: params.look, fov: params.fov, t: params.t, hud: params.hud });
  } else if (params.cam && params.look) {
    // Free camera over the live mission: start playing, simulate t seconds, then override.
    game.startSession({ state: 'playing' });
    if (game.menus) game.menus.hideAll();
    if (params.t) game.advance(Math.round(params.t * 60), { render: false });
    game.cam.setOverride({ pos: params.cam, look: params.look, fov: params.fov || 50 });
    if (params.hud !== null) game.hud.setVisible(params.hud);
  }
  if (!game.manual) game.renderFrame();
  else game.renderFrame(game.FIXED_DT);
  api.ready = true;
  game.events.emit('game:booted', {});
}

boot().catch((err) => {
  console.error('[boot] fatal:', err);
  showFatal(err && err.stack ? err.stack : err);
});

// src/ui/menus.js — title, briefing, pause and results screens (owner: mission/HUD designer).
// Styles: css/ui.css (.menu, .menu-title, .menu-briefing, .menu-pause, .menu-results).
//
// Flow:  title --(START)--> briefing --(LAUNCH)--> playing <--(Esc)--> paused
//        playing --(mission:end)--> results --(RETRY)--> playing | --(TITLE)--> title
// Keyboard: Enter = primary button, Esc = back/resume. Gamepad: A (confirm) / Start.
// API (game.menus): show(name) / hideAll() / current
import { STAGES } from '../game/missionLogic.js';

const CONTROLS = [
  ['W A S D', '移動', 'Move'],
  ['MOUSE', '照準', 'Aim'],
  ['LMB', '右腕武器 (ライフル)', 'R-arm rifle'],
  ['RMB', '左腕武器 (パルスブレード)', 'L-arm pulse blade'],
  ['Q', '左背武器 (ミサイル)', 'L-back missiles'],
  ['E', '右背武器 (キャノン)', 'R-back cannon'],
  ['SHIFT', 'クイックブースト', 'Quick boost'],
  ['SPACE', 'ジャンプ / ホバー (長押し)', 'Jump / hover (hold)'],
  ['F', 'アサルトブースト', 'Assault boost'],
  ['C', 'ブースト切替', 'Boost on/off'],
  ['TAB / MMB', 'ロック対象切替', 'Switch lock target'],
  ['R', '修復キット', 'Repair kit'],
  ['ESC', 'ポーズ', 'Pause'],
];

function fmtTime(t) {
  const m = Math.floor(t / 60), s = Math.floor(t % 60), cs = Math.floor((t * 100) % 100);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

export default function menusSystem(game) {
  let root;
  const screens = {};
  let current = null;

  function btn(parent, en, jp, onClick, primary = false) {
    const b = document.createElement('button');
    b.className = 'menu-btn' + (primary ? ' primary' : '');
    b.innerHTML = `<span class="en">${en}</span><span class="jp">${jp}</span>`;
    b.addEventListener('click', (e) => { e.stopPropagation(); game.audio.unlock(); game.audio.play('ui_confirm'); onClick(); });
    parent.appendChild(b);
    return b;
  }

  function screen(name, html) {
    const s = document.createElement('div');
    s.className = `menu menu-${name}`;
    s.innerHTML = html;
    s.style.display = 'none';
    root.appendChild(s);
    screens[name] = s;
    return s;
  }

  function controlsTable() {
    return `<table class="controls">${CONTROLS.map(([k, jp, en]) => `<tr><td class="key">${k}</td><td class="jp">${jp}</td><td class="en">${en}</td></tr>`).join('')}</table>`;
  }

  function startMission() {
    game.startSession();
    // Pointer lock must be requested inside the user gesture.
    if (!game.params.test) game.input.requestPointerLock();
  }

  function build(parent) {
    root = document.createElement('div');
    root.className = 'menus';
    root.id = 'menus';
    parent.appendChild(root);

    const t = screen('title', `
      <div class="title-block">
        <div class="logo">IRONWAKE</div>
        <div class="logo-jp">アイアンウェイク</div>
        <div class="tagline">HEAVY FRAME COMBAT // SINGLE OPERATION</div>
      </div>
      <div class="menu-actions"></div>
      <div class="controls-block"><div class="controls-head">CONTROLS <span>操作方法</span></div>${controlsTable()}
        <div class="controls-note">Gamepad supported (standard mapping). ゲームパッド対応</div></div>`);
    btn(t.querySelector('.menu-actions'), 'START', '出撃準備', () => api.show('briefing'), true);

    const stagesHtml = STAGES.map((s, i) => `<li><b>${i + 1}</b> ${s.title}<span>${s.jp}</span></li>`).join('');
    const b = screen('briefing', `
      <div class="brief-head">MISSION BRIEFING <span>作戦概要</span></div>
      <div class="brief-name">OPERATION: IRONWAKE — HALVARD DEEP FOUNDRY, PIER 7</div>
      <div class="brief-text">
        <p>LEDGER here. Grauwerk Consolidated Security holds Pier 7 of the Halvard Deep Foundry.
        A sentry walker squad guards the yard and three relay generators feed the port's
        defense grid. Break the squad, cut the relays, and deal with whatever answers the alarm.
        Expect a rival rig. Payment on completion, WAKE-01.</p>
        <p class="jp">こちらレジャー。ハルヴァルド深層鋳造港・第7埠頭はグラウヴェルク統合保安部の管理下にある。
        警備部隊を撃破し、中継ジェネレーター3基を破壊せよ。敵リグの出現が予想される。以上だ、ウェイク01。</p>
      </div>
      <ol class="brief-stages">${stagesHtml}</ol>
      <div class="brief-frame">RIG: RIG-07 IRONWAKE — FIXED LOADOUT<br>
        R-ARM RF-24 RIFLE · L-ARM PB-7 PULSE BLADE · L-BACK ML-6 MISSILES · R-BACK HC-90 CANNON</div>
      <div class="menu-actions"></div>`);
    const ba = b.querySelector('.menu-actions');
    btn(ba, 'LAUNCH', '出撃', startMission, true);
    btn(ba, 'BACK', '戻る', () => api.show('title'));

    const p = screen('pause', `<div class="pause-head">PAUSED <span>一時停止</span></div><div class="menu-actions"></div>
      <div class="controls-block small">${controlsTable()}</div>`);
    const pa = p.querySelector('.menu-actions');
    btn(pa, 'RESUME', '再開', () => api.resume(), true);
    btn(pa, 'RESTART', '再出撃', () => startMission());
    btn(pa, 'TITLE', 'タイトルへ', () => api.toTitle());

    const r = screen('results', `
      <div class="res-head"></div><div class="res-head-jp"></div>
      <div class="res-body">
        <div class="res-rank"><div class="rank-letter"></div><div class="rank-label">RANK 評価</div></div>
        <table class="res-table"></table>
      </div>
      <div class="menu-actions"></div>`);
    const ra = r.querySelector('.menu-actions');
    btn(ra, 'RETRY', '再出撃', () => startMission(), true);
    btn(ra, 'TITLE', 'タイトルへ', () => api.toTitle());
  }

  function fillResults(result) {
    const s = screens.results;
    const ok = result && result.status === 'complete';
    s.classList.toggle('win', ok);
    s.classList.toggle('lose', !ok);
    s.querySelector('.res-head').textContent = ok ? 'MISSION COMPLETE' : 'MISSION FAILED';
    s.querySelector('.res-head-jp').textContent = ok ? '作戦完了' : (result && result.reason === 'timeout' ? '作戦失敗 — 時間切れ' : '作戦失敗 — 機体大破');
    s.querySelector('.rank-letter').textContent = ok ? result.rank : '';
    s.querySelector('.rank-label').textContent = ok ? 'RANK 評価' : 'NO RANK 評価なし';
    const k = (result && result.kills) || {};
    const rows = [
      ['CLEAR TIME', '作戦時間', fmtTime(result ? result.time : 0)],
      ['DAMAGE TAKEN', '被ダメージ', String(Math.round(result ? result.damageTaken : 0))],
      ['REPAIR KITS USED', '修復キット使用', String(result ? result.kitsUsed : 0)],
      ['MT DESTROYED', 'MT撃破', String(k.mt || 0)],
      ['DRONES DESTROYED', 'ドローン撃破', String(k.drone || 0)],
      ['GENERATORS', 'ジェネレーター', String(k.turret || 0)],
      ['SCORE', 'スコア', ok ? String(result.score) : '—'],
    ];
    s.querySelector('.res-table').innerHTML = rows.map(([en, jp, v]) => `<tr><td class="en">${en}</td><td class="jp">${jp}</td><td class="v">${v}</td></tr>`).join('');
  }

  const api = {
    name: 'menus',
    order: 910,
    get current() { return current; },
    init(g) {
      build(g.overlay);
      g.menus = api;
      g.events.on('input:action', (e) => api._onAction(e));
      g.events.on('mission:end', (e) => { fillResults(e.result); api.show('results'); });
      g.events.on('game:state', (e) => {
        if (e.to === 'playing') api.hideAll();
        if (e.to === 'paused') api.show('pause');
      });
      // First user gesture unlocks audio.
      const unlock = () => g.audio.unlock();
      window.addEventListener('pointerdown', unlock, { once: true });
      window.addEventListener('keydown', unlock, { once: true });
    },
    show(name) {
      for (const k in screens) screens[k].style.display = k === name ? '' : 'none';
      current = name;
      if (name === 'title' && game.state !== 'title') game.setState('title');
      if (name === 'briefing') game.setState('briefing');
      if (name === 'results') {
        if (game.state !== 'results') game.setState('results');
        const res = game.mission && game.mission.result;
        if (res) fillResults(res);
      }
    },
    hideAll() { for (const k in screens) screens[k].style.display = 'none'; current = null; },
    resume() {
      if (game.state !== 'paused') return;
      game.setState('playing');
      if (!game.params.test) game.input.requestPointerLock();
    },
    toTitle() {
      game.startSession({ state: 'title' });
      api.show('title');
    },
    /** Test API helper: fill + show results immediately. */
    showResults(result) { fillResults(result); api.show('results'); },
    _onAction(e) {
      const st = game.state;
      if (e.action === 'pause') {
        if (st === 'playing') game.setState('paused');
        else if (st === 'paused') api.resume();
        else if (st === 'briefing') api.show('title');
      } else if (e.action === 'confirm' || (e.source === 'gamepad' && e.code === 'Pad0')) {
        const scr = current && screens[current];
        const primary = scr && scr.querySelector('.menu-btn.primary');
        if (primary && scr.style.display !== 'none' && st !== 'playing') primary.click();
      }
    },
  };
  return api;
}

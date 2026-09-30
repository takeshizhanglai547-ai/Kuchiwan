// src/ui/menus.js — title, controls, briefing, pause and results screens (owner: mission/HUD
// designer). Styles: css/ui.css (.menu, .menu-title, .menu-controls, .menu-briefing,
// .menu-pause, .menu-results).
//
// Flow:  title --(START)--> briefing --(LAUNCH)--> playing <--(Esc)--> paused
//        title --(CONTROLS)--> controls --(BACK)--> title
//        title | pause --(OPTIONS)--> options --(BACK / Esc)--> title | pause
// OPTIONS: look sensitivity, invert Y, master / music volume, graphics quality. Saved to
// localStorage (try/catch; ignored in test mode so captures stay deterministic) and applied to
// CAMERA (player/tuning.js), game.audio.setVolume / setMusicVolume and game.pipeline.setQuality.
//        playing --(mission:end)--> results --(RETRY)--> playing | --(TITLE)--> title
// Input: mouse hover/click, arrow keys or W/S to move the selection, Enter to confirm,
//        Esc to go back / resume. Gamepad: d-pad/stick via the same actions, A = confirm.
// The title and briefing frame the live stage with a hero camera (game.cam.setOverride).
// The briefing shows a top-down tactical map of the arena rendered in-engine (tacmap.js).
// Results reveal row by row on the sim clock (deterministic; instant in test mode unless
// game.menus.revealInstant is set false, see the results_reveal shot).
// API (game.menus): show(name) / hideAll() / current / showResults(result) / heroCamera(name)
import * as THREE from 'three';
import { STAGES } from '../game/missionLogic.js';
import { renderTacMap, createTacMapJob, tacMapCanvas, mapProject, mapNorthAngle } from './tacmap.js';
import { fmtClock, voiceLevels } from './hud.js';
import { stencilSVG } from './glyphs.js';
import { CAMERA } from '../player/tuning.js';

const CONTROLS = [
  // [keyboard / mouse, gamepad, JP, EN]
  ['W A S D', 'L STICK', '移動', 'Move'],
  ['MOUSE', 'R STICK', '照準', 'Aim'],
  ['LMB', 'RT', '右腕武器 ライフル', 'R-arm rifle'],
  ['RMB', 'LT', '左腕武器 パルスブレード', 'L-arm pulse blade'],
  ['Q', 'LB', '左背武器 ミサイル', 'L-back missiles'],
  ['E', 'RB', '右背武器 キャノン', 'R-back cannon'],
  ['SHIFT', 'B', 'クイックブースト', 'Quick boost'],
  ['SPACE', 'A', 'ジャンプ / ホバー（長押し）', 'Jump / hover (hold)'],
  ['F', 'L3', 'アサルトブースト', 'Assault boost'],
  ['C', 'SELECT', 'ブースト切替', 'Boost on / off'],
  ['TAB / MMB', 'Y', 'ロック対象切替', 'Switch lock target'],
  ['V', 'R3', 'ターゲットアシスト', 'Target assist'],
  ['R', 'X', '修復キット', 'Repair kit'],
  ['ESC', 'START', 'ポーズ', 'Pause'],
];

const INTEL_EN = 'LEDGER here. Grauwerk Consolidated Security still holds Pier 7 of the Halvard Deep Foundry. ' +
  'A PK-2 Picket walker squad patrols the ore yard with Gnat drones in support. Three relay generators on the far quay ' +
  'feed the port\'s defense grid. Break the squad, cut the relays, and deal with whatever answers the alarm. ' +
  'Intercepts mention a rival rig on standby. Payment on completion, WAKE-01.';
const INTEL_JP = 'こちらレジャー。ハルヴァルド深層鋳造港・第7埠頭は依然グラウヴェルク統合保安部の管理下にある。' +
  '鉱石ヤードにはPK-2ピケット部隊と無人機ナット。奥の岸壁にある中継ジェネレーター三基が港の防衛網を支えている。' +
  '警備部隊を撃破し、中継を断ち、警報に応じて現れるものを片付けろ。敵リグの待機情報もある。以上だ、ウェイク01。';

const THREATS = [
  ['mt', 'PK-2 "PICKET"', 'ピケット 警備歩行機', '×5', 2],
  ['drone', '"GNAT" DRONE', 'ナット 無人機', '×4', 1],
  ['relay', 'RELAY GENERATOR', '中継ジェネレーター', '×3', 1],
  ['boss', 'RIVAL RIG (EST.)', '敵リグ（推定）', '×1', 4],
];

// ---- options (persisted per browser; see header)
const OPT_KEY = 'ironwake.options.v1';
const OPT_DEFAULT = { sens: 1, invert: false, master: 80, music: 100, quality: '' }; // quality '' = automatic
const OPTIONS = [
  { k: 'sens', en: 'LOOK SENSITIVITY', jp: '視点感度', min: 0.2, max: 3, step: 0.1, fmt: (v) => v.toFixed(1),
    help: ['Camera turn speed for the mouse and the right stick. 1.0 is the default.', 'マウスと右スティックの視点移動の速さ。標準は1.0。'] },
  { k: 'invert', en: 'INVERT LOOK Y', jp: '上下反転', bool: true,
    help: ['Push forward to look down, pull back to look up.', '上下の視点操作を反転する。'] },
  { k: 'master', en: 'MASTER VOLUME', jp: '全体音量', min: 0, max: 100, step: 10, fmt: (v) => String(Math.round(v)),
    help: ['Overall loudness of the game: effects, radio and music.', '効果音・通信・音楽を含む全体の音量。'] },
  { k: 'music', en: 'MUSIC VOLUME', jp: '音楽音量', min: 0, max: 100, step: 10, fmt: (v) => String(Math.round(v)),
    help: ['Loudness of the score, relative to the master volume.', '全体音量に対する音楽の音量。'] },
  { k: 'quality', en: 'GRAPHICS QUALITY', jp: '画質', list: ['low', 'medium', 'high'], names: ['LOW', 'MEDIUM', 'HIGH'],
    help: ['Lower it if the game stutters. HIGH adds anti-aliasing, ambient occlusion, light shafts and motion blur.', '動作が重い場合は下げてください。HIGHではAA・AO・光条・モーションブラーが有効。'] },
];
function loadOptions(game) {
  const o = { ...OPT_DEFAULT };
  if (game.params.test) return o; // captures and the smoke test never depend on saved settings
  try {
    const raw = window.localStorage.getItem(OPT_KEY);
    if (raw) Object.assign(o, JSON.parse(raw));
  } catch (e) { /* storage blocked: defaults */ }
  o.sens = Math.min(3, Math.max(0.2, Number(o.sens) || 1));
  o.master = Math.min(100, Math.max(0, Number(o.master)));
  o.music = Math.min(100, Math.max(0, Number(o.music)));
  if (!Number.isFinite(o.master)) o.master = OPT_DEFAULT.master;
  if (!Number.isFinite(o.music)) o.music = OPT_DEFAULT.music;
  o.invert = !!o.invert;
  if (!OPTIONS[4].list.includes(o.quality)) o.quality = '';
  return o;
}
function saveOptions(game, o) {
  if (game.params.test) return;
  try { window.localStorage.setItem(OPT_KEY, JSON.stringify(o)); } catch (e) { /* storage blocked */ }
}

const VIZ_BARS = 40; // briefing voice visualiser bars

const REVEAL = { head: 0.15, row0: 0.55, rowGap: 0.26, total: 2.25, rank: 2.75, actions: 3.3, count: 0.45 };
const _o = { x: 0, y: 0 };
const ease = (k) => 1 - Math.pow(1 - Math.min(1, Math.max(0, k)), 3);

function fmtInt(n) { return String(Math.max(0, Math.round(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;'); }

export default function menusSystem(game) {
  let root;
  const screens = {};
  const lists = {};     // screen -> [button]
  const sel = {};       // screen -> selected index
  let current = null;
  let introT = 99;      // title/briefing intro timeline (real time)
  let typeT = 0;        // briefing typewriter chars
  const rev = { t: 0, on: false, result: null, rows: [], total: null };
  let mapBuilt = false;
  let opts = { ...OPT_DEFAULT }, optFrom = 'title';
  let sortieT = 99, fadeEl = null;
  let sensBase = 0, padBase = 0;
  const vizLv = new Float32Array(VIZ_BARS);    // briefing comm visualiser levels
  const vizQ = new Int16Array(VIZ_BARS).fill(-1);
  let vizBars = null;

  function btn(scr, parent, en, jp, onClick, primary = false, idx = '') {
    const b = document.createElement('button');
    b.className = 'menu-btn' + (primary ? ' primary' : '');
    b.type = 'button';
    b.tabIndex = -1;
    b.innerHTML = `<span class="idx">${idx}</span><span class="en">${en}</span><span class="jp">${jp}</span><i class="caret"></i>`;
    b.addEventListener('click', (e) => { e.stopPropagation(); game.audio.unlock(); applyOptions(false); game.audio.play('ui_confirm'); onClick(); });
    b.addEventListener('mouseenter', () => select(scr, lists[scr].indexOf(b), true));
    parent.appendChild(b);
    (lists[scr] || (lists[scr] = [])).push(b);
    return b;
  }

  function select(scr, i, sound) {
    const L = lists[scr];
    if (!L || !L.length) return;
    i = (i + L.length) % L.length;
    if (sel[scr] === i) return;
    sel[scr] = i;
    L.forEach((b, k) => b.classList.toggle('sel', k === i));
    if (sound) game.audio.play('ui_select');
    if (scr === 'options') refreshOptions();
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
    return `<table class="controls"><thead><tr><th>KEYBOARD / MOUSE</th><th>PAD</th><th colspan="2">ACTION <em>操作</em></th></tr></thead><tbody>${CONTROLS.map(([k, pad, jp, en]) =>
      `<tr><td class="key"><kbd>${k}</kbd></td><td class="pad">${pad}</td><td class="en">${en}</td><td class="jp">${jp}</td></tr>`).join('')}</tbody></table>`;
  }
  const hints = (items) => `<div class="menu-hints">${items.map(([k, en, jp]) => `<span><kbd>${k}</kbd>${en}<em>${jp}</em></span>`).join('')}</div>`;

  function startMission() {
    sortieT = 0; // fade in from black over the sortie (live play only; see frame())
    game.startSession();
    // Pointer lock must be requested inside the user gesture.
    if (!game.params.test) game.input.requestPointerLock();
  }

  // ------------------------------------------------------------------------------ build
  function build(parent) {
    root = document.createElement('div');
    root.className = 'menus';
    root.id = 'menus';
    parent.appendChild(root);
    fadeEl = document.createElement('div');
    fadeEl.className = 'sortie-fade';
    root.appendChild(fadeEl);

    // ---- title
    const t = screen('title', `
      <div class="lbox top"></div><div class="lbox bottom"></div>
      <div class="menu-grain"></div>
      <div class="title-status"><span class="dot"></span>LEDGER UPLINK<em>回線確立</em><span class="sep"></span>CONTRACT 07</div>
      <div class="title-block">
        <div class="kicker"><i></i>HALVARD DEEP FOUNDRY <span>/</span> PIER 7<em>ハルヴァルド深層鋳造港 第7埠頭</em></div>
        <div class="logo">${stencilSVG('IRONWAKE', { cls: 'logo-svg', title: 'IRONWAKE' })}</div>
        <div class="logo-sub"><span class="jp">アイアンウェイク</span><span class="rig">RIG-07 <em>ASSAULT RIG 強襲リグ</em></span></div>
        <div class="tagline">ONE RIG. ONE PIER. NO EXTRACTION UNTIL THE WORK IS DONE.</div>
      </div>
      <div class="menu-actions"></div>
      ${hints([['↑↓', 'SELECT', '選択'], ['ENTER', 'CONFIRM', '決定'], ['MOUSE', 'CLICK', 'クリック']])}
      <div class="title-foot">WAKE-01 <span>// INDEPENDENT CONTRACTOR</span><em>独立傭兵</em></div>`);
    const ta = t.querySelector('.menu-actions');
    btn('title', ta, 'START MISSION', '出撃準備', () => api.show('briefing'), true, '01');
    btn('title', ta, 'OPTIONS', '設定', () => api.openOptions('title'), false, '02');
    btn('title', ta, 'CONTROLS', '操作説明', () => api.show('controls'), false, '03');

    // ---- options (title and pause)
    const o = screen('options', `
      <div class="menu-grain"></div>
      <div class="scr-head"><span class="bar"></span>OPTIONS<em>設定</em><span class="scr-code">SYS-03 · SAVED LOCALLY</span></div>
      <div class="opt-block"><div class="sub-head">SETTINGS<em>各種設定</em></div><div class="opt-list"></div><div class="menu-actions opt-actions"></div></div>
      <div class="opt-help"><div class="sub-head">DETAIL<em>詳細</em></div><div class="oh-title"></div><div class="oh-en"></div><div class="oh-jp"></div>
</div>
      ${hints([['← →', 'ADJUST', '変更'], ['↑↓', 'SELECT', '選択'], ['ESC', 'BACK', '戻る']])}`);
    const ol = o.querySelector('.opt-list');
    OPTIONS.forEach((d, i) => {
      const b = btn('options', ol, d.en, d.jp, () => api.adjustOption(i, d.bool || d.list ? 1 : 0, true), false, String(i + 1).padStart(2, '0'));
      b.classList.add('opt');
      const v = document.createElement('span');
      v.className = 'opt-val' + (d.list ? ' list' : d.bool ? ' bool' : ' range');
      v.innerHTML = '<i class="arr l" data-dir="-1"></i>' +
        (d.list ? `<span class="opt-seg">${d.names.map((n) => `<b>${n}</b>`).join('')}</span>` : d.bool ? '<span class="opt-seg"><b>OFF</b><b>ON</b></span>' : '<span class="opt-meter"><i></i></span><b class="v"></b>') +
        '<i class="arr r" data-dir="1"></i>';
      b.insertBefore(v, b.querySelector('.caret'));
      v.addEventListener('click', (e) => {
        const dir = e.target && e.target.closest && e.target.closest('[data-dir]');
        if (!dir) return;
        e.stopPropagation();
        game.audio.unlock();
        api.adjustOption(i, Number(dir.dataset.dir), false);
      });
    });
    const oa = o.querySelector('.opt-actions');
    btn('options', oa, 'RESET DEFAULTS', '初期設定に戻す', () => api.resetOptions(), false, '06');
    btn('options', oa, 'BACK', '戻る', () => api.closeOptions(), true, '07');

    // ---- controls
    const c = screen('controls', `
      <div class="menu-grain"></div>
      <div class="scr-head"><span class="bar"></span>CONTROLS<em>操作説明</em><span class="scr-code">SYS-02</span></div>
      <div class="controls-block">${controlsTable()}
        <div class="controls-note">Gamepad: standard mapping (Xbox layout shown).<em>ゲームパッド対応（標準配置）。</em></div></div>
      <div class="tips"><div class="sub-head">FIELD NOTES<em>基本</em></div><ul>
        <li><b>AP</b><span>Armor. At zero the rig is lost.</span><em>機体の耐久値。0で撃破される。</em></li>
        <li><b>EN</b><span>Boost energy. Quick boosts drain it; at zero it locks until it recovers.</span><em>ブースト用エネルギー。枯渇すると回復まで使用不可。</em></li>
        <li><b>STAGGER</b><span>Fill an enemy's gauge to stagger it, then hit hard with the blade or cannon.</span><em>姿勢ゲージを溜めて体勢を崩し、ブレードやキャノンで大打撃を。</em></li>
        <li><b>LOCK</b><span>Hold targets in the reticle frame: their corner ticks turn amber as missiles lock (up to 4).</span><em>照準枠に捉え続けると角の表示が琥珀色に変わり、ミサイルがロック（最大4）。</em></li>
        <li><b>OPTIONS</b><span>Look sensitivity, invert Y, volume and graphics quality: title or pause menu.</span><em>視点感度・上下反転・音量・画質はタイトルまたはポーズ画面の「設定」から。</em></li>
      </ul></div>
      <div class="menu-actions"></div>
      ${hints([['ESC', 'BACK', '戻る'], ['ENTER', 'CONFIRM', '決定']])}`);
    btn('controls', c.querySelector('.menu-actions'), 'BACK', '戻る', () => api.show('title'), true, '');

    // ---- briefing
    const stagesHtml = STAGES.map((s, i) => `<li><b class="ph">PHASE ${i + 1}</b><span class="en">${esc(s.title)}</span><span class="jp">${esc(s.jp)}</span></li>`).join('');
    const threatHtml = THREATS.map(([k, en, jp, n, lvl]) => `<li><i class="ico ${k}"></i><span class="en">${en}</span><span class="jp">${jp}</span><span class="n">${n}</span><span class="lvl">${'<b></b>'.repeat(lvl)}${'<b class="off"></b>'.repeat(4 - lvl)}</span></li>`).join('');
    const b = screen('briefing', `
      <div class="menu-grain"></div>
      <div class="scr-head"><span class="bar"></span>MISSION BRIEFING<em>作戦概要</em><span class="scr-code">CONTRACT 07 · CLASS B</span></div>
      <div class="brief-grid">
        <div class="brief-map">
          <div class="map-head"><span>TACTICAL MAP</span><em>戦域図</em><span class="map-code">PIER 7 · 500 × 500 m</span></div>
          <div class="map-view"><div class="map-img"></div><div class="map-wait">ACQUIRING SURVEY IMAGE<em>戦域図 取得中</em></div><div class="map-grid"></div><div class="map-sweep"></div><div class="map-marks"></div>
            <div class="map-coords">${'ABCDEFGHIJ'.split('').map((c, i) => `<b style="left:${i * 10 + 5}%">${c}</b>`).join('')}${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n, i) => `<i style="top:${i * 10 + 5}%">${n}</i>`).join('')}</div>
            <div class="map-north"><i></i><span>N</span></div>
            <div class="map-scale"><i></i><span>100 m</span></div>
          </div>
          <div class="map-legend">
            <span><i class="ico lz"></i>LZ<em>降下地点</em></span><span><i class="ico mt"></i>PICKET<em>警備機</em></span>
            <span><i class="ico relay"></i>RELAY<em>中継</em></span><span><i class="ico boss"></i>RIG (EST.)<em>敵リグ推定</em></span>
          </div>
        </div>
        <div class="brief-info">
          <div class="op-name">OPERATION IRONWAKE</div>
          <div class="op-area">HALVARD DEEP FOUNDRY — PIER 7<em>ハルヴァルド深層鋳造港・第7埠頭</em></div>
          <div class="terms">
            <div><span>CLIENT<em>依頼主</em></span><b>UNDISCLOSED</b></div>
            <div><span>REWARD<em>報酬</em></span><b class="num">480,000 CR</b></div>
            <div><span>TIME LIMIT<em>制限時間</em></span><b class="num">15:00</b></div>
            <div><span>OPPOSITION<em>敵勢力</em></span><b>GRAUWERK CONSOLIDATED</b></div>
          </div>
          <div class="comm">
            <div class="comm-head"><span class="who">LEDGER<em>レジャー</em></span><span class="viz">${'<i></i>'.repeat(VIZ_BARS)}</span><span class="tag">HANDLER · ENCRYPTED</span></div>
            <p class="intel-en"><span class="done"></span><span class="rest"></span></p><p class="intel-jp"><span class="done"></span><span class="rest"></span></p>
          </div>
          <div class="brief-cols">
            <div><div class="sub-head">OBJECTIVES<em>作戦目標</em></div><ol class="brief-stages">${stagesHtml}</ol></div>
            <div><div class="sub-head">THREAT ASSESSMENT<em>脅威評価</em></div><ul class="threats">${threatHtml}</ul></div>
          </div>
          <div class="loadout"><span class="sub-head">RIG-07 IRONWAKE<em>固定装備</em></span>
            <span><b>R-ARM</b>RF-24 BRASSWORK</span><span><b>L-ARM</b>PB-7 EMBERLINE</span>
            <span><b>L-BACK</b>ML-6 HAILSTORM</span><span><b>R-BACK</b>HC-90 SLEDGE</span></div>
        </div>
      </div>
      <div class="menu-actions"></div>
      ${hints([['ENTER', 'LAUNCH', '出撃'], ['ESC', 'BACK', '戻る']])}`);
    const ba = b.querySelector('.menu-actions');
    btn('briefing', ba, 'LAUNCH', '出撃', startMission, true, '');
    btn('briefing', ba, 'BACK', '戻る', () => api.show('title'), false, '');

    // ---- pause
    const p = screen('pause', `
      <div class="menu-grain"></div>
      <div class="scr-head"><span class="bar"></span>PAUSED<em>一時停止</em><span class="scr-code">SIM HOLD</span></div>
      <div class="pause-grid">
        <div class="pause-left">
          <div class="pause-obj"><div class="sub-head">CURRENT OBJECTIVE<em>現在の目標</em></div><div class="po-title"></div><div class="po-jp"></div><div class="po-time"></div></div>
          <div class="menu-actions"></div>
        </div>
        <div class="controls-block small">${controlsTable()}</div>
      </div>
      ${hints([['ESC', 'RESUME', '再開'], ['↑↓', 'SELECT', '選択'], ['ENTER', 'CONFIRM', '決定']])}`);
    const pa = p.querySelector('.menu-actions');
    btn('pause', pa, 'RESUME', '再開', () => api.resume(), true, '01');
    btn('pause', pa, 'RESTART', '再出撃', () => startMission(), false, '02');
    btn('pause', pa, 'OPTIONS', '設定', () => api.openOptions('pause'), false, '03');
    btn('pause', pa, 'RETURN TO TITLE', 'タイトルへ', () => api.toTitle(), false, '04');

    // ---- results
    const r = screen('results', `
      <div class="menu-grain"></div>
      <div class="res-top">
        <div class="res-kicker"><span class="bar"></span>OPERATION IRONWAKE — AFTER-ACTION REPORT<em>作戦結果</em></div>
        <div class="res-head"></div><div class="res-head-jp"></div>
      </div>
      <div class="res-body">
        <div class="res-table"></div>
        <div class="res-rank"><div class="rank-frame"><div class="rank-letter"></div><i class="c tl"></i><i class="c tr"></i><i class="c bl"></i><i class="c br"></i></div>
          <div class="rank-label"></div><div class="rank-score"></div>
          <div class="rank-scale"><span data-r="D">D</span><span data-r="C">C</span><span data-r="B">B</span><span data-r="A">A</span><span data-r="S">S</span></div></div>
      </div>
      <div class="menu-actions"></div>
      ${hints([['ENTER', 'RETRY', '再出撃'], ['↑↓', 'SELECT', '選択']])}`);
    const tbl = r.querySelector('.res-table');
    for (let i = 0; i < 6; i++) {
      const row = document.createElement('div');
      row.className = 'rr';
      row.innerHTML = '<span class="rr-lbl"><b></b><em></em><span class="rr-sub"></span></span><span class="rr-val"></span><span class="rr-pts"><i class="m"><i></i></i><b></b></span>';
      tbl.appendChild(row);
      rev.rows.push({ el: row, en: row.querySelector('.rr-lbl b'), jp: row.querySelector('.rr-lbl em'), sub: row.querySelector('.rr-sub'), val: row.querySelector('.rr-val'),
        pts: row.querySelector('.rr-pts'), meter: row.querySelector('.rr-pts .m i'), ptsN: row.querySelector('.rr-pts b'), def: null });
    }
    const tot = document.createElement('div');
    tot.className = 'rr total';
    tot.innerHTML = '<span class="rr-lbl"><b>TOTAL SCORE</b><em>総合評価</em><span class="rr-sub"></span></span><span class="rr-val"></span><span class="rr-pts"><b>/ 100</b></span>';
    tbl.appendChild(tot);
    rev.total = { el: tot, val: tot.querySelector('.rr-val'), sub: tot.querySelector('.rr-sub') };
    const pay = document.createElement('div');
    pay.className = 'res-pay';
    pay.innerHTML = [['REWARD', '報酬'], ['REPAIR COST', '修理費'], ['AMMO COST', '弾薬費'], ['NET PAYOUT', '収支']]
      .map(([en, jp], i) => `<div class="${i === 3 ? 'net' : ''}"><span>${en}<em>${jp}</em></span><b></b></div>`).join('');
    tbl.appendChild(pay);
    rev.pay = { el: pay, vals: [...pay.querySelectorAll('b')] };
    const ra = r.querySelector('.menu-actions');
    btn('results', ra, 'RETRY', '再出撃', () => startMission(), true, '01');
    btn('results', ra, 'RETURN TO TITLE', 'タイトルへ', () => api.toTitle(), false, '02');

    for (const k in lists) select(k, 0, false);
  }

  // ------------------------------------------------------------------------------ briefing map
  let mapJob = null, mapTimer = 0, briefFrames = 0;
  /** Test mode: build the map synchronously. Live: one chunk per task so input stays responsive
   *  (the screen shows "ACQUIRING SURVEY" until the in-engine render is ready). */
  function buildMap() {
    if (mapBuilt) return;
    if (game.manual) { if (renderTacMap(game)) attachMap(); return; }
    screens.briefing.querySelector('.map-view').classList.add('loading');
    if (!mapJob) mapJob = createTacMapJob(game);
    const tick = () => {
      mapTimer = 0;
      if (current !== 'briefing' || mapBuilt) return; // resumes next time the briefing opens
      // Wait until the screen has been shown for a while (>= 1.5 s AND >= 45 rendered frames),
      // so a player clicking straight through never waits on the render.
      if (briefFrames < 45) { mapTimer = setTimeout(tick, 200); return; }
      if (mapJob.next()) { attachMap(); return; }
      mapTimer = setTimeout(tick, 16);
    };
    if (!mapTimer) mapTimer = setTimeout(tick, 1500);
  }

  function attachMap() {
    const s = screens.briefing;
    const canvas = tacMapCanvas();
    if (!canvas || mapBuilt) return;
    mapBuilt = true;
    s.querySelector('.map-view').classList.remove('loading');
    s.querySelector('.map-img').appendChild(canvas);
    const marks = s.querySelector('.map-marks');
    const sp = game.arena.spawns;
    let html = '';
    // operation area (arena walls at +-250 m)
    {
      let x0 = 1, y0 = 1, x1 = 0, y1 = 0;
      const c = new THREE.Vector3();
      for (const [x, z] of [[-250, -250], [250, -250], [250, 250], [-250, 250]]) {
        mapProject(game, c.set(x, 0, z), _o);
        x0 = Math.min(x0, _o.x); y0 = Math.min(y0, _o.y); x1 = Math.max(x1, _o.x); y1 = Math.max(y1, _o.y);
      }
      html += `<div class="mm-ao" style="left:${(x0 * 100).toFixed(2)}%;top:${(y0 * 100).toFixed(2)}%;width:${((x1 - x0) * 100).toFixed(2)}%;height:${((y1 - y0) * 100).toFixed(2)}%"><span>AO LIMIT<em>作戦領域</em></span></div>`;
    }
    const mark = (pos, cls, label, jp) => {
      if (!mapProject(game, pos, _o)) return;
      html += `<div class="mm ${cls}" style="left:${(_o.x * 100).toFixed(2)}%;top:${(_o.y * 100).toFixed(2)}%"><i class="ico ${cls}"></i>${label ? `<span>${label}${jp ? `<em>${jp}</em>` : ''}</span>` : ''}</div>`;
    };
    // Picket squad (internal type 'mt'): markers + one hull around them
    if (sp.mt && sp.mt.length) {
      let x0 = 1, y0 = 1, x1 = 0, y1 = 0;
      for (const m of sp.mt) { mapProject(game, m.pos, _o); x0 = Math.min(x0, _o.x); y0 = Math.min(y0, _o.y); x1 = Math.max(x1, _o.x); y1 = Math.max(y1, _o.y); }
      html += `<div class="mm-zone ph1" style="left:${(x0 * 100 - 3).toFixed(2)}%;top:${(y0 * 100 - 3).toFixed(2)}%;width:${((x1 - x0) * 100 + 6).toFixed(2)}%;height:${((y1 - y0) * 100 + 6).toFixed(2)}%"><span>PHASE 1<em>警備部隊</em></span></div>`;
      for (const m of sp.mt) mark(m.pos, 'mt', '', '');
    }
    (sp.relay || []).forEach((rl, i) => mark(rl.pos, 'relay', `RELAY ${'ABC'[i] || i + 1}`, i === 0 ? 'PHASE 2' : ''));
    (sp.boss || []).slice(0, 3).forEach((bs) => mark(bs.pos, 'boss', '', ''));
    if (sp.player) mark(sp.player.pos, 'lz', 'LZ', '降下地点');
    marks.innerHTML = html;
    const north = s.querySelector('.map-north');
    north.style.transform = `rotate(${mapNorthAngle().toFixed(1)}deg)`;
    north.querySelector('span').style.transform = `rotate(${(-mapNorthAngle()).toFixed(1)}deg)`;
  }

  // ------------------------------------------------------------------------------ results
  function rowDefs(result) {
    const ok = result && result.status === 'complete';
    const k = (result && result.kills) || {};
    const br = (result && result.breakdown) || { timeScore: 0, dmgScore: 0, kitScore: 0 };
    const killsTotal = (k.mt || 0) + (k.drone || 0) + (k.turret || 0) + (k.boss || 0);
    const time = result ? result.time : 0;
    const rows = [
      { en: ok ? 'CLEAR TIME' : 'OPERATION TIME', jp: '作戦時間', value: time, fmt: (v) => fmtClock(v), sub: ok ? `PAR ${fmtClock(result.parTime || 300).slice(0, 5)}` : '', pts: ok ? [br.timeScore, 40] : null },
      { en: 'DAMAGE TAKEN', jp: '被ダメージ', value: result ? result.damageTaken : 0, fmt: (v) => `${fmtInt(v)} AP`, sub: '', pts: ok ? [br.dmgScore, 40] : null },
      { en: 'REPAIR KITS USED', jp: '修復キット使用', value: result ? result.kitsUsed : 0, fmt: (v) => `${Math.round(v)} / 3`, sub: '', pts: ok ? [br.kitScore, 20] : null },
      { en: 'ENEMIES DESTROYED', jp: '撃破数', value: killsTotal, fmt: (v) => String(Math.round(v)), sub: `PICKET ${k.mt || 0} · GNAT ${k.drone || 0} · RELAY ${k.turret || 0} · RIG ${k.boss || 0}`, pts: null },
    ];
    if (ok) rows.push({ en: 'AP REMAINING', jp: '残存AP', value: result.apRemaining || 0, fmt: (v) => fmtInt(v), sub: '', pts: null });
    else {
      rows.push({ en: 'CAUSE', jp: '失敗要因', value: 0, fmt: () => (result && result.reason === 'timeout' ? 'TIME LIMIT' : 'AP DEPLETED'), sub: result && result.reason === 'timeout' ? '時間切れ' : '機体大破', pts: null, text: true });
      const st = result ? Math.min(STAGES.length, (result.stage || 0) + 1) : 1;
      rows.push({ en: 'PROGRESS', jp: '進行度', value: 0, fmt: () => `PHASE ${st} / ${STAGES.length}`, sub: result && STAGES[st - 1] ? STAGES[st - 1].title : '', pts: null, text: true });
    }
    return rows;
  }

  function fillResults(result) {
    const s = screens.results;
    const ok = result && result.status === 'complete';
    rev.result = result;
    s.classList.toggle('win', !!ok);
    s.classList.toggle('lose', !ok);
    s.querySelector('.res-head').textContent = ok ? 'MISSION COMPLETE' : 'MISSION FAILED';
    s.querySelector('.res-head-jp').textContent = ok ? '作戦完了 — 第7埠頭 制圧' : (result && result.reason === 'timeout' ? '作戦失敗 — 時間切れ' : '作戦失敗 — 機体大破');
    s.querySelector('.rank-letter').innerHTML = ok ? stencilSVG(result.rank, { cls: 'rank-svg', title: `RANK ${result.rank}` }) : 'VOID';
    s.querySelector('.rank-label').innerHTML = ok ? 'RANK<em>評価</em>' : 'NO RANK<em>評価なし</em>';
    s.querySelector('.rank-score').textContent = ok ? `SCORE ${result.score} / 100` : 'CONTRACT VOID';
    s.querySelector('.rank-frame').className = `rank-frame r-${ok ? result.rank : 'none'}`;
    const defs = rowDefs(result);
    rev.rows.forEach((r, i) => {
      const d = defs[i] || null;
      r.def = d;
      r.el.style.display = d ? '' : 'none';
      if (!d) return;
      r.en.textContent = d.en; r.jp.textContent = d.jp; r.sub.textContent = d.sub;
      r.el.classList.toggle('nopts', !d.pts);
      if (!d.pts) r.ptsN.textContent = '—';
      r.el.classList.toggle('text', !!d.text);
    });
    rev.total.el.style.display = ok ? '' : 'none';
    s.querySelectorAll('.rank-scale span').forEach((e) => e.classList.toggle('on', !!ok && e.dataset.r === result.rank));
    s.querySelector('.rank-scale').style.display = ok ? '' : 'none';
    rev.t = api.revealInstant ? 99 : 0; rev.on = true;
    applyReveal(rev.t);
  }

  /** Pure function of the reveal time: every visual is recomputed (deterministic captures). */
  function applyReveal(t) {
    const s = screens.results;
    const res = rev.result;
    const ok = res && res.status === 'complete';
    const head = ease((t - REVEAL.head) / 0.4);
    const top = s.querySelector('.res-top');
    top.style.opacity = head.toFixed(3);
    top.style.transform = `translateX(${((1 - head) * -24).toFixed(1)}px)`;
    rev.rows.forEach((r, i) => {
      if (!r.def) return;
      const t0 = REVEAL.row0 + i * REVEAL.rowGap;
      const k = ease((t - t0) / 0.3);
      r.el.style.opacity = k.toFixed(3);
      r.el.style.transform = `translateX(${((1 - k) * 18).toFixed(1)}px)`;
      const c = ease((t - t0 - 0.1) / REVEAL.count);
      r.val.textContent = r.def.text ? r.def.fmt(0) : r.def.fmt(r.def.value * c);
      r.el.classList.toggle('lit', t >= t0 && t < t0 + 0.45);
      if (r.def.pts) {
        const [pv, pm] = r.def.pts;
        r.meter.style.transform = `scaleX(${((pv / pm) * c).toFixed(3)})`;
        r.ptsN.textContent = `+${Math.round(pv * c)}`;
      }
    });
    const tk = ease((t - REVEAL.total) / 0.35);
    rev.total.el.style.opacity = tk.toFixed(3);
    rev.total.val.textContent = ok ? `${Math.round(res.score * ease((t - REVEAL.total) / 0.5))}` : '';
    rev.total.sub.textContent = ok ? `TIME ${Math.round(res.breakdown.timeScore)} + DAMAGE ${Math.round(res.breakdown.dmgScore)} + KITS ${Math.round(res.breakdown.kitScore)}` : '';
    const pk = ease((t - REVEAL.total - 0.25) / 0.35);
    const po = res && res.payout;
    rev.pay.el.style.opacity = pk.toFixed(3);
    if (po) {
      const c = ease((t - REVEAL.total - 0.3) / 0.6);
      const v = [po.reward, -po.repair, -po.ammo, po.net];
      for (let i = 0; i < 4; i++) {
        const n = Math.round(v[i] * c);
        rev.pay.vals[i].textContent = `${n < 0 ? '−' : ''}${fmtInt(Math.abs(n))} CR`;
        rev.pay.vals[i].classList.toggle('neg', n < 0);
      }
    }
    const rk = (t - REVEAL.rank) / 0.28;
    const rankEl = s.querySelector('.res-rank');
    const kk = ease(rk);
    rankEl.style.opacity = Math.min(1, Math.max(0, rk * 2)).toFixed(3);
    rankEl.style.transform = `scale(${(1 + (1 - kk) * 0.9).toFixed(3)})`;
    rankEl.classList.toggle('stamp', rk >= 1 && rk < 2.2);
    const ak = ease((t - REVEAL.actions) / 0.3);
    const act = s.querySelector('.menu-actions');
    act.style.opacity = ak.toFixed(3);
    s.querySelector('.menu-hints').style.opacity = ak.toFixed(3);
    return t;
  }

  // ------------------------------------------------------------------------------ cameras
  const HERO = {
    // Title key art: low 3/4 front, rig on the right third, long lens.
    title: { yaw: 0.55, dist: 27, camUp: 1.0, lookUp: 8.2, shift: 6.6, fov: 36 },
    // Briefing: behind the rig's shoulder, looking down the yard.
    briefing: { yaw: Math.PI + 0.42, dist: 17, camUp: 8.5, lookUp: 5.5, shift: -9, fov: 46 },
  };
  const _c = new THREE.Vector3(), _l = new THREE.Vector3();
  function heroCamera(name = 'title') {
    const h = HERO[name];
    const sp = game.player && game.player.spawned ? { pos: game.player.pos, yaw: game.player.yaw } : game.arena && game.arena.spawns && game.arena.spawns.player;
    if (!h || !sp) return;
    const a = sp.yaw + h.yaw;
    _c.set(sp.pos.x + Math.sin(a) * h.dist, sp.pos.y + h.camUp, sp.pos.z + Math.cos(a) * h.dist);
    // shift the look point sideways (camera-right) so the rig sits off-centre
    const rx = -Math.cos(a), rz = Math.sin(a);
    _l.set(sp.pos.x + rx * h.shift, sp.pos.y + h.lookUp, sp.pos.z + rz * h.shift);
    game.cam.setOverride({ pos: _c, look: _l, fov: h.fov });
  }

  /** Screen transition: a short fade/slide-in (CSS; live play only, so captures stay exact). */
  function enter(scr, changed) {
    if (!scr || !changed || game.manual) return;
    scr.classList.remove('enter');
    void scr.offsetWidth; // restart the animation (screen changes only, never per frame)
    scr.classList.add('enter');
  }

  // ------------------------------------------------------------------------------ options
  /** Push the current options into the game (camera tuning, audio mixer, render quality). */
  function applyOptions(withQuality) {
    if (sensBase) { CAMERA.lookSensitivity = sensBase * opts.sens; CAMERA.padLookSpeed = padBase * opts.sens; }
    CAMERA.invertY = opts.invert;
    const au = game.audio;
    if (au && au.setVolume) au.setVolume(opts.master / 100);
    if (au && au.setMusicVolume) au.setMusicVolume(opts.music / 100);
    if (withQuality && opts.quality && game.pipeline && game.pipeline.setQuality && game.pipeline.quality !== opts.quality) game.pipeline.setQuality(opts.quality);
  }
  function optValue(d) {
    if (d.k === 'quality') return opts.quality || (game.pipeline && game.pipeline.quality) || game.params.quality || 'high';
    return opts[d.k];
  }
  /** Redraw every option row (value text, meter, segments) and the detail panel. */
  function refreshOptions() {
    const s = screens.options;
    const rows = s.querySelectorAll('.menu-btn.opt');
    OPTIONS.forEach((d, i) => {
      const b = rows[i], v = optValue(d);
      if (d.list || d.bool) {
        const on = d.bool ? (v ? 1 : 0) : d.list.indexOf(v);
        b.querySelectorAll('.opt-seg b').forEach((e, k) => e.classList.toggle('on', k === on));
      } else {
        b.querySelector('.opt-meter i').style.transform = `scaleX(${((v - d.min) / (d.max - d.min)).toFixed(3)})`;
        b.querySelector('.v').textContent = d.fmt(v);
      }
    });
    const i = sel.options || 0, d = OPTIONS[i];
    s.querySelector('.oh-title').innerHTML = d ? `${d.en}<em>${d.jp}</em>` : (i === OPTIONS.length ? 'RESET DEFAULTS<em>初期設定に戻す</em>' : 'BACK<em>戻る</em>');
    s.querySelector('.oh-en').textContent = d ? d.help[0] : (i === OPTIONS.length ? 'Restore every setting on this screen to its default value.' : 'Return to the previous screen. Settings are saved automatically.');
    s.querySelector('.oh-jp').textContent = d ? d.help[1] : (i === OPTIONS.length ? 'この画面の設定をすべて初期値に戻す。' : '前の画面に戻る。設定は自動で保存されます。');
  }

  const api = {
    name: 'menus',
    order: 910,
    revealInstant: false,
    get current() { return current; },
    heroCamera,
    init(g) {
      build(g.overlay);
      g.menus = api;
      api.revealInstant = !!g.manual;
      sensBase = CAMERA.lookSensitivity; padBase = CAMERA.padLookSpeed;
      opts = loadOptions(g);
      // saved quality only when the URL does not force one (and never in test mode)
      applyOptions(!g.params.test && !new URLSearchParams(location.search).has('quality'));
      vizBars = [...screens.briefing.querySelectorAll('.comm .viz i')];
      g.events.on('input:action', (e) => api._onAction(e));
      g.events.on('mission:end', () => api.show('results'));
      g.events.on('game:state', (e) => {
        if (e.to === 'playing') {
          api.hideAll();
          if (e.from === 'title' || e.from === 'briefing') g.cam.clearOverride();
        }
        if (e.to === 'paused') api.show('pause');
      });
      // First user gesture unlocks audio.
      const unlock = () => { g.audio.unlock(); applyOptions(false); };
      window.addEventListener('pointerdown', unlock, { once: true });
      window.addEventListener('keydown', unlock, { once: true });
    },
    reset() {
      rev.on = false;
      api.revealInstant = !!game.manual;
    },
    show(name) {
      const prev = current;
      for (const k in screens) screens[k].style.display = k === name ? '' : 'none';
      current = name;
      enter(screens[name], prev !== name);
      if (lists[name]) { sel[name] = -1; select(name, 0, false); }
      if (name === 'title' || name === 'controls') {
        if (game.state !== 'title') game.setState('title');
        heroCamera('title');
        if (name === 'title' && prev !== 'controls') introT = game.manual ? 99 : 0;
      }
      if (name === 'briefing') {
        game.setState('briefing');
        heroCamera('briefing');
        briefFrames = 0;
        buildMap();
        typeT = game.manual ? 1e6 : 0;
        api._type();
        if (!game.manual && game.audio.radio) game.audio.radio(Math.min(9, INTEL_EN.length * 2.2 / 90)); // LEDGER briefing voice (audio lane)
      }
      if (name === 'pause') {
        const m = game.mission;
        const s = screens.pause;
        if (m) {
          const o = m.logic.objective();
          s.querySelector('.po-title').textContent = o.title || '';
          s.querySelector('.po-jp').textContent = o.jp || '';
          s.querySelector('.po-time').textContent = `${fmtClock(m.logic.time)}  ·  PHASE ${m.logic.stage + 1} / ${m.logic.stages.length}${o.count > 1 ? `  ·  ${o.progress} / ${o.count}` : ''}`;
        }
      }
      if (name === 'results') {
        if (game.state !== 'results') game.setState('results');
        const res = game.mission && game.mission.result;
        if (res && res !== rev.result) fillResults(res);
      }
    },
    hideAll() { for (const k in screens) screens[k].style.display = 'none'; current = null; },
    /** OPTIONS screen from the title or the pause menu (the game state is left as it is). */
    openOptions(from = 'title') {
      optFrom = from;
      for (const k in screens) screens[k].style.display = k === 'options' ? '' : 'none';
      enter(screens.options, current !== 'options');
      current = 'options';
      screens.options.classList.toggle('over-game', from === 'pause');
      sel.options = -1; select('options', 0, false);
      refreshOptions();
    },
    closeOptions() {
      saveOptions(game, opts);
      if (optFrom === 'pause' && game.state === 'paused') api.show('pause');
      else api.show('title');
    },
    /** Change option i by dir steps (-1 / +1); cycle = wrap around (Enter / click on the row). */
    adjustOption(i, dir, cycle) {
      const d = OPTIONS[i];
      if (!d || !dir) return;
      if (d.bool) opts[d.k] = !opts[d.k];
      else if (d.list) {
        const n = d.list.length, cur = d.list.indexOf(optValue(d));
        let k = cur + dir;
        k = cycle ? (k + n) % n : Math.max(0, Math.min(n - 1, k));
        opts.quality = d.list[k];
      } else {
        const v = Math.round((opts[d.k] + dir * d.step) / d.step) * d.step;
        opts[d.k] = Math.max(d.min, Math.min(d.max, cycle && v > d.max ? d.min : v));
        opts[d.k] = Number(opts[d.k].toFixed(2));
      }
      applyOptions(d.k === 'quality');
      saveOptions(game, opts);
      refreshOptions();
      game.audio.play('ui_select');
    },
    resetOptions() {
      opts = { ...OPT_DEFAULT };
      if (game.pipeline && game.pipeline.setQuality && game.params.quality && game.pipeline.quality !== game.params.quality) game.pipeline.setQuality(game.params.quality);
      applyOptions(false);
      saveOptions(game, opts);
      refreshOptions();
    },
    /** Current option values (read-only copy; for tests / debug). */
    get options() { return { ...opts }; },
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
    showResults(result) { api.show('results'); fillResults(result); },
    /** Jump the results reveal to its end state (or to time t). */
    finishReveal(t = 99) { rev.t = t; if (rev.result) applyReveal(t); },
    _type() {
      const s = screens.briefing;
      const n = Math.floor(typeT);
      const en = INTEL_EN.length, jp = INTEL_JP.length;
      const pe = s.querySelector('.intel-en'), pj = s.querySelector('.intel-jp');
      const ne = Math.min(en, n), nj = Math.min(jp, Math.max(0, Math.floor((n - en * 0.25) * (jp / en))));
      // typed part + invisible remainder, so the layout never shifts while typing
      pe.firstChild.textContent = INTEL_EN.slice(0, ne); pe.lastChild.textContent = INTEL_EN.slice(ne);
      pj.firstChild.textContent = INTEL_JP.slice(0, nj); pj.lastChild.textContent = INTEL_JP.slice(nj);
      pe.classList.toggle('typing', ne < en);
      pj.classList.toggle('typing', nj < jp && ne >= en * 0.25);
    },
    update() {
      // Results reveal runs on the sim clock (the sim keeps stepping in 'results').
      if (rev.on && current === 'results' && rev.t < 20) {
        const before = rev.t;
        rev.t += game.rawDt;
        applyReveal(rev.t);
        const rowsAt = [REVEAL.row0, REVEAL.row0 + REVEAL.rowGap, REVEAL.row0 + 2 * REVEAL.rowGap, REVEAL.row0 + 3 * REVEAL.rowGap, REVEAL.total];
        for (const at of rowsAt) if (before < at && rev.t >= at) game.audio.play('objective_tick');
        if (before < REVEAL.rank && rev.t >= REVEAL.rank) game.audio.play(rev.result && rev.result.status === 'complete' ? 'objective' : 'alarm');
      }
    },
    frame(alpha, realDt) {
      const dt = Math.min(0.1, realDt || 0);
      // sortie: fade in from black once the mission runs (0.15 s hold, 0.7 s fade)
      if (sortieT < 1.2) {
        if (game.state === 'playing') sortieT += dt;
        const k = Math.min(1, Math.max(0, (sortieT - 0.15) / 0.7));
        fadeEl.style.opacity = (1 - k * k * (3 - 2 * k)).toFixed(3);
        fadeEl.style.display = k >= 1 ? 'none' : 'block';
      }
      if (current === 'briefing') {
        briefFrames++;
        if (typeT < INTEL_EN.length * 2.2) { typeT += dt * 90; api._type(); }
        // comm visualiser: follows LEDGER's voice level when audio runs (hud.js voiceLevels);
        // deterministic speech envelope otherwise (clock = typewriter time, frozen in captures)
        const au = game.audio, live = !!(au && au.unlocked && au.level);
        const talking = game.manual || typeT < INTEL_EN.length * 1.05;
        voiceLevels(vizLv, live ? au.level() : 0, live, talking, game.manual ? 1.37 : typeT / 90, game.manual ? 0 : dt);
        for (let i = 0; i < vizBars.length; i++) {
          const q = Math.round(vizLv[i] * 50);
          if (vizQ[i] !== q) { vizQ[i] = q; vizBars[i].style.transform = `scaleY(${q / 50})`; }
        }
      }
      if (current === 'title' && introT < 4) {
        introT += dt;
        const s = screens.title;
        const k = ease((introT - 0.2) / 1.1);
        s.style.setProperty('--intro', k.toFixed(3));
      } else if (current === 'title' && introT >= 4) screens.title.style.setProperty('--intro', '1');
    },
    _onAction(e) {
      const st = game.state;
      const scr = current && screens[current];
      const visible = scr && scr.style.display !== 'none' && st !== 'playing';
      if (current === 'options' && visible) {
        if (e.action === 'pause') { game.audio.play('ui_select'); api.closeOptions(); return; }
        const i = sel.options || 0;
        if (i < OPTIONS.length && (e.action === 'look_left' || e.action === 'move_left')) { api.adjustOption(i, -1, false); return; }
        if (i < OPTIONS.length && (e.action === 'look_right' || e.action === 'move_right')) { api.adjustOption(i, 1, false); return; }
      }
      if (e.action === 'pause') {
        if (st === 'playing') game.setState('paused');
        else if (st === 'paused') api.resume();
        else if (current === 'briefing' || current === 'controls') { game.audio.play('ui_select'); api.show('title'); }
      } else if (visible && (e.action === 'look_up' || e.action === 'move_forward')) select(current, (sel[current] || 0) - 1, true);
      else if (visible && (e.action === 'look_down' || e.action === 'move_back')) select(current, (sel[current] || 0) + 1, true);
      else if (e.action === 'confirm' || (e.source === 'gamepad' && e.code === 'Pad0')) {
        if (!visible) return;
        const L = lists[current];
        const b = L && L[sel[current] || 0];
        if (b) b.click();
      }
    },
  };
  return api;
}

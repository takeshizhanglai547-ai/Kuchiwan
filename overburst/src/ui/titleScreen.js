// ============================================================
//  ui/titleScreen.js — title / mission-briefing screen.
//  Static DOM built once at init; no per-frame work except the
//  caret blink which is pure CSS.
//  Starts the mission through ctx.game.startMission().
// ============================================================
import { CFG } from '../config.js';
import { h, q, group } from './dom.js';
import { WEAPON_ICONS, MAP_SVG, FRAME_SVG, THREAT_SIL } from './icons.js';

const LOADOUT = [
  { slot: 'R-ARM',  key: 'rifle',   cfg: 'RIFLE',   cls: 'BURST RIFLE' },
  { slot: 'L-ARM',  key: 'blade',   cfg: 'BLADE',   cls: 'PULSE BLADE' },
  { slot: 'R-BACK', key: 'missile', cfg: 'MISSILE', cls: 'VERT. MISSILE RACK' },
  { slot: 'L-BACK', key: 'cannon',  cfg: 'CANNON',  cls: 'PLASMA SIEGE CANNON' },
];

const CONTROLS = [
  ['MOVE', 'W A S D'],
  ['BOOST / QUICK BOOST', 'SHIFT'],
  ['ASCEND / HOVER', 'SPACE'],
  ['DESCEND', 'CTRL'],
  ['LOOK / AIM', 'MOUSE'],
  ['R-ARM  RIFLE', 'LMB'],
  ['L-ARM  BLADE', 'RMB'],
  ['R-BACK MISSILE', 'E'],
  ['L-BACK CANNON', 'Q'],
  ['HARD LOCK', 'TAB'],
  ['REPAIR KIT', 'V'],
];

// Hostiles expected on site. `ap` reads straight off CFG so the manifest can
// never drift from what the mission actually spawns.
const THREATS = [
  { k: 'mt',     code: 'MT-A21',  name: 'SLAGHAND', cfg: 'MT',     thr: 2 },
  { k: 'drone',  code: 'AD-08',   name: 'CINDER',   cfg: 'DRONE',  thr: 1 },
  { k: 'turret', code: 'AT-44',   name: 'PICKET',   cfg: 'TURRET', thr: 2 },
  { k: 'heli',   code: 'RH-19',   name: 'KESTREL',  cfg: 'HELI',   thr: 3 },
  { k: 'pylon',  code: 'IB-C10',  name: 'PYLON',    cfg: 'PYLON',  thr: 0 },
  { k: 'boss',   code: 'AC 04',   name: 'CROWNBREAKER', cfg: 'BOSS', thr: 5 },
];

const PAY = [
  ['BASE', 410000],
  ['CROWN CLEAR', 90000],
  ['FRAME WEAR', -32000],
];

function ammoOf(k, w) {
  if (k === 'rifle') return w.magazine + '/' + w.ammo;
  if (k === 'blade') return 'MELEE';
  if (k === 'missile') return w.count + ' / ' + w.ammo;
  return String(w.ammo);
}

export class TitleScreen {
  constructor(ctx) {
    this.ctx = ctx;
    this.el = null;
  }

  build() {
    const M = CFG.MISSION;
    const P = CFG.PLAYER;

    let rows = '';
    for (let i = 0; i < LOADOUT.length; i++) {
      const L = LOADOUT[i];
      const w = CFG.WEAPONS[L.cfg] || {};
      rows +=
        '<tr>' +
        '<td class="eq-ic">' + (WEAPON_ICONS[L.key] || '') + '</td>' +
        '<td class="slot">' + L.slot + '</td>' +
        '<td class="unit">' + (w.name || '--') + '</td>' +
        '<td class="cls">' + L.cls + '</td>' +
        '<td class="n">' + (w.damage || 0) + '</td>' +
        '<td class="n">' + (w.impact || 0) + '</td>' +
        '<td class="n">' + (w.acs || 0) + '</td>' +
        '<td class="n">' + ammoOf(L.key, w) + '</td>' +
        '</tr>';
    }

    let ctl = '';
    for (let i = 0; i < CONTROLS.length; i++) {
      ctl += '<dt>' + CONTROLS[i][0] + '</dt><dd><kbd>' + CONTROLS[i][1] + '</kbd></dd>';
    }

    // ---- threat manifest ----
    let thr = '';
    for (let i = 0; i < THREATS.length; i++) {
      const T = THREATS[i];
      const E = CFG.ENEMY[T.cfg] || {};
      let pips = '';
      for (let j = 0; j < 5; j++) pips += '<s' + (j < T.thr ? ' class="on"' : '') + '></s>';
      thr +=
        '<div class="thr-r' + (T.k === 'boss' ? ' ac' : '') + '">' +
        '<s class="sil">' + (THREAT_SIL[T.k] || '') + '</s>' +
        '<b>' + T.code + '</b><span>' + T.name + '</span>' +
        '<i class="thr-p">' + pips + '</i>' +
        '<em>' + group(E.ap || 0) + '</em>' +
        '</div>';
    }

    // ---- payment breakdown ----
    let pay = '', total = 0;
    for (let i = 0; i < PAY.length; i++) {
      total += PAY[i][1];
      pay += '<div class="pay-r"><u>' + PAY[i][0] + '</u><s></s><b>' +
        (PAY[i][1] < 0 ? '-' : '') + group(Math.abs(PAY[i][1])) + '</b></div>';
    }
    pay += '<div class="pay-r tot"><u>ON COMPLETION</u><s></s><b>' + group(total) + ' c</b></div>';

    const el = h(
      '<div id="title-screen">' +
      '<div class="scan"></div>' +

      '<div class="t-top">' +
        '<span class="lbl">TACTICAL INTERFACE // FRAME LINK ESTABLISHED</span>' +
        '<span class="rule"></span>' +
        '<span class="lbl">' + M.ID + ' &nbsp;/&nbsp; STANDBY</span>' +
      '</div>' +

      '<div class="t-mid">' +

      '<div class="t-brand">' +
        '<span class="t-logo">OVERBURST</span>' +
        '<div class="t-sub">ARMORED ASSAULT <b>//</b> ' + M.CODENAME + '</div>' +
        '<div class="t-brandrule">' +
          '<span>SINGLE SORTIE &nbsp;·&nbsp; FIXED FRAME &nbsp;·&nbsp; NO RESUPPLY</span>' +
          '<span class="rule"></span></div>' +
      '</div>' +

      '<div class="t-cols">' +

        '<div class="pn fr">' +
          '<div class="pn-h"><b>MISSION BRIEFING</b><i>CLASSIFIED / B-2</i></div>' +
          '<div class="pn-b">' +
            '<div class="br-code"><b>' + M.ID + '</b><span>' + M.CODENAME + '</span></div>' +
            '<dl class="kv">' +
              '<dt>AREA</dt><dd>BASHO SMELTING BELT, RUBICON 3</dd>' +
              '<dt>CLIENT</dt><dd>BASHO RECLAMATION AUTHORITY</dd>' +
              '<dt>OPPOSING</dt><dd>SLAG CROWN GARRISON</dd>' +
              '<dt>LIMIT</dt><dd>' + Math.floor(M.TIME_LIMIT / 60) + ':00 &nbsp;·&nbsp; NO RESUPPLY</dd>' +
            '</dl>' +
            '<p class="br-txt">The refinery never stopped burning. Its crown of slag towers ' +
            'still feeds the furnace under the basin, and the garrison has turned the whole ' +
            'complex into a firebase — pickets on the gantries, armour in the container yard. ' +
            'Burn the coolant pylons, break what defends them, and hold the crown until ' +
            'extraction. <em>Do not stall in the open.</em></p>' +
            '<div class="sub-h"><span>DEPLOYMENT — BASIN GRID 04</span><s></s></div>' +
            '<div class="figw map">' + MAP_SVG + '</div>' +
            '<div class="mleg">' +
              '<span class="l-py">COOLANT PYLON &#215;' + M.PYLONS + '</span>' +
              '<span class="l-cr">SLAG CROWN</span>' +
              '<span class="l-in">INSERTION VECTOR</span>' +
              '<span class="l-wl">KILL WALL ' + CFG.ARENA.WALL + ' M</span>' +
            '</div>' +
            '<div class="sub-h"><span>SETTLEMENT</span><s></s></div>' +
            '<div class="pay">' + pay + '</div>' +
          '</div>' +
          '<div class="pn-f"><span>▸</span>EXTRACTION AUTHORISED ON CROWN CLEAR</div>' +
        '</div>' +

        '<div class="pn fr">' +
          '<div class="pn-h"><b>ISSUED EQUIPMENT</b><i>ASSEMBLY LOCKED</i></div>' +
          '<div class="pn-b">' +
            '<div class="eq-frame">' +
              '<b>FRAME &nbsp; OB-01 OVERBURST</b>' +
              '<span>AP <i>' + group(P.AP) + '</i></span>' +
              '<span>EN <i>' + group(P.EN_CAP) + '</i></span>' +
              '<span>ACS <i>' + group(P.ACS_CAP) + '</i></span>' +
              '<span>KITS <i>' + P.REPAIR_KITS + '</i></span>' +
            '</div>' +
            '<table class="eq"><thead><tr>' +
              '<th></th><th>SLOT</th><th>UNIT</th><th>CLASS</th>' +
              '<th class="n">ATK</th><th class="n">IMP</th><th class="n">ACS</th><th class="n">AMMO</th>' +
            '</tr></thead><tbody>' + rows + '</tbody></table>' +
            '<div class="eq-split">' +
              '<div class="figw schem">' + FRAME_SVG + '</div>' +
              '<div class="eq-side">' +
                '<div class="sub-h"><span>MOBILITY</span><s></s></div>' +
                '<dl class="kv kv2">' +
                  '<dt>BOOST</dt><dd>' + P.BOOST_SPEED + ' M/S</dd>' +
                  '<dt>ASSAULT</dt><dd>' + P.AB_SPEED + ' M/S</dd>' +
                  '<dt>QB IMPULSE</dt><dd>' + P.QB_IMPULSE + ' &nbsp;·&nbsp; ' + P.QB_EN_COST + ' EN</dd>' +
                  '<dt>QB RELOAD</dt><dd>' + P.QB_RELOAD.toFixed(2) + ' S</dd>' +
                  '<dt>EN REGEN</dt><dd>' + group(P.EN_RECHARGE) + ' /S GROUND</dd>' +
                  '<dt>CEILING</dt><dd>' + group(CFG.ARENA.CEILING) + ' M</dd>' +
                '</dl>' +
                '<div class="eq-note"><s></s><p>LOADOUT FIXED BY CONTRACT</p></div>' +
                '<div class="eq-note2">This frame ships as issued. No garage, no parts shop, ' +
                'no respec — the sortie is the build. Learn these four units.</div>' +
              '</div>' +
            '</div>' +
          '</div>' +
          '<div class="pn-f"><span>▸</span>ACS STRAIN STAGGERS TARGETS — IMPACT IS THE OTHER DAMAGE</div>' +
        '</div>' +

        '<div class="pn fr">' +
          '<div class="pn-h"><b>CONTROLS</b><i>KB / M</i></div>' +
          '<div class="pn-b">' +
            '<dl class="ctl">' + ctl + '</dl>' +
            '<div class="sub-h opt"><span>ENGAGEMENT DATA</span><s></s></div>' +
            '<dl class="kv sortie opt">' +
              '<dt>LOCK</dt><dd>' + CFG.LOCK.RANGE + ' M</dd>' +
              '<dt>ACS CAP</dt><dd>' + group(P.ACS_CAP) + ' STRAIN</dd>' +
              '<dt>STAGGER</dt><dd>' + P.STAGGER_TIME.toFixed(1) + ' S LOCKOUT</dd>' +
              '<dt>DIRECT</dt><dd>&#215;' + P.DIRECT_HIT_MULT.toFixed(2) + ' STAGGERED</dd>' +
              '<dt>REPAIR</dt><dd>' + P.REPAIR_KITS + ' &#215; ' + group(P.REPAIR_AMOUNT) + ' AP</dd>' +
            '</dl>' +
            '<div class="sub-h"><span>THREAT MANIFEST</span><s></s><i>AP</i></div>' +
            '<div class="thr">' + thr + '</div>' +
          '</div>' +
          '<div class="pn-f"><span>▸</span>QUICK BOOST IS THE WHOLE GAME</div>' +
        '</div>' +

      '</div>' +
      '</div>' +

      '<div class="t-foot">' +
        '<button id="btn-start" type="button">START MISSION</button>' +
        '<span class="t-hint"><b class="blink">&#9656;</b> CLICK OR PRESS <b>ENTER</b> TO LAUNCH</span>' +
        '<span class="rule"></span>' +
        '<span class="t-ver">BUILD 3.17 / OB-CORE</span>' +
      '</div>' +

      '</div>',
    );

    this.el = el;
    this.btn = q(el, '#btn-start');
    this.btn.addEventListener('click', (e) => this._launch(e && e.isTrusted));
    this._onKey = (e) => {
      if (this.ctx.state !== 'title') return;
      if (e.code === 'Enter' || e.code === 'NumpadEnter') { e.preventDefault(); this._launch(true); }
    };
    window.addEventListener('keydown', this._onKey);
    return el;
  }

  _launch(trusted) {
    const ctx = this.ctx;
    if (ctx.state !== 'title') return;
    try { ctx.game.startMission(); } catch (e) { /* never let the UI hard-fail */ }
    if (trusted) { try { ctx.input.requestLock(); } catch (e) { /* ignore */ } }
  }

  show(on) { if (this.el) this.el.classList.toggle('hidden', !on); }
}

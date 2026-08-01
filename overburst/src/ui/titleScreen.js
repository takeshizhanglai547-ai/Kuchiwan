// ============================================================
//  ui/titleScreen.js — title / mission-briefing screen.
//  Static DOM built once at init; no per-frame work except the
//  caret blink which is pure CSS.
//  Starts the mission through ctx.game.startMission().
// ============================================================
import { CFG } from '../config.js';
import { h, q, group } from './dom.js';
import { WEAPON_ICONS } from './icons.js';

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
              '<dt>PAYMENT</dt><dd>410,000 c</dd>' +
              '<dt>LIMIT</dt><dd>' + Math.floor(M.TIME_LIMIT / 60) + ':00</dd>' +
            '</dl>' +
            '<p class="br-txt">The refinery never stopped burning. Its crown of slag towers ' +
            'still feeds the furnace under the basin, and the garrison has turned the whole ' +
            'complex into a firebase — pickets on the gantries, armour in the container yard.<br><br>' +
            'Burn the coolant pylons, break what defends them, and hold the crown until ' +
            'extraction. Expect a hostile AC on site. <em>Do not stall in the open.</em></p>' +
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
            '<div class="eq-note"><s></s><p>LOADOUT FIXED BY CONTRACT — NO FIELD ASSEMBLY</p></div>' +
            '<div class="eq-note2">This frame ships as issued. There is no garage, no parts shop and ' +
            'no respec: the sortie is the build. Learn these four units.</div>' +
          '</div>' +
          '<div class="pn-f"><span>▸</span>ACS STRAIN STAGGERS TARGETS — IMPACT IS THE OTHER DAMAGE</div>' +
        '</div>' +

        '<div class="pn fr">' +
          '<div class="pn-h"><b>CONTROLS</b><i>KB / M</i></div>' +
          '<div class="pn-b"><dl class="ctl">' + ctl + '</dl></div>' +
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

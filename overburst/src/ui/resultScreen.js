// ============================================================
//  ui/resultScreen.js — MISSION COMPLETE / MISSION FAILED report.
//  AC-style debrief: elapsed time, damage dealt/taken, kills,
//  staggers, repair kits, letter rank, RETRY / ABORT.
// ============================================================
import { CFG } from '../config.js';
import { h, q, setText, tog, group, mmssd } from './dom.js';

const ROWS = [
  ['TIME ELAPSED',      'time'],
  ['DAMAGE DEALT',      'dealt'],
  ['DAMAGE TAKEN',      'taken'],
  ['TARGETS DESTROYED', 'kills'],
  ['STAGGERS INDUCED',  'staggers'],
  ['REPAIR KITS USED',  'kits'],
];

export class ResultScreen {
  constructor(ctx) { this.ctx = ctx; this.el = null; this.rows = {}; }

  build() {
    let body = '';
    for (let i = 0; i < ROWS.length; i++) {
      body += '<div class="rs-row" data-k="' + ROWS[i][1] + '"><u>' + ROWS[i][0] + '</u><s></s><b>--</b></div>';
    }

    const el = h(
      '<div id="result-screen" class="hidden">' +
        '<div class="scan"></div>' +
        '<div class="rs fr">' +
          '<div class="rs-h"><b>MISSION COMPLETE</b>' +
            '<span>' + CFG.MISSION.ID + ' &nbsp;//&nbsp; ' + CFG.MISSION.CODENAME + '</span></div>' +
          '<div class="rs-b">' +
            '<div class="lbl">COMBAT LOG</div>' + body +
            '<div class="rs-rank"><span>EVALUATION</span><b>-</b></div>' +
          '</div>' +
          '<div class="rs-f">' +
            '<button id="btn-retry" type="button">RETRY</button>' +
            '<button id="btn-title" class="alt" type="button">ABORT TO TITLE</button>' +
          '</div>' +
        '</div>' +
      '</div>',
    );

    this.el = el;
    this.head = q(el, '.rs-h');
    this.headTxt = q(el, '.rs-h b');
    this.rankEl = q(el, '.rs-rank');
    this.rankTxt = q(el, '.rs-rank b');
    const rs = el.querySelectorAll('.rs-row b');
    for (let i = 0; i < ROWS.length; i++) this.rows[ROWS[i][1]] = rs[i];

    q(el, '#btn-retry').addEventListener('click', (e) => {
      try { this.ctx.game.startMission(); } catch (err) { /* ignore */ }
      if (e && e.isTrusted) { try { this.ctx.input.requestLock(); } catch (err) { /* ignore */ } }
    });
    q(el, '#btn-title').addEventListener('click', () => {
      try { this.ctx.input.exitLock(); } catch (err) { /* ignore */ }
      try { this.ctx.game.setState('title'); } catch (err) { /* ignore */ }
    });
    return el;
  }

  show(on) { if (this.el) this.el.classList.toggle('hidden', !on); }

  /** stats = { time, dealt, taken, kills, staggers, kits, apFrac } */
  present(win, s) {
    setText(this.headTxt, win ? 'MISSION COMPLETE' : 'MISSION FAILED');
    tog(this.head, 'fail', !win);

    setText(this.rows.time, mmssd(s.time || 0));
    setText(this.rows.dealt, group(s.dealt || 0));
    setText(this.rows.taken, group(s.taken || 0));
    setText(this.rows.kills, String(s.kills || 0));
    setText(this.rows.staggers, String(s.staggers || 0));
    setText(this.rows.kits, String(s.kits || 0));

    const rank = this._rank(win, s);
    setText(this.rankTxt, rank);
    tog(this.rankEl, 's', rank === 'S');
    tog(this.rankEl, 'd', rank === 'D' || rank === 'E');
  }

  _rank(win, s) {
    const lim = CFG.MISSION.TIME_LIMIT || 600;
    const apMax = CFG.PLAYER.AP || 1;
    let v = 0;
    v += Math.min(38, (s.kills || 0) * 5.5);                       // aggression
    v += Math.min(16, (s.staggers || 0) * 3.2);                    // control
    v += Math.min(26, (1 - Math.min(1, (s.taken || 0) / apMax)) * 26); // survivability
    v += Math.min(20, (1 - Math.min(1, (s.time || 0) / lim)) * 20);    // speed
    v -= (s.kits || 0) * 3;
    if (!win) v *= 0.42;
    return v >= 88 ? 'S' : v >= 76 ? 'A' : v >= 60 ? 'B' : v >= 42 ? 'C' : v >= 22 ? 'D' : 'E';
  }
}

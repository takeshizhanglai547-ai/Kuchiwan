// ============================================================
//  ui/combatHud.js — the in-mission panels.
//    · vitals   : segmented AP bar + numerics, EN bar w/ overload,
//                 QB reload pips, repair-kit pips
//    · weapons  : 4 slot rows (R-ARM/L-ARM/R-BACK/L-BACK)
//    · objectives : mission code, objective lines, timer
//    · target   : enemy name, AP bar, ACS strain gauge, STAGGER
//    · radio    : typed-in chatter line
//    · warnings : top/bottom edge bars
//    · banner   : short centre callout
//
//  Every read of another system is guarded — they may still be stubs.
//  All refs cached; only changed values are written to the DOM.
// ============================================================
import { CFG } from '../config.js';
import { h, q, setText, setSX, setSY, setOp, setTF, tog, pad, group, mmss, clamp01 } from './dom.js';
import { WEAPON_ICONS } from './icons.js';

const SLOTS = [
  { key: 'rifle',   tag: 'R-ARM',  cfg: 'RIFLE'   },
  { key: 'blade',   tag: 'L-ARM',  cfg: 'BLADE'   },
  { key: 'missile', tag: 'R-BACK', cfg: 'MISSILE' },
  { key: 'cannon',  tag: 'L-BACK', cfg: 'CANNON'  },
];

const OB_MARK = { active: '▸', done: '✓', failed: '×', pending: '·' };
const QB_PIPS = 6;
const RANK = { info: 0, warn: 1, danger: 2 };

export class CombatHud {
  constructor(ctx) {
    this.ctx = ctx;
    this.el = null;
    this._apGhost = 1;
    this._rl = { rifle: 0, missile: 0, cannon: 0, blade: 0 };
    this._objSig = '';
    this._objRows = [];
    this._radioQ = [];
    this._radio = null;
    this._warn = null;
    this._banner = null;
    this._t = 0;
  }

  // ------------------------------------------------------------------
  build() {
    let wrows = '';
    for (let i = 0; i < SLOTS.length; i++) {
      const S = SLOTS[i];
      const w = CFG.WEAPONS[S.cfg] || {};
      wrows +=
        '<div class="w-row" data-k="' + S.key + '">' +
          '<div class="w-ic">' + (WEAPON_ICONS[S.key] || '') + '<s class="chg"></s></div>' +
          '<div class="w-slot">' + S.tag + '</div>' +
          '<div class="w-name">' + (w.name || '--') + '</div>' +
          '<div class="w-amt"><b></b><small></small></div>' +
          '<div class="w-sweep"><i></i></div>' +
        '</div>';
    }

    let pips = '';
    for (let i = 0; i < QB_PIPS; i++) pips += '<s></s>';
    let kits = '';
    for (let i = 0; i < (CFG.PLAYER.REPAIR_KITS || 0); i++) kits += '<s></s>';

    const el = h(
      '<div id="combat-hud">' +

      /* ---- top-left objectives ---- */
      '<div id="objectives" class="fr">' +
        '<div class="ob-h"><b>' + CFG.MISSION.ID + '</b><span>' + CFG.MISSION.CODENAME + '</span></div>' +
        '<div class="ob-list"></div>' +
        '<div class="ob-t"><span>MISSION TIME</span><b>--:--</b></div>' +
      '</div>' +

      /* ---- top-centre target readout ---- */
      '<div id="target" class="hidden">' +
        '<div class="fr">' +
          '<div class="tg-h"><u>TARGET</u><b></b><em></em></div>' +
          '<div class="tg-bars">' +
            '<div class="tg-aprow">' +
              '<div id="tg-ap" class="bar"><div class="bar-in"><i class="fill"></i></div></div>' +
              '<span class="tg-apn mono"></span>' +
            '</div>' +
            '<div class="tg-acs"><span>ACS</span>' +
              '<div id="tg-acs" class="bar"><div class="bar-in"><i class="fill"></i></div></div>' +
              '<span id="tg-stag">STAGGER</span>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>' +

      /* ---- bottom-left vitals ---- */
      '<div id="vitals">' +
        '<div class="v-head">' +
          '<span class="tag">AP</span><span class="num">0</span><span class="den">/0</span>' +
          '<span class="st"></span>' +
        '</div>' +
        '<div id="ap-bar" class="bar"><div class="bar-in">' +
          '<i class="ghost"></i><i class="fill"></i>' +
        '</div></div>' +
        '<div id="p-acs" class="bar"><div class="bar-in"><i class="fill"></i></div>' +
          '<div id="p-stag" class="hidden">ACS FAILURE</div></div>' +
        '<div class="en-row">' +
          '<span class="tag">EN</span>' +
          '<div id="en-bar" class="bar"><div class="bar-in"><i class="fill"></i></div>' +
            '<div id="en-ovl" class="hidden">EN OVERLOAD</div></div>' +
          '<span class="num mono">0</span>' +
        '</div>' +
        '<div class="qb-row">' +
          '<span class="tag">QB</span>' +
          '<div id="qb-pips">' + pips + '</div>' +
          '<div class="kits"><span>KIT</span>' + kits + '</div>' +
        '</div>' +
      '</div>' +

      /* ---- bottom-right weapons ---- */
      '<div id="weapons" class="fr">' +
        '<div class="pn-h"><b>ARMAMENT</b><i>FIXED</i></div>' +
        wrows +
      '</div>' +

      /* ---- radio ---- */
      '<div id="radio"><div class="rd-in fr"><u></u><b></b></div></div>' +

      /* ---- banner ---- */
      '<div id="banner"><b></b><span></span></div>' +

      /* ---- edge warnings ---- */
      '<div id="warn-top" class="warnbar"><s class="glow"></s><b></b><b></b></div>' +
      '<div id="warn-bot" class="warnbar"><s class="glow"></s><b></b><b></b></div>' +

      '</div>',
    );

    // ---- cache refs ----
    this.el = el;
    this.vit = q(el, '#vitals');
    this.apNum = q(el, '#vitals .v-head .num');
    this.apDen = q(el, '#vitals .v-head .den');
    this.apSt = q(el, '#vitals .v-head .st');
    this.apBar = q(el, '#ap-bar');
    this.apFill = q(el, '#ap-bar .fill');
    this.apGhost = q(el, '#ap-bar .ghost');
    this.acsFill = q(el, '#p-acs .fill');
    this.acsStag = q(el, '#p-stag');
    this.enFill = q(el, '#en-bar .fill');
    this.enNum = q(el, '.en-row .num');
    this.enOvl = q(el, '#en-ovl');
    this.qbPips = q(el, '#qb-pips').children;
    this.kitPips = q(el, '#vitals .kits').querySelectorAll('s');

    this.wRows = [];
    const rowEls = el.querySelectorAll('.w-row');
    for (let i = 0; i < rowEls.length; i++) {
      const r = rowEls[i];
      this.wRows.push({
        key: SLOTS[i].key, cfg: CFG.WEAPONS[SLOTS[i].cfg] || {}, el: r,
        amt: r.querySelector('.w-amt b'),
        sub: r.querySelector('.w-amt small'),
        sweep: r.querySelector('.w-sweep i'),
        chg: r.querySelector('.chg'),
      });
    }

    this.obEl = q(el, '#objectives');
    this.obList = q(el, '.ob-list');
    this.obTime = q(el, '.ob-t b');

    this.tgEl = q(el, '#target');
    this.tgName = q(el, '.tg-h b');
    this.tgDist = q(el, '.tg-h em');
    this.tgAp = q(el, '#tg-ap .fill');
    this.tgApN = q(el, '.tg-apn');
    this.tgAcs = q(el, '#tg-acs .fill');

    this.rdEl = q(el, '#radio');
    this.rdWho = q(el, '.rd-in u');
    this.rdTxt = q(el, '.rd-in b');

    this.bnEl = q(el, '#banner');
    this.bnTxt = q(el, '#banner b');
    this.bnSub = q(el, '#banner span');

    this.wTop = q(el, '#warn-top');
    this.wBot = q(el, '#warn-bot');
    this.wTopA = this.wTop.querySelectorAll('b');
    this.wBotA = this.wBot.querySelectorAll('b');

    return el;
  }

  show(on) { if (this.el) this.el.classList.toggle('hidden', !on); }

  reset() {
    this._apGhost = 1;
    this._rl.rifle = this._rl.missile = this._rl.cannon = this._rl.blade = 0;
    this._objSig = '';
    this._objRows.length = 0;
    if (this.obList) this.obList.innerHTML = '';
    this._radioQ.length = 0;
    this._radio = null;
    this._warn = null;
    this._banner = null;
    setOp(this.bnEl, 0);
    tog(this.rdEl, 'on', false);
    tog(this.wTop, 'on', false);
    tog(this.wBot, 'on', false);
  }

  // ------------------------------------------------------------------
  //  public pushes (driven by HUD from bus events)
  // ------------------------------------------------------------------
  radio(speaker, text, dur) {
    if (!text) return;
    if (this._radioQ.length > 5) this._radioQ.shift();
    this._radioQ.push({
      who: String(speaker || 'RADIO'),
      txt: String(text),
      hold: dur || (2.4 + String(text).length * 0.026),
    });
  }

  /**
   * Edge warning bars.
   *   level : 'info' (cyan) | 'warn' (amber) | 'danger' (red, default)
   *   id    : channel key — a later warning on the same channel replaces it;
   *           a different channel only takes over at equal-or-higher severity.
   */
  warn(text, dur, level, id) {
    if (!text) return;
    const lv = level === true ? 'warn' : (level === false ? 'danger' : (RANK[level] != null ? level : 'danger'));
    const w = this._warn;
    if (w && w.t > 0 && w.id && id && w.id !== id && RANK[w.level] > RANK[lv]) return;
    this._warn = {
      txt: String(text),
      t: dur == null ? (lv === 'info' ? 1.3 : 2.2) : dur,
      level: lv, id: id || '',
    };
  }

  banner(text, sub, dur) {
    if (!text) return;
    this._banner = { txt: String(text), sub: sub ? String(sub) : '', t: 0, dur: dur || 1.8 };
  }

  // ------------------------------------------------------------------
  update(dt, target) {
    this._t += dt;
    this._vitals(dt);
    this._weapons(dt);
    this._objectives(dt);
    this._target(target);
    this._radioTick(dt);
    this._warnTick(dt);
    this._bannerTick(dt);
  }

  // ---- AP / EN / QB / kits -----------------------------------------
  _vitals(dt) {
    const p = this.ctx.player || {};
    const CP = CFG.PLAYER;

    const apMax = (typeof p.apMax === 'number' && p.apMax > 0) ? p.apMax : CP.AP;
    let ap = typeof p.ap === 'number' ? p.ap : apMax;
    if (!isFinite(ap)) ap = 0;
    ap = ap < 0 ? 0 : ap > apMax ? apMax : ap;
    const f = ap / apMax;

    setSX(this.apFill, f);
    // delayed red "ghost" of recently lost AP
    if (this._apGhost < f) this._apGhost = f;
    else if (this._apGhost > f) this._apGhost = Math.max(f, this._apGhost - dt * 0.30);
    setSX(this.apGhost, this._apGhost);

    setText(this.apNum, group(ap));
    setText(this.apDen, '/' + group(apMax));
    tog(this.vit, 'warn', f < 0.40 && f >= 0.20);
    tog(this.vit, 'crit', f < 0.20);

    // status word
    let st = 'GROUND';
    if (p.staggered) st = 'ACS FAILURE';
    else if (p.abActive) st = 'ASSAULT BOOST';
    else if (p.grounded === false) st = 'AIRBORNE';
    else if (p.boosting) st = 'BOOST';
    setText(this.apSt, st);

    // --- player ACS strain (thin strip hugging the AP bar) ---
    const acsMax = (typeof p.acsMax === 'number' && p.acsMax > 0) ? p.acsMax : (CP.ACS_CAP || 1);
    const acsF = clamp01((typeof p.acs === 'number' ? p.acs : 0) / acsMax);
    setSX(this.acsFill, acsF);
    tog(this.acsStag, 'hidden', !p.staggered);

    // --- EN ---
    const enMax = (typeof p.enMax === 'number' && p.enMax > 0) ? p.enMax : CP.EN_CAP;
    let en = typeof p.en === 'number' ? p.en : enMax;
    if (!isFinite(en)) en = 0;
    en = en < 0 ? 0 : en > enMax ? enMax : en;
    const ef = en / enMax;
    setSX(this.enFill, ef);
    setText(this.enNum, String(Math.round(en)));

    const ovl = p.enOverload === true || p.overload === true || p.redline === true ||
      (typeof p.redlineTimer === 'number' && p.redlineTimer > 0) || ef <= 0.004;
    tog(this.vit, 'enovl', ovl);
    tog(this.vit, 'enlow', !ovl && ef < 0.22);
    tog(this.enOvl, 'hidden', !ovl);

    // --- QB reload pips ---
    let qb;
    if (typeof p.qbCharge === 'number') qb = clamp01(p.qbCharge);
    else if (typeof p.qbCooldown === 'number') qb = clamp01(1 - p.qbCooldown / (CP.QB_RELOAD || 1));
    else if (typeof p.qbTimer === 'number') qb = clamp01(1 - p.qbTimer / (CP.QB_RELOAD || 1));
    else qb = 1;
    const afford = !ovl && en >= (CP.QB_EN_COST || 0);
    const lit = afford ? Math.round(qb * QB_PIPS) : 0;
    for (let i = 0; i < this.qbPips.length; i++) tog(this.qbPips[i], 'on', i < lit);

    // --- repair kits ---
    const kits = typeof p.repairKits === 'number' ? p.repairKits : (CP.REPAIR_KITS || 0);
    for (let i = 0; i < this.kitPips.length; i++) tog(this.kitPips[i], 'on', i < kits);
  }

  // ---- weapon panel -------------------------------------------------
  _weapons(dt) {
    const W = (this.ctx.weapons && this.ctx.weapons.state) || null;
    for (let i = 0; i < this.wRows.length; i++) {
      const r = this.wRows[i];
      const s = (W && W[r.key]) || null;
      let primary = '--', sub = '', ready = false, empty = false, reloading = false;
      let sweep = 1, charge = 0;

      if (r.key === 'rifle') {
        const mag = s && typeof s.mag === 'number' ? s.mag : (r.cfg.magazine || 0);
        const ammo = s && typeof s.ammo === 'number' ? s.ammo : (r.cfg.ammo || 0);
        reloading = !!(s && s.reloading);
        primary = pad(Math.max(0, mag), 2);
        sub = '/' + ammo;
        empty = ammo <= 0 && mag <= 0;
        ready = !reloading && mag > 0;
        sweep = this._sweep('rifle', s, reloading, r.cfg.reloadTime || 1, dt);
      } else if (r.key === 'blade') {
        const cd = s && typeof s.cooldown === 'number' ? Math.max(0, s.cooldown) : 0;
        const cdMax = r.cfg.cooldown || 1;
        ready = cd <= 0.001;
        primary = ready ? 'READY' : cd.toFixed(1);
        sweep = ready ? 1 : clamp01(1 - cd / cdMax);
        if (s && typeof s.charge === 'number' && s.charge > 0) charge = clamp01(s.charge);
      } else if (r.key === 'missile') {
        const ammo = s && typeof s.ammo === 'number' ? s.ammo : (r.cfg.ammo || 0);
        const cap = r.cfg.count || 6;
        const racked = s && typeof s.racked === 'number' ? s.racked : Math.min(cap, ammo);
        reloading = !!(s && s.reloading);
        primary = pad(Math.max(0, racked), 2);
        sub = '/' + ammo;
        empty = ammo <= 0;
        ready = !reloading && ammo > 0;
        sweep = this._sweep('missile', s, reloading, r.cfg.reload || 1, dt);
        const locks = s && s.locks && s.locks.length ? s.locks.length : 0;
        if (locks) sub = '/' + ammo + '  x' + locks;
      } else { // cannon
        const ammo = s && typeof s.ammo === 'number' ? s.ammo : (r.cfg.ammo || 0);
        const cd = s && typeof s.cooldown === 'number' ? Math.max(0, s.cooldown) : 0;
        primary = pad(Math.max(0, ammo), 2);
        empty = ammo <= 0;
        ready = cd <= 0.001 && ammo > 0;
        sweep = cd <= 0 ? 1 : clamp01(1 - cd / (r.cfg.cooldown || 1));
        let ch = s && typeof s.charge === 'number' ? s.charge : 0;
        if (ch > 1.0001) ch = ch / (r.cfg.chargeTime || 1);
        charge = clamp01(ch);
      }

      setText(r.amt, primary);
      setText(r.sub, sub);
      setSX(r.sweep, sweep);
      setSY(r.chg, charge);
      tog(r.el, 'ready', ready);
      tog(r.el, 'empty', empty);
      tog(r.el, 'reloading', reloading);
      tog(r.el, 'charging', charge > 0.01);
    }
  }

  /** Reload sweep 0..1 — uses the weapon system's own progress if it exposes one. */
  _sweep(key, s, reloading, total, dt) {
    if (s) {
      if (typeof s.reloadProgress === 'number') return clamp01(s.reloadProgress);
      if (typeof s.reloadT === 'number' && total > 0) return clamp01(1 - s.reloadT / total);
    }
    if (reloading) {
      this._rl[key] = Math.min(1, this._rl[key] + dt / (total || 1));
      return this._rl[key];
    }
    this._rl[key] = 0;
    return 1;
  }

  // ---- objectives + timer -------------------------------------------
  _objectives() {
    const m = this.ctx.mission || null;
    const list = (m && m.objectives && m.objectives.length) ? m.objectives : null;

    // rebuild only when the objective set actually changes — signature is
    // rechecked on a slow cadence so this never allocates every frame.
    if ((this.ctx.frame & 7) === 0 || !this._objRows.length) {
    let sig = '';
    if (list) for (let i = 0; i < list.length; i++) sig += (list[i].id || i) + ':' + (list[i].text || '') + ';';
    else sig = 'none';
    if (sig !== this._objSig) {
      this._objSig = sig;
      this._objRows.length = 0;
      let html = '';
      if (list) {
        for (let i = 0; i < list.length; i++) {
          html += '<div class="ob-row"><u></u><span>' + (list[i].text || '') + '</span><em></em></div>';
        }
      } else {
        html = '<div class="ob-row"><u>▸</u><span>AWAITING ORDERS</span><em></em></div>';
      }
      this.obList.innerHTML = html;
      const rows = this.obList.children;
      for (let i = 0; i < rows.length; i++) {
        this._objRows.push({ el: rows[i], u: rows[i].children[0], em: rows[i].children[2] });
      }
    }
    }

    if (list) {
      for (let i = 0; i < this._objRows.length && i < list.length; i++) {
        const o = list[i], r = this._objRows[i];
        const st = o.state || 'active';
        setText(r.u, OB_MARK[st] || OB_MARK.active);
        tog(r.el, 'done', st === 'done');
        tog(r.el, 'failed', st === 'failed');
        tog(r.el, 'pending', st === 'pending');
        if (typeof o.of === 'number' && o.of > 0) setText(r.em, Math.max(0, o.count || 0) + '/' + o.of);
        else setText(r.em, '');
      }
    }

    const tl = (m && typeof m.timeLeft === 'number' && isFinite(m.timeLeft))
      ? Math.max(0, m.timeLeft) : CFG.MISSION.TIME_LIMIT;
    setText(this.obTime, mmss(tl));
    tog(this.obEl, 'urgent', tl < 60);
  }

  // ---- target readout ------------------------------------------------
  _target(e) {
    if (!e || !e.pos) { tog(this.tgEl, 'hidden', true); return; }
    tog(this.tgEl, 'hidden', false);

    setText(this.tgName, e.__hudName || 'UNKNOWN');
    const p = this.ctx.player;
    if (p && p.pos) {
      const dx = e.pos.x - p.pos.x, dy = e.pos.y - p.pos.y, dz = e.pos.z - p.pos.z;
      setText(this.tgDist, Math.round(Math.sqrt(dx * dx + dy * dy + dz * dz)) + ' M');
    } else setText(this.tgDist, '');

    const apMax = (typeof e.apMax === 'number' && e.apMax > 0) ? e.apMax : 1;
    const eap = typeof e.ap === 'number' ? Math.max(0, e.ap) : apMax;
    setSX(this.tgAp, clamp01(eap / apMax));
    setText(this.tgApN, group(eap));

    const acsMax = (typeof e.acsMax === 'number' && e.acsMax > 0) ? e.acsMax : (CFG.PLAYER.ACS_CAP || 1);
    const acs = typeof e.acs === 'number' ? e.acs : 0;
    const af = clamp01(acs / acsMax);
    setSX(this.tgAcs, af);
    tog(this.tgEl, 'stag', !!e.staggered || af >= 0.995);
    tog(this.tgEl, 'boss', e.kind === 'boss');
  }

  // ---- radio chatter --------------------------------------------------
  _radioTick(dt) {
    let r = this._radio;
    if (!r) {
      if (!this._radioQ.length) { tog(this.rdEl, 'on', false); return; }
      r = this._radio = this._radioQ.shift();
      r.n = 0; r.t = 0;
      setText(this.rdWho, r.who);
      setText(this.rdTxt, '');
      tog(this.rdEl, 'on', true);
      tog(this.rdEl, 'done', false);
    }
    r.t += dt;
    const full = r.txt.length;
    if (r.n < full) {
      const n = Math.min(full, Math.floor(r.t * 46));
      if (n !== r.n) { r.n = n; setText(this.rdTxt, r.txt.slice(0, n)); }
      if (r.n >= full) { r.done = r.t; tog(this.rdEl, 'done', true); }
    } else if (r.t > (r.done || 0) + r.hold) {
      this._radio = null;
      tog(this.rdEl, 'on', false);
    }
  }

  // ---- edge warnings ---------------------------------------------------
  _warnTick(dt) {
    let w = this._warn;
    if (w) {
      w.t -= dt;
      if (w.t <= 0) w = this._warn = null;
    }
    if (!w) {
      // auto AP-critical warning
      const p = this.ctx.player;
      const apMax = (p && p.apMax) || CFG.PLAYER.AP;
      const f = p && typeof p.ap === 'number' ? p.ap / apMax : 1;
      if (this.ctx.state === 'playing' && f < 0.20 && f > 0) w = { txt: 'AP CRITICAL', level: 'danger' };
    }
    const on = !!w;
    tog(this.wTop, 'on', on);
    tog(this.wBot, 'on', on);
    if (on) {
      const lw = w.level === 'warn', li = w.level === 'info';
      tog(this.wTop, 'lv-warn', lw); tog(this.wBot, 'lv-warn', lw);
      tog(this.wTop, 'lv-info', li); tog(this.wBot, 'lv-info', li);
      setText(this.wTopA[0], w.txt); setText(this.wTopA[1], w.txt);
      setText(this.wBotA[0], w.txt); setText(this.wBotA[1], w.txt);
    }
  }

  // ---- centre banner ----------------------------------------------------
  _bannerTick(dt) {
    const b = this._banner;
    if (!b) { setOp(this.bnEl, 0); return; }
    if (!b.set) { b.set = true; setText(this.bnTxt, b.txt); setText(this.bnSub, b.sub); }
    b.t += dt;
    const k = b.t / b.dur;
    if (k >= 1) { this._banner = null; setOp(this.bnEl, 0); return; }
    const a = k < 0.10 ? k / 0.10 : k > 0.72 ? (1 - k) / 0.28 : 1;
    setOp(this.bnEl, a);
    setTF(this.bnEl, 'translateX(-50%) translateY(' + (-6 * Math.min(1, k * 4)).toFixed(1) + 'px)');
  }
}

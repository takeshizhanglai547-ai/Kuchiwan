// src/ui/hud.js — HTML overlay HUD (owner: mission/HUD designer). Styles: css/ui.css.
//
// Structure (all under #hud, class names are the styling contract):
//   .hud-objective   top-left: objective title / jp / progress + mission clock
//   .hud-target      top-center: locked target name, AP bar, ACS (stagger) bar
//   .hud-center      reticle, AP (number + bar), EN bar (+ redline state), own ACS bar
//   .hud-weapon[data-slot=LB|RB|L|R]  four weapon boxes around the reticle (ammo, reload)
//   .hud-status      boost mode / AB / speed / altitude
//   .hud-kits        repair kits left
//   .hud-markers     pooled lock markers (.mk, .mk.locked, .mk.missile)
//   .hud-damage      damage direction wedges around the reticle
//   .hud-callout     center banner (warnings / objective updates)
//   .hud-missile-warning
//
// API (game.hud): setVisible(bool), callout(text, jp, kind = 'info'|'warn'|'good'|'bad', seconds),
//                 damageFrom(worldPoint)
// Updates run in frame(); DOM writes only when values change.
import * as THREE from 'three';

const _v = new THREE.Vector3(), _p = new THREE.Vector3();
const SLOTS = ['LB', 'RB', 'L', 'R'];

function el(tag, cls, parent, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  if (parent) parent.appendChild(e);
  return e;
}

function fmtTime(t) {
  const m = Math.floor(t / 60), s = Math.floor(t % 60), cs = Math.floor((t * 100) % 100);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

export default function hudSystem(game) {
  let root, E = {};
  const cache = new Map(); // element -> last written value
  const markers = [];
  const damage = [];
  const callQueue = [];
  let callT = 0, visible = true, forced = null;

  function set(elm, key, value) {
    // key: 'text' | 'width' | 'class' | 'transform' | 'display' | style prop
    let c = cache.get(elm);
    if (!c) { c = {}; cache.set(elm, c); }
    if (c[key] === value) return;
    c[key] = value;
    if (key === 'text') elm.textContent = value;
    else if (key === 'class') elm.className = value;
    else if (key === 'width') elm.style.width = value;
    else if (key === 'transform') elm.style.transform = value;
    else if (key === 'display') elm.style.display = value;
    else if (key === 'opacity') elm.style.opacity = value;
    else elm.style[key] = value;
  }

  function build(parent) {
    root = el('div', 'hud', parent);
    root.id = 'hud';
    // objective
    const obj = el('div', 'hud-objective', root);
    el('div', 'obj-label', obj, 'OBJECTIVE <span>作戦目標</span>');
    E.objTitle = el('div', 'obj-title', obj);
    E.objJp = el('div', 'obj-jp', obj);
    E.objCount = el('div', 'obj-count', obj);
    E.clock = el('div', 'obj-clock', obj);
    // target
    const tg = el('div', 'hud-target', root);
    E.tgName = el('div', 'tg-name', tg);
    E.tgAp = el('div', 'bar tg-ap', tg); E.tgApFill = el('i', '', E.tgAp);
    E.tgAcs = el('div', 'bar tg-acs', tg); E.tgAcsFill = el('i', '', E.tgAcs);
    E.tgApNum = el('div', 'tg-apnum', tg);
    E.target = tg;
    // center
    const c = el('div', 'hud-center', root);
    E.reticle = el('div', 'reticle', c, '<i class="r-tl"></i><i class="r-tr"></i><i class="r-bl"></i><i class="r-br"></i><b></b>');
    const ap = el('div', 'ap-block', c);
    el('span', 'lbl', ap, 'AP');
    E.apNum = el('span', 'ap-num', ap);
    E.apBar = el('div', 'bar ap-bar', ap); E.apFill = el('i', '', E.apBar);
    const en = el('div', 'en-block', c);
    E.enBar = el('div', 'bar en-bar', en); E.enFill = el('i', '', E.enBar);
    E.enLbl = el('span', 'lbl en-lbl', en, 'EN');
    E.acsBar = el('div', 'bar own-acs', c); E.acsFill = el('i', '', E.acsBar);
    // weapons
    E.wpn = {};
    for (const s of SLOTS) {
      const w = el('div', 'hud-weapon', root);
      w.dataset.slot = s;
      const o = { box: w };
      o.label = el('div', 'w-label', w);
      o.name = el('div', 'w-name', w);
      o.ammo = el('div', 'w-ammo', w);
      o.bar = el('div', 'bar w-bar', w); o.fill = el('i', '', o.bar);
      E.wpn[s] = o;
    }
    // status
    E.status = el('div', 'hud-status', root);
    E.boost = el('div', 'st-boost', E.status);
    E.speed = el('div', 'st-speed', E.status);
    E.alt = el('div', 'st-alt', E.status);
    E.kits = el('div', 'hud-kits', root);
    // markers
    E.markers = el('div', 'hud-markers', root);
    for (let i = 0; i < 24; i++) {
      const m = el('div', 'mk', E.markers);
      m.style.display = 'none';
      markers.push(m);
    }
    // damage wedges
    E.damage = el('div', 'hud-damage', root);
    for (let i = 0; i < 4; i++) {
      const d = el('div', 'dmg', E.damage);
      damage.push({ el: d, t: 0, angle: 0 });
      d.style.opacity = '0';
    }
    E.callout = el('div', 'hud-callout', root);
    E.calloutJp = el('div', 'hud-callout-jp', root);
    E.missile = el('div', 'hud-missile-warning', root, 'MISSILE <span>ミサイル接近</span>');
    E.missile.style.display = 'none';
  }

  const api = {
    name: 'hud',
    order: 900,
    get root() { return root; },
    init(g) {
      build(g.overlay);
      g.hud = api;
      forced = g.params.hud; // null = automatic
      g.events.on('game:state', () => api._applyVisibility());
      api._applyVisibility();
    },
    reset() {
      callQueue.length = 0; callT = 0;
      set(E.callout, 'opacity', '0'); set(E.calloutJp, 'opacity', '0');
      for (const d of damage) { d.t = 0; d.el.style.opacity = '0'; }
    },
    setVisible(v) { forced = v; api._applyVisibility(); },
    _applyVisibility() {
      const st = game.state;
      const auto = st === 'playing' || st === 'paused' || st === 'results';
      visible = forced === null || forced === undefined ? auto : forced;
      root.style.display = visible ? '' : 'none';
    },
    callout(text, jp = '', kind = 'info', seconds = 1.8) {
      callQueue.push({ text, jp, kind, seconds });
      if (callQueue.length > 4) callQueue.shift();
    },
    damageFrom(point) {
      const p = game.player;
      if (!p) return;
      // bearing relative to the camera view
      const cam = game.camera;
      cam.getWorldDirection(_v);
      const camYaw = Math.atan2(_v.x, _v.z);
      const hitYaw = Math.atan2(point.x - p.pos.x, point.z - p.pos.z);
      let rel = hitYaw - camYaw;
      rel = Math.atan2(Math.sin(rel), Math.cos(rel));
      let slot = damage[0];
      for (const d of damage) if (d.t < slot.t) slot = d;
      slot.t = 1;
      slot.angle = -rel; // screen: clockwise positive
    },

    frame(alpha, realDt) {
      if (!visible) return;
      const g = game, p = g.player;
      const dt = realDt || 1 / 60;
      // objective
      const m = g.mission;
      if (m) {
        const o = m.logic.objective();
        set(E.objTitle, 'text', m.status === 'complete' ? 'MISSION COMPLETE' : m.status === 'failed' ? 'MISSION FAILED' : o.title);
        set(E.objJp, 'text', m.status === 'active' ? o.jp : '');
        set(E.objCount, 'text', m.status === 'active' && o.count > 1 ? `${o.progress} / ${o.count}` : '');
        set(E.clock, 'text', fmtTime(m.logic.time));
      }
      if (p) {
        const mo = p.motor;
        set(E.apNum, 'text', String(Math.ceil(p.ap)));
        set(E.apFill, 'width', `${(100 * p.ap / p.apMax).toFixed(1)}%`);
        set(E.apBar, 'class', `bar ap-bar${p.ap / p.apMax < 0.3 ? ' low' : ''}`);
        set(E.enFill, 'width', `${(100 * mo.en.frac).toFixed(1)}%`);
        set(E.enBar, 'class', `bar en-bar${mo.en.redline ? ' redline' : ''}`);
        set(E.acsFill, 'width', `${(100 * p.acs.frac).toFixed(1)}%`);
        set(E.acsBar, 'class', `bar own-acs${p.acs.staggered ? ' stagger' : ''}`);
        // weapons
        for (const s of SLOTS) {
          const slot = p.loadout.slots[s], o = E.wpn[s];
          if (!slot) continue;
          const d = slot.def;
          set(o.label, 'text', `${d.label}`);
          set(o.name, 'text', d.name);
          let ammo;
          if (d.type === 'blade') ammo = slot.cooldownT > 0 || slot.bladePhase ? 'CHARGING' : 'READY';
          else if (slot.reloadT > 0) ammo = 'RELOAD';
          else ammo = slot.ammo === Infinity ? '∞' : `${slot.mag === Infinity ? '' : slot.mag + ' / '}${slot.ammo}`;
          set(o.ammo, 'text', ammo);
          set(o.fill, 'width', `${(100 * slot.readyFrac).toFixed(0)}%`);
          set(o.box, 'class', `hud-weapon${slot.reloadT > 0 || slot.cooldownT > 0.3 ? ' busy' : ''}${slot.ammo <= 0 ? ' empty' : ''}`);
        }
        set(E.boost, 'text', mo.abActive ? 'ASSAULT BOOST' : mo.boostOn ? 'BOOST ON' : 'WALK');
        set(E.speed, 'text', `${Math.round(Math.hypot(mo.vel.x, mo.vel.z) * 3.6)} km/h`);
        set(E.alt, 'text', `ALT ${Math.max(0, Math.round(p.pos.y))} m`);
        set(E.kits, 'text', `REPAIR ×${p.repairKits}  修復キット`);
      }
      // target panel + markers
      const lock = g.lockon;
      const tgt = lock && lock.target;
      if (tgt && tgt.alive) {
        set(E.target, 'display', '');
        set(E.tgName, 'text', tgt.name);
        set(E.tgApFill, 'width', `${(100 * tgt.ap / tgt.apMax).toFixed(1)}%`);
        set(E.tgAcsFill, 'width', `${(100 * tgt.acs.frac).toFixed(1)}%`);
        set(E.tgAcs, 'class', `bar tg-acs${tgt.acs.staggered ? ' stagger' : ''}`);
        set(E.tgApNum, 'text', String(Math.ceil(tgt.ap)));
      } else set(E.target, 'display', 'none');

      const w = root.clientWidth || window.innerWidth, h = root.clientHeight || window.innerHeight;
      // The camera was placed this frame (camera system, order 800) but the renderer only
      // refreshes its matrices at render time: update now so markers don't lag a frame.
      g.camera.updateMatrixWorld();
      let mi = 0;
      for (const a of g.actors) {
        if (mi >= markers.length) break;
        if (a === p || !a.alive || !a.targetable) continue;
        a.aimPoint(_p);
        _v.copy(_p).project(g.camera);
        if (_v.z > 1 || _v.x < -1.1 || _v.x > 1.1 || _v.y < -1.1 || _v.y > 1.1) continue;
        const mk = markers[mi++];
        const x = (_v.x * 0.5 + 0.5) * w, y = (-_v.y * 0.5 + 0.5) * h;
        set(mk, 'display', '');
        set(mk, 'transform', `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`);
        const missile = lock && lock.missileLocks.includes(a);
        set(mk, 'class', `mk${a === tgt ? ' locked' : ''}${missile ? ' missile' : ''}${a.type === 'boss' ? ' boss' : ''}`);
      }
      for (; mi < markers.length; mi++) set(markers[mi], 'display', 'none');

      // damage wedges
      for (const d of damage) {
        if (d.t <= 0) continue;
        d.t = Math.max(0, d.t - dt * 1.2);
        d.el.style.opacity = d.t.toFixed(2);
        d.el.style.transform = `rotate(${d.angle.toFixed(3)}rad)`;
      }

      // callouts
      if (callT > 0) {
        callT -= dt;
        if (callT <= 0) { set(E.callout, 'opacity', '0'); set(E.calloutJp, 'opacity', '0'); }
      }
      if (callT <= 0 && callQueue.length) {
        const c = callQueue.shift();
        E.callout.textContent = c.text; E.calloutJp.textContent = c.jp;
        cache.delete(E.callout); cache.delete(E.calloutJp);
        E.callout.className = `hud-callout show ${c.kind}`;
        E.calloutJp.className = `hud-callout-jp show ${c.kind}`;
        set(E.callout, 'opacity', '1'); set(E.calloutJp, 'opacity', '1');
        callT = c.seconds;
      }
      const incoming = g.projectiles && g.projectiles.incomingMissiles > 0;
      set(E.missile, 'display', incoming ? '' : 'none');
    },
  };
  return api;
}

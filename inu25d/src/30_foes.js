// 30_foes.js — 敵の枠組み（リード担当）。種類の登録・出現・共通の反応（のけぞり/ダウン/起き上がり/
// ピヨり/やっつけ→ぽんっ→子犬になって走り去る）・AI用の小道具 h.*。敵の中身は 31/35/36 が define する。
(function(){ 'use strict';
const G = window.G; const THREE = window.THREE; const U = G.U;

const types = {};
const tokens = new Set();

function diff(){ return (G.game && G.game.diff) || { foeHp:1, attackers:2, foeSpeed:1, think:1 }; }

// placeholder rig (used when a type has no build or the build throws)
function fallbackRig(def){
  const b = G.look.builder();
  const s = def && def.boss ? 1.8 : 1;
  b.add(G.look.geo.sphere(0.42*s, 16, 12), '#8f8fa0', [0, 0.95*s, 0]);
  b.add(G.look.geo.sphere(0.34*s, 16, 12), '#7a7a8a', [0, 0.4*s, 0]);
  const mat = G.look.vmat({ instance:true });
  const mesh = b.mesh({ material:mat });
  const root = new THREE.Group(); root.add(mesh);
  return { root, height:1.35*s, radius:0.4*s, tip:null, base:null,
    update(e){ mat.userData.uFlash.value = e.flashT>0 ? 0.7 : 0; root.rotation.z = e.state==='down' ? -1.2*e.face : 0; },
    setAlpha(a){ mat.transparent = a<1; mat.opacity = a; },
    dispose(){ mesh.geometry.dispose(); mat.dispose(); } };
}

const h = {
  target(e){
    const p = G.player;
    if(p && !p.dead && !p.removed) return p;
    return null;
  },
  dx:(e,t)=> t.x - e.x,
  dz:(e,t)=> t.z - e.z,
  dist:(e,t)=> Math.hypot(t.x - e.x, (t.z - e.z)*1.4),
  face(e, t){ if(t && Math.abs(t.x - e.x) > 0.05) e.face = t.x > e.x ? 1 : -1; },
  walkTo(e, x, z, spd){
    const dx = x - e.x, dz = z - e.z, d = Math.hypot(dx, dz);
    spd = (spd==null ? e.def.spd||0.04 : spd) * diff().foeSpeed * (e.spdMul||1);
    if(d < Math.max(0.12, spd*1.5)){ h.stop(e); return true; }
    e.vx = dx/d*spd; e.vz = dz/d*spd*0.8;
    if(Math.abs(dx) > 0.08) e.face = dx > 0 ? 1 : -1;
    if(e.state!=='move') G.setState(e, 'move');
    if(e.anim!=='walk') G.setAnim(e, 'walk');
    return false;
  },
  stop(e){ e.vx = 0; e.vz = 0; if(e.state==='move') G.setState(e, 'idle'); if(e.anim==='walk' || e.anim==='run') G.setAnim(e, 'idle'); },
  // telegraphed attack: windup frames of 'windup' + alert, then G.combat.start
  attack(e, def, windup){
    if(e.state==='act' || e.atk || e.pending) return false;
    G.setState(e, 'act');
    e.vx = 0; e.vz = 0;
    const w = Math.max(0, Math.round((windup==null ? 20 : windup) * (diff().think||1)));
    e.pending = { def, t:w };
    if(w>0){
      G.setAnim(e, def.windupAnim || 'windup', w);
      if(G.fx && G.fx.alert && !def.noAlert) G.fx.alert(e);
      G.bus.emit('alert', { ent:e });
    }
    return true;
  },
  shoot(e, o){ return G.combat.shoot(Object.assign({ owner:e, team:e.team }, o)); },
  token(e){
    if(e.hasToken) return true;
    const max = diff().attackers || 2;
    // drop stale holders
    for(const id of tokens){ const f = G.world.ents.find(x=>x.id===id); if(!f || f.dead || f.removed) tokens.delete(id); }
    if(tokens.size >= max) return false;
    tokens.add(e.id); e.hasToken = true; return true;
  },
  release(e){ if(e.hasToken){ tokens.delete(e.id); e.hasToken = false; } },
  wait(e, frames){ e.cool = Math.max(e.cool||0, frames|0); },
  spawnMinion(type, x, z, opts){ return G.foes.spawn(type, x, z, Object.assign({ entrance:'drop', minion:true }, opts||{})); },
  say(e, text){ if(G.fx && G.fx.text) G.fx.text(text, e.x, e.y + (e.rig && e.rig.height || 1.3) + 0.35, e.z, 'onoma'); },
  rand(){ return G.rng(); },
  // pick a spot beside the target on its belt line (for surrounding)
  flank(e, t, dist){ const side = e.x < t.x ? -1 : 1; return { x: t.x + side*(dist||1.1), z: U.clamp(t.z + (e.id%3-1)*0.35, G.cfg.ZMIN, G.cfg.ZMAX) }; },
};

G.foes = {
  types, h, tokens,
  init(){ G.bus.on('scene', ()=> tokens.clear()); },
  define(type, def){
    def.type = type;
    def.name = def.name || type;
    def.hp = def.hp || 30; def.spd = def.spd || 0.04;
    def.radius = def.radius || 0.42; def.height = def.height || 1.25; def.weight = def.weight || 1;
    def.score = def.score || 100; def.xp = def.xp || 10;
    types[type] = def;
    return def;
  },
  build(type, ent){
    const def = types[type];
    let rig = null;
    try { rig = def && def.build ? def.build(ent||null) : null; } catch(err){ G.logError('foe build '+type, err); }
    return rig || fallbackRig(def);
  },
  spawn(type, x, z, opts){
    opts = opts || {};
    const def = types[type];
    if(!def){ G.logError('spawn', 'unknown foe type '+type); return null; }
    const D = diff();
    const stageMul = 1 + (G.stage && G.stage.index ? G.stage.index*0.07 : 0);
    const hpMul = (opts.hpMul || 1) * D.foeHp * (def.boss ? 1 : stageMul);
    const p = G.player;
    const e = G.makeEnt({
      kind: def.boss ? 'boss' : 'foe', type, team:1, def, x, z: U.clamp(z, G.cfg.ZMIN, G.cfg.ZMAX), y: opts.y || 0,
      face: opts.face || (p ? (x > p.x ? -1 : 1) : -1),
      hp: Math.round(def.hp*hpMul), maxHp: Math.round(def.hp*hpMul), hpMul,
      radius:def.radius, height:def.height, weight:def.weight, armor:def.armor||0,
      state:'spawn', cool: 20 + Math.floor(G.rng()*30), phase:0, minion:!!opts.minion,
      entrance: opts.entrance || def.entrance || 'walk', boss: !!(def.boss || opts.boss),
    });
    e.rig = G.foes.build(type, e);
    if(e.rig){ if(e.rig.height) e.height = def.height || e.rig.height; }
    // entrance setup
    if(e.entrance==='drop'){ e.y = opts.y || 7; e.vy = 0; e.onGround = false; }
    else if(e.entrance==='burrow'){ e.intangible = true; e.burrowT = 40; if(e.rig && e.rig.setAlpha) e.rig.setAlpha(0.0); }
    else if(e.entrance==='walk'){ e.entered = false; }
    if(def.init){ try { def.init(e, opts); } catch(err){ G.logError('foe init '+type, err); } }
    G.world.add(e);
    G.bus.emit('foeSpawn', { ent:e });
    return e;
  },
  // framework per tick: reactions + AI
  tick(e){
    if(e.flashT>0) e.flashT--;
    if(e.inv>0) e.inv--;
    if(e.hpShowT>0) e.hpShowT--;
    if(e.cool>0) e.cool--;
    e.stateT++;
    // leaving the attack state frees the token
    if(e.hasToken && e.state!=='act' && !e.atk && !e.pending) h.release(e);
    // entered the arena?
    if(!e.entered){
      const vr = G.cam.viewRange();
      if(e.x > vr[0] + e.radius && e.x < vr[1] - e.radius) e.entered = true;
    }
    switch(e.state){
      case 'spawn': return tickSpawn(e);
      case 'hurt':
        if(e.anim!=='hurt') G.setAnim(e, 'hurt');
        if(--e.stun <= 0){ G.setState(e, 'idle'); G.setAnim(e, 'idle'); e.cool = Math.max(e.cool, 10); }
        return;
      case 'down':
        if(e.anim!=='down') G.setAnim(e, 'down');
        if(e.onGround){ e.downT = (e.downT||0) + 1; if(e.downT > (e.def.boss ? 70 : 42)){ G.setState(e, 'getup'); G.setAnim(e, 'getup', 24); } }
        return;
      case 'getup':
        if(e.stateT >= 24){ G.setState(e, 'idle'); G.setAnim(e, 'idle'); e.inv = 16; e.cool = Math.max(e.cool, 12); }
        return;
      case 'dizzy':
        if(e.anim!=='dizzy') G.setAnim(e, 'dizzy');
        if(--e.stun <= 0){ G.setState(e, 'idle'); G.setAnim(e, 'idle'); }
        return;
      case 'ko': return tickKO(e);
    }
    // FREE: running a pending telegraph?
    if(e.pending){
      if(--e.pending.t <= 0){ const d = e.pending.def; e.pending = null; G.combat.start(e, d); }
      return;
    }
    if(e.atk){ return; }
    if(e.state==='act'){ G.setState(e, 'idle'); G.setAnim(e, 'idle'); e.cool = Math.max(e.cool, e.def.recover || 16); }
    if(!e.entered && e.entrance==='walk'){
      // walk into view first
      const p = G.player; const tx = p ? p.x : e.x;
      e.vx = U.sign(tx - e.x) * (e.def.spd||0.04) * 1.2; e.face = U.sign(e.vx); if(e.anim!=='walk') G.setAnim(e, 'walk');
      return;
    }
    const def = e.def;
    if(def.ai){ try { def.ai(e); } catch(err){ G.logError('ai '+e.type, err); e.cool = 30; } }
    else defaultAI(e);
  },
};

function tickSpawn(e){
  if(e.entrance==='drop'){
    if(e.anim!=='fall') G.setAnim(e, 'fall');
    if(e.onGround){ G.setState(e, 'idle'); G.setAnim(e, 'idle'); e.entered = true; if(G.fx && G.fx.burst) G.fx.burst('dust', e.x, 0.05, e.z, { scale:0.8 }); }
    return;
  }
  if(e.entrance==='burrow'){
    e.burrowT--;
    if(e.burrowT===20 && G.fx && G.fx.burst) G.fx.burst('dust', e.x, 0.05, e.z, { scale:1 });
    if(e.burrowT<=0){ e.intangible = false; if(e.rig && e.rig.setAlpha) e.rig.setAlpha(1); e.vy = 0.16; e.onGround=false; G.setState(e, 'idle'); G.setAnim(e, 'jump'); e.entered = true; }
    return;
  }
  G.setState(e, 'idle'); G.setAnim(e, 'idle');
}

function tickKO(e){
  e.deadT = (e.deadT||0) + 1;
  if(e.def.onKOTick){ try { if(e.def.onKOTick(e)===true) return; } catch(err){ G.logError('onKOTick', err); } }
  const boss = e.def.boss;
  const lie = boss ? 80 : 26;
  if(!e.onGround && e.deadT < 120){ if(e.anim!=='ko') G.setAnim(e, 'ko'); return; }
  if(e.koLand==null){ e.koLand = e.deadT; G.setAnim(e, 'ko'); e.vx = 0; }
  const t = e.deadT - e.koLand;
  if(t===lie){
    // ぽんっ — the grumpy soldier turns into a happy pup
    if(G.fx && G.fx.burst){ G.fx.burst('poof', e.x, e.height*0.5, e.z, { scale: boss?2.2:1 }); G.fx.burst('hearts', e.x, e.height+0.2, e.z, { count: boss?8:3 }); }
    if(G.audio && G.audio.sfx) G.audio.sfx('poof');
    G.bus.emit('poof', { ent:e });
    G.setAnim(e, 'cheer');
    e.happy = true;
    // drops
    if(!e.minion || G.rng()<0.3){
      const n = boss ? 12 : 2 + Math.floor(G.rng()*2);
      for(let i=0;i<n;i++) G.pickups.spawn('coin', e.x, e.z);
      const r = G.rng();
      if(boss) G.pickups.spawn('cake', e.x, e.z);
      else if(r < 0.14) G.pickups.spawn('bone', e.x, e.z);
      else if(r < 0.22) G.pickups.spawn('star', e.x, e.z);
    }
  }
  if(t > lie + 16){
    // run away happily, fading out
    const away = G.player ? U.sign(e.x - G.player.x) : 1;
    e.face = away; e.vx = away*0.09; e.noClamp = true;
    if(t % 22 === 0 && e.onGround){ e.vy = 0.1; }
    const a = U.clamp(1 - (t - lie - 16)/60, 0, 1);
    if(e.rig && e.rig.setAlpha) e.rig.setAlpha(a);
    e.shadowAlpha = 0.42*a;
    if(a<=0) e.removeMe = true;
  }
}

// simple default AI (used if a type has no ai): approach, then swipe
function defaultAI(e){
  const t = h.target(e); if(!t){ h.stop(e); return; }
  h.face(e, t);
  if(e.cool>0){ h.stop(e); return; }
  const dx = Math.abs(t.x - e.x), dz = Math.abs(t.z - e.z);
  if(dx < 1.2 && dz < 0.45){
    if(h.token(e)) h.attack(e, SWIPE, 22); else { h.wait(e, 20); }
  } else {
    const f = h.flank(e, t, 1.0); h.walkTo(e, f.x, f.z);
  }
}
const SWIPE = { id:'foe_swipe', anim:'attack', len:26,
  hits:[{ at:8, dur:4, x0:0, x1:1.1, zr:0.5, y0:0, y1:1.3, dmg:8, kb:0.08, stun:18, kind:'blunt', power:1 }],
  move:[{ at:6, vx:0.08 }] };
G.foes.SWIPE = SWIPE;
})();

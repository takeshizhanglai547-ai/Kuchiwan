// 90_game.js — 起動・場面の流れ・進行（リード担当）。
// ※ いまは起動と、モデル確認用の「viewer」場面だけ。本編の流れは後で足す。
(function(){ 'use strict';
const G = window.G; const THREE = window.THREE; const U = G.U;

G.testMode = /(^|#)test\b/.test(location.hash);

// ---------------------------------------------------------------- debug: model showcase
const showcase = { ents: [], ground: null };
G.scenes.viewer = {
  enter(){
    G.scene.background = new THREE.Color(0xbfe6ff);
    if(!showcase.ground){
      const g = new THREE.Mesh(new THREE.CircleGeometry(30, 48), G.look.mat('#9fd67a', { rough:0.95, rim:0 }));
      g.rotation.x = -Math.PI/2; g.receiveShadow = true;
      showcase.ground = g;
    }
    G.scene.add(showcase.ground);
  },
  exit(){
    for(const e of showcase.ents) G.world.remove(e);
    showcase.ents.length = 0;
    if(showcase.ground) G.scene.remove(showcase.ground);
  },
  tick(){
    for(const e of showcase.ents){
      e.animT++; e.stateT++;
      if(e.flashT>0) e.flashT--;
      if(e.rig && e.rig.update){ try { e.rig.update(e, G.cfg.TICK); } catch(err){ G.logError('rig.update '+e.type, err); } }
    }
  },
  frame(dt){
    if(G.fx && G.fx.frame) G.fx.frame(dt);
    if(G.ui && G.ui.frame) G.ui.frame(dt);
    if(G.stage && G.stage.frame) G.stage.frame(dt);
  },
};
G.debug = {
  // items: hero ids / foe type ids / functions returning a rig. opts {gap, anim, face, z}
  showcase(items, opts){
    opts = opts || {};
    if(G.sceneName!=='viewer') G.go('viewer');
    for(const e of showcase.ents) G.world.remove(e);
    showcase.ents.length = 0;
    const gap = opts.gap || 2.2, n = items.length;
    items.forEach((it, i)=>{
      let rig = null, kind = 'prop', type = String(it);
      try {
        if(typeof it === 'function'){ rig = it(); type = 'custom'+i; }
        else if(G.heroes && G.heroes.get && G.heroes.get(it)){ rig = G.heroes.build(it); kind='hero'; }
        else if(G.foes && G.foes.types && G.foes.types[it]){ rig = G.foes.build(it); kind='foe'; }
      } catch(err){ G.logError('showcase build '+type, err); }
      if(!rig) return;
      const e = G.makeEnt({ kind, type, x:(i-(n-1)/2)*gap, z:opts.z||0, face: opts.face==null?1:opts.face, rig,
        radius: rig.radius || 0.45, height: rig.height || 1.2, hp:10, maxHp:10 });
      G.setAnim(e, opts.anim || 'idle', opts.len || 0, opts.hitAt);
      G.world.add(e);
      showcase.ents.push(e);
    });
    const span = Math.max(1, (n-1)*gap);
    G.cam.followEnt = null; G.cam.unlock();
    G.cam.tx = 0; G.cam.ty = 0.9; G.cam.tz = 0;
    G.cam.zoom = opts.zoom!=null ? opts.zoom : (G.cam.baseDist - Math.max(6, span*1.25+3));
    G.cam.snap();
    return showcase.ents;
  },
  // set an animation on every showcase entity (len = frames for one-shot anims)
  anim(name, len, hitAt){ for(const e of showcase.ents) G.setAnim(e, name, len||0, hitAt); },
  ents: ()=> showcase.ents,
};

// ---------------------------------------------------------------- boot
const MODULE_ORDER = ['look','heroes','foes','stage','combat','pickups','props','player','fx','audio','ui','game'];
G.boot = function(){
  const canvas = document.getElementById('game');
  const msg = (t)=>{ const el = document.getElementById('bootmsg'); if(el) el.textContent = t; };
  if(!G.initRenderer(canvas)){
    G.bootError = 'webgl';
    msg('このきかいでは 3D が うごかないみたい…（WebGL がつかえません）');
    return;
  }
  for(const name of MODULE_ORDER){
    const m = G[name];
    if(m && typeof m.init === 'function' && name!=='game'){
      try { m.init(); } catch(err){ G.logError('init '+name, err); }
    }
  }
  G.ready = true;
  const boot = document.getElementById('boot');
  if(boot){ boot.style.transition = 'opacity .35s'; boot.style.opacity = '0'; setTimeout(()=> boot.remove(), 400); }
  const first = G.scenes.title ? 'title' : 'viewer';
  G.go(G.testMode ? 'viewer' : first);
  if(!G.testMode) G.start(); else G.step(1);
};
G.boot();
})();

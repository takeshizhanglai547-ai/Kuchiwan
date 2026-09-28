// 50_combat.js — 攻撃の進行・当たり判定・ダメージと反応・飛び道具・範囲攻撃・拾い物・壊せる小物。
// 仕様は CONTRACT.md §6。攻撃は「定義(def)」と、実体に載る「進行中(ent.atk)」の二層。
(function(){ 'use strict';
const G = window.G; const THREE = window.THREE; const U = G.U;

const _targets = [];
const projectiles = [];
const areas = [];

// ---------------------------------------------------------------- helpers
function hurtable(t, team){
  if(!t || t.dead || t.removed || t.removeMe) return false;
  if(t.team===team) return false;
  if(t.team===2) return team===0;             // props: only heroes break them
  if(t.team===3) return false;                // pickups
  if(t.inv>0) return false;
  if(t.state==='spawn' && !t.hittableSpawn) return false;
  if(t.intangible) return false;               // ghosts phasing, burrowed ants...
  const a = t.atk; if(a && a.def.inv && a.t >= a.def.inv[0] && a.t <= a.def.inv[1]) return false;   // i-frames of the move itself
  return true;
}
function eachTarget(team, fn){
  const ents = G.world.ents;
  for(let i=0;i<ents.length;i++){ const t = ents[i]; if(hurtable(t, team)) fn(t); }
}
function hitstopFor(dmg, launch){ return U.clamp(Math.round(Math.pow(Math.max(1,dmg), 0.62)*0.95*(launch?1.25:1)), 2, 14); }
function diff(){ return (G.game && G.game.diff) || { heroDmg:1, foeDmg:1, foeHp:1, attackers:2 }; }

// ---------------------------------------------------------------- attacks
G.combat = {
  projectiles, areas,
  init(){},
  // begin an attack
  start(ent, def){
    if(!ent || !def) return;
    const first = def.hits && def.hits.length ? def.hits[0].at : Math.round(def.len*0.35);
    ent.atk = { def, t:0, sets: (def.hits||[]).map(()=> new Set()), swung:false };
    ent.lastAtk = def;
    G.setAnim(ent, def.anim || 'atk1', def.len, U.clamp(first/Math.max(1,def.len), 0.05, 0.95));
    if(def.armor) ent.atkArmor = true;
  },
  cancel(ent){ if(ent && ent.atk){ ent.atk = null; ent.atkArmor = false; } },
  // advance every running attack, projectile and area; resolve hits
  tick(){
    const ents = G.world.ents;
    for(let i=0;i<ents.length;i++){
      const e = ents[i];
      if(!e.atk || e.dead) continue;
      stepAttack(e);
    }
    stepProjectiles();
    stepAreas();
  },
  // central damage entry — returns true if it landed
  damage,
  shoot(o){
    const owner = o.owner || null;
    const p = {
      owner, team: o.team!=null ? o.team : (owner ? owner.team : 1), kind: o.kind || 'ball',
      x:o.x, y:o.y, z:o.z, vx:o.vx||0, vy:o.vy||0, vz:o.vz||0, grav:o.grav||0, drag:o.drag||1,
      dmg:o.dmg||5, r:o.r||0.35, life:o.life||90, age:0, pierce:o.pierce||0, power:o.power||1,
      stun:o.stun||16, kb:o.kb==null?0.08:o.kb, up:o.up||0, hitKind:o.hitKind || kindOf(o.kind), sets:new Set(),
      boom:o.boom||null, homing:o.homing||0, onGround:o.onGround||'die', rehit:o.rehit||0, vis:null, dead:false,
      reflectable: o.reflectable!==false, spin:o.spin||0, face: o.vx<0?-1:1, onHit:o.onHit||null, onEnd:o.onEnd||null,
    };
    try { p.vis = G.fx && G.fx.makeProjectile ? G.fx.makeProjectile(p.kind) : null; } catch(err){ G.logError('makeProjectile', err); }
    if(!p.vis){ const m = new THREE.Mesh(G.look.geo.sphere(p.r*0.8, 12, 8), G.look.mat('#ffe14d', { emissive:'#ffb000', emissiveIntensity:0.6 })); p.vis = { obj:m, update(){}, dispose(){} }; }
    p.vis.obj.position.set(p.x, p.y, p.z);
    G.scene.add(p.vis.obj);
    projectiles.push(p);
    G.bus.emit('shoot', { ent:owner, kind:p.kind, x:p.x, y:p.y, z:p.z });
    return p;
  },
  area(o){
    const a = Object.assign({ team: o.owner ? o.owner.team : 1, x:0, y:0, z:0, r:1.5, zr:null, y0:-0.5, y1:3, dmg:10,
      delay:0, dur:3, power:2, kind:'blunt', kb:0.12, up:0.2, stun:24, sets:null, fx:null }, o);
    a.sets = new Set();
    areas.push(a);
    return a;
  },
  clear(){
    for(const p of projectiles) killProj(p, true);
    projectiles.length = 0; areas.length = 0;
  },
  hitstopFor,
};
function kindOf(k){ return ({ wave:'slash', star:'star', ball:'magic', fire:'fire', ice:'ice', bolt:'thunder', cork:'pop', card:'slash',
  confetti:'pop', bone:'blunt', note:'magic', firework:'pop', rock:'blunt', shadow:'magic', beam:'magic' })[k] || 'blunt'; }

function stepAttack(e){
  const a = e.atk, d = a.def, t = a.t;
  if(d.move) for(const m of d.move){
    if(m.at===t){
      if(m.vx!=null) e.vx = (m.add? e.vx:0) + e.face*m.vx;
      if(m.vy!=null){ e.vy = m.vy; e.onGround = false; }
      if(m.vz!=null) e.vz = m.vz;
      if(m.toTarget && e.target){ const dz = e.target.z - e.z; e.vz = U.clamp(dz*0.12, -0.12, 0.12); }
    }
    // sustained move: keep velocity during [at, until]
    if(m.until!=null && t>m.at && t<=m.until){ if(m.vx!=null) e.vx = e.face*m.vx; }
  }
  if(d.proj) for(const p of d.proj){
    if(p.at===t){
      const tip = e.rig && e.rig.tip;
      let x = e.x + e.face*(p.ox!=null?p.ox:0.7), y = e.y + (p.oy!=null?p.oy:0.7), z = e.z + (p.oz||0);
      if(tip && p.fromTip){ tip.getWorldPosition(_v); x=_v.x; y=_v.y; z=_v.z; }
      const n = p.count||1;
      for(let k=0;k<n;k++){
        const spread = n>1 ? (k-(n-1)/2)*(p.spread||0.05) : 0;
        G.combat.shoot(Object.assign({}, p, { owner:e, x, y, z, vx:e.face*(p.vx||0.3), vz:(p.vz||0)+spread, vy:p.vy||0,
          dmg: (p.dmg||6)*(e.atkMul||1) }));
      }
    }
  }
  if(d.areas) for(const ar of d.areas){
    if(ar.at===t){
      G.combat.area(Object.assign({}, ar, { owner:e, x: e.x + e.face*(ar.ox||0), y: e.y, z: e.z + (ar.oz||0), dmg:(ar.dmg||10)*(e.atkMul||1) }));
    }
  }
  if(d.fn) try { d.fn(e, t); } catch(err){ G.logError('atk.fn '+d.id, err); }
  if(d.hits){
    for(let i=0;i<d.hits.length;i++){
      const h = d.hits[i];
      if(t<h.at || t>=h.at+h.dur) continue;
      if(!a.swung){ a.swung = true; G.bus.emit('swing', { ent:e, def:d, kind:h.kind||'slash', power:h.power||1 }); }
      if(h.rehit && (t-h.at)%h.rehit===0) a.sets[i].clear();
      meleeHit(e, h, a.sets[i]);
    }
  }
  a.t++;
  if(e.atk===a && a.t>=d.len){
    e.atk = null; e.atkArmor = false;
    if(d.onEnd) try { d.onEnd(e); } catch(err){ G.logError('atk.onEnd '+d.id, err); }
  }
}
const _v = new THREE.Vector3();

function meleeHit(e, h, set){
  const dir = e.face;
  const xa = e.x + dir*h.x0, xb = e.x + dir*h.x1;
  const lo = Math.min(xa,xb), hi = Math.max(xa,xb);
  const y0 = e.y + (h.y0||0), y1 = e.y + (h.y1==null?1.6:h.y1);
  const zr = h.zr==null ? 0.7 : h.zr;
  eachTarget(e.team, (t)=>{
    if(set.has(t.id)) return;
    if(Math.abs(t.z - e.z) > zr + t.radius*0.5) return;
    if(t.x + t.radius < lo || t.x - t.radius > hi) return;
    if(t.y + t.height < y0 || t.y > y1) return;
    set.add(t.id);
    const mul = e.atkMul || 1;
    damage(t, h.dmg*mul, { src:e, kind:h.kind||'slash', power:h.power||1, kb:h.kb, up:h.up, stun:h.stun, dir,
      stop:h.stop, crit:!!h.crit, noDown:h.noDown, pull:h.pull, dizzy:h.dizzy, coins:h.coins });
  });
}

// ---------------------------------------------------------------- damage & reactions
function damage(t, amount, info){
  info = info || {};
  if(!t || t.dead) return false;
  const src = info.src || null;
  const dir = info.dir || (src ? U.sign(t.x - src.x) : 1);
  // hooks: dodge (just dodge), block (shields), phasing — return false to cancel
  if(t.onBeforeHit){ try { if(t.onBeforeHit(info)===false) return false; } catch(err){ G.logError('onBeforeHit', err); } }
  if(t.def && t.def.block){ let r=false; try { r = t.def.block(t, info); } catch(err){ G.logError('block', err); }
    if(r){ t.vx += dir*0.05; t.flashT = 2; G.bus.emit('hit', { src, target:t, x:t.x - dir*t.radius*0.6, y:t.y+t.height*0.55, z:t.z+0.3, dmg:0, kind:'block', power:1, dir, blocked:true });
      G.hitStop = Math.max(G.hitStop, 3); return false; } }

  // props: count hits, not damage
  if(t.kind==='prop'){
    t.hp -= 1; t.flashT = 6; t.wobble = 1; t.hurtDir = dir;
    G.bus.emit('hit', { src, target:t, x:t.x, y:t.y+0.5, z:t.z+0.3, dmg:0, kind:'blunt', power:1, dir, prop:true });
    G.hitStop = Math.max(G.hitStop, 2);
    if(t.hp<=0) G.props.break(t);
    return true;
  }

  const D = diff();
  let dmg = amount;
  if(src && src.team===0 && t.team===1) dmg *= D.heroDmg;
  if(src && src.team===1 && t.team===0) dmg *= D.foeDmg;
  if(t.team===0 && t.guardMul) dmg *= t.guardMul;
  dmg = Math.max(1, Math.round(dmg));
  const launchReq = (info.up||0) > 0 || (t.y > 0.05 && !t.def?.boss) || (info.power||1) >= 3;
  t.hp -= dmg;
  // bosses get hit constantly: a short flash keeps them readable instead of permanently white
  t.flashT = (t.def && t.def.boss) ? 2 : 6; t.hpShowT = 180; t.hurtDir = dir; t.lastHitBy = src;
  const x = t.x - dir*t.radius*0.4, y = t.y + t.height*0.55, z = t.z + 0.35;
  const stop = info.stop!=null ? info.stop : hitstopFor(dmg, launchReq);
  G.hitStop = Math.max(G.hitStop, stop + (t.hp<=0 ? 3 : 0));
  const power = info.power || 1;
  if(G.cam){ G.cam.shake(Math.min(6, 0.8 + dmg*0.12 + (power-1)*1.2), 8 + power*3); if(dmg>=22 || power>=3) G.cam.kick(0.6, 10); }
  G.bus.emit('hit', { src, target:t, x, y, z, dmg, kind:info.kind||'blunt', power, dir, crit:!!info.crit });
  if(t.team===0) G.bus.emit('hurt', { ent:t, dmg });
  if(src && src.team===0 && t.team===1 && G.game && G.game.onHeroHit) G.game.onHeroHit(src, t, dmg, info);
  if(info.coins && t.team===1 && G.pickups){ for(let i=0;i<info.coins;i++) G.pickups.spawn('coin', t.x, t.z, { burst:true }); }

  if(t.def && t.def.onHurt && t.hp>0){ try { t.def.onHurt(t, info); } catch(err){ G.logError('onHurt '+t.type, err); } }
  if(t.hp<=0){ t.hp = 0; ko(t, dir, info); return true; }

  // bosses: poise instead of flinching on every hit
  const def = t.def;
  if(t.team===1 && def && def.boss){
    // no poise build-up while already floored / getting up (otherwise the first hit after getup floors it again)
    if(t.state==='down' || t.state==='getup'){ return true; }
    t.poiseDmg = (t.poiseDmg||0) + dmg;
    const need = (def.poise || 60) * (t.poiseMul||1);
    if(t.poiseDmg >= need && t.state!=='down' && !t.noStagger){
      t.poiseDmg = 0;
      interrupt(t);
      G.setState(t, 'down'); t.downT = 0; t.vy = 0.18; t.vx = dir*0.06/Math.max(1,t.weight*0.5); t.onGround = false;
      G.bus.emit('down', { ent:t, boss:true });
      if(G.ui && G.ui.banner) G.ui.banner('チャンス！', '', 60);
    } else { t.vx += dir*0.02/Math.max(1, t.weight); }
    return true;
  }
  // super armour (heavy foes mid-attack, player during some moves)
  if(t.atkArmor && power<3){ t.vx += dir*0.02; return true; }
  if(t.armor>0 && power<2){ t.armorHits = (t.armorHits||0)+1; if(t.armorHits <= t.armor){ t.vx += dir*0.03; return true; } t.armorHits = 0; }

  interrupt(t);
  const w = Math.max(0.5, t.weight||1);
  if(info.dizzy){ G.setState(t, 'dizzy'); t.stun = info.dizzy; t.vx = 0; return true; }
  if(launchReq && !info.noDown){
    G.setState(t, 'down'); t.downT = 0;
    t.vy = Math.max(t.vy, (info.up>0 ? info.up : 0.16)/Math.sqrt(w));
    t.vx = dir*(info.kb==null ? 0.1 : info.kb)/w;
    t.onGround = false; t.bounce = power>=3 ? 1 : 0;
    G.bus.emit('down', { ent:t });
  } else {
    G.setState(t, 'hurt'); t.stun = info.stun || 16;
    t.vx = dir*(info.kb==null ? 0.06 : info.kb)/w;
    if(info.pull) t.vx = -dir*0.05;
  }
  return true;
}
function interrupt(t){
  if(t.atk){ t.atk = null; }
  t.atkArmor = false; t.pending = null;
  if(t.onInterrupt) try { t.onInterrupt(); } catch(err){ G.logError('onInterrupt', err); }
}
function ko(t, dir, info){
  interrupt(t);
  t.dead = true; t.deadT = 0;
  G.setState(t, 'ko');
  t.vy = 0.22; t.vx = dir*0.12/Math.max(1, (t.weight||1)*0.7); t.onGround = false; t.bounce = 1;
  if(t.team===1){
    t.ignoreForClear = true;
    const def = t.def || {};
    let handled = false;
    if(def.onKO){ try { handled = def.onKO(t)===true; } catch(err){ G.logError('onKO '+t.type, err); } }
    if(handled) return;
    G.bus.emit('ko', { ent:t, x:t.x, y:t.y+t.height*0.5, z:t.z });
    if(def.boss){ G.bus.emit('bossDown', { boss:t }); G.slowmo(50, 0.3); if(G.cam) G.cam.kick(1.2, 30); }
    else if(G.foesAlive()===0){ G.slowmo(24, 0.4); }
  } else if(t.team===0){
    G.bus.emit('heroKO', { ent:t });
  }
}

// ---------------------------------------------------------------- projectiles
function killProj(p, silent){
  if(p.dead) return; p.dead = true;
  if(p.vis){ if(p.vis.obj && p.vis.obj.parent) p.vis.obj.parent.remove(p.vis.obj); try{ p.vis.dispose && p.vis.dispose(); }catch(err){ G.logError('proj.dispose', err); } }
  if(!silent){
    if(p.boom){ const ar = G.combat.area(Object.assign({ owner:p.owner, team:p.team, x:p.x, y:0, z:p.z, delay:0, dur:3 }, p.boom));
      if(p.owner && p.owner.team===0 && p.owner.atkMul) ar.dmg *= p.owner.atkMul; }
    if(p.onEnd) try { p.onEnd(p); } catch(err){ G.logError('proj.onEnd', err); }
    if(G.fx && G.fx.burst) G.fx.burst(p.boom ? 'hitBig' : 'sparkle', p.x, p.y, p.z, { scale: p.boom ? 1.2 : 0.6 });
  }
}
function stepProjectiles(){
  const b = G.stage && G.stage.bounds ? G.stage.bounds() : null;
  for(let i=projectiles.length-1;i>=0;i--){
    const p = projectiles[i];
    if(p.dead){ projectiles.splice(i,1); continue; }
    if(p.homing && p.team===0){
      let best=null, bd=1e9; eachTarget(0, (t)=>{ if(t.team!==1) return; const d=Math.abs(t.x-p.x)+Math.abs(t.z-p.z); if(d<bd && U.sign(t.x-p.x)===U.sign(p.vx||1)){ bd=d; best=t; } });
      if(best){ p.vz += U.clamp((best.z-p.z)*0.02, -0.01, 0.01)*p.homing; p.vy += U.clamp((best.y+best.height*0.5-p.y)*0.01, -0.01, 0.01)*p.homing; }
    }
    p.vy += p.grav; p.vx *= p.drag; p.vz *= p.drag;
    p.x += p.vx; p.y += p.vy; p.z += p.vz; p.age++;
    if(p.vis){ p.vis.obj.position.set(p.x, p.y, p.z); try { p.vis.update && p.vis.update(p); } catch(err){ G.logError('proj.update', err); } }
    let end = p.age >= p.life;
    if(p.y <= 0.05 && p.vy < 0){
      if(p.onGround==='bounce'){ p.y = 0.05; p.vy = -p.vy*0.5; }
      else if(p.onGround==='slide'){ p.y = 0.05; p.vy = 0; }
      else end = true;
    }
    if(b && (p.x < b.xmin - 14 || p.x > b.xmax + 14)) end = true;
    if(!end){
      if(p.rehit && p.age % p.rehit === 0) p.sets.clear();
      eachTarget(p.team, (t)=>{
        if(p.dead || p.sets.has(t.id)) return;
        if(Math.abs(t.z - p.z) > p.r + t.radius*0.6) return;
        if(Math.abs(t.x - p.x) > p.r + t.radius) return;
        if(p.y < t.y - p.r || p.y > t.y + t.height + p.r) return;
        p.sets.add(t.id);
        const landed = damage(t, p.dmg, { src:p.owner, kind:p.hitKind, power:p.power, kb:p.kb, up:p.up, stun:p.stun, dir:U.sign(p.vx||t.x-p.x) });
        if(p.onHit) try { p.onHit(p, t, landed); } catch(err){ G.logError('proj.onHit', err); }
        if(landed){ if(p.pierce>0) p.pierce--; else end = true; }
        if(end){ killProj(p); }
      });
    }
    if(end && !p.dead) killProj(p);
    if(p.dead) projectiles.splice(i,1);
  }
}

// ---------------------------------------------------------------- areas
function stepAreas(){
  for(let i=areas.length-1;i>=0;i--){
    const a = areas[i];
    if(a.delay>0){ a.delay--; continue; }
    if(!a.fired){ a.fired = true; if(a.fx && G.fx && G.fx.burst) G.fx.burst(a.fx, a.x, a.y+0.1, a.z, { scale: a.r/1.5, color:a.color }); }
    const zr = a.zr!=null ? a.zr : a.r*0.6;
    eachTarget(a.team, (t)=>{
      if(a.sets.has(t.id)) return;
      const dx = (t.x - a.x)/(a.r + t.radius), dz = (t.z - a.z)/(zr + t.radius*0.5);
      if(dx*dx + dz*dz > 1) return;
      if(t.y + t.height < a.y + a.y0 || t.y > a.y + a.y1) return;
      a.sets.add(t.id);
      damage(t, a.dmg, { src:a.owner, kind:a.kind, power:a.power, kb:a.kb, up:a.up, stun:a.stun, dir: a.dir || U.sign(t.x - a.x), dizzy:a.dizzy, coins:a.coins });
    });
    a.dur--;
    if(a.dur<=0) areas.splice(i,1);
  }
}

// ---------------------------------------------------------------- pickups
const PICK = {
  bone:  { heal:0.25, xp:0 },
  cake:  { heal:0.6 },
  heart: { heal:1.0 },
  coin:  { coins:1 },
  gem:   { coins:10 },
  star:  { sp:1.0 },
};
function pickupRig(kind){
  const m = G.look.pickupMesh(kind);
  return {
    root: m.obj, height:0.5, radius:0.25,
    update(e){ const t = G.time.tick + e.id*17; m.mesh.rotation.y = t*0.06; m.mesh.position.y = 0.25 + Math.sin(t*0.08)*0.06;
      const blink = e.life < 150 && Math.floor(e.life/6)%2===0; m.obj.visible = !blink; },
    dispose(){ m.dispose(); },
  };
}
G.pickups = {
  spawn(kind, x, z, opts){
    opts = opts || {};
    const e = G.makeEnt({ kind:'pickup', type:kind, team:3, x, z: U.clamp(z, G.cfg.ZMIN, G.cfg.ZMAX), y: opts.y || 0.3,
      radius:0.25, height:0.5, rig: pickupRig(kind), life: opts.life || 1200, gravScale:0.8, noShadow:false, shadowAlpha:0.3 });
    const burst = opts.burst !== false;
    if(burst){ e.vy = 0.14 + Math.random()*0.06; e.vx = (Math.random()-0.5)*0.12; e.vz = (Math.random()-0.5)*0.08; e.bounce = 1; }
    e.delay = opts.delay || 18;
    G.world.add(e);
    return e;
  },
  tick(e){
    e.life--; if(e.delay>0) e.delay--;
    if(e.life<=0){ e.removeMe = true; return; }
    const p = G.player;
    if(!p || p.dead || e.delay>0) return;
    const dx = p.x - e.x, dz = p.z - e.z, d = Math.hypot(dx, dz);
    const won = G.scenes && G.scenes.play && G.scenes.play.cleared;
    const magnet = won ? 1e9 : (e.type==='coin' || e.type==='gem' || e.type==='star' ? 2.2 : 1.2);
    if(d < magnet && (e.onGround || won)){ const sp = won ? 0.3 : 0.12; e.x += dx/d*Math.min(d, sp); e.z += dz/d*Math.min(d, sp); }
    if(d < 0.55 && Math.abs(p.y - e.y) < 1.2) collect(e, p);
  },
};
function collect(e, p){
  const k = PICK[e.type] || {};
  let value = 0;
  if(k.heal){ const before = p.hp; p.hp = Math.min(p.maxHp, p.hp + Math.ceil(p.maxHp*k.heal)); value = p.hp - before; }
  if(k.coins && G.game){ G.game.coins += k.coins; value = k.coins; }
  if(k.sp){ p.sp = Math.min(3, (p.sp||0) + k.sp); value = k.sp; }
  G.bus.emit('pickup', { ent:p, kind:e.type, x:e.x, y:e.y+0.3, z:e.z, value });
  e.removeMe = true;
}

// ---------------------------------------------------------------- breakable props
function propRig(kind){
  const m = G.look.propMesh(kind);
  return {
    root: m.obj, height: kind==='pot'?0.7:0.9, radius:0.45,
    update(e){ if(e.wobble>0){ e.wobble *= 0.86; if(e.wobble<0.01) e.wobble=0; }
      const w = e.wobble||0; m.mesh.rotation.z = Math.sin(G.time.tick*0.9)*0.25*w; m.mesh.scale.set(1+w*0.12, 1-w*0.1, 1+w*0.12);
      if(m.mat.userData.uFlash) m.mat.userData.uFlash.value = e.flashT>0 ? 0.6 : 0; },
    dispose(){ m.dispose(); },
  };
}
G.props = {
  spawn(kind, x, z, drop){
    const e = G.makeEnt({ kind:'prop', type:kind, team:2, x, z, hp: kind==='crystal'?3:2, maxHp:2, radius:0.45,
      height:0.9, weight:99, rig: propRig(kind), drop: drop || null, shadowAlpha:0.35 });
    G.world.add(e);
    return e;
  },
  break(e){
    if(e.dead) return;
    e.dead = true; e.removeMe = true;
    if(G.fx && G.fx.burst){ G.fx.burst('poof', e.x, 0.5, e.z, { scale:1 }); G.fx.burst('stars', e.x, 0.6, e.z, { count:6 }); }
    G.bus.emit('propBreak', { ent:e, kind:e.type, x:e.x, z:e.z });
    if(G.audio && G.audio.sfx) G.audio.sfx('pop');
    const drops = e.drop ? [].concat(e.drop) : [G.rng()<0.5 ? 'coin' : (G.rng()<0.5 ? 'bone' : 'star')];
    for(const d of drops){
      const n = d==='coin' ? 3 : 1;
      for(let i=0;i<n;i++) G.pickups.spawn(d, e.x, e.z);
    }
  },
};
})();

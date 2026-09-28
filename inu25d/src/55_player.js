// 55_player.js — 主人公の操作と、7人ぶんの技表（リード担当）。
// 連打コンボ／ためこうげき／ジャンプ・二段ジャンプ・ふみつけ／空中こうげき・急降下／よける・ジャストよけ／
// ひっさつ（✦を1つ使う、方向で3種）／おうぎ（ゲージ満タンで、カットイン→画面ぜんぶ）。
(function(){ 'use strict';
const G = window.G; const THREE = window.THREE; const U = G.U;

// ---------------------------------------------------------------- attack-def helper
function A(o){
  return Object.assign({ len:18, hits:[], cancel: Math.max(6, Math.round((o.len||18)*0.6)) }, o);
}
function H(o){ return Object.assign({ at:5, dur:3, x0:0.1, x1:1.3, zr:0.7, y0:0, y1:1.7, dmg:8, kb:0.06, stun:16, kind:'slash', power:1 }, o); }
const AIR = { y0:-0.9, y1:1.4 };

// every foe currently on screen (for ultimates)
function foesInView(){
  const vr = G.cam.viewRange(), out = [];
  for(const e of G.world.ents) if(e.team===1 && !e.dead && e.x > vr[0]-0.5 && e.x < vr[1]+0.5) out.push(e);
  return out;
}
function viewArea(e, o){
  const vr = G.cam.viewRange();
  return G.combat.area(Object.assign({ owner:e, x:(vr[0]+vr[1])/2, y:0, z:(G.cfg.ZMIN+G.cfg.ZMAX)/2, r:(vr[1]-vr[0])/2+1.5,
    zr:(G.cfg.ZMAX-G.cfg.ZMIN), y0:-1, y1:8, dur:2 }, o));
}
function fxb(kind, x, y, z, o){ if(G.fx && G.fx.burst) G.fx.burst(kind, x, y, z, o); }
function rainFrom(e, kind, o){
  const vr = G.cam.viewRange();
  const x = U.rand(vr[0]+0.5, vr[1]-0.5), z = U.rand(G.cfg.ZMIN, G.cfg.ZMAX);
  G.combat.shoot(Object.assign({ owner:e, kind, x: x - 1.2, y: 9, z, vx: 0.1, vy: -0.34, dmg: 7, r:0.5, power:2, up:0.12, life:60,
    boom:{ r:1.1, dmg:5, power:1, kind:'star', up:0.1, fx:'ring' } }, o||{}));
}

// ---------------------------------------------------------------- move tables
const MOVES = {
  inu: {
    stats:{ hp:1.0, atk:1.0, spd:1.0, jump:1.0 }, trail:'#bfe6ff',
    combo:[
      A({ id:'inu_a1', anim:'atk1', len:16, cancel:9,  move:[{at:3,vx:0.07}], hits:[H({ at:5, dmg:8 })] }),
      A({ id:'inu_a2', anim:'atk2', len:17, cancel:10, move:[{at:3,vx:0.07}], hits:[H({ at:5, dmg:9 })] }),
      A({ id:'inu_a3', anim:'atk3', len:18, cancel:11, move:[{at:3,vx:0.08}], hits:[H({ at:6, dmg:10 })] }),
      A({ id:'inu_a4', anim:'atk4', len:28, cancel:20, move:[{at:5,vx:0.12}], hits:[H({ at:9, dur:4, x0:0, x1:1.55, dmg:16, up:0.2, kb:0.16, power:2, stop:7 })] }),
    ],
    charge: A({ id:'inu_c', anim:'chargeAtk', len:34, cancel:28, hits:[H({ at:8, dur:12, rehit:6, x0:-1.35, x1:1.35, zr:0.9, dmg:12, up:0.18, kb:0.12, power:2 })] }),
    air:[ A({ id:'inu_j1', anim:'airAtk', len:16, cancel:9, hits:[H(Object.assign({ at:4, dur:4, dmg:8, up:0.1 }, AIR))] }),
          A({ id:'inu_j2', anim:'airAtk2', len:16, cancel:9, hits:[H(Object.assign({ at:4, dur:4, dmg:9, up:0.1 }, AIR))] }) ],
    dive: A({ id:'inu_dv', anim:'dive', len:30, move:[{at:2, vy:-0.3, vx:0.1}], hits:[H({ at:3, dur:22, x0:-0.3, x1:1.0, y0:-0.6, y1:0.9, dmg:12, up:0.15, power:2 })] }),
    sp:{
      n:   A({ id:'inu_sn', anim:'special', len:26, name:'しんくうは', proj:[{ at:8, kind:'wave', vx:0.32, dmg:12, r:0.55, pierce:3, life:55, power:2, up:0.08, oy:0.7 }] }),
      up:  A({ id:'inu_su', anim:'specialUp', len:36, name:'てんしょうざん', move:[{at:4, vy:0.24, vx:0.04}], hits:[H({ at:4, dur:14, rehit:6, x0:0, x1:1.25, y1:2.2, dmg:10, up:0.26, power:2, kind:'slash' })] }),
      fwd: A({ id:'inu_sf', anim:'specialDash', len:30, name:'しっそういあい', inv:[2,18], move:[{at:3, vx:0.42, until:15}], hits:[H({ at:4, dur:13, x0:-0.6, x1:1.1, dmg:14, kb:0.1, power:2 })] }),
    },
    ult:{ name:'じげんざん', kind:'slash', build(e){ return A({ id:'inu_ult', anim:'ult', len:96, fn(p,t){
      if(t%8===0 && t<80){ viewArea(p, { dmg:6, power:1, kind:'slash', up:0.06, kb:0.02, stun:30 }); for(const f of foesInView()) fxb('slash', f.x, f.y+0.7, f.z, { color:'#c46bff' }); }
      if(t===84){ viewArea(p, { dmg:30, power:3, kind:'slash', up:0.26, kb:0.12 }); G.cam.shake(6, 24); if(G.fx&&G.fx.flash) G.fx.flash('#e6c8ff', 0.7, 10); }
    } }); } },
  },
  shima: {
    stats:{ hp:0.95, atk:0.95, spd:1.1, jump:1.05 }, trail:'#ffd08a',
    combo:[
      A({ id:'sh_a1', anim:'atk1', len:12, cancel:7, move:[{at:2,vx:0.06}], hits:[H({ at:3, dur:3, x1:1.05, dmg:5, kind:'blunt', stun:14 })] }),
      A({ id:'sh_a2', anim:'atk2', len:12, cancel:7, move:[{at:2,vx:0.06}], hits:[H({ at:3, dur:3, x1:1.05, dmg:5, kind:'blunt', stun:14 })] }),
      A({ id:'sh_a3', anim:'atk3', len:14, cancel:8, move:[{at:3,vx:0.07}], hits:[H({ at:4, dur:3, x1:1.1, dmg:7, kind:'blunt' })] }),
      A({ id:'sh_a4', anim:'atk4', len:24, cancel:18, move:[{at:4,vx:0.1}], hits:[H({ at:7, dur:4, x1:1.3, dmg:14, up:0.2, kb:0.17, kind:'blunt', power:2, stop:7 })] }),
    ],
    charge: A({ id:'sh_c', anim:'chargeAtk', len:30, cancel:24, move:[{at:6,vx:0.14}], hits:[H({ at:8, dur:5, x1:1.5, dmg:22, kb:0.3, up:0.12, kind:'blunt', power:3 })] }),
    air:[ A({ id:'sh_j1', anim:'airAtk', len:13, cancel:7, hits:[H(Object.assign({ at:3, dur:4, x1:1.1, dmg:6, up:0.1, kind:'blunt' }, AIR))] }),
          A({ id:'sh_j2', anim:'airAtk2', len:15, cancel:8, hits:[H(Object.assign({ at:4, dur:4, x1:1.2, dmg:8, up:0.12, kind:'blunt' }, AIR))] }) ],
    dive: A({ id:'sh_dv', anim:'dive', len:28, move:[{at:2, vy:-0.32, vx:0.14}], hits:[H({ at:3, dur:20, x0:-0.2, x1:1.1, y0:-0.6, y1:0.9, dmg:11, up:0.14, kind:'blunt', power:2 })] }),
    sp:{
      n:   A({ id:'sh_sn', anim:'special', len:26, name:'はどうけん', proj:[{ at:9, kind:'ball', vx:0.28, dmg:13, r:0.5, life:60, power:2, up:0.1, kb:0.14, oy:0.65 }] }),
      up:  A({ id:'sh_su', anim:'specialUp', len:38, name:'れっかしょうりゅうきゃく', move:[{at:3, vy:0.27, vx:0.05}], hits:[H({ at:3, dur:18, rehit:5, x0:-0.2, x1:1.1, y1:2.4, dmg:7, up:0.24, kind:'fire', power:2 })] }),
      fwd: A({ id:'sh_sf', anim:'specialDash', len:34, name:'せんぷうきゃく', move:[{at:2, vx:0.2, until:28}], hits:[H({ at:3, dur:26, rehit:5, x0:-1.0, x1:1.0, dmg:5, kb:0.05, kind:'wind', power:1 })] }),
    },
    ult:{ name:'ひゃくれつ にくきゅうパンチ', kind:'blunt', build(e){ const home = { x:e.x, z:e.z }; return A({ id:'sh_ult', anim:'ult', len:92, fn(p,t){
      if(t===0){ home.x=p.x; home.z=p.z; }
      if(t<72 && t%3===0){ const fs = foesInView(); const f = fs.length ? fs[Math.floor(G.rng()*fs.length)] : null; const vr = G.cam.viewRange();
        const nx = f ? f.x - p.face*0.9 : U.rand(vr[0]+1, vr[1]-1); p.x = U.clamp(nx, vr[0]+0.6, vr[1]-0.6); p.z = f ? f.z : U.rand(G.cfg.ZMIN, G.cfg.ZMAX);
        p.face = f ? U.sign(f.x - p.x) : p.face; G.setAnim(p, (t/3)%2 ? 'atk1':'atk2', 6, 0.4); fxb('stars', p.x, 0.8, p.z, { count:3, color:'#ffd24d' });
        if(f) G.combat.damage(f, 3, { src:p, kind:'blunt', power:1, stun:30, dir:p.face, stop:0 }); }
      if(t===76){ p.x = home.x; p.z = home.z; G.setAnim(p, 'ult', 16, 0.3); viewArea(p, { dmg:28, power:3, kind:'blunt', up:0.28, kb:0.14 }); G.cam.shake(6,24); if(G.fx&&G.fx.flash) G.fx.flash('#fff0b0', 0.7, 10); }
    } }); } },
  },
  nuko: {
    stats:{ hp:0.85, atk:1.0, spd:0.95, jump:1.0 }, trail:'#ffb3e0',
    combo:[
      A({ id:'nk_a1', anim:'atk1', len:15, cancel:9,  proj:[{ at:5, kind:'star', vx:0.3, dmg:6, r:0.4, life:40, power:1, oy:0.75 }] }),
      A({ id:'nk_a2', anim:'atk2', len:15, cancel:9,  proj:[{ at:5, kind:'star', vx:0.3, dmg:6, r:0.4, life:40, power:1, oy:0.75 }] }),
      A({ id:'nk_a3', anim:'atk3', len:17, cancel:10, proj:[{ at:6, kind:'star', vx:0.3, dmg:5, r:0.4, life:40, power:1, oy:0.75, count:3, spread:0.05 }] }),
      A({ id:'nk_a4', anim:'atk4', len:26, cancel:20, areas:[{ at:9, ox:1.3, r:1.0, dmg:14, power:2, kind:'magic', up:0.22, kb:0.12, fx:'magic' }] }),
    ],
    charge: A({ id:'nk_c', anim:'chargeAtk', len:30, cancel:24, proj:[{ at:10, kind:'star', vx:0.26, dmg:20, r:0.8, pierce:6, life:70, power:3, up:0.16, oy:0.8 }] }),
    air:[ A({ id:'nk_j1', anim:'airAtk', len:15, cancel:9, proj:[{ at:5, kind:'star', vx:0.26, vy:-0.12, dmg:6, r:0.4, life:40, oy:0.6 }] }),
          A({ id:'nk_j2', anim:'airAtk2', len:15, cancel:9, proj:[{ at:5, kind:'star', vx:0.26, vy:-0.12, dmg:6, r:0.4, life:40, oy:0.6 }] }) ],
    dive: A({ id:'nk_dv', anim:'dive', len:30, move:[{at:2, vy:-0.3, vx:0.06}], areas:[{ at:14, r:1.4, dmg:10, power:2, kind:'magic', up:0.18, fx:'ring' }], hits:[H({ at:3, dur:10, x0:-0.4, x1:0.8, y0:-0.6, y1:0.9, dmg:8, kind:'magic' })] }),
    sp:{
      n:   A({ id:'nk_sn', anim:'special', len:26, name:'ひょうけつまだん', proj:[{ at:8, kind:'ice', vx:0.3, dmg:8, r:0.45, life:50, power:2, count:3, spread:0.06, stun:30, oy:0.75 }] }),
      up:  A({ id:'nk_su', anim:'specialUp', len:34, name:'せいしんしょうか', areas:[{ at:8, r:1.5, dmg:8, power:2, kind:'star', up:0.26, fx:'magic' }, { at:18, r:1.6, dmg:8, power:2, kind:'star', up:0.24 }] }),
      fwd: A({ id:'nk_sf', anim:'specialDash', len:36, name:'サンダーボルト', areas:[{ at:10, ox:1.8, r:0.9, dmg:9, power:2, kind:'thunder', stun:30, fx:'shock' }, { at:16, ox:3.1, r:0.9, dmg:9, power:2, kind:'thunder', stun:30, fx:'shock' }, { at:22, ox:4.4, r:0.9, dmg:9, power:2, kind:'thunder', stun:30, fx:'shock' }] }),
    },
    ult:{ name:'ほしふるよる', kind:'star', build(e){ return A({ id:'nk_ult', anim:'ult', len:110, fn(p,t){
      if(t>8 && t<96 && t%3===0) rainFrom(p, 'star', { dmg:6 });
      if(t===100){ viewArea(p, { dmg:24, power:3, kind:'star', up:0.26, kb:0.1 }); if(G.fx&&G.fx.flash) G.fx.flash('#fff6c0', 0.6, 10); G.cam.shake(5,20); }
    } }); } },
  },
  guard8: {
    stats:{ hp:1.35, atk:1.2, spd:0.82, jump:0.9 }, trail:'#e2e6ee', armorAtk:true,
    combo:[
      A({ id:'g8_a1', anim:'atk1', len:24, cancel:15, armor:true, move:[{at:8,vx:0.06}], hits:[H({ at:10, dur:4, x0:0, x1:1.75, zr:0.85, dmg:14, kb:0.12, kind:'blunt', power:2, stun:22 })] }),
      A({ id:'g8_a2', anim:'atk2', len:26, cancel:16, armor:true, move:[{at:8,vx:0.06}], hits:[H({ at:11, dur:4, x0:-0.3, x1:1.8, zr:0.85, dmg:15, kb:0.12, kind:'blunt', power:2, stun:22 })] }),
      A({ id:'g8_a3', anim:'atk3', len:38, cancel:30, armor:true, hits:[H({ at:16, dur:4, x0:0, x1:1.95, zr:0.9, dmg:22, up:0.24, kb:0.14, kind:'blunt', power:3, stop:9 })],
        areas:[{ at:17, ox:1.5, r:1.5, dmg:8, power:1, kind:'blunt', up:0.12, fx:'ring' }] }),
    ],
    charge: A({ id:'g8_c', anim:'chargeAtk', len:40, cancel:34, armor:true, move:[{at:4, vy:0.18}], areas:[{ at:26, ox:0.8, r:2.4, dmg:24, power:3, kind:'blunt', up:0.26, fx:'ring' }] }),
    air:[ A({ id:'g8_j1', anim:'airAtk', len:20, cancel:12, hits:[H(Object.assign({ at:6, dur:5, x1:1.6, dmg:12, up:0.1, kind:'blunt', power:2 }, AIR))] }),
          A({ id:'g8_j2', anim:'airAtk2', len:20, cancel:12, hits:[H(Object.assign({ at:6, dur:5, x1:1.6, dmg:12, up:0.1, kind:'blunt', power:2 }, AIR))] }) ],
    dive: A({ id:'g8_dv', anim:'dive', len:34, move:[{at:2, vy:-0.36, vx:0.06}], hits:[H({ at:3, dur:14, x0:-0.3, x1:1.2, y0:-0.6, y1:0.9, dmg:14, up:0.15, kind:'blunt', power:2 })], areas:[{ at:12, r:1.8, dmg:10, power:2, kind:'blunt', up:0.16, fx:'ring' }] }),
    sp:{
      n:   A({ id:'g8_sn', anim:'special', len:32, name:'ハンマーしょうげきは', armor:true, proj:[{ at:12, kind:'rock', vx:0.22, dmg:14, r:0.6, pierce:6, life:55, power:2, up:0.2, oy:0.2, onGround:'slide' }] }),
      up:  A({ id:'g8_su', anim:'specialUp', len:36, name:'てんしょうハンマー', armor:true, hits:[H({ at:10, dur:8, x0:-0.2, x1:1.7, y1:2.6, dmg:16, up:0.3, kind:'blunt', power:2 })] }),
      fwd: A({ id:'g8_sf', anim:'specialDash', len:36, name:'タックル', armor:true, move:[{at:4, vx:0.3, until:24}], hits:[H({ at:5, dur:20, rehit:8, x0:0, x1:1.2, dmg:12, kb:0.22, kind:'blunt', power:2 })] }),
    },
    ult:{ name:'メガトンクエイク', kind:'blunt', build(e){ return A({ id:'g8_ult', anim:'ult', len:84, move:[{at:6, vy:0.42}], fn(p,t){
      if(t>6 && t<40){ p.vy = Math.max(p.vy, 0.02); }
      if(t===40){ p.vy = -0.6; }
      if(t===52 || (t>44 && t<60 && p.onGround && !p._ultSlam)){ if(!p._ultSlam){ p._ultSlam = true; viewArea(p, { dmg:34, power:3, kind:'blunt', up:0.3, kb:0.1 }); G.cam.shake(9, 30); G.cam.kick(1.2, 16);
        if(G.fx){ G.fx.flash && G.fx.flash('#fff2c0', 0.6, 8); fxb('shock', p.x, 0.1, p.z, { scale:3 }); } } }
      if(t===83) p._ultSlam = false;
    } }); } },
  },
  watch: {
    stats:{ hp:0.8, atk:0.85, spd:1.22, jump:1.15 }, trail:'#ffe0f0',
    combo:[
      A({ id:'wt_a1', anim:'atk1', len:11, cancel:6, move:[{at:2,vx:0.07}], hits:[H({ at:3, dur:3, x1:1.15, dmg:5, stun:14 })] }),
      A({ id:'wt_a2', anim:'atk2', len:11, cancel:6, move:[{at:2,vx:0.07}], hits:[H({ at:3, dur:3, x1:1.15, dmg:5, stun:14 })] }),
      A({ id:'wt_a3', anim:'atk3', len:13, cancel:7, move:[{at:2,vx:0.08}], hits:[H({ at:4, dur:3, x1:1.2, dmg:6 })] }),
      A({ id:'wt_a4', anim:'atk4', len:24, cancel:18, hits:[H({ at:5, dur:12, rehit:5, x0:-0.8, x1:1.2, dmg:5, up:0.18, kb:0.1, power:2, kind:'slash' })] }),
    ],
    charge: A({ id:'wt_c', anim:'chargeAtk', len:28, cancel:22, proj:[{ at:8, kind:'card', vx:0.36, dmg:7, r:0.4, life:45, power:1, count:5, spread:0.045, oy:0.7 }] }),
    air:[ A({ id:'wt_j1', anim:'airAtk', len:12, cancel:7, hits:[H(Object.assign({ at:3, dur:4, x1:1.1, dmg:5, up:0.1 }, AIR))] }),
          A({ id:'wt_j2', anim:'airAtk2', len:12, cancel:7, hits:[H(Object.assign({ at:3, dur:4, x1:1.1, dmg:6, up:0.1 }, AIR))] }) ],
    dive: A({ id:'wt_dv', anim:'dive', len:26, move:[{at:2, vy:-0.32, vx:0.16}], hits:[H({ at:3, dur:18, x0:-0.2, x1:1.0, y0:-0.6, y1:0.9, dmg:9, up:0.14, power:2 })] }),
    sp:{
      n:   A({ id:'wt_sn', anim:'special', len:22, name:'トランプなげ', proj:[{ at:6, kind:'card', vx:0.38, dmg:7, r:0.4, life:45, power:1, count:3, spread:0.05, oy:0.7 }] }),
      up:  A({ id:'wt_su', anim:'specialUp', len:30, name:'けむりだま', areas:[{ at:8, r:1.9, dmg:3, power:1, kind:'pop', dizzy:110, fx:'poof' }] }),
      fwd: A({ id:'wt_sf', anim:'specialDash', len:28, name:'スライディング', move:[{at:2, vx:0.34, until:18}], inv:[2,12], hits:[H({ at:3, dur:16, x0:-0.2, x1:1.0, y1:0.9, dmg:8, up:0.14, power:2, kind:'blunt', coins:1 })] }),
    },
    ult:{ name:'かみふぶきロックンロール', kind:'pop', build(e){ return A({ id:'wt_ult', anim:'ult', len:100, fn(p,t){
      if(t>10 && t<90 && t%2===0){ const ang = Math.sin(t*0.12)*0.9; G.combat.shoot({ owner:p, kind:'confetti', x:p.x+p.face*0.7, y:0.8, z:p.z,
        vx:p.face*0.42, vz:ang*0.07, vy:0.01, dmg:3, r:0.45, pierce:3, life:40, power:1, stun:24 }); }
      if(t===92){ viewArea(p, { dmg:22, power:3, kind:'pop', up:0.26 }); fxb('confetti', p.x+p.face*3, 2.5, p.z, { count:40 }); }
    } }); } },
  },
  wanden: {
    stats:{ hp:0.95, atk:1.1, spd:0.96, jump:1.0 }, trail:'#ffffff',
    combo:[
      A({ id:'wd_a1', anim:'atk1', len:18, cancel:11, move:[{at:3,vx:0.06}], hits:[H({ at:6, dur:3, x1:1.35, dmg:8, kind:'blunt' })] }),
      A({ id:'wd_a2', anim:'atk2', len:20, cancel:12, move:[{at:3,vx:0.08}], hits:[H({ at:6, dur:3, x0:0, x1:2.15, zr:0.6, dmg:12 })] }),
      A({ id:'wd_a3', anim:'atk3', len:32, cancel:26, hits:[H({ at:6, dur:14, rehit:4, x0:0, x1:2.0, zr:0.7, dmg:4, stun:20 }), H({ at:22, dur:3, x0:0, x1:2.1, zr:0.7, dmg:10, up:0.2, kb:0.14, power:2 })] }),
    ],
    charge: A({ id:'wd_c', anim:'chargeAtk', len:32, cancel:26, move:[{at:6, vx:0.5, until:12}], inv:[4,14], hits:[H({ at:8, dur:8, x0:-2.5, x1:1.2, zr:0.7, dmg:24, kb:0.08, power:3, stop:10 })] }),
    air:[ A({ id:'wd_j1', anim:'airAtk', len:17, cancel:10, hits:[H(Object.assign({ at:5, dur:4, x1:1.9, dmg:9, up:0.1 }, AIR))] }),
          A({ id:'wd_j2', anim:'airAtk2', len:17, cancel:10, hits:[H(Object.assign({ at:5, dur:4, x1:1.9, dmg:9, up:0.1 }, AIR))] }) ],
    dive: A({ id:'wd_dv', anim:'dive', len:30, move:[{at:2, vy:-0.3, vx:0.12}], hits:[H({ at:3, dur:20, x0:-0.2, x1:1.4, y0:-0.6, y1:0.9, dmg:12, up:0.15, power:2 })] }),
    sp:{
      n:   A({ id:'wd_sn', anim:'special', len:30, name:'やえがすみ', areas:[{ at:10, ox:2.4, r:0.9, dmg:12, power:2, kind:'slash', fx:'slash' }, { at:16, ox:3.5, r:0.9, dmg:12, power:2, kind:'slash', fx:'slash' }, { at:22, ox:4.6, r:1.0, dmg:14, power:2, kind:'slash', up:0.18, fx:'slash' }] }),
      up:  A({ id:'wd_su', anim:'specialUp', len:34, name:'つばめがえし', move:[{at:4, vy:0.22}], hits:[H({ at:4, dur:12, rehit:6, x0:0, x1:1.9, y1:2.3, dmg:11, up:0.26, power:2 })] }),
      fwd: A({ id:'wd_sf', anim:'specialDash', len:30, name:'しゅくち', inv:[1,14], move:[{at:2, vx:0.62, until:9}], hits:[H({ at:11, dur:4, x0:-3.2, x1:0.6, zr:0.8, dmg:18, kb:0.1, power:2, stop:8 })] }),
    },
    ult:{ name:'ひけん・めんきょかいでん', kind:'slash', build(e){ const home={x:0,z:0}; let list=[]; return A({ id:'wd_ult', anim:'ult', len:100, fn(p,t){
      if(t===0){ home.x=p.x; home.z=p.z; list = foesInView().slice(0, 10); }
      const k = Math.floor((t-4)/7);
      if(t>=4 && (t-4)%7===0 && k < list.length){ const f = list[k]; if(!f.dead){ p.x = f.x - p.face*1.0; p.z = f.z; G.setAnim(p, 'atk2', 7, 0.3);
        G.combat.damage(f, 6, { src:p, kind:'slash', power:2, stun:60, dir:p.face, stop:2 }); fxb('slash', f.x, f.y+0.7, f.z, { color:'#ffffff' }); } }
      if(t===80){ p.x = home.x; p.z = home.z; G.setAnim(p, 'ult', 20, 0.5); if(G.fx&&G.fx.text) G.fx.text('…のうとう。', p.x, 2.2, p.z, 'info'); }
      if(t===92){ viewArea(p, { dmg:30, power:3, kind:'slash', up:0.28, kb:0.12 }); if(G.fx&&G.fx.flash) G.fx.flash('#ffffff', 0.8, 10); G.cam.shake(6,20); }
    } }); } },
  },
  mack: {
    stats:{ hp:0.9, atk:1.0, spd:1.0, jump:1.0 }, trail:'#ffe08a',
    combo:[
      A({ id:'mk_a1', anim:'atk1', len:12, cancel:7, proj:[{ at:4, kind:'cork', vx:0.45, dmg:6, r:0.35, life:34, power:1, oy:0.7 }] }),
      A({ id:'mk_a2', anim:'atk2', len:12, cancel:7, proj:[{ at:4, kind:'cork', vx:0.45, dmg:6, r:0.35, life:34, power:1, oy:0.7 }] }),
      A({ id:'mk_a3', anim:'atk3', len:12, cancel:7, proj:[{ at:4, kind:'cork', vx:0.45, dmg:6, r:0.35, life:34, power:1, oy:0.7 }] }),
      A({ id:'mk_a4', anim:'atk4', len:26, cancel:20, move:[{at:6, vx:-0.08}], proj:[{ at:6, kind:'cork', vx:0.5, dmg:14, r:0.5, life:40, power:2, up:0.16, kb:0.2, oy:0.7 }] }),
    ],
    charge: A({ id:'mk_c', anim:'chargeAtk', len:30, cancel:24, move:[{at:8, vx:-0.12}], proj:[{ at:8, kind:'cork', vx:0.5, dmg:20, r:0.8, pierce:5, life:45, power:3, up:0.16, kb:0.2, oy:0.7 }] }),
    air:[ A({ id:'mk_j1', anim:'airAtk', len:13, cancel:8, proj:[{ at:4, kind:'cork', vx:0.42, vy:-0.1, dmg:6, r:0.35, life:34, oy:0.6 }] }),
          A({ id:'mk_j2', anim:'airAtk2', len:13, cancel:8, proj:[{ at:4, kind:'cork', vx:0.42, vy:-0.1, dmg:6, r:0.35, life:34, oy:0.6 }] }) ],
    dive: A({ id:'mk_dv', anim:'dive', len:28, move:[{at:2, vy:-0.3, vx:0.1}], hits:[H({ at:3, dur:18, x0:-0.2, x1:1.0, y0:-0.6, y1:0.9, dmg:10, up:0.14, kind:'blunt', power:2 })] }),
    sp:{
      n:   A({ id:'mk_sn', anim:'special', len:28, name:'スターばくだん', proj:[{ at:8, kind:'firework', vx:0.15, vy:0.2, grav:-0.012, dmg:6, r:0.45, life:80, power:1, oy:0.9,
             boom:{ r:1.5, dmg:14, power:2, kind:'pop', up:0.2, fx:'fireworks' } }] }),
      up:  A({ id:'mk_su', anim:'specialUp', len:34, name:'ロケットはなび', move:[{at:4, vy:0.25}], proj:[{ at:6, kind:'firework', vx:0.18, vy:0.18, dmg:10, r:0.5, life:30, power:2, up:0.2,
             boom:{ r:1.3, dmg:10, power:2, kind:'pop', up:0.2, fx:'fireworks' } }], hits:[H({ at:4, dur:10, x0:-0.3, x1:1.0, y1:2.0, dmg:8, up:0.24, kind:'pop', power:2 })] }),
      fwd: A({ id:'mk_sf', anim:'specialDash', len:32, name:'ドリルダッシュ', move:[{at:3, vx:0.34, until:24}], hits:[H({ at:4, dur:22, rehit:4, x0:0, x1:1.2, dmg:4, kb:0.08, kind:'blunt' })] }),
    },
    ult:{ name:'はなびだいさくせん', kind:'pop', build(e){ return A({ id:'mk_ult', anim:'ult', len:104, fn(p,t){
      if(t>10 && t<92 && t%4===0) rainFrom(p, 'firework', { dmg:5, boom:{ r:1.4, dmg:7, power:2, kind:'pop', up:0.16, fx:'fireworks' } });
      if(t===96){ viewArea(p, { dmg:24, power:3, kind:'pop', up:0.26 }); if(G.fx&&G.fx.flash) G.fx.flash('#fff0d0', 0.6, 10); }
    } }); } },
  },
};
G.MOVES = MOVES;

// ---------------------------------------------------------------- constants
const BASE_HP = 100, BASE_SPD = 0.078, JUMP_V = 0.22, DJUMP_V = 0.17;
const SP_MAX = 3, SP_REGEN = 1/260, ULT_MAX = 100;
const DODGE_LEN = 24, DODGE_INV = 18, JUST_WIN = 9;
const CHARGE_START = 12, CHARGE_FULL = 42;
const AIR_MAX = 3;

function heroMeta(id){ return (G.heroes && G.heroes.get && G.heroes.get(id)) || { id, name:id, color:'#ffd24d' }; }

// ---------------------------------------------------------------- create
const P = G.playerCtl = {
  MOVES,
  create(heroId, x, z){
    const mv = MOVES[heroId] || MOVES.inu;
    const st = mv.stats;
    const lvl = (G.game && G.game.level) || 1;
    const lvlHp = 1 + (lvl-1)*0.08, lvlAtk = 1 + (lvl-1)*0.05;
    const meta = heroMeta(heroId);
    let rig = null;
    try { rig = G.heroes && G.heroes.build ? G.heroes.build(heroId) : null; } catch(err){ G.logError('hero build', err); }
    if(!rig) rig = placeholderRig(meta.color);
    const maxHp = Math.round(BASE_HP * st.hp * lvlHp * ((G.game && G.game.diff && G.game.diff.heroHp) || 1));
    const p = G.makeEnt({ kind:'hero', type:heroId, team:0, x, z, face:1, rig,
      radius: heroId==='guard8' ? 0.46 : 0.38, height: rig.height || 1.3, weight: heroId==='guard8' ? 1.4 : 1,
      hp:maxHp, maxHp, atkMul: st.atk * lvlAtk, spd: BASE_SPD * st.spd, jumpV: JUMP_V * Math.sqrt(st.jump),
      sp:SP_MAX, ult: (G.game && G.game.ultCarry) || 0, comboStep:0, comboT:0, buffer:0, airCount:0, djump:false,
      charge:0, chargeT:0, trailColor: mv.trail, moves:mv, lives: 3, meta });
    p.onBeforeHit = (info)=> beforeHit(p, info);
    return p;
  },
  tick, queue,
  // external: full heal etc.
  heal(p, frac){ p.hp = Math.min(p.maxHp, p.hp + Math.ceil(p.maxHp*frac)); },
};
function placeholderRig(color){
  const b = G.look.builder();
  b.add(G.look.geo.sphere(0.4,16,12), color||'#fff3dc', [0,0.95,0]); b.add(G.look.geo.sphere(0.3,16,12), color||'#fff3dc', [0,0.4,0]);
  const mat = G.look.vmat({ instance:true }); const mesh = b.mesh({ material:mat }); const root = new THREE.Group(); root.add(mesh);
  const tip = new THREE.Object3D(); tip.position.set(0.9,0.7,0); root.add(tip); const base = new THREE.Object3D(); base.position.set(0.3,0.7,0); root.add(base);
  return { root, tip, base, height:1.3, radius:0.4, update(e){ mat.userData.uFlash.value = e.flashT>0?0.7:0; root.rotation.y = e.face>0 ? -0.5 : Math.PI+0.5; },
    setAlpha(a){ mat.transparent=a<1; mat.opacity=a; }, dispose(){ mesh.geometry.dispose(); mat.dispose(); } };
}

// ---------------------------------------------------------------- hit hook: dodge / just dodge
function beforeHit(p, info){
  if(p.state==='dodge' && p.stateT < DODGE_INV){
    if(p.stateT <= JUST_WIN && !p.justDone && info.src){
      p.justDone = true;
      G.slowmo(40, 0.3);
      p.inv = Math.max(p.inv, 40);
      p.ult = Math.min(ULT_MAX, p.ult + 10);
      G.bus.emit('dodge', { ent:p, just:true });
    }
    return false;
  }
  if(p.state==='ult' || p.state==='ultIntro') return false;
  return true;
}

// ---------------------------------------------------------------- helpers
function setFree(p){ G.setState(p, p.onGround ? 'idle' : 'air'); p.comboStep = p.comboStep; }
function canAct(p){ return p.state==='idle' || p.state==='move' || p.state==='air'; }
function spend(p){ if(p.sp < 1) return false; p.sp -= 1; return true; }
function startAtk(p, def, state){
  G.combat.start(p, def);
  G.setState(p, state || 'atk');
  if(G.fx && G.fx.trail && def.hits && def.hits.length && def.hits[0].kind!=='blunt') G.fx.trail(p);
}
function stickDir(p){
  const I = G.input;
  if(I.z < -0.55 && Math.abs(I.x) < 0.8) return 'up';
  if(Math.abs(I.x) > 0.45) return 'fwd';
  return 'n';
}
function doSpecial(p){
  if(p.q) p.q.special = 0;
  const dir = stickDir(p);
  if(dir==='fwd' && Math.abs(G.input.x) > 0.45) p.face = G.input.x > 0 ? 1 : -1;
  if(!spend(p)){ if(G.fx && G.fx.text) G.fx.text('✦が たりない…', p.x, p.height+0.5, p.z, 'info'); return false; }
  const def = p.moves.sp[dir] || p.moves.sp.n;
  p.vx = 0; p.vz = 0;
  startAtk(p, def, 'special');
  G.bus.emit('special', { ent:p, id:def.id, name:def.name, dir });
  if(G.audio && G.audio.voice) G.audio.voice(p.type, 'atk');
  return true;
}
function doUlt(p){
  if(p.q) p.q.ult = 0;
  if(p.ult < ULT_MAX) return false;
  p.ult = 0;
  p.vx = 0; p.vz = 0;
  G.setState(p, 'ultIntro');
  G.setAnim(p, 'ult', 70, 0.8);
  const u = p.moves.ult;
  G.game && (G.game.cutinT = 70);
  G.bus.emit('ult', { ent:p, id:p.type+'_ult', name:u.name, heroId:p.type });
  if(G.fx && G.fx.cutin) { try { G.fx.cutin(p.type, u.name, ()=>{}); } catch(err){ G.logError('cutin', err); } }
  if(G.audio && G.audio.voice) G.audio.voice(p.type, 'ult');
  return true;
}
function startUltAttack(p){
  const def = p.moves.ult.build(p);
  G.combat.start(p, def);
  G.setState(p, 'ult');
  p.inv = def.len + 30;
}
function doDodge(p){
  if(p.q) p.q.dodge = 0;
  const I = G.input;
  let dx = I.x, dz = I.z;
  if(Math.abs(dx) < 0.2 && Math.abs(dz) < 0.2){ dx = p.face; dz = 0; }
  const l = Math.hypot(dx, dz) || 1;
  p.dodgeVx = dx/l*0.2; p.dodgeVz = dz/l*0.14;
  if(Math.abs(dx) > 0.2) p.face = dx > 0 ? 1 : -1;
  G.combat.cancel(p);
  G.setState(p, 'dodge'); G.setAnim(p, 'dodge', DODGE_LEN);
  p.justDone = false;
  G.bus.emit('dodge', { ent:p, just:false });
}
function doJump(p, dbl){
  if(p.q) p.q.jump = 0;
  p.vy = dbl ? DJUMP_V * (p.jumpV/JUMP_V) : p.jumpV;
  p.onGround = false;
  if(dbl) p.djump = true;
  G.setState(p, 'air'); G.setAnim(p, 'jump');
  G.bus.emit('jump', { ent:p, double:!!dbl });
}
function comboDefs(p){ return p.moves.combo; }

// stomp: falling onto a foe's head bounces you up and bonks it
function checkStomp(p){
  if(p.vy >= 0 || p.stompUsed) return;
  for(const f of G.world.ents){
    if(f.team!==1 || f.dead || f.intangible || f.state==='spawn') continue;
    if(f.stompT > 0) continue;
    if(Math.abs(f.z - p.z) > 0.5 || Math.abs(f.x - p.x) > f.radius + p.radius*0.6) continue;
    const top = f.y + f.height;
    if(p.y < top - 0.35 || p.y > top + 0.3) continue;
    f.stompT = 30;
    G.combat.damage(f, 6, { src:p, kind:'pop', power:1, stun: f.def && f.def.boss ? 0 : 26, dir:p.face, kb:0.02, noDown:true });
    p.vy = 0.2; p.djump = false; p.airCount = 0; p.stompUsed = true;
    G.setAnim(p, 'jump');
    G.bus.emit('stomp', { ent:p, target:f });
    if(G.audio && G.audio.sfx) G.audio.sfx('boing');
    if(G.fx && G.fx.text) G.fx.text('ふみっ！', f.x, top + 0.3, f.z, 'onoma');
    break;
  }
}

// ---------------------------------------------------------------- tick
const QBTN = ['attack','jump','dodge','special','ult'];
// presses that happen while the world is frozen (hitstop) are kept for a few ticks
function queue(p){
  const b = G.input.btn; p.q = p.q || {};
  for(const k of QBTN) if(b[k].pressed) p.q[k] = 12;
}
function tick(p){
  const I = G.input, b0 = I.btn;
  p.q = p.q || {};
  const pb = {};
  for(const k of QBTN){ pb[k] = b0[k].pressed || p.q[k]>0; if(p.q[k]>0) p.q[k]--; }
  const b = { attack:{ pressed:pb.attack, down:b0.attack.down, held:b0.attack.held }, jump:{ pressed:pb.jump, down:b0.jump.down },
    dodge:{ pressed:pb.dodge }, special:{ pressed:pb.special }, ult:{ pressed:pb.ult } };
  const used = (k)=>{ p.q[k] = 0; };
  if(p.flashT>0) p.flashT--;
  if(p.inv>0) p.inv--;
  p.stateT++;
  if(p.buffer>0) p.buffer--;
  if(p.comboT>0){ p.comboT--; if(p.comboT===0) p.comboStep = 0; }
  if(p.sp < SP_MAX && p.state!=='ult') p.sp = Math.min(SP_MAX, p.sp + SP_REGEN);
  for(const f of G.world.ents) if(f.stompT>0 && f.team===1) f.stompT--;

  // cut-in freeze is handled by the game loop; when it ends we start the ult attack
  if(p.state==='ultIntro'){
    if(!(G.game && G.game.cutinT>0)) startUltAttack(p);
    return;
  }

  switch(p.state){
    case 'hurt':
      if(p.anim!=='hurt') G.setAnim(p, 'hurt');
      if(--p.stun <= 0) setFree(p);
      return;
    case 'down':
      if(p.anim!=='down') G.setAnim(p, 'down');
      // mash to get up sooner (受け身)
      if(!p.onGround && p.stateT > 12 && (b.jump.pressed || b.dodge.pressed)){ p.vy = 0.14; p.vx = -p.hurtDir*0.04; G.setState(p, 'air'); G.setAnim(p, 'jump'); p.inv = 30; G.bus.emit('recover', { ent:p }); return; }
      if(p.onGround){ p.downT = (p.downT||0) + 1 + (b.attack.pressed||b.jump.pressed ? 6 : 0);
        if(p.downT > 34){ G.setState(p, 'getup'); G.setAnim(p, 'getup', 20); } }
      return;
    case 'getup':
      if(p.stateT >= 20){ p.inv = 50; setFree(p); }
      return;
    case 'dizzy':
      if(--p.stun <= 0) setFree(p);
      return;
    case 'ko':
      if(p.anim!=='ko') G.setAnim(p, 'ko');
      return;   // the game decides revive / game over
    case 'victory':
      p.vx = 0; p.vz = 0;
      if(p.anim!=='victory') G.setAnim(p, 'victory');
      return;
    case 'dodge': {
      const k = 1 - p.stateT/DODGE_LEN;
      p.vx = p.dodgeVx * (0.35 + 0.65*k); p.vz = p.dodgeVz * (0.35 + 0.65*k);
      if(p.stateT >= DODGE_LEN){ setFree(p); p.vx *= 0.3; }
      else if(p.stateT > DODGE_INV && (b.attack.pressed || b.jump.pressed)) { setFree(p); }
      else return;
      break;
    }
    case 'atk': case 'special': case 'ult': case 'airAtk': case 'charge': break;
  }

  // ---- charging (hold attack)
  if(p.state==='charge'){
    p.vx = 0; p.vz = 0;
    if(b.attack.down){
      p.chargeT++;
      p.charge = U.clamp((p.chargeT)/(CHARGE_FULL-CHARGE_START), 0, 1);
      if(p.anim!=='charge') G.setAnim(p, 'charge');
      if(p.charge>=1 && !p.chargeFull){ p.chargeFull = true; G.bus.emit('chargeFull', { ent:p }); if(G.fx && G.fx.burst) G.fx.burst('sparkle', p.x, p.height*0.6, p.z, { count:8 }); }
      if(b.dodge.pressed){ p.charge = 0; p.chargeFull = false; if(G.audio) G.audio.sfx('charge', { stop:true }); doDodge(p); }
      return;
    }
    const full = p.charge >= 0.45;
    p.charge = 0; p.chargeFull = false; p.chargeT = 0;
    if(G.audio && G.audio.sfx) G.audio.sfx('charge', { stop:true });
    if(full){ startAtk(p, p.moves.charge, 'atk'); p.comboStep = 0; G.bus.emit('chargeRelease', { ent:p }); }
    else { startAtk(p, comboDefs(p)[0], 'atk'); p.comboStep = 1; p.comboT = 40; }
    return;
  }

  // ---- attacking (ground combo / special / ult / air attack)
  if(p.state==='atk' || p.state==='special' || p.state==='ult' || p.state==='airAtk'){
    if(b.attack.pressed){ p.buffer = 14; used('attack'); }
    const a = p.atk;
    if(!a){ // finished
      if(G.fx && G.fx.trailStop) G.fx.trailStop(p);
      if(p.state==='ult'){ p.inv = Math.max(p.inv, 30); }
      setFree(p);
      if(p.state!=='air' && p.buffer>0 && p.comboStep>0 && p.comboStep < comboDefs(p).length){ nextCombo(p); return; }
      // fall through to free control this tick
    } else {
      const def = a.def;
      const pastCancel = a.t >= (def.cancel||def.len);
      if(p.state==='atk' && pastCancel){
        if(p.buffer>0 && p.comboStep>0 && p.comboStep < comboDefs(p).length){ nextCombo(p); return; }
        if(b.special.pressed && p.sp>=1){ doSpecial(p); return; }
        if(b.jump.pressed){ G.combat.cancel(p); doJump(p, false); return; }
      }
      if(p.state==='airAtk' && pastCancel && b.jump.pressed && !p.djump){ G.combat.cancel(p); doJump(p, true); return; }
      if(p.state==='airAtk' && p.onGround && a.t > 4){ G.combat.cancel(p); G.setState(p,'idle'); G.setAnim(p,'land',8); return; }
      if((p.state==='atk' || p.state==='special') && b.dodge.pressed && a.t > 3 && p.state!=='ult'){ doDodge(p); return; }
      if(p.state==='atk' && b.ult.pressed && p.ult>=ULT_MAX){ G.combat.cancel(p); doUlt(p); return; }
      // air attacks hover a little so juggles work
      if(p.state==='airAtk' && p.vy < 0.02 && a.t < 10) p.vy = Math.max(p.vy, 0.015);
      return;
    }
  }

  // ---- free control (idle / move / air)
  if(!canAct(p)) return;
  const grounded = p.onGround;
  if(grounded && p.state==='air'){ G.setState(p, 'idle'); G.setAnim(p, 'land', 8); p.airCount = 0; p.djump = false; }
  if(grounded) p.stompUsed = false;
  if(!grounded && p.state!=='air') G.setState(p, 'air');

  if(b.ult.pressed && p.ult >= ULT_MAX){ doUlt(p); return; }
  if(b.special.pressed){ if(doSpecial(p)) return; }
  if(b.dodge.pressed && grounded){ doDodge(p); return; }
  if(b.jump.pressed){
    if(grounded){ doJump(p, false); return; }
    if(!p.djump){ doJump(p, true); return; }
  }
  if(p.state==='air'){
    // air control
    const tvx = I.x*p.spd, tvz = I.z*p.spd*0.7;
    p.vx = U.approach(p.vx, tvx, 0.012); p.vz = U.approach(p.vz, tvz, 0.01);
    if(Math.abs(I.x)>0.2) p.face = I.x>0 ? 1 : -1;
    if(b.attack.pressed){
      if(I.z > 0.6 && Math.abs(I.x) < 0.7 && p.y > 0.8){ startAtk(p, p.moves.dive, 'airAtk'); p.airCount = AIR_MAX; return; }
      if(p.airCount < AIR_MAX){ startAtk(p, p.moves.air[p.airCount % p.moves.air.length], 'airAtk'); p.airCount++; return; }
    }
    if(p.vy < 0){ if(p.anim!=='fall') G.setAnim(p, 'fall'); }
    else if(p.anim!=='jump') G.setAnim(p, 'jump');
    checkStomp(p);
    return;
  }
  // ground
  if(b.attack.pressed){
    p.chargeT = 0;
    if(p.comboStep>0 && p.comboT>0 && p.comboStep < comboDefs(p).length){ nextCombo(p); return; }
    p.comboStep = 0; nextCombo(p);
    return;
  }
  if(b.attack.down && b.attack.held > CHARGE_START && p.stateT >= 0){
    G.setState(p, 'charge'); p.chargeT = 0; p.charge = 0;
    G.bus.emit('chargeStart', { ent:p });
    if(G.audio && G.audio.sfx) G.audio.sfx('charge');
    return;
  }
  const mx = I.x, mz = I.z;
  const mag = Math.min(1, Math.hypot(mx, mz));
  if(mag > 0.12){
    p.vx = mx*p.spd; p.vz = mz*p.spd*0.72;
    if(Math.abs(mx) > 0.15) p.face = mx > 0 ? 1 : -1;
    if(p.state!=='move') G.setState(p, 'move');
    if(p.anim!=='run') G.setAnim(p, 'run');
  } else {
    p.vx = 0; p.vz = 0;
    if(p.state!=='idle') G.setState(p, 'idle');
    if(p.anim!=='idle' && !(p.anim==='land' && p.animT<8)) G.setAnim(p, 'idle');
  }
}
function nextCombo(p){
  if(p.q) p.q.attack = 0;
  const defs = comboDefs(p);
  const i = p.comboStep % defs.length;
  // face the stick direction when starting a string
  if(Math.abs(G.input.x) > 0.3) p.face = G.input.x > 0 ? 1 : -1;
  p.vx = 0; p.vz = 0;
  startAtk(p, defs[i], 'atk');
  p.comboStep = i + 1; p.comboT = 36; p.buffer = 0;
  if(i===defs.length-1){ p.comboStep = 0; p.comboT = 0; if(G.audio && G.audio.voice && G.rng()<0.6) G.audio.voice(p.type, 'atk'); }
}

// gains from dealing damage / getting hurt
G.bus.on('hit', (d)=>{
  const p = G.player; if(!p) return;
  if(d.src===p && d.target && d.target.team===1 && d.dmg>0){
    if(p.state!=='ult') p.ult = Math.min(ULT_MAX, p.ult + d.dmg*0.55);
    p.sp = Math.min(SP_MAX, p.sp + 0.035);
  }
});
G.bus.on('hurt', (d)=>{
  const p = G.player; if(!p || d.ent!==p) return;
  p.inv = Math.max(p.inv, 40);
  p.comboStep = 0; p.charge = 0; p.chargeFull = false;
  if(G.fx && G.fx.trailStop) G.fx.trailStop(p);
  p.ult = Math.min(ULT_MAX, p.ult + 4);
  if(G.audio && G.audio.voice) G.audio.voice(p.type, 'hurt');
});
G.bus.on('down', (d)=>{ const p = G.player; if(p && d.ent===p){ p.downT = 0; p.inv = Math.max(p.inv, 70); } });
})();

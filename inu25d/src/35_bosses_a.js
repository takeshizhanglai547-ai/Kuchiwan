// 35_bosses_a.js — ボス前半：てつづめのガルム(1)・りくザメ(2)・おばけのTたろう＋きょうだい(3)・みつくびのケルベ(4)。
// 見た目：部品ごとに頂点カラーで1メッシュへ結合（形状はこのモジュールでキャッシュ＝共有）。材質はリグごとに2枚
// （からだ用／目・つや用）だけ複製し、白フラッシュとフェードに使う。表情は顔メッシュの切り替え（N ふつう・B まばたき・
// O くちをあける・X ×め・S ぎゅっ・H にっこり）。
// 動き：G.foes.h（トークン・予告・攻撃）と G.combat の攻撃定義だけで作る。大技は攻撃定義の fn(e,t) で段取りを進める
// （空からの急降下・もぐる・地面の警告の輪・ぴょんぴょん）。途中で倒されても onInterrupt / onKO で必ず元に戻す。
(function(){ 'use strict';
const G = window.G; const THREE = window.THREE; const U = G.U;
const TAU = Math.PI*2, HPI = Math.PI/2;
const clamp = U.clamp, lerp = U.lerp;

// ================================================================ build helpers (allocation here is fine: build-time only)
const _e = new THREE.Euler(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
function M(pos, rot, scl, order){
  _e.set(rot?rot[0]:0, rot?rot[1]:0, rot?rot[2]:0, order||'XYZ'); _q.setFromEuler(_e);
  if(scl==null) _s.set(1,1,1); else if(typeof scl==='number') _s.set(scl,scl,scl); else _s.set(scl[0],scl[1],scl[2]);
  return new THREE.Matrix4().compose(_p.set(pos?pos[0]:0, pos?pos[1]:0, pos?pos[2]:0), _q, _s);
}
function Bld(){ this.b = G.look.builder(); }
Bld.prototype.add = function(g, c, pos, rot, scl, order){ this.b.addMatrix(g, c, M(pos, rot, scl, order)); return this; };
// merged part geometries are cached per (type, part) and marked shared → rigs never dispose them
const GEO = new Map();
function cgeo(key, fill){
  let g = GEO.get(key);
  if(!g){ const b = new Bld(); fill(b); g = b.b.build(); g.userData.shared = true; GEO.set(key, g); }
  return g;
}
function rawGeo(key, make){ let g = GEO.get(key); if(!g){ g = make(); g.userData.shared = true; GEO.set(key, g); } return g; }
const sph  = (r, w, h)=> G.look.geo.sphere(r, w||16, h||12);
const cap  = (r, l, c, rs)=> G.look.geo.capsule(r, l, c||4, rs||12);
const cyl  = (a, b, h, s)=> G.look.geo.cylinder(a, b, h, s||16);
const cone = (r, h, s)=> G.look.geo.cone(r, h, s||14);
const tor  = (r, t, rs, ts, arc)=> G.look.geo.torus(r, t, rs||8, ts||24, arc==null?TAU:arc);
const star = (r)=> G.look.geo.star(r, 0.45, r*0.45);
const box  = (w, h, d)=> G.look.geo.box(w, h, d);
const lathe = (key, pts, seg)=> G.look.geo.lathe('bA_'+key, pts, seg||24);
const dome = (r, ws, hs, t0, tl)=> rawGeo('dome'+r+'|'+ws+'|'+hs+'|'+t0+'|'+tl, ()=> new THREE.SphereGeometry(r, ws, hs, 0, TAU, t0, tl));

// ---------------------------------------------------------------- features on an ellipsoid surface (face-local u,v)
// S = { c:[x,y,z], r:[rx,ry,rz] }. The front point is +x. u runs across the face toward -z, v runs up.
function sp(S, u, v, lift){
  const az = -u / S.r[2], el = v / S.r[1], ce = Math.cos(el);
  return [ S.c[0] + (S.r[0]+lift)*ce*Math.cos(az), S.c[1] + (S.r[1]+lift)*Math.sin(el), S.c[2] + (S.r[2]+lift)*ce*Math.sin(az) ];
}
function feat(b, S, u, v, lift, g, col, scl, spin){ b.add(g, col, sp(S,u,v,lift), [ -(v/S.r[1]), HPI + u/S.r[2], spin||0 ], scl, 'YXZ'); }
const INK = '#221a26', MOUTH = '#6b1f33', TONGUE = '#ff8aa6', BLUSH = '#ffb0c2', WHITE = '#ffffff';
// yellow grumpy eye (ダークワンワン帝国 style) with pupil, highlight, thick brow; o.lid = sleepy lid colour
function eyeAngry(b, S, u, v, s, o){
  o = o || {};
  const side = u < 0 ? 1 : -1;            // +1 = eye on the +z (camera) side; its inner direction is +u
  feat(b, S, u, v, -s*0.2, sph(s,16,12), o.white||'#ffd84a', [0.92, 1.0, 0.5]);
  const pu = u + side*s*(o.look==null?0.2:o.look), pv = v - s*0.06;
  feat(b, S, pu, pv, s*0.13, sph(s*(o.pupil||0.56),12,10), INK, [0.85, 1.05, 0.45]);
  feat(b, S, pu - side*s*0.16, pv + s*0.22, s*0.24, sph(s*0.18,8,6), WHITE, [1,1,0.5]);
  if(o.lid) feat(b, S, u, v + s*0.5, s*0.02, sph(s*1.04,14,10), o.lid, [1.02, 0.58, 0.56]);
  if(o.brow!==false){
    const tilt = o.tilt==null ? 0.42 : o.tilt;
    feat(b, S, u + side*s*0.12, v + s*(o.browUp||1.22), s*0.1, cap(s*0.2, s*1.05, 3, 8), o.browC||'#2e2533', [1,1,0.55], HPI - side*tilt);
  }
}
function eyeDot(b, S, u, v, s){
  feat(b, S, u, v, -s*0.15, sph(s,14,12), INK, [0.82, 1.0, 0.5]);
  feat(b, S, u + s*0.24, v + s*0.34, s*0.36, sph(s*0.32,8,6), WHITE, [1,1,0.5]);
  feat(b, S, u - s*0.22, v - s*0.3, s*0.36, sph(s*0.13,6,5), WHITE, [1,1,0.5]);
}
function eyeLine(b, S, u, v, s, tiltSide){ const side = u<0?1:-1; feat(b, S, u, v, 0.005, cap(s*0.13, s*1.1, 3, 8), INK, [1,1,0.55], HPI - side*(tiltSide||0)); }
function eyeArc(b, S, u, v, s, down){ feat(b, S, u, v + (down? -s*0.1 : s*0.1), 0.005, tor(s*0.6, s*0.13, 6, 14, Math.PI), INK, [1,1,0.6], down ? Math.PI : 0); }
function eyeX(b, S, u, v, s){
  feat(b, S, u, v, 0.01, cap(s*0.13, s*1.25, 3, 8), INK, [1,1,0.55],  Math.PI/4);
  feat(b, S, u, v, 0.01, cap(s*0.13, s*1.25, 3, 8), INK, [1,1,0.55], -Math.PI/4);
}
function eyeSqueeze(b, S, u, v, s){
  const side = u < 0 ? 1 : -1;
  for(let k=0;k<2;k++){
    const sg = k ? -1 : 1;
    const a = Math.atan2(-side*0.62, -sg*0.44);
    feat(b, S, u - side*s*0.26, v + sg*s*0.22, 0.01, cap(s*0.13, s*0.62, 3, 8), INK, [1,1,0.55], a);
  }
}
function blush(b, S, u, v, s){ feat(b, S, u, v, 0.0, sph(s,12,8), BLUSH, [1.35, 0.62, 0.22]); }
function mFrown(b, S, u, v, w){ feat(b, S, u, v, 0.01, tor(w, w*0.22, 6, 14, Math.PI), INK, [1,0.8,0.6], 0); }
function mGrin(b, S, u, v, w){ feat(b, S, u, v, 0.01, tor(w, w*0.2, 6, 16, Math.PI), INK, [1,0.9,0.6], Math.PI); }
function mO(b, S, u, v, w){ feat(b, S, u, v, 0.01, tor(w, w*0.3, 6, 16), INK, [0.9,1.1,0.6], 0); }
function mOpen(b, S, u, v, w, h, fangs){
  feat(b, S, u, v, -0.01, sph(w,16,10), MOUTH, [1, h/w, 0.3]);
  feat(b, S, u, v - h*0.42, 0.012, sph(w*0.6,12,8), TONGUE, [1, 0.5, 0.3]);
  if(fangs){ for(let k=-1;k<=1;k+=2) feat(b, S, u + k*w*0.58, v + h*0.62, 0.015, cone(w*0.16, w*0.4, 8), WHITE, [1,1,0.6], Math.PI); }
}
function mOmega(b, S, u, v, w){ for(let k=-1;k<=1;k+=2) feat(b, S, u + k*w*0.95, v, 0.01, tor(w, w*0.24, 6, 12, Math.PI), INK, [1,0.9,0.6], Math.PI); }
function mWavy(b, S, u, v, w){ for(let k=-1;k<=1;k++) feat(b, S, u + k*w*0.62, v, 0.01, cap(w*0.12, w*0.55, 3, 6), INK, [1,1,0.6], HPI + (k&1 ? 0.6 : -0.6)); }
function sweatFill(b){ b.add(sph(0.075,12,10), '#8fd8ff', [0,0,0]); b.add(cone(0.068,0.13,10), '#8fd8ff', [0,0.085,0]); b.add(sph(0.022,6,5), WHITE, [0.02,0.01,0.06]); }
function starsFill(r, y){ return (b)=>{ for(let i=0;i<3;i++){ const a = i/3*TAU; b.add(star(0.12), '#ffe14d', [Math.cos(a)*r, y + (i===1?0.05:0), Math.sin(a)*r], [0, -a + HPI, 0.3*i]); } }; }

// ================================================================ rig kit
const FACE_KEYS = ['N','B','O','X','S','H'];
const PK = ['bx','by','sx','sy','lean','twist','hx','hy','hz','aLz','aRz','aLx','aRx','lLz','lRz','roll','rz','jaw','wag','ex'];
function newPose(){ const o = { face:'N', sweat:0, stars:0, spin:0, wagSpd:0.1 }; for(const k of PK) o[k] = 0; o.sx = o.sy = 1; return o; }
const FAST = { attack:1, attack2:1, attack3:1, shoot:1, dash:1, roar:1, special:1, hurt:1 };
const YAW_R = -0.61, YAW_L = -(Math.PI - 0.61);

function Kit(o){
  this.o = o;
  this.root = new THREE.Group(); this.root.name = 'boss_'+o.type;
  this.yaw = new THREE.Group(); this.root.add(this.yaw);
  this.body = new THREE.Group(); this.yaw.add(this.body);
  this.mat = G.look.vmat({ instance:true, rough: o.rough==null ? 0.68 : o.rough });
  this.gmat = G.look.vmat({ instance:true, rough:0.28, rim:0.35 });
  this.outlines = []; this.meshes = []; this.fsets = [];
  this.P = newPose(); this.C = newPose();
  this.seed = (Math.random()*997)|0; this.ph = 0; this.yawV = YAW_R; this.alpha = 1;
  this.land = 0; this.wob = 0; this.flinch = 0; this.prevFlash = 0; this.wasGround = true;
  this.sqx = 0; this.sqy = 0; this.spinA = 0; this.yokeV = 0;
  this.marker = null; this.markMat = null; this.sweat = null; this.stars = null;
  this.tip = new THREE.Object3D(); this.base = new THREE.Object3D();
}
Kit.prototype.grp = function(parent, pos){ const g = new THREE.Group(); if(pos) g.position.set(pos[0], pos[1], pos[2]); parent.add(g); return g; };
Kit.prototype.part = function(parent, key, fill, o){
  o = o || {};
  const g = cgeo(this.o.gkey + ':' + key, fill);
  const m = new THREE.Mesh(g, o.gloss ? this.gmat : this.mat);
  m.castShadow = o.shadow!==false; m.receiveShadow = false;
  if(o.outline!==0) this.outlines.push(G.look.outline(m, o.outline || this.o.ol || 0.024, o.oc || this.o.oc || '#3b2417'));
  if(o.pos) m.position.set(o.pos[0], o.pos[1], o.pos[2]);
  parent.add(m); this.meshes.push(m);
  return m;
};
Kit.prototype.faceSet = function(parent, prefix, fills){
  const set = { cur:null, blinkT: 50 + (Math.random()*140|0), blink:0 };
  for(const k of FACE_KEYS){
    if(!fills[k]) continue;
    const m = this.part(parent, prefix+'_f'+k, fills[k], { gloss:true, outline:0, shadow:false });
    m.visible = false; set[k] = m;
  }
  this.fsets.push(set);
  return set;
};
Kit.prototype.extras = function(parent, sweatPos, starR, starY){
  this.sweat = this.part(parent, 'sweat', sweatFill, { gloss:true, outline:0, shadow:false, pos:sweatPos });
  this.sweat.userData.y0 = sweatPos[1]; this.sweat.visible = false;
  this.stars = this.part(parent, 'stars', starsFill(starR, 0), { gloss:true, outline:0.012, shadow:false, pos:[0, starY, 0] });
  this.stars.visible = false;
};
function showFace(set, name){
  const m = set[name] || (name==='S' && set.X) || set.N;
  if(set.cur !== m){ if(set.cur) set.cur.visible = false; m.visible = true; set.cur = m; }
}
Kit.prototype.setAlpha = function(a){
  a = clamp(a, 0, 1);
  if(Math.abs(a - this.alpha) < 0.002) return;
  const was = this.alpha < 0.999, now = a < 0.999;
  this.alpha = a;
  const m1 = this.mat, m2 = this.gmat;
  m1.opacity = a; m2.opacity = a;
  if(was !== now){
    // three r160 compiles "opaque" into the program: toggling transparency needs a program switch
    m1.transparent = now; m2.transparent = now; m1.needsUpdate = true; m2.needsUpdate = true;
    const ov = !now && G.quality.tier < 2;
    for(let i=0;i<this.outlines.length;i++) this.outlines[i].visible = ov;
  }
  m1.depthWrite = a > 0.6; m2.depthWrite = a > 0.6;
  this.root.visible = a > 0.01;
};
Kit.prototype.makeMarker = function(){
  const tex = G.look.canvasTex('bossA_warn', 128, 128, (x, w, h)=>{
    const c = w/2;
    const g = x.createRadialGradient(c, c, 4, c, c, c);
    g.addColorStop(0, 'rgba(255,90,70,0.10)'); g.addColorStop(0.7, 'rgba(255,90,70,0.32)'); g.addColorStop(0.86, 'rgba(255,70,50,0.9)'); g.addColorStop(1, 'rgba(255,70,50,0)');
    x.fillStyle = g; x.beginPath(); x.arc(c, c, c-1, 0, TAU); x.fill();
    x.lineWidth = 7; x.strokeStyle = '#ffffff'; x.beginPath(); x.arc(c, c, c*0.78, 0, TAU); x.stroke();
    x.lineWidth = 5; x.setLineDash([10, 8]); x.strokeStyle = 'rgba(255,255,255,0.9)'; x.beginPath(); x.arc(c, c, c*0.5, 0, TAU); x.stroke(); x.setLineDash([]);
    x.fillStyle = '#ffffff'; x.strokeStyle = '#c0281c'; x.lineWidth = 6; x.font = 'bold 54px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.strokeText('!', c, c+3); x.fillText('!', c, c+3);
  });
  this.markMat = new THREE.MeshBasicMaterial({ map:tex, transparent:true, depthWrite:false, opacity:0.9, color:0xffffff, toneMapped:false });
  const m = new THREE.Mesh(G.look.geo.plane(1, 1), this.markMat);
  m.rotation.x = -HPI; m.renderOrder = 3; m.visible = false; m.castShadow = false;
  G.scene.add(m);
  this.marker = m;
};
Kit.prototype.updMarker = function(e, T){
  const on = !!(e && e.warnOn && e.atk && !e.dead);
  if(!on){ if(this.marker) this.marker.visible = false; return; }
  if(!this.marker) this.makeMarker();
  const m = this.marker;
  const pul = e.warnLock ? 0.5 + 0.5*Math.sin(T*0.9) : 0.5 + 0.5*Math.sin(T*0.25);
  const s = (e.warnR || 1.5)*2*(1 + 0.07*pul);
  m.visible = true; m.position.set(e.warnX, 0.04, e.warnZ); m.scale.set(s, s, 1);
  this.markMat.opacity = 0.55 + 0.4*pul;
  this.markMat.color.setHex(e.warnLock ? 0xff6a5a : 0xffc060);
};
Kit.prototype.update = function(e){
  const P = this.P, C = this.C, T = G.time.tick + this.seed;
  const fl = e.flashT|0;
  if(fl > this.prevFlash){ this.wob = 1; this.flinch = 9; }
  this.prevFlash = fl;
  const fv = fl > 0 ? 0.62 : 0;
  this.mat.userData.uFlash.value = fv; this.gmat.userData.uFlash.value = fv;
  if(e.onGround && !this.wasGround) this.land = 1;
  this.wasGround = !!e.onGround;
  basePose(this, e, P, T);
  if(this.o.pose) this.o.pose(this, e, P, T);
  const r = FAST[e.anim] ? 0.42 : 0.24;
  for(let i=0;i<PK.length;i++){ const k = PK[i]; C[k] += (P[k] - C[k])*r; }
  const lw = this.land, ww = this.wob*Math.sin(T*1.3);
  this.sqy = -0.2*lw - 0.07*ww; this.sqx = 0.12*lw + 0.06*ww;
  this.land *= 0.8; this.wob *= 0.86; if(this.flinch>0) this.flinch--;
  this.o.apply(this, e, C, T, P);
  // facing: toward ent.face, ~35° toward the camera (turns through the front)
  const base = e.face > 0 ? YAW_R : YAW_L;
  this.yawV += (base - this.yawV)*0.2;
  if(P.spin){ this.spinA = P.spin; }
  else if(this.spinA){ const tgt = Math.round(this.spinA/TAU)*TAU; this.spinA += (tgt - this.spinA)*0.25; if(Math.abs(tgt - this.spinA) < 0.01) this.spinA = 0; }
  this.yaw.rotation.y = this.yawV + this.spinA;
  // expression
  let face = P.face;
  if(this.flinch>0 && (face==='N' || face==='O' || face==='B')) face = 'S';
  for(let i=0;i<this.fsets.length;i++){
    const set = this.fsets[i];
    let nm = face;
    if(face==='N'){ if(--set.blinkT <= 0){ set.blink = 7; set.blinkT = 110 + (Math.random()*170|0); } }
    if(set.blink > 0){ set.blink--; if(face==='N' || face==='O') nm = 'B'; }
    showFace(set, nm);
  }
  const sw = P.sweat || face==='S' || face==='X';
  if(this.sweat){ this.sweat.visible = !!sw; if(sw){ const q = (T % 50)/50; this.sweat.position.y = this.sweat.userData.y0 - q*0.12; this.sweat.scale.setScalar(0.85 + 0.25*Math.sin(q*Math.PI)); } }
  if(this.stars){ this.stars.visible = !!P.stars; if(P.stars) this.stars.rotation.y = T*0.13; }
  this.updMarker(e, T);
};
Kit.prototype.rig = function(height, radius){
  const k = this;
  this.tip.name = 'tip'; this.base.name = 'base';
  return {
    root: k.root, height, radius, tip: k.tip, base: k.base, kit: k,
    meshCount: k.meshes.length,
    update(e){ k.update(e); },
    setAlpha(a){ k.setAlpha(a); },
    dispose(){
      k.mat.dispose(); k.gmat.dispose();
      if(k.marker){ if(k.marker.parent) k.marker.parent.remove(k.marker); k.markMat.dispose(); k.marker = null; }
    },
  };
};

// ---------------------------------------------------------------- generic procedural animation (targets; the kit damps them)
function strikeU(p, hit){
  const a0 = hit*0.55;
  if(p < a0) return 0.2*(1 - p/a0) ;                         // u: 0 = wound back … 1 = struck
  if(p < hit){ const q = (p - a0)/Math.max(0.001, hit - a0); return q*q; }
  const q = (p - hit)/Math.max(0.001, 1 - hit);
  return 1 - 0.55*U.easeInOutSine(Math.min(1, q*1.25));
}
function basePose(k, e, P, T){
  const an = e.anim, t = e.animT|0, len = e.animLen|0;
  const p = len > 0 ? clamp(t/len, 0, 1) : (t % 60)/60;
  const hit = e.animHit || 0.35;
  const br = Math.sin(T*0.07);
  P.bx = 0; P.by = 0; P.sx = 1; P.sy = 1; P.lean = -0.04; P.twist = 0;
  P.hx = 0; P.hy = 0; P.hz = 0.03*Math.sin(T*0.045);
  P.aLz = 0.22; P.aRz = 0.22; P.aLx = 0.16; P.aRx = 0.16; P.lLz = 0; P.lRz = 0; P.roll = 0; P.rz = 0;
  P.jaw = 0.04 + 0.03*br; P.wag = 0.25; P.wagSpd = 0.1; P.ex = 0;
  P.face = 'N'; P.sweat = 0; P.stars = 0; P.spin = 0;
  const lie = k.o.lie || 0.3, sit = k.o.sit || 0.3;
  switch(an){
    case 'idle': case 'land':
      P.sy = 1 + 0.024*br; P.sx = 1 - 0.012*br; P.aLz += 0.07*br; P.aRz += 0.07*br; break;
    case 'walk': case 'run': {
      const spd = Math.min(1.4, Math.hypot(e.vx||0, e.vz||0)/0.05);
      k.ph += 0.09 + 0.13*spd;
      const s = Math.sin(k.ph), c = Math.cos(k.ph);
      P.lLz = s*0.6; P.lRz = -s*0.6; P.aLz = 0.18 - s*0.5; P.aRz = 0.18 + s*0.5;
      P.by = Math.abs(c)*0.07; P.lean = -0.1; P.twist = s*0.1; P.hz = 0.035*Math.cos(k.ph*2); P.sy = 1 + 0.03*Math.abs(c);
      P.wag = 0.45; P.wagSpd = 0.22; break; }
    case 'windup': {
      const q = U.easeOutCubic(p), sh = Math.sin(T*1.9)*0.024*(0.4 + p);
      P.bx = sh; P.lean = 0.3*q; P.sy = 1 - 0.1*q; P.sx = 1 + 0.06*q;
      P.aRz = 0.2 - 1.55*q; P.aLz = 0.2 - 0.7*q; P.aRx = 0.3; P.hz = 0.12*q; P.lLz = 0.25*q; P.lRz = -0.2*q;
      P.jaw = 0.7*q; P.face = 'O'; P.wag = 0.7; P.wagSpd = 0.4; break; }
    case 'attack': case 'attack2': case 'attack3': {
      const u = strikeU(p, hit), bump = U.bump(p, hit*0.7, Math.min(1, hit + 0.25));
      P.lean = lerp(0.24, -0.3, u); P.sy = 1 + 0.07*bump; P.sx = 1 - 0.03*bump; P.lLz = 0.35*u; P.lRz = -0.25*u; P.hz = lerp(0.1, -0.12, u);
      if(an==='attack'){ P.aRz = lerp(-1.25, 1.55, u); P.aLz = lerp(0.5, -0.35, u); P.twist = lerp(-0.4, 0.45, u); P.aRx = 0.25; }
      else if(an==='attack2'){ P.aLz = lerp(-1.25, 1.55, u); P.aRz = lerp(0.5, -0.35, u); P.twist = lerp(0.4, -0.45, u); P.aLx = 0.25; }
      else { P.aLz = P.aRz = lerp(2.7, 0.8, u); P.aLx = P.aRx = lerp(0.5, 0.15, u); P.lean = lerp(0.35, -0.45, u); P.by = 0.14*U.bump(p, 0, hit); }
      P.jaw = p < hit ? 0.85 : Math.max(0.05, 0.85 - (p - hit)*9);
      P.face = 'O'; P.wag = 0.6; P.wagSpd = 0.35; break; }
    case 'dash': {
      if(p < 0.45){ k.ph += 0.55; const s = Math.sin(k.ph);
        P.lean = -0.42; P.sy = 0.93; P.sx = 1.06; P.aLz = P.aRz = 1.25; P.aLx = P.aRx = 0.22; P.lLz = s*0.85; P.lRz = -s*0.85; P.by = Math.abs(Math.cos(k.ph))*0.08; P.face = 'O'; P.jaw = 0.8; }
      else { P.lean = -0.18; P.lLz = 0.6; P.lRz = 0.25; P.aLz = P.aRz = -0.2; P.sy = 0.96; P.face = 'N'; }
      P.wag = 0.8; P.wagSpd = 0.4; break; }
    case 'shoot': {
      const u = strikeU(p, hit);
      P.lean = lerp(0.25, -0.22, u); P.hz = lerp(0.22, -0.1, u); P.aLz = P.aRz = lerp(-0.4, 1.3, u); P.aLx = P.aRx = 0.3;
      P.sy = 1 + 0.06*U.bump(p, hit*0.7, hit+0.2); P.jaw = u > 0.3 ? 0.85 : 0.3; P.face = 'O'; break; }
    case 'hurt': {
      const j = Math.sin(T*1.25)*0.05;
      P.lean = 0.3 + j; P.hz = 0.25; P.aLz = P.aRz = -0.5; P.aLx = P.aRx = 0.6; P.sy = 0.93; P.bx = -0.05; P.jaw = 0.4;
      P.face = 'S'; P.sweat = 1; break; }
    case 'down':
      P.rz = e.onGround ? 1.32 : 0.9 + 0.2*Math.sin(T*0.3); P.by = lie; P.aLz = P.aRz = 2.3 + 0.15*Math.sin(T*0.2); P.aLx = P.aRx = 0.5;
      P.lLz = 0.9; P.lRz = 0.6; P.hz = 0.2 + 0.08*Math.sin(T*0.1); P.jaw = 0.35; P.face = 'X'; P.sweat = 1; P.stars = 1; P.wag = 0.05; break;
    case 'getup': {
      const q = p, up = U.easeOutCubic(Math.min(1, q*1.35));
      P.rz = 1.32*(1 - up); P.by = lie*(1 - up) + 0.14*U.bump(q, 0.55, 1); P.aLz = P.aRz = lerp(2.0, 0.2, up); P.lLz = lerp(0.9, 0, up); P.lRz = lerp(0.6, 0, up);
      P.face = q < 0.6 ? 'S' : 'N'; P.sweat = q < 0.6 ? 1 : 0; break; }
    case 'dizzy':
      P.roll = 0.14*Math.sin(T*0.13); P.lean = 0.1*Math.cos(T*0.13); P.hx = 0.2*Math.sin(T*0.13 + 1); P.hz = 0.14*Math.cos(T*0.13);
      P.aLz = -0.15 + 0.4*Math.sin(T*0.2); P.aRz = -0.15 + 0.4*Math.sin(T*0.2 + 2); P.sy = 0.96; P.jaw = 0.3;
      P.face = 'X'; P.stars = 1; P.sweat = 1; break;
    case 'ko':
      if(!e.onGround){ P.rz = 0.5 + 0.25*Math.sin(T*0.35); P.aLz = P.aRz = 2.2; P.aLx = P.aRx = 1.0; P.lLz = 0.8; P.lRz = 0.3; P.face = 'X'; P.jaw = 0.5; }
      else { P.by = -sit; P.lLz = P.lRz = 1.45; P.lean = 0.35 + 0.05*Math.sin(T*0.1); P.aLz = P.aRz = -0.3; P.aLx = P.aRx = 0.4;
        P.hx = 0.2*Math.sin(T*0.1); P.hz = 0.16 + 0.08*Math.cos(T*0.1); P.roll = 0.06*Math.sin(T*0.1); P.jaw = 0.3; P.face = 'X'; P.stars = 1; P.sweat = 1; }
      P.wag = 0.05; break;
    case 'cheer': {
      const ph = T*0.2, run = Math.abs(e.vx||0) > 0.02;
      P.by = Math.abs(Math.sin(ph))*0.3; P.sy = 1 + 0.07*Math.sin(ph*2); P.sx = 1 - 0.035*Math.sin(ph*2);
      P.aLz = 2.5 + 0.35*Math.sin(T*0.45); P.aRz = 2.5 + 0.35*Math.sin(T*0.45 + 1.4); P.aLx = P.aRx = 0.45;
      P.hx = 0.14*Math.sin(ph); P.hz = 0.12; P.lean = run ? -0.08 : 0.05; P.jaw = 0.45;
      if(run){ k.ph += 0.35; P.lLz = Math.sin(k.ph)*0.7; P.lRz = -Math.sin(k.ph)*0.7; }
      P.face = 'H'; P.wag = 0.95; P.wagSpd = 0.55; break; }
    case 'fall':
      P.sy = 1.1; P.sx = 0.94; P.aLz = P.aRz = 2.7; P.aLx = P.aRx = 0.35; P.lLz = 0.35; P.lRz = -0.25; P.hz = 0.15; P.jaw = 0.6; P.face = 'O'; P.wag = 0.8; P.wagSpd = 0.4; break;
    case 'jump':
      if((e.vy||0) > 0.02){ P.sy = 1.1; P.sx = 0.95; P.aLz = P.aRz = 2.0; P.lLz = 0.8; P.lRz = 0.4; }
      else { P.sy = 1.04; P.aLz = P.aRz = 2.4; P.aLx = P.aRx = 0.3; P.lLz = 0.4; P.lRz = -0.2; }
      P.jaw = 0.5; P.face = 'O'; P.wag = 0.7; P.wagSpd = 0.35; break;
    case 'roar': {
      const a = 0.22;
      if(p < a){ const q = p/a; P.lean = 0.28*q; P.hz = -0.12*q; P.aLz = P.aRz = -0.6*q; P.sy = 1 - 0.08*q; P.jaw = 0.2; }
      else { const q = Math.min(1, (p - a)/0.12), rel = U.smooth(p, 0.82, 1);
        P.lean = lerp(0.28, -0.1, q)*(1 - rel); P.hz = 0.42*q*(1 - rel); P.aLz = P.aRz = lerp(-0.6, 0.95, q)*(1 - rel) + 0.2*rel; P.aLx = P.aRx = (0.3 + 0.8*q)*(1 - rel) + 0.16*rel;
        P.sy = 1 + 0.06*q*(1 - rel); P.bx = Math.sin(T*2.3)*0.03*(1 - rel)*q; P.jaw = 0.95*(1 - rel); }
      P.face = 'O'; P.wag = 0.8; P.wagSpd = 0.4; break; }
    case 'special':
      P.sy = 0.92; P.lean = -0.2; P.aLz = P.aRz = 1.4; P.face = 'O'; break;
    default:
      P.sy = 1 + 0.024*br; break;
  }
}

// ================================================================ gameplay helpers
function fh(){ return G.foes.h; }
function diffK(){ return (G.game && G.game.diff) || { think:1, foeSpeed:1 }; }
function sfx(name, o){ if(G.audio && G.audio.sfx) try { G.audio.sfx(name, o); } catch(err){ G.logError('bossA sfx', err); } }
function fx(kind, x, y, z, o){ if(G.fx && G.fx.burst) G.fx.burst(kind, x, y, z, o); }
function say(e, s){ fh().say(e, s); }
function shake(p, f){ if(G.cam && G.cam.shake) G.cam.shake(p, f); }
function rng(){ return G.rng(); }
// horizontal limits the boss should stay within: the visible belt (the boss arena is camera-locked in stages)
function xLo(r){ return G.cam.x - G.cam.halfW + (r||0.8) + 0.4; }
function xHi(r){ return G.cam.x + G.cam.halfW - (r||0.8) - 0.4; }
function clampX(x, r){ const a = xLo(r), b = xHi(r); return a < b ? clamp(x, a, b) : (a+b)/2; }
function clampZ(z){ return clamp(z, G.cfg.ZMIN + 0.2, G.cfg.ZMAX - 0.2); }
function H(o){ return Object.assign({ at:5, dur:4, x0:-0.2, x1:1.9, zr:0.6, y0:0, y1:2.2, dmg:10, kb:0.1, up:0, stun:18, kind:'slash', power:1 }, o); }
// start a telegraphed follow-up from inside an attack's onEnd (h.attack refuses while state is 'act')
function chain(e, def, windup){
  const w = Math.max(1, Math.round(windup * (diffK().think || 1)));
  e.pending = { def, t:w };
  G.setAnim(e, def.windupAnim || 'windup', w);
  if(G.fx && G.fx.alert) G.fx.alert(e);
  G.bus.emit('alert', { ent:e });
}
// after a move: generous gap (shorter in phase 2)
function after(e, base){ e.cool = Math.round(base * (e.phase ? 0.7 : 1) * (0.85 + rng()*0.3)); e.plan = null; }
// every custom state a move can leave behind is reset here (interrupt / KO / move end)
function cleanup(e){
  e.intangible = false; e.warnOn = false; e.warnLock = false;
  if(e.burrowed){ e.burrowed = false; }
  e.shadowAlpha = null;
  if(!e.floaty) e.gravScale = 1;
  if(e.rig && e.rig.setAlpha && !e.dead) e.rig.setAlpha(1);
  if(e.ghostA != null) e.ghostA = 1;
}
function onInterruptFor(e){ return ()=>{ cleanup(e); if(e.floaty) e.gravScale = 1; e.plan = null; e.cool = Math.max(e.cool||0, 36); }; }
// KO without damage numbers (ghost brothers / summoned helpers give up when their boss is purified)
function giveUp(b, line){
  if(!b || b.dead || b.removed || b.removeMe) return;
  b.atk = null; b.pending = null; b.atkArmor = false;
  cleanup(b); b.gravScale = b.floaty ? 0.35 : 1;
  b.hp = 0; b.dead = true; b.deadT = 0; b.ignoreForClear = true;
  G.setState(b, 'ko'); b.vy = 0.12; b.vx = 0; b.onGround = false; b.bounce = 0;
  fh().release(b);
  if(line) say(b, line);
  G.bus.emit('ko', { ent:b, x:b.x, y:b.y + b.height*0.5, z:b.z });
}
// weighted move choice (scratch arrays, no per-tick allocation)
const _mn = [], _mw = [];
function pick(e){
  let tot = 0;
  for(let i=0;i<_mn.length;i++){ if(_mn[i]===e.lastMove) _mw[i] *= 0.3; tot += _mw[i]; }
  let r = rng()*tot;
  for(let i=0;i<_mn.length;i++){ r -= _mw[i]; if(r <= 0) return _mn[i]; }
  return _mn[0];
}
function opt(name, w){ if(w > 0){ _mn.push(name); _mw.push(w); } }
function go(e, def, windup){
  const h = fh();
  if(!h.token(e)){ h.stop(e); return false; }
  if(h.attack(e, def, windup)){ e.lastMove = e.plan; e.plan = null; e.moves = (e.moves||0) + 1; return true; }
  return false;
}
function approach(e, x, z, k){ fh().walkTo(e, clampX(x, e.radius), clampZ(z), (e.def.spd || 0.045)*(k||1)); }
// between moves: keep a comfortable distance, facing the hero
function hover(e, t, dist, k){
  const h = fh();
  if(!e.hoverT || --e.hoverT <= 0){ e.hoverT = 70 + (rng()*60|0); e.hoverZ = (rng() - 0.5)*1.3; }
  const sd = e.x < t.x ? -1 : 1;
  let tx = t.x + sd*dist;
  if(tx < xLo(e.radius) || tx > xHi(e.radius)) tx = t.x - sd*dist;
  tx = clampX(tx, e.radius);
  const tz = clampZ(t.z + e.hoverZ);
  if(Math.abs(tx - e.x) < 0.35 && Math.abs(tz - e.z) < 0.3){ h.stop(e); h.face(e, t); return; }
  h.walkTo(e, tx, tz, (e.def.spd || 0.045)*(k||0.7));
  h.face(e, t);
}
const PHASE_ROAR = { id:'bossA_rage', anim:'roar', len:72, hits:[],
  fn(e, t){ if(t===0) G.setAnim(e, 'roar', 72, 0.3);
    if(t===16){ shake(4, 30); fx('shock', e.x, 0.02, e.z, { scale:1.3, color:'#ffd0f0' }); fx('ring', e.x, e.height*0.7, e.z + 0.3, { scale:1.8, color:'#ff9ad0' }); sfx('bossRoar'); } },
  onEnd(e){ e.cool = 24; } };
function phaseCheck(e, line){
  if(e.phase===0 && e.hp <= e.maxHp*0.5 && !e.dead){
    e.phase = 1; e.spdMul = 1.2; e.plan = null;
    G.bus.emit('bossPhase', { boss:e, phase:1 });
    say(e, line);
    fh().attack(e, e.def.rage || PHASE_ROAR, 0);
    return true;
  }
  return false;
}
function introRoar(len, line, fn){
  return { id:'bossA_intro', anim:'roar', len, hits:[],
    fn(e, t){ if(t===0){ G.setAnim(e, 'roar', len, 0.3); if(line) say(e, line); }
      if(t===18){ sfx('bossRoar'); shake(3, 24); fx('shock', e.x, 0.02, e.z, { scale:1.2 }); }
      if(fn) fn(e, t); },
    onEnd(e){ e.cool = 30; } };
}
function common(e){ // per-boss bookkeeping on init
  e.onInterrupt = onInterruptFor(e);
  e.plan = null; e.moves = 0; e.lastMove = null; e.introDone = false;
  e.warnOn = false; e.warnX = e.x; e.warnZ = e.z; e.warnR = 1.5; e.warnLock = false;
}

// ================================================================ 1) てつづめのガルム — grey wolf general
const GARM = { FUR:'#b7c0ce', FUR_D:'#9aa5b7', FUR_L:'#eef1f6', STEEL:'#5d6778', STEEL_D:'#434a59', CLAW:'#f2f5fa',
  SCARF:'#ff5a3c', SCARF_D:'#d9432a', GOLD:'#ffc93a', PINK:'#f5a3b6', NOSE:'#2b2733', BELT:'#3b3345' };
function buildGarm(){
  const c = GARM;
  const k = new Kit({ type:'garm', gkey:'garm', lie:0.34, sit:0.38, pose:poseGarm, apply:applyGarm });
  const hipY = 0.5;
  k.legL = k.grp(k.body, [-0.02, hipY, -0.2]); k.legR = k.grp(k.body, [-0.02, hipY, 0.2]);
  const legFill = (b)=>{ b.add(cap(0.13, 0.14), c.FUR_D, [0,-0.15,0]); b.add(sph(0.19,16,12), c.STEEL_D, [0.05,-0.37,0], null, [1.35,0.7,1.05]);
    b.add(tor(0.135, 0.03, 6, 18), c.GOLD, [0.02,-0.27,0], [HPI,0,0]); };
  k.part(k.legL, 'leg', legFill); k.part(k.legR, 'leg', legFill);
  k.hips = k.grp(k.body, [0, hipY, 0]);
  k.part(k.hips, 'torso', (b)=>{
    b.add(sph(0.44,22,16), c.FUR, [0,0.34,0], null, [0.92,1.05,0.88]);
    b.add(sph(0.3,16,12), c.FUR_L, [0.19,0.3,0], null, [0.55,0.95,0.8]);
    b.add(tor(0.34, 0.06, 8, 28), c.BELT, [0,0.1,0], [HPI,0,0], [1.0,0.96,1]);
    b.add(G.look.geo.rbox(0.06, 0.13, 0.15, 0.02, 2), c.GOLD, [0.35,0.1,0]);
    for(let s=-1;s<=1;s+=2){ b.add(sph(0.19,16,12), c.STEEL, [-0.02,0.66,s*0.34], null, [1,0.72,1]); b.add(tor(0.16,0.025,6,20), c.GOLD, [-0.02,0.62,s*0.34], [HPI,0,0]);
      b.add(cone(0.06,0.16,8), c.STEEL_D, [-0.02,0.8,s*0.4], [s*0.45,0,0]); }
    for(let i=0;i<9;i++){ const a = 0.95 + i/8*(TAU - 1.9); b.add(sph(0.16,14,10), c.FUR_L, [Math.cos(a)*0.3, 0.9, Math.sin(a)*0.3], null, [1,0.85,1]); }
    for(let i=-1;i<=1;i++) b.add(sph(0.12,12,10), c.FUR_L, [0.3,0.6 - Math.abs(i)*0.03,i*0.12], null, [0.8,1,1]);
    b.add(tor(0.3, 0.1, 10, 28), c.SCARF, [0.02,0.8,0], [HPI,0,0]);
    b.add(sph(0.12,14,10), c.SCARF_D, [0.27,0.74,0.18]);
  });
  k.scarf = k.grp(k.hips, [-0.24, 0.8, 0.05]);
  k.part(k.scarf, 'scarf', (b)=>{ b.add(cap(0.075, 0.42, 4, 10), c.SCARF, [-0.2,-0.08,0.05], [0,0,1.95], [1,1,0.42]); b.add(cap(0.065, 0.32, 4, 10), c.SCARF_D, [-0.17,-0.12,-0.06], [0,0,2.25], [1,1,0.42]); });
  k.tail = k.grp(k.hips, [-0.38, 0.18, 0]);
  k.part(k.tail, 'tail', (b)=>{ b.add(sph(0.13,14,10), c.FUR_D, [-0.07,0.04,0]); b.add(sph(0.16,14,10), c.FUR_D, [-0.19,0.17,0]); b.add(sph(0.15,14,10), c.FUR, [-0.26,0.33,0]); b.add(sph(0.11,12,10), c.FUR_L, [-0.28,0.47,0]); });
  const armFill = (b)=>{ b.add(cap(0.115, 0.14), c.FUR, [0,-0.12,0]); b.add(cyl(0.15, 0.13, 0.2, 16), c.STEEL, [0.01,-0.3,0]); b.add(tor(0.145,0.028,6,20), c.GOLD, [0.01,-0.21,0], [HPI,0,0]);
    b.add(sph(0.165,16,12), c.STEEL_D, [0.03,-0.45,0], null, [1.1,0.95,1]);
    for(let i=-1;i<=1;i++) b.add(cone(0.042,0.26,8), c.CLAW, [0.18,-0.52,i*0.075], [0,0,-2.0]); };
  k.armL = k.grp(k.hips, [0.0, 0.62, -0.4]); k.armR = k.grp(k.hips, [0.0, 0.62, 0.4]);
  k.part(k.armL, 'arm', armFill); k.part(k.armR, 'arm', armFill);
  k.tip.position.set(0.32, -0.6, 0); k.armR.add(k.tip); k.base.position.set(0.02, -0.3, 0); k.armR.add(k.base);
  // head
  k.head = k.grp(k.hips, [0.04, 0.86, 0]);
  const HS = { c:[0.06,0.5,0], r:[0.58,0.52,0.6] }, MZ = { c:[0.6,0.38,0], r:[0.21,0.15,0.21] };
  k.part(k.head, 'head', (b)=>{
    b.add(sph(0.58,24,16), c.FUR, HS.c, null, [1.0,0.9,1.03]);
    b.add(sph(0.44,20,14), c.FUR_L, [0.22,0.35,0], null, [0.9,0.6,1.15]);
    b.add(sph(0.2,16,12), c.FUR_L, MZ.c, null, [1.05,0.72,1.05]);
    b.add(sph(0.08,12,10), c.NOSE, [0.8,0.44,0], null, [1,0.75,1.2]); b.add(sph(0.025,6,5), WHITE, [0.85,0.48,0.03]);
    for(let s=-1;s<=1;s+=2){ b.add(cone(0.11,0.26,10), c.FUR_L, [0.1,0.3,s*0.56], [s*(HPI+0.5),0,0]); b.add(cone(0.08,0.2,10), c.FUR_L, [0.0,0.42,s*0.58], [s*(HPI+0.15),0,0]); }
    b.add(cone(0.09,0.22,10), c.FUR_D, [-0.02,0.98,0], [0,0,0.5]); b.add(cone(0.07,0.18,10), c.FUR_D, [-0.14,0.95,0.07], [0.2,0,0.8]); b.add(cone(0.07,0.18,10), c.FUR_D, [-0.14,0.95,-0.07], [-0.2,0,0.8]);
    blush(b, HS, -0.36, -0.14, 0.09); blush(b, HS, 0.36, -0.14, 0.09);
  });
  const earFill = (b)=>{ b.add(cone(0.17,0.42,12), c.FUR, [0,0.18,0], null, [0.5,1,1]); b.add(cone(0.1,0.28,10), c.PINK, [0.05,0.15,0], null, [0.35,1,1]); };
  k.earL = k.grp(k.head, [-0.02, 0.9, -0.3]); k.earR = k.grp(k.head, [-0.02, 0.9, 0.3]);
  k.part(k.earL, 'ear', earFill); k.part(k.earR, 'ear', earFill);
  k.earL.rotation.x = -0.35; k.earR.rotation.x = 0.35;
  const ev = 0.06, eu = 0.2, es = 0.105;
  k.faceSet(k.head, 'g', {
    N:(b)=>{ eyeAngry(b, HS, -eu, ev, es); eyeAngry(b, HS, eu, ev, es); mFrown(b, MZ, 0, -0.1, 0.055); feat(b, MZ, -0.06, -0.12, 0.01, cone(0.018,0.05,6), WHITE, [1,1,0.6], Math.PI); feat(b, MZ, 0.06, -0.12, 0.01, cone(0.018,0.05,6), WHITE, [1,1,0.6], Math.PI); },
    B:(b)=>{ eyeLine(b, HS, -eu, ev, es, 0.25); eyeLine(b, HS, eu, ev, es, 0.25);
      for(let s=-1;s<=1;s+=2) feat(b, HS, s*eu + (s<0?1:-1)*es*0.12, ev + es*1.22, es*0.1, cap(es*0.2, es*1.05, 3, 8), '#2e2533', [1,1,0.55], HPI - (s<0?1:-1)*0.42);
      mFrown(b, MZ, 0, -0.1, 0.055); },
    O:(b)=>{ eyeAngry(b, HS, -eu, ev, es, { tilt:0.55, pupil:0.48 }); eyeAngry(b, HS, eu, ev, es, { tilt:0.55, pupil:0.48 }); mOpen(b, MZ, 0, -0.1, 0.1, 0.085, true); },
    S:(b)=>{ eyeSqueeze(b, HS, -eu, ev, es); eyeSqueeze(b, HS, eu, ev, es); mO(b, MZ, 0, -0.1, 0.035); },
    X:(b)=>{ eyeX(b, HS, -eu, ev, es); eyeX(b, HS, eu, ev, es); mWavy(b, MZ, 0, -0.1, 0.07); },
    H:(b)=>{ eyeArc(b, HS, -eu, ev, es); eyeArc(b, HS, eu, ev, es); mOpen(b, MZ, 0, -0.1, 0.085, 0.06, false); blush(b, HS, -0.36, -0.12, 0.11); blush(b, HS, 0.36, -0.12, 0.11); },
  });
  k.extras(k.head, [0.2, 0.85, 0.55], 0.5, 1.1);
  return k.rig(2.6, 0.8);
}
function poseGarm(k, e, P, T){
  const an = e.anim, len = e.animLen|0, p = len>0 ? clamp(e.animT/len, 0, 1) : ((e.animT|0) % 60)/60;
  if(an==='idle' || an==='walk'){ P.aRz += 0.18; P.aLz += 0.12; P.aRx += 0.12; P.aLx += 0.12; }
  if(an==='special'){ // sky dive: claws down while falling, then stuck in the ground and pull free
    if(!e.onGround && p < 0.4){ P.sy = 1.14; P.sx = 0.9; P.aLz = P.aRz = 0.35; P.aLx = P.aRx = 0.55; P.lLz = P.lRz = 1.05; P.hz = -0.35; P.lean = -0.1; P.face = 'O'; }
    else { const q = U.smooth(p, 0.7, 0.95), sh = p < 0.7 ? Math.sin(T*1.6)*0.03 : 0;
      P.by = -0.22*(1 - q); P.sy = lerp(0.84, 1, q); P.sx = lerp(1.1, 1, q); P.lean = lerp(-0.45, 0, q); P.bx = sh;
      P.aLz = P.aRz = lerp(0.95, 0.22, q); P.aLx = P.aRx = 0.3; P.lLz = lerp(0.55, 0, q); P.lRz = lerp(-0.45, 0, q); P.hz = lerp(-0.2, 0, q);
      P.face = p < 0.7 ? 'S' : 'N'; P.sweat = p < 0.7 ? 1 : 0; }
  }
}
function applyGarm(k, e, C, T, P){
  k.body.position.set(C.bx, C.by, 0); k.body.scale.set(C.sx + k.sqx, C.sy + k.sqy, C.sx + k.sqx); k.body.rotation.set(C.roll, 0, C.rz);
  k.hips.rotation.set(0, C.twist, C.lean);
  k.head.rotation.set(C.hx, C.hy, C.hz);
  k.armL.rotation.set(C.aLx, 0, C.aLz); k.armR.rotation.set(-C.aRx, 0, C.aRz);
  k.legL.rotation.z = C.lLz; k.legR.rotation.z = C.lRz;
  const w = Math.sin(T*(P.wagSpd||0.1)*2.2);
  k.tail.rotation.set(w*C.wag*0.8, 0, 0.15 + 0.1*Math.sin(T*0.05) + C.wag*0.1);
  const spd = Math.min(1, Math.abs(e.vx||0)*8 + Math.abs(e.vy||0)*3);
  k.scarf.rotation.set(0.12*Math.sin(T*0.23), 0, 0.2*Math.sin(T*0.17) - spd*0.5);
  k.earL.rotation.z = 0.08*Math.sin(T*0.06) + (P.face==='S'||P.face==='X' ? -0.45 : 0);
  k.earR.rotation.z = 0.08*Math.sin(T*0.06 + 1) + (P.face==='S'||P.face==='X' ? -0.45 : 0);
}
// ---- garm moves
const GARM_M = {
  intro: introRoar(76, 'わが てつづめ、うけてみよ！'),
  claw: { id:'garm_claw', anim:'attack', len:76,
    move:[{ at:6, vx:0.09 }, { at:28, vx:0.09 }, { at:52, vx:0.13 }],
    hits:[ H({ at:10, dur:4, x0:-0.2, x1:2.0, zr:0.6, dmg:10, kb:0.07, stun:16 }), H({ at:32, dur:4, x0:-0.2, x1:2.0, zr:0.6, dmg:10, kb:0.07, stun:16 }),
           H({ at:57, dur:5, x0:-0.2, x1:2.2, zr:0.65, dmg:14, kb:0.16, up:0.2, stun:22, power:2 }) ],
    fn(e, t){ if(t===0) G.setAnim(e, 'attack', 22, 0.45); else if(t===22) G.setAnim(e, 'attack2', 22, 0.45); else if(t===44) G.setAnim(e, 'attack3', 32, 0.4);
      if(t===20 || t===42){ const p = fh().target(e); if(p){ fh().face(e, p); e.vz = clamp((p.z - e.z)*0.1, -0.06, 0.06); } } },
    onEnd(e){ after(e, 84); } },
  lunge: { id:'garm_lunge', anim:'dash', len:58,
    hits:[ H({ at:4, dur:17, x0:-0.3, x1:1.8, zr:0.5, dmg:14, kb:0.2, up:0.16, stun:22, power:2 }) ],
    fn(e, t){ if(t===0){ G.setAnim(e, 'dash', 58, 0.08); sfx('swing'); }
      if(t>=3 && t<21){ e.vx = e.face*0.3; if(t%3===0) fx('dust', e.x - e.face*0.6, 0.05, e.z, { count:2, scale:0.7, dir:-e.face }); } },
    onEnd(e){ after(e, 88); } },
  lunge2: { id:'garm_lunge2', anim:'dash', len:118,
    hits:[ H({ at:4, dur:17, x0:-0.3, x1:1.8, zr:0.5, dmg:14, kb:0.2, up:0.16, stun:22, power:2 }), H({ at:68, dur:17, x0:-0.3, x1:1.8, zr:0.5, dmg:14, kb:0.2, up:0.16, stun:22, power:2 }) ],
    fn(e, t){
      if(t===0){ G.setAnim(e, 'dash', 44, 0.08); sfx('swing'); }
      if((t>=3 && t<21) || (t>=67 && t<85)){ e.vx = e.face*0.3; if(t%3===0) fx('dust', e.x - e.face*0.6, 0.05, e.z, { count:2, scale:0.7, dir:-e.face }); }
      if(t===44){ const p = fh().target(e); if(p) fh().face(e, p); G.setAnim(e, 'windup', 22); if(G.fx && G.fx.alert) G.fx.alert(e); say(e, 'もういっちょ！'); }
      if(t>44 && t<66){ const p = fh().target(e); if(p) e.vz = clamp((p.z - e.z)*0.08, -0.05, 0.05); }
      if(t===66){ G.setAnim(e, 'dash', 52, 0.04); sfx('swing'); } },
    onEnd(e){ after(e, 80); } },
  roar: { id:'garm_roar', anim:'roar', len:62,
    areas:[{ at:18, r:3.4, zr:2.0, y0:-0.5, y1:3, dmg:2, kb:0.34, up:0, stun:12, power:1, kind:'wind', dur:3 }],
    fn(e, t){ if(t===0) G.setAnim(e, 'roar', 62, 0.3);
      if(t===18){ sfx('bossRoar'); shake(3.5, 22); say(e, 'ガオーーッ！');
        fx('shock', e.x, 0.02, e.z, { scale:1.5 }); fx('ring', e.x, 1.5, e.z + 0.4, { scale:2.4 }); fx('ring', e.x, 1.5, e.z + 0.4, { scale:1.5, life:22 }); } },
    onEnd(e){ after(e, 64); } },
  sky: { id:'garm_sky', anim:'jump', len:172, hits:[], fn: skyFn, onEnd(e){ cleanup(e); if(e.y > 0.05) e.vy = Math.min(e.vy, -0.3); after(e, 72); } },
};
function skyFn(e, t){
  const p = fh().target(e);
  if(t===0){ G.setAnim(e, 'jump'); e.vy = 0.36; e.vx = 0; e.onGround = false; e.skyLand = false; G.bus.emit('jump', { ent:e }); fx('dust', e.x, 0.05, e.z, { count:8, scale:1.2 }); sfx('jump'); say(e, 'とうっ！'); }
  if(t===8) e.intangible = true;                                    // gone into the sky: cannot be hit
  if(t < 100){ e.vx = 0; e.vz = 0;
    if(t > 2 && e.y > 4.5 && e.y < 12){ e.gravScale = 0; e.vy = Math.max(e.vy, 0.42); }
    if(e.y >= 12){ e.y = 12; e.vy = 0; e.gravScale = 0; }
  }
  if(t>=22 && t<78 && p){
    if(!e.warnOn){ e.warnOn = true; e.warnX = p.x; e.warnZ = p.z; e.warnLock = false; e.warnR = 1.75; sfx('alert'); }
    e.warnX += (clampX(p.x, 0.9) - e.warnX)*0.18; e.warnZ += (clampZ(p.z) - e.warnZ)*0.18;
  }
  if(t===78){ e.warnLock = true; sfx('alert'); }
  if(t===102){ e.x = e.px = e.warnX; e.z = e.pz = e.warnZ; e.y = e.py = 11; e.vy = -0.45; e.gravScale = 1; e.vx = 0; e.vz = 0;
    if(p) e.face = p.x > e.x ? 1 : -1; G.setAnim(e, 'special', 70, 0.25); }
  if(t > 102 && !e.skyLand && (e.onGround || t > 140)){
    if(!e.onGround){ e.y = 0; e.vy = 0; e.onGround = true; }
    e.skyLand = true; e.intangible = false; e.warnOn = false;
    G.combat.area({ owner:e, x:e.x, z:e.z, r:1.8, zr:1.1, y0:-0.5, y1:2.2, dmg:16, kb:0.16, up:0.24, stun:24, power:2, kind:'blunt', dur:3 });
    fx('shock', e.x, 0.02, e.z, { scale:1.5 }); fx('dust', e.x, 0.1, e.z, { count:12, scale:1.4 }); shake(5.5, 22); sfx('hitBig'); say(e, 'ドーン！');
  }
}
function garmAI(e){
  const h = fh(), t = h.target(e);
  if(!e.introDone){ e.introDone = true; if(t) h.face(e, t); h.attack(e, GARM_M.intro, 0); return; }
  if(!t){ h.stop(e); return; }
  if(phaseCheck(e, 'まだまだ！ ここからが ほんばんだ！')) return;
  h.face(e, t);
  if(e.cool > 0){ hover(e, t, 3.2, 0.7); return; }
  const dx = t.x - e.x, adx = Math.abs(dx), adz = Math.abs(t.z - e.z), sd = dx > 0 ? -1 : 1;
  if(!e.plan){
    _mn.length = 0; _mw.length = 0;
    opt('claw', adx < 3 ? 5 : 2); opt('lunge', adx > 2.4 ? 4 : 1.5); opt('roar', adx < 2.6 ? 2.2 : 0.6); opt('sky', e.phase ? 3.2 : 0);
    e.plan = pick(e); e.planT = 0;
  }
  if(++e.planT > 170){ e.plan = null; e.cool = 20; return; }
  switch(e.plan){
    case 'claw':  if(adx < 2.1 && adz < 0.42) go(e, GARM_M.claw, e.phase ? 18 : 22); else approach(e, t.x + sd*1.55, t.z); break;
    case 'lunge': if(adx > 2.3 && adx < 7 && adz < 0.3) go(e, e.phase ? GARM_M.lunge2 : GARM_M.lunge, 30); else approach(e, t.x + sd*4.2, t.z); break;
    case 'roar':  if(adx < 3.3 && adz < 1.4) go(e, GARM_M.roar, 30); else approach(e, t.x + sd*2.2, t.z); break;
    case 'sky':   go(e, GARM_M.sky, 30); break;
    default: e.plan = null;
  }
}

// ================================================================ 2) りくザメ — land shark-dog
const SHK = { BLUE:'#5b86b8', BLUE_D:'#3f6a9c', BELLY:'#eef4fa', RED:'#e0413a', GOLD:'#ffc93a', NOSE:'#26303e', GUM:'#8a2436', GILL:'#34557d', DIRT:'#b8905e', DIRT_D:'#94703f' };
function buildShark(){
  const c = SHK;
  const k = new Kit({ type:'shark', gkey:'shark', lie:0.25, sit:0.2, pose:poseShark, apply:applyShark });
  // four stubby legs
  const legFill = (b)=>{ b.add(cap(0.15, 0.12), c.BLUE, [0,-0.13,0]); b.add(sph(0.18,14,10), c.BELLY, [0.04,-0.32,0], null, [1.25,0.6,1.1]); };
  k.legs = [];
  const LP = [[0.42,-0.36],[0.42,0.36],[-0.62,-0.36],[-0.62,0.36]];
  for(let i=0;i<4;i++){ const g = k.grp(k.body, [LP[i][0], 0.43, LP[i][1]]); k.part(g, 'leg', legFill); k.legs.push(g); }
  k.trunk = k.grp(k.body, [0, 0.95, 0]);
  k.part(k.trunk, 'trunk', (b)=>{
    b.add(sph(0.62,22,16), c.BLUE, [-0.36,0,0], null, [1.2,0.85,0.9]);
    b.add(sph(0.55,20,14), c.BELLY, [-0.3,-0.14,0], null, [1.15,0.68,0.84]);
    for(let s=-1;s<=1;s+=2) b.add(cone(0.17,0.5,10), c.BLUE_D, [-0.05,-0.24,s*0.5], [s*(HPI+0.5),0,0.4], [1,1,0.32]);
    b.add(tor(0.5, 0.085, 8, 28), c.RED, [0.1,0.02,0], [0,HPI,0], [1,1.02,1]);
    b.add(sph(0.11,12,10), c.GOLD, [0.16,-0.52,0], null, [0.5,1,1]); b.add(sph(0.045,8,6), '#fff4c0', [0.2,-0.5,0.04]);
  });
  k.fin = k.grp(k.trunk, [-0.34, 0.42, 0]);
  k.part(k.fin, 'fin', (b)=>{ b.add(cone(0.36, 0.84, 14), c.BLUE_D, [-0.02,0.33,0], [0,0,0.38], [1,1,0.28]); b.add(sph(0.05,8,6), c.BELLY, [-0.13,0.6,0.05], null, [1,0.5,0.6]); });
  k.tail = k.grp(k.trunk, [-1.02, 0.02, 0]);
  k.part(k.tail, 'tail', (b)=>{ b.add(sph(0.27,16,12), c.BLUE, [-0.14,0,0], null, [1.4,0.78,0.7]);
    b.add(cone(0.2,0.66,12), c.BLUE_D, [-0.52,0.28,0], [0,0,0.8], [1,1,0.3]); b.add(cone(0.16,0.46,12), c.BLUE_D, [-0.46,-0.18,0], [0,0,2.35], [1,1,0.3]); });
  // head: upper dome + pac-man jaw
  k.head = k.grp(k.trunk, [0.28, 0.08, 0]);
  const HC = [0.35, 0.18, 0], HS = { c:HC, r:[0.8, 0.65, 0.74] };
  const T0 = 0.58*Math.PI;
  k.part(k.head, 'head', (b)=>{
    b.add(dome(0.74, 24, 12, 0, T0), c.BLUE, HC, null, [1.08,0.88,1]);
    b.add(sph(0.7,20,6), c.GUM, [HC[0], HC[1] - 0.15, 0], null, [1.07,0.03,0.99]);            // palate (shows when the jaw opens)
    for(let i=0;i<8;i++){ const a = -1.15 + i/7*2.3; b.add(cone(0.055,0.15,8), WHITE, [HC[0] + Math.cos(a)*0.76, HC[1] - 0.2, Math.sin(a)*0.7], [0,0,Math.PI]); }
    b.add(sph(0.1,12,10), c.NOSE, [HC[0]+0.83, HC[1]+0.12, 0], null, [1,0.8,1.2]); b.add(sph(0.03,6,5), WHITE, [HC[0]+0.9, HC[1]+0.17, 0.04]);
    for(let s=-1;s<=1;s+=2){ for(let g=0;g<3;g++) feat(b, HS, s*(0.98 + g*0.12), 0.02, 0.0, cap(0.02, 0.14, 3, 6), c.GILL, [1,1,0.6], 0.15*s);
      b.add(cone(0.14,0.3,10), c.BLUE, [HC[0]-0.15, HC[1]+0.62, s*0.34], [s*0.35,0,-0.2], [0.55,1,1]); b.add(cone(0.08,0.2,8), '#f5a3b6', [HC[0]-0.12, HC[1]+0.6, s*0.35], [s*0.35,0,-0.2], [0.35,1,1]); }
    blush(b, HS, -0.55, -0.02, 0.1); blush(b, HS, 0.55, -0.02, 0.1);
  });
  k.jaw = k.grp(k.head, [-0.25, HC[1] - 0.16, 0]);
  const JC = [HC[0] + 0.25, 0.0, 0];
  k.part(k.jaw, 'jaw', (b)=>{
    b.add(dome(0.7, 24, 8, T0, Math.PI - T0), c.BELLY, [JC[0], 0.02, 0], null, [1.07,0.72,0.97]);
    b.add(sph(0.66,20,6), c.GUM, [JC[0], 0.02, 0], null, [1.03,0.03,0.94]);
    b.add(sph(0.3,14,10), TONGUE, [JC[0]+0.25, 0.03, 0], null, [1,0.25,0.9]);
    for(let i=0;i<7;i++){ const a = -1.0 + i/6*2.0; b.add(cone(0.05,0.13,8), WHITE, [JC[0] + Math.cos(a)*0.66, 0.08, Math.sin(a)*0.62]); }
  });
  const ev = 0.32, eu = 0.3, es = 0.12;
  k.faceSet(k.head, 's', {
    N:(b)=>{ eyeAngry(b, HS, -eu, ev, es); eyeAngry(b, HS, eu, ev, es); },
    B:(b)=>{ eyeLine(b, HS, -eu, ev, es, 0.2); eyeLine(b, HS, eu, ev, es, 0.2);
      for(let s=-1;s<=1;s+=2) feat(b, HS, s*eu + (s<0?1:-1)*es*0.12, ev + es*1.22, es*0.1, cap(es*0.2, es*1.05, 3, 8), '#2e2533', [1,1,0.55], HPI - (s<0?1:-1)*0.42); },
    O:(b)=>{ eyeAngry(b, HS, -eu, ev, es, { tilt:0.6, pupil:0.45 }); eyeAngry(b, HS, eu, ev, es, { tilt:0.6, pupil:0.45 }); },
    S:(b)=>{ eyeSqueeze(b, HS, -eu, ev, es); eyeSqueeze(b, HS, eu, ev, es); },
    X:(b)=>{ eyeX(b, HS, -eu, ev, es); eyeX(b, HS, eu, ev, es); },
    H:(b)=>{ eyeArc(b, HS, -eu, ev, es); eyeArc(b, HS, eu, ev, es); blush(b, HS, -0.55, 0.0, 0.13); blush(b, HS, 0.55, 0.0, 0.13); },
  });
  k.extras(k.head, [0.25, 0.95, 0.62], 0.55, 1.05);
  // dirt mound shown while burrowed (under the fin)
  k.mound = k.grp(k.yaw, [-0.34, 0, 0]);
  k.part(k.mound, 'mound', (b)=>{ b.add(sph(0.55,18,10), c.DIRT, [0,0,0], null, [1.25,0.32,0.8]); b.add(sph(0.35,14,10), c.DIRT_D, [-0.45,0.02,0.1], null, [1.2,0.3,0.9]);
    for(let i=0;i<6;i++){ const a = i/6*TAU; b.add(sph(0.08,8,6), i&1 ? c.DIRT_D : '#cfae80', [Math.cos(a)*0.62, 0.08, Math.sin(a)*0.4]); } }, { outline:0.018 });
  k.mound.visible = false;
  k.tip.position.set(HC[0] + 0.9, HC[1] - 0.1, 0); k.head.add(k.tip); k.base.position.set(HC[0], HC[1], 0); k.head.add(k.base);
  return k.rig(2.25, 0.95);
}
function poseShark(k, e, P, T){
  const an = e.anim, len = e.animLen|0, p = len>0 ? clamp(e.animT/len, 0, 1) : ((e.animT|0) % 60)/60;
  P.ex = 0;
  if(an==='attack2'){ P.jaw = p < 0.42 ? 1.0 : Math.max(0.05, 1 - (p - 0.42)*6); P.lean = p < 0.42 ? 0.45 : lerp(0.45, 0, Math.min(1, (p-0.42)*3)); P.face = 'O'; }
  if(an==='attack'){ P.aLz = P.aRz = 0.2; }
  if(an==='special' && !e.burrowed){ P.ex = U.easeInCubic(p); P.lean = -0.6*p; P.jaw = 0; P.face = 'O'; }   // diving into the ground
  if(an==='cheer') P.jaw = 0.4;
  if(an==='roar') P.jaw = Math.max(P.jaw, 0.2);
}
function applyShark(k, e, C, T, P){
  const bur = !!e.burrowed;
  for(let i=0;i<k.meshes.length;i++){ const m = k.meshes[i]; if(m.parent===k.fin || m.parent===k.mound || m===k.sweat || m===k.stars || m.userData.face) continue; }
  k.trunk.visible = true;
  // hide everything but the fin while burrowed (the fin cuts through the ground with a little dirt mound)
  k.head.visible = !bur; k.tail.visible = !bur; for(let i=0;i<4;i++) k.legs[i].visible = !bur;
  k.trunkMesh = k.trunkMesh || k.trunk.children[0];
  k.trunkMesh.visible = !bur;
  k.mound.visible = bur;
  if(bur){
    const moving = Math.abs(e.vx||0) + Math.abs(e.vz||0) > 0.02, wind = e.anim==='windup';
    const wig = wind ? Math.sin(T*1.1)*0.18 : Math.sin(T*0.3)*0.06;
    k.body.position.set(0, -1.34 + (wind ? 0.08*Math.abs(Math.sin(T*0.5)) : 0.03*Math.sin(T*0.2)), 0);
    k.body.scale.set(1,1,1); k.body.rotation.set(0,0,0); k.trunk.rotation.set(0,0,0);
    k.fin.rotation.set(wig, 0, moving ? -0.12 : 0);
    k.mound.scale.set(1 + 0.08*Math.sin(T*0.4), 1 + (moving ? 0.25*Math.abs(Math.sin(T*0.5)) : 0.1*Math.sin(T*0.2)), 1);
    k.mound.position.x = -0.34 + (moving ? 0.1 : 0);
    return;
  }
  const sink = C.ex;                                                   // 'special': dive into the ground
  k.body.position.set(C.bx, C.by - 1.55*sink, 0);
  k.body.scale.set(C.sx + k.sqx, C.sy + k.sqy, C.sx + k.sqx);
  k.body.rotation.set(C.roll, 0, C.rz);
  k.trunk.rotation.set(0, C.twist*0.4, C.lean*0.6);
  k.head.rotation.set(C.hx, C.hy, C.hz*0.8);
  k.jaw.rotation.z = -clamp(C.jaw, 0, 1)*0.62;
  k.fin.rotation.set(0.05*Math.sin(T*0.1), 0, 0);
  const w = Math.sin(T*(P.wagSpd||0.1)*2.0);
  k.tail.rotation.set(0, w*(0.25 + C.wag*0.5), 0.05*Math.sin(T*0.07));
  // quadruped legs: front pair from the arm channels, hind pair from the leg channels
  const walking = e.anim==='walk' || e.anim==='run' || (e.anim==='cheer' && Math.abs(e.vx||0) > 0.02);
  if(walking){ const s = Math.sin(k.ph*1.2);
    k.legs[0].rotation.z = s*0.55; k.legs[3].rotation.z = s*0.55; k.legs[1].rotation.z = -s*0.55; k.legs[2].rotation.z = -s*0.55; }
  else { k.legs[0].rotation.z = (C.aLz - 0.22)*0.35; k.legs[1].rotation.z = (C.aRz - 0.22)*0.35; k.legs[2].rotation.z = C.lLz*0.45; k.legs[3].rotation.z = C.lRz*0.45; }
}
// ---- shark moves
function sharkDive(e, t){
  if(t===0){ G.setAnim(e, 'special', 20, 0.5); e.vx = 0; e.vz = 0; }
  if(t===14){ fx('dust', e.x, 0.1, e.z, { count:12, scale:1.4 }); sfx('dodge'); }
  if(t===18){ e.burrowed = true; e.intangible = true; e.shadowAlpha = 0.12; say(e, 'もぐった！'); }
}
function finDust(e, t){ if(t%5===0) fx('dust', e.x - 0.34*e.face, 0.05, e.z, { count:2, scale:0.6, dir:-U.sign(e.vx||e.face) }); }
function surface(e, vy, anim){
  e.burrowed = false; e.intangible = false; e.shadowAlpha = null;
  e.vy = vy; e.onGround = false;
  G.setAnim(e, anim || 'jump');
  fx('dust', e.x, 0.1, e.z, { count:12, scale:1.4 }); sfx('jump');
}
const SHARK_M = {
  intro: { id:'shark_intro', anim:'dash', len:130, hits:[],
    fn(e, t){ const p = fh().target(e);
      if(t===0){ G.setAnim(e, 'dash', 60); }
      if(t < 60 && p){ const tx = p.x + (e.x > p.x ? 4.2 : -4.2); e.vx = clamp((tx - e.x)*0.06, -0.12, 0.12); e.vz = clamp((p.z - e.z)*0.05, -0.06, 0.06); if(Math.abs(e.vx) > 0.01) e.face = e.vx > 0 ? 1 : -1; finDust(e, t); }
      if(t===60){ if(p) e.face = p.x > e.x ? 1 : -1; surface(e, 0.26, 'jump'); }
      if(t===72) say(e, 'じめんの そこから がぶっ！');
      if(t===92){ G.setAnim(e, 'roar', 38, 0.3); sfx('bossRoar'); shake(3, 20); } },
    onEnd(e){ cleanup(e); e.cool = 30; } },
  chomp: { id:'shark_chomp', anim:'attack', len:40, move:[{ at:5, vx:0.16 }],
    hits:[ H({ at:9, dur:5, x0:0, x1:2.2, zr:0.6, y1:1.9, dmg:14, kb:0.14, stun:20, kind:'slash', power:2 }) ],
    fn(e, t){ if(t===0) G.setAnim(e, 'attack', 40, 0.24); if(t===9){ sfx('slash'); say(e, 'ガブッ！'); } },
    onEnd(e){ after(e, 76); } },
  chomp2: { id:'shark_chomp2', anim:'attack', len:70, move:[{ at:5, vx:0.16 }, { at:34, vx:0.18 }],
    hits:[ H({ at:9, dur:5, x0:0, x1:2.2, zr:0.6, y1:1.9, dmg:12, kb:0.1, stun:20, kind:'slash', power:1 }), H({ at:39, dur:5, x0:0, x1:2.3, zr:0.65, y1:1.9, dmg:14, kb:0.16, up:0.16, stun:22, kind:'slash', power:2 }) ],
    fn(e, t){ if(t===0) G.setAnim(e, 'attack', 30, 0.3); if(t===30){ const p = fh().target(e); if(p) fh().face(e, p); G.setAnim(e, 'attack', 40, 0.22); }
      if(t===9 || t===39){ sfx('slash'); say(e, t===9 ? 'ガブッ！' : 'ガブガブッ！'); } },
    onEnd(e){ after(e, 70); } },
  fin: { id:'shark_fin', anim:'special', len:206,
    hits:[ H({ at:104, dur:52, x0:-0.55, x1:1.0, zr:0.45, y0:0, y1:0.8, dmg:12, kb:0.16, up:0.2, stun:20, kind:'blunt', power:2 }) ],
    fn(e, t){
      const p = fh().target(e);
      if(t < 20) sharkDive(e, t);
      if(t===20){ const side = p ? (e.x >= p.x ? 1 : -1) : 1; e.finSide = side; G.setAnim(e, 'dash', 60); }
      if(t>=20 && t<74){
        let sx = p ? p.x + e.finSide*5.2 : e.x;
        const lo = xLo(1.0), hi = xHi(1.0);
        if(sx < lo || sx > hi){ e.finSide = -e.finSide; sx = p ? p.x + e.finSide*5.2 : e.x; }
        sx = clamp(sx, lo, hi);
        e.vx = clamp((sx - e.x)*0.08, -0.17, 0.17); e.vz = p ? clamp((p.z - e.z)*0.08, -0.08, 0.08) : 0;
        if(Math.abs(e.vx) > 0.01) e.face = e.vx > 0 ? 1 : -1; finDust(e, t);
      }
      if(t===74){ e.vx = 0; e.vz = 0; e.face = -e.finSide; G.setAnim(e, 'windup', 30); if(G.fx && G.fx.alert) G.fx.alert(e); say(e, 'ザザザ…'); sfx('alert'); }
      if(t>=104 && t<156){ const nx = e.x + e.face*0.26; if(nx > xLo(0.6) && nx < xHi(0.6)) e.vx = e.face*0.26; else e.vx = 0; e.vz = 0;
        if(t===104) G.setAnim(e, 'dash', 52); if(t%3===0) fx('dust', e.x - e.face*0.4, 0.05, e.z, { count:3, scale:0.8, dir:-e.face }); }
      if(t===156){ e.vx = 0; surface(e, 0.24, 'jump'); say(e, 'ぷはっ！'); }
      if(t>=176 && e.onGround && e.anim==='jump') G.setAnim(e, 'idle'); },
    onEnd(e){ cleanup(e); after(e, 80); } },
  jump: { id:'shark_jump', anim:'special', len:204, hits:[],
    fn(e, t){
      const p = fh().target(e);
      if(t < 20) sharkDive(e, t);
      if(t===20) G.setAnim(e, 'dash', 64);
      if(t>=20 && t<84 && p){ e.vx = clamp((p.x - e.x)*0.07, -0.14, 0.14); e.vz = clamp((p.z - e.z)*0.07, -0.08, 0.08); if(Math.abs(e.vx) > 0.01) e.face = e.vx > 0 ? 1 : -1; finDust(e, t); }
      if(t===84){ e.vx = 0; e.vz = 0; e.warnOn = true; e.warnLock = true; e.warnX = e.x; e.warnZ = e.z; e.warnR = 1.4; G.setAnim(e, 'windup', 36);
        shake(1.6, 36); say(e, 'ゴゴゴ…'); sfx('alert'); if(p) e.face = p.x > e.x ? 1 : -1; }
      if(t>84 && t<120 && t%6===0) fx('dust', e.x + (rng()-0.5)*1.6, 0.05, e.z + (rng()-0.5)*0.9, { count:2, scale:0.8 });
      if(t===120){ e.warnOn = false; surface(e, 0.27, 'attack2'); G.setAnim(e, 'attack2', 46, 0.1);
        G.combat.area({ owner:e, x:e.x, z:e.z, r:1.4, zr:0.9, y0:-0.5, y1:2.4, dmg:16, kb:0.1, up:0.3, stun:24, power:2, kind:'slash', dur:4 });
        fx('shock', e.x, 0.02, e.z, { scale:1.2 }); shake(4.5, 18); say(e, 'がぶっ！'); sfx('hitBig'); }
      if(t>=168 && e.onGround && e.anim==='attack2') G.setAnim(e, 'idle'); },
    onEnd(e){ cleanup(e); after(e, 84); } },
  spit: { id:'shark_spit', anim:'shoot', len:52, hits:[],
    fn(e, t){ if(t===0) G.setAnim(e, 'shoot', 52, 0.25);
      if(t===12 || t===20 || t===28){ const p = fh().target(e), i = (t-12)/8;
        const dz = p ? (p.z - e.z) : 0, dist = p ? Math.max(2, Math.abs(p.x - e.x)) : 4;
        G.combat.shoot({ owner:e, kind:'rock', x:e.x + e.face*1.3, y:1.2, z:e.z, vx:e.face*clamp(dist/34, 0.08, 0.2), vy:0.2, grav:-0.012,
          vz: dz/34 + (i-1)*0.035, dmg:10, r:0.45, life:70, power:1, kb:0.1, stun:18 });
        sfx('shoot'); if(i===0) say(e, 'ペッペッ！'); } },
    onEnd(e){ after(e, 70); } },
};
function sharkAI(e){
  const h = fh(), t = h.target(e);
  if(!e.introDone){ e.introDone = true; h.attack(e, SHARK_M.intro, 0); return; }
  if(e.burrowed && !e.atk){ surface(e, 0.2, 'jump'); return; }     // safety: never stay underground outside a move
  if(!t){ h.stop(e); return; }
  if(phaseCheck(e, 'ぐぬぬ… ほんきの がぶがぶだ！')) return;
  h.face(e, t);
  if(e.cool > 0){ hover(e, t, 3.6, 0.7); return; }
  const dx = t.x - e.x, adx = Math.abs(dx), adz = Math.abs(t.z - e.z), sd = dx > 0 ? -1 : 1;
  if(!e.plan){
    _mn.length = 0; _mw.length = 0;
    opt('chomp', adx < 3 ? 5 : 1.5); opt('fin', 3); opt('jump', 3); opt('spit', e.phase ? (adx > 2.5 ? 3.5 : 1.5) : 0);
    e.plan = pick(e); e.planT = 0;
  }
  if(++e.planT > 170){ e.plan = null; e.cool = 20; return; }
  switch(e.plan){
    case 'chomp': if(adx < 2.2 && adz < 0.45) go(e, e.phase ? SHARK_M.chomp2 : SHARK_M.chomp, e.phase ? 18 : 22); else approach(e, t.x + sd*1.7, t.z); break;
    case 'fin':   go(e, SHARK_M.fin, 24); break;
    case 'jump':  go(e, SHARK_M.jump, 20); break;
    case 'spit':  if(adx > 2.8 && adx < 7.5 && adz < 1.2) go(e, SHARK_M.spit, 30); else approach(e, t.x + sd*4.5, t.z); break;
    default: e.plan = null;
  }
}

// ================================================================ 3) おばけのTたろう (+ 2 brothers)
const GHO = { SHEET:'#cfe6ff', SHEET_D:'#a9c4ec', STICK:'#a0703c', STRAW:'#f2c45a', BAND:'#e0413a', GOLD:'#ffc93a' };
const BRO_VAR = [
  { sheet:'#d4f5ea', sheetD:'#a6dcc8', cap:'#45c8a0', pom:'#fff4a0' },
  { sheet:'#ffe0ef', sheetD:'#f2b6d0', cap:'#ff7ab0', pom:'#ffffff' },
];
let nextBro = 0;
function buildGhost(opts){
  const bro = !!opts.bro, V = opts.v || { sheet:GHO.SHEET, sheetD:GHO.SHEET_D, cap:'#8a5ad0', pom:'#ffd23a' };
  const gkey = bro ? 'ghostbro'+opts.vi : 'ghost';
  const k = new Kit({ type: bro ? 'ghostbro' : 'ghost', gkey, lie:0.5, sit:0.1, oc:'#3a3a66', ol:0.022, pose:poseGhost, apply:applyGhost });
  k.scale = bro ? 0.8 : 1;
  k.body.scale.setScalar(k.scale);
  k.sheet = k.grp(k.body, [0, 0, 0]);
  const GS = { c:[0, 1.2, 0], r:[0.68, 0.7, 0.68] };
  k.part(k.sheet, 'sheet', (b)=>{
    b.add(lathe('sheet', [[0,0.12],[0.6,0.06],[0.84,0.04],[0.86,0.1],[0.8,0.24],[0.74,0.46],[0.7,0.72],[0.68,0.98],[0.67,1.2],[0.64,1.42],[0.56,1.63],[0.42,1.79],[0.22,1.88],[0,1.91]], 28), V.sheet);
    for(let i=0;i<9;i++){ const a = i/9*TAU + 0.2; b.add(sph(0.17,12,8), i&1 ? V.sheetD : V.sheet, [Math.cos(a)*0.8, 0.07, Math.sin(a)*0.8], null, [1,0.62,1]); }
    // night cap + brim + pompom (the main ghost wears a gold "T")
    b.add(tor(0.46, 0.09, 8, 28), WHITE, [0.02,1.72,0], [HPI - 0.18,0,0.25]);
    b.add(cone(0.44, 0.6, 18), V.cap, [-0.04,1.98,0], [0,0,0.38]);
    b.add(cone(0.2, 0.42, 14), V.cap, [-0.3,2.3,0], [0,0,1.05]);
    b.add(sph(0.12,12,10), V.pom, [-0.5,2.36,0]);
    if(!bro){ b.add(box(0.05,0.06,0.24), GHO.GOLD, [0.37,2.02,0], [0,0,0.38]); b.add(box(0.05,0.22,0.07), GHO.GOLD, [0.33,1.92,0], [0,0,0.38]); }
    blush(b, GS, -0.34, -0.06, 0.1); blush(b, GS, 0.34, -0.06, 0.1);
  });
  const nub = (withBroom)=> (b)=>{
    b.add(cap(0.12, 0.2, 4, 10), V.sheet, [0,-0.13,0]); b.add(sph(0.14,12,10), V.sheet, [0.02,-0.3,0]);
    if(withBroom){ b.add(cyl(0.035, 0.035, 1.55, 8), GHO.STICK, [0.06,-0.5,0]); b.add(tor(0.07,0.03,6,14), GHO.BAND, [0.06,-1.23,0], [HPI,0,0]);
      b.add(cone(0.21, 0.46, 14), GHO.STRAW, [0.06,-1.47,0], [0,0,Math.PI]); for(let i=-1;i<=1;i++) b.add(cyl(0.012,0.012,0.4,4), '#d9a53a', [0.06+i*0.08,-1.46,0.05], [0,0,i*0.2]); }
  };
  k.armL = k.grp(k.sheet, [0.05, 1.05, -0.64]); k.armR = k.grp(k.sheet, [0.05, 1.05, 0.64]);
  k.part(k.armL, 'armL', nub(false)); k.part(k.armR, 'armR', nub(true));
  k.tip.position.set(0.06, -1.62, 0); k.armR.add(k.tip); k.base.position.set(0.06, -0.3, 0); k.armR.add(k.base);
  const ev = 0.12, eu = 0.21, es = 0.115;
  const fills = {
    N:(b)=>{ for(let s=-1;s<=1;s+=2){ eyeDot(b, GS, s*eu, ev, es); feat(b, GS, s*eu, ev + es*0.62, es*0.1, sph(es*1.05,14,10), V.sheet, [1.08,0.5,0.5]); feat(b, GS, s*eu, ev + es*0.38, es*0.28, cap(es*0.1, es*1.3, 3, 6), INK, [1,1,0.5], HPI - s*0.12); }
      mGrin(b, GS, 0, -0.1, 0.13); feat(b, GS, -0.06, -0.2, 0.02, sph(0.05,10,8), TONGUE, [1,1.2,0.4]); },
    B:(b)=>{ eyeArc(b, GS, -eu, ev, es, true); eyeArc(b, GS, eu, ev, es, true); mGrin(b, GS, 0, -0.1, 0.13); feat(b, GS, -0.06, -0.2, 0.02, sph(0.05,10,8), TONGUE, [1,1.2,0.4]); },
    O:(b)=>{ eyeArc(b, GS, -eu, ev, es); eyeArc(b, GS, eu, ev, es); for(let s=-1;s<=1;s+=2) feat(b, GS, s*eu + s*0.02, ev + es*1.1, 0.01, cap(es*0.12, es*0.9, 3, 6), INK, [1,1,0.5], HPI + s*0.45);
      mOpen(b, GS, 0, -0.14, 0.13, 0.11, false); },
    X:(b)=>{ eyeX(b, GS, -eu, ev, es); eyeX(b, GS, eu, ev, es); mWavy(b, GS, 0, -0.14, 0.09); },
    H:(b)=>{ eyeArc(b, GS, -eu, ev, es); eyeArc(b, GS, eu, ev, es); mOpen(b, GS, 0, -0.13, 0.1, 0.07, false); blush(b, GS, -0.34, -0.04, 0.12); blush(b, GS, 0.34, -0.04, 0.12); },
  };
  if(!bro) fills.S = (b)=>{ eyeSqueeze(b, GS, -eu, ev, es); eyeSqueeze(b, GS, eu, ev, es); mO(b, GS, 0, -0.14, 0.04); };
  k.faceSet(k.sheet, 'f', fills);
  k.extras(k.sheet, [0.25, 1.62, 0.55], 0.5, 2.05);
  return k.rig(2.0*k.scale, bro ? 0.55 : 0.72);
}
function poseGhost(k, e, P, T){
  const an = e.anim, len = e.animLen|0, p = len>0 ? clamp(e.animT/len, 0, 1) : ((e.animT|0) % 60)/60;
  const hit = e.animHit || 0.35;
  P.by += 0.05*Math.sin(T*0.08);
  P.lLz = 0; P.lRz = 0;
  switch(an){
    case 'idle': P.aLz = 0.35 + 0.12*Math.sin(T*0.07); P.aRz = 0.3 + 0.1*Math.sin(T*0.07 + 1); P.roll = 0.05*Math.sin(T*0.05); break;
    case 'walk': P.lean = -0.16; P.aLz = 0.5; P.aRz = 0.4; P.by = 0.05*Math.sin(T*0.1); P.twist = 0; break;
    case 'windup': P.aRz = lerp(0.3, -2.3, U.easeOutCubic(p)); P.aLz = 0.9; P.lean = 0.25*p; break;
    case 'attack': { const u = strikeU(p, hit); P.aRz = lerp(-2.3, 1.7, u); P.aLz = lerp(1.0, 0.2, u); P.lean = lerp(0.25, -0.35, u); P.twist = lerp(-0.3, 0.35, u); break; }
    case 'attack2': { P.aRz = 1.55; P.aRx = 0.35; P.aLz = 1.3; P.aLx = 0.5; P.lean = 0.05;
      k.spinA = k.spinA || 0; if(p > 0.08 && p < 0.9) P.spin = (k.spinA || 0) + 0.42; else P.spin = 0; break; }
    case 'special': P.aLz = P.aRz = 1.45 + 0.1*Math.sin(T*0.2); P.aLx = P.aRx = 0.05; P.roll = 0.1*Math.sin(T*0.12); P.lean = -0.05; P.face = 'N'; break;
    case 'shoot': { const u = strikeU(p, hit); P.aLz = P.aRz = lerp(-0.2, 1.5, u); P.lean = lerp(0.2, -0.15, u); P.face = 'O'; break; }
    case 'down': P.rz = e.onGround ? 1.35 : 0.8; P.by = 0.5; P.aLz = P.aRz = 2.4; P.sy = 0.9; break;
    case 'ko': if(e.onGround){ P.by = 0; P.sy = 0.72 + 0.04*Math.sin(T*0.2); P.sx = 1.18; P.lean = 0; P.aLz = P.aRz = 0.9; P.aLx = P.aRx = 1.0; } break;
    case 'getup': P.sy = lerp(0.8, 1, p); break;
  }
  if(an==='attack2' && P.spin){ k.spinA = P.spin; }
}
function applyGhost(k, e, C, T, P){
  // ghost alpha follows e.ghostA while alive (see-through = can't be hit); the framework owns the KO fade
  if(!e.dead && e.ghostA != null){ const a = k.alpha + (e.ghostA - k.alpha)*0.18; k.setAlpha(Math.abs(a - e.ghostA) < 0.01 ? e.ghostA : a); }
  const s = k.scale;
  k.body.position.set(C.bx, C.by, 0);
  k.body.scale.set((C.sx + k.sqx)*s, (C.sy + k.sqy)*s, (C.sx + k.sqx)*s);
  k.body.rotation.set(C.roll + 0.04*Math.sin(T*0.09), 0, C.rz);
  k.sheet.rotation.set(0, C.twist, C.lean);
  k.armL.rotation.set(C.aLx, 0, C.aLz); k.armR.rotation.set(-C.aRx, 0, C.aRz);
}

// ---- ghost moves (shared by the boss and the brothers)
function gFloat(e, hy){ e.gravScale = 0; e.onGround = false; e.vy = ((hy==null ? e.hoverY + Math.sin((G.time.tick + e.id*37)*0.05)*0.18 : hy) - e.y)*0.1; }
const GHOST_M = {
  fade: { id:'ghost_fade', anim:'special', len:84, hits:[], noAlert:true,
    fn(e, t){ const p = fh().target(e);
      if(t===0){ G.setAnim(e, 'special', 84); e.intangible = true; e.ghostA = 0.32; sfx('dodge');
        const side = rng() < 0.5 ? -1 : 1, px = p ? p.x : e.x, pz = p ? p.z : e.z;
        e.dstX = clampX(px + side*(2.2 + rng()*1.4), e.radius); e.dstZ = clampZ(pz + (rng()-0.5)*1.6); }
      e.vx = clamp((e.dstX - e.x)*0.06, -0.12, 0.12); e.vz = clamp((e.dstZ - e.z)*0.06, -0.08, 0.08); gFloat(e);
      if(Math.abs(e.vx) > 0.01) e.face = e.vx > 0 ? 1 : -1;
      if(t===70){ e.ghostA = 1; if(p) fh().face(e, p); }
      if(t===74) e.intangible = false; },
    onEnd(e){ e.intangible = false; e.ghostA = 1; if(e.grp && e.grp.fader===e) e.grp.fader = null; e.cool = Math.max(e.cool, 30); } },
  swoop: { id:'ghost_swoop', anim:'attack', len:64,
    hits:[ H({ at:12, dur:20, x0:-0.4, x1:1.5, zr:0.55, y0:-1.1, y1:1.3, dmg:10, kb:0.14, up:0.1, stun:20, kind:'blunt', power:1 }) ],
    fn(e, t){ const p = fh().target(e);
      if(t===0){ G.setAnim(e, 'attack', 64, 0.2); e.swZ = p ? p.z : e.z; say(e, 'ヒヒッ！'); }
      if(t < 10){ e.vx = -e.face*0.03; gFloat(e, 1.35); }
      else if(t < 34){ const q = (t - 10)/24; e.vx = e.face*0.22; e.vz = clamp((e.swZ - e.z)*0.15, -0.1, 0.1); gFloat(e, 0.3 + 1.0*Math.abs(q - 0.5)*2);
        if(t%4===0) fx('sparkle', e.x, e.y + 0.4, e.z, { count:2, scale:0.5, color:'#dff0ff' }); if(t===12) sfx('swing'); }
      else { e.vx *= 0.88; gFloat(e); } },
    onEnd(e){ ghostAfter(e); } },
  spin: { id:'ghost_spin', anim:'attack2', len:76,
    hits:[ H({ at:10, dur:54, rehit:18, x0:-1.6, x1:1.6, zr:0.8, y0:-1.1, y1:1.4, dmg:8, kb:0.13, stun:18, kind:'wind', power:1 }) ],
    fn(e, t){ const p = fh().target(e);
      if(t===0){ G.setAnim(e, 'attack2', 76, 0.13); say(e, 'くるくる〜！'); }
      gFloat(e, 0.75);
      if(t>=10 && t<64){ e.vx = e.face*0.035; if(p) e.vz = clamp((p.z - e.z)*0.04, -0.03, 0.03); if(t%12===0){ sfx('swing'); fx('dust', e.x, 0.1, e.z, { count:3, scale:0.8 }); } } },
    onEnd(e){ ghostAfter(e); } },
  wisp: { id:'ghost_wisp', anim:'shoot', len:54, hits:[],
    fn(e, t){ gFloat(e);
      if(t===0){ G.setAnim(e, 'shoot', 54, 0.24); say(e, 'ひとだま〜'); }
      if(t===13){ const p = fh().target(e); const dz = p ? p.z - e.z : 0;
        for(let i=-1;i<=1;i++) G.combat.shoot({ owner:e, kind:'shadow', x:e.x + e.face*0.8, y:e.y + 1.0, z:e.z, vx:e.face*0.1, vy:-0.006, vz:dz/70 + i*0.035,
          dmg:10, r:0.42, life:120, power:1, stun:20, kb:0.08, onGround:'slide' });
        sfx('shoot'); } },
    onEnd(e){ ghostAfter(e); } },
};
function ghostAfter(e){ after(e, e.def.boss ? 70 : 90); }
function grpTick(g){
  if(g.tick===G.time.tick) return; g.tick = G.time.tick;
  if(g.gap > 0) g.gap--;
  const c = g.cur;
  if(c && (c.dead || c.removed || (c.state!=='act' && !c.atk && !c.pending))){ g.cur = null; g.gap = g.main && g.main.phase ? 42 : 66; }
  const f = g.fader;
  if(f && (f.dead || f.removed || (f.state!=='act' && !f.atk))) g.fader = null;
}
function grpNext(g){
  const n = g.list.length;
  for(let k=0;k<n;k++){ const x = g.list[(g.i + k) % n]; if(x && !x.dead && !x.removed && (x.state==='idle' || x.state==='move')) return x; }
  return null;
}
function ghostAI(e){
  const h = fh(), t = h.target(e), g = e.grp;
  if(!e.atk) gFloat(e);
  if(e.intangible && !e.atk && !e.pending){ e.intangible = false; e.ghostA = 1; }     // safety
  if(!e.introDone){ e.introDone = true; h.attack(e, e.def.boss ? GHOST_INTRO_BOSS : GHOST_INTRO_BRO, 0); return; }
  if(!t){ h.stop(e); return; }
  if(e.def.boss && phaseCheck(e, 'もう おこったぞ〜！ ひとだまも つかっちゃう！')) return;
  grpTick(g);
  h.face(e, t);
  const dx = t.x - e.x, adx = Math.abs(dx), adz = Math.abs(t.z - e.z);
  const mine = g && !g.cur && g.gap <= 0 && grpNext(g)===e;
  if(mine && e.cool <= 0){
    _mn.length = 0; _mw.length = 0;
    opt('swoop', adx < 5.5 && adx > 1.2 ? 5 : 1.5); opt('spin', adx < 2.6 ? 4 : 0.8); opt('fadeSwoop', 2.5); opt('wisp', e.def.boss && e.phase ? 3 : 0);
    const mv = pick(e);
    let ok = false;
    if(mv==='swoop' && adz < 0.9 && adx < 6){ ok = go(e, GHOST_M.swoop, e.phase ? 20 : 24); }
    else if(mv==='spin' && adx < 3.2 && adz < 1.0){ ok = go(e, GHOST_M.spin, 30); }
    else if(mv==='wisp'){ ok = go(e, GHOST_M.wisp, 30); }
    else if(mv==='fadeSwoop'){ if(h.token(e) && h.attack(e, GHOST_FADE_SWOOP, 0)){ ok = true; } }
    else { approachGhost(e, t, 2.4); }
    if(ok){ e.lastMove = mv; g.cur = e; g.i = (g.list.indexOf(e) + 1) % g.list.length; return; }
    return;
  }
  // not my turn: float around the hero; sometimes one ghost goes see-through and drifts somewhere else
  if(g && !g.fader && g.cur!==e && e.cool <= 0 && rng() < 0.006){ if(h.attack(e, GHOST_M.fade, 0)){ g.fader = e; return; } }
  approachGhost(e, t, 2.6 + (e.slot||0)*0.55);
}
function approachGhost(e, t, dist){
  const sd = e.x < t.x ? -1 : 1;
  let tx = t.x + sd*dist; if(tx < xLo(e.radius) || tx > xHi(e.radius)) tx = t.x - sd*dist;
  tx = clampX(tx, e.radius);
  const zo = e.slot===1 ? 0.55 : e.slot===2 ? -1.1 : -0.35;
  const tz = clampZ(t.z + zo);
  const dxx = tx - e.x, dzz = tz - e.z, spd = (e.def.spd||0.04)*(e.spdMul||1)*((G.game && G.game.diff && G.game.diff.foeSpeed) || 1);
  if(Math.abs(dxx) < 0.3 && Math.abs(dzz) < 0.25){ e.vx *= 0.8; e.vz *= 0.8; if(e.state==='move') G.setState(e, 'idle'); if(e.anim!=='idle') G.setAnim(e, 'idle'); return; }
  const d = Math.hypot(dxx, dzz);
  e.vx = dxx/d*spd; e.vz = dzz/d*spd*0.8;
  if(e.state!=='move') G.setState(e, 'move'); if(e.anim!=='walk') G.setAnim(e, 'walk');
}
// fade + reappear right beside the hero, then a telegraphed swoop (chained, keeps the token)
const GHOST_FADE_SWOOP = { id:'ghost_fadeSwoop', anim:'special', len:62, hits:[], noAlert:true,
  fn(e, t){ const p = fh().target(e);
    if(t===0){ G.setAnim(e, 'special', 62); e.intangible = true; e.ghostA = 0.3; sfx('dodge'); say(e, 'きえ〜る…'); }
    if(p){ const side = e.x < p.x ? -1 : 1; let tx = p.x + side*2.3; if(tx < xLo(e.radius) || tx > xHi(e.radius)) tx = p.x - side*2.3;
      e.vx = clamp((clampX(tx, e.radius) - e.x)*0.08, -0.14, 0.14); e.vz = clamp((p.z - e.z)*0.08, -0.08, 0.08); }
    gFloat(e);
    if(t===50){ e.ghostA = 1; if(p) fh().face(e, p); }
    if(t===54) e.intangible = false; },
  onEnd(e){ e.intangible = false; e.ghostA = 1; chain(e, GHOST_M.swoop, e.phase ? 20 : 24); } };
function ghostIntro(line){
  return { id:'ghost_intro', anim:'special', len:70, hits:[], noAlert:true,
    fn(e, t){ if(t===0){ e.intangible = true; e.ghostA = 0; G.setAnim(e, 'special', 70); }
      if(t===6) e.ghostA = 1;
      gFloat(e, lerp(0.2, e.hoverY, Math.min(1, t/40)));
      if(t===14 && line){ say(e, line); sfx('bossRoar'); }
      if(t===20) fx('sparkle', e.x, e.y + 1.2, e.z, { count:8, color:'#dff0ff' });
      if(t===40){ e.intangible = false; G.setAnim(e, 'roar', 30, 0.3); } },
    onEnd(e){ e.intangible = false; e.ghostA = 1; e.cool = 40 + (e.slot||0)*30; } };
}
const GHOST_INTRO_BOSS = ghostIntro('ヒヒヒ…3にんで あそんであげる〜');
const GHOST_INTRO_BRO = ghostIntro(null);
function ghostInit(e){
  common(e);
  e.floaty = true; e.gravScale = 0; e.hoverY = e.def.boss ? 0.95 : 0.85; e.y = 0.2; e.onGround = false; e.ghostA = 0;
  if(e.rig && e.rig.setAlpha) e.rig.setAlpha(0.01);
  if(!e.grp){ e.grp = { list:[e], i:0, cur:null, gap:60, tick:-1, fader:null, main:e }; e.slot = 0; }
}

// ================================================================ 4) みつくびの ケルベ — chubby purple 3-headed dog
const CRB = { FUR:'#8a6fc0', FUR_D:'#6d55a3', FUR_L:'#e6dcf7', COLLAR:'#2a2233', STUD:'#ffffff', CLAW:'#fff6ff', NOSE:'#2b2238', PINK:'#f5a3c6' };
function buildCerbe(){
  const c = CRB;
  const k = new Kit({ type:'cerbe', gkey:'cerbe', lie:0.55, sit:0.3, pose:poseCerbe, apply:applyCerbe });
  const hipY = 0.44;
  k.legL = k.grp(k.body, [-0.05, hipY, -0.36]); k.legR = k.grp(k.body, [-0.05, hipY, 0.36]);
  const legFill = (b)=>{ b.add(cap(0.18, 0.1), c.FUR, [0,-0.12,0]); b.add(sph(0.22,16,12), c.FUR_L, [0.06,-0.3,0], null, [1.3,0.62,1.1]);
    for(let i=-1;i<=1;i++) b.add(sph(0.05,8,6), c.FUR_D, [0.33,-0.33,i*0.09]); };
  k.part(k.legL, 'leg', legFill); k.part(k.legR, 'leg', legFill);
  k.hips = k.grp(k.body, [0, hipY, 0]);
  k.part(k.hips, 'torso', (b)=>{
    b.add(sph(0.8,24,16), c.FUR, [0,0.5,0], null, [1.0,0.9,1.02]);
    b.add(sph(0.6,20,14), c.FUR_L, [0.3,0.42,0], null, [0.6,0.95,0.9]);
    b.add(tor(0.6, 0.11, 8, 30), c.COLLAR, [0.02,1.02,0], [HPI,0,0]);
    for(let i=0;i<10;i++){ const a = i/10*TAU; b.add(sph(0.065,8,6), c.STUD, [0.02 + Math.cos(a)*0.69, 1.02, Math.sin(a)*0.69]); }
    for(let i=0;i<3;i++){ const z = (i-1)*0.62; b.add(sph(0.26,14,10), c.FUR, [0.05, 1.16 + (i===1?0.12:0), z*0.95]); }
  });
  k.tail = k.grp(k.hips, [-0.72, 0.42, 0]);
  k.part(k.tail, 'tail', (b)=>{ for(let i=0;i<5;i++){ const a = i/4*2.6; b.add(sph(0.15 - i*0.012,12,10), i===4 ? c.FUR_L : c.FUR_D, [-Math.sin(a)*0.22 - 0.05, Math.cos(a)*-0.1 + 0.12 + i*0.08, 0]); } });
  const armFill = (b)=>{ b.add(cap(0.16, 0.16), c.FUR, [0,-0.15,0]); b.add(sph(0.2,16,12), c.FUR_L, [0.03,-0.37,0]);
    for(let i=-1;i<=1;i++) b.add(cone(0.045,0.2,8), c.CLAW, [0.2,-0.44,i*0.08], [0,0,-2.1]); };
  k.armL = k.grp(k.hips, [0.1, 0.82, -0.74]); k.armR = k.grp(k.hips, [0.1, 0.82, 0.74]);
  k.part(k.armL, 'arm', armFill); k.part(k.armR, 'arm', armFill);
  k.tip.position.set(0.33, -0.5, 0); k.armR.add(k.tip); k.base.position.set(0.03, -0.3, 0); k.armR.add(k.base);
  // three heads on a yoke that turns them toward the camera (so all three faces read on screen)
  k.yoke = k.grp(k.hips, [0.05, 1.12, 0]);
  const HS = { c:[0.06,0.3,0], r:[0.46,0.42,0.46] }, MZ = { c:[0.42,0.2,0], r:[0.19,0.14,0.21] };
  const headFill = (ears)=> (b)=>{
    b.add(sph(0.46,22,16), c.FUR, HS.c, null, [1.0,0.92,1.0]);
    b.add(sph(0.19,14,10), c.FUR_L, MZ.c, null, [1.0,0.75,1.1]);
    b.add(sph(0.075,10,8), c.NOSE, [0.6,0.27,0], null, [1,0.8,1.2]); b.add(sph(0.022,6,5), WHITE, [0.64,0.3,0.03]);
    blush(b, HS, -0.3, -0.12, 0.08); blush(b, HS, 0.3, -0.12, 0.08);
    for(let s=-1;s<=1;s+=2){
      if(ears==='up'){ b.add(cone(0.14,0.32,10), c.FUR_D, [-0.02,0.72,s*0.26], [s*0.3,0,0], [0.55,1,1]); b.add(cone(0.08,0.2,8), c.PINK, [0.02,0.7,s*0.26], [s*0.3,0,0], [0.35,1,1]); }
      else if(ears==='flop'){ b.add(sph(0.16,12,10), c.FUR_D, [-0.02,0.48,s*0.46], [s*0.6,0,0.2], [0.5,1.3,0.9]); }
      else { if(s<0){ b.add(cone(0.14,0.32,10), c.FUR_D, [-0.02,0.72,s*0.26], [s*0.3,0,0], [0.55,1,1]); } else { b.add(sph(0.15,12,10), c.FUR_D, [0.0,0.62,s*0.36], [s*0.9,0,0.5], [0.5,1.2,0.9]); } }
    }
  };
  const HP = [[-0.06, 0.34, -0.7], [0.12, 0.5, 0], [-0.06, 0.34, 0.7]];
  const EARS = ['up', 'mixed', 'flop'];
  k.heads = [];
  const ev = 0.07, eu = 0.16, es = 0.09;
  const faceN = [
    (b)=>{ eyeAngry(b, HS, -eu, ev, es, { tilt:0.55 }); eyeAngry(b, HS, eu, ev, es, { tilt:0.55 }); mFrown(b, MZ, 0, -0.1, 0.05); },                                      // grumpy
    (b)=>{ eyeAngry(b, HS, -eu, ev, es, { tilt:0.3, look:0.1 }); eyeAngry(b, HS, eu, ev, es, { tilt:0.3, look:0.1 }); mOpen(b, MZ, 0, -0.1, 0.1, 0.06, true); },           // smug grin
    (b)=>{ eyeAngry(b, HS, -eu, ev, es, { lid:c.FUR, tilt:-0.35, look:0 }); eyeAngry(b, HS, eu, ev, es, { lid:c.FUR, tilt:-0.35, look:0 }); mO(b, MZ, 0, -0.1, 0.032); }, // sleepy / whiny
  ];
  for(let i=0;i<3;i++){
    const hg = k.grp(k.yoke, HP[i]);
    k.part(hg, 'head'+i, headFill(EARS[i]));
    k.faceSet(hg, 'h'+i, {
      N: faceN[i],
      B:(b)=>{ eyeLine(b, HS, -eu, ev, es, i===2 ? -0.2 : 0.25); eyeLine(b, HS, eu, ev, es, i===2 ? -0.2 : 0.25); if(i===1) mOpen(b, MZ, 0, -0.1, 0.1, 0.06, true); else if(i===0) mFrown(b, MZ, 0, -0.1, 0.05); else mO(b, MZ, 0, -0.1, 0.032); },
      X:(b)=>{ eyeX(b, HS, -eu, ev, es); eyeX(b, HS, eu, ev, es); mWavy(b, MZ, 0, -0.1, 0.06); },
      H:(b)=>{ eyeArc(b, HS, -eu, ev, es); eyeArc(b, HS, eu, ev, es); mOpen(b, MZ, 0, -0.1, 0.08, 0.055, false); blush(b, HS, -0.3, -0.1, 0.1); blush(b, HS, 0.3, -0.1, 0.1); },
    });
    k.heads.push(hg);
  }
  k.extras(k.heads[1], [0.2, 0.62, 0.42], 0.55, 0.95);
  k.yoke.rotation.y = -0.46;
  return k.rig(2.8, 1.0);
}
function poseCerbe(k, e, P, T){
  const an = e.anim, len = e.animLen|0, p = len>0 ? clamp(e.animT/len, 0, 1) : ((e.animT|0) % 60)/60;
  // which head is barking / biting (0..2), -1 = none
  let act = -1, amt = 0;
  if(an==='attack'){ act = 2; amt = strikeU(p, e.animHit||0.4); }
  else if(an==='attack2'){ act = 0; amt = strikeU(p, e.animHit||0.4); }
  else if(an==='attack3' || an==='dash'){ act = 1; amt = an==='dash' ? 0.8 : strikeU(p, e.animHit||0.4); }
  else if(an==='shoot'){ act = Math.min(2, Math.floor(p*3.2)); amt = Math.sin(((p*3.2) % 1)*Math.PI); }
  k.act = act; k.amt = amt;
}
function applyCerbe(k, e, C, T, P){
  k.body.position.set(C.bx, C.by, 0); k.body.scale.set(C.sx + k.sqx, C.sy + k.sqy, C.sx + k.sqx); k.body.rotation.set(C.roll, 0, C.rz);
  k.hips.rotation.set(0, C.twist*0.6, C.lean*0.8);
  k.armL.rotation.set(C.aLx, 0, C.aLz); k.armR.rotation.set(-C.aRx, 0, C.aRz);
  k.legL.rotation.z = C.lLz; k.legR.rotation.z = C.lRz;
  k.tail.rotation.set(Math.sin(T*(P.wagSpd||0.1)*2.2)*(0.3 + C.wag*0.6), 0, 0.1*Math.sin(T*0.05));
  const ty = e.face > 0 ? -0.46 : 0.46;
  k.yokeV += (ty - k.yokeV)*0.2; k.yoke.rotation.y = k.yokeV;
  const lying = e.anim==='down' || e.anim==='ko' || e.anim==='dizzy';
  for(let i=0;i<3;i++){
    const hg = k.heads[i], ph = i*2.1;
    const a = k.act===i ? k.amt : 0;
    hg.rotation.set(C.hx + 0.1*Math.sin(T*0.07 + ph*1.3) + (lying ? 0.25*(i-1) : 0), 0, C.hz + 0.08*Math.sin(T*0.09 + ph) - 0.45*a);
    hg.position.y = (i===1 ? 0.5 : 0.34) + 0.04*Math.sin(T*0.1 + ph) + 0.06*a;
    hg.position.x = (i===1 ? 0.12 : -0.06) + 0.22*a;
  }
}
// ---- cerbe moves
const CERBE_M = {
  intro: introRoar(80, 'みっつの あたまから にげられないぞ！', (e, t)=>{ if(t===30 || t===40 || t===50) sfx('pop'); }),
  claw: { id:'cerbe_claw', anim:'attack', len:78,
    move:[{ at:6, vx:0.08 }, { at:28, vx:0.08 }, { at:52, vx:0.12 }],
    hits:[ H({ at:10, dur:4, x0:-0.2, x1:2.1, zr:0.65, dmg:10, kb:0.07, stun:16 }), H({ at:32, dur:4, x0:-0.2, x1:2.1, zr:0.65, dmg:10, kb:0.07, stun:16 }),
           H({ at:58, dur:5, x0:-0.2, x1:2.3, zr:0.7, dmg:13, kb:0.16, up:0.2, stun:22, power:2, kind:'blunt' }) ],
    fn(e, t){ if(t===0) G.setAnim(e, 'attack', 22, 0.45); else if(t===22) G.setAnim(e, 'attack2', 22, 0.45); else if(t===44) G.setAnim(e, 'attack3', 34, 0.42);
      if(t===20 || t===42){ const p = fh().target(e); if(p){ fh().face(e, p); e.vz = clamp((p.z - e.z)*0.1, -0.06, 0.06); } }
      if(t===58) say(e, 'ガブッ！'); },
    onEnd(e){ after(e, 86); } },
  dash: { id:'cerbe_dash', anim:'dash', len:66,
    hits:[ H({ at:5, dur:21, x0:-0.3, x1:1.95, zr:0.6, dmg:15, kb:0.2, up:0.18, stun:22, power:2, kind:'blunt' }) ],
    fn(e, t){ if(t===0){ G.setAnim(e, 'dash', 66, 0.08); sfx('swing'); say(e, 'どすこーい！'); }
      if(t>=4 && t<26){ e.vx = e.face*0.28; if(t%3===0) fx('dust', e.x - e.face*0.8, 0.05, e.z, { count:2, scale:0.9, dir:-e.face }); } },
    onEnd(e){ after(e, 90); } },
  hops: { id:'cerbe_hops', anim:'jump', len:136, hits:[], fn: hopsFn, onEnd(e){ cleanup(e); after(e, 84); } },
  hops2: { id:'cerbe_hops2', anim:'jump', len:124, hits:[], fn: hopsFn, onEnd(e){ cleanup(e); after(e, 70); } },
  bark: { id:'cerbe_bark', anim:'shoot', len:58, hits:[],
    fn(e, t){ if(t===0) G.setAnim(e, 'shoot', 58, 0.18);
      if(t===10 || t===20 || t===30){ const p = fh().target(e), i = (t-10)/10;
        const off = (i-1)*0.65, dz = p ? (p.z + off - e.z) : off;
        G.combat.shoot({ owner:e, kind:'note', x:e.x + e.face*1.0, y:2.1, z:e.z + (i-1)*0.4, vx:e.face*0.15, vy:-0.03, vz:dz/45,
          dmg:10, r:0.45, life:90, power:1, stun:18, kb:0.1 });
        sfx('pop'); G.fx && G.fx.text && G.fx.text('ワン！', e.x + e.face*0.8, 2.9, e.z, 'onoma'); } },
    onEnd(e){ after(e, 72); } },
  summon: { id:'cerbe_summon', anim:'roar', len:70, hits:[],
    fn(e, t){ if(t===0){ G.setAnim(e, 'roar', 70, 0.3); say(e, 'でておいで、こぶんたち！'); }
      if(t===20){ sfx('bossRoar'); shake(2.5, 18); }
      if(t===26){ e.minions = e.minions || [];
        for(let i=0;i<2;i++){
          const x = clampX(e.x + (i ? -2.6 : 2.6), 0.5), z = clampZ(e.z + (i ? 0.9 : -0.9));
          const m = fh().spawnMinion('wanhei', x, z);
          if(m){ m.summoner = e; e.minions.push(m); }
        } } },
    onEnd(e){ after(e, 60); } },
};
function hopsFn(e, t){
  const per = e.phase ? 40 : 44, air = e.phase ? 28 : 32;      // airtime = 2*vy/g
  const k = Math.floor(t/per), tt = t % per;
  const vy = air*0.006;
  if(k < 3 && tt===0){
    const p = fh().target(e);
    const tx = p ? clampX(p.x, 1.0) : e.x, tz = p ? clampZ(p.z) : e.z;
    e.hopVx = clamp((tx - e.x)/air, -0.14, 0.14); e.hopVz = clamp((tz - e.z)/air, -0.07, 0.07);
    if(p) e.face = p.x > e.x ? 1 : -1;
    e.vy = vy; e.onGround = false; e.hopLanded = false;
    e.warnOn = true; e.warnLock = true; e.warnR = 1.35; e.warnX = e.x + e.hopVx*air; e.warnZ = e.z + e.hopVz*air;
    G.setAnim(e, 'jump'); G.bus.emit('jump', { ent:e }); sfx('boing');
    if(k===0) say(e, 'ぴょーん！');
  }
  if(k < 3 && !e.onGround && !e.hopLanded){ e.vx = e.hopVx; e.vz = e.hopVz; }
  if(k < 3 && tt > 3 && e.onGround && !e.hopLanded){
    e.hopLanded = true; e.warnOn = false; e.vx = 0; e.vz = 0;
    G.combat.area({ owner:e, x:e.x, z:e.z, r:1.35, zr:0.85, y0:-0.5, y1:2, dmg:10, kb:0.12, up:0.16, stun:20, power:2, kind:'blunt', dur:3 });
    fx('shock', e.x, 0.02, e.z, { scale:0.9 }); shake(2.5, 12); sfx('land');
    G.setAnim(e, 'land', 10);
  }
}
function cerbeAI(e){
  const h = fh(), t = h.target(e);
  if(!e.introDone){ e.introDone = true; if(t) h.face(e, t); h.attack(e, CERBE_M.intro, 0); return; }
  if(!t){ h.stop(e); return; }
  if(phaseCheck(e, 'おこったぞ！ みっつの こえで ほえてやる！')) return;
  h.face(e, t);
  e.summoned = e.summoned || [false, false];
  const canSummon = !!(G.foes.types.wanhei) && !e.summoned[e.phase|0] && (e.phase || e.hp < e.maxHp*0.8 || e.moves >= 3);
  if(canSummon && e.cool <= 12){ if(h.attack(e, CERBE_M.summon, 30)){ e.summoned[e.phase|0] = true; } return; }
  if(e.cool > 0){ hover(e, t, 3.4, 0.7); return; }
  const dx = t.x - e.x, adx = Math.abs(dx), adz = Math.abs(t.z - e.z), sd = dx > 0 ? -1 : 1;
  if(!e.plan){
    _mn.length = 0; _mw.length = 0;
    opt('claw', adx < 3 ? 5 : 2); opt('dash', adx > 2.5 ? 4 : 1.2); opt('hops', 3); opt('bark', e.phase ? (adx > 2.5 ? 3.5 : 1.5) : 0);
    e.plan = pick(e); e.planT = 0;
  }
  if(++e.planT > 170){ e.plan = null; e.cool = 20; return; }
  switch(e.plan){
    case 'claw': if(adx < 2.2 && adz < 0.45) go(e, CERBE_M.claw, e.phase ? 18 : 22); else approach(e, t.x + sd*1.65, t.z); break;
    case 'dash': if(adx > 2.4 && adx < 7 && adz < 0.3) go(e, CERBE_M.dash, 30); else approach(e, t.x + sd*4.2, t.z); break;
    case 'hops': go(e, e.phase ? CERBE_M.hops2 : CERBE_M.hops, 24); break;
    case 'bark': if(adx > 2.6 && adx < 8 && adz < 1.4) go(e, CERBE_M.bark, 30); else approach(e, t.x + sd*4.6, t.z); break;
    default: e.plan = null;
  }
}

// ================================================================ definitions
function bossKO(e){ const was = e.phase; cleanup(e); e.plan = null; return false; }
G.foes.define('garm', {
  name:'てつづめのガルム', title:'ワンワンていこく だい1のしょう', boss:true,
  hp:420, poise:80, weight:3, radius:0.8, height:2.45, spd:0.05, score:3000, xp:120, entrance:'drop', recover:30,
  build(){ return buildGarm(); },
  init(e){ common(e); },
  ai: garmAI,
  onKO: bossKO,
});
G.foes.define('shark', {
  name:'りくザメ リクザメ', title:'ワンワンていこく だい2のしょう', boss:true,
  hp:520, poise:90, weight:3, radius:0.95, height:2.2, spd:0.045, score:3000, xp:120, entrance:'none', recover:30,
  build(){ return buildShark(); },
  init(e){ common(e); e.burrowed = true; e.intangible = true; e.shadowAlpha = 0.12; },
  ai: sharkAI,
  onKO: bossKO,
});
G.foes.define('ghost', {
  name:'おばけの Tたろう', title:'ワンワンていこく だい3のしょう', boss:true,
  hp:360, poise:70, weight:3, radius:0.72, height:2.0, spd:0.045, score:3000, xp:120, entrance:'none', recover:30,
  build(){ return buildGhost({ bro:false }); },
  init(e){
    ghostInit(e);
    const g = e.grp;
    for(let i=0;i<2;i++){
      nextBro = i;
      const b = G.foes.spawn('ghostbro', e.x - (i ? 1.0 : 2.2), clampZ(e.z + (i ? 1.3 : -1.3)), { entrance:'none', face:e.face });
      if(b){ b.grp = g; b.slot = i + 1; b.brother = e; g.list.push(b); }
    }
  },
  ai: ghostAI,
  onKO(e){
    cleanup(e); e.gravScale = 0.35;
    const g = e.grp;
    if(g){ for(const b of g.list) if(b!==e) giveUp(b, 'にいちゃ〜ん、まいった〜'); g.cur = null; g.fader = null; }
    return false;
  },
});
G.foes.define('ghostbro', {
  name:'おばけの きょうだい', boss:false,
  hp:144, weight:1.5, radius:0.55, height:1.6, spd:0.045, score:500, xp:30, entrance:'none', recover:24,
  build(){ const vi = (nextBro++) % 2; return buildGhost({ bro:true, vi, v:BRO_VAR[vi] }); },
  init(e){ ghostInit(e); },
  ai: ghostAI,
  onKO(e){ cleanup(e); e.gravScale = 0.35; return false; },
});
G.foes.define('cerbe', {
  name:'みつくびの ケルベ', title:'ワンワンていこく だい4のしょう', boss:true,
  hp:640, poise:100, weight:3, radius:1.0, height:2.6, spd:0.042, score:3000, xp:120, entrance:'none', recover:30,
  build(){ return buildCerbe(); },
  init(e){ common(e); e.summoned = [false, false]; e.minions = []; },
  ai: cerbeAI,
  onKO(e){ cleanup(e); if(e.minions){ for(const m of e.minions) giveUp(m, 'ボス〜！ まって〜'); } return false; },
});
G.bossesA = { GEO, buildGarm, buildShark, buildGhost, buildCerbe, giveUp };
})();

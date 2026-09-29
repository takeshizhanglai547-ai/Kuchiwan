// 36_bosses_b.js — ボス後半：キングスライム(5)＋ちびスライム・ひりゅう ヴォルカ(6)・こくけんし クロイヌ(7 なかボス)・
// ダークワンワンたいてい(7) → あんこくナイト（おなじ実体のまま すがたが かわる）。
// 見た目：部品ごとに頂点カラーで1メッシュへ結合（形状はこのモジュールでキャッシュ＝共有。rig.dispose では捨てない）。
// 材質はリグごとに複製（からだ・つや・発光・スライムの殻）して、白フラッシュとフェードに使う。表情は顔メッシュの切り替え
// （N ふつう・B まばたき・O さけぶ・X ×め・S ぎゅっ・H にっこり）。
// 向き：左向きは鏡像（scale.x=-1）で、武器の手がいつもカメラ側。回り込みの途中で正面を通る。
// 地面の予告（まるい警告・ビームの帯）とビームは、ゲーム側が実体の e.marks / e.lane / e.beam に書き、リグが描く。
// 動き：G.foes.h（トークン・予告・攻撃）と G.combat の攻撃定義だけで作る。大技は攻撃定義の fn(e,t) で段取りを進め、
// 途中で倒されても onInterrupt / onKO で必ず元に戻す（空に浮いたまま・すけたまま・警告が出たまま を残さない）。
(function(){ 'use strict';
const G = window.G; const THREE = window.THREE; const U = G.U;
const TAU = Math.PI*2, HPI = Math.PI/2;
const clamp = U.clamp, lerp = U.lerp;

// ================================================================ build helpers (allocation here is fine: build-time only)
const _e = new THREE.Euler(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
const _c1 = new THREE.Color(), _c2 = new THREE.Color(), _c3 = new THREE.Color();
function M(pos, rot, scl, order){
  _e.set(rot?rot[0]:0, rot?rot[1]:0, rot?rot[2]:0, order||'XYZ'); _q.setFromEuler(_e);
  if(scl==null) _s.set(1,1,1); else if(typeof scl==='number') _s.set(scl,scl,scl); else _s.set(scl[0],scl[1],scl[2]);
  return new THREE.Matrix4().compose(_p.set(pos?pos[0]:0, pos?pos[1]:0, pos?pos[2]:0), _q, _s);
}
function Bld(){ this.b = G.look.builder(); }
Bld.prototype.add = function(g, c, pos, rot, scl, order){ this.b.addMatrix(g, c, M(pos, rot, scl, order)); return this; };
// merged part geometries are cached per (type, part) and marked shared → rigs never dispose them
const GEO = new Map();
function cgeo(key, fill, post){
  let g = GEO.get(key);
  if(!g){ const b = new Bld(); fill(b); g = b.b.build(); if(post) post(g); g.userData.shared = true; GEO.set(key, g); }
  return g;
}
function rawGeo(key, make){ let g = GEO.get(key); if(!g){ g = make(); g.userData.shared = true; GEO.set(key, g); } return g; }
let LOD = 1;
const sg = (n, m)=> Math.max(m, Math.round(n*LOD));
const sph  = (r, w, h)=> G.look.geo.sphere(r, Math.min(24, sg(w||16, 6)), Math.min(16, sg(h||12, 4)));
const cap  = (r, l, c, rs)=> G.look.geo.capsule(r, l, sg(c||4, 2), sg(rs||12, 5));
const cyl  = (a, b, h, s)=> G.look.geo.cylinder(a, b, h, sg(s||16, 6));
const cone = (r, h, s)=> G.look.geo.cone(r, h, sg(s||14, 5));
const tor  = (r, t, rs, ts, arc)=> G.look.geo.torus(r, t, sg(rs||8, 4), sg(ts||24, 8), arc==null?TAU:arc);
const rbox = (w, h, d, r)=> G.look.geo.rbox(w, h, d, r==null ? Math.min(w,h,d)*0.3 : r, 2);
const tri  = ()=> rawGeo('tri3', ()=>{ const g = new THREE.ConeGeometry(1, 0.3, 3); g.rotateX(HPI); return g; });
// recolour the vertices that carry `match` by height (soft jelly / belly gradients)
function gradY(g, match, y0, y1, stops){
  const P = g.attributes.position, C = g.attributes.color;
  _c1.set(match); const mr = _c1.r, mg = _c1.g, mb = _c1.b;
  for(let i=0;i<P.count;i++){
    if(Math.abs(C.getX(i)-mr) + Math.abs(C.getY(i)-mg) + Math.abs(C.getZ(i)-mb) > 0.004) continue;
    const t = clamp((P.getY(i)-y0)/(y1-y0), 0, 1);
    let k = 0; while(k < stops.length-2 && t > stops[k+1][0]) k++;
    const a = stops[k], b = stops[k+1], f = clamp((t - a[0])/Math.max(1e-6, b[0]-a[0]), 0, 1);
    _c2.set(a[1]); _c3.set(b[1]); _c2.lerp(_c3, f);
    C.setXYZ(i, _c2.r, _c2.g, _c2.b);
  }
  C.needsUpdate = true;
}

// ---------------------------------------------------------------- features on an ellipsoid surface (face-local u,v)
// S = { c:[x,y,z], r:[rx,ry,rz] }. The front point is +x. ±u = the two sides of the face, v runs up.
function sp(S, u, v, lift){
  const az = -u / S.r[2], el = v / S.r[1], ce = Math.cos(el);
  return [ S.c[0] + (S.r[0]+lift)*ce*Math.cos(az), S.c[1] + (S.r[1]+lift)*Math.sin(el), S.c[2] + (S.r[2]+lift)*ce*Math.sin(az) ];
}
function feat(b, S, u, v, lift, g, col, scl, spin){ b.add(g, col, sp(S,u,v,lift), [ -(v/S.r[1]), HPI + u/S.r[2], spin||0 ], scl, 'YXZ'); }
const INK = '#221a26', MOUTH = '#6b1f33', TONGUE = '#ff8aa6', BLUSH = '#ffb0c2', WHITE = '#ffffff';
// grumpy yellow eye (ダークワンワン帝国 style): iris, pupil, highlight, thick brow
function eyeAngry(b, S, u, v, s, o){
  o = o || {};
  const side = u < 0 ? 1 : -1, L = o.lift || 0;
  feat(b, S, u, v, L - s*0.2, sph(s,14,10), o.white||'#ffd84a', [0.92, 1.0, 0.5]);
  const pu = u + side*s*(o.look==null?0.2:o.look), pv = v - s*0.06;
  feat(b, S, pu, pv, L + s*0.13, sph(s*(o.pupil||0.56),10,8), o.pupilC||INK, [0.85, 1.05, 0.45]);
  feat(b, S, pu - side*s*0.16, pv + s*0.22, L + s*0.24, sph(s*0.18,6,4), WHITE, [1,1,0.5]);
  if(o.brow!==false){
    const tilt = o.tilt==null ? 0.42 : o.tilt;
    feat(b, S, u + side*s*0.12, v + s*(o.browUp||1.22), L + s*0.1, cap(s*(o.browW||0.2), s*1.05, 2, 6), o.browC||'#2e2533', [1,1,0.55], HPI - side*tilt);
  }
}
// chiikawa-ish glossy dot eye (+ optional angry little brow)
function eyeDot(b, S, u, v, s, o){
  o = o || {}; const L = o.lift || 0, side = u < 0 ? 1 : -1;
  feat(b, S, u, v, L - s*0.15, sph(s,14,10), INK, [0.82, 1.0, 0.5]);
  feat(b, S, u + s*0.24, v + s*0.34, L + s*0.36, sph(s*0.32,6,4), WHITE, [1,1,0.5]);
  feat(b, S, u - s*0.22, v - s*0.3, L + s*0.36, sph(s*0.13,6,4), WHITE, [1,1,0.5]);
  if(o.brow) feat(b, S, u + side*s*0.1, v + s*1.35, L + s*0.05, cap(s*0.22, s*0.95, 2, 6), o.brow, [1,1,0.55], HPI - side*(o.tilt==null?0.45:o.tilt));
}
function eyeLine(b, S, u, v, s, tiltSide, L){ const side = u<0?1:-1; feat(b, S, u, v, (L||0) + 0.005, cap(s*0.13, s*1.1, 2, 6), INK, [1,1,0.55], HPI - side*(tiltSide||0)); }
function eyeArc(b, S, u, v, s, down, col, L){ feat(b, S, u, v + (down? -s*0.1 : s*0.1), (L||0) + 0.005, tor(s*0.6, s*0.17, 5, 10, Math.PI), col||INK, [1,1,0.6], down ? Math.PI : 0); }
function eyeX(b, S, u, v, s, col, L){
  feat(b, S, u, v, (L||0) + 0.01, cap(s*0.17, s*1.25, 2, 6), col||INK, [1,1,0.55],  Math.PI/4);
  feat(b, S, u, v, (L||0) + 0.01, cap(s*0.17, s*1.25, 2, 6), col||INK, [1,1,0.55], -Math.PI/4);
}
function eyeSqueeze(b, S, u, v, s, col, L){
  const side = u < 0 ? 1 : -1;
  for(let k=0;k<2;k++){
    const sgn = k ? -1 : 1, a = Math.atan2(-side*0.62, -sgn*0.44);
    feat(b, S, u - side*s*0.26, v + sgn*s*0.22, (L||0) + 0.01, cap(s*0.17, s*0.62, 2, 6), col||INK, [1,1,0.55], a);
  }
}
// ▼ glowing triangle eye (あんこくナイト), slanted toward the middle
function eyeTri(b, S, u, v, s, col, L){ const side = u < 0 ? 1 : -1; feat(b, S, u, v, (L||0) + 0.01, tri(), col, [s, s*0.9, 0.5], -side*0.38); }
function blush(b, S, u, v, s, col, L){ feat(b, S, u, v, (L||0), sph(s,10,6), col||BLUSH, [1.35, 0.62, 0.22]); }
function mFrown(b, S, u, v, w, L){ feat(b, S, u, v, (L||0) + 0.01, tor(w, w*0.22, 5, 10, Math.PI), INK, [1,0.8,0.6], 0); }
function mGrin(b, S, u, v, w, L){ feat(b, S, u, v, (L||0) + 0.01, tor(w, w*0.2, 5, 12, Math.PI), INK, [1,0.9,0.6], Math.PI); }
function mO(b, S, u, v, w, L){ feat(b, S, u, v, (L||0) + 0.01, tor(w, w*0.3, 5, 12), INK, [0.9,1.1,0.6], 0); }
function mOpen(b, S, u, v, w, h, fangs, L){
  L = L || 0;
  feat(b, S, u, v, L - 0.01, sph(w,12,8), MOUTH, [1, h/w, 0.3]);
  feat(b, S, u, v - h*0.42, L + 0.012, sph(w*0.6,8,6), TONGUE, [1, 0.5, 0.3]);
  if(fangs){ for(let k=-1;k<=1;k+=2) feat(b, S, u + k*w*0.58, v + h*0.62, L + 0.015, cone(w*0.16, w*0.4, 6), WHITE, [1,1,0.6], Math.PI); }
}
function mWavy(b, S, u, v, w, L){ for(let k=-1;k<=1;k++) feat(b, S, u + k*w*0.62, v, (L||0) + 0.01, cap(w*0.12, w*0.55, 2, 5), INK, [1,1,0.6], HPI + (k&1 ? 0.6 : -0.6)); }
// ω (cat-like) mouth
function mW(b, S, u, v, w, L){ for(let k=-1;k<=1;k+=2) feat(b, S, u + k*w*0.5, v, (L||0) + 0.01, tor(w*0.5, w*0.13, 5, 10, Math.PI), INK, [1,1,0.6], Math.PI); }
function sweatFill(b){ b.add(sph(0.075,10,8), '#8fd8ff', [0,0,0]); b.add(cone(0.068,0.13,8), '#8fd8ff', [0,0.085,0]); b.add(sph(0.022,5,4), WHITE, [0.02,0.01,0.06]); }
function starsFill(r){ return (b)=>{ for(let i=0;i<3;i++){ const a = i/3*TAU; b.add(G.look.geo.star(0.12, 0.45, 0.054), '#ffe14d', [Math.cos(a)*r, (i===1?0.05:0), Math.sin(a)*r], [0, -a + HPI, 0.3*i]); } }; }

// ================================================================ rig kit
const FACE_KEYS = ['N','B','O','X','S','H'];
// pose targets P and damped values C: one object literal with every channel, damped field by field (a string-keyed
// loop over the channel names made them dictionaries, and every double stored there was a fresh heap number each tick)
function newPose(){ return { face:'N', sweat:0, stars:0, spin:0, wagSpd:0.1, flap:0, bx:0, by:0, sx:1, sy:1, lean:0, twist:0, hx:0, hy:0, hz:0, aLz:0, aRz:0, aLx:0, aRx:0, lLz:0, lRz:0, roll:0, rz:0, wag:0, wf:0, ex:0, tl:0 }; }
function poseDamp(C, P, r){
  C.bx += (P.bx - C.bx)*r; C.by += (P.by - C.by)*r; C.sx += (P.sx - C.sx)*r; C.sy += (P.sy - C.sy)*r;
  C.lean += (P.lean - C.lean)*r; C.twist += (P.twist - C.twist)*r; C.hx += (P.hx - C.hx)*r; C.hy += (P.hy - C.hy)*r;
  C.hz += (P.hz - C.hz)*r; C.aLz += (P.aLz - C.aLz)*r; C.aRz += (P.aRz - C.aRz)*r; C.aLx += (P.aLx - C.aLx)*r;
  C.aRx += (P.aRx - C.aRx)*r; C.lLz += (P.lLz - C.lLz)*r; C.lRz += (P.lRz - C.lRz)*r; C.roll += (P.roll - C.roll)*r;
  C.rz += (P.rz - C.rz)*r; C.wag += (P.wag - C.wag)*r; C.wf += (P.wf - C.wf)*r; C.ex += (P.ex - C.ex)*r;
  C.tl += (P.tl - C.tl)*r;
}
const FAST = { attack:1, attack2:1, attack3:1, shoot:1, dash:1, roar:1, special:1, hurt:1, parry:1,
  atk1:1, atk2:1, atk3:1, atk4:1, specialUp:1, specialDash:1 };
const YAW = 0.61;
const MAXM = 6;

// per-rig materials are recycled, never disposed: three.js deletes a shader program as soon as no material uses it, so a
// disposed boss / little slime / knight form threw its program (and the see-through twin compiled for a fade) away and
// the next one compiled and linked it again. A recycled material keeps its programs.
const MPOOL = new Map();
function takeMat(key, make){
  let list = MPOOL.get(key);
  if(!list){ list = []; MPOOL.set(key, list); }
  if(list.length){ const m = list.pop(); m.userData.pool.free = false; return m; }
  const m = make();
  m.userData.pool = { list, free:false, tr:m.transparent, op:m.opacity, dw:m.depthWrite, ei:m.emissiveIntensity };
  return m;
}
function giveMat(m){
  const s = m && m.userData.pool;
  if(!s){ if(m) m.dispose(); return; }
  if(s.free) return;
  s.free = true;
  if(m.transparent!==s.tr){ m.transparent = s.tr; m.needsUpdate = true; }
  m.opacity = s.op; m.depthWrite = s.dw;
  if(s.ei!==undefined) m.emissiveIntensity = s.ei;
  if(m.userData.uFlash) m.userData.uFlash.value = 0;
  s.list.push(m);
}

function Kit(o){
  this.o = o;
  this.root = new THREE.Group(); this.root.name = 'bossB_'+o.type;
  this.mir = new THREE.Group(); this.root.add(this.mir);          // mirror (scale.x = ±1)
  this.yaw = new THREE.Group(); this.mir.add(this.yaw);           // turn toward the camera
  this.scl = new THREE.Group(); this.yaw.add(this.scl); if(o.scale) this.scl.scale.setScalar(o.scale);
  this.body = new THREE.Group(); this.scl.add(this.body);
  const rough = o.rough==null ? 0.66 : o.rough;
  this.mat = takeMat('body|'+rough, ()=> G.look.vmat({ instance:true, rough }));
  this.gmat = takeMat('gloss', ()=> G.look.vmat({ instance:true, rough:0.26, rim:0.35 }));
  this.mats = [this.mat, this.gmat];          // opaque per-rig materials (flash + fade)
  this.tmats = [];                             // always-transparent per-rig materials { m, base }
  this.bmat = null; this.emat = null;          // glow materials (blade / orb, eyes)
  this.outlines = []; this.meshes = []; this.fsets = [];
  this.P = newPose(); this.C = newPose();
  this.seed = (Math.random()*997)|0; this.ph = 0; this.tw = null; this.alpha = 1;
  this.land = 0; this.wob = 0; this.flinch = 0; this.prevFlash = 0; this.wasGround = true; this.landed = false; this.hitNow = false;
  this.sqx = 0; this.sqy = 0; this.spinA = 0;
  this.mk = []; this.laneM = null; this.beamG = null; this.beamMats = null; this.chargeM = null;
  this.sweat = null; this.stars = null;
  this.tip = new THREE.Object3D(); this.base = new THREE.Object3D();
}
Kit.prototype.grp = function(parent, pos){ const g = new THREE.Group(); if(pos) g.position.set(pos[0], pos[1], pos[2]); parent.add(g); return g; };
Kit.prototype.glow = function(color, inten){
  const m = takeMat('glow|'+color+'|'+inten, ()=> G.look.vmat({ instance:true, rough:0.3, rim:0.8, emissive:color, emissiveIntensity: inten==null ? 0.7 : inten }));
  m.userData.baseEmissive = inten==null ? 0.7 : inten;
  this.mats.push(m); return m;
};
Kit.prototype.part = function(parent, key, fill, o){
  o = o || {};
  const g = cgeo(this.o.gkey + ':' + key, fill, o.post);
  const mat = o.mat==='g' ? this.gmat : o.mat==='b' ? this.bmat : o.mat==='e' ? this.emat : (o.mat || this.mat);
  const m = new THREE.Mesh(g, mat);
  m.name = key;
  m.castShadow = o.shadow!==false; m.receiveShadow = false;
  if(o.outline!==0) this.outlines.push(G.look.outline(m, o.outline || this.o.ol || 0.024, o.oc || this.o.oc || '#3b2417'));
  if(o.pos) m.position.set(o.pos[0], o.pos[1], o.pos[2]);
  parent.add(m); this.meshes.push(m);
  return m;
};
Kit.prototype.faceSet = function(parent, prefix, fills, mat){
  const set = { cur:null, blinkT: 50 + (Math.random()*140|0), blink:0 };
  for(const k of FACE_KEYS){
    if(!fills[k]) continue;
    const m = this.part(parent, prefix+'_f'+k, fills[k], { mat: mat || 'g', outline:0, shadow:false });
    m.visible = false; set[k] = m;
  }
  this.fsets.push(set);
  return set;
};
Kit.prototype.extras = function(parent, sweatPos, starR, starY){
  this.sweat = this.part(parent, 'sweat', sweatFill, { mat:'g', outline:0, shadow:false, pos:sweatPos });
  this.sweat.userData.y0 = sweatPos[1]; this.sweat.visible = false;
  this.stars = this.part(parent, 'stars', starsFill(starR), { mat:'g', outline:0.012, shadow:false, pos:[0, starY, 0] });
  this.stars.visible = false;
};
function showFace(set, name){
  const m = set[name] || (name==='S' && set.X) || (name==='O' && set.N) || set.N;
  if(set.cur !== m){ if(set.cur) set.cur.visible = false; m.visible = true; set.cur = m; }
}
Kit.prototype.setAlpha = function(a){
  a = clamp(a, 0, 1);
  if(Math.abs(a - this.alpha) < 0.002) return;
  const was = this.alpha < 0.999, now = a < 0.999;
  this.alpha = a;
  for(let i=0;i<this.mats.length;i++){
    const m = this.mats[i];
    m.opacity = a;
    // three r160 compiles "opaque" into the program: toggling transparency needs a program switch
    if(was !== now){ m.transparent = now; m.needsUpdate = true; }
    m.depthWrite = a > 0.6;
  }
  for(let i=0;i<this.tmats.length;i++){ const t = this.tmats[i]; t.m.opacity = t.base*a; }
  if(was !== now){ const ov = !now && G.quality.tier < 2; for(let i=0;i<this.outlines.length;i++) this.outlines[i].visible = ov; }
  this.root.visible = a > 0.01;
};

// ---- world-space telegraphs: warning circles, a lane strip, the beam (owned by the rig, drawn from e.marks / e.lane / e.beam)
function warnTex(){
  return G.look.canvasTex('bossB_warn', 128, 128, (x, w, h)=>{
    const c = w/2;
    const g = x.createRadialGradient(c, c, 4, c, c, c);
    g.addColorStop(0, 'rgba(255,255,255,0.10)'); g.addColorStop(0.68, 'rgba(255,255,255,0.30)'); g.addColorStop(0.86, 'rgba(255,255,255,0.95)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.beginPath(); x.arc(c, c, c-1, 0, TAU); x.fill();
    x.lineWidth = 7; x.strokeStyle = '#ffffff'; x.beginPath(); x.arc(c, c, c*0.78, 0, TAU); x.stroke();
    x.lineWidth = 5; x.setLineDash([10, 8]); x.beginPath(); x.arc(c, c, c*0.5, 0, TAU); x.stroke(); x.setLineDash([]);
    // "!" drawn tall: the ground is seen at a grazing angle, so it reads upright on screen
    x.save(); x.translate(c, c); x.scale(1, 2.2);
    x.fillStyle = '#ffffff'; x.strokeStyle = 'rgba(120,20,10,0.9)'; x.lineWidth = 3;
    x.beginPath(); x.moveTo(-7, -24); x.lineTo(7, -24); x.lineTo(4, 5); x.lineTo(-4, 5); x.closePath(); x.fill(); x.stroke();
    x.beginPath(); x.arc(0, 14, 6, 0, TAU); x.fill(); x.stroke();
    x.restore();
  });
}
function laneTex(){
  const t = G.look.canvasTex('bossB_lane2', 128, 64, (x, w, h)=>{
    x.fillStyle = 'rgba(255,255,255,0.42)'; x.fillRect(0, 0, w, h);
    x.fillStyle = 'rgba(255,255,255,1)'; x.fillRect(0, 0, w, 7); x.fillRect(0, h-7, w, 7);
    x.fillStyle = 'rgba(40,10,10,0.55)'; x.fillRect(0, 7, w, 3); x.fillRect(0, h-10, w, 3);
    for(let i=0;i<2;i++){ const ox = i*64 + 12;
      x.fillStyle = 'rgba(40,10,10,0.6)'; x.beginPath(); x.moveTo(ox+3, 15); x.lineTo(ox+26, 32); x.lineTo(ox+3, 49); x.lineTo(ox+17, 49); x.lineTo(ox+40, 32); x.lineTo(ox+17, 15); x.closePath(); x.fill();
      x.fillStyle = 'rgba(255,255,255,1)'; x.beginPath(); x.moveTo(ox, 16); x.lineTo(ox+22, 32); x.lineTo(ox, 48); x.lineTo(ox+12, 48); x.lineTo(ox+34, 32); x.lineTo(ox+12, 16); x.closePath(); x.fill(); }
  });
  if(t.wrapS !== THREE.RepeatWrapping){ t.wrapS = THREE.RepeatWrapping; t.needsUpdate = true; }
  return t;
}
Kit.prototype.makeMark = function(i){
  const mat = takeMat('mark', ()=> new THREE.MeshBasicMaterial({ map:warnTex(), transparent:true, depthWrite:false, opacity:0.9, color:0xffc45a, toneMapped:false }));
  const m = new THREE.Mesh(G.look.geo.plane(1, 1), mat);
  m.rotation.x = -HPI; m.renderOrder = 3; m.visible = false; m.castShadow = false; m.name = 'bossB_mark';
  G.scene.add(m); this.mk[i] = m;
  return m;
};
Kit.prototype.makeLane = function(){
  const mat = takeMat('lane', ()=> new THREE.MeshBasicMaterial({ map:laneTex(), transparent:true, depthWrite:false, opacity:0.8, color:0xffc45a, toneMapped:false, side:THREE.DoubleSide }));
  const m = new THREE.Mesh(G.look.geo.plane(1, 1), mat);
  m.rotation.x = -HPI; m.renderOrder = 3; m.visible = false; m.castShadow = false; m.name = 'bossB_lane';
  G.scene.add(m); this.laneM = m;
};
Kit.prototype.makeBeam = function(){
  const col = this.o.beamCol || '#b060ff';
  const add = (c, o)=> takeMat('beam|'+c+'|'+o, ()=> new THREE.MeshBasicMaterial({ color:c, transparent:true, opacity:o, blending:THREE.AdditiveBlending, depthWrite:false, toneMapped:false }));
  const mo = add(col, 0.55), mi = add(this.o.beamCore || '#fff0ff', 0.95), mc = add(col, 0.7);
  const g = new THREE.Group(); g.name = 'bossB_beam';
  const cg = G.look.geo.cylinder(1, 1, 1, 18, false);
  const outer = new THREE.Mesh(cg, mo); outer.rotation.z = HPI; outer.renderOrder = 4; g.add(outer);
  const inner = new THREE.Mesh(cg, mi); inner.rotation.z = HPI; inner.scale.set(0.42, 1.001, 0.42); inner.renderOrder = 5; g.add(inner);
  g.visible = false; G.scene.add(g);
  const ball = new THREE.Mesh(G.look.geo.sphere(1, 16, 12), mc); ball.renderOrder = 5; ball.visible = false; G.scene.add(ball);
  this.beamG = g; this.chargeM = ball; this.beamMats = [mo, mi, mc];
};
Kit.prototype.updWorld = function(e, T){
  const live = !!(e && !e.dead);
  const ms = live ? e.marks : null;
  for(let i=0;i<MAXM;i++){
    const m = ms ? ms[i] : null, on = !!(m && m.on);
    let mesh = this.mk[i];
    if(!on){ if(mesh) mesh.visible = false; continue; }
    if(!mesh) mesh = this.makeMark(i);
    m.age = (m.age|0) + 1;
    const pul = m.lock ? 0.5 + 0.5*Math.sin(T*0.9) : 0.5 + 0.5*Math.sin(T*0.25);
    const s = m.r*2*(0.55 + 0.45*U.easeOutBack(Math.min(1, m.age/9)))*(1 + 0.06*pul);
    mesh.visible = true; mesh.position.set(m.x, 0.04 + i*0.004, m.z); mesh.scale.set(s, s, 1);
    mesh.material.opacity = 0.5 + 0.45*pul; mesh.material.color.setHex(m.lock ? 0xff4a3a : 0xffc45a);
  }
  const L = live ? e.lane : null;
  if(L && L.on){
    if(!this.laneM) this.makeLane();
    const m = this.laneM, len = Math.max(0.05, Math.abs(L.x1 - L.x0)), dir = L.x1 < L.x0 ? -1 : 1;
    L.age = (L.age|0) + 1;
    const grow = U.easeOutCubic(Math.min(1, L.age/12)), pul = L.lock ? 0.5 + 0.5*Math.sin(T*0.9) : 0.5 + 0.5*Math.sin(T*0.25);
    const l2 = len*grow;
    m.visible = true; m.position.set(L.x0 + dir*l2/2, 0.05, L.z); m.scale.set(l2*dir, L.w, 1);
    m.material.map.repeat.set(Math.max(1, len/1.6), 1); m.material.map.offset.x = -(T % 60)/60*(L.lock ? 2 : 1);
    m.material.opacity = 0.62 + 0.36*pul; m.material.color.setHex(L.lock ? 0xff3a22 : 0xffe040);
  } else if(this.laneM) this.laneM.visible = false;
  const B = live ? e.beam : null;
  if(B && (B.on || B.charge > 0)){
    if(!this.beamG) this.makeBeam();
    const ball = this.chargeM;
    ball.visible = true;
    const cs = B.on ? 0.55 + 0.08*Math.sin(T*1.7) : 0.12 + 0.5*B.charge + 0.05*Math.sin(T*0.9);
    ball.position.set(B.x0, B.y, B.z + 0.05); ball.scale.setScalar(cs);
    if(B.on){
      const g = this.beamG, len = Math.max(0.1, Math.abs(B.x1 - B.x0));
      const k = Math.min(1, (B.t+1)/3)*(B.t > B.len - 4 ? Math.max(0.1, (B.len - B.t)/4) : 1);
      const r = (0.42 + 0.06*Math.sin(T*1.9))*k;
      g.visible = true; g.position.set((B.x0 + B.x1)/2, B.y, B.z); g.scale.set(len, r, r);
    } else this.beamG.visible = false;
  } else if(this.beamG){ this.beamG.visible = false; this.chargeM.visible = false; }
};
Kit.prototype.update = function(e){
  const P = this.P, C = this.C, T = G.time.tick + this.seed;
  const fl = e.flashT|0;
  if(e.introLine) introLine(e);
  this.hitNow = fl > this.prevFlash;
  if(this.hitNow){ this.wob = 1; this.flinch = 9; }
  this.prevFlash = fl;
  const fv = fl > 0 ? 0.62 : 0;
  for(let i=0;i<this.mats.length;i++) this.mats[i].userData.uFlash.value = fv;
  for(let i=0;i<this.tmats.length;i++) this.tmats[i].m.userData.uFlash.value = fv*0.6;
  this.landed = !!e.onGround && !this.wasGround;
  if(this.landed) this.land = 1;
  this.wasGround = !!e.onGround;
  basePose(this, e, P, T);
  if(this.o.pose) this.o.pose(this, e, P, T);
  const r = FAST[e.anim] ? 0.42 : 0.24;
  poseDamp(C, P, r);
  const lw = this.land, ww = this.wob*Math.sin(T*1.3);
  this.sqy = -0.2*lw - 0.07*ww; this.sqx = 0.12*lw + 0.06*ww;
  this.o.apply(this, e, C, T, P);
  this.land *= 0.8; this.wob *= 0.86; if(this.flinch>0) this.flinch--;
  // facing: toward ent.face, ~35° toward the camera; turns through "facing the camera" and mirrors there
  const face = (e.face||1) >= 0 ? 1 : -1;
  if(this.tw==null) this.tw = face; else this.tw = U.approach(this.tw, face, 0.2);
  const aw = Math.abs(this.tw);
  this.mir.scale.x = this.tw >= 0 ? 1 : -1;
  if(P.spin){ this.spinA = P.spin; }
  else if(this.spinA){ const tgt = Math.round(this.spinA/TAU)*TAU; this.spinA += (tgt - this.spinA)*0.25; if(Math.abs(tgt - this.spinA) < 0.01) this.spinA = 0; }
  this.yaw.rotation.y = -(YAW + (1-aw)*(HPI - YAW)) + this.spinA;
  // expression
  let face_ = P.face;
  if(this.flinch>0 && (face_==='N' || face_==='O' || face_==='B')) face_ = 'S';
  for(let i=0;i<this.fsets.length;i++){
    const set = this.fsets[i];
    let nm = face_;
    if(face_==='N'){ if(--set.blinkT <= 0){ set.blink = 7; set.blinkT = 110 + (Math.random()*170|0); } }
    if(set.blink > 0){ set.blink--; if(face_==='N' || face_==='O') nm = 'B'; }
    showFace(set, nm);
  }
  const sw = P.sweat || face_==='S' || face_==='X';
  if(this.sweat){ this.sweat.visible = !!sw; if(sw){ const q = (T % 50)/50; this.sweat.position.y = this.sweat.userData.y0 - q*0.12; this.sweat.scale.setScalar(0.85 + 0.25*Math.sin(q*Math.PI)); } }
  if(this.stars){ this.stars.visible = !!P.stars; if(P.stars) this.stars.rotation.y = T*0.13; }
  this.updWorld(e, T);
};
Kit.prototype.dispose = function(){
  for(let i=0;i<this.mats.length;i++) giveMat(this.mats[i]);
  for(let i=0;i<this.tmats.length;i++) giveMat(this.tmats[i].m);
  this.mats.length = 0; this.tmats.length = 0;
  for(let i=0;i<this.mk.length;i++){ const m = this.mk[i]; if(m){ if(m.parent) m.parent.remove(m); giveMat(m.material); } }
  this.mk.length = 0;
  if(this.laneM){ if(this.laneM.parent) this.laneM.parent.remove(this.laneM); giveMat(this.laneM.material); this.laneM = null; }
  if(this.beamG){ if(this.beamG.parent) this.beamG.parent.remove(this.beamG); if(this.chargeM.parent) this.chargeM.parent.remove(this.chargeM);
    for(const m of this.beamMats) giveMat(m); this.beamG = null; this.chargeM = null; }
};
Kit.prototype.rig = function(height, radius){
  const k = this;
  this.tip.name = 'tip'; this.base.name = 'base';
  return {
    root: k.root, height, radius, tip: k.tip, base: k.base, kit: k,
    meshCount: k.meshes.length,
    update(e){ k.update(e); },
    setAlpha(a){ k.setAlpha(a); },
    dispose(){ k.dispose(); },
  };
};

// ---------------------------------------------------------------- generic procedural animation (targets; the kit damps them)
function strikeU(p, hit){
  const a0 = hit*0.55;
  if(p < a0) return 0.2*(1 - p/a0);                           // u: 0 = wound back … 1 = struck
  if(p < hit){ const q = (p - a0)/Math.max(0.001, hit - a0); return q*q; }
  const q = (p - hit)/Math.max(0.001, 1 - hit);
  return 1 - 0.55*U.easeInOutSine(Math.min(1, q*1.25));
}
function animP(e){ const len = e.animLen|0; return len > 0 ? clamp((e.animT|0)/len, 0, 1) : ((e.animT|0) % 60)/60; }
function basePose(k, e, P, T){
  const an = e.anim, p = animP(e), hit = e.animHit || 0.35;
  const br = Math.sin(T*0.07);
  P.bx = 0; P.by = 0; P.sx = 1; P.sy = 1; P.lean = -0.04; P.twist = 0;
  P.hx = 0; P.hy = 0; P.hz = 0.03*Math.sin(T*0.045);
  P.aLz = 0.22; P.aRz = 0.22; P.aLx = 0.16; P.aRx = 0.16; P.lLz = 0; P.lRz = 0; P.roll = 0; P.rz = 0;
  P.wag = 0.25; P.wagSpd = 0.1; P.wf = 0; P.ex = 0; P.tl = 0; P.flap = 0;
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
      P.aRz = 0.2 - 1.5*q; P.aLz = 0.2 + 0.9*q; P.aRx = 0.3 + 0.35*q; P.aLx = 0.3 + 0.3*q; P.hz = 0.12*q; P.lLz = 0.25*q; P.lRz = -0.2*q;
      P.face = 'O'; P.wag = 0.7; P.wagSpd = 0.4; break; }
    case 'attack': case 'attack2': case 'attack3': {
      const u = strikeU(p, hit), bump = U.bump(p, hit*0.7, Math.min(1, hit + 0.25));
      P.lean = lerp(0.24, -0.3, u); P.sy = 1 + 0.07*bump; P.sx = 1 - 0.03*bump; P.lLz = 0.35*u; P.lRz = -0.25*u; P.hz = lerp(0.1, -0.12, u);
      if(an==='attack'){ P.aRz = lerp(-1.3, 1.75, u); P.aLz = lerp(0.5, -0.35, u); P.twist = lerp(-0.22, 0.2, u); P.aRx = lerp(0.55, 0.4, u); }
      else if(an==='attack2'){ P.aLz = lerp(-1.3, 1.75, u); P.aRz = lerp(0.5, -0.35, u); P.twist = lerp(0.22, -0.22, u); P.aLx = lerp(0.55, 0.4, u); }
      else { P.aLz = P.aRz = lerp(2.7, 0.8, u); P.aLx = P.aRx = lerp(0.5, 0.15, u); P.lean = lerp(0.35, -0.45, u); P.by = 0.14*U.bump(p, 0, hit); }
      P.hy = -P.twist*0.9;
      P.face = 'O'; P.wag = 0.6; P.wagSpd = 0.35; break; }
    case 'dash': {
      if(p < 0.5){ k.ph += 0.55; const s = Math.sin(k.ph);
        P.lean = -0.42; P.sy = 0.93; P.sx = 1.06; P.aLz = P.aRz = 1.25; P.aLx = P.aRx = 0.22; P.lLz = s*0.85; P.lRz = -s*0.85; P.by = Math.abs(Math.cos(k.ph))*0.08; P.face = 'O'; }
      else { P.lean = -0.18; P.lLz = 0.6; P.lRz = 0.25; P.aLz = P.aRz = -0.2; P.sy = 0.96; }
      P.wag = 0.8; P.wagSpd = 0.4; break; }
    case 'shoot': {
      const u = strikeU(p, hit);
      P.lean = lerp(0.25, -0.22, u); P.hz = lerp(0.22, -0.1, u); P.aLz = P.aRz = lerp(-0.4, 1.3, u); P.aLx = P.aRx = 0.3;
      P.sy = 1 + 0.06*U.bump(p, hit*0.7, hit+0.2); P.face = 'O'; break; }
    case 'hurt': {
      const j = Math.sin(T*1.25)*0.05;
      P.lean = 0.3 + j; P.hz = 0.25; P.aLz = P.aRz = -0.5; P.aLx = P.aRx = 0.6; P.sy = 0.93; P.bx = -0.05;
      P.face = 'S'; P.sweat = 1; break; }
    case 'down':
      P.rz = e.onGround ? 1.32 : 0.9 + 0.2*Math.sin(T*0.3); P.by = lie; P.aLz = P.aRz = 2.3 + 0.15*Math.sin(T*0.2); P.aLx = P.aRx = 0.5;
      P.lLz = 0.9; P.lRz = 0.6; P.hz = 0.2 + 0.08*Math.sin(T*0.1); P.face = 'X'; P.sweat = 1; P.stars = 1; P.wag = 0.05; break;
    case 'getup': {
      const up = U.easeOutCubic(Math.min(1, p*1.35));
      P.rz = 1.32*(1 - up); P.by = lie*(1 - up) + 0.14*U.bump(p, 0.55, 1); P.aLz = P.aRz = lerp(2.0, 0.2, up); P.lLz = lerp(0.9, 0, up); P.lRz = lerp(0.6, 0, up);
      P.face = p < 0.6 ? 'S' : 'N'; P.sweat = p < 0.6 ? 1 : 0; break; }
    case 'dizzy': case 'tired':
      P.roll = 0.14*Math.sin(T*0.13); P.lean = 0.1*Math.cos(T*0.13); P.hx = 0.2*Math.sin(T*0.13 + 1); P.hz = 0.14*Math.cos(T*0.13);
      P.aLz = -0.15 + 0.4*Math.sin(T*0.2); P.aRz = -0.15 + 0.4*Math.sin(T*0.2 + 2); P.sy = 0.96;
      P.face = an==='tired' ? 'S' : 'X'; P.stars = 1; P.sweat = 1; break;
    case 'ko':
      if(!e.onGround){ P.rz = 0.5 + 0.25*Math.sin(T*0.35); P.aLz = P.aRz = 2.2; P.aLx = P.aRx = 1.0; P.lLz = 0.8; P.lRz = 0.3; P.face = 'X'; }
      else { P.by = -sit; P.lLz = P.lRz = 1.45; P.lean = 0.35 + 0.05*Math.sin(T*0.1); P.aLz = P.aRz = -0.3; P.aLx = P.aRx = 0.4;
        P.hx = 0.2*Math.sin(T*0.1); P.hz = 0.16 + 0.08*Math.cos(T*0.1); P.roll = 0.06*Math.sin(T*0.1); P.face = 'X'; P.stars = 1; P.sweat = 1; }
      P.wag = 0.05; break;
    case 'cheer': {
      const ph = T*0.2, run = Math.abs(e.vx||0) > 0.02;
      P.by = Math.abs(Math.sin(ph))*0.3; P.sy = 1 + 0.07*Math.sin(ph*2); P.sx = 1 - 0.035*Math.sin(ph*2);
      P.aLz = 2.5 + 0.35*Math.sin(T*0.45); P.aRz = 2.5 + 0.35*Math.sin(T*0.45 + 1.4); P.aLx = P.aRx = 0.45;
      P.hx = 0.14*Math.sin(ph); P.hz = 0.12; P.lean = run ? -0.08 : 0.05;
      if(run){ k.ph += 0.35; P.lLz = Math.sin(k.ph)*0.7; P.lRz = -Math.sin(k.ph)*0.7; }
      P.face = 'H'; P.wag = 0.95; P.wagSpd = 0.55; break; }
    case 'fall':
      P.sy = 1.1; P.sx = 0.94; P.aLz = P.aRz = 2.7; P.aLx = P.aRx = 0.35; P.lLz = 0.35; P.lRz = -0.25; P.hz = 0.15; P.face = 'O'; P.wag = 0.8; P.wagSpd = 0.4; break;
    case 'jump':
      if((e.vy||0) > 0.02){ P.sy = 1.1; P.sx = 0.95; P.aLz = P.aRz = 2.0; P.lLz = 0.8; P.lRz = 0.4; }
      else { P.sy = 1.04; P.aLz = P.aRz = 2.4; P.aLx = P.aRx = 0.3; P.lLz = 0.4; P.lRz = -0.2; }
      P.face = 'O'; P.wag = 0.7; P.wagSpd = 0.35; break;
    case 'roar': {
      const a = 0.22;
      if(p < a){ const q = p/a; P.lean = 0.28*q; P.hz = -0.12*q; P.aLz = P.aRz = -0.6*q; P.sy = 1 - 0.08*q; }
      else { const q = Math.min(1, (p - a)/0.12), rel = U.smooth(p, 0.82, 1);
        P.lean = lerp(0.28, -0.1, q)*(1 - rel); P.hz = 0.42*q*(1 - rel); P.aLz = P.aRz = lerp(-0.6, 0.95, q)*(1 - rel) + 0.2*rel; P.aLx = P.aRx = (0.3 + 0.8*q)*(1 - rel) + 0.16*rel;
        P.sy = 1 + 0.06*q*(1 - rel); P.bx = Math.sin(T*2.3)*0.03*(1 - rel)*q; }
      P.face = 'O'; P.wag = 0.8; P.wagSpd = 0.4; break; }
    case 'special':
      P.sy = 0.92; P.lean = -0.2; P.aLz = P.aRz = 1.4; P.face = 'O'; break;
    default:
      P.sy = 1 + 0.024*br; break;
  }
}
// shared limb application (biped models)
function applyBiped(k, e, C){
  k.body.position.set(C.bx, C.by, 0); k.body.scale.set(C.sx + k.sqx, C.sy + k.sqy, C.sx + k.sqx); k.body.rotation.set(C.roll, 0, C.rz);
  k.hips.rotation.set(0, C.twist, C.lean);
  k.head.rotation.set(C.hx, C.hy - (k.o.headTurn==null ? 0.3 : k.o.headTurn), C.hz);
  k.armL.rotation.set(C.aLx, 0, C.aLz); k.armR.rotation.set(-C.aRx, 0, C.aRz);
  if(k.legL){ k.legL.rotation.z = C.lLz; k.legR.rotation.z = C.lRz; }
}
function capeFlutter(k, e, C, T, base){
  if(!k.cape) return;
  const spd = Math.min(1, Math.abs(e.vx||0)*7 + Math.abs(e.vy||0)*3);
  k.cape.rotation.set(0.06*Math.sin(T*0.11), 0, (base||0.06) + 0.05*Math.sin(T*0.13) + spd*0.45 - C.lean*0.4);
}

// ================================================================ gameplay helpers
const _v = new THREE.Vector3();
function fh(){ return G.foes.h; }
function dk(){ return (G.game && G.game.diff) || { think:1, foeSpeed:1, attackers:2 }; }
function rng(){ return G.rng(); }
function sfx(name, o){ if(G.audio && G.audio.sfx) try { G.audio.sfx(name, o); } catch(err){ G.logError('bossB sfx', err); } }
const NOOPT = {};
function fx(kind, x, y, z, o){ if(G.fx && G.fx.burst) G.fx.burst(kind, x, y, z, o || NOOPT); }
function say(e, s){ fh().say(e, s); }
function sayLow(e, s){ if(G.fx && G.fx.text) G.fx.text(s, e.x + e.face*0.6, e.y + 1.3, e.z + 0.5, 'onoma'); else say(e, s); }
// An intro line never shares the screen with the boss-name banner. bossIntro shows the name for 140 frames
// (90_game: banner(name, title, 140)) right where a line above the boss's head lands, and the two texts ran through each
// other. The line waits until the banner has gone, so a kid reads the name first and then the boss's own catch-phrase.
const BANNER_T = 142;
G.bus.on('bossIntro', (d)=>{ const b = d && d.boss; if(b && b.def && b.def.bossB) b.bannerEnd = G.time.tick + BANNER_T; });
function sayIntro(e, line){ e.introLine = line; introLine(e); }
function introLine(e){                     // also called every tick from the rig update (it runs in every state)
  if(e.dead){ e.introLine = null; return; }
  if(e.bannerEnd!=null && G.time.tick < e.bannerEnd) return;
  say(e, e.introLine); e.introLine = null;
}
function shake(p, f){ if(G.cam && G.cam.shake) G.cam.shake(p, f); }
// preallocated fx option objects (repeated calls must not allocate)
const O = {
  dust8:{ count:8, scale:1.2 }, dust12:{ count:12, scale:1.5 }, dustS:{ count:3, scale:0.7 }, trail:{ count:2, scale:0.7, dir:1 },
  shock1:{ scale:1.2 }, shockG:{ scale:1.1, color:'#b8ff90' }, shockG2:{ scale:2.0, color:'#c8ffa0' }, ringG:{ scale:1.3, color:'#b6ff8c', flat:true },
  shockR:{ scale:0.8, color:'#ff7a6a' }, shockP:{ scale:2.2, color:'#e0b0ff' }, shockF:{ scale:1.4, color:'#ffb070' },
  magic:{ count:4, scale:0.6, color:'#d8a0ff' }, magicR:{ count:4, scale:0.6, color:'#ff8a8a' }, spark:{ count:3, scale:0.5, color:'#e8c8ff' },
  smoke:{ count:4, scale:1.3 }, smokeBig:{ count:14, scale:2.2 }, purify:{ scale:1.6 }, poofG:{ count:6, scale:0.8, color:'#d8ffc8' },
  flame:{ count:5, scale:1.0 }, flameS:{ count:3, scale:0.7 }, rage:{ scale:1.4, color:'#ffd0f0' }, rageR:{ scale:2, color:'#ff9ad0' },
  slashP:{ dir:1, scale:1.8, color:'#d8a8ff' }, slashR:{ dir:1, scale:1.4, color:'#ff7070' }, hearts:{ count:4 },
};
// horizontal limits the boss should stay within: the visible belt (boss arenas are camera-locked in stages)
function xLo(r){ return G.cam.x - G.cam.halfW + (r||0.8) + 0.4; }
function xHi(r){ return G.cam.x + G.cam.halfW - (r||0.8) - 0.4; }
function clampX(x, r){ const a = xLo(r), b = xHi(r); return a < b ? clamp(x, a, b) : (a+b)/2; }
function clampZ(z){ return clamp(z, G.cfg.ZMIN + 0.25, G.cfg.ZMAX - 0.25); }
function H(o){ return Object.assign({ at:5, dur:4, x0:-0.2, x1:1.9, zr:0.6, y0:0, y1:2.2, dmg:10, kb:0.1, up:0, stun:18, kind:'slash', power:1 }, o); }
const SFX_FLAP = { vol:0.4, pitch:0.7 }, SFX_FIRE = { pitch:0.7 };
const LOG = [];
function log(s){ LOG.push(G.time.sceneTick + ':' + s); if(LOG.length > 300) LOG.shift(); }
// start a follow-up from inside an attack's onEnd (h.attack refuses while the state is 'act')
function chain(e, def, windup, alert){
  const w = Math.max(1, Math.round(windup * (dk().think || 1)));
  e.pending = { def, t:w };
  G.setAnim(e, def.windupAnim || 'windup', w);
  if(alert && G.fx && G.fx.alert) G.fx.alert(e);
}
function after(e, base){ e.cool = Math.round(base * (e.phase ? 0.7 : 1) * (0.85 + rng()*0.3)); e.plan = null; }
// ground telegraphs (pools on the entity; the rig draws them)
function telegraphInit(e){
  e.marks = []; for(let i=0;i<MAXM;i++) e.marks.push({ on:false, x:0, z:0, r:1, lock:false, age:0, gen:0, at:0 });
  e.lane = { on:false, x0:0, x1:0, z:0, w:1, lock:false, age:0 };
  e.beam = { on:false, charge:0, x0:0, x1:0, y:0.8, z:0, t:0, len:18, dir:1 };
}
function markOn(e, x, z, r, lock){
  if(!e.marks) return null;
  for(let i=0;i<e.marks.length;i++){ const m = e.marks[i]; if(!m.on){ m.on = true; m.x = x; m.z = z; m.r = r; m.lock = !!lock; m.age = 0; m.gen++; m.at = 0; return m; } }
  return null;
}
function laneOn(e, x0, x1, z, w){ const L = e.lane; if(!L) return; L.on = true; L.x0 = x0; L.x1 = x1; L.z = z; L.w = w || 1.1; L.lock = false; L.age = 0; }
function marksOff(e){
  if(e.marks) for(let i=0;i<e.marks.length;i++) e.marks[i].on = false;
  if(e.lane) e.lane.on = false;
  if(e.beam){ e.beam.on = false; e.beam.charge = 0; }
}
// every custom state a move can leave behind is reset here (interrupt / KO / move end)
function cleanup(e){
  e.intangible = false; e.gravScale = 1; e.shadowAlpha = null;
  e.hopAir = false; e.hopMark = null; e.slamMark = null; e.diveMark = null;
  marksOff(e);
  if(e.rig && e.rig.setAlpha && !e.dead) e.rig.setAlpha(1);
}
function onInterruptFor(e){ return ()=>{ cleanup(e); e.plan = null; e.kseq = null; e.parryT = 0; e.counterDue = false; e.cool = Math.max(e.cool||0, 36); }; }
// outside any move nothing may stay floating / see-through / telegraphed
function safety(e){
  if(e.atk || e.pending) return;
  if(e.intangible) e.intangible = false;
  if(e.gravScale !== 1) e.gravScale = 1;
  if(e.marks) for(let i=0;i<e.marks.length;i++) if(e.marks[i].on && !e.marks[i].proj) e.marks[i].on = false;
  if(e.lane && e.lane.on) e.lane.on = false;
  if(e.beam && (e.beam.on || e.beam.charge)){ e.beam.on = false; e.beam.charge = 0; }
}
// KO without damage numbers (summoned helpers give up when their boss is purified)
function giveUp(b, line){
  if(!b || b.dead || b.removed || b.removeMe) return;
  b.atk = null; b.pending = null; b.atkArmor = false;
  cleanup(b);
  b.hp = 0; b.dead = true; b.deadT = 0; b.ignoreForClear = true;
  G.setState(b, 'ko'); b.vy = 0.1; b.vx = 0; b.onGround = false; b.bounce = 0;
  fh().release(b);
  if(line) say(b, line);
  G.bus.emit('ko', { ent:b, x:b.x, y:b.y + b.height*0.5, z:b.z });
}
// when a boss is purified its helpers stop at once (scared, not counted for the clear) and then pop one by one
function scare(b){
  if(!b || b.dead || b.removed || b.removeMe) return;
  if(G.combat && G.combat.cancel) G.combat.cancel(b);
  b.pending = null; cleanup(b);
  b.scared = true; b.ignoreForClear = true; b.vx = 0; b.vz = 0;
  if(b.state==='act' || b.state==='move') G.setState(b, 'idle');
  fh().release(b);
}
function staggerGiveUp(e, list, lines){
  if(!list) return;
  for(let i=0;i<list.length;i++){ if(e.deadT === 18 + i*16) giveUp(list[i], lines[i % lines.length]); }
}
function liveMinions(e){ if(!e.minions) return 0; let n = 0; for(const m of e.minions) if(m && !m.dead && !m.removed && !m.removeMe) n++; return n; }
// weighted move choice (scratch arrays, no per-tick allocation)
const _mn = [], _mw = [];
function pick(e){
  let tot = 0;
  for(let i=0;i<_mn.length;i++){ if(_mn[i]===e.lastMove) _mw[i] *= 0.3; tot += _mw[i]; }
  let r = rng()*tot, out = _mn[0];
  for(let i=0;i<_mn.length;i++){ r -= _mw[i]; if(r <= 0){ out = _mn[i]; break; } }
  log(e.type + ':' + out);
  return out;
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
// lob a projectile so it lands exactly on mark m after F ticks (combat integrates vy += grav; y += vy)
function lob(e, m, F, o){
  const x0 = e.x + e.face*(o.ox||1.0), y0 = o.oy||1.4, z0 = e.z, g = -0.012;
  const vy = (-y0 - g*F*(F+1)/2)/F;
  const p = G.combat.shoot({ owner:e, kind:o.kind, x:x0, y:y0, z:z0, vx:(m.x - x0)/F, vy, vz:(m.z - z0)/F, grav:g, dmg:o.dmg, r:0.42, life:F + 30,
    power:1, stun:18, kb:0.1, onGround:'die', boom:o.boom, onEnd:projMarkEnd });
  if(p){ p.mark = m; p.markGen = m.gen; m.proj = true; if(o.vis) customVis(p, o.vis); }
  return p;
}
function projMarkEnd(p){ const m = p.mark; if(m && m.gen===p.markGen){ m.on = false; m.proj = false; } if(p.splash) fx(p.splash, p.x, 0.1, p.z, O.ringG); }
const PHASE_ROAR = { id:'bossB_rage', anim:'roar', len:70, hits:[], noAlert:true,
  fn(e, t){ if(t===0) G.setAnim(e, 'roar', 70, 0.3);
    if(t===16){ shake(4, 30); fx('shock', e.x, 0.02, e.z, O.rage); fx('ring', e.x, e.height*0.6, e.z + 0.3, O.rageR); sfx('bossRoar'); } },
  onEnd(e){ e.cool = 24; } };
// phase 2 at ≤50% HP (per form). Decided on the hit itself; the rage roar plays on the next free tick.
function enterPhase(e){
  if(e.phase!==0 || e.dead || e.transforming || !(e.hp <= e.maxHp*0.5) || e.hp <= 0) return;
  e.phase = 1; e.spdMul = 1.2; e.plan = null; e.rageDue = true;
  G.bus.emit('bossPhase', { boss:e, phase: e.form===2 ? 3 : 1 });
  const line = e.form===2 ? e.def.phaseLine2 : e.def.phaseLine;
  if(line) say(e, line);
  log(e.type + ':phase' + (e.form===2 ? 3 : 1));
}
G.bus.on('hit', (d)=>{
  const t = d && d.target; if(!t || !t.def || !t.def.bossB || t.team!==1) return;
  if(t.def.boss) enterPhase(t);
  // キングスライム: every 20% of max HP lost → 2 little slimes
  if(t.type==='slime' && !t.dead && t.hp > 0){
    while(t.splitN < 4 && t.hp <= t.maxHp*(0.8 - 0.2*t.splitN)){ t.splitN++; t.splitDue++; }
  }
});
function phaseCheck(e){
  enterPhase(e);
  if(e.rageDue && !e.dead){ e.rageDue = false; fh().attack(e, PHASE_ROAR, 0); return true; }
  return false;
}
function introRoar(len, line, extra){
  return { id:'bossB_intro', anim:'roar', len, hits:[], noAlert:true,
    fn(e, t){ if(t===0) G.setAnim(e, 'roar', len, 0.3);
      if(t===6 && line) sayIntro(e, line);
      if(t===18){ sfx('bossRoar'); shake(3, 24); fx('shock', e.x, 0.02, e.z, O.shock1); }
      if(extra) extra(e, t); },
    onEnd(e){ e.cool = 30; } };
}
// Framework note: poise damage keeps piling up while a boss lies 'down', so it would be floored again by the first hit
// after getting up (a stun-lock). On the first free tick after a knockdown we clear it and give a short no-stagger grace.
G.bus.on('down', (d)=>{ const e = d && d.ent; if(e && e.def && e.def.bossB) e.downMark = true; });
const GRACE = 240;
function pre(e){
  if(e.downMark){ e.downMark = false; e.poiseDmg = 0; e.noStagger = true; e.graceUntil = G.time.tick + GRACE; e.plan = null; }
  if(e.noStagger && G.time.tick >= (e.graceUntil||0)){ e.noStagger = false; e.poiseDmg = 0; }
}
function common(e){
  e.onInterrupt = onInterruptFor(e);
  e.plan = null; e.moves = 0; e.lastMove = null; e.introDone = false; e.phase = 0; e.form = 1;
  telegraphInit(e);
}
// "purified": the dark aura leaves while the boss lies dizzy
function purifyTick(e, t){ if(t===30){ fx('purify', e.x, 0.6, e.z, O.purify); sfx('heal'); } }
function koT(e){ return e.koLand==null ? -1 : e.deadT - e.koLand; }

// ---------------------------------------------------------------- custom projectile visuals (pooled; replace the fx visual)
const VISP = {};
function visMats(){
  if(VISP._m) return VISP._m;
  const add = (c, o)=>{ const m = new THREE.MeshBasicMaterial({ color:c, transparent:true, opacity:o, blending:THREE.AdditiveBlending, depthWrite:false, toneMapped:false }); m.userData.shared = true; return m; };
  VISP._m = {
    goo: G.look.mat('#8cff6a', { rough:0.18, emissive:'#2a9a20', emissiveIntensity:0.35 }),
    gooHi: G.look.mat('#ffffff', { rough:0.2 }),
    waveO: add('#a050ff', 0.9), waveI: add('#f6e0ff', 0.85),
  };
  return VISP._m;
}
function makeVis(kind){
  const M_ = visMats();
  const obj = new THREE.Group(); obj.name = 'bossB_proj_' + kind;
  const v = { kind, obj, live:false, age:0, m:null,
    update(p){ this.age++; this.obj.position.set(p.x, p.y, p.z); visTick(this, p); },
    dispose(){ if(!this.live) return; this.live = false; if(this.obj.parent) this.obj.parent.remove(this.obj); (VISP[this.kind] || (VISP[this.kind] = [])).push(this); } };
  if(kind==='goo'){
    const m = new THREE.Mesh(G.look.geo.sphere(0.3, 16, 12), M_.goo); m.castShadow = true;
    G.look.outline(m, 0.03, '#1f5a2a');
    const hi = new THREE.Mesh(G.look.geo.sphere(0.08, 8, 6), M_.gooHi); hi.position.set(-0.1, 0.14, 0.2); hi.scale.set(1, 0.7, 0.5); m.add(hi);
    obj.add(m); v.m = m;
  } else {
    const g = G.look.geo.torus(0.62, 0.1, 6, 18, Math.PI);
    // a flat ")" crescent in the screen plane (the x-y plane), bulging toward the travel direction
    const a = new THREE.Mesh(g, M_.waveO); a.rotation.set(0, 0, -HPI); a.scale.set(0.7, 1.25, 1.6);
    const b = new THREE.Mesh(g, M_.waveI); b.rotation.set(0, 0, -HPI); b.scale.set(0.62, 1.15, 0.7); b.position.x = -0.04;
    const w = new THREE.Group(); w.add(a); w.add(b); obj.add(w); v.m = w;
  }
  return v;
}
function visTick(v, p){
  const f = (p.vx||0) < 0 ? -1 : 1;
  if(v.kind==='goo'){ const s = 1 + 0.12*Math.sin(v.age*0.5); v.m.scale.set(s, 1/s, s); v.m.rotation.z = -f*v.age*0.05; }
  else { const s = Math.min(1, 0.4 + v.age*0.12); v.m.scale.set(f*s, s, s); v.m.rotation.x = 0.1*Math.sin(v.age*0.4);
    if(v.age%3===0) fx('sparkle', p.x - f*0.3, p.y, p.z, O.spark); }
}
function customVis(p, kind){
  if(!p) return;
  if(p.vis){ if(p.vis.obj && p.vis.obj.parent) p.vis.obj.parent.remove(p.vis.obj); try { p.vis.dispose && p.vis.dispose(); } catch(err){ G.logError('bossB vis', err); } }
  const pool = VISP[kind] || (VISP[kind] = []);
  const v = pool.pop() || makeVis(kind);
  v.live = true; v.age = 0; v.obj.position.set(p.x, p.y, p.z); v.obj.visible = true;
  G.scene.add(v.obj);
  p.vis = v;
}

// ================================================================ 1) キングスライム + ちびスライム
const SLM = { G1:'#7dff5a', SHELL:'#caffb4', GOLD:'#ffc93a', GOLD_D:'#e39a1a', RUBY:'#ff3a5a', SAPH:'#3aa8ff', BUB:'#eaffdc', BROW:'#1d5a1f', VEL:'#d8304a', LEAF:'#4ec23a' };
const SLM_STOPS = [[0,'#1f9a32'],[0.35,'#52dc46'],[0.7,'#8dff64'],[1,'#d2ffa6']];
function buildSlime(small){
  const s = small ? 0.34 : 1;
  const gk = small ? 'slimelet' : 'slime';
  const k = new Kit({ type:gk, gkey:gk, pose:poseSlime, apply:applySlime, oc:'#1d4d22', ol: small ? 0.02 : 0.03, rough:0.3 });
  k.small = !!small;
  // spring state (squash & stretch driven by a damped spring)
  k.sp = 0; k.spv = 0; k.wb = 0; k.wbv = 0; k.cy = 0; k.cyv = 0;
  const BS = { c:[0, 0.86*s, 0], r:[1.12*s, 0.86*s, 1.08*s] };
  k.BS = BS;
  k.jelly = k.grp(k.body);
  if(!small){
    // opaque inner jelly (gradient + bubbles), seen through a glossy translucent shell
    k.part(k.jelly, 'inner', (b)=>{
      b.add(sph(1,24,16), SLM.G1, BS.c, null, [BS.r[0]*0.965, BS.r[1]*0.965, BS.r[2]*0.965]);
      b.add(sph(1,24,12), SLM.G1, [0,0.2,0], null, [1.2,0.25,1.15]);
      for(let i=0;i<9;i++){ const a = i/9*TAU + 0.3; b.add(sph(0.2,10,8), SLM.G1, [Math.cos(a)*1.1, 0.09, Math.sin(a)*1.06], null, [1,0.55,1]); }
      const bub = [[-1.55,-0.3,0.08],[-1.35,0.5,0.05],[1.2,-0.4,0.07],[1.45,0.25,0.05],[0.35,0.62,0.045]];
      for(const q of bub) feat(b, BS, q[0], q[1], -0.04, sph(q[2],10,8), SLM.BUB, [1,1,0.8]);
      b.add(sph(0.3,14,10), '#48c83a', [0.2,0.62,0.1], null, [1,0.8,1]);        // a darker "core" blob inside
    }, { outline:0, post:(g)=> gradY(g, SLM.G1, 0, 1.72, SLM_STOPS) });
    k.shellMat = takeMat('shell', ()=> G.look.vmat({ instance:true, rough:0.1, rim:1.8, transparent:true, opacity:0.44, emissive:'#1f8a20', emissiveIntensity:0.12, depthWrite:false }));
    k.tmats.push({ m:k.shellMat, base:0.44 });
    k.shell = k.part(k.jelly, 'shell', (b)=>{
      b.add(sph(1,24,16), SLM.SHELL, BS.c, null, BS.r);
      b.add(sph(1,24,12), SLM.SHELL, [0,0.2,0], null, [1.25,0.27,1.2]);
      for(let i=0;i<9;i++){ const a = i/9*TAU + 0.3; b.add(sph(0.21,10,8), SLM.SHELL, [Math.cos(a)*1.12, 0.09, Math.sin(a)*1.08], null, [1,0.55,1]); }
    }, { mat:k.shellMat, outline:0.03 });
    k.shell.castShadow = true; k.shell.renderOrder = 2;
  } else {
    k.part(k.jelly, 'body', (b)=>{
      b.add(sph(1,18,12), SLM.G1, BS.c, null, BS.r);
      b.add(sph(1,18,10), SLM.G1, [0,0.2*s,0], null, [1.22*s,0.27*s,1.17*s]);
      feat(b, BS, 0.45, -0.1*s, -0.02, sph(0.05,8,6), SLM.BUB, [1,1,0.8]);
    }, { post:(g)=> gradY(g, SLM.G1, 0, 1.72*s, SLM_STOPS) });
  }
  // shine highlights (toward the key light: upper, camera side)
  k.part(k.jelly, 'shine', (b)=>{
    feat(b, BS, -0.95*s, 0.52*s, 0.01*s, sph(0.13*s,12,8), WHITE, [1.5,0.62,0.25], -0.6);
    feat(b, BS, -0.72*s, 0.66*s, 0.01*s, sph(0.05*s,10,6), WHITE, [1,1,0.3]);
  }, { mat:'g', outline:0, shadow:false });
  // the face sits on a group turned a little toward the camera (the body is round, so it stays on the surface)
  k.faceG = k.grp(k.jelly); k.faceG.rotation.y = -0.42;
  // crown (king) / sprout (little ones) — its own group so it can lag and hop
  k.crown = k.grp(k.body, [0.05*s, 1.68*s, 0]);
  if(!small){
    k.part(k.crown, 'crown', (b)=>{
      b.add(sph(0.3,14,10), SLM.VEL, [0,0.08,0], null, [1,0.75,1]);
      b.add(cyl(0.3, 0.34, 0.2, 20), SLM.GOLD, [0,0.02,0]);
      b.add(tor(0.33, 0.035, 6, 22), SLM.GOLD_D, [0,-0.08,0], [HPI,0,0]);
      for(let i=0;i<5;i++){ const a = i/5*TAU; b.add(cone(0.075,0.2,8), SLM.GOLD, [Math.cos(a)*0.3, 0.2, Math.sin(a)*0.3]); b.add(sph(0.045,8,6), SLM.GOLD, [Math.cos(a)*0.3, 0.31, Math.sin(a)*0.3]); }
      b.add(sph(0.075,10,8), SLM.RUBY, [0.33,0.02,0], null, [0.6,1,1]);
      b.add(sph(0.045,8,6), SLM.SAPH, [0.2,0.02,0.26], null, [0.8,1,0.8]); b.add(sph(0.045,8,6), SLM.SAPH, [0.2,0.02,-0.26], null, [0.8,1,0.8]);
    }, { mat:'g', outline:0.02, oc:'#5a3a10' });
    k.crown.rotation.z = 0.14;
  } else {
    k.part(k.crown, 'sprout', (b)=>{
      b.add(cyl(0.012, 0.016, 0.1, 6), '#3a8a2a', [0,0.04,0]);
      b.add(sph(0.06,10,6), SLM.LEAF, [0.05,0.1,0], [0,0,-0.6], [1.4,0.4,0.8]); b.add(sph(0.05,10,6), SLM.LEAF, [-0.045,0.09,0], [0,0,0.6], [1.4,0.4,0.8]);
    }, { outline:0.012, oc:'#1d4d22' });
  }
  // face
  const L = small ? 0.012 : 0.03;
  const eu = 0.36*s, ev = 0.13*s, es = small ? 0.08 : 0.165;
  const brow = SLM.BROW;
  if(small) LOD = 0.6;
  try {
  k.faceSet(k.faceG, 'f', {
    N:(b)=>{ eyeDot(b, BS, -eu, ev, es, { lift:L, brow, tilt:0.5 }); eyeDot(b, BS, eu, ev, es, { lift:L, brow, tilt:0.5 });
      if(small) mW(b, BS, 0, -0.12*s, 0.07, L); else { mGrin(b, BS, 0, -0.14, 0.14, L); feat(b, BS, -0.06, -0.26, L+0.02, sph(0.05,8,6), TONGUE, [1,1.1,0.4]); }
      blush(b, BS, -0.62*s, -0.1*s, 0.13*s, null, L*0.5); blush(b, BS, 0.62*s, -0.1*s, 0.13*s, null, L*0.5); },
    B:(b)=>{ eyeLine(b, BS, -eu, ev, es, 0.25, L); eyeLine(b, BS, eu, ev, es, 0.25, L); if(small) mW(b, BS, 0, -0.12*s, 0.07, L); else mGrin(b, BS, 0, -0.14, 0.14, L);
      blush(b, BS, -0.62*s, -0.1*s, 0.13*s, null, L*0.5); blush(b, BS, 0.62*s, -0.1*s, 0.13*s, null, L*0.5); },
    O: small ? null : (b)=>{ eyeDot(b, BS, -eu, ev, es*1.05, { lift:L, brow, tilt:0.7 }); eyeDot(b, BS, eu, ev, es*1.05, { lift:L, brow, tilt:0.7 }); mOpen(b, BS, 0, -0.18*s, 0.17*s, 0.13*s, !small, L);
      blush(b, BS, -0.62*s, -0.1*s, 0.13*s, null, L*0.5); blush(b, BS, 0.62*s, -0.1*s, 0.13*s, null, L*0.5); },
    X:(b)=>{ eyeX(b, BS, -eu, ev, es, null, L); eyeX(b, BS, eu, ev, es, null, L); mWavy(b, BS, 0, -0.16*s, 0.12*s, L); },
    S: small ? null : (b)=>{ eyeSqueeze(b, BS, -eu, ev, es, null, L); eyeSqueeze(b, BS, eu, ev, es, null, L); mO(b, BS, 0, -0.16*s, 0.05*s, L); },
    H:(b)=>{ eyeArc(b, BS, -eu, ev, es, false, null, L); eyeArc(b, BS, eu, ev, es, false, null, L); mOpen(b, BS, 0, -0.16*s, 0.14*s, 0.1*s, false, L);
      blush(b, BS, -0.6*s, -0.08*s, 0.16*s, null, L*0.5); blush(b, BS, 0.6*s, -0.08*s, 0.16*s, null, L*0.5); },
  });
  } finally { LOD = 1; }
  k.extras(k.faceG, sp(BS, -0.62*s, 0.55*s, 0.1*s), small ? 0.3 : 0.62, small ? 0.95 : 2.15);
  if(small) k.stars.scale.setScalar(0.6);
  k.tip.position.set(1.1*s, 0.6*s, 0); k.body.add(k.tip); k.base.position.set(0.4*s, 0.8*s, 0); k.body.add(k.base);
  return k.rig(small ? 0.78 : 2.4, small ? 0.4 : 1.15);
}
function poseSlime(k, e, P, T){
  const an = e.anim, p = animP(e);
  P.sy = 1 + 0.03*Math.sin(T*0.08); P.sx = 1; P.by = 0; P.bx = 0; P.lean = 0; P.roll = 0;
  switch(an){
    case 'walk': case 'run': k.ph += k.small ? 0.3 : 0.2; P.sy = 1 + 0.09*Math.sin(k.ph*2); P.by = 0.05*Math.abs(Math.sin(k.ph))*(k.small?0.4:1); P.lean = -0.08; break;
    case 'windup': { const q = U.easeOutCubic(p); P.sy = 1 - 0.3*q; P.sx = 1 + 0.12*q; P.bx = Math.sin(T*1.9)*0.03*(0.4+p); P.lean = 0.1*q; P.face = 'O'; break; }
    case 'jump': P.sy = (e.vy||0) > 0.02 ? 1.26 : 1.1; P.sx = 0.9; P.face = 'O'; break;
    case 'fall': P.sy = 1.22; P.sx = 0.88; P.face = 'O'; break;
    case 'shoot': P.sy = p < 0.4 ? 1 + 0.14*U.smooth(p, 0, 0.35) : 0.84; P.sx = p < 0.4 ? 1.1 : 1.05; P.lean = p < 0.4 ? 0.06 : -0.12; P.face = 'O'; break;
    case 'special': P.sy = 0.62 + 0.04*Math.sin(T*0.3); P.sx = 1.18; P.face = p < 0.8 ? 'S' : 'N'; P.sweat = p < 0.8 ? 1 : 0; P.stars = p < 0.7 ? 1 : 0; break;
    case 'roar': P.sy = 1.18 + 0.04*Math.sin(T*1.6); P.sx = 0.95; P.bx = Math.sin(T*2.3)*0.02; P.face = 'O'; break;
    case 'attack': case 'attack2': P.sy = 1.1; P.lean = -0.15; P.face = 'O'; break;
    case 'hurt': P.sy = 0.9; P.lean = 0.12; P.face = 'S'; P.sweat = 1; break;
    case 'down': P.sy = e.onGround ? 0.55 : 0.9; P.sx = 1.25; P.face = 'X'; P.stars = 1; P.sweat = 1; break;
    case 'getup': P.sy = lerp(0.55, 1.05, U.easeOutCubic(p)); P.sx = lerp(1.25, 1, p); P.face = p < 0.6 ? 'S' : 'N'; break;
    case 'dizzy': case 'tired': P.lean = 0.12*Math.sin(T*0.13); P.roll = 0.08*Math.cos(T*0.13); P.sy = 0.92; P.face = an==='tired' ? 'S' : 'X'; P.stars = 1; P.sweat = 1; break;
    case 'ko': if(e.onGround){ P.sy = 0.52; P.sx = 1.3; } else { P.sy = 1.08; } P.face = 'X'; P.stars = 1; P.sweat = 1; break;
    case 'cheer': { const ph = T*0.22; P.by = Math.abs(Math.sin(ph))*(k.small ? 0.25 : 0.35); P.sy = 1 + 0.1*Math.cos(ph*2); P.lean = 0.08*Math.sin(ph); P.face = 'H'; break; }
  }
}
function applySlime(k, e, C, T, P){
  const s = k.small ? 0.34 : 1;
  if(k.landed){ k.spv -= 0.1 + Math.min(0.12, Math.abs(k.lastVy||0)*0.35); k.cyv += 0.05*s; k.wbv += (Math.random()-0.5)*0.05; }
  if(k.hitNow){ k.spv += (Math.random()-0.3)*0.1; k.wbv += (Math.random()-0.5)*0.1; }
  k.lastVy = e.vy||0;
  // damped springs: vertical squash and a sideways wobble
  k.spv += ((P.sy - 1) - k.sp)*0.2 - k.spv*0.22; k.sp = clamp(k.sp + k.spv, -0.5, 0.45);
  k.wbv += (C.lean - k.wb)*0.16 - k.wbv*0.16; k.wb = clamp(k.wb + k.wbv, -0.5, 0.5);
  const sy = 1 + k.sp, sx = C.sx*(1 - k.sp*0.55);
  k.jelly.position.set(C.bx, C.by, 0);
  k.jelly.scale.set(sx, sy, sx);
  k.jelly.rotation.set(C.roll, 0, k.wb);
  // the crown rides on top with a little lag
  k.cyv += (0 - k.cy)*0.18 - k.cyv*0.2 - k.spv*0.25*s; k.cy += k.cyv;
  k.crown.position.set(0.05*s + k.wb*-0.6*s + C.bx, 1.68*s*sy + C.by + k.cy, 0);
  k.crown.rotation.set(0, 0, (k.small ? 0 : 0.14) + k.wb*1.4 + k.cy*1.5/s);
}

// ---- slime moves
function bounceFn(e, t){
  const per = e.phase ? 40 : 46, crouch = 14, air = e.phase ? 30 : 33;
  // landing (checked first: the third hop lands after the last hop period starts)
  if(e.hopAir && e.hopUp > 3 && e.onGround){
    e.hopAir = false; e.vx = 0; e.vz = 0;
    if(e.hopMark){ e.hopMark.on = false; e.hopMark = null; }
    G.combat.area({ owner:e, x:e.x, z:e.z, r:1.35, zr:0.85, y0:-0.5, y1:1.5, dmg:12, kb:0.14, up:0.16, stun:20, power:2, kind:'blunt', dur:3 });
    fx('shock', e.x, 0.02, e.z, O.shockG); fx('ring', e.x, 0.25, e.z, O.ringG); shake(2.6, 12); sfx('land'); G.setAnim(e, 'land', 10);
  }
  if(e.hopAir){ e.hopUp++; e.vx = e.hopVx; e.vz = e.hopVz; }
  const k = Math.floor(t/per), tt = t % per;
  if(k >= 3) return;
  if(tt===0){
    const p = fh().target(e);
    G.setAnim(e, 'windup', crouch); e.vx = 0; e.vz = 0;
    const tx = p ? clampX(p.x, e.radius) : e.x, tz = p ? clampZ(p.z) : e.z;
    const dx = clamp(tx - e.x, -3.8, 3.8), dz = clamp(tz - e.z, -1.6, 1.6);
    e.hopVx = dx/air; e.hopVz = dz/air;
    e.hopMark = markOn(e, e.x + dx, e.z + dz, 1.35, true);
    if(p && Math.abs(p.x - e.x) > 0.1) e.face = p.x > e.x ? 1 : -1;
  }
  if(tt===crouch){ e.vy = 0.006*air; e.onGround = false; e.hopAir = true; e.hopUp = 0; G.setAnim(e, 'jump'); sfx('boing'); G.bus.emit('jump', { ent:e });
    if(k===0) say(e, 'ぼよよ〜ん！'); }
}
function slamFn(e, t){
  const p = fh().target(e);
  if(t===0){ G.setAnim(e, 'jump'); e.vy = 0.36; e.vx = 0; e.vz = 0; e.onGround = false; e.slamLand = false; e.slamMark = null;
    sfx('jump'); say(e, 'とんでけ〜！'); fx('dust', e.x, 0.05, e.z, O.dust8); G.bus.emit('jump', { ent:e }); }
  if(t===8) e.intangible = true;                                  // up in the sky: cannot be hit
  if(t < 104){ e.vx = 0; e.vz = 0;
    if(t > 2 && e.y > 4.5 && e.y < 12){ e.gravScale = 0; e.vy = Math.max(e.vy, 0.45); }
    if(e.y >= 12){ e.y = 12; e.vy = 0; e.gravScale = 0; } }
  if(t>=24 && t<80 && p){
    if(!e.slamMark){ e.slamMark = markOn(e, clampX(p.x, 1.1), clampZ(p.z), 2.0, false); sfx('alert'); }
    const m = e.slamMark; if(m){ m.x += (clampX(p.x, 1.1) - m.x)*0.16; m.z += (clampZ(p.z) - m.z)*0.16; }
  }
  if(t===80 && e.slamMark){ e.slamMark.lock = true; sfx('alert'); }
  if(t===104){ const m = e.slamMark; if(m){ e.x = e.px = m.x; e.z = e.pz = m.z; } e.y = e.py = 11; e.vy = -0.4; e.gravScale = 1; G.setAnim(e, 'fall');
    if(p) e.face = p.x > e.x ? 1 : -1; }
  if(t > 104 && !e.slamLand && (e.onGround || t > 150)){
    if(!e.onGround){ e.y = 0; e.vy = 0; e.onGround = true; }
    e.slamLand = true; e.intangible = false; e.gravScale = 1;
    if(e.slamMark){ e.slamMark.on = false; e.slamMark = null; }
    G.combat.area({ owner:e, x:e.x, z:e.z, r:2.0, zr:1.25, y0:-0.5, y1:1.8, dmg:18, kb:0.18, up:0.26, stun:24, power:2, kind:'blunt', dur:3 });
    fx('shock', e.x, 0.02, e.z, O.shockG2); fx('dust', e.x, 0.1, e.z, O.dust12); shake(6, 26); sfx('hitBig'); say(e, 'ドッシーン！');
    G.setAnim(e, 'special', 62);                                  // flattened and puffing: a safe chance to hit it
  }
}
function spawnSlimelets(e, n){
  e.minions = (e.minions || []).filter((m)=> m && !m.dead && !m.removed && !m.removeMe);
  for(let i=0;i<n;i++){
    if(e.minions.length >= 4) break;
    const s = i===0 ? 1 : -1;
    const x = clampX(e.x + e.face*0.9, 0.5), z = clampZ(e.z + s*0.45);
    const m = fh().spawnMinion('slimelet', x, z, { y:1.6, face:e.face });
    if(m){ m.vx = e.face*0.045 + s*0.03; m.vz = s*0.04; m.vy = 0.13; m.summoner = e; e.minions.push(m); fx('sparkle', x, 1.6, z, O.poofG); }
  }
}
const SLIME_M = {
  intro: introRoar(80, 'ぷるぷる〜ん！ おうさまの おでましだ！'),
  bounce: { id:'slime_bounce', anim:'jump', len:150, hits:[], fn: bounceFn, onEnd(e){ cleanup(e); after(e, 80); } },
  slam: { id:'slime_slam', anim:'jump', len:196, hits:[], fn: slamFn, onEnd(e){ cleanup(e); if(e.y > 0.05) e.vy = Math.min(e.vy, -0.3); after(e, 70); } },
  spit: { id:'slime_spit', anim:'shoot', len:56, hits:[], noAlert:true,
    fn(e, t){ if(t===0){ G.setAnim(e, 'shoot', 56, 0.42); if(!e.saidSplit){ e.saidSplit = true; say(e, 'ぷるぷる…たたくほど ふえるぞ！'); } else say(e, 'ぷるるんっ！'); }
      if(t===22){ spawnSlimelets(e, 2); sfx('pop'); } },
    onEnd(e){ e.cool = Math.max(e.cool, 30); e.plan = null; } },
  goo: { id:'slime_goo', anim:'shoot', len:92, hits:[],
    fn(e, t){
      if(t===0){ G.setAnim(e, 'shoot', 44, 0.45); say(e, 'ぺっぺっぺ〜！');
        const p = fh().target(e), px = p ? p.x : e.x + e.face*3, pz = p ? p.z : e.z;
        const sd = rng() < 0.5 ? 1 : -1;
        e.gooM = e.gooM || [null, null, null];
        const S = [[0,0],[1.7, -0.75*sd],[-1.7, 0.75*sd]];
        for(let i=0;i<3;i++) e.gooM[i] = markOn(e, clampX(px + S[i][0], 0.6), clampZ(pz + S[i][1]), 1.0, false); }
      if(t===16 || t===24 || t===32){ const i = (t - 16)/8, m = e.gooM && e.gooM[i];
        if(m){ m.lock = true; const pr = lob(e, m, 36, { kind:'ball', vis:'goo', dmg:12, ox:1.0, oy:1.3,
          boom:{ r:1.0, zr:0.7, dmg:12, power:2, kind:'blunt', up:0.16, y0:-0.5, y1:1.5 } }); if(pr) pr.splash = 'ring'; }
        sfx('shoot'); } },
    onEnd(e){ after(e, 84); } },
};
function slimeAI(e){
  const h = fh(), t = h.target(e);
  pre(e); safety(e);
  if(!e.introDone){ e.introDone = true; if(t) h.face(e, t); h.attack(e, SLIME_M.intro, 0); return; }
  if(!t){ h.stop(e); return; }
  if(phaseCheck(e)) return;
  if(e.splitDue > 0){ e.splitDue--; if(liveMinions(e) < 4){ h.attack(e, SLIME_M.spit, 16); return; } }
  h.face(e, t);
  if(e.cool > 0){ hover(e, t, 3.4, 0.6); return; }
  const adx = Math.abs(t.x - e.x);
  if(!e.plan){
    _mn.length = 0; _mw.length = 0;
    opt('bounce', 5); opt('slam', adx > 2 ? 3 : 2); opt('goo', e.phase ? 3.2 : 0);
    e.plan = pick(e); e.planT = 0;
  }
  if(++e.planT > 170){ log('timeout:' + e.plan); e.plan = null; e.cool = 20; return; }
  switch(e.plan){
    case 'bounce': if(adx < 9) go(e, SLIME_M.bounce, 30); else approach(e, t.x, t.z); break;
    case 'slam': go(e, SLIME_M.slam, 30); break;
    case 'goo': go(e, SLIME_M.goo, 30); break;
    default: e.plan = null;
  }
}
// ちびスライム: hops at the hero
const SLIMELET_HOP = { id:'slimelet_hop', anim:'jump', len:46,
  hits:[ { at:3, dur:26, x0:-0.35, x1:0.6, zr:0.45, y0:0, y1:0.9, dmg:7, kb:0.08, stun:16, kind:'blunt', power:1 } ],
  fn(e, t){ if(t===0){ e.vy = 0.17; e.onGround = false; e.hopLanded = false; G.setAnim(e, 'jump'); sfx('boing', { vol:0.5, pitch:1.5 }); }
    if(t < 28 && !e.onGround) e.vx = e.face*0.075;
    if(t > 4 && e.onGround && !e.hopLanded){ e.hopLanded = true; e.vx = 0; G.setAnim(e, 'land', 10); fx('dust', e.x, 0.05, e.z, O.dustS); } },
  onEnd(e){ e.hopLanded = false; after(e, 70); } };
function slimeletAI(e){
  const h = fh(), t = h.target(e);
  if(e.scared){ e.vx *= 0.8; e.vz *= 0.8; if(t) h.face(e, t); if(e.anim!=='hurt') G.setAnim(e, 'hurt'); return; }
  if(!t){ h.stop(e); return; }
  h.face(e, t);
  const dx = t.x - e.x, adx = Math.abs(dx), adz = Math.abs(t.z - e.z);
  // flank spot beside the hero (same rule as h.flank, without allocating)
  const side = e.x < t.x ? -1 : 1, fz = clampZ(t.z + (e.id%3 - 1)*0.35);
  if(e.cool > 0){ h.walkTo(e, t.x + side*2.2, fz); h.face(e, t); return; }
  if(adx < 2.2 && adx > 0.5 && adz < 0.45){
    if(h.token(e)) h.attack(e, SLIMELET_HOP, 20); else { h.stop(e); h.wait(e, 24); }
  } else h.walkTo(e, t.x + side*1.6, fz);
}

// ================================================================ 2) ひりゅう ヴォルカ — chubby baby dragon
const DRG = { RED:'#d6532e', RED_D:'#a83a20', BELLY:'#ffe0a8', BELLY_D:'#f0b070', HORN:'#fff1d6', WING:'#ffb27a', SPIKE:'#ffb347', CLAW:'#fff6e8', NOSE:'#5a1a10', BROW:'#4a140c' };
function buildDragon(){
  const c = DRG;
  const k = new Kit({ type:'dragon', gkey:'dragon', lie:0.4, sit:0.34, pose:poseDragon, apply:applyDragon });
  const hipY = 0.5;
  const legFill = (b)=>{ b.add(cap(0.21, 0.12), c.RED, [0,-0.14,0]); b.add(sph(0.24,16,12), c.RED_D, [0.08,-0.37,0], null, [1.35,0.62,1.1]);
    for(let i=-1;i<=1;i++) b.add(cone(0.05,0.14,8), c.CLAW, [0.38,-0.4,i*0.11], [0,0,-HPI]); };
  k.legL = k.grp(k.body, [-0.05, hipY, -0.36]); k.legR = k.grp(k.body, [-0.05, hipY, 0.36]);
  k.part(k.legL, 'leg', legFill); k.part(k.legR, 'leg', legFill);
  k.hips = k.grp(k.body, [0, hipY, 0]);
  const BE = { c:[0.3,0.45,0], r:[0.42,0.5,0.5] };
  k.part(k.hips, 'torso', (b)=>{
    b.add(sph(0.68,22,16), c.RED, [0,0.5,0], null, [1.0,0.98,0.96]);
    b.add(sph(1,18,14), c.BELLY, BE.c, null, BE.r);
    for(let i=0;i<4;i++){ const v = -0.3 + i*0.18; feat(b, BE, 0, v, -0.005, cap(0.022, 0.46 - Math.abs(i-1.5)*0.08, 2, 6), c.BELLY_D, [1,1,0.6], HPI); }
    for(let i=0;i<4;i++){ const a = 1.9 + i*0.42; b.add(cone(0.1 - i*0.012, 0.24 - i*0.03, 8), c.SPIKE, [Math.cos(a)*0.64, 0.5 + Math.sin(a)*0.64, 0], [0,0,a - HPI]); }
  });
  k.tail = k.grp(k.hips, [-0.58, 0.22, 0]);
  k.part(k.tail, 'tail', (b)=>{ b.add(sph(0.27,14,10), c.RED, [-0.14,0,0]); b.add(sph(0.2,12,10), c.RED, [-0.42,0.08,0]); b.add(sph(0.14,12,10), c.RED, [-0.66,0.2,0]);
    b.add(cone(0.17,0.34,4), c.SPIKE, [-0.86,0.32,0], [0,0,HPI + 0.5], [1,1,0.35]);
    b.add(cone(0.07,0.14,8), c.SPIKE, [-0.34,0.3,0], [0,0,0.2]); b.add(cone(0.06,0.12,8), c.SPIKE, [-0.58,0.36,0], [0,0,0.3]); });
  const armFill = (b)=>{ b.add(cap(0.13, 0.12), c.RED, [0,-0.12,0]); b.add(sph(0.15,14,10), c.RED, [0.03,-0.3,0]);
    for(let i=-1;i<=1;i++) b.add(cone(0.035,0.12,6), c.CLAW, [0.16,-0.36,i*0.07], [0,0,-2.0]); };
  k.armL = k.grp(k.hips, [0.22, 0.82, -0.52]); k.armR = k.grp(k.hips, [0.22, 0.82, 0.52]);
  k.part(k.armL, 'arm', armFill); k.part(k.armR, 'arm', armFill);
  // small bat wings (built for the +z side; the left one is mirrored)
  const wingFill = (b)=>{
    b.add(cap(0.06, 0.55, 3, 8), c.RED_D, [-0.06,0.32,0.08], [0.25,0,0.3]);
    b.add(sph(0.44,16,10), c.WING, [-0.26,0.44,0.1], [0.25,0,0.35], [0.78,1.0,0.12]);
    b.add(sph(0.3,12,8), c.WING, [-0.5,0.2,0.08], [0.2,0,0.8], [0.75,1.0,0.11]);
    b.add(cap(0.035, 0.34, 2, 6), c.RED_D, [-0.36,0.25,0.12], [0.2,0,0.95]);
    b.add(cone(0.06,0.14,6), c.CLAW, [-0.14,0.64,0.15], [0.25,0,0.3]);
  };
  k.wingL = k.grp(k.hips, [-0.34, 1.0, -0.3]); k.wingR = k.grp(k.hips, [-0.34, 1.0, 0.3]);
  k.wingL.scale.z = -1;
  k.part(k.wingL, 'wing', wingFill); k.part(k.wingR, 'wing', wingFill);
  // head
  k.head = k.grp(k.hips, [0.14, 1.1, 0]);
  const HS = { c:[0.05,0.55,0], r:[0.72,0.66,0.72] }, MZ = { c:[0.66,0.38,0], r:[0.36,0.24,0.34] };
  k.part(k.head, 'head', (b)=>{
    b.add(sph(0.72,24,16), c.RED, HS.c, null, [1.0,0.92,1.0]);
    b.add(sph(0.31,16,12), c.RED, MZ.c, null, [1.16,0.78,1.1]);
    b.add(sph(0.27,14,10), c.BELLY, [0.6,0.26,0], null, [1.05,0.5,1.02]);
    for(let s=-1;s<=1;s+=2){
      b.add(sph(0.045,8,6), c.NOSE, [0.98,0.47,s*0.1], null, [0.6,1,1]);
      b.add(cone(0.1,0.42,10), c.HORN, [-0.18,1.12,s*0.3], [s*0.35,0,0.5]);
      b.add(tor(0.1,0.02,5,12), '#f0d8b0', [-0.11,1.0,s*0.28], [HPI + s*0.35, 0, 0.5]);
      b.add(cone(0.12,0.3,8), c.SPIKE, [-0.1,0.62,s*0.7], [s*(HPI+0.3),0,0.3], [0.5,1,1]);
      b.add(cone(0.09,0.22,8), c.SPIKE, [-0.28,0.52,s*0.64], [s*(HPI+0.5),0,0.6], [0.5,1,1]);
    }
    b.add(cone(0.08,0.18,8), c.SPIKE, [-0.45,0.95,0], [0,0,0.9]); b.add(cone(0.07,0.15,8), c.SPIKE, [-0.62,0.7,0], [0,0,1.3]);
    blush(b, HS, -0.46, -0.12, 0.1); blush(b, HS, 0.46, -0.12, 0.1);
  });
  const ev = 0.1, eu = 0.25, es = 0.13;
  const eo = { browC:c.BROW, tilt:0.5 };
  k.faceSet(k.head, 'd', {
    N:(b)=>{ eyeAngry(b, HS, -eu, ev, es, eo); eyeAngry(b, HS, eu, ev, es, eo); mFrown(b, MZ, 0, -0.08, 0.07);
      feat(b, MZ, -0.09, -0.1, 0.012, cone(0.022,0.06,6), WHITE, [1,1,0.6], Math.PI); feat(b, MZ, 0.09, -0.1, 0.012, cone(0.022,0.06,6), WHITE, [1,1,0.6], Math.PI); },
    B:(b)=>{ eyeLine(b, HS, -eu, ev, es, 0.25); eyeLine(b, HS, eu, ev, es, 0.25);
      for(let s=-1;s<=1;s+=2) feat(b, HS, s*eu + (s<0?1:-1)*es*0.12, ev + es*1.22, es*0.1, cap(es*0.2, es*1.05, 2, 6), c.BROW, [1,1,0.55], HPI - (s<0?1:-1)*0.5);
      mFrown(b, MZ, 0, -0.08, 0.07); },
    O:(b)=>{ eyeAngry(b, HS, -eu, ev, es, { browC:c.BROW, tilt:0.62, pupil:0.48 }); eyeAngry(b, HS, eu, ev, es, { browC:c.BROW, tilt:0.62, pupil:0.48 }); mOpen(b, MZ, 0, -0.06, 0.15, 0.11, true); },
    S:(b)=>{ eyeSqueeze(b, HS, -eu, ev, es); eyeSqueeze(b, HS, eu, ev, es); mO(b, MZ, 0, -0.08, 0.05); },
    X:(b)=>{ eyeX(b, HS, -eu, ev, es); eyeX(b, HS, eu, ev, es); mWavy(b, MZ, 0, -0.08, 0.09); },
    H:(b)=>{ eyeArc(b, HS, -eu, ev, es); eyeArc(b, HS, eu, ev, es); mOpen(b, MZ, 0, -0.06, 0.12, 0.08, false); blush(b, HS, -0.46, -0.1, 0.13); blush(b, HS, 0.46, -0.1, 0.13); },
  });
  k.extras(k.head, [0.3, 1.05, 0.62], 0.62, 1.45);
  k.tip.position.set(1.05, 0.34, 0); k.head.add(k.tip); k.base.position.set(0.5, 0.4, 0); k.head.add(k.base);
  return k.rig(2.7, 1.0);
}
function poseDragon(k, e, P, T){
  const an = e.anim, p = animP(e), hit = e.animHit || 0.35;
  P.flap = 0.09; P.wf = 0.1;
  switch(an){
    case 'fly': k.ph += 0.2; P.flap = 0.55; P.wf = 0.35; P.lLz = 0.5 + 0.1*Math.sin(k.ph); P.lRz = 0.3 + 0.1*Math.sin(k.ph + 1); P.aLz = P.aRz = 0.9; P.lean = -0.08; P.by = 0.05*Math.sin(T*0.2); P.wag = 0.5; P.wagSpd = 0.25; break;
    case 'windup': P.flap = e.onGround ? 0.12 : 0.6; P.wf = e.onGround ? 0.4 : 0.35; P.hz = 0.25; P.tl = 0.2; break;
    case 'shoot': {                                                 // fire breath: rear back, then bend the head down toward the ground
      const u = strikeU(p, hit);
      P.lean = lerp(0.3, -0.22, u); P.hz = lerp(0.35, -0.55, u); P.aLz = P.aRz = lerp(-0.3, 0.6, u); P.face = 'O'; P.wf = 0.5*u; P.tl = 0.25; break; }
    case 'attack': {                                                // tail swipe: a full turn with the tail out
      const q = U.smooth(p, 0.18, 0.62);
      P.spin = q*TAU; P.tl = 0.55*U.bump(p, 0.1, 0.8); P.wag = 0; P.lean = 0.1; P.aLz = P.aRz = 0.9; P.face = 'O'; break; }
    case 'special': P.lean = -0.9; P.hz = -0.35; P.aLz = P.aRz = 2.4; P.lLz = P.lRz = -0.5; P.wf = -0.45; P.flap = 0; P.face = 'O'; P.sy = 1.08; break;
    case 'jump': case 'fall': P.flap = 0.5; P.wf = 0.3; break;
    case 'cheer': P.flap = 0.35; P.wf = 0.3; break;
    case 'roar': P.wf = 0.5; P.flap = 0.25; P.tl = 0.3; break;
    case 'down': case 'ko': P.flap = 0; P.wf = -0.3; break;
  }
}
function applyDragon(k, e, C, T, P){
  applyBiped(k, e, C);
  const w = Math.sin(T*(P.wagSpd||0.1)*2.2);
  k.tail.rotation.set(w*C.wag*0.3, w*C.wag*0.45, 0.08 + C.tl + 0.05*Math.sin(T*0.05));
  const fl = P.flap ? Math.sin(T*P.flap*2.2) : 0;
  const a = 0.45 + C.wf + fl*(P.flap > 0.3 ? 0.6 : 0.12);
  k.wingL.rotation.set(-a, 0, 0.15 - C.wf*0.3); k.wingR.rotation.set(a, 0, 0.15 - C.wf*0.3);
}
// ---- dragon moves
function fireShot(e){
  const p = fh().target(e), aim = p ? clamp((p.z - e.z)/60, -0.015, 0.015) : 0;
  const x0 = e.x + e.face*1.45;
  G.combat.shoot({ owner:e, kind:'fire', x:x0, y:0.32, z:e.z, vx:e.face*0.15, vz:aim, vy:0, grav:0, onGround:'slide',
    dmg:12, r:0.42, life:110, power:1, kb:0.12, up:0.1, stun:18 });
  fx('flame', x0 - e.face*0.3, 0.4, e.z + 0.2, O.flameS);
  sfx('shoot', SFX_FIRE);
}
function diveFn(e, t){
  const p = fh().target(e), HY = 1.75;
  if(t===0){ G.setAnim(e, 'fly'); e.gravScale = 0; e.onGround = false; e.diveLand = false; e.diveMark = null; e.vy = 0.05;
    say(e, 'とんでやる〜！'); sfx('jump'); fx('dust', e.x, 0.05, e.z, O.dust8); G.bus.emit('jump', { ent:e }); }
  if(t < 122){ e.gravScale = 0; e.onGround = false; e.vy = (HY + 0.15*Math.sin(t*0.12) - e.y)*0.08;
    if(p && t < 100){ const sd = e.x < p.x ? -1 : 1; const tx = clampX(p.x + sd*2.4, e.radius);
      e.vx = clamp((tx - e.x)*0.04, -0.06, 0.06); e.vz = clamp((p.z - e.z)*0.04, -0.04, 0.04); if(Math.abs(p.x - e.x) > 0.1) e.face = p.x > e.x ? 1 : -1; }
    else { e.vx *= 0.8; e.vz *= 0.8; }
    if(t%16===0) sfx('dodge', SFX_FLAP);
  }
  if(t>=56 && t<100 && p){
    if(!e.diveMark){ e.diveMark = markOn(e, clampX(p.x, 1), clampZ(p.z), 1.6, false); sfx('alert'); }
    const m = e.diveMark; if(m){ m.x += (clampX(p.x, 1) - m.x)*0.16; m.z += (clampZ(p.z) - m.z)*0.16; }
  }
  if(t===100 && e.diveMark){ e.diveMark.lock = true; sfx('alert'); G.setAnim(e, 'windup', 22); say(e, 'いくぞ〜！'); }
  if(t===122){ const m = e.diveMark; e.diveTX = m ? m.x : e.x; e.diveTZ = m ? m.z : e.z; if(Math.abs(e.diveTX - e.x) > 0.1) e.face = e.diveTX > e.x ? 1 : -1;
    G.setAnim(e, 'special', 30); sfx('swing'); }
  if(t>=122 && !e.diveLand){
    const F = Math.max(1, 138 - t);
    e.vx = (e.diveTX - e.x)/F; e.vz = (e.diveTZ - e.z)/F; e.vy = -e.y/F - 0.002; e.gravScale = 0;
    if((t > 123 && e.onGround) || t >= 142){
      if(!e.onGround){ e.y = 0; e.vy = 0; e.onGround = true; }
      e.diveLand = true; e.gravScale = 1; e.vx = 0; e.vz = 0; e.vy = 0;
      if(e.diveMark){ e.diveMark.on = false; e.diveMark = null; }
      G.combat.area({ owner:e, x:e.x, z:e.z, r:1.6, zr:1.0, y0:-0.5, y1:2.0, dmg:16, kb:0.16, up:0.24, stun:24, power:2, kind:'blunt', dur:3 });
      fx('shock', e.x, 0.02, e.z, O.shockF); fx('dust', e.x, 0.1, e.z, O.dust12); shake(5, 22); sfx('hitBig'); say(e, 'ドーン！');
      G.setAnim(e, 'tired', 50);
    }
  }
}
const DRAGON_M = {
  intro: introRoar(80, 'ガオー！ ぼくは ひりゅう ヴォルカ！', (e, t)=>{ if(t===20 || t===40) fx('flame', e.x + e.face*1.4, 2.2, e.z + 0.3, O.flame); }),
  breath: { id:'dragon_breath', anim:'shoot', len:76, hits:[],
    fn(e, t){
      if(t===0){ G.setAnim(e, 'shoot', 76, 0.16); if(!e.saidJump){ e.saidJump = true; say(e, 'ジャンプで かわせるかな？'); } else say(e, 'ボワーッ！'); }
      const bursts = e.phase ? 2 : 1;
      for(let b=0;b<bursts;b++){ const base = 12 + b*36; if(t===base || t===base+6 || t===base+12) fireShot(e); }
      if(e.phase && t===40) G.setAnim(e, 'shoot', 36, 0.3); },
    onEnd(e){ after(e, 84); } },
  dive: { id:'dragon_dive', anim:'fly', len:192, hits:[], fn: diveFn, onEnd(e){ cleanup(e); if(e.y > 0.05) e.vy = Math.min(e.vy, -0.2); after(e, 76); } },
  tail: { id:'dragon_tail', anim:'attack', len:50,
    hits:[ H({ at:16, dur:10, x0:-2.1, x1:1.7, zr:0.85, y0:0, y1:1.4, dmg:13, kb:0.18, up:0.14, stun:22, power:2, kind:'blunt' }) ],
    fn(e, t){ if(t===0) G.setAnim(e, 'attack', 50, 0.32); if(t===14){ sfx('swing'); say(e, 'しっぽ ビターン！'); } if(t===18) fx('dust', e.x, 0.05, e.z, O.dust8); },
    onEnd(e){ after(e, 78); } },
  balls: { id:'dragon_balls', anim:'shoot', len:90, hits:[],
    fn(e, t){
      if(t===0){ G.setAnim(e, 'shoot', 44, 0.4); say(e, 'ひのたま みっつ！');
        const p = fh().target(e), px = p ? p.x : e.x + e.face*3, pz = p ? p.z : e.z, sd = rng() < 0.5 ? 1 : -1;
        e.gooM = e.gooM || [null, null, null];
        const S = [[0,0],[1.8, -0.8*sd],[-1.8, 0.8*sd]];
        for(let i=0;i<3;i++) e.gooM[i] = markOn(e, clampX(px + S[i][0], 0.6), clampZ(pz + S[i][1]), 1.1, false); }
      if(t===16 || t===24 || t===32){ const i = (t - 16)/8, m = e.gooM && e.gooM[i];
        if(m){ m.lock = true; lob(e, m, 34, { kind:'fire', dmg:12, ox:1.2, oy:2.2, boom:{ r:1.1, zr:0.75, dmg:12, power:2, kind:'fire', up:0.16, y0:-0.5, y1:1.6, fx:'flame' } }); }
        sfx('shoot', { pitch:0.8 }); fx('flame', e.x + e.face*1.2, 2.2, e.z + 0.3, O.flameS); } },
    onEnd(e){ after(e, 84); } },
};
function dragonAI(e){
  const h = fh(), t = h.target(e);
  pre(e); safety(e);
  if(!e.introDone){ e.introDone = true; if(t) h.face(e, t); h.attack(e, DRAGON_M.intro, 0); return; }
  if(!t){ h.stop(e); return; }
  if(phaseCheck(e)) return;
  h.face(e, t);
  if(e.cool > 0){ hover(e, t, 3.6, 0.7); return; }
  const dx = t.x - e.x, adx = Math.abs(dx), adz = Math.abs(t.z - e.z), sd = dx > 0 ? -1 : 1;
  if(!e.plan){
    _mn.length = 0; _mw.length = 0;
    opt('breath', adx > 2.5 ? 5 : 2); opt('dive', 3); opt('tail', adx < 2.6 ? 5 : 1); opt('balls', e.phase ? 3.5 : 0);
    e.plan = pick(e); e.planT = 0;
  }
  if(++e.planT > 170){ log('timeout:' + e.plan); e.plan = null; e.cool = 20; return; }
  switch(e.plan){
    case 'breath': if(adx > 2.8 && adx < 9 && adz < 0.35) go(e, DRAGON_M.breath, 34); else approach(e, t.x + sd*4.6, t.z); break;
    case 'dive': go(e, DRAGON_M.dive, 30); break;
    case 'tail': if(adx < 2.3 && adz < 0.6) go(e, DRAGON_M.tail, 24); else approach(e, t.x + sd*1.5, t.z); break;
    case 'balls': go(e, DRAGON_M.balls, 30); break;
    default: e.plan = null;
  }
}

// ================================================================ 3) こくけんし クロイヌ — the black イッヌ
// Hero proportions (same layout as 20_heroes), built at hero scale and enlarged by the kit's scale group.
const KSC = 1.9;
const KU = { FUR:'#2c2733', FUR_L:'#3d3746', MUZ:'#5e5669', TAB:'#4a3f5e', TAB_D:'#2a2233', CAPE:'#7a36c0', CAPE_D:'#3c1a66',
  BOOT:'#241e2c', SILVER:'#cfd0e0', PURP:'#b070ff', BLADE:'#e6c8ff', HALO:'#7a3ab8', GOLD:'#ffd24d', BROW:'#161219' };
const KL = { hipY:0.21, bodyC:0.15, neckY:0.36, headC:0.30, headR:0.36, headS:[1.0,0.92,1.06] };
function onHeadK(az, el, lift){ const R = KL.headR, s = KL.headS, k = 1 + (lift||0), ce = Math.cos(el);
  return [ R*s[0]*ce*Math.cos(az)*k, KL.headC + R*s[1]*Math.sin(el)*k, R*s[2]*ce*Math.sin(az)*k ]; }
function buildKuro(){
  const c = KU;
  const k = new Kit({ type:'kuroinu', gkey:'kuroinu', scale:KSC, lie:0.1, sit:0.12, ol:0.013, pose:poseKuro, apply:applyKuro });
  k.bmat = k.glow('#9a4aff', 0.85);
  const legFill = (b)=>{ b.add(cap(0.072, 0.06, 3, 10), c.TAB_D, [0,-0.085,0]); b.add(sph(0.08,12,8), c.BOOT, [0.03,-0.165,0], null, [1.35,0.72,1.08]);
    b.add(tor(0.07, 0.014, 5, 14), c.CAPE, [0.0,-0.12,0], [HPI,0,0]); };
  k.legL = k.grp(k.body, [0, KL.hipY, -0.095]); k.legR = k.grp(k.body, [0, KL.hipY, 0.095]);
  k.part(k.legL, 'leg', legFill); k.part(k.legR, 'leg', legFill);
  k.hips = k.grp(k.body, [0, KL.hipY, 0]);
  k.part(k.hips, 'torso', (b)=>{
    b.add(sph(0.215, 18, 12), c.TAB, [0, KL.bodyC, 0], null, [0.95,1.08,0.98]);
    b.add(tor(0.19, 0.03, 6, 21), c.TAB_D, [0,0.055,0], [HPI,0,0], [1,1.04,1]);
    b.add(rbox(0.03,0.075,0.09,0.012), c.SILVER, [0.19,0.055,0]);
    b.add(sph(0.036, 8, 6), c.PURP, [0.205,0.2,0], null, [0.45,0.95,1.05]);
    for(const t of [-1,0,1]) b.add(sph(0.016,8,6), c.PURP, [0.196, 0.25+(t?0:0.012), t*0.032], null, [0.5,1,1]);
    b.add(tor(0.12, 0.042, 6, 15), c.FUR, [0,0.325,0], [HPI,0,0]);
    for(const s of [-1,1]) b.add(sph(0.028,8,6), c.SILVER, [0.08,0.33,s*0.1]);
  });
  k.cape = k.grp(k.hips, [-0.1, 0.33, 0]);
  k.part(k.cape, 'cape', (b)=>{ b.add(cyl(0.12, 0.3, 0.5, 18), c.CAPE, [-0.075,-0.25,0], [0,0,0.05], [0.34,1,1]);
    b.add(cyl(0.1, 0.27, 0.46, 14), c.CAPE_D, [-0.055,-0.23,0], [0,0,0.05], [0.26,1,1]); });
  const armFill = (b)=>{ b.add(cap(0.058, 0.07, 3, 8), c.TAB, [0,-0.07,0]); b.add(sph(0.072,10,7), c.FUR, [0.012,-0.165,0]); b.add(tor(0.06, 0.012, 5, 12), c.CAPE, [0,-0.115,0], [HPI,0,0]); };
  k.armL = k.grp(k.hips, [0, 0.27, -0.185]); k.armR = k.grp(k.hips, [0, 0.27, 0.185]);
  k.part(k.armL, 'arm', armFill); k.part(k.armR, 'arm', armFill);
  // sword (hilt in the body material, the blade glows)
  k.sword = k.grp(k.armR, [0.012, -0.175, 0]); k.sword.rotation.z = -1.9;
  k.part(k.sword, 'hilt', (b)=>{ b.add(cap(0.026, 0.09, 3, 8), c.TAB_D, [0,0,0]); b.add(sph(0.034, 8, 6), c.PURP, [0,-0.08,0]);
    b.add(rbox(0.2, 0.045, 0.06, 0.018), c.SILVER, [0,0.075,0]); b.add(sph(0.03,8,6), c.PURP, [0,0.075,0.03]); });
  k.part(k.sword, 'blade', (b)=>{ b.add(rbox(0.095, 0.46, 0.028, 0.012), c.BLADE, [0,0.33,0]); b.add(cone(0.0475, 0.1, 4), c.BLADE, [0,0.61,0], null, [1,1,0.3]);
    b.add(G.look.geo.box(0.014, 0.42, 0.032), '#fff6ff', [0.018,0.33,0]); }, { mat:'b', outline:0.008, oc:'#3a1a5a' });
  k.tip.position.set(0, 0.64, 0); k.sword.add(k.tip); k.base.position.set(0, 0.1, 0); k.sword.add(k.base);
  // head (ears merged: they only need to sway with the head)
  k.head = k.grp(k.hips, [0, KL.neckY, 0]);
  const mp = onHeadK(0, -0.36, -0.2), mz = [0.9,0.72,1.12];
  const HS = { c:[0, KL.headC, 0], r:[KL.headR*KL.headS[0], KL.headR*KL.headS[1], KL.headR*KL.headS[2]] };
  const MZ = { c:mp, r:[0.13*mz[0], 0.13*mz[1], 0.13*mz[2]] };
  k.part(k.head, 'head', (b)=>{
    b.add(sph(KL.headR, 24, 16), c.FUR, [0, KL.headC, 0], null, KL.headS);
    b.add(sph(0.13, 14, 10), c.MUZ, mp, null, mz);
    const nx = mp[0] + 0.13*mz[0] - 0.012, ny = mp[1] + 0.13*mz[1]*0.55;
    b.add(sph(0.042, 10, 7), '#0e0a10', [nx, ny, 0], null, [0.85,0.72,1.15]); b.add(sph(0.012,6,4), WHITE, [nx+0.025, ny+0.02, 0.012]);
    for(const q of [[0,1.2,0.075],[0.9,1.02,0.07],[-0.9,1.02,0.07],[2.2,0.95,0.07],[-2.2,0.95,0.07],[Math.PI,1.1,0.075]]) b.add(sph(q[2],10,7), c.FUR_L, onHeadK(q[0], q[1], 0.02));
    for(const s of [-1,1]){ const ep = onHeadK(s*1.3, 0.42, -0.04);
      b.add(sph(0.12,10,7), c.FUR_L, [ep[0], ep[1]-0.15, ep[2] + s*0.03], [s*-0.12,0,0], [0.62,1.45,0.5]);
      b.add(sph(0.07,8,6), c.FUR, [ep[0]+0.02, ep[1]-0.27, ep[2] + s*0.04]); }
    blush(b, HS, -0.2, -0.07, 0.05, '#b8607e'); blush(b, HS, 0.2, -0.07, 0.05, '#b8607e');
  }, { outline:0.012 });
  const eu = 0.14, ev = -0.005, es = 0.058, eo = { browC:c.BROW, tilt:0.5, browW:0.24 };
  k.faceSet(k.head, 'k', {
    N:(b)=>{ eyeAngry(b, HS, -eu, ev, es, eo); eyeAngry(b, HS, eu, ev, es, eo); mFrown(b, MZ, 0, -0.03, 0.03); },
    B:(b)=>{ eyeLine(b, HS, -eu, ev, es, 0.25); eyeLine(b, HS, eu, ev, es, 0.25); mFrown(b, MZ, 0, -0.03, 0.03);
      for(let s=-1;s<=1;s+=2) feat(b, HS, s*eu + (s<0?1:-1)*es*0.12, ev + es*1.22, es*0.1, cap(es*0.24, es*1.05, 2, 6), c.BROW, [1,1,0.55], HPI - (s<0?1:-1)*0.5); },
    O:(b)=>{ eyeAngry(b, HS, -eu, ev, es, { browC:c.BROW, tilt:0.62, browW:0.24, pupil:0.5 }); eyeAngry(b, HS, eu, ev, es, { browC:c.BROW, tilt:0.62, browW:0.24, pupil:0.5 }); mOpen(b, MZ, 0, -0.04, 0.05, 0.04, true); },
    S:(b)=>{ eyeSqueeze(b, HS, -eu, ev, es, '#e8e0f0'); eyeSqueeze(b, HS, eu, ev, es, '#e8e0f0'); mO(b, MZ, 0, -0.04, 0.018); },
    X:(b)=>{ eyeX(b, HS, -eu, ev, es, '#e8e0f0'); eyeX(b, HS, eu, ev, es, '#e8e0f0'); mWavy(b, MZ, 0, -0.04, 0.03); },
    H:(b)=>{ eyeArc(b, HS, -eu, ev, es, false, '#fff2d0'); eyeArc(b, HS, eu, ev, es, false, '#fff2d0'); mOpen(b, MZ, 0, -0.04, 0.04, 0.03, false);
      blush(b, HS, -0.2, -0.07, 0.065, '#ff8fb0'); blush(b, HS, 0.2, -0.07, 0.065, '#ff8fb0'); },
  });
  // halo: dark while he is lost in the darkness, gold once he is freed
  k.halo = k.grp(k.head, [0, KL.headC + 0.331 + 0.1, 0]);
  k.haloD = k.part(k.halo, 'haloD', (b)=>{ b.add(tor(0.15, 0.03, 6, 24), c.HALO, [0,0,0], [HPI,0,0]); }, { mat:'b', outline:0.008, oc:'#2a1040' });
  k.haloG = k.part(k.halo, 'haloG', (b)=>{ b.add(tor(0.16, 0.024, 6, 24), c.GOLD, [0,0,0], [HPI,0,0]); }, { mat:'g', outline:0.008, oc:'#6a4a10' });
  k.haloG.visible = false;
  k.tail = k.grp(k.hips, [-0.185, 0.08, 0]);
  k.part(k.tail, 'tail', (b)=>{ b.add(sph(0.085,10,7), c.FUR, [-0.05,0.05,0]); b.add(sph(0.06,8,6), c.FUR_L, [-0.1,0.1,0.02]); });
  k.extras(k.head, [0.12, 0.55, 0.3], 0.3, 0.8);
  k.sweat.scale.setScalar(0.5); k.stars.scale.setScalar(0.5);
  return k.rig(2.4, 0.8);
}
function poseKuro(k, e, P, T){
  const an = e.anim, p = animP(e), hit = e.animHit || 0.35;
  P.ex = 0;
  if(an==='idle' || an==='land'){ P.aRz = 0.55 + 0.05*Math.sin(T*0.07); P.aRx = 0.28; P.aLz = 0.35; }
  else if(an==='walk' || an==='run'){ P.aRz = 0.6; P.aRx = 0.3; }
  switch(an){
    case 'windup': { const q = U.easeOutCubic(p); P.aRz = lerp(0.5, 2.5, q); P.aRx = 0.35; P.aLz = lerp(0.3, 1.0, q); P.lean = 0.24*q; P.face = 'O'; break; }
    case 'atk1': case 'attack': { const u = strikeU(p, hit); P.aRz = lerp(2.6, 0.25, u); P.aRx = lerp(0.2, 0.7, u); P.twist = lerp(-0.25, 0.3, u); P.lean = lerp(0.18, -0.25, u);
      P.lLz = 0.35*u; P.lRz = -0.25*u; P.aLz = lerp(0.8, -0.2, u); P.hy = -P.twist*0.8; P.face = 'O'; break; }
    case 'atk2': case 'attack2': { const u = strikeU(p, hit); P.aRz = lerp(-0.6, 2.2, u); P.aRx = lerp(0.8, 0.3, u); P.twist = lerp(0.3, -0.25, u); P.lean = lerp(0.1, -0.2, u);
      P.lLz = -0.2*u; P.lRz = 0.3*u; P.hy = -P.twist*0.8; P.face = 'O'; break; }
    case 'atk3': { const u = strikeU(p, hit); P.aRz = lerp(3.0, 0.4, u); P.aRx = 0.35; P.aLz = lerp(2.4, 0.4, u); P.lean = lerp(0.3, -0.35, u); P.by = 0.06*U.bump(p, 0, hit);
      P.lLz = 0.4*u; P.lRz = -0.3*u; P.face = 'O'; break; }
    case 'atk4': { const u = strikeU(p, hit); P.aRz = lerp(-0.5, 3.0, u); P.aRx = 0.3; P.aLz = lerp(0.4, 2.2, u); P.lean = lerp(-0.15, 0.25, u);
      P.by = 0.06*U.bump(p, hit*0.8, 1); P.sy = 1 + 0.08*U.bump(p, hit*0.8, 1); P.lLz = 0.5*u; P.face = 'O'; break; }
    case 'special': { const u = strikeU(p, hit); P.aRz = lerp(2.8, 0.9, u); P.aRx = 0.5; P.aLz = lerp(0.3, 1.3, u); P.lean = lerp(0.25, -0.3, u); P.twist = lerp(-0.3, 0.25, u); P.face = 'O'; break; }
    case 'specialUp': { const q = U.smooth(p, 0.05, 0.3); P.aRz = lerp(0.2, 3.1, q); P.aRx = 0.3; P.aLz = lerp(0.3, 1.5, q); P.lLz = 0.9*q; P.lRz = 0.3; P.lean = 0.1; P.sy = 1 + 0.08*q; P.face = 'O'; break; }
    case 'specialDash': { if(p < 0.55){ k.ph += 0.6; const s = Math.sin(k.ph); P.lean = -0.42; P.aRz = -0.9; P.aRx = 0.45; P.aLz = 1.0; P.lLz = s*0.9; P.lRz = -s*0.9; P.face = 'O'; }
      else { P.aRz = 1.8; P.aRx = 0.5; P.lean = -0.2; P.lLz = 0.6; P.lRz = -0.3; } break; }
    case 'parry': { const q = U.smooth(p, 0, 0.18); P.aRz = lerp(0.55, 1.0, q); P.aRx = lerp(0.28, 0.55, q); P.ex = -0.14*q; P.aLz = 0.8; P.lean = 0.16; P.face = p < 0.55 ? 'O' : 'N';
      P.bx = -0.03*U.bump(p, 0, 0.3); break; }
    case 'roar': { P.aRz = 1.45; P.aRx = 0.35; P.aLz = -0.15; P.aLx = 0.5; P.lean = 0.05; P.hz = 0.1; break; }
    case 'cheer': P.aRz = 2.6 + 0.3*Math.sin(T*0.45); break;
  }
}
function applyKuro(k, e, C, T, P){
  applyBiped(k, e, C);
  k.sword.rotation.z = -1.9 + C.ex;
  const w = Math.sin(T*(P.wagSpd||0.1)*2.2);
  k.tail.rotation.set(w*C.wag*0.8, 0, 0.2 + C.wag*0.1);
  capeFlutter(k, e, C, T, 0.06);
  const freed = e.anim==='cheer' || !!e.freed;
  k.haloD.visible = !freed; k.haloG.visible = freed;
  k.halo.position.y = KL.headC + 0.331 + 0.1 + 0.02*Math.sin(T*0.06);
  k.halo.rotation.set(0.08*Math.sin(T*0.05), T*0.02, 0.1);
  const gl = e.atk || e.anim==='parry' ? 1.5 : 0.85 + 0.15*Math.sin(T*0.12);
  k.bmat.emissiveIntensity = gl;
}
// ---- kuroinu moves: the hero's own attack definitions (G.MOVES.inu), copied with his reach & a trail
const INU_FALLBACK = (()=>{   // used only if 55_player is not loaded (same numbers as G.MOVES.inu)
  const Hh = (o)=> Object.assign({ at:5, dur:3, x0:0.1, x1:1.3, zr:0.7, y0:0, y1:1.7, dmg:8, kb:0.06, stun:16, kind:'slash', power:1 }, o);
  return { combo:[ { id:'inu_a1', anim:'atk1', len:16, move:[{at:3,vx:0.07}], hits:[Hh({ at:5, dmg:8 })] },
    { id:'inu_a2', anim:'atk2', len:17, move:[{at:3,vx:0.07}], hits:[Hh({ at:5, dmg:9 })] },
    { id:'inu_a3', anim:'atk3', len:18, move:[{at:3,vx:0.08}], hits:[Hh({ at:6, dmg:10 })] },
    { id:'inu_a4', anim:'atk4', len:28, move:[{at:5,vx:0.12}], hits:[Hh({ at:9, dur:4, x0:0, x1:1.55, dmg:16, up:0.2, kb:0.16, power:2, stop:7 })] } ],
    sp:{ n:{ id:'inu_sn', anim:'special', len:26, proj:[{ at:8, kind:'wave', vx:0.32, dmg:12, r:0.55, pierce:3, life:55, power:2, up:0.08, oy:0.7 }] },
      up:{ id:'inu_su', anim:'specialUp', len:36, move:[{at:4, vy:0.24, vx:0.04}], hits:[Hh({ at:4, dur:14, rehit:6, x0:0, x1:1.25, y1:2.2, dmg:10, up:0.26, power:2 })] },
      fwd:{ id:'inu_sf', anim:'specialDash', len:30, inv:[2,18], move:[{at:3, vx:0.42, until:15}], hits:[Hh({ at:4, dur:13, x0:-0.6, x1:1.1, dmg:14, kb:0.1, power:2 })] } } };
})();
const KURO_REACH = 1.55, KURO_ATK = 1.25;
function kTrail(e){ if(G.fx && G.fx.trail) try { G.fx.trail(e, KTRAIL); } catch(err){ G.logError('bossB trail', err); } sfx('swing'); }
const KTRAIL = { auto:true, frames:16, color:'#c07aff' };
function deriveKuro(src, extra){
  const o = Object.assign({}, src);
  o.id = 'kuro_' + (src.id || 'x');
  o.hits = (src.hits || []).map((h)=> Object.assign({}, h, { x0:(h.x0==null?0.1:h.x0)*KURO_REACH, x1:(h.x1==null?1.3:h.x1)*KURO_REACH,
    zr:(h.zr==null?0.7:h.zr)*1.1, y1:(h.y1==null?1.7:h.y1)*1.5 }));
  o.move = src.move ? src.move.map((m)=> Object.assign({}, m)) : undefined;
  o.proj = undefined; o.inv = null; o.cancel = undefined;
  o.fn = function(e, t){ if(t===0) kTrail(e); };
  Object.assign(o, extra || {});
  return o;
}
function kWave(e, n){
  const y = e.y + 1.15, x = e.x + e.face*1.3;
  for(let i=0;i<n;i++){
    const vz = n > 1 ? (i - (n-1)/2)*0.05 : 0;
    const p = G.combat.shoot({ owner:e, kind:'wave', x, y, z:e.z, vx:e.face*0.3, vz, dmg:12*KURO_ATK, r:0.55, pierce:0, life:60, power:2, up:0.08, stun:18, kb:0.1 });
    customVis(p, 'kwave');
  }
  sfx('special'); fx('slash', x, y, e.z + 0.3, O.slashP);
}
let KD = null;
function kuroDefs(){
  if(KD) return KD;
  const mv = (G.MOVES && G.MOVES.inu && G.MOVES.inu.combo && G.MOVES.inu.sp) ? G.MOVES.inu : INU_FALLBACK;
  const cmb = mv.combo;
  const chainEnd = { onEnd: kComboNext };
  KD = {
    src: mv===INU_FALLBACK ? 'fallback' : 'G.MOVES.inu',
    a1: deriveKuro(cmb[0], chainEnd), a2: deriveKuro(cmb[1], chainEnd), a3: deriveKuro(cmb[2], chainEnd), a4: deriveKuro(cmb[3], chainEnd),
    wave: deriveKuro(mv.sp.n, { id:'kuro_wave', fn(e, t){ if(t===0) sfx('charge', { stop:true }); if(t===8){ kWave(e, 1); say(e, 'しんくうは！'); } }, onEnd(e){ after(e, 84); } }),
    wave3: deriveKuro(mv.sp.n, { id:'kuro_wave3', len:40, fn(e, t){ if(t===8){ kWave(e, 3); say(e, 'しんくうは・みつ！'); } if(t===14) G.setAnim(e, 'special', 26, 0.3); }, onEnd(e){ after(e, 90); } }),
    rise: deriveKuro(mv.sp.up, { onEnd(e){ after(e, 80); }, fn(e, t){ if(t===0){ kTrail(e); say(e, 'てんしょうざん！'); } } }),
    dash: deriveKuro(mv.sp.fwd, { onEnd(e){ if(e.lane) e.lane.on = false; after(e, 86); },
      fn(e, t){ if(t===0){ kTrail(e); say(e, 'しっそういあい！'); if(e.lane) e.lane.lock = true; }
        if(t>=3 && t<=15){ const nx = e.x + e.face*0.42; if(nx < xLo(e.radius) || nx > xHi(e.radius)) e.vx = 0; if(t%3===0){ O.trail.dir = -e.face; fx('dust', e.x - e.face*0.6, 0.05, e.z, O.trail); } }
        if(t===18 && e.lane) e.lane.on = false; } }),
    counter: deriveKuro(cmb[3], { id:'kuro_counter', onEnd(e){ after(e, 80); } }),
  };
  KD.seq1 = [KD.a1, KD.a2, KD.a4];
  KD.seq2 = [KD.a1, KD.a2, KD.a3, KD.a4];
  return KD;
}
function kComboNext(e){
  e.kidx = (e.kidx|0) + 1;
  if(e.kseq && e.kidx < e.kseq.length && !e.dead){
    const p = fh().target(e);
    if(p){ fh().face(e, p); e.vz = clamp((p.z - e.z)*0.1, -0.06, 0.06); }
    chain(e, e.kseq[e.kidx], e.phase ? 7 : 9, false);
  } else { e.kseq = null; after(e, 92); }
}
const KURO_INTRO = introRoar(84, '…おまえの けん、みせてもらおう');
function kuroBlock(e, info){
  // parry: ~25% of light hits from the front while he stands ready, then a counter-attack
  if(e.dead || e.type!=='kuroinu') return false;
  const ready = (e.state==='idle' || e.state==='move') && !e.atk && !e.pending && e.introDone;
  if(!ready || (info.power||1) > 1) return false;
  const src = info.src; if(!src) return false;
  if(U.sign(src.x - e.x) !== e.face) return false;
  if(e.parryT > 0){ e.flashT = 0; return true; }             // the guard holds for the whole stance

  if(G.time.tick < (e.parryUntil||0)) return false;
  if(rng() >= 0.25) return false;
  e.parryUntil = G.time.tick + 80;
  e.parryT = 22; e.counterDue = true; e.vx = 0; e.vz = 0;
  if(e.state==='move') G.setState(e, 'idle');
  G.setAnim(e, 'parry', 22);
  fx('guard', e.x + e.face*0.9, 1.3, e.z + 0.35, O.shock1); fx('sparkle', e.x + e.face*0.9, 1.3, e.z + 0.35, O.magic);
  e.parries = (e.parries|0) + 1;
  return true;
}
function kuroAI(e){
  const h = fh(), t = h.target(e), K = kuroDefs();
  pre(e); safety(e);
  if(!e.introDone){ e.introDone = true; if(t) h.face(e, t); h.attack(e, KURO_INTRO, 0); return; }
  if(!t){ h.stop(e); return; }
  if(e.parryT > 0){ e.parryT--; e.vx = 0; e.vz = 0; if(e.anim!=='parry') G.setAnim(e, 'parry', Math.max(1, e.parryT)); return; }
  if(e.counterDue){ e.counterDue = false; h.face(e, t);
    if(Math.abs(t.x - e.x) < 3.2 && h.token(e) && h.attack(e, K.counter, 18)){ say(e, 'みきった！'); e.lastMove = 'counter'; return; } }
  if(phaseCheck(e)) return;
  h.face(e, t);
  if(e.cool > 0){ hover(e, t, 3.1, 0.75); return; }
  const dx = t.x - e.x, adx = Math.abs(dx), adz = Math.abs(t.z - e.z), sd = dx > 0 ? -1 : 1;
  const air = t.y > 0.5;
  const dashEnd = e.x + (dx > 0 ? 1 : -1)*6;
  const dashOK = dashEnd > xLo(e.radius) - 0.5 && dashEnd < xHi(e.radius) + 0.5;
  if(!e.plan){
    _mn.length = 0; _mw.length = 0;
    opt('combo', adx < 3.5 ? 5 : 2); opt('wave', adx > 3 ? 4 : 1); opt('rise', air && adx < 2.8 ? 8 : (adx < 2.2 ? 1.5 : 0.3));
    opt('dash', adx > 3 && dashOK ? 3 : 0); opt('wave3', e.phase ? (adx > 2.5 ? 3.5 : 1) : 0);
    e.plan = pick(e); e.planT = 0;
  }
  if(++e.planT > 170){ log('timeout:' + e.plan); e.plan = null; e.cool = 20; return; }
  switch(e.plan){
    case 'combo': if(adx < 2.3 && adz < 0.4){ e.kseq = e.phase ? K.seq2 : K.seq1; e.kidx = 0; if(!go(e, e.kseq[0], e.phase ? 20 : 24)) e.kseq = null; }
      else approach(e, t.x + sd*1.8, t.z); break;
    case 'wave': if(adx > 2.6 && adz < 0.35) go(e, K.wave, 30); else approach(e, t.x + sd*4.6, t.z); break;
    case 'wave3': if(adx > 2.6) go(e, K.wave3, 30); else approach(e, t.x + sd*4.6, t.z); break;
    case 'rise': if(adx < 2.3 && adz < 0.5) go(e, K.rise, 22); else approach(e, t.x + sd*1.5, t.z); break;
    case 'dash': if(adx > 3 && adx < 6.5 && adz < 0.3 && dashOK){ if(go(e, K.dash, 32)) laneOn(e, e.x + e.face*0.6, e.x + e.face*6.2, e.z, 1.0); }
      else approach(e, t.x + sd*4.8, t.z); break;
    default: e.plan = null;
  }
}

// ================================================================ 4) ダークワンワンたいてい → あんこくナイト
const STAFF0 = 0.55;
const EMP = { FUR:'#2b2631', FUR_L:'#4e4659', MUZ:'#645b70', CAPE:'#6d2aa8', CAPE_D:'#43166e', TRIM:'#fbf8ff', DOT:'#1e1a22',
  GOLD:'#ffc93a', GOLD_D:'#d9951c', RUBY:'#ff2a4a', SAPH:'#3aa8ff', ORB:'#c890ff', VEL:'#b0203a', EYE:'#ff3b3b', BROW:'#f4eefc' };
function buildEmperor(){
  const c = EMP;
  const k = new Kit({ type:'emperor', gkey:'emperor', lie:0.9, sit:0.4, pose:poseEmperor, apply:applyEmperor, beamCol:'#b060ff', beamCore:'#fff0ff', ol:0.03 });
  k.bmat = k.glow('#9a3aff', 0.9);
  const legFill = (b)=>{ b.add(sph(0.3,16,12), c.FUR, [0.1,-0.12,0], null, [1.35,0.72,1.12]); b.add(sph(0.1,8,6), '#ff9fb5', [0.44,-0.15,0], null, [0.4,0.8,1]); };
  k.legL = k.grp(k.body, [0.05, 0.3, -0.46]); k.legR = k.grp(k.body, [0.05, 0.3, 0.46]);
  k.part(k.legL, 'leg', legFill); k.part(k.legR, 'leg', legFill);
  k.hips = k.grp(k.body, [0, 0.25, 0]);
  const TS = { c:[0,0.95,0], r:[1.05,1.0,1.02] };
  k.part(k.hips, 'torso', (b)=>{
    b.add(sph(1.0,24,16), c.FUR, TS.c, null, TS.r);
    b.add(sph(0.8,20,14), c.FUR_L, [0.44,0.86,0], null, [0.58,0.92,0.95]);
    for(let i=0;i<3;i++) feat(b, TS, 0, 0.35 - i*0.3, 0.0, sph(0.07,10,8), c.GOLD, [1,1,0.6]);
    b.add(tor(0.93, 0.075, 8, 30), c.GOLD, [0,0.46,0], [HPI,0,0]);
    b.add(sph(0.12,12,10), c.RUBY, [0.95,0.46,0], null, [0.5,1,1]);
    // ermine collar (white fluff with little black dots)
    for(let i=0;i<12;i++){ const a = i/12*TAU; b.add(sph(0.22,12,8), c.TRIM, [Math.cos(a)*0.66, 1.78 + 0.03*Math.sin(a*3), Math.sin(a)*0.66], null, [1,0.85,1]);
      if(i%3===1 && Math.cos(a) < 0.2) b.add(sph(0.035,6,4), c.DOT, [Math.cos(a)*0.87, 1.76, Math.sin(a)*0.87], null, [0.6,1.5,0.6]); }
  });
  k.cape = k.grp(k.hips, [-0.35, 1.8, 0]);
  k.part(k.cape, 'cape', (b)=>{
    b.add(cyl(0.62, 1.28, 1.85, 22), c.CAPE, [-0.12,-0.95,0], null, [0.5,1,1]);
    b.add(cyl(0.58, 1.22, 1.8, 18), c.CAPE_D, [-0.02,-0.93,0], null, [0.36,1,1]);
    for(let i=0;i<11;i++){ const a = HPI + 0.25 + i/10*(Math.PI - 0.5); b.add(sph(0.13,10,8), c.TRIM, [-0.12 + Math.cos(a)*0.64, -1.84, Math.sin(a)*1.26], null, [1,0.8,1]);
      if(i%2) b.add(sph(0.03,6,4), c.DOT, [-0.12 + Math.cos(a)*0.72, -1.82, Math.sin(a)*1.38]); }
  });
  const armFill = (b)=>{ b.add(cap(0.2, 0.28), c.FUR, [0,-0.24,0]); b.add(tor(0.19, 0.08, 8, 18), c.TRIM, [0,-0.44,0], [HPI,0,0]); b.add(sph(0.24,14,10), c.FUR, [0.03,-0.6,0]); };
  k.armL = k.grp(k.hips, [0.2, 1.45, -0.98]); k.armR = k.grp(k.hips, [0.2, 1.45, 0.98]);
  k.part(k.armL, 'arm', armFill); k.part(k.armR, 'arm', armFill);
  // staff in the camera-side hand: gold shaft (gloss) + glowing orb
  k.staff = k.grp(k.armR, [0.05, -0.62, 0]); k.staff.rotation.z = -STAFF0;
  k.part(k.staff, 'staff', (b)=>{ b.add(cyl(0.055, 0.065, 1.9, 10), c.GOLD, [0,-0.2,0]); b.add(sph(0.09,10,8), c.GOLD_D, [0,-1.17,0]);
    b.add(tor(0.075, 0.03, 6, 12), c.GOLD_D, [0,-0.55,0], [HPI,0,0]); b.add(tor(0.075, 0.03, 6, 12), c.GOLD_D, [0,0.55,0], [HPI,0,0]);
    b.add(cyl(0.1, 0.05, 0.16, 10), c.GOLD, [0,0.8,0]);
    for(let i=0;i<3;i++){ const a = i/3*TAU; b.add(cone(0.05, 0.34, 6), c.GOLD, [Math.cos(a)*0.18, 1.0, Math.sin(a)*0.18], [Math.sin(a)*0.5, 0, -Math.cos(a)*0.5]); }
  }, { mat:'g', oc:'#5a3a10', outline:0.02 });
  k.part(k.staff, 'orb', (b)=>{ b.add(sph(0.3,16,12), c.ORB, [0,1.1,0]); b.add(sph(0.08,8,6), WHITE, [0.12,1.22,0.15], null, [1,0.7,0.5]); }, { mat:'b', outline:0.016, oc:'#2a0a4a' });
  k.tip.position.set(0, 1.1, 0); k.staff.add(k.tip); k.base.position.set(0, 0.2, 0); k.staff.add(k.base);
  // head
  k.head = k.grp(k.hips, [0.12, 1.95, 0]);
  const HS = { c:[0,0.6,0], r:[0.92,0.81,0.9] }, MZ = { c:[0.74,0.33,0], r:[0.3,0.23,0.4] };
  k.part(k.head, 'head', (b)=>{
    b.add(sph(0.9,24,16), c.FUR, HS.c, null, [1.02,0.9,1.0]);
    b.add(sph(0.34,16,12), c.MUZ, MZ.c, null, [0.9,0.68,1.18]);
    b.add(sph(0.1,10,8), '#0e0a10', [1.03,0.45,0], null, [0.8,0.75,1.1]); b.add(sph(0.03,6,4), WHITE, [1.1,0.5,0.04]);
    for(const s of [-1,1]){
      // curly white moustache
      b.add(sph(0.14,12,8), c.TRIM, [0.98,0.3,s*0.17], [s*0.3,0,-0.2], [0.8,0.55,1.3]);
      b.add(sph(0.09,10,6), c.TRIM, [0.92,0.36,s*0.4], [s*0.6,0,0.3], [0.7,0.6,1.1]);
      // pointy ears
      b.add(cone(0.24,0.5,10), c.FUR, [-0.12,1.3,s*0.52], [s*0.45,0,0.1], [0.55,1,1]);
      b.add(cone(0.14,0.32,8), c.CAPE, [-0.07,1.26,s*0.5], [s*0.45,0,0.1], [0.35,1,1]);
    }
    blush(b, HS, -0.52, -0.18, 0.12, '#d0708e'); blush(b, HS, 0.52, -0.18, 0.12, '#d0708e');
  });
  k.crown = k.grp(k.head, [-0.05, 1.33, 0]); k.crown.rotation.z = 0.12;
  k.part(k.crown, 'crown', (b)=>{
    b.add(sph(0.4,14,10), c.VEL, [0,0.1,0], null, [1,0.7,1]);
    b.add(cyl(0.44, 0.48, 0.3, 22), c.GOLD, [0,0,0]);
    b.add(tor(0.47, 0.045, 6, 24), c.GOLD_D, [0,-0.13,0], [HPI,0,0]);
    for(let i=0;i<5;i++){ const a = i/5*TAU; b.add(cone(0.11,0.28,8), c.GOLD, [Math.cos(a)*0.44, 0.28, Math.sin(a)*0.44]); b.add(sph(0.06,8,6), c.GOLD, [Math.cos(a)*0.44, 0.44, Math.sin(a)*0.44]); }
    b.add(sph(0.12,12,10), c.RUBY, [0.48,0.02,0], null, [0.55,1,1]); b.add(sph(0.04,6,4), WHITE, [0.53,0.07,0.04]);
    b.add(sph(0.06,8,6), c.SAPH, [0.3,0.02,0.37], null, [0.8,1,0.8]); b.add(sph(0.06,8,6), c.SAPH, [0.3,0.02,-0.37], null, [0.8,1,0.8]);
  }, { mat:'g', outline:0.022, oc:'#5a3a10' });
  const eu = 0.3, ev = 0.07, es = 0.14;
  const eo = { white:c.EYE, pupilC:'#2a0610', browC:c.BROW, tilt:0.5, browW:0.3, browUp:1.3 };
  k.faceSet(k.head, 'e', {
    N:(b)=>{ eyeAngry(b, HS, -eu, ev, es, eo); eyeAngry(b, HS, eu, ev, es, eo); mFrown(b, MZ, 0, -0.12, 0.08);
      feat(b, MZ, -0.1, -0.14, 0.012, cone(0.024,0.07,6), WHITE, [1,1,0.6], Math.PI); feat(b, MZ, 0.1, -0.14, 0.012, cone(0.024,0.07,6), WHITE, [1,1,0.6], Math.PI); },
    B:(b)=>{ eyeLine(b, HS, -eu, ev, es, 0.25); eyeLine(b, HS, eu, ev, es, 0.25); mFrown(b, MZ, 0, -0.12, 0.08);
      for(let s=-1;s<=1;s+=2) feat(b, HS, s*eu + (s<0?1:-1)*es*0.12, ev + es*1.3, es*0.1, cap(es*0.3, es*1.05, 2, 6), c.BROW, [1,1,0.55], HPI - (s<0?1:-1)*0.5); },
    O:(b)=>{ eyeAngry(b, HS, -eu, ev, es, Object.assign({}, eo, { tilt:0.62, pupil:0.46 })); eyeAngry(b, HS, eu, ev, es, Object.assign({}, eo, { tilt:0.62, pupil:0.46 })); mOpen(b, MZ, 0, -0.12, 0.15, 0.11, true); },
    S:(b)=>{ eyeSqueeze(b, HS, -eu, ev, es, '#f0e8f8'); eyeSqueeze(b, HS, eu, ev, es, '#f0e8f8'); mO(b, MZ, 0, -0.12, 0.05); },
    X:(b)=>{ eyeX(b, HS, -eu, ev, es, '#f0e8f8'); eyeX(b, HS, eu, ev, es, '#f0e8f8'); mWavy(b, MZ, 0, -0.12, 0.09); },
    H:(b)=>{ eyeArc(b, HS, -eu, ev, es, false, '#fff0f4'); eyeArc(b, HS, eu, ev, es, false, '#fff0f4'); mOpen(b, MZ, 0, -0.12, 0.12, 0.08, false);
      blush(b, HS, -0.52, -0.16, 0.15, '#ff8fb0'); blush(b, HS, 0.52, -0.16, 0.15, '#ff8fb0'); },
  });
  k.tail = k.grp(k.hips, [-1.0, 0.45, 0]);
  k.part(k.tail, 'tail', (b)=>{ b.add(sph(0.2,12,10), c.FUR, [-0.1,0.1,0]); b.add(sph(0.14,10,8), c.FUR_L, [-0.2,0.22,0]); });
  k.extras(k.head, [0.4, 1.35, 0.8], 0.9, 1.9);
  return k.rig(3.3, 1.2);
}
function poseEmperor(k, e, P, T){
  const an = e.anim, p = animP(e), hit = e.animHit || 0.35;
  P.ex = 0;
  if(an==='idle' || an==='land' || an==='walk' || an==='run'){ P.aRz = 0.42 + 0.04*Math.sin(T*0.07); P.aRx = 0.5; P.ex = 0.18; }
  switch(an){
    case 'windup': { const q = U.easeOutCubic(p); P.aRz = lerp(0.3, 2.3, q); P.ex = -0.6*q; P.aLz = 0.9*q; break; }
    case 'attack': { const u = strikeU(p, hit); P.aRz = lerp(2.5, 0.9, u); P.ex = lerp(-0.8, -2.5, u); P.aRx = lerp(0.2, 0.55, u); P.aLz = lerp(0.8, -0.2, u);
      P.twist = lerp(-0.2, 0.2, u); P.lean = lerp(0.2, -0.25, u); break; }
    case 'shoot': case 'special': { const q = U.smooth(p, 0, 0.25); P.aRz = lerp(0.6, 1.45, q); P.ex = lerp(0, -2.5, q); P.aRx = 0.35; P.aLz = 0.6; P.lean = 0.12*q;
      P.face = 'O'; if(an==='special') P.bx = Math.sin(T*1.9)*0.02*(e.beam && e.beam.charge > 0 && !e.beam.on ? 1 : 0); break; }
    case 'roar': P.aRz = 2.6; P.ex = -0.4; P.aLz = 2.2; break;
    case 'jump': case 'fall': P.aRz = 1.6; P.ex = -1.2; break;
  }
}
function applyEmperor(k, e, C, T, P){
  applyBiped(k, e, C);
  k.staff.rotation.z = -STAFF0 + C.ex;
  k.tail.rotation.set(Math.sin(T*(P.wagSpd||0.1)*2.2)*C.wag*0.5, 0, 0.2);
  capeFlutter(k, e, C, T, 0.03);
  const ch = e.beam ? e.beam.charge : 0;
  k.bmat.emissiveIntensity = 0.8 + 0.25*Math.sin(T*0.1) + ch*2.2 + (e.beam && e.beam.on ? 1.5 : 0);
  k.crown.rotation.z = 0.12 + 0.05*Math.sin(T*0.06) - k.sqy*0.3;
}
// ---- あんこくナイト (form 2 rig)
const KN = { ARM:'#3c3c58', ARM_L:'#6c6c92', ARM_D:'#191924', VISOR:'#160c22', GOLD:'#e8b840', RED:'#ff1a2e', CAPE:'#3a1650', CAPE_L:'#9a1c34', BLADE:'#ff3040', PLUME:'#d0303e', FUR:'#2b2631' };
function buildKnight(){
  const c = KN;
  const k = new Kit({ type:'knight', gkey:'knight', lie:0.5, sit:0.4, pose:poseKnight, apply:applyKnight, beamCol:'#ff2a3a', beamCore:'#fff0f0', ol:0.028, oc:'#140c18', rough:0.42 });
  k.bmat = k.glow('#ff1a1a', 1.0);
  k.emat = k.glow('#ff0014', 0.9);
  const legFill = (b)=>{ b.add(cap(0.17, 0.14), c.ARM, [0,-0.18,0]); b.add(sph(0.12,10,8), c.ARM_L, [0.08,-0.1,0]);
    b.add(sph(0.24,16,12), c.ARM_D, [0.08,-0.38,0], null, [1.35,0.7,1.1]); b.add(tor(0.17, 0.03, 6, 16), c.GOLD, [0.02,-0.28,0], [HPI,0,0]); };
  k.legL = k.grp(k.body, [0, 0.45, -0.3]); k.legR = k.grp(k.body, [0, 0.45, 0.3]);
  k.part(k.legL, 'leg', legFill); k.part(k.legR, 'leg', legFill);
  k.hips = k.grp(k.body, [0, 0.45, 0]);
  k.part(k.hips, 'torso', (b)=>{
    b.add(sph(0.62,22,16), c.ARM, [0,0.6,0], null, [0.95,1.08,0.95]);
    b.add(sph(0.5,18,12), c.ARM_L, [0.24,0.74,0], null, [0.5,0.78,0.88]);
    b.add(sph(0.1,12,10), c.RED, [0.5,0.8,0], null, [0.6,1,1]);
    b.add(tor(0.54, 0.06, 8, 26), c.ARM_D, [0,0.22,0], [HPI,0,0]);
    b.add(rbox(0.09, 0.14, 0.18, 0.03), c.GOLD, [0.55,0.22,0]);
    for(let i=0;i<5;i++){ const a = -1.1 + i*0.55; b.add(sph(0.2,12,8), c.ARM_L, [Math.cos(a)*0.5, 0.06, Math.sin(a)*0.5], [0,-a,0], [0.4,0.8,1.0]); }
    for(const s of [-1,1]){ b.add(sph(0.3,16,12), c.ARM_L, [0,1.12,s*0.55], null, [1,0.72,1]); b.add(tor(0.27, 0.035, 6, 20), c.GOLD, [0,1.05,s*0.55], [HPI,0,0]);
      b.add(cone(0.07,0.22,8), c.ARM_D, [0,1.3,s*0.62], [s*0.4,0,0]); }
  });
  k.cape = k.grp(k.hips, [-0.3, 1.2, 0]);
  k.part(k.cape, 'cape', (b)=>{ b.add(cyl(0.42, 0.85, 1.35, 18), c.CAPE, [-0.05,-0.68,0], [0,0,0.04], [0.4,1,1]);
    b.add(cyl(0.38, 0.8, 1.3, 14), c.CAPE_L, [0.03,-0.66,0], [0,0,0.04], [0.28,1,1]); });
  const armFill = (b)=>{ b.add(cap(0.14, 0.22), c.ARM, [0,-0.2,0]); b.add(sph(0.19,14,10), c.ARM_L, [0.02,-0.45,0]); b.add(tor(0.14, 0.03, 6, 14), c.GOLD, [0,-0.32,0], [HPI,0,0]); };
  k.armL = k.grp(k.hips, [0.05, 1.02, -0.64]); k.armR = k.grp(k.hips, [0.05, 1.02, 0.64]);
  k.part(k.armL, 'arm', armFill); k.part(k.armR, 'arm', armFill);
  k.sword = k.grp(k.armR, [0.02, -0.48, 0]); k.sword.rotation.z = -1.9;
  k.part(k.sword, 'hilt', (b)=>{ b.add(cap(0.05, 0.2, 3, 8), c.ARM_D, [0,0,0]); b.add(sph(0.07,8,6), c.GOLD, [0,-0.16,0]);
    b.add(rbox(0.44, 0.08, 0.1, 0.03), c.GOLD, [0,0.15,0]); b.add(sph(0.06,8,6), c.RED, [0,0.15,0.05]); });
  k.part(k.sword, 'blade', (b)=>{ b.add(rbox(0.17, 1.45, 0.05, 0.02), c.BLADE, [0,0.93,0]); b.add(cone(0.085, 0.24, 4), c.BLADE, [0,1.77,0], null, [1,1,0.3]);
    b.add(G.look.geo.box(0.03, 1.3, 0.06), '#ffd8d8', [0,0.93,0]); }, { mat:'b', outline:0.012, oc:'#5a0a10' });
  k.tip.position.set(0, 1.85, 0); k.sword.add(k.tip); k.base.position.set(0, 0.25, 0); k.sword.add(k.base);
  k.head = k.grp(k.hips, [0.05, 1.25, 0]);
  const HS = { c:[0,0.55,0], r:[0.734,0.69,0.734] }, VS = { c:[0,0.55,0], r:[0.734,0.69,0.734] };
  k.part(k.head, 'head', (b)=>{
    b.add(sph(0.72,24,16), c.ARM, HS.c, null, [1.02,0.96,1.02]);
    feat(b, HS, 0, -0.02, -0.035, sph(0.44,18,12), c.VISOR, [1.35, 0.72, 0.14]);             // dark face window (flat)
    feat(b, HS, 0, 0.26, 0.0, rbox(0.1, 0.3, 0.1, 0.03), c.ARM_L, [1,1,1]);                  // nose guard
    for(const s2 of [-1,1]) feat(b, HS, s2*0.55, -0.3, -0.02, sph(0.2,12,8), c.ARM_L, [0.9,1.1,0.5]);   // cheek guards
    b.add(rbox(0.16, 0.2, 1.2, 0.07), c.ARM_L, [0.02,1.02,0], [0,0,0.1]);
    b.add(tor(0.72, 0.045, 6, 28, Math.PI), c.GOLD, [0,0.55,0], [0,0,HPI], [1,0.95,1]);
    for(const s of [-1,1]){ b.add(cone(0.14, 0.62, 10), c.ARM_D, [-0.05,1.2,s*0.5], [s*0.55,0,0.25]); b.add(cone(0.06, 0.16, 8), c.GOLD, [-0.12,1.5,s*0.66], [s*0.55,0,0.25]); }
    for(let i=0;i<4;i++) b.add(sph(0.14 - i*0.012,10,8), c.PLUME, [-0.1 - i*0.16, 1.24 - i*0.07, 0], null, [1,1.2,0.7]);
  });
  const eu = 0.25, ev = -0.02, es = 0.17, EL = 0.05;
  k.faceSet(k.head, 'n', {
    N:(b)=>{ eyeTri(b, VS, -eu, ev, es, c.RED, EL); eyeTri(b, VS, eu, ev, es, c.RED, EL); },
    B:(b)=>{ eyeLine(b, VS, -eu, ev, es, 0.3, EL); eyeLine(b, VS, eu, ev, es, 0.3, EL); },
    O:(b)=>{ eyeTri(b, VS, -eu, ev, es*1.2, c.RED, EL); eyeTri(b, VS, eu, ev, es*1.2, c.RED, EL); },
    S:(b)=>{ eyeSqueeze(b, VS, -eu, ev, es, c.RED, EL); eyeSqueeze(b, VS, eu, ev, es, c.RED, EL); },
    X:(b)=>{ eyeX(b, VS, -eu, ev, es, c.RED, EL); eyeX(b, VS, eu, ev, es, c.RED, EL); },
    H:(b)=>{ eyeArc(b, VS, -eu, ev, es, false, '#ff9ac0', EL); eyeArc(b, VS, eu, ev, es, false, '#ff9ac0', EL); },
  }, k.emat);
  k.tail = k.grp(k.hips, [-0.6, 0.28, 0]);
  k.part(k.tail, 'tail', (b)=>{ b.add(sph(0.14,10,8), c.FUR, [-0.06,0.06,0]); b.add(sph(0.1,8,6), '#4e4659', [-0.14,0.14,0]); });
  k.extras(k.head, [0.35, 1.25, 0.66], 0.8, 1.75);
  return k.rig(3.0, 1.0);
}
function poseKnight(k, e, P, T){
  const an = e.anim, p = animP(e), hit = e.animHit || 0.35;
  P.ex = 0;
  if(an==='idle' || an==='land'){ P.aRz = 0.55 + 0.05*Math.sin(T*0.07); P.aRx = 0.3; P.aLz = 0.3; }
  else if(an==='walk' || an==='run'){ P.aRz = 0.6; P.aRx = 0.3; }
  switch(an){
    case 'windup': { const q = U.easeOutCubic(p); P.aRz = lerp(0.5, 2.5, q); P.aRx = 0.4; P.aLz = lerp(0.3, 1.0, q); P.lean = 0.22*q; break; }
    case 'attack': { const u = strikeU(p, hit); P.aRz = lerp(2.6, 0.25, u); P.aRx = lerp(0.2, 0.7, u); P.twist = lerp(-0.25, 0.3, u); P.lean = lerp(0.18, -0.25, u); P.face = 'O'; break; }
    case 'attack2': {                                                // spinning slash: blade held out, body turning
      const q = U.smooth(p, 0.08, 0.2)*(1 - U.smooth(p, 0.82, 0.95));
      P.aRz = lerp(0.5, 1.5, q); P.aRx = lerp(0.3, 1.1, q); P.aLz = lerp(0.3, 1.3, q); P.aLx = 1.0*q; P.lean = -0.08;
      k.spinT = (k.spinT||0) + (q > 0.5 ? 0.42 : 0); P.spin = q > 0.05 ? k.spinT : 0; if(!P.spin) k.spinT = 0; P.face = 'O'; break; }
    case 'special': { const q = U.smooth(p, 0, 0.2); P.aRz = lerp(0.5, 2.35, q); P.ex = lerp(0, -0.3, q); P.aRx = 0.2; P.aLz = lerp(0.3, 2.2, q); P.hz = 0.2*q; P.lean = 0.1*q; P.face = 'O'; break; }
    case 'shoot': { const q = U.smooth(p, 0, 0.25); P.aRz = lerp(0.5, 1.5, q); P.ex = lerp(0, -1.2, q); P.aRx = 0.3; P.aLz = 1.4*q; P.lean = 0.1; P.face = 'O';
      P.bx = Math.sin(T*1.9)*0.02*(e.beam && e.beam.charge > 0 && !e.beam.on ? 1 : 0); break; }
    case 'dash': { if(p < 0.5){ k.ph += 0.6; const s = Math.sin(k.ph); P.lean = -0.45; P.aRz = -0.9; P.aRx = 0.5; P.aLz = 1.0; P.lLz = s*0.9; P.lRz = -s*0.9; P.face = 'O'; }
      else { P.aRz = 1.8; P.aRx = 0.5; P.lean = -0.2; P.lLz = 0.6; P.lRz = -0.3; } break; }
    case 'roar': P.aRz = 2.9; P.aRx = 0.2; P.aLz = 2.2; P.hz = 0.25; break;
    case 'rise': { const q = U.easeOutCubic(p); P.by = -0.9*(1 - q); P.sy = lerp(0.6, 1, q); P.sx = lerp(1.2, 1, q); P.aLz = P.aRz = lerp(2.4, 0.5, q); P.face = q < 0.5 ? 'B' : 'N'; break; }
  }
}
function applyKnight(k, e, C, T, P){
  applyBiped(k, e, C);
  k.sword.rotation.z = -1.9 + C.ex;
  k.tail.rotation.set(Math.sin(T*(P.wagSpd||0.1)*2.2)*C.wag*0.6, 0, 0.2);
  capeFlutter(k, e, C, T, 0.06);
  const ch = e.beam ? e.beam.charge : 0;
  k.bmat.emissiveIntensity = 1.0 + 0.2*Math.sin(T*0.15) + ch*1.5 + (e.atk ? 0.6 : 0);
  k.emat.emissiveIntensity = 0.8 + 0.25*Math.sin(T*0.2);
}
// ---- emperor / knight moves
function beamStart(e, line){
  const B = e.beam, dir = e.face;
  B.on = false; B.charge = 0.01; B.dir = dir; B.z = e.z; B.t = 0; B.len = 18;
  B.x0 = e.x + dir*(e.form===2 ? 1.9 : 1.7); B.y = 0.8;
  const far = dir > 0 ? xHi(0) + 3 : xLo(0) - 3;
  B.x1 = dir > 0 ? Math.max(B.x0 + 6, far) : Math.min(B.x0 - 6, far);
  laneOn(e, B.x0, B.x1, e.z, 1.15);
  if(line) say(e, line);
  sfx('charge');
}
function beamHit(e){
  const B = e.beam, a = Math.min(B.x0, B.x1), b = Math.max(B.x0, B.x1), L = b - a;
  const n = Math.max(1, Math.ceil(L/1.6)), seg = L/n;
  for(let i=0;i<n;i++) G.combat.area({ owner:e, x:a + seg*(i+0.5), y:0, z:B.z, r:seg*0.62, zr:0.42, y0:0.1, y1:1.2, dmg: e.form===2 ? 15 : 14,
    kb:0.14, up:0.12, stun:22, power:2, kind:'magic', dur:2, dir:B.dir });
}
function beamFn(e, t){
  const B = e.beam, CH = 40;
  if(t===0){ G.setAnim(e, e.form===2 ? 'shoot' : 'special', 84, 0.5); beamStart(e, e.form===2 ? 'きえろ〜っ！' : 'ダーク ビーム！'); }
  if(t < CH){ B.charge = Math.max(0.01, t/CH); if(t%5===0) fx('magic', B.x0, B.y, B.z + 0.2, e.form===2 ? O.magicR : O.magic); if(t===CH-12 && e.lane) e.lane.lock = true; }
  if(t===CH){ B.on = true; B.charge = 1; B.t = 0; sfx('special'); shake(3, 24); if(G.fx && G.fx.flash) G.fx.flash(e.form===2 ? '#ff9090' : '#e0b0ff', 0.25, 8); }
  if(B.on){ B.t = t - CH; if(B.t % 6 === 0) beamHit(e); if(B.t % 3 === 0) fx('sparkle', lerp(B.x0, B.x1, rng()), B.y, B.z + 0.3, e.form===2 ? O.magicR : O.spark); }
  if(t===CH + B.len){ B.on = false; B.charge = 0; if(e.lane) e.lane.on = false; }
}
function summonFn(e, t){
  if(t===0){ G.setAnim(e, 'roar', 70, 0.3); say(e, 'ものども、であえ〜！'); }
  if(t===20){ sfx('bossRoar'); shake(2.5, 18); }
  if(t===26){
    e.minions = (e.minions || []).filter((m)=> m && !m.dead && !m.removed && !m.removeMe);
    const type = G.foes.types.wanhei ? 'wanhei' : 'slimelet';
    for(let i=0;i<2;i++){
      if(e.minions.length >= 2) break;
      const x = clampX(e.x + (i ? -2.8 : 2.8), 0.5), z = clampZ(e.z + (i ? 0.9 : -0.9));
      const m = fh().spawnMinion(type, x, z);
      if(m){ m.summoner = e; e.minions.push(m); fx('smoke', x, 0.5, z, O.smoke); }
    }
    e.summons = (e.summons|0) + 1;
  }
}
function pressFn(e, t){
  if(t===0){
    const p = fh().target(e), air = 44;
    const tx = p ? clampX(p.x, e.radius) : e.x, tz = p ? clampZ(p.z) : e.z;
    const dx = clamp(tx - e.x, -4.5, 4.5), dz = clamp(tz - e.z, -1.8, 1.8);
    e.pressVx = dx/air; e.pressVz = dz/air; e.pressLand = false; e.pressUp = 0;
    e.hopMark = markOn(e, e.x + dx, e.z + dz, 2.2, true);
    e.vy = 0.006*air; e.onGround = false; G.setAnim(e, 'jump'); say(e, 'おうさま プレス！'); sfx('jump'); G.bus.emit('jump', { ent:e });
    fx('dust', e.x, 0.05, e.z, O.dust12);
  }
  if(!e.pressLand){ e.pressUp++; e.vx = e.pressVx; e.vz = e.pressVz;
    if(e.pressUp > 4 && e.onGround){
      e.pressLand = true; e.vx = 0; e.vz = 0;
      if(e.hopMark){ e.hopMark.on = false; e.hopMark = null; }
      G.combat.area({ owner:e, x:e.x, z:e.z, r:2.2, zr:1.3, y0:-0.5, y1:1.8, dmg:17, kb:0.18, up:0.26, stun:24, power:2, kind:'blunt', dur:3 });
      fx('shock', e.x, 0.02, e.z, O.shockP); fx('dust', e.x, 0.1, e.z, O.dust12); shake(7, 28); sfx('hitBig'); say(e, 'ずしーん！'); G.setAnim(e, 'land', 14);
    } }
}
const EMP_M = {
  intro: introRoar(96, 'ワンワンていこくの ちからを おもいしれ！', (e, t)=>{ if(t===24) fx('smoke', e.x, 1.2, e.z, O.smokeBig); }),
  swipe: { id:'emp_swipe', anim:'attack', len:48, move:[{ at:10, vx:0.08 }],
    hits:[ H({ at:14, dur:5, x0:-0.6, x1:3.0, zr:0.95, y0:0, y1:2.8, dmg:14, kb:0.18, up:0.16, stun:22, power:2, kind:'magic' }) ],
    fn(e, t){ if(t===0) G.setAnim(e, 'attack', 48, 0.3); if(t===10){ sfx('swing'); if(G.fx && G.fx.trail) G.fx.trail(e, ETRAIL); }
      if(t===14){ O.slashP.dir = e.face; fx('slash', e.x + e.face*1.9, 1.6, e.z + 0.4, O.slashP); say(e, 'えいっ！'); } },
    onEnd(e){ after(e, 84); } },
  orbs: { id:'emp_orbs', anim:'shoot', len:54, hits:[],
    fn(e, t){ if(t===0){ G.setAnim(e, 'shoot', 54, 0.3); say(e, 'やみの たま！'); }
      if(t===16){ const p = fh().target(e), aim = p ? clamp((p.z - e.z)/60, -0.02, 0.02) : 0, x0 = e.x + e.face*2.2;
        for(let i=-2;i<=2;i++) G.combat.shoot({ owner:e, kind:'shadow', x:x0, y:1.15, z:e.z, vx:e.face*0.085, vz:aim + i*0.03, vy:0, grav:0, dmg:12, r:0.45, life:150, power:1, stun:20, kb:0.1 });
        sfx('shoot', { pitch:0.6 }); fx('magic', x0, 1.3, e.z + 0.3, O.magic); } },
    onEnd(e){ after(e, 84); } },
  beam: { id:'emp_beam', anim:'special', len:84, hits:[], fn: beamFn, onEnd(e){ marksOff(e); after(e, 92); } },
  summon: { id:'emp_summon', anim:'roar', len:70, hits:[], noAlert:true, fn: summonFn, onEnd(e){ after(e, 60); } },
  press: { id:'emp_press', anim:'jump', len:96, hits:[], fn: pressFn, onEnd(e){ cleanup(e); after(e, 80); } },
};
const ETRAIL = { auto:true, frames:14, color:'#c890ff' }, NTRAIL = { auto:true, frames:16, color:'#ff5a5a' };
function skyFn(e, t){
  const p = fh().target(e), N = e.phase ? 6 : 5, GAP = e.phase ? 14 : 18, WARN = 42;
  if(t===0){ G.setAnim(e, 'special', 150, 0.3); say(e, 'やみの つるぎよ、ふりそそげ！'); e.skyI = 0; sfx('charge'); }
  if(t % GAP === 0 && e.skyI < N && p){
    const i = e.skyI++;
    const x = clampX(p.x + (i ? (rng()*2 - 1)*2.0 : 0), 0.6), z = clampZ(p.z + (i ? (rng()*2 - 1)*1.0 : 0));
    const m = markOn(e, x, z, 0.95, false);
    if(m){ m.at = t + WARN; m.proj = true; }
    sfx('alert', { vol:0.45 });
  }
  if(e.marks) for(let i=0;i<e.marks.length;i++){
    const m = e.marks[i]; if(!m.on || !m.at) continue;
    if(t === m.at - 16){ m.lock = true;
      const pr = G.combat.shoot({ owner:e, kind:'beam', x:m.x, y:7.4, z:m.z, vx:0, vy:-0.46, vz:0, grav:0, dmg:13, r:0.5, life:30, power:2, up:0.2, stun:22, kb:0.08,
        boom:{ r:0.95, zr:0.7, dmg:13, power:2, kind:'slash', up:0.2, y0:-0.5, y1:2.5 }, onEnd:projMarkEnd });
      if(pr){ pr.mark = m; pr.markGen = m.gen; pr.splash = 'shock'; }
    }
    if(t > m.at + 4){ m.on = false; m.at = 0; m.proj = false; }
  }
}
function knDash(back){
  return function(e, t){
    const t0 = back ? 66 : 0;
    if(t===t0){ G.setAnim(e, 'dash', 44, 0.1); if(e.lane) e.lane.lock = true; if(G.fx && G.fx.trail) G.fx.trail(e, NTRAIL); sfx('swing'); say(e, back ? 'もういちど！' : 'ハァッ！'); }
    if(t>=t0+3 && t<t0+19){ const nx = e.x + e.face*0.36; e.vx = (nx > xLo(e.radius) && nx < xHi(e.radius)) ? e.face*0.36 : 0; e.vz = 0;
      if(t%3===0){ O.trail.dir = -e.face; fx('dust', e.x - e.face*0.8, 0.05, e.z, O.trail); } }
    if(t===t0+21 && e.lane) e.lane.on = false;
    if(!back || t < 30) return;
    // double dash: turn around, show the lane again, dash back
    if(t===40){ const p = fh().target(e); if(p) e.face = p.x > e.x ? 1 : -1; else e.face = -e.face;
      laneOn(e, e.x + e.face*0.8, e.x + e.face*6.4, e.z, 1.1); G.setAnim(e, 'windup', 26); if(G.fx && G.fx.alert) G.fx.alert(e); sfx('alert'); }
  };
}
const KN_M = {
  transform: { id:'kn_transform', anim:'rise', len:90, hits:[], noAlert:true,
    fn(e, t){ e.vx = 0; e.vz = 0;
      if(t===0) G.setAnim(e, 'rise', 52);
      if(t < 60 && t%6===0) fx('smoke', e.x + (rng()-0.5)*1.6, 0.4 + rng()*1.8, e.z + 0.3, O.smoke);
      if(t===52){ G.setAnim(e, 'roar', 38, 0.3); shake(5, 30); sfx('bossRoar'); fx('shock', e.x, 0.02, e.z, O.shockR); } },
    onEnd(e){ e.transforming = false; e.intangible = false; e.cool = 30; e.plan = null; knightIntro(e); } },
  spin: { id:'kn_spin', anim:'attack2', len:74,
    hits:[ H({ at:10, dur:52, rehit:14, x0:-2.1, x1:2.1, zr:0.9, y0:0, y1:2.4, dmg:12, kb:0.16, up:0.1, stun:20, power:1, kind:'slash' }) ],
    fn(e, t){ if(t===0){ G.setAnim(e, 'attack2', 74, 0.14); say(e, 'くるくる やみぎり！'); }
      if(t>=10 && t<62){ const p = fh().target(e); e.vx = e.face*0.035; if(p) e.vz = clamp((p.z - e.z)*0.04, -0.03, 0.03);
        if(t%14===10){ sfx('swing'); O.slashR.dir = e.face; fx('slash', e.x, 1.4, e.z + 0.3, O.slashR); } } },
    onEnd(e){ after(e, 80); } },
  sky: { id:'kn_sky', anim:'special', len:150, hits:[], fn: skyFn, onEnd(e){ marksOff(e); after(e, 84); } },
  beam: { id:'kn_beam', anim:'shoot', len:84, hits:[], fn: beamFn, onEnd(e){ marksOff(e); after(e, 92); } },
  dash: { id:'kn_dash', anim:'dash', len:48, hits:[ H({ at:4, dur:16, x0:-0.6, x1:2.0, zr:0.6, y0:0, y1:2.4, dmg:16, kb:0.2, up:0.18, stun:22, power:2 }) ],
    fn: knDash(false), onEnd(e){ if(e.lane) e.lane.on = false; after(e, 84); } },
  dash2: { id:'kn_dash2', anim:'dash', len:114, hits:[ H({ at:4, dur:16, x0:-0.6, x1:2.0, zr:0.6, y0:0, y1:2.4, dmg:16, kb:0.2, up:0.18, stun:22, power:2 }),
      H({ at:70, dur:16, x0:-0.6, x1:2.0, zr:0.6, y0:0, y1:2.4, dmg:16, kb:0.2, up:0.18, stun:22, power:2 }) ],
    fn: knDash(true), onEnd(e){ if(e.lane) e.lane.on = false; after(e, 90); } },
};
function empAI(e){
  const h = fh(), t = h.target(e);
  pre(e); safety(e);
  if(!e.introDone){ e.introDone = true; if(t) h.face(e, t); h.attack(e, e.form===2 ? KN_M.transform : EMP_M.intro, 0); return; }
  if(!t){ h.stop(e); return; }
  if(phaseCheck(e)) return;
  h.face(e, t);
  if(e.cool > 0){ hover(e, t, e.form===2 ? 3.2 : 3.8, 0.7); return; }
  const dx = t.x - e.x, adx = Math.abs(dx), adz = Math.abs(t.z - e.z), sd = dx > 0 ? -1 : 1;
  if(e.form!==2){
    const canSummon = liveMinions(e) === 0 && (e.summons|0) < 3 && (e.moves|0) >= 2 && !(e.summonedPhase && e.summonedPhase[e.phase|0]);
    if(!e.plan){
      _mn.length = 0; _mw.length = 0;
      opt('swipe', adx < 3.6 ? 5 : 1.5); opt('orbs', adx > 3 ? 4 : 1.5); opt('beam', 2.6); opt('summon', canSummon ? 3 : 0); opt('press', e.phase ? 3.2 : 0);
      e.plan = pick(e); e.planT = 0;
    }
    if(++e.planT > 170){ log('timeout:' + e.plan); e.plan = null; e.cool = 20; return; }
    switch(e.plan){
      case 'swipe': if(adx < 3.0 && adz < 0.5) go(e, EMP_M.swipe, 30); else approach(e, t.x + sd*2.2, t.z); break;
      case 'orbs': if(adx > 3 && adz < 0.6) go(e, EMP_M.orbs, 32); else approach(e, t.x + sd*5, t.z); break;
      case 'beam': if(adz < 0.3 && adx > 2.4) go(e, EMP_M.beam, 12); else approach(e, t.x + sd*4.5, t.z); break;
      case 'summon': if(h.attack(e, EMP_M.summon, 30)){ e.lastMove = 'summon'; e.plan = null; (e.summonedPhase = e.summonedPhase || [false,false])[e.phase|0] = true; } break;
      case 'press': go(e, EMP_M.press, 30); break;
      default: e.plan = null;
    }
    return;
  }
  const dashEnd = e.x + (dx > 0 ? 1 : -1)*6.4;
  const dashOK = dashEnd > xLo(e.radius) - 0.5 && dashEnd < xHi(e.radius) + 0.5;
  if(!e.plan){
    _mn.length = 0; _mw.length = 0;
    opt('spin', adx < 3 ? 5 : 1.5); opt('sky', 3); opt('beam', 2.4); opt('dash', adx > 3 && dashOK ? 3.5 : 0); opt('dash2', e.phase && adx > 3 && dashOK ? 3 : 0);
    e.plan = pick(e); e.planT = 0;
  }
  if(++e.planT > 170){ log('timeout:' + e.plan); e.plan = null; e.cool = 20; return; }
  switch(e.plan){
    case 'spin': if(adx < 2.4 && adz < 0.6) go(e, KN_M.spin, 30); else approach(e, t.x + sd*1.7, t.z); break;
    case 'sky': go(e, KN_M.sky, 30); break;
    case 'beam': if(adz < 0.3 && adx > 2.4) go(e, KN_M.beam, 12); else approach(e, t.x + sd*4.5, t.z); break;
    case 'dash': case 'dash2': if(adx > 3 && adx < 6.8 && adz < 0.3 && dashOK){ if(go(e, e.plan==='dash2' ? KN_M.dash2 : KN_M.dash, 30)) laneOn(e, e.x + e.face*0.8, e.x + e.face*6.4, e.z, 1.1); }
      else approach(e, t.x + sd*4.8, t.z); break;
    default: e.plan = null;
  }
}
// ---- the form change: same entity, new heart (HP), new rig
const EMP_HP2 = 1000;
function swapRig(e, rig){
  const old = e.rig;
  if(old){ if(old.root && old.root.parent) old.root.parent.remove(old.root); try { old.dispose && old.dispose(); } catch(err){ G.logError('bossB rig dispose', err); } }
  e.rig = rig;
  if(rig && rig.root){ G.scene.add(rig.root); rig.root.position.set(e.x, e.y, e.z); }
}
function knightIntro(e){
  if(!e.introDue) return;
  e.introDue = false;
  G.bus.emit('bossIntro', { boss:e, name:'あんこくナイト', title:'ダークワンワンたいてい しんのすがた', type:'emperor' });
}
function empTransform(e){
  cleanup(e);
  e.form = 2; e.transforming = true;
  e.dead = false; e.deadT = 0; e.koLand = null; e.ignoreForClear = false; e.happy = false;
  const hp = Math.max(1, Math.round(EMP_HP2 * (e.hpMul || 1)));
  e.maxHp = hp; e.hp = hp;
  e.phase = 0; e.spdMul = 1; e.rageDue = false; e.plan = null; e.lastMove = null; e.moves = 0;
  e.poiseDmg = 0; e.noStagger = true; e.graceUntil = G.time.tick + 180;
  e.vx = 0; e.vz = 0; e.vy = Math.max(0, (e.vy||0)*0.3); e.bounce = 0; e.gravScale = 1;
  e.inv = 90; e.flashT = 0;
  e.def = EMP2_DEF;
  let rig = null;
  try { rig = buildKnight(); } catch(err){ G.logError('bossB knight build', err); }
  if(rig){ swapRig(e, rig); e.height = 3.3; e.radius = 1.0; }
  e.transforms = (e.transforms|0) + 1;
  fx('smoke', e.x, 0.8, e.z, O.smokeBig); fx('poof', e.x, 1.6, e.z + 0.2, O.purify);
  if(G.fx && G.fx.flash) G.fx.flash('#3a1050', 0.5, 14);
  shake(6, 40);
  // the line is placed at mid-body height (same popup h.say uses) so the name banner above does not cover it
  sayLow(e, 'これが ほんとうの すがた…！');
  G.bus.emit('bossPhase', { boss:e, phase:2 });
  e.introDue = true; knightIntro(e);
  // the transformation plays as an "attack" (keeps the AI off and needs no token)
  G.setState(e, 'act'); e.pending = null;
  G.combat.start(e, KN_M.transform);
  e.introDone = true;
  log('emperor:transform hp=' + hp);
}

// ================================================================ definitions
function bossKO(e){ cleanup(e); e.plan = null; e.kseq = null; if(e.minions){ for(const m of e.minions) scare(m); } return false; }
const HELP_GIVEUP = ['ボス〜！', 'まって〜'], SLIME_GIVEUP = ['ぷる〜ん…', 'まって〜'];
G.foes.define('slime', {
  name:'キングスライム', title:'ワンワンていこく だい5のしょう', boss:true, bossB:true, phaseLine:'ぷるぷる〜っ！ おこったぞ〜！',
  hp:700, poise:90, weight:3.5, radius:1.15, height:2.4, spd:0.04, score:3000, xp:130, entrance:'drop', recover:30,
  build(){ return buildSlime(false); },
  init(e){ common(e); e.splitN = 0; e.splitDue = 0; e.minions = []; },
  ai: slimeAI,
  onKO: bossKO,
  onKOTick(e){ staggerGiveUp(e, e.minions, SLIME_GIVEUP); purifyTick(e, koT(e)); },
});
G.foes.define('slimelet', {
  name:'ちびスライム', boss:false, bossB:true,
  hp:18, spd:0.034, radius:0.4, height:0.78, weight:0.8, score:60, xp:6, entrance:'drop', recover:20,
  build(){ return buildSlime(true); },
  init(e){ e.onInterrupt = ()=>{ e.hopLanded = false; }; },
  ai: slimeletAI,
});
G.foes.define('dragon', {
  name:'ひりゅう ヴォルカ', title:'ワンワンていこく だい6のしょう', boss:true, bossB:true, phaseLine:'あちちっ… もう ほんきだぞ！',
  hp:800, poise:100, weight:3, radius:1.0, height:2.7, spd:0.045, score:3000, xp:140, entrance:'drop', recover:30,
  build(){ return buildDragon(); },
  init(e){ common(e); },
  ai: dragonAI,
  onKO: bossKO,
  onKOTick(e){ purifyTick(e, koT(e)); },
});
G.foes.define('kuroinu', {
  name:'こくけんし クロイヌ', title:'もと おうこく いちの けんし', boss:true, bossB:true, phaseLine:'まだだ…！ ほんきを だす！',
  hp:560, poise:80, weight:3, radius:0.8, height:2.4, spd:0.05, score:3000, xp:150, entrance:'drop', recover:26,
  build(){ return buildKuro(); },
  init(e){ common(e); e.atkMul = KURO_ATK; e.trailColor = '#c07aff'; e.parryT = 0; e.counterDue = false; e.parries = 0; },
  ai: kuroAI,
  block: kuroBlock,
  onKO: bossKO,
  onKOTick(e){ const t = koT(e); purifyTick(e, t); if(t===30) e.freed = true; if(t===84) say(e, 'やっと めがさめたよ…ありがとう'); },
});
const EMPEROR_DEF = G.foes.define('emperor', {
  name:'ダークワンワンたいてい', title:'ワンワンていこくの こうてい', boss:true, bossB:true,
  phaseLine:'ぐぬぬ… ほんきを みせてやる！', phaseLine2:'まだだ… まだ おわらんぞ！',
  hp:900, poise:120, weight:4, radius:1.2, height:3.9, spd:0.036, score:5000, xp:200, entrance:'drop', recover:30,
  build(){ return buildEmperor(); },
  buildForm2(){ return buildKnight(); },
  init(e){ common(e); e.minions = []; e.summons = 0; },
  ai: empAI,
  // form 1 → the same entity changes into あんこくナイト; the second KO is the real one (default KO → purified)
  onKO(e){ if(e.form!==2){ empTransform(e); return true; } return bossKO(e); },
  onKOTick(e){ staggerGiveUp(e, e.minions, HELP_GIVEUP); purifyTick(e, koT(e)); },
});
// form 2 shares everything with form 1 except the name/title the boss bar shows (per-entity def swap, not a new type)
const EMP2_DEF = Object.create(EMPEROR_DEF, {
  name: { value:'あんこくナイト', enumerable:true }, title: { value:'ダークワンワンたいてい しんのすがた', enumerable:true },
  height: { value:3.3, enumerable:true }, radius: { value:1.0, enumerable:true }, spd: { value:0.042, enumerable:true },
});
// test / tooling access through the defs only
for(const id of ['slime','slimelet','dragon','kuroinu','emperor']){ const d = G.foes.types[id]; d._log = LOG; }
G.foes.types.slime._moves = SLIME_M; G.foes.types.dragon._moves = DRAGON_M; G.foes.types.emperor._moves = EMP_M; G.foes.types.emperor._moves2 = KN_M;
G.foes.types.kuroinu._defs = kuroDefs; G.foes.types.emperor._form2 = EMP2_DEF;
})();

// 20_heroes.js — 7人の なかま（プレイヤーキャラ）：データ・ちびキャラの立体モデル・手続きアニメ・顔アイコン。
// 部品（腰・頭・腕・脚・しっぽ・武器・マント…）ごとに G.look.builder() で1メッシュへ結合し、
// 目・表情だけ別メッシュ（まばたき／×目／にっこり目の切り替え）。材質はリグごとに1枚だけ複製して白フラッシュに使う。
// 向き：左向きは鏡像（scale.x=-1）にして、武器の手がいつもカメラ側に来るようにする。回り込みの途中で正面を通る。
(function(){ 'use strict';
const G = window.G; const THREE = window.THREE; const U = G.U;
const TAU = Math.PI*2, HP = Math.PI/2;

// ---------------------------------------------------------------- hero data (select-screen order)
const LIST = [
  { id:'inu', name:'せいけんし イッヌ', nameKanji:'聖犬士イッヌ', short:'イッヌ', species:'クリームいろの こいぬ',
    desc:'つきのけんで みんなを まもる、げんきな ゆうしゃ！', color:'#f2b632',
    stats:{ hp:1.0, atk:1.0, spd:1.0, jump:1.0 }, weapon:'sword', range:'melee',
    specials:{ n:'しんくうは', up:'てんしょうざん', fwd:'しっそういあい' }, ultName:'じげんざん',
    voice:{ f0:300, type:'square' } },
  { id:'shima', name:'けんせい シマダックス', nameKanji:'拳聖シマダックス', short:'シマ', species:'ダックスフント',
    desc:'はやい パンチと キックで れんぞく こうげき！', color:'#3a8ee0',
    stats:{ hp:0.95, atk:0.9, spd:1.12, jump:1.05 }, weapon:'fist', range:'melee',
    specials:{ n:'はどうけん', up:'れっかしょうりゅうきゃく', fwd:'せんぷうきゃく' }, ultName:'ひゃくれつ にくきゅうパンチ',
    voice:{ f0:186, type:'sawtooth' } },
  { id:'nuko', name:'まほうつかい ヌコ', nameKanji:'魔法使いヌコ', short:'ヌコ', species:'マルチーズ',
    desc:'ほしの つえで とおくから まほうを とばすよ！', color:'#b48ae0',
    stats:{ hp:0.85, atk:1.05, spd:0.95, jump:1.0 }, weapon:'staff', range:'ranged',
    specials:{ n:'ひょうけつまだん', up:'せいしんしょうか', fwd:'サンダーボルト' }, ultName:'ほしふるよる',
    voice:{ f0:520, type:'triangle' } },
  { id:'guard8', name:'ガードワン 8ごう', nameKanji:'ガードワン8号', short:'8ごう', species:'チャウチャウ',
    desc:'おおきな ハンマーで どっかーん！ ちからもち', color:'#8a9bb5',
    stats:{ hp:1.4, atk:1.35, spd:0.8, jump:0.85 }, weapon:'hammer', range:'melee', scale:1.25,
    specials:{ n:'ハンマーしょうげきは', up:'てんしょうハンマー', fwd:'タックル' }, ultName:'メガトンクエイク',
    voice:{ f0:148, type:'sawtooth' } },
  { id:'watch', name:'かいとう ワッチ', nameKanji:'怪盗ワッチ', short:'ワッチ', species:'チワワ',
    desc:'すばやく うごいて トランプを なげる かいとう！', color:'#5cc8e0',
    stats:{ hp:0.8, atk:0.8, spd:1.25, jump:1.15 }, weapon:'cane', range:'mixed',
    specials:{ n:'トランプなげ', up:'けむりだま', fwd:'スライディング' }, ultName:'かみふぶきロックンロール',
    voice:{ f0:392, type:'sine' } },
  { id:'wanden', name:'サムライ ワンデン', nameKanji:'サムライワンデン', short:'ワンデン', species:'プードル',
    desc:'ながーい かたなで とおくまで スパッ！', color:'#c8463c',
    stats:{ hp:0.95, atk:1.15, spd:1.0, jump:1.0 }, weapon:'katana', range:'melee',
    specials:{ n:'やえがすみ', up:'つばめがえし', fwd:'しゅくち' }, ultName:'ひけん・めんきょかいでん',
    voice:{ f0:228, type:'square' } },
  { id:'mack', name:'ほあんかん マック', nameKanji:'保安官マック', short:'マック', species:'チャウチャウ',
    desc:'コルクてっぽうで ポンポン うつ ほあんかん！', color:'#e8872e',
    stats:{ hp:1.0, atk:0.95, spd:1.0, jump:1.0 }, weapon:'gun', range:'ranged',
    specials:{ n:'スターばくだん', up:'ロケットはなび', fwd:'ドリルダッシュ' }, ultName:'はなびだいさくせん',
    voice:{ f0:262, type:'triangle' } },
];
for(const h of LIST){ h.specialName = h.specials.n; if(!h.scale) h.scale = 1; }
const BYID = {}; for(const h of LIST) BYID[h.id] = h;

// ---------------------------------------------------------------- build-time helpers (allocation here is fine: runs once per hero)
const _e = new THREE.Euler(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
function M(pos, rot, scl, order){
  _e.set(rot?rot[0]:0, rot?rot[1]:0, rot?rot[2]:0, order||'XYZ'); _q.setFromEuler(_e);
  if(scl==null) _s.set(1,1,1); else if(typeof scl==='number') _s.set(scl,scl,scl); else _s.set(scl[0],scl[1],scl[2]);
  return new THREE.Matrix4().compose(_p.set(pos?pos[0]:0, pos?pos[1]:0, pos?pos[2]:0), _q, _s);
}
// thin wrapper over G.look.builder() that also accepts an Euler order and a pre-built matrix
function B(){
  const b = G.look.builder();
  return {
    b,
    add(g, color, pos, rot, scl, order){ b.addMatrix(g, color, M(pos, rot, scl, order)); return this; },
    addM(g, color, m){ b.addMatrix(g, color, m); return this; },
    get empty(){ return b.empty; },
    build(){ return b.build(); },
  };
}
// merge geometries that already carry a colour attribute (G.look.eye) — keeps their colours
function mergeColored(list){
  let nv=0, ni=0;
  for(const it of list){ nv += it.g.attributes.position.count; ni += it.g.index ? it.g.index.count : it.g.attributes.position.count; }
  const pos = new Float32Array(nv*3), nor = new Float32Array(nv*3), col = new Float32Array(nv*3);
  const idx = new Uint16Array(ni); const v = new THREE.Vector3(), n3 = new THREE.Matrix3(), c = new THREE.Color();
  let vo=0, io=0;
  for(const it of list){
    const P = it.g.attributes.position, N = it.g.attributes.normal, C = it.g.attributes.color;
    n3.getNormalMatrix(it.m); const flip = it.m.determinant()<0;
    if(it.color!=null) c.set(it.color);
    for(let i=0;i<P.count;i++){
      v.fromBufferAttribute(P,i).applyMatrix4(it.m); pos.set([v.x,v.y,v.z], (vo+i)*3);
      v.fromBufferAttribute(N,i).applyMatrix3(n3).normalize(); nor.set([v.x,v.y,v.z], (vo+i)*3);
      if(it.color!=null) col.set([c.r,c.g,c.b], (vo+i)*3);
      else if(it.recolor){ const r=C.getX(i), g=C.getY(i), bb=C.getZ(i); const dark = r+g+bb < 0.5; if(dark){ c.set(it.recolor); col.set([c.r,c.g,c.b],(vo+i)*3); } else col.set([r,g,bb],(vo+i)*3); }
      else col.set([C.getX(i),C.getY(i),C.getZ(i)], (vo+i)*3);
    }
    const I = it.g.index.array;
    for(let k=0;k<I.length;k+=3){ idx[io++]=I[k]+vo; idx[io++]=flip?I[k+2]+vo:I[k+1]+vo; idx[io++]=flip?I[k+1]+vo:I[k+2]+vo; }
    vo += P.count;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos,3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor,3));
  g.setAttribute('color', new THREE.BufferAttribute(col,3));
  g.setIndex(new THREE.BufferAttribute(idx,1));
  g.computeBoundingSphere();
  return g;
}

// ---------------------------------------------------------------- body layout (units at scale 1; guard8 is scaled ×1.25 as a whole)
const L = {
  hipY: 0.21,            // leg + hips pivot height
  bodyC: 0.15,           // body centre above hips pivot
  neckY: 0.36,           // head pivot above hips pivot
  headC: 0.30,           // head centre above neck
  headR: 0.36,
  headS: [1.0, 0.92, 1.06],
  shoulder: [0.0, 0.27, 0.185],
  legZ: 0.095,
  hand: [0.012, -0.175, 0],
};
// point on the head ellipsoid (head-pivot space) + a rotation that points local +z along the surface normal
function onHead(az, el, lift, R){
  R = R || L.headR; const s = L.headS, k = 1 + (lift||0);
  const ce = Math.cos(el);
  return [ R*s[0]*ce*Math.cos(az)*k, L.headC + R*s[1]*Math.sin(el)*k, R*s[2]*ce*Math.sin(az)*k ];
}
function faceRot(az, el, spin){ return [ -el, HP - az, spin||0 ]; }   // use with order 'YXZ'

// ---------------------------------------------------------------- model assembly
// D = { <part>: B(), a:{anchors}, T:design }. Parts: body head face eyes eyesX eyesSq eyesHappy mouth
//   armL armR legL legR tail earL earR cape weapon glasses gem (any subset)
const MODEL = {};           // id -> { geos:{part:BufferGeometry (shared)}, a, T }
function part(D, name){ return D[name] || (D[name] = B()); }

function buildCommon(D, T){
  const geo = G.look.geo;
  // legs (pivot at hip joint)
  for(const side of [-1,1]){
    const b = part(D, side<0?'legL':'legR');
    b.add(geo.capsule(0.072, 0.06, 3, 10), T.leg, [0,-0.085,0]);
    b.add(geo.sphere(0.08,10,7), T.foot||T.leg, [0.03,-0.165,0], null, [1.35,0.72,1.08]);
  }
  // body bean (pivot = hips)
  const bs = T.bodyScale || [0.95,1.08,0.98];
  if(!T.noBean) part(D,'body').add(geo.sphere(0.215, 18, 12), T.body, [0, L.bodyC, 0], null, bs);
  // arms (pivot at shoulder)
  for(const side of [-1,1]){
    const b = part(D, side<0?'armL':'armR');
    b.add(geo.capsule(0.058, 0.07, 3, 8), T.sleeve||T.fur, [0,-0.07,0]);
    b.add(geo.sphere(T.pawR||0.072,10,7), T.paw||T.fur, [0.012,-0.165,0]);
  }
  // head (pivot at neck)
  const h = part(D,'head');
  h.add(geo.sphere(L.headR, 24, 16), T.fur, [0, L.headC, 0], null, L.headS);
  const mz = T.muzzleScale || [0.9,0.72,1.12];
  const mp = onHead(0, -0.36, -0.2);
  if(T.muzzleFwd) mp[0] += T.muzzleFwd;
  h.add(geo.sphere(0.13, 14, 10), T.muzzle, mp, null, mz);
  D.a.muzzle = mp; D.a.muzzleFront = mp[0] + 0.13*mz[0];
  // face details without outline: nose, ω mouth, blush
  const f = part(D,'face');
  const nx = D.a.muzzleFront - 0.012, ny = mp[1] + 0.13*mz[1]*0.55;
  f.add(geo.sphere(0.042, 10, 7), T.nose||'#2a1a14', [nx, ny, 0], null, [0.85,0.72,1.15]);
  f.add(geo.sphere(0.012, 6, 4), '#ffffff', [nx+0.025, ny+0.02, 0.012]);     // nose shine
  const my = mp[1] - 0.012;
  for(const s of [-1,1]) f.add(G.look.geo.torus(0.02, 0.0065, 5, 10, Math.PI), T.mouthCol||'#4a2418',
    [D.a.muzzleFront - 0.028, my, s*0.02], [0, HP, Math.PI]);
  f.add(geo.cylinder(0.006,0.006,0.035,5), T.mouthCol||'#4a2418', [D.a.muzzleFront-0.02, my+0.028, 0]);
  D.a.mouthPos = [D.a.muzzleFront - 0.03, my - 0.012, 0];
  const bl = G.look.blush(0.072); const blGeo = bl.geometry;   // same shape/colour as G.look.blush, baked (no extra draw call)
  for(const s of [-1,1]){
    const az = s*(T.blushAz||0.98), el = T.blushEl==null ? -0.24 : T.blushEl;
    f.add(blGeo, T.blush||'#ff9fb5', onHead(az, el, -0.012), faceRot(az, el), [1.25,0.62,0.3], 'YXZ');
  }
  // eye placement (used by the eye meshes built in buildEyes)
  D.a.eyeAz = T.eyeAz || 0.40; D.a.eyeEl = T.eyeEl==null ? -0.02 : T.eyeEl; D.a.eyeSize = T.eye || 0.05;
  D.a.eyeY = onHead(0, D.a.eyeEl, 0)[1];
}

// both eyes (+ expression variants) in one mesh each, pivot at eye height so scale.y blinks them
function buildEyes(D, T){
  const a = D.a, y0 = a.eyeY, sz = a.eyeSize, list = [];
  const dark = T.lineCol || '#3a2418';
  const eyeG = G.look.eye(sz).geometry;
  const skip = T.patchEye;   // +1 / -1: that eye is covered (eyepatch)
  const place = (s, extra)=>{
    const az = s*a.eyeAz, el = a.eyeEl, p = onHead(az, el, extra==null?-0.02:extra);
    p[1] -= y0; return M(p, faceRot(az, el), null, 'YXZ');
  };
  for(const s of [-1,1]){ if(s===skip) continue; list.push({ g:eyeG, m:place(s), recolor:T.eyeCol||null }); }
  if(T.lashes){ for(const s of [-1,1]){ const m = place(s, 0.0).multiply(M([s*-sz*0.2, sz*0.95, 0],[0,0,s*-0.9],[1,1,1]));
    list.push({ g:G.look.geo.capsule(0.009, sz*0.55, 2, 5), m, color:dark }); } }
  D.eyesGeo = mergeColored(list);
  eyeG.dispose();
  // × eyes (dizzy / down / ko), > < squeezed (hurt / charge), ^ ^ happy
  const cap = G.look.geo.capsule(0.011, sz*1.35, 2, 6), capS = G.look.geo.capsule(0.011, sz*1.05, 2, 6);
  const arc = G.look.geo.torus(sz*0.85, 0.013, 5, 10, Math.PI);
  const X = B(), S = B(), H = B();
  for(const s of [-1,1]){
    if(s===skip) continue;
    const base = place(s, 0.005);
    X.addM(cap, dark, base.clone().multiply(M([0,0,0],[0,0, 0.78])));
    X.addM(cap, dark, base.clone().multiply(M([0,0,0],[0,0,-0.78])));
    // chevrons point toward the middle of the face (eye local +x = viewer's right)
    const dir = s>0 ? -1 : 1;
    S.addM(capS, dark, base.clone().multiply(M([0, sz*0.36, 0],[0,0, dir*-0.62])));
    S.addM(capS, dark, base.clone().multiply(M([0,-sz*0.36, 0],[0,0, dir* 0.62])));
    H.addM(arc, dark, base.clone().multiply(M([0,-sz*0.35,0],[0,0,0])));
  }
  D.xGeo = X.build(); D.sqGeo = S.build(); D.happyGeo = H.build();
  // open mouth (yell / hurt / cheer)
  const mo = B(), mp = a.mouthPos;
  mo.add(G.look.geo.sphere(0.05, 10, 7), '#6b1e24', [0, 0, 0], [0,0,0], [0.45,0.62,0.8]);
  mo.add(G.look.geo.sphere(0.03, 10, 6), '#ff7d8f', [0.01, -0.018, 0], [0,0,0], [0.45,0.5,0.9]);
  D.mouthGeo = mo.build();
}

// ---- shared accessory makers
function earsOf(D, type, col, col2, opt){
  const geo = G.look.geo; opt = opt || {};
  for(const s of [-1,1]){
    const b = part(D, s<0?'earL':'earR');
    if(type==='flop'){          // fluffy floppy ears (poodle-ish)
      b.add(geo.sphere(0.12,10,7), col, [0.0,-0.15, s*0.03], [s*-0.12,0,0], [0.62,1.45,0.5]);
      b.add(geo.sphere(0.07, 8, 6), col2, [0.02,-0.27, s*0.04]);
      b.add(geo.sphere(0.06, 8, 6), col2, [-0.05,-0.25, s*0.03]);
    } else if(type==='long'){   // long flat dachshund ears
      b.add(geo.sphere(0.11,10,7), col, [0.0,-0.18, s*0.02], [s*-0.08,0,0.1], [0.7,1.95,0.38]);
    } else if(type==='hair'){   // long silky maltese hair
      b.add(geo.sphere(0.13,10,7), col, [0.0,-0.19, s*0.03], [s*-0.1,0,0.05], [0.72,1.8,0.52]);
      b.add(geo.sphere(0.075, 8, 6), col2, [0.01,-0.36, s*0.04]);
    } else if(type==='curly'){  // poodle curls
      const pts = [[0,-0.06],[0.02,-0.16],[-0.03,-0.2],[0.03,-0.27],[-0.02,-0.3]];
      pts.forEach((q,i)=> b.add(geo.sphere(i?0.068:0.075, 10, 7), i%2?col2:col, [q[0], q[1], s*0.035]));
    } else if(type==='up'){     // huge upright chihuahua ears
      const len = opt.len || 0.42;
      b.add(geo.cone(0.14, len, 14), col, [0, len*0.5, 0], [s*0.32, 0, 0], [0.42,1,1]);
      b.add(geo.cone(0.1, len*0.78, 12), opt.inner||'#f4b0c4', [0.03, len*0.43, s*0.0], [s*0.32, 0, 0], [0.3,1,1]);
    }
  }
  D.a.earType = type;
  D.a.earPivot = opt.pivot || (type==='up' ? onHead(0.95, 0.72, -0.12) : onHead(1.3, 0.42, -0.04));
}
function tailOf(D, type, col, col2){
  const geo = G.look.geo, b = part(D,'tail');
  if(type==='fluff'){ b.add(geo.sphere(0.085,10,7), col, [-0.05,0.05,0]); b.add(geo.sphere(0.06, 8, 6), col2||col, [-0.1,0.1,0.02]); }
  else if(type==='thin'){ b.add(geo.capsule(0.028, 0.2, 3, 8), col, [-0.1,0.09,0], [0,0,0.95]); b.add(geo.sphere(0.034,8,6), col2||col, [-0.19,0.16,0]); }
  else if(type==='plume'){ b.add(geo.sphere(0.08,10,7), col, [-0.08,0.12,0], [0,0,0.9], [0.8,1.9,1]); }
  else if(type==='curl'){ b.add(geo.torus(0.07, 0.042, 6, 12, Math.PI*1.6), col, [-0.03,0.13,0], [0,0,-0.6]); b.add(geo.sphere(0.05, 8, 6), col2||col, [0.02,0.2,0]); }
  else if(type==='tiny'){ b.add(geo.capsule(0.024, 0.1, 3, 8), col, [-0.05,0.06,0], [0,0,0.8]); }
  else if(type==='pom'){ b.add(geo.capsule(0.022, 0.08, 3, 6), col2||col, [-0.04,0.05,0], [0,0,0.9]); b.add(geo.sphere(0.075,8,6), col, [-0.1,0.1,0]); }
  D.a.tailPivot = D.a.tailPivot || [-0.185, 0.08, 0];
}
// flared cape hanging from the back of the neck (flattened frustum)
function capeOf(D, col, len, wide, lining){
  const geo = G.look.geo, b = part(D,'cape');
  b.add(geo.cylinder(0.12, wide||0.27, len, 18), col, [-0.075, -len/2, 0], [0,0,0.05], [0.34,1,1]);
  if(lining) b.add(geo.cylinder(0.1, (wide||0.27)*0.9, len*0.92, 14), lining, [-0.055, -len/2, 0], [0,0,0.05], [0.26,1,1]);
  D.a.capePivot = [-0.1, 0.33, 0];
}

// on-head accessory helper: matrix that sits on the head surface, local +z = outward normal
function headM(az, el, lift, extraRot, scl){
  const m = M(onHead(az, el, lift), faceRot(az, el), null, 'YXZ');
  if(extraRot || scl) m.multiply(M([0,0,0], extraRot, scl));
  return m;
}
const GOLD = '#ffcf4a';

// ---------------------------------------------------------------- the seven designs
// lightness is split into 3 steps per hero (dark cloth / mid / light) so parts never merge into one blob
const DESIGN = {
  inu: { fur:'#fff8e6', muzzle:'#fffdf6', body:'#6f9fe0', sleeve:'#6f9fe0', paw:'#fff8e6', leg:'#fff8e6', foot:'#8a5a2e',
    weaponGlow:'#2d5c8a', halo:true,
    build(D){ const geo = G.look.geo, b = part(D,'body'), h = part(D,'head');
      b.add(geo.torus(0.19, 0.03, 6, 21), '#7a5a2a', [0,0.055,0], [HP,0,0], [1,1.04,1]);
      b.add(geo.rbox(0.03,0.075,0.09,0.012,2), GOLD, [0.19,0.055,0]);
      b.add(geo.sphere(0.036, 8, 6), GOLD, [0.205,0.2,0], null, [0.45,0.95,1.05]);                 // paw emblem
      for(const t of [-1,0,1]) b.add(geo.sphere(0.016,8,6), GOLD, [0.196, 0.25+(t?0:0.012), t*0.032], null, [0.5,1,1]);
      b.add(geo.torus(0.12, 0.042, 6, 15), '#fff8e6', [0,0.325,0], [HP,0,0]);                       // fluffy collar
      for(const s of [-1,1]) b.add(geo.sphere(0.028,8,6), GOLD, [0.08,0.33,s*0.1]);                  // cape clasps
      for(const [az,el,r] of [[0,1.2,0.075],[0.9,1.02,0.07],[-0.9,1.02,0.07],[2.2,0.95,0.07],[-2.2,0.95,0.07],[Math.PI,1.1,0.075]])
        h.add(geo.sphere(r,10,7), '#fff4dc', onHead(az, el, 0.02));                                   // poodle curls
      earsOf(D, 'flop', '#efe0b8', '#e6d3a4');
      tailOf(D, 'fluff', '#fff8e6', '#f3e6c4');
      capeOf(D, '#e0503e', 0.46, 0.27, '#b83a2c');
      const w = part(D,'weapon');
      w.add(geo.capsule(0.026, 0.09, 3, 8), '#3a5a9a', [0,0,0]);
      w.add(geo.sphere(0.034, 8, 6), GOLD, [0,-0.08,0]);
      w.add(geo.rbox(0.2, 0.045, 0.06, 0.018, 2), GOLD, [0,0.075,0]);
      w.add(geo.torus(0.036, 0.011, 6, 10, Math.PI*1.3), '#ffe27a', [0,0.1,0.034], [0,0,-0.5]);     // crescent moon
      w.add(geo.rbox(0.095, 0.46, 0.028, 0.012, 2), '#bfe8ff', [0,0.33,0]);
      w.add(geo.cone(0.0475, 0.1, 4), '#bfe8ff', [0,0.61,0], null, [1,1,0.3]);
      w.add(geo.box(0.014, 0.42, 0.032), '#f2fbff', [0.018,0.33,0]);
      D.a.tip = [0,0.64,0]; D.a.wbase = [0,0.1,0];
    } },
  shima: { fur:'#b07a44', muzzle:'#d8a878', body:'#fbfbf5', sleeve:'#fbfbf5', paw:'#ffffff', pawR:0.094, leg:'#fbfbf5', foot:'#b07a44',
    bodyScale:[1.18,1.02,0.98], muzzleScale:[1.55,0.7,0.95], muzzleFwd:0.03, glasses:true,
    build(D){ const geo = G.look.geo, b = part(D,'body'), h = part(D,'head');
      b.add(geo.sphere(0.08,10,7), '#b07a44', [0.2,0.25,0], null, [0.3,0.9,0.62]);                  // fur in the gi's V-neck
      for(const s of [-1,1]) b.add(geo.capsule(0.016,0.13,2,6), '#e4e2d8', [0.2,0.25,s*0.045], [s*0.5,0,0]);
      b.add(geo.torus(0.215, 0.028, 6, 21), '#1e1a1c', [0,0.07,0], [HP,0,0], [1.14,1,1]);
      b.add(geo.sphere(0.035, 8, 6), '#1e1a1c', [0.245,0.07,0.03]);
      for(const s of [-1,1]) b.add(geo.capsule(0.018,0.08,2,6), '#1e1a1c', [0.245,0.0,0.03+s*0.03], [s*0.25,0,0]);
      for(const [az,el] of [[Math.PI,1.05],[Math.PI,0.72],[Math.PI,0.4],[0,1.25]])
        h.addM(geo.sphere(0.1,10,7), '#3a2210', headM(az, el, -0.012, null, [1.5,0.28,0.3]));       // dark stripes
      earsOf(D, 'long', '#5e3c20');
      tailOf(D, 'thin', '#b07a44', '#3a2210');
      // round sunglasses (own mesh so they can slide up / get knocked askew)
      const g = part(D,'glasses'), a = D.a, y0 = a.eyeY;
      for(const s of [-1,1]){
        const az = s*(a.eyeAz+0.04), el = a.eyeEl+0.02, p = onHead(az, el, 0.05); p[1] -= y0;
        const m = M(p, faceRot(az, el), null, 'YXZ');
        g.addM(geo.cylinder(0.06,0.06,0.02,16), '#141418', m.clone().multiply(M([0,0,0],[HP,0,0])));
        g.addM(geo.torus(0.06, 0.011, 6, 16), '#3a3a44', m.clone());
        g.addM(geo.sphere(0.017,8,6), '#ffffff', m.clone().multiply(M([-0.024,0.024,0.012],null,[1,1,0.3])));
      }
      const pb = onHead(0, a.eyeEl+0.05, 0.1); pb[1] -= y0;
      g.add(geo.capsule(0.011, 0.09, 2, 6), '#2a2a30', pb, [HP,0,0]);
    } },
  nuko: { fur:'#ffffff', muzzle:'#ffffff', body:'#b48ae0', sleeve:'#b48ae0', paw:'#ffffff', leg:'#6a4a9a', foot:'#6a4a9a',
    eyeCol:'#4b2a7a', lashes:true, eye:0.054, noBean:true,
    build(D){ const geo = G.look.geo, b = part(D,'body'), h = part(D,'head');
      b.add(geo.lathe('nukoRobe', [[0,-0.15],[0.29,-0.15],[0.3,-0.125],[0.26,-0.04],[0.2,0.12],[0.16,0.27],[0.1,0.345],[0,0.36]], 22), '#b48ae0');
      b.add(geo.torus(0.295, 0.028, 6, 21), '#f1e6ff', [0,-0.13,0], [HP,0,0]);
      b.add(geo.torus(0.105, 0.03, 6, 15), '#f1e6ff', [0,0.335,0], [HP,0,0]);
      b.addM(geo.star(0.055,0.5,0.025), GOLD, M([0.2,0.2,0.0],[0,HP,0]).multiply(M([0,0,0],[0,0,0.2])));
      earsOf(D, 'hair', '#f7f2fc', '#eee6f8');
      tailOf(D, 'plume', '#ffffff');
      // big pink bow on top (near side)
      const bp = onHead(0.55, 0.95, 0.1);
      for(const sd of [-1,1]) h.add(geo.sphere(0.12,12,8), '#ff7ab8', [bp[0]-0.01, bp[1]+0.03, bp[2]+sd*0.12], [sd*0.35,0,0.15], [0.5,0.75,1.15]);
      h.add(geo.sphere(0.055,10,7), '#ff4f9a', bp);
      for(const sd of [-1,1]) h.add(geo.capsule(0.024,0.09,2,6), '#ff7ab8', [bp[0]+0.03, bp[1]-0.08, bp[2]+sd*0.05], [sd*0.45,0,0.2]);
      for(const [az,el] of [[0.3,0.7],[-0.3,0.7],[0,0.85]]) h.add(geo.sphere(0.065, 8, 6), '#fbf8ff', onHead(az, el, 0.02)); // bangs
      // bell sleeves
      for(const s of [-1,1]){ const a = part(D, s<0?'armL':'armR');
        a.add(geo.cylinder(0.05, 0.095, 0.15, 12), '#b48ae0', [0,-0.09,0]); a.add(geo.torus(0.09, 0.018, 6, 12), '#f1e6ff', [0,-0.165,0], [HP,0,0]); }
      const w = part(D,'weapon');
      w.add(geo.cylinder(0.022,0.022,0.8,8), '#a07ad0', [0,0.18,0]);
      for(const y of [-0.2, 0.0, 0.5]) w.add(geo.cylinder(0.03,0.03,0.035,8), GOLD, [0,y,0]);
      w.add(geo.torus(0.07, 0.016, 6, 14), GOLD, [0,0.66,0]);
      const gm = part(D,'gem');
      gm.add(geo.star(0.11,0.48,0.05), '#ff8fcf');
      gm.add(geo.star(0.055,0.48,0.03), '#ffffff', [0,0,0.028]);
      gm.add(geo.star(0.055,0.48,0.03), '#ffffff', [0,0,-0.028]);
      D.a.gemPos = [0,0.66,0]; D.a.tip = [0,0.7,0]; D.a.wbase = [0,0.45,0];
    } },
  guard8: { fur:'#cf8843', muzzle:'#f3cf98', body:'#cf8843', paw:'#eab676', leg:'#cf8843', foot:'#a8632a',
    muzzleScale:[0.85,0.78,1.35], eye:0.036, eyeAz:0.36, blush:'#ff9aa8',
    build(D){ const geo = G.look.geo, b = part(D,'body'), h = part(D,'head');
      b.add(geo.sphere(0.17,14,10), '#f0c48a', [0.1,0.24,0], null, [0.55,0.8,0.95]);                         // cream chest ruff
      for(const z of [-1,0,1]) b.add(geo.sphere(0.07,8,6), '#f0c48a', [0.15,0.13+Math.abs(z)*0.03,z*0.07]);
      b.add(geo.torus(0.2, 0.034, 6, 21), '#34426e', [0,0.07,0], [HP,0,0], [1,1.04,1]);
      b.add(geo.cylinder(0.05,0.05,0.02,16), GOLD, [0.2,0.15,0], [0,0,HP]);
      b.add(geo.capsule(0.03,0.2,2,6), '#34426e', [0.16,0.16,0], [0.0,0,0]);
      for(const [az,el] of [[1.3,-0.05],[-1.3,-0.05],[0.95,-0.5],[-0.95,-0.5]])
        h.addM(geo.sphere(0.13,10,7), '#dd9850', headM(az, el, -0.06, null, [1,1,0.55]));             // fluffy cheek mane
      h.add(geo.sphere(0.37,22,12), '#cfd6e2', [0, L.headC+0.13, 0], null, [1.0,0.6,1.06]);        // silver helmet
      h.add(geo.torus(0.345, 0.026, 6, 24), '#9aa6b8', [0, L.headC+0.1, 0], [HP,0,0], [1,1.08,1]);
      for(const [az,y,r] of [[0.0,0.3,0.05],[1.2,0.27,0.045],[-1.2,0.27,0.045],[Math.PI,0.3,0.05]])
        h.add(geo.sphere(r,8,6), '#b8c2d2', [Math.cos(az)*0.24, L.headC+y, Math.sin(az)*0.25]);    // 4 round knobs
      h.add(geo.sphere(0.055,8,6), '#f4f6fa', [0, L.headC+0.36, 0]);
      for(const s of [-1,1]) h.add(geo.cone(0.06,0.09,8), '#b8733a', [-0.05, L.headC+0.3, s*0.28], [s*0.6,0,0]);
      part(D,'face').add(geo.sphere(0.03,8,6), '#5a5a8a', [D.a.mouthPos[0]+0.012, D.a.mouthPos[1]-0.008, 0.012], null, [0.55,0.9,0.9]);
      tailOf(D, 'curl', '#dd9850', '#e0a45f');
      const w = part(D,'weapon');
      w.add(geo.cylinder(0.034,0.034,0.8,10), '#5a3a1c', [0,0.28,0]);
      for(const y of [-0.06, 0.04]) w.add(geo.cylinder(0.042,0.042,0.05,10), '#34426e', [0,y,0]);
      w.add(geo.rbox(0.36,0.25,0.25,0.06,3), '#d5d9e2', [0,0.72,0]);
      for(const s of [-1,1]) w.add(geo.rbox(0.05,0.27,0.27,0.04,2), '#9aa3b5', [s*0.17,0.72,0]);
      w.add(geo.box(0.12,0.26,0.26), GOLD, [0,0.72,0]);
      D.a.tip = [0,0.72,0]; D.a.wbase = [0,0.45,0];
    } },
  watch: { fur:'#ffffff', muzzle:'#ffffff', body:'#3a3f58', sleeve:'#3a3f58', paw:'#ffffff', leg:'#3a3f58', foot:'#1f2130',
    eyeCol:'#1d3f8f', eye:0.062, eyeAz:0.43, muzzleScale:[0.8,0.66,1.0],
    build(D){ const geo = G.look.geo, b = part(D,'body'), h = part(D,'head');
      b.add(geo.sphere(0.12,8,6), '#f4f6fb', [0.15,0.2,0], null, [0.55,1.1,0.75]);                // shirt front
      b.add(geo.sphere(0.035, 8, 6), '#e0263c', [0.2,0.32,0]);                                       // bow tie
      for(const s of [-1,1]) b.add(geo.cone(0.05,0.08,10), '#e0263c', [0.19,0.32,s*0.055], [s*-HP,0,0], [0.7,1,1]);
      earsOf(D, 'up', '#ffffff', null, { len:0.46, inner:'#f4b0c4' });
      tailOf(D, 'tiny', '#ffffff');
      capeOf(D, '#2a2d38', 0.34, 0.25, '#b01e30');
      // black top hat, tipped to the front
      const hp = [0.03, L.headC+0.33, 0.0];
      h.add(geo.cylinder(0.2,0.2,0.025,22), '#2a2d38', [hp[0], hp[1]-0.02, hp[2]], [0,0,-0.12]);
      h.add(geo.cylinder(0.135,0.145,0.22,18), '#2a2d38', [hp[0]-0.012, hp[1]+0.09, hp[2]], [0,0,-0.12]);
      h.add(geo.cylinder(0.148,0.15,0.045,18), '#d8283c', [hp[0]-0.004, hp[1]+0.02, hp[2]], [0,0,-0.12]);
      const w = part(D,'weapon');
      w.add(geo.cylinder(0.02,0.02,0.52,8), '#22242e', [0,0.24,0]);
      w.add(geo.sphere(0.028,8,6), '#f4f6fb', [0,0.5,0]);
      w.add(geo.torus(0.05, 0.018, 6, 10, Math.PI), '#dfe3ea', [-0.05,-0.02,0], [0,0,Math.PI]);
      w.add(geo.sphere(0.024,8,6), '#dfe3ea', [-0.1,-0.02,0]);
      D.a.tip = [0,0.52,0]; D.a.wbase = [0,0.05,0];
    } },
  wanden: { fur:'#f4e8c4', muzzle:'#fffaf0', body:'#c8463c', sleeve:'#c8463c', paw:'#f4e8c4', leg:'#33313d', foot:'#f4f0e6',
    patchEye:1,
    build(D){ const geo = G.look.geo, b = part(D,'body'), h = part(D,'head');
      b.add(geo.sphere(0.2,10,7), '#33313d', [0.12,0.15,0], null, [0.45,1.12,0.5]);                // kimono front
      for(const s of [-1,1]) b.add(geo.capsule(0.017,0.15,2,6), '#f4f0e6', [0.2,0.26,s*0.045], [s*0.55,0,0]);
      b.add(geo.torus(0.2, 0.045, 6, 21), '#9c8a5e', [0,0.06,0], [HP,0,0], [1,1.04,1]);
      // long black scabbard at the left hip, pointing back-down
      const dir = [-Math.sin(1.95), Math.cos(1.95)];
      b.add(geo.rbox(0.05,0.86,0.036,0.016,2), '#1e1c24', [0.14+dir[0]*0.4, 0.07+dir[1]*0.4, -0.2], [0,0,1.95]);
      b.add(geo.cylinder(0.032,0.032,0.04,10), GOLD, [0.14, 0.07, -0.2], [0,0,1.95]);
      for(const s of [-1,1]){ const a = part(D, s<0?'armL':'armR');
        a.add(geo.rbox(0.13,0.15,0.085,0.035,2), '#c8463c', [-0.01,-0.08,s*0.01]); }
      for(const s of [-1,1]) part(D, s<0?'legL':'legR').add(geo.cylinder(0.078,0.1,0.13,12), '#33313d', [0,-0.07,0]);
      h.add(geo.sphere(0.14,10,7), '#f4e8c4', [-0.02, L.headC+0.39, 0]);                          // topknot
      for(let i=0;i<5;i++){ const a = i/5*TAU; h.add(geo.sphere(0.07, 8, 6), '#fff3d6', [-0.02+Math.cos(a)*0.1, L.headC+0.42, Math.sin(a)*0.1]); }
      h.add(geo.torus(0.09, 0.022, 6, 12), '#8c2a24', [-0.02, L.headC+0.3, 0], [HP,0,0]);
      h.addM(geo.sphere(0.068,10,7), '#1a1a22', headM(D.a.eyeAz, D.a.eyeEl, 0.0, null, [1,0.9,0.3]));  // eyepatch
      h.add(geo.torus(L.headR*0.94, 0.014, 5, 30), '#1a1a22', [0, L.headC+0.07, 0], [HP+0.62,0,0], [1.03,1.08,1.0]);
      earsOf(D, 'curly', '#f4e8c4', '#e6d6a6');
      tailOf(D, 'pom', '#f4e8c4', '#e6d6a6');
      const w = part(D,'weapon');
      w.add(geo.capsule(0.027,0.19,3,8), '#2a2430', [0,-0.01,0]);
      for(const y of [-0.08,-0.02,0.04]) w.add(geo.box(0.03,0.03,0.058), '#f4f0e6', [0,y,0], [0,0,Math.PI/4]);
      w.add(geo.sphere(0.03,8,6), GOLD, [0,-0.12,0]);
      w.add(geo.cylinder(0.068,0.068,0.018,18), '#d4a84a', [0,0.1,0]);
      w.add(geo.rbox(0.056,0.92,0.018,0.008,2), '#e4ebf4', [0,0.57,0]);
      w.add(geo.box(0.012,0.88,0.02), '#ffffff', [0.022,0.56,0]);
      w.add(geo.cone(0.028,0.1,4), '#e4ebf4', [0,1.08,0], null, [1,1,0.32]);
      D.a.tip = [0,1.1,0]; D.a.wbase = [0,0.12,0];
    } },
  mack: { fur:'#f0bc62', muzzle:'#f8dca8', body:'#4a6fa8', paw:'#f8dca8', leg:'#4a6fa8', foot:'#6a4020',
    build(D){ const geo = G.look.geo, b = part(D,'body'), h = part(D,'head');
      b.add(geo.lathe('mackPoncho', [[0,0.035],[0.25,0.035],[0.28,0.05],[0.27,0.1],[0.21,0.24],[0.11,0.35],[0,0.37]], 22), '#e0602c');
      for(const y of [0.12, 0.08]) b.add(geo.torus(0.262-(y-0.08)*0.5, 0.012, 5, 21), '#f6d8a0', [0,y,0], [HP,0,0]);
      b.add(geo.torus(0.115, 0.035, 6, 15), '#b8241c', [0,0.33,0], [HP,0,0]);
      b.add(geo.cone(0.085,0.13,3), '#b8241c', [0.15,0.27,0], [0,0,Math.PI+0.35], [0.5,1,1]);
      b.addM(geo.star(0.05,0.5,0.02), GOLD, M([0.17,0.18,0.11],[0,HP-0.6,0]));
      for(const [az,el] of [[1.3,0.2],[-1.3,0.2],[1.2,-0.3],[-1.2,-0.3],[0.85,-0.62],[-0.85,-0.62]])
        h.addM(geo.sphere(0.1,10,7), '#d89a3e', headM(az, el, -0.05, null, [1,1,0.55]));                              // mane
      for(const s of [-1,1]) h.add(geo.sphere(0.075, 8, 6), '#d89a3e', onHead(s*1.25, 0.62, 0.0), [s*-0.6,0,0.3], [0.9,0.6,1.1]);
      // ten-gallon hat
      const y = L.headC+0.25;
      h.add(geo.sphere(0.36,24,8), '#5c3c1e', [0, y, 0], [0,0,-0.1], [1,0.07,0.95]);
      h.add(geo.sphere(0.2,18,12), '#6e4a26', [-0.01, y+0.1, 0], [0,0,-0.1], [1,0.9,0.95]);
      h.add(geo.cylinder(0.198,0.2,0.05,20), '#3a2410', [-0.005, y+0.05, 0], [0,0,-0.1]);
      h.addM(geo.star(0.055,0.5,0.02), GOLD, M([0.2, y+0.1, 0],[0,HP,0]));
      tailOf(D, 'curl', '#d89a3e', '#f0bc62');
      for(const s of [-1,1]) part(D, s<0?'legL':'legR').add(geo.sphere(0.022,6,4), GOLD, [-0.07,-0.17,0]);
      const w = part(D,'weapon');
      w.add(geo.rbox(0.07,0.15,0.055,0.02,2), '#8a5a30', [0.02,-0.02,0], [0,0,-0.35]);
      w.add(geo.cylinder(0.028,0.028,0.24,10), '#7fb0e0', [-0.07,0.13,0]);
      w.add(geo.cylinder(0.05,0.05,0.075,10), '#e04848', [-0.07,0.04,0]);
      w.add(geo.cylinder(0.034,0.034,0.03,10), GOLD, [-0.07,0.25,0]);
      w.add(geo.cylinder(0.024,0.03,0.05,8), '#d8b080', [-0.07,0.285,0]);                            // cork
      D.a.tip = [-0.07,0.31,0]; D.a.wbase = [-0.07,0.05,0];
    } },
};

const PARTS = ['body','head','face','armL','armR','legL','legR','tail','earL','earR','cape','weapon','glasses','gem'];
function getModel(id){
  if(MODEL[id]) return MODEL[id];
  const T = DESIGN[id], D = { a:{}, T };
  buildCommon(D, T); T.build(D); buildEyes(D, T);
  const geos = {};
  for(const k of PARTS){ if(D[k] && !D[k].empty){ geos[k] = D[k].build(); } }
  geos.eyes = D.eyesGeo; geos.eyesX = D.xGeo; geos.eyesSq = D.sqGeo; geos.eyesHappy = D.happyGeo; geos.mouth = D.mouthGeo;
  for(const k in geos) geos[k].userData.shared = true;     // cached per hero, shared by every rig of that hero
  return (MODEL[id] = { geos, a:D.a, T });
}

// ---------------------------------------------------------------- shared small meshes' geometry/materials (lazy)
let SH = null;
function shared(){
  if(SH) return SH;
  const geo = G.look.geo;
  const sb = B();
  for(let i=0;i<3;i++){ const a = i/3*TAU; sb.add(geo.star(0.075,0.5,0.03), i===1?'#ffffff':'#ffe14d', [Math.cos(a)*0.3, Math.sin(a*2)*0.03, Math.sin(a)*0.3], [0, -a, 0]); }
  const starsGeo = sb.build(); starsGeo.userData.shared = true;
  SH = {
    starsGeo,
    starsMat: G.look.mat('#ffffff', { vertexColors:true, emissive:'#ffb400', emissiveIntensity:0.55, rough:0.4 }),
    haloGeo: geo.torus(0.17, 0.028, 6, 20),
    haloMat: G.look.mat('#ffd54a', { emissive:'#ffb000', emissiveIntensity:0.9, rough:0.3, metal:0.2, rim:0.6 }),
    gemMat: G.look.vmat({ emissive:'#ff5fb4', emissiveIntensity:0.55, rough:0.35 }),
    eyeMat: G.look.vmat({ rough:0.25, rim:0.2 }),       // same shared material G.look.eye uses
    faceMat: G.look.vmat({ rough:0.85, rim:0.15 }),
    glassMat: G.look.vmat({ rough:0.2, metal:0.1, rim:0.5 }),
  };
  return SH;
}
const glowMats = {};
function weaponGlowMat(col){ return glowMats[col] || (glowMats[col] = G.look.vmat({ emissive:col, emissiveIntensity:0.7, rough:0.35 })); }

// ---------------------------------------------------------------- rig
const COM = 0.55;          // roll pivot height (centre of mass), unscaled
const TURN = 0.61;         // 35° toward the camera
const HEADTURN = 0.22;     // the head looks a little more toward the camera
const AIMS = { atk1:1, atk2:1, atk3:1, atk4:1, chargeAtk:1, airAtk:1, airAtk2:1, dive:1, special:1, specialUp:0.6, specialDash:1, charge:0.6, run:0.45 };
function grp(parent, x, y, z){ const g = new THREE.Group(); g.position.set(x||0, y||0, z||0); if(parent) parent.add(g); return g; }

function build(id, opts){
  opts = opts || {};
  const hero = BYID[id] || BYID.inu; id = hero.id;
  const md = getModel(id), a = md.a, T = md.T, gs = md.geos, sh = shared();
  const scale = hero.scale || 1;
  const mat = G.look.vmat({ instance:true });                       // per-rig: hit flash, charge glow, fade
  const mesh = (geoName, parent, material, outline, shadow)=>{
    const m = new THREE.Mesh(gs[geoName], material || mat);
    m.castShadow = !!shadow; m.receiveShadow = false;
    if(outline) G.look.outline(m, outline);
    parent.add(m); return m;
  };
  const root = new THREE.Group(); root.name = 'hero-'+id;
  const mir = grp(root);  mir.scale.setScalar(scale);
  const yaw = grp(mir);
  const act = grp(yaw, 0, COM, 0);
  const sq = grp(act, 0, -COM, 0);
  const hips = grp(sq, 0, L.hipY, 0);
  const body = mesh('body', hips, null, 0.022, true);
  const legL = grp(sq, 0, L.hipY, -L.legZ), legR = grp(sq, 0, L.hipY, L.legZ);
  mesh('legL', legL, null, 0.02, false); mesh('legR', legR, null, 0.02, false);
  const neck = grp(hips, 0, L.neckY, 0);
  const head = mesh('head', neck, null, 0.022, true);
  mesh('face', neck, sh.faceMat, 0, false);
  const eyeP = grp(neck, 0, a.eyeY, 0);
  const eyes = mesh('eyes', eyeP, sh.eyeMat, 0, false);
  const eyesX = mesh('eyesX', eyeP, sh.eyeMat, 0, false); eyesX.visible = false;
  const eyesSq = mesh('eyesSq', eyeP, sh.eyeMat, 0, false); eyesSq.visible = false;
  const eyesHappy = mesh('eyesHappy', eyeP, sh.eyeMat, 0, false); eyesHappy.visible = false;
  const mouth = mesh('mouth', neck, sh.faceMat, 0, false); mouth.visible = false; mouth.position.set(a.mouthPos[0], a.mouthPos[1], 0);
  const mouthC = new THREE.Vector3(a.mouthPos[0], a.mouthPos[1], 0);
  let glasses = null;
  if(gs.glasses){ glasses = grp(eyeP); mesh('glasses', glasses, sh.glassMat, 0.012, false); }
  const sp = L.shoulder;
  const armL = grp(hips, sp[0], sp[1], -sp[2]), armR = grp(hips, sp[0], sp[1], sp[2]);
  mesh('armL', armL, null, 0.02, false); mesh('armR', armR, null, 0.02, false);
  const handR = grp(armR, L.hand[0], L.hand[1], L.hand[2]);
  const tip = new THREE.Object3D(), base = new THREE.Object3D();
  let wpn = null, gem = null;
  if(gs.weapon){
    wpn = grp(handR);
    mesh('weapon', wpn, T.weaponGlow ? weaponGlowMat(T.weaponGlow) : mat, 0.013, true);
    tip.position.fromArray(a.tip); base.position.fromArray(a.wbase);
    wpn.add(tip); wpn.add(base);
    if(gs.gem){ gem = grp(wpn, a.gemPos[0], a.gemPos[1], a.gemPos[2]); mesh('gem', gem, sh.gemMat, 0.01, false); }
  } else {                                   // bare paws: trail from the paw centre to the knuckles
    base.position.set(L.hand[0], L.hand[1]+0.03, 0); tip.position.set(L.hand[0]+0.02, L.hand[1]-0.07, 0);
    armR.add(base); armR.add(tip);
  }
  let earL = null, earR = null;
  if(gs.earL){ const p = a.earPivot;
    earL = grp(neck, p[0], p[1], -p[2]); earR = grp(neck, p[0], p[1], p[2]);
    mesh('earL', earL, null, 0.016, false); mesh('earR', earR, null, 0.016, false); }
  let tail = null;
  if(gs.tail){ const p = a.tailPivot; tail = grp(hips, p[0], p[1], p[2]); mesh('tail', tail, null, 0.016, false); }
  let cape = null;
  if(gs.cape){ const p = a.capePivot; cape = grp(hips, p[0], p[1], p[2]); mesh('cape', cape, null, 0.018, true); }
  const n_ = (g)=> g ? g.children[0] : null;
  let halo = null;
  if(T.halo){ halo = new THREE.Mesh(sh.haloGeo, sh.haloMat); halo.rotation.x = HP; halo.position.set(-0.02, L.headC+0.47, 0); halo.castShadow = false; neck.add(halo); }
  const stars = new THREE.Mesh(sh.starsGeo, sh.starsMat); stars.position.set(0, L.headC+0.42, 0); stars.visible = false; neck.add(stars);

  const rig = {
    root, heroId:id, style:hero.weapon, earType:a.earType||null, height:1.25*scale + (T.halo?0.08:0), radius:0.42*scale, scale,
    tip, base, mat,
    n:{ mir, yaw, act, sq, hips, body, head, neck, legL, legR, armL, armR, handR, wpn, gem, eyeP, eyes, eyesX, eyesSq, eyesHappy,
        mouth, glasses, earL, earR, tail, cape, halo, stars },
    mouthC,
    st: makeState(hero.weapon),
    alpha: 1,
    update(ent, dt){ updateRig(rig, ent, dt==null ? G.cfg.TICK : dt); },
    setAlpha(v){ setAlpha(rig, v); },
    dispose(){
      if(root.parent) root.parent.remove(root);
      mat.dispose();                                   // the only thing this rig created for itself (geometry is cached per hero)
      rig.disposed = true;
    },
  };
  // meshes on shared materials can't fade: they hide instead when the rig is mostly transparent
  rig.outlines = []; rig.sharedMeshes = [];
  root.traverse(o=>{ if(!o.isMesh) return; if(o.userData.isOutline) rig.outlines.push(o);
    else if(o.material!==mat && o!==eyes && o!==eyesX && o!==eyesSq && o!==eyesHappy && o!==mouth && o!==stars) rig.sharedMeshes.push(o); });
  // top of the head (incl. hat / ears / halo) in the idle pose, for HP bars and popups
  rig._measure = [head, n_(earL), n_(earR), halo];
  // default fists: tip follows the paw; kicks move it to the foot (see updateRig)
  rig.tipHome = tip.parent; rig.footTip = grp(legR, 0.1, -0.17, 0); rig.footBase = grp(legR, 0.0, -0.06, 0);
  // settle once so a freshly built rig already stands in its idle pose
  updateRig(rig, { anim:'idle', animT:0, animLen:0, animHit:0.35, face:1, vx:0, vy:0, vz:0, onGround:true, flashT:0, stun:0, charge:0 }, G.cfg.TICK, true);
  root.updateMatrixWorld(true);
  const box = new THREE.Box3();
  for(const o of rig._measure) if(o) box.expandByObject(o);
  rig.height = Math.round(box.max.y*100)/100; delete rig._measure;
  if(opts.anim || opts.menu || opts.face) updateRig(rig, { anim: opts.anim || 'pose', animT:0, animLen:0, animHit:0.35, face:opts.face||1, vx:0, vy:0, vz:0, onGround:true, flashT:0, stun:0, charge:0 }, G.cfg.TICK, true);
  return rig;
}

function setAlpha(rig, v){
  v = U.clamp(v, 0, 1);
  if(v===rig.alpha) return;
  rig.alpha = v;
  const m = rig.mat, fade = v < 0.999;
  m.transparent = fade; m.opacity = v;
  rig.hideShared = v < 0.45;
  for(const o of rig.outlines) o.visible = !fade && G.quality.tier < 2;
  for(const o of rig.sharedMeshes) o.visible = !rig.hideShared;
}

// ---------------------------------------------------------------- poses
// channels (radians / units). Arms: z = raise forward, y = sweep inward (across the body), x = spread outward.
// Legs: z = swing forward. Weapon: blade angle in the swing plane = arm z + wz (0 = forward when the arm hangs).
const CH = ['y','sq','fx','lean','twist','side','nod','hy','tilt','aLz','aLy','aLx','aRz','aRy','aRx','lLz','lRz','lLx','lRx','wz','wy','wx','mouth','tail','ear'];
const DIRECT = ['roll','spin','wspin'];        // not smoothed (they wrap / spin fully)
const ALL = CH.concat(DIRECT);
const REST0 = { y:0, sq:0, fx:0, lean:0.04, twist:0, side:0, nod:0.04, hy:0, tilt:0, aLz:0.15, aLy:0, aLx:0.32, aRz:0.35, aRy:0, aRx:0.32,
  lLz:0, lRz:0, lLx:0.05, lRx:0.05, wz:0.95, wy:0, wx:0, mouth:0, tail:0, ear:0, roll:0, spin:0, wspin:0 };
const REST = {};
const RESTX = {
  sword:  { aRz:0.5, wz:0.8 },
  fist:   { aLz:1.0, aRz:0.75, aLx:0.18, aRx:0.24, aLy:0.3, aRy:0.22 },
  staff:  { aRz:0.4, wz:1.1 },
  hammer: { aRz:1.05, wz:1.65, aRx:0.25, aLz:0.75, aLy:0.45, aLx:0.2 },
  cane:   { aRz:0.25, wz:-1.72 },
  katana: { aRz:0.85, aRy:0.15, wz:-0.1, aLz:0.8, aLy:0.55, aLx:0.15 },
  gun:    { aRz:0.3, wz:-1.0 },
};
for(const s in RESTX) REST[s] = Object.assign({}, REST0, RESTX[s]);
const TWOHAND = { hammer:true, katana:true };

function K(t, pose, ease){ return { t, pose, ease: ease||'io' }; }
const W=[0,0.72], H=[0,1], F=[0.3,0.7], R=[0.72,0.28], RC=[0.12,0.88];
const kt = (t,h)=> typeof t==='number' ? t : t[0]+t[1]*h;
function ease(kind, x){
  if(kind==='out') return 1-(1-x)*(1-x)*(1-x);
  if(kind==='in') return x*x*x;
  if(kind==='lin') return x;
  return x*x*(3-2*x);
}
function sampleKeys(keys, p, h, Q, rest){
  let i = 0; while(i < keys.length-2 && p >= kt(keys[i+1].t, h)) i++;
  const k0 = keys[i], k1 = keys[i+1], t0 = kt(k0.t,h), t1 = kt(k1.t,h);
  const x = ease(k1.ease, t1>t0 ? U.clamp((p-t0)/(t1-t0),0,1) : 1);
  for(let c=0;c<ALL.length;c++){
    const ch = ALL[c], a = k0.pose[ch], b = k1.pose[ch];
    const va = a===undefined ? rest[ch] : a, vb = b===undefined ? rest[ch] : b;
    Q[ch] = va + (vb-va)*x;
  }
}
const Z = {};      // "rest" key
// --- swing templates (absolute values; missing channels = the style's rest pose)
const T8 = {
  hslash: [K(0,Z),
    K(W,{aRz:1.35, aRy:-1.35, aRx:0.55, wz:-1.25, twist:0.55, lean:-0.06, sq:-0.07, aLz:0.7, aLy:-0.3}),
    K(H,{aRz:1.5, aRy:0.25, aRx:0.15, wz:-1.5, twist:-0.3, lean:0.18, fx:0.1, sq:0.06, mouth:1, aLz:0.2, aLy:0.2},'out'),
    K(F,{aRz:1.35, aRy:1.25, aRx:0.1, wz:-1.4, twist:-0.6, lean:0.14, fx:0.1, mouth:0.6, aLz:0.1}),
    K(1,Z)],
  back: [K(0,Z),
    K(W,{aRz:1.3, aRy:1.35, aRx:0.05, wz:-1.3, twist:-0.55, lean:-0.04, sq:-0.06, aLz:0.3}),
    K(H,{aRz:1.5, aRy:-0.2, aRx:0.3, wz:-1.5, twist:0.25, lean:0.16, fx:0.1, sq:0.05, mouth:1, aLz:0.6, aLy:-0.2},'out'),
    K(F,{aRz:1.35, aRy:-1.15, aRx:0.5, wz:-1.4, twist:0.5, lean:0.12, fx:0.1, mouth:0.6}),
    K(1,Z)],
  up: [K(0,Z),
    K(W,{aRz:-0.55, aRy:-0.25, wz:0.15, lean:0.16, sq:-0.12, aLz:0.6}),
    K(H,{aRz:2.05, aRy:0.1, wz:-0.9, lean:-0.08, sq:0.12, y:0.04, fx:0.06, nod:0.2, mouth:1, aLz:0.9},'out'),
    K(F,{aRz:2.8, wz:-0.55, lean:-0.14, sq:0.06, nod:0.25, mouth:0.6}),
    K(1,Z)],
  diag: [K(0,Z),
    K(W,{aRz:2.6, aRy:-0.8, wz:0.25, twist:0.45, lean:-0.12, sq:0.04, aLz:0.9}),
    K(H,{aRz:0.85, aRy:0.5, wz:-0.8, twist:-0.35, lean:0.22, fx:0.09, sq:-0.05, mouth:1, aLz:0.3},'out'),
    K(F,{aRz:0.15, aRy:1.0, wz:-0.4, twist:-0.5, lean:0.26, fx:0.1, mouth:0.6}),
    K(1,Z)],
  over: [K(0,Z),
    K(W,{aRz:3.0, aRy:-0.15, wz:0.45, lean:-0.25, y:0.14, sq:0.12, nod:0.2, aLz:2.4, aLx:0.5}),
    K(H,{aRz:0.55, wz:-0.3, lean:0.42, y:0, sq:-0.2, fx:0.14, mouth:1, aLz:0.5, nod:-0.1},'out'),
    K(F,{aRz:0.4, wz:-0.45, lean:0.36, sq:-0.1, fx:0.13, mouth:0.8}),
    K(1,Z)],
  thrust: [K(0,Z),
    K(W,{aRz:1.1, aRy:-0.25, wz:-1.1, fx:-0.07, lean:-0.1, twist:0.4, sq:-0.05, aLz:0.9, aLx:0.6}),
    K(H,{aRz:1.55, aRy:0.1, wz:-1.55, fx:0.17, lean:0.26, twist:-0.3, sq:0.06, mouth:1, aLz:0.2, aLx:0.8},'out'),
    K(F,{aRz:1.5, wz:-1.5, fx:0.15, lean:0.2, twist:-0.25, mouth:0.5}),
    K(1,Z)],
  jabL: [K(0,Z),
    K(W,{aLz:0.75, twist:0.22, sq:-0.04}),
    K(H,{aLz:1.62, aLy:0.5, aLx:0.0, twist:-0.6, fx:0.12, lean:0.14, mouth:1, aRz:0.5},'out'),
    K(F,{aLz:1.55, aLy:0.45, twist:-0.5, fx:0.11, lean:0.12}),
    K(1,Z)],
  jabR: [K(0,Z),
    K(W,{aRz:0.6, twist:-0.25, sq:-0.04}),
    K(H,{aRz:1.62, aRy:0.38, aRx:0.04, twist:0.42, fx:0.1, lean:0.14, mouth:1},'out'),
    K(F,{aRz:1.55, aRy:0.32, twist:0.36, fx:0.1, lean:0.12}),
    K(1,Z)],
  hook: [K(0,Z),
    K(W,{aRz:1.3, aRy:-1.1, aRx:0.65, twist:0.55, sq:-0.08, lean:-0.05}),
    K(H,{aRz:1.5, aRy:0.65, aRx:0.2, twist:-0.55, fx:0.1, lean:0.16, sq:0.05, mouth:1},'out'),
    K(F,{aRz:1.4, aRy:1.05, twist:-0.65, fx:0.1, lean:0.14}),
    K(1,Z)],
  kick: [K(0,Z),
    K(W,{lRz:-0.7, lean:-0.08, sq:-0.1, aLz:1.1, aRz:1.1}),
    K(H,{lRz:1.75, lLz:-0.25, lean:-0.38, y:0.06, fx:0.08, aLz:0.5, aRz:0.4, aRx:0.9, aLx:0.7, mouth:1, tipFoot:1},'out'),
    K(F,{lRz:1.35, lean:-0.3, y:0.03, fx:0.08, tipFoot:1}),
    K(1,Z)],
  cast: [K(0,Z),
    K(W,{aRz:2.4, wz:-0.4, aLz:0.9, lean:-0.12, sq:0.05, nod:0.15}),
    K(H,{aRz:1.45, wz:-1.45, aLz:1.35, aLy:0.45, fx:0.07, lean:0.16, mouth:1},'out'),
    K(F,{aRz:1.45, wz:-1.45, aLz:1.25, aLy:0.4, fx:0.06, lean:0.12, mouth:0.5}),
    K(1,Z)],
  bigcast: [K(0,Z),
    K(W,{aRz:3.0, wz:-0.1, aLz:2.8, aLx:0.6, y:0.08, sq:0.12, nod:0.35, lean:-0.2}),
    K(H,{aRz:1.5, wz:-1.5, aLz:1.45, aLy:0.3, lean:0.22, sq:-0.12, fx:0.06, mouth:1},'out'),
    K(F,{aRz:1.5, wz:-1.5, aLz:1.35, lean:0.18, sq:-0.05, mouth:0.8}),
    K(1,Z)],
  shoot: [K(0,Z),
    K(W,{aRz:1.52, wz:-1.55, aLz:0.55, twist:-0.12, lean:0.05}),
    K(H,{aRz:1.52, wz:-1.55, aLz:0.55, twist:-0.12, lean:0.05}),
    K(RC,{aRz:2.05, wz:-1.35, aLz:0.7, lean:-0.14, fx:-0.05, twist:-0.05, mouth:1, sq:-0.05},'out'),
    K(F,{aRz:1.6, wz:-1.5, lean:0.02, mouth:0.3}),
    K(1,Z)],
  twirl: [K(0,Z),
    K(W,{aRz:1.25, wz:-1.25, twist:0.3, aLz:0.6}),
    K(H,{aRz:1.4, wz:-1.4, twist:-0.2, fx:0.08, lean:0.12, mouth:1, wspin:-TAU*0.6},'out'),
    K(F,{aRz:1.35, wz:-1.35, twist:-0.25, fx:0.06, wspin:-TAU},'out'),
    K(1,{wspin:-TAU})],
  spinslash: [K(0,Z),
    K(W,{aRz:1.3, aRy:-1.0, wz:-1.3, sq:-0.12, aLz:1.0, aLx:0.7, spin:0.4}),
    K(H,{aRz:1.5, aRy:0.1, wz:-1.5, sq:0.02, aLz:1.2, aLx:0.9, mouth:1, spin:-TAU},'in'),
    K(F,{aRz:1.45, aRy:0.6, wz:-1.45, aLz:1.1, aLx:0.8, spin:-TAU-0.45, fx:0.06},'out'),
    K(1,{spin:-TAU})],
  spinShoot: [K(0,Z),
    K([0,0.55],{aRz:1.2, wz:-1.2, wspin:-TAU, aLz:0.4},'lin'),
    K(W,{aRz:1.52, wz:-1.55, wspin:-TAU, aLz:0.6, twist:-0.12}),
    K(H,{aRz:1.52, wz:-1.55, wspin:-TAU, aLz:0.6, twist:-0.12}),
    K(RC,{aRz:2.3, wz:-1.3, wspin:-TAU, lean:-0.26, fx:-0.08, sq:-0.1, mouth:1},'out'),
    K(F,{aRz:1.7, wz:-1.5, wspin:-TAU}),
    K(1,{wspin:-TAU})],
  hadou: [K(0,Z),
    K(W,{aLz:-0.35, aRz:-0.35, aLy:-0.2, aRy:-0.2, twist:0.6, sq:-0.12, lean:-0.08}),
    K(H,{aLz:1.55, aRz:1.55, aLy:0.42, aRy:0.42, aLx:0.05, aRx:0.05, fx:0.1, lean:0.22, sq:0.06, mouth:1},'out'),
    K(F,{aLz:1.5, aRz:1.5, aLy:0.4, aRy:0.4, fx:0.1, lean:0.18, mouth:0.8}),
    K(1,Z)],
  toss: [K(0,Z),
    K(W,{aRz:1.35, aRy:1.4, wz:-1.35, twist:-0.5, sq:-0.05}),
    K(H,{aRz:1.45, aRy:-0.9, wz:-1.45, twist:0.4, fx:0.06, lean:0.1, mouth:1},'out'),
    K(F,{aRz:1.3, aRy:-1.2, wz:-1.3, twist:0.45}),
    K(1,Z)],
  lob: [K(0,Z),
    K(W,{aLz:-0.9, aLx:0.3, lean:-0.2, twist:-0.35, sq:-0.06}),
    K(H,{aLz:2.5, aLy:0.3, lean:0.15, twist:0.3, mouth:1, sq:0.06},'out'),
    K(F,{aLz:1.7, lean:0.12, twist:0.25}),
    K(1,Z)],
  iai: [K(0,Z),
    K(W,{aRz:0.55, aRy:1.25, wz:-2.55, aLz:0.35, aLy:0.2, twist:-0.35, lean:0.24, sq:-0.14}),
    K(H,{aRz:1.5, aRy:-0.9, aRx:0.3, wz:-1.5, twist:0.4, lean:0.3, fx:0.16, sq:0.04, mouth:1},'out'),
    K(F,{aRz:1.4, aRy:-1.2, aRx:0.4, wz:-1.4, twist:0.45, lean:0.24, fx:0.15}),
    K(1,Z)],
  rise: [K(0,Z),
    K(W,{aRz:-0.4, wz:0.25, sq:-0.2, lean:0.18, aLz:-0.2}),
    K(H,{aRz:2.3, aRx:0.6, wz:-0.9, wx:0.5, sq:0.24, y:0.1, lean:-0.14, nod:0.35, mouth:1, lLz:0.55, lRz:-0.3, aLz:0.8},'out'),
    K(F,{aRz:2.25, aRx:0.6, wz:-0.9, wx:0.5, sq:0.12, y:0.06, lean:-0.1, nod:0.3, lLz:0.5, mouth:0.8}),
    K(1,Z)],
  riseKick: [K(0,Z),
    K(W,{sq:-0.2, lean:0.2, aRz:0.2, lRz:-0.5}),
    K(H,{lRz:2.5, lLz:-0.3, aRz:2.8, aRy:0.3, sq:0.22, y:0.1, lean:-0.35, nod:0.3, mouth:1, tipFoot:1},'out'),
    K(F,{lRz:2.2, aRz:2.6, sq:0.12, y:0.08, lean:-0.3, nod:0.3, tipFoot:1}),
    K(1,Z)],
  smoke: [K(0,Z),
    K(W,{aLz:2.4, aLx:0.3, sq:0.06, nod:0.2, lean:-0.1}),
    K(H,{aLz:0.3, aLy:0.3, sq:-0.14, lean:0.25, nod:-0.2, mouth:1},'out'),
    K(F,{aLz:0.3, sq:-0.05, lean:0.1}),
    K(1,Z)],
  rocket: [K(0,Z),
    K(W,{aRz:2.3, aRx:0.7, wz:-1.0, wx:0.5, aLz:1.0, lean:-0.2, nod:0.3}),
    K(H,{aRz:2.3, aRx:0.7, wz:-1.0, wx:0.5, aLz:1.0, lean:-0.2, nod:0.3}),
    K(RC,{aRz:2.6, aRx:0.75, wz:-0.9, wx:0.5, lean:-0.34, sq:-0.12, nod:0.45, mouth:1},'out'),
    K(F,{aRz:2.35, aRx:0.7, wz:-1.0, wx:0.5, lean:-0.2, nod:0.3}),
    K(1,Z)],
  dash: [K(0,Z),
    K(W,{aRz:0.5, aRy:1.2, wz:-2.4, lean:0.5, sq:-0.16, aLz:-0.3, twist:-0.3}),
    K(H,{aRz:1.5, aRy:-1.0, wz:-1.5, lean:0.45, fx:0.16, twist:0.35, mouth:1, aLz:-0.5},'out'),
    K(F,{aRz:1.4, aRy:-1.2, wz:-1.4, lean:0.4, fx:0.14, twist:0.4, aLz:-0.5}),
    K(1,Z)],
  tackle: [K(0,Z),
    K(W,{lean:0.25, sq:-0.18, aRz:-0.5, wz:1.9, aLz:0.9, aLy:0.2}),
    K(H,{lean:0.65, fx:0.14, sq:0.05, aRz:-0.55, wz:1.9, aLz:1.45, aLx:0.3, mouth:1, nod:-0.2},'out'),
    K(R,{lean:0.6, fx:0.12, aRz:-0.5, wz:1.9, aLz:1.4, nod:-0.2}),
    K(1,Z)],
  spinKick: [K(0,Z),
    K(W,{sq:-0.12, lRz:-0.3, aLz:1.1, aRz:1.1}),
    K(H,{lRz:1.6, lean:-0.2, aLx:1.1, aRx:1.1, aLz:0.6, aRz:0.6, y:0.06, mouth:1, spin:-TAU*0.5, tipFoot:1},'lin'),
    K(R,{lRz:1.6, lean:-0.2, aLx:1.1, aRx:1.1, aLz:0.6, aRz:0.6, y:0.06, spin:-TAU*2, tipFoot:1},'lin'),
    K(1,{spin:-TAU*2})],
  slide: [K(0,Z),
    K(W,{sq:-0.15, lean:0.2}),
    K(H,{roll:1.0, y:-0.28, lLz:1.3, lRz:1.1, aRz:1.9, wz:-1.9, aLz:2.4, mouth:1, nod:-0.3},'out'),
    K(R,{roll:0.95, y:-0.28, lLz:1.3, lRz:1.1, aRz:1.9, wz:-1.9, aLz:2.4, nod:-0.3}),
    K(1,Z)],
  drill: [K(0,Z),
    K(W,{lean:0.3, sq:-0.12, aRz:1.5, wz:-1.5, aLz:1.5, aLy:0.3}),
    K(H,{lean:0.85, fx:0.12, aRz:1.55, wz:-1.55, aLz:1.55, aLy:0.35, mouth:1, spin:0, wspin:0},'out'),
    K(R,{lean:0.85, fx:0.12, aRz:1.55, wz:-1.55, aLz:1.55, aLy:0.35, wspin:TAU*4},'lin'),
    K(1,{wspin:TAU*4})],
  air: [K(0,Z),
    K(W,{aRz:2.7, wz:0.3, lean:-0.15, sq:0.08, aLz:1.5, lLz:0.4, lRz:0.1}),
    K(H,{aRz:0.7, wz:-0.6, lean:0.3, sq:-0.06, roll:-0.2, mouth:1, aLz:0.5, lLz:0.5, lRz:0.2},'out'),
    K(F,{aRz:0.5, wz:-0.6, lean:0.25, roll:-0.15, lLz:0.4}),
    K(1,Z)],
  flip: [K(0,Z),
    K(W,{aRz:1.5, wz:-1.5, sq:-0.12, lLz:0.9, lRz:0.9, aLz:1.2, roll:-0.4}),
    K(H,{aRz:1.5, wz:-1.5, sq:-0.12, lLz:0.9, lRz:0.9, aLz:1.2, roll:-TAU*0.5, mouth:1},'lin'),
    K(F,{aRz:1.4, wz:-1.4, sq:-0.05, lLz:0.5, lRz:0.5, roll:-TAU},'out'),
    K(1,{roll:-TAU})],
  chargeAtk: [K(0,Z),
    K(W,{aRz:1.3, aRy:-1.1, wz:-1.3, sq:-0.14, twist:0.5, aLz:1.0, aLx:0.8}),
    K(H,{aRz:1.5, wz:-1.5, aLz:1.2, aLx:0.95, sq:0.03, mouth:1, spin:-TAU*0.45},'lin'),
    K([0.62,0.38],{aRz:1.5, wz:-1.5, aLz:1.2, aLx:0.95, spin:-TAU},'out'),
    K(1,{spin:-TAU})],
  ult: [K(0,Z),
    K(0.18,{sq:-0.22, lean:0.22, aRz:-0.45, wz:0.5, aLz:-0.3, nod:-0.2}),
    K(0.4,{y:0.22, sq:0.2, aRz:2.3, aRx:0.7, wz:-0.95, wx:0.55, aLz:2.6, aLx:0.7, nod:0.4, mouth:1, lLz:0.6, lRz:-0.5},'out'),
    K(0.62,{y:0.04, sq:-0.06, aRz:2.2, aRx:0.7, wz:-0.9, wx:0.55, aLz:0.95, aLy:0.4, aLx:0.3, nod:0.25, mouth:1, lean:-0.1, lLz:0.25, lRz:-0.2},'out'),
    K(1,{y:0.02, aRz:2.2, aRx:0.7, wz:-0.9, wx:0.55, aLz:0.95, aLy:0.4, aLx:0.3, nod:0.22, mouth:0.8, lean:-0.1, lLz:0.25, lRz:-0.2})],
  hurt: [K(0,Z),
    K(0.14,{sq:-0.24, lean:-0.38, fx:-0.1, nod:0.35, aLz:1.9, aRz:1.7, aLx:0.9, aRx:0.9, mouth:1, lLz:0.35, lRz:0.2},'out'),
    K(0.5,{sq:0.07, lean:-0.16, fx:-0.05, nod:0.15, aLz:1.0, aRz:1.0, aLx:0.6, aRx:0.6, mouth:0.6}),
    K(1,Z)],
  getup: [K(0,{roll:HP, y:-0.14, aLz:2.3, aRz:2.0, lLz:0.4, lRz:0.2}),
    K(0.35,{roll:0.95, y:-0.1, aLz:0.4, aRz:0.4, lLz:0.9, lRz:0.9, sq:-0.1}),
    K(0.62,{roll:-0.08, y:0.12, sq:0.16, aLz:2.3, aRz:2.2, aLx:0.6, aRx:0.6},'out'),
    K(0.8,{sq:-0.16, y:0}),
    K(1,Z)],
  ko: [K(0,Z),
    K(0.14,{sq:-0.22, lean:-0.3, nod:0.4, mouth:1, aLz:2.0, aRz:1.8}),
    K(0.42,{roll:1.8, y:-0.06, aLz:2.6, aRz:2.4, lLz:0.8, lRz:0.6},'in'),
    K(0.58,{roll:1.4, y:0.06, aLz:2.2, aRz:2.2, lLz:0.6, lRz:0.3},'out'),
    K(0.74,{roll:HP+0.04, y:-0.15, sq:-0.08, aLz:2.5, aRz:2.3, lLz:0.4, lRz:0.2},'in'),
    K(1,{roll:HP, y:-0.14, aLz:2.4, aRz:2.2, aLx:0.8, aRx:0.8, lLz:0.4, lRz:0.2})],
  dodge: [K(0,Z),
    K(0.12,{sq:-0.2, lean:0.3, aLz:1.6, aRz:1.4, aLx:0.1, aRx:0.1, lLz:0.9, lRz:0.9, y:-0.1}),
    K(0.8,{sq:-0.2, lean:0.3, aLz:1.6, aRz:1.4, aLx:0.1, aRx:0.1, lLz:0.9, lRz:0.9, y:-0.1, roll:-TAU},'io'),
    K(1,{roll:-TAU})],
};
// weapon style → which template each attack uses
const MOVES = {
  sword:  { atk1:'hslash', atk2:'up', atk3:'diag', atk4:'over', special:'hslash', specialUp:'rise', specialDash:'dash', airAtk:'air', airAtk2:'flip' },
  fist:   { atk1:'jabR', atk2:'jabL', atk3:'hook', atk4:'kick', special:'hadou', specialUp:'riseKick', specialDash:'spinKick', airAtk:'kick', airAtk2:'flip', chargeAtk:'spinKick' },
  staff:  { atk1:'diag', atk2:'up', atk3:'cast', atk4:'bigcast', special:'cast', specialUp:'bigcast', specialDash:'thrust', airAtk:'cast', airAtk2:'flip', chargeAtk:'bigcast' },
  hammer: { atk1:'hslash', atk2:'back', atk3:'up', atk4:'over', special:'over', specialUp:'rise', specialDash:'tackle', airAtk:'over', airAtk2:'flip' },
  cane:   { atk1:'thrust', atk2:'thrust', atk3:'twirl', atk4:'up', special:'toss', specialUp:'smoke', specialDash:'slide', airAtk:'thrust', airAtk2:'flip' },
  katana: { atk1:'iai', atk2:'over', atk3:'up', atk4:'spinslash', special:'iai', specialUp:'up', specialDash:'dash', airAtk:'air', airAtk2:'flip' },
  gun:    { atk1:'shoot', atk2:'shoot', atk3:'shoot', atk4:'spinShoot', special:'lob', specialUp:'rocket', specialDash:'drill', airAtk:'shoot', airAtk2:'flip', chargeAtk:'spinShoot' },
};
const ONESHOT_LEN = { land:10, atk1:18, atk2:18, atk3:20, atk4:26, chargeAtk:30, airAtk:18, airAtk2:22, dodge:22, special:30,
  specialUp:30, specialDash:28, ult:80, hurt:18, getup:30, ko:50 };

const KICKS = { kick:1, riseKick:1, spinKick:1 };
function makeState(style){
  const P = {}, Q = {};
  for(const k of ALL){ P[k] = REST[style][k]; Q[k] = P[k]; }
  const spring = ()=>({ x:0, v:0 });
  return { P, Q, init:false, tw:1, runPh:0, stepN:0, blinkT:0, blinkNext:90+Math.random()*120, t:0,
    eBack:spring(), eFlap:spring(), tYaw:spring(), tLift:spring(), cSwing:spring(), cFlare:spring(),
    prevHY:0, aim:0, lastAnim:'', eyeMode:'open', tpl:null, gemSpin:0 };
}
// damped spring toward target, frame-rate independent (fixed 1/120 s substeps)
function spring(s, target, k, c, dt){
  let n = Math.max(1, Math.ceil(dt*120)); const h = dt/n;
  while(n--){ s.v += (k*(target - s.x) - c*s.v)*h; s.x += s.v*h; }
  if(s.x!==s.x){ s.x = 0; s.v = 0; }
}
const ANIMS = { idle:1, run:1, jump:1, fall:1, land:1, atk1:1, atk2:1, atk3:1, atk4:1, charge:1, chargeAtk:1, airAtk:1, airAtk2:1,
  dive:1, dodge:1, special:1, specialUp:1, specialDash:1, ult:1, hurt:1, down:1, getup:1, dizzy:1, ko:1, victory:1, pose:1, cheer:1 };

function updateRig(rig, e, dt, first){
  const st = rig.st, style = rig.style, rest = REST[style], P = st.P, Q = st.Q, n = rig.n;
  let anim = e.anim; if(!ANIMS[anim]) anim = 'idle';
  const T = e.animT || 0;
  const len = e.animLen > 0 ? e.animLen : (ONESHOT_LEN[anim] || 0);
  const p = len > 0 ? U.clamp(T/len, 0, 1) : 0;
  const h = U.clamp(e.animHit==null ? 0.35 : e.animHit, 0.05, 0.95);
  st.t += dt*60;
  if(anim!==st.lastAnim){
    st.lastAnim = anim;
    if(anim==='dodge') st.backRoll = (e.vx||0)*(e.face||1) < -0.01;   // backward roll when dodging backward
  }
  for(let i=0;i<ALL.length;i++) Q[ALL[i]] = rest[ALL[i]];
  let eyes = 'open', stars = false, oneshot = false, tpl = null, glow = 0;
  const moves = MOVES[style];

  switch(anim){
    case 'idle': {
      const t = st.t;
      Q.sq += 0.018*Math.sin(t*0.075); Q.nod += 0.03*Math.sin(t*0.037);
      Q.aLz += 0.05*Math.sin(t*0.075+1); Q.aRz += 0.035*Math.sin(t*0.075+1.6);
      if(style==='fist'){ Q.y += 0.022*Math.abs(Math.sin(t*0.12)); Q.aLz += 0.08*Math.sin(t*0.24); Q.aRz += 0.08*Math.sin(t*0.24+1.5); }
      Q.tail += 0.35*Math.sin(t*0.09);
      break; }
    case 'run': {
      const spd = Math.hypot(e.vx||0, e.vz||0);
      st.runPh += (0.2 + Math.min(spd, 0.16)*2.6) * dt*60;
      const s = Math.sin(st.runPh), as = Math.abs(s);
      const stepN = Math.floor((st.runPh + HP)/Math.PI);
      if(stepN!==st.stepN){ st.stepN = stepN; if(e.id && !first && G.bus) G.bus.emit('step', { ent:e }); }
      Q.lLz = 0.95*s; Q.lRz = -0.95*s;
      const armAmp = style==='fist' ? 0.7 : 0.45;
      Q.aLz += -0.8*s; Q.aRz += armAmp*s;
      Q.y = 0.075*(1-as); Q.sq = 0.06*(1-as) - 0.06*as*as;
      Q.lean = 0.24; Q.nod = -0.1; Q.twist = 0.12*s; Q.hy = -0.06*s;
      Q.tail = 0.7*Math.sin(st.runPh*2);
      break; }
    case 'jump': case 'fall': {
      const vy = e.vy||0;
      if(anim==='jump' && vy>0){ Q.sq = 0.1 + U.clamp(vy*1.6, 0, 0.12); Q.lLz = 0.6; Q.lRz = -0.2; Q.aLz = 2.2; Q.aRz = rest.aRz + 0.9; Q.lean = -0.05; Q.nod = 0.15; }
      else { Q.sq = 0.05; Q.lLz = 0.3; Q.lRz = 0.45; Q.aLz = 2.3 + 0.2*Math.sin(st.t*0.45); Q.aRz = rest.aRz + 1.0 + 0.15*Math.sin(st.t*0.45+1); Q.nod = 0.12; Q.mouth = vy < -0.25 ? 0.6 : 0; }
      Q.lLx = 0.15; Q.lRx = 0.15; Q.aLx = 0.55; Q.aRx = 0.5;
      break; }
    case 'land': {
      oneshot = true;
      Q.sq = -0.3*Math.exp(-4*p)*Math.cos(9*p); Q.aLx += 0.35*(1-p); Q.aRx += 0.3*(1-p); Q.lLx += 0.12*(1-p); Q.lRx += 0.12*(1-p);
      break; }
    case 'charge': {
      const c = U.clamp(e.charge||0, 0, 1), t = st.t;
      Q.sq = -0.12 - 0.06*c; Q.lean = -0.06; Q.y = -0.02;
      if(style==='fist'){ Q.aLz = -0.25; Q.aRz = -0.25; Q.aLx = 0.5; Q.aRx = 0.5; }
      else { Q.aRz = -0.35; Q.aRy = -0.4; Q.wz = 0.95; Q.aLz = 0.8; }
      Q.fx += (Math.random()-0.5)*0.022*(0.35+c); Q.side += (Math.random()-0.5)*0.05*c;
      Q.lLx = 0.18; Q.lRx = 0.18;
      eyes = 'sq'; glow = c*(0.7+0.3*Math.sin(t*0.5));
      break; }
    case 'dive': {
      Q.roll = style==='fist' ? -0.5 : -0.75; Q.sq = 0.14; Q.mouth = 1; Q.aLz = 1.9; Q.lLz = -0.5; Q.lRz = -0.3;
      if(style==='fist'){ Q.lRz = 1.4; Q.aRz = 1.9; tpl = 'kick'; } else { Q.aRz = 0.35; Q.wz = -1.95; }
      break; }
    case 'down': {
      Q.roll = HP; Q.y = -0.14; Q.aLz = 2.4; Q.aRz = 2.2; Q.aLx = 0.8; Q.aRx = 0.8; Q.lLz = 0.45; Q.lRz = 0.25;
      Q.sq = 0.02*Math.sin(st.t*0.08); eyes = 'x';
      break; }
    case 'dizzy': {
      const t = st.t;
      Q.side = 0.16*Math.sin(t*0.1); Q.tilt = 0.25*Math.sin(t*0.1+0.8); Q.nod = 0.08 + 0.12*Math.cos(t*0.1);
      Q.aLz = -0.05; Q.aRz = 0.15; Q.aLx = 0.55 + 0.15*Math.sin(t*0.1); Q.aRx = 0.5; Q.fx = 0.05*Math.sin(t*0.1);
      Q.sq = -0.03 + 0.03*Math.sin(t*0.2); Q.mouth = 0.5; eyes = 'x'; stars = true;
      break; }
    case 'victory': case 'cheer': {
      const ph = ((T % 56)/56), hop = U.bump(ph, 0, 0.5);
      Q.y = 0.2*hop; Q.sq = hop>0 ? 0.1*hop : 0; if(ph>0.5 && ph<0.62) Q.sq = -0.14*U.bump(ph,0.5,0.62);
      const w = Math.sin(st.t*0.22);
      if(anim==='victory' && style!=='fist'){ Q.aRz = 2.25; Q.wz = style==='gun' ? -1.0 : -0.9; Q.wx = 0.55; Q.aRx = 0.7; Q.aLz = 2.2 + 0.4*w; Q.aLx = 0.6; }
      else { Q.aLz = 2.6 + 0.35*w; Q.aRz = 2.6 - 0.35*w; Q.aLx = 0.55; Q.aRx = 0.55; if(style!=='fist') Q.wz = -0.3; }
      Q.nod = 0.25; Q.mouth = 1; Q.tail = 0.9*Math.sin(st.t*0.5); Q.lLz = 0.3*hop; Q.lRz = -0.3*hop;
      eyes = 'happy';
      break; }
    case 'pose': {
      posePersonality(rig, Q, rest, T, st.t);
      eyes = Q._eyes || 'open';
      break; }
    case 'hurt': {
      oneshot = true; sampleKeys(T8.hurt, p, h, Q, rest);
      // hurtDir = world direction the hit pushes us; in model space that is hurtDir*face
      const pushFwd = (e.hurtDir||-(e.face||1))*(e.face||1) > 0;
      if(pushFwd){ Q.lean = -Q.lean*0.8; Q.fx = -Q.fx; Q.nod = -Q.nod*0.6; }
      eyes = 'sq';
      break; }
    case 'dodge': {
      oneshot = true; sampleKeys(T8.dodge, p, h, Q, rest);
      if(st.backRoll){ Q.roll = -Q.roll; Q.lean = -Q.lean; }
      break; }
    case 'getup': oneshot = true; sampleKeys(T8.getup, p, h, Q, rest); if(p<0.4) eyes = 'x'; break;
    case 'ko': oneshot = true; sampleKeys(T8.ko, p, h, Q, rest); eyes = p<0.14 ? 'sq' : 'x'; stars = p>0.6; break;
    case 'ult': {
      oneshot = true; tpl = 'ult'; sampleKeys(T8.ult, p, h, Q, rest);
      if(style==='fist'){ Q.aLz = Q.aRz; Q.aLx = Q.aRx + 0.2; }
      if(style==='gun'){ Q.wz = -0.95; }
      if(p>0.55 && p<0.7) eyes = 'sq';
      break; }
    default: {   // attacks / specials / air
      oneshot = true;
      tpl = (moves && moves[anim]) || (anim==='chargeAtk' ? 'chargeAtk' : 'hslash');
      const keys = T8[tpl] || T8.hslash;
      sampleKeys(keys, p, h, Q, rest);
      if(anim==='chargeAtk' && style==='hammer'){ Q.spin *= 2; }
      if(style==='hammer' && (tpl==='over')) Q.sq *= 1.3;
      if(tpl==='hurt') eyes='sq';
    }
  }
  st.tpl = tpl;
  if(TWOHAND[style] && (oneshot && anim!=='hurt' && anim!=='ko' && anim!=='getup' && anim!=='dodge') || (TWOHAND[style] && anim==='charge')){
    Q.aLz = Q.aRz*0.95; Q.aLy = U.clamp(0.5 - Q.aRy*1.1, -1.2, 1.0); Q.aLx = 0.12;
  }

  // ---- smooth toward the target pose
  if(first || !st.init){ for(let i=0;i<ALL.length;i++) P[ALL[i]] = Q[ALL[i]]; st.init = true; st.tw = (e.face||1)>=0?1:-1; }
  else {
    const k = oneshot ? (T < 3 ? 26 : 70) : 13;
    const a = 1 - Math.exp(-k*dt);
    for(let i=0;i<CH.length;i++){ const c = CH[i]; P[c] += (Q[c]-P[c])*a; }
    // direct channels: exact during one-shots (full turns), otherwise ease the short way round
    const al = 1 - Math.exp(-11*dt);
    for(let i=0;i<DIRECT.length;i++){
      const c = DIRECT[i];
      if(oneshot){ P[c] = Q[c]; continue; }
      let d = (Q[c] - P[c]) % TAU; if(d > Math.PI) d -= TAU; if(d < -Math.PI) d += TAU;
      P[c] = Q[c] - d + d*al; if(Math.abs(P[c]-Q[c])<1e-4) P[c] = Q[c];
    }
  }
  // attacks turn the body toward the target (more profile) so swings read left/right; the head keeps looking at us
  const aimT = AIMS[anim] || 0;
  st.aim = first ? aimT : st.aim + (aimT - st.aim)*(1 - Math.exp(-(aimT>st.aim?16:6)*dt));
  applyPose(rig, e, dt, first, anim, eyes, stars, glow, T, p);
}

function applyPose(rig, e, dt, first, anim, eyes, stars, glow, T, p){
  const st = rig.st, P = st.P, n = rig.n, sc = rig.scale;
  // ---- facing: turn through "facing the camera", mirror when crossing it (weapon hand stays on the camera side)
  const face = (e.face||1) >= 0 ? 1 : -1;
  if(first) st.tw = face; else st.tw = U.approach(st.tw, face, 0.2*dt*60);
  const aw = Math.abs(st.tw), sgn = st.tw >= 0 ? 1 : -1;
  n.mir.scale.set(sgn*sc, sc, sc);
  const tb = TURN*(1 - 0.7*st.aim);
  n.yaw.rotation.y = -(tb + (1-aw)*(HP - tb));
  // ---- body
  n.act.position.set(P.fx, COM + P.y, 0);
  n.act.rotation.set(0, 0, P.roll);
  const s = Math.max(0.4, 1 + P.sq), ss = 1/Math.sqrt(s);
  n.sq.scale.set(ss, s, ss);
  n.hips.rotation.set(P.side, P.twist + P.spin, -P.lean);
  n.neck.rotation.set(P.tilt, P.hy - (HEADTURN + 0.28*st.aim)*aw, P.nod);
  n.armL.rotation.set(P.aLx, -P.aLy, P.aLz);
  n.armR.rotation.set(-P.aRx, P.aRy, P.aRz);
  n.legL.rotation.set(P.lLx, 0, P.lLz);
  n.legR.rotation.set(-P.lRx, 0, P.lRz);
  if(n.wpn) n.wpn.rotation.set(P.wx, P.wy, -HP + P.wz + P.wspin);
  // weapon trail anchor: kicks move tip/base to the right foot
  const kick = rig.style==='fist' && st.tpl && KICKS[st.tpl];
  const tipPar = kick ? rig.footTip : rig.tipHome;
  if(rig.tip.parent !== tipPar){
    if(kick){ rig.footTip.add(rig.tip); rig.tip.position.set(0,0,0); rig.footBase.add(rig.base); rig.base.position.set(0,0,0); }
    else { rig.tipHome.add(rig.tip); rig.tipHome.add(rig.base);
      rig.tip.position.set(L.hand[0]+0.02, L.hand[1]-0.07, 0); rig.base.position.set(L.hand[0], L.hand[1]+0.03, 0); }
  }
  // ---- secondary motion (springs)
  const fwd = (e.vx||0)*face*60, up = (e.vy||0)*60;
  const headY = P.y + P.sq*0.9;
  const hv = first ? 0 : (headY - st.prevHY)/Math.max(dt,1e-4); st.prevHY = headY;
  const happy = eyes==='happy';
  const earType = rig.earType;
  spring(st.eBack, U.clamp(fwd*0.08 + P.lean*0.8 + P.roll*0.15, -0.6, 1.0), 170, 9, dt);
  spring(st.eFlap, U.clamp(-up*0.1 - hv*0.12 + (happy?0.15:0), -0.35, 1.0), 150, 8, dt);
  const wag = (anim==='run'?0.55: happy?0.8 : 0.25) * Math.sin(st.t*(happy?0.45:anim==='run'?0.35:0.12));
  spring(st.tYaw, P.tail*0.6 + wag, 120, 10, dt);
  spring(st.tLift, U.clamp(-up*0.06 - hv*0.08 + (happy?0.3:0), -0.5, 0.8), 140, 9, dt);
  spring(st.cSwing, -U.clamp(Math.abs(fwd)*0.16 + Math.max(0, up)*0.12 + P.lean*0.6, -0.4, 1.15) - U.clamp(-hv*0.1,-0.4,0.4), 90, 7, dt);
  spring(st.cFlare, U.clamp(-up*0.05, -0.2, 0.3) + 0.05*Math.sin(st.t*0.07), 80, 7, dt);
  if(first){ for(const k of ['eBack','eFlap','tYaw','tLift','cSwing','cFlare']){ const sp = st[k]; sp.v = 0; } }
  if(n.earL){
    const up_ = earType==='up';
    const zb = up_ ? st.eBack.x*0.6 : -st.eBack.x, fl = st.eFlap.x*(up_?-0.4:1) + (up_?0.05:0.12);
    n.earL.rotation.set(up_ ? -fl : fl, 0, zb);
    n.earR.rotation.set(up_ ? fl : -fl, 0, zb);
  }
  if(n.tail) n.tail.rotation.set(0, st.tYaw.x, st.tLift.x);
  if(n.cape) n.cape.rotation.set(st.cFlare.x*0.3, 0, st.cSwing.x);
  // ---- expressions
  let mode = eyes;
  if(mode==='open'){
    st.blinkT += dt*60;
    const bt = st.blinkT - st.blinkNext;
    if(bt > 0){ const k = U.bump(bt, 0, 8); n.eyes.scale.y = Math.max(0.12, 1 - k); if(bt > 8){ st.blinkT = 0; st.blinkNext = 100 + Math.random()*160; if(Math.random()<0.2) st.blinkNext = 12; } }
    else n.eyes.scale.y = 1;
  } else n.eyes.scale.y = 1;
  const hide = !!rig.hideShared;
  n.eyes.visible = mode==='open' && !hide;
  n.eyesX.visible = mode==='x' && !hide;
  n.eyesSq.visible = mode==='sq' && !hide;
  n.eyesHappy.visible = mode==='happy' && !hide;
  if(n.glasses){
    // sunglasses: on the eyes normally; slide up for smiles, get knocked down the nose when hurt
    const g = n.glasses;
    if(mode==='happy'){ g.position.set(-0.01, 0.15, 0); g.rotation.set(0,0,0.25); }
    else if(mode==='x' || mode==='sq'){ g.position.set(0.02, -0.075, 0); g.rotation.set(0.28, 0, -0.12); }
    else { g.position.set(0,0,0); g.rotation.set(0,0,0); }
    if(mode==='open') n.eyes.visible = false;                 // behind the dark lenses
  }
  const mo = P.mouth;
  n.mouth.visible = mo > 0.3 && !hide;
  if(n.mouth.visible){ const k = 0.55 + 0.55*mo; n.mouth.scale.set(1, k, k); }
  n.stars.visible = stars && !hide;
  if(stars){ n.stars.rotation.y += 0.09*dt*60; n.stars.position.y = L.headC + 0.42 + 0.02*Math.sin(st.t*0.2); }
  // ---- halo / star staff idle motion
  if(n.halo){ n.halo.position.y = L.headC + 0.47 + 0.018*Math.sin(st.t*0.06); n.halo.rotation.set(HP + 0.12*Math.sin(st.t*0.035), 0.1*Math.sin(st.t*0.05), 0); }
  if(n.gem){ st.gemSpin += (0.035 + (st.tpl==='cast'||st.tpl==='bigcast'||anim==='ult' ? 0.2 : 0))*dt*60; n.gem.rotation.set(0, st.gemSpin, 0); }
  // ---- hit flash + charge glow (per-rig material only)
  const ud = rig.mat.userData;
  ud.uFlash.value = (e.flashT||0) > 0 ? 0.85 : 0;
  const g = glow > 0 ? glow : 0;
  ud.uTint.value.setRGB(1 + 0.32*g, 1 + 0.26*g, 1 + 0.1*g);
}

// select-screen idle: each hero shows their personality (looping, frames T / free-running t)
function posePersonality(rig, Q, rest, T, t){
  Q._eyes = 'open';
  Q.sq += 0.02*Math.sin(t*0.07);
  switch(rig.heroId){
    case 'inu': {                       // sword up in a salute, paw on the hip, a smile now and then
      Q.aRz = 2.1; Q.wz = -0.85; Q.wx = 0.5; Q.aRx = 0.55; Q.aLz = -0.35; Q.aLx = 0.95; Q.aLy = -0.25;
      Q.lean = -0.08; Q.nod = 0.12 + 0.03*Math.sin(t*0.05); Q.tail = 0.5*Math.sin(t*0.2);
      if((T % 200) > 140) Q._eyes = 'happy';
      break; }
    case 'shima': {                     // shadow boxing with a bounce
      const c = T % 44;
      Q.y = 0.03*Math.abs(Math.sin(t*0.14));
      if(c < 12){ const k = U.bump(c,0,12); Q.aLz = U.lerp(rest.aLz, 1.62, k); Q.aLy = U.lerp(rest.aLy, 0.38, k); Q.twist = -0.35*k; Q.mouth = k; }
      else if(c>=22 && c<34){ const k = U.bump(c,22,34); Q.aRz = U.lerp(rest.aRz, 1.62, k); Q.aRy = U.lerp(rest.aRy, 0.38, k); Q.twist = 0.4*k; Q.mouth = k; }
      break; }
    case 'nuko': {                      // twirls the star staff, sways, paw to the cheek
      Q.aRz = 1.2; Q.wz = -0.4; Q.wspin = t*0.09; Q.side = 0.09*Math.sin(t*0.06); Q.tilt = 0.18*Math.sin(t*0.06+0.6);
      Q.aLz = 2.1; Q.aLy = 0.7; Q.aLx = 0.1; Q._eyes = (T % 180) > 110 ? 'happy' : 'open';
      break; }
    case 'guard8': {                    // hammer on the shoulder, flexing
      Q.aRz = 1.25; Q.wz = 1.75; Q.aLz = 2.35 + 0.12*Math.sin(t*0.1); Q.aLx = 1.0; Q.aLy = -0.25;
      Q.nod = 0.2; Q.lean = -0.1; Q.y = 0.012*Math.abs(Math.sin(t*0.1));
      if((T % 160) > 110){ Q._eyes = 'happy'; Q.mouth = 0.8; }
      break; }
    case 'watch': {                     // tips the hat with a bow, then twirls the cane
      const c = (T % 160)/160;
      if(c < 0.35){ const k = U.bump(c, 0, 0.35); Q.aLz = 2.9*k + rest.aLz*(1-k); Q.aLy = 0.55*k; Q.lean = 0.25*k; Q.nod = -0.25*k; Q._eyes = k>0.5?'happy':'open'; }
      else { Q.aRz = 1.25; Q.wz = -1.25; Q.wspin = -t*0.3; Q.aLz = -0.2; Q.aLx = 0.9; }
      break; }
    case 'wanden': {                    // calm iai stance, eyes closed, opens them now and then
      Q.aRz = 0.55; Q.aRy = 1.25; Q.wz = -2.55; Q.aLz = 0.3; Q.aLy = 0.35; Q.lean = 0.12; Q.sq -= 0.05;
      Q.nod = -0.02 + 0.02*Math.sin(t*0.04); Q._eyes = (T % 220) < 150 ? 'happy' : 'open';
      break; }
    case 'mack': {                      // spins the cork gun on a finger, then points it up with a grin
      const c = (T % 150)/150;
      if(c < 0.6){ Q.aRz = 1.2; Q.wz = -1.2; Q.wspin = -t*0.35; Q.aLz = -0.3; Q.aLx = 0.9; }
      else { Q.aRz = 2.3; Q.wz = -1.0; Q.wx = 0.5; Q.aRx = 0.7; Q.nod = 0.2; Q._eyes = 'happy'; Q.mouth = 0.9; Q.aLz = -0.3; Q.aLx = 0.9; }
      break; }
  }
}

// ---------------------------------------------------------------- portraits (bust on a transparent background → PNG dataURL)
const pCache = {};
let pScene = null, pCam = null, pRT = null;
const _hv = new THREE.Vector3(), _hf = new THREE.Vector3(), _cc = new THREE.Color();
function portrait(id, opts){
  opts = opts || {};
  const hero = BYID[id]; if(!hero) return null;
  const size = Math.max(32, Math.min(1024, opts.size|0 || 256)), expr = opts.expr || 'normal';
  const key = hero.id+'|'+size+'|'+expr+'|'+(opts.bg||'');
  if(pCache[key]) return pCache[key];
  const R = G.renderer; if(!R) return null;
  let url = null, rig = null;
  const prevRT = R.getRenderTarget(), prevA = R.getClearAlpha(), prevAuto = R.autoClear; R.getClearColor(_cc);
  try {
    if(!pScene){
      pScene = new THREE.Scene();
      pScene.add(new THREE.HemisphereLight(0xdcefff, 0xf2d6b0, 1.3));
      const key = new THREE.DirectionalLight(0xfff0d8, 2.3); key.position.set(-3, 5, 6); pScene.add(key);
      const rim = new THREE.DirectionalLight(0xbfe0ff, 1.8); rim.position.set(4, 4, -6); pScene.add(rim);
      const fill = new THREE.DirectionalLight(0xffe2f0, 0.5); fill.position.set(5, 1, 6); pScene.add(fill);
      pCam = new THREE.PerspectiveCamera(22, 1, 0.05, 50);
    }
    const S = size*2;                                        // 2× supersampled, box-filtered by the 2D canvas
    if(!pRT || pRT.width!==S){
      if(pRT) pRT.dispose();
      pRT = new THREE.WebGLRenderTarget(S, S, { depthBuffer:true });
      pRT.texture.colorSpace = THREE.SRGBColorSpace; pRT.texture.internalFormat = 'RGBA8';
      pRT.isXRRenderTarget = true;       // r160: makes three apply tone mapping + sRGB output like the screen does
    }
    rig = build(hero.id, { anim:'idle' });
    const ent = { anim:'idle', animT:0, animLen:0, animHit:0.35, face:1, vx:0, vy:0, vz:0, onGround:true, flashT:0, stun:0, charge:0 };
    rig.st.blinkNext = 1e9;
    updateRig(rig, ent, G.cfg.TICK, true);
    const n = rig.n;
    if(expr==='happy'){ n.eyes.visible = false; n.eyesHappy.visible = true; n.mouth.visible = true; n.mouth.scale.set(1,1,1);
      if(n.glasses){ n.glasses.position.set(-0.01,0.15,0); n.glasses.rotation.set(0,0,0.25); } }
    else if(expr==='hurt'){ n.eyes.visible = false; n.eyesSq.visible = true; n.mouth.visible = true; }
    else if(expr==='shout'){ n.mouth.visible = true; n.mouth.scale.set(1,1.1,1.1); }
    pScene.add(rig.root);
    rig.root.updateMatrixWorld(true);
    // aim at the face from a 3/4 front view
    n.neck.localToWorld(_hv.set(0, L.headC, 0));
    _hf.set(1,0,0).transformDirection(n.neck.matrixWorld);
    _hf.multiplyScalar(0.55).add(_p.set(0,0.12,0.75)).normalize();
    const sc = rig.scale, dist = (1.3*sc*0.5) / Math.tan(pCam.fov*Math.PI/360);
    _hv.y += 0.07*sc;
    pCam.position.copy(_hv).addScaledVector(_hf, dist);
    pCam.lookAt(_hv);
    R.setRenderTarget(pRT);
    if(opts.bg){ R.setClearColor(opts.bg, 1); } else R.setClearColor(0x000000, 0);
    R.autoClear = true;
    R.clear(true, true, true);
    R.render(pScene, pCam);
    const buf = new Uint8Array(S*S*4);
    R.readRenderTargetPixels(pRT, 0, 0, S, S, buf);
    const big = document.createElement('canvas'); big.width = big.height = S;
    const bx = big.getContext('2d'), img = bx.createImageData(S, S);
    for(let y=0;y<S;y++) img.data.set(buf.subarray((S-1-y)*S*4, (S-y)*S*4), y*S*4);   // flip rows
    bx.putImageData(img, 0, 0);
    const c = document.createElement('canvas'); c.width = c.height = size;
    const cx = c.getContext('2d'); cx.imageSmoothingEnabled = true; cx.imageSmoothingQuality = 'high';
    cx.drawImage(big, 0, 0, size, size);
    url = c.toDataURL('image/png');
    pCache[key] = url;
  } catch(err){ G.logError && G.logError('heroes.portrait '+id, err); }
  finally {
    R.setRenderTarget(prevRT); R.setClearColor(_cc, prevA); R.autoClear = prevAuto;
    if(rig){ pScene && pScene.remove(rig.root); rig.dispose(); }
  }
  return url;
}

// ---------------------------------------------------------------- export
G.heroes = {
  list: LIST,
  ids: LIST.map(h=>h.id),
  get(id){ return BYID[id] || null; },
  init(){ for(const h of LIST){ try { getModel(h.id); } catch(err){ G.logError('heroes.model '+h.id, err); } } shared(); },
  build,
  portrait,
  clearPortraits(){ for(const k in pCache) delete pCache[k]; },
  // for tests / other modules: which swing template an anim uses for a hero (e.g. 'hslash')
  moveOf(id, anim){ const h = BYID[id]; return h && MOVES[h.weapon] ? (MOVES[h.weapon][anim] || null) : null; },
  layout: L,
};
})();

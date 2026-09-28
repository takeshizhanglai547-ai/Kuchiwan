// 31_zako.js — ざこ敵 14しゅ（ダークワンワンていこくの へいたい）：見た目（ちびキャラの立体モデル）・手続きアニメ・AI・攻撃。
// types: wanhei hyena boar shield pounce bomber thrower flyer kire pierrot balloon oni ari mecha
// 見た目：1体 = 頂点カラーで部品を結合した1枚のスキンメッシュ（骨は剛体、骨ごとに部品を割り当て）＋同じ骨を使う輪郭線
//   ＋表情メッシュ（怒り目/まばたき/×目/＞＜目/にっこり目/ぐるぐる目 の形状を差し替える）。
//   → 1体あたり描画コール 5（本体・輪郭・表情・影パス・丸影）。形状は種類ごとに1回だけ作って全個体で共有し、
//     個体ごとに作るのは材質（白フラッシュ・フェード用）と骨だけ。dispose はそれだけを捨てる。
// 向き：体は進行方向から35°カメラへ、頭はさらに少しカメラへ。左向きは z を鏡像にして、持ち物がいつもカメラ側に来る。
// やっつけると：×目→ぽんっ→（犬の兵隊はそのまま、犬でない子は子犬の姿になって）にこにこ走り去る。ふうせんは「パーン！」で消える。
(function(){ 'use strict';
const G = window.G; const THREE = window.THREE; const U = G.U;
if(!G.foes || !G.foes.define){ if(G.logError) G.logError('31_zako', 'needs 30_foes'); return; }
const H = G.foes.h;
const TAU = Math.PI*2, HP = Math.PI/2, PI = Math.PI;
const TURN = 0.62;          // body heading: ~35° from profile toward the camera
const HEAD_YAW = -0.26;     // the head looks a little more toward the camera (negative y-rotation turns +x toward +z)
const ZMIN = G.cfg.ZMIN, ZMAX = G.cfg.ZMAX;

// ================================================================ build-time helpers (allocation is fine here: runs once per type)
const _e = new THREE.Euler(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
function M(pos, rot, scl, order){
  _e.set(rot?rot[0]:0, rot?rot[1]:0, rot?rot[2]:0, order||'XYZ'); _q.setFromEuler(_e);
  if(scl==null) _s.set(1,1,1); else if(typeof scl==='number') _s.set(scl,scl,scl); else _s.set(scl[0],scl[1],scl[2]);
  return new THREE.Matrix4().compose(_p.set(pos?pos[0]:0, pos?pos[1]:0, pos?pos[2]:0), _q, _s);
}
// part list: every part is rigidly bound to one bone (skinned) or just merged (plain)
function Parts(){
  const list = [];
  const api = { list, b:0,
    on(b){ api.b = b; return api; },
    add(g, color, pos, rot, scl, order){ list.push({ b:api.b, g, color, m:M(pos, rot, scl, order) }); return api; },
    addM(g, color, m){ list.push({ b:api.b, g, color, m }); return api; },
  };
  return api;
}
const _v = new THREE.Vector3(), _n3 = new THREE.Matrix3(), _c = new THREE.Color();
function merge(list, skinned){
  let nv = 0, ni = 0;
  for(const p of list){ nv += p.g.attributes.position.count; ni += p.g.index ? p.g.index.count : p.g.attributes.position.count; }
  const pos = new Float32Array(nv*3), nor = new Float32Array(nv*3), col = new Float32Array(nv*3);
  const idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
  const si = skinned ? new Uint16Array(nv*4) : null, sw = skinned ? new Float32Array(nv*4) : null;
  let vo = 0, io = 0;
  for(const p of list){
    const P = p.g.attributes.position, N = p.g.attributes.normal;
    _n3.getNormalMatrix(p.m);
    const flip = p.m.determinant() < 0;
    _c.set(p.color);
    for(let i=0;i<P.count;i++){
      const k = (vo+i)*3;
      _v.fromBufferAttribute(P,i).applyMatrix4(p.m); pos[k]=_v.x; pos[k+1]=_v.y; pos[k+2]=_v.z;
      _v.fromBufferAttribute(N,i).applyMatrix3(_n3).normalize(); nor[k]=_v.x; nor[k+1]=_v.y; nor[k+2]=_v.z;
      col[k]=_c.r; col[k+1]=_c.g; col[k+2]=_c.b;
      if(skinned){ si[(vo+i)*4] = p.b; sw[(vo+i)*4] = 1; }
    }
    if(p.g.index){
      const I = p.g.index.array;
      for(let j=0;j<I.length;j+=3){
        idx[io++]=I[j]+vo;
        if(flip){ idx[io++]=I[j+2]+vo; idx[io++]=I[j+1]+vo; } else { idx[io++]=I[j+1]+vo; idx[io++]=I[j+2]+vo; }
      }
    } else {
      for(let j=0;j<P.count;j+=3){
        idx[io++]=vo+j;
        if(flip){ idx[io++]=vo+j+2; idx[io++]=vo+j+1; } else { idx[io++]=vo+j+1; idx[io++]=vo+j+2; }
      }
    }
    vo += P.count;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos,3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor,3));
  g.setAttribute('color', new THREE.BufferAttribute(col,3));
  if(skinned){ g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si,4)); g.setAttribute('skinWeight', new THREE.BufferAttribute(sw,4)); }
  g.setIndex(new THREE.BufferAttribute(idx,1));
  g.computeBoundingSphere();
  g.userData.shared = true;     // cached per type: rigs never dispose it
  return g;
}
function plain(fn){ const p = Parts(); fn(p); return merge(p.list, false); }

// primitives (shared, cached by G.look.geo)
let PR = null;
function prim(){
  if(PR) return PR;
  const g = G.look.geo;
  const dome = (ws, hs)=>{ const d = new THREE.SphereGeometry(1, ws, hs, 0, TAU, 0, HP); d.rotateX(HP); d.userData.shared = true; return d; };
  PR = {
    s: g.sphere(1, 15, 10), sm: g.sphere(1, 10, 8), sl: g.sphere(1, 8, 6), st: g.sphere(1, 6, 4),
    dome: dome(12, 5), domeS: dome(8, 4), domeT: dome(6, 3),       // front-facing half spheres for face features (+z = out)
    cyl: g.cylinder(1, 1, 1, 12), cyl8: g.cylinder(1, 1, 1, 8), cone: g.cone(1, 1, 10), cone6: g.cone(1, 1, 6), pyr: g.cone(1, 1, 4),
    hemi: (()=>{ const h = new THREE.SphereGeometry(1, 14, 6, 0, TAU, 0, HP); h.userData.shared = true; return h; })(),
    shell: (()=>{ const h = new THREE.SphereGeometry(1, 16, 5, 0, TAU, 0, 0.78); h.rotateX(HP); h.userData.shared = true; return h; })(),   // curved face patch, pole = +z
    rbox: g.rbox(1, 1, 1, 0.22, 2),
    cap: (r, l)=> g.capsule(r, l, 2, 8),
    capL: (r, l)=> g.capsule(r, l, 1, 6),          // small decorations / face strokes
    tor: (r, t, arc, ts)=> g.torus(r, t, 5, ts||16, arc==null ? TAU : arc),
    star: g.star(0.1, 0.45, 0.05),
  };
  return PR;
}

// feature placement on an ellipsoid F = { c:[x,y,z], r:[rx,ry,rz] } (az: toward +z, el: up). d = push along the radius (units)
function surf(F, az, el, d){
  const rm = (F.r[0]+F.r[1]+F.r[2])/3, k = 1 + (d||0)/rm, ce = Math.cos(el);
  return [F.c[0] + F.r[0]*ce*Math.cos(az)*k, F.c[1] + F.r[1]*Math.sin(el)*k, F.c[2] + F.r[2]*ce*Math.sin(az)*k];
}
// local +z = outward normal, +y = up along the surface, +x = toward -z. Use with order 'YXZ'.
function srot(az, el, spin){ return [-el, HP - az, spin||0]; }
function feat(p, g, color, F, az, el, d, spin, scl){ return p.addM(g, color, M(surf(F, az, el, d), srot(az, el, spin), scl, 'YXZ')); }

// ================================================================ faces (expression sets: one small geometry each, swapped on one mesh)
const C = { ink:'#2a1c16', rim:'#3b2417', eyeY:'#ffe04a', pupil:'#1d1410', white:'#ffffff', drop:'#8fd8ff', blush:'#ff9fb5', brow:'#2a1c16' };
const faceCache = new Map();
// F: { c, r, az (half eye spread), el, size, style:'yellow'|'dot', tilt, brow:true, mouthO:{el}, dropAz }
function faceSet(key, F){
  if(faceCache.has(key)) return faceCache.get(key);
  const R = prim(), s = F.size, out = {};
  const sides = [1, -1];
  const brows = (p, lower)=>{
    if(F.brow===false) return;
    const cap = R.capL(s*0.27, s*1.25);
    for(const i of sides){ const az = i*F.az;
      feat(p, cap, C.brow, F, az + i*0.02, F.el + (s*(lower?0.82:0.98))/F.r[1], s*0.34, HP - i*(F.tilt==null?0.5:F.tilt)); }
  };
  const eyesOpen = (p)=>{
    for(const i of sides){ const az = i*F.az;
      if(F.style==='dot'){
        feat(p, R.dome, C.pupil, F, az, F.el, 0, 0, [s*0.72, s*0.95, s*0.42]);
        feat(p, R.domeT, C.white, F, az + i*0.03, F.el + s*0.35/F.r[1], s*0.3, 0, s*0.3);
        feat(p, R.domeT, C.white, F, az - i*0.04, F.el - s*0.35/F.r[1], s*0.3, 0, s*0.13);
      } else {
        feat(p, R.dome, C.rim, F, az, F.el, -0.004, 0, [s*0.92, s*1.08, s*0.36]);
        feat(p, R.dome, C.eyeY, F, az, F.el, 0, 0, [s*0.76, s*0.92, s*0.4]);
        feat(p, R.domeS, C.pupil, F, az - i*0.05, F.el - s*0.12/F.r[1], s*0.2, 0, [s*0.36, s*0.5, s*0.3]);
        feat(p, R.domeT, C.white, F, az - i*0.02, F.el + s*0.12/F.r[1], s*0.36, 0, s*0.16);
      }
    }
  };
  const drop = (p)=>{
    const az = F.dropAz==null ? 1.05 : F.dropAz, el = F.dropEl==null ? 0.55 : F.dropEl;
    const q = surf(F, az, el, s*0.9);
    p.add(R.sl, C.drop, q, [0,0,-0.35], s*0.62);
    p.add(R.cone, C.drop, [q[0] - s*0.2, q[1] + s*0.62, q[2]], [0,0,-0.35], [s*0.52, s*0.95, s*0.52]);
    p.add(R.domeT, C.white, [q[0] - s*0.15, q[1] + s*0.1, q[2] + s*0.5], null, s*0.18);
  };
  let mouthO = (p)=>{
    if(!F.mouthO) return;
    feat(p, R.tor(s*0.62, s*0.22, TAU, 14), '#3a1820', F, 0, F.mouthO.el, 0, 0, 1);
    feat(p, R.domeS, '#8a1e30', F, 0, F.mouthO.el, -0.004, 0, [s*0.6, s*0.6, s*0.15]);
  };
  const mouth = (p, happy)=>{
    if(!F.mouth) return;
    const el = F.mouthEl==null ? -0.2 : F.mouthEl, cap = R.capL(s*0.14, s*0.6);
    if(happy){ feat(p, R.tor(s*0.42, s*0.13, PI, 10), '#5a1a1a', F, 0, el + 0.03, 0, PI, 1); return; }
    if(F.mouth==='line'){ feat(p, R.capL(s*0.15, s*1.6), '#1e1a40', F, 0, el, 0, HP, 1); return; }
    feat(p, cap, '#5a1a1a', F, 0.07, el, 0, HP + 0.55, 1); feat(p, cap, '#5a1a1a', F, -0.07, el, 0, HP - 0.55, 1);   // "へ"
  };
  const mouthO0 = mouthO;
  mouthO = (p)=>{ mouthO0(p); mouth(p, false); };
  out.angry = plain((p)=>{ eyesOpen(p); brows(p, true); mouthO(p); });
  out.blink = plain((p)=>{ const cap = R.capL(s*0.17, s*0.9);
    for(const i of sides) feat(p, cap, C.ink, F, i*F.az, F.el - s*0.25/F.r[1], s*0.1, HP - i*0.18);
    brows(p, true); mouthO(p); });
  out.x = plain((p)=>{ const cap = R.capL(s*0.16, s*1.15);
    for(const i of sides){ feat(p, cap, C.ink, F, i*F.az, F.el, s*0.08, PI/4); feat(p, cap, C.ink, F, i*F.az, F.el, s*0.08, -PI/4); }
    drop(p); mouthO(p); });
  out.squeeze = plain((p)=>{ const cap = R.capL(s*0.16, s*0.95);
    for(const i of sides){ const az = i*F.az, dy = s*0.3/F.r[1];
      // chevron pointing at the nose: "> <"
      feat(p, cap, C.ink, F, az, F.el + dy, s*0.08, HP - i*0.55);
      feat(p, cap, C.ink, F, az, F.el - dy, s*0.08, HP + i*0.55); }
    drop(p); mouthO(p); });
  out.happy = plain((p)=>{ const arc = R.tor(s*0.62, s*0.17, PI, 10);
    for(const i of sides){ feat(p, arc, C.ink, F, i*F.az, F.el - s*0.2/F.r[1], s*0.06, 0, 1);
      feat(p, R.domeS, C.blush, F, i*(F.az + 0.3), F.el - 0.24, 0, 0, [s*1.25, s*0.72, s*0.3]); }
    if(F.mouthO) feat(p, R.tor(s*0.5, s*0.16, PI, 10), '#3a1820', F, 0, F.mouthO.el, 0, PI, 1);
    mouth(p, true);
  });
  out.dizzy = plain((p)=>{
    for(const i of sides){ feat(p, R.tor(s*0.7, s*0.11, TAU, 16), C.ink, F, i*F.az, F.el, s*0.05, 0, 1);
      feat(p, R.tor(s*0.3, s*0.1, TAU, 12), C.ink, F, i*F.az, F.el, s*0.05, 0, 1); }
    drop(p); mouthO(p); });
  faceCache.set(key, out);
  return out;
}
// one-eyed robot face (vertex colours glow through the emissive-vertex material)
function mechaFace(key, c, s){
  if(faceCache.has(key)) return faceCache.get(key);
  const R = prim(), red = '#ff3a3a', core = '#ffd0c8', cyan = '#5fe6ff', out = {};
  const at = (dx, dy, dn)=> [c[0] + (dn||0), c[1] + dy, c[2] + dx];
  const face = [0, HP, 0];      // local +z → +x (the face plane)
  const rz = (a)=> [0, HP, a];
  const lid = (p)=> p.add(R.rbox, '#14161c', at(0, s*0.8, s*0.2), rz(0.32), [s*2.4, s*0.6, s*0.5], 'YXZ');
  out.angry = plain((p)=>{ p.add(R.dome, red, at(0,0), face, [s, s*1.05, s*0.4], 'YXZ'); p.add(R.domeS, core, at(-s*0.12, s*0.18, s*0.05), face, [s*0.38, s*0.38, s*0.4], 'YXZ'); lid(p); });
  out.blink = plain((p)=>{ p.add(R.capL(s*0.16, s*1.2), red, at(0, -s*0.1), rz(HP), 1, 'YXZ'); lid(p); });
  out.x = plain((p)=>{ const k = R.capL(s*0.17, s*1.3); p.add(k, red, at(0,0), rz(PI/4), 1, 'YXZ'); p.add(k, red, at(0,0), rz(-PI/4), 1, 'YXZ'); });
  out.squeeze = plain((p)=>{ const k = R.capL(s*0.16, s*1.0); p.add(k, red, at(s*0.1, s*0.28), rz(HP+0.6), 1, 'YXZ'); p.add(k, red, at(s*0.1, -s*0.28), rz(HP-0.6), 1, 'YXZ'); });
  out.happy = plain((p)=>{ p.add(R.tor(s*0.7, s*0.18, PI, 12), cyan, at(0, -s*0.2), face, 1, 'YXZ'); });
  out.dizzy = plain((p)=>{ p.add(R.tor(s*0.8, s*0.12, TAU, 16), red, at(0,0), face, 1, 'YXZ'); p.add(R.tor(s*0.36, s*0.11, TAU, 12), red, at(0,0), face, 1, 'YXZ'); });
  faceCache.set(key, out);
  return out;
}

// ================================================================ shared little meshes
let STARS = null, STARMAT = null;
function starGeo(){
  if(STARS) return STARS;
  const R = prim();
  STARS = plain((p)=>{ for(let i=0;i<3;i++){ const a = i/3*TAU; p.add(R.star, i===1 ? '#ffd23a' : '#fff07a', [Math.cos(a)*0.3, Math.sin(a*2)*0.03, Math.sin(a)*0.3], [0, -a + HP, 0]); } });
  return STARS;
}
function starMat(){ return STARMAT || (STARMAT = G.look.vmat({ rough:0.35, emissive:'#ffb000', emissiveIntensity:0.45 })); }

// material whose emissive glow is tinted by the vertex colour (dark parts do not glow). Per instance.
function glowMat(intensity){
  const m = G.look.matInstance('#ffffff', { vertexColors:true, emissive:'#ffffff', emissiveIntensity:intensity==null?1:intensity, rough:0.3, rim:0.3 });
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (sh, r)=>{ prev(sh, r); sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance *= vColor;'); };
  m.customProgramCacheKey = ()=> 'inuZakoGlow1';
  return m;
}

// round glowing floor decals (oni aura / smash warning / ant mound shadow): canvas textures, shared
function decalTex(kind){
  return G.look.canvasTex('zako_'+kind, 256, 256, (x, w, h)=>{
    const cx = w/2, cy = h/2;
    x.clearRect(0,0,w,h);
    if(kind==='aura'){
      let g = x.createRadialGradient(cx,cy,0,cx,cy,cx);
      g.addColorStop(0,'rgba(170,90,255,0)'); g.addColorStop(0.62,'rgba(170,90,255,0.10)'); g.addColorStop(0.86,'rgba(200,130,255,0.55)'); g.addColorStop(0.93,'rgba(255,220,255,0.95)'); g.addColorStop(1,'rgba(170,90,255,0)');
      x.fillStyle = g; x.fillRect(0,0,w,h);
      // little paw prints around the ring
      x.fillStyle = 'rgba(235,200,255,0.9)';
      for(let i=0;i<8;i++){ const a = i/8*TAU, r = cx*0.74, px = cx+Math.cos(a)*r, py = cy+Math.sin(a)*r;
        x.save(); x.translate(px,py); x.rotate(a+HP); x.beginPath(); x.ellipse(0, 3, 7, 6, 0, 0, TAU); x.fill();
        for(let k=-1;k<=1;k++){ x.beginPath(); x.ellipse(k*6, -6 - (k===0?2:0), 3, 3.5, 0, 0, TAU); x.fill(); } x.restore(); }
    } else if(kind==='warn'){
      let g = x.createRadialGradient(cx,cy,0,cx,cy,cx);
      g.addColorStop(0,'rgba(255,70,70,0.30)'); g.addColorStop(0.78,'rgba(255,70,70,0.34)'); g.addColorStop(0.86,'rgba(255,90,80,0.95)'); g.addColorStop(0.94,'rgba(255,240,200,1)'); g.addColorStop(1,'rgba(255,90,80,0)');
      x.fillStyle = g; x.fillRect(0,0,w,h);
      x.fillStyle = 'rgba(255,255,255,0.9)'; x.font = '900 120px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('!', cx, cy+6);
    }
  });
}
function decalMat(kind, opacity){
  const m = new THREE.MeshBasicMaterial({ map:decalTex(kind), transparent:true, depthWrite:false, opacity, color:0xffffff });
  m.userData.baseOpacity = opacity;
  return m;
}

// ================================================================ blueprints (one per type, built lazily and cached)
const BP = {};
function bones(list){ return list; }
function boneAt(bl, name){ for(const b of bl) if(b.n===name) return b.at; return [0,0,0]; }
function bi(bl, name){ for(let i=0;i<bl.length;i++) if(bl[i].n===name) return i; return 0; }

// ---------------------------------------------------------------- dog soldiers (one shared builder)
// o: { id, fur, light, dark, earIn, ear:'pointy'|'floppy'|'big', lanky, lean, eye, gear:{...}, tail:'up'|'curl' }
function dogBP(o){
  const R = prim();
  const lk = o.lanky||0, ln = o.lean||0;
  const hipY = 0.2 + lk*0.07;
  const bR = [0.25 - ln*0.045, 0.255 + lk*0.03, 0.23 - ln*0.035];
  const bodyY = hipY + 0.2;
  const neckY = hipY + 0.42 + lk*0.04;
  const headR = o.headR || [0.39, 0.35, 0.4];
  const hc = [0.03, 0.31, 0];                    // head centre, head-bone local
  const F = { c:hc, r:headR };
  const shY = hipY + 0.33 + lk*0.02, shZ = bR[2] + 0.015;
  const earAz = o.ear==='floppy' ? 1.32 : o.ear==='big' ? 1.05 : 1.12, earEl = o.ear==='floppy' ? 0.55 : o.ear==='big' ? 0.62 : 0.86;
  const eA = surf(F, earAz, earEl, -0.03);
  const BL = bones([
    { n:'root', p:-1, at:[0,0,0] },
    { n:'body', p:0, at:[0, hipY, 0] },
    { n:'head', p:1, at:[0.02, neckY, 0] },
    { n:'armF', p:1, at:[0.02, shY, shZ] }, { n:'armB', p:1, at:[0.02, shY, -shZ] },
    { n:'legF', p:0, at:[0, hipY, 0.11] }, { n:'legB', p:0, at:[0, hipY, -0.11] },
    { n:'tail', p:1, at:[-bR[0]+0.05, hipY+0.12, 0] },
    { n:'earF', p:2, at:[0.02+eA[0], neckY+eA[1], eA[2]] }, { n:'earB', p:2, at:[0.02+eA[0], neckY+eA[1], -eA[2]] },
  ]);
  if(o.held) BL.push({ n:'held', p:3, at:[0.07, shY - 0.25, shZ + 0.06] });
  const hb = boneAt(BL,'head');
  const HC = [hb[0]+hc[0], hb[1]+hc[1], hb[2]+hc[2]];      // head centre in model space
  const hs = (az, el, d)=>{ const q = surf(F, az, el, d); return [hb[0]+q[0], hb[1]+q[1], hb[2]+q[2]]; };
  const fur = o.fur, light = o.light, dark = o.dark || '#2a2630', earIn = o.earIn || '#f2a7b8';
  const p = Parts();
  // body
  p.on(bi(BL,'body'));
  if(!o.noBody) p.add(R.s, o.suit || fur, [0, bodyY, 0], null, bR);
  p.add(R.sm, o.belly || light, [bR[0]*0.52, bodyY - 0.03, 0], null, [bR[0]*0.55, bR[1]*0.72, bR[2]*0.78]);
  // collar with white studs
  const colY = neckY + 0.015;
  p.add(R.tor(0.19, 0.045, TAU, 16), o.collar || dark, [0.02, colY, 0], [HP, 0, 0]);
  if(o.studs!==false) for(let k=-2;k<=2;k++){ const a = k*0.52 + 0.12; p.add(R.st, '#ffffff', [0.02 + Math.cos(a)*0.232, colY, Math.sin(a)*0.232], null, 0.03); }
  // head
  p.on(bi(BL,'head'));
  p.add(R.s, fur, HC, null, headR);
  const mz = [HC[0] + headR[0]*0.74, HC[1] - 0.1, 0];
  p.add(R.sm, o.muzzle || light, mz, null, [0.16, 0.115, 0.165]);
  p.add(R.sl, '#2a2028', [mz[0] + 0.14, mz[1] + 0.05, 0], null, [0.045, 0.04, 0.062]);
  p.add(R.st, '#ffffff', [mz[0] + 0.16, mz[1] + 0.075, 0.02], null, 0.014);
  const mo = R.tor(0.028, 0.009, PI, 6);
  for(const zs of [1,-1]) p.add(mo, C.rim, [mz[0] + 0.15, mz[1] - 0.045, zs*0.028], [0, HP, PI]);
  // ears
  const earBones = [bi(BL,'earF'), bi(BL,'earB')];
  for(let k=0;k<2;k++){
    const zs = k===0 ? 1 : -1, at = boneAt(BL, k===0 ? 'earF' : 'earB');
    p.on(earBones[k]);
    if(o.ear==='floppy'){
      p.add(R.sm, o.earCol || o.ear2 || fur, [at[0]-0.01, at[1]-0.1, at[2]+zs*0.05], [-zs*0.3, 0, 0.1], [0.1, 0.19, 0.055]);
    } else {
      const big = o.ear==='big', h = big ? 0.34 : (o.earH||0.26), r = big ? 0.17 : 0.115, tilt = big ? 0.72 : 0.36;
      const dir = [0, Math.cos(tilt), zs*Math.sin(tilt)];
      p.add(R.cone, o.earCol || fur, [at[0] + (big?0:-0.01), at[1] + dir[1]*h*0.45, at[2] + dir[2]*h*0.45], [zs*tilt, 0, 0.12], [r, h, r*0.72]);
      p.add(R.cone, earIn, [at[0] + 0.035, at[1] + dir[1]*h*0.42, at[2] + dir[2]*h*0.42], [zs*tilt, 0, 0.12], [r*0.6, h*0.72, r*0.35]);
    }
  }
  // arms
  if(!o.noArms) for(const nm of ['armF','armB']){
    const zs = nm==='armF' ? 1 : -1, at = boneAt(BL, nm);
    p.on(bi(BL, nm));
    p.add(R.cap(0.068, 0.13 + lk*0.04), o.sleeve || fur, [at[0]+0.01, at[1]-0.1 - lk*0.02, at[2] + zs*0.02], [-zs*0.12, 0, 0]);
    p.add(R.sl, o.paw || light, [at[0]+0.02, at[1]-0.22 - lk*0.04, at[2] + zs*0.035], null, 0.083);
  }
  // legs
  for(const nm of ['legF','legB']){
    const at = boneAt(BL, nm);
    p.on(bi(BL, nm));
    p.add(R.cap(0.075, 0.05 + lk*0.07), o.pants || fur, [at[0], at[1]*0.55, at[2]], null);
    p.add(R.sl, o.foot || light, [at[0]+0.045, 0.06, at[2]], null, [0.11, 0.065, 0.09]);
  }
  // tail
  p.on(bi(BL,'tail'));
  const ta = boneAt(BL,'tail');
  if(o.tail!=='none'){
    p.add(R.cap(0.052, 0.15), o.tailCol || fur, [ta[0]-0.07, ta[1]+0.1, 0], [0, 0, 0.75]);
    p.add(R.sl, o.tailTip || light, [ta[0]-0.15, ta[1]+0.2, 0], null, 0.06);
  }
  if(o.gear) o.gear(p, { BL, R, bi, boneAt, HC, headR, hs, hipY, bodyY, bR, neckY, shY, shZ, F, hb });
  const geo = merge(p.list, true);
  const face = faceSet('dog_'+o.id, { c:hc, r:headR, az:o.eyeAz||0.46, el:o.eyeEl||0.1, size:o.eye||0.08, tilt:o.tilt });
  const top = HC[1] + headR[1];
  return { id:o.id, kind:'biped', BL, geo, face, faceBone:'head', height: o.height || top + 0.06, radius: 0.42,
    outline:0.02, lieLift:0.3, lieShift:0.5, rough:0.72, stars:{ bone:'head', pos:[hc[0], hc[1] + headR[1] + 0.12, 0] },
    tip:{ bone:'armF', pos:[0.02, -0.24, 0.03] }, base:{ bone:'armF', pos:[0,0,0] }, dog:true };
}

// ---------------------------------------------------------------- blob monks (kire / pierrot / oni): body+head is one round "bouzu"
function blobBP(o){
  const R = prim();
  const Rb = o.R, legTop = o.legTop || 0.16, cy = legTop + Rb*0.9;
  const bRad = [Rb, Rb*0.95, Rb*0.94];
  const shY = cy - Rb*0.12, shZ = Rb*0.9;
  const BL = bones([
    { n:'root', p:-1, at:[0,0,0] },
    { n:'body', p:0, at:[0, legTop, 0] },
    { n:'head', p:1, at:[0, cy, 0] },
    { n:'armF', p:1, at:[0.02, shY, shZ] }, { n:'armB', p:1, at:[0.02, shY, -shZ] },
    { n:'legF', p:0, at:[0.02, legTop, Rb*0.36] }, { n:'legB', p:0, at:[0.02, legTop, -Rb*0.36] },
  ]);
  const F = { c:[0,0,0], r:bRad };
  const hs = (az, el, d)=>{ const q = surf(F, az, el, d); return [q[0], cy + q[1], q[2]]; };
  const p = Parts();
  p.on(bi(BL,'body'));
  p.add(R.s, o.col, [0, cy, 0], null, bRad);
  if(o.belly) feat(p, R.dome, o.belly, { c:[0, cy, 0], r:bRad }, 0.25, -0.62, -0.01, 0, [Rb*0.5, Rb*0.36, Rb*0.08]);
  const s = o.limb || 1;
  for(const nm of ['armF','armB']){
    const zs = nm==='armF' ? 1 : -1, at = boneAt(BL, nm);
    p.on(bi(BL, nm));
    p.add(R.cap(0.07*s, 0.1*s), o.arm || o.col, [at[0]+0.01, at[1]-0.08*s, at[2]+zs*0.03], [-zs*0.2, 0, 0]);
    p.add(R.sl, o.fist || o.col, [at[0]+0.02, at[1]-0.19*s, at[2]+zs*0.05], null, 0.095*s);
  }
  for(const nm of ['legF','legB']){
    const at = boneAt(BL, nm);
    p.on(bi(BL, nm));
    p.add(R.cap(0.08*s, 0.04*s), o.leg || o.col, [at[0], at[1]*0.6, at[2]], null);
    p.add(R.sl, o.foot || '#2a2630', [at[0]+0.05, 0.055, at[2]], null, [0.12*s, 0.065, 0.1*s]);
  }
  p.on(bi(BL,'head'));
  if(o.gear) o.gear(p, { BL, R, bi, boneAt, cy, Rb, bRad, F, hs, legTop });
  const geo = merge(p.list, true);
  const fl = o.faceLift||1;
  const face = faceSet('blob_'+o.id, { c:[0,0,0], r:[bRad[0]*fl, bRad[1]*fl, bRad[2]*fl], az:o.eyeAz||0.36, el:o.eyeEl||0.14, size:o.eye||0.085, tilt:o.tilt, dropAz:0.95, dropEl:0.6, mouth:o.mouth, mouthEl:o.mouthEl });
  return { id:o.id, kind:'biped', blob:true, headYaw:-0.42, BL, geo, face, faceBone:'head', height: o.height || cy + Rb*0.95 + 0.1, radius: Rb*0.95,
    outline:0.022, lieLift: Rb*0.9, lieShift: cy*0.9, rough:0.7, stars:{ bone:'head', pos:[0, Rb*0.95 + (o.starUp||0.14), 0] },
    tip:{ bone:'armF', pos:[0.02, -0.19*s, 0.05] }, base:{ bone:'armF', pos:[0,0,0] } };
}

// ---------------------------------------------------------------- the 14 looks
const LOOK = {
  wanhei(){ return dogBP({ id:'wanhei', fur:'#9aa0ab', light:'#e6e9ef', ear:'pointy', earIn:'#6c7280', tail:'up',
    gear(p, k){ const R = k.R; p.on(k.bi(k.BL,'head'));
      // little purple forage cap with a gold bone badge (empire soldier)
      const q = k.hs(0.2, 1.02, -0.02);
      p.add(R.cyl, '#5a3a8c', q, [0.35, 0, -0.25], [0.2, 0.09, 0.2]);
      p.add(R.cyl, '#6f4aa8', [q[0], q[1]+0.05, q[2]+0.02], [0.35, 0, -0.25], [0.17, 0.03, 0.17]);
      const b = k.hs(0.05, 0.82, 0.03); p.add(R.capL(0.018, 0.06), '#ffcf3a', b, [0, 0, HP]); p.add(R.st, '#ffcf3a', [b[0], b[1]+0.02, b[2]+0.035], null, 0.026); p.add(R.st, '#ffcf3a', [b[0], b[1]+0.02, b[2]-0.035], null, 0.026); } }); },
  hyena(){ return dogBP({ id:'hyena', fur:'#b9824a', light:'#efd6ac', ear:'pointy', earIn:'#6e4526', earH:0.22, lanky:1, lean:1, tail:'up', tailCol:'#6e4526', eye:0.075,
    gear(p, k){ const R = k.R; p.on(k.bi(k.BL,'head'));
      // three spiky tufts on top + spots on the back
      for(const [az, el, sc] of [[0.1, 1.25, 1.0], [-0.55, 1.05, 0.8], [0.75, 1.05, 0.8]]){ const q = k.hs(az, el, -0.02); p.add(R.cone, '#5e3a1e', [q[0]-0.02, q[1]+0.06*sc, q[2]], [az*0.4, 0, 0.35], [0.055*sc, 0.17*sc, 0.055*sc]); }
      p.on(k.bi(k.BL,'body'));
      for(const [x, y, z] of [[-0.1, 0.12, 0.16], [-0.16, 0.0, 0.1], [-0.05, 0.2, -0.15], [0.02, 0.05, 0.2]]) p.add(R.sl, '#7a4e2a', [x, k.bodyY + y, z], null, [0.06, 0.05, 0.04]); } }); },
  shield(){ return dogBP({ id:'shield', fur:'#d9b98c', light:'#f7ead2', ear:'floppy', earCol:'#a8784a', suit:'#6f9ad0', tail:'up',
    gear(p, k){ const R = k.R; p.on(k.bi(k.BL,'head'));
      // blue helmet with a crest
      p.add(R.hemi, '#6f9ad0', [k.HC[0]-0.02, k.HC[1]+0.03, 0], [0,0,0.18], [k.headR[0]*1.05, k.headR[1]*1.02, k.headR[2]*1.06]);
      p.add(R.tor(0.4, 0.035, TAU, 18), '#4f78b0', [k.HC[0]-0.02, k.HC[1]+0.05, 0], [HP, 0.18, 0], [1.02, 1.05, 1]);
      p.add(R.sm, '#ffcf3a', [k.HC[0]-0.03, k.HC[1]+k.headR[1]+0.05, 0], [0,0,0.2], [0.2, 0.06, 0.05]);
      p.on(k.bi(k.BL,'body'));
      p.add(R.sm, '#8fb4e6', [k.bR[0]*0.45, k.bodyY+0.02, 0], null, [k.bR[0]*0.62, k.bR[1]*0.78, k.bR[2]*0.9]);
      // shield in the front arm, pre-rotated so it faces forward when the arm is raised to GUARD
      const G0 = 1.25, sh = k.boneAt(k.BL,'armF');
      const ox = 0.33, oy = -0.02, c = Math.cos(-G0), s = Math.sin(-G0);
      const cx = sh[0] + (ox*c - oy*s), cy = sh[1] + (ox*s + oy*c);
      p.on(k.bi(k.BL,'armF'));
      p.add(R.cyl, '#d6ecff', [cx, cy, 0.07], [0, 0, -G0 - HP], [0.3, 0.06, 0.26]);
      p.add(R.tor(1, 0.1, TAU, 18), '#7fa8e0', [cx, cy, 0.07], [0, HP, -G0], [0.27, 0.3, 0.3], 'ZYX');
      // bone emblem (in the shield plane, a little in front)
      const nx = Math.cos(-G0), ny = Math.sin(-G0), ux = -Math.sin(-G0), uy = Math.cos(-G0);
      const ex = cx + nx*0.045, ey = cy + ny*0.045;
      p.add(R.cap(0.032, 0.16), '#6f9ad0', [ex, ey, 0.07], [HP, 0, 0]);
      for(const a of [-1,1]) for(const b of [-1,1]) p.add(R.st, '#6f9ad0', [ex + ux*b*0.035, ey + uy*b*0.035, 0.07 + a*0.105], null, 0.042);
    } }); },
  pounce(){ return dogBP({ id:'pounce', fur:'#cf6a36', light:'#f8e2c4', ear:'pointy', earIn:'#f0b0a0', earH:0.3, lean:1, lanky:0.6, tail:'up',
    gear(p, k){ const R = k.R; p.on(k.bi(k.BL,'head'));
      for(const [az, el] of [[0, 0.95], [0.28, 0.9], [-0.28, 0.9]]){ const q = k.hs(az, el, 0.0); p.add(R.capL(0.022, 0.08), '#6a2a12', q, srot(az, el, 0), null, 'YXZ'); }
      p.on(k.bi(k.BL,'body'));
      for(const y of [0.1, 0.0]) p.add(R.tor(0.2, 0.02, 1.4, 8), '#8a3a18', [-0.08, k.bodyY + y, 0], [HP, 0, -2.4]); } }); },
  bomber(){ return dogBP({ id:'bomber', fur:'#f2dfb8', light:'#fff6e6', ear:'big', earIn:'#f4b0c4', eye:0.095, eyeAz:0.5, lanky:0, headR:[0.4, 0.36, 0.41], tail:'up', tailTip:'#f2dfb8',
    gear(p, k){ const R = k.R; p.on(k.bi(k.BL,'head'));
      // round bomb helmet + curly fuse
      p.add(R.hemi, '#3a3446', [k.HC[0]-0.03, k.HC[1]+0.08, 0], [0,0,0.1], [0.36, 0.34, 0.38]);
      p.add(R.tor(0.35, 0.03, TAU, 22), '#ffcf3a', [k.HC[0]-0.03, k.HC[1]+0.1, 0], [HP, 0.1, 0]);
      const top = [k.HC[0]-0.06, k.HC[1]+0.42, 0];
      p.add(R.cyl8, '#8a6a4a', [top[0], top[1]+0.04, 0], [0,0,0.2], [0.035, 0.1, 0.035]);
      p.add(R.cyl8, '#a07a52', [top[0]-0.03, top[1]+0.12, 0], [0,0,-0.4], [0.03, 0.09, 0.03]); } }); },
  thrower(){ return dogBP({ id:'thrower', held:true, fur:'#c9c0b6', light:'#f4efe8', ear:'pointy', earCol:'#3a3446', earIn:'#6a6478', suit:'#3a3446', sleeve:'#3a3446', pants:'#3a3446',
    paw:'#f4efe8', foot:'#f4efe8', tailCol:'#3a3446', tailTip:'#f4efe8', belly:'#3a3446', earH:0.22,
    gear(p, k){ const R = k.R; p.on(k.bi(k.BL,'body'));
      // bone ribs on the costume (lying on the chest surface)
      const FB = { c:[0, k.bodyY, 0], r:k.bR }, rib = R.capL(0.02, 0.1);
      for(let i=0;i<3;i++){ const el = 0.35 - i*0.3; for(const zs of [1,-1]) feat(p, rib, '#f4efe8', FB, zs*0.42, el, 0, HP + zs*0.35); }
      feat(p, R.capL(0.022, 0.2), '#f4efe8', FB, 0.02, 0.05, 0, 0);
      // hood (dark) over the head, face stays visible
      p.on(k.bi(k.BL,'head'));
      p.add(R.hemi, '#3a3446', [k.HC[0]-0.05, k.HC[1]+0.0, 0], [0, 0, 0.62], [k.headR[0]*1.07, k.headR[1]*1.08, k.headR[2]*1.08]);
      // bone stripes on the legs / arms
      for(const nm of ['legF','legB']){ const at = k.boneAt(k.BL, nm); p.on(k.bi(k.BL, nm)); p.add(R.capL(0.02, 0.06), '#f4efe8', [at[0]+0.07, at[1]*0.55, at[2]], null); }
      for(const nm of ['armF','armB']){ const zs = nm==='armF'?1:-1, at = k.boneAt(k.BL, nm); p.on(k.bi(k.BL, nm)); p.add(R.capL(0.02, 0.06), '#f4efe8', [at[0]+0.07, at[1]-0.1, at[2]+zs*0.025], null); }
      // the bone it is about to throw (own bone → scaled to 0 right after the throw)
      const hb2 = k.boneAt(k.BL, 'held'); p.on(k.bi(k.BL, 'held'));
      p.add(R.cap(0.045, 0.24), '#fff4e0', hb2, [0, 0, 0.5]);
      for(const a of [-1,1]) for(const b of [-1,1]){ const c = Math.cos(0.5), sn = Math.sin(0.5), lx = a*0.04, ly = b*0.16; p.add(R.sl, '#fff4e0', [hb2[0] + lx*c - ly*sn, hb2[1] + lx*sn + ly*c, hb2[2]], null, 0.055); } } }); },
  flyer(){ return dogBP({ id:'flyer', fur:'#c89a68', light:'#f6e6cc', ear:'pointy', earIn:'#f0b8a0', collar:'#e04a3a', studs:false, tail:'up', noArms:true,
    sleeve:'#7a5638', paw:'#f0dcb8',
    gear(p, k){ const R = k.R; p.on(k.bi(k.BL,'head'));
      // goggles on the forehead
      p.add(R.tor(1, 0.03, TAU, 20), '#6a4424', [k.HC[0], k.HC[1]+0.12, 0], [HP, 0, 0.3], [k.headR[0]*0.95, k.headR[2]*0.96, 1], 'ZYX');
      for(const az of [0.36, -0.36]){ const q = k.hs(az, 0.46, 0.02);
        p.add(R.tor(0.075, 0.022, TAU, 14), '#c8ced8', q, srot(az, 0.46, 0), null, 'YXZ');
        p.add(R.sm, '#8fe0ff', q, srot(az, 0.46, 0), [0.07, 0.07, 0.035], 'YXZ'); }
      // scarf tail flowing back
      p.on(k.bi(k.BL,'body'));
      p.add(R.sm, '#e04a3a', [-0.2, k.neckY - 0.04, 0.05], [0.3, 0, 0.6], [0.14, 0.05, 0.07]);
      // wings replace the arms (the arm bones flap them): three feathers fanning up-back-outward from the shoulder blade
      for(const nm of ['armF','armB']){
        const zs = nm==='armF' ? 1 : -1, at = k.boneAt(k.BL, nm);
        p.on(k.bi(k.BL, nm));
        const bx = at[0]-0.12, by = at[1]+0.02, bz = at[2]*0.7;
        const fans = [[-0.8, 0.6, 0.55, 0.34, '#7a5638'], [-0.9, 0.32, 0.5, 0.3, '#8a6444'], [-0.9, 0.06, 0.42, 0.24, '#f0dcb8']];
        for(const [dx, dy, dz, L, col] of fans){
          const n = Math.hypot(dx, dy, dz), ux = dx/n, uy = dy/n, uz = zs*dz/n;
          const az = Math.atan2(uz, ux), el = Math.asin(uy);
          p.add(R.sl, col, [bx + ux*L*0.95, by + uy*L*0.95, bz + uz*L*0.95], srot(az, el, 0), [0.035, 0.12, L], 'YXZ');
        }
      }
    } }); },
  kire(){ return blobBP({ id:'kire', R:0.46, col:'#e25a4c', mouth:'frown', mouthEl:-0.16, fist:'#ffb4a0', foot:'#5a2a26', eye:0.085,
    gear(p, k){ const R = k.R;
      // white headband with flowing tails + black topknot
      p.add(R.tor(k.Rb*0.86, 0.05, TAU, 24), '#fff6ee', [0, k.cy + k.Rb*0.4, 0], [HP, 0, 0.12], [1, 0.97, 1]);
      p.add(R.sm, '#ff3a3a', k.hs(0.1, 0.55, 0.05), srot(0.1, 0.55, 0), [0.06, 0.06, 0.03], 'YXZ');
      p.add(R.sm, '#fff6ee', [-k.Rb*0.95, k.cy + k.Rb*0.36, 0.06], [0.3, 0, 0.9], [0.14, 0.035, 0.06]);
      p.add(R.sm, '#fff6ee', [-k.Rb*0.98, k.cy + k.Rb*0.3, -0.06], [-0.3, 0, 1.2], [0.12, 0.035, 0.06]);
      p.add(R.sm, '#2a2230', [-0.04, k.cy + k.Rb*0.98, 0], null, [0.1, 0.09, 0.1]);
      p.add(R.cyl8, '#2a2230', [-0.02, k.cy + k.Rb*0.9, 0], null, [0.05, 0.08, 0.05]);
    } }); },
  pierrot(){ return blobBP({ id:'pierrot', R:0.44, faceLift:1.058, col:'#5a7ad8', belly:'#7fa0f0', fist:'#ffffff', foot:'#ff5a8a', eye:0.08, starUp:0.52, height:1.42,
    gear(p, k){ const R = k.R;
      // white face disc, red nose, cone hat with pompom, frilly ruff
      p.add(R.shell, '#fffaf2', [0, k.cy, 0], srot(0, 0.06, 0), [k.bRad[0]*1.05, k.bRad[1]*1.05, k.bRad[2]*1.05], 'YXZ');
      p.add(R.sm, '#ff3a4a', k.hs(0.0, -0.08, 0.03), null, 0.075);
      p.add(R.st, '#ffffff', k.hs(0.12, 0.0, 0.12), null, 0.02);
      const sm = k.hs(0.0, -0.3, 0.0); p.add(R.tor(0.1, 0.018, PI, 10), '#e0304a', sm, [0, HP, PI], null, 'YXZ');
      const hy = k.cy + k.Rb*0.82;
      p.add(R.cone, '#ff5a8a', [-0.06, hy + 0.2, 0], [0, 0, 0.18], [0.26, 0.46, 0.26]);
      p.add(R.tor(0.2, 0.035, TAU, 20), '#ffe14d', [-0.04, hy + 0.1, 0], [HP, 0.18, 0]);
      p.add(R.tor(0.12, 0.03, TAU, 16), '#ffe14d', [-0.08, hy + 0.27, 0], [HP, 0.18, 0]);
      p.add(R.sm, '#ffffff', [-0.13, hy + 0.45, 0], null, 0.075);
      for(let i=0;i<12;i++){ const a = i/12*TAU; p.add(R.sl, i%2 ? '#ffffff' : '#ffe14d', [Math.cos(a)*k.Rb*0.86, k.cy - k.Rb*0.5, Math.sin(a)*k.Rb*0.86], null, [0.09, 0.06, 0.09]); } } }); },
  oni(){ return blobBP({ id:'oni', R:0.62, legTop:0.22, mouth:'line', mouthEl:-0.12, col:'#4a6ad0', belly:'#6f8ce6', fist:'#6f8ce6', foot:'#2a2440', eye:0.105, eyeAz:0.34, limb:1.3, height:1.8,
    gear(p, k){ const R = k.R;
      // gold horns
      for(const zs of [1,-1]){ const q = k.hs(zs*0.55, 1.05, -0.03); p.add(R.cone, '#ffd23a', [q[0], q[1]+0.08, q[2]], [zs*0.35, 0, 0.1], [0.08, 0.2, 0.08]); }
      // fangs + frown
      for(const zs of [1,-1]){ const q = k.hs(zs*0.16, -0.2, 0.0); p.add(R.cone, '#ffffff', [q[0], q[1]-0.03, q[2]], [0, 0, PI], [0.03, 0.07, 0.03]); }
      // tiger-stripe waist cloth
      p.on(k.bi(k.BL,'body'));
      p.add(R.cyl, '#ffc23a', [0, k.cy - k.Rb*0.62, 0], null, [k.Rb*0.86, 0.24, k.Rb*0.84]);
      for(let i=0;i<8;i++){ const a2 = i/8*TAU + 0.2; p.add(R.capL(0.022, 0.12), '#2a2230', [Math.cos(a2)*k.Rb*0.87, k.cy - k.Rb*0.62, Math.sin(a2)*k.Rb*0.85], [0, -a2, 0.35]); }
      // wooden club with round knobs (front hand)
      const at = k.boneAt(k.BL,'armF');
      p.on(k.bi(k.BL,'armF'));
      // held in the paw, resting back over the shoulder (never in front of the face)
      const hx = at[0]+0.04, hy = at[1]-0.26, hz = at[2]+0.12, ca = 0.55, dx = -Math.sin(ca), dy = Math.cos(ca);
      const along = (d)=> [hx + dx*d, hy + dy*d, hz];
      p.add(R.cyl8, '#7a5230', along(0.05), [0, 0, ca], [0.045, 0.32, 0.045]);
      p.add(R.cyl, '#a0764a', along(0.42), [0, 0, ca], [0.13, 0.46, 0.13]);
      p.add(R.sm, '#a0764a', along(0.66), [0, 0, ca], [0.13, 0.08, 0.13]);
      for(let i=0;i<8;i++){ const a3 = i/8*TAU*2.2, d = 0.28 + (i/8)*0.36, q = along(d); p.add(R.sl, '#d8c29a', [q[0] + Math.cos(a3)*0.13*dy, q[1] - Math.cos(a3)*0.13*dx, q[2] + Math.sin(a3)*0.13], null, 0.04); } } }); },
};
// custom bodies ------------------------------------------------------------------------------------------
LOOK.boar = function(){
  const R = prim();
  const BL = bones([
    { n:'root', p:-1, at:[0,0,0] },
    { n:'body', p:0, at:[0, 0.3, 0] },
    { n:'head', p:1, at:[0.3, 0.58, 0] },
    { n:'q1', p:0, at:[0.26, 0.28, 0.18] }, { n:'q2', p:0, at:[0.26, 0.28, -0.18] },
    { n:'q3', p:0, at:[-0.34, 0.28, 0.18] }, { n:'q4', p:0, at:[-0.34, 0.28, -0.18] },
    { n:'tail', p:1, at:[-0.56, 0.66, 0] },
    { n:'earF', p:2, at:[0.44, 0.88, 0.17] }, { n:'earB', p:2, at:[0.44, 0.88, -0.17] },
  ]);
  const col = '#84603e', light = '#b48a62', dark = '#4a3220';
  const p = Parts();
  p.on(bi(BL,'body'));
  p.add(R.s, col, [-0.06, 0.58, 0], null, [0.5, 0.36, 0.37]);
  p.add(R.sm, light, [0.0, 0.42, 0], null, [0.36, 0.2, 0.28]);
  p.add(R.cyl, '#5aa04a', [-0.04, 0.58, 0], [0, 0, HP], [0.375, 0.18, 0.385]);
  p.add(R.rbox, '#ffcf3a', [-0.04, 0.58, 0.39], null, [0.12, 0.12, 0.04]);
  for(let i=0;i<6;i++){ const x = 0.22 - i*0.12; p.add(R.cone, dark, [x, 0.95 - Math.abs(x+0.06)*0.2, 0], [0, 0, 0.35], [0.05, 0.13, 0.05]); }
  p.on(bi(BL,'tail')); p.add(R.tor(0.05, 0.018, TAU*0.8, 10), dark, [-0.6, 0.68, 0], [0, HP, 0]);
  p.on(bi(BL,'head'));
  const hc = [0.54, 0.64, 0], hr = [0.3, 0.29, 0.31];
  p.add(R.s, col, hc, null, hr);
  p.add(R.cyl, '#d89a82', [0.82, 0.57, 0], [0, 0, -HP], [0.12, 0.12, 0.13]);
  p.add(R.cyl, '#eab4a0', [0.88, 0.57, 0], [0, 0, -HP], [0.1, 0.02, 0.11]);
  for(const zs of [1,-1]){
    p.add(R.sl, '#5a3a30', [0.895, 0.57, zs*0.04], null, [0.012, 0.03, 0.02]);
    p.add(R.cone, '#fff4dc', [0.8, 0.5, zs*0.12], [zs*0.25, 0, -0.5], [0.028, 0.1, 0.028]);
  }
  for(const nm of ['earF','earB']){ const zs = nm==='earF'?1:-1, at = boneAt(BL, nm); p.on(bi(BL, nm));
    p.add(R.cone, col, [at[0], at[1]+0.07, at[2]], [zs*0.4, 0, -0.35], [0.08, 0.16, 0.05]);
    p.add(R.cone, '#e8a0a0', [at[0]+0.015, at[1]+0.06, at[2]], [zs*0.4, 0, -0.35], [0.045, 0.1, 0.03]); }
  for(const nm of ['q1','q2','q3','q4']){ const at = boneAt(BL, nm); p.on(bi(BL, nm));
    p.add(R.cap(0.085, 0.08), col, [at[0], 0.18, at[2]], null);
    p.add(R.cyl, dark, [at[0]+0.01, 0.05, at[2]], null, [0.085, 0.1, 0.085]); }
  const geo = merge(p.list, true);
  const hcl = [hc[0]-0.3, hc[1]-0.58, 0];
  const face = faceSet('boar', { c:hcl, r:hr, az:0.52, el:0.32, size:0.068, tilt:0.55, dropAz:1.15, dropEl:0.7 });
  return { id:'boar', kind:'quad', BL, geo, face, faceBone:'head', height:1.02, radius:0.5, outline:0.022, lieLift:0.36, lieShift:0, rough:0.75,
    stars:{ bone:'head', pos:[hcl[0], hcl[1]+hr[1]+0.14, 0] }, tip:{ bone:'head', pos:[0.62, -0.05, 0] }, base:{ bone:'head', pos:[0.2,0,0] } };
};
LOOK.ari = function(){
  const R = prim();
  const BL = bones([
    { n:'root', p:-1, at:[0,0,0] },
    { n:'body', p:0, at:[0, 0.2, 0] },
    { n:'head', p:1, at:[0.04, 0.56, 0] },
    { n:'armF', p:1, at:[0.06, 0.47, 0.17] }, { n:'armB', p:1, at:[0.06, 0.47, -0.17] },
    { n:'legF', p:0, at:[0, 0.2, 0.1] }, { n:'legB', p:0, at:[0, 0.2, -0.1] },
    { n:'tail', p:1, at:[-0.12, 0.34, 0] },
    { n:'earF', p:2, at:[0.1, 1.0, 0.1] }, { n:'earB', p:2, at:[0.1, 1.0, -0.1] },
  ]);
  const blk = '#34303c', blk2 = '#4a4454', p = Parts();
  p.on(bi(BL,'body'));
  p.add(R.s, blk, [0.03, 0.38, 0], null, [0.17, 0.2, 0.16]);
  for(const zs of [1,-1]) p.add(R.capL(0.03, 0.14), blk2, [0.02, 0.33, zs*0.2], [zs*0.9, 0, 0.3]);
  p.add(R.tor(0.15, 0.045, TAU, 20), '#e24a3a', [0.04, 0.54, 0], [HP, 0, 0.1]);
  p.add(R.sm, '#e24a3a', [-0.13, 0.5, 0.05], [0.4, 0, 0.9], [0.1, 0.04, 0.07]);
  p.on(bi(BL,'tail'));
  p.add(R.s, blk, [-0.26, 0.36, 0], [0, 0, 0.45], [0.25, 0.2, 0.2]);
  p.add(R.tor(0.19, 0.02, TAU, 20), blk2, [-0.24, 0.37, 0], [0, HP, 0.45], [1, 1.05, 1]);
  p.add(R.tor(0.15, 0.02, TAU, 18), blk2, [-0.34, 0.32, 0], [0, HP, 0.45], [1, 1.05, 1]);
  p.on(bi(BL,'head'));
  const hc = [0.08, 0.82, 0], hr = [0.33, 0.3, 0.34];
  p.add(R.s, blk, hc, null, hr);
  p.add(R.sm, '#5a4a52', [0.36, 0.74, 0], null, [0.1, 0.08, 0.13]);
  for(const zs of [1,-1]) p.add(R.cone, '#a0683a', [0.43, 0.68, zs*0.05], [zs*0.4, 0, -2.2], [0.03, 0.09, 0.03]);
  for(const nm of ['earF','earB']){ const zs = nm==='earF'?1:-1, at = boneAt(BL, nm); p.on(bi(BL, nm));
    p.add(R.capL(0.016, 0.2), blk, [at[0]+0.05, at[1]+0.11, at[2]+zs*0.03], [zs*0.3, 0, -0.45]);
    p.add(R.sm, '#e24a3a', [at[0]+0.12, at[1]+0.22, at[2]+zs*0.06], null, 0.045); }
  for(const nm of ['armF','armB']){ const zs = nm==='armF'?1:-1, at = boneAt(BL, nm); p.on(bi(BL, nm));
    p.add(R.cap(0.04, 0.14), blk2, [at[0]+0.01, at[1]-0.1, at[2]+zs*0.02], [zs*0.15, 0, 0]);
    p.add(R.sm, blk, [at[0]+0.02, at[1]-0.2, at[2]+zs*0.03], null, 0.06); }
  // shovel in the front hand
  { const at = boneAt(BL,'armF'); p.on(bi(BL,'armF'));
    const hx = at[0]+0.03, hy = at[1]-0.2, hz = at[2]+0.07;
    p.add(R.cyl8, '#b07a4a', [hx+0.02, hy+0.06, hz], [0, 0, -0.1], [0.024, 0.62, 0.024]);
    p.add(R.tor(0.04, 0.014, TAU, 10), '#b07a4a', [hx+0.05, hy+0.39, hz], [0, 0, -0.1]);
    p.add(R.rbox, '#c0c8d4', [hx-0.01, hy-0.32, hz], [0, 0, -0.1], [0.16, 0.2, 0.035]);
    p.add(R.rbox, '#9aa2b0', [hx, hy-0.2, hz], [0, 0, -0.1], [0.06, 0.06, 0.04]); }
  for(const nm of ['legF','legB']){ const at = boneAt(BL, nm); p.on(bi(BL, nm));
    p.add(R.cap(0.045, 0.08), blk2, [at[0], at[1]*0.55, at[2]], null);
    p.add(R.sm, blk, [at[0]+0.04, 0.05, at[2]], null, [0.09, 0.055, 0.07]); }
  const geo = merge(p.list, true);
  const hcl = [hc[0]-0.04, hc[1]-0.56, 0];
  const face = faceSet('ari', { c:hcl, r:hr, az:0.42, el:0.12, size:0.085, tilt:0.5 });
  return { id:'ari', kind:'biped', BL, geo, face, faceBone:'head', height:1.28, radius:0.4, outline:0.02, lieLift:0.3, lieShift:0.5, rough:0.5,
    stars:{ bone:'head', pos:[hcl[0], hcl[1]+hr[1]+0.14, 0] }, tip:{ bone:'armF', pos:[0.02, -0.52, 0.07] }, base:{ bone:'armF', pos:[0.02, -0.1, 0.07] } };
};
LOOK.mecha = function(){
  const R = prim();
  const BL = bones([
    { n:'root', p:-1, at:[0,0,0] },
    { n:'body', p:0, at:[0, 0.22, 0] },
    { n:'head', p:1, at:[0.02, 0.6, 0] },
    { n:'armF', p:1, at:[0.02, 0.52, 0.26] }, { n:'armB', p:1, at:[0.02, 0.52, -0.26] },
    { n:'legF', p:0, at:[0, 0.22, 0.12] }, { n:'legB', p:0, at:[0, 0.22, -0.12] },
    { n:'tail', p:1, at:[-0.22, 0.42, 0] },
  ]);
  const m1 = '#cfd5de', m2 = '#9aa2b0', m3 = '#5a6070', dk = '#262a34', p = Parts();
  p.on(bi(BL,'body'));
  p.add(R.rbox, m1, [0, 0.42, 0], null, [0.46, 0.4, 0.44]);
  p.add(R.rbox, dk, [0.2, 0.42, 0], null, [0.1, 0.24, 0.3]);
  p.add(R.sl, '#ff4a4a', [0.26, 0.47, 0.07], null, 0.035);
  p.add(R.sl, '#ffd23a', [0.26, 0.47, -0.02], null, 0.03);
  p.add(R.rbox, m2, [0, 0.6, 0], null, [0.36, 0.08, 0.36]);
  for(const zs of [1,-1]) p.add(R.sl, m3, [0.0, 0.46, zs*0.23], null, 0.05);
  p.on(bi(BL,'tail'));
  p.add(R.cyl8, m3, [-0.3, 0.52, 0], [0, 0, 0.7], [0.022, 0.26, 0.022]);
  p.add(R.sm, '#ff4a4a', [-0.39, 0.62, 0], null, 0.045);
  p.on(bi(BL,'head'));
  const hc = [0.05, 0.9, 0];
  p.add(R.rbox, m1, hc, null, [0.64, 0.54, 0.66]);
  p.add(R.rbox, dk, [0.3, 0.92, 0], null, [0.14, 0.26, 0.5]);
  p.add(R.rbox, m2, [0.36, 0.74, 0], null, [0.12, 0.12, 0.26]);
  for(let i=0;i<3;i++) p.add(R.capL(0.008, 0.08), dk, [0.425, 0.745, -0.05 + i*0.05], null);
  for(const zs of [1,-1]){ p.add(R.pyr, m2, [0.0, 1.2, zs*0.22], [zs*0.3, 0, 0.1], [0.13, 0.2, 0.08]); p.add(R.pyr, '#ff7a7a', [0.03, 1.18, zs*0.22], [zs*0.3, 0, 0.1], [0.07, 0.12, 0.05]); }
  p.add(R.cyl8, m3, [-0.08, 1.24, 0], null, [0.02, 0.16, 0.02]);
  p.add(R.sm, '#ff4a4a', [-0.08, 1.33, 0], null, 0.045);
  for(const zs of [1,-1]) p.add(R.cyl, m2, [0.05, 0.9, zs*0.34], [HP, 0, 0], [0.09, 0.04, 0.09]);
  for(const nm of ['armF','armB']){ const zs = nm==='armF'?1:-1, at = boneAt(BL, nm); p.on(bi(BL, nm));
    p.add(R.sl, m3, [at[0], at[1], at[2]], null, 0.07);
    p.add(R.cap(0.06, 0.12), m2, [at[0]+0.01, at[1]-0.13, at[2]+zs*0.02], null);
    p.add(R.sm, m1, [at[0]+0.02, at[1]-0.25, at[2]+zs*0.03], null, [0.085, 0.075, 0.085]);
    for(let i=-1;i<=1;i++) p.add(R.cone6, m3, [at[0]+0.08, at[1]-0.3, at[2]+zs*0.03+i*0.04], [0,0,PI-0.3], [0.018, 0.06, 0.018]); }
  for(const nm of ['legF','legB']){ const at = boneAt(BL, nm); p.on(bi(BL, nm));
    p.add(R.cap(0.06, 0.06), m2, [at[0], at[1]*0.55, at[2]], null);
    p.add(R.rbox, m1, [at[0]+0.04, 0.05, at[2]], null, [0.2, 0.1, 0.14]); }
  const geo = merge(p.list, true);
  const hcl = [hc[0]-0.02, hc[1]-0.6, 0];
  const face = mechaFace('mecha', [0.39, hcl[1]+0.02, 0], 0.1);
  return { id:'mecha', kind:'biped', mecha:true, BL, geo, face, faceBone:'head', height:1.4, radius:0.44, outline:0.02, lieLift:0.3, lieShift:0.5, rough:0.42, metal:0.25,
    stars:{ bone:'head', pos:[hcl[0], hcl[1]+0.42, 0] }, tip:{ bone:'head', pos:[0.42, hcl[1]+0.02, 0] }, base:{ bone:'head', pos:[0.2, hcl[1], 0] } };
};
LOOK.balloon = function(){
  const R = prim();
  const BL = bones([
    { n:'root', p:-1, at:[0,0,0] },
    { n:'body', p:0, at:[0, 0.55, 0] },
    { n:'head', p:1, at:[0, 0.55, 0] },
    { n:'tail', p:0, at:[0, 0.1, 0] },
  ]);
  const p = Parts();
  p.on(bi(BL,'head'));
  p.add(R.s, '#ff4a5a', [0, 0.55, 0], null, [0.36, 0.41, 0.36]);
  feat(p, R.domeS, '#ffe0e8', { c:[0, 0.55, 0], r:[0.36, 0.41, 0.36] }, 1.1, 0.62, -0.004, 0.5, [0.06, 0.11, 0.03]);
  p.add(R.cone, '#e0303e', [0, 0.12, 0], [PI, 0, 0], [0.06, 0.08, 0.06]);
  p.add(R.sm, '#e0303e', [0, 0.1, 0], null, [0.045, 0.03, 0.045]);
  p.on(bi(BL,'tail'));
  p.add(R.capL(0.011, 0.36), '#f4efe8', [0.02, -0.12, 0], [0, 0, 0.12]);
  p.add(R.capL(0.011, 0.2), '#f4efe8', [0.02, -0.42, 0], [0, 0, -0.25]);
  const geo = merge(p.list, true);
  const face = faceSet('balloon', { c:[0,0,0], r:[0.36, 0.41, 0.36], az:0.38, el:0.16, size:0.072, style:'dot', tilt:0.55, mouthO:{ el:-0.2 }, dropAz:1.0, dropEl:0.5 });
  return { id:'balloon', kind:'balloon', headYaw:-0.6, BL, geo, face, faceBone:'head', height:1.0, radius:0.36, outline:0.02, lieLift:0, lieShift:0, rough:0.25,
    stars:null, tip:{ bone:'head', pos:[0.3, 0, 0] }, base:{ bone:'head', pos:[0, 0, 0] } };
};

// ---------------------------------------------------------------- the happy puppy a non-dog foe turns into (one plain mesh)
const pupCache = new Map();
function pupGeo(scarf){
  if(pupCache.has(scarf)) return pupCache.get(scarf);
  const R = prim(), fur = '#fff3dc', light = '#fffaf0', ear = '#efd2a4';
  const hc = [0.08, 0.53, 0], hr = [0.26, 0.24, 0.26];
  const g = plain((p)=>{
    p.add(R.s, fur, [-0.03, 0.25, 0], null, [0.21, 0.18, 0.17]);
    p.add(R.sm, light, [0.1, 0.26, 0], null, [0.12, 0.12, 0.11]);
    p.add(R.s, fur, hc, null, hr);
    p.add(R.sm, light, [0.29, 0.46, 0], null, [0.1, 0.075, 0.11]);
    p.add(R.sl, '#2a2028', [0.38, 0.49, 0], null, [0.03, 0.028, 0.04]);
    p.add(R.sm, '#ff7a8a', [0.33, 0.405, 0], [0,0,-0.3], [0.035, 0.022, 0.03]);
    for(const zs of [1,-1]){
      p.add(R.sm, ear, [0.02, 0.56, zs*0.25], [-zs*0.45, 0, 0.1], [0.07, 0.15, 0.04]);
      p.add(R.sm, fur, [0.12, 0.08, zs*0.09], null, [0.06, 0.07, 0.055]);
      p.add(R.sm, fur, [-0.14, 0.08, zs*0.09], null, [0.06, 0.07, 0.055]);
    }
    p.add(R.cap(0.04, 0.12), fur, [-0.26, 0.36, 0], [0,0,0.75]);
    p.add(R.tor(0.15, 0.035, TAU, 18), scarf, [0.04, 0.37, 0], [HP, 0, 0.15]);
    p.add(R.sm, scarf, [0.19, 0.33, 0.06], null, [0.05, 0.04, 0.04]);
    const F = { c:hc, r:hr };
    const arc = R.tor(0.036, 0.011, PI, 10);
    for(const i of [1,-1]){ feat(p, arc, C.ink, F, i*0.42, 0.1, 0.004, 0, 1); feat(p, R.sl, C.blush, F, i*0.72, -0.12, 0.0, 0, [0.07, 0.04, 0.02]); }
  });
  pupCache.set(scarf, g);
  return g;
}
const PUP_SCARF = { boar:'#5aa04a', kire:'#e25a4c', pierrot:'#5a7ad8', oni:'#4a6ad0', ari:'#e24a3a', mecha:'#9aa2b0' };

function blueprint(type){
  if(BP[type]) return BP[type];
  const f = LOOK[type];
  if(!f) return null;
  BP[type] = f();
  return BP[type];
}

// ================================================================ rig assembly
const POSE_KEYS = ['lean','sq','bob','px','lie','spin','roll','hx','hy','hz','aF','aB','aFx','aBx','lF','lB','lFy','lBy','q1','q2','q3','q4','tz','ty','eF','eB','sway','puff'];
function makeRig(type, ent){
  const bp = blueprint(type);
  if(!bp) return null;
  const r = { type, bp, alpha:1, T:{}, Cc:{}, clock: Math.floor(Math.random()*400), phase:0, blinkT: 60 + Math.floor(Math.random()*120), expr:'angry',
    sqv:0, sqp:0, prevFlash:0, wasGround:true, lastVy:0, headA:-TURN, fl:-1, mats:[], own:[], pupOn:false };
  for(const k of POSE_KEYS){ r.T[k] = 0; r.Cc[k] = 0; }
  const root = r.root = new THREE.Group(); root.name = 'zako_'+type;
  const turn = r.turn = new THREE.Group(); root.add(turn);
  const flip = r.flip = new THREE.Group(); turn.add(flip);
  const mat = r.mat = G.look.vmat({ instance:true, rough: bp.rough, metal: bp.metal||0 });
  r.mats.push(mat); r.own.push(mat);
  // bones
  const B = r.B = {}, list = r.bones = [];
  for(const bd of bp.BL){
    const bn = new THREE.Bone(); bn.name = bd.n;
    const par = bd.p>=0 ? bp.BL[bd.p].at : [0,0,0];
    bn.position.set(bd.at[0]-par[0], bd.at[1]-par[1], bd.at[2]-par[2]);
    bn.userData.ry = bn.position.y;
    if(bd.p>=0) list[bd.p].add(bn);
    list.push(bn); B[bd.n] = bn;
  }
  const mesh = r.mesh = new THREE.SkinnedMesh(bp.geo, mat);
  mesh.add(list[0]);
  flip.add(mesh);
  mesh.updateMatrixWorld(true);
  const skel = r.skel = new THREE.Skeleton(list);
  mesh.bind(skel);
  mesh.castShadow = true; mesh.receiveShadow = false;
  mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, bp.height*0.5, 0), bp.height*0.75 + 0.9);
  const ol = new THREE.SkinnedMesh(bp.geo, G.look.outlineMat(bp.outline||0.02, '#3b2417'));
  ol.bind(skel, mesh.bindMatrix);
  ol.boundingSphere = mesh.boundingSphere;
  ol.castShadow = false; ol.userData.isOutline = true; ol.visible = G.quality.tier < 2;
  mesh.add(ol);
  r.outlines = [ol];
  // face
  const fm = r.faceMat = bp.mecha ? glowMat(1.2) : G.look.vmat({ instance:true, rough:0.32, rim:0.25 });
  r.mats.push(fm); r.own.push(fm);
  const face = r.face = new THREE.Mesh(bp.face.angry, fm);
  face.castShadow = false;
  const fb = B[bp.faceBone];
  face.position.set(0,0,0);
  fb.add(face);
  // dizzy stars
  if(bp.stars){
    const st = r.stars = new THREE.Mesh(starGeo(), starMat());
    st.castShadow = false; st.visible = false;
    st.position.set(bp.stars.pos[0], bp.stars.pos[1], bp.stars.pos[2]);
    B[bp.stars.bone].add(st);
  }
  // tip / base
  r.tip = new THREE.Object3D(); r.tip.position.set(bp.tip.pos[0], bp.tip.pos[1], bp.tip.pos[2]); B[bp.tip.bone].add(r.tip);
  r.base = new THREE.Object3D(); r.base.position.set(bp.base.pos[0], bp.base.pos[1], bp.base.pos[2]); B[bp.base.bone].add(r.base);
  // happy puppy for the non-dog types
  if(PUP_SCARF[type]){
    const pup = r.pup = new THREE.Mesh(pupGeo(PUP_SCARF[type]), mat);
    pup.visible = false; pup.castShadow = true;
    r.outlines.push(G.look.outline(pup, 0.018));
    flip.add(pup);
  }
  const X = EXTRA[type];
  if(X && X.build) X.build(r, bp);
  const rig = {
    root, height: bp.height, radius: bp.radius, tip: r.tip, base: r.base, _r: r,
    update(e, dt){ update(r, e); },
    setAlpha(a){ setAlpha(r, a); },
    dispose(){ for(const m of r.own) m.dispose(); skel.dispose(); },
  };
  return rig;
}
function setAlpha(r, a){
  a = U.clamp(a, 0, 1);
  if(a===r.alpha) return;
  r.alpha = a;
  const tr = a < 0.999;
  for(let i=0;i<r.mats.length;i++){ const m = r.mats[i]; if(m.transparent!==tr){ m.transparent = tr; m.needsUpdate = true; } m.opacity = a; }
  r.root.visible = a > 0.01;
  for(let i=0;i<r.outlines.length;i++) r.outlines[i].visible = !tr && G.quality.tier < 2;
  r.mesh.castShadow = a > 0.5;
  if(r.pup) r.pup.castShadow = a > 0.5;
}

// ================================================================ procedural animation
const _w = new THREE.Vector3();
const FX_SPARK = { count:2, scale:0.35, color:'#ffcf5a' }, FX_DUST_S = { count:2, scale:0.45 }, FX_DUST_M = { count:3, scale:0.6 };
const FX_WARN = { flat:true, scale:0.7, color:'#ff5a5a', life:18 };
function fxb(kind, x, y, z, o){ if(G.fx && G.fx.burst) G.fx.burst(kind, x, y, z, o); }

function exprFor(A, e, r){
  switch(A){
    case 'hurt': return 'squeeze';
    case 'down': case 'ko': return 'x';
    case 'dizzy': return 'dizzy';
    case 'cheer': return 'happy';
    case 'getup': return (e.animT < 12) ? 'squeeze' : 'angry';
    case 'fall': return 'squeeze';
  }
  return 'angry';
}
function update(r, e){
  const bp = r.bp, T = r.T;
  r.clock++;
  const k = r.clock;
  const A = e.anim || 'idle', t = e.animT || 0, len = e.animLen || 0;
  const p = len > 0 ? U.clamp(t/len, 0, 1) : 0, hit = U.clamp(e.animHit || 0.35, 0.05, 0.95);
  for(let i=0;i<POSE_KEYS.length;i++) T[POSE_KEYS[i]] = 0;
  r.K = 0.4; r.shake = 0; r.showStars = false;
  let expr = exprFor(A, e, r);
  if(bp.kind==='quad') poseQuad(r, e, A, t, p, hit, k);
  else if(bp.kind==='balloon') poseBalloon(r, e, A, t, p, hit, k);
  else poseBiped(r, e, A, t, p, hit, k);
  const X = EXTRA[r.type];
  if(X && X.pose){ const ex = X.pose(r, e, A, t, p, hit, k, expr); if(ex) expr = ex; }
  // blink (open eyes only)
  if(expr==='angry'){ if(--r.blinkT <= 0){ if(r.blinkT < -5){ r.blinkT = 90 + Math.floor(Math.random()*150); } else expr = 'blink'; } }
  if(expr!==r.expr){ r.expr = expr; r.face.geometry = bp.face[expr] || bp.face.angry; }
  // squash spring: hits and landings
  if(e.flashT > r.prevFlash) r.sqv -= 0.1;
  r.prevFlash = e.flashT || 0;
  if(e.onGround && !r.wasGround && A!=='down' && A!=='ko') r.sqv -= U.clamp(-r.lastVy*0.9, 0.05, 0.18);
  r.wasGround = !!e.onGround; r.lastVy = e.vy || 0;
  r.sqv += -r.sqp*0.3 - r.sqv*0.24; r.sqp += r.sqv;
  // damp toward the targets
  const C = r.Cc, K = r.K;
  for(let i=0;i<POSE_KEYS.length;i++){ const key = POSE_KEYS[i]; C[key] += (T[key] - C[key])*K; }
  // heading (turns through the front so the face stays visible) + z-mirror so held items stay on the camera side
  const want = (e.face||1) >= 0 ? -TURN : -(PI - TURN);
  r.headA += U.clamp((want - r.headA)*0.45, -0.34, 0.34);
  r.turn.rotation.y = r.headA;
  r.flip.scale.z = r.headA < -HP ? -1 : 1;
  const B = r.B, root = B.root;
  const sy = Math.max(0.5, 1 + C.sq + r.sqp), sxz = 1/Math.sqrt(sy), pf = 1 + C.puff;
  root.position.set(C.px + r.shake, C.bob + C.lie*bp.lieLift, 0);
  root.position.x += C.lie*bp.lieShift;
  if(bp.kind==='quad'){ root.rotation.set(-C.lie*HP, 0, C.spin); }
  else root.rotation.set(C.roll, 0, C.lie*HP + C.spin);
  root.scale.set(sxz*pf, sy*pf, sxz*pf);
  if(B.body) B.body.rotation.set(C.sway, 0, C.lean);
  if(B.head) B.head.rotation.set(C.hx, (bp.headYaw==null ? HEAD_YAW : bp.headYaw) + C.hy, C.hz);
  if(B.armF){ B.armF.rotation.set(C.aFx, 0, C.aF); B.armB.rotation.set(C.aBx, 0, C.aB); }
  if(B.legF){ B.legF.rotation.z = C.lF; B.legB.rotation.z = C.lB; B.legF.position.y = B.legF.userData.ry + C.lFy; B.legB.position.y = B.legB.userData.ry + C.lBy; }
  if(B.q1){ B.q1.rotation.z = C.q1; B.q2.rotation.z = C.q2; B.q3.rotation.z = C.q3; B.q4.rotation.z = C.q4; }
  if(B.tail) B.tail.rotation.set(0, C.ty, C.tz);
  if(B.earF){ B.earF.rotation.x = C.eF; B.earB.rotation.x = -C.eB; }
  // stars
  if(r.stars){ r.stars.visible = r.showStars; if(r.showStars){ r.stars.rotation.y = k*0.13; r.stars.position.y = bp.stars.pos[1] + Math.sin(k*0.2)*0.02; } }
  // hit flash (all per-instance materials of this rig)
  const fl = e.flashT > 0 ? 0.3 + 0.1*Math.min(6, e.flashT) : 0;
  if(fl!==r.fl){ r.fl = fl; for(let i=0;i<r.mats.length;i++){ const m = r.mats[i]; if(m.userData.uFlash) m.userData.uFlash.value = fl; } }
  // after KO: the happy puppy (non-dog types)
  if(r.pup){
    const on = !!e.happy;
    if(on!==r.pupOn){ r.pupOn = on; r.mesh.visible = !on; r.face.visible = !on; r.pup.visible = on; if(X && X.hide) X.hide(r, on); }
    if(on){ const up = e.vy||0; const s2 = U.clamp(1 + up*2.2, 0.8, 1.25); r.pup.scale.set(1/Math.sqrt(s2), s2, 1/Math.sqrt(s2)); r.pup.rotation.z = -0.15 + U.clamp(up*2, -0.2, 0.3); }
  }
  if(X && X.post) X.post(r, e, A, t, p, hit, k);
}

// ---------------------------------------------------------------- biped (dogs, blobs, ant, robot)
function poseBiped(r, e, A, t, p, hit, k){
  const T = r.T, bp = r.bp;
  poseBiped0(r, e, A, t, p, hit, k);
  if(bp.blob){
    // round monks don't lie on their back (the face would point at the sky): they squash flat like a pancake
    if((A==='down' || A==='ko') && e.onGround){ T.lie = 0.22; T.sq = -0.3; T.aF = 0.4; T.aB = 0.4; T.aFx = -1.3; T.aBx = 1.3; T.lF = 1.2; T.lB = 1.0; T.bob = -0.02; }
    else if(A==='down' || A==='ko'){ T.lie *= 0.5; }
    else if(A==='getup'){ const q = U.clamp(t/Math.max(1, e.animLen||24), 0, 1); T.lie *= 0.25; T.sq = -0.3*(1 - U.easeOutBack(q)); }
  }
}
function poseBiped0(r, e, A, t, p, hit, k){
  const T = r.T, bp = r.bp;
  const spd = Math.hypot(e.vx||0, e.vz||0);
  // resting arms / tail
  T.aF = 0.22; T.aB = -0.12; T.aFx = -0.12; T.aBx = 0.12; T.tz = 0.1;
  switch(A){
    case 'walk': case 'run': {
      const rate = Math.max(0.24, spd*13) * (A==='run' ? 1.35 : 1);
      r.phase += rate;
      const s = Math.sin(r.phase), c = Math.cos(r.phase);
      T.lF = s*0.72; T.lB = -s*0.72; T.lFy = Math.max(0, c)*0.05; T.lBy = Math.max(0, -c)*0.05;
      T.aF = -s*0.75 + 0.15; T.aB = s*0.75 - 0.05;
      T.bob = Math.abs(c)*0.05; T.sq = -Math.abs(s)*0.035;
      T.lean = -0.1; T.hz = 0.04 + Math.sin(r.phase*2)*0.035;
      T.ty = Math.sin(r.phase*2)*0.45; T.eF = T.eB = Math.abs(s)*0.14;
      r.K = 0.5;
      break;
    }
    case 'windup': case 'roar': {
      const q = U.easeOutCubic(Math.min(1, p*1.7));
      T.lean = 0.3*q; T.sq = -0.1*q; T.aF = U.lerp(0.2, -2.5, q); T.aB = 0.55*q; T.aFx = -0.3*q;
      T.hz = 0.1*q; T.eF = T.eB = -0.35*q; T.lF = 0.28*q; T.lB = -0.28*q; T.tz = 0.4*q;
      r.shake = Math.sin(k*2.4)*(0.01 + 0.035*p);
      if(A==='roar'){ T.hz = 0.35*q; T.aFx = -1.0*q; T.aBx = 1.0*q; T.aF = -0.6; T.aB = -0.6; }
      r.K = 0.35;
      break;
    }
    case 'attack': case 'special': {
      if(p < hit){ const q = Math.pow(p/hit, 1.6);
        T.lean = U.lerp(0.3, -0.3, q); T.aF = U.lerp(-2.5, 1.75, q); T.aB = U.lerp(0.55, -0.6, q); T.sq = U.lerp(-0.1, 0.1, q); T.px = 0.1*q;
        T.hz = U.lerp(0.1, -0.12, q); T.lF = 0.35; T.lB = -0.35; T.aFx = -0.2;
      } else { const q = (p - hit)/(1 - hit), hold = q < 0.3 ? 1 : 1 - U.easeInOutSine((q - 0.3)/0.7);
        T.lean = -0.3*hold; T.aF = 0.2 + 1.9*hold; T.aB = -0.6*hold; T.sq = 0.06*hold; T.px = 0.1*hold; T.hz = -0.12*hold; T.lF = 0.35*hold; T.lB = -0.35*hold; }
      r.K = 0.7;
      break;
    }
    case 'attack2': {
      if(p < hit){ const q = Math.pow(p/hit, 1.5);
        T.lean = U.lerp(0.25, -0.5, q); T.hz = U.lerp(0.2, -0.35, q); T.px = 0.22*q; T.sq = U.lerp(-0.1, 0.12, q); T.aF = T.aB = U.lerp(0.2, -0.9, q); T.lF = 0.45*q; T.lB = -0.5*q;
      } else { const q = (p - hit)/(1 - hit), hold = q < 0.3 ? 1 : 1 - U.easeInOutSine((q - 0.3)/0.7);
        T.lean = -0.5*hold; T.hz = -0.35*hold; T.px = 0.22*hold; T.sq = 0.08*hold; T.aF = T.aB = -0.9*hold; T.lF = 0.45*hold; T.lB = -0.5*hold; }
      r.K = 0.65;
      break;
    }
    case 'shoot': {
      if(p < hit){ const q = Math.pow(p/hit, 1.4); T.aF = U.lerp(-2.9, 1.3, q); T.lean = U.lerp(0.3, -0.25, q); T.aB = 0.5; T.sq = U.lerp(-0.08, 0.08, q); T.hz = 0.1; T.lF = 0.3; T.lB = -0.3; }
      else { const q = (p - hit)/(1 - hit), hold = q < 0.3 ? 1 : 1 - U.easeInOutSine((q - 0.3)/0.7); T.aF = 0.2 + 1.1*hold; T.lean = -0.25*hold; T.aB = 0.5*hold; T.lF = 0.3*hold; T.lB = -0.3*hold; }
      r.K = 0.65;
      break;
    }
    case 'hurt': {
      const back = (e.hurtDir||1) === (e.face||1) ? -1 : 1, dec = Math.exp(-t/9);
      T.lean = back*0.42*dec + 0.05; T.hz = back*0.28*dec; T.aF = 0.4; T.aB = -0.3; T.aFx = -1.0*dec - 0.2; T.aBx = 1.0*dec + 0.2;
      T.sq = Math.sin(t*1.1)*0.13*dec; r.shake = Math.sin(t*3.1)*0.03*dec; T.eF = T.eB = 0.9*dec; T.lF = 0.2; T.lB = -0.2; T.tz = -0.3;
      r.K = 0.6;
      break;
    }
    case 'down': case 'ko': {
      if(!e.onGround){ T.lie = A==='ko' ? Math.min(1.15, t/9) : Math.min(1, t/7); T.aF = -2.4 + Math.sin(k*0.8)*0.5; T.aB = -2.1 - Math.sin(k*0.8)*0.5; T.lF = 0.5 + Math.sin(k*0.7)*0.4; T.lB = 0.2 - Math.sin(k*0.7)*0.4; T.eF = T.eB = 1.0; }
      else { T.lie = 1; T.aF = -2.7; T.aB = -2.5; T.aFx = -0.4; T.aBx = 0.4; T.lF = 0.9 + (A==='ko' ? Math.sin(k*0.45)*0.12 : 0); T.lB = 0.5; T.eF = T.eB = 0.7; T.hz = 0.15; if(A==='ko') r.showStars = true; }
      T.tz = -0.4;
      r.K = 0.45;
      break;
    }
    case 'getup': {
      const q = U.clamp(t/Math.max(1, e.animLen||24), 0, 1);
      T.lie = 1 - U.easeOutBack(q); T.aF = U.lerp(-1.6, 0.3, q); T.aB = U.lerp(-1.4, -0.1, q); T.sq = q > 0.75 ? -0.12*(1-q)/0.25 : 0; T.lF = U.lerp(0.8, 0, q); T.lB = U.lerp(0.4, 0, q);
      r.K = 0.55;
      break;
    }
    case 'dizzy': {
      const w = k*0.12;
      T.lean = Math.sin(w)*0.14; T.sway = Math.cos(w)*0.1; T.hz = Math.sin(w + 1)*0.12; T.hx = Math.cos(w + 1)*0.1;
      T.aF = 0.35 + Math.sin(w)*0.2; T.aB = 0.3 - Math.sin(w)*0.2; T.aFx = -0.35; T.aBx = 0.35; T.sq = -0.04; T.eF = T.eB = -0.35; T.tz = -0.5;
      r.showStars = true;
      break;
    }
    case 'cheer': {
      const w = k*0.4, moving = Math.abs(e.vx||0) > 0.02;
      if(moving){ r.phase += 0.55; const s = Math.sin(r.phase); T.lF = s*0.8; T.lB = -s*0.8; T.lean = -0.12; }
      else { T.bob = Math.abs(Math.sin(k*0.2))*0.14; T.sq = Math.cos(k*0.4)*0.05; }
      T.aF = -2.7 + Math.sin(w)*0.35; T.aB = -2.5 - Math.sin(w)*0.35; T.aFx = -0.35; T.aBx = 0.35;
      T.ty = Math.sin(k*0.9)*0.9; T.tz = 0.35; T.eF = T.eB = Math.abs(Math.sin(k*0.2))*0.35; T.hz = 0.15;
      r.K = 0.5;
      break;
    }
    case 'fall': {
      T.aF = -2.6 + Math.sin(k*0.7)*0.4; T.aB = -2.4 - Math.sin(k*0.7)*0.4; T.aFx = -0.3; T.aBx = 0.3; T.lF = 0.3 + Math.sin(k*0.6)*0.3; T.lB = -0.3 - Math.sin(k*0.6)*0.3;
      T.sq = 0.12; T.eF = T.eB = 1.0; T.tz = 0.6;
      break;
    }
    case 'jump': {
      if((e.vy||0) > 0){ T.sq = 0.12; T.aF = -2.2; T.aB = -2.0; T.lF = 0.2; T.lB = -0.3; }
      else { T.sq = -0.04; T.aF = -1.2; T.aB = -1.0; T.lF = 0.55; T.lB = 0.3; }
      T.eF = T.eB = 0.5;
      break;
    }
    default: { // idle
      const b = Math.sin(k*0.09);
      T.sq = b*0.025; T.bob = Math.abs(Math.sin(k*0.09))*0.012;
      T.aF = 0.3 + b*0.06; T.aB = 0.18 - b*0.05; T.aFx = -0.18; T.aBx = 0.18;
      T.hz = Math.sin(k*0.045)*0.04; T.ty = Math.sin(k*0.07)*0.3; T.tz = 0.15;
      T.eF = T.eB = Math.max(0, Math.sin(k*0.031 + 1.3) - 0.92)*3;
    }
  }
}

// ---------------------------------------------------------------- quadruped (boar)
function poseQuad(r, e, A, t, p, hit, k){
  const T = r.T;
  const spd = Math.hypot(e.vx||0, e.vz||0);
  T.tz = 0.2;
  switch(A){
    case 'walk': case 'run': {
      r.phase += Math.max(0.24, spd*12);
      const s = Math.sin(r.phase);
      T.q1 = s*0.55; T.q4 = s*0.55; T.q2 = -s*0.55; T.q3 = -s*0.55;
      T.bob = Math.abs(Math.cos(r.phase))*0.03; T.hz = Math.sin(r.phase*2)*0.04; T.ty = Math.sin(r.phase*2)*0.5;
      r.K = 0.5; break;
    }
    case 'windup': {
      const q = U.easeOutCubic(Math.min(1, p*1.5));
      T.lean = 0.12*q; T.hz = -0.28*q; T.q1 = -0.35 + Math.sin(k*0.55)*0.6*q; T.q3 = 0.25*q; T.q4 = 0.25*q; T.sq = -0.06*q;
      T.eF = T.eB = -0.5*q; r.shake = Math.sin(k*2.6)*(0.01 + 0.03*p); T.ty = Math.sin(k*1.2)*0.6;
      r.K = 0.45; break;
    }
    case 'attack2': { // the charge: gallop
      r.phase += 0.75;
      const s = Math.sin(r.phase);
      T.q1 = T.q2 = s*0.95; T.q3 = T.q4 = -s*0.95; T.bob = Math.abs(s)*0.08; T.sq = -Math.abs(Math.cos(r.phase))*0.06;
      T.hz = -0.32; T.lean = -0.08; T.eF = T.eB = -0.6; T.tz = 0.7;
      r.K = 0.6; break;
    }
    case 'attack': case 'special': case 'shoot': {
      if(p < hit){ const q = p/hit; T.hz = U.lerp(-0.3, 0.45, q*q); T.px = 0.15*q; T.q1 = T.q2 = -0.3*q; T.sq = 0.08*q; }
      else { const q = (p-hit)/(1-hit), hold = 1 - U.smooth(q, 0.3, 1); T.hz = 0.45*hold; T.px = 0.15*hold; T.q1 = T.q2 = -0.3*hold; }
      r.K = 0.65; break;
    }
    case 'hurt': {
      const dec = Math.exp(-t/9);
      T.lean = 0.25*dec; T.hz = 0.3*dec; T.sq = Math.sin(t*1.1)*0.12*dec; r.shake = Math.sin(t*3.1)*0.03*dec; T.eF = T.eB = 0.8*dec;
      T.q1 = 0.4*dec; T.q2 = -0.3*dec; r.K = 0.6; break;
    }
    case 'down': case 'ko': {
      if(!e.onGround){ T.lie = Math.min(1, t/8); T.q1 = Math.sin(k*0.9)*0.6; T.q2 = -T.q1; T.q3 = T.q1; T.q4 = -T.q1; }
      else { T.lie = 1; const w = A==='ko' ? Math.sin(k*0.5)*0.15 : 0; T.q1 = 0.5 + w; T.q2 = 0.3 - w; T.q3 = -0.4 + w; T.q4 = -0.6 - w; if(A==='ko') r.showStars = true; }
      T.eF = T.eB = 0.6; T.tz = -0.3; r.K = 0.45; break;
    }
    case 'getup': { const q = U.clamp(t/Math.max(1, e.animLen||24), 0, 1); T.lie = 1 - U.easeOutBack(q); r.K = 0.55; break; }
    case 'dizzy': { const w = k*0.12; T.lean = Math.sin(w)*0.08; T.spin = Math.cos(w)*0.06; T.hz = Math.sin(w+1)*0.15; T.hy = Math.cos(w)*0.2; T.eF = T.eB = -0.4; r.showStars = true; break; }
    case 'cheer': { r.phase += 0.5; const s = Math.sin(r.phase); T.q1 = s*0.7; T.q4 = s*0.7; T.q2 = -s*0.7; T.q3 = -s*0.7; T.bob = Math.abs(Math.sin(k*0.2))*0.1; T.ty = Math.sin(k*0.9)*0.9; T.hz = 0.2; r.K = 0.5; break; }
    case 'fall': { T.q1 = Math.sin(k*0.7)*0.6; T.q2 = -T.q1; T.q3 = T.q1*0.8; T.q4 = -T.q1*0.8; T.sq = 0.1; T.eF = T.eB = 1.0; break; }
    case 'jump': { T.q1 = T.q2 = -0.5; T.q3 = T.q4 = 0.5; T.sq = (e.vy||0) > 0 ? 0.1 : -0.03; break; }
    default: { const b = Math.sin(k*0.08); T.sq = b*0.02; T.hz = Math.sin(k*0.05)*0.05; T.ty = Math.sin(k*0.07)*0.4;
      // snort every few seconds
      const sn = (k % 220); if(sn < 16){ T.hz += Math.sin(sn*0.8)*0.08; } }
  }
}

// ---------------------------------------------------------------- balloon
function poseBalloon(r, e, A, t, p, hit, k){
  const T = r.T;
  const w = k*0.06;
  T.bob = Math.sin(w)*0.04; T.hz = Math.sin(w*0.7)*0.06 - U.clamp((e.vx||0)*3, -0.2, 0.2)*(e.face||1);
  T.tz = Math.sin(w*1.3)*0.25 + U.clamp((e.vx||0)*4, -0.3, 0.3)*(e.face||1);
  switch(A){
    case 'windup': T.puff = 0.18*U.easeOutCubic(p); r.shake = Math.sin(k*2.5)*(0.01 + 0.03*p); break;
    case 'attack': case 'attack2': case 'special': T.sq = p < hit ? -0.15 : 0.12*(1-p); T.hz = -0.3*(1-p); r.K = 0.6; break;
    case 'hurt': case 'down': case 'ko': T.sq = Math.sin(t*1.3)*0.15*Math.exp(-t/8); r.shake = Math.sin(t*3)*0.03; break;
    case 'cheer': T.bob += Math.abs(Math.sin(k*0.2))*0.1; break;
  }
}

// ================================================================ per-type extras (meshes that are not part of the skinned body)
const EXTRA = {};
// their geometries are built once and shared by every instance (rig.dispose never touches them)
const XGEO = {};
function xgeo(key, fn){ return XGEO[key] || (XGEO[key] = plain(fn)); }
EXTRA.shield = {
  pose(r, e, A, t, p, hit, k){
    const T = r.T;
    const guard = A==='idle' || A==='walk' || A==='run' || A==='windup' || A==='attack' || A==='attack2';
    if(!guard) return;
    const G0 = 1.25;
    if(A==='windup'){ T.aF = G0 - 0.45*U.easeOutCubic(Math.min(1, p*1.6)); T.lean = 0.2*Math.min(1, p*1.6); T.aFx = 0; }
    else if(A==='attack' || A==='attack2'){ const q = p < hit ? Math.pow(p/hit, 1.5) : 1 - U.smooth((p-hit)/(1-hit), 0.3, 1);
      T.aF = G0 - 0.45 + 0.75*q; T.px = 0.25*q; T.lean = 0.2 - 0.45*q; T.aFx = 0; }
    else { T.aF = G0 + Math.sin(k*0.09)*0.03; T.aFx = 0; }
    if(e.blockT > 0){ const b = e.blockT/12; T.aF += Math.sin(e.blockT*1.9)*0.18*b; T.px -= 0.08*b; T.sq -= 0.06*b; T.lean += 0.1*b; }
  },
};
EXTRA.flyer = {
  pose(r, e, A, t, p, hit, k){
    const T = r.T;
    const air = !e.onGround || (e.y||0) > 0.05 || !(e.grounded > 0);   // flaps unless grounded after a hit
    if(A==='down' || A==='ko' || A==='hurt' || A==='getup'){ T.aFx = -0.2 + Math.sin(k*0.9)*0.4; T.aBx = -T.aFx; return; }
    if(A==='attack' || A==='attack2'){ // swoop: wings swept back
      T.aFx = -0.1; T.aBx = 0.1; T.aF = -0.9; T.aB = -0.9; T.lean = -0.35; T.hz = -0.15; T.lF = -0.6; T.lB = -0.7; T.sq = 0.08; r.K = 0.5; return; }
    if(air){
      const f = A==='windup' ? 0.75 : 0.42, amp = A==='windup' ? 0.75 : 0.6;
      const w = Math.sin(k*f);
      T.aFx = -(0.35 + w*amp); T.aBx = (0.35 + w*amp); T.aF = -0.35; T.aB = -0.35;
      T.lF = 0.25 + Math.sin(k*0.1)*0.08; T.lB = 0.1 + Math.sin(k*0.1+1)*0.08; T.lFy = 0; T.lBy = 0;
      T.bob = -w*0.035; T.lean = A==='windup' ? 0.25 : -0.08;
      if(A==='windup'){ r.shake = Math.sin(k*2.2)*0.02*p; T.hz = 0.15; }
    } else if(e.grounded > 0){ T.aFx = -0.05; T.aBx = 0.05; T.aF = 0.4; T.aB = 0.4; T.eF = T.eB = -0.3; }
  },
};
EXTRA.bomber = {
  build(r, bp){
    const sp = r.spark = new THREE.Mesh(xgeo('spark', (pp)=>{ const R = prim(); pp.add(R.star, '#fff6a0', [0,0,0], null, 1.2); pp.add(R.sm, '#ffb000', [0,0,0], null, 0.05); }),
      G.look.mat('#fff3a0', { emissive:'#ffb000', emissiveIntensity:1.6, rough:0.4 }));
    sp.castShadow = false;
    const hc = [0.03, 0.31, 0];
    sp.position.set(hc[0]-0.12, hc[1]+0.58, 0);
    r.B.head.add(sp);
  },
  pose(r, e, A, t, p, hit, k){
    if(A==='windup'){ const T = r.T; T.puff = 0.2*p; T.aF = -2.4 + Math.sin(k*0.9)*0.3; T.aB = -2.2 - Math.sin(k*0.9)*0.3; T.aFx = -0.5; T.aBx = 0.5; T.lean = 0; T.eF = T.eB = 0.8; r.shake = Math.sin(k*2.8)*(0.015 + 0.04*p); return 'squeeze'; }
  },
  post(r, e, A, t, p, hit, k){
    const sp = r.spark;
    if(e.dead || e.happy){ sp.visible = false; return; }
    const fast = A==='windup' ? p : 0;
    sp.visible = fast === 0 ? true : (((k*(0.25 + fast*0.9))|0) % 2 === 0);
    const s = 0.8 + Math.random()*0.5 + fast*0.8;
    sp.scale.set(s, s, s); sp.rotation.z = k*0.3;
    const every = fast > 0 ? Math.max(2, Math.round(9 - fast*7)) : 24;
    if(e.def && k % every === 0){ sp.getWorldPosition(_w); fxb('sparkle', _w.x, _w.y, _w.z, FX_SPARK); }
  },
};
EXTRA.thrower = {
  post(r, e, A, t, p, hit){ const on = !(A==='shoot' && p >= hit && p < 0.9) && !e.happy; const k = on ? 1 : 0.0001; r.B.held.scale.set(k, k, k); },
};
EXTRA.kire = {
  build(r){
    const R = prim();
    const g = xgeo('anger', (pp)=>{ const c = '#ff2a3a', k = R.capL(0.03, 0.09);
      for(let i=0;i<4;i++){ const a = i*HP + PI/4; pp.add(k, c, [Math.cos(a)*0.06, Math.sin(a)*0.06, 0], [0, 0, a + 0.9]); } });
    const m = r.anger = new THREE.Mesh(g, G.look.mat('#ff4a5a', { emissive:'#ff2030', emissiveIntensity:0.5, rough:0.4 }));
    m.castShadow = false; m.visible = false;
    const q = surf({ c:[0,0,0], r:[0.46, 0.44, 0.43] }, 0.95, 0.75, 0.1);
    m.position.set(q[0], q[1], q[2]);
    m.rotation.set(0, -0.9, 0);
    r.B.head.add(m);
  },
  pose(r, e, A){ if(e.rage > 0 && (A==='walk' || A==='idle' || A==='run')){ r.T.sq += Math.sin(r.clock*0.7)*0.03; } },
  post(r, e){
    const on = e.rage > 0 && !e.dead;
    r.anger.visible = on;
    if(on){ const s = 1 + Math.abs(Math.sin(r.clock*0.3))*0.35; r.anger.scale.set(s, s, s); }
    const tint = r.mat.userData.uTint.value;
    if(on) tint.setRGB(1.12, 0.86, 0.86); else if(tint.r!==1) tint.setRGB(1, 1, 1);
  },
};
EXTRA.oni = {
  build(r){
    const aura = r.aura = new THREE.Mesh(G.look.geo.plane(4.8, 4.8), decalMat('aura', 0.75));
    aura.rotation.x = -HP; aura.position.y = 0.03; aura.renderOrder = -1;
    r.root.add(aura); r.own.push(aura.material);
    const warn = r.warn = new THREE.Mesh(G.look.geo.plane(2.8, 2.8), decalMat('warn', 0.8));
    warn.rotation.x = -HP; warn.position.y = 0.04; warn.visible = false; warn.renderOrder = -1;
    r.root.add(warn); r.own.push(warn.material);
  },
  pose(r, e, A, t, p, hit, k){
    const T = r.T;
    if(A==='windup'){ const q = U.easeOutCubic(Math.min(1, p*1.4)); T.aF = -2.9*q; T.aB = -2.7*q; T.aFx = -0.2*q; T.aBx = 0.2*q; T.lean = 0.35*q; T.sq = -0.08*q; }
    else if(A==='attack'){ if(p < hit){ const q = Math.pow(p/hit, 2); T.aF = U.lerp(-2.9, 1.5, q); T.aB = U.lerp(-2.7, 1.3, q); T.lean = U.lerp(0.35, -0.4, q); }
      else { const q = (p-hit)/(1-hit), hold = 1 - U.smooth(q, 0.4, 1); T.aF = 0.25 + 1.25*hold; T.aB = 0.1 + 1.2*hold; T.lean = -0.4*hold; T.sq = -0.12*hold*(q<0.2?1:0.5); } r.K = 0.7; }
  },
  hide(r, on){ r.aura.visible = !on; },
  post(r, e, A, t, p, hit, k){
    const a = r.alpha;
    r.aura.visible = !e.dead && !e.happy;
    r.aura.rotation.z = k*0.01;
    const pulse = 1 + Math.sin(k*0.08)*0.04;
    r.aura.scale.set(pulse, pulse, 1);
    r.aura.material.opacity = r.aura.material.userData.baseOpacity*a*(0.8 + Math.sin(k*0.08)*0.2);
    const w = A==='windup' && !e.dead;
    r.warn.visible = w;
    if(w){ const q = U.easeOutBack(Math.min(1, p*2.2)); r.warn.scale.set(0.55 + 0.45*q, 0.55 + 0.45*q, 1); r.warn.position.x = (e.face||1)*1.35;
      r.warn.material.opacity = (0.5 + 0.45*Math.abs(Math.sin(k*(0.2 + p*0.4))))*a; }
  },
};
EXTRA.ari = {
  build(r){
    const R = prim();
    const g = xgeo('mound', (pp)=>{ pp.add(R.s, '#9a7a58', [0, 0.02, 0], null, [0.46, 0.2, 0.36]); pp.add(R.sm, '#b8966c', [0.05, 0.1, 0.05], null, [0.3, 0.13, 0.24]);
      for(let i=0;i<6;i++){ const a = i/6*TAU; pp.add(R.sl, i%2 ? '#7a5a3a' : '#c8a878', [Math.cos(a)*0.34, 0.07, Math.sin(a)*0.26], null, 0.07); } });
    const m = r.mound = new THREE.Mesh(g, G.look.mat('#ffffff', { vertexColors:true, rough:0.95 }));
    m.castShadow = false; m.visible = false;
    G.look.outline(m, 0.018);
    r.root.add(m);
  },
  pose(r, e, A){
    if(e.burrowed){ r.T.bob = -0.42; r.T.sq -= 0.1; }
  },
  post(r, e, A, t, p, hit, k){
    const on = !!e.burrowed && !e.dead;
    r.mound.visible = on;
    if(on){
      const shake = A==='windup' ? 0.04 + 0.08*p : 0.015;
      r.mound.position.set(Math.sin(k*2.3)*shake, 0, Math.cos(k*1.7)*shake*0.6);
      const s = A==='windup' ? 1 + 0.25*p : 1 + Math.sin(k*0.4)*0.05;
      r.mound.scale.set(s, s*(A==='windup' ? 1 + Math.abs(Math.sin(k*0.9))*0.3 : 1), s);
      if(e.def && A==='windup' && k % 6 === 0) fxb('dust', e.x, 0.1, e.z, FX_DUST_M);
    }
  },
};
EXTRA.mecha = {
  pose(r, e, A, t, p, hit, k){
    const T = r.T;
    // stiffer robot steps
    if(A==='walk' || A==='run'){ T.bob *= 0.5; T.hz *= 0.5; T.ty = 0; }
    if(A==='windup'){ T.aF = 0.6; T.aB = 0.3; T.lean = 0.12; T.hz = -0.05; }   // charging the eye: brace, not an arm swing
    if(A==='shoot'){ const kick = p < hit ? 0 : Math.exp(-(p-hit)*8); T.lean = 0.25*kick; T.px = -0.12*kick; T.aF = 0.5; T.aB = 0.3; T.hz = 0.1*kick; }
  },
  post(r, e, A, t, p, hit, k){
    let g = 1.1 + Math.sin(k*0.1)*0.15;
    if(A==='windup'){ g = 1.2 + 3.8*p + (Math.random() < 0.3 ? 0.8 : 0); }
    else if(A==='shoot'){ g = p < hit ? 5 : 1.2 + 3.5*Math.exp(-(p-hit)*6); }
    else if(A==='hurt' || A==='down' || A==='ko') g = 0.7 + (Math.random()<0.5 ? 0.6 : 0);
    else if(A==='cheer') g = 1.6;
    r.faceMat.emissiveIntensity = g;
    if(A==='windup'){ const s = 1 + 0.25*p + Math.sin(k*1.3)*0.05*p; r.face.scale.set(1, s, s); } else if(r.face.scale.y!==1) r.face.scale.set(1,1,1);
  },
};
EXTRA.balloon = {};

// ================================================================ gameplay helpers
function D(){ return (G.game && G.game.diff) || { think:1, attackers:2, foeSpeed:1 }; }
function rnd(){ return G.rng(); }
function pre(e){
  if(e.oniBuff > 0){ e.oniBuff--; if(e.oniBuff % 40 === 39) fxb('magic', e.x, e.y + e.height*0.6, e.z + 0.2, FX_BUFF); }
  e.spdMul = (e.rageMul||1) * (e.oniBuff > 0 ? 1.25 : 1);
  if(e.modeT > 0) e.modeT--;
  // stuck against a wall/edge while trying to walk somewhere → try the other side of the hero for a while
  if(e.sideLock > 0) e.sideLock--;
  if(e.state==='move' && Math.abs(e.x - (e.lastX==null ? e.x : e.lastX)) < 0.004 && Math.abs(e.vx) > 0.01){ if(++e.stuckT > 24){ e.stuckT = 0; e.sideVal = -sideOf(e); e.sideLock = 100; } }
  else e.stuckT = 0;
  e.lastX = e.x;
  const t = H.target(e);
  if(!t){ H.stop(e); return null; }
  return t;
}
const FX_BUFF = { count:4, scale:0.35, color:'#c58aff' };
// spot beside the target on this foe's side (no allocation)
let FX_ = 0, FZ_ = 0;
function sideOf(e){ const t = H.target(e); return t && e.x < t.x ? -1 : 1; }
function side(e, t){ return e.sideLock > 0 ? e.sideVal : (e.x < t.x ? -1 : 1); }
function flank(e, t, dist, dzOff){
  FX_ = t.x + side(e, t)*dist;
  FZ_ = U.clamp(t.z + (dzOff!=null ? dzOff : ((e.id%3)-1)*0.28), ZMIN, ZMAX);
}
function A(o){ return Object.assign({ len:26, recover:44 }, o); }
function HIT(o){ return Object.assign({ at:8, dur:4, x0:0.1, x1:1.15, zr:0.5, y0:0, y1:1.3, dmg:8, kb:0.09, stun:18, kind:'blunt', power:1 }, o); }
// telegraphed attack + cooldown. 30_foes reads `recover` from the TYPE def, so the per-attack recover is applied here:
// cool counts down during the windup and the attack too, so what is left afterwards is the recover gap.
function attack(e, d, windup){
  if(!H.attack(e, d, windup)) return false;
  const w = Math.max(0, Math.round(windup*(D().think||1)));
  e.cool = Math.max(e.cool||0, w + d.len + (d.recover==null ? 40 : d.recover));
  return true;
}
// generic melee brain: approach → (token) telegraphed attack → hang back while cooling down
function brawl(e, t, o){
  const dx = t.x - e.x, adx = Math.abs(dx), adz = Math.abs(t.z - e.z);
  const inRange = adx < o.reach && adz < (o.zr||0.4) && adx > (o.min||0);
  if(e.backOff > 0){
    e.backOff--;
    flank(e, t, o.wait||2.4); if(H.walkTo(e, FX_, FZ_, e.def.spd*0.8)) H.face(e, t); else if(adx < 3) H.face(e, t);
    return;
  }
  if(inRange && e.cool <= 0){
    H.face(e, t);
    if(H.token(e)){ const pk = o.pick(e, t); attack(e, pk[0], pk[1]); return; }
    e.backOff = 30 + Math.floor(rnd()*40);
    return;
  }
  if(e.cool > 0){
    flank(e, t, o.hold||1.9);
    if(Math.abs(e.x - FX_) < 0.35 && Math.abs(e.z - FZ_) < 0.3){ H.stop(e); H.face(e, t); }
    else { H.walkTo(e, FX_, FZ_, e.def.spd*0.7); if(adx < 3) H.face(e, t); }
    return;
  }
  flank(e, t, o.stand||1.0);
  if(H.walkTo(e, FX_, FZ_)) H.face(e, t);
}
function nearestBounds(){ return G.cam.viewRange(); }

// ================================================================ attack definitions
// wanhei — paw swipe / bite
const WH_SWIPE = A({ id:'wh_swipe', anim:'attack', len:28, recover:60, move:[{ at:7, vx:0.09 }], hits:[HIT({ at:9, dmg:8 })] });
const WH_BITE  = A({ id:'wh_bite', anim:'attack2', len:30, recover:66, move:[{ at:8, vx:0.15 }], hits:[HIT({ at:10, x0:0.2, x1:1.25, dmg:9, kb:0.11 })] });
// hyena — quick swipe, then runs off
const HY_SWIPE = A({ id:'hy_swipe', anim:'attack', len:22, recover:8, move:[{ at:5, vx:0.14 }], hits:[HIT({ at:7, dur:3, x1:1.1, dmg:6, stun:14 })],
  onEnd(e){ e.mode = 'run'; e.modeT = 50 + Math.floor(rnd()*25); } });
// boar — long charge along x; tusk toss up close
const BO_TOSS = A({ id:'bo_toss', anim:'attack', len:30, recover:60, move:[{ at:7, vx:0.1 }], hits:[HIT({ at:10, x0:0.3, x1:1.3, dmg:9, up:0.16, kb:0.1 })] });
const BO_CHARGE = A({ id:'bo_charge', anim:'attack2', len:110, recover:34,
  hits:[HIT({ at:2, dur:100, x0:0, x1:1.05, zr:0.5, y1:1.1, dmg:12, kb:0.2, up:0.16, stun:22, power:2 })], fn: boarCharge });
const FX_TRAIL = { count:2, scale:0.55, dir:0 };
function boarCharge(e, t){
  if(t===0){ const tg = H.target(e); e.chg = { px:e.x, stuck:0, tx: tg ? tg.x : e.x + e.face*4 }; H.say(e, 'ドドドッ！'); }
  const c = e.chg; if(!c) return;
  e.vx = e.face*0.2*D().foeSpeed; e.vz = 0;
  if(t % 4 === 0){ FX_TRAIL.dir = -e.face; fxb('dust', e.x - e.face*0.45, 0.05, e.z, FX_TRAIL); }
  const moved = Math.abs(e.x - c.px); c.px = e.x;
  if(t > 3 && moved < 0.05) c.stuck++; else c.stuck = 0;
  const vr = nearestBounds();
  const edge = e.face > 0 ? e.x > vr[1] - 0.7 : e.x < vr[0] + 0.7;
  const passed = (e.x - c.tx)*e.face > 2.6;
  const hitSomething = e.atk && e.atk.sets && e.atk.sets[0] && e.atk.sets[0].size > 0;
  if(c.stuck >= 2 || edge || passed || t >= 100){
    G.combat.cancel(e);
    e.chg = null;
    e.vx = e.face*0.05;
    if(c.stuck >= 2){ // hit a wall
      H.say(e, 'ゴチン！'); fxb('stars', e.x + e.face*0.5, 0.8, e.z + 0.2, FX_STARS); if(G.cam) G.cam.shake(2.5, 10);
      G.setState(e, 'dizzy'); e.stun = 80; G.setAnim(e, 'dizzy');
    } else if(!hitSomething){
      H.say(e, 'あれっ？'); G.setState(e, 'dizzy'); e.stun = 50; G.setAnim(e, 'dizzy');
    } else { G.setState(e, 'idle'); G.setAnim(e, 'idle'); }
    e.cool = 60;
  }
}
const FX_STARS = { count:5, scale:0.8 };
// shield — shield bash
const SH_BASH = A({ id:'sh_bash', anim:'attack', len:30, recover:62, move:[{ at:8, vx:0.12 }], hits:[HIT({ at:10, x0:0.2, x1:1.25, dmg:9, kb:0.2, stun:20 })] });
// pounce — leap arc / scratch
const PO_LEAP = A({ id:'po_leap', anim:'attack', len:48, recover:56, hits:[HIT({ at:8, dur:28, x0:-0.25, x1:0.75, y0:-0.2, y1:1.1, dmg:10, kb:0.12, up:0.12, stun:20 })], fn: pounceLeap });
const PO_SCRATCH = A({ id:'po_scr', anim:'attack2', len:26, recover:52, move:[{ at:6, vx:0.1 }], hits:[HIT({ at:8, dur:3, dmg:7, stun:14 })] });
function pounceLeap(e, t){
  if(t===0){
    const tg = H.target(e);
    const tx = tg ? tg.x : e.x + e.face*3, tz = tg ? tg.z : e.z;
    const dx = U.clamp(tx - e.x, -4.6, 4.6), dz = U.clamp(tz - e.z, -1.2, 1.2);
    if(Math.abs(dx) > 0.1) e.face = dx > 0 ? 1 : -1;
    e.vy = 0.2; e.onGround = false; e.vx = dx/26; e.vz = dz/26; e.leapLanded = false;
    G.bus.emit('jump', { ent:e });
  }
  if(t > 6 && e.onGround && !e.leapLanded){ e.leapLanded = true; e.vx *= 0.3; e.vz = 0; fxb('dust', e.x, 0.05, e.z, FX_DUST_M); }
}
// bomber — fuse, then pops into confetti (hurts heroes AND foes)
const BM_BOOM = A({ id:'bm_boom', anim:'attack', len:6, recover:0, fn(e, t){ if(t===0) bomberPop(e); } });
const FX_CONF = { count:40, scale:1.1 }, FX_RING = { flat:true, scale:1.1, color:'#ffd23a' }, FX_FW = { count:1, scale:0.6 };
function bomberPop(e){
  const x = e.x, z = e.z;
  const o = { owner:e, x, y:0, z, r:1.6, zr:0.9, y0:-0.5, y1:2.2, kind:'pop', power:2, kb:0.16, up:0.2, stun:24, dur:3 };
  G.combat.area(Object.assign({}, o, { team:1, dmg:12 }));
  G.combat.area(Object.assign({}, o, { team:0, dmg:10 }));
  fxb('confetti', x, 0.8, z + 0.2, FX_CONF); fxb('ring', x, 0.1, z, FX_RING); fxb('fireworks', x, 1.2, z, FX_FW);
  H.say(e, 'ポンッ！');
  if(G.cam) G.cam.shake(3, 12);
  if(G.audio && G.audio.sfx) G.audio.sfx('pop');
  G.combat.cancel(e);
  e.dead = true; e.hp = 0; e.ignoreForClear = true; e.removeMe = true;
  H.release(e);
}
// thrower — lobbed bones
const TH_THROW = A({ id:'th_throw', anim:'shoot', len:32, recover:80, fn(e, t){ if(t===11) throwBone(e); } });
const TH_BONK = A({ id:'th_bonk', anim:'attack', len:28, recover:60, move:[{ at:7, vx:0.08 }], hits:[HIT({ at:9, dmg:7 })] });
const FX_MARK = { flat:true, scale:0.4, color:'#ffe08a', life:40 };
function throwBone(e){
  const tg = H.target(e); if(!tg) return;
  const x0 = e.x + e.face*0.35, y0 = e.y + 1.05, z0 = e.z;
  const vy = 0.16, g = -0.0085, yt = tg.y + 0.55;
  let y = y0, v = vy, n = 0;
  while(n < 140){ v += g; y += v; n++; if(v < 0 && y <= yt) break; }
  const vx = U.clamp((tg.x - x0)/n, -0.2, 0.2), vz = U.clamp((tg.z - z0)/n, -0.06, 0.06);
  H.shoot(e, { kind:'bone', x:x0, y:y0, z:z0, vx, vy, vz, grav:g, dmg:7, r:0.38, life:n + 30, power:1, stun:18, kb:0.07 });
  FX_MARK.life = n; fxb('ring', x0 + vx*n, 0.05, z0 + vz*n, FX_MARK);
}
// flyer — diving swoop
const FL_SWOOP = A({ id:'fl_swoop', anim:'attack', len:62, recover:60, hits:[HIT({ at:4, dur:28, x0:-0.3, x1:0.75, y0:-0.4, y1:1.0, dmg:9, kb:0.1, stun:18 })], fn: swoop });
function swoop(e, t){
  if(t===0){ const tg = H.target(e); e.sw = { x0:e.x, y0:e.y, z0:e.z, tx: tg ? tg.x : e.x + e.face*2.5, tz: tg ? tg.z : e.z };
    const dx = e.sw.tx - e.x; if(Math.abs(dx) > 0.1) e.face = dx > 0 ? 1 : -1; H.say(e, 'ヒュー！'); }
  const s = e.sw; if(!s) return;
  if(t < 22){ e.vx = (s.tx + e.face*0.25 - s.x0)/22; e.vy = (0.35 - s.y0)/22; e.vz = (s.tz - s.z0)/22; }
  else if(t < 34){ e.vx = e.face*0.09; e.vy = 0; e.vz = 0; }
  else { e.vx = e.face*0.05; e.vy = 0.045; e.vz = 0; }
}
// kire — slap / rage double slap
const KI_SLAP = A({ id:'ki_slap', anim:'attack', len:28, recover:58, move:[{ at:7, vx:0.1 }], hits:[HIT({ at:9, dmg:8 })] });
const KI_DOUBLE = A({ id:'ki_double', anim:'attack2', len:32, recover:22, move:[{ at:6, vx:0.12 }, { at:14, vx:0.1 }], hits:[HIT({ at:8, dur:3, dmg:6, stun:14 }), HIT({ at:16, dur:3, dmg:6, kb:0.12 })] });
// pierrot — summon balloons / honk bop
const PI_SUMMON = A({ id:'pi_summon', anim:'shoot', len:40, recover:100, fn(e, t){ if(t===14) summonBalloons(e); } });
const PI_HONK = A({ id:'pi_honk', anim:'attack', len:28, recover:60, move:[{ at:7, vx:0.1 }], hits:[HIT({ at:9, dmg:7, kb:0.14 })], onEnd(e){ e.mode = 'hop'; e.modeT = 40; } });
const FX_POOF = { scale:0.6 };
function summonBalloons(e){
  const n = Math.min(2, 4 - (e.summoned||0));
  for(let i=0;i<n;i++){
    const x = e.x + (i===0 ? e.face*0.9 : -e.face*0.5), z = U.clamp(e.z + (i ? 0.55 : -0.45), ZMIN, ZMAX);
    const b = H.spawnMinion('balloon', x, z, { entrance:'none', y:1.9, face:e.face });
    if(b){ e.summoned = (e.summoned||0) + 1; b.parentId = e.id; fxb('poof', x, 1.9, z + 0.2, FX_POOF); }
  }
  H.say(e, 'ポポン！');
}
function balloonsOf(e){ let n = 0; const L = G.world.ents; for(let i=0;i<L.length;i++){ const f = L[i]; if(f.type==='balloon' && f.parentId===e.id && !f.dead) n++; } return n; }
// balloon — dips down and bumps
const BA_BUMP = A({ id:'ba_bump', anim:'attack', len:32, recover:70, hits:[HIT({ at:5, dur:9, x0:-0.2, x1:0.65, y0:-1.3, y1:0.8, dmg:6, kb:0.06, stun:14, kind:'pop' })],
  fn(e, t){ if(t < 9){ e.vx = e.face*0.075; e.vy = -0.05; } else if(t < 17){ e.vx = e.face*0.02; e.vy = 0; } else { e.vy = 0.045; e.vx = 0; } } });
// oni — overhead club smash (shockwave in front)
const ON_SMASH = A({ id:'on_smash', anim:'attack', len:44, recover:80,
  areas:[{ at:15, ox:1.35, r:1.3, zr:0.85, y0:-0.3, y1:1.6, dmg:13, kind:'blunt', power:2, up:0.2, kb:0.12, stun:24, fx:'shock' }],
  fn(e, t){ if(t===15){ if(G.cam) G.cam.shake(3.5, 14); H.say(e, 'ドーン！'); } } });
// ari — shovel swipe / pop-up uppercut from underground
const AR_SWIPE = A({ id:'ar_swipe', anim:'attack', len:28, recover:58, move:[{ at:7, vx:0.08 }], hits:[HIT({ at:9, x1:1.3, dmg:8 })] });
const AR_UPPER = A({ id:'ar_upper', anim:'attack2', len:34, recover:54, fn(e, t){ if(t===0) surface(e, true); },
  hits:[HIT({ at:1, dur:8, x0:-0.55, x1:0.65, zr:0.55, y1:1.6, dmg:10, up:0.26, kb:0.05, stun:22, power:2 })] });
const FX_DIG = { count:10, scale:0.9 };
function dig(e){
  e.burrowed = true; e.intangible = true; e.underT = 0; e.shadowAlpha = 0;
  if(e.rig && e.rig.setAlpha) e.rig.setAlpha(0.15);
  H.say(e, 'もぐった！'); fxb('dust', e.x, 0.1, e.z, FX_DIG);
  H.stop(e);
}
function surface(e, attack){
  e.burrowed = false; e.intangible = false; e.shadowAlpha = null;
  if(e.rig && e.rig.setAlpha) e.rig.setAlpha(1);
  e.vy = attack ? 0.2 : 0.14; e.onGround = false;
  fxb('dust', e.x, 0.1, e.z, FX_DIG);
  H.say(e, attack ? 'ボコッ！' : 'ぷはっ');
  e.digCD = 300 + Math.floor(rnd()*120);
}
// mecha — slow red beam / claw punch
const ME_BEAM = A({ id:'me_beam', anim:'shoot', len:30, recover:84, fn(e, t){ if(t===7) fireBeam(e); } });
const ME_PUNCH = A({ id:'me_punch', anim:'attack', len:30, recover:60, move:[{ at:8, vx:0.08 }], hits:[HIT({ at:10, x1:1.2, dmg:9 })] });
const FX_MUZZLE = { scale:0.6, color:'#ff5a6a' };
function fireBeam(e){
  const tg = H.target(e);
  let x0 = e.x + e.face*0.55, y0 = e.y + 0.92, z0 = e.z;
  if(e.rig && e.rig.tip){ e.rig.tip.getWorldPosition(_w); x0 = _w.x; y0 = _w.y; z0 = _w.z; }
  const vx = e.face*0.11;
  let vz = 0; if(tg){ const n = Math.max(10, Math.abs(tg.x - x0)/0.11); vz = U.clamp((tg.z - z0)/n, -0.03, 0.03); }
  H.shoot(e, { kind:'beam', x:x0, y:y0, z:z0, vx, vz, vy:0, dmg:10, r:0.42, life:150, power:1, stun:20, kb:0.1 });
  fxb('ring', x0, y0, z0 + 0.1, FX_MUZZLE);
  H.say(e, 'ビビッ！');
}

// ================================================================ AI per type
// brawl() options are module constants: ai() runs every tick and must not allocate
const PK = { whS:[WH_SWIPE, 24], whB:[WH_BITE, 24], hy:[HY_SWIPE, 23], sh:[SH_BASH, 24], kiS:[KI_SLAP, 26], kiD:[KI_DOUBLE, 23], pi:[PI_HONK, 23], on:[ON_SMASH, 36], ar:[AR_SWIPE, 24] };
const BR = {
  wanhei:  { reach:1.3, zr:0.4, pick:()=> rnd() < 0.7 ? PK.whS : PK.whB },
  hyena:   { reach:1.25, zr:0.4, stand:0.95, hold:2.8, pick:()=> PK.hy },
  shield:  { reach:1.3, zr:0.4, stand:1.05, hold:1.6, pick:()=> PK.sh },
  kire:    { reach:1.3, zr:0.4, pick:(e)=> e.rage > 0 ? PK.kiD : PK.kiS },
  pierrot: { reach:1.3, zr:0.4, hold:2.2, pick:()=> PK.pi },
  oni:     { reach:2.3, min:0.3, zr:0.55, stand:1.5, hold:2.6, pick:()=> PK.on },
  ari:     { reach:1.4, zr:0.4, pick:()=> PK.ar },
};
const AI = {
  wanhei(e){ const t = pre(e); if(!t) return;
    brawl(e, t, BR.wanhei); },
  hyena(e){ const t = pre(e); if(!t) return;
    if(e.mode==='run' && e.modeT > 0){
      const away = e.x < t.x ? -1 : 1;
      H.walkTo(e, t.x + away*3.8, U.clamp(t.z + (e.id%2 ? 0.7 : -0.7), ZMIN, ZMAX), e.def.spd*1.1);
      if(e.modeT < 14) H.face(e, t);
      return;
    }
    e.mode = '';
    brawl(e, t, BR.hyena); },
  boar(e){ const t = pre(e); if(!t) return;
    const dx = t.x - e.x, adx = Math.abs(dx), adz = Math.abs(t.z - e.z);
    const side_ = side(e, t);
    if(e.cool > 0){ if(H.walkTo(e, t.x + side_*4.2, U.clamp(t.z, ZMIN, ZMAX), e.def.spd*0.7)) H.face(e, t); else if(adx < 5) H.face(e, t); return; }
    if(adx < 1.35 && adz < 0.4){ H.face(e, t); if(H.token(e)){ attack(e, BO_TOSS, 24); return; } H.wait(e, 30); return; }
    if(adx > 2.2 && adx < 7.5 && adz < 0.35){ H.face(e, t); if(H.token(e)){ attack(e, BO_CHARGE, 36); return; } H.wait(e, 30); return; }
    if(H.walkTo(e, t.x + side_*4.2, U.clamp(t.z, ZMIN, ZMAX))) H.face(e, t); },
  shield(e){ const t = pre(e); if(!t) return;
    if(e.blockT > 0) e.blockT--;
    if(e.blockReset > 0 && --e.blockReset === 0) e.blocks = 0;
    const dx = t.x - e.x;
    // turns around slowly: a chance to hit it from behind
    if(dx*e.face < -0.2){ e.turnT = (e.turnT||0) + 1; H.stop(e); if(e.turnT===16) H.say(e, 'あっ！'); if(e.turnT > 36){ e.face = -e.face; e.turnT = 0; } return; }
    e.turnT = 0;
    if(e.counter){ e.counter = false; if(Math.abs(dx) < 1.6 && H.token(e)){ e.cool = 0; attack(e, SH_BASH, 23); return; } }
    brawl(e, t, BR.shield); },
  pounce(e){ const t = pre(e); if(!t) return;
    const dx = t.x - e.x, adx = Math.abs(dx), adz = Math.abs(t.z - e.z);
    if(e.cool <= 0 && adx > 2.2 && adx < 4.6 && adz < 1.0){ H.face(e, t); if(H.token(e)){ attack(e, PO_LEAP, 26); return; } }
    if(e.cool <= 0 && adx < 1.3 && adz < 0.4){ H.face(e, t); if(H.token(e)){ attack(e, PO_SCRATCH, 23); return; } }
    flank(e, t, 3.2); if(H.walkTo(e, FX_, FZ_)) H.face(e, t); else if(adx < 4) H.face(e, t); },
  bomber(e){ const t = pre(e); if(!t) return;
    const dx = t.x - e.x, adx = Math.abs(dx), adz = Math.abs(t.z - e.z);
    if(adx < 1.15 && adz < 0.45 && e.cool <= 0){ H.face(e, t); if(H.token(e)){ H.say(e, 'ジジジ…'); attack(e, BM_BOOM, 52); return; } e.cool = 40; }
    if(e.cool > 0){ flank(e, t, 2.3); if(H.walkTo(e, FX_, FZ_, e.def.spd*0.6)) H.face(e, t); return; }
    flank(e, t, 0.8, 0); H.walkTo(e, FX_, FZ_); },
  thrower(e){ const t = pre(e); if(!t) return;
    const dx = t.x - e.x, adx = Math.abs(dx), adz = Math.abs(t.z - e.z);
    const side_ = side(e, t);
    if(adx < 1.3 && adz < 0.4 && e.cool <= 0){ H.face(e, t); if(H.token(e)){ attack(e, TH_BONK, 23); return; } }
    if(adx >= 3.0 && adx < 7.5 && e.cool <= 0){ H.face(e, t); if(H.token(e)){ attack(e, TH_THROW, 24); return; } }
    // keep 4–6 away (back off when the hero comes close)
    const want = 5.0;
    const tx = t.x + side_*want, tz = U.clamp(t.z + ((e.id%3)-1)*0.5, ZMIN, ZMAX);
    const vr = G.cam.viewRange();
    const cx = U.clamp(tx, vr[0] + 0.8, vr[1] - 0.8);
    if(Math.abs(e.x - cx) < 0.5 && Math.abs(e.z - tz) < 0.4){ H.stop(e); H.face(e, t); }
    else { H.walkTo(e, cx, tz); H.face(e, t); } },
  flyer(e){ const t = pre(e);
    if(e.grounded > 0){
      if(!e.onGround){ return; }
      e.grounded--;
      if(e.grounded === 0){ e.gravScale = 0; e.vy = 0.06; H.say(e, 'バサッ'); G.setAnim(e, 'idle'); return; }
      H.stop(e); if(t) H.face(e, t);
      return;
    }
    e.gravScale = 0;
    const want = e.hoverY || 2.2;
    e.vy = U.clamp((want - e.y)*0.08, -0.09, 0.05);
    if(!t) return;
    const dx = t.x - e.x, adx = Math.abs(dx), adz = Math.abs(t.z - e.z);
    if(e.cool <= 0 && adx > 1.4 && adx < 4.4 && adz < 1.1 && Math.abs(e.y - want) < 0.45){ H.face(e, t); if(H.token(e)){ e.vy = 0; attack(e, FL_SWOOP, 26); return; } }
    flank(e, t, 3.0);
    if(H.walkTo(e, FX_, FZ_)) H.face(e, t); else if(adx < 4.5) H.face(e, t); },
  kire(e){ const t = pre(e); if(!t) return;
    // rage cycle in absolute ticks (ai does not run during attacks / hurt, so a per-ai-tick counter would stretch)
    const now = G.time.tick;
    if(e.rageEnd == null){ e.rageEnd = 0; e.rageNext = now + 200 + Math.floor(rnd()*200); }
    e.rage = now < e.rageEnd ? e.rageEnd - now : 0;
    if(e.rage > 0){
      if(e.rage % 14 === 0) fxb('smoke', e.x, e.y + 1.15, e.z, FX_STEAM);
    } else if(e.rageMul > 1){ e.rageMul = 1; H.say(e, 'ふぅ…'); e.tired = 50; e.rageNext = now + 420 + Math.floor(rnd()*200); }
    else if(now >= e.rageNext && e.state!=='act'){ e.rageEnd = now + 240; e.rage = 240; e.rageMul = 1.6; H.say(e, 'ぷんぷん！'); fxb('smoke', e.x, e.y + 1.2, e.z, FX_STEAM_BIG); }
    if(e.tired > 0){ e.tired--; H.stop(e); H.face(e, t); return; }
    if(e.rage > 0 && e.cool > 22) e.cool = 22;
    brawl(e, t, BR.kire); },
  pierrot(e){ const t = pre(e); if(!t) return;
    const dx = t.x - e.x, adx = Math.abs(dx), adz = Math.abs(t.z - e.z);
    const side_ = side(e, t);
    const left = 4 - (e.summoned||0);
    if(e.mode==='hop' && e.modeT > 0){ H.walkTo(e, t.x + side_*3.5, e.z, e.def.spd*1.3); H.face(e, t); return; }
    if(e.cool <= 0 && left > 0 && adx > 2.4 && balloonsOf(e) < 2){ H.face(e, t); if(H.token(e)){ attack(e, PI_SUMMON, 26); return; } }
    if(e.cool <= 0 && adx < 1.3 && adz < 0.4){ H.face(e, t); if(H.token(e)){ attack(e, PI_HONK, 23); return; } }
    if(left > 0){
      const vr = G.cam.viewRange();
      const cx = U.clamp(t.x + side_*5, vr[0] + 0.9, vr[1] - 0.9), cz = U.clamp(t.z - ((e.id%2)*2-1)*0.6, ZMIN, ZMAX);
      if(Math.abs(e.x - cx) < 0.5 && Math.abs(e.z - cz) < 0.4){ H.stop(e); H.face(e, t); } else { H.walkTo(e, cx, cz); H.face(e, t); }
    } else brawl(e, t, BR.pierrot); },
  balloon(e){ const t = pre(e);
    const fy = (e.floatY || 1.4) + Math.sin((G.time.tick + e.id*37)*0.05)*0.12;
    e.gravScale = 0;
    e.vy = U.clamp((fy - e.y)*0.06, -0.03, 0.03);
    if(!t) return;
    const dx = t.x - e.x, adx = Math.abs(dx), adz = Math.abs(t.z - e.z);
    if(adx < 0.95 && adz < 0.4 && e.cool <= 0 && Math.abs(e.y - fy) < 0.4){ H.face(e, t); if(H.token(e)){ e.vy = 0; attack(e, BA_BUMP, 24); return; } }
    flank(e, t, 0.7 + (e.id%2)*0.25);
    if(e.cool > 0) flank(e, t, 1.8);
    if(H.walkTo(e, FX_, FZ_, e.cool > 0 ? 0.02 : e.def.spd)) H.face(e, t); },
  oni(e){ const t = pre(e);
    // purple aura: nearby soldiers get faster
    if(G.time.tick % 6 === 0){
      const L = G.world.ents;
      for(let i=0;i<L.length;i++){ const f = L[i];
        if(f===e || f.team!==1 || f.dead || !f.def || !f.def.zako || f.type==='oni') continue;
        if(Math.abs(f.x - e.x) < 2.3 && Math.abs(f.z - e.z) < 1.6) f.oniBuff = Math.max(f.oniBuff||0, 14);
      }
    }
    if(!t) return;
    brawl(e, t, BR.oni); },
  ari(e){ const t = pre(e); if(!t) return;
    if(e.burrowed){
      e.underT++;
      const dx = t.x - e.x, dz = t.z - e.z, d = Math.hypot(dx, dz);
      if(e.underT % 5 === 0) fxb('dust', e.x, 0.08, e.z, FX_DUST_S);
      if(d < 0.3 || (e.underT > 90 && d < 0.8)){
        if(H.token(e)){ H.face(e, t); e.vx = e.vz = 0; attack(e, AR_UPPER, 26); return; }
        if(e.underT > 200){ surface(e, false); return; }
      }
      if(e.underT > 260){ surface(e, false); return; }
      const sp = 0.07*(e.spdMul||1)*D().foeSpeed;
      if(d > 0.05){ e.vx = dx/d*sp; e.vz = dz/d*sp*0.9; }
      if(Math.abs(dx) > 0.1) e.face = dx > 0 ? 1 : -1;
      G.setState(e, 'move'); if(e.anim!=='walk') G.setAnim(e, 'walk');
      return;
    }
    if(e.digCD > 0) e.digCD--;
    if(e.digCD <= 0 && e.onGround && H.dist(e, t) > 4){ dig(e); return; }
    brawl(e, t, BR.ari); },
  mecha(e){ const t = pre(e); if(!t) return;
    const dx = t.x - e.x, adx = Math.abs(dx), adz = Math.abs(t.z - e.z);
    const side_ = side(e, t);
    if(e.cool <= 0 && adx < 1.3 && adz < 0.4){ H.face(e, t); if(H.token(e)){ attack(e, ME_PUNCH, 24); return; } }
    if(e.cool <= 0 && adx > 2.4 && adx < 7.5 && adz < 0.9){ H.face(e, t); if(H.token(e)){ attack(e, ME_BEAM, 32); return; } }
    const tx = t.x + side_*4.0, tz = U.clamp(t.z, ZMIN, ZMAX);
    if(Math.abs(e.x - tx) < 0.5 && Math.abs(e.z - tz) < 0.35){ H.stop(e); H.face(e, t); } else { H.walkTo(e, tx, tz); if(adx < 6) H.face(e, t); } },
};
const FX_STEAM = { count:2, scale:0.35, color:'#ffffff' }, FX_STEAM_BIG = { count:6, scale:0.5, color:'#ffe0e0' };

// ================================================================ type definitions
// NOTE on armor: 50_combat absorbs a hit while (armorHits < armor), i.e. armor N absorbs N-1 hits before a flinch.
// "armour 1 (flinches less)" therefore needs armor:2 here, "armor 2" needs 3.
const ARMOR_MECHA = 1, ARMOR_ONI = 2;   // combat absorbs exactly N light hits (framework fixed to match the contract)
function def(type, o){
  o.zako = true;
  o.build = (ent)=> makeRig(type, ent);
  o.ai = AI[type];
  return G.foes.define(type, o);
}
def('wanhei',  { name:'わんこへい', hp:36, spd:0.042, radius:0.42, height:1.3, weight:1, score:100, xp:10 });
def('hyena',   { name:'ハイエナけん', hp:24, spd:0.06, radius:0.4, height:1.38, weight:0.9, score:100, xp:8 });
def('boar',    { name:'イノシシへい', hp:50, spd:0.036, radius:0.5, height:1.02, weight:1.5, score:200, xp:16 });
def('shield',  { name:'たてわんこへい', hp:46, spd:0.032, radius:0.44, height:1.35, weight:1.2, score:200, xp:16,
  block(e, info){
    if(e.state!=='idle' && e.state!=='move') return false;
    if(e.pending || e.atk) return false;
    if((info.power||1) >= 2) return false;
    const src = info.src;
    if(src && (src.y||0) > (e.y||0) + 0.55) return false;         // from above (jumping / stomping)
    let dir = info.dir; if(!dir && src) dir = U.sign(e.x - src.x);
    if(!dir || dir !== -e.face) return false;                       // only hits pushing it backward = from the front
    e.blockT = 12; e.blocks = (e.blocks||0) + 1; e.blockReset = 90;
    if(e.blocks >= 3){ e.blocks = 0; e.counter = true; }
    return true;
  } });
def('pounce',  { name:'ジャンプけん', hp:34, spd:0.046, radius:0.4, height:1.32, weight:0.9, score:150, xp:12 });
def('bomber',  { name:'びっくりチワワ', hp:16, spd:0.066, radius:0.4, height:1.35, weight:0.8, score:120, xp:8 });
def('thrower', { name:'ほねなげけん', hp:30, spd:0.04, radius:0.42, height:1.3, weight:1, score:150, xp:12 });
def('flyer',   { name:'タカけん ハヤブサ', hp:26, spd:0.045, radius:0.42, height:1.3, weight:0.9, score:180, xp:14,
  init(e){
    e.gravScale = 0; e.hoverY = 2.2;
    if(e.entrance==='drop') e.entrance = 'glide';           // glide down from the sky instead of falling
    else if(e.entrance==='walk') e.y = 2.2;                  // fly in at hover height
    e.onBeforeHit = ()=>{ if(!e.dead && e.gravScale===0){ e.gravScale = 1; e.grounded = 70 + Math.floor(rnd()*30); } else e.gravScale = 1; return true; };
  } });
def('kire',    { name:'キレボウズ', hp:44, spd:0.04, radius:0.46, height:1.22, weight:1.1, score:200, xp:16 });
def('pierrot', { name:'ピエロボウズ', hp:40, spd:0.042, radius:0.45, height:1.42, weight:1, score:250, xp:18 });
def('balloon', { name:'ふうせん', hp:10, spd:0.026, radius:0.36, height:1.0, weight:0.5, score:100, xp:8,
  init(e){
    e.gravScale = 0; e.floatY = 1.35 + (rnd() - 0.5)*0.3;
    if(e.entrance==='drop'){ e.entrance = 'float'; e.y = Math.min(e.y, 3.5); }
    else if(e.entrance==='walk') e.y = e.floatY;
    e.onBeforeHit = ()=>{ e.gravScale = 1; if(e.hp > 1) e.hp = 1; return true; };   // pops in one hit
  },
  onKO(e){
    fxb('confetti', e.x, e.y + 0.55, e.z + 0.2, FX_POP); fxb('ring', e.x, e.y + 0.55, e.z + 0.2, FX_POPRING);
    H.say(e, 'パーン！');
    if(G.audio && G.audio.sfx) G.audio.sfx('pop');
    if(G.game && G.game.addXp && G.player) G.game.addXp(e.def.xp||8);
    e.removeMe = true;
    return true;
  } });
const FX_POP = { count:16, scale:0.6 }, FX_POPRING = { scale:0.7, color:'#ff7a8a' };
def('oni',     { name:'オニボウズ', hp:90, spd:0.028, radius:0.6, height:1.8, weight:2, armor:ARMOR_ONI, score:500, xp:30 });
def('ari',     { name:'へいたいアリ', hp:32, spd:0.038, radius:0.4, height:1.28, weight:0.9, score:180, xp:14,
  init(e){
    e.digCD = 150 + Math.floor(rnd()*60);
    e.onBeforeHit = ()=> !e.burrowed;              // underground: nothing reaches it (ults call damage() directly)
    if(!ultHooked){ ultHooked = true;             // an おうぎ pops every burrowed ant out so the big finish hits it too
      G.bus.on('ult', ()=>{ const L = G.world.ents; for(let i=0;i<L.length;i++){ const f = L[i]; if(f.type==='ari' && f.burrowed && !f.dead){ G.combat.cancel(f); f.pending = null; surface(f, false); G.setState(f, 'idle'); G.setAnim(f, 'jump'); } } }); }
  } });
let ultHooked = false;
def('mecha',   { name:'メカワンコ', hp:60, spd:0.026, radius:0.44, height:1.4, weight:1.6, armor:ARMOR_MECHA, score:400, xp:24 });

})();

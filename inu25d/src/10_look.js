// 10_look.js — 共有の見た目：ピクサー風のやわらか材質・輪郭線・形状キャッシュ・部品の結合・小物。
// 描画コールを抑えるため、キャラや小物は「頂点カラー＋共有材質」で部品ごとに1メッシュへ結合する。
(function(){ 'use strict';
const G = window.G; const THREE = window.THREE; const U = G.U;

// ---------------------------------------------------------------- shared uniforms (stage themes retint these)
const uni = {
  uRimColor: { value: new THREE.Color(0xfff2dc) },
  uRimPow:   { value: 2.4 },
  uRimStr:   { value: 0.42 },
  uWarm:     { value: new THREE.Color(0xff8a6a) },
  uWarmStr:  { value: 0.10 },
};

const matCache = new Map();
function softify(mat, opts){
  opts = opts || {};
  mat.userData.uFlash = { value: 0 };
  mat.userData.uRimMul = { value: opts.rim==null ? 1 : opts.rim };
  mat.userData.uTint = { value: new THREE.Color(1,1,1) };
  mat.onBeforeCompile = (sh)=>{
    sh.uniforms.uRimColor = uni.uRimColor; sh.uniforms.uRimPow = uni.uRimPow; sh.uniforms.uRimStr = uni.uRimStr;
    sh.uniforms.uWarm = uni.uWarm; sh.uniforms.uWarmStr = uni.uWarmStr;
    sh.uniforms.uFlash = mat.userData.uFlash; sh.uniforms.uRimMul = mat.userData.uRimMul; sh.uniforms.uTint = mat.userData.uTint;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uRimColor; uniform float uRimPow; uniform float uRimStr; uniform float uRimMul;\nuniform vec3 uWarm; uniform float uWarmStr; uniform float uFlash; uniform vec3 uTint;')
      .replace('#include <opaque_fragment>', [
        '{',
        '  vec3 vd_ = normalize(vViewPosition);',
        '  float ndv_ = clamp(dot(normalize(normal), vd_), 0.0, 1.0);',
        '  float rim_ = pow(1.0 - ndv_, uRimPow);',
        '  outgoingLight *= uTint;',
        '  outgoingLight += uRimColor * rim_ * uRimStr * uRimMul;',                      // soft back/rim light
        '  outgoingLight += diffuseColor.rgb * uWarm * uWarmStr * (1.0 - ndv_);',           // warm "subsurface" edge
        '  outgoingLight = mix(outgoingLight, vec3(2.4), uFlash);',                          // hit flash
        '}',
        '#include <opaque_fragment>'].join('\n'));
  };
  mat.customProgramCacheKey = ()=> 'inuSoft1';
  return mat;
}
function makeMat(color, opts){
  opts = opts || {};
  const m = new THREE.MeshStandardMaterial({
    color: new THREE.Color(color==null?0xffffff:color),
    roughness: opts.rough==null ? 0.72 : opts.rough,
    metalness: opts.metal || 0,
    vertexColors: !!opts.vertexColors,
    flatShading: !!opts.flat,
    transparent: !!opts.transparent,
    opacity: opts.opacity==null ? 1 : opts.opacity,
    side: opts.side || THREE.FrontSide,
  });
  if(opts.emissive!=null){ m.emissive = new THREE.Color(opts.emissive); m.emissiveIntensity = opts.emissiveIntensity==null?1:opts.emissiveIntensity; }
  if(opts.depthWrite===false) m.depthWrite = false;
  return softify(m, opts);
}

// ---------------------------------------------------------------- outline (inverted hull, pushed along normals)
const outlineCache = new Map();
function outlineMat(thick, color){
  const key = thick.toFixed(4)+'|'+color;
  let m = outlineCache.get(key); if(m) return m;
  m = new THREE.MeshBasicMaterial({ color: new THREE.Color(color), side: THREE.BackSide });
  m.userData.uThick = { value: thick };
  m.onBeforeCompile = (sh)=>{
    sh.uniforms.uThick = m.userData.uThick;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uThick;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed += normalize(normal) * uThick;');
  };
  m.customProgramCacheKey = ()=> 'inuOutline1';
  outlineCache.set(key, m);
  return m;
}

// ---------------------------------------------------------------- geometry cache
const geoCache = new Map();
function cached(key, make){ let g = geoCache.get(key); if(!g){ g = make(); g.userData.shared = true; geoCache.set(key, g); } return g; }
const geo = {
  sphere:(r=0.5, ws=24, hs=16)=> cached(`s${r}|${ws}|${hs}`, ()=> new THREE.SphereGeometry(r, ws, hs)),
  capsule:(r=0.2, len=0.4, cs=6, rs=12)=> cached(`c${r}|${len}|${cs}|${rs}`, ()=> new THREE.CapsuleGeometry(r, len, cs, rs)),
  box:(w=1,h=1,d=1)=> cached(`b${w}|${h}|${d}`, ()=> new THREE.BoxGeometry(w,h,d)),
  cylinder:(rt=0.5, rb=0.5, h=1, rs=20, open=false)=> cached(`y${rt}|${rb}|${h}|${rs}|${open}`, ()=> new THREE.CylinderGeometry(rt, rb, h, rs, 1, open)),
  cone:(r=0.5, h=1, rs=16)=> cached(`o${r}|${h}|${rs}`, ()=> new THREE.ConeGeometry(r, h, rs)),
  torus:(r=0.5, t=0.15, rs=10, ts=24, arc=Math.PI*2)=> cached(`t${r}|${t}|${rs}|${ts}|${arc}`, ()=> new THREE.TorusGeometry(r, t, rs, ts, arc)),
  circle:(r=0.5, s=24)=> cached(`ci${r}|${s}`, ()=> new THREE.CircleGeometry(r, s)),
  plane:(w=1,h=1)=> cached(`p${w}|${h}`, ()=> new THREE.PlaneGeometry(w,h)),
  // rounded box made from a subdivided box whose vertices are pushed toward a superellipsoid
  rbox:(w=1,h=1,d=1,r=0.15,seg=4)=> cached(`rb${w}|${h}|${d}|${r}|${seg}`, ()=>{
    const g = new THREE.BoxGeometry(w,h,d,seg,seg,seg), p = g.attributes.position, v = new THREE.Vector3();
    const hx=w/2-r, hy=h/2-r, hz=d/2-r;
    for(let i=0;i<p.count;i++){
      v.fromBufferAttribute(p,i);
      const cx=U.clamp(v.x,-hx,hx), cy=U.clamp(v.y,-hy,hy), cz=U.clamp(v.z,-hz,hz);
      const dx=v.x-cx, dy=v.y-cy, dz=v.z-cz, l=Math.hypot(dx,dy,dz)||1;
      p.setXYZ(i, cx+dx/l*r, cy+dy/l*r, cz+dz/l*r);
    }
    g.computeVertexNormals(); return g;
  }),
  star:(r=0.5, inner=0.5, depth=0.18, pts=5)=> cached(`st${r}|${inner}|${depth}|${pts}`, ()=>{
    const s = new THREE.Shape();
    for(let i=0;i<pts*2;i++){ const a = i/(pts*2)*Math.PI*2 + Math.PI/2, rr = i%2 ? r*inner : r; const x=Math.cos(a)*rr, y=Math.sin(a)*rr; i?s.lineTo(x,y):s.moveTo(x,y); }
    s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled:true, bevelThickness:depth*0.35, bevelSize:r*0.08, bevelSegments:2, curveSegments:4 });
    g.translate(0,0,-depth/2); g.computeVertexNormals(); return g;
  }),
  heart:(r=0.5, depth=0.2)=> cached(`h${r}|${depth}`, ()=>{
    const s = new THREE.Shape(), k = r/0.5;
    s.moveTo(0, -0.45*k);
    s.bezierCurveTo( 0.55*k, -0.05*k,  0.55*k, 0.45*k, 0, 0.22*k);
    s.bezierCurveTo(-0.55*k,  0.45*k, -0.55*k, -0.05*k, 0, -0.45*k);
    const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled:true, bevelThickness:depth*0.4, bevelSize:r*0.1, bevelSegments:3, curveSegments:10 });
    g.translate(0,0.05*k,-depth/2); g.computeVertexNormals(); return g;
  }),
  lathe:(key, pts, seg=20)=> cached('l'+key, ()=> new THREE.LatheGeometry(pts.map(p=>new THREE.Vector2(p[0],p[1])), seg)),
};

// ---------------------------------------------------------------- part builder: merge many primitives into one vertex-coloured geometry
const _m4 = new THREE.Matrix4(), _n3 = new THREE.Matrix3(), _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _c = new THREE.Color();
class PartBuilder {
  constructor(){ this.parts = []; }
  // add(geometry, color, [x,y,z], [rx,ry,rz], [sx,sy,sz] | number)
  add(g, color, pos, rot, scl){
    const m = new THREE.Matrix4();
    _e.set(rot?rot[0]:0, rot?rot[1]:0, rot?rot[2]:0);
    _q.setFromEuler(_e);
    if(scl==null) _s.set(1,1,1); else if(typeof scl==='number') _s.set(scl,scl,scl); else _s.set(scl[0],scl[1],scl[2]);
    m.compose(_v.set(pos?pos[0]:0, pos?pos[1]:0, pos?pos[2]:0), _q, _s);
    this.parts.push({ g, color, m });
    return this;
  }
  addMatrix(g, color, matrix){ this.parts.push({ g, color, m: matrix.clone() }); return this; }
  get empty(){ return this.parts.length===0; }
  build(){
    let nv = 0, ni = 0;
    for(const p of this.parts){ nv += p.g.attributes.position.count; ni += p.g.index ? p.g.index.count : p.g.attributes.position.count; }
    const pos = new Float32Array(nv*3), nor = new Float32Array(nv*3), col = new Float32Array(nv*3);
    const idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
    let vo = 0, io = 0;
    for(const p of this.parts){
      const P = p.g.attributes.position, N = p.g.attributes.normal;
      _n3.getNormalMatrix(p.m);
      // mirrored matrices flip winding
      const flip = p.m.determinant() < 0;
      _c.set(p.color);
      for(let i=0;i<P.count;i++){
        _v.fromBufferAttribute(P,i).applyMatrix4(p.m);
        pos[(vo+i)*3]=_v.x; pos[(vo+i)*3+1]=_v.y; pos[(vo+i)*3+2]=_v.z;
        if(N){ _v.fromBufferAttribute(N,i).applyMatrix3(_n3).normalize(); nor[(vo+i)*3]=_v.x; nor[(vo+i)*3+1]=_v.y; nor[(vo+i)*3+2]=_v.z; }
        col[(vo+i)*3]=_c.r; col[(vo+i)*3+1]=_c.g; col[(vo+i)*3+2]=_c.b;
      }
      if(p.g.index){
        const I = p.g.index.array;
        for(let k=0;k<I.length;k+=3){
          if(flip){ idx[io++]=I[k]+vo; idx[io++]=I[k+2]+vo; idx[io++]=I[k+1]+vo; }
          else { idx[io++]=I[k]+vo; idx[io++]=I[k+1]+vo; idx[io++]=I[k+2]+vo; }
        }
      } else {
        for(let k=0;k<P.count;k+=3){
          if(flip){ idx[io++]=vo+k; idx[io++]=vo+k+2; idx[io++]=vo+k+1; }
          else { idx[io++]=vo+k; idx[io++]=vo+k+1; idx[io++]=vo+k+2; }
        }
      }
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
  // convenience: build → Mesh with a (shared or given) vertex-colour material, optional outline child
  mesh(opts){
    opts = opts || {};
    const g = this.build();
    const mat = opts.material || G.look.vmat(opts);
    const mesh = new THREE.Mesh(g, mat);
    mesh.castShadow = opts.castShadow!==false; mesh.receiveShadow = !!opts.receiveShadow;
    if(opts.outline!==false && opts.outline!==0) G.look.outline(mesh, opts.outline==null ? 0.022 : opts.outline, opts.outlineColor);
    return mesh;
  }
}

// ---------------------------------------------------------------- blob shadow
let blobTex = null;
function getBlobTex(){
  if(blobTex) return blobTex;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d'), gr = x.createRadialGradient(32,32,0,32,32,32);
  gr.addColorStop(0,'rgba(40,20,40,1)'); gr.addColorStop(0.45,'rgba(40,20,40,0.75)'); gr.addColorStop(1,'rgba(40,20,40,0)');
  x.fillStyle = gr; x.fillRect(0,0,64,64);
  blobTex = new THREE.CanvasTexture(c); blobTex.colorSpace = THREE.SRGBColorSpace;
  return blobTex;
}

// ---------------------------------------------------------------- canvas textures
const texCache = new Map();
function canvasTex(key, w, h, draw){
  if(key && texCache.has(key)) return texCache.get(key);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 2;
  if(key) texCache.set(key, t);
  return t;
}

// ---------------------------------------------------------------- pickups & breakable props
const PICK = {
  bone:(b)=>{ const c='#fff4e0'; b.add(geo.capsule(0.07,0.34,4,10), c, [0,0,0],[0,0,Math.PI/2]);
    for(const sx of [-1,1]) for(const sy of [-1,1]) b.add(geo.sphere(0.085,12,8), c, [sx*0.22, sy*0.06, 0]); },
  cake:(b)=>{ b.add(geo.cylinder(0.26,0.28,0.18,20), '#f7d7a8', [0,0.09,0]); b.add(geo.cylinder(0.27,0.27,0.07,20), '#fff6fb', [0,0.2,0]);
    b.add(geo.cylinder(0.2,0.22,0.14,20), '#ffb6cf', [0,0.3,0]); b.add(geo.sphere(0.07,12,8), '#ff3b55', [0,0.42,0]);
    for(let i=0;i<6;i++){ const a=i/6*U.TAU; b.add(geo.sphere(0.045,8,6), '#ffffff', [Math.cos(a)*0.2,0.24,Math.sin(a)*0.2]); } },
  coin:(b)=>{ b.add(geo.cylinder(0.2,0.2,0.06,24), '#ffcf3a', [0,0,0],[Math.PI/2,0,0]);
    b.add(geo.cylinder(0.15,0.15,0.075,20), '#ffe27a', [0,0,0],[Math.PI/2,0,0]);
    b.add(geo.sphere(0.045,10,8), '#e8a21c', [0,-0.03,0.04],[0,0,0],[1,0.8,0.5]);
    for(let i=0;i<4;i++){ const a=(i-1.5)*0.45; b.add(geo.sphere(0.022,8,6), '#e8a21c', [Math.sin(a)*0.07,0.045+Math.cos(a)*0.02,0.04],[0,0,0],[1,1,0.5]); } },
  gem:(b)=>{ b.add(new THREE.OctahedronGeometry(0.2,0), '#6fe3ff', [0,0,0],[0,0,0],[0.8,1.1,0.8]); },
  star:(b)=>{ b.add(geo.star(0.26,0.48,0.12), '#ffe14d'); },
  heart:(b)=>{ b.add(geo.heart(0.28,0.14), '#ff5f8f'); },
};
const pickCache = new Map();
const PROP = {
  crate:(b)=>{ b.add(geo.rbox(0.9,0.8,0.8,0.08,3), '#d9a05b', [0,0.4,0]);
    b.add(geo.rbox(0.94,0.12,0.84,0.04,2), '#9c6230', [0,0.12,0]); b.add(geo.rbox(0.94,0.12,0.84,0.04,2), '#9c6230', [0,0.68,0]);
    b.add(geo.box(0.1,0.62,0.84), '#b7773a', [0,0.4,0],[0,0,0.72]); },
  barrel:(b)=>{ b.add(geo.lathe('barrel', [[0,0],[0.34,0],[0.42,0.25],[0.44,0.45],[0.42,0.65],[0.34,0.9],[0,0.9]], 20), '#c9874a');
    b.add(geo.torus(0.43,0.03,6,24), '#6f6a78', [0,0.22,0],[Math.PI/2,0,0]); b.add(geo.torus(0.43,0.03,6,24), '#6f6a78', [0,0.68,0],[Math.PI/2,0,0]); },
  pot:(b)=>{ b.add(geo.lathe('pot', [[0,0],[0.22,0],[0.36,0.18],[0.38,0.34],[0.26,0.56],[0.18,0.62],[0.22,0.7],[0,0.7]], 20), '#e08a5a');
    b.add(geo.torus(0.33,0.025,6,24), '#fff1d0', [0,0.3,0],[Math.PI/2,0,0]); },
  pumpkin:(b)=>{ for(let i=0;i<6;i++){ const a=i/6*U.TAU; b.add(geo.sphere(0.26,14,10), '#ff9a2e', [Math.cos(a)*0.16,0.3,Math.sin(a)*0.16],[0,-a,0],[0.7,1,1]); }
    b.add(geo.cylinder(0.04,0.05,0.18,8), '#5a8a2e', [0,0.6,0]); },
  crystal:(b)=>{ b.add(new THREE.OctahedronGeometry(0.3,0), '#a78bff', [0,0.45,0],[0,0.3,0],[0.7,1.5,0.7]);
    b.add(new THREE.OctahedronGeometry(0.18,0), '#7fd8ff', [0.24,0.25,0.05],[0,0,-0.4],[0.7,1.4,0.7]);
    b.add(new THREE.OctahedronGeometry(0.16,0), '#ff9ad8', [-0.22,0.22,-0.05],[0,0,0.4],[0.7,1.3,0.7]); },
};

G.look = {
  uni,
  init(){},
  // cached soft material by colour+opts (shared: do not mutate per instance)
  mat(color, opts){
    opts = opts || {};
    const key = String(color)+'|'+JSON.stringify(opts);
    let m = matCache.get(key);
    if(!m){ m = makeMat(color, opts); m.userData.shared = true; matCache.set(key, m); }
    return m;
  },
  // per-instance soft material (hit flash etc.); caller disposes via G.look.disposeObject or rig.dispose
  matInstance(color, opts){ return makeMat(color, opts); },
  // vertex-colour soft material (shared unless opts.instance)
  vmat(opts){
    opts = Object.assign({ vertexColors:true }, opts||{});
    delete opts.outline; delete opts.outlineColor; delete opts.castShadow; delete opts.receiveShadow;
    if(opts.instance){ delete opts.instance; return makeMat(0xffffff, opts); }
    return G.look.mat(0xffffff, opts);
  },
  outline(mesh, thick, color){
    const o = new THREE.Mesh(mesh.geometry, outlineMat(thick==null?0.022:thick, color||'#3b2417'));
    o.castShadow = false; o.receiveShadow = false; o.userData.isOutline = true;
    o.visible = G.quality.tier < 2 || !!(mesh.userData.keepOutline);
    mesh.add(o);
    return o;
  },
  outlineMat,
  geo,
  builder(){ return new PartBuilder(); },
  PartBuilder,
  // glossy chiikawa-style eye: black oval + big highlight + tiny second highlight (one mesh)
  eye(size){
    size = size||0.08;
    const b = new PartBuilder();
    b.add(geo.sphere(size,16,12), '#1d1410', [0,0,0],[0,0,0],[0.82,1,0.55]);
    b.add(geo.sphere(size*0.34,10,8), '#ffffff', [size*0.26,size*0.34,size*0.42]);
    b.add(geo.sphere(size*0.14,8,6), '#ffffff', [-size*0.22,-size*0.3,size*0.44]);
    const m = new THREE.Mesh(b.build(), G.look.vmat({ rough:0.25, rim:0.2 }));
    m.castShadow = false;
    return m;
  },
  blush(size){
    size = size||0.1;
    const m = new THREE.Mesh(geo.sphere(size,12,8), G.look.mat('#ff9fb5', { rough:0.9, rim:0 }));
    m.scale.set(1.25,0.62,0.3); m.castShadow = false;
    return m;
  },
  blobShadow(radius){
    const mat = new THREE.MeshBasicMaterial({ map:getBlobTex(), transparent:true, depthWrite:false, opacity:0.42, color:0xffffff });
    const m = new THREE.Mesh(geo.plane(1,1), mat);
    m.rotation.x = -Math.PI/2;
    m.renderOrder = -1;
    const s = radius*2.4;
    m.geometry = geo.plane(s, s*0.75);
    m.userData.dispose = ()=> mat.dispose();
    return m;
  },
  canvasTex,
  // pickups share one merged geometry + material per kind (a boss drops 12+ coins in one frame)
  pickupMesh(kind){
    if(!PICK[kind]) kind = 'coin';
    let c = pickCache.get(kind);
    if(!c){
      const b = new PartBuilder(); PICK[kind](b);
      const g = b.build(); g.userData.shared = true;
      const mat = G.look.vmat({ rough: kind==='coin'||kind==='gem' ? 0.35 : 0.6, metal: kind==='coin' ? 0.2 : 0 });
      c = { g, mat }; pickCache.set(kind, c);
    }
    const mesh = new THREE.Mesh(c.g, c.mat);
    mesh.castShadow = false;            // pickups already have a blob shadow
    G.look.outline(mesh, 0.018);
    const obj = new THREE.Group(); obj.add(mesh);
    return { obj, mesh, dispose(){} };
  },
  propMesh(kind){
    const f = PROP[kind] || PROP.crate;
    const b = new PartBuilder(); f(b);
    const mesh = b.mesh({ outline:0.02, rough:0.8, instance:false });
    const mat = G.look.vmat({ instance:true, rough:0.8 });
    mesh.material = mat;
    const obj = new THREE.Group(); obj.add(mesh);
    return { obj, mesh, mat, dispose(){ mesh.geometry.dispose(); mat.dispose(); } };
  },
  // dispose geometries/materials under an object that are not marked shared
  disposeObject(root){
    root.traverse(o=>{
      if(o.geometry && !o.geometry.userData.shared) o.geometry.dispose();
      if(o.material){ const ms = Array.isArray(o.material)?o.material:[o.material];
        for(const m of ms){ if(!m.userData.shared && !outlineCache.has(m.userData.key)) { if(!isOutline(m)) m.dispose(); } } }
    });
  },
  // set hit flash / tint on every soft material under root (per-instance materials only)
  setFlash(root, v){
    root.traverse(o=>{ const m=o.material; if(m && m.userData && m.userData.uFlash && !m.userData.shared) m.userData.uFlash.value = v; });
  },
  // global rim/warm retint (stage themes)
  setRim(color, strength, warmColor, warmStr){
    if(color!=null) uni.uRimColor.value.set(color);
    if(strength!=null) uni.uRimStr.value = strength;
    if(warmColor!=null) uni.uWarm.value.set(warmColor);
    if(warmStr!=null) uni.uWarmStr.value = warmStr;
  },
  // toggle outlines when quality changes
  refreshOutlines(){
    if(!G.scene) return;
    G.scene.traverse(o=>{ if(o.userData.isOutline) o.visible = G.quality.tier < 2; });
  },
};
function isOutline(m){ for(const v of outlineCache.values()) if(v===m) return true; return false; }

G.bus.on('quality', ()=> G.look.refreshOutlines());
})();

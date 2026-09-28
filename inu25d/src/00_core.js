// 00_core.js — もふもふ聖犬士イッヌ 2.5D : core services
// 名前空間・固定60Hzループ・入力・カメラ・実体（エンティティ）・物理・品質ガバナー。
// 他のモジュールは G.* 経由でだけ参照する（CONTRACT.md §3）。
(function(){ 'use strict';
const G = window.G = window.G || {};
const THREE = window.THREE;
G.THREE = THREE;

// ---------------------------------------------------------------- config
G.cfg = {
  TICK: 1/60,
  GRAV: -0.012,            // units / frame^2 (jump 0.22 → apex 2.0u, 37 frames airtime)
  ZMIN: -2.4, ZMAX: 2.0,   // walkable belt depth
  FRICTION_GROUND: 0.80,
  FRICTION_AIR: 0.985,
  MAX_STEPS: 5,            // max fixed ticks per rendered frame (spiral-of-death guard)
};

// ---------------------------------------------------------------- utils
const TAU = Math.PI*2;
const U = G.U = {
  TAU,
  clamp:(v,a,b)=> v<a?a:(v>b?b:v),
  lerp:(a,b,t)=> a+(b-a)*t,
  invLerp:(a,b,v)=> (v-a)/(b-a),
  // frame-rate independent smoothing: k = response per second
  damp:(a,b,k,dt)=> a+(b-a)*(1-Math.exp(-k*dt)),
  approach:(v,t,s)=> v<t?Math.min(v+s,t):Math.max(v-s,t),
  rand:(a,b)=> a+Math.random()*(b-a),
  randi:(a,b)=> Math.floor(a+Math.random()*(b-a+1)),
  pick:(arr)=> arr[Math.floor(Math.random()*arr.length)],
  chance:(p)=> Math.random()<p,
  sign:(v)=> v<0?-1:1,
  easeOutBack:(t)=>{ const c1=1.70158,c3=c1+1; return 1+c3*Math.pow(t-1,3)+c1*Math.pow(t-1,2); },
  easeOutCubic:(t)=> 1-Math.pow(1-t,3),
  easeInCubic:(t)=> t*t*t,
  easeInOutSine:(t)=> -(Math.cos(Math.PI*t)-1)/2,
  easeOutElastic:(t)=>{ if(t<=0) return 0; if(t>=1) return 1; return Math.pow(2,-10*t)*Math.sin((t*10-0.75)*(TAU/3))+1; },
  // smooth 0→1→0 bump over [a,b]
  bump:(t,a,b)=>{ if(t<=a||t>=b) return 0; const x=(t-a)/(b-a); return Math.sin(x*Math.PI); },
  // 0 before a, 1 after b, smooth in between
  smooth:(t,a,b)=>{ if(t<=a) return 0; if(t>=b) return 1; const x=(t-a)/(b-a); return x*x*(3-2*x); },
  v3:()=> new THREE.Vector3(),
};

// seedable RNG (mulberry32) for gameplay decisions
let _seed = 0x1234abcd;
G.seed = (n)=>{ _seed = (n>>>0) || 1; };
G.rng = ()=>{ _seed |= 0; _seed = (_seed + 0x6D2B79F5) | 0; let t = Math.imul(_seed ^ (_seed>>>15), 1 | _seed);
  t = (t + Math.imul(t ^ (t>>>7), 61 | t)) ^ t; return ((t ^ (t>>>14)) >>> 0) / 4294967296; };
G.rpick = (arr)=> arr[Math.floor(G.rng()*arr.length)];

// ---------------------------------------------------------------- event bus
const handlers = {};
G.bus = {
  on(evt, fn){ (handlers[evt] = handlers[evt] || []).push(fn); return fn; },
  off(evt, fn){ const h = handlers[evt]; if(!h) return; const i = h.indexOf(fn); if(i>=0) h.splice(i,1); },
  emit(evt, data){
    const h = handlers[evt]; if(!h) return;
    for(let i=0;i<h.length;i++){
      try { h[i](data||{}); } catch(err){ G.logError && G.logError('bus:'+evt, err); }
    }
  },
};

// errors are collected (tests read them) and never stop the loop
G.errors = [];
G.logError = (where, err)=>{
  G.errors.push(where+': '+(err && err.stack || err));
  if(G.errors.length>50) G.errors.shift();
  try { console.error('[inu25d]', where, err); } catch(_){}
};

// ---------------------------------------------------------------- quality
const isTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints>0);
G.isTouch = isTouch;
G.quality = { tier: isTouch ? 1 : 0, dpr: 1, shadows: true, fxScale: 1 };
function applyQuality(){
  const q = G.quality, dev = window.devicePixelRatio || 1;
  q.dpr = q.tier===0 ? Math.min(dev, 2) : q.tier===1 ? Math.min(dev, 1.5) : Math.min(dev, 1);
  q.shadows = q.tier<2;
  q.fxScale = q.tier===0 ? 1 : q.tier===1 ? 0.7 : 0.4;
  if(G.renderer){
    G.renderer.setPixelRatio(q.dpr);
    G.renderer.shadowMap.enabled = q.shadows;
    if(G.lights && G.lights.key){
      G.lights.key.castShadow = q.shadows;
      const sz = q.tier===0 ? 2048 : 1024;
      if(G.lights.key.shadow.mapSize.x!==sz){
        G.lights.key.shadow.mapSize.set(sz, sz);
        if(G.lights.key.shadow.map){ G.lights.key.shadow.map.dispose(); G.lights.key.shadow.map = null; }
      }
    }
    // materials must recompile when shadow maps toggle
    if(G.scene) G.scene.traverse(o=>{ if(o.material){ const m=o.material; (Array.isArray(m)?m:[m]).forEach(mm=>mm.needsUpdate=true); } });
    resize();
  }
  G.bus.emit('quality', q);
}
G.setQuality = (tier)=>{ G.quality.tier = U.clamp(tier|0,0,2); applyQuality(); };

// ---------------------------------------------------------------- renderer / scene / lights
G.initRenderer = function(canvas){
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', alpha: false,
      preserveDrawingBuffer: !!G.testMode });
  } catch(err){
    G.logError('webgl', err);
    return false;
  }
  G.renderer = renderer;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setClearColor(0xbfe6ff, 1);

  const scene = G.scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xcfeaff, 30, 90);

  const camera = G.camera = new THREE.PerspectiveCamera(30, 16/9, 0.1, 400);
  camera.position.set(0, 6, 16);

  // Pixar-ish three-point lighting: warm key, cool sky fill, strong back rim
  const hemi = new THREE.HemisphereLight(0xcfe8ff, 0x9ccb73, 1.25);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(0xfff0d8, 2.4);
  key.position.set(-6, 14, 10);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  const sc = key.shadow.camera; sc.left=-15; sc.right=15; sc.top=12; sc.bottom=-10; sc.near=1; sc.far=60;
  key.shadow.bias = -0.0008; key.shadow.normalBias = 0.03; key.shadow.radius = 4;
  scene.add(key); scene.add(key.target);
  const rim = new THREE.DirectionalLight(0xbfe0ff, 1.6);   // from behind-top: cool rim
  rim.position.set(4, 8, -12);
  scene.add(rim); scene.add(rim.target);
  const fill = new THREE.DirectionalLight(0xffe2f0, 0.45); // soft pinkish bounce from front-right-low
  fill.position.set(8, 2, 12);
  scene.add(fill); scene.add(fill.target);
  G.lights = { hemi, key, rim, fill };

  applyQuality();
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', ()=> setTimeout(resize, 120));
  if(window.visualViewport) window.visualViewport.addEventListener('resize', resize);
  resize();
  return true;
};

let viewW = 1, viewH = 1;
function resize(){
  if(!G.renderer) return;
  const w = Math.max(1, window.innerWidth), h = Math.max(1, window.innerHeight);
  viewW = w; viewH = h;
  G.renderer.setSize(w, h, false);
  G.renderer.domElement.style.width = w+'px';
  G.renderer.domElement.style.height = h+'px';
  G.camera.aspect = w/h;
  G.camera.updateProjectionMatrix();
  G.view = { w, h, portrait: h>w };
  G.cam && G.cam.recalc();
  G.bus.emit('resize', G.view);
}
G.resize = resize;
G.view = { w:1, h:1, portrait:false };

// world → CSS pixel projection (for DOM popups / bars)
const _pv = new THREE.Vector3();
G.toScreen = (x,y,z,out)=>{
  out = out || {};
  _pv.set(x,y,z).project(G.camera);
  out.x = (_pv.x*0.5+0.5)*viewW;
  out.y = (-_pv.y*0.5+0.5)*viewH;
  out.visible = _pv.z<1 && _pv.x>-1.2 && _pv.x<1.2 && _pv.y>-1.3 && _pv.y<1.3;
  return out;
};

// ---------------------------------------------------------------- camera controller
const VFOV = 30, PITCH = 17*Math.PI/180;
G.cam = {
  x:0, y:1.1, z:0,           // current look target
  tx:0, ty:1.1, tz:0,        // desired
  dist:16, halfW:7,
  followEnt:null, lockMin:-1e9, lockMax:1e9,
  shakeP:0, shakeT:0, shakeMax:1,
  punch:0, punchT:0, punchMax:1,
  focusT:0, fx:0, fy:0, fz:0, focusZoom:0,
  zoom:0,                    // extra zoom in (units closer), e.g. boss fights zoom out with negative
  recalc(){
    // keep a comfortable visible width at the belt plane: wider in landscape, tighter in portrait
    const aspect = G.camera.aspect;
    const wantW = aspect>=1 ? U.clamp(10.5 + (aspect-1)*4.2, 10.5, 15) : U.clamp(8.2*aspect/0.56, 6.5, 9.5);
    const tanV = Math.tan(VFOV*Math.PI/360);
    const d = (wantW/2)/(tanV*aspect);
    this.baseDist = U.clamp(d, 10, 30);
    this.halfW = wantW/2;
  },
  follow(ent){ this.followEnt = ent; },
  lock(a,b){ this.lockMin=a; this.lockMax=b; },
  unlock(){ this.lockMin=-1e9; this.lockMax=1e9; },
  shake(power, frames){ if(power>=this.shakeP*(this.shakeT/Math.max(1,this.shakeMax))){ this.shakeP=power; this.shakeT=frames; this.shakeMax=frames; } },
  kick(power, frames){ this.punch=power; this.punchT=frames; this.punchMax=frames; },
  focus(x,y,z,frames,zoom){ this.fx=x; this.fy=y; this.fz=z; this.focusT=frames; this.focusZoom=zoom||0; },
  snap(){ this.frame(1, true); },
  // world x range currently visible at the belt plane (for spawns / locks)
  viewRange(){ return [this.x - this.halfW, this.x + this.halfW]; },
  frame(dt, snap){
    const e = this.followEnt;
    if(e){
      const look = e.face*0.9;
      this.tx = e.x + look; this.ty = 1.05 + Math.max(0, e.y*0.35); this.tz = U.lerp(-0.2, e.z, 0.35);
    }
    // camera centre must keep the lock range fully on screen
    const lo = this.lockMin + this.halfW, hi = this.lockMax - this.halfW;
    if(lo<=hi) this.tx = U.clamp(this.tx, lo, hi); else this.tx = (this.lockMin+this.lockMax)/2;
    const stg = G.stage && G.stage.info;
    if(stg){ this.tx = U.clamp(this.tx, this.halfW-1, Math.max(this.halfW-1, stg.length - this.halfW + 1)); }
    let gx=this.tx, gy=this.ty, gz=this.tz, zoom=this.zoom;
    if(this.focusT>0){ this.focusT--; gx=this.fx; gy=this.fy; gz=this.fz; zoom += this.focusZoom; }
    if(snap){ this.x=gx; this.y=gy; this.z=gz; }
    else { this.x=U.damp(this.x,gx,5.5,dt); this.y=U.damp(this.y,gy,4,dt); this.z=U.damp(this.z,gz,3,dt); }
    let d = (this.baseDist||16) - zoom;
    if(this.punchT>0){ d -= this.punch*Math.sin(Math.PI*this.punchT/this.punchMax); this.punchT--; }
    let sx=0, sy=0;
    if(this.shakeT>0){
      const k = this.shakeP*(this.shakeT/this.shakeMax);
      sx = (Math.random()*2-1)*k*0.12; sy = (Math.random()*2-1)*k*0.09;
      this.shakeT--;
    }
    const cam = G.camera;
    cam.position.set(this.x + sx, this.y + Math.sin(PITCH)*d + sy, this.z + Math.cos(PITCH)*d);
    cam.lookAt(this.x + sx*0.5, this.y + sy*0.5, this.z);
    // shadow camera follows the view
    const L = G.lights;
    if(L){
      L.key.target.position.set(this.x, 0, this.z);
      L.key.position.set(this.x-6, 14, this.z+10);
      L.rim.target.position.set(this.x, 0.8, this.z);
      L.rim.position.set(this.x+4, 8, this.z-12);
      L.fill.target.position.set(this.x, 0.8, this.z);
      L.fill.position.set(this.x+8, 2, this.z+12);
    }
  },
};

// ---------------------------------------------------------------- input
const BTNS = ['attack','jump','dodge','special','ult','pause','confirm'];
const KEYS = {
  attack:['KeyJ','KeyZ'], jump:['KeyK','Space'], dodge:['KeyL','ShiftLeft','ShiftRight'],
  special:['KeyI','KeyX'], ult:['KeyU','KeyC'], pause:['KeyP','Escape'], confirm:['Enter','NumpadEnter'],
};
const MOVE = { left:['ArrowLeft','KeyA'], right:['ArrowRight','KeyD'], up:['ArrowUp','KeyW'], down:['ArrowDown','KeyS'] };
const keyDown = Object.create(null);
const latch = Object.create(null);
const inp = G.input = {
  x:0, z:0, btn:{}, touch:{ x:0, z:0 }, pad:{ x:0, z:0 }, lastDevice: isTouch ? 'touch' : 'key',
  // UI calls this on touch/pointer down so a tap shorter than one tick still counts
  latch(btn){ latch[btn] = true; },
  anyPressed(){ for(const b of BTNS){ if(inp.btn[b].pressed) return true; } return false; },
  clear(){ for(const b of BTNS){ const s=inp.btn[b]; s.down=s.pressed=s.released=false; s.held=0; latch[b]=false; }
           for(const k in keyDown) keyDown[k]=false; },
};
for(const b of BTNS){ inp.btn[b] = { down:false, pressed:false, released:false, held:0 }; inp.touch[b]=false; inp.pad[b]=false; }

const codeToBtn = {};
for(const b in KEYS) for(const c of KEYS[b]) codeToBtn[c]=b;
const moveCodes = new Set([].concat(MOVE.left,MOVE.right,MOVE.up,MOVE.down));
window.addEventListener('keydown', (e)=>{
  const c = e.code;
  if(codeToBtn[c] || moveCodes.has(c)){
    // keep the page from scrolling / buttons from being "clicked" by space
    if(!(e.target && (e.target.tagName==='INPUT' || e.target.tagName==='TEXTAREA'))) e.preventDefault();
  }
  if(!e.repeat && codeToBtn[c]) latch[codeToBtn[c]] = true;
  keyDown[c] = true; inp.lastDevice = 'key';
  if(G.audio && G.audio.unlock) G.audio.unlock();
}, {passive:false});
window.addEventListener('keyup', (e)=>{ keyDown[e.code] = false; });
window.addEventListener('blur', ()=>{ for(const k in keyDown) keyDown[k]=false; for(const b of BTNS) inp.touch[b]=false; inp.touch.x=0; inp.touch.z=0; });
const kd = (list)=> list.some(c=>keyDown[c]);

function pollPad(){
  const p = inp.pad; p.x=0; p.z=0; for(const b of BTNS) p[b]=false;
  if(!navigator.getGamepads) return;
  let pads; try { pads = navigator.getGamepads(); } catch(_){ return; }
  if(!pads) return;
  for(const gp of pads){
    if(!gp || !gp.connected) continue;
    const ax = gp.axes[0]||0, az = gp.axes[1]||0;
    if(Math.abs(ax)>0.2) p.x = ax;
    if(Math.abs(az)>0.2) p.z = az;
    const b = (i)=> gp.buttons[i] && gp.buttons[i].pressed;
    if(b(14)) p.x=-1; if(b(15)) p.x=1; if(b(12)) p.z=-1; if(b(13)) p.z=1;
    p.attack = b(2); p.jump = b(0); p.dodge = b(1) || b(4); p.special = b(3);
    p.ult = b(5) || b(7); p.pause = b(9); p.confirm = b(0) || b(9);
    if(p.attack||p.jump||p.x||p.z) inp.lastDevice='pad';
    break;
  }
}

function updateInput(){
  pollPad();
  let x = 0, z = 0;
  if(kd(MOVE.left)) x -= 1; if(kd(MOVE.right)) x += 1;
  if(kd(MOVE.up)) z -= 1;   if(kd(MOVE.down)) z += 1;
  x += inp.touch.x + inp.pad.x; z += inp.touch.z + inp.pad.z;
  inp.x = U.clamp(x,-1,1); inp.z = U.clamp(z,-1,1);
  for(const b of BTNS){
    const s = inp.btn[b];
    const down = kd(KEYS[b]) || !!inp.touch[b] || !!inp.pad[b];
    s.pressed = !!latch[b] || (down && !s.down);
    s.released = !down && s.down;
    s.down = down;
    s.held = down ? s.held+1 : 0;
    latch[b] = false;
  }
}

// ---------------------------------------------------------------- entities & world
let _id = 1;
G.makeEnt = function(o){
  const e = Object.assign({
    id:_id++, kind:'prop', type:'', team:2,
    x:0,y:0,z:0, vx:0,vy:0,vz:0, px:0,py:0,pz:0, face:1, onGround:true,
    radius:0.4, height:1.2, weight:1, gravScale:1,
    hp:1, maxHp:1, dead:false,
    state:'idle', stateT:0,
    anim:'idle', animT:0, animLen:0, animHit:0.35,
    atk:null, inv:0, stun:0, flashT:0, hurtDir:1, armor:0, charge:0,
    bounce:0, entered:true, noClamp:false, removeMe:false,
    rig:null, shadow:null,
  }, o||{});
  e.px=e.x; e.py=e.y; e.pz=e.z;
  return e;
};
G.setAnim = function(e, name, len, hitAt){
  if(e.anim!==name || len){ e.anim=name; e.animT=0; }
  e.animLen = len||0;
  e.animHit = hitAt==null ? 0.35 : hitAt;
};
G.setState = function(e, s){ if(e.state!==s){ e.state=s; e.stateT=0; } };

G.world = {
  ents: [],
  add(e){
    this.ents.push(e);
    if(e.rig && e.rig.root){ G.scene.add(e.rig.root); e.rig.root.position.set(e.x,e.y,e.z); }
    if(!e.noShadow && G.look && G.look.blobShadow){
      e.shadow = G.look.blobShadow(Math.max(0.3, e.radius*1.35));
      G.scene.add(e.shadow);
    }
    return e;
  },
  remove(e){
    const i = this.ents.indexOf(e); if(i>=0) this.ents.splice(i,1);
    if(e.rig){ if(e.rig.root && e.rig.root.parent) e.rig.root.parent.remove(e.rig.root); try{ e.rig.dispose && e.rig.dispose(); }catch(err){ G.logError('rig.dispose', err); } }
    if(e.shadow){ if(e.shadow.parent) e.shadow.parent.remove(e.shadow); if(e.shadow.userData.dispose) e.shadow.userData.dispose(); e.shadow=null; }
    e.removed = true;
  },
  clear(){ while(this.ents.length) this.remove(this.ents[this.ents.length-1]); },
  // remove entities flagged during the tick
  sweep(){ for(let i=this.ents.length-1;i>=0;i--){ const e=this.ents[i]; if(e.removeMe) this.remove(e); } },
  byTeam(team, out){ out = out || []; out.length=0; for(const e of this.ents) if(e.team===team && !e.dead) out.push(e); return out; },
};
G.foesAlive = ()=>{ let n=0; for(const e of G.world.ents) if(e.team===1 && !e.dead && !e.ignoreForClear) n++; return n; };

// physics for one entity: integrate, gravity, ground, friction, belt clamp
G.phys = function(e, bounds){
  e.x += e.vx; e.z += e.vz; e.y += e.vy;
  if(e.y>0 || e.vy>0){ e.vy += G.cfg.GRAV*e.gravScale; e.onGround=false; }
  if(e.y<=0){
    e.y = 0;
    if(!e.onGround){
      const hard = e.vy < -0.2;
      if(e.bounce>0 && e.vy < -0.12){
        e.vy = -e.vy*0.42; e.bounce--; e.y=0.001;
        G.bus.emit('land', {ent:e, hard:true, bounce:true});
      } else {
        e.vy = 0; e.onGround = true;
        G.bus.emit('land', {ent:e, hard});
      }
    } else e.vy = 0;
  }
  const f = e.onGround ? G.cfg.FRICTION_GROUND : G.cfg.FRICTION_AIR;
  e.vx *= f; e.vz *= f;
  if(Math.abs(e.vx)<1e-4) e.vx=0; if(Math.abs(e.vz)<1e-4) e.vz=0;
  if(!e.noClamp){
    e.z = U.clamp(e.z, G.cfg.ZMIN, G.cfg.ZMAX);
    if(bounds && e.entered){ e.x = U.clamp(e.x, bounds.xmin + e.radius, bounds.xmax - e.radius); }
  }
};

// render-frame visual sync with interpolation between ticks
function syncVisuals(alpha){
  for(const e of G.world.ents){
    const x = U.lerp(e.px, e.x, alpha), y = U.lerp(e.py, e.y, alpha), z = U.lerp(e.pz, e.z, alpha);
    if(e.rig && e.rig.root) e.rig.root.position.set(x, y, z);
    if(e.shadow){
      e.shadow.position.set(x, 0.015, z);
      const h = Math.max(0, y), s = 1/(1+h*0.35);
      e.shadow.scale.set(s, s, s);
      if(e.shadow.material) e.shadow.material.opacity = (e.shadowAlpha==null?0.42:e.shadowAlpha) * s * (e.dead? Math.max(0,1-(e.deadT||0)/40):1);
    }
  }
}
function storePrev(){ for(const e of G.world.ents){ e.px=e.x; e.py=e.y; e.pz=e.z; } }

// ---------------------------------------------------------------- scenes
G.scenes = {};
G.scene_ = null;
G.sceneName = '';
G.time = { tick:0, sceneTick:0, fps:60 };
G.go = function(name, params){
  const prev = G.scenes[G.sceneName];
  if(prev && prev.exit){ try{ prev.exit(); }catch(err){ G.logError('scene.exit '+G.sceneName, err); } }
  G.sceneName = name; G.time.sceneTick = 0;
  G.hitStop = 0; G.timeScale = 1; slowT = 0;
  const sc = G.scenes[name];
  if(sc && sc.enter){ try{ sc.enter(params||{}); }catch(err){ G.logError('scene.enter '+name, err); } }
  G.bus.emit('scene', {name});
};

// ---------------------------------------------------------------- time control
G.hitStop = 0;
G.timeScale = 1;
let slowT = 0, slowScale = 1;
G.slowmo = (frames, scale)=>{ slowT = Math.max(slowT, frames|0); slowScale = scale==null?0.35:scale; };
G.paused = false;

// ---------------------------------------------------------------- loop
let acc = 0, last = 0, running = false;
let emaDt = 1/60, slowFor = 0, fastFor = 0;
function tick(){
  G.time.tick++; G.time.sceneTick++;
  updateInput();
  storePrev();
  const sc = G.scenes[G.sceneName];
  if(sc && sc.tick){ try{ sc.tick(); }catch(err){ G.logError('tick '+G.sceneName, err); } }
  G.world.sweep();
}
function frame(now){
  if(!running) return;
  requestAnimationFrame(frame);
  let dt = (now - last)/1000; last = now;
  if(!(dt>0)) dt = 1/60;
  if(dt > 0.1) dt = 0.1;              // tab switch / hiccup: don't fast-forward the world
  // slow motion stretches ticks; counted in real frames
  let scale = 1;
  if(slowT>0){ slowT--; scale = slowScale; }
  G.timeScale = scale;
  acc += dt*scale;
  let steps = 0;
  while(acc >= G.cfg.TICK && steps < G.cfg.MAX_STEPS){ tick(); acc -= G.cfg.TICK; steps++; }
  if(steps >= G.cfg.MAX_STEPS) acc = 0;
  const alpha = U.clamp(acc / G.cfg.TICK, 0, 1);
  syncVisuals(G.hitStop>0 ? 1 : alpha);
  const sc = G.scenes[G.sceneName];
  try {
    if(sc && sc.frame) sc.frame(dt);
    G.cam.frame(dt);
    if(G.renderer) G.renderer.render(G.scene, G.camera);
  } catch(err){ G.logError('frame '+G.sceneName, err); }
  governor(dt);
}
function governor(dt){
  emaDt = emaDt*0.95 + dt*0.05;
  G.time.fps = 1/emaDt;
  if(G.sceneName!=='play' || document.hidden) { slowFor=0; return; }
  if(emaDt > 1/42){ slowFor += dt; fastFor = 0; } else { slowFor = Math.max(0, slowFor - dt*0.5); fastFor += dt; }
  if(slowFor > 2.5 && G.quality.tier < 2 && !G.quality.locked){
    slowFor = 0; G.setQuality(G.quality.tier+1);
  }
}
G.start = function(){
  if(running) return;           // never start a second rAF chain
  running = true; last = performance.now();
  requestAnimationFrame(frame);
};
G.stop = function(){ running = false; };
// deterministic stepping for tests (no rAF): advance n ticks and render once
G.step = function(n){ for(let i=0;i<(n||1);i++) tick(); syncVisuals(1); const sc=G.scenes[G.sceneName]; if(sc && sc.frame) sc.frame(G.cfg.TICK); G.cam.frame(G.cfg.TICK); if(G.renderer) G.renderer.render(G.scene, G.camera); };

document.addEventListener('visibilitychange', ()=>{
  if(document.hidden){ G.bus.emit('hidden', {}); } else { last = performance.now(); G.bus.emit('visible', {}); }
});

})();

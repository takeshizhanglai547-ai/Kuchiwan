// ============================================================
// Kunitachi Station Area 3D Explorer
// Three.js r128 based realistic 3D model
// ============================================================

(function(){
"use strict";

// --- Constants ---
const SCALE = 1; // 1 unit = 1 meter
const DAIGAKU_W = 44, DAIGAKU_L = 1300;
const LANE_W = 3.5, MEDIAN_W = 10, SIDEWALK_W = 6;
const ROAD_W = LANE_W * 4; // 14m each side
const ROTARY_R = 30, ROTARY_INNER = 20;
const CAM_H = 1.7, WALK_SPEED = 5, RUN_SPEED = 15, JUMP_V = 6;
const GRAVITY = -15;

// Colors
const C = {
  grass: 0x4a7c3f, asphalt: 0x3a3a3a, sidewalk: 0xaaaaaa,
  median: 0x5a8f4a, white: 0xf5f0e8, cream: 0xf5e6c8,
  beige: 0xe8dcc8, stationRoof: 0x8b2500, stationWall: 0xf8f4ef,
  brick: 0x8b4513, concrete: 0x888888, rail: 0x555555,
  water: 0x4488cc, sakura: 0xffb7c5, ginkgo: 0x2e8b57,
  trunk: 0x5c3a1e, lamp: 0x333333, warmLight: 0xffe4b5,
  glass: 0x88ccee, sign1: 0xe74c3c, sign2: 0x3498db, sign3: 0xf39c12
};

// --- Globals ---
let scene, camera, renderer, clock;
let moveState = {f:0,b:0,l:0,r:0,jump:false,run:false};
let velocity = new THREE.Vector3();
let onGround = true;
let yaw = 0, pitch = 0;
let pointerLocked = false;
let timeOfDay = 1; // 0=morning,1=noon,2=evening,3=night
let minimapCtx, compassCtx;
let buildings = [], landmarks = {};
let teleportIdx = 0;
let frameCount = 0, fpsTime = 0;

// Landmark data for teleporting & HUD
const LANDMARKS = [
  {name:"国立駅南口ロータリー / South Rotary", pos:[0,CAM_H,10]},
  {name:"旧国立駅舎 / Former Station Building", pos:[0,CAM_H,35]},
  {name:"大学通り中間地点 / Daigaku-dori Midpoint", pos:[0,CAM_H,-400]},
  {name:"一橋大学正門 / Hitotsubashi Univ. Gate", pos:[0,CAM_H,-600]},
  {name:"兼松講堂 / Kanematu Auditorium", pos:[-60,CAM_H,-700]},
  {name:"nonowa国立 / nonowa Kunitachi", pos:[30,CAM_H,45]},
];

// --- Helpers ---
function box(w,h,d,color,x,y,z){
  const g=new THREE.BoxGeometry(w,h,d);
  const m=new THREE.MeshLambertMaterial({color});
  const mesh=new THREE.Mesh(g,m);
  mesh.position.set(x,y,z);
  mesh.castShadow=true; mesh.receiveShadow=true;
  return mesh;
}
function cyl(r,h,color,x,y,z,segs){
  const g=new THREE.CylinderGeometry(r,r,h,segs||8);
  const m=new THREE.MeshLambertMaterial({color});
  const mesh=new THREE.Mesh(g,m);
  mesh.position.set(x,y+h/2,z);
  mesh.castShadow=true;
  return mesh;
}
function rand(a,b){return a+Math.random()*(b-a)}
function randInt(a,b){return Math.floor(rand(a,b+1));}
function randPick(arr){return arr[Math.floor(Math.random()*arr.length)];}

// --- Scene Setup ---
function initScene(){
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87ceeb);
  scene.fog = new THREE.Fog(0xc8dce8, 200, 800);

  camera = new THREE.PerspectiveCamera(70, window.innerWidth/window.innerHeight, 0.5, 2000);
  camera.position.set(0, CAM_H, 10);

  renderer = new THREE.WebGLRenderer({antialias:true});
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  document.body.appendChild(renderer.domElement);

  clock = new THREE.Clock();

  // Lights
  updateLighting();

  window.addEventListener('resize', ()=>{
    camera.aspect = window.innerWidth/window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
}

function updateLighting(){
  // Remove old lights
  scene.children.filter(c=>c.isLight).forEach(l=>scene.remove(l));

  const times = [
    {bg:0xffd4a0,fog:0xffe8c8,amb:0x886644,sun:0xffaa55,sunI:0.6,sunPos:[200,80,-100]},
    {bg:0x87ceeb,fog:0xc8dce8,amb:0x8899aa,sun:0xffffff,sunI:0.8,sunPos:[300,400,-200]},
    {bg:0xff7744,fog:0xffaa77,amb:0x664422,sun:0xff6633,sunI:0.5,sunPos:[-200,60,-100]},
    {bg:0x111133,fog:0x1a1a3a,amb:0x222244,sun:0x4466aa,sunI:0.2,sunPos:[100,200,100]},
  ];
  const t = times[timeOfDay];
  scene.background.setHex(t.bg);
  scene.fog.color.setHex(t.fog);

  const hemi = new THREE.HemisphereLight(t.bg, 0x3a5a2a, 0.4);
  scene.add(hemi);

  const amb = new THREE.AmbientLight(t.amb, 0.3);
  scene.add(amb);

  const sun = new THREE.DirectionalLight(t.sun, t.sunI);
  sun.position.set(...t.sunPos);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048,2048);
  sun.shadow.camera.left=-200; sun.shadow.camera.right=200;
  sun.shadow.camera.top=200; sun.shadow.camera.bottom=-200;
  sun.shadow.camera.far=1000;
  scene.add(sun);
}

// --- Ground & Roads ---
function buildGround(){
  // Main ground
  const ground = box(2000,0.1,2000, C.grass, 0,-0.05,0);
  ground.receiveShadow=true;
  scene.add(ground);

  // === DAIGAKU-DORI (大学通り) - runs south from rotary ===
  // Full width 44m, length 1300m going south (negative Z)
  const dStart = -15, dEnd = -1300;
  const dLen = Math.abs(dEnd - dStart);
  const dZ = (dStart + dEnd)/2;

  // West sidewalk
  scene.add(box(SIDEWALK_W, 0.12, dLen, C.sidewalk, -(MEDIAN_W/2+ROAD_W/2+SIDEWALK_W/2+ROAD_W/2), 0.06, dZ));
  // West road (2 lanes)
  scene.add(box(ROAD_W/2, 0.1, dLen, C.asphalt, -(MEDIAN_W/2+ROAD_W/4), 0.05, dZ));
  // Road lane markings west
  for(let z=dStart;z>dEnd;z-=10){
    scene.add(box(0.15, 0.11, 5, 0xffffff, -(MEDIAN_W/2+LANE_W), 0.06, z));
  }
  // Central median (green)
  scene.add(box(MEDIAN_W, 0.15, dLen, C.median, 0, 0.075, dZ));
  // Flower beds on median every 50m
  for(let z=dStart;z>dEnd;z-=50){
    scene.add(box(6,0.25,8, 0x6aaa4a, 0, 0.15, z));
  }
  // East road (2 lanes)
  scene.add(box(ROAD_W/2, 0.1, dLen, C.asphalt, (MEDIAN_W/2+ROAD_W/4), 0.05, dZ));
  // Road lane markings east
  for(let z=dStart;z>dEnd;z-=10){
    scene.add(box(0.15, 0.11, 5, 0xffffff, (MEDIAN_W/2+LANE_W), 0.06, z));
  }
  // East sidewalk
  scene.add(box(SIDEWALK_W, 0.12, dLen, C.sidewalk, (MEDIAN_W/2+ROAD_W/2+SIDEWALK_W/2+ROAD_W/2), 0.06, dZ));

  // === FUJIMI-DORI (富士見通り) - southwest ===
  const fAngle = -Math.PI*0.75; // 225 deg = southwest
  const fLen = 800, fW = 20;
  buildAngledRoad(fAngle, fLen, fW);

  // === ASAHI-DORI (旭通り) - southeast ===
  const aAngle = -Math.PI*0.25; // 315 deg mapped to SE
  buildAngledRoad(Math.PI*0.75, 500, 16);

  // === Cross streets ===
  for(let z=-100; z>-1200; z-=120){
    // East-west cross street
    scene.add(box(300, 0.1, 10, C.asphalt, -170, 0.05, z));
    scene.add(box(300, 0.1, 10, C.asphalt, 170, 0.05, z));
    scene.add(box(300, 0.1, 8, C.sidewalk, -170, 0.06, z-7));
    scene.add(box(300, 0.1, 8, C.sidewalk, 170, 0.06, z-7));
  }
}

function buildAngledRoad(angle, len, w){
  const segs = Math.ceil(len/20);
  for(let i=0;i<segs;i++){
    const t = (i+0.5)/segs;
    const d = t*len;
    const x = Math.sin(angle)*d;
    const z = -Math.cos(angle)*d;
    const road = box(w, 0.1, len/segs+1, C.asphalt, x, 0.05, z);
    road.rotation.y = -angle;
    scene.add(road);
    // Sidewalks
    const sw = box(4, 0.12, len/segs+1, C.sidewalk, x+Math.cos(angle)*(w/2+2), 0.06, z+Math.sin(angle)*(w/2+2));
    sw.rotation.y = -angle;
    scene.add(sw);
    const sw2 = box(4, 0.12, len/segs+1, C.sidewalk, x-Math.cos(angle)*(w/2+2), 0.06, z-Math.sin(angle)*(w/2+2));
    sw2.rotation.y = -angle;
    scene.add(sw2);
  }
}

// --- Rotary ---
function buildRotary(){
  // Circular road
  const roadGeo = new THREE.RingGeometry(ROTARY_INNER, ROTARY_R, 48);
  const roadMat = new THREE.MeshLambertMaterial({color:C.asphalt});
  const roadMesh = new THREE.Mesh(roadGeo, roadMat);
  roadMesh.rotation.x = -Math.PI/2;
  roadMesh.position.y = 0.06;
  roadMesh.receiveShadow = true;
  scene.add(roadMesh);

  // Center green park - raised mound
  const parkGeo = new THREE.CylinderGeometry(ROTARY_INNER-2, ROTARY_INNER, 1.5, 32);
  const parkMat = new THREE.MeshLambertMaterial({color:C.median});
  const park = new THREE.Mesh(parkGeo, parkMat);
  park.position.set(0, 0.75, 0);
  park.receiveShadow = true;
  scene.add(park);

  // Small pond
  const pondGeo = new THREE.CylinderGeometry(3, 3, 0.1, 24);
  const pondMat = new THREE.MeshLambertMaterial({color:C.water, transparent:true, opacity:0.7});
  const pond = new THREE.Mesh(pondGeo, pondMat);
  pond.position.set(0, 1.55, 0);
  scene.add(pond);

  // Flag pole
  scene.add(cyl(0.06, 8, 0x888888, 0, 1.5, 0, 6));
  // Flag
  const flag = box(1.5, 0.8, 0.02, 0xcc0000, 0.75, 10.5, 0);
  scene.add(flag);

  // Outer sidewalk ring
  const outerSW = new THREE.RingGeometry(ROTARY_R, ROTARY_R+4, 48);
  const outerMat = new THREE.MeshLambertMaterial({color:C.sidewalk});
  const outerMesh = new THREE.Mesh(outerSW, outerMat);
  outerMesh.rotation.x = -Math.PI/2;
  outerMesh.position.y = 0.07;
  scene.add(outerMesh);

  // Trees around rotary
  for(let i=0; i<12; i++){
    const a = (i/12)*Math.PI*2;
    createTree(Math.cos(a)*16, Math.sin(a)*16, i%2===0?'sakura':'ginkgo');
  }
}

// --- Former Station Building (旧国立駅舎) ---
function buildStation(){
  const sx=0, sz=38;
  const g = new THREE.Group();

  // Main body - white walls
  g.add(box(20, 6, 10, C.stationWall, 0, 3, 0));

  // Triangular roof (asymmetric - west slope longer)
  const roofShape = new THREE.Shape();
  roofShape.moveTo(-11, 0);
  roofShape.lineTo(2, 6); // peak offset to east (asymmetric)
  roofShape.lineTo(11, 0);
  roofShape.closePath();
  const roofGeo = new THREE.ExtrudeGeometry(roofShape, {depth:11, bevelEnabled:false});
  const roofMat = new THREE.MeshLambertMaterial({color:C.stationRoof});
  const roof = new THREE.Mesh(roofGeo, roofMat);
  roof.rotation.x = Math.PI/2;
  roof.position.set(0, 6, 5.5);
  roof.castShadow = true;
  g.add(roof);

  // Front columns (4 pillars made from old rail steel)
  for(let i=0; i<4; i++){
    const cx = -7.5 + i*5;
    g.add(cyl(0.15, 5, 0x555555, cx, 0, -5.2, 8));
  }

  // Windows - arched rectangles on front
  for(let i=0; i<5; i++){
    const wx = -8 + i*4;
    g.add(box(1.5, 2.5, 0.1, 0x6688aa, wx, 3.5, -5.05));
    // Arch top
    const archGeo = new THREE.CircleGeometry(0.75, 12, 0, Math.PI);
    const archMat = new THREE.MeshLambertMaterial({color:0x6688aa});
    const arch = new THREE.Mesh(archGeo, archMat);
    arch.position.set(wx, 4.75, -5.04);
    g.add(arch);
  }
  // Windows on back
  for(let i=0; i<5; i++){
    const wx = -8 + i*4;
    g.add(box(1.5, 2.5, 0.1, 0x6688aa, wx, 3.5, 5.05));
  }

  // Dormer windows on roof
  for(let i=0; i<3; i++){
    const dx = -5 + i*5;
    const dormer = box(1.5, 1.5, 1.5, C.stationWall, dx, 8, -2);
    g.add(dormer);
    // Small triangle on dormer
    const ds = new THREE.Shape();
    ds.moveTo(-1, 0); ds.lineTo(0, 1); ds.lineTo(1, 0); ds.closePath();
    const dg = new THREE.ExtrudeGeometry(ds, {depth:0.3, bevelEnabled:false});
    const dm = new THREE.Mesh(dg, new THREE.MeshLambertMaterial({color:C.stationRoof}));
    dm.position.set(dx, 8.75, -2.65);
    g.add(dm);
  }

  // Entrance door
  g.add(box(2.5, 3, 0.15, 0x5a3a1a, 0, 1.5, -5.1));

  // Sign
  g.add(box(6, 0.8, 0.1, 0xffffff, 0, 5.8, -5.1));

  g.position.set(sx, 0, sz);
  g.castShadow = true;
  scene.add(g);
  landmarks.station = g;
}

// --- Elevated Railway (JR中央線高架) ---
function buildRailway(){
  const trackZ = 48;
  const deckW = 12, deckH = 0.8;
  const pillarH = 7, pillarW = 1.5;
  const extent = 500; // 500m each direction

  // Main deck
  scene.add(box(extent*2, deckH, deckW, C.concrete, 0, pillarH+deckH/2, trackZ));

  // Guard walls
  scene.add(box(extent*2, 1.5, 0.3, C.concrete, 0, pillarH+deckH+0.75, trackZ-deckW/2));
  scene.add(box(extent*2, 1.5, 0.3, C.concrete, 0, pillarH+deckH+0.75, trackZ+deckW/2));

  // Rails (2 tracks = 4 rails)
  const railY = pillarH+deckH+0.05;
  [-2.5, -1.1, 1.1, 2.5].forEach(offset=>{
    scene.add(box(extent*2, 0.1, 0.1, C.rail, 0, railY, trackZ+offset));
  });

  // Pillars
  for(let x=-extent; x<=extent; x+=15){
    scene.add(box(pillarW, pillarH, pillarW, C.concrete, x, pillarH/2, trackZ-3));
    scene.add(box(pillarW, pillarH, pillarW, C.concrete, x, pillarH/2, trackZ+3));
    // Cross beam
    scene.add(box(1, 1, 8, C.concrete, x, pillarH-0.5, trackZ));
  }
}

// --- nonowa Commercial Area ---
function buildNonowa(){
  const trackZ = 48;
  const shopColors = [C.white, C.cream, 0xf0f0f0, 0xe8e8e8, 0xfff8f0];

  // Shops under/along tracks - south side
  for(let x=-80; x<80; x+=10){
    const c = randPick(shopColors);
    const shop = box(8, 4, 8, c, x, 2, trackZ-10);
    scene.add(shop);
    // Glass front
    scene.add(box(7, 2.5, 0.1, C.glass, x, 2.5, trackZ-14.05));
    // Shop sign
    const signC = randPick([C.sign1, C.sign2, C.sign3, 0x27ae60, 0x8e44ad]);
    scene.add(box(4, 0.6, 0.12, signC, x, 4.2, trackZ-14.1));
  }
  // North side
  for(let x=-60; x<60; x+=12){
    const c = randPick(shopColors);
    scene.add(box(10, 4, 7, c, x, 2, trackZ+10));
    scene.add(box(9, 2.5, 0.1, C.glass, x, 2.5, trackZ+13.55));
    const signC = randPick([C.sign1, C.sign2, C.sign3]);
    scene.add(box(5, 0.6, 0.12, signC, x, 4.2, trackZ+13.6));
  }

  // nonowa SOUTH (4-story wood building near station)
  const nS = box(25, 14, 18, 0xd4c4a8, -18, 7, 25);
  scene.add(nS);
  // Window grid
  for(let floor=0;floor<4;floor++){
    for(let i=0;i<6;i++){
      scene.add(box(2.5,2,0.1, C.glass, -28+i*4.5, 2.5+floor*3.5, 25-9.05));
      scene.add(box(2.5,2,0.1, C.glass, -28+i*4.5, 2.5+floor*3.5, 25+9.05));
    }
  }
}

// --- Trees ---
function createTree(x, z, type){
  const g = new THREE.Group();
  if(type === 'sakura'){
    // Cherry blossom
    g.add(cyl(0.15, 4, C.trunk, 0, 0, 0, 6));
    // Canopy - cluster of spheres (pink)
    const canopyMat = new THREE.MeshLambertMaterial({color: C.sakura});
    for(let i=0;i<5;i++){
      const s = new THREE.Mesh(new THREE.SphereGeometry(rand(1.5,2.5),6,5), canopyMat);
      s.position.set(rand(-1.5,1.5), rand(5,7), rand(-1.5,1.5));
      s.castShadow=true;
      g.add(s);
    }
  } else {
    // Ginkgo - tall conical
    g.add(cyl(0.2, 6, C.trunk, 0, 0, 0, 6));
    const coneH = rand(12,16);
    const coneGeo = new THREE.ConeGeometry(rand(3,4.5), coneH, 7);
    const coneMat = new THREE.MeshLambertMaterial({color: C.ginkgo});
    const cone = new THREE.Mesh(coneGeo, coneMat);
    cone.position.y = 6 + coneH/2;
    cone.castShadow = true;
    g.add(cone);
  }
  g.position.set(x, 0, z);
  scene.add(g);
  return g;
}

function plantTrees(){
  // Daigaku-dori median trees - alternating sakura/ginkgo every 8m
  for(let z=-20; z>-1280; z-=8){
    const type = (Math.abs(z)%16<8) ? 'sakura' : 'ginkgo';
    createTree(rand(-3,3), z, type);
  }
  // Sidewalk trees (west side)
  for(let z=-30; z>-1200; z-=15){
    createTree(-(MEDIAN_W/2+ROAD_W/2+SIDEWALK_W+2), z, randPick(['sakura','ginkgo']));
  }
  // Sidewalk trees (east side)
  for(let z=-30; z>-1200; z-=15){
    createTree((MEDIAN_W/2+ROAD_W/2+SIDEWALK_W+2), z, randPick(['sakura','ginkgo']));
  }
  // Rotary area extra trees
  for(let i=0;i<8;i++){
    const a = rand(0,Math.PI*2);
    createTree(Math.cos(a)*rand(35,50), Math.sin(a)*rand(35,50)+5, 'sakura');
  }
}

// --- Street Lamps (French-style) ---
function buildStreetLamps(){
  // Along Daigaku-dori both sides
  const positions = [];
  for(let z=-20; z>-1250; z-=25){
    positions.push([-(MEDIAN_W/2+ROAD_W/2+1), z]);
    positions.push([(MEDIAN_W/2+ROAD_W/2+1), z]);
  }
  positions.forEach(([x,z])=>{
    // Pole
    scene.add(cyl(0.05, 5, C.lamp, x, 0, z, 6));
    // Ornate top - arm
    scene.add(box(0.8, 0.05, 0.05, C.lamp, x+0.4, 5, z));
    // Lamp housing
    const lampGeo = new THREE.SphereGeometry(0.2, 6, 5);
    const lampMat = new THREE.MeshBasicMaterial({color: C.warmLight});
    const lamp = new THREE.Mesh(lampGeo, lampMat);
    lamp.position.set(x+0.8, 5, z);
    scene.add(lamp);
    // Second arm (opposite)
    scene.add(box(0.8, 0.05, 0.05, C.lamp, x-0.4, 5, z));
    const lamp2 = lamp.clone();
    lamp2.position.set(x-0.8, 5, z);
    scene.add(lamp2);
  });

  // Add actual point lights only for nearby lamps (performance)
  // We'll update these dynamically in the render loop
}

// --- Buildings Along Streets ---
function generateBuildings(){
  const bColors = [C.white, C.cream, C.beige, 0xf0e6d0, 0xe0d8c8, 0xf5efe5, 0xd8cfc0, 0xefe8dc];
  const shopColors = [0xcc9966, 0x887766, 0x998877, 0xaa8866, 0x776655];

  // West side of Daigaku-dori
  let zPos = -25;
  while(zPos > -1250){
    const w = rand(10,22), d = rand(10,16), h = rand(8,16);
    const floors = Math.round(h/3.5);
    const bx = -(MEDIAN_W/2+ROAD_W/2+SIDEWALK_W+d/2+2+ROAD_W/2);

    const bGroup = new THREE.Group();
    // Main body
    const body = box(w, h, d, randPick(bColors), 0, h/2, 0);
    bGroup.add(body);
    // Ground floor shop front (darker)
    bGroup.add(box(w+0.1, 4, 0.2, randPick(shopColors), 0, 2, d/2+0.1));
    // Windows
    const winPerFloor = Math.floor(w/3);
    for(let f=0; f<floors; f++){
      for(let wi=0; wi<winPerFloor; wi++){
        const wx = -(w/2) + 2 + wi*(w-2)/winPerFloor;
        bGroup.add(box(1.2, 1.8, 0.12, 0x88aacc, wx, 2.5+f*3.5, d/2+0.12));
        bGroup.add(box(1.2, 1.8, 0.12, 0x88aacc, wx, 2.5+f*3.5, -d/2-0.12));
      }
    }
    // Awning (some buildings)
    if(Math.random()>0.5){
      const awning = box(w*0.8, 0.05, 2, randPick([C.sign1,C.sign2,C.sign3,0x27ae60]), 0, 3.8, d/2+1);
      awning.rotation.x = 0.2;
      bGroup.add(awning);
    }
    // Flat roof or slight pitch
    if(Math.random()>0.6){
      bGroup.add(box(w+0.5, 0.3, d+0.5, 0x777777, 0, h+0.15, 0));
    }

    bGroup.position.set(bx, 0, zPos);
    scene.add(bGroup);
    buildings.push({pos:[bx,0,zPos], w, d, h});
    zPos -= w + rand(1,4);
  }

  // East side of Daigaku-dori
  zPos = -25;
  while(zPos > -1250){
    const w = rand(10,22), d = rand(10,16), h = rand(8,16);
    const floors = Math.round(h/3.5);
    const bx = (MEDIAN_W/2+ROAD_W/2+SIDEWALK_W+d/2+2+ROAD_W/2);

    const bGroup = new THREE.Group();
    bGroup.add(box(w, h, d, randPick(bColors), 0, h/2, 0));
    bGroup.add(box(w+0.1, 4, 0.2, randPick(shopColors), 0, 2, -d/2-0.1));
    const winPerFloor = Math.floor(w/3);
    for(let f=0; f<floors; f++){
      for(let wi=0; wi<winPerFloor; wi++){
        const wx = -(w/2) + 2 + wi*(w-2)/winPerFloor;
        bGroup.add(box(1.2, 1.8, 0.12, 0x88aacc, wx, 2.5+f*3.5, d/2+0.12));
        bGroup.add(box(1.2, 1.8, 0.12, 0x88aacc, wx, 2.5+f*3.5, -d/2-0.12));
      }
    }
    if(Math.random()>0.5){
      bGroup.add(box(w*0.8, 0.05, 2, randPick([C.sign1,C.sign2,C.sign3]), 0, 3.8, -d/2-1));
    }
    bGroup.position.set(bx, 0, zPos);
    scene.add(bGroup);
    buildings.push({pos:[bx,0,zPos], w, d, h});
    zPos -= w + rand(1,4);
  }

  // Buildings along cross streets
  for(let z=-100; z>-1000; z-=120){
    for(let side=-1; side<=1; side+=2){
      for(let x=50; x<280; x+=rand(15,25)){
        const w=rand(8,15), d=rand(8,12), h=rand(7,12);
        const b = box(w,h,d, randPick(bColors), side*x, h/2, z+rand(-20,20));
        scene.add(b);
        buildings.push({pos:[side*x,0,z], w, d, h});
      }
    }
  }
}

// --- Hitotsubashi University (一橋大学) ---
function buildUniversity(){
  const uZ = -650; // ~650m south

  // Campus wall (west side)
  scene.add(box(200, 1.5, 0.4, 0x999988, -80, 0.75, uZ));
  scene.add(box(0.4, 1.5, 300, 0x999988, -180, 0.75, uZ));
  // Campus wall (east side)
  scene.add(box(180, 1.5, 0.4, 0x999988, 80, 0.75, uZ));
  scene.add(box(0.4, 1.5, 280, 0x999988, 170, 0.75, uZ));

  // Main gate - west campus (stone pillars)
  const gateX = -30, gateZ = uZ + 150;
  scene.add(box(2.5, 3.5, 2.5, 0x888877, gateX-4, 1.75, gateZ));
  scene.add(box(2.5, 3.5, 2.5, 0x888877, gateX+4, 1.75, gateZ));
  // Gate cap stones
  scene.add(box(3, 0.4, 3, 0x777766, gateX-4, 3.7, gateZ));
  scene.add(box(3, 0.4, 3, 0x777766, gateX+4, 3.7, gateZ));
  // Gate iron fence
  scene.add(box(4, 2.5, 0.1, 0x444444, gateX, 1.25, gateZ));

  // East campus gate
  scene.add(box(2.5, 3.5, 2.5, 0x888877, 30, 1.75, gateZ));
  scene.add(box(2.5, 3.5, 2.5, 0x888877, 38, 1.75, gateZ));

  // === Kanematu Auditorium (兼松講堂) - Romanesque ===
  const kx = -70, kz = uZ - 50;
  const kGroup = new THREE.Group();

  // Main hall body
  kGroup.add(box(40, 15, 20, C.brick, 0, 7.5, 0));

  // Tower on east end
  kGroup.add(box(8, 25, 8, C.brick, 20, 12.5, 0));
  // Tower cap
  const towerCap = new THREE.Mesh(
    new THREE.ConeGeometry(5, 5, 4),
    new THREE.MeshLambertMaterial({color: 0x5a3a2a})
  );
  towerCap.position.set(20, 27.5, 0);
  kGroup.add(towerCap);

  // Arched windows on facade
  for(let i=0; i<8; i++){
    const wx = -16 + i*4;
    kGroup.add(box(2, 4, 0.15, 0x556644, wx, 8, -10.1));
    const archGeo = new THREE.CircleGeometry(1, 10, 0, Math.PI);
    const archMesh = new THREE.Mesh(archGeo, new THREE.MeshLambertMaterial({color:0x556644}));
    archMesh.position.set(wx, 10, -10.08);
    kGroup.add(archMesh);
  }

  // Arched entrance
  kGroup.add(box(5, 6, 1, 0x443322, 0, 3, -10.5));
  const entrArch = new THREE.Mesh(
    new THREE.CircleGeometry(2.5, 12, 0, Math.PI),
    new THREE.MeshLambertMaterial({color:0x443322})
  );
  entrArch.position.set(0, 6, -10.48);
  kGroup.add(entrArch);

  // Romanesque decorative elements - stone base
  kGroup.add(box(42, 2, 22, 0x888877, 0, 1, 0));

  kGroup.position.set(kx, 0, kz);
  scene.add(kGroup);
  landmarks.kanematu = kGroup;

  // Other campus buildings
  const campusBuildings = [
    {x:-100, z:uZ-100, w:30, h:12, d:20},
    {x:-50, z:uZ-150, w:25, h:10, d:15},
    {x:-130, z:uZ-30, w:35, h:11, d:18},
    {x:60, z:uZ-50, w:28, h:12, d:20},
    {x:90, z:uZ-120, w:32, h:10, d:22},
    {x:50, z:uZ-180, w:25, h:11, d:16},
    {x:120, z:uZ-80, w:30, h:9, d:18},
  ];
  campusBuildings.forEach(b=>{
    scene.add(box(b.w, b.h, b.d, 0xc8b898, b.x, b.h/2, b.z));
    // Windows
    for(let f=0;f<3;f++){
      for(let wi=0;wi<Math.floor(b.w/4);wi++){
        scene.add(box(1.5,1.8,0.12, 0x88aacc, b.x-b.w/2+2+wi*4, 2.5+f*3.5, b.z+b.d/2+0.1));
      }
    }
  });

  // Green spaces and campus trees
  for(let i=0; i<30; i++){
    createTree(-180+rand(0,160), uZ+rand(-200,100), randPick(['sakura','ginkgo']));
  }
  for(let i=0; i<25; i++){
    createTree(30+rand(0,140), uZ+rand(-200,100), randPick(['sakura','ginkgo']));
  }

  // Campus paths
  scene.add(box(3, 0.08, 200, C.sidewalk, -70, 0.04, uZ-50));
  scene.add(box(3, 0.08, 200, C.sidewalk, 70, 0.04, uZ-50));
  scene.add(box(100, 0.08, 3, C.sidewalk, -80, 0.04, uZ));
  scene.add(box(100, 0.08, 3, C.sidewalk, 80, 0.04, uZ));
}

// --- Controls ---
function setupControls(){
  const canvas = renderer.domElement;

  canvas.addEventListener('click', ()=>{
    canvas.requestPointerLock();
  });
  document.addEventListener('pointerlockchange', ()=>{
    pointerLocked = !!document.pointerLockElement;
  });
  document.addEventListener('mousemove', (e)=>{
    if(!pointerLocked) return;
    yaw -= e.movementX * 0.002;
    pitch -= e.movementY * 0.002;
    pitch = Math.max(-Math.PI/2+0.1, Math.min(Math.PI/2-0.1, pitch));
  });

  document.addEventListener('keydown', (e)=>{
    switch(e.code){
      case 'KeyW': moveState.f=1; break;
      case 'KeyS': moveState.b=1; break;
      case 'KeyA': moveState.l=1; break;
      case 'KeyD': moveState.r=1; break;
      case 'ShiftLeft': case 'ShiftRight': moveState.run=true; break;
      case 'Space':
        if(onGround){ velocity.y=JUMP_V; onGround=false; }
        e.preventDefault(); break;
      case 'KeyE': // Teleport
        teleportIdx = (teleportIdx+1) % LANDMARKS.length;
        const lm = LANDMARKS[teleportIdx];
        camera.position.set(...lm.pos);
        velocity.set(0,0,0);
        break;
      case 'KeyT': // Time of day
        timeOfDay = (timeOfDay+1)%4;
        updateLighting();
        break;
      case 'KeyM': // Toggle minimap
        document.getElementById('minimap').style.display =
          document.getElementById('minimap').style.display==='none'?'block':'none';
        break;
    }
  });
  document.addEventListener('keyup', (e)=>{
    switch(e.code){
      case 'KeyW': moveState.f=0; break;
      case 'KeyS': moveState.b=0; break;
      case 'KeyA': moveState.l=0; break;
      case 'KeyD': moveState.r=0; break;
      case 'ShiftLeft': case 'ShiftRight': moveState.run=false; break;
    }
  });
}

function updateMovement(dt){
  const speed = moveState.run ? RUN_SPEED : WALK_SPEED;
  const dir = new THREE.Vector3();
  const forward = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
  const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));

  if(moveState.f) dir.add(forward);
  if(moveState.b) dir.sub(forward);
  if(moveState.r) dir.add(right);
  if(moveState.l) dir.sub(right);
  if(dir.length()>0) dir.normalize();

  camera.position.x += dir.x * speed * dt;
  camera.position.z += dir.z * speed * dt;

  // Gravity & jump
  velocity.y += GRAVITY * dt;
  camera.position.y += velocity.y * dt;
  if(camera.position.y <= CAM_H){
    camera.position.y = CAM_H;
    velocity.y = 0;
    onGround = true;
  }

  // Apply camera rotation
  camera.rotation.order = 'YXZ';
  camera.rotation.y = yaw;
  camera.rotation.x = pitch;
}

// --- HUD Updates ---
function updateHUD(){
  // Nearest landmark
  let nearest = LANDMARKS[0], minDist = Infinity;
  LANDMARKS.forEach(lm=>{
    const dx = camera.position.x-lm.pos[0], dz=camera.position.z-lm.pos[2];
    const dist = Math.sqrt(dx*dx+dz*dz);
    if(dist<minDist){minDist=dist; nearest=lm;}
  });
  document.getElementById('info').textContent = nearest.name + ' (' + Math.round(minDist) + 'm)';

  // Location
  const lat = 35.6839 + camera.position.z * -0.000009;
  const lng = 139.4436 + camera.position.x * 0.000011;
  document.getElementById('location').textContent =
    lat.toFixed(4) + '°N, ' + lng.toFixed(4) + '°E';

  // FPS
  frameCount++;
  const now = performance.now();
  if(now - fpsTime > 500){
    document.getElementById('fps').textContent = Math.round(frameCount/((now-fpsTime)/1000)) + ' FPS';
    frameCount=0; fpsTime=now;
  }
}

function drawMinimap(){
  if(!minimapCtx) return;
  const w=360, h=360;
  minimapCtx.fillStyle='#1a2a1a';
  minimapCtx.fillRect(0,0,w,h);

  const scale = w/800; // 800m range
  const cx=w/2, cy=h/2;
  const px=camera.position.x, pz=camera.position.z;

  // Draw roads
  minimapCtx.strokeStyle='#555';
  minimapCtx.lineWidth=2;
  // Daigaku-dori
  const dsx = cx + (0-px)*scale, dsy1 = cy + (0-pz)*scale, dsy2 = cy + (-1300-pz)*scale;
  minimapCtx.beginPath();
  minimapCtx.moveTo(dsx, dsy1);
  minimapCtx.lineTo(dsx, dsy2);
  minimapCtx.stroke();

  // Fujimi-dori
  minimapCtx.beginPath();
  minimapCtx.moveTo(dsx, dsy1);
  minimapCtx.lineTo(dsx + Math.sin(-Math.PI*0.75)*800*scale, dsy1 + Math.cos(-Math.PI*0.75)*800*scale);
  minimapCtx.stroke();

  // Asahi-dori
  minimapCtx.beginPath();
  minimapCtx.moveTo(dsx, dsy1);
  minimapCtx.lineTo(dsx + Math.sin(Math.PI*0.75)*500*scale, dsy1 + Math.cos(Math.PI*0.75)*500*scale);
  minimapCtx.stroke();

  // Railway
  minimapCtx.strokeStyle='#888';
  minimapCtx.lineWidth=3;
  minimapCtx.beginPath();
  minimapCtx.moveTo(cx+(-500-px)*scale, cy+(48-pz)*scale);
  minimapCtx.lineTo(cx+(500-px)*scale, cy+(48-pz)*scale);
  minimapCtx.stroke();

  // Buildings
  minimapCtx.fillStyle='#555';
  buildings.forEach(b=>{
    const bx = cx + (b.pos[0]-px)*scale - b.w*scale/2;
    const bz = cy + (b.pos[2]-pz)*scale - b.d*scale/2;
    if(bx>-50&&bx<w+50&&bz>-50&&bz<h+50){
      minimapCtx.fillRect(bx, bz, b.w*scale, (b.d||10)*scale);
    }
  });

  // Player dot
  minimapCtx.fillStyle='#f44';
  minimapCtx.beginPath();
  minimapCtx.arc(cx, cy, 4, 0, Math.PI*2);
  minimapCtx.fill();

  // Direction line
  minimapCtx.strokeStyle='#f44';
  minimapCtx.lineWidth=2;
  minimapCtx.beginPath();
  minimapCtx.moveTo(cx, cy);
  minimapCtx.lineTo(cx - Math.sin(yaw)*20, cy - Math.cos(yaw)*20);
  minimapCtx.stroke();
}

function drawCompass(){
  if(!compassCtx) return;
  const w=160, h=160, cx=w/2, cy=h/2, r=55;
  compassCtx.clearRect(0,0,w,h);

  // Circle
  compassCtx.strokeStyle='rgba(255,255,255,0.3)';
  compassCtx.lineWidth=2;
  compassCtx.beginPath();
  compassCtx.arc(cx,cy,r,0,Math.PI*2);
  compassCtx.stroke();

  // Cardinal directions
  const dirs = [{l:'N',a:0,c:'#f44'},{l:'E',a:Math.PI/2,c:'#fff'},{l:'S',a:Math.PI,c:'#fff'},{l:'W',a:-Math.PI/2,c:'#fff'}];
  compassCtx.font='bold 14px sans-serif';
  compassCtx.textAlign='center';
  compassCtx.textBaseline='middle';
  dirs.forEach(d=>{
    const a = d.a + yaw;
    const x = cx + Math.sin(a)*r*0.8;
    const y = cy - Math.cos(a)*r*0.8;
    compassCtx.fillStyle=d.c;
    compassCtx.fillText(d.l, x, y);
  });

  // Needle
  compassCtx.strokeStyle='#f44';
  compassCtx.lineWidth=2;
  compassCtx.beginPath();
  compassCtx.moveTo(cx, cy);
  compassCtx.lineTo(cx+Math.sin(yaw)*r*0.6, cy-Math.cos(yaw)*r*0.6);
  compassCtx.stroke();
}

// --- Main Loop ---
function animate(){
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);

  updateMovement(dt);
  updateHUD();
  drawMinimap();
  drawCompass();

  renderer.render(scene, camera);
}

// --- Build Scene Progressively ---
async function buildScene(onProgress){
  const steps = [
    {name:'地形を生成中...', fn:buildGround},
    {name:'ロータリーを構築中...', fn:buildRotary},
    {name:'旧国立駅舎を建設中...', fn:buildStation},
    {name:'JR中央線高架を建設中...', fn:buildRailway},
    {name:'nonowa国立を構築中...', fn:buildNonowa},
    {name:'建物を配置中...', fn:generateBuildings},
    {name:'並木道を植樹中...', fn:plantTrees},
    {name:'街灯を設置中...', fn:buildStreetLamps},
    {name:'一橋大学を建設中...', fn:buildUniversity},
  ];
  for(let i=0; i<steps.length; i++){
    onProgress((i+1)/steps.length, steps[i].name);
    steps[i].fn();
    await new Promise(r=>setTimeout(r, 80));
  }
}

// --- Start ---
function init(){
  const startBtn = document.getElementById('startBtn');
  const startScreen = document.getElementById('startScreen');
  const loading = document.getElementById('loading');
  const loadFill = document.getElementById('loadFill');

  minimapCtx = document.getElementById('minimapCanvas').getContext('2d');
  compassCtx = document.getElementById('compassCanvas').getContext('2d');

  startBtn.addEventListener('click', async ()=>{
    startScreen.style.display = 'none';
    loading.style.display = 'flex';

    initScene();

    await buildScene((pct, label)=>{
      loadFill.style.width = (pct*100)+'%';
      loading.querySelector('div').textContent = label;
    });

    loading.style.display = 'none';
    document.getElementById('hud').style.display = 'block';

    setupControls();
    renderer.domElement.click(); // Request pointer lock

    fpsTime = performance.now();
    animate();
  });
}

// Wait for DOM
if(document.readyState==='loading'){
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

})();

/* =============================================================================
   ashline/art/check.js — アートモジュールの実行検証ハーネス
   使い方:  node ashline/art/check.js <モジュール名>
            例)  node ashline/art/check.js tex

   実際に Chromium で読み込み、契約どおりの戻り値か・性能予算内かを判定し、
   shots/art/<名前>.png にテスト描画を出す。fps は測れない（GPU非搭載）。
   ========================================================================== */
process.env.NODE_PATH = process.env.NODE_PATH || '/opt/node22/lib/node_modules';
require('module').Module._initPaths();

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const ART = __dirname;
const ROOT = path.resolve(ART, '..', '..');
const SHOT = path.join(ROOT, 'shots', 'art');
fs.mkdirSync(SHOT, { recursive: true });

const NAME = process.argv[2];
if (!NAME) { console.error('使い方: node ashline/art/check.js <モジュール名>'); process.exit(2); }
const FILE = path.join(ART, NAME + '.js');
if (!fs.existsSync(FILE)) { console.error('見つからない: ' + FILE); process.exit(2); }

let pass = 0, fail = 0;
function check(label, ok, detail) {
  if (ok) pass++; else fail++;
  console.log((ok ? '  PASS  ' : '  FAIL  ') + label + (detail !== undefined ? '   [' + detail + ']' : ''));
}

/* --- 静的検査：外部リソース・生の16進色・禁止語 ---------------------------- */
const src = fs.readFileSync(FILE, 'utf8');
const stripped = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const NET = [/\bfetch\s*\(/, /XMLHttpRequest/, /\bimport\s*\(/, /^\s*import\s/m,
  /https?:\/\//, /\.load\s*\(\s*['"]/, /TextureLoader/, /AudioLoader/, /GLTFLoader/];
const netHit = NET.filter(re => re.test(stripped));
check('外部リソースを読み込んでいない', netHit.length === 0, netHit.map(String).join(' ') || 'なし');

const BANNED = /(lancer|locust|marcus|fenix|\bcog\b|gears of war|delta squad|gnasher|hammerburst|boomshot|retro lancer|sera\b)/i;
check('参照の境界：既存作品の固有名詞を含まない', !BANNED.test(src), (src.match(BANNED) || ['なし'])[0]);

const hexes = (stripped.match(/0x[0-9a-fA-F]{6}\b/g) || []);
check('生の16進カラーを直書きしていない（色はASH.paletteから）',
  NAME === 'palette' || hexes.length === 0, hexes.slice(0, 6).join(' ') || 'なし');

const es6 = [/=>/, /^\s*(const|let)\s/m, /\bclass\s+\w+/, /`[^`]*\$\{/];
const es6Hit = es6.filter(re => re.test(stripped));
check('ES5で書かれている（既存コードと揃える）', es6Hit.length === 0, es6Hit.map(String).join(' ') || 'なし');

/* --- 各モジュールのテストシーン -------------------------------------------- */
/* 各エントリ: { setup: ブラウザ内で走る関数の文字列, needScene: bool } */
const SCENES = {
  tex: `
    var t = ASH.tex(T), need = ['concrete','concreteBump','plaster','stone','brick','metal','rust',
      'ground','groundBump','cloth','grime','noise','decalHole','decalScorch'];
    var missing = [], px = 0;
    for (var i=0;i<need.length;i++){
      var m = t[need[i]];
      if (!m || !m.isTexture) { missing.push(need[i]); continue; }
      var im = m.image; px += (im.width||0)*(im.height||0);
    }
    R.missing = missing; R.pixels = px; R.count = need.length;
    R.maxSide = 0;
    for (var k in t) if (t[k] && t[k].image) R.maxSide = Math.max(R.maxSide, t[k].image.width, t[k].image.height);
    // 見本板：各テクスチャを平面に貼って並べる
    var n = 0;
    for (var j=0;j<need.length;j++){
      var tex = t[need[j]]; if (!tex) continue;
      var q = new T.Mesh(new T.PlaneGeometry(1.6,1.6),
        new T.MeshBasicMaterial({map:tex, transparent:true}));
      q.position.set((n%5)*1.8-3.6, 1.2-Math.floor(n/5)*1.8, 0); n++;
      scene.add(q);
    }
    camera.position.set(0,-0.6,7.2); camera.lookAt(0,-0.6,0);
    scene.add(new T.AmbientLight(0xffffff,1));
  `,
  sky: `
    var s = ASH.sky(T, scene);
    R.hasMesh = !!s.mesh; R.hasUpdate = typeof s.update === 'function';
    R.fog = !!scene.fog;
    if (s.update) s.update(0.016, camera);
    var g = new T.Mesh(new T.PlaneGeometry(60,60), new T.MeshLambertMaterial({color:0x5c5449}));
    g.rotation.x = -Math.PI/2; scene.add(g);
    for (var i=0;i<5;i++){
      var b = new T.Mesh(new T.BoxGeometry(1.2,2.2,1.2), new T.MeshLambertMaterial({color:0x8a8177}));
      b.position.set(-6+i*3, 1.1, -8); scene.add(b);
    }
    scene.add(new T.HemisphereLight(0x7f95ad,0x40372c,0.6));
    var d = new T.DirectionalLight(0xffdcb0, 2.0); d.position.set(-12,7,-13); scene.add(d);
    camera.position.set(0,1.7,7); camera.lookAt(0,1.4,-8);
  `,
  light: `
    var L = ASH.light(T, scene);
    R.hasSun = !!(L.sun && L.sun.isDirectionalLight);
    R.castsShadow = !!(L.sun && L.sun.castShadow);
    R.mapSize = L.sun && L.sun.shadow ? L.sun.shadow.mapSize.x : 0;
    R.hasRim = typeof L.applyRim === 'function';
    var shadowLights = 0;
    scene.traverse(function(o){ if (o.isLight && o.castShadow) shadowLights++; });
    R.shadowLights = shadowLights;
    var gm = new T.MeshLambertMaterial({color:0x5c5449});
    if (L.applyRim) L.applyRim(gm);
    var g = new T.Mesh(new T.PlaneGeometry(50,50), gm);
    g.rotation.x = -Math.PI/2; g.receiveShadow = true; scene.add(g);
    for (var i=0;i<4;i++){
      var mm = new T.MeshLambertMaterial({color:0x9a9184});
      if (L.applyRim) L.applyRim(mm);
      var b = new T.Mesh(new T.BoxGeometry(1.4,2.0,1.4), mm);
      b.position.set(-5+i*3.4, 1.0, -6); b.castShadow = true; b.receiveShadow = true; scene.add(b);
    }
    camera.position.set(0,2.0,6); camera.lookAt(0,1.2,-6);
  `,
  post: `
    var g2 = new T.Mesh(new T.PlaneGeometry(50,50), new T.MeshLambertMaterial({color:0x5c5449}));
    g2.rotation.x = -Math.PI/2; scene.add(g2);
    for (var i=0;i<4;i++){
      var b = new T.Mesh(new T.BoxGeometry(1.4,2.0,1.4), new T.MeshLambertMaterial({color:0x9a9184}));
      b.position.set(-5+i*3.4, 1.0, -6); scene.add(b);
    }
    var glow = new T.Mesh(new T.SphereGeometry(0.35,10,8), new T.MeshBasicMaterial({color:0xffa03c}));
    glow.position.set(0.6,1.4,-3.2); scene.add(glow);
    scene.add(new T.HemisphereLight(0x7f95ad,0x40372c,0.6));
    var d2 = new T.DirectionalLight(0xffdcb0, 2.0); d2.position.set(-12,7,-13); scene.add(d2);
    camera.position.set(0,1.8,5); camera.lookAt(0,1.2,-6);
    var post = ASH.post(T, renderer, scene, camera);
    R.hasRender = typeof post.render === 'function';
    R.hasSetSize = typeof post.setSize === 'function';
    POST = post;
  `,
  env: `
    var grp = ASH.env(T, MATS, COVERS, ARENA);
    R.isGroup = !!(grp && grp.isObject3D);
    scene.add(grp);
    // 遮蔽の当たり判定箱をワイヤで重ねる：見た目が箱から外れていないか目視できる
    for (var i=0;i<COVERS.length;i++){
      var c = COVERS[i];
      var w = new T.Mesh(new T.BoxGeometry(c.hx*2, c.h, c.hz*2),
        new T.MeshBasicMaterial({color:0x00ff88, wireframe:true, transparent:true, opacity:0.35}));
      w.position.set(c.x, c.h/2, c.z); scene.add(w);
    }
    LIGHTS();
    camera.position.set(6.5,3.4,12); camera.lookAt(0,1.0,-3);
  `,
  debris: `
    var grp = ASH.debris(T, MATS, ARENA, COVERS);
    R.isGroup = !!(grp && grp.isObject3D);
    scene.add(grp);
    var maxY = 0;
    grp.traverse(function(o){
      if (!o.geometry) return;
      o.geometry.computeBoundingBox();
      var bb = o.geometry.boundingBox;
      var s = o.getWorldScale(new T.Vector3());
      maxY = Math.max(maxY, Math.abs(bb.max.y * s.y) + Math.abs(o.position.y));
    });
    R.maxY = maxY;
    var g3 = new T.Mesh(new T.PlaneGeometry(30,30), new T.MeshLambertMaterial({color:0x5c5449}));
    g3.rotation.x = -Math.PI/2; scene.add(g3);
    LIGHTS();
    camera.position.set(3.5,2.0,7); camera.lookAt(0,0.2,-1);
  `,
  player: `
    var rig = ASH.player(T, MATS);
    RIGCHECK(rig, R, false);
    rig.root.position.set(0,0,0); scene.add(rig.root);
    var g4 = new T.Mesh(new T.PlaneGeometry(30,30), new T.MeshLambertMaterial({color:0x5c5449}));
    g4.rotation.x = -Math.PI/2; g4.receiveShadow = true; scene.add(g4);
    LIGHTS();
    camera.position.set(1.5,1.5,3.0); camera.lookAt(0,1.0,0);
  `,
  enemy: `
    var a = ASH.enemy(T, MATS, 'rusher'), b = ASH.enemy(T, MATS, 'marksman');
    RIGCHECK(a, R, true); R.rusher = R.rigOk;
    RIGCHECK(b, R, true); R.marksman = R.rigOk;
    a.root.position.set(-1.1,0,0); scene.add(a.root);
    b.root.position.set(1.1,0,0); scene.add(b.root);
    var g5 = new T.Mesh(new T.PlaneGeometry(30,30), new T.MeshLambertMaterial({color:0x5c5449}));
    g5.rotation.x = -Math.PI/2; g5.receiveShadow = true; scene.add(g5);
    LIGHTS();
    camera.position.set(0.4,1.6,4.2); camera.lookAt(0,1.0,0);
  `,
  vfx: `
    var v = ASH.vfx(T, scene);
    R.api = ['muzzle','tracer','impact','step'].filter(function(k){ return typeof v[k] !== 'function'; });
    var g6 = new T.Mesh(new T.PlaneGeometry(30,30), new T.MeshLambertMaterial({color:0x5c5449}));
    g6.rotation.x = -Math.PI/2; scene.add(g6);
    LIGHTS();
    v.muzzle(-1.6, 1.25, -2.0, 0,0,-1);
    v.tracer(-1.6,1.25,-2.0, -1.6,1.25,-7.0);
    v.impact(0.0, 1.15, -5.0, 0,0,1, 'world');
    v.impact(1.4, 1.15, -5.0, 0,0,1, 'enemy');
    v.impact(2.6, 1.55, -5.0, 0,0,1, 'head');
    v.step(0.016);
    camera.position.set(0.2,1.7,1.5); camera.lookAt(0.2,1.3,-5);
  `,
  hud: `
    var css = ASH.hud();
    R.type = typeof css; R.len = css ? css.length : 0;
    R.hasStruct = /(<div|document\\.)/.test(String(css));
    var g7 = new T.Mesh(new T.PlaneGeometry(30,30), new T.MeshLambertMaterial({color:0x5c5449}));
    g7.rotation.x = -Math.PI/2; scene.add(g7);
    LIGHTS();
    camera.position.set(0,1.7,4); camera.lookAt(0,1.2,-4);
  `,
  audio: `
    var a = ASH.audio();
    var need = ['unlock','shot','impact','reload','vault','slam','coverIn','step','ambience','setListener','setLowpass'];
    R.api = need.filter(function(k){ return typeof a[k] !== 'function'; });
    R.err = null;
    try {
      a.unlock(); a.shot('rifle'); a.shot('blind');
      a.impact('world'); a.impact('enemy'); a.impact('head');
      a.reload('out'); a.reload('in'); a.vault(); a.slam(); a.coverIn();
      a.step(3.0); a.ambience(true); a.setListener(0,1.6,0,0); a.setLowpass(0.5);
      a.ambience(false);
    } catch (e) { R.err = String(e && e.message || e); }
    var g8 = new T.Mesh(new T.PlaneGeometry(30,30), new T.MeshLambertMaterial({color:0x5c5449}));
    g8.rotation.x = -Math.PI/2; scene.add(g8);
    LIGHTS();
    camera.position.set(0,1.7,4); camera.lookAt(0,1.2,-4);
  `,
  world: `
    var w = ASH.world;
    R.keys = w ? Object.keys(w) : [];
    R.missing = ['title','place','factionPlayer','factionEnemy','weapons','terms','oneLineStory','artDirection']
      .filter(function(k){ return !w || w[k] === undefined; });
    R.adCount = w && w.artDirection ? w.artDirection.length : 0;
    var g9 = new T.Mesh(new T.PlaneGeometry(30,30), new T.MeshLambertMaterial({color:0x5c5449}));
    g9.rotation.x = -Math.PI/2; scene.add(g9);
    LIGHTS();
    camera.position.set(0,1.7,4); camera.lookAt(0,1.2,-4);
  `
};

if (!SCENES[NAME]) {
  console.error('未知のモジュール名: ' + NAME + '\n有効: ' + Object.keys(SCENES).join(', '));
  process.exit(2);
}

/* --- 予算 ------------------------------------------------------------------ */
/* 注意：ここの calls はテストシーン全体の合計。
   sky のテストシーンは地面1枚＋箱5個＝ハーネス自身で6コールを先に消費するため、
   契約本文の「モジュール寄与 ≤ 3」を判定するには 6+3=9 を上限にする必要がある。
   （当初 3 にしていたのは誤りで、空実装でも落ちる不可能な条件だった） */
const BUDGET = {
  tex: { calls: 40, tris: 200 }, sky: { calls: 9, tris: 6100 },
  light: { calls: 40, tris: 200 }, post: { calls: 40, tris: 200 },
  env: { calls: 24, tris: 90000 }, debris: { calls: 3, tris: 25000 },
  player: { calls: 6, tris: 3500 }, enemy: { calls: 10, tris: 6000 },
  vfx: { calls: 12, tris: 8000 }, hud: { calls: 40, tris: 200 },
  audio: { calls: 40, tris: 200 }, world: { calls: 40, tris: 200 }
};

(async () => {
  const vendor = fs.readFileSync(path.join(ART, '..', 'vendor', 'three.min.js'), 'utf8');
  const palette = fs.readFileSync(path.join(ART, 'palette.js'), 'utf8');
  const game = fs.readFileSync(path.join(ART, '..', 'game.js'), 'utf8');
  // game.js から COVERS / ARENA を取り出す（重複定義を避けるため文字列抽出）
  const mCov = game.match(/var COVERS = \[[\s\S]*?\n\];/);
  const mAre = game.match(/var ARENA = \{[^}]*\};/);
  if (!mCov || !mAre) { console.error('game.js から COVERS/ARENA を取り出せなかった'); process.exit(2); }

  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;background:#15181b;overflow:hidden}canvas{display:block}</style></head><body>
    <canvas id="gl"></canvas>
    <script>${vendor}<\/script>
    <script>${palette}<\/script>
    <script>${mCov[0]} ${mAre[0]}<\/script>
    <script>${src}<\/script>
    <script>
    var T = THREE, R = {}, POST = null, ERR = null;
    var renderer, scene, camera, MATS;
    function LIGHTS(){
      scene.add(new T.HemisphereLight(ASH.palette.ambientSky, ASH.palette.ambientGround, 0.62));
      var d = new T.DirectionalLight(ASH.palette.sunColor, 2.2);
      var s = ASH.palette.sunDir;
      d.position.set(s.x*20, s.y*20, s.z*20);
      d.castShadow = true; d.shadow.mapSize.set(1024,1024);
      var sc = d.shadow.camera; sc.left=-18; sc.right=18; sc.top=18; sc.bottom=-18; sc.near=1; sc.far=60;
      d.shadow.bias = -0.0012; d.shadow.normalBias = 0.03;
      scene.add(d); scene.add(d.target);
    }
    function RIGCHECK(rig, R, isEnemy){
      var need = ['root','body','torso','armR','armL','legR','legL'];
      if (!isEnemy) need = need.concat(['gun','flash']);
      var miss = need.filter(function(k){ return !rig || !rig[k]; });
      var par = [];
      if (rig && rig.body && rig.body.parent !== rig.root) par.push('body!<root');
      if (rig && rig.torso && rig.torso.parent !== rig.body) par.push('torso!<body');
      if (rig && rig.armR && rig.armR.parent !== rig.torso) par.push('armR!<torso');
      if (rig && rig.legR && rig.legR.parent !== rig.body) par.push('legR!<body');
      if (rig && rig.gun && rig.gun.parent !== rig.torso) par.push('gun!<torso');
      if (rig && rig.flash && rig.gun && rig.flash.parent !== rig.gun) par.push('flash!<gun');
      R.rigMissing = miss; R.rigParent = par; R.rigOk = miss.length===0 && par.length===0;
      if (rig && rig.root){
        var bb = new T.Box3().setFromObject(rig.root);
        R.height = bb.max.y - bb.min.y; R.width = bb.max.x - bb.min.x;
      }
    }
    function boot(){
      try {
        renderer = new T.WebGLRenderer({canvas:document.getElementById('gl'), antialias:true});
        renderer.setPixelRatio(1); renderer.setSize(1000, 620, false);
        renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFShadowMap;
        renderer.toneMapping = T.ACESFilmicToneMapping;
        renderer.toneMappingExposure = ASH.palette.exposure;
        scene = new T.Scene();
        scene.background = new T.Color(ASH.palette.skyZenith);
        camera = new T.PerspectiveCamera(58, 1000/620, 0.1, 200);
        MATS = {};
        ${SCENES[NAME]}
        if (POST && POST.setSize) POST.setSize(1000,620);
        // three は render() の冒頭で info を自動リセットするため、複数パスを描く
        // ポストでは最後の1パスしか残らない。自動リセットを切って全パスを合算する。
        renderer.info.autoReset = false;
        renderer.info.reset();
        if (POST && POST.render) POST.render(); else renderer.render(scene, camera);
        R.calls = renderer.info.render.calls;
        R.tris = renderer.info.render.triangles;
        R.textures = renderer.info.memory.textures;
        R.geometries = renderer.info.memory.geometries;
      } catch (e) { ERR = String((e && e.stack) || e); }
      window.__DONE = true;
    }
    boot();
    <\/script></body></html>`;

  const tmp = path.join(SHOT, '_' + NAME + '.html');
  fs.writeFileSync(tmp, html);

  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'] });
  const page = await browser.newPage({ viewport: { width: 1000, height: 620 } });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  const netReq = [];
  page.route('**/*', r => {
    const u = r.request().url();
    if (!u.startsWith('file:') && !u.startsWith('data:') && !u.startsWith('blob:')) netReq.push(u);
    r.continue();
  });

  await page.goto('file://' + tmp, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__DONE === true, null, { timeout: 60000 }).catch(() => { });
  const { R, ERR } = await page.evaluate(() => ({ R: window.R || {}, ERR: window.ERR }));

  console.log('\n=== ' + NAME + ' ===');
  check('実行時エラーが出ない', !ERR && errs.length === 0, ERR || errs.slice(0, 2).join(' | ') || 'なし');
  check('外部への通信が発生しない', netReq.length === 0, netReq.slice(0, 3).join(' ') || 'なし');

  const b = BUDGET[NAME];
  check('ドローコール ≤ ' + b.calls, (R.calls || 0) <= b.calls, 'calls=' + R.calls);
  check('三角形 ≤ ' + b.tris, (R.tris || 0) <= b.tris, 'tri=' + R.tris);

  /* モジュール固有 */
  if (NAME === 'tex') {
    check('契約の14枚がすべて揃っている', (R.missing || ['?']).length === 0, '欠け: ' + (R.missing || []).join(',') || 'なし');
    check('1枚も512pxを超えない', R.maxSide <= 512, '最大辺=' + R.maxSide);
    check('総ピクセル ≤ 6M', (R.pixels || 0) <= 6e6, (R.pixels / 1e6).toFixed(2) + 'M px ≈ ' + (R.pixels * 4 / 1048576).toFixed(1) + 'MB');
  }
  if (NAME === 'sky') {
    check('mesh と update を返す', R.hasMesh && R.hasUpdate, `mesh=${R.hasMesh} update=${R.hasUpdate}`);
    check('scene.fog を設定している', !!R.fog, 'fog=' + R.fog);
  }
  if (NAME === 'light') {
    check('sun は DirectionalLight', !!R.hasSun, 'sun=' + R.hasSun);
    check('影を落とすライトは1つだけ（§12）', R.shadowLights === 1, '影ライト数=' + R.shadowLights);
    check('shadow map は 1024', R.mapSize === 1024, 'mapSize=' + R.mapSize);
    check('applyRim を提供している', !!R.hasRim, 'applyRim=' + R.hasRim);
  }
  if (NAME === 'post') check('render / setSize を提供している', R.hasRender && R.hasSetSize, `render=${R.hasRender} setSize=${R.hasSetSize}`);
  if (NAME === 'env' || NAME === 'debris') check('Group を返す', !!R.isGroup, 'isGroup=' + R.isGroup);
  if (NAME === 'debris') check('瓦礫の高さ ≤ 0.12m（膝より低いこと）', (R.maxY || 9) <= 0.13, 'maxY=' + (R.maxY || 0).toFixed(3) + 'm');
  if (NAME === 'player') {
    check('リグの名前と親子関係が契約どおり', !!R.rigOk, '欠け:' + (R.rigMissing || []).join(',') + ' 親子:' + (R.rigParent || []).join(','));
    check('身長 1.7〜1.95m', R.height >= 1.7 && R.height <= 1.95, R.height ? R.height.toFixed(2) + 'm' : '?');
  }
  if (NAME === 'enemy') check('2種ともリグが契約どおり', R.rusher && R.marksman, `rusher=${R.rusher} marksman=${R.marksman}`);
  if (NAME === 'vfx') check('muzzle/tracer/impact/step を提供している', (R.api || ['?']).length === 0, '欠け: ' + (R.api || []).join(','));
  if (NAME === 'hud') {
    check('CSS文字列を返す', R.type === 'string' && R.len > 200, `type=${R.type} len=${R.len}`);
    check('DOM構造を作っていない（スタイルのみ）', !R.hasStruct, 'hasStruct=' + R.hasStruct);
  }
  if (NAME === 'audio') {
    check('APIが揃っている', (R.api || ['?']).length === 0, '欠け: ' + (R.api || []).join(','));
    check('全APIを呼んでも例外が出ない', !R.err, R.err || 'なし');
  }
  if (NAME === 'world') {
    check('必須キーが揃っている', (R.missing || ['?']).length === 0, '欠け: ' + (R.missing || []).join(','));
    check('artDirection が5項目以上', (R.adCount || 0) >= 5, R.adCount + '項目');
  }

  const shot = path.join(SHOT, NAME + '.png');
  await page.screenshot({ path: shot });
  console.log('\n描画: ' + shot + '   （Readツールで開いて必ず自分の目で見ること）');
  console.log('計測: draw=' + R.calls + ' tri=' + R.tris + ' textures=' + R.textures + ' geometries=' + R.geometries);
  console.log('\n  PASS ' + pass + ' / FAIL ' + fail + '\n');

  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR:', e); process.exit(2); });

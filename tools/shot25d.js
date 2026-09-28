#!/usr/bin/env node
// もふもふ聖犬士イッヌ 2.5D — ヘッドレス Chromium（SwiftShader WebGL）で beltaction25d.html を開き、
// 任意の JS をページ内で実行してスクリーンショットを撮る。テストと目視確認の共通土台。
//
//   cd /tmp && NODE_PATH=/opt/node22/lib/node_modules node /home/user/Kuchiwan/tools/shot25d.js \
//       --eval "G.debug.showcase(['inu','shima']); G.step(30)" --shot /tmp/x.png
//
// options:
//   --only 00,10,20,90    build only these module prefixes (to a private temp file) — use while other
//                         modules are being written in parallel and may be broken
//   --no-build            use the existing beltaction25d.html
//   --file PATH           page to open (skips the build)
//   --size WxH            viewport (default 1280x720). Phone landscape: 844x390, portrait: 390x844
//   --touch               emulate a touch phone (hasTouch + isMobile)
//   --hash TOKEN          location hash (default "test": no rAF loop, drive with G.step)
//   --eval CODE           JS run in the page after G.ready (may be async / return JSON-able value)
//   --eval-file PATH      same, from a file
//   --shot PATH           save a screenshot after eval
//   --live MS             instead of test mode, run the real rAF loop for MS milliseconds before eval
//   --quiet               only print the eval result
// prints: page errors, console errors, G.errors, eval result, renderer.info
'use strict';
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const THREE_LOCAL = path.join(ROOT, 'tests', 'vendor', 'three-0.160.0.min.js');

function arg(name, def){ const i = process.argv.indexOf(name); if(i<0) return def; const v = process.argv[i+1]; return (v==null||v.startsWith('--')) ? true : v; }
const has = (name)=> process.argv.includes(name);

async function main(){
  let file = arg('--file', null);
  const only = arg('--only', null);
  if(!has('--no-build') && !file){
    // build to a private temp file so parallel workers never clobber each other's page
    file = path.join(require('os').tmpdir(), `inu25d_${process.pid}_${Date.now()}.html`);
    const bargs = [path.join(ROOT,'tools','build25d.js'), '--out', file];
    if(only && only!==true) bargs.push('--only', only);
    try { execFileSync(process.execPath, bargs, { stdio: has('--quiet')?'ignore':'inherit' }); }
    catch(err){ console.log('BUILD FAILED'); process.exit(3); }
    process.on('exit', ()=>{ try{ fs.unlinkSync(file); }catch(_){} });
  }
  if(!file) file = path.join(ROOT, 'beltaction25d.html');
  const [W,H] = String(arg('--size','1280x720')).split('x').map(Number);
  const touch = has('--touch');
  const live = arg('--live', null);
  const hash = arg('--hash', live ? '' : 'test');
  let code = arg('--eval', '');
  const ef = arg('--eval-file', null); if(ef) code = fs.readFileSync(ef,'utf8');

  const browser = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium',
    args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--autoplay-policy=no-user-gesture-required','--ignore-gpu-blocklist'] });
  const ctx = await browser.newContext({ viewport:{ width:W, height:H }, deviceScaleFactor:1, hasTouch:touch, isMobile:touch });
  const page = await ctx.newPage();
  const logs = [];
  page.on('pageerror', e => logs.push('PAGEERROR ' + (e.stack||e.message)));
  page.on('console', m => { if(m.type()==='error') logs.push('CONSOLE.ERROR ' + m.text()); });
  await page.route('https://cdn.jsdelivr.net/npm/three@0.160.0/**', r => r.fulfill({ path: THREE_LOCAL, contentType:'application/javascript' }));
  await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ status:200, contentType:'text/css', body:'' }));
  const url = 'file://' + path.resolve(file) + (hash ? '#'+hash : '');
  await page.goto(url);
  await page.waitForFunction(() => window.G && (window.G.ready || window.G.bootError), null, { timeout: 60000 });
  const bootErr = await page.evaluate(() => window.G.bootError || null);
  if(bootErr) logs.push('BOOTERROR ' + bootErr);
  if(live) await page.waitForTimeout(Number(live));
  let result = null;
  if(code){
    try {
      result = await page.evaluate(async (src) => {
        const fn = new Function('G', 'THREE', 'return (async () => {\n' + src + '\n})()');
        return await fn(window.G, window.THREE);
      }, code);
    } catch(err){ logs.push('EVALERROR ' + (err.stack||err.message)); }
  }
  const info = await page.evaluate(() => {
    const G = window.G; const r = G && G.renderer;
    return { errors: (G && G.errors) || [], scene: G && G.sceneName, calls: r ? r.info.render.calls : null, tris: r ? r.info.render.triangles : null,
      geos: r ? r.info.memory.geometries : null, texs: r ? r.info.memory.textures : null, progs: r && r.info.programs ? r.info.programs.length : null };
  });
  const shot = arg('--shot', null);
  if(shot && shot!==true) await page.screenshot({ path: shot });
  await browser.close();
  if(!has('--quiet')){
    for(const l of logs) console.log(l);
    for(const e of info.errors) console.log('G.ERROR ' + e);
    console.log('INFO ' + JSON.stringify({ scene:info.scene, calls:info.calls, tris:info.tris, geos:info.geos, texs:info.texs, programs:info.progs }));
    if(shot && shot!==true) console.log('SHOT ' + shot);
  }
  console.log('RESULT ' + JSON.stringify(result));
  const bad = logs.some(l => /^(PAGEERROR|BOOTERROR|EVALERROR)/.test(l)) || info.errors.length;
  process.exit(bad ? 2 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });

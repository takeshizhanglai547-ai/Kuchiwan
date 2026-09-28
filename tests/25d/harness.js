// もふもふ聖犬士イッヌ 2.5D — ブラウザ（ヘッドレス Chromium + SwiftShader WebGL）で動かす試験の土台。
// 対象は環境変数 INU25D_TARGET（既定: リポジトリ直下の beltaction25d.html）。ミューテーション試験では
// 改変したコピーを INU25D_TARGET に渡す（CLAUDE.md の NM_TARGET と同じ考え方）。
'use strict';
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..', '..');
const TARGET = process.env.INU25D_TARGET || path.join(ROOT, 'beltaction25d.html');
const THREE_LOCAL = path.join(ROOT, 'tests', 'vendor', 'three-0.160.0.min.js');

let browser = null;
async function getBrowser(){
  if(!browser) browser = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium',
    args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--autoplay-policy=no-user-gesture-required','--ignore-gpu-blocklist'] });
  return browser;
}
// open the game. opts: {hash:'test'|'' , size:'1280x720', touch:false, init: fn run before page scripts}
async function open(opts){
  opts = opts || {};
  const b = await getBrowser();
  const [W,H] = String(opts.size || '1280x720').split('x').map(Number);
  const ctx = await b.newContext({ viewport:{ width:W, height:H }, deviceScaleFactor:1, hasTouch:!!opts.touch, isMobile:!!opts.touch });
  const page = await ctx.newPage();
  const logs = [];
  page.on('pageerror', e => logs.push('PAGEERROR ' + (e.stack||e.message)));
  page.on('console', m => { if(m.type()==='error') logs.push('CONSOLE.ERROR ' + m.text()); });
  await page.route('https://cdn.jsdelivr.net/npm/three@0.160.0/**', r => r.fulfill({ path: THREE_LOCAL, contentType:'application/javascript' }));
  await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ status:200, contentType:'text/css', body:'' }));
  if(opts.init) await page.addInitScript(opts.init);
  const hash = opts.hash==null ? 'test' : opts.hash;
  await page.goto('file://' + path.resolve(TARGET) + (hash ? '#'+hash : ''));
  await page.waitForFunction(() => window.G && (window.G.ready || window.G.bootError), null, { timeout: 60000 });
  const run = async (fn, arg) => page.evaluate(fn, arg);
  const errors = async () => {
    const g = await page.evaluate(() => (window.G && window.G.errors) || []);
    return logs.concat(g.map(e => 'G.ERROR ' + e));
  };
  return { page, ctx, run, errors, logs, close: () => ctx.close() };
}
async function shutdown(){ if(browser){ await browser.close(); browser = null; } }

// tiny test runner: each test gets a fresh page unless it opens its own
const tests = [];
function test(name, fn, opts){ tests.push({ name, fn, opts: opts||{} }); }
function assert(cond, msg){ if(!cond) throw new Error('ASSERT ' + msg); }
async function runAll(filter){
  let pass = 0, fail = 0;
  const t0 = Date.now();
  for(const t of tests){
    if(filter && !t.name.includes(filter)) continue;
    if(!filter && t.opts.slow) continue;          // slow tests only run when asked for by name
    const s = Date.now();
    try { await t.fn(); pass++; console.log(`  ok   ${t.name} (${((Date.now()-s)/1000).toFixed(1)}s)`); }
    catch(err){ fail++; console.log(`  FAIL ${t.name}: ${String(err && err.message || err).split('\n').slice(0,6).join('\n       ')}`); }
  }
  await shutdown();
  console.log(`${pass} passed, ${fail} failed (${((Date.now()-t0)/1000).toFixed(0)}s) target=${path.basename(TARGET)}`);
  if(fail===0 && pass>0) console.log('PASSED');
  process.exitCode = fail ? 1 : 0;
}
module.exports = { open, shutdown, test, assert, runAll, TARGET, ROOT };

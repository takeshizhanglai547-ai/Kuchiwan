// ドット絵版の目視確認ハーネス。
//   NODE_PATH=/opt/node22/lib/node_modules node tools/shot.js <html> <out-dir> [prefix] [scenes]
// scenes は カンマ区切り: title,demo,boss,themes,hud（既定は全部）
//
// 戦闘の絵はアトラクトデモ（AIが実際に遊ぶ）から撮る。手で敵を湧かせるより
// 本編と同じ状況になる。※CLAUDE.md のとおり、性能の比較計測には使わないこと
// （毎回キャラ・周回・敵が変わるので、絵の確認専用）。
const { chromium } = require('playwright');
const path = require('path');

const FILE = process.argv[2] || 'beltaction_pixel.html';
const OUT = process.argv[3] || '/tmp/shots';
const TAG = process.argv[4] || '';
const SCENES = (process.argv[5] || 'title,demo,boss,themes').split(',');
const url = 'file://' + path.resolve(FILE);

(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const pg = await b.newPage({ viewport: { width: 1000, height: 620 }, deviceScaleFactor: 1 });
  const errs = [];
  pg.on('pageerror', e => errs.push('pageerror: ' + String(e)));
  pg.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  await pg.goto(url);
  await pg.waitForTimeout(1200);
  const shot = n => pg.locator('#game').screenshot({ path: `${OUT}/${TAG}${n}.png` });

  if (SCENES.includes('title')) await shot('01_title');

  if (SCENES.includes('demo')) {
    // AI が実際に戦うデモ。数秒おきに撮って、道中・殴り合い・技の瞬間を拾う
    await pg.evaluate(() => { attractDemoN = 0; attract = { seq: [{ k: 'demo' }], i: 0, t: 0 }; attractOn = true; attractStartDemo(); });
    for (const [i, wait] of [2200, 2600, 2600, 3000].entries()) {
      await pg.waitForTimeout(wait);
      await shot('02_demo' + (i + 1));
    }
  }

  if (SCENES.includes('boss')) {
    await pg.evaluate(() => { try { endAttract(); } catch (e) {} startBossTest('inu'); });
    await pg.waitForTimeout(4000); await shot('03_boss1');
    await pg.waitForTimeout(4000); await shot('03_boss2');
  }

  if (SCENES.includes('themes')) {
    // 背景テーマの見本。stage を差し替えると curTheme() の戻りが変わる
    const keys = await pg.evaluate(() => Object.keys(STAGE2THEME).map(Number));
    const pick = keys.filter((_, i) => i % Math.max(1, Math.ceil(keys.length / 6)) === 0).slice(0, 6);
    for (const k of pick) {
      await pg.evaluate(s => { stage = s; }, k);
      await pg.waitForTimeout(700);
      await shot('04_theme' + k);
    }
  }

  // 描画1フレームの中央値。CLAUDE.md のとおり同一シーンでしか比較できない
  const fps = await pg.evaluate(() => new Promise(res => {
    const t = []; let n = 0, last = performance.now();
    const f = () => { const w = performance.now(); t.push(w - last); last = w; if (++n < 120) requestAnimationFrame(f); else { t.sort((a, b) => a - b); res(t[t.length >> 1].toFixed(2)); } };
    requestAnimationFrame(f);
  }));
  console.log('median frame interval: ' + fps + 'ms  (vsync floor 16.7)');
  if (errs.length) { console.log('--- ERRORS (' + errs.length + ') ---'); errs.slice(0, 15).forEach(e => console.log(e)); process.exitCode = 1; }
  else console.log('no page errors');
  await b.close();
})();

/* eslint-disable no-console */
// ギャラリー（スプライト確認用）のスクリーンショットを撮る
//   NODE_PATH=/opt/node22/lib/node_modules node berserk/tools/shot.cjs <what> <out.png> [zoom]
//   what: heroes | enemies | bosses | hero:guts | enemy:undead
const path = require('path');
const { chromium } = require('playwright');
(async () => {
  const what = process.argv[2] || 'heroes';
  const out = path.resolve(process.argv[3] || 'gallery.png');
  const zoom = process.argv[4] || '2';
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.stack || e)));
  page.on('console', m => { if (m.type() === 'error' && !/ERR_CERT|net::ERR_/.test(m.text())) errors.push(m.text()); });
  await page.goto('file://' + path.resolve(__dirname, 'gallery.html') + '?what=' + encodeURIComponent(what) + '&zoom=' + zoom);
  await page.waitForTimeout(700);
  await page.locator('#gal').screenshot({ path: out });
  console.log(JSON.stringify({ out, errors }));
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });

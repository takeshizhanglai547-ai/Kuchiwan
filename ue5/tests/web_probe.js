/* =============================================================================
   ue5/tests/web_probe.js — probes.json をWeb版(ashline.html)に投げて答えを取る。
   使い方: NODE_PATH=/opt/node22/lib/node_modules node ue5/tests/web_probe.js
   ========================================================================== */
'use strict';
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const FILE = 'file://' + path.join(ROOT, 'ashline.html');

(async () => {
  const probes = JSON.parse(fs.readFileSync(path.join(__dirname, 'probes.json'), 'utf8'));

  const browser = await chromium.launch({
    args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage']
  });
  const page = await browser.newPage({ viewport: { width: 844, height: 390 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.message)));
  await page.goto(FILE, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__ASHLINE, null, { timeout: 20000 });
  await page.evaluate(() => { __ASHLINE.setAutoRes(false); __ASHLINE.setCombat(false); });

  const shape = await page.evaluate(() => __ASHLINE.worldShape());
  const answers = await page.evaluate(p => __ASHLINE.probe(p).map(
    v => (v === Infinity ? null : v)), probes);

  await browser.close();

  if (errors.length) {
    console.error('ページエラー: ' + errors.join(' | '));
    process.exit(1);
  }
  fs.writeFileSync(path.join(__dirname, 'web_answers.json'), JSON.stringify(answers));
  fs.writeFileSync(path.join(__dirname, 'web_shape.json'), JSON.stringify(shape));
  console.log('web_probe: ' + answers.length + ' 問に回答  (boxes=' +
    shape.boxes.length + ' faces=' + shape.faces.length + ')');
})();

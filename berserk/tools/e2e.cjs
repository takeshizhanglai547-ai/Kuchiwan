/* eslint-disable no-console */
// タイトル → キャラ選択（タップ操作）→ 全6ラウンド → エンディング までを通しで確認する
//   NODE_PATH=/opt/node22/lib/node_modules node berserk/tools/e2e.cjs --hero=1 --turbo=6 --minutes=20 [--god=false] [--shots=dir]
//   --hero は選択画面の並び順（0=ガッツ 1=キャスカ 2=髑髏の騎士 3=シールケ）
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const args = Object.fromEntries(process.argv.slice(2).map(a => { const m = /^--([^=]+)=?(.*)$/.exec(a); return m ? [m[1], m[2] === '' ? true : m[2]] : [a, true]; }));
const file = path.resolve(__dirname, '..', 'index.html');
const heroIdx = parseInt(args.hero || '0', 10);
const turbo = parseInt(args.turbo || '6', 10);
const minutes = parseFloat(args.minutes || '20');
const god = args.god !== 'false';
const shots = args.shots ? path.resolve(args.shots) : null;

(async () => {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + (e.stack || e.message)));
  page.on('console', m => { if ((m.type() === 'error' || m.type() === 'warning') && !/ERR_CERT|net::ERR_|fonts\.g/.test(m.text())) errors.push(m.type() + ': ' + m.text()); });
  if (shots) fs.mkdirSync(shots, { recursive: true });
  await page.goto('file://' + file);
  await page.waitForTimeout(1800);
  const box = await page.locator('#bk-canvas').boundingBox();
  const W = await page.evaluate(() => BK.W);
  const tap = async (lx, ly) => page.touchscreen.tap(box.x + lx / W * box.width, box.y + ly / 360 * box.height);
  // タイトル → 選択
  await tap(W / 2, 200); await page.waitForTimeout(700);
  // カードをタップ（1回目で選択、2回目で決定）
  const n = await page.evaluate(() => BK.heroOrder.length);
  const cw = Math.min(150, (W - 40) / n - 8), x0 = W / 2 - (n * cw + (n - 1) * 8) / 2;
  const cx = x0 + heroIdx * (cw + 8) + cw / 2;
  await tap(cx, 130); await page.waitForTimeout(300);
  await tap(cx, 130); await page.waitForTimeout(1500);
  const picked = await page.evaluate(() => ({ scene: BK.sceneName, hero: BK.game && BK.game.heroId }));
  await page.evaluate(({ t, g }) => { BK.turbo = t; BK.god = g; }, { t: turbo, g: god });
  const timeline = [];
  let last = '', lastStage = -1, n2 = 0;
  const t0 = Date.now();
  while ((Date.now() - t0) / 60000 < minutes) {
    await page.waitForTimeout(700);
    const st = await page.evaluate(() => { if (BK.sceneName === 'play') BK.autoplay = true; return BK.test.state(); });
    const key = st.scene + ':' + st.stage;
    if (key !== last) { timeline.push({ t: Math.round((Date.now() - t0) / 1000), scene: st.scene, stage: st.stage, hp: st.hero && st.hero.hp, lives: st.hero && st.hero.lives, score: st.score }); last = key; }
    if (shots && st.scene === 'play' && st.stage !== lastStage) { lastStage = st.stage; }
    if (shots && n2++ % 40 === 0) await page.screenshot({ path: path.join(shots, `e2e_${String(n2).padStart(4, '0')}.png`) });
    if (st.errors.length || errors.length > 5) break;
    if (st.scene === 'ending' || st.scene === 'gameover') {
      if (st.scene === 'ending' && shots) { await page.waitForTimeout(1500); await page.screenshot({ path: path.join(shots, 'ending.png') }); }
      break;
    }
    // コンティニュー画面では「まだ戦う」を押す（god=false 時）
    if (st.scene === 'play') {
      const cont = await page.evaluate(() => BK.scene && BK.scene.cont);
      if (cont) await page.evaluate(() => { BK.input.press('kb', 'start'); setTimeout(() => BK.input.release('kb', 'start'), 50); });
    }
  }
  const final = await page.evaluate(() => BK.test.state());
  console.log(JSON.stringify({ heroIdx, picked, god, turbo, seconds: Math.round((Date.now() - t0) / 1000), final: { scene: final.scene, stage: final.stage, score: final.score, hero: final.hero }, timeline, errors: errors.concat(final.errors).slice(0, 20) }, null, 1));
  await browser.close();
})().catch(e => { console.error('E2E FAILED', e); process.exit(1); });

/* eslint-disable no-console */
// BERSERK belt action ── ヘッドレス・スモークテスト
//   NODE_PATH=/opt/node22/lib/node_modules node berserk/tools/smoke.cjs [options]
//   --hero=guts --stage=0 --seconds=60 --turbo=4 --shots=out_dir --file=berserk/index.html
//   --boss=snakeBaron  … そのボス戦から開始
//   --god=false        … 無敵なしで実行（死亡・コンティニューの確認）
//   --scenario=menu  … タイトル → キャラ選択 → 開始 をタップ操作で確認
// オートプレイ（無敵）で進行させ、エラーの有無・ステージ進行・ボス撃破を JSON で出力する。
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const args = Object.fromEntries(process.argv.slice(2).map(a => { const m = /^--([^=]+)=?(.*)$/.exec(a); return m ? [m[1], m[2] === '' ? true : m[2]] : [a, true]; }));
const file = path.resolve(args.file || path.join(__dirname, '..', 'index.html'));
const hero = args.hero || 'guts';
const stage = parseInt(args.stage || '0', 10);
const seconds = parseFloat(args.seconds || '40');
const turbo = parseInt(args.turbo || '4', 10);
const shots = args.shots ? path.resolve(args.shots) : null;
const god = args.god !== 'false';
const exe = fs.existsSync('/opt/pw-browsers/chromium') ? undefined : undefined;

(async () => {
  const browser = await chromium.launch({ executablePath: exe, args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + (e.stack || e.message)));
  page.on('console', m => { if ((m.type() === 'error' || m.type() === 'warning') && !/ERR_CERT|net::ERR_|fonts.g/.test(m.text())) errors.push(m.type() + ': ' + m.text()); });
  if (shots) fs.mkdirSync(shots, { recursive: true });

  if (args.scenario === 'menu') {
    await page.goto('file://' + file);
    await page.waitForTimeout(1800);
    if (shots) await page.screenshot({ path: path.join(shots, 'menu_title.png') });
    const box = await page.locator('#bk-canvas').boundingBox();
    const tap = async (lx, ly) => { const W = await page.evaluate(() => BK.W); await page.touchscreen.tap(box.x + lx / W * box.width, box.y + ly / 360 * box.height); };
    await tap(300, 200); await page.waitForTimeout(600);
    if (shots) await page.screenshot({ path: path.join(shots, 'menu_select.png') });
    const W = await page.evaluate(() => BK.W);
    await tap(W - 60, 338); await page.waitForTimeout(1500);
    if (shots) await page.screenshot({ path: path.join(shots, 'menu_intro.png') });
    await tap(300, 200); await page.waitForTimeout(1200);
    if (shots) await page.screenshot({ path: path.join(shots, 'menu_play.png') });
    const st = await page.evaluate(() => ({ scene: BK.sceneName, touchVisible: !document.getElementById('bk-touch').hidden, errors: BK.errors }));
    console.log(JSON.stringify({ scenario: 'menu', st, errors }, null, 1));
    await browser.close();
    return;
  }

  const q = `?hero=${hero}&stage=${stage}&auto=1${god ? '&god=1' : ''}${args.boss ? '&boss=' + args.boss : ''}`;
  await page.goto('file://' + file + q);
  await page.waitForTimeout(1700);
  await page.evaluate(t => { BK.turbo = t; }, turbo);
  const t0 = Date.now();
  const log = [];
  let n = 0, last = null;
  while ((Date.now() - t0) / 1000 < seconds) {
    await page.waitForTimeout(2000);
    const st = await page.evaluate(() => BK.test.state());
    log.push({ t: Math.round((Date.now() - t0) / 1000), scene: st.scene, stage: st.stage, camX: Math.round(st.camX), en: st.enemies, lock: st.lock, boss: st.boss && Math.round(st.boss.hp), hp: st.hero && st.hero.hp });
    if (shots && n % 3 === 0) await page.screenshot({ path: path.join(shots, `play_${String(n).padStart(3, '0')}.png`) });
    n++;
    last = st;
    if (st.errors.length) break;
    if (st.scene === 'clear' || st.scene === 'ending' || st.scene === 'gameover') break;
  }
  if (shots) await page.screenshot({ path: path.join(shots, 'final.png') });
  const final = await page.evaluate(() => BK.test.state());
  console.log(JSON.stringify({ hero, stage, final, log: log.slice(-40), errors: errors.concat(final.errors).slice(0, 20) }, null, 1));
  await browser.close();
})().catch(e => { console.error('SMOKE FAILED', e); process.exit(1); });

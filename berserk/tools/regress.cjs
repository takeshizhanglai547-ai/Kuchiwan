/* eslint-disable no-console */
// 回帰テスト: レビューで見つかった不具合が直っていることをフレーム単位で確認する
//   NODE_PATH=/opt/node22/lib/node_modules node berserk/tools/regress.cjs
const path = require('path');
const { chromium } = require('playwright');
const file = 'file://' + path.resolve(__dirname, '..', 'index.html');

(async () => {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.stack || e)));
  await page.goto(file);
  await page.waitForTimeout(1800);
  const results = {};
  // 共通: 主人公だけのアリーナを作る
  const setup = `
    window.T = {};
    T.arena = function (hero) {
      BK.halt = true; BK.god = false; BK.autoplay = false;
      for (const b of ['atk','jmp','sht','sp','awk','left','right','up','down','start','pause']) BK.input.release('kb', b);
      BK.input.ax = 0; BK.input.ay = 0;
      const g = BK.test.start(hero || 'guts', 0);
      g.events = []; g.actors = g.actors.filter(a => a === g.hero);
      g.hero.x = BK.cam.x + 200; g.hero.y = 60; g.hero.invul = 0;
      for (let i = 0; i < 5; i++) BK.stepOnce(true);
      return g;
    };
    T.dummy = function (id, dx, o) {
      const g = BK.game, e = g.spawnEnemy(id, Object.assign({ x: g.hero.x + dx, y: g.hero.y, entry: 'none' }, o || {}));
      e.entering = 0; e.intangible = false; e.z = 0; e.state = 'idle';
      if (!(o && o.ai)) e.update = function () { this.animT++; if (this.flash > 0) this.flash--; if (this.updateReactions()) { this.physics(); return; } this.physics(); };
      return e;
    };
    T.tap = function (b, hold) { BK.input.press('kb', b); for (let i = 0; i < (hold || 1); i++) BK.stepOnce(true); BK.input.release('kb', b); };
    T.steps = function (n) { for (let i = 0; i < n; i++) BK.stepOnce(true); };
  `;
  await page.evaluate(setup);

  // 1) ヒットストップ中の攻撃入力が次の技につながる
  results.hitstopCarry = await page.evaluate(() => {
    const out = {};
    for (const hero of ['guts', 'casca', 'skull', 'schierke']) {
      const g = T.arena(hero); const e = T.dummy('undead', 50, { hp: 999 });
      T.tap('atk');
      let n = 0; while (BK.fx.hitstop <= 0 && n++ < 40) T.steps(1);
      const hitstop = BK.fx.hitstop;
      T.tap('atk'); // 止まっている最中に押す
      T.steps(60);
      out[hero] = { hitstop, combo: g.hero.combo, ok: g.hero.combo >= 1 };
    }
    return out;
  });

  // 2) 攻撃中に 必 ボタン
  results.specialDuringAttack = await page.evaluate(() => {
    const out = {};
    for (const hero of ['guts', 'casca', 'skull', 'schierke']) {
      const g = T.arena(hero); T.dummy('undead', 60, { hp: 999 });
      T.tap('atk'); T.steps(5);
      T.tap('sp');
      let sp = g.hero.move === g.hero.def.moves.special;
      for (let i = 0; i < 10 && !sp; i++) { T.steps(1); sp = g.hero.move === g.hero.def.moves.special; } // ヒットストップ明けに出る
      out[hero] = sp;
    }
    return out;
  });

  // 3) 攻撃直後のジャンプで勝手に必殺が出ない
  results.noAccidentalSpecial = await page.evaluate(() => {
    const g = T.arena('guts'); T.dummy('undead', 50, { hp: 999 });
    T.tap('atk'); T.steps(12); T.tap('atk'); T.steps(7);
    const hp0 = g.hero.hp; T.tap('jmp'); T.steps(3);
    return { hpLost: hp0 - g.hero.hp, move: g.hero.move === g.hero.def.moves.special ? 'special' : (g.hero.move ? 'other' : g.hero.state) };
  });

  // 4) タッチでスティックを倒しっぱなしにして敵へ向かうと掴める
  results.autoRunGrab = await page.evaluate(() => {
    const out = {};
    for (const hero of ['guts', 'casca', 'skull', 'schierke']) {
      const g = T.arena(hero); const e = T.dummy('undead', 170, { hp: 999 });
      BK.input.touchMode = true; BK.input.ax = 1; BK.input.ay = 0;
      let grabbed = false, ran = false;
      for (let i = 0; i < 160 && !grabbed; i++) { T.steps(1); if (g.hero.state === 'run') ran = true; if (g.hero.grabbing === e) grabbed = true; }
      BK.input.ax = 0;
      out[hero] = { ran, grabbed };
    }
    return out;
  });

  // 5) 背負い投げ（後ろ＋斬）がすぐ出る & 投げた敵は巻き込んだ相手に1回だけ当たる
  results.backThrow = await page.evaluate(() => {
    const g = T.arena('guts'); const e = T.dummy('undead', 30, { hp: 999 });
    const by = T.dummy('undead', -40, { hp: 200 });
    g.hero.startGrab(e);
    BK.input.press('kb', 'left'); T.tap('atk'); T.steps(60); BK.input.release('kb', 'left');
    return { threw: e.state === 'fall' || e.state === 'down' || e.state === 'getup' || e.dead, bystanderDamage: 200 - by.hp };
  });

  // 6) ボウガンの矢が魔犬（背の低い敵）に当たる / 炸裂弾が中距離の敵に当たる
  results.lowTargets = await page.evaluate(() => {
    const g = T.arena('guts'); const hd = T.dummy('hound', 120, { hp: 999 });
    T.tap('sht'); T.steps(40);
    const bolt = 999 - hd.hp;
    const g2 = T.arena('casca'); const u = T.dummy('undead', 100, { hp: 999 });
    g2.hero.sub = { id: 'bombs', ammo: 3 }; T.tap('sht'); T.steps(60);
    return { boltOnHound: bolt, bombAt100: 999 - u.hp };
  });

  // 7) プレイ中のクリックがポーズメニューに持ち越されない
  results.staleTap = await page.evaluate(() => {
    const g = T.arena('guts');
    BK.input.tap = { x: BK.W / 2, y: 238 }; // 「タイトルへ戻る」の位置
    T.steps(3);
    T.tap('pause'); T.steps(3);
    const r = { scene: BK.sceneName, paused: !!BK.scene.paused };
    T.tap('pause'); T.steps(2);
    return r;
  });

  // 8) ポーズ → タイトルへ戻る で BGM 音量が戻り、ハイスコアが保存される
  results.quitRestores = await page.evaluate(() => {
    BK.audio.unlock();
    const g = T.arena('guts'); g.addScore(123456);
    T.tap('pause'); T.steps(2);
    BK.scene.psel = 2; T.tap('atk'); T.steps(2);
    return { scene: BK.sceneName, musBus: BK.audio.musBus ? +BK.audio.musBus.gain.value.toFixed(3) : null, musicVol: BK.audio.musicVol, hiscore: BK.save.get('hiscore', 0) };
  });

  // 9) 画面端に追い詰められても画面外の敵から攻撃されない
  results.offscreenHits = await page.evaluate(() => {
    const g = T.arena('guts'); BK.god = true;
    g.hero.x = BK.cam.x + 40;
    const es = [0, 1, 2].map(i => g.spawnEnemy(['undead', 'troll', 'inquisitor'][i], { side: 'L', y: 40 + i * 20, off: i * 30 }));
    let offHits = 0, hits = 0;
    const orig = g.hero.takeHit.bind(g.hero);
    g.hero.takeHit = function (src, h, dir) { if (src && src.team === 'enemy') { hits++; if (src.x < BK.cam.x + 10) offHits++; } return orig(src, h, dir); };
    for (let i = 0; i < 1500; i++) { g.hero.x = BK.cam.x + 40; g.hero.vx = 0; BK.stepOnce(true); }
    BK.god = false;
    return { hits, offHits };
  });

  // 10) 縦持ちにするとプレイが自動ポーズ
  await page.evaluate(() => { T.arena('guts'); BK.halt = false; BK.input.touchMode = true; });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  results.rotatePauses = await page.evaluate(() => ({ overlay: BK.rotateHintShown(), paused: !!BK.scene.paused }));
  await page.setViewportSize({ width: 844, height: 390 });
  await page.waitForTimeout(300);

  // 11) 空中で悪霊に張り付かれても空中で固まらない
  results.airLatch = await page.evaluate(() => {
    const g = T.arena('guts'); const s = T.dummy('spirit', 10, { hp: 999, ai: true });
    g.hero.z = 20; g.hero.vz = 3; g.hero.state = 'air';
    s.grabHero ? (g.hero.hurtable && s.grabHero(g.hero)) : null;
    T.steps(60);
    return { state: g.hero.state, z: +g.hero.z.toFixed(1) };
  });

  const pass = {
    hitstopCarry: Object.values(results.hitstopCarry).every(r => r.ok),
    specialDuringAttack: Object.values(results.specialDuringAttack).every(Boolean),
    noAccidentalSpecial: results.noAccidentalSpecial.hpLost === 0,
    autoRunGrab: Object.values(results.autoRunGrab).every(r => r.grabbed),
    backThrow: results.backThrow.threw && results.backThrow.bystanderDamage <= 20,
    lowTargets: results.lowTargets.boltOnHound > 0 && results.lowTargets.bombAt100 > 0,
    staleTap: results.staleTap.scene === 'play' && results.staleTap.paused,
    quitRestores: results.quitRestores.scene === 'title' && results.quitRestores.musBus === results.quitRestores.musicVol && results.quitRestores.hiscore >= 123456,
    offscreenHits: results.offscreenHits.offHits === 0,
    rotatePauses: results.rotatePauses.overlay && results.rotatePauses.paused,
    airLatch: results.airLatch.z === 0,
  };
  console.log(JSON.stringify({ pass, results, errors }, null, 1));
  await browser.close();
  process.exit(Object.values(pass).every(Boolean) && !errors.length ? 0 : 1);
})().catch(e => { console.error('REGRESS FAILED', e); process.exit(2); });

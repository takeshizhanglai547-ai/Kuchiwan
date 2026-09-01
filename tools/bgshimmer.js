// スクロール中に背景・地形の模様がチラつかないことを実測する。
//
// 本編のフレーム全体で比べると、カメラの呼吸・ヒットストップのラトル・粒子・
// 敵の動きが混ざって非決定的になり、何を測っているのか分からなくなる（最初そう書いて、
// 同じ camX に戻しても 7000/14000 画素が変わった。原因は hitStop>2 の乱数ラトル）。
// そこで「480×270 のバッファへ背景と地面だけを描いて、そのまま読む」に絞る。
// 階調圧縮は画素位置とバッファ内容だけで決まるので、この比較で足りる。
//
// カメラを 0.25 論理（＝0.125ドット）ずつ滑らかに進め、「1コマ前との画素の差」を並べる。
// これが目に映るチラつきそのもの。ドット格子に乗っていれば大半のコマが 0 で、
// ドットを跨ぐ所だけまとまって変わる。乗っていなければ毎コマ変わり続ける。
//   NODE_PATH=/opt/node22/lib/node_modules node tools/bgshimmer.js <html> [themeIdx]
const { chromium } = require('playwright');
const path = require('path');
const FILE = process.argv[2] || 'beltaction_pixel.html';
const TH = +(process.argv[3] || 0);
const url = 'file://' + path.resolve(FILE);

(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const pg = await b.newPage({ viewport: { width: 1000, height: 620 } });
  const errs = [];
  pg.on('pageerror', e => errs.push(String(e)));
  await pg.goto(url);
  await pg.waitForTimeout(1000);
  await pg.evaluate(k => {
    STAGE2THEME[1] = k; stage = 1; bgCacheTheme = -1; bgCache = null;
    // 鳥・流れ星・環境粒は drawBackground を呼ぶたび前へ進む「アニメーション」で、
    // カメラの位相とは無関係。測りたいのは視差なので黙らせる
    Math.random = () => 0.5;
    birds.length = 0; shootStars.length = 0; amb.length = 0;
    updateAmbient = function () {}; drawAmbient = function () {};
    window.__REG = {
      '地面（奥の帯＋手前の起伏）': [4, 188, 240, 74],
      '遠景（山・中景・霞）': [4, 96, 240, 84],
      '空（帯とディザ）': [4, 8, 240, 60],
    };
    window.__prev = null;
    // 1回の呼び出しで描いて読んで差を数える。行き来を減らすほど、
    // 合間に本編のフレームが割り込む余地が減って測定が安定する
    window.__step = function (cx) {
      camX = cx; camY = 0; gf = 1200;
      pxBeginFrame();
      drawBackground(); drawGround(); drawForeground();
      const out = {};
      const cur = {};
      for (const nm in window.__REG) {
        const r = window.__REG[nm];
        const d = pxCtx.getImageData(r[0], r[1], r[2], r[3]).data;
        cur[nm] = d;
        if (window.__prev) {
          const p = window.__prev[nm];
          let n = 0;
          for (let i = 0; i < d.length; i += 4)
            if (d[i] !== p[i] || d[i + 1] !== p[i + 1] || d[i + 2] !== p[i + 2]) n++;
          out[nm] = n;
        } else out[nm] = -1;
      }
      window.__prev = cur;
      return out;
    };
  }, TH);

  const names = await pg.evaluate(() => Object.keys(window.__REG));
  const rows = {}; names.forEach(n => rows[n] = []);
  await pg.evaluate(() => window.__step(900));
  for (let k = 1; k <= 24; k++) {
    const r = await pg.evaluate(v => window.__step(v), 900 + k * 0.25);
    for (const n of names) rows[n].push(r[n]);
  }
  for (const n of names) {
    const total = await pg.evaluate(nm => window.__REG[nm][2] * window.__REG[nm][3], n);
    const z = rows[n].filter(v => v === 0).length;
    console.log(n.padEnd(26) + ' 画素数' + total + '  静止コマ ' + z + '/24');
    console.log('   1コマ前との差: ' + rows[n].join(' '));
  }
  if (errs.length) { console.log('ERRORS', errs.slice(0, 5)); process.exitCode = 1; }
  else console.log('no page errors');
  await b.close();
})();

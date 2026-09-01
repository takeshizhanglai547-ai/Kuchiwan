// ══════════════════════════════════════════════════════════════════
//  背景・地形・照明のドット絵化
// ══════════════════════════════════════════════════════════════════
// 本編の背景は「なめらかなグラデ＋半透明の霞＋放射グラデのヴィネット」で
// 出来ている。480×270 へ落とすとこれが全部ぼやけた汚れになるので、ここで
//
//   1. 空・霞・ヴィネット … createLinearGradient/RadialGradient を捨て、
//      段（6〜10帯）＋秩序ディザに置き換える
//   2. 地面 … 平らな塗りをやめ、材質ごとのタイル模様をワールド座標へ
//      固定して敷く（スクロールで模様がドット格子から外れると必ずチラつく）
//   3. 前景・遠景 … ぼかしを使わず、1色ベタ＋硬い輪郭・段で割った大気遠近
//
// 全部を差し替えるのではなく「毎フレーム走る重い所」を優先する。
// ctx.filter と全画面ぼかしは使わない（過去に 60fps→2.9fps の事故がある）。
(function () {

  //================================================================
  //  0. 道具
  //================================================================
  const D = PXU;                              // 1ドット＝論理2単位
  const fl = v => Math.floor(v / D) * D;      // ドット格子へ切り下げ
  const ce = v => Math.ceil(v / D) * D;
  const B4 = PX_BAYER4;                       // 4×4 Bayer（0..15）

  // 数フレーム周期で色を送る＝パレットサイクル。ドット絵の水面・溶岩・灯りはこれで動く
  const cyc = (arr, per) => arr[((gf / (per || 6)) | 0) % arr.length];

  // 配列の色をなめらかに拾う（段に割る前の元色を作るため）
  function ramp(cols, t) {
    if (t <= 0) return cols[0];
    if (t >= 1) return cols[cols.length - 1];
    const f = t * (cols.length - 1), i = f | 0;
    return pxMix(cols[i], cols[i + 1], f - i);
  }
  // 空の4色（0 / .45 / .8 / 1 の位置に置かれている）から n 段を作る
  function skyCols(sk, n) {
    const st = [0, 0.45, 0.8, 1], out = [];
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0 : i / (n - 1);
      let k = 0; while (k < 2 && t > st[k + 1]) k++;
      out.push(pxMix(sk[k], sk[k + 1], (t - st[k]) / (st[k + 1] - st[k])));
    }
    return out;
  }

  // 絶対座標の格子で市松を打つ。pxDitherRect は矩形の左上を格子の原点に取るので、
  // 1ドット高の帯を並べて使うと位相が揃わない（段の境目が縞にならない）。
  // ここは必ず「今のユーザ座標」から格子を決める
  function stipple(x, y, w, h, col, ratio) {
    if (ratio <= 0) return;
    const x0 = fl(x), y0 = fl(y), x1 = ce(x + w), y1 = ce(y + h);
    if (x1 <= x0 || y1 <= y0) return;
    ctx.fillStyle = col;
    if (ratio >= 1) { ctx.fillRect(x0, y0, x1 - x0, y1 - y0); return; }
    const th = ratio * 16;
    for (let cy = y0; cy < y1; cy += D) {
      const row = ((cy / D) & 3) << 2;
      for (let cx = x0; cx < x1; cx += D)
        if (B4[row | ((cx / D) & 3)] < th) ctx.fillRect(cx, cy, D, D);
    }
  }

  // 同じ市松を、毎フレーム走る所では「1ドットずつ fillRect」ではなく
  // 4×4ドットのパターンを1回 fillRect して打つ。
  // 実測（tools/bgcost.js・王都）：帯の境目と地平の影を素直にドットで打つと
  // 背景ひと揃いで ctx 呼び出しが 8777 回・5.27ms になり、16.7ms の予算の三分の一を
  // 背景だけで食っていた。パターンに畳むと同じ絵のまま呼び出しが激減する。
  // 位相はユーザ座標の原点に固定されるので、ドット格子から外れない
  const _dpCv = {}, _dp = {};
  function ditherBand(x, y, w, h, col, ratio) {
    if (ratio <= 0) return;
    const x0 = fl(x), y0 = fl(y), x1 = ce(x + w), y1 = ce(y + h);
    if (x1 <= x0 || y1 <= y0) return;
    if (ratio >= 1) { ctx.fillStyle = col; ctx.fillRect(x0, y0, x1 - x0, y1 - y0); return; }
    const q = Math.max(1, Math.round(ratio * 8)) / 8, k = col + '|' + q;
    let p = _dp[k];
    if (!p) {
      let c = _dpCv[k];
      if (!c) {
        c = document.createElement('canvas'); c.width = c.height = D * 4;
        const g = c.getContext('2d'); g.fillStyle = col;
        const th = q * 16;
        for (let yy = 0; yy < 4; yy++) for (let xx = 0; xx < 4; xx++)
          if (B4[(yy << 2) | xx] < th) g.fillRect(xx * D, yy * D, D, D);
        _dpCv[k] = c;
      }
      p = ctx.createPattern(c, 'repeat'); _dp[k] = p;
    }
    ctx.fillStyle = p; ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
  }

  // ドット解像度で焼くスプライト。論理座標へ置くときは w*D / h*D の大きさで出す
  // （世界バッファの変換 0.5 と打ち消し合って必ず 1:1 になる＝にじまない）
  const _spr = {};
  function dotSprite(key, w, h, fn) {
    let s = _spr[key]; if (s) return s;
    w = Math.max(1, w | 0); h = Math.max(1, h | 0);
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d'), img = g.createImageData(w, h), d = img.data;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const v = fn(x, y); if (!v) continue;
      const o = (y * w + x) * 4;
      d[o] = v[0]; d[o + 1] = v[1]; d[o + 2] = v[2]; d[o + 3] = v[3] == null ? 255 : v[3];
    }
    g.putImageData(img, 0, 0);
    _spr[key] = c; return c;
  }
  function blit(spr, x, y) {
    ctx.save(); ctx.imageSmoothingEnabled = false;
    ctx.drawImage(spr, fl(x), fl(y), spr.width * D, spr.height * D);
    ctx.restore();
  }

  // 市松のパターン。光芒の「抜き」に使う（半透明の全面塗りをやめる）
  const _chkCv = {};
  function checker(col, dense) {
    const k = col + '|' + (dense ? 1 : 0);
    let c = _chkCv[k];
    if (!c) {
      c = document.createElement('canvas'); c.width = c.height = D * 2;
      const g = c.getContext('2d'); g.fillStyle = col;
      g.fillRect(0, 0, D, D); g.fillRect(D, D, D, D);
      if (dense) g.fillRect(D, 0, D, D);
      _chkCv[k] = c;
    }
    return ctx.createPattern(c, 'repeat');
  }

  // 今の変換の平行移動を「ドット1個」へ丸める。世界バッファは 480×270 なので
  // デバイス1px＝1ドット。ここを丸めないと、camY や画面揺れの端数のぶんだけ
  // 背景の焼き絵ごと半ドットずれて、全体がにじむ
  function snapTransform() {
    const M = ctx.getTransform();
    ctx.save();
    ctx.setTransform(M.a, M.b, M.c, M.d, Math.round(M.e), Math.round(M.f));
  }

  //================================================================
  //  1. 空 ── 段とディザで作る
  //================================================================
  // buildSkyCache はテーマごとに1度しか走らない。つまり「毎フレーム走らない所で
  // 贅沢に作り込む」のが正解の場所で、ここは何をしても実行時の負荷にならない
  buildSkyCache = function (T, ti) {
    bgCacheTheme = ti;
    bgCache = document.createElement('canvas');
    bgCache.width = W; bgCache.height = GROUND_TOP + 30;
    const c = bgCache.getContext('2d');
    const keep = ctx; ctx = c;
    try { paintSky(T); } finally { ctx = keep; }
  };

  function paintSky(T) {
    const HH = GROUND_TOP + 30;
    // ── 帯 ──────────────────────────────────────────────
    // 段数は「空の高さ÷ドット」で決める。9段なら1帯が約22ドット高で、
    // 境目のディザ（上下2ドットずつ）が帯を食い潰さない
    const N = 9, cols = skyCols(T.sky, N), seg = HH / N;
    for (let i = 0; i < N; i++) {
      const y0 = i ? fl(i * seg) : 0, y1 = (i === N - 1) ? HH : fl((i + 1) * seg);
      ctx.fillStyle = cols[i]; ctx.fillRect(0, y0, W, y1 - y0);
    }
    // 境目を市松で噛み合わせる。上の色が下へ・下の色が上へ2ドットずつ食い込む
    for (let i = 1; i < N; i++) {
      const p = fl(i * seg);
      stipple(0, p - D * 2, W, D, cols[i], 0.30);
      stipple(0, p - D, W, D, cols[i], 0.55);
      stipple(0, p, W, D, cols[i - 1], 0.55);
      stipple(0, p + D, W, D, cols[i - 1], 0.30);
    }

    // ── 日輪 ────────────────────────────────────────────
    const cdx = fl(W * T.sunX), cdy = fl(T.sunY);
    const sun = pxRGB(T.sun + '1)');
    const sunS = pxHex(sun[0], sun[1], sun[2]);
    const R0 = T.stars ? 132 : 176;
    // 段で割ったコロナ。外側2段は薄くして、硬い円が輪郭として見えないようにする
    ctx.save();
    for (let i = 7; i >= 1; i--) {
      ctx.globalAlpha = (0.055 + 0.035 * (7 - i)) * (i >= 6 ? 0.7 : 1);
      pxCircle(cdx, cdy, R0 * i / 7, sunS, true);
    }
    ctx.restore();
    // 日輪本体。disc で色を差し替えられる（炎上する空で白い太陽が浮くのを防ぐ）
    const disc = T.disc || (T.stars ? '#eef3ff' : '#fff7dc');
    pxCircle(cdx, cdy, T.stars ? 34 : 40, pxMix(disc, '#ffffff', 0.15), true);
    pxCircle(cdx, cdy, T.stars ? 26 : 30, disc, true);
    pxCircle(cdx - 6, cdy - 8, T.stars ? 12 : 15, pxMix(disc, '#ffffff', 0.45), true);
    if (T.stars) {                                   // 月の海
      const cr = pxMix(disc, '#6a7a9e', 0.5);
      pxCircle(cdx - 10, cdy - 6, 8, cr, true);
      pxCircle(cdx + 12, cdy + 10, 6, cr, true);
      pxCircle(cdx + 4, cdy - 14, 4, cr, true);
    }

    // ── 光芒 ────────────────────────────────────────────
    // lighter の半透明三角ではなく、市松で抜いた光の筋にする。
    // 低解像度では「薄い膜」より「粗い網」のほうが光として読める
    if (T.rays > 0.03) {
      ctx.save();
      ctx.fillStyle = checker(sunS, T.rays > 0.15);
      ctx.globalAlpha = Math.min(0.5, 0.32 + T.rays);
      for (let i = 0; i < 9; i++) {
        const a = -0.62 + i * 0.24, wd = 0.055 + (i % 3) * 0.02;
        ctx.beginPath(); ctx.moveTo(cdx, cdy);
        ctx.lineTo(cdx + Math.cos(a) * 1500, cdy + Math.sin(a) * 1500);
        ctx.lineTo(cdx + Math.cos(a + wd) * 1500, cdy + Math.sin(a + wd) * 1500);
        ctx.closePath(); ctx.fill();
      }
      ctx.restore();
    }
  }

  // ── 雲 ── 放射グラデのスプライトをやめ、段で割った塊にする
  cloud = function (x, y, r) {
    const s = cloudSpr(r);
    blit(s, x - s.width * D * 0.5, y - s.height * D * 0.5);
  };
  function cloudSpr(r) {
    const R = Math.max(6, Math.round(r / D / 2) * 2);       // ドット単位の半径
    const w = R * 4, h = (R * 2.4) | 0;
    const bl = [[w * 0.50, h * 0.56, R * 0.66], [w * 0.50 + R * 0.62, h * 0.64, R * 0.50],
                [w * 0.50 - R * 0.62, h * 0.66, R * 0.46], [w * 0.50 + R * 0.22, h * 0.40, R * 0.48],
                [w * 0.50 - R * 0.20, h * 0.46, R * 0.40]];
    return dotSprite('cl' + R, w, h, function (x, y) {
      let hit = false, top = 1e9;
      for (let i = 0; i < bl.length; i++) {
        const b = bl[i], dx = x + 0.5 - b[0], dy = (y + 0.5 - b[1]) * 1.30;
        if (dx * dx + dy * dy < b[2] * b[2]) {
          hit = true;
          const ty = b[1] - Math.sqrt(Math.max(0, b[2] * b[2] - dx * dx)) / 1.30;
          if (ty < top) top = ty;
        }
      }
      if (!hit) return null;
      const rel = y - top;                                  // てっぺんからの深さで段に割る
      if (rel < 1) return [255, 255, 252, 240];
      if (rel < R * 0.5) return [246, 248, 252, 228];
      if (rel < R * 0.9) return [216, 224, 238, 208];
      if (rel < R * 1.3) return [190, 200, 220, 190];
      return [172, 182, 205, 170];
    });
  }

  // ── 背景全体をドット格子へ乗せる ──
  // 本編は camY の視差ぶんを translate で入れてから drawBackground を呼ぶ。
  // その端数を丸めないと、焼いた空が半ドットずれて全面がにじむ
  const rawBackground = drawBackground;
  drawBackground = function () {
    snapTransform();
    try { rawBackground(); } finally { ctx.restore(); }
  };

  //================================================================
  //  2. 霞 ── 縦グラデをやめ、密度で段を作る
  //================================================================
  // hazeGrad の戻り値は fillStyle にそのまま入る。段＋ディザで焼いた1枚を
  // パターンとして返せば、呼び出し側（drawBackground / drawLand / drawRidgeRow）を
  // 一切触らずに大気遠近だけをドット絵にできる。
  // パターンの原点はユーザ座標の (0,0)＝グラデと同じ基準なので、位置もずれない
  const _hzPat = {};
  hazeGrad = function (T, ti) {
    let p = _hzPat[ti]; if (p) return p;
    // 濃さは y だけで決まり、市松の横の周期は4ドットしかない。だから幅は
    // 8論理（＝4ドット）で足り、横は repeat で敷き詰める。
    // 実測（tools/bgparts.js・電脳都市）：960幅の no-repeat で焼くと
    // drawBackground が 0.81→2.24ms になり、細い repeat で 1.0ms 台まで戻った
    const c = document.createElement('canvas');
    c.width = D * 4; c.height = GROUND_TOP + 90;
    const g = c.getContext('2d');
    const keep = ctx; ctx = g;
    const CW = c.width;
    try {
      const col = _rgba(T.haze), base = pxHex(col[0], col[1], col[2]);
      const solid = 'rgba(' + col[0] + ',' + col[1] + ',' + col[2] + ',' + Math.min(1, col[3] * 1.5).toFixed(3) + ')';
      const y0 = fl(150), y1 = c.height, LV = 8;       // 密度の段数
      for (let y = y0; y < y1; y += D) {
        const t = (y - y0) / (GROUND_TOP - y0);
        // 地平線に近いほど濃い。1.0 で頭打ちにせず 0.74 で止める
        // （地平線付近が単色に潰れると、かえって奥行きが消える）
        const raw = Math.min(0.74, 0.05 + 0.80 * Math.pow(Math.min(1.15, t), 1.25));
        // 霞は市松ではなくベタの半透明で乗せる。
        // 空のほぼ全面を覆う膜なので、ここを市松で作ると画面全体が網点になる
        // （監査で「新聞写真に見える」と指摘された主因。孤立市松ドットの割合を
        //  層ごとに切って測ったところ、背景だけで 4.3ポイントを占めていた）。
        // 段割りは 00_core.js の階調圧縮（14段）が受け持ち、段の境目は
        // そこの秩序ディザが崩す。膜の側で二重に割る必要はない。
        ctx.globalAlpha = Math.min(1, col[3] * 1.5) * (Math.round(raw * LV) / LV);
        ctx.fillStyle = base;
        ctx.fillRect(0, y, CW, D);
        ctx.globalAlpha = 1;
      }
      // いちばん奥だけ薄いベタを重ねて、網目が粗く見えるのを抑える。
      // ここを1枚のベタで敷くと、始まりの行が硬い横線として画面に出るので、
      // 濃さを4段に割って入れる（実測：ベタ1枚だと業火の渓谷で y=312 に線が出た）
      const y2 = fl(GROUND_TOP - 60);
      for (let k = 0; k < 4; k++) {
        ctx.globalAlpha = col[3] * 0.30 * ((k + 1) / 4);
        ctx.fillStyle = base;
        const a = y2 + fl((y1 - y2) * k / 4), b2 = y2 + fl((y1 - y2) * (k + 1) / 4);
        ctx.fillRect(0, a, CW, (k === 3 ? y1 : b2) - a);
      }
      ctx.globalAlpha = 1;
    } finally { ctx = keep; }
    // 横だけ繰り返す。縦は 0〜GROUND_TOP+90 の範囲でしか使われないので折り返さない
    p = ctx.createPattern(c, 'repeat-x');
    _hzPat[ti] = p; return p;
  };

  //================================================================
  //  3. 遠景 ── レイヤーごとに1〜2色のベタ＋硬い輪郭
  //================================================================
  // 山。稜線は三角波の折れ線なので、列ごとに高さを求めて縦の矩形で積む＝
  // 段のついたシルエットになる。視差の位置はドットへ丸める（丸めないと
  // 稜線が1ドット未満で行き来して、スクロール中にチラつく）
  drawMountains = function () {
    const T = curTheme(), yb = fl(GROUND_TOP - 24), hz = _rgba(T.haze);
    const nL = 3, cw = D * 4;
    for (let layer = 0; layer < nL; layer++) {
      const b = _rgba(shade(T.tower, -4 - layer * 16)), t = 0.66 - layer * 0.26;
      const face = pxHex(b[0] * (1 - t) + hz[0] * t, b[1] * (1 - t) + hz[1] * t, b[2] * (1 - t) + hz[2] * t);
      const lip = pxMix(face, '#ffffff', 0.16 + layer * 0.04);   // 光の当たる稜線の1ドット
      const step = 210 - layer * 40;
      const off = fl(((-(camX * (0.09 + layer * 0.05))) % step + step) % step);
      const kh = k => (96 + ((((k * 37 + layer * 53) % 70) + 70) % 70)) * (1.32 - layer * 0.22);
      const n = ((W / cw) | 0) + 2, hs = new Array(n);
      for (let i = 0; i < n; i++) {
        const sx = i * cw, k = Math.floor((sx + off) / step);
        const u = (sx - (k * step - off)) / step, h = kh(k);
        hs[i] = fl(yb - (u < 0.5 ? h * u * 2 : h * (1 - u) * 2));
      }
      ctx.fillStyle = face;
      for (let i = 0; i < n; i++) ctx.fillRect(i * cw, hs[i], cw, yb + 40 - hs[i]);
      ctx.fillStyle = lip;
      for (let i = 0; i < n; i++) ctx.fillRect(i * cw, hs[i], cw, D);
      if (layer === nL - 1) {                                    // 雪冠は最前列だけ
        ctx.fillStyle = 'rgba(255,255,255,.30)';
        for (let i = 0; i < n; i++) if (hs[i] < yb - 60) ctx.fillRect(i * cw, hs[i], cw, D * 4);
      }
    }
  };

  // land 未指定テーマの尾根。段で折る
  drawRidgeRow = function (T) {
    const par = 0.62, baseY = fl(GROUND_TOP - 2), bw = 124, cw = D * 4;
    const c1 = landCol(T, shade(T.tower, -16), par), c2 = landCol(T, shade(T.tower, -30), par);
    const off = fl(((camX * par) % bw + bw) % bw);
    const n = ((W / cw) | 0) + 2;
    for (let i = 0; i < n; i++) {
      const sx = i * cw, k = Math.floor((sx + off) / bw);
      const u = (sx - (k * bw - off)) / bw;
      const h = 64 + Math.abs((k * 47) % 78);
      // 本編の5点の折れ線（左裾→肩→頂→肩→右裾）を、同じ比率で近似する
      const prof = u < 0.28 ? (u / 0.28) * 0.62
                 : u < 0.50 ? 0.62 + ((u - 0.28) / 0.22) * 0.38
                 : u < 0.74 ? 1 - ((u - 0.50) / 0.24) * 0.48
                 : ((1 - u) / 0.26) * 0.52;
      const col = (k % 2) ? c1 : c2;
      const ty = fl(baseY - h * Math.max(0, prof));
      ctx.fillStyle = col; ctx.fillRect(sx, ty, cw, baseY + 12 - ty);
      ctx.fillStyle = pxMix(col, '#ffffff', 0.15); ctx.fillRect(sx, ty, cw, D);
    }
    ctx.fillStyle = hazeGrad(T, themeIdxFor(stage)); ctx.fillRect(0, GROUND_TOP - 70, W, 70);
  };

  // ── 中景（LAND テーブル）の位相をドット格子へ乗せる ──
  // LAND の20種は landRidge / landRow の2つの原始関数の上に建っている。
  // ここを丸めれば、テーマごとの生成関数を1つも触らずに中景全体が
  // 「1ドットずつ飛ぶ」動きになる。
  // 実測（tools/bgshimmer.js・王都）：丸める前は camX を 0.19（ドット未満）動かすだけで
  // 遠景の 2843/20160 画素が変わっていた＝視差で絵が連続的に泳いでいた
  landRidge = function (col, par, yb, fn, stepPx) {
    const st = Math.max(D * 2, ce(stepPx || 22));
    const wo = fl(camX * par);                       // 世界の位相をドットへ丸める
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.moveTo(-st, GROUND_TOP + 10);
    for (let sx = -st; sx <= W + st; sx += st) {
      const y = fl(yb - fn(sx + wo));                // 稜線は階段で折る（斜線にしない）
      ctx.lineTo(sx, y); ctx.lineTo(sx + st, y);
    }
    ctx.lineTo(W + st * 2, GROUND_TOP + 10);
    ctx.closePath(); ctx.fill();
  };
  landRow = function (par, step, fn) {
    const base = ((camX * par) % step + step) % step, n = Math.ceil(W / step) + 3;
    for (let i = -1; i < n; i++) fn(fl(i * step - base), Math.floor((camX * par) / step) + i);
  };

  // 城と市場門は camX*0.28 の生の座標で呼ばれる。基準点だけ丸めれば中身も乗る
  const rawCastle = drawCastle, rawGate = drawMarketGate;
  drawCastle = function (cx, top) { rawCastle(fl(cx), fl(top)); };
  drawMarketGate = function (cx, top) { rawGate(fl(cx), fl(top)); };

  // 手前の巨大シルエットは自前で視差を計算している（par=1.26）。
  // 中を書き換えずに乗せるため、呼ぶ間だけ camX を「視差を掛けるとドットに乗る値」へ寄せる
  const rawFgSil = drawFgSilhouettes;
  drawFgSilhouettes = function (T) {
    const par = 1.26, keep = camX;
    camX = fl(camX * par) / par;
    try { rawFgSil(T); } finally { camX = keep; }
  };

  // 塔。左右のグラデを3段のベタへ（毎フレーム12本ぶんの createLinearGradient も消える）
  drawTower = function (x, y, w, h, col, haze) {
    x = fl(x); y = fl(y); w = ce(w); h = ce(h);
    ctx.fillStyle = shade(col, 14); ctx.fillRect(x, y, ce(w * 0.34), h);
    ctx.fillStyle = col; ctx.fillRect(x + ce(w * 0.34), y, ce(w * 0.34), h);
    ctx.fillStyle = shade(col, -26); ctx.fillRect(x + ce(w * 0.68), y, w - ce(w * 0.68), h);
    ctx.fillStyle = shade(col, -42);
    for (let i = 0; i < w; i += D * 7) ctx.fillRect(x + i, y, D * 4, D * 4);      // 胸壁
    // 円錐屋根。段は2ドット刻みにし、明側・暗側で2周に分ける
    // （1行ごとに fillStyle を差し替えると、塔12本で ctx 呼び出しが1000回を超える）
    const rc = '#3b6fb5', rd = shade(rc, -30), rh = D * 22, cxm = x + fl(w / 2);
    ctx.fillStyle = rc;
    for (let i = 0; i < rh; i += D * 2) { const ww = ce((w + 12) * (i / rh) * 0.5); ctx.fillRect(cxm - ww, y - rh + i, ww, D * 2); }
    ctx.fillStyle = rd;
    for (let i = 0; i < rh; i += D * 2) { const ww = ce((w + 12) * (i / rh) * 0.5); ctx.fillRect(cxm, y - rh + i, ww, D * 2); }
    ctx.fillStyle = '#c0392b'; ctx.fillRect(cxm - D, y - rh - D * 8, D, D * 8);
    ctx.fillStyle = '#d23'; ctx.fillRect(cxm, y - rh - D * 8, D * 7, D * 3);
  };

  // 町並み。窓の 16px 文字は 480×270 では読めないので、看板はベタの板にする
  drawBuildings = function (lit) {
    const par = 0.62, baseY = fl(GROUND_TOP - 2), bw = 146;
    const cols = ['#caa15a', '#b9854a', '#d8b56b', '#a8753c', '#c69a55'];
    const roofs = ['#9c3b2e', '#7a3528', '#b5503a'];
    const off = (camX * par) % bw;
    for (let i = -1; i < 14; i++) {
      const gx = fl(i * bw - off - bw), k = Math.floor((camX * par) / bw) + i;
      if (gx > W + 20 || gx < -bw - 40) continue;
      const h = ce(92 + Math.abs((k * 53) % 64)), y = baseY - h, bwn = ce(bw - 8);
      const wall = cols[((k % cols.length) + cols.length) % cols.length];
      // 壁は3段。左が明・右が暗（光源は上手にある）
      ctx.fillStyle = shade(wall, 16); ctx.fillRect(gx, y, ce(bwn * 0.36), h);
      ctx.fillStyle = wall; ctx.fillRect(gx + ce(bwn * 0.36), y, ce(bwn * 0.34), h);
      ctx.fillStyle = shade(wall, -26); ctx.fillRect(gx + ce(bwn * 0.70), y, bwn - ce(bwn * 0.70), h);
      ctx.fillStyle = 'rgba(60,34,14,.65)';                    // 硬い輪郭
      ctx.fillRect(gx, y, bwn, D); ctx.fillRect(gx, y + h - D, bwn, D);
      ctx.fillRect(gx, y, D, h); ctx.fillRect(gx + bwn - D, y, D, h);
      const roof = roofs[((k % roofs.length) + roofs.length) % roofs.length];
      const rh = D * 19, cxm = gx + fl(bwn / 2);               // 切妻屋根も段で割る
      ctx.fillStyle = roof;
      for (let r = 0; r < rh; r += D * 2) { const ww = ce((bwn * 0.5 + 10) * (r / rh)); ctx.fillRect(cxm - ww, y - rh + r, ww, D * 2); }
      ctx.fillStyle = shade(roof, -24);
      for (let r = 0; r < rh; r += D * 2) { const ww = ce((bwn * 0.5 + 10) * (r / rh)); ctx.fillRect(cxm, y - rh + r, ww, D * 2); }
      // 窓。灯りは3段（芯・光・こぼれ）にする。ぼかさずに光って見せる
      let wi = 0;
      for (const wx0 of [gx + D * 10, gx + bwn - D * 27]) {
        const wx = fl(wx0), wy = y + D * 11, ww = D * 15, wh = D * 17;
        if (lit && (((k * 7 + wi) % 3) === 0)) {
          ctx.fillStyle = '#7a4a1c'; ctx.fillRect(wx - D, wy - D, ww + D * 2, wh + D * 2);
          ctx.fillStyle = '#ffcf66'; ctx.fillRect(wx, wy, ww, wh);
          ctx.fillStyle = cyc(['#ffe6a0', '#ffd882', '#ffe6a0', '#fff0c0'], 5);
          ctx.fillRect(wx + D, wy + D, ww - D * 2, wh - D * 3);
          if (Math.sin(gf * 0.05 + k * 3 + wi) > 0)
            ditherBand(wx - D * 3, wy - D * 2, ww + D * 6, wh + D * 5, '#ffbf50', 0.25);
        } else {
          ctx.fillStyle = lit ? '#26405c' : '#bfe4ff'; ctx.fillRect(wx, wy, ww, wh);
          ctx.fillStyle = lit ? '#16263a' : '#3a6a8c'; ctx.fillRect(wx, wy + fl(wh / 2), ww, wh - fl(wh / 2));
          ctx.fillStyle = '#5a3a1c';
          ctx.fillRect(wx - D, wy - D, ww + D * 2, D); ctx.fillRect(wx - D, wy + wh, ww + D * 2, D);
          ctx.fillRect(wx - D, wy, D, wh); ctx.fillRect(wx + ww, wy, D, wh);
        }
        ctx.fillStyle = '#5a3a1c';
        ctx.fillRect(wx + fl(ww / 2), wy, D, wh); ctx.fillRect(wx, wy + fl(wh / 2), ww, D);
        wi++;
      }
      if (((k % 3) + 3) % 3 === 0) {                            // 看板（文字は出さない）
        const sy = y + h - D * 21;
        ctx.fillStyle = '#5a3a1c'; ctx.fillRect(gx + D * 17, sy, bwn - D * 40, D * 15);
        ctx.fillStyle = '#3a2410'; ctx.fillRect(gx + D * 17, sy, bwn - D * 40, D);
        ctx.fillStyle = (k % 2) ? '#ffe6b0' : '#d9b45a';
        ctx.fillRect(gx + D * 20, sy + D * 4, bwn - D * 46, D * 3);
        ctx.fillRect(gx + D * 20, sy + D * 9, ce((bwn - D * 46) * 0.6), D * 3);
      }
    }
  };

  //================================================================
  //  4. 地面 ── 材質タイル＋段
  //================================================================
  // 石畳・土・草・金属床を 4〜16ドット周期のタイルで作る。タイルは
  // 「ワールド座標に固定」でなければならない。カメラの端数がそのまま
  // パターンの位相になると、スクロール中に模様が1ドット未満で泳ぐ＝チラつく。
  // 位相は必ず fl() でドットへ丸めてから渡す
  const TILE = 32;                                   // 論理32＝16ドット周期
  const _tileCv = {}, _tilePat = {};
  function tileCanvas(T, ti) {
    let c = _tileCv[ti]; if (c) return c;
    c = document.createElement('canvas'); c.width = c.height = TILE;
    const g = c.getContext('2d');
    const put = (x, y, w, h, col) => { g.fillStyle = col; g.fillRect(x * D, y * D, w * D, h * D); };
    const rn = n => { const v = Math.sin(n * 127.1 + 311.7) * 43758.5453; return v - Math.floor(v); };
    const mat = T.gsnd || 'stone';
    const dk = 'rgba(0,0,0,.46)', dk2 = 'rgba(0,0,0,.26)', lt = 'rgba(255,246,220,.30)';
    if (mat === 'stone') {
      // 石畳：8×4ドットの石を半目地ずらしで積む。目地を暗く、天端を明るく
      for (let row = 0; row < 4; row++) {
        const oy = row * 4, sh = (row & 1) ? 4 : 0;
        for (let cx = 0; cx < 16; cx += 8) {
          const x = (cx + sh) % 16;
          put(x, oy, 7, 3, ((row + cx / 8) & 1) ? 'rgba(255,255,255,.10)' : 'rgba(0,0,0,.10)');
          put(x, oy, 7, 1, lt);
          put(x, oy + 3, 8, 1, dk);
          put((x + 7) % 16, oy, 1, 3, dk2);
        }
      }
    } else if (mat === 'wood') {
      for (let row = 0; row < 4; row++) {
        put(0, row * 4, 16, 1, lt);
        put(0, row * 4 + 3, 16, 1, dk);
        for (let x = 0; x < 16; x += 2) if (rn(row * 17 + x) > 0.62) put(x, row * 4 + 1, 2, 1, dk2);
      }
      put(5, 0, 1, 8, dk); put(11, 8, 1, 8, dk);      // 板の継ぎ目
    } else if (mat === 'metal') {
      put(0, 0, 16, 1, dk); put(0, 0, 1, 16, dk);      // 8ドット角の鉄板
      put(8, 0, 1, 16, dk); put(0, 8, 16, 1, dk);
      put(1, 1, 15, 1, lt); put(1, 9, 15, 1, lt);
      for (const p of [[2, 2], [6, 2], [2, 6], [6, 6], [10, 10], [14, 10], [10, 14], [14, 14]])
        put(p[0], p[1], 1, 1, 'rgba(255,240,210,.30)');
      for (const p of [[10, 2], [14, 6], [2, 10], [6, 14]]) put(p[0], p[1], 1, 1, dk);
    } else if (mat === 'grass') {
      // 草は「点」ではなく「株」。1〜2ドットの縦棒を寄せて生やすと草叢に見える
      for (let i = 0; i < 22; i++) {
        const x = (rn(i * 3.1) * 16) | 0, y = (rn(i * 7.7) * 16) | 0, up = rn(i) > 0.45;
        put(x, y, 1, up ? 2 : 1, 'rgba(0,34,4,.34)');
        put((x + 1) % 16, y, 1, 1, rn(i * 5) > 0.5 ? 'rgba(226,255,180,.30)' : 'rgba(0,26,4,.22)');
      }
    } else if (mat === 'snow') {
      for (let i = 0; i < 14; i++) {
        const x = (rn(i * 2.3) * 16) | 0, y = (rn(i * 9.1) * 16) | 0;
        put(x, y, 3, 1, 'rgba(255,255,255,.42)');
        put((x + 1) % 16, (y + 1) % 16, 2, 1, 'rgba(110,142,186,.30)');
      }
    } else {                                          // sand / dirt など：粒と踏み跡
      for (let i = 0; i < 34; i++) {
        const x = (rn(i * 4.3) * 16) | 0, y = (rn(i * 8.9) * 16) | 0, v = rn(i * 1.7);
        put(x, y, v > 0.8 ? 2 : 1, 1, v > 0.66 ? 'rgba(255,240,200,.28)' : v > 0.33 ? dk2 : 'rgba(0,0,0,.18)');
      }
      put(0, 5, 16, 1, 'rgba(0,0,0,.14)'); put(0, 12, 16, 1, 'rgba(0,0,0,.14)');
      put(3, 5, 6, 1, 'rgba(255,240,200,.14)'); put(10, 12, 5, 1, 'rgba(255,240,200,.14)');
    }
    // タイルの基調色をうっすら乗せて、テーマの石の色が伝わるようにする
    g.globalAlpha = 0.16;
    g.fillStyle = T.cob[0]; g.fillRect(0, 0, TILE, TILE / 2);
    g.fillStyle = T.cob[1]; g.fillRect(0, TILE / 2, TILE, TILE / 2);
    g.globalAlpha = 1;
    _tileCv[ti] = c; return c;
  }
  // タイルを敷く。位相は fl(camX) なので必ずドットの倍数＝ワールド座標に固定される。
  // sq を渡すと模様を縦に半分へ潰す。ちょうど 1/2 なので 16ドットのタイルが
  // 8ドットになり、格子から外れない。奥の床だけこれを使うと、同じ石畳のまま
  // 「遠いから目地が詰まって見える」＝空気遠近ではない、幾何の遠近が出る。
  //
  // 位相を CanvasPattern.setTransform（DOMMatrix）で与えると、ヘッドレス検証の
  // 環境に DOMMatrix が無くて例外になる（実際に tests/mecha が
  // 「テーマ25 の背景で例外: DOMMatrix is not defined」で落ちた）。
  // ctx 側の平行移動と拡縮で同じことをする
  // 何枚も敷くので、変換とパターンの設定は1回だけにして矩形だけを並べる
  function tileBegin(T, ti, sq) {
    let p = _tilePat[ti];
    if (!p) { p = ctx.createPattern(tileCanvas(T, ti), 'repeat'); _tilePat[ti] = p; }
    const ox = fl(camX) % TILE, k = sq ? 0.5 : 1;
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.translate(-ox, 0);
    if (sq) ctx.scale(1, k);
    ctx.fillStyle = p;
    return { ox: ox, k: k };
  }
  function tileRect(t, x, y, w, h) { if (w > 0 && h > 0) ctx.fillRect(x + t.ox, y / t.k, w, h / t.k); }

  drawGround = function () {
    const T = curTheme(), ti = themeIdxFor(stage);
    snapTransform();
    try { paintGround(T, ti); } finally { ctx.restore(); }
  };

  function paintGround(T, ti) {
    // 坂の傾きは 0.02 刻みへ量子化する。連続値のまません断すると、遠景の帯と
    // タイル模様が毎フレーム1ドット未満で動いてチラつく。段で持てば動かない
    const raw = TERRS.length ? clamp(terrTilt(camX + W * 0.5) * 0.55, -0.19, 0.19) : 0;
    const sl = Math.round(raw / 0.02) * 0.02;
    const GT = fl(GROUND_TOP - camY * 0.8);
    const VB = ce(H - camY + 12);                     // この変換で画面下端になるユーザ座標
    // 手前の地面の稜線。高さは列ごとに1度だけ求める（層ごとに overPit を呼ぶと5回引く）。
    // ここで先に求めておくと、奥の床を「稜線より上」だけ塗れる＝無駄塗りが消える
    const cw = D * 4, n = ((W / cw) | 0) + 2, tys = new Array(n);
    let topRidge = VB;
    for (let i = 0; i < n; i++) {
      const wx = i * cw + camX;
      const ty = overPit(wx) ? -1 : fl(LANE - groundLift(wx));
      tys[i] = ty;
      if (ty >= 0 && ty < topRidge) topRidge = ty;
    }
    ctx.save();
    if (sl) { ctx.translate(W * 0.5, 0); ctx.transform(1, -sl, 0, 1, 0, 0); ctx.translate(-W * 0.5, 0); }
    const OVER = ce(Math.abs(sl) * W * 0.6 + 8);

    // ── 奥の地面：7段の帯 ──
    // 本編のグラデは画面外の BOT まで伸びていて、画面に映る所は g[0]〜g[1] の間しか
    // 使っていない。段で割るときも同じ範囲に留める（g[2] まで振り切ると、その下に
    // 続く手前の地面（g[0] の明るい表土）と明暗が逆転して床が折り返して見える）。
    // 併せて、奥の段ほど霞の色へ寄せる＝床にも空気遠近を掛ける
    const hz = _rgba(T.haze);
    const farCol = t => {
      const b = pxRGB(ramp(T.g, t * 0.58)), k = 0.24 * (1 - t);
      return pxHex(b[0] + (hz[0] - b[0]) * k, b[1] + (hz[1] - b[1]) * k, b[2] + (hz[2] - b[2]) * k);
    };
    const NB = 7, far = Math.max(GT + D * 8, fl(LANE));
    for (let i = 0; i < NB; i++) {
      const y0 = GT + fl((far - GT) * i / NB);
      const y1 = (i === NB - 1) ? VB + OVER : GT + fl((far - GT) * (i + 1) / NB);
      if (y0 > VB + OVER) break;
      ctx.fillStyle = farCol(i / (NB - 1));
      ctx.fillRect(-OVER, y0, W + OVER * 2, y1 - y0);
    }
    for (let i = 1; i < NB; i++) {                    // 段の境目を市松で噛ませる
      const p = GT + fl((far - GT) * i / NB);
      if (p > VB) break;
      ditherBand(-OVER, p - D, W + OVER * 2, D, farCol(i / (NB - 1)), 0.5);
      ditherBand(-OVER, p, W + OVER * 2, D, farCol((i - 1) / (NB - 1)), 0.5);
    }
    // 材質のタイル（ワールド固定・奥は縦半分に潰して遠近を出す）
    const tf = tileBegin(T, ti, true);
    tileRect(tf, -OVER, GT, W + OVER * 2, Math.min(VB, topRidge + D * 2) + OVER - GT);
    ctx.restore();
    // 地平の際：床と中景の境目。ここに硬い1ドットの線と段の落ち影を置かないと、
    // 床と奥の絵が同じ明度で溶けて「地平線が無い絵」になる
    ditherBand(-OVER, GT, W + OVER * 2, D, 'rgba(0,0,0,.62)', 1);
    ditherBand(-OVER, GT + D, W + OVER * 2, D * 2, 'rgba(0,0,0,.46)', 1);
    ditherBand(-OVER, GT + D * 3, W + OVER * 2, D * 2, 'rgba(0,0,0,.40)', 0.62);
    ditherBand(-OVER, GT + D * 5, W + OVER * 2, D * 2, 'rgba(0,0,0,.34)', 0.30);
    ctx.restore();

    // ── 谷（落とし穴）──
    const pitC = ['#1a1826', '#111020', '#0a0912', '#000000'], pitH = [D * 5, D * 7, D * 10];
    for (let i = 0; i < PITS.length; i++) {
      const pit = PITS[i], x0 = fl(pit[0] - camX), x1 = ce(pit[1] - camX);
      if (x1 < -30 || x0 > W + 30) continue;
      const top = fl(LANE - Math.max(groundLift(pit[0]), groundLift(pit[1])) - 2);
      let y = top;
      for (let k = 0; k < 3; k++) {
        ctx.fillStyle = pitC[k]; ctx.fillRect(x0, y, x1 - x0, pitH[k]);
        ditherBand(x0, y + pitH[k] - D, x1 - x0, D, pitC[k + 1], 0.5);
        y += pitH[k];
      }
      ctx.fillStyle = pitC[3]; ctx.fillRect(x0, y, x1 - x0, Math.max(0, VB - y));
      ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(x0, top, x1 - x0, D);   // 縁の硬い線
    }

    // ── 手前の起伏した地面（稜線 tys は上で求めてある）──
    // 層：稜線の光 → 表土 → 中 → 底。fillStyle の切り替えを4回に抑える
    const layers = [[shade(T.g[0], 52), 0, D], [shade(T.g[0], 12), D, D * 3],
                    [T.g[1], D * 4, D * 6], [T.g[2], D * 10, 0]];
    for (let L = 0; L < layers.length; L++) {
      const col = layers[L][0], o = layers[L][1], hgt = layers[L][2];
      ctx.fillStyle = col;
      for (let i = 0; i < n; i++) {
        const ty = tys[i]; if (ty < 0) continue;
        const y = ty + o, h = hgt || (VB - y);
        if (h > 0) ctx.fillRect(i * cw, y, cw, h);
      }
    }
    // 層の境目を市松で（パターンの位相はユーザ座標に固定なので、列をまたいでも揃う）
    for (const pair of [[T.g[1], D * 4], [T.g[2], D * 10]])
      for (let i = 0; i < n; i++) {
        const ty = tys[i]; if (ty < 0) continue;
        ditherBand(i * cw, ty + pair[1] - D, cw, D, pair[0], 0.5);
      }
    // 材質のタイル。列ごとに敷く（クリップより速く、模様はワールド固定のまま）
    const tn = tileBegin(T, ti, false);
    for (let i = 0; i < n; i++) {
      const ty = tys[i]; if (ty < 0) continue;
      tileRect(tn, i * cw, ty + D, cw, VB - ty - D);
    }
    ctx.restore();
    drawFloorLights(T);
  }

  // ── 床の光溜まりと映り込み ──
  // 放射グラデのスプライトは低解像度で灰色の靄になる。段で割った楕円＋
  // 縦の市松に置き換える。焼いた1枚を drawImage するだけなので毎フレーム軽い
  function poolSpr(rgb) {
    const c = pxRGB('rgb(' + rgb + ')');
    return dotSprite('pl' + rgb, 72, 20, function (x, y) {
      const dx = (x - 36) / 34, dy = (y - 10) / 9, r = Math.sqrt(dx * dx + dy * dy);
      if (r >= 1) return null;
      const q = Math.floor((1 - r) * 4) / 4;                          // 4段
      if (q <= 0) return null;
      if (B4[((y & 3) << 2) | (x & 3)] / 16 > q * 0.92) return null;  // 段の外周をディザで抜く
      return [c[0], c[1], c[2], 40 + 150 * q];
    });
  }
  function reflSpr(rgb) {
    const c = pxRGB('rgb(' + rgb + ')');
    return dotSprite('rf' + rgb, 16, 66, function (x, y) {
      const q = Math.floor((1 - y / 66) * (1 - y / 66) * (1 - Math.abs(x - 7.5) / 8) * 5) / 5;
      if (q <= 0) return null;
      if (B4[((y & 3) << 2) | (x & 3)] / 16 > q) return null;
      return [c[0], c[1], c[2], 60 + 130 * q];
    });
  }
  drawFloorLights = function (T) {
    const rows = [{ par: 0.84, step: 520, bias: 90, rgb: '255,214,130' },
                  { par: 0.92, step: 440, bias: 210, rgb: '255,150,60' }];
    ctx.save();
    for (const r of rows) {
      const off = fl(((camX * r.par) % r.step + r.step) % r.step);
      const pool = poolSpr(r.rgb), refl = reflSpr(r.rgb);
      for (let i = -1; i < Math.ceil(W / r.step) + 1; i++) {
        const sx = fl(i * r.step - off + r.bias);
        if (sx < -90 || sx > W + 90) continue;
        const wx = sx + camX; if (overPit(wx)) continue;
        const gy = fl(LANE - groundLift(wx));
        // 明滅は4段に量子化する。連続値だと階調圧縮の境目で床全体がバタつく
        ctx.globalAlpha = 0.62 + 0.12 * (Math.round((0.5 + 0.5 * Math.sin(gf * 0.09 + sx)) * 3) / 3);
        blit(pool, sx - pool.width * D * 0.5, gy - D * 3);
        blit(refl, sx - refl.width * D * 0.5, gy - D * 3);
      }
    }
    ctx.globalAlpha = 1; ctx.restore();
  };

  //================================================================
  //  5. 灯り ── 街灯と篝火（放射グラデを段のリングへ）
  //================================================================
  function glowSpr(key, R, col) {
    const c = pxRGB('rgb(' + col + ')');
    return dotSprite('gl' + key, R * 2, R * 2, function (x, y) {
      const dx = x - R + 0.5, dy = y - R + 0.5, r = Math.sqrt(dx * dx + dy * dy) / R;
      if (r >= 1) return null;
      const q = Math.floor((1 - r) * 5) / 5;
      if (q <= 0) return null;
      if (B4[((y & 3) << 2) | (x & 3)] / 16 > q * 1.15) return null;
      return [c[0], c[1], c[2], 24 + 190 * q * q];
    });
  }
  drawLamp = function (x, baseY) {
    x = fl(x); baseY = fl(baseY);
    const top = baseY - D * 78;
    ctx.fillStyle = '#241f1a'; ctx.fillRect(x - D, top, D * 2, D * 78);
    ctx.fillStyle = '#1c1813'; ctx.fillRect(x - D * 5, baseY - D, D * 10, D * 3);
    ctx.fillStyle = '#241f1a'; ctx.fillRect(x, top, D * 10, D * 2);              // 腕木
    ctx.fillStyle = '#2e2820'; ctx.fillRect(x + D * 6, top + D * 2, D * 8, D * 8);
    const gx = x + D * 10, gy = top + D * 6;
    ctx.save(); ctx.globalAlpha = 0.78;
    blit(glowSpr('lamp', 26, '255,196,90'), gx - 26 * D, gy - 26 * D);
    ctx.restore();
    ctx.fillStyle = '#ffb43c'; ctx.fillRect(gx - D * 3, gy - D * 3, D * 6, D * 6);
    // 炎の色をコマ送りで回す＝パレットサイクル。灯りが「生きている」ように見える
    ctx.fillStyle = cyc(['#fff4c8', '#ffe9a8', '#fff0bc', '#ffdf94'], 5);
    ctx.fillRect(gx - D * 2, gy - D * 2, D * 4, D * 4);
  };
  drawBraziers = function (T) {
    const par = 0.92, step = 440, off = fl(((-(camX * par)) % step + step) % step);
    const spr = glowSpr('braz', 34, '255,150,60');
    const f0 = cyc(['#ffe9a0', '#fff6c8', '#ffdf80'], 4);
    const f1 = cyc(['#ff9a3a', '#ffb452', '#ff8a2a'], 4);
    const f2 = cyc(['#d0421a', '#e05a22', '#c03a16'], 4);
    for (let x = -step; x < W + step; x += step) {
      const bx = fl(x - off + 210), by = fl(GROUND_TOP + 34);
      if (bx < -60 || bx > W + 60) continue;
      ctx.fillStyle = '#241d16'; ctx.fillRect(bx - D, by - D * 17, D * 2, D * 17);
      ctx.fillStyle = '#3a2f24'; ctx.fillRect(bx - D * 6, by - D * 19, D * 12, D * 4);
      ctx.fillStyle = '#241d16'; ctx.fillRect(bx - D * 5, by - D * 22, D * 10, D * 3);
      ctx.save(); ctx.globalAlpha = 0.55;
      blit(spr, bx - 34 * D, by - D * 26 - 34 * D);
      ctx.restore();
      // 炎は3段の塊。高さだけ揺らす（形を毎フレーム変えるとドットが暴れる）
      const h = D * (7 + Math.round(Math.sin(gf * 0.25 + bx) * 2 + 2));
      ctx.fillStyle = f2; ctx.fillRect(bx - D * 5, by - D * 22 - h, D * 10, h);
      ctx.fillStyle = f1; ctx.fillRect(bx - D * 3, by - D * 22 - h - D * 3, D * 6, h);
      ctx.fillStyle = f0; ctx.fillRect(bx - D, by - D * 22 - h - D * 5, D * 2, h - D);
    }
  };

  //================================================================
  //  6. 前景 ── 1色ベタ＋硬い輪郭。ぼかしは使わない
  //================================================================
  drawForeground = function () {
    const T = curTheme(), par = 1.4, cw = D * 4;
    snapTransform();
    const body = shade(T.g[2], -18), edge = shade(T.g[2], -46), tip = shade(T.g[2], 2);
    const n = ((W / cw) | 0) + 2, hs = new Array(n);
    const px0 = fl(camX * par);
    for (let i = 0; i < n; i++) {
      const wx = i * cw + px0;
      hs[i] = fl(14 + Math.sin(wx * 0.02) * 5 + Math.sin(wx * 0.053 + 1.7) * 4);
    }
    ctx.fillStyle = body;
    for (let i = 0; i < n; i++) ctx.fillRect(i * cw, H - hs[i], cw, hs[i] + D * 4);
    ctx.fillStyle = edge;                                    // 硬い輪郭（ぼかさない）
    for (let i = 0; i < n; i++) ctx.fillRect(i * cw, H - hs[i], cw, D);
    ctx.fillStyle = tip;                                     // 草の穂は1ドット幅で立てる
    for (let i = 0; i < n; i += 3) {
      const sw = fl(Math.sin(gf * 0.05 + (i * cw + px0) * 0.3) * 4), hh = D * (4 + (i % 3));
      ctx.fillRect(i * cw + sw, H - hs[i] - hh, D, hh);
    }
    ctx.restore();
    drawFgSilhouettes(T);
  };

  //================================================================
  //  7. 照明 ── 段で割ったヴィネットとディザで抜いた光
  //================================================================
  // 全画面のなめらかな放射グラデは低解像度で必ず汚くなる。
  // テーマの色被せ・日輪のブルーム・ヴィネットを1枚のドットスプライトへ
  // 焼き込み、毎フレームは drawImage 1回だけにする（本編より軽い）
  const _vigC = new Map();
  function vigSprite(T, ti, dv) {
    const key = ti + '|' + dv;
    let s = _vigC.get(key); if (s) return s;
    if (_vigC.size > 6) _vigC.clear();                // 1枚 480×270×4B。溜め込まない
    const w = PX.W, h = PX.H;
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d'), img = g.createImageData(w, h), d = img.data;
    const tn = T.tint ? _rgba(T.tint) : null;
    const vg = _rgba(T.vig), sn = pxRGB(T.sun + '1)');
    const sx0 = w * T.sunX, sy0 = T.sunY * 0.5, bR = h * 0.9;
    const cx = w * 0.5, cy = h * 0.48, ri = h * 0.28 / dv, ro = h * 0.88, LV = 14;
    let i = 0;
    for (let y = 0; y < h; y++) {
      const brow = (y & 3) << 2;
      for (let x = 0; x < w; x++, i += 4) {
        // 画面いっぱいの膜（色被せ・日輪ブルーム・ヴィネット）に Bayer を混ぜると、
        // 暗部が黒との50%市松になって画面全体が網点に見える（目視監査の主因）。
        // ここは段数を増やして素直に割り、段の境目を崩す仕事は
        // 00_core.js の階調圧縮側の秩序ディザに任せる。
        // bay は残してあるが 0 なので、段の中は必ずベタになる
        const bay = 0;
        let R = 0, G = 0, Bb = 0, A = 0;
        if (tn) { R = tn[0]; G = tn[1]; Bb = tn[2]; A = tn[3]; }
        const dxs = x - sx0, dys = y - sy0, ds = Math.sqrt(dxs * dxs + dys * dys) / bR;
        if (ds < 1) {                                  // 日輪のブルームを4段で
          const ba = 0.13 * (Math.floor((1 - ds) * (1 - ds) * 10 + bay) / 10);
          if (ba > 0.001) {
            const na = ba + A * (1 - ba), k = A * (1 - ba);
            R = (sn[0] * ba + R * k) / na; G = (sn[1] * ba + G * k) / na; Bb = (sn[2] * ba + Bb * k) / na;
            A = na;
          }
        }
        A *= 0.55;                                     // 本編の drawImage(alpha .55) 相当
        let t = (Math.sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy)) - ri) / (ro - ri);
        if (t > 0) {
          const q = Math.min(1, Math.floor((t > 1 ? 1 : t) * LV + bay) / LV);
          const va = vg[3] * q;
          if (va > 0.001) {
            const na = va + A * (1 - va), k = A * (1 - va);
            R = (vg[0] * va + R * k) / na; G = (vg[1] * va + G * k) / na; Bb = (vg[2] * va + Bb * k) / na;
            A = na;
          }
        }
        if (A <= 0.004) continue;
        d[i] = R; d[i + 1] = G; d[i + 2] = Bb; d[i + 3] = A * 255;
      }
    }
    g.putImageData(img, 0, 0);
    _vigC.set(key, c); return c;
  }
  // 瀕死の赤フチ。段で4枚に割ってディザで抜く（加算合成も全画面グラデも使わない）
  function rimSpr() {
    const w = PX.W, h = PX.H;
    return dotSprite('lowrim', w, h, function (x, y) {
      const dx = (x - w * 0.5) / (w * 0.5), dy = (y - h * 0.5) / (h * 0.5);
      const t = (Math.sqrt(dx * dx * 0.86 + dy * dy) - 0.60) / 0.52;
      if (t <= 0) return null;
      const q = Math.min(1, Math.floor((t > 1 ? 1 : t) * 4 + B4[((y & 3) << 2) | (x & 3)] / 16) / 4);
      if (q <= 0) return null;
      return [216, 30, 34, 255 * q];
    });
  }

  const rawLighting = drawLighting;
  drawLighting = function () {
    if (!PX.on || ctx !== pxCtx) { rawLighting(); return; }   // 等倍側へ描いている時は本編のまま
    const T = curTheme(), ti = themeIdxFor(stage);
    const pl = (state === 'play') ? (activePlayers().filter(q => q.state !== 'dead')[0] || null) : null;
    const hpR = pl ? clamp(pl.hp / pl.maxHp, 0, 1) : 1;
    const lowP = (hpR < 0.30 && !attractOn) ? (0.42 + 0.20 * Math.sin(gf * 0.16)) : 0;
    // dv は 1/4 刻みへ量子化する。連続値のままだと毎フレーム焼き直しになる
    const dv = Math.round((1 + lowP + (slowmo > 0 ? 0.26 : 0)) * 4) / 4;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(vigSprite(T, ti, dv), 0, 0);
    if (lowP > 0) {
      ctx.globalAlpha = 0.34 + 0.24 * (Math.round(Math.sin(gf * 0.16) * 3 + 3) / 6);
      ctx.drawImage(rimSpr(), 0, 0);
      ctx.globalAlpha = 1;
    }
    if (slowmo > 0) {                                  // 時間が寝ている感触。ベタ1枚で足りる
      ctx.fillStyle = 'rgba(52,86,190,' + (0.10 * clamp(slowmo / 14, 0, 1)).toFixed(3) + ')';
      ctx.fillRect(0, 0, PX.W, PX.H);
    }
    ctx.restore();
  };

  //================================================================
  //  8. 水・足場 ── パレットサイクルで動かす
  //================================================================
  // 増水の水面。なめらかなグラデ＋lighter の細線をやめ、
  // 深さで3段に割ったディザと、コマ送りで色を送るきらめきにする
  drawFlood = function () {
    if (!flood.on || flood.lvl <= 2) return;
    const x0 = fl(Math.max(flood.x0 - camX, -20)), x1 = ce(Math.min(flood.x1 - camX, W + 20));
    if (x1 <= x0) return;
    const cw = D * 4, bot = ce(H + 40);
    const surf = cyc(['#78d2ff', '#96e2ff', '#78d2ff', '#5ec0f0'], 7);
    const glit = cyc(['#ffffff', '#d6f6ff', '#a8e8ff', '#d6f6ff'], 5);
    ctx.save();
    for (let sx = x0; sx < x1; sx += cw) {
      const wx = sx + camX;
      const sy = fl(LANE - groundLift(wx) - flood.lvl
                  + Math.sin(wx * 0.010 + gf * 0.06) * 5 + Math.sin(wx * 0.023 - gf * 0.04) * 3);
      ditherBand(sx, sy, cw, D * 6, 'rgba(120,205,255,.34)', 1);
      ditherBand(sx, sy + D * 6, cw, D * 10, 'rgba(46,130,205,.44)', 1);
      ditherBand(sx, sy + D * 5, cw, D, 'rgba(46,130,205,.44)', 0.5);
      ditherBand(sx, sy + D * 16, cw, bot - sy - D * 16, 'rgba(16,60,120,.54)', 1);
      ditherBand(sx, sy + D * 15, cw, D, 'rgba(16,60,120,.54)', 0.5);
      ctx.fillStyle = surf; ctx.fillRect(sx, sy, cw, D);           // 水面の稜線
      if ((((wx * 0.25 + gf * 0.4) | 0) % 5) === 0) { ctx.fillStyle = glit; ctx.fillRect(sx, sy + D * 2, D * 2, D); }
    }
    ctx.restore();
  };

  // 浮き足場。角丸と半透明の照りをやめ、段で割った板にする
  drawPlatforms = function () {
    if (!PLATS.length) return;
    const T = curTheme();
    for (let i = 0; i < PLATS.length; i++) {
      const P = PLATS[i], x0 = fl(P.x0 - camX), x1 = ce(P.x1 - camX);
      if (x1 < -60 || x0 > W + 60) continue;
      const gy = fl(LANE - groundLift((P.x0 + P.x1) * 0.5)), y = fl(gy - P.h), wd = x1 - x0;
      ditherBand(x0 + D * 2, gy - D, wd - D * 4, D * 3, 'rgba(0,0,0,.32)', 0.55);    // 落ち影
      ctx.fillStyle = shade(T.g[2], -22); ctx.fillRect(x0, y - D, wd, D * 14);    // 厚み
      ctx.fillStyle = shade(T.g[1], -4); ctx.fillRect(x0, y - D * 5, wd, D * 5);  // 側面
      ctx.fillStyle = shade(T.g[0], 26); ctx.fillRect(x0, y - D * 6, wd, D * 4);  // 天板
      ctx.fillStyle = shade(T.g[0], 58); ctx.fillRect(x0 + D * 2, y - D * 6, wd - D * 4, D);
      ctx.fillStyle = 'rgba(16,12,8,.62)';                                        // 硬い輪郭
      ctx.fillRect(x0, y - D * 6, wd, D); ctx.fillRect(x0, y + D * 13, wd, D);
      ctx.fillRect(x0, y - D * 6, D, D * 20); ctx.fillRect(x1 - D, y - D * 6, D, D * 20);
      ctx.fillStyle = shade(T.g[2], -30);                                         // 端の受け
      ctx.fillRect(x0 + D, y + D * 9, D * 8, D * 11);
      ctx.fillRect(x1 - D * 9, y + D * 9, D * 8, D * 11);
    }
  };

})();

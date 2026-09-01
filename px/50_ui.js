// ══════════════════════════════════════════════════════════════════
//  UI をドット絵に組み直す（HUD・タイトル・地図・店・キャラ選択）
// ══════════════════════════════════════════════════════════════════
// 世界は 480×270 のバッファへ落ちるが、UI は等倍（960×540）側で描く。
// 日本語を 6px にすると一切読めないので、この二層構成は core が作っている。
//
// ここでやるのは「等倍のまま、密度だけ世界と揃える」こと。
//   ・すべての図形を 2px 格子（＝世界のドット1個ぶん）へ丸める
//   ・角丸をやめ、1〜2ドットの面取りにする
//   ・なめらかなグラデを段で割る（ゲージも背景も）
//   ・パネルの外へ「彫った金の額縁」を回す
//   ・大きな文字は半分の大きさで焼いてから2倍に拡大する＝本物のドット文字
//   ・小さな日本語は等倍のまま。ただし濃い縁を回して背景から浮かせる
//
// 本編には一切触らない。共通の下請け（roundRect / panel / barFrame …）を
// 差し替えると、それを使う画面すべてが同時にドット絵になる。
(function () {
  if (typeof pxDisp === 'undefined' || typeof PX_SC === 'undefined') return;
  // ヘッドレス検証（tests/nm_head.js）は canvas も 2D コンテキストも Proxy に
  // 差し替える。core はそれを PX_REAL で見分けて転送を丸ごと畳むので、
  // こちらも同じ判断に従って何もしない。Proxy へ getImageData を流すと
  // （ドット文字を焼く工程がまさにそれ）スイートが止まる
  if (typeof PX_REAL !== 'undefined' && !PX_REAL) return;

  const D = pxDisp;              // 等倍の表示コンテキスト（HUDとUIはここへ描かれる）
  const U = PX_SC;               // 2 = 世界のドット1個ぶんの論理長さ
  const sn = v => Math.round(v / U) * U;
  // 大きさは 0 に丸めない。1.5px の「先端のエッジライト」や、削られた量を出す
  // 残像チップが消えてしまうため、0 より大きければ必ず1ドット残す
  const dm = v => { const s = Math.round(v / U) * U; return s < U ? (v > 0 ? U : 0) : s; };

  // ── 素の（差し替え前の）キャンバスAPI。差し替えた後もこちらを呼ぶ ──
  const NAT = {
    fillRect: D.fillRect, strokeRect: D.strokeRect,
    fillText: D.fillText, strokeText: D.strokeText,
    arc: D.arc, createLinearGradient: D.createLinearGradient,
    fill: D.fill, beginPath: D.beginPath, rect: D.rect,
  };
  const NAT_clip = D.clip;
  const NF = (c, x, y, w, h) => NAT.fillRect.call(c, x, y, w, h);

  // UI を描いている間だけ立てる旗。世界の描画（pxCtx）には一切かからないが、
  // 表示側でも「UI以外の用途」に誤爆しないよう明示的に囲う
  let uiOn = 0;

  //────────────────────────────────────────────────────────────────
  //  色
  //────────────────────────────────────────────────────────────────
  // 金は3段＋影＋ハイライトの5階調。中世の写本の箔押しは、
  // なめらかに光るのではなく「明・中・暗」の面で割れて見える
  const P = {
    ink0: '#05040a', ink1: '#0e0b16', ink2: '#171326', ink3: '#241c38',
    gHi: '#ffefb4', gLt: '#ffd24d', gMd: '#c08a1e', gLo: '#7a5210', gDk: '#3a2405',
    sHi: '#8c7f6a', sMd: '#4c4339', sLo: '#211c15', sDk: '#0d0b08',
  };
  const PAL = {
    gold: { hi: P.gHi, lt: P.gLt, md: P.gMd, lo: P.gLo, dk: P.gDk },
    stone: { hi: P.sHi, lt: '#6d6252', md: P.sMd, lo: P.sLo, dk: P.sDk },
  };

  // アルファまで扱う色の分解と混色（pxMix は rgba の a を落としてしまう）
  function col4(c) {
    if (typeof c !== 'string') return [136, 136, 136, 1];
    if (c[0] === '#') {
      let n = c.slice(1);
      if (n.length === 3 || n.length === 4) n = n.split('').map(ch => ch + ch).join('');
      return [parseInt(n.substr(0, 2), 16), parseInt(n.substr(2, 2), 16), parseInt(n.substr(4, 2), 16),
        n.length >= 8 ? parseInt(n.substr(6, 2), 16) / 255 : 1];
    }
    const m = c.match(/-?[\d.]+/g);
    if (!m) return [136, 136, 136, 1];
    return [+m[0] | 0, +m[1] | 0, +m[2] | 0, m.length > 3 ? +m[3] : 1];
  }
  const rgba4 = a => 'rgba(' + (a[0] | 0) + ',' + (a[1] | 0) + ',' + (a[2] | 0) + ',' + a[3] + ')';
  function mix4(a, b, t) {
    const A = col4(a), B = col4(b);
    return rgba4([A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t,
      A[2] + (B[2] - A[2]) * t, A[3] + (B[3] - A[3]) * t]);
  }

  //────────────────────────────────────────────────────────────────
  //  2px 格子に乗る図形
  //────────────────────────────────────────────────────────────────
  function R(x, y, w, h, col) { const c = ctx; if (col) c.fillStyle = col; NF(c, sn(x), sn(y), dm(w), dm(h)); }
  function RG(g, x, y, w, h, col) { g.fillStyle = col; g.fillRect(sn(x), sn(y), dm(w), dm(h)); }
  // 枠（中を塗らない矩形リング）。太さ t は必ずドットの倍数
  function ring(x, y, w, h, t, col) {
    R(x, y, w, t, col); R(x, y + h - t, w, t, col);
    R(x, y + t, t, h - t * 2, col); R(x + w - t, y + t, t, h - t * 2, col);
  }
  function ringG(g, x, y, w, h, t, col) {
    RG(g, x, y, w, t, col); RG(g, x, y + h - t, w, t, col);
    RG(g, x, y + t, t, h - t * 2, col); RG(g, x + w - t, y + t, t, h - t * 2, col);
  }

  // 直前に組んだパスの当たり枠。fill() のときに「どこを段で塗るか」を知るために持つ。
  // 手で組んだパス（moveTo/lineTo）では null のままになり、素の fill へ落ちる
  let _pb = null;
  // 面取り（角を斜め45度に落とす）した多角形のパス。角丸の置き換え
  function bevelOn(c, x, y, w, h, cut) {
    x = sn(x); y = sn(y); w = dm(w); h = dm(h);
    let k = sn(cut == null ? U * 2 : cut);
    k = Math.max(0, Math.min(k, Math.floor(Math.min(w, h) / 2 / U) * U - U));
    c.beginPath();
    if (c === D) _pb = { x, y, w, h };
    if (k <= 0) { c.rect(x, y, w, h); return; }
    c.moveTo(x + k, y); c.lineTo(x + w - k, y); c.lineTo(x + w, y + k);
    c.lineTo(x + w, y + h - k); c.lineTo(x + w - k, y + h); c.lineTo(x + k, y + h);
    c.lineTo(x, y + h - k); c.lineTo(x, y + k); c.closePath();
  }
  // 面取り矩形のベタ塗り（線ではなく面で描くので、太さが必ずドットに乗る）
  function bevelFill(x, y, w, h, cut, col) { const c = ctx; bevelOn(c, x, y, w, h, cut); c.fillStyle = col; c.fill(); }

  //────────────────────────────────────────────────────────────────
  //  角丸をやめる：roundRect / bevelPath を面取りへ差し替える
  //────────────────────────────────────────────────────────────────
  // 半径をそのまま面取り量にすると 12〜18px の大きな斜めになって
  // 「切り落とした八角形」に見える。2〜6px（1〜3ドット）に抑える
  const cutOf = r => Math.max(U, Math.min(U * 3, sn(r || U)));
  if (typeof roundRect === 'function') roundRect = function (x, y, w, h, r) { bevelOn(ctx, x, y, w, h, cutOf(r)); };
  if (typeof roundRectOn === 'function') roundRectOn = function (g, x, y, w, h, r) { bevelOn(g, x, y, w, h, cutOf(r)); };
  if (typeof bevelPath === 'function') bevelPath = function (x, y, w, h, c) { bevelOn(ctx, x, y, w, h, cutOf(c)); };
  // UI 定数表の角丸も面取り量へ寄せておく（直に UI.r を見る箇所のため）
  if (typeof UI === 'object' && UI && UI.r) { UI.r.s = U; UI.r.m = U * 2; UI.r.l = U * 3; UI.ink = 'rgba(10,8,18,.86)'; }

  //────────────────────────────────────────────────────────────────
  //  彫った金の額縁
  //────────────────────────────────────────────────────────────────
  // 外周＝暗い線、内側＝金の帯（明→中→暗の3段）、四隅に飾り。
  // ornPaint はサイズごとにスプライトへ焼かれるので、毎フレームの負荷はゼロ
  function cornerJewel(g, x, y, sx, sy, pal) {
    // 角の宝珠：菱形の飾りと、そこから2辺へ伸びる明るい鉤
    const p = (dx, dy, w, h, c) => RG(g, x + (sx > 0 ? dx : -dx - w), y + (sy > 0 ? dy : -dy - h), w, h, c);
    p(0, 0, 10, 2, pal.hi); p(0, 2, 2, 8, pal.hi);          // 鉤（外周に沿う明るい線）
    p(4, 4, 2, 2, pal.hi);                                   // 珠の芯
    p(2, 4, 2, 2, pal.lt); p(6, 4, 2, 2, pal.lt);
    p(4, 2, 2, 2, pal.lt); p(4, 6, 2, 2, pal.lt);
    p(2, 2, 2, 2, pal.dk); p(6, 6, 2, 2, pal.dk);            // 珠の陰
  }
  if (typeof ornPaint === 'function') {
    ornPaint = function (g, px, py, w, h, style) {
      const pal = PAL[style === 'stone' ? 'stone' : 'gold'];
      const P0 = (typeof ORN_PAD === 'number' ? ORN_PAD : 10);
      const x0 = sn(px - P0), y0 = sn(py - P0), ww = dm(w + P0 * 2), hh = dm(h + P0 * 2);
      // 帯は外から：暗線2 → 暗金2 → 金2 → 明金2 → 暗線2（＝ちょうど 10px の張り出し）
      ringG(g, x0, y0, ww, hh, U, P.ink0);
      ringG(g, x0 + U, y0 + U, ww - U * 2, hh - U * 2, U, pal.lo);
      ringG(g, x0 + U * 2, y0 + U * 2, ww - U * 4, hh - U * 4, U, pal.md);
      ringG(g, x0 + U * 3, y0 + U * 3, ww - U * 6, hh - U * 6, U, pal.lt);
      ringG(g, x0 + U * 4, y0 + U * 4, ww - U * 8, hh - U * 8, U, P.ink0);
      // 上辺と左辺だけ明るくして「彫り」に見せる（光は左上から）
      RG(g, x0 + U * 5, y0 + U * 2, ww - U * 10, U, pal.hi);
      RG(g, x0 + U * 2, y0 + U * 5, U, hh - U * 10, pal.hi);
      RG(g, x0 + U * 5, y0 + hh - U * 3, ww - U * 10, U, pal.dk);
      RG(g, x0 + ww - U * 3, y0 + U * 5, U, hh - U * 10, pal.dk);
      // 帯の上に等間隔の鋲
      const st = Math.max(U * 8, sn(ww / 9));
      for (let bx = x0 + U * 6; bx < x0 + ww - U * 6; bx += st) {
        RG(g, bx, y0 + U * 3, U, U, pal.hi); RG(g, bx, y0 + hh - U * 4, U, U, pal.hi);
      }
      // 四隅の飾り
      cornerJewel(g, x0, y0, 1, 1, pal); cornerJewel(g, x0 + ww, y0, -1, 1, pal);
      cornerJewel(g, x0, y0 + hh, 1, -1, pal); cornerJewel(g, x0 + ww, y0 + hh, -1, -1, pal);
      // 上辺中央の銘（菱形）。ドット絵なので階段で組む
      const cx = sn(x0 + ww / 2);
      for (let i = 0; i < 5; i++) RG(g, cx - i * U, y0 + (4 - i) * U, (i * 2 + 1) * U, U, i === 4 ? pal.dk : (i < 2 ? pal.hi : pal.lt));
    };
  }
  // 額縁を貼る位置も2px格子へ（奇数座標に置くと世界のドットと半個ずれる）
  if (typeof panelOrn === 'function') {
    const rawOrnSprite = ornSprite;
    panelOrn = function (x, y, w, h, style) {
      x = sn(x); y = sn(y); w = dm(w); h = dm(h);
      panel(x, y, w, h);
      if (perfTier >= 2) return;
      const s = rawOrnSprite(w, h, style || 'gold'); if (!s) return;
      const g = ctx.imageSmoothingEnabled; ctx.imageSmoothingEnabled = false;
      ctx.drawImage(s, x - ORN_PAD, y - ORN_PAD); ctx.imageSmoothingEnabled = g;
    };
    ornRect = function (x, y, w, h, style) {
      if (perfTier >= 2) return;
      x = sn(x); y = sn(y); w = dm(w); h = dm(h);
      const s = rawOrnSprite(w, h, style || 'gold'); if (!s) return;
      const g = ctx.imageSmoothingEnabled; ctx.imageSmoothingEnabled = false;
      ctx.drawImage(s, x - ORN_PAD, y - ORN_PAD); ctx.imageSmoothingEnabled = g;
    };
  }

  //────────────────────────────────────────────────────────────────
  //  受け皿パネル
  //────────────────────────────────────────────────────────────────
  // 「暗い石板を彫って、上辺だけ金を通す」。段は2つだけ（明るい上半分と暗い下半分）で、
  // 境目に市松を1ドット食い込ませる。滑らかなグラデはここでは使わない
  if (typeof panel === 'function') {
    panel = function (x, y, w, h) {
      x = sn(x); y = sn(y); w = dm(w); h = dm(h);
      const k = Math.min(U * 3, Math.max(U, sn(h * 0.2)));
      bevelFill(x - U, y - U, w + U * 2, h + U * 2, k + U, P.ink0);   // 外周の暗い線
      bevelFill(x, y, w, h, k, P.ink2);                                // 上半分
      const my = sn(y + h * 0.5);
      R(x + U, my, w - U * 2, y + h - my - U, P.ink1);                 // 下半分
      const c = ctx; c.fillStyle = P.ink1;                             // 段の境目に市松
      for (let cx = sn(x + U * 2); cx < x + w - U * 2; cx += U * 2) NF(c, cx, my - U, U, U);
      R(x + k, y, w - k * 2, U, 'rgba(255,210,80,.62)');               // 上辺の金線
      R(x + k, y + h - U, w - k * 2, U, 'rgba(0,0,0,.55)');            // 下辺の落ち
      // 四隅の鉤。枠を閉じきらないことで抜けを残す
      const L = U * 5, gc = 'rgba(255,210,80,.55)';
      R(x + k, y + U, L, U, gc); R(x + w - k - L, y + U, L, U, gc);
      R(x + U, y + k, U, L, gc); R(x + w - U * 2, y + k, U, L, gc);
      R(x + k, y + h - U * 2, L, U, gc); R(x + w - k - L, y + h - U * 2, L, U, gc);
    };
  }

  //────────────────────────────────────────────────────────────────
  //  ゲージ
  //────────────────────────────────────────────────────────────────
  // 枠：暗線1ドット＋金の縁1ドット＋暗い受け皿。目盛りは4ドットおき
  if (typeof barFrame === 'function') {
    barFrame = function (x, y, w, h) {
      x = sn(x); y = sn(y); w = dm(w); h = dm(h);
      // 張り出しは1ドットだけ。本編はゲージを 6px 間隔で積んでいるので、
      // 2ドット張り出すと下のゲージ（経験値バー）を上から潰してしまう
      R(x - U, y - U, w + U * 2, h + U * 2, P.gDk);                    // 縁は黒ではなく暗い金
      R(x, y, w, h, '#0a0d16');
      R(x, y, w, U, '#1b2136');                                        // 受け皿の上縁だけ起こす
      if (w > 60 && h >= 6) {                                          // 計器に見せる目盛り
        const step = Math.max(U * 7, sn(w / 10)); ctx.fillStyle = 'rgba(0,0,0,.55)';
        for (let tx = sn(x + step); tx < x + w - U; tx += step) NF(ctx, tx, y, U, h);
      }
    };
  }
  // 塗りの上の光沢：上縁1ドットを明るく、下縁1ドットを落とし、斜めストライプを流す
  if (typeof barGloss === 'function') {
    barGloss = function (x, y, w, h) {
      if (w <= 0) return;
      x = sn(x); y = sn(y); w = Math.round(w / U) * U; h = dm(h);
      if (w <= 0) return;
      const c = ctx;
      c.fillStyle = 'rgba(255,255,255,.30)'; NF(c, x, y, w, U);
      c.fillStyle = 'rgba(0,0,0,.34)'; NF(c, x, y + h - U, w, U);
      c.fillStyle = 'rgba(255,255,255,.11)';
      for (let r = 0; r < h - U; r += U) {                              // 斜め45度の縞
        const off = (h - U - r);
        for (let i = -h; i < w; i += U * 6) { const px = x + i + off; if (px >= x && px + U * 2 <= x + w) NF(c, px, y + r, U * 2, U); }
      }
    };
  }

  //────────────────────────────────────────────────────────────────
  //  ドットの星（地図の推奨難度★・キーアイテム）
  //────────────────────────────────────────────────────────────────
  if (typeof drawStar === 'function') {
    const rawStar = drawStar;
    // 小さい★は多角形から起こすと十字にしか見えない。手で置いた型を使う
    const STAR5 = ['..1..', '.111.', '11111', '.111.', '.1.1.'];
    const STAR7 = ['...1...', '...1...', '.11111.', '.11111.', '..111..', '.11.11.', '.1...1.'];
    const _starPts = (r1, r2) => { const p = []; for (let v = 0; v < 10; v++) { const a = -Math.PI / 2 + v * Math.PI / 5, r = (v % 2 ? r1 : r2); p.push([Math.cos(a) * r, Math.sin(a) * r]); } return p; };
    drawStar = function (x, y, r1, r2, col) {
      if (!uiOn) return rawStar(x, y, r1, r2, col);
      const R2 = Math.max(1, Math.round(r2 / U));
      const cx = sn(x), cy = sn(y), c = ctx; c.fillStyle = col;
      if (R2 <= 3) {
        const rows = R2 <= 2 ? STAR5 : STAR7, hw = (rows[0].length - 1) / 2, hh = (rows.length - 1) / 2;
        for (let ry = 0; ry < rows.length; ry++) for (let rx = 0; rx < rows[ry].length; rx++)
          if (rows[ry][rx] !== '.') NF(c, cx + (rx - hw) * U, cy + (ry - hh) * U, U, U);
        return;
      }
      const pts = _starPts(r1, r2);
      for (let dy = -R2; dy <= R2; dy++) for (let dx = -R2; dx <= R2; dx++) {
        const px = dx * U, py = dy * U; let inside = false;   // 交差数で内外を判定
        for (let i = 0, j = 9; i < 10; j = i++) {
          if ((pts[i][1] > py) !== (pts[j][1] > py) &&
            px < (pts[j][0] - pts[i][0]) * (py - pts[i][1]) / (pts[j][1] - pts[i][1]) + pts[i][0]) inside = !inside;
        }
        if (inside) NF(c, cx + px, cy + py, U, U);
      }
    };
  }

  //────────────────────────────────────────────────────────────────
  //  大きな文字をドット絵として組む
  //────────────────────────────────────────────────────────────────
  // 半分の大きさで焼いて、アルファを閾値で切り（＝アンチエイリアスを殺し）、
  // 2倍に拡大する。これで「フォントの形をしたドット絵」になる。
  // ベタ塗りは3段、影は2段、輪郭は1ドット。
  const _texCache = new Map();
  const _tmp = () => { const c = document.createElement('canvas'); return c; };
  function halfFont(font) { return String(font).replace(/(\d+(?:\.\d+)?)px/, (m, s) => (parseFloat(s) / 2) + 'px'); }
  function fontPx(font) { const m = /(\d+(?:\.\d+)?)px/.exec(String(font)); return m ? parseFloat(m[1]) : 12; }

  function textSprite(txt, font, opt) {
    const key = txt + '|' + font + '|' + opt.k;
    const hit = _texCache.get(key); if (hit) return hit;
    if (_texCache.size > 120) _texCache.clear();
    const hf = halfFont(font), size = fontPx(font) / 2;
    // ① マスク（白ベタ＋閾値でアンチエイリアスを落とす）
    const mc = _tmp(); let mg = mc.getContext('2d', { willReadFrequently: true });
    mg.font = hf; const met = mg.measureText(txt);
    const tw = Math.ceil(met.width) + 2;
    const asc = Math.ceil(met.actualBoundingBoxAscent || size * 0.88);
    const desc = Math.ceil(met.actualBoundingBoxDescent || size * 0.24);
    if (!(tw > 0) || !(asc + desc > 0)) return null;
    const pad = 4;
    const w2 = tw + pad * 2, h2 = asc + desc + pad * 2 + 2;
    if (w2 > 1400 || h2 > 400) return null;
    mc.width = w2; mc.height = h2; mg = mc.getContext('2d', { willReadFrequently: true });
    mg.font = hf; mg.textAlign = 'left'; mg.textBaseline = 'alphabetic';
    mg.fillStyle = '#fff'; mg.fillText(txt, pad, pad + asc);
    { const im = mg.getImageData(0, 0, w2, h2), d = im.data;
      for (let i = 3; i < d.length; i += 4) d[i] = d[i] >= 132 ? 255 : 0;
      mg.putImageData(im, 0, 0); }
    // ② 色を着けた版を作る小道具
    const tc = _tmp(); tc.width = w2; tc.height = h2; const tg = tc.getContext('2d');
    const tint = col => { tg.setTransform(1, 0, 0, 1, 0, 0); tg.globalCompositeOperation = 'source-over'; tg.clearRect(0, 0, w2, h2); tg.drawImage(mc, 0, 0); tg.globalCompositeOperation = 'source-in'; tg.fillStyle = col; tg.fillRect(0, 0, w2, h2); tg.globalCompositeOperation = 'source-over'; return tc; };
    // ③ 合成（影2段 → 輪郭 → 本体3段）
    const cc = _tmp(); cc.width = w2; cc.height = h2 + 6; const cg = cc.getContext('2d');
    cg.imageSmoothingEnabled = false;
    const so = size >= 22 ? 2 : 1;
    cg.drawImage(tint(opt.sh2), 0, so * 2); cg.drawImage(tint(opt.sh1), 0, so);
    const ol = tint(opt.line);
    // 縁は1ドット。字が細いうちに斜め4方向まで回すと、線の太さより縁が勝って
    // 文字が黒い塊に潰れる（副題がまさにそうなった）ので、小さい字は上下左右だけ
    const dirs = size >= 15 ? [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]]
      : [[-1, 0], [1, 0], [0, -1], [0, 1]];
    for (const [dx, dy] of dirs) cg.drawImage(ol, dx, dy);
    // 本体：上から明・中・暗の3段。
    // ※ source-in は「1回の描画」しか残さない。3段を3回 fillRect すると
    //   最後の1段以外が消える（初稿はこれで字が真っ黒になった）。
    //   先に3段の板を別キャンバスへ作り、それを1回だけ流し込む
    const pc = _tmp(); pc.width = w2; pc.height = h2; const pg2 = pc.getContext('2d');
    const y1 = pad + Math.round(asc * 0.42), y2 = pad + Math.round(asc * 0.80);
    pg2.fillStyle = opt.b0; pg2.fillRect(0, 0, w2, y1);
    pg2.fillStyle = opt.b1; pg2.fillRect(0, y1, w2, y2 - y1);
    pg2.fillStyle = opt.b2; pg2.fillRect(0, y2, w2, h2 - y2);
    const bc = _tmp(); bc.width = w2; bc.height = h2; const bg = bc.getContext('2d');
    bg.drawImage(mc, 0, 0); bg.globalCompositeOperation = 'source-in';
    bg.drawImage(pc, 0, 0); bg.globalCompositeOperation = 'source-over';
    cg.drawImage(bc, 0, 0);
    // ④ 2倍に拡大して確定（ここで初めて等倍の画面解像度になる）
    const fc = _tmp(); fc.width = cc.width * 2; fc.height = cc.height * 2;
    const fg = fc.getContext('2d'); fg.imageSmoothingEnabled = false;
    fg.drawImage(cc, 0, 0, fc.width, fc.height);
    const spr = { cv: fc, w: fc.width, h: fc.height, ox: pad * 2, base: (pad + asc) * 2 };
    _texCache.set(key, spr); return spr;
  }

  // 見出し用の既定パレット（金）。色を指定されたらそれを基準に3段を作る
  function bigOpt(col) {
    const base = (typeof col === 'string') ? col : '#ffd24d';
    const a = col4(base), L = (a[0] * 0.299 + a[1] * 0.587 + a[2] * 0.114) / 255;
    if (L < 0.30) return { k: base + '|d', b0: mix4(base, '#ffffff', 0.34), b1: base, b2: mix4(base, '#000000', 0.30),
      line: '#f4efe2', sh1: 'rgba(220,214,200,.7)', sh2: 'rgba(255,255,255,.45)' };
    return { k: base, b0: mix4(base, '#ffffff', 0.55), b1: base, b2: mix4(base, '#2a1200', 0.34),
      line: '#150c06', sh1: 'rgba(24,12,4,.85)', sh2: 'rgba(6,3,1,.72)' };
  }
  function drawBig(c, txt, x, y, col) {
    const sp = textSprite(txt, c.font, bigOpt(col));
    if (!sp) return false;
    let ox = 0; const al = c.textAlign;
    if (al === 'center') ox = -(sp.w - sp.ox * 2) / 2 - sp.ox;
    else if (al === 'right' || al === 'end') ox = -(sp.w - sp.ox);
    else ox = -sp.ox;
    let by = 0; const bl = c.textBaseline;
    if (bl === 'middle') by = sp.base * 0.36; else if (bl === 'top' || bl === 'hanging') by = sp.base;
    const sm = c.imageSmoothingEnabled; c.imageSmoothingEnabled = false;
    c.drawImage(sp.cv, sn(x + ox), sn(y + by - sp.base));
    c.imageSmoothingEnabled = sm;
    return true;
  }

  //────────────────────────────────────────────────────────────────
  //  段で割るグラデーション（ゲージ・空・帯）
  //────────────────────────────────────────────────────────────────
  // createLinearGradient を横取りして色停止を控えておき、fillRect のときに
  // 帯へ割って塗る。なめらかなグラデがそのままだと「等倍のCG」に見えてしまう
  const GST = new WeakMap();
  D.createLinearGradient = function (x0, y0, x1, y1) {
    const g = NAT.createLinearGradient.call(this, x0, y0, x1, y1);
    if (uiOn) {
      const rec = { x0, y0, x1, y1, st: [] };
      const add = g.addColorStop.bind(g);
      g.addColorStop = function (o, c) { rec.st.push([o, c]); return add(o, c); };
      GST.set(g, rec);
    }
    return g;
  };
  function sample(st, t) {
    if (!st.length) return '#888';
    if (t <= st[0][0]) return st[0][1];
    for (let i = 1; i < st.length; i++) {
      if (t <= st[i][0]) { const a = st[i - 1], b = st[i], d = b[0] - a[0]; return d > 0 ? mix4(a[1], b[1], (t - a[0]) / d) : b[1]; }
    }
    return st[st.length - 1][1];
  }
  function bandedFill(c, x, y, w, h, rec) {
    const vert = Math.abs(rec.y1 - rec.y0) >= Math.abs(rec.x1 - rec.x0);
    const p0 = vert ? rec.y0 : rec.x0, p1 = vert ? rec.y1 : rec.x1;
    const len = (p1 - p0) || 1;
    const a = vert ? y : x, b = vert ? y + h : x + w, cross = vert ? w : h;
    const span = b - a;
    const N = Math.max(3, Math.min(14, Math.round(span / (U * 7))));
    const seam = (cross / U) * N <= 400;                 // 市松の食い込みは軽いときだけ
    let s = a, lev = -1, col = null;
    const put = (q0, q1, cc) => { if (q1 <= q0) return; c.fillStyle = cc; if (vert) NF(c, x, q0, w, q1 - q0); else NF(c, q0, y, q1 - q0, h); };
    const check = (q, cc) => {
      if (!seam) return; c.fillStyle = cc;
      if (vert) { for (let k = x; k < x + w; k += U * 2) NF(c, k, q, U, U); }
      else { for (let k = y; k < y + h; k += U * 2) NF(c, q, k, U, U); }
    };
    for (let q = a; q < b; q += U) {
      const t = Math.min(1, Math.max(0, ((q + U / 2) - p0) / len));
      const L = Math.min(N - 1, Math.floor(t * N));
      if (L !== lev) {
        if (lev >= 0) { put(s, q, col); check(q, col); }
        lev = L; s = q; col = sample(rec.st, (L + 0.5) / N);
      }
    }
    put(s, b, col);
  }

  //────────────────────────────────────────────────────────────────
  //  表示コンテキストの差し替え（UI を描いている間だけ効く）
  //────────────────────────────────────────────────────────────────
  D.fillRect = function (x, y, w, h) {
    if (!uiOn) return NAT.fillRect.call(this, x, y, w, h);
    const X = sn(x), Y = sn(y), Wd = dm(w), Hd = dm(h);
    const fs = this.fillStyle;
    if (fs && typeof fs === 'object') { const rec = GST.get(fs); if (rec && rec.st.length) { bandedFill(this, X, Y, Wd, Hd, rec); return; } }
    return NAT.fillRect.call(this, X, Y, Wd, Hd);
  };
  D.strokeRect = function (x, y, w, h) {
    if (!uiOn) return NAT.strokeRect.call(this, x, y, w, h);
    return NAT.strokeRect.call(this, sn(x), sn(y), dm(w), dm(h));
  };
  // パスの当たり枠を追う（fill() で段塗りに切り替えるため）
  D.beginPath = function () { _pb = null; return NAT.beginPath.call(this); };
  D.rect = function (x, y, w, h) { _pb = { x, y, w, h }; return NAT.rect.call(this, x, y, w, h); };
  // 段で割ったグラデを、矩形でないパス（面取りパネル・円）へも掛ける
  D.fill = function (rule) {
    if (uiOn && _pb) {
      const fs = this.fillStyle;
      if (fs && typeof fs === 'object') {
        const rec = GST.get(fs);
        if (rec && rec.st.length) {
          this.save(); NAT_clip.call(this, rule || 'nonzero');
          bandedFill(this, sn(_pb.x), sn(_pb.y), dm(_pb.w), dm(_pb.h), rec);
          this.restore(); return;
        }
      }
    }
    return rule ? NAT.fill.call(this, rule) : NAT.fill.call(this);
  };
  // 円は中点円で。arc() の円は等倍でも「ベクタの丸」に見えてUIだけ浮く
  D.arc = function (x, y, r, a0, a1, ccw) {
    if (!uiOn || Math.abs(a1 - a0) < Math.PI * 1.9) return NAT.arc.call(this, x, y, r, a0, a1, ccw);
    const cx = sn(x), cy = sn(y), R2 = Math.max(1, Math.round(r / U));
    _pb = { x: cx - r, y: cy - r, w: r * 2, h: r * 2 };
    const hw = []; for (let dy = -R2; dy <= R2; dy++) hw.push(Math.floor(Math.sqrt(Math.max(0, R2 * R2 - dy * dy)) + 0.5));
    const top = cy - R2 * U - U / 2;
    this.moveTo(cx + (hw[0] + 0.5) * U, top);
    for (let i = 0; i < hw.length; i++) { const ty = top + i * U; this.lineTo(cx + (hw[i] + 0.5) * U, ty); this.lineTo(cx + (hw[i] + 0.5) * U, ty + U); }
    for (let i = hw.length - 1; i >= 0; i--) { const ty = top + i * U; this.lineTo(cx - (hw[i] + 0.5) * U, ty + U); this.lineTo(cx - (hw[i] + 0.5) * U, ty); }
    this.closePath();
  };
  // 文字：大きいものはドット文字へ、小さいものは等倍のまま濃い縁を回す。
  // 日本語を半分の大きさで焼くと 6px の漢字になるので、小さい字は絶対に落とさない
  const BIGPX = 26;
  // 縁の色は本文の明るさで決める。暗い字に暗い縁を回すと、字が縁に飲まれて
  // ただの黒い塊になる（1P/2Pの選択タグが実際にそうなった）。
  // 透明度は本文に合わせる＝薄い字の縁だけが濃く残るのを防ぐ
  let _olKey = null, _olVal = 'rgba(6,4,10,.92)';
  function outlineFor(fs) {
    if (typeof fs !== 'string') return 'rgba(6,4,10,.92)';
    if (fs === _olKey) return _olVal;
    const a = col4(fs), L = (a[0] * 0.299 + a[1] * 0.587 + a[2] * 0.114) / 255;
    const al = (a[3] < 1 ? a[3] : 1) * 0.92;
    _olKey = fs;
    _olVal = L < 0.30 ? 'rgba(248,244,232,' + al.toFixed(2) + ')' : 'rgba(6,4,10,' + al.toFixed(2) + ')';
    return _olVal;
  }
  D.fillText = function (t, x, y, mw) {
    if (!uiOn) return NAT.fillText.call(this, t, x, y, mw);
    const sz = fontPx(this.font);
    if (sz >= BIGPX && t && String(t).length <= 24) {
      try { if (drawBig(this, String(t), x, y, this.fillStyle)) return; } catch (e) { }
    }
    const st = this.strokeStyle, lw = this.lineWidth, lj = this.lineJoin;
    this.strokeStyle = outlineFor(this.fillStyle); this.lineWidth = Math.max(3, Math.round(sz * 0.26)); this.lineJoin = 'round';
    if (mw == null) NAT.strokeText.call(this, t, sn(x), sn(y)); else NAT.strokeText.call(this, t, sn(x), sn(y), mw);
    this.strokeStyle = st; this.lineWidth = lw; this.lineJoin = lj;
    if (mw == null) return NAT.fillText.call(this, t, sn(x), sn(y));
    return NAT.fillText.call(this, t, sn(x), sn(y), mw);
  };
  D.strokeText = function (t, x, y, mw) {
    if (!uiOn) return NAT.strokeText.call(this, t, x, y, mw);
    // 大きい字はスプライト側に輪郭が入っているので、本編の縁取りは捨てる
    if (fontPx(this.font) >= BIGPX && t && String(t).length <= 24) return;
    if (mw == null) return NAT.strokeText.call(this, t, sn(x), sn(y));
    return NAT.strokeText.call(this, t, sn(x), sn(y), mw);
  };

  // UI を描く関数を包む共通の足場
  function wrapUI(fn) {
    return function () { uiOn++; try { return fn.apply(this, arguments); } finally { uiOn--; } };
  }

  //────────────────────────────────────────────────────────────────
  //  画面いっぱいの額縁（タイトル・地図・店・キャラ選択）
  //────────────────────────────────────────────────────────────────
  function screenFrame(style) {
    const pal = PAL[style === 'stone' ? 'stone' : 'gold'];
    const w = W, h = H;
    ring(0, 0, w, h, U, P.ink0);
    ring(U, U, w - U * 2, h - U * 2, U, pal.lo);
    ring(U * 2, U * 2, w - U * 4, h - U * 4, U * 2, pal.md);
    R(U * 6, U * 2, w - U * 12, U, pal.hi);                     // 上辺の光
    R(U * 2, U * 6, U, h - U * 12, pal.hi);
    R(U * 6, h - U * 3, w - U * 12, U, pal.dk);
    R(w - U * 3, U * 6, U, h - U * 12, pal.dk);
    ring(U * 4, U * 4, w - U * 8, h - U * 8, U, pal.lo);
    ring(U * 5, U * 5, w - U * 10, h - U * 10, U, P.ink0);
    // 鋲
    for (let x = U * 10; x < w - U * 10; x += U * 12) { R(x, U * 3, U, U, pal.hi); R(x, h - U * 4, U, U, pal.hi); }
    for (let y = U * 10; y < h - U * 10; y += U * 12) { R(U * 3, y, U, U, pal.hi); R(w - U * 4, y, U, U, pal.hi); }
    // 四隅の宝珠
    const jew = (jx, jy, sx, sy) => {
      const p = (dx, dy, ww, hh, c) => R(jx + (sx > 0 ? dx : -dx - ww), jy + (sy > 0 ? dy : -dy - hh), ww, hh, c);
      p(0, 0, U * 8, U, pal.hi); p(0, U, U, U * 7, pal.hi);
      p(U * 3, U * 3, U, U, pal.hi); p(U * 2, U * 3, U, U, pal.lt); p(U * 4, U * 3, U, U, pal.lt);
      p(U * 3, U * 2, U, U, pal.lt); p(U * 3, U * 4, U, U, pal.lt);
      p(U * 2, U * 2, U, U, pal.dk); p(U * 4, U * 4, U, U, pal.dk);
    };
    jew(0, 0, 1, 1); jew(w, 0, -1, 1); jew(0, h, 1, -1); jew(w, h, -1, -1);
  }

  //────────────────────────────────────────────────────────────────
  //  タイトル：ドット絵のロゴ
  //────────────────────────────────────────────────────────────────
  // ロゴは DOM 側（.titleblock）にブラウザの文字として載っていた。等倍のなめらかな
  // 字はドット絵の背景から完全に浮くので、canvas のドット文字へ移す。
  // DOM 側は「場所だけ」残す（display:none にするとメニューが上へ詰めてロゴに重なる）。
  //
  // ※ ボタンやパネルの見た目は px/pixel.css（別担当）が持っている。
  //   ここで触ると二重に効くので、ロゴを canvas へ移すのに要る1行だけに絞ってある。
  try {
    const sty = document.createElement('style');
    sty.textContent =
      '.titleblock{visibility:hidden;height:180px}' +
      '@media (max-width:640px),(max-height:660px){.titleblock{height:112px}}';
    document.head.appendChild(sty);
  } catch (e) { }

  const LOGO = { k: 'logo', b0: '#fff4cf', b1: '#ffcf3a', b2: '#b06f12',
    line: '#1a0d04', sh1: 'rgba(88,38,4,.95)', sh2: 'rgba(14,6,2,.85)' };
  const LOGO_SUB = { k: 'sub', b0: '#fff8e0', b1: '#ffd85e', b2: '#c08a1e',
    line: '#160c04', sh1: 'rgba(30,14,4,.9)', sh2: 'rgba(6,3,1,.7)' };

  // 上から下へ抜けていく暗幕。段で割り、境目に市松を1ドット食い込ませる
  function scrimDown(y0, y1, a0, a1, steps) {
    const c = ctx, n = steps || 8, seg = (y1 - y0) / n;
    for (let i = 0; i < n; i++) {
      const a = a0 + (a1 - a0) * (i / (n - 1));
      const ya = sn(y0 + seg * i), yb = sn(y0 + seg * (i + 1));
      c.fillStyle = 'rgba(5,3,10,' + a.toFixed(3) + ')'; NF(c, 0, ya, W, yb - ya);
      if (i) { c.fillStyle = 'rgba(5,3,10,' + ((a0 + (a1 - a0) * ((i - 1) / (n - 1))) * 0.6).toFixed(3) + ')';
        for (let x = 0; x < W; x += U * 2) NF(c, x, ya, U, U); }
    }
  }

  function drawTitleLogo() {
    const c = ctx;
    scrimDown(0, U * 100, 0.80, 0, 10);               // ロゴを背景から浮かせる暗幕
    c.save(); c.imageSmoothingEnabled = false;
    const put = (sp, y) => { if (sp) c.drawImage(sp.cv, sn(W / 2 - sp.w / 2), sn(y)); return sp ? sp.h : 0; };
    let y = U * 2;
    // 上の小見出し（英字。28px なら半分にしても線が2ドット残って読める）
    const sub = textSprite('ARCADE  BELT  ACTION', 'bold 28px ' + UIFONT, LOGO_SUB);
    y += put(sub, y) - U * 12;
    // ロゴ本体
    const logo = textSprite('聖犬士イッヌ', '900 64px ' + UIFONT, LOGO);
    y += put(logo, y) - U * 10;
    // 副題は日本語。半分の大きさへ落とすと画数が潰れるので、等倍のまま縁だけ回す
    const ry = sn(y);
    c.textAlign = 'center'; c.textBaseline = 'alphabetic';
    c.font = 'bold 24px ' + UIFONT; c.fillStyle = '#ffe9a8';
    c.fillText('〜 ワンワン帝国の野望 〜', W / 2, ry + U * 11);
    // 金の罫は副題の下に引いてロゴ全体を締める（上に引くと字と当たる）。
    // 下へ暗い線を添えないと、明るい空に重なった端が消える
    const ly = sn(ry + U * 16);
    for (let x = sn(W * 0.17); x < W * 0.83; x += U) {
      const t = 1 - Math.abs((x - W / 2) / (W * 0.33));
      R(x, ly, U, U, 'rgba(255,210,80,' + (0.95 * t * t).toFixed(3) + ')');
      R(x, ly + U, U, U, 'rgba(60,30,0,' + (0.8 * t * t).toFixed(3) + ')');
    }
    // 罫の中央に菱形の飾りを噛ませる
    for (let i = 0; i < 4; i++) R(W / 2 - i * U, ly - (3 - i) * U, (i * 2 + 1) * U, U, i === 3 ? '#7a5210' : (i < 2 ? '#ffefb4' : '#ffd24d'));
    c.restore(); c.textAlign = 'left';
  }

  //────────────────────────────────────────────────────────────────
  //  本編の描画関数を包む（必ず「今の値」を捕まえてから）
  //────────────────────────────────────────────────────────────────
  // HUD：core が pxPresent() を済ませた後の等倍レイヤー
  { const raw = drawHUD; drawHUD = function () { uiOn++; try { raw(); } finally { uiOn--; } }; }

  // 文字が主役の画面：額縁を回してから本文を描く
  for (const nm of ['drawShop', 'drawMap', 'drawCharSel']) {
    const raw = window[nm];
    if (typeof raw !== 'function') continue;
    window[nm] = function () {
      uiOn++;
      try { raw.apply(this, arguments); screenFrame('gold'); }
      finally { uiOn--; }
    };
  }
  // 会話・カットシーンは縁取りだけ（額縁を足すと本文の行が入らなくなる）
  { const raw = window.drawCut; if (typeof raw === 'function') window.drawCut = wrapUI(raw); }
  // アトラクトのカードは見出しが 40px。ドット文字に置き換えたいので包む
  { const raw = window.drawAttractCard;
    if (typeof raw === 'function') window.drawAttractCard = function () {
      uiOn++; try { raw.apply(this, arguments); screenFrame('gold'); } finally { uiOn--; }
    }; }

  // タイトル：世界バッファ側の絵を焼き付けてから、等倍でロゴと額縁を載せる
  { const raw = drawTitleScene;
    drawTitleScene = function () {
      raw();
      pxPresent();                       // ここから先は等倍（960×540）側
      uiOn++;
      try { drawTitleLogo(); screenFrame('gold'); } finally { uiOn--; }
    };
  }

  // ── 奥義カットイン（drawUltCut）には手を出さない ──
  // core が「いったん 480×270 のドットバッファへ描いてから、透過のまま拡大して重ねる」
  // 包み方をしている。等倍側の差し替え（uiOn）はそこへ届かないし、届かせるべきでもない：
  // カットインは世界と同じ密度で出るのが正しい。ここで包み直すと core の転送が消える。

  window.PXUI = { on: () => uiOn, frame: screenFrame, text: textSprite };
})();

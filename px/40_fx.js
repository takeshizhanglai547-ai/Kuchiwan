// ══════════════════════════════════════════════════════════════════
//  エフェクト（火花・斬撃・爆発・弾・画面演出）のドット絵化
// ══════════════════════════════════════════════════════════════════
// 本編のエフェクトは createRadialGradient / createConicGradient を軸に組まれている。
// 480×270 へ落とすと、放射グラデは「ぼやけた丸」、円錐グラデは「灰色の扇」になり、
// 打点も刃筋も読めない。ここでは同じ現象を次の言語へ描き直す：
//
//   なめらかな減衰   → 6段のランプ（白→淡→黄→橙→赤→焦げ）を寿命で送る
//   放射グラデの丸   → 段で割った同心の楕円（ベタ）＋外周1ドットのディザ
//   ストロークの輪   → 1〜2ドットの中点楕円＋外側に市松の抜き
//   円錐グラデの弧   → 3枚のベタの帯（外＝白熱／中＝技の色／内＝影）
//   小さな火花       → 1〜2ドットの点。速い粒だけ2〜4ドットの筋になる
//
// そのうえで「アニメーションを増やす」ぶんを、本編の生成関数を包んで足している
// （hitFx / shockwave / crescent / smokePuff / spark を差し替え、
//  手描きのドット絵スプライトを持つ粒 pxhit / pxgash / pxboom / pxpuff / pxrings を追加する）。
//
// 座標の約束は本編と同じ論理座標（960×540）。バッファ1ドット＝論理2単位（PXU）。
(function () {

  //────────────────────────────────────────────────────────────────
  //  1. 色：6段のランプと、色から系統を引く表
  //────────────────────────────────────────────────────────────────
  // index 0 が最も熱い（白）、5 が最も冷えた（焦げ）。寿命で 0→5 と「段で」落とす。
  const FAM = {
    hot:  ['#ffffff', '#fff4c8', '#ffd94a', '#ff9a20', '#e0421a', '#7d1c10'],
    gold: ['#ffffff', '#fff6d8', '#ffe14d', '#ffab26', '#d9541c', '#6e2410'],
    fire: ['#ffffff', '#ffe9a0', '#ffb02a', '#ff6a12', '#c02c0e', '#571408'],
    leaf: ['#ffffff', '#eaffcc', '#a8f05a', '#4fbb2c', '#1d6b1c', '#0a2c0e'],
    ice:  ['#ffffff', '#e6faff', '#9fe8ff', '#4bb6f0', '#1d5fb4', '#0d2660'],
    volt: ['#ffffff', '#eaf6ff', '#bfe9ff', '#79b8ff', '#3355dd', '#141a5a'],
    vio:  ['#ffffff', '#f6e0ff', '#c46bff', '#8a34d8', '#4d1690', '#210840'],
    rose: ['#ffffff', '#ffe0ea', '#ff8ab4', '#ef3f77', '#a81444', '#4c0620'],
    ash:  ['#f4f0e6', '#cdc4b2', '#9a8f7c', '#6c6252', '#443c30', '#221c14'],
  };
  // 煙・土は別扱い（発光しない側の5段）
  const SMOKE = ['#b8ae9c', '#948a78', '#6e6656', '#4c463a', '#2c2822'];
  const DIRT  = ['#d8c9a6', '#b09a72', '#87724f', '#5e4d34', '#3a2f20'];
  // 本編は煙の色をステージごとに渡してくる（themeSmokeRGB）。決め打ちの灰で塗ると
  // 暗いステージで背景に沈んで一切見えなくなるので、渡された色から5段を起こす
  const _ramp = new Map();
  function smokeRamp(rgb) {
    let r = _ramp.get(rgb); if (r) return r;
    const base = 'rgb(' + rgb + ')';
    r = [pxMix(base, '#efe6d4', 0.62), pxMix(base, '#d8ccb6', 0.34), base,
         pxMix(base, '#181208', 0.30), pxMix(base, '#0d0a06', 0.58)];
    if (_ramp.size < 64) _ramp.set(rgb, r);
    return r;
  }

  // 色文字列 → 系統名。1色につき1回だけ判定して覚える（毎フレームの hexRGB を避ける）
  const _fam = new Map();
  function famOf(col) {
    if (!col) return 'hot';
    let f = _fam.get(col); if (f) return f;
    let r, g, b;
    try { const c = pxRGB(String(col)); r = c[0]; g = c[1]; b = c[2]; }
    catch (e) { r = g = b = 200; }
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    if (d < 34) f = 'ash';
    else {
      let h;
      if (mx === r) h = ((g - b) / d + 6) % 6;
      else if (mx === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
      f = h < 14 ? 'fire' : h < 44 ? 'gold' : h < 72 ? 'hot' : h < 155 ? 'leaf'
        : h < 196 ? 'ice' : h < 252 ? 'volt' : h < 300 ? 'vio' : 'rose';
    }
    if (_fam.size < 512) _fam.set(col, f);
    return f;
  }
  // 寿命比 a(1→0) を 6段の番号へ。lo で「どの段から始めるか」を決める
  const step6 = (a, lo) => { const i = (lo | 0) + Math.floor((1 - a) * (6 - (lo | 0))); return i > 5 ? 5 : i < 0 ? 0 : i; };
  // パレットサイクル：炎と電気だけ、数フレーム周期で段を1つ送る
  const cyc = (i, sp) => { const j = i + ((gf / (sp || 3)) | 0) % 2; return j > 5 ? 5 : j; };

  //────────────────────────────────────────────────────────────────
  //  2. ドット格子。今の変換から「バッファ1ドット」の位置と大きさを引く
  //────────────────────────────────────────────────────────────────
  let _a = 0.5, _e = 0, _d = 0.5, _f = 0, _ds = 1, _dv = 1, _u = PXU, _v = PXU;
  function snapSet() {
    const M = ctx.getTransform();
    // 回転が入っている（カメラの傾き・粒ごとの rotate）ときは、変換の逆算では
    // 格子に乗らない。論理座標そのものの2単位格子へ落として形だけ守る
    if (M.b || M.c || !M.a || !M.d) {
      _a = _d = 1; _e = _f = 0; _ds = _dv = PXU; _u = _v = PXU; return;
    }
    _a = M.a; _e = M.e; _d = M.d; _f = M.f;
    _ds = PXU * Math.abs(_a); _dv = PXU * Math.abs(_d);
    _u = _ds / _a; _v = _dv / _d;
  }
  const dX = x => Math.round((_a * x + _e) / _ds);   // 論理 → ドット番号
  const dY = y => Math.round((_d * y + _f) / _dv);
  const lX = d => (d * _ds - _e) / _a;               // ドット番号 → 論理
  const lY = d => (d * _dv - _f) / _d;
  const dR = r => Math.max(0, Math.round(Math.abs(r) * Math.abs(_a) / _ds));   // 半径 → ドット数
  // ドット単位の矩形をパスへ積む（積んでから1回 fill する＝描画コールを増やさない）
  function R(dx, dy, w, h) { ctx.rect(lX(dx), lY(dy), (w || 1) * _u, (h || 1) * _v); }

  //────────────────────────────────────────────────────────────────
  //  3. ドット絵の図形（すべてパスへ積むだけ。fill は呼び側で1回）
  //────────────────────────────────────────────────────────────────
  // 塗りつぶし楕円
  function ellFill(cx, cy, rx, ry) {
    const RX = dR(rx), RY = dR(ry), X = dX(cx), Y = dY(cy);
    if (RX < 1 && RY < 1) { R(X, Y, 1, 1); return; }
    if (RY < 1) { R(X - RX, Y, RX * 2 + 1, 1); return; }
    for (let j = -RY; j <= RY; j++) {
      const k = 1 - (j * j) / (RY * RY); if (k <= 0) { R(X, Y + j, 1, 1); continue; }
      const i = Math.round(RX * Math.sqrt(k));
      R(X - i, Y + j, i * 2 + 1, 1);
    }
  }
  // 数ドット幅の楕円の帯。1ドットの輪にすると「針金の楕円」に見えるので、
  // 衝撃波は必ず太さを持たせる（上下の極では横に走らせて必ず閉じる）
  function ellRing(cx, cy, rx, ry, th) {
    const RX = dR(rx), RY = dR(ry), X = dX(cx), Y = dY(cy), T = Math.max(1, Math.round(th) || 1);
    if (RX < 1 || RY < 1) { R(X, Y, 1, 1); return; }
    const f = j => { const k = 1 - (j * j) / (RY * RY); return k <= 0 ? 0 : Math.round(RX * Math.sqrt(k)); };
    for (let j = -RY; j <= RY; j++) {
      const i = f(j), nb = Math.min(f(j - 1), f(j + 1));
      let lo = Math.min(nb, i - T + 1); if (lo < 0) lo = 0;
      const w = i - lo + 1;
      R(X + lo, Y + j, w, 1);
      R(X - i, Y + j, w, 1);
    }
  }
  // 市松に抜いた輪。段の外側へ1ドットぶんディザを回して、境目を硬いまま馴染ませる
  function ellDither(cx, cy, rx, ry, ph) {
    const RX = dR(rx), RY = dR(ry), X = dX(cx), Y = dY(cy);
    if (RX < 1 || RY < 1) return;
    for (let j = -RY; j <= RY; j++) {
      const k = 1 - (j * j) / (RY * RY); if (k <= 0) continue;
      const i = Math.round(RX * Math.sqrt(k));
      if (((X + i + Y + j) & 1) === (ph & 1)) R(X + i, Y + j, 1, 1);
      if (((X - i + Y + j) & 1) === (ph & 1)) R(X - i, Y + j, 1, 1);
    }
  }
  // ドットの線（Bresenham）。lineWidth の小数は低解像度で薄墨になるので使わない
  function dotLine(x0, y0, x1, y1, th) {
    let ax = dX(x0), ay = dY(y0); const bx = dX(x1), by = dY(y1);
    const sx = ax < bx ? 1 : -1, sy = ay < by ? 1 : -1;
    let dx = Math.abs(bx - ax), dy = -Math.abs(by - ay), err = dx + dy;
    const T = Math.max(1, th | 0), o = (T - 1) >> 1;
    for (let n = 0; n < 900; n++) {
      R(ax - o, ay - o, T, T);
      if (ax === bx && ay === by) break;
      const e2 = err * 2;
      if (e2 >= dy) { err += dy; ax += sx; }
      if (e2 <= dx) { err += dx; ay += sy; }
    }
  }
  // 段で割った同心の楕円（閃光・芯・爆風の核）。cols は外側から順。
  function bandDisc(cx, cy, rx, ry, cols, ysq) {
    const n = cols.length;
    for (let i = 0; i < n; i++) {
      const t = 1 - i / n;
      ctx.fillStyle = cols[i]; ctx.beginPath();
      ellFill(cx, cy, rx * t, ry * t * (ysq || 1));
      ctx.fill();
    }
  }
  const fillPath = (col, fn) => { ctx.fillStyle = col; ctx.beginPath(); fn(); ctx.fill(); };
  // 陰影のついた輪の帯。外＝濃い縁／中＝本体／内＝明るい縁の3枚を重ねる。
  // 1色の細い輪だけにすると「針金の楕円」になり、衝撃波として読めない。
  // 外側のディザは点が飛び飛びになって鋸歯に見えたので、薄い実線に替えた
  // （階調圧縮が秩序ディザを掛け直すので、結果は同じ市松になる）
  function ringBand(cx, cy, rx, ry, th, cOut, cMid, cIn) {
    const T = Math.max(1, th | 0), U = PXU;
    fillPath(cOut, () => ellRing(cx, cy, rx + U, ry + U, T + 2));
    fillPath(cMid, () => ellRing(cx, cy, rx, ry, T));
    if (T >= 2) fillPath(cIn, () => ellRing(cx, cy, rx - (T - 1) * U, ry - (T - 1) * U, 1));
  }

  //────────────────────────────────────────────────────────────────
  //  4. 手描きのドット絵スプライト
  //────────────────────────────────────────────────────────────────
  // 打撃ヒットの閃光。芯の白が十字と斜めのトゲへ伸び、割れて散る 5 枚。
  const HIT_F = [
    ['...1...',
     '...3...',
     '..343..',
     '1344431',
     '..343..',
     '...3...',
     '...1...'],
    ['.....1.....',
     '.....3.....',
     '....343....',
     '.1..343..1.',
     '..3.343.3..',
     '13334443331',
     '..3.343.3..',
     '.1..343..1.',
     '....343....',
     '.....3.....',
     '.....1.....'],
    ['.......1.......',
     '.......3.......',
     '......343......',
     '1.....343.....1',
     '.2....343....2.',
     '..3...444...3..',
     '...33.444.33...',
     '133444444443331',
     '...33.444.33...',
     '..3...444...3..',
     '.2....343....2.',
     '1.....343.....1',
     '......343......',
     '.......3.......',
     '.......1.......'],
    ['.......2.......',
     '......232......',
     '......232......',
     '2.....232.....2',
     '.2....232....2.',
     '..2...232...2..',
     '...2..232..2...',
     '2222223.3222222',
     '...2..232..2...',
     '..2...232...2..',
     '.2....232....2.',
     '2.....232.....2',
     '......232......',
     '......232......',
     '.......2.......'],
    ['......2......',
     '.............',
     '....2...2....',
     '.....2.2.....',
     '..2.......2..',
     '.............',
     '2...2...2...2',
     '.............',
     '..2.......2..',
     '.....2.2.....',
     '....2...2....',
     '.............',
     '......2......'],
  ];
  // 斬撃の走り書き（三日月の切り傷）。細→太→さらに太→ちぎれて散る 4 枚。
  // 右向きに描いてあるので、振り抜いた角度へ回して置く。
  const GASH_F = [
    ['....1....',
     '...13....',
     '..134....',
     '..34.....',
     '.134.....',
     '.34......',
     '.34......',
     '.34......',
     '.34......',
     '.34......',
     '.134.....',
     '..34.....',
     '..134....',
     '...13....',
     '....1....'],
    ['.....2.....',
     '....124....',
     '...1244....',
     '..12444....',
     '..2444.....',
     '.12444.....',
     '.2444......',
     '.2444......',
     '.2444......',
     '.2444......',
     '.2444......',
     '.12444.....',
     '..2444.....',
     '..12444....',
     '...1244....',
     '....124....',
     '.....2.....'],
    ['......1......',
     '.....124.....',
     '....1234.....',
     '...12344.....',
     '..12344......',
     '..2344.......',
     '.12344.......',
     '.2344........',
     '.2344........',
     '.2344........',
     '.2344........',
     '.2344........',
     '.12344.......',
     '..2344.......',
     '..12344......',
     '...12344.....',
     '....1234.....',
     '.....124.....',
     '......1......'],
    ['......2......',
     '.............',
     '....12.......',
     '...12........',
     '.............',
     '..12.........',
     '.............',
     '.2...........',
     '.2...........',
     '.............',
     '.2...........',
     '.............',
     '..12.........',
     '.............',
     '...12........',
     '....12.......',
     '.............',
     '.....2.......',
     '......2......'],
  ];
  // 爆発。白芯→炎→煤→黒煙の 6 枚（4=白 3=黄 2=橙 1=赤 5=煤 6=黒煙）
  const BOOM_F = [
    ['....1....','..11211..','.1223221.','.1234321.','123444321','.1234321.','.1223221.','..11211..','....1....'],
    ['......1......','...1111111...','..112222211..','.11223333211.','.12233344321.','.12334444321.','1123344433211','.12344443321.','.12344333221.','.11233332211.','..112222211..','...1111111...','......1......'],
    ['........1........','.....1111111.....','...11122222211...','..1122222233221..','..1222333333321..','.112233333443221.','.122333444443221.','.122334444433221.','11223344444332211','.122344444433221.','.123444444343221.','.112344333444211.','..1233333333321..','..1122222222211..','...11122222111...','.....1111111.....','........1........'],
    ['.........5.........','.....555111555.....','....511111111115...','...51111111222115..','..511222222333211..','.51123432223432215.','.51123433334443215.','.51122333333332215.','.11122334443322111.','5111223344433221115','.11223334443322111.','.51234433333332215.','.51234433333443215.','.51223322222332215.','..512222222222215..','...5111111111115...','....51111111115....','.....555111555.....','.........5.........'],
    ['.........6.........','.....66555555556...','....6555555511556..','...551111111111156.','..6512211112222155.','.65123321112332115.','.65512322222332115.','.55511222222222155.','.55111223332211155.','6551112233322111556','.55122223332211155.','.51123322222222155.','.51123322222332156.','.55122211112232156.','..511111111122115..','..655555111511156..','....655555555556...','.....665555566.....','.........6.........'],
    ['........6..6.....','.....6666655566..','...6655555515556.','..66555555111156.','..65551111122155.','.655511111222155.','.655111121111156.','.655111222111556.','66551122222115566','.651111222111556.','.551221121111156.','.551221111122156.','.65111111112215..','..5555555551156..','...65555555556...','.....6666666.....','........6........'],
  ];
  // 土煙・着地煙。膨らみながら薄い側へ抜ける 5 枚
  const PUFF_F = [
    ['...1...','.11211.','.12321.','1233321','.12321.','.11211.','...1...'],
    ['.....1.....','..1111111..','.112222221.','.122233321.','.122333331.','11233333211','.233333221.','.123232221.','.112222211.','..1111111..','.....1.....'],
    ['...............','.....111111....','...1112222221..','..112222233221.','..122222333321.','.1122333333321.','.1222333333321.','.1222333332221.','.1233333332221.','.1233333333211.','.123332233321..','..12222223321..','...111222221...','.....11111.....','...............'],
    ['...............','.....11111111..','...11222222221.','..112222222222.','..1222222222221','.1222222222222.','.1222222222221.','.1222222222221.','.2222222222221.','12222222222221.','.2222222222221.','.122222222222..','..12222222221..','.....1111111...','...............'],
    ['...............','....111111111..','...11111111111.','..1111111111111','.11111111111111','.11111111111111','.1111111111111.','.1111111111111.','11111111111111.','11111111111111.','11111111111111.','.111111111111..','.11111111111...','....1111111....','...............'],
  ];
  // きらめき（拾得・会心の粒）。3枚
  const TWK_F = [
    ['..1..', '..3..', '13431', '..3..', '..1..'],
    ['...1...', '.1.3.1.', '..343..', '1334331', '..343..', '.1.3.1.', '...1...'],
    ['....1....', '.1..3..1.', '..1.3.1..', '...343...', '11133311 ', '...343...', '..1.3.1..', '.1..3..1.', '....1....'],
  ];

  // スプライトは「系統×枚数」ぶんだけ焼いて使い回す。色を無限に作らないよう
  // 系統を9つに丸めてあるので、焼かれる枚数は上限が決まっている
  const _sprC = new Map();
  function fxSpr(set, idx, fam, tag) {
    const key = tag + idx + fam;
    let s = _sprC.get(key); if (s) return s;
    const P = FAM[fam] || FAM.hot;
    // 煤は寒い灰にすると炎から浮いて「灰色の板」になる。炎の最暗段へ寄せた暖かい煤にする
    const pal = { '1': P[4], '2': P[3], '3': P[2], '4': P[0], '5': pxMix(P[5], '#6b6152', 0.55), '6': pxMix(P[5], '#2a241d', 0.75) };
    if (tag === 'B') { pal['3'] = P[1]; pal['2'] = P[2]; pal['1'] = P[3]; }
    s = pxSprite(set[idx], pal, 'fx' + key);
    _sprC.set(key, s);
    return s;
  }
  function smokeSpr(idx, k) {
    const key = 'S' + idx + k;
    let s = _sprC.get(key); if (s) return s;
    const B = k ? DIRT : SMOKE;
    s = pxSprite(PUFF_F[idx], { '1': B[3], '2': B[2], '3': B[1] }, 'fxs' + key);
    _sprC.set(key, s);
    return s;
  }
  // 寿命比 a から「何枚目か」を引く
  const frameOf = (a, n) => { const i = Math.floor((1 - a) * n); return i < 0 ? 0 : i >= n ? n - 1 : i; };
  // スプライトの中心を打点へ合わせて置く（pxDrawSprite の既定は「中心下」なのでずれる）
  const _o = { ox: 0, oy: 0, scale: 1, alpha: 1, rot: 0 };
  function sprAt(spr, x, y, sc, al, rot) {
    _o.ox = spr.w / 2; _o.oy = spr.h / 2; _o.scale = sc || 1;
    _o.alpha = al < 0 ? 0 : al > 1 ? 1 : al; _o.rot = rot || 0;
    pxDrawSprite(spr, x, y, _o);
  }

  //────────────────────────────────────────────────────────────────
  //  5. 追加の粒：本編の生成関数を包んで、ドット絵の演出を足す
  //────────────────────────────────────────────────────────────────
  const push = (o) => { if (particles.length < 300) particles.push(o); };

  // 打撃 → 手描きの閃光＋（ヒットストップ中は）二重三重の輪
  const rawHitFx = hitFx;
  hitFx = function (x, y, dmg, heavy, col) {
    rawHitFx(x, y, dmg, heavy, col);
    const big = !!heavy || dmg >= 22, ht = comboHeat();
    const c = col || '#ffe14d';
    push({ k: 'pxhit', x, y, gl: groundLift(x), layer: 1, delay: 0,
      life: 10, max: 10, fam: famOf(c), sc: big ? 2 : 1, rot: rnd(-0.5, 0.5) });
    // コンボが乗るほど輪の枚数が増える。ヒットストップ中は打点で輪が広がり続ける
    const rings = 1 + (big ? 1 : 0) + (ht >= 0.6 ? 1 : 0);
    push({ k: 'pxrings', x, y, gl: groundLift(x), layer: 1, delay: 1,
      life: 18, max: 18, n: rings, r: (big ? 74 : 46) * (1 + ht * 0.5),
      fam: ht >= 0.4 ? famOf(comboRank(combo.count)[2]) : famOf(c) });
  };

  // 斬撃 → 走り書きの切り傷を振り抜いた向きへ置く
  const rawCrescent = crescent;
  crescent = function (x, y, r, a0, a1, color, opt) {
    rawCrescent(x, y, r, a0, a1, color, opt);
    const am = (a0 + a1) * 0.5, q = Math.round(am / (TAU / 24)) * (TAU / 24);
    push({ k: 'pxgash', x: x + Math.cos(am) * r * 0.72, y: y + Math.sin(am) * r * 0.72,
      gl: groundLift(x), layer: 1, delay: 0, life: 11, max: 11,
      fam: famOf(color), rot: q, sc: r > 90 ? 2 : 1 });
  };

  // 爆発 → 白芯から黒煙まで進む1枚の塊。輪と火花は本編のものをドットで描く
  const rawShockwave = shockwave;
  shockwave = function (x, y, opt) {
    rawShockwave(x, y, opt);
    opt = opt || {};
    const Rr = opt.r || 120, heavy = opt.big !== false;
    push({ k: 'pxboom', x, y: y - Rr * 0.18, gl: groundLift(x), layer: 1, delay: 1,
      life: 30, max: 30, fam: famOf(opt.color || '#ffe9a0'), sc: heavy && Rr > 110 ? 2 : 1 });
    if (perfTier < 2) for (let i = 0; i < (heavy ? 3 : 2); i++)
      push({ k: 'pxpuff', x: x + rnd(-Rr * 0.5, Rr * 0.5), y: y + rnd(-6, 8), gl: groundLift(x),
        layer: 0, delay: 4 + i * 3, life: 34, max: 34, sc: 2, dirt: 1, vx: rnd(-0.7, 0.7), vy: rnd(-0.7, -0.15) });
  };

  // パリィ → 弾いた向きへ寒色の閃光。打撃（暖色）と色を変えて、
  // 「受け止めた」と「殴った」を色だけで見分けられるようにする
  const rawParry = doParry;
  doParry = function (e, p) {
    rawParry(e, p); p = p || player;
    const x = p.x + p.facing * 28, y = p.y - 58;
    push({ k: 'pxhit', x, y, gl: groundLift(p.x), layer: 1, delay: 0,
      life: 12, max: 12, fam: 'ice', sc: 2, rot: p.facing > 0 ? 0.36 : -0.36 });
    push({ k: 'pxrings', x, y, gl: groundLift(p.x), layer: 1, delay: 1,
      life: 20, max: 20, n: 3, r: 86, fam: 'ice' });
    push({ k: 'pxgash', x: x + p.facing * 14, y, gl: groundLift(p.x), layer: 1, delay: 0,
      life: 10, max: 10, fam: 'volt', rot: p.facing > 0 ? 0 : Math.PI, sc: 1 });
  };

  // 弾着 → 弾の色の火花。跳ね返った向きへ小さく散らす（爆発とは別物に見せる）
  const rawProjHitFx = projHitFx;
  projHitFx = function (pr, x, y) {
    rawProjHitFx(pr, x, y);
    push({ k: 'pxhit', x, y, gl: groundLift(x), layer: 1, delay: 0,
      life: 9, max: 9, fam: famOf(pr.color), sc: 1, rot: Math.atan2(pr.vy, pr.vx) });
  };

  // 着地・踏み込みの土煙 → もくもくした塊を1つ足す（本編の smoke も併走する）
  const rawSmokePuff = smokePuff;
  smokePuff = function (x, y, n, rgb) {
    rawSmokePuff(x, y, n, rgb);
    if (perfTier >= 2) return;
    push({ k: 'pxpuff', x: x + rnd(-8, 8), y, gl: groundLift(x), layer: 0,
      delay: Math.round(rnd(2, 7)), life: 30, max: 30, sc: 1, dirt: 0,
      vx: rnd(-0.8, 0.8), vy: rnd(-0.9, -0.2) });
  };

  //────────────────────────────────────────────────────────────────
  //  6. 粒ごとの描画（ドット絵）
  //────────────────────────────────────────────────────────────────
  const HD = Object.create(null);

  // ── 火花：1〜2ドットの点。速い粒だけ進行方向の筋になる ──
  HD.spark = function (p, sx, py, a) {
    const P = FAM[p._f || (p._f = famOf(p.color))];
    ctx.fillStyle = P[step6(a, 0)];
    const spd = Math.hypot(p.vx, p.vy);
    ctx.beginPath();
    if (spd > 4.2) dotLine(sx - p.vx * 0.55, py - p.vy * 0.55, sx, py, a > 0.55 ? 2 : 1);
    else { const s = a > 0.6 ? (p.sz > 1.2 ? 2 : 1) : 1; R(dX(sx) - (s >> 1), dY(py) - (s >> 1), s, s); }
    ctx.fill();
    if (p.star && a > 0.4) { ctx.fillStyle = '#ffffff'; ctx.beginPath(); R(dX(sx), dY(py), 1, 1); ctx.fill(); }
  };

  // ── 火の粉：短い尾を引く1ドット。段で 白→黄→橙→赤 と落ちる ──
  HD.ember = function (p, sx, py, a) {
    const P = FAM[p._f || (p._f = famOf(p.color))];
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = P[cyc(step6(a, 1), 4)];
    ctx.beginPath(); dotLine(p.px - camX, p.py - (p.gl || 0), sx, py, 1); ctx.fill();
    if (a > 0.55) { ctx.fillStyle = '#ffffff'; ctx.beginPath(); R(dX(sx), dY(py), 1, 1); ctx.fill(); }
    ctx.globalCompositeOperation = 'source-over';
  };

  // ── 輪：太さを持った帯。外へ1ドットぶんディザを回して境目を馴染ませる ──
  // 1ドットの輪だけにすると「針金の楕円」に見えて、衝撃波にならない
  HD.ring = function (p, sx, py, a) {
    const P = FAM[p._f || (p._f = famOf(p.color))], i = step6(a, 0);
    const ry = Math.max(PXU, p.r * p.sq), th = Math.max(2, dR(9 * a + 2.4));
    ctx.globalAlpha = Math.min(1, Math.pow(a, 1.2) * 1.35);
    ringBand(sx, py, p.r, ry, th, P[Math.min(5, i + 3)], P[i], P[0]);
    ctx.globalAlpha = 1;
  };

  // ── 衝撃リング：内側に薄い膜、輪は白熱、外へ抜けながら段が落ちる ──
  HD.shockring = function (p, sx, py, a) {
    const P = FAM[p._f || (p._f = famOf(p.color))], i = step6(a, 0);
    const ry = Math.max(PXU, p.r * p.sq), ea = Math.pow(a, 1.35);
    const th = Math.max(2, dR(Math.max(5, p.w * ea)));
    ctx.globalAlpha = ea * 0.26;
    fillPath(P[Math.min(5, i + 3)], () => ellFill(sx, py, p.r, ry));            // 内側の膜
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = Math.min(1, ea * 1.25);
    ringBand(sx, py, p.r, ry, th, P[Math.min(5, i + 3)], P[i], '#ffffff');
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  };

  // ── 床を這う土埃の輪：光らせない。太く低い帯で床に貼りつかせる ──
  HD.dustring = function (p, sx, py, a) {
    const B = smokeRamp(p.color || '58,46,36'), i = Math.min(4, Math.floor((1 - a) * 4));
    const ry = Math.max(PXU, p.r * p.sq), ea = Math.pow(a, 1.2);
    const th = Math.max(2, dR(p.w * ea));
    ctx.globalAlpha = ea * 0.9;
    ringBand(sx, py, p.r, ry, th, B[Math.min(4, i + 2)], B[Math.min(4, i + 1)], B[i]);
    ctx.globalAlpha = 1;
  };

  // ── 白い芯：段で割った同心の楕円。なめらかな放射グラデをやめる ──
  HD.shockcore = function (p, sx, py, a) {
    ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = a * a;
    bandDisc(sx, py, p.r, p.r, ['#ffd24d', '#fff0b0', '#ffffff'], 0.5);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  };
  // 打点の白芯。全面の白い丸にすると背景が飛ぶので、3段の硬い輪に割って
  // 中心だけを白く残す（外側は加算をやめ、色を残したまま重ねる）
  HD.flashcore = function (p, sx, py, a) {
    const Rr = p.r * (0.72 + (1 - a) * 0.62);
    const P = FAM[p._f || (p._f = famOf('rgb(' + p.color + ')'))];
    const al = a * a;
    ctx.globalAlpha = al * 0.85;
    fillPath(P[3], () => ellFill(sx, py, Rr, Rr));
    ctx.globalAlpha = al * 0.55;
    fillPath(P[3], () => ellDither(sx, py, Rr + PXU, Rr + PXU, 0));
    ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = al;
    fillPath(P[1], () => ellFill(sx, py, Rr * 0.62, Rr * 0.62));
    fillPath('#ffffff', () => ellFill(sx, py, Rr * 0.30, Rr * 0.30));
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  };

  // ── 放射線：根元が太く先が1ドットの棘 ──
  HD.impact = function (p, sx, py, a) {
    const pr = 1 - a, ez = 1 - a * a;
    const P = FAM[p._f || (p._f = famOf(p.color))], i = step6(a, 0);
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = P[i]; ctx.beginPath();
    for (const s of p.sp) {
      const an = s.a + p.rot, c = Math.cos(an), sn = Math.sin(an);
      const r0 = p.R * (0.26 + pr * 0.72) * s.len, r1 = p.R * (0.50 + ez * 0.95) * s.len;
      const mid = (r0 + r1) * 0.5;
      dotLine(sx + c * r0, py + sn * r0, sx + c * mid, py + sn * mid, a > 0.5 && s.w > 1 ? 2 : 1);
      dotLine(sx + c * mid, py + sn * mid, sx + c * r1, py + sn * r1, 1);
    }
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  };

  // ── 十字のフレア：等幅の1ドット線は「棒」に見えるので、
  //    根元が太く先が1ドットの紡錘を3段で割って作る ──
  HD.flare = function (p, sx, py, a) {
    const fa = Math.pow(a, 1.5), L = dR(p.R * (0.55 + a * 0.45)), X = dX(sx), Y = dY(py);
    const V = Math.max(1, (L * 0.46) | 0);
    const st = [[1.00, 1, '#fff2b8'], [0.58, 3, '#fffae0'], [0.22, 5, '#ffffff']];
    ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = fa;
    for (const s of st) {
      const lx = Math.max(1, (L * s[0]) | 0), ly = Math.max(1, (V * s[0]) | 0), t = s[1];
      ctx.fillStyle = s[2]; ctx.beginPath();
      R(X - lx, Y - (t >> 1), lx * 2 + 1, t);
      R(X - (t >> 1), Y - ly, t, ly * 2 + 1);
      ctx.fill();
    }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  };

  // ── 炎の塊：白芯→炎→煤の同心のベタ。瘤ごとに段をずらす ──
  HD.fireball = function (p, sx, py, a) {
    const u = 1 - a, gr = p.r * (0.55 + u * 0.85);
    const P = FAM[p._f || (p._f = famOf(p.color))];
    const base = Math.floor(u * 3);
    const cols = [P[Math.min(5, base + 3)], P[Math.min(5, base + 2)], P[Math.min(5, cyc(base, 4))], P[Math.min(5, base)]];
    ctx.globalAlpha = Math.pow(a, 0.5);
    for (let ci = 0; ci < cols.length; ci++) {
      const t = 1 - ci / cols.length;
      ctx.fillStyle = cols[ci]; ctx.beginPath();
      for (const L of p.lobes) ellFill(sx + gr * L[0], py + gr * L[1], gr * L[2] * t, gr * L[2] * t);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  };

  // ── 噴き上がる柱：段で割った横帯 ──
  HD.shockplume = function (p, sx, py, a) {
    const u = 1 - a, hh = p.h0 * (0.35 + u * 0.75), rw = p.r * (0.55 + u * 0.85);
    const P = FAM[p._f || (p._f = famOf(p.color))];
    const N = 5, X = dX(sx), Y = dY(py), H0 = dR(hh);
    ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = Math.pow(a, 1.5) * 0.7;
    for (let i = 0; i < N; i++) {
      const t0 = i / N, t1 = (i + 1) / N;
      const w = dR(rw * (0.5 + t0 * 0.62));
      ctx.fillStyle = P[Math.min(5, 1 + i)]; ctx.beginPath();
      R(X - w, Y - Math.round(H0 * t1), w * 2 + 1, Math.max(1, Math.round(H0 * (t1 - t0))));
      ctx.fill();
    }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  };

  // ── 立ち上がる光条：紡錘をドットの線で ──
  HD.shockbeam = function (p, sx, py, a) {
    const u = 1 - a, L = p.len * (0.3 + u * 0.9);
    const P = FAM[p._f || (p._f = famOf(p.color))];
    const c = Math.cos(p.a), s = Math.sin(p.a);
    ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = Math.pow(a, 1.7);
    fillPath(P[1], () => dotLine(sx, py, sx + c * L * 0.6, py + s * L * 0.6, a > 0.5 ? 3 : 2));
    fillPath('#ffffff', () => dotLine(sx, py, sx + c * L, py + s * L, 1));
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  };

  // ── 煙：段で割った塊＋外周のディザ。もくもくした瘤を残す ──
  HD.smoke = function (p, sx, py, a) {
    const Rr = p.r * (1 + (1 - a) * 1.7);
    const B = smokeRamp(p.color || '58,46,36');
    const i = Math.min(4, Math.floor((1 - a) * 3) + 1);
    const lb = p.lobes || [[0, 0, 1]];
    // 明るい段→暗い段の2枚。ステージの煙色から起こしているので暗い背景でも読める
    ctx.globalAlpha = Math.min(1, a * 1.7) * 0.72;
    for (let b = 0; b < 2; b++) {
      ctx.fillStyle = B[b ? Math.max(0, i - 1) : Math.min(4, i + 1)]; ctx.beginPath();
      for (let q = 0; q < lb.length; q++) ellFill(sx + lb[q][0] * Rr, py + lb[q][1] * Rr, Rr * lb[q][2] * (b ? 0.60 : 1), Rr * lb[q][2] * (b ? 0.50 : 0.82));
      ctx.fill();
    }
    ctx.globalAlpha = Math.min(1, a * 1.7) * 0.42;
    ctx.fillStyle = B[Math.min(4, i + 2)]; ctx.beginPath();
    for (let q = 0; q < lb.length; q++) ellDither(sx + lb[q][0] * Rr, py + lb[q][1] * Rr, Rr * lb[q][2] + PXU, Rr * lb[q][2] * 0.82 + PXU, 0);
    ctx.fill();
    ctx.globalAlpha = 1;
  };

  // ── 舞い上がる砂：1〜3ドットの土色の粒 ──
  HD.dust = function (p, sx, py, a) {
    const s = Math.max(1, dR((2.6 * a + 1.2) * FXS * p.sz * (1 + (1 - a) * 1.0)));
    ctx.globalAlpha = Math.min(1, a * 1.4) * 0.85;
    fillPath(DIRT[Math.min(4, Math.floor((1 - a) * 4))], () => R(dX(sx) - (s >> 1), dY(py) - (s >> 1), s, s));
    ctx.globalAlpha = 1;
  };

  // ── 焦げ跡：ディザで薄く貼りつく ──
  HD.scorch = function (p, sx, py, a) {
    ctx.globalAlpha = Math.pow(a, 0.7) * 0.6;
    fillPath('#231a12', () => ellFill(sx, py, p.r * 0.66, p.r * 0.16));
    ctx.globalAlpha = Math.pow(a, 0.7) * 0.35;
    fillPath('#1a130d', () => { for (let k = 0; k < 3; k++) ellDither(sx, py, p.r * (0.72 + k * 0.14), p.r * (0.18 + k * 0.035), k & 1); });
    ctx.globalAlpha = 1;
  };

  // ── きらめき ──
  HD.twinkle = function (p, sx, py, a) {
    const gr = Math.sin((1 - a) * Math.PI);
    ctx.globalCompositeOperation = 'lighter';
    sprAt(fxSpr(TWK_F, gr > 0.66 ? 2 : gr > 0.3 ? 1 : 0, 'gold', 'T'), sx, py, 1, a * 1.3, 0);
    ctx.globalCompositeOperation = 'source-over';
  };

  // ── 電撃：折れ線をドットで。数フレーム周期で色の段を送る ──
  HD.bolt = function (p, sx, py, a) {
    const P = FAM.volt, i = cyc(step6(a, 0), 2);
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = P[Math.min(5, i + 1)]; ctx.beginPath();
    let lx = sx, ly = py;
    for (let k = 1; k <= 7; k++) { const nx = sx + p.len * (k / 7), ny = py + (k < 7 ? rnd(-9, 9) : 0); dotLine(lx, ly, nx, ny, a > 0.5 ? 3 : 2); lx = nx; ly = ny; }
    ctx.fill();
    ctx.fillStyle = '#ffffff'; ctx.beginPath();
    lx = sx; ly = py;
    for (let k = 1; k <= 7; k++) { const nx = sx + p.len * (k / 7), ny = py + (k < 7 ? rnd(-6, 6) : 0); dotLine(lx, ly, nx, ny, 1); lx = nx; ly = ny; }
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  };
  HD.vbolt = function (p, sx, py, a) {
    const P = FAM.volt, i = cyc(step6(a, 0), 2), top = py - p.h;
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = P[Math.min(5, i + 1)]; ctx.beginPath();
    let lx = sx, ly = top;
    for (let k = 1; k <= 9; k++) { const nx = sx + (k < 9 ? rnd(-12, 12) : 0), ny = top + p.h * (k / 9); dotLine(lx, ly, nx, ny, a > 0.5 ? 4 : 2); lx = nx; ly = ny; }
    ctx.fill();
    ctx.fillStyle = '#ffffff'; ctx.beginPath();
    lx = sx; ly = top;
    for (let k = 1; k <= 9; k++) { const nx = sx + (k < 9 ? rnd(-8, 8) : 0), ny = top + p.h * (k / 9); dotLine(lx, ly, nx, ny, 1); lx = nx; ly = ny; }
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  };

  // ── 円弧のリボン：段で割った3枚の帯（外＝白熱／中＝技の色／内＝影）──
  HD.arc = function (p, sx, py, a) {
    const wj = (p.w == null ? 1 : p.w);
    pxArcRibbon(sx, py, p.r * (1.05 + 0.13 * a), p.r * (1 - 0.32 * wj), p.a0, p.a1, p.color, a);
  };

  // ── 追加：手描きの打撃閃光 ──
  // ドット絵は「パレットの段」で読ませる。加算で描くと明るい背景の上で
  // 段が全部白へ潰れるので、本体は通常合成。加算はもう1枚薄く重ねる光暈だけ
  HD.pxhit = function (p, sx, py, a) {
    const s = fxSpr(HIT_F, frameOf(a, HIT_F.length), p.fam, 'H');
    sprAt(s, sx, py, p.sc, Math.min(1, a * 2.2), p.rot);
    ctx.globalCompositeOperation = 'lighter';
    sprAt(s, sx, py, p.sc, a * 0.5, p.rot);
    ctx.globalCompositeOperation = 'source-over';
  };
  // ── 追加：斬撃の走り書き ──
  HD.pxgash = function (p, sx, py, a) {
    const s = fxSpr(GASH_F, frameOf(a, GASH_F.length), p.fam, 'G');
    sprAt(s, sx, py, p.sc, Math.min(1, a * 2.0), p.rot);
    ctx.globalCompositeOperation = 'lighter';
    sprAt(s, sx, py, p.sc, a * 0.45, p.rot);
    ctx.globalCompositeOperation = 'source-over';
  };
  // ── 追加：爆発 ──
  HD.pxboom = function (p, sx, py, a) {
    const fr = frameOf(a, BOOM_F.length);
    // 後半（煤・黒煙）は薄く抜く。ベタのまま残すと炎の上に灰色の板が乗る
    sprAt(fxSpr(BOOM_F, fr, p.fam, 'B'), sx, py, p.sc, fr < 3 ? Math.min(1, a * 2.4) : 0.34 + a * 0.9, 0);
  };
  // ── 追加：もくもくした土煙 ──
  HD.pxpuff = function (p, sx, py, a) {
    sprAt(smokeSpr(frameOf(a, PUFF_F.length), p.dirt), sx, py, p.sc, a * 1.6 * 0.7, 0);
  };
  // ── 追加：打点で2重3重に広がる輪。ヒットストップの間ずっと出続ける ──
  HD.pxrings = function (p, sx, py, a) {
    const P = FAM[p.fam] || FAM.hot;
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < p.n; i++) {
      const u = 1 - a - i * 0.24; if (u <= 0 || u >= 1) continue;
      const r = p.r * (0.12 + 0.88 * (1 - Math.pow(1 - u, 2.4)));
      const al = 1 - u;
      ctx.globalAlpha = al * al;
      const th = Math.max(2, dR(9 * al));
      const c = Math.min(5, 1 + i + ((u * 3) | 0));
      ringBand(sx, py, r, Math.max(PXU, r * 0.42), th, P[Math.min(5, c + 2)], P[c], '#ffffff');
    }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  };

  //────────────────────────────────────────────────────────────────
  //  7. drawParticles の差し替え
  //────────────────────────────────────────────────────────────────
  // 更新側も知らない粒があると寿命が減らないので、追加した種を面倒見る
  const rawUpdate = updateParticles;
  updateParticles = function () {
    for (let i = 0; i < particles.length; i++) {
      const q = particles[i];
      if (q.delay > 0 || (hitStop > 0 && gf % 3 !== 0)) continue;
      if (q.k === 'pxpuff') { q.x += q.vx; q.y += q.vy; q.vy *= 0.94; q.vx *= 0.96; }
    }
    rawUpdate();
  };

  const rawDrawParticles = drawParticles;
  const rest = [];
  let flashHold = 0;
  drawParticles = function (layer) {
    layer = layer | 0;
    if (layer === 0 && flashHold > 0) { flash = flashHold; flashHold = 0; }   // 前フレームが HUD へ行かなかったときの保険
    rest.length = 0;
    snapSet();
    const keepA = ctx.globalAlpha, keepO = ctx.globalCompositeOperation;
    for (let n = 0; n < particles.length; n++) {
      const p = particles[n];
      if (p.delay > 0) continue;
      if ((p.layer != null ? p.layer : 1) !== layer) continue;
      const h = HD[p.k];
      if (!h) { rest.push(p); continue; }
      const a = p.life / p.max;
      h(p, p.x - camX, p.y - (p.gl || 0), a < 0 ? 0 : a > 1 ? 1 : a);
    }
    ctx.globalAlpha = keepA; ctx.globalCompositeOperation = keepO;
    if (rest.length) {
      const keep = particles; particles = rest;
      try { rawDrawParticles(layer); } finally { particles = keep; }
    }
    // 全面の閃光は render() の中でなめらかな放射グラデとして描かれる。
    // ここで一度 0 にして黙らせ、HUD の直前でドット絵の閃光として描き直す
    if (layer === 2 && flash > 0) { flashHold = flash; flash = 0; }
  };

  //────────────────────────────────────────────────────────────────
  //  8. 円弧のリボン（drawArcRibbon の差し替え）
  //────────────────────────────────────────────────────────────────
  // 円錐グラデをやめ、外周＝白熱・中＝技の色・内＝影の3枚のベタにする。
  // 尾側は本編と同じ u^0.62 で絞るので、刃筋の向きは変わらない
  function ribbonBand(cx, cy, rOut, rIn, a0, a1, ysc, N) {
    const d = a1 - a0;
    ctx.beginPath();
    for (let i = 0; i < N; i++) { const u = i / (N - 1), an = a0 + d * u;
      const x = cx + Math.cos(an) * rOut, y = cy + Math.sin(an) * rOut * ysc;
      if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
    for (let i = N - 1; i >= 0; i--) { const u = i / (N - 1), an = a0 + d * u;
      const r = rOut - (rOut - rIn) * Math.pow(u, 0.62);
      ctx.lineTo(cx + Math.cos(an) * r, cy + Math.sin(an) * r * ysc); }
    ctx.closePath(); ctx.fill();
  }
  function pxArcRibbon(cx, cy, rOut, rIn, a0, a1, color, alpha, ysc) {
    const d = a1 - a0; if (Math.abs(d) < 0.004 || rOut <= 0) return;
    const P = FAM[famOf(color)], y = ysc || 1;
    const w = rOut - rIn;
    // 加算で重ねると刃が白く溶けて「霧」になる。通常合成のベタで段を作り、
    // 刃先の1〜2ドットだけを加算で白熱させる（本編の弾体でやったのと同じ切り分け）
    // 分割数は「1辺がおよそ6ドット」になるところで打ち切る。細かく割っても
    // 480×270 では同じ絵にしかならず、頂点だけが増える
    const N = Math.max(5, Math.min(16, Math.round(Math.abs(d) * rOut / (PXU * 6)) + 4));
    ctx.globalAlpha = Math.min(1, alpha * 1.3);
    if (perfTier < 1) { ctx.fillStyle = P[5]; ribbonBand(cx, cy, rOut + PXU, rIn - PXU, a0, a1, y, N); }   // 輪郭＝濃い線
    ctx.fillStyle = P[3]; ribbonBand(cx, cy, rOut, rIn, a0, a1, y, N);                    // 内側＝影
    ctx.fillStyle = P[2]; ribbonBand(cx, cy, rOut, rIn + w * 0.34, a0, a1, y, N);         // 中＝技の色
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = Math.min(1, alpha * 1.5);
    ctx.fillStyle = '#ffffff'; ribbonBand(cx, cy, rOut, rOut - Math.max(PXU, w * 0.20), a0, a1, y, N);   // 刃先の白熱
    // 刃筋に散る火花（4点だけ。増やすと帯が溶ける）
    ctx.fillStyle = P[1]; ctx.beginPath();
    for (let k = 0; k < 4; k++) { const an = a0 + d * (0.12 + k * 0.26);
      const r = rOut + PXU * (1 + ((k + gf) & 1));
      R(dX(cx + Math.cos(an) * r), dY(cy + Math.sin(an) * r * y), 1, 1); }
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
  }
  drawArcRibbon = function (cx, cy, rOut, rIn, a0, a1, rgb, alpha, fade, ysc) {
    snapSet();
    pxArcRibbon(cx, cy, rOut, rIn, a0, a1, 'rgb(' + rgb + ')', alpha, ysc);
  };

  //────────────────────────────────────────────────────────────────
  //  9. 星（drawStar の差し替え）
  //────────────────────────────────────────────────────────────────
  // 5角星はドットへ落とすと角が潰れて団子になる。4方向へ伸びるきらめきへ描き直す
  drawStar = function (x, y, r1, r2, color) {
    snapSet();
    const Rr = dR(r2), rr = Math.max(1, dR(r1)), X = dX(x), Y = dY(y);
    ctx.fillStyle = color; ctx.beginPath();
    for (let j = -Rr; j <= Rr; j++) {
      const t = 1 - Math.abs(j) / (Rr || 1);
      const w = Math.round(rr * t * t * 1.15);
      if (w >= 0) R(X - w, Y + j, w * 2 + 1, 1);
    }
    for (let i = -Rr; i <= Rr; i++) {
      const t = 1 - Math.abs(i) / (Rr || 1);
      const h = Math.round(rr * t * t * 1.15);
      if (h >= 0) R(X + i, Y - h, 1, h * 2 + 1);
    }
    ctx.fill();
  };

  //────────────────────────────────────────────────────────────────
  //  10. 画面演出
  //────────────────────────────────────────────────────────────────
  // ── 全面の閃光：段で割った同心の帯＋外側1ドットのディザ ──
  function pxFlash() {
    const fa = Math.pow(clamp(flash / 12, 0, 1), 1.55);
    if (fa <= 0.004) return;
    const fresh = clamp((flash - (flashPeak - 1.5)) / 1.5, 0, 1);
    const cx = (flashX == null ? W * 0.5 : clamp(flashX - camX, -W * 0.35, W * 1.35));
    const cy = (flashY == null ? H * 0.5 : clamp(flashY, -H * 0.35, H * 1.35));
    const rr = W * (flashX == null ? 0.92 : 0.76);
    snapSet();
    ctx.save();
    if (flashCol !== FLASH_DEF) {
      const P = FAM[famOf('rgb(' + flashCol + ')')];
      ctx.globalCompositeOperation = 'lighter';
      // 画面全体の底上げは平らな1枚（面で塗ると階調圧縮がきれいに段へ割る）。
      // そのうえに、打点から広がる同心の段を重ねる
      ctx.globalAlpha = fa * 0.10; ctx.fillStyle = P[4]; ctx.fillRect(0, 0, W, H);
      const bands = [[1.00, P[4], 0.10], [0.70, P[3], 0.17], [0.46, P[2], 0.26], [0.26, P[1], 0.40], [0.11, '#ffffff', 0.30 + 0.44 * fresh]];
      for (const b of bands) { ctx.globalAlpha = fa * b[2]; fillPath(b[1], () => ellFill(cx, cy, rr * b[0], rr * b[0])); }
      // いちばん外の段は硬い円の縁が出るので、市松で1〜2ドットぶん食い込ませて溶かす
      ctx.globalAlpha = fa * 0.12;
      fillPath(P[4], () => { for (let k = 0; k < 3; k++) ellDither(cx, cy, rr * (1 + k * 0.035), rr * (1 + k * 0.035), k & 1); });
    } else {
      // 被弾の赤。中央は薄く、画面のフチほど濃い段にして視界を殺さない
      ctx.globalAlpha = fa * 0.55;
      fillPath('rgb(255,150,140)', () => ellFill(cx, cy, rr * 0.22, rr * 0.22));
      const lv = [[0.34, 0.16], [0.55, 0.26], [0.76, 0.38], [1.00, 0.52]];
      for (const b of lv) {
        ctx.globalAlpha = fa * b[1];
        ctx.fillStyle = b[1] > 0.3 ? 'rgb(150,16,22)' : 'rgb(' + FLASH_DEF + ')';
        ctx.beginPath(); ctx.rect(0, 0, W, H); ellFill(W * 0.5, H * 0.5, H * b[0], H * b[0]);
        ctx.fill('evenodd');
      }
      ctx.globalAlpha = fa * 0.30;
      fillPath('rgb(190,20,26)', () => ellDither(W * 0.5, H * 0.5, H * 0.33, H * 0.33, 0));
    }
    ctx.globalAlpha = 1; ctx.restore();
  }

  // ── 致命の一撃：画面のフチを段で落とす（ディザ入り）──
  drawCritVignette = function () {
    if (critCam <= 0) return;
    const p = player, u = clamp(critCam / 40, 0, 1), a = 0.66 * Math.min(1, u * 1.6);
    const cx = (p.x - camX) + p.facing * 24, cy = p.y - 70;
    snapSet();
    ctx.save();
    const lv = [[0.92, 0.20], [0.70, 0.26], [0.52, 0.30], [0.34, 0.24]];
    for (const b of lv) {
      ctx.globalAlpha = a * b[1]; ctx.fillStyle = '#05030a';
      ctx.beginPath(); ctx.rect(0, 0, W, H); ellFill(cx, cy, H * b[0], H * b[0]);
      ctx.fill('evenodd');
    }
    ctx.globalAlpha = a * 0.35;
    fillPath('#05030a', () => { ellDither(cx, cy, H * 0.34, H * 0.34, 0); ellDither(cx, cy, H * 0.53, H * 0.53, 1); });
    if (perfTier < 2) {
      const bh = Math.round(H * 0.055 * Math.min(1, u * 2) / PXU) * PXU;
      ctx.globalAlpha = 0.88; ctx.fillStyle = '#05030a';
      ctx.fillRect(0, 0, W, bh); ctx.fillRect(0, H - bh, W, bh);
      ctx.globalAlpha = 0.5;
      ctx.beginPath(); ellDither(W * 0.5, bh, W, PXU * 1.5, 0); ellDither(W * 0.5, H - bh, W, PXU * 1.5, 0); ctx.fill();
    }
    ctx.globalAlpha = 1; ctx.restore();
  };

  // ── 奥義の残響：段で割った同心の楕円 ──
  drawEcho = function () {
    if (echoT <= 0 || perfTier >= 2) return;
    const u = echoT / echoMax, a = u * u * 0.42;
    const sx = echoX - camX, sy = echoY - 40, Rr = 200 + (1 - u) * 260;
    const P = FAM[famOf('rgb(' + echoRGB + ')')];
    snapSet();
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    const bands = [[1.00, 4, 0.30], [0.72, 3, 0.42], [0.46, 2, 0.52], [0.22, 1, 0.62]];
    for (const b of bands) { ctx.globalAlpha = a * b[2]; fillPath(P[b[1]], () => ellFill(sx, sy, Rr * b[0], Rr * b[0] * 0.78)); }
    ctx.globalAlpha = a * 0.5;
    fillPath(P[3], () => { ellDither(sx, sy, Rr, Rr * 0.78, 0); ellDither(sx, sy, Rr * 1.06, Rr * 0.78 * 1.06, 1); });
    ctx.globalAlpha = 1; ctx.restore();
  };

  // ── コンボの段位でフチが灯る：グラデをやめて段の帯にする ──
  drawComboGlow = function () {
    const ht = comboHeat();
    const fl = (combo.flare > 0 && combo.flareMax > 0) ? clamp(combo.flare / combo.flareMax, 0, 1) : 0;
    if (ht <= 0.001 && fl <= 0) return;
    const RK = comboRank(combo.count), P = FAM[famOf(RK[2])];
    const base = ht * 0.34 + fl * 0.38;
    const th = Math.round((56 + 70 * ht + 40 * fl) / PXU) * PXU;   // 帯の総厚（ドット格子へ）
    snapSet();
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    // 内から外へ4段。四辺とも同じ厚みで積むので、角が階段状に欠けない
    // （縦横で厚みを変えると角に切り欠きが出て、光ではなく枠のように見える）
    const N = 4;
    for (let i = 0; i < N; i++) {
      const t = (i + 1) / N;
      const hh = Math.round(th * t / PXU) * PXU;
      ctx.globalAlpha = base * 0.30; ctx.fillStyle = P[Math.min(5, 4 - i)];
      ctx.fillRect(0, 0, W, hh); ctx.fillRect(0, H - hh, W, hh);
      ctx.fillRect(0, hh, hh, H - hh * 2); ctx.fillRect(W - hh, hh, hh, H - hh * 2);
    }
    // 内側の境目を市松で1段ぶん食い込ませる（段がそのまま切れると板に見える）
    ctx.globalAlpha = base * 0.45;
    pxDitherRect(0, th, W, PXU * 3, 'rgba(0,0,0,0)', P[2], 0.5);
    pxDitherRect(0, H - th - PXU * 3, W, PXU * 3, 'rgba(0,0,0,0)', P[2], 0.5);
    pxDitherRect(th, 0, PXU * 3, H, 'rgba(0,0,0,0)', P[2], 0.5);
    pxDitherRect(W - th - PXU * 3, 0, PXU * 3, H, 'rgba(0,0,0,0)', P[2], 0.5);
    // 段位が上がった瞬間の輪。
    // ここだけは自前のドット輪（ringBand）ではなく ctx.ellipse で描く。
    // 480×270 へ落としてから14段へ切るので、楕円のアンチエイリアスは
    // 1ドットの中間色へ潰れて、結局ドットの輪になる（＝見た目は変わらない）。
    // 半径と線幅はドット格子へ丸めてあるので、縁が薄墨にならない。
    if (fl > 0) {
      const u = 1 - fl;
      const rr = Math.max(PXU * 3, Math.round(W * (0.16 + 0.62 * u) / PXU) * PXU);
      const lw = Math.max(PXU, Math.round(14 * fl / PXU) * PXU);
      // 輪はひとつ。同じパスを太→細と2回なぞって、帯＋1ドットの芯にする。
      // 半径を変えて何本も引くと「広がる輪」が1フレームに複数ある状態になり、
      // 輪の育ち方が読めなくなる。
      // 濃さは本編と同じ fl*0.55 を上限にする。lighter で重ねるので、
      // 3本 × α0.8 で引いたときは画面いっぱいの白い輪に飛んだ
      ctx.beginPath();
      ctx.ellipse(W * 0.5, H * 0.54, rr, rr * 0.62, 0, 0, TAU);
      for (const [col, w, a] of [[P[2], lw, 0.55], [P[4], PXU, 0.30]]) {
        ctx.globalAlpha = fl * a; ctx.lineWidth = w; ctx.strokeStyle = col; ctx.stroke();
      }
    }
    ctx.globalAlpha = 1; ctx.restore();
    if (ht >= 0.6 && perfTier < 2 && gf % 3 === 0)
      ember(camX + rnd(0, W), LANE - groundLift(camX + W * 0.5) + rnd(-10, 30), rnd(-0.6, 0.6), -rnd(1.4, 3.4), RK[2]);
  };

  // ── 画面遷移：アイリスの円をドットの円へ、帯はドット格子へ揃える ──
  const rawScreenFx = drawScreenFx;
  drawScreenFx = function () {
    if (scr.dur <= 0) return;
    if (scr.kind !== 'iris') { rawScreenFx(); return; }
    const h = scr.dur * 0.5;
    const k = scr.t < h ? easeOut(clamp(scr.t / h, 0, 1)) : 1 - easeOut(clamp((scr.t - h) / h, 0, 1));
    if (k <= 0.001) return;
    const r = Math.max(0, (1 - k) * Math.hypot(W, H) * 0.56);
    snapSet();
    ctx.save();
    ctx.fillStyle = '#07050d';
    ctx.beginPath(); ctx.rect(0, 0, W, H); ellFill(W * 0.5, H * 0.5, r, r); ctx.fill('evenodd');
    if (r > PXU * 2) {
      fillPath('rgba(255,214,110,' + (0.7 * k).toFixed(3) + ')', () => ellRing(W * 0.5, H * 0.5, r, r, 2));
      ctx.globalAlpha = 0.5 * k;
      fillPath('#ffd66e', () => ellDither(W * 0.5, H * 0.5, r + PXU, r + PXU, 0));
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  };

  //────────────────────────────────────────────────────────────────
  //  11. 弾（drawProjectiles の差し替え）
  //────────────────────────────────────────────────────────────────
  // なめらかなハロー・光芒をやめ、段で割った丸＋十字の芒＋ドットの尾にする。
  // 三日月の斬撃弾（pr.wave）と槍（pr.spike）は形が主役なので本編の描画を使う
  const rawProjectiles = drawProjectiles;
  drawProjectiles = function () {
    snapSet();
    const rest2 = [];
    for (let i = 0; i < projectiles.length; i++) { const pr = projectiles[i]; if (pr.wave || pr.spike) rest2.push(pr); }
    for (let i = 0; i < projectiles.length; i++) {
      const pr = projectiles[i]; if (pr.wave || pr.spike) continue;
      const gl = groundLift(pr.x), sx = pr.x - camX, sy = pr.y - pr.zz - gl;
      const P = FAM[famOf(pr.color)];
      // 尾：ドットの線を段で落としながら繋ぐ
      const tl = pr.trail, n = tl.length;
      if (n > 2) {
        const spd = Math.hypot(pr.vx, pr.vy), keep = clamp(Math.round(4 + spd * 0.9), 4, n), st = n - keep;
        ctx.globalCompositeOperation = 'lighter';
        for (let b = 0; b < 2; b++) {
          ctx.fillStyle = b ? P[1] : P[3]; ctx.beginPath();
          for (let j = st; j < n - 1; j++) {
            const u = (j - st) / Math.max(1, (n - 1 - st));
            if (b && u < 0.5) continue;
            const th = Math.max(1, dR(pr.r * (b ? 0.5 : 1.5) * u));
            dotLine(tl[j].x - camX, tl[j].y - groundLift(tl[j].x), tl[j + 1].x - camX, tl[j + 1].y - groundLift(tl[j + 1].x), th);
          }
          ctx.fill();
        }
        ctx.globalCompositeOperation = 'source-over';
      }
      // 光芒：進行方向へ伸びる十字（ドットの帯）
      const ang = Math.atan2(pr.vy, pr.vx), fl = 0.55 + 0.16 * Math.sin(gf * 0.4 + pr.spin);
      ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = fl;
      ctx.fillStyle = P[2]; ctx.beginPath();
      dotLine(sx - Math.cos(ang) * pr.r * 4.2, sy - Math.sin(ang) * pr.r * 4.2, sx + Math.cos(ang) * pr.r * 4.2, sy + Math.sin(ang) * pr.r * 4.2, 1);
      dotLine(sx + Math.sin(ang) * pr.r * 1.8, sy - Math.cos(ang) * pr.r * 1.8, sx - Math.sin(ang) * pr.r * 1.8, sy + Math.cos(ang) * pr.r * 1.8, 1);
      ctx.fill();
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
      // 弾体：外から 影→色→白熱の3段
      bandDisc(sx, sy, pr.r * 1.5, pr.r * 1.5, [P[4], P[3], P[2], P[0]], 1);
      // 衛星ドット（4方向）
      ctx.fillStyle = P[1]; ctx.beginPath();
      for (let k = 0; k < 4; k++) { const an = pr.spin + k * PI2;
        R(dX(sx + Math.cos(an) * pr.r * 1.15), dY(sy + Math.sin(an) * pr.r * 1.15), 1, 1); }
      ctx.fill();
    }
    if (rest2.length) {
      const keep = projectiles; projectiles = rest2;
      // 三日月弾と槍は形が主役なので本編の描画を使う。ただし中で使う放射グラデは段へ落とす
      try { stepped(rawProjectiles); } finally { projectiles = keep; }
    }
  };

  //────────────────────────────────────────────────────────────────
  //  12. 拾いもの（drawItems）と仕掛けの予兆（drawGimWarn）
  //────────────────────────────────────────────────────────────────
  // アイテムの光暈・コイン・武器の照りは radGrad（なめらかな放射グラデ）で描かれていて、
  // 480×270 では「ぼやけた丸」にしかならない。関数を丸ごと書き写すと本編と必ずずれるので、
  // 呼び出しの間だけ radGrad を「段で割った放射グラデ」へ差し替える。
  // ※差し替えるのは自分の担当（アイテム・弾）の描画中だけ。背景やキャラの radGrad は触らない
  const rawRadGrad = radGrad;
  const _sgc = new Map();
  const rgba4 = c => { if (c[0] === '#') { const v = pxRGB(c); return [v[0], v[1], v[2], 1]; }
    const m = String(c).match(/-?[\d.]+/g); return [+m[0], +m[1], +m[2], m.length > 3 ? +m[3] : 1]; };
  function pxRadGrad(x, y, r, inner, outer) {
    const k = x + ',' + y + ',' + r + ',' + inner + ',' + outer;
    let g = _sgc.get(k);
    if (g === undefined) {
      g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
      const A = rgba4(inner), B = rgba4(outer), N = 4;
      for (let i = 0; i < N; i++) {
        const t = (i + 0.5) / N;
        const c = 'rgba(' + ((A[0] + (B[0] - A[0]) * t) | 0) + ',' + ((A[1] + (B[1] - A[1]) * t) | 0) + ','
          + ((A[2] + (B[2] - A[2]) * t) | 0) + ',' + (A[3] + (B[3] - A[3]) * t).toFixed(3) + ')';
        g.addColorStop(i / N, c); g.addColorStop((i + 1) / N - 0.0001, c);   // 段の中は平ら
      }
      g.addColorStop(1, outer);
      if (_sgc.size > 400) _sgc.clear();
      _sgc.set(k, g);
    }
    return g;
  }
  const stepped = (fn) => { radGrad = pxRadGrad; try { return fn(); } finally { radGrad = rawRadGrad; } };

  const rawItems = drawItems;
  drawItems = function () { stepped(rawItems); };

  // 仕掛けの予兆：ストロークの楕円をやめ、太さのある帯と段で割った床の光にする。
  // これは「そこに落ちてくる」を知らせる読み札なので、輪郭が硬いほど読みやすい
  drawGimWarn = function () {
    snapSet();
    for (let i = 0; i < gimWarn.length; i++) {
      const w = gimWarn[i], sx = w.x - camX;
      if (sx < -60 || sx > W + 60) continue;
      const gy = LANE - groundLift(w.x), u = w.t / w.life, pulse = 0.5 + 0.5 * Math.sin(w.t * 0.4);
      const P = FAM[famOf(w.col)];
      ctx.save();
      ctx.globalAlpha = 0.18 + 0.22 * pulse;                       // 床が染まる段
      fillPath(P[3], () => ellFill(sx, gy, 56 * (1 - u * 0.35), 19 * (1 - u * 0.35)));
      ctx.globalAlpha = 0.34 + 0.46 * pulse;                       // 主の輪
      ringBand(sx, gy, 62 * (1 - u * 0.35), 22 * (1 - u * 0.35), 3, P[4], P[2], P[0]);
      ctx.globalAlpha = 0.16 + 0.22 * pulse;                       // 外周
      ringBand(sx, gy, 84 * (1 - u * 0.20), 30 * (1 - u * 0.20), 2, P[4], P[2], P[1]);
      ctx.globalAlpha = 0.55 + 0.4 * pulse;
      ctx.fillStyle = w.col; ctx.font = uif('900', 30); ctx.textAlign = 'center';
      ctx.fillText('!', pxSnap(sx), pxSnap(gy - 26)); ctx.textAlign = 'left';
      ctx.restore();
    }
  };

  //────────────────────────────────────────────────────────────────
  //  13. HUD の直前でドット絵の閃光を焼く
  //────────────────────────────────────────────────────────────────
  // 00_core が drawHUD を包んで pxPresent() を呼んでいる。その手前＝まだ
  // ドットバッファを描いている間に、全面の閃光をドットで置く
  const rawHUD = drawHUD;
  drawHUD = function () {
    if (flashHold > 0) { flash = flashHold; flashHold = 0; try { pxFlash(); } catch (e) { } }
    rawHUD();
  };

})();

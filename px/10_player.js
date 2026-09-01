// ══════════════════════════════════════════════════════════════════
//  プレイヤーとその装備、そして共有の陰影プリミティブをドット絵にする
// ══════════════════════════════════════════════════════════════════
// 本編のプレイヤーは「なめらかなグラデで塗った塊」を重ねて描いている。
// 低解像度へ落とすだけでは、隣り合う塊の明度が近いぶん1つのにじんだ塊になる。
// ドット絵として読めるようにするために、ここでは四つを足す：
//
//   1. シルエットに1ドットの濃い輪郭線     … 「板」ではなく「駒」に見せる（rimBegin/rimEnd）
//   2. 部位ごとに明度を離す                 … 頭・胴・手足・毛の面を先に3段へ分ける
//   3. 塗りを段に割る                       … グラデもベタも階段にする（帯グラデ／limbSeg）
//   4. 全身に4段の面の陰影を掛ける          … 光源側の上から反対の下へ、境目は硬く
//   5. 振り抜きの残像                       … 2・4フレーム前の姿を薄く後ろへ重ねる
//
// 1・3・4 は共有プリミティブ（rimBegin/rimEnd・limbSeg・volume）に入れてあるので、
// 同じ道具を使っているボスにも同時に効く。
//
// 呼吸・まばたき・耳と尻尾の二次モーション・着地スクワッシュ・速度スメアは
// すでに本編の updateRigP / eyeBlink / poseB が持っているので、そのまま使う
// （実測：400フレームで sq が 0.127 動き、耳は左右で振幅も位相も違い、
//   まばたきは4フレーム閉じた。新しく作り直していない）。
(function () {
  'use strict';

  //────────────────────────────────────────────────────────────────
  //  0. 色まわりの小道具
  //────────────────────────────────────────────────────────────────
  const OUTLINE = '#2b1a26';                 // 輪郭線。真っ黒だと背景から浮くので紫寄りの暗色
  const RIM_COOL = 'rgb(126,158,224)';       // 逆光側の照り返し

  // rgba を落とさない色補間。pxMix は alpha を捨てるので、
  // 透明へ抜けるグラデ（光の玉など）をそのまま通すと不透明な円盤になる
  function parseC(c) {
    if (!c) return null;
    if (c === 'transparent') return [0, 0, 0, 0];
    if (c[0] === '#') { const v = pxRGB(c); return [v[0], v[1], v[2], 1]; }
    const m = String(c).match(/-?[\d.]+/g);
    if (!m || m.length < 3) return null;
    return [+m[0], +m[1], +m[2], m.length > 3 ? +m[3] : 1];
  }
  function mixA(a, b, t) {
    const A = parseC(a), B = parseC(b);
    if (!A || !B) return a;
    return 'rgba(' + Math.round(A[0] + (B[0] - A[0]) * t) + ',' + Math.round(A[1] + (B[1] - A[1]) * t) + ','
      + Math.round(A[2] + (B[2] - A[2]) * t) + ',' + (A[3] + (B[3] - A[3]) * t).toFixed(3) + ')';
  }
  // ── 部位ごとに明度を離す ──
  // イッヌは 頭 #fff8e6 ／ 胴 #fdf6e0 ／ 脚 #efe2bc と、全部が同じクリーム色の
  // 隣り合う明度で並んでいる。ドットに落とすと色相の差は消え、画面では
  // 「クリーム色の四角」になる（CLAUDE.md にゼウスの同じ事故が残っている）。
  // 段に割る前に、いま描いている部位ごとに明度そのものをずらしてしまう：
  //   頭 = 明るい／脚・腕 = 中間／胴 = 暗い　の3段を先に作ってから色相を乗せる。
  // matShift はその「部位の段」。描画関数を包んで出し入れする
  let matShift = 0;
  // 明度をずらす。ただ暗くすると死ぬので、影側は青紫へ・光側は黄橙へ倒しながら動かす
  function shiftLum(c, d) {
    const A = parseC(c); if (!A || !d) return c;
    const cool = d < 0 ? -d : 0, warm = d > 0 ? d : 0;
    const f = (v, sh, hi) => { const n = v + d + cool * sh + warm * hi; return n < 0 ? 0 : n > 255 ? 255 : n; };
    return 'rgba(' + Math.round(f(A[0], -0.22, 0.10)) + ',' + Math.round(f(A[1], -0.10, 0.04)) + ','
      + Math.round(f(A[2], 0.30, -0.18)) + ',' + A[3].toFixed(3) + ')';
  }
  const SEP = 1.10, PIV = 132;
  function separate(c) {
    const A = parseC(c); if (!A) return c;
    const y = A[0] * 0.299 + A[1] * 0.587 + A[2] * 0.114;
    return shiftLum(c, (y - PIV) * (SEP - 1) + matShift);
  }

  // ── イッヌの毛の配色を、面ごとに段へ割り直す ──
  // 本編の頭は #eddcb0(たてがみ) / #fff8e6(頭) / #fffaf0(マズル) と、
  // 明度が 219・248・250 で並んでいる。3つとも「ほぼ白いクリーム」なので
  // ドットに落とすと1つの塊になり、顔がどこにあるか読めない。
  // 面積の広い外周（たてがみ・垂れ耳・胴のもこもこ）を落として、
  // 顔とマズルだけを最も明るい面として残す＝顔が浮き上がる。
  // 値は実際に本編が使っている色をそのまま鍵にしている
  const PAL_FIX = {
    '#eddcb0': -38,                                       // 顔まわりのたてがみ（いちばん広い面）
    '#efe0b8': -30, '#c9b083': -30, '#ecdcb0': -30, '#c4ab7c': -30,   // 垂れ耳
    '#fbeece': -20, '#dcc89c': -22,                       // 側頭・頬の毛玉
    '#fff7e0': -14, '#e3d1a6': -16,
    '#ead8ad': -6,                                        // 頭球の外（球自身の陰は残す）
    '#fff8e6': 4, '#fffaf0': 10,                          // 頭球の中とマズル＝最も明るい面
    '#f2e4bf': -22, '#ecdcb2': -16,                       // 胴のもこもこ外周と胸毛
  };
  function fixPal(c) { const d = PAL_FIX[c]; return d ? shiftLum(c, d) : c; }
  // 描画関数を「その部位の明度段」で包む
  function wrapMat(name, shift) {
    const raw = window[name];
    if (typeof raw !== 'function') return;
    window[name] = function () {
      const keep = matShift, kb = bandOn; matShift = shift; bandOn = PX.on;
      try { return raw.apply(this, arguments); } finally { matShift = keep; bandOn = kb; }
    };
  }

  //────────────────────────────────────────────────────────────────
  //  1. グラデーションを段に割る
  //────────────────────────────────────────────────────────────────
  // createLinearGradient の返り値の addColorStop を差し替えて、
  // 「前の色を次の停止の直前まで保持してから跳ぶ」＝階段にする。
  // 段数は停止どうしの間隔から決める（間隔×4を四捨五入、1〜4段）。
  //   刀身  0 / .45 / 1        → 2+2 = 4段（峰・地・刃・切先）
  //   胴    0 / 1              → 4段
  //   volume 0/.10/.32/.86/1   → 1+1+2+1 = 5段（作者が置いた5色がそのまま出る）
  // 半透明を含むグラデ（光・霧）は素通しにする。段に割ると光の玉が円盤になり、
  // なにより pxMix 系で alpha が落ちて不透明な塊になる
  const CG = window.CanvasGradient && window.CanvasGradient.prototype;
  const rawACS = CG && CG.addColorStop;
  function bandWrap(g) {
    if (!rawACS || !g || g.__pxb) return g;
    let po = null, pc = null;
    try {
      g.__pxb = 1;
      g.addColorStop = function (o, c0) {
        const c = fixPal(c0);
        const A = parseC(pc), B = parseC(c);
        if (pc == null || o <= po + 1e-6 || !A || !B || A[3] < 0.999 || B[3] < 0.999) {
          rawACS.call(g, o, (B && B[3] > 0.999) ? separate(c) : c);
        } else {
          const gap = o - po, n = Math.max(1, Math.min(4, Math.round(gap * 4))), seg = gap / n;
          for (let i = 0; i < n; i++) {
            const cc = separate(n === 1 ? pc : mixA(pc, c, (i + 0.5) / n));
            rawACS.call(g, po + seg * i, cc);
            rawACS.call(g, po + seg * (i + 1) - 1e-4, cc);
          }
          rawACS.call(g, o, separate(c));
        }
        po = o; pc = c;
      };
    } catch (e) { /* 実装によっては拡張できない。そのときは素のまま使う */ }
    return g;
  }

  // ── プレイヤーを描いている間だけ、全グラデを段に割る ──
  let bandOn = false;
  const C2 = window.CanvasRenderingContext2D && window.CanvasRenderingContext2D.prototype;
  if (C2) {
    const rawCLG = C2.createLinearGradient, rawCRG = C2.createRadialGradient;
    C2.createLinearGradient = function () { const g = rawCLG.apply(this, arguments); return bandOn ? bandWrap(g) : g; };
    C2.createRadialGradient = function () { const g = rawCRG.apply(this, arguments); return bandOn ? bandWrap(g) : g; };

    // ── ベタ塗りの色も部位の段へ通す ──
    // イッヌの面積の大半は「もこもこの毛玉」で、グラデではなく素の fillStyle で塗られている。
    // グラデだけ段に割っても、いちばん広い面が素通しでは画面上の塊は分かれない。
    // fillStyle/strokeStyle の代入を横取りして、部位ごとの明度ずらしをここで掛ける。
    // bandOn が false のときは元の setter をそのまま呼ぶだけ（背景と敵には触らない）
    const _tint = new Map();
    const tint = (v) => {
      if (typeof v !== 'string') return v;
      const k = v + '|' + matShift;
      let r = _tint.get(k);
      if (r === undefined) { r = separate(fixPal(v)); if (_tint.size > 4000) _tint.clear(); _tint.set(k, r); }
      return r;
    };
    for (const prop of ['fillStyle', 'strokeStyle']) {
      const d = Object.getOwnPropertyDescriptor(C2, prop);
      if (!d || !d.set) continue;
      Object.defineProperty(C2, prop, {
        configurable: true, enumerable: d.enumerable, get: d.get,
        set: function (v) { d.set.call(this, bandOn ? tint(v) : v); },
      });
    }
  }

  //────────────────────────────────────────────────────────────────
  //  2. 共有プリミティブ：volume（塊の厚み）
  //────────────────────────────────────────────────────────────────
  // 元は5停止のなめらかなグラデ1枚。ドット絵では境目が階調圧縮に飲まれて
  // ただの汚いグラデになるので、作者が置いた5色をそのまま5段のベタにする。
  const rawVolume = volume;
  volume = function (path, col, x0, y0, x1, y1, opt) {
    if (!PX.on) return rawVolume.apply(this, arguments);
    opt = opt || {};
    const lit = (opt.lit == null ? 32 : opt.lit), dark = (opt.dark == null ? -40 : opt.dark);
    const g = bandWrap(ctx.createLinearGradient(x0, y0, x1, y1));
    g.addColorStop(0, shade(col, lit + 30));
    g.addColorStop(0.10, shade(col, lit));
    g.addColorStop(0.32, col);
    g.addColorStop(0.86, shade(col, dark));
    g.addColorStop(1, shade(col, dark - 26));
    ctx.fillStyle = g; ctx.beginPath(); path(); ctx.fill();
    if (opt.edge) {
      // 半透明の黒線はドットでは薄墨に潰れる。不透明な暗色で、幅はドットの整数倍
      ctx.strokeStyle = mixA(col, OUTLINE, 0.78);
      ctx.lineWidth = dotW(opt.edgeW == null ? 2.6 : opt.edgeW);
      ctx.lineJoin = 'round';
      ctx.beginPath(); path(); ctx.stroke();
    }
  };

  //────────────────────────────────────────────────────────────────
  //  3. 共有プリミティブ：limbSeg（手足の1本）を4段で塗る
  //────────────────────────────────────────────────────────────────
  // 元は「半透明の濃い縁＋ベタ1色」。ドットに落とすと縁が薄墨になり、
  // 面が真っ平らなので腕が板に見える。
  // 影・地・光・ハイライトの4段を、光の向きへずらした帯として重ねる。
  // 線幅はすべてドットの整数倍へ丸める（半端な幅は低解像度で滲む）。

  // 現在の変換で「ローカル単位に換算した1ドット」。
  // ヘッドレス検証の ctx は何でも吸い込む Proxy なので、getTransform が
  // 数値を返さないことがある。返らなければ等倍とみなして落とさない
  const _IDENT = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
  function xform() {
    try { const M = ctx.getTransform(); return (M && typeof M.a === 'number') ? M : _IDENT; }
    catch (e) { return _IDENT; }
  }
  function dotU() { const k = Math.abs(xform().a) || 1; return 1 / k; }
  function dotScale() { return Math.abs(xform().a) || 1; }
  // 幅をドットの整数倍へ丸める（最低1ドット）
  function dotW(w) { const u = dotU(); return Math.max(1, Math.round(w / u)) * u; }

  // 光の向き（ローカルx）。facing で反転しているぶんを打ち消す
  let _lkF = -1, _lkX = 1;
  function lightX() {
    if (_lkF !== gf) { _lkF = gf; _lkX = rimKey().dir; }
    return (xform().a < 0 ? -_lkX : _lkX);
  }

  // 明度を離した4段＋輪郭色。色ごとに一度だけ作って使い回す
  const _palCache = new Map();
  function limbPal(col) {
    const key = col + '|' + matShift;
    let p = _palCache.get(key);
    if (!p) {
      // 7段のランプから1・3・5・6を取る＝隣り合う面が必ず2段以上離れる
      const R = pxRamp(separate(col), 7);
      p = { o: mixA(col, OUTLINE, 0.72), s: R[1], b: R[3], l: R[5], h: R[6] };
      if (_palCache.size > 120) _palCache.clear();
      _palCache.set(key, p);
    }
    return p;
  }

  const rawLimbSeg = limbSeg;
  limbSeg = function (ax, ay, bx, by, w, col) {
    if (!PX.on) return rawLimbSeg.apply(this, arguments);
    const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1e-6;
    const ux = dx / len, uy = dy / len;
    let nx = -uy, ny = ux;                                   // 法線
    // 光は「上」かつ「光源側」から来る。その向きを向く法線を選ぶ
    if (nx * lightX() * 0.55 + (-ny) * 1.0 < 0) { nx = -nx; ny = -ny; }
    const P = limbPal(col), u = dotU(), k = dotScale();
    const wd = w * k;                                        // ドット換算の太さ
    ctx.lineCap = 'round';
    const seg = (off, wid, cl, trim) => {
      ctx.strokeStyle = cl; ctx.lineWidth = wid;
      ctx.beginPath();
      ctx.moveTo(ax + nx * off + ux * trim, ay + ny * off + uy * trim);
      ctx.lineTo(bx + nx * off - ux * trim, by + ny * off - uy * trim);
      ctx.stroke();
    };
    seg(0, dotW(w) + 2 * u, P.o, 0);                         // 輪郭（1ドット外へ回る濃い線）
    seg(0, dotW(w), P.s, 0);                                 // 影＝面いっぱい
    if (wd < 4.5) return;                                    // 細い手足はここまで（段を入れると潰れる）
    seg(w * 0.14, dotW(w * 0.68), P.b, w * 0.10);            // 地
    if (wd < 6.5) return;
    seg(w * 0.28, dotW(w * 0.36), P.l, w * 0.22);            // 光
    if (wd < 9) return;
    seg(w * 0.40, u, P.h, w * 0.34);                         // ハイライト（1ドット）
  };

  //────────────────────────────────────────────────────────────────
  //  4. 共有プリミティブ：poseArm の手を丸から「輪郭付きの塊」へ
  //────────────────────────────────────────────────────────────────
  const rawPoseArm = poseArm;
  poseArm = function (shX, shY, swordAng, l1, l2, col, wm, bend) {
    const r = rawPoseArm(shX, shY, swordAng, l1, l2, col, wm, bend);
    if (!PX.on) return r;
    const R = (3.4 * (wm || 1)), u = dotU(), P = limbPal(col);
    const lx = lightX();
    pxCircle(r.hx, r.hy, R + u, P.o);                        // 濃い縁
    pxCircle(r.hx, r.hy, R, P.s);                            // 影
    if (R / u >= 2.5) pxCircle(r.hx - lx * u * 0.6, r.hy - u * 0.6, R - u, P.b);
    if (R / u >= 3.5) pxCircle(r.hx - lx * u, r.hy - u * 1.2, R - u * 2, P.l);
    return r;
  };

  //────────────────────────────────────────────────────────────────
  //  5. シルエットの輪郭線・硬いリムライト・残像（rimBegin / rimEnd）
  //────────────────────────────────────────────────────────────────
  // rimBegin は「キャラのローカル原点・回転なし」で呼ばれる唯一の場所なので、
  // ここがシルエット処理を挟むのに一番都合が良い。中身を丸ごと差し替える。
  //   ・1ドットの濃い輪郭を外へ回す（pxOutlined と同じ「ずらして削る」手口）
  //   ・光源側の内側1ドットを暖色、逆側を寒色で塗る＝リムライトを線にする
  //   ・振り抜き中は2・4フレーム前の姿を薄く後ろへ重ねる（残像）
  const RS = 512, ROX = 256, ROY = 400;      // 下書きの大きさと原点（足元）
  let rcA = null, rcAc = null, rcB = null, rcBc = null;
  function rInit() {
    if (rcA) return;
    rcA = document.createElement('canvas'); rcA.width = rcA.height = RS; rcAc = rcA.getContext('2d');
    rcB = document.createElement('canvas'); rcB.width = rcB.height = RS; rcBc = rcB.getContext('2d');
  }

  // ── 残像リング（プレイヤー専用。振り抜き中だけ確保・更新する）──
  // 姿勢は poseB のローパスを通っているので、1フレーム前はほとんど同じ形になる。
  // 目に見える残像にするには間隔を空けて拾う必要があるので、毎フレーム控えて
  // 2フレーム前・4フレーム前の2枚だけを重ねる（GHOST_LAG）
  const GN = 5, GHOST_LAG = [[4, 0.15], [2, 0.32]];
  let gcv = null, gctx = null, gmeta = null, gi = 0;
  function gInit() {
    if (gcv) return;
    gcv = []; gctx = []; gmeta = [];
    for (let i = 0; i < GN; i++) {
      const c = document.createElement('canvas'); c.width = c.height = RS;
      gcv.push(c); gctx.push(c.getContext('2d')); gmeta.push(null);
    }
  }
  function swinging(p) {
    const s = p.state;
    return s === 'attack' || s === 'rush' || s === 'wheel' || s === 'screw' || s === 'gswing'
      || s === 'ichimonji' || s === 'tkick' || s === 'iaidash' || s === 'dunk' || (p.jAtk || 0) > 0;
  }

  let rimDepth = 0, inPlayer = false;
  const rawRimBegin = rimBegin, rawRimEnd = rimEnd;

  let rimFrame = -1;
  rimBegin = function (hw, hh) {
    // 描画の途中で例外が飛ぶと rimEnd が呼ばれず入れ子の数だけが残る。
    // フレームが変わったら必ず 0 へ戻す（残ると以降ずっと素通しになる）
    if (rimFrame !== gf) { rimFrame = gf; rimDepth = 0; }
    if (!PX.on || rimDepth > 0) return rawRimBegin(hw, hh);
    const M = xform();
    if (M === _IDENT || M.b || M.c) return rawRimBegin(hw, hh);
    rInit();
    const kx = Math.abs(M.a) || 1, ky = Math.abs(M.d) || 1;
    // 枠は本編より広く取る。本編の 68×156 では犬干し竿やパイルバンカーが
    // 枠の縁で直線的に切り落とされる（薄い長方形の継ぎ目として画面に出る）
    const HW = Math.max(hw, 122), HH = Math.max(hh, 150), BEL = 44;
    const w = Math.ceil(HW * 2 * kx) + 8, h = Math.ceil((HH + BEL) * ky) + 8;
    if (w > RS - 6 || h > RS - 6) return rawRimBegin(hw, hh);   // 入らなければ本編の実装へ戻す
    const bx = Math.max(0, ROX - (w >> 1)), by = Math.max(0, ROY - h + Math.ceil(BEL * ky));
    rcAc.setTransform(1, 0, 0, 1, 0, 0);
    rcAc.globalAlpha = 1; rcAc.globalCompositeOperation = 'source-over';
    rcAc.clearRect(bx - 3, by - 3, w + 6, h + 6);
    rcAc.setTransform(M.a, 0, 0, M.d, ROX, ROY);
    rcAc.imageSmoothingEnabled = true;
    const st = { px: 1, main: ctx, M: M, bx: bx, by: by, w: w, h: h, pl: inPlayer };
    ctx = rcAc; rimDepth++;
    return st;
  };

  // シルエットをずらして削ると、ずらした側と反対の縁が「内側1ドットの帯」として残る。
  // それを単色で塗って本体へ焼き戻す＝硬いリムライト
  function rimInner(bx, by, w, h, dx, dy, col, alpha) {
    rcBc.setTransform(1, 0, 0, 1, 0, 0);
    rcBc.globalCompositeOperation = 'source-over'; rcBc.globalAlpha = 1;
    rcBc.clearRect(bx, by, w, h);
    rcBc.drawImage(rcA, bx, by, w, h, bx, by, w, h);
    rcBc.globalCompositeOperation = 'destination-out';
    rcBc.drawImage(rcA, bx, by, w, h, bx + dx, by + dy, w, h);
    rcBc.globalCompositeOperation = 'source-in';
    rcBc.fillStyle = col; rcBc.fillRect(bx, by, w, h);
    // 枠の縁に触れている画素は体の輪郭ではなく「枠で切られた断面」。光らせると四角い線が出る
    rcBc.globalCompositeOperation = 'destination-out'; rcBc.fillStyle = '#000';
    rcBc.fillRect(bx, by, w, 2); rcBc.fillRect(bx, by + h - 2, w, 2);
    rcBc.fillRect(bx, by, 2, h); rcBc.fillRect(bx + w - 2, by, 2, h);
    rcBc.globalCompositeOperation = 'source-over';
    rcAc.save(); rcAc.setTransform(1, 0, 0, 1, 0, 0);
    rcAc.globalCompositeOperation = 'source-atop'; rcAc.globalAlpha = alpha;
    rcAc.drawImage(rcB, bx, by, w, h, bx, by, w, h);
    rcAc.restore();
  }

  const OFFS = [[-1, 0], [1, 0], [0, -1], [0, 1]];

  // ── 全身にかかる面の陰影を「段」で乗せる ──
  // 部位ごとの塗りだけでは、どの面も同じ強さで光っていて塊の前後が読めない。
  // シルエット全体へ、光源のある上手前から反対の下奥へ向かって
  // 「光・地・影・深い影」の4段を斜めに掛ける（境目は硬い）。
  // 厚塗りの立体感はほぼこの1枚で決まる。source-atop なので体の外へは出ない
  const _fsCache = new Map();
  function formShade(bx, by, w, h, dir) {
    const k = bx + ',' + by + ',' + w + ',' + h + '|' + dir;
    let g = _fsCache.get(k);
    if (g === undefined) {
      // 座標は「塗るときのユーザ空間」で解釈されるので、転送と同じ等倍座標で作る
      g = dir > 0 ? rcAc.createLinearGradient(bx + w, by, bx, by + h)
        : rcAc.createLinearGradient(bx, by, bx + w, by + h);
      const S = [[0, 'rgba(255,228,170,0.22)'], [0.28, 'rgba(255,228,170,0.22)'],
      [0.2801, 'rgba(255,228,170,0.00)'], [0.52, 'rgba(255,228,170,0.00)'],
      [0.5201, 'rgba(44,30,72,0.22)'], [0.76, 'rgba(44,30,72,0.22)'],
      [0.7601, 'rgba(28,16,48,0.42)'], [1, 'rgba(28,16,48,0.42)']];
      for (const s of S) rawACS.call(g, s[0], s[1]);
      if (_fsCache.size > 40) _fsCache.clear();
      _fsCache.set(k, g);
    }
    return g;
  }

  rimEnd = function (st, strength) {
    if (!st) return;
    if (!st.px) return rawRimEnd(st, strength);
    ctx = st.main; rimDepth--;
    // ここから先の色（輪郭・リム・面の陰影）は、もう部位の明度段を通さない。
    // 通すと輪郭線の色まで matShift で動いて、部位ごとに違う濃さの線が出る
    const _kb = bandOn; bandOn = false;
    try { rimComposite(st, strength); } finally { bandOn = _kb; }
  };
  function rimComposite(st, strength) {
    const bx = st.bx, by = st.by, w = st.w, h = st.h, M = st.M;
    const a = clamp(strength == null ? 1 : strength, 0, 2);

    // ── 全身の面の陰影を4段で乗せる ──
    {
      const K0 = rimKey();
      rcAc.save(); rcAc.setTransform(1, 0, 0, 1, 0, 0);
      rcAc.globalCompositeOperation = 'source-atop'; rcAc.globalAlpha = 1;
      rcAc.fillStyle = formShade(bx, by, w, h, K0.dir);
      rcAc.fillRect(bx, by, w, h);
      rcAc.restore();
    }
    // ── リムライト：内側1ドットの線。面の横グラデはドットでは濁るので使わない ──
    if (perfTier < 1) {
      const K = rimKey();
      rimInner(bx, by, w, h, -K.dir, -1, 'rgb(' + K.rgb + ')', clamp(a * 0.95, 0, 1));
      rimInner(bx, by, w, h, K.dir, 1, RIM_COOL, clamp(a * 0.45, 0, 1));
    }

    // ── 輪郭：外へ1ドットの濃い線を回す ──
    rcBc.setTransform(1, 0, 0, 1, 0, 0);
    rcBc.globalCompositeOperation = 'source-over'; rcBc.globalAlpha = 1;
    rcBc.clearRect(bx - 2, by - 2, w + 4, h + 4);
    for (let i = 0; i < 4; i++) rcBc.drawImage(rcA, bx, by, w, h, bx + OFFS[i][0], by + OFFS[i][1], w, h);
    rcBc.globalCompositeOperation = 'destination-out';
    rcBc.drawImage(rcA, bx, by, w, h, bx, by, w, h);          // 中身をくり抜く＝縁だけが残る
    rcBc.globalCompositeOperation = 'source-in';
    rcBc.fillStyle = OUTLINE; rcBc.fillRect(bx - 2, by - 2, w + 4, h + 4);
    rcBc.globalCompositeOperation = 'source-over';

    const ox = M.e - ROX, oy = M.f - ROY;
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.imageSmoothingEnabled = false;
    // ── 残像 → 輪郭 → 本体 の順に重ねる ──
    const swing = st.pl && player && swinging(player);
    if (swing) {
      gInit();
      const keep = ctx.globalAlpha;
      for (let q = 0; q < GHOST_LAG.length; q++) {            // 古いほど薄い
        const k = GHOST_LAG[q][0], idx = (gi - k + GN * 2) % GN, m = gmeta[idx];
        if (!m || gf - m.f > k + 2) continue;                 // 技が切れた直後の古い姿は出さない
        ctx.globalAlpha = keep * GHOST_LAG[q][1];
        ctx.drawImage(gcv[idx], m.bx, m.by, m.w, m.h, m.ox + m.bx, m.oy + m.by, m.w, m.h);
      }
      ctx.globalAlpha = keep;
    }
    ctx.drawImage(rcB, bx - 1, by - 1, w + 2, h + 2, ox + bx - 1, oy + by - 1, w + 2, h + 2);
    ctx.drawImage(rcA, bx, by, w, h, ox + bx, oy + by, w, h);
    ctx.restore();

    // 次のフレームの残像用に、今の姿（輪郭込み）を控えておく
    if (swing) {
      gi = (gi + 1) % GN;
      const g = gctx[gi];
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
      g.clearRect(bx - 2, by - 2, w + 4, h + 4);
      g.drawImage(rcB, bx - 1, by - 1, w + 2, h + 2, bx - 1, by - 1, w + 2, h + 2);
      g.drawImage(rcA, bx, by, w, h, bx, by, w, h);
      gmeta[gi] = { f: gf, bx: bx - 1, by: by - 1, w: w + 2, h: h + 2, ox: ox, oy: oy };
    }
  }

  //────────────────────────────────────────────────────────────────
  //  6. 刃：グラデの刀身をやめ、峰・地・刃・切先の4段のベタにする
  //────────────────────────────────────────────────────────────────
  // drawBlade は装備ごとに30近い分岐があり、どれも
  // createLinearGradient(刀身の根元 → 切先) で塗っている。
  // 1本ずつ書き直す代わりに、5. の帯グラデを効かせて全分岐を一度に段へ割る。
  // 停止が 0/.45/1 の刀身は 2+2 で4段になる。
  // 刃の輪郭は rimEnd のシルエット輪郭が拾う（武器は体の外へ出るため）。
  function wrapBanded(name) {
    const raw = window[name];
    if (typeof raw !== 'function') return;
    window[name] = function () {
      const keep = bandOn; bandOn = PX.on;
      try { return raw.apply(this, arguments); } finally { bandOn = keep; }
    };
  }

  //────────────────────────────────────────────────────────────────
  //  7. プレイヤー本体。段塗りを効かせ、残像の対象だと印を付ける
  //────────────────────────────────────────────────────────────────
  const rawDrawPlayer = drawPlayer;
  drawPlayer = function () {
    const keep = bandOn, kp = inPlayer;
    bandOn = PX.on; inPlayer = true;
    try { return rawDrawPlayer.apply(this, arguments); }
    finally { bandOn = keep; inPlayer = kp; }
  };

  // プレイヤーの外で呼ばれる装備・立ち絵も同じ段塗りに乗せる
  for (const nm of ['drawGatlingGun', 'drawPlayerPortrait', 'drawStetson', 'drawTopHat', 'drawRevolver']) wrapBanded(nm);

  // ── 部位の明度段を割り当てる ──
  // 「暗い胴・中間の手足・明るい頭」の3段を先に作る。上から順に暗→明。
  // 装備（刃・銃・盾・かぶり物）は素の明度のまま：ここを触ると金属の照りが死ぬ
  for (const nm of ['chibiBody', 'watchBody', 'shimaBody', 'nukoBody', 'guard8Body', 'wandenBody', 'mackBody'])
    wrapMat(nm, -30);
  for (const nm of ['drawCape', 'drawNukoRobeBack', 'drawCosBack']) wrapMat(nm, -30);
  for (const nm of ['drawCosFront']) wrapMat(nm, -16);
  for (const nm of ['chibiHead', 'watchHead', 'shimaHead', 'nukoHead', 'guard8Head', 'wandenHead', 'mackHead'])
    wrapMat(nm, 6);

  //────────────────────────────────────────────────────────────────
  //  8. 素の丸を使っている顔まわり（furBall）に段の縁を1枚足す
  //────────────────────────────────────────────────────────────────
  // furBall は放射グラデ1枚の球。帯グラデで段には割れるが、隣の球と
  // 明度が近いので輪郭が消える。球の下側に1段暗い三日月を敷いて塊を分ける
  const rawFurBall = furBall;
  furBall = function (x, y, r, inner, outer) {
    if (bandOn && r > 3.4) {
      // 光と反対の下側へ1ドットぶんずらした暗い球を先に敷く＝毛玉の底に影の三日月が残る。
      // 頭は毛玉の集合なので、これだけで「もこもこの塊が積まれている」形が読める。
      // 頭の毛玉は胴の後に描かれるので、頭と胴の境目にも自然に暗い線が入る
      const u = dotU(), lx = lightX();
      ctx.save();
      ctx.fillStyle = mixA(outer, OUTLINE, 0.46);
      ctx.beginPath(); ctx.arc(x - lx * u * 0.7, y + u * 1.1, r + u * 0.5, 0, 7); ctx.fill();
      ctx.restore();
    }
    return rawFurBall(x, y, r, inner, outer);
  };

  //────────────────────────────────────────────────────────────────
  //  9. デバッグ用の手掛かり
  //────────────────────────────────────────────────────────────────
  window.PXP = {
    band: (v) => { bandOn = !!v; },
    rawPlayer: rawDrawPlayer,          // 素の描画（負荷比較用）
    rawRim: [rawRimBegin, rawRimEnd],
    pal: _palCache,
    info: () => ({ outlineCanvas: RS, ghosts: GN, ghostAlloc: !!gcv }),
  };
})();

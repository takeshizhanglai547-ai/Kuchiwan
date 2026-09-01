// ══════════════════════════════════════════════════════════════════
//  ドット絵レンダリングの土台
// ══════════════════════════════════════════════════════════════════
// 本編は 960×540 の論理座標へフル解像度で描いている。ドット絵版は
// その論理座標をそのまま使いながら、実体を 480×270 の低解像度バッファへ
// 落として描き、最後に整数倍でニアレスト拡大して出す。
//
//   本編の描画コード ── 一切書き換えない ──> 480×270 バッファ
//                                              │ 階調圧縮＋ディザ
//                                              ▼
//                                        960×540 表示キャンバス（＋等倍UI）
//
// 「低解像度で描いてから色数を落とす」順序が肝。canvas のアンチエイリアスで
// できた中間色が、階調を落とした瞬間に1ドットの中間色へ潰れる。これは
// ドット絵職人が輪郭に手で置くアンチエイリアスと同じ結果になる。
// 先に色を落としてから縮小すると、ただの汚い縮小画像にしかならない。

const PX = {
  W: 480, H: 270,          // 内部解像度（本編 960×540 のちょうど半分）
  ZOOM: 2,                 // 表示キャンバスの倍率。960×540 の裏画面へ出す
  // 1チャンネルあたりの階調数。6 まで落とすと段が広すぎてディザが網点に見え、
  // 「ドット絵」ではなく「新聞の写真」になる。14 前後が、平らな面はベタで乗り、
  // グラデーションだけがディザに割れる境目（実測でこの値を選んだ）
  levels: 14,
  // ディザの強さ。0.9 は「1段ぶんまるごと揺らす」量で、平面まで市松に割れて
  // 網点に見えた（目視監査の最大の指摘）。0.55 だと、段の境目だけが崩れて
  // 平らな面はベタのまま残る
  dither: 0.55,
  grade: true,             // 色調補正（影を寒色へ・光を暖色へ・彩度を持ち上げる）
  on: true,
};
const PX_SC = W / PX.W;    // 論理座標 → バッファ座標（=0.5）

// ── 世界バッファ（キャラと背景はすべてここへ）──
const pxBuf = document.createElement('canvas');
pxBuf.width = PX.W; pxBuf.height = PX.H;
const pxCtx = pxBuf.getContext('2d', { alpha: false, willReadFrequently: true });
// ── 重ね描き用のもう1枚（カットインなど、透過のまま拡大したいもの）──
const pxOvl = document.createElement('canvas');
pxOvl.width = PX.W; pxOvl.height = PX.H;
const pxOvlCtx = pxOvl.getContext('2d');
// ── 表示キャンバスのコンテキスト（HUD と等倍のUIはここへ）──
const pxDisp = ctx;

// ── 本物のキャンバスかどうか ──────────────────────────────────
// tests/nm_head.js のヘッドレス検証は、canvas も 2D コンテキストも
// 何でも吸い込む Proxy に差し替える。そこへ 480×270 ぶんの
// getImageData／画素ループを流すと、1画素ごとに Proxy のトラップが走って
// スイートが数分止まる（実際にタイムアウトした）。
// 本物のキャンバスでないと分かったら、転送も階調圧縮も丸ごと畳む。
// 描画関数の差し替え（px/10〜50）はそのまま効くので、
// 絵を検査するスイートは新しい描画コードを通る。
const PX_REAL = (() => {
  try {
    const t = pxCtx.getImageData(0, 0, 1, 1);
    return !!(t && ArrayBuffer.isView(t.data) && t.data.length === 4);
  } catch (e) { return false; }
})();
if (!PX_REAL) PX.on = false;

function pxResetWorld() {
  pxCtx.setTransform(1 / PX_SC, 0, 0, 1 / PX_SC, 0, 0);
  pxCtx.imageSmoothingEnabled = true;   // 縮小した素材はなめらかに。輪郭は階調圧縮で立つ
}
function pxResetDisp() {
  pxDisp.setTransform(cv.width / W, 0, 0, cv.height / H, 0, 0);
  pxDisp.imageSmoothingEnabled = false;
}

// setupCanvas は本編が resize() から呼ぶ。ドット絵版では表示キャンバスを
// 内部解像度の整数倍に固定する（半端な倍率にすると拡大でドットが不揃いになる）。
if (PX_REAL) {
  setupCanvas = function () {
    cv.width = PX.W * PX.ZOOM; cv.height = PX.H * PX.ZOOM;
    pxResetDisp(); pxResetWorld();
  };
  // 表示倍率は本編と同じ「画面に収まる実数倍」のままにする。
  // 一度これを 0.5 刻みへ丸めたが、監査の実測で 800×600 のウィンドウが
  // 480×270 まで落ち、画面の82%が黒帯になった（1280×720 でも面積の44%を捨てる）。
  // さらにキャンバスだけ縮んで HTML のメニューは CSS px 固定なので、
  // メニューがゲーム画面より大きくなってタイトルロゴを覆った。
  // 実数倍でも image-rendering:pixelated なのでドットの縁はぼけない。
  // 起きるのは「ある列だけ1画面ドット広い」という不揃いだけで、
  // 画面の8割を捨てるより明らかに軽い副作用
  resize();
}

//──────────────────────────────────────────────────────────────────
//  階調圧縮＋ディザ
//──────────────────────────────────────────────────────────────────
// 32768 通り（RGB各5bit）の色調補正を先に焼いておき、毎フレームは
// 引くだけにする。ディザはピクセル位置で決まるので、補正の後に足す。
const PX_GRADE = new Uint8Array(32768 * 3);
function pxBuildGrade() {
  const lift = (v) => v / 255;
  for (let i = 0; i < 32768; i++) {
    let r = ((i >> 10) & 31) * 255 / 31, g = ((i >> 5) & 31) * 255 / 31, b = (i & 31) * 255 / 31;
    if (PX.grade) {
      // 明度。これを軸に「暗いところは青紫へ、明るいところは黄橙へ」倒す。
      // ドラゴンズクラウンの厚塗りは、影に環境光の寒色が必ず混じっている
      const l = lift(r * 0.299 + g * 0.587 + b * 0.114);
      const sh = (1 - l) * (1 - l);         // 影ほど強く
      const hi = l * l;                     // 光ほど強く
      r += -10 * sh + 16 * hi;
      g += -4 * sh + 8 * hi;
      b += 14 * sh - 6 * hi;
      // S字トーンカーブ：中間を締めて、明暗の差を作る
      const cur = (v) => { const t = v / 255; return 255 * (t * t * (3 - 2 * t) * 0.42 + t * 0.58); };
      r = cur(r); g = cur(g); b = cur(b);
      // 彩度を少し持ち上げる（階調を落とすと色が痩せて見えるため）
      const y = r * 0.299 + g * 0.587 + b * 0.114;
      r = y + (r - y) * 1.16; g = y + (g - y) * 1.16; b = y + (b - y) * 1.16;
    }
    const o = i * 3;
    PX_GRADE[o] = r < 0 ? 0 : r > 255 ? 255 : r;
    PX_GRADE[o + 1] = g < 0 ? 0 : g > 255 ? 255 : g;
    PX_GRADE[o + 2] = b < 0 ? 0 : b > 255 ? 255 : b;
  }
}
pxBuildGrade();

// 4×4 の秩序ディザ（Bayer）。-0.5〜0.5 に正規化して持つ
const PX_BAYER = (() => {
  const m = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  return Float32Array.from(m, (v) => v / 16 - 0.46875);
})();

// 階調数から作る量子化表。round(v/step)*step を 256 通り先に焼く
let PX_QUANT = null, _pxQuantLv = -1;
function pxBuildQuant() {
  const n = Math.max(2, PX.levels | 0), step = 255 / (n - 1);
  PX_QUANT = new Uint8Array(512);                    // ディザで ±step/2 はみ出すので余白を取る
  for (let v = -128; v < 384; v++) {
    const q = Math.round(Math.min(255, Math.max(0, v)) / step) * step;
    PX_QUANT[v + 128] = q < 0 ? 0 : q > 255 ? 255 : q;
  }
  _pxQuantLv = n;
}

// 平らな面はディザを抜く。
// ドット絵の作法は「広い面はベタ、丸みのある面だけディザ」。全面に一律で
// Bayer を掛けると、拡大したときに新聞の網点にしか見えない（実際そうなった）。
// 左と上の**両方**が元色と同じなら平ら、と判定する：
//   ・べた塗りの壁 → 左も上も同じ → ディザを切る
//   ・縦のグラデ   → 左は同じだが上が違う → ディザは残る
//   ・横のグラデ   → 上は同じだが左が違う → ディザは残る
// 「左が同じなら平ら」だけにすると、空の縦グラデが段だけになって縞が出る。
let _pxTopRow = null;
function pxPostProcess() {
  if (PX.levels >= 32 && !PX.grade) return;          // 実質無加工なら触らない
  if (_pxQuantLv !== (PX.levels | 0)) pxBuildQuant();
  const W2 = PX.W, H2 = PX.H;
  const img = pxCtx.getImageData(0, 0, W2, H2), d = img.data;
  const step = 255 / (Math.max(2, PX.levels | 0) - 1);
  const amp = step * PX.dither;
  const G = PX_GRADE, Q = PX_QUANT, B = PX_BAYER;
  if (!_pxTopRow || _pxTopRow.length !== W2 * 3) _pxTopRow = new Uint8Array(W2 * 3);
  const T = _pxTopRow;
  T.fill(255);                                       // 1行目に上の行は無い＝平らとは見なさない
  let i = 0;
  for (let y = 0; y < H2; y++) {
    const brow = (y & 3) << 2;
    let pr = -1, pg = -1, pb = -1;                   // 左隣の「加工前」の色
    for (let x = 0; x < W2; x++, i += 4) {
      const r = d[i], g = d[i + 1], b = d[i + 2], t = x * 3;
      const flat = (r === pr && g === pg && b === pb) &&
                   (r === T[t] && g === T[t + 1] && b === T[t + 2]);
      pr = r; pg = g; pb = b;
      T[t] = r; T[t + 1] = g; T[t + 2] = b;
      const idx = (((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3)) * 3;
      const dz = flat ? 0 : B[brow | (x & 3)] * amp;
      d[i]     = Q[(G[idx]     + dz + 128.5) | 0];
      d[i + 1] = Q[(G[idx + 1] + dz + 128.5) | 0];
      d[i + 2] = Q[(G[idx + 2] + dz + 128.5) | 0];
    }
  }
  pxCtx.putImageData(img, 0, 0);
}

//──────────────────────────────────────────────────────────────────
//  フレームの組み立て
//──────────────────────────────────────────────────────────────────
let pxPresented = false;

function pxBeginFrame() {
  pxPresented = false;
  ctx = pxCtx;
  pxResetWorld();
  pxCtx.globalAlpha = 1; pxCtx.globalCompositeOperation = 'source-over';
  pxCtx.fillStyle = '#000'; pxCtx.fillRect(0, 0, PX.W, PX.H);
  pxResetDisp();
  pxDisp.globalAlpha = 1; pxDisp.globalCompositeOperation = 'source-over';
  pxDisp.clearRect(0, 0, W, H);
}

// 世界バッファを階調圧縮して表示キャンバスへ整数倍で焼く。
// これ以降 ctx は表示キャンバスを指すので、HUD は等倍で描かれる
function pxPresent() {
  if (pxPresented) return;
  pxPresented = true;
  pxPostProcess();
  pxDisp.save();
  pxDisp.setTransform(1, 0, 0, 1, 0, 0);
  pxDisp.imageSmoothingEnabled = false;
  pxDisp.globalAlpha = 1; pxDisp.globalCompositeOperation = 'source-over';
  pxDisp.drawImage(pxBuf, 0, 0, cv.width, cv.height);
  pxDisp.restore();
  ctx = pxDisp;
  pxResetDisp();
}

// 「いったんドットで描いてから、透過のまま拡大して重ねる」ための足場。
// カットインのように本編より上へ出す絵を、等倍のベクタ絵にしないために使う
function pxOverlayPass(fn) {
  const keep = ctx;
  pxOvlCtx.setTransform(1, 0, 0, 1, 0, 0);
  pxOvlCtx.clearRect(0, 0, PX.W, PX.H);
  pxOvlCtx.setTransform(1 / PX_SC, 0, 0, 1 / PX_SC, 0, 0);
  pxOvlCtx.globalAlpha = 1; pxOvlCtx.globalCompositeOperation = 'source-over';
  ctx = pxOvlCtx;
  try { fn(); } finally { ctx = keep; }
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(pxOvl, 0, 0, ctx === pxDisp ? cv.width : PX.W, ctx === pxDisp ? cv.height : PX.H);
  ctx.restore();
}

if (PX_REAL) {
  // 「絵はドット・文字は等倍」を1つの描画関数の中で両立させる。
// fn の描画を全部ドットバッファへ流しつつ、fillText / strokeText だけは
// 描かずに控えておき、転送したあとで表示キャンバスへ描き直す。
// 480×270 では日本語が 6px になって読めないが、絵まで等倍にすると
// 立ち絵だけベクタで残って画面から浮く。その両取りのための仕組み。
const PX_TEXT_STATE = ['font', 'fillStyle', 'strokeStyle', 'lineWidth', 'globalAlpha',
  'textAlign', 'textBaseline', 'lineJoin', 'miterLimit', 'globalCompositeOperation',
  'shadowColor', 'shadowBlur', 'shadowOffsetX', 'shadowOffsetY'];
function pxWorldSharpText(fn) {
  if (!PX.on) { fn(); return; }
  const real = pxCtx, queue = [];
  // ctx を Proxy で包むのは駄目。canvas の組み込みメソッドは受け手（this）が
  // Proxy だと "Illegal invocation" で落ちる。実際、UI層が
  // `raw.call(ctx, …)` の形で組み込みを呼んでいて、地図が毎フレーム例外を投げた。
  // 代わりに本物のコンテキストへ**自前のプロパティを被せて**プロトタイプの
  // メソッドを隠し、終わったら消す。this は常に本物のままになる
  const rec = (k) => function () {
    const s = {}; for (const p of PX_TEXT_STATE) s[p] = real[p];
    queue.push({ k, a: Array.prototype.slice.call(arguments), M: real.getTransform(), s });
  };
  const had = Object.prototype.hasOwnProperty.call(real, 'fillText');
  const prevF = real.fillText, prevS = real.strokeText;
  real.fillText = rec('fillText');
  real.strokeText = rec('strokeText');
  const keep = ctx; ctx = real;
  try { fn(); }
  finally {
    ctx = keep;
    if (had) { real.fillText = prevF; real.strokeText = prevS; }
    else { delete real.fillText; delete real.strokeText; }
  }
  pxPresent();                                   // ここで ctx は表示キャンバスへ移る
  // バッファ座標 → 表示座標は整数倍（cv.width/PX.W）。控えた変換をその倍率で
  // 掛け直せば、文字は元の論理位置・元の大きさのまま等倍で出る
  const k = cv.width / PX.W;
  for (const q of queue) {
    pxDisp.save();
    pxDisp.setTransform(q.M.a * k, q.M.b * k, q.M.c * k, q.M.d * k, q.M.e * k, q.M.f * k);
    for (const p of PX_TEXT_STATE) { try { pxDisp[p] = q.s[p]; } catch (e) {} }
    try { pxDisp[q.k].apply(pxDisp, q.a); } catch (e) {}
    pxDisp.restore();
  }
  pxResetDisp();
}

// HUD は等倍側で描く。480×270 に落とすと日本語が読めなくなるため、
  // 「世界＝ドット絵／文字＝等倍」の二層構成にしている。
  // UI の図形側（枠・ゲージ・アイコン）は px/50_ui.js が2ドット格子へ揃える
  const pxRawHUD = drawHUD;
  drawHUD = function () { pxPresent(); pxRawHUD(); };

  // 奥義カットインは HUD より上だが、ベクタのまま出すと画面で浮くので
  // いったんドットバッファへ描いてから拡大して重ねる
  // 立ち絵はドット、技名とキャラ名は等倍で描き直す。
  // 全部を 480×270 へ落としていたので「聖犬士イッヌ」の漢字が潰れて
  // 読めなくなっていた（監査で指摘）
  const pxRawUltCut = drawUltCut;
  drawUltCut = function () { if (ultCut.t <= 0) return; pxWorldSharpText(pxRawUltCut); };

  // 文字が主役の画面（店・地図・キャラ選択・会話）は等倍側で描く。
  // ここをドットへ落とすと 6px の漢字になって一切読めない
  // これらも「絵はドット・文字は等倍」で描く。
  // 以前は pxPresent() してから等倍で丸ごと描いていたので、世界バッファを
  // 一切通らず、猫のなめらかグラデ・角丸カード・放射ぼかしのランプが
  // 前の版のまま残っていた（監査で「3画面まるごと未対応」と指摘）
  for (const nm of ['drawShop', 'drawMap', 'drawCharSel']) {
    const raw = window[nm];
    if (typeof raw === 'function') window[nm] = function () { pxWorldSharpText(raw); };
  }

  // 会話・カットシーンは「立ち絵＋長い本文」なので、全部を等倍で描くと
  // 立ち絵だけベクタのまま残って画面から浮く（実際にボス登場の会話で浮いた）。
  // 絵はドットバッファへ落とし、文字だけを等倍で描き直す。
  const pxRawCut = drawCut;
  drawCut = function () { pxWorldSharpText(pxRawCut); };

  // 本編の loop は各分岐の末尾で requestAnimationFrame(loop) を呼んで抜ける。
  // その外側を包めば、どの分岐を通っても「フレーム頭で初期化・末尾で転送」が効く
  const pxRawLoopBody = loopBody;
  loop = function () {
    pxBeginFrame();
    try { pxRawLoopBody(); }
    catch (err) { console.error(err); if (attractOn) endAttract(); requestAnimationFrame(loop); }
    pxPresent();
  };

  // 内部解像度が4分の1になって描画負荷が大きく下がるので、
  // 本編が自動で落とす品質段階の初期値を最上位へ戻す（リムライトが効く）
  perfTier = 0;
}

// デバッグ用：コンソールから PX.levels などを触って見え方を確かめる
window.PX = PX;

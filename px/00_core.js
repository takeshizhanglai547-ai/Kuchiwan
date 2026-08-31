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
  dither: 0.9,             // ディザの強さ（0で無効）
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
setupCanvas = function () {
  cv.width = PX.W * PX.ZOOM; cv.height = PX.H * PX.ZOOM;
  pxResetDisp(); pxResetWorld();
};
setupCanvas(); resize();

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

function pxPostProcess() {
  if (PX.levels >= 32 && !PX.grade) return;          // 実質無加工なら触らない
  if (_pxQuantLv !== (PX.levels | 0)) pxBuildQuant();
  const W2 = PX.W, H2 = PX.H;
  const img = pxCtx.getImageData(0, 0, W2, H2), d = img.data;
  const step = 255 / (Math.max(2, PX.levels | 0) - 1);
  const amp = step * PX.dither;
  const G = PX_GRADE, Q = PX_QUANT, B = PX_BAYER;
  let i = 0;
  for (let y = 0; y < H2; y++) {
    const brow = (y & 3) << 2;
    for (let x = 0; x < W2; x++, i += 4) {
      const idx = (((d[i] >> 3) << 10) | ((d[i + 1] >> 3) << 5) | (d[i + 2] >> 3)) * 3;
      const dz = B[brow | (x & 3)] * amp;
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

// HUD は等倍側で描く。480×270 に落とすと日本語が読めなくなるため、
// 「世界＝ドット絵／文字＝等倍」の二層構成にしている。
// UI の図形側（枠・ゲージ・アイコン）は px/40_ui.js が2ドット格子へ揃える
const pxRawHUD = drawHUD;
drawHUD = function () { pxPresent(); pxRawHUD(); };

// 奥義カットインは HUD より上だが、ベクタのまま出すと画面で浮くので
// いったんドットバッファへ描いてから拡大して重ねる
const pxRawUltCut = drawUltCut;
drawUltCut = function () { if (ultCut.t <= 0) return; pxOverlayPass(pxRawUltCut); };

// 文字が主役の画面（店・地図・キャラ選択・会話）は等倍側で描く。
// ここをドットへ落とすと 6px の漢字になって一切読めない
for (const nm of ['drawShop', 'drawMap', 'drawCharSel', 'drawCut']) {
  const raw = window[nm];
  if (typeof raw === 'function') window[nm] = function () { pxPresent(); return raw.apply(this, arguments); };
}

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

// デバッグ用：コンソールから PX.levels などを触って見え方を確かめる
window.PX = PX;

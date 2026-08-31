// ══════════════════════════════════════════════════════════════════
//  ドット絵を描くための道具箱
// ══════════════════════════════════════════════════════════════════
// 本編の描画はベクタ（なめらかなグラデ・任意の小数座標）で書かれている。
// そのまま低解像度へ落とすと「縮小した絵」にしかならないので、
// ドット絵に必要な三つを、ここの道具で本編の描画へ足していく：
//
//   1. ドット格子に乗せる      … 小数座標のにじみを消す（pxSnap / pxSprite）
//   2. 段で塗る                … なめらかなグラデを帯に割る（pxRamp / pxBandGrad）
//   3. 輪郭を締める            … シルエットに濃い線を回す（pxOutlined）
//
// 座標系の約束：本編の論理座標（960×540）で呼ぶ。バッファ1ドットは論理2単位。

const PXU = PX_SC;                       // 論理座標での1ドットの大きさ（=2）

// ── ドット格子へ丸める ───────────────────────────────────────────
const pxSnap = v => Math.round(v / PXU) * PXU;
const pxFloor = v => Math.floor(v / PXU) * PXU;
// 現在の変換込みで、バッファ上の整数ドットに乗る位置へ寄せる。
// 平行移動だけの変換（回転・拡縮なし）のときだけ効く
function pxSnapHere(x, y) {
  const M = ctx.getTransform();
  if (M.b || M.c) return { x, y };
  const dx = M.a * x + M.e, dy = M.d * y + M.f;
  return { x: (Math.round(dx) - M.e) / M.a, y: (Math.round(dy) - M.f) / M.d };
}

// ── 色 ───────────────────────────────────────────────────────────
function pxRGB(c) {
  if (c[0] === '#') { const n = c.length === 4 ? c[1] + c[1] + c[2] + c[2] + c[3] + c[3] : c.slice(1);
    return [parseInt(n.substr(0, 2), 16), parseInt(n.substr(2, 2), 16), parseInt(n.substr(4, 2), 16)]; }
  const m = c.match(/-?[\d.]+/g); return [+m[0] | 0, +m[1] | 0, +m[2] | 0];
}
const pxHex = (r, g, b) => 'rgb(' + (r < 0 ? 0 : r > 255 ? 255 : r | 0) + ',' + (g < 0 ? 0 : g > 255 ? 255 : g | 0) + ',' + (b < 0 ? 0 : b > 255 ? 255 : b | 0) + ')';
function pxMix(a, b, t) { const A = pxRGB(a), B = pxRGB(b); return pxHex(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t); }

// 陰影ランプ。ドット絵の陰は「暗くする」だけでは死ぬので、
// 影側は青紫へ・光側は黄橙へ倒しながら明度を動かす（色相をずらすと立体に見える）
const PX_SHADOW = [40, 34, 78], PX_LIGHT = [255, 226, 168];
function pxRamp(base, steps) {
  const [r, g, b] = pxRGB(base), out = [], n = steps || 5;
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0.5 : i / (n - 1);         // 0=最も暗い 1=最も明るい
    const k = (t - 0.5) * 2;                       // -1..1
    const c = k < 0
      ? [r + (PX_SHADOW[0] - r) * (-k * 0.62), g + (PX_SHADOW[1] - g) * (-k * 0.62), b + (PX_SHADOW[2] - b) * (-k * 0.50)]
      : [r + (PX_LIGHT[0] - r) * (k * 0.52), g + (PX_LIGHT[1] - g) * (k * 0.46), b + (PX_LIGHT[2] - b) * (k * 0.34)];
    out.push(pxHex(c[0], c[1], c[2]));
  }
  return out;
}

// ── 段で塗るグラデーション ───────────────────────────────────────
// createLinearGradient の代わり。帯に割って塗るので、階調圧縮に頼らず
// 「意図した段数」で色が変わる。境目は1ドット幅のディザで馴染ませる
function pxBandGrad(x, y, w, h, cols, vertical, dither) {
  const n = cols.length, S = ctx;
  const len = vertical ? h : w;
  const seg = len / n;
  for (let i = 0; i < n; i++) {
    S.fillStyle = cols[i];
    const a = pxFloor((vertical ? y : x) + seg * i), b = pxFloor((vertical ? y : x) + seg * (i + 1));
    if (vertical) S.fillRect(pxFloor(x), a, pxSnap(w), b - a);
    else S.fillRect(a, pxFloor(y), b - a, pxSnap(h));
  }
  if (dither === false) return;
  // 段の境目に、次の色を市松で1〜2ドットぶん食い込ませる
  for (let i = 1; i < n; i++) {
    const p = pxFloor((vertical ? y : x) + seg * i);
    pxCheckerBand(x, y, w, h, p, cols[i - 1], vertical);
  }
}
function pxCheckerBand(x, y, w, h, p, col, vertical) {
  ctx.fillStyle = col;
  const x0 = pxFloor(x), y0 = pxFloor(y), x1 = x0 + pxSnap(w), y1 = y0 + pxSnap(h);
  if (vertical) { for (let cx = x0; cx < x1; cx += PXU) if (((cx / PXU) & 1) === 0) ctx.fillRect(cx, p, PXU, PXU); }
  else { for (let cy = y0; cy < y1; cy += PXU) if (((cy / PXU) & 1) === 0) ctx.fillRect(p, cy, PXU, PXU); }
}

// 市松ディザで2色を混ぜたベタ塗り。空・霧・水など広い面をドットで作るとき用
// ratio 0=colA だけ, 1=colB だけ。4×4 の Bayer 閾値で density を作る
const PX_BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
function pxDitherRect(x, y, w, h, colA, colB, ratio) {
  const x0 = pxFloor(x), y0 = pxFloor(y), x1 = pxFloor(x + w), y1 = pxFloor(y + h);
  ctx.fillStyle = colA; ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
  if (ratio <= 0) return;
  ctx.fillStyle = colB;
  if (ratio >= 1) { ctx.fillRect(x0, y0, x1 - x0, y1 - y0); return; }
  const th = ratio * 16;
  for (let cy = y0, iy = 0; cy < y1; cy += PXU, iy++)
    for (let cx = x0, ix = 0; cx < x1; cx += PXU, ix++)
      if (PX_BAYER4[((iy & 3) << 2) | (ix & 3)] < th) ctx.fillRect(cx, cy, PXU, PXU);
}

// ── 輪郭線 ───────────────────────────────────────────────────────
// fn が描いた絵のシルエットから縁を1ドット取り出して、濃い線として回す。
// ドット絵が「板」ではなく「駒」に見えるのは、ほぼこの線のおかげ。
//
// 使い方は rimBegin/rimEnd と同じ発想で、描画の中身を関数で渡す：
//   pxOutlined(120, 160, () => { ...体を描く... }, '#241428');
// hw/hh は「今の原点から左右 hw・上へ hh」に収まる、という当たり枠（論理座標）。
const PXO_S = 384, PXO_OX = 192, PXO_OY = 300;   // 下書き用オフスクリーン（バッファのドット単位）
let _pxoA = null, _pxoB = null, _pxoAc = null, _pxoBc = null;
function _pxoInit() {
  if (_pxoA) return;
  _pxoA = document.createElement('canvas'); _pxoA.width = _pxoA.height = PXO_S; _pxoAc = _pxoA.getContext('2d');
  _pxoB = document.createElement('canvas'); _pxoB.width = _pxoB.height = PXO_S; _pxoBc = _pxoB.getContext('2d');
}
let pxOutlineDepth = 0;
function pxOutlined(hw, hh, fn, col, opt) {
  // 入れ子で呼ばれたら（親がすでに下書きへ描いている）素通しにする。
  // 二重に線が乗ると、内側の線が汚れとして残る
  if (pxOutlineDepth > 0 || !PX.on) { fn(); return; }
  _pxoInit();
  const M = ctx.getTransform();
  if (M.b || M.c) { fn(); return; }                      // 回転が入っているときは諦めて素通し
  const kx = Math.abs(M.a), ky = Math.abs(M.d);
  const w = Math.ceil(hw * 2 * kx) + 8, h = Math.ceil(hh * ky) + 8 + Math.ceil((opt && opt.below || 24) * ky);
  if (w > PXO_S || h > PXO_S) { fn(); return; }          // 枠に入らないものは素通し（切れるより良い）
  const bx = Math.max(0, PXO_OX - (w >> 1)), by = Math.max(0, PXO_OY - h + Math.ceil((opt && opt.below || 24) * ky));
  _pxoAc.setTransform(1, 0, 0, 1, 0, 0); _pxoAc.clearRect(bx, by, w, h);
  _pxoAc.setTransform(M.a, 0, 0, M.d, PXO_OX, PXO_OY);

  const keep = ctx; ctx = _pxoAc; pxOutlineDepth++;
  try { fn(); } finally { ctx = keep; pxOutlineDepth--; }

  // ずらして削る＝縁が残る。上下左右の4方向ぶんを重ねて1ドットの閉じた線にする
  const O = (opt && opt.width) || 1;
  _pxoBc.setTransform(1, 0, 0, 1, 0, 0);
  _pxoBc.globalCompositeOperation = 'source-over'; _pxoBc.globalAlpha = 1;
  _pxoBc.clearRect(bx - O, by - O, w + O * 2, h + O * 2);
  for (const [dx, dy] of [[-O, 0], [O, 0], [0, -O], [0, O]])
    _pxoBc.drawImage(_pxoA, bx, by, w, h, bx + dx, by + dy, w, h);
  _pxoBc.globalCompositeOperation = 'destination-out';
  _pxoBc.drawImage(_pxoA, bx, by, w, h, bx, by, w, h);   // 中身をくり抜く
  _pxoBc.globalCompositeOperation = 'source-in';
  _pxoBc.fillStyle = col || '#20142c';
  _pxoBc.fillRect(bx - O, by - O, w + O * 2, h + O * 2);
  _pxoBc.globalCompositeOperation = 'source-over';

  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.imageSmoothingEnabled = false;
  const ox = M.e - PXO_OX, oy = M.f - PXO_OY;
  ctx.globalAlpha = (opt && opt.alpha) != null ? opt.alpha : 1;
  ctx.drawImage(_pxoB, bx - O, by - O, w + O * 2, h + O * 2, ox + bx - O, oy + by - O, w + O * 2, h + O * 2);
  ctx.globalAlpha = 1;
  ctx.drawImage(_pxoA, bx, by, w, h, ox + bx, oy + by, w, h);
  ctx.restore();
}

// ── 文字絵スプライト ─────────────────────────────────────────────
// ドットを文字で書いて、そのままキャンバスへ焼く。
//   const S = pxSprite(['.11.', '1221'], { '1':'#000', '2':'#fff' });
// '.' と ' ' は透明。焼いた結果は使い回されるので、毎フレーム呼んでよい。
const _pxSprCache = new Map();
function pxSprite(rows, pal, key) {
  const k = key || (rows.length + ':' + rows[0] + ':' + rows.join('').length + ':' + JSON.stringify(pal));
  const hit = _pxSprCache.get(k); if (hit) return hit;
  const h = rows.length, w = Math.max(...rows.map(r => r.length));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  const img = g.createImageData(w, h), d = img.data;
  for (let y = 0; y < h; y++) {
    const row = rows[y];
    for (let x = 0; x < row.length; x++) {
      const ch = row[x]; if (ch === '.' || ch === ' ') continue;
      const col = pal[ch]; if (!col) continue;
      const [r, gg, b] = pxRGB(col);
      const o = (y * w + x) * 4; d[o] = r; d[o + 1] = gg; d[o + 2] = b; d[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const spr = { cv: c, w, h };
  _pxSprCache.set(k, spr);
  return spr;
}
// スプライトを論理座標へ置く。1スプライトドット＝バッファ1ドット（論理2単位）で、
// 必ずドット格子に乗る。ox/oy はスプライト内の基準点（既定は中心下）
function pxDrawSprite(spr, x, y, opt) {
  const o = opt || {}, s = (o.scale || 1);
  const ox = o.ox == null ? spr.w / 2 : o.ox, oy = o.oy == null ? spr.h : o.oy;
  const p = pxSnapHere(x, y);
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  if (o.alpha != null) ctx.globalAlpha *= o.alpha;
  if (o.blend) ctx.globalCompositeOperation = o.blend;
  ctx.translate(p.x, p.y);
  if (o.rot) ctx.rotate(o.rot);
  if (o.flip) ctx.scale(-1, 1);
  ctx.drawImage(spr.cv, -ox * PXU * s, -oy * PXU * s, spr.w * PXU * s, spr.h * PXU * s);
  ctx.restore();
}

// ── ドット絵の丸・線 ─────────────────────────────────────────────
// 中点円で1ドット刻みの円を塗る。arc() の円は低解像度だと縁が灰色に溶ける
function pxCircle(cx, cy, r, col, fill) {
  const p = pxSnapHere(cx, cy), R = Math.max(1, Math.round(r / PXU));
  ctx.fillStyle = col;
  for (let dy = -R; dy <= R; dy++) {
    const dx = Math.floor(Math.sqrt(R * R - dy * dy) + 0.5);
    if (fill === false) { ctx.fillRect(p.x + dx * PXU, p.y + dy * PXU, PXU, PXU); ctx.fillRect(p.x - dx * PXU, p.y + dy * PXU, PXU, PXU); }
    else ctx.fillRect(p.x - dx * PXU, p.y + dy * PXU, (dx * 2 + 1) * PXU, PXU);
  }
}
// 太さがドット単位に揃う線。lineWidth の小数は低解像度で薄墨になる
function pxLine(x0, y0, x1, y1, col, wdt) {
  ctx.save(); ctx.lineCap = 'butt'; ctx.strokeStyle = col;
  ctx.lineWidth = Math.max(1, Math.round((wdt || PXU) / PXU)) * PXU;
  const a = pxSnapHere(x0, y0), b = pxSnapHere(x1, y1);
  ctx.beginPath(); ctx.moveTo(a.x + PXU / 2, a.y + PXU / 2); ctx.lineTo(b.x + PXU / 2, b.y + PXU / 2); ctx.stroke();
  ctx.restore();
}

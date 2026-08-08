/* =============================================================================
   ASHLINE / tex.js — 手続き生成テクスチャ一式（Canvas 2D のみ）

   設計の方針（なぜこう作るか）
   ---------------------------------------------------------------------------
   1) 「汚す」のではなく「現象を描く」。ノイズは素材の粒であって汚れではない。
      汚れは必ず「どこから来て、どこへ行ったか」を持つ ＝ 縁から下へ垂れる、
      上向きの面に溜まる、鉄から下へ滲む、角から欠ける。方向を持たない汚れは描かない。

   2) 逆光で暗部に沈んだとき面の向きが読めること＝この一式の最重要要件。
      そのために (a) 縦の筋（＝垂直面である証拠）と (b) 水平の段差ごとの
      「上に明るい灰の唇 / 下に暗い影」の対を、すべての壁系テクスチャに仕込む。
      明度は広く（暗部を palette の *Dark 側まで落とす）、彩度は狭く取る。

   3) 太陽は低い西日で、光は常に「上から手前へ」来る。よって彫りの表現は
      すべて「上の縁が明るく、下の縁が暗い」で統一する。混ぜると立体が壊れる。

   4) 速度。fBm はピクセル毎にハッシュを叩かず、格子を作って補間で
      持ち上げる（addOctave）。512^2 × 5 オクターブでも数百万回の積和で済む。

   解像度：512 が 11 枚、256 が 3 枚。合計 3,080,192 px（契約の 6M 以下）。
   色は ASH.palette からのみ。派生は ASH.shade(T, hex, mul) 経由。
   ========================================================================== */
(function (g) {
  var ASH = g.ASH = g.ASH || {};

  ASH.tex = function (T) {
    var P = ASH.palette;

    /* =======================================================================
       0. 乱数（決定論的 LCG）
       毎回同じ絵が出ないと「見て直す」ができない。Math.random は使わない。
       ==================================================================== */
    var _s = 1;
    function seed(n) { _s = n >>> 0; }
    function rnd() { _s = (Math.imul(_s, 1664525) + 1013904223) >>> 0; return _s / 4294967296; }
    function rr(a, b) { return a + (b - a) * rnd(); }
    function ri(a, b) { return a + Math.floor((b - a + 1) * rnd()); }

    /* 格子ハッシュ。整数座標 -> [0,1)。imul で 32bit に収めて分布を安定させる。 */
    function h2(i, j, s) {
      var n = Math.imul(i | 0, 374761393) ^ Math.imul(j | 0, 668265263) ^ Math.imul(s | 0, 1442695040);
      n = Math.imul(n ^ (n >>> 13), 1274126177);
      n = n ^ (n >>> 16);
      return (n >>> 0) / 4294967296;
    }

    /* =======================================================================
       1. 色ヘルパ
       生の16進は書かない。palette 値の整数から CSS 文字列を組み立てるだけ。
       ==================================================================== */
    function sh(hex, m) { return ASH.shade(T, hex, m).getHex(); }          // 明度派生（リニア空間で乗算）
    function mix(a, b, t) { var c = ASH.col(T, a); c.lerp(ASH.col(T, b), t); return c.getHex(); }
    function R8(h) { return (h >> 16) & 255; }
    function G8(h) { return (h >> 8) & 255; }
    function B8(h) { return h & 255; }
    function C(h) { return 'rgb(' + R8(h) + ',' + G8(h) + ',' + B8(h) + ')'; }
    function CA(h, a) { return 'rgba(' + R8(h) + ',' + G8(h) + ',' + B8(h) + ',' + a + ')'; }
    /* 高さマップ用のグレイ。これは「色」ではなく高さの数値なので palette の対象外。 */
    function GY(v) { v = v < 0 ? 0 : (v > 255 ? 255 : Math.round(v)); return 'rgb(' + v + ',' + v + ',' + v + ')'; }
    function GYA(v, a) { v = v < 0 ? 0 : (v > 255 ? 255 : Math.round(v)); return 'rgba(' + v + ',' + v + ',' + v + ',' + a + ')'; }

    function toRGB(hex, o) { o[0] = R8(hex); o[1] = G8(hex); o[2] = B8(hex); return o; }
    function lerp3(a, b, t, o) {
      if (t < 0) t = 0; else if (t > 1) t = 1;
      o[0] = a[0] + (b[0] - a[0]) * t;
      o[1] = a[1] + (b[1] - a[1]) * t;
      o[2] = a[2] + (b[2] - a[2]) * t;
      return o;
    }
    function sat(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }
    function smoothstep(e0, e1, v) { var t = sat((v - e0) / (e1 - e0)); return t * t * (3 - 2 * t); }

    /* =======================================================================
       2. ノイズ場（タイル可能な value-fBm）
       格子を先に作り、smoothstep 補間で全画素へ持ち上げる。格子は周期 f で
       巻き戻すので RepeatWrapping で継ぎ目が出ない。
       ==================================================================== */
    function addOctave(out, S, fw, fh, amp, sd) {
      var lat = new Float32Array(fw * fh), i, j;
      for (j = 0; j < fh; j++) for (i = 0; i < fw; i++) lat[j * fw + i] = h2(i, j, sd);
      var sx = fw / S, sy = fh / S, px, py;
      for (py = 0; py < S; py++) {
        var fy = py * sy, iy = Math.floor(fy), ty = fy - iy;
        ty = ty * ty * (3 - 2 * ty);
        var r0 = (iy % fh) * fw, r1 = ((iy + 1) % fh) * fw, base = py * S;
        for (px = 0; px < S; px++) {
          var fx = px * sx, ix = Math.floor(fx), tx = fx - ix;
          tx = tx * tx * (3 - 2 * tx);
          var x0 = ix % fw, x1 = (ix + 1) % fw;
          var t0 = lat[r0 + x0] + (lat[r0 + x1] - lat[r0 + x0]) * tx;
          var t1 = lat[r1 + x0] + (lat[r1 + x1] - lat[r1 + x0]) * tx;
          out[base + px] += (t0 + (t1 - t0) * ty) * amp;
        }
      }
    }
    /* fw:fh を変えると異方性ノイズになる。雨だれ・錆の流れはこれで作る。 */
    function fbm2(S, fw, fh, oct, sd) {
      var out = new Float32Array(S * S), amp = 1, tot = 0, k, a = fw, b = fh;
      for (k = 0; k < oct; k++) {
        if (a > S) a = S; if (b > S) b = S;
        addOctave(out, S, a, b, amp, sd + k * 1013);
        tot += amp; amp *= 0.5; a *= 2; b *= 2;
      }
      for (k = 0; k < out.length; k++) out[k] /= tot;
      return out;
    }
    function fbm(S, f, oct, sd) { return fbm2(S, f, f, oct, sd); }

    function samp(fld, S, x, y) {                 // 巻き戻し付きバイリニア取り出し
      x = x % S; if (x < 0) x += S;
      y = y % S; if (y < 0) y += S;
      var ix = Math.floor(x), iy = Math.floor(y), tx = x - ix, ty = y - iy;
      var x1 = (ix + 1) % S, y1 = (iy + 1) % S, r0 = iy * S, r1 = y1 * S;
      var t0 = fld[r0 + ix] + (fld[r0 + x1] - fld[r0 + ix]) * tx;
      var t1 = fld[r1 + ix] + (fld[r1 + x1] - fld[r1 + ix]) * tx;
      return t0 + (t1 - t0) * ty;
    }
    /* 定義域を歪める。剥離の縁を「ちぎれた」形にするのに必須。円形の穴は嘘に見える。 */
    function warp(S, src, wx, wy, amt) {
      var out = new Float32Array(S * S), px, py, i = 0;
      for (py = 0; py < S; py++) for (px = 0; px < S; px++, i++)
        out[i] = samp(src, S, px + (wx[i] - 0.5) * amt, py + (wy[i] - 0.5) * amt);
      return out;
    }
    function ctr(f, k, mid) {                     // コントラスト。明度差を広げる用
      var o = new Float32Array(f.length), i;
      for (i = 0; i < f.length; i++) o[i] = sat((f[i] - mid) * k + mid);
      return o;
    }

    /* =======================================================================
       3. キャンバス
       ==================================================================== */
    function mk(S) {
      var cv = document.createElement('canvas');
      cv.width = S; cv.height = S;
      return { cv: cv, x: cv.getContext('2d'), S: S };
    }
    function fill(o, fn) {                        // 不透明の基層を画素単位で塗る
      var S = o.S, id = o.x.createImageData(S, S), d = id.data, out = [0, 0, 0], i = 0, px, py;
      for (py = 0; py < S; py++) for (px = 0; px < S; px++) {
        fn(px, py, px / S, py / S, out);
        d[i] = out[0]; d[i + 1] = out[1]; d[i + 2] = out[2]; d[i + 3] = 255; i += 4;
      }
      o.x.putImageData(id, 0, 0);
    }
    function fillA(o, fn) {                       // デカール用（アルファあり）
      var S = o.S, id = o.x.createImageData(S, S), d = id.data, out = [0, 0, 0, 0], i = 0, px, py;
      for (py = 0; py < S; py++) for (px = 0; px < S; px++) {
        out[3] = 0; fn(px, py, px / S, py / S, out);
        d[i] = out[0]; d[i + 1] = out[1]; d[i + 2] = out[2]; d[i + 3] = out[3]; i += 4;
      }
      o.x.putImageData(id, 0, 0);
    }
    /* グレイのノイズ板。multiply / screen 合成で全体に一枚被せるのに使う。 */
    function greyCanvas(S, fld, lo, hi) {
      var cv = document.createElement('canvas'); cv.width = S; cv.height = S;
      var cx = cv.getContext('2d'), id = cx.createImageData(S, S), d = id.data, i, j = 0, v;
      for (i = 0; i < fld.length; i++) {
        v = (lo + (hi - lo) * fld[i]) * 255;
        v = v < 0 ? 0 : (v > 255 ? 255 : v);
        d[j] = d[j + 1] = d[j + 2] = v; d[j + 3] = 255; j += 4;
      }
      cx.putImageData(id, 0, 0);
      return cv;
    }
    function blend(o, cv, mode, alpha) {
      o.x.save();
      o.x.globalCompositeOperation = mode;
      o.x.globalAlpha = alpha;
      o.x.drawImage(cv, 0, 0, o.S, o.S);
      o.x.restore();
    }
    /* タイル境界をまたぐ描画。小さな図形はこれで9回描いて継ぎ目を消す。 */
    function tiled(o, fn) {
      var d = [-1, 0, 1], i, j, S = o.S;
      for (i = 0; i < 3; i++) for (j = 0; j < 3; j++) {
        o.x.save(); o.x.translate(d[i] * S, d[j] * S); fn(); o.x.restore();
      }
    }
    function fin(o, srgb) {
      var t = new T.CanvasTexture(o.cv);
      t.colorSpace = srgb ? T.SRGBColorSpace : T.NoColorSpace;
      t.wrapS = t.wrapT = T.RepeatWrapping;
      t.anisotropy = 4;
      t.needsUpdate = true;
      return t;
    }

    /* =======================================================================
       4. 現象を描くプリミティブ
       ==================================================================== */

    /* --- 雨だれ ------------------------------------------------------------
       水平な縁（型枠の段差・目地・笠木）から下へ垂れた跡。
       ・幅の違う3本の重ね：外側は薄く広く、芯は濃く細い（水は中央を伝う）
       ・上端が濃く下端で消える縦グラデーション（下へ行くほど薄まる）
       ・輪郭を蛇行させる。直線の帯は「ノイズ」に見え、蛇行すると「流れ」に見える
       ------------------------------------------------------------------- */
    function ribbon(x, pts, mw) {
      var k;
      x.beginPath();
      x.moveTo(pts[0][0] - pts[0][2] * mw, pts[0][1]);
      for (k = 1; k < pts.length; k++) x.lineTo(pts[k][0] - pts[k][2] * mw, pts[k][1]);
      for (k = pts.length - 1; k >= 0; k--) x.lineTo(pts[k][0] + pts[k][2] * mw, pts[k][1]);
      x.closePath(); x.fill();
    }
    function drip(o, cx0, y0, len, w, hex, alpha, wob) {
      var x = o.x, N = 16, k, pts = [], sway = 0, dsw = 0, hw;
      for (k = 0; k <= N; k++) {
        dsw += rr(-1, 1) * wob;
        if (dsw > 1.4) dsw = 1.4; if (dsw < -1.4) dsw = -1.4;
        sway += dsw;
        hw = w * 0.5 * (1 - 0.5 * (k / N)) * (0.7 + 0.6 * rnd());
        pts.push([cx0 + sway, y0 + len * (k / N), hw]);
      }
      var gr = x.createLinearGradient(0, y0, 0, y0 + len);
      gr.addColorStop(0, CA(hex, alpha));
      gr.addColorStop(0.10, CA(hex, alpha));
      gr.addColorStop(0.45, CA(hex, alpha * 0.62));
      gr.addColorStop(0.80, CA(hex, alpha * 0.24));
      gr.addColorStop(1, CA(hex, 0));
      x.save();
      x.fillStyle = gr;
      x.globalAlpha = 0.45; ribbon(x, pts, 2.7);   // 滲みの外周
      x.globalAlpha = 0.75; ribbon(x, pts, 1.0);   // 本体
      x.globalAlpha = 1.00; ribbon(x, pts, 0.34);  // 芯
      x.restore();
    }
    /* 縁から一斉に垂らす。density で本数、pale で析出（白い）筋を混ぜる。 */
    function dripRow(o, y0, len, count, darkHex, paleHex, alpha) {
      var i, S = o.S, cx, isPale;
      for (i = 0; i < count; i++) {
        cx = rnd() * S;
        isPale = rnd() < 0.22;                    // 白華（石灰分の析出）は少数派
        var L = len * rr(0.35, 1.0);
        var w = rr(1.6, 7.0);
        tiled(o, (function (cx, L, w, isPale) {
          return function () {
            var sv = _s; seed(Math.floor(cx * 977) ^ 0x5f);
            drip(o, cx, y0, L, w, isPale ? paleHex : darkHex,
              (isPale ? alpha * 0.55 : alpha) * rr(0.5, 1.0), 0.30);
            _s = sv;
          };
        })(cx, L, w, isPale));
      }
    }

    /* --- 段差（水平の縁）--------------------------------------------------
       上に灰の唇（明）、下に影（暗）。これ1本で「そこに水平面がある」と読める。
       ------------------------------------------------------------------- */
    function ledge(o, y, ashHex, shadowHex, lipA, shA, thick) {
      var x = o.x, S = o.S;
      x.save();
      x.fillStyle = CA(shadowHex, shA);           // 段差の下側＝庇の影
      x.fillRect(0, y, S, thick);
      var gr = x.createLinearGradient(0, y + thick, 0, y + thick + 5);
      gr.addColorStop(0, CA(ashHex, lipA));       // 段差の上向き面＝灰が溜まる
      gr.addColorStop(1, CA(ashHex, 0));
      x.fillStyle = gr; x.fillRect(0, y + thick, S, 5);
      x.restore();
    }

    /* --- 欠け（チッピング）------------------------------------------------
       角ほど摩耗する。破断面は新しいので周りより明るく、その下辺に影が落ちる。
       ------------------------------------------------------------------- */
    function chip(o, cx, cy, r, faceHex, shadowHex, a) {
      var x = o.x, n = ri(5, 8), k, ang, rad;
      x.save();
      x.beginPath();
      for (k = 0; k < n; k++) {
        ang = (k / n) * Math.PI * 2 + rr(-0.3, 0.3);
        rad = r * rr(0.45, 1.15);
        if (k === 0) x.moveTo(cx + Math.cos(ang) * rad, cy + Math.sin(ang) * rad);
        else x.lineTo(cx + Math.cos(ang) * rad, cy + Math.sin(ang) * rad);
      }
      x.closePath();
      x.fillStyle = CA(faceHex, a); x.fill();     // 破断面（明）
      x.save(); x.clip();
      var gr = x.createLinearGradient(0, cy - r, 0, cy + r);
      gr.addColorStop(0, CA(shadowHex, a * 0.85));// 上の縁は元の面が庇になり暗い
      gr.addColorStop(0.45, CA(shadowHex, 0));
      x.fillStyle = gr; x.fillRect(cx - r * 1.4, cy - r * 1.4, r * 2.8, r * 2.8);
      x.restore();
      x.restore();
    }

    /* --- 亀裂 --------------------------------------------------------------
       枝分かれしながら細くなる折れ線。明るい側の縁を1px足すと彫りに見える。
       ------------------------------------------------------------------- */
    function crack(o, x0, y0, ang, len, wid, darkHex, liteHex, depth) {
      var x = o.x, px = x0, py = y0, k, steps = Math.max(4, Math.floor(len / 7)), sl = len / steps;
      x.save();
      x.lineCap = 'round';
      for (k = 0; k < steps; k++) {
        ang += rr(-0.45, 0.45);
        var nx = px + Math.cos(ang) * sl, ny = py + Math.sin(ang) * sl;
        var w = wid * (1 - k / steps);
        x.strokeStyle = CA(liteHex, 0.35); x.lineWidth = w + 1.2;
        x.beginPath(); x.moveTo(px, py - 1); x.lineTo(nx, ny - 1); x.stroke();
        x.strokeStyle = CA(darkHex, 0.85); x.lineWidth = w;
        x.beginPath(); x.moveTo(px, py); x.lineTo(nx, ny); x.stroke();
        if (depth > 0 && rnd() < 0.22)
          crack(o, nx, ny, ang + rr(-1.1, 1.1), len * rr(0.2, 0.45), w * 0.7, darkHex, liteHex, depth - 1);
        px = nx; py = ny;
      }
      x.restore();
    }

    /* --- 弾片痕（ポック）--------------------------------------------------- */
    function pock(o, cx, cy, r, coreHex, faceHex, shadowHex) {
      var x = o.x;
      chip(o, cx, cy, r, faceHex, shadowHex, 0.9);
      x.save();
      x.fillStyle = CA(coreHex, 0.75);
      x.beginPath(); x.arc(cx, cy + r * 0.12, r * 0.42, 0, Math.PI * 2); x.fill();
      x.fillStyle = CA(faceHex, 0.55);            // 上縁の破断面が西日を拾う
      x.beginPath(); x.arc(cx, cy - r * 0.22, r * 0.34, 0, Math.PI * 2); x.fill();
      x.restore();
    }

    /* --- 錆の滲み ----------------------------------------------------------
       鉄から下方向へ。上端は濃く、下へ行くほど広がって薄れる（水で運ばれる）。
       ------------------------------------------------------------------- */
    function rustBleed(o, cx, cy, len, w, a) {
      var x = o.x;
      x.save();
      var gr = x.createLinearGradient(0, cy, 0, cy + len);
      gr.addColorStop(0, CA(sh(P.rust, 0.85), a));
      gr.addColorStop(0.25, CA(P.rust, a * 0.8));
      gr.addColorStop(0.7, CA(sh(P.rust, 1.15), a * 0.32));
      gr.addColorStop(1, CA(sh(P.rust, 1.15), 0));
      x.fillStyle = gr;
      x.beginPath();
      x.moveTo(cx - w * 0.5, cy);
      x.quadraticCurveTo(cx - w * 1.3, cy + len * 0.6, cx - w * 1.1, cy + len);
      x.lineTo(cx + w * 1.1, cy + len);
      x.quadraticCurveTo(cx + w * 1.3, cy + len * 0.6, cx + w * 0.5, cy);
      x.closePath(); x.fill();
      x.restore();
      seed(Math.floor(cx * 131 + cy * 17) >>> 0);
      var i;
      for (i = 0; i < 3; i++) drip(o, cx + rr(-w, w), cy, len * rr(0.4, 1.0), rr(1.2, 3.0), P.rust, a * 0.9, 0.25);
    }

    /* =======================================================================
       5. コンクリート（打ち放し）— 色と高さを同じ関数から出す
       mode 0 = 色 / mode 1 = 高さ。同じ乱数列を使うので特徴が必ず一致する。
       ==================================================================== */
    function buildConcrete(mode) {
      var S = 512, o = mk(S), x = o.x, isH = (mode === 1);
      var big = fbm(S, 4, 5, 101);                // 打設ロットのむら
      var agg = fbm(S, 64, 3, 233);               // 骨材の粒
      var fine = fbm(S, 160, 2, 977);             // 目の細かいざらつき
      var cDark = toRGB(P.concreteDark, [0, 0, 0]);
      var cPale = toRGB(sh(P.concrete, 1.28), [0, 0, 0]);
      var cWet = toRGB(P.concreteWet, [0, 0, 0]);

      if (isH) {
        fill(o, function (px, py, u, v, out) {
          var i = py * S + px;
          var h = 128 + (agg[i] - 0.5) * 30 + (fine[i] - 0.5) * 16 + (big[i] - 0.5) * 12;
          out[0] = out[1] = out[2] = h;
        });
      } else {
        fill(o, function (px, py, u, v, out) {
          var i = py * S + px;
          var t = big[i] * 0.55 + agg[i] * 0.30 + fine[i] * 0.15;
          lerp3(cDark, cPale, (t - 0.26) / 0.46, out);
          /* 下へ行くほど跳ね返りの泥で暗い。垂直面の上下が一目で読めるようにする。 */
          var k = 1 - 0.30 * Math.pow(v, 2.4);
          out[0] *= k; out[1] *= k; out[2] *= k;
          /* 濡れ残りの染み：低周波の谷にだけ溜める */
          var wt = smoothstep(0.40, 0.16, big[i]) * 0.45 * (0.35 + 0.65 * v);
          lerp3(out, cWet, wt, out);
        });
      }

      seed(4211);
      var panel = 256;                            // 型枠パネル 2x2 割付
      var i, j;

      /* --- 型枠の板目（せき板の合わせ）：弱い水平線を等間隔に -------------- */
      for (j = 0; j < 8; j++) {
        var by = j * 64 + 0.5;
        x.save();
        if (isH) {
          x.fillStyle = GYA(104, 0.55); x.fillRect(0, by, S, 1.4);
          x.fillStyle = GYA(160, 0.30); x.fillRect(0, by + 1.4, S, 1.2);
        } else {
          x.fillStyle = CA(P.grime, 0.16); x.fillRect(0, by, S, 1.4);
          x.fillStyle = CA(sh(P.concrete, 1.30), 0.13); x.fillRect(0, by + 1.4, S, 1.4);
        }
        x.restore();
      }

      /* --- パネル継ぎ目：ノロ漏れの段差。ここが雨だれの発生源になる ------- */
      for (j = 0; j < 2; j++) {
        var py0 = j * panel;
        if (isH) {
          x.fillStyle = GY(88); x.fillRect(0, py0 - 2, S, 3.5);
          x.fillStyle = GY(176); x.fillRect(0, py0 + 1.5, S, 2.5);
        } else {
          ledge(o, py0 - 3, sh(P.ash, 1.45), P.grime, 0.42, 0.55, 4);
        }
        var pxv = j * panel;
        if (isH) {
          x.fillStyle = GY(96); x.fillRect(pxv - 1.5, 0, 3, S);
          x.fillStyle = GY(168); x.fillRect(pxv + 1.5, 0, 1.8, S);
        } else {
          x.fillStyle = CA(P.grime, 0.34); x.fillRect(pxv - 1.5, 0, 3, S);
          x.fillStyle = CA(sh(P.concrete, 1.22), 0.20); x.fillRect(pxv + 1.5, 0, 1.8, S);
        }
      }

      /* --- セパレータ穴（Pコン跡）----------------------------------------
         パネル1枚につき 2x2。窪みなので上内側が影・下内側が明るい（西日は上から）。
         穴には水が溜まるので必ず下へ短い筋を落とす。ここを描かないと嘘になる。 */
      var holes = [];
      for (j = 0; j < 4; j++) for (i = 0; i < 4; i++) {
        var hx = 64 + i * 128 + rr(-5, 5), hy = 64 + j * 128 + rr(-5, 5), hr = rr(6.0, 7.6);
        holes.push([hx, hy, hr]);
        (function (hx, hy, hr) {
          tiled(o, function () {
            if (isH) {
              var gr = x.createRadialGradient(hx, hy, 0, hx, hy, hr * 1.5);
              gr.addColorStop(0, GY(60)); gr.addColorStop(0.62, GY(96));
              gr.addColorStop(0.80, GY(178)); gr.addColorStop(1, GYA(128, 0));
              x.fillStyle = gr;
              x.beginPath(); x.arc(hx, hy, hr * 1.5, 0, Math.PI * 2); x.fill();
            } else {
              x.save();
              x.fillStyle = CA(P.grime, 0.55);            // 窪みの内側
              x.beginPath(); x.arc(hx, hy, hr, 0, Math.PI * 2); x.fill();
              x.fillStyle = CA(sh(P.concrete, 1.05), 0.85); // モルタル詰めのプラグ
              x.beginPath(); x.arc(hx, hy + 0.4, hr * 0.66, 0, Math.PI * 2); x.fill();
              var g2 = x.createLinearGradient(0, hy - hr, 0, hy + hr);
              g2.addColorStop(0, CA(P.grime, 0.5));       // 上内壁＝影
              g2.addColorStop(0.55, CA(P.grime, 0));
              x.fillStyle = g2;
              x.beginPath(); x.arc(hx, hy, hr, 0, Math.PI * 2); x.fill();
              x.fillStyle = CA(sh(P.concrete, 1.35), 0.5);// 下内壁＝西日の照り返し
              x.beginPath(); x.arc(hx, hy + hr * 0.45, hr * 0.5, 0, Math.PI); x.fill();
              x.restore();
            }
          });
        })(hx, hy, hr);
      }

      /* --- 剥落（爆裂）：鉄筋が錆びて膨張し、かぶりコンクリートが飛ぶ ----- */
      var spalls = [];
      for (i = 0; i < 5; i++) {
        var sx0 = rnd() * S, sy0 = rnd() * S, sr = rr(16, 42);
        spalls.push([sx0, sy0, sr]);
        (function (sx0, sy0, sr) {
          tiled(o, function () {
            var n = 11, k, ang, rad;
            x.save();
            x.beginPath();
            for (k = 0; k < n; k++) {
              ang = (k / n) * Math.PI * 2;
              rad = sr * (0.55 + 0.55 * h2(k, Math.floor(sx0), 7));
              if (k === 0) x.moveTo(sx0 + Math.cos(ang) * rad, sy0 + Math.sin(ang) * rad * 0.8);
              else x.lineTo(sx0 + Math.cos(ang) * rad, sy0 + Math.sin(ang) * rad * 0.8);
            }
            x.closePath();
            if (isH) {
              x.fillStyle = GY(84); x.fill();
              x.save(); x.clip();
              var gh = x.createLinearGradient(0, sy0 - sr, 0, sy0 + sr);
              gh.addColorStop(0, GY(46)); gh.addColorStop(1, GY(112));
              x.fillStyle = gh; x.fillRect(sx0 - sr * 2, sy0 - sr * 2, sr * 4, sr * 4);
              x.restore();
              x.strokeStyle = GY(190); x.lineWidth = 2; x.stroke();
            } else {
              x.fillStyle = CA(sh(P.concreteDark, 1.05), 0.92); x.fill();  // 内部＝骨材の断面
              x.save(); x.clip();
              var gc = x.createLinearGradient(0, sy0 - sr, 0, sy0 + sr);
              gc.addColorStop(0, CA(P.grime, 0.75));      // 上壁は庇になり深く暗い
              gc.addColorStop(0.5, CA(P.grime, 0.10));
              gc.addColorStop(1, CA(sh(P.concrete, 1.25), 0.35));
              x.fillStyle = gc; x.fillRect(sx0 - sr * 2, sy0 - sr * 2, sr * 4, sr * 4);
              /* 露出鉄筋：水平方向に1本。錆が下へ滲む */
              if (sr > 26) {
                x.fillStyle = CA(P.rebar, 0.95);
                x.fillRect(sx0 - sr, sy0 + sr * 0.05, sr * 2, 4.2);
                x.fillStyle = CA(sh(P.rust, 1.1), 0.55);
                x.fillRect(sx0 - sr, sy0 + sr * 0.05, sr * 2, 1.8);
              }
              x.restore();
              /* 破断の縁：新しい割れ肌は白い */
              x.strokeStyle = CA(sh(P.concrete, 1.35), 0.55); x.lineWidth = 2.2; x.stroke();
            }
            x.restore();
          });
        })(sx0, sy0, sr);
      }

      if (!isH) {
        /* --- 雨だれ：パネル継ぎ目の唇から一斉に垂らす -------------------- */
        seed(8823);
        dripRow(o, 4, 250, 26, P.grime, sh(P.plaster, 1.35), 0.40);
        dripRow(o, panel + 4, 250, 26, P.grime, sh(P.plaster, 1.35), 0.40);
        /* セパ穴からの短い垂れ。長さは穴の径に対して短く、必ず穴に接続する。 */
        for (i = 0; i < holes.length; i++) {
          (function (h) {
            tiled(o, function () {
              seed(Math.floor(h[0] * 31 + h[1]) >>> 0);
              drip(o, h[0], h[1] + h[2] * 0.5, rr(22, 70), rr(2.5, 5), P.grime, 0.40, 0.18);
            });
          })(holes[i]);
        }
        /* 剥落からの錆の流れ */
        for (i = 0; i < spalls.length; i++) if (spalls[i][2] > 26) {
          (function (s) {
            tiled(o, function () { rustBleed(o, s[0], s[1] + s[2] * 0.4, rr(60, 140), s[2] * 0.55, 0.42); });
          })(spalls[i]);
        }
        /* --- 角の欠け：パネルの角ほど摩耗する ---------------------------- */
        seed(661);
        for (j = 0; j < 2; j++) for (i = 0; i < 2; i++) {
          var k2, cxx = i * panel, cyy = j * panel;
          for (k2 = 0; k2 < 7; k2++) {
            (function (cx, cy) {
              tiled(o, function () {
                chip(o, cx, cy, rr(3, 11), sh(P.concrete, 1.30), P.grime, 0.8);
              });
            })(cxx + rr(-16, 16), cyy + rr(-14, 14));
          }
        }
        /* --- 弾片痕：面の中に散らす。散弾状なので方向を揃える ------------ */
        seed(313);
        var bx = rr(0, S), byy = rr(0, S);
        for (i = 0; i < 22; i++) {
          (function (cx, cy, r) {
            tiled(o, function () { pock(o, cx, cy, r, P.grime, sh(P.concrete, 1.32), P.concreteDark); });
          })(bx + rr(-190, 190), byy + rr(-90, 90), rr(2.2, 6.5));
        }
        /* --- 亀裂：剥落から伸びる ---------------------------------------- */
        seed(5501);
        for (i = 0; i < spalls.length; i++)
          crack(o, spalls[i][0], spalls[i][1], rr(0, 6.28), rr(50, 130), 2.0, P.grime, sh(P.concrete, 1.25), 2);

        /* --- 総仕上げ：低周波の汚れを乗算、粒を軽くスクリーン ------------ */
        blend(o, greyCanvas(S, ctr(fbm(S, 6, 4, 4404), 1.5, 0.5), 0.52, 1.0), 'multiply', 0.55);
        blend(o, greyCanvas(S, fbm(S, 200, 2, 6602), 0.0, 1.0), 'overlay', 0.10);
      } else {
        blend(o, greyCanvas(S, fbm(S, 220, 2, 6602), 0.30, 0.70), 'overlay', 0.35);
      }
      return o;
    }

    /* =======================================================================
       6. 漆喰（剥離して下地が覗く）
       3層構造：仕上げ塗り → 下塗り → 下地（煉瓦＋石）。
       層の境目には必ず「上層の小口の影」と「欠けた縁の明るい線」を置く。
       これが無いと単なる模様に見え、剥がれに見えない。
       ==================================================================== */
    function buildPlaster() {
      var S = 512, o = mk(S), x = o.x;
      var wx = fbm(S, 5, 3, 71), wy = fbm(S, 5, 3, 137);
      var m0 = fbm(S, 3, 5, 909);
      var m = warp(S, m0, wx, wy, 58);            // 縁をちぎれさせる
      var det = fbm(S, 90, 3, 1201);
      var mott = fbm(S, 10, 4, 331);

      var T2 = 0.545, T1 = 0.455;                 // 仕上げ/下塗り/下地の境
      var cTop = toRGB(P.plaster, [0, 0, 0]);
      var cTopD = toRGB(sh(P.plaster, 0.74), [0, 0, 0]);
      var cBase = toRGB(mix(P.plaster, P.concreteDark, 0.45), [0, 0, 0]);
      var cLip = toRGB(sh(P.plaster, 1.32), [0, 0, 0]);
      var cSh = toRGB(P.grime, [0, 0, 0]);
      var cBrk = toRGB(P.brick, [0, 0, 0]);
      var cBrkD = toRGB(sh(P.brick, 0.62), [0, 0, 0]);
      var cJnt = toRGB(mix(P.plaster, P.concreteDark, 0.30), [0, 0, 0]);
      var cStn = toRGB(P.stone, [0, 0, 0]);
      var tmpA = [0, 0, 0];

      /* 下地：粗い煉瓦積み。石が混じる乱層積み（旧市街の躯体） */
      function substrate(u, v, i, out) {
        var row = Math.floor(v * 10), off = (row % 2) * 0.5;
        var cu = u * 5 + off, col = Math.floor(cu);
        var bx = cu - col, by = v * 10 - row;
        var hh = h2(col, row, 55);
        var isStone = hh > 0.78;                  // 2割は切石
        lerp3(isStone ? cStn : cBrk, isStone ? cBrkD : cBrkD, 0.15 + 0.55 * h2(col, row, 91), out);
        var kk = 0.72 + 0.55 * det[i];
        out[0] *= kk; out[1] *= kk; out[2] *= kk;
        if (bx < 0.045 || bx > 0.955 || by < 0.10 || by > 0.90) {
          lerp3(out, cJnt, 0.85, out);            // 目地
          if (by < 0.10) lerp3(out, cSh, 0.45, out); // 目地の上側は影
        }
      }

      fill(o, function (px, py, u, v, out) {
        var i = py * S + px, mv = m[i];
        if (mv > T2 + 0.012) {                    // 仕上げ塗り（生きている面）
          lerp3(cTopD, cTop, 0.25 + 0.95 * mott[i], out);
          var k = 0.86 + 0.28 * det[i];
          out[0] *= k; out[1] *= k; out[2] *= k;
        } else if (mv > T2 - 0.006) {             // 剥がれ際の割れ肌（明）
          lerp3(cLip, cTop, 0.35 * det[i], out);
        } else if (mv > T2 - 0.030) {             // 上層の小口が落とす影
          lerp3(cBase, cSh, 0.62, out);
        } else if (mv > T1 + 0.010) {             // 下塗り（砂の粗い層）
          lerp3(cBase, cTopD, 0.30 + 0.5 * det[i], out);
        } else if (mv > T1 - 0.006) {
          lerp3(cLip, cBase, 0.45, out);
        } else if (mv > T1 - 0.026) {
          substrate(u, v, i, out); lerp3(out, cSh, 0.55, out);
        } else {
          substrate(u, v, i, out);
        }
        /* 下ほど泥はね、上ほど灰。垂直面であることを明度で示す。 */
        var g2 = 1 - 0.26 * Math.pow(v, 2.2);
        out[0] *= g2; out[1] *= g2; out[2] *= g2;
      });

      /* --- 剥離の縁に沿った微細な欠け ------------------------------------- */
      seed(2299);
      var i, px2, py2;
      for (i = 0; i < 220; i++) {
        px2 = Math.floor(rnd() * S); py2 = Math.floor(rnd() * S);
        var mv = m[py2 * S + px2];
        if (mv > T2 - 0.02 && mv < T2 + 0.03)
          chip(o, px2, py2, rr(2, 6), sh(P.plaster, 1.35), P.grime, 0.75);
      }

      /* --- ヘアクラック：生きている面に走る。剥離はここから始まる -------- */
      seed(1777);
      for (i = 0; i < 14; i++) {
        px2 = rnd() * S; py2 = rnd() * S;
        if (m[(Math.floor(py2) * S + Math.floor(px2))] < T2) continue;
        crack(o, px2, py2, rr(0, 6.28), rr(40, 150), 1.6, P.grime, sh(P.plaster, 1.30), 2);
      }

      /* --- 雨だれ：天端（画面上端＝上の水平面の縁）から --------------------- */
      seed(6161);
      dripRow(o, 0, 300, 30, P.grime, sh(P.plaster, 1.42), 0.34);
      /* 剥離部の上縁からも垂れる（露出した下地は水を吸って濃く残る） */
      for (i = 0; i < 26; i++) {
        px2 = rnd() * S; py2 = rnd() * S;
        if (m[(Math.floor(py2) * S + Math.floor(px2))] > T1) continue;
        tiled(o, (function (a, b) {
          return function () { drip(o, a, b, rr(30, 110), rr(2, 6), P.grime, 0.30, 0.22); };
        })(px2, py2));
      }

      /* --- 灰の堆積：上向きの微小な棚（剥離の下端）に白く残る ------------- */
      x.save();
      x.globalCompositeOperation = 'lighter';
      x.globalAlpha = 0.16;
      var ashCv = mk(S);
      fill(ashCv, function (px, py, u, v, out) {
        var i2 = py * S + px, above = m[((py - 3 + S) % S) * S + px];
        /* 自分は下地・すぐ上は仕上げ ＝ 上を向いた小さな棚。ここだけ灰が乗る。 */
        var on = (m[i2] < T2 && above > T2) ? 1 : 0;
        var vv = on * (0.5 + 0.5 * det[i2]) * 255;
        out[0] = vv * (R8(P.ash) / 255); out[1] = vv * (G8(P.ash) / 255); out[2] = vv * (B8(P.ash) / 255);
      });
      x.drawImage(ashCv.cv, 0, 0);
      x.restore();

      blend(o, greyCanvas(S, ctr(fbm(S, 7, 4, 8181), 1.45, 0.5), 0.55, 1.02), 'multiply', 0.5);
      blend(o, greyCanvas(S, fbm(S, 190, 2, 3311), 0.0, 1.0), 'overlay', 0.09);
      return o;
    }

    /* =======================================================================
       7. 切石（布積み）
       ブロックごとの明度差が最大の武器。逆光でも「積んである」と読める。
       ==================================================================== */
    function buildStone() {
      var S = 512, o = mk(S), x = o.x;
      var det = fbm(S, 70, 4, 424);
      var big = fbm(S, 8, 4, 616);
      var ROWS = 4, COLS = 3, jw = 0.020, jh = 0.055;
      var cS = toRGB(P.stone, [0, 0, 0]);
      var cSD = toRGB(sh(P.stone, 0.58), [0, 0, 0]);
      var cSL = toRGB(sh(P.stone, 1.30), [0, 0, 0]);
      var cJ = toRGB(mix(P.stone, P.concreteDark, 0.55), [0, 0, 0]);
      var cSh = toRGB(P.grime, [0, 0, 0]);
      var cAsh = toRGB(sh(P.ash, 1.5), [0, 0, 0]);

      fill(o, function (px, py, u, v, out) {
        var i = py * S + px;
        var row = Math.floor(v * ROWS), off = (row % 2) * (0.5 / COLS);
        var cu = (u + off) * COLS, col = Math.floor(cu) % COLS;
        var bx = cu - Math.floor(cu), by = v * ROWS - row;
        var hv = h2(col, row, 33);

        if (bx < jw || bx > 1 - jw || by < jh || by > 1 - jh) {
          /* 目地：奥まっているので暗い。ただし下側の唇には石灰の白華が出る。 */
          lerp3(cJ, cSD, 0.35 + 0.5 * det[i], out);
          if (by < jh * 0.55) lerp3(out, cSh, 0.60, out);       // 上の石の小口の影
          if (by > 1 - jh * 0.35) lerp3(out, cSL, 0.30, out);   // 下の石の天端が拾う光
        } else {
          /* 石身：ロットの明度差を大きく取る（0.62〜1.28倍） */
          var lum = 0.62 + 0.66 * hv;
          lerp3(cSD, cSL, sat((det[i] * 0.45 + big[i] * 0.55 - 0.18) / 0.62), out);
          out[0] *= lum; out[1] *= lum; out[2] *= lum;
          /* 石の天端＝上向きの面。灰が薄く乗って一段明るい。 */
          var top = smoothstep(jh + 0.075, jh, by);
          lerp3(out, cAsh, top * 0.34, out);
          /* 石の下端＝庇の影。上下の対でブロックが立体に見える。 */
          var bot = smoothstep(1 - jh - 0.055, 1 - jh, by);
          lerp3(out, cSh, bot * 0.34, out);
          /* 縦の目地際も同様に締める */
          var side = smoothstep(jw + 0.020, jw, bx) + smoothstep(1 - jw - 0.020, 1 - jw, bx);
          lerp3(out, cSh, sat(side) * 0.16, out);
          /* びしゃん叩きの縦筋（石工の道具跡）。石らしさはここで出る。 */
          var tool = Math.sin((u * 512 + hv * 40) * 0.9) * 0.5 + 0.5;
          var kk = 0.955 + 0.09 * tool * det[i];
          out[0] *= kk; out[1] *= kk; out[2] *= kk;
        }
        var gg = 1 - 0.24 * Math.pow(v, 2.3);
        out[0] *= gg; out[1] *= gg; out[2] *= gg;
      });

      seed(9091);
      var r, c, i;
      /* --- 角の欠け：石は角から丸くなる。4隅に必ず、大きさは不揃いに ------ */
      for (r = 0; r < ROWS; r++) for (c = 0; c < COLS; c++) {
        var off2 = (r % 2) * (S / (COLS * 2));
        var bw = S / COLS, bh = S / ROWS;
        var x0 = c * bw + off2, y0 = r * bh;
        var corners = [[x0 + bw * jw * 2, y0 + bh * jh * 2], [x0 + bw * (1 - jw * 2), y0 + bh * jh * 2],
        [x0 + bw * jw * 2, y0 + bh * (1 - jh * 2)], [x0 + bw * (1 - jw * 2), y0 + bh * (1 - jh * 2)]];
        for (i = 0; i < 4; i++) {
          if (rnd() < 0.30) continue;
          (function (cx, cy) {
            tiled(o, function () { chip(o, cx, cy, rr(4, 15), sh(P.stone, 1.28), P.grime, 0.85); });
          })(corners[i][0], corners[i][1]);
        }
        /* 稜線の摩耗：辺に沿った小さな欠けを数個 */
        for (i = 0; i < 4; i++) {
          (function (cx, cy) {
            tiled(o, function () { chip(o, cx, cy, rr(2, 6), sh(P.stone, 1.22), P.grime, 0.6); });
          })(x0 + rr(0.1, 0.9) * bw, y0 + (rnd() < 0.5 ? bh * jh : bh * (1 - jh)));
        }
      }

      /* --- 砲撃の弾片痕：一方向から来た散弾。向きが揃うと「撃たれた」と読める */
      seed(4747);
      var ox = rr(0, S), oy = rr(0, S);
      for (i = 0; i < 34; i++) {
        (function (cx, cy, rr2) {
          tiled(o, function () { pock(o, cx, cy, rr2, P.grime, sh(P.stone, 1.34), sh(P.stone, 0.5)); });
        })(ox + rr(-230, 230), oy + rr(-110, 110), rr(2.0, 8.0));
      }
      /* 直撃跡：大きく抉れて内部が露出 */
      seed(2020);
      for (i = 0; i < 2; i++) {
        var hx2 = rnd() * S, hy2 = rnd() * S;
        (function (cx, cy) {
          tiled(o, function () {
            chip(o, cx, cy, rr(20, 34), sh(P.stone, 0.72), P.grime, 0.95);
            chip(o, cx, cy - 3, rr(10, 18), sh(P.stone, 1.20), P.grime, 0.5);
            crack(o, cx, cy, rr(0, 6.28), rr(60, 140), 2.4, P.grime, sh(P.stone, 1.3), 2);
            crack(o, cx, cy, rr(0, 6.28), rr(60, 140), 2.0, P.grime, sh(P.stone, 1.3), 2);
          });
        })(hx2, hy2);
      }

      /* --- 雨だれ：各段の目地（水平の縁）から下へ ------------------------- */
      seed(3333);
      for (r = 0; r < ROWS; r++)
        dripRow(o, r * (S / ROWS) + S / ROWS * jh + 2, S / ROWS * 1.5, 12, P.grime, sh(P.stone, 1.45), 0.34);

      blend(o, greyCanvas(S, ctr(fbm(S, 5, 4, 7373), 1.5, 0.5), 0.56, 1.0), 'multiply', 0.5);
      blend(o, greyCanvas(S, fbm(S, 200, 2, 1919), 0.0, 1.0), 'overlay', 0.10);
      return o;
    }

    /* =======================================================================
       8. 煉瓦（漆喰が落ちて露出した躯体）
       ==================================================================== */
    function buildBrick() {
      var S = 512, o = mk(S), x = o.x;
      var det = fbm(S, 80, 4, 515);
      var big = fbm(S, 12, 3, 727);
      var ROWS = 8, COLS = 4, jw = 0.022, jh = 0.085;
      var cB = toRGB(P.brick, [0, 0, 0]);
      var cBD = toRGB(sh(P.brick, 0.48), [0, 0, 0]);
      var cBL = toRGB(sh(P.brick, 1.26), [0, 0, 0]);
      var cScor = toRGB(mix(P.brick, P.grime, 0.78), [0, 0, 0]);
      var cCore = toRGB(mix(P.brick, P.plaster, 0.55), [0, 0, 0]);
      var cJ = toRGB(mix(P.plaster, P.concreteDark, 0.42), [0, 0, 0]);
      var cSh = toRGB(P.grime, [0, 0, 0]);
      var cVoid = toRGB(sh(P.grime, 0.55), [0, 0, 0]);
      var cAsh = toRGB(sh(P.ash, 1.45), [0, 0, 0]);

      fill(o, function (px, py, u, v, out) {
        var i = py * S + px;
        var row = Math.floor(v * ROWS), off = (row % 2) * (0.5 / COLS);
        var cu = (u + off) * COLS, col = Math.floor(cu) % COLS;
        var bx = cu - Math.floor(cu), by = v * ROWS - row;
        var hv = h2(col, row, 17), hv2 = h2(col, row, 83);
        var missing = hv2 > 0.955;                 // ごく少数、抜け落ちた煉瓦
        var scorch = hv2 > 0.80 && !missing;       // 焼けて黒くなったもの
        var spall = hv2 < 0.13;                    // 表面が剥がれて内部が出たもの

        if (missing) {
          lerp3(cVoid, cSh, 0.4 + 0.4 * det[i], out);
          if (by < 0.22) lerp3(out, cVoid, 0.7, out);
          var gg2 = 1 - 0.24 * Math.pow(v, 2.3);
          out[0] *= gg2; out[1] *= gg2; out[2] *= gg2;
          return;
        }
        if (bx < jw || bx > 1 - jw || by < jh || by > 1 - jh) {
          lerp3(cJ, cBD, 0.25 + 0.45 * det[i], out);
          if (by < jh * 0.5) lerp3(out, cSh, 0.55, out);
          if (by > 1 - jh * 0.3) lerp3(out, cAsh, 0.22, out);
        } else {
          var lum = 0.68 + 0.62 * hv;
          lerp3(cBD, cBL, sat((det[i] * 0.5 + big[i] * 0.5 - 0.2) / 0.6), out);
          out[0] *= lum; out[1] *= lum; out[2] *= lum;
          if (scorch) lerp3(out, cScor, 0.55 + 0.35 * big[i], out);
          if (spall) {
            /* 剥がれた面：焼成前の芯が出るので周囲より白っぽく粗い */
            var sm = smoothstep(0.42, 0.58, det[i] * 0.6 + big[i] * 0.4);
            lerp3(out, cCore, sm * 0.8, out);
          }
          var top = smoothstep(jh + 0.09, jh, by);
          lerp3(out, cAsh, top * 0.30, out);
          var bot = smoothstep(1 - jh - 0.07, 1 - jh, by);
          lerp3(out, cSh, bot * 0.36, out);
          var side = smoothstep(jw + 0.022, jw, bx) + smoothstep(1 - jw - 0.022, 1 - jw, bx);
          lerp3(out, cSh, sat(side) * 0.18, out);
        }
        var gg = 1 - 0.26 * Math.pow(v, 2.3);
        out[0] *= gg; out[1] *= gg; out[2] *= gg;
      });

      /* --- 角の欠け -------------------------------------------------------- */
      seed(818);
      var r, c, i, bw = S / COLS, bh = S / ROWS;
      for (r = 0; r < ROWS; r++) for (c = 0; c < COLS; c++) {
        var off2 = (r % 2) * (bw / 2), x0 = c * bw + off2, y0 = r * bh;
        for (i = 0; i < 3; i++) {
          if (rnd() < 0.45) continue;
          (function (cx, cy) {
            tiled(o, function () { chip(o, cx, cy, rr(2.5, 8), sh(P.brick, 1.35), P.grime, 0.8); });
          })(x0 + (rnd() < 0.5 ? bw * 0.04 : bw * 0.96), y0 + (rnd() < 0.5 ? bh * 0.12 : bh * 0.88));
        }
      }

      /* --- 白華（エフロレッセンス）と雨だれ：目地から出る ------------------ */
      seed(6464);
      for (r = 0; r < ROWS; r++)
        dripRow(o, r * bh + bh * jh + 1, bh * 2.0, 8, P.grime, sh(P.plaster, 1.5), 0.30);

      /* --- 弾痕と亀裂 ------------------------------------------------------ */
      seed(1212);
      var ox = rr(0, S), oy = rr(0, S);
      for (i = 0; i < 26; i++) {
        (function (cx, cy, rd) {
          tiled(o, function () { pock(o, cx, cy, rd, P.grime, sh(P.brick, 1.4), sh(P.brick, 0.4)); });
        })(ox + rr(-220, 220), oy + rr(-120, 120), rr(2, 7));
      }
      seed(2727);
      for (i = 0; i < 3; i++) crack(o, rnd() * S, rnd() * S, rr(1.2, 1.9), rr(120, 260), 2.6, P.grime, sh(P.brick, 1.35), 2);

      blend(o, greyCanvas(S, ctr(fbm(S, 6, 4, 5959), 1.4, 0.5), 0.58, 1.0), 'multiply', 0.5);
      blend(o, greyCanvas(S, fbm(S, 210, 2, 4141), 0.0, 1.0), 'overlay', 0.09);
      return o;
    }

    /* =======================================================================
       9. 鋼板（溶接・リベット・そこから下へ流れる錆）
       ==================================================================== */
    function buildMetal() {
      var S = 512, o = mk(S), x = o.x;
      var roll = fbm2(S, 6, 96, 4, 646);          // 圧延方向に伸びた筋（横長の異方性）
      var det = fbm(S, 150, 2, 828);
      var patch = fbm(S, 5, 4, 191);
      var cM = toRGB(P.metal, [0, 0, 0]);
      var cMD = toRGB(sh(P.metal, 0.42), [0, 0, 0]);
      var cML = toRGB(sh(P.metal, 1.42), [0, 0, 0]);
      var cR = toRGB(P.rust, [0, 0, 0]);

      fill(o, function (px, py, u, v, out) {
        var i = py * S + px;
        lerp3(cMD, cML, sat((roll[i] * 0.62 + det[i] * 0.22 + patch[i] * 0.16 - 0.22) / 0.56), out);
        /* 塗膜が生きている所と剥げた所。剥げた所から錆が始まる。 */
        var bare = smoothstep(0.56, 0.72, patch[i]);
        lerp3(out, cR, bare * 0.55 * (0.4 + 0.6 * det[i]), out);
        var gg = 1 - 0.22 * Math.pow(v, 2.0);
        out[0] *= gg; out[1] *= gg; out[2] *= gg;
      });

      seed(1357);
      var i, j;
      /* --- 溶接ビード：波打った隆起。上縁が光り下縁に影 ------------------- */
      function weld(y0, horizontal) {
        var k, n = 64, p = [];
        for (k = 0; k <= n; k++) p.push(y0 + Math.sin(k * 0.55) * 2.2 + rr(-1.0, 1.0));
        x.save();
        for (k = 0; k < n; k++) {
          var xa = k / n * S, xb = (k + 1) / n * S;
          x.strokeStyle = CA(sh(P.metal, 0.35), 0.85); x.lineWidth = 9;
          x.beginPath(); x.moveTo(xa, p[k] + 3); x.lineTo(xb, p[k + 1] + 3); x.stroke();
          x.strokeStyle = CA(sh(P.metal, 1.30), 0.8); x.lineWidth = 6;
          x.beginPath(); x.moveTo(xa, p[k]); x.lineTo(xb, p[k + 1]); x.stroke();
          x.strokeStyle = CA(sh(P.metal, 1.55), 0.55); x.lineWidth = 2.4;
          x.beginPath(); x.moveTo(xa, p[k] - 2); x.lineTo(xb, p[k + 1] - 2); x.stroke();
        }
        x.restore();
      }
      weld(S * 0.5);

      /* --- リベット：上に光、下に影。窪みではなく突起なので順序が逆 ------- */
      var rivets = [];
      for (j = 0; j < 3; j++) {
        var ry = [26, S * 0.5 - 22, S - 26][j];
        for (i = 0; i < 12; i++) {
          var rx = 22 + i * (S - 44) / 11, rd = 7.2;
          rivets.push([rx, ry]);
          (function (rx, ry, rd) {
            tiled(o, function () {
              x.save();
              x.fillStyle = CA(sh(P.metal, 0.30), 0.7);
              x.beginPath(); x.arc(rx, ry + 2.2, rd, 0, Math.PI * 2); x.fill();
              var gr = x.createRadialGradient(rx - rd * 0.35, ry - rd * 0.45, rd * 0.1, rx, ry, rd);
              gr.addColorStop(0, CA(sh(P.metal, 1.60), 1));
              gr.addColorStop(0.55, CA(P.metal, 1));
              gr.addColorStop(1, CA(sh(P.metal, 0.55), 1));
              x.fillStyle = gr;
              x.beginPath(); x.arc(rx, ry, rd, 0, Math.PI * 2); x.fill();
              x.restore();
            });
          })(rx, ry, rd);
        }
      }

      /* --- 錆の流れ：リベットと溶接から必ず「下へ」。横には流れない ------- */
      seed(2468);
      for (i = 0; i < rivets.length; i++) {
        if (rnd() < 0.42) continue;
        (function (rv) {
          tiled(o, function () { rustBleed(o, rv[0], rv[1] + 6, rr(40, 150), rr(5, 11), rr(0.30, 0.62)); });
        })(rivets[i]);
      }
      for (i = 0; i < 10; i++) {
        (function (cx) {
          tiled(o, function () { rustBleed(o, cx, S * 0.5 + 5, rr(50, 170), rr(6, 16), rr(0.22, 0.5)); });
        })(rnd() * S);
      }

      /* --- 掻き傷：新しい傷は地金が出て明るい。数は少なく、長く。 --------- */
      seed(9753);
      x.save();
      x.lineCap = 'round';
      for (i = 0; i < 46; i++) {
        var sx = rnd() * S, sy = rnd() * S, an = rr(-0.35, 0.35), ln = rr(20, 170);
        x.strokeStyle = CA(sh(P.metal, 1.75), rr(0.10, 0.42));
        x.lineWidth = rr(0.7, 2.0);
        x.beginPath(); x.moveTo(sx, sy); x.lineTo(sx + Math.cos(an) * ln, sy + Math.sin(an) * ln); x.stroke();
      }
      x.restore();

      /* --- 打痕：面がへこむと西日の当たり方が変わる ----------------------- */
      seed(1122);
      for (i = 0; i < 14; i++) {
        (function (cx, cy, rd) {
          tiled(o, function () {
            var gr = x.createLinearGradient(0, cy - rd, 0, cy + rd);
            gr.addColorStop(0, CA(sh(P.metal, 0.45), 0.55));
            gr.addColorStop(0.55, CA(P.metal, 0));
            gr.addColorStop(1, CA(sh(P.metal, 1.45), 0.40));
            x.save();
            x.beginPath(); x.ellipse(cx, cy, rd, rd * 0.72, rr(-0.5, 0.5), 0, Math.PI * 2);
            x.fillStyle = gr; x.fill();
            x.restore();
          });
        })(rnd() * S, rnd() * S, rr(10, 34));
      }

      blend(o, greyCanvas(S, ctr(fbm(S, 6, 4, 3131), 1.35, 0.5), 0.62, 1.02), 'multiply', 0.42);
      blend(o, greyCanvas(S, fbm(S, 230, 2, 8484), 0.0, 1.0), 'overlay', 0.10);
      return o;
    }

    /* =======================================================================
       10. 全面の錆
       鱗（スケール）に見せる鍵は「上端が明るく下端が暗い」擬似エンボス。
       ノイズの縦方向の差分をそのまま陰影に使う＝光が上から来ている前提で成立する。
       ==================================================================== */
    function buildRust() {
      var S = 512, o = mk(S), x = o.x;
      var scaleF = fbm(S, 14, 5, 2929);
      var flow = fbm2(S, 20, 5, 4, 3737);         // 縦に伸びた流れ
      var pit = fbm(S, 120, 2, 4949);
      var bloom = fbm(S, 7, 3, 5151);
      var cR = toRGB(P.rust, [0, 0, 0]);
      var cRD = toRGB(sh(P.rust, 0.42), [0, 0, 0]);
      var cRL = toRGB(sh(P.rust, 1.38), [0, 0, 0]);
      var cMetal = toRGB(sh(P.rebar, 0.9), [0, 0, 0]);

      fill(o, function (px, py, u, v, out) {
        var i = py * S + px;
        var s = scaleF[i] * 0.55 + flow[i] * 0.45;
        lerp3(cRD, cRL, sat((s - 0.24) / 0.52), out);
        /* 鱗の擬似陰影：3px 上との差。正なら手前へせり出した縁＝明るい。 */
        var up = scaleF[((py - 3 + S) % S) * S + px];
        var d = (scaleF[i] - up) * 5.0;
        var k = 1 + sat(d) * 0.55 - sat(-d) * 0.50;
        out[0] *= k; out[1] *= k; out[2] *= k;
        /* 孔食：深い点。数は多く、径は小さく。 */
        var pv = smoothstep(0.72, 0.90, pit[i]);
        lerp3(out, cRD, pv * 0.75, out);
        /* 鱗が剥がれ落ちて地金が覗く（少数）*/
        var bare = smoothstep(0.80, 0.93, bloom[i]);
        lerp3(out, cMetal, bare * 0.6, out);
        /* 乾いた粉状の酸化物が上部に、湿って濃い錆が下部に溜まる */
        var gg = 1 - 0.24 * Math.pow(v, 1.8);
        out[0] *= gg; out[1] *= gg; out[2] *= gg;
      });

      /* --- 流れ落ちた錆の筋 ------------------------------------------------ */
      seed(7171);
      var i;
      for (i = 0; i < 34; i++) {
        (function (cx, cy) {
          tiled(o, function () { drip(o, cx, cy, rr(60, 300), rr(2, 9), sh(P.rust, 1.25), rr(0.15, 0.40), 0.22); });
        })(rnd() * S, rnd() * S * 0.5);
      }
      /* --- 剥がれた鱗の縁：明るい輪郭を少し足すと厚みが出る --------------- */
      seed(3535);
      for (i = 0; i < 70; i++) {
        chip(o, rnd() * S, rnd() * S, rr(3, 13), sh(P.rust, 1.45), sh(P.rust, 0.35), 0.35);
      }
      blend(o, greyCanvas(S, ctr(fbm(S, 5, 4, 6969), 1.4, 0.5), 0.62, 1.05), 'multiply', 0.4);
      blend(o, greyCanvas(S, fbm(S, 200, 2, 1414), 0.0, 1.0), 'overlay', 0.12);
      return o;
    }

    /* =======================================================================
       11. 地面（真上を向いた面 ＝ 灰が最も厚く積もる）
       敷石をボロノイで割り、目地を谷にする。灰は谷と風下側の吹き溜まりに。
       ==================================================================== */
    function voronoi(S, cells, sd, outId, outEdge) {
      var cs = S / cells, cx = new Float32Array(cells * cells), cy = new Float32Array(cells * cells), i, j;
      for (j = 0; j < cells; j++) for (i = 0; i < cells; i++) {
        cx[j * cells + i] = (i + 0.18 + 0.64 * h2(i, j, sd)) * cs;
        cy[j * cells + i] = (j + 0.18 + 0.64 * h2(i, j, sd + 7)) * cs;
      }
      var px, py, gi, gj, di, dj, ii, jj, d1, d2, id1, ddx, ddy, d, k = 0;
      for (py = 0; py < S; py++) for (px = 0; px < S; px++, k++) {
        gi = Math.floor(px / cs); gj = Math.floor(py / cs);
        d1 = 1e9; d2 = 1e9; id1 = 0;
        for (dj = -1; dj <= 1; dj++) for (di = -1; di <= 1; di++) {
          ii = (gi + di + cells) % cells; jj = (gj + dj + cells) % cells;
          ddx = cx[jj * cells + ii] + di * 0 - px; ddy = cy[jj * cells + ii] - py;
          /* 巻き戻し：最短になるよう ±S ずらす */
          if (ddx > S / 2) ddx -= S; if (ddx < -S / 2) ddx += S;
          if (ddy > S / 2) ddy -= S; if (ddy < -S / 2) ddy += S;
          d = ddx * ddx + ddy * ddy;
          if (d < d1) { d2 = d1; d1 = d; id1 = jj * cells + ii; }
          else if (d < d2) { d2 = d; }
        }
        outId[k] = id1;
        outEdge[k] = (Math.sqrt(d2) - Math.sqrt(d1)) / cs;   // 0＝境界, 大＝中心
      }
    }

    function buildGround(mode) {
      var S = 512, o = mk(S), x = o.x, isH = (mode === 1);
      var cells = 7;
      var id = new Int32Array(S * S), edge = new Float32Array(S * S);
      voronoi(S, cells, 606, id, edge);
      var det = fbm(S, 90, 4, 1616);
      var grit = fbm(S, 190, 2, 2626);
      var ashF = fbm(S, 6, 4, 3636);
      var wet = fbm(S, 9, 3, 4646);

      var cG = toRGB(P.ground, [0, 0, 0]);
      var cGD = toRGB(P.groundDark, [0, 0, 0]);
      var cGL = toRGB(sh(P.ground, 1.42), [0, 0, 0]);
      var cAsh = toRGB(sh(P.ash, 1.35), [0, 0, 0]);
      var cWet = toRGB(P.concreteWet, [0, 0, 0]);
      var cStone = toRGB(P.stone, [0, 0, 0]);

      if (isH) {
        fill(o, function (px, py, u, v, out) {
          var i = py * S + px;
          /* 敷石は中央がわずかに高く、目地で切り立って落ちる */
          var e = smoothstep(0.0, 0.10, edge[i]);
          var h = 96 + e * 90 + (det[i] - 0.5) * 26 + (grit[i] - 0.5) * 20;
          out[0] = out[1] = out[2] = h;
        });
      } else {
        fill(o, function (px, py, u, v, out) {
          var i = py * S + px, cid = id[i];
          var hv = h2(cid & 255, cid >> 8, 21);
          /* 敷石ごとの明度差。上から見た面なので差が大きいほど「割れている」と読める */
          var lum = 0.70 + 0.58 * hv;
          lerp3(cGD, cGL, sat((det[i] * 0.5 + grit[i] * 0.5 - 0.22) / 0.56), out);
          if (hv > 0.82) lerp3(out, cStone, 0.35, out);     // 一部は切石の破片
          out[0] *= lum; out[1] *= lum; out[2] *= lum;
          /* 目地：谷。西日は上（画面上＝奥）から来るので手前側の壁が暗い */
          var jn = 1 - smoothstep(0.0, 0.075, edge[i]);
          lerp3(out, cGD, jn * 0.75, out);
          /* 目地の奥側の唇だけ明るく＝溝が彫れて見える */
          var above = 1 - smoothstep(0.0, 0.075, edge[((py + 3) % S) * S + px]);
          lerp3(out, cGL, sat(above - jn) * 0.45, out);
          /* 灰の堆積：谷と吹き溜まりに厚い。上向きの面なので全体にも薄く乗る。 */
          var ac = sat(ashF[i] * 1.25 - 0.18) * (0.45 + 0.55 * jn) + 0.14;
          lerp3(out, cAsh, sat(ac) * 0.62, out);
          /* 濡れ残り：低い所（目地）に溜まる */
          lerp3(out, cWet, smoothstep(0.62, 0.86, wet[i]) * jn * 0.55, out);
        });
      }

      seed(5252);
      var i;
      /* --- 着弾クレータから放射する亀裂 ----------------------------------- */
      var kx = rr(0.2, 0.8) * S, ky = rr(0.2, 0.8) * S;
      for (i = 0; i < 9; i++) {
        var ang = i / 9 * Math.PI * 2 + rr(-0.3, 0.3);
        if (isH) crack(o, kx, ky, ang, rr(70, 220), 3.0, GY(70), GY(180), 2);
        else crack(o, kx, ky, ang, rr(70, 220), 3.0, P.groundDark, sh(P.ash, 1.5), 2);
      }
      if (isH) {
        var gr = x.createRadialGradient(kx, ky, 0, kx, ky, 60);
        gr.addColorStop(0, GY(56)); gr.addColorStop(0.7, GY(104)); gr.addColorStop(1, GYA(128, 0));
        x.fillStyle = gr; x.beginPath(); x.arc(kx, ky, 60, 0, Math.PI * 2); x.fill();
      } else {
        x.save();
        var gc = x.createRadialGradient(kx, ky, 0, kx, ky, 68);
        gc.addColorStop(0, CA(P.grime, 0.62));
        gc.addColorStop(0.55, CA(P.groundDark, 0.35));
        gc.addColorStop(1, CA(P.groundDark, 0));
        x.fillStyle = gc; x.beginPath(); x.arc(kx, ky, 68, 0, Math.PI * 2); x.fill();
        x.restore();
      }

      /* --- 瓦礫片：上から見た小片。西日は上から来るので影は下（手前）に落ちる */
      seed(7878);
      for (i = 0; i < 340; i++) {
        (function (cx, cy, rd, hv) {
          tiled(o, function () {
            x.save();
            if (isH) {
              x.fillStyle = GYA(200, 0.75);
              x.beginPath(); x.ellipse(cx, cy, rd, rd * 0.7, hv * 6.28, 0, Math.PI * 2); x.fill();
            } else {
              x.fillStyle = CA(P.grime, 0.40);      // 影を先に、少し下へずらして置く
              x.beginPath(); x.ellipse(cx + rd * 0.25, cy + rd * 0.55, rd, rd * 0.7, hv * 6.28, 0, Math.PI * 2); x.fill();
              x.fillStyle = CA(sh(hv > 0.6 ? P.concrete : P.stone, 1.05 + hv * 0.35), 0.85);
              x.beginPath(); x.ellipse(cx, cy, rd, rd * 0.7, hv * 6.28, 0, Math.PI * 2); x.fill();
              x.fillStyle = CA(sh(P.plaster, 1.35), 0.35);   // 上向きの割れ肌が光る
              x.beginPath(); x.ellipse(cx - rd * 0.15, cy - rd * 0.25, rd * 0.55, rd * 0.35, hv * 6.28, 0, Math.PI * 2); x.fill();
            }
            x.restore();
          });
        })(rnd() * S, rnd() * S, rr(1.4, 5.2), rnd());
      }

      if (!isH) {
        /* --- 引き摺り跡／踏み跡：灰の上に付いた線。人がいた証拠になる ---- */
        seed(9494);
        x.save();
        x.lineCap = 'round';
        for (i = 0; i < 22; i++) {
          var sx = rnd() * S, sy = rnd() * S, an = rr(0, 6.28), ln = rr(30, 140);
          x.strokeStyle = CA(P.groundDark, rr(0.10, 0.28));
          x.lineWidth = rr(3, 12);
          x.beginPath(); x.moveTo(sx, sy);
          x.quadraticCurveTo(sx + Math.cos(an) * ln * 0.5 + rr(-20, 20), sy + Math.sin(an) * ln * 0.5 + rr(-20, 20),
            sx + Math.cos(an) * ln, sy + Math.sin(an) * ln);
          x.stroke();
        }
        x.restore();
        blend(o, greyCanvas(S, ctr(fbm(S, 4, 4, 2323), 1.35, 0.5), 0.60, 1.05), 'multiply', 0.5);
        blend(o, greyCanvas(S, fbm(S, 210, 2, 5757), 0.0, 1.0), 'overlay', 0.10);
      } else {
        blend(o, greyCanvas(S, fbm(S, 220, 2, 5757), 0.32, 0.68), 'overlay', 0.4);
      }
      return o;
    }

    /* =======================================================================
       12. 布（帆布・当て布・裂けと焼け穴）
       ==================================================================== */
    function buildCloth() {
      var S = 512, o = mk(S), x = o.x;
      var det = fbm(S, 120, 3, 1818);
      var dirt = fbm(S, 8, 4, 2828);
      var TH = 6;                                  // 糸のピッチ（px）
      var cC = toRGB(P.playerCloth, [0, 0, 0]);
      var cCD = toRGB(sh(P.playerCloth, 0.52), [0, 0, 0]);
      var cCL = toRGB(sh(P.playerCloth, 1.32), [0, 0, 0]);
      var cGr = toRGB(P.grime, [0, 0, 0]);
      var cAsh = toRGB(sh(P.ash, 1.3), [0, 0, 0]);

      fill(o, function (px, py, u, v, out) {
        var i = py * S + px;
        /* 平織り：縦糸と横糸が交互に上に来る。糸1本は断面が丸いので中央が明るい。 */
        var cxn = (px % TH) / TH, cyn = (py % TH) / TH;
        var wi = Math.floor(px / TH), wj = Math.floor(py / TH);
        var over = ((wi + wj) % 2) === 0;          // true = 縦糸が上
        var round = over ? (1 - Math.abs(cxn - 0.5) * 2) : (1 - Math.abs(cyn - 0.5) * 2);
        round = Math.pow(round, 0.55);
        var depth = over ? (1 - Math.abs(cyn - 0.5) * 2) : (1 - Math.abs(cxn - 0.5) * 2);
        var lum = 0.62 + 0.5 * round - 0.16 * (1 - depth);
        var yarn = 0.86 + 0.28 * h2(wi, wj, 44);   // 糸ごとの染めムラ
        lerp3(cCD, cCL, sat((det[i] - 0.25) / 0.5), out);
        var k = lum * yarn;
        out[0] *= k; out[1] *= k; out[2] *= k;
        /* 汚れ：裾（下）ほど濃い。上面には灰が乗る。 */
        lerp3(out, cGr, sat(dirt[i] * 0.9 - 0.18) * (0.22 + 0.55 * v) * 0.85, out);
        lerp3(out, cAsh, sat(0.55 - dirt[i]) * 0.22 * (1 - v * 0.6), out);
      });

      seed(3939);
      var i;
      /* --- 縫い目：二本のステッチ。布であることの一番速い手がかり -------- */
      function stitch(y0) {
        x.save();
        x.strokeStyle = CA(P.grime, 0.45); x.lineWidth = 2.0;
        x.setLineDash([7, 6]);
        x.beginPath(); x.moveTo(0, y0); x.lineTo(S, y0); x.stroke();
        x.strokeStyle = CA(sh(P.playerCloth, 1.5), 0.30); x.lineWidth = 1.2;
        x.beginPath(); x.moveTo(0, y0 - 1.6); x.lineTo(S, y0 - 1.6); x.stroke();
        x.setLineDash([]);
        x.strokeStyle = CA(P.grime, 0.22); x.lineWidth = 6;
        x.beginPath(); x.moveTo(0, y0 + 5); x.lineTo(S, y0 + 5); x.stroke();
        x.restore();
      }
      stitch(S * 0.28); stitch(S * 0.28 + 9);
      stitch(S * 0.79); stitch(S * 0.79 + 9);

      /* --- 裂け目：糸がほつれて渡る。穴は真っ黒ではなく奥の影の色 -------- */
      for (i = 0; i < 3; i++) {
        (function (cx, cy, ln, an) {
          tiled(o, function () {
            var k, hw;
            x.save();
            x.translate(cx, cy); x.rotate(an);
            x.fillStyle = CA(sh(P.grime, 0.7), 0.92);
            x.beginPath();
            for (k = 0; k <= 20; k++) { hw = Math.sin(k / 20 * Math.PI) * rr(4, 11); x.lineTo(-ln / 2 + ln * k / 20, -hw); }
            for (k = 20; k >= 0; k--) { hw = Math.sin(k / 20 * Math.PI) * rr(4, 11); x.lineTo(-ln / 2 + ln * k / 20, hw); }
            x.closePath(); x.fill();
            /* ほつれ糸：穴を横切る数本。これが無いと単なる黒い染みに見える。 */
            x.strokeStyle = CA(sh(P.playerCloth, 1.25), 0.75); x.lineWidth = 1.4;
            for (k = 0; k < 14; k++) {
              var tx = -ln / 2 + rnd() * ln;
              x.beginPath(); x.moveTo(tx, -12); x.lineTo(tx + rr(-3, 3), 12); x.stroke();
            }
            x.restore();
          });
        })(rnd() * S, rnd() * S, rr(40, 120), rr(0, 6.28));
      }

      /* --- 焼け穴：縁が炭化して硬く縮む。内側から 黒 → 焦茶 → 元色 ------ */
      seed(5858);
      for (i = 0; i < 16; i++) {
        (function (cx, cy, rd) {
          tiled(o, function () {
            var gr = x.createRadialGradient(cx, cy, 0, cx, cy, rd * 2.4);
            gr.addColorStop(0, CA(sh(P.grime, 0.5), 0.95));
            gr.addColorStop(0.34, CA(P.grime, 0.9));
            gr.addColorStop(0.55, CA(mix(P.grime, P.rust, 0.45), 0.55));
            gr.addColorStop(1, CA(mix(P.grime, P.rust, 0.45), 0));
            x.fillStyle = gr;
            x.beginPath(); x.arc(cx, cy, rd * 2.4, 0, Math.PI * 2); x.fill();
          });
        })(rnd() * S, rnd() * S, rr(2.5, 9));
      }

      blend(o, greyCanvas(S, ctr(fbm(S, 5, 4, 6767), 1.3, 0.5), 0.64, 1.04), 'multiply', 0.42);
      return o;
    }

    /* =======================================================================
       13. 汚れ（乗算オーバーレイ用）
       白＝素通し、黒＝汚れ。方向を持たない汚れは描かない：
       縁の溜まり／縦の垂れ／裾の跳ね／煤の広がり、の4つだけで構成する。
       ==================================================================== */
    function buildGrime() {
      var S = 256, o = mk(S), x = o.x;
      var White = sh(P.uiInk, 2.2);               // palette から作った実質の白
      var soft = fbm(S, 5, 4, 7474);
      var fineF = fbm(S, 60, 3, 8585);

      fill(o, function (px, py, u, v, out) {
        var i = py * S + px;
        /* 面の周縁ほど汚れる（隅に埃と水が溜まる）。タイル境界＝面の境界とみなす。 */
        var ex = Math.min(u, 1 - u), ey = Math.min(v, 1 - v);
        var eg = 1 - smoothstep(0.0, 0.22, Math.min(ex, ey));
        var m = 1
          - eg * 0.30
          - sat(soft[i] * 1.2 - 0.35) * 0.30
          - sat(fineF[i] - 0.55) * 0.16
          - Math.pow(v, 3.2) * 0.26;              // 裾の跳ね
        m = sat(m * 0.72 + 0.28);                 // 下限を作り、乗算で潰しすぎない
        out[0] = R8(White) * m; out[1] = G8(White) * m; out[2] = B8(White) * m;
      });

      seed(1591);
      var i;
      x.save();
      x.globalCompositeOperation = 'multiply';
      for (i = 0; i < 34; i++) {
        (function (cx) {
          tiled(o, function () { drip(o, cx, rr(-10, S * 0.35), rr(50, 220), rr(2, 10), P.grime, rr(0.10, 0.32), 0.24); });
        })(rnd() * S);
      }
      /* 煤の広がり：一点から放射状に薄く */
      for (i = 0; i < 4; i++) {
        var sx = rnd() * S, sy = rnd() * S, rd = rr(30, 90);
        var gr = x.createRadialGradient(sx, sy, 0, sx, sy, rd);
        gr.addColorStop(0, CA(P.grime, 0.30));
        gr.addColorStop(1, CA(P.grime, 0));
        x.fillStyle = gr; x.beginPath(); x.arc(sx, sy, rd, 0, Math.PI * 2); x.fill();
      }
      x.restore();
      return o;
    }

    /* =======================================================================
       14. ノイズ（シェーダ用ユーティリティ）
       R = 全体の斑（低〜中周波 fBm）／G = 細粒（高周波）／B = 縦に流れる場。
       B を雨だれや錆の流れのマスクに使えるよう、意図的に異方性にしてある。
       彩度が出ないよう3チャンネルの平均と分散を揃えてある（画面は灰であるべき）。
       ==================================================================== */
    function buildNoise() {
      var S = 256, o = mk(S);
      var a = fbm(S, 8, 5, 1001);
      var b = fbm(S, 64, 3, 2002);
      var c = fbm2(S, 24, 3, 4, 3003);
      fill(o, function (px, py, u, v, out) {
        var i = py * S + px;
        var base = (a[i] + b[i] + c[i]) / 3;
        out[0] = (base * 0.45 + a[i] * 0.55) * 255;
        out[1] = (base * 0.45 + b[i] * 0.55) * 255;
        out[2] = (base * 0.45 + c[i] * 0.55) * 255;
      });
      return o;
    }

    /* =======================================================================
       15. 弾痕デカール（透過）
       中心＝貫通孔の闇、その周り＝剥落して露出した骨材（明）、外＝放射亀裂と粉塵。
       円ではなく星形に崩す。円い穴は必ず嘘に見える。
       ==================================================================== */
    function buildDecalHole() {
      var S = 512, o = mk(S), x = o.x, cx = S / 2, cy = S / 2;
      var tear = fbm(S, 9, 4, 1234);
      var det = fbm(S, 80, 3, 5678);
      var cCore = toRGB(sh(P.grime, 0.45), [0, 0, 0]);
      var cFace = toRGB(sh(P.concrete, 1.30), [0, 0, 0]);
      var cMid = toRGB(P.concreteDark, [0, 0, 0]);
      var cDust = toRGB(sh(P.ash, 1.45), [0, 0, 0]);

      fillA(o, function (px, py, u, v, out) {
        var i = py * S + px;
        var dx = px - cx, dy = py - cy, r = Math.sqrt(dx * dx + dy * dy) / (S * 0.5);
        var wob = 0.72 + 0.56 * tear[i];          // 半径を場所ごとに揺らす＝星形の破断
        var rr2 = r / wob;
        if (rr2 > 1.0) { out[3] = 0; return; }

        var core = 1 - smoothstep(0.10, 0.20, rr2);   // 貫通孔
        var spall = 1 - smoothstep(0.20, 0.46, rr2);  // 剥落した鉢状の縁
        var dust = 1 - smoothstep(0.40, 1.0, rr2);    // 粉塵の輪

        lerp3(cDust, cMid, 0.35 + 0.4 * det[i], out);
        lerp3(out, cFace, spall * (0.55 + 0.4 * det[i]), out);
        /* 鉢の上側の内壁は影、下側の内壁は西日を拾って明るい */
        var vert = (dy / (S * 0.5)) / (rr2 + 0.001);
        lerp3(out, cCore, spall * sat(-vert) * 0.55, out);
        lerp3(out, cFace, spall * sat(vert) * 0.30, out);
        lerp3(out, cCore, core * 0.95, out);

        var a = sat(core * 1.0 + spall * 0.92 + dust * 0.36 * (0.4 + 0.6 * det[i]));
        out[3] = a * 255;
      });

      /* --- 放射亀裂：孔の縁から外へ。外ほど細く、途中で枝分かれ ---------- */
      seed(4321);
      var i;
      for (i = 0; i < 9; i++) {
        var ang = i / 9 * Math.PI * 2 + rr(-0.35, 0.35);
        crack(o, cx + Math.cos(ang) * S * 0.11, cy + Math.sin(ang) * S * 0.11,
          ang, rr(S * 0.12, S * 0.34), 3.0, sh(P.grime, 0.6), sh(P.concrete, 1.3), 2);
      }
      /* --- 飛び散った小片の欠け ------------------------------------------- */
      for (i = 0; i < 26; i++) {
        var an2 = rr(0, 6.28), rd2 = rr(S * 0.13, S * 0.36);
        chip(o, cx + Math.cos(an2) * rd2, cy + Math.sin(an2) * rd2, rr(2, 7),
          sh(P.concrete, 1.25), P.grime, 0.55);
      }
      /* 縁を必ず透明に戻す（タイル境界に硬い切り口を残さない） */
      x.save();
      x.globalCompositeOperation = 'destination-in';
      var gr = x.createRadialGradient(cx, cy, S * 0.30, cx, cy, S * 0.5);
      gr.addColorStop(0, GYA(255, 1)); gr.addColorStop(1, GYA(255, 0));
      x.fillStyle = gr; x.fillRect(0, 0, S, S);
      x.restore();
      return o;
    }

    /* =======================================================================
       16. 焦げ跡デカール（透過）
       翌日の煤なので暖色は残らない。中心は爆風で吹き払われ、環状に濃く残る。
       ==================================================================== */
    function buildDecalScorch() {
      var S = 256, o = mk(S), x = o.x, cx = S / 2, cy = S / 2;
      var tear = fbm(S, 6, 5, 2468);
      var fineF = fbm(S, 40, 3, 1357);
      var cSoot = toRGB(sh(P.grime, 0.7), [0, 0, 0]);
      var cEdge = toRGB(mix(P.grime, P.rust, 0.40), [0, 0, 0]);

      fillA(o, function (px, py, u, v, out) {
        var i = py * S + px;
        var dx = px - cx, dy = py - cy, r = Math.sqrt(dx * dx + dy * dy) / (S * 0.5);
        var wob = 0.55 + 0.62 * tear[i];
        var rr2 = r / wob;
        if (rr2 > 1.0) { out[3] = 0; return; }
        /* 中心は爆風で掃かれて薄い。r≈0.35 が最も濃い環になる。 */
        var ring = smoothstep(0.0, 0.30, rr2) * (1 - smoothstep(0.32, 1.0, rr2));
        var a = ring * (0.55 + 0.55 * fineF[i]);
        lerp3(cSoot, cEdge, smoothstep(0.25, 0.95, rr2), out);
        out[3] = sat(a) * 210;
      });

      /* --- 爆風の吹き出し：一方向に長い舌。爆源の向きが読めるようにする -- */
      seed(8642);
      var i, base = rr(0, 6.28);
      x.save();
      for (i = 0; i < 30; i++) {
        var an = base + rr(-1.0, 1.0), len = rr(S * 0.18, S * 0.48), w = rr(1.5, 7);
        var gr = x.createLinearGradient(cx, cy, cx + Math.cos(an) * len, cy + Math.sin(an) * len);
        gr.addColorStop(0, CA(sh(P.grime, 0.8), 0.42));
        gr.addColorStop(1, CA(sh(P.grime, 0.8), 0));
        x.strokeStyle = gr; x.lineWidth = w; x.lineCap = 'round';
        x.beginPath();
        x.moveTo(cx + Math.cos(an) * S * 0.10, cy + Math.sin(an) * S * 0.10);
        x.lineTo(cx + Math.cos(an) * len, cy + Math.sin(an) * len);
        x.stroke();
      }
      x.restore();
      x.save();
      x.globalCompositeOperation = 'destination-in';
      var g2 = x.createRadialGradient(cx, cy, S * 0.22, cx, cy, S * 0.5);
      g2.addColorStop(0, GYA(255, 1)); g2.addColorStop(1, GYA(255, 0));
      x.fillStyle = g2; x.fillRect(0, 0, S, S);
      x.restore();
      return o;
    }

    /* =======================================================================
       17. 組み立て
       ==================================================================== */
    return {
      concrete: fin(buildConcrete(0), true),
      concreteBump: fin(buildConcrete(1), false),
      plaster: fin(buildPlaster(), true),
      stone: fin(buildStone(), true),
      brick: fin(buildBrick(), true),
      metal: fin(buildMetal(), true),
      rust: fin(buildRust(), true),
      ground: fin(buildGround(0), true),
      groundBump: fin(buildGround(1), false),
      cloth: fin(buildCloth(), true),
      grime: fin(buildGrime(), true),
      noise: fin(buildNoise(), false),
      decalHole: fin(buildDecalHole(), true),
      decalScorch: fin(buildDecalScorch(), true)
    };
  };
})(typeof window !== 'undefined' ? window : globalThis);

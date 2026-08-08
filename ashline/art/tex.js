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

   3) 太陽は低い西日で、光は常に上から来る。よって彫りの表現はすべて
      「上の縁が明るく、下の縁が暗い」で統一する。混ぜると立体が壊れる。

   4) 彩度。palette の注記どおり「本当に彩度が高いのは火だけ」。素材色は必ず
      P.ash / P.grime / P.concreteDark 側へ mix して濁らせてから使う。
      特に煉瓦と錆は生の値のままだと画面で浮く（一度出して確認済み）。

   5) 速度。fBm はピクセル毎にハッシュを叩かず、格子を作って補間で持ち上げる
      （addOctave）。14枚の生成が 1 秒台に収まる。

   解像度：512 が 11 枚、256 が 3 枚。合計 3,080,192 px（契約の 6M 以下）。
   色は ASH.palette からのみ。派生は ASH.shade / lerp のみで作る。
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

    /* 格子ハッシュ。整数座標 -> [0,1)。imul で 32bit に収めて分布を安定させる。 */
    function h2(i, j, s) {
      var n = Math.imul(i | 0, 374761393) ^ Math.imul(j | 0, 668265263) ^ Math.imul(s | 0, 1442695040);
      n = Math.imul(n ^ (n >>> 13), 1274126177);
      n = n ^ (n >>> 16);
      return (n >>> 0) / 4294967296;
    }

    /* =======================================================================
       1. 色ヘルパ
       生の16進は書かない。palette 値どうしの補間と ASH.shade だけで色を作る。
       ==================================================================== */
    function sh(hex, m) { return ASH.shade(T, hex, m).getHex(); }
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
    function scl(o, k) { o[0] *= k; o[1] *= k; o[2] *= k; }
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

    /* ボロノイ。敷石の割付と、錆の鱗（スケール）の割付に使う。
       outEdge は「境界からの距離」で、0 が継ぎ目、大きいほど面の中心。 */
    function voronoi(S, cells, sd, outId, outEdge) {
      var cs = S / cells, n = cells * cells;
      var cx = new Float32Array(n), cy = new Float32Array(n), i, j;
      for (j = 0; j < cells; j++) for (i = 0; i < cells; i++) {
        cx[j * cells + i] = (i + 0.16 + 0.68 * h2(i, j, sd)) * cs;
        cy[j * cells + i] = (j + 0.16 + 0.68 * h2(i, j, sd + 7)) * cs;
      }
      var px, py, gi, gj, di, dj, ii, jj, d1, d2, id1, dx, dy, d, k = 0, H = S * 0.5;
      for (py = 0; py < S; py++) for (px = 0; px < S; px++, k++) {
        gi = Math.floor(px / cs); gj = Math.floor(py / cs);
        d1 = 1e9; d2 = 1e9; id1 = 0;
        for (dj = -1; dj <= 1; dj++) for (di = -1; di <= 1; di++) {
          ii = (gi + di + cells) % cells; jj = (gj + dj + cells) % cells;
          dx = cx[jj * cells + ii] - px; dy = cy[jj * cells + ii] - py;
          if (dx > H) dx -= S; if (dx < -H) dx += S;
          if (dy > H) dy -= S; if (dy < -H) dy += S;
          d = dx * dx + dy * dy;
          if (d < d1) { d2 = d1; d1 = d; id1 = jj * cells + ii; }
          else if (d < d2) { d2 = d; }
        }
        outId[k] = id1;
        outEdge[k] = (Math.sqrt(d2) - Math.sqrt(d1)) / cs;
      }
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
    /* グレイのノイズ板。multiply / overlay で全体に一枚被せるのに使う。 */
    function greyCanvas(S, fld, lo, hi) {
      var cv = document.createElement('canvas'); cv.width = S; cv.height = S;
      var cx = cv.getContext('2d'), id = cx.createImageData(S, S), d = id.data, i, j = 0, v;
      for (i = 0; i < fld.length; i++) {
        v = (lo + (hi - lo) * fld[i]) * 255;
        d[j] = d[j + 1] = d[j + 2] = (v < 0 ? 0 : (v > 255 ? 255 : v)); d[j + 3] = 255; j += 4;
      }
      cx.putImageData(id, 0, 0);
      return cv;
    }
    /* アルファだけを持つ板。destination-in で「ちぎれた縁」を作るのに使う。 */
    function maskCanvas(S, fld, lo, hi) {
      var cv = document.createElement('canvas'); cv.width = S; cv.height = S;
      var cx = cv.getContext('2d'), id = cx.createImageData(S, S), d = id.data, i, j = 0, v;
      for (i = 0; i < fld.length; i++) {
        v = (lo + (hi - lo) * fld[i]) * 255;
        d[j] = d[j + 1] = d[j + 2] = 255;
        d[j + 3] = (v < 0 ? 0 : (v > 255 ? 255 : v)); j += 4;
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
    /* 彩度を落とす最終処理。palette の灰（ash）を薄く被せる。
       ACES は彩度を上げないので、素材が画面で浮かないよう元から濁らせておく。 */
    function dull(o, hex, a) {
      o.x.save(); o.x.globalAlpha = a; o.x.fillStyle = C(hex);
      o.x.fillRect(0, 0, o.S, o.S); o.x.restore();
    }
    /* タイル境界をまたぐ描画。9回描くが、毎回 乱数を巻き戻すので
       境界の左右で同じ図形が描かれ、継ぎ目が消える。 */
    function tiled(o, fn) {
      var d = [-1, 0, 1], i, j, S = o.S, sv = _s;
      for (i = 0; i < 3; i++) for (j = 0; j < 3; j++) {
        _s = sv;
        o.x.save(); o.x.translate(d[i] * S, d[j] * S); fn(); o.x.restore();
      }
      _s = sv;
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
       ・上端が濃く下端で消える縦グラデーション
       ・輪郭を蛇行させる。直線の帯は「ノイズ」、蛇行させると「流れ」に見える
       ・fade=true で頭を尖らせる。縁に接続しない筋を平らな頭で描くと
         「垂れ」ではなく「棒」に見える（初回の出力で実際にそう見えた）
       ------------------------------------------------------------------- */
    function ribbon(x, pts, mw) {
      var k;
      x.beginPath();
      x.moveTo(pts[0][0] - pts[0][2] * mw, pts[0][1]);
      for (k = 1; k < pts.length; k++) x.lineTo(pts[k][0] - pts[k][2] * mw, pts[k][1]);
      for (k = pts.length - 1; k >= 0; k--) x.lineTo(pts[k][0] + pts[k][2] * mw, pts[k][1]);
      x.closePath(); x.fill();
    }
    function drip(o, cx0, y0, len, w, hex, alpha, wob, fade) {
      var x = o.x, N = 18, k, pts = [], sway = 0, dsw = 0, hw, f, head;
      for (k = 0; k <= N; k++) {
        f = k / N;
        dsw += rr(-1, 1) * wob;
        if (dsw > 1.4) dsw = 1.4; if (dsw < -1.4) dsw = -1.4;
        sway += dsw;
        head = fade ? smoothstep(0, 0.10, f) : smoothstep(-0.02, 0.015, f);
        hw = w * 0.5 * head * (1 - 0.55 * f) * (0.7 + 0.6 * rnd());
        pts.push([cx0 + sway, y0 + len * f, hw]);
      }
      var gr = x.createLinearGradient(0, y0, 0, y0 + len);
      gr.addColorStop(0, CA(hex, fade ? 0 : alpha));
      gr.addColorStop(0.12, CA(hex, alpha));
      gr.addColorStop(0.45, CA(hex, alpha * 0.60));
      gr.addColorStop(0.80, CA(hex, alpha * 0.22));
      gr.addColorStop(1, CA(hex, 0));
      x.save();
      x.fillStyle = gr;
      x.globalAlpha = 0.40; ribbon(x, pts, 2.8);   // 滲みの外周
      x.globalAlpha = 0.72; ribbon(x, pts, 1.0);   // 本体
      x.globalAlpha = 1.00; ribbon(x, pts, 0.32);  // 芯
      x.restore();
    }
    /* 縁から一斉に垂らす。長さを大きくばらけさせないと「簾」に見える。
       wmax は筋の最大幅。目地の細かい素材で太くすると「半透明の板」に見える。 */
    function dripRow(o, y0, len, count, darkHex, paleHex, alpha, wmax) {
      var i, S = o.S;
      if (wmax === undefined) wmax = 8.0;
      for (i = 0; i < count; i++) {
        var cx = rnd() * S;
        var pale = rnd() < 0.20;                  // 白華（石灰分の析出）は少数派
        var L = len * (rnd() < 0.25 ? rr(1.0, 2.2) : rr(0.18, 0.8));
        var w = rr(1.4, wmax);
        var a = (pale ? alpha * 0.6 : alpha) * rr(0.45, 1.0);
        tiled(o, (function (cx, L, w, pale, a) {
          return function () { drip(o, cx, y0, L, w, pale ? paleHex : darkHex, a, 0.30, false); };
        })(cx, L, w, pale, a));
      }
    }

    /* --- 段差（水平の縁）--------------------------------------------------
       上に灰の唇（明）、下に影（暗）。これ1本で「そこに水平面がある」と読める。
       ------------------------------------------------------------------- */
    function ledge(o, y, ashHex, shadowHex, lipA, shA, thick) {
      var x = o.x, S = o.S;
      x.save();
      var g0 = x.createLinearGradient(0, y - 7, 0, y + thick);
      g0.addColorStop(0, CA(shadowHex, 0));
      g0.addColorStop(1, CA(shadowHex, shA));
      x.fillStyle = g0; x.fillRect(0, y - 7, S, thick + 7);
      var gr = x.createLinearGradient(0, y + thick, 0, y + thick + 6);
      gr.addColorStop(0, CA(ashHex, lipA));       // 段差の上向き面＝灰が溜まる
      gr.addColorStop(1, CA(ashHex, 0));
      x.fillStyle = gr; x.fillRect(0, y + thick, S, 6);
      x.restore();
    }

    /* --- 欠け（チッピング）------------------------------------------------
       角ほど摩耗する。破断面は新しいので周りより明るく、その上辺に影が落ちる。
       ------------------------------------------------------------------- */
    function chip(o, cx, cy, r, faceHex, shadowHex, a) {
      var x = o.x, n = 5 + Math.floor(rnd() * 4), k, ang, rad;
      x.save();
      x.beginPath();
      for (k = 0; k < n; k++) {
        ang = (k / n) * Math.PI * 2 + rr(-0.35, 0.35);
        rad = r * rr(0.40, 1.20);
        if (k === 0) x.moveTo(cx + Math.cos(ang) * rad, cy + Math.sin(ang) * rad);
        else x.lineTo(cx + Math.cos(ang) * rad, cy + Math.sin(ang) * rad);
      }
      x.closePath();
      x.fillStyle = CA(faceHex, a); x.fill();     // 破断面（明）
      x.save(); x.clip();
      var gr = x.createLinearGradient(0, cy - r, 0, cy + r);
      gr.addColorStop(0, CA(shadowHex, a * 0.9)); // 上の縁は元の面が庇になり暗い
      gr.addColorStop(0.5, CA(shadowHex, 0));
      x.fillStyle = gr; x.fillRect(cx - r * 1.4, cy - r * 1.4, r * 2.8, r * 2.8);
      x.restore();
      x.restore();
    }

    /* --- 亀裂 --------------------------------------------------------------
       枝分かれしながら細くなる折れ線。上側に明るい線を1px添えると彫りに見える。
       wander を小さくすると衝撃亀裂（直線的）、大きくすると乾燥亀裂になる。
       ------------------------------------------------------------------- */
    function crack(o, x0, y0, ang, len, wid, darkHex, liteHex, depth, wander) {
      var x = o.x, px = x0, py = y0, k, steps = Math.max(4, Math.floor(len / 9)), sl = len / steps;
      if (wander === undefined) wander = 0.32;
      x.save();
      x.lineCap = 'round';
      for (k = 0; k < steps; k++) {
        ang += rr(-wander, wander);
        var nx = px + Math.cos(ang) * sl, ny = py + Math.sin(ang) * sl;
        var w = wid * (1 - k / steps);
        x.strokeStyle = CA(liteHex, 0.30); x.lineWidth = w + 1.0;
        x.beginPath(); x.moveTo(px, py - 1.2); x.lineTo(nx, ny - 1.2); x.stroke();
        x.strokeStyle = CA(darkHex, 0.85); x.lineWidth = w;
        x.beginPath(); x.moveTo(px, py); x.lineTo(nx, ny); x.stroke();
        if (depth > 0 && rnd() < 0.16)
          crack(o, nx, ny, ang + rr(-0.9, 0.9), len * rr(0.18, 0.40), w * 0.6, darkHex, liteHex, depth - 1, wander);
        px = nx; py = ny;
      }
      x.restore();
    }

    /* --- 弾片痕（ポック）---------------------------------------------------
       円ではなく多角形。丸い窪みは必ず「CGの穴」に見える。
       ------------------------------------------------------------------- */
    function pock(o, cx, cy, r, coreHex, faceHex, shadowHex) {
      var x = o.x;
      chip(o, cx, cy, r * 1.15, faceHex, shadowHex, 0.85);
      x.save();
      x.fillStyle = CA(coreHex, 0.70);            // 窪みの底
      x.beginPath();
      var k, n = 6, ang, rad;
      for (k = 0; k < n; k++) {
        ang = k / n * Math.PI * 2; rad = r * rr(0.30, 0.55);
        if (k === 0) x.moveTo(cx + Math.cos(ang) * rad, cy + Math.sin(ang) * rad + r * 0.15);
        else x.lineTo(cx + Math.cos(ang) * rad, cy + Math.sin(ang) * rad + r * 0.15);
      }
      x.closePath(); x.fill();
      x.fillStyle = CA(faceHex, 0.45);            // 下の内壁が西日を拾う
      x.beginPath(); x.arc(cx, cy + r * 0.42, r * 0.38, Math.PI, Math.PI * 2, true); x.fill();
      x.restore();
    }

    /* --- 錆の滲み ----------------------------------------------------------
       鉄から下方向へ。上端は濃く、下へ行くほど広がって薄れる（水で運ばれる）。
       色は必ず ash 側へ寄せて濁らせる。生の rust は画面で発光して見える。
       ------------------------------------------------------------------- */
    var RUST_D = mix(P.rust, P.rebar, 0.42);
    var RUST_M = mix(P.rust, P.ash, 0.30);
    var RUST_L = mix(sh(P.rust, 1.25), P.ash, 0.46);
    function rustBleed(o, cx, cy, len, w, a) {
      var x = o.x, i;
      x.save();
      var gr = x.createLinearGradient(0, cy, 0, cy + len);
      gr.addColorStop(0, CA(RUST_D, a));
      gr.addColorStop(0.22, CA(RUST_M, a * 0.85));
      gr.addColorStop(0.70, CA(RUST_L, a * 0.30));
      gr.addColorStop(1, CA(RUST_L, 0));
      x.fillStyle = gr;
      x.beginPath();
      x.moveTo(cx - w * 0.34, cy);
      x.quadraticCurveTo(cx - w * 1.2, cy + len * 0.55, cx - w * 0.85, cy + len);
      x.lineTo(cx + w * 0.85, cy + len);
      x.quadraticCurveTo(cx + w * 1.2, cy + len * 0.55, cx + w * 0.34, cy);
      x.closePath(); x.fill();
      x.restore();
      for (i = 0; i < 3; i++)
        drip(o, cx + rr(-w * 0.8, w * 0.8), cy, len * rr(0.3, 1.05), rr(1.2, 3.4), RUST_M, a * 0.9, 0.24, false);
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
      var cPale = toRGB(sh(P.concrete, 1.34), [0, 0, 0]);
      var cWet = toRGB(P.concreteWet, [0, 0, 0]);

      if (isH) {
        fill(o, function (px, py, u, v, out) {
          var i = py * S + px;
          out[0] = out[1] = out[2] =
            128 + (agg[i] - 0.5) * 46 + (fine[i] - 0.5) * 26 + (big[i] - 0.5) * 18;
        });
      } else {
        fill(o, function (px, py, u, v, out) {
          var i = py * S + px;
          var t = big[i] * 0.55 + agg[i] * 0.30 + fine[i] * 0.15;
          lerp3(cDark, cPale, (t - 0.24) / 0.44, out);
          /* 下へ行くほど跳ね返りの泥で暗い。垂直面の上下が一目で読めるようにする。 */
          scl(out, 1 - 0.34 * Math.pow(v, 2.4));
          /* 濡れ残りの染み：低周波の谷にだけ溜める */
          lerp3(out, cWet, smoothstep(0.40, 0.14, big[i]) * 0.48 * (0.30 + 0.70 * v), out);
        });
      }

      seed(4211);
      var panel = 256, i, j;

      /* --- せき板の合わせ目：128px ごと。1枚の板の幅にあたる ------------- */
      for (j = 0; j < 4; j++) {
        var by = j * 128 + rr(-3, 3);
        x.save();
        if (isH) {
          x.fillStyle = GYA(100, 0.5); x.fillRect(0, by, S, 1.6);
          x.fillStyle = GYA(164, 0.32); x.fillRect(0, by + 1.6, S, 1.4);
        } else {
          x.fillStyle = CA(P.grime, 0.20); x.fillRect(0, by, S, 1.6);
          x.fillStyle = CA(sh(P.concrete, 1.34), 0.15); x.fillRect(0, by + 1.6, S, 1.6);
        }
        x.restore();
      }

      /* --- パネル継ぎ目：ノロ漏れの段差。ここが雨だれの発生源になる ------- */
      for (j = 0; j < 2; j++) {
        var py0 = j * panel, pxv = j * panel;
        if (isH) {
          x.fillStyle = GY(84); x.fillRect(0, py0 - 2.5, S, 4);
          x.fillStyle = GY(184); x.fillRect(0, py0 + 1.5, S, 3);
          x.fillStyle = GY(92); x.fillRect(pxv - 1.5, 0, 3, S);
          x.fillStyle = GY(172); x.fillRect(pxv + 1.5, 0, 2, S);
        } else {
          ledge(o, py0 - 3, sh(P.ash, 1.55), P.grime, 0.46, 0.55, 4);
          x.fillStyle = CA(P.grime, 0.34); x.fillRect(pxv - 1.5, 0, 3, S);
          x.fillStyle = CA(sh(P.concrete, 1.28), 0.22); x.fillRect(pxv + 1.5, 0, 2, S);
        }
      }

      /* --- セパレータ穴（Pコン跡）----------------------------------------
         パネル1枚に 3x3 相当を不揃いに。窪みなので上内側が影・下内側が明るい。
         穴には水が溜まるので必ず下へ短い筋を落とす。ここを描かないと嘘になる。 */
      var holes = [];
      for (j = 0; j < 3; j++) for (i = 0; i < 3; i++) {
        var hx = 85 + i * 171 + rr(-16, 16), hy = 85 + j * 171 + rr(-16, 16), hr = rr(6.5, 8.4);
        holes.push([hx, hy, hr]);
        (function (hx, hy, hr) {
          tiled(o, function () {
            if (isH) {
              var gr = x.createRadialGradient(hx, hy, 0, hx, hy, hr * 1.6);
              gr.addColorStop(0, GY(52)); gr.addColorStop(0.60, GY(88));
              gr.addColorStop(0.80, GY(192)); gr.addColorStop(1, GYA(128, 0));
              x.fillStyle = gr;
              x.beginPath(); x.arc(hx, hy, hr * 1.6, 0, Math.PI * 2); x.fill();
            } else {
              x.save();
              x.fillStyle = CA(P.grime, 0.62);            // 窪みの内側
              x.beginPath(); x.arc(hx, hy, hr, 0, Math.PI * 2); x.fill();
              x.fillStyle = CA(sh(P.concrete, 1.02), 0.88); // モルタル詰めのプラグ
              x.beginPath(); x.arc(hx, hy + 0.6, hr * 0.62, 0, Math.PI * 2); x.fill();
              var g2 = x.createLinearGradient(0, hy - hr, 0, hy + hr);
              g2.addColorStop(0, CA(P.grime, 0.62));      // 上内壁＝影
              g2.addColorStop(0.55, CA(P.grime, 0));
              x.fillStyle = g2;
              x.beginPath(); x.arc(hx, hy, hr, 0, Math.PI * 2); x.fill();
              x.fillStyle = CA(sh(P.concrete, 1.42), 0.55);// 下内壁＝西日の照り返し
              x.beginPath(); x.arc(hx, hy + hr * 0.42, hr * 0.52, 0, Math.PI); x.fill();
              x.restore();
            }
          });
        })(hx, hy, hr);
      }

      /* --- 剥落（爆裂）：鉄筋が錆びて膨張し、かぶりコンクリートが飛ぶ ----- */
      var spalls = [];
      for (i = 0; i < 5; i++) {
        var sx0 = rnd() * S, sy0 = rnd() * S, sr = rr(18, 46);
        spalls.push([sx0, sy0, sr]);
        (function (sx0, sy0, sr) {
          tiled(o, function () {
            var n = 13, k, ang, rad;
            x.save();
            x.beginPath();
            for (k = 0; k < n; k++) {
              ang = (k / n) * Math.PI * 2;
              rad = sr * (0.50 + 0.62 * h2(k, Math.floor(sx0), 7));
              if (k === 0) x.moveTo(sx0 + Math.cos(ang) * rad, sy0 + Math.sin(ang) * rad * 0.78);
              else x.lineTo(sx0 + Math.cos(ang) * rad, sy0 + Math.sin(ang) * rad * 0.78);
            }
            x.closePath();
            if (isH) {
              x.fillStyle = GY(80); x.fill();
              x.save(); x.clip();
              var gh = x.createLinearGradient(0, sy0 - sr, 0, sy0 + sr);
              gh.addColorStop(0, GY(40)); gh.addColorStop(1, GY(116));
              x.fillStyle = gh; x.fillRect(sx0 - sr * 2, sy0 - sr * 2, sr * 4, sr * 4);
              x.restore();
              x.strokeStyle = GY(196); x.lineWidth = 2.2; x.stroke();
            } else {
              x.fillStyle = CA(sh(P.concreteDark, 1.02), 0.94); // 内部＝骨材の断面
              x.save(); x.clip();
              var gc = x.createLinearGradient(0, sy0 - sr, 0, sy0 + sr);
              gc.addColorStop(0, CA(P.grime, 0.85));      // 上壁は庇になり深く暗い
              gc.addColorStop(0.5, CA(P.grime, 0.12));
              gc.addColorStop(1, CA(sh(P.concrete, 1.30), 0.40));
              x.fillStyle = gc; x.fillRect(sx0 - sr * 2, sy0 - sr * 2, sr * 4, sr * 4);
              /* 骨材の粒が断面に出る */
              for (k = 0; k < 40; k++) {
                x.fillStyle = CA(sh(P.concrete, rr(0.6, 1.5)), 0.55);
                x.beginPath();
                x.arc(sx0 + rr(-sr, sr), sy0 + rr(-sr, sr), rr(1, 3.4), 0, Math.PI * 2); x.fill();
              }
              /* 露出鉄筋：水平方向に1本。錆が下へ滲む */
              if (sr > 28) {
                x.fillStyle = CA(P.rebar, 0.95);
                x.fillRect(sx0 - sr, sy0 + sr * 0.05, sr * 2, 4.4);
                x.fillStyle = CA(RUST_M, 0.6);
                x.fillRect(sx0 - sr, sy0 + sr * 0.05, sr * 2, 1.9);
              }
              x.restore();
              x.strokeStyle = CA(sh(P.concrete, 1.40), 0.6); x.lineWidth = 2.4; x.stroke();
            }
            x.restore();
          });
        })(sx0, sy0, sr);
      }

      /* --- 角の欠けと弾片痕：色にも高さにも入れる（片方だけだと嘘になる）- */
      seed(661);
      for (j = 0; j < 2; j++) for (i = 0; i < 2; i++) {
        var k2, cxx = i * panel, cyy = j * panel;
        for (k2 = 0; k2 < 8; k2++) {
          (function (cx, cy, rd) {
            tiled(o, function () {
              if (isH) chip(o, cx, cy, rd, GY(178), GY(78), 0.8);
              else chip(o, cx, cy, rd, sh(P.concrete, 1.34), P.grime, 0.85);
            });
          })(cxx + rr(-18, 18), cyy + rr(-16, 16), rr(3, 13));
        }
      }
      seed(313);
      var bx = rr(0, S), byy = rr(0, S);
      for (i = 0; i < 26; i++) {
        (function (cx, cy, rd) {
          tiled(o, function () {
            if (isH) pock(o, cx, cy, rd, GY(62), GY(184), GY(80));
            else pock(o, cx, cy, rd, P.grime, sh(P.concrete, 1.40), P.concreteDark);
          });
        })(bx + rr(-200, 200), byy + rr(-100, 100), rr(2.6, 8.5));
      }

      if (!isH) {
        /* --- 雨だれ：パネル継ぎ目の唇から一斉に。長さを大きくばらけさせる - */
        seed(8823);
        dripRow(o, 4, 190, 30, P.grime, sh(P.plaster, 1.40), 0.42);
        dripRow(o, panel + 4, 190, 30, P.grime, sh(P.plaster, 1.40), 0.42);
        /* セパ穴からの垂れ。必ず穴に接続する。 */
        for (i = 0; i < holes.length; i++) {
          (function (h) {
            tiled(o, function () { drip(o, h[0], h[1] + h[2] * 0.5, rr(24, 130), rr(2.5, 6), P.grime, 0.42, 0.18, false); });
          })(holes[i]);
        }
        /* 剥落からの錆の流れ */
        for (i = 0; i < spalls.length; i++) if (spalls[i][2] > 28) {
          (function (s) {
            tiled(o, function () { rustBleed(o, s[0], s[1] + s[2] * 0.38, rr(70, 170), s[2] * 0.6, 0.44); });
          })(spalls[i]);
        }
        /* --- 亀裂：剥落から伸びる（衝撃亀裂なので直線寄り）--------------- */
        seed(5501);
        for (i = 0; i < spalls.length; i++)
          crack(o, spalls[i][0], spalls[i][1], rr(0, 6.28), rr(60, 150), 2.2, P.grime, sh(P.concrete, 1.30), 2, 0.22);

        blend(o, greyCanvas(S, ctr(fbm(S, 6, 4, 4404), 1.6, 0.5), 0.50, 1.02), 'multiply', 0.58);
        blend(o, greyCanvas(S, fbm(S, 200, 2, 6602), 0.0, 1.0), 'overlay', 0.11);
      } else {
        blend(o, greyCanvas(S, fbm(S, 220, 2, 6602), 0.26, 0.74), 'overlay', 0.45);
      }
      return o;
    }

    /* =======================================================================
       6. 漆喰（剥離して下地が覗く）
       3層構造：仕上げ塗り → 下塗り → 下地（煉瓦＋石）。
       読ませる鍵は「下地は必ず一段暗い」こと。剥離部は面より奥に引っ込んでいる。
       境目には上層の小口の影（上側に強く）と、欠けた縁の明るい線を置く。
       ==================================================================== */
    function buildPlaster() {
      var S = 512, o = mk(S), x = o.x;
      var wx = fbm(S, 5, 3, 71), wy = fbm(S, 5, 3, 137);
      var m = warp(S, fbm(S, 3, 5, 909), wx, wy, 62);   // 縁をちぎれさせる
      var det = fbm(S, 90, 3, 1201);
      var mott = fbm(S, 10, 4, 331);

      var T2 = 0.545, T1 = 0.470;                 // 仕上げ / 下塗り / 下地 の境
      var cTop = toRGB(P.plaster, [0, 0, 0]);
      var cTopD = toRGB(sh(P.plaster, 0.70), [0, 0, 0]);
      var cBase = toRGB(mix(P.plaster, P.concreteDark, 0.52), [0, 0, 0]);
      var cLip = toRGB(sh(P.plaster, 1.34), [0, 0, 0]);
      var cSh = toRGB(P.grime, [0, 0, 0]);
      /* 下地の煉瓦は必ず灰へ寄せる。生の brick は画面で浮く。 */
      var cBrk = toRGB(sh(mix(P.brick, P.ash, 0.42), 0.72), [0, 0, 0]);
      var cBrkD = toRGB(sh(mix(P.brick, P.grime, 0.55), 0.75), [0, 0, 0]);
      var cJnt = toRGB(sh(mix(P.plaster, P.concreteDark, 0.55), 0.72), [0, 0, 0]);
      var cStn = toRGB(sh(mix(P.stone, P.ash, 0.3), 0.72), [0, 0, 0]);

      /* 下地：粗い煉瓦積みに切石が混じる乱層積み（旧市街の躯体） */
      function substrate(u, v, i, out) {
        var row = Math.floor(v * 10), off = (row % 2) * 0.5;
        var cu = u * 5 + off, col = Math.floor(cu);
        var bx = cu - col, by = v * 10 - row;
        var isStone = h2(col, row, 55) > 0.78;
        lerp3(isStone ? cStn : cBrk, cBrkD, 0.15 + 0.60 * h2(col, row, 91), out);
        scl(out, 0.74 + 0.50 * det[i]);
        if (bx < 0.045 || bx > 0.955 || by < 0.10 || by > 0.90) {
          lerp3(out, cJnt, 0.85, out);            // 目地
          if (by < 0.10) lerp3(out, cSh, 0.45, out);
        }
      }

      fill(o, function (px, py, u, v, out) {
        var i = py * S + px, mv = m[i];
        /* 剥離部の「上側かどうか」。上に漆喰が残っていれば影が濃い。 */
        var above = m[((py - 6 + S) % S) * S + px];
        if (mv > T2 + 0.014) {                    // 仕上げ塗り（生きている面）
          lerp3(cTopD, cTop, 0.22 + 0.98 * mott[i], out);
          scl(out, 0.84 + 0.30 * det[i]);
        } else if (mv > T2 - 0.005) {             // 剥がれ際の割れ肌（明）
          lerp3(cLip, cTop, 0.30 * det[i], out);
        } else if (mv > T1 + 0.012) {             // 下塗り（砂の粗い層。ざらつく）
          lerp3(cBase, cTopD, 0.22 + 0.55 * det[i], out);
          scl(out, 0.90 + 0.22 * det[i]);
          lerp3(out, cSh, smoothstep(T2 - 0.05, T2 - 0.005, mv) * 0.55 *
            (above > T2 ? 1 : 0.25), out);        // 上層の小口が落とす影
        } else if (mv > T1 - 0.005) {
          lerp3(cLip, cBase, 0.50, out);
        } else {
          substrate(u, v, i, out);
          scl(out, 0.80);                         // 下地は一段奥＝暗い
          lerp3(out, cSh, smoothstep(T1 - 0.055, T1 - 0.005, mv) * 0.55 *
            (above > T1 ? 1 : 0.3), out);
        }
        scl(out, 1 - 0.28 * Math.pow(v, 2.2));
      });

      seed(2299);
      var i, px2, py2;
      /* --- 剥離の縁に沿った微細な欠け ------------------------------------- */
      for (i = 0; i < 240; i++) {
        px2 = Math.floor(rnd() * S); py2 = Math.floor(rnd() * S);
        var mv = m[py2 * S + px2];
        if (mv > T2 - 0.02 && mv < T2 + 0.03)
          chip(o, px2, py2, rr(2, 7), sh(P.plaster, 1.36), P.grime, 0.75);
      }
      /* --- ヘアクラック：生きている面に走る。剥離はここから始まる -------- */
      seed(1777);
      for (i = 0; i < 16; i++) {
        px2 = rnd() * S; py2 = rnd() * S;
        if (m[(Math.floor(py2) * S + Math.floor(px2))] < T2) continue;
        crack(o, px2, py2, rr(0, 6.28), rr(40, 160), 1.6, P.grime, sh(P.plaster, 1.32), 2, 0.45);
      }
      /* --- 雨だれ：天端から。剥離の縁も水を溜めるので、そこからも垂らす -- */
      seed(6161);
      dripRow(o, 0, 230, 34, P.grime, sh(P.plaster, 1.45), 0.36);
      for (i = 0; i < 34; i++) {
        px2 = rnd() * S; py2 = rnd() * S;
        if (m[(Math.floor(py2) * S + Math.floor(px2))] > T1) continue;
        tiled(o, (function (a, b) {
          return function () { drip(o, a, b, rr(30, 150), rr(2, 7), P.grime, 0.32, 0.22, true); };
        })(px2, py2));
      }
      /* --- 灰の堆積：剥離の下端＝上を向いた小さな棚にだけ乗る ------------- */
      var ashCv = mk(S);
      fill(ashCv, function (px, py, u, v, out) {
        var i2 = py * S + px, up = m[((py - 3 + S) % S) * S + px];
        var on = (m[i2] < T2 && up > T2) ? 1 : 0;
        var vv = on * (0.45 + 0.55 * det[i2]) * 255;
        out[0] = vv * (R8(P.ash) / 255); out[1] = vv * (G8(P.ash) / 255); out[2] = vv * (B8(P.ash) / 255);
      });
      blend(o, ashCv.cv, 'lighter', 0.20);

      blend(o, greyCanvas(S, ctr(fbm(S, 7, 4, 8181), 1.5, 0.5), 0.52, 1.02), 'multiply', 0.52);
      blend(o, greyCanvas(S, fbm(S, 190, 2, 3311), 0.0, 1.0), 'overlay', 0.10);
      dull(o, P.ash, 0.05);
      return o;
    }

    /* =======================================================================
       7. 切石（乱れ布積み）
       段ごとに石の丁数と高さを変える。等分割は必ず「タイル」に見える。
       ブロックごとの明度差が最大の武器。逆光でも「積んである」と読める。
       ==================================================================== */
    function buildStone() {
      var S = 512, o = mk(S), x = o.x;
      var det = fbm(S, 70, 4, 424);
      var big = fbm(S, 8, 4, 616);
      var tool = fbm2(S, 128, 16, 3, 858);        // 縦に伸びた微細な鑿跡
      var RY = [0, 0.30, 0.52, 0.79, 1.0];        // 段の境（不等分）
      var RC = [3, 2, 4, 3];                      // 段ごとの石の丁数
      var RO = [0.00, 0.31, 0.13, 0.62];          // 段ごとの目地の通りずらし
      var JP = 7.5;                               // 目地幅（px）。段ごとに換算する

      var cS = toRGB(P.stone, [0, 0, 0]);
      var cSD = toRGB(sh(P.stone, 0.50), [0, 0, 0]);
      var cSL = toRGB(sh(P.stone, 1.34), [0, 0, 0]);
      var cJ = toRGB(mix(P.stone, P.concreteDark, 0.62), [0, 0, 0]);
      var cSh = toRGB(P.grime, [0, 0, 0]);
      var cAsh = toRGB(sh(P.ash, 1.55), [0, 0, 0]);

      fill(o, function (px, py, u, v, out) {
        var i = py * S + px, row = 0;
        while (row < 3 && v >= RY[row + 1]) row++;
        var rh = RY[row + 1] - RY[row];
        var by = (v - RY[row]) / rh;
        var cols = RC[row];
        var cu = (u + RO[row]) * cols, col = Math.floor(cu) % cols;
        var bx = cu - Math.floor(cu);
        var jw = JP / (S / cols), jh = JP / (S * rh);
        var hv = h2(col, row, 33);

        if (bx < jw || bx > 1 - jw || by < jh || by > 1 - jh) {
          /* 目地：奥まっているので暗い。粗い骨材が見える。 */
          lerp3(cJ, cSD, 0.30 + 0.55 * det[i], out);
          if (by < jh * 0.6) lerp3(out, cSh, 0.65, out);       // 上の石の小口の影
          if (by > 1 - jh * 0.35) lerp3(out, cAsh, 0.30, out); // 下の石の天端が拾う光
        } else {
          /* 石身：ロットの明度差を 0.55〜1.35 倍と大きく取る */
          lerp3(cSD, cSL, sat((det[i] * 0.42 + big[i] * 0.58 - 0.16) / 0.66), out);
          scl(out, 0.55 + 0.80 * hv);
          /* 石の天端＝上向きの面。灰が薄く乗って一段明るい。 */
          lerp3(out, cAsh, smoothstep(jh + 0.10, jh, by) * 0.40, out);
          /* 石の下端＝庇の影。上下の対でブロックが立体に見える。 */
          lerp3(out, cSh, smoothstep(1 - jh - 0.075, 1 - jh, by) * 0.40, out);
          /* 縦の目地際も締める */
          lerp3(out, cSh, sat(smoothstep(jw + 0.022, jw, bx) +
            smoothstep(1 - jw - 0.022, 1 - jw, bx)) * 0.18, out);
          /* びしゃん叩き（石工の道具跡）。異方性ノイズで木目にならないよう弱く。 */
          scl(out, 0.94 + 0.13 * tool[i]);
        }
        /* 全体の縦方向グラデは弱め。強いと石ごとの差が消えて段々に見える。 */
        scl(out, 1 - 0.16 * Math.pow(v, 2.3));
      });

      seed(9091);
      var r, c, i;
      for (r = 0; r < 4; r++) {
        var rh2 = (RY[r + 1] - RY[r]) * S, y0 = RY[r] * S, cols = RC[r], bw = S / cols;
        var ox2 = -RO[r] * S;
        for (c = 0; c < cols; c++) {
          var x0 = ox2 + c * bw;
          /* --- 角の欠け：石は角から丸くなる。4隅に不揃いの大きさで ------- */
          var cr = [[x0 + JP, y0 + JP], [x0 + bw - JP, y0 + JP],
          [x0 + JP, y0 + rh2 - JP], [x0 + bw - JP, y0 + rh2 - JP]];
          for (i = 0; i < 4; i++) {
            if (rnd() < 0.22) continue;
            (function (cx, cy) {
              tiled(o, function () { chip(o, cx, cy, rr(5, 18), sh(P.stone, 1.30), P.grime, 0.85); });
            })(cr[i][0], cr[i][1]);
          }
          /* 稜線の摩耗：辺に沿った小さな欠け */
          for (i = 0; i < 5; i++) {
            (function (cx, cy) {
              tiled(o, function () { chip(o, cx, cy, rr(2.5, 7), sh(P.stone, 1.24), P.grime, 0.6); });
            })(x0 + rr(0.1, 0.9) * bw, y0 + (rnd() < 0.5 ? JP : rh2 - JP));
          }
        }
      }

      /* --- 砲撃の弾片痕：一方向から来た散弾。向きが揃うと「撃たれた」と読める */
      seed(4747);
      var ax = rr(0, S), ay = rr(0, S);
      for (i = 0; i < 40; i++) {
        (function (cx, cy, rd) {
          tiled(o, function () { pock(o, cx, cy, rd, P.grime, sh(P.stone, 1.38), sh(P.stone, 0.42)); });
        })(ax + rr(-250, 250), ay + rr(-95, 95), rr(2.0, 9.0));
      }
      /* 直撃跡：大きく抉れて内部が露出し、亀裂が直線的に走る */
      seed(2020);
      for (i = 0; i < 2; i++) {
        (function (cx, cy) {
          tiled(o, function () {
            chip(o, cx, cy, rr(22, 36), sh(P.stone, 0.62), P.grime, 0.95);
            chip(o, cx, cy - 4, rr(11, 20), sh(P.stone, 1.22), P.grime, 0.55);
            var k;
            for (k = 0; k < 3; k++)
              crack(o, cx, cy, rr(0, 6.28), rr(70, 160), 2.6, P.grime, sh(P.stone, 1.34), 2, 0.20);
          });
        })(rnd() * S, rnd() * S);
      }

      /* --- 雨だれ：各段の目地（水平の縁）から下へ ------------------------- */
      seed(3333);
      for (r = 0; r < 4; r++)
        dripRow(o, RY[r] * S + JP + 1, (RY[r + 1] - RY[r]) * S * 1.5, 16,
          P.grime, sh(P.stone, 1.50), 0.36);

      blend(o, greyCanvas(S, ctr(fbm(S, 5, 4, 7373), 1.55, 0.5), 0.52, 1.02), 'multiply', 0.52);
      blend(o, greyCanvas(S, fbm(S, 200, 2, 1919), 0.0, 1.0), 'overlay', 0.11);
      return o;
    }

    /* =======================================================================
       8. 煉瓦（漆喰が落ちて露出した躯体）
       生の brick 色は画面で浮くので、必ず ash / grime 側へ寄せてから使う。
       ==================================================================== */
    function buildBrick() {
      var S = 512, o = mk(S), x = o.x;
      var det = fbm(S, 80, 4, 515);
      var big = fbm(S, 12, 3, 727);
      var face = fbm(S, 26, 4, 949);
      var ROWS = 8, COLS = 4, JP = 8;
      var BR = mix(P.brick, P.ash, 0.34);         // 濁らせた煉瓦の基準色
      var cB = toRGB(BR, [0, 0, 0]);
      var cBD = toRGB(sh(mix(P.brick, P.grime, 0.35), 0.62), [0, 0, 0]);
      var cBL = toRGB(sh(BR, 1.24), [0, 0, 0]);
      var cScor = toRGB(mix(BR, P.grime, 0.80), [0, 0, 0]);
      var cCore = toRGB(mix(BR, P.plaster, 0.55), [0, 0, 0]);
      var cJ = toRGB(mix(P.plaster, P.concreteDark, 0.52), [0, 0, 0]);
      var cSh = toRGB(P.grime, [0, 0, 0]);
      var cVoid = toRGB(sh(P.grime, 0.55), [0, 0, 0]);
      var cAsh = toRGB(sh(P.ash, 1.45), [0, 0, 0]);
      var voids = [];

      fill(o, function (px, py, u, v, out) {
        var i = py * S + px;
        var row = Math.floor(v * ROWS), off = (row % 2) * (0.5 / COLS);
        var cu = (u + off) * COLS, col = Math.floor(cu) % COLS;
        var bx = cu - Math.floor(cu), by = v * ROWS - row;
        var jw = JP / (S / COLS), jh = JP / (S / ROWS);
        var hv = h2(col, row, 17), hv2 = h2(col, row, 83);
        var missing = hv2 > 0.955;
        var scorch = hv2 > 0.80 && !missing;
        var spall = hv2 < 0.16;

        if (missing) {
          /* 抜けた煉瓦：奥に空洞。上ほど暗く（庇の影）、下に瓦礫の反射。 */
          lerp3(cVoid, cSh, 0.30 + 0.35 * det[i], out);
          scl(out, 0.55 + 0.75 * smoothstep(0.0, 0.85, by) * (0.4 + 0.6 * big[i]));
          if (by > 0.88) lerp3(out, cAsh, 0.30, out);
          scl(out, 1 - 0.20 * Math.pow(v, 2.3));
          return;
        }
        if (bx < jw || bx > 1 - jw || by < jh || by > 1 - jh) {
          /* 目地：奥に引っ込むので暗い。下側の唇にだけ光が当たる。 */
          lerp3(cJ, cBD, 0.35 + 0.45 * det[i], out);
          scl(out, 0.68);
          if (by < jh * 0.55) lerp3(out, cSh, 0.60, out);
          if (by > 1 - jh * 0.30) lerp3(out, cAsh, 0.34, out);
        } else {
          lerp3(cBD, cBL, sat((det[i] * 0.42 + big[i] * 0.58 - 0.18) / 0.62), out);
          scl(out, 0.62 + 0.72 * hv);
          if (scorch) lerp3(out, cScor, 0.50 + 0.40 * big[i], out);
          if (spall) {
            /* 表面が飛んだ面：焼成前の芯が出るので白っぽく粗い。縁は硬く切れる。 */
            var sm = smoothstep(0.46, 0.53, face[i]);
            lerp3(out, cCore, sm * 0.85, out);
            lerp3(out, cSh, smoothstep(0.53, 0.46, face[i]) * smoothstep(0.40, 0.46, face[i]) * 1.6, out);
          }
          lerp3(out, cAsh, smoothstep(jh + 0.10, jh, by) * 0.34, out);
          lerp3(out, cSh, smoothstep(1 - jh - 0.08, 1 - jh, by) * 0.40, out);
          lerp3(out, cSh, sat(smoothstep(jw + 0.024, jw, bx) +
            smoothstep(1 - jw - 0.024, 1 - jw, bx)) * 0.20, out);
        }
        scl(out, 1 - 0.24 * Math.pow(v, 2.3));
      });

      /* 抜けた煉瓦の座標を拾い直す（上に煤を出すため） */
      var r, c, i, bw = S / COLS, bh = S / ROWS;
      for (r = 0; r < ROWS; r++) for (c = 0; c < COLS; c++)
        if (h2(c, r, 83) > 0.955) {
          var off2 = -(r % 2) * (bw / 2);
          voids.push([off2 + c * bw + bw / 2, r * bh]);
        }

      /* --- 角の欠け：全部の角ではなく、当たった側に偏らせる --------------- */
      seed(818);
      for (r = 0; r < ROWS; r++) for (c = 0; c < COLS; c++) {
        var offx = -(r % 2) * (bw / 2), x0 = offx + c * bw, y0 = r * bh;
        for (i = 0; i < 3; i++) {
          if (rnd() < 0.52) continue;
          (function (cx, cy) {
            tiled(o, function () { chip(o, cx, cy, rr(2.5, 9), sh(BR, 1.38), P.grime, 0.8); });
          })(x0 + (rnd() < 0.5 ? JP : bw - JP), y0 + (rnd() < 0.5 ? JP : bh - JP));
        }
      }

      /* --- 抜けた穴の上に煤が立ち上る（火が中で燃えた跡）------------------ */
      for (i = 0; i < voids.length; i++) {
        (function (vd) {
          tiled(o, function () {
            var gr = x.createLinearGradient(0, vd[1], 0, vd[1] - bh * 2.4);
            gr.addColorStop(0, CA(P.grime, 0.55));
            gr.addColorStop(1, CA(P.grime, 0));
            x.fillStyle = gr;
            x.beginPath();
            x.moveTo(vd[0] - bw * 0.45, vd[1]);
            x.quadraticCurveTo(vd[0] - bw * 0.9, vd[1] - bh * 1.4, vd[0] - bw * 0.5, vd[1] - bh * 2.4);
            x.lineTo(vd[0] + bw * 0.5, vd[1] - bh * 2.4);
            x.quadraticCurveTo(vd[0] + bw * 0.9, vd[1] - bh * 1.4, vd[0] + bw * 0.45, vd[1]);
            x.closePath(); x.fill();
          });
        })(voids[i]);
      }

      /* --- 白華（エフロレッセンス）と雨だれ：目地から出る ------------------ */
      seed(6464);
      for (r = 0; r < ROWS; r++)
        dripRow(o, r * bh + JP + 1, bh * 2.4, 10, P.grime, sh(P.plaster, 1.5), 0.32);

      /* --- 弾痕と亀裂 ------------------------------------------------------ */
      seed(1212);
      var ax = rr(0, S), ay = rr(0, S);
      for (i = 0; i < 30; i++) {
        (function (cx, cy, rd) {
          tiled(o, function () { pock(o, cx, cy, rd, P.grime, sh(BR, 1.45), sh(BR, 0.36)); });
        })(ax + rr(-230, 230), ay + rr(-120, 120), rr(2, 8));
      }
      seed(2727);
      for (i = 0; i < 3; i++)
        crack(o, rnd() * S, rnd() * S, rr(1.2, 1.9), rr(140, 280), 2.8, P.grime, sh(BR, 1.38), 2, 0.28);

      blend(o, greyCanvas(S, ctr(fbm(S, 5, 4, 5959), 1.55, 0.5), 0.48, 1.02), 'multiply', 0.56);
      blend(o, greyCanvas(S, fbm(S, 210, 2, 4141), 0.0, 1.0), 'overlay', 0.10);
      dull(o, P.ash, 0.08);
      return o;
    }

    /* =======================================================================
       9. 鋼板（溶接・リベット・そこから下へ流れる錆）
       初回の出力では錆が全リベットから同じ長さで垂れて「蝋燭」に見えた。
       (a) 半分以上のリベットは流さない (b) 長さ・幅を大きく振る
       (c) 最後にノイズのアルファでちぎる、の3つで「にじみ」に見せる。
       ==================================================================== */
    function buildMetal() {
      var S = 512, o = mk(S), x = o.x;
      var roll = fbm2(S, 8, 64, 4, 646);
      var det = fbm(S, 150, 2, 828);
      var patch = fbm(S, 5, 4, 191);
      var cMD = toRGB(sh(P.metal, 0.40), [0, 0, 0]);
      var cML = toRGB(sh(P.metal, 1.40), [0, 0, 0]);
      var cRD = toRGB(RUST_D, [0, 0, 0]);

      fill(o, function (px, py, u, v, out) {
        var i = py * S + px;
        /* 圧延の筋は弱く。強いと木目に見える（初回の出力でそうなった）。 */
        lerp3(cMD, cML, sat((roll[i] * 0.30 + det[i] * 0.28 + patch[i] * 0.42 - 0.20) / 0.58), out);
        lerp3(out, cRD, smoothstep(0.60, 0.80, patch[i]) * 0.45 * (0.4 + 0.6 * det[i]), out);
        scl(out, 1 - 0.24 * Math.pow(v, 2.0));
      });

      seed(1357);
      var i, j;
      /* --- 板の継ぎ目：縦に1本。ここで「鋼板を継いだもの」だと分かる ------ */
      x.save();
      x.fillStyle = CA(sh(P.metal, 0.32), 0.6); x.fillRect(S * 0.5 - 2, 0, 4, S);
      x.fillStyle = CA(sh(P.metal, 1.45), 0.35); x.fillRect(S * 0.5 + 2, 0, 2, S);
      x.restore();

      /* --- 溶接ビード：波打った隆起。上縁が光り下縁に影 ------------------- */
      function weld(y0) {
        var k, n = 56, p = [];
        for (k = 0; k <= n; k++) p.push(y0 + Math.sin(k * 0.62) * 2.6 + rr(-1.2, 1.2));
        x.save(); x.lineCap = 'round';
        for (k = 0; k < n; k++) {
          var xa = k / n * S, xb = (k + 1) / n * S;
          x.strokeStyle = CA(sh(P.metal, 0.28), 0.9); x.lineWidth = 16;
          x.beginPath(); x.moveTo(xa, p[k] + 5); x.lineTo(xb, p[k + 1] + 5); x.stroke();
          x.strokeStyle = CA(sh(P.metal, 0.85), 0.95); x.lineWidth = 12;
          x.beginPath(); x.moveTo(xa, p[k]); x.lineTo(xb, p[k + 1]); x.stroke();
          /* ビードの波：一定間隔の半月が重なるのが溶接の見え方 */
          x.strokeStyle = CA(sh(P.metal, 1.45), 0.55); x.lineWidth = 4.5;
          x.beginPath(); x.moveTo(xa, p[k] - 3.2); x.lineTo(xb, p[k + 1] - 3.2); x.stroke();
          x.strokeStyle = CA(sh(P.metal, 0.5), 0.5); x.lineWidth = 1.6;
          x.beginPath(); x.moveTo(xa, p[k] + rr(-4, 4)); x.lineTo(xa, p[k] + 5); x.stroke();
        }
        x.restore();
      }
      weld(S * 0.5);

      /* --- リベット：突起なので上に光・下に影（窪みと順序が逆）----------- */
      var rivets = [];
      for (j = 0; j < 3; j++) {
        var ry = [30, S * 0.5 - 26, S - 30][j];
        for (i = 0; i < 9; i++) {
          var rx = 26 + i * (S - 52) / 8 + rr(-4, 4), rd = rr(6.4, 8.2);
          rivets.push([rx, ry + rr(-2.5, 2.5), rd]);
        }
      }
      for (i = 0; i < rivets.length; i++) {
        (function (rv) {
          tiled(o, function () {
            var rx = rv[0], ry = rv[1], rd = rv[2];
            x.save();
            x.fillStyle = CA(sh(P.metal, 0.26), 0.7);
            x.beginPath(); x.arc(rx, ry + 2.6, rd, 0, Math.PI * 2); x.fill();
            var gr = x.createRadialGradient(rx - rd * 0.35, ry - rd * 0.45, rd * 0.1, rx, ry, rd);
            gr.addColorStop(0, CA(sh(P.metal, 1.65), 1));
            gr.addColorStop(0.55, CA(P.metal, 1));
            gr.addColorStop(1, CA(sh(P.metal, 0.50), 1));
            x.fillStyle = gr;
            x.beginPath(); x.arc(rx, ry, rd, 0, Math.PI * 2); x.fill();
            x.restore();
          });
        })(rivets[i]);
      }

      /* --- 錆の流れ：別レイヤに描き、ノイズのアルファでちぎってから乗せる - */
      var rc = mk(S);
      var rcx = rc.x, savedX = o.x;
      o.x = rcx;                                   // drip/rustBleed の描き先を差し替える
      seed(2468);
      for (i = 0; i < rivets.length; i++) {
        if (rnd() < 0.62) continue;                // 大半のリベットは流さない
        (function (rv) {
          tiled(rc, function () { rustBleed(rc, rv[0], rv[1] + rv[2] * 0.6, rr(25, 210), rr(4, 14), rr(0.35, 0.85)); });
        })(rivets[i]);
      }
      for (i = 0; i < 7; i++) {
        (function (cx) {
          tiled(rc, function () { rustBleed(rc, cx, S * 0.5 + 8, rr(30, 220), rr(5, 20), rr(0.3, 0.7)); });
        })(rnd() * S);
      }
      o.x = savedX;
      rcx.save();
      rcx.globalCompositeOperation = 'destination-in';
      rcx.drawImage(maskCanvas(S, ctr(fbm(S, 12, 4, 3690), 1.9, 0.42), 0.0, 1.35), 0, 0);
      rcx.restore();
      blend(o, rc.cv, 'source-over', 0.9);

      /* --- 掻き傷：地金が出て明るい。数は少なく、長く。 ------------------- */
      seed(9753);
      x.save(); x.lineCap = 'round';
      for (i = 0; i < 40; i++) {
        var sx = rnd() * S, sy = rnd() * S, an = rr(-0.30, 0.30), ln = rr(30, 190);
        x.strokeStyle = CA(sh(P.metal, 1.80), rr(0.10, 0.45));
        x.lineWidth = rr(0.7, 2.2);
        x.beginPath(); x.moveTo(sx, sy); x.lineTo(sx + Math.cos(an) * ln, sy + Math.sin(an) * ln); x.stroke();
      }
      x.restore();

      /* --- 打痕：面がへこむと西日の当たり方が変わる ----------------------- */
      seed(1122);
      for (i = 0; i < 14; i++) {
        (function (cx, cy, rd, rot) {
          tiled(o, function () {
            var gr = x.createLinearGradient(0, cy - rd, 0, cy + rd);
            gr.addColorStop(0, CA(sh(P.metal, 0.42), 0.55));
            gr.addColorStop(0.55, CA(P.metal, 0));
            gr.addColorStop(1, CA(sh(P.metal, 1.50), 0.42));
            x.save();
            x.beginPath(); x.ellipse(cx, cy, rd, rd * 0.72, rot, 0, Math.PI * 2);
            x.fillStyle = gr; x.fill();
            x.restore();
          });
        })(rnd() * S, rnd() * S, rr(10, 36), rr(-0.5, 0.5));
      }

      blend(o, greyCanvas(S, ctr(fbm(S, 6, 4, 3131), 1.4, 0.5), 0.58, 1.02), 'multiply', 0.46);
      blend(o, greyCanvas(S, fbm(S, 230, 2, 8484), 0.0, 1.0), 'overlay', 0.10);
      return o;
    }

    /* =======================================================================
       10. 全面の錆
       初回は「オレンジのノイズ」になり不合格だった。錆は模様ではなく
       「鱗（スケール）が層状に浮いて剥がれ落ちる」構造物なので、
       ボロノイで鱗を割り、鱗ごとに（密着 / 浮き / 脱落）の状態を持たせる。
       鱗の上縁が明るく下縁が暗い＝上から光が来ている、で厚みが出る。
       ==================================================================== */
    function buildRust() {
      var S = 512, o = mk(S), x = o.x;
      var id = new Int32Array(S * S), edge = new Float32Array(S * S);
      voronoi(S, 22, 606, id, edge);              // 鱗（約23px）
      var id2 = new Int32Array(S * S), edge2 = new Float32Array(S * S);
      voronoi(S, 8, 313, id2, edge2);             // 大きな腐食の版図
      var flow = fbm2(S, 14, 4, 4, 3737);         // 縦に伸びた水の流れ
      var pit = fbm(S, 140, 2, 4949);
      var grain = fbm(S, 60, 3, 5151);

      var cSteel = toRGB(sh(P.rebar, 0.72), [0, 0, 0]);
      var cD = toRGB(RUST_D, [0, 0, 0]);
      var cM = toRGB(RUST_M, [0, 0, 0]);
      var cL = toRGB(RUST_L, [0, 0, 0]);

      fill(o, function (px, py, u, v, out) {
        var i = py * S + px;
        var cid = id[i], st = h2(cid, 0, 77), reg = h2(id2[i], 0, 91);
        var e = edge[i];

        /* 大きな版図：腐食が進んだ領域と、まだ塗膜が残る領域 */
        var heavy = sat(reg * 0.6 + flow[i] * 0.4 + edge2[i] * 0.25);

        if (st < 0.26) {
          /* 脱落した鱗：下地の鋼が出る。周りより暗く、青灰に寄る。 */
          lerp3(cSteel, cD, 0.25 + 0.5 * grain[i], out);
        } else if (st < 0.68) {
          /* 密着した鱗：中間の酸化鉄 */
          lerp3(cD, cM, sat(grain[i] * 0.7 + heavy * 0.5), out);
        } else {
          /* 浮いた厚い鱗：乾いた粉状で一番明るい */
          lerp3(cM, cL, sat(grain[i] * 0.6 + heavy * 0.6), out);
        }
        /* 鱗の縁：溝。境界にほこりと水が入って暗い。 */
        scl(out, 0.55 + 0.45 * smoothstep(0.0, 0.13, e));
        /* 鱗の擬似陰影：3px 上との縁距離の差。上縁なら明るく、下縁なら暗い。 */
        var d = (e - edge[((py - 3 + S) % S) * S + px]) * 3.2;
        scl(out, 1 + sat(d) * 0.50 - sat(-d) * 0.42);
        /* 孔食：深い点。数は多く、径は小さく。 */
        lerp3(out, cD, smoothstep(0.74, 0.92, pit[i]) * 0.7, out);
        scl(out, 0.85 + 0.30 * (1 - v * 0.5));    // 上のほうが乾いて明るい
      });

      /* --- 流れ落ちた錆の筋。上から下へ、必ず縦。 ------------------------- */
      seed(7171);
      var i;
      for (i = 0; i < 30; i++) {
        (function (cx, cy, L, w, a) {
          tiled(o, function () { drip(o, cx, cy, L, w, RUST_L, a, 0.22, true); });
        })(rnd() * S, rnd() * S * 0.6, rr(60, 320), rr(3, 12), rr(0.10, 0.32));
      }
      /* --- 剥がれかけの鱗の縁：明るい輪郭を少し足すと厚みが出る ----------- */
      seed(3535);
      for (i = 0; i < 60; i++) {
        chip(o, rnd() * S, rnd() * S, rr(4, 14), RUST_L, sh(RUST_D, 0.6), 0.35);
      }
      blend(o, greyCanvas(S, ctr(fbm(S, 5, 4, 6969), 1.5, 0.5), 0.55, 1.05), 'multiply', 0.45);
      blend(o, greyCanvas(S, fbm(S, 200, 2, 1414), 0.0, 1.0), 'overlay', 0.12);
      dull(o, P.ash, 0.09);                       // 最後に必ず濁らせる
      return o;
    }

    /* =======================================================================
       11. 地面（真上を向いた面 ＝ 灰が最も厚く積もる）
       敷石をボロノイで割る。目地は「暗い溝＋そこに溜まった明るい灰」の
       二重線にする。溝だけだとCGの割れ模様に見える。
       ==================================================================== */
    function buildGround(mode) {
      var S = 512, o = mk(S), x = o.x, isH = (mode === 1);
      var id = new Int32Array(S * S), edge = new Float32Array(S * S);
      voronoi(S, 8, 606, id, edge);
      var det = fbm(S, 90, 4, 1616);
      var grit = fbm(S, 190, 2, 2626);
      var ashF = fbm(S, 5, 4, 3636);
      var wet = fbm(S, 9, 3, 4646);

      var cGD = toRGB(P.groundDark, [0, 0, 0]);
      var cGL = toRGB(sh(P.ground, 1.45), [0, 0, 0]);
      var cAsh = toRGB(sh(P.ash, 1.40), [0, 0, 0]);
      var cWet = toRGB(P.concreteWet, [0, 0, 0]);
      var cStone = toRGB(P.stone, [0, 0, 0]);
      var cDeep = toRGB(sh(P.groundDark, 0.55), [0, 0, 0]);

      if (isH) {
        fill(o, function (px, py, u, v, out) {
          var i = py * S + px;
          out[0] = out[1] = out[2] =
            88 + smoothstep(0.0, 0.09, edge[i]) * 96 + (det[i] - 0.5) * 30 + (grit[i] - 0.5) * 24;
        });
      } else {
        fill(o, function (px, py, u, v, out) {
          var i = py * S + px, cid = id[i];
          var hv = h2(cid, 0, 21), e = edge[i];
          lerp3(cGD, cGL, sat((det[i] * 0.45 + grit[i] * 0.55 - 0.20) / 0.58), out);
          if (hv > 0.84) lerp3(out, cStone, 0.40, out);     // 一部は切石の破片
          scl(out, 0.66 + 0.62 * hv);
          /* 石ごとに、中心は踏まれて磨かれ明るく、縁は土が溜まって暗い */
          scl(out, 0.80 + 0.30 * smoothstep(0.02, 0.35, e));
          /* 目地の溝 */
          var jn = 1 - smoothstep(0.0, 0.055, e);
          lerp3(out, cDeep, jn * 0.80, out);
          /* 溝に溜まった灰：溝の中心だけ明るく戻す＝二重線になり彫りが出る */
          var core = 1 - smoothstep(0.0, 0.022, e);
          lerp3(out, cAsh, core * 0.55 * (0.4 + 0.6 * ashF[i]), out);
          /* 吹き溜まりの灰：上向きの面なので全面に薄く、風下に厚く */
          lerp3(out, cAsh, sat(ashF[i] * 1.5 - 0.55) * 0.60 + 0.10, out);
          /* 濡れ残り：低い所（溝）に溜まる */
          lerp3(out, cWet, smoothstep(0.62, 0.88, wet[i]) * (0.25 + 0.6 * jn) * 0.55, out);
        });
      }

      seed(5252);
      var i;
      /* --- 着弾クレータ：椀・放射亀裂・投げ出された灰の環 ----------------- */
      var kx = rr(0.2, 0.8) * S, ky = rr(0.2, 0.8) * S;
      if (isH) {
        var gh = x.createRadialGradient(kx, ky, 0, kx, ky, 78);
        gh.addColorStop(0, GY(38)); gh.addColorStop(0.55, GY(92));
        gh.addColorStop(0.85, GY(168)); gh.addColorStop(1, GYA(128, 0));
        x.fillStyle = gh; x.beginPath(); x.arc(kx, ky, 78, 0, Math.PI * 2); x.fill();
      } else {
        x.save();
        var ge = x.createRadialGradient(kx, ky, 40, kx, ky, 110);   // 投げ出された灰
        ge.addColorStop(0, CA(sh(P.ash, 1.5), 0.42));
        ge.addColorStop(1, CA(sh(P.ash, 1.5), 0));
        x.fillStyle = ge; x.beginPath(); x.arc(kx, ky, 110, 0, Math.PI * 2); x.fill();
        var gc = x.createRadialGradient(kx, ky, 0, kx, ky, 56);     // 椀
        gc.addColorStop(0, CA(sh(P.grime, 0.7), 0.85));
        gc.addColorStop(0.45, CA(P.groundDark, 0.65));
        gc.addColorStop(1, CA(P.groundDark, 0));
        x.fillStyle = gc; x.beginPath(); x.arc(kx, ky, 56, 0, Math.PI * 2); x.fill();
        x.restore();
      }
      for (i = 0; i < 11; i++) {
        var ang = i / 11 * Math.PI * 2 + rr(-0.25, 0.25);
        if (isH) crack(o, kx + Math.cos(ang) * 40, ky + Math.sin(ang) * 40, ang, rr(50, 190), 4.5, GY(64), GY(186), 1, 0.18);
        else crack(o, kx + Math.cos(ang) * 40, ky + Math.sin(ang) * 40, ang, rr(50, 190), 4.5, P.groundDark, sh(P.ash, 1.5), 1, 0.18);
      }

      /* --- 瓦礫片：大中小の3階級。上から見るので影は必ず下（手前）に落ちる。
         初回は同じ大きさの白い粒を撒いて「はしか」に見えた。 */
      seed(7878);
      var sizes = [[26, 5.5, 11], [90, 2.6, 5.5], [230, 1.2, 2.8]];
      var cls, cnt;
      for (cls = 0; cls < 3; cls++) {
        cnt = sizes[cls][0];
        for (i = 0; i < cnt; i++) {
          /* クレータと亀裂の近くに寄せる＝飛び散った向きが読める */
          var near = rnd() < 0.45;
          var an2 = rr(0, 6.28), rd3 = rr(30, 260);
          var cxp = near ? kx + Math.cos(an2) * rd3 : rnd() * S;
          var cyp = near ? ky + Math.sin(an2) * rd3 : rnd() * S;
          (function (cx, cy, rd, hv, rot) {
            tiled(o, function () {
              x.save();
              if (isH) {
                x.fillStyle = GYA(200, 0.7);
                x.beginPath(); x.ellipse(cx, cy, rd, rd * 0.7, rot, 0, Math.PI * 2); x.fill();
              } else {
                x.fillStyle = CA(P.grime, 0.30);
                x.beginPath(); x.ellipse(cx + rd * 0.30, cy + rd * 0.55, rd, rd * 0.7, rot, 0, Math.PI * 2); x.fill();
                x.fillStyle = CA(sh(hv > 0.55 ? P.concrete : P.stone, 0.75 + hv * 0.55), 0.80);
                x.beginPath(); x.ellipse(cx, cy, rd, rd * 0.7, rot, 0, Math.PI * 2); x.fill();
                if (hv > 0.7) {
                  x.fillStyle = CA(sh(P.plaster, 1.30), 0.28);
                  x.beginPath(); x.ellipse(cx - rd * 0.15, cy - rd * 0.28, rd * 0.5, rd * 0.32, rot, 0, Math.PI * 2); x.fill();
                }
              }
              x.restore();
            });
          })(cxp, cyp, rr(sizes[cls][1], sizes[cls][2]), rnd(), rr(0, 6.28));
        }
      }

      if (!isH) {
        /* --- 引き摺り跡：灰の上に付いた線。人がいた証拠になる ------------ */
        seed(9494);
        x.save(); x.lineCap = 'round';
        for (i = 0; i < 20; i++) {
          var sx = rnd() * S, sy = rnd() * S, an3 = rr(0, 6.28), ln = rr(40, 170);
          x.strokeStyle = CA(P.groundDark, rr(0.08, 0.24));
          x.lineWidth = rr(4, 14);
          x.beginPath(); x.moveTo(sx, sy);
          x.quadraticCurveTo(sx + Math.cos(an3) * ln * 0.5 + rr(-25, 25), sy + Math.sin(an3) * ln * 0.5 + rr(-25, 25),
            sx + Math.cos(an3) * ln, sy + Math.sin(an3) * ln);
          x.stroke();
        }
        x.restore();
        blend(o, greyCanvas(S, ctr(fbm(S, 4, 4, 2323), 1.45, 0.5), 0.54, 1.05), 'multiply', 0.52);
        blend(o, greyCanvas(S, fbm(S, 210, 2, 5757), 0.0, 1.0), 'overlay', 0.11);
      } else {
        blend(o, greyCanvas(S, fbm(S, 220, 2, 5757), 0.28, 0.72), 'overlay', 0.45);
      }
      return o;
    }

    /* =======================================================================
       12. 布（帆布・縫い代・裂けと焼け穴）
       ==================================================================== */
    function buildCloth() {
      var S = 512, o = mk(S), x = o.x;
      var det = fbm(S, 120, 3, 1818);
      var dirt = fbm(S, 7, 4, 2828);
      var TH = 7;                                  // 糸のピッチ（px）
      var CL = sh(P.playerCloth, 1.18);
      var cCD = toRGB(sh(CL, 0.50), [0, 0, 0]);
      var cCL = toRGB(sh(CL, 1.34), [0, 0, 0]);
      var cGr = toRGB(P.grime, [0, 0, 0]);
      var cAsh = toRGB(sh(P.ash, 1.35), [0, 0, 0]);

      fill(o, function (px, py, u, v, out) {
        var i = py * S + px;
        /* 平織り：縦糸と横糸が交互に上に来る。糸1本は断面が丸いので中央が明るい。 */
        var cxn = (px % TH) / TH, cyn = (py % TH) / TH;
        var wi = Math.floor(px / TH), wj = Math.floor(py / TH);
        var over = ((wi + wj) % 2) === 0;
        var round = over ? (1 - Math.abs(cxn - 0.5) * 2) : (1 - Math.abs(cyn - 0.5) * 2);
        round = Math.pow(round, 0.5);
        var depth = over ? (1 - Math.abs(cyn - 0.5) * 2) : (1 - Math.abs(cxn - 0.5) * 2);
        lerp3(cCD, cCL, sat((det[i] - 0.24) / 0.52), out);
        scl(out, (0.68 + 0.46 * round - 0.14 * (1 - depth)) * (0.88 + 0.24 * h2(wi, wj, 44)));
        /* 汚れ：裾（下）ほど濃い。上面には灰が乗る。 */
        lerp3(out, cGr, sat(dirt[i] * 1.1 - 0.28) * (0.18 + 0.60 * v) * 0.9, out);
        lerp3(out, cAsh, sat(0.50 - dirt[i]) * 0.30 * (1 - v * 0.6), out);
      });

      seed(3939);
      var i;
      /* --- 縫い代：布であることの一番速い手がかり。畳んだ厚みで段差が出る。 */
      function seam(y0) {
        x.save();
        var gr = x.createLinearGradient(0, y0 - 12, 0, y0 + 14);
        gr.addColorStop(0, CA(P.grime, 0));
        gr.addColorStop(0.42, CA(P.grime, 0.42));   // 折り返しの影
        gr.addColorStop(0.52, CA(sh(CL, 1.5), 0.30));// 稜線が光る
        gr.addColorStop(1, CA(P.grime, 0));
        x.fillStyle = gr; x.fillRect(0, y0 - 12, S, 26);
        x.strokeStyle = CA(P.grime, 0.55); x.lineWidth = 2.6;
        x.setLineDash([8, 7]);
        x.beginPath(); x.moveTo(0, y0 + 5); x.lineTo(S, y0 + 5); x.stroke();
        x.beginPath(); x.moveTo(0, y0 - 6); x.lineTo(S, y0 - 6); x.stroke();
        x.strokeStyle = CA(sh(CL, 1.6), 0.35); x.lineWidth = 1.3;
        x.beginPath(); x.moveTo(0, y0 + 3.4); x.lineTo(S, y0 + 3.4); x.stroke();
        x.beginPath(); x.moveTo(0, y0 - 7.6); x.lineTo(S, y0 - 7.6); x.stroke();
        x.setLineDash([]);
        x.restore();
      }
      seam(S * 0.27); seam(S * 0.78);

      /* --- 裂け目：糸がほつれて渡る。穴は真っ黒ではなく奥の影の色 -------- */
      for (i = 0; i < 3; i++) {
        (function (cx, cy, ln, an) {
          tiled(o, function () {
            var k, hw, pts = [];
            x.save();
            x.translate(cx, cy); x.rotate(an);
            for (k = 0; k <= 20; k++) pts.push(Math.sin(k / 20 * Math.PI) * rr(9, 26));
            x.fillStyle = CA(sh(P.grime, 0.75), 0.94);
            x.beginPath();
            for (k = 0; k <= 20; k++) x.lineTo(-ln / 2 + ln * k / 20, -pts[k]);
            for (k = 20; k >= 0; k--) x.lineTo(-ln / 2 + ln * k / 20, pts[k] * 0.7);
            x.closePath(); x.fill();
            /* 縁は毛羽立って明るい */
            x.strokeStyle = CA(sh(CL, 1.35), 0.55); x.lineWidth = 2.2; x.stroke();
            /* ほつれ糸：穴を横切る数本。これが無いと単なる黒い染みに見える。 */
            x.strokeStyle = CA(sh(CL, 1.25), 0.8); x.lineWidth = 1.6;
            for (k = 0; k < 18; k++) {
              var tx = -ln / 2 + rnd() * ln;
              x.beginPath(); x.moveTo(tx, -26); x.lineTo(tx + rr(-5, 5), 22); x.stroke();
            }
            x.restore();
          });
        })(rnd() * S, rnd() * S, rr(70, 180), rr(0, 6.28));
      }

      /* --- 焼け穴：縁が炭化して硬く縮む。丸い穴に見えないよう多角形にする - */
      seed(5858);
      for (i = 0; i < 14; i++) {
        (function (cx, cy, rd) {
          tiled(o, function () {
            var k, n = 9, ang, rad;
            x.save();
            var gr = x.createRadialGradient(cx, cy, rd * 0.3, cx, cy, rd * 2.6);
            gr.addColorStop(0, CA(sh(P.grime, 0.5), 0.95));
            gr.addColorStop(0.40, CA(P.grime, 0.75));
            gr.addColorStop(1, CA(P.grime, 0));
            x.fillStyle = gr;
            x.beginPath();
            for (k = 0; k < n; k++) {
              ang = k / n * Math.PI * 2; rad = rd * 2.6 * rr(0.55, 1.15);
              if (k === 0) x.moveTo(cx + Math.cos(ang) * rad, cy + Math.sin(ang) * rad);
              else x.lineTo(cx + Math.cos(ang) * rad, cy + Math.sin(ang) * rad);
            }
            x.closePath(); x.fill();
            x.fillStyle = CA(sh(P.grime, 0.4), 0.92);
            x.beginPath();
            for (k = 0; k < n; k++) {
              ang = k / n * Math.PI * 2; rad = rd * rr(0.55, 1.2);
              if (k === 0) x.moveTo(cx + Math.cos(ang) * rad, cy + Math.sin(ang) * rad);
              else x.lineTo(cx + Math.cos(ang) * rad, cy + Math.sin(ang) * rad);
            }
            x.closePath(); x.fill();
            x.restore();
          });
        })(rnd() * S, rnd() * S, rr(3, 11));
      }

      blend(o, greyCanvas(S, ctr(fbm(S, 5, 4, 6767), 1.35, 0.5), 0.60, 1.06), 'multiply', 0.45);
      return o;
    }

    /* =======================================================================
       13. 汚れ（乗算オーバーレイ用）
       白＝素通し、黒＝汚れ。方向を持たない汚れは描かない：
       縁の溜まり／縦の垂れ／裾の跳ね／煤の広がり、の4つだけで構成する。
       初回は垂れが濃すぎて「鍾乳洞」になったので、本数を散らし濃度を落とした。
       ==================================================================== */
    function buildGrime() {
      var S = 256, o = mk(S), x = o.x;
      var White = sh(P.uiInk, 2.2);               // palette から作った実質の白
      var soft = fbm(S, 5, 4, 7474);
      var fineF = fbm(S, 60, 3, 8585);

      fill(o, function (px, py, u, v, out) {
        var i = py * S + px;
        /* 面の周縁ほど汚れる（隅に埃と水が溜まる）。 */
        var eg = 1 - smoothstep(0.0, 0.20, Math.min(Math.min(u, 1 - u), Math.min(v, 1 - v)));
        var m = 1
          - eg * 0.34
          - sat(soft[i] * 1.2 - 0.35) * 0.26
          - sat(fineF[i] - 0.55) * 0.14
          - Math.pow(v, 3.0) * 0.28;              // 裾の跳ね
        m = sat(m * 0.74 + 0.26);                 // 下限を作り、乗算で潰しすぎない
        out[0] = R8(White) * m; out[1] = G8(White) * m; out[2] = B8(White) * m;
      });

      seed(1591);
      var i;
      x.save();
      x.globalCompositeOperation = 'multiply';
      for (i = 0; i < 40; i++) {
        (function (cx, cy, L, w, a) {
          tiled(o, function () { drip(o, cx, cy, L, w, P.grime, a, 0.24, true); });
        })(rnd() * S, rr(-20, S * 0.75), rr(30, 170), rr(2, 11), rr(0.05, 0.17));
      }
      /* 煤の広がり：一点から放射状に薄く */
      for (i = 0; i < 4; i++) {
        var sx = rnd() * S, sy = rnd() * S, rd = rr(30, 90);
        var gr = x.createRadialGradient(sx, sy, 0, sx, sy, rd);
        gr.addColorStop(0, CA(P.grime, 0.22));
        gr.addColorStop(1, CA(P.grime, 0));
        x.fillStyle = gr; x.beginPath(); x.arc(sx, sy, rd, 0, Math.PI * 2); x.fill();
      }
      x.restore();
      return o;
    }

    /* =======================================================================
       14. ノイズ（シェーダ用ユーティリティ）
       R = 全体の斑／G = 細粒／B = 縦に流れる場（雨だれ・錆のマスク用）。
       3チャンネルを共通の基底で持ち上げてあるので、見た目は灰色の粒に留まる
       （初回は無相関にしてパステルの色ノイズになり、画面の色設計に反した）。
       ==================================================================== */
    function buildNoise() {
      var S = 256, o = mk(S);
      var a = fbm(S, 8, 5, 1001);
      var b = fbm(S, 64, 3, 2002);
      var c = fbm2(S, 24, 3, 4, 3003);
      fill(o, function (px, py, u, v, out) {
        var i = py * S + px;
        var base = (a[i] + b[i] + c[i]) / 3;
        out[0] = (base * 0.74 + a[i] * 0.26) * 255;
        out[1] = (base * 0.74 + b[i] * 0.26) * 255;
        out[2] = (base * 0.74 + c[i] * 0.26) * 255;
      });
      return o;
    }

    /* =======================================================================
       15. 弾痕デカール（透過）
       中心＝貫通孔の闇、その周り＝剥落して露出した骨材（明）、外＝放射亀裂と粉塵。
       初回は粉塵の輪が大きく白すぎて「綿玉」に見え、亀裂が曲がりすぎて「木の根」に
       見えた。半径を締め、亀裂の蛇行を 0.12 まで落として衝撃亀裂の直線性を出す。
       ==================================================================== */
    function buildDecalHole() {
      var S = 512, o = mk(S), x = o.x, cx = S / 2, cy = S / 2;
      var tear = fbm(S, 9, 4, 1234);
      var det = fbm(S, 80, 3, 5678);
      var cCore = toRGB(sh(P.grime, 0.35), [0, 0, 0]);
      var cFace = toRGB(sh(P.concrete, 1.28), [0, 0, 0]);
      var cMid = toRGB(P.concreteDark, [0, 0, 0]);
      var cDust = toRGB(P.ash, [0, 0, 0]);

      fillA(o, function (px, py, u, v, out) {
        var i = py * S + px;
        var dx = px - cx, dy = py - cy, r = Math.sqrt(dx * dx + dy * dy) / (S * 0.5);
        var wob = 0.60 + 0.55 * tear[i];          // 半径を場所ごとに揺らす＝星形の破断
        var rr2 = r / wob;
        if (rr2 > 1.0) { out[3] = 0; return; }

        var core = 1 - smoothstep(0.09, 0.155, rr2);  // 貫通孔
        var spall = 1 - smoothstep(0.16, 0.36, rr2);  // 剥落した鉢状の縁
        var dust = 1 - smoothstep(0.30, 1.0, rr2);    // 粉塵の輪

        lerp3(cDust, cMid, 0.30 + 0.45 * det[i], out);
        lerp3(out, cFace, spall * (0.60 + 0.35 * det[i]), out);
        /* 鉢の上側の内壁は影、下側の内壁は西日を拾って明るい */
        var vert = (dy / (S * 0.5)) / (rr2 + 0.001);
        lerp3(out, cCore, spall * sat(-vert) * 0.60, out);
        lerp3(out, cFace, spall * sat(vert) * 0.32, out);
        lerp3(out, cCore, core * 0.97, out);

        out[3] = sat(core + spall * 0.95 + dust * 0.26 * (0.35 + 0.65 * det[i])) * 255;
      });

      /* --- 放射亀裂：孔の縁から外へ。衝撃なのでほぼ直線。 ----------------- */
      seed(4321);
      var i;
      for (i = 0; i < 10; i++) {
        var ang = i / 10 * Math.PI * 2 + rr(-0.28, 0.28);
        crack(o, cx + Math.cos(ang) * S * 0.09, cy + Math.sin(ang) * S * 0.09,
          ang, rr(S * 0.10, S * 0.26), 3.2, sh(P.grime, 0.5), sh(P.concrete, 1.3), 1, 0.12);
      }
      /* --- 飛び散った小片の欠け ------------------------------------------- */
      for (i = 0; i < 22; i++) {
        var an2 = rr(0, 6.28), rd2 = rr(S * 0.10, S * 0.30);
        chip(o, cx + Math.cos(an2) * rd2, cy + Math.sin(an2) * rd2, rr(2, 7),
          sh(P.concrete, 1.22), P.grime, 0.5);
      }
      /* 縁を必ず透明に戻す（硬い切り口を残さない） */
      x.save();
      x.globalCompositeOperation = 'destination-in';
      var gr = x.createRadialGradient(cx, cy, S * 0.16, cx, cy, S * 0.46);
      gr.addColorStop(0, GYA(255, 1)); gr.addColorStop(1, GYA(255, 0));
      x.fillStyle = gr; x.fillRect(0, 0, S, S);
      x.restore();
      return o;
    }

    /* =======================================================================
       16. 焦げ跡デカール（透過）
       翌日の煤なので暖色は残らない。中心が最も濃く、爆風の向きに舌が伸びる。
       初回は中心を抜いたら背景が透けて「光る目」に見えたので、中心は必ず濃く塗る。
       ==================================================================== */
    function buildDecalScorch() {
      var S = 256, o = mk(S), x = o.x, cx = S / 2, cy = S / 2;
      var wx = fbm(S, 4, 3, 111), wy = fbm(S, 4, 3, 222);
      var tear = warp(S, fbm(S, 5, 4, 2468), wx, wy, 46);
      var fineF = fbm(S, 40, 3, 1357);
      var cSoot = toRGB(sh(P.grime, 0.55), [0, 0, 0]);
      var cEdge = toRGB(mix(P.grime, P.ash, 0.45), [0, 0, 0]);

      fillA(o, function (px, py, u, v, out) {
        var i = py * S + px;
        var dx = px - cx, dy = py - cy, r = Math.sqrt(dx * dx + dy * dy) / (S * 0.5);
        var wob = 0.48 + 0.62 * tear[i];
        var rr2 = r / wob;
        if (rr2 > 1.0) { out[3] = 0; return; }
        var a = (1 - smoothstep(0.05, 1.0, rr2)) * (0.60 + 0.50 * fineF[i]);
        lerp3(cSoot, cEdge, smoothstep(0.15, 0.95, rr2), out);
        out[3] = sat(a) * 235;
      });

      /* --- 爆風の吹き出し：一方向に長い舌。爆源の向きが読めるようにする -- */
      seed(8642);
      var i, base = rr(0, 6.28);
      x.save();
      for (i = 0; i < 34; i++) {
        var an = base + rr(-1.1, 1.1), len = rr(S * 0.16, S * 0.46), w = rr(1.5, 8);
        var gr = x.createLinearGradient(cx, cy, cx + Math.cos(an) * len, cy + Math.sin(an) * len);
        gr.addColorStop(0, CA(sh(P.grime, 0.75), 0.50));
        gr.addColorStop(1, CA(sh(P.grime, 0.75), 0));
        x.strokeStyle = gr; x.lineWidth = w; x.lineCap = 'round';
        x.beginPath();
        x.moveTo(cx + Math.cos(an) * S * 0.06, cy + Math.sin(an) * S * 0.06);
        x.lineTo(cx + Math.cos(an) * len, cy + Math.sin(an) * len);
        x.stroke();
      }
      x.restore();
      x.save();
      x.globalCompositeOperation = 'destination-in';
      var g2 = x.createRadialGradient(cx, cy, S * 0.20, cx, cy, S * 0.48);
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

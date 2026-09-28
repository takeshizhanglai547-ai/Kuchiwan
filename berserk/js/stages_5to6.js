'use strict';
/* =====================================================================
 *  stages_5to6.js ── ROUND 5「断罪の塔」 / ROUND 6「蝕」
 *   ROUND 5  雨の刑場（燃える火刑柱・柵の向こうの難民の群れ）
 *            → 塔の内部（螺旋階段・吊り檻・車輪刑・拷問具）
 *            → 嵐の塔の頂（鐘楼・胸壁・稲妻）            ボス: モズグス
 *   ROUND 6  蝕: 紅い空に穿たれた黒い太陽とコロナ、顔でできた崖、
 *            手の生えた肉の大地、捻じれた尖塔、宙を舞う使徒の影、降る灰
 *            （最後に「神の手」の岩の下で）              ボス: フェムト
 *
 *  背景の静的な絵はすべて BK.bg.layer で一度だけ描いてキャッシュし、
 *  毎フレームは drawImage と、炎・雨・稲妻・灰など少しの動く装飾だけを描く。
 *  区間の切り替え（刑場→塔内→屋上）は床と同じ速さ（係数1）で動く門の柱で隠す。
 * ===================================================================== */
(function (BK) {
  const U = BK.U, BG = BK.bg;
  const FT = BK.FLOOR_TOP;          // 212: 奥行き y=0 の足元の画面 y
  const FY = FT - 14;               // 床レイヤーの上端（BG.cobbles と同じ）
  const FH = BK.H - FY;             // 床レイヤーの高さ
  const TAU = Math.PI * 2;

  // ================================================================ 共通ヘルパー
  const spr = (c, cv, x, y) => c.drawImage(cv, x, y, cv.lw, cv.lh);
  /** BG.tile と同じ計算で、ループするレイヤーの先頭タイルの画面 x */
  function tile0(f, w, off) {
    let x = -((BK.cam.x * f + (off || 0)) % w);
    if (x > 0) x -= w;
    return x;
  }
  /** 画面の横範囲 [x0, x1] だけに描く（区間の切り替え用） */
  function section(c, x0, x1, fn) {
    x0 = Math.max(0, x0); x1 = Math.min(BK.W, x1);
    if (x1 <= x0) return;
    if (x0 <= 0 && x1 >= BK.W) { fn(); return; }
    c.save(); c.beginPath(); c.rect(x0, -20, x1 - x0, BK.H + 40); c.clip();
    fn();
    c.restore();
  }
  /** ループするレイヤー内で、端をまたぐ物を反対側にも描く */
  function wrapX(w, x, hw, fn) { fn(x); if (x - hw < 0) fn(x + w); if (x + hw > w) fn(x - w); }
  function vgrad(c, w, h, stops, y0) {
    const g = c.createLinearGradient(0, y0 || 0, 0, h);
    for (const s of stops) g.addColorStop(s[0], s[1]);
    c.fillStyle = g; c.fillRect(0, y0 || 0, w, h - (y0 || 0));
  }
  /** 整数の簡易ハッシュ → 0..1（毎フレームの雨粒などに使う） */
  function hash(n) {
    n = Math.imul((n ^ 61) ^ (n >>> 16), 9);
    n ^= n >>> 4; n = Math.imul(n, 0x27d4eb2d); n ^= n >>> 15;
    return (n >>> 0) / 4294967296;
  }
  // 雨・灰の粒の位置（固定の乱数表）
  const RA = [], RB = [];
  { const r = U.srand(777); for (let i = 0; i < 240; i++) { RA.push(r()); RB.push(r()); } }

  /** 放射状の光のスプライト（一度だけ作って drawImage で使い回す） */
  const GLOWC = { fire: '255,120,40', torch: '255,168,80' };
  function glowCv(name) {
    const rgb = GLOWC[name];
    return BG.layer('s56g_' + name, 64, 64, c => {
      const g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
      g.addColorStop(0, `rgba(${rgb},1)`); g.addColorStop(0.25, `rgba(${rgb},0.5)`);
      g.addColorStop(0.6, `rgba(${rgb},0.14)`); g.addColorStop(1, `rgba(${rgb},0)`);
      c.fillStyle = g; c.fillRect(0, 0, 64, 64);
    });
  }
  function glow(c, name, x, y, rx, a, ry, add) {
    if (a <= 0.01) return;
    ry = ry || rx;
    c.globalAlpha = a > 1 ? 1 : a;
    if (add) c.globalCompositeOperation = 'lighter';
    c.drawImage(glowCv(name), x - rx, y - ry, rx * 2, ry * 2);
    if (add) c.globalCompositeOperation = 'source-over';
    c.globalAlpha = 1;
  }
  /** 炎の舌を現在のパスに加える */
  function tongue(c, x, y, w, h, lean) {
    c.moveTo(x - w, y);
    c.quadraticCurveTo(x - w * 0.9, y - h * 0.55, x + lean, y - h);
    c.quadraticCurveTo(x + w * 0.9, y - h * 0.5, x + w, y);
    c.closePath();
  }
  const FIRE_COLS = ['#a82a16', '#ee7422', '#ffd27a'];
  /** 揺らめく炎（3色重ね・舌 n 本）。s = 大きさ */
  function fire(c, x, y, s, t, ph, n) {
    n = n || 3;
    for (let L = 0; L < 3; L++) {
      const k = 1 - L * 0.3;
      c.fillStyle = FIRE_COLS[L];
      c.beginPath();
      for (let i = 0; i < n; i++) {
        const u = n === 1 ? 0 : i / (n - 1) - 0.5;
        const f1 = Math.sin(t * (0.19 + i * 0.05) + ph + i * 2.1);
        const f2 = Math.sin(t * 0.43 + ph * 1.3 + i * 1.7);
        const hh = s * (22 + (1 - Math.abs(u) * 1.3) * 22 + f1 * 5) * k;
        tongue(c, x + u * s * 20 * k, y, s * 7 * k, hh, f2 * s * 5);
      }
      c.fill();
    }
  }
  /** 火の粉（画面座標・パーティクルを使わない軽い版） */
  function sparks(c, x, y, t, n, spread, ph) {
    c.fillStyle = '#ffb45a';
    for (let i = 0; i < n; i++) {
      const p = (t * 0.9 + i * 41 + ph * 13) % 80;
      const k = p / 80;
      c.globalAlpha = 1 - k;
      c.fillRect(x + Math.sin(p * 0.09 + i * 1.7 + ph) * spread * (0.3 + k), y - p * 1.1, 1.6, 1.6);
    }
    c.globalAlpha = 1;
  }
  /** 鎖（輪を交互に描く） */
  function chainLine(c, x0, y0, x1, y1, col, sz) {
    sz = sz || 1;
    const dx = x1 - x0, dy = y1 - y0, d = Math.hypot(dx, dy) || 1;
    const n = Math.max(1, Math.round(d / (4.4 * sz))), ang = Math.atan2(dy, dx);
    c.strokeStyle = col; c.lineWidth = 1.1 * sz;
    c.beginPath();
    for (let i = 0; i < n; i++) {
      const k = (i + 0.5) / n, x = x0 + dx * k, y = y0 + dy * k;
      if (i % 2) { c.moveTo(x - Math.cos(ang) * 2.4 * sz, y - Math.sin(ang) * 2.4 * sz); c.lineTo(x + Math.cos(ang) * 2.4 * sz, y + Math.sin(ang) * 2.4 * sz); }
      else { c.moveTo(x + Math.cos(ang) * 2.8 * sz, y + Math.sin(ang) * 2.8 * sz); c.ellipse(x, y, 2.8 * sz, 1.5 * sz, ang, 0, TAU); }
    }
    c.stroke();
  }
  /** 床の石: パースの付いた行ごとに、幅の揃わない石を継ぎ目なく並べる */
  function stoneFloor(c, w, h, r, o) {
    let y = 0, rh = o.h0, row = 0;
    while (y < h) {
      const n = Math.max(2, Math.round(w / (rh * o.ratio)));
      const ws = []; let sum = 0;
      for (let i = 0; i < n; i++) { const v = 0.7 + r() * 0.6; ws.push(v); sum += v; }
      let x = r() * w;
      for (let i = 0; i < n; i++) {
        const sw = ws[i] / sum * w;
        const tone = o.tone(r, row, y / h);
        const xx = x;
        wrapX(w, xx + sw / 2, sw / 2, cx => {
          const x0 = cx - sw / 2;
          c.fillStyle = tone; c.fillRect(x0 + 0.5, y + 0.5, sw - 1, rh - 1);
          if (o.hi) { c.fillStyle = o.hi; c.fillRect(x0 + 1, y + 0.5, sw - 2, Math.max(0.8, rh * 0.1)); }
          c.fillStyle = o.joint; c.fillRect(x0 - 0.5, y, 1.2, rh); c.fillRect(x0, y - 0.5, sw, 1.1);
          if (o.each) o.each(c, x0, y, sw, rh, r);
        });
        x += sw;
      }
      y += rh; rh *= o.grow; row++;
    }
  }
  /** 床上端の影（壁際を暗く） */
  function floorShade(c, w, a, hgt) {
    const g = c.createLinearGradient(0, 0, 0, hgt || 34);
    g.addColorStop(0, `rgba(0,0,0,${a})`); g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g; c.fillRect(0, 0, w, hgt || 34);
  }
  /** 雨: 斜めの筋（1回の stroke） */
  function rain(c, t, n, len, slant, spd, col, lw, seed) {
    const W = BK.W, H = BK.H, m = W + 80;
    c.strokeStyle = col; c.lineWidth = lw;
    c.beginPath();
    for (let i = 0; i < n; i++) {
      const j = (i + seed) % RA.length;
      const sp = spd * (0.8 + RB[j] * 0.4);
      const y = (RB[j] * (H + len) + t * sp) % (H + len) - len;
      let x = (RA[j] * m - slant * y - BK.cam.x * 0.3) % m;
      if (x < 0) x += m;
      x -= 40;
      c.moveTo(x, y); c.lineTo(x - slant * len, y + len);
    }
    c.stroke();
  }
  /** 床に跳ねる雨粒の輪 */
  function splashes(c, t, n, col) {
    const W = BK.W;
    c.strokeStyle = col; c.lineWidth = 1;
    c.beginPath();
    for (let i = 0; i < n; i++) {
      const per = 24, tt = t + i * 7, ph = tt % per, cyc = Math.floor(tt / per);
      if (ph > 10) continue;
      const y = FY + 18 + hash(cyc * 17 + i * 53 + 9) * (FH - 22);
      const x = hash(cyc * 31 + i * 101) * W;
      const d = 0.5 + (y - FY) / FH, rx = (1.5 + ph * 0.5) * d;
      c.moveTo(x + rx, y); c.ellipse(x, y, rx, rx * 0.3, 0, 0, TAU);
      if (ph < 4) { c.moveTo(x - 1, y - 1); c.lineTo(x - 2 * d, y - 4 * d); c.moveTo(x + 1, y - 1); c.lineTo(x + 2 * d, y - 4 * d); }
    }
    c.stroke();
  }
  /** 稲妻の形（画面座標） */
  function makeBolt(x, y0, y1, seed) {
    const r = U.srand(seed), pts = [x, y0];
    let cx = x, cy = y0;
    while (cy < y1) { cy += 7 + r() * 13; cx += (r() - 0.5) * 26; pts.push(cx, cy); }
    const bi = 2 + Math.floor(r() * Math.max(1, pts.length / 2 - 4));
    let bx = pts[bi * 2], by = pts[bi * 2 + 1];
    const br = [bx, by], dir = r() < 0.5 ? -1 : 1;
    for (let i = 0; i < 5; i++) { bx += dir * (5 + r() * 12); by += 5 + r() * 10; br.push(bx, by); }
    return [pts, br];
  }
  function drawBolt(c, bolt, a) {
    c.lineJoin = 'round';
    for (let p = 0; p < 2; p++) {
      c.lineWidth = p ? 1.8 : 6;
      c.strokeStyle = p ? `rgba(240,245,255,${a})` : `rgba(150,170,255,${0.25 * a})`;
      c.beginPath();
      for (const pts of bolt) { c.moveTo(pts[0], pts[1]); for (let i = 2; i < pts.length; i += 2) c.lineTo(pts[i], pts[i + 1]); }
      c.stroke();
    }
  }
  /** 雷鳴（低いノイズのうなり）。音が使えない時は何もしない */
  function thunder(vol) {
    const A = BK.audio;
    try {
      if (!A || !A.ready || !A.ready() || A.muted || !A.noise) return;
      A.noise({ filter: 'lowpass', f0: 520, f1: 60, dur: 1.0, vol: 0.55 * vol, attack: 0.03, rate: 0.5, verb: true });
      A.tone({ type: 'sine', f0: 52, f1: 28, dur: 1.2, vol: 0.35 * vol });
    } catch (e) { /* ignore */ }
  }
  /** 聖鉄鎖騎士団 / 法王庁の紋（金の輪と十字） */
  function emblem(c, x, y, s) {
    c.strokeStyle = '#b8903c'; c.lineWidth = 1.6 * s;
    c.beginPath(); c.arc(x, y, 7 * s, 0, TAU); c.stroke();
    c.lineWidth = 2 * s;
    c.beginPath(); c.moveTo(x, y - 11 * s); c.lineTo(x, y + 11 * s); c.moveTo(x - 6 * s, y - 2 * s); c.lineTo(x + 6 * s, y - 2 * s); c.stroke();
  }
  /** 吊り下げの旗（破れた裾） */
  function banner(c, x, y, w, h, r, col, dark) {
    c.fillStyle = col;
    c.beginPath(); c.moveTo(x, y); c.lineTo(x + w, y); c.lineTo(x + w, y + h);
    const n = 5;
    for (let i = n; i >= 0; i--) c.lineTo(x + w * i / n, y + h - (i % 2 ? 8 + r() * 6 : r() * 3));
    c.closePath(); c.fill();
    c.fillStyle = dark; c.fillRect(x + w * 0.72, y, w * 0.28, h - 6);
    c.fillStyle = '#6a1418'; c.fillRect(x, y + 3, w, 2.5); c.fillRect(x + 2, y, 2, h - 8); c.fillRect(x + w - 4, y, 2, h - 10);
    emblem(c, x + w / 2, y + h * 0.4, w / 34);
    // 雨で滲んだ筋
    c.fillStyle = 'rgba(40,30,30,0.18)';
    for (let i = 0; i < 4; i++) c.fillRect(x + 3 + r() * (w - 6), y + 6, 1.4, h * (0.4 + r() * 0.4));
  }

  // ================================================================
  //  ROUND 5  断罪の塔
  // ================================================================
  const LEN5 = 4000;
  const X_GATE = 1450;                 // 刑場 → 塔内（床の x）
  const X_ROOF = 2950;                 // 塔内 → 屋上
  const PYRES = [150, 540, 880];       // 火刑柱（係数 0.45 / 周期 1100）
  const TORCH_A = [430, 930];          // 刑場の柵の松明（係数 0.75 / 1000）
  const WIN_B = [170, 390, 610, 830, 1050]; // 塔内の窓（係数 0.4 / 1100）
  const TORCH_B = [170, 460, 740, 950];     // 塔内の壁の松明（係数 0.8 / 1000）
  const BRAZ_C = [220, 700];           // 屋上の篝火（係数 0.85 / 960）

  // ---------------------------------------------------------- 刑場
  function r5SkyA(c, w, h) { vgrad(c, w, h, [[0, '#06070c'], [0.4, '#10131c'], [0.72, '#221c25'], [1, '#48281f']]); }
  function r5SkyC(c, w, h) { vgrad(c, w, h, [[0, '#05060b'], [0.35, '#0e121c'], [0.62, '#1e2432'], [0.8, '#2c3242'], [1, '#3a3640']]); }
  function r5Clouds(c, w, h) {
    const r = U.srand(5101);
    for (let i = 0; i < 30; i++) {
      const cx = r() * w, cy = 14 + r() * (h - 46), n = 4 + Math.floor(r() * 5), sc = 0.6 + r() * 0.8;
      const blobs = [];
      for (let j = 0; j < n; j++) blobs.push([cx + (r() - 0.5) * 160 * sc, cy + (r() - 0.5) * 18 * sc, (30 + r() * 50) * sc, (8 + r() * 12) * sc]);
      c.fillStyle = 'rgba(78,58,62,0.2)';
      for (const b of blobs) wrapX(w, b[0], b[2], x => { c.beginPath(); c.ellipse(x, b[1] + 5, b[2], b[3], 0, 0, TAU); c.fill(); });
      c.fillStyle = i % 3 ? 'rgba(11,13,20,0.92)' : 'rgba(19,21,30,0.92)';
      for (const b of blobs) wrapX(w, b[0], b[2], x => { c.beginPath(); c.ellipse(x, b[1], b[2], b[3], 0, 0, TAU); c.fill(); });
    }
  }
  /** 遠景: 岩山の上にそびえる断罪の塔 */
  function r5Tower(c, w, h) {
    const r = U.srand(5202), cx = w / 2;
    // 塔の背後の雲の照り返し（刑場の炎）
    const g = c.createRadialGradient(cx, 90, 6, cx, 110, 175);
    g.addColorStop(0, 'rgba(150,84,64,0.32)'); g.addColorStop(0.5, 'rgba(110,56,48,0.14)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
    const top = 44, bot = h - 46;
    const body = (dx, dy, col) => {
      c.fillStyle = col;
      // 岩山
      c.beginPath(); c.moveTo(0 + dx, h);
      const rr = U.srand(5203);
      for (let x = 0; x <= w; x += 8) { const k = Math.sin(x / w * Math.PI); c.lineTo(x + dx, h - 12 - Math.pow(k, 1.5) * 70 - rr() * 7 + dy); }
      c.lineTo(w + dx, h); c.closePath(); c.fill();
      // 塔（わずかに先細り）と控え壁
      c.beginPath(); c.moveTo(cx - 62 + dx, bot + dy); c.lineTo(cx - 50 + dx, top + 18 + dy); c.lineTo(cx + 50 + dx, top + 18 + dy); c.lineTo(cx + 62 + dx, bot + dy); c.closePath(); c.fill();
      for (const s of [-1, 1]) { c.beginPath(); c.moveTo(cx + s * 86 + dx, bot + 10 + dy); c.lineTo(cx + s * 62 + dx, bot - 90 + dy); c.lineTo(cx + s * 56 + dx, bot + 10 + dy); c.closePath(); c.fill(); }
      // 張り出しと狭間
      c.fillRect(cx - 66 + dx, top + dy, 132, 20);
      for (let x = cx - 66; x < cx + 66; x += 14) c.fillRect(x + dx, top - 11 + dy, 9, 12);
      // 小塔と尖塔
      c.fillRect(cx + 22 + dx, top - 30 + dy, 20, 30);
      c.beginPath(); c.moveTo(cx + 18 + dx, top - 30 + dy); c.lineTo(cx + 32 + dx, top - 58 + dy); c.lineTo(cx + 46 + dx, top - 30 + dy); c.closePath(); c.fill();
      c.fillRect(cx - 42 + dx, top - 20 + dy, 14, 20);
      c.beginPath(); c.moveTo(cx - 45 + dx, top - 20 + dy); c.lineTo(cx - 35 + dx, top - 38 + dy); c.lineTo(cx - 25 + dx, top - 20 + dy); c.closePath(); c.fill();
    };
    body(-1.6, -1.2, '#2a2c3c');   // 縁の明かり
    body(0, 0, '#0c0e15');
    // 石積みの横筋
    c.strokeStyle = 'rgba(46,50,68,0.45)'; c.lineWidth = 1;
    c.beginPath(); for (let y = top + 32; y < bot; y += 12) { c.moveTo(cx - 52, y); c.lineTo(cx + 52, y); } c.stroke();
    // 窓（ほのかな灯り）
    for (let i = 0; i < 11; i++) {
      const wx = cx - 42 + r() * 84, wy = top + 34 + r() * (bot - top - 56);
      c.fillStyle = r() < 0.5 ? '#a8521e' : '#5e2c14'; c.fillRect(wx, wy, 2.5, 5);
    }
    // 頂の大窓（モズグスの居所）
    c.fillStyle = '#e8903e';
    c.beginPath(); c.moveTo(cx - 7, top + 40); c.lineTo(cx - 7, top + 31); c.arc(cx, top + 31, 7, Math.PI, 0); c.lineTo(cx + 7, top + 40); c.closePath(); c.fill();
    c.fillStyle = '#0c0e15'; c.fillRect(cx - 0.8, top + 24, 1.6, 16); c.fillRect(cx - 7, top + 33, 14, 1.4);
  }
  /** 遠景: 柵の向こうに押し寄せる難民の群れ（逆光のシルエット）と天幕 */
  function r5Crowd(c, w, h) {
    const r = U.srand(5303);
    // 背後の炎の照り返し
    const g = c.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, 'rgba(160,60,26,0)'); g.addColorStop(0.55, 'rgba(160,62,26,0.28)'); g.addColorStop(1, 'rgba(90,30,18,0.2)');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
    // 天幕（奥）
    for (let x = 10; x < w; x += 50 + r() * 60) {
      const tw = 24 + r() * 26, th = 16 + r() * 18, by = h - 30;
      wrapX(w, x, tw, xx => {
        c.fillStyle = '#131118';
        c.beginPath(); c.moveTo(xx - tw / 2, by); c.lineTo(xx, by - th); c.lineTo(xx + tw / 2, by); c.closePath(); c.fill();
        c.strokeStyle = '#131118'; c.lineWidth = 1; c.beginPath(); c.moveTo(xx, by - th); c.lineTo(xx + 2, by - th - 5); c.stroke();
      });
      if (r() < 0.4) { c.fillStyle = '#ff8a3a'; c.fillRect(x + tw * 0.2, by - 3, 2, 2); }
    }
    // 人々（2列）: 輪郭を炎の色で縁取ってから黒で塗る
    const person = (x, by, s, rim, body, kind) => {
      const pass = (dx, dy, col) => {
        c.fillStyle = col; c.strokeStyle = col;
        const sh = 7 * s, top = by - 34 * s;
        c.beginPath();
        c.moveTo(x - sh + dx, by + dy); c.lineTo(x - sh * 0.9 + dx, top + 8 * s + dy);
        c.quadraticCurveTo(x + dx, top + 3 * s + dy, x + sh * 0.9 + dx, top + 8 * s + dy); c.lineTo(x + sh + dx, by + dy); c.closePath(); c.fill();
        if (kind === 1) { // 頭巾
          c.beginPath(); c.moveTo(x - 4.6 * s + dx, top + 8 * s + dy); c.lineTo(x + dx - s, top - 7 * s + dy); c.lineTo(x + 4.6 * s + dx, top + 8 * s + dy); c.closePath(); c.fill();
        } else { c.beginPath(); c.arc(x + dx, top + 2 * s + dy, 4.2 * s, 0, TAU); c.fill(); }
        if (kind === 2) { // 拳を突き上げる
          c.lineWidth = 2.4 * s; c.beginPath(); c.moveTo(x + sh * 0.7 + dx, top + 10 * s + dy); c.lineTo(x + sh * 1.2 + dx, top - 12 * s + dy); c.stroke();
          c.beginPath(); c.arc(x + sh * 1.2 + dx, top - 13 * s + dy, 2 * s, 0, TAU); c.fill();
        }
        if (kind === 3) { // 松明・熊手を掲げる
          c.lineWidth = 1.4 * s; c.beginPath(); c.moveTo(x - sh * 0.6 + dx, by - 10 * s + dy); c.lineTo(x - sh * 1.1 + dx, top - 18 * s + dy); c.stroke();
        }
      };
      pass(-0.9, -0.9, rim); pass(0, 0, body);
      if (kind === 3) { c.fillStyle = '#ffae4a'; c.beginPath(); c.arc(x - 7 * s * 1.1, by - 34 * s - 19 * s, 1.8 * s, 0, TAU); c.fill(); }
    };
    for (let row = 0; row < 2; row++) {
      const s0 = row ? 1 : 0.78, by = h - (row ? 0 : 8);
      for (let x = r() * 6; x < w; x += (row ? 9 : 8) + r() * 7) {
        const s = s0 * (0.85 + r() * 0.3), kr = r();
        const kind = kr < 0.28 ? 1 : kr < 0.36 ? 2 : kr < 0.41 ? 3 : 0;
        const yy = by + r() * 3;
        wrapX(w, x, 14 * s, xx => person(xx, yy, s, row ? '#7a3418' : '#4a2016', row ? '#08080b' : '#0d0c11', kind));
      }
    }
  }
  /** 火刑柱（杭・縛られた影・薪の山）: 炎は毎フレーム描く。w=110, h=112 */
  function r5Pyre(c, w, h) {
    const cx = w / 2, r = U.srand(5404);
    c.fillStyle = '#161010';
    c.fillRect(cx - 3, 4, 6, h - 4);
    c.fillRect(cx - 14, 20, 28, 4);
    // 縛られた人影（様式化したシルエット）
    c.fillStyle = '#080506';
    c.beginPath(); c.arc(cx + 1, 15, 4.6, 0, TAU); c.fill();
    c.beginPath(); c.moveTo(cx - 6, 22); c.lineTo(cx + 7, 22); c.lineTo(cx + 5, 58); c.lineTo(cx - 5, 58); c.closePath(); c.fill();
    c.strokeStyle = '#3a2c20'; c.lineWidth = 1;
    c.beginPath(); c.moveTo(cx - 6, 32); c.lineTo(cx + 6, 34); c.moveTo(cx - 5, 48); c.lineTo(cx + 5, 50); c.stroke();
    // 薪の山
    c.fillStyle = '#1c130e';
    c.beginPath(); c.moveTo(2, h); c.quadraticCurveTo(cx, h - 78, w - 2, h); c.closePath(); c.fill();
    for (let i = 0; i < 26; i++) {
      const a = r() * Math.PI, rr = r() * 34;
      const x = cx + Math.cos(a) * rr * 1.4, y = h - 6 - Math.sin(a) * rr * 0.9;
      c.strokeStyle = r() < 0.5 ? '#3e2818' : '#2a1a10'; c.lineWidth = 3.2;
      const ang = (r() - 0.5) * 1.2;
      c.beginPath(); c.moveTo(x - Math.cos(ang) * 11, y - Math.sin(ang) * 11); c.lineTo(x + Math.cos(ang) * 11, y + Math.sin(ang) * 11); c.stroke();
    }
    // 燃えさし
    for (let i = 0; i < 18; i++) { c.fillStyle = r() < 0.5 ? '#ff6a1a' : '#b83010'; c.fillRect(cx - 34 + r() * 68, h - 4 - r() * 30, 2, 1.5); }
  }
  /** 近景: 刑場を囲む低い石垣と鉄柵・聖鉄鎖騎士団の旗 */
  function r5WallA(c, w, h) {
    const r = U.srand(5505), wt = h - 42;
    // 石垣
    c.fillStyle = '#121318'; c.fillRect(0, wt, w, h - wt);
    for (let y = wt + 6, row = 0; y < h; y += 12, row++) {
      for (let x = (row % 2) * 18 - 30; x < w; x += 30 + r() * 12) {
        const v = 34 + r() * 16, bw = 27 + r() * 10;
        c.fillStyle = `rgb(${v + 2 | 0},${v | 0},${v + 4 | 0})`; c.fillRect(x + 1, y + 1, bw, 10.5);
        c.fillStyle = 'rgba(190,120,80,0.12)'; c.fillRect(x + 1, y + 1, bw, 1.4);
      }
    }
    // 炎の照り返し（上ほど明るい）
    const lg = c.createLinearGradient(0, wt, 0, h);
    lg.addColorStop(0, 'rgba(170,80,40,0.16)'); lg.addColorStop(1, 'rgba(0,0,0,0.3)');
    c.fillStyle = lg; c.fillRect(0, wt, w, h - wt);
    // 笠石（濡れて光る）
    c.fillStyle = '#383a44'; c.fillRect(0, wt - 2, w, 8);
    c.fillStyle = '#6a6c78'; c.fillRect(0, wt - 2, w, 1.2);
    c.fillStyle = 'rgba(0,0,0,0.5)'; c.fillRect(0, wt + 6, w, 2);
    // 濡れた壁面の筋
    c.fillStyle = 'rgba(120,130,160,0.08)';
    for (let i = 0; i < 40; i++) c.fillRect(r() * w, wt + 8, 1, 6 + r() * 26);
    // 鉄柵
    const ft = wt - 34;
    c.strokeStyle = '#0b0b0f'; c.lineWidth = 1.7;
    c.beginPath();
    for (let x = 4; x < w; x += 9) { c.moveTo(x, wt - 2); c.lineTo(x, ft); }
    c.moveTo(0, ft + 6); c.lineTo(w, ft + 6); c.moveTo(0, wt - 8); c.lineTo(w, wt - 8);
    c.stroke();
    c.fillStyle = '#0b0b0f';
    for (let x = 4; x < w; x += 9) { c.beginPath(); c.moveTo(x - 2.4, ft + 1); c.lineTo(x, ft - 5); c.lineTo(x + 2.4, ft + 1); c.closePath(); c.fill(); }
    // 柵の親柱
    for (let x = 40; x < w; x += 100) {
      c.fillStyle = '#26272e'; c.fillRect(x - 5, ft - 4, 10, wt - ft + 4);
      c.fillStyle = '#3a3c46'; c.fillRect(x - 5, ft - 4, 2, wt - ft + 4);
      c.beginPath(); c.arc(x, ft - 7, 5, 0, TAU); c.fillStyle = '#26272e'; c.fill();
    }
    // 松明の腕木
    for (const tx of TORCH_A) { c.fillStyle = '#16120e'; c.fillRect(tx - 2, ft - 8, 4, 16); c.fillRect(tx - 5, ft - 10, 10, 4); }
    // 旗竿と旗
    for (const bx of [180, 690]) {
      c.fillStyle = '#17120e'; c.fillRect(bx - 2, 0, 4, wt);
      c.fillRect(bx - 22, 6, 44, 3);
      c.beginPath(); c.arc(bx, 3, 4, 0, TAU); c.fillStyle = '#8a7040'; c.fill();
      banner(c, bx - 19, 9, 38, 70, r, '#cdc6b4', '#a8a090');
    }
  }
  /** 刑場の床: 雨に濡れた石畳と水たまり */
  function r5FloorA(c, w, h) {
    const r = U.srand(5606);
    vgrad(c, w, h, [[0, '#121319'], [1, '#2a2a31']]);
    stoneFloor(c, w, h, r, {
      h0: 7, grow: 1.16, ratio: 2.8, joint: 'rgba(0,0,0,0.55)', hi: 'rgba(150,150,170,0.08)',
      tone: (rr, row, k) => { const v = 20 + k * 22 + rr() * 12; return `rgb(${v | 0},${v + 1 | 0},${v + 6 | 0})`; },
    });
    // 水たまり（空と炎を映す）
    for (let i = 0; i < 9; i++) {
      const y = 20 + r() * (h - 30), d = 0.5 + y / h, x = r() * w, rx = (26 + r() * 40) * d, ry = (3 + r() * 3) * d;
      wrapX(w, x, rx, xx => {
        c.fillStyle = 'rgba(14,16,24,0.85)'; c.beginPath(); c.ellipse(xx, y, rx, ry, 0, 0, TAU); c.fill();
        c.fillStyle = 'rgba(190,90,40,0.22)'; c.fillRect(xx - rx * 0.4, y - ry * 0.3, rx * 0.25, 1.2);
        c.fillRect(xx + rx * 0.1, y, rx * 0.35, 1);
        c.strokeStyle = 'rgba(120,130,160,0.22)'; c.lineWidth = 0.8; c.beginPath(); c.ellipse(xx, y, rx, ry, 0, Math.PI * 1.1, Math.PI * 1.9); c.stroke();
      });
    }
    // 炎の照り返し（奥ほど強い）
    const wg = c.createLinearGradient(0, 0, 0, h * 0.6);
    wg.addColorStop(0, 'rgba(190,90,40,0.14)'); wg.addColorStop(1, 'rgba(190,90,40,0)');
    c.fillStyle = wg; c.fillRect(0, 0, w, h * 0.6);
    // 焦げ跡・灰
    for (let i = 0; i < 14; i++) { const y = r() * h, x = r() * w, d = 0.5 + y / h; c.fillStyle = 'rgba(8,6,6,0.35)'; c.beginPath(); c.ellipse(x, y, 10 * d, 2.5 * d, 0, 0, TAU); c.fill(); }
    floorShade(c, w, 0.6);
  }

  // ---------------------------------------------------------- 塔内
  /** 塔内の遠景: 吹き抜けの螺旋階段・柱・細長い窓・吊り檻 */
  function r5InFar(c, w, h) {
    const r = U.srand(5707);
    c.fillStyle = '#101117'; c.fillRect(0, 0, w, h);
    c.fillStyle = 'rgba(0,0,0,0.35)';
    for (let y = 0; y < h; y += 10) c.fillRect(0, y, w, 1);
    for (let i = 0; i < 90; i++) { c.fillStyle = r() < 0.5 ? 'rgba(40,42,54,0.35)' : 'rgba(0,0,0,0.3)'; c.fillRect(r() * w, r() * h, 12 + r() * 20, 5 + r() * 4); }
    // 螺旋階段（右上がりの帯が壁を巡る）: 継ぎ目なく繋がるよう傾き×幅 = 周期の整数倍
    const P = 70, slope = (P * 3) / w;
    for (let k = -1; k < 7; k++) {
      const y0 = 40 + k * P;
      const yAt = x => y0 + slope * (w - x) - P * 3 + 20;
      c.fillStyle = '#1b1c25';
      c.beginPath(); c.moveTo(0, yAt(0)); c.lineTo(w, yAt(w)); c.lineTo(w, yAt(w) + 8); c.lineTo(0, yAt(0) + 8); c.closePath(); c.fill();
      c.fillStyle = '#0a0a0e';
      c.beginPath(); c.moveTo(0, yAt(0) + 8); c.lineTo(w, yAt(w) + 8); c.lineTo(w, yAt(w) + 11); c.lineTo(0, yAt(0) + 11); c.closePath(); c.fill();
      // 段と手摺
      c.fillStyle = '#23242e';
      for (let x = 0; x < w; x += 9) c.fillRect(x, yAt(x) - 2, 5, 2);
      c.strokeStyle = '#15161d'; c.lineWidth = 1.2;
      c.beginPath();
      for (let x = 3; x < w; x += 20) { c.moveTo(x, yAt(x)); c.lineTo(x, yAt(x) - 11); }
      c.moveTo(0, yAt(0) - 11); c.lineTo(w, yAt(w) - 11);
      c.stroke();
    }
    // 柱と尖頭アーチ
    for (let i = 0; i < 5; i++) {
      const x = 60 + i * 220;
      c.fillStyle = '#1b1c24'; c.fillRect(x - 17, 22, 34, h - 22);
      c.fillStyle = '#272934'; c.fillRect(x - 17, 22, 3, h - 22);
      c.fillStyle = '#0b0b10'; c.fillRect(x + 14, 22, 3, h - 22);
      c.fillStyle = '#23242e'; c.fillRect(x - 21, 22, 42, 7);
      c.strokeStyle = '#1b1c24'; c.lineWidth = 6;
      c.beginPath(); c.moveTo(x + 17, 26); c.quadraticCurveTo(x + 70, 20, x + 110, -14); c.moveTo(x - 17, 26); c.quadraticCurveTo(x - 70, 20, x - 110, -14); c.stroke();
    }
    // 細長い窓（稲光で光る部分は毎フレーム重ねる）
    for (const wx of WIN_B) {
      c.fillStyle = '#07080c'; c.beginPath(); c.moveTo(wx - 9, 100); c.lineTo(wx - 9, 50); c.arc(wx, 50, 9, Math.PI, 0); c.lineTo(wx + 9, 100); c.closePath(); c.fill();
      c.fillStyle = '#18203a'; c.beginPath(); c.moveTo(wx - 6, 97); c.lineTo(wx - 6, 50); c.arc(wx, 50, 6, Math.PI, 0); c.lineTo(wx + 6, 97); c.closePath(); c.fill();
      c.fillStyle = '#07080c'; c.fillRect(wx - 0.8, 42, 1.6, 56); c.fillRect(wx - 6, 70, 12, 1.6);
      c.fillStyle = '#23242e'; c.fillRect(wx - 11, 100, 22, 4);
    }
    // 吊り檻
    for (const [x, len, body] of [[225, 46, true], [505, 24, false], [665, 64, true], [995, 34, true]]) {
      chainLine(c, x, 0, x, len, '#0c0c10', 0.8);
      c.strokeStyle = '#0c0c10'; c.lineWidth = 1.2;
      c.beginPath(); c.arc(x, len + 8, 8, Math.PI, 0);
      for (let i = -8; i <= 8; i += 4) { c.moveTo(x + i, len + 8); c.lineTo(x + i, len + 30); }
      c.moveTo(x - 9, len + 30); c.lineTo(x + 9, len + 30); c.stroke();
      if (body) { c.fillStyle = '#08080b'; c.beginPath(); c.ellipse(x - 1, len + 22, 4, 7, 0.3, 0, TAU); c.fill(); c.beginPath(); c.arc(x - 3, len + 13, 3, 0, TAU); c.fill(); }
    }
    // 下ほど闇に沈む
    const g = c.createLinearGradient(0, 110, 0, h);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.65)');
    c.fillStyle = g; c.fillRect(0, 110, w, h - 110);
  }
  /** 塔内の近景の壁: 車輪刑・檻・晒し台・鎖・聖人像 */
  function r5InWall(c, w, h) {
    const r = U.srand(5808);
    c.fillStyle = '#1f2027'; c.fillRect(0, 0, w, h);
    for (let y = 8, row = 0; y < h; y += 16, row++) {
      for (let x = (row % 2) * 20 - 40; x < w; x += 32 + r() * 16) {
        const v = 28 + r() * 12;
        c.fillStyle = `rgb(${v | 0},${v + 1 | 0},${v + 8 | 0})`; c.fillRect(x + 1, y + 1, 30 + r() * 14, 14);
      }
    }
    c.fillStyle = 'rgba(0,0,0,0.5)'; for (let y = 8; y < h; y += 16) c.fillRect(0, y, w, 1.2);
    // 蛇腹（上端）
    c.fillStyle = '#2e2f38'; c.fillRect(0, 0, w, 8);
    c.fillStyle = '#3e404b'; c.fillRect(0, 0, w, 1.5);
    c.fillStyle = 'rgba(0,0,0,0.55)'; c.fillRect(0, 8, w, 3);
    for (let x = 12; x < w; x += 40) { c.fillStyle = '#2a2b33'; c.fillRect(x, 8, 8, 6); }
    // 車輪刑の車輪（柱に掲げる）
    const wheel = (x, y, R) => {
      c.fillStyle = '#1a130e'; c.fillRect(x - 3, y, 6, h - y);
      c.strokeStyle = '#3a2a1c'; c.lineWidth = 5; c.beginPath(); c.arc(x, y, R, 0, TAU); c.stroke();
      c.strokeStyle = '#24190f'; c.lineWidth = 1.5; c.beginPath(); c.arc(x, y, R - 3.5, 0, TAU); c.stroke();
      c.strokeStyle = '#33251a'; c.lineWidth = 2.4; c.beginPath();
      for (let i = 0; i < 10; i++) { const a = i / 10 * TAU; c.moveTo(x + Math.cos(a) * 4, y + Math.sin(a) * 4); c.lineTo(x + Math.cos(a) * (R - 3), y + Math.sin(a) * (R - 3)); }
      c.stroke();
      c.fillStyle = '#20160e'; c.beginPath(); c.arc(x, y, 5.5, 0, TAU); c.fill();
      c.fillStyle = '#6a6a72'; for (let i = 0; i < 12; i++) { const a = i / 12 * TAU; c.fillRect(x + Math.cos(a) * R - 1, y + Math.sin(a) * R - 1, 2, 2); }
      c.fillStyle = 'rgba(70,12,14,0.55)'; for (let i = 0; i < 6; i++) c.fillRect(x - R * 0.6 + r() * R * 1.2, y + R * 0.4 + r() * 6, 2, 3 + r() * 5);
    };
    wheel(90, 52, 30);
    // 法王庁の旗
    c.fillStyle = '#17120e'; c.fillRect(226, 12, 48, 3);
    banner(c, 231, 15, 38, 84, r, '#cfc8b6', '#aaa292');
    // 鉄の檻（床置き）
    c.fillStyle = 'rgba(6,6,8,0.7)'; c.fillRect(358, 42, 46, h - 42);
    c.strokeStyle = '#111116'; c.lineWidth = 2;
    c.beginPath(); for (let x = 358; x <= 404; x += 7.6) { c.moveTo(x, 42); c.lineTo(x, h); } c.stroke();
    c.lineWidth = 4; c.beginPath(); c.moveTo(355, 42); c.lineTo(407, 42); c.moveTo(355, 86); c.lineTo(407, 86); c.stroke();
    c.lineWidth = 2; c.beginPath(); c.arc(381, 42, 23, Math.PI, 0); c.moveTo(381, 19); c.lineTo(381, 10); c.stroke();
    c.fillStyle = '#060608'; c.beginPath(); c.arc(386, 92, 5, 0, TAU); c.fill(); c.fillRect(380, 96, 12, 22);
    // 壁の鎖と枷
    for (const [x, len] of [[540, 52], [566, 38], [592, 60]]) {
      c.fillStyle = '#0e0e12'; c.beginPath(); c.arc(x, 22, 3, 0, TAU); c.fill();
      chainLine(c, x, 24, x + (r() - 0.5) * 6, 22 + len, '#15151a', 1);
      c.strokeStyle = '#1c1c22'; c.lineWidth = 2.5; c.beginPath(); c.arc(x, 26 + len, 5, -0.4, Math.PI + 0.4); c.stroke();
      c.fillStyle = 'rgba(66,12,14,0.45)'; c.fillRect(x - 1, 30 + len, 1.5, 8 + r() * 14);
    }
    // 晒し台
    c.fillStyle = '#1e1610'; c.fillRect(676, 62, 8, h - 62);
    c.fillStyle = '#34261a'; c.fillRect(642, 56, 76, 14);
    c.fillStyle = '#22180f'; c.fillRect(642, 62, 76, 1.5);
    c.fillStyle = '#08080a'; for (const hx of [656, 680, 704]) { c.beginPath(); c.arc(hx, 63, hx === 680 ? 5 : 3.5, 0, TAU); c.fill(); }
    // 壁龕の聖人像
    c.fillStyle = '#121318';
    c.beginPath(); c.moveTo(810, 112); c.lineTo(810, 40); c.quadraticCurveTo(812, 18, 840, 12); c.quadraticCurveTo(868, 18, 870, 40); c.lineTo(870, 112); c.closePath(); c.fill();
    c.fillStyle = '#2e3039';
    c.beginPath(); c.moveTo(826, 108); c.lineTo(830, 48); c.lineTo(850, 48); c.lineTo(854, 108); c.closePath(); c.fill();
    c.beginPath(); c.arc(840, 40, 7, 0, TAU); c.fill();
    c.strokeStyle = '#6a5a38'; c.lineWidth = 1; c.beginPath(); c.arc(840, 38, 11, Math.PI * 1.1, Math.PI * 1.9); c.stroke();
    c.fillStyle = '#3a3c46'; c.fillRect(826, 48, 2, 58); c.beginPath(); c.moveTo(836, 62); c.lineTo(840, 54); c.lineTo(844, 62); c.closePath(); c.fill();
    c.fillStyle = '#2a2b33'; c.fillRect(806, 108, 68, 6);
    // 松明の燭台
    for (const tx of TORCH_B) { c.fillStyle = '#121014'; c.fillRect(tx - 1.5, 36, 3, 12); c.fillRect(tx - 5, 34, 10, 3); c.fillRect(tx - 3, 46, 6, 3); }
    // 床際の影
    const g = c.createLinearGradient(0, h - 16, 0, h);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.55)');
    c.fillStyle = g; c.fillRect(0, h - 16, w, 16);
  }
  /** 塔内の床: 大きな石板・排水溝・染み */
  function r5FloorB(c, w, h) {
    const r = U.srand(5909);
    vgrad(c, w, h, [[0, '#17181e'], [1, '#2e2e35']]);
    stoneFloor(c, w, h, r, {
      h0: 9, grow: 1.2, ratio: 4, joint: 'rgba(0,0,0,0.6)', hi: 'rgba(160,160,180,0.07)',
      tone: (rr, row, k) => { const v = 24 + k * 20 + rr() * 9; return `rgb(${v | 0},${v | 0},${v + 5 | 0})`; },
    });
    // 排水溝の格子
    for (const gx of [200, 720]) {
      const y = 70, gw = 30, gh = 8;
      c.fillStyle = '#0a0a0d'; c.fillRect(gx, y, gw, gh);
      c.fillStyle = '#34353c'; for (let x = gx + 2; x < gx + gw; x += 5) c.fillRect(x, y, 1.6, gh);
    }
    // 暗い染み（様式化）
    for (let i = 0; i < 8; i++) {
      const y = 16 + r() * (h - 24), d = 0.5 + y / h, x = r() * w;
      wrapX(w, x, 20, xx => { c.fillStyle = 'rgba(58,12,14,0.3)'; c.beginPath(); c.ellipse(xx, y, (8 + r() * 12) * d, (2 + r() * 2) * d, 0, 0, TAU); c.fill(); });
    }
    // 散らばる鎖と藁
    for (let i = 0; i < 3; i++) { const x = 60 + r() * (w - 120), y = 40 + r() * 90; chainLine(c, x, y, x + 20 + r() * 20, y + (r() - 0.5) * 8, 'rgba(20,20,26,0.9)', 0.9); }
    c.strokeStyle = 'rgba(120,100,50,0.35)'; c.lineWidth = 0.8;
    c.beginPath(); for (let i = 0; i < 50; i++) { const x = r() * w, y = 10 + r() * (h - 10), a = r() * Math.PI; c.moveTo(x, y); c.lineTo(x + Math.cos(a) * 6, y + Math.sin(a) * 2); } c.stroke();
    floorShade(c, w, 0.65, 40);
  }
  /** 刑場 → 塔内の門（左の柱の中心が継ぎ目。アーチの内側は塔内が見える） */
  function r5Gate(c, w, h) {
    const r = U.srand(6010);
    const L0 = 64, R0 = w - 64, apex = 42, base = h - 2;
    c.save();
    c.beginPath(); c.rect(0, 0, w, h);
    c.moveTo(L0, base); c.lineTo(L0, 110); c.quadraticCurveTo(L0 + 4, apex + 20, (L0 + R0) / 2, apex);
    c.quadraticCurveTo(R0 - 4, apex + 20, R0, 110); c.lineTo(R0, base); c.closePath();
    c.clip('evenodd');
    c.fillStyle = '#16161c'; c.fillRect(0, 0, w, h);
    // 石積み（左は外壁で炎に照らされ、右は塔の内側）
    for (let y = 0, row = 0; y < h; y += 14, row++) {
      for (let x = (row % 2) * 16 - 32; x < w; x += 32) {
        const out = x < w * 0.45, v = out ? 34 + r() * 12 : 24 + r() * 8;
        c.fillStyle = out ? `rgb(${v + 6 | 0},${v | 0},${v - 2 | 0})` : `rgb(${v | 0},${v + 1 | 0},${v + 7 | 0})`;
        c.fillRect(x + 1, y + 1, 30, 12);
      }
    }
    c.fillStyle = 'rgba(0,0,0,0.5)'; for (let y = 0; y < h; y += 14) c.fillRect(0, y, w, 1.2);
    // 左の柱の縁（炎の照り返し）と右の柱の陰
    c.fillStyle = 'rgba(200,90,40,0.22)'; c.fillRect(0, 0, 5, h);
    c.fillStyle = 'rgba(0,0,0,0.35)'; c.fillRect(R0, 0, w - R0, h);
    c.fillStyle = 'rgba(0,0,0,0.25)'; c.fillRect(L0 - 10, 0, 10, h);
    c.restore();
    // アーチの迫石
    c.strokeStyle = '#3a3a42'; c.lineWidth = 9;
    c.beginPath(); c.moveTo(L0 - 4, 112); c.quadraticCurveTo(L0, apex + 16, (L0 + R0) / 2, apex - 5); c.quadraticCurveTo(R0, apex + 16, R0 + 4, 112); c.stroke();
    c.strokeStyle = 'rgba(0,0,0,0.6)'; c.lineWidth = 1.2; c.stroke();
    // 上げられた落とし格子
    c.save();
    c.beginPath(); c.moveTo(L0, 110); c.quadraticCurveTo(L0 + 4, apex + 20, (L0 + R0) / 2, apex); c.quadraticCurveTo(R0 - 4, apex + 20, R0, 110); c.closePath(); c.clip();
    c.beginPath();
    for (let x = L0 + 8; x < R0; x += 13) { c.moveTo(x, 20); c.lineTo(x, 86); }
    c.moveTo(L0, 58); c.lineTo(R0, 58); c.moveTo(L0, 78); c.lineTo(R0, 78);
    c.strokeStyle = '#08080a'; c.lineWidth = 4.5; c.stroke();
    c.strokeStyle = '#34343c'; c.lineWidth = 2; c.stroke();
    c.fillStyle = '#34343c';
    for (let x = L0 + 8; x < R0; x += 13) { c.beginPath(); c.moveTo(x - 2.5, 86); c.lineTo(x, 94); c.lineTo(x + 2.5, 86); c.closePath(); c.fill(); }
    c.restore();
    // 要石の紋
    emblem(c, (L0 + R0) / 2, 22, 0.9);
    // 柱の礎石
    c.fillStyle = '#2c2c34'; c.fillRect(0, h - 16, L0 + 4, 16); c.fillRect(R0 - 4, h - 16, w - R0 + 4, 16);
    c.fillStyle = 'rgba(0,0,0,0.5)'; c.fillRect(0, h - 16, w, 1.5);
  }
  /** 塔内 → 屋上への出口（左の柱の中心が継ぎ目。戸口の内側は屋上＝嵐の空） */
  function r5Door(c, w, h) {
    const r = U.srand(6111);
    const L0 = 64, R0 = w - 64, cx = (L0 + R0) / 2, rad = (R0 - L0) / 2, spring = 120;
    c.save();
    c.beginPath(); c.rect(0, 0, w, h);
    c.moveTo(L0, h); c.lineTo(L0, spring); c.arc(cx, spring, rad, Math.PI, 0); c.lineTo(R0, h); c.closePath();
    c.clip('evenodd');
    c.fillStyle = '#16161c'; c.fillRect(0, 0, w, h);
    for (let y = 0, row = 0; y < h; y += 14, row++) {
      for (let x = (row % 2) * 16 - 32; x < w; x += 32) {
        const out = x > cx, v = out ? 32 + r() * 10 : 24 + r() * 8;
        c.fillStyle = out ? `rgb(${v | 0},${v + 2 | 0},${v + 8 | 0})` : `rgb(${v + 2 | 0},${v + 1 | 0},${v + 4 | 0})`;
        c.fillRect(x + 1, y + 1, 30, 12);
      }
    }
    c.fillStyle = 'rgba(0,0,0,0.5)'; for (let y = 0; y < h; y += 14) c.fillRect(0, y, w, 1.2);
    // 右は外側（雨に濡れた筋）、左は松明に照らされる
    c.fillStyle = 'rgba(150,165,200,0.1)'; for (let i = 0; i < 26; i++) c.fillRect(cx + r() * (w - cx), r() * h, 1, 10 + r() * 30);
    c.fillStyle = 'rgba(255,150,70,0.12)'; c.fillRect(0, 0, 12, h);
    c.fillStyle = 'rgba(0,0,0,0.3)'; c.fillRect(L0 - 8, 0, 8, h);
    c.restore();
    // 半円アーチ
    c.strokeStyle = '#34353e'; c.lineWidth = 9;
    c.beginPath(); c.moveTo(L0 - 4, spring + 4); c.arc(cx, spring, rad + 4, Math.PI, 0); c.lineTo(R0 + 4, spring + 4); c.stroke();
    c.strokeStyle = 'rgba(0,0,0,0.55)'; c.lineWidth = 1.2;
    c.beginPath(); for (let i = 1; i < 10; i++) { const a = Math.PI + i / 10 * Math.PI; c.moveTo(cx + Math.cos(a) * (rad - 1), spring + Math.sin(a) * (rad - 1)); c.lineTo(cx + Math.cos(a) * (rad + 9), spring + Math.sin(a) * (rad + 9)); } c.stroke();
    // 上の銘板
    c.fillStyle = '#2a2b33'; c.fillRect(cx - 26, 20, 52, 26);
    c.strokeStyle = '#15161b'; c.lineWidth = 2; c.strokeRect(cx - 26, 20, 52, 26);
    emblem(c, cx, 33, 0.8);
    c.fillStyle = '#2c2c34'; c.fillRect(0, h - 16, L0 + 4, 16); c.fillRect(R0 - 4, h - 16, w - R0 + 4, 16);
    c.fillStyle = 'rgba(0,0,0,0.5)'; c.fillRect(0, h - 16, w, 1.5);
  }
  /** 敷居（床の継ぎ目）: 細い縁石と、門の内側に落ちる影。dir=1 で影は右（内側）へ */
  function r5Thresh(dir) {
    return (c, w, h) => {
      const r = U.srand(6212), cw = 9, x0 = dir > 0 ? 0 : w - cw;
      const g = c.createLinearGradient(dir > 0 ? cw : w - cw, 0, dir > 0 ? w : 0, 0);
      g.addColorStop(0, 'rgba(0,0,0,0.42)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = g; c.fillRect(dir > 0 ? cw : 0, 0, w - cw, h);
      let y = 0, rh = 7;
      while (y < h) {
        const v = 38 + r() * 10 + y / h * 16;
        c.fillStyle = `rgb(${v | 0},${v | 0},${v + 6 | 0})`; c.fillRect(x0 + 1, y + 0.5, cw - 2, rh - 1);
        c.fillStyle = 'rgba(0,0,0,0.55)'; c.fillRect(x0, y, cw, 1);
        y += rh; rh *= 1.16;
      }
      c.fillStyle = 'rgba(0,0,0,0.6)'; c.fillRect(x0, 0, 1.2, h); c.fillRect(x0 + cw - 1.2, 0, 1.2, h);
      floorShade(c, w, 0.5, 30);
    };
  }

  // ---------------------------------------------------------- 屋上
  /** 塔の頂から見下ろす夜景: 遠い山並み、町の灯、刑場の火 */
  function r5Land(c, w, h) {
    const r = U.srand(6313);
    // 地平の薄明かり
    const g0 = c.createLinearGradient(0, 0, 0, 60);
    g0.addColorStop(0, 'rgba(70,80,108,0)'); g0.addColorStop(0.7, 'rgba(80,90,118,0.45)'); g0.addColorStop(1, 'rgba(80,90,118,0.2)');
    c.fillStyle = g0; c.fillRect(0, 0, w, 60);
    // 山並み（2列）と平野
    const ridge = (base, amp, f1, f2, col) => {
      c.fillStyle = col;
      c.beginPath(); c.moveTo(0, h);
      for (let i = 0; i <= 100; i++) { const k = i / 100; c.lineTo(k * w, base + Math.sin(k * TAU * f1 + base) * amp + Math.sin(k * TAU * f2) * amp * 0.45); }
      c.lineTo(w, h); c.closePath(); c.fill();
    };
    ridge(40, 9, 3, 11, '#1a1e2b');
    ridge(54, 6, 5, 13, '#11141c');
    c.fillStyle = '#0b0d13'; c.fillRect(0, 64, w, h - 64);
    // 川筋
    c.strokeStyle = 'rgba(90,100,130,0.3)'; c.lineWidth = 1;
    c.beginPath(); for (let i = 0; i <= 50; i++) { const k = i / 50; const y = 80 + Math.sin(k * TAU * 2) * 10 + Math.sin(k * TAU * 5) * 3; if (i) c.lineTo(k * w, y); else c.moveTo(0, y); } c.stroke();
    // 町の灯と刑場の火
    for (let i = 0; i < 80; i++) { c.fillStyle = r() < 0.7 ? 'rgba(200,110,50,0.75)' : 'rgba(255,200,120,0.9)'; c.fillRect(r() * w, 68 + r() * (h - 72), 1.2, 1.2); }
    for (let i = 0; i < 7; i++) {
      const x = 10 + r() * (w - 20), y = 72 + r() * (h - 80);
      const g = c.createRadialGradient(x, y, 0, x, y, 6);
      g.addColorStop(0, 'rgba(255,160,70,0.85)'); g.addColorStop(1, 'rgba(255,90,30,0)');
      c.fillStyle = g; c.fillRect(x - 6, y - 6, 12, 12);
    }
  }
  /** 屋上の胸壁（狭間・石像） */
  function r5Parapet(c, w, h) {
    const r = U.srand(6414), wt = 34;
    c.fillStyle = '#25272f'; c.fillRect(0, wt, w, h - wt);
    for (let y = wt + 8, row = 0; y < h; y += 12, row++) {
      for (let x = (row % 2) * 16 - 32; x < w; x += 32) { const v = 34 + r() * 10; c.fillStyle = `rgb(${v | 0},${v + 1 | 0},${v + 8 | 0})`; c.fillRect(x + 1, y + 1, 30, 10); }
    }
    c.fillStyle = 'rgba(0,0,0,0.45)'; for (let y = wt + 8; y < h; y += 12) c.fillRect(0, y, w, 1);
    c.fillStyle = '#3a3c46'; c.fillRect(0, wt - 2, w, 8);
    c.fillStyle = '#5e626e'; c.fillRect(0, wt - 2, w, 1.2);
    // 凸壁（メルロン）
    for (let x = 6; x < w; x += 48) {
      c.fillStyle = '#2c2e37'; c.fillRect(x, 8, 28, wt - 8);
      c.fillStyle = '#3e414c'; c.fillRect(x, 8, 28, 4);
      c.fillStyle = '#5a5e6a'; c.fillRect(x, 8, 28, 1);
      c.fillStyle = 'rgba(0,0,0,0.35)'; c.fillRect(x + 24, 12, 4, wt - 12);
      c.fillStyle = 'rgba(150,165,200,0.08)'; c.fillRect(x + 4 + r() * 18, 12, 1, 8 + r() * 12);
    }
    // 石像（ガーゴイル）
    for (const gx of [102, 486, 822]) {
      const x = gx + 14, y = 8;
      c.fillStyle = '#16171d';
      c.beginPath(); c.moveTo(x - 10, y); c.lineTo(x - 8, y - 14); c.lineTo(x - 2, y - 22); c.lineTo(x + 6, y - 20); c.lineTo(x + 12, y - 14); c.lineTo(x + 10, y); c.closePath(); c.fill();
      c.beginPath(); c.moveTo(x - 4, y - 18); c.lineTo(x - 18, y - 30); c.lineTo(x - 10, y - 14); c.closePath(); c.fill();
      c.beginPath(); c.moveTo(x + 8, y - 18); c.lineTo(x + 20, y - 32); c.lineTo(x + 12, y - 12); c.closePath(); c.fill();
      c.beginPath(); c.arc(x + 4, y - 23, 4, 0, TAU); c.fill();
      c.beginPath(); c.moveTo(x + 2, y - 26); c.lineTo(x + 1, y - 32); c.lineTo(x + 5, y - 27); c.fill();
    }
    // 篝火の台
    for (const bx of BRAZ_C) {
      c.fillStyle = '#121216'; c.fillRect(bx - 1.5, 18, 3, wt - 16);
      c.beginPath(); c.moveTo(bx - 10, 12); c.lineTo(bx + 10, 12); c.lineTo(bx + 6, 20); c.lineTo(bx - 6, 20); c.closePath(); c.fill();
    }
  }
  function r5FloorC(c, w, h) {
    const r = U.srand(6515);
    vgrad(c, w, h, [[0, '#1c1e25'], [1, '#383a43']]);
    stoneFloor(c, w, h, r, {
      h0: 9, grow: 1.19, ratio: 3.6, joint: 'rgba(0,0,0,0.55)', hi: 'rgba(170,180,210,0.1)',
      tone: (rr, row, k) => { const v = 30 + k * 22 + rr() * 10; return `rgb(${v | 0},${v + 1 | 0},${v + 8 | 0})`; },
      each: (c2, x, y, sw, rh, rr) => { if (rr() < 0.08) { c2.fillStyle = 'rgba(40,60,40,0.35)'; c2.fillRect(x + sw * 0.2, y + rh * 0.6, sw * 0.3, rh * 0.25); } },
    });
    // 空を映す水たまり
    for (let i = 0; i < 8; i++) {
      const y = 18 + r() * (h - 26), d = 0.5 + y / h, x = r() * w, rx = (24 + r() * 44) * d, ry = (3 + r() * 3) * d;
      wrapX(w, x, rx, xx => {
        c.fillStyle = 'rgba(46,54,72,0.8)'; c.beginPath(); c.ellipse(xx, y, rx, ry, 0, 0, TAU); c.fill();
        c.fillStyle = 'rgba(160,175,210,0.2)'; c.fillRect(xx - rx * 0.5, y - ry * 0.2, rx * 0.6, 1);
      });
    }
    floorShade(c, w, 0.5, 30);
  }
  /** 鐘楼の枠（鐘は毎フレーム揺らして描く） */
  function r5Belfry(c, w, h) {
    c.fillStyle = '#17181e';
    c.fillRect(8, 20, 12, h - 20); c.fillRect(w - 20, 20, 12, h - 20);
    c.fillStyle = '#23252d'; c.fillRect(8, 20, 3, h - 20); c.fillRect(w - 20, 20, 3, h - 20);
    c.fillStyle = '#1c1d24'; c.fillRect(0, 14, w, 12);
    c.fillStyle = '#2e3038'; c.fillRect(0, 14, w, 2);
    // 屋根
    c.fillStyle = '#121318';
    c.beginPath(); c.moveTo(-6, 16); c.lineTo(w / 2, -12); c.lineTo(w + 6, 16); c.closePath(); c.fill();
    c.strokeStyle = '#3a3c46'; c.lineWidth = 1; c.beginPath(); c.moveTo(-6, 16); c.lineTo(w / 2, -12); c.stroke();
    // 斜め材
    c.strokeStyle = '#15161b'; c.lineWidth = 4;
    c.beginPath(); c.moveTo(20, 60); c.lineTo(40, 26); c.moveTo(w - 20, 60); c.lineTo(w - 40, 26); c.stroke();
    c.fillStyle = '#0e0e12'; c.fillRect(w / 2 - 5, 26, 10, 6);
  }
  function r5Bell(c, w, h) {
    const cx = w / 2;
    c.fillStyle = '#4a3c22';
    c.beginPath(); c.moveTo(cx - 8, 6); c.quadraticCurveTo(cx - 14, 8, cx - 15, 26); c.quadraticCurveTo(cx - 17, 40, cx - 23, 46);
    c.lineTo(cx + 23, 46); c.quadraticCurveTo(cx + 17, 40, cx + 15, 26); c.quadraticCurveTo(cx + 14, 8, cx + 8, 6); c.closePath(); c.fill();
    c.fillStyle = '#6e5a32'; c.fillRect(cx - 12, 12, 3, 28);
    c.fillStyle = '#2a2214'; c.fillRect(cx + 7, 12, 5, 30);
    c.fillStyle = '#5a4a2a'; c.fillRect(cx - 23, 44, 46, 3); c.fillRect(cx - 16, 20, 32, 2);
    c.fillStyle = '#2a2214'; c.fillRect(cx - 5, 0, 10, 7);
    c.fillStyle = '#1a140c'; c.beginPath(); c.arc(cx, 48, 3.5, 0, TAU); c.fill();
  }
  /** 前景: 焦げた杭（刑場） */
  function r5Stake(c, w, h) {
    c.fillStyle = '#070506';
    c.fillRect(w / 2 - 6, 0, 12, h);
    c.beginPath(); c.moveTo(w / 2 - 7, 4); c.lineTo(w / 2 - 2, -2); c.lineTo(w / 2 + 3, 6); c.lineTo(w / 2 + 7, 2); c.lineTo(w / 2 + 6, 10); c.lineTo(w / 2 - 6, 10); c.closePath(); c.fill();
    chainLine(c, w / 2 - 6, 40, w / 2 + 6, 46, '#141012', 1.3);
    chainLine(c, w / 2 + 6, 46, w / 2 + 13, 80, '#141012', 1.3);
    c.fillStyle = 'rgba(200,80,30,0.35)'; c.fillRect(w / 2 - 6, 24, 1.5, 40);
  }
  /** 前景: 天井から吊られた檻（塔内） */
  function r5Cage(c, w, h) {
    const cx = w / 2;
    chainLine(c, cx, 0, cx, h - 58, '#050506', 1.4);
    c.strokeStyle = '#060607'; c.lineWidth = 2.4;
    c.beginPath(); c.arc(cx, h - 44, 16, Math.PI, 0);
    for (let i = -16; i <= 16; i += 6.4) { c.moveTo(cx + i, h - 44); c.lineTo(cx + i * 0.9, h - 4); }
    c.moveTo(cx - 17, h - 4); c.lineTo(cx + 17, h - 4); c.moveTo(cx - 16, h - 26); c.lineTo(cx + 16, h - 26);
    c.stroke();
    c.fillStyle = '#060607'; c.fillRect(cx - 18, h - 5, 36, 5);
    c.fillStyle = 'rgba(6,6,7,0.8)'; c.beginPath(); c.ellipse(cx + 3, h - 14, 7, 9, -0.3, 0, TAU); c.fill();
    c.beginPath(); c.moveTo(cx + 8, h - 10); c.lineTo(cx + 22, h + 4); c.lineTo(cx + 18, h + 6); c.lineTo(cx + 6, h - 6); c.fill();
  }

  function layers5() {
    const FW = 1024;
    return {
      skyA: BG.layer('s5skyA', 4, FT, r5SkyA), skyC: BG.layer('s5skyC', 4, FT, r5SkyC),
      clouds: BG.layer('s5clouds', 1200, 150, r5Clouds),
      tower: BG.layer('s5tower', 340, 214, r5Tower), crowd: BG.layer('s5crowd', 1000, 96, r5Crowd),
      pyre: BG.layer('s5pyre', 110, 112, r5Pyre), wallA: BG.layer('s5wallA', 1000, 140, r5WallA),
      floorA: BG.layer('s5floorA', FW, FH, r5FloorA),
      inFar: BG.layer('s5inFar', 1100, 214, r5InFar), inWall: BG.layer('s5inWall', 1000, 128, r5InWall),
      floorB: BG.layer('s5floorB', FW, FH, r5FloorB),
      gate: BG.layer('s5gate', 260, 214, r5Gate), door: BG.layer('s5door', 240, 214, r5Door), threshIn: BG.layer('s5threshIn', 70, FH, r5Thresh(1)), threshOut: BG.layer('s5threshOut', 70, FH, r5Thresh(-1)),
      land: BG.layer('s5land', 1000, 116, r5Land), parapet: BG.layer('s5parapet', 960, 78, r5Parapet),
      floorC: BG.layer('s5floorC', FW, FH, r5FloorC),
      belfry: BG.layer('s5belfry', 150, 190, r5Belfry), bell: BG.layer('s5bell', 50, 54, r5Bell),
      stake: BG.layer('s5stake', 40, 130, r5Stake), cage: BG.layer('s5cage', 50, 150, r5Cage),
    };
  }

  // ---------------------------------------------------------- 稲妻
  function st5(g) {
    if (!g.s5) g.s5 = { lt: 0, bolt: null, next: 90, thunderAt: 0, vol: 1 };
    return g.s5;
  }
  /** 今どの区間を見ているか（0 刑場 / 1 塔内 / 2 屋上） */
  function zone5() { const cx = BK.cam.x + BK.W / 2; return cx < X_GATE ? 0 : cx < X_ROOF ? 1 : 2; }
  function strike5(S, g, big) {
    const W = BK.W;
    S.lt = big ? 22 : 16;
    S.bolt = makeBolt(W * (0.12 + Math.random() * 0.76), -4, 120 + Math.random() * 50, 1 + Math.floor(Math.random() * 99999));
    const z = zone5();
    S.vol = big ? 1 : z === 1 ? 0.45 : 0.75;
    S.thunderAt = g.time + (big ? 3 : U.randi(12, 42));
  }
  /** 稲光の明るさ 0..1（明滅つき） */
  function flash5(S) {
    const f = S.lt;
    if (f <= 0) return 0;
    if (f > 12) return 1;
    if (f > 9) return 0.25;
    if (f > 6) return 0.75;
    return f / 6 * 0.3;
  }

  // ---------------------------------------------------------- 区間ごとの背景
  function drawSky5(c, S, L, sky, t, fast) {
    const W = BK.W, lk = flash5(S);
    c.drawImage(sky, 0, 0, W, FT);
    c.globalAlpha = 0.9; BG.tile(c, L.clouds, 0.02, -8, t * (fast ? 0.3 : 0.1)); c.globalAlpha = 1;
    if (lk > 0) { c.fillStyle = `rgba(150,165,215,${0.4 * lk})`; c.fillRect(0, 0, W, FT); }
    c.globalAlpha = 0.8; BG.tile(c, L.clouds, 0.05, fast ? -24 : 28, t * (fast ? 0.8 : 0.28) + 520); c.globalAlpha = 1;
    if (S.bolt && lk > 0.5) drawBolt(c, S.bolt, lk);
  }
  function drawCourtyard(c, g, S, L, t) {
    const W = BK.W, cam = BK.cam.x;
    drawSky5(c, S, L, L.skyA, t, false);
    // 塔
    const tx = W * 0.66 - cam * 0.06;
    if (tx > -200 && tx < W + 200) spr(c, L.tower, tx - L.tower.lw / 2, FT - L.tower.lh + 2);
    // 群衆
    BG.tile(c, L.crowd, 0.28, 186 - L.crowd.lh);
    // 火刑柱
    for (let x0 = tile0(0.45, 1100); x0 < W; x0 += 1100) {
      for (let i = 0; i < PYRES.length; i++) {
        const sx = x0 + PYRES[i];
        if (sx < -100 || sx > W + 100) continue;
        const fl = 0.85 + Math.sin(t * 0.13 + i * 2) * 0.1;
        glow(c, 'fire', sx, 128, 120 * fl, 0.55, 90, true);
        spr(c, L.pyre, sx - 55, 176 - 112);
        fire(c, sx, 152, 1.5, t, i * 2.3, 4);
        sparks(c, sx, 110, t, 7, 18, i);
      }
    }
    // 柵と石垣
    BG.tile(c, L.wallA, 0.75, 210 - L.wallA.lh);
    const fy = 210 - L.wallA.lh + 54;
    for (let x0 = tile0(0.75, 1000); x0 < W; x0 += 1000) {
      for (let i = 0; i < TORCH_A.length; i++) {
        const sx = x0 + TORCH_A[i];
        if (sx < -60 || sx > W + 60) continue;
        glow(c, 'torch', sx, fy, 50, 0.45, 40, true);
        fire(c, sx, fy, 0.34, t, i * 3.1 + 1, 2);
      }
    }
    BG.tile(c, L.floorA, 1, FY);
    // 石畳に跳ねる雨
    splashes(c, t, 26, 'rgba(170,180,210,0.35)');
  }
  function drawInterior(c, g, S, L, t) {
    const W = BK.W, lk = flash5(S);
    BG.tile(c, L.inFar, 0.4, -2);
    if (lk > 0) {
      // 窓に稲光、差し込む光の筋
      c.fillStyle = `rgba(200,215,255,${0.85 * lk})`;
      c.beginPath();
      for (let x0 = tile0(0.4, 1100); x0 < W; x0 += 1100) {
        for (const wx of WIN_B) { const sx = x0 + wx; if (sx < -80 || sx > W + 20) continue; c.moveTo(sx - 6, 95); c.lineTo(sx - 6, 48); c.arc(sx, 48, 6, Math.PI, 0); c.lineTo(sx + 6, 95); c.closePath(); }
      }
      c.fill();
      c.fillStyle = `rgba(170,190,255,${0.1 * lk})`;
      c.beginPath();
      for (let x0 = tile0(0.4, 1100); x0 < W; x0 += 1100) {
        for (const wx of WIN_B) { const sx = x0 + wx; if (sx < -140 || sx > W + 20) continue; c.moveTo(sx - 6, 50); c.lineTo(sx + 6, 50); c.lineTo(sx + 60, 200); c.lineTo(sx + 30, 200); c.closePath(); }
      }
      c.fill();
    }
    BG.tile(c, L.inWall, 0.8, 210 - L.inWall.lh);
    const ty = 210 - L.inWall.lh + 34;
    for (let x0 = tile0(0.8, 1000); x0 < W; x0 += 1000) {
      for (let i = 0; i < TORCH_B.length; i++) {
        const sx = x0 + TORCH_B[i];
        if (sx < -70 || sx > W + 70) continue;
        const fl = 0.9 + Math.sin(t * 0.27 + i * 1.9) * 0.08;
        glow(c, 'torch', sx, ty - 4, 70 * fl, 0.4, 60 * fl, true);
        fire(c, sx, ty, 0.36, t, i * 2.7, 2);
      }
    }
    BG.tile(c, L.floorB, 1, FY);
  }
  function drawRoof(c, g, S, L, t) {
    const W = BK.W, cam = BK.cam.x, lk = flash5(S);
    drawSky5(c, S, L, L.skyC, t, true);
    BG.tile(c, L.land, 0.05, 174 - L.land.lh);
    BG.tile(c, L.parapet, 0.85, 212 - L.parapet.lh);
    const py = 212 - L.parapet.lh + 12;
    for (let x0 = tile0(0.85, 960); x0 < W; x0 += 960) {
      for (let i = 0; i < BRAZ_C.length; i++) {
        const sx = x0 + BRAZ_C[i];
        if (sx < -80 || sx > W + 80) continue;
        glow(c, 'fire', sx, py - 8, 80, 0.4, 60, true);
        fire(c, sx, py, 0.5, t, i * 1.7 + 4, 3);
        sparks(c, sx, py - 10, t, 4, 10, i + 5);
      }
    }
    // 鐘楼（ボス戦の画面の中央に来る位置）
    const bx = BK.W * 0.5 + (LEN5 - BK.W) * 0.85 - cam * 0.85;
    if (bx > -100 && bx < W + 100) {
      const fb = L.belfry, top = 212 - fb.lh;
      spr(c, fb, bx - fb.lw / 2, top);
      const B = S.bellSwing || 0;
      c.save(); c.translate(bx, top + 30); c.rotate(Math.sin(t * 0.03) * 0.05 + B * Math.sin(t * 0.2) * 0.35);
      c.drawImage(L.bell, -25, 0, 50, 54); c.restore();
    }
    BG.tile(c, L.floorC, 1, FY);
    if (lk > 0) { c.fillStyle = `rgba(170,190,240,${0.12 * lk})`; c.fillRect(0, FY, W, FH); }
    splashes(c, t, 40, 'rgba(180,195,230,0.4)');
  }

  BK.stages[4] = {
    id: 5, name: '断罪の塔', sub: '異端審問の塔と刑場', len: LEN5,
    bgm: 'stage5', bossBgm: 'boss', heal: 0.35,
    intro: '雨の刑場に、異端を焼く炎が揺れる。\n聖鉄鎖騎士団と拷問官が群衆を見張る中──\n塔の頂で、異端審問官モズグスが待つ。',
    props: [
      { x: 300, y: 30, type: 'barrel' }, { x: 350, y: 98, type: 'crate', item: 'meat' },
      { x: 820, y: 24, type: 'urn', item: 'silver' }, { x: 870, y: 64, type: 'urn' },
      { x: 1120, y: 100, type: 'barrel', item: 'firepot' },
      { x: 1620, y: 30, type: 'crate', item: 'wine' }, { x: 1680, y: 96, type: 'barrel', item: 'bowgun' },
      { x: 2180, y: 60, type: 'urn', item: 'gold' }, { x: 2230, y: 20, type: 'crate', item: 'meat' },
      { x: 2640, y: 100, type: 'barrel', item: 'bombs' }, { x: 2700, y: 40, type: 'crate', item: 'bread' },
      // 屋上（ボス戦の画面内）
      { x: 3330, y: 26, type: 'barrel', item: 'roast' }, { x: 3390, y: 100, type: 'crate', item: 'wine' },
      { x: 3680, y: 60, type: 'barrel', item: 'spear' },
    ],
    events: [
      // 刑場: 聖鉄鎖騎士団
      { at: 150, waves: [
        [{ t: 'soldier', palette: 'knight', side: 'R', y: 40 }, { t: 'soldier', palette: 'knight', side: 'R', y: 95, off: 40 }, { t: 'undead', side: 'L', y: 70, delay: 30 }],
        [{ t: 'crossbow', palette: 'knight', side: 'R', y: 20 }, { t: 'undead', x: 420, y: 90, entry: 'rise', screen: true, palette: 'blood' }, { t: 'spirit', side: 'R', y: 60, delay: 40 }]] },
      // 火刑柱の前: 灰の中から亡者が這い出す
      { at: 650, waves: [
        [{ t: 'undead', x: 360, y: 40, entry: 'rise', screen: true, palette: 'blood' }, { t: 'undead', x: 520, y: 96, entry: 'rise', screen: true, delay: 15 }, { t: 'undead', x: 250, y: 74, entry: 'rise', screen: true, delay: 30, palette: 'bone' }, { t: 'spirit', side: 'R', y: 30, delay: 50 }],
        [{ t: 'inquisitor', side: 'R', y: 60 }, { t: 'soldier', palette: 'knight', side: 'L', y: 30, delay: 20 }],
        [{ t: 'spirit', side: 'R', y: 40 }, { t: 'spirit', side: 'L', y: 90, delay: 20 }, { t: 'crossbow', palette: 'knight', side: 'R', y: 100, off: 50 }]], next: 1 },
      // 塔の門前
      { at: 1100, waves: [
        [{ t: 'soldier', palette: 'knight', side: 'R', y: 30 }, { t: 'soldier', palette: 'knight', side: 'R', y: 90, off: 30 }, { t: 'crossbow', palette: 'knight', side: 'R', y: 60, off: 80 }, { t: 'soldier', palette: 'knight', side: 'L', y: 60, delay: 60 }],
        [{ t: 'inquisitor', side: 'R', y: 50 }, { t: 'undead', side: 'L', y: 90 }, { t: 'undead', side: 'R', y: 20, delay: 40, palette: 'blood' }]], next: 1 },
      // 塔内: 異端審問の間
      { at: 1750, text: '塔内', sub: '─ 異端審問の間 ─', waves: [
        [{ t: 'inquisitor', side: 'R', y: 40 }, { t: 'undead', x: 400, y: 92, entry: 'rise', screen: true, palette: 'bone' }, { t: 'undead', x: 220, y: 30, entry: 'rise', screen: true, delay: 25, palette: 'bone' }],
        [{ t: 'spirit', side: 'R', y: 30 }, { t: 'spirit', side: 'R', y: 90, delay: 15 }, { t: 'spirit', side: 'L', y: 60, delay: 30 }, { t: 'soldier', palette: 'knight', side: 'R', y: 60, off: 40 }],
        [{ t: 'inquisitor', side: 'L', y: 70 }, { t: 'crossbow', palette: 'knight', side: 'R', y: 20 }, { t: 'crossbow', palette: 'knight', side: 'R', y: 100, off: 50 }]], next: 1 },
      // 螺旋階段の上層
      { at: 2350, waves: [
        [{ t: 'soldier', palette: 'knight', side: 'R', y: 30 }, { t: 'soldier', palette: 'knight', side: 'L', y: 90 }, { t: 'crossbow', palette: 'knight', side: 'R', y: 60, off: 60 }, { t: 'spirit', side: 'R', y: 40, delay: 60 }],
        [{ t: 'inquisitor', side: 'R', y: 80 }, { t: 'inquisitor', side: 'L', y: 30, delay: 40 }, { t: 'undead', x: 300, y: 60, entry: 'rise', screen: true, palette: 'blood' }],
        [{ t: 'spirit', side: 'R', y: 20 }, { t: 'spirit', side: 'L', y: 100, delay: 10 }, { t: 'spirit', side: 'R', y: 60, delay: 25 }, { t: 'soldier', palette: 'knight', side: 'R', y: 50, off: 40, delay: 30 }]], next: 1 },
      // 屋上への出口
      { at: 2860, text: '塔の頂', sub: '─ 嵐 ─', waves: [
        [{ t: 'undead', side: 'R', y: 30, palette: 'blood' }, { t: 'undead', side: 'R', y: 96, off: 30 }, { t: 'spirit', side: 'L', y: 60, delay: 20 }, { t: 'spirit', side: 'R', y: 60, delay: 40 }, { t: 'soldier', palette: 'knight', side: 'R', y: 60, off: 70 }],
        [{ t: 'crossbow', palette: 'knight', side: 'R', y: 20 }, { t: 'crossbow', palette: 'knight', side: 'R', y: 100, off: 40 }, { t: 'soldier', palette: 'knight', side: 'L', y: 60 }, { t: 'inquisitor', side: 'R', y: 60, delay: 60 }]],
        onStart(g) { const S = st5(g); strike5(S, g, true); } },
      // ボス: モズグス（鐘楼の前）
      { at: 3260, boss: 'mozgus', x: 470, y: 60, waves: [],
        onStart(g) { const S = st5(g); strike5(S, g, true); S.bellSwing = 1; } },
    ],
    init(g) {
      g.s5 = null; st5(g);
      layers5();
    },
    update(g) {
      const S = st5(g);
      if (S.lt > 0) S.lt--;
      if (S.bellSwing > 0) S.bellSwing = Math.max(0, S.bellSwing - 0.004);
      if (S.thunderAt && g.time >= S.thunderAt) { S.thunderAt = 0; thunder(S.vol); }
      if (--S.next <= 0) {
        const z = zone5();
        strike5(S, g, false);
        S.next = z === 2 ? U.randi(140, 300) : U.randi(240, 520);
      }
    },
    drawBg(c, g) {
      const S = st5(g), L = layers5(), t = g.time, cam = BK.cam.x, W = BK.W;
      const sA = X_GATE - cam, sB = X_ROOF - cam;
      section(c, -1, sA, () => drawCourtyard(c, g, S, L, t));
      section(c, sA, sB, () => drawInterior(c, g, S, L, t));
      section(c, sB, W + 1, () => drawRoof(c, g, S, L, t));
      // 継ぎ目: 敷居と門の柱
      if (sA > -80 && sA < W + 10) spr(c, L.threshIn, sA - 4, FY);
      if (sB > -10 && sB < W + 80) spr(c, L.threshOut, sB - 66, FY);
      if (sA > -270 && sA < W + 40) spr(c, L.gate, sA - 32, FT - L.gate.lh);
      if (sB > -250 && sB < W + 40) spr(c, L.door, sB - 32, FT - L.door.lh);
      // 門の脇の松明
      if (sA > -80 && sA < W + 280) {
        for (const dx of [-14, 244]) { const x = sA + dx, y = 104; glow(c, 'torch', x, y, 56, 0.45, 50, true); c.fillStyle = '#121014'; c.fillRect(x - 2, y + 2, 4, 12); fire(c, x, y + 2, 0.36, t, dx, 2); }
      }
    },
    drawFg(c, g) {
      const S = st5(g), L = layers5(), t = g.time, cam = BK.cam.x, W = BK.W, H = BK.H;
      const sA = X_GATE - cam, sB = X_ROOF - cam, lk = flash5(S);
      section(c, -1, sA, () => {
        for (const px of [420, 1150, 1880]) {
          const sx = px - cam * 1.3;
          if (sx > -40 && sx < W + 40) spr(c, L.stake, sx - 20, H - 118);
        }
        BG.fog(c, t, '#3a3642', 0.1, H - 50);
        rain(c, t, 70, 13, 0.22, 9, 'rgba(165,178,210,0.33)', 1, 0);
      });
      section(c, sA, sB, () => {
        for (const px of [2050, 2620, 3190, 3760]) {
          const sx = px - cam * 1.25;
          if (sx < -60 || sx > W + 60) continue;
          c.save(); c.translate(sx, -66); c.rotate(Math.sin(t * 0.021 + px) * 0.05);
          c.drawImage(L.cage, -25, 0, 50, 150); c.restore();
        }
      });
      section(c, sB, W + 1, () => {
        rain(c, t, 60, 16, 0.4, 11, 'rgba(165,178,215,0.3)', 1, 60);
        rain(c, t, 26, 26, 0.45, 16, 'rgba(200,210,240,0.28)', 1.4, 140);
        BG.fog(c, t * 2, '#343844', 0.08, H - 40);
      });
      if (lk > 0) { c.fillStyle = `rgba(215,225,255,${(zone5() === 1 ? 0.04 : 0.1) * lk})`; c.fillRect(0, 0, W, H); }
      BG.vignette(c, 0.58);
    },
  };

  // ================================================================
  //  ROUND 6  蝕
  // ================================================================
  const LEN6 = 3800;
  const FLY6 = [
    { k: 'bat', x: 140, y: 34, f: 0.16, s: 0.9, vx: 0.18, ph: 0 },
    { k: 'ray', x: 520, y: 96, f: 0.2, s: 0.8, vx: -0.12, ph: 1.3 },
    { k: 'eye', x: 820, y: 48, f: 0.14, s: 0.8, vx: 0.08, ph: 2.1 },
    { k: 'worm', x: 1150, y: 22, f: 0.18, s: 0.9, vx: 0.22, ph: 3.2 },
    { k: 'bat', x: 1500, y: 112, f: 0.24, s: 0.6, vx: -0.2, ph: 4.1 },
    { k: 'ray', x: 1900, y: 40, f: 0.12, s: 0.6, vx: 0.1, ph: 5.3 },
    { k: 'bat', x: 2300, y: 72, f: 0.2, s: 1.1, vx: 0.15, ph: 0.7 },
    { k: 'eye', x: 2750, y: 110, f: 0.22, s: 0.6, vx: -0.1, ph: 1.9 },
  ];
  const SIL6 = '#160204';

  function r6Sky(c, w, h) { vgrad(c, w, h, [[0, '#0c0103'], [0.3, '#2c0406'], [0.62, '#660b0c'], [0.86, '#9a1a12'], [1, '#b8321a']]); }
  /** 黒い太陽のまわりで渦巻く雲 */
  function r6Vortex(c, w, h) {
    const r = U.srand(7101), cx = w / 2, cy = h / 2;
    c.lineCap = 'round';
    for (let k = 0; k < 46; k++) {
      const rad = 46 + k * 3.4 + r() * 6, a0 = r() * TAU, len = 0.6 + r() * 1.6;
      c.strokeStyle = r() < 0.2 ? `rgba(170,36,24,${0.14 + r() * 0.12})` : `rgba(18,0,2,${0.2 + r() * 0.35})`;
      c.lineWidth = 2 + r() * 7;
      c.beginPath();
      for (let i = 0; i <= 16; i++) {
        const a = a0 + len * i / 16, rr = rad + i * 1.8;  // 外へ広がる渦
        const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr;
        if (i) c.lineTo(x, y); else c.moveTo(x, y);
      }
      c.stroke();
    }
  }
  /** コロナ（光の輪と放射する筋） */
  function r6Corona(c, w, h) {
    const r = U.srand(7202), cx = w / 2, cy = h / 2;
    const g = c.createRadialGradient(cx, cy, 30, cx, cy, w / 2);
    g.addColorStop(0, 'rgba(255,236,200,1)'); g.addColorStop(0.1, 'rgba(255,190,120,0.75)');
    g.addColorStop(0.3, 'rgba(230,90,40,0.32)'); g.addColorStop(0.65, 'rgba(160,20,10,0.1)'); g.addColorStop(1, 'rgba(120,0,0,0)');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
    c.lineCap = 'round';
    for (let i = 0; i < 64; i++) {
      const a = r() * TAU, r0 = 34, r1 = 50 + Math.pow(r(), 2) * 70;
      c.strokeStyle = `rgba(255,${190 + r() * 50 | 0},${140 + r() * 60 | 0},${0.12 + r() * 0.22})`;
      c.lineWidth = 0.8 + r() * 2;
      c.beginPath(); c.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
      c.quadraticCurveTo(cx + Math.cos(a + 0.08) * (r0 + r1) * 0.6, cy + Math.sin(a + 0.08) * (r0 + r1) * 0.6, cx + Math.cos(a + 0.12) * r1, cy + Math.sin(a + 0.12) * r1);
      c.stroke();
    }
  }
  /** 捻じれた尖塔（遠景・2列） */
  function r6Spires(c, w, h) {
    const r = U.srand(7303);
    const spire = (x, base, hh, ww, tw, ph, col, band) => {
      const N = 18, Lp = [], Rp = [];
      for (let i = 0; i <= N; i++) {
        const k = i / N, y = base - k * hh;
        const cx = x + Math.sin(ph + k * tw * TAU) * ww * 0.7 * k;
        const half = ww * 0.5 * Math.pow(1 - k, 1.1) + 0.4;
        Lp.push(cx - half, y); Rp.push(cx + half, y);
      }
      c.fillStyle = col;
      c.beginPath(); c.moveTo(Lp[0], Lp[1]);
      for (let i = 2; i < Lp.length; i += 2) c.lineTo(Lp[i], Lp[i + 1]);
      for (let i = Rp.length - 2; i >= 0; i -= 2) c.lineTo(Rp[i], Rp[i + 1]);
      c.closePath(); c.fill();
      // 螺旋の筋
      c.strokeStyle = band; c.lineWidth = 1;
      c.beginPath();
      for (let j = 1; j < 6; j++) {
        const i = Math.floor(j / 6 * N) * 2;
        c.moveTo(Lp[i], Lp[i + 1]); c.lineTo(Rp[i + 2] || Rp[i], (Rp[i + 3] || Rp[i + 1]) - 5);
      }
      c.stroke();
    };
    for (let row = 0; row < 2; row++) {
      const col = row ? '#1a0205' : '#3c070a', band = row ? 'rgba(90,14,14,0.6)' : 'rgba(110,20,18,0.5)';
      // 地平の岩
      c.fillStyle = col;
      c.beginPath(); c.moveTo(0, h);
      for (let x = 0; x <= w; x += 10) c.lineTo(x, h - (row ? 10 : 26) - Math.sin(x / w * TAU * (3 + row * 2) + row) * 6 - Math.sin(x / w * TAU * 11) * 3);
      c.lineTo(w, h); c.closePath(); c.fill();
      for (let x = r() * 40; x < w; x += (row ? 70 : 46) + r() * 70) {
        const hh = (row ? 70 : 40) + r() * (row ? 100 : 80), ww = (row ? 16 : 10) + r() * 12;
        const tw = 0.6 + r() * 1.4, ph = r() * TAU, base = h - (row ? 6 : 20);
        wrapX(w, x, ww * 2, xx => spire(xx, base, hh, ww, tw, ph, col, band));
        if (r() < 0.3) { const x2 = x + (r() - 0.5) * 20; wrapX(w, x2, ww, xx => spire(xx, base, hh * 0.5, ww * 0.6, tw * 1.5, ph + 1, col, band)); }
      }
    }
  }
  /** 神の手（巨大な岩の手）: 最後の地の目印。黒い太陽へ手を伸ばす */
  function r6Hand(c, w, h) {
    const px = 80, py = 118;
    const pass = (dx, dy, col) => {
      c.fillStyle = col;
      // 腕（岩の柱）
      c.beginPath(); c.moveTo(px - 44 + dx, h); c.quadraticCurveTo(px - 32 + dx, py + 50 + dy, px - 24 + dx, py + 20 + dy);
      c.lineTo(px + 32 + dx, py + 16 + dy); c.quadraticCurveTo(px + 38 + dx, py + 50 + dy, px + 60 + dx, h); c.closePath(); c.fill();
      c.save(); c.translate(px + dx, py + dy); c.rotate(0.22);
      // 掌
      c.beginPath(); c.moveTo(-30, 26); c.lineTo(-34, -18); c.quadraticCurveTo(0, -30, 34, -20); c.lineTo(30, 26); c.closePath(); c.fill();
      // 指（天を掴むように少し曲がる）
      for (const [fx, len, ang] of [[-24, 60, -0.3], [-8, 84, -0.1], [9, 80, 0.08], [25, 60, 0.28]]) {
        c.save(); c.translate(fx, -18); c.rotate(ang);
        c.beginPath(); c.moveTo(-7.5, 4); c.quadraticCurveTo(-9, -len * 0.55, -4, -len);
        c.quadraticCurveTo(0, -len - 6, 4, -len + 3); c.quadraticCurveTo(8.5, -len * 0.5, 7.5, 4); c.closePath(); c.fill();
        c.restore();
      }
      // 親指
      c.beginPath(); c.moveTo(-30, 10); c.quadraticCurveTo(-58, -4, -64, -34); c.lineTo(-54, -38); c.quadraticCurveTo(-48, -14, -26, -6); c.closePath(); c.fill();
      c.restore();
    };
    pass(-2, -1.5, '#8a2016');
    pass(0, 0, '#1a0205');
    // 岩のひびと関節
    c.save(); c.translate(px, py); c.rotate(0.22);
    c.strokeStyle = 'rgba(110,26,20,0.6)'; c.lineWidth = 1;
    c.beginPath();
    c.moveTo(-10, 24); c.lineTo(-4, 4); c.lineTo(-8, -12); c.moveTo(14, 22); c.lineTo(18, 0);
    for (const [fx, len, ang] of [[-8, 84, -0.1], [9, 80, 0.08]]) { const k = Math.sin(ang); c.moveTo(fx - 5 + k * 30, -18 - len * 0.4); c.lineTo(fx + 3 + k * 30, -18 - len * 0.42); }
    c.stroke();
    c.restore();
  }
  /** 宙を舞う使徒の影 */
  function r6Fly(kind) {
    return (c, w, h) => {
      c.fillStyle = SIL6; c.strokeStyle = SIL6; c.lineCap = 'round';
      const cx = w / 2, cy = h / 2;
      if (kind === 'bat') {
        for (const s of [-1, 1]) {
          c.beginPath(); c.moveTo(cx, cy - 2); c.quadraticCurveTo(cx + s * 20, cy - 20, cx + s * 44, cy - 12);
          for (let i = 0; i < 4; i++) { const x = cx + s * (44 - i * 11); c.quadraticCurveTo(x - s * 5, cy + 2, x - s * 11, cy + (i === 3 ? 4 : -4)); }
          c.lineTo(cx, cy + 6); c.closePath(); c.fill();
        }
        c.beginPath(); c.ellipse(cx, cy + 4, 6, 12, 0, 0, TAU); c.fill();
        c.beginPath(); c.arc(cx, cy - 8, 5, 0, TAU); c.fill();
        c.lineWidth = 2; c.beginPath(); c.moveTo(cx - 3, cy - 11); c.quadraticCurveTo(cx - 8, cy - 18, cx - 5, cy - 22); c.moveTo(cx + 3, cy - 11); c.quadraticCurveTo(cx + 8, cy - 18, cx + 5, cy - 22); c.stroke();
        c.beginPath(); c.moveTo(cx - 3, cy + 14); c.lineTo(cx - 5, cy + 20); c.moveTo(cx + 3, cy + 14); c.lineTo(cx + 5, cy + 20); c.stroke();
      } else if (kind === 'worm') {
        for (let i = 0; i < 26; i++) {
          const k = i / 25, x = 10 + k * (w - 26), y = cy + Math.sin(k * TAU * 1.2) * 8;
          c.beginPath(); c.arc(x, y, 1.5 + Math.sin(k * Math.PI) * 5.5, 0, TAU); c.fill();
        }
        const hx = w - 14, hy = cy + Math.sin(TAU * 1.2) * 8;
        c.beginPath(); c.ellipse(hx, hy, 8, 6, 0, 0, TAU); c.fill();
        c.lineWidth = 1.6; c.beginPath(); c.moveTo(hx + 6, hy - 3); c.lineTo(hx + 13, hy - 6); c.moveTo(hx + 6, hy + 3); c.lineTo(hx + 13, hy + 6); c.stroke();
        c.beginPath(); c.moveTo(w * 0.55, cy - 4); c.quadraticCurveTo(w * 0.5, cy - 20, w * 0.38, cy - 18); c.lineTo(w * 0.48, cy - 4); c.closePath(); c.fill();
      } else if (kind === 'eye') {
        c.beginPath(); c.arc(cx, 16, 14, 0, TAU); c.fill();
        c.lineWidth = 2.2;
        for (let i = 0; i < 5; i++) { const x = cx - 10 + i * 5; c.beginPath(); c.moveTo(x, 26); c.quadraticCurveTo(x + (i % 2 ? 6 : -6), 38, x + (i - 2) * 2, h - 2); c.stroke(); }
        c.fillStyle = '#e8b050'; c.beginPath(); c.ellipse(cx + 3, 15, 4.5, 2.6, 0, 0, TAU); c.fill();
        c.fillStyle = '#200000'; c.beginPath(); c.ellipse(cx + 3, 15, 1.2, 2.4, 0, 0, TAU); c.fill();
      } else {
        c.beginPath(); c.moveTo(4, cy + 2); c.quadraticCurveTo(cx - 14, cy - 14, cx + 6, cy - 4); c.quadraticCurveTo(cx + 20, cy - 12, w - 10, cy - 2);
        c.quadraticCurveTo(cx + 18, cy + 4, cx + 6, cy + 6); c.quadraticCurveTo(cx - 12, cy + 8, 4, cy + 2); c.closePath(); c.fill();
        c.lineWidth = 1.5; c.beginPath(); c.moveTo(cx - 8, cy + 4); c.quadraticCurveTo(cx - 30, cy + 14, 4, cy + 12); c.stroke();
      }
    };
  }
  /** 顔でできた崖（中景） */
  function r6Faces(c, w, h) {
    const r = U.srand(7404);
    const topAt = x => 40 + Math.sin(x / w * TAU * 2 + 0.5) * 14 + Math.sin(x / w * TAU * 5 + 1) * 7 + Math.sin(x / w * TAU * 9) * 3;
    c.fillStyle = '#1a0508';
    c.beginPath(); c.moveTo(0, h);
    for (let x = 0; x <= w; x += 6) c.lineTo(x, topAt(x));
    c.lineTo(w, h); c.closePath(); c.fill();
    const cols = ['#300a0e', '#380c10', '#2a070b', '#3e1014'];
    for (let y = 30; y < h + 10; y += 9 + r() * 3) {
      for (let x = r() * 12; x < w; x += 13 + r() * 9) {
        if (y < topAt(x) + 6) continue;
        const s = 5.5 + r() * 4.5 + (y / h) * 2, tilt = (r() - 0.5) * 0.5, col = cols[Math.floor(r() * cols.length)];
        const openMouth = r() < 0.6;
        wrapX(w, x, s * 1.4, xx => {
          c.save(); c.translate(xx, y); c.rotate(tilt);
          c.fillStyle = '#110304'; c.beginPath(); c.ellipse(0.8, 1.2, s, s * 1.28, 0, 0, TAU); c.fill();
          c.fillStyle = col; c.beginPath(); c.ellipse(0, 0, s, s * 1.25, 0, 0, TAU); c.fill();
          c.fillStyle = 'rgba(255,120,100,0.05)'; c.beginPath(); c.ellipse(-s * 0.2, -s * 0.5, s * 0.6, s * 0.4, 0, 0, TAU); c.fill();
          c.fillStyle = '#0c0203';
          c.beginPath(); c.ellipse(-s * 0.38, -s * 0.15, s * 0.2, s * 0.26, 0.2, 0, TAU); c.ellipse(s * 0.38, -s * 0.15, s * 0.2, s * 0.26, -0.2, 0, TAU); c.fill();
          c.beginPath();
          if (openMouth) c.ellipse(0, s * 0.58, s * 0.2, s * 0.3, 0, 0, TAU);
          else c.ellipse(0, s * 0.6, s * 0.3, s * 0.07, 0, 0, TAU);
          c.fill();
          c.restore();
        });
      }
    }
    // 下ほど暗く
    const g = c.createLinearGradient(0, 60, 0, h);
    g.addColorStop(0, 'rgba(10,0,2,0)'); g.addColorStop(1, 'rgba(10,0,2,0.6)');
    c.fillStyle = g; c.fillRect(0, 60, w, h - 60);
    // 縁（紅い空の照り返し）
    c.strokeStyle = 'rgba(170,40,30,0.4)'; c.lineWidth = 1.2;
    c.beginPath(); for (let x = 0; x <= w; x += 6) { if (x) c.lineTo(x, topAt(x)); else c.moveTo(x, topAt(x)); } c.stroke();
  }
  /** 近景: 手が生えた肉の畝・肋骨・目 */
  function r6Near(c, w, h) {
    const r = U.srand(7505);
    const topAt = x => 62 + Math.sin(x / w * TAU * 3) * 6 + Math.sin(x / w * TAU * 7 + 2) * 4;
    // 腕（畝の後ろから伸びる）
    const arm = (x, len, lean, s) => {
      const y0 = topAt(x) + 8;
      const ex = x + lean * len * 0.35, ey = y0 - len * 0.5;                          // 肘
      const hx = ex + lean * len * 0.25 + (r() - 0.5) * 6, hy = ey - len * 0.5;       // 手首
      const ang = Math.atan2(hy - ey, hx - ex);
      const draw = (dx, dy, col) => {
        c.strokeStyle = col; c.fillStyle = col; c.lineCap = 'round'; c.lineJoin = 'round';
        c.lineWidth = 6.5 * s; c.beginPath(); c.moveTo(x + dx, y0 + dy); c.lineTo(ex + dx, ey + dy); c.lineTo(hx + dx, hy + dy); c.stroke();
        const pcx = hx + Math.cos(ang) * 4 * s + dx, pcy = hy + Math.sin(ang) * 4 * s + dy;
        c.beginPath(); c.ellipse(pcx, pcy, 5.2 * s, 5.8 * s, ang + Math.PI / 2, 0, TAU); c.fill();
        // 指（広げてもがく）
        c.lineWidth = 2.2 * s; c.beginPath();
        for (let i = 0; i < 5; i++) {
          const a = ang + (i - 2) * 0.42 + (i === 0 ? -0.5 : 0);
          const fl = (i === 0 ? 7 : i === 2 ? 12 : 10) * s, cu = 0.3 + (i - 2) * 0.1;
          const bx = pcx + Math.cos(a) * 4 * s, by = pcy + Math.sin(a) * 4 * s;
          c.moveTo(bx, by); c.quadraticCurveTo(bx + Math.cos(a) * fl * 0.6, by + Math.sin(a) * fl * 0.6, bx + Math.cos(a + cu) * fl, by + Math.sin(a + cu) * fl);
        }
        c.stroke();
      };
      draw(-1.3, -0.9, 'rgba(150,34,28,0.5)');
      draw(0, 0, '#100203');
    };
    for (let x = 30 + r() * 20; x < w - 30; x += 75 + r() * 70) arm(x, 30 + r() * 26, (r() - 0.5) * 1.2, 1.05 + r() * 0.4);
    // 畝
    c.fillStyle = '#1e0507';
    c.beginPath(); c.moveTo(0, h);
    for (let x = 0; x <= w; x += 5) c.lineTo(x, topAt(x));
    c.lineTo(w, h); c.closePath(); c.fill();
    c.strokeStyle = 'rgba(150,34,28,0.45)'; c.lineWidth = 1.3;
    c.beginPath(); for (let x = 0; x <= w; x += 5) { if (x) c.lineTo(x, topAt(x) + 0.5); else c.moveTo(x, topAt(x) + 0.5); } c.stroke();
    // 皺・襞
    c.strokeStyle = 'rgba(0,0,0,0.4)'; c.lineWidth = 1.2;
    c.beginPath();
    for (let i = 0; i < 40; i++) { const x = r() * w, y = topAt(x) + 8 + r() * (h - topAt(x) - 12); c.moveTo(x - 12, y); c.quadraticCurveTo(x, y - 4, x + 12, y + 1); }
    c.stroke();
    // 肋骨
    for (const rx of [210, 640]) {
      const y0 = topAt(rx) + 4;
      c.strokeStyle = '#5a4436'; c.lineWidth = 3; c.lineCap = 'round';
      c.beginPath();
      for (let i = 0; i < 5; i++) { const x = rx + i * 11; c.moveTo(x, y0 + 4); c.quadraticCurveTo(x + 10, y0 - 22 - i, x + 22, y0 - 16 + i * 2); }
      c.stroke();
      c.strokeStyle = 'rgba(20,4,4,0.6)'; c.lineWidth = 1; c.stroke();
    }
    // 目（半ば閉じた瞼）
    for (const ex of [120, 430, 790]) {
      const ey = topAt(ex) + 18, s = 7;
      c.fillStyle = '#0e0203'; c.beginPath(); c.ellipse(ex, ey, s * 1.7, s, 0, 0, TAU); c.fill();
      c.fillStyle = '#b8a896'; c.beginPath(); c.ellipse(ex, ey + 1, s * 1.4, s * 0.62, 0, 0, TAU); c.fill();
      c.fillStyle = '#8a1010'; c.beginPath(); c.arc(ex + 1, ey + 1, s * 0.5, 0, TAU); c.fill();
      c.fillStyle = '#080000'; c.beginPath(); c.arc(ex + 1, ey + 1, s * 0.22, 0, TAU); c.fill();
      c.fillStyle = '#2a080a'; c.beginPath(); c.ellipse(ex, ey - 2, s * 1.55, s * 0.62, 0, Math.PI, TAU); c.fill();
    }
    // 床際の影
    const g = c.createLinearGradient(0, h - 14, 0, h);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.5)');
    c.fillStyle = g; c.fillRect(0, h - 14, w, 14);
  }
  /** 肉の大地（床） */
  function r6Floor(c, w, h) {
    const r = U.srand(7606);
    vgrad(c, w, h, [[0, '#1e0709'], [0.5, '#301012'], [1, '#3e1618']]);
    // 膜のような肉の板
    let y = 0, rh = 8, row = 0;
    while (y < h) {
      const n = Math.max(3, Math.round(w / (rh * 3.2)));
      let x = r() * w;
      for (let i = 0; i < n; i++) {
        const sw = w / n * (0.8 + r() * 0.4), cx = x + sw / 2, cy = y + rh / 2 + (r() - 0.5) * rh * 0.2;
        const k = y / h, v = r();
        const col = `rgb(${40 + k * 22 + v * 10 | 0},${13 + k * 8 + v * 3 | 0},${15 + k * 8 + v * 3 | 0})`;
        wrapX(w, cx, sw / 2 + 2, xx => {
          c.fillStyle = col; c.beginPath(); c.ellipse(xx, cy, sw / 2 - 0.6, rh / 2 - 0.4, 0, 0, TAU); c.fill();
          c.strokeStyle = 'rgba(14,2,4,0.6)'; c.lineWidth = 1; c.stroke();
          c.strokeStyle = 'rgba(160,70,66,0.16)'; c.lineWidth = 0.8;
          c.beginPath(); c.ellipse(xx, cy, sw / 2 - 2, rh / 2 - 1.5, 0, Math.PI * 1.1, Math.PI * 1.6); c.stroke();
        });
        x += w / n;
      }
      y += rh; rh *= 1.16; row++;
    }
    // 血管
    for (let i = 0; i < 7; i++) {
      const y0 = 10 + r() * (h - 20), x0 = r() * w, len = 160 + r() * 260, d = 0.5 + y0 / h;
      const pts = [];
      let px = x0, py = y0;
      for (let j = 0; j < 10; j++) { pts.push(px, py); px += len / 10; py += (r() - 0.5) * 12 * d; py = U.clamp(py, 4, h - 2); }
      wrapX(w, x0 + len / 2, len / 2, cxx => {
        const off = cxx - (x0 + len / 2);
        for (const [lw, col, dy] of [[2.6 * d, 'rgba(70,8,10,0.9)', 0], [0.9 * d, 'rgba(170,50,40,0.55)', -0.7]]) {
          c.strokeStyle = col; c.lineWidth = lw; c.beginPath();
          c.moveTo(pts[0] + off, pts[1] + dy);
          for (let j = 2; j < pts.length; j += 2) c.quadraticCurveTo(pts[j - 2] + off + 8, pts[j - 1] + dy + 3, pts[j] + off, pts[j + 1] + dy);
          c.stroke();
        }
      });
    }
    // 浅く浮かぶ顔（床の起伏）
    for (let i = 0; i < 4; i++) {
      const yy = 30 + r() * (h - 50), d = 0.5 + yy / h, x = r() * w, s = 9 * d;
      wrapX(w, x, s * 2, xx => {
        c.fillStyle = 'rgba(110,40,38,0.35)'; c.beginPath(); c.ellipse(xx, yy, s * 1.4, s * 0.8, 0, 0, TAU); c.fill();
        c.fillStyle = 'rgba(20,2,4,0.55)';
        c.beginPath(); c.ellipse(xx - s * 0.5, yy - s * 0.15, s * 0.22, s * 0.1, 0, 0, TAU); c.ellipse(xx + s * 0.5, yy - s * 0.15, s * 0.22, s * 0.1, 0, 0, TAU); c.ellipse(xx, yy + s * 0.35, s * 0.2, s * 0.14, 0, 0, TAU); c.fill();
      });
    }
    // 骨片
    c.strokeStyle = 'rgba(190,170,150,0.5)'; c.lineCap = 'round';
    for (let i = 0; i < 12; i++) { const yy = 10 + r() * (h - 14), d = 0.5 + yy / h, x = r() * w, a = (r() - 0.5) * 0.8; c.lineWidth = 2 * d; c.beginPath(); c.moveTo(x, yy); c.lineTo(x + Math.cos(a) * 8 * d, yy + Math.sin(a) * 3 * d); c.stroke(); }
    // 湿った照り
    c.fillStyle = 'rgba(230,140,130,0.16)';
    for (let i = 0; i < 70; i++) c.fillRect(r() * w, r() * h, 1 + r() * 2, 1);
    floorShade(c, w, 0.6, 36);
  }
  /** 前景: 地の底から伸びる黒い手 */
  function r6FgHand(c, w, h) {
    const cx = w / 2;
    c.fillStyle = '#060001';
    c.beginPath(); c.moveTo(cx - 12, h); c.quadraticCurveTo(cx - 10, h - 40, cx - 4, h - 60); c.lineTo(cx + 8, h - 58); c.quadraticCurveTo(cx + 12, h - 36, cx + 14, h); c.closePath(); c.fill();
    c.beginPath(); c.ellipse(cx + 2, h - 66, 10, 11, -0.2, 0, TAU); c.fill();
    c.strokeStyle = '#060001'; c.lineCap = 'round';
    const fingers = [[-0.9, 14, 3], [-0.35, 20, 3.4], [0.05, 22, 3.4], [0.45, 19, 3.2], [1.2, 12, 3.4]];
    for (const [a, len, lw] of fingers) {
      const bx = cx + 2 + Math.sin(a) * 8, by = h - 70 - Math.cos(a) * 6;
      c.lineWidth = lw; c.beginPath(); c.moveTo(bx, by);
      c.quadraticCurveTo(bx + Math.sin(a) * len * 0.7, by - Math.cos(a) * len * 0.7, bx + Math.sin(a + 0.5) * len, by - Math.cos(a + 0.5) * len);
      c.stroke();
    }
    c.strokeStyle = 'rgba(120,20,16,0.5)'; c.lineWidth = 1;
    c.beginPath(); c.moveTo(cx - 11, h); c.quadraticCurveTo(cx - 9, h - 40, cx - 4, h - 58); c.stroke();
  }

  function layers6() {
    return {
      sky: BG.layer('s6sky', 4, FT, r6Sky),
      vortex: BG.layer('s6vortex', 420, 420, r6Vortex), corona: BG.layer('s6corona', 260, 260, r6Corona),
      spires: BG.layer('s6spires', 1000, 190, r6Spires), hand: BG.layer('s6hand', 180, 190, r6Hand),
      fly: {
        bat: BG.layer('s6fbat', 96, 48, r6Fly('bat')), worm: BG.layer('s6fworm', 100, 44, r6Fly('worm')),
        eye: BG.layer('s6feye', 44, 60, r6Fly('eye')), ray: BG.layer('s6fray', 84, 34, r6Fly('ray')),
      },
      faces: BG.layer('s6faces', 1100, 150, r6Faces), near: BG.layer('s6near', 1000, 110, r6Near),
      floor: BG.layer('s6floor', 1024, FH, r6Floor), fgHand: BG.layer('s6fghand', 50, 100, r6FgHand),
    };
  }
  function st6(g) {
    if (!g.s6) g.s6 = { bossT: -1 };
    return g.s6;
  }
  /** 心臓の鼓動（どくん、どくん）0..1 */
  function beat(t) {
    const p = t % 120;
    return Math.max(0, 1 - p / 12) + Math.max(0, 1 - Math.abs(p - 20) / 9) * 0.6;
  }

  BK.stages[5] = {
    id: 6, name: '蝕', sub: '異界と化した夜', len: LEN6,
    bgm: 'stage6', bossBgm: 'lastboss', heal: 0.5,
    intro: '天に穿たれた黒い太陽。\n捧げられた者たちの叫びが、異界の風となって吹き荒れる。\n──蝕。白い鷹は、闇の翼を広げた。',
    props: [
      { x: 330, y: 30, type: 'urn', item: 'bread' }, { x: 380, y: 96, type: 'barrel', item: 'meat' },
      { x: 900, y: 60, type: 'grave', item: 'gem' },
      { x: 1400, y: 24, type: 'crate', item: 'knives' }, { x: 1450, y: 100, type: 'urn', item: 'wine' },
      { x: 2050, y: 90, type: 'barrel', item: 'firepot' }, { x: 2100, y: 30, type: 'urn', item: 'meat' },
      // 最後の息継ぎ: 神の手へ向かう道
      { x: 2780, y: 30, type: 'barrel', item: 'roast' }, { x: 2830, y: 96, type: 'crate', item: 'wine' },
      { x: 2940, y: 62, type: 'grave', item: 'behelit' },
      // ボス戦の画面内（妖精の鱗粉は最後の贈り物）
      { x: 3300, y: 24, type: 'urn', item: 'dust' }, { x: 3620, y: 96, type: 'barrel', item: 'meat' },
    ],
    events: [
      { at: 120, waves: [
        [{ t: 'apostle', palette: 'flesh', side: 'R', y: 50 }, { t: 'leaper', side: 'R', y: 94, off: 40 }, { t: 'leaper', side: 'L', y: 26, delay: 40 }],
        [{ t: 'moth', side: 'R', y: 30 }, { t: 'moth', side: 'R', y: 84, delay: 20 }, { t: 'moth', side: 'L', y: 60, delay: 40 }, { t: 'spirit', side: 'R', y: 100, delay: 30 }]], next: 1 },
      { at: 620, waves: [
        [{ t: 'leaper', side: 'R', y: 20 }, { t: 'leaper', side: 'R', y: 100, off: 30 }, { t: 'apostle', palette: 'bone', side: 'L', y: 60 }],
        [{ t: 'troll', side: 'R', y: 60 }, { t: 'spirit', side: 'L', y: 30 }, { t: 'spirit', side: 'L', y: 90, delay: 20 }],
        [{ t: 'apostle', palette: 'flesh', side: 'R', y: 40 }, { t: 'moth', side: 'R', y: 90, delay: 20 }, { t: 'leaper', side: 'L', y: 70, delay: 40 }]], next: 1 },
      { at: 1180, waves: [
        [{ t: 'apostle', palette: 'horn', side: 'R', y: 60 }, { t: 'apostle', palette: 'flesh', side: 'L', y: 40, delay: 30 }, { t: 'moth', side: 'R', y: 100, delay: 30 }],
        [{ t: 'leaper', side: 'R', y: 30 }, { t: 'leaper', side: 'R', y: 90, off: 40 }, { t: 'leaper', side: 'L', y: 60, delay: 30 }, { t: 'spirit', side: 'R', y: 60, delay: 60 }],
        [{ t: 'troll', side: 'R', y: 50 }, { t: 'apostle', palette: 'bone', side: 'L', y: 90 }, { t: 'moth', side: 'R', y: 20, delay: 40 }]], next: 1 },
      { at: 1760, waves: [
        [{ t: 'spirit', side: 'R', y: 20 }, { t: 'spirit', side: 'R', y: 60, delay: 10 }, { t: 'spirit', side: 'L', y: 100, delay: 20 }, { t: 'spirit', side: 'L', y: 40, delay: 30 }, { t: 'moth', side: 'R', y: 80, delay: 40 }],
        [{ t: 'apostle', palette: 'horn', side: 'R', y: 40 }, { t: 'apostle', palette: 'horn', side: 'L', y: 90, delay: 40 }, { t: 'leaper', side: 'R', y: 70, delay: 60 }],
        [{ t: 'troll', side: 'R', y: 30 }, { t: 'troll', side: 'L', y: 90, delay: 60 }, { t: 'spirit', side: 'R', y: 60, delay: 30 }]], next: 1 },
      { at: 2340, onStart(g) { BK.fx.shake(5, 30); BK.audio.sfx('roar', { pitch: 0.55, vol: 0.6 }); }, waves: [
        [{ t: 'apostle', palette: 'flesh', side: 'R', y: 30 }, { t: 'apostle', palette: 'bone', side: 'R', y: 90, off: 40 }, { t: 'leaper', side: 'L', y: 60 }, { t: 'moth', side: 'R', y: 50, delay: 40 }],
        [{ t: 'troll', side: 'R', y: 60 }, { t: 'apostle', palette: 'horn', side: 'L', y: 30 }, { t: 'leaper', side: 'R', y: 100, delay: 40 }, { t: 'leaper', side: 'L', y: 90, delay: 60 }],
        [{ t: 'apostle', palette: 'horn', side: 'R', y: 20 }, { t: 'apostle', palette: 'flesh', side: 'R', y: 100, off: 40 }, { t: 'apostle', palette: 'bone', side: 'L', y: 60, delay: 30 }, { t: 'spirit', side: 'R', y: 60, delay: 50 }, { t: 'spirit', side: 'L', y: 30, delay: 70 }]], next: 1 },
      // 最終ボス: フェムト（神の手の下、黒い太陽を背に降臨する）
      { at: 3150, boss: 'femto', x: 480, y: 60, waves: [],
        onStart(g) { st6(g).bossT = 0; } },
    ],
    init(g) {
      g.s6 = null; st6(g);
      layers6();
    },
    update(g) {
      const S = st6(g);
      if (S.bossT >= 0) S.bossT++;
    },
    drawBg(c, g) {
      const S = st6(g), L = layers6(), t = g.time, cam = BK.cam.x, W = BK.W;
      const maxCam = Math.max(1, LEN6 - W);
      c.drawImage(L.sky, 0, 0, W, FT);
      // ---- 蝕: 進むほど黒い太陽が陽を覆い尽くす。ボスを倒すと離れていく
      const prog = U.clamp(cam / maxCam, 0, 1);
      let cover = S.bossT >= 0 ? 1 : 0.78 + prog * 0.22;
      if (g.bossDefeated) cover = 1 - Math.min(1, (g.clearT || 0) / 240) * 0.8;
      const ex = W * 0.56 + maxCam * 0.03 - cam * 0.03, ey = 52, R = 30;
      const pulse = 1 + Math.sin(t * (S.bossT >= 0 ? 0.09 : 0.035)) * 0.03;
      c.save(); c.translate(ex, ey); c.scale(1, 0.42); c.rotate(t * 0.0018);
      c.globalAlpha = 0.85; c.drawImage(L.vortex, -210, -210, 420, 420); c.restore();
      c.globalAlpha = 0.45 + cover * 0.45;
      const cs = 1.05 * pulse * (S.bossT >= 0 ? 1.12 : 1);
      c.drawImage(L.corona, ex - 130 * cs, ey - 130 * cs, 260 * cs, 260 * cs);
      c.globalAlpha = 1;
      c.fillStyle = '#fff1d6'; c.beginPath(); c.arc(ex, ey, R, 0, TAU); c.fill();
      const off = (1 - cover) * R * 1.9;
      c.fillStyle = '#060000'; c.beginPath(); c.arc(ex - off * 0.8, ey + off * 0.6, R - 0.6, 0, TAU); c.fill();
      if (cover > 0.97) { c.strokeStyle = 'rgba(255,226,180,0.9)'; c.lineWidth = 1.4; c.beginPath(); c.arc(ex, ey, R + 0.4, 0, TAU); c.stroke(); }
      if (g.bossDefeated) { c.fillStyle = `rgba(255,190,140,${Math.min(0.18, (g.clearT || 0) / 1000)})`; c.fillRect(0, 0, W, FT); }
      // ---- 遠景
      BG.tile(c, L.spires, 0.08, 164 - L.spires.lh);
      const hx = W * 0.36 + maxCam * 0.1 - cam * 0.1;
      if (hx > -120 && hx < W + 120) spr(c, L.hand, hx - 80, 178 - L.hand.lh);
      // 宙を舞う使徒の影
      const span = W + 240;
      for (const f of FLY6) {
        let x = (f.x - cam * f.f + t * f.vx) % span; if (x < 0) x += span; x -= 120;
        const y = f.y + Math.sin(t * 0.02 + f.ph) * 6, cv = L.fly[f.k];
        const sy = f.s * (f.k === 'bat' ? 0.85 + Math.sin(t * 0.12 + f.ph) * 0.15 : 1);
        c.save();
        c.translate(x, y); c.scale(f.vx < 0 ? -f.s : f.s, sy);
        c.globalAlpha = 0.9; c.drawImage(cv, -cv.lw / 2, -cv.lh / 2, cv.lw, cv.lh);
        c.restore();
      }
      c.globalAlpha = 1;
      // ---- 中景・近景・床
      BG.tile(c, L.faces, 0.35, 206 - L.faces.lh);
      BG.tile(c, L.near, 0.7, 212 - L.near.lh);
      BG.tile(c, L.floor, 1, FY);
      const hb = beat(t);
      if (hb > 0.02) { c.fillStyle = `rgba(150,0,12,${0.07 * hb})`; c.fillRect(0, FY, W, FH); }
    },
    drawFg(c, g) {
      const S = st6(g), L = layers6(), t = g.time, cam = BK.cam.x, W = BK.W, H = BK.H;
      // 地から伸びる黒い手
      for (let i = 0; i < 7; i++) {
        const px = 380 + i * 820, sx = px - cam * 1.3;
        if (sx < -50 || sx > W + 50) continue;
        c.save(); c.translate(sx, H + 8); c.rotate(Math.sin(t * 0.025 + i * 1.7) * 0.07 + (i % 2 ? 0.12 : -0.1));
        c.drawImage(L.fgHand, -25, -100, 50, 100); c.restore();
      }
      // 降る灰と火の粉
      const m = W + 40;
      for (let pass = 0; pass < 2; pass++) {
        c.fillStyle = pass ? 'rgba(255,90,40,0.7)' : 'rgba(150,128,124,0.5)';
        c.beginPath();
        for (let i = pass; i < 64; i += 2) {
          if (pass && i % 6 !== 1) continue;
          const a = RA[i + 100], b = RB[i + 100];
          const y = (b * (H + 20) + t * (0.35 + a * 0.5)) % (H + 20) - 10;
          let x = (a * m - t * (0.5 + b * 0.4) - cam * (0.9 + b * 0.5) + Math.sin(t * 0.02 + i) * 8) % m;
          if (x < 0) x += m;
          const s = 1 + (i % 3) * 0.6;
          c.rect(x - 20, y, s, s);
        }
        c.fill();
      }
      if (S.bossT >= 0 && S.bossT < 60) { c.fillStyle = `rgba(255,40,20,${0.25 * (1 - S.bossT / 60)})`; c.fillRect(0, 0, W, H); }
      // 紅く沈む周辺減光（BG.vignette の赤い版。全画面の塗りは1回だけ）
      const vg = c.createRadialGradient(W / 2, H * 0.55, H * 0.28, W / 2, H * 0.55, W * 0.75);
      vg.addColorStop(0, 'rgba(60,0,6,0.08)'); vg.addColorStop(1, 'rgba(14,0,2,0.66)');
      c.fillStyle = vg; c.fillRect(0, 0, W, H);
    },
  };
})(window.BK);

'use strict';
/* =====================================================================
 *  stages_2to4.js ── ROUND 2〜4
 *   ROUND 2「伯爵の地下牢」 地下牢 → 下水路。緑灰色の石、鎖と拷問具、松明の灯り   ボス: 伯爵
 *   ROUND 3「疾駆」         夕暮れの森を戦馬車で逃走（AvP の APC 面に相当）         ボス: 不死のゾッド
 *   ROUND 4「霧の森」       巨木・光る茸・妖精の灯りが漂う霧の森                   ボス: ロシーヌ
 *
 *  背景の静的な絵はすべて BK.bg.layer で一度だけ描いてキャッシュし、
 *  毎フレームは drawImage と、炎・水・灯りなど少しの動く装飾だけを描く。
 * ===================================================================== */
(function (BK) {
  const U = BK.U, BG = BK.bg;
  const FT = BK.FLOOR_TOP;        // 212: 奥行き y=0 の足元の画面 y
  const FLOOR_Y = FT - 14;        // 床レイヤーの上端（BG.cobbles と同じ）
  const TAU = Math.PI * 2;

  // ================================================================ 共通ヘルパー
  const spr = (c, cv, x, y) => c.drawImage(cv, x, y, cv.lw, cv.lh);
  /** BG.tile と同じ計算で、ループするレイヤーの先頭タイルの画面 x を返す */
  function tile0(f, w, off) {
    let x = -((BK.cam.x * f + (off || 0)) % w);
    if (x > 0) x -= w;
    return x;
  }
  /** 区間の継ぎ目: カメラ位置 cx のとき画面中央に来る、係数 f のレイヤー上での画面 x */
  const seamX = (cx, f) => BK.W * 0.5 + (cx - BK.cam.x) * f;
  function clipRect(c, x0, y0, x1, y1) { c.save(); c.beginPath(); c.rect(x0, y0, x1 - x0, y1 - y0); c.clip(); }
  /** 継ぎ目 s の左に a、右に b のループレイヤーを描く */
  function dualTile(c, s, a, ya, b, yb, f) {
    if (s >= BK.W) { BG.tile(c, a, f, ya); return; }
    if (s <= 0) { BG.tile(c, b, f, yb); return; }
    clipRect(c, 0, 0, s, BK.H); BG.tile(c, a, f, ya); c.restore();
    clipRect(c, s, 0, BK.W, BK.H); BG.tile(c, b, f, yb); c.restore();
  }
  /** 放射状の光のスプライト（一度だけ作って drawImage で使い回す） */
  const GLOW = {
    warm: '255,150,70', sun: '255,196,120', sewer: '170,225,190', cyan: '110,255,215', lamp: '255,190,100',
    fy: '255,238,160', fp: '255,172,222', fg: '170,255,200', moon: '205,235,230',
  };
  function gl(name) {
    const rgb = GLOW[name];
    return BG.layer('s24glow_' + name, 64, 64, c => {
      const g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
      g.addColorStop(0, `rgba(${rgb},1)`); g.addColorStop(0.22, `rgba(${rgb},0.55)`);
      g.addColorStop(0.55, `rgba(${rgb},0.16)`); g.addColorStop(1, `rgba(${rgb},0)`);
      c.fillStyle = g; c.fillRect(0, 0, 64, 64);
    });
  }
  function glow(c, cv, x, y, rx, a, ry) {
    if (a <= 0.01) return;
    ry = ry || rx;
    c.globalAlpha = a > 1 ? 1 : a;
    c.drawImage(cv, x - rx, y - ry, rx * 2, ry * 2);
    c.globalAlpha = 1;
  }
  /** 鎖（輪を交互に描く） */
  function chain(c, x0, y0, x1, y1, col, lw, sz) {
    sz = sz || 1;
    const dx = x1 - x0, dy = y1 - y0, d = Math.hypot(dx, dy) || 1, n = Math.max(1, Math.round(d / (4.6 * sz)));
    const ca = dx / d, sa = dy / d, ang = Math.atan2(dy, dx);
    c.strokeStyle = col; c.lineWidth = lw || 1.2;
    c.beginPath();
    for (let i = 0; i < n; i++) {
      const k = (i + 0.5) / n, x = x0 + dx * k, y = y0 + dy * k;
      if (i % 2) { c.moveTo(x - ca * 2.6 * sz, y - sa * 2.6 * sz); c.lineTo(x + ca * 2.6 * sz, y + sa * 2.6 * sz); }
      else { c.moveTo(x + ca * 3 * sz, y + sa * 3 * sz); c.ellipse(x, y, 3 * sz, 1.7 * sz, ang, 0, TAU); }
    }
    c.stroke();
  }
  /** 揺らめく炎 */
  function flame(c, x, y, s, t, seed) {
    const w1 = Math.sin(t * 0.33 + seed) * 0.14 + Math.sin(t * 0.87 + seed * 1.7) * 0.09;
    const hh = s * (1.05 + w1);
    c.fillStyle = '#e25a18';
    c.beginPath(); c.moveTo(x - s * 0.42, y);
    c.quadraticCurveTo(x - s * 0.56, y - hh * 0.55, x + w1 * s * 1.6, y - hh);
    c.quadraticCurveTo(x + s * 0.56, y - hh * 0.5, x + s * 0.42, y); c.closePath(); c.fill();
    c.fillStyle = '#ffd36a';
    c.beginPath(); c.moveTo(x - s * 0.2, y);
    c.quadraticCurveTo(x - s * 0.27, y - hh * 0.35, x + w1 * s, y - hh * 0.6);
    c.quadraticCurveTo(x + s * 0.27, y - hh * 0.3, x + s * 0.2, y); c.closePath(); c.fill();
  }
  /** 壁掛けの松明（灯り + 炎 + 床の灯りだまり） */
  function torch(c, x, y, t, seed, floorLight) {
    const fl = 0.86 + Math.sin(t * 0.21 + seed) * 0.08 + Math.sin(t * 0.63 + seed * 3) * 0.05;
    const warm = gl('warm');
    glow(c, warm, x, y - 8, 96 * fl, 0.4);
    if (floorLight) glow(c, warm, x, FT + 10, 150 * fl, 0.34, 30);
    flame(c, x, y, 11, t, seed);
  }
  /** 石積み（キャッシュ描画用） */
  function blocks(c, w, y0, y1, r, o) {
    c.fillStyle = o.base; c.fillRect(0, y0, w, y1 - y0);
    let row = 0;
    for (let y = y0; y < y1; y += o.bh, row++) {
      let x = row % 2 ? -o.bw * 0.5 : 0;
      while (x < w) {
        const bw = o.bw * (0.7 + r() * 0.6);
        c.fillStyle = o.tints[(r() * o.tints.length) | 0];
        c.fillRect(x + 1, y + 1, bw - 1.5, o.bh - 1.5);
        c.fillStyle = 'rgba(255,255,255,0.05)'; c.fillRect(x + 1, y + 1, bw - 1.5, 1);
        x += bw;
      }
    }
  }
  /** パースのついた敷石の床（キャッシュ描画用） */
  function flagRows(c, w, h, r, o) {
    const g = c.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, o.far); g.addColorStop(1, o.near);
    c.fillStyle = g; c.fillRect(0, 0, w, h);
    let y = 0, rh = o.rh0;
    while (y < h) {
      let x = -r() * rh * 3;
      while (x < w) {
        const sw = rh * o.aspect * (0.7 + r() * 0.6);
        c.fillStyle = r() < 0.55 ? `rgba(0,0,0,${0.04 + r() * 0.14})` : `rgba(${o.tint},${0.02 + r() * 0.05})`;
        c.fillRect(x + 1, y + 1, sw - 2, rh - 2);
        c.fillStyle = o.line; c.fillRect(x, y, 1.3, rh);
        x += sw;
      }
      c.fillStyle = o.line; c.fillRect(0, y, w, 1.3);
      c.fillStyle = `rgba(${o.tint},0.07)`; c.fillRect(0, y + 1.3, w, 1);
      y += rh; rh *= o.grow || 1.15;
    }
  }
  /** 上から下へ消える縦グラデーションの帯 */
  function streak(c, x, y, w, h, rgb, a) {
    const g = c.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, `rgba(${rgb},${a})`); g.addColorStop(1, `rgba(${rgb},0)`);
    c.fillStyle = g; c.fillRect(x, y, w, h);
  }
  /** 奥の影（床の上端を暗く） */
  function topShade(c, w, h, a) {
    const s = c.createLinearGradient(0, 0, 0, h);
    s.addColorStop(0, `rgba(0,0,0,${a})`); s.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = s; c.fillRect(0, 0, w, h);
  }

  // =====================================================================
  //  ROUND 2 伯爵の地下牢
  // =====================================================================
  const CX2 = 1900;             // 地下牢 → 下水路 の切り替え（このカメラ位置で各層の継ぎ目が画面中央）
  const W2Y = FT - 116;         // 地下牢の壁レイヤー（1100×110）の y
  const S2Y = FT - 126;         // 下水路の壁レイヤー（1100×100 → 下端 186）の y
  const CH_T = FT - 28, CH_B = FT - 12;  // 奥の水路（画面 y）
  const TORCH_A = [237, 787];   // 壁レイヤー内の松明の位置
  const TORCH_B = [455, 1005];
  const PIPES_B = [180, 730];   // 下水の排水口
  const PIPE_Y = 60;            // 排水口の中心（壁レイヤー内 y）

  function pillar(c, x, y0, y1, pw, col, hi, dk) {
    c.fillStyle = col; c.fillRect(x - pw / 2, y0, pw, y1 - y0);
    c.fillStyle = hi; c.fillRect(x - pw / 2, y0, 3, y1 - y0);
    c.fillStyle = dk; c.fillRect(x + pw / 2 - 5, y0, 5, y1 - y0);
    c.fillStyle = col; c.fillRect(x - pw / 2 - 6, y0 + 70, pw + 12, 9); c.fillRect(x - pw / 2 - 5, y1 - 14, pw + 10, 14);
    c.fillStyle = hi; c.fillRect(x - pw / 2 - 6, y0 + 70, pw + 12, 1.5);
    c.strokeStyle = 'rgba(0,0,0,0.35)'; c.lineWidth = 1; c.beginPath();
    for (let y = y0 + 92; y < y1 - 14; y += 16) { c.moveTo(x - pw / 2, y); c.lineTo(x + pw / 2, y); }
    c.stroke();
  }
  function cage(c, x, y) {
    c.strokeStyle = '#27302c'; c.lineWidth = 1.6;
    c.beginPath(); c.ellipse(x, y + 4, 12, 4, 0, 0, TAU); c.stroke();
    c.beginPath();
    for (let i = -2; i <= 2; i++) { c.moveTo(x + i * 5.5, y + 4); c.quadraticCurveTo(x + i * 7.5, y + 24, x + i * 5, y + 44); }
    c.stroke();
    c.beginPath(); c.ellipse(x, y + 44, 11, 3.5, 0, 0, TAU); c.stroke();
    // 中でうずくまる骸（シルエット）
    c.fillStyle = '#1a211e';
    c.beginPath(); c.arc(x - 2, y + 22, 4, 0, TAU); c.fill();
    c.beginPath(); c.moveTo(x - 6, y + 43); c.quadraticCurveTo(x - 7, y + 28, x - 1, y + 26); c.quadraticCurveTo(x + 6, y + 32, x + 5, y + 43); c.closePath(); c.fill();
  }
  // ---- 遠景: 闇に沈む回廊（地下牢・下水路 共通）
  function r2Far(c, w, h) {
    const r = U.srand(2101);
    c.fillStyle = '#050706'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#0c1210';
    for (let x = 0; x <= w; x += 100) {
      c.fillRect(x - 7, 52, 14, h - 52);
      c.beginPath(); c.moveTo(x - 7, 72); c.quadraticCurveTo(x + 50, 16, x + 107, 72); c.lineTo(x + 107, 56); c.quadraticCurveTo(x + 50, 0, x - 7, 56); c.closePath(); c.fill();
    }
    c.fillRect(0, 0, w, 30);
    const g = c.createLinearGradient(0, 90, 0, h);
    g.addColorStop(0, 'rgba(40,60,50,0)'); g.addColorStop(1, 'rgba(40,60,50,0.3)');
    c.fillStyle = g; c.fillRect(0, 90, w, h - 90);
    for (let i = 0; i < 6; i++) {
      const x = 30 + r() * (w - 60), y = 104 + r() * 44;
      const gg = c.createRadialGradient(x, y, 0, x, y, 16);
      gg.addColorStop(0, 'rgba(255,140,60,0.4)'); gg.addColorStop(1, 'rgba(255,140,60,0)');
      c.fillStyle = gg; c.fillRect(x - 16, y - 16, 32, 32);
      c.fillStyle = '#ffb050'; c.fillRect(x - 1, y - 2, 2, 3);
    }
  }
  // ---- 中景（地下牢）: 穹窿と柱、吊られた鎖と鉄籠
  function r2VaultA(c, w, h) {
    const r = U.srand(2203), P = 260;
    const stone = '#131a17', rib = '#1d2622', hi = '#28332e';
    c.fillStyle = stone;
    for (let x = 0; x < w; x += P) {
      c.beginPath(); c.moveTo(x, 0); c.lineTo(x + P, 0); c.lineTo(x + P, 98);
      c.quadraticCurveTo(x + P / 2, -18, x, 98); c.closePath(); c.fill();
    }
    c.strokeStyle = 'rgba(0,0,0,0.35)'; c.lineWidth = 1; c.beginPath();
    for (let y = 8; y < 40; y += 10) { c.moveTo(0, y); c.lineTo(w, y); }
    c.stroke();
    for (let x = 0; x < w; x += P) {
      c.strokeStyle = rib; c.lineWidth = 7;
      c.beginPath(); c.moveTo(x + 20, 102); c.quadraticCurveTo(x + P / 2, -8, x + P - 20, 102); c.stroke();
      c.strokeStyle = hi; c.lineWidth = 1.5;
      c.beginPath(); c.moveTo(x + 20, 97); c.quadraticCurveTo(x + P / 2, -13, x + P - 20, 97); c.stroke();
    }
    for (let x = 0; x <= w; x += P) pillar(c, x, 20, h, 34, '#161e1b', hi, '#0c110f');
    for (let x = 0, i = 0; x < w; x += P, i++) {
      const cx = x + P / 2;
      if (i % 2 === 0) { chain(c, cx, 38, cx, 74, '#2a322e', 1.3); cage(c, cx, 74); }
      else {
        chain(c, cx - 44, 40, cx - 44, 96 + r() * 20, '#232a27', 1.2);
        chain(c, cx + 30, 38, cx + 30, 84, '#232a27', 1.2);
        c.strokeStyle = '#2c3430'; c.lineWidth = 1.6; c.beginPath(); c.arc(cx + 33, 88, 4, Math.PI * 0.9, Math.PI * 2.2); c.stroke();
      }
    }
  }
  // ---- 中景（下水路）: 煉瓦の穹窿、天井の格子から差し込む光
  function r2VaultB(c, w, h) {
    const r = U.srand(2307), P = 208;
    c.fillStyle = '#101614';
    for (let x = 0; x < w; x += P) {
      c.beginPath(); c.moveTo(x, 0); c.lineTo(x + P, 0); c.lineTo(x + P, 110);
      c.quadraticCurveTo(x + P / 2, -34, x, 110); c.closePath(); c.fill();
    }
    c.strokeStyle = 'rgba(0,0,0,0.45)'; c.lineWidth = 1; c.beginPath();
    for (let y = 5, row = 0; y < 40; y += 6, row++) {
      c.moveTo(0, y); c.lineTo(w, y);
      for (let x = row % 2 ? 7 : 0; x < w; x += 14) { c.moveTo(x, y); c.lineTo(x, y + 6); }
    }
    c.stroke();
    c.strokeStyle = '#1d2724'; c.lineWidth = 6;
    for (let x = 0; x < w; x += P) { c.beginPath(); c.moveTo(x + 14, 114); c.quadraticCurveTo(x + P / 2, -26, x + P - 14, 114); c.stroke(); }
    for (const gx of [P * 0.5, P * 2.5, P * 3.5]) {
      // （HUD と紛れないよう、格子は天井の少し下に置く）
      const sg = c.createLinearGradient(0, 28, 0, h);
      sg.addColorStop(0, 'rgba(170,215,185,0.24)'); sg.addColorStop(1, 'rgba(170,215,185,0)');
      c.fillStyle = sg;
      c.beginPath(); c.moveTo(gx - 12, 28); c.lineTo(gx + 12, 28); c.lineTo(gx + 60, h); c.lineTo(gx + 4, h); c.closePath(); c.fill();
      c.fillStyle = '#080c0a'; c.fillRect(gx - 15, 23, 30, 6);
      c.fillStyle = '#4a6456'; for (let i = -11; i <= 9; i += 5) c.fillRect(gx + i, 24.5, 3, 3);
    }
    for (let x = 0; x <= w; x += P) pillar(c, x, 22, h, 26, '#151d1a', '#26312c', '#0b100e');
    c.strokeStyle = 'rgba(44,38,26,0.85)'; c.lineWidth = 1;
    for (let i = 0; i < 18; i++) {
      const x = r() * w, L = 10 + r() * 36;
      c.beginPath(); c.moveTo(x, 18); c.quadraticCurveTo(x + (r() - 0.5) * 10, 18 + L * 0.6, x + (r() - 0.5) * 6, 18 + L); c.stroke();
    }
  }
  function sconce(c, x, y) {
    // 煤けた壁
    const g = c.createRadialGradient(x, y - 26, 2, x, y - 26, 26);
    g.addColorStop(0, 'rgba(0,0,0,0.5)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g; c.fillRect(x - 26, y - 52, 52, 52);
    c.fillStyle = '#161816'; c.fillRect(x - 2, y + 6, 4, 14);
    c.fillStyle = '#2e302e'; c.beginPath(); c.moveTo(x - 7, y - 2); c.lineTo(x + 7, y - 2); c.lineTo(x + 3, y + 8); c.lineTo(x - 3, y + 8); c.closePath(); c.fill();
    c.fillStyle = '#3a2412'; c.fillRect(x - 2.5, y - 8, 5, 7);
  }
  function cellDoor(c, x, h, kind, r) {
    const w = 72, top = h - 90;
    c.fillStyle = '#1b221f';
    c.beginPath(); c.moveTo(x - 8, h); c.lineTo(x - 8, top + 22); c.quadraticCurveTo(x + w / 2, top - 18, x + w + 8, top + 22); c.lineTo(x + w + 8, h); c.closePath(); c.fill();
    c.strokeStyle = '#3a4641'; c.lineWidth = 1.5;
    c.beginPath(); c.moveTo(x - 8, top + 22); c.quadraticCurveTo(x + w / 2, top - 18, x + w + 8, top + 22); c.stroke();
    c.fillStyle = '#34403a';
    c.beginPath(); c.moveTo(x + w / 2 - 6, top - 3); c.lineTo(x + w / 2 + 6, top - 3); c.lineTo(x + w / 2 + 4, top + 9); c.lineTo(x + w / 2 - 4, top + 9); c.closePath(); c.fill();
    c.fillStyle = '#040605';
    c.beginPath(); c.moveTo(x, h); c.lineTo(x, top + 24); c.quadraticCurveTo(x + w / 2, top - 4, x + w, top + 24); c.lineTo(x + w, h); c.closePath(); c.fill();
    if (kind === 0) {
      // 奥で光る目
      c.fillStyle = 'rgba(210,220,160,0.6)';
      const ex = x + 16 + r() * 34, ey = top + 44 + r() * 18;
      c.fillRect(ex, ey, 2, 1.4); c.fillRect(ex + 6, ey, 2, 1.4);
      // 鉄格子
      c.strokeStyle = '#3c4340'; c.lineWidth = 3; c.beginPath();
      for (let bx = x + 6; bx < x + w - 2; bx += 10) { c.moveTo(bx, top + 14); c.lineTo(bx, h); }
      c.moveTo(x, top + 42); c.lineTo(x + w, top + 42); c.moveTo(x, h - 16); c.lineTo(x + w, h - 16);
      c.stroke();
      c.strokeStyle = 'rgba(150,160,150,0.35)'; c.lineWidth = 1; c.beginPath();
      for (let bx = x + 5; bx < x + w - 2; bx += 10) { c.moveTo(bx, top + 14); c.lineTo(bx, h); }
      c.stroke();
    } else {
      // 鋲打ちの木戸
      c.fillStyle = '#2a1e14';
      c.beginPath(); c.moveTo(x + 3, h); c.lineTo(x + 3, top + 26); c.quadraticCurveTo(x + w / 2, top + 1, x + w - 3, top + 26); c.lineTo(x + w - 3, h); c.closePath(); c.fill();
      c.strokeStyle = 'rgba(0,0,0,0.5)'; c.lineWidth = 1; c.beginPath();
      for (let px = x + 13; px < x + w - 4; px += 11) { c.moveTo(px, top + 12); c.lineTo(px, h); }
      c.stroke();
      c.fillStyle = '#383a38'; c.fillRect(x + 3, top + 34, w - 6, 5); c.fillRect(x + 3, h - 24, w - 6, 5);
      c.fillStyle = '#5c605c';
      for (let px = x + 8; px < x + w - 4; px += 9) { c.fillRect(px, top + 35.5, 2, 2); c.fillRect(px, h - 22.5, 2, 2); }
      c.fillStyle = '#050606'; c.fillRect(x + w / 2 - 10, top + 46, 20, 12);
      c.strokeStyle = '#4a4e4a'; c.lineWidth = 2; c.beginPath();
      for (let px = x + w / 2 - 5; px <= x + w / 2 + 5; px += 5) { c.moveTo(px, top + 46); c.lineTo(px, top + 58); }
      c.stroke();
      c.strokeStyle = '#555a55'; c.lineWidth = 1.5; c.beginPath(); c.arc(x + w - 14, h - 40, 4, 0, TAU); c.stroke();
    }
  }
  function skeleton(c, x, y) {
    const b = '#7e7a68', d = '#141816';
    c.fillStyle = '#2c302d'; c.fillRect(x - 17, y - 66, 6, 4); c.fillRect(x + 11, y - 66, 6, 4);
    chain(c, x - 14, y - 62, x - 12, y - 52, '#2c302d', 1, 0.7);
    chain(c, x + 14, y - 62, x + 12, y - 52, '#2c302d', 1, 0.7);
    c.strokeStyle = b; c.lineWidth = 2; c.lineCap = 'round';
    c.beginPath();
    c.moveTo(x - 12, y - 51); c.lineTo(x - 9, y - 40); c.lineTo(x - 6, y - 32);
    c.moveTo(x + 12, y - 51); c.lineTo(x + 9, y - 40); c.lineTo(x + 6, y - 32);
    c.moveTo(x, y - 32); c.lineTo(x + 1, y - 14);
    c.moveTo(x - 1, y - 14); c.lineTo(x - 10, y - 8); c.lineTo(x - 18, y - 2);
    c.moveTo(x + 2, y - 14); c.lineTo(x + 12, y - 9); c.lineTo(x + 14, y - 1);
    c.stroke();
    c.lineWidth = 1.2; c.beginPath();
    for (let i = 0; i < 3; i++) { c.moveTo(x - 6, y - 29 + i * 4); c.quadraticCurveTo(x, y - 26 + i * 4, x + 6, y - 29 + i * 4); }
    c.stroke();
    c.lineCap = 'butt';
    c.fillStyle = b; c.beginPath(); c.ellipse(x + 1, y - 39, 5, 5.5, 0.3, 0, TAU); c.fill();
    c.fillStyle = d; c.fillRect(x - 1, y - 40, 2, 2); c.fillRect(x + 3, y - 39, 2, 2); c.fillRect(x, y - 35, 4, 1);
  }
  function rack(c, x, y) {
    const wd = '#3a2616', dk = '#1c120a';
    c.fillStyle = dk; c.fillRect(x - 46, y - 30, 5, 30); c.fillRect(x + 41, y - 30, 5, 30);
    c.fillStyle = wd; c.fillRect(x - 50, y - 36, 100, 7);
    c.fillStyle = 'rgba(255,190,120,0.12)'; c.fillRect(x - 50, y - 36, 100, 1.5);
    c.fillStyle = dk; c.fillRect(x - 36, y - 26, 72, 4);
    for (const s of [-1, 1]) {
      const rx = x + s * 44;
      c.fillStyle = '#2a1a0e'; c.beginPath(); c.arc(rx, y - 40, 6, 0, TAU); c.fill();
      c.strokeStyle = wd; c.lineWidth = 2.5; c.beginPath();
      c.moveTo(rx - 9, y - 49); c.lineTo(rx + 9, y - 31); c.moveTo(rx + 9, y - 49); c.lineTo(rx - 9, y - 31); c.stroke();
    }
    c.strokeStyle = '#6a5a3a'; c.lineWidth = 1; c.beginPath();
    c.moveTo(x - 40, y - 40); c.lineTo(x - 14, y - 38); c.moveTo(x + 40, y - 40); c.lineTo(x + 14, y - 38); c.stroke();
  }
  function maiden(c, x, y) {
    const m = '#343a37', hi = '#4e5652', dk = '#1a1e1c';
    c.fillStyle = m;
    c.beginPath(); c.moveTo(x - 15, y); c.lineTo(x - 17, y - 56); c.quadraticCurveTo(x - 16, y - 78, x, y - 84); c.quadraticCurveTo(x + 16, y - 78, x + 17, y - 56); c.lineTo(x + 15, y); c.closePath(); c.fill();
    c.strokeStyle = dk; c.lineWidth = 1.2; c.stroke();
    c.beginPath(); c.moveTo(x, y - 72); c.lineTo(x, y); c.stroke();
    c.fillStyle = hi; c.fillRect(x - 15, y - 56, 2, 50);
    c.fillStyle = '#3e4541'; c.beginPath(); c.ellipse(x, y - 68, 7, 9, 0, 0, TAU); c.fill();
    c.fillStyle = dk; c.fillRect(x - 4, y - 70, 3, 1.5); c.fillRect(x + 1, y - 70, 3, 1.5); c.fillRect(x - 2, y - 63, 4, 1.2);
    c.fillRect(x - 16, y - 46, 32, 3); c.fillRect(x - 15, y - 20, 30, 3);
    c.fillStyle = '#6a726e';
    for (let i = -12; i <= 12; i += 6) { c.fillRect(x + i, y - 45.5, 1.6, 1.6); c.fillRect(x + i, y - 19.5, 1.6, 1.6); }
  }
  function wheelPost(c, x, y) {
    c.fillStyle = '#24180e'; c.fillRect(x - 3, y - 70, 6, 70);
    c.strokeStyle = '#3a2616'; c.lineWidth = 3.5; c.beginPath(); c.arc(x, y - 70, 20, 0, TAU); c.stroke();
    c.lineWidth = 2; c.beginPath();
    for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; c.moveTo(x, y - 70); c.lineTo(x + Math.cos(a) * 19, y - 70 + Math.sin(a) * 19); }
    c.stroke();
    c.fillStyle = '#1a1008'; c.beginPath(); c.arc(x, y - 70, 4, 0, TAU); c.fill();
  }
  function shackles(c, x, y) {
    c.fillStyle = '#202422'; c.fillRect(x - 12, y - 3, 5, 5); c.fillRect(x + 7, y - 3, 5, 5);
    chain(c, x - 10, y + 2, x - 6, y + 26, '#2e3431', 1, 0.7);
    chain(c, x + 10, y + 2, x + 5, y + 22, '#2e3431', 1, 0.7);
    c.strokeStyle = '#3a403d'; c.lineWidth = 1.6; c.beginPath();
    c.arc(x - 6, y + 30, 4, 0, TAU); c.moveTo(x + 9, y + 26); c.arc(x + 5, y + 26, 4, 0, TAU); c.stroke();
  }
  // ---- 近景（地下牢）: 牢の並ぶ石壁、拷問具
  function r2WallA(c, w, h) {
    const r = U.srand(2411);
    blocks(c, w, 0, h, r, { base: '#161c19', bh: 13, bw: 34, tints: ['#2a322e', '#2e3732', '#262e2a', '#313a35', '#29302c'] });
    for (let i = 0; i < 26; i++) streak(c, r() * w, 10, 2 + r() * 6, 20 + r() * 70, '8,12,10', 0.5);
    for (let i = 0; i < 40; i++) {
      c.fillStyle = `rgba(${50 + r() * 20 | 0},${72 + r() * 30 | 0},${40 + r() * 10 | 0},${(0.25 + r() * 0.25).toFixed(2)})`;
      c.beginPath(); c.ellipse(r() * w, h - 4 - r() * 14, 6 + r() * 14, 2 + r() * 4, 0, 0, TAU); c.fill();
    }
    c.fillStyle = '#121714'; c.fillRect(0, 0, w, 10);
    c.fillStyle = '#3c4843'; c.fillRect(0, 10, w, 2);
    c.fillStyle = 'rgba(0,0,0,0.4)'; c.fillRect(0, 12, w, 4);
    [60, 335, 610, 885].forEach((x, i) => cellDoor(c, x, h, i % 2, r));
    for (const x of TORCH_A) sconce(c, x, 40);
    skeleton(c, 290, h - 2);
    rack(c, 508, h - 2);
    maiden(c, 840, h - 2);
    wheelPost(c, 1020, h - 2);
    shackles(c, 170, 48); shackles(c, 742, 54);
  }
  function culvert(c, x, y) {
    c.fillStyle = '#2e3934'; c.beginPath(); c.arc(x, y, 27, 0, TAU); c.fill();
    c.strokeStyle = 'rgba(0,0,0,0.5)'; c.lineWidth = 1; c.beginPath();
    for (let i = 0; i < 12; i++) { const a = i * Math.PI / 6; c.moveTo(x + Math.cos(a) * 20, y + Math.sin(a) * 20); c.lineTo(x + Math.cos(a) * 27, y + Math.sin(a) * 27); }
    c.stroke();
    c.fillStyle = '#44524b'; c.beginPath(); c.arc(x, y, 27, Math.PI * 1.1, Math.PI * 1.6); c.arc(x, y, 24, Math.PI * 1.6, Math.PI * 1.1, true); c.fill();
    const g = c.createRadialGradient(x, y - 3, 2, x, y, 20);
    g.addColorStop(0, '#000'); g.addColorStop(1, '#0b1311');
    c.fillStyle = g; c.beginPath(); c.arc(x, y, 20, 0, TAU); c.fill();
    c.fillStyle = 'rgba(80,110,60,0.6)'; c.beginPath(); c.ellipse(x, y + 18, 14, 3, 0, 0, Math.PI); c.fill();
    streak(c, x - 13, y + 20, 26, 22, '70,100,60', 0.55);
  }
  function grate(c, x, y) {
    c.fillStyle = '#060908'; c.fillRect(x - 14, y - 9, 28, 18);
    c.strokeStyle = '#4a3a2c'; c.lineWidth = 2; c.beginPath();
    for (let i = -9; i <= 9; i += 6) { c.moveTo(x + i, y - 9); c.lineTo(x + i, y + 9); }
    c.moveTo(x - 14, y); c.lineTo(x + 14, y); c.stroke();
    c.strokeStyle = '#2a3430'; c.strokeRect(x - 15, y - 10, 30, 20);
    streak(c, x - 8, y + 10, 16, 30, '90,60,30', 0.35);
  }
  // ---- 近景（下水路）: 煉瓦の壁、排水口、鉄梯子
  function r2WallB(c, w, h) {
    const r = U.srand(2477);
    blocks(c, w, 0, h, r, { base: '#0f1513', bh: 7, bw: 20, tints: ['#1f2926', '#232e2a', '#1b2421', '#26312c', '#202a26'] });
    c.fillStyle = '#141b18'; c.fillRect(0, 0, w, 7); c.fillStyle = '#34403a'; c.fillRect(0, 7, w, 1.5);
    for (let i = 0; i < 30; i++) streak(c, r() * w, 8 + r() * 20, 2 + r() * 5, 14 + r() * 60, '70,90,40', 0.45);
    const wg = c.createLinearGradient(0, h - 26, 0, h);
    wg.addColorStop(0, 'rgba(30,50,34,0)'); wg.addColorStop(1, 'rgba(30,50,34,0.8)');
    c.fillStyle = wg; c.fillRect(0, h - 26, w, 26);
    for (const px of PIPES_B) culvert(c, px, PIPE_Y);
    c.strokeStyle = '#3a2e26'; c.lineWidth = 2.2; c.beginPath();
    c.moveTo(560, 8); c.lineTo(560, h); c.moveTo(580, 8); c.lineTo(580, h);
    for (let y = 16; y < h; y += 11) { c.moveTo(560, y); c.lineTo(580, y); }
    c.stroke();
    grate(c, 900, 34);
    for (const x of TORCH_B) sconce(c, x, 34);
  }
  function r2Ripple(c, w, h) {
    const r = U.srand(2701);
    for (let i = 0; i < 30; i++) {
      c.fillStyle = `rgba(130,180,160,${(0.12 + r() * 0.22).toFixed(2)})`;
      c.fillRect(r() * (w - 30), 2 + r() * (h - 4), 6 + r() * 22, 1);
    }
  }
  function drain(c, x, y, s) {
    c.fillStyle = '#070908'; c.fillRect(x - 14 * s, y - 4 * s, 28 * s, 8 * s);
    c.fillStyle = '#39413d'; for (let i = -12; i <= 10; i += 5) c.fillRect(x + i * s, y - 4 * s, 2 * s, 8 * s);
    c.strokeStyle = '#1a1e1c'; c.lineWidth = 1; c.strokeRect(x - 14 * s, y - 4 * s, 28 * s, 8 * s);
  }
  // ---- 床（地下牢）: 敷石、藁、黒ずんだ染み、排水格子
  function r2FloorA(c, w, h) {
    const r = U.srand(2503);
    flagRows(c, w, h, r, { far: '#121815', near: '#28312c', rh0: 8, aspect: 3.4, line: 'rgba(0,0,0,0.55)', tint: '150,170,160' });
    for (let i = 0; i < 14; i++) {
      const cx = 20 + r() * (w - 40), cy = 10 + r() * (h - 20), n = 10 + r() * 14, sc = 0.6 + cy / h;
      c.lineWidth = 1;
      for (let k = 0; k < n; k++) {
        c.strokeStyle = r() < 0.5 ? 'rgba(122,102,52,0.7)' : 'rgba(82,70,36,0.7)';
        const x = cx + (r() - 0.5) * 30 * sc, y = cy + (r() - 0.5) * 6 * sc, a = (r() - 0.5) * 0.8, L = (4 + r() * 6) * sc;
        c.beginPath(); c.moveTo(x, y); c.lineTo(x + Math.cos(a) * L, y + Math.sin(a) * L); c.stroke();
      }
    }
    for (let i = 0; i < 7; i++) {
      const y = 20 + r() * (h - 30), sc = 0.6 + y / h;
      c.fillStyle = `rgba(30,10,8,${(0.2 + r() * 0.2).toFixed(2)})`;
      c.beginPath(); c.ellipse(30 + r() * (w - 60), y, (8 + r() * 16) * sc, (2 + r() * 4) * sc, 0, 0, TAU); c.fill();
    }
    c.strokeStyle = 'rgba(0,0,0,0.5)'; c.lineWidth = 1;
    for (let i = 0; i < 10; i++) {
      let x = r() * w, y = r() * h; c.beginPath(); c.moveTo(x, y);
      for (let k = 0; k < 4; k++) { x += (r() - 0.3) * 14; y += (r() - 0.5) * 5; c.lineTo(x, y); }
      c.stroke();
    }
    drain(c, w * 0.28, 52, 1); drain(c, w * 0.76, 116, 1.5);
    topShade(c, w, 42, 0.6);
  }
  // ---- 床（下水路）: 濡れた石の歩廊と水たまり
  function r2FloorB(c, w, h) {
    const r = U.srand(2601);
    flagRows(c, w, h, r, { far: '#101614', near: '#212a26', rh0: 10, aspect: 2.6, line: 'rgba(0,0,0,0.6)', tint: '120,160,150' });
    for (let i = 0; i < 30; i++) {
      c.fillStyle = `rgba(60,86,50,${(0.15 + r() * 0.2).toFixed(2)})`;
      c.beginPath(); c.ellipse(r() * w, 6 + r() * 16, 8 + r() * 20, 1.5 + r() * 2, 0, 0, TAU); c.fill();
    }
    for (let i = 0; i < 9; i++) {
      const y = 24 + r() * (h - 44), sc = 0.5 + y / h, x = 40 + r() * (w - 80), rx = (18 + r() * 30) * sc, ry = (3 + r() * 4) * sc;
      c.fillStyle = 'rgba(12,22,20,0.85)'; c.beginPath(); c.ellipse(x, y, rx, ry, 0, 0, TAU); c.fill();
      c.strokeStyle = 'rgba(150,200,180,0.28)'; c.lineWidth = 1; c.beginPath(); c.ellipse(x, y, rx, ry, 0, Math.PI * 1.05, Math.PI * 1.7); c.stroke();
      c.fillStyle = 'rgba(170,215,195,0.2)'; c.fillRect(x - rx * 0.4, y - ry * 0.2, rx * 0.5, 1);
    }
    topShade(c, w, 30, 0.45);
    // 奥の水路との縁石
    c.fillStyle = '#34413b'; c.fillRect(0, 0, w, 4); c.fillStyle = '#5a6861'; c.fillRect(0, 0, w, 1.2);
    c.fillStyle = 'rgba(0,0,0,0.5)'; c.fillRect(0, 4, w, 3);
  }
  // ---- 継ぎ目: 下水路への大門（近景）・巨柱（中景）・敷居（床）
  function r2Gate(c, w, h) {
    const cx = w / 2;
    const g = c.createLinearGradient(0, 30, 0, h);
    g.addColorStop(0, '#000'); g.addColorStop(1, '#0c1513');
    c.fillStyle = g; c.fillRect(cx - 62, 20, 124, h - 20);
    c.strokeStyle = 'rgba(90,125,110,0.28)'; c.lineWidth = 1; c.beginPath();
    for (let i = 0; i < 8; i++) { const y = h - 6 - i * 9, ww = 58 - i * 4.5; c.moveTo(cx - ww, y); c.lineTo(cx + ww, y); }
    c.stroke();
    // 持ち上げられた落とし格子
    c.strokeStyle = '#2e3431'; c.lineWidth = 3; c.beginPath();
    for (let x = cx - 54; x <= cx + 54; x += 12) { c.moveTo(x, 20); c.lineTo(x, 64); }
    for (let y = 30; y <= 58; y += 12) { c.moveTo(cx - 60, y); c.lineTo(cx + 60, y); }
    c.stroke();
    c.fillStyle = '#2e3431';
    for (let x = cx - 54; x <= cx + 54; x += 12) { c.beginPath(); c.moveTo(x - 2.5, 64); c.lineTo(x + 2.5, 64); c.lineTo(x, 72); c.closePath(); c.fill(); }
    // 石の柱とアーチ
    const r = U.srand(2801);
    for (const x0 of [0, w - 40]) {
      c.fillStyle = '#28302c'; c.fillRect(x0, 0, 40, h);
      for (let y = 0; y < h; y += 18) {
        c.fillStyle = r() < 0.5 ? '#2e3833' : '#252d29'; c.fillRect(x0 + 2, y + 2, 36, 15);
        c.fillStyle = 'rgba(255,255,255,0.05)'; c.fillRect(x0 + 2, y + 2, 36, 1);
      }
      c.fillStyle = 'rgba(0,0,0,0.35)'; c.fillRect(x0 + (x0 ? 0 : 34), 0, 6, h);
    }
    c.fillStyle = '#2a332f';
    c.beginPath(); c.moveTo(0, 0); c.lineTo(w, 0); c.lineTo(w, 72); c.lineTo(w - 40, 72);
    c.quadraticCurveTo(cx, -8, 40, 72); c.lineTo(0, 72); c.closePath(); c.fill();
    c.save(); c.clip();
    for (let y = 6; y < 72; y += 13) { c.fillStyle = 'rgba(0,0,0,0.3)'; c.fillRect(0, y, w, 1.2); c.fillStyle = 'rgba(255,255,255,0.04)'; c.fillRect(0, y + 1.2, w, 1); }
    c.restore();
    c.strokeStyle = 'rgba(0,0,0,0.45)'; c.lineWidth = 1.2; c.beginPath();
    for (let i = 0; i <= 10; i++) {
      const k = i / 10, bx = (1 - k) * (1 - k) * 40 + 2 * (1 - k) * k * cx + k * k * (w - 40), by = (1 - k) * (1 - k) * 72 + 2 * (1 - k) * k * -8 + k * k * 72;
      c.moveTo(bx, by); c.lineTo(bx + (bx - cx) * 0.25, by - 18);
    }
    c.stroke();
    c.strokeStyle = '#46534d'; c.lineWidth = 2; c.beginPath(); c.moveTo(40, 72); c.quadraticCurveTo(cx, -8, w - 40, 72); c.stroke();
    c.fillStyle = '#3a4640'; c.beginPath(); c.moveTo(cx - 9, 22); c.lineTo(cx + 9, 22); c.lineTo(cx + 6, 40); c.lineTo(cx - 6, 40); c.closePath(); c.fill();
    // 門柱の苔と松明の金具
    for (let i = 0; i < 12; i++) { c.fillStyle = 'rgba(56,84,44,0.4)'; c.beginPath(); c.ellipse(r() < 0.5 ? 20 : w - 20, h - r() * 40, 10, 3, 0, 0, TAU); c.fill(); }
    sconce(c, 20, 104); sconce(c, w - 20, 104);
  }
  function r2PillarS(c, w, h) {
    pillar(c, w / 2, 0, h, 50, '#141c19', '#25302b', '#0a0e0d');
    c.fillStyle = 'rgba(0,0,0,0.3)'; c.fillRect(0, 0, 8, h); c.fillRect(w - 8, 0, 8, h);
  }
  function r2Thresh(c, w, h) {
    const g = c.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#1c2420'); g.addColorStop(1, '#3a4640');
    c.fillStyle = g;
    c.beginPath(); c.moveTo(22, 0); c.lineTo(w - 22, 0); c.lineTo(w, h); c.lineTo(0, h); c.closePath(); c.fill();
    c.strokeStyle = 'rgba(0,0,0,0.55)'; c.lineWidth = 1.2; c.beginPath();
    let y = 0, rh = 9;
    while (y < h) { const k = y / h; c.moveTo(22 * (1 - k), y); c.lineTo(w - 22 * (1 - k), y); y += rh; rh *= 1.16; }
    c.moveTo(22, 0); c.lineTo(0, h); c.moveTo(w - 22, 0); c.lineTo(w, h);
    c.stroke();
    c.fillStyle = '#0a1210';
    c.beginPath(); c.moveTo(w / 2 - 4, 0); c.lineTo(w / 2 + 4, 0); c.lineTo(w / 2 + 11, h); c.lineTo(w / 2 - 11, h); c.closePath(); c.fill();
    c.fillStyle = 'rgba(140,190,170,0.25)'; c.fillRect(w / 2 - 1, 0, 1.5, h);
    topShade(c, w, 30, 0.5);
  }
  // ---- 動く装飾
  function waterfall(c, x, y0, y1, t) {
    c.fillStyle = 'rgba(110,150,130,0.5)';
    c.beginPath(); c.moveTo(x - 9, y0); c.lineTo(x + 9, y0);
    c.quadraticCurveTo(x + 12, (y0 + y1) / 2, x + 8, y1); c.lineTo(x - 8, y1);
    c.quadraticCurveTo(x - 11, (y0 + y1) / 2, x - 9, y0); c.fill();
    c.fillStyle = 'rgba(205,235,220,0.6)';
    for (let k = 0; k < 4; k++) { const yy = y0 + ((t * 2.2 + k * 7) % (y1 - y0 - 4)); c.fillRect(x - 6 + k * 3.5, yy, 1.2, 5); }
    c.fillStyle = 'rgba(200,228,216,0.5)';
    for (let k = 0; k < 5; k++) { const a = t * 0.2 + k * 1.3; c.beginPath(); c.ellipse(x + Math.sin(a) * 11, y1 + 1 + Math.cos(a * 1.3) * 1.5, 3 + (k % 2) * 2, 1.4, 0, 0, TAU); c.fill(); }
  }
  function drawDrips(c, list, t) {
    const cam = BK.cam.x, W = BK.W;
    c.strokeStyle = 'rgba(175,220,205,0.75)'; c.lineWidth = 1.2;
    c.beginPath();
    for (const d of list) {
      const sx = d.x - cam;
      if (sx < -10 || sx > W + 10) continue;
      const ph = (t + d.o) % d.p;
      if (ph < 30) { const k = ph / 30, y = d.y0 + (d.ly - d.y0) * k * k; c.moveTo(sx, y - 7); c.lineTo(sx, y); }
    }
    c.stroke();
    c.strokeStyle = 'rgba(175,220,205,0.5)'; c.lineWidth = 1;
    c.beginPath();
    for (const d of list) {
      const sx = d.x - cam;
      if (sx < -20 || sx > W + 20) continue;
      const ph = (t + d.o) % d.p;
      if (ph >= 30 && ph < 44) {
        const k = (ph - 30) / 14, rx = 2 + k * 8;
        c.moveTo(sx + rx, d.ly); c.ellipse(sx, d.ly, rx, rx * 0.3, 0, 0, TAU);
        if (k < 0.5) { c.moveTo(sx - 2, d.ly - 2 - k * 10); c.lineTo(sx - 2, d.ly - 4 - k * 10); c.moveTo(sx + 3, d.ly - 3 - k * 8); c.lineTo(sx + 3, d.ly - 5 - k * 8); }
      }
    }
    c.stroke();
  }
  function r2Layers() {
    return {
      far: BG.layer('s2far', 900, 206, r2Far),
      vaultA: BG.layer('s2vaultA', 1040, 206, r2VaultA), vaultB: BG.layer('s2vaultB', 1040, 206, r2VaultB),
      wallA: BG.layer('s2wallA', 1100, 110, r2WallA), wallB: BG.layer('s2wallB', 1100, 100, r2WallB),
      floorA: BG.layer('s2floorA', 1024, BK.H - FLOOR_Y, r2FloorA), floorB: BG.layer('s2floorB', 1024, BK.H - FLOOR_Y, r2FloorB),
      ripple: BG.layer('s2ripple', 320, 16, r2Ripple),
      gate: BG.layer('s2gate', 200, 206, r2Gate), pillarS: BG.layer('s2pillarS', 72, 206, r2PillarS), thresh: BG.layer('s2thresh', 90, BK.H - FLOOR_Y, r2Thresh),
    };
  }

  BK.stages[1] = {
    id: 2, name: '伯爵の地下牢', sub: '地下牢と下水路', len: 3800,
    bgm: 'stage2', bossBgm: 'boss', heal: 0.35,
    intro: '異端狩りの名のもと、囚われた者たちの呻きが響く。\n伯爵の城の地下深く──血と汚水の底へ、剣士は降りる。',
    props: [
      { x: 300, y: 28, type: 'barrel' }, { x: 350, y: 98, type: 'crate', item: 'meat' },
      { x: 900, y: 22, type: 'urn', item: 'silver' }, { x: 950, y: 64, type: 'urn' },
      { x: 1250, y: 100, type: 'barrel', item: 'firepot' },
      { x: 1700, y: 40, type: 'crate', item: 'wine' }, { x: 1750, y: 92, type: 'barrel', item: 'knives' },
      { x: 2350, y: 30, type: 'barrel', item: 'bowgun' }, { x: 2620, y: 100, type: 'crate', item: 'gold' },
      // 伯爵の手前（ボス戦の画面内に入る位置）
      { x: 3160, y: 24, type: 'barrel', item: 'roast' }, { x: 3210, y: 102, type: 'crate', item: 'wine' },
    ],
    events: [
      { at: 150, waves: [
        [{ t: 'soldier', palette: 'jailer', side: 'R', y: 40 }, { t: 'undead', side: 'R', y: 92, off: 40 }, { t: 'undead', side: 'L', y: 60, delay: 30 }],
        [{ t: 'undead', x: 380, y: 80, entry: 'rise', screen: true }, { t: 'undead', x: 480, y: 30, entry: 'rise', screen: true, delay: 20, palette: 'bone' }, { t: 'spirit', side: 'R', y: 50, delay: 40 }]] },
      { at: 720, waves: [
        [{ t: 'soldier', palette: 'jailer', side: 'R', y: 30 }, { t: 'soldier', palette: 'jailer', side: 'R', y: 95, off: 40 }, { t: 'hound', side: 'L', y: 60, delay: 40 }],
        [{ t: 'spirit', side: 'R', y: 30 }, { t: 'spirit', side: 'L', y: 90, delay: 25 }, { t: 'undead', x: 300, y: 60, entry: 'rise', screen: true, palette: 'blood' }],
        [{ t: 'hound', side: 'R', y: 40 }, { t: 'hound', side: 'R', y: 90, delay: 30 }, { t: 'soldier', palette: 'jailer', side: 'L', y: 60, delay: 50 }]], next: 1 },
      { at: 1320, waves: [
        [{ t: 'troll', side: 'R', y: 60 }, { t: 'undead', side: 'L', y: 30, delay: 40 }],
        [{ t: 'soldier', palette: 'jailer', side: 'R', y: 30 }, { t: 'undead', side: 'R', y: 100, palette: 'bone', off: 30 }, { t: 'spirit', side: 'L', y: 60, delay: 40 }]], next: 1 },
      { at: 2150, waves: [
        [{ t: 'hound', side: 'R', y: 30 }, { t: 'hound', side: 'L', y: 90, delay: 20 }, { t: 'hound', side: 'R', y: 70, delay: 50 }],
        [{ t: 'spirit', side: 'R', y: 40 }, { t: 'spirit', side: 'R', y: 90, delay: 20 }, { t: 'undead', x: 420, y: 60, entry: 'rise', screen: true, palette: 'blood' }, { t: 'undead', x: 200, y: 100, entry: 'rise', screen: true, delay: 30 }],
        [{ t: 'soldier', palette: 'jailer', side: 'L', y: 40 }, { t: 'soldier', palette: 'jailer', side: 'R', y: 80 }, { t: 'spirit', side: 'R', y: 60, delay: 60 }]], next: 1 },
      { at: 2700, waves: [
        [{ t: 'troll', side: 'R', y: 40 }, { t: 'undead', side: 'L', y: 90 }, { t: 'undead', side: 'R', y: 100, off: 60, palette: 'bone' }],
        [{ t: 'troll', side: 'L', y: 80 }, { t: 'soldier', palette: 'jailer', side: 'R', y: 30 }, { t: 'hound', side: 'R', y: 60, delay: 40 }, { t: 'hound', side: 'L', y: 20, delay: 60 }]] },
      // 伯爵は天井から落ちてくる（onSpawn 側で処理）
      { at: 3100, boss: 'count', x: 480, y: 60, entry: 'drop', waves: [] },
    ],
    init(g) {
      // 天井からの雫（下水路ほど多い）
      const r = U.srand(2999), d = [];
      for (let x = 60; x < 3800;) {
        d.push({ x, p: 110 + Math.floor(r() * 110), o: Math.floor(r() * 300), y0: 12 + r() * 30, ly: FT + 4 + r() * (BK.DEPTH - 8) });
        x += (x > CX2 + 300 ? 70 : 210) + r() * 110;
      }
      g.s2 = { drips: d };
      r2Layers(); gl('warm');
    },
    drawBg(c, g) {
      const t = g.time, W = BK.W, L = r2Layers();
      if (!g.s2) this.init(g);
      BG.tile(c, L.far, 0.15, 0);
      // 中景の穹窿（継ぎ目は巨柱で隠す）
      const sm = seamX(CX2, 0.4);
      dualTile(c, sm, L.vaultA, 0, L.vaultB, 0, 0.4);
      if (sm > -40 && sm < W + 40) spr(c, L.pillarS, sm - 36, 0);
      // 近景の壁
      const sw = seamX(CX2, 0.75);
      dualTile(c, sw, L.wallA, W2Y, L.wallB, S2Y, 0.75);
      if (sw < W) {
        // 奥の水路と排水口から落ちる水
        const x0 = Math.max(0, sw);
        c.fillStyle = '#0d1a16'; c.fillRect(x0, CH_T, W - x0, CH_B - CH_T);
        clipRect(c, x0, CH_T, W, CH_B); BG.tile(c, L.ripple, 1, CH_T, t * 0.9); c.restore();
        for (let tx = tile0(0.75, 1100); tx < W; tx += 1100) {
          for (const px of PIPES_B) { const sx = tx + px; if (sx > sw + 10 && sx < W + 20) waterfall(c, sx, S2Y + PIPE_Y + 17, CH_T + 7, t + px); }
        }
      }
      // 壁の松明
      for (let tx = tile0(0.75, 1100); tx < W; tx += 1100) {
        for (const lx of TORCH_A) { const sx = tx + lx; if (sx < sw - 8 && sx > -100 && sx < W + 100) torch(c, sx, W2Y + 32, t, lx, true); }
        for (const lx of TORCH_B) { const sx = tx + lx; if (sx > sw + 8 && sx > -100 && sx < W + 100) torch(c, sx, S2Y + 26, t, lx, true); }
      }
      // 下水路への大門
      if (sw > -110 && sw < W + 110) {
        spr(c, L.gate, sw - 100, 0);
        torch(c, sw - 80, 96, t, 3, false); torch(c, sw + 80, 96, t, 7, false);
      }
      // 床
      const sf = seamX(CX2, 1);
      dualTile(c, sf, L.floorA, FLOOR_Y, L.floorB, FLOOR_Y, 1);
      if (sf > -50 && sf < W + 50) spr(c, L.thresh, sf - 45, FLOOR_Y);
      drawDrips(c, g.s2.drips, t);
    },
    drawFg(c, g) {
      const t = g.time, W = BK.W, H = BK.H, cam = BK.cam.x;
      // 下水路: 手前の水路
      const sf = seamX(CX2, 1) + 40;
      if (sf < W) {
        const x0 = Math.max(0, sf), rip = BG.layer('s2ripple', 320, 16, r2Ripple);
        c.fillStyle = '#26302c'; c.fillRect(x0, 333, W - x0, 7);
        c.fillStyle = '#4c5a53'; c.fillRect(x0, 333, W - x0, 1.5);
        c.fillStyle = '#0b1613'; c.fillRect(x0, 340, W - x0, H - 340);
        clipRect(c, x0, 340, W, H);
        BG.tile(c, rip, 1.15, 341, t * 1.1); BG.tile(c, rip, 1.15, 348, t * 1.1 + 150);
        c.restore();
        // 手前の天井のアーチ（枠取り）
        c.strokeStyle = '#040605'; c.lineWidth = 16;
        for (let px = 2600; px < 4600 * 1.2; px += 720) {
          const sx = px - cam * 1.2;
          if (sx < x0 - 200 || sx > W + 200) continue;
          c.beginPath(); c.moveTo(sx - 190, -4); c.quadraticCurveTo(sx, 60, sx + 190, -4); c.stroke();
        }
      }
      // 地下牢: 手前に吊られた鎖
      for (let px = 380; px < 2350; px += 610) {
        const sx = px - cam * 1.3;
        if (sx < -40 || sx > W + 40) continue;
        const Lc = 72 + (px % 3) * 16, a = Math.sin(t * 0.025 + px) * 0.07;
        const ex = sx + Math.sin(a) * Lc, ey = Math.cos(a) * Lc - 6;
        chain(c, sx, -6, ex, ey, '#070908', 2.2, 1.8);
        c.strokeStyle = '#070908'; c.lineWidth = 3; c.beginPath(); c.arc(ex, ey + 8, 7, -Math.PI * 0.5, Math.PI * 0.9); c.stroke();
      }
      BG.fog(c, t, '#40524a', 0.1, H - 64);
      BG.vignette(c, 0.62);
    },
  };

  // =====================================================================
  //  ROUND 3 疾駆 ── 戦馬車の荷台で戦う強制スクロール面
  //   荷台（床）は画面に固定し、空・森・路面を時間で高速スクロールさせて疾走感を出す。
  //   ステージ幅 = 画面幅 なのでカメラは動かない（どの縦横比でも荷台全体と馬が見える）。
  //   敵は後方・両側の手すり・馬の背から飛び乗り、枝の上から降ってくる。
  // =====================================================================
  const S3V = { cloud: 0.22, hill: 0.6, canopy: 2.4, trunk: 7.2, verge: 12.5, road: 16.5 };
  const DECK_Y = 148;               // 荷台レイヤーの上端（画面 y）
  const s3Front = () => BK.W - 100; // 前板の x（ここから先は馬）
  const s3Wheels = () => [Math.round(BK.W * 0.2), Math.round(BK.W * 0.6)];
  const WHEEL_Y = 374, WHEEL_R = 42;
  const LEAF = ['#7a3a14', '#9a5a1c', '#5a2a10'];
  const HORSE_FAR = { body: '#2a1a13', dark: '#170e0a', hair: '#110906', rim: '#7e3c22', strap: '#0c0604', metal: '#8a7a60' };
  const HORSE_NEAR = { body: '#3c2518', dark: '#24150d', hair: '#170d08', rim: '#b0582e', strap: '#120a05', metal: '#a89a78' };

  function s3State(g) {
    if (!g.s3) g.s3 = { p: 0, bumpT: 0, nextBump: 220, branches: [], nextBranch: 160, trunk: -999, nextTrunk: 360, sparks: [], wing: -1, whipT: 0, nextWhip: 150 };
    return g.s3;
  }
  // ---- 雲（夕陽に照らされた下縁）
  function s3Clouds(c, w, h) {
    const r = U.srand(3001);
    for (let i = 0; i < 10; i++) {
      const x = r() * w, y = 8 + r() * 46, L = 90 + r() * 170, th = 4 + r() * 6;
      for (const ox of [-w, 0, w]) {
        c.fillStyle = 'rgba(58,30,52,0.75)';
        c.beginPath(); c.ellipse(x + ox, y, L / 2, th, 0, 0, TAU); c.fill();
        c.fillStyle = 'rgba(236,128,76,0.45)';
        c.beginPath(); c.ellipse(x + ox + 6, y + th * 0.6, L / 2 - 12, th * 0.4, 0, 0, TAU); c.fill();
      }
    }
  }
  // ---- 遠い丘と見張り塔
  function s3Hills(c, w, h) {
    c.fillStyle = '#3c1d33';
    c.beginPath(); c.moveTo(0, h);
    for (let x = 0; x <= w; x += 8) c.lineTo(x, 34 + Math.sin(x / w * TAU * 2) * 11 + Math.sin(x / w * TAU * 5 + 1) * 5 - (x % 16 ? 0 : 2));
    c.lineTo(w, h); c.closePath(); c.fill();
    const tx = w * 0.62, ty = 34 + Math.sin(0.62 * TAU * 2) * 11 + Math.sin(0.62 * TAU * 5 + 1) * 5;
    c.fillRect(tx - 5, ty - 26, 10, 28);
    c.beginPath(); c.moveTo(tx - 7, ty - 26); c.lineTo(tx, ty - 36); c.lineTo(tx + 7, ty - 26); c.fill();
    c.fillStyle = '#ffb060'; c.fillRect(tx - 1, ty - 20, 2, 3);
    c.fillStyle = '#301628';
    c.beginPath(); c.moveTo(0, h);
    for (let x = 0; x <= w; x += 10) c.lineTo(x, 52 + Math.sin(x / w * TAU * 3 + 2) * 7);
    c.lineTo(w, h); c.closePath(); c.fill();
  }
  // ---- 森の稜線（針葉樹と広葉樹）
  function s3Canopy(c, w, h) {
    const r = U.srand(3021), trees = [];
    for (let x = 0; x < w;) { trees.push([x, 26 + r() * 40, r() < 0.55, 16 + r() * 22]); x += 14 + r() * 22; }
    c.fillStyle = '#1b0c13';
    c.fillRect(0, 80, w, h - 80);
    for (const [x0, top, pine, rad] of trees) {
      for (const ox of [-w, 0, w]) {
        const x = x0 + ox;
        if (x < -40 || x > w + 40) continue;
        if (pine) {
          c.beginPath(); c.moveTo(x - rad * 0.7, h); c.lineTo(x - rad * 0.7, top + rad * 1.7);
          for (let k = 3; k >= 1; k--) { c.lineTo(x - rad * 0.2 * k - 2, top + rad * 0.5 * k); c.lineTo(x - rad * 0.1 * k, top + rad * 0.5 * k + 2); }
          c.lineTo(x, top);
          for (let k = 1; k <= 3; k++) { c.lineTo(x + rad * 0.1 * k, top + rad * 0.5 * k + 2); c.lineTo(x + rad * 0.2 * k + 2, top + rad * 0.5 * k); }
          c.lineTo(x + rad * 0.7, top + rad * 1.7); c.lineTo(x + rad * 0.7, h); c.fill();
        } else {
          c.beginPath(); c.arc(x, top + rad, rad * 0.85, 0, TAU); c.fill();
          c.beginPath(); c.arc(x - rad * 0.7, top + rad * 1.35, rad * 0.7, 0, TAU); c.fill();
          c.beginPath(); c.arc(x + rad * 0.65, top + rad * 1.25, rad * 0.75, 0, TAU); c.fill();
          c.fillRect(x - rad * 1.2, top + rad * 1.4, rad * 2.4, h);
        }
      }
    }
    // 稜線のリムライト（左の夕陽）
    c.strokeStyle = 'rgba(150,62,34,0.7)'; c.lineWidth = 1.5;
    for (const [x0, top, pine, rad] of trees) {
      for (const ox of [-w, 0, w]) {
        const x = x0 + ox;
        if (x < -40 || x > w + 40) continue;
        c.beginPath();
        if (pine) continue;
        else { c.arc(x, top + rad, rad * 0.85, Math.PI * 1.05, Math.PI * 1.45); c.moveTo(x - rad * 1.4, top + rad * 1.35); c.arc(x - rad * 0.7, top + rad * 1.35, rad * 0.7, Math.PI, Math.PI * 1.4); }
        c.stroke();
      }
    }
  }
  // ---- 近くの木々（速く流れる幹）
  function s3Trunks(c, w, h) {
    const r = U.srand(3037);
    const list = [];
    for (let x = 40; x < w - 20;) { list.push([x, 12 + r() * 22, r()]); x += 150 + r() * 200; }
    for (const [x0, tw, v] of list) {
      for (const ox of [-w, 0, w]) {
        const x = x0 + ox;
        if (x < -80 || x > w + 80) continue;
        c.fillStyle = '#120a0c';
        c.beginPath(); c.moveTo(x - tw * 0.4, 0); c.lineTo(x + tw * 0.4, 0); c.lineTo(x + tw * 0.55, h - 8); c.lineTo(x + tw, h); c.lineTo(x - tw, h); c.lineTo(x - tw * 0.55, h - 8); c.closePath(); c.fill();
        c.fillStyle = 'rgba(130,52,28,0.55)'; c.fillRect(x - tw * 0.45, 0, 2, h - 10);
        c.fillStyle = 'rgba(0,0,0,0.35)'; for (let k = 0; k < 5; k++) c.fillRect(x - tw * 0.2 + k * tw * 0.12, (k * 37 + v * 50) % h, 1.5, 30 + k * 6);
        if (v < 0.6) {
          c.strokeStyle = '#120a0c'; c.lineWidth = 5; c.lineCap = 'round';
          const by = 30 + v * 60, s = v < 0.3 ? -1 : 1;
          c.beginPath(); c.moveTo(x, by); c.quadraticCurveTo(x + s * 30, by - 20, x + s * 70, by - 44); c.stroke();
          c.lineWidth = 2.5; c.beginPath(); c.moveTo(x + s * 40, by - 26); c.lineTo(x + s * 56, by - 12); c.stroke();
          c.lineCap = 'butt';
          c.fillStyle = '#1a0e0c';
          for (let k = 0; k < 6; k++) { c.beginPath(); c.ellipse(x + s * (50 + k * 6), by - 50 + (k % 3) * 8, 12, 7, 0, 0, TAU); c.fill(); }
        }
      }
    }
    c.fillStyle = '#140b0c';
    for (let x = 0; x < w; x += 26) { c.beginPath(); c.ellipse(x + (x * 7) % 13, h - 4, 18, 8, 0, Math.PI, 0); c.fill(); }
  }
  // ---- 路肩（手すりの向こう側）
  function s3Verge(c, w, h) {
    const r = U.srand(3041);
    c.fillStyle = '#4c3424'; c.fillRect(0, 12, w, h - 12);
    c.fillStyle = '#1e1a0e';
    for (let x = 0; x < w; x += 6) { const hh = 8 + r() * 10; c.fillRect(x, 16 - hh, 4, hh); }
    c.fillRect(0, 10, w, 6);
    for (let i = 0; i < 40; i++) {
      c.fillStyle = r() < 0.5 ? 'rgba(120,88,60,0.6)' : 'rgba(30,18,10,0.6)';
      c.fillRect(r() * (w - 60), 17 + r() * (h - 19), 20 + r() * 60, 1.2);
    }
  }
  // ---- 路面（荷台の下・馬の足元）: 流れる轍と小石
  function s3Road(c, w, h) {
    const r = U.srand(3053);
    const g = c.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#40291c'); g.addColorStop(1, '#5c4230');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
    c.fillStyle = 'rgba(20,10,6,0.55)'; c.fillRect(0, 60, w, 3); c.fillRect(0, 128, w, 4);
    for (let i = 0; i < 90; i++) {
      const y = r() * h;
      c.fillStyle = r() < 0.5 ? `rgba(130,100,70,${(0.3 + r() * 0.3).toFixed(2)})` : 'rgba(24,14,8,0.5)';
      c.fillRect(r() * (w - 80), y, 20 + r() * 80, 1 + y / h * 1.5);
    }
  }
  // ---- 荷台（床板・手すり・前板・御者台・側板）: 画面幅ごとにキャッシュ
  function s3Deck(c, w, h) {
    const F = w - 100, o = DECK_Y, Y = y => y - o;
    const r = U.srand(3101);
    // 床板（手前ほど幅広）
    let y = FLOOR_Y, rh = 7.5, row = 0;
    const cols = ['#6e4c30', '#634428', '#77533a', '#5c3e26'];
    while (y < 334) {
      const hh = Math.min(rh, 334 - y);
      c.fillStyle = cols[row % 4]; c.fillRect(0, Y(y), F, hh);
      c.fillStyle = 'rgba(40,20,8,0.28)';
      for (let k = 0; k < 4; k++) c.fillRect(r() * F, Y(y + 1 + r() * Math.max(1, hh - 2)), 20 + r() * 60, 1);
      let x = r() * 90;
      while (x < F) {
        c.fillStyle = 'rgba(20,10,4,0.7)'; c.fillRect(x, Y(y), 1.5, hh);
        c.fillStyle = '#2a2622'; c.fillRect(x - 3, Y(y + hh * 0.5 - 1), 1.6, 1.6); c.fillRect(x + 2.6, Y(y + hh * 0.5 - 1), 1.6, 1.6);
        x += 80 + r() * 90;
      }
      c.fillStyle = 'rgba(15,8,3,0.8)'; c.fillRect(0, Y(y + hh - 1), F, 1.2);
      c.fillStyle = 'rgba(255,200,140,0.09)'; c.fillRect(0, Y(y), F, 1);
      y += rh; rh *= 1.12; row++;
    }
    for (let i = 0; i < 6; i++) { c.fillStyle = 'rgba(30,14,6,0.25)'; c.beginPath(); c.ellipse(40 + r() * (F - 80), Y(220 + r() * 100), 14 + r() * 20, 3 + r() * 4, 0, 0, TAU); c.fill(); }
    const sh = c.createLinearGradient(0, Y(FLOOR_Y), 0, Y(FLOOR_Y + 26));
    sh.addColorStop(0, 'rgba(0,0,0,0.5)'); sh.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = sh; c.fillRect(0, Y(FLOOR_Y), F, 26);
    // 奥の側板と手すり
    c.fillStyle = '#3e2818'; c.fillRect(0, Y(182), F, 17);
    c.fillStyle = 'rgba(0,0,0,0.35)'; c.fillRect(0, Y(188), F, 1); c.fillRect(0, Y(194), F, 1);
    for (let x = 12; x < F; x += 60) {
      c.fillStyle = '#4a3020'; c.fillRect(x - 3, Y(162), 6, 37);
      c.fillStyle = 'rgba(255,180,120,0.18)'; c.fillRect(x - 3, Y(162), 1.5, 37);
      c.fillStyle = '#3a3632'; c.fillRect(x - 4, Y(176), 8, 3);
    }
    c.fillStyle = '#6a482a'; c.fillRect(0, Y(158), F + 4, 6);
    c.fillStyle = '#a0703e'; c.fillRect(0, Y(158), F + 4, 1.2);
    c.fillStyle = '#2a1a0e'; c.fillRect(0, Y(164), F + 4, 1.5);
    // 後ろの煽り板（左端）
    c.fillStyle = '#4a3020'; c.fillRect(0, Y(158), 9, 352 - 158);
    c.fillStyle = '#2a1a0e'; c.fillRect(8, Y(158), 2, 352 - 158);
    c.fillStyle = '#3a3632'; c.fillRect(0, Y(200), 10, 3); c.fillRect(0, Y(300), 10, 3);
    // 手前の縁と側板
    c.fillStyle = '#3a2414'; c.fillRect(0, Y(330), F + 9, 5);
    c.fillStyle = '#8a5e36'; c.fillRect(0, Y(330), F + 9, 1);
    c.fillStyle = '#4e321e'; c.fillRect(0, Y(335), F + 9, 16);
    c.fillStyle = 'rgba(0,0,0,0.35)'; c.fillRect(0, Y(343), F + 9, 1);
    for (let x = 30; x < F; x += 70) {
      c.fillStyle = '#34302c'; c.fillRect(x, Y(335), 5, 16);
      c.fillStyle = '#8a8278'; c.fillRect(x + 1.5, Y(338), 2, 2); c.fillRect(x + 1.5, Y(346), 2, 2);
    }
    c.fillStyle = '#1c1208'; c.fillRect(0, Y(351), F + 9, 3);
    // 前板と御者台
    c.fillStyle = '#4a3020'; c.fillRect(F, Y(150), 9, 354 - 150);
    c.fillStyle = 'rgba(255,180,120,0.2)'; c.fillRect(F, Y(150), 1.5, 354 - 150);
    c.fillStyle = '#3a3632'; for (const yy of [176, 236, 300]) c.fillRect(F - 1, Y(yy), 11, 4);
    c.fillStyle = '#3a2616'; c.fillRect(F - 42, Y(166), 44, 12);
    c.fillStyle = '#5a3a22'; c.fillRect(F - 46, Y(162), 52, 5);
    c.fillStyle = '#8a5a30'; c.fillRect(F - 46, Y(162), 52, 1);
    // ランタンの柱
    c.fillStyle = '#2e1e10'; c.fillRect(F - 54, Y(112), 4, 199 - 112);
    c.fillRect(F - 54, Y(112), 18, 3);
  }
  function s3Bough(c, w, h) {
    const r = U.srand(3061);
    c.strokeStyle = '#0c0706'; c.lineCap = 'round';
    c.lineWidth = 14; c.beginPath(); c.moveTo(-10, 4); c.quadraticCurveTo(w * 0.45, 42, w + 10, 14); c.stroke();
    const tips = [];
    for (let i = 0; i < 9; i++) {
      const k = 0.05 + i * 0.11, bx = k * w, by = 4 + Math.sin(k * Math.PI) * 30;
      const ex = bx - 10 - r() * 30, ey = by + 30 + r() * 50;
      c.lineWidth = 3 + r() * 3; c.beginPath(); c.moveTo(bx, by); c.quadraticCurveTo(bx + 6, by + 20, ex, ey); c.stroke();
      tips.push([ex, ey], [(bx + ex) / 2, (by + ey) / 2]);
    }
    c.lineCap = 'butt';
    const lc = ['#140a06', '#2a1409', '#4a200c', '#6a2e10'];
    for (const [x, y] of tips) {
      for (let k = 0; k < 7; k++) {
        c.fillStyle = lc[(r() * lc.length) | 0];
        c.beginPath(); c.ellipse(x + (r() - 0.5) * 30, y + (r() - 0.5) * 18, 6 + r() * 6, 3 + r() * 3, r() * 3, 0, TAU); c.fill();
      }
    }
  }
  function s3TrunkFg(c, w, h) {
    const r = U.srand(3071);
    const g = c.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, 'rgba(10,5,6,0)'); g.addColorStop(0.28, 'rgba(10,5,6,0.96)');
    g.addColorStop(0.72, 'rgba(10,5,6,0.96)'); g.addColorStop(1, 'rgba(10,5,6,0)');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
    c.fillStyle = 'rgba(52,26,18,0.5)';
    for (let i = 0; i < 16; i++) c.fillRect(22 + r() * (w - 44), r() * h, 2, 30 + r() * 80);
  }
  function hindLeg(c, x, y, ph, col, w) {
    const a1 = Math.sin(ph) * 0.6 + 0.12;
    const kx = x + Math.sin(a1) * 20, ky = y + Math.cos(a1) * 20;
    const a2 = a1 - 0.3 - Math.max(0, Math.cos(ph)) * 0.9;
    const fx = kx + Math.sin(a2) * 24, fy = ky + Math.cos(a2) * 24;
    c.strokeStyle = col; c.lineCap = 'round';
    c.lineWidth = w; c.beginPath(); c.moveTo(x, y); c.lineTo(kx, ky); c.stroke();
    c.lineWidth = w * 0.42; c.beginPath(); c.moveTo(kx, ky); c.lineTo(fx, fy); c.stroke();
    c.fillStyle = '#0c0604'; c.fillRect(fx - 3, fy - 1, 6, 3.5);
  }
  function foreLeg(c, x, y, ph, col, w) {
    const a1 = Math.sin(ph) * 0.7 - 0.05;
    const kx = x + Math.sin(a1) * 21, ky = y + Math.cos(a1) * 21;
    const a2 = a1 - Math.max(0, -Math.cos(ph)) * 1.5;
    const fx = kx + Math.sin(a2) * 23, fy = ky + Math.cos(a2) * 23;
    c.strokeStyle = col; c.lineCap = 'round';
    c.lineWidth = w; c.beginPath(); c.moveTo(x, y); c.lineTo(kx, ky); c.stroke();
    c.lineWidth = w * 0.45; c.beginPath(); c.moveTo(kx, ky); c.lineTo(fx, fy); c.stroke();
    c.fillStyle = '#0c0604'; c.fillRect(fx - 3, fy - 1, 6, 3.5);
  }
  /** 疾走する馬（右向き）。x: 尻の後端, gy: 蹄の接地 y */
  function drawHorse(c, x, gy, t, s, col, ph0, attachX) {
    const ph = t * 0.36 + ph0;
    const bob = Math.sin(ph * 2 + 0.6) * 2.2 * s;
    const by = gy - 50 * s + bob;
    c.save(); c.translate(x, by); c.scale(s, s);
    // 奥側の脚
    hindLeg(c, 22, 6, ph + 0.5, col.dark, 10);
    foreLeg(c, 86, 8, ph + Math.PI + 0.5, col.dark, 8);
    // 尾（風になびく）
    const tw = Math.sin(t * 0.5 + ph0) * 4, tw2 = Math.sin(t * 0.37 + ph0 + 1) * 3;
    c.fillStyle = col.hair;
    c.beginPath(); c.moveTo(6, -18);
    c.bezierCurveTo(-6, -22, -16, -10 + tw, -26, 0 + tw * 1.4);
    c.bezierCurveTo(-24, 6 + tw2, -22, 12 + tw, -30, 20 + tw2 * 1.2);
    c.bezierCurveTo(-14, 18 + tw, -6, 6, 4, -2);
    c.closePath(); c.fill();
    c.strokeStyle = col.hair; c.lineWidth = 1.3;
    c.beginPath(); c.moveTo(-10, -6); c.quadraticCurveTo(-24, 0 + tw, -34, 8 + tw * 1.6); c.moveTo(-10, 4); c.quadraticCurveTo(-20, 14 + tw2, -26, 26 + tw2); c.stroke();
    // 胴・尻・胸・首
    c.fillStyle = col.body;
    c.beginPath(); c.ellipse(50, 0, 44, 18, 0, 0, TAU); c.fill();
    c.beginPath(); c.ellipse(18, -2, 20, 21, 0, 0, TAU); c.fill();
    c.beginPath(); c.ellipse(84, -4, 19, 20, -0.3, 0, TAU); c.fill();
    c.beginPath(); c.moveTo(78, -18); c.quadraticCurveTo(96, -40, 112, -60); c.lineTo(136, -50); c.quadraticCurveTo(112, -22, 102, 6); c.closePath(); c.fill();
    // たてがみ
    c.fillStyle = col.hair;
    c.beginPath(); c.moveTo(84, -24); c.quadraticCurveTo(92, -44 + tw * 0.5, 108, -64); c.lineTo(100, -58); c.quadraticCurveTo(86, -40, 76, -30 + tw); c.closePath(); c.fill();
    // 夕陽のリムライト
    c.strokeStyle = col.rim; c.lineWidth = 1.8;
    c.beginPath(); c.ellipse(50, 0, 44, 18, 0, Math.PI * 1.15, Math.PI * 1.7); c.stroke();
    c.beginPath(); c.ellipse(18, -2, 20, 21, 0, Math.PI * 1.05, Math.PI * 1.62); c.stroke();
    // 馬具（腹帯・尻がい・引き綱）
    c.strokeStyle = col.strap; c.lineWidth = 3.2;
    c.beginPath(); c.moveTo(62, -18); c.lineTo(64, 17); c.stroke();
    c.beginPath(); c.moveTo(2, -6); c.quadraticCurveTo(16, 12, 38, 12); c.stroke();
    c.lineWidth = 2.2; c.beginPath(); c.moveTo((attachX - x) / s, 6); c.lineTo(96, -2); c.stroke();
    c.fillStyle = col.metal; c.fillRect(60, -9, 5, 4); c.fillRect(34, 10, 3, 3);
    // 手前の脚
    hindLeg(c, 18, 8, ph, col.body, 11);
    foreLeg(c, 90, 10, ph + Math.PI, col.body, 8.5);
    c.restore();
  }
  function s3Wheel(c, x, y, r, ang) {
    c.strokeStyle = '#3a2414'; c.lineWidth = 4.5; c.beginPath();
    for (let i = 0; i < 12; i++) { const a = ang + i * Math.PI / 6, ca = Math.cos(a), sa = Math.sin(a); c.moveTo(x + ca * 9, y + sa * 9); c.lineTo(x + ca * (r - 5), y + sa * (r - 5)); }
    c.stroke();
    c.strokeStyle = 'rgba(58,36,20,0.42)'; c.lineWidth = 22; c.beginPath(); c.arc(x, y, r - 17, 0, TAU); c.stroke();
    c.strokeStyle = '#2e1c10'; c.lineWidth = 8; c.beginPath(); c.arc(x, y, r - 4, 0, TAU); c.stroke();
    c.strokeStyle = '#6e6660'; c.lineWidth = 2.5; c.beginPath(); c.arc(x, y, r, 0, TAU); c.stroke();
    c.fillStyle = '#9a9088';
    for (let i = 0; i < 8; i++) { const a = ang + i * Math.PI / 4; c.fillRect(x + Math.cos(a) * (r - 4) - 1, y + Math.sin(a) * (r - 4) - 1, 2, 2); }
  }
  function s3Driver(c, F, t, s) {
    const x = F - 20, y = 162;
    const col = '#1c1418', rim = '#8a4428';
    // 鞭（ときどき振るう）
    const wk = s.whipT > 0 ? s.whipT / 24 : 0;
    const armA = wk > 0 ? Math.sin(wk * Math.PI) : 0;
    c.fillStyle = col;
    c.beginPath(); c.moveTo(x - 13, y); c.lineTo(x - 10, y - 22); c.quadraticCurveTo(x - 5, y - 31, x + 4, y - 29); c.lineTo(x + 11, y - 12); c.lineTo(x + 15, y); c.closePath(); c.fill();
    c.beginPath(); c.ellipse(x + 3, y - 34, 7, 8, 0.35, 0, TAU); c.fill();
    c.beginPath(); c.moveTo(x - 3, y - 40); c.lineTo(x - 9, y - 28); c.lineTo(x - 1, y - 30); c.closePath(); c.fill();
    c.strokeStyle = col; c.lineWidth = 4; c.lineCap = 'round';
    c.beginPath(); c.moveTo(x + 3, y - 22); c.lineTo(x + 12, y - 14); c.lineTo(x + 21, y - 16); c.stroke();
    const hx = x + 2 + armA * 6, hy = y - 22 - armA * 24;
    c.beginPath(); c.moveTo(x, y - 24); c.lineTo(hx, hy); c.stroke();
    c.lineCap = 'butt';
    c.strokeStyle = '#1a1008'; c.lineWidth = 1.2;
    c.beginPath(); c.moveTo(hx, hy); c.quadraticCurveTo(hx - 30 + armA * 60, hy - 30 - armA * 10, hx + 30 + armA * 40, hy - 10 + armA * 30); c.stroke();
    c.strokeStyle = rim; c.lineWidth = 1.2;
    c.beginPath(); c.moveTo(x - 10, y - 22); c.quadraticCurveTo(x - 5, y - 31, x + 4, y - 29); c.stroke();
    c.beginPath(); c.arc(x + 3, y - 34, 7, Math.PI * 1.1, Math.PI * 1.6); c.stroke();
    // 手綱
    c.strokeStyle = '#2a1a10'; c.lineWidth = 1;
    c.beginPath(); c.moveTo(x + 21, y - 16); c.lineTo(BK.W + 10, y + 26); c.moveTo(x + 21, y - 16); c.lineTo(BK.W + 10, y + 96); c.stroke();
  }
  function s3Lantern(c, F, t, p, bump) {
    const px = F - 38, py = 115, a = Math.sin(t * 0.11) * 0.28 + bump * 0.04;
    const lx = px + Math.sin(a) * 12, ly = py + Math.cos(a) * 12;
    glow(c, gl('lamp'), lx, ly + 4, 46 + p * 30, 0.22 + p * 0.45);
    c.strokeStyle = '#1a1008'; c.lineWidth = 1; c.beginPath(); c.moveTo(px, py); c.lineTo(lx, ly - 3); c.stroke();
    c.fillStyle = '#241a12'; c.fillRect(lx - 4.5, ly - 3, 9, 2); c.fillRect(lx - 4, ly + 9, 8, 2);
    c.fillStyle = `rgba(255,${190 + (Math.sin(t * 0.4) * 20) | 0},110,0.95)`; c.fillRect(lx - 3.5, ly - 1, 7, 10);
    c.fillStyle = '#241a12'; c.fillRect(lx - 0.5, ly - 1, 1, 10);
  }
  function s3Wing(c, k) {
    const W = BK.W, x = W + 240 - k * 13, y = 64 + Math.sin(k * 0.1) * 8;
    const fl = 0.8 + 0.2 * Math.cos(k * 0.28);
    c.save(); c.translate(x, y);
    c.globalAlpha = Math.min(1, k / 10, (110 - k) / 20) * 0.88;
    c.fillStyle = '#070306';
    for (const sd of [-1, 1]) {
      const L = 150 * fl;
      c.beginPath(); c.moveTo(-18, 0);
      c.quadraticCurveTo(-8, sd * L * 0.5, 30, sd * L);
      c.quadraticCurveTo(38, sd * L * 0.7, 62, sd * L * 0.76);
      c.quadraticCurveTo(52, sd * L * 0.48, 84, sd * L * 0.44);
      c.quadraticCurveTo(60, sd * L * 0.22, 58, sd * 10);
      c.closePath(); c.fill();
    }
    c.beginPath(); c.ellipse(4, 0, 60, 15, 0, 0, TAU); c.fill();
    c.beginPath(); c.arc(-60, 0, 12, 0, TAU); c.fill();
    c.beginPath(); c.moveTo(-64, -8); c.quadraticCurveTo(-80, -22, -70, -34); c.lineTo(-62, -12); c.fill();
    c.beginPath(); c.moveTo(-64, 8); c.quadraticCurveTo(-80, 22, -70, 34); c.lineTo(-62, 12); c.fill();
    c.beginPath(); c.moveTo(60, -6); c.quadraticCurveTo(110, 0, 130, -10); c.lineTo(62, 6); c.fill();
    c.restore();
  }
  /** 乗り込んでくる敵の演出（stage.update から一度だけ呼ぶ） */
  function s3Board(e, s) {
    if (e.boss) return;
    const W = BK.W, cam = BK.cam.x;
    if (e.entry === 'jump') {
      e.vz = 8.6;
      if (e.x < cam + 10) e.vx = 4.2;                   // 後ろから飛び乗る
      else if (e.x > cam + W - 10) e.vx = -4.4;          // 馬の背から
      else if (e.y < 12) { e.vy = 1.4; s3Splinters(e.x, 2, 26); }             // 奥の手すりを越える
      else if (e.y > BK.DEPTH - 12) { e.vy = -1.5; s3Splinters(e.x, BK.DEPTH, 4); } // 手前の側板をよじ登る
    } else if (e.entry === 'drop') {
      s.branches.push({ x: e.x - cam + 30, v: 24 });     // 頭上の枝から飛び降りる
      BK.audio.sfx('swing', { pitch: 0.6, vol: 0.6 });
    }
  }
  function s3Splinters(x, y, z) {
    BK.audio.sfx('hit', { pitch: 0.6, vol: 0.5 });
    for (let i = 0; i < 8; i++) {
      BK.fx.add({ type: 'dot', x: x + U.rand(-10, 10), y, z: z + U.rand(0, 8), vx: U.rand(-2, 2), vz: U.rand(1, 4), g: 0.3, life: U.randi(20, 34), col: U.choose(['#6a4a2c', '#8a6a44', '#3a2616']), size: U.rand(1.5, 3) });
    }
  }

  BK.stages[2] = {
    id: 3, name: '疾駆', sub: '夕暮れの森を馬車で逃走',
    // 荷台 = 画面の幅（カメラは動かない）。背景は時間で流れる
    get len() { return BK.W; },
    bgm: 'stage3', bossBgm: 'boss', heal: 0.3,
    intro: '夕陽が森を朱に染める。軋む車輪、追いすがる異形の群れ。\nそして背後の空から、戦いに飢えた翼の音が迫る──。',
    props: [
      // 荷台の積み荷（最小画面幅 560 でも前板 x=460 より手前に置く）
      { x: 180, y: 22, type: 'barrel', item: 'knives' },
      { x: 300, y: 104, type: 'crate', item: 'meat' },
      { x: 410, y: 40, type: 'crate', item: 'bombs' },
    ],
    events: [
      { at: 0, waves: [
        [{ t: 'soldier', palette: 'kushan', side: 'L', y: 40, delay: 80 }, { t: 'soldier', palette: 'kushan', x: 380, y: 3, screen: true, entry: 'jump', delay: 110 }],
        [{ t: 'hound', side: 'L', y: 90, entry: 'jump' }, { t: 'hound', side: 'L', y: 30, entry: 'jump', delay: 30 }, { t: 'soldier', palette: 'kushan', x: 260, y: 116, screen: true, entry: 'jump', delay: 50 }]], next: 1 },
      { at: 0, waves: [
        [{ t: 'leaper', side: 'R', y: 30 }, { t: 'leaper', side: 'L', y: 90, delay: 40 }],
        [{ t: 'soldier', palette: 'kushan', x: 300, y: 50, screen: true, entry: 'drop' }, { t: 'soldier', palette: 'kushan', x: 400, y: 90, screen: true, entry: 'drop', delay: 40 }, { t: 'spirit', side: 'R', y: 60, delay: 20 }]], next: 1 },
      { at: 0, waves: [
        [{ t: 'hound', side: 'L', y: 20, entry: 'jump' }, { t: 'hound', side: 'L', y: 60, entry: 'jump', delay: 20 }, { t: 'hound', side: 'L', y: 100, entry: 'jump', delay: 40 }],
        [{ t: 'leaper', x: 380, y: 60, screen: true, entry: 'drop' }, { t: 'soldier', palette: 'kushan', x: 200, y: 3, screen: true, entry: 'jump' }, { t: 'soldier', palette: 'kushan', x: 400, y: 116, screen: true, entry: 'jump', delay: 25 }],
        [{ t: 'spirit', side: 'L', y: 30 }, { t: 'spirit', side: 'R', y: 90, delay: 20 }, { t: 'spirit', x: 330, y: 50, screen: true, entry: 'drop', delay: 40 }]], next: 1 },
      { at: 0, waves: [
        [{ t: 'soldier', palette: 'kushan', side: 'L', y: 30, hp: 70 }, { t: 'leaper', side: 'R', y: 90 }, { t: 'hound', side: 'L', y: 60, entry: 'jump', delay: 40 }],
        [{ t: 'leaper', x: 360, y: 40, screen: true, entry: 'drop' }, { t: 'soldier', palette: 'kushan', x: 180, y: 116, screen: true, entry: 'jump' }, { t: 'soldier', palette: 'kushan', x: 420, y: 3, screen: true, entry: 'jump', delay: 20 }, { t: 'hound', side: 'L', y: 100, entry: 'jump', delay: 50 }]], next: 2 },
      // 不死のゾッドが荷台に降り立つ
      { at: 0, boss: 'zodd', entry: 'drop', x: 360, y: 60, waves: [],
        onStart(g) {
          const s = s3State(g);
          s.wing = 0;
          BK.fx.flash('#200008', 14);
          // 御者が干し肉を放ってよこす
          const it = g.spawnItem('roast', BK.cam.x + s3Front() - 24, 50, 46);
          if (it) it.vx = -3.4;
        } },
    ],
    init(g) {
      g.s3 = null; s3State(g);
      BG.layer('s3cloud', 1400, 70, s3Clouds); BG.layer('s3hill', 1400, 80, s3Hills); BG.layer('s3canopy', 1300, 122, s3Canopy);
      BG.layer('s3trunk', 1500, 206, s3Trunks); BG.layer('s3verge', 900, 40, s3Verge); BG.layer('s3road', 700, BK.H - FLOOR_Y, s3Road);
      BG.layer('s3bough', 360, 110, s3Bough); BG.layer('s3tfg', 84, 360, s3TrunkFg); BG.layer('s3deck' + BK.W, BK.W, BK.H - DECK_Y, s3Deck);
      gl('sun'); gl('lamp');
    },
    update(g) {
      const s = s3State(g), W = BK.W, F = s3Front();
      g.goT = 0; // 荷台の上なので「GO」は出さない
      // 日が沈んでいく（イベントの進行に合わせて）
      const n = g.events.length;
      const target = n > 1 ? U.clamp((g.evIdx - 1) / (n - 1), 0, 1) : 1;
      s.p = U.approach(s.p, target, 0.0012);
      // 路面の段差で揺れる
      if (--s.nextBump <= 0) { s.nextBump = U.randi(260, 520); s.bumpT = 14; BK.fx.shake(2.5, 8); BK.audio.sfx('thud', { pitch: 0.55, vol: 0.45 }); }
      if (s.bumpT > 0) s.bumpT--;
      // 頭上を過ぎる枝・手前を過ぎる幹
      if (--s.nextBranch <= 0) { s.nextBranch = U.randi(220, 440); s.branches.push({ x: W + 60, v: U.rand(22, 28) }); }
      for (const b of s.branches) b.x -= b.v;
      if (s.branches.length && s.branches[0].x < -420) s.branches.shift();
      if (--s.nextTrunk <= 0) { s.nextTrunk = U.randi(420, 820); s.trunk = W + 60; }
      if (s.trunk > -150) s.trunk -= 46;
      // 御者の鞭
      if (s.whipT > 0) s.whipT--;
      else if (--s.nextWhip <= 0) { s.nextWhip = U.randi(200, 360); s.whipT = 24; BK.audio.sfx('knife', { pitch: 0.7, vol: 0.4 }); }
      // 車輪の火花
      if (Math.random() < 0.07) {
        const wx = U.choose(s3Wheels());
        for (let i = 0; i < 3; i++) s.sparks.push({ x: wx - 22 + U.rand(-4, 4), y: 358, vx: U.rand(-7, -3), vy: U.rand(-3.2, -1), life: U.randi(8, 16) });
      }
      for (let i = s.sparks.length - 1; i >= 0; i--) { const k = s.sparks[i]; k.x += k.vx; k.y += k.vy; k.vy += 0.18; if (--k.life <= 0) s.sparks.splice(i, 1); }
      if (s.wing >= 0 && ++s.wing > 110) s.wing = -1;
      // 乗り込みの演出と、荷台の前端（ここから先は馬）
      const lim = BK.cam.x + F - 14;
      for (const a of g.actors) {
        if (a.team === 'enemy' && !a._s3) { a._s3 = true; s3Board(a, s); }
        if (a.isProp || a.grabbedBy) continue;
        if (a === g.hero) { if (a.x > lim) a.x = lim; }
        else if (a.team === 'enemy' && !a.entering && a.z <= 0 && a.x > lim + 6) a.x = Math.max(lim + 6, a.x - 4);
      }
    },
    drawBg(c, g) {
      const s = s3State(g), t = g.time, W = BK.W, p = s.p, F = s3Front();
      const bump = s.bumpT > 0 ? Math.sin(s.bumpT / 14 * Math.PI) * 4 : 0;
      const bob = Math.sin(t * 0.45) * 1.2 - bump;
      // 空（日が沈むにつれて暗く）
      BG.sky(c, [[0, U.mix('#2c1a3c', '#08081a', p)], [0.55, U.mix('#a8482c', '#3c1632', p)], [1, U.mix('#f4a456', '#8c3428', p)]], 0, 204);
      const sunX = W * 0.3, sunY = 112 + p * 74;
      glow(c, gl('sun'), sunX, sunY, 130, 0.6 - p * 0.3);
      c.fillStyle = U.mix('#ffe4a8', '#ff7038', p); c.beginPath(); c.arc(sunX, sunY, 22, 0, TAU); c.fill();
      BG.tile(c, BG.layer('s3cloud', 1400, 70, s3Clouds), 0, 24, t * S3V.cloud);
      BG.tile(c, BG.layer('s3hill', 1400, 80, s3Hills), 0, 96 + bob * 0.2, t * S3V.hill);
      BG.tile(c, BG.layer('s3canopy', 1300, 122, s3Canopy), 0, 82 + bob * 0.5, t * S3V.canopy);
      if (p > 0.01) { c.fillStyle = `rgba(14,6,26,${(p * 0.3).toFixed(3)})`; c.fillRect(0, 0, W, 204); }
      BG.tile(c, BG.layer('s3trunk', 1500, 206, s3Trunks), 0, -6 + bob, t * S3V.trunk);
      BG.tile(c, BG.layer('s3verge', 900, 40, s3Verge), 0, 162 + bob, t * S3V.verge);
      // 路面は馬の足元と荷台の下にしか見えないので、その範囲だけ描く
      const road = BG.layer('s3road', 700, BK.H - FLOOR_Y, s3Road);
      clipRect(c, F + 8, FLOOR_Y, W, BK.H); BG.tile(c, road, 0, FLOOR_Y, t * S3V.road); c.restore();
      clipRect(c, 0, 350, F + 8, BK.H); BG.tile(c, road, 0, FLOOR_Y, t * S3V.road); c.restore();
      // 荷台（静止）
      spr(c, BG.layer('s3deck' + W, W, BK.H - DECK_Y, s3Deck), 0, DECK_Y);
      if (p > 0.01) { c.fillStyle = `rgba(14,6,26,${(p * 0.16).toFixed(3)})`; c.fillRect(0, DECK_Y, F + 9, BK.H - DECK_Y); }
      // 車輪と土煙
      const ws = s3Wheels(), ang = t * 0.13;
      for (const wx of ws) s3Wheel(c, wx, WHEEL_Y + bump * 0.3, WHEEL_R, ang);
      for (let i = 0; i < ws.length; i++) {
        for (let k = 0; k < 4; k++) {
          const ph = ((t * 1.3 + k * 25 + i * 11) % 100) / 100;
          c.fillStyle = `rgba(140,100,70,${((1 - ph) * 0.34).toFixed(3)})`;
          c.beginPath(); c.arc(ws[i] - 30 - ph * 80, 357 - ph * 20, 4 + ph * 12, 0, TAU); c.fill();
        }
      }
      // 奥の馬・御者・ランタン
      drawHorse(c, F + 14, 268, t, 0.9, HORSE_FAR, 2.1, F + 9);
      s3Driver(c, F, t, s);
      s3Lantern(c, F, t, p, bump);
    },
    drawFg(c, g) {
      const s = s3State(g), t = g.time, W = BK.W, F = s3Front();
      // 手前の馬と蹄の土煙
      drawHorse(c, F + 10, 352, t, 1.0, HORSE_NEAR, 0, F + 9);
      for (let k = 0; k < 3; k++) {
        const ph = ((t * 2 + k * 33) % 100) / 100;
        c.fillStyle = `rgba(140,100,70,${((1 - ph) * 0.3).toFixed(3)})`;
        c.beginPath(); c.arc(F + 26 - ph * 60, 350 - ph * 14, 3 + ph * 10, 0, TAU); c.fill();
      }
      // 車輪の火花
      if (s.sparks.length) {
        c.strokeStyle = '#ffc060'; c.lineWidth = 1.4; c.beginPath();
        for (const k of s.sparks) { c.moveTo(k.x, k.y); c.lineTo(k.x - k.vx * 1.6, k.y - k.vy * 1.6); }
        c.stroke();
      }
      // 頭上の枝
      const bough = BG.layer('s3bough', 360, 110, s3Bough);
      for (const b of s.branches) if (b.x < W + 60) spr(c, bough, b.x - 40, -14);
      // 手前を一瞬で過ぎる幹
      if (s.trunk > -100 && s.trunk < W + 100) spr(c, BG.layer('s3tfg', 84, 360, s3TrunkFg), s.trunk - 42, 0);
      // 舞い散る葉
      for (let i = 0; i < 10; i++) {
        const sp = 9 + ((i * 7) % 9);
        const x = W + 40 - ((t * sp + i * 197) % (W + 120));
        const y = 30 + ((i * 71) % 250) + Math.sin(t * 0.07 + i) * 16;
        c.save(); c.translate(x, y); c.rotate(t * (i % 2 ? 0.22 : -0.18) + i);
        c.fillStyle = LEAF[i % 3]; c.beginPath(); c.ellipse(0, 0, 4.2, 1.9, 0, 0, TAU); c.fill();
        c.restore();
      }
      if (s.wing >= 0) s3Wing(c, s.wing);
      BG.vignette(c, 0.42);
    },
  };

  // =====================================================================
  //  ROUND 4 霧の森
  // =====================================================================
  const CX4 = 2350;                 // 巨木の森 → 繭の垂れる空き地（ロシーヌの棲み処）
  const RUIN_P = 950;               // 遺跡（係数 0.5）
  const NEAR_A = { trunk: '#070c0d', bark: '#030607', hi: '#3c5858', rim2: 'rgba(90,210,175,0.22)', groove: 'rgba(60,90,88,0.35)', moss: '31,58,42' };

  function r4Sky(c, w, h) {
    const g = c.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#03070a'); g.addColorStop(0.5, '#0b171c'); g.addColorStop(1, '#223a3e');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
    const mx = w * 0.7;
    const m = c.createRadialGradient(mx, 16, 4, mx, 16, 170);
    m.addColorStop(0, 'rgba(215,240,235,0.6)'); m.addColorStop(0.3, 'rgba(150,190,190,0.18)'); m.addColorStop(1, 'rgba(150,190,190,0)');
    c.fillStyle = m; c.fillRect(0, 0, w, h);
    for (let i = 0; i < 5; i++) {
      const x0 = mx - 40 + i * 22, sp = 40 + i * 30;
      const sg = c.createLinearGradient(0, 0, 0, h);
      sg.addColorStop(0, 'rgba(200,230,225,0.09)'); sg.addColorStop(1, 'rgba(200,230,225,0)');
      c.fillStyle = sg;
      c.beginPath(); c.moveTo(x0, 0); c.lineTo(x0 + 10, 0); c.lineTo(x0 - sp + 26, h); c.lineTo(x0 - sp - 6, h); c.closePath(); c.fill();
    }
    // 霧に霞む遠くの木立（空と同じレイヤーにまとめて描画コストを抑える）
    const r = U.srand(4102);
    const tg = c.createLinearGradient(0, 0, 0, h);
    tg.addColorStop(0, '#142328'); tg.addColorStop(0.6, '#2a4247'); tg.addColorStop(1, '#4c6c70');
    c.fillStyle = tg; c.strokeStyle = tg;
    for (let i = 0; i < 16; i++) {
      const x = (i + 0.2 + r() * 0.6) * (w / 16), tw = 10 + r() * 14;
      c.globalAlpha = r() < 0.5 ? 0.85 : 1;
      c.beginPath(); c.moveTo(x - tw / 2, h); c.lineTo(x - tw * 0.35, 0); c.lineTo(x + tw * 0.35, 0); c.lineTo(x + tw / 2, h); c.fill();
      c.lineWidth = 3;
      for (let k = 0; k < 4; k++) {
        const y = 20 + r() * 110, sd = r() < 0.5 ? -1 : 1;
        c.beginPath(); c.moveTo(x, y); c.quadraticCurveTo(x + sd * 20, y - 10, x + sd * (30 + r() * 30), y - 20 - r() * 20); c.stroke();
      }
    }
    c.globalAlpha = 1;
  }
  function branch(c, x, y, a, len, lw, depth, r, ends) {
    const ex = x + Math.cos(a) * len, ey = y + Math.sin(a) * len;
    const mx = x + Math.cos(a + 0.35) * len * 0.55, my = y + Math.sin(a + 0.35) * len * 0.55;
    c.lineWidth = lw; c.beginPath(); c.moveTo(x, y); c.quadraticCurveTo(mx, my, ex, ey); c.stroke();
    if (depth > 0) {
      branch(c, ex, ey, a - 0.35 - r() * 0.45, len * 0.68, lw * 0.6, depth - 1, r, ends);
      branch(c, ex, ey, a + 0.3 + r() * 0.45, len * 0.6, lw * 0.6, depth - 1, r, ends);
    } else ends.push([ex, ey]);
  }
  function twistTrunk(c, x, w, top, base, r, col) {
    const n = 14, pts = [], lean = (r() - 0.5) * 50, ph = r() * 6;
    for (let i = 0; i <= n; i++) {
      const k = i / n, y = base + (top - base) * k;
      pts.push([x + Math.sin(k * 4 + ph) * w * 0.4 + lean * k, y, w * (0.5 - k * 0.2)]);
    }
    c.fillStyle = col;
    c.beginPath(); c.moveTo(pts[0][0] - w * 1.1, base);
    for (const p of pts) c.lineTo(p[0] - p[2], p[1]);
    for (let i = n; i >= 0; i--) c.lineTo(pts[i][0] + pts[i][2], pts[i][1]);
    c.lineTo(pts[0][0] + w * 1.1, base); c.closePath(); c.fill();
    return pts;
  }
  function r4Mid(c, w, h) {
    const r = U.srand(4203), col = '#122024';
    // 梢（頭上を覆う葉の塊）
    c.fillStyle = '#0a1316';
    for (let x = -20; x < w + 20; x += 26) { c.beginPath(); c.ellipse(x, 6 + r() * 14, 30, 16 + r() * 10, 0, 0, TAU); c.fill(); }
    const trees = [[150, 40], [470, 52], [800, 36], [1080, 46]];
    const ends = [];
    for (const [x, tw] of trees) {
      const pts = twistTrunk(c, x, tw, -10, h + 4, r, col);
      c.strokeStyle = 'rgba(0,0,0,0.45)'; c.lineWidth = 1.5;
      for (let j = 0; j < 4; j++) {
        c.beginPath();
        pts.forEach((p, i) => { const xx = p[0] + p[2] * Math.sin(i * 0.55 + j * 1.6) * 0.8; if (i) c.lineTo(xx, p[1]); else c.moveTo(xx, p[1]); });
        c.stroke();
      }
      c.strokeStyle = 'rgba(80,120,118,0.35)'; c.lineWidth = 2;
      c.beginPath(); pts.forEach((p, i) => { if (i) c.lineTo(p[0] - p[2] + 1, p[1]); else c.moveTo(p[0] - p[2] + 1, p[1]); }); c.stroke();
      c.strokeStyle = col; c.lineCap = 'round';
      for (let k = 0; k < 3; k++) {
        const p = pts[6 + k * 2], sd = k % 2 ? 1 : -1;
        branch(c, p[0], p[1], -Math.PI / 2 + sd * (0.7 + r() * 0.5), 40 + r() * 30, 9, 2, r, ends);
      }
      c.lineCap = 'butt';
      // 光る茸（幹に点々と）
      for (let k = 0; k < 3; k++) {
        const p = pts[2 + ((r() * 7) | 0)], fx = p[0] + (r() < 0.5 ? -p[2] : p[2]) * 0.9, fy = p[1];
        const gg = c.createRadialGradient(fx, fy, 0, fx, fy, 14);
        gg.addColorStop(0, 'rgba(110,255,215,0.35)'); gg.addColorStop(1, 'rgba(110,255,215,0)');
        c.fillStyle = gg; c.fillRect(fx - 14, fy - 14, 28, 28);
        c.fillStyle = '#58d8b8'; c.beginPath(); c.ellipse(fx, fy, 4, 1.8, 0, Math.PI, 0); c.fill();
      }
    }
    // 垂れ下がる苔と繭
    for (const [x, y] of ends) {
      c.strokeStyle = 'rgba(120,150,134,0.3)'; c.lineWidth = 1;
      c.beginPath(); for (let k = 0; k < 3; k++) { const L = 10 + r() * 34; c.moveTo(x + k * 3 - 3, y); c.lineTo(x + k * 3 - 3 + (r() - 0.5) * 4, y + L); } c.stroke();
      if (r() < 0.18) {
        const L = 16 + r() * 30;
        c.strokeStyle = 'rgba(200,200,190,0.35)'; c.beginPath(); c.moveTo(x, y); c.lineTo(x, y + L); c.stroke();
        c.fillStyle = '#6c7068'; c.beginPath(); c.ellipse(x, y + L + 7, 4, 8, 0, 0, TAU); c.fill();
      }
    }
  }
  function nearTrunk(c, x, w, r, glowFungi, hollow) {
    const base = 214, lean = (r() - 0.5) * 22, col = NEAR_A;
    const L = [], R = [];
    for (let i = 0; i <= 10; i++) {
      const k = i / 10, y = base - 34 - (base + 16 - 34) * k;
      const cx = x + lean * k + Math.sin(k * 3.4 + x) * w * 0.07;
      const hw = w * (0.52 - k * 0.1);
      L.push([cx - hw, y]); R.push([cx + hw, y]);
    }
    c.fillStyle = col.trunk;
    c.beginPath(); c.moveTo(x - w * 1.35, base);
    c.quadraticCurveTo(x - w * 0.72, base - 4, L[0][0], L[0][1]);
    for (const p of L) c.lineTo(p[0], p[1]);
    for (let i = R.length - 1; i >= 0; i--) c.lineTo(R[i][0], R[i][1]);
    c.quadraticCurveTo(x + w * 0.72, base - 4, x + w * 1.35, base);
    c.closePath(); c.fill();
    // 根の盛り上がり
    c.strokeStyle = col.hi; c.lineWidth = 2;
    for (const sd of [-1, 1]) {
      for (let k = 0; k < 3; k++) {
        const sx = x + sd * w * (0.15 + k * 0.14);
        c.beginPath(); c.moveTo(sx, base - 50 + k * 8); c.quadraticCurveTo(sx + sd * w * 0.3, base - 14, sx + sd * w * (0.6 + k * 0.25), base); c.stroke();
      }
    }
    // 樹皮の溝（暗い溝と、月明かりを受ける稜）
    for (let j = 1; j < 6; j++) {
      for (const [col2, dx, lw] of [[col.bark, 0, 2.4], [col.groove, -2, 1]]) {
        c.strokeStyle = col2; c.lineWidth = lw; c.beginPath();
        for (let i = 0; i <= 10; i++) { const k = j / 6, xx = L[i][0] + (R[i][0] - L[i][0]) * (k + Math.sin(i * 0.8 + j) * 0.05) + dx; if (i) c.lineTo(xx, L[i][1]); else c.moveTo(xx, L[i][1]); }
        c.stroke();
      }
    }
    // 月明かりの縁（左）と茸の照り返し（右）
    c.strokeStyle = col.hi; c.lineWidth = 3;
    c.beginPath(); L.forEach((p, i) => { if (i) c.lineTo(p[0] + 1.5, p[1]); else c.moveTo(p[0] + 1.5, p[1]); }); c.stroke();
    c.strokeStyle = col.rim2; c.lineWidth = 2;
    c.beginPath(); R.forEach((p, i) => { if (i) c.lineTo(p[0] - 1.5, p[1]); else c.moveTo(p[0] - 1.5, p[1]); }); c.stroke();
    // 苔
    for (let k = 0; k < 14; k++) {
      const i = (r() * 10) | 0, px = L[i][0] + (R[i][0] - L[i][0]) * r() * 0.5;
      c.fillStyle = `rgba(${col.moss},${(0.4 + r() * 0.3).toFixed(2)})`;
      c.beginPath(); c.ellipse(px, L[i][1], 6 + r() * 10, 3 + r() * 4, 0, 0, TAU); c.fill();
    }
    // 洞（うろ）: 奥に茸の灯り
    if (hollow) {
      const hi = 3 + ((r() * 3) | 0), hx = (L[hi][0] + R[hi][0]) / 2 + (r() - 0.5) * w * 0.25, hy = L[hi][1], hw = w * 0.09, hh = w * 0.16;
      c.fillStyle = '#020304'; c.beginPath(); c.ellipse(hx, hy, hw, hh, 0, 0, TAU); c.fill();
      const gg = c.createRadialGradient(hx, hy + hh * 0.6, 0, hx, hy + hh * 0.6, hw * 1.4);
      gg.addColorStop(0, 'rgba(110,255,215,0.35)'); gg.addColorStop(1, 'rgba(110,255,215,0)');
      c.fillStyle = gg; c.beginPath(); c.ellipse(hx, hy, hw, hh, 0, 0, TAU); c.fill();
      c.strokeStyle = col.hi; c.lineWidth = 2; c.beginPath(); c.ellipse(hx, hy, hw + 2.5, hh + 2.5, 0, Math.PI * 0.85, Math.PI * 1.75); c.stroke();
    }
    // 棚茸（光る縁）
    if (glowFungi) {
      for (let k = 0; k < 3; k++) {
        const i = 2 + k * 2, fx = R[i][0] - 2, fy = R[i][1];
        const gg = c.createRadialGradient(fx + 8, fy, 0, fx + 8, fy, 26);
        gg.addColorStop(0, 'rgba(110,255,215,0.3)'); gg.addColorStop(1, 'rgba(110,255,215,0)');
        c.fillStyle = gg; c.fillRect(fx - 18, fy - 26, 52, 52);
        c.fillStyle = '#1e3a36'; c.beginPath(); c.ellipse(fx + 8, fy, 13 - k * 2, 4, 0, Math.PI, 0); c.fill();
        c.strokeStyle = '#7af0d0'; c.lineWidth = 1.5; c.beginPath(); c.ellipse(fx + 8, fy, 13 - k * 2, 4, 0, Math.PI * 1.05, Math.PI * 1.95); c.stroke();
      }
    }
    // 蔦
    c.strokeStyle = 'rgba(40,70,50,0.8)'; c.lineWidth = 1.2;
    c.beginPath(); c.moveTo(L[9][0] + 6, L[9][1]);
    for (let i = 8; i >= 3; i--) c.quadraticCurveTo(L[i][0] + 14 + (i % 2) * 10, L[i][1] + 6, L[i][0] + 8 + ((i + 1) % 2) * 12, L[i][1]);
    c.stroke();
  }
  function r4NearA(c, w, h) {
    const r = U.srand(4307);
    // 根元の羊歯と若木
    c.fillStyle = '#0a1210';
    for (let i = 0; i < 20; i++) {
      const x = r() * w, hh = 10 + r() * 22;
      c.beginPath(); c.moveTo(x - 10, h); c.quadraticCurveTo(x - 6, h - hh, x, h - hh - 4); c.quadraticCurveTo(x + 6, h - hh, x + 10, h); c.fill();
    }
    for (const [x, tw, gf, ho] of [[150, 118, true, true], [620, 150, true, false], [1050, 108, false, true]]) nearTrunk(c, x, tw, r, gf, ho);
    // 頭上から垂れる苔
    c.strokeStyle = 'rgba(110,140,124,0.35)'; c.lineWidth = 1;
    for (let i = 0; i < 40; i++) { const x = r() * w, L = 12 + r() * 50; c.beginPath(); c.moveTo(x, -2); c.quadraticCurveTo(x + 3, L * 0.5, x - 1, L); c.stroke(); }
  }
  function cocoon(c, x, y, L, r) {
    c.strokeStyle = 'rgba(210,210,196,0.4)'; c.lineWidth = 1; c.beginPath(); c.moveTo(x, y); c.lineTo(x, y + L); c.stroke();
    const cy = y + L + 12;
    const gg = c.createRadialGradient(x, cy, 0, x, cy, 24);
    gg.addColorStop(0, 'rgba(225,255,236,0.22)'); gg.addColorStop(1, 'rgba(225,255,236,0)');
    c.fillStyle = gg; c.fillRect(x - 24, cy - 24, 48, 48);
    c.fillStyle = '#bab4a2'; c.beginPath(); c.ellipse(x, cy, 6.5, 13, 0, 0, TAU); c.fill();
    c.strokeStyle = '#6e6a5c'; c.lineWidth = 0.8; c.beginPath();
    for (let k = -8; k <= 8; k += 4) { c.moveTo(x - 6, cy + k); c.quadraticCurveTo(x, cy + k + 3, x + 6, cy + k - 1); }
    c.stroke();
    if (r() < 0.3) { // 下が裂けた繭（中から何かが這い出た跡）
      c.fillStyle = '#16140f'; c.beginPath(); c.ellipse(x, cy + 10, 4, 3.2, 0, 0, TAU); c.fill();
      c.strokeStyle = 'rgba(186,180,162,0.7)'; c.lineWidth = 0.8; c.beginPath();
      c.moveTo(x - 3, cy + 12); c.lineTo(x - 4, cy + 17); c.moveTo(x + 2, cy + 12); c.lineTo(x + 3, cy + 16); c.stroke();
    }
  }
  function r4NearB(c, w, h) {
    const r = U.srand(4409);
    // 奥の池
    c.fillStyle = '#081418';
    c.beginPath(); c.moveTo(0, h); c.lineTo(0, 184);
    for (let x = 0; x <= w; x += 40) c.lineTo(x, 176 + Math.sin(x * 0.02) * 4 + r() * 3);
    c.lineTo(w, h); c.closePath(); c.fill();
    c.fillStyle = 'rgba(120,170,176,0.25)';
    for (let i = 0; i < 26; i++) c.fillRect(20 + r() * (w - 60), 184 + r() * 22, 10 + r() * 40, 1);
    // 岸の石と葦
    c.fillStyle = '#16211f';
    for (const x of [300, 690, 960]) {
      c.beginPath(); c.moveTo(x - 20, h); c.lineTo(x - 16, h - 30 - r() * 20); c.lineTo(x + 4, h - 46 - r() * 10); c.lineTo(x + 18, h - 24); c.lineTo(x + 22, h); c.closePath(); c.fill();
      c.fillStyle = 'rgba(31,58,42,0.7)'; c.beginPath(); c.ellipse(x, h - 34, 12, 5, 0.2, 0, TAU); c.fill(); c.fillStyle = '#16211f';
    }
    c.strokeStyle = '#08100e'; c.lineWidth = 1.5;
    for (let i = 0; i < 50; i++) { const x = r() * w, hh = 10 + r() * 26; c.beginPath(); c.moveTo(x, h); c.quadraticCurveTo(x + 2, h - hh * 0.6, x + (r() - 0.5) * 8, h - hh); c.stroke(); }
    // 両端の巨木
    nearTrunk(c, 1250, 104, U.srand(4417), true, false);
    nearTrunk(c, -50, 104, U.srand(4417), true, false);
    // 頭上を渡る大枝（両端の巨木から垂れ下がるように）と、無数の繭
    const bough = (x0, y0, cx, cy, x1, y1, wa, wb) => {
      const N = 30, top = [], bot = [];
      for (let i = 0; i <= N; i++) {
        const k = i / N, x = (1 - k) * (1 - k) * x0 + 2 * (1 - k) * k * cx + k * k * x1, y = (1 - k) * (1 - k) * y0 + 2 * (1 - k) * k * cy + k * k * y1;
        const ww = (wb + (wa - wb) * Math.abs(1 - 2 * k)) * (1 + Math.sin(k * 23) * 0.12);
        top.push([x, y - ww / 2]); bot.push([x, y + ww / 2]);
      }
      c.fillStyle = '#070d0e';
      c.beginPath(); c.moveTo(top[0][0], top[0][1]);
      for (const p of top) c.lineTo(p[0], p[1]);
      for (let i = N; i >= 0; i--) c.lineTo(bot[i][0], bot[i][1]);
      c.closePath(); c.fill();
      c.strokeStyle = 'rgba(64,100,96,0.6)'; c.lineWidth = 1.6; c.beginPath();
      top.forEach((p, i) => { if (i) c.lineTo(p[0], p[1] + 1); else c.moveTo(p[0], p[1] + 1); }); c.stroke();
      return bot;
    };
    bough(w * 0.18, 40, w * 0.42, 6, w * 0.8, -16, 14, 6);
    const under = bough(-20, 14, w * 0.5, 112, w + 20, 14, 34, 13);
    c.strokeStyle = '#070d0e'; c.lineCap = 'round';
    for (let i = 0; i < 7; i++) {
      const p = under[3 + i * 4], s2 = i % 2 ? 1 : -1;
      c.lineWidth = 4; c.beginPath(); c.moveTo(p[0], p[1] - 4); c.quadraticCurveTo(p[0] + s2 * 18, p[1] + 6, p[0] + s2 * 30, p[1] + 18 + r() * 10); c.stroke();
    }
    c.lineCap = 'butt';
    for (let i = 1; i < 30; i += 2) {
      const p = under[i];
      if (r() < 0.8) cocoon(c, p[0] + (r() - 0.5) * 10, p[1] - 3, 8 + r() * 56, r);
    }
    c.strokeStyle = 'rgba(110,140,124,0.35)'; c.lineWidth = 1;
    for (let i = 0; i < 30; i++) { const x = r() * w, L = 10 + r() * 40; c.beginPath(); c.moveTo(x, 40); c.lineTo(x + (r() - 0.5) * 6, 40 + L); c.stroke(); }
  }
  function r4Floor(c, w, h) {
    const r = U.srand(4501);
    const g = c.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#0b1613'); g.addColorStop(1, '#1b2b21');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
    for (let i = 0; i < 60; i++) {
      const y = r() * h, sc = 0.5 + y / h;
      c.fillStyle = `rgba(${r() < 0.5 ? '34,62,40' : '16,30,22'},${(0.35 + r() * 0.3).toFixed(2)})`;
      c.beginPath(); c.ellipse(r() * w, y, (10 + r() * 30) * sc, (2 + r() * 5) * sc, 0, 0, TAU); c.fill();
    }
    const lc = ['#2e2616', '#3a2e1a', '#22301c', '#40341c'];
    for (let i = 0; i < 260; i++) {
      const y = r() * h, sc = 0.4 + y / h;
      c.fillStyle = lc[(r() * 4) | 0];
      c.beginPath(); c.ellipse(r() * w, y, 2.5 * sc, 1.2 * sc, r() * 3, 0, TAU); c.fill();
    }
    // 床を這う根
    c.lineCap = 'round';
    for (let i = 0; i < 9; i++) {
      const y0 = r() * h, x0 = r() * w, sc = 0.5 + y0 / h, lw = (3 + r() * 4) * sc;
      const x1 = x0 + (80 + r() * 160) * (r() < 0.5 ? -1 : 1), y1 = y0 + (r() - 0.5) * 30;
      c.strokeStyle = '#0a110e'; c.lineWidth = lw; c.beginPath(); c.moveTo(x0, y0); c.quadraticCurveTo((x0 + x1) / 2, y0 - 12 * sc, x1, y1); c.stroke();
      c.strokeStyle = 'rgba(70,96,86,0.35)'; c.lineWidth = 1; c.beginPath(); c.moveTo(x0, y0 - lw * 0.4); c.quadraticCurveTo((x0 + x1) / 2, y0 - 12 * sc - lw * 0.4, x1, y1 - lw * 0.4); c.stroke();
    }
    c.lineCap = 'butt';
    // 小さな光る茸
    for (let i = 0; i < 12; i++) {
      const x = 20 + r() * (w - 40), y = 10 + r() * (h - 20), sc = 0.5 + y / h;
      const gg = c.createRadialGradient(x, y - 3 * sc, 0, x, y - 3 * sc, 10 * sc);
      gg.addColorStop(0, 'rgba(110,255,215,0.35)'); gg.addColorStop(1, 'rgba(110,255,215,0)');
      c.fillStyle = gg; c.fillRect(x - 10 * sc, y - 13 * sc, 20 * sc, 20 * sc);
      c.fillStyle = '#6af0d0'; c.beginPath(); c.ellipse(x, y - 3 * sc, 2.4 * sc, 1.3 * sc, 0, Math.PI, 0); c.fill();
      c.fillStyle = '#8ab8a8'; c.fillRect(x - 0.5, y - 3 * sc, 1, 3 * sc);
    }
    topShade(c, w, 36, 0.55);
  }
  function r4Ruin(c, w, h) {
    const r = U.srand(4601), st = '#22322f', dk = '#172321', hi = '#3a4e4a';
    // 崩れた石のアーチ
    c.fillStyle = st;
    c.fillRect(40, 40, 34, h - 40); c.fillRect(196, 80, 34, h - 80);
    c.beginPath(); c.moveTo(40, 52); c.quadraticCurveTo(134, -14, 214, 30); c.lineTo(206, 46); c.quadraticCurveTo(134, 8, 74, 64); c.closePath(); c.fill();
    c.fillStyle = dk;
    for (let y = 48, i = 0; y < h; y += 16, i++) {
      const jx = i % 2 ? 14 : 22;
      c.fillRect(40, y, 34, 1.5); c.fillRect(40 + jx, y, 1.5, 16);
      if (y > 86) { c.fillRect(196, y, 34, 1.5); c.fillRect(196 + jx, y, 1.5, 16); }
    }
    c.fillStyle = hi; c.fillRect(40, 40, 2, h - 40); c.fillRect(196, 80, 2, h - 80);
    // 崩れた上端
    c.fillStyle = st; c.beginPath(); c.moveTo(196, 80); c.lineTo(204, 66); c.lineTo(214, 74); c.lineTo(224, 62); c.lineTo(230, 80); c.closePath(); c.fill();
    // 倒れた石
    c.fillStyle = dk; c.beginPath(); c.moveTo(100, h); c.lineTo(108, h - 22); c.lineTo(168, h - 28); c.lineTo(176, h); c.closePath(); c.fill();
    // 光る紋様の立石
    c.fillStyle = st; c.beginPath(); c.moveTo(250, h); c.lineTo(252, h - 60); c.lineTo(266, h - 70); c.lineTo(282, h - 58); c.lineTo(284, h); c.closePath(); c.fill();
    const gg = c.createRadialGradient(267, h - 38, 0, 267, h - 38, 30);
    gg.addColorStop(0, 'rgba(110,255,215,0.3)'); gg.addColorStop(1, 'rgba(110,255,215,0)');
    c.fillStyle = gg; c.fillRect(237, h - 68, 60, 60);
    c.strokeStyle = '#7af0d0'; c.lineWidth = 1.4; c.beginPath();
    c.arc(267, h - 46, 6, 0, TAU); c.moveTo(269, h - 46); c.arc(267, h - 46, 2, 0, TAU);
    c.moveTo(260, h - 31); c.quadraticCurveTo(267, h - 38, 274, h - 31); c.quadraticCurveTo(267, h - 24, 260, h - 31);
    c.moveTo(267, h - 21); c.lineTo(267, h - 12);
    c.stroke();
    // 苔と蔦
    for (let i = 0; i < 26; i++) { c.fillStyle = `rgba(40,76,54,${(0.4 + r() * 0.3).toFixed(2)})`; c.beginPath(); c.ellipse(40 + r() * 200, 20 + r() * (h - 20), 5 + r() * 9, 2 + r() * 3, 0, 0, TAU); c.fill(); }
    c.strokeStyle = 'rgba(40,70,50,0.8)'; c.lineWidth = 1;
    for (let i = 0; i < 8; i++) { const x = 50 + r() * 170; c.beginPath(); c.moveTo(x, 30 + r() * 20); c.quadraticCurveTo(x + 6, 70, x - 2, 90 + r() * 40); c.stroke(); }
  }
  function r4Seam(c, w, h) { nearTrunk(c, w / 2, 124, U.srand(4701), true, false); }
  function r4Fern(c, w, h) {
    const r = U.srand(4801);
    c.lineCap = 'round';
    for (const [x0, n] of [[70, 7], [300, 5]]) {
      for (let k = 0; k < n; k++) {
        const a = -Math.PI / 2 + (k - (n - 1) / 2) * 0.32 + (r() - 0.5) * 0.15, L = 34 + r() * 18;
        const ex = x0 + Math.cos(a) * L * 1.2, ey = h + Math.sin(a) * L;
        c.strokeStyle = '#040806'; c.lineWidth = 2.2;
        c.beginPath(); c.moveTo(x0, h); c.quadraticCurveTo(x0 + Math.cos(a) * L * 0.5, h + Math.sin(a) * L * 0.9, ex, ey); c.stroke();
        c.lineWidth = 1.6;
        c.beginPath();
        for (let j = 1; j < 9; j++) {
          const t = j / 9, px = x0 + (ex - x0) * t, py = h + (ey - h) * t - Math.sin(t * Math.PI) * 6, ll = (1 - t) * 11 + 3;
          c.moveTo(px, py); c.lineTo(px - ll * 0.7, py - ll * 0.5); c.moveTo(px, py); c.lineTo(px + ll * 0.7, py - ll * 0.3);
        }
        c.stroke();
      }
      c.fillStyle = '#040806'; c.beginPath(); c.ellipse(x0, h, 26, 8, 0, Math.PI, 0); c.fill();
    }
    c.lineCap = 'butt';
  }
  function r4Mushrooms(c, t) {
    const W = BK.W, cam = BK.cam.x, gcv = gl('cyan');
    for (let k = Math.floor((cam - 240) / 430); ; k++) {
      const sx = 180 + k * 430 - cam;
      if (sx > W + 60) break;
      if (sx < -60) continue;
      const pulse = 0.5 + Math.sin(t * 0.05 + k * 1.7) * 0.2;
      glow(c, gcv, sx, 200, 46, pulse * 0.8, 24);
      for (let i = 0; i < 3; i++) {
        const mx = sx - 10 + i * 9 + ((k * 7 + i * 3) % 5), hh = 7 + ((k + i * 2) % 3) * 4, cr = 3.5 + ((k + i) % 3);
        c.fillStyle = '#9ad8c4'; c.fillRect(mx - 0.8, 206 - hh, 1.6, hh);
        c.fillStyle = '#5ef0cc'; c.beginPath(); c.ellipse(mx, 206 - hh, cr, cr * 0.55, 0, Math.PI, 0); c.fill();
        c.fillStyle = '#d8fff4'; c.fillRect(mx - 1, 206 - hh - cr * 0.3, 1.2, 1.2);
      }
    }
  }
  function r4Fairies(c, lights, t, f, span, sc) {
    const W = BK.W, cam = BK.cam.x;
    for (const l of lights) {
      let x = ((l.x - cam * f + t * l.dx) % span + span) % span - 80;
      if (x > W + 60) continue;
      x += Math.sin(t * l.fx + l.ph) * 18;
      const y = l.y + Math.sin(t * l.fy + l.ph * 2) * 12;
      const tw = 0.55 + Math.sin(t * 0.13 + l.ph * 3) * 0.3;
      glow(c, gl(l.col), x, y, l.r * sc, tw);
      c.fillStyle = '#fffbe8'; c.globalAlpha = Math.min(1, tw + 0.3); c.fillRect(x - sc, y - sc, sc * 2, sc * 2); c.globalAlpha = 1;
    }
  }
  function r4Lights(seed, n, y0, y1) {
    const r = U.srand(seed), out = [], cols = ['fy', 'fy', 'fp', 'fg'];
    for (let i = 0; i < n; i++) out.push({ x: r() * 1400, y: y0 + r() * (y1 - y0), dx: (r() - 0.5) * 0.4, fx: 0.01 + r() * 0.02, fy: 0.02 + r() * 0.03, ph: r() * 6, r: 7 + r() * 6, col: cols[(r() * 4) | 0] });
    return out;
  }
  function r4Layers() {
    return {
      sky: BG.layer('s4sky', 1000, 212, r4Sky), mid: BG.layer('s4mid', 1200, 212, r4Mid),
      nearA: BG.layer('s4nearA', 1300, 214, r4NearA), nearB: BG.layer('s4nearB', 1300, 214, r4NearB),
      floor: BG.layer('s4floor', 1024, BK.H - FLOOR_Y, r4Floor), ruin: BG.layer('s4ruin', 300, 176, r4Ruin),
      seam: BG.layer('s4seam', 360, 214, r4Seam), fern: BG.layer('s4fern', 420, 60, r4Fern),
    };
  }

  BK.stages[3] = {
    id: 4, name: '霧の森', sub: '妖精の棲む霧の森', len: 3600,
    bgm: 'stage4', bossBgm: 'boss', heal: 0.3,
    intro: '霧に閉ざされた古の森。揺れる妖精の灯は、人を誘う罠。\n木々の奥で蛾の翅がさざめき、幼い笑い声がこだまする。',
    props: [
      { x: 360, y: 30, type: 'urn' }, { x: 420, y: 96, type: 'urn', item: 'bread' },
      { x: 1000, y: 70, type: 'grave', item: 'silver' },
      { x: 1480, y: 24, type: 'urn', item: 'spear' }, { x: 1540, y: 100, type: 'grave', item: 'meat' },
      { x: 2150, y: 60, type: 'barrel', item: 'bowgun' },
      { x: 2800, y: 30, type: 'urn', item: 'firepot' },
      // ロシーヌの手前（ボス戦の画面内に入る位置）
      { x: 3090, y: 26, type: 'urn', item: 'dust' }, { x: 3150, y: 100, type: 'grave', item: 'wine' },
    ],
    events: [
      { at: 140, waves: [
        [{ t: 'moth', side: 'R', y: 40 }, { t: 'moth', side: 'R', y: 90, delay: 30 }, { t: 'spirit', side: 'L', y: 60, delay: 50 }],
        [{ t: 'leaper', side: 'R', y: 60 }, { t: 'moth', side: 'L', y: 30, delay: 30 }, { t: 'moth', side: 'R', y: 100, delay: 50 }]] },
      { at: 700, waves: [
        [{ t: 'moth', side: 'R', y: 20 }, { t: 'moth', side: 'R', y: 60, delay: 20 }, { t: 'moth', side: 'L', y: 100, delay: 40 }, { t: 'spirit', side: 'R', y: 80, delay: 60 }],
        [{ t: 'troll', side: 'R', y: 50 }, { t: 'moth', side: 'L', y: 30, delay: 40 }]], next: 1 },
      { at: 1300, waves: [
        [{ t: 'leaper', side: 'R', y: 30 }, { t: 'leaper', side: 'L', y: 90, delay: 30 }, { t: 'moth', x: 380, y: 60, screen: true, entry: 'drop' }],
        [{ t: 'moth', side: 'R', y: 40 }, { t: 'moth', side: 'R', y: 100, delay: 20 }, { t: 'spirit', side: 'L', y: 50 }, { t: 'spirit', side: 'R', y: 70, delay: 40 }],
        [{ t: 'leaper', x: 300, y: 50, screen: true, entry: 'drop' }, { t: 'leaper', side: 'R', y: 90, delay: 30 }]], next: 1 },
      { at: 1950, waves: [
        [{ t: 'troll', side: 'R', y: 40 }, { t: 'moth', side: 'L', y: 90 }, { t: 'moth', side: 'R', y: 20, delay: 40 }],
        [{ t: 'leaper', side: 'L', y: 30 }, { t: 'leaper', side: 'R', y: 60 }, { t: 'moth', side: 'R', y: 100, delay: 30 }, { t: 'spirit', side: 'R', y: 40, delay: 60 }]], next: 1 },
      { at: 2500, waves: [
        [{ t: 'moth', side: 'R', y: 20 }, { t: 'moth', side: 'R', y: 55, delay: 15 }, { t: 'moth', side: 'L', y: 90, delay: 30 }, { t: 'moth', side: 'R', y: 110, delay: 45 }, { t: 'moth', side: 'L', y: 40, delay: 60 }],
        [{ t: 'troll', side: 'L', y: 70 }, { t: 'leaper', side: 'R', y: 30 }, { t: 'spirit', side: 'R', y: 90, delay: 40 }]], next: 2 },
      { at: 3000, boss: 'rosine', x: 470, y: 60, waves: [] },
    ],
    init(g) {
      g.s4 = { back: r4Lights(4901, 18, 50, 196), front: r4Lights(4903, 5, 40, 300) };
      r4Layers(); ['cyan', 'fy', 'fp', 'fg'].forEach(gl);
    },
    drawBg(c, g) {
      const t = g.time, W = BK.W, cam = BK.cam.x, L = r4Layers();
      if (!g.s4) this.init(g);
      BG.tile(c, L.sky, 0.1, 0);
      BG.fog(c, t * 0.8, '#7e9ea2', 0.1, 126);
      BG.tile(c, L.mid, 0.35, 0);
      const rx = RUIN_P - cam * 0.5;
      if (rx > -320 && rx < W + 20) spr(c, L.ruin, rx, FT - 176);
      BG.fog(c, t + 400, '#6a8c90', 0.09, 160);
      BG.tile(c, L.floor, 1, FLOOR_Y);
      // 近景（巨木の根元 → 繭の垂れる空き地。継ぎ目は巨木で隠す）。根は床の奥の縁にかぶる
      const sn = seamX(CX4, 0.7);
      dualTile(c, sn, L.nearA, 0, L.nearB, 0, 0.7);
      if (sn > -200 && sn < W + 200) spr(c, L.seam, sn - 180, 0);
      if (sn < W) {
        // 池のきらめき
        const x0 = Math.max(0, sn + 60);
        c.fillStyle = 'rgba(190,230,230,0.35)';
        for (let k = 0; k < 7; k++) {
          const x = x0 + ((k * 137 + t * 0.4) % Math.max(1, W - x0)), y = 184 + (k * 5) % 12;
          c.fillRect(x, y, 6 + Math.sin(t * 0.06 + k) * 4, 1);
        }
      }
      r4Mushrooms(c, t);
      r4Fairies(c, g.s4.back, t, 0.85, 1400, 1);
    },
    drawFg(c, g) {
      const t = g.time, H = BK.H;
      if (!g.s4) this.init(g);
      BG.tile(c, BG.layer('s4fern', 420, 60, r4Fern), 1.3, H - 60);
      BG.fog(c, t, '#a8c4c4', 0.08, H - 72);
      r4Fairies(c, g.s4.front, t, 1.25, 1600, 1.9);
      BG.vignette(c, 0.6);
    },
  };
})(window.BK);

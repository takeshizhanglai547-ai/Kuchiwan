'use strict';
/* =====================================================================
 *  stage_1.js ── ROUND 1「黒い剣士」 紅い月の城下町
 *  （AvP ラウンド1「City of Despair」に相当: 燃える街路での市街戦 → 最初のボス）
 * ===================================================================== */
(function (BK) {
  const U = BK.U, BG = BK.bg, R = BK.rig;

  // ---- 遠景: 丘の上の城
  function drawCastle(c, w, h) {
    const r = U.srand(11);
    c.fillStyle = '#2a0c10';
    c.beginPath(); c.moveTo(0, h);
    for (let x = 0; x <= w; x += 20) c.lineTo(x, h - 40 - Math.sin(x / w * Math.PI * 2) * 18 - r() * 8);
    c.lineTo(w, h); c.closePath(); c.fill();
    // 城
    const cx = w * 0.62, base = h - 64;
    c.fillStyle = '#1e070b';
    c.fillRect(cx - 70, base - 40, 140, 44);
    [[-70, 70, 12], [-30, 95, 16], [10, 120, 18], [50, 80, 12]].forEach(([dx, th, tw]) => {
      c.fillRect(cx + dx, base - th, tw, th);
      c.beginPath(); c.moveTo(cx + dx - 3, base - th); c.lineTo(cx + dx + tw / 2, base - th - tw * 1.8); c.lineTo(cx + dx + tw + 3, base - th); c.fill();
    });
    for (let i = 0; i < 9; i++) { c.fillStyle = r() < 0.5 ? '#ff8a3a' : '#7a2010'; c.fillRect(cx - 60 + r() * 120, base - 20 - r() * 70, 2, 3); }
  }
  // ---- 中景: 切妻屋根の町並み（窓の灯り）
  function drawTown(c, w, h) {
    const r = U.srand(23);
    let x = 0;
    while (x < w) {
      const bw = 50 + r() * 60, bh = 70 + r() * 70;
      const y = h - bh;
      c.fillStyle = r() < 0.5 ? '#170a0c' : '#1d0c0e';
      c.fillRect(x, y, bw, bh);
      c.beginPath(); c.moveTo(x - 6, y); c.lineTo(x + bw / 2, y - 26 - r() * 24); c.lineTo(x + bw + 6, y); c.closePath(); c.fill();
      if (r() < 0.35) { c.fillRect(x + bw * 0.7, y - 30, 8, 22); }
      // 窓
      for (let wy = y + 12; wy < h - 20; wy += 22) {
        for (let wx = x + 8; wx < x + bw - 12; wx += 18) {
          if (r() < 0.3) { c.fillStyle = r() < 0.6 ? '#ff9a3c' : '#c2451c'; c.fillRect(wx, wy, 6, 9); }
        }
      }
      x += bw + 4 + r() * 10;
    }
    // 教会の尖塔
    c.fillStyle = '#150709';
    const sx = w * 0.3;
    c.fillRect(sx, h - 170, 26, 170);
    c.beginPath(); c.moveTo(sx - 4, h - 170); c.lineTo(sx + 13, h - 235); c.lineTo(sx + 30, h - 170); c.fill();
    c.fillStyle = '#ff9a3c'; c.beginPath(); c.arc(sx + 13, h - 140, 5, Math.PI, 0); c.fillRect(sx + 8, h - 140, 10, 8); c.fill();
  }
  // ---- 近景: 通り沿いの石壁・扉・絞首台
  function drawStreet(c, w, h) {
    const r = U.srand(37);
    c.fillStyle = '#251618'; c.fillRect(0, 0, w, h);
    // 石積み
    c.strokeStyle = 'rgba(0,0,0,0.5)'; c.lineWidth = 1;
    for (let y = 0; y < h; y += 12) {
      c.beginPath(); c.moveTo(0, y); c.lineTo(w, y); c.stroke();
      for (let x = (y / 12) % 2 ? 0 : 14; x < w; x += 28) { c.beginPath(); c.moveTo(x, y); c.lineTo(x, y + 12); c.stroke(); }
    }
    for (let i = 0; i < 70; i++) { c.fillStyle = `rgba(${r() < 0.5 ? '60,40,40' : '20,10,10'},0.35)`; c.fillRect(r() * w, r() * h, 10 + r() * 16, 5 + r() * 6); }
    // 木骨造りの家の壁面
    for (let i = 0; i < 4; i++) {
      const x = i * (w / 4) + 30 + r() * 40;
      c.fillStyle = '#2e1c16'; c.fillRect(x, 10, 120, h - 10);
      c.strokeStyle = '#140a08'; c.lineWidth = 5;
      c.strokeRect(x, 10, 120, h - 10);
      c.beginPath(); c.moveTo(x, 10); c.lineTo(x + 120, h); c.moveTo(x + 120, 10); c.lineTo(x, h); c.stroke();
      // 扉
      c.fillStyle = '#1a0e08'; c.fillRect(x + 44, h - 58, 32, 58);
      c.fillStyle = '#3a2412'; c.fillRect(x + 47, h - 55, 26, 55);
      // 灯りの窓
      c.fillStyle = '#ff9a3c'; c.fillRect(x + 12, 30, 16, 20); c.fillRect(x + 92, 30, 16, 20);
      c.fillStyle = '#140a08'; c.fillRect(x + 19, 30, 2, 20); c.fillRect(x + 99, 30, 2, 20);
    }
  }
  function drawGallows(c, x, y) {
    c.strokeStyle = '#0c0606'; c.lineWidth = 5;
    c.beginPath(); c.moveTo(x, y); c.lineTo(x, y - 120); c.lineTo(x + 56, y - 120); c.stroke();
    c.lineWidth = 3; c.beginPath(); c.moveTo(x, y - 96); c.lineTo(x + 24, y - 120); c.stroke();
    c.lineWidth = 1.2; c.beginPath(); c.moveTo(x + 48, y - 120); c.lineTo(x + 48, y - 92); c.stroke();
    // 吊るされた亡骸（シルエット）
    c.fillStyle = '#0c0606';
    c.beginPath(); c.arc(x + 48, y - 88, 5, 0, 7); c.fill();
    c.fillRect(x + 44, y - 84, 8, 26); c.fillRect(x + 44, y - 58, 3, 20); c.fillRect(x + 49, y - 58, 3, 20);
  }

  BK.stages[0] = {
    id: 1, name: '黒い剣士', sub: '紅い月の城下町', len: 3700,
    bgm: 'stage1', bossBgm: 'boss',
    intro: '紅い月の夜。烙印が疼き、亡者が這い出す。\n使徒を狩る黒い剣士の噂は、この城下町にも届いていた。',
    props: [
      { x: 330, y: 30, type: 'barrel' }, { x: 380, y: 96, type: 'crate', item: 'meat' },
      { x: 1050, y: 20, type: 'barrel', item: 'bowgun' }, { x: 1500, y: 90, type: 'crate' }, { x: 1540, y: 70, type: 'barrel' },
      { x: 2250, y: 40, type: 'barrel', item: 'roast' }, { x: 2800, y: 100, type: 'crate', item: 'bombs' }, { x: 3060, y: 20, type: 'barrel', item: 'behelit' },
    ],
    events: [
      { at: 120, waves: [[{ t: 'undead', side: 'R', y: 40 }, { t: 'undead', side: 'R', y: 90, off: 40 }], [{ t: 'undead', side: 'R', y: 20 }, { t: 'undead', side: 'L', y: 80 }]] },
      { at: 620, waves: [[{ t: 'undead', x: 420, y: 70, entry: 'rise', screen: true }, { t: 'undead', x: 520, y: 30, entry: 'rise', screen: true, delay: 20 }, { t: 'undead', side: 'R', y: 100, palette: 'bone' }],
        [{ t: 'spirit', side: 'R', y: 50 }, { t: 'spirit', side: 'L', y: 30, delay: 30 }]] },
      { at: 1150, waves: [[{ t: 'soldier', side: 'R', y: 30 }, { t: 'soldier', side: 'R', y: 90, off: 30 }, { t: 'undead', side: 'L', y: 60 }],
        [{ t: 'soldier', side: 'R', y: 60, palette: 'captain' }, { t: 'crossbow', side: 'R', y: 20, off: 60 }, { t: 'undead', x: 300, y: 90, entry: 'rise', screen: true }]], next: 1 },
      { at: 1750, waves: [[{ t: 'undead', side: 'R', y: 20 }, { t: 'undead', side: 'R', y: 60, off: 30, palette: 'bone' }, { t: 'undead', side: 'L', y: 100 }, { t: 'spirit', side: 'R', y: 40, delay: 60 }],
        [{ t: 'hound', side: 'R', y: 50 }, { t: 'hound', side: 'L', y: 80, delay: 40 }], [{ t: 'soldier', side: 'R', y: 30 }, { t: 'undead', side: 'R', y: 90, palette: 'blood' }, { t: 'crossbow', side: 'L', y: 60 }]], next: 1 },
      { at: 2400, waves: [[{ t: 'spirit', side: 'R', y: 30 }, { t: 'spirit', side: 'R', y: 90, delay: 20 }, { t: 'spirit', side: 'L', y: 60, delay: 40 }, { t: 'undead', x: 380, y: 60, entry: 'rise', screen: true }],
        [{ t: 'soldier', side: 'R', y: 60, palette: 'captain' }, { t: 'soldier', side: 'L', y: 30 }, { t: 'undead', side: 'R', y: 100, palette: 'bone' }]], next: 1 },
      { at: 3080, boss: 'snakeBaron', x: 470, y: 60, waves: [] },
    ],
    drawBg(c, g) {
      const t = g.time;
      BG.sky(c, [[0, '#050203'], [0.55, '#2a0508'], [1, '#6a1410']], 0, BK.FLOOR_TOP);
      // 紅い月
      const mx = BK.W * 0.72 - BK.cam.x * 0.02, my = 70;
      const glow = c.createRadialGradient(mx, my, 20, mx, my, 150);
      glow.addColorStop(0, 'rgba(255,60,30,0.45)'); glow.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = glow; c.fillRect(mx - 150, my - 150, 300, 300);
      c.fillStyle = '#c8261a'; c.beginPath(); c.arc(mx, my, 38, 0, 7); c.fill();
      c.fillStyle = 'rgba(90,10,8,0.5)'; c.beginPath(); c.arc(mx + 8, my - 6, 30, 0, 7); c.fill();
      // 雲
      c.fillStyle = 'rgba(10,2,4,0.6)';
      for (let i = 0; i < 4; i++) { const x = ((i * 240 - BK.cam.x * 0.05 - t * 0.1) % (BK.W + 300)) + BK.W + 150 - (BK.W + 300); c.beginPath(); c.ellipse(x, 60 + i * 18, 120, 10, 0, 0, 7); c.fill(); }
      BG.tile(c, BG.layer('s1castle', 900, 180, drawCastle), 0.08, BK.FLOOR_TOP - 180 + 6);
      BG.tile(c, BG.layer('s1town', 1100, 200, drawTown), 0.3, BK.FLOOR_TOP - 200 + 4);
      // 近景の壁
      BG.tile(c, BG.layer('s1street', 960, 100, drawStreet), 0.75, BK.FLOOR_TOP - 100 - 8);
      // 絞首台（通りのところどころ）
      for (let gx = 700; gx < 3600; gx += 1300) { const sx = gx - BK.cam.x * 0.75; if (sx > -80 && sx < BK.W + 20) drawGallows(c, sx, BK.FLOOR_TOP - 8); }
      BG.cobbles(c, { far: '#1e1414', near: '#3a2a26' });
      // 松明の灯りだまり
      for (let tx = 200; tx < 3700; tx += 520) {
        const sx = tx - BK.cam.x;
        if (sx < -80 || sx > BK.W + 80) continue;
        const fl = 0.8 + Math.sin(t * 0.3 + tx) * 0.1 + Math.random() * 0.08;
        const lg = c.createRadialGradient(sx, BK.FLOOR_TOP - 40, 4, sx, BK.FLOOR_TOP - 20, 110 * fl);
        lg.addColorStop(0, 'rgba(255,140,60,0.35)'); lg.addColorStop(1, 'rgba(0,0,0,0)');
        c.fillStyle = lg; c.fillRect(sx - 120, BK.FLOOR_TOP - 150, 240, 250);
        c.fillStyle = '#2a1a10'; c.fillRect(sx - 2, BK.FLOOR_TOP - 70, 4, 60);
        c.fillStyle = '#ffb04a'; c.beginPath(); c.moveTo(sx - 5, BK.FLOOR_TOP - 70); c.quadraticCurveTo(sx, BK.FLOOR_TOP - 92 * fl, sx + 5, BK.FLOOR_TOP - 70); c.fill();
        if (t % 6 === 0) BK.fx.ember(tx + U.rand(-4, 4), -4, 70);
      }
    },
    drawFg(c, g) {
      BG.fog(c, g.time, '#6a2a2e', 0.12, BK.H - 60);
      // 前景の杭（手前を横切る）
      for (let px = 400; px < 3700; px += 700) {
        const sx = px - BK.cam.x * 1.25;
        if (sx < -30 || sx > BK.W + 30) continue;
        c.fillStyle = '#0a0506'; c.fillRect(sx, BK.H - 90, 12, 90);
        c.beginPath(); c.moveTo(sx - 2, BK.H - 90); c.lineTo(sx + 6, BK.H - 104); c.lineTo(sx + 14, BK.H - 90); c.fill();
      }
      BG.vignette(c, 0.55);
    },
  };
})(window.BK);

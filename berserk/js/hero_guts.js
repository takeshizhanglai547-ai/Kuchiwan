'use strict';
/* =====================================================================
 *  hero_guts.js ── ガッツ（黒い剣士）
 *  パワー型。巨大な鉄塊「ドラゴンころし」の重い一撃と、義手に仕込んだ
 *  連射式ボウガン / 大砲。覚醒は「狂戦士の甲冑」。
 *  （AvP の Dutch Schaefer / Predator Warrior に相当するパワーキャラ）
 * ===================================================================== */
(function (BK) {
  const U = BK.U, R = BK.rig, D = U.DEG;

  // ------------------------------------------------------------ drawing
  function head(c, sp, col, sk, pose, opt) {
    const h = sk.headC, r = sp.headR;
    c.save();
    c.translate(h.x, h.y);
    c.rotate((180 - sk.ha) * D);
    if (opt && opt.awakened && !opt.tint) {
      // 狂戦士の甲冑: 狼を思わせる兜、赤く光る目
      R.poly(c, [-r * 1.05, r * 0.9, -r * 1.2, -r * 0.4, -r * 0.6, -r * 1.35, r * 0.5, -r * 1.2, r * 1.0, -r * 0.5, r * 1.65, r * 0.1, r * 1.5, r * 0.55, r * 0.7, r * 0.8, r * 0.1, r * 1.15], '#1c1b1f', 'rgba(0,0,0,0.9)');
      R.poly(c, [-r * 0.6, -r * 1.3, -r * 0.2, -r * 2.0, 0, -r * 1.1], '#1c1b1f'); // 耳のような突起
      R.poly(c, [r * 0.2, -r * 1.15, r * 0.55, -r * 1.8, r * 0.6, -r * 0.95], '#1c1b1f');
      c.strokeStyle = '#3a3a40'; c.lineWidth = 1;
      c.beginPath(); c.moveTo(r * 0.8, r * 0.35); c.lineTo(r * 1.5, r * 0.35); c.stroke(); // 牙のスリット
      const k = 0.7 + Math.sin(BK.frame * 0.4) * 0.3;
      c.fillStyle = `rgba(255,40,20,${k})`;
      c.beginPath(); c.ellipse(r * 0.75, -r * 0.2, r * 0.32, r * 0.13, -0.2, 0, 7); c.fill();
      c.restore();
      return;
    }
    R.circle(c, 0, 0, r, col('skin'), col('line'));
    R.poly(c, [r * 0.1, r * 0.55, r * 0.95, r * 0.25, r * 0.85, r * 0.9, -r * 0.1, r * 1.05], col('skin'));
    // 逆立った黒髪
    R.poly(c, [r * 0.95, -r * 0.25, r * 0.7, -r * 1.05, r * 0.35, -r * 0.8, r * 0.05, -r * 1.5, -r * 0.3, -r * 0.95, -r * 0.8, -r * 1.35,
      -r * 0.95, -r * 0.6, -r * 1.55, -r * 0.35, -r * 1.05, r * 0.05, -r * 1.3, r * 0.55, -r * 0.55, r * 0.45, -r * 0.2, -r * 0.1, r * 0.35, -r * 0.35], col('hair'));
    if (!opt || !opt.tint) {
      c.fillStyle = '#0a0808'; c.fillRect(r * 0.42, -r * 0.18, r * 0.42, r * 0.17);
      c.strokeStyle = 'rgba(110,50,40,0.9)'; c.lineWidth = 1;
      c.beginPath(); c.moveTo(r * 0.3, -r * 0.42); c.lineTo(r * 1.0, r * 0.12); c.stroke(); // 鼻の傷
    }
    c.restore();
  }
  function torso(c, sp, col, sk) {
    R.defaultDraw.torso(c, sp, col, sk);
    // 胸当ての縁
    const h = sk.hip, s = sk.sho;
    c.strokeStyle = col('armorHi'); c.lineWidth = 1.2;
    c.beginPath(); c.moveTo(U.lerp(h.x, s.x, 0.35) + 5, U.lerp(h.y, s.y, 0.35)); c.lineTo(U.lerp(h.x, s.x, 0.85) + 8, U.lerp(h.y, s.y, 0.85)); c.stroke();
  }
  function dragonslayer(c, sp, col, len) {
    R.poly(c, [-17, -2.2, 0, -2.2, 0, 2.2, -17, 2.2], col('grip'));
    c.fillStyle = col('metalDark'); c.fillRect(-21, -3.2, 4, 6.4);
    R.poly(c, [0, -7, 4, -7, 4, 7, 0, 7], col('metalDark'), col('line'));
    // 刃: 分厚く幅広く、切っ先は鈍い
    R.poly(c, [4, -5.8, len - 11, -5.8, len, -1.5, len, 2.5, len - 7, 5.8, 4, 5.8], col('metal'), col('line'));
    c.fillStyle = 'rgba(255,255,255,0.16)'; c.fillRect(7, -1.6, len - 20, 1.5);
    c.fillStyle = 'rgba(0,0,0,0.28)'; c.fillRect(7, 1.6, len - 18, 3);
    // 刃こぼれ
    c.fillStyle = 'rgba(0,0,0,0.5)';
    c.fillRect(len * 0.45, -5.8, 3, 1.4); c.fillRect(len * 0.7, 4.4, 4, 1.4);
  }
  function arm(c, sp, col, sh, el, hd, back, pose, opt) {
    R.defaultDraw.arm(c, sp, col, sh, el, hd, back);
    if (!back) return;
    // 義手（鉄の左腕）: ボウガン / 大砲
    const a = Math.atan2(hd.y - el.y, hd.x - el.x);
    if (pose.xbow || pose.cannon) {
      c.save(); c.translate(hd.x, hd.y); c.rotate(a);
      if (pose.cannon) {
        R.poly(c, [-2, -4.5, 16, -4.5, 16, 4.5, -2, 4.5], '#4a4744', col('line'));
        R.circle(c, 16, 0, 3.6, '#111');
      } else {
        c.fillStyle = '#3a2616'; c.fillRect(-2, -1.8, 16, 3.6);
        c.strokeStyle = '#8a8a8a'; c.lineWidth = 1.8;
        c.beginPath(); c.moveTo(12, -9); c.quadraticCurveTo(8, 0, 12, 9); c.stroke();
        c.fillStyle = '#6a6a6a'; c.fillRect(2, -4, 7, 3);
      }
      c.restore();
    }
  }
  function front(c, sp, col, sk) {
    // 肩当て
    const s = sk.shF;
    c.beginPath(); c.ellipse(s.x + 1, s.y + 2, 7.5, 6, -0.3, Math.PI, Math.PI * 2.05);
    c.lineTo(s.x - 6, s.y + 6); c.closePath();
    c.fillStyle = col('armor'); c.fill(); c.strokeStyle = col('line'); c.lineWidth = 1.1; c.stroke();
  }

  // ------------------------------------------------------------ moves
  const G = { grip: 1, wBack: 0 };
  const P = (o) => Object.assign({}, G, o);
  const moves = {
    atk1: {
      dur: 26, cancel: 14, trail: [6, 12],
      kf: [[0, {}], [5, P({ aF: 150, eF: 50, wAbs: 200, lean: -6, lF: 16, kF: 12, lB: -18, kB: 10, cape: 0.6 })],
        [9, P({ aF: 95, eF: 0, wAbs: 95, lean: 18, lF: 34, kF: 34, lB: -26, kB: 6, drop: 2, cape: 1 }), 'snap'],
        [13, P({ aF: 55, eF: 5, wAbs: 45, lean: 20, lF: 34, kF: 34, lB: -26, kB: 6, cape: 1.1 })], [26, {}]],
      hits: [{ f: [8, 11], x: [12, 96], z: [10, 100], d: 18, dmg: 10, kb: 'light', push: 2.6 }],
      move: [[0, 0], [6, 2.2], [11, 0.6], [14, 0]],
      sfx: [[6, 'swingHeavy']],
    },
    atk2: {
      dur: 26, cancel: 14, trail: [7, 13],
      kf: [[0, P({ aF: 55, eF: 5, wAbs: 45, lean: 18, lF: 30, kF: 30, lB: -24, kB: 6 })],
        [5, P({ aF: 20, eF: 10, wAbs: -20, lean: 10, lF: 20, kF: 20, lB: -20, kB: 8 })],
        [10, P({ aF: 120, eF: 20, wAbs: 150, lean: -4, lF: 26, kF: 18, lB: -22, kB: 8, cape: 1 }), 'snap'],
        [14, P({ aF: 140, eF: 30, wAbs: 190, lean: -8 })], [26, {}]],
      hits: [{ f: [8, 12], x: [10, 92], z: [20, 120], d: 18, dmg: 10, kb: 'light', push: 2.2 }],
      move: [[0, 0], [5, 2], [10, 0.4], [13, 0]],
      sfx: [[6, 'swingHeavy']],
    },
    atk3: {
      dur: 28, cancel: 16, trail: [7, 14],
      kf: [[0, P({ aF: 140, eF: 30, wAbs: 190, lean: -8 })],
        [6, P({ aF: 110, eF: 70, wAbs: 250, lean: -10, lF: 10, kF: 10, lB: -20, kB: 10 })],
        [11, P({ aF: 90, eF: 0, wAbs: 100, lean: 22, lF: 38, kF: 36, lB: -28, kB: 4, drop: 3, cape: 1.2 }), 'snap'],
        [15, P({ aF: 60, eF: 0, wAbs: 70, lean: 22, lF: 38, kF: 36, lB: -28, kB: 4, drop: 3 })], [28, {}]],
      hits: [{ f: [9, 12], x: [10, 100], z: [5, 115], d: 18, dmg: 12, kb: 'heavy', push: 3 }],
      move: [[0, 0], [5, 3], [11, 1], [14, 0]],
      sfx: [[7, 'swingHeavy']],
    },
    atk4: { // フィニッシュ: 叩きつけ
      dur: 42, trail: [9, 16],
      kf: [[0, P({ aF: 60, eF: 0, wAbs: 70, lean: 22 })],
        [10, P({ aF: 165, eF: 40, wAbs: 232, lean: -14, lF: 12, kF: 12, lB: -22, kB: 12, cape: 0.8 })],
        [15, P({ aF: 80, eF: 0, wAbs: 70, lean: 30, lF: 44, kF: 44, lB: -30, kB: 4, drop: 6, cape: 1.4 }), 'snap'],
        [26, P({ aF: 78, eF: 0, wAbs: 68, lean: 28, lF: 44, kF: 44, lB: -30, kB: 4, drop: 6 })], [42, {}]],
      hits: [{ f: [13, 16], x: [10, 110], z: [0, 115], d: 20, dmg: 20, kb: 'down', push: 5.5, lift: 5.5, stop: 8 }],
      move: [[0, 0], [8, 2.5], [15, 0]],
      sfx: [[10, 'swingHeavy']],
      onFrame(h, f) { if (f === 15) { BK.fx.shake(5, 10); BK.fx.dust(h.x + h.face * 80, h.y, 8); } },
    },
    dash: {
      dur: 32, trail: [2, 16],
      kf: [[0, P({ aF: 80, eF: 10, wAbs: 95, lean: 25, lF: 40, kF: 40, lB: -30, kB: 10 })],
        [6, P({ aF: 90, eF: 0, wAbs: 92, lean: 30, lF: 50, kF: 30, lB: -40, kB: 5, drop: 5, cape: 1.4 })],
        [20, P({ aF: 90, eF: 0, wAbs: 92, lean: 30, lF: 50, kF: 30, lB: -40, kB: 5, drop: 5, cape: 1.2 })], [32, {}]],
      hits: [{ f: [3, 16], x: [20, 104], z: [25, 85], d: 18, dmg: 15, kb: 'down', push: 6, lift: 4 }],
      move: [[0, 7], [10, 6], [16, 3], [22, 0]],
      sfx: [[1, 'swingHeavy']],
    },
    jumpAtk: {
      air: true, dur: 60, trail: [2, 11],
      kf: [[0, P({ aF: 150, eF: 40, wAbs: 200, lF: 50, kF: 90, lB: 0, kB: 80, lean: -5 })],
        [5, P({ aF: 100, eF: 0, wAbs: 100, lF: 60, kF: 90, lB: 10, kB: 90, lean: 15 }), 'snap'],
        [10, P({ aF: 40, eF: 0, wAbs: 20, lF: 60, kF: 90, lB: 10, kB: 90, lean: 20 })], [60, P({ aF: 40, eF: 0, wAbs: 20, lF: 40, kF: 60, lB: 0, kB: 50, lean: 10 })]],
      hits: [{ f: [3, 12], x: [0, 92], z: [-40, 95], d: 18, dmg: 13, kb: 'down', push: 4 }],
      sfx: [[2, 'swingHeavy']],
    },
    downAtk: {
      air: true, dur: 90, trail: [5, 90],
      kf: [[0, P({ aF: 150, eF: 20, wAbs: 170, lF: 60, kF: 100, lB: 10, kB: 90 })],
        [6, P({ aF: 25, eF: 0, wAbs: 5, lF: 30, kF: 60, lB: -10, kB: 40, lean: 10 }), 'snap'], [90, P({ aF: 25, eF: 0, wAbs: 5, lF: 30, kF: 60, lB: -10, kB: 40, lean: 10 })]],
      hits: [{ f: [6, 90], x: [-10, 44], z: [-50, 40], d: 18, dmg: 16, kb: 'down', push: 3 }],
      onFrame(h, f) { if (f === 6) { h.vz = -8; h.vx *= 0.3; BK.audio.sfx('swingHeavy'); } },
      onEnd(h) { BK.fx.dust(h.x + h.face * 20, h.y, 10); BK.fx.shake(4, 8); },
    },
    rising: {
      dur: 36, trail: [5, 12], invul: [0, 10],
      kf: [[0, P({ aF: 20, eF: 10, wAbs: -20, lean: 20, lF: 40, kF: 70, lB: -20, kB: 60 })],
        [4, P({ aF: 30, eF: 10, wAbs: 10, lean: 15, lF: 40, kF: 70, lB: -20, kB: 60 })],
        [10, P({ aF: 160, eF: 10, wAbs: 175, lean: -10, lF: 20, kF: 30, lB: -20, kB: 40, cape: 1.3 }), 'snap'],
        [36, P({ aF: 150, eF: 10, wAbs: 190, lean: -5, lF: 30, kF: 50, lB: -10, kB: 40 })]],
      hits: [{ f: [5, 11], x: [5, 72], z: [0, 135], d: 18, dmg: 14, kb: 'launch', lift: 9, push: 1.5 }],
      onFrame(h, f) { if (f === 4) { h.vz = 6.5; h.z = 0.5; h.vx = h.face * 1.5; } },
      sfx: [[5, 'swingHeavy']],
    },
    charge: { // 溜め斬り: 大上段からの叩き割り + 地を這う衝撃波
      dur: 48, trail: [13, 19], armor: true,
      kf: [[0, P({ aF: 160, eF: 40, wAbs: 215, lean: -10, lF: 14, kF: 14, lB: -20, kB: 12 })],
        [12, P({ aF: 170, eF: 30, wAbs: 228, lean: -14, lF: 14, kF: 14, lB: -20, kB: 12, cape: 0.8 })],
        [17, P({ aF: 80, eF: 0, wAbs: 78, lean: 30, lF: 44, kF: 44, lB: -30, kB: 4, drop: 6, cape: 1.4 }), 'snap'],
        [32, P({ aF: 80, eF: 0, wAbs: 78, lean: 30, lF: 44, kF: 44, lB: -30, kB: 4, drop: 6 })], [48, {}]],
      hits: [{ f: [15, 19], x: [10, 115], z: [0, 128], d: 20, dmg: 30, kb: 'down', push: 6, lift: 6, stop: 9 }],
      move: [[0, 0], [12, 2], [17, 0]],
      sfx: [[12, 'swingHeavy']],
      onFrame(h, f) {
        if (f === 17) {
          BK.fx.shake(8, 14); BK.fx.dust(h.x + h.face * 90, h.y, 12);
          BK.audio.sfx('hitHeavy', { pitch: 0.6 });
          BK.game.addProjectile(new BK.Projectile({
            x: h.x + h.face * 100, y: h.y, z: 12, vx: h.face * 7, w: 30, h: 26, team: 'hero', owner: h, dmg: 12, kb: 'down', push: 4, life: 26, pierce: 6, noShadow: true,
            tick(p) { if (p.t % 2 === 0) BK.fx.add({ type: 'smoke', x: p.x, y: p.y + U.rand(-6, 6), z: 4, vz: U.rand(1, 2.5), vx: p.vx * 0.1, life: 20, size: U.rand(6, 11), col: 'rgba(150,120,100,0.5)' }); },
            drawFn(c, sx, sy, p) {
              c.fillStyle = 'rgba(255,220,170,0.55)';
              c.beginPath(); c.moveTo(sx - p.face * 16, sy + 12); c.lineTo(sx + p.face * 6, sy - 16); c.lineTo(sx + p.face * 14, sy + 12); c.closePath(); c.fill();
            },
          }));
        }
      },
    },
    special: { // 必殺（体力消費）: 旋回斬り
      dur: 42, trail: [1, 34], invul: [0, 36],
      kf: [[0, P({ aF: 90, eF: 0, wAbs: 90, lean: 0, lF: 20, kF: 20, lB: -20, kB: 20, drop: 3 })],
        [7, P({ aF: 175, eF: 0, wAbs: 180, lean: -4, cape: 1.4 }), 'linear'],
        [14, P({ aF: 260, eF: 0, wAbs: 270, lean: 0, cape: 1.5 }), 'linear'],
        [21, P({ aF: 355, eF: 0, wAbs: 360, lean: 4 }), 'linear'],
        [28, P({ aF: 445, eF: 0, wAbs: 450, lean: 0, cape: 1.4 }), 'linear'],
        [34, P({ aF: 530, eF: 0, wAbs: 540, lean: -4 }), 'linear'], [42, {}]],
      hits: [{ f: [2, 34], x: [-96, 96], z: [0, 120], d: 24, dmg: 9, kb: 'spin', multi: 10, dirAway: true, push: 5, lift: 5 }],
      sfx: [[1, 'swingHeavy'], [11, 'swingHeavy'], [21, 'swingHeavy']],
      onFrame(h, f) { if (f === 1) { BK.fx.ring(h.x, h.y, 2, 100, '#ffffff', 20); } },
    },
    knee: {
      dur: 16,
      kf: [[0, { lF: 20, kF: 20, aF: 75, eF: 30, aB: 70, eB: 40, lean: 10 }], [5, { lF: 95, kF: 60, lean: -6, aF: 70, eF: 50, aB: 70, eB: 40 }], [16, { lF: 20, kF: 20, aF: 75, eF: 30, aB: 70, eB: 40, lean: 10 }]],
      hits: [{ f: [4, 6], x: [0, 44], z: [20, 70], d: 16, dmg: 6, kb: 'light', grabHit: true, keepGrab: true, stop: 4, sfx: 'hit' }],
    },
    throw: {
      dur: 30, throwAt: 12,
      kf: [[0, { aF: 90, eF: 30, aB: 80, eB: 30, lean: 10 }], [10, { aF: 170, eF: 20, aB: 160, eB: 20, lean: -15, lB: -30 }], [16, { aF: 80, eF: 10, aB: 70, eB: 10, lean: 25, lF: 30, kF: 30 }], [30, {}]],
    },
    shoot: {
      dur: 12, cancelShot: 6,
      kf: [[0, { aB: 80, eB: 0, xbow: 1 }], [2, { aB: 78, eB: 0, lean: 2, xbow: 1 }], [12, { aB: 80, eB: 0, xbow: 1 }]],
    },
    cannon: {
      dur: 44,
      kf: [[0, { aB: 90, eB: 0, cannon: 1, lean: 5, lF: 25, kF: 25, lB: -25, kB: 10 }], [10, { aB: 92, eB: 0, cannon: 1, lean: 6, lF: 25, kF: 25, lB: -25, kB: 10 }],
        [13, { aB: 112, eB: 10, cannon: 1, lean: -14, lF: 10, kF: 20, lB: -30, kB: 10 }], [44, { aB: 90, eB: 0, cannon: 1 }]],
      onFrame(h, f) {
        if (f !== 10) return;
        BK.audio.sfx('cannon'); BK.fx.shake(6, 12); BK.fx.flash('#ffd0a0', 4);
        const m = BK.heroShots.muzzle(h, 50, 84);
        BK.fx.glow(m.x, m.y, m.z, 30, '#ffb060', 10);
        for (let i = 0; i < 8; i++) BK.fx.add({ type: 'smoke', x: m.x, y: m.y, z: m.z, vx: h.face * U.rand(0.5, 3), vz: U.rand(-0.5, 1.5), life: 30, size: U.rand(6, 10), col: 'rgba(90,80,75,0.6)', drag: 0.92 });
        h.vx = -h.face * 4;
        const boom = p => { if (p.done) return; p.done = true; p.remove = true; BK.combat.explode(p.x, p.y, p.z * 0.5, 62, 34, 'hero', h, { shake: 8 }); };
        BK.game.addProjectile(new BK.Projectile({
          x: m.x, y: m.y, z: m.z, vx: h.face * 9, w: 16, h: 16, team: 'hero', owner: h, dmg: 10, kb: 'down', life: 36,
          onHit: boom, onExpire: boom,
          drawFn(c, sx, sy) { R.circle(c, sx, sy, 6, '#1a1a1a'); c.fillStyle = 'rgba(255,160,80,0.6)'; c.beginPath(); c.arc(sx, sy, 3, 0, 7); c.fill(); },
        }));
      },
    },
    awaken: {
      dur: 56, invul: [0, 56],
      kf: [[0, {}], [10, { lean: -12, head: -25, aF: 130, eF: 10, aB: -130, eB: 10, lF: 25, kF: 20, lB: -25, kB: 20, wAbs: 150, cape: 1.5 }],
        [56, { lean: -10, head: -20, aF: 128, eF: 10, aB: -128, eB: 10, lF: 25, kF: 20, lB: -25, kB: 20, wAbs: 150, cape: 1.5 }]],
      onFrame(h, f) { if (f % 4 === 0) BK.fx.add({ type: 'smoke', x: h.x + U.rand(-20, 20), y: h.y, z: U.rand(10, 90), vz: 1.5, life: 30, size: U.rand(8, 14), col: 'rgba(120,10,10,0.5)' }); },
    },
  };

  BK.registerHero({
    id: 'guts', name: 'ガッツ', title: '黒い剣士',
    desc: '鉄塊のごとき大剣「ドラゴンころし」を振るう。一撃が重く間合いも最長。義手のボウガンは長押しで大砲に。',
    stats: { life: 4, power: 5, speed: 2, reach: 5, shot: 3 },
    color: '#b3121b',
    maxHp: 150, walk: 2.0, walkY: 1.35, run: 4.1, jumpV: 9.4, jumpVX: 2.6, runJumpVX: 4.6, weight: 1.45, w: 30, h: 98,
    specialCost: 0.08, throwDmg: 20, shadowR: 20,
    spec: {
      scale: 1.1, thigh: 22, shin: 22, torso: 33, neck: 4, headR: 8.5, upper: 18, fore: 17,
      legW: 11.5, armW: 9.2, waistW: 17, chestW: 28, shoulderOff: 3, weaponLen: 66, gripDist: 11, capeLen: 60,
      colors: {
        skin: '#c99c7a', hair: '#141012', cloth: '#26222a', clothDark: '#18161b', sleeve: '#2c2830', body: '#302c33', armor: '#3b3840', armorHi: '#6a6670',
        belt: '#3a2618', boot: '#221f24', bootDark: '#151317', glove: '#2a262c', gloveDark: '#5f5b57',
        metal: '#6f6b66', metalDark: '#3c3a38', grip: '#2a1a10', cape: '#141116',
      },
      draw: { cape: R.capeDraw, head, torso, weapon: dragonslayer, arm, front },
    },
    stance: { lean: 6, head: 0, aF: 40, eF: 105, aB: -5, eB: 35, lF: 12, kF: 10, lB: -14, kB: 8, wAbs: -118, wBack: 1, cape: 0.3 },
    walkOpt: { lockF: true, stride: 24 },
    runOpt: { lockF: true, stride: 40, lean: 14 },
    moves,
    shot: {
      name: '連射式ボウガン', max: 10, regen: 16, cd: 8, auto: false, air: true,
      fire(h) { BK.heroShots.bolt(h, { dmg: 4, spd: 12, fwd: 38, z: 66 }); BK.audio.sfx('shoot'); },
      hold: { frames: 30, cost: 5, fire(h) { h.startMove(moves.cannon); } },
      hint: '長押しで大砲（弾5消費）',
    },
    awaken: {
      name: '狂戦士の甲冑', type: 'buff', dur: 600,
      colors: { cloth: '#18171b', clothDark: '#0f0e11', sleeve: '#1f1e23', body: '#232228', armor: '#26252b', boot: '#18171b', glove: '#1f1e23', gloveDark: '#3a3a40' },
      start(h) { h.dmgMul = 1.7; h.speedMul = 1.22; h.superArmor = 1; h.dmgTakenMul = 0.6; },
      update(h) {
        if (h.awkT % 45 === 0 && h.hp > 1) h.hp -= 1; // 甲冑は着用者の肉体を蝕む
        if (h.awkT % 3 === 0) BK.fx.add({ type: 'smoke', x: h.x + U.rand(-16, 16), y: h.y, z: U.rand(10, 90), vz: U.rand(0.8, 1.8), life: 24, size: U.rand(6, 11), col: 'rgba(140,10,10,0.45)' });
      },
      end(h) { h.dmgMul = 1; h.speedMul = 1; h.superArmor = 0; h.dmgTakenMul = 1; },
    },
    drawBack(c, h) {
      if (h.awkT <= 0) return;
      const sx = BK.sx(h.x), sy = BK.sy(h.y, h.z) - 50;
      const k = 0.6 + Math.sin(BK.frame * 0.3) * 0.2;
      const g = c.createRadialGradient(sx, sy, 5, sx, sy, 70);
      g.addColorStop(0, `rgba(200,20,10,${0.35 * k})`); g.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = g; c.beginPath(); c.arc(sx, sy, 70, 0, 7); c.fill();
    },
  });
})(window.BK);

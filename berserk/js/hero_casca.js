'use strict';
/* =====================================================================
 *  hero_casca.js ── キャスカ（鷹の団 千人長）
 *  スピード型。反りのある細身の剣（サーベル）で手数の多い連撃を刻む。
 *  ・空中攻撃が当たると跳ね返って宙返りし、もう一度空中攻撃が出せる（1ジャンプ最大3回）。
 *    3回跳ねた後の4撃目は叩き落としの宙返り斬り。
 *  ・投げナイフは押しっぱなしで連射。撃ち切るとリロード中は無防備（リンと同じ）。
 *  ・覚醒「鷹の舞」: 速さ・攻撃力が上がり、残像を引く。
 *  （AvP の Lt. Linn Kurosawa に相当するスピードキャラ）
 * ===================================================================== */
(function (BK) {
  const U = BK.U, R = BK.rig, D = U.DEG;
  const MAX_BOUNCE = 3;   // 1回のジャンプで跳ね返れる回数
  const FLIP = 16;        // 跳ね返り後の宙返りフレーム数

  // ------------------------------------------------------------ drawing
  function head(c, sp, col, sk, pose, opt) {
    const hc = sk.headC, r = sp.headR, tint = opt && opt.tint;
    // 細い首
    R.limb(c, sk.sho.x, sk.sho.y, U.lerp(sk.neck.x, hc.x, 0.3), U.lerp(sk.neck.y, hc.y, 0.3), 4.6, 4.0, col('skin'), col('line'));
    c.save();
    c.translate(hc.x, hc.y);
    c.rotate((180 - sk.ha) * D);
    // 後ろ髪（うなじまでのショートボブ）
    R.poly(c, [-r * 0.2, -r * 0.9, -r * 1.2, -r * 0.45, -r * 1.24, r * 0.4, -r * 1.02, r * 1.02, -r * 0.7, r * 0.8, -r * 0.45, r * 1.06, -r * 0.12, r * 0.55], col('hair'), col('line'));
    // 顔
    R.circle(c, 0, 0, r, col('skin'), col('line'));
    R.poly(c, [r * 0.1, r * 0.5, r * 0.93, r * 0.2, r * 0.8, r * 0.78, r * 0.28, r * 1.02, -r * 0.2, r * 0.86], col('skin'));
    // 前髪と頭頂
    c.beginPath();
    c.moveTo(r * 1.06, -r * 0.1);
    c.lineTo(r * 1.02, -r * 0.62);
    c.quadraticCurveTo(r * 0.78, -r * 1.38, -r * 0.15, -r * 1.22);
    c.quadraticCurveTo(-r * 1.15, -r * 1.06, -r * 1.22, -r * 0.2);
    c.lineTo(-r * 0.55, r * 0.18);
    c.lineTo(-r * 0.08, r * 0.62);   // もみあげ
    c.lineTo(r * 0.04, -r * 0.18);
    c.lineTo(r * 0.34, -r * 0.4);
    c.lineTo(r * 0.5, -r * 0.1);     // 前髪の房
    c.lineTo(r * 0.66, -r * 0.4);
    c.lineTo(r * 0.88, -r * 0.08);
    c.closePath();
    c.fillStyle = col('hair'); c.fill();
    c.strokeStyle = col('line'); c.lineWidth = 1; c.stroke();
    if (!tint) {
      // 髪のつや
      c.strokeStyle = 'rgba(150,165,200,0.38)'; c.lineWidth = 1;
      c.beginPath(); c.moveTo(r * 0.6, -r * 0.98); c.quadraticCurveTo(-r * 0.2, -r * 1.28, -r * 0.85, -r * 0.72); c.stroke();
      // 切れ長の目
      c.fillStyle = '#0c0706'; c.fillRect(r * 0.46, -r * 0.06, r * 0.38, r * 0.17);
      c.fillStyle = '#efe2cf'; c.fillRect(r * 0.68, -r * 0.06, r * 0.13, r * 0.08);
      // 唇
      c.fillStyle = '#4a2418'; c.fillRect(r * 0.7, r * 0.56, r * 0.22, r * 0.1);
    }
    c.restore();
  }
  /** 胴体: 腰から肩への軸に沿って、くびれのある細身の胴＋胸甲 */
  function axisFn(sk) {
    const h = sk.hip, s = sk.sho;
    const ax = s.x - h.x, ay = s.y - h.y, L = Math.hypot(ax, ay) || 1;
    const nx = -ay / L, ny = ax / L; // +n = 前
    return (t, o) => [h.x + ax * t + nx * o, h.y + ay * t + ny * o];
  }
  function torso(c, sp, col, sk, pose, opt) {
    const P = axisFn(sk);
    R.poly(c, [].concat(P(0, 5.6), P(0.36, 4.4), P(0.62, 6.6), P(0.82, 7.6), P(1, 6.8), P(1, -7.4), P(0.72, -6.6), P(0.38, -4.8), P(0, -6.2)), col('body'), col('line'));
    // 胸甲（鷹の団の鋼の胸当て）
    R.poly(c, [].concat(P(0.44, 5.0), P(0.62, 7.3), P(0.8, 8.4), P(0.97, 7.0), P(0.97, -6.9), P(0.7, -6.9), P(0.44, -5.0)), col('armor'), col('line'));
    if (!(opt && opt.tint)) {
      const a1 = P(0.5, 4.0), a2 = P(0.72, 6.6), a3 = P(0.92, 6.0);
      c.strokeStyle = col('armorHi'); c.lineWidth = 1.1;
      c.beginPath(); c.moveTo(a1[0], a1[1]); c.quadraticCurveTo(a2[0], a2[1], a3[0], a3[1]); c.stroke();
      const b1 = P(0.47, -4.6), b2 = P(0.47, 4.8);
      c.strokeStyle = 'rgba(0,0,0,0.35)';
      c.beginPath(); c.moveTo(b1[0], b1[1]); c.lineTo(b2[0], b2[1]); c.stroke();
    }
    // ベルト
    const b1 = P(0.06, -6.2), b2 = P(0.06, 5.6);
    R.limb(c, b1[0], b1[1], b2[0], b2[1], 3.6, 3.6, col('belt'));
  }
  /** 腰の草摺（前脚より手前に描く） */
  function chest(c, sp, col, sk, pose, opt) {
    const P = axisFn(sk);
    R.poly(c, [].concat(P(0.1, 6.8), P(0.1, -6.8), P(-0.2, -8.2), P(-0.28, -1), P(-0.22, 8.6)), col('armorDark'), col('line'));
    if (!(opt && opt.tint)) {
      const a = P(-0.06, -7.2), b = P(-0.06, 7.4);
      c.save(); c.strokeStyle = col('armorHi'); c.globalAlpha *= 0.6; c.lineWidth = 1;
      c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.stroke();
      c.restore();
    }
  }
  function arm(c, sp, col, sh, el, hd, back, pose, opt) {
    R.defaultDraw.arm(c, sp, col, sh, el, hd, back);
    // 籠手（前腕の鉄板）
    R.limb(c, U.lerp(el.x, hd.x, 0.25), U.lerp(el.y, hd.y, 0.25), U.lerp(el.x, hd.x, 0.75), U.lerp(el.y, hd.y, 0.75),
      sp.armW * 1.0, sp.armW * 0.86, back ? col('bracerDark') : col('bracer'), col('line'));
    // 手にした投げナイフ
    if (back && pose.knife && !(opt && opt.noWeapon)) {
      const a = Math.atan2(hd.y - el.y, hd.x - el.x);
      c.save(); c.translate(hd.x, hd.y); c.rotate(a);
      R.poly(c, [1, -1.4, 11, 0, 1, 1.4], col('metal'), col('line'), 0.8);
      c.fillStyle = col('grip'); c.fillRect(-3, -1, 4, 2);
      c.restore();
    }
  }
  function leg(c, sp, col, hip, kn, ft, back, pose, opt) {
    R.defaultDraw.leg(c, sp, col, hip, kn, ft, back);
    // 膝当て（すねの向きに沿った小さな板金）
    const a = Math.atan2(ft.y - kn.y, ft.x - kn.x);
    c.save(); c.translate(kn.x, kn.y); c.rotate(a);
    c.beginPath(); c.ellipse(1.5, 0, 4.2, sp.legW * 0.42, 0, 0, Math.PI * 2);
    c.fillStyle = back ? col('bootDark') : col('armorDark'); c.fill();
    c.strokeStyle = col('line'); c.lineWidth = 1; c.stroke();
    c.restore();
  }
  /** 手前の肩当て（上腕の向きに追従する2段の板金） */
  function front(c, sp, col, sk, pose, opt) {
    const s = sk.shF, e = sk.elF;
    c.save(); c.translate(s.x, s.y); c.rotate(Math.atan2(e.y - s.y, e.x - s.x));
    c.strokeStyle = col('line'); c.lineWidth = 1.1;
    c.beginPath(); c.ellipse(1.5, 0, 6.6, 5.3, 0, 0, Math.PI * 2);
    c.fillStyle = col('armor'); c.fill(); c.stroke();
    c.beginPath(); c.ellipse(5.8, 0, 3.4, 4.8, 0, -Math.PI / 2, Math.PI / 2); c.closePath();
    c.fillStyle = col('armorDark'); c.fill(); c.stroke();
    if (!(opt && opt.tint)) {
      c.strokeStyle = col('armorHi'); c.lineWidth = 1;
      c.beginPath(); c.ellipse(1.2, 0, 4.6, 3.4, 0, Math.PI * 0.95, Math.PI * 1.55); c.stroke();
    }
    c.restore();
  }
  /** 短いマント（裾はぼろぼろにしない） */
  function cape(c, sp, col, sk, pose, opt) {
    const t = (opt.t || 0) * 0.15;
    const fl = pose.cape == null ? 0.3 : pose.cape;
    const s = sk.sho, h = sk.hip;
    const len = sp.capeLen || 36;
    const back = 6 + fl * 22;
    const wave = Math.sin(t) * 2.4 * (0.4 + fl);
    const bx = s.x - back + wave, by = s.y + len - fl * 13;
    const fx = h.x - 3 - back * 0.25, fy = s.y + len * 0.9 - fl * 5;
    const mx = U.lerp(bx, fx, 0.5) + wave * 0.4, my = U.lerp(by, fy, 0.5) + 3;
    c.beginPath();
    c.moveTo(s.x + 4, s.y - 2);
    c.quadraticCurveTo(s.x - 9 - fl * 5, s.y + 1, s.x - 6 - back * 0.6, s.y + len * 0.5 + wave * 0.5);
    c.lineTo(bx, by);
    c.quadraticCurveTo(mx, my, fx, fy);
    c.quadraticCurveTo(h.x + 2, h.y - 8, s.x + 3, s.y + 7);
    c.closePath();
    c.fillStyle = col('cape'); c.fill();
    c.strokeStyle = col('line'); c.lineWidth = 1.1; c.stroke();
    if (!opt.tint) {
      // 裾の裏地と縁のリムライト
      c.strokeStyle = col('capeIn'); c.lineWidth = 2;
      c.beginPath(); c.moveTo(bx + 1, by - 1.5); c.quadraticCurveTo(mx, my - 1.5, fx, fy - 1.5); c.stroke();
      c.strokeStyle = 'rgba(170,190,230,0.3)'; c.lineWidth = 1;
      c.beginPath(); c.moveTo(s.x - 9 - fl * 5, s.y + 3); c.quadraticCurveTo(s.x - 6 - back * 0.6, s.y + len * 0.5, bx, by); c.stroke();
    }
  }
  /** 反りのある片刃のサーベル（原点=柄を握る手、+x が刃） */
  function sabre(c, sp, col, len, pose, opt) {
    // 柄・柄頭・護拳
    R.poly(c, [-9, -1.6, 0, -1.4, 0, 1.4, -9, 1.6], col('grip'));
    R.circle(c, -9.6, 0, 1.9, col('guard'));
    c.strokeStyle = col('guard'); c.lineWidth = 1.3;
    c.beginPath(); c.moveTo(1, 3.8); c.quadraticCurveTo(-5, 7.2, -9.6, 1.6); c.stroke();
    R.poly(c, [-0.5, -4.2, 2.2, -4.2, 2.2, 4.2, -0.5, 4.2], col('guard'), col('line'));
    // 刃（峰→切っ先→刃）
    c.beginPath();
    c.moveTo(2.2, -1.9);
    c.quadraticCurveTo(len * 0.55, -2.7, len, -6.4);
    c.quadraticCurveTo(len * 0.62, 0.9, 2.2, 2.1);
    c.closePath();
    c.fillStyle = col('metal'); c.fill();
    c.strokeStyle = col('line'); c.lineWidth = 1; c.stroke();
    if (!(opt && opt.tint)) {
      c.strokeStyle = 'rgba(255,255,255,0.6)'; c.lineWidth = 0.8;
      c.beginPath(); c.moveTo(4, -0.7); c.quadraticCurveTo(len * 0.55, -1.4, len - 5, -4.9); c.stroke();
    }
  }

  // ------------------------------------------------------------ helpers
  /** 横回転: face を cos で縮めて「その場で回る」ように見せる（f0〜f1 で turns 回転） */
  function spin(h, f, f0, f1, turns) {
    if (f === f0) h.spinDir = h.face < 0 ? -1 : 1;
    if (f < f0 || !h.spinDir) return;
    if (f >= f1) { h.face = h.spinDir; return; }
    const cs = Math.cos((f - f0) / (f1 - f0) * turns * Math.PI * 2);
    h.face = h.spinDir * (Math.abs(cs) < 0.1 ? (cs < 0 ? -0.1 : 0.1) : cs);
  }
  function endSpin(h) { if (h.spinDir) { h.face = h.spinDir; h.spinDir = 0; } }
  function aerialStart(h) { h.bounceArm = false; h.bounceEnd = 0; h.flipT = 0; }
  /** 空中攻撃ヒット時: 跳ね返って宙返り → もう一度空中攻撃が出せる */
  function bounce(h) {
    if (h.bounceArm || h.z < 6 || (h.bounces || 0) >= MAX_BOUNCE) return;
    h.bounceArm = true;
    h.bounces = (h.bounces || 0) + 1;
    // 跳ね返りは高さに応じて弱める（連打で天井まで昇っていかないように）
    h.vz = U.clamp(4.6 - h.bounces * 0.5 - Math.max(0, h.z - 45) * 0.05, 1.2, 4.6);
    h.vx = h.face * 1.5;
    h.jumpAtkUsed = false;
    h.bounceEnd = 5;
    BK.fx.ring(h.x, h.y, h.z + 4, 16, '#d6e4ff', 10);
  }
  /** 跳ね返り後の空中攻撃を選んで出す */
  function startAerial(h, I) {
    h.jumpAtkUsed = true; h.aBuf = 0;
    if (I.dirX) h.face = I.dirX;
    let m;
    if (I.dirY === 1) m = moves.downAtk;
    else if (h.bounces >= MAX_BOUNCE) m = moves.jumpFin;
    else if (I.dirX) m = moves.jumpAtkF;
    else m = moves.jumpAtk;
    h.startMove(m);
  }
  /** 鷹の羽根（白い羽根がひらひら舞う） */
  function feather(x, y, z, vx, vz) {
    BK.fx.add({
      type: 'custom', x, y, z, vx, vz, g: 0.025, drag: 0.95, life: U.randi(34, 54), rot: U.rand(0, 6), spin: U.rand(-0.18, 0.18),
      draw(c, sx, sy, k, p) {
        c.save();
        c.globalAlpha = Math.min(1, k * 2.2) * 0.9;
        c.translate(sx + Math.sin(p.life * 0.2) * 3, sy); c.rotate(p.rot + p.life * p.spin);
        c.fillStyle = '#eef3ff'; c.beginPath(); c.ellipse(0, 0, 5.2, 1.7, 0, 0, 7); c.fill();
        c.strokeStyle = 'rgba(80,100,140,0.8)'; c.lineWidth = 0.7;
        c.beginPath(); c.moveTo(-6, 0); c.lineTo(5, 0); c.stroke();
        c.restore();
      },
    });
  }

  // ------------------------------------------------------------ moves
  const GRAB = { lean: 8, aF: -25, eF: 95, wAbs: 100, aB: 88, eB: 12, lF: 22, kF: 18, lB: -20, kB: 8 };
  const AIR_UP = { lF: 60, kF: 100, lB: -5, kB: 85, lean: 6, aF: 60, eF: 40, wAbs: 150, aB: -60, eB: 60, cape: 1.2 };
  const AIR_DN = { lF: 34, kF: 50, lB: -20, kB: 36, lean: 4, aF: 50, eF: 42, wAbs: 122, aB: -50, eB: 40, cape: 1.4 };
  // リロード: 片膝をつき、腰のナイフを籠手の鞘へ差し直す（奥の手が胸の前に来るときにナイフが見える）
  const RLD_LO = { lean: 14, head: 14, aF: 30, eF: 12, wAbs: 62, aB: -12, eB: 82, lF: 90, kF: 110, lB: -5, kB: 95, cape: 0.2, knife: 0 };
  const RLD_HI = Object.assign({}, RLD_LO, { aB: 50, eB: 92, head: 20, knife: 1 });
  const TRAIL = '#e6eeff';

  const moves = {
    atk1: { // 袈裟斬り
      dur: 17, cancel: 8, cancelShot: 8, trail: [3, 8], trailCol: TRAIL,
      kf: [[0, {}],
        [3, { aF: 125, eF: 45, wAbs: 205, lean: -2, lF: 14, kF: 12, lB: -20, kB: 12, aB: -40, eB: 60, cape: 0.5 }],
        [6, { aF: 82, eF: 0, wAbs: 58, lean: 18, lF: 34, kF: 30, lB: -26, kB: 6, drop: 2, aB: -50, eB: 30, cape: 0.9 }, 'snap'],
        [9, { aF: 62, eF: 0, wAbs: 30, lean: 18, lF: 34, kF: 30, lB: -26, kB: 6, drop: 2, aB: -50, eB: 30 }], [17, {}]],
      hits: [{ f: [4, 7], x: [8, 70], z: [15, 95], d: 16, dmg: 7, kb: 'light', push: 1.6, stop: 3, sfx: 'slash' }],
      move: [[0, 0], [2, 2.6], [7, 0.6], [9, 0]],
      sfx: [[2, 'swing']],
    },
    atk2: { // 逆袈裟の斬り上げ
      dur: 17, cancel: 8, cancelShot: 8, trail: [3, 8], trailCol: TRAIL,
      kf: [[0, { aF: 62, eF: 0, wAbs: 30, lean: 18, lF: 34, kF: 30, lB: -26, kB: 6, drop: 2, aB: -50, eB: 30 }],
        [3, { aF: 35, eF: 10, wAbs: -35, lean: 14, lF: 30, kF: 30, lB: -24, kB: 8, drop: 2, aB: -50, eB: 30 }],
        [6, { aF: 140, eF: 15, wAbs: 165, lean: -6, lF: 24, kF: 18, lB: -22, kB: 10, aB: -60, eB: 30, cape: 0.9 }, 'snap'],
        [9, { aF: 150, eF: 15, wAbs: 190, lean: -8, lF: 24, kF: 18, lB: -22, kB: 10, aB: -60, eB: 30 }], [17, {}]],
      hits: [{ f: [4, 7], x: [6, 66], z: [20, 118], d: 16, dmg: 7, kb: 'light', push: 1.6, stop: 3, sfx: 'slash' }],
      move: [[0, 0], [2, 2.2], [7, 0.4], [9, 0]],
      sfx: [[2, 'swing']],
    },
    atk3: { // 二段斬り（振り下ろし → 横薙ぎ）
      dur: 26, cancel: 16, cancelShot: 16, trail: [1, 15], trailCol: TRAIL,
      kf: [[0, { aF: 150, eF: 15, wAbs: 190, lean: -8, aB: -60, eB: 30 }],
        [3, { aF: 75, eF: 0, wAbs: 45, lean: 20, lF: 34, kF: 30, lB: -26, kB: 6, drop: 2, aB: -50, eB: 30 }, 'snap'],
        [7, { aF: 45, eF: 25, wAbs: -15, lean: 14, lF: 30, kF: 28, lB: -24, kB: 8, drop: 2, aB: -50, eB: 30 }],
        [10, { aF: 115, eF: 35, wAbs: 175, lean: 0, lF: 26, kF: 20, lB: -22, kB: 10, aB: -40, eB: 50 }],
        [13, { aF: 88, eF: 0, wAbs: 86, lean: 24, lF: 46, kF: 38, lB: -34, kB: 4, drop: 3, aB: -80, eB: 20, cape: 1.1 }, 'snap'],
        [17, { aF: 86, eF: 0, wAbs: 80, lean: 24, lF: 46, kF: 38, lB: -34, kB: 4, drop: 3, aB: -80, eB: 20 }], [26, {}]],
      hits: [{ f: [2, 4], x: [8, 68], z: [10, 100], d: 16, dmg: 6, kb: 'light', push: 1.2, stop: 3, sfx: 'slash' },
        { f: [11, 14], x: [10, 76], z: [20, 90], d: 16, dmg: 7, kb: 'heavy', push: 2.8, stop: 4, sfx: 'slash' }],
      move: [[0, 1.5], [4, 0.4], [9, 3.2], [14, 0.4], [16, 0]],
      sfx: [[1, 'swing'], [10, 'swing']],
    },
    atk4: { // フィニッシュ: 回転斬り（前後を薙ぎ払ってダウン）
      dur: 34, spins: true, trail: [3, 15], trailCol: TRAIL,
      kf: [[0, { aF: 86, eF: 0, wAbs: 80, lean: 24, lF: 46, kF: 38, lB: -34, kB: 4, drop: 3, aB: -80, eB: 20 }],
        [3, { aF: 90, eF: 0, wAbs: 95, aB: -95, eB: 0, lean: 6, lF: 20, kF: 34, lB: -30, kB: 50, drop: 2, cape: 1.2 }],
        [11, { aF: 92, eF: 0, wAbs: 100, aB: -95, eB: 0, lean: 8, lF: 20, kF: 34, lB: -30, kB: 50, drop: 2, cape: 1.4 }],
        [15, { aF: 70, eF: 0, wAbs: 40, aB: -70, eB: 20, lean: 26, lF: 48, kF: 42, lB: -34, kB: 4, drop: 4, cape: 1.2 }, 'snap'],
        [24, { aF: 68, eF: 0, wAbs: 36, aB: -70, eB: 20, lean: 26, lF: 48, kF: 42, lB: -34, kB: 4, drop: 4 }], [34, {}]],
      hits: [{ f: [5, 15], x: [-58, 80], z: [8, 100], d: 20, dmg: 16, kb: 'down', dirAway: true, push: 4.8, lift: 5, stop: 6, sfx: 'slash' }],
      sfx: [[2, 'swingHeavy'], [9, 'swing']],
      onFrame(h, f) { spin(h, f, 2, 13, 1); if (f >= 2 && f <= 13) h.vx = h.spinDir * 1.6; },
      onEnd: endSpin,
    },
    dash: { // スライディング斬り
      dur: 30, trail: [2, 16], trailCol: TRAIL,
      kf: [[0, { aF: 60, eF: 30, wAbs: 150, lean: 12, lF: 40, kF: 40, lB: -30, kB: 20 }],
        [3, { aF: 85, eF: 5, wAbs: 72, lean: -12, lF: 78, kF: 4, lB: -55, kB: 100, aB: -130, eB: 20, cape: 1.4 }, 'snap'],
        [18, { aF: 80, eF: 5, wAbs: 60, lean: -12, lF: 78, kF: 4, lB: -55, kB: 100, aB: -130, eB: 20, cape: 1.2 }],
        [24, { aF: 60, eF: 30, wAbs: 110, lean: 14, lF: 40, kF: 60, lB: -20, kB: 50, drop: 2 }], [30, {}]],
      hits: [{ f: [3, 17], x: [10, 78], z: [0, 60], d: 18, dmg: 12, kb: 'down', push: 3.5, lift: 5, stop: 4, sfx: 'slash' }],
      move: [[0, 8.2], [8, 7], [14, 4.5], [18, 2], [22, 0]],
      sfx: [[1, 'swing']],
      onFrame(h, f) { if (f < 18 && f % 4 === 0) BK.fx.dust(h.x - h.face * 6, h.y, 1); },
    },
    jumpAtk: { // 空中斬り下ろし（当たると跳ね返る）
      air: true, aerial: true, dur: 22, trail: [2, 9], trailCol: TRAIL,
      kf: [[0, { aF: 150, eF: 30, wAbs: 215, lean: -8, lF: 60, kF: 100, lB: 5, kB: 90, aB: -50, eB: 40, cape: 1.2 }],
        [4, { aF: 75, eF: 0, wAbs: 35, lean: 22, lF: 55, kF: 90, lB: 0, kB: 80, aB: -80, eB: 20, cape: 1.3 }, 'snap'],
        [10, { aF: 50, eF: 5, wAbs: 5, lean: 20, lF: 50, kF: 85, lB: 0, kB: 75, aB: -80, eB: 20 }],
        [22, { aF: 50, eF: 40, wAbs: 100, lean: 8, lF: 35, kF: 50, lB: -20, kB: 35, aB: -50, eB: 40 }]],
      hits: [{ f: [2, 9], x: [0, 72], z: [-50, 75], d: 18, dmg: 9, kb: 'light', push: 1.2, stun: 20, stop: 4, sfx: 'slash' }],
      sfx: [[1, 'swing']],
      onStart: aerialStart, onHit: bounce,
    },
    jumpAtkF: { // 飛び蹴り
      air: true, aerial: true, dur: 26,
      kf: [[0, { lF: 70, kF: 110, lB: 0, kB: 90, lean: -4, aF: 60, eF: 70, wAbs: 160, aB: -40, eB: 60, cape: 1.2, lift: 6 }],
        [3, { lF: 82, kF: 0, lB: -35, kB: 75, lean: -20, aF: 30, eF: 80, wAbs: 175, aB: -110, eB: 20, cape: 1.5, lift: 14 }, 'snap'],
        [18, { lF: 80, kF: 2, lB: -35, kB: 75, lean: -18, aF: 30, eF: 80, wAbs: 175, aB: -110, eB: 20, cape: 1.5, lift: 14 }],
        [26, { lF: 40, kF: 60, lB: -20, kB: 40, lean: 4, aF: 50, eF: 40, wAbs: 120, lift: 4 }]],
      hits: [{ f: [3, 16], x: [8, 58], z: [-12, 56], d: 18, dmg: 10, kb: 'down', push: 2.2, lift: 4.5, stop: 5, sfx: 'hit' }],
      sfx: [[2, 'swing']],
      onStart(h) { aerialStart(h); if (Math.abs(h.vx) < 2.4) h.vx = (h.face < 0 ? -1 : 1) * 2.4; },
      onHit: bounce,
    },
    jumpFin: { // 3回跳ねた後の締め: 前宙からの叩き斬り
      air: true, aerial: true, dur: 30, trail: [2, 16], trailCol: '#fff2cc',
      kf: [[0, { rot: 0, aF: 60, eF: 60, wAbs: 160, lF: 70, kF: 110, lB: 20, kB: 100, lean: 0, aB: -40, eB: 60 }],
        [5, { rot: 150, lift: 12, aF: 120, eF: 0, wAbs: 130, lF: 90, kF: 130, lB: 60, kB: 130, lean: 10, aB: -60, eB: 40, cape: 1.4 }],
        [10, { rot: 300, lift: 10, aF: 110, eF: 0, wAbs: 110, lF: 80, kF: 120, lB: 40, kB: 110, lean: 16, aB: -70, eB: 30, cape: 1.4 }],
        [14, { rot: 360, aF: 80, eF: 0, wAbs: 42, lean: 24, lF: 50, kF: 70, lB: -10, kB: 60, aB: -80, eB: 20 }, 'snap'],
        [30, { rot: 360, aF: 50, eF: 10, wAbs: 30, lean: 16, lF: 40, kF: 60, lB: -15, kB: 50, aB: -60, eB: 30 }]],
      hits: [{ f: [3, 16], x: [-20, 74], z: [-50, 80], d: 20, dmg: 14, kb: 'down', push: 4, lift: 2, stop: 7, sfx: 'slash' }],
      sfx: [[1, 'swingHeavy']],
      onStart(h) { aerialStart(h); h.vz = Math.max(h.vz, 3); },
      onFrame(h, f) { if (f === 12) h.vz = Math.min(h.vz, -4); },
    },
    downAtk: { // 空中 ↓+斬: 落鷹（急降下突き。当たると跳ね返る）
      air: true, aerial: true, dur: 70, trail: [4, 70], trailCol: TRAIL,
      kf: [[0, { aF: 160, eF: 20, wAbs: 185, lF: 60, kF: 100, lB: 5, kB: 90, lean: -6, aB: -60, eB: 40 }],
        [5, { aF: 15, eF: -5, wAbs: 2, lF: 30, kF: 60, lB: -10, kB: 50, lean: 12, aB: -100, eB: 30, cape: 1.4, lift: 10 }, 'snap'],
        [70, { aF: 15, eF: -5, wAbs: 2, lF: 30, kF: 60, lB: -10, kB: 50, lean: 12, aB: -100, eB: 30, cape: 1.5, lift: 10 }]],
      hits: [{ f: [5, 70], x: [-8, 34], z: [-55, 30], d: 18, dmg: 13, kb: 'down', push: 3, lift: 4, stop: 5, sfx: 'slash' }],
      onStart: aerialStart,
      onFrame(h, f) { if (f === 5) { h.vz = -8.5; h.vx *= 0.3; BK.audio.sfx('swing'); } },
      onHit: bounce,
      onEnd(h) { if (h.z <= 1) BK.fx.dust(h.x + h.face * 12, h.y, 6); },
    },
    rising: { // ↓↑+斬: 宙返り斬り（打ち上げ → そのまま空中攻撃につなげられる）
      air: true, dur: 20, vz: 8.2, invul: [0, 8], trail: [1, 12], trailCol: TRAIL,
      kf: [[0, { aF: 30, eF: 20, wAbs: -40, lean: 22, lF: 50, kF: 80, lB: -10, kB: 70, aB: -40, eB: 40 }],
        [3, { aF: 150, eF: 10, wAbs: 170, lean: -8, lF: 30, kF: 30, lB: -20, kB: 20, aB: -80, eB: 20, cape: 1.3 }, 'snap'],
        [7, { rot: -110, aF: 165, eF: 10, wAbs: 200, lean: -10, lF: 80, kF: 120, lB: 40, kB: 120, aB: -60, eB: 60, cape: 1.4 }],
        [12, { rot: -240, aF: 150, eF: 20, wAbs: 190, lean: 0, lF: 90, kF: 130, lB: 60, kB: 130, aB: -40, eB: 80, cape: 1.4 }],
        [17, { rot: -360, aF: 60, eF: 40, wAbs: 130, lean: 6, lF: 60, kF: 100, lB: -5, kB: 85, aB: -60, eB: 60, cape: 1.2 }],
        [20, { rot: -360, aF: 60, eF: 40, wAbs: 150, lean: 6, lF: 60, kF: 100, lB: -5, kB: 85, aB: -60, eB: 60, cape: 1.2 }]],
      hits: [{ f: [1, 8], x: [-4, 64], z: [0, 132], d: 18, dmg: 12, kb: 'launch', lift: 9, push: 1.4, stop: 5, sfx: 'slash' }],
      move: [[0, 1.2]],
      sfx: [[1, 'swingHeavy']],
      // ↓入力で付いた奥行き速度が空中で残らないよう vy を消す
      onStart(h) { h.jumpAtkUsed = false; h.bounces = 0; h.flipT = 0; h.vy = 0; },
    },
    charge: { // 溜め: 鷹の突き（アーマー付きで大きく踏み込む刺突）
      dur: 40, armor: true, trail: [5, 18], trailCol: '#fff2cc',
      kf: [[0, { aF: -35, eF: 105, wAbs: 92, lean: -4, lF: 22, kF: 26, lB: -22, kB: 18, drop: 2, aB: 40, eB: 50, cape: 0.5 }],
        [4, { aF: -40, eF: 110, wAbs: 92, lean: -6, lF: 22, kF: 30, lB: -24, kB: 22, drop: 3, aB: 45, eB: 50, cape: 0.6 }],
        [7, { aF: 88, eF: 0, wAbs: 90, lean: 30, lF: 68, kF: 48, lB: -52, kB: 0, aB: -120, eB: 10, cape: 1.5 }, 'snap'],
        [20, { aF: 88, eF: 0, wAbs: 90, lean: 30, lF: 68, kF: 48, lB: -52, kB: 0, aB: -120, eB: 10, cape: 1.4 }],
        [30, { aF: 60, eF: 30, wAbs: 110, lean: 16, lF: 40, kF: 40, lB: -30, kB: 10 }], [40, {}]],
      hits: [{ f: [6, 19], x: [0, 84], z: [28, 80], d: 18, dmg: 26, kb: 'down', push: 6.5, lift: 4, stop: 7, sfx: 'slash' }],
      move: [[0, 0], [5, 10.5], [13, 6], [18, 2], [21, 0]],
      sfx: [[5, 'swingHeavy']],
      onFrame(h, f) {
        if (f === 5) BK.fx.ring(h.x, h.y, 2, 40, '#fff2cc', 12);
        if (f >= 5 && f <= 17 && f % 4 === 1) BK.fx.dust(h.x - h.face * 10, h.y, 1);
      },
    },
    special: { // 必殺（体力消費）: 旋風剣
      dur: 46, spins: true, invul: [0, 42], trail: [4, 38], trailCol: '#d6e4ff',
      kf: [[0, { aF: 40, eF: 60, wAbs: 150, lean: 12, lF: 34, kF: 46, lB: -22, kB: 34, drop: 2 }],
        [4, { aF: 92, eF: 0, wAbs: 94, aB: -92, eB: 0, lean: 0, lF: 16, kF: 40, lB: -26, kB: 60, lift: 8, cape: 1.3 }],
        [38, { aF: 92, eF: 0, wAbs: 94, aB: -92, eB: 0, lean: 0, lF: 16, kF: 40, lB: -26, kB: 60, lift: 12, cape: 1.5 }], [46, {}]],
      hits: [{ f: [4, 38], x: [-86, 86], z: [0, 112], d: 26, dmg: 8, kb: 'spin', multi: 9, dirAway: true, push: 5, lift: 5.5, stop: 2 }],
      sfx: [[2, 'swingHeavy'], [12, 'swing'], [22, 'swing'], [32, 'swing']],
      onFrame(h, f) {
        if (f === 1) BK.fx.ring(h.x, h.y, 2, 100, '#d6e4ff', 20);
        spin(h, f, 4, 39, 3);
        if (f > 4 && f < 38 && f % 5 === 0) BK.fx.dust(h.x + U.rand(-34, 34), h.y, 1, 'rgba(150,160,180,0.3)');
      },
      onEnd: endSpin,
    },
    knee: {
      dur: 15,
      kf: [[0, GRAB], [5, Object.assign({}, GRAB, { lF: 100, kF: 80, lean: -4, lB: -16, kB: 6 })], [15, GRAB]],
      hits: [{ f: [4, 6], x: [0, 42], z: [20, 70], d: 16, dmg: 5, kb: 'light', grabHit: true, keepGrab: true, stop: 4, sfx: 'hit' }],
    },
    throw: { // 背負って投げ飛ばす
      dur: 30, throwAt: 11,
      kf: [[0, GRAB],
        [8, { aF: -40, eF: 100, wAbs: 110, aB: 170, eB: 15, lean: -18, lF: 30, kF: 30, lB: -30, kB: 12 }],
        [13, { aF: 40, eF: 50, wAbs: 100, aB: 70, eB: 10, lean: 30, lF: 44, kF: 50, lB: -34, kB: 10, drop: 2 }, 'snap'], [30, {}]],
      sfx: [[9, 'swing']],
    },
    shoot: { // 投げナイフ（奥の手で投げる）
      dur: 6,
      kf: [[0, { aB: 40, eB: 40, lean: 8, knife: 0 }], [2, { aB: 95, eB: 0, lean: 10, knife: 0 }, 'snap'], [4, { aB: 20, eB: 80, lean: 8, knife: 1 }], [6, { aB: -40, eB: 95, lean: 6, knife: 1 }]],
    },
    reload: { // ナイフの補充（この間は無防備）
      dur: 75,
      kf: [[0, RLD_LO], [10, RLD_HI], [20, RLD_LO], [30, RLD_HI], [40, RLD_LO], [50, RLD_HI], [60, RLD_LO], [66, RLD_LO], [75, {}]],
    },
    awaken: {
      dur: 50, invul: [0, 50],
      kf: [[0, {}],
        [10, { lean: -10, head: -20, aF: 172, eF: 4, wAbs: 182, aB: -100, eB: 10, lF: 16, kF: 10, lB: -22, kB: 10, cape: 1.5 }],
        [50, { lean: -8, head: -18, aF: 170, eF: 4, wAbs: 180, aB: -98, eB: 10, lF: 16, kF: 10, lB: -22, kB: 10, cape: 1.5 }]],
      onFrame(h, f) {
        if (f % 3 === 0) feather(h.x + U.rand(-28, 28), h.y + U.rand(-6, 6), U.rand(20, 100), U.rand(-1, 1), U.rand(0.3, 1.4));
        if (f === 10) { BK.fx.ring(h.x, h.y, 2, 90, '#cfe0ff', 24); BK.audio.sfx('magic', { pitch: 0.8 }); }
      },
    },
  };

  BK.registerHero({
    id: 'casca', name: 'キャスカ', title: '鷹の団 千人長',
    desc: '鷹の団の女剣士。反りのある細身の剣で素早い連撃。\n空中攻撃が当たると跳ね上がり、\n空中で最大3回まで連続攻撃できる。',
    stats: { life: 2, power: 3, speed: 5, reach: 3, shot: 4 },
    color: '#5a82c8',
    maxHp: 105, walk: 2.6, walkY: 1.7, run: 5.0, jumpV: 9.8, jumpVX: 3.0, runJumpVX: 5.4, weight: 1.15, w: 24, h: 88,
    specialCost: 0.08, throwDmg: 16, shadowR: 16,
    spec: {
      scale: 1.0, thigh: 21, shin: 22, torso: 27, neck: 4.5, headR: 7.2, upper: 15.5, fore: 14.5,
      legW: 8, armW: 5.8, waistW: 10, chestW: 16, shoulderOff: 2, weaponLen: 44, gripDist: 8, capeLen: 36,
      colors: {
        skin: '#7a4e36', hair: '#0d0a0c', cloth: '#2a3148', clothDark: '#1b2031', sleeve: '#2f3852', body: '#28304a',
        armor: '#62718e', armorHi: '#aebcd4', armorDark: '#414c66', bracer: '#48526a', bracerDark: '#2c3244',
        belt: '#3a2618', boot: '#2b2326', bootDark: '#1b1618', glove: '#3a2a22', gloveDark: '#281c17',
        metal: '#dfe5ec', metalDark: '#7a8290', grip: '#3a1f14', guard: '#b8954e',
        cape: '#2c3858', capeIn: '#161c2e', line: 'rgba(6,6,12,0.88)',
      },
      draw: { cape, head, torso, chest, weapon: sabre, arm, leg, front },
    },
    stance: { lean: 8, head: 0, aF: 32, eF: 58, aB: -28, eB: 75, lF: 20, kF: 16, lB: -18, kB: 12, wAbs: 120, cape: 0.3 },
    walkOpt: { lockF: true, stride: 22, arm: 14 },
    runOpt: { lockF: true, stride: 42, lean: 16 },
    anim: {
      jump(h) {
        const st = h.stance;
        if (h.flipT > 0) {
          // 跳ね返りの後方宙返り
          const k = U.ease.out(1 - h.flipT / FLIP);
          return R.merge(st, { rot: -360 * k, lift: 14 * Math.sin(k * Math.PI), lF: 95, kF: 140, lB: 70, kB: 130, lean: 20, aF: 60, eF: 60, wAbs: 150, aB: -40, eB: 90, cape: 1.2 });
        }
        return R.merge(st, h.vz > 0 ? AIR_UP : AIR_DN);
      },
      crouch(h) { return R.merge(h.stance, { lF: 50, kF: 85, lB: -12, kB: 70, lean: 18, drop: 1, aF: 30, eF: 60, wAbs: 110 }); },
      grab(h) { return R.merge(h.stance, GRAB); },
    },
    moves,
    shot: {
      name: '投げナイフ', max: 12, regen: 9, cd: 6, auto: true, air: true, reloadAll: 75, reloadLock: true,
      fire(h, air) { BK.heroShots.knife(h, { dmg: 4, spd: 11, z: air ? 52 : 60 }); BK.audio.sfx('knife'); },
      hint: '押しっぱなしで連射／撃ち切るとリロード中は無防備',
    },
    awaken: {
      name: '鷹の舞', type: 'buff', dur: 540,
      colors: { armor: '#8aa0c8', armorHi: '#e4ecff', armorDark: '#5a6c94', cape: '#34467c', metal: '#f4f8ff' },
      start(h) { h.dmgMul = 1.35; h.speedMul = 1.35; h.moveSpeedMul = 1.2; h.ghosts = []; },
      update(h) { if (h.awkT % 8 === 0) feather(h.x + U.rand(-20, 20), h.y, U.rand(30, 90), U.rand(-0.8, 0.8), U.rand(0.2, 0.9)); },
      end(h) { h.dmgMul = 1; h.speedMul = 1; h.moveSpeedMul = 1; if (h.ghosts) h.ghosts.length = 0; },
    },
    init(h) {
      h.bounces = 0; h.bounceArm = false; h.bounceEnd = 0; h.flipT = 0; h.aBuf = 0;
      h.spinDir = 0; h.ghosts = []; h.moveSpeedMul = 1;
    },
    update(h, game, I) {
      // 着地したら空中バウンド回数をリセット
      if (h.z <= 0) { h.bounces = 0; h.flipT = 0; }
      if (h.flipT > 0) h.flipT--;
      h.aBuf = I.pressed.atk ? 8 : Math.max(0, (h.aBuf || 0) - 1);
      // 回転技以外で face が ±1 以外なら戻す（loadStage / respawn が endMove を経ずに技を消した場合の対策）
      if (h.spinDir && !(h.move && h.move.spins)) h.spinDir = 0;
      if (!h.spinDir && h.face !== 1 && h.face !== -1) h.face = h.face < 0 ? -1 : 1;
      // 覚醒が外部要因で解除された（ステージ切替など）ときの後始末
      if (h.awkT <= 0 && h.moveSpeedMul !== 1) { h.moveSpeedMul = 1; h.ghosts.length = 0; }
      if (h.dead) return;
      // 跳ね返り: 数フレーム後に技を切り上げて宙返り
      if (h.bounceEnd > 0 && --h.bounceEnd === 0 && h.move && h.move.aerial && h.z > 2) {
        h.endMove(); h.flipT = FLIP;
      }
      // 跳ね返り後の空中攻撃（先行入力を受け付ける）
      if (!h.move && h.state === 'air' && h.z > 3 && h.bounces > 0 && !h.jumpAtkUsed && h.aBuf > 0) startAerial(h, I);
      // リロード中は無防備: 地上で動ける状態ならリロード動作を続ける（必殺技でのみ抜けられる）
      if (h.move === moves.reload && h.canSpecial() && (I.pressed.sp || (I.pressed.atk && I.held.jmp) || (I.pressed.jmp && I.held.atk))) h.doSpecial();
      else if (h.reloading > 0 && !h.move && !h.sub && h.z <= 0 && (h.state === 'idle' || h.state === 'walk' || h.state === 'run')) {
        h.startMove(moves.reload);
        h.mf = Math.max(0, moves.reload.dur - h.reloading);
      }
      // 覚醒中は残像を記録
      if (h.awkT > 0 && BK.frame % 2 === 0) {
        h.ghosts.push({ x: h.x, y: h.y, z: h.z, face: h.face, pose: h.currentPose() });
        if (h.ghosts.length > 8) h.ghosts.shift();
      }
    },
    drawBack(c, h) {
      // 鷹の舞: 残像
      const gs = h.ghosts;
      if (h.awkT <= 0 || !gs || gs.length < 3) return;
      if (!(h.move || h.z > 0 || h.state === 'run' || h.state === 'walk')) return;
      const a0 = c.globalAlpha, sc = h.spec.scale || 1;
      for (let i = 2; i >= 0; i--) {
        const g = gs[gs.length - 2 - i * 2];
        if (!g) continue;
        c.globalAlpha = a0 * (0.34 - i * 0.1);
        c.save();
        c.translate(BK.sx(g.x), BK.sy(g.y, g.z));
        c.scale(g.face * sc, sc);
        R.draw(c, g.pose, h.spec, { t: h.animT, tint: i === 0 ? '#9dbcff' : '#5f80d0' });
        c.restore();
      }
      c.globalAlpha = a0;
    },
    drawFront(c, h) {
      // 旋風剣の風
      if (h.move === moves.special) {
        const f = h.mf, k = Math.min(1, f / 5) * Math.min(1, (moves.special.dur - f) / 8);
        if (k > 0) {
          const sx = BK.sx(h.x), sy = BK.sy(h.y, h.z);
          c.save(); c.lineCap = 'round';
          for (let i = 0; i < 3; i++) {
            const a = f * 0.55 + i * 2.1;
            c.globalAlpha = (0.55 - i * 0.12) * k;
            c.strokeStyle = i === 1 ? '#ffffff' : '#bcd2f2'; c.lineWidth = 3 - i * 0.7;
            c.beginPath(); c.ellipse(sx, sy - 22 - i * 26, 64 - i * 8, 12 - i * 2, 0, a, a + 2.3); c.stroke();
          }
          c.restore();
        }
      }
      // リロード中: 頭上に補充ゲージ
      if (h.reloading > 0 && !h.dead && h.def.shot.reloadAll) {
        const sx = BK.sx(h.x), sy = BK.sy(h.y, h.z) - 104;
        const k = 1 - h.reloading / h.def.shot.reloadAll;
        c.save();
        c.lineWidth = 3; c.strokeStyle = 'rgba(0,0,0,0.6)';
        c.beginPath(); c.arc(sx, sy, 6, 0, Math.PI * 2); c.stroke();
        c.strokeStyle = (BK.frame >> 3) % 2 ? '#e8ecf4' : '#9fb0cc';
        c.beginPath(); c.arc(sx, sy, 6, -Math.PI / 2, -Math.PI / 2 + k * Math.PI * 2); c.stroke();
        c.restore();
      }
    },
  });
})(window.BK);

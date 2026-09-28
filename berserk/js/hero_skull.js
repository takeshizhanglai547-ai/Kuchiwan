'use strict';
/* =====================================================================
 *  hero_skull.js ── 髑髏の騎士（使徒を狩る者）
 *  最も重く、最も遅く、最も打たれ強い重装の騎士。長剣と円盾による重い連撃、
 *  盾での突進、霊気の三日月「光刃」（低速・貫通）。覚醒は画面全体を断つ「空間切断」。
 *  （AvP の Predator Warrior に相当する重量級キャラ）
 * ===================================================================== */
(function (BK) {
  const U = BK.U, R = BK.rig, D = U.DEG;

  // 霊気（光刃・剣の丘・空間切断）の色
  const GLOW = '#e2f1ff', GLOW_MID = 'rgba(176,214,255,0.85)', GLOW_EDGE = 'rgba(110,160,255,0.32)';
  const CUT_DMG = 60;     // 空間切断のダメージ
  const AWK_DUR = 360;    // 空間切断のあとに纏う「鎧気」（スーパーアーマー）の長さ
  const CUT_FADE = 34;    // 断裂が閉じるまでのフレーム数

  // ------------------------------------------------------------ drawing
  // 王冠のような棘の冠: [根元の角度(度, -90=真上), 長さ(headR 比)]
  const CREST = [[-40, 0.42], [-68, 0.68], [-96, 0.84], [-124, 0.78], [-152, 0.58]];
  function head(c, sp, col, sk, pose, opt) {
    const h = sk.headC, r = sp.headR, tint = opt && opt.tint;
    const bone = col('bone'), boneD = col('boneDark'), line = col('line');
    c.save();
    c.translate(h.x, h.y);
    c.rotate((180 - sk.ha) * D);
    // 棘の冠（骨色。頭蓋の後ろに描く）
    for (const [a, len] of CREST) {
      const a0 = (a - 19) * D, a1 = (a + 19) * D, at = (a - 17) * D, rb = r * 0.86, rt = r * (0.98 + len), oy = -r * 0.1;
      R.poly(c, [Math.cos(a0) * rb, Math.sin(a0) * rb + oy, Math.cos(at) * rt, Math.sin(at) * rt + oy, Math.cos(a1) * rb, Math.sin(a1) * rb + oy], bone, line, 0.9);
      if (!tint) R.poly(c, [Math.cos(a - 2 * D) * rb * 1.04, Math.sin(a - 2 * D) * rb * 1.04 + oy, Math.cos(at) * rt * 0.93, Math.sin(at) * rt * 0.93 + oy, Math.cos(a1) * rb, Math.sin(a1) * rb + oy], 'rgba(110,94,70,0.3)');
    }
    // 頭蓋
    R.circle(c, -r * 0.05, -r * 0.08, r, bone, line);
    // 顔（上顎と歯）
    R.poly(c, [r * 0.3, -r * 0.5, r * 1.04, -r * 0.32, r * 1.1, r * 0.2, r * 1.0, r * 0.5, r * 0.96, r * 1.0, r * 0.2, r * 1.1, -r * 0.35, r * 0.62], bone, line);
    if (!tint) {
      // 冠の帯
      c.strokeStyle = boneD; c.lineWidth = 1.6;
      c.beginPath(); c.arc(-r * 0.05, -r * 0.08, r * 0.8, -168 * D, -42 * D); c.stroke();
      // 後頭部の陰
      c.fillStyle = 'rgba(50,36,22,0.32)';
      c.beginPath(); c.arc(-r * 0.05, -r * 0.08, r, 95 * D, 205 * D); c.quadraticCurveTo(-r * 0.3, r * 0.1, -r * 0.2, r * 0.9); c.closePath(); c.fill();
      // 眉弓の張り出し
      c.strokeStyle = 'rgba(255,250,235,0.55)'; c.lineWidth = 1.1;
      c.beginPath(); c.moveTo(r * 0.18, -r * 0.42); c.lineTo(r * 0.98, -r * 0.34); c.stroke();
      // 眼窩（角ばった深い穴）
      R.poly(c, [r * 0.2, -r * 0.3, r * 0.9, -r * 0.34, r * 0.96, r * 0.02, r * 0.66, r * 0.28, r * 0.3, r * 0.14], '#07060a');
      // 鼻腔
      R.poly(c, [r * 1.0, r * 0.14, r * 1.08, r * 0.46, r * 0.84, r * 0.44], '#07060a');
      // 歯
      c.fillStyle = '#1c150f';
      c.fillRect(r * 0.26, r * 0.72, r * 0.72, r * 0.07);
      c.strokeStyle = 'rgba(36,28,20,0.95)'; c.lineWidth = 0.9;
      c.beginPath();
      for (let i = 0; i < 5; i++) { const x = r * (0.36 + i * 0.14); c.moveTo(x, r * 0.58); c.lineTo(x, r * 0.98); }
      c.stroke();
      // 頬骨
      c.strokeStyle = boneD; c.lineWidth = 1;
      c.beginPath(); c.moveTo(r * 0.36, r * 0.34); c.quadraticCurveTo(-r * 0.1, r * 0.2, -r * 0.5, r * 0.42); c.stroke();
      // 眼窩の奥の微かな光（覚醒中は蒼白く燃える）
      const aw = opt.awakened;
      const k = 0.45 + Math.sin(BK.frame * 0.11) * 0.18;
      if (aw) { c.fillStyle = 'rgba(140,190,255,0.4)'; c.beginPath(); c.arc(r * 0.6, -r * 0.04, r * 0.3, 0, 7); c.fill(); }
      c.fillStyle = aw ? `rgba(225,242,255,${0.8 + k * 0.2})` : `rgba(255,196,120,${k + 0.15})`;
      c.beginPath(); c.arc(r * 0.6, -r * 0.04, r * (aw ? 0.15 : 0.1), 0, 7); c.fill();
    }
    c.restore();
  }

  /** 大きな外套: R.capeDraw を使い、静止時でも裾が背後へ広がるようにする */
  function cape(c, sp, col, sk, pose, opt) {
    const fl = pose.cape;
    pose.cape = 0.42 + (fl == null ? 0.3 : fl) * 0.8;
    R.capeDraw(c, sp, col, sk, pose, opt);
    pose.cape = fl;
  }
  /** 胴を t(0=腰,1=肩) / k(前後オフセット) で指す点 */
  function torsoPt(sk, t, k) {
    const h = sk.hip, s = sk.sho;
    const a = Math.atan2(s.y - h.y, s.x - h.x), nx = -Math.sin(a), ny = Math.cos(a);
    return [U.lerp(h.x, s.x, t) + nx * k, U.lerp(h.y, s.y, t) + ny * k];
  }
  function torso(c, sp, col, sk, pose, opt) {
    const wW = sp.waistW / 2, cW = sp.chestW / 2, P = (t, k) => torsoPt(sk, t, k);
    // 胴（漆黒の板金）
    R.poly(c, [...P(0, wW), ...P(1, cW), ...P(1, -cW * 0.9), ...P(0, -wW)], col('body'), col('line'));
    // 胸甲
    R.poly(c, [...P(0.36, wW * 1.03), ...P(0.62, cW * 1.02), ...P(1, cW * 0.98), ...P(1, -cW * 0.25), ...P(0.4, -wW * 0.3)], col('armor'), col('line'));
    if (!opt.tint) {
      c.lineWidth = 1.1;
      c.strokeStyle = col('armorHi');
      c.beginPath(); c.moveTo(...P(0.42, wW * 0.82)); c.lineTo(...P(0.64, cW * 0.84)); c.lineTo(...P(0.95, cW * 0.82)); c.stroke();
      // 腹の小札
      c.strokeStyle = 'rgba(0,0,0,0.55)';
      c.beginPath();
      for (const t of [0.13, 0.25]) { c.moveTo(...P(t, wW)); c.lineTo(...P(t, -wW)); }
      c.stroke();
      c.strokeStyle = 'rgba(120,125,140,0.35)';
      c.beginPath();
      for (const t of [0.16, 0.28]) { c.moveTo(...P(t, wW * 0.95)); c.lineTo(...P(t, 0)); }
      c.stroke();
    }
    // 剣帯
    R.limb(c, ...P(0.02, -wW), ...P(0.02, wW), 4.2, 4.2, col('belt'));
  }
  /** 首当て・草摺（頭と前脚の上に重ねる） */
  function chest(c, sp, col, sk, pose, opt) {
    const wW = sp.waistW / 2, P = (t, k) => torsoPt(sk, t, k);
    // 草摺（腰から垂れる板金）
    R.poly(c, [...P(0.02, -wW * 0.1), ...P(-0.3, -wW * 0.05), ...P(-0.28, -wW * 1.2), ...P(0.02, -wW * 1.02)], col('clothDark'), col('line'));
    R.poly(c, [...P(0.03, wW * 1.06), ...P(-0.34, wW * 1.32), ...P(-0.3, -wW * 0.12), ...P(0.03, -wW * 0.15)], col('armor'), col('line'));
    if (!opt.tint) {
      c.strokeStyle = col('armorHi'); c.lineWidth = 1;
      c.beginPath(); c.moveTo(...P(-0.02, wW * 1.02)); c.lineTo(...P(-0.3, wW * 1.24)); c.stroke();
      c.strokeStyle = 'rgba(0,0,0,0.5)';
      c.beginPath(); c.moveTo(...P(-0.14, wW * 1.15)); c.lineTo(...P(-0.13, -wW * 0.12)); c.stroke();
    }
    // 首当て（喉元の鋼）
    const s = sk.sho, h = sk.hip;
    const a = Math.atan2(s.y - h.y, s.x - h.x), nx = -Math.sin(a), ny = Math.cos(a), ux = Math.cos(a), uy = Math.sin(a);
    const Q = (n, u) => [s.x + nx * n + ux * u, s.y + ny * n + uy * u];
    R.poly(c, [...Q(10, -1.5), ...Q(6.5, 2.5), ...Q(-1, 5.5), ...Q(-8, 5), ...Q(-11.5, -1)], col('armor'), col('line'));
    if (!opt.tint) {
      c.strokeStyle = col('armorHi'); c.lineWidth = 1;
      c.beginPath(); c.moveTo(...Q(6.5, 1.8)); c.lineTo(...Q(-1, 4.6)); c.stroke();
    }
  }
  /** 長剣（原点=柄を握る手、+x 方向に刃） */
  function longsword(c, sp, col, len, pose, opt) {
    R.circle(c, -13.5, 0, 2.5, col('metalDark'), col('line'));                    // 柄頭
    R.poly(c, [-12, -1.7, -1, -1.7, -1, 1.7, -12, 1.7], col('grip'));             // 柄
    R.poly(c, [-1.2, -8.5, 2.2, -7, 2.2, 7, -1.2, 8.5], col('metalDark'), col('line')); // 十字の鍔
    R.poly(c, [2.2, -3.3, len - 10, -2.7, len, 0, len - 10, 2.7, 2.2, 3.3], col('metal'), col('line'));
    if (!opt.tint) {
      c.fillStyle = 'rgba(255,255,255,0.22)'; c.fillRect(4, -2.5, len - 17, 1);
      c.strokeStyle = 'rgba(40,44,58,0.55)'; c.lineWidth = 0.9;
      c.beginPath(); c.moveTo(5, 0.3); c.lineTo(len - 16, 0.3); c.stroke();
      if (opt.awakened) { // 霊気を帯びた刃
        c.strokeStyle = 'rgba(150,200,255,0.55)'; c.lineWidth = 2.2;
        c.beginPath(); c.moveTo(4, -3.6); c.lineTo(len - 10, -3); c.lineTo(len + 1, 0); c.stroke();
      }
    }
  }
  /** 円盾（前腕 el→hd に装着。中心は手元） */
  function shield(c, sp, col, el, hd, opt) {
    const a = Math.atan2(hd.y - el.y, hd.x - el.x);
    const r = sp.shieldR || 13;
    const rx = r * (0.62 + 0.3 * Math.abs(Math.sin(a)));
    c.save();
    c.translate(U.lerp(el.x, hd.x, 0.86), U.lerp(el.y, hd.y, 0.86));
    c.rotate(U.clamp(a, -1.4, 1.4) * 0.2);
    c.beginPath(); c.ellipse(0, 0, rx, r, 0, 0, 7);
    c.fillStyle = col('shield'); c.fill(); c.strokeStyle = col('line'); c.lineWidth = 1.2; c.stroke();
    if (!opt.tint) {
      c.strokeStyle = col('shieldRim'); c.lineWidth = 1.8;
      c.beginPath(); c.ellipse(0, 0, rx - 1.6, r - 1.6, 0, 0, 7); c.stroke();
      c.strokeStyle = 'rgba(0,0,0,0.5)'; c.lineWidth = 1;
      c.beginPath(); c.ellipse(rx * 0.08, 0, rx * 0.56, r * 0.58, 0, 0, 7); c.stroke();
      c.fillStyle = col('shieldRim');
      for (let i = 0; i < 8; i++) { const t = i / 8 * Math.PI * 2; c.fillRect(Math.cos(t) * (rx - 4.2) - 0.65, Math.sin(t) * (r - 4.2) - 0.65, 1.3, 1.3); }
      c.strokeStyle = 'rgba(255,255,255,0.18)'; c.lineWidth = 1.2;
      c.beginPath(); c.ellipse(0, 0, rx - 3.2, r - 3.2, 0, -2.5, -1.3); c.stroke();
    }
    R.circle(c, rx * 0.18, 0, r * 0.23, col('metalDark'), col('line'));        // 中央の突起
    if (!opt.tint) { c.fillStyle = 'rgba(255,255,255,0.4)'; c.beginPath(); c.arc(rx * 0.18 - 1, -1, 1.1, 0, 7); c.fill(); }
    c.restore();
  }
  function arm(c, sp, col, sh, el, hd, back, pose, opt) {
    const up = back ? col('clothDark') : col('sleeve'), lo = back ? col('gloveDark') : col('glove');
    R.limb(c, sh.x, sh.y, el.x, el.y, sp.armW, sp.armW * 0.86, up, col('line'));
    R.limb(c, el.x, el.y, hd.x, hd.y, sp.armW * 0.98, sp.armW * 0.78, lo, col('line'));
    R.circle(c, el.x, el.y, sp.armW * 0.44, back ? col('clothDark') : col('armor'), col('line')); // 肘当て
    R.circle(c, hd.x, hd.y, sp.armW * 0.5, lo, col('line'));
    if (!back && !opt.tint) {
      // 籠手の縁の光
      const a = Math.atan2(hd.y - el.y, hd.x - el.x), nx = -Math.sin(a) * sp.armW * 0.32, ny = Math.cos(a) * sp.armW * 0.32;
      const s = nx < 0 ? -1 : 1;
      c.strokeStyle = col('armorHi'); c.lineWidth = 1;
      c.beginPath(); c.moveTo(el.x + nx * s + (hd.x - el.x) * 0.2, el.y + ny * s + (hd.y - el.y) * 0.2); c.lineTo(el.x + nx * s + (hd.x - el.x) * 0.75, el.y + ny * s + (hd.y - el.y) * 0.75); c.stroke();
    }
    if (back && !(pose && pose.shieldFront)) shield(c, sp, col, el, hd, opt);
  }
  function leg(c, sp, col, hip, kn, ft, back, pose, opt) {
    const th = back ? col('clothDark') : col('cloth'), sh = back ? col('bootDark') : col('boot');
    R.limb(c, hip.x, hip.y, kn.x, kn.y, sp.legW, sp.legW * 0.82, th, col('line'));
    R.limb(c, kn.x, kn.y, ft.x, ft.y, sp.legW * 0.86, sp.legW * 0.7, sh, col('line'));
    // 鉄靴（尖った爪先）
    R.poly(c, [ft.x - 4.5, ft.y - 4, ft.x + 6, ft.y - 3, ft.x + 10.5, ft.y + 1, ft.x + 9, ft.y + 2.2, ft.x - 4.5, ft.y + 2.2], sh, col('line'));
    // 膝当て（尖った板金）
    const kc = back ? col('clothDark') : col('armor');
    R.poly(c, [kn.x - 4.5, kn.y - 3, kn.x + 1, kn.y - 5.5, kn.x + 9, kn.y - 0.5, kn.x + 1.5, kn.y + 4.5, kn.x - 4, kn.y + 3], kc, col('line'));
    if (!back && !(opt && opt.tint)) {
      // 脛当ての縁の光
      const a = Math.atan2(ft.y - kn.y, ft.x - kn.x), ox = -Math.sin(a), oy = Math.cos(a), s = ox < 0 ? -sp.legW * 0.3 : sp.legW * 0.3;
      c.strokeStyle = col('armorHi'); c.lineWidth = 1;
      c.beginPath(); c.moveTo(U.lerp(kn.x, ft.x, 0.25) + ox * s, U.lerp(kn.y, ft.y, 0.25) + oy * s); c.lineTo(U.lerp(kn.x, ft.x, 0.8) + ox * s, U.lerp(kn.y, ft.y, 0.8) + oy * s); c.stroke();
    }
  }
  /** 手前の肩当て（棘つきの二枚板）と、盾を前に構える技の盾 */
  function front(c, sp, col, sk, pose, opt) {
    const s = sk.shF;
    const arm = col('armor'), line = col('line');
    c.save();
    c.translate(s.x - 0.5, s.y + 1);
    c.rotate((180 - sk.ta) * D);
    // 後ろへ流れる棘
    R.poly(c, [-8, 0, -16, -4, -6.5, -4.5], arm, line);
    c.beginPath(); c.ellipse(0, 0.5, 9, 6.5, 0, Math.PI, Math.PI * 2); c.lineTo(8.5, 4.5); c.quadraticCurveTo(0, 7, -8.5, 4.5); c.closePath();
    c.fillStyle = arm; c.fill(); c.strokeStyle = line; c.lineWidth = 1.1; c.stroke();
    c.beginPath(); c.ellipse(0.5, 5, 8, 3.4, 0, 0, Math.PI); c.closePath();
    c.fillStyle = col('clothDark'); c.fill(); c.stroke();
    if (!opt.tint) {
      c.strokeStyle = col('armorHi'); c.lineWidth = 1.1;
      c.beginPath(); c.ellipse(0, 0.5, 7, 4.8, 0, Math.PI * 1.15, Math.PI * 1.8); c.stroke();
    }
    c.restore();
    if (pose && pose.shieldFront) shield(c, sp, col, sk.elB, sk.hdB, opt);
  }

  // ------------------------------------------------------------ effects
  /** 三日月（凸側が進行方向 dir、角は後ろへ流れる） */
  function crescent(c, x, y, dir, hh, th) {
    c.beginPath();
    c.moveTo(x - dir * th * 0.6, y - hh);
    c.quadraticCurveTo(x + dir * th * 1.9, y, x - dir * th * 0.6, y + hh);
    c.quadraticCurveTo(x + dir * th * 0.5, y, x - dir * th * 0.6, y - hh);
    c.closePath();
    c.fill();
  }
  function drawCrescentFx(c, sx, sy, dir, hh, th, alpha, trail) {
    c.globalAlpha = alpha * 0.16; c.fillStyle = '#7fb0ff';
    for (let i = 1; i <= trail; i++) crescent(c, sx - dir * i * 9, sy, dir, hh * (1 - i * 0.08), th);
    c.globalAlpha = alpha; c.fillStyle = GLOW_EDGE;
    crescent(c, sx, sy, dir, hh * 1.1, th * 1.5);
    c.fillStyle = GLOW_MID;
    crescent(c, sx, sy, dir, hh, th);
    c.fillStyle = '#ffffff';
    crescent(c, sx + dir * th * 0.28, sy, dir, hh * 0.84, th * 0.5);
    c.globalAlpha = 1;
  }
  /** 射撃「光刃」: ゆっくり進み、敵を貫く霊気の三日月 */
  function lightBlade(h) {
    const m = BK.heroShots.muzzle(h, 44, 58);
    BK.audio.sfx('swingHeavy', { pitch: 1.3 });
    BK.audio.sfx('magic', { pitch: 0.55, vol: 0.7 });
    BK.game.addProjectile(new BK.Projectile({
      x: m.x, y: m.y, z: m.z, vx: h.face * 4.4, w: 26, h: 60, team: 'hero', owner: h,
      dmg: 16, kb: 'heavy', push: 3.4, stop: 5, life: 78, pierce: 3, sfx: 'slash',
      tick(p) {
        if (p.t % 3 === 0) BK.fx.add({ type: 'dot', x: p.x - p.face * U.rand(4, 14), y: p.y + U.rand(-2, 2), z: p.z + U.rand(-26, 26), vx: -p.face * U.rand(0.2, 0.8), vz: U.rand(-0.3, 0.3), life: U.randi(10, 18), col: U.choose([GLOW, '#9cc4ff']), size: U.rand(1.2, 2.2) });
      },
      drawFn(c, sx, sy, p) {
        const grow = Math.min(1, 0.4 + p.t * 0.1);
        const a = Math.min(1, p.life / 10);
        const hh = 31 * grow * (1 + Math.sin(p.t * 0.6) * 0.04);
        drawCrescentFx(c, sx, sy, p.face, hh, 14 * grow, a, 2);
      },
    }));
  }
  /** 溜め「剣の丘」: 地を這って進む霊気の刃（何体でも貫く） */
  function groundBlade(h) {
    BK.game.addProjectile(new BK.Projectile({
      x: h.x + h.face * 92, y: h.y, z: 26, vx: h.face * 6.2, w: 36, h: 52, depth: 18, team: 'hero', owner: h,
      dmg: 14, kb: 'down', push: 4.5, lift: 5.5, stop: 4, life: 46, pierce: 99, sfx: 'slash', noShadow: true,
      tick(p) {
        if (p.t % 2 === 0) BK.fx.add({ type: 'smoke', x: p.x - p.face * 8, y: p.y + U.rand(-5, 5), z: 3, vz: U.rand(0.6, 1.8), vx: -p.face * 0.3, life: 20, size: U.rand(5, 9), col: 'rgba(130,120,125,0.45)', drag: 0.94 });
        if (p.t % 3 === 0) BK.fx.add({ type: 'line', x: p.x, y: p.y, z: U.rand(4, 40), vx: -p.face * U.rand(1, 3), vz: U.rand(0.5, 2), life: 9, col: GLOW, size: 1.3, drag: 0.9 });
      },
      drawFn(c, sx, sy, p) {
        const a = Math.min(1, p.life / 10), gy = sy + p.z;
        c.globalAlpha = 0.35 * a; c.fillStyle = '#9cc4ff';
        c.beginPath(); c.ellipse(sx - p.face * 6, gy, 30, 5, 0, 0, 7); c.fill();
        drawCrescentFx(c, sx, gy - 30, p.face, 31, 17, a * 0.95, 2);
      },
    }));
  }
  /** 地面への突き立て: 周囲の敵を衝撃で倒す */
  function quake(h, dmg, w) {
    BK.fx.ring(h.x, h.y, 2, w * 0.75, '#cfe0ff', 16);
    BK.fx.dust(h.x, h.y, 10); BK.fx.shake(5, 10);
    BK.audio.sfx('hitHeavy', { pitch: 0.6, vol: 0.8 });
    BK.game.addProjectile(new BK.Projectile({
      x: h.x, y: h.y, z: 14, vx: 0, w, h: 28, depth: 20, team: 'hero', owner: h, dmg, kb: 'down', push: 4, lift: 5,
      life: 5, pierce: 20, dirAway: true, noShadow: true, stop: 3, fx: 'none', drawFn() {},
    }));
  }
  /** 剣先の座標（ワールド） */
  function tipPos(h) {
    const sk = h.sk, sc = h.spec.scale || 1;
    if (!sk) return { x: h.x + h.face * 40, z: h.z + 100 };
    return { x: h.x + sk.tip.x * sc * h.face, z: h.z - sk.tip.y * sc };
  }

  // ---- 空間切断: 画面を斜めに走る断裂（fx の custom 粒子として最前面に描く）
  function riftGeom(p) {
    const W = BK.W, H = BK.H, d = p.dir;
    const ax = d > 0 ? -30 : W + 30, bx = d > 0 ? W + 30 : -30;
    return { ax, ay: H * 0.14, bx, by: H * 0.9 };
  }
  function drawRift(c, sx, sy, k, p) {
    p.x = BK.cam.x + BK.W / 2; // 画面外判定で消されないよう常に画面中央に置く
    const age = p.max - p.life;
    const q = p.cut ? 1 - p.life / CUT_FADE : 0;
    const a = p.cut ? Math.max(0, 1 - q) : 1;
    const g = riftGeom(p);
    const open = Math.min(1, (age + 1) / 5);
    const ex = U.lerp(g.ax, g.bx, open), ey = U.lerp(g.ay, g.by, open);
    const L = Math.hypot(g.bx - g.ax, g.by - g.ay);
    const nx = -(g.by - g.ay) / L, ny = (g.bx - g.ax) / L;
    let w;
    if (!p.cut) w = 1.6 + Math.min(1, age / 12) * 4.5 + Math.sin(age * 0.7) * 0.6;
    else w = q < 0.18 ? 6 + q / 0.18 * 12 : 18 * (1 - (q - 0.18) / 0.82);
    c.save();
    // 時の止まった世界（自前の暗転。断裂だけは暗転の上に描く）
    const dark = p.cut ? 0.55 * Math.max(0, 1 - q * 1.7) : 0.55;
    if (dark > 0) { c.fillStyle = `rgba(3,5,14,${dark.toFixed(3)})`; c.fillRect(0, 0, BK.W, BK.H); }
    if (w > 0.2 && a > 0) {
      const rnd = U.srand(p.seed + (age >> 1));
      const N = 22, top = [], bot = [], mid = [];
      for (let i = 0; i <= N; i++) {
        const t = i / N;
        const x = U.lerp(g.ax, ex, t), y = U.lerp(g.ay, ey, t);
        const T = t * open;
        let hw = w * Math.pow(Math.sin(Math.PI * T), 0.6);
        if (open < 1) hw *= Math.min(1, (1 - t) * 5);
        const j = (rnd() - 0.5) * 2.2;
        top.push(x + nx * (hw + j), y + ny * (hw + j));
        bot.push(x - nx * (hw - j * 0.5), y - ny * (hw - j * 0.5));
        mid.push(x + nx * j * 0.4, y + ny * j * 0.4);
      }
      // 外側の霊光
      c.globalAlpha = a;
      c.lineCap = 'round'; c.lineJoin = 'round';
      c.strokeStyle = 'rgba(120,170,255,0.3)'; c.lineWidth = w * 2.6 + 9;
      c.beginPath(); c.moveTo(mid[0], mid[1]); for (let i = 2; i < mid.length; i += 2) c.lineTo(mid[i], mid[i + 1]); c.stroke();
      c.strokeStyle = 'rgba(200,225,255,0.45)'; c.lineWidth = w * 1.4 + 3;
      c.stroke();
      // 裂け目の内側（虚空）
      c.beginPath(); c.moveTo(top[0], top[1]);
      for (let i = 2; i < top.length; i += 2) c.lineTo(top[i], top[i + 1]);
      for (let i = bot.length - 2; i >= 0; i -= 2) c.lineTo(bot[i], bot[i + 1]);
      c.closePath();
      c.fillStyle = p.cut && q < 0.22 ? '#f4f9ff' : '#030108';
      c.fill();
      c.strokeStyle = '#eef6ff'; c.lineWidth = 1.4; c.stroke();
      // 虚空に瞬く星
      if (!p.cut || q > 0.22) {
        c.fillStyle = 'rgba(210,190,255,0.85)';
        for (let i = 0; i < 9; i++) {
          const t = 0.08 + rnd() * 0.84;
          if (t > open) continue;
          const x = U.lerp(g.ax, g.bx, t), y = U.lerp(g.ay, g.by, t), o = (rnd() - 0.5) * w * 0.9;
          c.fillRect(x + nx * o - 0.6, y + ny * o - 0.6, 1.3, 1.3);
        }
      }
      // 走る切っ先の光
      if (open < 1) {
        c.fillStyle = 'rgba(160,200,255,0.5)'; c.beginPath(); c.arc(ex, ey, 11, 0, 7); c.fill();
        c.fillStyle = '#ffffff'; c.beginPath(); c.arc(ex, ey, 4.5, 0, 7); c.fill();
      }
    }
    c.restore();
  }
  function spawnRift(h) {
    const p = BK.fx.add({ type: 'custom', x: BK.cam.x + BK.W / 2, y: BK.DEPTH / 2, z: 0, life: 120, dir: h.face, seed: U.randi(1, 99999), cut: false, draw: drawRift });
    h._rift = p;
  }
  /** 敵に刻まれる斬線（断裂と平行） */
  function cutMark(a, rift) {
    const g = riftGeom(rift);
    const L = Math.hypot(g.bx - g.ax, g.by - g.ay), ux = (g.bx - g.ax) / L, uy = (g.by - g.ay) / L;
    BK.fx.add({
      type: 'custom', x: a.x, y: a.y, z: a.z + (a.h || 80) * 0.55, life: 16,
      draw(c, sx, sy, k) {
        const l = 34 + (1 - k) * 18;
        c.save(); c.lineCap = 'round';
        c.globalAlpha = k * 0.5; c.strokeStyle = '#8fb8ff'; c.lineWidth = 7;
        c.beginPath(); c.moveTo(sx - ux * l, sy - uy * l); c.lineTo(sx + ux * l, sy + uy * l); c.stroke();
        c.globalAlpha = k; c.strokeStyle = '#ffffff'; c.lineWidth = 2;
        c.stroke();
        c.restore();
      },
    });
  }
  /** 空間ごと断つ: 画面内の敵すべて（ボスも）に大ダメージ */
  function spaceCut(h) {
    const g = BK.game;
    if (!g) return;
    const awk0 = h.awk;
    const x0 = BK.cam.x - 16, x1 = BK.cam.x + BK.W + 16;
    const rift = h._rift;
    const hit = { dmg: CUT_DMG, kb: 'down', push: 5, lift: 7.5, stop: 0, breakArmor: true, sfx: 'none', fx: 'none' };
    for (const a of g.actors.slice()) {
      if (a === h || a.dead || a.remove) continue;
      if (a.team !== 'enemy' && !a.isProp) continue;
      if (a.x < x0 || a.x > x1) continue;
      const dir = U.sign(a.x - h.x || h.face);
      if (a.isProp) { a.takeHit(h, hit, dir); continue; }
      let ok = false;
      if (a.hurtable) ok = a.takeHit(h, hit, dir);
      else if ((a.state === 'down' || a.state === 'getup') && !a.intangible && a.hp > 0) {
        // 倒れている敵も空間ごと断つ
        const dmg = Math.max(1, Math.round(CUT_DMG * (h.dmgMul || 1) * (a.dmgTakenMul || 1)));
        a.hp -= dmg; a.flash = 6;
        h.onDealDamage(dmg, a, hit);
        if (a.hp <= 0) { a.hp = 0; a.die(h, hit, dir); }
        ok = true;
      }
      if (!ok) continue;
      const zm = a.z + (a.h || 80) * 0.55;
      if (rift) cutMark(a, rift);
      BK.fx.add({ type: 'burst', x: a.x, y: a.y, z: zm, life: 8, size: 26, col: '#eef6ff' });
      BK.fx.blood(a.x, a.y, zm, dir, 7, a.bloodCol);
    }
    h.awk = awk0; // 覚醒技そのものではゲージを溜めない
    if (rift) { rift.cut = true; rift.life = Math.min(rift.life, CUT_FADE); rift.max = Math.max(rift.max, CUT_FADE); }
    h._riftT = CUT_FADE + 4;
    BK.fx.flash('#eaf4ff', 12);
    BK.fx.shake(10, 26);
    BK.fx.stop(10);
    BK.audio.sfx('hitHeavy', { pitch: 0.5 });
    BK.audio.sfx('slash', { pitch: 0.6 });
    BK.audio.sfx('explode', { pitch: 1.5, vol: 0.6 });
  }

  // ------------------------------------------------------------ moves
  // 円舞斬り（必殺）のポーズ: 剣を掲げた「返し」と、剣を水平に伸ばした「払い」
  const SP0 = { aF: 22, eF: 150, wAbs: 182, aB: 30, eB: 80, lean: 0, lF: 22, kF: 18, lB: -22, kB: 14, drop: 3, cape: 1.4 };
  const SPX = { aF: 92, eF: 0, wAbs: 92, aB: -85, eB: 5, lean: 6, lF: 24, kF: 18, lB: -24, kB: 14, drop: 4, cape: 1.2 };
  const spinKf = [];
  for (let f = 0; f <= 36; f += 6) { spinKf.push([f, SP0, 'in']); if (f < 36) spinKf.push([f + 3, SPX, 'out']); }
  spinKf.push([46, {}]);

  const moves = {
    atk1: { // 袈裟斬り
      dur: 28, cancel: 15, trail: [7, 13],
      kf: [[0, {}], [6, { aF: 158, eF: 42, wAbs: 232, lean: -8, head: -4, aB: 55, eB: 60, lF: 16, kF: 12, lB: -18, kB: 10, cape: 0.6 }],
        [10, { aF: 98, eF: 0, wAbs: 100, lean: 16, aB: 30, eB: 70, lF: 34, kF: 32, lB: -26, kB: 6, drop: 3, cape: 1 }, 'snap'],
        [15, { aF: 62, eF: 6, wAbs: 50, lean: 18, aB: 30, eB: 70, lF: 34, kF: 32, lB: -26, kB: 6, drop: 3, cape: 1.1 }], [28, {}]],
      hits: [{ f: [9, 12], x: [12, 90], z: [8, 108], d: 18, dmg: 11, kb: 'light', push: 2.8 }],
      move: [[0, 0], [6, 2.0], [11, 0.6], [14, 0]],
      sfx: [[7, 'swingHeavy']],
    },
    atk2: { // 逆袈裟
      dur: 28, cancel: 15, trail: [7, 13],
      kf: [[0, { aF: 62, eF: 6, wAbs: 50, lean: 18, aB: 30, eB: 70, lF: 34, kF: 32, lB: -26, kB: 6, drop: 3 }],
        [5, { aF: 28, eF: 18, wAbs: 4, lean: 12, aB: 30, eB: 70, lF: 22, kF: 20, lB: -20, kB: 8 }],
        [10, { aF: 128, eF: 18, wAbs: 158, lean: -4, aB: 40, eB: 70, lF: 26, kF: 18, lB: -22, kB: 8, cape: 1 }, 'snap'],
        [14, { aF: 148, eF: 28, wAbs: 198, lean: -8, aB: 40, eB: 70 }], [28, {}]],
      hits: [{ f: [8, 12], x: [10, 88], z: [20, 128], d: 18, dmg: 11, kb: 'light', push: 2.4 }],
      move: [[0, 0], [5, 2], [10, 0.4], [13, 0]],
      sfx: [[7, 'swingHeavy']],
    },
    atk3: { // 盾打ち
      dur: 30, cancel: 17,
      kf: [[0, { aF: 148, eF: 28, wAbs: 198, lean: -8, aB: 40, eB: 70 }],
        [5, { aF: 196, eF: 28, wAbs: 238, lean: -6, aB: -15, eB: 100, lF: 10, kF: 10, lB: -18, kB: 8, shieldFront: 1 }],
        [9, { aF: 205, eF: 25, wAbs: 242, lean: 22, aB: 88, eB: 2, lF: 38, kF: 30, lB: -30, kB: 6, drop: 4, cape: 1.1, shieldFront: 1 }, 'snap'],
        [16, { aF: 205, eF: 25, wAbs: 242, lean: 20, aB: 84, eB: 8, lF: 38, kF: 30, lB: -30, kB: 6, drop: 4, shieldFront: 1 }], [30, {}]],
      hits: [{ f: [8, 11], x: [8, 66], z: [30, 104], d: 18, dmg: 12, kb: 'heavy', push: 3.8, stop: 6, sfx: 'hitHeavy', fx: 'spark' }],
      move: [[0, 0], [5, 3.8], [10, 1], [13, 0]],
      sfx: [[6, 'swing', { pitch: 0.6 }]],
    },
    atk4: { // 兜割り（フィニッシュ）
      dur: 44, trail: [10, 17],
      kf: [[0, { aF: 205, eF: 25, wAbs: 242, lean: 20, aB: 84, eB: 8, shieldFront: 1 }],
        [11, { aF: 172, eF: 18, wAbs: 188, lean: -12, head: -6, aB: 50, eB: 60, lF: 12, kF: 12, lB: -22, kB: 12, cape: 0.8 }],
        [16, { aF: 86, eF: 0, wAbs: 74, lean: 30, aB: 30, eB: 70, lF: 44, kF: 44, lB: -30, kB: 4, drop: 7, cape: 1.4 }, 'snap'],
        [28, { aF: 84, eF: 0, wAbs: 72, lean: 28, aB: 30, eB: 70, lF: 44, kF: 44, lB: -30, kB: 4, drop: 7 }], [44, {}]],
      hits: [{ f: [14, 17], x: [10, 104], z: [0, 122], d: 20, dmg: 21, kb: 'down', push: 5.5, lift: 6, stop: 9 }],
      move: [[0, 0], [9, 2.8], [16, 0]],
      sfx: [[11, 'swingHeavy']],
      onFrame(h, f) { if (f === 16) { BK.fx.shake(6, 12); BK.fx.dust(h.x + h.face * 84, h.y, 8); } },
    },
    dash: { // 盾突進（スーパーアーマー）
      dur: 34, armor: true,
      kf: [[0, { aB: 82, eB: 8, aF: -30, eF: 25, wAbs: -78, lean: 26, lF: 44, kF: 40, lB: -34, kB: 10, cape: 1.3, shieldFront: 1 }],
        [6, { aB: 86, eB: 4, aF: -35, eF: 25, wAbs: -82, lean: 32, lF: 55, kF: 30, lB: -42, kB: 5, drop: 5, cape: 1.5, shieldFront: 1 }],
        [22, { aB: 86, eB: 4, aF: -35, eF: 25, wAbs: -82, lean: 30, lF: 55, kF: 30, lB: -42, kB: 5, drop: 5, cape: 1.4, shieldFront: 1 }], [34, {}]],
      hits: [{ f: [3, 20], x: [8, 62], z: [20, 100], d: 18, dmg: 14, kb: 'down', push: 6.5, lift: 4.5, stop: 6, sfx: 'hitHeavy', fx: 'spark' }],
      move: [[0, 7.2], [12, 6.4], [18, 3], [24, 0]],
      sfx: [[1, 'swingHeavy', { pitch: 0.7 }]],
      onFrame(h, f) { if (f < 20 && f % 3 === 0) BK.fx.dust(h.x - h.face * 12, h.y, 2); },
    },
    jumpAtk: { // 空中からの兜割り（落下を早める）
      air: true, dur: 60, trail: [2, 11],
      kf: [[0, { aF: 165, eF: 30, wAbs: 205, lF: 50, kF: 90, lB: 0, kB: 80, lean: -8, aB: 50, eB: 70 }],
        [5, { aF: 98, eF: 0, wAbs: 100, lF: 60, kF: 90, lB: 10, kB: 90, lean: 16, aB: 30, eB: 70 }, 'snap'],
        [10, { aF: 45, eF: 0, wAbs: 28, lF: 60, kF: 90, lB: 10, kB: 90, lean: 22, aB: 30, eB: 70 }],
        [60, { aF: 45, eF: 0, wAbs: 25, lF: 40, kF: 60, lB: 0, kB: 50, lean: 12, aB: 30, eB: 70 }]],
      hits: [{ f: [3, 12], x: [0, 94], z: [-45, 100], d: 18, dmg: 14, kb: 'down', push: 4 }],
      sfx: [[2, 'swingHeavy']],
      onFrame(h, f) { if (f === 4 && h.vz > 1.5) h.vz = 1.5; },
    },
    downAtk: { // 突き下ろし → 着地の衝撃
      air: true, dur: 90, trail: [5, 90],
      kf: [[0, { aF: 170, eF: 10, wAbs: 182, lF: 60, kF: 100, lB: 10, kB: 90, aB: 50, eB: 70 }],
        [6, { aF: 16, eF: 6, wAbs: 2, lF: 36, kF: 76, lB: -12, kB: 56, lean: 8, aB: 40, eB: 80 }, 'snap'],
        [90, { aF: 16, eF: 6, wAbs: 2, lF: 36, kF: 76, lB: -12, kB: 56, lean: 8, aB: 40, eB: 80 }]],
      hits: [{ f: [6, 90], x: [-8, 42], z: [-55, 34], d: 18, dmg: 16, kb: 'down', push: 3 }],
      onFrame(h, f) { if (f === 6) { h.vz = -9; h.vx *= 0.3; BK.audio.sfx('swingHeavy'); } },
      onEnd(h) { if (h.z <= 0.5 && !h.dead && BK.game) quake(h, 9, 120); },
    },
    rising: { // 昇り斬り（↓↑+斬）
      dur: 36, trail: [5, 12], invul: [0, 10],
      kf: [[0, { aF: 20, eF: 10, wAbs: -25, lean: 22, lF: 40, kF: 70, lB: -20, kB: 60, aB: 60, eB: 50 }],
        [4, { aF: 30, eF: 10, wAbs: 15, lean: 16, lF: 40, kF: 70, lB: -20, kB: 60, aB: 60, eB: 50 }],
        [10, { aF: 165, eF: 8, wAbs: 176, lean: -10, lF: 20, kF: 30, lB: -20, kB: 40, aB: 60, eB: 60, cape: 1.3 }, 'snap'],
        [36, { aF: 155, eF: 10, wAbs: 186, lean: -5, lF: 30, kF: 50, lB: -10, kB: 40, aB: 60, eB: 60 }]],
      hits: [{ f: [5, 11], x: [5, 76], z: [0, 140], d: 18, dmg: 14, kb: 'launch', lift: 9, push: 1.5 }],
      onFrame(h, f) { if (f === 4) { h.vz = 6; h.z = 0.5; h.vx = h.face * 1.4; } },
      sfx: [[5, 'swingHeavy']],
    },
    charge: { // 溜め「剣の丘」: 大上段の一撃 + 地を這う霊刃
      dur: 52, trail: [14, 20], armor: true, trailCol: '#e6f2ff',
      kf: [[0, { aF: 165, eF: 35, wAbs: 215, lean: -10, lF: 14, kF: 14, lB: -20, kB: 12, aB: 50, eB: 60 }],
        [13, { aF: 172, eF: 25, wAbs: 225, lean: -14, lF: 14, kF: 14, lB: -20, kB: 12, aB: 50, eB: 60, cape: 0.8 }],
        [18, { aF: 82, eF: 0, wAbs: 76, lean: 32, lF: 46, kF: 46, lB: -32, kB: 4, drop: 7, aB: 30, eB: 70, cape: 1.4 }, 'snap'],
        [34, { aF: 82, eF: 0, wAbs: 76, lean: 32, lF: 46, kF: 46, lB: -32, kB: 4, drop: 7, aB: 30, eB: 70 }], [52, {}]],
      hits: [{ f: [16, 20], x: [10, 108], z: [0, 130], d: 20, dmg: 30, kb: 'down', push: 6, lift: 6, stop: 9 }],
      move: [[0, 0], [13, 2], [18, 0]],
      sfx: [[13, 'swingHeavy']],
      onFrame(h, f) {
        if (f < 13 && f % 3 === 0) { const t = tipPos(h); BK.fx.add({ type: 'dot', x: t.x + U.rand(-6, 6), y: h.y, z: t.z + U.rand(-6, 6), vz: U.rand(0.3, 1.2), life: 14, col: GLOW, size: 2 }); }
        if (f === 18) {
          BK.fx.shake(8, 14); BK.fx.dust(h.x + h.face * 90, h.y, 12);
          BK.audio.sfx('hitHeavy', { pitch: 0.55 });
          BK.audio.sfx('magic', { pitch: 0.45, vol: 0.8 });
          groundBlade(h);
        }
      },
    },
    special: { // 必殺（体力消費）: 円舞斬り（無敵・前後を薙ぎ払う）
      dur: 46, trail: [2, 38], invul: [0, 40], trailCol: '#eef4ff',
      kf: spinKf,
      hits: [{ f: [2, 38], x: [-100, 100], z: [0, 125], d: 24, dmg: 9, kb: 'spin', multi: 9, dirAway: true, push: 5, lift: 5 }],
      sfx: [[1, 'swingHeavy']],
      onFrame(h, f) {
        if (f === 1) BK.fx.ring(h.x, h.y, 2, 110, '#e0ecff', 20);
        if (f > 0 && f <= 36 && f % 6 === 0) { // 体ごと振り返りながら回る
          h.face = -h.face;
          BK.fx.ring(h.x, h.y, 55, 95, 'rgba(220,235,255,0.8)', 10);
          BK.audio.sfx(f % 12 === 0 ? 'swingHeavy' : 'swing', { pitch: 0.8 });
        }
      },
    },
    knee: { // 掴み中: 膝当ての棘で膝蹴り
      dur: 18,
      kf: [[0, { lF: 20, kF: 20, aF: 205, eF: 25, wAbs: 240, aB: 75, eB: 20, lean: 10 }],
        [6, { lF: 100, kF: 70, lean: -6, aF: 205, eF: 25, wAbs: 240, aB: 70, eB: 40 }],
        [18, { lF: 20, kF: 20, aF: 205, eF: 25, wAbs: 240, aB: 75, eB: 20, lean: 10 }]],
      hits: [{ f: [5, 7], x: [0, 48], z: [20, 75], d: 16, dmg: 7, kb: 'light', grabHit: true, keepGrab: true, stop: 5, sfx: 'hitHeavy' }],
    },
    throw: { // 重い投げ（遠くまで放り投げて他の敵を巻き込む）
      dur: 34,
      kf: [[0, { aF: 90, eF: 30, aB: 80, eB: 30, lean: 12, wAbs: 120 }],
        [12, { aF: 170, eF: 20, aB: 165, eB: 20, lean: -18, lF: 10, kF: 10, lB: -30, kB: 10, wAbs: 200 }],
        [17, { aF: 80, eF: 10, aB: 70, eB: 10, lean: 28, lF: 36, kF: 32, lB: -30, kB: 6, drop: 4, wAbs: 60 }, 'snap'], [34, {}]],
      onFrame(h, f) {
        if (f !== 14) return;
        const e = h.grabbing;
        h.releaseThrow();
        if (e) { e.vx *= 1.3; e.vz = 7.5; }
        BK.fx.shake(5, 10); BK.fx.dust(h.x + h.face * 30, h.y, 6);
      },
    },
    subShoot: { // 拾った武器を投げる／撃つ（光刃の大振りではなく素早い片手動作）
      dur: 10, cancelShot: 5,
      kf: [[0, { aB: 60, eB: 40, lean: 6 }], [3, { aB: 95, eB: 0, lean: 10 }, 'snap'], [10, { aB: 70, eB: 20, lean: 6 }]],
    },
    shoot: { // 光刃: 横薙ぎで霊気の三日月を放つ
      dur: 22, cancelShot: 12, trail: [1, 6], trailCol: '#d6eaff',
      kf: [[0, { aF: 150, eF: 40, wAbs: 225, lean: -6, aB: 40, eB: 70 }],
        [4, { aF: 96, eF: 0, wAbs: 96, lean: 14, lF: 30, kF: 26, lB: -24, kB: 6, aB: 30, eB: 70 }, 'snap'],
        [10, { aF: 84, eF: 0, wAbs: 82, lean: 14, lF: 30, kF: 26, lB: -24, kB: 6, aB: 30, eB: 70 }], [22, {}]],
    },
    awaken: { // 空間切断: 剣を掲げて霊気を集め、世界ごと斜めに断つ
      dur: 76, invul: [0, 76], trail: [41, 48], trailCol: '#f2f8ff',
      kf: [[0, {}], [14, { aF: 172, eF: 4, wAbs: 180, lean: -8, head: -12, aB: 50, eB: 70, lF: 18, kF: 14, lB: -20, kB: 12, cape: 1.1 }],
        [40, { aF: 176, eF: 2, wAbs: 184, lean: -10, head: -14, aB: 55, eB: 70, lF: 20, kF: 14, lB: -22, kB: 12, cape: 1.4 }],
        [46, { aF: 70, eF: 0, wAbs: 52, lean: 30, head: 4, aB: 20, eB: 80, lF: 46, kF: 46, lB: -32, kB: 4, drop: 7, cape: 1.6 }, 'snap'],
        [76, { aF: 68, eF: 0, wAbs: 50, lean: 28, head: 2, aB: 20, eB: 80, lF: 46, kF: 46, lB: -32, kB: 4, drop: 7, cape: 1.2 }]],
      onFrame(h, f) {
        if (f > 4 && f < 42) { // 剣先へ霊気が集まる
          const t = tipPos(h), ang = Math.random() * Math.PI * 2, dist = U.rand(40, 80);
          const ox = Math.cos(ang) * dist, oz = Math.sin(ang) * dist;
          BK.fx.add({ type: 'line', x: t.x + ox, y: h.y + 1, z: t.z + oz, vx: -ox / 9, vz: -oz / 9, life: 9, col: U.choose([GLOW, '#9cc4ff']), size: 1.6 });
        }
        if (f === 14) { BK.audio.sfx('magic', { pitch: 0.5 }); BK.fx.ring(h.x, h.y, 2, 90, '#bcd8ff', 24); }
        if (f === 30) BK.audio.sfx('magic', { pitch: 0.75, vol: 0.8 });
        if (f === 44) {
          BK.fx.flash('#ffffff', 8); BK.fx.shake(8, 20);
          BK.audio.sfx('swingHeavy', { pitch: 0.7 }); BK.audio.sfx('slash', { pitch: 0.5 });
          spawnRift(h);
        }
        if (f >= 44) {
          BK.fx.darken = 0; // 以降の暗転は断裂の描画側で行う（断裂を暗転の上に描くため）
          const p = h._rift; // 粒子が溢れて断裂が押し出されたら戻す
          if (p && p.life > 0 && BK.fx.parts.indexOf(p) < 0) BK.fx.parts.push(p);
        }
      },
    },
  };

  BK.registerHero({
    id: 'skull', name: '髑髏の騎士', title: '使徒を狩る者',
    desc: '漆黒の甲冑に髑髏の兜。最も重く、最も打たれ強い。\n長剣の重い連撃と盾打ち、\n霊気の三日月「光刃」で使徒を断つ。',
    stats: { life: 5, power: 4, speed: 2, reach: 4, shot: 3 },
    color: '#d8cfb4',
    maxHp: 190, walk: 1.8, walkY: 1.2, run: 3.8, jumpV: 9.0, jumpVX: 2.4, runJumpVX: 4.2, weight: 1.7, w: 32, h: 102,
    specialCost: 0.08, throwDmg: 24, shadowR: 22,
    spec: {
      scale: 1.15, thigh: 21, shin: 20, torso: 31, neck: 2, headR: 9.2, upper: 18, fore: 17,
      legW: 12.5, armW: 10, waistW: 18, chestW: 31, shoulderOff: 3, weaponLen: 60, gripDist: 10, capeLen: 72, shieldR: 13,
      colors: {
        bone: '#ddd4bd', boneDark: '#a39a82', skin: '#ddd4bd', hair: '#121114',
        cloth: '#25262d', clothDark: '#17171c', sleeve: '#282930', body: '#22232a', armor: '#343641', armorHi: '#7a7f92',
        belt: '#3a332c', boot: '#212229', bootDark: '#141418', glove: '#2b2c34', gloveDark: '#19191e',
        metal: '#b9bec9', metalDark: '#4d505b', grip: '#221a1c', cape: '#131117',
        shield: '#2b2c35', shieldRim: '#948f7e', line: 'rgba(3,2,5,0.92)',
      },
      draw: { cape, head, torso, chest, weapon: longsword, arm, leg, front },
    },
    stance: { lean: 5, head: 0, aF: 18, eF: 42, aB: 40, eB: 70, lF: 14, kF: 10, lB: -16, kB: 8, wAbs: 64, cape: 0.3 },
    walkOpt: { lockArms: true, stride: 20 },
    runOpt: { lockB: true, stride: 36, lean: 12 },
    anim: {
      jump(h) {
        const up = h.vz > 0;
        return R.merge(h.stance, { lF: up ? 55 : 30, kF: up ? 90 : 45, lB: up ? -5 : -20, kB: up ? 80 : 35, lean: 8, aF: 120, eF: 40, wAbs: 160, aB: 60, eB: 60, cape: 1.3 });
      },
      grab(h) { return R.merge(h.stance, { lean: 12, aB: 78, eB: 18, aF: 205, eF: 25, wAbs: 240, lF: 24, kF: 20, lB: -20, kB: 6 }); },
      crouch(h) { return R.merge(h.stance, { lF: 50, kF: 80, lB: -10, kB: 70, lean: 16, drop: 3 }); },
    },
    moves,
    shot: {
      name: '光刃', max: 3, regen: 45, cd: 26, auto: false, air: false,
      fire(h) { lightBlade(h); },
      hint: '低速で敵を貫く霊気の三日月',
    },
    awaken: {
      name: '空間切断', type: 'screen', dur: AWK_DUR,
      colors: { metal: '#e4f1ff', armorHi: '#9cb9e6' },
      start(h) {
        spaceCut(h);
        // 断ったあとは霊気の鎧を纏う（しばらく怯まず、被ダメージ減）
        h.awkT = AWK_DUR; h.superArmor = 1; h.dmgTakenMul = 0.7;
      },
      update(h) {
        if (h._riftT > 0) {
          h._riftT--;
          // 粒子が多すぎて断裂が押し出された場合は戻す
          const p = h._rift;
          if (p && p.life > 0 && BK.fx.parts.indexOf(p) < 0) BK.fx.parts.push(p);
          if (h._riftT === 0) h._rift = null;
        }
        if (h.awkT % 5 === 0) BK.fx.add({ type: 'smoke', x: h.x + U.rand(-16, 16), y: h.y, z: U.rand(20, 100), vz: U.rand(0.6, 1.4), life: 26, size: U.rand(4, 8), col: 'rgba(150,190,255,0.22)' });
      },
      end(h) { h.superArmor = 0; h.dmgTakenMul = 1; },
    },
    init(h) { h.downAfter = 5; h.trailCol = '#e4ecf8'; },
    drawBack(c, h) {
      if (h.awkT <= 0) return;
      const sx = BK.sx(h.x), sy = BK.sy(h.y, h.z) - 56;
      const k = 0.6 + Math.sin(BK.frame * 0.2) * 0.2;
      const g = c.createRadialGradient(sx, sy, 6, sx, sy, 72);
      g.addColorStop(0, `rgba(130,180,255,${0.26 * k})`); g.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = g; c.beginPath(); c.arc(sx, sy, 72, 0, 7); c.fill();
    },
    drawFront(c, h) {
      // 空間切断の溜め: 剣先に霊気の光球
      if (h.move !== moves.awaken || h.mf >= 44 || h.mf < 6) return;
      const t = tipPos(h), sx = BK.sx(t.x), sy = BK.sy(h.y, t.z);
      const r = 3 + Math.min(1, (h.mf - 6) / 34) * 7 + Math.sin(BK.frame * 0.8) * 0.8;
      c.fillStyle = 'rgba(130,180,255,0.3)'; c.beginPath(); c.arc(sx, sy, r * 2.3, 0, 7); c.fill();
      c.fillStyle = 'rgba(210,230,255,0.75)'; c.beginPath(); c.arc(sx, sy, r * 1.3, 0, 7); c.fill();
      c.fillStyle = '#ffffff'; c.beginPath(); c.arc(sx, sy, r * 0.7, 0, 7); c.fill();
    },
  });
})(window.BK);

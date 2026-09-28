'use strict';
/* =====================================================================
 *  hero_schierke.js ── シールケ（魔女の弟子）
 *  体は小さく打たれ弱いが、射撃（魔術）は最強。自動で敵を追う「精霊の火」、
 *  風・雷・火を宿した杖術、溜めで火の精霊（サラマンダー）の火柱、
 *  必殺は「風の結界」、覚醒は画面全体を四大精霊が薙ぎ払う「四大精霊召喚」。
 *  （AvP の Predator Hunter ─ 身軽で肩キャノン主体のキャラ ─ に相当）
 * ===================================================================== */
(function (BK) {
  const U = BK.U, R = BK.rig, D = U.DEG;

  // 魔術の色
  const WIND = ['#c8f7e6', '#ffffff', '#9fe8d0'];
  const ELEC = ['#ffffff', '#cfe0ff', '#8fb4ff'];
  const FIRE = ['#ffd070', '#ff7a1a', '#fff0b0', '#ff5010'];
  const ELEM = ['#c8f7e6', '#cfe0ff', '#d8b890', '#ff9a40']; // 風・雷・地・火
  const GEM = '#a8f7de';

  // ============================================================ drawing
  /** 頭: 顔・後ろ髪・大きなとんがり帽子（シルエットの要） */
  function head(c, sp, col, sk, pose, opt) {
    const h = sk.headC, r = sp.headR, tint = opt && opt.tint;
    c.save();
    c.translate(h.x, h.y);
    c.rotate((180 - sk.ha) * D);
    // 顔
    R.circle(c, 0, 0, r, col('skin'), col('line'));
    // 後頭部の髪
    c.beginPath(); c.arc(-r * 0.05, 0, r + 0.9, Math.PI * 0.42, Math.PI * 1.62); c.closePath();
    c.fillStyle = col('hair'); c.fill();
    // 前髪（つばの下からのぞく）
    R.poly(c, [-r * 0.3, -r * 1.0, r * 1.02, -r * 0.62, r * 0.98, -r * 0.18, r * 0.78, -r * 0.4, r * 0.6, -r * 0.08, r * 0.4, -r * 0.42, r * 0.12, -r * 0.1, -r * 0.2, -r * 0.5], col('hair'));
    if (!tint) {
      // つばの影
      c.fillStyle = 'rgba(20,10,30,0.3)';
      c.beginPath(); c.ellipse(r * 0.35, -r * 0.42, r * 0.85, r * 0.3, 0, 0, Math.PI * 2); c.fill();
      // 大きな瞳
      c.fillStyle = '#1e1224';
      c.beginPath(); c.ellipse(r * 0.52, r * 0.1, r * 0.15, r * 0.22, 0, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#9ff5dc'; c.fillRect(r * 0.5, r * 0.02, 1, 1);
      // 口
      c.strokeStyle = 'rgba(110,50,50,0.8)'; c.lineWidth = 0.8;
      c.beginPath(); c.moveTo(r * 0.58, r * 0.62); c.lineTo(r * 0.8, r * 0.58); c.stroke();
    }
    // ---- 帽子
    const cape = pose.cape == null ? 0.3 : pose.cape;
    const sw = Math.sin((opt.t || 0) * 0.05) * r * 0.1 - cape * r * 0.28; // 先端のなびき
    const by = -r * 0.5;
    // つば（とても広く、後ろが垂れる）
    const bk = -r * 3.2, bkY = by + r * 0.62 + cape * r * 0.1, fr = r * 3.3, frY = by - r * 0.04;
    c.beginPath();
    c.moveTo(bk, bkY);
    c.quadraticCurveTo(-r * 1.7, by - r * 0.52, 0, by - r * 0.5);
    c.quadraticCurveTo(r * 1.9, by - r * 0.5, fr, frY);
    c.quadraticCurveTo(r * 1.8, by + r * 0.52, 0, by + r * 0.36);
    c.quadraticCurveTo(-r * 1.8, by + r * 0.38, bk, bkY);
    c.closePath();
    c.fillStyle = col('hat'); c.fill();
    c.strokeStyle = col('line'); c.lineWidth = 1.1; c.stroke();
    // つばの裏（暗く）
    c.beginPath();
    c.moveTo(fr, frY);
    c.quadraticCurveTo(r * 1.8, by + r * 0.52, 0, by + r * 0.36);
    c.quadraticCurveTo(-r * 1.8, by + r * 0.38, bk, bkY);
    c.quadraticCurveTo(-r * 1.6, by + r * 0.02, 0, by + r * 0.02);
    c.quadraticCurveTo(r * 1.9, by - r * 0.04, fr, frY);
    c.fillStyle = col('hatDark'); c.fill();
    // 山（先が後ろへ折れる）
    const cb = by - r * 0.36;
    c.beginPath();
    c.moveTo(-r * 1.02, cb);
    c.quadraticCurveTo(-r * 0.8, cb - r * 1.3, -r * 0.8 + sw * 0.4, cb - r * 2.15);
    c.quadraticCurveTo(-r * 1.1 + sw * 0.8, cb - r * 2.6, -r * 2.25 + sw, cb - r * 2.45 - sw * 0.2);
    c.quadraticCurveTo(-r * 0.9 + sw * 0.6, cb - r * 3.2, r * 0.12 + sw * 0.3, cb - r * 2.3);
    c.quadraticCurveTo(r * 0.62, cb - r * 1.2, r * 1.02, cb);
    c.closePath();
    c.fillStyle = col('hat'); c.fill(); c.stroke();
    // 帽子の帯
    R.poly(c, [-r * 1.02, cb + 0.5, -r * 0.93, cb - r * 0.44, r * 0.9, cb - r * 0.44, r * 1.02, cb + 0.5], col('band'), col('line'));
    if (!tint) {
      // リムライト
      c.strokeStyle = col('hatHi'); c.lineWidth = 1;
      c.beginPath(); c.moveTo(-r * 0.3, by - r * 0.48); c.quadraticCurveTo(r * 1.9, by - r * 0.46, r * 3.1, by - r * 0.08); c.stroke();
      c.beginPath(); c.moveTo(r * 0.85, cb - r * 0.5); c.quadraticCurveTo(r * 0.55, cb - r * 1.3, r * 0.05 + sw * 0.3, cb - r * 2.25); c.stroke();
    }
    c.restore();
  }

  /** 短い外套 + 腰まで届く長い黒髪（体の後ろ） */
  function capeAndHair(c, sp, col, sk, pose, opt) {
    R.capeDraw(c, sp, col, sk, pose, opt);
    const hc = sk.headC, r = sp.headR, s = sk.sho, hp = sk.hip;
    const fl = pose.cape == null ? 0.3 : pose.cape;
    const t = (opt.t || 0) * 0.12;
    const wv = Math.sin(t) * 1.6 * (0.5 + fl);
    const back = fl * 9;
    const tipX = s.x - 9 - back + wv, tipY = hp.y + 2 - fl * 7;
    c.beginPath();
    c.moveTo(hc.x - r * 0.2, hc.y - r * 0.7);
    c.quadraticCurveTo(hc.x - r * 1.6, hc.y - r * 0.1, s.x - 9 - back * 0.4, s.y + 5);
    c.quadraticCurveTo(s.x - 12 - back * 0.8 + wv, (s.y + hp.y) / 2 + 2, tipX, tipY);
    c.lineTo(tipX + 3, tipY - 4); c.lineTo(tipX + 6, tipY + 1); c.lineTo(tipX + 8, tipY - 5);
    c.quadraticCurveTo(s.x - 3 - back * 0.3, s.y + 8, hc.x + r * 0.1, hc.y + r * 0.4);
    c.closePath();
    c.fillStyle = col('hair'); c.fill();
    c.strokeStyle = col('line'); c.lineWidth = 1.1; c.stroke();
    if (!opt.tint) {
      c.strokeStyle = col('hairHi'); c.lineWidth = 1;
      c.beginPath(); c.moveTo(hc.x - r * 1.0, hc.y + r * 0.2); c.quadraticCurveTo(s.x - 10 - back * 0.6, s.y + 10, tipX + 2, tipY - 6); c.stroke();
    }
  }

  /** 胴: ローブの身頃・白い襟・首飾り */
  function torso(c, sp, col, sk) {
    const h = sk.hip, s = sk.sho;
    const a = Math.atan2(s.y - h.y, s.x - h.x), ux = Math.cos(a), uy = Math.sin(a), nx = -uy, ny = ux;
    const wW = sp.waistW / 2, cW = sp.chestW / 2;
    R.poly(c, [h.x + nx * wW, h.y + ny * wW, s.x + nx * cW, s.y + ny * cW, s.x - nx * cW * 0.9, s.y - ny * cW * 0.9, h.x - nx * wW, h.y - ny * wW], col('body'), col('line'));
    // 白い襟（顔まわりを明るくして見やすく）
    R.poly(c, [
      s.x - nx * 3 + ux * 2, s.y - ny * 3 + uy * 2,
      s.x + nx * (cW + 0.5) + ux * 1, s.y + ny * (cW + 0.5) + uy * 1,
      s.x + nx * (cW + 1.5) - ux * 6, s.y + ny * (cW + 1.5) - uy * 6,
      s.x + nx * 3 - ux * 5, s.y + ny * 3 - uy * 5,
      s.x - nx * 1 - ux * 2, s.y - ny * 1 - uy * 2,
    ], col('collar'), col('line'));
    // 首飾り（精霊の護符）
    const px = s.x + nx * cW * 0.62 - ux * 9, py = s.y + ny * cW * 0.62 - uy * 9;
    R.circle(c, px, py, 1.7, col('gold'), col('line'));
  }

  /** ローブの裾（脚の付け根から扇状に広がり、脚をほぼ隠す）+ 腰紐 */
  function chest(c, sp, col, sk, pose, opt) {
    const h = sk.hip, s = sk.sho;
    const a = Math.atan2(s.y - h.y, s.x - h.x), nx = -Math.sin(a), ny = Math.cos(a);
    const wW = sp.waistW / 2 + 0.5;
    let a0 = Math.min(pose.lF, pose.lB) - 15, a1 = Math.max(pose.lF, pose.lB) + 15;
    if (a1 - a0 < 46) { const m = (a0 + a1) / 2; a0 = m - 23; a1 = m + 23; }
    const L = sp.thigh + sp.shin * 0.58;
    const fl = pose.cape == null ? 0.3 : pose.cape;
    const t = (opt.t || 0) * 0.2;
    const N = 7, hem = [];
    for (let i = 0; i <= N; i++) {
      const ang = (a1 + (a0 - a1) * i / N) * D;
      const rr = L * (i % 2 ? 1.04 : 0.98) + Math.sin(t + i * 1.7) * 0.9 * (0.4 + fl);
      hem.push(h.x + Math.sin(ang) * rr, h.y + Math.cos(ang) * rr);
    }
    const pts = [h.x - nx * wW, h.y - ny * wW - 2, h.x + nx * wW, h.y + ny * wW - 2].concat(hem);
    R.poly(c, pts, col('robe'), col('line'));
    // ひだ
    c.strokeStyle = col('robeDark'); c.lineWidth = 1.2;
    c.beginPath();
    for (const q of [2, 5]) { c.moveTo(h.x + (hem[q * 2] - h.x) * 0.35, h.y + (hem[q * 2 + 1] - h.y) * 0.35); c.lineTo(hem[q * 2], hem[q * 2 + 1]); }
    c.stroke();
    // 裾の縁取り
    c.strokeStyle = col('trim'); c.lineWidth = 1.3;
    c.beginPath(); c.moveTo(hem[0], hem[1]);
    for (let i = 2; i < hem.length; i += 2) c.lineTo(hem[i], hem[i + 1]);
    c.stroke();
    // 腰紐
    R.limb(c, h.x - nx * wW, h.y - ny * wW - 1, h.x + nx * wW, h.y + ny * wW - 1, 3.6, 3.6, col('belt'));
    R.circle(c, h.x + nx * wW * 0.55, h.y + ny * wW * 0.55 + 1.5, 1.5, col('gold'));
  }

  /** 脚: 黒いタイツと短いブーツ（大半はローブに隠れる） */
  function leg(c, sp, col, hip, kn, ft, back) {
    const st = back ? col('stockDark') : col('stock');
    const bt = back ? col('bootDark') : col('boot');
    R.limb(c, hip.x, hip.y, kn.x, kn.y, sp.legW, sp.legW * 0.8, st, col('line'));
    R.limb(c, kn.x, kn.y, ft.x, ft.y, sp.legW * 0.78, sp.legW * 0.62, st, col('line'));
    const bx = U.lerp(kn.x, ft.x, 0.5), by = U.lerp(kn.y, ft.y, 0.5);
    R.limb(c, bx, by, ft.x, ft.y, sp.legW * 0.85, sp.legW * 0.72, bt, col('line'));
    R.poly(c, [ft.x - 3, ft.y - 3, ft.x + 5.5, ft.y - 1.5, ft.x + 6.5, ft.y + 1.5, ft.x - 3, ft.y + 1.5], bt, col('line'));
  }

  /** 腕: 袖口の広がった魔女の袖 */
  function arm(c, sp, col, sh, el, hd, back) {
    const cl = back ? col('sleeveDark') : col('sleeve');
    R.circle(c, hd.x, hd.y, sp.armW * 0.48, back ? col('skinDark') : col('skin'), col('line'));
    R.limb(c, sh.x, sh.y, el.x, el.y, sp.armW, sp.armW * 0.9, cl, col('line'));
    const dx = hd.x - el.x, dy = hd.y - el.y, L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L, nx = -uy, ny = ux;
    const cx = el.x + dx * 0.78, cy = el.y + dy * 0.78, w0 = sp.armW * 0.45, w1 = sp.armW * 1.0;
    R.poly(c, [el.x + nx * w0 - ux, el.y + ny * w0 - uy, cx + nx * w1 + ux * 1.5, cy + ny * w1 + uy * 1.5,
      cx - nx * w1 - ux * 0.5, cy - ny * w1 - uy * 0.5, el.x - nx * w0 - ux, el.y - ny * w0 - uy], cl, col('line'));
  }

  /** 杖: 節くれだった木の杖。杖頭の枝が光る精霊石を抱く */
  function staff(c, sp, col, len, pose, opt) {
    const tint = opt && opt.tint;
    R.limb(c, -16, 0, len - 4, 0, 3.5, 2.8, col('wood'), col('line'));
    c.fillStyle = col('woodDark');
    c.fillRect(5, -1.8, 1.8, 3.6); c.fillRect(21, -1.6, 1.8, 3.2); c.fillRect(-10, -1.8, 1.8, 3.6);
    const gx = len + 1;
    // 杖頭の枝（2 本の爪 + 渦巻き）
    c.lineCap = 'round';
    for (let pass = 0; pass < 2; pass++) {
      c.strokeStyle = pass ? col('wood') : col('line'); c.lineWidth = pass ? 2.2 : 3.8;
      c.beginPath();
      c.moveTo(len - 6, 0); c.bezierCurveTo(len - 3, -6.5, len + 5, -7.5, len + 7.5, -2.5);
      c.quadraticCurveTo(len + 9.5, 1.5, len + 6.5, 1.2);
      c.moveTo(len - 6, 0); c.bezierCurveTo(len - 3, 6.5, len + 4, 7.5, len + 6, 4);
      c.stroke();
    }
    c.lineCap = 'butt';
    if (!tint) {
      const a0 = c.globalAlpha;
      const g = pose.glow ? 1 : 0.45 + Math.sin((opt.t || 0) * 0.12) * 0.12;
      c.fillStyle = GEM;
      c.globalAlpha = a0 * (0.14 + 0.16 * g); c.beginPath(); c.arc(gx, 0, 7 + g * 5, 0, Math.PI * 2); c.fill();
      c.globalAlpha = a0 * (0.3 + 0.25 * g); c.beginPath(); c.arc(gx, 0, 4.2 + g, 0, Math.PI * 2); c.fill();
      c.globalAlpha = a0;
    }
    R.circle(c, gx, 0, 2.8, col('gem'), col('line'));
    if (!tint) { c.fillStyle = '#ffffff'; c.fillRect(gx - 1.3, -1.5, 1.3, 1.3); }
  }

  // ============================================================ helpers
  /** 技 mv の f フレーム目の杖頭（精霊石）のワールド座標 */
  function tipAt(h, mv, f) {
    const pose = mv ? R.sample(mv.kf, f, h.stance) : h.stance;
    const sk = R.skeleton(pose, h.spec), sc = h.spec.scale || 1;
    const tx = sk.tip.x + sk.wd.x, ty = sk.tip.y + sk.wd.y;
    return { x: h.x + tx * sc * h.face, y: h.y, z: h.z - ty * sc };
  }
  const tipNow = h => tipAt(h, h.move, h.move ? h.mf : 0);

  function windFx(x, y, z, dir, n) {
    for (let i = 0; i < n; i++) {
      const a = U.rand(-1.2, 1.2);
      BK.fx.add({ type: 'line', x, y: y + U.rand(-3, 3), z: z + U.rand(-5, 5), vx: dir * Math.cos(a) * U.rand(2, 5), vz: Math.sin(a) * U.rand(1, 3), life: U.randi(8, 13), col: U.choose(WIND), size: 1.4, drag: 0.88 });
    }
  }
  function elecFx(x, y, z, n) {
    for (let i = 0; i < n; i++) {
      const a = U.rand(0, Math.PI * 2);
      BK.fx.add({ type: 'line', x, y, z, vx: Math.cos(a) * U.rand(2, 5), vz: Math.sin(a) * U.rand(2, 5), life: U.randi(5, 9), col: U.choose(ELEC), size: 1.5, drag: 0.8 });
    }
    BK.fx.add({ type: 'burst', x, y, z, life: 5, size: 11, col: '#e8f0ff' });
  }
  function fireFx(x, y, z, dir, n) {
    for (let i = 0; i < n; i++) {
      BK.fx.add({ type: 'dot', x, y: y + U.rand(-3, 3), z: z + U.rand(-4, 4), vx: dir * U.rand(0.5, 3), vz: U.rand(0.8, 3), g: -0.02, life: U.randi(12, 22), col: U.choose(FIRE), size: U.rand(1.5, 3), drag: 0.93 });
    }
    BK.fx.add({ type: 'burst', x, y, z, life: 6, size: 13, col: '#ffe0a0' });
  }
  /** 杖から前方へ吹き抜ける突風 */
  function gust(h, s) {
    s = s || 1;
    const x = h.x + h.face * 30;
    for (let i = 0; i < Math.round(9 * s); i++) {
      BK.fx.add({ type: 'line', x: x + h.face * U.rand(0, 30), y: h.y + U.rand(-8, 8), z: U.rand(8, 96), vx: h.face * U.rand(5, 10), vz: U.rand(-0.6, 0.8), life: U.randi(9, 15), col: U.choose(WIND), size: U.rand(1.2, 2), drag: 0.9 });
    }
    BK.fx.ring(h.x + h.face * 60, h.y, 2, 50 * s, WIND[0], 14);
    BK.fx.dust(h.x + h.face * 50, h.y, 4, 'rgba(170,200,190,0.35)');
  }

  /** 炎の柱（サラマンダー）: gx,gy は地面の画面座標 */
  const FLAME = [[1, '#b8280c', 0.75], [0.74, '#ff6a14', 0.9], [0.48, '#ffb440', 0.95], [0.24, '#fff2c0', 1]];
  function drawFlame(c, gx, gy, H, W, k, t, seed) {
    if (k <= 0 || H <= 1) return;
    const a0 = c.globalAlpha;
    c.globalAlpha = a0 * 0.35 * k; c.fillStyle = '#ff5a10';
    c.beginPath(); c.ellipse(gx, gy, W * 1.8, W * 0.42, 0, 0, Math.PI * 2); c.fill();
    for (let L = 0; L < FLAME.length; L++) {
      const s = FLAME[L][0], w = W * s, hh = H * (0.5 + s * 0.5);
      c.globalAlpha = a0 * FLAME[L][2] * k; c.fillStyle = FLAME[L][1];
      c.beginPath(); c.moveTo(gx - w, gy);
      for (let i = 1; i <= 4; i++) {
        const q = i / 5;
        c.lineTo(gx - w * (1 - q * 0.7) + Math.sin(t * 0.55 + i * 1.9 + seed + L) * w * 0.3, gy - hh * q);
      }
      c.lineTo(gx + Math.sin(t * 0.4 + seed) * w * 0.45, gy - hh);
      for (let i = 4; i >= 1; i--) {
        const q = i / 5;
        c.lineTo(gx + w * (1 - q * 0.7) + Math.sin(t * 0.6 + i * 2.3 + seed + L) * w * 0.3, gy - hh * q);
      }
      c.lineTo(gx + w, gy); c.closePath(); c.fill();
    }
    c.globalAlpha = a0;
  }

  // ============================================================ 精霊の火（追尾弾）
  function findTarget(p) {
    const g = BK.game;
    if (!g) return null;
    let best = null, bd = 1e9, prop = null, pd = 1e9;
    const x0 = BK.cam.x - 10, x1 = BK.cam.x + BK.W + 10;
    for (const a of g.actors) {
      if (a.team === 'hero' || a.dead || a.remove || !a.hurtable || a.x < x0 || a.x > x1) continue;
      const dx = a.x - p.x, dy = a.y - p.y, dz = a.z + (a.h || 80) * 0.5 - p.z;
      let d = Math.abs(dx) + Math.abs(dy) * 1.6 + Math.abs(dz) * 0.3;
      if (dx * p.face < -10) d += 180; // 後ろの敵は後回し
      if (a.isProp) { if (d < pd) { pd = d; prop = a; } continue; }
      if (a.team !== 'enemy') continue;
      if (d < bd) { bd = d; best = a; }
    }
    return best || prop;
  }
  function validTarget(a) { return a && !a.dead && !a.remove && a.hurtable; }
  function wispTick(p) {
    if (!validTarget(p.target)) p.target = findTarget(p);
    p.spd = Math.min(p.maxSpd, p.spd + 0.22);
    const a = p.target;
    if (a && p.t > 3) {
      const dx = a.x - p.x, dy = a.y - p.y, dz = a.z + (a.h || 80) * 0.5 - p.z;
      const d = Math.hypot(dx, dy, dz) || 1;
      const turn = Math.min(0.34, 0.09 + p.t * 0.006);
      p.vx += (dx / d * p.spd - p.vx) * turn;
      p.vy += (dy / d * p.spd - p.vy) * turn;
      p.vz += (dz / d * p.spd - p.vz) * turn;
    } else {
      p.vx += (p.face * p.spd - p.vx) * 0.08; p.vy *= 0.9; p.vz *= 0.9;
    }
    if (p.z < 10 && p.vz < 0) p.vz *= 0.4;
    p.tr.push(p.x, p.y, p.z);
    if (p.tr.length > 18) p.tr.splice(0, 3);
    if (p.t % 4 === 0) BK.fx.add({ type: 'dot', x: p.x, y: p.y, z: p.z, vx: U.rand(-0.3, 0.3), vz: U.rand(0.2, 0.7), life: U.randi(10, 16), col: U.choose(['#bff4ff', '#7fd8ff']), size: 1.5 });
  }
  function drawWisp(c, sx, sy, p) {
    const tr = p.tr, n = tr.length / 3;
    c.fillStyle = '#7fd8ff';
    for (let i = 0; i < n; i++) {
      const k = (i + 1) / (n + 1);
      c.globalAlpha = k * 0.4;
      c.beginPath(); c.arc(BK.sx(tr[i * 3]), BK.sy(tr[i * 3 + 1], tr[i * 3 + 2]), 1.5 + k * 3.5, 0, Math.PI * 2); c.fill();
    }
    const fl = Math.sin(p.t * 0.8) * 1.2;
    c.globalAlpha = 0.25; c.beginPath(); c.arc(sx, sy, 10 + fl, 0, Math.PI * 2); c.fill();
    c.globalAlpha = 0.75; c.fillStyle = '#bff0ff'; c.beginPath(); c.arc(sx, sy, 5, 0, Math.PI * 2); c.fill();
    c.globalAlpha = 1; c.fillStyle = '#ffffff'; c.beginPath(); c.arc(sx, sy, 2.5, 0, Math.PI * 2); c.fill();
  }
  function spawnWisp(h) {
    const n = h._wispN = ((h._wispN || 0) + 1) % 3;
    const m = tipAt(h, moves.shoot, 2);
    BK.game.addProjectile(new BK.Projectile({
      x: m.x, y: h.y, z: m.z, vx: h.face * 3.4, vy: [0, -1.1, 1.1][n], vz: [1.2, 2.4, 0.2][n], face: h.face,
      w: 12, h: 14, depth: 12, team: 'hero', owner: h, dmg: 6, kb: 'light', push: 1.2, stop: 2, life: 96,
      sfx: 'hit', fx: 'none', noShadow: false, spd: 3.6, maxSpd: 8.2, tr: [], target: null,
      tick: wispTick, drawFn: drawWisp,
      onHit(p, t) {
        const z = p.z;
        BK.fx.add({ type: 'burst', x: p.x, y: t.y, z, life: 7, size: 15, col: '#dff8ff' });
        for (let i = 0; i < 5; i++) BK.fx.add({ type: 'line', x: p.x, y: t.y, z, vx: U.rand(-3, 3) + p.vx * 0.3, vz: U.rand(-2, 3), life: U.randi(6, 10), col: U.choose(['#ffffff', '#9fe8ff']), size: 1.4, drag: 0.85 });
      },
      onExpire(p) { BK.fx.add({ type: 'burst', x: p.x, y: p.y, z: p.z, life: 5, size: 8, col: '#bff0ff' }); },
    }));
    BK.fx.add({ type: 'burst', x: m.x, y: h.y, z: m.z, life: 5, size: 9, col: '#dff8ff' });
    BK.audio.sfx('fire', { pitch: 2.3, vol: 0.45 });
  }

  // ============================================================ 火の精霊（溜め）
  function flamePillar(h) {
    const x = h.x + h.face * 60;
    BK.fx.shake(4, 10); BK.fx.dust(x, h.y, 5, 'rgba(90,50,30,0.5)');
    BK.fx.ring(x, h.y, 2, 46, '#ffb060', 14);
    BK.game.addProjectile(new BK.Projectile({
      x, y: h.y, z: 56, vx: 0, face: h.face, w: 50, h: 112, depth: 20, team: 'hero', owner: h,
      dmg: 4, kb: 'light', push: 0.6, stop: 1, life: 44, pierce: 999, noShadow: true, sfx: 'fire', fx: 'none', seed: U.rand(0, 9),
      tick(p) {
        if (p.t % 8 === 0) p.hit.clear();
        if (p.t >= 38) { p.kb = 'launch'; p.dmg = 10; p.lift = 9; p.push = 1.8; }
        if (p.t % 2 === 0) BK.fx.add({ type: 'dot', x: p.x + U.rand(-16, 16), y: p.y + U.rand(-5, 5), z: U.rand(10, 90), vx: U.rand(-0.4, 0.4), vz: U.rand(1.5, 3.5), life: U.randi(14, 24), col: U.choose(FIRE), size: U.rand(1.2, 2.4) });
      },
      onHit(p, t) { fireFx(t.x, t.y, t.z + 40, p.face, 3); },
      drawFn(c, sx, sy, p) {
        const age = p.t, k = Math.min(1, age / 3) * Math.min(1, p.life / 10);
        drawFlame(c, sx, sy + p.z, 122 * Math.min(1, age / 5) * (0.92 + 0.08 * Math.sin(age * 0.9)), 21, k, age, p.seed);
      },
    }));
  }

  // ============================================================ 風の結界（必殺）
  function deflect(h, r) {
    const g = BK.game;
    if (!g) return;
    for (const p of g.projectiles) {
      if (p.team === 'hero' || p.remove || p.harmless) continue;
      if (Math.abs(p.x - h.x) < r && Math.abs(p.y - h.y) < 40 && p.z < 150) {
        p.remove = true;
        BK.fx.add({ type: 'burst', x: p.x, y: p.y, z: p.z, life: 7, size: 12, col: '#e8fff6' });
        windFx(p.x, p.y, p.z, U.sign(p.x - h.x), 3);
      }
    }
  }
  function drawBarrier(c, h, front) {
    const f = h.mf, dur = moves.special.dur;
    const k = Math.min(1, f / 4) * Math.min(1, (dur - f) / 8);
    if (k <= 0) return;
    const sx = BK.sx(h.x), gy = BK.sy(h.y, 0), sy = BK.sy(h.y, h.z) - 46;
    const rx = 66 + Math.min(1, f / 6) * 30, ry = rx * 0.7;
    const a0 = c.globalAlpha;
    c.save();
    if (!front) {
      c.globalAlpha = a0 * 0.13 * k; c.fillStyle = '#9ff5dc';
      c.beginPath(); c.ellipse(sx, sy, rx, ry, 0, 0, Math.PI * 2); c.fill();
      c.globalAlpha = a0 * 0.55 * k; c.strokeStyle = '#c8f7e6'; c.lineWidth = 1.5;
      c.beginPath(); c.ellipse(sx, gy, rx, rx * 0.22, 0, 0, Math.PI * 2); c.stroke();
    }
    // 回転する風の帯: 手前半分は前面、奥半分は背面に描く
    c.lineCap = 'round';
    for (let i = 0; i < 5; i++) {
      const st = (BK.frame * (0.32 + i * 0.03) + i * 1.9) % (Math.PI * 2);
      const isFront = Math.sin(st + 0.7) > 0;
      if (isFront !== front) continue;
      const yy = sy + (i - 2) * 15, sc = 1 - Math.abs(i - 2) * 0.14;
      c.globalAlpha = a0 * k * (front ? 0.85 : 0.4);
      c.strokeStyle = i % 2 ? '#ffffff' : '#c8f7e6'; c.lineWidth = front ? 2.4 : 1.6;
      c.beginPath(); c.ellipse(sx, yy, rx * sc, ry * 0.26, (i - 2) * 0.08, st, st + 1.5); c.stroke();
    }
    c.restore();
  }

  // ============================================================ 四大精霊召喚（覚醒）
  function drawMagicCircle(c, C) {
    const age = C.max - C.life, k = Math.min(1, age / 10) * Math.min(1, C.life / 20);
    if (k <= 0) return;
    const r = 30 + Math.min(1, age / 18) * 56;
    const rot = BK.frame * 0.03;
    c.save();
    c.translate(BK.sx(C.x), BK.sy(C.y, 0)); c.scale(1, 0.34);
    const a0 = c.globalAlpha;
    c.globalAlpha = a0 * 0.14 * k; c.fillStyle = '#9ff5dc';
    c.beginPath(); c.arc(0, 0, r, 0, Math.PI * 2); c.fill();
    c.globalAlpha = a0 * 0.9 * k; c.strokeStyle = '#c8fbe8'; c.lineWidth = 2.4;
    c.beginPath(); c.arc(0, 0, r, 0, Math.PI * 2); c.stroke();
    c.lineWidth = 1.4;
    c.beginPath(); c.arc(0, 0, r * 0.8, 0, Math.PI * 2); c.stroke();
    c.beginPath(); // 五芒星
    for (let i = 0; i <= 5; i++) {
      const a = rot + i * Math.PI * 4 / 5 - Math.PI / 2;
      if (i) c.lineTo(Math.cos(a) * r * 0.8, Math.sin(a) * r * 0.8); else c.moveTo(Math.cos(a) * r * 0.8, Math.sin(a) * r * 0.8);
    }
    c.stroke();
    c.beginPath(); // ルーン
    for (let i = 0; i < 20; i++) {
      const a = -rot * 0.7 + i * Math.PI / 10;
      c.moveTo(Math.cos(a) * r * 0.84, Math.sin(a) * r * 0.84); c.lineTo(Math.cos(a + 0.13) * r * 0.96, Math.sin(a + 0.13) * r * 0.96);
    }
    c.stroke();
    // 四方の精霊の印
    for (let i = 0; i < 4; i++) {
      const a = rot * 1.5 + i * Math.PI / 2;
      c.globalAlpha = a0 * k; c.fillStyle = ELEM[i];
      c.beginPath(); c.arc(Math.cos(a) * r, Math.sin(a) * r, 4.5, 0, Math.PI * 2); c.fill();
    }
    c.restore();
  }
  function drawOrbs(c, h, front) {
    const k = Math.min(1, h.mf / 14);
    const r = 24 + k * 24, cz = h.z + 48 + k * 12;
    const a0 = c.globalAlpha;
    for (let i = 0; i < 4; i++) {
      const th = BK.frame * 0.09 + i * Math.PI / 2, s = Math.sin(th);
      if ((s > 0) !== front) continue;
      const sx = BK.sx(h.x + Math.cos(th) * r), sy = BK.sy(h.y + s * 10, cz + Math.sin(th * 2 + i) * 6);
      c.fillStyle = ELEM[i];
      c.globalAlpha = a0 * 0.28 * k; c.beginPath(); c.arc(sx, sy, 10, 0, Math.PI * 2); c.fill();
      c.globalAlpha = a0 * 0.9 * k; c.beginPath(); c.arc(sx, sy, 4.5, 0, Math.PI * 2); c.fill();
      c.globalAlpha = a0 * k; c.fillStyle = '#ffffff'; c.beginPath(); c.arc(sx, sy, 1.8, 0, Math.PI * 2); c.fill();
    }
    c.globalAlpha = a0;
  }
  /** 画面上部に大きく浮かぶ精霊の文字（HUD と重ならない中央寄りの帯に並べる） */
  // 大きな漢字は一度だけ描いてキャッシュし、拡大縮小して貼る（毎フレーム異なるフォントサイズで描くと重い）
  const KANJI_SPR = new Map();
  function kanjiSprite(ch, col) {
    const rs = Math.min(BK.renderScale, 2), key = ch + col + rs.toFixed(2);
    let cv = KANJI_SPR.get(key);
    if (!cv) {
      const S = 62, pad = 8;
      cv = document.createElement('canvas');
      cv.width = cv.height = Math.ceil((S + pad * 2) * rs);
      const k = cv.getContext('2d'); k.scale(rs, rs);
      BK.text(k, ch, S / 2 + pad, S / 2 + pad, { size: S, color: col, stroke: '#08040a', strokeW: 6, weight: 800 });
      cv.lw = S + pad * 2; KANJI_SPR.set(key, cv);
    }
    return cv;
  }
  function kanji(ch, col, slot) {
    kanjiSprite(ch, col);
    BK.fx.add({
      type: 'custom', x: BK.cam.x + BK.W * (0.32 + slot * 0.12), y: 0, z: BK.FLOOR_TOP - 86, life: 56,
      draw(c, sx, sy, k) {
        const cv = kanjiSprite(ch, col), s = (50 + (1 - k) * 12) / 62 * cv.lw;
        c.globalAlpha = Math.min(1, k * 1.8) * 0.9; c.drawImage(cv, sx - s / 2, sy - s / 2, s, s); c.globalAlpha = 1;
      },
    });
  }
  /** 画面内の敵（近い順） */
  function screenTargets(h) {
    const g = BK.game;
    if (!g) return [];
    const x0 = BK.cam.x - 30, x1 = BK.cam.x + BK.W + 30;
    return g.actors.filter(a => a.team === 'enemy' && !a.dead && !a.remove && a.hp > 0 && !a.intangible && a.x > x0 && a.x < x1)
      .sort((a, b) => Math.abs(a.x - h.x) - Math.abs(b.x - h.x)).slice(0, 10);
  }
  /** 召喚の一撃（ダウン中の敵にも当たる） */
  function strike(h, a, hit, dir) {
    if (!a || a.dead || a.remove || a.hp <= 0 || a.intangible) return false;
    if (a.hurtable) return a.takeHit(h, hit, dir);
    if ((a.state === 'down' || a.state === 'getup') && !(a.invul > 0)) {
      const dmg = Math.max(1, Math.round(hit.dmg * (h.dmgMul || 1) * (a.dmgTakenMul || 1)));
      a.hp -= dmg; a.flash = 6; a._lastHitF = BK.frame;
      h.onDealDamage(dmg, a, hit);
      if (BK.game) BK.game.lastHitEnemy = a;
      if (a.hp <= 0) { a.hp = 0; a.die(h, hit, dir); }
      return true;
    }
    return false;
  }
  function drawWindBlade(c, sx, sy, p) {
    const f = p.face, a0 = c.globalAlpha;
    c.globalAlpha = a0 * 0.3; c.strokeStyle = '#c8f7e6'; c.lineWidth = 1.5;
    c.beginPath();
    for (let i = -2; i <= 2; i++) { const yy = sy + i * 14; c.moveTo(sx - f * 6, yy); c.lineTo(sx - f * (40 + (i & 1) * 18), yy); }
    c.stroke();
    c.globalAlpha = a0 * 0.55; c.fillStyle = '#c8f7e6';
    c.beginPath(); c.moveTo(sx, sy - 52); c.quadraticCurveTo(sx + f * 30, sy, sx, sy + 52); c.quadraticCurveTo(sx + f * 12, sy, sx, sy - 52); c.fill();
    c.globalAlpha = a0 * 0.95; c.strokeStyle = '#ffffff'; c.lineWidth = 1.6;
    c.beginPath(); c.moveTo(sx, sy - 50); c.quadraticCurveTo(sx + f * 29, sy, sx, sy + 50); c.stroke();
    c.globalAlpha = a0;
  }
  function windBlade(h, i) {
    const dir = i % 2 ? -1 : 1;
    const y = [14, 74, 44, 104][i];
    BK.game.addProjectile(new BK.Projectile({
      x: dir > 0 ? BK.cam.x - 50 : BK.cam.x + BK.W + 50, y, z: 50, vx: dir * 15, face: dir,
      w: 40, h: 110, depth: 17, team: 'hero', owner: h, dmg: 8, kb: 'light', push: 2.5, stop: 1, life: 64, pierce: 999,
      noShadow: true, sfx: 'slash', fx: 'none',
      onHit(p, t) { windFx(t.x, t.y, t.z + 45, p.face, 4); BK.fx.blood(t.x, t.y, t.z + 45, p.face, 3, t.bloodCol); },
      drawFn: drawWindBlade,
    }));
  }
  function boltFx(x, y) {
    const segs = [];
    for (let i = 0; i <= 9; i++) segs.push(i === 9 ? 0 : U.rand(-15, 15));
    BK.fx.add({
      type: 'custom', x, y, z: 0, life: 12, segs,
      draw(c, sx, sy, k, p) {
        const top = -10, n = p.segs.length - 1;
        c.save(); c.lineJoin = 'round';
        for (let pass = 0; pass < 2; pass++) {
          c.globalAlpha = k * (pass ? 1 : 0.45); c.strokeStyle = pass ? '#ffffff' : '#7fa8ff'; c.lineWidth = pass ? 2.4 : 7;
          c.beginPath();
          for (let i = 0; i <= n; i++) {
            const yy = top + (sy - top) * i / n, xx = sx + p.segs[i];
            if (i) c.lineTo(xx, yy); else c.moveTo(xx, yy);
          }
          c.stroke();
        }
        c.globalAlpha = k * 0.5; c.fillStyle = '#cfe0ff';
        c.beginPath(); c.ellipse(sx, sy, 22 * k + 6, 6 * k + 2, 0, 0, Math.PI * 2); c.fill();
        c.restore();
      },
    });
  }
  function bolt(h, a) {
    const x = a ? a.x : BK.cam.x + U.rand(40, BK.W - 40), y = a ? a.y : U.rand(6, BK.DEPTH - 6);
    boltFx(x, y);
    if (a) {
      const z = a.z + (a.h || 80) * 0.55;
      if (strike(h, a, { dmg: 18, kb: 'heavy', push: 1.5, stop: 0, sfx: 'none', fx: 'none' }, U.sign(a.x - h.x || h.face))) {
        elecFx(a.x, a.y, z, 6); BK.fx.blood(a.x, a.y, z, U.sign(a.x - h.x || 1), 3, a.bloodCol);
      }
    } else elecFx(x, y, 4, 4);
    BK.audio.sfx('hit', { pitch: 1.7, vol: 0.6 });
  }
  function drawSpikes(c, sx, sy, k, p) {
    const age = p.max - p.life, grow = Math.min(1, age / 4), sink = Math.min(1, p.life / 10);
    for (const s of p.sp) {
      const H = s.h * grow * sink;
      if (H < 1) continue;
      const bx = sx + s.dx, by = sy + s.dy, tx = bx + s.lean * H, ty = by - H;
      R.poly(c, [bx - s.w, by, tx, ty, bx + s.w, by], '#5a4a3c', 'rgba(10,6,4,0.9)');
      R.poly(c, [bx - s.w * 0.15, by, tx, ty, bx + s.w * 0.75, by], '#8a735c');
    }
  }
  function spikes(h, a) {
    const sp = [];
    for (let i = 0; i < 5; i++) sp.push({ dx: U.rand(-22, 22), dy: U.rand(-4, 4), h: U.rand(26, 52), w: U.rand(6, 11), lean: U.rand(-0.35, 0.35) });
    sp.sort((p, q) => p.dy - q.dy);
    BK.fx.add({ type: 'custom', x: a.x, y: a.y, z: 0, life: 32, sp, draw: drawSpikes });
    BK.fx.dust(a.x, a.y, 4, 'rgba(110,90,70,0.55)');
    for (let i = 0; i < 4; i++) BK.fx.add({ type: 'dot', x: a.x + U.rand(-14, 14), y: a.y, z: 4, vx: U.rand(-2, 2), vz: U.rand(2, 5), g: 0.3, life: U.randi(20, 30), col: U.choose(['#6b5a48', '#8a7458', '#4a3e32']), size: U.rand(2, 3.5) });
    strike(h, a, { dmg: 12, kb: 'launch', lift: 7.5, push: 1, stop: 0, sfx: 'none', fx: 'none' }, U.sign(a.x - h.x || h.face));
    BK.audio.sfx('thud', { pitch: 0.8 });
  }
  function firePillar(h, a, S) {
    const x = a.x, y = a.y;
    BK.fx.add({
      type: 'custom', x, y, z: 0, life: 36, seed: U.rand(0, 9),
      draw(c, sx, sy, k, p) { const age = p.max - p.life; drawFlame(c, sx, sy, 150 * Math.min(1, age / 5), 25, Math.min(1, k * 2.5), age, p.seed); },
    });
    for (let i = 0; i < 4; i++) BK.fx.ember(x + U.rand(-12, 12), y, U.rand(10, 60));
    const dir = U.sign(a.x - h.x || h.face);
    if (strike(h, a, { dmg: 12, kb: 'heavy', push: 1, stop: 0, sfx: 'none', fx: 'none' }, dir)) fireFx(a.x, a.y, a.z + 40, dir, 3);
    S.q.push({
      f: S.t + 8,
      fn() {
        if (strike(h, a, { dmg: 20, kb: 'down', lift: 7, push: 3, stop: 0, sfx: 'none', fx: 'none', breakArmor: true }, dir)) {
          fireFx(a.x, a.y, a.z + 40, dir, 4); BK.fx.blood(a.x, a.y, a.z + 45, dir, 3, a.bloodCol);
        }
      },
    });
    BK.audio.sfx('fire', { pitch: 0.7 });
  }
  /** 召喚開始: 風 → 雷 → 地 → 火 の順に画面全体を打つ（約 1.5 秒） */
  function startSummon(h) {
    const S = h._sum = { t: 0, q: [], awk0: h.awk };
    const at = (f, fn) => S.q.push({ f, fn });
    BK.fx.flash('#d8fff0', 5); BK.fx.shake(5, 14);
    BK.audio.sfx('magic', { pitch: 0.6 });
    at(0, () => { kanji('風', WIND[0], 0); BK.audio.sfx('swingHeavy', { pitch: 0.7 }); });
    for (let i = 0; i < 4; i++) at(i * 4, () => windBlade(h, i));
    at(20, () => {
      kanji('雷', '#d8e4ff', 1); BK.fx.flash('#e8f0ff', 4); BK.audio.sfx('explode', { pitch: 2.2, vol: 0.6 });
      screenTargets(h).forEach((a, i) => at(S.t + i * 2, () => bolt(h, a)));
      for (let i = 0; i < 3; i++) at(S.t + 1 + i * 4, () => bolt(h, null));
    });
    at(40, () => {
      kanji('地', '#dcbc94', 2); BK.fx.shake(7, 16); BK.audio.sfx('thud', { pitch: 0.5 });
      screenTargets(h).forEach((a, i) => at(S.t + i * 2, () => spikes(h, a)));
    });
    at(58, () => {
      kanji('火', '#ffb060', 3); BK.audio.sfx('explode', { pitch: 0.9, vol: 0.7 });
      screenTargets(h).forEach((a, i) => at(S.t + i * 2, () => firePillar(h, a, S)));
    });
    at(92, () => { S.end = true; BK.fx.shake(6, 12); });
  }
  function updateSummon(h) {
    const S = h._sum;
    if (!S) return;
    if (!BK.game) { h._sum = null; return; }
    for (let i = 0; i < S.q.length; i++) {
      const e = S.q[i];
      if (!e.done && e.f <= S.t) { e.done = true; e.fn(); }
    }
    S.t++;
    h.awk = Math.min(h.awk, S.awk0); // 覚醒技そのものではゲージを溜めない
    if (!h.dead) h.invul = Math.max(h.invul, 12);
    if (S.end && S.q.every(e => e.done)) h._sum = null;
  }

  // ============================================================ 相棒の精霊（飾り）
  function updateFairy(h) {
    let F = h._fairy;
    if (!F) F = h._fairy = { x: h.x - h.face * 16, y: h.y, z: h.z + 84, t: U.randi(0, 200), front: false };
    F.t++;
    const ph = F.t * 0.04;
    const tx = h.x - h.face * 25 + Math.cos(ph) * 12, tz = h.z + 64 + Math.sin(F.t * 0.09) * 5; // 肩の後ろあたりを漂う
    if (Math.abs(F.x - h.x) > 260) { F.x = tx; F.z = tz; }
    F.x += (tx - F.x) * 0.1; F.z += (tz - F.z) * 0.1;
    F.y = h.y + Math.sin(ph) * 6;
    F.front = Math.sin(ph) > 0;
    if (F.t % 9 === 0) BK.fx.add({ type: 'dot', x: F.x + U.rand(-2, 2), y: F.y, z: F.z - 2, vx: U.rand(-0.3, 0.3), vz: -U.rand(0.2, 0.5), life: 22, col: '#c8ffe8', size: 1.2 });
  }
  function drawFairy(c, F) {
    const sx = BK.sx(F.x), sy = BK.sy(F.y, F.z);
    const fl = Math.abs(Math.sin(F.t * 0.8));
    const a0 = c.globalAlpha;
    c.fillStyle = '#9ff5dc';
    c.globalAlpha = a0 * 0.2; c.beginPath(); c.arc(sx, sy, 8, 0, Math.PI * 2); c.fill();
    c.globalAlpha = a0 * 0.6; c.fillStyle = '#e6fff4';
    c.beginPath(); c.ellipse(sx - 2.5, sy - 2.5, 3.8, 1 + fl * 1.6, 0.7, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.ellipse(sx + 2.5, sy - 2.5, 3.8, 1 + fl * 1.6, -0.7, 0, Math.PI * 2); c.fill();
    c.globalAlpha = a0; c.fillStyle = '#ffffff'; c.beginPath(); c.arc(sx, sy, 1.9, 0, Math.PI * 2); c.fill();
  }

  // ============================================================ moves
  const GRAB = { lean: 8, aB: 72, eB: 22, aF: 50, eF: 70, wAbs: 150, lF: 16, kF: 12, lB: -16, kB: 8 };
  const moves = {
    atk1: { // 杖の横薙ぎ（風）
      dur: 22, cancel: 12, trail: [5, 10], trailCol: '#c8f7e6',
      kf: [[0, {}],
        [4, { aF: 150, eF: 30, wAbs: 222, lean: -6, aB: -30, eB: 30, lF: 12, kF: 10, lB: -14, kB: 8 }],
        [8, { aF: 92, eF: 0, wAbs: 100, lean: 14, aB: -45, eB: 20, lF: 28, kF: 22, lB: -22, kB: 8, cape: 0.8 }, 'snap'],
        [12, { aF: 72, eF: 0, wAbs: 66, lean: 16, aB: -45, eB: 20, lF: 28, kF: 22, lB: -22, kB: 8, cape: 0.8 }],
        [22, {}]],
      hits: [{ f: [7, 10], x: [10, 76], z: [18, 92], d: 16, dmg: 7, kb: 'light', push: 2.2 }],
      move: [[0, 0], [4, 1.8], [9, 0.4], [12, 0]],
      sfx: [[5, 'swing']],
      onFrame(h, f) { if (f === 8) { const t = tipNow(h); windFx(t.x, h.y, t.z, h.face, 5); } },
    },
    atk2: { // 返しの振り上げ（雷）
      dur: 22, cancel: 12, trail: [5, 10], trailCol: '#dde8ff',
      kf: [[0, { aF: 72, eF: 0, wAbs: 66, lean: 16, lF: 28, kF: 22, lB: -22, kB: 8 }],
        [4, { aF: 35, eF: 25, wAbs: 25, lean: 10, aB: -30, eB: 30, lF: 18, kF: 14, lB: -18, kB: 8 }],
        [8, { aF: 140, eF: 20, wAbs: 168, lean: -6, aB: -50, eB: 20, lF: 22, kF: 16, lB: -18, kB: 8, cape: 0.8 }, 'snap'],
        [12, { aF: 150, eF: 25, wAbs: 192, lean: -8, aB: -50, eB: 20, lF: 22, kF: 16, lB: -18, kB: 8 }],
        [22, {}]],
      hits: [{ f: [6, 10], x: [6, 72], z: [30, 122], d: 16, dmg: 7, kb: 'light', push: 2 }],
      move: [[0, 0], [4, 1.6], [9, 0.3], [12, 0]],
      sfx: [[5, 'swing', { pitch: 1.15 }]],
      onFrame(h, f) { if (f === 8) { const t = tipNow(h); elecFx(t.x, h.y, t.z, 6); } },
    },
    atk3: { // 両手突き（火）
      dur: 26, cancel: 14, trail: [6, 11], trailCol: '#ffc070',
      kf: [[0, { aF: 150, eF: 25, wAbs: 192, lean: -8 }],
        [5, { aF: 40, eF: 95, wAbs: 96, lean: -4, lF: 10, kF: 8, lB: -16, kB: 8, grip: 1 }],
        [9, { aF: 88, eF: 0, wAbs: 92, lean: 18, lF: 36, kF: 28, lB: -28, kB: 6, drop: 2, grip: 1, glow: 1 }, 'snap'],
        [15, { aF: 86, eF: 0, wAbs: 91, lean: 18, lF: 36, kF: 28, lB: -28, kB: 6, drop: 2, grip: 1 }],
        [26, {}]],
      hits: [{ f: [8, 11], x: [14, 82], z: [34, 86], d: 16, dmg: 9, kb: 'heavy', push: 3.2 }],
      move: [[0, 0], [5, 2.6], [10, 0.6], [13, 0]],
      sfx: [[6, 'swing', { pitch: 0.9 }], [9, 'fire', { pitch: 1.3 }]],
      onFrame(h, f) { if (f === 9) { const t = tipNow(h); fireFx(t.x, h.y, t.z, h.face, 6); BK.fx.glow(t.x, h.y, t.z, 22, '#ff9a40', 8); } },
    },
    atk4: { // 風の爆発（フィニッシュ）
      dur: 40, trail: [9, 15], trailCol: '#c8f7e6',
      kf: [[0, { aF: 88, eF: 0, wAbs: 92, lean: 18, grip: 1 }],
        [9, { aF: 168, eF: 15, wAbs: 200, lean: -12, head: -10, lF: 12, kF: 10, lB: -18, kB: 10, cape: 0.9, grip: 1, glow: 1 }],
        [14, { aF: 96, eF: 0, wAbs: 84, lean: 24, head: 4, lF: 38, kF: 32, lB: -28, kB: 6, drop: 4, cape: 1.4, grip: 1, glow: 1 }, 'snap'],
        [26, { aF: 94, eF: 0, wAbs: 82, lean: 22, lF: 38, kF: 32, lB: -28, kB: 6, drop: 4, cape: 1.1, grip: 1 }],
        [40, {}]],
      hits: [{ f: [13, 17], x: [10, 108], z: [0, 112], d: 22, dmg: 16, kb: 'down', push: 6.5, lift: 5, stop: 7 }],
      move: [[0, 0], [8, 1.6], [14, 0]],
      sfx: [[10, 'swingHeavy', { pitch: 1.25 }], [14, 'fire', { pitch: 0.6 }]],
      onFrame(h, f) { if (f === 14) { gust(h, 1); BK.fx.shake(3, 8); } },
    },
    dash: { // 風を滑る杖の払い
      dur: 30, trail: [3, 16], trailCol: '#c8f7e6',
      kf: [[0, { aF: 20, eF: 20, wAbs: -30, lean: 22, lF: 36, kF: 30, lB: -30, kB: 12, drop: 3, cape: 1.4 }],
        [4, { aF: -20, eF: 30, wAbs: -75, lean: 26, lF: 44, kF: 22, lB: -34, kB: 8, drop: 5, cape: 1.5, aB: -40, eB: 20 }],
        [12, { aF: 100, eF: 0, wAbs: 96, lean: 26, lF: 44, kF: 22, lB: -34, kB: 8, drop: 5, cape: 1.5, aB: -60, eB: 20, glow: 1 }, 'inOut'],
        [22, { aF: 96, eF: 0, wAbs: 92, lean: 22, lF: 40, kF: 26, lB: -30, kB: 8, drop: 4, cape: 1.2, aB: -60, eB: 20 }],
        [30, {}]],
      hits: [{ f: [3, 16], x: [8, 76], z: [0, 80], d: 18, dmg: 11, kb: 'down', push: 5.5, lift: 4 }],
      move: [[0, 7], [10, 6.2], [16, 3], [22, 0]],
      sfx: [[1, 'swing'], [2, 'fire', { pitch: 0.8, vol: 0.6 }]],
      onFrame(h, f) {
        if (f < 18 && f % 2 === 0) {
          BK.fx.add({ type: 'smoke', x: h.x - h.face * 8, y: h.y, z: 3, vx: -h.face * 1.2, vz: U.rand(0.2, 0.8), life: 16, size: U.rand(4, 7), col: 'rgba(190,240,220,0.35)', drag: 0.92 });
          BK.fx.add({ type: 'line', x: h.x - h.face * 6, y: h.y + U.rand(-6, 6), z: U.rand(2, 30), vx: -h.face * U.rand(3, 6), life: 8, col: U.choose(WIND), size: 1.2 });
        }
      },
    },
    jumpAtk: {
      air: true, dur: 60, trail: [2, 10], trailCol: '#c8f7e6',
      kf: [[0, { aF: 160, eF: 30, wAbs: 215, lF: 40, kF: 70, lB: -5, kB: 60, lean: -6, cape: 1 }],
        [5, { aF: 96, eF: 0, wAbs: 100, lF: 48, kF: 70, lB: 5, kB: 70, lean: 14, cape: 1.2 }, 'snap'],
        [10, { aF: 45, eF: 0, wAbs: 35, lF: 48, kF: 70, lB: 5, kB: 70, lean: 18, cape: 1.2 }],
        [60, { aF: 45, eF: 0, wAbs: 35, lF: 36, kF: 50, lB: 0, kB: 40, lean: 10, cape: 1.1 }]],
      hits: [{ f: [3, 12], x: [0, 80], z: [-45, 92], d: 18, dmg: 10, kb: 'down', push: 4 }],
      sfx: [[2, 'swing']],
      onFrame(h, f) { if (f === 5) { const t = tipNow(h); windFx(t.x, h.y, t.z, h.face, 4); } },
    },
    downAtk: { // 空中 ↓+斬: 杖を突き立てて急降下
      air: true, dur: 80, trail: [5, 80], trailCol: '#c8f7e6',
      kf: [[0, { aF: 160, eF: 20, wAbs: 190, lF: 50, kF: 80, lB: 0, kB: 70, cape: 1 }],
        [6, { aF: 20, eF: 0, wAbs: 0, lF: 30, kF: 50, lB: -10, kB: 40, lean: 10, cape: 1.4, glow: 1 }, 'snap'],
        [80, { aF: 20, eF: 0, wAbs: 0, lF: 30, kF: 50, lB: -10, kB: 40, lean: 10, cape: 1.4, glow: 1 }]],
      hits: [{ f: [6, 80], x: [-8, 40], z: [-50, 36], d: 18, dmg: 12, kb: 'down', push: 3 }],
      onFrame(h, f) { if (f === 6) { h.vz = -8; h.vx *= 0.3; BK.audio.sfx('swing'); } },
      onEnd(h) { if (h.z <= 1) { windFx(h.x + h.face * 14, h.y, 6, h.face, 5); BK.fx.dust(h.x + h.face * 14, h.y, 6); } },
    },
    rising: { // 上昇気流: 杖を振り上げ、竜巻で敵を打ち上げる
      dur: 38, trail: [5, 12], invul: [0, 10], trailCol: '#c8f7e6',
      kf: [[0, { aF: 20, eF: 20, wAbs: -10, lean: 20, lF: 40, kF: 70, lB: -20, kB: 60, drop: 3 }],
        [4, { aF: 40, eF: 15, wAbs: 30, lean: 14, lF: 40, kF: 70, lB: -20, kB: 60, drop: 3 }],
        [10, { aF: 168, eF: 8, wAbs: 182, lean: -10, head: -10, lF: 20, kF: 30, lB: -24, kB: 44, cape: 1.4, glow: 1 }, 'snap'],
        [38, { aF: 160, eF: 10, wAbs: 186, lean: -5, lF: 30, kF: 50, lB: -10, kB: 40, cape: 1.2 }]],
      hits: [{ f: [5, 13], x: [0, 72], z: [0, 150], d: 20, dmg: 11, kb: 'launch', lift: 10, push: 1.2 }],
      sfx: [[5, 'swing'], [6, 'fire', { pitch: 0.7 }]],
      onFrame(h, f) {
        if (f === 4) {
          h.vz = 6.6; h.z = 0.5; h.vx = h.face * 1.2;
          BK.fx.ring(h.x + h.face * 36, h.y, 2, 40, WIND[0], 16);
          BK.fx.dust(h.x + h.face * 30, h.y, 4, 'rgba(170,200,190,0.4)');
        }
        if (f > 3 && f < 18) {
          const cx = h.x + h.face * 38;
          for (let i = 0; i < 2; i++) BK.fx.add({ type: 'line', x: cx + U.rand(-16, 16), y: h.y + U.rand(-6, 6), z: U.rand(0, 50), vx: U.rand(-1.5, 1.5), vz: U.rand(4, 7.5), life: U.randi(9, 14), col: U.choose(WIND), size: 1.4, drag: 0.95 });
        }
      },
    },
    charge: { // 火の精霊（サラマンダー）: 前方に火柱（多段ヒット）
      dur: 46, armor: true, trail: [12, 17], trailCol: '#ffb060',
      kf: [[0, { aF: 150, eF: 30, wAbs: 200, lean: -8, lF: 14, kF: 12, lB: -18, kB: 10, grip: 1, glow: 1 }],
        [12, { aF: 168, eF: 20, wAbs: 212, lean: -12, head: -8, lF: 14, kF: 12, lB: -18, kB: 10, cape: 0.8, grip: 1, glow: 1 }],
        [17, { aF: 92, eF: 0, wAbs: 70, lean: 24, lF: 38, kF: 32, lB: -28, kB: 6, drop: 4, cape: 1.3, grip: 1, glow: 1 }, 'snap'],
        [36, { aF: 90, eF: 0, wAbs: 68, lean: 22, lF: 38, kF: 32, lB: -28, kB: 6, drop: 4, cape: 1.1, grip: 1 }],
        [46, {}]],
      hits: [{ f: [15, 18], x: [8, 52], z: [10, 96], d: 18, dmg: 6, kb: 'light', push: 3.5 }],
      move: [[0, 0], [12, 1.2], [17, 0]],
      sfx: [[12, 'swing', { pitch: 0.8 }], [17, 'fire', { pitch: 0.6 }], [18, 'explode', { pitch: 1.6, vol: 0.5 }]],
      onFrame(h, f) {
        if (f < 14 && f % 2 === 0) { const t = tipNow(h); BK.fx.ember(t.x + U.rand(-5, 5), h.y, t.z + U.rand(-5, 5)); }
        if (f === 17) flamePillar(h);
      },
    },
    special: { // 必殺: 風の結界
      dur: 44, invul: [0, 40],
      kf: [[0, { aF: 150, eF: 20, wAbs: 180, lean: -4, lF: 16, kF: 12, lB: -16, kB: 12, drop: 2, glow: 1 }],
        [6, { aF: 174, eF: 4, wAbs: 180, lean: -8, head: -14, aB: -140, eB: 10, lF: 22, kF: 14, lB: -22, kB: 14, drop: 3, cape: 1.5, glow: 1 }],
        [36, { aF: 176, eF: 2, wAbs: 182, lean: -10, head: -16, aB: -145, eB: 8, lF: 22, kF: 14, lB: -22, kB: 14, drop: 3, cape: 1.5, glow: 1 }],
        [44, {}]],
      hits: [{ f: [3, 36], x: [-94, 94], z: [0, 128], d: 30, dmg: 8, kb: 'spin', multi: 10, dirAway: true, push: 6.5, lift: 5.5, fx: 'none', sfx: 'hit' }],
      sfx: [[1, 'swingHeavy', { pitch: 1.3 }], [2, 'fire', { pitch: 0.5 }], [14, 'fire', { pitch: 0.6 }], [26, 'fire', { pitch: 0.7 }]],
      onFrame(h, f) {
        if (f === 1) { BK.fx.ring(h.x, h.y, 2, 110, '#e6fff6', 20); BK.fx.shake(3, 10); }
        if (f < 38) deflect(h, 100);
        if (f < 36 && f % 2 === 0) {
          const a = U.rand(0, Math.PI * 2), r = U.rand(50, 90);
          BK.fx.add({ type: 'line', x: h.x + Math.cos(a) * r, y: h.y + Math.sin(a) * 16, z: U.rand(10, 100), vx: -Math.sin(a) * 5, vz: U.rand(-0.5, 1.5), life: 8, col: U.choose(WIND), size: 1.4 });
        }
      },
      onHit(h, t) { windFx(t.x, t.y, t.z + 50, U.sign(t.x - h.x || 1), 4); },
    },
    knee: { // 掴み中: 杖で突く
      dur: 16,
      kf: [[0, GRAB], [5, { lean: 16, aF: 96, eF: 0, wAbs: 92, aB: 70, eB: 25, lF: 22, kF: 16, lB: -18, kB: 8, glow: 1 }, 'snap'], [16, GRAB]],
      hits: [{ f: [4, 6], x: [0, 48], z: [28, 76], d: 16, dmg: 5, kb: 'light', grabHit: true, keepGrab: true, stop: 4, sfx: 'hit' }],
      onHit(h, t) { elecFx(t.x, t.y, t.z + 50, 4); },
    },
    throw: { // 風の投げ: 突風で吹き飛ばす
      dur: 30, throwAt: 11,
      kf: [[0, GRAB], [8, { lean: -8, aF: 155, eF: 20, wAbs: 200, aB: 60, eB: 30, lF: 12, kF: 10, lB: -18, kB: 10, glow: 1 }],
        [12, { lean: 22, aF: 96, eF: 0, wAbs: 94, aB: 30, eB: 40, lF: 32, kF: 26, lB: -26, kB: 6, drop: 3, cape: 1.3, glow: 1 }, 'snap'],
        [30, {}]],
      sfx: [[9, 'swing'], [11, 'fire', { pitch: 0.6 }]],
      onFrame(h, f) {
        if (f !== 11) return;
        const e = h.grabbing;
        h.releaseThrow();
        if (e) { e.vx *= 1.35; e.vz = 7.5; }
        gust(h, 0.8);
      },
    },
    shoot: { // 精霊の火を放つ
      dur: 10, cancelShot: 5,
      kf: [[0, { aF: 86, eF: 4, wAbs: 108, lean: 6, aB: -25, eB: 30, glow: 1 }], [2, { aF: 92, eF: 0, wAbs: 102, lean: 9, aB: -30, eB: 30, glow: 1 }],
        [10, { aF: 86, eF: 4, wAbs: 108, lean: 6, aB: -25, eB: 30 }]],
    },
    awaken: { // 四大精霊召喚の儀（時間停止中）
      dur: 60, invul: [0, 60],
      kf: [[0, {}],
        [12, { aF: 172, eF: 5, wAbs: 180, lean: -8, head: -18, aB: -135, eB: 12, lF: 16, kF: 12, lB: -16, kB: 12, cape: 1.2, glow: 1 }],
        [52, { aF: 176, eF: 3, wAbs: 182, lean: -10, head: -20, aB: -140, eB: 10, lF: 18, kF: 12, lB: -18, kB: 12, cape: 1.5, glow: 1 }],
        [60, { aF: 150, eF: 10, wAbs: 170, lean: 6, head: 0, aB: -60, eB: 20, lF: 20, kF: 14, lB: -20, kB: 12, cape: 1, glow: 1 }]],
      onFrame(h, f) {
        BK.fx.darken = Math.min(BK.fx.darken, 0.38); // 魔法陣が見えるよう暗転は控えめに
        if (f === 0) { h._circle = { x: h.x, y: h.y, life: 160, max: 160 }; BK.audio.sfx('magic', { pitch: 0.5 }); }
        if (f === 24) BK.audio.sfx('magic', { pitch: 0.67 });
        if (f === 44) BK.audio.sfx('magic', { pitch: 0.8 });
        if (f > 6 && f < 54 && f % 2 === 0) { // 精霊の光が杖へ集まる
          const t = tipNow(h), ang = U.rand(0, Math.PI * 2), d = U.rand(40, 90);
          const ox = Math.cos(ang) * d, oz = Math.sin(ang) * d;
          BK.fx.add({ type: 'dot', x: t.x + ox, y: h.y + 1, z: t.z + oz, vx: -ox / 10, vz: -oz / 10, life: 10, col: U.choose(ELEM), size: 2 });
        }
        if (f === 56) BK.fx.ring(h.x, h.y, 2, 120, '#c8fbe8', 20);
      },
    },
  };

  BK.registerHero({
    id: 'schierke', name: 'シールケ', title: '魔女の弟子',
    desc: '大きな帽子の小さな魔女。体は脆いが魔術は随一。\n敵を自動で追う「精霊の火」と、\n風・雷・火を宿す杖術で戦う。',
    stats: { life: 2, power: 2, speed: 4, reach: 2, shot: 5 },
    color: '#8fe8cf',
    maxHp: 95, walk: 2.4, walkY: 1.6, run: 4.6, jumpV: 9.6, jumpVX: 2.8, runJumpVX: 5.0, weight: 1.0, w: 24, h: 84,
    specialCost: 0.08, throwDmg: 16, shadowR: 15,
    spec: {
      scale: 0.88, thigh: 19, shin: 18, torso: 24, neck: 3, headR: 8.4, upper: 13, fore: 12,
      legW: 7, armW: 5.8, waistW: 12, chestW: 15, shoulderOff: 1.5, weaponLen: 46, gripDist: 9, capeLen: 36,
      colors: {
        skin: '#ecc6a6', skinDark: '#c9a083', hair: '#1c141c', hairHi: 'rgba(120,100,140,0.45)',
        hat: '#2a2333', hatDark: '#16111c', band: '#6a4630', hatHi: 'rgba(170,150,205,0.45)',
        body: '#2c2839', sleeve: '#2f2b3e', sleeveDark: '#1d1a27', cloth: '#1c1822', clothDark: '#1d1a27',
        robe: '#2a2637', robeDark: '#1a1723', trim: '#5f5280', collar: '#dcd3c2', gold: '#d0a850',
        stock: '#1c1822', stockDark: '#131017', boot: '#3a2a1e', bootDark: '#261b13', belt: '#5a2a26',
        wood: '#7a5634', woodDark: '#4a3220', gem: GEM, cape: '#1e1a28', line: 'rgba(8,5,10,0.88)',
      },
      draw: { cape: capeAndHair, head, torso, chest, leg, arm, weapon: staff },
    },
    stance: { lean: 3, head: 2, aF: 38, eF: 52, aB: -12, eB: 30, lF: 8, kF: 6, lB: -8, kB: 6, wAbs: 166, cape: 0.3 },
    walkOpt: { lockF: true, stride: 20, arm: 14 },
    runOpt: { lockF: true, stride: 34, lean: 14 },
    anim: {
      jump(h) {
        const up = h.vz > 0;
        return R.merge(h.stance, up
          ? { lF: 46, kF: 76, lB: -4, kB: 60, lean: 4, aF: 110, eF: 30, wAbs: 150, aB: -50, eB: 40, cape: 1.1 }
          : { lF: 22, kF: 30, lB: -14, kB: 26, lean: 2, aF: 120, eF: 20, wAbs: 165, aB: -80, eB: 30, cape: 1.4 });
      },
      grab(h) { return R.merge(h.stance, GRAB); },
    },
    moves,
    shot: {
      name: '精霊の火', max: 6, regen: 14, cd: 9, auto: true, air: true,
      fire(h) { spawnWisp(h); },
      hint: '敵を自動で追尾（押しっぱなしで連射）',
    },
    awaken: {
      name: '四大精霊召喚', type: 'screen', dur: 96,
      start(h) { startSummon(h); },
    },
    init(h) { h.gravMul = 0.8; h.trailCol = '#c8f7e6'; },
    update(h) {
      updateSummon(h);
      updateFairy(h);
      if (h._circle && --h._circle.life <= 0) h._circle = null;
    },
    drawBack(c, h) {
      if (h._circle) drawMagicCircle(c, h._circle);
      if (h.move === moves.awaken) drawOrbs(c, h, false);
      if (h.move === moves.special) drawBarrier(c, h, false);
      if (h._fairy && !h._fairy.front) drawFairy(c, h._fairy);
    },
    drawFront(c, h) {
      if (h.move === moves.awaken) drawOrbs(c, h, true);
      if (h.move === moves.special) drawBarrier(c, h, true);
      if (h._fairy && h._fairy.front) drawFairy(c, h._fairy);
    },
  });
})(window.BK);

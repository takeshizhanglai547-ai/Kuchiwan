'use strict';
/* =====================================================================
 *  rig.js ── 2D スケルタル・リグ（人型キャラを関節角度で描く）
 *
 *  ローカル座標: 原点=足元の地面、+x=向いている方向、y は下向きが正。
 *  角度(度): 0=真下, 90=前, 180=真上, -90=後ろ。  dir(a) = (sin a, cos a)
 *
 *  ポーズのキー:
 *    lean  胴体の前傾(度)         head 頭の傾き
 *    aF eF 前腕(手前側の腕)の上腕角度 / 肘の曲げ（前腕角度 = aF + eF）
 *    aB eB 奥側の腕
 *    lF kF 手前の脚: 太もも角度 / 膝の曲げ（すね角度 = lF - kF）
 *    lB kB 奥の脚
 *    w     武器角度（前腕基準の相対）  wAbs: 絶対角度で指定（こちら優先）
 *    wBack 1 のとき武器を体の後ろに描く
 *    grip  1 のとき奥の手を武器の柄へ自動で添える（両手持ち、IK）
 *    rot   全身の回転(度, +で前へ倒れる)  lift 全身の持ち上げ(px)
 *    hx    腰の前後オフセット(px)  drop 腰を下げる(px)
 *    cape  マントのはためき量(0..1.5)
 * ===================================================================== */
(function (BK) {
  const U = BK.U, D = U.DEG;
  const R = BK.rig = {};

  R.KEYS = ['lean', 'head', 'aF', 'eF', 'aB', 'eB', 'lF', 'kF', 'lB', 'kB', 'w', 'rot', 'lift', 'hx', 'drop', 'cape'];
  R.NEUTRAL = { lean: 4, head: 0, aF: 15, eF: 25, aB: -10, eB: 20, lF: 10, kF: 8, lB: -10, kB: 8, w: -40, rot: 0, lift: 0, hx: 0, drop: 0, cape: 0.3 };

  /** base にポーズ差分を上書きした新オブジェクト */
  R.merge = function (base, over) {
    const o = Object.assign({}, base);
    if (over) for (const k in over) o[k] = over[k];
    return o;
  };
  R.lerp = function (a, b, t) {
    const o = Object.assign({}, a);
    for (const k of R.KEYS) {
      const va = a[k], vb = b[k];
      if (va != null && vb != null) o[k] = va + (vb - va) * t;
      else if (vb != null) o[k] = vb;
    }
    if (b.wAbs != null && a.wAbs != null) o.wAbs = a.wAbs + (b.wAbs - a.wAbs) * t;
    else if (t >= 0.5) { o.wAbs = b.wAbs; }
    o.wBack = t < 0.5 ? a.wBack : b.wBack;
    o.grip = t < 0.5 ? a.grip : b.grip;
    return o;
  };

  const cache = new WeakMap();
  /**
   * キーフレーム列をサンプリング
   * frames: [[frame, poseDiff, ease?], ...]  ease は次のキーへ向かう補間 ('out' 既定)
   */
  R.sample = function (frames, f, base) {
    let c = cache.get(frames);
    if (!c || c.base !== base) {
      c = { base, res: frames.map(k => R.merge(base, k[1])) };
      cache.set(frames, c);
    }
    const res = c.res;
    if (f <= frames[0][0]) return res[0];
    for (let i = 0; i < frames.length - 1; i++) {
      const f0 = frames[i][0], f1 = frames[i + 1][0];
      if (f < f1) {
        const t = (f - f0) / Math.max(1, f1 - f0);
        const e = U.ease[frames[i + 1][2] || 'out'] || U.ease.out;
        return R.lerp(res[i], res[i + 1], e(t));
      }
    }
    return res[res.length - 1];
  };

  // ---------------------------------------------------- procedural poses
  R.idle = function (stance, t, amp) {
    const s = Math.sin(t * 0.06) * (amp == null ? 1 : amp);
    return R.merge(stance, { lean: stance.lean + s * 1.2, aF: stance.aF + s * 2, aB: stance.aB - s * 2, drop: (stance.drop || 0) + (s + 1) * 0.8, cape: 0.25 + s * 0.1 });
  };
  /** 歩き: phase はラジアン */
  R.walk = function (stance, ph, o) {
    o = o || {};
    const s = Math.sin(ph), c = Math.cos(ph);
    const st = o.stride || 26, arm = o.arm == null ? 18 : o.arm;
    return R.merge(stance, {
      lF: s * st + 4, kF: Math.max(0, -c) * 34 + 6,
      lB: -s * st + 4, kB: Math.max(0, c) * 34 + 6,
      aF: (o.lockArms || o.lockF) ? stance.aF : stance.aF - s * arm,
      aB: (o.lockArms || o.lockB) ? stance.aB : stance.aB + s * arm,
      drop: (stance.drop || 0) + Math.abs(c) * 2.5,
      lean: stance.lean + 3,
      cape: 0.6,
    });
  };
  R.run = function (stance, ph, o) {
    o = o || {};
    const s = Math.sin(ph), c = Math.cos(ph);
    const st = o.stride || 44;
    return R.merge(stance, {
      lF: s * st + 10, kF: Math.max(0, -c) * 70 + 12,
      lB: -s * st + 10, kB: Math.max(0, c) * 70 + 12,
      aF: (o.lockArms || o.lockF) ? stance.aF : stance.aF - s * 40,
      aB: (o.lockArms || o.lockB) ? stance.aB : stance.aB + s * 40,
      lean: stance.lean + (o.lean == null ? 16 : o.lean),
      drop: (stance.drop || 0) + Math.abs(c) * 4 + 2,
      cape: 1.3,
    });
  };

  // -------------------------------------------------------- skeleton math
  const dx = a => Math.sin(a * D), dy = a => Math.cos(a * D);

  /** 2リンクIK: 肩 S から目標 T へ。長さ l1,l2。bend=+1/-1 で肘の向き */
  R.ik = function (sx, sy, tx, ty, l1, l2, bend) {
    let ddx = tx - sx, ddy = ty - sy;
    let d = Math.hypot(ddx, ddy);
    const maxd = l1 + l2 - 0.01;
    if (d > maxd) { ddx *= maxd / d; ddy *= maxd / d; tx = sx + ddx; ty = sy + ddy; d = maxd; }
    const a = Math.atan2(ddy, ddx);
    const cosA = U.clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1);
    const b = a + Math.acos(cosA) * (bend || 1);
    return { ex: sx + Math.cos(b) * l1, ey: sy + Math.sin(b) * l1, hx: tx, hy: ty };
  };

  /** ポーズ → 各関節の座標 */
  R.skeleton = function (p, sp) {
    const th = sp.thigh, sh = sp.shin;
    const legExt = a => th * dy(a.t) + sh * dy(a.s);
    const fT = p.lF, fS = p.lF - p.kF, bT = p.lB, bS = p.lB - p.kB;
    const ext = Math.max(th * dy(fT) + sh * dy(fS), th * dy(bT) + sh * dy(bS));
    const hipY = -ext + (p.drop || 0);
    const hip = { x: p.hx || 0, y: hipY };
    const ta = 180 - p.lean;
    const sho = { x: hip.x + dx(ta) * sp.torso, y: hip.y + dy(ta) * sp.torso };
    const neck = { x: sho.x + dx(ta) * sp.neck, y: sho.y + dy(ta) * sp.neck };
    const ha = ta - (p.head || 0);
    const headC = { x: neck.x + dx(ha) * sp.headR, y: neck.y + dy(ha) * sp.headR };
    const shF = { x: sho.x + (sp.shoulderOff || 0), y: sho.y + 2 };
    const shB = { x: sho.x - (sp.shoulderOff || 0) * 0.6, y: sho.y + 1 };
    const elF = { x: shF.x + dx(p.aF) * sp.upper, y: shF.y + dy(p.aF) * sp.upper };
    const faF = p.aF + p.eF;
    const hdF = { x: elF.x + dx(faF) * sp.fore, y: elF.y + dy(faF) * sp.fore };
    const wa = p.wAbs != null ? p.wAbs : faF + p.w;
    const wd = { x: dx(wa), y: dy(wa) };
    const wLen = sp.weaponLen || 0;
    const tip = { x: hdF.x + wd.x * wLen, y: hdF.y + wd.y * wLen };
    let elB, hdB;
    if (p.grip && wLen) {
      const g = sp.gripDist || 9;
      const r = R.ik(shB.x, shB.y, hdF.x - wd.x * g, hdF.y - wd.y * g, sp.upper, sp.fore, -1);
      elB = { x: r.ex, y: r.ey }; hdB = { x: r.hx, y: r.hy };
    } else {
      elB = { x: shB.x + dx(p.aB) * sp.upper, y: shB.y + dy(p.aB) * sp.upper };
      const faB = p.aB + p.eB;
      hdB = { x: elB.x + dx(faB) * sp.fore, y: elB.y + dy(faB) * sp.fore };
    }
    const knF = { x: hip.x + dx(fT) * th + 1, y: hip.y + dy(fT) * th };
    const ftF = { x: knF.x + dx(fS) * sh, y: knF.y + dy(fS) * sh };
    const knB = { x: hip.x - 2 + dx(bT) * th, y: hip.y + dy(bT) * th };
    const ftB = { x: knB.x + dx(bS) * sh, y: knB.y + dy(bS) * sh };
    return { hip, sho, neck, headC, shF, shB, elF, hdF, elB, hdB, knF, ftF, knB, ftB, wa, wd, tip, ta, ha };
  };

  // ------------------------------------------------------------- drawing
  /** 先細りのカプセル（肢） */
  R.limb = function (c, x1, y1, x2, y2, w1, w2, fill, line) {
    const a = Math.atan2(y2 - y1, x2 - x1);
    const nx = -Math.sin(a), ny = Math.cos(a);
    const r1 = w1 / 2, r2 = w2 / 2;
    c.beginPath();
    c.moveTo(x1 + nx * r1, y1 + ny * r1);
    c.lineTo(x2 + nx * r2, y2 + ny * r2);
    c.arc(x2, y2, r2, a + Math.PI / 2, a - Math.PI / 2, true);
    c.lineTo(x1 - nx * r1, y1 - ny * r1);
    c.arc(x1, y1, r1, a - Math.PI / 2, a + Math.PI / 2, true);
    c.closePath();
    c.fillStyle = fill; c.fill();
    if (line) { c.strokeStyle = line; c.lineWidth = 1.1; c.stroke(); }
  };
  /** 多角形 */
  R.poly = function (c, pts, fill, line, lw) {
    c.beginPath();
    c.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) c.lineTo(pts[i], pts[i + 1]);
    c.closePath();
    if (fill) { c.fillStyle = fill; c.fill(); }
    if (line) { c.strokeStyle = line; c.lineWidth = lw || 1.1; c.stroke(); }
  };
  R.circle = function (c, x, y, r, fill, line) {
    c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2);
    if (fill) { c.fillStyle = fill; c.fill(); }
    if (line) { c.strokeStyle = line; c.lineWidth = 1.1; c.stroke(); }
  };

  /** 標準のパーツ描画（spec.draw.* で個別に上書き可能） */
  const DEF = R.defaultDraw = {
    leg(c, sp, col, hip, kn, ft, back) {
      const k = back ? col('clothDark') : col('cloth');
      R.limb(c, hip.x, hip.y, kn.x, kn.y, sp.legW, sp.legW * 0.8, k, col('line'));
      R.limb(c, kn.x, kn.y, ft.x, ft.y, sp.legW * 0.82, sp.legW * 0.7, back ? col('bootDark') : col('boot'), col('line'));
      // 足先
      R.poly(c, [ft.x - 3, ft.y - 3, ft.x + 7, ft.y - 1, ft.x + 8, ft.y + 2, ft.x - 3, ft.y + 2], back ? col('bootDark') : col('boot'), col('line'));
    },
    arm(c, sp, col, sh, el, hd, back) {
      R.limb(c, sh.x, sh.y, el.x, el.y, sp.armW, sp.armW * 0.85, back ? col('clothDark') : col('sleeve'), col('line'));
      R.limb(c, el.x, el.y, hd.x, hd.y, sp.armW * 0.85, sp.armW * 0.75, back ? col('gloveDark') : col('glove'), col('line'));
      R.circle(c, hd.x, hd.y, sp.armW * 0.52, back ? col('gloveDark') : col('glove'), col('line'));
    },
    torso(c, sp, col, sk) {
      const h = sk.hip, s = sk.sho;
      const a = Math.atan2(s.y - h.y, s.x - h.x), nx = -Math.sin(a), ny = Math.cos(a);
      const wW = sp.waistW / 2, cW = sp.chestW / 2;
      R.poly(c, [h.x + nx * wW, h.y + ny * wW, s.x + nx * cW, s.y + ny * cW, s.x - nx * cW * 0.9, s.y - ny * cW * 0.9, h.x - nx * wW, h.y - ny * wW], col('body'), col('line'));
      // ベルト
      R.limb(c, h.x - nx * wW, h.y - ny * wW + 2, h.x + nx * wW, h.y + ny * wW + 2, 4, 4, col('belt'));
    },
    head(c, sp, col, sk) {
      R.circle(c, sk.headC.x, sk.headC.y, sp.headR, col('skin'), col('line'));
      // 髪
      c.beginPath();
      c.arc(sk.headC.x - 1, sk.headC.y - 1, sp.headR + 0.5, Math.PI * 0.9, Math.PI * 2.1);
      c.fillStyle = col('hair'); c.fill();
    },
    weapon(c, sp, col, len) { // 汎用の剣（原点=柄を握る手、+x方向に刃）
      R.poly(c, [-8, -1.5, 0, -1.5, 0, 1.5, -8, 1.5], col('grip'));
      R.poly(c, [-1, -5, 2, -5, 2, 5, -1, 5], col('metalDark'));
      R.poly(c, [2, -2.5, len - 6, -2, len, 0, len - 6, 2, 2, 2.5], col('metal'), col('line'));
    },
  };

  R.DEFAULT_COLORS = {
    skin: '#d7a582', hair: '#1a1210', cloth: '#3b3130', clothDark: '#262020', sleeve: '#3b3130',
    body: '#46403d', belt: '#2a1c14', boot: '#2d2521', bootDark: '#1c1714', glove: '#3a322c', gloveDark: '#241f1b',
    metal: '#b8b6b0', metalDark: '#6d6a66', grip: '#3a2616', line: 'rgba(8,5,5,0.85)', cape: '#1d1718', capeIn: '#3a1015',
  };
  R.DEFAULT_SPEC = {
    thigh: 22, shin: 22, torso: 30, neck: 4, headR: 8, upper: 17, fore: 16,
    legW: 9, armW: 7, waistW: 13, chestW: 20, shoulderOff: 2, weaponLen: 40, gripDist: 8, scale: 1,
  };
  /** spec を既定値で補完 */
  R.makeSpec = function (o) {
    const sp = Object.assign({}, R.DEFAULT_SPEC, o);
    sp.colors = Object.assign({}, R.DEFAULT_COLORS, o.colors || {});
    sp.draw = Object.assign({}, DEF, o.draw || {});
    return sp;
  };

  /**
   * キャラクターを描く
   * c: ctx（呼び出し側で足元位置へ translate 済み、向き反転も済み）
   * opt.tint: 全身をこの色で塗る（被弾フラッシュ等） opt.t: 時刻
   * 戻り値: skeleton（武器先端の座標などに使える）
   */
  R.draw = function (c, pose, sp, opt) {
    opt = opt || {};
    const tint = opt.tint;
    const colors = opt.colors || sp.colors;
    const col = tint ? (k => (k === 'line' ? 'rgba(0,0,0,0.3)' : tint)) : (k => colors[k] || R.DEFAULT_COLORS[k] || '#f0f');
    const sk = R.skeleton(pose, sp);
    const dr = sp.draw;
    c.save();
    if (pose.rot || pose.lift) {
      const py = sk.hip.y * 0.6;
      c.translate(0, -(pose.lift || 0) + py);
      c.rotate((pose.rot || 0) * D);
      c.translate(0, -py);
    }
    if (dr.behind) dr.behind(c, sp, col, sk, pose, opt);
    if (dr.cape) dr.cape(c, sp, col, sk, pose, opt);
    if (pose.wBack && sp.weaponLen) drawWeapon(c, sp, col, sk, pose, opt);
    dr.arm(c, sp, col, sk.shB, sk.elB, sk.hdB, true, pose, opt);
    dr.leg(c, sp, col, sk.hip, sk.knB, sk.ftB, true, pose, opt);
    dr.torso(c, sp, col, sk, pose, opt);
    dr.leg(c, sp, col, sk.hip, sk.knF, sk.ftF, false, pose, opt);
    dr.head(c, sp, col, sk, pose, opt);
    if (dr.chest) dr.chest(c, sp, col, sk, pose, opt);
    if (!pose.wBack && sp.weaponLen) drawWeapon(c, sp, col, sk, pose, opt);
    dr.arm(c, sp, col, sk.shF, sk.elF, sk.hdF, false, pose, opt);
    if (dr.front) dr.front(c, sp, col, sk, pose, opt);
    c.restore();
    return sk;
  };
  function drawWeapon(c, sp, col, sk, pose, opt) {
    if (opt.noWeapon) return;
    c.save();
    c.translate(sk.hdF.x, sk.hdF.y);
    c.rotate(Math.atan2(sk.wd.y, sk.wd.x));
    sp.draw.weapon(c, sp, col, sp.weaponLen, pose, opt);
    c.restore();
  }

  /**
   * 汎用マント描画（spec.draw.cape に設定して使う）
   */
  R.capeDraw = function (c, sp, col, sk, pose, opt) {
    const t = (opt.t || 0) * 0.15;
    const fl = pose.cape == null ? 0.3 : pose.cape;
    const s = sk.sho, h = sk.hip;
    const len = sp.capeLen || 48;
    const back = 8 + fl * 24;                     // 後ろへなびく量
    const wave = Math.sin(t) * 3 * (0.4 + fl);
    const bx = s.x - back + wave, by = s.y + len - fl * 14;
    const fx = h.x - 3 - back * 0.25, fy = s.y + len * 0.92 - fl * 6;
    c.beginPath();
    c.moveTo(s.x + 5, s.y - 3);
    c.quadraticCurveTo(s.x - 10 - fl * 6, s.y + 2, s.x - 8 - back * 0.6, s.y + len * 0.45 + wave * 0.5);
    c.lineTo(bx, by);
    // ぼろぼろの裾
    const n = 5;
    for (let i = 1; i <= n; i++) {
      const k = i / n;
      const x = U.lerp(bx, fx, k), y = U.lerp(by, fy, k) + (i % 2 ? -5 : 1) + Math.sin(t * 1.3 + i) * 1.5;
      c.lineTo(x, y);
    }
    c.quadraticCurveTo(h.x + 2, h.y - 2, s.x + 3, s.y + 7);
    c.closePath();
    c.fillStyle = col('cape'); c.fill();
    c.strokeStyle = col('line'); c.lineWidth = 1.1; c.stroke();
    if (!opt.tint) {
      // 縁のリムライト
      c.strokeStyle = 'rgba(150,120,130,0.28)'; c.lineWidth = 1;
      c.beginPath(); c.moveTo(s.x - 9 - fl * 5, s.y + 4); c.quadraticCurveTo(s.x - 8 - back * 0.6, s.y + len * 0.45, bx, by); c.stroke();
    }
  };
})(window.BK);

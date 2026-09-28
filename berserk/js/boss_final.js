'use strict';
/* =====================================================================
 *  boss_final.js ── 最終ボス「フェムト」 ゴッド・ハンド 闇の鷹（ROUND 6「蝕」）
 *
 *  見た目（自前描画: rig の骨格に独自パーツを載せる）
 *   ・鷹の嘴を持つ兜、漆黒の滑らかな鎧、背に巨大な黒い羽の翼（常にゆっくり羽ばたく）
 *   ・背後に「蝕」の光輪（黒い円盤 + 光冠）。形態ごとに色が変わる（金 → 紫 → 紅）
 *   ・普段は宙に浮かび（z≈46）静かに漂う。大技の後は地に降りて膝をつく ＝ 反撃の好機
 *
 *  フェアさの約束
 *   ・攻撃はすべて 30F 以上前から予告（床の表示・手の光・きらめき・効果音）
 *   ・ダメージ 13〜24（上限 28）。大技の後は z=0 で膝をつき、のけぞる＆被ダメージ 1.25 倍
 *   ・空中にいる間はスーパーアーマー（ダメージは通る）。殴られ続けると転移で離れる
 *
 *  形態: 体力 100〜66% / 66〜33% / 33〜0%。形態変化は無敵の演出（暗転・閃光・バナー）
 *  技:
 *   shock  念動衝撃波 … 足元の紋様が光る → 地を這う輪が広がる（跳んでかわす）。形態ごとに 1/2/3 連
 *   crush  重圧       … 床に紫の円が現れ、内側の輪が縮みきると押し潰す（円の外へ）
 *   wing   転移・翼斬 … 消えて、黒い羽の渦と赤い斬撃範囲が現れる → 範囲の外へ。後に大きな隙
 *   bolt   闇の雷柱   … 床の帯と空からの細い光で予告。第2形態から交互に落ちる（落ちた所へ移る）
 *   summon 使徒召喚   … 生贄の烙印の場所から使徒・蛾が出る（同時数に上限）
 *   buffet 翼の薙ぎ払い… 近くに居座ると、足元の赤い円で予告して全周をなぎ払う
 *   beam   蝕の光線（第3形態）… 奥/手前の「列」全体が赤く光り、矢印の向きへ光線が掃く
 *                              → 光っていない列へ移るか、跳んでかわす。続けて反対の列も掃く
 *  床の予告は「無害な飛び道具」の drawShadow（影の描画タイミング＝キャラより奥）で描き、
 *  柱や光線そのものは drawFn（キャラより手前）で描く。
 * ===================================================================== */
(function (BK) {
  const U = BK.U, R = BK.rig;
  const TAU = Math.PI * 2, PI = Math.PI;

  // ================================================================ 定数
  const HOVER_Z = 46;                        // 通常の浮遊高度
  const LANE_Y = BK.DEPTH / 2;               // 奥の列 / 手前の列 の境目（蝕の光線）
  const PH_AT = [0, 0.66, 0.33];             // この体力比を下回ると次の形態へ
  const SUM_LIM = [0, 2, 3, 3];              // 手下の同時数の上限
  const SUM_CD = [0, 720, 600, 540];         // 召喚の再使用間隔
  const GLIDE = [0, 1.1, 1.3, 1.5];          // 滑空の速さ
  const REST = [0, [46, 70], [34, 54], [24, 42]];  // 技の後の間
  const BLINK_N = [0, 8, 7, 6];              // 短時間にこの回数殴られたら転移で離れる
  const DIE_T = 215;                         // 消滅演出の長さ
  const CR_RX = 40, CR_RY = 18;              // 重圧の円
  const BOLT_HW = 18;                        // 雷柱の半幅

  // ================================================================ 色
  const COL = {
    armor: '#1c1a26', armorHi: '#36314a', beak: '#5a5478', beakDk: '#2a2638', armorDk: '#100e17', rim: '#8a86b8', rimDk: '#4c4868',
    skin: '#d6ccd2', lip: '#6e4a56',
    wing: '#120f1a', wingMid: '#17131f', wingTop: '#221c2e', wingDk: '#0b0910', wingEdge: '#5a4c7a',
    line: 'rgba(4,2,8,0.92)',
  };
  const WHITE = '#f2ecff';
  /** 形態ごとの魔力の色 */
  const PHC = [null,
    { glow: '#b48cff', core: '#f6eeff' },
    { glow: '#9a66ff', core: '#f0e4ff' },
    { glow: '#ff4060', core: '#ffe8ec' },
  ];
  const VIO = { fill: '#8a4cff', edge: '#d8c0ff' };
  const RED = { fill: '#ff2244', edge: '#ffa0ae' };
  /** 光輪: [中心側, 光冠, 外周, 光条, 縁] */
  const HALO = [null,
    ['rgba(255,244,220,0.95)', 'rgba(255,170,90,0.7)', 'rgba(160,30,50,0.22)', '#ffdcaa', '#fff6e2'],
    ['rgba(244,232,255,0.95)', 'rgba(170,112,255,0.66)', 'rgba(90,20,140,0.26)', '#dcc6ff', '#f8f0ff'],
    ['rgba(255,228,228,0.95)', 'rgba(255,52,82,0.74)', 'rgba(140,0,24,0.34)', '#ff94a2', '#ffecee'],
  ];

  // ================================================================ ポーズ
  // rig のキー + wo(翼の開き 0..1) wf(羽ばたき -1..1) ws(翼の前後の振り) glow(手の光) gh(光る手 1:前 2:奥 3:両方) toe(爪先 0:下向き 1:前向き)
  const ST = { lean: -2, head: 6, aF: 14, eF: 26, aB: -14, eB: 24, lF: 16, kF: 36, lB: -6, kB: 30, w: 0, rot: 0, lift: 0, hx: 0, drop: 0, cape: 0,
    wo: 0.72, wf: 0, ws: 0, glow: 0, gh: 0, toe: 0 };
  const full = o => Object.assign({}, ST, o);
  const P_KNEEL = { lean: 26, head: 20, aF: 30, eF: 30, aB: 14, eB: 36, lF: 88, kF: 92, lB: 8, kB: 104, wo: 0.28, wf: -0.4, ws: -0.1, toe: 1, glow: 0 };
  const P_HURT = { lean: -16, head: -18, aF: -24, eF: 44, aB: -46, eB: 30, wf: 0.5, wo: 0.9 };
  const P_STAG = { lean: -20, head: -24, aF: 118, eF: 34, aB: -128, eB: 24, lF: 30, kF: 58, lB: -22, kB: 44, wo: 1, wf: 0.8, toe: 0.4 };
  const P_GLIDE = { head: 2, aF: -8, eF: 22, aB: -30, eB: 18, lF: 2, kF: 30, lB: -20, kB: 26, wo: 0.8 };
  const P_VANISH = { lean: 6, head: 8, aF: 70, eF: 70, aB: 60, eB: 70, lF: 10, kF: 30, lB: -6, kB: 24, wo: 0.05, wf: 0.2, ws: 0.3 };
  // 翼斬
  const P_WWIND = { lean: -12, head: -6, aF: -50, eF: 30, aB: -70, eB: 20, lF: 30, kF: 52, lB: -30, kB: 40, wo: 1, wf: 0.7, ws: -0.55, toe: 0.4 };
  const P_WWIND2 = Object.assign({}, P_WWIND, { ws: -0.7, wf: 0.8, lean: -14 });
  const P_WSLASH = { lean: 22, head: 10, aF: 100, eF: 0, aB: 64, eB: 10, lF: 52, kF: 64, lB: -38, kB: 30, wo: 1, wf: -0.4, ws: 1.9, toe: 0.6 };
  const P_WSLASH2 = Object.assign({}, P_WSLASH, { lean: 24, ws: 1.6, wf: -0.7, aF: 92 });
  // 衝撃波
  const P_RAISE = { lean: -8, head: -4, aF: 168, eF: 6, aB: -30, eB: 20, glow: 0.7, gh: 1, wo: 1, wf: 0.5 };
  const P_RAISE2 = Object.assign({}, P_RAISE, { aF: 174, glow: 1, wf: 0.6 });
  const P_SLAM = { lean: 16, head: 12, aF: 64, eF: -6, aB: -40, eB: 20, glow: 0.8, gh: 1, wo: 1, wf: -0.7, lF: 30, kF: 50, toe: 0.3 };
  const P_SLAM2 = { lean: 12, head: 8, aF: 56, eF: 0, aB: -30, glow: 0.25, gh: 1, wo: 0.9, wf: -0.3 };
  // 重圧
  const P_UP2 = { lean: -6, head: -10, aF: 160, eF: 14, aB: 150, eB: 18, glow: 0.6, gh: 3, wo: 1, wf: 0.4 };
  const P_UP2B = Object.assign({}, P_UP2, { aF: 170, aB: 162, glow: 1, wf: 0.55 });
  const P_PRESS = { lean: 12, head: 12, aF: 84, eF: -10, aB: 72, eB: -6, glow: 0.6, gh: 3, wo: 1, wf: -0.6 };
  const P_PRESS2 = Object.assign({}, P_PRESS, { lean: 8, glow: 0.2, wf: -0.3 });
  // 雷柱
  const P_CAST = { lean: -6, head: -8, aF: 150, eF: 20, aB: -40, eB: 30, glow: 0.7, gh: 1, wo: 1, wf: 0.5 };
  const P_CASTB = Object.assign({}, P_CAST, { aF: 160, glow: 1 });
  const P_STRIKE = { lean: 14, head: 6, aF: 96, eF: -4, aB: -50, eB: 20, glow: 0.5, gh: 1, wo: 1, wf: -0.5 };
  // 召喚
  const P_SUM = { lean: 4, head: 16, aF: 110, eF: 40, aB: -20, eB: 30, glow: 0.8, gh: 1, wo: 0.95, wf: 0.3 };
  const P_SUMB = Object.assign({}, P_SUM, { glow: 1, aF: 118 });
  const P_SUM2 = { lean: 8, head: 10, aF: 70, eF: 10, aB: -30, eB: 20, glow: 0.2, gh: 1, wo: 1, wf: -0.2 };
  // 薙ぎ払い
  const P_BUF1 = { lean: -10, head: -4, aF: 112, eF: 64, aB: 100, eB: 66, wo: 1, wf: 1, ws: -0.35, lF: 26, kF: 44 };
  const P_BUF1B = Object.assign({}, P_BUF1, { wf: 1.1, lean: -12 });
  const P_BUF2 = { lean: 18, head: 10, aF: 30, eF: 10, aB: 20, eB: 16, wo: 1, wf: -1, ws: 0.9, lF: 40, kF: 60, toe: 0.5 };
  const P_BUF2B = Object.assign({}, P_BUF2, { wf: -0.8, ws: 0.7 });
  // 蝕の光線
  const P_BREADY = { lean: -6, head: 10, aF: 58, eF: 4, aB: -60, eB: 20, glow: 0.7, gh: 1, wo: 1, wf: 0.8, ws: -0.1 };
  const P_BREADYB = Object.assign({}, P_BREADY, { glow: 1, wf: 0.9 });
  const P_BFIRE = Object.assign({}, P_BREADY, { lean: -10, aF: 50, glow: 1, wf: 0.9 });
  const P_DESC = { lean: 16, head: 14, aF: 30, eF: 30, aB: 10, eB: 30, wo: 0.5, wf: -0.2, lF: 40, kF: 60, toe: 0.6 };
  // 形態変化
  const P_CURL = { lean: 30, head: 30, aF: 80, eF: 90, aB: 70, eB: 90, lF: 60, kF: 90, lB: 20, kB: 80, wo: 0.1, wf: 0.1, ws: 0.4, toe: 0.3 };
  const P_CURL2 = Object.assign({}, P_CURL, { lean: 34, head: 34 });
  const P_SPREAD = { lean: -14, head: -26, aF: 110, eF: 6, aB: -110, eB: 6, lF: 10, kF: 20, lB: -10, kB: 16, wo: 1, wf: 0.9, ws: -0.1, glow: 1, gh: 3 };
  // 消滅
  const DIE_KF = [[0, { lean: -22, head: -36, aF: 150, eF: 14, aB: 170, eB: 10, wo: 1, wf: 0.9, lF: 30, kF: 50, lB: -20, kB: 40 }],
    [70, { lean: -28, head: -44, aF: 160, eF: 8, aB: 176, eB: 6, wo: 1, wf: 1, lF: 20, kF: 30, lB: -24, kB: 30 }],
    [220, { lean: -30, head: -46, aF: 164, eF: 4, aB: 178, eB: 4, wo: 1, wf: 1.1, lF: 14, kF: 20, lB: -26, kB: 24 }]];
  const F_KNEEL = full(P_KNEEL), F_HURT = full(P_HURT), F_STAG = full(P_STAG), F_GLIDE = full(P_GLIDE), F_VANISH = full(P_VANISH);

  /** 任意の数値キーを補間（rig の R.lerp は翼のキーを補間しないため） */
  const STEP_KEYS = { gh: 1 };
  function lerpPose(a, b, t) {
    const o = {};
    for (const k in a) o[k] = a[k];
    for (const k in b) {
      const va = a[k], vb = b[k];
      if (STEP_KEYS[k]) o[k] = t < 0.5 && va != null ? va : vb;
      else if (typeof va === 'number' && typeof vb === 'number') o[k] = va + (vb - va) * t;
      else o[k] = vb;
    }
    return o;
  }
  const _poseCache = new WeakMap();
  /** キーフレーム [[frame, diff, ease]] をサンプリング（既定の補間は inOut ＝ 静かな動き） */
  function samp(frames, f, base) {
    let cc = _poseCache.get(frames);
    if (!cc || cc.base !== base) { cc = { base, res: frames.map(k => Object.assign({}, base, k[1])) }; _poseCache.set(frames, cc); }
    const res = cc.res;
    if (f <= frames[0][0]) return res[0];
    for (let i = 0; i < frames.length - 1; i++) {
      const f1 = frames[i + 1][0];
      if (f < f1) {
        const f0 = frames[i][0];
        const ez = U.ease[frames[i + 1][2] || 'inOut'] || U.ease.inOut;
        return lerpPose(res[i], res[i + 1], ez((f - f0) / Math.max(1, f1 - f0)));
      }
    }
    return res[res.length - 1];
  }

  // ================================================================ 描画パーツ（rig 座標: 原点=足元, +x=前, y下向き）
  /** 羽根1枚の形（パスに追加するだけ） */
  function featherPath(c, x, y, ang, len, w) {
    const dx = Math.cos(ang), dy = Math.sin(ang), px = -dy, py = dx;
    const mx = x + dx * len * 0.5, my = y + dy * len * 0.5;
    c.moveTo(x + px * w * 0.3, y + py * w * 0.3);
    c.lineTo(mx + px * w * 0.5, my + py * w * 0.5);
    c.lineTo(x + dx * len, y + dy * len);
    c.lineTo(mx - px * w * 0.42, my - py * w * 0.42);
    c.lineTo(x - px * w * 0.3, y - py * w * 0.3);
    c.closePath();
  }
  const WL1 = 27, WL2 = 33;
  /** 片翼（原点=付け根、-x 方向＝後ろ上方へ広がる）。o=開き, fl=羽ばたき, sw=前後の振り */
  function drawWing(c, col, o, fl, sw, dark, tint) {
    const oc = Math.min(1, o);
    const a1 = -PI / 2 - 0.5 - 0.3 * o + fl * 0.4 + sw;
    const ex = Math.cos(a1) * WL1, ey = Math.sin(a1) * WL1;
    const a2 = a1 - (0.55 + 1.9 * (1 - oc)) + fl * 0.3;
    const wx = ex + Math.cos(a2) * WL2, wy = ey + Math.sin(a2) * WL2;
    const edge = tint ? null : (dark ? 'rgba(66,54,96,0.45)' : 'rgba(96,80,142,0.5)');
    // 初列風切（翼端の長い羽）
    c.beginPath();
    const N = 10, spread = 0.35 + 1.1 * o;
    for (let i = N - 1; i >= 0; i--) {
      const u = i / (N - 1);
      const len = (46 + 20 * o) * (1 - 0.3 * u) + (i === 0 ? 4 : 0);
      featherPath(c, wx + (ex - wx) * u * 0.35, wy + (ey - wy) * u * 0.35, a2 + 0.2 * o - spread * u, len, 13);
    }
    c.fillStyle = col(dark ? 'wingDk' : 'wing'); c.fill();
    if (edge) { c.strokeStyle = edge; c.lineWidth = 0.7; c.stroke(); }
    // 次列風切（前腕から垂れる）+ 三列（上腕から垂れる）
    c.beginPath();
    for (let j = 7; j >= 0; j--) {
      const v = (j + 0.5) / 8;
      featherPath(c, ex + (wx - ex) * v, ey + (wy - ey) * v, a2 - PI / 2 + 0.55 * v - 0.12, (30 + 16 * v) * (0.6 + 0.4 * oc), 13);
    }
    for (let j = 4; j >= 0; j--) {
      const v = (j + 0.5) / 5;
      featherPath(c, ex * v, ey * v, a1 - PI / 2 + 0.25 * v, (20 + 10 * v) * (0.7 + 0.3 * oc), 12);
    }
    c.fillStyle = col(dark ? 'wingDk' : 'wingMid'); c.fill();
    if (edge) c.stroke();
    // 雨覆（骨の上を覆う厚い部分）
    const n1x = Math.cos(a1 - PI / 2), n1y = Math.sin(a1 - PI / 2), n2x = Math.cos(a2 - PI / 2), n2y = Math.sin(a2 - PI / 2);
    const tx = wx + Math.cos(a2) * 7, ty = wy + Math.sin(a2) * 7;
    const pts = [-4, -3, ex - n1x * 2.5, ey - n1y * 2.5, wx - n2x * 2, wy - n2y * 2, tx, ty];
    const c2 = Math.cos(a2), s2 = Math.sin(a2);
    for (let j = 0; j <= 5; j++) {            // 後縁はぎざぎざ（羽先）
      const v = 1 - j / 5, d = j % 2 ? 8 : 12.5;
      pts.push(ex + (wx - ex) * v + n2x * d - c2 * (j % 2 ? 0 : 3), ey + (wy - ey) * v + n2y * d - s2 * (j % 2 ? 0 : 3));
    }
    for (let j = 1; j <= 3; j++) {
      const v = 1 - j / 3, d = j % 2 ? 10 : 14;
      pts.push(ex * v + n1x * d, ey * v + n1y * d + (j === 3 ? 3 : 0));
    }
    R.poly(c, pts, col(dark ? 'wingDk' : 'wingTop'), col('line'), 1);
    if (!tint) {
      // 雨覆の羽の段と前縁のリムライト
      c.strokeStyle = dark ? 'rgba(70,58,100,0.5)' : 'rgba(110,94,160,0.55)'; c.lineWidth = 0.8;
      c.beginPath();
      for (let j = 1; j < 5; j++) {
        const v = j / 5;
        const bx = ex + (wx - ex) * v, by = ey + (wy - ey) * v;
        c.moveTo(bx - n2x, by - n2y); c.lineTo(bx + n2x * 7 - Math.cos(a2) * 4, by + n2y * 7 - Math.sin(a2) * 4);
      }
      c.stroke();
      c.strokeStyle = col(dark ? 'rimDk' : 'wingEdge'); c.lineWidth = dark ? 1.1 : 1.6; c.lineJoin = 'round';
      c.beginPath(); c.moveTo(-3, -3); c.lineTo(ex - n1x * 2.5, ey - n1y * 2.5); c.lineTo(wx - n2x * 2, wy - n2y * 2); c.lineTo(tx, ty); c.stroke();
    }
    return { wx, wy };
  }
  /** 背の蝕の光輪 + 翼 2枚 */
  function fBehind(c, sp, col, sk, pose, opt) {
    // 被弾の白フラッシュは体だけ（巨大な翼まで白くすると画面がちらつく）。消滅演出の白は翼も含める
    if (opt.tint && !opt.allWhite) col = k => SPEC.colors[k];
    const tint = !!opt.tint && !!opt.allWhite;
    const o = U.clamp(pose.wo == null ? 0.7 : pose.wo, 0, 1.1), fl = pose.wf || 0, sw = pose.ws || 0;
    const s = sk.sho;
    if (!opt.noHalo && opt.fm) drawHalo(c, sk, opt.fm);
    // 奥の翼（鏡像にして前上方へ）
    c.save(); c.translate(s.x - 1, s.y + 2); c.scale(-0.94, 0.96);
    drawWing(c, col, o, fl * 0.9, 0.42 - sw * 0.7, true, tint);
    c.restore();
    // 手前の翼（後ろ上方へ）
    c.save(); c.translate(s.x - 6, s.y + 4);
    const w = drawWing(c, col, o, fl, sw, false, tint);
    c.restore();
    if (opt.fm) { opt.fm.wingX = s.x - 6 + w.wx; opt.fm.wingY = s.y + 4 + w.wy; }
  }
  /** 蝕の光輪（一度だけオフスクリーンに描いたものを回して貼る） */
  function haloSprite(ph) {
    if (!BK.bg || !BK.bg.layer) return null;
    return BK.bg.layer('femtoHalo' + ph, 220, 220, (c, w, h) => {
      const A = HALO[ph], cx = w / 2, cy = h / 2;
      const g = c.createRadialGradient(cx, cy, 38, cx, cy, 108);
      g.addColorStop(0, A[0]); g.addColorStop(0.1, A[1]); g.addColorStop(0.4, A[2]); g.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = g; c.beginPath(); c.arc(cx, cy, 108, 0, TAU); c.fill();
      const r = U.srand(71 + ph * 13);
      c.lineCap = 'round'; c.strokeStyle = A[3];
      for (let i = 0; i < 26; i++) {
        const a = r() * TAU, l = 50 + r() * 44;
        c.globalAlpha = 0.14 + r() * 0.4; c.lineWidth = 0.8 + r() * 2;
        c.beginPath(); c.moveTo(cx + Math.cos(a) * 41, cy + Math.sin(a) * 41); c.lineTo(cx + Math.cos(a) * l, cy + Math.sin(a) * l); c.stroke();
      }
      c.globalAlpha = 1;
      c.fillStyle = '#040206'; c.beginPath(); c.arc(cx, cy, 39, 0, TAU); c.fill();
      c.strokeStyle = A[4]; c.lineWidth = 2.4; c.beginPath(); c.arc(cx, cy, 39.5, 0, TAU); c.stroke();
    });
  }
  function drawHalo(c, sk, F) {
    const s = (F.haloS == null ? 1 : F.haloS) * (F.phase === 3 ? 1.12 : 1) * (1 + 0.03 * Math.sin(F.t * 0.05));
    if (s <= 0.01) return;
    const img = haloSprite(F.phase);
    if (!img) return;
    const size = 104 * s;
    c.save();
    c.translate(sk.sho.x - 13, sk.sho.y - 13);
    c.rotate(F.t * 0.004);
    c.drawImage(img, -size / 2, -size / 2, size, size);
    c.restore();
  }
  /** 鷹の嘴の兜 */
  function fHead(c, sp, col, sk, pose, opt) {
    const hc = sk.headC, r = sp.headR, tint = !!opt.tint;
    c.save(); c.translate(hc.x, hc.y); c.rotate((180 - sk.ha) * U.DEG);
    // 後ろへ流れる冠羽（刃のような飾り）
    R.poly(c, [-r * 0.2, -r * 0.9, -r * 1.6, -r * 1.4, -r * 3.0, -r * 1.25, -r * 1.55, -r * 0.72, -r * 2.6, -r * 0.3, -r * 1.25, -r * 0.02, -r * 0.6, r * 0.35], col('armorDk'), col('line'));
    // 兜の本体
    c.beginPath(); c.ellipse(0, 0, r * 1.02, r * 0.98, 0, 0, TAU);
    c.fillStyle = col('armor'); c.fill(); c.strokeStyle = col('line'); c.lineWidth = 1; c.stroke();
    // 顔の下半分（白い顎）
    c.beginPath(); c.ellipse(r * 0.78, r * 0.56, r * 0.46, r * 0.38, 0.2, 0, TAU);
    c.fillStyle = col('skin'); c.fill(); c.stroke();
    // 鷹の嘴（面頬）: 額から前へ伸び、鋭い鉤となって口元の前へ垂れる
    c.beginPath();
    c.moveTo(-r * 0.7, -r * 0.85);
    c.quadraticCurveTo(r * 0.8, -r * 1.38, r * 1.75, -r * 0.55);
    c.quadraticCurveTo(r * 2.45, r * 0.0, r * 2.2, r * 1.08);
    c.quadraticCurveTo(r * 1.95, r * 0.36, r * 1.42, r * 0.2);
    c.lineTo(r * 0.3, r * 0.06);
    c.quadraticCurveTo(-r * 0.3, -r * 0.2, -r * 0.7, -r * 0.85);
    c.closePath();
    c.fillStyle = col('beak'); c.fill(); c.strokeStyle = col('line'); c.lineWidth = 1; c.stroke();
    if (!tint) {
      // 嘴の下面の影と稜線の光
      R.poly(c, [r * 1.42, r * 0.2, r * 1.95, r * 0.36, r * 2.2, r * 1.08, r * 1.72, r * 0.44], col('beakDk'));
      c.strokeStyle = '#d8d2f4'; c.lineWidth = 1.2;
      c.beginPath(); c.moveTo(-r * 0.45, -r * 0.98); c.quadraticCurveTo(r * 0.8, -r * 1.3, r * 1.72, -r * 0.6); c.quadraticCurveTo(r * 2.3, -r * 0.05, r * 2.18, r * 0.95); c.stroke();
      c.strokeStyle = col('rimDk'); c.lineWidth = 0.8;
      c.beginPath(); c.moveTo(-r * 0.9, -r * 0.2); c.quadraticCurveTo(-r * 0.7, r * 0.6, -r * 0.1, r * 0.9); c.stroke();
      // 面頬の下から覗く紅い眼
      c.strokeStyle = '#ff3a5a'; c.lineWidth = 1.4;
      c.beginPath(); c.moveTo(r * 0.55, r * 0.17); c.lineTo(r * 1.15, r * 0.24); c.stroke();
      // 口元
      c.strokeStyle = col('lip'); c.lineWidth = 0.8;
      c.beginPath(); c.moveTo(r * 0.8, r * 0.72); c.lineTo(r * 1.12, r * 0.66); c.stroke();
    }
    c.restore();
  }
  function fTorso(c, sp, col, sk, pose, opt) {
    const h = sk.hip, s = sk.sho;
    const a = Math.atan2(s.y - h.y, s.x - h.x), nx = -Math.sin(a), ny = Math.cos(a);
    const wW = sp.waistW / 2, cW = sp.chestW / 2;
    const P = (k, off) => [h.x + (s.x - h.x) * k + nx * off, h.y + (s.y - h.y) * k + ny * off];
    // 腰の草摺（刃状の板）
    for (let i = 0; i < 3; i++) {
      const off = (1 - i) * wW * 0.75;
      const b = P(0.04, off), tip = P(-0.52, off * 1.2 - 3.5);
      R.poly(c, [b[0] + nx * 3, b[1] + ny * 3, tip[0], tip[1], b[0] - nx * 3.2, b[1] - ny * 3.2], col(i === 2 ? 'armorDk' : 'armor'), col('line'));
    }
    // 胴
    R.poly(c, [...P(0, wW), ...P(1, cW), ...P(1, -cW * 0.9), ...P(0, -wW)], col('armor'), col('line'));
    // 胸甲
    R.poly(c, [...P(0.5, 0.5), ...P(0.55, wW + 1.6), ...P(0.96, cW + 0.6), ...P(1.03, cW * 0.1), ...P(0.8, -2.5)], col('armorHi'), col('line'));
    if (!opt.tint) {
      c.strokeStyle = col('rimDk'); c.lineWidth = 0.9;
      c.beginPath();
      for (const k of [0.2, 0.33]) { const p0 = P(k, -wW * 0.6), p1 = P(k, wW * 0.95); c.moveTo(p0[0], p0[1]); c.lineTo(p1[0], p1[1]); }
      const q0 = P(0.05, 1), q1 = P(0.5, 1.5); c.moveTo(q0[0], q0[1]); c.lineTo(q1[0], q1[1]);
      c.stroke();
      // 前縁のリムライト
      c.strokeStyle = col('rim'); c.lineWidth = 1.1;
      const r0 = P(0.08, wW - 0.6), r1 = P(0.55, wW + 1.2), r2 = P(0.95, cW); c.beginPath(); c.moveTo(r0[0], r0[1]); c.lineTo(r1[0], r1[1]); c.lineTo(r2[0], r2[1]); c.stroke();
    }
  }
  function fArm(c, sp, col, sh, el, hd, back, pose, opt) {
    const fill = col(back ? 'armorDk' : 'armor'), hi = col(back ? 'armorDk' : 'armorHi');
    R.limb(c, sh.x, sh.y, el.x, el.y, sp.armW, sp.armW * 0.8, fill, col('line'));
    R.limb(c, el.x, el.y, hd.x, hd.y, sp.armW * 0.85, sp.armW * 0.6, fill, col('line'));
    // 肘の棘
    const ua = Math.atan2(el.y - sh.y, el.x - sh.x), ux = Math.cos(ua), uy = Math.sin(ua);
    R.poly(c, [el.x - uy * 2.6, el.y + ux * 2.6, el.x + ux * 7, el.y + uy * 7, el.x + uy * 2.6, el.y - ux * 2.6], hi, col('line'));
    // 鉤爪
    const fa = Math.atan2(hd.y - el.y, hd.x - el.x), cx = Math.cos(fa), cy = Math.sin(fa), px = -cy, py = cx;
    c.beginPath();
    for (let i = -1; i <= 1; i++) {
      const bx = hd.x + px * i * 1.7, by = hd.y + py * i * 1.7, L = 7.5 - Math.abs(i) * 1.5;
      c.moveTo(bx + px * 0.9, by + py * 0.9); c.lineTo(bx + cx * L + px * i * 1.3, by + cy * L + py * i * 1.3); c.lineTo(bx - px * 0.9, by - py * 0.9);
    }
    c.fillStyle = hi; c.fill();
    R.circle(c, hd.x, hd.y, sp.armW * 0.42, fill, col('line'));
    // 肩当て（羽根状に重なる板）
    R.poly(c, [sh.x + 4, sh.y - 1, sh.x - 2, sh.y - 5.5, sh.x - 12, sh.y - 8, sh.x - 6, sh.y - 1, sh.x - 10, sh.y + 3, sh.x - 3, sh.y + 5, sh.x + 4, sh.y + 3], hi, col('line'));
    if (!back && !opt.tint) {
      c.strokeStyle = col('rim'); c.lineWidth = 1;
      c.beginPath(); c.moveTo(sh.x - 1, sh.y - 5); c.lineTo(sh.x - 11, sh.y - 7.5); c.stroke();
    }
  }
  function fLeg(c, sp, col, hip, kn, ft, back, pose, opt) {
    const fill = col(back ? 'armorDk' : 'armor');
    R.limb(c, hip.x, hip.y, kn.x, kn.y, sp.legW, sp.legW * 0.8, fill, col('line'));
    R.limb(c, kn.x, kn.y, ft.x, ft.y, sp.legW * 0.78, sp.legW * 0.42, fill, col('line'));
    // 膝当て
    R.poly(c, [kn.x + 5, kn.y - 1.5, kn.x, kn.y - 4.5, kn.x - 2.5, kn.y + 1, kn.x + 1, kn.y + 3.5], col(back ? 'armorDk' : 'armorHi'), col('line'));
    // 尖った爪先（浮遊中は下へ、膝をつくと前へ）
    const sa = Math.atan2(ft.y - kn.y, ft.x - kn.x);
    const ta = U.lerp(sa, 0.12, U.clamp(pose.toe || 0, 0, 1));
    const tx = Math.cos(ta), ty = Math.sin(ta);
    R.poly(c, [ft.x - ty * 2.6, ft.y + tx * 2.6, ft.x + tx * 9.5, ft.y + ty * 9.5, ft.x + ty * 2.6, ft.y - tx * 2.6], fill, col('line'));
    if (!back && !opt.tint) {
      c.strokeStyle = col('rim'); c.lineWidth = 0.9;
      const a = Math.atan2(kn.y - hip.y, kn.x - hip.x), nx = -Math.sin(a) * 3.2, ny = Math.cos(a) * 3.2;
      c.beginPath(); c.moveTo(hip.x - nx, hip.y - ny); c.lineTo(kn.x - nx * 0.8, kn.y - ny * 0.8); c.stroke();
    }
  }
  /** 手に宿る魔力の光 */
  function fFront(c, sp, col, sk, pose, opt) {
    const g = pose.glow || 0;
    if (g <= 0.02 || opt.tint) return;
    const gh = pose.gh || 0, pc = PHC[(opt.fm && opt.fm.phase) || 1];
    const A0 = c.globalAlpha;
    for (const hd of [(gh & 1) ? sk.hdF : null, (gh & 2) ? sk.hdB : null]) {
      if (!hd) continue;
      const fl = 0.85 + 0.15 * Math.sin((opt.t || 0) * 0.6 + hd.x);
      c.fillStyle = pc.glow;
      c.globalAlpha = A0 * 0.22 * g; c.beginPath(); c.arc(hd.x, hd.y, (6 + 7 * g) * fl, 0, TAU); c.fill();
      c.globalAlpha = A0 * 0.5 * g; c.beginPath(); c.arc(hd.x, hd.y, (3 + 3 * g) * fl, 0, TAU); c.fill();
      c.fillStyle = pc.core; c.globalAlpha = A0 * 0.95 * g; c.beginPath(); c.arc(hd.x, hd.y, 1.6 + 1.2 * g, 0, TAU); c.fill();
    }
    c.globalAlpha = A0;
  }
  const SPEC = R.makeSpec({
    scale: 1.3, thigh: 21, shin: 23, torso: 30, neck: 5, headR: 8.6, upper: 17, fore: 16,
    legW: 8, armW: 6.5, waistW: 11, chestW: 20, shoulderOff: 2, weaponLen: 0,
    colors: COL,
    draw: { head: fHead, torso: fTorso, arm: fArm, leg: fLeg, behind: fBehind, front: fFront },
  });

  // ---------------------------------------------------------------- 画面座標の小物
  /** 予備動作の「きらめき」（画面座標） */
  function glint(c, x, y, s, a, col) {
    if (a <= 0) return;
    c.save(); c.globalAlpha = Math.min(1, a); c.fillStyle = col || '#f4ecff';
    c.beginPath();
    c.moveTo(x, y - s); c.lineTo(x + s * 0.17, y - s * 0.17); c.lineTo(x + s, y); c.lineTo(x + s * 0.17, y + s * 0.17);
    c.lineTo(x, y + s); c.lineTo(x - s * 0.17, y + s * 0.17); c.lineTo(x - s, y); c.lineTo(x - s * 0.17, y - s * 0.17);
    c.closePath(); c.fill();
    c.fillStyle = '#ffffff'; c.beginPath(); c.arc(x, y, s * 0.2, 0, TAU); c.fill();
    c.restore();
  }
  function drawGlints(c, e, anc) {
    const m = e.move;
    if (!m || !m.glint) return;
    for (const g of m.glint) {
      const d = e.mf - g[0];
      if (d < 0 || d > 12) continue;
      const p = anc[g[1]];
      if (!p) continue;
      const k = d < 4 ? d / 4 : 1 - (d - 4) / 8;
      glint(c, p[0], p[1], 7 + 11 * k, k + 0.2, g[2]);
    }
  }
  /** 小さな羽根の形（画面座標） */
  function featherShape(c, x, y, ang, s, col) {
    c.save(); c.translate(x, y); c.rotate(ang);
    c.fillStyle = col;
    c.beginPath(); c.moveTo(-s, 0); c.quadraticCurveTo(0, -s * 0.34, s, 0); c.quadraticCurveTo(0, s * 0.26, -s, 0); c.fill();
    c.restore();
  }
  function drawFeatherP(c, sx, sy, k, p) {
    const age = p.max - p.life;
    c.save();
    c.globalAlpha = Math.min(1, k * 2.5);
    c.translate(sx, sy); c.rotate(p.rot + age * p.vr);
    const s = p.size;
    c.fillStyle = p.col;
    c.beginPath(); c.moveTo(-s, 0); c.quadraticCurveTo(0, -s * 0.34, s, 0); c.quadraticCurveTo(0, s * 0.26, -s, 0); c.fill();
    c.strokeStyle = 'rgba(140,120,190,0.55)'; c.lineWidth = 0.6;
    c.beginPath(); c.moveTo(-s * 1.15, 0); c.lineTo(s * 0.8, 0); c.stroke();
    c.restore();
  }
  /** 舞い散る黒い羽根（fx の custom パーティクル） */
  function featherFx(x, y, z, vx, vz, life, size, col) {
    BK.fx.add({ type: 'custom', x, y, z, vx, vz, g: 0.03, drag: 0.95, life, size, rot: U.rand(0, TAU), vr: U.rand(-0.14, 0.14), col: col || U.choose(['#0e0b14', '#17121f', '#221a2c']), draw: drawFeatherP });
  }
  function featherBurst(e, n, spd) {
    for (let i = 0; i < n; i++) {
      const a = U.rand(0, TAU);
      featherFx(e.x + Math.cos(a) * 12, e.y + U.rand(-4, 4), e.z + U.rand(40, 130), Math.cos(a) * U.rand(0.8, spd || 3.5), U.rand(-0.5, 2.5), U.randi(40, 70), U.rand(4, 7));
    }
  }

  // ================================================================ 床の予告（画面座標で描く）
  function pulse(sp) { return 0.5 + 0.5 * Math.sin(BK.frame * sp); }
  /** 床の楕円: k=0..1 は発動までの進み具合（内側の輪が縮む） */
  function floorOval(c, x, y, rx, ry, k, hot, pal) {
    const sx = BK.sx(x), sy = BK.sy(y, 0), pu = pulse(hot ? 0.9 : 0.3 + 0.4 * k);
    c.save();
    c.beginPath(); c.ellipse(sx, sy, rx, ry, 0, 0, TAU);
    c.globalAlpha = hot ? 0.34 + 0.14 * pu : 0.1 + 0.2 * k + 0.05 * pu; c.fillStyle = pal.fill; c.fill();
    c.globalAlpha = 0.55 + 0.4 * pu; c.strokeStyle = pal.edge; c.lineWidth = 1.8; c.stroke();
    const kk = 1 - U.clamp(k, 0, 1);
    if (kk > 0.05) { c.globalAlpha = 0.8; c.lineWidth = 1.3; c.beginPath(); c.ellipse(sx, sy, rx * kk, ry * kk, 0, 0, TAU); c.stroke(); }
    // 紋様の刻み（回る）
    c.globalAlpha = 0.45 + 0.35 * k; c.lineWidth = 1.2; c.beginPath();
    const rot = BK.frame * 0.02;
    for (let i = 0; i < 8; i++) {
      const a = rot + i * TAU / 8, ca = Math.cos(a), sa = Math.sin(a);
      c.moveTo(sx + ca * rx * 0.74, sy + sa * ry * 0.74); c.lineTo(sx + ca * rx * 0.94, sy + sa * ry * 0.94);
    }
    c.stroke();
    c.restore();
  }
  /** 床の長方形（斬撃範囲など） */
  function floorRect(c, x0, x1, y0, y1, k, hot, pal) {
    const a = Math.min(x0, x1), b = Math.max(x0, x1);
    const sx0 = BK.sx(a), sx1 = BK.sx(b), sy0 = BK.sy(y0, 0), sy1 = BK.sy(y1, 0);
    const pu = pulse(hot ? 0.9 : 0.25 + k * 0.4);
    c.save();
    c.globalAlpha = hot ? 0.38 + 0.12 * pu : 0.08 + 0.22 * k + 0.06 * pu; c.fillStyle = pal.fill;
    c.fillRect(sx0, sy0, sx1 - sx0, sy1 - sy0);
    c.globalAlpha = 0.5 + 0.4 * pu; c.strokeStyle = pal.edge; c.lineWidth = 1.6;
    c.setLineDash([7, 5]); c.lineDashOffset = -BK.frame * 0.6; c.strokeRect(sx0, sy0, sx1 - sx0, sy1 - sy0); c.setLineDash([]);
    c.restore();
  }

  // ================================================================ 攻撃の器（無害な飛び道具 + 独自の当たり判定）
  function hazard(e, o) {
    const g = BK.game;
    if (!g || !g.addProjectile) return null;
    const step = o.step;
    const p = new BK.Projectile(Object.assign({ x: e.x, y: e.y, z: 0, w: 1, h: 1, team: 'enemy', owner: e, harmless: true, life: 600, noShadow: true }, o));
    p.tick = function (pp) {
      // ボスが倒れたら（または別のゲームになったら）すべて消える
      if (e.dead || e.remove || BK.game !== g) { pp.remove = true; return; }
      // 予告だけの表示は、技が中断されたら消す（攻撃の来ない予告を残さない）
      if (pp.bind && e.move !== pp.bind) { pp.remove = true; return; }
      if (step) step(pp, e);
    };
    g.addProjectile(p);
    return p;
  }
  /** 主人公側への当たり判定（test が true の相手に h を当てる）。p があれば同じ相手には1回だけ */
  function strike(e, p, test, h) {
    const g = BK.game;
    if (!g) return false;
    let any = false;
    for (const t of g.actors) {
      if (t.team !== 'hero' || !t.hurtable || (p && p.hit.has(t))) continue;
      if (!test(t)) continue;
      const dir = (p && p.pushDir) || U.sign(t.x - (p ? p.x : e.x) || e.face);
      if (t.takeHit(e, h, dir)) { if (p) p.hit.add(t); BK.combat.hitFx(e, t, h, t.x, dir); any = true; }
    }
    return any;
  }
  function minionCount(e, g) {
    let n = 0;
    if (!g) return 0;
    for (const a of g.actors) if (a.team === 'enemy' && a !== e && !a.dead && !a.isProp) n++;
    return n;
  }

  /** 足元の紋様（技の予告。ボスについて動く） */
  function runeMarker(e, T, rx, ry, pal) {
    return hazard(e, {
      T, life: T, rx, ry, pal, bind: e.move,
      step(p) { p.x = e.x; p.y = e.y; },
      drawShadow(c) { floorOval(c, this.x, this.y, this.rx, this.ry, this.t / this.T, this.t >= this.T - 8, this.pal); },
      drawFn() {},
    });
  }

  // ---------------------------------------------------------------- 念動衝撃波（地を這う輪）
  function spawnRing(e, dmg, spd) {
    const hdef = { dmg, kb: 'down', push: 4, lift: 5, stop: 4, sfx: 'hitHeavy' };
    const col = PHC[st(e).phase];
    return hazard(e, {
      r: 18, spd, life: 140, col,
      step(p) {
        p.r += p.spd;
        if (p.r > 540) { p.remove = true; return; }
        strike(e, p, t => t.z < 20 && Math.abs(Math.hypot(t.x - p.x, (t.y - p.y) * 2.2) - p.r) < 12 + t.w / 2, hdef);
        if (p.t % 2 === 0) {
          const a = U.rand(0, TAU), x = p.x + Math.cos(a) * p.r, y = p.y + Math.sin(a) * p.r / 2.2;
          if (y > 0 && y < BK.DEPTH && x > BK.cam.x - 20 && x < BK.cam.x + BK.W + 20) BK.fx.add({ type: 'smoke', x, y, z: 3, vz: U.rand(0.5, 1.4), life: 18, size: U.rand(5, 9), col: 'rgba(90,60,120,0.4)', drag: 0.95 });
        }
      },
      drawShadow(c) { drawRingHalf(c, this, true); },
      drawFn(c) { drawRingHalf(c, this, false); },
    });
  }
  /** 輪の奥半分はキャラの後ろ（drawShadow）、手前半分はキャラの前（drawFn）に描く */
  function drawRingHalf(c, p, back) {
    const sx = BK.sx(p.x), sy = BK.sy(p.y, 0), rx = p.r, ry = p.r / 2.2;
    const fade = Math.min(1, (540 - p.r) / 140, p.r / 30);
    const a0 = back ? PI : 0, a1 = back ? TAU : PI;
    c.save();
    c.strokeStyle = p.col.glow;
    c.globalAlpha = 0.3 * fade; c.lineWidth = 14;
    c.beginPath(); c.ellipse(sx, sy - 9, rx, ry, 0, a0, a1); c.stroke();
    c.strokeStyle = p.col.core;
    c.globalAlpha = 0.95 * fade; c.lineWidth = 2.6;
    c.beginPath(); c.ellipse(sx, sy, rx, ry, 0, a0, a1); c.stroke();
    c.globalAlpha = 0.5 * fade; c.lineWidth = 1.2;
    c.beginPath(); c.ellipse(sx, sy - 18, rx, ry, 0, a0, a1); c.stroke();
    c.restore();
  }

  // ---------------------------------------------------------------- 重圧（床の円 → 押し潰す）
  function crushCircle(e, x, y, T, dmg) {
    const hdef = { dmg, kb: 'down', push: 3, lift: 6.5, stop: 6, sfx: 'hitHeavy' };
    return hazard(e, {
      x, y, T, life: T + 28, seed: U.randi(1, 99999),
      step(p) {
        if (p.t === p.T) {
          strike(e, p, t => { const dx = (t.x - p.x) / (CR_RX + t.w / 2), dy = (t.y - p.y) / CR_RY; return dx * dx + dy * dy <= 1 && t.z < 150; }, hdef);
          BK.fx.shake(4, 10);
          BK.fx.ring(p.x, p.y, 2, 64, '#d8c0ff', 14);
          BK.fx.dust(p.x, p.y, 6, 'rgba(50,30,70,0.55)');
          for (let i = 0; i < 6; i++) BK.fx.add({ type: 'dot', x: p.x + U.rand(-20, 20), y: p.y + U.rand(-6, 6), z: 2, vx: U.rand(-2.5, 2.5), vz: U.rand(2, 5), g: 0.3, life: U.randi(18, 30), col: U.choose(['#3a2a44', '#5a4a60', '#c8b0ff']), size: U.rand(1.5, 3) });
          BK.audio.sfx('cannon', { pitch: 1.3, vol: 0.5 });
        } else if (p.t < p.T && p.t % 5 === 0) {
          // 円へ吸い込まれる光の粒（重圧が溜まっていく）
          BK.fx.add({ type: 'dot', x: p.x + U.rand(-CR_RX, CR_RX) * 0.8, y: p.y + U.rand(-8, 8), z: U.rand(50, 90), vz: -2.2, life: 22, col: '#b890ff', size: 1.6 });
        }
      },
      drawShadow(c) {
        const p = this;
        if (p.t < p.T) { floorOval(c, p.x, p.y, CR_RX, CR_RY, p.t / p.T, p.t >= p.T - 8, VIO); return; }
        // 陥没の跡
        const k = Math.max(0, 1 - (p.t - p.T) / 28), sx = BK.sx(p.x), sy = BK.sy(p.y, 0);
        c.save();
        c.globalAlpha = 0.6 * k; c.fillStyle = '#07040b';
        c.beginPath(); c.ellipse(sx, sy, CR_RX * 0.9, CR_RY * 0.9, 0, 0, TAU); c.fill();
        c.globalAlpha = 0.7 * k; c.strokeStyle = '#8a60d0'; c.lineWidth = 1.2;
        const r = U.srand(p.seed);
        c.beginPath();
        for (let i = 0; i < 7; i++) {
          const a = r() * TAU, l = 0.6 + r() * 0.6;
          c.moveTo(sx + Math.cos(a) * CR_RX * 0.3, sy + Math.sin(a) * CR_RY * 0.3); c.lineTo(sx + Math.cos(a) * CR_RX * l, sy + Math.sin(a) * CR_RY * l);
        }
        c.stroke();
        c.restore();
      },
      drawFn(c) {
        const p = this, d = p.t - p.T;
        if (d < -10 || d > 8) return;
        const sx = BK.sx(p.x), sy = BK.sy(p.y, 0);
        c.save();
        if (d < 0) {
          // 落ちてくる重圧の影
          const k = (d + 10) / 10;
          c.globalAlpha = 0.22 * k; c.fillStyle = '#2a1040';
          c.fillRect(sx - CR_RX * 0.7 * k, 0, CR_RX * 1.4 * k, sy);
        } else {
          const k = 1 - d / 8;
          c.globalAlpha = 0.5 * k; c.fillStyle = '#3a1860';
          c.fillRect(sx - CR_RX * 0.85, 0, CR_RX * 1.7, sy);
          c.globalAlpha = 0.85 * k; c.fillStyle = '#ece2ff';
          c.fillRect(sx - 5 * k - 1, 0, 10 * k + 2, sy);
          c.globalAlpha = 0.8 * k; c.strokeStyle = '#f0e6ff'; c.lineWidth = 2.5;
          c.beginPath(); c.ellipse(sx, sy, CR_RX * (1.1 - k * 0.3), CR_RY * (1.1 - k * 0.3), 0, 0, TAU); c.stroke();
        }
        c.restore();
      },
    });
  }
  /** 重圧の円を n 個: 1つ目は主人公の足元、残りは離して散らす */
  function crushWave(e, n, T, dmg) {
    const g = BK.game, h = g && g.hero;
    const lo = BK.cam.x + 50, hi = BK.cam.x + BK.W - 50;
    const pts = [];
    if (h && !h.dead) pts.push([U.clamp(h.x, lo, hi), U.clamp(h.y, 10, BK.DEPTH - 10)]);
    let tries = 0;
    while (pts.length < n && tries++ < 80) {
      const x = U.rand(lo, hi), y = U.rand(12, BK.DEPTH - 12);
      if (pts.every(q => Math.hypot(q[0] - x, (q[1] - y) * 2.2) > 100)) pts.push([x, y]);
    }
    for (const q of pts) crushCircle(e, q[0], q[1], T, dmg);
  }

  // ---------------------------------------------------------------- 闇の雷柱（奥行き全体を貫く帯）
  function boltColumn(e, x, T, dmg) {
    const hdef = { dmg, kb: 'down', push: 3.5, lift: 6, stop: 5, sfx: 'hitHeavy' };
    return hazard(e, {
      x, y: LANE_Y, T, life: T + 18, seed: U.randi(1, 99999),
      step(p) {
        if (p.t === p.T) {
          strike(e, p, t => Math.abs(t.x - p.x) < BOLT_HW + t.w / 2 && t.z < 220, hdef);
          BK.fx.shake(3, 8);
          for (let i = 0; i < 5; i++) BK.fx.add({ type: 'line', x: p.x, y: U.rand(10, BK.DEPTH - 10), z: 4, vx: U.rand(-4, 4), vz: U.rand(1, 5), life: 10, col: '#e8d8ff', size: 1.4, drag: 0.85 });
          BK.fx.add({ type: 'burst', x: p.x, y: LANE_Y, z: 6, life: 7, size: 22, col: '#f4ecff' });
          BK.audio.sfx('explode', { pitch: 1.7, vol: 0.45 });
        }
      },
      drawShadow(c) {
        const p = this, sx = BK.sx(p.x), sy0 = BK.sy(0, 0), sy1 = BK.sy(BK.DEPTH, 0), d = p.t - p.T;
        c.save();
        if (d < 0) {
          const k = p.t / p.T, hot = d > -8, pu = pulse(hot ? 0.9 : 0.3 + 0.4 * k);
          c.globalAlpha = hot ? 0.36 + 0.14 * pu : 0.07 + 0.22 * k + 0.05 * pu; c.fillStyle = VIO.fill;
          c.fillRect(sx - BOLT_HW, sy0, BOLT_HW * 2, sy1 - sy0);
          c.globalAlpha = 0.45 + 0.4 * pu; c.strokeStyle = VIO.edge; c.lineWidth = 1.4;
          c.beginPath(); c.moveTo(sx - BOLT_HW, sy0); c.lineTo(sx - BOLT_HW, sy1); c.moveTo(sx + BOLT_HW, sy0); c.lineTo(sx + BOLT_HW, sy1); c.stroke();
        } else {
          const k = Math.max(0, 1 - d / 18);
          c.globalAlpha = 0.55 * k; c.fillStyle = '#0a0612'; c.fillRect(sx - BOLT_HW * 0.8, sy0, BOLT_HW * 1.6, sy1 - sy0);
        }
        c.restore();
      },
      drawFn(c) {
        const p = this, sx = BK.sx(p.x), sy0 = BK.sy(0, 0), sy1 = BK.sy(BK.DEPTH, 0), gy = BK.sy(LANE_Y, 0), d = p.t - p.T;
        c.save();
        if (d < 0) {
          // 空から垂れる細い光（予兆）
          const k = p.t / p.T;
          c.globalAlpha = (0.12 + 0.4 * k) * (0.7 + 0.3 * Math.sin(p.t * 1.7));
          c.strokeStyle = VIO.edge; c.lineWidth = 1 + k;
          c.beginPath(); c.moveTo(sx, 0); c.lineTo(sx, gy); c.stroke();
        } else if (d < 10) {
          const k = 1 - d / 10, r = U.srand(p.seed + d * 7);
          c.globalAlpha = 0.45 * k; c.fillStyle = '#9a6aff'; c.fillRect(sx - BOLT_HW, sy0, BOLT_HW * 2, sy1 - sy0);
          c.beginPath();
          c.moveTo(sx, 0);
          let lx = sx;
          for (let i = 1; i <= 10; i++) { lx = i === 10 ? sx : sx + (r() - 0.5) * 24; c.lineTo(lx, gy * i / 10); }
          c.lineJoin = 'round';
          c.globalAlpha = 0.5 * k; c.strokeStyle = '#8a5aff'; c.lineWidth = 9; c.stroke();
          c.globalAlpha = k; c.strokeStyle = '#f6f0ff'; c.lineWidth = 3; c.stroke();
          c.globalAlpha = 0.9 * k; c.fillStyle = '#f6f0ff';
          c.beginPath(); c.ellipse(sx, gy, 26 * k + 6, 10 * k + 3, 0, 0, TAU); c.fill();
        }
        c.restore();
      },
    });
  }
  function boltVolley(e, ph, T1, gap, dmg) {
    const g = BK.game, h = g && g.hero;
    const lo = BK.cam.x + 14, hi = BK.cam.x + BK.W - 14;
    if (ph === 1) {
      // 第1形態: フェムトから主人公の方へ、順に落ちていく
      const dir = h ? (U.sign(h.x - e.x) || e.face) : e.face;
      for (let i = 0; i < 6; i++) { const x = e.x + dir * (58 + 92 * i); if (x >= lo && x <= hi) boltColumn(e, x, T1 + 10 * i, dmg); }
    } else {
      // 第2形態以降: 画面全体に並び、1本おきに2回に分けて落ちる（先に落ちた所へ移れば安全）
      const sp = ph === 2 ? 84 : 78, off = U.rand(0, sp);
      let i = 0;
      for (let x = BK.cam.x + off; x <= hi; x += sp, i++) if (x >= lo) boltColumn(e, x, i % 2 ? T1 + gap : T1, dmg);
    }
  }

  // ---------------------------------------------------------------- 蝕の光線（列を掃く）
  const inLane = (y, lane) => (lane === 0 ? y < LANE_Y : y >= LANE_Y);
  const laneYs = lane => (lane === 0 ? [0, LANE_Y] : [LANE_Y, BK.DEPTH]);
  function beamSweep(e, lane, x0, x1, tel, dur, dmg) {
    const hdef = { dmg, kb: 'down', push: 4, lift: 7, stop: 6, sfx: 'hitHeavy' };
    const ys = laneYs(lane);
    return hazard(e, {
      x: x0, y: (ys[0] + ys[1]) / 2, lane, x0, x1, tel, dur, px: x0, pushDir: U.sign(x1 - x0), life: tel + dur + 14,
      step(p) {
        const s = p.t - p.tel;
        if (s === 0) { BK.fx.flash('#ff2040', 5); BK.audio.sfx('fire', { pitch: 0.45, vol: 0.9 }); BK.audio.sfx('cannon', { pitch: 0.7, vol: 0.6 }); }
        if (s >= 0 && s <= p.dur) {
          p.px = U.lerp(p.x0, p.x1, s / p.dur); p.x = p.px;
          strike(e, p, t => inLane(t.y, p.lane) && Math.abs(t.x - p.px) < 22 + t.w / 2 && t.z < 36, hdef);
          if (s % 2 === 0) {
            BK.fx.add({ type: 'dot', x: p.px + U.rand(-8, 8), y: U.rand(ys[0] + 3, ys[1] - 3), z: 2, vx: U.rand(-2, 2) - p.pushDir * 1.5, vz: U.rand(1.5, 4.5), g: 0.25, life: U.randi(14, 24), col: U.choose(['#ff6070', '#ffd0d8', '#ff2040']), size: U.rand(1.4, 2.6) });
            BK.fx.add({ type: 'smoke', x: p.px, y: U.rand(ys[0] + 3, ys[1] - 3), z: 4, vz: U.rand(0.6, 1.4), life: 22, size: U.rand(6, 10), col: 'rgba(40,10,20,0.45)', drag: 0.95 });
          }
          if (s % 9 === 0) { BK.fx.shake(2.5, 6); BK.audio.sfx('fire', { pitch: 0.6, vol: 0.45 }); }
        }
      },
      drawShadow(c) {
        const p = this, sy0 = BK.sy(ys[0], 0), sy1 = BK.sy(ys[1], 0), s = p.t - p.tel;
        c.save();
        if (s < 0) {
          // 予告: 危険な列全体が赤く脈打ち、掃射の向きへ矢印が流れる
          const k = p.t / p.tel, hot = s > -12, pu = pulse(hot ? 1.0 : 0.25 + 0.35 * k);
          c.globalAlpha = hot ? 0.34 + 0.16 * pu : 0.12 + 0.18 * k + 0.08 * pu; c.fillStyle = RED.fill;
          c.fillRect(0, sy0, BK.W, sy1 - sy0);
          c.globalAlpha = 0.6 + 0.35 * pu; c.strokeStyle = RED.edge; c.lineWidth = 2;
          c.beginPath(); c.moveTo(0, sy0 + 1); c.lineTo(BK.W, sy0 + 1); c.moveTo(0, sy1 - 1); c.lineTo(BK.W, sy1 - 1); c.stroke();
          const dir = p.pushDir, my = (sy0 + sy1) / 2, hh = (sy1 - sy0) * 0.26;
          const stp = 46, off = (BK.frame * (1.5 + 3 * k)) % stp;
          c.globalAlpha = 0.4 + 0.45 * k; c.strokeStyle = '#ffd0d6'; c.lineWidth = 2.6; c.lineJoin = 'round'; c.lineCap = 'round';
          c.beginPath();
          for (let i = -1; i < BK.W / stp + 2; i++) {
            const x = i * stp + dir * off;
            c.moveTo(x - dir * 7, my - hh); c.lineTo(x + dir * 5, my); c.lineTo(x - dir * 7, my + hh);
          }
          c.stroke();
        } else {
          const k = s <= p.dur ? 1 : Math.max(0, 1 - (s - p.dur) / 14);
          c.globalAlpha = 0.14 * k; c.fillStyle = RED.fill; c.fillRect(0, sy0, BK.W, sy1 - sy0);
          // 焼け跡
          const a = BK.sx(Math.min(p.x0, p.px)), b = BK.sx(Math.max(p.x0, p.px));
          c.globalAlpha = 0.45 * k; c.fillStyle = '#2a0008'; c.fillRect(a, sy0 + 2, b - a, sy1 - sy0 - 4);
        }
        c.restore();
      },
      drawFn(c) {
        const p = this, s = p.t - p.tel;
        if (s < 0 || s > p.dur + 8) return;
        const F = st(e);
        const k = s <= p.dur ? 1 : 1 - (s - p.dur) / 8;
        const ix = BK.sx(p.px), iy0 = BK.sy(ys[0], 0), iy1 = BK.sy(ys[1], 0), imy = (iy0 + iy1) / 2;
        const hx = BK.sx(F.hwx != null ? F.hwx : e.x + e.face * 20), hy = BK.sy(e.y, F.hwz != null ? F.hwz : e.z + 90);
        const fl = 0.85 + 0.15 * Math.sin(BK.frame * 1.3);
        c.save();
        // 闇の奔流 → 紅の光 → 白熱の芯
        c.globalAlpha = 0.55 * k; c.fillStyle = '#3a0010';
        c.beginPath(); c.moveTo(hx, hy - 6); c.lineTo(ix + 18, iy0); c.lineTo(ix + 18, iy1); c.lineTo(ix - 18, iy1); c.lineTo(ix - 18, iy0); c.closePath(); c.fill();
        c.globalAlpha = 0.75 * k * fl; c.fillStyle = '#ff2848';
        c.beginPath(); c.moveTo(hx, hy - 3); c.lineTo(ix + 9, iy0 + 2); c.lineTo(ix + 9, iy1 - 2); c.lineTo(ix - 9, iy1 - 2); c.lineTo(ix - 9, iy0 + 2); c.closePath(); c.fill();
        c.globalAlpha = 0.95 * k; c.strokeStyle = '#fff0f2'; c.lineWidth = 3;
        c.beginPath(); c.moveTo(hx, hy); c.lineTo(ix, imy); c.stroke();
        // 着弾点（列の幅いっぱい）
        c.globalAlpha = 0.4 * k; c.fillStyle = '#ff3050'; c.fillRect(ix - 24, iy0, 48, iy1 - iy0);
        c.globalAlpha = 0.95 * k; c.fillStyle = '#fff4f6'; c.fillRect(ix - 7, iy0, 14, iy1 - iy0);
        // 手元の光球
        c.globalAlpha = 0.5 * k; c.fillStyle = '#ff3050'; c.beginPath(); c.arc(hx, hy, 12 * fl, 0, TAU); c.fill();
        c.globalAlpha = k; c.fillStyle = '#fff4f6'; c.beginPath(); c.arc(hx, hy, 5, 0, TAU); c.fill();
        c.restore();
      },
    });
  }

  // ---------------------------------------------------------------- 転移・翼斬の予告（羽の渦 + 斬撃範囲）
  function slashMarker(e, x, y, face, T) {
    return hazard(e, {
      x, y, face, T, life: T + 6, bind: e.move,
      drawShadow(c) { floorRect(c, this.x - this.face * 26, this.x + this.face * 118, this.y - 24, this.y + 24, this.t / this.T, this.t >= this.T - 5, RED); },
      drawFn(c) {
        const p = this, F = st(e);
        const k = Math.min(1, p.t / p.T), a = (1 - F.vis) * Math.min(1, p.t / 8);
        if (a <= 0.02) return;
        const sx = BK.sx(p.x), sy = BK.sy(p.y, 58);
        c.save();
        // 黒い靄と、渦を巻く紫の光
        c.globalAlpha = 0.5 * a; c.fillStyle = '#07040b';
        c.beginPath(); c.ellipse(sx, sy, 14 + 12 * k, 34 + 22 * k, 0, 0, TAU); c.fill();
        c.globalAlpha = (0.35 + 0.4 * k) * a; c.strokeStyle = VIO.edge; c.lineWidth = 1.6;
        c.beginPath(); c.ellipse(sx, sy, 30 - 10 * k, 50 - 12 * k, 0, p.t * 0.2, p.t * 0.2 + 4.2); c.stroke();
        c.beginPath(); c.ellipse(sx, sy, 20 - 6 * k, 38 - 8 * k, 0, -p.t * 0.25, -p.t * 0.25 + 3.4); c.stroke();
        c.globalAlpha = a;
        c.strokeStyle = 'rgba(190,160,255,0.7)'; c.lineWidth = 0.8;
        for (let i = 0; i < 10; i++) {
          const ang = p.t * 0.2 + i * TAU / 10, r = 40 - 16 * k;
          const fx = sx + Math.cos(ang) * r * 0.85, fy = sy + Math.sin(ang) * r * 1.3;
          featherShape(c, fx, fy, ang + PI / 2, 9, i % 3 ? '#14101c' : '#3a3050');
          c.beginPath(); c.moveTo(fx - Math.sin(ang) * 9, fy + Math.cos(ang) * 9); c.lineTo(fx + Math.sin(ang) * 9, fy - Math.cos(ang) * 9); c.stroke();
        }
        c.restore();
      },
    });
  }
  function slashTeleport(e, F, n, T) {
    const g = BK.game, h = g && g.hero;
    const lo = BK.cam.x + 44, hi = BK.cam.x + BK.W - 44;
    let x = e.x, y = e.y, face = e.face;
    if (h) {
      let side = n === 0 ? -(h.face || 1) : -F.side;      // 1回目は背後、2回目は反対側
      x = h.x + side * 76;
      if (x < lo || x > hi) { side = -side; x = h.x + side * 76; }
      x = U.clamp(x, lo, hi); y = h.y; F.side = side;
      face = U.sign(h.x - x) || -side;
    }
    e.x = x; e.y = y; e.face = face; e.z = 4; F.hz = 4; e.vx = 0; e.vy = 0;
    slashMarker(e, x, y, face, T);
  }

  // ---------------------------------------------------------------- 生贄の烙印（召喚の予告）
  function sigil(e, x, y, T) {
    return hazard(e, {
      x, y, T, life: T + 16, bind: e.move,
      drawShadow(c) {
        const p = this, k = Math.min(1, p.t / p.T), d = p.t - p.T;
        const a = d < 0 ? 0.3 + 0.6 * k : Math.max(0, 1 - d / 16);
        const sx = BK.sx(p.x), sy = BK.sy(p.y, 0), s = 15 + 6 * k, pu = pulse(0.4 + k * 0.5);
        c.save();
        c.translate(sx, sy); c.scale(1, 0.42);
        c.globalAlpha = a * (0.18 + 0.14 * pu); c.fillStyle = '#ff1030'; c.beginPath(); c.arc(0, 0, s * 1.8, 0, TAU); c.fill();
        c.globalAlpha = a * (0.7 + 0.3 * pu); c.strokeStyle = '#ff3a4a'; c.lineWidth = 3.4; c.lineCap = 'round';
        c.beginPath();
        c.moveTo(0, s * 1.15); c.lineTo(0, -s * 0.15);
        c.moveTo(0, -s * 0.15); c.quadraticCurveTo(-s * 0.2, -s * 0.8, -s * 0.78, -s * 1.15);
        c.moveTo(0, -s * 0.15); c.quadraticCurveTo(s * 0.2, -s * 0.8, s * 0.78, -s * 1.15);
        c.moveTo(-s * 0.48, s * 0.45); c.lineTo(s * 0.48, s * 0.45);
        c.stroke();
        c.restore();
      },
      drawFn() {},
    });
  }
  function spawnMinion(e, g, s) {
    const ph = st(e).phase;
    const T = BK.enemyTypes;
    let m = null;
    const wantMoth = U.chance(ph === 1 ? 0.5 : 0.4);
    if ((wantMoth || !T.apostle) && T.moth) m = g.spawnEnemy('moth', { x: s.x, y: s.y, entry: 'drop' });
    else if (T.apostle) m = g.spawnEnemy('apostle', { x: s.x, y: s.y, entry: 'rise', palette: U.choose(['flesh', 'bone', 'horn']) });
    BK.fx.ring(s.x, s.y, 2, 60, '#ff4050', 16);
    for (let i = 0; i < 8; i++) BK.fx.add({ type: 'dot', x: s.x + U.rand(-14, 14), y: s.y + U.rand(-4, 4), z: 2, vx: U.rand(-0.6, 0.6), vz: U.rand(1.5, 3.5), life: U.randi(20, 34), col: U.choose(['#ff3040', '#ff9aa0', '#5a0a14']), size: U.rand(1.4, 2.4) });
    return m;
  }

  // ================================================================ 技
  function shockMove(ph) {
    const rings = ph, S0 = 42, IV = 34;
    const dur = S0 + IV * (rings - 1) + 36;
    const kf = [[0, {}]], glints = [];
    for (let i = 0; i < rings; i++) {
      const S = S0 + IV * i;
      kf.push([S - (i ? 20 : 26), P_RAISE], [S - 3, P_RAISE2], [S + 1, P_SLAM, 'snap'], [S + 12, P_SLAM2]);
      glints.push([S - 14, 'F']);
    }
    kf.push([dur, {}]);
    const dmg = [0, 15, 16, 18][ph], spd = [0, 4.2, 4.7, 5.1][ph];
    return {
      dur, kf, glint: glints,
      sfx: [[2, 'magic', { pitch: 0.35, vol: 0.6 }]],
      onFrame(e, f) {
        const F = st(e);
        if (f === 0) { F.hz = 22; runeMarker(e, S0, 62, 25, VIO); }
        for (let i = 0; i < rings; i++) {
          const S = S0 + IV * i;
          if (i > 0 && f === S - 30) { runeMarker(e, 30, 62, 25, VIO); BK.audio.sfx('spirit', { pitch: 0.5, vol: 0.55 }); }
          if (f === S) {
            spawnRing(e, dmg, spd);
            BK.fx.shake(4, 10); BK.fx.ring(e.x, e.y, 2, 70, PHC[F.phase].glow, 14); BK.fx.dust(e.x, e.y, 6, 'rgba(70,50,90,0.45)');
            BK.audio.sfx('cannon', { pitch: 0.55, vol: 0.7 }); BK.audio.sfx('magic', { pitch: 0.3, vol: 0.5 });
          }
        }
        if (f === dur - 12) F.hz = HOVER_Z;
      },
    };
  }
  function crushMove(ph) {
    const T = [0, 54, 46, 40][ph], n = [0, 3, 4, 5][ph], waves = ph === 3 ? 2 : 1, W2 = 34;
    const dmg = [0, 18, 20, 22][ph];
    const S1 = 14 + T, S2 = 14 + W2 + T;
    const dur = (waves > 1 ? S2 : S1) + 30;
    const kf = [[0, {}], [14, P_UP2], [S1 - 6, P_UP2B], [S1 + 1, P_PRESS, 'snap']];
    if (waves > 1) kf.push([S2 - 8, P_UP2B], [S2 + 1, P_PRESS, 'snap']);
    kf.push([dur - 16, P_PRESS2], [dur, {}]);
    return {
      dur, kf, glint: [[8, 'F'], [8, 'B']],
      sfx: [[2, 'magic', { pitch: 0.28, vol: 0.7 }]],
      onFrame(e, f) {
        const F = st(e);
        if (f === 0) F.hz = 72;
        if (f === 14) crushWave(e, n, T, dmg);
        if (waves > 1 && f === 14 + W2) crushWave(e, 3, T, dmg);
        if (f === dur - 20) F.hz = HOVER_Z;
      },
    };
  }
  function boltMove(ph) {
    const T1 = ph === 3 ? 40 : 44, gap = ph === 3 ? 30 : 34;
    const dur = (ph === 1 ? 16 + T1 + 50 : 16 + T1 + gap) + 18;
    const dmg = [0, 17, 18, 19][ph];
    const kf = [[0, {}], [12, P_CAST], [16 + T1 - 4, P_CASTB], [16 + T1 + 1, P_STRIKE, 'snap']];
    if (ph > 1) kf.push([16 + T1 + gap - 6, P_CASTB], [16 + T1 + gap + 1, P_STRIKE, 'snap']);
    kf.push([dur, {}]);
    return {
      dur, kf, glint: [[10, 'F']],
      sfx: [[2, 'magic', { pitch: 0.4, vol: 0.6 }], [14, 'spirit', { pitch: 0.35, vol: 0.5 }]],
      onFrame(e, f) {
        const F = st(e);
        if (f === 0) F.hz = 84;
        if (f === 16) boltVolley(e, ph, T1, gap, dmg);
        if (f === dur - 14) F.hz = HOVER_Z;
      },
    };
  }
  function wingMove(ph) {
    const dbl = ph === 3;
    const dmg = [0, 20, 22, 24][ph];
    const hit = a => ({ f: [a, a + 4], x: [-26, 118], z: [0, 100], d: 24, dmg, kb: 'down', push: 5.5, lift: 5, stop: 6, sfx: 'slash' });
    const kf = [[0, {}], [10, P_VANISH], [34, P_VANISH], [44, P_WWIND], [50, P_WWIND2], [54, P_WSLASH, 'snap'], [60, P_WSLASH2]];
    if (dbl) kf.push([68, P_VANISH], [84, P_VANISH], [94, P_WWIND], [100, P_WWIND2], [106, P_WSLASH, 'snap'], [112, P_WSLASH2], [126, P_KNEEL]);
    else kf.push([72, P_KNEEL]);
    const sfx = [[2, 'swing', { pitch: 0.45 }], [38, 'spirit', { pitch: 0.8, vol: 0.5 }], [51, 'swingHeavy', { pitch: 0.6 }]];
    if (dbl) sfx.push([60, 'swing', { pitch: 0.45 }], [90, 'spirit', { pitch: 0.8, vol: 0.5 }], [103, 'swingHeavy', { pitch: 0.6 }]);
    return {
      dur: dbl ? 128 : 74, kf, sfx,
      hits: dbl ? [hit(52), hit(104)] : [hit(52)],
      glint: dbl ? [[44, 'wing'], [96, 'wing']] : [[44, 'wing']],
      onFrame(e, f) {
        const F = st(e);
        if (f <= 12) F.vis = 1 - f / 12;                 // 羽根となって消える
        if (f === 3) featherBurst(e, 12, 3);
        if (f === 14) slashTeleport(e, F, 0, 38);        // 出現位置と斬撃範囲を予告（38F 後に斬る）
        if (f >= 34 && f <= 44) F.vis = (f - 34) / 10;
        if (f === 54) slashFx(e);
        if (dbl) {
          if (f >= 60 && f <= 70) F.vis = 1 - (f - 60) / 10;
          if (f === 62) featherBurst(e, 10, 3);
          if (f === 70) slashTeleport(e, F, 1, 34);
          if (f >= 84 && f <= 94) F.vis = (f - 84) / 10;
          if (f === 106) slashFx(e);
        }
        if (f === (dbl ? 116 : 62)) { F.vuln = dbl ? 70 : 64; F.hz = 0; }
      },
      onEnd(e) { st(e).vis = 1; },
    };
  }
  /** 翼斬の軌跡（黒い羽根と三日月の閃き） */
  function slashFx(e) {
    for (let i = 0; i < 10; i++) featherFx(e.x + e.face * U.rand(10, 110), e.y + U.rand(-10, 10), U.rand(20, 100), e.face * U.rand(1, 4), U.rand(-0.5, 1.5), U.randi(30, 50), U.rand(4, 7));
    BK.fx.add({ type: 'custom', x: e.x + e.face * 50, y: e.y, z: 60, life: 10, face: e.face, draw: drawSlashArc });
  }
  function drawSlashArc(c, sx, sy, k, p) {
    c.save();
    c.translate(sx, sy); c.scale(p.face, 1);
    c.globalAlpha = k * 0.9;
    c.fillStyle = '#f4ecff';
    c.beginPath(); c.ellipse(0, 0, 70, 46, 0, -1.3, 1.3); c.ellipse(-14, 0, 60, 40, 0, 1.3, -1.3, true); c.closePath(); c.fill();
    c.globalAlpha = k * 0.5; c.fillStyle = '#ff3050';
    c.beginPath(); c.ellipse(-6, 0, 76, 52, 0, -1.2, 1.2); c.ellipse(-2, 0, 70, 46, 0, 1.2, -1.2, true); c.closePath(); c.fill();
    c.restore();
  }
  function buffetMove(ph) {
    const dmg = [0, 13, 14, 15][ph];
    return {
      dur: 60, kf: [[0, {}], [12, P_BUF1], [33, P_BUF1B], [37, P_BUF2, 'snap'], [48, P_BUF2B], [60, {}]],
      glint: [[20, 'head']],
      sfx: [[2, 'spirit', { pitch: 0.7, vol: 0.6 }], [35, 'swingHeavy', { pitch: 0.45 }]],
      onFrame(e, f) {
        const F = st(e);
        if (f === 0) { F.hz = 10; runeMarker(e, 36, 100, 40, RED); }
        if (f === 36) {
          strike(e, null, t => { const dx = (t.x - e.x) / (100 + t.w / 2), dy = (t.y - e.y) / 40; return dx * dx + dy * dy <= 1 && t.z < 140; },
            { dmg, kb: 'down', push: 6.5, lift: 5, stop: 6, sfx: 'hitHeavy' });
          BK.fx.ring(e.x, e.y, 10, 120, '#e8d8ff', 16); BK.fx.shake(4, 10); featherBurst(e, 16, 5);
          BK.audio.sfx('cannon', { pitch: 0.8, vol: 0.5 });
        }
        if (f === 44) { F.hz = HOVER_Z; if (U.chance(0.4)) F.blinkQ = true; }   // 居座り対策の技なので隙は小さい
      },
    };
  }
  const SUMMON = {
    dur: 84, kf: [[0, {}], [16, P_SUM], [38, P_SUMB], [46, P_SUM2, 'snap'], [70, P_SUM2], [84, {}]],
    glint: [[30, 'F']],
    sfx: [[4, 'spirit', { pitch: 0.4, vol: 0.8 }]],
    onFrame(e, f) {
      const F = st(e), g = BK.game;
      if (!g) return;
      if (f === 0) {
        F.hz = 58; F.sumCd = SUM_CD[F.phase]; F.sigils = [];
        const h = g.hero, lo = BK.cam.x + 50, hi = BK.cam.x + BK.W - 50;
        const n = Math.min(2, SUM_LIM[F.phase] - minionCount(e, g));
        for (let i = 0; i < n; i++) {
          let side = i === 0 ? -U.sign((h ? h.x : e.x) - e.x) : -F.sigils[0].side;
          let x = (h ? h.x : e.x) + side * U.rand(120, 170);
          if (x < lo || x > hi) { side = -side; x = (h ? h.x : e.x) + side * U.rand(120, 170); }
          const s = { x: U.clamp(x, lo, hi), y: U.rand(14, BK.DEPTH - 14), side };
          F.sigils.push(s);
          sigil(e, s.x, s.y, 44);
        }
        BK.audio.sfx('bell', { pitch: 0.5, vol: 0.5 });
      }
      if (f === 44 && F.sigils) {
        for (const s of F.sigils) { if (minionCount(e, g) >= SUM_LIM[F.phase]) break; spawnMinion(e, g, s); }
        F.sigils = null;
      }
    },
  };
  const BEAM = (function () {
    const dmg = 24, TEL1 = 64, SW = 52, TEL2 = 56;
    const A = 20, FIRE1 = A + TEL1, END1 = FIRE1 + SW;
    const B = END1 + 2, FIRE2 = B + TEL2, END2 = FIRE2 + SW;
    const dur = END2 + 34;
    const far = e => (e.face > 0 ? BK.cam.x + BK.W + 30 : BK.cam.x - 30);
    return {
      dur,
      kf: [[0, {}], [10, P_VANISH], [28, P_BREADY], [FIRE1 - 4, P_BREADYB], [FIRE1 + 2, P_BFIRE, 'snap'], [END1, P_BFIRE], [END1 + 12, P_BREADY],
        [FIRE2 - 4, P_BREADYB], [FIRE2 + 2, P_BFIRE, 'snap'], [END2, P_BFIRE], [END2 + 14, P_DESC], [dur, P_KNEEL]],
      glint: [[FIRE1 - 14, 'F'], [FIRE2 - 14, 'F']],
      sfx: [[2, 'swing', { pitch: 0.4 }], [A, 'awaken', { pitch: 1.6, vol: 0.45 }], [B, 'awaken', { pitch: 1.6, vol: 0.45 }]],
      onStart(e) { st(e).sinceBeam = -1; },
      onFrame(e, f) {
        const F = st(e), g = BK.game, h = g && g.hero;
        if (f <= 10) F.vis = 1 - f / 10;
        if (f === 3) featherBurst(e, 12, 3);
        if (f === 12) {
          // 主人公に近い側の画面端へ転移し、高く舞い上がる
          const left = !h || h.x - BK.cam.x < BK.W / 2;
          e.x = left ? BK.cam.x + 118 : BK.cam.x + BK.W - 118;
          e.y = LANE_Y; e.face = left ? 1 : -1; e.z = F.hz = 78; e.vx = 0; e.vy = 0;
        }
        if (f >= 14 && f <= 26) F.vis = (f - 14) / 12;
        if (f === A) {
          F.laneA = h ? (inLane(h.y, 0) ? 0 : 1) : 0;         // 主人公のいる列から掃く
          beamSweep(e, F.laneA, e.x + e.face * 26, far(e), TEL1, SW, dmg);
          if (g && !F.beamHint) { F.beamHint = true; g.banner('蝕の光線', '#ff5060', '赤く光る列から離れろ ─ 跳んでもかわせる', 100); }
        }
        if (f === B) beamSweep(e, 1 - F.laneA, far(e), e.x + e.face * 26, TEL2, SW, dmg);
        if (f === END2 + 6) F.hz = 0;
        if (f > END2 + 4 && f < END2 + 28 && h) {
          // 力を使い果たし、主人公の方へ流れるように降りてくる（反撃しやすい位置へ）
          const tx = U.clamp(h.x - e.face * 90, BK.cam.x + 60, BK.cam.x + BK.W - 60);
          e.x += U.clamp((tx - e.x) * 0.08, -5, 5);
        }
        if (f === END2 + 22) F.vuln = 120;
      },
      onEnd(e) { st(e).vis = 1; },
    };
  })();
  const BLINK = {
    dur: 40, kf: [[0, {}], [10, P_VANISH], [24, P_VANISH], [40, {}]],
    sfx: [[1, 'swing', { pitch: 0.4, vol: 0.7 }]],
    onFrame(e, f) {
      const F = st(e);
      if (f <= 10) F.vis = 1 - f / 10;
      if (f === 2) featherBurst(e, 10, 3);
      if (f === 12) blinkSpot(e, F);
      if (f >= 14 && f <= 26) F.vis = (f - 14) / 12;
    },
    onEnd(e) { st(e).vis = 1; },
  };
  function blinkSpot(e, F) {
    const g = BK.game, h = g && g.hero;
    if (!h) return;
    const lo = BK.cam.x + 110, hi = BK.cam.x + BK.W - 110;
    let side = U.chance(0.5) ? 1 : -1;
    let x = h.x + side * U.rand(140, 190);
    if (x < lo || x > hi) { side = -side; x = h.x + side * U.rand(140, 190); }
    e.x = U.clamp(x, lo, hi); e.y = U.clamp(h.y + U.rand(-30, 30), 10, BK.DEPTH - 10);
    e.z = F.hz = HOVER_Z; e.vx = 0; e.vy = 0; e.face = U.sign(h.x - e.x) || 1;
    F.tx = e.x; F.ty = e.y; F.slotT = U.randi(60, 100);
  }
  const PHASE_TXT = [null, null, ['夜が、深まる', '#c9a0ff', '闇の翼が大きく開く'], ['蝕', '#ff3048', '黒い太陽が世界を呑む']];
  const PHASE = {
    dur: 150, invul: [0, 150],
    kf: [[0, {}], [18, P_CURL], [98, P_CURL2], [110, P_SPREAD, 'snap'], [140, P_SPREAD], [150, {}]],
    onStart(e) {
      const F = st(e);
      F.phase = Math.min(3, F.phase + 1); F.mv = MV[F.phase];
      F.hz = 84; F.vis = 1; F.vuln = 0; F.hitLog.length = 0; F.trans = true; F.blinkQ = false;
      e.vx = 0; e.vy = 0;
    },
    onFrame(e, f) {
      const F = st(e), g = BK.game;
      BK.fx.darken = Math.max(BK.fx.darken, f < 20 ? f / 20 * 0.5 : f < 120 ? 0.5 : 0.5 * (1 - (f - 120) / 30));
      // 画面の中ほどへ漂い出る（演出がよく見えるように）
      const cx = U.clamp(e.x, BK.cam.x + 170, BK.cam.x + BK.W - 170);
      if (f < 100) { e.x += (cx - e.x) * 0.05; e.y += (LANE_Y - e.y) * 0.04; }
      if (f === 0) { BK.fx.flash('#ffffff', 12); BK.fx.shake(6, 30); BK.audio.sfx('awaken', { pitch: 0.7 }); featherBurst(e, 20, 4); }
      if (f === 20 && g) { const tx = PHASE_TXT[F.phase]; if (tx) g.banner(tx[0], tx[1], tx[2], 140); }
      if (f > 16 && f < 104 && f % 2 === 0) {
        // 闇が集まってくる
        const a = U.rand(0, TAU), r = U.rand(120, 170), cz = e.z + 80;
        BK.fx.add({ type: 'dot', x: e.x + Math.cos(a) * r, y: e.y, z: cz + Math.sin(a) * r * 0.55, vx: -Math.cos(a) * r / 30, vz: -Math.sin(a) * r * 0.55 / 30, life: 30, col: F.phase === 3 ? U.choose(['#ff3050', '#2a0008']) : U.choose(['#9a66ff', '#1a0a2a']), size: U.rand(1.6, 2.8) });
      }
      if (f === 108) {
        BK.fx.flash(F.phase === 3 ? '#ff2040' : '#b080ff', 10); BK.fx.shake(9, 30);
        BK.fx.ring(e.x, e.y, 2, 200, PHC[F.phase].glow, 26); BK.fx.ring(e.x, e.y, e.z + 80, 150, '#ffffff', 20);
        BK.audio.sfx('cannon', { pitch: 0.5 }); BK.audio.sfx('bell', { pitch: 0.35, vol: 0.8 });
        featherBurst(e, 26, 6);
      }
      if (f === 140) F.hz = HOVER_Z;
    },
    onEnd(e) {
      const F = st(e);
      F.trans = false; F.cd = 34; F.vis = 1;
      if (F.phase === 3) F.forceNext = 'beam';
    },
  };
  function mkMoves(ph) {
    // 並び順はギャラリーの表示順（先頭の数個が並ぶ）
    const M = { wing: wingMove(ph), crush: crushMove(ph), shock: shockMove(ph), bolt: boltMove(ph), buffet: buffetMove(ph), summon: SUMMON, beam: BEAM, blink: BLINK, phase: PHASE };
    for (const k in M) M[k].id = k;
    return M;
  }
  const MV = [null, mkMoves(1), mkMoves(2), mkMoves(3)];

  // ================================================================ 状態
  function st(e) {
    return e.fm || (e.fm = {
      t: 0, phase: 1, mv: MV[1], cd: 50, hz: HOVER_Z, hk: 0.09, vis: 1,
      vuln: 0, open: false, stagT: 0, closeT: 0, slotT: 0, tx: e.x, ty: e.y,
      hitLog: [], hp: e.hp, poise: e.poise, blinkQ: false, trans: false,
      last: null, last2: null, sinceBeam: 9, sumCd: 300, introT: 0, side: 1, sigils: null, laneA: 0,
      forceNext: null, hwx: null, hwz: null, dieZ: 0, haloS: 1, wingX: -40, wingY: -110,
    });
  }

  // ================================================================ AI
  function doMove(e, F, m, rest) {
    e.faceHero();
    e.vx = 0; e.vy = 0;
    e.startMove(m);
    F.last2 = F.last; F.last = m;
    F.sinceBeam++;
    const r = REST[F.phase];
    F.cd = rest != null ? rest : U.randi(r[0], r[1]);
    F.closeT = 0;
  }
  function pickMove(e, F, adx, ady, game) {
    const M = F.mv, ph = F.phase;
    if (F.forceNext) { const m = M[F.forceNext]; F.forceNext = null; if (m) return m; }
    const list = [[3, M.shock], [3, M.crush], [adx < 280 ? 3 : 2, M.wing], [ph >= 2 ? 3 : 2, M.bolt]];
    if (F.sumCd <= 0 && minionCount(e, game) < SUM_LIM[ph]) list.push([ph === 1 ? 2.4 : 1.8, M.summon]);
    if (ph === 3) list.push([F.sinceBeam >= 3 ? 5 : 0.6, M.beam]);
    if (adx < 90 && ady < 34) list.push([2.5, M.buffet]);
    return U.weighted(list.map(([w, m]) => [m === F.last ? w * 0.2 : m === F.last2 ? w * 0.6 : w, m]));
  }
  /** 様子見: 主人公の左右どちらかの「持ち場」へ滑るように漂う */
  function glide(e, F, h) {
    const lo = BK.cam.x + 110, hi = BK.cam.x + BK.W - 110;   // 巨大な翼が画面からはみ出さない位置を好む
    if (--F.slotT <= 0 || Math.abs(F.tx - h.x) > 260) {
      F.slotT = U.randi(80, 140);
      let side = U.sign(e.x - h.x) || 1;
      if (U.chance(0.2)) side = -side;
      const pref = U.rand(100, 160);
      let tx = h.x + side * pref;
      if (tx < lo || tx > hi) tx = h.x - side * pref;
      F.tx = U.clamp(tx, lo, hi);
      F.ty = U.clamp(h.y + U.rand(-26, 26), 8, BK.DEPTH - 8);
    }
    const spd = GLIDE[F.phase];
    const ddx = F.tx - e.x, ddy = F.ty - e.y;
    const wx = Math.abs(ddx) > 4 ? U.clamp(ddx * 0.04, -spd, spd) : 0;
    const wy = Math.abs(ddy) > 3 ? U.clamp(ddy * 0.05, -spd * 0.7, spd * 0.7) : 0;
    e.vx = U.approach(e.vx, wx, 0.08); e.vy = U.approach(e.vy, wy, 0.06);
    e.state = Math.abs(e.vx) > 0.35 ? 'walk' : 'idle';
    F.hz = HOVER_Z;
    e.faceHero();
  }
  function introThink(e, game, F) {
    const t = ++F.introT;
    e.vx = 0; e.vy = 0;
    e.faceHero();
    if (t === 2 && BK.audio.songs && BK.audio.songs.lastboss && BK.audio.songId !== 'lastboss') BK.audio.playSong('lastboss');
    BK.fx.darken = Math.max(BK.fx.darken, t < 120 ? 0.35 : 0.35 * Math.max(0, 1 - (t - 120) / 30));
    if (t < 28) { e.z = 320; F.vis = 0; if (t === 1) BK.audio.sfx('magic', { pitch: 0.25, vol: 0.7 }); }
    if (t === 28) {
      F.vis = 1;
      BK.fx.flash('#ffffff', 16); BK.fx.shake(6, 24);
      BK.audio.sfx('awaken', { pitch: 0.75 });
      BK.fx.ring(e.x, e.y, 2, 170, '#e0d0ff', 26);
      for (let i = 0; i < 18; i++) featherFx(e.x + U.rand(-60, 60), e.y + U.rand(-10, 10), U.rand(150, 300), U.rand(-1.5, 1.5), U.rand(-1, 0.5), U.randi(70, 110), U.rand(4, 7));
    }
    if (t >= 28 && t <= 110) e.z = U.lerp(320, HOVER_Z, U.ease.out((t - 28) / 82));
    F.hz = e.z;
    if (t === 112) BK.audio.sfx('bell', { pitch: 0.4, vol: 0.7 });
    if (t >= 150) { e.state = 'idle'; e.intangible = false; F.hz = HOVER_Z; F.cd = 36; }
  }
  function femtoThink(e, game) {
    const F = st(e);
    if (e.state === 'dying' || e.dead) return;
    if (e.state === 'intro') { introThink(e, game, F); return; }
    if (e.state === 'stagger') {
      e.vx *= 0.85; e.vy *= 0.85;
      if (--F.stagT <= 0) { e.state = 'idle'; F.hz = HOVER_Z; F.cd = Math.min(F.cd, 18); if (U.chance(0.5)) F.blinkQ = true; }
      return;
    }
    const h = game.hero;
    if (!h) { e.state = 'idle'; e.vx = 0; e.vy = 0; return; }
    // 大技の後: 地に膝をついて息を整える（反撃の好機）
    if (F.vuln > 0) { F.hz = 0; e.vx *= 0.8; e.vy *= 0.8; e.state = 'idle'; return; }
    const dx = h.x - e.x, dy = h.y - e.y, adx = Math.abs(dx), ady = Math.abs(dy);
    const busy = h.dead || h.state === 'down' || h.state === 'getup' || h.state === 'fall' || h.invul > 60;
    if (F.blinkQ) { F.blinkQ = false; doMove(e, F, BLINK, 24); return; }
    if (F.cd > 0) F.cd--;
    if (adx < 72 && ady < 28 && !busy) F.closeT++; else F.closeT = Math.max(0, F.closeT - 2);
    if (!busy) {
      if (F.closeT > 55 && F.cd < 30) { doMove(e, F, U.chance(0.7) ? F.mv.buffet : BLINK); return; }
      if (F.cd <= 0) { const m = pickMove(e, F, adx, ady, game); if (m) { doMove(e, F, m); return; } }
    }
    glide(e, F, h);
  }

  // ---------------------------------------------------------------- 毎フレームの処理
  function startStagger(e, F) {
    if (e.move) e.endMove();
    e.state = 'stagger'; e.st = 0; F.stagT = 64; F.hz = 6; F.vuln = 0;
    e.vz = 0; e.spinning = false; e.hitCount = 0; e._bounced = false; e.hitstun = 0;
    e.vx *= 0.6;
    e.poise = e.def.poise;
    BK.audio.sfx('spirit', { pitch: 0.55, vol: 0.8 });
    featherBurst(e, 10, 3);
  }
  function beginPhase(e, F) {
    if (e.move) e.endMove();
    e.state = 'idle'; e.hitstun = 0; F.stagT = 0; F.vuln = 0; F.blinkQ = false; F.vis = 1;
    e.startMove(PHASE);
  }
  function ambient(e, F) {
    if (F.vis < 0.6) return;
    const ph = F.phase;
    if (F.t % (ph === 3 ? 4 : 7) === 0) {
      BK.fx.add({ type: 'dot', x: e.x + U.rand(-22, 22), y: e.y + U.rand(-3, 3), z: e.z + U.rand(10, 110), vx: U.rand(-0.2, 0.2), vz: U.rand(0.4, 1.0), life: U.randi(30, 50),
        col: ph === 3 ? U.choose(['#ff4060', '#8a2040']) : U.choose(['#8a60c8', '#5a3a88']), size: U.rand(1.2, 2) });
    }
    if (F.t % 30 === 0) featherFx(e.x - e.face * U.rand(20, 80), e.y + U.rand(-3, 3), e.z + U.rand(100, 150), U.rand(-0.5, 0.5), 0, U.randi(60, 90), U.rand(4, 6));
    // 手に宿る魔力の粒
    if (e.move && e.move.kf && F.t % 3 === 0 && F.hwx != null) {
      const p = samp(e.move.kf, e.mf, ST);
      if (p.glow > 0.4) BK.fx.add({ type: 'dot', x: F.hwx + U.rand(-4, 4), y: e.y, z: F.hwz + U.rand(-4, 4), vx: U.rand(-0.6, 0.6), vz: U.rand(0.3, 1.2), life: 18, col: PHC[ph].glow, size: 1.6 });
    }
  }
  function femtoUpdate(e, game) {
    const F = st(e);
    F.t++;
    if (e.state === 'dying') { updateDying(e, game, F); return; }
    if (e.dead) return;
    e.gravMul = 0; e.vz = 0;                      // 高度は自前で管理する（重力なし）
    if (e.state === 'intro') { e.shadowR = F.vis > 0 ? 30 : 12; return; }
    if (e.state === 'air') e.state = 'idle';       // 技の終わり（空中）→ 浮遊待機
    if (e.state === 'fall' || e.state === 'down' || e.state === 'getup') startStagger(e, F);  // 倒れない: よろめきにする
    // 被弾の記録 → 空中で殴られ続けたら転移で離れる
    if (e.hp < F.hp) {
      F.hitLog.push(BK.frame);
      while (F.hitLog.length && BK.frame - F.hitLog[0] > 150) F.hitLog.shift();
      if (!F.open && F.hitLog.length >= BLINK_N[F.phase]) { F.hitLog.length = 0; F.blinkQ = true; }
    }
    // 体勢値（poise）を削り切ったら、空中のアーマー中でもよろめく（重い攻撃へのご褒美）
    const pz = e.def.poise;
    const bigMove = e.move && (e.move.id === 'phase' || e.move.id === 'beam');
    if (e.hp < F.hp && e.poise > F.poise + 0.5 && F.poise < pz && F.vis > 0.9 && !bigMove && e.state !== 'stagger') startStagger(e, F);
    F.poise = e.poise;
    F.hp = e.hp;
    // 形態変化（技の途中でも割り込む。演出中は無敵）
    const inPhase = e.move && e.move.id === 'phase';
    if (!inPhase && F.phase < 3 && e.hp > 0 && e.hp <= e.maxHp * PH_AT[F.phase]) beginPhase(e, F);
    if (F.vuln > 0) F.vuln--;
    if (F.sumCd > 0) F.sumCd--;
    // 浮遊高度へ近づける
    const dz = F.hz - e.z;
    if (Math.abs(dz) < 0.5 || (F.hz === 0 && e.z < 5)) e.z = F.hz; else e.z += dz * F.hk + U.sign(dz) * 0.3;
    if (e.z < 0) e.z = 0;
    // 反撃の好機（地上で膝をついている間）だけのけぞる。被ダメージも増える
    F.open = F.vuln > 0 && e.z <= 0 && e.state !== 'stagger';
    e.superArmor = F.open || e.state === 'hurt' ? 0 : 2;
    e.dmgTakenMul = F.vuln > 0 || e.state === 'stagger' ? 1.25 : 1;
    if (F.vis < 0.5) e.invul = Math.max(e.invul, 2);   // 消えている間は無敵
    e.shadowR = F.vis > 0.3 ? 30 : 0;
    if (e.z > 0 && (e.move || e.state === 'hurt' || e.state === 'stagger')) { e.vx *= 0.82; e.vy *= 0.82; }  // 空中は摩擦がないので自前で減速
    e.x = U.clamp(e.x, BK.cam.x + 50, BK.cam.x + BK.W - 50);
    ambient(e, F);
  }

  // ---------------------------------------------------------------- 登場 / 消滅
  function femtoSpawn(e) {
    const F = st(e);
    e.entering = 0; e.entry = 'femto'; e.intangible = true;
    e.state = 'intro'; e.st = 0; e.move = null;
    e.x = U.clamp(e.x, BK.cam.x + 150, BK.cam.x + BK.W - 120);
    e.y = U.clamp(e.y, 30, BK.DEPTH - 30);
    e.z = 320; e.vz = 0; e.vx = 0; e.vy = 0; e.gravMul = 0;
    F.hz = 320; F.vis = 0; F.introT = 0;
  }
  function femtoDie(e) {
    const F = st(e);
    e.state = 'dying'; e.st = 0;
    e.vx = 0; e.vy = 0; e.vz = 0; e.gravMul = 0;
    e.superArmor = 0; e.intangible = true; e.invul = 0;
    F.vis = 1; F.vuln = 0; F.dieZ = Math.max(0, e.z);
    e.trailOn = false; if (e.trail) e.trail.length = 0;
  }
  function updateDying(e, game, F) {
    const t = ++e.st;
    e.gravMul = 0; e.vz = 0; e.vx = 0; e.vy = 0; e.shadowR = t < 150 ? 30 : 0;
    // 静かに浮かび上がる
    e.z = U.lerp(F.dieZ, Math.max(F.dieZ, 72), U.ease.inOut(Math.min(1, t / 120)));
    F.haloS = t < 120 ? 1 + t * 0.003 : Math.max(0, (186 - t) / 66) * 1.36;
    const cz = e.z + 80;
    if (t === 1) BK.audio.sfx('awaken', { pitch: 0.55, vol: 0.9 });
    // 鎧にひびが入り、光が漏れる
    if (t < 70 && t % 5 === 0) {
      const x = e.x + U.rand(-18, 18), z = cz + U.rand(-30, 40);
      BK.fx.add({ type: 'burst', x, y: e.y + 1, z, life: 7, size: 12, col: '#fff6ff' });
      for (let i = 0; i < 3; i++) BK.fx.add({ type: 'line', x, y: e.y + 1, z, vx: U.rand(-4, 4), vz: U.rand(-3, 4), life: 10, col: '#e8d8ff', size: 1.3, drag: 0.85 });
      if (t % 15 === 0) BK.fx.shake(3, 8);
    }
    // 黒い羽根と光の粒へ還っていく
    if (t > 30 && t < 190) {
      const n = t > 110 ? 2 : 1;
      for (let i = 0; i < n; i++) {
        featherFx(e.x - e.face * U.rand(-30, 90), e.y + U.rand(-6, 6), e.z + U.rand(50, 170), U.rand(-2.5, 2.5) - e.face * 0.8, U.rand(-0.5, 2), U.randi(50, 80), U.rand(4, 7));
      }
    }
    if (t > 60 && t < 200 && t % 2 === 0) {
      BK.fx.add({ type: 'dot', x: e.x + U.rand(-40, 40), y: e.y + U.rand(-4, 4), z: e.z + U.rand(20, 150), vx: U.rand(-0.3, 0.3), vz: U.rand(0.8, 2), life: U.randi(30, 50), col: U.choose(['#ffffff', '#f0e6ff', '#c9a0ff', '#ffd9a0']), size: U.rand(1.2, 2.4) });
    }
    if (t === 120) BK.audio.sfx('bell', { pitch: 0.4, vol: 0.8 });
    if (t === 186) {
      BK.fx.flash('#ffffff', 26); BK.fx.shake(6, 20);
      BK.fx.ring(e.x, e.y, cz, 180, '#ffffff', 26); BK.fx.ring(e.x, e.y, 2, 220, '#e0d0ff', 30);
      BK.audio.sfx('cannon', { pitch: 0.4, vol: 0.8 });
      for (let i = 0; i < 24; i++) { const a = U.rand(0, TAU); featherFx(e.x, e.y + U.rand(-6, 6), cz + U.rand(-20, 20), Math.cos(a) * U.rand(2, 6), Math.sin(a) * U.rand(1, 4), U.randi(50, 80), U.rand(4, 7)); }
    }
    if (t >= DIE_T) e.remove = true;
  }

  // ================================================================ 描画
  function femtoPose(e, F) {
    let p;
    if (e.state === 'dying') p = samp(DIE_KF, e.st, ST);
    else if (e.state === 'intro') p = lerpPose(F_VANISH, ST, U.ease.inOut(U.clamp((F.introT - 28) / 90, 0, 1)));
    else if (e.move && e.move.kf) p = samp(e.move.kf, e.mf, ST);
    else if (e.state === 'stagger') {
      p = Object.assign({}, F_STAG);
      p.aF += Math.sin(F.t * 0.5) * 22; p.aB -= Math.sin(F.t * 0.43) * 18; p.wf = 0.4 + Math.sin(F.t * 0.6) * 0.5; p.lean += Math.sin(F.t * 0.3) * 4;
    } else if (e.state === 'hurt') p = lerpPose(ST, F_HURT, U.clamp(e.hitstun / 8, 0, 1));
    else if (F.vuln > 0 || (F.hz === 0 && e.z < 14)) {
      p = Object.assign({}, F_KNEEL);
      p.lean += Math.sin(F.t * 0.12) * 2.5; p.head += Math.sin(F.t * 0.12) * 3; p.wf += Math.sin(F.t * 0.12) * 0.08;
    } else if (e.state === 'walk') {
      const k = U.clamp(Math.abs(e.vx) / 1.2, 0, 1);
      p = lerpPose(ST, F_GLIDE, k);
      p.lean = ST.lean + (e.vx * e.face >= 0 ? 12 : -8) * k;
      p.wf += Math.sin(F.t * 0.1) * 0.3 * k;
    } else p = ST;
    p = Object.assign({}, p);   // キャッシュされたポーズを書き換えないよう複製
    // ゆっくりとした翼の呼吸
    p.wf = (p.wf || 0) + Math.sin(F.t * 0.045) * 0.14;
    p.aF += Math.sin(F.t * 0.04) * 2; p.aB -= Math.sin(F.t * 0.04 + 1) * 2;
    return p;
  }
  function drawIntroFx(c, e, F) {
    const t = F.introT;
    if (t > 42) return;
    const sx = BK.sx(e.x), gy = BK.sy(e.y, 0);
    const k = t < 28 ? t / 28 : 1 - (t - 28) / 14;
    c.save();
    c.globalAlpha = 0.25 * k; c.fillStyle = '#b890ff'; c.fillRect(sx - 18 * k - 4, 0, (18 * k + 4) * 2, gy);
    c.globalAlpha = 0.75 * k; c.fillStyle = '#f4ecff'; c.fillRect(sx - 3 - 3 * k, 0, 6 + 6 * k, gy);
    c.globalAlpha = 0.5 * k; c.fillStyle = '#d8c0ff'; c.beginPath(); c.ellipse(sx, gy, 40 * k + 10, (40 * k + 10) * 0.4, 0, 0, TAU); c.fill();
    c.restore();
  }
  function drawDeathLight(c, e, sx, sy, sk) {
    const t = e.st, sc = SPEC.scale, f = e.face;
    const cx = sk ? sx + (sk.sho.x + sk.hip.x) / 2 * sc * f : BK.sx(e.x);
    const cy = sk ? sy + (sk.sho.y + sk.hip.y) / 2 * sc : BK.sy(e.y, e.z + 70);
    c.save();
    // 光のひび（胸から放射）
    if (t > 16 && t < 190) {
      const k = U.clamp((t - 16) / 90, 0, 1), fk = t > 150 ? 1 - (t - 150) / 40 : 1;
      const r = U.srand(e.uid * 31 + 7);
      c.globalAlpha = 0.85 * fk; c.strokeStyle = '#fff6ff'; c.lineWidth = 1.6; c.lineJoin = 'round';
      c.beginPath();
      for (let i = 0; i < 9; i++) {
        const a = r() * TAU, l = (14 + r() * 50) * k;
        c.moveTo(cx, cy);
        c.lineTo(cx + Math.cos(a) * l * 0.5 + (r() - 0.5) * 8, cy + Math.sin(a) * l * 0.5 + (r() - 0.5) * 8);
        c.lineTo(cx + Math.cos(a) * l, cy + Math.sin(a) * l);
      }
      c.stroke();
    }
    // 最後の光球
    if (t > 140 && t < 202) {
      const k = t < 186 ? (t - 140) / 46 : Math.max(0, 1 - (t - 186) / 16);
      c.globalAlpha = 0.3 * k; c.fillStyle = '#e8dcff'; c.beginPath(); c.arc(cx, cy, 12 + 44 * k, 0, TAU); c.fill();
      c.globalAlpha = 0.9 * k; c.fillStyle = '#ffffff'; c.beginPath(); c.arc(cx, cy, 3 + 13 * k, 0, TAU); c.fill();
    }
    c.restore();
  }
  function drawFemto(c, e) {
    const F = st(e);
    if (e.state === 'intro') drawIntroFx(c, e, F);
    const dying = e.state === 'dying';
    let white = 0, fade = 0;
    if (dying) { white = U.clamp((e.st - 30) / 100, 0, 1); fade = U.clamp((e.st - 128) / 58, 0, 1); }
    const alpha = F.vis * (1 - fade);
    if (alpha <= 0.02) { if (dying) drawDeathLight(c, e, null, null, null); return; }
    const pose = femtoPose(e, F);
    const bob = e.z > 3 && !dying ? Math.sin(F.t * 0.05) * 2.5 : 0;
    let sx = BK.sx(e.x);
    const sy = BK.sy(e.y, e.z + bob);
    if (dying && e.st < 70) sx += Math.sin(e.st * 1.9) * 1.5;
    const sc = SPEC.scale, f = e.face;
    const flash = e.flash > 0 && (e.flash & 2);
    c.save();
    c.globalAlpha = alpha;
    c.translate(Math.round(sx * 2) / 2, Math.round(sy * 2) / 2); c.scale(f * sc, sc);
    const sk = R.draw(c, pose, SPEC, { t: F.t, tint: flash ? WHITE : null, fm: F });
    if (white > 0) { c.globalAlpha = alpha * white; R.draw(c, pose, SPEC, { t: F.t, tint: '#ffffff', fm: F, noHalo: true, allWhite: true }); }
    c.restore();
    // 光線の起点（手）を記録
    F.hwx = e.x + sk.hdF.x * sc * f; F.hwz = e.z + bob - sk.hdF.y * sc;
    if (dying) { drawDeathLight(c, e, sx, sy, sk); return; }
    if (F.vis > 0.6) {
      const hc = sk.headC;
      drawGlints(c, e, {
        F: [sx + sk.hdF.x * sc * f, sy + sk.hdF.y * sc],
        B: [sx + sk.hdB.x * sc * f, sy + sk.hdB.y * sc],
        head: [sx + (hc.x + 12) * sc * f, sy + (hc.y + 1) * sc],
        wing: [sx + F.wingX * sc * f, sy + F.wingY * sc],
      });
    }
  }

  // ================================================================ 登録
  BK.registerEnemy({
    id: 'femto', name: 'フェムト', title: 'ゴッド・ハンド 闇の鷹', boss: true,
    hp: 1100, w: 36, h: 118, weight: 3, speed: 1.2, speedY: 0.8, score: 30000, bossBonus: 100000,
    poise: 90, shadowR: 30, bloodCol: '#2a0a1e', drop: null, grabbable: false, dieSfx: 'spirit', diePitch: 0.45,
    clearDelay: 200, // 215フレームの消滅演出が終わってから STAGE CLEAR を出す
    moves: MV[1], moves2: MV[2], moves3: MV[3],
    draw: drawFemto, update: femtoUpdate, think: femtoThink, onDie: femtoDie, onSpawn: femtoSpawn,
  });
})(window.BK);

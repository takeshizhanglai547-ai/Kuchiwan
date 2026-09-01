// ══════════════════════════════════════════════════════════════════
//  敵とボスをドット絵にする層
// ══════════════════════════════════════════════════════════════════
// 本編の敵は「なめらかなグラデで塗った、輪郭線の無い絵」で描かれている。
// 480×270 へ落としただけだと背景と同じ質感のまま溶けて、どれも同じ
// 生きものに見える。ここでやるのは三つだけ：
//
//   1. シルエットに1ドットの濃い輪郭を回す（板ではなく駒に見せる）
//   2. 上から下へ「段で割った」陰影を1枚かぶせる（厚塗りの立体感）
//   3. 素材（毛皮・甲殻・金属・骨・石・布・粘体）ごとに質感を変える
//
// 加えて、待機の呼吸・重心の揺れ・予備動作・のけぞり・上体の遅延追従を
// 姿勢そのもので出す。本編がすでに持っている e.anim / e.state /
// e.telegraph / e.hurtTimer / e.id をそのまま読み、新しい状態は作らない。
//
// 実装の要：本体の描画関数をオフスクリーンへ「一度だけ」描き、そこで
// 質感を乗せてから縁を1ドット取り出し、まとめて戻す。本体を二度描くと
// ベクタの描画コストが敵16体ぶん丸ごと倍になる。
(function () {
  if (typeof PX === 'undefined' || typeof ETYPE === 'undefined') return;

  //────────────────────────────────────────────────────────────────
  //  下書き用オフスクリーン
  //────────────────────────────────────────────────────────────────
  // 下書きは「敵の大きさに合った1枚」を使い回す。1枚の大きな板（896×896）を
  // 使い回すと、drawImage のたびに板ぜんぶが処理されるらしく、敵1体の
  // drawEnemy が 0.09ms → 6.36ms まで落ちた（実測。輪郭の合成そのものは
  // 単体で測ると 0.02ms しかかからない）。板を実寸に合わせるだけで大半が消える。
  // 最大の板は、神ボス（光輪が体の外へ 150 論理単位）と六周目の gsc:1.85 が
  // 収まる大きさ。ここにも入らないものは輪郭を諦める（切れるより良い）。
  const BUCKETS = [64, 96, 128, 144, 160, 192, 224, 256, 320, 384, 448, 512, 640, 768, 896, 1024];
  const pool = new Map();
  let cA = null, cB = null, gA = null, gB = null, patCtx = null;
  function slabFor(need) {
    for (let i = 0; i < BUCKETS.length; i++) {
      const s = BUCKETS[i]; if (s < need) continue;
      let p = pool.get(s);
      if (!p) {
        const a = document.createElement('canvas'); a.width = a.height = s;
        const b = document.createElement('canvas'); b.width = b.height = s;
        p = { a: a, b: b, ga: a.getContext('2d'), gb: b.getContext('2d') };
        p.ga.imageSmoothingEnabled = false; p.gb.imageSmoothingEnabled = false;
        pool.set(s, p);
      }
      cA = p.a; cB = p.b; gA = p.ga; gB = p.gb;
      return true;
    }
    return false;   // 枠に入らないものは輪郭を諦める（切れるより良い）
  }
  function ensure() {
    if (patCtx) return;
    const c = document.createElement('canvas'); c.width = c.height = 8;
    patCtx = c.getContext('2d');
    buildMats();
  }

  //────────────────────────────────────────────────────────────────
  //  素材
  //────────────────────────────────────────────────────────────────
  // band … 体の上端から下端へ張る「段で割った」陰影。行数がそのまま段数で、
  //        ニアレストで引き伸ばすので必ず硬い境目になる。null の行は素通し。
  // tex  … 面に敷く模様（毛の斑・金属のヘアライン・骨の筋・石の粒）
  // 縁の色は敵の固有色から作る。真っ黒で統一すると全部が同じ材質に見える。
  function strip(rows) {
    const c = document.createElement('canvas'); c.width = 1; c.height = rows.length;
    const g = c.getContext('2d');
    for (let i = 0; i < rows.length; i++) { if (!rows[i]) continue; g.fillStyle = rows[i]; g.fillRect(0, i, 1, 1); }
    return c;
  }
  function hstrip(cols) {          // 横方向の段（左が光・右が影）
    const c = document.createElement('canvas'); c.width = cols.length; c.height = 1;
    const g = c.getContext('2d');
    for (let i = 0; i < cols.length; i++) { if (!cols[i]) continue; g.fillStyle = cols[i]; g.fillRect(i, 0, 1, 1); }
    return c;
  }
  function tile(w, h, pix) {   // pix: [[x,y,色]…]
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d');
    for (const p of pix) { g.fillStyle = p[2]; g.fillRect(p[0], p[1], 1, 1); }
    return c;
  }

  const MAT = {};
  let matsReady = false;
  function buildMats() {
    if (matsReady) return; matsReady = true;
    const P = (cv) => patCtx.createPattern(cv, 'repeat');

    // 毛皮：暖色の背→寒色の腹。斑を散らして「面が毛で覆われている」ことを出し、
    //       輪郭も少し欠けさせて毛先のギザギザにする
    MAT.fur = {
      hband: hstrip(['rgba(255,228,176,.16)', null, null, 'rgba(36,28,68,.13)']),
      band: strip(['rgba(255,232,178,.30)', 'rgba(255,206,148,.14)', null, null, 'rgba(52,42,92,.15)', 'rgba(28,22,60,.27)']),
      tex: P(tile(4, 4, [[0, 0, 'rgba(255,236,196,.30)'], [2, 1, 'rgba(40,30,58,.26)'], [1, 3, 'rgba(40,30,58,.18)']])),
      texA: 0.24, rim: '#ffd9a0', rimA: 0.55, notch: true, ocol: '#1c1220',
    };
    // 甲殻：てっぺんに硬いハイライトを2ドット置き、腹はほぼ黒まで落とす
    MAT.chitin = {
      hband: hstrip(['rgba(255,248,220,.20)', null, null, 'rgba(20,18,58,.18)']),
      band: strip(['rgba(255,250,228,.40)', 'rgba(255,232,186,.18)', null, null, null, 'rgba(28,26,78,.23)', 'rgba(14,12,48,.36)']),
      tex: null, texA: 0, spec: 2, rim: '#ffe8b0', rimA: 0.62, ocol: '#160e26',
    };
    // 金属：上下の差を最大に取り、天面に1ドットの白を通す
    MAT.metal = {
      hband: hstrip(['rgba(255,255,255,.22)', null, null, 'rgba(12,16,44,.22)']),
      band: strip(['rgba(255,255,255,.44)', 'rgba(206,232,255,.16)', null, null, 'rgba(24,28,62,.19)', 'rgba(16,20,50,.29)', 'rgba(8,10,34,.40)', 'rgba(190,214,255,.16)']),
      tex: P(tile(1, 4, [[0, 0, 'rgba(255,255,255,.16)'], [0, 2, 'rgba(0,0,0,.14)']])),
      texA: 0.34, spec: 1, rim: '#cfe6ff', rimA: 0.70, ocol: '#0c1020',
    };
    // 骨：白の階調しか無いので段を増やし、稜線で読ませる
    MAT.bone = {
      hband: hstrip(['rgba(255,250,232,.20)', null, null, 'rgba(28,26,50,.17)']),
      band: strip(['rgba(255,252,236,.38)', 'rgba(228,224,200,.14)', null, null, null, 'rgba(44,42,68,.20)', 'rgba(22,20,44,.33)']),
      tex: P(tile(4, 3, [[0, 0, 'rgba(255,255,244,.24)'], [2, 2, 'rgba(30,28,48,.22)']])),
      texA: 0.28, rim: '#fff4d8', rimA: 0.55, ocol: '#181428',
    };
    // 石／神話：段を粗くして重さを出す
    MAT.stone = {
      hband: hstrip(['rgba(255,230,188,.18)', null, null, 'rgba(30,24,58,.17)']),
      band: strip(['rgba(255,232,190,.26)', null, null, 'rgba(44,36,76,.18)', 'rgba(24,20,54,.29)']),
      tex: P(tile(8, 8, [[1, 2, 'rgba(255,240,210,.16)'], [5, 1, 'rgba(30,24,52,.18)'], [3, 6, 'rgba(30,24,52,.14)'], [6, 5, 'rgba(255,240,210,.10)']])),
      texA: 0.30, rim: '#ffdca8', rimA: 0.50, ocol: '#1a1428',
    };
    // 布／戦国：縦の折り目を通す
    MAT.cloth = {
      hband: hstrip(['rgba(255,228,188,.16)', null, null, 'rgba(28,22,52,.14)']),
      band: strip(['rgba(255,230,190,.24)', 'rgba(255,220,180,.10)', null, null, 'rgba(40,32,72,.16)', 'rgba(22,18,50,.26)']),
      tex: P(tile(3, 1, [[0, 0, 'rgba(255,238,206,.14)'], [2, 0, 'rgba(28,22,50,.14)']])),
      texA: 0.26, rim: '#ffd8a8', rimA: 0.50, ocol: '#1b1224',
    };
    // 異星の生体：寒色の照り。腹の発光を殺したくないので下段は控えめ
    MAT.alien = {
      hband: hstrip(['rgba(200,255,232,.18)', null, null, 'rgba(14,32,54,.17)']),
      band: strip(['rgba(206,255,236,.30)', 'rgba(150,232,204,.14)', null, null, 'rgba(22,54,68,.18)', 'rgba(12,28,54,.29)']),
      tex: null, texA: 0, spec: 1, rim: '#b8ffe0', rimA: 0.60, ocol: '#0e1a24',
    };
    // 粘体・半透明：市松で抜いて「向こうが透けている」ことをドットで示す
    MAT.jelly = {
      hband: hstrip(['rgba(228,248,255,.20)', null, null, 'rgba(20,26,60,.12)']),
      band: strip(['rgba(232,250,255,.34)', null, null, 'rgba(32,42,84,.13)', 'rgba(18,24,58,.21)']),
      tex: null, texA: 0, punch: P(tile(4, 4, [[1, 0, '#000'], [3, 2, '#000']])), punchA: 0.5,
      rim: '#dff4ff', rimA: 0.62, ocol: '#141c30',
    };
    MAT.fur.notchPat = P(tile(5, 5, [[0, 1, '#000'], [3, 3, '#000'], [2, 0, '#000']]));
  }

  function matOf(e, t) {
    if (e._pxMat && e._pxKey === e.type) return e._pxMat;
    e._pxKey = e.type; e._pxOut = null;
    let m;
    if (t.slimey || t.bossKind === 'slime' || t.bossKind === 'ghost' || t.balloon || t.warper) m = MAT.jelly;
    else if (t.mecha || t.mechaKind || t.bossKind === 'emperor') m = MAT.metal;
    else if (t.bug) m = MAT.chitin;
    else if (t.alien) m = MAT.alien;
    else if (t.boner) m = MAT.bone;
    else if (t.myth) m = MAT.stone;
    else if (t.sengoku) m = MAT.cloth;
    else m = MAT.fur;
    e._pxMat = m; return m;
  }
  // 縁の色は固有色から作る。素材の下地へ寄せてから暗く落とすので、
  // 金属は青黒く、毛皮は赤黒く、蟲は紫黒くなる（全部を同じ黒にしない）。
  // 起点は最暗色 c3 ではなく中間色 c2 にする。c3 から作ると真っ黒へ潰れ、
  // 暗い背景では線が丸ごと消える（最初の版で実際にそうなった）。
  function outlineCol(e, t, m) {
    if (e._pxOut) return e._pxOut;
    const lum = (col) => { const v = pxRGB(col); return v[0] * 0.299 + v[1] * 0.587 + v[2] * 0.114; };
    const base = t.c2 || t.c1 || '#3a3240';
    const rgb = pxRGB(pxMix(base, m.ocol, 0.55));
    const y = Math.max(1, rgb[0] * 0.299 + rgb[1] * 0.587 + rgb[2] * 0.114);
    // 明度を本体（c1）の3割へ合わせる。上限と下限で挟むので、白い敵でも
    // 黒い敵でも「本体より必ず数段暗く、背景へは沈まない」濃さに揃う
    const want = Math.min(64, Math.max(26, lum(t.c1 || base) * 0.30));
    const k = want / y;
    e._pxOut = pxHex(rgb[0] * k, rgb[1] * k, rgb[2] * k);
    return e._pxOut;
  }

  //────────────────────────────────────────────────────────────────
  //  輪郭＋質感の一括処理
  //────────────────────────────────────────────────────────────────
  // hw/up/down は「今の原点から左右 hw・上へ up・下へ down」に収まる当たり枠（論理座標）。
  // ここを超えて描かれたものは切り落とされるので、敵ごとに余裕を持って渡す。
  //
  // ── 品質の段（本編のガバナー perfTier 0/1/2 にそのまま従う）──
  // 下書きの板を経由する処理は敵1体あたり約0.5ms掛かる（この環境の実測）。
  // 16体が同時に出る場面では、この層だけで8ms前後になる。落とす順：
  //   lv3 = 全員に輪郭＋暖色のリム（既定）
  //   lv2 = 全員に輪郭（リムを外す）
  //   lv1 = ボスだけ。雑魚は姿勢の変化だけ残して素通し
  //   lv0 = 全部素通し
  // ボスの輪郭は最後まで残す。巨大なボスの存在感が本作の売りなので、
  // そこを削ると「軽いが別のゲーム」になる
  const FOEQ = { lv: 3, auto: true };
  window.PXFOE = FOEQ;

  // 段を「本編のガバナー perfTier」から決めるのはやめた。
  // 性能監査で実測したところ、敵16体の場面で perfTier が 1↔2 を約1.5〜2.5秒おきに
  // 往復し（600フレームで5回）、そのたびに**雑魚16体の輪郭が一斉に消えては戻る**。
  // 原因は本編の閾値（21.5ms で降格・17.6ms で復帰）の境目に、この層を足した
  // フレーム時間がちょうど乗ってしまうこと。壁時計で決めるかぎり振動は止まらない。
  //
  // 代わりに**敵の数**で決める。費用は体数にほぼ比例する（実測 0.61ms/体）ので
  // 上限を数で切れば、フレーム時間を見なくても予算が守れる。数は湧きと撃破でしか
  // 変わらないので、切り替わりは稀で、しかも画面が賑やかな瞬間に紛れる。
  // 行きと戻りで閾値をずらして（ヒステリシス）、境目での往復も止める。
  let _slowLatch = 0;         // 本当に遅い端末の保険。一度掛かったら簡単には外さない
  function foePickLv() {
    const n = (typeof enemies !== 'undefined' && enemies) ? enemies.length : 0;
    if (typeof perfTier !== 'undefined') {
      if (perfTier >= 2) _slowLatch = 600;              // 10秒ぶん保持
      else if (perfTier === 0 && _slowLatch > 0) _slowLatch--;
    }
    let lv = FOEQ.lv;
    if (lv >= 3 && n > 6) lv = 2;                       // 落ちる側は 6/10
    else if (lv === 2 && n > 10) lv = 1;
    if (lv <= 1 && n <= 7) lv = 2;                      // 戻る側は 7/4（重ならない）
    if (lv === 2 && n <= 4) lv = 3;
    if (_slowLatch > 0) lv = Math.min(lv, 1);           // ボスの輪郭だけは残す
    FOEQ.lv = lv;
  }
  let busy = false;
  function foeArt(t, hw, up, down, bodyH, mat, ocol, fn) {
    if (!PX.on || busy || (typeof pxOutlineDepth !== 'undefined' && pxOutlineDepth > 0)) { fn(); return; }
    ensure();
    const M = ctx.getTransform();
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    const CS = [[-hw, -up], [hw, -up], [-hw, down], [hw, down]];
    for (let i = 0; i < 4; i++) {
      const dx = M.a * CS[i][0] + M.c * CS[i][1], dy = M.b * CS[i][0] + M.d * CS[i][1];
      if (dx < x0) x0 = dx; if (dx > x1) x1 = dx; if (dy < y0) y0 = dy; if (dy > y1) y1 = dy;
    }
    // 板の左上（4,4）へ寄せて置く。原点を固定しないので、板は実寸で足りる
    const ix0 = Math.floor(x0), iy0 = Math.floor(y0);
    const bx = 4, by = 4;
    const w = Math.ceil(x1) - ix0 + 2, h = Math.ceil(y1) - iy0 + 2;
    const OX = 4 - ix0, OY = 4 - iy0;
    if (w < 2 || h < 2 || !slabFor(Math.max(bx + w, by + h) + 4)) { fn(); return; }
    // 巨体ほど線を太く。1ドットのままだと、300ドットのボスでは線が細すぎて
    // 「厚塗りの大物」ではなく「引き伸ばした絵」に見える
    const O = h > 190 ? 2 : 1;
    busy = true;
    try { foeArtRun(t, M, bx, by, w, h, O, OX, OY, bodyH, mat, ocol, fn); }
    finally { busy = false; }   // 途中で例外が出ても、以降の敵まで素通しにしない
  }
  function foeArtRun(t, M, bx, by, w, h, O, OX, OY, bodyH, mat, ocol, fn) {
    const keepA = ctx.globalAlpha;   // 死に際のフェードなど、呼び出し元の α を壊さない
    gA.setTransform(1, 0, 0, 1, 0, 0);
    gA.globalAlpha = 1; gA.globalCompositeOperation = 'source-over';
    gA.clearRect(bx - 2, by - 2, w + 4, h + 4);
    gA.setTransform(M.a, M.b, M.c, M.d, OX, OY);
    const keep = ctx; ctx = gA;
    if (typeof pxOutlineDepth !== 'undefined') pxOutlineDepth++;
    try { fn(); } finally {
      ctx = keep;
      if (typeof pxOutlineDepth !== 'undefined') pxOutlineDepth--;
    }

    // ── 面の処理。ドット格子に揃えたいので、ここから先は等倍で触る ──
    // 段は「枠」ではなく「体」に合わせて張る。枠に合わせると、頭の上の空白へ
    // 明るい段が乗って、体には中間の段しか来ない（＝頭だけ白く飛ぶ）。
    const yT = Math.max(by, Math.round(OY + M.d * (-bodyH * 1.02)));
    const yB = Math.min(by + h, Math.round(OY + M.d * (bodyH * 0.05)));
    const hB = Math.max(2, yB - yT);
    gA.setTransform(1, 0, 0, 1, 0, 0);
    gA.globalCompositeOperation = 'source-atop';
    gA.globalAlpha = 1;
    gA.drawImage(mat.band, 0, 0, 1, mat.band.height, bx, yT, w, hB);   // 段で割った陰影（縦）
    // 横の段。光源は必ず画面の左上なので、向き（M.a の符号）に関係なく
    // 画面座標のまま張る。縦だけだと円柱が板に見える
    gA.drawImage(mat.hband, 0, 0, mat.hband.width, 1, bx, yT, w, hB);
    if (mat.tex) { gA.globalAlpha = mat.texA; gA.fillStyle = mat.tex; gA.fillRect(bx, by, w, h); gA.globalAlpha = 1; }
    if (mat.spec) {                                                   // 甲殻・金属の硬いハイライト
      gA.fillStyle = '#ffffff';
      gA.fillRect(bx + (w * 0.34 | 0), yT + (hB * 0.16 | 0), 2, 2);
      if (mat.spec > 1) gA.fillRect(bx + (w * 0.46 | 0), yT + (hB * 0.26 | 0), 2, 2);
    }
    if (mat.punch) {                                                  // 半透明はディザで抜く
      gA.globalCompositeOperation = 'destination-out';
      gA.globalAlpha = mat.punchA; gA.fillStyle = mat.punch; gA.fillRect(bx, by, w, h); gA.globalAlpha = 1;
    }
    gA.globalCompositeOperation = 'source-over';

    // ── 輪郭とリムライト ────────────────────────────────────────
    // 「別の板で縁だけを取り出してから本体を戻す」と、板を読む drawImage が
    // 11回になる。この環境ではキャンバス→キャンバスの読みが1回あたり
    // 約0.1msかかり、敵16体でそれだけで16msを超えた（実測）。
    // そこで手順を裏返す：本体の絵を1回だけ退避し、下書きの板そのものを
    // 単色のシルエットへ塗り替えて、ずらして4回置く。最後に本体を重ねる。
    // 板を読むのは 1(退避) + 4(輪郭) + 1(リム) + 1(本体) = 7回で済む。
    const dx0 = M.e - OX, dy0 = M.f - OY;
    gB.setTransform(1, 0, 0, 1, 0, 0);
    gB.globalAlpha = 1; gB.globalCompositeOperation = 'source-over';
    gB.clearRect(bx - 1, by - 1, w + 2, h + 2);
    gB.drawImage(cA, bx, by, w, h, bx, by, w, h);                     // 本体の絵を退避

    // cA を輪郭色一色のシルエットにする（source-atop なので α はそのまま）
    gA.globalCompositeOperation = 'source-atop';
    gA.fillStyle = ocol; gA.fillRect(bx - 1, by - 1, w + 2, h + 2);
    if (mat.notch) {                                                  // 毛皮だけ縁を欠けさせる＝毛先
      gA.globalCompositeOperation = 'destination-out';
      gA.globalAlpha = 0.9; gA.fillStyle = mat.notchPat;
      gA.fillRect(bx - 1, by - 1, w + 2, h + 2); gA.globalAlpha = 1;
    }
    gA.globalCompositeOperation = 'source-over';

    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.imageSmoothingEnabled = false;
    ctx.drawImage(cA, bx, by, w, h, dx0 + bx - O, dy0 + by, w, h);    // 輪郭：上下左右へ1ドット
    ctx.drawImage(cA, bx, by, w, h, dx0 + bx + O, dy0 + by, w, h);
    ctx.drawImage(cA, bx, by, w, h, dx0 + bx, dy0 + by - O, w, h);
    ctx.drawImage(cA, bx, by, w, h, dx0 + bx, dy0 + by + O, w, h);
    if (mat.rim && FOEQ.lv >= 3) {   // 光の側だけ、輪郭を暖色へ置き換える（同じシルエットを塗り直して1回置く）
      gA.globalCompositeOperation = 'source-atop';
      gA.fillStyle = mat.rim; gA.fillRect(bx - 1, by - 1, w + 2, h + 2);
      gA.globalCompositeOperation = 'source-over';
      ctx.globalAlpha *= (t && t.boss) ? 0.55 : 0.85;
      ctx.drawImage(cA, bx, by, w, h, dx0 + bx - O, dy0 + by - O, w, h);
      ctx.globalAlpha = keepA;
    }
    ctx.drawImage(cB, bx, by, w, h, dx0 + bx, dy0 + by, w, h);        // 本体
    ctx.restore();
  }

  //────────────────────────────────────────────────────────────────
  //  当たり枠（描いた絵がここを超えると切れる）
  //────────────────────────────────────────────────────────────────
  // 体の外へ大きくはみ出すものは名指しで広げる。数字は本編の描画コードで
  // 実際に使われている座標（神の光輪 +130／チャムルスの触角 -216 など）から取った。
  const WIDE = {
    chamurus: [1.10, 1.50, 0.22], chamboss: [0.95, 1.60, 0.20],
    bikewan: [1.80, 1.30, 0.25], trailerwan: [1.70, 1.20, 0.25],
  };
  function boxOf(e, t) {
    const wd = WIDE[e.type];
    if (wd) return [t.w * wd[0] + 40, t.h * wd[1] + 40, t.h * wd[2] + 20];
    // 枠は「絵が収まる最小」に寄せる。板の大きさがそのまま描画コストなので、
    // 余白1ドットぶんが敵16体では効く。ただし削りすぎると得物や翼が切れる
    let hw = t.w * 0.70 + 22, up = t.h * 1.16 + 22, dn = t.h * 0.22 + 12;
    // ボスは1体しか出ないので枠を削る意味が無い。逆に雷や光輪が体の外へ
    // 大きく出るので、たっぷり取る（ゼウスの雷は実際にここで切れた）
    if (t.boss) { hw = t.w * 1.10 + 70; up = t.h * 1.45 + 60; dn = t.h * 0.34 + 24; }
    if (typeof GOD_ART !== 'undefined' && GOD_ART[t.bossKind]) { hw = t.w * 1.30 + 110; up = t.h * 1.50 + 150; }
    if (t.flyer || t.zflyer) up += 40;
    if (t.gear === 'lance' || t.gear === 'ballista' || t.gear === 'whip') hw += 70;
    if (t.gear === 'bigwings' || t.gear === 'wings') { hw += 60; up += 40; }
    return [hw, up, dn];
  }

  //────────────────────────────────────────────────────────────────
  //  姿勢：呼吸・重心・予備動作・のけぞり・上体の遅延追従
  //────────────────────────────────────────────────────────────────
  const cl = (v, a, b) => (v < a ? a : v > b ? b : v);
  function foePose(e, t) {
    // 上体の遅延追従：足元は地面に残し、胴と頭だけが加速の反対へ遅れる。
    // 実位置の差分から作るので、歩き・突進・吹き飛び・掴まれの全部に効く
    const prev = e._pxPX; e._pxPX = e.x;
    let d = (prev == null) ? 0 : e.x - prev;
    if (d > 24 || d < -24) d = 0;                        // 画面外から戻った瞬間の飛びを捨てる
    e._pxLag = (e._pxLag == null) ? d : e._pxLag + (d - e._pxLag) * 0.24;
    const lag = cl((e._pxLag - d) * (t.boss ? 0.034 : 0.018), -0.10, 0.10) * (e.facing || 1);
    if (lag) ctx.transform(1, 0, lag, 1, 0, 0);

    const st = e.state;
    if (e.telegraph > 0) {
      // 予備動作を「沈む → 溜める → 伸び上がる」の3拍に割る。
      // 本編は引く動きだけなので、沈みと伸び上がりを足して1〜2拍ぶん稼ぐ
      const w = 1 - e.telegraph / (e.teleMax || 26);
      if (w < 0.28) { const u = Math.sin(w / 0.28 * Math.PI); ctx.scale(1 + 0.07 * u, 1 - 0.10 * u); }
      else if (w > 0.80) { const u = (w - 0.80) / 0.20; ctx.scale(1 - 0.06 * u, 1 + 0.09 * u); ctx.translate(0, -2 * u); }
    } else if (st === 'hurt') {
      // 白フラッシュに頼らず、姿勢でのけぞりを見せる。上体だけを後ろへ倒す
      const h = cl((e.hurtTimer || 0) / 16, 0, 1), k = Math.sin(h * Math.PI);
      ctx.transform(1, 0, 0.20 * h, 1, 0, 0);
      ctx.scale(1 - 0.07 * k, 1 + 0.06 * k);
    } else if (st === 'attack' || st === 'bmove') {
      // 振り抜きの伸び。本編の炸裂に「体が伸びきる」1拍を重ねる
      const mx = (st === 'attack') ? Math.max(1, e.atkMax || 20) : Math.max(1, e.moveMax || 20);
      const tt = (st === 'attack') ? cl((mx - (e.atkTimer || 0)) / mx, 0, 1) : cl((e.moveT || 0) / mx, 0, 1);
      if (tt > 0.10 && tt < 0.55) { const u = Math.sin((tt - 0.10) / 0.45 * Math.PI); ctx.scale(1 + 0.09 * u, 1 - 0.07 * u); }
    } else if (st === 'idle' || st === 'walk' || st === 'guard' || st === 'summon' || !st) {
      // 待機の呼吸と重心の揺れ。周期をずらして左右対称の人形にしない
      const ph = gf * 0.052 + (e.id || 0) * 1.31;
      const br = Math.sin(ph) * 0.013;
      ctx.translate(Math.sin(ph * 0.43 + (e.id || 0)) * (t.boss ? 2.6 : 1.4), 0);
      ctx.scale(1 - br * 0.5, 1 + br);
      if (e.rage) ctx.translate(Math.sin(gf * 0.9 + (e.id || 0)) * 1.2, 0);   // 怒っている間は小刻みに震える
    }
  }

  //────────────────────────────────────────────────────────────────
  //  本体の描画関数を差し替える
  //────────────────────────────────────────────────────────────────
  // drawEnemy はここへ分岐するだけなので、分岐先を全部包めば
  // 本編（drawEnemy）にも図鑑（drawFoeArt）にも同じ処理が乗る。
  const BODIES = [
    'drawBeast', 'drawSlime', 'drawWanmen', 'drawGolux', 'drawPapipoo',
    'drawChamBoss', 'drawChamurus', 'drawBugFoe', 'drawAlienFoe', 'drawMythFoe',
    'drawSengokuFoe', 'drawMechaFoe', 'drawMechaAir', 'drawMechaKing', 'drawGuard0',
    'drawBugBoss', 'drawAlienBoss', 'drawGod', 'drawDemonKing', 'drawWarlord',
    'drawBoss', 'drawDragon', 'drawGhost', 'drawRival', 'drawShark', 'drawPirate',
    'drawNoroinu', 'drawCactus', 'drawWolfKing', 'drawDarkKnight', 'drawBigBoss',
    'drawBitter', 'drawWarpdog', 'drawPierrot', 'drawBalloonFoe', 'drawKirebouzu',
    'drawAri', 'drawOnibouzu', 'drawRider', 'drawBeastClaw',
  ];
  for (const nm of BODIES) {
    const raw = window[nm];
    if (typeof raw !== 'function') continue;
    window[nm] = (function (raw) {
      return function (e, a2, a3, a4) {
        const t = (e && e.type && ETYPE[e.type]) || null;
        if (!t || !PX.on) return raw.call(this, e, a2, a3, a4);
        ensure();
        if (FOEQ.auto) foePickLv();
        const lv = FOEQ.lv;
        ctx.save();
        foePose(e, t);   // 姿勢の変化は最も軽いので、どの段でも残す
        if (lv <= 0 || (lv === 1 && !t.boss)) raw.call(this, e, a2, a3, a4);
        else {
          const m = matOf(e, t), oc = outlineCol(e, t, m), B = boxOf(e, t);
          foeArt(t, B[0], B[1], B[2], t.h, m, oc, () => raw.call(this, e, a2, a3, a4));
        }
        ctx.restore();
      };
    })(raw);
  }

  //────────────────────────────────────────────────────────────────
  //  識別ディテール（メカの単眼・骨の肋・ゾンビの×目）
  //────────────────────────────────────────────────────────────────
  // 本体の輪郭処理より後に重ねられるので、ここは自前でドットとして置く。
  // 光る目は arc() のままだと縁が灰色に溶けるので、中点円で塗り分ける。
  drawFoeOverlay = function (e, t) {
    const hy = pxSnap(-t.h * 0.74), ex = pxSnap(t.w * 0.15);
    if (t.mecha) {
      const g = Math.sin(gf * 0.2) > 0.1;                     // 明滅は2値で切る（薄い中間色を作らない）
      pxCircle(ex, hy, 7, '#2a0a0a');                         // 眼窩の落ち込み
      pxCircle(ex, hy, 5, g ? '#ff5a3a' : '#c8281c');
      pxCircle(ex, hy, 2.5, '#ffd0a0');
      pxCircle(ex - PXU, hy - PXU, 1, '#ffffff');             // 1ドットの白＝金属の照り
      ctx.fillStyle = 'rgba(210,216,226,.85)';                // 額の継ぎ目（上下2段）
      ctx.fillRect(pxSnap(-t.w * 0.22), pxSnap(-t.h * 0.5), pxSnap(t.w * 0.44), PXU);
      ctx.fillStyle = 'rgba(30,34,44,.75)';
      ctx.fillRect(pxSnap(-t.w * 0.22), pxSnap(-t.h * 0.5) + PXU, pxSnap(t.w * 0.44), PXU);
    } else if (t.boner) {
      for (let i = 0; i < 3; i++) {
        const ry = pxSnap(-t.h * (0.40 + i * 0.13));
        ctx.fillStyle = '#d8d2bc'; ctx.fillRect(pxSnap(-t.w * 0.17), ry, pxSnap(t.w * 0.34), PXU);
        ctx.fillStyle = '#4a4438'; ctx.fillRect(pxSnap(-t.w * 0.17), ry + PXU, pxSnap(t.w * 0.34), PXU);
      }
      pxCircle(ex, hy, 3, '#14141a');
      pxCircle(ex, hy, 1, '#8affc8');                          // 眼窩の燐光
    } else if (t.zombie) {
      pxLine(ex - 3, hy - 3, ex + 3, hy + 3, '#243018', PXU);
      pxLine(ex + 3, hy - 3, ex - 3, hy + 3, '#243018', PXU);
      const dl = pxSnap(7 + Math.sin(gf * 0.1) * 3);
      ctx.fillStyle = '#96dc5a'; ctx.fillRect(ex - PXU, hy + PXU * 3, PXU, dl);
      ctx.fillStyle = '#c8f08a'; ctx.fillRect(ex - PXU, hy + PXU * 3, PXU, PXU);
    }
  };

  // 蟲の共通ディテール。羽は α ではなく市松で抜く（低解像度で α の羽は霧になる）
  drawBugOverlay = function (e, t) {
    const hy = -t.h * 0.8, wig = Math.sin((e.anim || 0) * 1.4) * 3;
    const dk = pxMix(t.c2 || '#3a3a2a', '#000000', 0.35), lt = pxMix(t.c2 || '#3a3a2a', '#ffe2a0', 0.45);
    for (const s of [-1, 1]) {                                 // 触角：2段（下が影・上が光）で1本に見せる
      const x0 = s * t.w * 0.1, x1 = s * t.w * 0.3 + wig * s, y1 = hy - t.h * 0.3;
      pxLine(x0, hy, x1, y1, dk, PXU * 2);
      pxLine(x0, hy - PXU, x1, y1 - PXU, lt, PXU);
      pxCircle(x1, y1, 3, t.accent || '#ffd24d');
      pxCircle(x1 - PXU, y1 - PXU, 1, '#fff6d0');
    }
    const flap = Math.abs(Math.sin(gf * 0.55 + (e.x || 0))) * 0.7 + 0.25;
    for (const s of [-1, 1]) {                                 // 半透明の羽：市松ディザで抜く
      ctx.save(); ctx.translate(-t.w * 0.18, -t.h * 0.62); ctx.rotate(s * flap * 0.85 - 0.2);
      ctx.fillStyle = wingPat();
      ctx.beginPath(); ctx.ellipse(-t.w * 0.24, 0, t.w * 0.34, t.h * 0.13, 0, 0, 7); ctx.fill();
      ctx.strokeStyle = 'rgba(196,230,250,.6)'; ctx.lineWidth = 1; ctx.stroke();
      ctx.restore();
    }
    pxCircle(t.w * 0.16, hy + 2, 4, '#12140a');                // 複眼：黒地に硬い光
    pxCircle(t.w * 0.16, hy + 2, 2.6, 'rgb(150,240,130)');
    pxCircle(t.w * 0.16 - PXU, hy + 2 - PXU, 1, '#ffffff');
  };
  let _wp = null;
  function wingPat() {
    if (_wp) return _wp;
    const c = document.createElement('canvas'); c.width = c.height = 2;
    const g = c.getContext('2d'); g.fillStyle = '#dff2ff'; g.fillRect(0, 0, 1, 1); g.fillRect(1, 1, 1, 1);
    _wp = g.createPattern(c, 'repeat'); return _wp;
  }

  // 盾：面を段で割り、縁に濃い線を回す（本編はなめらかなグラデ1枚だった）
  drawEnemyShield = function (e) {
    const guarding = e.state === 'guard';
    const R = pxRamp('#8fa6c8', 5);
    ctx.save(); ctx.translate(22, -26);
    if (guarding) ctx.scale(1.12, 1.12);
    const dr = (x, y, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(pxSnap(x), pxSnap(y), pxSnap(w), pxSnap(h)); };
    dr(-13, -19, 26, 38, '#1c2740');            // 縁
    dr(-11, -17, 22, 34, R[1]);
    dr(-11, -17, 22, 12, R[3]);                 // 天面
    dr(-11, -17, 22, 4, R[4]);
    dr(-11, 5, 22, 12, R[0]);                   // 底の影
    pxCircle(0, -2, 5, '#2f4775');
    pxCircle(0, -2, 3, R[4]);
    pxCircle(-2, -4, 1, '#ffffff');
    if (guarding) {
      ctx.globalAlpha = 0.55 + 0.35 * Math.sin(gf * 0.4);
      pxCircle(0, -2, 17, '#bfe9ff', false);
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  };

  //────────────────────────────────────────────────────────────────
  //  グレート・ワン（呼び出される「大いなるもの」）
  //────────────────────────────────────────────────────────────────
  // 本編は放射グラデの靄＋なめらかな触手＋楕円の目玉。ドット絵では靄が
  // ただ濁るだけなので、段で割った暗雲・折れ線の触手・硬い目玉へ描き直し、
  // 体格も上げて「画面を圧倒する」側へ寄せる。目は個別の周期で瞬く。
  if (typeof drawGreatOne === 'function') {
    drawGreatOne = function () {
      const cp = activePlayers().find(pp => pp.state === 'attack' && pp.atk && pp.atk.def.caller);
      if (!cp) return;
      const tt = cp.atk.t, ap = Math.min(1, tt / 12) * (tt > 70 ? Math.max(0, (84 - tt) / 14) : 1);
      if (ap <= 0) return;
      const grow = Math.min(1, tt / 16);                       // 現れる間は膨らむ
      const gx = pxSnap(W - 186), gy = pxSnap(140 + Math.sin(gf * 0.07) * 8);
      // 暗雲。外＝暗い／内＝明るい の順に「大きいものから」重ねる。
      // 逆順で重ねると、最後に置いた一番大きく暗い円が全部を塗り潰す
      const HAZE = ['#080310', '#130722', '#1e0c30', '#2c1244'];
      ctx.save();
      for (let i = 0; i < 4; i++) {
        ctx.globalAlpha = ap * (0.34 + i * 0.16);
        pxCircle(gx, gy, (128 - i * 23) * grow, HAZE[i]);
      }
      ctx.globalAlpha = ap;
      // 触手：折れ線2節。暗雲の上に出すので、影より1段明るい紫を主にする。
      // 全部を暗色で描くと雲に沈んで、動いていることすら見えない
      for (let i = 0; i < 9; i++) {
        const a = i / 9 * Math.PI * 2 + gf * 0.018;
        const ln = ((i % 2 ? 132 : 104) + Math.sin(gf * 0.09 + i * 1.7) * 24) * grow;
        const bend = Math.sin(gf * 0.13 + i * 2.1) * 28;
        const mx = gx + Math.cos(a) * ln * 0.55 - Math.sin(a) * bend * 0.4;
        const my = gy + Math.sin(a) * ln * 0.55 + Math.cos(a) * bend * 0.4;
        const ex = gx + Math.cos(a) * ln, ey = gy + Math.sin(a) * ln;
        // 根元を太く、先へ向かって細くする。3段の太さで「触手」に見せる
        pxLine(gx, gy, mx, my, '#1a0a2e', PXU * 9);            // 影の芯
        pxLine(mx, my, ex, ey, '#1a0a2e', PXU * 5);
        pxLine(gx, gy - PXU, mx, my - PXU, '#4a2470', PXU * 6);
        pxLine(mx, my - PXU, ex, ey - PXU, '#4a2470', PXU * 3);
        pxLine(gx, gy - PXU * 2, mx, my - PXU * 2, '#7b45b4', PXU * 3);   // 光の側
        pxLine(mx, my - PXU * 2, ex, ey - PXU, '#7b45b4', PXU);
        pxCircle(ex, ey, 4, '#8a52c0');
        pxCircle(ex - PXU, ey - PXU, 2, '#d0aef0');            // 先端の照り
      }
      const rx = 70 * grow, ry = 78 * grow;                    // 本体：楕円を4段で塗る
      pxEll(gx, gy, rx + PXU * 2, ry + PXU * 2, '#0a0412');    // 輪郭
      pxEll(gx, gy, rx, ry, '#241038');
      pxEll(gx - rx * 0.08, gy - ry * 0.12, rx * 0.86, ry * 0.80, '#3f1a60');
      pxEll(gx - rx * 0.20, gy - ry * 0.30, rx * 0.58, ry * 0.48, '#65309a');
      pxEll(gx - rx * 0.34, gy - ry * 0.50, rx * 0.30, ry * 0.22, '#9358d0');   // 頂点の照り
      pxEll(gx, gy + ry * 0.46, rx * 0.80, ry * 0.40, '#180a28');               // 腹側の影
      // 目：ひとつずつ違う周期で瞬く。閉じている目は1ドットの線になる
      const EYES = [[-26, -18, 11], [18, -30, 8], [4, 8, 14], [-13, 30, 7], [31, 14, 8]];
      for (let i = 0; i < EYES.length; i++) {
        const ex = gx + EYES[i][0] * grow, ey = gy + EYES[i][1] * grow, r = EYES[i][2] * grow;
        if (Math.sin(gf * 0.043 + i * 2.3) > 0.92) {
          ctx.fillStyle = '#0e0418';
          ctx.fillRect(pxSnap(ex - r), pxSnap(ey), pxSnap(r * 2), PXU * 2); continue;
        }
        pxEll(ex, ey, r + PXU, r * 1.35 + PXU, '#0e0418');     // 眼窩
        pxEll(ex, ey, r, r * 1.35, '#8a5a08');
        pxEll(ex, ey - r * 0.10, r * 0.86, r * 1.16, '#ffd24d');
        pxEll(ex - r * 0.25, ey - r * 0.6, r * 0.34, r * 0.30, '#fff2b8');
        pxEll(ex, ey + r * 0.14, r * 0.22, r * 0.80, '#140620');   // 縦に裂けた瞳
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(pxSnap(ex - r * 0.5), pxSnap(ey - r * 0.75), PXU, PXU);
      }
      ctx.restore();
    };
  }
  // 中点円と同じ理屈の楕円。ellipse() の縁は低解像度だと灰色に溶ける
  function pxEll(cx, cy, rx, ry, col) {
    const p = pxSnapHere(cx, cy);
    const RX = Math.max(1, Math.round(rx / PXU)), RY = Math.max(1, Math.round(ry / PXU));
    ctx.fillStyle = col;
    for (let dy = -RY; dy <= RY; dy++) {
      const k = 1 - (dy * dy) / (RY * RY);
      const dx = k <= 0 ? 0 : Math.round(RX * Math.sqrt(k));
      ctx.fillRect(p.x - dx * PXU, p.y + dy * PXU, (dx * 2 + 1) * PXU, PXU);
    }
  }

  //────────────────────────────────────────────────────────────────
  //  運搬機（敵を吊って降ろすヘリとドローン）
  //────────────────────────────────────────────────────────────────
  // 本編は丸みのある機体をなめらかに塗っていた。ドット絵では面を
  // 上下2段の強いコントラストへ割り、機体の縁に濃い線を回す。
  if (typeof drawCarriers === 'function') {
    drawCarriers = function () {
      for (const c of carriers) {
        const sx = c.x - camX; if (sx < -260 || sx > W + 260) continue;
        const gy = LANE - groundLift(c.x), cy = gy - c.z, face = c.dir;
        ctx.save(); ctx.globalAlpha = 0.26; pxEll(sx, gy + 3, 34, 9, '#000000'); ctx.restore();
        if (c.hold) {                                          // 吊索は影1ドット＋光1ドット
          const eh = (ETYPE[c.hold.type].h || 100);
          pxLine(sx, cy + 14, c.hold.x - camX, gy - c.hold.z - eh, '#242a32', PXU);
          pxLine(sx + PXU, cy + 14, c.hold.x - camX + PXU, gy - c.hold.z - eh, '#7a8290', PXU);
        }
        const CS = (c.kind === 'heli') ? 1.42 : 1.14;
        ctx.save(); ctx.translate(pxSnap(sx), pxSnap(cy)); ctx.scale(face * CS, CS);
        const R = (x, y, w, h, col) => { ctx.fillStyle = col; ctx.fillRect(pxSnap(x), pxSnap(y), pxSnap(w), pxSnap(h)); };
        const body = () => {
          if (c.kind === 'heli') {
            R(-34, -16, 64, 30, '#232b20');                    // 胴（下段＝影）
            R(-34, -16, 64, 12, '#54683f');                    // 上段＝光
            R(-34, -16, 64, 3, '#8aa066');                     // 天面の1ドット
            R(10, -8, 22, 12, '#2f6a80'); R(10, -8, 22, 4, '#8fd4ec');   // 風防
            R(-72, -6, 42, 8, '#232b20'); R(-72, -6, 42, 3, '#54683f');  // テールブーム
            ctx.fillStyle = '#48583c'; ctx.beginPath();
            ctx.moveTo(-72, -14); ctx.lineTo(-58, -2); ctx.lineTo(-72, 6); ctx.closePath(); ctx.fill();
            pxLine(-18, 14, -22, 26, '#20262c', PXU); pxLine(14, 14, 18, 26, '#20262c', PXU);
            pxLine(-30, 26, 26, 26, '#3a3f48', PXU);
            R(-4, -24, 7, 10, '#20262c');
            const b = Math.abs(Math.cos(c.rot)) * 0.9 + 0.1;   // メインローター（回転で伸縮）
            R(-96 * b, -26, 192 * b, 4, '#14181e'); R(-96 * b, -26, 192 * b, 2, '#3a424c');
            const tb = Math.abs(Math.sin(c.rot * 1.4));
            R(-76, -22 * tb - 2, 4, 44 * tb + 4, '#1e242c');
            if (Math.floor(c.rot * 0.2) % 2 === 0) { pxCircle(-70, 4, 3, '#ff5a5a'); pxCircle(-70, 4, 1, '#ffe0d0'); }
          } else {
            R(-22, -9, 44, 20, '#1e242c');
            R(-22, -9, 44, 8, '#54606e');
            R(-22, -9, 44, 2, '#8b98a8');
            pxCircle(12, 2, 5, '#123448'); pxCircle(12, 2, 3, '#8fd4ec'); pxCircle(11, 1, 1, '#ffffff');
            for (const a of [[-14, -4, -36, -14], [14, -4, 36, -14], [-14, 2, -32, 12], [14, 2, 32, 12]])
              pxLine(a[0], a[1], a[2], a[3], '#39424e', PXU * 2);
            for (const rp of [[-36, -16], [36, -16], [-32, 10], [32, 10]]) {
              const b = Math.abs(Math.cos(c.rot * 1.7 + rp[0])) * 0.8 + 0.2;
              R(rp[0] - 17 * b, rp[1] - 2, 34 * b, 3, '#151a20');
              pxCircle(rp[0], rp[1], 3, '#20262c'); pxCircle(rp[0], rp[1], 1, '#6a7686');
            }
            if (Math.floor(c.rot * 0.25) % 2 === 0) pxCircle(-18, 6, 3, '#7dff5a');
          }
        };
        ensure();
        foeArt(null, 110, 40, 34, 40, MAT.metal, '#0a0e18', body);
        ctx.restore();
      }
    };
  }
})();

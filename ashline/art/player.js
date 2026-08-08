/* =============================================================================
   ashline/art/player.js — 自機フィギュア

   設計の芯：
   この作品で画面に一番長く映るのは「後ろから見た自機」である。
   だから背中（背嚢・アンテナ・後頭部のフレア・腰の後ろポーチ）に一番
   情報量を置き、正面は肩と胸板で幅を出す。

   シルエット設計（§3 の到達条件＝黒一色でも判別できること）：
     ・頭  … ヘルメット頂部に前後に走る稜線＋後頭部の跳ね上げ。丸でも箱でもない断面
     ・肩  … 外へ張り出して下向きに傾いた肩当て。首との間に「切れ込み」を作る
     ・腰  … 胸(0.50)→腹(0.34)→ベルト(0.46)と幅を振って、くびれの段差を作る
     ・背中… 背嚢＋横向きの巻物＋斜めのアンテナ。輪郭が背面へはみ出す
     ・脚  … 左右を離して股の抜けを作る。抜けがあるから「遮蔽の箱」と混ざらない
   遮蔽物は「面と直角の塊」、敵は別担当。こちらは「上が重く、腰でくびれ、
   脚の間が抜けている、非対称に銃を持つ塊」として読ませる。

   実装上の制約から来た判断（詳しくは各所のコメント）：
     ・ドローコール上限 6。検証シーンの床で 1 使うので実質 5 メッシュ。
       ジオメトリを手でマージし、色は全部「頂点カラー」で持たせて
       マテリアルは 1 個に抑えている。可動部は
       胴 / 右腕 / 右脚 / 左脚 / 銃 の 5 枚。左腕は胴へ焼き込んだ。
     ・影パスもドローコールに計上されるので、既定では影を落とさない。
       統合側で戻せるよう返り値に setCastShadow() を置いてある。
     ・影を落とすライトが 1 つだけの契約なので陰影の情報量が足りない。
       「空からの回り込み」「足元ほど暗い擬似AO」「上面ほど積もる粉塵」を
       頂点カラーに焼き込んで補っている（P.aoStrength / P.dust を使用）。
     ・胴と脚の実寸がそのまま被弾判定になる（game.js の hitboxFromRig）。
       背嚢の奥行き・肩の張り出し・脚の開き方は、見た目と判定の両方を
       実測しながら決めている。
     ・mats（テクスチャ集）は受け取るが使っていない。マテリアル1個・
       頂点カラーだけで色を作る構成を崩さないため。mats が undefined でも動く。
     ・ボーンなし。箱と角錐台と円筒の階層のみ。
   ========================================================================== */
(function (g) {
  var ASH = g.ASH = g.ASH || {};

  ASH.player = function (T, mats) {
    var P = ASH.palette;

    /* ---- 関節の高さ（すべてワールド原点＝足裏 y=0 基準の実寸 m） ---------- */
    var Y_TORSO = 0.98;   // 契約が指定する胸のピボット
    var Y_HIP = 0.94;   // 股関節。legR/legL のピボット
    var Y_SHLD = 1.42;   // 肩関節。torso ローカルで +0.44
    var Y_GUN = 0.92;   // 銃ピボット。game.js が torso ローカル -0.06 を書く
    var GUP = 0.30;   // 銃の実体をピボットより上に置く量。
    // syncRig は銃ピボットを腰の高さに置くので、
    // そのまま組むと小銃を腰で持つ絵になる。実体を
    // 持ち上げて、構え時に胸〜みぞおちの高さへ出す。

    /* 左腕を独立メッシュにするか。ドローコール予算 6（うち地面 1）のため
       false にして胴体へ焼き込む。詳細は返り値直前のコメント。 */
    var ARML_OWN_MESH = false;

    /* ---- 色（すべて ASH.palette 由来。生の16進は書かない） --------------- */
    var CA = ASH.col(T, P.playerArmor);        // 装甲板
    var CA2 = ASH.shade(T, P.playerArmor, 1.12); // 光を受ける上面の装甲
    /* 暗色は「面積の大きい所は持ち上げ、狭い所だけ本当に暗く」する。
       暗い遮蔽に重なったとき、面積の大きい暗色は輪郭ごと消える（実測）。
       本当の黒は、目の奥・靴底・銃身の影といった数センチの隙間だけに使う。 */
    var CAD = ASH.shade(T, P.playerArmorDark, 1.42); // 下地スーツ・ブーツ・銃（持ち上げ済み）
    var CAD2 = ASH.shade(T, P.playerArmorDark, 0.70); // 面頬の奥＝ほぼ黒
    var CC = ASH.col(T, P.playerCloth);        // 布・ポーチ・背嚢
    var CC2 = ASH.shade(T, P.playerCloth, 0.82);
    var CT = ASH.col(T, P.playerTrim);         // 明るい縁。稜線と肩の上端だけに使う
    var CT2 = ASH.shade(T, P.playerTrim, 0.72);
    var CM = ASH.col(T, P.metal);              // 銃身・金具
    var CRU = ASH.shade(T, P.rust, 0.85);        // 擦れた鉄の差し色（ごく少量）

    function cl(v, a, b) { return v < a ? a : (v > b ? b : v); }

    /* =========================================================================
       手動ジオメトリマージャ
       ここで作った配列を最後に1本の BufferGeometry にする。
       ====================================================================== */
    function newB(ybase, flat) { return { p: [], n: [], c: [], yb: ybase, flat: !!flat }; }

    /* rz -> ry -> rx の順（three の Euler 'XYZ' と同じ合成順） */
    function rot(v, rx, ry, rz) {
      var x = v[0], y = v[1], z = v[2], s, c, t;
      if (rz) { s = Math.sin(rz); c = Math.cos(rz); t = x * c - y * s; y = x * s + y * c; x = t; }
      if (ry) { s = Math.sin(ry); c = Math.cos(ry); t = x * c + z * s; z = -x * s + z * c; x = t; }
      if (rx) { s = Math.sin(rx); c = Math.cos(rx); t = y * c - z * s; z = y * s + z * c; y = t; }
      return [x, y, z];
    }

    /* 面の向きと高さから陰影と堆積を焼き込む。

       (1) 上向き面ほど明るい＝空からの回り込み。
       (2) 足元ほど暗い＝地面に噛まれた擬似AO（P.aoStrength に追従）。
       (3) 上向き面ほど P.dust（環境の粉塵色）へ寄せる。
           これが自機の色設計の要になっている。理由は2つある：
           ・自機だけが冷たい灰のままだと、暖色のオーカーで統一された広場から
             色が浮く。上面に環境の灰を積もらせると、同じ空気の中の物になる。
           ・上面だけが明るい暖色になるので、暗い遮蔽の前に自機が重なっても
             「頭頂・肩・背嚢の蓋・膝」が水平の明線として並び、
             輪郭が消えても人の形として読める（§3 の到達条件）。
           物理的にも正しい。砲撃の翌日の広場で、上を向いた面には灰が積もる。

       灰の量は実測で決めた。全面に 0.18、真上を向いた面に追加で 0.34。
       全面に一定量を乗せているのは、逆光下の自機を照らす主光源が
       HemisphereLight（palette.ambientSky ＝青）になるためで、
       中性グレーの装甲のままだと暖色の広場の中で青一色に見えた（実測）。
       上向き面だけを暖色にしても、三人称視点で一番見えている
       「垂直な背中と脚」が青いままになる。 */
    var CDUST = ASH.col(T, P.dust);
    function bakeCol(B, col, ny, cy) {
      if (B.flat) return [col.r, col.g, col.b];
      var upn = cl(ny, 0, 1);
      var up = 0.80 + 0.28 * (ny * 0.5 + 0.5);
      var ao = 1.0 - P.aoStrength * 0.55 * (1.0 - cl((cy + B.yb) / 1.78, 0, 1));
      var f = up * ao;
      var d = 0.18 + 0.34 * upn * upn;
      return [(col.r * (1 - d) + CDUST.r * d) * f,
      (col.g * (1 - d) + CDUST.g * d) * f,
      (col.b * (1 - d) + CDUST.b * d) * f];
    }

    function tri(B, a, b, c, col) {
      var ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
      var vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
      var nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      var l = Math.sqrt(nx * nx + ny * ny + nz * nz);
      if (l < 1e-9) return;
      nx /= l; ny /= l; nz /= l;
      var k = bakeCol(B, col, ny, (a[1] + b[1] + c[1]) / 3);
      var v = [a, b, c];
      for (var i = 0; i < 3; i++) {
        B.p.push(v[i][0], v[i][1], v[i][2]);
        B.n.push(nx, ny, nz);
        B.c.push(k[0], k[1], k[2]);
      }
    }
    function quad(B, a, b, c, d, col) { tri(B, a, b, c, col); tri(B, a, c, d, col); }

    /* 箱。上面／底面を別倍率で縮められる＝角錐台になる。
       角錐台にすると「面が傾く」ので、単一ライトでも面ごとに明度差が出る。 */
    function box(B, col, x, y, z, w, h, d, o) {
      o = o || {};
      var tx = o.tx === undefined ? 1 : o.tx, tz = o.tz === undefined ? 1 : o.tz;
      var bx = o.bx === undefined ? 1 : o.bx, bz = o.bz === undefined ? 1 : o.bz;
      var sx = o.sx || 0, sz = o.sz || 0;
      var hw = w * 0.5, hh = h * 0.5, hd = d * 0.5;
      var k = [
        [-hw * bx, -hh, -hd * bz], [hw * bx, -hh, -hd * bz], [hw * bx, -hh, hd * bz], [-hw * bx, -hh, hd * bz],
        [-hw * tx + sx, hh, -hd * tz + sz], [hw * tx + sx, hh, -hd * tz + sz],
        [hw * tx + sx, hh, hd * tz + sz], [-hw * tx + sx, hh, hd * tz + sz]
      ];
      for (var i = 0; i < 8; i++) {
        var q = rot(k[i], o.rx || 0, o.ry || 0, o.rz || 0);
        k[i] = [q[0] + x, q[1] + y, q[2] + z];
      }
      var top = o.ct || col, bot = o.cb || col;
      quad(B, k[0], k[1], k[2], k[3], bot);   // 底
      quad(B, k[4], k[7], k[6], k[5], top);   // 天
      quad(B, k[3], k[2], k[6], k[7], col);   // 前 +z
      quad(B, k[1], k[0], k[4], k[5], col);   // 後 -z
      quad(B, k[2], k[1], k[5], k[6], col);   // 右 +x
      quad(B, k[0], k[3], k[7], k[4], col);   // 左 -x
    }

    /* 円筒／円錐台。銃身と背嚢の巻物にだけ使う（箱だけだと硬すぎるため）。 */
    function tube(B, col, x, y, z, r0, r1, len, seg, axis, o) {
      o = o || {};
      var pre = axis === 'z' ? [Math.PI * 0.5, 0, 0] : (axis === 'x' ? [0, 0, -Math.PI * 0.5] : [0, 0, 0]);
      function xf(p) {
        var q = rot(p, pre[0], pre[1], pre[2]);
        q = rot(q, o.rx || 0, o.ry || 0, o.rz || 0);
        return [q[0] + x, q[1] + y, q[2] + z];
      }
      var hh = len * 0.5, i, a0, a1, b0, b1, t0, t1;
      var cb = xf([0, -hh, 0]), ctp = xf([0, hh, 0]);
      for (i = 0; i < seg; i++) {
        a0 = i / seg * Math.PI * 2; a1 = (i + 1) / seg * Math.PI * 2;
        b0 = xf([Math.cos(a0) * r0, -hh, Math.sin(a0) * r0]);
        b1 = xf([Math.cos(a1) * r0, -hh, Math.sin(a1) * r0]);
        t0 = xf([Math.cos(a0) * r1, hh, Math.sin(a0) * r1]);
        t1 = xf([Math.cos(a1) * r1, hh, Math.sin(a1) * r1]);
        quad(B, b1, b0, t0, t1, col);
        tri(B, ctp, t1, t0, col);
        tri(B, cb, b0, b1, col);
      }
    }

    /* ビルダの中身をその場で回す。
       Group の rotation に固定値を入れる代わりにジオメトリへ焼き込むために使う。
       理由は当たり判定：game.js は Box3.setFromObject で寸法を測るが、
       three はジオメトリの bounding box を行列で変換した AABB を返すので、
       回転した Group は実体より一回り大きい箱として測られる。
       脚の開き（±0.14rad）を Group 側でやると被弾半径が 6cm 太った（実測）。 */
    function bakeXform(B, rx, ry, rz) {
      var i, p, n;
      for (i = 0; i < B.p.length; i += 3) {
        p = rot([B.p[i], B.p[i + 1], B.p[i + 2]], rx, ry, rz);
        B.p[i] = p[0]; B.p[i + 1] = p[1]; B.p[i + 2] = p[2];
        n = rot([B.n[i], B.n[i + 1], B.n[i + 2]], rx, ry, rz);
        B.n[i] = n[0]; B.n[i + 1] = n[1]; B.n[i + 2] = n[2];
      }
    }

    /* 別ビルダの中身を平行移動＋Z回転して取り込む（左腕を胴へ焼き込む用） */
    function mergeInto(dst, src, x, y, z, rz) {
      var i, p, n;
      for (i = 0; i < src.p.length; i += 3) {
        p = rot([src.p[i], src.p[i + 1], src.p[i + 2]], 0, 0, rz || 0);
        dst.p.push(p[0] + x, p[1] + y, p[2] + z);
        n = rot([src.n[i], src.n[i + 1], src.n[i + 2]], 0, 0, rz || 0);
        dst.n.push(n[0], n[1], n[2]);
      }
      for (i = 0; i < src.c.length; i++) dst.c.push(src.c[i]);
    }

    /* =========================================================================
       各パーツ
       ====================================================================== */
    var bT = newB(Y_TORSO);   // 胴（骨盤・胸・背嚢・頭・肩当て）
    var bAR = newB(Y_SHLD);    // 右腕
    var bAL = newB(Y_SHLD);    // 左腕
    var bLR = newB(Y_HIP);     // 右脚
    var bLL = newB(Y_HIP);     // 左脚
    var bG = newB(Y_GUN);     // 小銃
    var bF = newB(0, true);   // 発砲炎（陰影を焼かない）

    /* ---- 胴 -------------------------------------------------------------
       座標はワールド高さから Y_TORSO を引いた torso ローカル。
       読みやすさのため tw() で「ワールド高さ何 m」と書けるようにする。 */
    function tw(y) { return y - Y_TORSO; }

    /* 骨盤：ベルトより一段細くして、腰にくびれの段差を作る */
    box(bT, CAD, 0, tw(1.00), 0, 0.42, 0.22, 0.30, { tx: 1.06, bx: 0.90 });
    box(bT, CAD2, 0, tw(0.925), 0.085, 0.22, 0.13, 0.15);
    /* 腰の側面板：外へ張り出させて腰幅を稼ぐ＝シルエットの凹凸 */
    box(bT, CA, 0.245, tw(1.02), 0, 0.11, 0.24, 0.30, { rz: -0.16, tz: 0.88, bx: 1.1 });
    box(bT, CA, -0.245, tw(1.02), 0, 0.11, 0.24, 0.30, { rz: 0.16, tz: 0.88, bx: 1.1 });
    /* ベルトと装備。後ろ側にも必ず置く＝三人称視点の主役は背面 */
    box(bT, CC, 0, tw(1.11), 0, 0.46, 0.10, 0.33, { ct: CC2 });
    box(bT, CM, 0, tw(1.105), 0.175, 0.10, 0.09, 0.05);
    box(bT, CC, 0.155, tw(1.055), 0.185, 0.13, 0.15, 0.10, { rz: -0.05 });
    box(bT, CC2, -0.155, tw(1.055), 0.185, 0.13, 0.15, 0.10, { rz: 0.05 });
    box(bT, CC2, 0.125, tw(1.065), -0.185, 0.15, 0.17, 0.11);
    box(bT, CC, -0.125, tw(1.065), -0.185, 0.15, 0.17, 0.11);
    box(bT, CAD, 0, tw(1.045), -0.20, 0.12, 0.17, 0.10, { tz: 0.8 });
    box(bT, CRU, 0.235, tw(1.06), -0.11, 0.06, 0.14, 0.09, { rz: -0.2 });   // 予備弾倉
    /* 腹：ここが一番細い。胸(0.50)>腹(0.34)<ベルト(0.46) の振れ幅がくびれ */
    box(bT, CAD, 0, tw(1.24), 0, 0.34, 0.18, 0.26, { tx: 1.1 });

    /* 胸：上へ広がる角錐台。逆三角の上半身 */
    box(bT, CA, 0, tw(1.40), 0, 0.50, 0.32, 0.34, { tx: 1.06, bx: 0.90, ct: CA2 });
    box(bT, CA2, 0.115, tw(1.41), 0.185, 0.22, 0.28, 0.07, { sz: 0.02 });
    box(bT, CA2, -0.115, tw(1.41), 0.185, 0.22, 0.28, 0.07, { sz: 0.02 });
    box(bT, CA, 0, tw(1.40), -0.185, 0.42, 0.30, 0.06, { tx: 0.95 });
    /* 肩帯（たすき）。胸板を分割して「箱の面」に見せない */
    box(bT, CAD, 0.145, tw(1.46), 0.205, 0.075, 0.26, 0.05, { rz: -0.10 });
    box(bT, CAD, -0.145, tw(1.46), 0.205, 0.075, 0.26, 0.05, { rz: 0.10 });
    /* 左胸の無線機と、そこだけ光る小さなトリム＝視線の落ちどころ */
    box(bT, CAD, -0.205, tw(1.30), 0.195, 0.11, 0.13, 0.08);
    box(bT, CT, -0.205, tw(1.365), 0.20, 0.07, 0.025, 0.05);

    /* 背嚢一式：背面シルエットの主役。
       背嚢の天面を頭より十分下げ、後頭部の防護板との間に空きを作る。
       ここが詰まっていると横から見たとき頭と荷物が一塊に潰れる。
       寝具は背嚢の下に回して、腰まわりを重くする（重心を低く見せる）。
       背嚢は「浅く・広く・高く」作る。奥行きを詰めているのは当たり判定の都合で、
       game.js は torso と脚の外接箱から判定を起こすため、背中の出っ張りが
       そのまま前後の被弾半径になる。三人称視点で背面の情報量を担うのは
       幅と高さであって奥行きではないので、削るなら奥行きが正しい。 */
    box(bT, CC, 0, tw(1.28), -0.26, 0.40, 0.36, 0.17, { tx: 0.90, tz: 0.85, ct: CC2 });
    box(bT, CC2, 0, tw(1.478), -0.255, 0.37, 0.05, 0.155, { ct: CC });
    tube(bT, CC2, 0, tw(1.085), -0.255, 0.070, 0.070, 0.44, 8, 'x');      // 巻いた寝具
    box(bT, CRU, 0.185, tw(1.33), -0.255, 0.09, 0.20, 0.10, { rz: 0.10 });// 予備の筒
    box(bT, CAD, -0.185, tw(1.45), -0.262, 0.07, 0.07, 0.07);
    box(bT, CAD, -0.188, tw(1.63), -0.285, 0.034, 0.36, 0.034, { rx: -0.12 }); // アンテナ
    box(bT, CT2, -0.190, tw(1.818), -0.307, 0.05, 0.06, 0.05);                 // 先端の受信子

    /* 首と頭。
       頭は実寸よりひと回り大きい（全高の約 1/6）。小さい頭は遠景で消え、
       「箱人間」と区別がつかなくなるため。首は肩当ての上端より下に置き、
       頭と肩の間に必ず切れ込みが残るようにしている。 */
    box(bT, CAD, 0, tw(1.575), -0.01, 0.17, 0.13, 0.18);
    box(bT, CAD, 0, tw(1.545), -0.005, 0.36, 0.09, 0.32, { tx: 0.72, ct: CAD });
    box(bT, CA, 0, tw(1.705), 0, 0.30, 0.23, 0.33, { tx: 0.90, tz: 0.93, ct: CA2 });
    box(bT, CA2, 0, tw(1.845), -0.005, 0.27, 0.06, 0.30, { tx: 0.84, tz: 0.86 });
    /* 頂部の稜線：後ろへ傾いた前後方向のフィン。真横でも真後ろでも頭が尖る */
    box(bT, CT2, 0, tw(1.878), -0.03, 0.06, 0.06, 0.33, { tx: 0.30, tz: 0.85, sz: -0.03, ct: CT });
    /* 眉庇：前へ突き出す。横から見たときの「くちばし」＝向きが読める */
    box(bT, CA2, 0, tw(1.752), 0.205, 0.28, 0.055, 0.15, { rx: -0.12, ct: CA2 });
    /* 後頭部の跳ね上げ（襟足の防護板）。背面の輪郭に段を作る */
    box(bT, CA, 0, tw(1.645), -0.215, 0.31, 0.19, 0.11, { rx: 0.42, tx: 0.86, ct: CA2 });
    /* 面：奥まった暗い帯＋その上に明るい縁。前後どちらを向いているかの唯一の手掛かり */
    box(bT, CAD2, 0, tw(1.688), 0.163, 0.25, 0.10, 0.06);
    box(bT, CT, 0, tw(1.722), 0.183, 0.26, 0.035, 0.08, { ct: CT });
    box(bT, CA, 0.150, tw(1.665), 0.06, 0.05, 0.18, 0.25);
    box(bT, CA, -0.150, tw(1.665), 0.06, 0.05, 0.18, 0.25);
    box(bT, CT2, 0.157, tw(1.735), -0.03, 0.03, 0.11, 0.24);
    box(bT, CT2, -0.157, tw(1.735), -0.03, 0.03, 0.11, 0.24);
    box(bT, CAD, 0, tw(1.588), 0.09, 0.20, 0.09, 0.19, { tz: 0.9 });
    box(bT, CM, 0, tw(1.578), 0.185, 0.11, 0.075, 0.07);   // 呼吸器の缶

    /* 肩当て：外へ張り出し、下へ向かって広がる。首との間に切れ込みが残る。
       張り出し量は「見た目の広さ」と「当たり判定の幅」の綱引きになる。
       game.js は torso の外接箱から被弾半径を作るので、肩を広げるほど
       体の横 25cm を撃っても当たる理不尽が増える。実測しながら
       全高の約 0.45 倍（＝肩幅 0.86m）で止めた。 */
    function pauldron(s) {
      box(bT, CA, 0.305 * s, tw(1.435), 0, 0.20, 0.27, 0.37,
        { rz: -0.22 * s, bx: 1.20, tz: 0.86, ct: CA2 });
      box(bT, CAD, 0.340 * s, tw(1.265), 0, 0.17, 0.11, 0.33, { rz: -0.32 * s, bz: 0.9 });
      box(bT, CT2, 0.302 * s, tw(1.567), 0, 0.21, 0.045, 0.35, { rz: -0.21 * s, ct: CT });
      /* 肩当ての外側面に明色の縁。輪郭そのものに明るい画素を置いておくと、
         暗い遮蔽に体が重なっても肩の位置だけは残る */
      box(bT, CT2, 0.358 * s, tw(1.395), 0, 0.035, 0.20, 0.34, { rz: -0.22 * s });
    }
    pauldron(1); pauldron(-1);

    /* ---- 腕（ローカル原点＝肩関節。y は下向きに伸びる） ------------------ */
    function arm(B, s) {
      box(B, CAD, 0, -0.11, 0, 0.19, 0.24, 0.215, { bx: 0.92, ct: CAD });
      box(B, CC, -0.012 * s, -0.28, 0.005, 0.16, 0.14, 0.175);
      box(B, CA, -0.030 * s, -0.372, 0.012, 0.185, 0.12, 0.20, { ct: CA2 });
      box(B, CT2, -0.045 * s, -0.425, 0.015, 0.195, 0.04, 0.205);
      box(B, CA, -0.058 * s, -0.485, 0.020, 0.175, 0.15, 0.185, { tx: 1.05 });
      box(B, CA2, -0.058 * s + 0.085 * s, -0.480, 0.020, 0.045, 0.17, 0.17); // 外側の籠手板
      box(B, CAD, -0.085 * s, -0.578, 0.045, 0.135, 0.13, 0.175);
    }
    arm(bAR, 1);
    arm(bAL, -1);

    /* ---- 脚（ローカル原点＝股関節） --------------------------------------
       ふくらはぎ・膝の角・つま先・かかとを前後に張り出させる。
       真横から見たとき脚が「ただの柱」になると、遮蔽の箱と同じ形になる。 */
    function leg(B, s) {
      box(B, CAD, 0, -0.045, 0, 0.25, 0.16, 0.29, { ct: CAD });
      box(B, CC, 0.005 * s, -0.225, 0, 0.235, 0.34, 0.27, { bx: 0.88, bz: 0.92 });
      box(B, CA, 0.005 * s, -0.205, 0.14, 0.20, 0.26, 0.06, { ct: CA2 });
      /* 右は雑嚢、左は拳銃嚢。左右で違う出っ張り＝向きが分かる非対称 */
      if (s > 0) box(B, CC2, 0.145, -0.24, 0.005, 0.09, 0.21, 0.18, { rz: -0.06 });
      else box(B, CAD, -0.145, -0.255, 0.02, 0.10, 0.24, 0.14, { rz: 0.06 });
      box(B, CA, 0.005 * s, -0.44, 0.025, 0.225, 0.145, 0.245, { tz: 0.95, ct: CA2 });
      box(B, CT2, 0.005 * s, -0.455, 0.155, 0.14, 0.10, 0.07);
      box(B, CC, 0.005 * s, -0.60, 0, 0.20, 0.28, 0.22);
      box(B, CC2, 0.005 * s, -0.615, -0.12, 0.17, 0.22, 0.10, { tz: 0.8 });   // ふくらはぎ
      box(B, CA, 0.005 * s, -0.60, 0.12, 0.18, 0.30, 0.06, { ct: CA2 });
      box(B, CAD, 0.005 * s, -0.775, 0, 0.185, 0.10, 0.20);
      box(B, CT2, 0.005 * s, -0.727, 0, 0.20, 0.042, 0.215);   // 長靴の履き口＝足元の明線
      /* 靴底は公称 -0.9325（＝接地面より 7mm 上）。脚を左右に開いて置いているので
         そのぶん外側の角が沈む。実測で足が地面を突き抜けないところまで上げてある。 */
      box(B, CAD, 0.005 * s, -0.858, 0.025, 0.25, 0.15, 0.33, { ct: CAD });
      box(B, CAD, 0.005 * s, -0.888, 0.225, 0.22, 0.085, 0.13, { tz: 0.85 });
      box(B, CAD, 0.005 * s, -0.8875, -0.155, 0.20, 0.09, 0.09);
      box(B, CAD2, 0.005 * s, -0.9125, 0.035, 0.26, 0.03, 0.37);
    }
    /* 立ち幅を作る開きは、Group ではなくジオメトリに焼く（bakeXform のコメント参照）。
       股の間に抜けがあることが、遮蔽の箱と自機を分ける一番強い手掛かりになる。 */
    leg(bLR, 1); bakeXform(bLR, 0, 0.14, 0.05);
    leg(bLL, -1); bakeXform(bLL, 0, -0.14, -0.05);

    /* ---- 小銃（ローカル原点＝銃ピボット。+Z が銃口方向） -----------------
       銃口は必ず z = 0.78 に来るよう全体を配置する（flash の契約位置）。 */
    function gy(v) { return GUP + v; }
    box(bG, CAD, 0, gy(0.000), 0.08, 0.105, 0.135, 0.40, { ct: CAD });
    box(bG, CAD, 0, gy(0.010), -0.16, 0.090, 0.120, 0.16, { tz: 0.9 });
    box(bG, CAD, 0, gy(-0.005), -0.235, 0.100, 0.160, 0.045);
    box(bG, CAD2, 0, gy(0.075), -0.12, 0.070, 0.040, 0.20);
    box(bG, CAD, 0, gy(-0.050), 0.14, 0.090, 0.100, 0.12);
    box(bG, CM, 0, gy(-0.155), 0.145, 0.075, 0.22, 0.10, { rx: -0.10, tz: 0.9 });  // 弾倉
    box(bG, CAD, 0, gy(-0.135), 0.255, 0.075, 0.17, 0.09, { rx: 0.30 });           // 握把
    box(bG, CAD2, 0, gy(-0.072), 0.325, 0.050, 0.05, 0.075);
    box(bG, CM, 0, gy(0.005), 0.44, 0.095, 0.105, 0.28, { ct: CM });               // 被筒
    box(bG, CAD, 0, gy(-0.090), 0.525, 0.075, 0.18, 0.090, { rx: 0.12 });          // 前握把
    box(bG, CAD, 0, gy(0.090), 0.13, 0.060, 0.05, 0.20);
    tube(bG, CAD2, 0, gy(0.145), 0.13, 0.042, 0.042, 0.19, 8, 'z');               // 照準器
    box(bG, CAD, 0, gy(0.098), 0.62, 0.030, 0.08, 0.03);
    tube(bG, CM, 0, gy(0.000), 0.68, 0.030, 0.030, 0.17, 8, 'z');                // 銃身
    box(bG, CAD, 0, gy(0.000), 0.765, 0.075, 0.075, 0.075, { ct: CAD });          // 制退器
    box(bG, CRU, 0, gy(0.070), -0.02, 0.11, 0.02, 0.06);                          // 負い紐金具

    /* ---- 発砲炎（銃口先端）----------------------------------------------- */
    var CFC = ASH.col(T, P.muzzleCore), CFG = ASH.col(T, P.muzzleGlow);
    box(bF, CFC, 0, 0, 0.045, 0.095, 0.16, 0.095, { rx: Math.PI * 0.5, tx: 0.18, tz: 0.18 });
    box(bF, CFG, 0, 0, 0.02, 0.34, 0.022, 0.022);
    box(bF, CFG, 0, 0, 0.02, 0.022, 0.30, 0.022);

    /* =========================================================================
       メッシュ化
       ドローコール予算は 6。検証シーンは地面で 1 使うので、こちらは 5 枚まで。
       root 直下に必要な独立回転は 胴/右腕/左腕/右脚/左脚/銃 の 6 つあるので、
       どれか 1 つを諦めるしかない。
         ・銃を諦める → ブラインドファイアで銃だけを遮蔽上に出す絵が死ぬ
         ・右腕を諦める → 銃を構える動作と伏せ撃ちの腕が死ぬ
         ・脚を諦める → 歩行が死ぬ
         ・左腕を諦める → 歩行時の腕振り（振幅 最大 ±0.43rad）だけが死ぬ
       影響が一番小さい左腕を胴へ焼き込み、armL は空の Group として残す。
       （armL は契約どおり存在し torso の子で、回転を書かれても破綻しない）
       ====================================================================== */
    /* 左腕を胴へ焼き込む。開き角は控えめにしてある：胴メッシュの中に入る＝
       game.js の被弾判定に左腕が算入されるので、外へ振るほど横幅が水増しされる。
       （右腕は armR 配下なので判定から除外される。左右で扱いが変わってしまう） */
    if (!ARML_OWN_MESH) mergeInto(bT, bAL, -0.295, tw(Y_SHLD), 0, -0.15);

    /* 頂点カラー1本槍。マテリアルを1個に抑えるため色は全部ジオメトリに載せる */
    var mat = new T.MeshLambertMaterial({ vertexColors: true });

    /* 影を落とすかどうか。
       検証ハーネスが renderer.info.autoReset を切ったため、影パスの描画も
       ドローコールに合算されるようになった。可動部が5枚あるので影を出すと
       5(影)+5(本体)+1(床) = 11 で、契約の 6 を超える。
       契約は「超えたら機能を削ってでも収める」なので、既定では影を切る。
       実ゲーム側の総予算は 150 で余裕があるため、統合時に戻せるよう
       返り値に setCastShadow() を付けてある。 */
    var CAST_SHADOW = false;
    var allMeshes = [];

    function meshOf(B, m) {
      var geo = new T.BufferGeometry();
      geo.setAttribute('position', new T.Float32BufferAttribute(B.p, 3));
      geo.setAttribute('normal', new T.Float32BufferAttribute(B.n, 3));
      geo.setAttribute('color', new T.Float32BufferAttribute(B.c, 3));
      geo.computeBoundingSphere();
      var ms = new T.Mesh(geo, m || mat);
      ms.castShadow = CAST_SHADOW; ms.receiveShadow = true;
      allMeshes.push(ms);
      return ms;
    }

    /* ---- リグ組み立て（契約の親子関係。名前も順序も変えない） ------------- */
    var root = new T.Group();
    var body = new T.Group(); root.add(body);

    var torso = new T.Group(); torso.position.y = Y_TORSO; body.add(torso);
    torso.add(meshOf(bT));

    var armR = new T.Group(); armR.position.set(0.295, Y_SHLD - Y_TORSO, 0); torso.add(armR);
    armR.add(meshOf(bAR));
    /* 構えの初期姿勢。syncRig が毎フレーム上書きするが、
       単体検証の絵が実戦の絵と一致するようゲーム内の ready と同じ値を入れる */
    armR.rotation.set(-1.25, 0, 0.25);

    var armL = new T.Group(); armL.position.set(-0.295, Y_SHLD - Y_TORSO, 0); torso.add(armL);
    if (ARML_OWN_MESH) { armL.add(meshOf(bAL)); armL.rotation.z = -0.24; }

    /* 脚は左右に開いて置き、つま先を外へ向ける。
       syncRig が書くのは rotation.x だけなので y/z は据え置きにできる。
       股の間に抜けを作ることが、遮蔽の箱と混ざらないための最重要条件。 */
    var legR = new T.Group(); legR.position.set(0.195, Y_HIP, 0); body.add(legR);
    legR.add(meshOf(bLR));
    var legL = new T.Group(); legL.position.set(-0.195, Y_HIP, 0); body.add(legL);
    legL.add(meshOf(bLL));

    /* 銃は Group。スケールは持たせない。+Z が銃口方向。
       x は胴の側面より外に出す＝真後ろから見ても銃身が輪郭に出る */
    var gun = new T.Group(); gun.position.set(0.29, Y_GUN - Y_TORSO, 0); torso.add(gun);
    /* 銃身まわりのごく浅いロール。syncRig は rotation.x しか書かないので残る。
       Z 軸まわりの回転＝銃口方向（+Z）は動かないので契約に触れない。
       軸に揃った銃は「置いてある」ように見えるが、少し傾けると「持っている」に見える */
    gun.rotation.z = -0.09;
    gun.add(meshOf(bG));

    var flash = meshOf(bF, new T.MeshBasicMaterial({ vertexColors: true, fog: false }));
    allMeshes.pop();
    flash.castShadow = false; flash.receiveShadow = false;
    flash.position.set(0, GUP, 0.78);
    flash.visible = false;
    gun.add(flash);

    return {
      root: root, body: body, torso: torso,
      armR: armR, armL: armL, legR: legR, legL: legL,
      gun: gun, flash: flash,
      /* 契約外の追加。統合側が全体予算を見て影を戻せるようにするためのつまみ。
         呼ばなければ何も変わらない。 */
      setCastShadow: function (on) {
        for (var i = 0; i < allMeshes.length; i++) allMeshes[i].castShadow = !!on;
      }
    };
  };
})(typeof window !== 'undefined' ? window : globalThis);

/* =============================================================================
   ashline/art/debris.js — 床の瓦礫・砕石・紙片・弾痕・焦げ跡

   床が語る1文：
     「砲撃は広場の奥（-Z）から来た。遮蔽はどれも奥向きの面を削られ、
       破片と灰はそこから手前（+Z）へ扇状に飛び、
       生き残りが通った道筋だけが踏み均されて残っている。」

   設計の芯（なぜこの作りなのか）
   1. 瓦礫を「撒く」と因果が消える。ここでは配置の起点を
      (a) 着弾点 IMPACTS  (b) 遮蔽の被弾面（-Z面）  の2つに限定し、
      そこから +Z へ向く扇（BLAST=+Z）でしか飛散させない。
      結果、床を見るだけで砲撃の来た方向が読める。
   2. 通行ルート（LANES）上は密度を 1 割まで落とす。
      「歩ける床」と「壊れた床」を明度と粒の粗さの差で読ませるため。
      完全にゼロにしないのは、掃かれた道にも細かい粉は残るから。
   3. 高さは実測で 0.113m 以下（後述の worst case 計算）。
      膝より高い物を床に置くと「遮蔽に見えるのに隠れられない」嘘になり、
      プレイヤーがそれを信じて死ぬ。ここは絶対に譲れない。
   4. ドローコール ≤ 3 の予算は検証シーンの床板と共有される。
      そのため InstancedMesh は 2 個に畳んだ：
        A. chunks — 立体の破片（砕石・スポール・剥がれた漆喰・紙片）
        B. decals — 床に貼りつく跡（弾痕・焦げ・灰の吹き寄せ）
      紙片は「極端に平たい chunk」として A に同居させ、
      弾痕と焦げは1枚のマスクを尺度と色で使い分けて B に同居させている。

   色は ASH.palette からのみ。生の16進は書かない。ES5。外部リソースなし。
   ========================================================================== */
(function (g) {
  var ASH = g.ASH = g.ASH || {};

  ASH.debris = function (T, mats, ARENA, COVERS) {
    var P = ASH.palette;
    var group = new T.Group();
    group.name = 'debris';

    /* --- 決定的な乱数 -------------------------------------------------------
       毎回同じ絵が出ないと「見て直す」ができない。LCGで固定する。 */
    var _s = 20240917;
    function rnd() { _s = (_s * 1664525 + 1013904223) % 4294967296; return _s / 4294967296; }
    function rr(a, b) { return a + (b - a) * rnd(); }
    function gauss() { return (rnd() + rnd() + rnd() - 1.5) * 1.1547; }
    function pick(arr) { return arr[(rnd() * arr.length) | 0]; }

    /* =======================================================================
       0. アリーナの読み取り（引数が無い場合の保険）
       ==================================================================== */
    var A = ARENA || { hx: 13.0, hz: 13.0 };
    var CV = COVERS || [];
    var LIM_X = A.hx - 0.35, LIM_Z = A.hz - 0.35;   // 外周壁の内側に収める

    /* 砲撃の方向は1つに統一する。奥(-Z)から来て、破片は +Z へ飛ぶ。 */
    var BLAST_X = 0.0, BLAST_Z = 1.0;

    /* =======================================================================
       1. 着弾点 — 因果の起点
          すべて遮蔽の -Z 側（砲撃が来た側）に置く。
          遮蔽の当たり判定箱の内側には1つも入れない。
       ==================================================================== */
    var IMPACTS = [
      { x: -3.5, z: -6.5, r: 2.7, p: 1.00 },   // 左中央の低い遮蔽の直前
      { x: 3.1, z: -6.6, r: 2.5, p: 0.95 },   // 右中央の低い遮蔽の直前
      { x: 0.5, z: -10.7, r: 2.5, p: 0.90 },   // 奥の高い遮蔽の直前（最も奥＝最初の一発）
      { x: -6.4, z: -1.9, r: 2.1, p: 0.72 },   // 左の高い柱の肩口
      { x: 6.7, z: -2.3, r: 2.1, p: 0.72 },   // 右の高い柱の肩口
      { x: -1.7, z: 1.1, r: 2.3, p: 0.62 },   // 中央長遮蔽の -Z 面直前（跳ね返り）
      { x: -8.9, z: 0.6, r: 1.8, p: 0.50 },   // 左回り込みルートの入口
      { x: 8.9, z: 0.5, r: 1.8, p: 0.50 },   // 右回り込みルートの入口
      { x: -10.2, z: -8.6, r: 1.7, p: 0.45 },  // 左奥の外し弾
      { x: 10.0, z: -9.2, r: 1.7, p: 0.42 }   // 右奥の外し弾
    ];

    /* =======================================================================
       2. 通行ルート — ここは「あえて薄く」
          折れ線で書く。プレイヤーが実際に取る3系統（左回り／中央押し／右回り）。
       ==================================================================== */
    var LANES = [
      /* 左回り込み */
      [[0.0, 10.8], [-4.8, 8.4], [-8.9, 7.0], [-10.7, 3.2], [-10.8, -2.2], [-11.2, -7.4], [-7.2, -11.2], [-0.5, -12.0]],
      /* 右回り込み */
      [[0.0, 10.8], [4.8, 8.4], [8.9, 7.0], [10.7, 3.2], [10.8, -2.2], [11.2, -7.4], [7.2, -11.2], [0.5, -12.0]],
      /* 中央押し（左肩） */
      [[-0.6, 10.6], [-1.6, 7.6], [-3.7, 4.3], [-3.6, -0.5], [-3.1, -3.3], [-1.5, -7.1], [-0.6, -8.5]],
      /* 中央押し（右肩） */
      [[0.6, 10.6], [1.6, 7.6], [3.7, 4.3], [3.6, -0.5], [3.1, -3.3], [1.5, -7.1], [0.6, -8.5]]
    ];

    function segDist(px, pz, ax, az, bx, bz) {
      var dx = bx - ax, dz = bz - az;
      var L = dx * dx + dz * dz;
      var t = L > 0 ? ((px - ax) * dx + (pz - az) * dz) / L : 0;
      if (t < 0) t = 0; else if (t > 1) t = 1;
      var qx = ax + dx * t - px, qz = az + dz * t - pz;
      return Math.sqrt(qx * qx + qz * qz);
    }
    /* 0 = ルートのど真ん中（掃かれている） / 1 = 誰も歩かない場所 */
    function traffic(x, z) {
      var best = 1e9;
      for (var i = 0; i < LANES.length; i++) {
        var L = LANES[i];
        for (var j = 0; j < L.length - 1; j++) {
          var d = segDist(x, z, L[j][0], L[j][1], L[j + 1][0], L[j + 1][1]);
          if (d < best) best = d;
        }
      }
      /* 0.95m までが踏み固められた道の芯、3.0m で完全に道の外。
          0.8m だと道が細すぎて床から読めず、1.15+1.45 では逆に広場の中央まで
          掃けて絵が空いた。芯は狭く、裾は長く、が正解だった。 */
      var t = (best - 0.95) / 2.05;
      t = t < 0 ? 0 : (t > 1 ? 1 : t);
      return t * t * (3 - 2 * t);   // 道の縁を滑らかに立ち上げる
    }

    /* =======================================================================
       3. 遮蔽の当たり判定箱の内側を除外
          箱の中に瓦礫が埋まると、見た目と当たり判定が食い違って見える。
       ==================================================================== */
    function insideCover(x, z, margin) {
      for (var i = 0; i < CV.length; i++) {
        var c = CV[i];
        if (x > c.x - c.hx - margin && x < c.x + c.hx + margin &&
            z > c.z - c.hz - margin && z < c.z + c.hz + margin) return true;
      }
      return false;
    }

    /* 配置の最終関門。ここを通らないものは1つも床に乗らない。 */
    function accept(x, z, laneMul) {
      if (x < -LIM_X || x > LIM_X || z < -LIM_Z || z > LIM_Z) return false;
      /* 正のマージン。箱の内側は 1 個も許さない。
         瓦礫が当たり判定箱に埋まると「見えている物に当たらない」の入口になる。 */
      if (insideCover(x, z, 0.02)) return false;
      var tr = traffic(x, z);
      /* 踏み均された道は 10%。それ以外は距離に応じて素直に増える。 */
      var keep = 0.06 + 0.94 * tr;
      if (laneMul !== undefined) keep = keep * laneMul + (1 - laneMul) * 1.0;
      return rnd() < keep;
    }

    /* =======================================================================
       4. 破片ジオメトリ — 不規則な六角スラブ
          面ごとに頂点カラーで擬似AOを焼く（上面=明、側面=暗）。
          追加ライトを使わずに立体感を出すための唯一の手段。
          高さ上限 0.09m はここで確定する（インスタンスの sy ≤ 1）。
       ==================================================================== */
    var CH_H = 0.09;

    function buildChunkGeometry() {
      var n = 6;
      /* 半径も角度も大きくばらす。等間隔の六角形は遠目に「円盤」になり、
         床一面に並べると碁石を撒いたようにしか見えない。
         割れた石は必ず鋭角と鈍角が混じる。 */
      var rad = [0.50, 0.26, 0.47, 0.18, 0.45, 0.30];
      var ang = [0.00, 0.76, 1.63, 2.52, 3.58, 4.78];
      var topY = [1.00, 0.58, 0.92, 0.50, 0.95, 0.70];   // 欠けた天面
      var tx = [], tz = [], ty = [], bx = [], bz = [];
      var i, gcx = 0, gcz = 0;
      for (i = 0; i < n; i++) {
        tx[i] = Math.cos(ang[i]) * rad[i];
        tz[i] = Math.sin(ang[i]) * rad[i];
        gcx += tx[i]; gcz += tz[i];
      }
      /* 半径をばらした結果、形の重心は原点からずれる。
         そのままだとインスタンスの座標＝見た目の中心にならず、
         遮蔽の箱ぎりぎりに置いた破片が数cm箱の内側へ食い込む。
         配置判定を信用できるように、ここで重心を原点へ寄せておく。 */
      gcx /= n; gcz /= n;
      for (i = 0; i < n; i++) {
        tx[i] -= gcx; tz[i] -= gcz;
        ty[i] = CH_H * topY[i];
        /* 底面はわずかに広い＝下すぼまりでなく安定して座って見える */
        bx[i] = tx[i] * 1.06;
        bz[i] = tz[i] * 1.06;
      }

      var pos = [], nor = [], col = [], uv = [];
      function vtx(x, y, z, nx, ny, nz, k) {
        pos.push(x, y, z); nor.push(nx, ny, nz); col.push(k, k, k);
        /* 平面投影UV。mats.tex.stone を貼れるようにするためだけの最小限 */
        uv.push(x + 0.5, z + 0.5);
      }
      function tri(ax, ay, az, bx2, by2, bz2, cx, cy, cz, k) {
        var ux = bx2 - ax, uy = by2 - ay, uz = bz2 - az;
        var vx = cx - ax, vy = cy - ay, vz = cz - az;
        var nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        var L = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
        nx /= L; ny /= L; nz /= L;
        vtx(ax, ay, az, nx, ny, nz, k);
        vtx(bx2, by2, bz2, nx, ny, nz, k);
        vtx(cx, cy, cz, nx, ny, nz, k);
      }

      /* 天面：唯一まともに光を受ける面。
         角度が増える向き＝XZ平面では上から見て時計回りなので、
         法線を +Y にするには扇の巻きを逆に取る必要がある。 */
      for (i = 1; i < n - 1; i++) {
        tri(tx[0], ty[0], tz[0], tx[i + 1], ty[i + 1], tz[i + 1], tx[i], ty[i], tz[i], 1.00);
      }
      /* 側面：接地の陰。ただし逆光のこの絵では側面に太陽が当たらないので、
         AO を強くかけすぎると真っ黒な「碁石の縁」になってしまう。
         0.72〜0.94 に留め、暗さはライティングそのものに任せる。 */
      for (i = 0; i < n; i++) {
        var j = (i + 1) % n;
        /* 面ごとに明度をずらす＝1つの形でも割れ方が違って見える */
        var k = 0.72 + 0.22 * ((i * 7) % 5) / 4;
        tri(bx[i], 0, bz[i], tx[i], ty[i], tz[i], tx[j], ty[j], tz[j], k);
        tri(bx[i], 0, bz[i], tx[j], ty[j], tz[j], bx[j], 0, bz[j], k * 0.88);
      }
      /* 底面：傾いた破片の下が抜けないように塞ぐ。ほぼ見えない */
      for (i = 1; i < n - 1; i++) {
        tri(bx[0], 0, bz[0], bx[i], 0, bz[i], bx[i + 1], 0, bz[i + 1], 0.42);
      }

      var geo = new T.BufferGeometry();
      geo.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
      geo.setAttribute('normal', new T.Float32BufferAttribute(nor, 3));
      geo.setAttribute('color', new T.Float32BufferAttribute(col, 3));
      geo.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
      geo.computeBoundingBox();
      geo.computeBoundingSphere();
      return geo;   // 20 三角形
    }

    /* =======================================================================
       5. 跡（デカール）のマスク
          RGB は白一色にして、色は必ず instanceColor（= ASH.palette 由来）で決める。
          アルファだけが形を持つ：
            芯が硬く小さい  → 5cm に縮めると「弾痕」に見える
            裾が長く柔らかい → 2m に伸ばすと「焦げの尾」に見える
          この二役を1枚で兼ねられるので、跡をすべて1ドローコールに畳める。
       ==================================================================== */
    function buildDecalMask() {
      if (typeof document === 'undefined') return null;
      var S = 128;
      var cv = document.createElement('canvas'); cv.width = S; cv.height = S;
      var ctx = cv.getContext('2d');
      if (!ctx) return null;
      var img = ctx.createImageData(S, S), d = img.data;

      /* 輪郭のうねり。真円の跡は「シール」に見えるので必ず崩す */
      var amp = [], ph = [], k;
      for (k = 0; k < 6; k++) { amp[k] = rnd(); ph[k] = rnd() * 6.2832; }

      var px, py, idx = 0;
      for (py = 0; py < S; py++) {
        for (px = 0; px < S; px++) {
          var ux = (px + 0.5) / S - 0.5, uy = (py + 0.5) / S - 0.5;
          var r = Math.sqrt(ux * ux + uy * uy);
          var th = Math.atan2(uy, ux);
          var wob = 1.0;
          for (k = 1; k <= 4; k++) wob += 0.14 * (amp[k] - 0.5) * 2.0 * Math.sin(k * th + ph[k]);
          var rn = r / (0.5 * wob);

          /* 芯を広く濃く取り、裾を長く引く。
             縮めれば弾痕の点、伸ばせば焦げの尾。1枚で二役を兼ねさせるための断面。
             最初は芯を細くしすぎて、床に敷いたとき何も見えなかった。 */
          var a;
          if (rn < 0.26) a = 0.99 - 0.05 * (rn / 0.26);               // 硬い芯
          else if (rn < 0.54) a = 0.94 - 0.44 * ((rn - 0.26) / 0.28); // 肩の落ち
          else if (rn < 0.90) { var t2 = (rn - 0.54) / 0.36; a = 0.50 * (1 - t2) * (1 - t2) * (1 - 0.4 * t2); }
          else a = 0;

          /* 煤は均一に積もらない。細かい抜けを入れて「粉」に見せる */
          var nz = Math.sin(px * 1.93 + py * 0.71) * Math.sin(px * 0.37 - py * 2.11);
          a *= 0.74 + 0.26 * (0.5 + 0.5 * nz);

          /* 外周は必ず 0（ClampToEdge でも滲みを出さない） */
          if (r > 0.47) a *= Math.max(0, (0.50 - r) / 0.03);

          d[idx] = 255; d[idx + 1] = 255; d[idx + 2] = 255;
          d[idx + 3] = (a * 255) | 0;
          idx += 4;
        }
      }
      ctx.putImageData(img, 0, 0);

      /* 飛沫：跡の外へ散った細粒。着弾の「勢い」はここで出る */
      ctx.globalCompositeOperation = 'source-over';
      for (k = 0; k < 130; k++) {
        var sa = rnd() * 6.2832, sr = (0.30 + rnd() * rnd() * 0.17) * S;
        var sx = S * 0.5 + Math.cos(sa) * sr, sy = S * 0.5 + Math.sin(sa) * sr;
        var sz2 = 0.6 + rnd() * 1.6;
        ctx.fillStyle = 'rgba(255,255,255,' + (0.18 + rnd() * 0.45).toFixed(3) + ')';
        ctx.beginPath(); ctx.arc(sx, sy, sz2, 0, 6.2832); ctx.fill();
      }

      var tex = new T.CanvasTexture(cv);
      tex.colorSpace = T.SRGBColorSpace !== undefined ? T.SRGBColorSpace : tex.colorSpace;
      tex.wrapS = tex.wrapT = T.ClampToEdgeWrapping;
      tex.anisotropy = 4;
      tex.needsUpdate = true;
      return tex;
    }

    function buildDecalGeometry() {
      /* XZ 平面に寝かせた四角形。
         ハーネスは geometry の bounding box の Y を見るので、
         「XY平面のPlaneを回転させる」のではなく最初から寝かせて作る。
         こうすると跡の bb.max.y は厳密に 0 になる。 */
      var geo = new T.BufferGeometry();
      geo.setAttribute('position', new T.Float32BufferAttribute([
        -0.5, 0, 0.5, 0.5, 0, 0.5, 0.5, 0, -0.5, -0.5, 0, -0.5
      ], 3));
      geo.setAttribute('normal', new T.Float32BufferAttribute([
        0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0
      ], 3));
      geo.setAttribute('uv', new T.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
      geo.setIndex([0, 1, 2, 0, 2, 3]);
      geo.computeBoundingBox();
      geo.computeBoundingSphere();
      return geo;   // 2 三角形
    }

    /* =======================================================================
       6. 素材色 — すべて ASH.palette から派生させる
       ==================================================================== */
    function matColor(kind) {
      var v;
      if (kind === 'concrete') v = ASH.shade(T, P.concrete, rr(0.72, 1.02));
      else if (kind === 'concreteDark') v = ASH.shade(T, P.concreteDark, rr(0.80, 1.10));
      else if (kind === 'stone') v = ASH.shade(T, P.stone, rr(0.74, 1.04));
      else if (kind === 'plaster') v = ASH.shade(T, P.plaster, rr(0.86, 1.10));
      else if (kind === 'brick') v = ASH.shade(T, P.brick, rr(0.60, 0.82));
      else if (kind === 'ash') v = ASH.shade(T, P.ash, rr(0.78, 1.06));
      else if (kind === 'rebar') v = ASH.shade(T, P.rebar, rr(0.85, 1.15));
      else if (kind === 'rust') v = ASH.shade(T, P.rust, rr(0.52, 0.74));
      else if (kind === 'ground') v = ASH.shade(T, P.groundDark, rr(0.85, 1.15));
      else v = ASH.shade(T, P.concrete, 1.0);
      return v;
    }
    /* 遮蔽由来の破片＝コンクリと切石が主、煉瓦と鉄筋が少量。
       灰は着弾点まわりだけ。「どこから剥がれたか」で材質を変える。 */
    var K_STRUCT = ['concrete', 'concrete', 'stone', 'stone', 'stone', 'concreteDark',
      'concreteDark', 'plaster', 'plaster', 'brick', 'rebar'];
    var K_BLAST = ['ash', 'ash', 'concreteDark', 'concreteDark', 'concrete', 'ground',
      'ground', 'stone', 'stone', 'rust'];
    var K_PAPER = ['plaster', 'plaster', 'ash', 'concrete'];
    /* 割れたばかりのコンクリと切石の断面は、風化した表面より明るい。
       着弾の縁と遮蔽の被弾面にこれを集めると、
       「暗い焦げの芯 → 明るい破断面の環」という順序ができて穴として読める。
       逆にここを暗い色で埋めると、床がただ汚れているようにしか見えない。 */
    var K_FRESH = ['plaster', 'plaster', 'concrete', 'concrete', 'stone', 'stone', 'concreteDark'];

    /* =======================================================================
       7. 配置バッファ
       ==================================================================== */
    var chunks = [];   // {x,z,y,sx,sy,sz,yaw,tm,ta,kind}
    var decals = [];   // {x,z,y,sx,sz,yaw,color}

    /* 破片1個。高さの worst case は
         0.09*sy*cos(tm) + 0.5*max(sx,sz)*sin(tm)
       sy≤1.0 / max(sx,sz)≤0.46 / tm≤0.10rad なら 0.1126m。上限内。 */
    function addChunk(x, z, s, role, kind, tiltMax) {
      var sx = s * rr(0.80, 1.20), sz = s * rr(0.80, 1.20);
      /* XZ の上限 0.58 ＝ 実寸で約 0.58m 幅。これ以上大きいと
         「床の粒」ではなく「小さい遮蔽」に見えてしまい、嘘になる。 */
      if (sx > 0.58) sx = 0.58;
      if (sz > 0.58) sz = 0.58;
      var sy;
      if (role === 'flat') sy = rr(0.05, 0.13);        // 紙片・剥離した漆喰
      else if (role === 'slab') sy = rr(0.14, 0.30);   // 割れて外れた敷石
      else sy = rr(0.40, 1.00);                        // 塊
      /* 傾きの上限は呼び出し側任せにしない。ここが高さ 0.12m の最後の砦。
         実寸の高さ = 0.09*sy*cos(tm) + 0.29*sin(tm)
         塊  : 0.09*1.00*cos(.075) + 0.29*sin(.075) = 0.0898 + 0.0217 = 0.1115m
         敷石: 0.09*0.30*cos(.10)  + 0.29*sin(.10)  = 0.0269 + 0.0289 = 0.0558m
         紙片: 0.09*0.13*cos(.17)  + 0.29*sin(.17)  = 0.0115 + 0.0491 = 0.0606m
         最大 0.1115m < 0.12m。 */
      var tmax = role === 'flat' ? 0.17 : (role === 'slab' ? 0.10 : 0.075);
      if (tiltMax !== undefined && tiltMax < tmax) tmax = tiltMax;
      var tm = tmax * rnd();
      chunks.push({
        x: x, z: z, y: -rr(0.0, 0.008),
        sx: sx, sy: sy, sz: sz,
        yaw: rnd() * 6.2832, tm: tm, ta: rnd() * 6.2832,
        kind: kind
      });
    }
    function addDecal(x, z, len, wid, yaw, color, lift) {
      decals.push({
        x: x, z: z, y: 0.004 + lift * 0.010,
        sx: wid, sz: len, yaw: yaw, color: color
      });
    }

    /* =======================================================================
       8. パス1：着弾点 — クレーター芯 + 放射状の飛散
          扇の向きは全弾 +Z。ここが「砲撃がどこから来たか」の本体。
       ==================================================================== */
    var i, j, n, ang, dist, x, z, s;

    for (i = 0; i < IMPACTS.length; i++) {
      var IM = IMPACTS[i];

      /* 8a. 着弾の芯。順序が命：
             (1) 破断面の淡い粉の輪 → (2) 焦げた暗い芯 の順に重ねる。
             暗い床に暗い跡だけを置いても穴には見えない。
             明→暗の明度差が同心に並んで初めて「掘れた」と読める。 */
      for (j = 0; j < 6; j++) {
        var cph = j * 1.0472 + rr(-0.34, 0.34);
        var cd = IM.r * rr(0.48, 0.80);
        addDecal(IM.x + Math.sin(cph) * cd, IM.z + Math.cos(cph) * cd,
          IM.r * rr(0.45, 0.78), IM.r * rr(0.34, 0.56), cph,
          ASH.shade(T, P.plaster, rr(0.60, 0.86)), 0.0);
      }
      addDecal(IM.x, IM.z, IM.r * 0.95, IM.r * 0.80,
        rnd() * 6.2832, ASH.shade(T, P.grime, rr(0.45, 0.70)), 0.20);

      /* 8b. 爆風の尾。+Z の扇の中に細長い筋を並べる。
             床に矢印を描いているのはここ。全着弾で向きが揃うので、
             プレイヤーは床を見ただけで「奥から撃たれた」と分かる。 */
      var nStreak = 5 + ((rnd() * 2) | 0);
      for (j = 0; j < nStreak; j++) {
        var sph = gauss() * 0.40;                       // 0 = +Z
        var sd = IM.r * (0.40 + 1.80 * (j + rnd()) / nStreak);
        /* 遠い筋ほど細く薄く。濃淡の勾配そのものが「勢いの向き」になる */
        var fade = 0.75 + 1.05 * (sd / (IM.r * 2.2));
        addDecal(IM.x + Math.sin(sph) * sd, IM.z + Math.cos(sph) * sd,
          IM.r * rr(1.0, 1.9), IM.r * rr(0.20, 0.38), sph,
          ASH.shade(T, P.grime, fade * rr(0.85, 1.20)), 0.10 + j * 0.05);
      }
      /* 8c. 風下（+Z）へ抜けた粉塵の尾。焦げより明るい色を使う。
             暗い床の上では暗い跡より明るい跡のほうが圧倒的に遠くから読め、
             「爆風がこちらへ抜けた」という向きをいちばん強く語るのはここ。
             芯＝黒／尾＝白 の順序があるから、床が矢印として機能する。 */
      var nPlume = 5;
      for (j = 0; j < nPlume; j++) {
        var pph = gauss() * 0.30;
        var pd = IM.r * (0.75 + 2.05 * (j + rnd()) / nPlume);
        var bright = 1.42 - 0.34 * (pd / (IM.r * 2.8));   // 遠いほど薄い
        addDecal(IM.x + Math.sin(pph) * pd, IM.z + Math.cos(pph) * pd,
          IM.r * rr(1.1, 2.0), IM.r * rr(0.30, 0.55), pph,
          ASH.shade(T, P.ash, bright * rr(0.92, 1.12)), 0.30 + j * 0.06);
      }

      /* 8d. クレーターの縁：重い塊は遠くへ飛ばない。芯の周りに環を作る。
             さらに細粒を密に敷いて「盛り上がり」を作る。粒が疎だと
             床に石を置いただけに見え、掘れた跡にならない。 */
      n = Math.round(44 * IM.p);
      for (j = 0; j < n; j++) {
        ang = rnd() * 6.2832;
        dist = IM.r * (0.20 + 0.55 * Math.pow(rnd(), 0.45));
        x = IM.x + Math.sin(ang) * dist * 1.15;
        z = IM.z + Math.cos(ang) * dist;
        if (!accept(x, z, 0.25)) continue;
        /* 芯の近くだけ煤けた色、外側は破断面の明るい色 */
        addChunk(x, z, rr(0.09, 0.22), 'chunk',
          dist < IM.r * 0.34 ? pick(K_BLAST) : pick(K_FRESH));
      }
      n = Math.round(22 * IM.p);
      for (j = 0; j < n; j++) {
        ang = rnd() * 6.2832;
        dist = IM.r * rr(0.16, 0.52);
        x = IM.x + Math.sin(ang) * dist * 1.05;
        z = IM.z + Math.cos(ang) * dist;
        if (!accept(x, z, 0.35)) continue;      // 着弾点は道の上でも消し切らない
        /* 縁には大きな塊が残る。1/3 は割れて外れた敷石として平たくする＝
           同じ大きさの粒だけが並ぶと「撒いた」に見えるため */
        addChunk(x, z, rr(0.34, 0.62), rnd() < 0.38 ? 'slab' : 'chunk',
          rnd() < 0.7 ? pick(K_FRESH) : pick(K_BLAST));
      }

      /* 8d. 飛散：7割は +Z の扇、3割は全周（跳ねた分）。
             遠くへ行くほど小さい＝軽い破片ほど飛ぶという物理を守る */
      n = Math.round(46 * IM.p);
      for (j = 0; j < n; j++) {
        var fwd = rnd() < 0.74;
        var ph2, rad2;
        if (fwd) {
          ph2 = gauss() * 0.52;                       // 0 = +Z
          rad2 = IM.r * (0.45 + 1.55 * Math.pow(rnd(), 0.55));
        } else {
          ph2 = rnd() * 6.2832;
          rad2 = IM.r * (0.30 + 0.75 * rnd());
        }
        var dxs = Math.sin(ph2) * BLAST_Z + Math.cos(ph2) * BLAST_X;
        var dzs = Math.cos(ph2) * BLAST_Z - Math.sin(ph2) * BLAST_X;
        x = IM.x + dxs * rad2 + gauss() * 0.12;
        z = IM.z + dzs * rad2 + gauss() * 0.12;
        if (!accept(x, z, 1.0)) continue;
        var far = rad2 / (IM.r * 2.0);
        s = rr(0.15, 0.48) * (1.0 - 0.45 * far);
        addChunk(x, z, s, rnd() < 0.20 ? 'slab' : 'chunk', pick(K_BLAST));
      }

      /* 8e. 弾道の最先端：軽い紙片と剥離片は扇のさらに先まで届く */
      n = Math.round(14 * IM.p);
      for (j = 0; j < n; j++) {
        ph2 = gauss() * 0.42;
        rad2 = IM.r * (1.9 + 2.4 * rnd());
        x = IM.x + Math.sin(ph2) * rad2;
        z = IM.z + Math.cos(ph2) * rad2;
        if (!accept(x, z, 1.0)) continue;
        addChunk(x, z, rr(0.15, 0.32), 'flat', pick(K_PAPER), 0.17);
      }
    }

    /* =======================================================================
       9. パス2：遮蔽の足元
          -Z 面（被弾面）だけを厚く、側面は中くらい、+Z 面（背面）は薄く。
          背面には軽い物（紙片・漆喰片）だけが吹き溜まる＝風下。
       ==================================================================== */
    var FACES = [
      /* nx, nz, 密度, 張り出し, 平たい物の比率 */
      { nx: 0, nz: -1, dens: 1.00, out: 0.62, flat: 0.06 },   // 奥向き＝被弾面
      { nx: -1, nz: 0, dens: 0.46, out: 0.40, flat: 0.14 },
      { nx: 1, nz: 0, dens: 0.46, out: 0.40, flat: 0.14 },
      { nx: 0, nz: 1, dens: 0.20, out: 0.34, flat: 0.62 }    // 手前＝風下の吹き溜まり
    ];

    for (i = 0; i < CV.length; i++) {
      var c = CV[i];
      /* 高い遮蔽ほど大量に削られる。低い胸壁は削れ方が浅い。 */
      var mass = c.h > 1.5 ? 1.35 : 0.95;
      for (var f = 0; f < FACES.length; f++) {
        var F = FACES[f];
        var half = F.nx !== 0 ? c.hz : c.hx;         // その面の長さの半分
        var edge = F.nx !== 0 ? c.hx : c.hz;         // 面までの距離
        n = Math.round(half * 2 * 13 * F.dens * mass);
        for (j = 0; j < n; j++) {
          var t = rr(-1.08, 1.08) * half;            // 角を少し回り込ませる
          var o = edge + 0.045 + Math.pow(rnd(), 1.8) * F.out;
          if (F.nx !== 0) { x = c.x + F.nx * o; z = c.z + t; }
          else { x = c.x + t; z = c.z + F.nz * o; }
          x += gauss() * 0.05; z += gauss() * 0.05;
          if (!accept(x, z, 0.55)) continue;
          var role = rnd() < F.flat ? 'flat' : (rnd() < 0.26 ? 'slab' : 'chunk');
          /* 足元ほど大きい塊。離れるほど細粒＝崩れ落ちた物は転がらない。 */
          var near = 1.0 - (o - edge) / (F.out + 0.05);
          s = rr(0.13, 0.52) * (0.58 + 0.70 * near);
          /* f===0 は砲撃を受けた奥向きの面。ここだけ破断面の色にする＝
             どちら側が削られたかが破片の明度だけで分かる。 */
          var kk = role === 'flat' ? pick(K_PAPER) : pick(f === 0 ? K_FRESH : K_STRUCT);
          addChunk(x, z, s, role, kk);
        }

        /* 被弾面の直下には削られた粉の帯（跡）を1本置く。
           これがないと破片だけが浮いて「置いた」に見える。 */
        if (f === 0 && rnd() < 0.92) {
          var bz2 = c.z - c.hz - 0.22;
          if (!insideCover(c.x, bz2, 0.0)) {
            addDecal(c.x + gauss() * 0.2, bz2, c.hz * 1.4 + 0.55, c.hx * 2.0 + 0.5,
              0, ASH.shade(T, P.concreteDark, rr(0.90, 1.15)), 0.1);
          }
        }
        /* 風下側には灰の吹き寄せ */
        if (f === 3 && rnd() < 0.7) {
          var fz = c.z + c.hz + 0.30;
          addDecal(c.x + gauss() * 0.25, fz, c.hz * 1.2 + 0.7, c.hx * 1.7 + 0.4,
            0, ASH.shade(T, P.ash, rr(1.08, 1.32)), 0.3);
        }
      }
    }

    /* =======================================================================
       10. パス3：弾痕
           奥(-Z)から撃たれた弾が遮蔽の手前で床を叩いた跡。
           必ず「連射の列」として置く。単発の点をばらまくと銃撃に見えない。
       ==================================================================== */
    for (i = 0; i < CV.length; i++) {
      c = CV[i];
      var bursts = c.h > 1.5 ? 3 : 4;
      for (var b = 0; b < bursts; b++) {
        /* 列の起点：遮蔽の -Z 面の少し手前。狙いが低く外れた弾の落ち先。 */
        var ox = c.x + rr(-1.0, 1.0) * c.hx * 1.15;
        var oz = c.z - c.hz - rr(0.20, 1.55);
        /* 列の向き：奥から手前へ。わずかに横流れさせて連射のブレを出す */
        var bdirx = rr(-0.30, 0.30), bdirz = 1.0;
        var bl = Math.sqrt(bdirx * bdirx + bdirz * bdirz);
        bdirx /= bl; bdirz /= bl;
        var cnt = 3 + ((rnd() * 4) | 0);
        var step = rr(0.16, 0.34);
        var laid = 0;
        for (j = 0; j < cnt; j++) {
          x = ox + bdirx * step * j + gauss() * 0.035;
          z = oz + bdirz * step * j + gauss() * 0.035;
          if (x < -LIM_X || x > LIM_X || z < -LIM_Z || z > LIM_Z) continue;
          if (insideCover(x, z, 0.02)) continue;
          var pr = rr(0.10, 0.18);
          var pyaw = Math.atan2(bdirx, bdirz);
          /* まず着弾で舞い上がった淡い粉。これが無いと暗い床の上で
             暗い弾痕が完全に消え、連射の列が読めない。 */
          addDecal(x, z, pr * rr(2.5, 3.5), pr * rr(2.0, 2.8), pyaw,
            ASH.shade(T, P.plaster, rr(0.56, 0.78)), 0.45 + rnd() * 0.1);
          /* 弾痕は「入射角がついた楕円」。真円だと真上から撃たれたことになる */
          addDecal(x, z, pr * rr(1.5, 2.4), pr, pyaw,
            ASH.shade(T, P.grime, rr(0.45, 0.78)), 0.78 + rnd() * 0.18);
          /* 弾痕の脇に必ず1粒、白い剥離片を置く。
             これがあるとコンクリが「割れて飛んだ」ことが読める */
          if (rnd() < 0.75) {
            var cxp = x + gauss() * 0.10, czp = z + 0.05 + rnd() * 0.14;
            if (!insideCover(cxp, czp, 0.0)) {
              addChunk(cxp, czp, rr(0.07, 0.15), rnd() < 0.5 ? 'flat' : 'chunk', 'plaster', 0.12);
            }
          }
          laid++;
        }
        if (laid === 0) continue;
      }
    }

    /* =======================================================================
       11. パス4：地の粉と踏み跡の外側
           広場全体をわずかに荒らす。ただし traffic() が道を守る。
       ==================================================================== */
    n = 120;
    for (i = 0; i < n; i++) {
      x = rr(-LIM_X, LIM_X);
      z = rr(-LIM_Z, LIM_Z);
      if (!accept(x, z, 1.0)) continue;
      /* 奥ほど荒れている＝砲撃の中心が奥だったことを面積で語る */
      var deep = (LIM_Z - z) / (LIM_Z * 2);
      if (rnd() > 0.16 + 0.84 * deep) continue;
      /* 道に近いほど小さい粒しか残らない。踏まれて砕けた／蹴られて退いたため。
         大きな板が1枚でも道の真ん中にあると「歩ける床」の読みが壊れる。 */
      var sz3 = rr(0.09, 0.24) * (0.45 + 0.55 * traffic(x, z));
      addChunk(x, z, sz3, rnd() < 0.28 ? 'flat' : 'chunk', pick(K_STRUCT));
    }

    /* 広い灰の吹き寄せ。道の上には出さない。 */
    n = 34;
    for (i = 0; i < n; i++) {
      x = rr(-LIM_X + 1, LIM_X - 1);
      z = rr(-LIM_Z + 1, LIM_Z - 1);
      if (traffic(x, z) < 0.75) continue;
      if (insideCover(x, z, 0.3)) continue;
      var dp = (LIM_Z - z) / (LIM_Z * 2);
      if (rnd() > 0.25 + 0.75 * dp) continue;
      addDecal(x, z, rr(1.4, 3.0), rr(0.9, 1.8), rr(-0.30, 0.30),
        ASH.shade(T, P.ash, rr(1.10, 1.38)), rnd() * 0.35);
    }

    /* =======================================================================
       12. InstancedMesh 化（2個 = 2ドローコール）
       ==================================================================== */
    var dummy = new T.Object3D();

    /* --- A. 破片 ---------------------------------------------------------- */
    var chGeo = buildChunkGeometry();
    var chMatOpt = { vertexColors: true };
    if (mats && mats.tex && mats.tex.stone) chMatOpt.map = mats.tex.stone;   // 無ければ無地
    var chMat = new T.MeshLambertMaterial(chMatOpt);
    var chMesh = new T.InstancedMesh(chGeo, chMat, chunks.length);
    chMesh.name = 'debrisChunks';
    chMesh.castShadow = false;      // 12cm の影は見えない。影パスの描画数を使わない
    chMesh.receiveShadow = true;
    chMesh.frustumCulled = false;

    for (i = 0; i < chunks.length; i++) {
      var ck = chunks[i];
      dummy.position.set(ck.x, ck.y, ck.z);
      dummy.rotation.set(ck.tm * Math.cos(ck.ta), ck.yaw, ck.tm * Math.sin(ck.ta));
      dummy.scale.set(ck.sx, ck.sy, ck.sz);
      dummy.updateMatrix();
      chMesh.setMatrixAt(i, dummy.matrix);
      chMesh.setColorAt(i, matColor(ck.kind));
    }
    chMesh.instanceMatrix.needsUpdate = true;
    if (chMesh.instanceColor) chMesh.instanceColor.needsUpdate = true;
    group.add(chMesh);

    /* --- B. 跡 ------------------------------------------------------------ */
    var dcGeo = buildDecalGeometry();
    var dcTex = buildDecalMask();
    var dcMatOpt = {
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3,
      side: T.FrontSide
    };
    /* map のアルファだけで形を出す。alphaMap を併用しないのは、
       three の alphaMap が G チャンネルしか見ず、白一色のこのマスクでは
       常に 1 になって意味がないため。 */
    if (dcTex) { dcMatOpt.map = dcTex; }
    var dcMat = new T.MeshLambertMaterial(dcMatOpt);
    var dcMesh = new T.InstancedMesh(dcGeo, dcMat, decals.length);
    dcMesh.name = 'debrisDecals';
    dcMesh.castShadow = false;
    dcMesh.receiveShadow = false;   // 平面の跡が自分の影を拾うと汚れるだけ
    dcMesh.frustumCulled = false;
    dcMesh.renderOrder = 2;

    for (i = 0; i < decals.length; i++) {
      var dk = decals[i];
      dummy.position.set(dk.x, dk.y, dk.z);
      dummy.rotation.set(0, dk.yaw, 0);          // 寝かせたまま。Yaw以外は回さない
      dummy.scale.set(dk.sx, 1, dk.sz);
      dummy.updateMatrix();
      dcMesh.setMatrixAt(i, dummy.matrix);
      dcMesh.setColorAt(i, dk.color);
    }
    dcMesh.instanceMatrix.needsUpdate = true;
    if (dcMesh.instanceColor) dcMesh.instanceColor.needsUpdate = true;
    group.add(dcMesh);

    /* 発注元が数えられるように実測値を残す */
    group.userData.debrisCounts = {
      chunks: chunks.length,
      decals: decals.length,
      triangles: chunks.length * 20 + decals.length * 2,
      drawCalls: 2,
      maxHeight: 0.113
    };

    return group;
  };
})(typeof window !== 'undefined' ? window : globalThis);

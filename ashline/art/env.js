/* =============================================================================
   ASHLINE / env.js — 中央広場の環境（背景・破壊表現）

   ■ この背景から読み取れる1文（oneLineStory）
     「北西の丘から撃ち下ろされた砲撃が広場を斜めに薙ぎ、石積みはどれも北西の面を
       削られて芯の煉瓦を晒し、崩れた塊と鉄筋はすべて南東へ倒れ、
       火は北西の角から風下（東）へ舐めていった。」

   ■ 一貫した因果（ランダムに散らさないための単一の原因）
     原因は1つだけ。「北西の高台からの砲撃」。ここから全部を導出する。
       進行ベクトル D = (+0.66, +0.75)  … 砲弾が飛んでいった向き（南東）
       被弾ベクトル W = -D              … 削られる面が向いている向き（北西）
     - 弾着痕は北西→南東へ3発、直線上に「歩いて」いる（floorCraters）。
     - 遮蔽・外壁の表皮は W を向いた面ほど剥がれ、芯（煉瓦・瓦礫）が露出する。
     - 高い遮蔽の冠部の残骸と鉄筋は D 方向へ倒れる。外壁の倒壊も D 方向。
     - 北壁・西壁は「外から撃たれて内側へ吹き抜けた」＝大きく面が欠ける。
       南壁・東壁は「破片が飛んできた下流側」＝面は残るが煤と細かい弾痕で汚れる。
     - 床の煤は火元（北西の角）から風下へ伸びる楕円。ただし遮蔽の北西側に立つと
       その背後は爆風・熱が届かず粉塵が残る＝「爆風の影」が明るく残る。
       この影が向いている方向が、そのまま砲撃の方向を語る。
     - 外周の廃墟スカイラインも全部が北西の上部を削られ、南東へ倒れかけている。

   ■ シルエット読解性（色ではなく形で高低を分ける）
     低い遮蔽 (h=1.05) … 天端は「途切れない水平の一本線」。冠部の装飾を一切載せない。
                         ＝逆光の黒でも「越えられる／上から撃てる」水平帯に見える。
     高い遮蔽 (h=2.05) … 天端は「割れて尖った冠＋鉄筋のアンテナ」。垂直で細く、
                         輪郭が空を刺す。＝「上は無理、端から出る」と一目で分かる。

   ■ 当たり判定との一致（最優先）
     - 遮蔽の見た目は COVERS の AABB そのもの。天端は必ず h ちょうどに面を持つ
       （キャップ板が footprint 全面を覆う）。側面の損傷はすべて「内側への欠き取り」
       として表現し、箱の外へは一切出さない。
     - 箱の外へ出るのは h を超えた高さの冠部装飾だけ。低い遮蔽 (h=1.05 < 1.2) には
       冠部を一切作らないので、0〜1.2m に箱外の張り出しは原理的に発生しない。
     - 外壁も同じ規則。壁は「穴」を開けない（弾が止まるのに見た目が抜けていたら嘘）。
       損傷は表皮の剥離と天端（4.2m）より上の崩れで表現する。
   ========================================================================== */
(function (g) {
  var ASH = g.ASH = g.ASH || {};

  ASH.env = function (T, mats, COVERS, ARENA) {
    var P = ASH.palette;
    var TEX = (mats && mats.tex) ? mats.tex : null;
    var TAU = Math.PI * 2;

    /* ---------------------------------------------------------------------
       共通ユーティリティ
       乱数は「毎回同じ廃墟」であってほしい（絵を詰められない）ので決定的LCG。
       ------------------------------------------------------------------ */
    function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
    function smooth(t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }
    var _s = 20240917;
    function rnd() { _s = (_s * 16807) % 2147483647; return _s / 2147483647; }
    function rr(a, b) { return a + (b - a) * rnd(); }
    function hash2(x, z) { var v = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453; return v - Math.floor(v); }

    /* ---- 因果ベクトル（この2本から破壊の向きを全部導く） ---------------- */
    var DX = 0.66, DZ = 0.75;     // 砲弾の進行方向（南東へ）
    var WX = -DX, WZ = -DZ;       // 被弾面が向いている方向（北西）
    var FIRE_X = -10.2, FIRE_Z = -10.2;   // 火元＝北西の角
    var WIND_X = 0.95, WIND_Z = 0.31;     // 風下＝東やや南。火はこちらへ流れた

    /* 煤の濃さ。火元から風下へ伸びる細長い楕円。手続きノイズは撒かない
       （§3「ランダムに散らすのは不合格」）。形そのものが原因を語るようにする。 */
    function scorchAt(x, z) {
      var ax = x - FIRE_X, az = z - FIRE_Z;
      var along = ax * WIND_X + az * WIND_Z;        // 風下方向の距離
      var perp = -ax * WIND_Z + az * WIND_X;        // 風に直交する広がり
      var fa = along < 0 ? (-along) / 4.0 : Math.max(0, along - 1.5) / 21.0;
      var fp = Math.abs(perp) / 7.5;
      var s = 1 - Math.sqrt(fa * fa + fp * fp);
      return clamp(s, 0, 1);
    }

    /* 「爆風の影」：その点から北西へ辿って遮蔽に当たるか。当たる＝熱も破片も
       届かなかった＝粉塵が残って明るい。これが砲撃方向を床に描く。 */
    function upwindShade(x, z) {
      var hit = 0, s;
      for (s = -1; s <= 1; s++) {
        // 影の縁を柔らかくするため、風上方向に直交して3本ずらして撃つ
        var ox = x + (-WZ) * s * 0.30, oz = z + (WX) * s * 0.30;
        var i, blocked = 0;
        for (i = 0; i < COVERS.length; i++) {
          var c = COVERS[i];
          var t1 = (c.x - c.hx - ox) / WX, t2 = (c.x + c.hx - ox) / WX;
          var tminx = Math.min(t1, t2), tmaxx = Math.max(t1, t2);
          var t3 = (c.z - c.hz - oz) / WZ, t4 = (c.z + c.hz - oz) / WZ;
          var tminz = Math.min(t3, t4), tmaxz = Math.max(t3, t4);
          var tmin = Math.max(tminx, tminz), tmax = Math.min(tmaxx, tmaxz);
          if (tmax >= Math.max(tmin, 0.06) && tmin < 7.5) {
            // 遠い遮蔽ほど影は薄い（実際の陰影ではなく堆積の跡なので緩やかに）
            blocked = Math.max(blocked, 1 - clamp(tmin / 7.5, 0, 1) * 0.65);
          }
        }
        hit += blocked;
      }
      return hit / 3;
    }

    /* 弾着痕。北西→南東へ3発。同一直線上に並べることで「砲撃が歩いた」と読ませる */
    var CRATERS = [
      { x: -9.1, z: -9.3, r: 2.30, d: 0.100 },
      { x: -3.5, z: -3.1, r: 1.75, d: 0.078 },
      { x: 3.5, z: 3.4, r: 1.35, d: 0.055 }
    ];

    /* ---------------------------------------------------------------------
       ジオメトリ蓄積器
       BufferGeometryUtils が使えないので position/normal/uv/color を手で連結する。
       マテリアル種別ごとに1バッファ＝1ドローコールに畳む。
       ------------------------------------------------------------------ */
    function Buf() { this.p = []; this.n = []; this.u = []; this.c = []; }

    var bGround = new Buf();    // 地面
    var bStone = new Buf();     // 遮蔽の切石表皮・天端・冠部（影を落とす唯一の塊）
    var bBrick = new Buf();     // 芯の煉瓦・剥離した奥（凹んだ面）
    var bConc = new Buf();      // 外壁の躯体・天端・崩れた冠
    var bPlaster = new Buf();   // 外壁内側に残った漆喰パネル
    var bRust = new Buf();      // 露出鉄筋
    var bMetal = new Buf();     // ねじれた鉄骨・手すり
    var bFar = new Buf();       // アリーナ外の廃墟スカイライン＋地平

    var WHITE = new T.Color(1, 1, 1);
    var C = {
      ground: new T.Color(P.ground), groundDark: new T.Color(P.groundDark),
      ash: new T.Color(P.ash), grime: new T.Color(P.grime),
      concrete: new T.Color(P.concrete), concreteDark: new T.Color(P.concreteDark),
      concreteWet: new T.Color(P.concreteWet), plaster: new T.Color(P.plaster),
      stone: new T.Color(P.stone), brick: new T.Color(P.brick),
      rebar: new T.Color(P.rebar), metal: new T.Color(P.metal),
      rust: new T.Color(P.rust), fog: new T.Color(P.fog)
    };

    var _col = new T.Color();
    // 空気遠近の到達色。skyHorizon そのままだと明る過ぎて背景が前に出るので
    // fog 側へ寄せて一段沈める（§「遠景を必ず一段濁らせる」）
    var HAZE = new T.Color(P.skyHorizon).lerp(new T.Color(P.fog), 0.55);
    var SUN = { x: P.sunDir.x, y: P.sunDir.y, z: P.sunDir.z };
    (function () {
      var l = Math.sqrt(SUN.x * SUN.x + SUN.y * SUN.y + SUN.z * SUN.z);
      SUN.x /= l; SUN.y /= l; SUN.z /= l;
    })();

    /* 頂点色に焼き込むもの：煤（原因）＋高さベースの擬似AO＋面の向きの明暗。
       ライトを増やさずに立体を出すため。ただしこの上に実ライトの陰影が乗るので
       AO は控えめ（0.28）にしないと逆光側が一様な黒に潰れる。 */
    function bake(out, base, x, y, z, nx, ny, nz, k, fogK) {
      out.copy(base);
      var burn = scorchAt(x, z) * (0.34 + 0.66 * Math.max(0, nx * WX + nz * WZ));
      if (burn > 0) out.lerp(C.grime, burn * 0.46);
      var ao = 1 - 0.28 * (1 - clamp(y / 2.0, 0, 1));
      var fb = ny > 0.5 ? 1.16 : (ny < -0.5 ? 0.60 : 1.0);
      // 逆光側のアルベドを持ち上げる。太陽1灯では影側が一様な黒に潰れ、
      // 石積みの目地も欠けも読めなくなる。ライトを増やせない以上ここで補う。
      var back = Math.max(0, -(nx * SUN.x + ny * SUN.y + nz * SUN.z));
      out.multiplyScalar(ao * fb * k * (1 + 0.62 * back));
      if (fogK) out.lerp(C.fog, fogK);
      if (TEX) out.lerp(WHITE, 0.45);
      return out;
    }

    /* 遠景専用。ライティング計算に載せず（MeshBasicMaterial）、
       太陽方向のランバートと空気遠近を頂点色に焼く。
       こうしないと逆光側の廃墟が一様な黒に潰れて「層」にならない。 */
    function bakeFar(out, base, x, y, z, nx, ny, nz, k, fogK) {
      out.copy(base);
      var burn = scorchAt(x, z) * (0.30 + 0.70 * Math.max(0, nx * WX + nz * WZ));
      if (burn > 0) out.lerp(C.grime, burn * 0.34);
      var lam = 0.20 + 0.80 * Math.max(0, nx * SUN.x + ny * SUN.y + nz * SUN.z);
      out.multiplyScalar(lam * k * 0.80);
      // 近い廃墟は暗いシルエット、遠い廃墟ほど粉塵に溶ける＝逆光の層になる
      out.lerp(HAZE, clamp(fogK, 0, 0.88));
      if (TEX) out.lerp(WHITE, 0.35);
      return out;
    }

    /* 単位箱の6面。外から見て CCW。順に +X -X +Y -Y +Z -Z */
    var FACE = [
      [1, 0, 0, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1, 1, 1],
      [-1, 0, 0, -1, -1, -1, -1, -1, 1, -1, 1, 1, -1, 1, -1],
      [0, 1, 0, -1, 1, 1, 1, 1, 1, 1, 1, -1, -1, 1, -1],
      [0, -1, 0, -1, -1, -1, 1, -1, -1, 1, -1, 1, -1, -1, 1],
      [0, 0, 1, -1, -1, 1, 1, -1, 1, 1, 1, 1, -1, 1, 1],
      [0, 0, -1, 1, -1, -1, -1, -1, -1, -1, 1, -1, 1, 1, -1]
    ];
    var _r = [0, 0, 0];
    function rot(px, py, pz, cy, sy, cx, sx, cz, sz, out) {
      var x1 = px * cz - py * sz, y1 = px * sz + py * cz, z1 = pz;
      var y2 = y1 * cx - z1 * sx, z2 = y1 * sx + z1 * cx;
      out[0] = x1 * cy + z2 * sy; out[1] = y2; out[2] = -x1 * sy + z2 * cy;
    }

    var _vp = [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]];
    /* o: {x,y,z,hx,hy,hz,col,k,ry,rx,rz,fogK,noBottom} */
    function box(buf, o) {
      var ry = o.ry || 0, rx = o.rx || 0, rz = o.rz || 0;
      var cy = Math.cos(ry), sy = Math.sin(ry);
      var cx = Math.cos(rx), sx = Math.sin(rx);
      var cz = Math.cos(rz), sz = Math.sin(rz);
      var k = (o.k === undefined) ? 1 : o.k;
      var fogK = o.fogK || 0;
      var base = o.col, i, j;
      for (i = 0; i < 6; i++) {
        var f = FACE[i];
        if (o.noBottom && f[1] === -1) continue;
        rot(f[0], f[1], f[2], cy, sy, cx, sx, cz, sz, _r);
        var nx = _r[0], ny = _r[1], nz = _r[2];
        for (j = 0; j < 4; j++) {
          rot(f[3 + j * 3] * o.hx, f[4 + j * 3] * o.hy, f[5 + j * 3] * o.hz, cy, sy, cx, sx, cz, sz, _r);
          _vp[j][0] = o.x + _r[0]; _vp[j][1] = o.y + _r[1]; _vp[j][2] = o.z + _r[2];
        }
        var order = [0, 1, 2, 0, 2, 3];
        for (j = 0; j < 6; j++) {
          var v = _vp[order[j]];
          buf.p.push(v[0], v[1], v[2]);
          buf.n.push(nx, ny, nz);
          // uv はワールド座標から取る＝結合しても目地が繋がる
          var an = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
          if (ay >= an && ay >= az) buf.u.push(v[0] * 0.5, v[2] * 0.5);
          else if (an >= az) buf.u.push(v[2] * 0.5, v[1] * 0.5);
          else buf.u.push(v[0] * 0.5, v[1] * 0.5);
          if (o.far) bakeFar(_col, base, v[0], v[1], v[2], nx, ny, nz, k, fogK);
          else bake(_col, base, v[0], v[1], v[2], nx, ny, nz, k, fogK);
          buf.c.push(_col.r, _col.g, _col.b);
        }
      }
    }

    /* =====================================================================
       1. 地面
       グリッドを手で張り、弾着痕の窪み・壁際の瓦礫の盛り上がり・
       煤・爆風の影・接地AO をすべて頂点に焼き込む。
       ================================================================== */
    var FH = ARENA.hx + 0.6;          // 外壁の外面まで覆う
    var FN = 56;                       // 56x56 = 6272 三角形。予算内で起伏が読める粒度
    var FS = (FH * 2) / FN;

    function floorY(x, z) {
      var y = 0, i;
      for (i = 0; i < CRATERS.length; i++) {
        var cr = CRATERS[i];
        var d = Math.sqrt((x - cr.x) * (x - cr.x) + (z - cr.z) * (z - cr.z)) / cr.r;
        if (d < 1.35) y -= cr.d * smooth(1.35 - d) * (0.85 + 0.3 * hash2(x * 3, z * 3));
      }
      // 壁際：崩れた躯体が積もって地面がわずかに持ち上がっている（膝以下）
      var e = Math.max(Math.abs(x), Math.abs(z));
      if (e > 11.2) y += 0.055 * smooth((e - 11.2) / 1.9) * (0.55 + 0.45 * hash2(x * 1.7, z * 1.7));
      y += (hash2(x * 5.1, z * 5.1) - 0.5) * 0.018;
      return y;
    }

    /* 遮蔽・壁の足元は暗く落とす。接地感が無いと箱が浮いて見える */
    function contactAO(x, z) {
      var a = 1, i;
      for (i = 0; i < COVERS.length; i++) {
        var c = COVERS[i];
        var dx = Math.max(Math.abs(x - c.x) - c.hx, 0);
        var dz = Math.max(Math.abs(z - c.z) - c.hz, 0);
        var d = Math.sqrt(dx * dx + dz * dz);
        a = Math.min(a, 0.60 + 0.40 * clamp(d / 0.95, 0, 1));
      }
      var e = Math.max(Math.abs(x), Math.abs(z));
      a = Math.min(a, 0.64 + 0.36 * clamp((ARENA.hx - e) / 1.6, 0, 1));
      return a;
    }

    /* 弾着痕から風下へ伸びる放射状の掃き跡。爆心が読める */
    function ejecta(x, z) {
      var v = 0, i;
      for (i = 0; i < CRATERS.length; i++) {
        var cr = CRATERS[i];
        var dx = x - cr.x, dz = z - cr.z;
        var d = Math.sqrt(dx * dx + dz * dz);
        if (d < cr.r * 0.6 || d > cr.r * 3.4) continue;
        var ux = dx / d, uz = dz / d;
        var fan = Math.max(0, ux * DX + uz * DZ);      // 南東側に強く飛んだ
        var ray = 0.45 + 0.55 * Math.abs(Math.sin(Math.atan2(dz, dx) * 9.0));
        v = Math.max(v, fan * fan * ray * (1 - smooth((d - cr.r * 0.6) / (cr.r * 2.8))));
      }
      return v;
    }

    function floorCol(out, x, z, y) {
      out.copy(C.ground);
      // 窪みは濡れて暗く、盛り上がりは砕石で明るい
      if (y < 0) out.lerp(C.concreteWet, clamp(-y * 9.0, 0, 0.80));
      else if (y > 0.010) out.lerp(C.ash, clamp(y * 9.0, 0, 0.62));
      var sh = upwindShade(x, z);
      var burn = scorchAt(x, z) * (1 - sh * 0.85);
      out.lerp(C.grime, burn * 0.80);
      // 爆風の影＝熱も破片も届かず粉塵が残った明るい帯。砲撃の方向はここに出る
      out.lerp(C.ash, sh * 0.60 * (1 - burn * 0.45));
      out.lerp(C.ash, ejecta(x, z) * 0.55);
      var v = contactAO(x, z) * (0.88 + 0.24 * hash2(x * 2.3, z * 2.3));
      out.multiplyScalar(v);
      if (TEX) out.lerp(WHITE, 0.45);
      return out;
    }

    (function buildFloor() {
      var i, j;
      var Y = [], CC = [];
      for (i = 0; i <= FN; i++) {
        Y.push([]); CC.push([]);
        for (j = 0; j <= FN; j++) {
          var x = -FH + i * FS, z = -FH + j * FS;
          Y[i].push(floorY(x, z));
        }
      }
      for (i = 0; i <= FN; i++) {
        for (j = 0; j <= FN; j++) {
          var x2 = -FH + i * FS, z2 = -FH + j * FS;
          var c = new T.Color();
          floorCol(c, x2, z2, Y[i][j]);
          CC[i].push(c);
        }
      }
      function nrm(i2, j2, out) {
        var l = Y[Math.max(i2 - 1, 0)][j2], r2 = Y[Math.min(i2 + 1, FN)][j2];
        var d = Y[i2][Math.max(j2 - 1, 0)], u = Y[i2][Math.min(j2 + 1, FN)];
        var nx = (l - r2), nz = (d - u), ny = 2 * FS;
        var len = Math.sqrt(nx * nx + ny * ny + nz * nz);
        out[0] = nx / len; out[1] = ny / len; out[2] = nz / len;
      }
      var nA = [0, 0, 0], tone = 1;
      function vert(i2, j2) {
        var x3 = -FH + i2 * FS, z3 = -FH + j2 * FS;
        bGround.p.push(x3, Y[i2][j2], z3);
        nrm(i2, j2, nA);
        bGround.n.push(nA[0], nA[1], nA[2]);
        bGround.u.push(x3 * 0.34, z3 * 0.34);
        var c2 = CC[i2][j2];
        bGround.c.push(c2.r * tone, c2.g * tone, c2.b * tone);
      }
      /* 敷石。頂点は非共有なのでセル単位でトーンを変えられる＝約1mの石畳になる。
         テクスチャに頼らずに「舗装された旧市街の広場」であることを地面に持たせる。
         （tex がある本番では map の目地がこの上に乗る） */
      for (i = 0; i < FN; i++) {
        for (j = 0; j < FN; j++) {
          var si = Math.floor(i / 2), sj = Math.floor(j / 2);
          tone = 0.84 + 0.30 * hash2(si * 3.71, sj * 2.93);
          // 弾着痕のまわりは石が跳ね上げられてバラバラ＝トーンが暴れる
          var mx = -FH + (i + 0.5) * FS, mz = -FH + (j + 0.5) * FS, ci;
          for (ci = 0; ci < CRATERS.length; ci++) {
            var cr2 = CRATERS[ci];
            var dd = Math.sqrt((mx - cr2.x) * (mx - cr2.x) + (mz - cr2.z) * (mz - cr2.z)) / cr2.r;
            if (dd < 1.8) tone *= 1 - 0.34 * smooth(1.8 - dd) * (hash2(i * 1.3, j * 1.9) - 0.35);
          }
          vert(i, j); vert(i, j + 1); vert(i + 1, j + 1);
          vert(i, j); vert(i + 1, j + 1); vert(i + 1, j);
        }
      }
    })();

    /* =====================================================================
       2. 遮蔽物 — COVERS の AABB に厳密一致させる
       構造： 芯（煉瓦）＋ 4面の切石パネル（欠けは内側への凹み）＋ 天端キャップ
              ＋ 高い遮蔽だけ h より上に冠部（割れた塊＋鉄筋）
       ================================================================== */
    var SKIN = 0.055;   // 表皮の厚み。剥がれた所はこの分だけ内側に凹む

    function coverPanels(c, side, x0, x1, z0, z1, yBot, yTop, blow) {
      // side: 0=+Z 1=-Z 2=+X 3=-X
      var nx = (side === 2) ? 1 : (side === 3 ? -1 : 0);
      var nz = (side === 0) ? 1 : (side === 1 ? -1 : 0);
      var lenAxisX = (nx === 0);
      var L = lenAxisX ? (x1 - x0) : (z1 - z0);
      var nC = Math.max(1, Math.round(L / 0.46));
      var cw = L / nC;
      var nR = Math.max(2, Math.round((yTop - yBot) / 0.34));
      var rh = (yTop - yBot) / nR;
      var s0 = lenAxisX ? x0 : z0, s1 = lenAxisX ? x1 : z1;
      var i, j;
      for (j = 0; j < nR; j++) {
        // 芋目地は「タイル」に見える。半個ずらした馬目地にすると石積みに読める
        var off = (j % 2) ? 0.5 : 0.0;
        for (i = -1; i <= nC; i++) {
          var a0 = s0 + (i + off) * cw, a1 = a0 + cw;
          if (a1 <= s0 + 0.004 || a0 >= s1 - 0.004) continue;
          if (a0 < s0) a0 = s0;
          if (a1 > s1) a1 = s1;
          var half = (a1 - a0) * 0.5 - 0.008;
          if (half <= 0.01) continue;
          var mid = (a0 + a1) * 0.5;
          var cx = lenAxisX ? mid : ((x0 + x1) * 0.5 + nx * ((x1 - x0) * 0.5 - SKIN * 0.5));
          var cz = lenAxisX ? ((z0 + z1) * 0.5 + nz * ((z1 - z0) * 0.5 - SKIN * 0.5)) : mid;
          var cyy = yBot + (j + 0.5) * rh;
          var hxx = lenAxisX ? half : SKIN * 0.5;
          var hzz = lenAxisX ? SKIN * 0.5 : half;
          var hyy = rh * 0.5 - 0.008;
          // 損傷率：北西を向いた面ほど、そして高い所ほど剥がれている
          var face = Math.max(0, nx * WX + nz * WZ);
          var hf = clamp((cyy - yBot) / (yTop - yBot), 0, 1);
          var pMiss = 0.03 + face * (blow ? 0.46 : 0.30) * (0.35 + 0.65 * hf) + hf * 0.10;
          if (hash2(cx * 7.3 + j * 2.1, cz * 7.3 - i * 1.7) < pMiss) {
            // 剥がれた：表皮の代わりに一段奥へ凹んだ煉瓦の芯を見せる
            box(bBrick, {
              x: cx - nx * SKIN * 0.75, y: cyy, z: cz - nz * SKIN * 0.75,
              hx: hxx * (lenAxisX ? 0.94 : 0.35), hy: hyy * 0.94, hz: hzz * (lenAxisX ? 0.35 : 0.94),
              col: C.brick, k: 0.62 + 0.25 * hash2(cx, cz), noBottom: true
            });
          } else {
            var kk = 0.86 + 0.26 * hash2(cx * 3.1, cz * 3.1);
            var cc = (hash2(cx * 11.0, cz * 9.0) < 0.24) ? C.concrete : C.stone;
            box(bStone, { x: cx, y: cyy, z: cz, hx: hxx, hy: hyy, hz: hzz, col: cc, k: kk, noBottom: true });
          }
        }
      }
    }

    (function buildCovers() {
      var i, j;
      for (i = 0; i < COVERS.length; i++) {
        var c = COVERS[i];
        var low = c.h <= 1.25;
        var x0 = c.x - c.hx, x1 = c.x + c.hx, z0 = c.z - c.hz, z1 = c.z + c.hz;
        var capH = low ? 0.13 : 0.16;
        var yTop = c.h - capH;
        var yBot = -0.16;               // 地面の起伏に潜らせる。負の高さは当たり判定に無関係

        // 芯：表皮の厚みだけ内側。剥がれた所からこれが見える
        box(bBrick, {
          x: c.x, y: (yBot + yTop) * 0.5, z: c.z,
          hx: c.hx - SKIN, hy: (yTop - yBot) * 0.5, hz: c.hz - SKIN,
          col: C.brick, k: 0.55, noBottom: true
        });

        var blow = !low;   // 高い遮蔽ほど大きく持って行かれている
        coverPanels(c, 0, x0, x1, z0, z1, yBot, yTop, blow);
        coverPanels(c, 1, x0, x1, z0, z1, yBot, yTop, blow);
        coverPanels(c, 2, x0, x1, z0, z1, yBot, yTop, blow);
        coverPanels(c, 3, x0, x1, z0, z1, yBot, yTop, blow);

        /* 天端キャップ：footprint 全面を h ちょうどまで覆う。
           これが「当たり判定の天面＝見た目の天面」を保証する唯一の板。
           長手方向に目地で割るが、隙間は 0.012 の溝なので水平線は途切れない。 */
        var alongX = (c.hx >= c.hz);
        var Ln = alongX ? (x1 - x0) : (z1 - z0);
        var nSeg = Math.max(1, Math.round(Ln / 0.95));
        var sw = Ln / nSeg;
        for (j = 0; j < nSeg; j++) {
          var sx = alongX ? (x0 + (j + 0.5) * sw) : c.x;
          var sz = alongX ? c.z : (z0 + (j + 0.5) * sw);
          var shx = alongX ? (sw * 0.5 - (j === 0 || j === nSeg - 1 ? 0.006 : 0.012)) : c.hx;
          var shz = alongX ? c.hz : (sw * 0.5 - (j === 0 || j === nSeg - 1 ? 0.006 : 0.012));
          // 端の板だけは footprint の端に必ず届かせる（外周を欠けさせない）
          if (alongX && nSeg > 1) { if (j === 0) { sx -= 0.006; } if (j === nSeg - 1) { sx += 0.006; } }
          if (!alongX && nSeg > 1) { if (j === 0) { sz -= 0.006; } if (j === nSeg - 1) { sz += 0.006; } }
          box(bStone, {
            x: sx, y: c.h - capH * 0.5, z: sz, hx: shx, hy: capH * 0.5, hz: shz,
            col: C.concrete, k: 0.94 + 0.12 * hash2(sx * 4.4, sz * 4.4), noBottom: true
          });
        }

        if (low) continue;   // ★ 低い遮蔽には h より上に何も置かない（水平線を守る）

        /* --- 高い遮蔽の冠部：割れた塊＋鉄筋。すべて y >= h（=2.05 > 1.2）なので
               footprint からはみ出しても腰の高さの偽の遮蔽にはならない --- */
        var nCh = 4 + Math.floor(rnd() * 3);
        for (j = 0; j < nCh; j++) {
          var tx = rr(-1, 1), tz = rr(-1, 1);
          var lee = clamp((tx * DX + tz * DZ) * 0.6 + 0.5, 0, 1);   // 南東側ほど高く残る
          var hh = rr(0.07, 0.16) + lee * rr(0.12, 0.42);
          box(bStone, {
            x: c.x + tx * c.hx * 0.85, y: c.h + hh, z: c.z + tz * c.hz * 0.85,
            hx: rr(0.11, 0.26), hy: hh, hz: rr(0.09, 0.20),
            ry: rr(-0.6, 0.6), rz: rr(-0.16, 0.16), rx: rr(-0.14, 0.14),
            col: (rnd() < 0.35) ? C.brick : C.concrete, k: rr(0.80, 1.06)
          });
        }
        // 折れ残った柱の芯。冠部の最高点を作って輪郭を尖らせる
        var stubH = rr(0.42, 0.72);
        var stx = rr(-0.55, 0.55), stz = rr(-0.55, 0.55);
        box(bStone, {
          x: c.x + stx * c.hx, y: c.h + stubH * 0.5, z: c.z + stz * c.hz,
          hx: rr(0.10, 0.17), hy: stubH * 0.5, hz: rr(0.09, 0.15),
          ry: rr(-0.5, 0.5), rz: -rr(0.02, 0.10) * DX, rx: rr(0.02, 0.10) * DZ,
          col: C.concrete, k: rr(0.9, 1.05)
        });
        // 南東へ倒れ込む大きめの床スラブ。輪郭に「倒壊の向き」を作る
        box(bStone, {
          x: c.x + DX * c.hx * 1.05, y: c.h + 0.30, z: c.z + DZ * c.hz * 1.05,
          hx: rr(0.30, 0.50), hy: 0.055, hz: rr(0.24, 0.40),
          ry: rr(0, TAU), rz: -rr(0.45, 0.80), rx: rr(-0.2, 0.2),
          col: C.concrete, k: 0.92
        });
        // 露出鉄筋。全部が南東へ傾く＝空に対して方向を持ったアンテナになる
        var nR2 = 6 + Math.floor(rnd() * 4);
        for (j = 0; j < nR2; j++) {
          var lean = rr(0.18, 0.70);
          var L2 = rr(0.30, 0.80);
          var bx = c.x + rr(-0.85, 0.85) * c.hx * 0.85;
          var bz = c.z + rr(-0.85, 0.85) * c.hz * 0.85;
          box(bRust, {
            x: bx + DX * Math.sin(lean) * L2 * 0.5,
            y: c.h - 0.06 + Math.cos(lean) * L2,
            z: bz + DZ * Math.sin(lean) * L2 * 0.5,
            hx: 0.021, hy: L2, hz: 0.021,
            rx: lean * DZ, rz: -lean * DX, ry: rr(0, TAU),
            col: (rnd() < 0.5) ? C.rust : C.rebar, k: rr(0.85, 1.15)
          });
        }
      }
    })();

    /* =====================================================================
       3. 外周壁 — 穴は開けない（弾が止まるのに抜けて見えたら嘘になる）
       損傷は「表皮の剥離」と「天端 4.2m より上の崩れ」だけで語る。
       北壁・西壁＝外から吹き抜けた側なので内面が大きく欠ける。
       南壁・東壁＝破片が飛んできた下流側なので面は残るが煤と細かい欠け。
       ================================================================== */
    var WT = 0.6, WH = ARENA.wallH, AX = ARENA.hx, AZ = ARENA.hz;

    function buildWall(minx, minz, maxx, maxz, inx, inz, blow) {
      var capH = 0.18;
      var body = WH - capH;
      var cx = (minx + maxx) * 0.5, cz = (minz + maxz) * 0.5;
      var hx = (maxx - minx) * 0.5, hz = (maxz - minz) * 0.5;

      // 躯体。内面側だけ SKIN 分痩せさせ、そこに表皮を貼る
      box(bConc, {
        x: cx - inx * SKIN * 0.5, y: (body - 0.2) * 0.5 - 0.1, z: cz - inz * SKIN * 0.5,
        hx: hx - Math.abs(inx) * SKIN * 0.5, hy: (body + 0.2) * 0.5,
        hz: hz - Math.abs(inz) * SKIN * 0.5,
        col: C.concreteDark, k: 0.72, noBottom: true
      });
      // 剥離の奥に見える煉瓦の層
      box(bBrick, {
        x: cx + inx * (hx - SKIN * 0.72), y: (body - 0.2) * 0.5 - 0.1, z: cz + inz * (hz - SKIN * 0.72),
        hx: (inx !== 0) ? SKIN * 0.28 : hx - 0.02, hy: (body + 0.2) * 0.5,
        hz: (inz !== 0) ? SKIN * 0.28 : hz - 0.02,
        col: C.brick, k: 0.5, noBottom: true
      });

      // 内面の表皮パネル
      var alongX = (inx === 0);
      var L = alongX ? (maxx - minx) : (maxz - minz);
      var nC = Math.max(1, Math.round(L / 0.88));
      var cw = L / nC;
      var rows = [0.0, 0.88, 1.76, 2.64, 3.40, body];
      var i, j;
      for (i = 0; i < nC; i++) {
        for (j = 0; j < rows.length - 1; j++) {
          var y0 = rows[j], y1 = rows[j + 1];
          var hf = y0 / body;
          var pMiss = blow ? (0.06 + 0.44 * hf) : (0.02 + 0.11 * hf);
          var px = alongX ? (minx + (i + 0.5) * cw) : (cx + inx * (hx - SKIN * 0.5));
          var pz = alongX ? (cz + inz * (hz - SKIN * 0.5)) : (minz + (i + 0.5) * cw);
          if (hash2(px * 5.7 + j * 3.3, pz * 5.7 - i * 2.9) < pMiss) continue;
          box(bPlaster, {
            x: px, y: (y0 + y1) * 0.5, z: pz,
            hx: alongX ? cw * 0.5 - 0.012 : SKIN * 0.5,
            hy: (y1 - y0) * 0.5 - 0.012,
            hz: alongX ? SKIN * 0.5 : cw * 0.5 - 0.012,
            col: (hash2(px * 2.2, pz * 2.2) < 0.3) ? C.concrete : C.plaster,
            k: 0.80 + 0.28 * hash2(px * 9.1, pz * 9.1), noBottom: true
          });
        }
      }

      // 天端。4.2m ちょうどに面を作る（壁の当たり判定の天面と一致）
      box(bConc, { x: cx, y: WH - capH * 0.5, z: cz, hx: hx, hy: capH * 0.5, hz: hz, col: C.concrete, k: 0.9, noBottom: true });

      /* 天端より上の崩れ。ここだけは自由に壊せる（当たり判定の外＝空） */
      var step = 1.35;
      var n2 = Math.floor(L / step);
      for (i = 0; i < n2; i++) {
        var t = (i + 0.5) / n2;
        var qx = alongX ? (minx + t * L) : cx;
        var qz = alongX ? cz : (minz + t * L);
        // 北西寄りほど低く（削り取られ）、南東寄りほど高く残る
        var lee2 = clamp(((qx * DX + qz * DZ) / 18) * 0.5 + 0.5, 0, 1);
        var top = blow ? rr(0.05, 0.55) + lee2 * 0.55 : rr(0.03, 0.22) + lee2 * 0.20;
        if (rnd() < (blow ? 0.18 : 0.30)) top *= 0.25;
        box(bConc, {
          x: qx, y: WH + top * 0.5, z: qz,
          hx: alongX ? step * 0.5 * rr(0.55, 0.95) : hx * rr(0.8, 1.0),
          hy: top * 0.5,
          hz: alongX ? hz * rr(0.8, 1.0) : step * 0.5 * rr(0.55, 0.95),
          ry: rr(-0.05, 0.05), col: (rnd() < 0.3) ? C.brick : C.concrete, k: rr(0.78, 1.02), noBottom: true
        });
        if (blow && rnd() < 0.55) {
          var lean2 = rr(0.2, 0.7);
          box(bRust, {
            x: qx + DX * 0.16, y: WH + top + rr(0.15, 0.45), z: qz + DZ * 0.16,
            hx: 0.021, hy: rr(0.22, 0.5), hz: 0.021,
            rx: lean2 * DZ, rz: -lean2 * DX,
            col: C.rust, k: rr(0.85, 1.1)
          });
        }
      }
      return { alongX: alongX, L: L, minx: minx, minz: minz, cx: cx, cz: cz, hx: hx, hz: hz };
    }

    (function buildWalls() {
      buildWall(-AX - WT, -AZ - WT, -AX, AZ + WT, 1, 0, true);    // 西：吹き抜けた側
      buildWall(AX, -AZ - WT, AX + WT, AZ + WT, -1, 0, false);    // 東：下流側
      buildWall(-AX - WT, -AZ - WT, AX + WT, -AZ, 0, 1, true);    // 北：吹き抜けた側
      buildWall(-AX - WT, AZ, AX + WT, AZ + WT, 0, -1, false);    // 南：下流側

      /* 北壁の一点に「ここを撃たれた」焦点を作る。ねじれた鉄骨が南東へ倒れ込む。
         逆光でこれが一番手前の空を切るので、視線がまずここへ行く。 */
      var fx = -2.2, i;
      for (i = 0; i < 5; i++) {
        var ln = rr(0.35, 0.95);
        box(bMetal, {
          x: fx + rr(-2.4, 2.4), y: WH + rr(0.55, 1.35), z: -AZ - 0.3 + rr(-0.1, 0.35),
          hx: rr(0.05, 0.09), hy: rr(0.5, 1.15), hz: rr(0.04, 0.07),
          rx: ln * DZ, rz: -ln * DX, ry: rr(-0.4, 0.4),
          col: (i % 2) ? C.metal : C.rust, k: rr(0.8, 1.1)
        });
      }
      // 西壁にも1本。原因が1方向であることを補強する
      for (i = 0; i < 3; i++) {
        var ln2 = rr(0.3, 0.8);
        box(bMetal, {
          x: -AX - 0.3 + rr(-0.1, 0.3), y: WH + rr(0.4, 1.0), z: rr(-7, 2),
          hx: rr(0.04, 0.07), hy: rr(0.4, 0.9), hz: rr(0.05, 0.09),
          rx: ln2 * DZ, rz: -ln2 * DX, ry: rr(-0.4, 0.4),
          col: (i % 2) ? C.metal : C.rust, k: rr(0.8, 1.1)
        });
      }
    })();

    /* =====================================================================
       4. アリーナ外の廃墟スカイライン（当たり判定なし）
       全部が北西の上部を失い、南東へ倒れかけている＝地平線が原因を語る。
       空気遠近を頂点色に焼き込み、霧が無い状態でも奥行きが出るようにする。
       ================================================================== */
    (function buildSkyline() {
      // 遠景は実ライティングに載せない（bakeFar で焼き込む）
      function fbox(o) { o.far = true; box(bFar, o); }
      // 地平の板。壁の外に虚空が見えると廃墟が浮くので必ず敷く
      fbox({ x: 0, y: -0.14, z: 0, hx: 95, hy: 0.06, hz: 95, col: C.ground, k: 0.70, fogK: 0.80, noBottom: true });

      /* リングごとに「疎らで低い手前」→「密で高い奥」。手前を詰め込むと
         空が消えて地平線が読めなくなり、逆光の層が成立しない。 */
      var rings = [
        { r0: 15.4, r1: 22.0, n: 16, h0: 4.0, h1: 8.5, p: 0.62 },
        { r0: 22.0, r1: 33.0, n: 26, h0: 6.0, h1: 15.0, p: 0.78 },
        { r0: 33.0, r1: 47.0, n: 26, h0: 8.0, h1: 22.0, p: 0.9 },
        { r0: 47.0, r1: 68.0, n: 24, h0: 10.0, h1: 30.0, p: 1.0 }
      ];
      var ri, k, i;
      for (ri = 0; ri < rings.length; ri++) {
        var R = rings[ri];
        for (k = 0; k < R.n; k++) {
          if (rnd() > R.p) continue;                 // 隙間＝空。地平線を読ませる
          var ang = (k / R.n) * TAU + rr(-0.4, 0.4) * (TAU / R.n);
          var rad = rr(R.r0, R.r1);
          var bx = Math.cos(ang) * rad, bz = Math.sin(ang) * rad;
          var hw = rr(1.6, 3.6), hd = rr(1.6, 3.6);
          // アリーナと外壁には絶対に食い込ませない
          if (Math.abs(bx) - hw < AX + WT + 0.6 && Math.abs(bz) - hd < AZ + WT + 0.6) continue;
          var H = rr(R.h0, R.h1);
          var fogK = Math.pow(clamp((rad - 13.5) / 50, 0, 1), 0.72) * 0.86;
          var yaw = rr(-0.35, 0.35);
          var baseCol = (rnd() < 0.4) ? C.plaster : (rnd() < 0.5 ? C.concrete : C.stone);

          // 下半分：ほぼ健在
          fbox({ x: bx, y: H * 0.30, z: bz, hx: hw, hy: H * 0.30, hz: hd, ry: yaw, col: baseCol, k: rr(0.85, 1.05), fogK: fogK, noBottom: true });
          // 中段：北西側が削られて一回り小さく、南東へ寄る
          var sh2 = rr(0.62, 0.86);
          fbox({
            x: bx + DX * hw * (1 - sh2) * 0.9, y: H * 0.72, z: bz + DZ * hd * (1 - sh2) * 0.9,
            hx: hw * sh2, hy: H * 0.14, hz: hd * sh2, ry: yaw,
            col: baseCol, k: rr(0.78, 0.98), fogK: fogK, noBottom: true
          });
          // 上段：さらに削られた残骸。北西の角が無い
          var sh3 = sh2 * rr(0.40, 0.72);
          var topH = rr(0.10, 0.34) * H;
          fbox({
            x: bx + DX * hw * (1 - sh3) * 1.05, y: H * 0.86 + topH * 0.5, z: bz + DZ * hd * (1 - sh3) * 1.05,
            hx: hw * sh3, hy: topH * 0.5, hz: hd * sh3, ry: yaw + rr(-0.1, 0.1),
            col: baseCol, k: rr(0.72, 0.92), fogK: fogK, noBottom: true
          });
          // 南東へ倒れかけた床スラブ
          if (rnd() < 0.62) {
            var lean3 = rr(0.35, 0.95);
            fbox({
              x: bx + DX * (hw + rr(0.3, 1.2)), y: H * rr(0.45, 0.80), z: bz + DZ * (hd + rr(0.3, 1.2)),
              hx: rr(0.9, 2.2), hy: 0.12, hz: rr(0.7, 1.8),
              ry: rr(0, TAU), rx: lean3 * DZ, rz: -lean3 * DX,
              col: C.concreteDark, k: rr(0.8, 1.0), fogK: fogK, noBottom: true
            });
          }
          // 生き残った煙突・塔。地平のリズムを作る垂直線
          if (rnd() < 0.20) {
            var th = rr(4.0, 13.0);
            fbox({
              x: bx + rr(-hw * 0.6, hw * 0.6), y: H * 0.86 + th * 0.5, z: bz + rr(-hd * 0.6, hd * 0.6),
              hx: rr(0.28, 0.62), hy: th * 0.5, hz: rr(0.28, 0.62), ry: yaw,
              col: (rnd() < 0.5) ? C.brick : baseCol, k: rr(0.7, 0.95), fogK: fogK * 1.05, noBottom: true
            });
          }
        }
      }
    })();

    /* =====================================================================
       5. メッシュ化
       同一マテリアルを1バッファに畳んである。影を落とすのは遮蔽の塊(bStone)だけ。
       外壁まで影を落とすと北半分が真っ暗になり、遮蔽の形が読めなくなるため。
       ================================================================== */
    function mkMat(key, basic) {
      var o = { vertexColors: true };
      if (TEX && TEX[key]) o.map = TEX[key];
      // 遠景は陰影を頂点色に焼いてあるので Basic。ライトを1本も増やさずに層が出る
      return basic ? new T.MeshBasicMaterial(o) : new T.MeshLambertMaterial(o);
    }
    function toMesh(buf, key, cast, recv, name, basic) {
      if (!buf.p.length) return null;
      var gm = new T.BufferGeometry();
      gm.setAttribute('position', new T.Float32BufferAttribute(buf.p, 3));
      gm.setAttribute('normal', new T.Float32BufferAttribute(buf.n, 3));
      gm.setAttribute('uv', new T.Float32BufferAttribute(buf.u, 2));
      gm.setAttribute('color', new T.Float32BufferAttribute(buf.c, 3));
      gm.computeBoundingSphere();
      var m = new T.Mesh(gm, mkMat(key, basic));
      m.castShadow = !!cast; m.receiveShadow = !!recv; m.name = name;
      return m;
    }

    var G = new T.Group();
    G.name = 'env';
    var LIST = [
      [bGround, 'ground', false, true, 'envGround'],
      [bStone, 'stone', true, true, 'envCoverSkin'],
      [bBrick, 'brick', false, true, 'envCore'],
      [bConc, 'concrete', false, true, 'envWall'],
      [bPlaster, 'plaster', false, true, 'envWallSkin'],
      [bRust, 'rust', false, false, 'envRebar'],
      [bMetal, 'metal', false, false, 'envSteel'],
      [bFar, 'plaster', false, false, 'envSkyline', true]
    ];
    for (var q = 0; q < LIST.length; q++) {
      var mm = toMesh(LIST[q][0], LIST[q][1], LIST[q][2], LIST[q][3], LIST[q][4], LIST[q][5]);
      if (mm) G.add(mm);
    }
    return G;
  };
})(typeof window !== 'undefined' ? window : globalThis);

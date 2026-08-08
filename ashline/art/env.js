/* =============================================================================
   ASHLINE / env.js — 中央広場の環境（背景・破壊表現）

   ■ この背景から読み取れる1文（oneLineStory）
     「北の丘から広場へ砲撃が一列に撃ち下ろされ、石も外壁も廃墟も北向きの面だけを
       削られて芯の煉瓦と鉄筋を晒し、崩れたものはすべて南へ倒れ、
       火は北西の角から風下の東へ舐めていった。」

   ■ 一貫した因果（ランダムに散らさないための単一の原因）
     原因は1つだけ。「北からの砲撃」。ここから全部を導出する。
       進行ベクトル D = (+0.16, +0.987)  … 砲弾が飛んでいった向き（北→南）
       被弾ベクトル W = -D               … 削られる面が向いている向き（北）
     太陽の影は南東へ伸びる。D をわざと 25 度ずらしてあるのは、
     影と倒壊方向が重なると床の物語が影に飲まれて読めなくなるため。
     - 弾着痕は北から南へ3発、D の直線上を等間隔で「歩いて」いる（CRATERS）。
     - 遮蔽・外壁の表皮は W を向いた面ほど塊で剥がれ、煉瓦の下地、さらに
       抜けた所は暗い躯体（穴）が露出する。プレイヤーが北へ攻め上がるとき、
       この削られた面が常に正面に来る。
     - 高い遮蔽の冠部の残骸と鉄筋は D 方向（南）へ倒れる。外壁の崩れも同じ。
     - 北壁・西壁は「外から撃たれて内側へ吹き抜けた」＝内面が大きく欠ける。
       南壁・東壁は「破片が飛んできた下流側」＝面は残るが煤と小さい欠けで汚れる。
     - 床の煤は火元（北西の角）から風下（東）へ伸びる楕円。
       遮蔽の北側に立つとその背後には熱も破片も届かず粉塵が残る＝「爆風の影」。
     - 外周の廃墟スカイラインも全部が北側の上部を削られ、南へ倒れかけている。

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
     - 外壁も同じ規則。壁は貫通させない（弾が止まるのに見た目が抜けていたら嘘）。
       「抜け落ちた煉瓦」は貫通ではなく、表皮→煉瓦→躯体の3層のうち手前2層が
       無くなった凹み（深さ 0.11m）として作る。輪郭は変わらないので当たり判定と矛盾しない。

   ■ タイリング反復の抑制（面が「同じブロックの繰り返し」に読めないようにする）
     テクスチャ側をどれだけ詰めても、同じ寸法のブロックが同じ UV 窓で並ぶ限り
     ブロック1個ごとに1周期が出る。ジオメトリ側で次の4つを行う：
       ① indiv()   … ブロックごとに UV を90度単位で回し、オフセットとスケールをずらす
       ② indiv()   … ブロックごとに頂点カラーの明度を ±12% ずらす
       ③ runCourse() … 石の幅を 0.3〜1.35m の不揃いで刻む（等分割をやめる）
                        段の高さも段ごとに変え、壁は 3.4m の区画ごとに段位置をずらす
       ④ bake()    … 数メートル周期の大きな濃淡と、ブロックをまたぐ縦の雨だれ
     ①〜④はいずれもマテリアルを分けないので、ドローコールは増えない。
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

    /* ---- 因果ベクトル（この2本から破壊の向きを全部導く） ----------------
       進行方向は「ほぼ真南（+Z）へ、わずかに東」。太陽の影は南東へ伸びるので、
       わざと 25 度ずらしてある。同じ向きにすると倒壊も煤も影に飲まれて読めない。
       そして被弾面（北向き）は、プレイヤーが北へ攻め上がるとき常に正面に来る。 */
    var DX = 0.16, DZ = 0.987;    // 砲弾の進行方向（北から南へ）
    var WX = -DX, WZ = -DZ;       // 被弾面が向いている方向（北）
    var FIRE_X = -9.5, FIRE_Z = -10.5;    // 火元＝北西の角
    var WIND_X = 0.93, WIND_Z = 0.37;     // 風下＝東やや南。火はこちらへ流れた

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

    /* 弾着痕。進行方向 D の直線上に3発、北から南へ等間隔で並べる。
       「一発ずつ歩かせた（walking fire）」と読めることが目的なので位置は乱数にしない。
       遮蔽の footprint を避けて西寄りの線に置いてある。 */
    var CRATERS = [
      { x: -7.4, z: -11.2, r: 2.20, d: 0.100 },
      { x: -6.28, z: -4.29, r: 1.70, d: 0.078 },
      { x: -5.16, z: 2.62, r: 1.35, d: 0.055 }
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

    var _col = new T.Color(), _mix = new T.Color();
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
      /* 数メートル周期のゆるい濃淡。ブロック単位の乱数だけだと「粒の揃った砂目」に
         なって、面全体としては均一な繰り返しに見える。面の側に大きな斑を持たせると
         視線が「壁」ではなく「傷んだ一枚の面」として読む。 */
      var wv = 0.5 + 0.25 * (Math.sin(x * 0.43 + z * 0.26 + 0.7) + Math.sin(x * 0.17 - z * 0.55 + 2.1));
      out.multiplyScalar(ao * fb * k * (0.88 + 0.24 * wv) * (0.94 + 1.30 * back));
      // 垂直面の雨だれ・煤の筋。ブロックをまたいで縦に走るので目地の格子を壊す
      if (ny < 0.5 && ny > -0.5) {
        out.lerp(C.grime, 0.11 * (0.5 + 0.5 * Math.sin(x * 2.87 + z * 3.71)));
      }
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
      var lam = 0.17 + 0.83 * Math.max(0, nx * SUN.x + ny * SUN.y + nz * SUN.z);
      out.multiplyScalar(lam * k * 0.56);   // 遠景は必ず前景より沈める
      // 近い廃墟は暗いシルエット、遠い廃墟ほど粉塵に溶ける＝逆光の層になる
      // 遠景メッシュには map を貼らないので、白へ寄せる補正はここでは行わない
      out.lerp(HAZE, clamp(fogK, 0, 0.72));
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
    /* o: {x,y,z,hx,hy,hz,col,k,ry,rx,rz,fogK,noBottom,uvq,uvou,uvov,uvs}

       uv はワールド座標から取る（結合しても目地が繋がる）が、それだけだと
       同じ寸法のブロックが同じ UV 窓を共有し、テクスチャの1周期がブロック単位で
       見えてしまう＝壁が「同じ暗いブロックの繰り返し」に読める。
       そこでブロックごとに
         uvq  : UV空間の90度単位の回転（0〜3）
         uvou/uvov : UVオフセット（テクスチャ内の切り出し位置をずらす）
         uvs  : わずかなスケール差
       を与えて、同一マテリアル・同一ドローコールのまま切り出しを全部変える。 */
    function box(buf, o) {
      var ry = o.ry || 0, rx = o.rx || 0, rz = o.rz || 0;
      var cy = Math.cos(ry), sy = Math.sin(ry);
      var cx = Math.cos(rx), sx = Math.sin(rx);
      var cz = Math.cos(rz), sz = Math.sin(rz);
      var k = (o.k === undefined) ? 1 : o.k;
      var fogK = o.fogK || 0;
      var uq = o.uvq || 0, uou = o.uvou || 0, uov = o.uvov || 0;
      var us = (o.uvs === undefined) ? 0.9 : o.uvs;
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
          var an = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
          var uu, vv;
          if (ay >= an && ay >= az) { uu = v[0]; vv = v[2]; }
          else if (an >= az) { uu = v[2]; vv = v[1]; }
          else { uu = v[0]; vv = v[1]; }
          uu *= us; vv *= us;
          // 90度単位で UV 空間ごと回す。ブロック内では一様なので歪まない
          if (uq === 1) { var t1 = uu; uu = vv; vv = -t1; }
          else if (uq === 2) { uu = -uu; vv = -vv; }
          else if (uq === 3) { var t2 = uu; uu = -vv; vv = t2; }
          buf.u.push(uu + uou, vv + uov);
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
        // 地面の uv は 1.25m 周期。3m 周期にすると tex 側の模様が
        // 大きな斑（迷彩柄）として読めてしまう
        bGround.u.push(x3 * 0.8, z3 * 0.8);
        var c2 = CC[i2][j2];
        bGround.c.push(c2.r * tone, c2.g * tone, c2.b * tone);
      }
      /* 敷石。頂点は非共有なのでセル単位でトーンを変えられる＝石畳になる。
         2x2 の等分割にすると市松模様に見えてしまったので、行と列を
         1〜3セルの不規則な run で切って矩形の大きさ自体をばらけさせる。
         明度差も ±6% までに抑える（±15% では床が chessboard に読める）。 */
      var runI = [], runJ = [], rp = 0, rq = 0;
      for (i = 0; i <= FN; i++) { runI.push(rp); if (hash2(i * 4.7, 1.3) < 0.45) rp++; }
      for (j = 0; j <= FN; j++) { runJ.push(rq); if (hash2(2.9, j * 6.1) < 0.45) rq++; }
      for (i = 0; i < FN; i++) {
        for (j = 0; j < FN; j++) {
          var si = runI[i], sj = runJ[j];
          tone = 0.94 + 0.12 * hash2(si * 3.71 + sj * 0.7, sj * 2.93 - si * 0.4);
          // 弾着痕のまわりは石が跳ね上げられてバラバラ＝トーンが暴れる
          var mx = -FH + (i + 0.5) * FS, mz = -FH + (j + 0.5) * FS, ci;
          for (ci = 0; ci < CRATERS.length; ci++) {
            var cr2 = CRATERS[ci];
            var dd = Math.sqrt((mx - cr2.x) * (mx - cr2.x) + (mz - cr2.z) * (mz - cr2.z)) / cr2.r;
            if (dd < 1.8) tone *= 1 - 0.20 * smooth(1.8 - dd) * (hash2(i * 1.3, j * 1.9) - 0.35);
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

    /* ---------------------------------------------------------------------
       ブロック1個ごとの個体差。
       同じ寸法のブロックが同じ UV 窓で並ぶと、テクスチャがどれだけ良くても
       「同じ暗いブロックの繰り返し」に読める。対処は3点セットで、
         ① UV の切り出しを 90 度単位の回転＋オフセットでずらす
         ② 頂点カラーの明度を ±12% ずらす
         ③ 寸法自体を不揃いにする（幅・段高を乱数で刻む＝呼び出し側）
       ①②はここで、③は runCourse() が行う。マテリアルは共有のまま。
       ------------------------------------------------------------------ */
    function indiv(o, sx, sz) {
      var a = hash2(sx * 17.13 + 0.7, sz * 9.41 - 2.3);
      var b = hash2(sx * 5.77 + 3.1, sz * 23.91 - 1.7);
      var c2 = hash2(sx * 31.77 - 4.4, sz * 11.33 + 6.1);
      o.uvq = Math.floor(a * 4) & 3;
      o.uvou = b * 7.0;          // タイル境界をまたいで切り出しを移す
      o.uvov = c2 * 7.0;
      o.uvs = 0.84 + 0.14 * c2;  // 目の細かさもわずかに変える
      o.k = (o.k === undefined ? 1 : o.k) * (0.88 + 0.24 * b);
      return o;
    }

    /* 1段の石を「不揃いな幅で敷き詰める」。等分割をやめるのが要点。
       cb(a0, a1, index) に各石の区間を渡す。 */
    function runCourse(s0, s1, wMin, wMax, seed, cb) {
      var p = s0, idx = 0, guard = 0;
      // 段の切り出し位置自体もずらす（半個ずらしの馬目地では規則が残る）
      var lead = wMin * (0.25 + 0.75 * hash2(seed * 3.3, seed * 7.1));
      var first = true;
      while (p < s1 - 0.02 && guard++ < 200) {
        var w = wMin + (wMax - wMin) * hash2(p * 13.1 + seed * 2.7, seed * 5.3 - p * 3.9);
        if (first) { w = lead; first = false; }
        var a1 = Math.min(p + w, s1);
        if (a1 - p > 0.045) cb(p, a1, idx++);
        p = a1;
      }
    }

    /* 表皮の状態を3段階で持つ。深さが3層あると「剥がれ」が立体に読める。
        skin  : 切石が残っている（面 = AABB）
        brick : 表皮が飛んで煉瓦の下地が出た（0.5*SKIN 奥）
        void  : 煉瓦ごと抜けた穴（SKIN 奥の躯体が見える＝何も置かない）
       void は「抜け落ちた煉瓦」。テクスチャに置くと水玉模様になるので
       ジオメトリで、しかも塊（傷）として置く。 */
    function coverPanels(c, side, x0, x1, z0, z1, yBot, yTop, blow, wounds) {
      var nx = (side === 2) ? 1 : (side === 3 ? -1 : 0);
      var nz = (side === 0) ? 1 : (side === 1 ? -1 : 0);
      var lenAxisX = (nx === 0);
      var s0 = lenAxisX ? x0 : z0, s1 = lenAxisX ? x1 : z1;
      var face = Math.max(0, nx * WX + nz * WZ);
      // 長い面は区画に割って段をずらす（横一直線の目地を通さない）
      var segN = Math.max(1, Math.round((s1 - s0) / 1.9)), sgi;
      for (sgi = 0; sgi < segN; sgi++) {
      var g0 = s0 + (s1 - s0) * (sgi / segN), g1 = s0 + (s1 - s0) * ((sgi + 1) / segN);
      var sd = side * 9.7 + sgi * 6.1 + c.x * 1.3 + c.z * 2.7;
      var yy = yBot - 0.14 * hash2(sd * 2.1, sd * 3.9), ci = 0;
      while (yy < yTop - 0.02 && ci < 40) {
        // 段の高さも不揃いにする（0.20〜0.40m の乱積み）
        var rh = 0.20 + 0.20 * hash2(sd + ci * 2.9, c.x * 1.7 + c.z * 3.3 + ci);
        var y1 = Math.min(yy + rh, yTop);
        var yb = Math.max(yy, yBot);
        if (y1 - yb < 0.05) { yy = y1; ci++; continue; }
        var cyy = (yb + y1) * 0.5, hyy = (y1 - yb) * 0.5 - 0.007;
        var hf = clamp((cyy - yBot) / (yTop - yBot), 0, 1);
        runCourse(g0, g1, 0.30, 0.72, sd + ci * 4.3, function (a0, a1) {
          var half = (a1 - a0) * 0.5 - 0.007;
          if (half <= 0.012) return;
          var mid = (a0 + a1) * 0.5;
          var px = lenAxisX ? mid : ((x0 + x1) * 0.5 + nx * ((x1 - x0) * 0.5 - SKIN * 0.5));
          var pz = lenAxisX ? ((z0 + z1) * 0.5 + nz * ((z1 - z0) * 0.5 - SKIN * 0.5)) : mid;
          var hxx = lenAxisX ? half : SKIN * 0.5;
          var hzz = lenAxisX ? SKIN * 0.5 : half;

          // 傷（塊で剥がれた領域）に入っているか。散らさずに塊にするのが要点
          var w = 0, wi;
          for (wi = 0; wi < wounds.length; wi++) {
            var wd = wounds[wi];
            var du = (mid - wd.s) / wd.r, dv = (cyy - wd.y) / wd.h;
            w = Math.max(w, 1 - Math.sqrt(du * du + dv * dv));
          }
          var damage = clamp(w, 0, 1) * (0.55 + 0.45 * face) + face * (blow ? 0.30 : 0.16) * hf;
          var r1 = hash2(px * 7.31 + ci * 2.13, pz * 7.31 - a0 * 1.77);
          if (r1 < damage - 0.42) return;                       // 抜けた（穴）
          if (r1 < damage + 0.06) {
            // 表皮だけ飛んで煉瓦が出た
            box(bBrick, indiv({
              x: px - nx * SKIN * 0.5, y: cyy, z: pz - nz * SKIN * 0.5,
              hx: lenAxisX ? half : SKIN * 0.25, hy: hyy,
              hz: lenAxisX ? SKIN * 0.25 : half,
              col: C.brick, k: 0.74, noBottom: true
            }, px * 3.3 + a0, pz * 3.3 + cyy));
            return;
          }
          var t = hash2(px * 11.03, pz * 9.07 + cyy);
          var cc = _mix.copy(C.stone).lerp(C.concrete, t * 0.8);
          box(bStone, indiv({
            x: px, y: cyy, z: pz, hx: hxx, hy: hyy, hz: hzz,
            col: cc.clone(), k: 1.0, noBottom: true
          }, px * 2.7 + a0 * 1.3, pz * 2.7 + cyy * 1.3));
        });
        yy = y1;
        ci++;
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

        /* 芯：表皮の厚みだけ内側。抜けた所からこの暗い躯体が見える。
           煉瓦色ではなく濡れた暗色にしておくと「穴」として読める。 */
        box(bBrick, {
          x: c.x, y: (yBot + yTop) * 0.5, z: c.z,
          hx: c.hx - SKIN, hy: (yTop - yBot) * 0.5, hz: c.hz - SKIN,
          col: C.concreteWet, k: 0.9, noBottom: true, uvs: 1.4
        });

        var blow = !low;   // 高い遮蔽ほど大きく持って行かれている
        /* 傷（剥離の塊）。北面が正面から食らっているので北面に大きく、
           側面には浅く。1個ずつ乱数で散らすと「虫食い」になるため塊で置く。 */
        var wnN = [
          { s: c.x + rr(-0.6, 0.6) * c.hx, y: yTop * rr(0.45, 0.9), r: c.hx * rr(0.45, 0.8) + 0.25, h: (yTop - yBot) * rr(0.35, 0.6) },
          { s: c.x + rr(-0.9, 0.9) * c.hx, y: yTop * rr(0.55, 1.0), r: c.hx * rr(0.25, 0.5) + 0.2, h: (yTop - yBot) * rr(0.25, 0.45) }
        ];
        var wnS = [{ s: c.x + rr(-0.8, 0.8) * c.hx, y: yTop * rr(0.6, 1.0), r: c.hx * rr(0.2, 0.4) + 0.15, h: (yTop - yBot) * 0.3 }];
        var wnE = [{ s: c.z + rr(-0.7, 0.7) * c.hz, y: yTop * rr(0.5, 1.0), r: c.hz * rr(0.35, 0.7) + 0.18, h: (yTop - yBot) * 0.35 }];
        var wnW = [{ s: c.z + rr(-0.7, 0.7) * c.hz, y: yTop * rr(0.5, 1.0), r: c.hz * rr(0.35, 0.7) + 0.18, h: (yTop - yBot) * 0.35 }];
        coverPanels(c, 0, x0, x1, z0, z1, yBot, yTop, blow, wnS);   // +Z（南＝風下）
        coverPanels(c, 1, x0, x1, z0, z1, yBot, yTop, blow, wnN);   // -Z（北＝被弾面）
        coverPanels(c, 2, x0, x1, z0, z1, yBot, yTop, blow, wnE);
        coverPanels(c, 3, x0, x1, z0, z1, yBot, yTop, blow, wnW);

        /* 天端キャップ：footprint 全面を h ちょうどまで覆う。
           これが「当たり判定の天面＝見た目の天面」を保証する唯一の板。
           長手方向に目地で割るが、隙間は 0.012 の溝なので水平線は途切れない。 */
        var alongX = (c.hx >= c.hz);
        var q0 = alongX ? x0 : z0, q1 = alongX ? x1 : z1;
        var capY = c.h - capH * 0.5, ccc = c;
        runCourse(q0, q1, 0.55, 1.25, c.x * 3.1 + c.z * 5.9, function (a0, a1) {
          var mid = (a0 + a1) * 0.5, half = (a1 - a0) * 0.5;
          // 端は footprint の端にきっちり届かせる（天面の外周を欠けさせない）
          var e0 = (a0 - q0 < 0.02), e1 = (q1 - a1 < 0.02);
          var pad = 0.006;
          var lo = e0 ? a0 : a0 + pad, hi = e1 ? a1 : a1 - pad;
          box(bStone, indiv({
            x: alongX ? (lo + hi) * 0.5 : ccc.x, y: capY, z: alongX ? ccc.z : (lo + hi) * 0.5,
            hx: alongX ? (hi - lo) * 0.5 : ccc.hx, hy: capH * 0.5,
            hz: alongX ? ccc.hz : (hi - lo) * 0.5,
            col: C.concrete, k: 1.0, noBottom: true
          }, mid * 6.1 + ccc.z, ccc.x * 4.7 + half));
        });

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

      /* 躯体。内面側だけ WSKIN 分痩せさせ、そこに2層（表皮／煉瓦）を貼る。
         表皮も煉瓦も無い所は、この暗い躯体が奥に見える＝「抜けた穴」になる。
         穴は貫通させない（弾が止まるのに抜けて見えたら嘘）。 */
      var WSKIN = 0.11;
      box(bConc, {
        x: cx - inx * WSKIN * 0.5, y: (body - 0.2) * 0.5 - 0.1, z: cz - inz * WSKIN * 0.5,
        hx: hx - Math.abs(inx) * WSKIN * 0.5, hy: (body + 0.2) * 0.5,
        hz: hz - Math.abs(inz) * WSKIN * 0.5,
        col: C.concreteWet, k: 1.15, noBottom: true, uvs: 1.5
      });

      var alongX = (inx === 0);
      var L = alongX ? (maxx - minx) : (maxz - minz);
      var s0 = alongX ? minx : minz, s1 = alongX ? maxx : maxz;

      /* 砲撃の傷。壁の全長に等間隔で開けると「装飾」になるので、
         被弾側（北・西）に大きな傷を数個、下流側（南・東）は小さく浅く。
         これが「抜け落ちた煉瓦」の正体で、塊で開くから物語になる。 */
      var wounds = [], wn = blow ? 7 : 3, wi;
      for (wi = 0; wi < wn; wi++) {
        wounds.push({
          s: s0 + L * ((wi + 0.5) / wn + rr(-0.30, 0.30) / wn),
          y: body * (blow ? rr(0.35, 0.98) : rr(0.55, 1.0)),
          r: blow ? rr(0.7, 2.4) : rr(0.4, 1.0),
          h: blow ? rr(0.7, 1.9) : rr(0.35, 0.8)
        });
      }

      /* 内面の石積み。段高も石幅も不揃いにする（＝同じ矩形の敷き詰めをやめる）。
         これが無いと、テクスチャを何枚差し替えても格子の反復が残る。 */
      var yy = 0, ci = 0;
      /* 壁を長手方向に「区画」で割り、区画ごとに段の高さと切り出しを変える。
         全長 27m で段を通すと、横一直線の目地が5本走って壁が縞に読める。
         区画で段をずらすと目地が段違いになり、同時に「別々に建てた街区の壁」に見える。 */
      var segN = Math.max(1, Math.round(L / 3.4)), sgi;
      for (sgi = 0; sgi < segN; sgi++) {
      var g0 = s0 + L * (sgi / segN), g1 = s0 + L * ((sgi + 1) / segN);
      var seed0 = inx * 11.3 + inz * 4.9 + sgi * 8.9;
      yy = -0.05 - 0.28 * hash2(seed0 * 1.7, seed0 * 3.1);   // 段の開始位置を区画ごとにずらす
      ci = 0;
      while (yy < body - 0.03 && ci < 24) {
        var rh = 0.30 + 0.38 * hash2(seed0 + ci * 2.3, ci * 5.7 + sgi * 9.1);
        var y1 = Math.min(yy + rh, body);
        var yb = Math.max(yy, -0.05);
        if (y1 - yb < 0.06) { yy = y1; ci++; continue; }
        var mY = (yb + y1) * 0.5, hY = (y1 - yb) * 0.5 - 0.011;
        var hf = mY / body;
        runCourse(g0, g1, 0.42, 1.35, seed0 + ci * 3.7, function (a0, a1) {
          var half = (a1 - a0) * 0.5 - 0.011;
          if (half <= 0.02) return;
          var mid = (a0 + a1) * 0.5;
          var px = alongX ? mid : (cx + inx * (hx - WSKIN * 0.25));
          var pz = alongX ? (cz + inz * (hz - WSKIN * 0.25)) : mid;
          var w = 0, k2;
          for (k2 = 0; k2 < wounds.length; k2++) {
            var wd = wounds[k2];
            var du = (mid - wd.s) / wd.r, dv = (mY - wd.y) / wd.h;
            w = Math.max(w, 1 - Math.sqrt(du * du + dv * dv));
          }
          var damage = clamp(w, 0, 1) * 1.25 + (blow ? 0.10 : 0.03) * hf;
          var r1 = hash2(px * 6.13 + ci * 3.7, pz * 6.13 - a0 * 2.9);
          if (r1 < damage - 0.55) return;                    // 煉瓦ごと抜けた穴
          if (r1 < damage + 0.05) {
            // 漆喰が飛んで煉瓦の下地が出た（半分の深さ）
            box(bBrick, indiv({
              x: px - inx * WSKIN * 0.28, y: mY, z: pz - inz * WSKIN * 0.28,
              hx: alongX ? half : WSKIN * 0.25, hy: hY, hz: alongX ? WSKIN * 0.25 : half,
              col: C.brick, k: 0.9, noBottom: true
            }, px * 4.1 + a0, pz * 4.1 + mY));
            return;
          }
          var t = hash2(px * 2.23, pz * 2.23 + mY * 1.7);
          var cc = _mix.copy(C.plaster).lerp(C.concrete, t);
          box(bPlaster, indiv({
            x: px, y: mY, z: pz,
            hx: alongX ? half : WSKIN * 0.25, hy: hY, hz: alongX ? WSKIN * 0.25 : half,
            col: cc.clone(), k: 1.0, noBottom: true
          }, px * 3.7 + a0 * 1.9, pz * 3.7 + mY * 1.1));
        });
        yy = y1;
        ci++;
      }
      }
      var i;

      // 天端。4.2m ちょうどに面を作る（壁の当たり判定の天面と一致）
      // 天端は全長 27m の直線になるので明るくしすぎない（白い一本線に見える）。
      box(bConc, { x: cx, y: WH - capH * 0.5, z: cz, hx: hx, hy: capH * 0.5, hz: hz, col: C.concreteDark, k: 0.78, noBottom: true });

      /* 天端より上の崩れ。ここだけは自由に壊せる（当たり判定の外＝空） */
      var step = 1.05;   // 冠の刻みを細かくして天端の直線を輪郭で壊す
      var n2 = Math.floor(L / step);
      for (i = 0; i < n2; i++) {
        // 等間隔に置くと城の狭間（クレネル）に見える。間隔自体をばらす
        var t = (i + 0.5 + rr(-0.34, 0.34)) / n2;
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
       すべて北側の上部を失い、南へ倒れかけている＝地平線が原因を語る。
       旧市街なので基本は「低く横に長い塊」。高いのは鐘楼・煙突など数本だけにして、
       水平の連なりを一度だけ縦線が破る、という秩序の壊れ方にする。
       ================================================================== */
    (function buildSkyline() {
      // 遠景は実ライティングに載せない（bakeFar で焼き込む）
      function fbox(o) { o.far = true; box(bFar, o); }
      // 地平の板。壁の外に虚空が見えると廃墟が浮くので必ず敷く
      /* 天面を y=-0.30 に置く。-0.08 にしていたら弾着痕の底（-0.115）より上に来て、
         クレーターの中から明るい地平板が顔を出していた（実際に白い斑として見えた）。 */
      fbox({ x: 0, y: -0.40, z: 0, hx: 95, hy: 0.10, hz: 95, col: C.ground, k: 0.62, fogK: 0.66, noBottom: true });

      /* アリーナ（外壁の外面 ±13.6）に遠景の箱を1つも重ねない。
         中心座標ではなく AABB の重なりで判定すること。中心だけを見ると
         「片軸だけ遠い横長の建物」がアリーナ内へ張り出す（実際に起きた）。 */
      var KEEP = AX + WT + 1.2;
      function overlaps(x, z, ex, ez) {
        return (Math.abs(x) - ex < KEEP) && (Math.abs(z) - ez < KEEP);
      }

      /* リングごとに「疎らで低い手前」→「密でやや高い奥」。手前を詰め込むと
         空が消えて地平線が読めなくなり、逆光の層が成立しない。 */
      var rings = [
        { r0: 15.6, r1: 22.0, n: 18, h0: 3.6, h1: 7.5, p: 0.58 },
        { r0: 22.0, r1: 33.0, n: 26, h0: 4.5, h1: 10.5, p: 0.74 },
        { r0: 33.0, r1: 47.0, n: 28, h0: 5.5, h1: 13.0, p: 0.86 },
        { r0: 47.0, r1: 70.0, n: 26, h0: 6.5, h1: 15.0, p: 0.95 }
      ];
      var ri, k;
      for (ri = 0; ri < rings.length; ri++) {
        var R = rings[ri];
        for (k = 0; k < R.n; k++) {
          if (rnd() > R.p) continue;                 // 隙間＝空。地平線を読ませる
          var ang = (k / R.n) * TAU + rr(-0.4, 0.4) * (TAU / R.n);
          var rad = rr(R.r0, R.r1);
          var bx = Math.cos(ang) * rad, bz = Math.sin(ang) * rad;
          // 旧市街の街区：奥行きより間口が広い横長の塊
          var hw = rr(2.2, 5.0), hd = rr(2.0, 4.2);
          if (overlaps(bx, bz, hw, hd)) continue;
          var H = rr(R.h0, R.h1);
          var fogK = Math.pow(clamp((rad - 13.5) / 52, 0, 1), 0.70) * 0.72;
          var yaw = rr(-0.35, 0.35);
          var baseCol = (rnd() < 0.4) ? C.plaster : (rnd() < 0.5 ? C.concrete : C.stone);

          // 下半分：ほぼ健在
          fbox({ x: bx, y: H * 0.30, z: bz, hx: hw, hy: H * 0.30, hz: hd, ry: yaw, col: baseCol, k: rr(0.85, 1.05), fogK: fogK, noBottom: true });
          // 中段：北側が削られて一回り小さく、南へ寄る
          var sh2 = rr(0.58, 0.84);
          fbox({
            x: bx + DX * hw * (1 - sh2) * 1.0, y: H * 0.72, z: bz + DZ * hd * (1 - sh2) * 1.0,
            hx: hw * sh2, hy: H * 0.14, hz: hd * sh2, ry: yaw,
            col: baseCol, k: rr(0.78, 0.98), fogK: fogK, noBottom: true
          });
          // 上段：さらに削られた残骸。北側の角が無い
          var sh3 = sh2 * rr(0.35, 0.68);
          var topH = rr(0.08, 0.26) * H;
          fbox({
            x: bx + DX * hw * (1 - sh3) * 1.1, y: H * 0.86 + topH * 0.5, z: bz + DZ * hd * (1 - sh3) * 1.1,
            hx: hw * sh3, hy: topH * 0.5, hz: hd * sh3, ry: yaw + rr(-0.1, 0.1),
            col: baseCol, k: rr(0.72, 0.92), fogK: fogK, noBottom: true
          });
          // 南へ倒れかけた床スラブ。輪郭に斜めの線を1本だけ入れて倒壊方向を出す
          if (rnd() < 0.55) {
            var lean3 = rr(0.45, 1.05);
            var sx2 = bx + DX * (hw + rr(0.4, 1.4)), sz2 = bz + DZ * (hd + rr(0.4, 1.4));
            if (!overlaps(sx2, sz2, 2.4, 2.4)) {
              fbox({
                x: sx2, y: H * rr(0.42, 0.74), z: sz2,
                hx: rr(0.8, 2.0), hy: 0.12, hz: rr(0.7, 1.6),
                ry: rr(0, TAU), rx: lean3 * DZ, rz: -lean3 * DX,
                col: C.concreteDark, k: rr(0.8, 1.0), fogK: fogK, noBottom: true
              });
            }
          }
        }
      }

      /* 生き残った鐘楼・煙突。数を絞ることで「1本だけ立っている」強さが出る。
         これも全部が北側を削られ、南へ折れかけている。 */
      var LAND = 11;
      for (k = 0; k < LAND; k++) {
        var a2 = (k / LAND) * TAU + rr(-0.3, 0.3);
        var r2 = rr(20, 62);
        var lx = Math.cos(a2) * r2, lz = Math.sin(a2) * r2, tw0 = rr(0.75, 1.5);
        if (overlaps(lx, lz, tw0, tw0)) continue;
        var fk2 = Math.pow(clamp((r2 - 13.5) / 52, 0, 1), 0.70) * 0.72;
        var th2 = rr(11, 21), tw = tw0;
        fbox({ x: lx, y: th2 * 0.42, z: lz, hx: tw, hy: th2 * 0.42, hz: tw * rr(0.85, 1.15), ry: rr(0, TAU), col: C.stone, k: rr(0.8, 1.0), fogK: fk2, noBottom: true });
        // 折れた頂部が南へずれて残る
        fbox({
          x: lx + DX * tw * 0.9, y: th2 * 0.9, z: lz + DZ * tw * 0.9,
          hx: tw * 0.62, hy: th2 * 0.10, hz: tw * 0.62, ry: rr(0, TAU),
          col: C.stone, k: rr(0.7, 0.9), fogK: fk2, noBottom: true
        });
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
      /* 遠景に map を貼らない。数十メートル先では1タイルが数ピクセルに落ち、
         模様が迷彩柄として読めてしまう。空気遠近を焼いた頂点色だけで持たせる。 */
      [bFar, null, false, false, 'envSkyline', true]
    ];
    for (var q = 0; q < LIST.length; q++) {
      var mm = toMesh(LIST[q][0], LIST[q][1], LIST[q][2], LIST[q][3], LIST[q][4], LIST[q][5]);
      if (mm) G.add(mm);
    }
    return G;
  };
})(typeof window !== 'undefined' ? window : globalThis);

/* =============================================================================
   ashline/art/vfx.js — ASH.vfx(T, scene)

   狙い（§3 ヒットフィードバック）：
     1発の結果が「外れ／胴命中／致命打」の3段階に、色と形だけで読み分けられること。
       world … 冷たい白の粉塵プルーム ＋ 白い火花    （暖色を1滴も使わない）
       enemy … 暖色の飛沫（bloodMist）＋ 装甲片の火花（impactSpark）の2層
       head  … enemy の全部を大きく長く明るくし、さらに
                「衝撃リング」と「花弁状のスターバースト」という
                enemy には無い形を足す＝当たった瞬間に格が違うと分かる

   構成（追加ドローコールは 3 本だけ）:
     A. 加算パーティクル（InstancedBufferGeometry / 260個 / AdditiveBlending）
        マズルの花弁とコア、火花の筋、衝撃リング、火の粉。
     B. 減算しない半透明パーティクル（同 260個 / NormalBlending）
        白い粉塵と、暖色の飛沫（血霧）。加算だと暗い赤が飛んで白くなるので分ける。
     C. 曳光（BufferGeometry / 14本 ×2枚 / AdditiveBlending）
        「線」ではなく、先頭の光球＋そこから後ろへ細くなる短い尾。

   ビルボード方式：頂点シェーダでビュー空間の XY に四角形を張る。
     - gl_PointSize を使わないので、画面解像度に依存せずワールド単位で寸法が決まる
     - 1粒ごとに回転と縦横比を持てる ＝ 火花を「速度方向に伸びた筋」にできる
     - 速度をビュー空間に落として角度を出すので、カメラを渡してもらう必要がない

   プール：初期化時に全部確保し、リングバッファで使い回す。
     実行中に new / 配列リテラル / オブジェクトリテラルを一切作らない。
     発生パラメータは使い回しの構造体 E に書いてから emit() する（引数束の生成を避ける）。

   色は ASH.palette からのみ。生の16進は書かない。ES5。外部リソースなし。
   ========================================================================== */
(function (g) {
  var ASH = g.ASH = g.ASH || {};

  ASH.vfx = function (T, scene) {
    var P = ASH.palette;

    /* 改行連結。テンプレートリテラルは ES5 縛りのため使わない。 */
    function J(a) { return a.join('\n'); }

    /* 決定的な擬似乱数（Lehmer）。同じ呼び出し順なら同じ絵が出る＝
       「描画を見て直す」作業が成立する。実戦では発砲ごとに種が進むので
       毎回違う散り方になる。Math.random と違って再現できるのが利点。 */
    var seed = 987654321;
    function rnd() {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    }
    function rr(a, b) { return a + (b - a) * rnd(); }

    /* =======================================================================
       0. スプライト・アトラス（Canvas 2D で手続き生成）
       -----------------------------------------------------------------------
       外部テクスチャは禁止。1枚 512x256 に 128px のタイルを 8 枚並べる。
       アトラスは「白のマスク」でしかない。色は必ずパーティクル側（＝palette）
       から与える。ここに色を描くと palette 一元管理が壊れる。
       ===================================================================== */
    var TILE_GLOW = 0;    // 柔らかい丸。発光の芯、粉塵の芯
    var TILE_HOT = 1;     // 中心が締まった丸。白熱コア
    var TILE_PETAL = 2;   // 放射状の花弁＋コア。マズル／致命打の記号
    var TILE_STREAK = 3;  // 縦長の筋。火花と飛沫
    var TILE_PUFF = 4;    // 不定形の雲。粉塵
    var TILE_RING = 5;    // 細い輪。衝撃リング（致命打だけが持つ形）
    var TILE_DROP = 6;    // 小さな不定形の塊。血の粒
    var TILE_PUFF2 = 7;   // 粉塵の別カット（同じ形の反復を避ける）

    function buildAtlas() {
      var cv = document.createElement('canvas');
      cv.width = 512; cv.height = 256;
      var c = cv.getContext('2d');
      var TW = 128;

      /* タイル座標。flipY=false で貼るので、左上原点＝タイル0が左上。 */
      function org(t, o) { o[0] = (t % 4) * TW; o[1] = ((t / 4) | 0) * TW; }
      var o0 = [0, 0];

      /* 白のみで描く（マスクなので色を持たせない）。 */
      function W(a) { return 'rgba(255,255,255,' + a.toFixed(4) + ')'; }

      /* 減衰の違う放射グラデーション。stops は [位置, 不透明度] の並び。 */
      function blob(cx, cy, r, a0, pw) {
        var gr = c.createRadialGradient(cx, cy, 0, cx, cy, r);
        var k, s;
        for (k = 0; k <= 6; k++) {
          s = k / 6;
          gr.addColorStop(s, W(a0 * Math.pow(1 - s, pw)));
        }
        c.fillStyle = gr;
        c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2); c.fill();
      }

      c.clearRect(0, 0, 512, 256);
      c.globalCompositeOperation = 'lighter';

      /* --- 0: 柔らかい丸 -----------------------------------------------------
         縁が立つと「玉」に見える。指数を寝かせて空気に溶ける減衰にする。 */
      org(TILE_GLOW, o0);
      blob(o0[0] + 64, o0[1] + 64, 60, 0.95, 2.6);
      blob(o0[0] + 64, o0[1] + 64, 26, 0.55, 2.0);

      /* --- 1: 白熱コア -------------------------------------------------------
         中心だけ潰れるほど濃く、外はすぐ落ちる。ブルームの種になる形。 */
      org(TILE_HOT, o0);
      blob(o0[0] + 64, o0[1] + 64, 58, 0.42, 4.6);
      blob(o0[0] + 64, o0[1] + 64, 22, 1.00, 1.6);
      blob(o0[0] + 64, o0[1] + 64, 9, 1.00, 0.7);

      /* --- 2: 放射状の花弁＋コア ---------------------------------------------
         マズルフラッシュは2フレームしか映らない。丸い光では「光った」しか伝わらず
         「撃った」にならない。長さの違う花弁を放射状に置くと、1枚の絵でも
         中心から爆発的に押し出された形として読める。
         長短を交互にするのは、等長だと歯車状の規則的な図形に見えるため。 */
      org(TILE_PETAL, o0);
      var pc = 9, pi, pang, plen, pwid;
      for (pi = 0; pi < pc; pi++) {
        pang = (pi / pc) * Math.PI * 2 + 0.13;
        plen = (pi % 2 === 0) ? 58 : 36;
        plen *= 0.82 + rnd() * 0.36;
        pwid = (pi % 2 === 0) ? 13 : 9;
        c.save();
        c.translate(o0[0] + 64, o0[1] + 64);
        c.rotate(pang);
        /* 円を潰して花弁にする。中心寄りに寄せて根元を太く見せる。 */
        c.translate(0, -plen * 0.42);
        c.scale(pwid / plen, 1.0);
        blob(0, 0, plen, 0.62, 2.2);
        c.restore();
      }
      blob(o0[0] + 64, o0[1] + 64, 30, 0.85, 2.2);
      blob(o0[0] + 64, o0[1] + 64, 13, 1.00, 1.0);

      /* --- 3: 筋 -------------------------------------------------------------
         火花は点ではなく「移動した軌跡」として見える。頭を明るく、尾を細く。
         四角形側で縦横比を変えるので、ここでは素直な縦長にしておく。 */
      org(TILE_STREAK, o0);
      c.save();
      c.translate(o0[0] + 64, o0[1] + 64);
      c.scale(0.20, 1.0);
      blob(0, 0, 60, 0.80, 2.0);
      c.restore();
      c.save();
      c.translate(o0[0] + 64, o0[1] + 64);
      c.scale(0.075, 0.96);
      blob(0, 0, 60, 1.00, 1.3);
      c.restore();
      blob(o0[0] + 64, o0[1] + 44, 15, 0.95, 1.8);   // 進行方向側の頭を明るく

      /* --- 4/7: 粉塵の雲 -----------------------------------------------------
         きれいな円を重ねると石鹸の泡になる。半径と位置をばらした塊を
         加算で積み、輪郭に凹凸を作る。中心は抜けを残して詰め過ぎない。 */
      function puff(tile, n) {
        org(tile, o0);
        var q, qa, qr, qd;
        for (q = 0; q < n; q++) {
          qa = rnd() * Math.PI * 2;
          qd = Math.pow(rnd(), 0.65) * 26;
          qr = 16 + rnd() * 26;
          blob(o0[0] + 64 + Math.cos(qa) * qd, o0[1] + 64 + Math.sin(qa) * qd, qr, 0.20, 2.4);
        }
        blob(o0[0] + 64, o0[1] + 64, 44, 0.16, 2.8);
      }
      puff(TILE_PUFF, 16);
      puff(TILE_PUFF2, 16);

      /* --- 5: 衝撃リング -----------------------------------------------------
         致命打だけが持つ形。細い輪＋外へ抜ける短い棘。
         輪は真円だと記号的すぎるので、棘の長さを乱してエネルギーを出す。 */
      org(TILE_RING, o0);
      var rcx = o0[0] + 64, rcy = o0[1] + 64;
      var rg = c.createRadialGradient(rcx, rcy, 0, rcx, rcy, 60);
      rg.addColorStop(0.00, W(0));
      rg.addColorStop(0.58, W(0));
      rg.addColorStop(0.74, W(0.95));
      rg.addColorStop(0.84, W(0.42));
      rg.addColorStop(1.00, W(0));
      c.fillStyle = rg;
      c.beginPath(); c.arc(rcx, rcy, 60, 0, Math.PI * 2); c.fill();
      /* 棘は少なく・長さを大きく乱す。等間隔の細かい棘は「輪」ではなく
         装飾的な紋章に見えてしまう。 */
      var sp, sang, slen;
      for (sp = 0; sp < 9; sp++) {
        sang = (sp / 9) * Math.PI * 2 + rnd() * 0.55;
        slen = 10 + rnd() * 26;
        c.save();
        c.translate(rcx + Math.cos(sang) * 44, rcy + Math.sin(sang) * 44);
        c.rotate(sang + Math.PI * 0.5);
        c.scale(0.13, 1.0);
        blob(0, 0, slen, 0.70, 1.6);
        c.restore();
      }

      /* --- 6: 血の粒 ---------------------------------------------------------
         霧より粒立った塊。少数の小さな塊を寄せて不定形にする。 */
      org(TILE_DROP, o0);
      var dq;
      for (dq = 0; dq < 5; dq++) {
        blob(o0[0] + 64 + (rnd() - 0.5) * 26, o0[1] + 64 + (rnd() - 0.5) * 30,
          18 + rnd() * 16, 0.55, 1.9);
      }

      c.globalCompositeOperation = 'source-over';

      var tex = new T.CanvasTexture(cv);
      tex.flipY = false;                    // タイル番号と描画位置を一致させる
      tex.colorSpace = T.NoColorSpace;      // 白のマスク。色変換を通す意味がない
      tex.minFilter = T.LinearFilter;       // ミップを作るとタイル同士が滲む
      tex.magFilter = T.LinearFilter;
      tex.generateMipmaps = false;
      tex.wrapS = T.ClampToEdgeWrapping;
      tex.wrapT = T.ClampToEdgeWrapping;
      return tex;
    }

    var ATLAS = buildAtlas();

    /* =======================================================================
       1. 色（すべて ASH.palette 由来）
       -----------------------------------------------------------------------
       ACESFilmic は彩度と明度を落とす。加算のコアは 1.0 を大きく超える値を
       入れて初めて画面で白熱する。逆に半透明側は上げ過ぎると白い霧になるので
       倍率を控える。数値は描画を見ながら詰めたもの。
       ===================================================================== */
    function C3(hex, mul) {
      var c = ASH.shade(T, hex, mul);
      var a = new Float32Array(3);
      a[0] = c.r; a[1] = c.g; a[2] = c.b;
      return a;
    }
    var COL = {
      core: C3(P.muzzleCore, 2.7),        // 白熱。マズル芯と致命打の芯
      glow: C3(P.muzzleGlow, 2.1),        // 花弁のオレンジ
      ember: C3(P.ember, 1.9),            // 火の粉
      spark: C3(P.impactSpark, 2.6),      // 装甲片の火花（暖色）
      sparkHot: C3(P.impactSpark, 4.2),
      tracer: C3(P.tracer, 2.3),
      tracerHot: C3(P.muzzleCore, 3.0),
      /* 外れ＝寒色だけ。uiInk / uiDim / playerTrim は palette の中で
         唯一「暖色でない明るい灰」なので、白い粉塵と白い火花はここから取る。 */
      coldSpark: C3(P.uiInk, 3.2),
      dust: C3(P.uiInk, 1.35),
      dustDim: C3(P.uiDim, 1.05),
      dustCool: C3(P.playerTrim, 1.15),
      /* 命中＝暖色。bloodMist は非常に暗い酸化赤（0x5e1c17）で、
         そのまま置くと画面では黒い煤にしかならない。
         明・中・暗の3段に割って初めて「赤い塊が飛んだ」に見える。
         倍率は描画を見ながら上げた値。 */
      blood: C3(P.bloodMist, 8.0),
      bloodDim: C3(P.bloodMist, 5.4),
      bloodDark: C3(P.bloodMist, 3.2),
      bloodHot: C3(P.enemyTrim, 1.25),    // 飛沫の光っている縁（上げすぎるとクリーム色＝粉塵に見える）
      smoke: C3(P.ash, 0.85)
    };

    /* =======================================================================
       2. パーティクル系（加算 / 半透明の2本）
       ===================================================================== */

    var partVert = J([
      'attribute vec3 aPos;',    // 中心（ワールド）
      'attribute vec2 aSize;',   // 横幅・縦幅（ワールド m）
      'attribute vec4 aCol;',    // rgb + 不透明度
      'attribute vec3 aRT;',     // x:回転 y:タイル番号 z:速度整列の度合い
      'attribute vec3 aVel;',    // 速度方向（ワールド）
      'varying vec2 vUv;',
      'varying vec4 vCol;',
      'void main() {',
      '  vec4 mv = modelViewMatrix * vec4(aPos, 1.0);',
      /* 速度整列：ワールドの速度をビュー空間へ落とし、画面上の向きを角度にする。
         これで火花が「飛んだ方向へ伸びた筋」になる。カメラを引数で
         受け取らなくて済むのがこの方式の利点。 */
      '  vec3 vv = (modelViewMatrix * vec4(aVel, 0.0)).xyz;',
      '  float vl2 = dot(vv.xy, vv.xy);',
      '  float velAng = (vl2 > 1e-8) ? atan(vv.y, vv.x) - 1.5707963 : 0.0;',
      '  float ang = mix(aRT.x, velAng, aRT.z);',
      /* カメラ正面へ飛ぶ火花は画面上ではほとんど動かない。
         そのまま長い筋にすると嘘になるので、画面に投影された速度の割合で縮める。 */
      '  float f = length(vv);',
      '  float shrink = (f > 1e-5) ? clamp(sqrt(vl2) / f, 0.34, 1.0) : 1.0;',
      '  float ly = aSize.y * mix(1.0, shrink, aRT.z);',
      '  vec2 q = vec2(position.x * aSize.x, position.y * ly);',
      '  float cs = cos(ang), sn = sin(ang);',
      '  mv.xy += vec2(q.x * cs - q.y * sn, q.x * sn + q.y * cs);',
      '  gl_Position = projectionMatrix * mv;',
      /* アトラスは 4x2。タイル番号から左上原点を出す。 */
      '  float t = aRT.y;',
      '  vec2 off = vec2(floor(mod(t, 4.0)) * 0.25, floor(t * 0.25) * 0.5);',
      '  vUv = off + uv * vec2(0.25, 0.5);',
      '  vCol = aCol;',
      '}'
    ]);

    /* 加算側：濃い所ほど白熱させる。マスクの濃度を「温度」として読み替えると、
       1枚のスプライトでもコアと外縁の色温度差が出る。 */
    var addFrag = J([
      'uniform sampler2D uMap;',
      'varying vec2 vUv;',
      'varying vec4 vCol;',
      'void main() {',
      '  float m = texture2D(uMap, vUv).a;',
      '  float a = m * vCol.a;',
      '  if (a < 0.003) discard;',
      '  vec3 c = vCol.rgb * (1.0 + 1.9 * pow(m, 3.0));',
      '  gl_FragColor = vec4(c, a);',
      '  #include <tonemapping_fragment>',
      '  #include <colorspace_fragment>',
      '}'
    ]);

    /* 半透明側：粉塵と血霧。白熱させない。芯だけわずかに濃くして厚みを出す。 */
    var alphaFrag = J([
      'uniform sampler2D uMap;',
      'varying vec2 vUv;',
      'varying vec4 vCol;',
      'void main() {',
      '  float m = texture2D(uMap, vUv).a;',
      '  float a = m * vCol.a;',
      '  if (a < 0.004) discard;',
      '  vec3 c = vCol.rgb * (0.82 + 0.46 * m);',
      '  gl_FragColor = vec4(c, a);',
      '  #include <tonemapping_fragment>',
      '  #include <colorspace_fragment>',
      '}'
    ]);

    /* 1枚の四角形（-0.5..0.5）。全インスタンスで共有する。 */
    function quadGeo() {
      var geo = new T.InstancedBufferGeometry();
      var pos = new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]);
      var uv = new Float32Array([0, 1, 1, 1, 1, 0, 0, 0]);
      var idx = new Uint16Array([0, 1, 2, 0, 2, 3]);
      geo.setAttribute('position', new T.BufferAttribute(pos, 3));
      geo.setAttribute('uv', new T.BufferAttribute(uv, 2));
      geo.setIndex(new T.BufferAttribute(idx, 1));
      return geo;
    }

    /* --- パーティクル・プール -------------------------------------------------
       すべて型付き配列。生成後に確保は一切しない。
       リングバッファなので、溢れたら最も古い粒を上書きする（＝上限が保証される）。 */
    function makeSys(count, additive, order) {
      var s = {};
      s.n = count;
      s.head = 0;
      s.live = 0;

      s.aPos = new Float32Array(count * 3);
      s.aSize = new Float32Array(count * 2);
      s.aCol = new Float32Array(count * 4);
      s.aRT = new Float32Array(count * 3);
      s.aVel = new Float32Array(count * 3);

      /* シミュレーション用（描画属性とは別に持つ）。 */
      s.vx = new Float32Array(count);
      s.vy = new Float32Array(count);
      s.vz = new Float32Array(count);
      s.age = new Float32Array(count);
      s.ttl = new Float32Array(count);
      s.s0x = new Float32Array(count);
      s.s1x = new Float32Array(count);
      s.s0y = new Float32Array(count);
      s.s1y = new Float32Array(count);
      s.grow = new Float32Array(count);
      s.rotv = new Float32Array(count);
      s.a0 = new Float32Array(count);
      s.fade = new Float32Array(count);
      s.drag = new Float32Array(count);
      s.grav = new Float32Array(count);
      s.alive = new Uint8Array(count);

      var geo = quadGeo();
      s.bPos = new T.InstancedBufferAttribute(s.aPos, 3);
      s.bSize = new T.InstancedBufferAttribute(s.aSize, 2);
      s.bCol = new T.InstancedBufferAttribute(s.aCol, 4);
      s.bRT = new T.InstancedBufferAttribute(s.aRT, 3);
      s.bVel = new T.InstancedBufferAttribute(s.aVel, 3);
      s.bPos.setUsage(T.DynamicDrawUsage);
      s.bSize.setUsage(T.DynamicDrawUsage);
      s.bCol.setUsage(T.DynamicDrawUsage);
      s.bRT.setUsage(T.DynamicDrawUsage);
      s.bVel.setUsage(T.DynamicDrawUsage);
      geo.setAttribute('aPos', s.bPos);
      geo.setAttribute('aSize', s.bSize);
      geo.setAttribute('aCol', s.bCol);
      geo.setAttribute('aRT', s.bRT);
      geo.setAttribute('aVel', s.bVel);
      geo.instanceCount = count;

      var mat = new T.ShaderMaterial({
        uniforms: { uMap: { value: ATLAS } },
        vertexShader: partVert,
        fragmentShader: additive ? addFrag : alphaFrag,
        transparent: true,
        depthWrite: false,
        depthTest: true,
        blending: additive ? T.AdditiveBlending : T.NormalBlending,
        side: T.DoubleSide,
        fog: false
      });

      var mesh = new T.Mesh(geo, mat);
      mesh.frustumCulled = false;      // 中身が毎フレーム動くので境界球は当てにならない
      mesh.matrixAutoUpdate = false;   // 原点固定。ワールド座標でそのまま描く
      mesh.renderOrder = order;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      scene.add(mesh);
      s.mesh = mesh;
      s.dirty = true;
      return s;
    }

    /* 予算：加算260 + 半透明260 + 曳光14本×2枚 = 1,096 三角形（上限 8,000）。
       同時に走る演出は「マズル1 + 曳光1 + 命中1」程度なので、
       致命打（最大65粒）が連続しても数十発ぶんを取り回せる。 */
    var ADD = makeSys(260, true, 102);
    var ALP = makeSys(260, false, 100);

    /* --- 発生パラメータの使い回し構造体 --------------------------------------
       emit(sys) の引数を毎回オブジェクトで渡すと、1発で数十個のゴミが出る。
       モジュール寿命で1つだけ持ち、書き換えて使う。 */
    var E = {
      x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
      ttl: 0.3, s0x: 0.1, s1x: 0.1, s0y: 0.1, s1y: 0.1,
      grow: 1, rot: 0, rotv: 0, tile: 0, align: 0,
      r: 1, g: 1, b: 1, a0: 1, fade: 1, drag: 0, grav: 0
    };
    function reset() {
      E.vx = 0; E.vy = 0; E.vz = 0;
      E.ttl = 0.3; E.grow = 1; E.rot = 0; E.rotv = 0;
      E.tile = TILE_GLOW; E.align = 0;
      E.a0 = 1; E.fade = 1; E.drag = 0; E.grav = 0;
    }
    /* 色の指定。COL の 3 要素配列をそのまま渡す（新規生成なし）。 */
    function tint(c, mul) {
      E.r = c[0] * mul; E.g = c[1] * mul; E.b = c[2] * mul;
    }
    function size(x0, x1, y0, y1) { E.s0x = x0; E.s1x = x1; E.s0y = y0; E.s1y = y1; }
    function sizeU(a, b) { E.s0x = a; E.s1x = b; E.s0y = a; E.s1y = b; }

    function emit(s) {
      var i = s.head;
      s.head = (i + 1) % s.n;
      if (!s.alive[i]) s.live++;
      s.alive[i] = 1;

      var i3 = i * 3, i2 = i * 2, i4 = i * 4;
      s.aPos[i3] = E.x; s.aPos[i3 + 1] = E.y; s.aPos[i3 + 2] = E.z;
      s.vx[i] = E.vx; s.vy[i] = E.vy; s.vz[i] = E.vz;
      s.aVel[i3] = E.vx; s.aVel[i3 + 1] = E.vy; s.aVel[i3 + 2] = E.vz;
      s.age[i] = 0; s.ttl[i] = E.ttl;
      s.s0x[i] = E.s0x; s.s1x[i] = E.s1x; s.s0y[i] = E.s0y; s.s1y[i] = E.s1y;
      s.grow[i] = E.grow; s.rotv[i] = E.rotv;
      s.a0[i] = E.a0; s.fade[i] = E.fade;
      s.drag[i] = E.drag; s.grav[i] = E.grav;
      s.aSize[i2] = E.s0x; s.aSize[i2 + 1] = E.s0y;
      s.aCol[i4] = E.r; s.aCol[i4 + 1] = E.g; s.aCol[i4 + 2] = E.b; s.aCol[i4 + 3] = E.a0;
      s.aRT[i3] = E.rot; s.aRT[i3 + 1] = E.tile; s.aRT[i3 + 2] = E.align;
      s.dirty = true;
    }

    function stepSys(s, dt) {
      if (s.live === 0) {
        if (s.dirty) { flush(s); s.dirty = false; }
        return;
      }
      var i, i3, i2, i4, p, lf, gp, d;
      for (i = 0; i < s.n; i++) {
        if (!s.alive[i]) continue;
        s.age[i] += dt;
        i3 = i * 3; i2 = i * 2; i4 = i * 4;
        if (s.age[i] >= s.ttl[i]) {
          s.alive[i] = 0; s.live--;
          s.aCol[i4 + 3] = 0; s.aSize[i2] = 0; s.aSize[i2 + 1] = 0;
          continue;
        }
        /* 空気抵抗は指数減衰の1次近似。dt が大きいと発散するので下限で止める。 */
        d = 1 - s.drag[i] * dt; if (d < 0) d = 0;
        s.vx[i] *= d; s.vy[i] *= d; s.vz[i] *= d;
        s.vy[i] -= s.grav[i] * dt;
        s.aPos[i3] += s.vx[i] * dt;
        s.aPos[i3 + 1] += s.vy[i] * dt;
        s.aPos[i3 + 2] += s.vz[i] * dt;
        s.aVel[i3] = s.vx[i]; s.aVel[i3 + 1] = s.vy[i]; s.aVel[i3 + 2] = s.vz[i];

        p = s.age[i] / s.ttl[i];
        lf = 1 - p;
        /* grow < 1 で「最初のフレームでもう広がっている」曲線になる。
           命中の1フレーム目に点にしか見えないのが、手触りが死ぬ最大の原因。 */
        gp = (s.grow[i] === 1) ? p : Math.pow(p, s.grow[i]);
        s.aSize[i2] = s.s0x[i] + (s.s1x[i] - s.s0x[i]) * gp;
        s.aSize[i2 + 1] = s.s0y[i] + (s.s1y[i] - s.s0y[i]) * gp;
        s.aRT[i3] += s.rotv[i] * dt;
        s.aCol[i4 + 3] = s.a0[i] * ((s.fade[i] === 1) ? lf : Math.pow(lf, s.fade[i]));
      }
      flush(s);
      s.dirty = true;
    }
    function flush(s) {
      s.bPos.needsUpdate = true;
      s.bSize.needsUpdate = true;
      s.bCol.needsUpdate = true;
      s.bRT.needsUpdate = true;
      s.bVel.needsUpdate = true;
    }

    /* =======================================================================
       3. 曳光
       -----------------------------------------------------------------------
       「線」に見せないための作り：
         - 弾は瞬間移動せず、寿命の中を等速で進む。尾は頭の後ろ 2.2m だけ。
         - 尾は頭で太く、末端で細い（涙形）＝進行方向が形で読める。
         - 頭には別の四角形で光球を置く。これが「速度のある光」の正体。
       ビルボードは頂点シェーダで cross(進行方向, 視線) を取って張る。
       ===================================================================== */
    var NT = 14;
    var TAIL = 2.2;

    var trVert = J([
      'attribute vec3 aA;',      // 尾の端
      'attribute vec3 aB;',      // 頭
      'attribute vec4 aPar;',    // x:種別(0=尾 1=光球) y:太さ zw:未使用
      'attribute vec4 aCol;',
      'varying vec2 vUv;',
      'varying vec4 vCol;',
      'varying float vKind;',
      'void main() {',
      '  vUv = uv; vCol = aCol; vKind = aPar.x;',
      '  if (aPar.x > 0.5) {',
      /* 光球：頭の位置にビュー平面のまま四角形を張る。 */
      '    vec4 mv = modelViewMatrix * vec4(aB, 1.0);',
      '    mv.xy += (uv - 0.5) * 2.0 * aPar.y;',
      '    gl_Position = projectionMatrix * mv;',
      '  } else {',
      /* 尾：線分に沿って、視線と直交する向きへ太さを振る。 */
      '    vec3 p = mix(aA, aB, uv.y);',
      '    vec3 dir = aB - aA;',
      '    float dl = length(dir);',
      '    dir = (dl > 1e-5) ? dir / dl : vec3(0.0, 1.0, 0.0);',
      '    vec3 toCam = normalize(cameraPosition - p);',
      '    vec3 sd = cross(dir, toCam);',
      '    float sl = length(sd);',
      '    sd = (sl > 1e-5) ? sd / sl : vec3(1.0, 0.0, 0.0);',
      '    p += sd * ((uv.x - 0.5) * 2.0 * aPar.y);',
      '    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);',
      '  }',
      '}'
    ]);

    var trFrag = J([
      'uniform vec3 uHot;',
      'varying vec2 vUv;',
      'varying vec4 vCol;',
      'varying float vKind;',
      'void main() {',
      '  float a; vec3 c = vCol.rgb;',
      '  if (vKind > 0.5) {',
      '    vec2 d = (vUv - 0.5) * 2.0;',
      '    float r = length(d);',
      '    float k = max(0.0, 1.0 - r);',
      '    a = pow(k, 2.3);',
      '    c = mix(c, uHot, pow(k, 4.0));',
      '  } else {',
      '    float s = abs((vUv.x - 0.5) * 2.0);',
      '    float w = pow(max(0.0, 1.0 - s), 1.9);',
      /* 尾は根元(uv.y=0)で消え、頭(uv.y=1)で最も濃い。 */
      '    float lg = pow(vUv.y, 1.7);',
      '    a = w * lg;',
      '    c = mix(c, uHot, pow(max(0.0, 1.0 - s), 5.0) * lg);',
      '  }',
      '  a *= vCol.a;',
      '  if (a < 0.004) discard;',
      '  gl_FragColor = vec4(c, a);',
      '  #include <tonemapping_fragment>',
      '  #include <colorspace_fragment>',
      '}'
    ]);

    var trA = new Float32Array(NT * 8 * 3);
    var trB = new Float32Array(NT * 8 * 3);
    var trPar = new Float32Array(NT * 8 * 4);
    var trCol = new Float32Array(NT * 8 * 4);
    var trUv = new Float32Array(NT * 8 * 2);
    var trPos = new Float32Array(NT * 8 * 3);   // 使わないが position 属性は必須
    var trIdx = new Uint16Array(NT * 12);

    (function initTracerGeo() {
      var t, v, base, q;
      /* 1本につき四角形2枚（尾・光球）。uv は (x=横, y=長さ方向)。 */
      var ux = [0, 1, 1, 0], uy = [0, 0, 1, 1];
      for (t = 0; t < NT; t++) {
        for (q = 0; q < 2; q++) {
          base = (t * 2 + q) * 4;
          for (v = 0; v < 4; v++) {
            trUv[(base + v) * 2] = ux[v];
            trUv[(base + v) * 2 + 1] = uy[v];
            trPar[(base + v) * 4] = q;
          }
          var o = (t * 2 + q) * 6;
          trIdx[o] = base; trIdx[o + 1] = base + 1; trIdx[o + 2] = base + 2;
          trIdx[o + 3] = base; trIdx[o + 4] = base + 2; trIdx[o + 5] = base + 3;
        }
      }
    })();

    var trGeo = new T.BufferGeometry();
    var trbPos = new T.BufferAttribute(trPos, 3);
    var trbA = new T.BufferAttribute(trA, 3);
    var trbB = new T.BufferAttribute(trB, 3);
    var trbPar = new T.BufferAttribute(trPar, 4);
    var trbCol = new T.BufferAttribute(trCol, 4);
    trbA.setUsage(T.DynamicDrawUsage);
    trbB.setUsage(T.DynamicDrawUsage);
    trbPar.setUsage(T.DynamicDrawUsage);
    trbCol.setUsage(T.DynamicDrawUsage);
    trGeo.setAttribute('position', trbPos);
    trGeo.setAttribute('uv', new T.BufferAttribute(trUv, 2));
    trGeo.setAttribute('aA', trbA);
    trGeo.setAttribute('aB', trbB);
    trGeo.setAttribute('aPar', trbPar);
    trGeo.setAttribute('aCol', trbCol);
    trGeo.setIndex(new T.BufferAttribute(trIdx, 1));

    var trMat = new T.ShaderMaterial({
      uniforms: { uHot: { value: ASH.shade(T, P.muzzleCore, 3.0) } },
      vertexShader: trVert,
      fragmentShader: trFrag,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: T.AdditiveBlending,
      side: T.DoubleSide,
      fog: false
    });
    var trMesh = new T.Mesh(trGeo, trMat);
    trMesh.frustumCulled = false;
    trMesh.matrixAutoUpdate = false;
    trMesh.renderOrder = 101;
    trMesh.castShadow = false;
    scene.add(trMesh);

    /* 曳光のプール状態 */
    var tOx = new Float32Array(NT), tOy = new Float32Array(NT), tOz = new Float32Array(NT);
    var tDx = new Float32Array(NT), tDy = new Float32Array(NT), tDz = new Float32Array(NT);
    var tLen = new Float32Array(NT), tAge = new Float32Array(NT), tTtl = new Float32Array(NT);
    var tOn = new Uint8Array(NT);
    var tHead = 0, tLive = 0, trDirty = true;

    function writeTracer(t, ax, ay, az, bx, by, bz, wTail, wHead, blob, al) {
      var base = t * 8, v, i3, i4;
      /* 尾（uv.y=0 が尾端、=1 が頭）。太さは頂点ごとに変える＝涙形。 */
      for (v = 0; v < 4; v++) {
        i3 = (base + v) * 3; i4 = (base + v) * 4;
        trA[i3] = ax; trA[i3 + 1] = ay; trA[i3 + 2] = az;
        trB[i3] = bx; trB[i3 + 1] = by; trB[i3 + 2] = bz;
        trPar[i4] = 0;
        trPar[i4 + 1] = (trUv[(base + v) * 2 + 1] > 0.5) ? wHead : wTail;
        trCol[i4] = COL.tracer[0]; trCol[i4 + 1] = COL.tracer[1];
        trCol[i4 + 2] = COL.tracer[2]; trCol[i4 + 3] = al;
      }
      /* 光球 */
      for (v = 4; v < 8; v++) {
        i3 = (base + v) * 3; i4 = (base + v) * 4;
        trB[i3] = bx; trB[i3 + 1] = by; trB[i3 + 2] = bz;
        trA[i3] = ax; trA[i3 + 1] = ay; trA[i3 + 2] = az;
        trPar[i4] = 1;
        trPar[i4 + 1] = blob;
        trCol[i4] = COL.tracerHot[0]; trCol[i4 + 1] = COL.tracerHot[1];
        trCol[i4 + 2] = COL.tracerHot[2]; trCol[i4 + 3] = al;
      }
      trDirty = true;
    }
    function clearTracer(t) {
      var base = t * 8, v, i4;
      for (v = 0; v < 8; v++) {
        i4 = (base + v) * 4;
        trPar[i4 + 1] = 0; trCol[i4 + 3] = 0;
      }
      trDirty = true;
    }
    for (var ti = 0; ti < NT; ti++) clearTracer(ti);

    /* =======================================================================
       4. 幾何のヘルパ（実行中に Vector3 を作らないため、全部スカラーで持つ）
       ===================================================================== */
    var nX = 0, nY = 1, nZ = 0;      // 正規化した法線
    var uX = 1, uY = 0, uZ = 0;      // 接線1
    var wX = 0, wY = 0, wZ = 1;      // 接線2
    var dX = 0, dY = 0, dZ = 0;      // cone() の結果

    function basis(ax, ay, az) {
      var l = Math.sqrt(ax * ax + ay * ay + az * az);
      if (l < 1e-6) { nX = 0; nY = 1; nZ = 0; } else { nX = ax / l; nY = ay / l; nZ = az / l; }
      /* 法線と平行にならない参照軸を選ぶ。平行だと外積が 0 になって基底が壊れる。 */
      var rx = 0, ry = 1, rz = 0;
      if (nY > 0.9 || nY < -0.9) { rx = 1; ry = 0; rz = 0; }
      uX = ry * nZ - rz * nY; uY = rz * nX - rx * nZ; uZ = rx * nY - ry * nX;
      l = Math.sqrt(uX * uX + uY * uY + uZ * uZ) || 1;
      uX /= l; uY /= l; uZ /= l;
      wX = nY * uZ - nZ * uY; wY = nZ * uX - nX * uZ; wZ = nX * uY - nY * uX;
    }
    /* 法線まわりの円錐サンプル。bias<1 で外側寄り＝面から舐めるように散る。
       minAng を与えると円錐の芯を抜いた「輪」になる。
       これは見た目のためだけの仕組みではない：着弾点は必ずレティクルの真下に
       来る（プレイヤーは狙った所に当てる）ので、芯に粒を置くと狙点が潰れる。
       芯を抜けば、同じ噴出でも中心が透けて狙点が読める。 */
    function cone(maxAng, bias, minAng) {
      if (minAng === undefined) minAng = 0;
      var a = minAng + (maxAng - minAng) * Math.pow(rnd(), bias);
      var ph = rnd() * Math.PI * 2;
      var sa = Math.sin(a), ca = Math.cos(a);
      var cp = Math.cos(ph) * sa, sp = Math.sin(ph) * sa;
      dX = nX * ca + uX * cp + wX * sp;
      dY = nY * ca + uY * cp + wY * sp;
      dZ = nZ * ca + uZ * cp + wZ * sp;
    }

    /* =======================================================================
       5. 公開 API
       ===================================================================== */

    /* --- マズルフラッシュ ----------------------------------------------------
       2フレームしか映らない前提。だから「広がる」演出は捨て、
       1フレーム目でもう完成している形を置く。
       層：白熱コア → 花弁2枚（角度をずらす）→ 前方へ抜ける炎の舌 →
           前方の火花 → 遅れて残る硝煙。

       縦を潰して横長にしてある（FLAT）。理由は絵作りと操作性の両方：
         ・銃口は画面中央より下、レティクルは中央より上（NDC y=+0.05）にある。
           縦に伸ばすと真上のレティクルへ届くが、横に伸ばす分には届かない。
         ・後方から見た発砲炎は本来ほぼ左右対称に横へ広がる。
           横長のほうが「銃口から吹いた」形として正しく、情報量も落ちない。 */
    var FLAT = 0.62;

    function muzzle(x, y, z, dx, dy, dz) {
      var l = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (!(l > 1e-6)) { dx = 0; dy = 0; dz = -1; l = 1; }
      dx /= l; dy /= l; dz /= l;
      basis(dx, dy, dz);

      var i;
      /* 花弁（大→小）。回転をずらした2枚で、規則的な星形に見えるのを避ける。 */
      for (i = 0; i < 2; i++) {
        reset();
        E.x = x + dx * 0.05; E.y = y + dy * 0.05; E.z = z + dz * 0.05;
        E.tile = TILE_PETAL;
        E.rot = rnd() * 6.283;
        E.rotv = (rnd() - 0.5) * 9.0;
        E.ttl = 0.052;
        E.grow = 0.45;
        E.fade = 0.7;
        if (i === 0) { tint(COL.glow, 1.0); size(0.50, 0.84, 0.50 * FLAT, 0.84 * FLAT); E.a0 = 0.95; }
        else { tint(COL.core, 0.85); size(0.24, 0.38, 0.24 * FLAT, 0.38 * FLAT); E.a0 = 1.0; }
        emit(ADD);
      }
      /* 発光の芯。ブルームの種。
         小さく保つこと。ここが大きいと post.js のブルーム（しきい値0.78）が
         大きく広がり、銃口まわり一帯が白い塊になる。
         「撃った」は明るさの面積ではなく、花弁の形と一瞬の立ち上がりで伝える。 */
      reset();
      E.x = x + dx * 0.04; E.y = y + dy * 0.04; E.z = z + dz * 0.04;
      E.tile = TILE_HOT; tint(COL.core, 0.95);
      size(0.19, 0.29, 0.19 * FLAT, 0.29 * FLAT);
      E.ttl = 0.055; E.grow = 0.5; E.a0 = 1.0; E.fade = 0.8;
      emit(ADD);
      /* 外周の柔らかい滲み。これが無いと花弁が紙の切り抜きに見える。 */
      reset();
      E.x = x + dx * 0.06; E.y = y + dy * 0.06; E.z = z + dz * 0.06;
      E.tile = TILE_GLOW; tint(COL.glow, 0.45);
      size(0.62, 0.92, 0.62 * FLAT, 0.92 * FLAT);
      E.ttl = 0.062; E.grow = 0.4; E.a0 = 0.42; E.fade = 1.0;
      emit(ADD);

      /* 前方へ抜ける炎の舌。銃口の「向き」を1枚で示す唯一の要素。 */
      reset();
      E.x = x + dx * 0.20; E.y = y + dy * 0.20; E.z = z + dz * 0.20;
      E.vx = dx * 6; E.vy = dy * 6; E.vz = dz * 6;
      E.tile = TILE_STREAK; E.align = 1.0;
      tint(COL.core, 0.95); size(0.13, 0.17, 0.42, 0.62);
      E.ttl = 0.05; E.grow = 0.5; E.a0 = 0.95; E.fade = 0.9;
      emit(ADD);

      /* 前方の火花。円錐を狭くして「押し出された」向きを保つ。 */
      for (i = 0; i < 6; i++) {
        cone(0.42, 0.7);
        var sv = rr(9, 19);
        reset();
        E.x = x + dx * 0.10; E.y = y + dy * 0.10; E.z = z + dz * 0.10;
        E.vx = dX * sv; E.vy = dY * sv; E.vz = dZ * sv;
        E.tile = TILE_STREAK; E.align = 1.0;
        tint(i % 3 === 0 ? COL.core : COL.spark, 1.0);
        size(0.030, 0.020, rr(0.20, 0.40), rr(0.10, 0.20));
        E.ttl = rr(0.07, 0.14); E.drag = 5.0; E.grav = 5.0;
        E.a0 = 1.0; E.fade = 1.2;
        emit(ADD);
      }

      /* 硝煙。フラッシュが消えたあとに残る＝2フレームの閃光に重さを与える。
         強いと画面が汚れるので不透明度は抑える。 */
      for (i = 0; i < 3; i++) {
        cone(0.55, 0.8);
        reset();
        E.x = x + dx * 0.14; E.y = y + dy * 0.14; E.z = z + dz * 0.14;
        E.vx = dX * rr(1.4, 3.0); E.vy = dY * rr(1.4, 3.0) + 0.5; E.vz = dZ * rr(1.4, 3.0);
        E.tile = (i % 2) ? TILE_PUFF : TILE_PUFF2;
        E.rot = rnd() * 6.283; E.rotv = (rnd() - 0.5) * 1.6;
        tint(COL.smoke, 1.0); sizeU(0.16, 0.52);
        E.ttl = rr(0.30, 0.46); E.grow = 0.45; E.drag = 3.2;
        E.a0 = 0.26; E.fade = 1.3;
        emit(ALP);
      }
    }

    /* --- 曳光 --------------------------------------------------------------- */
    function tracer(x0, y0, z0, x1, y1, z1) {
      var dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
      var len = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (!(len > 1e-4)) return;
      var t = tHead; tHead = (tHead + 1) % NT;
      if (!tOn[t]) tLive++;
      tOn[t] = 1;
      tOx[t] = x0; tOy[t] = y0; tOz[t] = z0;
      tDx[t] = dx / len; tDy[t] = dy / len; tDz[t] = dz / len;
      tLen[t] = len;
      tAge[t] = 0;
      /* 弾速 170m/s 相当。ただし近距離で1フレーム未満にならないよう下限を置く。
         「速い」と「見えない」は違う。3〜5フレーム生きるのが読める限界。 */
      tTtl[t] = Math.max(0.055, Math.min(0.16, len / 170));
      stepTracer(t, 0);
    }

    function stepTracer(t, dt) {
      tAge[t] += dt;
      var p = tAge[t] / tTtl[t];
      if (p >= 1) { tOn[t] = 0; tLive--; clearTracer(t); return; }
      var d = tLen[t] * p;
      var tail = d - TAIL; if (tail < 0) tail = 0;
      var bx = tOx[t] + tDx[t] * d, by = tOy[t] + tDy[t] * d, bz = tOz[t] + tDz[t] * d;
      var ax = tOx[t] + tDx[t] * tail, ay = tOy[t] + tDy[t] * tail, az = tOz[t] + tDz[t] * tail;
      /* 着弾間際で急に消えると「線が引っ込んだ」ように見える。後半だけ落とす。 */
      var al = (p < 0.62) ? 1.0 : (1 - p) / 0.38;
      writeTracer(t, ax, ay, az, bx, by, bz,
        0.014, 0.055, 0.145 * (0.85 + 0.3 * (1 - p)), al);
    }

    /* --- 着弾 ----------------------------------------------------------------
       3種の差は「色」だけに頼らない。形と広がり方でも分ける：
         world … 法線まわりの狭いプルーム（縦に伸びる）＋寒色の短い火花
         enemy … 広い円錐の丸い飛沫（横に広がる）＋暖色の長い火花
         head  … enemy を拡大し、リングと花弁という別の形を追加
       ===================================================================== */
    function impact(x, y, z, nx, ny, nz, kind) {
      /* 旧シグネチャ impact(x,y,z,isEnemy) でも壊れないようにする。
         統合は発注元が行うので、こちらが受け側で吸収しておく。 */
      if (typeof nx !== 'number') {
        kind = (nx === true) ? 'enemy' : (typeof nx === 'string' ? nx : 'world');
        nx = 0; ny = 1; nz = 0;
      }
      if (kind !== 'enemy' && kind !== 'head') kind = 'world';
      basis(nx, ny, nz);
      if (kind === 'world') impactWorld(x, y, z);
      else impactFlesh(x, y, z, kind === 'head');
    }

    /* 外れ＝白い粉塵の噴出＋短い火花。暖色は1滴も使わない。 */
    function impactWorld(x, y, z) {
      var i, sv, o;

      /* 1層目：白い閃光。着弾の「点」を1フレームで示す。寒色。
         -----------------------------------------------------------------
         ここは「塗り潰した円」にしてはならない。外れ弾の着弾点は
         レティクルの真下に必ず来るので、不透明な白い玉を置くと
         撃っている間ずっと狙点が見えなくなる（＝狙って撃つゲームが壊れる）。
         中心が空いた輪にすれば、着弾の位置と勢いは伝わったまま狙点が透ける。 */
      reset();
      E.x = x + nX * 0.03; E.y = y + nY * 0.03; E.z = z + nZ * 0.03;
      E.tile = TILE_RING; tint(COL.coldSpark, 0.45);
      size(0.46, 1.00, 0.36, 0.80);        // 気持ち横長。縦にレティクルへ伸ばさない
      E.rot = rnd() * 6.283;
      E.ttl = 0.085; E.grow = 0.36; E.a0 = 0.8; E.fade = 1.2;
      emit(ADD);

      /* 2層目：粉塵の噴出。
         -----------------------------------------------------------------
         円錐の芯を角度で抜くだけでは穴が開かない。粒の半径（0.13〜0.22m）が
         穴の半径より大きいと、粒自身が中心を塗り潰してしまうため。
         そこで接平面上の「半径 R の輪」から発生させ、外向き＋法線方向へ飛ばす。
         これは実際の着弾でできる王冠状の噴出そのものなので、
         狙点を空けるための都合が、そのまま正しい現象の形になっている。 */
      var rc, rs, tx, ty, tz;
      for (i = 0; i < 16; i++) {
        rc = rnd() * 6.283;
        tx = uX * Math.cos(rc) + wX * Math.sin(rc);
        ty = uY * Math.cos(rc) + wY * Math.sin(rc);
        tz = uZ * Math.cos(rc) + wZ * Math.sin(rc);
        rs = rr(0.34, 0.66);            // 輪の半径。粒の半径より必ず大きく取る
        o = rr(0.04, 0.26);             // 面から浮かす量
        sv = rr(2.0, 4.6);              // 法線方向（立ち上がり）
        var so = rr(1.4, 3.4);          // 外向き（広がり）
        reset();
        E.x = x + tx * rs + nX * o; E.y = y + ty * rs + nY * o; E.z = z + tz * rs + nZ * o;
        E.vx = nX * sv + tx * so; E.vy = nY * sv + ty * so + 0.7; E.vz = nZ * sv + tz * so;
        E.tile = (i % 2) ? TILE_PUFF : TILE_PUFF2;
        E.rot = rnd() * 6.283; E.rotv = (rnd() - 0.5) * 2.2;
        /* 半分を青灰に寄せる。命中側（赤）との対比は明度ではなく色相で付ける。
           純白のままだと、暗い画面では致命打の白熱コアと同じ「白」に見える。 */
        tint((i % 2) ? COL.dustCool : COL.dust, rr(0.85, 1.15));
        sizeU(rr(0.22, 0.34), rr(0.62, 0.96));
        E.ttl = rr(0.45, 0.80); E.grow = 0.42; E.drag = 4.6; E.grav = 0.9;
        /* 不透明度も抑える。粉塵は「厚み」で見せるもので、
           1粒で壁を作るものではない。重なって初めて雲になればよい。 */
        E.a0 = rr(0.28, 0.48); E.fade = 1.6;
        emit(ALP);
      }
      /* 壁面を這う粉。プルームの根元を面に接地させる。 */
      for (i = 0; i < 5; i++) {
        var ph = rnd() * 6.283, sr = rr(1.8, 3.8);
        reset();
        /* 0.32m 外へ出す。面を這う粉が狙点の真上に乗ると、
           いちばん長生きする層がいちばん長く狙点を隠すことになる。 */
        E.x = x + (uX * Math.cos(ph) + wX * Math.sin(ph)) * 0.32;
        E.y = y + (uY * Math.cos(ph) + wY * Math.sin(ph)) * 0.32;
        E.z = z + (uZ * Math.cos(ph) + wZ * Math.sin(ph)) * 0.32;
        E.vx = (uX * Math.cos(ph) + wX * Math.sin(ph)) * sr + nX * 0.6;
        E.vy = (uY * Math.cos(ph) + wY * Math.sin(ph)) * sr + nY * 0.6;
        E.vz = (uZ * Math.cos(ph) + wZ * Math.sin(ph)) * sr + nZ * 0.6;
        E.tile = TILE_PUFF2;
        E.rot = rnd() * 6.283; E.rotv = (rnd() - 0.5) * 1.2;
        tint(COL.dustDim, 1.0); sizeU(0.40, 1.05);
        E.ttl = rr(0.60, 0.95); E.grow = 0.4; E.drag = 3.4; E.grav = 0.5;
        E.a0 = 0.24; E.fade = 1.7;
        emit(ALP);
      }

      /* 3層目：短い火花。石を削った破片なので白〜青白。暖色にしない。
         白い粉塵の中に白い火花を置くと同化して消える。初期位置を雲の外へ出し、
         長さも雲の半径を超えるところまで伸ばして、輪郭から突き出させる。 */
      for (i = 0; i < 11; i++) {
        cone(1.28, 0.55, 0.52);
        sv = rr(9.0, 19.0);
        reset();
        /* 火花も狙点の真上から出さない。0.30m 外へずらす。 */
        E.x = x + dX * 0.30; E.y = y + dY * 0.30; E.z = z + dZ * 0.30;
        E.vx = dX * sv; E.vy = dY * sv + 0.8; E.vz = dZ * sv;
        E.tile = TILE_STREAK; E.align = 1.0;
        tint(COL.coldSpark, rr(1.0, 1.5));
        size(0.036, 0.022, rr(0.38, 0.72), rr(0.14, 0.24));
        E.ttl = rr(0.10, 0.19); E.drag = 3.6; E.grav = 8.0;
        E.a0 = 1.0; E.fade = 1.1;
        emit(ADD);
      }
    }

    /* 命中＝暖色の飛沫（bloodMist）＋装甲片の火花（impactSpark）の2層。
       head は同じ骨格を拡大したうえで、enemy が持たない形（リング・花弁）を足す。 */
    function impactFlesh(x, y, z, head) {
      /* 胴命中は「外れの粉塵」に負けてはいけない。負けると当てた実感が消える。
         そのうえで致命打が胴命中を明確に上回るよう、倍率は 1.25 : 2.0 に取る。 */
      var S = head ? 1.85 : 1.25;     // 大きさ
      var L = head ? 1.7 : 1.0;       // 寿命
      var i, sv, o;

      /* --- 芯の閃光 ---------------------------------------------------------
         白い芯は小さく留める。理由は2つ。
         (1) 大きくすると致命打が「白い電球」になり、暖色の飛沫が飲まれて
             命中の色が消える。
         (2) 敵に当てた瞬間も着弾点はレティクルの真下にある。狙点を潰すと
             次弾の照準ができない。命中は「明るさ」ではなく
             「色と層の数」で伝えるほうが、結果として強く伝わる。 */
      reset();
      E.x = x + nX * 0.03; E.y = y + nY * 0.03; E.z = z + nZ * 0.03;
      E.tile = TILE_HOT;
      tint(head ? COL.core : COL.ember, head ? 0.6 : 0.75);
      sizeU(head ? 0.16 : 0.13 * S, head ? 0.36 : 0.32 * S);
      E.ttl = 0.07 * L; E.grow = 0.45; E.a0 = 0.95; E.fade = 1.1;
      emit(ADD);
      reset();
      E.x = x + nX * 0.04; E.y = y + nY * 0.04; E.z = z + nZ * 0.04;
      E.tile = TILE_GLOW;
      tint(head ? COL.spark : COL.glow, head ? 0.85 : 0.55);
      sizeU(0.34 * S, 0.80 * S);
      E.ttl = 0.11 * L; E.grow = 0.4; E.a0 = head ? 0.8 : 0.5; E.fade = 1.2;
      emit(ADD);

      if (head) {
        /* --- 致命打だけが持つ形 その1：衝撃リング ---------------------------
           拡大する細い輪は、胴命中には無い「別の事象が起きた」記号になる。
           2枚を速度差で重ねてエネルギーを出す。色は白ではなく火花の橙：
           白いリングは「UIのエフェクト」に見えるが、橙なら「火」に見える。 */
        reset();
        E.x = x + nX * 0.05; E.y = y + nY * 0.05; E.z = z + nZ * 0.05;
        /* 真円は「UIのレティクル」に見える。縦横を崩して回すと同じ輪でも
           「押し広げられた空気」に見える。 */
        var e1 = rr(0.62, 0.90);
        reset();
        E.x = x + nX * 0.05; E.y = y + nY * 0.05; E.z = z + nZ * 0.05;
        /* 加算シェーダは濃い所を白熱させる。リングの帯は密度が最大なので、
           色を強く入れると必ず純白の輪になり「火」ではなく「図形」になる。
           ここだけ倍率を大きく下げて、橙のまま残す。 */
        E.tile = TILE_RING; tint(COL.spark, 0.5);
        size(0.80 * e1, 2.60 * e1, 0.80, 2.60);
        E.rot = rnd() * 6.283; E.rotv = (rnd() - 0.5) * 2.2;
        E.ttl = 0.26; E.grow = 0.34; E.a0 = 0.95; E.fade = 1.5;
        emit(ADD);
        /* 2枚目は「同心円」に見せないため、大きく先行させて薄くする。
           半径が近いと UI のレティクルに見えてしまう。 */
        reset();
        E.x = x + nX * 0.05; E.y = y + nY * 0.05; E.z = z + nZ * 0.05;
        E.tile = TILE_RING; tint(COL.glow, 0.55); sizeU(1.25, 2.90);
        E.rot = rnd() * 6.283;
        E.ttl = 0.30; E.grow = 0.42; E.a0 = 0.36; E.fade = 1.4;
        emit(ADD);
        /* その2：花弁のスターバースト。マズルと同じ語彙を使い、
           「銃口と同じ格の出来事が敵の頭で起きた」と読ませる。 */
        reset();
        E.x = x + nX * 0.05; E.y = y + nY * 0.05; E.z = z + nZ * 0.05;
        E.tile = TILE_PETAL; tint(COL.glow, 1.25); sizeU(0.85, 1.70);
        E.rot = rnd() * 6.283; E.rotv = (rnd() - 0.5) * 5.0;
        E.ttl = 0.13; E.grow = 0.4; E.a0 = 1.0; E.fade = 1.1;
        emit(ADD);
      }

      /* --- 下地：飛沫をひとつの塊にまとめる薄い暖色の霧 ----------------------
         粒だけを撒くと「赤い点の集まり」に見え、命中の重さが出ない。
         広く薄い霧を先に敷いてから粒を載せると、ひと塊の事象として読める。 */
      for (i = 0; i < 3; i++) {
        cone(1.0, 0.8);
        reset();
        E.x = x + dX * rr(0.02, 0.16) * S;
        E.y = y + dY * rr(0.02, 0.16) * S;
        E.z = z + dZ * rr(0.02, 0.16) * S;
        E.vx = dX * 1.4; E.vy = dY * 1.4 + 0.4; E.vz = dZ * 1.4;
        E.tile = (i % 2) ? TILE_PUFF : TILE_PUFF2;
        E.rot = rnd() * 6.283; E.rotv = (rnd() - 0.5) * 1.4;
        tint(COL.bloodDim, 1.0);
        sizeU(0.55 * S, 1.00 * S);
        E.ttl = 0.28 * L; E.grow = 0.42; E.drag = 8.0; E.grav = 1.2;
        E.a0 = 0.30; E.fade = 1.6;
        emit(ALP);
      }

      /* --- 1層目：暖色の飛沫（bloodMist） -----------------------------------
         円錐を広く取り（±75°／致命打は±95°）、丸く広がる塊にする。
         world の「縦に立つ狭いプルーム」と形で対比させるのが狙い。 */
      var nMist = head ? 26 : 19;
      for (i = 0; i < nMist; i++) {
        cone(head ? 1.45 : 1.25, 0.5);
        o = rr(0.04, 0.38) * S;
        /* 飛沫は「遠くまで飛ぶ」ものではない。初速を上げすぎると 0.2 秒後には
           巨大な赤い雲になり、隣の着弾と混ざって読み分けが壊れる。
           抵抗を強くして、広がりを 0.5m 前後で頭打ちにする。 */
        sv = rr(1.6, 4.0) * (head ? 1.3 : 1.0);
        reset();
        E.x = x + dX * o; E.y = y + dY * o; E.z = z + dZ * o;
        E.vx = dX * sv; E.vy = dY * sv + 0.5; E.vz = dZ * sv;
        E.tile = (i % 3 === 0) ? TILE_DROP : ((i % 2) ? TILE_PUFF : TILE_PUFF2);
        E.rot = rnd() * 6.283; E.rotv = (rnd() - 0.5) * 3.0;
        /* 明・中・暗の3段。単色だと「赤い雲」で終わり、飛沫に見えない。 */
        if (i % 4 === 0) tint(COL.bloodHot, 1.0);
        else if (i % 2 === 0) tint(COL.blood, rr(0.85, 1.15));
        else tint(i % 3 === 0 ? COL.bloodDark : COL.bloodDim, 1.0);
        sizeU(rr(0.22, 0.36) * S, rr(0.40, 0.64) * S);
        E.ttl = rr(0.30, 0.52) * L; E.grow = 0.45; E.drag = 8.5; E.grav = 3.4;
        E.a0 = rr(0.70, 1.0); E.fade = 1.9;
        emit(ALP);
      }
      /* 伸びた飛沫。粒だけだと「霧」で止まる。速度方向へ伸ばして初めて
         「飛び散った」に見える。 */
      var nSpray = head ? 12 : 9;
      for (i = 0; i < nSpray; i++) {
        cone(head ? 1.40 : 1.15, 0.6);
        sv = rr(4.0, 8.5) * (head ? 1.3 : 1.0);
        reset();
        E.x = x + dX * 0.05; E.y = y + dY * 0.05; E.z = z + dZ * 0.05;
        E.vx = dX * sv; E.vy = dY * sv + 0.6; E.vz = dZ * sv;
        E.tile = TILE_STREAK; E.align = 1.0;
        tint(i % 3 === 0 ? COL.bloodHot : COL.blood, 1.0);
        size(0.060 * S, 0.040 * S, rr(0.30, 0.62) * S, rr(0.14, 0.28) * S);
        E.ttl = rr(0.14, 0.26) * L; E.drag = 5.5; E.grav = 6.0;
        E.a0 = 0.9; E.fade = 1.4;
        emit(ALP);
      }

      /* --- 2層目：装甲片の火花（impactSpark） -------------------------------- */
      var nSpark = head ? 17 : 12;
      for (i = 0; i < nSpark; i++) {
        cone(1.25, 0.55);
        sv = rr(8.0, 17.0) * (head ? 1.6 : 1.0);
        reset();
        /* 飛沫の塊の外側から出す。中に埋めると火花の層が見えなくなり、
           「2層以上返っている」ことが伝わらない。 */
        E.x = x + dX * 0.20 * S; E.y = y + dY * 0.20 * S; E.z = z + dZ * 0.20 * S;
        E.vx = dX * sv; E.vy = dY * sv + 0.9; E.vz = dZ * sv;
        E.tile = TILE_STREAK; E.align = 1.0;
        tint(head && i % 4 === 0 ? COL.core : (i % 3 === 0 ? COL.sparkHot : COL.spark), 1.0);
        size(0.036 * S, 0.020 * S,
          rr(0.28, 0.54) * (head ? 1.7 : 1.0), rr(0.12, 0.22) * (head ? 1.5 : 1.0));
        E.ttl = rr(0.10, 0.20) * (head ? 1.9 : 1.0); E.drag = 3.2; E.grav = 9.0;
        E.a0 = 1.0; E.fade = 1.1;
        emit(ADD);
      }

      if (head) {
        /* 落ちて残る火の粉。「長く」を担当する層。
           他の層が消えたあとも 0.5〜1.0 秒だけ残り、余韻を作る。 */
        for (i = 0; i < 7; i++) {
          cone(1.5, 0.6);
          sv = rr(2.0, 5.0);
          reset();
          E.x = x + dX * 0.06; E.y = y + dY * 0.06; E.z = z + dZ * 0.06;
          E.vx = dX * sv; E.vy = dY * sv + 1.4; E.vz = dZ * sv;
          E.tile = TILE_HOT;
          tint(COL.ember, rr(0.7, 1.0));
          sizeU(rr(0.035, 0.065), rr(0.020, 0.040));
          E.ttl = rr(0.5, 0.95); E.drag = 1.6; E.grav = 5.0;
          E.a0 = 1.0; E.fade = 1.6;
          emit(ADD);
        }
      }
    }

    /* --- 毎フレーム ---------------------------------------------------------- */
    function step(dt) {
      if (!(dt > 0)) dt = 0.016;
      if (dt > 0.05) dt = 0.05;    // タブ復帰で演出が飛ぶのを防ぐ
      stepSys(ADD, dt);
      stepSys(ALP, dt);
      if (tLive > 0) {
        for (var t = 0; t < NT; t++) if (tOn[t]) stepTracer(t, dt);
      }
      if (trDirty) {
        trbA.needsUpdate = true; trbB.needsUpdate = true;
        trbPar.needsUpdate = true; trbCol.needsUpdate = true;
        trDirty = tLive > 0;
      }
    }

    return {
      muzzle: muzzle,
      tracer: tracer,
      impact: impact,
      step: step
    };
  };
})(typeof window !== 'undefined' ? window : globalThis);

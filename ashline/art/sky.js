/* =============================================================================
   ashline/art/sky.js — ASH.sky(T, scene)

   絵の狙い：砲撃戦の翌日、陽が低い午後遅く。粉塵がまだ空気に残っていて、
   逆光がいくつもの「層」になって見える。空はグラデーションの板ではなく、
   下に行くほど厚く濁っていく容れ物として描く。

   構成（描画は 2 コールだけ）:
     1. 天球ドーム（BackSide 球 / ShaderMaterial）
        天頂→地平の二段カーブ、太陽方向への四段の滲み、高度ごとの粉塵層、
        太陽の反対側の冷え込み、粒状ノイズとディザ。
     2. 粉塵粒（T.Points 560 個 / ShaderMaterial）
        太陽方向に沿った房状の密度差を作り、視線が太陽に近い粒ほど強く光らせる
        ＝前方散乱＝逆光で光る粉塵。カメラ相対に XZ をラップして無限に見せる。

   色は ASH.palette からのみ。生の 16 進は書かない。ES5。外部リソースなし。
   ========================================================================== */
(function (g) {
  var ASH = g.ASH = g.ASH || {};

  ASH.sky = function (T, scene) {
    var P = ASH.palette;

    /* 改行連結のヘルパ。テンプレートリテラルは ES5 縛りのため使わない。 */
    function J(a) { return a.join('\n'); }

    /* --- 太陽方向（正規化） -------------------------------------------------
       palette の sunDir は「太陽が在る向き」。長さが 1 でないのでここで正規化する。
       これを空・粉塵の両方で共有し、光の向きが 2 つの要素でズレないようにする。 */
    var sunDir = new T.Vector3(P.sunDir.x, P.sunDir.y, P.sunDir.z).normalize();

    /* =======================================================================
       1. 天球ドーム
       ===================================================================== */

    /* ドームはカメラに追従させるので、頂点のローカル座標＝そのまま視線方向になる。
       法線ではなく position を渡すのは、球の中心が常にカメラだからで、
       これなら matrix を触らずに方向が取れる。 */
    var skyVert = J([
      'varying vec3 vDir;',
      'void main() {',
      '  vDir = position;',
      '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
      '}'
    ]);

    var skyFrag = J([
      'varying vec3 vDir;',
      'uniform vec3 uZenith;',
      'uniform vec3 uHorizon;',
      'uniform vec3 uSun;',
      'uniform vec3 uFog;',
      'uniform vec3 uDust;',
      'uniform vec3 uCool;',
      'uniform vec3 uSunDir;',
      'uniform vec3 uSunAz;',

      /* 安価なハッシュ。テクスチャを持ち込めない（外部リソース禁止・
         テクスチャ枚数も予算）ので、濁りと粒状感は全部手続きで作る。 */
      'float h21(vec2 p) {',
      '  vec3 q = fract(vec3(p.x, p.y, p.x) * 0.1031);',
      '  q += dot(q, q.yzx + 33.33);',
      '  return fract((q.x + q.y) * q.z);',
      '}',
      'float vn(vec2 p) {',
      '  vec2 i = floor(p);',
      '  vec2 f = fract(p);',
      '  f = f * f * (3.0 - 2.0 * f);',
      '  float n0 = h21(i);',
      '  float n1 = h21(i + vec2(1.0, 0.0));',
      '  float n2 = h21(i + vec2(0.0, 1.0));',
      '  float n3 = h21(i + vec2(1.0, 1.0));',
      '  return mix(mix(n0, n1, f.x), mix(n2, n3, f.x), f.y);',
      '}',
      /* 高度 y を中心 c・幅 w のガウス帯で拾う。pow で負の底を踏むのを避けるため
         自乗を明示する（GLSL の pow は底が負だと未定義）。 */
      'float bandAt(float y, float c, float w) {',
      '  float x = (y - c) / w;',
      '  return exp(-x * x);',
      '}',

      'void main() {',
      '  vec3 d = normalize(vDir);',
      '  float h = d.y;',
      '  float az = atan(d.z, d.x);',
      '  float sd = max(dot(d, uSunDir), 0.0);',

      /* --- 天頂→地平：指数の違う二段のカーブ ---------------------------------
         線形補間だと「上が青・下が茶色の板」にしか見えない。
         広い遷移（4.2乗）で天頂の冷たさを高い所まで保ち、
         地平直上だけ 16 乗の急なカーブでもう一段濃くする。
         ACESFilmic は暗部を大きく持ち上げるので、
         天頂は数値上かなり暗くしておかないと画面で灰色に溶ける。 */
      '  float up = clamp(h, 0.0, 1.0);',
      '  float tLo = pow(1.0 - up, 4.2);',
      '  float tHi = pow(1.0 - up, 16.0);',
      '  vec3 col = mix(uZenith * 0.85, uHorizon, tLo * 0.90);',
      '  col = mix(col, uHorizon * 1.06, tHi * 0.60);',

      /* --- 方位で暖／冷に割る（この空でいちばん効く操作） ---------------------
         §3「明部と暗部が同一画面に共存」。太陽と同じ側の地平はオーカーに焼け、
         180 度反対側は散乱光が届かず青灰に沈む。高度ではなく "方位" で割るので、
         カメラを振ると空の色が変わる＝空に厚みと方向がある、と読める。 */
      '  vec3 dAz = normalize(vec3(d.x, 0.0, d.z) + vec3(1e-5, 0.0, 1e-5));',
      '  float azd = dot(dAz, uSunAz);',
      '  float coolSide = 1.0 - smoothstep(-0.75, 0.45, azd);',
      '  vec3 coolTint = mix(uZenith, uCool, 0.34) * 0.72;',
      '  col = mix(col, coolTint, coolSide * 0.62);',
      '  float warmSide = smoothstep(-0.10, 0.95, azd) * pow(1.0 - up, 1.6);',
      '  col = mix(col, uHorizon * 1.10, warmSide * 0.42);',

      /* --- 太陽の滲み：四段 ---------------------------------------------------
         広い散乱／滲み／内側の暈／芯。1 段だけだと「丸い光の玉」になり、
         段を重ねると空気に光が溶けたように見える。
         広い項を強くすると空全体がセピアの一色になるので、そこは薄く抑え、
         代わりに芯と内側の暈で「まぶしさ」を出す。
         低空ほど大気が厚い＝散乱が強いので thick で持ち上げる。 */
      '  float g0 = pow(sd, 2.4);',
      '  float g1 = pow(sd, 11.0);',
      '  float g2 = pow(sd, 55.0);',
      '  float g3 = pow(sd, 420.0);',
      '  float thick = exp(-max(h, 0.0) * 4.0);',
      /* --- 太陽まわりの放射状のむら -------------------------------------------
         滲みが完全な同心円だと CG のレンズフレアに見える。
         太陽を軸にした極座標（方位 ang / 角距離 rad）でノイズを引き、
         粉塵の濃淡が光をちぎった筋を作る。芯(g3)には掛けない
         ＝太陽そのものは割らず、まわりの空気だけを荒らす。 */
      '  vec3 tA = normalize(cross(uSunDir, vec3(0.0, 1.0, 0.0)));',
      '  vec3 tB = cross(uSunDir, tA);',
      '  float ang = atan(dot(d, tB), dot(d, tA));',
      '  float rad = acos(clamp(dot(d, uSunDir), -1.0, 1.0));',
      '  float shaft = vn(vec2(ang * 1.7, rad * 1.1)) * 0.68',
      '              + vn(vec2(ang * 4.3, rad * 2.2)) * 0.32;',
      '  vec3 wide = uSun * (g0 * 0.030 + g1 * 0.10 + g2 * 0.30);',
      /* むらは付けるが 0 にはしない。完全に切れると光条が線として硬くなる。 */
      '  wide *= (0.40 + 0.95 * thick) * (0.58 + 0.84 * shaft);',
      '  vec3 core = uSun * g3 * 1.60 * (0.40 + 0.95 * thick);',
      '  col += wide + core;',

      /* --- 逆光の層（この空の主役） -------------------------------------------
         粉塵は高度ごとに違う濃さで滞留する。中心高度の違うガウス帯を 4 枚重ね、
         方位角のうねり(wob)と 2 オクターブの値ノイズ(cl)で厚みをばらつかせる。
         cl の係数を 1 以上にして帯をちぎり、連続した「板」ではなく
         途切れた「筋」として読ませる。
         層そのものは濁りなので霧色へ寄せ（＝遠景と地続きになる）、
         そのうえで太陽側だけ強く発光させる＝逆光で層が浮かぶ。 */
      '  float wob = 0.66 + 0.34 * sin(az * 2.0 + 0.6) + 0.20 * sin(az * 5.0 - 1.9);',
      /* 層は水平に真っ直ぐではない。方位だけに依存するノイズで高度をずらすと、
         層全体が波打って「本物の滞留」に見える。h ではなく hw で帯を引く。 */
      '  float warp = (vn(vec2(az * 0.85, 5.5)) - 0.5) * 0.052',
      '             + (vn(vec2(az * 2.30, 11.5)) - 0.5) * 0.020;',
      '  float hw = h + warp;',
      /* 3 オクターブ。低周波を強くして "長くちぎれた筋" にする。 */
      '  float cl = vn(vec2(az * 1.05, hw * 5.0)) * 0.50',
      '           + vn(vec2(az * 2.60, hw * 11.0)) * 0.32',
      '           + vn(vec2(az * 6.10, hw * 23.0)) * 0.18;',
      '  float band = bandAt(hw, 0.020, 0.014) * 0.95',
      '             + bandAt(hw, 0.062, 0.022) * 0.80',
      '             + bandAt(hw, 0.118, 0.033) * 0.62',
      '             + bandAt(hw, 0.205, 0.052) * 0.44',
      '             + bandAt(hw, 0.330, 0.080) * 0.28;',
      '  band *= wob * clamp(-0.18 + 1.85 * cl, 0.0, 1.7);',
      /* 帯の"間"を霧色で沈める。明るい帯を足すだけでは全部が飽和して
         一枚のクリーム色の壁になる。暗い隙間を作って初めて層に見える。 */
      '  float gap = clamp(0.62 - band, 0.0, 0.62) * (1.0 - up * 0.55);',
      '  col = mix(col, uFog * 0.72, gap * 0.45);',
      '  col += uSun * band * (0.05 + 0.95 * pow(sd, 2.0)) * 0.24;',

      /* --- 大きなむら -------------------------------------------------------
         帯だけだと規則正しくて人工的。低周波のノイズで霧色を薄く被せ、
         「まだ晴れていない空気」のむらを作る。 */
      '  float haze = vn(vec2(az * 1.15 + 3.1, h * 2.6));',
      '  col = mix(col, uFog * 0.98, (0.18 + 0.40 * haze) * pow(1.0 - up, 1.8) * 0.55);',

      /* --- 地平の下 -----------------------------------------------------------
         遠景の抜け（地面メッシュが終わった先）は霧色に落とす。
         scene.fog と同系にしておかないと、遠景の縁で色が割れる。 */
      '  float below = 1.0 - smoothstep(-0.11, 0.0, h);',
      '  col = mix(col, uFog * 0.88, below * 0.95);',

      /* --- 粒状感とディザ -----------------------------------------------------
         平滑なグラデーションは 8bit 出力でバンディングを起こし、
         何より「板」に見える。方向依存の細かいノイズで面を荒らし、
         最後に 1/255 未満のディザを足して段差を溶かす。 */
      '  float grain = vn(vec2(az * 46.0, h * 160.0));',
      '  col *= 0.984 + 0.032 * grain;',
      '  col += (h21(gl_FragCoord.xy) - 0.5) * 0.0045;',

      '  gl_FragColor = vec4(max(col, vec3(0.0)), 1.0);',
      /* シーンの他のマテリアルと同じ ACESFilmic ＋ 出力色空間を通す。
         ShaderMaterial は自動では通らないので明示的に include する。 */
      '  #include <tonemapping_fragment>',
      '  #include <colorspace_fragment>',
      '}'
    ]);

    var skyUniforms = {
      uZenith: { value: new T.Color(P.skyZenith) },
      uHorizon: { value: new T.Color(P.skyHorizon) },
      uSun: { value: new T.Color(P.skySun) },
      uFog: { value: new T.Color(P.fog) },
      uDust: { value: new T.Color(P.dust) },
      /* 冷たい側の色。palette の「上からの冷たい回り込み」＝空の青灰そのもの。 */
      uCool: { value: new T.Color(P.ambientSky) },
      uSunDir: { value: sunDir.clone() },
      /* 太陽の "方位" だけを取り出した水平ベクトル。暖／冷の割り方に使う。 */
      uSunAz: { value: new T.Vector3(sunDir.x, 0, sunDir.z).normalize() }
    };

    /* 半径 150：ゲーム側のカメラ far が 200 なので余裕を持って内側に収める。
       分割 40x24（約 1,900 三角形）：方向はフラグメントで正規化しているので
       これ以上増やしても絵は変わらない。予算 6,000 に対して十分軽い。 */
    var skyMat = new T.ShaderMaterial({
      uniforms: skyUniforms,
      vertexShader: skyVert,
      fragmentShader: skyFrag,
      side: T.BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false
    });
    var mesh = new T.Mesh(new T.SphereGeometry(150, 40, 24), skyMat);
    mesh.frustumCulled = false;   // 常にカメラを包むので判定は無駄
    mesh.renderOrder = -1000;     // 深度を書かずに最初に敷く
    scene.add(mesh);

    /* =======================================================================
       2. 霧
       ===================================================================== */
    /* 空気遠近。遠景を必ず一段濁らせるため、色は地平と同系の P.fog。 */
    scene.fog = new T.Fog(P.fog, P.fogNear, P.fogFar);

    /* =======================================================================
       3. 粉塵粒
       ===================================================================== */

    var COUNT = 560;            // 契約上限 600 の内側
    /* ラップする立方体の一辺（XZ）。広く撒くほど 1 粒 1 粒が孤立して
       「雪」に見える。600 個しか使えないので体積を絞って密度を稼ぎ、
       近景で粒が重なるようにする。霧が 16m から効き始めるので 30m で足りる。 */
    var SPAN = 30.0;
    var HALF = SPAN * 0.5;
    var Y_BOT = -0.4;           // 地面すれすれ
    /* 上限を低く抑えるのが重要。高い所の粒は空を背景に点として孤立し、
       粉塵ではなく「星」に見えてしまう。粉塵は人の背丈まわりに滞留させる。 */
    var Y_TOP = 6.5;

    var pos = new Float32Array(COUNT * 3);
    var siz = new Float32Array(COUNT);
    var vel = new Float32Array(COUNT * 3);
    var phs = new Float32Array(COUNT);
    /* 各粒が「元いた高度」。沈んだ粒はここへ戻す（下記 FALL の説明を参照）。 */
    var yBase = new Float32Array(COUNT);
    var FALL = 1.6;

    /* 決定的な擬似乱数。毎回同じ絵が出ないと「見て直す」作業が成立しない。 */
    var seed = 20240517;
    function rnd() {
      seed = (seed * 1664525 + 1013904223) & 0x7fffffff;
      return seed / 0x7fffffff;
    }

    /* 太陽方向に直交する 2 軸。房をこの平面で細く、sunDir 方向に長く伸ばす。 */
    var axU = new T.Vector3(0, 1, 0).cross(sunDir).normalize();
    var axV = new T.Vector3().crossVectors(sunDir, axU).normalize();

    /* --- 房（クラスタ）の中心 -----------------------------------------------
       粒を一様に撒くと「画面全体に等間隔のゴミ」になり空気に見えない。
       光の通り道に沿って房を作ると、濃い所と抜けている所ができ、
       逆光で「筋」として読める。高度は低いほど濃い（粉塵は沈む）。 */
    var CLUSTERS = 44;
    var cx = new Float32Array(CLUSTERS);
    var cy = new Float32Array(CLUSTERS);
    var cz = new Float32Array(CLUSTERS);
    var ci;
    for (ci = 0; ci < CLUSTERS; ci++) {
      cx[ci] = (rnd() - 0.5) * SPAN;
      cz[ci] = (rnd() - 0.5) * SPAN;
      cy[ci] = Y_BOT + (Y_TOP - Y_BOT) * Math.pow(rnd(), 2.1);
    }

    var i, i3, t, r, a, k;
    for (i = 0; i < COUNT; i++) {
      i3 = i * 3;
      if (rnd() < 0.62) {
        /* 房に属する粒：sunDir に沿って ±3m、直交方向には ±1.7m だけ散らす。
           房を細長くするほど光の筋に見えるが、細すぎると数珠つなぎの
           不自然な線になるので、直交方向にもそれなりに厚みを持たせる。 */
        ci = (rnd() * CLUSTERS) | 0;
        t = (rnd() - 0.5) * 6.0;
        r = Math.pow(rnd(), 0.6) * 1.7;
        a = rnd() * Math.PI * 2.0;
        pos[i3] = cx[ci] + sunDir.x * t + (axU.x * Math.cos(a) + axV.x * Math.sin(a)) * r;
        pos[i3 + 1] = cy[ci] + sunDir.y * t * 0.35 + (axU.y * Math.cos(a) + axV.y * Math.sin(a)) * r;
        pos[i3 + 2] = cz[ci] + sunDir.z * t + (axU.z * Math.cos(a) + axV.z * Math.sin(a)) * r;
      } else if (rnd() < 0.55) {
        /* 沈殿層。腰から胸の高さに薄い veil を作る。
           人物やカバーの前後に薄い膜が挟まると、初めて空間に奥行きが出る。 */
        pos[i3] = (rnd() - 0.5) * SPAN;
        pos[i3 + 1] = 0.15 + Math.pow(rnd(), 1.3) * 1.9;
        pos[i3 + 2] = (rnd() - 0.5) * SPAN;
      } else {
        /* 房にも沈殿層にも入らない下地。これが無いと房と房の間が不自然に空く。
           高度は 2.4 乗で下に寄せる。 */
        pos[i3] = (rnd() - 0.5) * SPAN;
        pos[i3 + 1] = Y_BOT + (Y_TOP - Y_BOT) * Math.pow(rnd(), 2.4);
        pos[i3 + 2] = (rnd() - 0.5) * SPAN;
      }
      if (pos[i3 + 1] < Y_BOT) pos[i3 + 1] = Y_BOT + rnd() * 0.4;
      if (pos[i3 + 1] > Y_TOP) pos[i3 + 1] = Y_TOP - rnd() * 0.4;
      yBase[i] = pos[i3 + 1];

      /* 粒径はワールド直径[m]。大半は 2.5〜8cm の微粒、1 割だけ 10cm 前後の灰片。
         これ以上大きくすると近づいたとき画面に「染み」が出る。 */
      k = rnd();
      siz[i] = (k > 0.90) ? (0.095 + rnd() * 0.055) : (0.025 + Math.pow(rnd(), 1.7) * 0.055);

      /* 風は西日と同じ側から弱く流し、ゆっくり沈ませる。 */
      vel[i3] = 0.16 + rnd() * 0.22;
      vel[i3 + 1] = -(0.012 + rnd() * 0.030);
      vel[i3 + 2] = -0.05 + rnd() * 0.16;
      phs[i] = rnd() * Math.PI * 2.0;
    }

    var mGeo = new T.BufferGeometry();
    mGeo.setAttribute('position', new T.BufferAttribute(pos, 3));
    mGeo.setAttribute('aSize', new T.BufferAttribute(siz, 1));

    var moteVert = J([
      'attribute float aSize;',
      'uniform vec3 uSunDir;',
      'uniform float uHalfH;',
      'varying float vGlow;',
      'varying float vFade;',
      'varying vec2 vAxis;',
      'void main() {',
      '  vec4 wp = modelMatrix * vec4(position, 1.0);',
      '  vec3 vd = normalize(wp.xyz - cameraPosition);',
      /* 前方散乱。視線が太陽方向に近い粒ほど強く光る＝逆光で光る粉塵。
         広い項と鋭い項の 2 段にして、太陽の近くだけ白飛びするのを避ける。 */
      '  float b = max(dot(vd, uSunDir), 0.0);',
      '  vGlow = 0.30 * pow(b, 1.6) + 0.70 * pow(b, 6.0);',
      '  vec4 mv = viewMatrix * wp;',
      '  float dist = max(-mv.z, 0.05);',
      /* 近すぎる粒は巨大な染みになるので消し、遠い粒は霧に溶かす。 */
      '  vFade = smoothstep(0.9, 3.2, dist) * (1.0 - smoothstep(11.0, 20.0, dist));',
      /* 高い所ほど薄く。上空の粒がはっきり見えると「星」になる。 */
      '  vFade *= 1.0 - 0.78 * smoothstep(2.0, 6.0, wp.y);',
      /* 画面高さと投影行列から実寸を出す。解像度が変わっても粒の大きさが変わらない。 */
      /* 上限 11px。これを超えると 1 粒が「レンズの染み」として見えてしまう。 */
      '  gl_PointSize = clamp(aSize * uHalfH * projectionMatrix[1][1] / dist, 1.0, 11.0);',
      '  vec4 pA = projectionMatrix * mv;',
      /* 太陽方向を画面上に投影した軸。粒をこの軸に沿ってわずかに伸ばすと、
         個々の粒が光の向きを持ち、集まったとき「筋」として読める。 */
      '  vec4 pB = projectionMatrix * (viewMatrix * vec4(wp.xyz + uSunDir * 0.6, 1.0));',
      '  vec2 sA = pA.xy / max(pA.w, 1e-4);',
      '  vec2 sB = pB.xy / max(pB.w, 1e-4);',
      '  vAxis = normalize(sB - sA + vec2(1e-5, 1e-5));',
      '  gl_Position = pA;',
      '}'
    ]);

    var moteFrag = J([
      'uniform vec3 uDust;',
      'uniform vec3 uSun;',
      'varying float vGlow;',
      'varying float vFade;',
      'varying vec2 vAxis;',
      'void main() {',
      /* gl_PointCoord は Y が下向き。画面座標系に揃えるため反転する。 */
      '  vec2 q = vec2(gl_PointCoord.x, 1.0 - gl_PointCoord.y) - 0.5;',
      '  float along = dot(q, vAxis);',
      '  float across = dot(q, vec2(-vAxis.y, vAxis.x));',
      /* 逆光の粒だけを光軸方向に伸ばす。全部伸ばすと雨に見える。 */
      '  float stretch = 1.0 / (1.0 + 1.1 * vGlow);',
      /* 縁の立った円は「粒」ではなく「点」に見える。指数の落ちで柔らかくする。 */
      '  float soft = exp(-(along * along * stretch * stretch + across * across) * 8.0);',
      /* 粒は "点" として主張してはいけない。薄く重ねて空気の厚みになるのが役目。
         ただし逆光側は明確に光らせないと「粉塵が残っている」と読めない。 */
      '  float a = soft * vFade * (0.13 + 0.62 * vGlow);',
      '  if (a < 0.004) discard;',
      /* 逆光の粒は粉塵色ではなく太陽の色を返す。手前の粒ほど白く抜ける。 */
      '  vec3 c = mix(uDust * 0.70, uSun * 1.05, clamp(vGlow, 0.0, 1.0));',
      '  gl_FragColor = vec4(c, a);',
      '  #include <tonemapping_fragment>',
      '  #include <colorspace_fragment>',
      '}'
    ]);

    var moteMat = new T.ShaderMaterial({
      uniforms: {
        uSunDir: { value: sunDir.clone() },
        uDust: { value: new T.Color(P.dust) },
        uSun: { value: new T.Color(P.skySun) },
        uHalfH: { value: 310.0 }
      },
      vertexShader: moteVert,
      fragmentShader: moteFrag,
      transparent: true,
      depthWrite: false,
      fog: false
    });

    var motes = new T.Points(mGeo, moteMat);
    motes.frustumCulled = false;   // 中身が毎フレーム動くので境界球は当てにならない
    motes.renderOrder = 10;
    scene.add(motes);

    /* 画面高さは描画直前にしか分からない。onBeforeRender で拾えば
       レンダラを引数で受け取らずに解像度追従できる。 */
    var _v2 = new T.Vector2();
    motes.onBeforeRender = function (renderer) {
      renderer.getDrawingBufferSize(_v2);
      moteMat.uniforms.uHalfH.value = _v2.y * 0.5;
    };

    /* =======================================================================
       4. 更新
       ===================================================================== */
    var posAttr = mGeo.getAttribute('position');
    var clock = 0;

    function update(dt, camera) {
      if (!(dt > 0)) dt = 0.016;
      if (dt > 0.05) dt = 0.05;      // タブ復帰時に粒が飛ぶのを防ぐ
      clock += dt;

      if (camera) {
        /* 天球はカメラを中心に置き続ける。移動しても空が近づかない。 */
        mesh.position.copy(camera.position);
      }
      var camX = camera ? camera.position.x : 0;
      var camZ = camera ? camera.position.z : 0;

      var arr = posAttr.array;
      var j, j3, dx, dz, sway;
      for (j = 0; j < COUNT; j++) {
        j3 = j * 3;
        /* 一定の風＋粒ごとに位相をずらした揺らぎ。等速直線だと機械的に見える。 */
        sway = Math.sin(clock * 0.55 + phs[j]) * 0.055;
        arr[j3] += (vel[j3] + sway) * dt;
        arr[j3 + 1] += (vel[j3 + 1] + sway * 0.35) * dt;
        arr[j3 + 2] += (vel[j3 + 2] - sway * 0.6) * dt;

        /* XZ はカメラ相対に折り返す＝どこまで歩いても粉塵が途切れない。
           房の長さ（約 8m）より SPAN が十分大きいので、
           折り返しで切れる房はごく一部で目に付かない。 */
        dx = arr[j3] - camX;
        if (dx > HALF) arr[j3] -= SPAN; else if (dx < -HALF) arr[j3] += SPAN;
        dz = arr[j3 + 2] - camZ;
        if (dz > HALF) arr[j3 + 2] -= SPAN; else if (dz < -HALF) arr[j3 + 2] += SPAN;

        /* Y は "元いた高度" に戻す。単純に下端→上端へ折り返すと、
           数分後には粒が高さ方向に一様化して沈殿層が消える
           （実測：約3分で低空の偏りが完全に失われた）。
           粒ごとに自分の高度帯へ戻せば、層構造は何分経っても保たれる。
           カメラの上下に追従させないのは、粉塵が地面に溜まった層だから。 */
        if (arr[j3 + 1] < yBase[j] - FALL || arr[j3 + 1] < Y_BOT) arr[j3 + 1] = yBase[j];
        else if (arr[j3 + 1] > Y_TOP) arr[j3 + 1] = Y_TOP;
      }
      posAttr.needsUpdate = true;
    }

    return { mesh: mesh, motes: motes, update: update };
  };
})(typeof window !== 'undefined' ? window : globalThis);

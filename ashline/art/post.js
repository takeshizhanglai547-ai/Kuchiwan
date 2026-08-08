/* =============================================================================
   ASHLINE / post.js  —  ASH.post(T, renderer, scene, camera)

   three の examples/jsm（EffectComposer / UnrealBloomPass）は読み込めないので、
   WebGLRenderTarget と全画面クアッドだけで組み立てた最小構成のブルーム＋トーンマップ。

   絵づくりの狙い（palette.js の宣言「本当に彩度が高いのは火だけ」に従う）:
     ・ブルームは画面を白く濁らせる霞ではなく、マズルフラッシュ／曳光という
       「一点の火」だけが滲む現象として扱う。したがってしきい値は厳しく取り、
       しきい値を超えた分だけを抽出する（超えた色をそのまま持ってこない）。
     ・トーンマップは ACESFilmic を最終シェーダ内で1回だけ行う。
       renderer.toneMapping は NoToneMapping に落とす（二重適用の禁止）。
     ・ビネットはトーンマップ「前」の線形空間で掛ける。ACES のトゥが圧縮するので
       同じ係数でも最終画面では半分以下の効きになり、「かかっているか分からない」
       レンズ的な落ち込みに収まる。露骨なトンネル視野を避けるための順序。

   パス構成（追加ドローコールは 6。契約上限 8 以内）
     1. scene -> rtScene            （HDR。HalfFloat。ここは既存のシーン描画）
     2. prefilter : rtScene   -> halfA     しきい値抽出しながら 1/2 へ縮小
     3. blurH     : halfA     -> halfB
     4. blurV     : halfB     -> halfA     ← 1/2 解像度のブルーム完成
     5. blurH     : halfA     -> quarterA  1/2 の結果をさらに 1/4 へ落としつつ横ぼかし
     6. blurV     : quarterA  -> quarterB  ← 1/4 解像度の広いブルーム完成
     7. composite : rtScene + halfA + quarterB -> 画面
   1/4 側を 1/2 の結果から作る（原画から作り直さない）ことで、
   カーネルが累積して広がりが稼げる。RenderTarget も1枚減る。

   SSAO / SSR / 被写界深度は使わない（§12）。
   ========================================================================== */
(function (g) {
  var ASH = g.ASH = g.ASH || {};

  ASH.post = function (T, renderer, scene, camera) {
    var P = ASH.palette;

    /* -----------------------------------------------------------------------
       共通の頂点シェーダ。
       ポリゴンは「画面より大きい三角形1枚」。四角形(2三角形)にしないのは
       対角線上でのクアッドオーバードローが無く、頂点も3つで済むため。
       行列を一切使わず position をそのままクリップ座標に置く。
       -------------------------------------------------------------------- */
    var VERT = [
      'varying vec2 vUv;',
      'void main() {',
      '  vUv = uv;',
      '  gl_Position = vec4( position.xy, 0.0, 1.0 );',
      '}'
    ].join('\n');

    /* しきい値抽出。
       明るさの指標に「最大チャンネル」を使う。輝度(0.2126R+0.7152G+0.0722B)だと
       火の色（赤〜橙＝G,Bが小さい）が実際の眩しさより低く出てしまい、
       同じ輝度の白っぽい壁と区別できない。最大チャンネルなら
       「彩度の高い火」だけがしきい値を超え、灰色の環境は超えない。
       ソフトニーは、しきい値ちょうどの画素が明滅する（時間的ちらつき）のを防ぐため。
       4タップで縮小するが、平均してからではなく各タップに抽出を掛ける。
       先に平均すると小さな輝点が薄まって消えるため。 */
    var PREFILTER = [
      'uniform sampler2D tDiffuse;',
      'uniform vec2 uTexel;',
      'uniform float uThreshold;',
      'uniform float uKnee;',
      'uniform float uExposure;',
      'varying vec2 vUv;',
      'vec3 prefilter( vec3 c ) {',
      '  c *= uExposure;',
      '  float b = max( max( c.r, c.g ), c.b );',
      '  float soft = clamp( b - uThreshold + uKnee, 0.0, 2.0 * uKnee );',
      '  soft = soft * soft / ( 4.0 * uKnee + 1e-4 );',
      '  float contrib = max( soft, b - uThreshold ) / max( b, 1e-4 );',
      '  return c * contrib;',
      '}',
      'void main() {',
      '  vec2 o = uTexel;',
      '  vec3 s  = prefilter( texture2D( tDiffuse, vUv + vec2( -o.x, -o.y ) ).rgb );',
      '       s += prefilter( texture2D( tDiffuse, vUv + vec2(  o.x, -o.y ) ).rgb );',
      '       s += prefilter( texture2D( tDiffuse, vUv + vec2( -o.x,  o.y ) ).rgb );',
      '       s += prefilter( texture2D( tDiffuse, vUv + vec2(  o.x,  o.y ) ).rgb );',
      '  gl_FragColor = vec4( s * 0.25, 1.0 );',
      '}'
    ].join('\n');

    /* 分離ガウス。13タップ相当（σ=3テクセル）を、隣り合う2タップの重み付き中点を
       バイリニア1回で取る定番手法で7フェッチに畳んでいる。
       9タップ(σ=2)ではなく13タップ(σ=3)にしたのは、滲みを広げたときに
       タップ間隔が空いてリング状の縞が出るのを防ぐため。段数を増やす
       （＝RenderTarget とパスを増やす）よりフェッチを2つ足す方がモバイルでは安い。 */
    var BLUR = [
      'uniform sampler2D tDiffuse;',
      'uniform vec2 uDir;',
      'varying vec2 vUv;',
      'void main() {',
      '  vec3 c = texture2D( tDiffuse, vUv ).rgb * 0.13703;',
      '  c += texture2D( tDiffuse, vUv + uDir * 1.4584 ).rgb * 0.23935;',
      '  c += texture2D( tDiffuse, vUv - uDir * 1.4584 ).rgb * 0.23935;',
      '  c += texture2D( tDiffuse, vUv + uDir * 3.4041 ).rgb * 0.13944;',
      '  c += texture2D( tDiffuse, vUv - uDir * 3.4041 ).rgb * 0.13944;',
      '  c += texture2D( tDiffuse, vUv + uDir * 5.3517 ).rgb * 0.05271;',
      '  c += texture2D( tDiffuse, vUv - uDir * 5.3517 ).rgb * 0.05271;',
      '  gl_FragColor = vec4( c, 1.0 );',
      '}'
    ].join('\n');

    /* 合成＋ACESFilmic＋ビネット。
       ACES の式は three 本体の tonemapping_pars_fragment と同一のものを写している。
       （renderer 側を NoToneMapping にした上でここだけで掛けるので、見た目は
         renderer.toneMapping = ACESFilmic と一致する。exposure / 0.6 の 0.6 も本体準拠。） */
    var COMPOSITE = [
      'uniform sampler2D tScene;',
      'uniform sampler2D tBloomA;',
      'uniform sampler2D tBloomB;',
      'uniform float uIntensity;',
      'uniform float uWide;',
      'uniform float uExposure;',
      'uniform float uVignette;',
      'varying vec2 vUv;',

      'vec3 RRTAndODTFit( vec3 v ) {',
      '  vec3 a = v * ( v + 0.0245786 ) - 0.000090537;',
      '  vec3 b = v * ( 0.983729 * v + 0.4329510 ) + 0.238081;',
      '  return a / b;',
      '}',
      'vec3 acesFilmic( vec3 color ) {',
      '  const mat3 ACESInputMat = mat3(',
      '    vec3( 0.59719, 0.07600, 0.02840 ), vec3( 0.35458, 0.90834, 0.13383 ),',
      '    vec3( 0.04823, 0.01566, 0.83777 ) );',
      '  const mat3 ACESOutputMat = mat3(',
      '    vec3(  1.60475, -0.10208, -0.00327 ), vec3( -0.53108,  1.10813, -0.07276 ),',
      '    vec3( -0.07367, -0.00605,  1.07602 ) );',
      '  color /= 0.6;',
      '  color = ACESInputMat * color;',
      '  color = RRTAndODTFit( color );',
      '  color = ACESOutputMat * color;',
      '  return clamp( color, 0.0, 1.0 );',
      '}',

      'void main() {',
      '  vec3 c = texture2D( tScene, vUv ).rgb * uExposure;',
      /* 1/2 と 1/4 を uWide で配合する。広がりを上げるほど 1/4 側（＝広く薄い裾）の
         比率が上がるが、総量は正規化するので「広げると明るくなる」事故を防ぐ。 */
      '  vec3 bloom = ( texture2D( tBloomA, vUv ).rgb + texture2D( tBloomB, vUv ).rgb * uWide )',
      '             / ( 1.0 + uWide );',
      '  c += bloom * uIntensity;',
      /* ビネットは線形空間で。uv 空間の楕円なので画面の縦横比にそのまま馴染む。
         0.42 から立ち上げて外周だけを落とす。中央 8 割は完全に無効。 */
      '  float d = length( vUv - 0.5 );',
      '  float fall = smoothstep( 0.42, 0.78, d );',
      '  c *= 1.0 - uVignette * fall * fall;',
      '  c = acesFilmic( c );',
      '  gl_FragColor = vec4( c, 1.0 );',
      '  #include <colorspace_fragment>',
      /* 出力は 8bit。空のグラデーションやビネットの裾のように、
         100px かけて 1/255 しか変わらない面では必ず縞（contour）が出る。
         量子化1段ぶんのディザで潰す。sRGB へ符号化した「後」に足すのが要点で、
         線形空間で足すと暗部で数段ぶんに膨らんでノイズとして見えてしまう。
         interleaved gradient noise：sin を使わないのでモバイルの精度でも破綻しない。 */
      '  float ign = fract( 52.9829189 * fract( dot( gl_FragCoord.xy, vec2( 0.06711056, 0.00583715 ) ) ) );',
      '  gl_FragColor.rgb += ( ign - 0.5 ) / 255.0;',
      '}'
    ].join('\n');

    /* -----------------------------------------------------------------------
       全画面三角形（頂点3・三角形1）。UV は 0..2 に伸ばして 0..1 が画面に一致する。
       -------------------------------------------------------------------- */
    var quadGeo = new T.BufferGeometry();
    quadGeo.setAttribute('position', new T.BufferAttribute(
      new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    quadGeo.setAttribute('uv', new T.BufferAttribute(
      new Float32Array([0, 0, 2, 0, 0, 2]), 2));

    function passMat(frag, uniforms) {
      return new T.ShaderMaterial({
        uniforms: uniforms,
        vertexShader: VERT,
        fragmentShader: frag,
        depthTest: false,
        depthWrite: false,
        blending: T.NoBlending
      });
    }

    var uPre = {
      tDiffuse: { value: null },
      uTexel: { value: new T.Vector2(1, 1) },
      uThreshold: { value: P.bloomThreshold },
      /* ニーはしきい値の 30%。これ以上広げると灰色の壁が薄く光り始める。 */
      uKnee: { value: P.bloomThreshold * 0.30 },
      uExposure: { value: P.exposure }
    };
    var uBlur = {
      tDiffuse: { value: null },
      uDir: { value: new T.Vector2(0, 0) }
    };
    var uComp = {
      tScene: { value: null },
      tBloomA: { value: null },
      tBloomB: { value: null },
      uIntensity: { value: P.bloomIntensity },
      uWide: { value: P.bloomRadius },
      uExposure: { value: P.exposure },
      uVignette: { value: P.vignette }
    };

    var matPre = passMat(PREFILTER, uPre);
    var matBlur = passMat(BLUR, uBlur);
    var matComp = passMat(COMPOSITE, uComp);

    var quad = new T.Mesh(quadGeo, matComp);
    quad.frustumCulled = false;
    var quadScene = new T.Scene();
    quadScene.add(quad);
    /* 頂点シェーダが行列を使わないのでカメラは形式的なもの。 */
    var quadCam = new T.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    /* -----------------------------------------------------------------------
       RenderTarget。全部で5枚。
         rtScene  : 実寸   HalfFloat + depth（唯一の実寸 HDR バッファ）
         halfA/B  : 1/2    ping-pong
         quadA/B  : 1/4    ping-pong
       1/8 以下を作らないのは、モバイルでこれ以上段を増やすと
       パス数（＝タイル解決の回数）の方が効いてくるため。広がりは
       1/4 のカーネル幅で稼ぐ。
       -------------------------------------------------------------------- */
    var hdrType = T.HalfFloatType;
    if (!renderer.capabilities.isWebGL2 &&
      !(renderer.extensions && renderer.extensions.has('EXT_color_buffer_half_float'))) {
      /* WebGL1 で半精度カラーバッファが無い端末では 8bit に落として動作だけ保つ。 */
      hdrType = T.UnsignedByteType;
    }

    function makeRT(w, h, depth, type) {
      var rt = new T.WebGLRenderTarget(Math.max(1, w), Math.max(1, h), {
        type: type,
        format: T.RGBAFormat,
        minFilter: T.LinearFilter,
        magFilter: T.LinearFilter,
        wrapS: T.ClampToEdgeWrapping,
        wrapT: T.ClampToEdgeWrapping,
        depthBuffer: !!depth,
        stencilBuffer: false,
        generateMipmaps: false
      });
      rt.texture.generateMipmaps = false;
      return rt;
    }

    var W = 1, H = 1, hw = 1, hh = 1, qw = 1, qh = 1;
    var rtScene = makeRT(1, 1, true, hdrType);

    /* シーンを RenderTarget に描く時点で、canvas の antialias:true は効かなくなる。
       AA を捨てると鉄筋やシルエットの縁がジャギって荒廃の線が汚れるので MSAA を張るが、
       RGBA16F の 4x はタイルメモリを 32byte/px 使い、モバイルのタイルを細かく割って
       頂点処理をやり直させる。解像度が上がるほど割に合わないので画素数で段階を落とす。
       WebGL1 では samples は無視されるだけで害はない。 */
    function sampleCount(px) {
      if (!renderer.capabilities.isWebGL2) return 0;
      if (px <= 1200000) return 4;   // 〜720p 相当。ここは 4x を張っても軽い
      if (px <= 3200000) return 2;   // 1080p / DPR2 の携帯。2x で縁の暴れだけ取る
      return 0;                      // それ以上は解像度そのものが AA になる
    }
    var halfA = makeRT(1, 1, false, hdrType);
    var halfB = makeRT(1, 1, false, hdrType);
    var quadA = makeRT(1, 1, false, hdrType);
    var quadB = makeRT(1, 1, false, hdrType);

    /* ぼかしの広がり（カーネルのテクセル倍率）。
       カーネルはテクセル単位なので、そのままだと高解像度ほど滲みが
       画面比で小さくなってしまう。基準を 720p として解像度で補正し、
       どの端末でも「画面の高さの何％滲むか」が揃うようにする。
       上下のクランプは、上げすぎてタップ間隔が空きリング状の縞が出るのを防ぐため。
       基準値 bloomRadius=0.85 で発光体の縁から直径ぶんだけ外へ滲む量になる。
       これ以上広げると近傍の滲みが痩せて画面全体が薄く濁る（実測で確認）。 */
    function spread() {
      var k = H / 720.0;
      if (k < 0.75) k = 0.75; else if (k > 1.6) k = 1.6;
      return (0.55 + P.bloomRadius * 2.4) * k;
    }

    /* renderer 側のトーンマップは必ず切る（最終シェーダで1回だけ掛けるため）。
       元の設定は覚えておき、setEnabled(false) の素通し時に戻す。 */
    var savedToneMapping = renderer.toneMapping;
    var savedExposure = renderer.toneMappingExposure;
    var enabled = true;
    renderer.toneMapping = T.NoToneMapping;

    function draw(mat, target) {
      quad.material = mat;
      renderer.setRenderTarget(target || null);
      renderer.render(quadScene, quadCam);
    }

    function setSize(w, h) {
      var pr = renderer.getPixelRatio ? renderer.getPixelRatio() : 1;
      W = Math.max(1, Math.floor(w * pr));
      H = Math.max(1, Math.floor(h * pr));
      hw = Math.max(1, Math.floor(W / 2)); hh = Math.max(1, Math.floor(H / 2));
      qw = Math.max(1, Math.floor(W / 4)); qh = Math.max(1, Math.floor(H / 4));
      rtScene.samples = sampleCount(W * H);
      rtScene.setSize(W, H);
      halfA.setSize(hw, hh); halfB.setSize(hw, hh);
      quadA.setSize(qw, qh); quadB.setSize(qw, qh);
      /* 抽出時の 4 タップは元解像度の半テクセル。1/2 へ落とす box フィルタになる。 */
      uPre.uTexel.value.set(0.5 / W, 0.5 / H);
    }

    function render(s, c) {
      var sc = s || scene, cm = c || camera;
      if (!enabled) {
        renderer.setRenderTarget(null);
        renderer.render(sc, cm);
        return;
      }
      /* 1) シーンを HDR バッファへ */
      renderer.setRenderTarget(rtScene);
      renderer.render(sc, cm);

      var sp = spread();

      /* 2) しきい値抽出（実寸 -> 1/2） */
      uPre.tDiffuse.value = rtScene.texture;
      uPre.uThreshold.value = P.bloomThreshold;
      uPre.uKnee.value = P.bloomThreshold * 0.30;
      uPre.uExposure.value = P.exposure;
      draw(matPre, halfA);

      /* 3-4) 1/2 解像度の分離ガウス（横 -> 縦） */
      uBlur.tDiffuse.value = halfA.texture;
      uBlur.uDir.value.set(sp / hw, 0);
      draw(matBlur, halfB);

      uBlur.tDiffuse.value = halfB.texture;
      uBlur.uDir.value.set(0, sp / hh);
      draw(matBlur, halfA);

      /* 5-6) 1/2 の結果を 1/4 へ落としながらもう一段ぼかす。
         オフセットを 2 倍にするので、画面上のカーネル幅は 1/2 段の 2 倍。 */
      uBlur.tDiffuse.value = halfA.texture;
      uBlur.uDir.value.set(sp * 2.0 / hw, 0);
      draw(matBlur, quadA);

      uBlur.tDiffuse.value = quadA.texture;
      uBlur.uDir.value.set(0, sp / qh);
      draw(matBlur, quadB);

      /* 7) 合成 + ACESFilmic + ビネット -> 画面 */
      uComp.tScene.value = rtScene.texture;
      uComp.tBloomA.value = halfA.texture;
      uComp.tBloomB.value = quadB.texture;
      uComp.uIntensity.value = P.bloomIntensity;
      uComp.uWide.value = P.bloomRadius;
      uComp.uExposure.value = P.exposure;
      uComp.uVignette.value = P.vignette;
      draw(matComp, null);
    }

    function setEnabled(b) {
      b = !!b;
      if (b === enabled) return;
      enabled = b;
      if (enabled) {
        /* ポストが自前で掛けるので renderer 側は必ず切る */
        savedToneMapping = renderer.toneMapping;
        savedExposure = renderer.toneMappingExposure;
        renderer.toneMapping = T.NoToneMapping;
      } else {
        /* 素通し時にトーンマップまで消えると露出が破綻して真っ暗になるので、
           renderer 側の ACES を復帰させる。こちらでも二重適用にはならない。 */
        renderer.toneMapping = (savedToneMapping === T.NoToneMapping) ?
          T.ACESFilmicToneMapping : savedToneMapping;
        renderer.toneMappingExposure = savedExposure || P.exposure;
      }
    }

    function dispose() {
      rtScene.dispose(); halfA.dispose(); halfB.dispose();
      quadA.dispose(); quadB.dispose();
      matPre.dispose(); matBlur.dispose(); matComp.dispose();
      quadGeo.dispose();
    }

    /* 初期サイズは renderer の現在のバッファから拾う（setSize を呼び忘れても動くように）。 */
    var v = new T.Vector2();
    renderer.getSize(v);
    setSize(v.x || 1, v.y || 1);

    return {
      render: render,
      setSize: setSize,
      setEnabled: setEnabled,
      dispose: dispose
    };
  };
})(typeof window !== 'undefined' ? window : globalThis);

/* =============================================================================
   ASHLINE / light.js  —  ASH.light(T, scene)

   絵の狙い：陽が低い午後遅く、逆光。太陽は画面の奥・左手から手前へ低く差す。
   だからカメラを向いている面（＝プレイヤーが一番よく見る面）は必ず影に沈み、
   物体の縁だけが暖色で光る。「暗い面積の中に、輪郭線と火だけが明るい」画面を作る。

   影を落とす光は sun ただ1つ（契約§12）。それ以外の陰影＝
     ・hemi（HemisphereLight）による空／地面の回り込み  ＝影が真っ黒に潰れない保険
     ・applyRim() が Lambert シェーダに焼き込む擬似リム＋高さ擬似AO
   で作る。追加のライトは一切作らない。

   three r160 の ShaderLib.lambert を実際にダンプして置換位置を決めている：
     頂点   : #include <common>        → varying 宣言を足す
              #include <fog_vertex>    → ワールド座標の varying を計算（最後尾なので安全）
     断片   : #include <common>        → varying / uniform 宣言
              #include <aomap_fragment>→ 直前の lights_fragment_end で確定した
                                         reflectedLight.indirectDiffuse に高さAOを掛ける
              #include <opaque_fragment> → その直前で確定した outgoingLight にリムを足す
   この3+2箇所は lambert / phong / standard に共通して存在するので、
   Lambert 以外を渡されても壊れない。
   ========================================================================== */
(function (g) {
  var ASH = g.ASH = g.ASH || {};

  ASH.light = function (T, scene) {
    var P = ASH.palette;

    /* -----------------------------------------------------------------------
       アリーナの実体積。COVERS は最大 h=2.0 程度、外周壁が 3m 前後なので
       y は -0.4〜7.2 で足りる（背景の廃墟スカイラインは影を落とさせない）。
       ここを大きく取りすぎると 1024px の影が粗くなるので、必要最小限にする。
       -------------------------------------------------------------------- */
    /* -----------------------------------------------------------------------
       照度の単位あわせ
       three r155 以降 WebGLRenderer._useLegacyLights の既定が false になり、
       ライトの色に π が掛からなくなった（vendor/three.min.js r160 で実測確認済み：
       `const M = useLegacyLights === true ? Math.PI : 1`）。
       一方 BRDF_Lambert は albedo/π のままなので、
       palette の強度値をそのまま渡すと画面が π 分の1に沈む。
       palette は「最終画面より少し明るい」値として書かれているので、
       ここで π を戻して palette の意図した明るさに合わせる。
       （renderer を受け取れない契約なので、renderer 側の設定には触れない）
       -------------------------------------------------------------------- */
    var LIGHT_UNIT = Math.PI;

    var ARENA_HX = 13.5, ARENA_HZ = 13.5;
    var ARENA_Y0 = -0.4, ARENA_Y1 = 7.2;
    var cx = 0.0, cy = (ARENA_Y0 + ARENA_Y1) * 0.5, cz = 0.0;
    var hx = ARENA_HX, hy = (ARENA_Y1 - ARENA_Y0) * 0.5, hz = ARENA_HZ;

    /* -----------------------------------------------------------------------
       太陽
       P.sunDir は「太陽のある方向」。光はその逆向きに進む＝逆光になる。
       -------------------------------------------------------------------- */
    var zAxis = new T.Vector3(P.sunDir.x, P.sunDir.y, P.sunDir.z).normalize();

    /* シャドウカメラは OrthographicCamera で up=(0,1,0) のまま lookAt される。
       同じ基底を手で組んで、アリーナのAABBをその基底に射影し、
       left/right/top/bottom/near/far を「ぴったり」に決める。
       球で包むより上下方向が半分近く詰まり、テクセルが細かくなる。 */
    var upRef = new T.Vector3(0, 1, 0);
    if (Math.abs(zAxis.dot(upRef)) > 0.999) upRef.set(0, 0, 1);   // 真上からの光でも破綻しないように
    var xAxis = new T.Vector3().crossVectors(upRef, zAxis).normalize();
    var yAxis = new T.Vector3().crossVectors(zAxis, xAxis).normalize();

    /* AABB を任意軸に射影したときの半径（各軸成分の絶対値の重み付き和） */
    function extentOn(a) {
      return hx * Math.abs(a.x) + hy * Math.abs(a.y) + hz * Math.abs(a.z);
    }
    var ex = extentOn(xAxis), ey = extentOn(yAxis), ez = extentOn(zAxis);

    var sun = new T.DirectionalLight(P.sunColor, P.sunIntensity * LIGHT_UNIT);
    /* 光源はアリーナ中心から太陽方向へ ez+2m。手前に2mの余白を残すのは、
       アリーナのすぐ外にいる投影者（壁の張り出しなど）を near で切らないため。 */
    var dist = ez + 2.0;
    sun.position.set(cx + zAxis.x * dist, cy + zAxis.y * dist, cz + zAxis.z * dist);
    sun.target.position.set(cx, cy, cz);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);

    var sc = sun.shadow.camera;
    sc.left = -ex; sc.right = ex;
    sc.top = ey; sc.bottom = -ey;
    sc.near = 0.5;
    sc.far = dist + ez + 1.0;
    sc.updateProjectionMatrix();

    /* bias は「深度そのもの」をずらすので大きくすると peter-panning（浮き）になる。
       normalBias は法線方向に押し出すので、傾いた面のアクネによく効き、浮きは出にくい。
       テクセルのワールドサイズは 2*ex/1024 ≈ 0.037m なので、
       normalBias はその 1.5 倍前後を上限に据え、bias はごく浅く当てる。 */
    sun.shadow.bias = -0.00035;
    sun.shadow.normalBias = 0.042;
    sun.shadow.radius = 1.0;    // PCFShadowMap のタップ幅。広げるとアクネも広がるので1に据える

    scene.add(sun);
    scene.add(sun.target);

    /* -----------------------------------------------------------------------
       環境光（影なし）
       上＝冷たい青灰、下＝地面からの暖かい照り返し。
       これが影の底を作る。0 にすると影が真っ黒に潰れて「火の一点」が効かなくなる。
       派手にしてはいけない：ここを上げると画面全体が均一に持ち上がり、§3に反する。
       -------------------------------------------------------------------- */
    var hemi = new T.HemisphereLight(P.ambientSky, P.ambientGround, P.ambientIntensity * LIGHT_UNIT);
    hemi.position.set(0, 1, 0);   // 半球の軸。既定と同じだが明示しておく
    scene.add(hemi);

    /* =======================================================================
       applyRim —— シェーダ焼き込み
       ==================================================================== */
    var rimColor = ASH.col(T, P.rimColor);
    var sunDirW = zAxis.clone();          // ワールド空間の「太陽の方向」

    /* --- 頂点側：ワールド座標だけを varying で渡す ------------------------
       ワールド法線は渡さない。game.js の遮蔽は Box を非一様スケールしているので
       mat3(modelMatrix) では法線が歪む。断片側で normalMatrix 済みの view 法線を
       viewMatrix の転置で戻す方が正しく、かつ varying を1本節約できる。     */
    var VERT_DECL = [
      '#include <common>',
      'varying vec3 vAshWPos;'
    ].join('\n');

    var VERT_BODY = [
      '#include <fog_vertex>',
      'vec4 ashWP = vec4( transformed, 1.0 );',
      '#ifdef USE_BATCHING',
      '  ashWP = batchingMatrix * ashWP;',
      '#endif',
      '#ifdef USE_INSTANCING',
      '  ashWP = instanceMatrix * ashWP;',
      '#endif',
      'vAshWPos = ( modelMatrix * ashWP ).xyz;'
    ].join('\n');

    var FRAG_DECL = [
      '#include <common>',
      'varying vec3 vAshWPos;',
      'uniform vec3 uAshRimColor;',
      'uniform vec3 uAshSunDirW;',
      'uniform float uAshRimStrength;',
      'uniform float uAshRimPow;',
      'uniform float uAshAoStrength;',
      'uniform vec2 uAshAoRange;'
    ].join('\n');

    /* 高さ擬似AO：ワールドYが低いほど環境光を削る。
       直接光（太陽）には掛けない。遮蔽は「回り込む光」を遮る現象であって、
       直射を削ると日向まで濁り、明暗のコントラストが死ぬため。

       さらに「上を向いた面には効かせない」。床は真上に空が開けているので
       実際にはほとんど遮蔽されない。ここを一律に暗くすると
       床から冷たい空の色（hemiの上半球）が抜け落ち、
       暖色の直射だけが残って地面が泥のような茶色に転ぶ。
       壁の根元・脚元のような「立っている面の低い所」だけを沈ませたい。

       ashNw / ashUpness はこの後のリムでも使い回す（同じ main() のスコープ）。 */
    var FRAG_AO = [
      '#include <aomap_fragment>',
      'vec3 ashNv = normalize( normal );',
      'vec3 ashNw = normalize( ashNv * mat3( viewMatrix ) );',
      'float ashUpness = smoothstep( 0.30, 0.90, ashNw.y );',
      'float ashAoS = uAshAoStrength * ( 1.0 - ashUpness );',
      'float ashAo = mix( 1.0 - ashAoS, 1.0,',
      '  smoothstep( uAshAoRange.x, uAshAoRange.y, vAshWPos.y ) );',
      'reflectedLight.indirectDiffuse *= ashAo;'
    ].join('\n');

    /* フレネル擬似リム：
       (1) 視線と法線が直交するほど強い＝輪郭にだけ乗る。
       (2) 太陽の側を向いた面にだけ出す＝逆光の縁光になる。
           これを掛けないと全方位が均一に光る「安いフレネル」になり、§3で不合格。
           ただし真正面から陽を受けている面（ashSD が大きい面）では 0.55 だけ落とす。
           そこは直射で既に明るいので、足すと面ごと持ち上がって
           「彩度を落とした画面に一点の火」が壊れる。
       (3) ほぼ真上を向いた面だけリムを切る。
           床は視線が浅くなるほどフレネルが1に近づき、遠景の地面が一面光ってしまう。
           一方、閾値を下げすぎると球や肩の「上側の縁」まで消える。
           低い西日のリムが一番効くのはまさにその上の縁なので、
           0.86〜0.995 という「ほぼ水平面だけ」に絞った実測値にしている。
       (4) 素材色をわずかに混ぜる。完全な単色加算は貼り付けた光に見える。 */
    var FRAG_RIM = [
      'vec3 ashVv = normalize( vViewPosition );',
      'float ashFres = 1.0 - saturate( dot( ashNv, ashVv ) );',
      'ashFres = pow( ashFres, uAshRimPow );',
      'float ashSD = dot( ashNw, uAshSunDirW );',
      'float ashBack = smoothstep( -0.28, 0.30, ashSD )',
      '  * ( 1.0 - 0.55 * smoothstep( 0.30, 0.85, ashSD ) );',
      'float ashUp = 1.0 - smoothstep( 0.86, 0.995, ashNw.y );',
      'vec3 ashTint = mix( vec3( 1.0 ), diffuseColor.rgb, 0.55 );',
      'outgoingLight += uAshRimColor * ashTint * ( uAshRimStrength * ashFres * ashBack * ashUp );',
      '#include <opaque_fragment>'
    ].join('\n');

    var rimUniformSets = [];   // update() から一括で触れるように保持
    var stats = { applied: 0, compiled: 0, failed: 0, lastFrag: '' };

    function applyRim(material, opts) {
      if (!material) return material;
      /* MeshBasicMaterial には normal も vViewPosition も無い。焼き込めないので素通し。 */
      if (material.isMeshBasicMaterial || material.isPointsMaterial ||
        material.isLineBasicMaterial || material.isSpriteMaterial) return material;
      if (material.userData && material.userData.ashRim) return material;   // 二重適用の防止

      opts = opts || {};
      var u = {
        uAshRimColor: { value: rimColor.clone() },
        uAshSunDirW: { value: sunDirW.clone() },
        uAshRimStrength: { value: opts.rim === undefined ? P.rimStrength : opts.rim },
        /* rimPow は縁の「幅」。大きいほど細い線になる。
           3.2 だと 1.8m のキャラで 2〜3px にしかならず輪郭として読めなかったので、
           実測しながら 2.0 まで下げている（§3「輪郭にリムが乗ること」） */
        uAshRimPow: { value: opts.rimPow === undefined ? 2.0 : opts.rimPow },
        uAshAoStrength: { value: opts.ao === undefined ? P.aoStrength : opts.ao },
        uAshAoRange: {
          value: new T.Vector2(
            opts.aoLow === undefined ? -0.10 : opts.aoLow,
            opts.aoHigh === undefined ? 1.90 : opts.aoHigh)
        }
      };

      var prev = material.onBeforeCompile;
      var hasPrev = typeof prev === 'function' && prev.toString().indexOf('ASHRIM') < 0
        && prev !== T.Material.prototype.onBeforeCompile;

      material.onBeforeCompile = function ashRimCompile(shader, renderer) {
        /* ASHRIM: この文字列はプログラムキャッシュキーの目印も兼ねる */
        if (hasPrev) prev.call(this, shader, renderer);

        var k;
        for (k in u) shader.uniforms[k] = u[k];

        var vs = shader.vertexShader, fs = shader.fragmentShader;
        var ok = 0;
        if (vs.indexOf('#include <common>') >= 0) { vs = vs.replace('#include <common>', VERT_DECL); ok++; }
        if (vs.indexOf('#include <fog_vertex>') >= 0) { vs = vs.replace('#include <fog_vertex>', VERT_BODY); ok++; }
        if (fs.indexOf('#include <common>') >= 0) { fs = fs.replace('#include <common>', FRAG_DECL); ok++; }
        if (fs.indexOf('#include <aomap_fragment>') >= 0) { fs = fs.replace('#include <aomap_fragment>', FRAG_AO); ok++; }
        if (fs.indexOf('#include <opaque_fragment>') >= 0) { fs = fs.replace('#include <opaque_fragment>', FRAG_RIM); ok++; }

        shader.vertexShader = vs;
        shader.fragmentShader = fs;

        /* 置換が5箇所すべて成立したかを記録する。推測で通ったことにしない。 */
        if (ok === 5) stats.compiled++; else stats.failed++;
        stats.lastOk = ok;
        stats.lastFrag = fs;
        stats.lastVert = vs;
      };

      /* 焼き込みの有無でプログラムを分ける。既定の customProgramCacheKey は
         onBeforeCompile.toString() を返すので実は分かれるが、
         将来 opts でソースを変えたときに事故らないよう明示しておく。 */
      material.customProgramCacheKey = function () { return 'ASHRIM.v1'; };

      material.userData = material.userData || {};
      material.userData.ashRim = true;
      material.needsUpdate = true;

      rimUniformSets.push(u);
      stats.applied++;
      return material;
    }

    /* =======================================================================
       update
       この広場の光は「砲撃戦の翌日の、動かない午後」なので太陽は動かさない。
       動かすと影のちらつきが出るだけで得がない。
       update() が持つ仕事は2つだけ：
         ・経過時間の保持（他モジュールが同じ時計を欲しがったとき用）
         ・setFocus() で注視点が動いた場合のシャドウ錐台の追従（既定では起きない）
       ==================================================================== */
    var time = 0;
    var focusX = cx, focusZ = cz, focusDirty = false;

    function setFocus(x, z) {
      /* アリーナより広い戦場に拡張したくなったとき用。0.5m 以上動いたときだけ
         錐台を組み直す＝テクセルのちらつきを抑えるためのヒステリシス。 */
      if (Math.abs(x - focusX) < 0.5 && Math.abs(z - focusZ) < 0.5) return;
      focusX = x; focusZ = z; focusDirty = true;
    }

    function update(dt) {
      time += (dt || 0);
      if (focusDirty) {
        sun.position.set(focusX + zAxis.x * dist, cy + zAxis.y * dist, focusZ + zAxis.z * dist);
        sun.target.position.set(focusX, cy, focusZ);
        sun.target.updateMatrixWorld();
        focusDirty = false;
      }
      return time;
    }

    return {
      sun: sun,
      hemi: hemi,
      applyRim: applyRim,
      update: update,
      setFocus: setFocus,
      /* 検証用。焼き込みが本当にコンパイルまで届いたかを外から確認できるようにする。 */
      debug: stats
    };
  };
})(typeof window !== 'undefined' ? window : globalThis);

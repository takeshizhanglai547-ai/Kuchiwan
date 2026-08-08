/* =============================================================================
   ASHLINE / アートディレクションの単一の真実
   全モジュールは色をここからしか取らない。直接16進を書くことを禁じる。

   世界観（オリジナル。既存作品の固有名詞・意匠は一切使わない）
     場所：石と鉄筋コンクリートで築かれた旧市街の中央広場。砲撃戦の翌日。
     時刻：陽が低い午後遅く。空気中に粉塵が残り、逆光が層になって見える。
     絵の原則：彩度を落とした暖色の灰とオーカーで環境を作り、
               冷たい青灰＝自機側、鈍い酸化鉄の赤＝敵側の2色だけで陣営を分ける。
               画面の中で本当に彩度が高いのは「火」だけ。それ以外は必ず濁らせる。

   トーンマッピングは ACESFilmic。ACESは彩度と明度を落とすので、
   ここに置く値は「最終画面より少し明るく・少し強い」ものになっている。
   ========================================================================== */
(function (g) {
  var ASH = g.ASH = g.ASH || {};

  ASH.palette = {
    /* ---- 大気 ---------------------------------------------------------- */
    skyZenith: 0x2c333c,     // 天頂：冷たい青灰
    skyHorizon: 0x8a7a63,    // 地平：粉塵に沈んだオーカー
    skySun: 0xffcf9a,        // 太陽まわりの滲み
    fog: 0x6d6355,           // 霧＝地平と同系。遠景を必ず一段濁らせる
    fogNear: 16.0,
    fogFar: 78.0,
    dust: 0xbfae94,          // 空中の粉塵粒

    /* ---- 光 ------------------------------------------------------------ */
    sunColor: 0xffdcb0,      // 低い西日。唯一の影を落とす光
    sunIntensity: 2.35,
    sunDir: { x: -0.62, y: 0.38, z: -0.68 },   // 低く、奥から手前へ＝逆光
    ambientSky: 0x7f95ad,    // 上からの冷たい回り込み
    ambientGround: 0x40372c, // 地面からの暖かい照り返し
    ambientIntensity: 0.62,
    rimColor: 0xffc386,      // 擬似リムライト（シェーダで焼き込む）
    rimStrength: 0.55,
    aoStrength: 0.45,        // 擬似AO（頂点/高さベース）の効き

    /* ---- 素材：環境 ---------------------------------------------------- */
    concrete: 0x9a9184,
    concreteDark: 0x5f584e,
    concreteWet: 0x474441,   // 濡れ／油染みの濃い部分
    plaster: 0xb5a894,       // 剥がれた漆喰
    stone: 0x8d8375,         // 切石
    brick: 0x8a6450,         // 露出した煉瓦
    rebar: 0x4a423a,         // 鉄筋
    metal: 0x6e6862,
    rust: 0x8f5730,
    ground: 0x5c5449,
    groundDark: 0x3d372f,
    ash: 0x6a6259,           // 灰の堆積
    grime: 0x2a2521,         // 汚れの乗算色

    /* ---- 素材：陣営 ---------------------------------------------------- */
    // 自機：冷たい青灰。逆光で黒く落ちても輪郭が読めるよう明度差を大きく取る
    playerArmor: 0x49535e,
    playerArmorDark: 0x2b323a,
    playerCloth: 0x6d6353,
    playerTrim: 0x9aa6b2,

    // 敵：鈍い酸化鉄。自機と色相を180度離す
    enemyArmor: 0x6b3f33,
    enemyArmorDark: 0x3a221c,
    enemyCloth: 0x554438,
    enemyTrim: 0xa86b4b,

    /* ---- 火（画面で唯一彩度を許す色） ---------------------------------- */
    muzzleCore: 0xfff2d0,
    muzzleGlow: 0xffa03c,
    tracer: 0xffb862,
    ember: 0xff7a28,
    impactSpark: 0xffc978,
    bloodMist: 0x5e1c17,

    /* ---- UI ------------------------------------------------------------ */
    uiInk: 0xd8dde2,
    uiDim: 0x8b949d,
    uiWarn: 0xff8a4c,
    uiEnemy: 0xd85a3a,

    /* ---- ポスト --------------------------------------------------------- */
    bloomThreshold: 0.78,
    bloomIntensity: 0.62,
    bloomRadius: 0.85,
    exposure: 1.05,
    vignette: 0.32
  };

  /* 使い勝手：0xRRGGBB -> THREE.Color を作るヘルパ（Tはthreeの名前空間） */
  ASH.col = function (T, hex) { return new T.Color(hex); };

  /* 明度をずらした派生色。素材の面ごとの差を作るのに使う。 */
  ASH.shade = function (T, hex, mul) {
    var c = new T.Color(hex);
    c.multiplyScalar(mul);
    return c;
  };
})(typeof window !== 'undefined' ? window : globalThis);

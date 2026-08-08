/* =============================================================================
   ashline/art/hud.js — ASH.hud()  →  追加CSS文字列（<style> に流し込まれる）

   設計方針（なぜこの値・この手法なのか）

   1) 平時のHUDは完全に無彩色にする。
      パレットの原則は「画面の中で本当に彩度が高いのは火だけ」。
      既存の #btnFire は常時オレンジで塗られており、静止画で見ると
      銃口炎・曳光・敵の酸化鉄よりも彩度が高い。つまり戦闘の「火」より
      ボタンのほうが目立つ。これは原則の破綻なので、平時は uiInk 系の
      灰だけで組み、暖色は「起きている事象」にしか使わない。

   2) 暖色を許すのは4つの瞬間だけ（いずれも一過性の状態で、平時は出ない）
        ・#reticle.lock      … 敵を捕捉した      → uiEnemy（＝敵陣営の色）
        ・#btnFire.down      … 実際に撃っている  → uiWarn
        ・#hitmark.head      … 頭部命中          → uiWarn
        ・#ammo（リロード中）… 撃てない          → uiWarn
      それ以外（アクションボタン・スティック・弾数・DASH・デバッグ）は
      すべて uiInk / uiDim の無彩色に落とす。

   3) 屋外可読性：文字と細線には必ず暗い縁取りを付ける。
      既存は #reticle i に box-shadow が1本あるだけで、明るいコンクリート面の
      上では細部が消える（shots/08_blindfire.png のブラインド時が実例）。
      パレットの uiInk を 0.055 倍した「ほぼ黒」を縁取り用に派生させ、
      レティクル・ヒットマーカー・全テキストに回す。輝度ではなく
      「暗いキーライン」で読ませるので、薄い状態表現を薄いまま保てる。

   4) 色以外の冗長符号を持たせる。
      捕捉状態を色だけで示すと色覚特性のある人には伝わらない。
      #reticle.lock は太さも 2px → 3px に変え、形でも読めるようにする。

   5) レイアウト式には一切触れない。
      §6（操作要素は画面下35%・左右各45%幅の内側）は既存の
      --btn / right / bottom / width / height の式が担保している。
      本モジュールが書くのは枠線・地色・字面・影・角丸だけ。
      transform も #btnFire / #btnAct には掛けない
      （getBoundingClientRect が動いて §6 判定が変わるため）。
      box-sizing:border-box が全体に効いているので border 幅の変更は
      外形寸法に影響しない。
   ========================================================================== */
(function (g) {
  var ASH = g.ASH = g.ASH || {};

  ASH.hud = function () {
    var P = ASH.palette;

    /* --- パレット（数値）から CSS 色を作る。生の16進はモジュールに書かない --- */
    function cl(v) { return v < 0 ? 0 : (v > 255 ? 255 : Math.round(v)); }
    function rgba(hex, a) {
      return 'rgba(' + ((hex >> 16) & 255) + ',' + ((hex >> 8) & 255) + ',' + (hex & 255) + ',' + a + ')';
    }
    /* 明度倍率。足りない色は §0-3 に従いパレットから派生させる */
    function mul(hex, m) {
      return (cl(((hex >> 16) & 255) * m) << 16) | (cl(((hex >> 8) & 255) * m) << 8) | cl((hex & 255) * m);
    }
    /* 2色の線形補間。暖色を白側へ寄せて視認性を稼ぐのに使う */
    function mix(a, b, t) {
      return (cl(((a >> 16) & 255) * (1 - t) + ((b >> 16) & 255) * t) << 16) |
        (cl(((a >> 8) & 255) * (1 - t) + ((b >> 8) & 255) * t) << 8) |
        cl((a & 255) * (1 - t) + (b & 255) * t);
    }

    var INK = P.uiInk;                    // 主線・主文字
    var DIM = P.uiDim;                    // 副次情報
    var WARN = P.uiWarn;                  // 火／不可
    var FOE = P.uiEnemy;                  // 敵
    /* 暖色は輝度で階段を作る。捕捉（鈍い酸化鉄）＜命中（白）＜頭部命中（白熱）。
       同じ暖色で揃えると、頭部命中の×が捕捉レティクルに溶けて命中が読めなくなる
       （実際に検証ショットで確認した）。捕捉は敵陣営の色そのままで暗く沈め、
       命中側だけを白側へ寄せて分離する。 */
    var LOCK = FOE;                       // 捕捉＝敵陣営の鈍い酸化鉄。彩度は高いが輝度は低い
    var HOT = mix(WARN, INK, 0.45);       // 発砲・頭部命中＝白熱側。捕捉より明確に明るい
    var K = mul(INK, 0.055);              // 縁取り用のほぼ黒（無彩色を保つため INK 由来）
    var K2 = mul(INK, 0.105);             // パネル地

    /* 文字の縁取り。屋外の直射下でも輪郭が残る最小構成（2層） */
    var TXT = 'text-shadow:0 0 2px ' + rgba(K, 0.95) + ',0 1px 2px ' + rgba(K, 0.8) + ';';
    /* 細線の縁取り。1px の暗いキーライン＋にじみ。明るい面でも消えない */
    var LINE = 'box-shadow:0 0 0 1px ' + rgba(K, 0.62) + ',0 0 4px ' + rgba(K, 0.9) + ';';

    var css = [

      /* =====================================================================
         レティクル
         --s（拡散量）は game.js が毎フレーム書き込む。
         i:nth-child の transform 式＝拡散の構造なので触らない。
         ここで変えるのは色と縁取りと「捕捉時の太さ」だけ。
         ================================================================== */
      '#reticle i{background:' + rgba(INK, 0.92) + ';' + LINE + '}',
      /* 中心点は着弾点そのもの。HUDで最も重要な1px なので暗環に載せる */
      '#reticle b{background:' + rgba(INK, 0.95) + ';box-shadow:0 0 0 1px ' + rgba(K, 0.8) + ';}',

      /* 捕捉：敵陣営の色＋太さ3px。色を失っても形で分かる */
      '#reticle.lock i{background:' + rgba(LOCK, 0.97) + ';}',
      '#reticle.lock i:nth-child(1),#reticle.lock i:nth-child(2){width:3px;left:-1.5px}',
      '#reticle.lock i:nth-child(3),#reticle.lock i:nth-child(4){height:3px;top:-1.5px}',

      /* ブラインド：既存の意図（細く・薄く・大きく開く）を保持。
         ただし暗いキーラインは残す。明るいコンクリート面の上で
         完全に消えると「撃てているのか」すら分からなくなるため、
         輝度は落としたまま輪郭だけ確保する。 */
      '#reticle.blind i{background:' + rgba(DIM, 0.58) + ';width:1px;height:6px;' +
      'box-shadow:0 0 0 1px ' + rgba(K, 0.7) + ';}',
      '#reticle.blind i:nth-child(3),#reticle.blind i:nth-child(4){height:1px;width:6px}',

      /* =====================================================================
         ヒットマーカー（中央に置いてよい数少ない要素）
         @keyframes hm / hmh は game.js が再始動させるので名前も定義も触らない。
         ================================================================== */
      '#hitmark::before,#hitmark::after{width:16px;height:2px;left:-8px;top:-1px;' +
      'background:' + rgba(INK, 0.98) + ';box-shadow:0 0 0 1px ' + rgba(K, 0.55) + ',0 0 5px ' + rgba(K, 0.9) + ';}',
      /* 頭部命中だけ暖色＋太く長く。胴と頭を色と量の両方で分ける */
      '#hitmark.head::before,#hitmark.head::after{background:' + rgba(HOT, 1) + ';height:3px;' +
      'width:20px;left:-10px;top:-1.5px;box-shadow:0 0 0 1px ' + rgba(K, 0.5) + ',0 0 7px ' + rgba(WARN, 0.55) + ';}',

      /* =====================================================================
         射撃ボタン
         position / right / bottom / width / height は既存式のまま（§6）。
         平時は無彩色の輪。押している間だけ暖色が灯る＝画面で唯一の火。
         ================================================================== */
      /* 地色を「明るい膜」ではなく「暗い膜」にする。明るいコンクリートの上では
         controlが背景に溶けて字が読めなくなる（縞模様の対比テストで確認）。
         暗い膜なら明所では地として沈み、暗所ではほぼ透明で主張しない。 */
      '#btnFire{background:' + rgba(K, 0.30) + ';border:1.5px solid ' + rgba(INK, 0.34) + ';' +
      'color:' + rgba(INK, 0.62) + ';font-size:calc(var(--btn)*.185);letter-spacing:.16em;font-weight:600;' +
      TXT + 'box-shadow:0 0 0 1px ' + rgba(K, 0.45) + ',0 2px 8px ' + rgba(K, 0.5) + ';' +
      'transition:background .05s linear,border-color .05s linear,color .05s linear,opacity .09s linear}',
      '#btnFire.down{background:' + rgba(WARN, 0.26) + ';border-color:' + rgba(WARN, 0.92) + ';' +
      'color:' + rgba(HOT, 0.98) + ';}',
      /* 撃てないときは暖色を出さない：火は弾が出た時だけ灯る。
         .locked は .down と同時に立ちうる（撃てないのに押している）ので
         後段で確実に無彩色へ戻す。 */
      '#btnFire.locked{opacity:.30}',
      '#btnFire.locked.down{background:' + rgba(K, 0.30) + ';border-color:' + rgba(INK, 0.38) + ';' +
      'color:' + rgba(INK, 0.62) + ';}',

      /* =====================================================================
         アクションボタン（文脈でラベルが変わる）
         ================================================================== */
      '#btnAct{background:' + rgba(K, 0.26) + ';border:1.5px solid ' + rgba(INK, 0.36) + ';' +
      'color:' + rgba(INK, 0.84) + ';' + TXT +
      'box-shadow:0 0 0 1px ' + rgba(K, 0.42) + ',0 2px 7px ' + rgba(K, 0.45) + ';' +
      'transition:background .05s linear,border-color .05s linear}',
      '#btnAct.down{background:' + rgba(INK, 0.22) + ';border-color:' + rgba(INK, 0.72) + ';}',
      /* 「乗り越え」など4文字ラベルが円から食み出していた（shots/06_engage.png）。
         ボタン寸法は §6 の担保なので触れない。字面だけ詰めて内側に収める。 */
      '#actLabel{font-size:calc(var(--btn)*.132);line-height:1;letter-spacing:0;white-space:nowrap;display:block}',

      /* =====================================================================
         仮想スティック（親指の下＝見ない要素。最も暗く沈める）
         幅・高さ・transform は game.js がインラインで書く。地色と枠だけ。
         ================================================================== */
      '#stickBase{border:1.5px solid ' + rgba(INK, 0.20) + ';background:' + rgba(K, 0.18) + ';}',
      '#stickKnob{background:' + rgba(INK, 0.22) + ';border:1.5px solid ' + rgba(INK, 0.52) + ';' +
      'box-shadow:0 0 0 1px ' + rgba(K, 0.5) + ';}',

      /* =====================================================================
         弾数（画面右下の外周。視線を中央から離さない位置は既存のまま）
         ================================================================== */
      /* 弾数は一次読み取り情報。既存の 13px 固定だと小型機で沈み大型機で相対的に痩せるので
         ボタン系と同じ --btn に紐づけ、下限12px・上限18pxで括る（位置式には触らない）。 */
      '#ammo{color:' + rgba(INK, 0.66) + ';font-size:clamp(12px,calc(var(--btn)*.22),18px);' +
      'letter-spacing:.12em;font-variant-numeric:tabular-nums;white-space:nowrap;font-weight:600;' + TXT + '}',
      /* 「撃てない」ことを弾数表示にも出す。
         game.js は残弾に応じたクラスを付けないので、状態の交差から導く：
           #btnFire.locked（撃てない）かつ #reticle.hide でない（＝走り/ロール/
           乗り越え/深い遮蔽ではない）⇒ 残るのはリロード中か弾切れだけ。
         :has() 非対応ブラウザではこの規則ごと落ちて無彩色のまま＝安全に劣化する。 */
      '#ui:not(:has(#reticle.hide)) #btnFire.locked ~ #ammo{color:' + rgba(WARN, 0.95) + ';' +
      'animation:ashReload .62s ease-in-out infinite alternate}',
      '@keyframes ashReload{from{opacity:.55}to{opacity:1}}',

      /* =====================================================================
         ダッシュ表示：モードの通知であって危険の通知ではないので暖色を外す。
         位置（下端中央）は左右45%の操作領域の隙間で、唯一空いている帯なので保持。
         ================================================================== */
      '#sprintTag{color:' + rgba(DIM, 0.92) + ';font-size:10.5px;letter-spacing:.34em;font-weight:600;' + TXT + '}',

      /* =====================================================================
         デバッグ / 設定（親指も視線も来ない上端。存在は消さず、主張だけ消す）
         ================================================================== */
      '#dbg{color:' + rgba(DIM, 0.72) + ';background:' + rgba(K, 0.55) + ';font-size:10px;line-height:1.45;' +
      'border-radius:3px;padding:5px 7px;max-width:52vw;letter-spacing:.02em}',
      '#dbgBtn,#btnSet{background:' + rgba(K, 0.44) + ';border:1px solid ' + rgba(INK, 0.16) + ';' +
      'color:' + rgba(DIM, 0.72) + ';border-radius:4px;letter-spacing:.04em;' + TXT + '}',
      '#dbgBtn:active,#btnSet:active{background:' + rgba(INK, 0.16) + ';color:' + rgba(INK, 0.9) + ';}',
      '#setPanel{background:' + rgba(K2, 0.95) + ';border:1px solid ' + rgba(INK, 0.16) + ';border-radius:6px;' +
      'box-shadow:0 6px 18px ' + rgba(K, 0.6) + ';}',
      '#setPanel button{background:' + rgba(INK, 0.06) + ';border:1px solid ' + rgba(INK, 0.18) + ';' +
      'color:' + rgba(INK, 0.86) + ';border-radius:4px;}',
      '#setPanel button:active{background:' + rgba(INK, 0.2) + ';color:' + rgba(INK, 1) + ';}'

    ].join('\n');

    return css;
  };
})(typeof window !== 'undefined' ? window : globalThis);

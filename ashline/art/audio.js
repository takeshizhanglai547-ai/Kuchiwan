/* =============================================================================
   ashline/art/audio.js — ASH.audio()

   音の狙い：石と鉄筋コンクリートで築かれた旧市街の中央広場。屋根が無い。
   だから「反響」は室内リバーブではなく、周囲のファサードから返ってくる
   数えられる数の叩き返し（スラップ）でなければならない。
   §2 柱5「音が情報である」を満たすため、次の3つを音だけで伝える：
     ・敵の位置   … PannerNode(HRTF) ＋ setListener で前後左右を分ける
     ・残弾       … 残りが少ないほど薬室の鳴りが細く金属的になる（内部で計数）
     ・被弾の深刻さ … setLowpass で聴覚が閉じ、瀕死では 4kHz の耳鳴りが立つ
   命中音は 'world'（乾いた石の欠け）/ 'enemy'（湿った鈍い衝撃）/ 'head'（別格）
   をレベルではなく「スペクトル重心・持続・時間構造」で分ける。画面を見なくても
   当たったかどうか、致命打かどうかが分かることが到達条件。

   ---------------------------------------------------------------------------
   設計判断：ノードの使い回しについて（契約 3.11「毎発 new する実装は不合格」）

   WebAudio の仕様上 OscillatorNode / AudioBufferSourceNode は start() を
   1回しか呼べない。したがって「全部を使い回す」ことは原理的に不可能である。
   そこで責務を2つに分けた。

     (1) 恒久ノード（起動時に1度だけ作り、以後 new しない）
         GainNode / BiquadFilterNode / PannerNode / ConvolverNode /
         DelayNode / DynamicsCompressorNode、および常時鳴らす
         アンビエンス用ループ音源と耳鳴り用 OscillatorNode。
         これらは「声道」＝ VOICES 本の固定チャンネルストリップとして常駐する。

     (2) 使い捨てノード（AudioBufferSourceNode のみ）
         ノイズ／サイン波のバッファは起動時に生成して使い回し、
         そこへ差す再生ヘッドだけを毎回作る。BufferSource は内部状態がほぼ無く
         生成コストがフィルタ類より2桁小さいので、ここだけは使い捨てが正解。

   同時発音数は VOICES 本に固定し、空きが無ければ最も古い声を奪う
   （ボイススチール）。奪われた声は音源を stop/disconnect し、
   エンベロープを cancel してから再利用するので、何回呼ばれても
   ノード数もCPU負荷も増えない。640rpm の連射（94ms間隔）で
   テールが 0.35s 残っても、同時に生きる声は最大4本程度に収まる。
   ---------------------------------------------------------------------------

   完全合成。音声ファイル・外部リソースは一切読まない。ES5。色は使わない。
   ========================================================================== */
(function (g) {
  var ASH = g.ASH = g.ASH || {};

  ASH.audio = function () {

    /* =======================================================================
       0. 定数
       ===================================================================== */

    /* 同時発音数。携帯端末の1コアで HRTF パンナー＋畳み込みを賄える上限として
       10 本。640rpm（94ms間隔）の連射でも生存する声は実測で4本前後なので、
       残りは着弾・足音・リロードの重なりに回る余裕になる。 */
    var VOICES = 10;

    /* 1つの声が持つレイヤ数。発砲音のトランジェント／ボディ帯域／ボディ低域／
       薬室の鳴り の4つを1声で賄えるように 4 とした。
       3層を3声に分けると、連射のたびに3本の声を消費して枯渇する。 */
    var BRANCH = 4;

    var MAGAZINE = 30;        /* game.js CFG.fire.mag と同じ。残弾表現の基準 */
    var SPRINT = 6.30;        /* game.js CFG.move.sprint。step() の速度正規化に使う */
    var SOUND_MPS = 343.0;    /* 音速[m/s]。広場の反射時刻を実寸から出すために使う */
    var MASTER = 0.85;        /* マスタ基準レベル。リミッタ手前で歪ませないための余裕 */

    var AC = (typeof window !== 'undefined')
      ? (window.AudioContext || window.webkitAudioContext) : null;

    var ctx = null;
    var dead = !AC;           /* WebAudio が無い環境では全APIを黙って無視する */
    var unlocked = false;

    /* 受聴者。setListener が来る前でも既定値で鳴らせるようにしておく
       （unlock() を呼ばずに他のAPIを呼んでも落ちない、という要求と同じ理由）。 */
    var lis = { x: 0, y: 1.6, z: 0, yaw: 0, fx: 0, fz: -1, rx: 1, rz: 0 };

    var rounds = MAGAZINE;    /* 内部の残弾計数。shot で減り reload('in') で満たす */
    var magSize = MAGAZINE;

    /* 恒久ノード群。ensure() で1度だけ作る。 */
    var master, dmgLP, limiter, duckG, dryBus;
    var wetIn, wetLP, wetHP, convolver, wetOut;
    var slapIn, slapLP, slapDelay, slapFb, slapHP, slapOut;
    var covIn, covDelay, covLP, covFb, covOut;
    var ambG, ambStarted = false, ambWindLP, ambLfoG;
    var tinOsc, tinG;
    var strips = null;

    /* 使い回すバッファ */
    var NZW = null, NZP = null, SINE = null, SILENT = null;
    var SINE_LEN = 512, SINE_BASE = 0;

    var stepSide = 1;         /* 足音の左右交互。走りが「ループ」に聞こえないため */

    /* --- 音量の序列 --------------------------------------------------------
       最初はレイヤごとの値だけで組んで実測したところ、弾倉の操作音や
       遮蔽への吸着音が自分のライフルより大きくなっていた。
       この game は発砲が情報の中心なので、序列は必ず

         発砲 ＞ 致命打 ＞ 遮蔽への衝突 ＞ 着弾 ＞ リロード ＞ 足音

       でなければならない。各音の中の作り込みを壊さずに全体を上下させるため、
       声の出口に一段トリムを噛ませる。値は A特性の実測から逆算したもの。 */
    var TRIM = {
      shot: 1.00,
      blind: 0.72,   /* 遮蔽越し。muffle と合わせて通常射撃より約 -8dB */
      slam: 1.00,
      vault: 0.68,
      cover: 1.10,
      reloadOut: 0.60,   /* 抜く音は中域が薄いので、同じトリムだと沈む */
      reloadIn: 0.33
    };

    /* =======================================================================
       1. 乱数
       ===================================================================== */

    /* バッファ生成用の決定的乱数。毎回同じ波形でないと、値を詰める作業が
       成立しない（前回と比べられない）。sky.js と同じ線形合同法。 */
    var seed = 1974113;
    function rnd() {
      seed = (seed * 1664525 + 1013904223) & 2147483647;
      return seed / 2147483647;
    }
    /* 実行時のばらつきはこちら。1発ごとに微妙に違わないと
       連射が「同じ音の等間隔コピー」に聞こえる（機関銃足音と同じ失敗）。 */
    function jit(a) { return 1 + (Math.random() * 2 - 1) * a; }
    function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

    /* =======================================================================
       2. バッファ生成
       ===================================================================== */

    /* --- 白色ノイズ --------------------------------------------------------
       2.0秒。1発ごとにランダムな位置から読み出すので、この長さがあれば
       「同じノイズの繰り返し」として知覚されない。トランジェント（破裂）と
       石の欠けに使う。高域が平坦であることが「鋭さ」の条件。 */
    function makeWhite(sr) {
      var n = Math.floor(sr * 2.0), b = ctx.createBuffer(1, n, sr), d = b.getChannelData(0), i;
      for (i = 0; i < n; i++) d[i] = (rnd() * 2 - 1) * 0.9;
      return b;
    }

    /* --- ピンクノイズ ------------------------------------------------------
       -3dB/oct。ボディ（口径の情報）と足音・衣擦れに使う。
       白色をバンドパスで削るより、最初からピンクを削るほうが
       「空気が押された塊」に聞こえる。低域が自然に残るため。
       係数は Paul Kellet の3段一次フィルタ近似。 */
    function makePink(sr) {
      var n = Math.floor(sr * 2.0), b = ctx.createBuffer(1, n, sr), d = b.getChannelData(0);
      var b0 = 0, b1 = 0, b2 = 0, w, i;
      for (i = 0; i < n; i++) {
        w = rnd() * 2 - 1;
        b0 = 0.99765 * b0 + w * 0.0990460;
        b1 = 0.96300 * b1 + w * 0.2965164;
        b2 = 0.57000 * b2 + w * 1.0526913;
        d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.22;
      }
      return b;
    }

    /* --- 1周期のサイン ----------------------------------------------------
       低域の「重さ」用。OscillatorNode でも作れるが、それだと音ごとに
       new が必要になる。1周期を loop 再生し playbackRate で音程を作れば、
       BufferSource 1個で任意の周波数とグライドが出せる。
       512サンプル：線形補間の誤差が可聴域に出ない最小の長さ。 */
    function makeSine(sr) {
      var b = ctx.createBuffer(1, SINE_LEN, sr), d = b.getChannelData(0), i;
      for (i = 0; i < SINE_LEN; i++) d[i] = Math.sin(i / SINE_LEN * Math.PI * 2);
      SINE_BASE = sr / SINE_LEN;   /* 再生速度1.0のときの周波数[Hz] */
      return b;
    }

    /* --- 広場のインパルス応答 ---------------------------------------------
       ここがこのファイルの主題。「屋外の石造の広場」と「室内」の差は3つある。

         (a) 最初の 15ms が完全な無音である。
             天井が無いので、近接反射（室内なら 3〜8ms に必ず立つ）が存在しない。
             最短の反射は一番近い石塊（約2.6m）からの往復 5.2m ＝ 15.2ms。
         (b) 早期反射が「疎」で、個々のファサードからの叩き返しとして数えられる。
             室内は10ms以内に反射密度が飽和して個々のタップが融ける。広場は融けない。
         (c) 後部残響が育たない。エネルギーの大半は上空へ抜けるので、
             拡散音場はタップのピークの 1/6 以下しか無い。
             さらに時間が経つほど遠くを回ってきた成分なので、空気吸収で暗くなる。

       この3つをそのまま合成する。反射面までの距離[m]を実寸で置き、
       t = 2d / 343 で時刻を決めるので、鳴らせばアリーナ（±13m）の広さが聞こえる。 */
    function makePlazaIR(sr) {
      var dur = 1.15;                 /* RT60 約1.1秒。石造の広場としては素直な値 */
      var n = Math.floor(sr * dur);
      var buf = ctx.createBuffer(2, n, sr);

      /* 反射面までの片道距離[m]。手前から：遮蔽の石塊 → 広場を囲む建物 →
         斜向かい → 通りの奥。ARENA は ±13m なので 13m と 18.4m(対角) が主役。 */
      var D = [2.6, 4.1, 6.0, 9.2, 11.6, 13.0, 16.4, 18.4, 22.0, 26.0, 31.0, 38.0, 46.0];

      var ch, d, i, k, t0, path, amp, len, e, x, lp, a, fc, jitter;
      for (ch = 0; ch < 2; ch++) {
        d = buf.getChannelData(ch);

        /* --- 早期反射（数えられるタップ列） ------------------------------- */
        for (k = 0; k < D.length; k++) {
          path = D[k] * 2.0;
          /* 左右で ±1.4ms ずらす。広場は左右対称ではないし、
             完全に同時に返ると「モノラルの1点」に潰れて広さが消える。 */
          jitter = (ch === 0 ? -1 : 1) * (0.0004 + rnd() * 0.0010);
          t0 = path / SOUND_MPS + jitter;
          i = Math.floor(t0 * sr);
          if (i < 0 || i >= n) continue;

          /* 振幅は 1/往復距離（球面拡散）。粗い石なので反射率は 0.55 前後、
             面ごとの向きの違いを ±25% の乱数で入れる。 */
          amp = (0.55 / path) * (0.75 + rnd() * 0.5);

          /* タップは点ではなく短いノイズの塊にする。実際のファサードは
             凹凸があるので、1枚の面からの返りでも 2〜6ms に時間拡散する。
             遠い面ほど大きく（広い面が返す）＝ 遠いほど滑らかに融ける。 */
          len = Math.floor(sr * (0.0022 + path * 0.00006));

          /* 空気吸収。往復距離が伸びるほど高域が消える。
             これが無いと「石の広場」ではなく「金属の箱」になる。 */
          fc = 11000 * Math.exp(-path / 60.0);
          a = 1 - Math.exp(-2 * Math.PI * fc / sr);
          lp = 0;
          for (x = 0; x < len && i + x < n; x++) {
            lp += a * ((rnd() * 2 - 1) - lp);
            e = Math.exp(-x / (len * 0.35));      /* 塊の中でも頭が立つ */
            d[i + x] += lp * amp * e;
          }
        }

        /* --- 拡散音場（薄い） ---------------------------------------------
           屋根が無い空間では、後部残響は「育たない」。エネルギーの大半が
           上空へ抜けるので、拡散音場は早期反射よりずっと下に留まる。

           振幅 0.0095 について。最初 0.085 と書いて「タップのピーク 0.5 の
           1/6」と説明していたが、これは誤りだった。IRを実際に取り出して
           1ms 包絡を測ったところ、90ms から始まる拡散部が
           早期反射より 4.5dB *大きく*、リバーブが後から膨らむ
           （屋内どころか逆再生リバーブに近い）形になっていた。
           原因は、タップ側の「サンプルのピーク値」と拡散側の「連続する
           RMS」を突き合わせてしまったこと、および両者に掛かる一次ローパスの
           分散低減率が違うこと。実測値から逆算して 0.0095 に改めた。
           これで拡散部の頭は最初のタップより約 15dB 下に入る。

           立ち上げも 90ms の段差ではなく 55ms から 45ms かけて滲ませる。
           実空間では拡散音場はタップの下から徐々に湧いてくるのであって、
           ある時刻に突然点灯したりしない。 */
        t0 = 0.055;
        i = Math.floor(t0 * sr);
        lp = 0;
        var hpS = 0;
        for (x = i; x < n; x++) {
          var tt = (x - i) / sr;
          /* 減衰。RT60 = 6.9/6.3 ≒ 1.10秒。 */
          e = Math.exp(-tt * 6.3);
          /* 早期反射の下から湧き上がらせる（45ms かけて開く）。 */
          if (tt < 0.045) e *= tt / 0.045;
          /* 時間が進むほど遠回りしてきた成分なので暗くなる。
             5.2kHz → 700Hz へ落とす一次ローパスを走らせる。 */
          fc = 700 + 4500 * Math.exp(-tt * 2.6);
          a = 1 - Math.exp(-2 * Math.PI * fc / sr);
          lp += a * ((rnd() * 2 - 1) - lp);
          /* 100Hz 以下は広場では返らない（地面と空へ逃げる）ので落とす。 */
          hpS += (1 - Math.exp(-2 * Math.PI * 100 / sr)) * (lp - hpS);
          d[x] += (lp - hpS) * 0.0095 * e;
        }
      }

      /* エネルギー正規化。convolver.normalize = false で使うので、
         ここで揃えないとサンプリングレート次第で残響量が変わる。
         ピークで正規化してはいけない（最初はそれで作って測って外した）。
         このIRは頭の1タップが尖っていて後は薄いので、ピークを 0.85 に
         合わせると全体が 30 倍近くに持ち上がり、畳み込みの出力が
         直接音より大きくなる＝「残響しか聞こえない銃声」になる。
         畳み込みの利得は総エネルギーの平方根で決まるので、そこを1に揃える。 */
      var e2 = 0;
      for (ch = 0; ch < 2; ch++) {
        d = buf.getChannelData(ch);
        for (i = 0; i < n; i++) e2 += d[i] * d[i];
      }
      e2 = e2 / 2;
      if (e2 > 1e-12) {
        var s = 1.0 / Math.sqrt(e2);
        for (ch = 0; ch < 2; ch++) {
          d = buf.getChannelData(ch);
          for (i = 0; i < n; i++) d[i] *= s;
        }
      }
      return buf;
    }

    /* =======================================================================
       3. グラフ構築
       ===================================================================== */

    function gain(v) { var g2 = ctx.createGain(); g2.gain.value = v; return g2; }
    function biq(type, f, q) {
      var b = ctx.createBiquadFilter();
      b.type = type; b.frequency.value = f; b.Q.value = (q === undefined ? 1 : q);
      return b;
    }

    function build() {
      var sr = ctx.sampleRate;

      NZW = makeWhite(sr);
      NZP = makePink(sr);
      SINE = makeSine(sr);
      SILENT = ctx.createBuffer(1, 1, sr);   /* iOS 解錠用の無音1サンプル */

      /* --- マスタ ---------------------------------------------------------
         リミッタを最後に置く理由：640rpm の連射に残響と着弾が重なると
         合成波形は簡単に 0dBFS を超える。携帯のスピーカでそれをやると
         「歪んで大きい」だけの音になり、口径の情報が全部潰れる。
         attack 3ms は破裂の立ち上がりを削らない範囲で最短、
         release 200ms は連射中に音圧が波打たない範囲で最短。 */
      limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -10;
      limiter.knee.value = 4;
      limiter.ratio.value = 9;
      limiter.attack.value = 0.003;
      limiter.release.value = 0.20;
      limiter.connect(ctx.destination);

      /* 被弾時のこもり。瀕死で 300Hz まで落ちる。
         Q を一緒に上げるのは、単に暗いのではなく「詰まって鳴っている」
         ＝鼓膜が張って共振している感じを出すため。 */
      dmgLP = biq('lowpass', 19000, 0.7);
      dmgLP.connect(limiter);

      master = gain(MASTER);
      master.connect(dmgLP);

      /* 致命打などで一瞬だけ「世界」を引かせるサイドチェイン用。
         直接音（dryBus）はここを通さない。致命打が自分自身を引いてしまうと
         いちばん立たせたい音が痩せる。引くのは環境＝残響とアンビエンスだけで、
         そのほうが「空間が一瞬抜けた」として強く聞こえる。 */
      duckG = gain(1.0);
      duckG.connect(master);

      dryBus = gain(1.0);
      dryBus.connect(master);

      /* --- 広場の畳み込み ------------------------------------------------
         送りの手前で帯域を切る。50m 先の壁から返る音に 8kHz は残らないし、
         100Hz 以下は屋外では返ってこない（囲いが無い）。
         この2つを削るだけで、同じIRでも「室内」臭が消える。 */
      wetIn = gain(1.0);
      wetHP = biq('highpass', 170, 0.7);
      wetLP = biq('lowpass', 3600, 0.7);
      convolver = ctx.createConvolver();
      convolver.normalize = false;          /* 量は自分で決める */
      convolver.buffer = makePlazaIR(sr);
      wetOut = gain(0.42);
      wetIn.connect(wetHP); wetHP.connect(wetLP);
      wetLP.connect(convolver); convolver.connect(wetOut); wetOut.connect(duckG);

      /* --- 遠いファサードのスラップ（フィードバックディレイ） -------------
         IR は 1.15 秒で切れるので、そこで消えるはずのない「向かいの建物
         からの繰り返し」をディレイで足す。26m 往復 = 0.1516 秒。
         帰ってくるたびに高域と低域を失う（空気吸収と回折）ので、
         ループの中に LP/HP を入れる。fb 0.30 で 3〜4回で消える。 */
      slapIn = gain(1.0);
      slapDelay = ctx.createDelay(0.5);
      slapDelay.delayTime.value = (26.0 * 2) / SOUND_MPS;
      slapLP = biq('lowpass', 2000, 0.7);
      slapHP = biq('highpass', 190, 0.7);
      slapFb = gain(0.30);
      slapOut = gain(0.34);
      slapIn.connect(slapDelay);
      slapDelay.connect(slapLP); slapLP.connect(slapHP);
      slapHP.connect(slapFb); slapFb.connect(slapDelay);   /* 帰還（Delay を含む合法な閉路） */
      slapHP.connect(slapOut); slapOut.connect(duckG);

      /* --- 自分の遮蔽の反射（ブラインドファイア用） -----------------------
         自分が張り付いている石塊まで約2.0m、往復 11.7ms。
         この短さで帰還させると 85Hz 間隔の櫛形になり、
         「箱の裏にいる」独特の色が付く。ブラインドファイアの主役。 */
      covIn = gain(1.0);
      covDelay = ctx.createDelay(0.2);
      covDelay.delayTime.value = (2.0 * 2) / SOUND_MPS;
      covLP = biq('lowpass', 850, 0.7);     /* 石は高域を返さない */
      covFb = gain(0.34);
      covOut = gain(0.70);
      covIn.connect(covDelay);
      covDelay.connect(covLP);
      covLP.connect(covFb); covFb.connect(covDelay);
      covLP.connect(covOut); covOut.connect(duckG);

      /* --- 耳鳴り ---------------------------------------------------------
         Oscillator は1回しか start できないので、ここで1本だけ作って
         永久に鳴らし、ゲインだけで出し入れする（毎回 new しないための唯一解）。
         4180Hz：音響外傷で最初に抜ける帯域であり、かつ耳の感度が最も高いので
         ごく小さな音量で確実に届く。発砲音の情報帯域（0.5〜3kHz）を
         マスクしない位置でもある。
         dmgLP の後ろに挿すのは、こもらせる対象は外界であって
         耳鳴りは頭の中で鳴っているから。 */
      tinG = gain(0.0);
      tinG.connect(limiter);
      tinOsc = ctx.createOscillator();
      tinOsc.type = 'sine';
      tinOsc.frequency.value = 4180;
      tinOsc.connect(tinG);
      try { tinOsc.start(0); } catch (e) { }

      /* --- アンビエンス ---------------------------------------------------
         ループ音源は start が1回きりなので、初回の ambience(true) で
         起動して以後はゲインで出し入れする。 */
      ambG = gain(0.0);
      ambG.connect(duckG);

      /* --- 声（固定チャンネルストリップ） --------------------------------- */
      strips = [];
      var i, j;
      for (i = 0; i < VOICES; i++) {
        var v = { br: [], start: -1e9, end: -1e9 };

        v.out = gain(1.0);

        /* 声ごとのトーン。ブラインドファイア（遮蔽越し）や
           遠い音の「抜けの悪さ」をここ1つで作る。 */
        v.tone = biq('lowpass', 19000, 0.7);
        v.out.connect(v.tone);

        /* 定位。HRTF を選んだ理由：equalpower は左右しか作れず、
           前後の区別が付かない。契約の「敵の方向が分かること」は
           背後から撃たれたことが分かることまで含むので、
           CPU を払ってでも HRTF でなければ要求を満たせない。
           10本という上限はこの負荷を許容できる範囲として決めた。 */
        v.pan = ctx.createPanner();
        try { v.pan.panningModel = 'HRTF'; } catch (e) { v.pan.panningModel = 'equalpower'; }
        v.pan.distanceModel = 'inverse';
        /* refDistance 1.2m：自分の銃・足音（0.4〜0.6m）はここでクリップされ
           常に等倍。rolloff 0.6：13m 先の敵で約 -16dB。実測の逆二乗より
           緩いが、広場の端の敵の発砲が「聞こえるが遠い」に収まる値。 */
        v.pan.refDistance = 1.2;
        v.pan.rolloffFactor = 0.6;
        v.pan.maxDistance = 80;
        v.tone.connect(v.pan);

        v.dry = gain(1.0);
        v.wet = gain(0.0);
        v.slap = gain(0.0);
        v.cov = gain(0.0);
        v.pan.connect(v.dry); v.dry.connect(dryBus);
        v.pan.connect(v.wet); v.wet.connect(wetIn);
        v.pan.connect(v.slap); v.slap.connect(slapIn);
        v.pan.connect(v.cov); v.cov.connect(covIn);

        for (j = 0; j < BRANCH; j++) {
          var b = {};
          b.f = biq('bandpass', 800, 1);
          b.g = gain(0.0);
          b.f.connect(b.g); b.g.connect(v.out);
          b.src = null;
          v.br.push(b);
        }
        strips.push(v);
      }

      applyListener(true);
    }

    function ensure() {
      if (ctx || dead) return ctx;
      try {
        ctx = new AC();
      } catch (e) { dead = true; ctx = null; return null; }
      try {
        build();
      } catch (e2) { dead = true; ctx = null; return null; }
      return ctx;
    }

    /* =======================================================================
       4. 発音の下回り
       ===================================================================== */

    /* 1レイヤ分の指示。毎回オブジェクトを作ると連射で GC が走るので、
       共有の1個を使い回す（値は lay() が読み終わるまでしか生きない）。 */
    var _o = {
      buf: null, del: 0, atk: 0.001, dec: 0.05, pk: 0.2,
      ft: 'bandpass', fa: 800, fb: 0, q: 1.0, hz: 0, hz2: 0, rate: 1
    };
    function L() {
      _o.buf = null; _o.del = 0; _o.atk = 0.001; _o.dec = 0.05; _o.pk = 0.2;
      _o.ft = 'bandpass'; _o.fa = 800; _o.fb = 0; _o.q = 1.0;
      _o.hz = 0; _o.hz2 = 0; _o.rate = 1;
      return _o;
    }

    function killSrc(b) {
      if (!b.src) return;
      try { b.src.stop(0); } catch (e) { }
      try { b.src.disconnect(); } catch (e2) { }
      b.src = null;
    }

    function killVoice(v) {
      var t = ctx.currentTime, i;
      for (i = 0; i < BRANCH; i++) {
        killSrc(v.br[i]);
        v.br[i].g.gain.cancelScheduledValues(t);
        v.br[i].g.gain.setValueAtTime(0, t);
      }
      v.end = t;
    }

    /* 空いている声を取る。無ければ最も古い声を奪う。
       ここが「同時発音数を超えて呼ばれても落ちない」の実体で、
       呼び出し回数がいくら増えてもノードは1つも増えない。 */
    function alloc(dur) {
      var t = ctx.currentTime, i, v, oldest = 0, oldT = Infinity;
      for (i = 0; i < VOICES; i++) {
        v = strips[i];
        if (v.end <= t) { oldest = i; oldT = -Infinity; break; }
        if (v.start < oldT) { oldT = v.start; oldest = i; }
      }
      v = strips[oldest];
      killVoice(v);
      v.start = t;
      v.end = t + dur;

      /* 声のパラメータを既定へ戻す。前の音の設定が残ると事故になる。 */
      v.out.gain.cancelScheduledValues(t); v.out.gain.setValueAtTime(1, t);
      v.tone.frequency.cancelScheduledValues(t); v.tone.frequency.setValueAtTime(19000, t);
      v.tone.Q.setValueAtTime(0.7, t);
      v.dry.gain.setValueAtTime(1, t);
      v.wet.gain.setValueAtTime(0, t);
      v.slap.gain.setValueAtTime(0, t);
      v.cov.gain.setValueAtTime(0, t);
      return v;
    }

    /* 1レイヤを鳴らす。BufferSource だけが使い捨てで、
       フィルタとゲインは声に常駐しているものを設定し直して使う。 */
    function lay(v, idx, o) {
      if (idx >= BRANCH) return;
      var b = v.br[idx];
      /* 振幅が実質ゼロなら何もしない。0 を指数ランプの端点にすると
         WebAudio は RangeError を投げる。 */
      if (!(o.pk > 0.0002)) return;

      var t0 = ctx.currentTime + 0.004 + o.del;   /* 4ms の余裕：ブロック境界で頭を削らせない */
      var atk = o.atk > 0.0002 ? o.atk : 0.0002;
      var dec = o.dec > 0.002 ? o.dec : 0.002;
      var tEnd = t0 + atk + dec;

      var tonal = o.hz > 0;
      var buf = o.buf || (tonal ? SINE : NZW);

      /* --- フィルタ ---------------------------------------------------- */
      var ft = o.ft, fa = o.fa;
      if (tonal && ft === 'bandpass' && o.fa === 800) {
        /* 音程レイヤの既定：補間の折り返しだけ落とす軽いローパス。 */
        ft = 'lowpass'; fa = Math.max(o.hz, o.hz2) * 3.2 + 120;
      }
      b.f.type = ft;
      b.f.frequency.cancelScheduledValues(t0);
      b.f.frequency.setValueAtTime(clamp(fa, 20, 18000), t0);
      if (o.fb > 0) b.f.frequency.exponentialRampToValueAtTime(clamp(o.fb, 20, 18000), tEnd);
      b.f.Q.cancelScheduledValues(t0);
      b.f.Q.setValueAtTime(o.q, t0);

      /* --- エンベロープ -------------------------------------------------
         立ち上がりは直線（破裂は「段差」に聞こえないといけない）、
         減衰は指数（自然界の減衰は指数で、直線だと切れたように聞こえる）。 */
      var gp = b.g.gain;
      gp.cancelScheduledValues(t0);
      gp.setValueAtTime(0, t0);
      gp.linearRampToValueAtTime(o.pk, t0 + atk);
      gp.exponentialRampToValueAtTime(o.pk * 0.0008, tEnd);
      gp.setValueAtTime(0, tEnd + 0.001);

      /* --- 音源（唯一の使い捨て） ---------------------------------------- */
      var s;
      try { s = ctx.createBufferSource(); } catch (e) { return; }
      s.buffer = buf;
      var r0, r1;
      if (tonal) {
        s.loop = true;
        r0 = o.hz / SINE_BASE;
        r1 = (o.hz2 > 0 ? o.hz2 : o.hz) / SINE_BASE;
      } else {
        r0 = o.rate; r1 = o.rate;
      }
      s.playbackRate.setValueAtTime(r0, t0);
      if (Math.abs(r1 - r0) > 1e-4) s.playbackRate.exponentialRampToValueAtTime(r1, tEnd);

      killSrc(b);
      s.connect(b.f);
      /* ノイズは毎回違う位置から読む。同じ場所から読むと
         同じ「ざっ」が繰り返され、合成音だとすぐ露見する。 */
      var off = tonal ? 0 : Math.random() * Math.max(buf.duration - (atk + dec) - 0.05, 0.01);
      try { s.start(t0, off); } catch (e2) { try { s.start(t0); } catch (e3) { return; } }
      try { s.stop(tEnd + 0.03); } catch (e4) { }
      b.src = s;

      if (tEnd + 0.05 > v.end) v.end = tEnd + 0.05;
    }

    /* 声全体のトリム。音の中身ではなく序列だけを動かす。 */
    function trim(v, k) {
      v.out.gain.setValueAtTime(k, ctx.currentTime);
    }

    /* 送り量の設定。近い音は乾き、遠い音は濡れる＝距離の情報になる。 */
    function send(v, wet, slap, cov) {
      var t = ctx.currentTime;
      v.wet.gain.setValueAtTime(wet, t);
      v.slap.gain.setValueAtTime(slap, t);
      v.cov.gain.setValueAtTime(cov || 0, t);
    }

    /* 体基準のローカル座標をワールドへ。listener の向きは game.js の
       yawDirX/yawDirZ と同じ規約（yaw=0 で -Z を向く）。 */
    function place(v, lx, ly, lz) {
      var x = lis.x + lis.rx * lx + lis.fx * lz;
      var y = lis.y + ly;
      var z = lis.z + lis.rz * lx + lis.fz * lz;
      placeWorld(v, x, y, z);
    }

    /* --- 距離を圧縮して置く -------------------------------------------------
       方向はそのまま、受聴者からの距離だけを [lo, hi] に押し込む。

       なぜこれが要るか。命中音を実距離に置くと、13m 先の敵に当てた瞬間の音は
       距離減衰だけで -13dB 沈む。実測でも、致命打が自分の足音より小さいという
       転倒した序列になった。だが「当たった」は物理現象である前に判定の通知で、
       遠いから聞こえなくてよい情報ではない。ここは物理を曲げる。

       曲げてよい理由：方向（＝どこに敵が居るか）は距離を変えても保たれるので、
       §2 柱5 が要求している情報は一切失われない。失うのは「遠さ」だけで、
       それは外れ（'world'）の側が正しく担っている。 */
    function placeNear(v, x, y, z, lo, hi) {
      var dx = x - lis.x, dy = y - lis.y, dz = z - lis.z;
      var d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d < 1e-4) { placeWorld(v, lis.x + lis.fx, lis.y, lis.z + lis.fz); return; }
      var k = clamp(d, lo, hi) / d;
      placeWorld(v, lis.x + dx * k, lis.y + dy * k, lis.z + dz * k);
    }
    function placeWorld(v, x, y, z) {
      var p = v.pan, t = ctx.currentTime;
      if (p.positionX) {
        p.positionX.setValueAtTime(x, t);
        p.positionY.setValueAtTime(y, t);
        p.positionZ.setValueAtTime(z, t);
      } else if (p.setPosition) {
        p.setPosition(x, y, z);
      }
    }

    function applyListener(instant) {
      if (!ctx) return;
      var l = ctx.listener, t = ctx.currentTime;
      var tau = instant ? 0.001 : 0.02;   /* 20ms で追従：ジッパーノイズを出さず、遅れも感じない */
      if (l.positionX) {
        l.positionX.setTargetAtTime(lis.x, t, tau);
        l.positionY.setTargetAtTime(lis.y, t, tau);
        l.positionZ.setTargetAtTime(lis.z, t, tau);
        l.forwardX.setTargetAtTime(lis.fx, t, tau);
        l.forwardY.setTargetAtTime(0, t, tau);
        l.forwardZ.setTargetAtTime(lis.fz, t, tau);
        l.upX.setValueAtTime(0, t);
        l.upY.setValueAtTime(1, t);
        l.upZ.setValueAtTime(0, t);
      } else if (l.setPosition) {
        l.setPosition(lis.x, lis.y, lis.z);
        l.setOrientation(lis.fx, 0, lis.fz, 0, 1, 0);
      }
    }

    /* 一瞬だけ world を引かせる。致命打を「大きい音」ではなく
       「世界が怯んだ出来事」にするために使う。 */
    function duck(amount, rel) {
      var t = ctx.currentTime;
      duckG.gain.cancelScheduledValues(t);
      duckG.gain.setValueAtTime(duckG.gain.value, t);
      duckG.gain.linearRampToValueAtTime(1 - amount, t + 0.012);
      duckG.gain.setTargetAtTime(1, t + 0.014, rel / 3);
    }

    function panic() {
      if (!ctx || !strips) return;
      var i;
      for (i = 0; i < VOICES; i++) killVoice(strips[i]);
    }

    /* =======================================================================
       5. 個々の音
       ===================================================================== */

    /* --- 発砲 --------------------------------------------------------------
       契約 §3「音の層」：トランジェント／ボディ／テールの3層。

       [1] トランジェント（破裂の情報）
           高域だけの 6ms のノイズバースト。立ち上がり 0.4ms は
           耳の時間分解能（約1ms）より短く、これを下回ると耳は
           「瞬間的な段差」＝破裂として読む。減衰 6ms は
           10ms を超えると「クリック」ではなく「シャッ」という別の音に化ける限界。
           ハイパスを 4.2kHz から 2.2kHz へ落としながら鳴らすのは、
           衝撃波が広がるにつれ実際にスペクトル重心が下がるため。
           2.2kHz より下へは行かせない。そこから下はボディの領分で、
           重ねると立ち上がりが濁って「破裂」が消える。

       [2] ボディ（口径の情報）
           帯域を絞ったノイズ 640Hz(Q1.1) ＋ 低域サイン 82→54Hz。
           640Hz を中心にしたのは、ライフル弾クラスの銃身・薬室の鳴りが
           400〜900Hz の塊として出るからで、聴き手はこの塊の中心の高さで
           「口径」を判断する。Q1.1 は塊のまま（Q を上げると笛になる）。
           サインを 82→54Hz へ滑らせる理由：携帯のスピーカは 82Hz を
           そのままでは再生できないが、下降するピッチのジェスチャは
           倍音から再構成されて「重さ」として届く。落ちること自体が情報。

       [3] テール（広場の反射）
           合成インパルス応答による畳み込み（15ms の無音 → 数えられる
           タップ列 → 薄い拡散）と、26m 往復のフィードバックディレイ。
           送りの手前で 170Hz〜3.6kHz に切ってあるので、返ってくる音は
           必ず「遠い・暗い・囲われていない」。屋内リバーブの密度は出ない。

       残弾：rounds が減るほど 640→880Hz へ上がり Q が 1.1→2.4 へ立ち、
       2.1kHz の高Qの鳴り（薬室の金属鳴り）が加わる。
       弾が減るほど音が「痩せて金属的」になる＝数字を見ずに残弾が分かる。 */
    function shot(kind) {
      if (!ensure()) return;
      var blind = (kind === 'blind');

      if (rounds > 0) rounds--;
      /* 0 に近いほど 1 に近づく。0.42 から効き始めるのは、
         30発中12発を切ったあたりから「そろそろ」を伝えたいため。 */
      var low = clamp(1 - (rounds / magSize) / 0.42, 0, 1);

      var v = alloc(0.42);
      var r = jit(0.05);
      var o;

      /* 位置：右肩の少し前。自分の銃なので距離はほぼゼロだが、
         左右に寄せておくと体の向きが変わったときに定位が動き、
         「自分が持っている物」として頭の外に出ない。 */
      if (blind) place(v, 0.02, 0.32, 0.55);   /* 遮蔽の天端の上に銃口だけ出す */
      else place(v, 0.26, -0.06, 0.46);

      if (blind) {
        /* 遮蔽越し。銃口は石塊の上にあるが、耳は石塊の裏にある。
           経路が回折になるので高域が丸ごと落ちる。1.5kHz で切る。 */
        v.tone.frequency.setValueAtTime(1500, ctx.currentTime);
        v.tone.Q.setValueAtTime(0.7, ctx.currentTime);
        /* 実測ではブラインドのほうが通常射撃より A特性で 6dB 大きかった。
           銃口が耳から遠く、間に石塊がある音が、正面で構えて撃つ音より
           大きいのは物理的に嘘なので、muffle と合わせて確実に下へ振る。 */
        trim(v, TRIM.blind);
      }

      /* [1] トランジェント */
      o = L();
      o.buf = NZW; o.ft = 'highpass';
      o.fa = (blind ? 1500 : 4200) * r; o.fb = (blind ? 900 : 2200) * r;
      o.q = 0.9; o.atk = 0.0004; o.dec = 0.0062;
      o.pk = blind ? 0.20 : 0.80;
      lay(v, 0, o);

      /* [2a] ボディ：帯域ノイズ */
      o = L();
      o.buf = NZP; o.ft = 'bandpass';
      o.fa = (blind ? 520 : (640 + 240 * low)) * r;
      o.fb = (blind ? 360 : (430 + 150 * low)) * r;
      o.q = 1.1 + 1.3 * low;
      o.atk = 0.0010; o.dec = 0.085;
      /* 0.50 → 0.78。A特性で測ると、この銃声で最大の成分である 82→54Hz の
         サインはほとんど寄与していなかった。携帯のスピーカは 100Hz 以下を
         物理的に再生できないので、これは測定上の話ではなく実機での話で、
         「口径」を伝える仕事は実際にはこの 640Hz の帯域が全部背負っている。
         低域は据え置き（ヘッドホン／振動として効くので消しはしない）。 */
      o.pk = 0.78;
      lay(v, 1, o);

      /* [2b] ボディ：低域サイン。
         ブラインドは「低域だけが回り込む」ので通常射撃に対する“比率”は上がるが、
         絶対値まで上げてはいけない。最初 0.70 で書いて実測したところ
         ブラインドのほうが A特性で 6dB 大きくなっていた。銃口が耳から遠く、
         間に石塊がある音が、正面で撃つ音より大きいのは物理的に嘘なので
         0.46 まで下げた（v.out の 0.58 と合わせて通常射撃より確実に小さい）。 */
      o = L();
      o.hz = 82 * r; o.hz2 = 54 * r;
      o.atk = 0.002; o.dec = 0.145;
      o.pk = blind ? 0.46 : 0.55;
      lay(v, 2, o);

      /* [残弾] 薬室の鳴り。高Qの狭帯域＝金属的な「ちん」。
         満タンでは 0.05 でほぼ聞こえず、残り数発で 0.33 まで立つ。 */
      o = L();
      o.buf = NZP; o.ft = 'bandpass';
      o.fa = 2100 * r; o.q = 7.5;
      o.atk = 0.0015; o.dec = 0.055 + 0.05 * low;
      o.pk = (0.05 + 0.28 * low) * (blind ? 0.4 : 1);
      lay(v, 3, o);

      /* [3] テール */
      if (blind) send(v, 0.16, 0.12, 0.55);   /* 広場は遮蔽に隠れ、自分の壁だけが返る */
      else send(v, 0.42, 0.34, 0.02);
    }

    /* --- 敵の発砲（位置指定）--------------------------------------------------
       契約の必須APIではないが、§2 柱5「敵の位置が音で分かる」の主役は
       敵の発砲音なので用意しておく。統合側から座標を渡せる。 */
    function enemyShot(x, y, z) {
      if (!ensure()) return;
      var v = alloc(0.5), r = jit(0.06), o;
      placeWorld(v, x, (y === undefined ? 1.3 : y), z);
      /* 距離が離れるほど高域が減る。10m 先で 6kHz、25m 先で 2.6kHz 程度。 */
      var dx = x - lis.x, dz = z - lis.z, d = Math.sqrt(dx * dx + dz * dz) + 0.5;
      v.tone.frequency.setValueAtTime(clamp(16000 * Math.exp(-d / 14), 900, 18000), ctx.currentTime);

      o = L(); o.buf = NZW; o.ft = 'highpass'; o.fa = 3800 * r; o.fb = 2000 * r;
      o.q = 0.9; o.atk = 0.0004; o.dec = 0.0070; o.pk = 0.58; lay(v, 0, o);

      o = L(); o.buf = NZP; o.ft = 'bandpass'; o.fa = 700 * r; o.fb = 420 * r;
      o.q = 1.2; o.atk = 0.001; o.dec = 0.095; o.pk = 0.46; lay(v, 1, o);

      o = L(); o.hz = 76 * r; o.hz2 = 50 * r; o.atk = 0.002; o.dec = 0.16; o.pk = 0.42;
      lay(v, 2, o);

      /* 遠いほどテールの比率が上がる。これが距離の主要な手掛かり。 */
      var w = clamp(0.30 + d * 0.035, 0.3, 0.9);
      send(v, w, w * 0.8, 0);
    }

    /* --- 着弾 --------------------------------------------------------------
       3種を「音量」で分けない。音量差は環境音や距離で簡単に崩れるので、
       画面を見ずに判別する条件にならない。分けるのは次の3軸：

         world : 明るい / 短い   重心 約3kHz、170ms、低域なし、広場がよく返る
         enemy : 暗い   / 中     重心 約400Hz、260ms、低域あり、ほとんど返らない
         head  : 暗い   / 長い   ＋ 他の2つに無い 360Hz(Q9) の余韻と、
                                  85ms 遅れて来る第2の低域＝「時間構造」が違う

       とくに world の「低域が無い」と enemy の「高域が無い」は排他なので、
       片方を聞けばもう片方でないことが確定する。これが最短の判別になる。
       残響量も逆向き（外れ＝広場が鳴る／命中＝肉が吸って鳴らない）で、
       二重に冗長化してある。 */
    function impact(kind, x, y, z) {
      if (!ensure()) return;
      var v, o, r = jit(0.09);
      var world = (x !== undefined && x !== null);

      if (kind === 'enemy' || kind === 'head') {
        var head = (kind === 'head');
        v = alloc(head ? 0.60 : 0.36);
        /* 命中の通知は距離で沈めない（placeNear のコメント参照）。 */
        if (world) placeNear(v, x, y, z, 2.6, 2.6); else place(v, 0, 0, 2.6);

        /* 頭部だけが持つ鋭い破壊音。enemy には意図的に入れない。 */
        o = L(); o.buf = NZW; o.ft = 'highpass';
        o.fa = (head ? 5200 : 900) * r; o.fb = (head ? 3000 : 520) * r;
        o.q = 0.8; o.atk = 0.0005; o.dec = head ? 0.0060 : 0.030;
        o.pk = head ? 0.72 : 0.92;
        lay(v, 0, o);

        /* 湿った塊。ピンクノイズを低めに絞る＝「石」ではなく「詰まった物」。 */
        o = L(); o.buf = NZP; o.ft = 'bandpass';
        o.fa = (head ? 780 : 250) * r; o.fb = (head ? 340 : 170) * r;
        o.q = head ? 0.9 : 1.2;
        o.atk = 0.002; o.dec = head ? 0.20 : 0.10;
        o.pk = head ? 0.65 : 1.54;
        lay(v, 1, o);

        /* 質量。当たった側の体が持っていかれる分の低域。 */
        o = L();
        o.hz = (head ? 96 : 118) * r; o.hz2 = (head ? 48 : 74) * r;
        o.atk = 0.003; o.dec = head ? 0.30 : 0.13;
        o.pk = head ? 0.80 : 1.28;
        lay(v, 2, o);

        if (head) {
          /* 致命打の署名。Q9 の狭帯域は「音程のある余韻」になり、
             他のどの音にも無いので、混戦の中でも一つだけ抜けて聞こえる。 */
          o = L(); o.buf = NZP; o.ft = 'bandpass';
          o.fa = 360 * r; o.q = 9.0;
          o.atk = 0.003; o.dec = 0.34; o.pk = 0.39;
          lay(v, 3, o);

          /* 85ms 遅れて来る第2の低域。「大きい着弾」ではなく
             「2つの出来事」になるので、格が違うと聞こえる。 */
          o = L();
          o.hz = 62 * r; o.hz2 = 40 * r;
          o.del = 0.085; o.atk = 0.006; o.dec = 0.35; o.pk = 0.44;
          /* 声を1本余計に取らず、空きブランチが無ければ諦める設計にはせず、
             ここは別の声に載せる（4ブランチを使い切っているため）。 */
          var v2 = alloc(0.55);
          if (world) placeNear(v2, x, y, z, 2.6, 2.6); else place(v2, 0, 0, 2.6);
          lay(v2, 0, o);
          send(v2, 0.20, 0.14, 0);

          duck(0.30, 0.22);
        } else {
          o = L(); o.buf = NZP; o.ft = 'lowpass';
          o.fa = 1800 * r; o.q = 0.8;
          o.atk = 0.001; o.dec = 0.055; o.pk = 0.67;
          lay(v, 3, o);
        }

        /* 肉は広場を鳴らさない。この「乾き」が命中の第3の手掛かり。 */
        send(v, head ? 0.24 : 0.12, head ? 0.18 : 0.06, 0);
        return;
      }

      /* world：外れ。乾いた石の欠け。低域が一切無いことが情報。 */
      v = alloc(0.30);
      /* 外れは「どこへ逸れたか」が情報なので距離を残す。
         ただし遠すぎて消えると「撃った結果が分からない」になるため下限を置く。 */
      if (world) placeNear(v, x, y, z, 5.5, 34.0); else place(v, 0, 0, 5.5);

      /* レベルについて：最初 0.42/0.34/0.16 で書いて実測したところ、
         'world' が 'enemy' より A特性で 20dB 小さかった。原因は2つある。
           ・高域だけの音は同じピーク値でも音響エネルギーが桁違いに小さい
           ・Q の高いバンドパスは広帯域ノイズをほとんど通さない
         「外した」は最も頻度が高く、かつ最も早く伝わらなければならない情報
         （撃ち続けるか位置を変えるかの判断がこれ1つで決まる）なので、
         下の値まで持ち上げ、'chip' の Q も 1.6 → 0.9 に開いて通りを良くした。 */
      o = L(); o.buf = NZW; o.ft = 'highpass';
      o.fa = 3800 * r; o.fb = 2600 * r;
      o.q = 0.8; o.atk = 0.0004; o.dec = 0.0045; o.pk = 1.09;
      lay(v, 0, o);

      /* 欠けた破片。1.9k→1.2kHz へ落ちる短い帯域＝「かつん」。 */
      o = L(); o.buf = NZW; o.ft = 'bandpass';
      o.fa = 1900 * r; o.fb = 1200 * r; o.q = 0.9;
      o.atk = 0.0010; o.dec = 0.042; o.pk = 1.01;
      lay(v, 1, o);

      /* 砕けた粉が落ちる余韻。これがあると「石」になる。 */
      o = L(); o.buf = NZP; o.ft = 'bandpass';
      o.fa = 620 * r; o.q = 0.9;
      o.atk = 0.002; o.dec = 0.075; o.pk = 0.48;
      lay(v, 2, o);

      /* 3番目のブランチは意図的に空。低域を足さないことが「外れ」の定義。 */

      send(v, 0.30, 0.22, 0);
    }

    /* --- リロード ----------------------------------------------------------
       game.js の CFG.fire.reload は 1.60 秒。'out'（弾倉を抜く）と
       'in'（挿す）の2回しか呼ばれないので、それぞれの内部で
       複数のレイヤを時間差で置き、動作の連なりとして聞かせる。
       この音は自分の体の音なので、送りをほぼ切って乾かす。
       乾いていること自体が「これは自分の音、外界の音ではない」の合図になる。 */
    function reload(stage) {
      if (!ensure()) return;
      var o, r = jit(0.04);

      if (stage === 'in') {
        rounds = magSize;    /* 残弾表現の基準を戻す */

        /* 1) 弾倉を差し込んで座らせる */
        var v = alloc(0.40);
        place(v, 0.22, -0.28, 0.34);
        trim(v, TRIM.reloadIn);

        o = L(); o.buf = NZP; o.ft = 'bandpass';
        o.fa = 950 * r; o.fb = 620 * r; o.q = 1.2;
        o.atk = 0.004; o.dec = 0.050; o.pk = 0.14;
        lay(v, 0, o);

        /* 60ms 後に「かちん」。金属が金属に着座する瞬間。
           トランジェント 4.5ms ＋ 340Hz(Q3) の短い共振。 */
        o = L(); o.buf = NZW; o.ft = 'highpass';
        o.fa = 4200 * r; o.q = 0.8; o.del = 0.060;
        o.atk = 0.0004; o.dec = 0.0045; o.pk = 0.34;
        lay(v, 1, o);

        o = L(); o.buf = NZP; o.ft = 'bandpass';
        o.fa = 340 * r; o.q = 3.0; o.del = 0.060;
        o.atk = 0.001; o.dec = 0.075; o.pk = 0.30;
        lay(v, 2, o);

        o = L(); o.hz = 132 * r; o.hz2 = 96 * r; o.del = 0.062;
        o.atk = 0.002; o.dec = 0.075; o.pk = 0.26;
        lay(v, 3, o);

        send(v, 0.10, 0.06, 0.18);

        /* 2) 195ms 後に遊底を戻す。ここが「撃てる」の合図なので、
           必ず着座音より後に、2つのクリックとして聞こえるように置く。
           プレイヤーは2つ目を数えて指を戻す。 */
        var v2 = alloc(0.35);
        place(v2, 0.24, -0.20, 0.40);
        trim(v2, TRIM.reloadIn);

        o = L(); o.buf = NZW; o.ft = 'highpass'; o.fa = 5200 * r; o.q = 0.8;
        o.del = 0.195; o.atk = 0.0003; o.dec = 0.0035; o.pk = 0.30;
        lay(v2, 0, o);

        o = L(); o.buf = NZP; o.ft = 'bandpass'; o.fa = 2350 * r; o.q = 9.0;
        o.del = 0.197; o.atk = 0.001; o.dec = 0.075; o.pk = 0.16;
        lay(v2, 1, o);

        o = L(); o.buf = NZW; o.ft = 'highpass'; o.fa = 4400 * r; o.q = 0.8;
        o.del = 0.209; o.atk = 0.0003; o.dec = 0.0030; o.pk = 0.22;
        lay(v2, 2, o);

        o = L(); o.buf = NZP; o.ft = 'bandpass'; o.fa = 700 * r; o.q = 2.0;
        o.del = 0.211; o.atk = 0.001; o.dec = 0.045; o.pk = 0.16;
        lay(v2, 3, o);

        send(v2, 0.10, 0.06, 0.18);
        return;
      }

      /* 'out'：弾倉を抜く。掛け金を外す小さなクリック → 抜ける摺動 →
         空の弾倉が装備に当たる鈍い音。'in' より軽く、低域を持たせない。
         この軽さが「まだ撃てない」の合図で、'in' の重さと対になる。 */
      var vo = alloc(0.34);
      place(vo, 0.20, -0.30, 0.32);
      trim(vo, TRIM.reloadOut);

      o = L(); o.buf = NZW; o.ft = 'highpass'; o.fa = 3600 * r; o.q = 0.8;
      o.atk = 0.0003; o.dec = 0.0040; o.pk = 0.30;
      lay(vo, 0, o);

      o = L(); o.buf = NZP; o.ft = 'bandpass'; o.fa = 2400 * r; o.q = 6.0;
      o.del = 0.004; o.atk = 0.001; o.dec = 0.050; o.pk = 0.11;
      lay(vo, 1, o);

      o = L(); o.buf = NZP; o.ft = 'bandpass';
      o.fa = 1400 * r; o.fb = 760 * r; o.q = 1.0;
      o.del = 0.045; o.atk = 0.004; o.dec = 0.085; o.pk = 0.17;
      lay(vo, 2, o);

      o = L(); o.hz = 145 * r; o.hz2 = 105 * r;
      o.del = 0.135; o.atk = 0.002; o.dec = 0.060; o.pk = 0.13;
      lay(vo, 3, o);

      send(vo, 0.10, 0.06, 0.18);
    }

    /* --- 乗り越え ----------------------------------------------------------
       game.js CFG.vault.time = 0.58 秒。踏み切り（衣擦れ）→ 手を石に付く →
       着地。着地を +0.44 秒に置くのは、game.js の軌道で s=0.10〜0.92 が
       滞空なので、体が落ち切る直前に音が来ると足より先に音が着いて
       「浮いている」ように聞こえるため。 */
    function vault() {
      if (!ensure()) return;
      var o, r = jit(0.05);

      var v = alloc(0.40);
      place(v, 0, -0.35, 0.40);
      trim(v, TRIM.vault);

      /* 装備と衣の擦れ。立ち上がりを 20ms と鈍くするのが要点で、
         ここが速いと布ではなく紙になる。 */
      o = L(); o.buf = NZP; o.ft = 'bandpass';
      o.fa = 1500 * r; o.fb = 900 * r; o.q = 0.8;
      o.atk = 0.020; o.dec = 0.120; o.pk = 0.09;
      lay(v, 0, o);

      /* 掌が石を叩く。 */
      o = L(); o.buf = NZW; o.ft = 'highpass'; o.fa = 2600 * r; o.q = 0.8;
      o.del = 0.085; o.atk = 0.0005; o.dec = 0.0060; o.pk = 0.20;
      lay(v, 1, o);

      o = L(); o.buf = NZP; o.ft = 'bandpass'; o.fa = 330 * r; o.q = 1.8;
      o.del = 0.087; o.atk = 0.001; o.dec = 0.055; o.pk = 0.22;
      lay(v, 2, o);

      o = L(); o.hz = 140 * r; o.hz2 = 95 * r;
      o.del = 0.088; o.atk = 0.002; o.dec = 0.070; o.pk = 0.16;
      lay(v, 3, o);

      send(v, 0.22, 0.14, 0.10);

      /* 着地。ここだけ低域を持たせて「体重が落ちた」ことを伝える。 */
      var v2 = alloc(0.62);
      place(v2, 0, -1.35, 0.20);
      trim(v2, TRIM.vault);

      o = L(); o.buf = NZW; o.ft = 'highpass'; o.fa = 2200 * r; o.q = 0.8;
      o.del = 0.440; o.atk = 0.0005; o.dec = 0.0050; o.pk = 0.22;
      lay(v2, 0, o);

      o = L(); o.buf = NZP; o.ft = 'bandpass'; o.fa = 380 * r; o.fb = 260 * r; o.q = 1.1;
      o.del = 0.440; o.atk = 0.001; o.dec = 0.075; o.pk = 0.28;
      lay(v2, 1, o);

      o = L(); o.hz = 105 * r; o.hz2 = 68 * r;
      o.del = 0.442; o.atk = 0.003; o.dec = 0.120; o.pk = 0.30;
      lay(v2, 2, o);

      /* 砂利が散る。屋外の石畳であることを最後に一押しする。 */
      o = L(); o.buf = NZW; o.ft = 'highpass'; o.fa = 3800 * r; o.q = 0.7;
      o.del = 0.446; o.atk = 0.004; o.dec = 0.100; o.pk = 0.10;
      lay(v2, 3, o);

      send(v2, 0.30, 0.20, 0);
    }

    /* --- ダッシュで遮蔽に叩き付く ------------------------------------------
       このゲームで最も物理的な出来事。3種の遮蔽動作（slam / coverIn / vault）
       の中で唯一、サブ帯域まで持たせる。高域を意図的に鈍らせている（1.8kHz）
       のは、石を「欠く」のではなく体が「潰れて当たる」からで、
       着弾の 'world' と取り違えないための差でもある。 */
    function slam() {
      if (!ensure()) return;
      var o, r = jit(0.05);
      var v = alloc(0.55);
      place(v, 0, -0.55, 0.42);
      trim(v, TRIM.slam);

      o = L(); o.buf = NZW; o.ft = 'highpass'; o.fa = 1800 * r; o.fb = 1100 * r; o.q = 0.8;
      o.atk = 0.0008; o.dec = 0.0070; o.pk = 0.30;
      lay(v, 0, o);

      o = L(); o.buf = NZP; o.ft = 'bandpass'; o.fa = 200 * r; o.fb = 140 * r; o.q = 1.0;
      o.atk = 0.003; o.dec = 0.160; o.pk = 0.55;
      lay(v, 1, o);

      o = L(); o.hz = 92 * r; o.hz2 = 56 * r;
      o.atk = 0.004; o.dec = 0.200; o.pk = 0.62;
      lay(v, 2, o);

      /* 装備の跳ね返り。35ms 遅れて、減衰を長く。金属が揺れて止まるまで。 */
      o = L(); o.buf = NZP; o.ft = 'bandpass'; o.fa = 2600 * r; o.q = 3.5;
      o.del = 0.035; o.atk = 0.010; o.dec = 0.180; o.pk = 0.13;
      lay(v, 3, o);

      /* 張り付いた直後なので、以後の自分の音は自分の壁が返す。
         その状態を最初に一発だけ強く提示しておく。 */
      send(v, 0.34, 0.26, 0.30);
      duck(0.12, 0.18);
    }

    /* --- 遮蔽に入る（吸着） ------------------------------------------------
       CFG.cover.snapTime = 0.165 秒。slam と混同されないよう、
       低域を持たせず 200ms 以内で終わらせる。「そっと付いた」音。 */
    function coverIn() {
      if (!ensure()) return;
      var o, r = jit(0.05);
      var v = alloc(0.30);
      place(v, 0, -0.45, 0.40);
      trim(v, TRIM.cover);

      o = L(); o.buf = NZP; o.ft = 'bandpass'; o.fa = 1200 * r; o.fb = 700 * r; o.q = 0.8;
      o.atk = 0.012; o.dec = 0.100; o.pk = 0.13;
      lay(v, 0, o);

      o = L(); o.buf = NZP; o.ft = 'bandpass'; o.fa = 420 * r; o.q = 2.0;
      o.del = 0.030; o.atk = 0.001; o.dec = 0.050; o.pk = 0.16;
      lay(v, 1, o);

      o = L(); o.hz = 120 * r; o.hz2 = 82 * r;
      o.del = 0.032; o.atk = 0.002; o.dec = 0.080; o.pk = 0.14;
      lay(v, 2, o);

      o = L(); o.buf = NZW; o.ft = 'highpass'; o.fa = 3200 * r; o.q = 0.7;
      o.del = 0.060; o.atk = 0.0005; o.dec = 0.0060; o.pk = 0.09;
      lay(v, 3, o);

      send(v, 0.16, 0.10, 0.34);
    }

    /* --- 足音 --------------------------------------------------------------
       speed は m/s。game.js の歩き 3.05 / ダッシュ 6.30 を基準に正規化する。
       速いほど（1）音量が上がり（2）踵が硬くなり（3）砂利の擦れが増え
       （4）体重の低域が乗る。この4つが同時に動くので、
       画面を見なくても「歩いている／走っている」が分かる。
       左右交互に ±0.16m ずらすのは、同じ位置で鳴り続けると
       「足」ではなく「ループ再生」に聞こえるため。 */
    function step(speed) {
      if (!ensure()) return;
      var sp = clamp((speed || 0) / SPRINT, 0, 1);
      /* 0.11+0.26sp では、実測で走りの足音が致命打より大きかった。
         足音は状況の背景であって通知ではない。下げつつ、歩きと走りの差は
         5dB 以上残す（歩いているか走っているかは音だけで分かる必要がある）。 */
      var lvl = 0.02 + 0.135 * sp;
      var r = jit(0.08);
      var o;

      var v = alloc(0.28);
      stepSide = -stepSide;
      place(v, 0.16 * stepSide, -1.45, 0.10);

      /* 踵。速いほど短く硬く。 */
      o = L(); o.buf = NZW; o.ft = 'highpass'; o.fa = 1900 * r; o.q = 0.8;
      o.atk = 0.0004; o.dec = 0.0035 + 0.0025 * (1 - sp); o.pk = 0.62 * lvl;
      lay(v, 0, o);

      /* 靴底が石を押す本体。430Hz は石畳を靴で叩いたときの主要な帯域。
         Q を 1.3 → 0.8 に開き、量を倍にした。実測でスペクトル重心が
         6.5kHz まで上がっており、これは「足音」ではなく「シャッ」という
         別の音になっていた。足音は本体が主役で、砂利は装飾でなければならない。 */
      o = L(); o.buf = NZP; o.ft = 'bandpass';
      o.fa = 380 * r; o.fb = 270 * r; o.q = 0.8;
      o.atk = 0.001; o.dec = 0.045 + 0.020 * (1 - sp); o.pk = 2.30 * lvl;
      lay(v, 1, o);

      /* 砂と欠片の擦れ。走るほど増える。砲撃の翌日の広場なので必ず在る。
         ただし装飾。0.25+0.55sp では砂利のほうが主役になっていた。 */
      o = L(); o.buf = NZW; o.ft = 'highpass'; o.fa = 3600 * r; o.q = 0.7;
      o.atk = 0.003; o.dec = 0.055; o.pk = (0.07 + 0.20 * sp) * lvl;
      lay(v, 2, o);

      /* 体重。走っているときだけ乗せる。 */
      o = L(); o.hz = 96 * r; o.hz2 = 66 * r;
      o.atk = 0.002; o.dec = 0.055; o.pk = 0.55 * lvl * sp;
      lay(v, 3, o);

      /* 足音を広場に返す。屋外の石造の広さを一番よく語るのは、
         実は銃声ではなく歩いている自分の足音の返り。 */
      send(v, 0.26, 0.16, 0);
    }

    /* --- アンビエンス ------------------------------------------------------
       ループ音源は start() が1回きりなので、初回だけ起動して
       以後はゲインで出し入れする。3層：
         風  … 380Hz ローパスの白色。0.07Hz の LFO で開閉させる。
               一定だとホワイトノイズのカーテンになり「空気」にならない。
         鳴動… 95Hz 以下。遠くでまだ何かが崩れている広場の底鳴り。
         空気… 5.2kHz ハイパスをごく小さく。これが「屋根が無い」の合図で、
               室内なら決して出ない成分。抜くと途端に狭い場所になる。 */
    function startAmbience() {
      if (ambStarted) return;
      ambStarted = true;

      var wind = ctx.createBufferSource();
      wind.buffer = NZW; wind.loop = true;
      ambWindLP = biq('lowpass', 380, 0.8);
      var wg = gain(0.55);
      wind.connect(ambWindLP); ambWindLP.connect(wg); wg.connect(ambG);
      try { wind.start(0); } catch (e) { }

      var lfo = ctx.createOscillator();
      lfo.type = 'sine'; lfo.frequency.value = 0.07;
      ambLfoG = gain(160);                 /* 380 ± 160Hz。息をしている程度の幅 */
      lfo.connect(ambLfoG); ambLfoG.connect(ambWindLP.frequency);
      try { lfo.start(0); } catch (e2) { }

      var rum = ctx.createBufferSource();
      rum.buffer = NZP; rum.loop = true;
      var rlp = biq('lowpass', 95, 0.8);
      var rg = gain(0.60);
      rum.connect(rlp); rlp.connect(rg); rg.connect(ambG);
      try { rum.start(0); } catch (e3) { }

      var air = ctx.createBufferSource();
      air.buffer = NZW; air.loop = true;
      var ahp = biq('highpass', 5200, 0.7);
      var ag = gain(0.045);
      air.connect(ahp); ahp.connect(ag); ag.connect(ambG);
      try { air.start(0); } catch (e4) { }
    }

    function ambience(on) {
      if (!ensure()) return;
      if (on) startAmbience();
      if (!ambG) return;
      var t = ctx.currentTime;
      ambG.gain.cancelScheduledValues(t);
      ambG.gain.setValueAtTime(ambG.gain.value, t);
      /* 立ち上げ 0.8秒 / 落とし 1.2秒。切り替わりが分かると
         「音が付いた／消えた」という別の情報になってしまう。 */
      ambG.gain.setTargetAtTime(on ? 0.11 : 0.0, t, on ? 0.27 : 0.40);
    }

    /* --- 受聴者 ------------------------------------------------------------ */
    function setListener(x, y, z, yaw) {
      lis.x = x; lis.y = y; lis.z = z; lis.yaw = yaw;
      /* game.js の yawDirX(y)=-sin(y) / yawDirZ(y)=-cos(y) と同じ規約。
         ここがズレると敵の左右が反転するので、値を直接合わせてある。 */
      lis.fx = -Math.sin(yaw); lis.fz = -Math.cos(yaw);
      lis.rx = -lis.fz; lis.rz = lis.fx;
      if (!ctx) return;             /* 未起動でも値は保持する。落とさない。 */
      applyListener(false);
    }

    /* --- 被弾のこもり ------------------------------------------------------
       0 = 通常、1 = 瀕死。
       ローパスは 19kHz→300Hz を指数で結ぶ（周波数の知覚は対数なので、
       線形に動かすと前半が何も起きず後半だけ急に落ちる）。
       Q を 0.7→2.9 へ上げるのは、耳が「暗い」のではなく「詰まって鳴る」ため。
       耳鳴りは amount の二乗で立ち上げる。軽傷で鳴らすと情報として摩耗する。
       マスタも 25% 落として、聴覚そのものが閉じていく感じにする。 */
    function setLowpass(amount) {
      if (!ensure()) return;
      var a = clamp(amount || 0, 0, 1);
      var t = ctx.currentTime;
      var f = 19000 * Math.pow(300 / 19000, a);
      dmgLP.frequency.cancelScheduledValues(t);
      dmgLP.frequency.setTargetAtTime(f, t, 0.08);
      dmgLP.Q.setTargetAtTime(0.7 + 2.2 * a, t, 0.08);
      tinG.gain.setTargetAtTime(0.020 * a * a, t, 0.12);
      master.gain.cancelScheduledValues(t);
      master.gain.setTargetAtTime(MASTER * (1 - 0.25 * a), t, 0.10);
    }

    /* --- 解錠 --------------------------------------------------------------
       iOS Safari は「ユーザー操作の中で AudioContext が起こされ、
       かつ実際に再生が起きた」ことをもって出力を開放する。
       resume() だけでは開かない端末があるので、無音バッファを1つ
       必ず鳴らしてから返す。ここを省くと iPhone で一切音が出ない。

       あわせて、解錠前に積まれた発音を捨て（panic）、
       マスタを 0 から 80ms で立ち上げる。suspend 中は currentTime が
       進まないため、解錠されていない間に呼ばれた音は同じ時刻に溜まる。
       声は VOICES 本しか無いので溜まるのは最大10本だが、
       それでも解錠の瞬間に一斉に鳴れば事故なので、両方で塞いでいる。 */
    function unlock() {
      if (!ensure()) return;
      try {
        if (ctx.state !== 'running' && ctx.resume) {
          var p = ctx.resume();
          if (p && p['catch']) p['catch'](function () { });
        }
      } catch (e) { }

      panic();

      try {
        var s = ctx.createBufferSource();
        s.buffer = SILENT;
        s.connect(ctx.destination);
        s.start(0);
        s.stop(ctx.currentTime + 0.02);
      } catch (e2) { }

      try {
        var t = ctx.currentTime;
        master.gain.cancelScheduledValues(t);
        master.gain.setValueAtTime(0, t);
        master.gain.linearRampToValueAtTime(MASTER, t + 0.08);
      } catch (e3) { }

      unlocked = true;
    }

    /* =======================================================================
       6. 公開 API
       ===================================================================== */
    return {
      unlock: unlock,
      shot: shot,
      impact: impact,
      reload: reload,
      vault: vault,
      slam: slam,
      coverIn: coverIn,
      step: step,
      ambience: ambience,
      setListener: setListener,
      setLowpass: setLowpass,

      /* --- 契約の必須APIではない補助（統合側が使ってよい） --------------- */
      enemyShot: enemyShot,                 /* 敵の発砲を座標付きで鳴らす */
      setAmmo: function (n, max) {          /* 残弾を外から与える（内部計数を上書き） */
        if (max > 0) magSize = max;
        rounds = clamp(n === undefined ? magSize : n, 0, magSize);
      },
      panic: panic,                         /* 全声を止める（画面遷移・ポーズ用） */
      stat: function () {                   /* 検証用。実行中の状態を覗く */
        var live = 0, i;
        if (ctx && strips) {
          for (i = 0; i < VOICES; i++) if (strips[i].end > ctx.currentTime) live++;
        }
        return {
          ok: !!ctx, dead: dead, unlocked: unlocked,
          state: ctx ? ctx.state : 'none',
          voices: VOICES, live: live, rounds: rounds, magSize: magSize,
          sampleRate: ctx ? ctx.sampleRate : 0,
          irSeconds: (ctx && convolver && convolver.buffer) ? convolver.buffer.duration : 0
        };
      }
    };
  };
})(typeof window !== 'undefined' ? window : globalThis);

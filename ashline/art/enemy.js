/* =============================================================================
   ASHLINE / enemy.js  —  ASH.enemy(T, mats, type)

   敵は2種。役割が「形」で読めることを最優先に設計する。

     rusher   … 正面から距離を潰しに来る個体。
                低く・幅広く・前傾。装甲は前面（+Z）に集中し、背面は布。
                頭は小さく肩甲板の谷に沈み、首が見えない。腕は長く前に垂れ、
                拳が腰より低い位置にある＝「止まらずに来る」重心が前の形。

     marksman … 遮蔽に依託して射線を通す個体。
                高く・細く・直立。質量は胸から上に寄せ、腰を絞る。
                頭部が前後に長く、左側だけに照準筒の突起が出る非対称。
                右側に長い銃身と二脚。シルエットの片側だけが伸びる形。

   自機（肩幅が広く、稜線のあるヘルメット、直立の人型）と混同させないため、
   人型の枠は保ったまま「頭身・肩幅・脚長・前傾角」の比率だけで差を作る。
     自機     全高 1.80 / 肩幅 ≈ 0.75 / 直立
     rusher   全高 1.61 / 肩幅 ≈ 1.24 / 前傾 19.5°   （低く潰れた台形）
     marksman 全高 1.93 / 肩幅 ≈ 0.70 / 直立        （細い縦線＋片側の長い突起）

   ---------------------------------------------------------------------------
   実装上の制約と、その理由

   ・ドローコール ≤ 5/体（検証ハーネスは地面込みで2体 ≤ 10 を見る）。
     three ではメッシュ1つ＝1コールなので、部位ごとにメッシュを分けると即座に破綻する。
     そこで全部位を「1マテリアル＋頂点カラー」に統合し、
     可動が要る単位（胴 / 右腕 / 右脚 / 左脚）の4メッシュに手でマージしている。
   ・左腕は独立メッシュにしない。rusher は左前腕が衝角板と一体成型、
     marksman は左腕を胸甲に依託した固定の支持腕、という造形にして胴メッシュへ統合した。
     armL はリグ規約を満たすピボット（正しい肩位置の Group）として残す。
     現在の game.js の syncRig() は敵の腕を動かさないため実挙動の欠落はない。
   ・色は ASH.palette のみ。頂点カラーは「material.color（＝enemyArmor）に対する比」で
     格納する。こうすると game.js が被弾時に mA/mB.color を差し替えても
     全身が同じ比率で明滅し、平常時は palette どおりの色に戻る。
   ・ポーズ角はすべてジオメトリに焼き込み、Group の rotation は 0 に保つ。
     後から歩行やのけぞりを Group に入れても初期姿勢と喧嘩しない。
   ========================================================================== */
(function (g) {
  var ASH = g.ASH = g.ASH || {};

  /* 単位形状は2体で共有する。マージ後は参照されないので GC に任せる。 */
  var UNIT = null;
  function units(T) {
    if (UNIT) return UNIT;
    UNIT = {
      box: new T.BoxGeometry(1, 1, 1).toNonIndexed(),
      /* 8分割＝丸みが読める最小分割。銃身と照準筒にしか使わない */
      cyl: new T.CylinderGeometry(0.5, 0.5, 1, 8, 1).toNonIndexed()
    };
    return UNIT;
  }

  /* ---------------------------------------------------------------------
     ジオメトリ結合器
     部品を1つの BufferGeometry に焼き込む。頂点カラーに
     「基準色に対する比 × 擬似AO」を書く。
     擬似AO＝下ほど暗く／下向き面ほど暗く。light.js のリムAOが乗る前の
     最低限の立体感で、真横からの逆光でも面の切り替わりが読めるようにする。
     ------------------------------------------------------------------ */
  function Bld(T, base, yBase) {
    this.T = T;
    this.base = base;        // material.color と同じ色（＝比の分母）
    this.yBase = yBase;      // この空間の原点が床から何mか（擬似AO用）
    this.p = []; this.n = []; this.c = []; this.uv = [];
    this.ratio = {};         // hex -> [r,g,b] の比。同じ色を何度も変換しない
    this._m4 = new T.Matrix4();
    this._m3 = new T.Matrix3();
    this._q = new T.Quaternion();
    this._e = new T.Euler();
    this._v = new T.Vector3();
    this._n = new T.Vector3();
  }

  Bld.prototype.tint = function (hex) {
    var k = String(hex);
    if (this.ratio[k]) return this.ratio[k];
    var c = new this.T.Color(hex), b = this.base;
    /* 比で持つ理由：material.color を差し替えても色相関係が壊れないため */
    var r = [c.r / Math.max(b.r, 1e-4), c.g / Math.max(b.g, 1e-4), c.b / Math.max(b.b, 1e-4)];
    this.ratio[k] = r;
    return r;
  };

  /* geo: 単位形状 / s: スケール / t: 位置 / r: 回転(rad) / hex: palette の色 */
  Bld.prototype.add = function (geo, sx, sy, sz, x, y, z, rx, ry, rz, hex) {
    var T = this.T;
    this._e.set(rx || 0, ry || 0, rz || 0);
    this._q.setFromEuler(this._e);
    this._m4.compose(this._v.set(x, y, z), this._q, this._n.set(sx, sy, sz));
    this._m3.getNormalMatrix(this._m4);
    var pos = geo.attributes.position.array;
    var nor = geo.attributes.normal.array;
    var uvs = geo.attributes.uv ? geo.attributes.uv.array : null;
    var tin = this.tint(hex);
    var i, ao, ny, wy;
    var uScale = (sx + sz) * 0.5, vScale = sy;
    for (i = 0; i < pos.length; i += 3) {
      this._v.set(pos[i], pos[i + 1], pos[i + 2]).applyMatrix4(this._m4);
      this.p.push(this._v.x, this._v.y, this._v.z);
      wy = this._v.y + this.yBase;
      this._n.set(nor[i], nor[i + 1], nor[i + 2]).applyMatrix3(this._m3).normalize();
      this.n.push(this._n.x, this._n.y, this._n.z);
      ny = this._n.y;
      /* 高さAO：足元は環境の照り返ししか受けない。
         ただし逆光下では素の敵色がほぼ黒に落ちるので、下限は 0.74 で止める。
         ここを 0.6 まで落とすと脚と地面が一体化して人型に見えなくなる。 */
      ao = 0.74 + 0.26 * Math.min(1, Math.max(0, wy / 1.75));
      /* 面向きAO：下向き面を落として板の重なりを読ませる */
      ao *= 0.84 + 0.16 * (ny * 0.5 + 0.5);
      this.c.push(tin[0] * ao, tin[1] * ao, tin[2] * ao);
      if (uvs) {
        var j = (i / 3) * 2;
        this.uv.push(uvs[j] * uScale, uvs[j + 1] * vScale);
      } else { this.uv.push(0, 0); }
    }
    return this;
  };

  /* 左右対称の部品。x と z軸回りの回転を反転して積む */
  Bld.prototype.mirror = function (geo, sx, sy, sz, x, y, z, rx, ry, rz, hex) {
    this.add(geo, sx, sy, sz, x, y, z, rx, ry, rz, hex);
    this.add(geo, sx, sy, sz, -x, y, z, rx, -(ry || 0), -(rz || 0), hex);
    return this;
  };

  Bld.prototype.mesh = function (T, mat) {
    var geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.Float32BufferAttribute(this.p, 3));
    geo.setAttribute('normal', new T.Float32BufferAttribute(this.n, 3));
    geo.setAttribute('color', new T.Float32BufferAttribute(this.c, 3));
    geo.setAttribute('uv', new T.Float32BufferAttribute(this.uv, 2));
    geo.computeBoundingSphere();
    var m = new T.Mesh(geo, mat);
    m.castShadow = true; m.receiveShadow = true;
    return m;
  };

  /* =====================================================================
     本体
     ================================================================== */
  ASH.enemy = function (T, mats, type) {
    var P = ASH.palette;
    var U = units(T);
    var BOX = U.box, CYL = U.cyl;
    var isMark = (type === 'marksman');

    /* 基準色。頂点カラーはこれに対する比なので、
       game.js が被弾フラッシュで color を差し替えても全身が均一に明滅する。 */
    var base = new T.Color(P.enemyArmor);
    var mat = new T.MeshLambertMaterial({ color: base.clone(), vertexColors: true });
    var tex = (mats && mats.tex) || null;
    /* テクスチャはアルベドに掛けない（色は palette が唯一の正）。
       手続きノイズを微小なバンプにだけ使い、平坦な装甲面に鋳肌を与える。 */
    if (tex && tex.noise) { mat.bumpMap = tex.noise; mat.bumpScale = 0.006; }

    var AR = P.enemyArmor, DK = P.enemyArmorDark, CL = P.enemyCloth, TR = P.enemyTrim;

    var root = new T.Group();
    var body = new T.Group(); root.add(body);
    var torso = new T.Group(); torso.position.y = 0.98; body.add(torso);

    var armR = new T.Group();
    var armL = new T.Group();
    var legR = new T.Group();
    var legL = new T.Group();
    torso.add(armR); torso.add(armL);
    body.add(legR); body.add(legL);

    var gun = new T.Group();        // スケールを持たない。+Z が銃口方向
    torso.add(gun);
    var flash = new T.Mesh(
      new T.SphereGeometry(0.11, 6, 5),
      new T.MeshBasicMaterial({ color: new T.Color(P.muzzleCore) })
    );
    flash.visible = false;
    gun.add(flash);

    var tB, aB, lB;

    if (!isMark) {
      /* -----------------------------------------------------------------
         RUSHER
         前傾19.5°。胴だけを倒し、脚は床に垂直のまま残すことで
         「上半身が先に突っ込んでいる」姿勢を作る（脚は body の子で傾かない）。
         ---------------------------------------------------------------- */
      torso.rotation.x = 0.34;
      armR.position.set(0.44, 0.16, 0);
      armL.position.set(-0.44, 0.16, 0);
      legR.position.set(0.23, 0.86, 0);
      legL.position.set(-0.23, 0.86, 0);

      /* --- 胴（腰・胸・肩・頭・左腕一体の衝角板） --- */
      tB = new Bld(T, base, 0.98);
      /* 腰。前面だけに板を重ね、背は落とす */
      tB.add(BOX, 0.60, 0.36, 0.46, 0, -0.14, 0.01, 0, 0, 0, DK);
      tB.add(BOX, 0.64, 0.24, 0.13, 0, -0.24, 0.24, -0.30, 0, 0, AR);
      tB.add(BOX, 0.66, 0.04, 0.10, 0, -0.10, 0.26, 0, 0, 0, TR);
      /* 胸。前面2枚の傾斜板＋その境目の明るいシーム＝正面から見た時だけ層が見える */
      tB.add(BOX, 0.66, 0.46, 0.44, 0, 0.18, 0.00, 0, 0, 0, DK);
      tB.add(BOX, 0.78, 0.42, 0.15, 0, 0.24, 0.25, -0.20, 0, 0, AR);
      tB.add(BOX, 0.72, 0.24, 0.13, 0, -0.02, 0.27, 0.26, 0, 0, AR);
      tB.add(BOX, 0.80, 0.05, 0.11, 0, 0.10, 0.30, 0, 0, 0, TR);
      tB.mirror(BOX, 0.10, 0.40, 0.40, 0.34, 0.16, 0.02, 0, 0, 0, AR);
      /* 背は布と小さな荷。前後で厚みが違う＝横から見ても前が重い */
      tB.add(BOX, 0.52, 0.48, 0.10, 0, 0.12, -0.21, 0, 0, 0, CL);
      tB.add(BOX, 0.42, 0.26, 0.17, 0, 0.32, -0.23, 0, 0, 0, DK);
      /* 肩。甲板を外へ向かって下げる（rz）と上辺が「谷」になり、
         そこに落とした頭が小さな突起として輪郭に出る。
         平らに並べると肩と頭が1枚の板に融合して頭が消えるため。 */
      tB.add(BOX, 0.82, 0.20, 0.42, 0, 0.44, 0.00, 0, 0, 0, DK);
      tB.mirror(BOX, 0.30, 0.38, 0.46, 0.45, 0.38, 0.02, 0, 0, -0.32, AR);
      tB.mirror(BOX, 0.32, 0.05, 0.44, 0.46, 0.55, 0.02, 0, 0, -0.32, TR);
      tB.mirror(BOX, 0.20, 0.18, 0.22, 0.45, 0.40, 0.28, -0.20, 0, -0.32, AR);
      /* 頭。肩の谷から 0.10m だけ出る。首は作らない */
      tB.add(BOX, 0.27, 0.26, 0.32, 0, 0.62, 0.09, 0, 0, 0, DK);
      tB.add(BOX, 0.23, 0.08, 0.11, 0, 0.62, 0.25, 0, 0, 0, TR);
      tB.add(BOX, 0.21, 0.10, 0.17, 0, 0.51, 0.21, 0, 0, 0, AR);
      /* 左前腕＝衝角板（胴と一体成型。armL は肩ピボットとして空で残す） */
      tB.add(BOX, 0.24, 0.36, 0.28, -0.46, 0.02, 0.04, 0, 0, 0, DK);
      tB.add(BOX, 0.20, 0.46, 0.34, -0.52, -0.14, 0.14, -0.12, 0, 0, AR);
      tB.add(BOX, 0.06, 0.44, 0.32, -0.62, -0.14, 0.14, -0.12, 0, 0, TR);
      tB.add(BOX, 0.22, 0.18, 0.24, -0.46, -0.40, 0.26, 0, 0, 0, DK);

      /* --- 右腕。拳を腰より低く前に置き、短い筒だけを持たせる --- */
      aB = new Bld(T, base, 0.98 + 0.16);
      aB.add(BOX, 0.24, 0.36, 0.28, 0.02, -0.14, 0.04, 0, 0, 0, DK);
      aB.add(BOX, 0.26, 0.16, 0.28, 0.03, -0.34, 0.08, 0, 0, 0, AR);
      aB.add(BOX, 0.22, 0.32, 0.24, 0.03, -0.50, 0.18, -0.40, 0, 0, DK);
      aB.add(BOX, 0.24, 0.20, 0.26, 0.03, -0.64, 0.30, 0, 0, 0, AR);
      aB.add(BOX, 0.15, 0.16, 0.30, 0.03, -0.60, 0.46, 0, 0, 0, DK);
      aB.add(CYL, 0.11, 0.14, 0.11, 0.03, -0.60, 0.66, Math.PI / 2, 0, 0, TR);
      armR.add(aB.mesh(T, mat));

      /* --- 脚。太く短く、わずかに外へ開く。膝から下に前板 --- */
      for (var rs = 0; rs < 2; rs++) {
        var s = rs ? -1 : 1;
        lB = new Bld(T, base, 0.86);
        lB.add(BOX, 0.25, 0.44, 0.32, 0.02 * s, -0.20, 0.01, 0, 0, 0, DK);
        lB.add(BOX, 0.22, 0.24, 0.10, 0.03 * s, -0.16, 0.17, 0, 0, 0, AR);
        lB.add(BOX, 0.24, 0.14, 0.28, 0.04 * s, -0.44, 0.03, 0, 0, 0, AR);
        lB.add(BOX, 0.21, 0.32, 0.25, 0.05 * s, -0.62, -0.02, 0, 0, 0, DK);
        lB.add(BOX, 0.18, 0.28, 0.09, 0.05 * s, -0.62, 0.12, 0, 0, 0, AR);
        lB.add(BOX, 0.25, 0.14, 0.40, 0.05 * s, -0.79, 0.08, 0, 0, 0, DK);
        (rs ? legL : legR).add(lB.mesh(T, mat));
      }

      /* 銃口ピボット。右腕に焼き込んだ筒の先端に一致させる */
      gun.position.set(0.47, -0.44, 0.46);
      flash.position.set(0, 0, 0.27);

    } else {
      /* -----------------------------------------------------------------
         MARKSMAN
         直立。腰を絞り胸から上に質量を寄せ、脚を長くして重心を上げる。
         左に照準筒、右に長い銃身。左右非対称をシルエットの署名にする。
         ---------------------------------------------------------------- */
      torso.rotation.x = -0.05;
      armR.position.set(0.27, 0.34, 0);
      armL.position.set(-0.27, 0.34, 0);
      /* 銃を持つ腕だけを外へ振る。真正面から見たとき銃身が奥行き方向に
         潰れて消えるのを防ぐための姿勢角。これが無いと
         「片側だけが長い」という marksman の署名が正面視で失われる。 */
      armR.rotation.y = 0.42;
      legR.position.set(0.13, 0.94, 0);
      legL.position.set(-0.13, 0.94, 0);

      tB = new Bld(T, base, 0.98);
      /* 腰は細く。ここが細いほど胸の塊が持ち上がって見える */
      tB.add(BOX, 0.30, 0.30, 0.28, 0, -0.18, 0.00, 0, 0, 0, DK);
      tB.add(BOX, 0.24, 0.24, 0.22, 0, 0.03, 0.00, 0, 0, 0, CL);
      /* 胸。厚みは前だけ */
      tB.add(BOX, 0.42, 0.38, 0.30, 0, 0.30, 0.01, 0, 0, 0, DK);
      tB.add(BOX, 0.34, 0.30, 0.10, 0, 0.30, 0.17, -0.06, 0, 0, AR);
      tB.add(BOX, 0.36, 0.04, 0.09, 0, 0.16, 0.19, 0, 0, 0, TR);
      /* 背の長い布。縦線を1本通して「細く高い」を強調する */
      tB.add(BOX, 0.34, 0.78, 0.06, 0, -0.02, -0.17, 0.03, 0, 0, CL);
      tB.add(BOX, 0.30, 0.05, 0.05, 0, -0.40, -0.18, 0, 0, 0, TR);
      /* 肩は小さい。rusher の甲板と対になる要素 */
      tB.add(BOX, 0.54, 0.10, 0.24, 0, 0.50, 0.00, 0, 0, 0, DK);
      tB.mirror(BOX, 0.13, 0.22, 0.26, 0.28, 0.44, 0.00, 0, 0, -0.12, AR);
      /* 首を見せる＝rusher との一目での差 */
      tB.add(BOX, 0.11, 0.16, 0.13, 0, 0.60, 0.00, 0, 0, 0, CL);
      /* 頭。前後に長い箱＋前へ突き出す面。左だけに照準筒＝非対称の突起。
         この非対称が、正面から見ても rusher の左右対称な塊と即座に分かれる。 */
      tB.add(BOX, 0.18, 0.21, 0.40, 0, 0.74, 0.05, 0, 0, 0, DK);
      tB.add(BOX, 0.14, 0.14, 0.22, 0.02, 0.70, 0.31, 0, 0, 0, AR);
      tB.add(CYL, 0.12, 0.44, 0.12, -0.10, 0.81, 0.20, Math.PI / 2, 0, 0, TR);
      tB.add(BOX, 0.09, 0.09, 0.09, -0.10, 0.81, 0.43, 0, 0, 0, DK);
      tB.add(BOX, 0.05, 0.24, 0.30, -0.055, 0.92, -0.06, 0.28, 0, 0, TR);
      tB.add(BOX, 0.10, 0.10, 0.14, 0.02, 0.70, -0.19, 0, 0, 0, DK);
      /* 左腕＝胸甲に依託した固定の支持腕（胴と一体。armL は肩ピボット） */
      tB.add(BOX, 0.14, 0.32, 0.16, -0.27, 0.18, 0.02, 0, 0, 0, DK);
      tB.add(BOX, 0.13, 0.30, 0.14, -0.20, 0.02, 0.16, -0.75, 0, 0.28, DK);
      tB.add(BOX, 0.12, 0.11, 0.13, -0.09, -0.08, 0.32, 0, 0, 0, AR);
      tB.add(BOX, 0.09, 0.16, 0.09, -0.06, -0.14, 0.40, 0.20, 0, 0, DK);

      /* --- 右腕＋長銃身。銃はこの腕に焼き込む（描画コール節約） --- */
      aB = new Bld(T, base, 0.98 + 0.34);
      aB.add(BOX, 0.15, 0.34, 0.17, 0.00, -0.17, 0.02, 0, 0, 0, DK);
      aB.add(BOX, 0.14, 0.12, 0.16, -0.01, -0.35, 0.06, 0, 0, 0, AR);
      aB.add(BOX, 0.13, 0.28, 0.14, -0.04, -0.46, 0.20, -0.75, 0, 0, DK);
      aB.add(BOX, 0.11, 0.11, 0.12, -0.08, -0.52, 0.34, 0, 0, 0, AR);
      /* 銃：床尾→機関部→銃身→制退器。全長 1.28m で片側だけ伸びる */
      aB.add(BOX, 0.09, 0.14, 0.26, -0.12, -0.50, 0.05, 0, 0, 0, DK);
      aB.add(BOX, 0.10, 0.15, 0.44, -0.12, -0.46, 0.40, 0, 0, 0, DK);
      aB.add(BOX, 0.07, 0.18, 0.10, -0.12, -0.60, 0.34, 0, 0, 0, AR);
      aB.add(BOX, 0.05, 0.08, 0.05, -0.12, -0.42, 0.38, 0, 0, 0, DK);
      aB.add(BOX, 0.06, 0.07, 0.26, -0.12, -0.36, 0.46, 0, 0, 0, TR);
      aB.add(CYL, 0.064, 0.50, 0.064, -0.12, -0.44, 0.86, Math.PI / 2, 0, 0, DK);
      aB.add(CYL, 0.10, 0.12, 0.10, -0.12, -0.44, 1.14, Math.PI / 2, 0, 0, TR);
      /* 二脚。銃身の下にVを作ると「据えて撃つ個体」だと遠目に分かる */
      aB.add(BOX, 0.028, 0.30, 0.028, -0.03, -0.60, 1.02, 0, 0, -0.35, DK);
      aB.add(BOX, 0.028, 0.30, 0.028, -0.21, -0.60, 1.02, 0, 0, 0.35, DK);
      armR.add(aB.mesh(T, mat));

      /* --- 脚。長く細い。膝下を布にして脛の板を浮かせる --- */
      lB = new Bld(T, base, 0.94);
      lB.add(BOX, 0.17, 0.46, 0.19, 0.00, -0.24, 0.00, 0, 0, 0, DK);
      lB.add(BOX, 0.15, 0.16, 0.10, 0.00, -0.30, 0.12, 0, 0, 0, CL);
      lB.add(BOX, 0.15, 0.10, 0.17, 0.00, -0.49, 0.01, 0, 0, 0, AR);
      lB.add(BOX, 0.14, 0.40, 0.16, 0.00, -0.72, -0.01, 0, 0, 0, CL);
      lB.add(BOX, 0.12, 0.26, 0.07, 0.00, -0.70, 0.10, 0, 0, 0, AR);
      lB.add(BOX, 0.16, 0.10, 0.30, 0.00, -0.89, 0.06, 0, 0, 0, DK);
      legR.add(lB.mesh(T, mat));

      lB = new Bld(T, base, 0.94);
      lB.add(BOX, 0.17, 0.46, 0.19, 0.00, -0.24, 0.00, 0, 0, 0, DK);
      lB.add(BOX, 0.15, 0.16, 0.10, 0.00, -0.30, 0.12, 0, 0, 0, CL);
      lB.add(BOX, 0.15, 0.10, 0.17, 0.00, -0.49, 0.01, 0, 0, 0, AR);
      lB.add(BOX, 0.14, 0.40, 0.16, 0.00, -0.72, -0.01, 0, 0, 0, CL);
      lB.add(BOX, 0.12, 0.26, 0.07, 0.00, -0.70, 0.10, 0, 0, 0, AR);
      lB.add(BOX, 0.16, 0.10, 0.30, 0.00, -0.89, 0.06, 0, 0, 0, DK);
      legL.add(lB.mesh(T, mat));

      /* armR を y 回りに振ったので、銃口ピボットも同じ角度で回した位置に置く */
      gun.position.set(0.324, -0.12, 0.414);
      gun.rotation.y = 0.42;
      flash.position.set(0, 0, 0.80);
    }

    torso.add(tB.mesh(T, mat));

    /* mA / mB は game.js の被弾フラッシュ用。1マテリアルに集約しているので
       同じ参照を返す（どちらを差し替えても全身が均一に明滅する）。 */
    return {
      root: root, body: body, torso: torso,
      armR: armR, armL: armL, legR: legR, legL: legL,
      gun: gun, flash: flash,
      mA: mat, mB: mat
    };
  };
})(typeof window !== 'undefined' ? window : globalThis);

'use strict';
/* =====================================================================
 *  bosses_b.js ── ラウンド4・5のボス（ロシーヌ / モズグス）
 *
 *  ■ ロシーヌ rosine「霧の森の女王」（ラウンド4, hp 600）
 *    蛾の翅を持つ妖精めいた使徒。ほぼ常に飛んでいる。空中ではのけぞらない
 *    （ポイズを削り切る大技だけが撃ち落とせる）。体力半分で激昂（技が速く・多く）。
 *     ・急降下突撃 dive : 画面端へ移動 → 滞空して口吻を伸ばし、先端が光る + 金切り声
 *                        + 地面に突進の軌道（帯）を表示 → 画面を横切る高速突進。
 *                        奥行きをずらしてかわす。突進後は地面に落ちて目を回す（反撃の好機）。
 *                        激昂時は画面端で折り返してもう一往復。
 *     ・鱗粉 powder     : 翅を高く掲げ（溜め）→ 打ち下ろして毒の鱗粉の雲を主人公の周りへ。しばらく残る。
 *     ・眷属召喚 summon : 蛾の妖精もどき(moth)を 2〜3 体呼ぶ。
 *     ・音波の悲鳴 scream: 身を反らし口を開く（溜め）→ 地を這う音の輪（跳んでかわす）。
 *     ・口吻の突き stab : 近距離。身を引いてから突き刺す。
 *     ・滞空中に短時間で 8 発以上殴られると、高く舞い上がって主人公の頭上を越え反対側へ逃れる。
 *
 *  ■ モズグス mozgus「異端審問官」（ラウンド5, hp 750, 2段階）
 *    第1形態: 石版を携えた巨躯の審問官。地上をゆっくり迫る。
 *     ・掌底 palm / 連掌 flurry(アーマー) / 掴み seize → 石版で殴打 pummel（drainHero）→ 投げ捨て
 *     ・石版の叩きつけ slam(アーマー): 前後に地を這う岩の衝撃波（跳んでかわす）
 *     ・拷問官を 2 体呼ぶ summon（1回だけ）
 *     ・殴られ続けると、アーマー付きの払い repel で割り込む
 *    体力半分で変身 transform（閃光・時が止まる・咆哮）→ 第2形態: 翼と光輪の天使。飛行する。
 *     ・光の柱 pillar : 主人公の足元に光の印 → 50F後に天から光の柱
 *     ・急降下拳 dive : 高く舞い上がり拳を引く（照準の印）→ 急降下。着地後しばらく硬直（反撃の好機）
 *     ・光輪 ring     : 光輪が膨らむ（溜め）→ 地を這う光の輪（跳んでかわす）
 *     ・石版の薙ぎ払い swat（近距離）
 *     ・天使の加護（被ダメージ 0.85 倍）。殴られ続けると高く舞い上がって反対側へ移り、光の柱を降らせる
 *
 *  共通: 空中ではのけぞらない（superArmor）。ポイズを削り切る重い一撃だけが撃ち落とせる（onBeforeHit）。
 *        反撃の好機（墜落後の気絶 / 急降下拳の硬直）は独自状態 'stun'（被弾してものけぞるだけで時間は減り続ける）。
 *        翅・翼・石版はスプライトにキャッシュして描く。
 * ===================================================================== */
(function (BK) {
  const U = BK.U, R = BK.rig, D = U.DEG;

  // ================================================================ 共通ヘルパー
  /** 被弾フラッシュ中（白く光らせる） */
  const flashing = e => e.flash > 0 && (e.flash & 2);
  const HEAVY_KB = { down: 1, launch: 1, spin: 1 };
  /** 主人公を掴める状態か */
  const canGrab = h => !!h && !h.dead && h.hurtable && h.state !== 'grabbed' && !h.grabbing && h.z <= 24;
  /** 飛行: 目標高度へ寄せる（毎フレーム vz を与えて physics の重力を打ち消す） */
  function hover(e, tz, k) { e.vz = (tz - e.z) * (k || 0.08); }
  /** 空中での減速（physics の摩擦は接地中しか効かない） */
  function airDrag(e, k) {
    e.vx *= k; e.vy *= k;
    if (Math.abs(e.vx) < 0.04) e.vx = 0;
    if (Math.abs(e.vy) < 0.04) e.vy = 0;
  }
  /** 目標点へ滑らかに寄る（近づくときは速く、離れるときは遅く） */
  function steer(e, tx, ty, spdIn, spdOut, spdY, acc) {
    const dx = tx - e.x, h = BK.game && BK.game.hero;
    const toward = h ? U.sign(dx) === U.sign(h.x - e.x) : true;
    const mx = toward ? spdIn : spdOut;
    const a = acc || 0.12;
    e.vx = U.approach(e.vx, U.clamp(dx * 0.05, -mx, mx), a);
    e.vy = U.approach(e.vy, U.clamp((ty - e.y) * 0.05, -spdY, spdY), a * 0.6);
  }
  const scrX = (x, m) => U.clamp(x, BK.cam.x + m, BK.cam.x + BK.W - m);
  const clampY = y => U.clamp(y, 6, BK.DEPTH - 6);
  /** 円のサブパス */
  function dot(c, x, y, r) { c.moveTo(x + r, y); c.arc(x, y, r, 0, Math.PI * 2); }
  /** 2次ベジェ上の点 */
  function qpt(x0, y0, cx, cy, x1, y1, k) {
    const a = (1 - k) * (1 - k), b = 2 * (1 - k) * k, d = k * k;
    return [a * x0 + b * cx + d * x1, a * y0 + b * cy + d * y1];
  }
  /** 飛行ボス共通: 毎フレームの高度・アーマー管理（def.update から呼ぶ） */
  function flyUpdate(e, B) {
    if (e.dead || e.state === 'fall' || e.state === 'down' || e.state === 'getup') { e.superArmor = 0; return; }
    if (B.fly === true) {
      hover(e, B.tz, B.hk || 0.08);
      // 空中で技が終わると endMove が 'air' にする → Enemy.update が think を呼ばなくなるので戻す
      if (e.state === 'air') e.state = 'idle';
    }
    // 空中ではのけぞらない（ポイズを削り切った大技だけが撃ち落とせる → onBeforeHit）
    e.superArmor = e.z > 1 ? 1 : 0;
  }
  /** ボス共通の初期化 */
  function bossCommon(e) {
    e.entering = 0;
    // ポイズを削り切った重い一撃（kb が down/launch/spin のまま届く）なら空中のアーマーを外して撃ち落とされる
    e.onBeforeHit = (src, h) => { if (h && HEAVY_KB[h.kb]) e.superArmor = 0; };
  }
  function countAlive(game, id) {
    let n = 0;
    for (const a of game.actors) if (a.def && a.def.id === id && !a.dead && !a.remove) n++;
    return n;
  }
  function startAtk(e, B, m, cd) {
    e.faceHero();
    e.startMove(m);
    B.cd = cd; B.last = m;
  }
  // ---------------------------------------------------------- 静的パーツのスプライト化
  //  翅・翼・石版は形が変わらない（回転・拡縮だけ）ので、一度オフスクリーンに描いて drawImage で使い回す
  const SPR = new Map();
  /** key ごとに1回だけ fn(c) で描く。(ox, oy) = 原点のキャンバス内位置、res = 1単位あたりの解像度 */
  function sprite(key, w, h, ox, oy, res, fn) {
    let sp = SPR.get(key);
    if (!sp) {
      const cv = document.createElement('canvas');
      cv.width = Math.ceil(w * res); cv.height = Math.ceil(h * res);
      const c = cv.getContext('2d');
      c.scale(res, res); c.translate(ox, oy);
      c.lineJoin = 'round'; c.lineCap = 'round';
      fn(c);
      sp = { cv, w, h, ox, oy };
      SPR.set(key, sp);
      if (SPR.size > 40) SPR.delete(SPR.keys().next().value);
    }
    return sp;
  }
  function blit(c, sp) { c.drawImage(sp.cv, -sp.ox, -sp.oy, sp.w, sp.h); }

  /** 発射したボスが倒れたら、残った危険物は無害化して消す（クリア演出中に当たらないように） */
  function ownerGone(p) {
    if (!p.owner || !p.owner.dead) return false;
    p.harmless = true; p.done = true;
    if (p.life > 16) p.life = 16;
    return true;
  }
  /** 同じ技の連発を少し避ける重み付き抽選 */
  function pick(list, last) {
    let m = U.weighted(list);
    if (m === last && list.length > 1) m = U.weighted(list);
    return m;
  }

  // ---------------------------------------------------------- 地を這う輪（跳んでかわす）
  /** 地面に広がる輪。主人公が高さ 15 以下で輪に触れると吹き飛ぶ（1回だけ） */
  function groundRing(e, o) {
    const g = BK.game;
    if (!g) return null;
    return g.addProjectile(new BK.Projectile({
      x: e.x, y: e.y, z: 0, vx: 0, vz: 0, team: 'enemy', owner: e, harmless: true, noShadow: true,
      life: o.life || 70, r: o.r0 || 14, spd: o.spd || 4.3, dmg: o.dmg || 12, kind: o.kind || 'sonic', done: false,
      tick: ringTick, drawFn: ringDraw,
    }));
  }
  function ringTick(p) {
    p.r += p.spd;
    if (p.done || ownerGone(p)) return;
    const h = BK.game && BK.game.hero;
    if (!h || !h.hurtable || h.z > 15) return;
    const d = Math.hypot(h.x - p.x, (h.y - p.y) / 0.45);
    if (Math.abs(d - p.r) < 8 + h.w * 0.5) {
      p.done = true;
      const dir = U.sign(h.x - p.x || 1);
      const hh = { dmg: p.dmg, kb: 'down', push: 4.5, lift: 4.5, stop: 5, sfx: 'hitHeavy' };
      if (h.takeHit(p.owner, hh, dir)) BK.combat.hitFx(p.owner, h, hh, h.x, dir);
    }
  }
  function ringDraw(c, sx, sy, p) {
    const k = Math.min(1, p.life / 16, p.t / 3), holy = p.kind === 'holy';
    const rx = p.r, ry = p.r * 0.45;
    c.save();
    c.globalCompositeOperation = 'lighter';
    // 低い壁（高さ 12px 程度 = 跳べば越えられる）
    c.lineWidth = 10; c.globalAlpha = 0.2 * k; c.strokeStyle = holy ? '#ffc850' : '#b070ff';
    c.beginPath(); c.ellipse(sx, sy - 6, rx, ry, 0, 0, Math.PI * 2); c.stroke();
    c.lineWidth = 2.6; c.globalAlpha = 0.9 * k; c.strokeStyle = holy ? '#fff0b8' : '#ecd4ff';
    c.beginPath(); c.ellipse(sx, sy, rx, ry, 0, 0, Math.PI * 2); c.stroke();
    c.lineWidth = 1.4; c.globalAlpha = 0.55 * k;
    c.beginPath(); c.ellipse(sx, sy - 12, rx, ry, 0, 0, Math.PI * 2); c.stroke();
    if (holy) {
      // 光の粒
      c.fillStyle = '#fff6d0'; c.globalAlpha = 0.9 * k;
      for (let i = 0; i < 10; i++) {
        const a = i * 0.628 + p.t * 0.03;
        c.fillRect(sx + Math.cos(a) * rx - 1.5, sy + Math.sin(a) * ry - 7 - (i % 3) * 3, 3, 3);
      }
    } else {
      // 後を追う細い音の輪
      for (let i = 1; i <= 2; i++) {
        const r2 = p.r - i * 11;
        if (r2 < 4) continue;
        c.globalAlpha = (0.45 - i * 0.14) * k; c.lineWidth = 1.5;
        c.beginPath(); c.ellipse(sx, sy - 3, r2, r2 * 0.45, 0, 0, Math.PI * 2); c.stroke();
      }
    }
    c.restore();
  }

  // ================================================================
  //  ロシーヌ rosine ── 霧の森の女王
  // ================================================================
  const RC = {
    wing: '#7a6592', wingFar: '#4a3b5c', band: '#2a1f36', pale: '#dccba6', ring: '#e2aa3c', spot: '#a3162e', pupil: '#1a0a12',
    vein: 'rgba(24,12,30,0.5)', body: '#e7ddcb', shade: '#b3a590', chitin: '#3a2c3e', chitinHi: '#5e4a62', fur: '#f2e9d6', furShade: '#c4b394',
    eye: '#b3182e', eyeHi: '#ff9c9c', line: 'rgba(16,8,18,0.9)', prob: '#2e2232', probHi: '#9a88a0', glow: '#ffe4a6',
    abd: '#8a7a9c', hair: '#322638', hairHi: '#6c5a78', ant: '#a08ea6',
  };
  const RS = 1.3; // ロシーヌの描画倍率
  const RC_RAGE = Object.assign({}, RC, { ring: '#ff6a3a', spot: '#e8203c', band: '#3a1426', eye: '#e01830', wing: '#86608e' });
  const RC_W = (() => { const o = {}; for (const k in RC) o[k] = '#ffffff'; o.line = 'rgba(0,0,0,0.3)'; o.vein = 'rgba(0,0,0,0.1)'; o.flash = true; return o; })();
  RC.name = 'n'; RC_RAGE.name = 'r'; RC_W.name = 'w';
  const SCALE_COLS = ['#efe2b8', '#cdb6ec', '#fff4d4', '#b89ad8'];

  function rb(e) {
    return e.bs || (e.bs = { t: 0, fly: true, tz: 48, baseZ: 46, hk: 0.08, cd: 80, summonCd: 420, sinceDive: 0, stunT: 0, stunFx: false, rage: false, pref: 130, diveX: 0, diveN: 0, last: null, dmgN: 0, dmgT: 0, evade: 0, evX: 0 });
  }
  function scales(x, y, z, n, spread) {
    for (let i = 0; i < n; i++) {
      BK.fx.add({ type: 'dot', x: x + U.rand(-spread, spread), y: y + U.rand(-4, 4), z: z + U.rand(-spread * 0.6, spread * 0.6), vx: U.rand(-1, 1), vz: U.rand(-0.4, 1.2), drag: 0.95, life: U.randi(24, 44), col: U.choose(SCALE_COLS), size: U.rand(1.2, 2.4) });
    }
  }

  // ---------------------------------------------------------- 翅
  function foreWingPath(c, L, W) {
    c.beginPath();
    c.moveTo(0, 3);
    c.quadraticCurveTo(L * 0.45, W * 0.46, L * 0.97, W * 0.2);      // 前縁
    c.quadraticCurveTo(L * 1.08, -W * 0.04, L * 0.93, -W * 0.3);     // 丸い翅端
    c.quadraticCurveTo(L * 0.9, -W * 0.54, L * 0.77, -W * 0.52);     // 外縁のスカラップ
    c.quadraticCurveTo(L * 0.7, -W * 0.7, L * 0.57, -W * 0.63);
    c.quadraticCurveTo(L * 0.48, -W * 0.74, L * 0.38, -W * 0.6);
    c.quadraticCurveTo(L * 0.28, -W * 0.64, L * 0.22, -W * 0.46);
    c.quadraticCurveTo(L * 0.08, -W * 0.3, 0, -3);
    c.closePath();
  }
  function hindWingPath(c, L, W) {
    c.beginPath();
    c.moveTo(0, 2);
    c.quadraticCurveTo(L * 0.5, W * 0.56, L * 0.88, W * 0.16);
    c.quadraticCurveTo(L * 1.06, -W * 0.06, L * 1.02, -W * 0.22);
    c.quadraticCurveTo(L * 1.25, -W * 0.3, L * 1.48, -W * 0.54);      // 尾状突起
    c.quadraticCurveTo(L * 1.54, -W * 0.68, L * 1.4, -W * 0.64);
    c.quadraticCurveTo(L * 1.12, -W * 0.52, L * 0.84, -W * 0.58);
    c.quadraticCurveTo(L * 0.42, -W * 0.74, 0, -2);
    c.closePath();
  }
  function eyeSpot(c, x, y, r, P, glow) {
    c.fillStyle = P.band; c.beginPath(); dot(c, x, y, r * 1.2); c.fill();
    c.fillStyle = P.ring; c.beginPath(); dot(c, x, y, r); c.fill();
    c.fillStyle = P.spot; c.beginPath(); dot(c, x, y, r * 0.66); c.fill();
    c.fillStyle = P.pupil; c.beginPath(); dot(c, x + r * 0.1, y, r * 0.3); c.fill();
    c.fillStyle = 'rgba(255,255,255,0.7)'; c.beginPath(); dot(c, x - r * 0.28, y - r * 0.3, r * 0.15); c.fill();
    if (glow > 0) {
      c.save(); c.globalCompositeOperation = 'lighter';
      c.globalAlpha = glow * 0.45; c.fillStyle = P.ring; c.beginPath(); dot(c, x, y, r * 1.7); c.fill();
      c.globalAlpha = glow * 0.5; c.fillStyle = '#fff0c0'; c.beginPath(); dot(c, x, y, r * 0.7); c.fill();
      c.restore();
    }
  }
  /** 翅1枚（付け根 x,y、方向 ang[rad]、長さ L）。前縁は +y 側、スカラップの外縁は -y 側。
   *  形と模様はスプライトにキャッシュし、目玉模様の輝き（glow）だけ毎フレーム重ねる */
  function rWing(c, x, y, ang, L, P, far, hind, glow) {
    const W = hind ? L * 0.62 : L * 0.5;
    const w = (hind ? L * 1.58 : L * 1.14) + 12, h = W * 1.45 + 10, ox = 6, oy = W * 0.82 + 5;
    const sp = sprite('rw' + P.name + (far ? 'f' : 'n') + (hind ? 'h' : 'w') + L, w, h, ox, oy, RS * 2.2, sc => rWingPaint(sc, L, P, far, hind));
    c.save(); c.translate(x, y); c.rotate(ang);
    blit(c, sp);
    if (glow > 0 && !far && !P.flash) {
      const ex = hind ? L * 0.6 : L * 0.61, ey = hind ? -W * 0.14 : -W * 0.1, r = W * (hind ? 0.14 : 0.19);
      c.globalCompositeOperation = 'lighter';
      c.globalAlpha = glow * 0.45; c.fillStyle = P.ring; c.beginPath(); dot(c, ex, ey, r * 1.7); c.fill();
      c.globalAlpha = glow * 0.5; c.fillStyle = '#fff0c0'; c.beginPath(); dot(c, ex, ey, r * 0.7); c.fill();
    }
    c.restore();
  }
  function rWingPaint(c, L, P, far, hind) {
    const W = hind ? L * 0.62 : L * 0.5, path = hind ? hindWingPath : foreWingPath;
    path(c, L, W);
    c.fillStyle = far ? P.wingFar : P.wing; c.fill();
    if (!P.flash) {
      c.save(); c.clip();
      // 付け根の暗がり
      c.globalAlpha = 0.55; c.fillStyle = P.band;
      c.beginPath(); c.ellipse(L * 0.06, 0, L * 0.24, W * 0.55, 0, 0, Math.PI * 2); c.fill();
      c.globalAlpha = 1;
      // 翅脈
      c.strokeStyle = P.vein; c.lineWidth = 0.8; c.beginPath();
      const tips = hind ? [[0.98, -0.02], [0.92, -0.4], [0.6, -0.62], [1.42, -0.6]] : [[0.96, 0.12], [0.92, -0.28], [0.76, -0.5], [0.56, -0.62], [0.38, -0.58], [0.24, -0.44]];
      for (const [tx, ty] of tips) { c.moveTo(2, 0); c.quadraticCurveTo(L * tx * 0.45, W * ty * 0.25, L * tx, W * ty); }
      c.stroke();
      if (!hind) {
        // 暗い横帯
        c.strokeStyle = P.band; c.globalAlpha = far ? 0.45 : 0.7; c.lineWidth = W * 0.14;
        c.beginPath(); c.moveTo(L * 0.36, W * 0.5); c.quadraticCurveTo(L * 0.47, -W * 0.1, L * 0.3, -W * 0.7); c.stroke();
        // 淡い外縁帯
        c.strokeStyle = P.pale; c.globalAlpha = far ? 0.3 : 0.55; c.lineWidth = W * 0.07;
        c.beginPath(); c.moveTo(L * 0.99, W * 0.04); c.quadraticCurveTo(L * 0.87, -W * 0.5, L * 0.36, -W * 0.54); c.stroke();
      }
      // 外縁の暗い縁取り
      c.globalAlpha = far ? 0.4 : 0.55; c.strokeStyle = P.band; c.lineWidth = W * 0.12;
      path(c, L, W); c.stroke();
      c.globalAlpha = 1;
      if (!far) eyeSpot(c, hind ? L * 0.6 : L * 0.61, hind ? -W * 0.14 : -W * 0.1, W * (hind ? 0.14 : 0.19), P, 0);
      c.restore();
      path(c, L, W);
    }
    c.strokeStyle = P.line; c.lineWidth = 1.1; c.stroke();
  }

  // ---------------------------------------------------------- 体（腰を原点とする座標）
  function rLeg(c, P, x, y, a1, a2, far) {
    const kx = x + Math.sin(a1 * D) * 17, ky = y + Math.cos(a1 * D) * 17;
    const fx = kx + Math.sin(a2 * D) * 19, fy = ky + Math.cos(a2 * D) * 19;
    R.limb(c, x, y, kx, ky, 6.4, 4.4, far ? P.shade : P.body, P.line);
    R.limb(c, kx, ky, fx, fy, 4.3, 2.3, far ? P.chitin : P.chitinHi, P.line);
    // 針のような足先
    c.strokeStyle = P.chitin; c.lineWidth = 1.6;
    c.beginPath(); c.moveTo(fx, fy); c.lineTo(fx + Math.sin(a2 * D) * 6, fy + Math.cos(a2 * D) * 6); c.stroke();
    // 膝の棘
    c.lineWidth = 1.2; c.beginPath(); c.moveTo(kx, ky); c.lineTo(kx - Math.sin((a1 - 70) * D) * 4, ky - Math.cos((a1 - 70) * D) * 4); c.stroke();
  }
  function rArm(c, P, x, y, a1, a2, far) {
    const ex = x + Math.sin(a1 * D) * 13, ey = y + Math.cos(a1 * D) * 13;
    const hx = ex + Math.sin(a2 * D) * 13, hy = ey + Math.cos(a2 * D) * 13;
    R.limb(c, x, y, ex, ey, 4.6, 3.6, far ? P.shade : P.body, P.line);
    R.limb(c, ex, ey, hx, hy, 3.6, 2.6, far ? P.chitin : P.chitinHi, P.line);
    // 鉤爪
    c.strokeStyle = P.chitin; c.lineWidth = 1.2; c.beginPath();
    for (let i = -1; i <= 1; i++) {
      const a = (a2 + i * 24) * D;
      c.moveTo(hx, hy);
      c.quadraticCurveTo(hx + Math.sin(a) * 5, hy + Math.cos(a) * 5, hx + Math.sin(a + 0.45) * 8, hy + Math.cos(a + 0.45) * 8);
    }
    c.stroke();
  }
  const TORSO = [-4.5, 1, 4.5, 1, 6.5, -9, 9, -20, 7.5, -27, -1.5, -30, -6.5, -24, -5.5, -10];
  function rTorso(c, P) {
    R.poly(c, TORSO, P.body, P.line);
    if (P.flash) return;
    R.poly(c, [-4.5, 1, -1.2, 1, -2, -12, -3.2, -28, -6.5, -24, -5.5, -10], P.shade);
    // 甲殻の胴着（腰〜胸の下）
    R.poly(c, [-5.2, 1.5, 5.2, 1.5, 7, -9, 8.8, -17.5, 5, -20.5, 0.5, -19, -4.5, -21, -6.4, -16, -5.8, -9], P.chitin);
    c.strokeStyle = P.chitinHi; c.lineWidth = 1;
    c.beginPath(); c.moveTo(1.5, 0); c.quadraticCurveTo(3.5, -9, 1.2, -18.5);
    c.moveTo(-5.6, -8.5); c.quadraticCurveTo(0.5, -6.5, 6.8, -8.8); c.stroke();
    c.strokeStyle = P.pale; c.globalAlpha = 0.5; c.lineWidth = 0.9;
    c.beginPath(); c.moveTo(8.6, -17.2); c.quadraticCurveTo(4.5, -21.5, 0.5, -19); c.quadraticCurveTo(-3, -21.5, -6.2, -16); c.stroke();
    c.globalAlpha = 1;
    R.poly(c, TORSO, null, P.line);
  }
  function rAbdomen(c, P, t, ang) {
    // 腰から後ろ下へ垂れる蛾の腹（毛羽立った節）
    c.save(); c.translate(-3, 0); c.rotate(ang + Math.sin(t * 0.09) * 0.07);
    R.poly(c, [-6, -2, -7.4, 9, -6, 18, -3, 25, 0, 28, 3, 25, 6, 18, 7.4, 9, 6, -2], P.abd, P.line);
    if (!P.flash) {
      c.strokeStyle = P.band; c.lineWidth = 1.3; c.beginPath();
      for (const y of [6, 12, 17.5, 22.5]) { const w = y < 15 ? 7 : 7 - (y - 15) * 0.6; c.moveTo(-w, y); c.quadraticCurveTo(0, y + 2.4, w, y); }
      c.stroke();
      c.strokeStyle = P.pale; c.globalAlpha = 0.45; c.lineWidth = 1; c.beginPath();
      for (const y of [4, 10, 15.5]) { c.moveTo(-6, y); c.quadraticCurveTo(-1, y + 1.6, 3, y + 1.2); }
      c.stroke(); c.globalAlpha = 1;
    }
    c.restore();
  }
  function rHair(c, P, t) {
    // 後頭部から背へ流れる髪
    const s = Math.sin(t * 0.08) * 1.5;
    R.poly(c, [5, -48, -3, -49, -11, -44, -15 + s, -34, -13 + s, -26, -9, -31, -6, -28, -4, -36, 1, -41], P.hair, P.line);
    if (!P.flash) {
      c.strokeStyle = P.hairHi; c.lineWidth = 0.8; c.beginPath();
      c.moveTo(0, -46); c.quadraticCurveTo(-9, -44, -12 + s, -31); c.moveTo(-3, -44); c.quadraticCurveTo(-7, -38, -7, -31); c.stroke();
    }
  }
  function rCollar(c, P) {
    c.beginPath();
    for (let i = 0; i < 14; i++) {
      const a = i / 14 * Math.PI * 2, rr = i % 2 ? 6 : 9.8;
      c.lineTo(2.5 + Math.cos(a) * rr, -28 + Math.sin(a) * rr * 0.72);
    }
    c.closePath(); c.fillStyle = P.fur; c.fill(); c.strokeStyle = P.line; c.lineWidth = 0.9; c.stroke();
    if (!P.flash) { c.fillStyle = P.furShade; c.beginPath(); c.ellipse(-2, -26.5, 4, 3, 0, 0, Math.PI * 2); c.fill(); }
  }
  function antenna(c, P, x0, y0, x1, y1, sway) {
    const mx = (x0 + x1) / 2 + 7, my = (y0 + y1) / 2 - 3 + sway;
    c.strokeStyle = P.ant; c.lineWidth = 1.3;
    c.beginPath(); c.moveTo(x0, y0); c.quadraticCurveTo(mx, my, x1, y1); c.stroke();
    // 羽毛状の枝
    c.lineWidth = 0.8; c.beginPath();
    for (let i = 2; i <= 9; i++) {
      const k = i / 10, pt = qpt(x0, y0, mx, my, x1, y1, k), bl = 4.2 * Math.sin(k * Math.PI) + 0.8;
      c.moveTo(pt[0], pt[1]); c.lineTo(pt[0] - bl * 0.2, pt[1] - bl);
      c.moveTo(pt[0], pt[1]); c.lineTo(pt[0] + bl * 0.9, pt[1] - bl * 0.35);
    }
    c.stroke();
  }
  function rHead(c, P, p, t) {
    c.save(); c.translate(8, -40); c.rotate(p.head); c.scale(1.15, 1.15);
    const sw = Math.sin(t * 0.07) * 2;
    antenna(c, P, 1, -7, -20, -28, sw * 0.7);
    // 後頭部の甲殻の房
    R.poly(c, [-1, -7.5, -11, -10, -17, -5, -9, -2.5, -4, 2], P.chitin, P.line);
    // 頭
    c.beginPath(); c.ellipse(0, 0, 7.2, 8.2, 0.15, 0, Math.PI * 2);
    c.fillStyle = P.body; c.fill(); c.strokeStyle = P.line; c.lineWidth = 1.1; c.stroke();
    // 尖った耳
    R.poly(c, [-3, -1, -13, -7.5, -2, 3.5], P.body, P.line);
    // 複眼
    c.beginPath(); c.ellipse(4.3, -1, 4.1, 5.3, 0.25, 0, Math.PI * 2);
    c.fillStyle = P.eye; c.fill(); c.stroke();
    if (!P.flash) {
      c.fillStyle = P.eyeHi;
      c.beginPath(); dot(c, 5.4, -3.2, 1.1); dot(c, 3.2, 0.6, 0.7); dot(c, 6.2, 1.2, 0.6); c.fill();
      c.fillStyle = 'rgba(255,255,255,0.8)'; c.beginPath(); dot(c, 5.8, -3.6, 0.5); c.fill();
    }
    antenna(c, P, 3, -7.5, -12, -33, sw);
    // 口吻（ふだんは巻いている / 伸ばすと槍になる）
    const mx = 5.2, my = 6.2;
    if (p.mouth > 0) {
      c.fillStyle = P.flash ? P.line : '#1a0a12';
      c.beginPath(); c.ellipse(mx + 0.5, my + 0.5, 1.8 + p.mouth * 1.6, 1.2 + p.mouth * 2.2, 0.3, 0, Math.PI * 2); c.fill();
    }
    if (p.prob < 0.15) {
      c.strokeStyle = P.prob; c.lineWidth = 1.5; c.beginPath(); c.moveTo(mx, my);
      const loose = 1 + p.mouth * 0.6;
      for (let i = 0; i <= 15; i++) {
        const a = -1.4 + i * 0.52, r = (4.8 - i * 0.26) * loose;
        c.lineTo(mx + 2.4 + Math.cos(a) * r, my + 4.6 + Math.sin(a) * r);
      }
      c.stroke();
    } else {
      const L = 8 + p.prob * 42, a = p.probAng;
      const ca = Math.cos(a), sa = Math.sin(a), tx = mx + ca * L, ty = my + sa * L;
      R.poly(c, [mx - sa * 1.9, my + ca * 1.9, tx, ty, mx + sa * 1.9, my - ca * 1.9], P.prob, P.line, 0.8);
      if (!P.flash) {
        c.strokeStyle = P.probHi; c.lineWidth = 0.6;
        c.beginPath(); c.moveTo(mx + ca * 3, my + sa * 3 - 0.6); c.lineTo(mx + ca * L * 0.8, my + sa * L * 0.8 - 0.3); c.stroke();
      }
      if (p.glow > 0 && !P.flash) {
        c.save(); c.globalCompositeOperation = 'lighter';
        c.globalAlpha = 0.4 * p.glow; c.fillStyle = '#ff5a9a'; c.beginPath(); dot(c, tx, ty, 5 + p.glow * 7); c.fill();
        c.globalAlpha = 0.5 * p.glow; c.fillStyle = P.glow; c.beginPath(); dot(c, tx, ty, 3 + p.glow * 3.5); c.fill();
        c.globalAlpha = 0.9 * p.glow; c.fillStyle = '#ffffff'; c.beginPath(); dot(c, tx, ty, 1.5 + p.glow * 1.5); c.fill();
        // 十字の煌めき
        c.strokeStyle = '#fff4d8'; c.lineWidth = 1; c.globalAlpha = 0.7 * p.glow;
        const s = 5 + p.glow * 6 + Math.sin(t * 0.8) * 2;
        c.beginPath(); c.moveTo(tx - s, ty); c.lineTo(tx + s, ty); c.moveTo(tx, ty - s); c.lineTo(tx, ty + s); c.stroke();
        c.restore();
      }
    }
    // 悲鳴の音波
    if (p.sonic > 0 && !P.flash) {
      c.save(); c.globalCompositeOperation = 'lighter'; c.strokeStyle = '#ecd4ff'; c.lineWidth = 1.6;
      for (let i = 0; i < 3; i++) {
        const r = 7 + ((t * 1.6 + i * 9) % 27);
        c.globalAlpha = p.sonic * (1 - r / 36);
        c.beginPath(); c.arc(mx + 2, my, r, -0.75, 0.75); c.stroke();
      }
      c.restore();
    }
    c.restore();
  }

  /** 状態・技から描画パラメータを決める */
  function rosinePose(e, B) {
    const M = RM, mv = e.move, f = e.mf, st = e.state, t = e.animT + 13;
    const sw = Math.sin(t * 0.08);
    const p = {
      flap: Math.sin(t * 0.27), wBase: -2.25, wAmp: 0.6, hOff: -0.55, abd: 0.5,
      tilt: 0.08, head: 0, prob: 0, probAng: null, glow: 0, mouth: 0, sonic: 0,
      hipY: -38, bob: Math.sin(t * 0.09) * 2.2, alpha: 1, eyeGlow: 0, lane: 0, laneLock: false, dizzy: false,
      aF1: 32, aF2: 102, aB1: 20, aB2: 96,
      lF1: 16 + sw * 7, lF2: 0, lB1: 5 - sw * 7, lB2: 0,
    };
    p.lF2 = p.lF1 - 44; p.lB2 = p.lB1 - 38;
    const lie = () => {
      p.hipY = -5; p.tilt = -1.42; p.bob = 0; p.wBase = -1.45; p.wAmp = 0.05; p.hOff = 0.3; p.head = 0.2;
      p.lF1 = 84; p.lF2 = 94; p.lB1 = 78; p.lB2 = 88; p.aF1 = 150; p.aF2 = 165; p.aB1 = 140; p.aB2 = 150; p.abd = -0.12;
    };
    const kneel = () => {
      p.hipY = -17; p.bob = 0; p.tilt = 0.34; p.head = 0.4; p.wBase = -3.12; p.wAmp = 0.08; p.flap = Math.sin(t * 0.33);
      p.lF1 = 64; p.lF2 = -84; p.lB1 = 48; p.lB2 = -98; p.aF1 = 10; p.aF2 = 24; p.aB1 = 4; p.aB2 = 18; p.prob = 0; p.abd = 0.75;
    };
    if (mv === M.stab) {
      if (f < 16) { const k = f / 16; p.tilt = -0.25 * k; p.prob = k; p.glow = k * 0.5; p.aF1 = -10; p.aF2 = 30; p.flap = Math.sin(t * 0.5); }
      else if (f < 27) { p.tilt = 0.6; p.prob = 1; p.glow = 0.6; p.wBase = -2.8; p.wAmp = 0.15; p.aF1 = 70; p.aF2 = 88; p.lF1 = -30; p.lF2 = -60; p.lB1 = -40; p.lB2 = -70; }
      else { const k = Math.min(1, (f - 27) / 16); p.tilt = 0.6 * (1 - k); p.prob = 1 - k; }
    } else if (mv === M.dive) {
      if (f < 30) { p.tilt = 0.3; p.flap = Math.sin(t * 0.55); }
      else if (f < 75) {
        const k = Math.min(1, (f - 30) / 18);
        p.prob = Math.max(0.2, k); p.glow = 0.3 + 0.7 * k * (0.75 + 0.25 * Math.sin(t * 0.9));
        p.tilt = -0.22 * k; p.head = -0.1 * k; p.flap = Math.sin(t * 0.9) * 0.9; p.wBase = -2.0; p.wAmp = 0.5;
        p.aF1 = -34; p.aF2 = 6; p.aB1 = -44; p.aB2 = -4;
        p.lane = Math.min(1, (f - 30) / 10); p.laneLock = f >= 66; p.mouth = f < 46 ? 0.9 : 0; p.eyeGlow = k * 0.6;
        p.lF1 = 30; p.lF2 = -10; p.lB1 = 20; p.lB2 = -18;
      } else {
        p.prob = 1; p.glow = 1; p.tilt = 1.05; p.wBase = -3.0; p.wAmp = 0.12; p.flap = Math.sin(t * 1.1); p.bob = 0;
        p.lF1 = -62; p.lF2 = -80; p.lB1 = -72; p.lB2 = -88;
        p.aF1 = -40; p.aF2 = -20; p.aB1 = -52; p.aB2 = -30;
      }
    } else if (mv === M.powder) {
      if (f < 28) { const k = f / 28; p.wBase = -1.72; p.wAmp = 0.12; p.flap = Math.sin(t * 0.25); p.eyeGlow = k; p.tilt = -0.18 * k; p.aF1 = 120; p.aF2 = 150; p.aB1 = 110; p.aB2 = 140; }
      else if (f < 40) { p.wBase = -3.2; p.wAmp = 0; p.tilt = 0.28; p.eyeGlow = 1 - (f - 28) / 12; p.aF1 = 60; p.aF2 = 60; }
      else { const k = (f - 40) / 24; p.wBase = U.lerp(-3.2, -2.25, k); p.wAmp = 0.6 * k; p.tilt = 0.28 * (1 - k); }
    } else if (mv === M.summon) {
      p.wBase = -1.9; p.wAmp = 0.22; p.flap = Math.sin(t * 0.14); p.eyeGlow = f < 34 ? 0.5 + 0.5 * Math.sin(t * 0.5) : Math.max(0, 1 - (f - 34) / 16);
      p.aF1 = 150; p.aF2 = 172; p.aB1 = 138; p.aB2 = 160; p.head = -0.25; p.tilt = -0.1;
    } else if (mv === M.scream) {
      if (f < 28) { const k = f / 28; p.tilt = -0.36 * k; p.head = -0.3 * k; p.mouth = k; p.sonic = k * 0.6; p.aF1 = 70; p.aF2 = 40; p.aB1 = 60; p.aB2 = 30; p.flap = Math.sin(t * 1.2); p.wAmp = 0.3; p.wBase = -2.0; }
      else if (f < 54) { p.tilt = -0.12; p.head = 0.05; p.mouth = 1; p.sonic = 1; p.aF1 = 95; p.aF2 = 85; p.aB1 = 85; p.aB2 = 75; p.wBase = -2.5; p.wAmp = 0.1; }
      else { const k = (f - 54) / 20; p.mouth = 1 - k; p.tilt = -0.12 * (1 - k); }
    } else if (st === 'stun') {
      kneel(); p.dizzy = true;
    } else if (st === 'hurt') {
      p.tilt = -0.32; p.head = -0.25; p.flap = Math.sin(t * 0.9); p.aF1 = -20; p.aF2 = 60;
      if (e.z < 2) { kneel(); p.tilt = -0.1; p.head = -0.2; }
    } else if (st === 'fall') {
      // 撃ち落とされて仰向けに落ちる
      p.hipY = -30; p.tilt = -0.45 - Math.min(0.8, e.st * 0.05); p.head = -0.3; p.wBase = -1.9; p.wAmp = 0.5; p.flap = Math.sin(t * 1.3);
      p.lF1 = 50; p.lF2 = 20; p.lB1 = 36; p.lB2 = 6; p.aF1 = 130; p.aF2 = 150; p.aB1 = 120; p.aB2 = 140; p.abd = 0.2;
    } else if (st === 'down' || st === 'dead') {
      lie();
      if (st === 'dead') p.alpha = Math.max(0, 1 - Math.max(0, e.st - 8) / 80);
    } else if (st === 'getup') {
      const k = Math.min(1, e.st / (e.getupTime || 18));
      kneel(); p.dizzy = false;
      p.tilt = U.lerp(-1.42, 0.34, k); p.hipY = U.lerp(-5, -17, k); p.wBase = U.lerp(-1.45, -3.12, k); p.abd = U.lerp(-0.12, 0.75, k);
    } else if (e.z < 3 && !B.fly) {
      kneel(); // 着地中（落下直後）
    }
    if (p.probAng == null) p.probAng = 0.14 - p.tilt - p.head;
    return p;
  }

  /** 急降下の予告: 突進の軌道を地面に帯で示す */
  function drawLane(c, e, k, lock) {
    const gy = BK.sy(e.y, 0), x0 = BK.sx(e.x), x1 = e.face > 0 ? BK.W + 20 : -20;
    const lx = Math.min(x0, x1), lw = Math.abs(x1 - x0);
    const blink = lock && ((BK.frame >> 2) & 1);
    c.save();
    c.globalCompositeOperation = 'lighter';
    c.globalAlpha = Math.min(1, (0.08 + 0.14 * k) * (blink ? 1.9 : 1));
    c.fillStyle = '#ff6aa8';
    c.fillRect(lx, gy - 15, lw, 30);
    c.globalAlpha = 0.25 + 0.4 * k;
    c.fillRect(lx, gy - 1.5, lw, 3);
    c.strokeStyle = '#ffc4de'; c.lineWidth = 2; c.globalAlpha = 0.3 + 0.4 * k;
    const sp = 46, off = (BK.frame * 3) % sp;
    c.beginPath();
    for (let d = off + 20; d < lw; d += sp) {
      const x = x0 + e.face * d;
      c.moveTo(x - e.face * 8, gy - 9); c.lineTo(x, gy); c.lineTo(x - e.face * 8, gy + 9);
    }
    c.stroke();
    c.restore();
  }

  function drawRosine(c, e) {
    const B = rb(e), p = rosinePose(e, B);
    const P = flashing(e) ? RC_W : (B.rage ? RC_RAGE : RC);
    const t = e.animT;
    if (p.lane > 0) drawLane(c, e, p.lane, p.laneLock);
    const sx = BK.sx(e.x), sy = BK.sy(e.y, e.z);
    c.save();
    c.translate(Math.round(sx * 2) / 2, Math.round((sy + p.bob) * 2) / 2);
    c.scale(e.face * RS, RS);
    if (p.alpha < 1) c.globalAlpha = p.alpha;
    c.lineJoin = 'round'; c.lineCap = 'round';
    c.translate(0, p.hipY);
    const fa = p.wBase + p.flap * p.wAmp;
    const ha = fa + p.hOff + Math.sin(t * 0.27 - 0.6) * p.wAmp * 0.25;
    // --- 奥（翅・腕）
    c.save(); c.rotate(p.tilt);
    rWing(c, -1, -26, ha + 0.12, 40, P, true, true, 0);
    rWing(c, -1, -27, fa + 0.14, 68, P, true, false, p.eyeGlow * 0.5);
    rArm(c, P, 0, -26, p.aB1, p.aB2, true);
    rAbdomen(c, P, t, p.abd);
    c.restore();
    // --- 脚
    rLeg(c, P, -1.5, 0, p.lB1, p.lB2, true);
    rLeg(c, P, 1.5, 1, p.lF1, p.lF2, false);
    // --- 胴・頭・手前の翅
    c.save(); c.rotate(p.tilt);
    rHair(c, P, t);
    rTorso(c, P);
    rCollar(c, P);
    rHead(c, P, p, t);
    rArm(c, P, 4.5, -25, p.aF1, p.aF2, false);
    rWing(c, -5, -21, ha, 43, P, false, true, p.eyeGlow * 0.6);
    rWing(c, -5, -22, fa, 72, P, false, false, p.eyeGlow);
    if (p.dizzy && !P.flash) {
      // 目を回している: 頭上を回る鱗粉の星
      c.fillStyle = '#fff2c0';
      for (let i = 0; i < 3; i++) {
        const a = t * 0.16 + i * 2.1, x = 12 + Math.cos(a) * 11, y = -60 + Math.sin(a) * 3.5, s = 2.4;
        c.beginPath(); c.moveTo(x, y - s); c.lineTo(x + s * 0.35, y - s * 0.35); c.lineTo(x + s, y); c.lineTo(x + s * 0.35, y + s * 0.35);
        c.lineTo(x, y + s); c.lineTo(x - s * 0.35, y + s * 0.35); c.lineTo(x - s, y); c.lineTo(x - s * 0.35, y - s * 0.35); c.closePath(); c.fill();
      }
    }
    c.restore();
    c.restore();
  }

  // ---------------------------------------------------------- 鱗粉の雲
  function powderDraw(c, sx, sy, p) {
    const fade = Math.min(1, p.t / 12, p.life / 30), t = p.t;
    const gy = BK.sy(p.y, 0);
    c.save();
    c.globalAlpha = 0.2 * fade; c.fillStyle = '#9c80c8';
    c.beginPath(); c.ellipse(sx, gy, 32, 9, 0, 0, Math.PI * 2); c.fill();
    for (let i = 0; i < 6; i++) {
      const a = i * 1.05 + t * 0.02 * (i % 2 ? 1 : -1);
      const r = 15 + (i % 3) * 3 + Math.sin(t * 0.07 + i) * 2;
      c.globalAlpha = 0.2 * fade; c.fillStyle = i % 2 ? '#c6b0e6' : '#e6dcae';
      c.beginPath(); c.arc(sx + Math.cos(a) * 15, sy + Math.sin(a) * 9 - (i % 2) * 7, r, 0, Math.PI * 2); c.fill();
    }
    c.globalAlpha = 0.85 * fade; c.fillStyle = '#fff6d6';
    for (let i = 0; i < 8; i++) {
      if (((t >> 2) + i) % 3 === 0) continue;
      const a = i * 2.4 + t * 0.05, rr = 8 + (i * 5) % 20;
      c.fillRect(sx + Math.cos(a) * rr * 1.3 - 1, sy + Math.sin(a) * rr * 0.7 - 1, 2, 2);
    }
    c.restore();
  }
  function spawnPowder(e, tx, ty) {
    const x0 = e.x + e.face * 8, y0 = e.y, z0 = e.z + 50, N = 40;
    BK.game.addProjectile(new BK.Projectile({
      x: x0, y: y0, z: z0, vx: (tx - x0) / N, vy: (ty - y0) / N, vz: (26 - z0) / N,
      w: 56, h: 56, depth: 16, team: 'enemy', owner: e, dmg: 4, kb: 'light', push: 0.4, stop: 1, life: 230, pierce: 99,
      noShadow: true, fx: 'none', sfx: 'none', dirAway: true, harmless: true,
      tick(p) {
        if (ownerGone(p)) return;
        if (p.t === N) { p.vx = 0; p.vy = 0; p.vz = 0; }
        if (p.t === 12) p.harmless = false;
        if (p.life < 24) p.harmless = true;
        if (p.t % 34 === 0) p.hit.clear();
        if (p.t % 9 === 0 && p.life > 30) BK.fx.add({ type: 'dot', x: p.x + U.rand(-22, 22), y: p.y + U.rand(-6, 6), z: p.z + U.rand(-12, 18), vz: U.rand(0.2, 0.7), life: U.randi(22, 36), col: U.choose(SCALE_COLS), size: U.rand(1, 1.8), drag: 0.97 });
      },
      onHit(p, t) {
        for (let i = 0; i < 5; i++) BK.fx.add({ type: 'smoke', x: t.x + U.rand(-8, 8), y: t.y, z: t.z + U.rand(30, 70), vz: U.rand(0.3, 1), life: U.randi(16, 26), size: U.rand(4, 7), col: 'rgba(170,140,210,0.4)', drag: 0.92 });
      },
      drawFn: powderDraw,
    }));
  }

  // ---------------------------------------------------------- 技
  const RM = {
    // 急降下突撃: 画面端へ → 滞空・口吻の輝き・金切り声・軌道表示（45F）→ 画面を横切る突進 → 墜落して目を回す
    dive: {
      dur: 180, armor: true,
      hits: [{ f: [75, 179], x: [-16, 60], z: [-8, 66], d: 15, dmg: 18, kb: 'down', push: 6, lift: 5, stop: 8, sfx: 'slash' }],
      onStart(e) {
        const B = rb(e), h = e.hero;
        B.diveN = 0; B.sinceDive = 0;
        const edge = s => (s > 0 ? BK.cam.x + BK.W - 86 : BK.cam.x + 86);
        let side = U.sign(e.x - (h ? h.x : e.x)) || 1;
        if (h && Math.abs(edge(side) - h.x) < 130) side = -side;
        B.diveX = edge(side);
      },
      onFrame(e, f) {
        const B = rb(e), h = e.hero;
        if (f < 30) {
          B.tz = 30; B.hk = 0.1;
          e.vx = U.clamp((B.diveX - e.x) * 0.14, -7, 7);
          if (h) { e.vy = U.clamp((h.y - e.y) * 0.1, -2.4, 2.4); e.face = U.sign(h.x - e.x) || e.face; }
          return;
        }
        if (f === 30) {
          e.face = U.sign(BK.cam.x + BK.W / 2 - e.x) || e.face;   // 画面の反対側へ向く
          BK.audio.sfx('spirit', { pitch: 2.3, vol: 0.9 }); BK.audio.sfx('magic', { pitch: 1.7, vol: 0.5 });
          B.tz = 26;
        }
        if (f < 75) {
          airDrag(e, 0.8);
          if (f < 66 && h) e.vy = U.clamp((h.y - e.y) * 0.08, -1.1, 1.1); else e.vy = 0;
          if (f === 66) BK.audio.sfx('swing', { pitch: 0.55 });
          return;
        }
        if (f === 75) { BK.audio.sfx('swingHeavy', { pitch: 1.4 }); BK.audio.sfx('spirit', { pitch: 2.8, vol: 0.6 }); BK.fx.shake(2, 6); }
        e.vx = e.face * 12.5; e.vy = 0;
        if (f % 2 === 0) scales(e.x - e.face * 20, e.y, e.z + 60, 1, 14);
        const done = e.face > 0 ? e.x > BK.cam.x + BK.W - 110 : e.x < BK.cam.x + 110;
        if (done || f >= 170) {
          if (B.rage && B.diveN === 0) {
            // 激昂: 折り返してもう一往復（短い溜め。軌道表示は出る）
            B.diveN = 1; e.face = -e.face; e.vx = 0; e.hitIds.clear();
            e.mf = 48;
            BK.audio.sfx('spirit', { pitch: 2.5, vol: 0.8 });
            return;
          }
          // 墜落して目を回す（反撃の好機）
          e.endMove();
          e.state = 'air'; e.vx = e.face * 1.6; e.vz = -1.5;
          B.fly = false; B.stunT = B.rage ? 64 : 80; B.stunFx = false; B.cd = 30;
          BK.audio.sfx('thud', { pitch: 1.2 });
        }
      },
    },
    // 口吻の突き（近距離）: 身を引いて口吻を伸ばす（16F）→ 突進して突き刺す
    stab: {
      dur: 46,
      hits: [{ f: [17, 23], x: [4, 68], z: [-10, 72], d: 14, dmg: 12, kb: 'heavy', push: 3.5, sfx: 'slash' }],
      sfx: [[2, 'spirit', { pitch: 2.6, vol: 0.4 }], [16, 'swing', { pitch: 1.3 }]],
      onFrame(e, f) {
        const B = rb(e);
        if (f === 0) B.tz = 28;
        if (f < 14) { e.vx = -e.face * 0.9; e.vy *= 0.85; }
        else if (f === 16) e.vx = e.face * 6.5;
        else if (f > 24) airDrag(e, 0.86);
      },
    },
    // 鱗粉: 翅を高く掲げる（28F）→ 打ち下ろして毒の雲を 2〜3 つ
    powder: {
      dur: 64, armor: true,
      sfx: [[2, 'spirit', { pitch: 2.8, vol: 0.5 }], [30, 'fire', { pitch: 1.8, vol: 0.6 }]],
      onFrame(e, f) {
        const B = rb(e), h = e.hero;
        if (f === 0) B.tz = 62;
        airDrag(e, 0.9);
        if (f < 28 && f % 3 === 0) scales(e.x - e.face * 22, e.y, e.z + 95, 1, 26);
        if (f === 30 && h && BK.game) {
          const n = B.rage ? 3 : 2;
          for (let i = 0; i < n; i++) {
            const tx = scrX(h.x + (i - (n - 1) / 2) * 66 + U.rand(-10, 10), 30);
            spawnPowder(e, tx, clampY(h.y + U.rand(-14, 14)));
          }
          scales(e.x, e.y, e.z + 60, 10, 30);
        }
      },
    },
    // 音波の悲鳴: 身を反らし口を開く（28F）→ 地を這う音の輪（激昂時は2重）
    scream: {
      dur: 74, armor: true,
      sfx: [[4, 'spirit', { pitch: 3.2, vol: 0.9 }]],
      onFrame(e, f) {
        const B = rb(e);
        if (f === 0) B.tz = 34;
        airDrag(e, 0.88);
        if (f === 28 || (B.rage && f === 46)) {
          groundRing(e, { kind: 'sonic', dmg: 12, spd: 4.4, life: 70 });
          BK.audio.sfx('spirit', { pitch: 3.6, vol: 0.8 }); BK.audio.sfx('hit', { pitch: 0.5, vol: 0.6 });
          BK.fx.shake(3, 10);
          BK.fx.ring(e.x, e.y, e.z + 70, 50, '#f0d8ff', 14);
        }
      },
    },
    // 眷属召喚: 翅を広げ目玉模様が輝く（32F）→ 蛾の妖精もどきを 2〜3 体
    summon: {
      dur: 62, armor: true,
      sfx: [[2, 'spirit', { pitch: 1.5, vol: 0.8 }], [32, 'magic', { pitch: 0.9 }]],
      onFrame(e, f) {
        const B = rb(e);
        if (f === 0) B.tz = 70;
        airDrag(e, 0.9);
        if (f < 30 && f % 4 === 0) BK.fx.add({ type: 'glow', x: e.x - e.face * U.rand(10, 40), y: e.y, z: e.z + U.rand(70, 120), size: U.rand(8, 14), life: 14, col: '#ffcf70' });
        if (f === 32) {
          B.summonCd = B.rage ? 600 : 780;
          const g = BK.game;
          if (!g || !BK.enemyTypes.moth) return;
          const n = B.rage ? 3 : 2;
          for (let i = 0; i < n; i++) {
            const m = g.spawnEnemy('moth', { x: scrX(e.x - e.face * (14 + i * 20) + U.rand(-8, 8), 30), y: clampY(e.y + (i - (n - 1) / 2) * 28) });
            m.z = e.z + 50 + i * 8; m.vz = 0;
            if (m.ai) m.ai.cd = 40 + i * 25;
            scales(m.x, m.y, m.z + 20, 6, 12);
          }
        }
      },
    },
  };

  function rosineUpdate(e, game) {
    const B = rb(e);
    if (e.dead) {
      e.superArmor = 0; B.fly = false;
      if (e.state === 'dead' && e.st % 3 === 0 && e.st < 80) scales(e.x - e.face * 10, e.y, U.rand(4, 30), 2, 30);
      return;
    }
    if (B.stunT > 0) B.stunT--;
    if (B.dmgT > 0 && --B.dmgT === 0) B.dmgN = 0;
    if (!B.rage && e.hp <= e.maxHp * 0.5) {
      B.rage = true;
      BK.audio.sfx('spirit', { pitch: 1.7 });
      BK.fx.ring(e.x, e.y, e.z + 50, 90, '#ff9ac0', 20); BK.fx.flash('#ffd8e8', 6);
    }
    flyUpdate(e, B);
    e.x = scrX(e.x, 56); // 翅まで画面に収まるように
    // 翅からこぼれる鱗粉
    if (e.z > 5 && e.animT % 10 === 0) BK.fx.add({ type: 'dot', x: e.x - e.face * U.rand(0, 30), y: e.y + U.rand(-4, 4), z: e.z + U.rand(40, 90), vx: U.rand(-0.3, 0.3), vz: U.rand(-0.6, -0.2), life: U.randi(30, 50), col: U.choose(SCALE_COLS), size: U.rand(1, 1.8), drag: 0.98 });
  }

  function rosineThink(e, game) {
    const B = rb(e), h = game.hero;
    B.t++;
    if (B.stunT > 0) {
      e.state = 'stun'; B.fly = false;
      if (!B.stunFx && e.z <= 0) { B.stunFx = true; BK.fx.dust(e.x, e.y, 12, 'rgba(190,180,200,0.5)'); BK.fx.shake(3, 8); }
      return;
    }
    if (!B.fly) {
      // 飛び立つ
      B.fly = true; B.tz = B.baseZ; B.hk = 0.06; B.cd = Math.max(B.cd, 36);
      BK.fx.dust(e.x, e.y, 8, 'rgba(200,190,210,0.4)'); BK.audio.sfx('jump', { pitch: 0.7 });
      scales(e.x, e.y, 30, 6, 20);
    }
    e.state = 'idle';
    if (!h || h.dead) { airDrag(e, 0.92); return; }
    B.hk = e.z < B.baseZ - 12 ? 0.06 : 0.08;
    const dx = h.x - e.x, adx = Math.abs(dx), ady = Math.abs(h.y - e.y);
    const side = U.sign(e.x - h.x) || 1;
    // 滞空中に殴られ続けたら、高く舞い上がって主人公の頭上を越え反対側へ逃れる
    if (B.evade > 0) {
      B.evade--; B.tz = 100; B.hk = 0.1;
      e.vx = U.approach(e.vx, U.clamp((B.evX - e.x) * 0.08, -4.2, 4.2), 0.3);
      e.vy = U.approach(e.vy, U.clamp((h.y - e.y) * 0.05, -1.2, 1.2), 0.1);
      e.face = U.sign(dx) || e.face;
      if (B.evade === 0) B.cd = Math.min(B.cd, 6);
      return;
    }
    if (B.dmgN >= 8 && e.z > 20) {
      B.dmgN = 0; B.evade = 54;
      let ex = h.x - side * 150;
      if (ex < BK.cam.x + 80 || ex > BK.cam.x + BK.W - 80) ex = h.x + side * 150;
      B.evX = scrX(ex, 80);
      BK.audio.sfx('spirit', { pitch: 2.1, vol: 0.7 }); scales(e.x, e.y, e.z + 60, 8, 24);
      return;
    }
    B.tz = B.baseZ + Math.sin(B.t * 0.045) * 7;
    if (B.t % 170 === 1) B.pref = U.rand(100, 170);
    steer(e, scrX(h.x + side * B.pref, 80), clampY(h.y + Math.sin(B.t * 0.023) * 22), 2.3, 1.3, 1.2);
    e.face = U.sign(dx) || e.face;
    B.sinceDive++;
    if (B.summonCd > 0) B.summonCd--;
    if (B.cd > 0) { B.cd--; return; }
    if (e.z < 20) return; // 上昇中
    const list = [];
    if (adx < 78 && ady < 14) list.push([4, RM.stab]);
    list.push([B.sinceDive > 300 ? 9 : 2.2, RM.dive]);
    if (adx > 50) list.push([2, RM.powder]);
    if (B.summonCd <= 0 && countAlive(game, 'moth') < 2) list.push([2.2, RM.summon]);
    list.push([adx < 130 ? 2.6 : 1.2, RM.scream]);
    startAtk(e, B, pick(list, B.last), B.rage ? U.randi(30, 50) : U.randi(46, 72));
  }

  BK.registerEnemy({
    id: 'rosine', name: 'ロシーヌ', title: '霧の森の女王', boss: true,
    hp: 600, poise: 70, w: 46, h: 108, weight: 1.4, speed: 2.2, score: 5000, bossBonus: 40000,
    grabbable: false, drop: null, bloodCol: '#c9b6e8', dieSfx: 'spirit', diePitch: 1.3, shadowR: 24,
    draw: drawRosine,
    moves: RM,
    onSpawn(e) {
      const B = rb(e);
      bossCommon(e);
      e.deadTime = 110; e.downTime = 46;
      e.z = 200; e.state = 'idle'; B.fly = true; B.tz = B.baseZ; B.hk = 0.045; B.cd = 90;
      e.onDamaged = () => { B.dmgN++; B.dmgT = 100; };
      BK.audio.sfx('spirit', { pitch: 1.4 });
    },
    update: rosineUpdate,
    think: rosineThink,
    onDie(e) {
      rb(e).fly = false;
      scales(e.x, e.y, e.z + 50, 16, 36);
      BK.fx.ring(e.x, e.y, e.z + 50, 80, '#e8d4ff', 24);
    },
  });

  // ================================================================
  //  モズグス mozgus ── 異端審問官
  // ================================================================
  const MZC = {
    skin: '#c49c80', skinDark: '#9a765e', robe: '#3e1c20', robeDark: '#28100f', robeHi: '#62302f', trim: '#b8923c',
    stole: '#d8d0bc', stoleDark: '#a8a08c', pants: '#2a1c1a', pantsDark: '#1c1210', boot: '#1e1614', bootDark: '#140e0c',
    stone: '#8e897c', stoneDark: '#5e594f', stoneHi: '#bab4a4', rope: '#8a6e44', lip: '#8e5e4e', brow: '#5e4234', eye: '#140c0a',
    wing: '#efe8da', wingDark: '#b9b09e', wingLine: 'rgba(80,70,50,0.55)', gold: '#e4c070', halo: '#ffe6a0',
    line: 'rgba(12,6,6,0.9)',
  };
  const MZC_ANGEL = Object.assign({}, MZC, {
    skin: '#e8dfcf', skinDark: '#bcb09c', robe: '#cbc1ab', robeDark: '#9a917e', robeHi: '#f2ebdc', trim: '#d8b458', wing: '#f6f2e8', wingDark: '#c4bba8',
    stole: '#f6f0e2', stoleDark: '#c8c0ac', pants: '#9e9686', pantsDark: '#7e7668', boot: '#6c645a', bootDark: '#554e46',
    lip: '#b0a088', brow: '#9a8c76', eye: '#fff4c8',
  });

  const MZ_RES = 1.55 * 2.2; // モズグスのスプライト解像度（リグ倍率 × 最大描画倍率）
  function mb(e) {
    return e.bs || (e.bs = { t: 0, phase: 1, form: 'human', fly: false, tz: 0, hk: 0.08, cd: 40, grabCd: 0, summoned: false, streak: 0, streakT: 0, stunT: 0, intro: 0, formAt: -99, hard: false, farT: 0, pref: 120, step: 0, last: null, tx: 0, ty: 0, dvz: 0, evade: 0, evX: 0, next: null });
  }

  /** 石版（+x 方向に x0〜x1、幅 wid）。archEnd: 丸い頭を x1 側に描く */
  function drawTablet(c, col, x0, x1, wid, archEnd, tint) {
    const w2 = wid / 2;
    c.beginPath();
    if (archEnd) { c.moveTo(x0, -w2); c.lineTo(x1 - w2, -w2); c.arc(x1 - w2, 0, w2, -Math.PI / 2, Math.PI / 2); c.lineTo(x0, w2); }
    else { c.moveTo(x1, -w2); c.lineTo(x0 + w2, -w2); c.arc(x0 + w2, 0, w2, -Math.PI / 2, Math.PI / 2, true); c.lineTo(x1, w2); }
    c.closePath();
    c.fillStyle = col('stone'); c.fill(); c.strokeStyle = col('line'); c.lineWidth = 1.3; c.stroke();
    if (tint) return;
    // 面取りの陰
    c.fillStyle = col('stoneDark'); c.globalAlpha = 0.55;
    c.fillRect(Math.min(x0, x1) + 2, w2 - 4, Math.abs(x1 - x0) - w2 - 2, 3);
    c.globalAlpha = 1;
    // 丸い頭の紋章（車輪十字）
    const ax = archEnd ? x1 - w2 : x0 + w2;
    c.strokeStyle = col('stoneDark'); c.lineWidth = 1.4;
    c.beginPath(); dot(c, ax, 0, w2 * 0.48); c.stroke();
    c.beginPath(); c.moveTo(ax - w2 * 0.48, 0); c.lineTo(ax + w2 * 0.48, 0); c.moveTo(ax, -w2 * 0.48); c.lineTo(ax, w2 * 0.48); c.stroke();
    // 刻まれた戒律の文字列
    c.lineWidth = 1.1; c.beginPath();
    const dir = archEnd ? -1 : 1, from = archEnd ? x1 - w2 * 1.7 : x0 + w2 * 1.7, to = archEnd ? x0 + 3 : x1 - 3;
    let row = 0;
    for (let x = from; dir > 0 ? x < to : x > to; x += dir * 4.2, row++) {
      const a = -w2 * 0.66, b = w2 * 0.66, gap = ((row * 7) % 5) - 2;
      c.moveTo(x, a); c.lineTo(x, gap - 1.5); c.moveTo(x, gap + 1.5); c.lineTo(x, b - (row % 3) * 2);
    }
    c.stroke();
    // ひびと明るい縁
    c.strokeStyle = 'rgba(20,14,10,0.6)'; c.lineWidth = 0.9;
    c.beginPath(); c.moveTo((x0 + x1) / 2, -w2); c.lineTo((x0 + x1) / 2 + 3, -w2 * 0.4); c.lineTo((x0 + x1) / 2 - 1, -w2 * 0.1); c.stroke();
    c.strokeStyle = col('stoneHi'); c.lineWidth = 1; c.globalAlpha = 0.7;
    c.beginPath(); c.moveTo(x0 + 1, -w2 + 1.5); c.lineTo(x1 - w2, -w2 + 1.5); c.stroke();
    c.globalAlpha = 1;
  }

  /** 羽根の翼（付け根 x,y、方向 ang[rad]、長さ L）。前縁は +y 側、羽根先は -y 側。
   *  翼端側ほど長い風切羽が垂れ、付け根側は短い（横から見た天使の翼） */
  const WING_TIPS = [[1.12, -0.12], [1.06, -0.44], [0.96, -0.7], [0.84, -0.86], [0.7, -0.84], [0.56, -0.74], [0.42, -0.62], [0.28, -0.5], [0.14, -0.36]];
  /** 天使の翼の色（スプライト用）: tint 指定時は被弾フラッシュの白 */
  const angelCol = tint => (tint ? (k => (k === 'line' ? 'rgba(0,0,0,0.3)' : tint)) : (k => MZC_ANGEL[k] || R.DEFAULT_COLORS[k] || '#f0f'));
  function featherWing(c, x, y, ang, L, far, tint) {
    if (L < 3) return;
    const L0 = far ? 56 : 63, W0 = L0 * 0.55;
    const sp = sprite('fw' + (far ? 'f' : 'n') + (tint || ''), L0 * 1.18 + 18, W0 * 1.5 + 18, 9, W0 * 1.02 + 10, MZ_RES, sc => featherWingPaint(sc, angelCol(tint), L0, far, tint));
    c.save(); c.translate(x, y); c.rotate(ang);
    if (L !== L0) c.scale(L / L0, L / L0);
    blit(c, sp);
    c.restore();
  }
  function featherWingPaint(c, col, L, far, tint) {
    const W = L * 0.55, line = col('line');
    const outline = () => {
      c.beginPath();
      c.moveTo(0, 4);
      c.quadraticCurveTo(L * 0.3, W * 0.34, L * 0.56, W * 0.2);    // 前縁（手首へ）
      c.quadraticCurveTo(L * 0.86, W * 0.06, L * 1.12, -W * 0.12);  // 初列風切の先端
      let px = L * 1.12, py = -W * 0.12;
      for (let i = 1; i < WING_TIPS.length; i++) {
        const nx = L * WING_TIPS[i][0], ny = W * WING_TIPS[i][1];
        // 羽根と羽根の間の切れ込み → 次の羽根先（尖らせる）
        const mx = (px + nx) / 2, my = (py + ny) / 2;
        const ix = mx + (L * 0.5 - mx) * 0.16, iy = my + (0 - my) * 0.16;
        c.quadraticCurveTo(px - (px - ix) * 0.2, py - (py - iy) * 0.7, ix, iy);
        c.quadraticCurveTo(nx + (ix - nx) * 0.1, ny + (iy - ny) * 0.5, nx, ny);
        px = nx; py = ny;
      }
      c.quadraticCurveTo(L * 0.04, -W * 0.3, 0, -4);
      c.closePath();
    };
    outline();
    c.fillStyle = far ? col('wingDark') : col('wing'); c.fill();
    c.strokeStyle = line; c.lineWidth = 1.2; c.stroke();
    if (!tint) {
      // 風切羽の軸
      c.strokeStyle = col('wingLine'); c.lineWidth = 0.9; c.beginPath();
      for (const [tx, ty] of WING_TIPS) { c.moveTo(L * tx * 0.62, W * 0.1); c.lineTo(L * tx * 0.98, W * ty * 0.92); }
      c.stroke();
      // 雨覆（前縁寄りの短い羽根の列）
      c.fillStyle = far ? col('wing') : '#ffffff';
      c.globalAlpha = far ? 0.22 : 0.55;
      c.beginPath(); c.moveTo(2, 2);
      c.quadraticCurveTo(L * 0.3, W * 0.3, L * 0.56, W * 0.18); c.quadraticCurveTo(L * 0.76, W * 0.08, L * 0.9, -W * 0.02);
      for (let i = 1; i <= 7; i++) {
        const k = i / 7, x2 = U.lerp(L * 0.9, L * 0.04, k), y2 = -W * (0.08 + Math.sin(k * Math.PI * 0.8) * 0.3);
        c.quadraticCurveTo(x2 + 5, y2 - 6, x2, y2);
      }
      c.closePath(); c.fill();
      c.globalAlpha = 1;
      // 金の前縁
      c.strokeStyle = col('gold'); c.lineWidth = 1.7;
      c.beginPath(); c.moveTo(1, 3.5); c.quadraticCurveTo(L * 0.3, W * 0.33, L * 0.56, W * 0.19); c.quadraticCurveTo(L * 0.86, W * 0.05, L * 1.1, -W * 0.11); c.stroke();
    }
  }
  /** 石版（スプライト）: 原点から +x 方向へ x0〜x0+42、丸い頭は +x 側 */
  function tabletAt(c, col, x0, tint) {
    const sp = sprite('tab' + (tint || ''), 50, 38, 4, 19, MZ_RES, sc => drawTablet(sc, tint ? col : (k => MZC[k] || R.DEFAULT_COLORS[k]), 0, 42, 30, true, tint));
    if (x0) { c.save(); c.translate(x0, 0); blit(c, sp); c.restore(); } else blit(c, sp);
  }

  // ---------------------------------------------------------- リグのパーツ
  function mzLeg(c, sp, col, hip, kn, ft, back) {
    const k = back ? col('pantsDark') : col('pants'), line = col('line');
    R.limb(c, hip.x, hip.y, kn.x, kn.y, sp.legW, sp.legW * 0.86, k, line);
    R.limb(c, kn.x, kn.y, ft.x, ft.y, sp.legW * 0.86, sp.legW * 0.7, k, line);
    R.poly(c, [ft.x - 5.5, ft.y - 5, ft.x + 9.5, ft.y - 3, ft.x + 11.5, ft.y + 1.8, ft.x - 5.5, ft.y + 1.8], back ? col('bootDark') : col('boot'), line);
  }
  function mzTorso(c, sp, col, sk, pose, opt) {
    const h = sk.hip, s = sk.sho, line = col('line'), tint = opt && opt.tint;
    const a = Math.atan2(s.y - h.y, s.x - h.x), nx = -Math.sin(a), ny = Math.cos(a);
    const P = (t, k) => [h.x + (s.x - h.x) * t + nx * k, h.y + (s.y - h.y) * t + ny * k];
    const ww = sp.waistW / 2, cw = sp.chestW / 2;
    c.beginPath();
    let q = P(-0.05, -ww); c.moveTo(q[0], q[1]);
    q = P(0.78, -cw); c.lineTo(q[0], q[1]);
    let q1 = P(1.18, -cw * 0.7); q = P(1.1, cw * 0.45); c.quadraticCurveTo(q1[0], q1[1], q[0], q[1]);   // 盛り上がった肩
    q1 = P(0.62, cw * 1.32); q = P(0.08, ww * 1.14); c.quadraticCurveTo(q1[0], q1[1], q[0], q[1]);   // 分厚い胸と腹
    q = P(-0.05, ww * 0.9); c.lineTo(q[0], q[1]);
    c.closePath();
    c.fillStyle = col('robe'); c.fill(); c.strokeStyle = line; c.lineWidth = 1.2; c.stroke();
    if (tint) return;
    // 背中の陰
    c.fillStyle = col('robeDark'); c.globalAlpha = 0.6;
    c.beginPath(); q = P(-0.05, -ww); c.moveTo(q[0], q[1]); q = P(0.78, -cw); c.lineTo(q[0], q[1]);
    q = P(0.9, -cw * 0.45); c.lineTo(q[0], q[1]); q = P(0.1, -ww * 0.35); c.lineTo(q[0], q[1]); c.closePath(); c.fill();
    c.globalAlpha = 1;
    // 衣の皺
    c.strokeStyle = 'rgba(0,0,0,0.32)'; c.lineWidth = 1;
    c.beginPath();
    q = P(0.85, cw * 0.2); q1 = P(0.45, cw * 0.5); let q2 = P(0.15, ww * 0.4); c.moveTo(q[0], q[1]); c.quadraticCurveTo(q1[0], q1[1], q2[0], q2[1]);
    q = P(0.8, -cw * 0.3); q1 = P(0.5, -cw * 0.1); q2 = P(0.2, -ww * 0.1); c.moveTo(q[0], q[1]); c.quadraticCurveTo(q1[0], q1[1], q2[0], q2[1]);
    c.stroke();
    // 前合わせの金の縁取り
    c.strokeStyle = col('trim'); c.lineWidth = 1.5;
    q = P(1.02, cw * 0.55); q1 = P(0.55, cw * 1.18); q2 = P(0.05, ww * 1.0);
    c.beginPath(); c.moveTo(q[0], q[1]); c.quadraticCurveTo(q1[0], q1[1], q2[0], q2[1]); c.stroke();
    // 石版を負う革帯
    if (pose.tab === 'S') {
      q = P(1.02, -cw * 0.2); q1 = P(0.05, ww * 1.0);
      R.limb(c, q[0], q[1], q1[0], q1[1], 3.4, 3.4, '#3a2618', line);
      const m = P(0.5, cw * 0.5);
      c.strokeStyle = '#8a8274'; c.lineWidth = 1.4; c.beginPath(); dot(c, m[0], m[1], 2.2); c.stroke();
    }
    // 白い立て襟
    q = P(1.0, -cw * 0.35); q1 = P(1.07, cw * 0.5);
    R.limb(c, q[0], q[1], q1[0], q1[1], 4.6, 4.6, col('stole'), line);
  }
  function mzRobe(c, sp, col, sk, pose, opt) {
    const h = sk.hip, s = sk.sho, line = col('line'), tint = opt && opt.tint;
    const a = Math.atan2(s.y - h.y, s.x - h.x), nx = -Math.sin(a), ny = Math.cos(a);
    const ww = sp.waistW / 2 + 1, cw = sp.chestW / 2;
    const kF = sk.knF, kB = sk.knB;
    const lowFoot = Math.min(sk.ftF.y, sk.ftB.y);
    const hem = Math.min(Math.max(kF.y, kB.y) + sp.shin * 0.55, lowFoot - 4);
    const fr = Math.max(kF.x + 7, kB.x + 7, h.x + ww + 3), bk = Math.min(kB.x - 7, kF.x - 7, h.x - ww - 4);
    const bx = h.x - nx * ww, by = h.y - ny * ww - 3, fx = h.x + nx * ww, fy = h.y + ny * ww - 3;
    // 裾の長い法衣
    c.beginPath();
    c.moveTo(bx, by); c.lineTo(fx, fy);
    c.quadraticCurveTo(fr + 3, (fy + hem) / 2, fr, hem);
    const n = 6;
    for (let i = 1; i <= n; i++) c.lineTo(U.lerp(fr, bk, i / n), hem + (i % 2 ? 2.6 : -0.8));
    c.quadraticCurveTo(bk - 3, (by + hem) / 2, bx, by);
    c.closePath();
    c.fillStyle = col('robe'); c.fill(); c.strokeStyle = line; c.lineWidth = 1.2; c.stroke();
    if (!tint) {
      c.strokeStyle = 'rgba(0,0,0,0.35)'; c.lineWidth = 1; c.beginPath();
      for (let i = 1; i <= 3; i++) { const x = U.lerp(bk, fr, i / 4); c.moveTo(U.lerp(bx, fx, i / 4), U.lerp(by, fy, i / 4) + 3); c.lineTo(x + (i - 2) * 2, hem - 1); }
      c.stroke();
      c.strokeStyle = col('trim'); c.lineWidth = 1.6;
      c.beginPath(); c.moveTo(fr, hem - 2); for (let i = 1; i <= n; i++) c.lineTo(U.lerp(fr, bk, i / n), hem - 2 + (i % 2 ? 2.6 : -0.8)); c.stroke();
    }
    // 縄の帯
    R.limb(c, bx, by + 2, fx, fy + 2, 3.6, 3.6, col('rope'), line);
    if (!tint) {
      c.strokeStyle = col('rope'); c.lineWidth = 2.2;
      c.beginPath(); c.moveTo(fx - nx * 3, fy + 3); c.quadraticCurveTo(fx + 2, fy + 10, fx - 1, fy + 18); c.stroke();
    }
    // 胸から垂れる白い頸垂帯（ストラ）と金の十字
    const tx = s.x + nx * cw * 0.45, ty = s.y + ny * cw * 0.45 + 2;
    const ex = Math.max(tx, fx) + 1, ey = hem - 5;
    R.poly(c, [tx - 3.6, ty, tx + 3.6, ty + 1, ex + 3.6, ey, ex - 3.6, ey], col('stole'), line);
    if (!tint) {
      const cx = U.lerp(tx, ex, 0.78), cy = U.lerp(ty, ey, 0.78);
      c.strokeStyle = col('trim'); c.lineWidth = 1.8;
      c.beginPath(); c.moveTo(cx, cy - 5); c.lineTo(cx, cy + 5); c.moveTo(cx - 3.2, cy - 1.5); c.lineTo(cx + 3.2, cy - 1.5); c.stroke();
      c.strokeStyle = col('stoleDark'); c.lineWidth = 0.9;
      c.beginPath(); c.moveTo(tx - 1, ty + 4); c.lineTo(ex - 1, ey - 2); c.stroke();
    }
  }
  function mzHead(c, sp, col, sk, pose, opt) {
    const r = sp.headR, tint = opt && opt.tint, angel = opt && opt.angel, line = col('line');
    c.save(); c.translate(sk.headC.x, sk.headC.y); c.rotate((180 - sk.ha) * D);
    // 太い首
    R.poly(c, [-r * 0.75, r * 0.3, r * 0.55, r * 0.55, r * 0.45, r * 1.6, -r * 0.85, r * 1.6], col('skinDark'), line);
    // 四角い巨大な頭
    R.poly(c, [-r * 0.95, -r * 0.9, -r * 0.55, -r * 1.18, r * 0.62, -r * 1.2, r * 1.0, -r * 0.92, r * 1.12, -r * 0.3, r * 1.2, r * 0.22,
      r * 1.14, r * 0.66, r * 1.18, r * 1.12, r * 0.74, r * 1.36, -r * 0.5, r * 1.24, -r * 1.02, r * 0.55], col('skin'), line);
    if (!tint) {
      // 剃り上げた頭頂のつや
      c.strokeStyle = 'rgba(255,240,220,0.32)'; c.lineWidth = 2;
      c.beginPath(); c.moveTo(-r * 0.55, -r * 0.92); c.quadraticCurveTo(r * 0.1, -r * 1.12, r * 0.62, -r * 0.98); c.stroke();
      // 顎の陰（剃り跡）
      c.fillStyle = 'rgba(40,24,20,0.2)';
      R.poly(c, [r * 0.2, r * 0.9, r * 1.16, r * 0.95, r * 1.12, r * 1.2, r * 0.72, r * 1.36, -r * 0.4, r * 1.2], 'rgba(40,24,20,0.2)');
      // 耳（小さく、縁だけ濃く）
      c.beginPath(); c.ellipse(-r * 0.3, r * 0.14, r * 0.17, r * 0.28, 0.15, 0, Math.PI * 2);
      c.fillStyle = col('skinDark'); c.fill();
      c.strokeStyle = 'rgba(60,30,20,0.55)'; c.lineWidth = 1; c.beginPath(); c.arc(-r * 0.3, r * 0.14, r * 0.14, -1.2, 1.4); c.stroke();
      // 落ち窪んだ眼窩
      c.fillStyle = 'rgba(50,24,18,0.35)'; c.beginPath(); c.ellipse(r * 0.86, -r * 0.02, r * 0.34, r * 0.2, 0, 0, Math.PI * 2); c.fill();
      // 張り出した眉
      R.poly(c, [r * 0.3, -r * 0.4, r * 1.22, -r * 0.46, r * 1.26, -r * 0.2, r * 0.36, -r * 0.14], col('brow'));
      // 目
      if (angel) {
        c.save(); c.globalCompositeOperation = 'lighter';
        c.fillStyle = 'rgba(255,230,150,0.45)'; c.beginPath(); c.ellipse(r * 0.9, -r * 0.04, r * 0.5, r * 0.28, 0, 0, Math.PI * 2); c.fill();
        c.restore();
        c.fillStyle = col('eye'); c.fillRect(r * 0.66, -r * 0.12, r * 0.46, r * 0.16);
      } else {
        c.fillStyle = col('eye'); c.fillRect(r * 0.72, -r * 0.1, r * 0.32, r * 0.13);
        c.fillStyle = 'rgba(255,255,255,0.6)'; c.fillRect(r * 0.94, -r * 0.1, r * 0.06, r * 0.06);
      }
      // 皺
      c.strokeStyle = 'rgba(60,30,20,0.35)'; c.lineWidth = 0.9;
      c.beginPath(); c.moveTo(r * 0.2, -r * 0.62); c.lineTo(r * 0.9, -r * 0.66); c.moveTo(r * 0.72, r * 0.2); c.quadraticCurveTo(r * 0.95, r * 0.5, r * 0.78, r * 0.62); c.stroke();
    }
    // 鼻
    R.poly(c, [r * 1.12, -r * 0.16, r * 1.42, r * 0.34, r * 1.16, r * 0.44], col('skinDark'), line);
    // 厚い唇（天使の姿では細く閉じた口）
    if (angel) R.poly(c, [r * 0.8, r * 0.74, r * 1.2, r * 0.72, r * 1.2, r * 0.8, r * 0.82, r * 0.82], col('lip'));
    else {
      R.poly(c, [r * 0.74, r * 0.64, r * 1.2, r * 0.58, r * 1.25, r * 0.78, r * 0.8, r * 0.82], col('lip'), tint ? null : 'rgba(40,16,12,0.6)', 0.8);
      R.poly(c, [r * 0.78, r * 0.86, r * 1.21, r * 0.84, r * 1.16, r * 1.0, r * 0.82, r * 1.0], col('lip'), tint ? null : 'rgba(40,16,12,0.6)', 0.8);
    }
    c.restore();
    // 光輪（頭の傾きに関わらず水平に浮かぶ）
    if (angel && !tint) {
      const g = opt.glow || 0, hr = r * (1.3 + g * 0.45), ha = (180 - sk.ha) * D;
      const hx = sk.headC.x + Math.sin(ha) * r * 2.2 - r * 0.15, hy = sk.headC.y - Math.cos(ha) * r * 2.2;
      c.save(); c.globalCompositeOperation = 'lighter';
      c.strokeStyle = col('halo');
      c.globalAlpha = 0.16 + g * 0.3; c.lineWidth = 4 + g * 4;
      c.beginPath(); c.ellipse(hx, hy, hr, hr * 0.3, -0.08, 0, Math.PI * 2); c.stroke();
      c.globalAlpha = 0.9; c.lineWidth = 1.8; c.strokeStyle = '#ffd86a';
      c.beginPath(); c.ellipse(hx, hy, hr, hr * 0.3, -0.08, 0, Math.PI * 2); c.stroke();
      c.restore();
    }
  }
  function mzArm(c, sp, col, sh, el, hd, back, pose, opt) {
    const line = col('line'), sl = back ? col('robeDark') : col('robe'), tint = opt && opt.tint;
    R.limb(c, sh.x, sh.y, el.x, el.y, sp.armW * 1.08, sp.armW * 0.96, sl, line);
    const a = Math.atan2(hd.y - el.y, hd.x - el.x), nx = -Math.sin(a), ny = Math.cos(a);
    const cx = U.lerp(el.x, hd.x, 0.8), cy = U.lerp(el.y, hd.y, 0.8), w0 = sp.armW * 0.48, w1 = sp.armW * 0.84;
    // 袖口の広がった前腕
    R.poly(c, [el.x + nx * w0, el.y + ny * w0, cx + nx * w1, cy + ny * w1, cx - nx * w1, cy - ny * w1, el.x - nx * w0, el.y - ny * w0], sl, line);
    if (!tint) R.limb(c, cx + nx * w1, cy + ny * w1, cx - nx * w1, cy - ny * w1, 2.2, 2.2, col('trim'));
    const skin = back ? col('skinDark') : col('skin');
    c.save(); c.translate(hd.x, hd.y); c.rotate(a);
    if (pose.palm && !back) {
      // 開いた大きな掌
      R.poly(c, [-3, -5.8, 6, -6.8, 12.8, -5, 13.4, -1.5, 12.8, 2.2, 6, 5.2, -3, 5.4], skin, line);
      R.poly(c, [1, -5.6, 4.5, -10, 7.5, -9, 5.5, -5.2], skin, line);
      if (!tint) {
        c.strokeStyle = 'rgba(60,30,20,0.5)'; c.lineWidth = 0.8;
        c.beginPath(); c.moveTo(7, -3.4); c.lineTo(13, -3.2); c.moveTo(7, -0.2); c.lineTo(13.2, 0); c.moveTo(7, 2.6); c.lineTo(12.6, 2.4); c.stroke();
      }
    } else {
      R.circle(c, 2.5, 0, sp.armW * 0.64, skin, line);
      if (!tint) { c.strokeStyle = 'rgba(60,30,20,0.5)'; c.lineWidth = 0.8; c.beginPath(); c.moveTo(6, -4); c.lineTo(6.5, 4); c.stroke(); }
    }
    c.restore();
  }
  /** 両手持ちの石版（pose.tab === 'F' のときだけ。原点=前の手、+x=武器方向） */
  function mzWeapon(c, sp, col, len, pose, opt) {
    if (pose.tab !== 'F') return;
    tabletAt(c, col, -8, opt && opt.tint);
  }
  function mzBehind(c, sp, col, sk, pose, opt) {
    const tint = opt && opt.tint;
    if (opt && opt.angel && opt.wingK > 0) {
      // 背の翼（奥・手前とも胴の後ろに描く）
      const ta = Math.atan2(sk.sho.y - sk.hip.y, sk.sho.x - sk.hip.x) + Math.PI / 2;
      const fl = Math.sin((opt.t || 0) * 0.11) * (opt.flap == null ? 1 : opt.flap);
      const rx = U.lerp(sk.hip.x, sk.sho.x, 0.85) - 6, ry = U.lerp(sk.hip.y, sk.sho.y, 0.85);
      const base = opt.wingBase == null ? -2.3 : opt.wingBase, wk = opt.wingK * (opt.wingS || 1);
      featherWing(c, rx + 4, ry - 2, base + 0.18 + ta + fl * 0.2, 56 * wk, true, tint);
      featherWing(c, rx, ry, base + ta + fl * 0.26, 63 * wk, false, tint);
    }
    if (pose.tab === 'S') {
      // 背に負った石版
      const a = Math.atan2(sk.sho.y - sk.hip.y, sk.sho.x - sk.hip.x), nx = -Math.sin(a), ny = Math.cos(a);
      const cx = U.lerp(sk.hip.x, sk.sho.x, 0.72) - nx * sp.chestW * 0.5, cy = U.lerp(sk.hip.y, sk.sho.y, 0.72) - ny * sp.chestW * 0.5;
      c.save(); c.translate(cx, cy); c.rotate(a - 0.32);
      tabletAt(c, col, -20, tint);
      c.restore();
    } else if (pose.tab === 'G') {
      // 地に立てた石版（祈り）
      c.save(); c.translate(sk.hip.x + 24, 0); c.rotate(-Math.PI / 2 - 0.06);
      tabletAt(c, col, 0, tint);
      c.restore();
    } else if (pose.tab !== 'F') {
      // 奥の手に提げた石版
      c.save(); c.translate(sk.hdB.x, sk.hdB.y); c.rotate(Math.atan2(sk.hdB.y - sk.elB.y, sk.hdB.x - sk.elB.x));
      tabletAt(c, col, -7, tint);
      c.restore();
    }
  }
  function mzFront(c, sp, col, sk, pose, opt) {
    if (!opt || opt.tint || !opt.angel) return;
    const g = Math.max(pose.fist ? 1 : 0, opt.glow || 0);
    if (g <= 0.05) return;
    c.save(); c.globalCompositeOperation = 'lighter';
    const f = 0.8 + Math.sin((opt.t || 0) * 0.6) * 0.2;
    for (const hd of pose.fist ? [sk.hdF] : [sk.hdF, sk.hdB]) {
      c.globalAlpha = 0.3 * g * f; c.fillStyle = '#ffd87a'; c.beginPath(); dot(c, hd.x, hd.y, 11 + g * 5); c.fill();
      c.globalAlpha = 0.6 * g * f; c.fillStyle = '#fff6d8'; c.beginPath(); dot(c, hd.x, hd.y, 5); c.fill();
    }
    c.restore();
  }

  const MZ_SPEC = R.makeSpec({
    scale: 1.55, thigh: 19, shin: 18, torso: 32, neck: 6, headR: 10.5, upper: 18, fore: 17,
    legW: 14, armW: 12.5, waistW: 30, chestW: 36, shoulderOff: 4, weaponLen: 34, gripDist: 12,
    colors: MZC,
    draw: { leg: mzLeg, arm: mzArm, torso: mzTorso, head: mzHead, chest: mzRobe, weapon: mzWeapon, behind: mzBehind, front: mzFront },
  });
  const ST1 = R.merge(R.NEUTRAL, { lean: 8, head: 4, aF: 22, eF: 62, aB: 8, eB: 24, lF: 9, kF: 6, lB: -9, kB: 6, w: 0, tab: 'S', cape: 0 });
  const ST2 = R.merge(R.NEUTRAL, { lean: 4, head: 0, aF: 38, eF: 44, aB: 12, eB: 34, lF: 22, kF: 34, lB: -4, kB: 40, w: 0, tab: 'B', cape: 0 });
  const WALK1 = { stride: 15, arm: 10 };
  const INTRO = R.merge(ST1, { tab: 'F', grip: 1, aF: 58, eF: 62, wAbs: 172, lean: 4, head: 16 });
  const STUN2 = R.merge(ST2, { aF: 58, eF: 0, lean: 54, head: 16, drop: 14, aB: -112, eB: 12, lF: 64, kF: 108, lB: -14, kB: 100, fist: 1 });
  const RAISE = { aF: 76, eF: 10, lean: -6, head: -6, aB: 168, eB: 18, palm: 1, tab: 'B' };
  const BONK = { aF: 74, eF: 12, lean: 14, head: 8, aB: 96, eB: 16, palm: 1, tab: 'B' };

  // ---------------------------------------------------------- 衝撃波・光の柱・照準
  function waveDraw(c, sx, sy, p) {
    const k = Math.min(1, p.life / 12), f = p.face;
    c.save();
    c.globalAlpha = k;
    for (let i = 0; i < 3; i++) {
      const ox = -f * i * 9, hgt = (18 - i * 4) * (0.8 + 0.2 * Math.sin(p.t * 0.9 + i));
      const bx = sx + ox, by = sy + 9;
      R.poly(c, [bx - 6, by, bx - f * 1 + 1, by - hgt, bx + 6, by], i === 0 ? '#9a9080' : '#7a7064', 'rgba(20,14,10,0.8)', 1);
    }
    c.globalAlpha = 0.35 * k; c.fillStyle = '#d8c8a8';
    c.beginPath(); c.ellipse(sx - f * 8, sy + 9, 20, 5, 0, 0, Math.PI * 2); c.fill();
    c.restore();
  }
  function quakeWave(e, x, dir) {
    BK.game.addProjectile(new BK.Projectile({
      x, y: e.y, z: 9, vx: dir * 5.6, face: dir, w: 30, h: 18, depth: 16, team: 'enemy', owner: e, dmg: 12, kb: 'down', push: 4.5, lift: 5, stop: 5,
      life: 72, noShadow: true, sfx: 'hitHeavy',
      tick(p) { ownerGone(p); if (p.t % 3 === 0) BK.fx.add({ type: 'smoke', x: p.x - dir * 6, y: p.y + U.rand(-5, 5), z: 4, vz: U.rand(0.8, 2), vx: -dir * 0.4, life: 18, size: U.rand(5, 9), col: 'rgba(130,110,95,0.5)' }); },
      drawFn: waveDraw,
    }));
  }
  function pillarDraw(c, sx, sy, p) {
    const gy = BK.sy(p.y, 0);
    c.save(); c.globalCompositeOperation = 'lighter';
    if (p.t < p.delay) {
      const k = p.t / p.delay, r = 22 + (1 - k) * 28;
      const blink = p.t > p.delay - 14 && ((p.t >> 1) & 1);
      // 地面の印: 縮みながら明るくなる光の円と十字
      c.globalAlpha = 0.3 + 0.5 * k; c.strokeStyle = '#ffd870'; c.lineWidth = 2;
      c.beginPath(); c.ellipse(sx, gy, r, r * 0.5, 0, 0, Math.PI * 2); c.stroke();
      c.globalAlpha = (0.12 + 0.3 * k) * (blink ? 1.8 : 1); c.fillStyle = '#ffe9a8';
      c.beginPath(); c.ellipse(sx, gy, 22, 12, 0, 0, Math.PI * 2); c.fill();
      c.globalAlpha = 0.4 + 0.5 * k; c.strokeStyle = '#fff4d0'; c.lineWidth = 1.6;
      c.beginPath(); c.moveTo(sx - 13, gy); c.lineTo(sx + 13, gy); c.moveTo(sx, gy - 7); c.lineTo(sx, gy + 7); c.stroke();
      if (k > 0.45) { c.globalAlpha = (k - 0.45) * 0.6; c.fillStyle = '#fff0c0'; c.fillRect(sx - 1.5, 0, 3, gy); }
    } else {
      const a = p.t - p.delay, k = Math.max(0, 1 - a / 22), wob = Math.sin(a * 1.3) * 2;
      c.globalAlpha = 0.35 * k; c.fillStyle = '#ffc850'; c.fillRect(sx - 25 - wob, 0, 50 + wob * 2, gy + 6);
      c.globalAlpha = 0.6 * k; c.fillStyle = '#ffeaa0'; c.fillRect(sx - 13, 0, 26, gy + 4);
      c.globalAlpha = 0.95 * k; c.fillStyle = '#ffffff'; c.fillRect(sx - 5, 0, 10, gy + 2);
      c.globalAlpha = 0.6 * k; c.fillStyle = '#fff2c8'; c.beginPath(); c.ellipse(sx, gy, 34, 14, 0, 0, Math.PI * 2); c.fill();
    }
    c.restore();
  }
  function holyPillar(e, x, y, delay) {
    BK.game.addProjectile(new BK.Projectile({
      x: scrX(x, 16), y: clampY(y), z: 110, vx: 0, w: 40, h: 220, depth: 13, team: 'enemy', owner: e, dmg: 18, kb: 'down', push: 3, lift: 7, stop: 6,
      life: delay + 22, pierce: 99, noShadow: true, harmless: true, dirAway: true, delay, sfx: 'hitHeavy',
      tick(p) {
        if (ownerGone(p)) { p.delay = 1e9; return; }
        if (p.t === p.delay) {
          p.harmless = false;
          BK.audio.sfx('cannon', { pitch: 1.6, vol: 0.5 }); BK.audio.sfx('magic', { pitch: 0.5, vol: 0.8 });
          BK.fx.shake(3, 8);
          for (let i = 0; i < 6; i++) BK.fx.add({ type: 'dot', x: p.x + U.rand(-16, 16), y: p.y, z: U.rand(0, 20), vx: U.rand(-1.5, 1.5), vz: U.rand(2, 5), g: 0.15, life: U.randi(18, 30), col: U.choose(['#fff2c0', '#ffd870']), size: 2 });
        }
        if (p.t === p.delay + 10) p.harmless = true;
      },
      drawFn: pillarDraw,
    }));
  }
  function diveMark(e, x, y, life) {
    BK.game.addProjectile(new BK.Projectile({
      x, y, z: 0, vx: 0, team: 'enemy', owner: e, harmless: true, noShadow: true, life,
      drawFn(c, sx, sy, p) {
        const k = p.t / life, r = 32 - k * 14;
        c.save(); c.globalCompositeOperation = 'lighter';
        c.globalAlpha = 0.35 + 0.5 * k; c.strokeStyle = '#ffb060'; c.lineWidth = 2;
        c.beginPath(); c.ellipse(sx, sy, r, r * 0.45, 0, 0, Math.PI * 2); c.stroke();
        c.beginPath();
        for (let i = 0; i < 4; i++) {
          const a = i * Math.PI / 2 + p.t * 0.06, cx = Math.cos(a), cy = Math.sin(a) * 0.45;
          c.moveTo(sx + cx * (r + 6), sy + cy * (r + 6)); c.lineTo(sx + cx * (r - 6), sy + cy * (r - 6));
        }
        c.stroke();
        c.restore();
      },
    }));
  }
  function feather(x, y, z) {
    BK.fx.add({
      type: 'custom', x, y, z, vx: U.rand(-1.2, 1.2), vz: U.rand(-0.2, 1.6), g: 0.03, drag: 0.95, life: U.randi(40, 70), rot: U.rand(0, 6),
      draw(c, sx, sy, k, p) {
        c.save(); c.globalAlpha = Math.min(1, k * 2); c.translate(sx, sy); c.rotate(p.rot + Math.sin(BK.frame * 0.12 + p.rot) * 0.9);
        c.fillStyle = '#f4efe4'; c.beginPath(); c.ellipse(0, 0, 5, 1.8, 0, 0, Math.PI * 2); c.fill();
        c.strokeStyle = 'rgba(120,100,70,0.6)'; c.lineWidth = 0.6; c.beginPath(); c.moveTo(-5, 0); c.lineTo(5, 0); c.stroke();
        c.restore();
      },
    });
  }
  function mozShakeOff(e) {
    e.drawLayer = 0;
    if (e.move) e.endMove();
    e.state = 'hurt'; e.hitstun = 36; e.vx = -e.face * 2.5; e.flash = 6;
    mb(e).cd = 30;
    BK.audio.sfx('hit', { pitch: 0.7 });
  }
  function startTransform(e, game) {
    const B = mb(e);
    B.phase = 1.5;
    if (e.grabbing) e.releaseHero();
    e.drawLayer = 0;
    if (e.move) e.endMove();
    e.hitstun = 0; e.vx = 0; e.vy = 0;
    e.startMove(MM.transform);
    e.invul = 160;
    if (game) game.freeze(96, e);
    BK.fx.flash('#ffffff', 16); BK.fx.shake(4, 20);
    BK.audio.sfx('bell', { pitch: 0.8 });
  }

  // ---------------------------------------------------------- 技
  //  angel: true の技は第2形態（天使）専用。並び順はギャラリーで両形態が見えるように slam, pillar を先頭に置いている
  const MM = {
    // [第1形態] 石版の叩きつけ: 両手で頭上へ掲げ（32F・アーマー）→ 叩きつけ + 前後へ地を這う岩の衝撃波
    slam: {
      dur: 86, armor: true, trail: [37, 41], trailCol: 'rgba(230,220,200,0.8)',
      kf: [[0, {}],
        [10, { tab: 'F', grip: 1, aF: 120, eF: 40, wAbs: 150, lean: -2, head: -4 }],
        [32, { tab: 'F', grip: 1, aF: 172, eF: 6, wAbs: 186, lean: -14, head: -10, lF: 14, kF: 10, lB: -18, kB: 10 }],
        [40, { tab: 'F', grip: 1, aF: 76, eF: 0, wAbs: 112, lean: 34, head: 12, lF: 42, kF: 40, lB: -28, kB: 6, drop: 7 }, 'snap'],
        [64, { tab: 'F', grip: 1, aF: 74, eF: 0, wAbs: 110, lean: 32, head: 12, lF: 40, kF: 38, lB: -28, kB: 6, drop: 7 }],
        [86, {}]],
      hits: [{ f: [38, 42], x: [16, 134], z: [0, 150], d: 20, dmg: 22, kb: 'down', push: 6, lift: 6, stop: 9, sfx: 'hitHeavy' }],
      move: [[0, 0], [32, 1.2], [40, 0]],
      sfx: [[4, 'growl', { pitch: 0.4, vol: 0.8 }], [34, 'swingHeavy', { pitch: 0.6 }]],
      onFrame(e, f) {
        if (f > 12 && f < 36 && f % 4 === 0) BK.fx.add({ type: 'dot', x: e.x - e.face * U.rand(0, 16), y: e.y, z: U.rand(150, 175), vz: -1, g: 0.2, life: 24, col: '#8a8478', size: 2 });
        if (f === 40) {
          const ix = e.x + e.face * 112;
          BK.fx.shake(9, 18); BK.fx.dust(ix, e.y, 14, 'rgba(140,120,100,0.55)');
          BK.audio.sfx('explode', { pitch: 0.6, vol: 0.8 });
          for (let i = 0; i < 10; i++) BK.fx.add({ type: 'dot', x: ix + U.rand(-16, 16), y: e.y + U.rand(-6, 6), z: 4, vx: U.rand(-2.5, 2.5), vz: U.rand(2, 6), g: 0.3, life: U.randi(20, 34), col: U.choose(['#8e897c', '#5e594f', '#bab4a4']), size: U.rand(2, 3.5) });
          if (BK.game) { quakeWave(e, ix, e.face); quakeWave(e, ix, -e.face); }
        }
      },
    },
    // [第2形態] 光の柱: 両手を天へ（光輪が輝く）→ 主人公の足元に光の印（2〜3回）→ 50F後に天から光の柱
    pillar: {
      angel: true, dur: 72, armor: true,
      kf: [[0, {}], [14, { aF: 168, eF: 4, aB: 176, eB: 2, lean: -8, head: -16, palm: 1 }], [58, { aF: 166, eF: 6, aB: 174, eB: 4, lean: -6, head: -14, palm: 1 }], [72, {}]],
      sfx: [[2, 'magic', { pitch: 0.55 }]],
      onFrame(e, f) {
        const B = mb(e), h = e.hero;
        if (f === 0) B.tz = 48;
        airDrag(e, 0.88);
        const at = B.hard ? [14, 28, 42] : [14, 34];
        if (h && BK.game && at.indexOf(f) >= 0) { holyPillar(e, h.x, h.y, 50); BK.audio.sfx('magic', { pitch: 0.8, vol: 0.7 }); }
      },
    },
    // [第1形態] 連掌: 掌を引く（18F・アーマー）→ 2連打 → 渾身の突き飛ばし
    flurry: {
      dur: 80, armor: true,
      kf: [[0, {}],
        [18, { aF: -40, eF: 125, lean: -6, head: -4, lF: 12, kF: 8, lB: -14, kB: 8, palm: 1 }],
        [22, { aF: 80, eF: 6, lean: 18, head: 4, lF: 28, kF: 20, lB: -22, kB: 6, palm: 1 }, 'snap'],
        [28, { aF: -10, eF: 110, lean: 4, palm: 1, lF: 22, kF: 16, lB: -18, kB: 6 }],
        [32, { aF: 92, eF: 2, lean: 20, head: 4, lF: 30, kF: 22, lB: -22, kB: 6, palm: 1 }, 'snap'],
        [40, { aF: -46, eF: 130, lean: -8, head: -6, palm: 1, lF: 18, kF: 12, lB: -16, kB: 8 }],
        [46, { aF: 86, eF: 2, lean: 28, head: 8, lF: 38, kF: 28, lB: -26, kB: 4, drop: 4, palm: 1 }, 'snap'],
        [62, { aF: 84, eF: 4, lean: 26, head: 8, lF: 36, kF: 26, lB: -26, kB: 4, drop: 4, palm: 1 }],
        [80, {}]],
      hits: [
        { f: [21, 23], x: [20, 96], z: [40, 134], d: 16, dmg: 8, kb: 'light', push: 1.2, stop: 4, sfx: 'hit' },
        { f: [31, 33], x: [20, 98], z: [40, 134], d: 16, dmg: 8, kb: 'light', push: 1.2, stop: 4, sfx: 'hit' },
        { f: [45, 48], x: [20, 104], z: [36, 136], d: 18, dmg: 16, kb: 'down', push: 6.5, lift: 5, stop: 8, sfx: 'hitHeavy' }],
      move: [[0, 0], [18, 1.6], [34, 1.2], [44, 2.4], [48, 0]],
      sfx: [[3, 'growl', { pitch: 0.5, vol: 0.6 }], [20, 'swing', { pitch: 0.7 }], [30, 'swing', { pitch: 0.7 }], [43, 'swingHeavy', { pitch: 0.75 }]],
    },
    // [第2形態] 急降下拳: 高く舞い上がり拳を引く（照準の印）→ 急降下 → 着地の衝撃 → 硬直（反撃の好機）
    dive: {
      angel: true, dur: 110, armor: true,
      kf: [[0, {}],
        [20, { aF: -60, eF: 118, lean: -10, head: -8, aB: -30, eB: 30, lF: 36, kF: 60, lB: 4, kB: 66, fist: 1 }],
        [30, { aF: 70, eF: 0, lean: 46, head: 14, aB: -90, eB: 20, lF: 4, kF: 12, lB: -34, kB: 24, fist: 1 }, 'snap'],
        [49, { aF: 72, eF: 0, lean: 48, head: 14, aB: -96, eB: 16, lF: 4, kF: 12, lB: -34, kB: 24, fist: 1 }],
        [51, { aF: 58, eF: 0, lean: 54, head: 16, drop: 14, aB: -112, eB: 12, lF: 64, kF: 108, lB: -14, kB: 100, fist: 1 }, 'snap'],
        [110, { aF: 58, eF: 0, lean: 54, head: 16, drop: 14, aB: -112, eB: 12, lF: 64, kF: 108, lB: -14, kB: 100, fist: 1 }]],
      hits: [{ f: [30, 49], x: [-16, 66], z: [-50, 88], d: 16, dmg: 20, kb: 'down', push: 5, lift: 6, stop: 8, sfx: 'hitHeavy' },
        { f: [50, 52], x: [-76, 92], z: [0, 40], d: 28, dmg: 10, kb: 'down', push: 4, lift: 4, dirAway: true, sfx: 'hitHeavy' }],
      sfx: [[2, 'swingHeavy', { pitch: 0.45 }]],
      onFrame(e, f) {
        const B = mb(e), h = e.hero;
        if (f === 0) { B.fly = true; B.tz = 90; B.hk = 0.1; }
        if (f < 30) {
          airDrag(e, 0.86);
          if (h && f < 20) { e.face = U.sign(h.x - e.x) || e.face; e.vy = U.clamp((h.y - e.y) * 0.08, -1.2, 1.2); }
          if (f === 18) {
            B.tx = scrX(h ? h.x : e.x, 30); B.ty = clampY(h ? h.y : e.y);
            if (BK.game) diveMark(e, B.tx, B.ty, 32);
            BK.audio.sfx('magic', { pitch: 0.7, vol: 0.6 });
          }
          if (f % 3 === 0) BK.fx.add({ type: 'glow', x: e.x - e.face * 10, y: e.y, z: e.z + 120, size: 14, life: 10, col: '#ffd070' });
          return;
        }
        if (f === 30) {
          B.fly = 'manual';
          const n = 14;
          e.vx = (B.tx - e.face * 24 - e.x) / n; e.vy = (B.ty - e.y) / n; B.dvz = -e.z / n;
          BK.audio.sfx('swingHeavy', { pitch: 0.6 });
        }
        if (f < 50) {
          e.vz = B.dvz;
          if (f % 2 === 0) feather(e.x - e.face * 20, e.y, e.z + 90);
          if (e.z + e.vz <= 0.5 || f === 48) {
            e.z = 0; e.vz = 0; e.vx = 0; e.vy = 0; e.mf = 50; B.fly = false;
            BK.fx.shake(8, 16); BK.fx.dust(e.x + e.face * 40, e.y, 14, 'rgba(200,190,170,0.5)');
            BK.fx.ring(e.x + e.face * 30, e.y, 2, 90, '#ffe6a0', 16);
            BK.audio.sfx('explode', { pitch: 0.8, vol: 0.8 });
          }
          return;
        }
        if (f === 60) { e.endMove(); B.stunT = B.hard ? 56 : 70; B.fly = false; }
      },
    },
    // [第1形態] 掌底: 掌を引く（15F）→ 踏み込んで突き飛ばす
    palm: {
      dur: 50,
      kf: [[0, {}],
        [15, { aF: -42, eF: 128, lean: -4, head: -2, lF: 12, kF: 8, lB: -14, kB: 8, palm: 1 }],
        [21, { aF: 84, eF: 4, lean: 24, head: 6, lF: 34, kF: 24, lB: -24, kB: 6, drop: 3, palm: 1 }, 'snap'],
        [34, { aF: 80, eF: 6, lean: 22, head: 6, lF: 32, kF: 22, lB: -24, kB: 6, drop: 3, palm: 1 }],
        [50, {}]],
      hits: [{ f: [19, 23], x: [22, 100], z: [40, 136], d: 16, dmg: 14, kb: 'heavy', push: 5, stop: 6, sfx: 'hitHeavy' }],
      move: [[0, 0], [15, 2.6], [22, 0]],
      sfx: [[2, 'growl', { pitch: 0.45, vol: 0.5 }], [17, 'swingHeavy', { pitch: 0.8 }]],
    },
    // [第1形態] 掴み: 手を高く掲げ指を広げる（18F）→ 踏み込んで頭を鷲掴み → 殴打へ
    seize: {
      dur: 52,
      kf: [[0, {}],
        [18, { aF: 150, eF: 22, lean: -8, head: -6, lF: 12, kF: 8, lB: -14, kB: 8, palm: 1 }],
        [25, { aF: 82, eF: 4, lean: 22, head: 6, lF: 34, kF: 24, lB: -24, kB: 6, palm: 1 }, 'snap'],
        [38, { aF: 80, eF: 6, lean: 20, head: 4, lF: 32, kF: 22, lB: -24, kB: 6, palm: 1 }],
        [52, {}]],
      move: [[0, 0], [18, 3.6], [27, 0]],
      sfx: [[2, 'growl', { pitch: 0.4, vol: 0.8 }], [20, 'swing', { pitch: 0.55 }]],
      onFrame(e, f) {
        if (f < 21 || f > 29) return;
        const h = e.hero;
        if (!canGrab(h)) return;
        const d = (h.x - e.x) * e.face;
        if (d > 10 && d < 96 && Math.abs(h.y - e.y) < 14 && e.grabHero(h, { escapeNeed: 16 })) {
          mb(e).grabCd = 420;
          e.startMove(MM.pummel);
        }
      },
    },
    // [第1形態] 殴打（掴み成功時のみ）: 頭を掴んで吊り上げ、石版で4回殴る → 投げ捨てる（レバガチャで脱出可）
    pummel: {
      dur: 150, armor: true,
      kf: [[0, { aF: 74, eF: 12, lean: 4, head: 2, aB: 20, eB: 30, palm: 1, tab: 'B' }],
        [14, RAISE], [22, BONK, 'snap'], [40, RAISE], [48, BONK, 'snap'], [66, RAISE], [74, BONK, 'snap'], [92, RAISE], [100, BONK, 'snap'],
        [112, { aF: 150, eF: 10, lean: -12, head: -8, aB: 40, eB: 30, palm: 1, tab: 'B' }],
        [120, { aF: 60, eF: 0, lean: 30, head: 10, aB: 20, eB: 30, lF: 34, kF: 24, lB: -24, kB: 6, palm: 1, tab: 'B' }, 'snap'],
        [150, {}]],
      sfx: [[4, 'growl', { pitch: 0.4, vol: 0.7 }], [114, 'swingHeavy', { pitch: 0.7 }]],
      onFrame(e, f) {
        const h = e.grabbing;
        if (f < 119) {
          if (!h || h.grabbedBy !== e || h.dead) { e.drawLayer = 0; e.endMove(); mb(e).cd = 30; return; }
          e.drawLayer = 1; // 頭を掴む手が見えるようモズグスを手前に描く
          const lift = f < 104 ? Math.min(12, f * 1.2) : 12 + (f - 104) * 3.5;
          h.x = e.x + e.face * 54; h.y = e.y; h.z = lift; h.vx = 0; h.vy = 0; h.vz = 0; h.face = -e.face;
          if (f === 22 || f === 48 || f === 74 || f === 100) {
            e.drainHero(5);
            BK.fx.shake(3, 8); BK.fx.stop(4);
            BK.audio.sfx('hitHeavy', { pitch: 0.7, vol: 0.8 });
            BK.fx.hitSpark(h.x, h.y, h.z + (h.h || 90) * 0.85, e.face, 0.6, h.bloodCol);
          }
        } else if (f === 119 && h) {
          e.releaseHero(); e.drawLayer = 0;
          h.z = Math.max(h.z, 24);
          h.takeHit(e, { dmg: 10, kb: 'down', push: 6.5, lift: 6 }, e.face);
          BK.fx.shake(5, 12);
        }
      },
      onEnd(e) { e.drawLayer = 0; if (e.grabbing) e.releaseHero(); },
    },
    // [第1形態] 拷問官を呼ぶ（1回だけ）: 石版を掲げて号令
    summon: {
      dur: 72, armor: true,
      kf: [[0, {}], [16, { aB: 172, eB: 4, aF: 100, eF: 0, lean: -8, head: -12, palm: 1, tab: 'B' }], [54, { aB: 170, eB: 6, aF: 98, eF: 2, lean: -6, head: -10, palm: 1, tab: 'B' }], [72, {}]],
      sfx: [[2, 'growl', { pitch: 0.45, vol: 0.7 }], [20, 'bell', { pitch: 0.9 }]],
      onFrame(e, f) {
        if (f !== 20) return;
        BK.fx.text(e.x, e.y, e.z + 150, '異端者を捕らえよ！', '#ffe2b0', 13);
        const g = BK.game;
        if (!g || !BK.enemyTypes.inquisitor) return;
        g.spawnEnemy('inquisitor', { side: 'L', y: clampY(e.y - 30) });
        g.spawnEnemy('inquisitor', { side: 'R', y: clampY(e.y + 30) });
      },
    },
    // [第1形態] 払い（割り込み）: 殴られ続けたとき、アーマーで両腕を振り払い周囲を吹き飛ばす
    repel: {
      dur: 44, armor: true, invul: [0, 4],
      kf: [[0, { aF: 30, eF: 90, aB: 30, eB: 80, lean: 18, head: 14, drop: 5, lF: 20, kF: 20, lB: -16, kB: 14 }],
        [9, { aF: 128, eF: 0, aB: 150, eB: 0, lean: -12, head: -18, drop: 0, lF: 16, kF: 8, lB: -18, kB: 8, palm: 1 }, 'snap'],
        [28, { aF: 124, eF: 2, aB: 146, eB: 2, lean: -10, head: -16, palm: 1 }], [44, {}]],
      hits: [{ f: [9, 13], x: [-64, 104], z: [0, 150], d: 24, dmg: 10, kb: 'down', push: 6, lift: 5, dirAway: true, stop: 6, sfx: 'hitHeavy' }],
      sfx: [[7, 'roar', { pitch: 0.9, vol: 0.7 }]],
      onFrame(e, f) { if (f === 9) { BK.fx.ring(e.x, e.y, 30, 110, '#ffe0a0', 16); BK.fx.shake(5, 10); } },
    },
    // [第2形態] 光輪: 両腕を広げ光輪が膨らむ（30F）→ 地を這う光の輪（跳んでかわす。体力3割以下で2重）
    ring: {
      angel: true, dur: 80, armor: true,
      kf: [[0, {}], [26, { aF: 150, eF: 14, aB: -150, eB: -10, lean: -12, head: -18, palm: 1, lF: 30, kF: 46, lB: -10, kB: 50 }],
        [31, { aF: 104, eF: 0, aB: -104, eB: 0, lean: 6, head: 2, palm: 1 }, 'snap'], [60, { aF: 100, eF: 2, aB: -100, eB: 2, lean: 4, palm: 1 }], [80, {}]],
      sfx: [[2, 'magic', { pitch: 0.45, vol: 0.8 }]],
      onFrame(e, f) {
        const B = mb(e);
        if (f === 0) B.tz = 30;
        airDrag(e, 0.88);
        if (f === 31 || (B.hard && f === 52)) {
          groundRing(e, { kind: 'holy', dmg: 13, spd: 4.2, life: 72 });
          BK.audio.sfx('magic', { pitch: 1.2 }); BK.audio.sfx('cannon', { pitch: 1.8, vol: 0.4 });
          BK.fx.flash('#fff2c0', 4); BK.fx.shake(3, 8);
          for (let i = 0; i < 5; i++) feather(e.x + U.rand(-30, 30), e.y, e.z + U.rand(60, 110));
        }
      },
    },
    // [第2形態] 石版の薙ぎ払い（近距離）: 石版を振りかぶる（18F）→ 振り下ろす
    swat: {
      angel: true, dur: 52, armor: true,
      kf: [[0, {}], [18, { aB: 176, eB: 8, aF: 50, eF: 50, lean: -12, head: -8 }], [23, { aB: 64, eB: 8, aF: 30, eF: 40, lean: 26, head: 8 }, 'snap'],
        [36, { aB: 60, eB: 10, aF: 30, eF: 40, lean: 24, head: 8 }], [52, {}]],
      hits: [{ f: [21, 25], x: [4, 118], z: [-40, 128], d: 18, dmg: 14, kb: 'heavy', push: 5, stop: 7, sfx: 'hitHeavy' }],
      sfx: [[3, 'growl', { pitch: 0.55, vol: 0.5 }], [19, 'swingHeavy', { pitch: 0.7 }]],
      onFrame(e, f) { const B = mb(e); if (f === 0) B.tz = 24; airDrag(e, 0.85); },
    },
    // 変身: 跪いて祈る → 天からの光 → 閃光とともに翼と光輪 → 咆哮して舞い上がる（無敵）
    transform: {
      dur: 156, armor: true, invul: [0, 156],
      kf: [[0, { lF: 78, kF: 92, lB: -12, kB: 104, lean: 18, head: 24, aF: 58, eF: 80, aB: 52, eB: 86, palm: 1, tab: 'G' }],
        [56, { lF: 78, kF: 92, lB: -12, kB: 104, lean: 22, head: 30, aF: 60, eF: 82, aB: 54, eB: 88, palm: 1, tab: 'G' }],
        [62, { lF: 16, kF: 18, lB: -8, kB: 26, lean: -14, head: -28, aF: 146, eF: 8, aB: -146, eB: -8, palm: 1, tab: 'B' }, 'snap'],
        [100, { lF: 16, kF: 18, lB: -8, kB: 26, lean: -12, head: -24, aF: 142, eF: 10, aB: -142, eB: -10, palm: 1, tab: 'B' }],
        [156, { lF: 22, kF: 34, lB: -4, kB: 40, lean: 2, head: -4, aF: 110, eF: 10, aB: -60, eB: 30, palm: 1, tab: 'B' }]],
      sfx: [[4, 'magic', { pitch: 0.4 }]],
      onFrame(e, f) {
        const B = mb(e);
        e.vx = 0; e.vy = 0;
        if (f < 58 && f % 2 === 0) BK.fx.add({ type: 'dot', x: e.x + U.rand(-40, 40), y: e.y + U.rand(-6, 6), z: U.rand(0, 40), vz: U.rand(1.5, 3.5), life: U.randi(24, 40), col: U.choose(['#fff2c0', '#ffd870', '#ffffff']), size: U.rand(1.5, 2.5) });
        if (f === 58) {
          B.form = 'angel'; B.formAt = e.animT;
          e.bloodCol = '#d8b870';
          BK.fx.flash('#fff6d8', 26); BK.fx.shake(9, 34);
          BK.audio.sfx('explode', { pitch: 0.6, vol: 0.9 });
          BK.fx.ring(e.x, e.y, 60, 160, '#fff2c0', 26);
          for (let i = 0; i < 16; i++) feather(e.x + U.rand(-40, 40), e.y, U.rand(40, 130));
        }
        if (f === 64) BK.audio.sfx('roar', { pitch: 0.75 });
        if (f === 100) { B.fly = true; B.tz = 48; B.hk = 0.035; }
      },
      onEnd(e) {
        const B = mb(e);
        B.phase = 2; B.form = 'angel'; B.cd = 40; B.hk = 0.08; B.fly = true; B.tz = 48;
        e.poise = e.def.poise;
        e.dmgTakenMul = 0.85; // 天使の加護
      },
    },
  };

  // ---------------------------------------------------------- 描画
  function mozPose(e, B, angel) {
    if (e.move && e.move.kf) return R.sample(e.move.kf, e.mf, e.move.angel ? ST2 : ST1);
    const st = angel ? ST2 : ST1;
    if (e.state === 'stun') return R.merge(STUN2, { head: STUN2.head + Math.sin(e.animT * 0.3) * 3, lean: STUN2.lean + Math.sin(e.animT * 0.11) * 2 });
    const rp = e.reactionPose(st);
    if (rp) return rp;
    if (B.intro > 0) return INTRO;
    if (!angel && e.state === 'walk') return R.walk(ST1, e.walkPh, WALK1);
    if (angel) {
      const s = Math.sin(e.animT * 0.05);
      return R.merge(ST2, { lean: ST2.lean + s * 2, aF: ST2.aF + s * 4, aB: ST2.aB - s * 4, lF: ST2.lF + s * 5, lB: ST2.lB - s * 5 });
    }
    return R.idle(ST1, e.animT);
  }
  function drawMozgus(c, e) {
    const B = mb(e);
    if (!e.spec) e.spec = MZ_SPEC;
    const angel = B.form === 'angel' || !!(e.move && e.move.angel);
    const pose = mozPose(e, B, angel);
    const sx = BK.sx(e.x), gy = BK.sy(e.y, 0);
    // 変身: 天から差す光の柱
    if (e.move === MM.transform) {
      const f = e.mf, k = f < 20 ? f / 20 : f < 70 ? 1 : Math.max(0, 1 - (f - 70) / 40);
      if (k > 0) {
        c.save(); c.globalCompositeOperation = 'lighter';
        c.globalAlpha = 0.22 * k; c.fillStyle = '#ffe6a0'; c.fillRect(sx - 58, 0, 116, gy + 8);
        c.globalAlpha = 0.35 * k; c.fillStyle = '#fff4d0'; c.fillRect(sx - 30, 0, 60, gy + 6);
        c.globalAlpha = 0.5 * k; c.fillRect(sx - 10, 0, 20, gy + 4);
        c.restore();
      }
    }
    let glow = 0;
    if (e.move === MM.pillar) glow = Math.min(1, e.mf / 14);
    else if (e.move === MM.ring) glow = e.mf < 31 ? e.mf / 31 : Math.max(0, 1 - (e.mf - 31) / 20);
    else if (e.move === MM.dive && e.mf < 30) glow = e.mf / 30 * 0.5;
    const wingK = !angel ? 0 : B.form === 'angel' ? U.clamp((e.animT - B.formAt) / 22, 0, 1) : 1;
    let flap = 1, wingBase = -2.3, wingS = 1;
    if (e.move === MM.dive) { if (e.mf >= 30 && e.mf < 50) { wingBase = -2.7; flap = 0.2; } else if (e.mf >= 50) { wingBase = -2.9; flap = 0.1; } }
    else if (e.state === 'stun') { wingBase = -2.95; flap = 0.08; }
    else if (e.move === MM.ring && e.mf >= 26 && e.mf < 60) { wingBase = -1.95; flap = 0.3; }
    else if (e.state === 'down' || e.state === 'dead') { wingBase = -1.4; flap = 0; wingS = 0.8; }
    c.save();
    if (e.state === 'dead') c.globalAlpha = Math.max(0, 1 - Math.max(0, e.st - 10) / 90);
    e.drawRig(c, pose, { colors: angel ? MZC_ANGEL : null, angel, wingK, glow, flap, wingBase, wingS });
    c.restore();
    e.drawTrail(c);
  }

  // ---------------------------------------------------------- AI
  function mozUpdate(e, game) {
    const B = mb(e);
    if (e.dead) {
      e.superArmor = 0; B.fly = false;
      if (e.state === 'dead' && e.st < 90 && e.st % 4 === 0) {
        if (B.form === 'angel') feather(e.x + U.rand(-40, 40), e.y, U.rand(10, 50));
        BK.fx.add({ type: 'dot', x: e.x + U.rand(-40, 40), y: e.y + U.rand(-5, 5), z: U.rand(0, 30), vz: U.rand(0.6, 1.6), life: U.randi(26, 40), col: B.form === 'angel' ? '#fff2c0' : '#b0a898', size: 2 });
      }
      return;
    }
    if (B.stunT > 0) B.stunT--;
    if (B.streakT > 0 && --B.streakT <= 0) B.streak = 0;
    if (B.grabCd > 0) B.grabCd--;
    if (B.phase === 1 && e.hp <= e.maxHp * 0.5 && e.state !== 'fall') startTransform(e, game);
    else if (B.phase === 1 && e.state === 'hurt' && B.streak >= 6) { B.streak = 0; e.hitstun = 0; e.startMove(MM.repel); }
    if (B.phase > 1) {
      flyUpdate(e, B);
      B.hard = e.hp < e.maxHp * 0.3;
      if (B.form === 'angel' && e.z > 4 && e.animT % 12 === 0) feather(e.x - e.face * U.rand(10, 40), e.y, e.z + U.rand(70, 110));
    }
    if (e.move !== MM.dive) e.x = U.clamp(e.x, BK.cam.x + 26, BK.cam.x + BK.W - 26);
    // 重い足音
    if (B.phase === 1 && e.state === 'walk') {
      const s = Math.floor(e.walkPh / Math.PI);
      if (s !== B.step) { B.step = s; BK.fx.dust(e.x + e.face * 6, e.y, 2); BK.audio.sfx('thud', { pitch: 0.7, vol: 0.25 }); }
    }
  }
  function mozThink1(e, game, B) {
    const h = game.hero;
    if (B.intro > 0) {
      B.intro--; e.state = 'idle'; e.vx = 0; e.vy = 0;
      if (B.intro === 1) BK.audio.sfx('growl', { pitch: 0.4 });
      return;
    }
    if (!h || h.dead) { e.state = 'idle'; e.vx = 0; e.vy = 0; return; }
    const dx = h.x - e.x, adx = Math.abs(dx), ady = Math.abs(h.y - e.y);
    e.face = U.sign(dx) || e.face;
    if (B.cd > 0) B.cd--;
    if (adx > 170) B.farT++; else B.farT = 0;
    if (B.cd <= 0) {
      if (!B.summoned && (e.hp < e.maxHp * 0.85 || B.t > 840)) { B.summoned = true; startAtk(e, B, MM.summon, 40); return; }
      const list = [];
      if (adx < 90 && ady < 14) list.push([3, MM.palm]);
      if (adx < 82 && ady < 12) list.push([2.2, MM.flurry]);
      if (adx < 76 && ady < 12 && B.grabCd <= 0 && canGrab(h)) list.push([2.4, MM.seize]);
      if (adx < 140 && ady < 24) list.push([1.5, MM.slam]);
      if (adx > 170 && B.farT > 90) list.push([4, MM.slam]);
      if (list.length) { startAtk(e, B, pick(list, B.last), U.randi(30, 58)); B.farT = 0; return; }
    }
    const want = 64;
    if (adx > want + 10 || ady > 6) e.moveToward(h.x - U.sign(dx) * want, h.y, 0.85, 0.62);
    else { e.vx = 0; e.vy = 0; e.state = 'idle'; }
    e.face = U.sign(dx) || e.face;
  }
  function mozThink2(e, game, B) {
    const h = game.hero;
    if (B.stunT > 0) { e.state = 'stun'; B.fly = false; return; }
    if (!B.fly) {
      B.fly = true; B.tz = 48; B.hk = 0.06; B.cd = Math.max(B.cd, 24); B.streak = 0;
      BK.fx.dust(e.x, e.y, 8); BK.audio.sfx('jump', { pitch: 0.5 });
      for (let i = 0; i < 4; i++) feather(e.x + U.rand(-30, 30), e.y, U.rand(40, 90));
    }
    e.state = 'idle';
    if (!h || h.dead) { airDrag(e, 0.9); return; }
    B.hk = e.z < 36 ? 0.06 : 0.08;
    B.tz = 46 + Math.sin(B.t * 0.04) * 6;
    const dx = h.x - e.x, adx = Math.abs(dx), ady = Math.abs(h.y - e.y);
    const side = U.sign(e.x - h.x) || 1;
    // 滞空中に殴られ続けたら、高く舞い上がって反対側へ移り、光の柱を降らせる
    if (B.evade > 0) {
      B.evade--; B.tz = 104; B.hk = 0.09;
      e.vx = U.approach(e.vx, U.clamp((B.evX - e.x) * 0.08, -3.6, 3.6), 0.25);
      e.vy = U.approach(e.vy, U.clamp((h.y - e.y) * 0.05, -1, 1), 0.08);
      e.face = U.sign(dx) || e.face;
      if (B.evade === 0) { B.cd = 0; B.next = MM.pillar; }
      return;
    }
    if (B.streak >= 8 && e.z > 20) {
      B.streak = 0; B.evade = 50;
      let ex = h.x - side * 160;
      if (ex < BK.cam.x + 70 || ex > BK.cam.x + BK.W - 70) ex = h.x + side * 160;
      B.evX = scrX(ex, 70);
      BK.audio.sfx('magic', { pitch: 0.6 }); BK.fx.ring(e.x, e.y, e.z + 60, 70, '#fff2c0', 14);
      for (let i = 0; i < 6; i++) feather(e.x + U.rand(-30, 30), e.y, e.z + U.rand(50, 110));
      return;
    }
    if (B.t % 200 === 1) B.pref = U.rand(90, 150);
    steer(e, scrX(h.x + side * B.pref, 40), h.y, 1.7, 1.2, 1.0, 0.1);
    e.face = U.sign(dx) || e.face;
    if (B.cd > 0) { B.cd--; return; }
    if (e.z < 24) return;
    if (B.next) { const m = B.next; B.next = null; startAtk(e, B, m, B.hard ? 24 : 36); return; }
    const list = [];
    if (adx < 84 && ady < 16) list.push([4, MM.swat]);
    list.push([3, MM.pillar]);
    if (adx > 40) list.push([2.4, MM.dive]);
    if (adx < 200) list.push([2, MM.ring]);
    startAtk(e, B, pick(list, B.last), B.hard ? U.randi(24, 40) : U.randi(36, 60));
  }
  function mozThink(e, game) {
    const B = mb(e);
    B.t++;
    if (B.phase === 1) mozThink1(e, game, B);
    else mozThink2(e, game, B);
  }

  BK.registerEnemy({
    id: 'mozgus', name: 'モズグス', title: '異端審問官', boss: true,
    hp: 750, poise: 90, w: 56, h: 140, weight: 3, speed: 0.85, score: 6000, bossBonus: 50000,
    grabbable: false, drop: null, bloodCol: '#8a0c14', dieSfx: 'roar', diePitch: 0.6, shadowR: 30,
    draw: drawMozgus,
    moves: MM,
    onSpawn(e) {
      const B = mb(e);
      bossCommon(e);
      e.spec = MZ_SPEC;
      e.deadTime = 120; e.downTime = 40;
      B.intro = 80; B.cd = 24;
      e.onDamaged = () => { B.streak++; B.streakT = 80; B.intro = 0; };
      e.onShakeOff = () => mozShakeOff(e);
      BK.audio.sfx('bell', { pitch: 0.7 });
    },
    update: mozUpdate,
    think: mozThink,
    onDie(e) {
      const B = mb(e);
      B.fly = false; e.drawLayer = 0;
      if (e.grabbing) e.releaseHero();
      BK.fx.ring(e.x, e.y, e.z + 60, 120, B.form === 'angel' ? '#fff2c0' : '#ffd0a0', 26);
      if (B.form === 'angel') for (let i = 0; i < 14; i++) feather(e.x + U.rand(-40, 40), e.y, e.z + U.rand(40, 130));
    },
  });
})(window.BK);

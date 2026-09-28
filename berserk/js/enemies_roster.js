'use strict';
/* =====================================================================
 *  enemies_roster.js ── 雑魚の一覧（基本の亡者兵 undead は enemies.js の見本）
 *
 *   spirit     悪霊            張り付いて生気を吸う（AvP のフェイスハガー）。レバガチャで振りほどく
 *   soldier    兵士            palette: captain（赤い羽根飾り・手強い）/ jailer（革頭巾と棍棒）
 *                              / knight（聖鉄鎖騎士団）/ kushan（クシャーンの曲刀兵）
 *   crossbow   弩兵            距離を取って弩を撃つ。近づくと蹴り。palette: knight
 *   hound      魔犬            四つ足・自前描画。噛みつき突進・飛びかかり
 *   troll      トロール        巨体・掴めない。叩きつけ（アーマー）・裏拳の薙ぎ払い・踏みつけ
 *   leaper     猿型使徒        跳ね回り、空中から襲いかかる（AvP のエイリアン・ウォリアー）
 *   moth       蛾の妖精もどき  空中を舞い、急降下と鱗粉
 *   inquisitor 拷問官          棘付き棍棒・掴み（締め上げて投げ捨てる）
 *   apostle    異形の使徒      palette: flesh / bone / horn。爪の三連撃・酸の唾・角の突進
 * ===================================================================== */
(function (BK) {
  const U = BK.U, R = BK.rig, D = U.DEG;

  // ================================================================ 共通ヘルパー
  /** 被弾フラッシュ中（白く光らせる） */
  const flashing = e => e.flash > 0 && (e.flash & 2);
  /** パレット名（colors.kind）。被弾フラッシュ中でも形が変わらないよう opt.colors を直接見る */
  const kindOf = (sp, opt) => ((opt && opt.colors) || sp.colors).kind || '';
  /** 主人公を掴める状態か（空中・無敵・ダウン中は不可） */
  const canGrab = h => !!h && !h.dead && h.hurtable && h.state !== 'grabbed' && !h.grabbing && h.z <= 24;
  /** 円のサブパス（直前の点と線で繋がらないように moveTo してから描く） */
  function dot(c, x, y, r) { c.moveTo(x + r, y); c.arc(x, y, r, 0, Math.PI * 2); }
  /** 胴の上の点: t = 0 腰 / 1 肩、k = 前(+) / 後(-) へのずれ */
  function tp(sk, t, k) {
    const h = sk.hip, s = sk.sho;
    const a = Math.atan2(s.y - h.y, s.x - h.x), nx = -Math.sin(a), ny = Math.cos(a);
    return [h.x + (s.x - h.x) * t + nx * k, h.y + (s.y - h.y) * t + ny * k];
  }
  /** 頭のローカル座標へ（+x = 顔の向き、-y = 上）。呼び出し側で c.restore() */
  function headSpace(c, sk) { c.save(); c.translate(sk.headC.x, sk.headC.y); c.rotate((180 - sk.ha) * D); }
  /** 飛行型: 目標高度へ寄せる（毎フレーム vz を与えて physics の重力を打ち消す） */
  function hover(e, tz, k) { e.vz = (tz - e.z) * (k || 0.08); }
  /** 空中での減速（physics の摩擦は接地中しか効かない） */
  function drag(e, k) {
    e.vx *= k; e.vy *= k;
    if (Math.abs(e.vx) < 0.04) e.vx = 0;
    if (Math.abs(e.vy) < 0.04) e.vy = 0;
  }
  /** 跳躍の初速: (tx, ty) に着地するように */
  function leapTo(e, tx, ty, vz, maxVx) {
    const t = 2 * vz / BK.GRAV + 1;
    e.z = 0.5; e.vz = vz;
    e.vx = U.clamp((tx - e.x) / t, -maxVx, maxVx);
    e.vy = U.clamp((ty - e.y) / t, -1.6, 1.6);
  }
  /** 跳躍技の着地判定: 空中フェーズ（from 以降）で接地したら landF フレームへ飛ばして着地硬直を再生 */
  function landing(e, f, from, landF) {
    if (f > from && f < landF && e.z <= 0 && e.vz <= 0) {
      e.mf = landF; e.vx = 0; e.vy = 0;
      BK.fx.dust(e.x, e.y, 5);
      BK.audio.sfx('land', { pitch: 0.85 });
      return true;
    }
    return false;
  }
  /** 3本の鉤爪（原点 = 手、+x 方向へ伸びる） */
  function claws(c, len, fill, line) {
    for (let i = -1; i <= 1; i++) {
      c.save(); c.rotate(i * 0.34);
      c.beginPath();
      c.moveTo(0, -1.4); c.quadraticCurveTo(len * 0.62, -1.8, len, 1.6 + i * 0.4); c.quadraticCurveTo(len * 0.55, 0.8, 0, 1.4);
      c.closePath(); c.fillStyle = fill; c.fill();
      if (line) { c.strokeStyle = line; c.lineWidth = 0.8; c.stroke(); }
      c.restore();
    }
  }
  /** 武器の手元座標系で描く（リグ外の手に爪を付けるときなど） */
  function atHand(c, el, hd, fn) {
    c.save(); c.translate(hd.x, hd.y); c.rotate(Math.atan2(hd.y - el.y, hd.x - el.x)); fn(); c.restore();
  }
  /** 敵の矢（弩兵） */
  function boltDraw(c, sx, sy, p) {
    const f = p.face;
    c.strokeStyle = 'rgba(255,230,200,0.28)'; c.lineWidth = 1;
    c.beginPath(); c.moveTo(sx - f * 26, sy); c.lineTo(sx - f * 12, sy); c.stroke();
    c.strokeStyle = '#5e4a32'; c.lineWidth = 2;
    c.beginPath(); c.moveTo(sx - f * 11, sy); c.lineTo(sx + f * 6, sy); c.stroke();
    c.fillStyle = '#c4c8d0'; c.beginPath(); c.moveTo(sx + f * 11, sy); c.lineTo(sx + f * 4, sy - 2.8); c.lineTo(sx + f * 4, sy + 2.8); c.closePath(); c.fill();
    c.fillStyle = '#20100e'; c.fillRect(sx - f * 12 - 1.5, sy - 2.6, 3, 5.2);
  }
  /** 霊気の粒（悪霊の消滅など） */
  function wispBurst(x, y, z, n, col) {
    for (let i = 0; i < n; i++) {
      const a = U.rand(0, Math.PI * 2);
      BK.fx.add({ type: 'smoke', x: x + Math.cos(a) * 8, y: y + U.rand(-3, 3), z: z + Math.sin(a) * 10, vx: Math.cos(a) * U.rand(0.6, 2), vz: Math.sin(a) * U.rand(0.5, 1.6) + 0.7, drag: 0.94, life: U.randi(20, 34), size: U.rand(3, 6), col: col || 'rgba(190,235,250,0.32)' });
    }
  }

  // ================================================================
  //  悪霊 spirit ── 無念のうちに死んだ者たちの魂の塊。
  //  漂いながら近づき、飛びついて顔に張り付き生気を吸う。レバガチャで振りほどける。
  // ================================================================
  const SP = { body: '#9ccfdc', head: '#dcf3f6', dark: '#061216', hair: '#56727c' };
  function spiritFace(c, x, y, r, open) {
    c.beginPath();
    c.ellipse(x - r * 0.45, y - r * 0.3, r * 0.28, r * 0.42, 0.2, 0, Math.PI * 2);
    c.moveTo(x + r * 0.73, y - r * 0.3);
    c.ellipse(x + r * 0.45, y - r * 0.3, r * 0.28, r * 0.42, -0.2, 0, Math.PI * 2);
    c.moveTo(x + r * 0.3, y + r * 0.5);
    c.ellipse(x, y + r * 0.5, r * 0.3, r * (0.28 + 0.5 * open), 0, 0, Math.PI * 2);
    c.fill();
  }
  function drawSpirit(c, e) {
    const M = e.def.moves, t = e.animT + e.uid * 17, fl = flashing(e);
    let alpha = 0.88, sc = 1, open = 0.3 + Math.sin(t * 0.09) * 0.12, lean = 0, reach = 0.15 + Math.sin(t * 0.07) * 0.15, hot = 0, wrap = 0;
    if (e.entry === 'rise' && e.entering > 0) alpha *= 1 - e.entering / 44;
    if (e.state === 'vanish') { const k = Math.min(1, e.st / 34); alpha *= 1 - k; sc = 1 + k * 0.7; open = 1; reach = -0.4; }
    else if (e.move === M.lunge) {
      const f = e.mf;
      if (f < 18) { const k = f / 18; open = 0.3 + k * 0.8; lean = -k * 0.6; reach = -0.5 * k; hot = k; }
      else { open = 1.1; lean = 0.7; reach = 1.3; hot = 1; }
    } else if (e.move === M.wail) {
      const f = e.mf, k = f < 26 ? f / 26 : Math.max(0, 1 - (f - 26) / 22);
      open = 0.4 + k; sc = 1 + k * 0.2; lean = -k * 0.35; reach = -0.6 * k; hot = k * 0.7;
    } else if (e.state === 'hurt' || e.state === 'fall') { lean = -0.7; open = 1; reach = -0.7; }
    if (e.latched) { wrap = 1; open = 0.6 + Math.sin(t * 0.3) * 0.3; hot = 0.5 + Math.sin(t * 0.3) * 0.5; reach = 1; }
    const sx = BK.sx(e.x), sy = BK.sy(e.y, e.z);
    const s1 = Math.sin(t * 0.12) * 3, s2 = Math.sin(t * 0.12 + 1.3) * 5, s3 = Math.sin(t * 0.1 + 2.1) * 4;
    const hx = 3 + lean * 8, hy = -44 + Math.abs(lean) * 2;
    const tipx = wrap ? 8 + s1 : -15 - lean * 6 + s2, tipy = -1;
    const bodyC = fl ? '#ffffff' : SP.body, headC = fl ? '#ffffff' : SP.head;
    c.save();
    c.translate(sx, sy); c.scale(e.face * sc, sc);
    c.lineCap = 'round';
    // 後ろへ流れる長い乱れ髪
    c.globalAlpha = alpha * 0.6; c.strokeStyle = fl ? '#ffffff' : SP.hair; c.lineWidth = 1.5;
    c.beginPath();
    for (let i = 0; i < 5; i++) {
      const wv = Math.sin(t * 0.11 + i * 0.9) * 3;
      c.moveTo(hx - 3 + i * 1.6, hy - 11 + i * 0.4);
      c.quadraticCurveTo(hx - 15 - i * 3, hy - 13 + wv, hx - 27 - i * 3.5, hy - 3 + i * 4 + wv * 1.4);
    }
    c.stroke();
    // 後ろへ流れる霊気の尾
    c.globalAlpha = alpha * 0.35; c.strokeStyle = bodyC; c.lineWidth = 1.6;
    c.beginPath();
    for (let i = 0; i < 3; i++) {
      const yy = hy + 12 + i * 9, w = Math.sin(t * 0.13 + i * 1.7) * 4;
      c.moveTo(hx - 8, yy); c.quadraticCurveTo(hx - 22, yy + w, hx - 31 - i * 4, yy - 5 + w * 1.5);
    }
    c.stroke();
    // 奥の腕
    spiritArm(c, hx - 3, hy, reach, wrap, alpha * 0.45, bodyC, 1);
    // 体（たなびく裾）
    c.globalAlpha = alpha * 0.5; c.fillStyle = bodyC;
    c.beginPath();
    c.moveTo(hx - 11, hy + 1);
    c.quadraticCurveTo(hx - 17 + s1, hy + 22, tipx - 5, tipy - 7);
    c.lineTo(tipx - 9 + s3 * 0.5, tipy + 1);
    c.lineTo(tipx - 2, tipy - 4);
    c.lineTo(tipx + s3 * 0.3, tipy + 3);
    c.lineTo(tipx + 5, tipy - 5);
    c.quadraticCurveTo(hx + 2 + s1 * 0.6, hy + 25, hx + 10, hy + 6);
    c.closePath(); c.fill();
    // 内側の濃い層
    c.globalAlpha = alpha * 0.35;
    c.beginPath();
    c.moveTo(hx - 7, hy + 4); c.quadraticCurveTo(hx - 10 + s1, hy + 20, tipx - 1, tipy - 8); c.quadraticCurveTo(hx + s1 * 0.5, hy + 20, hx + 6, hy + 6); c.closePath(); c.fill();
    // 体に浮かぶ無数の顔
    if (!fl) {
      c.globalAlpha = alpha * 0.4; c.fillStyle = SP.dark;
      spiritFace(c, hx - 6 + s1 * 0.4, hy + 18, 3.6, 0.5 + Math.sin(t * 0.07) * 0.3);
      spiritFace(c, hx - 9 + s1 * 0.2, hy + 31, 2.8, 0.6 + Math.sin(t * 0.09 + 1) * 0.3);
    }
    // 頭（髑髏めいた顔。口が縦に裂ける）
    c.globalAlpha = alpha * 0.92; c.fillStyle = headC;
    c.beginPath(); c.ellipse(hx, hy - 1, 10, 12, 0.15 + lean * 0.3, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.moveTo(hx - 6.5, hy + 3); c.quadraticCurveTo(hx + 1.5, hy + 18 + open * 9, hx + 9, hy + 3); c.fill();
    if (!fl) {
      c.fillStyle = SP.dark;
      c.beginPath();
      c.ellipse(hx + 5, hy - 2.8, 3.5, 5, 0.55, 0, Math.PI * 2);
      c.moveTo(hx - 0.8, hy - 3.2);
      c.ellipse(hx - 3.4, hy - 3.2, 2.7, 4.3, -0.15, 0, Math.PI * 2);
      c.fill();
      // こけた頬と、裂けたように縦に開く口
      c.globalAlpha = alpha * 0.45; c.strokeStyle = SP.dark; c.lineWidth = 1;
      c.beginPath(); c.moveTo(hx + 8, hy + 2); c.quadraticCurveTo(hx + 6, hy + 7, hx + 7, hy + 10); c.moveTo(hx - 5, hy + 1); c.quadraticCurveTo(hx - 4, hy + 6, hx - 2, hy + 9); c.stroke();
      c.globalAlpha = alpha * 0.92;
      c.beginPath(); c.ellipse(hx + 2.5, hy + 6 + open * 3.5, 2.6 + open, 2 + open * 5.5, 0.12, 0, Math.PI * 2); c.fill();
      // 眼窩の奥の光（襲いかかる直前は赤く）
      c.globalAlpha = alpha * (0.65 + hot * 0.35);
      c.fillStyle = hot > 0.35 ? '#ff5a3a' : '#c4f8ff';
      c.beginPath(); dot(c, hx + 5.6, hy - 2.6, 1.1 + hot * 0.7); dot(c, hx - 3, hy - 3, 0.9 + hot * 0.4); c.fill();
    }
    // 手前の腕
    spiritArm(c, hx + 1, hy, reach, wrap, alpha * 0.8, headC, 0);
    c.restore();
  }
  function spiritArm(c, hx, hy, reach, wrap, a, col, back) {
    const ex = hx + 7 + reach * 8, ey = hy + 13 - reach * 5 - back * 2;
    const px = ex + 7 + reach * 9 - wrap * 2, py = ey - 2 - reach * 6 - wrap * 10;
    c.globalAlpha = a; c.strokeStyle = col;
    c.lineWidth = 2.4; c.beginPath(); c.moveTo(hx - 3, hy + 10); c.lineTo(ex, ey); c.stroke();
    c.lineWidth = 1.8; c.beginPath(); c.moveTo(ex, ey); c.lineTo(px, py); c.stroke();
    c.lineWidth = 1; c.beginPath();
    for (let i = -1; i <= 1; i++) { c.moveTo(px, py); c.lineTo(px + 5 - wrap * 3, py + i * 2.6 + wrap * 3); }
    c.stroke();
  }
  function drawWailShot(c, sx, sy, p) {
    const k = Math.min(1, p.life / 12), f = p.face, w = Math.sin(p.t * 0.4) * 2;
    c.globalAlpha = 0.5 * k; c.fillStyle = SP.body;
    c.beginPath(); c.moveTo(sx - f * 3, sy - 9); c.quadraticCurveTo(sx - f * 18, sy - 7 + w, sx - f * 28, sy - 1 - w); c.quadraticCurveTo(sx - f * 16, sy + 5, sx - f * 3, sy + 9); c.closePath(); c.fill();
    c.globalAlpha = 0.8 * k; c.fillStyle = SP.head;
    c.beginPath(); c.ellipse(sx, sy, 8.5, 10.5, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = SP.dark;
    spiritFace(c, sx + f * 1.5, sy - 0.5, 7, 0.9);
    c.globalAlpha = 1;
  }
  function spiritInit(e) {
    e.inited = true;
    e.hoverZ = U.rand(24, 40);
    e.onShakeOff = h => spiritShakeOff(e, h);
    if (e.state === 'air') { e.state = 'idle'; e.z = Math.min(e.z, 150); e.vz = 0; }
    else if (e.z < 10 && e.entry !== 'rise') e.z = 30;
  }
  function spiritLatch(e, h) {
    if (e.move) e.endMove();
    e.state = 'idle';
    e.latched = true; e.latchT = 0;
    e.releaseToken(); e.ai.mode = 'recover'; e.ai.cd = 60;
    BK.audio.sfx('spirit', { pitch: 0.8 });
    wispBurst(h.x, h.y, h.z + 70, 5);
  }
  function spiritUnlatch(e) {
    e.latched = false; e.drawLayer = 0;
    if (e.grabbing) e.releaseHero();
    e.releaseToken();
    e.ai.mode = 'wait'; e.ai.t = 0; e.ai.cd = U.randi(90, 150);
  }
  /** 振りほどかれた: 吹き飛んで傷つく（体力が残っていれば、しばらく怯んでからまた漂う） */
  function spiritShakeOff(e, h) {
    const dir = U.sign(e.x - h.x) || h.face;
    spiritUnlatch(e);
    e.face = -dir;
    const dmg = 10;
    e.hp -= dmg; e.flash = 8; e.lastHitBy = h; e._lastHitF = BK.frame;
    if (BK.game) BK.game.lastHitEnemy = e;
    BK.fx.stop(4); BK.fx.shake(3, 8);
    BK.audio.sfx('spirit', { pitch: 1.5 });
    wispBurst(e.x, e.y, e.z + 40, 6);
    if (e.hp <= 0) { e.hp = 0; e.die(h, { dmg }, dir); return; }
    e.state = 'hurt'; e.hitstun = 34; e.vx = dir * 5.5; e.vy = 0; e.invul = 10;
  }
  BK.registerEnemy({
    id: 'spirit', name: '悪霊', hp: 14, w: 26, h: 56, weight: 0.6, speed: 1.35, speedY: 1.0, score: 200, range: 66,
    grabbable: false, drop: null, bloodCol: 'rgba(180,235,250,0.85)', dieSfx: 'spirit', diePitch: 0.7, shadowR: 12,
    draw: drawSpirit,
    moves: {
      // 飛びつき: 身を引いて口を開き（溜め）、一直線に顔へ飛びかかる。当たれば張り付く
      lunge: {
        dur: 52, ai: { min: 16, max: 150, w: 4, cd: 70, dy: 14, cond: e => canGrab(e.hero) },
        sfx: [[3, 'spirit', { pitch: 1.25, vol: 0.7 }]],
        onFrame(e, f) {
          const h = e.hero;
          if (f < 18) { e.vx = -e.face * 0.7; e.vz = 0.45; e.vy *= 0.8; return; }
          if (f === 18) {
            // 距離に応じた速さで、11 フレームほどで顔に届くように飛ぶ
            const adx = h ? Math.abs(h.x - e.x) : 100;
            e.vx = e.face * U.clamp(adx / 11, 5, 9.5); e.vy = h ? U.clamp((h.y - e.y) / 8, -1.6, 1.6) : 0;
          }
          if (f < 36) {
            if (h) e.vz = U.clamp((h.z + h.h * 0.92 - 44 - e.z) * 0.15, -2, 2);
            if (canGrab(h) && Math.abs(h.x - e.x) < 22 && Math.abs(h.y - e.y) < 12 && e.grabHero(h, { escapeNeed: 10 })) spiritLatch(e, h);
          } else { e.vx *= 0.86; e.vy *= 0.8; }
        },
      },
      // 嘆きの声: 顔が膨らみ、叫びとともに霊の塊を放つ
      wail: {
        dur: 56, ai: { min: 150, max: 240, w: 1, cd: 90, dy: 16, cond: e => !(e.wailT > BK.frame) },
        sfx: [[4, 'spirit', { pitch: 0.6, vol: 0.8 }]],
        onFrame(e, f) {
          if (f === 0) e.wailT = BK.frame + 420; // 嘆きは間を空けて（主役は張り付き）
          e.vx *= 0.8; e.vy *= 0.8;
          if (f < 26) e.vz = 0.25;
          if (f === 26) {
            BK.audio.sfx('spirit', { pitch: 1.8, vol: 0.6 });
            e.shoot({
              x: e.x + e.face * 16, z: e.z + 42, vx: e.face * 3.4, w: 22, h: 22, dmg: 5, kb: 'light', push: 1.5, life: 80, sfx: 'hit', fx: 'none', noShadow: true,
              tick(p) { if (p.t % 4 === 0) BK.fx.add({ type: 'smoke', x: p.x - p.face * 8, y: p.y, z: p.z, vx: -p.face * 0.4, vz: 0.2, life: 16, size: U.rand(3, 6), col: 'rgba(170,225,245,0.3)' }); },
              onExpire(p) { wispBurst(p.x, p.y, p.z, 4); },
              drawFn: drawWailShot,
            });
          }
        },
      },
    },
    onSpawn(e) { spiritInit(e); },
    update(e, game) {
      if (!e.inited) spiritInit(e);
      if (e.state === 'vanish') { // 霧散していく
        e.st++; e.vz = 0.7; e.vx *= 0.9; e.vy = 0;
        if (e.st % 4 === 0 && e.st < 24) wispBurst(e.x, e.y, e.z + 30, 2);
        if (e.st > 34) e.remove = true;
        return;
      }
      if (e.dead) return;
      if (e.state === 'air') e.state = 'idle';
      const h = game.hero;
      if (e.latched) {
        if (!h || h.dead || e.grabbing !== h || h.grabbedBy !== e) { spiritUnlatch(e); e.vx = -e.face * 2; }
        else {
          // 張り付いたまま主人公の頭にしがみつき、生気を吸う
          e.x = h.x + h.face * 7; e.y = h.y; e.z = h.z + h.h * 0.92 - 44;
          e.vx = 0; e.vy = 0; e.vz = 0; e.face = -h.face; e.drawLayer = 3;
          e.latchT++;
          if (e.latchT % 18 === 0) {
            e.drainHero(1);
            for (let i = 0; i < 3; i++) BK.fx.add({ type: 'dot', x: h.x + U.rand(-6, 6), y: h.y, z: h.z + h.h * 0.55, vx: h.face * U.rand(0.2, 1), vz: U.rand(1.2, 2.2), life: 16, col: '#c8182a', size: U.rand(1.6, 2.6), drag: 0.95 });
          }
          if (e.latchT % 80 === 40) BK.audio.sfx('spirit', { pitch: 0.9, vol: 0.45 });
          return;
        }
      }
      // 殴られても浮いたまま（ダウンせず、怯みとして扱う）
      if (e.state === 'fall' || e.state === 'down' || e.state === 'getup') { e.state = 'hurt'; e.hitstun = 20; e.spinning = false; }
      if (!e.move) { drag(e, 0.88); hover(e, e.hoverZ + Math.sin(e.animT * 0.05 + e.uid) * 9); }
      else e.vz = 0;
    },
    think(e, game) {
      if (e.dead || e.latched || e.state === 'vanish') return;
      e.thinkMelee(game);
      e.vy += Math.sin(e.animT * 0.07 + e.uid) * 0.25; // ゆらゆら漂う
    },
    onDie(e) {
      e.latched = false; e.drawLayer = 0;
      e.state = 'vanish'; e.st = 0; e.vz = 0; e.vx *= 0.3;
      wispBurst(e.x, e.y, e.z + 30, 9);
    },
  });

  // ================================================================
  //  兵士 soldier ── 剣を持つ人間の兵。palette で装備が変わる
  //   (既定) 傭兵: 鉄の帽子・赤茶の胴衣   captain: 羽根飾りの兜・赤い外套（手強い）
  //   jailer: 革の頭巾・棍棒              knight: 聖鉄鎖騎士団（白銀の鎧・聖なる紋章）
  //   kushan: クシャーンの黒い鎧・仮面・曲刀
  // ================================================================
  function soldierHead(c, sp, col, sk, pose, opt) {
    const r = sp.headR, k = kindOf(sp, opt), tint = opt && opt.tint, line = col('line');
    headSpace(c, sk);
    if (k === 'jailer') {
      // 顎だけ覗く、先の垂れた革頭巾
      R.poly(c, [r * 0.2, r * 0.5, r * 1.0, r * 0.42, r * 0.85, r * 1.02, r * 0.1, r * 1.0], col('skin'), line);
      R.poly(c, [r * 1.05, r * 0.5, r * 1.12, -r * 0.25, r * 0.7, -r * 0.98, -r * 0.2, -r * 1.2, -r * 1.2, -r * 1.45, -r * 2.2, -r * 1.2, -r * 1.35, -r * 0.3, -r * 1.0, r * 1.05, r * 0.15, r * 0.55], col('hood'), line);
      if (!tint) {
        c.fillStyle = '#080404';
        c.beginPath(); c.ellipse(r * 0.62, -r * 0.2, r * 0.24, r * 0.15, -0.1, 0, Math.PI * 2); c.fill();
        c.fillStyle = 'rgba(240,190,120,0.9)'; c.beginPath(); dot(c, r * 0.68, -r * 0.2, 0.75); c.fill();
        c.strokeStyle = 'rgba(0,0,0,0.55)'; c.lineWidth = 0.8;
        c.beginPath(); c.moveTo(-r * 0.3, -r * 1.15); c.quadraticCurveTo(-r * 0.7, -r * 0.1, -r * 0.4, r * 0.95); c.stroke();
      }
    } else if (k === 'knight') {
      // 聖鉄鎖騎士団の平頭の大兜（覗き穴と金の十字）
      c.beginPath();
      c.moveTo(-r * 1.0, r * 1.05); c.lineTo(-r * 1.08, -r * 0.45);
      c.quadraticCurveTo(-r * 0.95, -r * 1.25, 0, -r * 1.25); c.quadraticCurveTo(r * 1.0, -r * 1.22, r * 1.12, -r * 0.35);
      c.lineTo(r * 1.2, r * 1.0); c.closePath();
      c.fillStyle = col('metal'); c.fill(); c.strokeStyle = line; c.lineWidth = 1.1; c.stroke();
      if (!tint) {
        c.fillStyle = 'rgba(40,44,56,0.3)'; c.fillRect(-r * 1.02, -r * 0.4, r * 0.7, r * 1.4);
        c.fillStyle = '#0c0e14'; c.fillRect(r * 0.15, -r * 0.3, r * 1.02, r * 0.2);
        c.fillStyle = col('gold'); c.fillRect(r * 0.92, -r * 1.12, r * 0.16, r * 2.0); c.fillRect(r * 0.5, r * 0.12, r * 0.62, r * 0.14);
        c.fillStyle = '#0c0e14'; c.beginPath(); dot(c, r * 0.55, r * 0.5, 0.6); dot(c, r * 0.72, r * 0.72, 0.6); c.fill();
        c.strokeStyle = 'rgba(255,255,255,0.55)'; c.lineWidth = 1;
        c.beginPath(); c.moveTo(-r * 0.6, -r * 1.05); c.quadraticCurveTo(0, -r * 1.18, r * 0.6, -r * 1.05); c.stroke();
      }
    } else if (k === 'kushan') {
      // 鎖の垂れ・黄金の仮面・玉ねぎ形の兜
      R.poly(c, [-r * 0.8, -r * 0.3, -r * 1.3, r * 1.15, r * 0.1, r * 1.3, r * 0.5, r * 0.7, -r * 0.1, -r * 0.2], col('mail'), line);
      R.circle(c, 0, 0, r, col('skin'), line);
      R.poly(c, [r * 0.15, -r * 0.62, r * 1.08, -r * 0.5, r * 1.14, r * 0.35, r * 0.8, r * 0.98, r * 0.2, r * 0.86], col('gold'), line);
      if (!tint) {
        c.fillStyle = '#0a0606'; R.poly(c, [r * 0.4, -r * 0.22, r * 1.08, -r * 0.18, r * 1.06, -r * 0.05, r * 0.45, -r * 0.08], '#0a0606');
        c.strokeStyle = 'rgba(40,20,10,0.8)'; c.lineWidth = 0.9;
        c.beginPath(); c.moveTo(r * 0.55, r * 0.55); c.lineTo(r * 1.0, r * 0.52); c.stroke();
        c.fillStyle = 'rgba(255,240,200,0.35)'; c.fillRect(r * 0.95, -r * 0.45, r * 0.12, r * 0.9);
      }
      c.beginPath(); c.moveTo(-r * 1.1, -r * 0.35); c.quadraticCurveTo(-r * 1.25, -r * 1.3, 0, -r * 1.6); c.quadraticCurveTo(r * 1.25, -r * 1.3, r * 1.1, -r * 0.35); c.closePath();
      c.fillStyle = col('plate'); c.fill(); c.strokeStyle = line; c.lineWidth = 1; c.stroke();
      R.poly(c, [-r * 0.16, -r * 1.52, 0, -r * 2.5, r * 0.16, -r * 1.52], col('gold'), line, 0.8);
      R.poly(c, [-r * 1.16, -r * 0.3, r * 1.13, -r * 0.3, r * 1.1, -r * 0.62, -r * 1.13, -r * 0.62], col('cloth2'), line, 0.8);
    } else {
      // 傭兵・隊長: 顔 + 兜
      if (k === 'captain') {
        // 赤い羽根飾り（兜の後ろへなびく）
        const sw = Math.sin(((opt && opt.t) || 0) * 0.13) * 1.5;
        c.beginPath();
        c.moveTo(r * 0.2, -r * 1.0);
        c.quadraticCurveTo(-r * 0.4, -r * 2.5, -r * 2.7 + sw, -r * 1.6);
        c.quadraticCurveTo(-r * 1.7, -r * 1.55, -r * 3.0 + sw, -r * 0.5);
        c.quadraticCurveTo(-r * 1.5, -r * 0.95, -r * 0.4, -r * 0.7);
        c.closePath();
        c.fillStyle = col('plume'); c.fill(); c.strokeStyle = line; c.lineWidth = 1; c.stroke();
        if (!tint) {
          c.strokeStyle = 'rgba(255,150,120,0.6)'; c.lineWidth = 0.8;
          c.beginPath(); c.moveTo(0, -r * 1.2); c.quadraticCurveTo(-r * 1.0, -r * 1.9, -r * 2.4 + sw, -r * 1.4); c.stroke();
        }
      }
      R.circle(c, 0, 0, r, col('skin'), line);
      R.poly(c, [r * 0.1, r * 0.55, r * 0.95, r * 0.25, r * 0.85, r * 0.9, -r * 0.1, r * 1.0], col('skin'));
      if (!tint) {
        c.fillStyle = '#140c0a'; c.fillRect(r * 0.45, r * 0.02, r * 0.38, r * 0.16);
        c.fillStyle = 'rgba(40,24,16,0.35)'; R.poly(c, [r * 0.1, r * 0.6, r * 0.9, r * 0.45, r * 0.8, r * 0.95, 0, r * 0.98], 'rgba(40,24,16,0.35)');
      }
      if (k === 'captain') {
        // サレット（後ろへ張り出した兜）
        c.beginPath();
        c.moveTo(r * 1.08, -r * 0.08); c.quadraticCurveTo(r * 1.0, -r * 1.2, -r * 0.1, -r * 1.2);
        c.quadraticCurveTo(-r * 1.2, -r * 1.15, -r * 1.3, -r * 0.2); c.lineTo(-r * 2.0, r * 0.5); c.lineTo(-r * 0.9, r * 0.35); c.lineTo(-r * 0.6, -r * 0.05);
        c.closePath();
        c.fillStyle = col('metal'); c.fill(); c.strokeStyle = line; c.lineWidth = 1.1; c.stroke();
        if (!tint) { c.fillStyle = col('guard'); c.fillRect(-r * 0.6, -r * 0.2, r * 1.66, r * 0.14); }
      } else {
        // 鉄の帽子（ケトルハット）
        c.beginPath(); c.arc(0, -r * 0.18, r * 1.02, Math.PI, Math.PI * 2); c.closePath();
        c.fillStyle = col('metal'); c.fill(); c.strokeStyle = line; c.lineWidth = 1; c.stroke();
        R.poly(c, [-r * 1.55, -r * 0.24, r * 1.6, -r * 0.24, r * 1.42, r * 0.1, -r * 1.38, r * 0.1], col('metal'), line);
      }
      if (!tint) { c.fillStyle = 'rgba(255,255,255,0.3)'; c.fillRect(-r * 0.4, -r * 0.98, r * 0.9, r * 0.16); }
    }
    c.restore();
  }
  function soldierTorso(c, sp, col, sk, pose, opt) {
    const k = kindOf(sp, opt), tint = opt && opt.tint, line = col('line');
    // 腰から垂れる裾（胴衣・前掛け）
    const f0 = tp(sk, 0, sp.waistW * 0.55), b0 = tp(sk, 0, -sp.waistW * 0.62);
    const len = k === 'knight' ? 17 : k === 'jailer' ? 15 : 12;
    R.poly(c, [f0[0], f0[1], f0[0] + 3, f0[1] + len, b0[0] - 3, b0[1] + len - 1, b0[0], b0[1]], col('skirt'), line);
    R.defaultDraw.torso(c, sp, col, sk);
    if (tint) return;
    const cw = sp.chestW, ww = sp.waistW;
    if (k === 'knight') {
      // 白い陣羽織と聖なる紋章
      const a1 = tp(sk, 0.96, cw * 0.44), a2 = tp(sk, 0.96, -cw * 0.18), b1 = tp(sk, -0.05, ww * 0.6), b2 = tp(sk, -0.05, -ww * 0.25);
      R.poly(c, [a1[0], a1[1], b1[0], b1[1], b2[0], b2[1], a2[0], a2[1]], col('tabard'), line);
      const m = tp(sk, 0.62, cw * 0.14);
      c.fillStyle = col('gold'); c.beginPath(); dot(c, m[0], m[1], 3.6); c.fill();
      c.fillStyle = col('tabard'); c.beginPath(); dot(c, m[0], m[1], 2.4); c.fill();
      c.fillStyle = col('emblem'); c.fillRect(m[0] - 0.65, m[1] - 3.2, 1.3, 6.4); c.fillRect(m[0] - 2.3, m[1] - 1.3, 4.6, 1.3);
    } else if (k === 'captain') {
      // 胸当て
      const a1 = tp(sk, 0.98, cw * 0.48), a2 = tp(sk, 0.98, -cw * 0.1), b1 = tp(sk, 0.35, ww * 0.62), b2 = tp(sk, 0.3, -ww * 0.1);
      R.poly(c, [a1[0], a1[1], b1[0], b1[1], b2[0], b2[1], a2[0], a2[1]], col('plate'), line);
      c.strokeStyle = col('guard'); c.lineWidth = 1.2;
      c.beginPath(); c.moveTo(b1[0], b1[1]); c.lineTo(b2[0], b2[1]); c.stroke();
      c.strokeStyle = 'rgba(255,255,255,0.45)'; c.lineWidth = 1;
      const hl = tp(sk, 0.85, cw * 0.3), hl2 = tp(sk, 0.45, ww * 0.45);
      c.beginPath(); c.moveTo(hl[0], hl[1]); c.lineTo(hl2[0], hl2[1]); c.stroke();
    } else if (k === 'kushan') {
      // 小札（ラメラー）の段と金の縁取り
      c.strokeStyle = 'rgba(190,150,80,0.55)'; c.lineWidth = 1;
      c.beginPath();
      for (let i = 1; i <= 4; i++) { const t = i * 0.2, p1 = tp(sk, t, U.lerp(ww, cw, t) * 0.5), p2 = tp(sk, t, -U.lerp(ww, cw, t) * 0.45); c.moveTo(p1[0], p1[1]); c.lineTo(p2[0], p2[1]); }
      c.stroke();
      const n1 = tp(sk, 1, cw * 0.45), n2 = tp(sk, 0.55, ww * 0.1);
      c.strokeStyle = col('gold'); c.lineWidth = 1.4; c.beginPath(); c.moveTo(n1[0], n1[1]); c.lineTo(n2[0], n2[1]); c.stroke();
    } else if (k === 'jailer') {
      // 革の吊り帯
      const p1 = tp(sk, 1, cw * 0.4), p2 = tp(sk, 0.05, -ww * 0.4);
      c.strokeStyle = col('belt'); c.lineWidth = 2.4; c.beginPath(); c.moveTo(p1[0], p1[1]); c.lineTo(p2[0], p2[1]); c.stroke();
      c.fillStyle = '#8a7a60'; const bk = tp(sk, 0.55, 0); c.fillRect(bk[0] - 1.5, bk[1] - 1.5, 3, 3);
    } else {
      // 傭兵: 斜めの剣帯と鎖帷子の襟
      const p1 = tp(sk, 1, -cw * 0.35), p2 = tp(sk, 0.05, ww * 0.45);
      c.strokeStyle = col('belt'); c.lineWidth = 2; c.beginPath(); c.moveTo(p1[0], p1[1]); c.lineTo(p2[0], p2[1]); c.stroke();
      const q1 = tp(sk, 1, cw * 0.5), q2 = tp(sk, 1, -cw * 0.45), q3 = tp(sk, 0.82, 0);
      R.poly(c, [q1[0], q1[1], q3[0], q3[1], q2[0], q2[1]], col('mail'));
    }
  }
  function soldierFront(c, sp, col, sk, pose, opt) {
    const k = kindOf(sp, opt);
    if (k === 'jailer') return;
    const s = sk.shF;
    c.beginPath(); c.ellipse(s.x + 0.5, s.y + 1.5, 6.2, 5, -0.3, Math.PI, Math.PI * 2.05); c.lineTo(s.x - 5, s.y + 5); c.closePath();
    c.fillStyle = col(k === 'merc' ? 'mail' : 'plate'); c.fill(); c.strokeStyle = col('line'); c.lineWidth = 1.1; c.stroke();
  }
  function soldierCape(c, sp, col, sk, pose, opt) {
    const k = kindOf(sp, opt);
    if (k === 'captain' || k === 'knight') R.capeDraw(c, sp, col, sk, pose, opt);
  }
  function soldierWeapon(c, sp, col, len, pose, opt) {
    const k = kindOf(sp, opt), line = col('line'), tint = opt && opt.tint;
    if (k === 'jailer') {
      // 鋲打ちの棍棒
      R.poly(c, [-7, -1.8, 0, -1.9, len * 0.45, -2.8, len - 3, -4.8, len + 1, -2.4, len + 1, 2.4, len - 3, 4.8, len * 0.45, 2.8, 0, 1.9, -7, 1.8], col('wood'), line);
      if (!tint) {
        c.fillStyle = col('metalDark');
        c.fillRect(len * 0.45, -3, 2.2, 6);
        for (let i = 0; i < 3; i++) { c.fillRect(len - 13 + i * 5, -4.4, 1.8, 1.8); c.fillRect(len - 11 + i * 5, 2.6, 1.8, 1.8); }
      }
      return;
    }
    R.poly(c, [-8, -1.5, 0, -1.5, 0, 1.5, -8, 1.5], col('grip'));
    R.circle(c, -8.5, 0, 1.9, col('guard'));
    R.poly(c, [-1, -5.2, 2, -5.2, 2, 5.2, -1, 5.2], col('guard'), line);
    if (k === 'kushan') {
      // 反りの深い曲刀
      c.beginPath(); c.moveTo(2, -2.2); c.quadraticCurveTo(len * 0.62, -2.8, len + 2, -9); c.quadraticCurveTo(len * 0.64, 3.4, 2, 2.4); c.closePath();
      c.fillStyle = col('metal'); c.fill(); c.strokeStyle = line; c.lineWidth = 1.1; c.stroke();
      if (!tint) { c.strokeStyle = 'rgba(255,255,255,0.4)'; c.lineWidth = 0.8; c.beginPath(); c.moveTo(4, -1); c.quadraticCurveTo(len * 0.6, -1.4, len - 2, -6.5); c.stroke(); }
    } else {
      R.poly(c, [2, -2.4, len - 6, -2, len, 0, len - 6, 2, 2, 2.4], col('metal'), line);
      if (!tint) { c.fillStyle = 'rgba(0,0,0,0.25)'; c.fillRect(3, -0.5, len - 14, 1); }
    }
  }
  const SOLDIER_KIND = { captain: { hp: 1.6, score: 2 }, jailer: { hp: 1.1, score: 1.1 }, knight: { hp: 1.4, score: 1.6 }, kushan: { hp: 1.15, score: 1.3 } };
  function soldierSpawn(e) {
    const m = SOLDIER_KIND[e.opt.palette];
    if (!m) return;
    if (!e.opt.hp) { e.hp = e.maxHp = Math.round(e.maxHp * m.hp); }
    e.scoreValue = Math.round(e.scoreValue * m.score);
    if (e.opt.palette === 'knight') e.metal = true;   // 聖鉄鎖騎士団の鎧は火花が散る
  }
  const soldierHeavy = e => e.opt.palette === 'captain' || e.opt.palette === 'knight';
  // 兵士の体（弩兵と共用）
  const SOLDIER_SPEC = {
    scale: 1, thigh: 22, shin: 21, torso: 29, headR: 7.8, upper: 16, fore: 15, legW: 9, armW: 7, waistW: 13, chestW: 19, shoulderOff: 2, weaponLen: 40, gripDist: 8, capeLen: 42,
  };
  const SOLDIER_COLORS = {
    kind: 'merc',
    skin: '#c79a7c', hair: '#2a1c14', cloth: '#3e342c', clothDark: '#29221d', sleeve: '#6a6a6e', body: '#5c2e26', skirt: '#4a2620', belt: '#2a1a10',
    boot: '#2a211c', bootDark: '#1b1512', glove: '#4a3222', gloveDark: '#33231a', mail: '#707074', plate: '#8e9096', metal: '#b4b2ac', metalDark: '#5c5a56',
    grip: '#3a2616', guard: '#6e6a62', plume: '#c01818', wood: '#5a3c22', hood: '#2e2320', gold: '#c09a48', tabard: '#e4e0d6', cloth2: '#4a2448',
    cape: '#3a0c10', capeIn: '#5a1418', emblem: '#b0181c',
  };
  const KNIGHT_COLORS = {
    kind: 'knight', body: '#bfc4cc', skirt: '#dcd8cc', sleeve: '#aab0ba', cloth: '#9aa0aa', clothDark: '#6c727c', boot: '#8e949e', bootDark: '#5e646e',
    glove: '#c4c8d0', gloveDark: '#7e848e', metal: '#dfe2e8', metalDark: '#7a808a', plate: '#d0d4dc', guard: '#c8a850', cape: '#d8d4ca', capeIn: '#a8a49a',
    tabard: '#ebe7dc', gold: '#c8a040',
  };
  BK.registerEnemy({
    id: 'soldier', name: '兵士', hp: 42, w: 24, h: 86, weight: 1, speed: 1.25, speedY: 0.85, score: 400, range: 50,
    entry: 'walk', drop: 'common', bloodCol: '#8a0c14', dieSfx: 'growl', diePitch: 1.25,
    spec: Object.assign({}, SOLDIER_SPEC, {
      colors: SOLDIER_COLORS,
      draw: { head: soldierHead, torso: soldierTorso, weapon: soldierWeapon, front: soldierFront, cape: soldierCape },
    }),
    palettes: {
      captain: { kind: 'captain', body: '#7a1518', skirt: '#5a0e12', sleeve: '#8e9096', plate: '#aeb1b8', metal: '#cacac6', guard: '#c09a48', cape: '#5a0a0e', capeIn: '#7a1418' },
      jailer: { kind: 'jailer', body: '#4a3222', skirt: '#3a281a', skin: '#b28c72', sleeve: '#b28c72', glove: '#b28c72', gloveDark: '#8e6c56', cloth: '#2c2420', clothDark: '#1e1916', hood: '#2a201c', belt: '#1e140c' },
      knight: KNIGHT_COLORS,
      kushan: { kind: 'kushan', body: '#2a2230', skirt: '#40204a', sleeve: '#3a3040', cloth: '#2e2434', clothDark: '#1c1620', boot: '#241c20', bootDark: '#161114', glove: '#3a2a2a', gloveDark: '#281c1c', plate: '#3c3044', metal: '#d0ccc4', guard: '#b08a40', gold: '#b89040', mail: '#4a4650', skin: '#9a6a4a', cloth2: '#5a2a5e' },
    },
    stance: { lean: 6, head: 0, aF: 30, eF: 55, aB: -12, eB: 30, lF: 14, kF: 12, lB: -14, kB: 10, wAbs: 128 },
    walkOpt: { stride: 20, arm: 10, lockF: true },
    onSpawn: soldierSpawn,
    moves: {
      // 二連斬り: 肩に担いで振り下ろし → 切り返しの斬り上げ
      combo: {
        dur: 58, trail: [13, 33], ai: { min: 18, max: 62, w: 3, cd: 55 },
        kf: [[0, {}], [12, { aF: 160, eF: 30, wAbs: 222, lean: -6, lF: 16, kF: 14, lB: -18, kB: 10, aB: -30 }],
          [16, { aF: 75, eF: 5, wAbs: 60, lean: 20, lF: 32, kF: 28, lB: -24, kB: 6, aB: -40 }, 'snap'],
          [24, { aF: 50, eF: 12, wAbs: 30, lean: 18, lF: 30, kF: 26, lB: -24, kB: 6, aB: -40 }],
          [28, { aF: 25, eF: 20, wAbs: -10, lean: 12, lF: 26, kF: 22, lB: -22, kB: 8, aB: -30 }],
          [32, { aF: 150, eF: 10, wAbs: 165, lean: -8, lF: 26, kF: 18, lB: -22, kB: 8, aB: -50 }, 'snap'],
          [44, { aF: 140, eF: 15, wAbs: 170, lean: -6 }], [58, {}]],
        hits: [{ f: [14, 17], x: [8, 64], z: [10, 100], d: 14, dmg: 7, kb: 'light', push: 2 },
          { f: [30, 33], x: [8, 62], z: [20, 115], d: 14, dmg: 8, kb: 'heavy', push: 3 }],
        move: [[0, 0], [13, 1.8], [17, 0], [28, 1.6], [32, 0]],
        sfx: [[13, 'swing'], [29, 'swing']],
      },
      // 盾崩しの前蹴り: 膝を高く抱えて（溜め）→ 蹴り飛ばす。アーマーも崩す
      kick: {
        dur: 40, ai: { min: 8, max: 46, w: 1.6, cd: 60 },
        kf: [[0, {}], [11, { lF: 95, kF: 115, lB: -8, kB: 10, lean: -10, aF: 40, eF: 60, wAbs: 150, aB: -30, eB: 40 }],
          [15, { lF: 92, kF: 0, lB: -16, kB: 6, lean: -20, aF: 30, eF: 50, wAbs: 150, aB: -40, eB: 30 }, 'snap'],
          [24, { lF: 88, kF: 5, lB: -16, kB: 6, lean: -18, aF: 30, eF: 50, wAbs: 150, aB: -40, eB: 30 }], [40, {}]],
        hits: [{ f: [13, 18], x: [10, 54], z: [22, 66], d: 14, dmg: 6, kb: 'down', push: 5, lift: 3, breakArmor: true, sfx: 'hit' }],
        move: [[0, 0], [12, 2.4], [17, 0]],
        sfx: [[12, 'swing', { pitch: 0.7 }]],
      },
      // 突き: 剣を引き絞って（溜め）→ 踏み込んで突く
      thrust: {
        dur: 48, trail: [16, 22], ai: { min: 52, max: 100, w: 1.3, cd: 60 },
        kf: [[0, {}], [14, { aF: -30, eF: 100, wAbs: 95, lean: -6, lF: 8, kF: 10, lB: -20, kB: 12, aB: 40, eB: 30 }],
          [19, { aF: 88, eF: 0, wAbs: 92, lean: 22, lF: 42, kF: 32, lB: -32, kB: 4, aB: -40, eB: 10 }, 'snap'],
          [32, { aF: 86, eF: 0, wAbs: 90, lean: 20, lF: 40, kF: 30, lB: -30, kB: 4, aB: -40, eB: 10 }], [48, {}]],
        hits: [{ f: [17, 22], x: [15, 80], z: [40, 80], d: 12, dmg: 8, kb: 'heavy', push: 3 }],
        move: [[0, 0], [15, 5], [21, 0.5], [24, 0]],
        sfx: [[15, 'swing', { pitch: 1.2 }]],
      },
      // 隊長・騎士のみ: 両手持ちの唐竹割り
      cleave: {
        dur: 58, trail: [21, 26], ai: { min: 18, max: 66, w: 1.6, cd: 70, cond: soldierHeavy },
        kf: [[0, {}], [20, { aF: 170, eF: 20, wAbs: 200, grip: 1, lean: -12, lF: 18, kF: 14, lB: -20, kB: 10 }],
          [25, { aF: 85, eF: 0, wAbs: 70, grip: 1, lean: 26, lF: 40, kF: 36, lB: -28, kB: 4, drop: 3 }, 'snap'],
          [40, { aF: 82, eF: 0, wAbs: 66, grip: 1, lean: 24, lF: 40, kF: 36, lB: -28, kB: 4, drop: 3 }], [58, {}]],
        hits: [{ f: [23, 26], x: [10, 72], z: [0, 110], d: 16, dmg: 12, kb: 'down', push: 4.5 }],
        move: [[0, 0], [20, 1.5], [25, 0]],
        sfx: [[21, 'swingHeavy']],
      },
    },
  });

  // ================================================================
  //  弩兵 crossbow ── 距離を保ち、狙いを定めて（照準のきらめき）撃つ。近づくと蹴り
  // ================================================================
  function crossbowWeapon(c, sp, col, len, pose, opt) {
    const line = col('line'), tint = opt && opt.tint;
    // 台座（弓床）と引き金
    R.poly(c, [-16, -1.2, -10, -2.8, 18, -2.1, 21, 0, 18, 2.1, -10, 2.8, -16, 3.4], col('wood'), line);
    c.fillStyle = col('metalDark'); c.fillRect(-8.5, 2, 2, 3.6);
    // 弓（鉄の弦弓）
    c.strokeStyle = col('metal'); c.lineWidth = 2.3;
    c.beginPath(); c.moveTo(12, -11.5); c.quadraticCurveTo(19.5, 0, 12, 11.5); c.stroke();
    if (tint) return;
    // 弦（装填中は引かれている）と矢
    c.strokeStyle = 'rgba(225,215,195,0.9)'; c.lineWidth = 0.8;
    c.beginPath(); c.moveTo(12, -11.5); c.lineTo(pose.empty ? 13.5 : -3, -0.5); c.lineTo(12, 11.5); c.stroke();
    if (!pose.empty) {
      c.strokeStyle = '#5e4a32'; c.lineWidth = 1.4; c.beginPath(); c.moveTo(-3, -2.8); c.lineTo(21, -2.8); c.stroke();
      R.poly(c, [21, -4.8, 26, -2.8, 21, -0.8], '#c4c8d0');
    }
    if (pose.glint) {
      // 照準のきらめき（発射の合図）
      const k = ((opt.t || 0) >> 1) % 2 ? 1 : 0.55;
      c.fillStyle = '#fff6d0';
      c.beginPath(); c.moveTo(26, -2.8 - 5 * k); c.lineTo(27.2, -4); c.lineTo(26 + 5 * k, -2.8); c.lineTo(27.2, -1.6); c.lineTo(26, -2.8 + 5 * k); c.lineTo(24.8, -1.6); c.lineTo(26 - 5 * k, -2.8); c.lineTo(24.8, -4); c.closePath(); c.fill();
    }
  }
  function crossbowFire(e) {
    const sc = e.spec.scale || 1, sk = e.sk;
    const x = sk ? e.x + sk.tip.x * sc * e.face : e.x + e.face * 40;
    const z = sk ? e.z - (sk.tip.y - 2.8) * sc : e.z + 68;
    BK.audio.sfx('shoot', { pitch: 0.8 });
    BK.fx.add({ type: 'burst', x, y: e.y, z, life: 5, size: 8, col: '#fff2d0' });
    e.shoot({ x, z, vx: e.face * 6.5, w: 18, h: 8, dmg: 7, kb: 'light', push: 1.6, stop: 3, life: 90, sfx: 'hit', drawFn: boltDraw });
  }
  BK.registerEnemy({
    id: 'crossbow', name: '弩兵', hp: 30, w: 24, h: 86, weight: 1, speed: 1.1, speedY: 0.8, score: 450, range: 46,
    entry: 'walk', drop: 'common', bloodCol: '#8a0c14', dieSfx: 'growl', diePitch: 1.3,
    spec: Object.assign({}, SOLDIER_SPEC, {
      weaponLen: 21, gripDist: 9,
      colors: Object.assign({}, SOLDIER_COLORS, { body: '#3e4634', skirt: '#2e3428', wood: '#6a4a2a' }),
      draw: { head: soldierHead, torso: soldierTorso, weapon: crossbowWeapon, front: soldierFront, cape: soldierCape },
    }),
    palettes: { knight: Object.assign({}, KNIGHT_COLORS, { wood: '#5a4030' }) },
    stance: { lean: 4, head: 0, aF: 18, eF: 60, aB: 20, eB: 50, lF: 12, kF: 10, lB: -12, kB: 8, wAbs: 60, grip: 1 },
    walkOpt: { stride: 20, arm: 6, lockF: true, lockB: true },
    onSpawn(e) { if (e.opt.palette === 'knight') { e.metal = true; if (!e.opt.hp) e.hp = e.maxHp = Math.round(e.maxHp * 1.3); e.scoreValue = Math.round(e.scoreValue * 1.4); } },
    think(e, game) { e.thinkRanged(game, { dist: 170, move: e.def.moves.shoot, cd: 90 }); },
    moves: {
      // 構える → 狙う（きらめき）→ 発射 → 弦を引き直す
      shoot: {
        dur: 64, ai: { cd: 90 },
        kf: [[0, {}], [10, { aF: 45, eF: 80, wAbs: 90, grip: 1, lean: 2, head: 4, lF: 20, kF: 14, lB: -18, kB: 10, glint: 1 }],
          [26, { aF: 45, eF: 82, wAbs: 90, grip: 1, lean: 4, head: 5, lF: 20, kF: 14, lB: -18, kB: 10, glint: 1 }],
          [28, { aF: 40, eF: 95, wAbs: 100, grip: 1, lean: -6, head: -4, lF: 16, kF: 12, lB: -20, kB: 10, empty: 1 }, 'snap'],
          [36, { aF: 42, eF: 90, wAbs: 96, grip: 1, lean: -2, lF: 18, kF: 12, lB: -18, kB: 10, empty: 1 }],
          [48, { aF: 15, eF: 40, wAbs: 30, grip: 0, aB: 30, eB: 100, lean: 14, lF: 14, kF: 14, lB: -14, kB: 10 }], [64, {}]],
        sfx: [[9, 'knife', { pitch: 0.5, vol: 0.7 }], [50, 'knife', { pitch: 0.4, vol: 0.6 }]],
        onFrame(e, f) { if (f === 27) crossbowFire(e); },
      },
      // 近寄られたら前蹴りで突き放す
      melee: {
        dur: 40, ai: { cd: 50 },
        kf: [[0, {}], [11, { lF: 95, kF: 115, lB: -8, kB: 10, lean: -10, aF: 30, eF: 60, wAbs: 110, aB: 30, eB: 60, grip: 1 }],
          [15, { lF: 92, kF: 0, lB: -16, kB: 6, lean: -20, aF: 20, eF: 60, wAbs: 110, aB: 20, eB: 60, grip: 1 }, 'snap'],
          [24, { lF: 88, kF: 5, lB: -16, kB: 6, lean: -18, aF: 20, eF: 60, wAbs: 110, grip: 1 }], [40, {}]],
        hits: [{ f: [13, 18], x: [10, 54], z: [22, 66], d: 14, dmg: 6, kb: 'down', push: 5.5, lift: 3, breakArmor: true, sfx: 'hit' }],
        move: [[0, 0], [12, 2], [17, 0]],
        sfx: [[12, 'swing', { pitch: 0.7 }]],
      },
    },
  });

  // ================================================================
  //  魔犬 hound ── 痩せこけた黒い魔犬。脇腹の肉が剥げ、肋と背骨の棘が覗く
  // ================================================================
  const HOUND_S = 1.18; // 描画倍率
  const HC = { fur: '#45332f', furFar: '#271c1b', rim: 'rgba(255,150,110,0.45)', flesh: '#72242a', bone: '#cdbfa2', eye: '#ff5a24', mouth: '#3e080c', teeth: '#eee4d0', line: 'rgba(8,4,4,0.9)' };
  const HC_FLASH = { fur: '#fff', furFar: '#fff', rim: '#fff', flesh: '#fff', bone: '#fff', eye: '#fff', mouth: '#fff', teeth: '#fff', line: 'rgba(0,0,0,0.3)' };
  function houndLeg(c, jx, jy, tx, ty, l1, l2, w, fill, line) {
    const k = R.ik(jx, jy, tx, ty, l1, l2, 1);
    R.limb(c, jx, jy, k.ex, k.ey, w, w * 0.7, fill, line);
    R.limb(c, k.ex, k.ey, k.hx, k.hy, w * 0.62, w * 0.5, fill, line);
    R.poly(c, [k.hx - 2.5, k.hy - 2, k.hx + 4.2, k.hy - 1.2, k.hx + 4.8, k.hy + 1, k.hx - 2.5, k.hy + 1], fill, line, 0.9);
  }
  function houndPose(e) {
    const M = e.def.moves, st = e.state, t = e.animT;
    const P = { ph: e.walkPh, amp: 0, crouch: 0, pitch: 0, jaw: 0.12 + Math.sin(t * 0.08) * 0.06, head: 0, legs: 'gait', breath: Math.sin(t * 0.1) };
    if (e.move === M.bite) {
      const f = e.mf;
      if (f < 12) { const k = f / 12; P.crouch = 9 * k; P.pitch = 0.1 * k; P.head = 7 * k; P.jaw = 0.3 + 0.45 * k; P.amp = 0.2; P.ph = f * 0.25; }
      else if (f < 24) { P.amp = 1.35; P.ph = f * 0.75; P.pitch = 0.1; P.jaw = f < 16 ? 1 : 0.15; P.head = -2; }
      else { P.amp = 0.3; P.ph = f * 0.3; P.jaw = 0.25; }
    } else if (e.move === M.pounce) {
      const f = e.mf;
      if (f < 16) { const k = f / 16; P.crouch = 10 * k; P.pitch = -0.2 * k; P.jaw = 0.5 * k; P.head = -3 * k; }
      else if (f < 60) { P.legs = 'leap'; P.pitch = e.vz > 0 ? -0.32 : 0.3; P.jaw = 1; P.head = -2; }
      else { P.crouch = 7 * (1 - (f - 60) / 10); P.jaw = 0.4; }
    } else if (st === 'walk') P.amp = 1;
    else if (st === 'hurt') { P.pitch = -0.3; P.jaw = 0.85; P.crouch = 3; P.head = -4; }
    else if (st === 'fall') { P.legs = 'flail'; P.pitch = e.spinning ? t * 0.45 : -0.8; P.jaw = 0.8; }
    else if (st === 'down' || st === 'dead') { P.legs = 'splay'; P.crouch = 15; P.head = 9; P.jaw = st === 'dead' ? 0.7 : 0.4; P.pitch = 0.04; }
    else if (st === 'getup') { const k = 1 - Math.min(1, e.st / 18); P.legs = k > 0.5 ? 'splay' : 'gait'; P.crouch = 15 * k; P.head = 9 * k; }
    else if (st === 'grabbed') { P.legs = 'flail'; P.pitch = -0.7; P.jaw = 0.6 + Math.sin(t * 0.8) * 0.3; }
    return P;
  }
  function drawHound(c, e) {
    const P = houndPose(e), C = flashing(e) ? HC_FLASH : HC, fl = C === HC_FLASH, line = C.line;
    const sx = BK.sx(e.x), sy = BK.sy(e.y, e.z);
    const cy = -24 + P.crouch, cs = Math.cos(P.pitch), sn = Math.sin(P.pitch);
    const rot = (x, y) => { const dy = y + 24; return [x * cs - dy * sn, cy + x * sn + dy * cs]; };
    const sh = rot(12, -27), hp = rot(-15, -25);
    const g = (off, base, stride, lift) => {
      const p = P.ph + off, a = P.amp;
      return [base + Math.sin(p) * stride * a, -Math.max(0, Math.cos(p)) * lift * a];
    };
    let fN, fF, bN, bF;
    if (P.legs === 'leap') { fN = [sh[0] + 17, sh[1] + 12]; fF = [sh[0] + 13, sh[1] + 15]; bN = [hp[0] - 19, hp[1] + 11]; bF = [hp[0] - 15, hp[1] + 14]; }
    else if (P.legs === 'flail') { const w = Math.sin(e.animT * 0.9) * 6; fN = [sh[0] + 8 + w, sh[1] + 18]; fF = [sh[0] + 4 - w, sh[1] + 20]; bN = [hp[0] - 6 - w, hp[1] + 20]; bF = [hp[0] - 2 + w, hp[1] + 20]; }
    else if (P.legs === 'splay') { fN = [sh[0] + 22, 0]; fF = [sh[0] + 17, -1]; bN = [hp[0] - 20, 0]; bF = [hp[0] - 15, -1]; }
    else { fN = g(0, sh[0] + 2, 9, 7); fF = g(Math.PI, sh[0] - 2, 9, 7); bN = g(Math.PI, hp[0] - 1, 9, 6); bF = g(0, hp[0] - 4, 9, 6); }
    c.save();
    if (e.entry === 'rise' && e.entering > 0) {
      // 地面から這い出る（足元より下は描かない）
      c.beginPath(); c.rect(sx - 80, sy - 120, 160, 122); c.clip();
      c.translate(0, (e.entering / 44) * 60);
    }
    c.translate(sx, sy); c.scale(e.face * HOUND_S, HOUND_S);
    if (e.state === 'dead') c.globalAlpha = Math.max(0, 1 - Math.max(0, e.st - 12) / 38);
    if (e.state === 'grabbed') c.translate(0, -8);
    // 奥の脚
    houndLeg(c, sh[0] - 2, sh[1], fF[0], fF[1], 13, 14, 5.5, C.furFar, line);
    houndLeg(c, hp[0] - 3, hp[1], bF[0], bF[1], 14, 14, 6.5, C.furFar, line);
    // ---- 胴（ここから体の座標系）
    c.save();
    c.translate(0, cy); c.rotate(P.pitch); c.translate(0, 24);
    const wag = Math.sin(e.animT * 0.25) * 4;
    // 骨ばった尾
    c.lineCap = 'round'; c.strokeStyle = C.fur;
    c.lineWidth = 3.2; c.beginPath(); c.moveTo(-22, -28); c.quadraticCurveTo(-31, -33 + wag, -37, -27 + wag * 0.6); c.stroke();
    c.lineWidth = 1.6; c.strokeStyle = C.bone; c.beginPath(); c.moveTo(-37, -27 + wag * 0.6); c.lineTo(-41, -24 + wag * 0.4); c.stroke();
    // 胴体（深い胸、くびれた腹）
    c.beginPath();
    c.moveTo(-24, -24);
    c.quadraticCurveTo(-23, -33, -12, -32 - P.breath * 0.4);
    c.quadraticCurveTo(0, -31, 9, -35);
    c.quadraticCurveTo(19, -36, 21, -27);
    c.quadraticCurveTo(21, -15 + P.breath * 0.5, 12, -13);
    c.quadraticCurveTo(2, -14, -4, -20);
    c.quadraticCurveTo(-12, -19, -18, -17);
    c.quadraticCurveTo(-26, -18, -24, -24);
    c.closePath();
    c.fillStyle = C.fur; c.fill(); c.strokeStyle = line; c.lineWidth = 1.1; c.stroke();
    // 盛り上がった後ろ腿と肩の筋肉
    c.fillStyle = C.fur;
    c.beginPath(); c.ellipse(-16, -24, 8, 9.5, 0.25, 0, Math.PI * 2); c.fill(); c.stroke();
    c.beginPath(); c.ellipse(12, -25, 6, 8.5, -0.2, 0, Math.PI * 2); c.fill(); c.stroke();
    if (!fl) {
      // 剥げた脇腹と肋骨
      c.fillStyle = C.flesh; c.beginPath(); c.ellipse(-3, -24, 8, 5, -0.1, 0, Math.PI * 2); c.fill();
      c.strokeStyle = C.bone; c.lineWidth = 1.3; c.beginPath();
      for (let i = 0; i < 3; i++) { const x = -8 + i * 4.5; c.moveTo(x, -29); c.quadraticCurveTo(x + 3.5, -24, x + 1.5, -19.5); }
      c.stroke();
      // 背中の縁の照り返し（暗い背景でも輪郭が読めるように）
      c.strokeStyle = C.rim; c.lineWidth = 1.2;
      c.beginPath(); c.moveTo(-22, -30); c.quadraticCurveTo(-12, -33.5, 0, -32); c.quadraticCurveTo(10, -36.5, 18, -34); c.stroke();
    }
    // 背骨の棘
    c.fillStyle = C.bone; c.beginPath();
    for (let i = 0; i < 6; i++) {
      const x = -17 + i * 5.2, y = -32.5 - (i > 3 ? (i - 3) * 1.1 : 0) + (i < 2 ? 0.6 : 0), hgt = 4 + (i % 2) * 2;
      c.moveTo(x - 1.8, y + 1); c.lineTo(x - 2.6, y - hgt); c.lineTo(x + 1.8, y + 0.5);
    }
    c.fill();
    // 手前の脚（胴の上に重ねる）は体の座標系の外で描くので、ここで首・頭まで描く
    // 首
    R.poly(c, [11, -33, 19, -39, 26, -41, 28, -33, 20, -25], C.fur, line);
    // 頭
    c.save();
    c.translate(27, -38 + P.head);
    c.rotate(P.head * 0.03);
    // 下顎（開閉）
    c.save(); c.translate(1, 1.5); c.rotate(P.jaw * 0.62);
    R.poly(c, [-1, 0, 12, -0.5, 14, 1.5, 3, 4.2], C.fur, line);
    if (!fl) { c.fillStyle = C.teeth; c.beginPath(); for (let i = 0; i < 3; i++) { const x = 4 + i * 3.2; c.moveTo(x, -0.2); c.lineTo(x + 0.8, -2.4); c.lineTo(x + 1.6, -0.2); } c.fill(); }
    c.restore();
    if (!fl && P.jaw > 0.3) { c.fillStyle = C.mouth; R.poly(c, [1, 1, 13, 0.5, 8, 3 + P.jaw * 4, 2, 3], C.mouth); }
    // 頭蓋と上顎
    R.poly(c, [-6, -4, -2, -7, 5, -6.5, 15, -3, 16.5, -0.5, 14, 1.4, 2, 2, -5, 3], C.fur, line);
    R.poly(c, [-3, -6, -9, -12.5, -4.5, -3.5], C.fur, line, 0.9); // 耳
    if (!fl) {
      c.fillStyle = C.teeth; c.beginPath();
      for (let i = 0; i < 4; i++) { const x = 4 + i * 2.8; c.moveTo(x, 1.6); c.lineTo(x + 0.7, 3.8 + (i === 0 ? 1.2 : 0)); c.lineTo(x + 1.4, 1.6); }
      c.fill();
      c.strokeStyle = C.bone; c.lineWidth = 1; c.beginPath(); c.moveTo(3, -6); c.quadraticCurveTo(9, -5.2, 14.5, -2.6); c.stroke();
      c.fillStyle = 'rgba(255,90,40,0.35)'; c.beginPath(); dot(c, 3.2, -3.2, 2.8); c.fill();
      c.fillStyle = C.eye; c.beginPath(); dot(c, 3.2, -3.2, 1.3); c.fill();
    }
    c.restore();
    c.restore(); // 胴の座標系ここまで
    // 手前の脚
    houndLeg(c, hp[0], hp[1], bN[0], bN[1], 14, 14, 7, C.fur, line);
    houndLeg(c, sh[0], sh[1], fN[0], fN[1], 13, 14, 6, C.fur, line);
    c.restore();
  }
  BK.registerEnemy({
    id: 'hound', name: '魔犬', hp: 20, w: 40, h: 48, weight: 0.8, speed: 2.3, speedY: 1.45, score: 300, range: 50,
    entry: 'walk', drop: 'common', bloodCol: '#6a0a10', dieSfx: 'growl', diePitch: 1.7, shadowR: 20,
    draw: drawHound,
    moves: {
      // 噛みつき突進: 身を沈めて唸る（溜め）→ 一気に飛び込んで噛みつく
      bite: {
        dur: 42, ai: { min: 18, max: 80, w: 3, cd: 45, dy: 8 },
        hits: [{ f: [13, 22], x: [8, 56], z: [4, 52], d: 13, dmg: 7, kb: 'light', push: 2.5, sfx: 'slash' }],
        move: [[0, -0.6], [12, 6.5], [22, 1], [26, 0]],
        sfx: [[1, 'growl', { pitch: 1.7, vol: 0.55 }], [13, 'swing', { pitch: 1.4 }]],
      },
      // 飛びかかり: 深く伏せて（溜め）→ 弧を描いて跳びかかり押し倒す
      pounce: {
        dur: 70, ai: { min: 78, max: 150, w: 2, cd: 70, dy: 10 },
        hits: [{ f: [17, 59], x: [0, 52], z: [-10, 52], d: 15, dmg: 9, kb: 'down', push: 3.5 }],
        sfx: [[2, 'growl', { pitch: 1.3, vol: 0.7 }], [16, 'jump']],
        onFrame(e, f) {
          const h = e.hero;
          if (f === 16) leapTo(e, h ? h.x - e.face * 8 : e.x + e.face * 110, h ? h.y : e.y, 6.6, 6.8);
          landing(e, f, 17, 60);
        },
      },
    },
  });

  // ================================================================
  //  トロール troll ── 霧の森や地下に棲む巨躯の怪物。鈍重だが一撃が重い
  // ================================================================
  function trollHead(c, sp, col, sk, pose, opt) {
    const r = sp.headR, tint = opt && opt.tint, line = col('line');
    headSpace(c, sk);
    R.poly(c, [-r * 0.5, -r * 0.35, -r * 1.8, -r * 1.25, -r * 0.8, r * 0.15], col('skinDark'), line); // 尖った耳
    c.beginPath(); c.ellipse(0, -r * 0.1, r * 1.05, r * 0.92, 0, 0, Math.PI * 2);
    c.fillStyle = col('skin'); c.fill(); c.strokeStyle = line; c.lineWidth = 1.1; c.stroke();
    // 突き出た下顎
    R.poly(c, [-r * 0.25, r * 0.3, r * 1.3, r * 0.15, r * 1.55, r * 0.75, r * 1.15, r * 1.3, -r * 0.1, r * 1.15], col('skin'), line);
    if (!tint) {
      R.poly(c, [r * 1.08, r * 0.3, r * 1.24, -r * 0.4, r * 1.4, r * 0.26], col('tusk'), line, 0.8);
      R.poly(c, [r * 0.62, r * 0.32, r * 0.72, -r * 0.08, r * 0.84, r * 0.3], col('tusk'), line, 0.8);
      R.poly(c, [r * 0.05, -r * 0.6, r * 1.18, -r * 0.48, r * 1.08, -r * 0.18, r * 0.2, -r * 0.28], col('skinDark'));
      R.poly(c, [r * 0.95, -r * 0.3, r * 1.45, -r * 0.02, r * 1.02, r * 0.16], col('skinDark'), line, 0.8);
      c.fillStyle = col('eye'); c.beginPath(); dot(c, r * 0.72, -r * 0.08, r * 0.16); c.fill();
      c.fillStyle = 'rgba(0,0,0,0.3)'; c.beginPath(); c.ellipse(-r * 0.3, r * 0.2, r * 0.5, r * 0.6, 0, 0, Math.PI * 2); c.fill();
    }
    c.restore();
  }
  function trollTorso(c, sp, col, sk, pose, opt) {
    const tint = opt && opt.tint, line = col('line');
    // 腰布
    const f0 = tp(sk, 0, sp.waistW * 0.5), b0 = tp(sk, 0, -sp.waistW * 0.55);
    R.poly(c, [f0[0], f0[1] - 2, f0[0] + 2, f0[1] + 15, f0[0] - 5, f0[1] + 12, b0[0] + 2, b0[1] + 16, b0[0] - 2, b0[1] - 2], col('loin'), line);
    R.defaultDraw.torso(c, sp, col, sk);
    // 背中の大きなこぶ
    const a = tp(sk, 0.3, -sp.waistW * 0.45), b = tp(sk, 0.85, -sp.chestW * 0.95), d = tp(sk, 1.08, -sp.chestW * 0.1), e = tp(sk, 0.6, 0);
    c.beginPath(); c.moveTo(a[0], a[1]); c.quadraticCurveTo(b[0], b[1], d[0], d[1]); c.lineTo(e[0], e[1]); c.closePath();
    c.fillStyle = col('skin'); c.fill(); c.strokeStyle = line; c.lineWidth = 1.1; c.stroke();
    // 太鼓腹
    const bl = tp(sk, 0.3, sp.waistW * 0.5);
    c.beginPath(); c.ellipse(bl[0], bl[1], sp.waistW * 0.52, sp.waistW * 0.62, 0, 0, Math.PI * 2);
    c.fillStyle = col('belly'); c.fill(); c.strokeStyle = line; c.stroke();
    if (!tint) {
      c.fillStyle = 'rgba(0,0,0,0.22)';
      c.beginPath(); dot(c, tp(sk, 0.75, -sp.chestW * 0.4)[0], tp(sk, 0.75, -sp.chestW * 0.4)[1], 1.6); dot(c, tp(sk, 0.55, -sp.chestW * 0.35)[0], tp(sk, 0.55, -sp.chestW * 0.35)[1], 1.2); c.fill();
      c.strokeStyle = 'rgba(0,0,0,0.3)'; c.lineWidth = 1;
      c.beginPath(); c.arc(bl[0] + 2, bl[1], sp.waistW * 0.35, -0.9, 0.9); c.stroke();
      c.strokeStyle = 'rgba(210,220,170,0.35)';
      c.beginPath(); c.moveTo(a[0], a[1] - 2); c.quadraticCurveTo(b[0] + 1, b[1] + 1, d[0], d[1] + 1); c.stroke();
    }
  }
  function trollArm(c, sp, col, sh, el, hd, back) {
    R.defaultDraw.arm(c, sp, col, sh, el, hd, back);
    R.circle(c, hd.x, hd.y, sp.armW * 0.7, back ? col('gloveDark') : col('glove'), col('line'));
  }
  function trollClub(c, sp, col, len, pose, opt) {
    const line = col('line');
    c.beginPath();
    c.moveTo(-8, -2.6); c.lineTo(len * 0.4, -3.8); c.quadraticCurveTo(len * 0.8, -8, len + 2, -7); c.quadraticCurveTo(len + 5.5, 0, len + 2, 7);
    c.quadraticCurveTo(len * 0.8, 7.5, len * 0.4, 3.8); c.lineTo(-8, 2.6); c.closePath();
    c.fillStyle = col('wood'); c.fill(); c.strokeStyle = line; c.lineWidth = 1.1; c.stroke();
    if (opt && opt.tint) return;
    // 打ち込まれた古釘と節
    c.fillStyle = col('metal'); c.beginPath();
    for (let i = 0; i < 3; i++) { const x = len * 0.62 + i * 6; c.moveTo(x - 1.2, -6 + i * 0.3); c.lineTo(x + 1, -10.5 - (i % 2) * 1.5); c.lineTo(x + 1.4, -5.8); c.moveTo(x + 1.6, 5.8); c.lineTo(x + 3.6, 10 + (i % 2) * 1.5); c.lineTo(x + 3.8, 5.6); }
    c.fill();
    c.fillStyle = 'rgba(0,0,0,0.3)'; c.beginPath(); c.ellipse(len * 0.5, 0.5, 2.4, 1.3, 0, 0, Math.PI * 2); c.ellipse(len * 0.85, -2, 1.8, 1.1, 0, 0, Math.PI * 2); c.fill();
  }
  BK.registerEnemy({
    id: 'troll', name: 'トロール', hp: 90, w: 44, h: 118, weight: 2.6, speed: 0.75, speedY: 0.55, score: 1500, range: 62,
    entry: 'walk', drop: null, grabbable: false, bloodCol: '#3e4a18', dieSfx: 'growl', diePitch: 0.5, shadowR: 30, downAfter: 8,
    spec: {
      scale: 1.35, thigh: 18, shin: 17, torso: 30, neck: 2, headR: 8.6, upper: 19, fore: 18, legW: 13, armW: 11, waistW: 21, chestW: 30, shoulderOff: 3, weaponLen: 44, gripDist: 10,
      colors: { skin: '#6c7258', skinDark: '#4a4f3c', belly: '#858664', cloth: '#6c7258', clothDark: '#4a4f3c', sleeve: '#6c7258', body: '#6c7258', belt: '#3a2a1a', boot: '#565c46', bootDark: '#3e4232', glove: '#6c7258', gloveDark: '#4a4f3c', loin: '#4a3620', tusk: '#e6dcbc', eye: '#ffd23a', wood: '#5a4028', metal: '#8a8680', line: 'rgba(10,8,6,0.9)' },
      draw: { head: trollHead, torso: trollTorso, arm: trollArm, weapon: trollClub },
    },
    stance: { lean: 24, head: -22, aF: 28, eF: 108, wAbs: -138, wBack: 1, aB: 10, eB: 30, lF: 18, kF: 22, lB: -14, kB: 16 },
    walkOpt: { stride: 15, arm: 12, lockF: true },
    onDie(e, game) { if (game && U.chance(0.6)) game.spawnItem(U.weighted([[5, 'meat'], [3, 'gold'], [2, 'roast']]), e.x, e.y, 40); },
    moves: {
      // 叩きつけ: 棍棒を両手で振り上げ唸る（長い溜め・アーマー）→ 地面ごと叩き潰す
      slam: {
        dur: 70, armor: true, trail: [30, 36], trailCol: '#e8e0c8', ai: { min: 28, max: 96, w: 2, cd: 80, dy: 14 },
        kf: [[0, {}], [14, { aF: 170, eF: 20, wAbs: 190, wBack: 0, grip: 1, lean: -8, head: -10, lF: 16, kF: 14, lB: -16, kB: 10 }],
          [30, { aF: 176, eF: 26, wAbs: 202, wBack: 0, grip: 1, lean: -14, head: -18, lF: 16, kF: 14, lB: -16, kB: 10 }],
          [34, { aF: 75, eF: 5, wAbs: 60, wBack: 0, grip: 1, lean: 36, head: -30, lF: 40, kF: 44, lB: -26, kB: 8, drop: 4 }, 'snap'],
          [52, { aF: 72, eF: 5, wAbs: 56, wBack: 0, grip: 1, lean: 34, head: -28, lF: 40, kF: 44, lB: -26, kB: 8, drop: 4 }], [70, {}]],
        hits: [{ f: [32, 36], x: [15, 104], z: [0, 120], d: 20, dmg: 16, kb: 'down', push: 5, lift: 5, stop: 8, breakArmor: true }],
        move: [[0, 0], [30, 1.2], [34, 0]],
        sfx: [[3, 'growl', { pitch: 0.5 }], [31, 'swingHeavy', { pitch: 0.7 }]],
        onFrame(e, f) {
          if (f === 34) {
            BK.fx.shake(6, 12); BK.audio.sfx('hitHeavy', { pitch: 0.55, vol: 0.8 });
            const x = e.x + e.face * 84;
            BK.fx.dust(x, e.y, 10); BK.fx.ring(x, e.y, 2, 46, 'rgba(210,190,150,0.8)', 16);
          }
        },
      },
      // 裏拳の薙ぎ払い: 棍棒を背中まで引いて（溜め）→ 横薙ぎ
      sweep: {
        dur: 52, trail: [19, 26], trailCol: '#e8e0c8', ai: { min: 10, max: 82, w: 3, cd: 60 },
        kf: [[0, {}], [17, { aF: -60, eF: 40, wAbs: -84, wBack: 1, lean: 10, head: -20, lF: 20, kF: 20, lB: -22, kB: 14, aB: 40, eB: 30 }],
          [22, { aF: 95, eF: 0, wAbs: 100, wBack: 0, lean: 28, head: -30, lF: 34, kF: 28, lB: -26, kB: 8, aB: -30, eB: 20 }, 'snap'],
          [27, { aF: 128, eF: 10, wAbs: 148, wBack: 0, lean: 20, head: -26, lF: 34, kF: 28, lB: -26, kB: 8, aB: -40 }],
          [38, { aF: 120, eF: 20, wAbs: 150, wBack: 0, lean: 18, head: -24 }], [52, {}]],
        hits: [{ f: [20, 25], x: [0, 96], z: [20, 100], d: 18, dmg: 12, kb: 'heavy', push: 6 }],
        move: [[0, 0], [18, 2], [24, 0]],
        sfx: [[2, 'growl', { pitch: 0.65, vol: 0.6 }], [19, 'swingHeavy', { pitch: 0.85 }]],
      },
      // 踏みつけ: 足を高く上げて（溜め）→ 足元を踏み鳴らし、周りを転ばせる
      stomp: {
        dur: 44, ai: { min: 0, max: 42, w: 2.5, cd: 60, dy: 16 },
        kf: [[0, {}], [14, { lF: 80, kF: 95, lB: -12, kB: 10, lean: 12, head: -20, aF: 40, eF: 30, aB: -30, eB: 40 }],
          [18, { lF: 26, kF: 12, lB: -14, kB: 12, lean: 30, head: -32, aF: 30, eF: 30, aB: 10, eB: 30, drop: 5 }, 'snap'],
          [30, { lF: 26, kF: 12, lB: -14, kB: 12, lean: 28, head: -30, drop: 4 }], [44, {}]],
        hits: [{ f: [17, 20], x: [-36, 62], z: [0, 32], d: 22, dmg: 8, kb: 'down', push: 3.5, lift: 3.5, dirAway: true, sfx: 'hit' }],
        sfx: [[2, 'growl', { pitch: 0.6, vol: 0.5 }]],
        onFrame(e, f) {
          if (f === 18) { BK.fx.shake(4, 8); BK.audio.sfx('thud', { pitch: 0.7 }); BK.fx.dust(e.x + e.face * 16, e.y, 9); BK.fx.ring(e.x + e.face * 10, e.y, 2, 60, 'rgba(200,180,140,0.7)', 14); }
        },
      },
    },
  });

  // ================================================================
  //  猿型使徒 leaper ── 長い腕の猿めいた使徒。跳ね回り、空中から襲いかかる
  // ================================================================
  function leaperHead(c, sp, col, sk, pose, opt) {
    const r = sp.headR, tint = opt && opt.tint, line = col('line');
    headSpace(c, sk);
    R.poly(c, [-r * 0.5, -r * 0.65, -r * 2.0, -r * 1.1, -r * 0.9, -r * 0.05], col('skinDark'), line); // 後頭部の骨の突起
    c.beginPath(); c.ellipse(r * 0.1, -r * 0.1, r * 1.0, r * 0.85, 0.1, 0, Math.PI * 2);
    c.fillStyle = col('skin'); c.fill(); c.strokeStyle = line; c.lineWidth = 1.1; c.stroke();
    // 大きく裂けた口（上顎と下顎の間に牙）
    R.poly(c, [r * 0.15, r * 0.3, r * 1.45, r * 0.45, r * 1.35, r * 0.95, r * 0.2, r * 0.8], col('maw'));
    R.poly(c, [r * 0.3, -r * 0.35, r * 1.6, -r * 0.05, r * 1.62, r * 0.38, r * 0.35, r * 0.34], col('skin'), line);
    R.poly(c, [r * 0.2, r * 0.72, r * 1.35, r * 0.82, r * 1.25, r * 1.18, r * 0.2, r * 1.05], col('skinDark'), line);
    if (!tint) {
      c.fillStyle = col('fang'); c.beginPath();
      for (let i = 0; i < 4; i++) { const x = r * (0.55 + i * 0.26); c.moveTo(x, r * 0.36); c.lineTo(x + r * 0.08, r * 0.7); c.lineTo(x + r * 0.16, r * 0.36); }
      for (let i = 0; i < 3; i++) { const x = r * (0.65 + i * 0.26); c.moveTo(x, r * 0.8); c.lineTo(x + r * 0.08, r * 0.52); c.lineTo(x + r * 0.16, r * 0.8); }
      c.fill();
      R.poly(c, [r * 0.1, -r * 0.55, r * 1.1, -r * 0.35, r * 1.0, -r * 0.18, r * 0.2, -r * 0.32], col('skinDark'));
      c.fillStyle = 'rgba(255,210,60,0.35)'; c.beginPath(); dot(c, r * 0.72, -r * 0.08, r * 0.34); c.fill();
      c.fillStyle = col('eye'); c.beginPath(); dot(c, r * 0.72, -r * 0.08, r * 0.17); dot(c, r * 0.32, -r * 0.12, r * 0.12); c.fill();
    }
    c.restore();
  }
  function leaperTorso(c, sp, col, sk, pose, opt) {
    R.defaultDraw.torso(c, sp, col, sk);
    if (opt && opt.tint) return;
    // 背骨の瘤と浮き出た肋
    c.fillStyle = col('skinDark'); c.beginPath();
    for (let i = 0; i < 4; i++) { const p = tp(sk, 0.25 + i * 0.22, -sp.chestW * 0.46); dot(c, p[0], p[1], 2); }
    c.fill();
    c.strokeStyle = 'rgba(40,24,34,0.6)'; c.lineWidth = 1; c.beginPath();
    for (let i = 0; i < 3; i++) { const a = tp(sk, 0.55 + i * 0.13, -sp.chestW * 0.3), b = tp(sk, 0.48 + i * 0.13, sp.chestW * 0.35); c.moveTo(a[0], a[1]); c.quadraticCurveTo((a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + 3, b[0], b[1]); }
    c.stroke();
  }
  function leaperTail(c, sp, col, sk, pose, opt) {
    // 巻き上がった細い尾（先に骨の棘）
    const t = ((opt && opt.t) || 0) * 0.1, h = sk.hip, w = Math.sin(t) * 3;
    c.save(); c.lineCap = 'round'; c.strokeStyle = (opt && opt.tint) || col('skinDark');
    c.lineWidth = 3.6; c.beginPath(); c.moveTo(h.x - 2, h.y - 2); c.quadraticCurveTo(h.x - 17, h.y + 1 + w, h.x - 21, h.y - 11 - w); c.stroke();
    c.lineWidth = 2; c.beginPath(); c.moveTo(h.x - 21, h.y - 11 - w); c.quadraticCurveTo(h.x - 23, h.y - 23 - w, h.x - 14, h.y - 24 - w * 0.5); c.stroke();
    c.restore();
    R.poly(c, [h.x - 14, h.y - 22 - w * 0.5, h.x - 10, h.y - 25 - w * 0.5, h.x - 15, h.y - 26 - w * 0.5], col('claw'), col('line'), 0.8);
  }
  function leaperArm(c, sp, col, sh, el, hd, back, pose, opt) {
    R.defaultDraw.arm(c, sp, col, sh, el, hd, back);
    if (back) atHand(c, el, hd, () => claws(c, 10, (opt && opt.tint) || col('claw'), col('line')));
  }
  function leaperClaw(c, sp, col, len, pose, opt) { claws(c, len, (opt && opt.tint) || col('claw'), col('line')); }
  function leaperHop(e, tx, ty, vz) {
    e.hopTo = { x: tx, y: ty, vz };
    if (e.hero) e.faceHero(); else e.face = U.sign(tx - e.x) || e.face;
    e.startMove(e.def.moves.hop);
  }
  const LEAP_AIR = { lean: 70, head: -60, aF: 120, eF: 10, aB: 110, eB: 20, lF: 10, kF: 30, lB: -40, kB: 20 };
  const LEAP_TUCK = { lean: 25, head: -25, aF: 110, eF: 60, aB: 95, eB: 60, lF: 80, kF: 130, lB: 40, kB: 120 };
  const LEAP_LAND = { lean: 50, head: -38, aF: 45, eF: 40, aB: 30, eB: 40, lF: 70, kF: 120, lB: 20, kB: 110 };
  BK.registerEnemy({
    id: 'leaper', name: '猿型使徒', hp: 44, w: 30, h: 74, weight: 0.9, speed: 1.9, speedY: 1.2, score: 700, range: 46,
    entry: 'walk', drop: 'common', bloodCol: '#5a0a22', dieSfx: 'growl', diePitch: 1.6, shadowR: 18,
    spec: {
      scale: 1.05, thigh: 19, shin: 22, torso: 25, neck: 4, headR: 8, upper: 21, fore: 21, legW: 7.5, armW: 6, waistW: 10, chestW: 17, shoulderOff: 1, weaponLen: 12,
      colors: { skin: '#8d8189', skinDark: '#554650', cloth: '#8d8189', clothDark: '#554650', sleeve: '#8d8189', body: '#857880', belt: '#554650', boot: '#6a5c66', bootDark: '#453a42', glove: '#7d717a', gloveDark: '#51444d', claw: '#e8e0d0', eye: '#ffd83a', maw: '#1e0808', fang: '#f0ead8', line: 'rgba(12,6,10,0.9)' },
      draw: { head: leaperHead, torso: leaperTorso, weapon: leaperClaw, arm: leaperArm, behind: leaperTail },
    },
    stance: { lean: 42, head: -34, aF: 55, eF: 35, aB: 25, eB: 50, lF: 45, kF: 80, lB: -5, kB: 60, w: 0 },
    walkOpt: { stride: 22, arm: 26 },
    think(e, game) {
      const h = game.hero, ai = e.ai;
      if (e.hopCd > 0) e.hopCd--;
      if (e.entering) {
        // 画面外から大きく跳び込んでくる
        if (!e.hopIn) {
          e.hopIn = true;
          const inR = e.x > BK.cam.x + BK.W / 2;
          const tx = inR ? BK.cam.x + BK.W - U.rand(90, 170) : BK.cam.x + U.rand(90, 170);
          leaperHop(e, tx, e.y, 8.2);
          return;
        }
        e.thinkMelee(game); return;
      }
      if (h && !h.dead && ai.mode === 'wait' && !(e.hopCd > 0) && U.chance(0.035)) {
        // 主人公の周りを跳ね回る（ときどき頭上を跳び越えて反対側へ）
        e.hopCd = U.randi(60, 130);
        let side = U.sign(e.x - h.x) || 1;
        if (U.chance(0.3)) side = -side;
        const tx = U.clamp(h.x + side * U.rand(80, 150), BK.cam.x + 30, BK.cam.x + BK.W - 30);
        const ty = U.clamp(h.y + U.rand(-36, 36), 6, BK.DEPTH - 6);
        leaperHop(e, tx, ty, U.rand(6.5, 8.5));
        return;
      }
      e.thinkMelee(game);
    },
    moves: {
      // 爪の二連撃: 腕を振りかぶり（溜め）→ 右・左と引き裂く
      swipe: {
        dur: 42, trail: [10, 24], trailCol: '#ffe0d0', ai: { min: 0, max: 56, w: 3, cd: 40 },
        kf: [[0, {}], [9, { aF: 150, eF: 40, lean: 22, head: -20, aB: -40, eB: 40 }],
          [13, { aF: 60, eF: 10, lean: 50, head: -40, aB: -20, eB: 40 }, 'snap'],
          [19, { aF: 30, eF: 60, aB: 160, eB: 30, lean: 40, head: -34 }],
          [23, { aB: 70, eB: 0, aF: 10, eF: 50, lean: 56, head: -44 }, 'snap'], [30, { aB: 60, eB: 10, aF: 10, eF: 50, lean: 52, head: -40 }], [42, {}]],
        hits: [{ f: [11, 14], x: [5, 54], z: [10, 80], d: 14, dmg: 6, kb: 'light', push: 1.5 },
          { f: [21, 24], x: [5, 56], z: [10, 80], d: 14, dmg: 7, kb: 'heavy', push: 3 }],
        move: [[0, 0], [10, 2], [14, 0], [20, 2.2], [24, 0]],
        sfx: [[1, 'growl', { pitch: 1.9, vol: 0.4 }], [10, 'swing', { pitch: 1.3 }], [20, 'swing', { pitch: 1.2 }]],
      },
      // 飛びかかり: 深く屈んで腕を引き（溜め）→ 大きな弧で跳び、空中から爪で押し倒す
      pounce: {
        dur: 76, ai: { min: 84, max: 190, w: 2, cd: 60, dy: 12 },
        kf: [[0, {}], [12, { lean: 52, head: -42, aF: -85, eF: 25, aB: -95, eB: 20, lF: 70, kF: 125, lB: 20, kB: 115, drop: 2 }],
          [17, LEAP_AIR], [57, LEAP_AIR], [59, LEAP_LAND], [76, {}]],
        hits: [{ f: [15, 58], x: [0, 48], z: [-12, 62], d: 16, dmg: 10, kb: 'down', push: 4 }],
        sfx: [[2, 'growl', { pitch: 1.8, vol: 0.6 }], [13, 'swing', { pitch: 0.9 }]],
        onFrame(e, f) {
          const h = e.hero;
          if (f === 13) leapTo(e, h ? h.x - e.face * 12 : e.x + e.face * 130, h ? h.y : e.y, 6.8, 7.5);
          landing(e, f, 14, 59);
        },
      },
      // 跳躍（移動用・攻撃判定なし）
      hop: {
        dur: 64,
        kf: [[0, {}], [7, LEAP_LAND], [12, LEAP_TUCK], [48, LEAP_TUCK], [50, LEAP_LAND], [64, {}]],
        sfx: [[8, 'jump', { pitch: 0.9 }]],
        onFrame(e, f) {
          if (f === 8) { const o = e.hopTo || { x: e.x, y: e.y, vz: 7 }; leapTo(e, o.x, o.y, o.vz, 7.5); }
          landing(e, f, 9, 50);
        },
      },
    },
  });

  // ================================================================
  //  蛾の妖精もどき moth ── 蛾の翅を生やした子供の使徒（霧の森の「妖精」の成れの果て）
  // ================================================================
  const MOTH_S = 1.25; // 描画倍率
  const MC = { wing: '#806a62', wingFar: '#4a3a3a', vein: 'rgba(40,24,22,0.55)', band: '#c8b090', ring: '#2a1a1a', spot: '#ecc464', body: '#d6ccbc', bodyDark: '#8a7e70', fur: '#f2eadc', eye: '#140a0e', glint: '#ff6a4a', line: 'rgba(14,8,8,0.85)' };
  const MC_FLASH = { wing: '#fff', wingFar: '#fff', vein: 'rgba(0,0,0,0)', band: '#fff', ring: '#fff', spot: '#fff', body: '#fff', bodyDark: '#fff', fur: '#fff', eye: '#fff', glint: '#fff', line: 'rgba(0,0,0,0.3)' };
  function mothWing(c, x, y, ang, len, fill, C, spot) {
    c.save(); c.translate(x, y); c.rotate(ang);
    c.beginPath();
    c.moveTo(0, -1); c.bezierCurveTo(len * 0.3, -len * 0.36, len * 0.78, -len * 0.42, len, -len * 0.2);
    c.quadraticCurveTo(len * 1.05, len * 0.04, len * 0.82, len * 0.1);
    c.quadraticCurveTo(len * 0.45, len * 0.22, 0, 1.5); c.closePath();
    c.fillStyle = fill; c.fill(); c.strokeStyle = C.line; c.lineWidth = 1; c.stroke();
    if (spot) {
      c.strokeStyle = C.band; c.lineWidth = 1.2;
      c.beginPath(); c.moveTo(len * 0.35, -len * 0.27); c.quadraticCurveTo(len * 0.8, -len * 0.32, len * 0.92, -len * 0.05); c.stroke();
      c.fillStyle = C.ring; c.beginPath(); dot(c, len * 0.6, -len * 0.08, len * 0.13); c.fill();
      c.fillStyle = C.spot; c.beginPath(); dot(c, len * 0.6, -len * 0.08, len * 0.085); c.fill();
      c.fillStyle = C.ring; c.beginPath(); dot(c, len * 0.61, -len * 0.08, len * 0.035); c.fill();
      c.strokeStyle = C.vein; c.lineWidth = 0.7;
      c.beginPath(); c.moveTo(2, 0); c.lineTo(len * 0.9, -len * 0.15); c.moveTo(2, 0.5); c.lineTo(len * 0.7, len * 0.13); c.stroke();
    }
    c.restore();
  }
  function mothHind(c, x, y, ang, len, fill, C) {
    c.save(); c.translate(x, y); c.rotate(ang);
    c.beginPath(); c.moveTo(0, -1); c.quadraticCurveTo(len * 0.6, -len * 0.5, len, -len * 0.05); c.quadraticCurveTo(len * 0.72, len * 0.38, 0, 1.5); c.closePath();
    c.fillStyle = fill; c.fill(); c.strokeStyle = C.line; c.lineWidth = 1; c.stroke();
    c.restore();
  }
  function mothAntenna(c, x0, y0, x1, y1, C) {
    c.strokeStyle = C.bodyDark; c.lineWidth = 0.9;
    c.beginPath(); c.moveTo(x0, y0); c.quadraticCurveTo((x0 + x1) / 2 + 3, y1 - 2, x1, y1); c.stroke();
    c.lineWidth = 0.7; c.beginPath();
    for (let i = 1; i <= 4; i++) {
      const k = i / 5, px = U.lerp(x0, x1, k) + Math.sin(k * Math.PI) * 1.5, py = U.lerp(y0, y1, k) - Math.sin(k * Math.PI) * 2;
      c.moveTo(px, py); c.lineTo(px - 1.6, py - 1.8); c.moveTo(px, py); c.lineTo(px + 1.4, py - 1.4);
    }
    c.stroke();
  }
  function drawMoth(c, e) {
    const fl = flashing(e), C = fl ? MC_FLASH : MC, M = e.def.moves, st = e.state;
    const t = e.animT + e.uid * 7;
    let flapN = Math.sin(t * 0.6), rot = 0.12, alpha = 1, hot = 0, lie = 0, reach = 0;
    const bob = Math.sin(t * 0.12) * 1.5;
    if (e.entry === 'rise' && e.entering > 0) alpha = 1 - e.entering / 44;
    if (e.move === M.dive) {
      const f = e.mf;
      if (f < 14) { flapN = 0.85 + Math.sin(t * 1.6) * 0.15; rot = -0.28 * (f / 14); hot = f / 14; reach = f / 14; }
      else if (f < 36) { flapN = -0.3; rot = f < 24 ? 0.7 : -0.25; hot = 1; reach = 1; }
    } else if (e.move === M.dust) {
      const f = e.mf;
      if (f < 12) { flapN = 1; rot = -0.3; hot = 0.6; }
      else if (f < 22) { flapN = -1 + (f - 12) * 0.05; rot = 0.25; }
    } else if (st === 'fall') { rot = t * 0.35; flapN = Math.sin(t * 1.3) * 0.5; }
    else if (st === 'down') { lie = 1; flapN = -0.65 + Math.sin(t * 0.9) * 0.12; }
    else if (st === 'getup') { lie = 1 - Math.min(1, e.st / 18); flapN = Math.sin(t * 1.4); }
    else if (st === 'dead') { lie = 1; flapN = -0.85; alpha = Math.max(0, 1 - Math.max(0, e.st - 10) / 40); }
    else if (st === 'hurt') { rot = -0.4; flapN = Math.sin(t * 1.5); }
    const sx = BK.sx(e.x), sy = BK.sy(e.y, e.z);
    c.save();
    c.translate(sx, sy + (lie ? 0 : bob)); c.scale(e.face * MOTH_S, MOTH_S);
    c.globalAlpha = alpha;
    if (lie) { c.translate(0, -3 * lie); c.rotate(-1.35 * lie); }
    else { c.translate(0, -18); c.rotate(rot); c.translate(0, 18); }
    c.lineCap = 'round';
    const wx = -1, wy = -21, fa = -2.55 + flapN * 0.85;
    // 奥の翅
    mothHind(c, wx - 1, wy + 1, fa - 0.5, 20, C.wingFar, C);
    mothWing(c, wx - 1, wy - 1, fa + 0.16, 31, C.wingFar, C, false);
    // ぶら下がる細い脚
    const lg = Math.sin(t * 0.2) * 1.5;
    c.strokeStyle = C.bodyDark; c.lineWidth = 2;
    c.beginPath(); c.moveTo(-1, -11); c.quadraticCurveTo(-2, -5, -4 + lg, 0); c.moveTo(1.5, -11); c.quadraticCurveTo(2, -5, lg * 0.6, 1); c.stroke();
    // 小さな体
    R.poly(c, [-4, -9, 3, -9, 5, -18, 1, -22, -4, -20], C.body, C.line);
    // 毛羽立った襟
    c.fillStyle = C.fur; c.beginPath();
    for (let i = 0; i < 10; i++) { const a = i / 10 * Math.PI * 2, rr = i % 2 ? 3.8 : 5.8; c.lineTo(1 + Math.cos(a) * rr, -21 + Math.sin(a) * rr * 0.7); }
    c.closePath(); c.fill(); c.strokeStyle = C.line; c.lineWidth = 0.7; c.stroke();
    // 鉤爪の手を前へ伸ばす
    c.strokeStyle = C.body; c.lineWidth = 1.8;
    const hx = 10 + reach * 3, hy = -16 - reach * 1 + Math.sin(t * 0.3) * 0.8;
    c.beginPath(); c.moveTo(3, -18); c.quadraticCurveTo(7, -15.5, hx, hy); c.stroke();
    c.strokeStyle = C.line; c.lineWidth = 0.8; c.beginPath();
    for (let i = -1; i <= 1; i++) { c.moveTo(hx, hy); c.lineTo(hx + 2.6, hy + i * 1.4 + 0.8); }
    c.stroke();
    // 頭と大きな複眼
    R.circle(c, 3.5, -27, 5.3, C.body, C.line);
    c.fillStyle = C.eye; c.beginPath(); c.ellipse(5.6, -27.5, 2.5, 3.3, 0.35, 0, Math.PI * 2); c.fill();
    if (!fl) {
      c.fillStyle = hot > 0.3 ? C.glint : 'rgba(255,255,255,0.75)';
      c.beginPath(); dot(c, 6.2, -28.6, 0.8 + hot * 0.5); c.fill();
      c.strokeStyle = C.line; c.lineWidth = 0.8; c.beginPath(); c.moveTo(6.4, -23.8); c.lineTo(8.4, -24.6); c.stroke();
      c.fillStyle = '#f4ecdc'; R.poly(c, [7, -24, 7.6, -22.4, 8.1, -24.2], '#f4ecdc');
    }
    // 羽毛のような触角
    mothAntenna(c, 4.5, -31.5, -3.5, -40.5, C);
    mothAntenna(c, 2.8, -31.8, -7, -37.5, C);
    // 手前の翅
    mothHind(c, wx, wy + 1, fa - 0.6, 21, C.wing, C);
    mothWing(c, wx, wy, fa, 33, C.wing, C, !fl);
    c.restore();
  }
  function mothInit(e) {
    e.inited = true;
    e.hoverZ = U.rand(50, 68);
    if (e.state === 'air') { e.state = 'idle'; e.z = Math.min(e.z, 160); e.vz = 0; }
    else if (e.z < 10 && e.entry !== 'rise') e.z = 55;
  }
  BK.registerEnemy({
    id: 'moth', name: '蛾の妖精もどき', hp: 16, w: 28, h: 44, weight: 0.8, speed: 1.7, speedY: 1.2, score: 250, range: 110,
    grabbable: false, drop: null, bloodCol: '#b8c070', dieSfx: 'growl', diePitch: 2.3, shadowR: 11,
    draw: drawMoth,
    moves: {
      // 急降下: 翅を広げて舞い上がり（溜め・甲高い声）→ 弧を描いて胸元をかすめる
      dive: {
        dur: 62, ai: { min: 58, max: 165, w: 3, cd: 70, dy: 10 },
        hits: [{ f: [16, 34], x: [-6, 30], z: [-6, 42], d: 14, dmg: 7, kb: 'light', push: 2.2, sfx: 'slash' }],
        sfx: [[2, 'spirit', { pitch: 2.4, vol: 0.5 }], [15, 'swing', { pitch: 1.5 }]],
        onFrame(e, f) {
          const h = e.hero;
          if (f < 14) { e.vx = -e.face * 0.6; e.vz = 1.1; e.vy *= 0.8; return; }
          if (f === 14) {
            e.diveVz = ((h ? h.z : 0) + 26 - e.z) / 10;
            e.vx = e.face * 5.6; e.vy = h ? U.clamp((h.y - e.y) / 12, -1, 1) : 0;
          }
          if (f < 24) e.vz = e.diveVz || -2;
          else if (f < 36) { e.vz = 1.6; e.vx = e.face * 4.4; }
          else { e.vx *= 0.9; e.vz = 0.3; e.vy *= 0.9; }
        },
      },
      // 鱗粉: 翅を大きく反らし（溜め）→ 打ち下ろして毒の鱗粉を浴びせる
      dust: {
        dur: 44, ai: { min: 0, max: 50, w: 2, cd: 60, dy: 12 },
        hits: [{ f: [14, 22], x: [0, 54], z: [-64, 30], d: 16, dmg: 5, kb: 'light', push: 1.5, fx: 'none', sfx: 'hit' }],
        sfx: [[3, 'spirit', { pitch: 2.8, vol: 0.35 }], [13, 'fire', { pitch: 2.2, vol: 0.5 }]],
        onFrame(e, f) {
          e.vx *= 0.8; e.vy *= 0.8;
          if (f === 13) for (let i = 0; i < 12; i++) BK.fx.add({ type: 'dot', x: e.x + e.face * U.rand(4, 22), y: e.y + U.rand(-4, 4), z: e.z + U.rand(0, 26), vx: e.face * U.rand(1.5, 4), vz: U.rand(-1.6, 0.6), drag: 0.9, life: U.randi(18, 30), col: U.choose(['#f0e2a0', '#d8c8ff', '#fff6d0']), size: U.rand(1.2, 2.4) });
        },
      },
    },
    onSpawn(e) { mothInit(e); },
    update(e) {
      if (!e.inited) mothInit(e);
      if (e.dead) return;
      if (e.state === 'air') e.state = 'idle';
      if (e.state === 'fall') { e.vx *= 0.95; return; } // 叩き落とされて落下中（重力は engine に任せる）
      if (e.state === 'down' || e.state === 'getup' || e.state === 'hurt') return;
      if (!e.move) { drag(e, 0.88); hover(e, e.hoverZ + Math.sin(e.animT * 0.06 + e.uid) * 10, 0.06); }
      else e.vz = 0;
    },
    think(e, game) {
      if (e.dead) return;
      e.thinkMelee(game);
      e.vy += Math.sin(e.animT * 0.09 + e.uid) * 0.3;
    },
    onDie(e, game) {
      for (let i = 0; i < 8; i++) BK.fx.add({ type: 'dot', x: e.x + U.rand(-8, 8), y: e.y, z: e.z + U.rand(10, 30), vx: U.rand(-1.2, 1.2), vz: U.rand(-0.5, 1.2), drag: 0.92, life: U.randi(20, 36), col: U.choose(['#f0e2a0', '#d8c8ff']), size: U.rand(1.2, 2.2) });
      if (game) { const it = U.weighted([[72, null], [9, 'bread'], [12, 'silver'], [5, 'wine'], [2, 'dust']]); if (it) game.spawnItem(it, e.x, e.y, 20); }
    },
  });

  // ================================================================
  //  拷問官 inquisitor ── 異端審問の塔に仕える覆面の大男。棘付き棍棒と怪力の締め上げ
  // ================================================================
  function inqHead(c, sp, col, sk, pose, opt) {
    const r = sp.headR, tint = opt && opt.tint, line = col('line');
    headSpace(c, sk);
    // 覆面から覗く無精髭の顎
    R.poly(c, [0, r * 0.35, r * 1.05, r * 0.32, r * 0.95, r * 1.05, 0, r * 1.12], col('skin'), line);
    if (!tint) R.poly(c, [r * 0.15, r * 0.7, r * 0.95, r * 0.66, r * 0.9, r * 1.02, r * 0.1, r * 1.08], 'rgba(40,25,20,0.45)');
    // 先の尖った処刑人の頭巾
    R.poly(c, [r * 1.12, r * 0.42, r * 1.16, -r * 0.4, r * 0.7, -r * 1.05, -r * 0.1, -r * 1.35, -r * 1.0, -r * 2.35, -r * 1.35, -r * 0.9, -r * 1.2, r * 0.4, -r * 0.6, r * 1.2, r * 0.1, r * 0.48], col('hood'), line);
    if (!tint) {
      c.fillStyle = '#000';
      R.poly(c, [r * 0.42, -r * 0.3, r * 0.98, -r * 0.34, r * 0.9, -r * 0.05, r * 0.5, -r * 0.05], '#000');
      c.fillStyle = '#ff4a2a'; c.beginPath(); dot(c, r * 0.76, -r * 0.18, 0.9); c.fill();
      c.strokeStyle = 'rgba(120,110,110,0.45)'; c.lineWidth = 0.9;
      c.beginPath(); c.moveTo(-r * 0.15, -r * 1.3); c.quadraticCurveTo(-r * 0.5, -r * 0.2, -r * 0.3, r * 1.0); c.stroke();
    }
    c.restore();
  }
  function inqTorso(c, sp, col, sk, pose, opt) {
    R.defaultDraw.torso(c, sp, col, sk);
    const bl = tp(sk, 0.3, sp.waistW * 0.42);
    c.beginPath(); c.ellipse(bl[0], bl[1], sp.waistW * 0.5, sp.waistW * 0.52, 0, 0, Math.PI * 2);
    c.fillStyle = col('belly'); c.fill(); c.strokeStyle = col('line'); c.lineWidth = 1.1; c.stroke();
    if (opt && opt.tint) return;
    // 交差する革帯と金具
    const a1 = tp(sk, 1, sp.chestW * 0.45), a2 = tp(sk, 0.05, -sp.waistW * 0.45), b1 = tp(sk, 1, -sp.chestW * 0.35), b2 = tp(sk, 0.05, sp.waistW * 0.5);
    c.strokeStyle = col('strap'); c.lineWidth = 2.6;
    c.beginPath(); c.moveTo(a1[0], a1[1]); c.lineTo(a2[0], a2[1]); c.moveTo(b1[0], b1[1]); c.lineTo(b2[0], b2[1]); c.stroke();
    const m = tp(sk, 0.55, sp.chestW * 0.05);
    c.fillStyle = '#8a8070'; c.beginPath(); dot(c, m[0], m[1], 2); c.fill();
    c.strokeStyle = 'rgba(60,30,20,0.4)'; c.lineWidth = 1;
    const p1 = tp(sk, 0.8, sp.chestW * 0.45), p2 = tp(sk, 0.7, sp.chestW * 0.1);
    c.beginPath(); c.moveTo(p1[0], p1[1]); c.quadraticCurveTo(p2[0] + 2, p2[1] + 3, p2[0], p2[1]); c.stroke();
  }
  function inqApron(c, sp, col, sk, pose, opt) {
    const a = tp(sk, 0.05, sp.waistW * 0.62), b = tp(sk, 0.05, -sp.waistW * 0.05);
    const bot = Math.max(a[1], b[1]) + 30;
    c.beginPath(); c.moveTo(a[0] + 1, a[1] - 2); c.lineTo(a[0] + 5, bot); c.quadraticCurveTo((a[0] + b[0]) / 2 + 2, bot + 3, b[0] - 1, bot + 1); c.lineTo(b[0], b[1] - 2); c.closePath();
    c.fillStyle = col('apron'); c.fill(); c.strokeStyle = col('line'); c.lineWidth = 1.1; c.stroke();
    if (opt && opt.tint) return;
    // 黒ずんだ血の染み
    c.fillStyle = col('stain');
    c.beginPath(); c.ellipse(a[0] - 1, a[1] + 12, 3.2, 5, 0.3, 0, Math.PI * 2); c.ellipse(b[0] + 4, bot - 5, 3, 2.2, 0, 0, Math.PI * 2); c.fill();
  }
  function inqWeapon(c, sp, col, len, pose, opt) {
    const line = col('line');
    R.poly(c, [-9, -2, len * 0.55, -2.8, len * 0.55, 2.8, -9, 2], col('wood'), line);
    R.poly(c, [len * 0.5, -5, len - 2, -6.5, len + 3, -3.5, len + 3, 3.5, len - 2, 6.5, len * 0.5, 5], col('metalDark'), line);
    c.fillStyle = col('metal'); c.beginPath();
    for (let i = 0; i < 4; i++) {
      const x = len * 0.56 + i * (len * 0.46 / 3.5), up = i === 1 || i === 2 ? 1.2 : 0;
      c.moveTo(x - 1.6, -5.2 - up); c.lineTo(x, -11 - up); c.lineTo(x + 1.6, -5.2 - up);
      c.moveTo(x - 1.6, 5.2 + up); c.lineTo(x, 11 + up); c.lineTo(x + 1.6, 5.2 + up);
    }
    c.moveTo(len + 3, -2); c.lineTo(len + 8.5, 0); c.lineTo(len + 3, 2);
    c.fill();
    if (!(opt && opt.tint)) { c.fillStyle = 'rgba(90,10,10,0.55)'; c.fillRect(len * 0.72, -4, 5, 3); }
  }
  function inqShakeOff(e, h) {
    e.drawLayer = 0;
    if (e.move) e.endMove();
    e.state = 'hurt'; e.hitstun = 36; e.vx = -e.face * 2.5; e.flash = 6;
    e.hp = Math.max(1, e.hp - 4);
    e.ai.mode = 'recover'; e.ai.cd = 50;
    BK.audio.sfx('hit', { pitch: 0.8 });
  }
  BK.registerEnemy({
    id: 'inquisitor', name: '拷問官', hp: 80, w: 38, h: 108, weight: 2, speed: 0.9, speedY: 0.65, score: 1500, range: 58,
    entry: 'walk', drop: 'common', grabbable: false, bloodCol: '#8a0c14', dieSfx: 'growl', diePitch: 0.75, shadowR: 24, downAfter: 6,
    spec: {
      scale: 1.2, thigh: 21, shin: 20, torso: 31, neck: 3, headR: 8.2, upper: 17, fore: 16, legW: 12, armW: 9.5, waistW: 22, chestW: 27, shoulderOff: 3, weaponLen: 44, gripDist: 10,
      colors: { skin: '#c49a82', hair: '#1a1210', hood: '#1a1416', cloth: '#2a221e', clothDark: '#1c1714', sleeve: '#c49a82', body: '#c49a82', belly: '#cda48a', belt: '#2a1a10', boot: '#221a16', bootDark: '#161110', glove: '#4a3020', gloveDark: '#36241a', strap: '#3a2618', apron: '#5c3e2a', stain: '#3e0a0c', metal: '#8e8a84', metalDark: '#3e3a36', wood: '#4a3020', grip: '#2a1a10', line: 'rgba(10,6,6,0.9)' },
      draw: { head: inqHead, torso: inqTorso, chest: inqApron, weapon: inqWeapon },
    },
    stance: { lean: 8, head: 6, aF: 35, eF: 105, wAbs: -135, wBack: 1, aB: 12, eB: 30, lF: 14, kF: 12, lB: -14, kB: 10 },
    walkOpt: { stride: 18, arm: 10, lockF: true },
    onSpawn(e) { e.onShakeOff = h => inqShakeOff(e, h); },
    update(e) { if (!e.onShakeOff) e.onShakeOff = h => inqShakeOff(e, h); },
    moves: {
      // 袈裟懸け: 棍棒を大きく振りかぶり（溜め）→ 斜めに振り下ろす
      swing: {
        dur: 54, trail: [18, 24], ai: { min: 18, max: 80, w: 3, cd: 60 },
        kf: [[0, {}], [16, { aF: 150, eF: 60, wAbs: 232, wBack: 0, lean: -10, head: 0, lF: 12, kF: 12, lB: -18, kB: 10, aB: -30, eB: 30 }],
          [21, { aF: 80, eF: 0, wAbs: 70, lean: 24, lF: 36, kF: 32, lB: -26, kB: 6, aB: -20, eB: 30 }, 'snap'],
          [36, { aF: 62, eF: 5, wAbs: 44, lean: 22, lF: 34, kF: 30, lB: -26, kB: 6, aB: -20 }], [54, {}]],
        hits: [{ f: [19, 22], x: [10, 94], z: [5, 115], d: 16, dmg: 12, kb: 'heavy', push: 4 }],
        move: [[0, 0], [17, 2], [22, 0]],
        sfx: [[3, 'growl', { pitch: 0.7, vol: 0.5 }], [17, 'swingHeavy']],
      },
      // 脳天割り: 両手で高々と掲げ（長い溜め・アーマー）→ 叩き潰す
      smash: {
        dur: 64, armor: true, trail: [24, 28], ai: { min: 25, max: 82, w: 1.5, cd: 80 },
        kf: [[0, {}], [22, { aF: 175, eF: 15, wAbs: 192, wBack: 0, grip: 1, lean: -12, head: -6, lF: 14, kF: 12, lB: -16, kB: 10 }],
          [26, { aF: 80, eF: 0, wAbs: 75, grip: 1, lean: 32, head: 10, lF: 40, kF: 40, lB: -28, kB: 6, drop: 4 }, 'snap'],
          [44, { aF: 78, eF: 0, wAbs: 72, grip: 1, lean: 30, head: 10, lF: 40, kF: 40, lB: -28, kB: 6, drop: 4 }], [64, {}]],
        hits: [{ f: [24, 27], x: [10, 90], z: [0, 118], d: 18, dmg: 15, kb: 'down', push: 5, lift: 5, stop: 8 }],
        move: [[0, 0], [22, 1.4], [26, 0]],
        sfx: [[4, 'growl', { pitch: 0.6, vol: 0.6 }], [23, 'swingHeavy', { pitch: 0.8 }]],
        onFrame(e, f) { if (f === 26) { BK.fx.shake(5, 10); BK.fx.dust(e.x + e.face * 76, e.y, 8); } },
      },
      // 掴み: 空いた手を高く掲げ指を広げる（溜め）→ 踏み込んで喉を掴む → 締め上げへ
      seize: {
        dur: 46, ai: { min: 8, max: 56, w: 1.6, cd: 90, cond: e => canGrab(e.hero) },
        kf: [[0, {}], [14, { aB: 150, eB: 10, aF: -20, eF: 30, wAbs: -160, wBack: 1, lean: -6, head: -4, lF: 14, kF: 12, lB: -16, kB: 10 }],
          [20, { aB: 90, eB: 0, aF: -30, eF: 20, wAbs: -170, wBack: 1, lean: 22, head: 6, lF: 36, kF: 30, lB: -26, kB: 6 }, 'snap'],
          [32, { aB: 88, eB: 5, aF: -30, eF: 20, wAbs: -170, wBack: 1, lean: 20, lF: 34, kF: 28, lB: -26, kB: 6 }], [46, {}]],
        move: [[0, 0], [16, 3.6], [24, 0]],
        sfx: [[2, 'growl', { pitch: 0.55, vol: 0.7 }], [17, 'swing', { pitch: 0.6 }]],
        onFrame(e, f) {
          if (f < 17 || f > 25) return;
          const h = e.hero, sc = e.spec.scale || 1;
          if (!canGrab(h)) return;
          const d = (h.x - e.x) * e.face;
          if (d > 8 && d < 38 * sc + 22 && Math.abs(h.y - e.y) < 12 && e.grabHero(h, { escapeNeed: 14 })) e.startMove(e.def.moves.crush);
        },
      },
      // 締め上げ（掴み成功時のみ）: 片手で吊り上げて生気を絞り、最後に投げ捨てる
      crush: {
        dur: 124,
        kf: [[0, { aB: 105, eB: 15, aF: -20, eF: 30, wAbs: -160, wBack: 1, lean: 2, head: 4 }],
          [60, { aB: 118, eB: 8, aF: -24, eF: 34, wAbs: -160, wBack: 1, lean: -4, head: 0 }],
          [98, { aB: 150, eB: 12, aF: -30, eF: 30, wAbs: -165, wBack: 1, lean: -12, head: -8 }],
          [104, { aB: 55, eB: 0, aF: -20, eF: 30, wAbs: -150, wBack: 1, lean: 30, head: 10, lF: 36, kF: 30, lB: -26, kB: 6 }, 'snap'], [124, {}]],
        sfx: [[98, 'swingHeavy', { pitch: 0.8 }]],
        onFrame(e, f) {
          const h = e.grabbing;
          if (f < 103) {
            if (!h || h.grabbedBy !== e || h.dead) { e.drawLayer = 0; e.endMove(); e.ai.cd = 40; return; }
            const sc = e.spec.scale || 1;
            e.drawLayer = 1; // 喉を掴む手が見えるよう拷問官を手前に描く
            h.x = e.x + e.face * 35 * sc; h.y = e.y; h.z = Math.min(20, f * 1.5) + (f >= 98 ? (f - 98) * 3 : 0);
            h.vx = 0; h.vy = 0; h.vz = 0; h.face = -e.face;
            if (f > 12 && f % 22 === 0) {
              e.drainHero(3);
              BK.fx.shake(2, 6); BK.audio.sfx('grab', { pitch: 0.7 });
              BK.fx.blood(h.x, h.y, h.z + h.h * 0.75, -e.face, 3);
            }
          } else if (f === 103 && h) {
            // 投げ捨てる
            e.releaseHero(); e.drawLayer = 0;
            h.z = Math.max(h.z, 20);
            h.takeHit(e, { dmg: 10, kb: 'down', push: 6, lift: 6 }, e.face);
            BK.fx.shake(4, 10); BK.audio.sfx('hitHeavy', { pitch: 0.8 });
          }
        },
        onEnd(e) { e.drawLayer = 0; if (e.grabbing) e.releaseHero(); },
      },
    },
  });

  // ================================================================
  //  異形の使徒 apostle ── 蝕の夜に現れる異形。肋が剥き出しの胴、背から生えた三本目の腕、角
  //   palette: flesh（赤い剥き身・胴の口）/ bone（白骨の外殻）/ horn（黒い獣皮と巨大な角）
  // ================================================================
  function apHead(c, sp, col, sk, pose, opt) {
    const r = sp.headR, k = kindOf(sp, opt), tint = opt && opt.tint, line = col('line');
    headSpace(c, sk);
    const hl = k === 'horn' ? 1.7 : k === 'bone' ? 0.75 : 1.05;
    // 後ろへ反り返る角
    c.beginPath();
    c.moveTo(-r * 0.55, -r * 0.55);
    c.quadraticCurveTo(-r * (1.2 + hl * 0.9), -r * (0.8 + hl * 0.5), -r * (0.7 + hl * 1.1), -r * (1.2 + hl * 1.25));
    c.quadraticCurveTo(-r * (0.6 + hl * 0.5), -r * (0.9 + hl * 0.5), r * 0.2, -r * 0.85);
    c.closePath(); c.fillStyle = col('horn'); c.fill(); c.strokeStyle = line; c.lineWidth = 1; c.stroke();
    if (k === 'horn') {
      // 巻いた雄羊の角（手前）
      c.beginPath(); c.moveTo(-r * 0.3, -r * 0.6); c.quadraticCurveTo(-r * 1.6, -r * 1.2, -r * 1.3, r * 0.2); c.quadraticCurveTo(-r * 0.9, r * 0.9, -r * 0.2, r * 0.55);
      c.quadraticCurveTo(-r * 0.9, r * 0.3, -r * 0.8, -r * 0.2); c.quadraticCurveTo(-r * 0.6, -r * 0.5, 0, -r * 0.4); c.closePath();
      c.fillStyle = col('horn'); c.fill(); c.strokeStyle = line; c.stroke();
    }
    // 頭蓋
    c.beginPath(); c.ellipse(0, -r * 0.1, r * 1.0, r * 0.95, 0, 0, Math.PI * 2);
    c.fillStyle = col(k === 'bone' ? 'bone' : 'skin'); c.fill(); c.strokeStyle = line; c.lineWidth = 1.1; c.stroke();
    // 裂けた顎（常に開いている）
    R.poly(c, [r * 0.0, r * 0.2, r * 1.45, r * 0.15, r * 1.3, r * 1.0, r * 0.2, r * 1.15], col('maw'), line);
    R.poly(c, [r * 0.2, r * 0.85, r * 1.3, r * 0.95, r * 1.15, r * 1.4, r * 0.1, r * 1.25], col(k === 'bone' ? 'bone' : 'skinDark'), line);
    if (!tint) {
      c.fillStyle = col('bone'); c.beginPath();
      for (let i = 0; i < 5; i++) { const x = r * (0.25 + i * 0.22); c.moveTo(x, r * 0.18); c.lineTo(x + r * 0.08, r * 0.55 + (i % 2) * r * 0.15); c.lineTo(x + r * 0.16, r * 0.18); }
      for (let i = 0; i < 4; i++) { const x = r * (0.35 + i * 0.22); c.moveTo(x, r * 0.92); c.lineTo(x + r * 0.08, r * 0.62); c.lineTo(x + r * 0.16, r * 0.92); }
      c.fill();
      if (pose.acid) {
        // 酸を溜めた喉と口の緑の光（酸の唾の予兆）
        const p = 0.8 + Math.sin(((opt && opt.t) || 0) * 0.8) * 0.2;
        c.fillStyle = 'rgba(150,240,70,0.45)'; c.beginPath(); dot(c, r * 0.9, r * 0.65, r * 0.75 * p); c.fill();
        c.fillStyle = '#d8ff8a'; c.beginPath(); dot(c, r * 0.9, r * 0.65, r * 0.32 * p); c.fill();
      }
      if (k === 'bone') {
        // 眼窩の奥に赤い光
        R.poly(c, [r * 0.2, -r * 0.55, r * 0.95, -r * 0.5, r * 0.9, -r * 0.05, r * 0.3, -r * 0.1], '#0c0808');
        c.fillStyle = col('eye'); c.beginPath(); dot(c, r * 0.62, -r * 0.3, r * 0.14); c.fill();
      } else {
        // 顔じゅうに散らばる目
        const eyes = k === 'horn' ? [[0.62, -0.35, 0.2], [0.2, -0.45, 0.12]] : [[0.65, -0.35, 0.19], [0.25, -0.55, 0.13], [0.15, -0.1, 0.11], [0.85, 0.02, 0.1]];
        for (const [ex, ey, er] of eyes) {
          c.fillStyle = '#140404'; c.beginPath(); dot(c, r * ex, r * ey, r * er * 1.5); c.fill();
          c.fillStyle = col('eye'); c.beginPath(); dot(c, r * ex, r * ey, r * er); c.fill();
        }
      }
    }
    c.restore();
  }
  function apTorso(c, sp, col, sk, pose, opt) {
    const k = kindOf(sp, opt), tint = opt && opt.tint;
    R.defaultDraw.torso(c, sp, col, sk);
    if (tint) return;
    const cw = sp.chestW, ww = sp.waistW;
    // 剥き出しの胸腔と肋骨
    const q = [tp(sk, 0.42, ww * 0.42), tp(sk, 0.93, cw * 0.46), tp(sk, 0.93, cw * 0.02), tp(sk, 0.45, -ww * 0.05)];
    R.poly(c, [q[0][0], q[0][1], q[1][0], q[1][1], q[2][0], q[2][1], q[3][0], q[3][1]], col('cavity'));
    c.strokeStyle = col('bone'); c.lineWidth = 1.8; c.beginPath();
    for (let i = 0; i < 4; i++) {
      const t = 0.52 + i * 0.12, a = tp(sk, t, -cw * 0.02), b = tp(sk, t - 0.07, cw * 0.47), m = tp(sk, t + 0.03, cw * 0.28);
      c.moveTo(a[0], a[1]); c.quadraticCurveTo(m[0], m[1], b[0], b[1]);
    }
    const s0 = tp(sk, 0.45, cw * 0.36), s1 = tp(sk, 0.95, cw * 0.4);
    c.moveTo(s0[0], s0[1]); c.lineTo(s1[0], s1[1]);
    c.stroke();
    if (k === 'flesh') {
      // 腹の縦に裂けた口
      const m = tp(sk, 0.18, ww * 0.35);
      c.fillStyle = col('maw'); c.beginPath(); c.ellipse(m[0], m[1], 2.6, 6, 0.15, 0, Math.PI * 2); c.fill();
      c.fillStyle = col('bone'); c.beginPath();
      for (let i = 0; i < 3; i++) { const y = m[1] - 4 + i * 3.2; c.moveTo(m[0] - 2.2, y); c.lineTo(m[0] + 0.6, y + 1); c.lineTo(m[0] - 2.2, y + 2); c.moveTo(m[0] + 2.4, y + 1); c.lineTo(m[0] - 0.4, y + 2); c.lineTo(m[0] + 2.4, y + 3); }
      c.fill();
    } else {
      // 背中に並ぶ骨の棘
      c.fillStyle = col('horn'); c.beginPath();
      for (let i = 0; i < 4; i++) {
        const t = 0.25 + i * 0.22, a = tp(sk, t, -ww * 0.5 - (cw - ww) * t * 0.5), b = tp(sk, t + 0.08, -ww * 0.5 - (cw - ww) * t * 0.5 - 9), d = tp(sk, t + 0.12, -ww * 0.45 - (cw - ww) * t * 0.5);
        c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.lineTo(d[0], d[1]);
      }
      c.fill();
    }
  }
  /** 背中から生えた三本目の腕（前の腕の動きに少し遅れて連動し、ぴくぴく蠢く） */
  function apExtraArm(c, sp, col, sk, pose, opt) {
    const t = (opt && opt.t) || 0, line = col('line');
    const base = tp(sk, 0.9, -sp.chestW * 0.42);
    const a1 = 150 + ((pose.aF || 50) - 50) * 0.4 + Math.sin(t * 0.09) * 12;
    const a2 = a1 - 70 + Math.sin(t * 0.13 + 1) * 16;
    const L1 = sp.upper * 1.05, L2 = sp.fore;
    const e1 = [base[0] + Math.sin(a1 * D) * L1, base[1] + Math.cos(a1 * D) * L1];
    const h1 = [e1[0] + Math.sin(a2 * D) * L2, e1[1] + Math.cos(a2 * D) * L2];
    const dk = (opt && opt.tint) || col('skinDark');
    R.limb(c, base[0], base[1], e1[0], e1[1], sp.armW * 0.8, sp.armW * 0.6, dk, line);
    R.limb(c, e1[0], e1[1], h1[0], h1[1], sp.armW * 0.6, sp.armW * 0.45, dk, line);
    c.save(); c.translate(h1[0], h1[1]); c.rotate(Math.atan2(Math.cos(a2 * D), Math.sin(a2 * D)));
    claws(c, 11, (opt && opt.tint) || col('claw'), line);
    c.restore();
  }
  function apArm(c, sp, col, sh, el, hd, back, pose, opt) {
    R.defaultDraw.arm(c, sp, col, sh, el, hd, back);
    if (back) atHand(c, el, hd, () => claws(c, 14, (opt && opt.tint) || col('claw'), col('line')));
  }
  function apClaw(c, sp, col, len, pose, opt) { claws(c, len, (opt && opt.tint) || col('claw'), col('line')); }
  function acidDraw(c, sx, sy, p) {
    c.fillStyle = 'rgba(150,230,60,0.35)'; c.beginPath(); c.ellipse(sx - p.face * 4, sy, 9, 6, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#86c828'; c.beginPath(); c.ellipse(sx, sy, 6, 5, p.t * 0.3, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#e4ff9a'; c.beginPath(); dot(c, sx + p.face * 1.5, sy - 1.5, 1.8); c.fill();
  }
  function acidSplash(x, y, z) {
    for (let i = 0; i < 7; i++) BK.fx.add({ type: 'dot', x, y: y + U.rand(-3, 3), z: z + 4, vx: U.rand(-2, 2), vz: U.rand(1, 3.5), g: 0.25, life: U.randi(14, 24), col: U.choose(['#9adf3a', '#d8ff80']), size: U.rand(1.5, 2.6) });
    BK.audio.sfx('fire', { pitch: 1.8, vol: 0.5 });
  }
  /** 地面に残る酸だまり（少しずつ焼く） */
  function acidPool(owner, x, y) {
    if (!BK.game) return;
    BK.game.addProjectile(new BK.Projectile({
      x, y, z: 6, vx: 0, w: 46, h: 14, depth: 14, team: 'enemy', owner, dmg: 3, kb: 'light', push: 0.6, stop: 1, life: 80, pierce: 99, noShadow: true, sfx: 'fire', fx: 'none',
      tick(p) {
        if (p.t % 20 === 0) p.hit.clear();
        if (p.t % 7 === 0) BK.fx.add({ type: 'smoke', x: p.x + U.rand(-18, 18), y: p.y + U.rand(-4, 4), z: 2, vz: U.rand(0.4, 1), life: 18, size: U.rand(3, 6), col: 'rgba(150,220,70,0.3)' });
      },
      drawFn(c, sx, sy, p) {
        const k = Math.min(1, p.life / 20);
        c.globalAlpha = 0.5 * k; c.fillStyle = '#5a9a18'; c.beginPath(); c.ellipse(sx, sy + 6, p.w / 2, 5, 0, 0, Math.PI * 2); c.fill();
        c.globalAlpha = 0.7 * k; c.fillStyle = '#c8f070'; c.beginPath(); c.ellipse(sx - 5, sy + 5, p.w / 5, 1.6, 0, 0, Math.PI * 2); c.fill();
        c.globalAlpha = 1;
      },
    }));
  }
  const sp0 = e => e.spec.headR * 1.2; // 口の位置（頭の中心から前方）
  function acidSpit(e) {
    const h = e.hero, sc = e.spec.scale || 1, sk = e.sk;
    const mx = sk ? e.x + (sk.headC.x + sp0(e)) * sc * e.face : e.x + e.face * 30;
    const mz = sk ? e.z - (sk.headC.y + sp0(e) * 0.3) * sc : e.z + 96;
    const adx = h ? Math.abs(h.x - mx) : 150;
    BK.audio.sfx('fire', { pitch: 1.6, vol: 0.8 });
    e.shoot({
      x: mx, z: mz, vx: e.face * U.clamp(adx / 34, 2.4, 5.5), vz: 2.2, grav: 0.2, w: 14, h: 14, dmg: 8, kb: 'light', push: 2, life: 120, sfx: 'fire', fx: 'none',
      tick(p) { if (p.t % 3 === 0) BK.fx.add({ type: 'dot', x: p.x, y: p.y, z: p.z, vx: -p.vx * 0.1, vz: -0.4, g: 0.1, life: 14, col: '#9adf3a', size: 2 }); },
      onHit(p) { acidSplash(p.x, p.y, p.z); },
      onGround(p) { p.remove = true; acidSplash(p.x, p.y, 0); acidPool(e, p.x, p.y); },
      drawFn: acidDraw,
    });
  }
  BK.registerEnemy({
    id: 'apostle', name: '異形の使徒', hp: 70, w: 34, h: 112, weight: 1.6, speed: 1.1, speedY: 0.8, score: 1200, range: 56,
    entry: 'walk', drop: 'common', grabbable: true, bloodCol: '#5a0810', dieSfx: 'growl', diePitch: 0.6, shadowR: 22, downAfter: 5,
    spec: {
      scale: 1.22, thigh: 22, shin: 23, torso: 31, neck: 5, headR: 9, upper: 20, fore: 19, legW: 11, armW: 8.5, waistW: 15, chestW: 25, shoulderOff: 2, weaponLen: 15,
      colors: { kind: 'flesh', skin: '#9a4a44', skinDark: '#5e2426', cloth: '#9a4a44', clothDark: '#5e2426', sleeve: '#9a4a44', body: '#9a4a44', belt: '#4a1a1a', boot: '#5e2426', bootDark: '#3e1618', glove: '#8a3c38', gloveDark: '#5a2224', bone: '#e2d4b4', horn: '#d8c8a0', cavity: '#2a0808', eye: '#ffe24a', maw: '#1a0406', claw: '#ece0c4', line: 'rgba(12,4,4,0.9)' },
      draw: { head: apHead, torso: apTorso, weapon: apClaw, arm: apArm, behind: apExtraArm },
    },
    palettes: {
      flesh: { kind: 'flesh' },
      bone: { kind: 'bone', skin: '#c2b9a2', skinDark: '#6e6656', cloth: '#b0a68e', clothDark: '#6e6656', sleeve: '#c2b9a2', body: '#b8ae96', boot: '#6e6656', bootDark: '#4a4438', glove: '#b0a68e', gloveDark: '#7e7662', bone: '#f2ecdc', horn: '#e8e0cc', cavity: '#1a1410', eye: '#ff4020', belt: '#3a3228', maw: '#140c08' },
      horn: { kind: 'horn', skin: '#4a262c', skinDark: '#2a1216', cloth: '#4a262c', clothDark: '#2a1216', sleeve: '#4a262c', body: '#4a262c', boot: '#2a1216', bootDark: '#1a0a0c', glove: '#3e1e22', gloveDark: '#2a1216', horn: '#c2ae86', bone: '#d0c09a', eye: '#ff8a1a', cavity: '#120404', belt: '#1a0a0c' },
    },
    stance: { lean: 18, head: -10, aF: 50, eF: 60, aB: 35, eB: 55, lF: 22, kF: 26, lB: -16, kB: 20, w: 0 },
    walkOpt: { stride: 18, arm: 14 },
    onSpawn(e) { if (e.opt.palette === 'horn' && !e.opt.hp) { e.hp = e.maxHp = Math.round(e.maxHp * 1.15); } },
    moves: {
      // 爪の三連撃: 両腕を掲げて咆える（溜め）→ 右・左・両腕の振り下ろし（ダウン）
      combo: {
        dur: 72, trail: [15, 42], trailCol: '#ffd8c8', ai: { min: 0, max: 64, w: 3, cd: 70 },
        kf: [[0, {}], [14, { aF: 150, eF: 30, aB: 140, eB: 30, lean: -12, head: -30 }],
          [18, { aF: 60, eF: 10, aB: 120, eB: 40, lean: 26, head: 0 }, 'snap'],
          [24, { aF: 30, eF: 40, aB: 150, eB: 30, lean: 20, head: -5 }],
          [28, { aB: 60, eB: 10, aF: 20, eF: 60, lean: 30, head: 0 }, 'snap'],
          [36, { aF: 165, eF: 20, aB: 160, eB: 20, lean: -8, head: -20 }],
          [41, { aF: 70, eF: 0, aB: 60, eB: 0, lean: 36, head: 10, lF: 36, kF: 34, lB: -26, kB: 6, drop: 3 }, 'snap'],
          [56, { aF: 66, eF: 5, aB: 56, eB: 5, lean: 34, head: 8, lF: 36, kF: 34, lB: -26, kB: 6, drop: 3 }], [72, {}]],
        hits: [{ f: [16, 19], x: [5, 64], z: [20, 115], d: 16, dmg: 8, kb: 'light', push: 1.5 },
          { f: [26, 29], x: [5, 64], z: [20, 115], d: 16, dmg: 8, kb: 'light', push: 1.5 },
          { f: [39, 42], x: [5, 72], z: [0, 120], d: 16, dmg: 13, kb: 'down', push: 5 }],
        move: [[0, 0], [15, 2], [19, 0], [25, 2], [29, 0], [38, 2.5], [42, 0]],
        sfx: [[2, 'growl', { pitch: 0.7, vol: 0.8 }], [15, 'swing'], [25, 'swing'], [38, 'swingHeavy']],
        onFrame(e, f) { if (f === 41) { BK.fx.shake(3, 6); BK.fx.dust(e.x + e.face * 50, e.y, 5); } },
      },
      // 酸の唾: 首を反らし喉を膨らませる（溜め・口に緑の光）→ 弧を描く酸を吐く。地面に酸だまりが残る
      spit: {
        dur: 44, ai: { min: 96, max: 250, w: 2, cd: 110, dy: 18 },
        kf: [[0, {}], [3, { lean: 12, head: -12, acid: 1 }], [16, { lean: -14, head: -40, aF: 30, eF: 40, aB: -20, eB: 40, acid: 1 }],
          [21, { lean: 26, head: 20, aF: 20, eF: 40, aB: -30, eB: 40 }, 'snap'], [30, { lean: 22, head: 16, aF: 22, eF: 40, aB: -30, eB: 40 }], [44, {}]],
        sfx: [[3, 'growl', { pitch: 0.9, vol: 0.6 }]],
        onFrame(e, f) {
          if (f > 3 && f < 20 && f % 3 === 0 && e.sk) {
            const sc = e.spec.scale || 1;
            BK.fx.add({ type: 'dot', x: e.x + (e.sk.headC.x + 8) * sc * e.face, y: e.y, z: e.z - (e.sk.headC.y - 4) * sc, vx: U.rand(-0.4, 0.4), vz: -0.6, g: 0.1, life: 14, col: '#b0f050', size: 2 });
          }
          if (f === 21) acidSpit(e);
        },
      },
      // 角の突進: 頭を低くして地を掻き（溜め）→ 角で突っ込む
      gore: {
        dur: 58, ai: { min: 62, max: 150, w: 1.2, cd: 90, dy: 10 },
        kf: [[0, {}], [16, { lean: 48, head: 36, aF: -30, eF: 40, aB: -40, eB: 40, lF: 40, kF: 60, lB: -20, kB: 40 }],
          [19, { lean: 55, head: 36, aF: -40, eF: 30, aB: -50, eB: 30, lF: 55, kF: 40, lB: -40, kB: 10 }],
          [24, { lean: 55, head: 36, aF: -40, eF: 30, aB: -50, eB: 30, lF: -20, kF: 20, lB: 45, kB: 50 }],
          [29, { lean: 55, head: 36, aF: -40, eF: 30, aB: -50, eB: 30, lF: 55, kF: 40, lB: -40, kB: 10 }],
          [34, { lean: 55, head: 36, aF: -40, eF: 30, aB: -50, eB: 30, lF: -20, kF: 20, lB: 45, kB: 50 }],
          [40, { lean: 30, head: 10, aF: 20, eF: 40, aB: 10, eB: 40, lF: 30, kF: 30, lB: -20, kB: 10 }], [58, {}]],
        hits: [{ f: [18, 38], x: [10, 58], z: [40, 115], d: 16, dmg: 11, kb: 'down', push: 5 }],
        move: [[0, 0], [17, 6], [34, 4], [40, 0]],
        sfx: [[2, 'growl', { pitch: 0.55 }], [17, 'swingHeavy']],
        onFrame(e, f) { if (f >= 17 && f <= 36 && f % 4 === 0) BK.fx.dust(e.x - e.face * 8, e.y, 2); },
      },
    },
  });
})(window.BK);

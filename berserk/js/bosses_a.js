'use strict';
/* =====================================================================
 *  bosses_a.js ── ボス: 蛇男爵（R1） / 伯爵（R2） / 不死のゾッド（R3）
 *
 *  共通の約束（フェアで読みやすいボス戦のために）:
 *   ・すべての攻撃に予備動作がある: 武器・目・角の「きらめき」、構え、
 *     床の危険表示（範囲 / 突進レーン / 落下地点の円）。
 *   ・大技は armor（のけぞらない）で、予備動作中は体が赤く明滅する。
 *     その代わり終わり際に大きな隙がある（剣が地面に刺さる・潰れて伸びる等）。
 *   ・短時間に殴られ続けると「振り払い」（予備動作つきの全周攻撃）で仕切り直す。
 *   ・体力 50% で第2形態（速くなる・新技）。形態変化の演出中は無敵。
 *   ・死亡時は独自状態 'dying' で崩れ落ち、上から灰になって消える。
 *   ・床の危険表示はキャラより奥に描きたいので、無害な Projectile の
 *     drawShadow（影の描画タイミング）を使って描く（floor painter）。
 *   ・def.moves = 第1形態の技表（ギャラリー用）、def.moves2 = 第2形態（速い）。
 * ===================================================================== */
(function (BK) {
  const U = BK.U, R = BK.rig, D = U.DEG;
  const TAU = Math.PI * 2;

  // ================================================================ 共通: ポーズ補間
  const STEP_KEYS = { grip: 1, wBack: 1 };
  /** 任意の数値キーを補間する（rig の R.lerp は rig のキーしか補間しないため） */
  function lerpPose(a, b, t) {
    const o = {};
    for (const k in a) o[k] = a[k];
    for (const k in b) {
      const va = a[k], vb = b[k];
      if (STEP_KEYS[k]) o[k] = t < 0.5 && va != null ? va : vb;
      else if (typeof vb === 'number' && typeof va === 'number') o[k] = va + (vb - va) * t;
      else o[k] = vb;
    }
    return o;
  }
  const _poseCache = new WeakMap();
  /** キーフレーム列 [[frame, diff, ease]] をサンプリング */
  function samp(frames, f, base) {
    let cc = _poseCache.get(frames);
    if (!cc || cc.base !== base) { cc = { base, res: frames.map(k => Object.assign({}, base, k[1])) }; _poseCache.set(frames, cc); }
    const res = cc.res;
    if (f <= frames[0][0]) return res[0];
    for (let i = 0; i < frames.length - 1; i++) {
      const f1 = frames[i + 1][0];
      if (f < f1) {
        const f0 = frames[i][0];
        const ez = U.ease[frames[i + 1][2] || 'out'] || U.ease.out;
        return lerpPose(res[i], res[i + 1], ez((f - f0) / Math.max(1, f1 - f0)));
      }
    }
    return res[res.length - 1];
  }

  // ================================================================ 共通: パレット
  const isHex = s => typeof s === 'string' && /^#[0-9a-f]{6}$/i.test(s);
  function tintPal(p, col, k) { const o = {}; for (const key in p) o[key] = isHex(p[key]) ? U.mix(p[key], col, k) : p[key]; return o; }
  function whitePal(p) { const o = {}; for (const key in p) o[key] = '#ffffff'; o.line = 'rgba(0,0,0,0.3)'; o._white = 1; return o; }
  /** 通常 / 第2形態 / 赤明滅 / 白フラッシュ / 灰 のパレット一式 */
  function makePals(base, rage) {
    const g = Object.assign({}, base, rage || {});
    return { n: base, g, r: tintPal(base, '#ff2410', 0.38), gr: tintPal(g, '#ff2410', 0.38), w: whitePal(base), a: tintPal(base, '#161010', 0.74) };
  }
  function palOf(e, b, pals) {
    if (e.state === 'dying') {
      const t = e.st;
      if (t < 60 && (t >> 2) % 3 === 0) return pals.w;
      if (t >= 66) return pals.a;
      return b.phase === 2 ? pals.g : pals.n;
    }
    if (e.flash > 0 && (e.flash & 2)) return pals.w;
    const m = e.move, rg = b.phase === 2;
    if (m && m.redF && e.mf >= m.redF[0] && e.mf <= m.redF[1] && (BK.frame >> 2) % 2) return rg ? pals.gr : pals.r;
    return rg ? pals.g : pals.n;
  }

  // ================================================================ 共通: 形状ヘルパー
  /** 2次ベジェを n 分割した点列 [x0,y0,x1,y1,...] */
  function qpts(x0, y0, cx, cy, x1, y1, n) {
    const out = [];
    for (let i = 0; i <= n; i++) { const t = i / n, u = 1 - t; out.push(u * u * x0 + 2 * u * t * cx + t * t * x1, u * u * y0 + 2 * u * t * cy + t * t * y1); }
    return out;
  }
  /** 点列に沿った先細りの管（尾・胴・舌・角） */
  function tube(c, pts, w0, w1, fill, line, lw) {
    const n = pts.length >> 1;
    const L = new Array(n * 2), Rr = new Array(n * 2);
    for (let i = 0; i < n; i++) {
      const i0 = Math.max(0, i - 1), i1 = Math.min(n - 1, i + 1);
      let tx = pts[i1 * 2] - pts[i0 * 2], ty = pts[i1 * 2 + 1] - pts[i0 * 2 + 1];
      const d = Math.hypot(tx, ty) || 1; tx /= d; ty /= d;
      const w = (w0 + (w1 - w0) * i / Math.max(1, n - 1)) / 2;
      L[i * 2] = pts[i * 2] - ty * w; L[i * 2 + 1] = pts[i * 2 + 1] + tx * w;
      Rr[i * 2] = pts[i * 2] + ty * w; Rr[i * 2 + 1] = pts[i * 2 + 1] - tx * w;
    }
    c.beginPath(); c.moveTo(L[0], L[1]);
    for (let i = 1; i < n; i++) c.lineTo(L[i * 2], L[i * 2 + 1]);
    for (let i = n - 1; i >= 0; i--) c.lineTo(Rr[i * 2], Rr[i * 2 + 1]);
    c.closePath();
    if (fill) { c.fillStyle = fill; c.fill(); }
    if (line) { c.strokeStyle = line; c.lineWidth = lw || 1.4; c.stroke(); }
  }
  function polyline(c, pts) { c.beginPath(); c.moveTo(pts[0], pts[1]); for (let i = 2; i < pts.length; i += 2) c.lineTo(pts[i], pts[i + 1]); }
  /** 予備動作の「きらめき」（画面座標） */
  function glint(c, x, y, s, a, col) {
    if (a <= 0) return;
    c.save(); c.globalAlpha = Math.min(1, a); c.fillStyle = col || '#fff6d0';
    c.beginPath();
    c.moveTo(x, y - s); c.lineTo(x + s * 0.17, y - s * 0.17); c.lineTo(x + s, y); c.lineTo(x + s * 0.17, y + s * 0.17);
    c.lineTo(x, y + s); c.lineTo(x - s * 0.17, y + s * 0.17); c.lineTo(x - s, y); c.lineTo(x - s * 0.17, y - s * 0.17);
    c.closePath(); c.fill();
    c.fillStyle = '#ffffff'; c.beginPath(); c.arc(x, y, s * 0.2, 0, TAU); c.fill();
    c.restore();
  }
  /** move.glint = [[frame, anchor名], ...] を描く（anchors は画面座標） */
  function drawGlints(c, e, anc) {
    const m = e.move;
    if (!m || !m.glint) return;
    for (const g of m.glint) {
      const d = e.mf - g[0];
      if (d < 0 || d > 12) continue;
      const p = anc[g[1]];
      if (!p) continue;
      const k = d < 4 ? d / 4 : 1 - (d - 4) / 8;
      glint(c, p[0], p[1], 7 + 11 * k, k + 0.2, g[2]);
    }
  }

  // ================================================================ 共通: 床の危険表示
  function roundRect(c, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    c.beginPath();
    c.moveTo(x + r, y); c.lineTo(x + w - r, y); c.quadraticCurveTo(x + w, y, x + w, y + r);
    c.lineTo(x + w, y + h - r); c.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    c.lineTo(x + r, y + h); c.quadraticCurveTo(x, y + h, x, y + h - r);
    c.lineTo(x, y + r); c.quadraticCurveTo(x, y, x + r, y); c.closePath();
  }
  /** 範囲（x0..x1, y±d）: k=0..1 は発動までの進み具合 */
  function markZone(c, x0, x1, y, d, k, hot) {
    const a = Math.min(x0, x1), bx = Math.max(x0, x1);
    const sx0 = BK.sx(a), sx1 = BK.sx(bx), sy0 = BK.sy(y - d, 0), sy1 = BK.sy(y + d, 0);
    const pulse = 0.5 + 0.5 * Math.sin(BK.frame * (0.25 + k * 0.5));
    c.save();
    roundRect(c, sx0, sy0, sx1 - sx0, sy1 - sy0, 8);
    c.globalAlpha = hot ? 0.42 : 0.1 + 0.2 * k + 0.08 * pulse; c.fillStyle = hot ? '#ff3010' : '#ff5a1a'; c.fill();
    c.globalAlpha = 0.45 + 0.45 * pulse; c.strokeStyle = '#ff6a30'; c.lineWidth = 1.6;
    c.setLineDash([7, 5]); c.lineDashOffset = -BK.frame * 0.6; c.stroke(); c.setLineDash([]);
    c.restore();
  }
  /** 突進レーン: x0 から dir 方向へ len、y±d。矢印が流れる */
  function markLane(c, x0, dir, len, y, d, k, hot) {
    const x1 = x0 + dir * len;
    markZone(c, x0, x1, y, d, k, hot);
    const sy = BK.sy(y, 0);
    c.save();
    c.globalAlpha = 0.35 + 0.4 * k; c.strokeStyle = '#ffb080'; c.lineWidth = 2.2; c.lineJoin = 'round';
    const step = 34, off = (BK.frame * (1.2 + k * 3)) % step;
    c.beginPath();
    for (let s = 12 + off; s < len - 10; s += step) {
      const x = BK.sx(x0 + dir * s);
      c.moveTo(x - dir * 6, sy - d * 0.55); c.lineTo(x + dir * 4, sy); c.lineTo(x - dir * 6, sy + d * 0.55);
    }
    c.stroke();
    c.restore();
  }
  /** 落下地点の円: prog=0..1 で内側の輪が縮む。locked で赤く */
  function markRing(c, x, y, rx, ry, prog, locked) {
    const sx = BK.sx(x), sy = BK.sy(y, 0);
    const pulse = 0.5 + 0.5 * Math.sin(BK.frame * (locked ? 0.9 : 0.3));
    c.save();
    c.beginPath(); c.ellipse(sx, sy, rx, ry, 0, 0, TAU);
    c.globalAlpha = locked ? 0.26 + 0.14 * pulse : 0.14; c.fillStyle = locked ? '#ff2a10' : '#ff8a30'; c.fill();
    c.globalAlpha = 0.6 + 0.35 * pulse; c.strokeStyle = locked ? '#ff4020' : '#ffa050'; c.lineWidth = 2; c.stroke();
    const kk = 1 - U.clamp(prog, 0, 1);
    if (kk > 0.06) { c.globalAlpha = 0.75; c.lineWidth = 1.5; c.beginPath(); c.ellipse(sx, sy, rx * kk, ry * kk, 0, 0, TAU); c.stroke(); }
    // 十字
    c.globalAlpha = 0.6; c.lineWidth = 1.2; c.beginPath();
    c.moveTo(sx - rx * 0.25, sy); c.lineTo(sx + rx * 0.25, sy); c.moveTo(sx, sy - ry * 0.3); c.lineTo(sx, sy + ry * 0.3); c.stroke();
    c.restore();
  }
  /** 技の mark 定義から床の表示を描く */
  function drawMoveMark(c, e, b) {
    const m = e.move;
    if (!m || !m.mark || e.dead) return;
    const mk = m.mark, f = e.mf;
    if (f < mk.f[0] || f > mk.f[1]) return;
    const k = U.clamp((f - mk.f[0]) / Math.max(1, mk.hot - mk.f[0]), 0, 1);
    const hot = f >= mk.hot;
    switch (mk.t) {
      case 'zone': markZone(c, e.x + e.face * mk.x[0], e.x + e.face * mk.x[1], e.y, mk.d, k, hot); break;
      case 'lane': markLane(c, b.laneX, b.laneDir, b.laneLen, b.laneY, mk.d, k, hot); break;
      case 'ring': if (b.tx != null) markRing(c, b.tx, b.ty, mk.rx, mk.ry, k, f >= (mk.lock || 0)); break;
      case 'self': markRing(c, e.x + e.face * (mk.ox || 0), e.y, mk.rx, mk.ry, k, f >= (mk.lock || 0)); break;
    }
  }
  /** ボスごとに1つ、床の表示を担当する無害な飛び道具（影と同じタイミングで描かれる） */
  function addFloorPainter(e) {
    const g = BK.game;
    if (!g || !g.addProjectile) return;
    g.addProjectile(new BK.Projectile({
      x: e.x, y: e.y, z: 0, w: 1, h: 1, team: 'enemy', owner: e, harmless: true, life: 1e9, noShadow: false,
      tick(p) { p.x = e.x; p.y = e.y; if (e.remove || (e.dead && e.state !== 'dying')) p.remove = true; },
      drawShadow(c) { if (!e.dead) { const b = st(e); drawMoveMark(c, e, b); if (e.def.drawFloor) e.def.drawFloor(c, e, b); } },
      drawFn() {},
    }));
  }
  /** 楕円範囲の攻撃（床の円表示と一致させるため box 判定ではなく楕円で判定） */
  function radialHit(e, cx, cy, rx, ry, zMax, h) {
    const g = BK.game, out = [];
    if (!g) return out;
    for (const t of g.actors) {
      if (t.team !== 'hero' || !t.hurtable) continue;
      const dx = (t.x - cx) / (rx + (t.w || 20) / 2), dy = (t.y - cy) / ry;
      if (dx * dx + dy * dy > 1 || t.z > zMax) continue;
      const dir = U.sign(t.x - cx || e.face);
      if (t.takeHit(e, h, dir)) { BK.combat.hitFx(e, t, h, t.x, dir); out.push(t); }
    }
    return out;
  }

  // ================================================================ 共通: 状態・AI
  function st(e) {
    return e.bk || (e.bk = {
      phase: 1, hp: e.hp, hitLog: [], cd: 50, plan: null, planT: 0, intro: 0, introMax: 1, t: 0,
      last: null, slotT: 0, slotY: 0, pref: 120, armorT: 0, phaseQ: false, breakQ: false, turnT: 0,
      laneX: e.x, laneY: e.y, laneDir: 1, laneLen: 300, tx: null, ty: null, land: 0, dropping: false,
      mv: e.def.moves, summons: 0, nextSummon: 0, capT: 0, prevState: 'idle', poise: e.poise || 0, armorSrc: '',
    });
  }
  function scrLo(e, m) { return BK.cam.x + m; }
  function scrHi(e, m) { return BK.cam.x + BK.W - m; }
  /** 画面の端（向いている側）に着いたか */
  function atEdge(e) {
    const m = e.def.ai.margin;
    return (e.face > 0 && e.x >= scrHi(e, m) - 1) || (e.face < 0 && e.x <= scrLo(e, m) + 1);
  }
  /** 体勢崩し: エンジンの吹っ飛び（'fall'）と同じ状態にする */
  function knockDown(e) {
    const src = e.lastHitBy, dir = src ? U.sign(e.x - src.x || 1) : -e.face;
    if (e.move) e.endMove();
    e.state = 'fall'; e.st = 0; e._bounced = false; e.spinning = false; e.hitCount = 0;
    e.vz = Math.max(e.vz, 5 / Math.sqrt(e.weight || 1)); if (e.z <= 0) e.z = 0.5;
    e.vx = dir * 4 / (e.weight || 1);
    st(e).capT = 0;
  }
  /** レーン表示の起点を記録（突進技の onStart） */
  function setLane(e, maxLen) {
    const b = st(e), m = e.def.ai.margin;
    b.laneX = e.x; b.laneY = e.y; b.laneDir = e.face;
    const room = e.face > 0 ? scrHi(e, m) - e.x : e.x - scrLo(e, m);
    b.laneLen = U.clamp(room + 70, 90, maxLen || 420);
  }
  function doMove(e, b, m, rest) {
    e.faceHero();
    e.vx = 0; e.vy = 0;
    e.startMove(m);
    b.plan = null; b.last = m; b.planT = 0;
    b.cd = Math.round((rest != null ? rest : (m.rest || 40)) * (b.phase === 2 ? 0.7 : 1));
    // ひるみ上限のアーマー中に出した技は、最初の攻撃判定まではひるまない（反撃が潰されない）
    if (b.capT > 0 && m.hits) b.capT = Math.max(b.capT, m.hits[0].f[1] + 2);
  }
  function minionCount(e, game) {
    let n = 0;
    for (const a of game.actors) if (a.team === 'enemy' && a !== e && !a.dead) n++;
    return n;
  }
  /** 手下を呼ぶ（未定義の ID は亡者兵にする） */
  function summon(game, id, x, y, opt) {
    let t = BK.enemyTypes[id] ? id : 'undead';
    const o = Object.assign({ x: U.clamp(x, BK.cam.x + 40, BK.cam.x + BK.W - 40), y: U.clamp(y, 8, BK.DEPTH - 8) }, opt || {});
    if (t === 'undead' && !o.entry) o.entry = 'rise';
    return game.spawnEnemy(t, o);
  }

  /** 毎フレームの共通処理（def.update）: 被弾の記録・形態変化・アーマー窓・画面内に留める */
  function bossUpdate(e, game) {
    const b = st(e), cfg = e.def.ai;
    b.t++;
    if (e.state === 'dying') { updateDying(e, game, b); return; }
    if (e.dead) return;
    // 被弾の記録 → 短時間に殴られ続けたら振り払い
    const hitNow = e.hp < b.hp;
    if (hitNow) {
      b.hitLog.push(BK.frame);
      b.hp = e.hp;
      while (b.hitLog.length && BK.frame - b.hitLog[0] > 150) b.hitLog.shift();
      if (b.hitLog.length >= (b.phase === 2 ? cfg.breakN2 : cfg.breakN)) { b.hitLog.length = 0; b.breakQ = true; }
    } else if (e.hp > b.hp) b.hp = e.hp;
    if (b.phase === 1 && !b.phaseQ && e.hp > 0 && e.hp <= e.maxHp * 0.5) b.phaseQ = true;
    // のけぞり上限: 一度ひるんだら、しばらくは殴られても動きを止めない（ダメージは通る）
    if (e.state === 'hurt' && b.prevState !== 'hurt' && b.capT <= 0) b.capT = e.hitstun + (b.phase === 2 ? 50 : 40);
    // ひるみから立ち直ったら、すぐ反撃を考える（予備動作つき）
    if (b.prevState === 'hurt' && e.state !== 'hurt' && b.capT > 0) b.cd = Math.min(b.cd, 6);
    // ひるみ上限のアーマー中に体勢値（poise）が尽きたら、それでもダウンさせる
    const pz = e.def.poise || 0;
    if (pz && hitNow && e.poise > b.poise + 0.5 && b.poise < pz && b.armorSrc === 'cap' && e.state !== 'fall' && e.state !== 'down' && !e.dead) knockDown(e);
    b.poise = e.poise;
    // アーマー: 技の一部分（armorW）/ ひるみ上限 / 演出
    let arm = '';
    const m = e.move;
    if (m && m.armorW) for (const w of m.armorW) if (e.mf >= w[0] && e.mf <= w[1]) arm = 'move';
    if (b.armorT > 0) { b.armorT--; arm = arm || 'move'; }
    if (b.capT > 0) { b.capT--; if (!arm && !(m && m.armor)) arm = 'cap'; }
    e.superArmor = arm ? 2 : 0;
    b.armorSrc = arm;
    b.prevState = e.state;
    // 画面内に留める
    if (!e.entering) {
      let lo = scrLo(e, cfg.margin), hi = scrHi(e, cfg.margin);
      if (cfg.marginF) { if (e.face > 0) hi = scrHi(e, cfg.marginF); else lo = scrLo(e, cfg.marginF); }
      if (lo < hi) {
        if (e.x < lo) { e.x = lo; if (e.vx < 0) e.vx = 0; }
        if (e.x > hi) { e.x = hi; if (e.vx > 0) e.vx = 0; }
      }
    }
    // 空からの登場の着地
    if (b.dropping && e.z <= 0 && e.state !== 'air') {
      b.dropping = false; e.intangible = false;
      if (cfg.onDropLand) cfg.onDropLand(e, b, game);
    }
    if (b.land > 0) b.land--;
    if (cfg.tick) cfg.tick(e, b, game);
  }

  /** 標準のボスAI（def.think）: 技を1つ決め、間合いと奥行きを合わせてから出す */
  function bossThink(e, game) {
    if (e.dead) return;
    const b = st(e), cfg = e.def.ai, h = game.hero;
    if (e.entering && e.walkIn()) return;
    e.entering = 0;
    if (!h) { e.state = 'idle'; return; }
    const dx = h.x - e.x, dy = h.y - e.y, adx = Math.abs(dx), ady = Math.abs(dy);
    if (b.intro > 0) { b.intro--; e.vx = 0; e.vy = 0; e.state = 'idle'; return; }
    if (b.phaseQ) {
      b.phaseQ = false; b.phase = 2; b.mv = e.def.moves2; b.hitLog.length = 0; b.breakQ = false;
      doMove(e, b, b.mv.phase, 30);
      return;
    }
    if (b.breakQ) {
      b.breakQ = false;
      if (adx < 190 && ady < 60 && !h.dead) { doMove(e, b, b.mv.breaker, 24); return; }
    }
    if (b.cd > 0) b.cd--;
    const heroBusy = h.dead || h.state === 'down' || h.state === 'getup' || h.state === 'fall' || h.invul > 60;
    if (heroBusy) b.plan = null;
    else if (!b.plan && b.cd <= 0) {
      if (cfg.special) { const sm = cfg.special(e, b, game); if (sm) { doMove(e, b, sm); return; } }
      b.plan = cfg.pick(e, b, adx, ady, game); b.planT = 0;
    }
    const spd = cfg.speed * (b.phase === 2 ? cfg.rage : 1), spdY = cfg.speedY * (b.phase === 2 ? cfg.rage : 1);
    const side = U.sign(e.x - h.x || -e.face);
    const lo = scrLo(e, cfg.margin + 4), hi = scrHi(e, cfg.margin + 4);
    if (b.plan) {
      const m = b.plan, p = m.plan;
      b.planT++;
      const inX = adx >= p.min && adx <= p.max, inY = ady <= p.dy;
      if (inX && inY) { doMove(e, b, m); return; }
      let tx = e.x;
      if (!inX) {
        const want = adx > p.max ? p.max - 14 : p.min + 14;
        tx = h.x + side * want;
        if (tx < lo || tx > hi) { const t2 = h.x - side * want; if (t2 >= lo && t2 <= hi) tx = t2; }
        tx = U.clamp(tx, lo, hi);
      }
      // 間合いを離したい計画は、追いかけられて届かないならすぐ諦める
      if (b.planT > (adx < p.min ? 60 : 150)) { b.plan = null; b.cd = 10; }
      e.moveToward(tx, h.y, spd, spdY);
      turnTo(e, b, dx, cfg);
      return;
    }
    // 様子見: 好みの間合いで奥行きをずらしつつ睨む
    if (--b.slotT <= 0) { b.slotT = U.randi(50, 120); b.slotY = U.rand(-24, 24); b.pref = U.rand(cfg.pref[0], cfg.pref[1]); }
    let tx = U.clamp(h.x + side * b.pref, lo, hi);
    const ty = U.clamp(h.y + (heroBusy ? b.slotY * 1.5 : b.slotY * 0.4), 6, BK.DEPTH - 6);
    if (Math.abs(e.x - tx) > 10 || Math.abs(e.y - ty) > 6) e.moveToward(tx, ty, spd * 0.7, spdY * 0.8);
    else { e.vx = 0; e.vy = 0; e.state = 'idle'; }
    turnTo(e, b, dx, cfg);
  }
  /** 振り向き（巨体は少し遅れて向きを変える） */
  function turnTo(e, b, dx, cfg) {
    const want = U.sign(dx || e.face);
    if (want === e.face) { b.turnT = 0; return; }
    if (++b.turnT >= (cfg.turnDelay || 0)) { e.face = want; b.turnT = 0; }
  }
  /** 重み付き抽選（同じ技の連発は重みを下げる） */
  function pickW(b, list) {
    const l = list.filter(x => x && x[0] > 0).map(x => [x[1] === b.last ? x[0] * 0.35 : x[0], x[1]]);
    return l.length ? U.weighted(l) : null;
  }

  // ================================================================ 共通: 死亡演出
  const DIE_T = 160;
  function dyingK(e) { return e.state === 'dying' ? U.clamp((e.st - 70) / 80, 0, 1) : 0; }
  function dyingSink(e) { return e.state === 'dying' ? Math.max(0, e.st - 70) * 0.12 : 0; }
  /** 上から灰になって消える: 描画領域を下へ狭める */
  function dyingClip(c, e, sx, sy, H) {
    const k = dyingK(e);
    if (k <= 0) return;
    const top = sy - H * 1.15 + H * 1.2 * k;
    c.beginPath(); c.rect(sx - 420, top, 840, 700); c.clip();
  }
  function onBossDie(e) {
    const b = st(e);
    e.state = 'dying'; e.st = 0;
    e.vx *= 0.25; e.vy = 0;
    if (e.z <= 0.6) { e.z = 0; e.vz = 0; } else e.vz = Math.min(e.vz, 0);
    e.superArmor = 0; b.plan = null;
    e.trailOn = false; e.trail.length = 0;
  }
  function updateDying(e, game, b) {
    const t = ++e.st, d = e.def;
    if (e.z > 0) { e.vx *= 0.96; }
    else e.vx *= 0.85;
    const W = d.dieW || 120, H = d.dieH || 180;
    // 断末魔: 血が噴き出す
    if (t < 64 && t % 7 === 1) {
      const x = e.x + U.rand(-W * 0.35, W * 0.35), z = e.z + U.rand(H * 0.25, H * 0.8);
      BK.fx.blood(x, e.y, z, U.chance(0.5) ? 1 : -1, 7, e.bloodCol);
      BK.fx.add({ type: 'burst', x, y: e.y, z, life: 7, size: 16, col: '#fff2d8' });
    }
    if (t === 2) BK.audio.sfx('roar', { pitch: 0.55, vol: 0.8 });
    if (t === 62) { BK.fx.shake(5, 18); BK.audio.sfx('thud', { pitch: 0.55 }); BK.fx.dust(e.x, e.y, 10); }
    // 灰と残り火（切れ目のあたりから立ち上る）
    const k = dyingK(e);
    if (k > 0 && k < 1) {
      const cutZ = e.z + H * 1.15 * (1 - k) - dyingSink(e);
      for (let i = 0; i < 2; i++) {
        BK.fx.add({ type: 'dot', x: e.x + U.rand(-W / 2, W / 2), y: e.y + U.rand(-4, 4), z: Math.max(4, cutZ + U.rand(-6, 6)), vx: U.rand(-0.5, 0.5), vz: U.rand(0.5, 1.8),
          life: U.randi(24, 46), col: U.choose(['#ff9a3c', '#ff5a1f', '#3a2c2a', '#2a1e1e', '#5a4a44']), size: U.rand(1.5, 3.2), drag: 0.98 });
      }
      if (t % 3 === 0) BK.fx.add({ type: 'smoke', x: e.x + U.rand(-W / 3, W / 3), y: e.y, z: Math.max(6, cutZ), vz: U.rand(0.6, 1.4), life: 30, size: U.rand(6, 12), col: 'rgba(40,30,30,0.45)', drag: 0.96 });
    }
    if (t >= DIE_T) e.remove = true;
  }

  /** 移動量のカーブ・技の時間を縮めた技表を作る（第2形態用）。F は時間倍率 */
  const mkF = k => n => Math.max(0, Math.round(n * k));

  // =====================================================================
  //  蛇男爵 ── 紅い月の城主。下半身は巨大な蛇のとぐろ、上半身は長剣を持つ貴族
  // =====================================================================
  const SB_COL = {
    skin: '#a9ae98', hair: '#17121a', hairHi: '#4c4454',
    cloth: '#5c1420', clothDark: '#3a0c14', sleeve: '#6c1a26', body: '#5a1420', bodyHi: '#8e2c36', trim: '#c09a48',
    glove: '#a9ae98', gloveDark: '#7c826c', belt: '#2a1a12', jabot: '#e6decc', mouth: '#2a0608', fang: '#f0ead8', eye: '#ffd23a',
    metal: '#cfd3da', metalDark: '#6a6e76', grip: '#2a1810',
    cape: '#3e0a12', capeIn: '#7a1420',
    scale: '#4c5c3e', scaleDk: '#2c3624', belly: '#bcae82', rim: '#d08060', rattle: '#d8cbb0',
    line: 'rgba(10,6,6,0.9)',
  };
  const SB_PALS = makePals(SB_COL, { eye: '#ff3020', scale: '#5a4a38', scaleDk: '#3a2a22', rim: '#ff5a3a', skin: '#b4a896' });

  function sbHead(c, sp, col, sk, pose, opt) {
    const hc = sk.headC, r = sp.headR, jaw = U.clamp(pose.jaw || 0, 0, 1), tint = !!opt.tint;
    const t = opt.t || 0, wv = Math.sin(t * 0.07) * 1.2;
    c.save(); c.translate(hc.x, hc.y); c.rotate((180 - sk.ha) * D);
    // 後ろへ流れる長髪
    R.poly(c, [r * 0.55, -r * 0.95, -r * 0.4, -r * 1.25, -r * 1.3, -r * 0.8, -r * 1.85, r * 0.3 + wv, -r * 2.6, r * 1.9 + wv,
      -r * 1.75, r * 1.25, -r * 1.55, r * 2.5 + wv, -r * 0.95, r * 1.05, -r * 0.4, r * 0.35], col('hair'), col('line'));
    // 顎（開閉する）
    c.save(); c.translate(-r * 0.15, r * 0.3); c.rotate(jaw * 0.75);
    if (jaw > 0.05) {
      R.poly(c, [r * 0.1, -r * 0.05, r * 1.05, -r * 0.02, r * 0.95, r * 0.45, r * 0.2, r * 0.55], col('mouth'));
      if (!tint) { c.fillStyle = col('fang'); R.poly(c, [r * 0.8, -r * 0.02, r * 0.95, -r * 0.02, r * 0.86, -r * 0.4], col('fang')); }
    }
    R.poly(c, [-r * 0.35, -r * 0.1, r * 1.0, 0, r * 0.95, r * 0.18, r * 0.55, r * 0.75, -r * 0.1, r * 0.6], col('skin'), col('line'));
    c.restore();
    // 頭部（面長）
    c.beginPath(); c.ellipse(r * 0.12, -r * 0.08, r * 0.86, r * 0.9, 0, 0, TAU);
    c.fillStyle = col('skin'); c.fill(); c.strokeStyle = col('line'); c.lineWidth = 1; c.stroke();
    // 鼻筋・口元を前へ
    R.poly(c, [r * 0.7, -r * 0.35, r * 1.12, r * 0.2, r * 0.95, r * 0.34, r * 0.5, r * 0.3], col('skin'));
    if (jaw > 0.05) {
      // 口の中と上の牙
      R.poly(c, [r * 0.25, r * 0.3, r * 1.0, r * 0.32, r * 0.9, r * 0.3 + jaw * r * 0.5, r * 0.3, r * 0.35 + jaw * r * 0.3], col('mouth'));
      if (!tint) { R.poly(c, [r * 0.55, r * 0.3, r * 0.68, r * 0.3, r * 0.61, r * 0.3 + r * 0.55 * jaw], col('fang')); R.poly(c, [r * 0.82, r * 0.31, r * 0.93, r * 0.31, r * 0.87, r * 0.31 + r * 0.42 * jaw], col('fang')); }
    }
    // 尖った耳
    R.poly(c, [-r * 0.1, -r * 0.25, -r * 0.95, -r * 0.95, -r * 0.35, r * 0.15], col('skin'), col('line'));
    // 前髪（後ろへ撫でつけ）
    R.poly(c, [r * 0.85, -r * 0.55, r * 0.4, -r * 1.02, -r * 0.5, -r * 0.95, -r * 0.9, -r * 0.3, -r * 0.2, -r * 0.62, r * 0.35, -r * 0.62], col('hair'));
    if (!tint) {
      c.strokeStyle = col('hairHi'); c.lineWidth = 0.8;
      c.beginPath(); c.moveTo(r * 0.5, -r * 0.85); c.quadraticCurveTo(-r * 0.3, -r * 1.0, -r * 1.2, -r * 0.2); c.stroke();
      // 蛇の目（縦長の瞳孔）
      const ey = pose.rage ? '#ff3020' : col('eye');
      c.fillStyle = ey; c.beginPath(); c.ellipse(r * 0.55, -r * 0.2, r * 0.26, r * 0.13, -0.15, 0, TAU); c.fill();
      c.fillStyle = '#0a0404'; c.fillRect(r * 0.53, -r * 0.32, r * 0.08, r * 0.24);
      c.strokeStyle = '#1a0c0c'; c.lineWidth = 1.2;
      c.beginPath(); c.moveTo(r * 0.25, -r * 0.42); c.lineTo(r * 0.85, -r * 0.3); c.stroke();
      // 口ひげ
      c.strokeStyle = col('hair'); c.lineWidth = 1;
      c.beginPath(); c.moveTo(r * 1.0, r * 0.26); c.quadraticCurveTo(r * 0.7, r * 0.42, r * 0.45, r * 0.3); c.quadraticCurveTo(r * 0.3, r * 0.2, r * 0.35, r * 0.05); c.stroke();
      // 金の額冠
      c.strokeStyle = col('trim'); c.lineWidth = 1.4;
      c.beginPath(); c.moveTo(r * 0.75, -r * 0.68); c.quadraticCurveTo(r * 0.1, -r * 0.88, -r * 0.7, -r * 0.55); c.stroke();
      c.fillStyle = '#c01830'; c.beginPath(); c.arc(r * 0.45, -r * 0.76, 1.3, 0, TAU); c.fill();
    }
    c.restore();
  }
  function sbTorso(c, sp, col, sk) {
    const h = sk.hip, s = sk.sho;
    const a = Math.atan2(s.y - h.y, s.x - h.x), nx = -Math.sin(a), ny = Math.cos(a);
    const wW = sp.waistW / 2, cW = sp.chestW / 2;
    // 紅の上着（裾はぼろぼろ）
    R.poly(c, [h.x + nx * wW, h.y + ny * wW, s.x + nx * cW, s.y + ny * cW, s.x - nx * cW * 0.9, s.y - ny * cW * 0.9, h.x - nx * wW, h.y - ny * wW], col('body'), col('line'));
    const tx = Math.cos(a), ty = Math.sin(a);
    const hem = [];
    for (let i = 0; i <= 4; i++) {
      const k = i / 4, px = h.x + nx * wW * (1 - 2 * k), py = h.y + ny * wW * (1 - 2 * k);
      hem.push(px, py);
      if (i < 4) { const k2 = (i + 0.5) / 4; hem.push(h.x + nx * wW * (1 - 2 * k2) - tx * (4 + (i % 2) * 3), h.y + ny * wW * (1 - 2 * k2) - ty * (4 + (i % 2) * 3)); }
    }
    R.poly(c, hem, col('body'));
    // 金の縁取りとボタン
    c.strokeStyle = col('trim'); c.lineWidth = 1.1;
    c.beginPath(); c.moveTo(h.x + nx * wW * 0.55, h.y + ny * wW * 0.55); c.lineTo(s.x + nx * cW * 0.55, s.y + ny * cW * 0.55); c.stroke();
    for (let i = 1; i <= 3; i++) {
      const k = i / 4.2;
      R.circle(c, U.lerp(h.x + nx * wW * 0.4, s.x + nx * cW * 0.4, k), U.lerp(h.y + ny * wW * 0.4, s.y + ny * cW * 0.4, k), 0.9, col('trim'));
    }
    c.strokeStyle = col('bodyHi'); c.lineWidth = 1;
    c.beginPath(); c.moveTo(U.lerp(h.x, s.x, 0.2) - nx * wW * 0.5, U.lerp(h.y, s.y, 0.2) - ny * wW * 0.5); c.lineTo(U.lerp(h.x, s.x, 0.85) - nx * cW * 0.5, U.lerp(h.y, s.y, 0.85) - ny * cW * 0.5); c.stroke();
  }
  function sbFront(c, sp, col, sk) {
    // ひだ襟（ジャボ）と金の肩章
    const n = sk.neck;
    R.poly(c, [n.x - 3, n.y + 1, n.x + 4, n.y, n.x + 6, n.y + 4, n.x + 3, n.y + 6, n.x + 5, n.y + 9, n.x + 1, n.y + 11, n.x - 2, n.y + 6], col('jabot'), col('line'));
    const s = sk.shF;
    c.beginPath(); c.ellipse(s.x + 1, s.y + 1, 5.5, 3.6, -0.25, 0, TAU);
    c.fillStyle = col('trim'); c.fill(); c.strokeStyle = col('line'); c.lineWidth = 0.8; c.stroke();
  }
  function sbSword(c, sp, col, len) {
    // 細身の長剣: 柄頭・曲がった鍔・長い刃
    R.poly(c, [-11, -1.5, 0, -1.5, 0, 1.5, -11, 1.5], col('grip'));
    R.circle(c, -12, 0, 2.3, col('trim'), col('line'));
    c.strokeStyle = col('trim'); c.lineWidth = 2;
    c.beginPath(); c.moveTo(-3, -7); c.quadraticCurveTo(2, -3, 1, 0); c.quadraticCurveTo(2, 3, -3, 7); c.stroke();
    R.poly(c, [1, -2.6, len - 12, -1.9, len, 0, len - 12, 1.9, 1, 2.6], col('metal'), col('line'));
    c.strokeStyle = col('metalDark'); c.lineWidth = 0.8;
    c.beginPath(); c.moveTo(4, 0); c.lineTo(len - 16, 0); c.stroke();
  }
  const SB_SPEC = R.makeSpec({
    scale: 1.55, thigh: 39, shin: 39, torso: 31, neck: 5, headR: 8.8, upper: 19, fore: 18,
    legW: 0, armW: 7, waistW: 15, chestW: 23, shoulderOff: 2, weaponLen: 80, gripDist: 9, capeLen: 46,
    colors: SB_COL,
    draw: { leg() {}, head: sbHead, torso: sbTorso, weapon: sbSword, cape: R.capeDraw, front: sbFront },
  });
  const SB_ST = R.merge(R.NEUTRAL, {
    lean: 4, head: 0, aF: 40, eF: 42, aB: -28, eB: 56, lF: 0, kF: 0, lB: 0, kB: 0, wAbs: 116, drop: 0, cape: 0.35,
    tail: 0, tailUp: 0, stretch: 0, jaw: 0, coil: 0,
  });

  // --- 蛇の下半身（とぐろ・尾・立ち上がる胴）
  function ringArc(c, r, front, P) {
    if (r.rx < 3) return;
    c.beginPath(); c.ellipse(r.x, r.y, r.rx, Math.max(1, r.ry), r.a || 0, front ? 0 : Math.PI, front ? Math.PI : TAU);
    c.lineCap = 'round';
    c.lineWidth = r.w + 3; c.strokeStyle = P.line; c.stroke();
    c.lineWidth = r.w; c.strokeStyle = front ? P.scale : P.scaleDk; c.stroke();
    if (!P._white) {
      c.setLineDash([2, 4]); c.lineWidth = r.w * 0.42; c.strokeStyle = 'rgba(0,0,0,0.26)'; c.stroke(); c.setLineDash([]);
      if (front) {
        c.beginPath(); c.ellipse(r.x, r.y + r.w * 0.27, r.rx, Math.max(1, r.ry), r.a || 0, 0.14 * Math.PI, 0.86 * Math.PI);
        c.lineWidth = r.w * 0.32; c.strokeStyle = P.belly; c.stroke();
      } else {
        c.beginPath(); c.ellipse(r.x, r.y - r.w * 0.3, r.rx, Math.max(1, r.ry), r.a || 0, 1.12 * Math.PI, 1.88 * Math.PI);
        c.lineWidth = 1.5; c.strokeStyle = P.rim; c.stroke();
      }
    }
    c.lineCap = 'butt';
  }
  function snakeTube(c, pts, w0, w1, P, dark) {
    tube(c, pts, w0, w1, dark ? P.scaleDk : P.scale, P.line, 1.6);
    if (P._white) return;
    const n = pts.length >> 1, bp = [];
    for (let i = 0; i < n; i++) {
      const i0 = Math.max(0, i - 1), i1 = Math.min(n - 1, i + 1);
      let tx = pts[i1 * 2] - pts[i0 * 2], ty = pts[i1 * 2 + 1] - pts[i0 * 2 + 1];
      const d = Math.hypot(tx, ty) || 1; tx /= d; ty /= d;
      let nx = -ty, ny = tx; if (nx + ny < 0) { nx = -nx; ny = -ny; }
      const w = w0 + (w1 - w0) * i / Math.max(1, n - 1);
      bp.push(pts[i * 2] + nx * w * 0.24, pts[i * 2 + 1] + ny * w * 0.24);
    }
    tube(c, bp, w0 * 0.36, w1 * 0.36, P.belly, null);
    c.save(); c.setLineDash([2, 4]); c.lineWidth = Math.max(1, (w0 + w1) * 0.2); c.strokeStyle = 'rgba(0,0,0,0.26)';
    polyline(c, pts); c.stroke(); c.restore();
  }
  function sbTail(c, p, P, r1, t) {
    const s = U.clamp(p.tail || 0, 0, 1), up = U.clamp(p.tailUp || 0, 0, 1);
    const e1 = (1 - Math.cos(Math.PI * s)) / 2;
    const th = Math.PI * (1 - s * 0.85);
    const bx = r1.x + Math.cos(th) * r1.rx * 0.92, by = r1.y + Math.sin(th) * r1.ry;
    const rat = up > 0 ? Math.sin(t * 1.9) * 3.5 * up : 0;
    const tx = U.lerp(-132, 186, e1) + rat, ty = -7 + Math.sin(Math.PI * s) * 22 - up * 58;
    const cx = (bx + tx) / 2 - up * 26, cy = Math.max(by, ty) + 6 + 10 * Math.sin(Math.PI * s) - up * 4;
    const pts = qpts(bx, by, cx, cy, tx, ty, 10);
    snakeTube(c, pts, 18, 4, P);
    // 尾の先のがらがら（警告音の源）
    if (!P._white) {
      const n = pts.length;
      const ax = pts[n - 2], ay = pts[n - 1], dx0 = ax - pts[n - 4], dy0 = ay - pts[n - 3], dl = Math.hypot(dx0, dy0) || 1;
      c.fillStyle = P.rattle; c.strokeStyle = P.line; c.lineWidth = 0.8;
      for (let i = 0; i < 3; i++) {
        c.beginPath(); c.ellipse(ax + dx0 / dl * (i * 3.2 + 1), ay + dy0 / dl * (i * 3.2 + 1), 2.6 - i * 0.4, 3.4 - i * 0.5, Math.atan2(dy0, dx0), 0, TAU);
        c.fill(); c.stroke();
      }
    }
    return Math.sin(th) > 0.05;
  }
  function sbSnake(c, e, p, P, hip, t) {
    const sth = U.clamp(p.stretch || 0, 0, 1), kk = 1 - sth;
    const ex = 1 - (p.coil || 0) * 0.12;
    const wv = e.state === 'walk' ? e.walkPh : t * 0.04;
    const rings = [
      { x: -14 - sth * 50 + Math.sin(wv) * 3, y: -26, rx: 70 * ex * kk, ry: 16 * kk, w: 26, a: 0.03 },
      { x: -8 - sth * 50 + Math.sin(wv + 1.3) * 3, y: -49 + sth * 22, rx: 56 * ex * kk, ry: 14 * kk, w: 24, a: -0.05 },
      { x: -3 - sth * 50 + Math.sin(wv + 2.6) * 3, y: -70 + sth * 44, rx: 40 * ex * kk, ry: 12 * kk, w: 22, a: 0.06 },
    ];
    const showRings = kk > 0.12;
    if (showRings) for (const r of rings) ringArc(c, r, false, P);
    let tailFront = false;
    const drawTail = sth < 0.5;
    // 尾（後ろ側にあるときは先に描く）
    const s = U.clamp(p.tail || 0, 0, 1);
    tailFront = Math.sin(Math.PI * (1 - s * 0.85)) > 0.05;
    if (drawTail && !tailFront) sbTail(c, p, P, rings[0], t);
    // 伸びた胴（噛みつき突進）: 地面を這って後ろへ長く伸びる
    if (sth > 0.04) {
      const L = 40 + sth * 230, pts = [];
      const x0 = hip.x - 34, n = 12;
      for (let i = 0; i <= n; i++) {
        const u = i / n;
        pts.push(x0 - u * L, -13 + Math.sin(u * 8 + t * 0.35) * 5 * sth);
      }
      snakeTube(c, pts, 22, 5, P);
    }
    // とぐろから立ち上がって人の腰へつながる胴
    const r3 = rings[2];
    const bx = sth > 0.5 ? hip.x - 34 : r3.x + 4, by = sth > 0.5 ? -13 : r3.y + 2;
    snakeTube(c, qpts(bx, by, hip.x - 22 + Math.sin(wv) * 4, (by + hip.y) / 2 + 2, hip.x, hip.y + 8, 10), 27, 21, P);
    if (showRings) for (const r of rings) ringArc(c, r, true, P);
    if (drawTail && tailFront) sbTail(c, p, P, rings[0], t);
  }

  // --- 蛇男爵の技
  function baronMoves(k) {
    const F = mkF(k);
    return {
      slash: { // 長剣の薙ぎ払い（間合いが長い）
        dur: F(70), trail: [F(19), F(26)], trailCol: '#eef2ff',
        kf: [[0, {}], [F(18), { aF: 150, eF: 40, wAbs: 212, lean: -14, drop: -10, aB: -70, eB: 30, head: -8, cape: 0.8 }],
          [F(23), { aF: 88, eF: 0, wAbs: 84, lean: 24, drop: 4, aB: -20, eB: 50, head: 6, cape: 1.2 }, 'snap'],
          [F(32), { aF: 58, eF: 0, wAbs: 44, lean: 26, drop: 5, cape: 1 }], [F(70), {}]],
        hits: [{ f: [F(21), F(25)], x: [15, 185], z: [30, 190], d: 24, dmg: 14, kb: 'heavy', push: 4.2 }],
        move: [[0, 0], [F(14), 1.4], [F(23), 0]],
        sfx: [[F(19), 'swingHeavy']],
        glint: [[F(2), 'tip']],
        plan: { min: 24, max: 175, dy: 16 }, rest: 36,
      },
      slash2: { // 返し斬り（第2形態の二連撃。2撃目はアーマー）
        dur: F(98), trail: [F(19), F(46)], trailCol: '#ffd0c0',
        kf: [[0, {}], [F(16), { aF: 150, eF: 40, wAbs: 212, lean: -14, drop: -10, aB: -70, eB: 30, head: -8, cape: 0.8 }],
          [F(21), { aF: 88, eF: 0, wAbs: 84, lean: 24, drop: 4, aB: -20, eB: 50, head: 6, cape: 1.2 }, 'snap'],
          [F(28), { aF: 50, eF: 10, wAbs: 30, lean: 24, drop: 5 }],
          [F(38), { aF: 20, eF: 90, wAbs: -40, lean: 20, drop: 2, head: 4 }],
          [F(43), { aF: 150, eF: 10, wAbs: 165, lean: -10, drop: -8, head: -10, cape: 1.3 }, 'snap'],
          [F(56), { aF: 155, eF: 20, wAbs: 190, lean: -12, drop: -8 }], [F(98), {}]],
        hits: [{ f: [F(19), F(23)], x: [15, 185], z: [30, 190], d: 24, dmg: 12, kb: 'light', push: 3 },
          { f: [F(41), F(45)], x: [10, 170], z: [20, 210], d: 26, dmg: 14, kb: 'down', push: 5, lift: 6 }],
        armorW: [[F(30), F(46)]], redF: [F(30), F(40)],
        move: [[0, 0], [F(12), 1.4], [F(21), 0], [F(36), 1.8], [F(43), 0]],
        sfx: [[F(17), 'swingHeavy'], [F(39), 'swingHeavy', { pitch: 0.8 }]],
        glint: [[F(2), 'tip'], [F(31), 'tip', '#ffb0a0']],
        plan: { min: 24, max: 160, dy: 16 }, rest: 44,
      },
      tail: { // 尾の足払い（低い。跳んでかわす）
        dur: F(90), armor: true,
        kf: [[0, {}], [F(10), { tailUp: 1, lean: -8, drop: -8, aF: 70, eF: 30, wAbs: 150, aB: -50, head: -6, coil: 0.8, jaw: 0.4 }],
          [F(38), { tailUp: 1, lean: -12, drop: -10, aF: 72, eF: 30, wAbs: 152, aB: -52, head: -8, coil: 1, jaw: 0.5 }],
          [F(44), { tail: 1, tailUp: 0, lean: 12, drop: 6, aF: 40, eF: 30, wAbs: 110, aB: -20, coil: -0.4, head: 4, jaw: 0.2 }, 'snap'],
          [F(64), { tail: 1, lean: 10, drop: 5, coil: -0.2, aF: 40, wAbs: 110 }], [F(90), {}]],
        hits: [{ f: [F(41), F(46)], x: [-70, 186], z: [0, 26], d: 30, dmg: 12, kb: 'down', push: 3.5, lift: 5 }],
        redF: [F(4), F(38)],
        mark: { t: 'zone', x: [-70, 186], d: 30, f: [F(6), F(46)], hot: F(41) },
        sfx: [[F(3), 'fire', { pitch: 2.4, vol: 0.5 }], [F(40), 'swingHeavy', { pitch: 0.7 }]],
        onFrame(e, f) {
          if (f < F(38) && f % 5 === 0) BK.audio.sfx('knife', { pitch: 0.45, vol: 0.4 });
          if (f === F(44)) { BK.fx.shake(3, 8); BK.fx.dust(e.x + e.face * 120, e.y + 10, 8); BK.fx.dust(e.x + e.face * 30, e.y + 18, 5); }
        },
        plan: { min: 0, max: 175, dy: 22 }, rest: 34,
      },
      bite: { // 噛みつき突進（画面を横切る。レーンから外れてかわす）
        dur: F(104), armor: true,
        onStart(e) { setLane(e, 360); },
        kf: [[0, {}], [F(30), { lean: -32, head: -26, drop: -20, jaw: 0.55, aF: -10, eF: 40, wAbs: -80, aB: -60, eB: 40, cape: 0.6, coil: 0.6 }],
          [F(36), { lean: 72, head: 24, drop: 30, jaw: 1, stretch: 1, aF: -60, eF: 20, wAbs: -110, aB: -80, eB: 10, cape: 1.5 }, 'snap'],
          [F(58), { lean: 70, head: 22, drop: 30, jaw: 1, stretch: 1, aF: -60, eF: 20, wAbs: -110, aB: -80, eB: 10, cape: 1.5 }],
          [F(72), { lean: 30, head: 6, drop: 4, jaw: 0.3, stretch: 0.3, aF: 20, eF: 40, wAbs: 70 }], [F(104), {}]],
        hits: [{ f: [F(36), F(58)], x: [30, 140], z: [30, 160], d: 16, dmg: 18, kb: 'down', push: 6, lift: 5 }],
        move: [[0, 0], [F(36), 11.5 / k], [F(56), 2.5], [F(60), 0]],
        redF: [F(4), F(32)],
        glint: [[F(26), 'eye', '#ffe060']],
        mark: { t: 'lane', d: 16, f: [F(4), F(56)], hot: F(36) },
        sfx: [[F(5), 'fire', { pitch: 2.2, vol: 0.7 }], [F(35), 'swingHeavy', { pitch: 0.6 }]],
        onFrame(e, f) {
          if (f >= F(36) && f < F(56)) {
            if (f % 3 === 0) BK.fx.dust(e.x - e.face * 40, e.y + U.rand(-6, 6), 1);
            if (atEdge(e)) e.vx = 0;
          }
        },
        plan: { min: 150, max: 900, dy: 8 }, rest: 34,
      },
      phase: { // 形態変化: 剣を掲げ、亡者を呼ぶ
        dur: F(96), invul: [0, F(96)],
        kf: [[0, {}], [F(22), { aF: 172, eF: 0, wAbs: 182, lean: -16, drop: -18, head: -22, jaw: 0.9, aB: -150, eB: 30, cape: 1.2, tailUp: 0.6 }],
          [F(74), { aF: 170, eF: 0, wAbs: 180, lean: -15, drop: -17, head: -20, jaw: 0.8, aB: -145, eB: 30, cape: 1.1, tailUp: 0.6 }], [F(96), {}]],
        sfx: [[F(4), 'roar', { pitch: 1.3 }]],
        glint: [[F(20), 'tip', '#ff8060']],
        onFrame(e, f) {
          const g = BK.game;
          if (f === F(26) && g) {
            BK.fx.shake(5, 20); BK.fx.flash('#ff2a10', 6);
            const h = g.hero, hx = h ? h.x : e.x, hy = h ? h.y : e.y;
            summon(g, 'undead', hx - 120, hy - 20, { palette: 'blood' });
            summon(g, 'undead', hx + 120, hy + 20, { palette: 'blood' });
          }
          if (f > F(20) && f < F(74) && f % 3 === 0) BK.fx.add({ type: 'dot', x: e.x + U.rand(-60, 60), y: e.y + U.rand(-10, 10), z: U.rand(10, 160), vz: U.rand(0.5, 1.5), life: 30, col: U.choose(['#ff4020', '#c01010', '#ffa060']), size: 2 });
        },
      },
      breaker: { // 振り払い: とぐろを一気に広げる全周攻撃
        dur: F(56), armor: true, invul: [0, 3],
        kf: [[0, {}], [F(14), { coil: 1, drop: 8, lean: 16, head: 10, aF: 30, eF: 30, wAbs: 70, tailUp: 0.5, jaw: 0.6 }],
          [F(19), { coil: -1, drop: -10, lean: -18, head: -16, aF: 120, eF: 20, wAbs: 150, aB: -120, tail: 0.5, jaw: 1 }, 'snap'],
          [F(34), { coil: -0.6, drop: -6, lean: -10, tail: 0.2 }], [F(56), {}]],
        redF: [0, F(17)],
        mark: { t: 'self', rx: 124, ry: 40, f: [0, F(19)], hot: F(18), lock: 0 },
        sfx: [[F(2), 'fire', { pitch: 2.6, vol: 0.7 }], [F(18), 'hitHeavy', { pitch: 0.6 }]],
        onFrame(e, f) {
          if (f === F(18)) {
            radialHit(e, e.x, e.y, 116, 40, 100, { dmg: 8, kb: 'down', push: 6, lift: 5 });
            BK.fx.ring(e.x, e.y, 2, 130, '#e0c890', 18); BK.fx.shake(4, 10); BK.fx.dust(e.x, e.y, 10);
          }
        },
      },
    };
  }
  const SB_M1 = baronMoves(1), SB_M2 = baronMoves(0.8);
  const SB_HURT = R.merge(SB_ST, { lean: -20, head: -22, drop: -4, jaw: 0.7, aF: 20, eF: 60, wAbs: 60, aB: -60, coil: 0.3 });
  const SB_FALL = R.merge(SB_ST, { lean: -42, head: -30, drop: -6, jaw: 1, aF: 140, eF: 20, wAbs: 170, aB: -140, coil: -0.6, cape: 1.3 });
  const SB_DOWN = R.merge(SB_ST, { lean: 78, head: 30, drop: 34, jaw: 0.3, aF: 20, eF: 10, wAbs: 60, aB: 10, eB: 20, coil: 0.9, cape: 0.2 });
  const SB_INTRO = [[0, { drop: 40, lean: 70, head: 30, aF: 10, eF: 10, wAbs: 40, coil: 1, tailUp: 0.4 }],
    [40, { drop: -22, lean: -18, head: -24, aF: 165, eF: 10, wAbs: 190, jaw: 1, aB: -150, eB: 30, tailUp: 1, cape: 1.3 }, 'inOut'],
    [80, { drop: -10, lean: -8, head: -10, aF: 120, eF: 20, wAbs: 150, jaw: 0.2, aB: -60, tailUp: 0.4 }], [100, {}]];
  const SB_DIE = [[0, { lean: -34, head: -32, jaw: 1, aF: 150, eF: 10, wAbs: 175, drop: -12, aB: -150, coil: -0.5, cape: 1.4 }],
    [34, { lean: -26, head: -24, jaw: 1, drop: -8, aF: 130, wAbs: 160, aB: -130, coil: -0.3 }],
    [64, { lean: 80, head: 34, jaw: 0.5, drop: 36, aF: 10, eF: 0, wAbs: 20, aB: 0, eB: 10, coil: 0.8, cape: 0.2 }, 'in']];

  function baronPose(e, b) {
    const S = SB_ST;
    let p;
    if (e.state === 'dying') p = samp(SB_DIE, Math.min(e.st, 70), S);
    else if (e.move) p = samp(e.move.kf, e.mf, S);
    else if (b.intro > 0) p = samp(SB_INTRO, b.introMax - b.intro, S);
    else switch (e.state) {
      case 'hurt': p = lerpPose(S, SB_HURT, Math.min(1, e.hitstun / 8)); break;
      case 'fall': p = SB_FALL; break;
      case 'down': p = SB_DOWN; break;
      case 'getup': p = lerpPose(SB_DOWN, S, U.ease.inOut(Math.min(1, e.st / (e.getupTime || 18)))); break;
      case 'walk': {
        const w = e.walkPh;
        p = R.merge(S, { lean: S.lean + 4 + Math.sin(w) * 3, drop: Math.sin(w * 2) * 2, head: Math.sin(w + 1) * 3, cape: 0.7 });
        break;
      }
      default: {
        const s = Math.sin(b.t * 0.05);
        p = R.merge(S, { lean: S.lean + s * 2, drop: s * 2 - 1, aF: S.aF + s * 3, cape: 0.3 + s * 0.1, tailUp: Math.max(0, Math.sin(b.t * 0.013)) * 0.25 });
      }
    }
    if (b.phase === 2 || e.state === 'dying') { p = Object.assign({}, p); p.rage = b.phase === 2; }
    return p;
  }
  function drawBaron(c, e) {
    const b = st(e), P = palOf(e, b, SB_PALS), p = baronPose(e, b), white = !!P._white;
    let sx = BK.sx(e.x), sy = BK.sy(e.y, e.z) + dyingSink(e);
    if (e.state === 'dying' && e.st < 64) sx += Math.sin(e.st * 1.7) * 1.6;
    c.save();
    dyingClip(c, e, sx, sy, e.def.dieH);
    c.translate(sx, sy); c.scale(e.face, 1);
    const sc = SB_SPEC.scale;
    const sk0 = R.skeleton(p, SB_SPEC);
    sbSnake(c, e, p, P, { x: sk0.hip.x * sc, y: sk0.hip.y * sc }, b.t);
    c.scale(sc, sc);
    const sk = R.draw(c, p, SB_SPEC, { t: b.t, colors: P, tint: white ? '#ffffff' : null });
    c.restore();
    // 剣の軌跡（エンジンの軌跡描画を流用）
    e.spec = SB_SPEC; e.updateTrail(sk);
    if (e.state !== 'dying') e.drawTrail(c);
    // きらめき
    if (e.move && e.move.glint) {
      const f = e.face;
      const hr = { x: sk.headC.x + 5, y: sk.headC.y - 2 };
      drawGlints(c, e, { tip: [sx + sk.tip.x * sc * f, sy + sk.tip.y * sc], eye: [sx + hr.x * sc * f, sy + hr.y * sc] });
    }
  }

  function baronPick(e, b, adx) {
    const M = b.mv, p2 = b.phase === 2;
    return pickW(b, [
      adx < 175 ? [p2 ? 2 : 4, M.slash] : null,
      p2 && adx < 170 ? [3, M.slash2] : null,
      adx < 200 ? [adx < 90 ? 3.5 : 1.6, M.tail] : null,
      adx > 140 ? [adx > 220 ? 5 : 2, M.bite] : [0.5, M.bite],
    ]);
  }

  BK.registerEnemy({
    id: 'snakeBaron', name: '蛇男爵', title: '紅い月の城主', boss: true,
    hp: 420, w: 88, h: 196, weight: 5, speed: 1.0, speedY: 0.8, score: 8000, bossBonus: 30000,
    poise: 70, shadowR: 76, bloodCol: '#6a0c18', drop: null, dieSfx: 'roar', diePitch: 0.75,
    dieW: 150, dieH: 215,
    moves: SB_M1, moves2: SB_M2,
    ai: { speed: 1.0, speedY: 0.8, rage: 1.3, pref: [110, 160], margin: 60, breakN: 7, breakN2: 6, pick: baronPick },
    draw: drawBaron, update: bossUpdate, think: bossThink, onDie: onBossDie,
    onSpawn(e) {
      const b = st(e);
      e.downTime = 50; e.getupTime = 26; e.getupInvul = 24; e.trailCol = '#eef2ff';
      b.intro = b.introMax = 96; b.cd = 30;
      addFloorPainter(e);
      BK.audio.sfx('fire', { pitch: 2.2, vol: 0.6 });
    },
  });

  // =====================================================================
  //  伯爵 ── 人の顔を持つ、膨れ上がった巨大な蛞蝓の使徒
  // =====================================================================
  const CT_COL = {
    flesh: '#9c7c72', fleshDk: '#6c4e4a', fleshHi: '#c9a898', spot: '#4e3230', foot: '#4a302e', footHi: '#7a5a54',
    face: '#d2b29c', faceDk: '#946e5c', stache: '#2c1e18', mouth: '#300a0c', teeth: '#e8e0c6', brow: '#3a2a22',
    tongue: '#b8485a', tongueDk: '#7a2234', eye: '#f0e8d0', pupil: '#8a1010', arm: '#bc9c8c', armDk: '#8a6c62',
    stalk: '#8a6a62', bulb: '#dcc4ac', acid: '#9ad84a', line: 'rgba(12,6,6,0.9)',
  };
  const CT_PALS = makePals(CT_COL, { flesh: '#a8726a', fleshDk: '#744440', spot: '#5a2226', pupil: '#ff2a10', face: '#d8a896' });
  const CT_ST = { squash: 0, hump: 0, jaw: 0, cheek: 0, tongue: 0, arms: 0, head: 0, hx: 0, glow: 0, dizzy: 0 };
  const CT_SPOTS = [[-96, -34, 7, 4], [-70, -72, 10, 5], [-40, -104, 9, 5], [-4, -118, 11, 5], [22, -90, 7, 4], [-46, -54, 13, 6],
    [-108, -18, 6, 3], [6, -46, 9, 5], [42, -104, 6, 3], [-18, -80, 6, 3], [-80, -50, 5, 3]];

  function drawCount(c, e) {
    const b = st(e), P = palOf(e, b, CT_PALS), white = !!P._white;
    const p = countPose(e, b);
    let sx = BK.sx(e.x), sy = BK.sy(e.y, e.z) + dyingSink(e);
    if (e.state === 'dying' && e.st < 64) sx += Math.sin(e.st * 1.9) * 2;
    const t = b.t;
    c.save();
    dyingClip(c, e, sx, sy, e.def.dieH);
    c.translate(sx, sy); c.scale(e.face, 1);
    const walk = e.state === 'walk' ? e.walkPh : 0;
    const wob = Math.sin(t * 0.08) * 0.018 + (walk ? Math.sin(walk * 2) * 0.025 : 0);
    const sq = p.squash;
    const kx = 1 + sq * 0.2 - wob * 0.6, ky = Math.max(0.12, 1 - sq * 0.38 + wob);
    c.scale(kx, ky);
    const H = 1 + p.hump * 0.18, hx = p.hx, hy = p.head;
    const fx = 86 + hx, fy = -64 + hy;
    // 奥の触角
    ctStalk(c, P, fx - 26, fy - 30, fx - 26, fy - 58, fx - 14 + Math.sin(t * 0.07 + 1) * 3, fy - 72, white);
    // 胴体
    c.beginPath();
    c.moveTo(-134, -3);
    c.quadraticCurveTo(-142, -36, -106, -72 * H);
    c.bezierCurveTo(-82, -130 * H, -6, -152 * H, 36, -124 * H);
    c.quadraticCurveTo(58 + hx * 0.5, -120 * H + hy * 0.5, 76 + hx, -112 + hy);
    c.quadraticCurveTo(112 + hx, -104 + hy, 118 + hx, -60 + hy);
    c.quadraticCurveTo(122 + hx, -12, 92, -3);
    c.closePath();
    c.fillStyle = P.flesh; c.fill();
    c.strokeStyle = P.line; c.lineWidth = 1.8; c.stroke();
    if (!white) {
      // 腹側の影
      c.fillStyle = P.fleshDk; c.globalAlpha *= 0.75;
      c.beginPath(); c.moveTo(-132, -5); c.quadraticCurveTo(-20, -40, 104, -18); c.lineTo(96, -3); c.lineTo(-132, -3); c.closePath(); c.fill();
      c.globalAlpha /= 0.75;
      // 斑点
      c.fillStyle = P.spot;
      for (const s of CT_SPOTS) { c.beginPath(); c.ellipse(s[0], s[1] * (s[1] < -60 ? H : 1), s[2], s[3], -0.2, 0, TAU); c.fill(); }
      // 肉のひだ
      c.strokeStyle = P.fleshDk; c.lineWidth = 2;
      for (const x of [-100, -70, -38, -4]) {
        const top = x < -90 ? -70 : x < -60 ? -108 : -128;
        c.beginPath(); c.moveTo(x + 8, -10); c.quadraticCurveTo(x - 8, (top * H - 10) / 2, x + 4, top * H + 8); c.stroke();
      }
      // ぬめりの光沢
      c.strokeStyle = 'rgba(255,245,235,0.32)'; c.lineWidth = 3;
      c.beginPath(); c.moveTo(-104, -66 * H); c.bezierCurveTo(-80, -118 * H, -12, -138 * H, 26, -116 * H); c.stroke();
      c.strokeStyle = 'rgba(255,245,235,0.18)'; c.lineWidth = 1.5;
      c.beginPath(); c.moveTo(-118, -40); c.quadraticCurveTo(-116, -58, -104, -70 * H); c.stroke();
    }
    // 腹足（波打つ縁）
    c.beginPath(); c.moveTo(-134, -2);
    const ph = t * 0.15 + walk * 2;
    for (let x = -134; x < 96; x += 10) c.quadraticCurveTo(x + 5, 3 + Math.sin(x * 0.25 + ph) * 1.5, x + 10, -1);
    c.lineTo(96, -10); c.quadraticCurveTo(-20, -14, -134, -9); c.closePath();
    c.fillStyle = P.foot; c.fill(); c.strokeStyle = P.line; c.lineWidth = 1.2; c.stroke();
    // 退化した人の腕（2本）: 顔の後ろから生え、顎の下に手が見える
    ctArms(c, P, p, fx, fy, t, white);
    // 手前の触角
    ctStalk(c, P, fx - 8, fy - 38, fx - 4, fy - 70, fx + 14 + Math.sin(t * 0.06) * 4, fy - 86, white);
    // 顔
    ctFace(c, P, p, fx, fy, t, white, b);
    // 舌
    if (p.tongue > 0.02) ctTongue(c, P, p, fx, fy, t, white);
    c.restore();
    // 口の位置（きらめき・唾の発射点）
    const mx = (fx + 12 * FS) * kx, my = (fy + (17 + p.jaw * 5) * FS) * ky;
    b.mouth = { x: e.x + e.face * mx, z: e.z - my };
    if (e.move && e.move.glint) drawGlints(c, e, { mouth: [sx + e.face * mx, sy + my], eye: [sx + e.face * (fx + 10 * FS) * kx, sy + (fy - 12 * FS) * ky] });
  }
  const FS = 1.32; // 顔の大きさ
  function ctStalk(c, P, x0, y0, cx, cy, x1, y1, white) {
    tube(c, qpts(x0, y0, cx, cy, x1, y1, 6), 8, 4, P.stalk, P.line, 1.1);
    R.circle(c, x1, y1, 4.6, P.bulb, P.line);
    if (!white) R.circle(c, x1 + 1.4, y1 - 0.5, 1.6, '#1a0808');
  }
  function ctFace(c, P, p, ox, oy, t, white, b) {
    const jaw = U.clamp(p.jaw, 0, 1), ch = U.clamp(p.cheek, 0, 1);
    const fx = 0, fy = 0;
    c.save(); c.translate(ox, oy); c.scale(FS, FS);
    // 顔の土台（肉に埋まった人の顔）
    c.beginPath(); c.ellipse(fx + 2, fy, 25, 33, -0.08, 0, TAU);
    c.fillStyle = P.face; c.fill(); c.strokeStyle = P.line; c.lineWidth = 1.3; c.stroke();
    if (!white) {
      // 顔の縁の影（肉との境目）
      c.strokeStyle = P.faceDk; c.lineWidth = 2.2;
      c.beginPath(); c.ellipse(fx + 2, fy, 23, 31, -0.08, 1.9, 4.2); c.stroke();
    }
    // 頬（膨らむ）
    c.fillStyle = P.face; c.strokeStyle = P.faceDk; c.lineWidth = 1.1;
    c.beginPath(); c.ellipse(fx - 6, fy + 8, 9 + ch * 7, 8 + ch * 6, 0, 0, TAU); c.fill(); c.stroke();
    c.beginPath(); c.ellipse(fx + 22, fy + 9, 7 + ch * 6, 7 + ch * 5, 0, 0, TAU); c.fill(); c.stroke();
    if (!white) {
      // 額のしわ・禿げ頭の数本の髪
      c.strokeStyle = P.faceDk; c.lineWidth = 0.9;
      c.beginPath();
      c.moveTo(fx - 8, fy - 24); c.quadraticCurveTo(fx + 6, fy - 28, fx + 20, fy - 24);
      c.moveTo(fx - 6, fy - 19); c.quadraticCurveTo(fx + 6, fy - 22, fx + 18, fy - 19);
      c.stroke();
      c.strokeStyle = P.stache; c.lineWidth = 0.8;
      c.beginPath(); c.moveTo(fx - 6, fy - 31); c.quadraticCurveTo(fx - 2, fy - 38, fx + 6, fy - 36); c.moveTo(fx + 2, fy - 32); c.quadraticCurveTo(fx + 8, fy - 38, fx + 14, fy - 34); c.stroke();
    }
    // 目（小さく血走った目）
    const dz = p.dizzy;
    for (const [ex, ey, er] of [[fx + 1, fy - 11, 4.4], [fx + 17, fy - 11, 3.8]]) {
      c.fillStyle = P.eye; c.beginPath(); c.ellipse(ex, ey, er, er * 0.7, 0, 0, TAU); c.fill();
      c.strokeStyle = P.line; c.lineWidth = 0.9; c.stroke();
      if (!white) {
        if (dz > 0.5) {
          c.strokeStyle = P.pupil; c.lineWidth = 1; c.beginPath(); c.arc(ex, ey, er * 0.5, t * 0.3, t * 0.3 + 4.5); c.stroke();
        } else {
          c.fillStyle = P.pupil; c.beginPath(); c.arc(ex + 1, ey + 0.3, 1.7, 0, TAU); c.fill();
        }
        // 目の下のたるみ
        c.strokeStyle = P.faceDk; c.lineWidth = 0.8; c.beginPath(); c.arc(ex, ey + 1, er + 1.5, 0.4, 2.6); c.stroke();
        c.strokeStyle = P.brow; c.lineWidth = 2.2;
        c.beginPath(); c.moveTo(ex - er - 1, ey - er * 0.9 + (b.phase === 2 ? -2 : 0)); c.lineTo(ex + er + 1, ey - er * 0.6 + (b.phase === 2 ? 2 : 0)); c.stroke();
      }
    }
    // 鼻（団子鼻）
    c.fillStyle = P.face; c.beginPath(); c.ellipse(fx + 13, fy - 1, 6, 6.5, 0, 0, TAU); c.fill();
    c.strokeStyle = P.faceDk; c.lineWidth = 1; c.stroke();
    if (!white) { c.fillStyle = P.faceDk; c.beginPath(); c.ellipse(fx + 15, fy + 3, 2, 1.2, 0, 0, TAU); c.fill(); }
    // 口
    const my = fy + 17 + jaw * 5;
    if (jaw > 0.08) {
      c.fillStyle = P.mouth; c.beginPath(); c.ellipse(fx + 11, my, 8 + jaw * 6, 1.5 + jaw * 11, 0, 0, TAU); c.fill();
      c.strokeStyle = P.line; c.lineWidth = 1; c.stroke();
      if (!white) {
        for (let i = -2; i <= 2; i++) { const x = fx + 11 + i * (3 + jaw * 1.5); R.poly(c, [x - 1.4, my - 1.5 - jaw * 10, x + 1.4, my - 1.5 - jaw * 10, x, my + 1 - jaw * 7], P.teeth); }
        for (let i = -1; i <= 1; i++) { const x = fx + 11 + i * (4 + jaw * 2); R.poly(c, [x - 1.3, my + 1.5 + jaw * 10, x + 1.3, my + 1.5 + jaw * 10, x, my - 1 + jaw * 6], P.teeth); }
        // 酸の光
        if (p.glow > 0.05) { const ga = c.globalAlpha; c.globalAlpha = ga * (0.5 + p.glow * 0.4); c.fillStyle = P.acid; c.beginPath(); c.ellipse(fx + 11, my + 2, 5 + jaw * 3, 1 + jaw * 6, 0, 0, TAU); c.fill(); c.globalAlpha = ga; }
        else { c.fillStyle = P.tongue; c.beginPath(); c.ellipse(fx + 11, my + jaw * 6, 5 + jaw * 3, 1 + jaw * 3, 0, 0, TAU); c.fill(); }
      }
    } else {
      c.strokeStyle = P.line; c.lineWidth = 1.2;
      c.beginPath(); c.moveTo(fx + 2, my); c.quadraticCurveTo(fx + 11, my + 2 + Math.sin(t * 0.1), fx + 20, my); c.stroke();
    }
    // 巻いた口ひげ（伯爵の証）
    const mw = Math.sin(t * 0.05) * 1.2;
    c.fillStyle = P.stache; c.strokeStyle = P.line; c.lineWidth = 0.8; c.beginPath();
    c.moveTo(fx + 12, fy + 4);
    c.quadraticCurveTo(fx - 2, fy + 1, fx - 16, fy + 10 + mw);
    c.quadraticCurveTo(fx - 25, fy + 6 + mw, fx - 19, fy - 3 + mw);
    c.quadraticCurveTo(fx - 17, fy + 5, fx - 9, fy + 9);
    c.quadraticCurveTo(fx + 2, fy + 13, fx + 12, fy + 11);
    c.quadraticCurveTo(fx + 25, fy + 14, fx + 34, fy + 8 - mw);
    c.quadraticCurveTo(fx + 42, fy + 2 - mw, fx + 38, fy - 4 - mw);
    c.quadraticCurveTo(fx + 38, fy + 5, fx + 29, fy + 4);
    c.quadraticCurveTo(fx + 20, fy + 2, fx + 12, fy + 4);
    c.fill(); c.stroke();
    // 二重顎
    if (!white) {
      c.strokeStyle = P.faceDk; c.lineWidth = 1.1;
      c.beginPath(); c.moveTo(fx - 4, my + 9 + jaw * 5); c.quadraticCurveTo(fx + 10, my + 15 + jaw * 5, fx + 24, my + 8 + jaw * 5); c.stroke();
    }
    c.restore();
  }
  function ctArms(c, P, p, fx, fy, t, white) {
    const up = U.clamp(p.arms, 0, 1);
    for (let i = 0; i < 2; i++) {
      const tw = Math.sin(t * (0.09 + i * 0.03) + i) * 3;
      const shx = fx - 36 + i * 10, shy = fy + 22 + i * 4;
      // 下: 顎の下で床をまさぐる / 上: 頭を抱えて泣き叫ぶ
      const elx = U.lerp(shx + 14 + tw * 0.3, shx - 8, up), ely = U.lerp(shy + 20, shy - 26, up);
      const hdx = U.lerp(shx + 34 + tw, shx + 10 + i * 8, up), hdy = U.lerp(-7 + tw * 0.3, shy - 58 + tw, up);
      const col = i ? P.arm : P.armDk;
      R.limb(c, shx, shy, elx, ely, 7, 5.5, col, P.line);
      R.limb(c, elx, ely, hdx, hdy, 5.5, 4.5, col, P.line);
      R.circle(c, hdx, hdy, 3.4, col, P.line);
      // 爪の伸びた指
      c.strokeStyle = P.line; c.lineWidth = 1.2;
      const d = up > 0.5 ? -1 : 1;
      c.beginPath(); c.moveTo(hdx, hdy); c.lineTo(hdx + 5, hdy + 3 * d); c.moveTo(hdx, hdy); c.lineTo(hdx + 6, hdy); c.moveTo(hdx, hdy); c.lineTo(hdx + 3, hdy + 5 * d); c.stroke();
    }
  }
  function ctTongue(c, P, p, fx, fy, t, white) {
    const L = 8 + p.tongue * 180;
    const x0 = fx + 14 * FS, y0 = fy + (19 + p.jaw * 5) * FS;
    const x1 = x0 + L, y1 = fy + 34 + Math.sin(t * 0.3) * 3;
    const pts = qpts(x0, y0, x0 + L * 0.5, y0 + 10 + Math.sin(t * 0.21) * 6, x1, y1, 12);
    tube(c, pts, 15, 6, P.tongue, P.line, 1.3);
    if (!white) {
      c.strokeStyle = P.tongueDk; c.lineWidth = 1.4; polyline(c, pts); c.stroke();
    }
    // 先端のかえし
    R.poly(c, [x1 - 2, y1 - 4, x1 + 11, y1 - 8, x1 + 5, y1, x1 + 11, y1 + 8, x1 - 2, y1 + 4], P.tongue, P.line);
  }

  const CT_HURT = Object.assign({}, CT_ST, { squash: 0.14, jaw: 0.6, head: -6, hx: -5 });
  const CT_DOWN = Object.assign({}, CT_ST, { squash: 0.46, jaw: 0.5, dizzy: 1, head: 6 });
  const CT_DIE = [[0, { squash: -0.2, jaw: 1, head: -16, arms: 1, hump: 0.2 }], [40, { squash: 0.1, jaw: 1, head: -8, arms: 1 }],
    [90, { squash: 0.9, jaw: 0.6, head: 10, arms: 0, dizzy: 1 }, 'in']];
  function countPose(e, b) {
    const S = CT_ST;
    if (e.state === 'dying') return samp(CT_DIE, Math.min(e.st, 90), S);
    if (e.move) return samp(e.move.kf, e.mf, S);
    if (b.dropping || e.state === 'air') return Object.assign({}, S, { squash: -0.28, jaw: 0.7, arms: 1, head: -8 });
    if (b.land > 0) return Object.assign({}, S, { squash: 0.55 * b.land / 30, jaw: 0.4 * b.land / 30 });
    switch (e.state) {
      case 'hurt': return lerpPose(S, CT_HURT, Math.min(1, e.hitstun / 8));
      case 'fall': return Object.assign({}, S, { squash: -0.15, jaw: 0.9, arms: 1 });
      case 'down': return CT_DOWN;
      case 'getup': return lerpPose(CT_DOWN, S, U.ease.inOut(Math.min(1, e.st / (e.getupTime || 18))));
    }
    if (b.intro > 0) { const k = b.intro / b.introMax; return Object.assign({}, S, { jaw: 0.9 * Math.sin(k * Math.PI), head: -10 * Math.sin(k * Math.PI), arms: Math.sin(k * Math.PI) }); }
    return Object.assign({}, S, { jaw: Math.max(0, Math.sin(b.t * 0.045)) * 0.18, hump: Math.sin(b.t * 0.05) * 0.05 });
  }

  /** 酸の水たまり（跳べばかわせる低い判定。キャラより奥に描く） */
  function acidPuddle(x, y, owner, o) {
    o = o || {};
    const g = BK.game;
    if (!g) return;
    const w = o.w || 70, life = o.life || 190;
    BK.audio.sfx('fire', { pitch: 1.6, vol: 0.6 });
    g.addProjectile(new BK.Projectile({
      x, y: U.clamp(y, 2, BK.DEPTH - 2), z: 6, vx: 0, w, h: 14, depth: 16, team: 'enemy', owner, dmg: o.dmg || 4, kb: 'light', push: 0.5, stop: 0,
      life, pierce: 999, noShadow: false, sfx: 'fire', fx: 'none', seed: Math.random() * 10,
      tick(p) {
        if (p.t % 24 === 0) p.hit.clear();
        if (p.t % 9 === 0) BK.fx.add({ type: 'smoke', x: p.x + U.rand(-w * 0.4, w * 0.4), y: p.y + U.rand(-5, 5), z: 2, vz: U.rand(0.3, 0.9), life: U.randi(16, 26), size: U.rand(3, 6), col: 'rgba(160,230,90,0.3)', drag: 0.95 });
      },
      drawShadow(c) {
        const p = this, sx = BK.sx(p.x), sy = BK.sy(p.y, 0);
        const k = Math.min(1, p.life / 30, p.t / 6);
        c.save();
        c.globalAlpha = 0.55 * k; c.fillStyle = '#3a6a14';
        c.beginPath(); c.ellipse(sx, sy, w / 2, 8, 0, 0, TAU); c.fill();
        c.globalAlpha = 0.6 * k; c.fillStyle = '#8ad040';
        c.beginPath(); c.ellipse(sx - 3, sy - 1, w * 0.36, 5, 0, 0, TAU); c.fill();
        c.globalAlpha = 0.8 * k; c.fillStyle = '#d8ff9a';
        for (let i = 0; i < 4; i++) {
          const bt = (p.t * 0.05 + i * 0.27 + p.seed) % 1;
          c.beginPath(); c.arc(sx + Math.sin(i * 2.3 + p.seed) * w * 0.3, sy - 1 + Math.cos(i * 1.7) * 3, 1 + bt * 2.2, 0, TAU); c.fill();
        }
        c.restore();
      },
      drawFn() {},
    }));
  }
  /** 酸の唾: 目標地点へ放物線で飛ぶ。落下点に小さな照準を出す */
  function acidBlob(e, tx, ty, T) {
    const g = BK.game, b = st(e);
    if (!g) return;
    const m = b.mouth || { x: e.x + e.face * 100, z: e.z + 50 };
    const x0 = m.x, z0 = Math.max(20, m.z), y0 = e.y + 2;
    const gr = 0.4;
    ty = U.clamp(ty, 4, BK.DEPTH - 4);
    const vx = (tx - x0) / T, vy = (ty - y0) / T, vz = (-z0 + 0.5 * gr * T * (T - 1)) / T;
    g.addProjectile(new BK.Projectile({
      x: x0, y: y0, z: z0, vx, vy, vz, grav: gr, w: 16, h: 16, depth: 14, team: 'enemy', owner: e, dmg: 10, kb: 'heavy', push: 2.5, life: T + 40, tx, ty,
      onGround(p) { p.remove = true; acidPuddle(p.x, p.y, e); for (let i = 0; i < 8; i++) BK.fx.add({ type: 'dot', x: p.x, y: p.y, z: 2, vx: U.rand(-2.5, 2.5), vz: U.rand(1, 3.5), g: 0.3, life: 20, col: '#a8e858', size: 2.2 }); },
      onHit(p, t) { p.remove = true; acidPuddle(t.x, t.y, e); },
      drawShadow(c) {
        const p = this, sx = BK.sx(p.tx), sy = BK.sy(p.ty, 0), k = 1 - Math.min(1, p.t / T);
        c.save();
        c.globalAlpha = 0.7; c.strokeStyle = '#b0f060'; c.lineWidth = 1.5;
        c.beginPath(); c.ellipse(sx, sy, 16 + k * 20, 5 + k * 6, 0, 0, TAU); c.stroke();
        c.globalAlpha = 0.25; c.fillStyle = '#9ad84a'; c.beginPath(); c.ellipse(sx, sy, 16, 5, 0, 0, TAU); c.fill();
        c.globalAlpha = 0.35; c.fillStyle = '#000'; c.beginPath(); c.ellipse(BK.sx(p.x), BK.sy(p.y, 0), 6, 2, 0, 0, TAU); c.fill();
        c.restore();
      },
      drawFn(c, sx, sy, p) {
        c.fillStyle = '#6aa82a'; c.beginPath(); c.ellipse(sx, sy, 7, 6, p.t * 0.3, 0, TAU); c.fill();
        c.fillStyle = '#b8f070'; c.beginPath(); c.arc(sx - 2, sy - 2, 2.6, 0, TAU); c.fill();
        c.strokeStyle = 'rgba(20,40,6,0.8)'; c.lineWidth = 1; c.beginPath(); c.ellipse(sx, sy, 7, 6, p.t * 0.3, 0, TAU); c.stroke();
      },
    }));
  }

  function countMoves(k) {
    const F = mkF(k);
    const PRESS = { rise: F(22), lock: F(70), fall: F(96), land: 0 };
    PRESS.land = PRESS.fall + 8;
    return {
      press: { // のしかかり: 跳び上がり、影が追ってきて、落ちてくる
        dur: PRESS.land + F(56), armor: true, invul: [PRESS.rise + 4, PRESS.fall - 2],
        kf: [[0, {}], [F(18), { squash: 0.45, jaw: 0.3, arms: 0.5 }], [PRESS.rise + 2, { squash: -0.4, jaw: 0.7, arms: 1 }, 'snap'],
          [PRESS.fall, { squash: -0.25, jaw: 0.8, arms: 1 }], [PRESS.land, { squash: -0.35, jaw: 1, arms: 1 }],
          [PRESS.land + 3, { squash: 0.7, jaw: 0.6, dizzy: 1 }, 'snap'], [PRESS.land + F(40), { squash: 0.45, jaw: 0.4, dizzy: 1 }], [PRESS.land + F(56), {}]],
        redF: [F(4), F(18)],
        mark: { t: 'self', rx: 108, ry: 38, f: [PRESS.rise, PRESS.land], hot: PRESS.land, lock: PRESS.lock },
        sfx: [[F(4), 'growl', { pitch: 0.5 }], [PRESS.rise, 'jump', { pitch: 0.4 }], [PRESS.lock, 'select', { pitch: 0.5 }], [PRESS.fall, 'swingHeavy', { pitch: 0.5 }]],
        onFrame(e, f) {
          const g = BK.game, h = g && g.hero;
          if (f >= PRESS.rise && f < PRESS.land) {
            let z;
            if (f < PRESS.rise + 16) z = U.ease.out((f - PRESS.rise) / 16) * 300;
            else if (f < PRESS.fall) z = 300;
            else z = 300 * (1 - U.ease.in((f - PRESS.fall) / (PRESS.land - PRESS.fall)));
            e.z = Math.max(0.1, z); e.vz = 0; e.vx = 0; e.vy = 0;
            // 影が主人公を追う（歩き続ければ振り切れる速さ）
            if (h && f < PRESS.lock) {
              e.x = U.approach(e.x, h.x, 1.7); e.y = U.approach(e.y, h.y, 1.0);
              e.face = U.sign(h.x - e.x || e.face);
            }
          }
          if (f === PRESS.land) {
            e.z = 0; e.vz = 0;
            radialHit(e, e.x, e.y, 100, 36, 60, { dmg: 22, kb: 'down', push: 6, lift: 6 });
            BK.fx.shake(9, 18); BK.audio.sfx('cannon', { pitch: 0.7 }); BK.audio.sfx('thud', { pitch: 0.5 });
            BK.fx.ring(e.x, e.y, 2, 150, '#d8c0a8', 20);
            BK.fx.dust(e.x - 80, e.y, 8); BK.fx.dust(e.x + 80, e.y, 8); BK.fx.dust(e.x, e.y + 20, 8);
            for (let i = 0; i < 10; i++) BK.fx.add({ type: 'dot', x: e.x + U.rand(-90, 90), y: e.y + U.rand(-20, 20), z: 4, vx: U.rand(-3, 3), vz: U.rand(2, 5), g: 0.3, life: 26, col: '#b89080', size: U.rand(2, 4) });
          }
        },
        onEnd(e) { if (e.z > 0 && !e.dead) { e.vz = -4; } },
        plan: { min: 0, max: 260, dy: 60 }, rest: 40,
      },
      bite: { // 食らいつき: 顔をのけぞらせてから前へ突き出す（近距離）
        dur: F(62),
        kf: [[0, {}], [F(20), { hx: -14, head: -12, jaw: 0.5, squash: -0.12, arms: 0.4 }], [F(26), { hx: 24, head: 10, jaw: 1, squash: 0.12 }, 'snap'],
          [F(38), { hx: 22, head: 8, jaw: 0.8, squash: 0.1 }], [F(62), {}]],
        hits: [{ f: [F(25), F(31)], x: [0, 165], z: [0, 110], d: 22, dmg: 13, kb: 'heavy', push: 5, sfx: 'hit' }],
        move: [[0, 0], [F(23), 2.4 / k], [F(31), 0]],
        glint: [[F(3), 'eye', '#ff9070']],
        sfx: [[F(3), 'growl', { pitch: 0.9, vol: 0.7 }], [F(24), 'swing', { pitch: 0.5 }]],
        plan: { min: 0, max: 150, dy: 18 }, rest: 34,
      },
      whip: { // 舌の鞭: 口を開け、舌を前方へ叩きつける
        dur: F(80), armor: k < 1,
        kf: [[0, {}], [F(24), { jaw: 1, head: -8, hx: -6, tongue: 0.1, cheek: 0.2 }], [F(30), { jaw: 1, tongue: 1, head: 6, hx: 6 }, 'snap'],
          [F(42), { jaw: 1, tongue: 1, head: 6, hx: 6 }], [F(64), { jaw: 0.6, tongue: 0.25 }], [F(80), {}]],
        hits: [{ f: [F(28), F(38)], x: [96, 282], z: [18, 90], d: 18, dmg: 14, kb: 'heavy', push: 5, sfx: 'hit' }],
        redF: k < 1 ? [F(4), F(24)] : null,
        glint: [[F(6), 'mouth']],
        mark: { t: 'zone', x: [96, 282], d: 18, f: [F(4), F(38)], hot: F(28) },
        sfx: [[F(4), 'growl', { pitch: 0.7 }], [F(27), 'swing', { pitch: 0.6 }]],
        onFrame(e, f) { if (f === F(30)) { BK.fx.dust(e.x + e.face * 250, e.y, 5); } },
        plan: { min: 110, max: 270, dy: 12 }, rest: 44,
      },
      spit: { // 酸の唾: 頬を膨らませ、落下地点へ放物線で吐く。水たまりが残る
        dur: F(76),
        kf: [[0, {}], [F(28), { cheek: 1, jaw: 0.15, head: -8, glow: 1 }], [F(33), { cheek: 0, jaw: 0.95, head: 8, hx: 5, glow: 0.4 }, 'snap'],
          [F(50), { jaw: 0.4 }], [F(76), {}]],
        glint: [[F(6), 'mouth', '#d0ff90']],
        sfx: [[F(6), 'growl', { pitch: 1.2, vol: 0.6 }], [F(32), 'fire', { pitch: 0.7 }]],
        onFrame(e, f) {
          const g = BK.game, h = g && g.hero, b = st(e);
          if (f === F(32) && h) {
            const T = 34;
            acidBlob(e, h.x, h.y, T);
            if (b.phase === 2) { acidBlob(e, h.x - 70, h.y - 22, T + 4); acidBlob(e, h.x + 70, h.y + 22, T + 4); }
          }
        },
        plan: { min: 70, max: 900, dy: 80 }, rest: 36,
      },
      phase: { // 形態変化 / 悪霊召喚: 泣き叫び、悪霊を呼び出す
        dur: F(96), invul: [0, F(96)],
        kf: [[0, {}], [F(28), { jaw: 1, head: -16, arms: 1, glow: 0, hump: 0.25, squash: -0.1 }], [F(72), { jaw: 1, head: -14, arms: 1, hump: 0.2, squash: -0.08 }], [F(96), {}]],
        sfx: [[F(6), 'roar', { pitch: 1.5 }], [F(30), 'spirit', { pitch: 0.8 }]],
        onFrame(e, f) {
          const g = BK.game;
          if (f === F(34) && g) spawnSpirits(e, g, 2);
          if (f > F(20) && f < F(72) && f % 4 === 0) BK.fx.add({ type: 'smoke', x: e.x + U.rand(-90, 60), y: e.y + U.rand(-10, 10), z: U.rand(30, 120), vz: U.rand(0.6, 1.4), life: 34, size: U.rand(6, 11), col: 'rgba(150,200,230,0.3)' });
          if (f === F(28)) BK.fx.shake(5, 24);
        },
      },
      summon: { // 悪霊召喚（第2形態で時々）
        dur: F(80), armor: true,
        kf: [[0, {}], [F(24), { jaw: 1, head: -14, arms: 1, hump: 0.2 }], [F(56), { jaw: 1, head: -12, arms: 1, hump: 0.2 }], [F(80), {}]],
        redF: [F(2), F(24)],
        sfx: [[F(4), 'spirit', { pitch: 0.7 }]],
        onFrame(e, f) { if (f === F(28) && BK.game) spawnSpirits(e, BK.game, 2); },
      },
      breaker: { // 振り払い: 体を膨らませて体液を噴き出す
        dur: F(52), armor: true, invul: [0, 3],
        kf: [[0, {}], [F(16), { squash: -0.25, hump: 0.35, jaw: 0.6, glow: 1, cheek: 0.6 }], [F(20), { squash: 0.3, hump: -0.1, jaw: 1 }, 'snap'], [F(36), { squash: 0.1 }], [F(52), {}]],
        redF: [0, F(18)],
        mark: { t: 'self', rx: 150, ry: 46, f: [0, F(20)], hot: F(19), lock: 0 },
        sfx: [[F(2), 'growl', { pitch: 0.6 }], [F(19), 'explode', { pitch: 1.4, vol: 0.6 }]],
        onFrame(e, f) {
          if (f === F(19)) {
            radialHit(e, e.x, e.y, 150, 46, 120, { dmg: 8, kb: 'down', push: 6.5, lift: 5 });
            BK.fx.ring(e.x, e.y, 2, 160, '#b8e070', 18); BK.fx.shake(4, 10);
            for (let i = 0; i < 14; i++) BK.fx.add({ type: 'dot', x: e.x + U.rand(-80, 80), y: e.y + U.rand(-10, 10), z: U.rand(20, 100), vx: U.rand(-4, 4), vz: U.rand(1, 5), g: 0.3, life: 30, col: U.choose(['#a8e858', '#d0c0a0']), size: U.rand(2, 4) });
          }
        },
      },
    };
  }
  function spawnSpirits(e, g, n) {
    for (let i = 0; i < n; i++) {
      const x = e.x - e.face * U.rand(40, 90), y = e.y + (i ? 26 : -26);
      BK.fx.add({ type: 'smoke', x, y, z: 60, vz: 1, life: 30, size: 16, col: 'rgba(170,220,240,0.35)' });
      BK.fx.ring(x, y, 50, 30, '#bfe8ff', 16);
      summon(g, 'spirit', x, y);
    }
    st(e).summons++;
  }
  const CT_M1 = countMoves(1), CT_M2 = countMoves(0.82);

  function countPick(e, b, adx, ady) {
    const M = b.mv, p2 = b.phase === 2;
    return pickW(b, [
      adx < 150 ? [3.5, M.bite] : null,
      adx < 150 ? [2, M.press] : [1.2, M.press],
      adx >= 90 && adx < 280 ? [3, M.whip] : null,
      adx > 130 ? [adx > 240 ? 4 : 2, M.spit] : [p2 ? 1.4 : 0.8, M.spit],
    ]);
  }
  function countSpecial(e, b, game) {
    // 第2形態: 手下が少なければ時々悪霊を呼ぶ
    if (b.phase !== 2 || b.t < b.nextSummon) return null;
    if (minionCount(e, game) >= 2) return null;
    b.nextSummon = b.t + 900;
    return b.mv.summon;
  }

  BK.registerEnemy({
    id: 'count', name: '伯爵', title: '異端狩りの領主', boss: true,
    hp: 520, w: 196, h: 128, weight: 9, speed: 0.55, speedY: 0.45, score: 10000, bossBonus: 40000,
    poise: 90, shadowR: 118, bloodCol: '#6a2a24', drop: null, dieSfx: 'roar', diePitch: 0.5,
    dieW: 230, dieH: 150,
    moves: CT_M1, moves2: CT_M2,
    ai: {
      speed: 0.55, speedY: 0.45, rage: 1.3, pref: [150, 210], margin: 70, marginF: 118, turnDelay: 20, breakN: 7, breakN2: 6,
      pick: countPick, special: countSpecial,
      onDropLand(e, b) {
        b.land = 30; b.intro = b.introMax = 70;
        BK.fx.shake(10, 24); BK.audio.sfx('cannon', { pitch: 0.6 }); BK.audio.sfx('growl', { pitch: 0.45 });
        BK.fx.ring(e.x, e.y, 2, 170, '#d8c0a8', 22);
        BK.fx.dust(e.x - 90, e.y, 10); BK.fx.dust(e.x + 90, e.y, 10);
      },
    },
    draw: drawCount, update: bossUpdate, think: bossThink, onDie: onBossDie,
    onSpawn(e) {
      const b = st(e);
      e.downTime = 56; e.getupTime = 28; e.getupInvul = 24;
      b.cd = 40; b.nextSummon = 0;
      // 天井から落ちてくる
      e.x = U.clamp(e.x, BK.cam.x + 150, BK.cam.x + BK.W - 150);
      e.z = 340; e.vz = 0; e.state = 'air'; b.dropping = true; e.intangible = true;
      addFloorPainter(e);
    },
  });

  // =====================================================================
  //  不死のゾッド ── 翼と角を持つ獣の使徒。巨大な剣を振るう、最も好戦的なボス
  // =====================================================================
  const ZD_COL = {
    skin: '#664a3a', fur: '#33261f', furHi: '#54402f', mane: '#191212', horn: '#dccfb0', hornDk: '#9a8a6a',
    cloth: '#33261f', clothDark: '#1f1714', sleeve: '#664a3a', body: '#664a3a', bodyHi: '#8a6a52', belt: '#2a1a12',
    boot: '#3a2a24', bootDark: '#261a16', glove: '#664a3a', gloveDark: '#43302a', claw: '#e2d8c2',
    metal: '#9a968e', metalDark: '#4e4b47', grip: '#2a1a10',
    wing: '#2c1a1e', wingIn: '#4a2a2e', wingBone: '#46322c',
    eye: '#ffc23a', mouth: '#2a0806', line: 'rgba(8,4,4,0.92)', rim: '#b86a40',
  };
  const ZD_PALS = makePals(ZD_COL, { eye: '#ff3a1a', rim: '#ff5a2a', wingIn: '#6a2426', skin: '#64402e' });

  function zdLeg(c, sp, col, hip, kn, ft, back) {
    // 獣の脚: 太い腿・逆に曲がる踵・鉤爪
    const fur = back ? col('clothDark') : col('fur'), sk = back ? col('gloveDark') : col('skin');
    R.limb(c, hip.x, hip.y, kn.x, kn.y, sp.legW, sp.legW * 0.82, fur, col('line'));
    const hx = kn.x + (ft.x - kn.x) * 0.58 - 5, hy = kn.y + (ft.y - kn.y) * 0.58;
    R.limb(c, kn.x, kn.y, hx, hy, sp.legW * 0.72, sp.legW * 0.5, sk, col('line'));
    R.limb(c, hx, hy, ft.x + 1, ft.y - 2, sp.legW * 0.5, sp.legW * 0.42, sk, col('line'));
    R.poly(c, [ft.x - 4, ft.y - 4, ft.x + 7, ft.y - 4, ft.x + 11, ft.y, ft.x - 4, ft.y + 1], sk, col('line'));
    R.poly(c, [ft.x + 7, ft.y - 3, ft.x + 14, ft.y, ft.x + 8, ft.y + 1], col('claw'));
    R.poly(c, [ft.x + 3, ft.y - 3, ft.x + 9, ft.y + 1, ft.x + 3, ft.y + 1], col('claw'));
    // 腿の毛
    if (!back) R.poly(c, [hip.x - 6, hip.y + 2, kn.x - 5, kn.y - 2, kn.x - 9, kn.y + 3, U.lerp(hip.x, kn.x, 0.5) - 10, U.lerp(hip.y, kn.y, 0.5)], col('mane'));
  }
  function zdArm(c, sp, col, sh, el, hd, back) {
    R.limb(c, sh.x, sh.y, el.x, el.y, sp.armW, sp.armW * 0.85, back ? col('gloveDark') : col('skin'), col('line'));
    R.limb(c, el.x, el.y, hd.x, hd.y, sp.armW * 0.9, sp.armW * 0.7, back ? col('gloveDark') : col('skin'), col('line'));
    R.circle(c, hd.x, hd.y, sp.armW * 0.5, back ? col('gloveDark') : col('skin'), col('line'));
    // 腕の筋
    if (!back) { c.strokeStyle = col('bodyHi'); c.lineWidth = 1; c.beginPath(); c.moveTo(U.lerp(sh.x, el.x, 0.25), U.lerp(sh.y, el.y, 0.25) - 2); c.lineTo(U.lerp(sh.x, el.x, 0.8), U.lerp(sh.y, el.y, 0.8) - 2); c.stroke(); }
  }
  function zdTorso(c, sp, col, sk) {
    const h = sk.hip, s = sk.sho;
    const a = Math.atan2(s.y - h.y, s.x - h.x), nx = -Math.sin(a), ny = Math.cos(a), tx = Math.cos(a), ty = Math.sin(a);
    const wW = sp.waistW / 2, cW = sp.chestW / 2;
    // 逆三角形の分厚い胴
    R.poly(c, [h.x + nx * wW, h.y + ny * wW, s.x + nx * cW + tx * 2, s.y + ny * cW + ty * 2, s.x - nx * cW * 0.8, s.y - ny * cW * 0.8, h.x - nx * wW, h.y - ny * wW], col('body'), col('line'));
    // 胸筋と腹筋
    c.strokeStyle = col('line'); c.lineWidth = 0.9;
    const m = (k, o) => [U.lerp(h.x, s.x, k) + nx * o, U.lerp(h.y, s.y, k) + ny * o];
    let p0 = m(0.72, cW * 0.9), p1 = m(0.62, cW * 0.1), p2 = m(0.7, -cW * 0.5);
    c.beginPath(); c.moveTo(p0[0], p0[1]); c.quadraticCurveTo(p1[0], p1[1], p2[0], p2[1]); c.stroke();
    for (const k of [0.25, 0.42]) { p0 = m(k, wW * 0.8); p1 = m(k, -wW * 0.3); c.beginPath(); c.moveTo(p0[0], p0[1]); c.lineTo(p1[0], p1[1]); c.stroke(); }
    p0 = m(0.12, wW * 0.3); p1 = m(0.6, wW * 0.5); c.beginPath(); c.moveTo(p0[0], p0[1]); c.lineTo(p1[0], p1[1]); c.stroke();
    // 背中のリムライト
    c.strokeStyle = col('rim'); c.lineWidth = 1.2; p0 = m(0.1, -wW * 0.9); p1 = m(0.9, -cW * 0.75);
    c.beginPath(); c.moveTo(p0[0], p0[1]); c.lineTo(p1[0], p1[1]); c.stroke();
    // 腰の毛皮
    R.poly(c, [h.x + nx * (wW + 2), h.y + ny * (wW + 2), h.x - nx * (wW + 2), h.y - ny * (wW + 2), h.x - nx * wW - tx * 12, h.y - ny * wW - ty * 12,
      h.x - tx * 18, h.y - ty * 18, h.x + nx * wW - tx * 14, h.y + ny * wW - ty * 14], col('fur'), col('line'));
    R.limb(c, h.x - nx * wW, h.y - ny * wW + 1, h.x + nx * wW, h.y + ny * wW + 1, 4, 4, col('belt'));
    // 首まわりのたてがみ
    const n = sk.neck;
    R.poly(c, [s.x - nx * cW * 0.9, s.y - ny * cW * 0.9, n.x - nx * 10 - tx * 4, n.y - ny * 10 - ty * 4, n.x - nx * 6 + tx * 10, n.y - ny * 6 + ty * 10,
      n.x + tx * 6, n.y + ty * 6, n.x + nx * 8 + tx * 8, n.y + ny * 8 + ty * 8, s.x + nx * cW * 0.7, s.y + ny * cW * 0.7, s.x - tx * 6, s.y - ty * 6], col('mane'), col('line'));
  }
  function zdHead(c, sp, col, sk, pose, opt) {
    const hc = sk.headC, r = sp.headR, jaw = U.clamp(pose.jaw || 0, 0, 1), tint = !!opt.tint;
    c.save(); c.translate(hc.x, hc.y); c.rotate((180 - sk.ha) * D);
    // 奥の角（少し前にずらして2本とも見えるように）
    tube(c, qpts(r * 0.1, -r * 0.7, -r * 0.9, -r * 1.75, r * 0.85, -r * 2.3, 7), r * 0.46, r * 0.08, col('hornDk'), col('line'), 1);
    // たてがみ（後頭部）
    R.poly(c, [-r * 0.2, -r * 0.9, -r * 1.3, -r * 0.8, -r * 1.05, -r * 0.35, -r * 1.7, -r * 0.1, -r * 1.05, r * 0.3, -r * 1.45, r * 0.8, -r * 0.5, r * 0.75], col('mane'), col('line'));
    // 下顎
    c.save(); c.translate(r * 0.35, r * 0.45); c.rotate(jaw * 0.55);
    R.poly(c, [-r * 0.4, -r * 0.1, r * 1.25, -r * 0.05, r * 1.15, r * 0.25, r * 0.2, r * 0.45, -r * 0.35, r * 0.3], col('skin'), col('line'));
    if (!tint) { R.poly(c, [r * 0.95, -r * 0.05, r * 1.1, -r * 0.05, r * 1.02, -r * 0.45], col('claw')); }
    c.restore();
    if (jaw > 0.05) R.poly(c, [r * 0.2, r * 0.35, r * 1.5, r * 0.45, r * 1.3, r * 0.45 + jaw * r * 0.8, r * 0.3, r * 0.55 + jaw * r * 0.5], col('mouth'));
    // 頭蓋と突き出た鼻面
    c.beginPath(); c.ellipse(0, -r * 0.1, r * 1.0, r * 0.88, 0, 0, TAU);
    c.fillStyle = col('skin'); c.fill(); c.strokeStyle = col('line'); c.lineWidth = 1; c.stroke();
    R.poly(c, [r * 0.3, -r * 0.55, r * 1.25, -r * 0.2, r * 1.72, r * 0.18, r * 1.6, r * 0.5, r * 0.3, r * 0.48], col('skin'), col('line'));
    if (!tint) {
      // 上の牙
      R.poly(c, [r * 1.35, r * 0.45, r * 1.5, r * 0.45, r * 1.42, r * 0.45 + r * 0.45 * (0.4 + jaw * 0.6)], col('claw'));
      R.poly(c, [r * 0.85, r * 0.47, r * 0.98, r * 0.47, r * 0.9, r * 0.47 + r * 0.3], col('claw'));
      // 鼻孔・眉間のしわ
      c.fillStyle = '#140a08'; c.beginPath(); c.ellipse(r * 1.58, r * 0.12, r * 0.12, r * 0.07, 0.3, 0, TAU); c.fill();
      c.strokeStyle = col('line'); c.lineWidth = 0.9;
      c.beginPath(); c.moveTo(r * 0.6, -r * 0.45); c.lineTo(r * 1.0, -r * 0.25); c.moveTo(r * 0.7, -r * 0.3); c.lineTo(r * 1.1, -r * 0.1); c.stroke();
      // 光る目（第2形態で赤）
      c.fillStyle = pose.rage ? '#ff3a1a' : col('eye');
      c.beginPath(); c.moveTo(r * 0.28, -r * 0.3); c.lineTo(r * 0.78, -r * 0.4); c.lineTo(r * 0.7, -r * 0.18); c.closePath(); c.fill();
      c.fillStyle = 'rgba(255,200,80,0.25)'; c.beginPath(); c.arc(r * 0.55, -r * 0.3, r * 0.45, 0, TAU); c.fill();
      c.strokeStyle = '#0c0606'; c.lineWidth = 1.6;
      c.beginPath(); c.moveTo(r * 0.12, -r * 0.5); c.lineTo(r * 0.9, -r * 0.5); c.stroke();
    }
    // 手前の大角（前へ湾曲）
    const hornPts = qpts(-r * 0.15, -r * 0.62, -r * 1.55, -r * 1.55, r * 0.35, -r * 2.55, 8);
    tube(c, hornPts, r * 0.62, r * 0.1, col('horn'), col('line'), 1.1);
    if (!tint) {
      c.strokeStyle = col('hornDk'); c.lineWidth = 0.9;
      for (let i = 2; i < 12; i += 3) { const x = hornPts[i], y = hornPts[i + 1]; c.beginPath(); c.moveTo(x - r * 0.18, y + r * 0.1); c.lineTo(x + r * 0.18, y - r * 0.08); c.stroke(); }
    }
    c.restore();
  }
  function zdSword(c, sp, col, len) {
    // 大剣: 両手持ちの長い柄・鍔・幅広で先の反った刃
    R.poly(c, [-22, -2.2, 0, -2.2, 0, 2.2, -22, 2.2], col('grip'));
    R.circle(c, -23, 0, 3, col('metalDark'), col('line'));
    R.poly(c, [-1, -9, 3, -9, 3, 9, -1, 9], col('metalDark'), col('line'));
    R.poly(c, [3, -6.5, len * 0.62, -7.5, len - 6, -9.5, len, -4, len - 3, 3.5, len * 0.7, 6.8, 3, 6], col('metal'), col('line'));
    c.fillStyle = 'rgba(0,0,0,0.25)'; c.fillRect(6, 1.5, len * 0.6, 3.2);
    c.fillStyle = 'rgba(255,255,255,0.18)'; c.fillRect(6, -4.5, len * 0.55, 1.4);
    c.fillStyle = 'rgba(0,0,0,0.5)'; c.fillRect(len * 0.4, 5, 3, 1.8); c.fillRect(len * 0.75, -8, 3, 1.8);
  }
  function zdWing(c, col, root, w, flap, far) {
    // 翼: w=0 たたむ / 1 広げる
    const fl = flap || 0;
    const wx = root.x + U.lerp(-10, -30, w), wy = root.y + U.lerp(-24, -40, w) + fl * 6;
    const tips = [
      [U.lerp(-14, -78, w), U.lerp(-34, -62, w) + fl * 12],
      [U.lerp(-22, -92, w), U.lerp(-10, -16, w) + fl * 10],
      [U.lerp(-24, -80, w), U.lerp(18, 24, w) + fl * 6],
      [U.lerp(-20, -48, w), U.lerp(40, 42, w) + fl * 2],
    ];
    const s = far ? 0.86 : 1, ox = far ? 10 : 0, oy = far ? -4 : 0;
    const P = t => [root.x + ox + t[0] * s, root.y + oy + t[1] * s];
    const W = [wx + ox, wy + oy];
    // 膜
    c.beginPath(); c.moveTo(root.x + ox, root.y + oy); c.lineTo(W[0], W[1]);
    let prev = W;
    for (let i = 0; i < tips.length; i++) {
      const tp = P(tips[i]);
      if (i === 0) c.lineTo(tp[0], tp[1]);
      else { const mx = (prev[0] + tp[0]) / 2 + (W[0] - (prev[0] + tp[0]) / 2) * 0.28, my = (prev[1] + tp[1]) / 2 + (W[1] - (prev[1] + tp[1]) / 2) * 0.28; c.quadraticCurveTo(mx, my, tp[0], tp[1]); }
      prev = tp;
    }
    c.quadraticCurveTo(root.x + ox - 4, root.y + oy + 30 * s, root.x + ox + 2, root.y + oy + 16);
    c.closePath();
    c.fillStyle = far ? col('wing') : col('wingIn'); c.fill(); c.strokeStyle = col('line'); c.lineWidth = 1; c.stroke();
    // 骨
    c.strokeStyle = col('wingBone'); c.lineWidth = 2.2;
    c.beginPath(); c.moveTo(root.x + ox, root.y + oy); c.lineTo(W[0], W[1]);
    for (const t of tips) { const tp = P(t); c.moveTo(W[0], W[1]); c.lineTo(tp[0], tp[1]); }
    c.stroke();
    R.poly(c, [W[0] - 2, W[1], W[0] + 2, W[1] - 7, W[0] + 3, W[1] + 1], col('claw'));
  }
  function zdBehind(c, sp, col, sk, pose, opt) {
    const root = { x: sk.sho.x - 5, y: sk.sho.y + 5 };
    const w = U.clamp(pose.wing || 0, 0, 1), fl = pose.flap || 0;
    zdWing(c, col, root, w, fl, true);
    // 尾（鞭のようにしなる）
    const h = sk.hip, sw = Math.sin((opt.t || 0) * 0.06) * 4;
    const tx = h.x - 44 + sw, ty = h.y + 12 - sw * 0.5;
    tube(c, qpts(h.x - 4, h.y + 1, h.x - 30, h.y + 18, tx, ty, 8), 8, 3, col('skin'), col('line'), 1);
    R.poly(c, [tx + 2, ty - 1, tx - 8, ty - 7, tx - 11, ty + 1, tx - 7, ty + 6, tx + 1, ty + 3], col('mane'), col('line'));
    zdWing(c, col, root, w, fl, false);
  }
  function zdFront(c, sp, col, sk) {
    // 肩の毛皮
    const s = sk.shF;
    R.poly(c, [s.x - 8, s.y + 2, s.x - 6, s.y - 6, s.x - 1, s.y - 2, s.x + 2, s.y - 8, s.x + 5, s.y - 2, s.x + 10, s.y - 5, s.x + 8, s.y + 4, s.x, s.y + 7], col('mane'), col('line'));
  }
  const ZD_SPEC = R.makeSpec({
    scale: 1.65, thigh: 23, shin: 25, torso: 31, neck: 3, headR: 11, upper: 20, fore: 19,
    legW: 14, armW: 11.5, waistW: 22, chestW: 40, shoulderOff: 4, weaponLen: 74, gripDist: 12,
    colors: ZD_COL,
    draw: { leg: zdLeg, arm: zdArm, torso: zdTorso, head: zdHead, weapon: zdSword, behind: zdBehind, front: zdFront },
  });
  const ZD_ST1 = R.merge(R.NEUTRAL, { lean: 10, head: 6, aF: 58, eF: 52, aB: 30, eB: 60, lF: 24, kF: 30, lB: -16, kB: 22, wAbs: 142, grip: 1, cape: 0, wing: 0, flap: 0, jaw: 0 });
  const ZD_ST2 = R.merge(ZD_ST1, { wing: 0.82, lean: 14, head: 8 });

  function zoddMoves(k, S) {
    const F = mkF(k);
    const SL = { up: F(22), land: F(58) };
    const DV = { lift: F(24), top: F(50), lock: F(62), go: F(84), hit: F(102) };
    return {
      combo: { // 三連斬り（3撃目はアーマーつきの叩きつけ）
        dur: F(112), trail: [F(15), F(66)], trailCol: '#ffe0c8',
        kf: [[0, {}], [F(14), { aF: 165, eF: 35, wAbs: 222, lean: -10, head: -6, lF: 12, kF: 14, lB: -24, kB: 16 }],
          [F(19), { aF: 72, eF: 8, wAbs: 62, lean: 26, head: 8, lF: 40, kF: 40, lB: -30, kB: 6, drop: 6 }, 'snap'],
          [F(26), { aF: 50, eF: 8, wAbs: 34, lean: 26, lF: 40, kF: 40, lB: -30, kB: 6, drop: 6 }],
          [F(34), { aF: 24, eF: 40, wAbs: -40, lean: 20, lF: 30, kF: 30, lB: -24, kB: 10, drop: 4 }],
          [F(39), { aF: 150, eF: 20, wAbs: 172, lean: -8, head: -6, lF: 20, kF: 16, lB: -20, kB: 10 }, 'snap'],
          [F(46), { aF: 160, eF: 30, wAbs: 200, lean: -12 }],
          [F(58), { aF: 176, eF: 42, wAbs: 238, lean: -18, head: -12, drop: -4, jaw: 1 }],
          [F(64), { aF: 82, eF: 0, wAbs: 74, lean: 36, head: 12, lF: 48, kF: 50, lB: -32, kB: 4, drop: 10, jaw: 0.6 }, 'snap'],
          [F(86), { aF: 80, eF: 0, wAbs: 72, lean: 34, head: 12, lF: 48, kF: 50, lB: -32, kB: 4, drop: 10 }], [F(112), {}]],
        hits: [{ f: [F(17), F(21)], x: [20, 150], z: [30, 190], d: 22, dmg: 9, kb: 'light', push: 3 },
          { f: [F(37), F(40)], x: [15, 140], z: [0, 200], d: 22, dmg: 10, kb: 'heavy', push: 3 },
          { f: [F(62), F(66)], x: [25, 175], z: [0, 190], d: 24, dmg: 17, kb: 'down', push: 5, lift: 6 }],
        armorW: [[F(44), F(68)]], redF: [F(44), F(60)],
        move: [[0, 0], [F(12), 1.8], [F(19), 0.3], [F(33), 1.6], [F(39), 0.2], [F(56), 2.2], [F(64), 0]],
        sfx: [[F(15), 'swingHeavy'], [F(35), 'swingHeavy'], [F(60), 'swingHeavy', { pitch: 0.75 }]],
        glint: [[F(1), 'tip'], [F(44), 'tip', '#ffb0a0']],
        onFrame(e, f) { if (f === F(64)) { BK.fx.shake(6, 12); BK.fx.dust(e.x + e.face * 160, e.y, 10); BK.audio.sfx('hitHeavy', { pitch: 0.55 }); } },
        plan: { min: 16, max: 150, dy: 16 }, rest: 34,
      },
      charge: { // 角の突進: 地面を掻き、画面の端まで一直線
        dur: F(120), armor: true,
        onStart(e) { setLane(e, 520); },
        kf: [[0, {}], [F(10), { lean: 34, head: 26, aF: -20, eF: 30, wAbs: -140, grip: 0, aB: -40, eB: 30, lF: 40, kF: 56, lB: -34, kB: 28, drop: 10 }],
          [F(16), { lean: 34, head: 28, aF: -20, eF: 30, wAbs: -140, grip: 0, aB: -40, eB: 30, lF: 70, kF: 96, lB: -34, kB: 28, drop: 6 }],
          [F(22), { lean: 36, head: 28, aF: -20, eF: 30, wAbs: -140, grip: 0, aB: -40, eB: 30, lF: 40, kF: 56, lB: -34, kB: 28, drop: 10 }],
          [F(28), { lean: 36, head: 30, aF: -20, eF: 30, wAbs: -140, grip: 0, aB: -40, eB: 30, lF: 70, kF: 96, lB: -34, kB: 28, drop: 6 }],
          [F(36), { lean: 44, head: 34, aF: -24, eF: 30, wAbs: -145, grip: 0, aB: -44, eB: 30, lF: 40, kF: 56, lB: -34, kB: 28, drop: 12 }],
          [F(88), { lean: 44, head: 34, aF: -24, eF: 30, wAbs: -145, grip: 0, aB: -44, eB: 30, lF: 40, kF: 56, lB: -34, kB: 28, drop: 12 }],
          [F(96), { lean: -10, head: -6, aF: 30, eF: 50, wAbs: 60, grip: 0, lF: 50, kF: 30, lB: -40, kB: 10, drop: 6 }], [F(120), {}]],
        hits: [{ f: [F(38), F(88)], x: [0, 100], z: [20, 170], d: 16, dmg: 20, kb: 'launch', lift: 8, push: 5 }],
        move: [[0, 0], [F(38), 10 / k], [F(88), 3], [F(94), 0]],
        runF: [F(38), F(88)],
        redF: [F(4), F(36)],
        glint: [[F(30), 'horn']],
        mark: { t: 'lane', d: 16, f: [F(4), F(88)], hot: F(38) },
        sfx: [[F(16), 'thud', { pitch: 0.8 }], [F(28), 'thud', { pitch: 0.8 }], [F(34), 'roar', { pitch: 1.5, vol: 0.5 }]],
        onFrame(e, f) {
          if (f === F(16) || f === F(28)) BK.fx.dust(e.x - e.face * 10, e.y, 6);
          if (f >= F(38) && f < F(88)) {
            if (f % 3 === 0) BK.fx.dust(e.x - e.face * 20, e.y + U.rand(-5, 5), 1);
            if (atEdge(e)) { e.vx = 0; e.mf = F(88); BK.fx.shake(6, 12); BK.audio.sfx('thud', { pitch: 0.6 }); BK.fx.dust(e.x + e.face * 30, e.y, 10); }
          }
        },
        plan: { min: 170, max: 900, dy: 8 }, rest: 30,
      },
      slam: { // 跳躍叩きつけ: 落下点に円、着地で左右に衝撃波（跳んでかわす）
        dur: SL.land + F(58), armor: true,
        kf: [[0, {}], [F(18), { drop: 16, lean: 20, aF: 170, eF: 30, wAbs: 225, lF: 60, kF: 90, lB: -20, kB: 80, wing: Math.max(0.2, S.wing) }],
          [SL.up + 2, { drop: 0, lean: -6, aF: 175, eF: 35, wAbs: 235, lF: 50, kF: 90, lB: 0, kB: 70, wing: 0.6 }],
          [SL.land - 6, { lean: -12, aF: 178, eF: 40, wAbs: 240, lF: 40, kF: 70, lB: -10, kB: 60, wing: 0.7 }],
          [SL.land, { drop: 14, lean: 36, aF: 80, eF: 0, wAbs: 70, lF: 60, kF: 80, lB: -40, kB: 10, wing: Math.max(0.1, S.wing * 0.6) }, 'snap'],
          [SL.land + F(30), { drop: 14, lean: 34, aF: 78, eF: 0, wAbs: 68, lF: 60, kF: 80, lB: -40, kB: 10 }], [SL.land + F(58), {}]],
        redF: [F(2), F(18)],
        glint: [[F(3), 'tip']],
        mark: { t: 'ring', rx: 104, ry: 36, f: [SL.up, SL.land], hot: SL.land, lock: SL.up },
        sfx: [[F(4), 'growl', { pitch: 0.6 }], [SL.up, 'jump', { pitch: 0.5 }], [SL.land - 8, 'swingHeavy', { pitch: 0.6 }]],
        onFrame(e, f) {
          const b = st(e), g = BK.game, h = g && g.hero;
          if (f === SL.up) {
            b.jx = e.x; b.jy = e.y;
            const tx = h ? h.x : e.x + e.face * 150, ty = h ? h.y : e.y;
            e.face = U.sign(tx - e.x || e.face);
            b.tx = U.clamp(tx, BK.cam.x + 40, BK.cam.x + BK.W - 40); b.ty = ty;
            b.lx = U.clamp(b.tx - e.face * 78, BK.cam.x + 50, BK.cam.x + BK.W - 50); b.ly = ty;
          }
          if (f > SL.up && f <= SL.land) {
            const t = (f - SL.up) / (SL.land - SL.up);
            e.x = U.lerp(b.jx, b.lx, t); e.y = U.lerp(b.jy, b.ly, t);
            e.z = Math.max(0, 4 * 150 * t * (1 - t)); e.vx = 0; e.vy = 0; e.vz = 0;
            if (f === SL.land) {
              e.z = 0;
              const hitList = radialHit(e, b.tx, b.ty, 104, 36, 80, { dmg: 20, kb: 'down', push: 5, lift: 6 });
              BK.fx.shake(10, 18); BK.audio.sfx('cannon', { pitch: 0.8 }); BK.fx.ring(b.tx, b.ty, 2, 140, '#ffc890', 18);
              BK.fx.dust(b.tx, b.ty, 12);
              // 叩きつけを受けた者には衝撃波を重ねない
              shockwave(e, b.tx + 40, b.ty, 1, hitList); shockwave(e, b.tx - 40, b.ty, -1, hitList);
            }
          }
        },
        onEnd(e) { e.z = Math.max(0, e.z); },
        plan: { min: 0, max: 330, dy: 70 }, rest: 34,
      },
      dive: { // 急降下（第2形態）: 飛び上がって滞空 → 落下点を決めて斜めに急降下
        dur: DV.hit + F(46),
        kf: [[0, {}], [F(16), { drop: 16, lean: 22, wing: 1, lF: 60, kF: 90, lB: -20, kB: 80, aF: 60, wAbs: 110 }],
          [DV.lift, { drop: -4, lean: 4, wing: 1, lF: 30, kF: 60, lB: -10, kB: 50 }],
          [DV.lock, { lean: 8, wing: 1, aF: 150, eF: 30, wAbs: 205, lF: 30, kF: 70, lB: -10, kB: 60 }],
          [DV.go - 4, { lean: 4, head: -10, wing: 1, aF: 170, eF: 40, wAbs: 230, lF: 30, kF: 70, lB: -10, kB: 60, jaw: 1 }],
          [DV.go + 2, { lean: 52, head: 24, wing: 0.5, aF: 100, eF: 0, wAbs: 110, lF: 10, kF: 20, lB: -40, kB: 20 }, 'snap'],
          [DV.hit, { lean: 52, head: 24, wing: 0.5, aF: 100, eF: 0, wAbs: 110, lF: 10, kF: 20, lB: -40, kB: 20 }],
          [DV.hit + 3, { lean: 30, drop: 14, wing: 0.9, aF: 70, eF: 0, wAbs: 50, lF: 60, kF: 80, lB: -40, kB: 20 }, 'snap'],
          [DV.hit + F(30), { lean: 28, drop: 14, wing: 0.9, aF: 70, eF: 0, wAbs: 50, lF: 60, kF: 80, lB: -40, kB: 20 }], [DV.hit + F(46), {}]],
        hits: [{ f: [DV.go, DV.hit], x: [-20, 110], z: [-10, 170], d: 22, dmg: 18, kb: 'down', push: 5 }],
        armorW: [[0, DV.lift + 2], [DV.go - 6, DV.hit + 2]],
        redF: [F(2), F(16)],
        hoverF: [DV.lift, DV.go - 4],
        glint: [[DV.lock, 'eye', '#ff6040']],
        mark: { t: 'ring', rx: 74, ry: 30, f: [DV.top, DV.hit], hot: DV.hit, lock: DV.lock },
        sfx: [[F(8), 'growl', { pitch: 0.8 }], [DV.lift, 'swingHeavy', { pitch: 0.5 }], [DV.lock, 'roar', { pitch: 1.8, vol: 0.5 }], [DV.go, 'swingHeavy', { pitch: 0.7 }]],
        onFrame(e, f) {
          const b = st(e), g = BK.game, h = g && g.hero;
          if (f === DV.lift) {
            b.jx = e.x; b.jy = e.y;
            const side = h ? (h.x - BK.cam.x > BK.W / 2 ? -1 : 1) : -e.face;
            b.hx = U.clamp((h ? h.x : e.x) + side * 150, BK.cam.x + 60, BK.cam.x + BK.W - 60);
            b.tx = h ? h.x : e.x; b.ty = h ? h.y : e.y;
          }
          if (f > DV.lift && f < DV.go) {
            // 上昇 → 滞空（照準は主人公を追い、DV.lock で固定）
            const t = Math.min(1, (f - DV.lift) / (DV.top - DV.lift));
            e.x = U.lerp(b.jx, b.hx, U.ease.out(t)); e.z = 96 * U.ease.out(t) + Math.sin(f * 0.25) * 4;
            e.vx = 0; e.vy = 0; e.vz = 0;
            if (h && f < DV.lock) { b.tx = U.approach(b.tx, h.x, 3); b.ty = U.approach(b.ty, h.y, 2); e.y = U.approach(e.y, h.y, 1); }
            e.face = U.sign(b.tx - e.x || e.face);
            if (f % 10 === 0) BK.fx.dust(e.x, e.y, 2, 'rgba(120,100,90,0.3)');
            if (f === DV.go - 1) { b.dx0 = e.x; b.dz0 = e.z; b.dy0 = e.y; }
          }
          if (f >= DV.go && f <= DV.hit) {
            const t = (f - DV.go + 1) / (DV.hit - DV.go + 1);
            e.x = U.lerp(b.dx0, b.tx - e.face * 20, t); e.y = U.lerp(b.dy0, b.ty, t); e.z = Math.max(0, b.dz0 * (1 - t));
            e.vx = 0; e.vy = 0; e.vz = 0;
            if (f % 2 === 0) BK.fx.add({ type: 'smoke', x: e.x - e.face * 20, y: e.y, z: e.z + 80, vz: 0.3, life: 14, size: 10, col: 'rgba(60,30,30,0.35)' });
            if (f === DV.hit) {
              e.z = 0;
              if (!e.moveHit) radialHit(e, e.x + e.face * 20, e.y, 74, 30, 60, { dmg: 16, kb: 'down', push: 5, lift: 6 });
              BK.fx.shake(8, 14); BK.audio.sfx('hitHeavy', { pitch: 0.5 }); BK.fx.ring(e.x, e.y, 2, 110, '#ffb080', 16); BK.fx.dust(e.x, e.y, 12);
            }
          }
        },
        onEnd(e) { if (e.z > 0 && !e.dead) e.vz = Math.min(e.vz, -2); },
        plan: { min: 60, max: 900, dy: 90 }, rest: 26,
      },
      phase: { // 形態変化: 翼を広げて咆哮（周囲を吹き飛ばす）
        dur: F(110), invul: [0, F(110)],
        kf: [[0, { wing: 0 }], [F(20), { lean: 16, head: 20, drop: 10, aF: 20, eF: 60, aB: 10, eB: 60, wAbs: 100, grip: 0, wing: 0.25 }],
          [F(34), { lean: -18, head: -30, drop: -2, aF: 110, eF: 30, aB: -110, eB: 30, wAbs: 190, grip: 0, jaw: 1, wing: 1 }, 'snap'],
          [F(90), { lean: -16, head: -26, drop: -2, aF: 108, eF: 30, aB: -108, eB: 30, wAbs: 188, grip: 0, jaw: 1, wing: 1 }], [F(110), {}]],
        sfx: [[F(4), 'growl', { pitch: 0.5 }]],
        onFrame(e, f) {
          if (f === F(34)) {
            BK.audio.sfx('roar'); BK.audio.sfx('roar', { pitch: 0.7 });
            BK.fx.shake(9, 50); BK.fx.flash('#ff3a18', 8);
            BK.fx.ring(e.x, e.y, 40, 170, '#ffb070', 24); BK.fx.ring(e.x, e.y, 120, 120, '#ff6040', 20);
            radialHit(e, e.x, e.y, 170, 70, 200, { dmg: 4, kb: 'down', push: 7, lift: 4, fx: 'none' });
          }
          if (f > F(34) && f < F(90) && f % 3 === 0) BK.fx.add({ type: 'line', x: e.x + U.rand(-30, 30), y: e.y, z: U.rand(80, 170), vx: U.rand(-7, 7), vz: U.rand(-2, 3), life: 12, col: '#ffd0a0', size: 1.5, drag: 0.9 });
        },
      },
      breaker: { // 振り払い: 翼（腕）で薙ぎ払う全周攻撃
        dur: F(50), armor: true, invul: [0, 3],
        kf: [[0, {}], [F(13), { lean: -14, head: -18, aF: 120, eF: 40, aB: -120, eB: 40, wAbs: 200, grip: 0, wing: 0.7, jaw: 1, drop: 4 }],
          [F(17), { lean: 18, head: 10, aF: 60, eF: 20, aB: 60, eB: 20, wAbs: 80, grip: 0, wing: 1, jaw: 1, flap: 1 }, 'snap'], [F(30), { wing: 0.9, flap: 0.5 }], [F(50), {}]],
        redF: [0, F(16)],
        mark: { t: 'self', rx: 118, ry: 40, f: [0, F(17)], hot: F(16), lock: 0 },
        sfx: [[F(2), 'growl', { pitch: 0.7 }], [F(16), 'swingHeavy', { pitch: 0.5 }]],
        onFrame(e, f) {
          if (f === F(16)) {
            radialHit(e, e.x, e.y, 118, 40, 190, { dmg: 8, kb: 'down', push: 6.5, lift: 5 });
            BK.fx.ring(e.x, e.y, 20, 130, '#e8d0b0', 16); BK.fx.shake(4, 10);
            for (let i = 0; i < 8; i++) BK.fx.add({ type: 'smoke', x: e.x, y: e.y + U.rand(-10, 10), z: U.rand(20, 120), vx: U.rand(-5, 5), vz: U.rand(-0.5, 1), life: 20, size: U.rand(8, 12), col: 'rgba(120,100,90,0.35)', drag: 0.9 });
          }
        },
      },
    };
  }
  /** 地を這う衝撃波（跳んでかわす） */
  function shockwave(e, x, y, dir, skip) {
    const g = BK.game;
    if (!g) return;
    const p = g.addProjectile(new BK.Projectile({
      x, y, z: 12, vx: dir * 6.5, w: 30, h: 24, depth: 20, team: 'enemy', owner: e, dmg: 10, kb: 'down', push: 4, lift: 4, life: 44, pierce: 3, noShadow: true, stop: 4,
      tick(p) { if (p.t % 2 === 0) BK.fx.add({ type: 'smoke', x: p.x, y: p.y + U.rand(-8, 8), z: 4, vz: U.rand(1, 2.2), life: 18, size: U.rand(6, 10), col: 'rgba(150,100,80,0.45)' }); },
      drawFn(c, sx, sy, p) {
        const gy = sy + p.z, k = Math.min(1, p.life / 10), f = p.face;
        c.save(); c.globalAlpha = 0.85 * k;
        c.fillStyle = '#6a4a3a';
        c.beginPath(); c.moveTo(sx - f * 18, gy); c.lineTo(sx - f * 8, gy - 14); c.lineTo(sx - f * 2, gy - 6); c.lineTo(sx + f * 6, gy - 24); c.lineTo(sx + f * 16, gy); c.closePath(); c.fill();
        c.fillStyle = 'rgba(255,200,140,0.7)';
        c.beginPath(); c.moveTo(sx - f * 4, gy); c.lineTo(sx + f * 5, gy - 18); c.lineTo(sx + f * 12, gy); c.closePath(); c.fill();
        c.restore();
      },
    }));
    if (skip) for (const t of skip) p.hit.add(t);
  }
  const ZD_M1 = zoddMoves(1, ZD_ST1), ZD_M2 = zoddMoves(0.8, ZD_ST2);
  const ZD_DIE = [[0, { lean: -20, head: -32, jaw: 1, wing: 1, aF: 120, eF: 30, aB: -120, eB: 30, wAbs: 190, grip: 0 }],
    [36, { lean: -14, head: -26, jaw: 1, wing: 1, aF: 110, eF: 30, aB: -110, wAbs: 180, grip: 0 }],
    [66, { lean: 30, head: 34, jaw: 0.4, wing: 0.35, lF: 92, kF: 150, lB: -8, kB: 110, drop: 26, aF: 70, eF: 10, aB: 40, eB: 30, wAbs: 5, grip: 1 }, 'in']];

  function zoddPose(e, b) {
    const S = b.phase === 2 ? ZD_ST2 : ZD_ST1;
    let p;
    if (e.state === 'dying') p = samp(ZD_DIE, Math.min(e.st, 70), S);
    else if (e.move) {
      const m = e.move;
      p = samp(m.kf, e.mf, S);
      if (m.runF && e.mf >= m.runF[0] && e.mf < m.runF[1]) {
        p = R.run(p, e.mf * 0.42, { stride: 42, lean: 0, lockArms: true });
        p.lean = 42; p.drop = (p.drop || 0) + 4;
      }
      if (m.hoverF && e.mf >= m.hoverF[0] && e.mf < m.hoverF[1]) { p = Object.assign({}, p); p.flap = Math.sin(e.mf * 0.5); p.wing = 0.85 + 0.15 * Math.sin(e.mf * 0.5); }
    } else if (b.dropping || e.state === 'air') {
      p = R.merge(S, { wing: 1, flap: Math.sin(b.t * 0.45) * 0.8, lF: 40, kF: 60, lB: -10, kB: 50, aF: 140, eF: 30, wAbs: 200, lean: 0 });
    } else if (b.land > 0) {
      const k = b.land / 30;
      p = R.merge(S, { drop: 18 * k, lean: 26 * k + S.lean, lF: 24 + 40 * k, kF: 30 + 60 * k, lB: -16 - 10 * k, kB: 22 + 50 * k, wing: Math.max(S.wing, k) });
    } else if (b.intro > 0) {
      const t = b.introMax - b.intro;
      p = samp(ZD_INTRO, t, S);
    } else {
      const rp = e.reactionPose(S);
      if (rp) p = rp;
      else if (e.state === 'walk') p = R.walk(S, e.walkPh, { stride: 22, arm: 6, lockArms: true });
      else { p = R.idle(S, b.t); if (b.phase === 2) { p.flap = Math.sin(b.t * 0.08) * 0.3; } }
    }
    if (b.phase === 2) { p = Object.assign({}, p); p.rage = true; }
    return p;
  }
  const ZD_INTRO = [[0, { lean: 20, head: 20, drop: 8, wing: 0.9 }], [20, { lean: -18, head: -30, drop: -2, aF: 110, eF: 30, aB: -110, eB: 30, wAbs: 190, grip: 0, jaw: 1, wing: 1 }, 'snap'],
    [56, { lean: -16, head: -26, aF: 108, eF: 30, aB: -108, eB: 30, wAbs: 188, grip: 0, jaw: 1, wing: 1 }], [80, { wing: 0 }]];

  function drawZodd(c, e) {
    const b = st(e), P = palOf(e, b, ZD_PALS), p = zoddPose(e, b), white = !!P._white;
    let sx = BK.sx(e.x), sy = BK.sy(e.y, e.z) + dyingSink(e);
    if (e.state === 'dying' && e.st < 64) sx += Math.sin(e.st * 1.7) * 1.6;
    const sc = ZD_SPEC.scale;
    c.save();
    dyingClip(c, e, sx, sy, e.def.dieH);
    c.translate(sx, sy); c.scale(e.face * sc, sc);
    const sk = R.draw(c, p, ZD_SPEC, { t: b.t, colors: P, tint: white ? '#ffffff' : null });
    c.restore();
    e.spec = ZD_SPEC; e.updateTrail(sk);
    if (e.state !== 'dying') e.drawTrail(c);
    if (e.move && e.move.glint) {
      const f = e.face, hc = sk.headC;
      drawGlints(c, e, {
        tip: [sx + sk.tip.x * sc * f, sy + sk.tip.y * sc],
        eye: [sx + (hc.x + 5) * sc * f, sy + (hc.y - 3) * sc],
        horn: [sx + (hc.x + 2) * sc * f, sy + (hc.y - 24) * sc],
      });
    }
  }

  function zoddPick(e, b, adx) {
    const M = b.mv, p2 = b.phase === 2;
    return pickW(b, [
      adx < 160 ? [4, M.combo] : [0.6, M.combo],
      adx > 170 ? [p2 ? 2.5 : 3.5, M.charge] : null,
      adx > 90 ? [2.2, M.slam] : [0.6, M.slam],
      p2 ? [adx > 80 ? 3.2 : 1.6, M.dive] : null,
    ]);
  }

  BK.registerEnemy({
    id: 'zodd', name: '不死のゾッド', title: '戦いに飢えた使徒', boss: true,
    hp: 650, w: 60, h: 172, weight: 4, speed: 1.45, speedY: 1.0, score: 15000, bossBonus: 50000,
    poise: 85, shadowR: 46, bloodCol: '#6a0a0a', drop: null, dieSfx: 'roar', diePitch: 0.6,
    dieW: 120, dieH: 200,
    moves: ZD_M1, moves2: ZD_M2,
    ai: {
      speed: 1.45, speedY: 1.0, rage: 1.25, pref: [95, 140], margin: 50, breakN: 7, breakN2: 6,
      pick: zoddPick,
      onDropLand(e, b) {
        b.land = 30; b.intro = b.introMax = 80;
        BK.fx.shake(9, 20); BK.audio.sfx('cannon', { pitch: 0.7 }); BK.fx.ring(e.x, e.y, 2, 150, '#ffc890', 20); BK.fx.dust(e.x, e.y, 14);
      },
      tick(e, b) {
        // 登場の咆哮
        if (b.intro === b.introMax - 20 && b.introMax > 1 && !e.move) { BK.audio.sfx('roar'); BK.fx.shake(7, 30); BK.fx.ring(e.x, e.y, 60, 120, '#ffb070', 20); }
      },
    },
    draw: drawZodd, update: bossUpdate, think: bossThink, onDie: onBossDie,
    onSpawn(e) {
      const b = st(e);
      e.downTime = 44; e.getupTime = 22; e.getupInvul = 20; e.trailCol = '#ffe0c8';
      b.cd = 20;
      // 翼を広げて空から降り立つ
      e.x = U.clamp(e.x, BK.cam.x + 120, BK.cam.x + BK.W - 90);
      e.z = 380; e.vz = -2; e.state = 'air'; b.dropping = true; e.intangible = true;
      addFloorPainter(e);
    },
  });
})(window.BK);

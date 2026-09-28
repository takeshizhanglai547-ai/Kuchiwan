'use strict';
/* =====================================================================
 *  combat.js ── アクター基底クラス・技(Move)の実行・当たり判定・飛び道具
 *
 *  ● 技 (Move) 定義
 *   {
 *     dur: 28,                      // 全体フレーム
 *     kf: [[0,{pose}],[6,{pose},'in'],...],  // rig のキーフレーム
 *     hits: [ { f:[8,11], x:[10,70], z:[20,90], d:16, dmg:10, kb:'light',
 *               push:3, lift:5, stop:5, sfx:'slash', fx:'blood'|'spark'|'none',
 *               multi: 6  /* 同じ技で multi フレームごとに再ヒット可 *\/ } ],
 *     move: [[0,0],[6,4],[12,0]],   // 前進速度カーブ [frame, vx(向き基準)]
 *     cancel: 16,                   // この F 以降はコンボ入力で次の技へ移行可
 *     invul: [0,20],                // 無敵フレーム
 *     armor: true,                  // スーパーアーマー（のけぞらない）
 *     trail: [6,12],                // 斬撃軌跡を出すフレーム
 *     trailCol: '#ffffff',
 *     sfx: [[6,'swing']],           // フレームごとの効果音
 *     onFrame(actor, f) {},         // 任意処理（飛び道具発射など）
 *     onHit(actor, target, hit) {}, // ヒット時の任意処理
 *     onEnd(actor) {},
 *     air: true,                    // 空中技（着地で終了）
 *     vz: 0, grav: true,            // 開始時の縦速度
 *   }
 *
 *  ● ノックバック種類 kb
 *   'light'  短いのけぞり        'heavy' 長いのけぞり
 *   'down'   吹っ飛びダウン      'launch' 真上に浮かせる（追撃可）
 *   'spin'   きりもみ吹っ飛び（ダウン、周囲を巻き込む）
 * ===================================================================== */
(function (BK) {
  const U = BK.U;
  const C = BK.combat = { actors: [], projectiles: [], tokens: 0, maxTokens: 2 };

  let _uid = 1;
  class Actor {
    constructor(o) {
      this.uid = _uid++;
      this.x = 0; this.y = 60; this.z = 0;
      this.vx = 0; this.vy = 0; this.vz = 0;
      this.face = 1;
      this.w = 26; this.h = 88;       // 喰らい判定 (幅, 高さ)
      this.team = 'enemy';
      this.hp = 100; this.maxHp = 100;
      this.state = 'idle'; this.st = 0;
      this.move = null; this.mf = 0; this.moveHit = false; this.hitIds = null;
      this.invul = 0; this.flash = 0; this.hitstun = 0;
      this.weight = 1;                // 吹っ飛びにくさ
      this.armor = false;             // 常時スーパーアーマー
      this.dead = false; this.remove = false;
      this.juggle = 0;
      this.pose = null;
      this.trail = []; this.trailOn = false;
      this.animT = 0;
      this.grabbedBy = null; this.grabbing = null;
      this.lastHitBy = null;
      this.shadowR = 16;
      this.hitCount = 0;               // 連続被弾数（ダウン判定用）
      this.downT = 0;
      this.scoreValue = 100;
      Object.assign(this, o || {});
    }
    get onGround() { return this.z <= 0 && this.vz <= 0; }
    get alive() { return !this.dead && this.hp > 0; }
    /** 喰らい判定の当たりやすさ */
    get hurtable() { return !this.dead && this.invul <= 0 && this.state !== 'down' && this.state !== 'getup' && !this.intangible; }

    startMove(def, opt) {
      this.move = def; this.mf = 0; this.moveHit = false; this.hitIds = new Map();
      this.state = 'move'; this.trail.length = 0; this.trailOn = false;
      if (def.vz != null) { this.vz = def.vz; }
      if (def.onStart) def.onStart(this, opt);
    }
    endMove() {
      const m = this.move;
      this.move = null; this.trailOn = false;
      if (m && m.onEnd) m.onEnd(this);
      if (this.state === 'move') this.state = this.z > 0 ? 'air' : 'idle';
    }
    /** 技の1フレーム処理（ポーズ・移動・判定・効果音） */
    updateMove() {
      const m = this.move, f = this.mf;
      if (m.move) {
        const vx = sampleCurve(m.move, f);
        if (vx != null) this.vx = vx * this.face * (this.moveSpeedMul || 1);
      }
      if (m.movY) this.vy = sampleCurve(m.movY, f) || 0;
      if (m.sfx) for (const s of m.sfx) if (s[0] === f) BK.audio.sfx(s[1], s[2]);
      if (m.onFrame) m.onFrame(this, f);
      if (!this.move) return; // onFrame で中断された
      this.trailOn = !!(m.trail && f >= m.trail[0] && f <= m.trail[1]);
      if (m.invul && f >= m.invul[0] && f <= m.invul[1]) this.invul = Math.max(this.invul, 1);
      this.mf++;
      if (m.air) {
        if (this.z <= 0 && this.mf > 2 && this.vz <= 0) { this.endMove(); this.land && this.land(); return; }
      }
      if (this.mf >= m.dur) this.endMove();
    }
    /** 現在の攻撃判定をワールド座標で列挙 */
    activeHits() {
      const m = this.move;
      if (!m || !m.hits) return null;
      const f = this.mf - 1; // updateMove で ++ 済み
      let out = null;
      for (let i = 0; i < m.hits.length; i++) {
        const h = m.hits[i];
        if (f < h.f[0] || f > h.f[1]) continue;
        const x0 = this.x + (this.face > 0 ? h.x[0] : -h.x[1]);
        const x1 = this.x + (this.face > 0 ? h.x[1] : -h.x[0]);
        (out || (out = [])).push({ h, i, x0, x1, z0: this.z + h.z[0], z1: this.z + h.z[1], y: this.y, d: h.d || 16 });
      }
      return out;
    }
    physics() {
      // 重力
      if (this.z > 0 || this.vz !== 0) {
        this.z += this.vz;
        this.vz -= BK.GRAV * (this.gravMul || 1);
        if (this.z <= 0) {
          this.z = 0;
          const impact = this.vz;
          this.vz = 0;
          this.onLand(impact);
        }
      }
      this.x += this.vx;
      this.y += this.vy;
      if (this.z <= 0 && this.state !== 'fall' && !(this.move && this.move.keepVel)) {
        this.vx *= this.friction || 0.78;
        this.vy *= this.friction || 0.78;
        if (Math.abs(this.vx) < 0.05) this.vx = 0;
        if (Math.abs(this.vy) < 0.05) this.vy = 0;
      }
      this.y = U.clamp(this.y, 0, BK.DEPTH);
    }
    onLand(impact) {
      if (this.state === 'fall') {
        if (this.dead || this.hp <= 0) {
          if (impact < -5 && !this._bounced) { this._bounced = true; this.vz = 3; this.z = 0.1; BK.fx.dust(this.x, this.y, 6); BK.audio.sfx('thud'); return; }
          this.state = 'dead'; this.st = 0; this.vx = 0;
          BK.fx.dust(this.x, this.y, 8);
          return;
        }
        if (impact < -6 && !this._bounced) { // 1回バウンド
          this._bounced = true; this.vz = 2.6; this.z = 0.1; this.vx *= 0.5;
          BK.fx.dust(this.x, this.y, 6); BK.audio.sfx('thud', { vol: 0.7 });
          return;
        }
        this.state = 'down'; this.st = 0; this.vx = 0; this._bounced = false; this.juggle = 0;
        BK.fx.dust(this.x, this.y, 8); BK.audio.sfx('thud', { vol: 0.8 });
        if (this.thrownBy) this.thrownBy = null;
      } else if (this.move && this.move.air) {
        this.endMove();
        if (this.land) this.land();
      } else if (this.land) this.land();
    }

    /**
     * 被弾処理。戻り値 true でヒット成立
     * src: 攻撃側アクター（飛び道具なら発射者）
     * h: ヒット定義 {dmg, kb, push, lift, stop, ...}
     * dir: 吹っ飛ぶ向き (+1/-1)
     */
    takeHit(src, h, dir) {
      if (!this.hurtable) return false;
      if (this.onBeforeHit && this.onBeforeHit(src, h, dir) === false) return false;
      let dmg = h.dmg * (src && src.dmgMul || 1);
      if (this.dmgTakenMul) dmg *= this.dmgTakenMul;
      dmg = Math.max(1, Math.round(dmg));
      this.hp -= dmg;
      this.flash = 6;
      this.lastHitBy = src;
      this.hitCount++;
      this._lastHitF = BK.frame;
      if (this.onDamaged) this.onDamaged(dmg, src, h);
      if (src && src.onDealDamage) src.onDealDamage(dmg, this, h);
      // 掴み中なら解除
      if (this.grabbing) { const g = this.grabbing; this.grabbing = null; g.grabbedBy = null; if (g.state === 'grabbed') { g.state = 'idle'; } }
      if (this.grabbedBy && !h.keepGrab) { const g = this.grabbedBy; this.grabbedBy = null; if (g.grabbing === this) g.grabbing = null; }

      const kb = h.kb || 'light';
      const heavyKb = kb === 'down' || kb === 'launch' || kb === 'spin';
      if (this.hp <= 0) {
        this.hp = 0;
        this.die(src, h, dir);
        return true;
      }
      // 掴まれたまま殴られている（膝蹴りなど）: 掴み状態を維持
      if (this.grabbedBy && h.keepGrab) return true;
      const armored = this.armor || (this.move && this.move.armor) || this.superArmor > 0;
      if (armored && !(h.breakArmor && heavyKb)) {
        // スーパーアーマー: 仰け反らない
        return true;
      }
      if (this.move) { this.endMove(); this.state = 'hurt'; }
      if (this.releaseToken) this.releaseToken();
      const w = this.weight || 1;
      const airborne = this.z > 1 || this.state === 'fall';
      if (heavyKb || airborne || this.hitCount >= (this.downAfter || 99)) {
        this.state = 'fall'; this.st = 0; this._bounced = false;
        const lift = (h.lift != null ? h.lift : (kb === 'launch' ? 8 : kb === 'spin' ? 6 : 5)) / Math.sqrt(w);
        this.juggle++;
        this.vz = Math.max(this.vz, airborne ? Math.max(2.5, lift * (1 - this.juggle * 0.18)) : lift);
        if (this.z <= 0) this.z = 0.5;
        this.vx = dir * (h.push != null ? h.push : (kb === 'launch' ? 1.2 : 4.2)) / w;
        this.spinning = kb === 'spin';
        this.hitCount = 0;
      } else {
        this.state = 'hurt'; this.st = 0;
        this.hitstun = h.stun || (kb === 'heavy' ? 22 : 13);
        this.vx = dir * (h.push != null ? h.push : (kb === 'heavy' ? 4 : 2.2)) / w;
      }
      return true;
    }
    die(src, h, dir) {
      this.dead = true;
      if (this.move) this.endMove();
      if (this.releaseToken) this.releaseToken();
      this.state = 'fall'; this.st = 0; this._bounced = false;
      this.vz = Math.max(this.vz, 6.5); if (this.z <= 0) this.z = 0.5;
      this.vx = dir * 4.5 / Math.sqrt(this.weight || 1);
      if (this.grabbedBy) { const g = this.grabbedBy; this.grabbedBy = null; if (g.grabbing === this) g.grabbing = null; }
      if (this.grabbing) { const g = this.grabbing; this.grabbing = null; g.grabbedBy = null; if (g.state === 'grabbed') g.state = 'idle'; }
      if (this.onDie) this.onDie(src, h);
    }
    /** のけぞり・ダウン・起き上がりの共通処理。処理したら true */
    updateReactions() {
      switch (this.state) {
        case 'hurt':
          if (--this.hitstun <= 0) { this.state = 'idle'; this.hitCount = Math.max(0, this.hitCount - 1); }
          return true;
        case 'fall':
          return true;
        case 'down':
          this.st++;
          if (this.st > (this.downTime || 38)) { this.state = 'getup'; this.st = 0; }
          return true;
        case 'getup':
          this.st++;
          if (this.st > (this.getupTime || 18)) { this.state = 'idle'; this.invul = Math.max(this.invul, this.getupInvul || 20); this.hitCount = 0; }
          return true;
        case 'dead':
          this.st++;
          if (this.st > (this.deadTime || 50)) this.remove = true;
          return true;
      }
      return false;
    }
    /** 汎用リアクションポーズ（被弾・ダウンなど） */
    reactionPose(stance) {
      const R = BK.rig;
      switch (this.state) {
        case 'hurt': {
          const k = Math.min(1, this.hitstun / 10);
          return R.merge(stance, { lean: -18 * k, head: -20 * k, aF: -30 * k + 10, eF: 40, aB: -50 * k, eB: 30, lF: 12, kF: 16, lB: -18, kB: 10, cape: 0.8 });
        }
        case 'fall': {
          if (this.spinning) return R.merge(stance, { rot: -(this.st * 24) % 360, lean: -10, aF: 120, aB: -120, lF: 30, lB: -30, kF: 30, kB: 30, cape: 1.2 });
          const up = this.vz > 0;
          return R.merge(stance, { rot: up ? -35 : -65, lift: 4, lean: -20, head: -25, aF: 150, eF: 20, aB: -150, eB: 20, lF: 40, kF: 40, lB: 10, kB: 50, cape: 1.2 });
        }
        case 'dead':
        case 'down':
          return R.merge(stance, { rot: -90, lift: 0, hx: -4, lean: -8, head: -10, aF: 170, eF: 0, aB: 180, eB: 10, lF: 5, kF: 5, lB: -5, kB: 5, drop: 0, cape: 0.1 });
        case 'getup': {
          const t = this.st / (this.getupTime || 18);
          return R.merge(stance, { rot: -90 * (1 - t), lean: 30 * (1 - t), lF: 60 * (1 - t) + 10, kF: 90 * (1 - t) + 8, lB: 20, kB: 60 * (1 - t) + 8, aF: 20, aB: -40 });
        }
      }
      return null;
    }
    updateTrail(sk) {
      // 描画時に呼ばれ、武器先端の軌跡を記録
      if (!this.trailOn || !sk) { if (this.trail.length) this.trail.length = 0; return; }
      if (this._trailF === BK.frame) return;
      this._trailF = BK.frame;
      const sc = this.spec.scale || 1, f = this.face;
      const tx = this.x + sk.tip.x * sc * f, ty = BK.FLOOR_TOP + this.y - this.z + sk.tip.y * sc;
      const bx = this.x + (sk.hdF.x + (sk.tip.x - sk.hdF.x) * 0.35) * sc * f, by = BK.FLOOR_TOP + this.y - this.z + (sk.hdF.y + (sk.tip.y - sk.hdF.y) * 0.35) * sc;
      this.trail.push({ tx, ty, bx, by, f: BK.frame });
      if (this.trail.length > 7) this.trail.shift();
    }
    drawTrail(c) {
      const tr = this.trail;
      if (tr.length < 2) return;
      const now = BK.frame;
      const col = (this.move && this.move.trailCol) || this.trailCol || '#ffffff';
      const ox = -BK.cam.x + BK.cam.sx, oy = BK.cam.sy;
      c.save();
      for (let i = 1; i < tr.length; i++) {
        const a = tr[i - 1], b = tr[i];
        const age = now - b.f;
        const k = (i / tr.length) * Math.max(0, 1 - age / 8);
        if (k <= 0) continue;
        c.globalAlpha = k * 0.85;
        c.fillStyle = col;
        c.beginPath();
        c.moveTo(a.tx + ox, a.ty + oy); c.lineTo(b.tx + ox, b.ty + oy);
        c.lineTo(b.bx + ox, b.by + oy); c.lineTo(a.bx + ox, a.by + oy);
        c.closePath(); c.fill();
      }
      c.restore();
    }
    drawShadow(c) {
      const sx = BK.sx(this.x), sy = BK.sy(this.y, 0);
      const k = Math.max(0.35, 1 - this.z / 160);
      c.fillStyle = 'rgba(0,0,0,0.42)';
      c.beginPath(); c.ellipse(sx, sy, this.shadowR * k, this.shadowR * 0.32 * k, 0, 0, Math.PI * 2); c.fill();
    }
    /** rig 使用アクターの標準描画 */
    drawRig(c, pose, opt) {
      const sx = BK.sx(this.x), sy = BK.sy(this.y, this.z);
      const sc = this.spec.scale || 1;
      c.save();
      c.translate(Math.round(sx * 2) / 2, Math.round(sy * 2) / 2);
      c.scale(this.face * sc, sc);
      let o = opt || {};
      if (this.flash > 0 && (this.flash & 2)) o = Object.assign({}, o, { tint: this.flashTint || '#ffffff' });
      o.t = this.animT;
      const sk = BK.rig.draw(c, pose, this.spec, o);
      c.restore();
      this.updateTrail(sk);
      this.sk = sk;
      return sk;
    }
  }
  BK.Actor = Actor;

  function sampleCurve(curve, f) {
    if (f < curve[0][0]) return null;
    for (let i = curve.length - 1; i >= 0; i--) if (f >= curve[i][0]) return curve[i][1];
    return null;
  }
  C.sampleCurve = sampleCurve;

  // ------------------------------------------------------------- hit test
  /** 攻撃判定 box と喰らい側アクターの重なり判定 */
  C.overlap = function (hb, t) {
    const hw = t.w / 2;
    if (hb.x1 < t.x - hw || hb.x0 > t.x + hw) return false;
    if (Math.abs(hb.y - t.y) > hb.d) return false;
    const tz0 = t.z + (t.hurtZ0 || 0), tz1 = t.z + (t.hurtH || t.h);
    if (hb.z1 < tz0 || hb.z0 > tz1) return false;
    return true;
  };

  /** 全アクターの攻撃判定を解決 */
  C.resolve = function (actors) {
    for (const a of actors) {
      if (a.dead || !a.move || a.state !== 'move') continue;
      const hbs = a.activeHits();
      if (!hbs) continue;
      for (const hb of hbs) {
        for (const t of actors) {
          if (t === a || t.team === a.team || !t.hurtable) continue;
          if (t.grabbedBy === a && !hb.h.grabHit) continue;
          const key = t.uid * 16 + hb.i;
          const lastF = a.hitIds.get(key);
          if (lastF != null && (!hb.h.multi || BK.frame - lastF < hb.h.multi)) continue;
          if (!C.overlap(hb, t)) continue;
          const dir = hb.h.dirAway ? U.sign(t.x - a.x) : a.face;
          if (t.takeHit(a, hb.h, dir)) {
            a.hitIds.set(key, BK.frame);
            a.moveHit = true;
            C.hitFx(a, t, hb.h, (hb.x0 + hb.x1) / 2, dir);
            if (a.move && a.move.onHit) a.move.onHit(a, t, hb.h);
          }
        }
      }
    }
    // 投げられた敵が他の敵に当たる
    for (const a of actors) {
      if (!a.thrownBy || a.state !== 'fall') continue;
      for (const t of actors) {
        if (t === a || t.team !== a.team || !t.hurtable || t.thrownBy) continue;
        if (Math.abs(t.x - a.x) < (t.w + a.w) / 2 && Math.abs(t.y - a.y) < 18 && a.z < t.h) {
          const h = { dmg: 14, kb: 'down', push: 4, stop: 4, sfx: 'hitHeavy' };
          if (t.takeHit(a.thrownBy, h, U.sign(a.vx || 1))) C.hitFx(a.thrownBy, t, h, t.x, U.sign(a.vx || 1));
        }
      }
    }
  };

  /** ヒット時の演出（ヒットストップ・火花・効果音・揺れ） */
  C.hitFx = function (a, t, h, hx, dir) {
    const power = h.dmg >= 24 ? 2 : h.dmg >= 12 ? 1 : 0.4;
    const stop = h.stop != null ? h.stop : (power >= 2 ? 7 : power >= 1 ? 5 : 3);
    BK.fx.stop(stop);
    const zMid = t.z + (t.h || 80) * 0.6;
    const x = U.clamp(hx, t.x - t.w / 2, t.x + t.w / 2);
    if (h.fx !== 'none') {
      if (h.fx === 'spark' || t.metal || t.isProp) {
        for (let i = 0; i < 6; i++) BK.fx.add({ type: 'line', x, y: t.y, z: zMid, vx: dir * U.rand(1, 5), vz: U.rand(-2, 4), life: 10, col: '#ffe9a8', size: 1.5, drag: 0.85 });
        BK.fx.add({ type: 'burst', x, y: t.y, z: zMid, life: 6, size: 14, col: '#fff6d8' });
      } else BK.fx.hitSpark(x, t.y, zMid, dir, power, t.bloodCol);
    }
    if (power >= 1) BK.fx.shake(power >= 2 ? 5 : 2.5, power >= 2 ? 10 : 6);
    BK.audio.sfx(h.sfx || (t.metal ? 'clang' : power >= 2 ? 'hitHeavy' : 'slash'), { pitch: t.team === 'hero' ? 0.8 : 1 });
  };

  // ---------------------------------------------------------- projectiles
  /**
   * 飛び道具
   * o: { x,y,z, vx,vy,vz, grav, w,h, team, owner, dmg, kb, push, lift, life,
   *      pierce(貫通数), draw(c, sx, sy, p), onHit(p, target), onExpire(p), onGround(p) }
   */
  class Projectile {
    constructor(o) {
      this.x = 0; this.y = 0; this.z = 40; this.vx = 0; this.vy = 0; this.vz = 0; this.grav = 0;
      this.w = 12; this.h = 10; this.team = 'hero'; this.dmg = 8; this.kb = 'light'; this.life = 90;
      this.pierce = 0; this.hit = new Set(); this.remove = false; this.t = 0; this.depth = 14;
      Object.assign(this, o);
      this.face = this.face || U.sign(this.vx || 1);
    }
    update(actors) {
      this.t++;
      if (this.tick) this.tick(this);
      this.x += this.vx; this.y += this.vy; this.z += this.vz; this.vz -= this.grav;
      if (this.z <= 0 && this.grav) {
        this.z = 0;
        if (this.onGround) { this.onGround(this); } else this.remove = true;
      }
      if (--this.life <= 0) { this.remove = true; if (this.onExpire) this.onExpire(this); }
      if (this.remove || this.harmless) return;
      const hb = { x0: this.x - this.w / 2, x1: this.x + this.w / 2, z0: this.z - this.h / 2, z1: this.z + this.h / 2, y: this.y, d: this.depth };
      for (const t of actors) {
        if (t.team === this.team || !t.hurtable || this.hit.has(t)) continue;
        if (!C.overlap(hb, t)) continue;
        const dir = this.dirAway ? U.sign(t.x - this.x) : U.sign(this.vx || this.face);
        const h = { dmg: this.dmg, kb: this.kb, push: this.push, lift: this.lift, stop: this.stop != null ? this.stop : 3, sfx: this.sfx, fx: this.fx, breakArmor: this.breakArmor };
        if (t.takeHit(this.owner || null, h, dir)) {
          this.hit.add(t);
          C.hitFx(this.owner || this, t, h, this.x, dir);
          if (this.onHit) this.onHit(this, t);
          if (this.pierce-- <= 0) { this.remove = true; if (this.onExpire) this.onExpire(this); break; }
        }
      }
      // 画面外で消滅
      if (this.x < BK.cam.x - 120 || this.x > BK.cam.x + BK.W + 120) this.remove = true;
    }
    draw(c) {
      const sx = BK.sx(this.x), sy = BK.sy(this.y, this.z);
      if (this.drawFn) { this.drawFn(c, sx, sy, this); return; }
      c.fillStyle = this.col || '#ffd'; c.fillRect(sx - this.w / 2, sy - 2, this.w, 4);
    }
    drawShadow(c) {
      if (this.noShadow) return;
      c.fillStyle = 'rgba(0,0,0,0.3)';
      c.beginPath(); c.ellipse(BK.sx(this.x), BK.sy(this.y, 0), this.w * 0.5, 2.5, 0, 0, Math.PI * 2); c.fill();
    }
  }
  BK.Projectile = Projectile;

  /** 画面全体を揺らす爆発（範囲攻撃） */
  C.explode = function (x, y, z, r, dmg, team, owner, opt) {
    opt = opt || {};
    BK.audio.sfx(opt.sfx || 'explode');
    BK.fx.shake(opt.shake || 6, 14);
    BK.fx.glow(x, y, z + 10, r * 1.3, opt.col || '#ff7a2a', 18);
    BK.fx.ring(x, y, 2, r * 1.2, opt.ringCol || '#ffcf8a', 18);
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * Math.PI * 2;
      BK.fx.add({ type: 'smoke', x: x + Math.cos(a) * r * 0.4, y: y + Math.sin(a) * 6, z: z + U.rand(0, 20), vx: Math.cos(a) * U.rand(1, 3), vz: U.rand(0.5, 2), life: U.randi(20, 40), size: U.rand(8, 16), col: 'rgba(60,40,35,0.6)', drag: 0.9 });
      BK.fx.add({ type: 'dot', x, y, z: z + 10, vx: Math.cos(a) * U.rand(2, 6), vz: U.rand(1, 6), g: 0.25, life: U.randi(15, 30), col: U.choose(['#ffcf6a', '#ff7a2a', '#fff2c0']), size: 2 });
    }
    const hits = [];
    for (const t of BK.game ? BK.game.actors : []) {
      if (t.team === team || !t.hurtable) continue;
      const dx = t.x - x, dy = (t.y - y) * 2;
      if (Math.hypot(dx, dy) > r + t.w / 2) continue;
      if (t.z > z + r) continue;
      const h = { dmg, kb: opt.kb || 'down', push: opt.push != null ? opt.push : 5, lift: opt.lift != null ? opt.lift : 6, stop: 0, sfx: 'none', fx: 'none', breakArmor: true };
      if (t.takeHit(owner, h, U.sign(dx || 1))) { hits.push(t); BK.fx.blood(t.x, t.y, t.z + 40, U.sign(dx || 1), 5, t.bloodCol); }
    }
    return hits;
  };
})(window.BK);

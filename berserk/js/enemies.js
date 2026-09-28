'use strict';
/* =====================================================================
 *  enemies.js ── 敵キャラクター共通処理 + 基本の雑魚「亡者兵」
 *
 *  BK.registerEnemy(def) で登録。def = {
 *    id, name, hp, w, h, weight, speed, speedY, score, range(近接の間合い),
 *    spec, stance, walkOpt, palettes: {名前: {色...}},     // rig を使う場合
 *    draw(c, e),                                          // rig を使わない場合（自前描画）
 *    moves: { name: { ...Move定義, ai: {min, max, w, cd} } },  // ai: 使用距離(x)と重み・硬直
 *    think(e, game),       // 独自AI（省略時は近接AI）
 *    update(e, game),      // 毎フレームの追加処理
 *    grabbable, downAfter, metal, bloodCol, drop: 'common'|null|'itemId',
 *    boss, poise,          // ボス: 大技でしかダウンしない耐久値
 *    entry: 'walk'|'drop'|'rise'|'jump',
 *    onDie(e, game), onSpawn(e, game),
 *  }
 *  出現: BK.game.spawnEnemy(id, {x, y, side:'L'|'R', entry, palette, delay})
 * ===================================================================== */
(function (BK) {
  const U = BK.U, R = BK.rig, C = BK.combat;

  BK.registerEnemy = function (def) {
    if (def.spec) def.spec = R.makeSpec(def.spec);
    def.stance = R.merge(R.NEUTRAL, def.stance || {});
    BK.enemyTypes[def.id] = def;
    return def;
  };

  class Enemy extends BK.Actor {
    constructor(def, x, y, opt) {
      opt = opt || {};
      const diff = BK.game ? BK.game.diffMul : 1;
      const hp = Math.round(def.hp * (def.boss ? 1 : diff));
      super({
        team: 'enemy', x, y, hp, maxHp: hp, w: def.w || 26, h: def.h || 86, weight: def.weight || 1,
        shadowR: def.shadowR || 16, scoreValue: def.score || 200, bloodCol: def.bloodCol || '#7a0a12', metal: !!def.metal,
        downAfter: def.downAfter || 99, boss: !!def.boss, armor: !!def.armor,
      });
      this.def = def; this.name = def.name;
      this.spec = def.spec; this.stance = def.stance;
      this.colors = def.palettes && opt.palette ? Object.assign({}, def.spec.colors, def.palettes[opt.palette]) : null;
      this.grabbable = def.grabbable !== false && !def.boss;
      this.ai = { mode: 'wait', t: 0, cd: U.randi(30, 70), waitDist: U.rand(95, 150), slotY: U.rand(-30, 30), side: 0 };
      this.hasToken = false;
      this.walkPh = U.rand(0, 6);
      this.poise = def.poise || 0;
      this.entry = opt.entry || def.entry || 'walk';
      this.entering = 0;
      this.opt = opt;
      this.getupInvul = 12;
      if (this.entry === 'rise') { this.entering = 44; this.intangible = true; }
      if (this.entry === 'drop') { this.z = 240; this.state = 'air'; }
      if (this.entry === 'jump') { this.z = 0.1; this.vz = 8; this.state = 'air'; }
      if (this.entry === 'walk') this.entering = 1;
    }
    requestToken() {
      if (this.hasToken) return true;
      if (C.tokens < C.maxTokens) { C.tokens++; this.hasToken = true; return true; }
      return false;
    }
    releaseToken() { if (this.hasToken) { C.tokens = Math.max(0, C.tokens - 1); this.hasToken = false; } }

    // -------------------------------------------------------- helpers
    get hero() { return BK.game && BK.game.hero; }
    /** 画面外から歩いて入ってくる途中なら移動して true を返す（独自AI用） */
    walkIn() {
      if (!this.entering) return false;
      const inside = this.x > BK.cam.x + 24 && this.x < BK.cam.x + BK.W - 24;
      if (inside) { this.entering = 0; return false; }
      this.moveToward(U.clamp(this.x, BK.cam.x + 50, BK.cam.x + BK.W - 50), this.y, this.def.speed || 1.2);
      if (this.vx) this.face = U.sign(this.vx);
      return true;
    }
    faceHero() { const h = this.hero; if (h) this.face = U.sign(h.x - this.x); }
    moveToward(tx, ty, spd, spdY) {
      spd = spd == null ? this.def.speed || 1.2 : spd;
      spdY = spdY == null ? this.def.speedY || spd * 0.7 : spdY;
      const ddx = tx - this.x, ddy = ty - this.y;
      this.vx = Math.abs(ddx) > 3 ? U.sign(ddx) * Math.min(spd, Math.abs(ddx)) : 0;
      this.vy = Math.abs(ddy) > 2 ? U.sign(ddy) * Math.min(spdY, Math.abs(ddy)) : 0;
      if (this.vx || this.vy) { this.state = 'walk'; this.walkPh += 0.16 * (spd / 1.2); }
      else this.state = 'idle';
    }
    /** 距離に合う技を重み付きで選ぶ */
    pickMove(adx, ady) {
      const list = [];
      for (const k in this.def.moves) {
        const m = this.def.moves[k];
        if (!m.ai) continue;
        if (adx < (m.ai.min || 0) || adx > (m.ai.max || 60)) continue;
        if (ady > (m.ai.dy || 8)) continue;
        if (m.ai.cond && !m.ai.cond(this)) continue;
        list.push([m.ai.w || 1, m]);
      }
      return list.length ? U.weighted(list) : null;
    }
    attack(m) {
      this.faceHero();
      this.startMove(m);
      this.ai.mode = 'recover';
      this.ai.cd = (m.ai && m.ai.cd) || U.randi(30, 60);
    }
    /** 敵弾を撃つ */
    shoot(o) {
      const p = new BK.Projectile(Object.assign({ team: 'enemy', owner: this, x: this.x + this.face * 24, y: this.y, z: this.z + 50, vx: this.face * 5 }, o));
      BK.game.addProjectile(p);
      return p;
    }

    // -------------------------------------------------------- update
    update(game) {
      this.animT++;
      if (this.flash > 0) this.flash--;
      if (this.invul > 0) this.invul--;
      if (this.grabbedBy) { this.state = 'grabbed'; return; }
      if (this.state === 'grabbed') { this.state = 'idle'; }
      if (this.entering > 0 && this.entry === 'rise') {
        this.entering--;
        if (this.entering % 6 === 0) BK.fx.dust(this.x, this.y, 2, 'rgba(70,60,50,0.5)');
        if (this.entering === 0) this.intangible = false;
        return;
      }
      if (this.def.update) this.def.update(this, game);
      if (this.remove) return;
      if (this.updateReactions()) { this.physics(); return; }
      if (this.move) { this.updateMove(); this.physics(); return; }
      if (this.state === 'air') { this.physics(); return; }
      if (this.def.think) this.def.think(this, game);
      else this.thinkMelee(game);
      this.physics();
      // 画面外に逃げすぎない
      if (!this.entering && !this.def.freeRoam) this.x = U.clamp(this.x, BK.cam.x - 50, BK.cam.x + BK.W + 50);
    }
    land() { if (this.state === 'air') { this.state = 'idle'; BK.fx.dust(this.x, this.y, 5); BK.audio.sfx('land', { pitch: 0.8 }); } }

    /** 標準の近接AI: 間合いを取りつつ、攻撃権（トークン）を得たら襲いかかる */
    thinkMelee(game) {
      const h = game.hero, ai = this.ai;
      ai.t++;
      if (!h || h.dead) { this.moveToward(this.x + this.face * 10, this.y, 0.4); this.releaseToken(); return; }
      const dx = h.x - this.x, dy = h.y - this.y, adx = Math.abs(dx), ady = Math.abs(dy);
      const side = U.sign(this.x - h.x) || 1;
      // 入場中は画面内まで歩く
      if (this.entering) {
        const inside = this.x > BK.cam.x + 20 && this.x < BK.cam.x + BK.W - 20;
        if (inside) this.entering = 0;
        else { this.moveToward(U.clamp(this.x, BK.cam.x + 40, BK.cam.x + BK.W - 40), this.y, this.def.speed || 1.2); this.face = U.sign(this.vx || dx); return; }
      }
      if (ai.cd > 0) ai.cd--;
      const range = this.def.range || 44;
      if (h.state === 'down' || h.state === 'getup' || h.invul > 60) {
        // 起き上がりを囲むように待機
        if (ai.mode === 'attack') { ai.mode = 'wait'; this.releaseToken(); }
      }
      switch (ai.mode) {
        case 'attack': {
          const tx = h.x + side * range * 0.9, ty = h.y;
          const m = this.pickMove(adx, ady);
          if (m && ady <= ((m.ai && m.ai.dy) || 8)) { this.attack(m); return; }
          this.moveToward(tx, ty, (this.def.speed || 1.2) * 1.15);
          this.face = U.sign(dx);
          if (ai.t > 200) { ai.mode = 'wait'; ai.t = 0; this.releaseToken(); ai.cd = 40; }
          break;
        }
        case 'recover':
          this.state = 'idle';
          if (ai.cd <= 0) { this.releaseToken(); ai.mode = 'wait'; ai.cd = U.randi(20, 70); ai.t = 0; ai.waitDist = U.rand(85, 150); ai.slotY = U.rand(-34, 34); }
          else if (ai.cd > 10 && U.chance(0.02)) { this.vx = side * 1.5; }
          break;
        default: { // wait
          const tx = h.x + side * ai.waitDist;
          const ty = U.clamp(h.y + ai.slotY, 4, BK.DEPTH - 4);
          const far = Math.abs(this.x - tx) > 8 || Math.abs(this.y - ty) > 6;
          if (far) this.moveToward(tx, ty, (this.def.speed || 1.2) * 0.7);
          else { this.vx = 0; this.vy = 0; this.state = 'idle'; }
          this.face = U.sign(dx);
          if (ai.cd <= 0 && this.requestToken()) { ai.mode = 'attack'; ai.t = 0; }
          else if (ai.cd <= 0) ai.cd = U.randi(10, 30);
          if (U.chance(0.004)) ai.slotY = U.rand(-34, 34);
        }
      }
    }
    /** 遠距離AI（弓兵など）: 距離を保ち、y を合わせて撃つ */
    thinkRanged(game, o) {
      const h = game.hero, ai = this.ai;
      o = o || {};
      ai.t++;
      if (!h || h.dead) { this.state = 'idle'; return; }
      if (this.entering) {
        const inside = this.x > BK.cam.x + 20 && this.x < BK.cam.x + BK.W - 20;
        if (inside) this.entering = 0;
        else { this.moveToward(U.clamp(this.x, BK.cam.x + 40, BK.cam.x + BK.W - 40), this.y); this.face = U.sign(this.vx || 1); return; }
      }
      if (ai.cd > 0) ai.cd--;
      const dx = h.x - this.x, adx = Math.abs(dx);
      const side = U.sign(this.x - h.x) || 1;
      const want = o.dist || 170;
      let tx = h.x + side * want;
      tx = U.clamp(tx, BK.cam.x + 30, BK.cam.x + BK.W - 30);
      this.moveToward(tx, h.y, (this.def.speed || 1) * 0.9);
      this.face = U.sign(dx);
      if (ai.cd <= 0 && Math.abs(h.y - this.y) < 10 && adx > 60 && o.move) { this.attack(o.move); ai.cd = o.cd || 90; }
      else if (adx < 50 && this.def.moves && this.def.moves.melee && ai.cd <= 0) this.attack(this.def.moves.melee);
    }

    // -------------------------------------------------------- damage
    takeHit(src, h, dir) {
      if (this.boss && this.def.poise) {
        const heavy = h.kb === 'down' || h.kb === 'launch' || h.kb === 'spin';
        if (heavy) {
          this.poise -= h.dmg;
          if (this.poise > 0) h = Object.assign({}, h, { kb: 'heavy', push: (h.push || 3) * 0.4 });
          else this.poise = this.def.poise;
        } else h = Object.assign({}, h, { push: (h.push == null ? 2 : h.push) * 0.4, stun: 8 });
      }
      const ok = super.takeHit(src, h, dir);
      if (ok && src && src.isHero && BK.game) BK.game.lastHitEnemy = this;
      return ok;
    }
    onDie(src) {
      this.releaseToken();
      if (this.def.onDie) this.def.onDie(this, BK.game);
      if (BK.game) BK.game.onEnemyKilled(this, src);
      BK.audio.sfx(this.def.dieSfx || 'growl', { pitch: this.def.diePitch || 1 });
    }

    // -------------------------------------------------------- drawing
    currentPose() {
      const st = this.stance, d = this.def;
      if (this.move) return R.sample(this.move.kf, this.mf, st);
      const rp = this.reactionPose(st);
      if (rp) return rp;
      if (this.state === 'grabbed') return R.merge(st, { lean: -12, head: -15, aF: 40 + Math.sin(this.animT * 0.7) * 20, eF: 50, aB: 30, eB: 40, lF: 10, kF: 10, lB: -10, kB: 10 });
      if (this.state === 'air' || this.z > 0) return R.merge(st, { lF: 40, kF: 70, lB: -10, kB: 60, aF: 120, aB: -60 });
      if (this.state === 'walk') return R.walk(st, this.walkPh, d.walkOpt);
      return R.idle(st, this.animT + this.uid * 13);
    }
    draw(c) {
      if (this.state === 'dead' && this.st > 20 && (this.st >> 2) % 2) return; // 点滅して消える
      if (this.def.draw) { this.def.draw(c, this); return; }
      if (this.entry === 'rise' && this.entering > 0) {
        // 地面から這い出る
        const k = this.entering / 44;
        const sy = BK.sy(this.y, 0);
        c.save();
        c.beginPath(); c.rect(BK.sx(this.x) - 60, sy - 200, 120, 200 + 4); c.clip();
        c.translate(0, k * this.h * 1.05);
        this.drawRig(c, R.merge(this.stance, { aF: 150 - k * 60, aB: 160 - k * 50, eF: 10, eB: 10, lean: 20 }), { colors: this.colors });
        c.restore();
        return;
      }
      this.drawRig(c, this.currentPose(), { colors: this.colors });
      this.drawTrail(c);
    }
  }
  BK.Enemy = Enemy;

  // ================================================================
  //  亡者兵（基本の雑魚）: 蝕の夜に彷徨う、腐り果てた兵士の亡骸
  // ================================================================
  function undeadHead(c, sp, col, sk, pose, opt) {
    const h = sk.headC, r = sp.headR;
    c.save(); c.translate(h.x, h.y); c.rotate((180 - sk.ha) * U.DEG);
    R.circle(c, 0, 0, r, col('skin'), col('line'));
    // 錆びた兜
    c.beginPath(); c.arc(0, -1, r + 1.2, Math.PI * 1.02, Math.PI * 1.98); c.lineTo(r + 3, -1); c.lineTo(-r - 1, -1); c.closePath();
    c.fillStyle = col('armor'); c.fill(); c.strokeStyle = col('line'); c.lineWidth = 1; c.stroke();
    if (!opt.tint) {
      // うつろな目（青白く光る）
      c.fillStyle = '#9fe0ff'; c.globalAlpha = 0.85;
      c.beginPath(); c.arc(r * 0.5, r * 0.05, 1.4, 0, 7); c.fill(); c.globalAlpha = 1;
      c.strokeStyle = '#2a1a14'; c.beginPath(); c.moveTo(r * 0.2, r * 0.6); c.lineTo(r * 0.9, r * 0.5); c.stroke();
    }
    c.restore();
  }
  function rustySword(c, sp, col, len) {
    R.poly(c, [-7, -1.5, 0, -1.5, 0, 1.5, -7, 1.5], col('grip'));
    R.poly(c, [0, -4, 2, -4, 2, 4, 0, 4], col('metalDark'));
    R.poly(c, [2, -2.2, len * 0.6, -2.6, len * 0.62, -1, len * 0.75, -2.2, len, 0, len - 5, 2, 2, 2.2], col('metal'), col('line'));
  }
  BK.registerEnemy({
    id: 'undead', name: '亡者兵', hp: 34, w: 24, h: 84, weight: 0.95, speed: 1.05, speedY: 0.75, score: 300, range: 46,
    entry: 'walk', drop: 'common', bloodCol: '#3a1a14', dieSfx: 'growl',
    spec: {
      scale: 1, thigh: 21, shin: 21, torso: 28, headR: 7.5, upper: 16, fore: 15, legW: 8, armW: 6.5, waistW: 12, chestW: 18, weaponLen: 38,
      colors: { skin: '#7d8a78', hair: '#222', cloth: '#3c3a33', clothDark: '#2a2924', sleeve: '#4a463c', body: '#4a4538', belt: '#2a2016', boot: '#2e2a24', bootDark: '#201d19', glove: '#6e7a68', gloveDark: '#56604f', armor: '#5a4a3a', metal: '#8a7c6c', metalDark: '#4a4038', grip: '#2a1a10' },
      draw: { head: undeadHead, weapon: rustySword },
    },
    palettes: {
      bone: { skin: '#c8c0a8', glove: '#b8b098', gloveDark: '#908870', armor: '#6a6a70', body: '#3a3a3e' },
      blood: { skin: '#8a5a50', armor: '#6a2020', body: '#4a1a1a', cloth: '#3a1a1a' },
    },
    stance: { lean: 18, head: 10, aF: 30, eF: 40, aB: 20, eB: 30, lF: 14, kF: 16, lB: -12, kB: 14, wAbs: 70 },
    walkOpt: { stride: 18, arm: 8 },
    moves: {
      chop: {
        dur: 44, trail: [18, 23], ai: { min: 20, max: 62, w: 3, cd: 50 },
        kf: [[0, {}], [16, { aF: 170, eF: 20, wAbs: 200, lean: -6, head: -5 }], [21, { aF: 70, eF: 0, wAbs: 70, lean: 26 }, 'snap'], [34, { aF: 60, eF: 0, wAbs: 60, lean: 26 }], [44, {}]],
        hits: [{ f: [19, 22], x: [8, 62], z: [10, 95], d: 14, dmg: 9, kb: 'light', push: 2.5 }],
        move: [[0, 0], [17, 1.5], [22, 0]],
        sfx: [[18, 'swing']],
      },
      lunge: {
        dur: 46, trail: [16, 24], ai: { min: 50, max: 90, w: 1, cd: 60 },
        kf: [[0, {}], [14, { aF: -20, eF: 60, wAbs: 95, lean: -4, lF: 5, kF: 20, lB: -20, kB: 10 }], [20, { aF: 90, eF: 0, wAbs: 92, lean: 24, lF: 40, kF: 30, lB: -30, kB: 5 }, 'snap'], [34, { aF: 88, eF: 0, wAbs: 90, lean: 24, lF: 40, kF: 30, lB: -30, kB: 5 }], [46, {}]],
        hits: [{ f: [18, 24], x: [10, 66], z: [30, 75], d: 12, dmg: 8, kb: 'heavy', push: 3 }],
        move: [[0, 0], [16, 4.5], [24, 0]],
        sfx: [[16, 'swing']],
      },
    },
  });
})(window.BK);

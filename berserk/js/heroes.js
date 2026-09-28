'use strict';
/* =====================================================================
 *  heroes.js ── プレイヤーキャラクター共通処理
 *
 *  キャラ定義は BK.registerHero(def) で登録する（hero_*.js）。
 *  def = {
 *    id, name, title, desc,                   // 表示用
 *    stats: {life, power, speed, reach, shot},// 選択画面の 1〜5
 *    maxHp, walk, walkY, run, jumpV, jumpVX, runJumpVX, weight, w, h,
 *    specialCost: 0.08,                       // 必殺技の体力消費（最大体力比）
 *    throwDmg: 18,
 *    spec: {...rig spec},  stance: {...pose},
 *    walkOpt, runOpt,                         // rig.walk / rig.run のオプション
 *    anim: { jump(h), grab(h), crouch(h), reload(h) } (省略可: pose を返す関数)
 *    moves: { atk1, atk2, atk3, atk4, dash, jumpAtk, jumpAtkF?, downAtk?, rising, charge,
 *             special, knee, throw, shoot, awaken, reload? },
 *    shot: { name, max, regen, cd, auto, air, reloadAll?, reloadLock?, fire(h),
 *            hold?: {frames, cost, fire(h)} },
 *    awaken: { name, type:'buff'|'screen', dur, start(h), update(h), end(h), colors? },
 *    drawBack(c,h), drawFront(c,h),           // 追加描画（オーラ等）
 *    init(h), update(h, game, input),        // 生成時 / 毎フレームの追加処理（重力倍率 h.gravMul など）
 *    ※ awaken.type 'screen' でも start(h) 内で h.awkT を設定すれば余韻バフを表現できる（HUDゲージ・配色は awkT を見る）
 *    portrait(c, x, y, s),                    // 省略時はリグで描く
 *  }
 * ===================================================================== */
(function (BK) {
  const U = BK.U, R = BK.rig;
  const CHARGE_FRAMES = 34;

  BK.registerHero = function (def) {
    def.spec = R.makeSpec(def.spec || {});
    def.stance = R.merge(R.NEUTRAL, def.stance || {});
    const mv = def.moves || (def.moves = {});
    ['atk1', 'atk2', 'atk3', 'atk4'].forEach((k, i) => { if (mv[k]) mv[k].comboIdx = i; });
    if (mv.throw && !mv.throw.onFrame) {
      const at = mv.throw.throwAt || 10;
      mv.throw.onFrame = (h, f) => { if (f === at) h.releaseThrow(); };
    }
    if (mv.knee && !mv.knee.onEnd) mv.knee.onEnd = h => { if (h.grabbing) h.state = 'grab'; };
    if (mv.throw && !mv.throw.onEnd) mv.throw.onEnd = h => { h.state = 'idle'; };
    BK.heroes[def.id] = def;
    if (BK.heroOrder.indexOf(def.id) < 0) BK.heroOrder.push(def.id);
    return def;
  };

  // ===================================================== shared shots
  const S = BK.heroShots = {
    /** 手元の発射位置 */
    muzzle(h, fwd, z) { return { x: h.x + h.face * (fwd || 30), y: h.y, z: h.z + (z || 56) }; },
    bolt(h, o) {
      o = o || {};
      const m = S.muzzle(h, o.fwd || 30, o.z || 56);
      BK.game.addProjectile(new BK.Projectile({
        x: m.x, y: m.y, z: m.z, vx: h.face * (o.spd || 11), w: 18, h: 8, team: 'hero', owner: h, dmg: o.dmg || 4, kb: 'light', push: 1.2, stop: 2, life: 60, sfx: 'hit',
        drawFn(c, sx, sy, p) {
          c.strokeStyle = o.col || '#d8d0b8'; c.lineWidth = 2;
          c.beginPath(); c.moveTo(sx - p.face * 12, sy); c.lineTo(sx + p.face * 6, sy); c.stroke();
          c.fillStyle = '#9a9a9a'; c.beginPath(); c.moveTo(sx + p.face * 9, sy); c.lineTo(sx + p.face * 4, sy - 2.5); c.lineTo(sx + p.face * 4, sy + 2.5); c.fill();
          c.fillStyle = '#a03030'; c.fillRect(sx - p.face * 12 - 1, sy - 2, 3, 4);
        },
      }));
    },
    knife(h, o) {
      o = o || {};
      const m = S.muzzle(h, 26, o.z || 60);
      BK.game.addProjectile(new BK.Projectile({
        x: m.x, y: m.y, z: m.z, vx: h.face * (o.spd || 10), w: 14, h: 8, team: 'hero', owner: h, dmg: o.dmg || 6, kb: 'light', push: 1.5, stop: 2, life: 55, sfx: 'slash',
        drawFn(c, sx, sy, p) {
          c.strokeStyle = 'rgba(230,236,245,0.35)'; c.lineWidth = 1; c.beginPath(); c.moveTo(sx, sy); c.lineTo(sx - p.vx * 2.5, sy); c.stroke();
          c.save(); c.translate(sx, sy); c.rotate(p.t * 0.9 * p.face);
          c.fillStyle = '#e4e8ee'; c.fillRect(-1.5, -9, 3, 12); c.fillStyle = '#3a2616'; c.fillRect(-2, 3, 4, 5);
          c.restore();
        },
      }));
    },
    bomb(h) {
      const m = S.muzzle(h, 20, 70);
      BK.game.addProjectile(new BK.Projectile({
        x: m.x, y: m.y, z: m.z, vx: h.face * 5, vz: 5.5, grav: 0.35, w: 12, h: 12, team: 'hero', owner: h, dmg: 10, kb: 'down', life: 120, harmless: false,
        onGround(p) { p.remove = true; BK.combat.explode(p.x, p.y, 0, 50, 26, 'hero', h); },
        onHit(p) { p.remove = true; BK.combat.explode(p.x, p.y, p.z, 50, 26, 'hero', h); },
        drawFn(c, sx, sy, p) {
          c.fillStyle = '#2a2a2e'; c.beginPath(); c.arc(sx, sy, 6, 0, 7); c.fill();
          c.fillStyle = (p.t >> 2) % 2 ? '#ffd040' : '#ff6020'; c.beginPath(); c.arc(sx + 4, sy - 5, 2, 0, 7); c.fill();
        },
      }));
    },
    firepot(h) {
      const m = S.muzzle(h, 20, 70);
      BK.game.addProjectile(new BK.Projectile({
        x: m.x, y: m.y, z: m.z, vx: h.face * 4.6, vz: 5, grav: 0.35, w: 12, h: 12, team: 'hero', owner: h, dmg: 6, kb: 'light', life: 120,
        onGround(p) { p.remove = true; S.firePatch(p.x, p.y, 'hero', h); },
        onHit(p) { p.remove = true; S.firePatch(p.x, p.y, 'hero', h); },
        drawFn(c, sx, sy, p) {
          c.fillStyle = '#8a5a3a'; c.beginPath(); c.arc(sx, sy, 6, 0, 7); c.fill();
          c.fillStyle = '#ff8a2a'; c.beginPath(); c.arc(sx, sy - 7, 3 + Math.sin(p.t) * 1, 0, 7); c.fill();
        },
      }));
    },
    /** 地面で燃え続ける炎（team の反対側にダメージ） */
    firePatch(x, y, team, owner, o) {
      o = o || {};
      BK.audio.sfx('fire');
      BK.game.addProjectile(new BK.Projectile({
        x, y, z: 14, vx: 0, w: o.w || 70, h: 30, depth: 20, team, owner, dmg: o.dmg || 5, kb: 'light', push: 1, stop: 1, life: o.life || 110, pierce: 99, noShadow: true, sfx: 'fire', fx: 'none',
        tick(p) {
          if (p.t % 18 === 0) p.hit.clear();
          if (p.t % 2 === 0) BK.fx.add({ type: 'glow', x: p.x + U.rand(-p.w / 2, p.w / 2), y: p.y + U.rand(-8, 8), z: U.rand(0, 10), vz: U.rand(0.8, 2), life: U.randi(14, 24), size: U.rand(8, 14), col: U.choose(['#ff7a1a', '#ffb040', '#ff4010']) });
        },
        drawFn(c, sx, sy, p) {
          const k = Math.min(1, p.life / 20);
          c.globalAlpha = 0.5 * k; c.fillStyle = '#ff5010';
          c.beginPath(); c.ellipse(sx, sy + 14, p.w / 2, 6, 0, 0, 7); c.fill(); c.globalAlpha = 1;
        },
      }));
    },
    spear(h) {
      const m = S.muzzle(h, 20, 62);
      BK.game.addProjectile(new BK.Projectile({
        x: m.x, y: m.y, z: m.z, vx: h.face * 13, w: 40, h: 8, team: 'hero', owner: h, dmg: 18, kb: 'down', push: 4, life: 70, pierce: 3, stop: 5,
        drawFn(c, sx, sy, p) {
          c.strokeStyle = '#6a4a2a'; c.lineWidth = 2.5; c.beginPath(); c.moveTo(sx - p.face * 26, sy); c.lineTo(sx + p.face * 12, sy); c.stroke();
          R.poly(c, [sx + p.face * 12, sy - 3.5, sx + p.face * 22, sy, sx + p.face * 12, sy + 3.5], '#d0d4d8', '#333');
        },
      }));
    },
  };

  // ===================================================== auto-play (デモ / テスト用)
  const AC = BK.autoCtrl = { held: {}, pressed: {}, released: {}, heldFrames: {}, dirX: 0, dirY: 0, duFrame: -999, dashTap: 0, stickFull: 0, ax: 0, ay: 0, t: 0 };
  ['atk', 'jmp', 'sht', 'sp', 'awk', 'start', 'pause', 'up', 'down', 'left', 'right'].forEach(b => { AC.held[b] = false; AC.pressed[b] = false; AC.released[b] = false; AC.heldFrames[b] = 0; });
  AC.tap = function (b) { this.pressed[b] = true; this.held[b] = true; };
  AC.think = function (game) {
    const h = game.hero;
    this.t++;
    for (const b in this.pressed) { this.released[b] = this.held[b] && !this.pressed[b]; this.pressed[b] = false; this.held[b] = false; }
    this.dirX = 0; this.dirY = 0; this.dashTap = 0;
    if (!h || h.dead) return;
    if (h.state === 'grabbed') { if (this.t % 3 === 0) this.tap('atk'); this.dirX = this.t % 6 < 3 ? 1 : -1; return; }
    if (h.state === 'grab') { if (this.t % 10 === 0) this.tap('atk'); return; }
    // 最寄りの敵
    let best = null, bd = 1e9;
    for (const a of game.actors) {
      if (a.team !== 'enemy' || a.dead || a.hp <= 0) continue;
      if (a.x < BK.cam.x - 20 || a.x > BK.cam.x + BK.W + 20) continue;
      const d = Math.abs(a.x - h.x) + Math.abs(a.y - h.y) * 2;
      if (d < bd) { bd = d; best = a; }
    }
    // 回復アイテム
    if (h.hp < h.maxHp * 0.5) {
      for (const it of game.items) if (it.def.kind === 'food') { best = { x: it.x, y: it.y, item: true }; break; }
    }
    if (!best) { this.dirX = 1; this.dirY = h.y < BK.DEPTH / 2 - 10 ? 1 : h.y > BK.DEPTH / 2 + 10 ? -1 : 0; if (this.t % 90 < 2) this.tap('sht'); return; }
    const dx = best.x - h.x, dy = best.y - h.y;
    if (best.item) { this.dirX = Math.abs(dx) > 6 ? Math.sign(dx) : 0; this.dirY = Math.abs(dy) > 4 ? Math.sign(dy) : 0; return; }
    const range = best.boss ? 70 : 52;
    if (Math.abs(dy) > 7) this.dirY = Math.sign(dy);
    if (Math.abs(dx) > range + 12) this.dirX = Math.sign(dx);
    else if (Math.abs(dx) < 22) this.dirX = -Math.sign(dx || 1);
    else if (h.face !== Math.sign(dx)) this.dirX = Math.sign(dx);
    if (Math.abs(dx) <= range + 16 && Math.abs(dy) <= 12 && h.face === Math.sign(dx)) {
      if (this.t % 7 === 0) this.tap('atk');
    } else if (Math.abs(dy) <= 10 && Math.abs(dx) > 120 && this.t % 20 === 0) this.tap('sht');
    if (h.awk >= 100 && this.t % 30 === 0) this.tap('awk');
    const near = game.actors.filter(a => a.team === 'enemy' && !a.dead && Math.abs(a.x - h.x) < 60 && Math.abs(a.y - h.y) < 20).length;
    if (near >= 3 && h.hp > h.maxHp * 0.3 && this.t % 60 === 0) this.tap('sp');
  };

  // ===================================================== Hero
  class Hero extends BK.Actor {
    constructor(def, x, y) {
      super({
        team: 'hero', x, y, w: def.w || 26, h: def.h || 92, hp: def.maxHp, maxHp: def.maxHp,
        weight: def.weight || 1.3, shadowR: def.shadowR || 18,
      });
      this.def = def; this.spec = def.spec; this.stance = def.stance;
      this.lives = 2;                 // 残機（画面上の表示は lives）
      this.ammo = def.shot.max; this.shotCd = 0; this.shotRegenT = 0; this.reloading = 0; this.holdS = 0;
      this.sub = null;
      this.awk = 0; this.awkT = 0;
      this.combo = 0; this.lastAtkEnd = -99; this.lastAtkHit = false; this.bufA = 0;
      this.chargeT = 0; this.chargeRel = 0;
      this.runDir = 0; this.jumpAtkUsed = false; this.landT = 0;
      this.contactT = 0; this.grabT = 0; this.knees = 0; this.throwDir = 1;
      this.escape = 0; this.walkPh = 0;
      this.dmgMul = 1; this.speedMul = 1; this.superArmor = 0;
      this.downAfter = 4; this.getupInvul = 50; this.downTime = 30; this.deadTime = 1e9;
      this.bloodCol = '#9e0d14';
      this.isHero = true;
      if (def.init) def.init(this);
    }
    get ctrl() { return BK.autoplay ? BK.autoCtrl : BK.input; }
    get specialCost() { return Math.ceil(this.maxHp * (this.def.specialCost || 0.08)); }
    canSpecial() { return this.def.moves.special && this.hp > this.specialCost; }

    update(game) {
      const I = this.ctrl, d = this.def;
      this.animT++;
      if (this.invul > 0) this.invul--;
      if (this.flash > 0) this.flash--;
      if (this.shotCd > 0) this.shotCd--;
      if (this.superArmor > 0 && !this.awkT) this.superArmor--;
      this.updateShot(I);
      this.updateAwaken();
      if (d.update) d.update(this, game, I);
      // 溜め
      if (I.held.atk) this.chargeT++;
      else { if (this.chargeT >= CHARGE_FRAMES) this.chargeRel = 10; this.chargeT = 0; }
      if (this.chargeRel > 0) this.chargeRel--;
      if (this.grabbing) this.holdGrabbed();

      if (this.dead) { this.updateReactions(); this.physics(); return; }

      // ---- のけぞり中（必殺技で割り込み可）
      if (this.state === 'hurt' || this.state === 'fall' || this.state === 'down' || this.state === 'getup') {
        if (this.state === 'hurt' && this.canSpecial() && (I.pressed.sp || (I.pressed.atk && I.held.jmp) || (I.pressed.jmp && I.held.atk))) {
          this.doSpecial();
        } else { this.updateReactions(); this.physics(); return; }
      }
      if (this.state === 'grabbed') { this.updateGrabbed(I); return; }

      // ---- 技の実行中
      if (this.move) {
        const m = this.move;
        if (I.pressed.atk) this.bufA = 9; else if (this.bufA > 0) this.bufA--;
        if (m.comboIdx != null && this.mf <= 4 && I.pressed.jmp && this.canSpecial()) {
          this.endMove(); this.doSpecial();
        } else if (m.comboIdx != null && this.mf >= (m.cancel || m.dur) && this.bufA > 0 && this.moveHit && m.comboIdx < 3) {
          this.bufA = 0; this.startCombo(m.comboIdx + 1);
        } else if (m.comboIdx != null && this.mf >= (m.cancel || m.dur) && this.chargeRel > 0 && d.moves.charge) {
          this.chargeRel = 0; this.startMove(d.moves.charge);
        } else if (m.cancelShot && this.mf >= m.cancelShot && I.pressed.sht && this.shotCd <= 0 && (this.sub || (this.ammo > 0 && !this.reloading))) {
          this.endMove(); this.shoot(I);
        }
        if (this.move) this.updateMove();
        this.physics();
        return;
      }
      if (this.state === 'grab') { this.updateGrab(I, game); this.physics(); return; }
      if (this.state === 'jsq') {
        this.st++;
        if (I.pressed.atk && this.canSpecial()) { this.doSpecial(); this.physics(); return; }
        if (this.st >= 3) this.launchJump(I);
        this.physics(); return;
      }
      if (this.landT > 0) { this.landT--; this.physics(); return; }
      if (this.z > 0 || this.state === 'air') { this.updateAir(I); this.physics(); return; }
      this.updateGround(I, game);
      this.physics();
    }

    // ------------------------------------------------------------ ground
    updateGround(I, game) {
      const d = this.def;
      // リロード中は無防備（撃ち切った／被弾で中断された場合も再開）
      if (this.reloading > 0 && d.shot.reloadLock && d.moves.reload && !this.sub) {
        this.startMove(d.moves.reload);
        this.mf = Math.max(0, d.moves.reload.dur - this.reloading);
        return;
      }
      if (I.pressed.sp && this.canSpecial()) { this.doSpecial(); return; }
      if (I.pressed.awk && this.awk >= 100) { this.doAwaken(); return; }
      if (I.pressed.jmp) {
        if (I.held.atk && I.heldFrames.atk <= 4 && this.canSpecial()) { this.doSpecial(); return; }
        this.state = 'jsq'; this.st = 0; this.jumpRun = this.state === 'run' ? this.runDir : 0;
        if (this._wasRun) this.jumpRun = this.runDir;
        return;
      }
      if (I.pressed.atk) {
        if (BK.frame - I.duFrame <= 12 && d.moves.rising) { this.vy = 0; this.startMove(d.moves.rising); return; }
        if (this._wasRun && d.moves.dash) { this.startMove(d.moves.dash); this._wasRun = false; return; }
        const next = (BK.frame - this.lastAtkEnd < 26 && this.lastAtkHit && this.combo < 3) ? this.combo + 1 : 0;
        this.startCombo(next);
        return;
      }
      if (this.chargeRel > 0 && d.moves.charge) { this.chargeRel = 0; this.startMove(d.moves.charge); return; }
      if (I.pressed.sht || (d.shot.auto && I.held.sht && this.shotCd <= 0) || (this.sub && I.held.sht && this.shotCd <= 0)) {
        if (this.shoot(I)) return;
      }
      if (d.shot.hold && I.held.sht && !this.sub) {
        this.holdS++;
        if (this.holdS === d.shot.hold.frames && this.ammo >= d.shot.hold.cost) {
          this.ammo -= d.shot.hold.cost; this.holdS = 0;
          d.shot.hold.fire(this);
          return;
        }
      } else this.holdS = 0;

      // 移動
      const sp = this.speedMul;
      let vx = I.dirX * d.walk * sp, vy = I.dirY * d.walkY * sp;
      if (I.dirX !== 0 && this.state !== 'run') {
        if (I.dashTap === I.dirX || (I.stickFull >= 22 && BK.input.touchMode) || I.stickFull >= 22 && I === BK.input && BK.input.src.kb.run) { this.state = 'run'; this.runDir = I.dirX; BK.fx.dust(this.x - this.face * 8, this.y, 3); }
      }
      if (this.state === 'run') {
        if (I.dirX !== this.runDir) this.state = 'idle';
        else { vx = this.runDir * d.run * sp; vy = I.dirY * d.walkY * 0.8 * sp; if (this.animT % 14 === 0) BK.fx.dust(this.x - this.face * 10, this.y, 2); }
      }
      this._wasRun = this.state === 'run';
      if (I.dirX !== 0) this.face = I.dirX;
      this.vx = vx; this.vy = vy;
      if (this.state !== 'run') this.state = (vx || vy) ? 'walk' : 'idle';
      this.walkPh += this.state === 'run' ? 0.3 * sp : (vx || vy) ? 0.2 * sp : 0;
      // 掴み（敵に向かって歩き続ける）
      if (this.state === 'walk' && I.dirX === this.face) {
        const e = game.findGrabbable(this);
        if (e) { if (++this.contactT >= 7) this.startGrab(e); }
        else this.contactT = 0;
      } else this.contactT = 0;
    }
    startCombo(i) {
      this.combo = i;
      this.startMove(this.def.moves['atk' + (i + 1)]);
      this.bufA = 0;
    }
    endMove() {
      const m = this.move;
      super.endMove();
      if (m && m.comboIdx != null) { this.lastAtkEnd = BK.frame; this.lastAtkHit = this.moveHit; }
    }
    launchJump(I) {
      const d = this.def;
      this.state = 'air'; this.st = 0;
      const run = this._wasRun;
      this.vz = d.jumpV * (run ? 1.02 : 1);
      this.vx = run ? this.runDir * (d.runJumpVX || d.jumpVX * 1.8) : I.dirX * d.jumpVX * this.speedMul;
      this.vy = I.dirY * 1.2;
      if (I.dirX) this.face = I.dirX;
      this.z = 0.1; this.jumpAtkUsed = false; this._wasRun = false;
      BK.audio.sfx('jump');
    }
    updateAir(I) {
      const d = this.def;
      this.state = this.move ? 'move' : 'air';
      // 空中制御（弱）
      if (I.dirX) this.vx = U.approach(this.vx, I.dirX * Math.max(Math.abs(this.vx), d.jumpVX * 0.7), 0.12);
      if (I.pressed.atk && !this.jumpAtkUsed) {
        this.jumpAtkUsed = true;
        if (I.dirY === 1 && d.moves.downAtk) this.startMove(d.moves.downAtk);
        else if (Math.abs(this.vx) > 1 && d.moves.jumpAtkF) this.startMove(d.moves.jumpAtkF);
        else this.startMove(d.moves.jumpAtk);
        return;
      }
      if (I.pressed.sht && (d.shot.air || this.sub)) this.shoot(I, true);
    }
    land() {
      if (this.dead) return;
      this.state = 'idle'; this.landT = 4; this.jumpAtkUsed = false;
      this.vx *= 0.3;
      BK.audio.sfx('land'); BK.fx.dust(this.x, this.y, 4);
    }

    // ------------------------------------------------------------ shot
    updateShot() {
      const s = this.def.shot;
      if (this.reloading > 0) { if (--this.reloading === 0) { this.ammo = s.max; BK.audio.sfx('select', { pitch: 1.5 }); } return; }
      if (this.ammo < s.max && this.shotCd <= 0) {
        if (++this.shotRegenT >= s.regen) { this.ammo++; this.shotRegenT = 0; }
      }
    }
    shoot(I, air) {
      const d = this.def, s = d.shot;
      if (this.shotCd > 0) return false;
      if (this.sub) {
        const idef = BK.itemDefs[this.sub.id];
        this.shotCd = idef.fire(this) || 10;
        if (--this.sub.ammo <= 0) this.sub = null;
        if (!air && d.moves.shoot) this.startMove(d.moves.shoot);
        return true;
      }
      if (this.reloading || this.ammo <= 0) return false;
      this.ammo--; this.shotCd = s.cd; this.shotRegenT = -s.cd;
      s.fire(this, air);
      if (!air && d.moves.shoot) this.startMove(d.moves.shoot);
      if (this.ammo <= 0 && s.reloadAll) {
        this.reloading = s.reloadAll;
        if (s.reloadLock && d.moves.reload && !air) { this.endMove(); this.startMove(d.moves.reload); }
      }
      return true;
    }

    // ------------------------------------------------------------ special / awaken
    doSpecial() {
      const cost = this.specialCost;
      this.hp = Math.max(1, this.hp - cost);
      this.state = 'idle'; this.hitstun = 0; this.hitCount = 0;
      if (this.move) super.endMove();
      this.startMove(this.def.moves.special);
      this.invul = Math.max(this.invul, 6);
      BK.fx.flash('#ffffff', 4);
    }
    doAwaken() {
      const d = this.def;
      this.awk = 0;
      BK.audio.sfx('awaken');
      BK.fx.flash('#ff2010', 10);
      BK.fx.shake(6, 30);
      if (BK.game) BK.game.freeze(d.moves.awaken ? d.moves.awaken.dur : 50, this);
      if (d.moves.awaken) this.startMove(d.moves.awaken);
      this.invul = Math.max(this.invul, (d.moves.awaken ? d.moves.awaken.dur : 50) + 10);
      this._awkPending = true;
      if (!d.moves.awaken) this.activateAwaken();
    }
    activateAwaken() {
      const a = this.def.awaken;
      this._awkPending = false;
      if (!a) return;
      if (a.type === 'buff') this.awkT = a.dur;
      if (a.start) a.start(this);
      if (BK.game) BK.game.banner(a.name, '#ff4030');
    }
    updateAwaken() {
      if (this._awkPending && !this.move) this.activateAwaken();
      if (this.awkT > 0) {
        const a = this.def.awaken;
        this.awkT--;
        if (a.update) a.update(this);
        if (this.awkT === 0 && a.end) a.end(this);
      }
      if (BK.setAwakenReady) BK.setAwakenReady(this.awk >= 100);
    }

    // ------------------------------------------------------------ grab
    startGrab(e) {
      this.state = 'grab'; this.grabbing = e; this.grabT = 0; this.knees = 0; this.contactT = 0;
      e.grabbedBy = this;
      if (e.move) e.endMove();
      if (e.releaseToken) e.releaseToken();
      e.state = 'grabbed'; e.face = -this.face; e.vx = 0; e.vy = 0;
      BK.audio.sfx('grab');
    }
    holdGrabbed() {
      const e = this.grabbing;
      if (!e || e.dead || e.grabbedBy !== this) { this.grabbing = null; if (this.state === 'grab') this.state = 'idle'; return; }
      e.x = this.x + this.face * (this.w / 2 + e.w / 2 - 6); e.y = this.y; e.z = 0; e.vx = 0; e.vy = 0;
    }
    updateGrab(I) {
      const e = this.grabbing;
      if (!e) { this.state = 'idle'; return; }
      this.grabT++;
      if (I.pressed.atk) {
        const dir = I.dirX;
        if ((dir !== 0 && this.knees >= 1) || this.knees >= 3 || !this.def.moves.knee) {
          this.throwDir = dir || this.face;
          if (this.throwDir !== this.face) this.face = this.throwDir; // 背負い投げ
          this.startMove(this.def.moves.throw);
        } else {
          this.knees++;
          this.startMove(this.def.moves.knee);
        }
        return;
      }
      if (this.grabT > 110 || I.pressed.jmp) {
        // 振りほどかれる
        e.grabbedBy = null; e.state = 'hurt'; e.hitstun = 10; e.vx = this.face * 3;
        this.grabbing = null; this.state = 'idle'; this.vx = -this.face * 2;
      }
    }
    releaseThrow() {
      const e = this.grabbing;
      if (!e) return;
      const dir = this.throwDir;
      this.grabbing = null; e.grabbedBy = null;
      const dmg = Math.round((this.def.throwDmg || 18) * this.dmgMul);
      e.x = this.x + dir * 14; e.face = -dir;
      e.hp -= dmg; e.flash = 6;
      this.onDealDamage(dmg, e, {});
      if (e.hp <= 0) { e.hp = 0; e.die(this, { dmg }, dir); }
      e.state = 'fall'; e.st = 0; e._bounced = false; e.spinning = true;
      e.vx = dir * 6.5 / Math.sqrt(e.weight || 1); e.vz = 6.5; e.z = 24;
      e.thrownBy = this; e._thrownHit = null;
      BK.fx.shake(3, 8);
      BK.audio.sfx('swingHeavy');
    }
    updateGrabbed(I) {
      // 敵（悪霊など）に掴まれている: 連打・レバガチャで脱出
      const g = this.grabbedBy;
      if (!g || g.dead) { this.grabbedBy = null; this.state = 'idle'; return; }
      let n = (I.pressed.atk ? 1 : 0) + (I.pressed.jmp ? 1 : 0) + (I.pressed.sht ? 1 : 0);
      if (I.dirX !== I.prevDirX && I.dirX !== 0) n++;
      if (I.dirY !== I.prevDirY && I.dirY !== 0) n++;
      this.escape += n;
      if (I.pressed.sp && this.canSpecial()) { this.breakFree(); this.doSpecial(); return; }
      if (this.escape >= (g.escapeNeed || 10)) this.breakFree();
    }
    breakFree() {
      const g = this.grabbedBy;
      this.grabbedBy = null; this.state = 'idle'; this.escape = 0; this.invul = 20;
      if (g) {
        g.grabbing = null;
        if (g.onShakeOff) g.onShakeOff(this);
        else if (g.def && g.def.onShakeOff) g.def.onShakeOff(g, this);
        else g.takeHit(this, { dmg: 4, kb: 'down', push: 4, lift: 4 }, U.sign(g.x - this.x || 1));
      }
      BK.fx.shake(3, 8);
    }

    // ------------------------------------------------------------ damage hooks
    onDamaged(dmg) {
      this.awk = Math.min(100, this.awk + dmg * 0.9);
      BK.audio.sfx('hurt');
      this.jumpAtkUsed = true;
      if (BK.game) BK.game.onHeroHurt(dmg);
    }
    onDealDamage(dmg, target) {
      if (target && target.isProp) return;
      this.awk = Math.min(100, this.awk + dmg * 0.32);
      if (BK.game) BK.game.onHeroDealt(dmg, target);
    }
    die(src, h, dir) {
      super.die(src, h, dir);
      this.state = 'fall';
      this.awkT = 0; this.superArmor = 0; this.dmgMul = 1; this.speedMul = 1;
      if (this.def.awaken && this.def.awaken.end) this.def.awaken.end(this);
      BK.audio.sfx('hurt', { pitch: 0.7 });
      BK.fx.stop(18);
    }
    respawn(x) {
      if (this.move) super.endMove();
      this.dead = false; this.hp = this.maxHp; this.state = 'air'; this.st = 0;
      this.x = x; this.y = BK.DEPTH * 0.5; this.z = 180; this.vz = -2; this.vx = 0; this.vy = 0;
      this.invul = 170; this.flash = 0; this.hitCount = 0; this.move = null; this.grabbedBy = null; this.grabbing = null;
      this.ammo = this.def.shot.max; this.reloading = 0;
      this._respawnBlast = true;
    }
    onLand(impact) {
      super.onLand(impact);
      if (this._respawnBlast && !this.dead) {
        this._respawnBlast = false;
        // 復活時の衝撃波で周囲の敵を吹き飛ばす
        BK.fx.ring(this.x, this.y, 2, 120, '#ffd9a0', 22);
        BK.fx.shake(6, 14); BK.audio.sfx('cannon', { vol: 0.7 });
        if (BK.game) for (const a of BK.game.actors) {
          if (a.team !== 'enemy' || a.dead || a.boss) continue;
          if (Math.abs(a.x - this.x) < 160) a.takeHit(this, { dmg: 1, kb: 'down', push: 6, lift: 5 }, U.sign(a.x - this.x || 1));
        }
      }
    }

    // ------------------------------------------------------------ drawing
    currentPose() {
      const st = this.stance, d = this.def, an = d.anim || {};
      if (this.move) return R.sample(this.move.kf, this.mf, st);
      const rp = this.reactionPose(st);
      if (rp) return rp;
      if (this.state === 'grabbed') return R.merge(st, { lean: -10 + Math.sin(this.animT * 0.8) * 8, aF: 60 + Math.sin(this.animT * 0.9) * 30, aB: 50, eF: 60, eB: 60, lF: 15, kF: 20, lB: -15, kB: 10 });
      if (this.state === 'grab') return an.grab ? an.grab(this) : R.merge(st, { lean: 12, aF: 75, eF: 30, aB: 70, eB: 40, lF: 24, kF: 20, lB: -20, kB: 6 });
      if (this.state === 'jsq' || this.landT > 0) return an.crouch ? an.crouch(this) : R.merge(st, { lF: 50, kF: 80, lB: -10, kB: 70, lean: 16, drop: 2 });
      if (this.z > 0) {
        if (an.jump) return an.jump(this);
        const up = this.vz > 0;
        return R.merge(st, { lF: up ? 55 : 30, kF: up ? 90 : 40, lB: up ? -5 : -20, kB: up ? 80 : 30, lean: 8, aB: -50, eB: 40, cape: 1.3 });
      }
      if (this.state === 'run') return R.run(st, this.walkPh, d.runOpt);
      if (this.state === 'walk') return R.walk(st, this.walkPh, d.walkOpt);
      return R.idle(st, this.animT);
    }
    draw(c) {
      const d = this.def;
      if (this.invul > 0 && this.invul < 170 && !this.move && this.state !== 'down' && this.state !== 'getup' && (BK.frame >> 2) % 2 && this.invul > 20) c.globalAlpha = 0.45;
      const pose = this.currentPose();
      if (d.drawBack) d.drawBack(c, this);
      const colors = this.awkT > 0 && d.awaken && d.awaken.colors ? Object.assign({}, this.spec.colors, d.awaken.colors) : null;
      this.drawRig(c, pose, colors ? { colors, awakened: true } : { awakened: false });
      c.globalAlpha = 1;
      this.drawTrail(c);
      if (d.drawFront) d.drawFront(c, this);
      // 溜め完了の光
      if (this.chargeT >= CHARGE_FRAMES && d.moves.charge) {
        const k = (Math.sin(BK.frame * 0.5) + 1) / 2;
        const tip = this.sk ? this.sk.tip : { x: 30, y: -60 };
        const sx = BK.sx(this.x + tip.x * this.face * (this.spec.scale || 1)), sy = BK.sy(this.y, this.z) + tip.y * (this.spec.scale || 1);
        c.globalAlpha = 0.5 + k * 0.4; c.fillStyle = '#ffe2a0';
        c.beginPath(); c.arc(sx, sy, 5 + k * 4, 0, 7); c.fill(); c.globalAlpha = 1;
      }
    }
  }
  BK.Hero = Hero;
})(window.BK);

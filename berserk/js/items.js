'use strict';
/* =====================================================================
 *  items.js ── 拾えるアイテム（回復・得点・サブ武器）と壊せるオブジェクト
 *
 *  BK.itemDefs[id] = { kind:'food'|'score'|'weapon', name, heal(割合), score, ammo,
 *                      draw(c, sx, sy, t), fire(hero) (weapon のみ) }
 *  BK.propDefs[id] = { hp, w, h, draw(c, sx, sy, prop), debris:[色...], metal }
 *  配置: BK.game.spawnItem(id, x, y, z) / BK.game.spawnProp(id, x, y, itemId)
 * ===================================================================== */
(function (BK) {
  const U = BK.U, R = BK.rig;

  // ------------------------------------------------------------- drawing
  function shine(c, x, y, t) {
    const k = (Math.sin(t * 0.15) + 1) / 2;
    c.globalAlpha = 0.5 * k; c.fillStyle = '#fff';
    c.beginPath(); c.moveTo(x, y - 5); c.lineTo(x + 1.2, y - 1.2); c.lineTo(x + 5, y); c.lineTo(x + 1.2, y + 1.2);
    c.lineTo(x, y + 5); c.lineTo(x - 1.2, y + 1.2); c.lineTo(x - 5, y); c.lineTo(x - 1.2, y - 1.2); c.closePath(); c.fill();
    c.globalAlpha = 1;
  }

  const I = BK.itemDefs = {
    bread: { kind: 'food', name: '黒パン', heal: 0.15, draw(c, x, y) {
      c.fillStyle = '#7a4a22'; c.beginPath(); c.ellipse(x, y - 5, 10, 6, 0, 0, 7); c.fill();
      c.strokeStyle = '#3a220e'; c.lineWidth = 1; c.stroke();
      c.strokeStyle = '#b07a40'; c.beginPath(); c.moveTo(x - 5, y - 8); c.lineTo(x - 2, y - 3); c.moveTo(x + 1, y - 9); c.lineTo(x + 4, y - 4); c.stroke();
    } },
    wine: { kind: 'food', name: '葡萄酒', heal: 0.22, draw(c, x, y) {
      c.fillStyle = '#3a1a2a'; c.beginPath(); c.ellipse(x, y - 7, 6, 8, 0, 0, 7); c.fill();
      c.fillRect(x - 2, y - 20, 4, 7); c.fillStyle = '#c7a26a'; c.fillRect(x - 2.5, y - 21, 5, 2);
      c.fillStyle = 'rgba(255,255,255,0.35)'; c.fillRect(x - 3, y - 11, 1.5, 6);
    } },
    meat: { kind: 'food', name: '干し肉', heal: 0.35, draw(c, x, y) {
      c.fillStyle = '#e8dcc8'; c.fillRect(x + 4, y - 7, 9, 3);
      c.beginPath(); c.arc(x + 13, y - 7, 2.2, 0, 7); c.arc(x + 13, y - 4, 2.2, 0, 7); c.fill();
      c.fillStyle = '#8a2e1c'; c.beginPath(); c.ellipse(x - 2, y - 6, 9, 6.5, -0.3, 0, 7); c.fill();
      c.strokeStyle = '#3d0f08'; c.lineWidth = 1; c.stroke();
      c.fillStyle = '#b8543a'; c.beginPath(); c.ellipse(x - 4, y - 8, 4, 2.2, -0.3, 0, 7); c.fill();
    } },
    roast: { kind: 'food', name: '猪の丸焼き', heal: 0.7, draw(c, x, y) {
      c.fillStyle = '#6e5a44'; c.beginPath(); c.ellipse(x, y - 2, 16, 4, 0, 0, 7); c.fill();
      c.fillStyle = '#9a4a20'; c.beginPath(); c.ellipse(x, y - 9, 13, 8, 0, 0, 7); c.fill();
      c.strokeStyle = '#4a1c08'; c.lineWidth = 1; c.stroke();
      c.fillStyle = '#c8783a'; c.beginPath(); c.ellipse(x - 3, y - 12, 6, 3, -0.2, 0, 7); c.fill();
      c.fillStyle = '#5a2a10'; c.beginPath(); c.arc(x + 12, y - 11, 4, 0, 7); c.fill();
    } },
    dust: { kind: 'food', name: '妖精の鱗粉', heal: 1, draw(c, x, y, t) {
      const k = (Math.sin(t * 0.2) + 1) / 2;
      const g = c.createRadialGradient(x, y - 10, 0, x, y - 10, 14);
      g.addColorStop(0, 'rgba(255,255,220,0.95)'); g.addColorStop(0.5, `rgba(160,255,200,${0.4 + k * 0.3})`); g.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = g; c.beginPath(); c.arc(x, y - 10, 14, 0, 7); c.fill();
      c.fillStyle = '#e8d9a8'; c.beginPath(); c.ellipse(x, y - 8, 4, 5, 0, 0, 7); c.fill();
      c.fillStyle = '#a07a4a'; c.fillRect(x - 2, y - 15, 4, 3);
    } },
    silver: { kind: 'score', name: '銀貨', score: 500, draw(c, x, y, t) {
      c.fillStyle = '#c9ccd2'; c.beginPath(); c.ellipse(x, y - 5, 5 * Math.abs(Math.cos(t * 0.08)) + 1, 5, 0, 0, 7); c.fill();
      c.strokeStyle = '#6a6e76'; c.lineWidth = 1; c.stroke();
    } },
    gold: { kind: 'score', name: '金貨袋', score: 1500, draw(c, x, y, t) {
      c.fillStyle = '#6a4a2a'; c.beginPath(); c.ellipse(x, y - 7, 8, 7, 0, 0, 7); c.fill();
      c.fillStyle = '#4a3018'; c.fillRect(x - 3, y - 16, 6, 4);
      c.fillStyle = '#ffd54a'; c.beginPath(); c.arc(x - 2, y - 13, 2.5, 0, 7); c.arc(x + 3, y - 12, 2.5, 0, 7); c.fill();
      shine(c, x + 4, y - 12, t);
    } },
    gem: { kind: 'score', name: '紅玉', score: 3000, draw(c, x, y, t) {
      R.poly(c, [x, y - 16, x + 7, y - 9, x, y - 1, x - 7, y - 9], '#c01030', '#4a0010');
      R.poly(c, [x, y - 16, x + 3, y - 9, x, y - 4, x - 3, y - 9], '#ff5a70');
      shine(c, x + 2, y - 12, t);
    } },
    behelit: { kind: 'score', name: 'ベヘリット', score: 10000, draw(c, x, y, t) {
      // 覇王の卵: 目鼻口が不規則に並ぶ赤い卵
      c.fillStyle = '#8a1a1a'; c.beginPath(); c.ellipse(x, y - 9, 7, 9, 0, 0, 7); c.fill();
      c.strokeStyle = '#2a0404'; c.lineWidth = 1; c.stroke();
      c.fillStyle = '#1a0202';
      c.beginPath(); c.ellipse(x - 3, y - 12, 1.6, 1, 0.3, 0, 7); c.fill();
      c.beginPath(); c.ellipse(x + 2.5, y - 9, 1.3, 1, -0.2, 0, 7); c.fill();
      c.beginPath(); c.ellipse(x - 1, y - 5, 2.5, 0.9, 0.1, 0, 7); c.fill();
      c.fillStyle = '#ff6060'; c.beginPath(); c.arc(x - 3, y - 12, 0.6, 0, 7); c.fill();
      shine(c, x + 3, y - 14, t);
    } },
    // ------ サブ武器（射撃ボタンで使用。弾切れで消える）
    bowgun: { kind: 'weapon', name: '連射式ボウガン', ammo: 40, draw(c, x, y) {
      c.strokeStyle = '#3a2616'; c.lineWidth = 3; c.beginPath(); c.moveTo(x - 10, y - 6); c.lineTo(x + 10, y - 6); c.stroke();
      c.strokeStyle = '#9a9a9a'; c.lineWidth = 2; c.beginPath(); c.moveTo(x + 6, y - 14); c.quadraticCurveTo(x + 2, y - 6, x + 6, y + 2); c.stroke();
      c.fillStyle = '#6a4a2a'; c.fillRect(x - 6, y - 10, 8, 5);
    }, fire(h) {
      BK.heroShots.bolt(h, { dmg: 5, spd: 12, col: '#e8e0c0' });
      BK.audio.sfx('shoot');
      return 6; // 次弾までのフレーム
    } },
    bombs: { kind: 'weapon', name: '炸裂弾', ammo: 6, draw(c, x, y) {
      c.fillStyle = '#2a2a2e'; c.beginPath(); c.arc(x, y - 7, 7, 0, 7); c.fill();
      c.strokeStyle = '#000'; c.lineWidth = 1; c.stroke();
      c.strokeStyle = '#b89a6a'; c.beginPath(); c.moveTo(x + 3, y - 13); c.quadraticCurveTo(x + 7, y - 18, x + 10, y - 16); c.stroke();
      c.fillStyle = '#ffb040'; c.beginPath(); c.arc(x + 10, y - 16, 1.8, 0, 7); c.fill();
    }, fire(h) {
      BK.heroShots.bomb(h);
      BK.audio.sfx('jump');
      return 22;
    } },
    firepot: { kind: 'weapon', name: '火炎壺', ammo: 5, draw(c, x, y) {
      c.fillStyle = '#8a5a3a'; c.beginPath(); c.ellipse(x, y - 7, 7, 7, 0, 0, 7); c.fill();
      c.strokeStyle = '#3a1a0a'; c.lineWidth = 1; c.stroke();
      c.fillStyle = '#6a3a1a'; c.fillRect(x - 3, y - 16, 6, 4);
      c.fillStyle = '#ff7a2a'; c.beginPath(); c.moveTo(x - 2, y - 16); c.quadraticCurveTo(x, y - 24, x + 2, y - 16); c.fill();
    }, fire(h) {
      BK.heroShots.firepot(h);
      BK.audio.sfx('jump');
      return 24;
    } },
    knives: { kind: 'weapon', name: '投げナイフ', ammo: 16, draw(c, x, y) {
      for (let i = 0; i < 3; i++) {
        c.save(); c.translate(x - 4 + i * 4, y - 6); c.rotate(-0.6 + i * 0.3);
        c.fillStyle = '#cfd2d6'; c.fillRect(0, -1, 10, 2); c.fillStyle = '#3a2616'; c.fillRect(-4, -1.2, 4, 2.4);
        c.restore();
      }
    }, fire(h) {
      BK.heroShots.knife(h, { dmg: 7, spd: 11 });
      BK.audio.sfx('knife');
      return 9;
    } },
    spear: { kind: 'weapon', name: '投げ槍', ammo: 3, draw(c, x, y) {
      c.strokeStyle = '#5a3a1a'; c.lineWidth = 2.4; c.beginPath(); c.moveTo(x - 16, y - 4); c.lineTo(x + 12, y - 8); c.stroke();
      R.poly(c, [x + 12, y - 11, x + 21, y - 9, x + 12, y - 5], '#c8ccd0', '#333');
    }, fire(h) {
      BK.heroShots.spear(h);
      BK.audio.sfx('swingHeavy');
      return 26;
    } },
  };

  /** 敵が落とすアイテムのテーブル（重み付き） */
  BK.dropTable = {
    // 武器は主に樽・木箱から（AvP 同様）。雑魚からはたまに
    common: [[64, null], [10, 'bread'], [6, 'wine'], [10, 'silver'], [4, 'gold'], [1, 'knives'], [1, 'bowgun'], [1, 'bombs'], [1, 'spear']],
    prop: [[16, 'bread'], [12, 'meat'], [10, 'wine'], [3, 'roast'], [14, 'silver'], [8, 'gold'], [3, 'gem'], [1, 'behelit'], [6, 'bowgun'], [5, 'bombs'], [4, 'firepot'], [6, 'knives'], [4, 'spear']],
  };

  // --------------------------------------------------------- item entity
  class Item {
    constructor(id, x, y, z) {
      this.id = id; this.def = I[id]; this.x = x; this.y = y; this.z = z || 0;
      this.vz = z ? 3 : 4; this.vx = U.rand(-1, 1); this.t = 0; this.remove = false; this.life = 60 * 25;
    }
    update(game) {
      this.t++;
      if (this.z > 0 || this.vz > 0) {
        this.z += this.vz; this.vz -= 0.4; this.x += this.vx;
        // 着地点は画面内に収める（カメラは戻らないので、画面外に落ちると拾えなくなる）
        if (this.z <= 0) { this.z = 0; this.vz = 0; this.vx = 0; this.x = U.clamp(this.x, BK.cam.x + 24, BK.cam.x + BK.W - 24); }
      }
      if (--this.life <= 0) this.remove = true;
      const h = game.hero;
      if (!h || h.dead || this.t < 14 || this.z > 10) return;
      if (h.state === 'grabbed' || h.state === 'down' || h.state === 'fall') return;
      if (Math.abs(h.x - this.x) < 20 && Math.abs(h.y - this.y) < 12) {
        // 別の武器を持っている時は自動で持ち替えない（上に立って 射 で持ち替え）
        if (this.def.kind === 'weapon' && h.sub && h.sub.id !== this.id && !h.ctrl.pressed.sht) {
          if (!this.hinted) { this.hinted = true; BK.fx.text(this.x, this.y, 40, '射で持ち替え', '#ffd0a0', 11); }
          return;
        }
        this.pickup(h, game);
      }
    }
    pickup(h, game) {
      const d = this.def;
      if (d.kind === 'food') {
        if (h.hp >= h.maxHp) { game.addScore(500); BK.fx.text(this.x, this.y, 40, '+500', '#ffe08a', 12); }
        else { const amt = Math.round(h.maxHp * d.heal); h.hp = Math.min(h.maxHp, h.hp + amt); BK.fx.text(this.x, this.y, 40, d.name, '#9cff9c', 12); }
        BK.audio.sfx('heal');
      } else if (d.kind === 'score') {
        game.addScore(d.score); BK.fx.text(this.x, this.y, 40, '+' + d.score, '#ffe08a', 13);
        BK.audio.sfx('coin');
      } else if (d.kind === 'weapon') {
        if (h.sub && h.sub.id === this.id) h.sub.ammo = Math.min(d.ammo * 2, h.sub.ammo + d.ammo);
        else h.sub = { id: this.id, ammo: d.ammo };
        BK.fx.text(this.x, this.y, 40, d.name, '#ffd0a0', 12);
        BK.audio.sfx('pickup');
      }
      this.remove = true;
    }
    draw(c) {
      if (this.life < 180 && (this.t >> 3) % 2) return; // 消える前に点滅
      const sx = BK.sx(this.x), sy = BK.sy(this.y, this.z);
      c.fillStyle = 'rgba(0,0,0,0.35)';
      c.beginPath(); c.ellipse(sx, BK.sy(this.y, 0), 9, 2.5, 0, 0, 7); c.fill();
      this.def.draw(c, sx, sy, this.t);
    }
  }
  BK.Item = Item;

  // --------------------------------------------------------- breakables
  const P = BK.propDefs = {
    barrel: { name: '樽', hp: 18, w: 26, h: 34, debris: ['#6a4526', '#4a2e18', '#8a8a8a'], draw(c, x, y, p) {
      c.fillStyle = '#6a4526'; c.beginPath(); c.ellipse(x, y - 17, 13, 17, 0, 0, 7); c.fill();
      c.fillStyle = '#58381e'; c.fillRect(x - 13, y - 30, 26, 26);
      c.fillStyle = '#7a5230'; c.beginPath(); c.ellipse(x, y - 31, 12, 4, 0, 0, 7); c.fill();
      c.strokeStyle = '#2e1a0c'; c.lineWidth = 1; c.stroke();
      c.fillStyle = '#707070'; c.fillRect(x - 13, y - 26, 26, 2.5); c.fillRect(x - 13, y - 10, 26, 2.5);
      c.strokeStyle = 'rgba(0,0,0,0.35)'; c.beginPath(); for (let i = -8; i <= 8; i += 6) { c.moveTo(x + i, y - 30); c.lineTo(x + i, y - 3); } c.stroke();
    } },
    crate: { name: '木箱', hp: 16, w: 30, h: 30, debris: ['#7a5a36', '#5a3e22'], draw(c, x, y) {
      R.poly(c, [x - 15, y - 30, x + 15, y - 30, x + 15, y, x - 15, y], '#7a5a36', '#2e1e0e');
      R.poly(c, [x - 15, y - 30, x - 9, y - 36, x + 21, y - 36, x + 15, y - 30], '#8e6c44', '#2e1e0e');
      R.poly(c, [x + 15, y - 30, x + 21, y - 36, x + 21, y - 6, x + 15, y], '#5a3e22', '#2e1e0e');
      c.strokeStyle = '#3e2a14'; c.lineWidth = 2; c.beginPath(); c.moveTo(x - 14, y - 29); c.lineTo(x + 14, y - 1); c.moveTo(x + 14, y - 29); c.lineTo(x - 14, y - 1); c.stroke();
    } },
    urn: { name: '壺', hp: 8, w: 20, h: 26, debris: ['#8a6a4a', '#5a4030'], draw(c, x, y) {
      c.fillStyle = '#7a5a3a'; c.beginPath(); c.moveTo(x - 6, y - 26); c.quadraticCurveTo(x - 16, y - 14, x - 7, y); c.lineTo(x + 7, y); c.quadraticCurveTo(x + 16, y - 14, x + 6, y - 26); c.closePath(); c.fill();
      c.strokeStyle = '#2e1e10'; c.lineWidth = 1; c.stroke();
      c.fillStyle = '#5a3e26'; c.fillRect(x - 7, y - 28, 14, 3);
      c.strokeStyle = '#a07a4a'; c.beginPath(); c.moveTo(x - 10, y - 14); c.lineTo(x + 10, y - 14); c.stroke();
    } },
    grave: { name: '墓標', hp: 22, w: 24, h: 36, metal: false, debris: ['#6a6a6e', '#4a4a50'], draw(c, x, y) {
      R.poly(c, [x - 10, y, x - 10, y - 26, x - 6, y - 34, x + 6, y - 34, x + 10, y - 26, x + 10, y], '#5e5e64', '#1e1e22');
      c.strokeStyle = '#2a2a30'; c.lineWidth = 2; c.beginPath(); c.moveTo(x, y - 30); c.lineTo(x, y - 12); c.moveTo(x - 6, y - 24); c.lineTo(x + 6, y - 24); c.stroke();
    } },
  };

  class Prop extends BK.Actor {
    constructor(id, x, y, itemId) {
      const d = P[id];
      super({ team: 'prop', x, y, hp: d.hp, maxHp: d.hp, w: d.w, h: d.h, weight: 99, shadowR: d.w * 0.6, metal: d.metal });
      this.pid = id; this.pdef = d; this.item = itemId === undefined ? U.weighted(BK.dropTable.prop) : itemId;
      this.isProp = true;
    }
    takeHit(src, h, dir) {
      if (this.dead) return false;
      this.hp -= h.dmg; this.flash = 6; this.wob = 8 * dir;
      if (this.hp <= 0) this.breakApart(dir);
      return true;
    }
    breakApart(dir) {
      this.dead = true; this.remove = true;
      BK.audio.sfx('hit', { pitch: 0.7 });
      for (let i = 0; i < 12; i++) {
        BK.fx.add({ type: 'dot', x: this.x + U.rand(-10, 10), y: this.y, z: U.rand(5, this.h), vx: dir * U.rand(0.5, 4) + U.rand(-1, 1), vz: U.rand(1, 5), g: 0.3, life: U.randi(25, 45), col: U.choose(this.pdef.debris), size: U.rand(2, 5) });
      }
      BK.fx.dust(this.x, this.y, 6);
      if (this.item && BK.game) BK.game.spawnItem(this.item, this.x, this.y, 16);
    }
    update() { if (this.flash > 0) this.flash--; if (this.wob) this.wob *= -0.7; if (Math.abs(this.wob || 0) < 0.3) this.wob = 0; }
    draw(c) {
      const sx = BK.sx(this.x) + (this.wob || 0) * 0.5, sy = BK.sy(this.y, 0);
      this.pdef.draw(c, sx, sy, this);
      if (this.flash > 0 && (this.flash & 2)) {
        c.globalAlpha = 0.5; c.fillStyle = '#fff'; c.fillRect(sx - this.w / 2, sy - this.h, this.w, this.h); c.globalAlpha = 1;
      }
    }
  }
  BK.Prop = Prop;
})(window.BK);

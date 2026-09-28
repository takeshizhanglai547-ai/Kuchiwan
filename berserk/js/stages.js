'use strict';
/* =====================================================================
 *  stages.js ── ステージ進行（カメラ・ウェーブ・ボス）と背景描画ヘルパー
 *
 *  ステージ定義: BK.stages[i] = {
 *    id: 1, name: '黒い剣士', sub: '紅い月の城下町', len: 3600,
 *    bgm: 'stage1', bossBgm: 'boss',
 *    intro: '物語のナレーション（2〜3行）',
 *    heal: 0.3,                                       // ステージ開始時の体力回復率
 *    autoscroll: { speed: 1.2, until: 3000 },         // 強制スクロール（任意）
 *    props: [{ x, y, type:'barrel', item:'meat' }],   // 壊せる物
 *    events: [                                        // カメラ位置 at で発動
 *      { at: 300, waves: [ [ {t:'undead', side:'R', y:40, delay:0, palette:'bone', entry:'rise', x:400}, ... ], [...] ], lock: true, next: 0 },
 *      { at: 3000, boss: 'snakeBaron', x: 520, y: 60, waves: [[...minions]] },
 *    ],
 *    init(game), update(game),                        // 任意
 *    drawBg(c, game), drawFg(c, game),                // 背景 / 前景
 *    floorTint,                                       // 任意
 *  }
 *  spawn の side: 'R' 右画面外 / 'L' 左画面外 / x 指定で画面内（entry:'drop'|'rise'|'jump'）
 * ===================================================================== */
(function (BK) {
  const U = BK.U, C = BK.combat;

  // ================================================================ bg helpers
  const BG = BK.bg = {
    _cache: new Map(),
    /** オフスクリーンに一度だけ描いてキャッシュ（解像度変化で作り直し） */
    layer(key, w, h, fn) {
      const rs = Math.min(BK.renderScale, 2);
      const k = key + '@' + rs.toFixed(2);
      let cv = this._cache.get(k);
      if (cv) { this._cache.delete(k); this._cache.set(k, cv); } // LRU: 最近使ったものを末尾へ
      if (!cv) {
        // 解像度が変わったら古い倍率のキャッシュは捨てる
        if (this._rs !== rs) { this._rs = rs; for (const key of Array.from(this._cache.keys())) if (!key.endsWith('@' + rs.toFixed(2))) this._cache.delete(key); }
        cv = document.createElement('canvas');
        cv.width = Math.ceil(w * rs); cv.height = Math.ceil(h * rs);
        const c = cv.getContext('2d');
        c.scale(rs, rs);
        fn(c, w, h);
        cv.lw = w; cv.lh = h;
        this._cache.set(k, cv);
        if (this._cache.size > 48) this._cache.delete(this._cache.keys().next().value);
      }
      return cv;
    },
    /** 横方向にループするレイヤーを視差スクロールで描く */
    tile(c, cv, factor, y, offset) {
      const w = cv.lw;
      let x = -((BK.cam.x * factor + (offset || 0)) % w);
      if (x > 0) x -= w;
      for (; x < BK.W; x += w) c.drawImage(cv, x, y, w, cv.lh);
    },
    /** 縦グラデーションの空 */
    sky(c, stops, y0, y1) {
      const g = c.createLinearGradient(0, y0 || 0, 0, y1 || BK.FLOOR_TOP);
      stops.forEach((s, i) => g.addColorStop(s[0] != null ? s[0] : i / (stops.length - 1), s[1] || s));
      c.fillStyle = g; c.fillRect(0, y0 || 0, BK.W, (y1 || BK.FLOOR_TOP) - (y0 || 0));
    },
    /** 石畳の床（パースつき）: 画面座標で描く */
    cobbles(c, o) {
      o = o || {};
      const top = BK.FLOOR_TOP - 14, H = BK.H;
      const g = c.createLinearGradient(0, top, 0, H);
      g.addColorStop(0, o.far || '#221a1a'); g.addColorStop(1, o.near || '#3a2c28');
      c.fillStyle = g; c.fillRect(0, top, BK.W, H - top);
      c.strokeStyle = o.line || 'rgba(0,0,0,0.45)'; c.lineWidth = 1;
      // 奥行きライン
      let rowY = top, rowH = 7, row = 0;
      c.beginPath();
      while (rowY < H) {
        c.moveTo(0, rowY); c.lineTo(BK.W, rowY);
        const bw = rowH * 2.6;
        const off = ((BK.cam.x + (row % 2) * bw * 0.5) % bw);
        for (let x = -off; x < BK.W; x += bw) { c.moveTo(x, rowY); c.lineTo(x, rowY + rowH); }
        rowY += rowH; rowH *= 1.16; row++;
      }
      c.stroke();
      if (o.shade !== false) {
        const s = c.createLinearGradient(0, top, 0, top + 40);
        s.addColorStop(0, 'rgba(0,0,0,0.55)'); s.addColorStop(1, 'rgba(0,0,0,0)');
        c.fillStyle = s; c.fillRect(0, top, BK.W, 40);
      }
    },
    /** 霧（画面全体に流れる） */
    fog(c, t, col, alpha, y) {
      c.save();
      c.globalAlpha = alpha || 0.18;
      c.fillStyle = col || '#8a8090';
      for (let i = 0; i < 5; i++) {
        const x = ((t * (0.2 + i * 0.07) + i * 260 - BK.cam.x * 0.3) % (BK.W + 400)) - 200;
        const yy = (y || BK.FLOOR_TOP - 20) + Math.sin(t * 0.01 + i) * 10 + i * 18;
        c.beginPath(); c.ellipse(x, yy, 180, 26, 0, 0, 7); c.fill();
      }
      c.restore();
    },
    /** 画面の周辺減光 */
    vignette(c, strength) {
      const g = c.createRadialGradient(BK.W / 2, BK.H * 0.55, BK.H * 0.3, BK.W / 2, BK.H * 0.55, BK.W * 0.75);
      g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, `rgba(0,0,0,${strength || 0.6})`);
      c.fillStyle = g; c.fillRect(0, 0, BK.W, BK.H);
    },
    /** 雨 */
    rain(c, t, n, col) {
      c.strokeStyle = col || 'rgba(170,180,200,0.35)'; c.lineWidth = 1;
      c.beginPath();
      for (let i = 0; i < (n || 60); i++) {
        const x = (i * 97 + t * 3 - BK.cam.x * 0.2) % (BK.W + 40) - 20;
        const y = (i * 53 + t * 11) % (BK.H + 40) - 20;
        c.moveTo(x, y); c.lineTo(x - 4, y + 12);
      }
      c.stroke();
    },
  };

  // ================================================================ Game
  class Game {
    constructor(heroId, opt) {
      opt = opt || {};
      this.heroId = heroId;
      this.stageIdx = opt.stage || 0;
      this.score = 0;
      this.continues = 0;
      this.diffMul = 1;
      this.hero = null;
      this.hiscore = BK.save.get('hiscore', 50000);
      this.totalKills = 0;
      BK.game = this;
    }
    // ------------------------------------------------------------ setup
    loadStage(idx) {
      this.stageIdx = idx;
      const st = this.stage = BK.stages[idx];
      if (!st) throw new Error('stage ' + idx + ' missing');
      this.actors = []; this.projectiles = []; this.items = [];
      C.tokens = 0;
      BK.fx.reset();
      BK.cam.x = 0; this.camMin = 0;
      this.lock = null; this.lockEnemies = null;
      this.events = (st.events || []).map(e => Object.assign({ done: false }, e)).sort((a, b) => a.at - b.at);
      this.evIdx = 0;
      this.boss = null; this.bossDefeated = false; this.clearT = 0;
      this.time = 0; this.kills = 0; this.damageTaken = 0;
      this.freezeT = 0; this.freezer = null;
      this.banners = []; this.goT = 0; this.combo = 0; this.comboT = 0; this.maxCombo = 0;
      this.lastHitEnemy = null;
      this.continueT = 0; this.over = false;
      const def = BK.heroes[this.heroId];
      if (!this.hero) this.hero = new BK.Hero(def, 90, BK.DEPTH * 0.55);
      const h = this.hero;
      if (h.awkT > 0 && def.awaken && def.awaken.end) def.awaken.end(h);
      if (h.move) h.endMove();
      h.x = 90; h.y = BK.DEPTH * 0.55; h.z = 0; h.vx = h.vy = h.vz = 0; h.state = 'idle'; h.move = null;
      h.face = 1; h.dead = false; h.invul = 60; h.grabbing = null; h.grabbedBy = null; h.hitCount = 0;
      h.awkT = 0; h.dmgMul = 1; h.speedMul = 1; h.superArmor = 0; h.dmgTakenMul = 1; h.reloading = 0; h.ammo = def.shot.max;
      if (idx > 0) h.hp = Math.min(h.maxHp, h.hp + Math.round(h.maxHp * (st.heal == null ? 0.35 : st.heal)));
      this.actors.push(h);
      for (const p of st.props || []) this.spawnProp(p.type || 'barrel', p.x, p.y, p.item);
      if (st.init) st.init(this);
      BK.audio.playSong(st.bgm || 'stage1');
    }
    // ------------------------------------------------------------ spawners
    spawnEnemy(id, o) {
      o = o || {};
      let def = BK.enemyTypes[id];
      if (!def) { console.warn('unknown enemy', id); def = BK.enemyTypes.undead; }
      let x = o.x, y = o.y != null ? o.y : U.rand(8, BK.DEPTH - 8);
      let entry = o.entry || def.entry || 'walk';
      if (o.side === 'R') { x = BK.cam.x + BK.W + 30 + (o.off || 0); entry = o.entry || (def.entry === 'rise' || def.entry === 'drop' ? 'walk' : def.entry || 'walk'); }
      else if (o.side === 'L') { x = BK.cam.x - 30 - (o.off || 0); entry = o.entry || (def.entry === 'rise' || def.entry === 'drop' ? 'walk' : def.entry || 'walk'); }
      else if (x == null) x = BK.cam.x + U.rand(80, BK.W - 80);
      else if (o.screen) x = BK.cam.x + x;
      const e = new BK.Enemy(def, x, y, Object.assign({}, o, { entry }));
      e.face = x > (this.hero ? this.hero.x : 0) ? -1 : 1;
      if (o.hp) { e.hp = e.maxHp = o.hp; }
      this.actors.push(e);
      if (def.onSpawn) def.onSpawn(e, this);
      if (this.stage && this.stage.onSpawn) this.stage.onSpawn(e, this);
      if (entry === 'rise') BK.audio.sfx('growl', { pitch: 0.6, vol: 0.5 });
      return e;
    }
    spawnProp(type, x, y, item) {
      if (!BK.propDefs[type]) type = 'barrel';
      const p = new BK.Prop(type, x, y, item);
      this.actors.push(p);
      return p;
    }
    spawnItem(id, x, y, z) {
      if (!BK.itemDefs[id]) return null;
      const it = new BK.Item(id, x, U.clamp(y, 2, BK.DEPTH - 2), z);
      this.items.push(it);
      return it;
    }
    addProjectile(p) { this.projectiles.push(p); return p; }
    addScore(n) {
      this.score += n;
      if (this.score > this.hiscore) this.hiscore = this.score;
    }
    get displayScore() { return this.score * 10 + Math.min(9, this.continues); }
    banner(text, col, sub, dur) { this.banners.push({ text, col: col || '#fff', sub, t: 0, dur: dur || 110 }); }
    freeze(n, who) { this.freezeT = n; this.freezer = who; }
    enemies() { return this.actors.filter(a => a.team === 'enemy' && !a.dead); }
    findGrabbable(h) {
      for (const e of this.actors) {
        if (e.team !== 'enemy' || e.dead || !e.grabbable || e.z > 2 || e.move || e.intangible) continue;
        if (e.state !== 'idle' && e.state !== 'walk' && e.state !== 'hurt') continue;
        if (Math.abs(e.y - h.y) > 9) continue;
        const d = (e.x - h.x) * h.face;
        if (d > 0 && d < (h.w + e.w) / 2 + 8) return e;
      }
      return null;
    }
    // ------------------------------------------------------------ hooks
    onHeroDealt(dmg) {
      this.addScore(dmg * 10);
      this.combo++; this.comboT = 70;
      if (this.combo > this.maxCombo) this.maxCombo = this.combo;
    }
    onHeroHurt(dmg) { this.damageTaken += dmg; this.combo = 0; }
    onEnemyKilled(e) {
      this.kills++; this.totalKills++;
      this.addScore(e.scoreValue || 100);
      if (e.boss) { this.onBossKilled(e); return; }
      const d = e.def;
      let drop = d.drop === undefined ? 'common' : d.drop;
      if (drop && BK.dropTable[drop]) drop = U.weighted(BK.dropTable[drop]);
      if (drop && BK.itemDefs[drop]) this.spawnItem(drop, e.x, e.y, 30);
    }
    onBossKilled(e) {
      if (this.bossDefeated) return;
      this.bossDefeated = true;
      this.clearT = 1;
      BK.fx.flash('#ffffff', 20); BK.fx.shake(10, 40); BK.fx.slowmo = 90;
      BK.audio.sfx('roar', { pitch: 0.8 }); BK.audio.stopSong(1.5);
      // 残りの敵も消滅
      for (const a of this.actors) if (a.team === 'enemy' && a !== e && !a.dead) { a.hp = 0; a.die(this.hero, { dmg: 99 }, U.sign(a.x - e.x || 1)); }
      this.addScore(e.def.bossBonus || 20000);
    }
    // ------------------------------------------------------------ update
    update() {
      const fx = BK.fx;
      this.time++;
      if (this.banners.length) { for (const b of this.banners) b.t++; this.banners = this.banners.filter(b => b.t < b.dur); }
      if (fx.hitstop > 0) { fx.hitstop--; fx.shakeT > 0 && fx.update(); return; }
      if (fx.slowmo > 0) { fx.slowmo--; if (fx.slowmo % 2) { fx.update(); return; } }
      const h = this.hero;
      if (BK.autoplay) BK.autoCtrl.think(this);
      // 覚醒演出中は周囲が止まる
      if (this.freezeT > 0) {
        this.freezeT--;
        fx.darken = Math.min(0.55, fx.darken + 0.05);
        if (this.freezer) this.freezer.update(this);
        fx.update();
        return;
      }
      fx.darken = Math.max(0, fx.darken - 0.05);
      for (let i = 0; i < this.actors.length; i++) {
        const a = this.actors[i];
        if (a.remove) continue;
        a.update(this);
      }
      C.resolve(this.actors);
      for (const p of this.projectiles) p.update(this.actors);
      this.projectiles = this.projectiles.filter(p => !p.remove);
      for (const it of this.items) it.update(this);
      this.items = this.items.filter(it => !it.remove);
      // 除去
      if (this.actors.some(a => a.remove)) {
        this.actors = this.actors.filter(a => !a.remove || a === h);
      }
      if (this.comboT > 0 && --this.comboT === 0) this.combo = 0;
      this.updateCamera();
      this.updateEvents();
      if (this.stage.update) this.stage.update(this);
      fx.update();
      this.updateHeroLife();
      if (this.clearT > 0) {
        this.clearT++;
        const cd = (this.boss && this.boss.def && this.boss.def.clearDelay) || 60;
        if (this.clearT === cd) { this.banner('STAGE CLEAR', '#ffd27a', null, 200); BK.audio.playSong('clear'); }
        if (this.clearT > cd + 170 && BK.scene && BK.scene.onStageClear) BK.scene.onStageClear();
      }
    }
    updateCamera() {
      const h = this.hero, st = this.stage;
      let maxX = Math.max(0, st.len - BK.W);
      if (this.lock) maxX = Math.min(maxX, this.lock.at);
      if (st.autoscroll && !this.lock && BK.cam.x < (st.autoscroll.until || maxX)) {
        BK.cam.x = Math.min(maxX, BK.cam.x + st.autoscroll.speed);
        // 主人公が遅れたら押し出す
      }
      let target = h.x - BK.W * 0.42;
      target = U.clamp(target, this.camMin, maxX);
      if (target > BK.cam.x) BK.cam.x = Math.min(target, BK.cam.x + 5);
      BK.cam.x = U.clamp(BK.cam.x, 0, Math.max(0, st.len - BK.W));
      this.camMin = BK.cam.x;
      // 主人公は画面内
      const minX = BK.cam.x + 14, maxHX = BK.cam.x + BK.W - 14;
      if (h.x < minX) { h.x = minX; if (st.autoscroll && h.state !== 'dead') h.vx = Math.max(h.vx, 0); }
      if (h.x > maxHX) h.x = maxHX;
      // GO 表示
      if (this.goT > 0) this.goT--;
    }
    updateEvents() {
      // 発動チェック
      while (this.evIdx < this.events.length && !this.lock) {
        const ev = this.events[this.evIdx];
        if (BK.cam.x + 0.5 < ev.at && !(ev.at > Math.max(0, this.stage.len - BK.W) && BK.cam.x >= this.stage.len - BK.W - 1)) break;
        this.evIdx++;
        this.startEvent(ev);
        if (ev.lock === false) continue;
        break;
      }
      // 進行中のロック
      const L = this.lock;
      if (!L) return;
      L.t++;
      const alive = L.spawned.filter(e => !e.dead && !e.remove).length;
      const pending = L.queue.length;
      // 遅延スポーン
      for (let i = L.queue.length - 1; i >= 0; i--) {
        const q = L.queue[i];
        if (--q.delay <= 0) { L.queue.splice(i, 1); L.spawned.push(this.spawnEnemy(q.t, q)); }
      }
      if (alive === 0 && pending === 0) {
        if (L.wave < L.ev.waves.length) {
          if (++L.gap > 30) this.spawnWave(L);
        } else if (!L.ev.boss || this.bossDefeated) {
          this.lock = null;
          if (L.ev.onClear) L.ev.onClear(this);
          if (!L.ev.boss && !this.stage.noGo && this.evIdx < this.events.length) { this.goT = 180; BK.audio.sfx('select', { pitch: 0.8 }); }
        }
      } else if (L.ev.next != null && alive <= L.ev.next && pending === 0 && L.wave < L.ev.waves.length) {
        this.spawnWave(L);
      }
    }
    startEvent(ev) {
      if (ev.onStart) ev.onStart(this);
      if (ev.text) this.banner(ev.text, '#e9dccb', ev.sub, 150);
      const L = { ev, wave: 0, spawned: [], queue: [], t: 0, gap: 99, at: Math.min(ev.at, Math.max(0, this.stage.len - BK.W)) };
      if (ev.lock === false) {
        // ロックしない散発的な出現
        const tmp = { ev, wave: 0, spawned: [], queue: [] };
        (ev.waves || []).forEach((w, i) => w.forEach(s => this.spawnEnemy(s.t, Object.assign({}, s))));
        return tmp;
      }
      this.lock = L;
      if (ev.boss) {
        const def = BK.enemyTypes[ev.boss];
        if (def) {
          const b = this.spawnEnemy(ev.boss, { x: BK.cam.x + (ev.x != null ? ev.x : BK.W - 120), y: ev.y != null ? ev.y : BK.DEPTH * 0.5, entry: ev.entry || def.entry || 'walk' });
          b.boss = true;
          this.boss = b;
          L.spawned.push(b);
          BK.audio.playSong(this.stage.bossBgm || 'boss');
          this.banner(def.name, '#ff5040', def.title || 'BOSS', 170);
          BK.audio.sfx('roar');
        } else { this.bossDefeated = true; this.clearT = 1; }
      }
      if (ev.waves && ev.waves.length) this.spawnWave(L);
      return L;
    }
    spawnWave(L) {
      const w = L.ev.waves[L.wave++];
      L.gap = 0;
      if (!w) return;
      for (const s of w) {
        if (s.delay) L.queue.push(Object.assign({}, s));
        else L.spawned.push(this.spawnEnemy(s.t, Object.assign({}, s)));
      }
    }
    updateHeroLife() {
      const h = this.hero;
      if (!h.dead || this.clearT) return;
      if (h.state === 'dead' && h.st > 70) {
        if (h.lives > 0) {
          h.lives--;
          h.respawn(BK.cam.x + 110);
        } else if (!this.over) {
          this.over = true;
          if (BK.scene && BK.scene.onGameOver) BK.scene.onGameOver();
        }
      }
    }
    continueGame() {
      this.continues++;
      this.over = false;
      const h = this.hero;
      h.lives = 2;
      h.respawn(BK.cam.x + 110);
      h.awk = 50;
    }
    // ------------------------------------------------------------ draw
    draw(c) {
      const st = this.stage;
      c.save();
      if (st.drawBg) st.drawBg(c, this); else { c.fillStyle = '#201818'; c.fillRect(0, 0, BK.W, BK.H); BG.cobbles(c); }
      // 影
      for (const a of this.actors) a.drawShadow(c);
      for (const p of this.projectiles) p.drawShadow(c);
      for (const a of this.actors) if (a.def && a.def.drawFloor && !a.remove) a.def.drawFloor(c, a);
      for (const it of this.items) it.draw(c);
      // 奥→手前の順に描く
      const list = this.actors.slice().sort((a, b) => (a.y - b.y) || ((a.drawLayer || 0) - (b.drawLayer || 0)));
      for (const a of list) a.draw(c);
      for (const p of this.projectiles) p.draw(c);
      BK.fx.draw(c);
      if (st.drawFg) st.drawFg(c, this);
      c.restore();
      BK.fx.drawScreen(c);
      // 覚醒・変身演出中はその主役だけ暗転の上に描く
      if (this.freezeT > 0 && this.freezer && !this.freezer.remove) { this.freezer.draw(c); if (this.freezer.drawTrail) this.freezer.drawTrail(c); }
      if (BK.fx.screenFx) for (const f of BK.fx.screenFx) f(c);
    }
  }
  BK.Game = Game;
})(window.BK);

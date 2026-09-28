'use strict';
/* =====================================================================
 *  ui.js ── シーン（タイトル / キャラ選択 / ラウンド紹介 / プレイ / クリア / エンディング）と HUD
 * ===================================================================== */
(function (BK) {
  const U = BK.U, R = BK.rig;
  const T = (c, s, x, y, o) => BK.text(c, s, x, y, o);
  const RED = '#c4161f', INK = '#e9dccb', DIM = '#8d8479', GOLD = '#e0b060';

  /** 画面上のボタン（タップ判定つき） */
  function button(c, id, label, x, y, w, h, opt) {
    opt = opt || {};
    const sel = opt.sel;
    c.save();
    c.fillStyle = sel ? 'rgba(150,20,24,0.85)' : 'rgba(20,10,10,0.75)';
    c.strokeStyle = sel ? '#ffb08a' : 'rgba(200,140,110,0.6)'; c.lineWidth = 1.5;
    c.beginPath(); c.rect(x - w / 2, y - h / 2, w, h); c.fill(); c.stroke();
    c.restore();
    T(c, label, x, y + 1, { size: opt.size || 15, color: sel ? '#fff' : INK, weight: 800 });
    (button.zones || (button.zones = [])).push({ id, x0: x - w / 2, x1: x + w / 2, y0: y - h / 2, y1: y + h / 2 });
  }
  function hitZone(tap) {
    if (!tap || !button.zones) return null;
    for (const z of button.zones) if (tap.x >= z.x0 && tap.x <= z.x1 && tap.y >= z.y0 && tap.y <= z.y1) return z.id;
    return null;
  }
  function clearZones() { button.zones = []; }

  // 灰（舞い散る火の粉）の背景演出
  const ash = [];
  function drawAsh(c, n, col) {
    while (ash.length < (n || 50)) ash.push({ x: Math.random() * 800, y: Math.random() * 360, v: U.rand(0.2, 0.8), s: U.rand(0.8, 2.2), p: Math.random() * 6 });
    c.fillStyle = col || '#ff7040';
    for (const a of ash) {
      a.y -= a.v; a.x += Math.sin(a.p + a.y * 0.02) * 0.4;
      if (a.y < -5) { a.y = BK.H + 5; a.x = Math.random() * BK.W; }
      c.globalAlpha = 0.35 + Math.sin(a.p + BK.frame * 0.05) * 0.25;
      c.fillRect(a.x % BK.W, a.y, a.s, a.s);
    }
    c.globalAlpha = 1;
  }
  /** 日蝕（黒い太陽と紅いコロナ） */
  function drawEclipse(c, x, y, r, t) {
    const g = c.createRadialGradient(x, y, r * 0.9, x, y, r * 2.6);
    g.addColorStop(0, 'rgba(255,70,40,0.9)'); g.addColorStop(0.25, 'rgba(180,20,20,0.5)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g; c.beginPath(); c.arc(x, y, r * 2.6, 0, 7); c.fill();
    c.strokeStyle = 'rgba(255,200,160,0.7)'; c.lineWidth = 1.5;
    for (let i = 0; i < 24; i++) {
      const a = i / 24 * Math.PI * 2 + t * 0.002, l = r * (1.15 + (Math.sin(i * 7.3 + t * 0.03) + 1) * 0.12);
      c.beginPath(); c.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r); c.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); c.stroke();
    }
    c.fillStyle = '#050102'; c.beginPath(); c.arc(x, y, r, 0, 7); c.fill();
  }
  /** キャラクターをリグで大きく描く（選択画面・タイトル用） */
  function drawHeroFigure(c, def, x, y, s, t, opt) {
    opt = opt || {};
    c.save();
    c.translate(x, y); c.scale((opt.face || 1) * s * (def.spec.scale || 1), s * (def.spec.scale || 1));
    const pose = opt.pose || R.idle(def.stance, t);
    R.draw(c, pose, def.spec, { t, tint: opt.tint });
    c.restore();
  }
  BK.ui = { drawHeroFigure, drawEclipse, button };

  // ================================================================ title
  BK.scenes.title = {
    enter() { BK.setTouchUI(false); BK.audio.playSong('title'); this.t = 0; clearZones(); BK.autoplay = false; },
    update() {
      this.t++;
      const tap = BK.input.consumeTap();
      const z = hitZone(tap);
      if (z === 'sound') { BK.audio.unlock(); BK.audio.toggleMute(); return; }
      if (this.t > 20 && (BK.input.confirm() || tap)) {
        BK.audio.unlock(); BK.audio.sfx('confirm');
        BK.setScene('select');
      }
    },
    draw(c) {
      clearZones();
      const W = BK.W, H = BK.H, t = this.t;
      const g = c.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, '#070203'); g.addColorStop(0.7, '#230507'); g.addColorStop(1, '#3a0a0a');
      c.fillStyle = g; c.fillRect(0, 0, W, H);
      drawEclipse(c, W * 0.5, 118, 62, t);
      // 丘と剣士のシルエット
      c.fillStyle = '#050102';
      c.beginPath(); c.moveTo(0, H); c.lineTo(0, 300); c.quadraticCurveTo(W * 0.3, 262, W * 0.5, 268); c.quadraticCurveTo(W * 0.72, 274, W, 300); c.lineTo(W, H); c.fill();
      // 無数の剣が突き立つ丘
      c.strokeStyle = '#050102'; c.lineWidth = 2;
      for (let i = 0; i < 26; i++) { const x = (i * 71) % W, y = 290 + ((i * 37) % 30); c.beginPath(); c.moveTo(x, y); c.lineTo(x + ((i % 3) - 1) * 4, y - 16 - (i % 4) * 4); c.stroke(); }
      const guts = BK.heroes.guts;
      if (guts) drawHeroFigure(c, guts, W * 0.5, 272, 1.25, t, { tint: '#050102', pose: R.merge(guts.stance, { cape: 0.6 + Math.sin(t * 0.05) * 0.2 }) });
      drawAsh(c, 60);
      // タイトル
      const pulse = 0.85 + Math.sin(t * 0.05) * 0.15;
      T(c, 'BERSERK', W / 2, 212, { size: 64, fam: BK.FONT_GOTH, weight: 400, color: '#e8d6c0', stroke: '#5a0a0c', strokeW: 6, shadow: `rgba(255,40,20,${0.6 * pulse})`, shadowBlur: 18 });
      T(c, '黒い剣士  ─ 蝕の夜 ─', W / 2, 252, { size: 18, color: '#e9c9b0', stroke: '#1a0203', strokeW: 4, weight: 800 });
      T(c, 'BELT ACTION  /  非公式ファンメイド', W / 2, 30, { size: 11, color: DIM, weight: 600 });
      if ((t >> 5) % 2 === 0 || t < 20) T(c, BK.input.touchMode ? '画面をタップしてはじめる' : 'PRESS  ENTER  /  Z', W / 2, 318, { size: 15, color: INK, stroke: '#000', weight: 800 });
      T(c, 'HI-SCORE  ' + String(BK.save.get('hiscore', 50000) * 10).padStart(8, '0'), W / 2, 342, { size: 11, color: GOLD, weight: 600 });
      button(c, 'sound', BK.audio.muted ? '音: OFF' : '音: ON', W - 44, 22, 70, 24, { size: 11 });
    },
  };

  // ================================================================ select
  BK.scenes.select = {
    enter() {
      BK.setTouchUI(false);
      this.t = 0; this.done = 0;
      const last = BK.save.get('lastHero', 'guts');
      this.idx = Math.max(0, BK.heroOrder.indexOf(last));
      clearZones();
    },
    update() {
      this.t++;
      const I = BK.input, n = BK.heroOrder.length;
      if (this.done) { if (++this.done > 50) this.go(); return; }
      if (I.pressed.left || (I.dirX < 0 && I.prevDirX === 0 && I.ax)) { this.idx = (this.idx + n - 1) % n; BK.audio.sfx('select'); }
      if (I.pressed.right || (I.dirX > 0 && I.prevDirX === 0 && I.ax)) { this.idx = (this.idx + 1) % n; BK.audio.sfx('select'); }
      const tap = I.consumeTap();
      const z = hitZone(tap);
      if (z && z.startsWith('card')) {
        const i = +z.slice(4);
        if (i === this.idx && this.t > 10) this.confirm(); else { this.idx = i; BK.audio.sfx('select'); }
      } else if (z === 'ok') this.confirm();
      else if (z === 'back' || I.pressed.pause) BK.setScene('title');
      else if (this.t > 12 && (I.pressed.atk || I.pressed.start)) this.confirm();
    },
    confirm() {
      if (this.done) return;
      this.done = 1;
      BK.audio.sfx('confirm');
      BK.fx.flash('#ffffff', 8);
    },
    go() {
      const id = BK.heroOrder[this.idx];
      BK.save.set('lastHero', id);
      const game = new BK.Game(id, { stage: BK.startStage || 0 });
      BK.setScene('intro', { game, stage: BK.startStage || 0 });
    },
    draw(c) {
      clearZones();
      const W = BK.W, H = BK.H, t = this.t;
      const g = c.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, '#0b0405'); g.addColorStop(1, '#2a0808');
      c.fillStyle = g; c.fillRect(0, 0, W, H);
      drawAsh(c, 40, '#a03020');
      T(c, '剣士を選べ', W / 2, 22, { size: 18, color: INK, weight: 800, stroke: '#000' });
      const n = BK.heroOrder.length;
      const cw = Math.min(150, (W - 40) / n - 8), gap = 8;
      const x0 = W / 2 - (n * cw + (n - 1) * gap) / 2;
      BK.heroOrder.forEach((id, i) => {
        const def = BK.heroes[id];
        const x = x0 + i * (cw + gap), y = 42, h = 188;
        const sel = i === this.idx;
        c.fillStyle = sel ? 'rgba(90,12,14,0.8)' : 'rgba(20,8,8,0.7)';
        c.fillRect(x, y, cw, h);
        c.strokeStyle = sel ? '#ff9a6a' : 'rgba(160,100,80,0.45)'; c.lineWidth = sel ? 2 : 1;
        c.strokeRect(x, y, cw, h);
        c.save(); c.beginPath(); c.rect(x, y, cw, h); c.clip();
        const pose = sel && this.done ? (def.moves.atk1 ? R.sample(def.moves.atk1.kf, Math.min(this.done, 20), def.stance) : def.stance) : R.idle(def.stance, t + i * 30);
        drawHeroFigure(c, def, x + cw / 2 - 4, y + 150, sel ? 1.18 : 1.05, t, { pose, tint: sel ? null : null });
        if (!sel) { c.fillStyle = 'rgba(0,0,0,0.35)'; c.fillRect(x, y, cw, h); }
        c.restore();
        T(c, def.name, x + cw / 2, y + 162, { size: 16, color: sel ? '#fff' : INK, weight: 800, stroke: '#000' });
        T(c, def.title, x + cw / 2, y + 180, { size: 10, color: sel ? '#ffb89a' : DIM, weight: 600 });
        button.zones.push({ id: 'card' + i, x0: x, x1: x + cw, y0: y, y1: y + h });
      });
      // 能力値と説明
      const def = BK.heroes[BK.heroOrder[this.idx]];
      if (def) {
        const sx = W / 2 - 250, sy = 246;
        const labels = [['体力', 'life'], ['攻撃', 'power'], ['速さ', 'speed'], ['間合', 'reach'], ['射撃', 'shot']];
        labels.forEach(([lab, k], i) => {
          const yy = sy + i * 15;
          T(c, lab, sx + 14, yy, { size: 11, color: DIM, align: 'left' });
          for (let j = 0; j < 5; j++) {
            c.fillStyle = j < (def.stats[k] || 0) ? RED : 'rgba(255,255,255,0.12)';
            c.fillRect(sx + 48 + j * 17, yy - 5, 15, 9);
          }
        });
        const tx = sx + 150;
        wrapText(c, def.desc, tx, sy - 4, W / 2 + 250 - tx, 15, { size: 12, color: INK });
        T(c, '射撃: ' + def.shot.name + (def.shot.hint ? ' ─ ' + def.shot.hint : ''), tx, sy + 44, { size: 11, color: GOLD, align: 'left', maxW: W / 2 + 250 - tx });
        T(c, '覚醒: ' + (def.awaken ? def.awaken.name : '─'), tx, sy + 60, { size: 11, color: '#ff8a6a', align: 'left' });
      }
      button(c, 'ok', this.done ? '出陣' : '決定', W - 60, H - 22, 90, 28, { sel: true });
      button(c, 'back', '戻る', 50, H - 22, 70, 24, { size: 12 });
      if (this.done) { c.fillStyle = `rgba(0,0,0,${Math.min(1, this.done / 50)})`; c.fillRect(0, 0, W, H); }
    },
  };
  function wrapText(c, str, x, y, maxW, lh, o) {
    c.font = BK.font(o.size || 12, o.weight);
    let line = '', yy = y;
    for (const ch of str) {
      if (ch === '\n' || c.measureText(line + ch).width > maxW) { T(c, line, x, yy, Object.assign({ align: 'left' }, o)); yy += lh; line = ch === '\n' ? '' : ch; }
      else line += ch;
    }
    if (line) T(c, line, x, yy, Object.assign({ align: 'left' }, o));
    return yy;
  }
  BK.ui.wrapText = wrapText;

  // ================================================================ intro
  BK.scenes.intro = {
    enter(arg) {
      BK.setTouchUI(false);
      this.game = arg.game; this.stage = arg.stage; this.t = 0;
      this.def = BK.stages[this.stage];
      BK.audio.stopSong(0.5);
      BK.audio.sfx('bell');
    },
    update() {
      this.t++;
      const tap = BK.input.consumeTap();
      if ((this.t > 30 && (BK.input.confirm() || tap)) || this.t > 260) {
        this.game.loadStage(this.stage);
        BK.setScene('play', { game: this.game });
      }
    },
    draw(c) {
      const W = BK.W, H = BK.H, t = this.t, d = this.def;
      c.fillStyle = '#060203'; c.fillRect(0, 0, W, H);
      drawAsh(c, 30, '#802010');
      const a = Math.min(1, t / 30);
      T(c, 'ROUND ' + (this.stage + 1), W / 2, 110, { size: 22, color: RED, fam: BK.FONT_GOTH, weight: 400, alpha: a });
      T(c, d.name, W / 2, 152, { size: 34, color: INK, weight: 800, stroke: '#2a0406', strokeW: 5, alpha: a });
      T(c, '─ ' + d.sub + ' ─', W / 2, 188, { size: 14, color: '#c9a58a', alpha: a });
      if (d.intro) {
        const shown = d.intro.slice(0, Math.max(0, Math.floor((t - 30) / 2)));
        shown.split('\n').forEach((ln, i) => T(c, ln, W / 2, 238 + i * 22, { size: 13, color: INK }));
      }
      if (t > 60 && (t >> 4) % 2) T(c, '▼', W / 2, 320, { size: 12, color: DIM });
    },
  };

  // ================================================================ play
  BK.scenes.play = {
    enter(arg) {
      this.game = arg.game;
      this.paused = false; this.cont = 0; this.contT = 0;
      BK.setTouchUI(true);
    },
    exit() { BK.setTouchUI(false); },
    onHide() { if (!this.paused && !this.cont) this.pause(true); },
    pause(on) {
      this.paused = on;
      BK.setTouchUI(!on);
      if (BK.audio.musBus) BK.audio.musBus.gain.value = BK.audio.musicVol * (on ? 0.3 : 1);
      BK.audio.sfx('select');
    },
    onGameOver() { this.cont = 1; this.contT = 60 * 10 - 1; BK.setTouchUI(false); BK.audio.playSong('gameover'); },
    onStageClear() {
      if (this.leaving) return;
      this.leaving = true;
      BK.setScene('clear', { game: this.game });
    },
    update() {
      const I = BK.input, g = this.game;
      this.leaving = false;
      if (this.cont) { this.updateContinue(); return; }
      if (this.paused) {
        const tap = I.consumeTap(), z = hitZone(tap);
        if (z === 'resume' || I.pressed.pause || I.pressed.start) this.pause(false);
        else if (z === 'sound') BK.audio.toggleMute();
        else if (z === 'title') { BK.audio.stopSong(); BK.setScene('title'); }
        return;
      }
      if (I.pressed.pause || I.pressed.start) { this.pause(true); return; }
      g.update();
    },
    updateContinue() {
      const I = BK.input;
      this.contT--;
      const tap = I.consumeTap(), z = hitZone(tap);
      if (z === 'yes' || I.pressed.atk || I.pressed.start) {
        this.cont = 0; this.game.continueGame(); BK.setTouchUI(true);
        BK.audio.playSong(this.game.boss && !this.game.bossDefeated ? (this.game.stage.bossBgm || 'boss') : this.game.stage.bgm);
        return;
      }
      if (z === 'no' || this.contT <= 0) {
        BK.setScene('gameover', { game: this.game });
        return;
      }
      if (this.contT % 60 === 0) BK.audio.sfx('select', { pitch: 0.7 });
    },
    draw(c) {
      clearZones();
      const g = this.game;
      g.draw(c);
      drawHUD(c, g);
      if (this.paused) drawPause(c);
      if (this.cont) drawContinue(c, this);
    },
  };

  function drawPause(c) {
    c.fillStyle = 'rgba(0,0,0,0.65)'; c.fillRect(0, 0, BK.W, BK.H);
    T(c, 'PAUSE', BK.W / 2, 90, { size: 30, fam: BK.FONT_GOTH, weight: 400, color: INK });
    button(c, 'resume', '再開する', BK.W / 2, 150, 180, 34, { sel: true });
    button(c, 'sound', BK.audio.muted ? '音: OFF' : '音: ON', BK.W / 2, 196, 180, 30);
    button(c, 'title', 'タイトルへ戻る', BK.W / 2, 238, 180, 30);
    const help = BK.input.touchMode
      ? ['左半分をドラッグ: 移動（2回倒すとダッシュ）', '斬: 攻撃（長押しで溜め）  跳: ジャンプ  射: 射撃', '必: 必殺（体力消費）  狂: 覚醒ゲージ満タンで発動', '敵に向かって歩き続けると掴み→斬で膝蹴り/投げ']
      : ['矢印/WASD: 移動（2回押しでダッシュ）  Z: 攻撃（長押しで溜め）', 'X: ジャンプ  C: 射撃  V(Z+X): 必殺  B: 覚醒', '↓↑+Z: 昇り斬り  敵へ歩き続けて掴み  M: 音', 'ESC/P: ポーズ'];
    help.forEach((l, i) => T(c, l, BK.W / 2, 280 + i * 17, { size: 11, color: DIM }));
  }
  function drawContinue(c, sc) {
    c.fillStyle = 'rgba(0,0,0,0.7)'; c.fillRect(0, 0, BK.W, BK.H);
    T(c, 'CONTINUE ?', BK.W / 2, 110, { size: 34, fam: BK.FONT_GOTH, weight: 400, color: INK, stroke: '#400', strokeW: 4 });
    T(c, String(Math.max(0, Math.floor(sc.contT / 60))), BK.W / 2, 170, { size: 54, color: RED, weight: 800, stroke: '#000' });
    button(c, 'yes', 'まだ戦う', BK.W / 2 - 80, 238, 130, 34, { sel: true });
    button(c, 'no', 'あきらめる', BK.W / 2 + 80, 238, 130, 34);
  }

  // ================================================================ HUD
  const hudLag = { hp: 0, ehp: 0, eid: null };
  function bar(c, x, y, w, h, frac, col, lag, back) {
    c.fillStyle = back || 'rgba(0,0,0,0.7)'; c.fillRect(x - 1, y - 1, w + 2, h + 2);
    if (lag != null && lag > frac) { c.fillStyle = '#f4efe6'; c.fillRect(x, y, w * lag, h); }
    c.fillStyle = col; c.fillRect(x, y, w * U.clamp(frac, 0, 1), h);
    c.fillStyle = 'rgba(255,255,255,0.18)'; c.fillRect(x, y, w * U.clamp(frac, 0, 1), h * 0.35);
  }
  function drawHUD(c, g) {
    const h = g.hero, W = BK.W;
    if (!h) return;
    const d = h.def;
    // --- プレイヤー
    const x = 10, y = 8;
    c.fillStyle = 'rgba(0,0,0,0.45)'; c.fillRect(x - 4, y - 4, 214, 58);
    // 顔（リグの上半身を小さく）
    c.save(); c.beginPath(); c.rect(x, y, 34, 34); c.clip();
    c.fillStyle = '#1a0a0a'; c.fillRect(x, y, 34, 34);
    const fp = R.merge(d.stance, { wBack: 1, lean: 0, head: 0 });
    const fsc = (d.spec.scale || 1) * 1.35;
    const fsk = R.skeleton(fp, d.spec);
    c.translate(x + 17 - fsk.headC.x * fsc, y + 20 - fsk.headC.y * fsc); c.scale(fsc, fsc);
    R.draw(c, fp, d.spec, { t: 0, noWeapon: true, colors: h.awkT > 0 && d.awaken && d.awaken.colors ? Object.assign({}, d.spec.colors, d.awaken.colors) : null, awakened: h.awkT > 0 });
    c.restore();
    c.strokeStyle = h.awkT > 0 ? '#ff4030' : '#8a6a5a'; c.strokeRect(x, y, 34, 34);
    T(c, d.name, x + 40, y + 6, { size: 12, color: INK, align: 'left', weight: 800, stroke: '#000', strokeW: 3 });
    T(c, '×' + h.lives, x + 186, y + 6, { size: 12, color: GOLD, align: 'right', weight: 800, stroke: '#000', strokeW: 3 });
    const frac = h.hp / h.maxHp;
    hudLag.hp = hudLag.hp > frac ? Math.max(frac, hudLag.hp - 0.006) : frac;
    bar(c, x + 40, y + 14, 150, 9, frac, frac > 0.5 ? '#e8c040' : frac > 0.25 ? '#e87a20' : '#e02020', hudLag.hp);
    // 射撃ゲージ
    const s = d.shot;
    if (h.sub) {
      const idef = BK.itemDefs[h.sub.id];
      T(c, idef.name + ' ×' + h.sub.ammo, x + 40, y + 31, { size: 10, color: '#ffd0a0', align: 'left', weight: 800, stroke: '#000', strokeW: 3 });
    } else if (h.reloading) {
      bar(c, x + 40, y + 28, 70, 5, 1 - h.reloading / s.reloadAll, '#8a8a8a');
      T(c, 'RELOAD', x + 114, y + 31, { size: 9, color: '#bbb', align: 'left' });
    } else {
      const pw = Math.min(8, 110 / s.max);
      for (let i = 0; i < s.max; i++) { c.fillStyle = i < h.ammo ? '#d8d0b8' : 'rgba(255,255,255,0.15)'; c.fillRect(x + 40 + i * pw, y + 27, pw - 2, 7); }
    }
    // 覚醒ゲージ
    const ak = h.awkT > 0 ? h.awkT / d.awaken.dur : h.awk / 100;
    const full = h.awk >= 100;
    T(c, '狂', x + 44, y + 45, { size: 11, color: full || h.awkT ? '#ff5040' : '#a07060', weight: 800 });
    bar(c, x + 54, y + 41, 136, 6, ak, h.awkT > 0 ? '#ff3020' : full ? ((BK.frame >> 3) % 2 ? '#ff6040' : '#ffd080') : '#a02020');
    // スコア
    T(c, String(g.displayScore).padStart(8, '0'), W / 2, 12, { size: 13, color: INK, weight: 800, stroke: '#000', strokeW: 3 });
    T(c, 'HI ' + String(g.hiscore * 10).padStart(8, '0'), W / 2, 27, { size: 9, color: GOLD, stroke: '#000', strokeW: 2 });
    // --- 敵 / ボス
    const e = g.boss && !g.boss.dead ? g.boss : g.lastHitEnemy;
    if (e && (e === g.boss || !e.remove) && (e === g.boss || (e._lastHitF && BK.frame - e._lastHitF < 180))) {
      const ex = W - 200, ey = 10;
      c.fillStyle = 'rgba(0,0,0,0.45)'; c.fillRect(ex - 6, ey - 6, 198, e.boss ? 34 : 26);
      T(c, e.name || '???', ex, ey + 2, { size: 11, color: e.boss ? '#ff7060' : INK, align: 'left', weight: 800, stroke: '#000', strokeW: 3 });
      const layer = e.boss ? 120 : e.maxHp;
      const layers = Math.max(1, Math.ceil(e.maxHp / layer));
      const cur = Math.max(0, e.hp);
      const li = Math.max(0, Math.ceil(cur / layer) - 1);
      const inLayer = cur <= 0 ? 0 : (cur - li * layer) / Math.min(layer, e.maxHp);
      const cols = ['#e02020', '#e87a20', '#e8c040', '#50b050', '#4080e0', '#a050d0'];
      if (hudLag.eid !== e.uid) { hudLag.eid = e.uid; hudLag.ehp = inLayer; }
      hudLag.ehp = hudLag.ehp > inLayer ? Math.max(inLayer, hudLag.ehp - 0.01) : inLayer;
      bar(c, ex, ey + 10, 180, 7, inLayer, cols[li % cols.length], hudLag.ehp, li > 0 ? cols[(li - 1) % cols.length] : null);
      if (layers > 1 && li > 0) T(c, '×' + (li + 1), ex + 186, ey + 2, { size: 10, color: GOLD, align: 'right', weight: 800, stroke: '#000', strokeW: 2 });
    }
    // コンボ
    if (g.combo >= 3) {
      const k = Math.min(1, g.comboT / 20);
      T(c, g.combo + ' HIT', 16, 82, { size: 18 + Math.min(10, g.combo / 3), color: '#ffd27a', align: 'left', weight: 800, stroke: '#400', strokeW: 4, alpha: k, fam: BK.FONT_JP });
    }
    // GO
    if (g.goT > 0 && (g.goT >> 4) % 2 === 0) {
      T(c, 'GO', W - 70, 92, { size: 26, color: '#ffe0b0', weight: 800, stroke: '#600', strokeW: 5, fam: BK.FONT_GOTH });
      c.fillStyle = '#ffe0b0'; c.beginPath(); c.moveTo(W - 48, 82); c.lineTo(W - 34, 92); c.lineTo(W - 48, 102); c.fill();
    }
    // バナー
    for (const b of g.banners) {
      const k = Math.min(1, b.t / 12, (b.dur - b.t) / 20);
      T(c, b.text, W / 2, 140, { size: 30, color: b.col, weight: 800, stroke: '#000', strokeW: 6, alpha: k });
      if (b.sub) T(c, b.sub, W / 2, 112, { size: 12, color: '#e9dccb', weight: 600, stroke: '#000', strokeW: 3, alpha: k });
    }
    if (BK.setAwakenReady) BK.setAwakenReady(h.awk >= 100);
  }
  BK.ui.drawHUD = drawHUD;

  // ================================================================ clear
  BK.scenes.clear = {
    enter(arg) {
      BK.setTouchUI(false);
      this.game = arg.game; this.t = 0;
      const g = this.game, h = g.hero;
      this.rows = [
        ['体力ボーナス', Math.round(h.hp / h.maxHp * 100) * 100],
        ['撃破数 ' + g.kills, g.kills * 200],
        ['最大コンボ ' + g.maxCombo, g.maxCombo * 100],
        ['被ダメージ ' + g.damageTaken, Math.max(0, 5000 - g.damageTaken * 20)],
      ];
      this.total = this.rows.reduce((s, r) => s + r[1], 0);
      this.added = false;
    },
    update() {
      this.t++;
      if (this.t === 150 && !this.added) { this.added = true; this.game.addScore(this.total); BK.audio.sfx('coin'); }
      const tap = BK.input.consumeTap();
      if ((this.t > 150 && (BK.input.confirm() || tap)) || this.t > 330) {
        if (!this.added) { this.added = true; this.game.addScore(this.total); }
        BK.save.set('hiscore', Math.max(BK.save.get('hiscore', 0), this.game.score));
        const next = this.game.stageIdx + 1;
        if (next < BK.stages.length && BK.stages[next]) BK.setScene('intro', { game: this.game, stage: next });
        else BK.setScene('ending', { game: this.game });
      }
    },
    draw(c) {
      const W = BK.W, t = this.t;
      c.fillStyle = '#080304'; c.fillRect(0, 0, W, BK.H);
      drawAsh(c, 30, '#904020');
      T(c, 'ROUND ' + (this.game.stageIdx + 1) + '  CLEAR', W / 2, 60, { size: 26, color: GOLD, fam: BK.FONT_GOTH, weight: 400 });
      this.rows.forEach((r, i) => {
        if (t < 20 + i * 25) return;
        T(c, r[0], W / 2 - 150, 120 + i * 30, { size: 15, color: INK, align: 'left' });
        T(c, String(r[1] * 10), W / 2 + 150, 120 + i * 30, { size: 15, color: '#fff', align: 'right', weight: 800 });
      });
      if (t > 130) {
        c.fillStyle = '#6a2020'; c.fillRect(W / 2 - 150, 236, 300, 1.5);
        T(c, 'TOTAL', W / 2 - 150, 256, { size: 16, color: GOLD, align: 'left', weight: 800 });
        T(c, String(this.total * 10), W / 2 + 150, 256, { size: 18, color: GOLD, align: 'right', weight: 800 });
      }
      T(c, 'SCORE  ' + String(this.game.displayScore).padStart(8, '0'), W / 2, 300, { size: 14, color: INK });
    },
  };

  // ================================================================ game over
  BK.scenes.gameover = {
    enter(arg) {
      this.game = arg.game; this.t = 0;
      BK.setTouchUI(false);
      BK.save.set('hiscore', Math.max(BK.save.get('hiscore', 0), this.game.score));
    },
    update() {
      this.t++;
      const tap = BK.input.consumeTap();
      if ((this.t > 60 && (BK.input.confirm() || tap)) || this.t > 400) BK.setScene('title');
    },
    draw(c) {
      c.fillStyle = '#000'; c.fillRect(0, 0, BK.W, BK.H);
      const a = Math.min(1, this.t / 60);
      T(c, 'GAME OVER', BK.W / 2, 140, { size: 44, fam: BK.FONT_GOTH, weight: 400, color: RED, alpha: a });
      T(c, '剣士は闇に呑まれた……', BK.W / 2, 196, { size: 15, color: INK, alpha: a });
      T(c, 'SCORE  ' + String(this.game.displayScore).padStart(8, '0'), BK.W / 2, 250, { size: 14, color: GOLD, alpha: a });
    },
  };

  // ================================================================ ending
  BK.scenes.ending = {
    enter(arg) {
      this.game = arg.game; this.t = 0;
      BK.setTouchUI(false);
      BK.save.set('hiscore', Math.max(BK.save.get('hiscore', 0), this.game.score));
      BK.save.set('cleared', true);
      BK.audio.playSong('ending');
      const h = this.game.hero.def;
      this.lines = [
        '蝕の夜は明けた。',
        '',
        '鷹は光の彼方へと去り、',
        '烙印は今も、闇の気配に疼き続ける。',
        '',
        h.name + 'は剣を背負い直し、',
        '朝霧の街道をひとり歩き出した。',
        '',
        '─ 戦いは、まだ終わらない ─',
        '', '', '',
        'STAFF',
        '',
        'GAME DESIGN / PROGRAM / GRAPHICS / SOUND',
        'Claude（AIによる自動生成）',
        '',
        'SPECIAL THANKS',
        'CAPCOM「エイリアンVSプレデター」(1994) の',
        'ベルトアクション設計に敬意を込めて',
        '',
        '原作  三浦建太郎『ベルセルク』',
        '本作は私的に楽しむための非公式ファンメイド作品です。',
        '', '', '',
        'FINAL SCORE  ' + String(this.game.displayScore).padStart(8, '0'),
        '',
        'THANK YOU FOR PLAYING',
      ];
    },
    update() {
      this.t++;
      const tap = BK.input.consumeTap();
      const end = this.lines.length * 26 + BK.H + 40;
      if ((this.t * 0.5 > end) || (this.t > 240 && (BK.input.confirm() || tap))) BK.setScene('title');
    },
    draw(c) {
      const W = BK.W, H = BK.H;
      const g = c.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, '#1a0a14'); g.addColorStop(1, '#a0502a');
      c.fillStyle = g; c.fillRect(0, 0, W, H);
      drawEclipse(c, W * 0.8, 70, 26 + Math.min(20, this.t * 0.02), this.t);
      c.fillStyle = 'rgba(0,0,0,0.35)'; c.fillRect(0, 0, W, H);
      const def = this.game.hero.def;
      drawHeroFigure(c, def, W * 0.2, 320, 1.2, this.t, { pose: R.walk(def.stance, this.t * 0.08, def.walkOpt), tint: '#0a0405' });
      const off = H + 10 - this.t * 0.5;
      this.lines.forEach((l, i) => {
        const y = off + i * 26;
        if (y < -20 || y > H + 20) return;
        T(c, l, W * 0.58, y, { size: l === 'STAFF' || l === 'SPECIAL THANKS' ? 16 : 14, color: INK, stroke: '#000', strokeW: 3, weight: 800 });
      });
    },
  };
})(window.BK);

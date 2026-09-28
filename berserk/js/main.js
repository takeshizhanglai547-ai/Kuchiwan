'use strict';
/* =====================================================================
 *  main.js ── 起動処理とテスト用フック
 *  URL パラメータ（デバッグ用）:
 *    ?stage=3     ラウンド4から開始（0始まり）   ?hero=casca  キャラ指定で即開始
 *    ?auto=1      オートプレイ                  ?god=1       無敵
 * ===================================================================== */
(function (BK) {
  const params = new URLSearchParams(location.search);
  const qp = k => params.get(k);

  // テスト / デバッグ用 API（Playwright から呼ぶ）
  BK.test = {
    start(heroId, stage) {
      BK.audio.unlock();
      const g = new BK.Game(heroId || 'guts', { stage: stage || 0 });
      g.loadStage(stage || 0);
      BK.setScene('play', { game: g });
      return g;
    },
    state() {
      const g = BK.game;
      return {
        scene: BK.sceneName, frame: BK.frame, errors: BK.errors.slice(0, 5),
        stage: g ? g.stageIdx : null, camX: BK.cam.x, time: g ? g.time : 0,
        hero: g && g.hero ? { x: g.hero.x, y: g.hero.y, hp: g.hero.hp, lives: g.hero.lives, state: g.hero.state, dead: g.hero.dead } : null,
        enemies: g && g.actors ? g.actors.filter(a => a.team === 'enemy' && !a.dead).length : 0,
        boss: g && g.boss ? { name: g.boss.name, hp: g.boss.hp, dead: g.boss.dead } : null,
        bossDefeated: g ? g.bossDefeated : false, lock: g && g.lock ? g.lock.ev.at : null, evIdx: g ? g.evIdx : 0,
        score: g ? g.score : 0,
      };
    },
    /** ボス戦から直接始める（テスト用）: 該当ボスがいるステージを探して、その地点へワープ */
    bossFight(heroId, bossId) {
      BK.audio.unlock();
      let si = BK.stages.findIndex(st => st && (st.events || []).some(e => e.boss === bossId));
      const synthetic = si < 0;
      if (synthetic) si = 0;
      const g = new BK.Game(heroId || 'guts', { stage: si });
      g.loadStage(si);
      const ev = synthetic ? { at: 400, boss: bossId, x: 470, y: 60, waves: [] } : g.events.find(e => e.boss === bossId);
      g.events = [Object.assign({ done: false }, ev)]; g.evIdx = 0;
      const maxCam = Math.max(0, g.stage.len - BK.W);
      BK.cam.x = Math.min(ev.at, maxCam); g.camMin = BK.cam.x;
      g.hero.x = BK.cam.x + 110;
      g.actors = g.actors.filter(a => a === g.hero);
      BK.setScene('play', { game: g });
      return g;
    },
    killAll() { const g = BK.game; for (const a of g.actors) if (a.team === 'enemy' && !a.dead) { a.hp = 0; a.die(g.hero, { dmg: 999 }, 1); } },
    god(on) { BK.god = on !== false; },
  };

  // 無敵モード（テスト用）
  const origTake = BK.Hero.prototype.takeHit;
  BK.Hero.prototype.takeHit = function (src, h, dir) {
    if (BK.god) { if (!this.hurtable) return false; this.flash = 4; return true; }
    return origTake.call(this, src, h, dir);
  };

  function boot() {
    if (qp('god')) BK.god = true;
    if (qp('stage')) BK.startStage = Math.max(0, Math.min(BK.stages.length - 1, parseInt(qp('stage'), 10) || 0));
    BK.start('title');
    if (qp('boss')) BK.test.bossFight(qp('hero') || 'guts', qp('boss'));
    else if (qp('hero') && BK.heroes[qp('hero')]) BK.test.start(qp('hero'), BK.startStage || 0);
    if (qp('auto')) BK.autoplay = true;
  }

  // フォント読み込みを最大 1.5 秒待ってから起動（オフラインでも起動する）
  let booted = false;
  const go = () => { if (!booted) { booted = true; boot(); } };
  try {
    if (document.fonts && document.fonts.load) {
      Promise.all([
        document.fonts.load("800 20px 'Shippori Mincho B1'"),
        document.fonts.load("400 40px 'UnifrakturMaguntia'"),
      ]).then(go, go);
      setTimeout(go, 1500);
    } else go();
  } catch (e) { go(); }
})(window.BK);

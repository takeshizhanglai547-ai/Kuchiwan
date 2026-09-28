// もふもふ聖犬士イッヌ 2.5D — 振る舞いの試験（ブラウザ）。
//   cd /tmp && NODE_PATH=/opt/node22/lib/node_modules node /home/user/Kuchiwan/tests/25d/suite.js [filter]
//   INU25D_TARGET=/tmp/mut.html …   ← ミューテーション試験
// 期待値は仕様（CONCEPT.md の数値や、画面上の結果）から直値で書く。実装の定数を読んで比べない（CLAUDE.md）。
'use strict';
const { open, test, assert, runAll } = require('./harness');

// ---------------------------------------------------------------- boot
test('boot: live mode reaches the title screen without errors', async () => {
  const g = await open({ hash:'' });
  await g.page.waitForTimeout(2500);
  const s = await g.run(() => ({ scene: G.sceneName, ui: document.getElementById('ui').children.length, ticks: G.time.tick }));
  await g.page.waitForTimeout(1500);
  const t2 = await g.run(() => G.time.tick);
  const errs = await g.errors();
  await g.close();
  assert(errs.length === 0, 'errors: ' + errs.slice(0,3).join(' | '));
  assert(s.scene === 'title', 'scene=' + s.scene);
  assert(s.ui > 0, 'title UI not built');
  // software WebGL is slow here, so only require that the rAF loop keeps advancing
  assert(t2 > s.ticks, 'loop is not running: ticks ' + s.ticks + ' → ' + t2);
});

test('boot: survives a sandbox where localStorage throws', async () => {
  const g = await open({ hash:'', init: () => { Object.defineProperty(window, 'localStorage', { get(){ throw new Error('blocked'); } }); } });
  await g.page.waitForTimeout(1500);
  const s = await g.run(() => G.sceneName);
  const errs = await g.errors();
  await g.close();
  assert(s === 'title', 'scene=' + s);
  assert(errs.length === 0, 'errors: ' + errs.slice(0,3).join(' | '));
});

// ---------------------------------------------------------------- combat
test('combat: 4-press combo damages a foe and the finisher launches it', async () => {
  const g = await open();
  const r = await g.run(() => {
    G.foes.define('t_dummy', { name:'t', hp:200, ai(e){ G.foes.h.stop(e); } });
    G.debug.arena('inu', 'normal');
    const f = G.foes.spawn('t_dummy', 4.0, 0, { entrance:'none' });
    G.player.x = 3.0; G.player.z = 0; G.player.face = 1; G.step(2);
    const hp0 = f.hp; let maxY = 0, hits = 0, stop = 0;
    G.bus.on('hit', (d) => { if(d.target === f) hits++; });
    for(let i=0;i<4;i++){ G.input.latch('attack'); for(let k=0;k<10;k++){ G.step(1); maxY = Math.max(maxY, f.y); stop = Math.max(stop, G.hitStop); } }
    for(let k=0;k<40;k++){ G.step(1); maxY = Math.max(maxY, f.y); }
    return { drop: hp0 - f.hp, hits, maxY, stop };
  });
  const errs = await g.errors(); await g.close();
  assert(errs.length === 0, 'errors: ' + errs.slice(0,3).join(' | '));
  assert(r.hits >= 4, 'expected 4 hits, got ' + r.hits);
  assert(r.drop >= 30 && r.drop <= 70, 'hp drop out of range: ' + r.drop);
  assert(r.maxY > 0.4, 'finisher did not launch (max y ' + r.maxY.toFixed(2) + ')');
  assert(r.stop >= 2, 'no hitstop observed');
});

test('combat: rolling through an attack avoids damage (and a just-dodge triggers)', async () => {
  const g = await open();
  const r = await g.run(() => {
    G.foes.define('t_hitter', { name:'t', hp:500, ai(e){ G.foes.h.stop(e); } });
    G.debug.arena('inu', 'normal');
    const f = G.foes.spawn('t_hitter', 4.0, 0, { entrance:'none' });
    G.player.x = 3.1; G.player.z = 0; G.player.face = 1; G.step(2);
    let just = 0; G.bus.on('dodge', d => { if(d.just) just++; });
    const hp0 = G.player.hp;
    f.face = -1;
    G.combat.start(f, { id:'t_swipe', anim:'attack', len:20, hits:[{ at:4, dur:3, x0:0, x1:1.5, zr:0.8, y0:0, y1:1.6, dmg:20, kind:'blunt', power:1 }] });
    G.step(1); G.input.latch('dodge'); G.step(30);
    const afterDodge = G.player.hp;
    // control: same attack without dodging must hurt
    G.player.x = 3.1; G.player.z = 0; G.player.inv = 0; G.setState(G.player, 'idle'); f.x = 4.0; f.face = -1; G.step(1);
    G.combat.start(f, { id:'t_swipe2', anim:'attack', len:20, hits:[{ at:4, dur:3, x0:0, x1:1.5, zr:0.8, y0:0, y1:1.6, dmg:20, kind:'blunt', power:1 }] });
    G.step(20);
    return { hp0, afterDodge, afterHit: G.player.hp, just };
  });
  const errs = await g.errors(); await g.close();
  assert(errs.length === 0, 'errors: ' + errs.slice(0,3).join(' | '));
  assert(r.afterDodge === r.hp0, `took damage while rolling: ${r.hp0} → ${r.afterDodge}`);
  assert(r.just >= 1, 'just dodge did not trigger');
  assert(r.afterHit < r.afterDodge, 'control hit did no damage (test is not measuring anything)');
});

test('combat: special uses one ✦ and fires; ult freezes the world then hits every foe on screen', async () => {
  const g = await open();
  const r = await g.run(() => {
    G.foes.define('t_dummy2', { name:'t', hp:300, ai(e){ e.vx = 0.01; e.face = 1; } });
    G.debug.arena('inu', 'normal');
    const fs = [G.foes.spawn('t_dummy2', 6, -1.5, { entrance:'none' }), G.foes.spawn('t_dummy2', 8, 1.2, { entrance:'none' }), G.foes.spawn('t_dummy2', 0.8, 0, { entrance:'none' })];
    G.player.x = 3; G.step(2);
    const sp0 = G.player.sp; let shots = 0; G.bus.on('shoot', () => shots++);
    G.input.latch('special'); G.step(14);
    const sp1 = G.player.sp;
    G.step(40);
    G.player.ult = 100;
    G.input.latch('ult'); G.step(3);
    const frozen = G.game.cutinT > 0;
    const xs = fs.map(f => f.x);
    G.step(20);
    const moved = fs.some((f,i) => Math.abs(f.x - xs[i]) > 1e-6);
    G.step(220);
    return { sp0, sp1, shots, frozen, moved, hit: fs.map(f => f.maxHp - f.hp) };
  });
  const errs = await g.errors(); await g.close();
  assert(errs.length === 0, 'errors: ' + errs.slice(0,3).join(' | '));
  assert(r.sp0 - r.sp1 > 0.8 && r.sp0 - r.sp1 < 1.2, `special should cost one pip: ${r.sp0} → ${r.sp1}`);
  assert(r.shots >= 1, 'special fired nothing');
  assert(r.frozen, 'ult cut-in did not start');
  assert(!r.moved, 'foes moved during the cut-in');
  assert(r.hit.every(h => h >= 20), 'ult missed a foe on screen: ' + JSON.stringify(r.hit));
});

test('combat: foe KO turns into a happy pup that leaves (no corpse stays)', async () => {
  const g = await open();
  const r = await g.run(() => {
    G.foes.define('t_weak', { name:'t', hp:5, ai(e){ G.foes.h.stop(e); } });
    G.debug.arena('inu', 'normal');
    const f = G.foes.spawn('t_weak', 4, 0, { entrance:'none' });
    G.player.x = 3.1; G.step(2);
    let ko = 0, poof = 0; G.bus.on('ko', () => ko++); G.bus.on('poof', () => poof++);
    G.input.latch('attack'); G.step(20);
    const alive1 = G.foesAlive();
    G.step(300);
    return { ko, poof, alive1, inWorld: G.world.ents.includes(f), happy: !!f.happy };
  });
  const errs = await g.errors(); await g.close();
  assert(errs.length === 0, 'errors: ' + errs.slice(0,3).join(' | '));
  assert(r.ko === 1, 'ko events: ' + r.ko);
  assert(r.alive1 === 0, 'KO\'d foe still counted alive');
  assert(r.poof === 1 && r.happy, 'no poof → happy pup');
  assert(!r.inWorld, 'KO\'d foe never left the world');
});

test('combat: an armoured foe shrugs off exactly its armour count of light hits', async () => {
  const g = await open();
  const r = await g.run(() => {
    G.foes.define('t_arm', { name:'t', hp:500, armor:2, ai(e){ G.foes.h.stop(e); } });
    G.debug.arena('inu', 'normal');
    const f = G.foes.spawn('t_arm', 5, 0, { entrance:'none' }); G.step(2);
    const states = [];
    for(let i=0;i<3;i++){ G.combat.damage(f, 5, { src:G.player, kind:'slash', power:1, dir:1 }); states.push(f.state); G.hitStop = 0; }
    return states;
  });
  const errs = await g.errors(); await g.close();
  assert(errs.length === 0, 'errors: ' + errs.slice(0,3).join(' | '));
  assert(r[0] !== 'hurt' && r[1] !== 'hurt', 'flinched too early: ' + r.join(','));
  assert(r[2] === 'hurt', 'third light hit should flinch: ' + r.join(','));
});

test('combat: a floored boss does not build stagger damage (no stun-lock after getting up)', async () => {
  const g = await open();
  const r = await g.run(() => {
    G.foes.define('t_boss', { name:'t', hp:2000, boss:true, poise:50, weight:3, ai(e){ G.foes.h.stop(e); } });
    G.debug.arena('inu', 'normal');
    const f = G.foes.spawn('t_boss', 6, 0, { entrance:'none' }); G.step(2);
    G.combat.damage(f, 60, { src:G.player, kind:'blunt', power:2, dir:1 });
    const s1 = f.state;
    for(let i=0;i<6;i++){ G.combat.damage(f, 20, { src:G.player, kind:'blunt', power:2, dir:1 }); G.step(3); }
    let t = 0; while(f.state !== 'idle' && t < 400){ G.step(1); t++; }
    G.combat.damage(f, 12, { src:G.player, kind:'blunt', power:2, dir:1 });
    return { s1, back: t, after: f.state };
  });
  const errs = await g.errors(); await g.close();
  assert(errs.length === 0, 'errors: ' + errs.slice(0,3).join(' | '));
  assert(r.s1 === 'down', 'poise break did not floor the boss: ' + JSON.stringify(r));
  assert(r.back < 400, 'boss never got up: ' + JSON.stringify(r));
  assert(r.after !== 'down', 'first hit after getting up floored it again (stun-lock): ' + JSON.stringify(r));
});

// ---------------------------------------------------------------- review regressions (2026-09-28 adversarial review)
test('win: a KO right after the boss is purified cannot cause game over or cost the result', async () => {
  const g = await open();
  const r = await g.run(() => {
    G.debug.play('inu', 0, 'hard'); G.step(2);
    const st = G.stage.st; st.ptr = st.seq.length-1; const p = G.player; p.x = 80; G.step(200);
    const boss = G.world.ents.find(e => e.team===1 && e.def && e.def.boss);
    G.game.lives = 1; p.hp = 1; p.inv = 0; G.game.xp = 0; G.game.xpNext = 1e9;
    G.combat.shoot({ owner:boss, kind:'rock', x:p.x+2.5, y:0.8, z:p.z, vx:-0.08, dmg:10, r:0.5, life:90 });
    G.combat.damage(boss, 99999, { src:p, kind:'slash', power:3 });
    for(let i=0;i<60;i++) G.step(10);
    return { result: G.ui.isShown('result'), over: G.ui.isShown('over'), unlocked: G.game.unlocked, coins: G.game.coins };
  });
  const errs = await g.errors(); await g.close();
  assert(errs.length === 0, 'errors: ' + errs.slice(0,3).join(' | '));
  assert(r.result && !r.over, 'expected the result screen, got ' + JSON.stringify(r));
  assert(r.unlocked >= 1, 'clear not recorded: ' + JSON.stringify(r));
  assert(r.coins >= 10, 'boss reward coins were not collected: ' + JSON.stringify(r));
});

test('win: a purified boss\'s helpers stop attacking', async () => {
  const g = await open();
  const r = await g.run(() => {
    G.debug.arena('inu', 'normal');
    const boss = G.foes.spawn('garm', 9, 0, { entrance:'none', boss:true });
    const helpers = [G.foes.spawn('wanhei', 4.2, 0.2, { entrance:'none' }), G.foes.spawn('wanhei', 1.8, -0.2, { entrance:'none' })];
    G.player.x = 3; G.step(30);
    G.combat.damage(boss, 99999, { src:G.player, kind:'slash', power:3 });
    G.step(5);
    G.player.hp = G.player.maxHp; G.player.inv = 0; const hp0 = G.player.hp; let hits = 0;
    G.bus.on('hurt', d => { if(d.ent === G.player) hits++; });
    G.step(400);
    return { hits, hp0, hp: G.player.hp, left: helpers.filter(h => !h.removed && !h.dead).length };
  });
  const errs = await g.errors(); await g.close();
  assert(errs.length === 0, 'errors: ' + errs.slice(0,3).join(' | '));
  assert(r.hits === 0, 'helpers kept hitting the hero after the boss was purified: ' + JSON.stringify(r));
  assert(r.left === 0, 'helpers never gave up: ' + JSON.stringify(r));
});

test('camera: an arena wider than the screen still keeps the hero in view', async () => {
  const g = await open({ size:'390x844', touch:true });
  const r = await g.run(() => {
    G.debug.arena('inu', 'normal'); G.step(2);
    G.cam.lock(5, 35); const p = G.player; const out = [];
    for(const x of [6, 20, 34]){ p.x = x; G.step(120); const s = G.toScreen(p.x, p.y+0.7, p.z); out.push([x, Math.round(s.x)]); }
    return { out, w: innerWidth };
  });
  const errs = await g.errors(); await g.close();
  assert(errs.length === 0, 'errors: ' + errs.slice(0,3).join(' | '));
  assert(r.out.every(([x, sx]) => sx > 0 && sx < r.w), 'hero left the screen: ' + JSON.stringify(r));
});

test('progress: level-ups carry over to the next stage unchanged', async () => {
  const g = await open();
  const r = await g.run(() => {
    G.debug.play('inu', 0, 'normal'); G.step(2);
    G.game.level = 1; G.game.xp = 0; G.game.xpNext = 60;
    for(let i=0;i<5;i++) G.game.addXp(G.game.xpNext);
    const a = { hp: G.player.maxHp, atk: G.player.atkMul };
    G.go('play', { stage:1 }); G.step(2);
    return { a, b: { hp: G.player.maxHp, atk: G.player.atkMul }, level: G.game.level };
  });
  const errs = await g.errors(); await g.close();
  assert(errs.length === 0, 'errors: ' + errs.slice(0,3).join(' | '));
  assert(r.level === 6, 'setup: level ' + r.level);
  assert(Math.abs(r.b.hp - r.a.hp) <= 1 && Math.abs(r.b.atk - r.a.atk) < 1e-6, 'stats changed between stages: ' + JSON.stringify(r));
});

// ---------------------------------------------------------------- stages
test('stage 1: the bot clears it (waves lock the camera, boss appears, stage done)', async () => {
  const g = await open();
  const r = await g.run(() => {
    G.debug.play('inu', 0, 'easy');
    G.debug.autoplay(true);
    let locks = 0, intro = 0, down = 0, waves = 0; let lastMin = G.cam.lockMin;
    G.bus.on('bossIntro', () => intro++); G.bus.on('bossDown', () => down++); G.bus.on('wave', () => waves++);
    let t = 0;
    while(t < 60*60*6 && !G.stage.done){ G.step(30); t += 30; if(G.cam.lockMin !== lastMin){ if(G.cam.lockMin > -1e8) locks++; lastMin = G.cam.lockMin; } }
    G.step(260);
    return { done: G.stage.done, t, locks, intro, down, waves, scene: G.sceneName, hp: G.player && G.player.hp, revives: G.game.revives };
  });
  const errs = await g.errors(); await g.close();
  assert(errs.length === 0, 'errors: ' + errs.slice(0,3).join(' | '));
  assert(r.done, 'stage not cleared in 6 minutes of game time: ' + JSON.stringify(r));
  assert(r.waves >= 2 && r.locks >= 2, 'expected several locked waves: ' + JSON.stringify(r));
  assert(r.intro === 1 && r.down >= 1, 'boss intro/down missing: ' + JSON.stringify(r));
});

test('stages: all 7 load and unload without leaking GPU memory', async () => {
  const g = await open();
  const r = await g.run(() => {
    const info = G.renderer.info.memory;
    const n = (G.stages || []).length;
    G.step(1);
    const base = { g: info.geometries, t: info.textures };
    const per = [];
    for(let round=0; round<2; round++){
      for(let i=0;i<n;i++){ G.stage.load(i); G.step(2); per.push(G.renderer.info.render.calls); G.stage.unload(); G.step(1); }
    }
    return { n, base, end: { g: info.geometries, t: info.textures }, per };
  });
  const errs = await g.errors(); await g.close();
  assert(errs.length === 0, 'errors: ' + errs.slice(0,3).join(' | '));
  assert(r.n === 7, 'expected 7 stages, got ' + r.n);
  assert(r.end.g - r.base.g <= 12, `geometries leaked: ${r.base.g} → ${r.end.g}`);
  assert(r.end.t - r.base.t <= 4, `textures leaked: ${r.base.t} → ${r.end.t}`);
});

test('perf: a busy fight stays inside the draw-call / triangle budget', async () => {
  const g = await open();
  const r = await g.run(() => {
    G.debug.play('inu', 2, 'normal');
    const kinds = Object.keys(G.foes.types).filter(k => !G.foes.types[k].boss && k.indexOf('t_')!==0 && k!=='balloon' && k!=='slimelet' && k!=='ghostbro');
    for(let i=0;i<10;i++) G.foes.spawn(kinds[i % kinds.length], G.player.x + 1.5 + (i%5)*1.1, -2 + (i%4)*1.1, { entrance:'none' });
    G.step(30);
    return { calls: G.renderer.info.render.calls, tris: G.renderer.info.render.triangles, foes: G.foesAlive(), kinds: kinds.length };
  });
  const errs = await g.errors(); await g.close();
  assert(errs.length === 0, 'errors: ' + errs.slice(0,3).join(' | '));
  assert(r.foes >= 8, 'setup failed: ' + JSON.stringify(r));
  assert(r.calls <= 320, 'too many draw calls: ' + JSON.stringify(r));
  assert(r.tris <= 250000, 'too many triangles: ' + JSON.stringify(r));
});

// ---------------------------------------------------------------- phone
test('phone portrait: hero stays on screen and the touch controls exist', async () => {
  const g = await open({ size:'390x844', touch:true });
  const r = await g.run(() => {
    G.debug.play('inu', 0, 'normal');
    G.step(10);
    const s = G.toScreen(G.player.x, G.player.y + 0.7, G.player.z);
    const btns = document.querySelectorAll('#ui button, #ui [data-btn]').length;
    return { sx: s.x, sy: s.y, w: innerWidth, h: innerHeight, btns };
  });
  const errs = await g.errors(); await g.close();
  assert(errs.length === 0, 'errors: ' + errs.slice(0,3).join(' | '));
  assert(r.sx > 0 && r.sx < r.w && r.sy > 0 && r.sy < r.h, 'hero off screen: ' + JSON.stringify(r));
  assert(r.btns >= 4, 'touch buttons missing: ' + r.btns);
});

// slow: run with the filter "allstages"
test('allstages: the bot can clear every stage on やさしい (no soft-locks)', async () => {
  const g = await open();
  const r = await g.run(() => {
    const out = [];
    for(let i=0;i<(G.stages||[]).length;i++){
      G.debug.play(['inu','shima','nuko','guard8','watch','wanden','mack'][i%7], i, 'easy');
      G.debug.autoplay(true);
      let t = 0;
      while(t < 60*60*8 && !G.stage.done){ G.step(60); t += 60; }
      out.push({ stage:i, done:G.stage.done, sec:Math.round(t/60), revives:G.game.revives, x: G.player ? +G.player.x.toFixed(1) : null,
        foes: G.foesAlive(), lock: G.cam.lockMin > -1e8 ? [+G.cam.lockMin.toFixed(1), +G.cam.lockMax.toFixed(1)] : null });
    }
    return out;
  });
  const errs = await g.errors(); await g.close();
  console.log('       ' + JSON.stringify(r));
  assert(errs.length === 0, 'errors: ' + errs.slice(0,3).join(' | '));
  assert(r.length === 7, 'stages: ' + r.length);
  const stuck = r.filter(s => !s.done);
  assert(stuck.length === 0, 'not cleared: ' + JSON.stringify(stuck));
}, { slow:true });

runAll(process.argv[2]);

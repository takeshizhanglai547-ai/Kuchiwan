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
  // software WebGL on a loaded machine can take over a second per frame (measured: ticks come in bursts of 5 with
  // 1-2 s gaps at load 10-15), so wait up to 12 s for the next frame; a stopped loop never advances
  let t2 = s.ticks;
  for(let i=0;i<24 && t2 <= s.ticks;i++){ await g.page.waitForTimeout(500); t2 = await g.run(() => G.time.tick); }
  const errs = await g.errors();
  await g.close();
  assert(errs.length === 0, 'errors: ' + errs.slice(0,3).join(' | '));
  assert(s.scene === 'title', 'scene=' + s.scene);
  assert(s.ui > 0, 'title UI not built');
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

test('combat: the ult keeps a longer invulnerability (a fresh revive stays safe)', async () => {
  const g = await open();
  const r = await g.run(() => {
    G.debug.arena('inu', 'normal'); G.step(2);
    const p = G.player; p.inv = 600; p.ult = 100;
    G.input.latch('ult'); let sawUlt = false, t = 0;
    while(t < 200 && !(sawUlt && p.state !== 'ult')){ G.step(1); t++; if(p.state === 'ult') sawUlt = true; if(sawUlt) break; }
    G.step(2);
    return { sawUlt, t, inv: p.inv };
  });
  const errs = await g.errors(); await g.close();
  assert(errs.length === 0, 'errors: ' + errs.slice(0,3).join(' | '));
  assert(r.sawUlt, 'setup: the ult never started: ' + JSON.stringify(r));
  // 600 frames of invulnerability, at most ~200 frames used up by the cut-in: well over 350 must be left
  assert(r.inv > 350, 'the ult cut the invulnerability short: ' + JSON.stringify(r));
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
    let t = 0; while(f.state !== 'getup' && t < 400){ G.step(1); t++; }
    const sawGetup = f.state === 'getup';
    G.combat.damage(f, 12, { src:G.player, kind:'blunt', power:2, dir:1 });
    const whileGetup = f.state;
    while(f.state !== 'idle' && t < 800){ G.step(1); t++; }
    G.combat.damage(f, 12, { src:G.player, kind:'blunt', power:2, dir:1 });
    return { s1, sawGetup, whileGetup, back: t, after: f.state };
  });
  const errs = await g.errors(); await g.close();
  assert(errs.length === 0, 'errors: ' + errs.slice(0,3).join(' | '));
  assert(r.s1 === 'down', 'poise break did not floor the boss: ' + JSON.stringify(r));
  assert(r.sawGetup, 'setup: the boss never started getting up: ' + JSON.stringify(r));
  assert(r.whileGetup !== 'down', 'a hit while getting up floored it again (stun-lock): ' + JSON.stringify(r));
  assert(r.back < 800, 'boss never got up: ' + JSON.stringify(r));
  assert(r.after !== 'down', 'first hit after getting up floored it again (stun-lock): ' + JSON.stringify(r));
});

// ---------------------------------------------------------------- review regressions (2026-09-28 adversarial review)
test('win: once the boss is purified nothing can hurt the hero, cost a life or cause game over', async () => {
  const g = await open();
  const r = await g.run(() => {
    G.foes.define('t_far', { name:'t', hp:50, ai(e){ G.foes.h.stop(e); } });
    G.debug.play('inu', 0, 'hard'); G.step(2);
    const st = G.stage.st; st.ptr = st.seq.length-1; const p = G.player; p.x = 80; G.step(200);
    const boss = G.world.ents.find(e => e.team===1 && e.def && e.def.boss);
    G.game.lives = 1; p.hp = 1; p.inv = 0; G.game.xp = 0; G.game.xpNext = 1e9;
    // a rock that hits right after the KO, and a slow one still in the air when the stage is won
    G.combat.shoot({ owner:boss, kind:'rock', x:p.x+2.5, y:0.8, z:p.z, vx:-0.08, dmg:10, r:0.5, life:90 });
    const slow = G.combat.shoot({ owner:boss, kind:'rock', x:p.x+7, y:0.8, z:p.z, vx:-0.01, dmg:10, r:0.5, life:900 });
    G.combat.damage(boss, 99999, { src:p, kind:'slash', power:3 });
    let t = 0; while(!G.scenes.play.cleared && t < 600){ G.step(1); t++; }
    G.step(2);
    const slowAlive = G.combat.projectiles.some(q => q.team===1 && q.life > 0 && (q===slow || Math.abs(q.vx + 0.01) < 1e-9));
    // a foe's blast right on the hero after the win
    const far = G.foes.spawn('t_far', p.x + 9, p.z, { entrance:'none' });
    if(p.dead){ G.step(120); }
    const hpA = p.hp; G.combat.area({ owner:far, x:p.x, z:p.z, r:1.5, y0:-1, y1:4, dmg:30 }); G.step(6); const hpB = p.hp;
    // falling after the win (however it happens) costs nothing
    const lives0 = G.game.lives; p.hp = 0; p.dead = true; G.step(110);
    const lives1 = G.game.lives, overEarly = G.ui.isShown('over');
    for(let i=0;i<60;i++) G.step(10);
    return { t, cleared: G.scenes.play.cleared, slowAlive, hpA, hpB, lives0, lives1, overEarly,
             result: G.ui.isShown('result'), over: G.ui.isShown('over'), unlocked: G.game.unlocked, coins: G.game.coins };
  });
  const errs = await g.errors(); await g.close();
  assert(errs.length === 0, 'errors: ' + errs.slice(0,3).join(' | '));
  assert(r.cleared, 'setup: the stage was never won: ' + JSON.stringify(r));
  assert(!r.slowAlive, 'a foe\'s rock stayed in the air after the win: ' + JSON.stringify(r));
  assert(r.hpB === r.hpA && r.hpA > 0, 'the hero was hurt after the win: ' + JSON.stringify(r));
  assert(r.lives1 === r.lives0 && !r.overEarly, 'falling after the win cost a life / game over: ' + JSON.stringify(r));
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
    G.player.hp = G.player.maxHp; G.player.inv = 0; const hp0 = G.player.hp; let hits = 0, winding = 0;
    G.bus.on('hurt', d => { if(d.ent === G.player) hits++; });
    // the hero is safe anyway once the stage is won, so also count ticks where a helper winds up or swings
    for(let i=0;i<400;i++){ G.step(1); for(const h of helpers) if(!h.dead && !h.removed && (h.pending || h.atk)) winding++; }
    return { hits, winding, hp0, hp: G.player.hp, left: helpers.filter(h => !h.removed && !h.dead).length };
  });
  const errs = await g.errors(); await g.close();
  assert(errs.length === 0, 'errors: ' + errs.slice(0,3).join(' | '));
  assert(r.hits === 0, 'helpers kept hitting the hero after the boss was purified: ' + JSON.stringify(r));
  assert(r.winding === 0, 'helpers kept winding up attacks after the boss was purified: ' + JSON.stringify(r));
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

test('phone: turning the phone during a locked wave keeps the hero and every foe on screen', async () => {
  const g = await open({ size:'844x390', touch:true });
  await g.run(() => { G.seed(7); G.debug.play('inu', 0, 'normal'); G.step(5); const p = G.player; p.hp = p.maxHp = 1e9; p.x = 16.5; G.step(60); });
  await g.page.setViewportSize({ width:390, height:844 }); await g.page.waitForTimeout(300);
  const r = await g.run(() => {
    const W = innerWidth, p = G.player, bad = []; let checks = 0;
    const check = (tag) => {
      if(!G.stage.progress().locked) return; checks++;
      const s = G.toScreen(p.x, p.y + 0.7, p.z); if(!(s.x > 0 && s.x < W)) bad.push([tag, 'hero', Math.round(s.x)]);
      for(const e of G.world.ents){
        if(e.team!==1 || e.dead || e.removed || !e.entered) continue;
        const q = G.toScreen(e.x, e.y + 0.7, e.z); if(!(q.x > 0 && q.x < W)) bad.push([tag, e.type, Math.round(q.x)]);
      }
    };
    G.step(30); check('settled');
    const pr = G.stage.progress();
    for(const [tag, x] of [['left', pr.lockA + 0.5], ['right', pr.lockB - 0.5]]){ p.x = x; p.vx = 0; G.step(90); check(tag); }
    G.input.touch.x = 1; G.step(150); G.input.touch.x = 0; G.step(20); check('walkRight');
    G.input.touch.x = -1; G.step(300); G.input.touch.x = 0; G.step(20); check('walkLeft');
    return { W, checks, bad };
  });
  const errs = await g.errors(); await g.close();
  assert(errs.length === 0, 'errors: ' + errs.slice(0,3).join(' | '));
  assert(r.checks >= 3, 'setup: the wave was not locked while checking: ' + JSON.stringify(r));
  assert(r.bad.length === 0, 'off screen after turning the phone: ' + JSON.stringify(r));
});

test('phone: every boss name and title fits its HP bar on a small phone (no "…")', async () => {
  const g = await open({ size:'568x320', touch:true });
  const r = await g.run(() => {
    G.debug.arena('inu'); G.step(5);
    const out = [];
    for(const t of ['garm','shark','ghost','cerbe','slime','dragon','kuroinu','emperor']){
      const e = G.foes.spawn(t, 3, 0, { boss:true }); G.ui.bossBar(e); G.step(30);
      const nm = document.querySelector('#iu .bnm span'), tl = document.querySelector('#iu .btl');
      out.push({ t, text: nm.textContent, cut: nm.scrollWidth > nm.clientWidth, title: tl.textContent, tcut: tl.scrollWidth > tl.clientWidth });
      G.ui.bossBar(null); G.world.remove(e); G.step(2);
    }
    return out;
  });
  // the boss block, once it has dropped in, must not cover the hero's HP / おうぎ panel
  await g.run(() => { const e = G.foes.spawn('emperor', 3, 0, { boss:true }); G.ui.bossBar(e); G.step(5); });
  await g.page.waitForTimeout(900);
  const ov = await g.run(() => {
    G.step(1);
    const b = document.querySelector('#iu .boss').getBoundingClientRect(), h = document.querySelector('#iu .hl').getBoundingClientRect();
    const a = Math.max(0, Math.min(b.right, h.right) - Math.max(b.left, h.left)) * Math.max(0, Math.min(b.bottom, h.bottom) - Math.max(b.top, h.top));
    return { area: Math.round(a), boss:[b.left, b.top, b.right, b.bottom].map(Math.round), hero:[h.left, h.top, h.right, h.bottom].map(Math.round), w: innerWidth };
  });
  const errs = await g.errors(); await g.close();
  assert(errs.length === 0, 'errors: ' + errs.slice(0,3).join(' | '));
  assert(r.length === 8 && r.every(o => o.text.length >= 4), 'setup: ' + JSON.stringify(r));
  assert(r.every(o => !o.cut), 'boss name cut off: ' + JSON.stringify(r.filter(o => o.cut)));
  assert(r.every(o => o.title.length >= 4), 'boss title missing: ' + JSON.stringify(r));
  assert(r.every(o => !o.tcut), 'boss title cut off: ' + JSON.stringify(r.filter(o => o.tcut)));
  assert(ov.boss[2] > ov.boss[0] && ov.boss[2] <= ov.w, 'setup: boss bar not on screen: ' + JSON.stringify(ov));
  assert(ov.area === 0, 'the boss bar covers the hero\'s HP panel: ' + JSON.stringify(ov));
});

test('phone: a boss\'s shout never covers the boss bar at the top', async () => {
  const g = await open({ size:'667x375', touch:true });
  const r = await g.run(() => {
    G.debug.arena('inu'); G.step(5);
    const e = G.foes.spawn('emperor', G.player.x + 3, 0, { boss:true }); G.ui.bossBar(e); G.step(40);
    const bar = document.querySelector('#iu .boss').getBoundingClientRect();
    // a world height whose screen position is the middle of the boss bar
    let wy = 0; for(let y=0; y<12; y+=0.05){ if(G.toScreen(e.x, y, e.z).y <= (bar.top + bar.bottom)/2){ wy = y; break; } }
    G.fx.text('ガオーーッ！', e.x, wy, e.z, 'onoma');
    let worst = 0, seen = 0;
    for(let k=0;k<40;k++){
      G.step(1);
      for(const w of document.querySelectorAll('.fxp.onoma')){
        const cs = getComputedStyle(w); if(cs.visibility!=='visible' || +cs.opacity < 0.05) continue; seen++;
        const q = w.getBoundingClientRect();
        const a = Math.max(0, Math.min(q.right, bar.right) - Math.max(q.left, bar.left)) * Math.max(0, Math.min(q.bottom, bar.bottom) - Math.max(q.top, bar.top));
        worst = Math.max(worst, a / Math.max(1, q.width*q.height));
      }
    }
    return { wy, seen, worst:+worst.toFixed(2), bar:[Math.round(bar.top), Math.round(bar.bottom)] };
  });
  const errs = await g.errors(); await g.close();
  assert(errs.length === 0, 'errors: ' + errs.slice(0,3).join(' | '));
  assert(r.wy > 0 && r.seen > 10, 'setup: ' + JSON.stringify(r));
  assert(r.worst === 0, 'the shout covered the boss bar: ' + JSON.stringify(r));
});

test('phone: showing the touch pad in the middle of a fight re-fits the fight to the smaller view', async () => {
  const g = await open({ size:'844x390', touch:true });
  await g.run(() => { G.seed(5); G.debug.play('inu', 0, 'normal'); G.step(5); const p = G.player; p.hp = p.maxHp = 1e9; p.inv = 1e9; });
  await g.page.keyboard.press('KeyD');                        // a key hides the pad (touch laptop / tablet keyboard)
  await g.run(() => { const p = G.player, s = G.stage.st; s.ptr = 0; p.x = s.seq[0].at; s.maxX = p.x; G.step(121); });
  const a = await g.run(() => ({ touch: G.ui.touch.visible, lockW: G.stage.st.lockB - G.stage.st.lockA, usableW: G.cam.usableW(), locked: G.stage.progress().locked }));
  await g.page.touchscreen.tap(420, 60); await g.run(() => G.step(10));
  const b = await g.run(() => ({ touch: G.ui.touch.visible, lockW: G.stage.st.lockB - G.stage.st.lockA, usableW: G.cam.usableW(), locked: G.stage.progress().locked }));
  const errs = await g.errors(); await g.close();
  assert(errs.length === 0, 'errors: ' + errs.slice(0,3).join(' | '));
  assert(a.locked && !a.touch && b.touch, 'setup: ' + JSON.stringify({ a, b }));
  assert(b.usableW < a.usableW - 1, 'setup: the pad did not shrink the view: ' + JSON.stringify({ a, b }));
  assert(b.lockW <= b.usableW + 0.01, 'the fight stayed wider than the view left by the pad: ' + JSON.stringify({ a, b }));
});

test('combat: a boss pushing the hero into the arena wall never shoves him out of the fight', async () => {
  const g = await open();
  const r = await g.run(() => {
    const R = G.renderer, real = R.render.bind(R); R.render = () => {};
    // stage 4: みつくびの ケルベ and its pups push the hero from both sides
    G.seed(11); G.debug.play('inu', 3, 'normal'); G.step(5);
    const p = G.player; p.hp = p.maxHp = 1e9;
    const s = G.stage.st; s.ptr = s.seq.findIndex(e => e.kind==='boss'); p.x = s.seq[s.ptr].at; s.maxX = p.x; G.step(1);
    const boss = s.active && s.active.ent; G.step(250);
    let out = 0, near = 0, worst = 1e9, sink = 0;
    for(let t=0;t<900;t++){
      G.input.touch.x = -1; p.inv = 999; G.step(1);
      const dx = p.x - (G.stage.st.lockA + p.radius);
      if(dx < -0.01) out++; if(dx < worst) worst = dx;
      if(boss && Math.abs(boss.x - p.x) < 2.5) near++;
      // standing on the ground in the same lane: the hero and the boss must not sink into each other
      if(boss && !boss.dead && boss.y < 0.6 && p.y < 0.6 && Math.abs(boss.z - p.z) < 0.42)
        sink = Math.max(sink, (boss.radius + p.radius) - Math.abs(boss.x - p.x));
    }
    G.input.touch.x = 0; R.render = real; G.step(1);
    return { boss: boss && boss.type, out, near, worst: +worst.toFixed(2), sink: +sink.toFixed(2) };
  });
  const errs = await g.errors(); await g.close();
  assert(errs.length === 0, 'errors: ' + errs.slice(0,3).join(' | '));
  assert(r.boss && r.near > 50, 'setup: the boss never came to the hero: ' + JSON.stringify(r));
  assert(r.out === 0, 'the hero was pushed outside the fight: ' + JSON.stringify(r));
  assert(r.sink < 0.05, 'the boss sank into the hero at the wall: ' + JSON.stringify(r));
});

test('progress: after the last stage every stage shows as cleared on the stage map', async () => {
  const g = await open();
  const r = await g.run(() => {
    try { localStorage.removeItem('inu25d_save'); } catch(_){}
    G.game.unlocked = 0;
    G.debug.play('inu', 6, 'normal'); G.step(5);
    G.scenes.play.showResult();
    G.go('select'); G.step(30);
    document.querySelector('#iu .select .sgo').click(); G.step(10);
    const cards = Array.from(document.querySelectorAll('#iu .stages .stc')).map(c => ({ clr: c.classList.contains('clr'), nxt: c.classList.contains('nxt'), lock: c.classList.contains('lock') }));
    return { shown: G.ui.isShown('stages'), cards };
  });
  const errs = await g.errors(); await g.close();
  assert(errs.length === 0, 'errors: ' + errs.slice(0,3).join(' | '));
  assert(r.shown && r.cards.length === 7, 'setup: stage map not shown: ' + JSON.stringify(r));
  assert(r.cards.every(c => c.clr), 'after the ending, not every stage shows as cleared: ' + JSON.stringify(r.cards));
});

test('phone portrait: a boss appears with room in front of the hero (not on top of him)', async () => {
  const g = await open({ size:'390x844', touch:true });
  const r = await g.run(() => {
    const R = G.renderer, real = R.render.bind(R); R.render = () => {};
    const out = [];
    for(const si of [0, 2, 6]){
      G.debug.play('inu', si, 'normal'); G.step(200);
      const s = G.stage.st, p = G.player; p.hp = p.maxHp = 1e9;
      s.ptr = s.seq.findIndex(e => e.kind==='boss'); const at = s.seq[s.ptr].at;
      p.x = at - 3; s.maxX = p.x; G.step(60);
      G.input.touch.x = 1; let n = 0; while(!s.active && n < 400){ G.step(1); n++; } G.input.touch.x = 0;
      const e = s.active && s.active.ent;
      out.push({ stage: si+1, boss: e && e.type, gap: e ? +(e.x - p.x).toFixed(2) : null, room: e ? +(e.x - p.x - e.radius - p.radius).toFixed(2) : null });
    }
    R.render = real; G.step(1);
    return out;
  });
  const errs = await g.errors(); await g.close();
  assert(errs.length === 0, 'errors: ' + errs.slice(0,3).join(' | '));
  assert(r.every(o => o.boss), 'setup: a boss did not appear: ' + JSON.stringify(r));
  // the hero needs about one step of room between his body and the boss's
  assert(r.every(o => o.room >= 1), 'a boss appeared on top of the hero: ' + JSON.stringify(r));
});

test('phone portrait: every hero of the title and ending line-up is on screen', async () => {
  const g = await open({ size:'390x844', touch:true });
  const r = await g.run(() => {
    const W = innerWidth, out = {};
    for(const sc of ['title', 'ending']){
      G.go(sc); out[sc] = [];
      // they cheer and bounce: look at several moments (the rig's own position, ±0.45 for the body)
      for(const n of [60, 340, 400, 400]){
        G.step(n);
        for(const e of G.world.ents.filter(e => e.kind==='deco')){
          const rp = e.rig && e.rig.root ? e.rig.root.position : e;
          const a = G.toScreen(rp.x - 0.45, rp.y + 0.6, rp.z), b = G.toScreen(rp.x + 0.45, rp.y + 0.6, rp.z);
          out[sc].push({ id: e.type, t: n, l: Math.round(a.x), r: Math.round(b.x) });
        }
      }
    }
    return { W, out };
  });
  const errs = await g.errors(); await g.close();
  assert(errs.length === 0, 'errors: ' + errs.slice(0,3).join(' | '));
  for(const sc of ['title', 'ending']){
    assert(r.out[sc].length === 28, 'setup: ' + sc + ' has ' + r.out[sc].length/4 + ' heroes');
    const off = r.out[sc].filter(h => h.l < 0 || h.r > r.W);
    assert(off.length === 0, sc + ': heroes off screen: ' + JSON.stringify(off) + ' W=' + r.W);
  }
});

test('phone portrait: the ending headline wraps between words, not inside one', async () => {
  const g = await open({ size:'390x844', touch:true });
  const r = await g.run(() => {
    G.go('ending'); G.step(30);
    const eh = document.querySelector('#iu .roll .eh');
    const lines = []; const walker = document.createTreeWalker(eh, NodeFilter.SHOW_TEXT); let n;
    while((n = walker.nextNode())){
      if(n.parentElement.tagName==='RT') continue;
      for(let i=0;i<n.length;i++){ const rg = document.createRange(); rg.setStart(n, i); rg.setEnd(n, i+1); const b = rg.getBoundingClientRect(); if(!b.width) continue;
        const y = Math.round(b.top); let L = lines.find(l => Math.abs(l.y - y) < 8); if(!L){ L = { y, t:'' }; lines.push(L); } L.t += n.data[i]; }
    }
    lines.sort((a, b) => a.y - b.y);
    return lines.map(l => l.t.replace(/\s/g, ''));
  });
  const errs = await g.errors(); await g.close();
  assert(errs.length === 0, 'errors: ' + errs.slice(0,3).join(' | '));
  assert(r.join('') === '★もふもふ聖犬士でんせつ★', 'setup: ' + JSON.stringify(r));
  assert(r.some(l => l.indexOf('でんせつ') >= 0) && r.some(l => l.indexOf('もふもふ聖犬士') >= 0), 'a word was split across lines: ' + JSON.stringify(r));
});

test('phone: the boss name banner stays clear of the touch buttons', async () => {
  const g = await open({ size:'667x375', touch:true });
  const r = await g.run(() => {
    G.debug.play('inu', 5, 'normal'); G.step(60);
    G.ui.banner('ひりゅう ヴォルカ', 'ワンワンていこく だい6のしょう', 140); G.step(40);
    const parts = Array.from(document.querySelectorAll('#iu .ban .bt span')).concat([document.querySelector('#iu .ban .bs')]).filter(Boolean);
    const btns = Array.from(document.querySelectorAll('#iu .tc .tb')).filter(b => getComputedStyle(b).display!=='none');
    let hit = 0, seen = 0;
    for(const p of parts){ const a = p.getBoundingClientRect(); if(a.width < 1) continue; seen++;
      for(const b of btns){ const q = b.getBoundingClientRect(); const w = Math.min(a.right, q.right) - Math.max(a.left, q.left), h = Math.min(a.bottom, q.bottom) - Math.max(a.top, q.top); if(w > 1 && h > 1) hit += w*h; } }
    return { seen, btns: btns.length, hit: Math.round(hit) };
  });
  const errs = await g.errors(); await g.close();
  assert(errs.length === 0, 'errors: ' + errs.slice(0,3).join(' | '));
  assert(r.seen > 5 && r.btns >= 4, 'setup: ' + JSON.stringify(r));
  assert(r.hit === 0, 'the banner covers a touch button: ' + JSON.stringify(r));
});

test('phone: a boss\'s long line is a speech bubble, clear of the HUD and the touch buttons', async () => {
  const g = await open({ size:'667x375', touch:true });
  const r = await g.run(() => {
    G.debug.play('inu', 6, 'normal'); G.step(30);
    const p = G.player; p.inv = 1e9;
    const e = G.foes.spawn('emperor', p.x + 4, -0.3, { boss:true, entrance:'none' }); e.ai = null; G.ui.bossBar(e); G.step(40);
    G.foes.h.say(e, 'ワンワンていこくの ちからを おもいしれ！');
    // and a comic word dropped right on the attack button
    const atk = document.querySelector('#iu .tc .tb.attack');
    const q = atk.getBoundingClientRect(), cx = (q.left + q.right)/2, cy = (q.top + q.bottom)/2;
    let best = null, bd = 1e9;
    for(let x = p.x - 2; x < p.x + 12; x += 0.25) for(let y = 0; y < 3; y += 0.25){ const s = G.toScreen(x, y, 1.6); const d = (s.x-cx)*(s.x-cx) + (s.y-cy)*(s.y-cy); if(d < bd){ bd = d; best = [x, y]; } }
    G.fx.text('ドカーン！', best[0], best[1], 1.6, 'onoma');
    const boxes = () => [document.querySelector('#iu .boss'), document.querySelector('#iu .hl')].concat(Array.from(document.querySelectorAll('#iu .tc .tb'))).filter(b => b && getComputedStyle(b).display!=='none').map(b => b.getBoundingClientRect());
    let worst = 0, bubble = 0, word = 0;
    for(let k=0;k<40;k++){
      G.step(1);
      const bx = boxes();
      for(const w of document.querySelectorAll('.fxp.say, .fxp.onoma')){
        const cs = getComputedStyle(w); if(cs.visibility!=='visible' || +cs.opacity < 0.05) continue;
        if(w.classList.contains('say') && w.textContent.indexOf('ちからを') >= 0) bubble++; if(w.textContent==='ドカーン！') word++;
        const a = w.getBoundingClientRect(); let ov = 0;
        for(const b of bx) ov += Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
        worst = Math.max(worst, ov / Math.max(1, a.width*a.height));
      }
    }
    return { bubble, word, worst: +worst.toFixed(2), aim: bd < 2025 };   // within 45 px of the button's centre (its radius is ~44)
  });
  const errs = await g.errors(); await g.close();
  assert(errs.length === 0, 'errors: ' + errs.slice(0,3).join(' | '));
  assert(r.aim && r.word > 10, 'setup: ' + JSON.stringify(r));
  assert(r.bubble > 10, 'the long line was not shown as a speech bubble: ' + JSON.stringify(r));
  assert(r.worst === 0, 'a line or word sat on the HUD / touch buttons: ' + JSON.stringify(r));
});

// ---------------------------------------------------------------- pad
test('pad: START opens the pause menu and START closes it again', async () => {
  const g = await open();
  const r = await g.run(async () => {
    const pad = { connected:true, axes:[0,0,0,0], buttons: Array.from({ length:17 }, () => ({ pressed:false, value:0 })) };
    navigator.getGamepads = () => [pad];
    const tap = (i) => { pad.buttons[i].pressed = true; G.step(6); pad.buttons[i].pressed = false; G.step(3); };
    const wait = () => new Promise(res => setTimeout(res, 600));   // menus ignore presses in their first 0.4 s
    G.debug.play('inu', 0, 'normal'); G.step(5);
    tap(9); const opened = G.paused; await wait();
    tap(9); const closed = !G.paused; await wait();
    tap(9); const again = G.paused;
    return { opened, closed, again };
  });
  const errs = await g.errors(); await g.close();
  assert(errs.length === 0, 'errors: ' + errs.slice(0,3).join(' | '));
  assert(r.opened, 'START did not open the pause menu: ' + JSON.stringify(r));
  assert(r.closed, 'START did not close the pause menu (it paused again at once): ' + JSON.stringify(r));
  assert(r.again, 'START did not open the pause menu a second time: ' + JSON.stringify(r));
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

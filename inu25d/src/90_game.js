// 90_game.js — 起動・場面の流れ・進行（リード担当）。
// タイトル → キャラえらび → ステージ（ウェーブ→ボス）→ けっか → つぎのステージ … → エンディング。
// むずかしさ・レベル・コンボ・ふっかつ（やさしい/ふつうは何度でも、つよいは3回まで）。
(function(){ 'use strict';
const G = window.G; const THREE = window.THREE; const U = G.U;

G.testMode = /(^|#)test\b/.test(location.hash);

// ---------------------------------------------------------------- persistence (optional; sandbox may throw)
const SAVE_KEY = 'inu25d_save';
function loadSave(){ try { const s = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); return s && typeof s==='object' ? s : {}; } catch(_){ return {}; } }
function writeSave(s){ try { localStorage.setItem(SAVE_KEY, JSON.stringify(s)); } catch(_){} }

// ---------------------------------------------------------------- difficulty
const DIFFS = {
  easy:   { name:'やさしい', heroDmg:1.3, foeDmg:0.5, foeHp:0.8,  attackers:1, foeSpeed:0.85, think:1.35, heroHp:1.2, lives:Infinity },
  normal: { name:'ふつう',   heroDmg:1.0, foeDmg:0.8, foeHp:1.0,  attackers:2, foeSpeed:1.0,  think:1.0,  heroHp:1.0, lives:Infinity },
  hard:   { name:'つよい',   heroDmg:0.9, foeDmg:1.2, foeHp:1.25, attackers:3, foeSpeed:1.12, think:0.8,  heroHp:1.0, lives:3 },
};
const RANKS = [ [2,'いいね！','#cfd8e6'], [8,'すごい！','#7dd0ff'], [16,'かっこいい！','#7dff5a'], [28,'さいこう！','#ffd24d'], [45,'でんせつ！','#ff9a3a'], [70,'でんせつ！！','#ff5aa0'] ];

const save = loadSave();
const game = G.game = {
  DIFFS, RANKS,
  diffKey: save.diff && DIFFS[save.diff] ? save.diff : 'normal',
  get diff(){ return DIFFS[this.diffKey]; },
  heroId: save.hero || 'inu',
  stageIndex: 0, unlocked: save.unlocked|0,
  level:1, xp:0, xpNext:60, coins:0,
  combo:0, comboT:0, comboRank:'', comboColor:'#fff', bestCombo:0,
  stageName:'', stageTime:0, revives:0, hurtCount:0, cutinT:0, clearT:0, koT:0,
  lives:3, ultCarry:0, soundOn: save.sound!==false,
  onHeroHit(src, t, dmg){
    this.combo++; this.comboT = 150;
    if(this.combo > this.bestCombo) this.bestCombo = this.combo;
    let rank = '', col = '#fff';
    for(const r of RANKS) if(this.combo >= r[0]){ rank = r[1]; col = r[2]; }
    if(rank && rank!==this.comboRank){ this.comboRank = rank; this.comboColor = col; G.bus.emit('combo', { count:this.combo, rank, rankUp:true, color:col }); }
    else G.bus.emit('combo', { count:this.combo, rank, color:col });
  },
  addXp(n){
    this.xp += n;
    while(this.xp >= this.xpNext){
      this.xp -= this.xpNext; this.level++; this.xpNext = Math.round(60*Math.pow(1.32, this.level-1));
      const p = G.player;
      if(p){
        const oldMax = p.maxHp;
        p.maxHp = Math.round(p.maxHp * 1.08); p.hp = p.maxHp; p.atkMul *= 1.05;
        G.bus.emit('levelUp', { ent:p, level:this.level, hpUp:p.maxHp-oldMax });
      }
    }
  },
};

// ---------------------------------------------------------------- shared helpers
function uiShow(name, data){ if(G.ui && G.ui.show){ try { G.ui.show(name, data||{}); } catch(err){ G.logError('ui.show '+name, err); } } }
function uiHide(name){ if(G.ui && G.ui.hide){ try { G.ui.hide(name); } catch(err){ G.logError('ui.hide '+name, err); } } }
function uiHideAll(){ if(G.ui && G.ui.hideAll){ try { G.ui.hideAll(); } catch(err){ G.logError('ui.hideAll', err); } } }
function bgm(name){ if(G.audio && G.audio.bgm){ try { G.audio.bgm(name); } catch(err){ G.logError('bgm', err); } } }
function sfx(name, o){ if(G.audio && G.audio.sfx){ try { G.audio.sfx(name, o); } catch(err){ G.logError('sfx', err); } } }
function banner(t, s, f){ if(G.ui && G.ui.banner) try { G.ui.banner(t, s||'', f||120); } catch(err){ G.logError('banner', err); } }
function touch(on){ if(G.ui && G.ui.touch && G.ui.touch.show) try { G.ui.touch.show(on); } catch(err){ G.logError('touch', err); } }
function heroList(){ return (G.heroes && G.heroes.list) || Object.keys(G.MOVES||{inu:1}).map(id=>({ id, name:id })); }
function stages(){ return G.stages || []; }
// flat test arena (tests & module authors): used instead of G.stage when G.debug.arena() started the run
const ARENA = {
  info:{ id:'arena', name:'テストのひろば', kana:'テストのひろば', length:60, bgm:'stage1' }, index:0, done:false, ground:null,
  load(){
    this.done = false;
    G.scene.background = new THREE.Color(0xbfe6ff);
    if(!this.ground){ const g = new THREE.Mesh(new THREE.PlaneGeometry(90, 12), G.look.mat('#a8dc84', { rough:0.95, rim:0 })); g.rotation.x = -Math.PI/2; g.position.set(30, 0, -0.2); g.receiveShadow = true; this.ground = g; }
    G.scene.add(this.ground);
  },
  unload(){ if(this.ground) G.scene.remove(this.ground); },
  tick(){}, frame(){},
  bounds(){ return { xmin:0, xmax:60, zmin:G.cfg.ZMIN, zmax:G.cfg.ZMAX }; },
};
function S(){ return G._arena ? ARENA : G.stage; }
function stepRigs(){
  for(const e of G.world.ents){
    e.animT++;
    if(e.rig && e.rig.update){ try { e.rig.update(e, G.cfg.TICK); } catch(err){ G.logError('rig.update '+e.type, err); e.rig.update = null; } }
  }
}
function frameCommon(dt){
  if(G.fx && G.fx.frame) try { G.fx.frame(dt); } catch(err){ G.logError('fx.frame', err); }
  if(G.stage && G.stage.frame) try { G.stage.frame(dt); } catch(err){ G.logError('stage.frame', err); }
  if(G.ui && G.ui.frame) try { G.ui.frame(dt); } catch(err){ G.logError('ui.frame', err); }
}

// decorative heroes for title / select / ending
const deco = [];
function clearDeco(){ for(const e of deco) G.world.remove(e); deco.length = 0; }
function addDeco(id, x, z, anim, face){
  let rig = null;
  try { rig = G.heroes && G.heroes.build ? G.heroes.build(id) : null; } catch(err){ G.logError('deco build', err); }
  if(!rig) return null;
  const e = G.makeEnt({ kind:'deco', type:id, team:4, x, z, face: face==null?1:face, rig, radius:0.4, height:rig.height||1.3 });
  G.setAnim(e, anim||'pose');
  e.animT = Math.floor(Math.random()*60);
  G.world.add(e); deco.push(e);
  return e;
}
function loadBackdrop(i){
  try {
    if(G.stage && G.stage.titleScene && i==null) G.stage.titleScene();
    else if(G.stage && G.stage.load) G.stage.load(i||0);
  } catch(err){ G.logError('backdrop', err); }
}
function backdropUp(){ return !!(G.stage && G.stage.env && G.stage.env.root && G.stage.env.root.parent); }
function unloadStage(){ try { if(G.stage && G.stage.unload) G.stage.unload(); } catch(err){ G.logError('stage.unload', err); } if(typeof ARENA!=='undefined') ARENA.unload(); }

// ---------------------------------------------------------------- scene: title
G.scenes.title = {
  enter(){
    G.world.clear(); G.combat && G.combat.clear(); clearDeco();
    unloadStage(); loadBackdrop(null);
    G.player = null;
    const list = heroList();
    list.forEach((h, i)=> addDeco(h.id, 2.5 + (i-(list.length-1)/2)*1.35, 0.9 - Math.abs(i-(list.length-1)/2)*0.25, i%2 ? 'cheer' : 'pose', 1));
    G.cam.followEnt = null; G.cam.unlock(); G.cam.zoom = 3.5;
    G.cam.tx = 2.5; G.cam.ty = 1.25; G.cam.tz = 0.2; G.cam.snap();
    touch(false);
    uiHideAll();
    uiShow('title', { difficulty: game.diffKey, soundOn: game.soundOn,
      onPlay(d){ if(d && DIFFS[d]) game.diffKey = d; persist(); sfx('ok'); G.go('select'); },
      onSound(on){ setSound(on); } });
    bgm('title');
  },
  exit(){ uiHide('title'); clearDeco(); },
  tick(){
    stepRigs();
    const t = G.time.sceneTick;
    G.cam.tx = 2.5 + Math.sin(t*0.004)*0.6;
    for(const e of deco){ if(e.anim==='cheer' && e.animT > 200 + (e.id%5)*40){ G.setAnim(e,'pose'); } else if(e.anim==='pose' && e.animT > 300 + (e.id%7)*30){ G.setAnim(e,'cheer'); } }
  },
  frame: frameCommon,
};
function persist(){ writeSave({ diff:game.diffKey, hero:game.heroId, unlocked:game.unlocked, sound:game.soundOn }); }
function setSound(on){ game.soundOn = !!on; if(G.audio && G.audio.setMuted) try { G.audio.setMuted(!game.soundOn); } catch(_){} persist(); }

// ---------------------------------------------------------------- scene: select
G.scenes.select = {
  enter(){
    clearDeco();
    if(!backdropUp()) { unloadStage(); loadBackdrop(null); }
    const list = heroList();
    let focus = Math.max(0, list.findIndex(h=>h.id===game.heroId));
    list.forEach((h, i)=> addDeco(h.id, (i-focus)*1.6, -0.6, 'pose', 1));
    const place = ()=>{ deco.forEach((e,i)=>{ e.tx = (i-focus)*1.7; e.tz = i===focus ? 0.9 : -0.8; }); };
    this.focus = (id)=>{ const i = list.findIndex(h=>h.id===id); if(i>=0){ focus = i; game.heroId = id; place(); const e = deco[i]; if(e) G.setAnim(e, 'cheer'); sfx('select'); } };
    place();
    G.cam.followEnt = null; G.cam.zoom = 6; G.cam.tx = 0; G.cam.ty = 1.0; G.cam.tz = 0.4; G.cam.snap();
    uiShow('select', { heroes:list, selected:game.heroId,
      onFocus:(id)=> this.focus(id),
      onPick:(id)=>{ if(id) game.heroId = id; persist(); sfx('ok'); chooseStage(); },
      onBack:()=>{ sfx('cancel'); G.go('title'); } });
    bgm('select');
  },
  exit(){ uiHide('select'); clearDeco(); },
  tick(){
    for(const e of deco){ if(e.tx!=null){ e.x = U.lerp(e.x, e.tx, 0.12); e.z = U.lerp(e.z, e.tz, 0.12); } if(e.anim==='cheer' && e.animT>90) G.setAnim(e,'pose'); }
    stepRigs();
  },
  frame: frameCommon,
};

// ---------------------------------------------------------------- a run: several stages in a row
// with saved progress, offer the stage map (cleared stages + the next one); otherwise start at stage 1
function chooseStage(){
  const n = stages().length, open = U.clamp(game.unlocked|0, 0, Math.max(0, n-1));
  if(open > 0 && G.ui && G.ui.show && G.ui.hasScreen && G.ui.hasScreen('stages')){
    const list = stages().map((s, i)=> ({ name:s.name, kana:s.kana, locked: i > open, cleared: i < open }));
    uiShow('stages', { stages:list, onPick:(i)=>{ sfx('ok'); uiHide('stages'); startRun(U.clamp(i|0, 0, open)); }, onBack:()=>{ sfx('cancel'); uiHide('stages'); } });
  } else startRun(0);
}
function startRun(start){
  G._arena = false; G._autoplay = false;
  start = start|0;
  // starting later in the adventure: give the hero the level a player would roughly have by then
  game.level = start > 0 ? 1 + start*2 : 1; game.xp = 0; game.xpNext = Math.round(60*Math.pow(1.32, game.level-1));
  game.coins = 0; game.bestCombo = 0; game.ultCarry = 0;
  game.lives = game.diff.lives;
  G.go('play', { stage:start });
}

// ---------------------------------------------------------------- scene: play
const play = G.scenes.play = {
  enter(params){
    G.world.clear(); G.combat.clear(); clearDeco(); uiHideAll();
    G.hitStop = 0; G.paused = false; if(G.fx) G.fx.worldFrozen = false;
    game.stageIndex = params.stage|0;
    game.combo = 0; game.comboT = 0; game.comboRank = ''; game.stageTime = 0; game.revives = 0; game.hurtCount = 0;
    game.cutinT = 0; game.clearT = 0; game.koT = 0; this.cleared = false; this.over = false;
    unloadStage(); ARENA.unload();
    try { S().load(game.stageIndex); } catch(err){ G.logError('stage.load', err); }
    const st = S().info || stages()[game.stageIndex] || { name:'', kana:'' };
    game.stageName = st.kana || st.name || '';
    const p = G.player = G.playerCtl.create(game.heroId, 2.5, 0);
    G.world.add(p);
    if(G.heroes && G.heroes.portrait){ try { for(const ex of ['normal','hurt','happy']) G.heroes.portrait(game.heroId, { size:160, expr:ex }); G.heroes.portrait(game.heroId); } catch(err){ G.logError('portrait prewarm', err); } }
    G.cam.follow(p); G.cam.unlock(); G.cam.zoom = 0; G.cam.snap();
    uiShow('hud', {});
    touch(true);
    banner('ステージ ' + (game.stageIndex+1), game.stageName, 150);
    bgm(st.bgm || ('stage'+(game.stageIndex+1)));
    G.bus.emit('stageStart', { index:game.stageIndex, stage:st });
    G.input.clear();
  },
  exit(){
    ARENA.unload();
    uiHide('hud'); uiHide('pause'); touch(false);
    if(G.ui && G.ui.bossBar) try { G.ui.bossBar(null); } catch(_){}
    if(G.ui && G.ui.go) try { G.ui.go(false); } catch(_){}
    G.combat.clear(); G.world.clear(); G.player = null; G.paused = false;
  },
  pause(on){
    if(on===G.paused) return;
    G.paused = on;
    if(G.fx) G.fx.worldFrozen = !!on;
    if(on){
      G.bus.emit('pause', {});
      uiShow('pause', { soundOn:game.soundOn,
        onResume:()=> this.pause(false),
        onRetry:()=>{ this.pause(false); G.go('play', { stage:game.stageIndex }); },
        onTitle:()=>{ this.pause(false); G.go('title'); },
        onSound:(v)=> setSound(v) });
      if(G.audio && G.audio.pause) G.audio.pause(true);
    } else {
      uiHide('pause');
      if(G.audio && G.audio.pause) G.audio.pause(false);
      G.input.clear();
    }
  },
  tick(){
    const b = G.input.btn;
    if(this.over) return;            // game-over screen owns input; Esc must not resume the world behind it
    if(b.pause.pressed && !this.cleared && !(game.cutinT > 0)){ this.pause(!G.paused); return; }
    if(G.paused) return;
    const p = G.player;

    // ult cut-in: the world holds still while the cut-in plays
    if(p && (game.cutinT > 0 || G.hitStop > 0)) G.playerCtl.queue(p);
    if(game.cutinT > 0){
      game.cutinT--;
      if(p){ p.animT++; if(p.rig && p.rig.update) p.rig.update(p, G.cfg.TICK); }
      if(game.cutinT===0 && p) G.playerCtl.tick(p);
      return;
    }
    if(G.hitStop > 0){ G.hitStop--; return; }

    game.stageTime++;
    if(game.comboT > 0 && --game.comboT===0){ if(game.combo>=8) G.bus.emit('comboEnd', { count:game.combo }); game.combo = 0; game.comboRank = ''; }

    try { S().tick(); } catch(err){ G.logError('stage.tick', err); }
    if(p && G._autoplay) autoDrive(p);
    if(p) G.playerCtl.tick(p);
    const ents = G.world.ents;
    for(let i=0;i<ents.length;i++){
      const e = ents[i];
      if(e.team===1) G.foes.tick(e);
      else if(e.kind==='pickup') G.pickups.tick(e);
    }
    G.combat.tick();
    const bounds = S().bounds ? S().bounds() : null;
    for(let i=0;i<ents.length;i++){
      const e = ents[i];
      if(e.kind==='prop' || e.kind==='deco') continue;
      if(e.flashT>0 && e.team!==1 && e!==p) e.flashT--;
      G.phys(e, (e.team===1 && !e.entered) ? null : bounds);
    }
    separate(ents);
    stepRigs();

    // hero knocked out → cheer up and revive (or lose a life on つよい)
    if(p && p.dead){
      game.koT++;
      if(game.koT===30) banner('がんばれ！', game.lives===Infinity ? '' : 'のこり ' + Math.max(0, game.lives-1), 90);
      if(game.koT >= 100){
        game.koT = 0;
        if(game.lives!==Infinity && !this.cleared){ game.lives--; }
        if(game.lives!==Infinity && game.lives<=0 && !this.cleared){ this.gameOver(); return; }
        p.dead = false; p.hp = p.maxHp; p.inv = 180; p.vy = 0.12; p.onGround = false; p.sp = 3;
        G.setState(p, 'air'); G.setAnim(p, 'jump');
        game.revives++;
        G.bus.emit('revive', { ent:p });
      }
    }
    // stage clear
    if(S().done && !this.cleared){ this.cleared = true; game.clearT = 0; game.victT = 0; this.winGuard(); }
    if(this.cleared){
      game.clearT++;
      if(p) p.inv = Math.max(p.inv, 30);
      const bossStill = G.world.ents.some(e=> e.def && e.def.boss && !e.removed);
      if(!game.victT && ((!bossStill && game.clearT > 30) || game.clearT > 330)) game.victT = game.clearT;
      const v = game.victT ? game.clearT - game.victT : -1;
      if(v===0 && p && !p.dead){ G.combat.cancel(p); G.setState(p, 'victory'); G.setAnim(p, 'victory'); if(G.audio && G.audio.voice) G.audio.voice(p.type, 'win'); }
      if(v===10){ banner('ステージクリア！', game.stageName, 150); bgm('clear'); }
      if(v===170) this.showResult();
    }
  },
  frame: frameCommon,
  // the stage is won: nothing may hurt the hero any more, and the boss's drops fly to the hero
  winGuard(){
    for(const pr of G.combat.projectiles) if(pr.team===1) pr.life = 0;
    G.combat.areas.length = 0;
    const p = G.player; if(p){ p.inv = Math.max(p.inv, 9999); if(p.dead){ p.dead = false; p.hp = Math.max(1, Math.ceil(p.maxHp*0.5)); G.setState(p, 'idle'); G.setAnim(p, 'idle'); } }
  },
  showResult(){
    const idx = game.stageIndex, last = idx >= stages().length-1;
    let stars = 3 - Math.min(2, game.revives) - (game.hurtCount > 14 ? 1 : 0);
    stars = U.clamp(stars, 1, 3);
    game.unlocked = Math.max(game.unlocked, Math.min(stages().length-1, idx+1)); persist();
    const p = G.player; if(p) game.ultCarry = p.ult;
    G.bus.emit('stageClear', { index:idx, stars, time:Math.round(game.stageTime/60), coins:game.coins });
    touch(false);
    uiShow('result', { stageName:game.stageName, stars, time:Math.round(game.stageTime/60), coins:game.coins, bestCombo:game.bestCombo, last,
      onNext:()=>{ sfx('ok'); if(last) G.go('ending'); else G.go('play', { stage: idx+1 }); } });
  },
  gameOver(){
    this.over = true; touch(false);
    if(G.fx) G.fx.worldFrozen = true;
    bgm('over');
    uiShow('over', { onRetry:()=>{ game.lives = game.diff.lives; G.go('play', { stage:game.stageIndex }); }, onTitle:()=> G.go('title') });
    G.paused = true;
  },
};
// test bot: pushes G.input.touch like a (clumsy) kid would
function autoDrive(p){
  const T = G.input.touch;
  for(const k of ['attack','jump','dodge','special','ult']) T[k] = false;
  T.x = 0; T.z = 0;
  if(p.dead || p.state==='victory') return;
  let best = null, bd = 1e9;
  for(const e of G.world.ents){ if(e.team!==1 || e.dead || e.intangible) continue; const d = Math.abs(e.x-p.x) + Math.abs(e.z-p.z)*1.5; if(d<bd){ bd=d; best=e; } }
  const t = G.time.sceneTick;
  if(!best){
    // walk right toward the next wave; pick up things on the way
    T.x = 1; T.z = U.clamp(-p.z*0.5, -1, 1);
    return;
  }
  const dx = best.x - p.x, dz = best.z - p.z;
  const want = best.def && best.def.boss ? 1.4 : 1.0;
  if(Math.abs(dz) > 0.3) T.z = U.clamp(dz*2, -1, 1);
  if(Math.abs(dx) > want + 0.3) T.x = Math.sign(dx);
  else if(Math.abs(dx) < 0.5) T.x = -Math.sign(dx || 1);
  else if(Math.sign(dx)!==p.face) T.x = Math.sign(dx)*0.3;
  const close = Math.abs(dx) < want + 0.5 && Math.abs(dz) < 0.45;
  if(p.ult >= 100 && close){ T.ult = true; G.input.latch('ult'); return; }
  if(close && t % 7 === 0){ T.attack = true; G.input.latch('attack'); }
  if(close && p.sp >= 2 && t % 97 === 0){ T.special = true; G.input.latch('special'); }
  if(best.atk || best.pending){ if(t % 23 === 0){ T.dodge = true; G.input.latch('dodge'); } }
  if(t % 181 === 0){ T.jump = true; G.input.latch('jump'); }
}

// soft body separation so foes don't stack into one blob (heroes get pushed less)
function separate(ents){
  for(let i=0;i<ents.length;i++){
    const a = ents[i]; if(!(a.team===0 || a.team===1) || a.dead || a.intangible || a.y > 0.6) continue;
    for(let j=i+1;j<ents.length;j++){
      const c = ents[j]; if(!(c.team===0 || c.team===1) || c.dead || c.intangible || c.y > 0.6) continue;
      const dz = c.z - a.z; if(Math.abs(dz) > 0.42) continue;
      const bossPair = (a.def && a.def.boss) || (c.def && c.def.boss);
      const dx = c.x - a.x, min = (a.radius + c.radius)*(bossPair ? 1 : 0.8);
      if(Math.abs(dx) >= min) continue;
      if(bossPair && (a.team===0 || c.team===0)){
        const hero = a.team===0 ? a : c, boss = hero===a ? c : a;
        const s = hero.x >= boss.x ? 1 : -1; hero.x = boss.x + s*min; continue;
      }
      const push = (min - Math.abs(dx)) * 0.25 * (dx===0 ? (a.id<c.id?1:-1) : Math.sign(dx));
      const wa = a.team===0 ? 0.25 : (a.def&&a.def.boss ? 0.1 : 1), wc = c.team===0 ? 0.25 : (c.def&&c.def.boss ? 0.1 : 1);
      a.x -= push*wa; c.x += push*wc;
    }
  }
}
G.bus.on('hurt', (d)=>{ if(d.ent===G.player) game.hurtCount++; });
G.bus.on('ko', (d)=>{ const e = d.ent; if(e && e.def && G.player){ game.addXp(Math.round((e.def.xp||10) * (1 + Math.min(1, game.combo/40)))); } });
G.bus.on('bossIntro', (d)=>{
  const boss = d && d.boss;
  if(G.ui && G.ui.bossBar && boss) try { G.ui.bossBar(boss); } catch(_){}
  banner(d.name || 'ボス', d.title || '', 140);
  bgm(d.bgm || (boss && boss.type==='emperor' ? 'final' : 'boss'));
  if(boss){ G.cam.focus(boss.x, 1.4 + (boss.height||2)*0.3, boss.z, 70, 3); G.cam.zoom = boss.height>2.5 ? -2 : -1; }
});
G.bus.on('bossDown', (d)=>{
  if(G.ui && G.ui.bossBar) try { G.ui.bossBar(null); } catch(_){}
  G.cam.zoom = 0;
});
// the stage-7 mid-boss is purified: back to the stage's own music until the final boss
G.bus.on('midClear', ()=>{ if(G.sceneName==='play'){ const st = S().info || {}; bgm(st.bgm || ('stage'+(game.stageIndex+1))); } });
// phone switched apps / tab hidden: pause (kids come back to a pause menu, not a lost fight)
G.bus.on('hidden', ()=>{ if(G.sceneName==='play' && !play.over && !play.cleared && !(game.cutinT>0)) play.pause(true); });

// ---------------------------------------------------------------- scene: ending
G.scenes.ending = {
  enter(){
    G.world.clear(); clearDeco(); uiHideAll(); unloadStage(); loadBackdrop(null);
    const list = heroList();
    list.forEach((h, i)=> addDeco(h.id, (i-(list.length-1)/2)*1.3, 0.5, 'cheer', 1));
    G.cam.followEnt = null; G.cam.zoom = 3; G.cam.tx = 0; G.cam.ty = 1.4; G.cam.tz = 0.2; G.cam.snap();
    bgm('ending');
    uiShow('ending', { heroId:game.heroId, onTitle:()=> G.go('title') });
  },
  exit(){ uiHide('ending'); clearDeco(); },
  tick(){
    stepRigs();
    const t = G.time.sceneTick;
    if(t % 40 === 0 && G.fx && G.fx.burst){ const hw = G.cam.halfW; G.fx.burst('fireworks', U.rand(G.cam.x - hw*0.8, G.cam.x + hw*0.5), G.cam.y + U.rand(1.0, 2.3), -3, { scale:1.3 }); }
  },
  frame: frameCommon,
};

// ---------------------------------------------------------------- debug: model showcase (viewer scene)
const showcase = { ents: [], ground: null };
G.scenes.viewer = {
  enter(){
    G.scene.background = new THREE.Color(0xbfe6ff);
    if(!showcase.ground){
      const g = new THREE.Mesh(new THREE.CircleGeometry(30, 48), G.look.mat('#9fd67a', { rough:0.95, rim:0 }));
      g.rotation.x = -Math.PI/2; g.receiveShadow = true;
      showcase.ground = g;
    }
    G.scene.add(showcase.ground);
  },
  exit(){
    for(const e of showcase.ents) G.world.remove(e);
    showcase.ents.length = 0;
    if(showcase.ground) G.scene.remove(showcase.ground);
  },
  tick(){
    for(const e of showcase.ents){
      e.animT++; e.stateT++;
      if(e.flashT>0) e.flashT--;
      if(e.rig && e.rig.update){ try { e.rig.update(e, G.cfg.TICK); } catch(err){ G.logError('rig.update '+e.type, err); } }
    }
  },
  frame: frameCommon,
};
G.debug = {
  showcase(items, opts){
    opts = opts || {};
    if(G.sceneName!=='viewer') G.go('viewer');
    for(const e of showcase.ents) G.world.remove(e);
    showcase.ents.length = 0;
    const gap = opts.gap || 2.2, n = items.length;
    items.forEach((it, i)=>{
      let rig = null, kind = 'prop', type = String(it);
      try {
        if(typeof it === 'function'){ rig = it(); type = 'custom'+i; }
        else if(G.heroes && G.heroes.get && G.heroes.get(it)){ rig = G.heroes.build(it); kind='hero'; }
        else if(G.foes && G.foes.types && G.foes.types[it]){ rig = G.foes.build(it); kind='foe'; }
      } catch(err){ G.logError('showcase build '+type, err); }
      if(!rig) return;
      const e = G.makeEnt({ kind, type, x:(i-(n-1)/2)*gap, z:opts.z||0, face: opts.face==null?1:opts.face, rig,
        radius: rig.radius || 0.45, height: rig.height || 1.2, hp:10, maxHp:10 });
      if(kind==='foe') e.def = G.foes.types[type];
      G.setAnim(e, opts.anim || 'idle', opts.len || 0, opts.hitAt);
      G.world.add(e);
      showcase.ents.push(e);
    });
    const span = Math.max(1, (n-1)*gap);
    G.cam.followEnt = null; G.cam.unlock();
    G.cam.tx = 0; G.cam.ty = 0.9; G.cam.tz = 0;
    G.cam.zoom = opts.zoom!=null ? opts.zoom : (G.cam.baseDist - Math.max(6, span*1.25+3));
    G.cam.snap();
    return showcase.ents;
  },
  anim(name, len, hitAt){ for(const e of showcase.ents) G.setAnim(e, name, len||0, hitAt); },
  ents: ()=> showcase.ents,
  // jump straight into a stage (tests): G.debug.play('inu', 0)
  play(hero, stage, diff){ if(hero) game.heroId = hero; if(diff) game.diffKey = diff; game.lives = game.diff.lives; G.go('play', { stage: stage|0 }); return G.player; },
  // flat arena run for testing foes/bosses: G.debug.arena('inu'); G.foes.spawn('wanhei', 8, 0)
  arena(hero, diff){ G._arena = true; if(hero) game.heroId = hero; if(diff) game.diffKey = diff; game.lives = game.diff.lives; G.go('play', { stage:0 }); return G.player; },
  // a simple bot drives the hero (walks to foes, attacks, jumps, uses specials / ult)
  autoplay(on){ G._autoplay = on!==false; if(!G._autoBound){ G._autoBound = true; G.bus.on('scene', ()=>{}); } },
  // press a button for n ticks (tests)
  press(btn, frames){ G.input.touch[btn] = true; G.input.latch(btn); G.step(frames||1); G.input.touch[btn] = false; G.step(1); },
};

// ---------------------------------------------------------------- boot
const MODULE_ORDER = ['look','heroes','foes','stage','combat','pickups','props','fx','audio','ui'];
G.boot = function(){
  const canvas = document.getElementById('game');
  const msg = (t)=>{ const el = document.getElementById('bootmsg'); if(el) el.textContent = t; };
  if(!G.initRenderer(canvas)){
    G.bootError = 'webgl';
    msg('このきかいでは 3D が うごかないみたい…（WebGL がつかえません）');
    return;
  }
  for(const name of MODULE_ORDER){
    const m = G[name];
    if(m && typeof m.init === 'function'){
      try { m.init(); } catch(err){ G.logError('init '+name, err); }
    }
  }
  if(G.audio && G.audio.setMuted) try { G.audio.setMuted(!game.soundOn); } catch(_){}
  G.ready = true;
  const boot = document.getElementById('boot');
  if(boot){ boot.style.transition = 'opacity .35s'; boot.style.opacity = '0'; setTimeout(()=> boot.remove(), 400); }
  if(G.testMode){ G.go('viewer'); G.step(1); return; }
  G.go('title');
  G.start();
};
G.boot();
})();

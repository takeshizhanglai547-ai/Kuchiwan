'use strict';
const {setup,root}=require('./story_harness.cjs'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const report={kind:'Actual boss modules, cinematic coordinator, core stepping and play scene; CPU/DOM fixture only',bosses:[],characterEvents:[],lifecycle:[]};
const types=['garm','shark','ghost','cerbe','slime','dragon','kuroinu','emperor'];
{const {G}=setup();assert.deepEqual(Object.entries(G.foes.types).filter(([id,d])=>d.boss).map(([id])=>id).sort(),types.slice().sort(),'all actual registered bosses covered');assert.deepEqual(Array.from(G.heroes.ids).sort(),Object.keys(G.story.heroes).sort(),'all playable characters covered');}
for(const type of types)for(const form of (type==='emperor'?[1,2,3]:[1])){
 const g=setup(),{G,n,p}=g,b=g.spawn(type);if(form>1){b.form=form;b.def=G.foes.types.emperor['_form'+form];b.phase=0;}
 const full=b.maxHp;b.hp=full*.5;G.bus.emit('hit',{target:b,dmg:1});assert.equal(b.phase,0,type+' exactly half');assert.equal(G.story.pending,0);
 const lines=[];G.fx.text=(text,x,y,z,style,o)=>{if(o?.ent===b)lines.push({text,style});};
 b.hp=full*.5-1;G.bus.emit('hit',{target:b,dmg:1});assert.equal(b.phase,1);assert.equal(G.story.pending,0);
 assert.equal(lines.length,1);assert.equal(lines[0].style,'say');
 G.foes.tick(b);assert(!b._phaseEventHold);
 const clock=G.time.tick,native=n.clock;g.step(35);assert(G.time.tick>clock);assert(n.clock>native);
 b.hp=full;G.bus.emit('hit',{target:b,dmg:0});b.hp=1;G.bus.emit('hit',{target:b,dmg:999});
 assert.equal(lines.length,1,'healing cannot retrigger');
 assert.deepEqual(Array.from(G.errors),[]);report.bosses.push({type,form,strictThreshold:true,singleTrigger:true,combatClockContinues:true});
}
for(const type of types){
 const large=setup(),lb=large.spawn(type),amount=Math.floor(lb.maxHp*.72);large.G.combat.damage(lb,amount,{dir:1,power:2});assert.equal(lb.phase,1,type+' large nonlethal crosses threshold');assert.equal(large.G.story.pending,0);assert(lb.hp<lb.maxHp*.5&&lb.hp>0,'damage is not clamped to threshold');
 const g=setup(),{G}=g,b=g.spawn(type);G.combat.damage(b,b.maxHp*4,{dir:1,power:3});G.hitStop=0;
 assert.equal(G.story.pending,0,'lethal never queues boss story '+type);
 assert(type==='emperor'?b.form===2&&!b.dead:b.dead,type+' actual lethal/transform');
 // If a later hit kills a boss in the same tick as the threshold, defeat wins.
 const g2=setup(),boss=g2.spawn(type);boss.hp=boss.maxHp*.4;g2.G.bus.emit('hit',{target:boss,dmg:1});assert.equal(g2.G.story.pending,0);
 boss.dead=true;boss.hp=0;g2.G.hitStop=0;g2.G.story.flush();assert.equal(g2.G.story.blocked,false);assert.equal(g2.G.story.pending,0);
}
const heroes=['inu','shima','nuko','guard8','watch','wanden','mack'],signatures=new Set();
{const g=setup(),{G}=g,b=g.spawn('emperor');b.x=g.p.x+.6;b.hp=1;g.key('KeyJ');g.step();g.key('KeyJ',false);g.step(200);
 assert.equal(b.form,2,'native player hit preserves actual emperor transformation');assert.equal(b.dead,false);assert.equal(G.story.pending,0);
 b.inv=0;b.state='idle';b.hp=b.maxHp*.5;g.key('KeyJ');g.step();g.key('KeyJ',false);g.step(20);
 assert.equal(b.phase,1,'native player hit triggers second-bar half-health hook');assert.equal(G.story.pending,0);report.lifecycle.push('native command damage preserves emperor form change and triggers second-bar speech');}
{const g=setup(),{G,n}=g;G.story.beginStage('inu',0);G.story.flush();const t=G.time.tick,c=n.clock;g.step(240);assert(G.story.blocked);assert(G.story.skip());assert.equal(G.time.tick,t);g.step();assert.equal(G.time.tick,t+1);assert.equal(n.clock,c+1);assert.equal(G.cam.focusT,0);report.lifecycle.push('reading persists until Continue and then resumes combat');}
for(const hero of heroes){const g=setup(hero),{G,p}=g;
 assert.equal(G.stages.length,9);const spec=G.story.heroes[hero];assert.equal(spec.start.length,9);assert.equal(spec.clear.length,9);
 for(let stage=0;stage<G.stages.length;stage++){
  G.game.stageName=G.stages[stage].kana;G.story.beginStage(hero,stage);assert.equal(G.story.pending,1);G.story.flush();
  const before=G.time.tick;g.step(80);assert.equal(G.time.tick,before);assert.equal(p.rig.st.storyPose.hero,hero);assert.equal(p.rig.st.storyPose.kind,'intro');
  assert.equal(G.story.active.lines[1],spec.start[stage]);assert(G.story.skip());
  assert(G.story.clearStage());assert.equal(G.story.clearStage(),false);G.story.flush();g.step(80);assert.equal(p.rig.st.storyPose.kind,'clear');
  assert.equal(G.story.active.lines[1],spec.clear[stage]);signatures.add(hero+':'+JSON.stringify(Object.fromEntries(['aLz','aRz','wz','twist','lean'].map(k=>[k,p.rig.st.P[k]]))));assert(G.story.skip());
  assert.equal(G.story.clearStage(),false);report.characterEvents.push({hero,stage:stage+1,introOnce:true,clearOnce:true,actualRigPose:true});
 }
 assert.deepEqual(Array.from(G.errors),[]);
}
assert(signatures.size>=7,'character poses must differ');
// Queue order, death deferral, lifecycle reset and stale touch/key rejection.
{const g=setup(),{G,p}=g;G.story.beginStage('inu',0);const boss=g.spawn('garm');boss.hp=boss.maxHp*.4;G.bus.emit('hit',{target:boss,dmg:1});
 assert.equal(G.story.pending,1);p.dead=true;assert.equal(G.story.flush(),false);
 p.dead=false;assert(G.story.flush());assert.equal(G.story.active.kind,'intro');assert.equal(G.story.skip(),false);
 assert.equal(G.combat.damage(boss,999,{dir:1}),false);
 g.step(30);G.input.touch.attack=true;G.input.latch('attack');G.story.skip();assert.equal(G.input.touch.attack,false);
 assert.equal(G.story.flush(),false);g.step(40);assert.equal(g.trace().actions.filter(a=>a.state==='attack').length,0);
 G.story.beginStage('inu',0);assert.equal(G.story.pending,1);G.story.reset();assert.equal(G.story.pending,0);assert.equal(G.story.blocked,false);report.lifecycle.push('stage event waits for revive; touch edges discarded; reset cancels old attempt');}
// Execute the real play scene lifecycle, rather than only calling coordinator methods.
{const g=setup('inu',true),{G}=g;g.step();assert.equal(G.story.active.kind,'intro');g.step(30);G.story.skip();
 const stageTime=G.game.stageTime;g.step(2);assert(G.game.stageTime>stageTime);
 G.player.dead=true;G.player.hp=0;G.game.koT=99;G.game.lives=1;G.stage.done=true;G.hitStop=0;g.step();
 assert.equal(G.scenes.play.cleared,true);assert.equal(G.player.dead,false);assert.equal(G.game.lives,1,'stage clear wins simultaneous final-life KO');
 g.step(40);assert.equal(G.story.active.kind,'clear');g.step(30);G.story.skip();
 G.scenes.play.showResult();const run=G.story.run;G.go('play',{stage:1});g.step();assert.equal(G.game.stageIndex,1);assert.equal(G.story.run,run+1);assert.equal(G.story.active.kind,'intro');
 G.go('play',{stage:1});g.step();assert.equal(G.story.active.kind,'intro');assert.equal(G.story.pending,0,'retry resets, not duplicates');
 G.go('title');assert.equal(G.story.blocked,false);assert.deepEqual(Array.from(G.errors),[]);report.lifecycle.push('actual play enter/clear/simultaneous KO/progression/retry/exit');}
report.status='PASS_CPU';report.limits='No browser, GPU, DOM layout, trusted pointer events, actual mobile device or human difficulty acceptance. Previous browser charge issue remains unresolved.';
{const g=setup('watch',true),{G}=g;g.step();g.step(30);G.story.skip();const boss=g.spawn('garm');boss.hp=boss.maxHp*.4;G.bus.emit('hit',{target:boss,dmg:1});
 G.player.inv=0;G.published.native().player.invuln=0;G.combat.damage(G.player,999999,{dir:1,power:3});G.hitStop=0;G.game.koT=99;G.game.lives=1;g.step();
 assert.equal(G.scenes.play.over,true);assert.equal(G.story.pending,0);assert.equal(G.paused,true);
 G._shown.over.onRetry();g.step();assert.equal(G.game.lives,3);assert.equal(G.story.active.kind,'intro');assert.equal(G.story.pending,0);assert.equal(boss.removed,true);
 g.step(30);G.story.skip();g.step();assert.equal(G.published.trace().actions.filter(a=>a.state==='attack').length,0);report.lifecycle.push('actual final-life game-over clears battle state; UI retry creates clean intro without stale commands');}
 {const g=setup(),{G}=g,spoken=[];G.fx.text=(text,x,y,z,style,o)=>{if(o?.ent)spoken.push(o.ent.type);};
 for(const type of ['garm','shark']){const b=g.spawn(type);b.hp=b.maxHp*.4;G.bus.emit('hit',{target:b,dmg:1});}
 assert.deepEqual(spoken,['garm','shark']);assert.equal(G.story.pending,0);report.lifecycle.push('overlapping boss speech stays in combat');}
for(const hero of heroes){const g=setup(hero,true),{G}=g;
 for(let stage=0;stage<G.stages.length;stage++){
  assert.equal(G.game.stageIndex,stage);g.step();assert.equal(G.story.active.kind,'intro');g.step(30);G.story.skip();
  G.stage.done=true;G.hitStop=0;g.step(40);assert.equal(G.story.active.kind,'clear');g.step(30);G.story.skip();G.scenes.play.showResult();
  assert.equal(typeof G._shown.result.onNext,'function');G._shown.result.onNext();assert.equal(G.sceneName,stage===G.stages.length-1?'ending':'play');
 }
 assert.deepEqual(Array.from(G.errors),[]);report.lifecycle.push('actual result-next progression all nine stages: '+hero);
}
fs.mkdirSync(path.join(root,'evidence/phase-events-20261024'),{recursive:true});
fs.writeFileSync(path.join(root,'evidence/phase-events-20261024/story-cpu.json'),JSON.stringify(report,null,2));
console.log('PASS ten boss/form thresholds; live dialogue and lethal transitions; 63 character/stage pairs; actual play lifecycle / pause / skip / clocks');

'use strict';
const {game,root}=require('./published_harness.cjs');
const {readModule}=require('./input_cpu.cjs');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
// Use the shipping difficulty table and actual foe AI/combat, without WebGL.
const source=fs.readFileSync(path.join(root,'inu25d/src/90_game.js'),'utf8');
const diffs=vm.runInNewContext('('+source.match(/const DIFFS = (\{[\s\S]*?\n\});/)[1]+')');
function setup(key){const g=game('inu',{foes:[]}),{G,env,n,p}=g;
 G.game.diff=diffs[key];G.game.onHeroHit=()=>{};
 for(const f of ['30_foes.js','31_zako.js'])vm.runInContext(readModule(f),env.c);
 G.foes.init();G.foes.build=()=>({root:new env.c.THREE.Group(),height:1.3,update(){}});
 n.player.hp=n.player.maxHp=p.hp=p.maxHp=100000;n.player.invuln=p.inv=0;
 return g;}
const g=setup('hard'),{G}=g,h=G.foes.h;
const d={id:'test_commit',len:24,hits:[{at:8,dur:3,x1:1.2,zr:.5,y0:0,y1:1.5,dmg:8}]};
const a=G.foes.spawn('wanhei',5,0),b=G.foes.spawn('wanhei',3,0);
a.entered=b.entered=true;a.state=b.state='idle';a.cool=b.cool=0;
assert(h.token(a));assert(h.attack(a,d,1));assert.equal(a.pending.t,18);
assert(h.token(b));assert.equal(h.attack(b,d,1),false);assert.equal(b.hasToken,false);
assert.equal(b.pending,undefined);G.time.tick+=12;assert(h.token(b));assert(h.attack(b,d,1));
assert.equal(a.face,a.committedFace);const committed=a.face;G.player.x=10;G.foes.tick(a);assert.equal(a.face,committed,'windup cannot retarget across hero');
// Simulate the first tick after a completed attack; recovery must be stationary.
a.pending=null;a.atk=null;a.state='act';a.cool=0;a.vx=.1;G.foes.tick(a);
assert.equal(a.punishUntil,G.time.tick+28);assert.equal(a.cool,28);assert.equal(a.vx,0);
const until=a.punishUntil;for(let i=0;i<27;i++){G.time.tick++;G.foes.tick(a);assert.equal(a.vx,0);assert.equal(a.pending,null);}
assert.equal(a.punishUntil,until);G.bus.emit('scene',{name:'play'});assert.equal(G.foes.tokens.size,0);
assert.equal(diffs.hard.foeHp,1);assert.equal(diffs.hard.heroDmg,1);assert.equal(diffs.hard.lives,3);
function pressure(key){const g=setup(key),{G,n,p}=g;G.rng=()=>.5;
 for(const x of [2.9,5.1,6.2]){const e=G.foes.spawn('wanhei',x,0);e.entered=true;e.state='idle';e.cool=0;}
 let commits=0;const actual=G.foes.h.attack;G.foes.h.attack=function(...args){const r=actual(...args);if(r)commits++;return r;};
 G.scenes.cpu.tick=()=>{if(G.hitStop>0){G.playerCtl.queue(p);G.hitStop--;return;}
  G.playerCtl.tick(p);for(const e of G.world.ents)if(e.team===1&&!e.publishedReactive){G.foes.tick(e);G.foes.h.alignPublishedLane(e);}
  G.combat.tick();for(const e of G.world.ents)if(e.team===1&&!e.publishedReactive)G.phys(e,G.stage.bounds());};
 g.step(1800);return {commits,damage:g.trace().hurt.reduce((s,h)=>s+h.damage,0),hits:g.trace().hurt.filter(h=>h.damage>0).length,errors:Array.from(G.errors)};}
const pressureResults={normal:pressure('normal'),hard:pressure('hard')};
assert(pressureResults.hard.commits>pressureResults.normal.commits,'hard squad must commit more attacks in the same fixture');
assert(pressureResults.hard.damage>pressureResults.normal.damage,'hard pressure must be applied, not only configured');
const report={status:'PASS_CPU',assertions:'stagger / token release / readable windup / committed facing / stationary recovery / scene reset / unchanged HP / actual pressure',pressure:pressureResults,limits:'Fixed 1800-tick stationary hero fixture, not a human playtest or difficulty balance acceptance.'};
fs.writeFileSync(path.join(root,'evidence/commands-20261024/tactics-cpu.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));

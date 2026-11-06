'use strict';
const {setup,readModule}=require('./story_harness.cjs');
const assert=require('node:assert/strict'),vm=require('node:vm');

function fixture(){
  const g=setup('inu',true),{G}=g;
  for(const name of ['92_encounter_balance','93_frenzy','94_hero_combat_fx'])
    vm.runInContext(readModule(name+'.js'),g.env.c);
  G.game.diffKey='frenzy';
  G.fx.burst=G.fx.impact=G.fx.text=G.fx.alert=()=>{};
  G.story.beginStage('inu',0,true);
  return {...g,p:G.player,n:G.published.native()};
}
{
  const g=fixture(),{G,p}=g,b=g.spawn('garm');
  b.hp=b.maxHp*.5;G.frenzy.tick();
  assert.equal(G.story.pending,0);
  b.hp--;G.frenzy.tick();
  assert.equal(G.story.pending,0);assert(!G.story.blocked);assert(!b._frenzyForm);
  G.time.tick+=48;G.frenzy.tick();assert.equal(b._frenzyForm,1);
  b.x=p.x+1.6;b.z=p.z;b.cool=0;b.state='idle';
  G.time.tick+=140;assert(G.frenzy.attack(b));assert.equal(b.pending.def.id,'frenzyQuake');
  b.pending=null;b.state='idle';b.x=p.x+5;
  G.time.tick+=140;assert(G.frenzy.attack(b));assert.equal(b.pending.def.id,'frenzyVolley');
}
for(const [leaderType,crew,form] of [['formationLeader','mikoshiCrew','mikoshi'],['horseLeader','horseCrew','mountedArcher']]){
  const g=fixture(),{G}=g,l=g.spawn(leaderType),a=g.spawn(crew);
  G.frenzy.tick();assert(!l.dead,'one helper cannot form');
  const b=g.spawn(crew);b.x=l.x+2;
  G.frenzy.tick();assert(!l.dead,'helpers must rendezvous');
  b.x=l.x+.65;a.x=l.x-.65;G.frenzy.tick();
  assert(l.dead&&a.dead&&b.dead);
  assert.equal(G.world.ents.filter(e=>e.type===form&&!e.dead).length,1);
}
{
  const g=fixture(),{G,p,n}=g,e=g.spawn('vampire');
  p.inv=n.player.invuln=0;e.x=p.x+2;e.hp=Math.round(e.maxHp/2);
  G.foes.tick(e);const attack=e.pending.def;
  e.atk={def:attack};attack.fn(e,0);assert((e.x-p.x)*p.face<0);
  attack.fn(e,19);assert.equal(n.player.state,'egrab');
  const hp=e.hp,hero=p.hp;attack.fn(e,49);
  assert(p.hp<hero);assert(e.hp>hp);assert(!n.player.grabbedByEnemy);
  p.inv=n.player.invuln=0;n.player.state='idle';attack.fn(e,19);
  assert(n.player.grabbedByEnemy);e.onInterrupt();assert(!n.player.grabbedByEnemy);
}
{
  const {G}=fixture(),seen=[];
  G.fx.burst=(...a)=>seen.push(a);
  G.heroCombatFx.firePillar(1,2);assert.equal(seen.filter(a=>a[0]==='flame').length,5);
  G.heroCombatFx.hazards({type:'nuko',z:0},[{kind:'ptwister',x:60,y:0,t:6}],0,60);
  assert.equal(seen.filter(a=>a[0]==='windRibbon').length,7);
  G.heroCombatFx.swing({type:'wanden',x:0,y:0,z:0,face:1},{def:{iai:true}});
  assert.equal(seen.filter(a=>a[0]==='slash').length,2);
}
console.log('PASS frenzy phase and moves, both formations, vampire teleport/grab/heal/release, dedicated FX');

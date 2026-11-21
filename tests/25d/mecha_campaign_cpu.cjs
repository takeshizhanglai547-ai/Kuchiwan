'use strict';
const assert=require('node:assert/strict'),vm=require('node:vm');
const {game}=require('./published_harness.cjs'),{readModule}=require('./input_cpu.cjs');
function fixture(){
 const f=game('kuro',{actualRig:true,foes:[]}),{G,env}=f;
 G.camera=new env.c.THREE.PerspectiveCamera(40,16/9,.1,200);
 Object.assign(G.game.diff,{foeHp:1,foeSpeed:1,think:1,attackers:3});
 for(const name of ['30_foes','31_zako','32_expansion_foes','33_regional_critters','35_bosses_a','36_bosses_b','40_stage',
  '41_round_animation','41_round_forms','41_round_models','41_round_moves','41_round_scenery','41_rounds','42_mecha_campaign','93_frenzy','95_ailments'])
  vm.runInContext(readModule(name+'.js'),env.c,{filename:name});
 G.foes.init();return f;
}
{
 const {G,p,n}=fixture();
 assert.equal(G.heroes.ids.length,8);
 assert.equal(G.heroes.get('kuro').name,'黒犬士');
 assert.equal(p.rig.heroId,'kuro');assert.equal(n.player.kind,'kuro');
 assert.equal(n.player.weapon,'kuroSlayer');
 assert.equal(G.stages.length,37);
 const stages=G.stages.filter(s=>s.lap===6);
 assert.equal(stages.length,5);
 assert.equal(new Set(stages.map(s=>s.theme.journey)).size,5);
 for(const [i,s]of stages.entries()){
  assert.equal(s.chapter,i+1);assert(s.intro.length>25&&s.epilogue.length>25);
  for(const w of s.waves)for(const [id]of [...w.foes,...w.then||[]])assert(G.foes.types[id],id);
  G.stage.load(G.stages.indexOf(s));assert(G.stage.stats().sceneryMeshes>0);G.stage.unload();
 }
 assert.equal(G.foes.types.lap6Boss5.name,'メカ・ダークワンワン大帝');
 assert.deepEqual(Array.from(G.errors),[]);
}
{
 const {G,p}=fixture();
 for(const index of G.stages.map((s,i)=>s.lap===6?i:-1).filter(i=>i>=0)){
  G.stage.load(index);let count=0,boss;
  while(!G.stage.done&&count++<2600){
   const state=G.stage.st;if(!state.active&&state.seq[state.ptr])p.x=state.seq[state.ptr].at;
   G.stage.tick();
   for(const e of [...G.world.ents])if(e.team===1){
    if(e.def.boss){boss=e;G.bus.emit('bossDown',{boss:e});}
    e.dead=true;G.world.remove(e);
   }
  }
  assert(boss&&G.stage.done,'every sixth journey stage completes its waves and boss');G.stage.unload();
 }
}
{
 for(const slot of ['up','fwd','down','dash','hadou','dp','du']){
  const {p,n,motion,key,step}=fixture();
  motion(slot);key('KeyJ');step();key('KeyJ',false);
  assert.equal(n.player.atk?.type,({up:'kuroRise',fwd:'kuroRush',down:'kuroLow',dash:'kuroRush',hadou:'kuroImpale',dp:'kuroRise',du:'kuroVault'})[slot],slot);
  step(145);assert(['idle','walk'].includes(n.player.state),slot+' finishes');
  p.rig.root.updateMatrixWorld(true);
  p.rig.root.traverse(o=>assert(o.matrixWorld.elements.every(Number.isFinite),slot+' has finite pose'));
 }
}
{
 const {p,n,motion,key,step}=fixture();
 motion('du');key('KeyJ');step();key('KeyJ',false);step(23);
 const tip=p.rig.tip.getWorldPosition(new p.rig.root.position.constructor());
 assert(Math.abs(tip.y-.045)<.025,'the greatsword tip supports the handstand');
 step(6);
 const next=p.rig.tip.getWorldPosition(new p.rig.root.position.constructor());
 assert(Math.abs(next.x-tip.x)<.025&&Math.abs(next.z-tip.z)<.025,'the vault rotates around the planted sword');
 assert(Math.abs(p.rig.n.act.rotation.z)>2,'the swordsman turns upside down');
 assert.equal(n.player.atk.type,'kuroVault');
}
{
 const {G,p,n,motion,key,step}=fixture();
 const target=G.foes.spawn('mechaScout',p.x+1.1,0,{entrance:'ready'});
 target.state='idle';target.cool=9999;target.hp=target.maxHp=1500;
 const before=target.hp;let slam=0;G.bus.on('kuroWallSlam',()=>slam++);
 motion('hadou');key('KeyJ');step();key('KeyJ',false);
 step(26);assert(n.player._kuroCarry,'the sword lifts the enemy');
 assert(target.grabbedBy>0&&target.y>0);
 const liftX=target.x;step(120);
 assert.equal(slam,1);assert(target.x>liftX+1);
 assert(target.hp<before-30);assert.equal(target.grabbedBy,0);
 assert.equal(n.player._kuroCarry,null);
}
{
 const {G,p,n,motion,key,step}=fixture();
 const target=G.foes.spawn('mechaHound',p.x+1,0,{entrance:'ready'});
 target.state='idle';target.cool=9999;target.hp=target.maxHp=1500;
 motion('hadou');key('KeyJ');step();key('KeyJ',false);step(24);
 assert(n.player._kuroCarry);
 G.combat.damage(p,7,{src:target,power:2,dir:-1});
 step(3);
 assert.equal(n.player._kuroCarry,null);assert.equal(target.grabbedBy,0,'interruption releases the held enemy');
}
{
 const {G,p}=fixture(),names=new Set();
 for(const id of G.mechaCampaign.bosses){
  const boss=G.foes.spawn(id,9,0,{entrance:'ready'});boss.state='idle';
  for(const move of boss.def.roundMoves){
   names.add(move.name);p.inv=9999;boss.x=9;boss.y=0;boss.z=0;boss.face=-1;
   G.combat.start(boss,move);
   for(let t=0;t<move.len;t++){
    G.combat.tick();boss.rig.update(boss);
    assert(Number.isFinite(boss.x)&&Number.isFinite(boss.y),move.name);
   }
   assert.equal(boss.atk,null,move.name);assert.equal(boss.gravScale,1,move.name);
   assert(!boss._mechaJet);assert.equal(boss.roundMarks?.length||0,0);
   G.combat.clear();
  }
  boss.hp=Math.floor(boss.maxHp*.49);
  assert(G.frenzy.observe(boss));
  for(let t=0;t<G.frenzy.duration;t++)G.frenzy.tick();
  boss.cool=0;boss.def.ai(boss);
  assert.equal(boss.pending.def,boss.def.roundMoves[3],id+' unlocks the second form');
  G.world.remove(boss);
 }
 assert.equal(names.size,25);
 assert.deepEqual(Array.from(G.errors),[]);
}
{
 const {G,p}=fixture(),boss=G.foes.spawn('lap6Boss5',9,0,{entrance:'ready'});
 const shotKinds=new Set();G.bus.on('shoot',e=>shotKinds.add(e.kind));
 for(const index of [0,1]){
  G.combat.start(boss,boss.def.roundMoves[index]);
  for(let t=0;t<boss.def.roundMoves[index].len;t++)G.combat.tick();
 }
 assert(shotKinds.has('mechaFist')&&shotKinds.has('mechaGrenade'));
 assert(G.combat.projectiles.some(pr=>pr.kind==='mechaGrenade'&&pr.boom?.dmg>0),'grenades have damaging explosions');
 G.combat.clear();
 G.combat.start(boss,boss.def.roundMoves[3]);let high=0,low=0;
 for(let t=0;t<110;t++){G.combat.tick();high=Math.max(high,boss.y);if(boss._mechaJet&&boss.y<.7)low++;}
 assert(high>2&&low>5,'the jet attack rises and makes low cutting passes');
 boss.onInterrupt();assert.equal(boss.gravScale,1);assert.equal(boss._mechaJet,null);
 p.inv=9999;
}
{
 const {G,p}=fixture();
 for(const type of ['mechaScout','lap6Boss5']){
  const e=G.foes.spawn(type,p.x+2,0,{entrance:'ready'});
  e._frenzyForm=1;e.hp=Math.floor(e.maxHp*.4);e.state='idle';e.onGround=true;
  G.combat.damage(e,e.maxHp*3,{src:p,power:3,dir:1});
  assert(e.dead);
  for(let t=0;t<230&&!e.removeMe;t++){G.foes.tick(e);G.phys(e,null);e.rig.update(e);}
  assert(e.happy&&e.rescueAt>0&&e.removeMe,type+' is rescued and leaves as a puppy');
  G.world.remove(e);
 }
}
{
 const {G,p,n,key,step}=fixture();
 const rows=n.equipmentCatalog().filter(r=>r.eligible&&r.owner==='kuro');
 assert.equal(rows.length,3);
 assert(n.equipStock('kuroFurnace',true));
 assert.equal(n.equipmentCatalog().find(r=>r.id==='kuroFurnace').ultName,'炉心剣・紅蓮断');
 key('KeyO');step();key('KeyO',false);
 assert.equal(n.player.atk?.type,'kuroFlare');step(100);
 assert(n.player.dim<3);assert(!p.dead);
}
{
 const {G,p,n,env}=fixture(),saved=new Map([['inu25d_camp_v1',JSON.stringify({v:1,coins:1000})]]);
 env.c.localStorage={getItem:k=>saved.get(k)||null,setItem:(k,v)=>saved.set(k,v)};
 G.scenes.play.cleared=true;
 vm.runInContext(readModule('85_camp_state.js'),env.c);
 const result=G.camp.purchase(p,'kuroDawn');assert(result.ok);
 assert.equal(n.player.weapon,'kuroDawn');
 assert(G.camp.profile().weapons.kuro.includes('kuroDawn'));
 const wallet=G.camp.wallet();assert(wallet<1000);
 assert(G.camp.equip(p,'kuroSlayer').ok);assert(G.camp.equip(p,'kuroDawn').ok);
 assert.equal(G.camp.wallet(),wallet,'owned swords equip without another charge');
}
console.log('PASS six journeys, eight heroes, five mechanical stages, 25 boss patterns, black swordsman commands, lift/run/wall slam, interruption release and dedicated weapons');

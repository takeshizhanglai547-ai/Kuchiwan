'use strict';
const {game}=require('./published_harness.cjs'),{readModule}=require('./input_cpu.cjs');
const vm=require('node:vm'),assert=require('node:assert/strict');
function fixture(){
 const g=game('inu',{foes:[],actualRig:true}),{G}=g;
 G.camera=new g.env.c.THREE.PerspectiveCamera(40,16/9,.1,200);
 Object.assign(G.game.diff,{foeHp:1,foeSpeed:1,think:1,attackers:3});
 for(const f of ['30_foes','31_zako','32_expansion_foes','33_regional_critters','35_bosses_a','36_bosses_b','40_stage','41_rounds','93_frenzy','95_ailments'])
   vm.runInContext(readModule(f+'.js'),g.env.c,{filename:f});
 G.foes.init();return g;
}
{
 const g=fixture(),{G}=g;
 assert.deepEqual([1,2,3,4,5].map(lap=>G.stages.filter(s=>(s.lap||1)===lap).length),[9,5,4,3,11]);
 assert.equal(new Set(G.stages.map(s=>s.id)).size,32);
 for(const s of G.stages){
   for(const w of s.waves)for(const [id] of [...w.foes,...w.then||[]])assert(G.foes.types[id],id);
   assert(G.foes.types[s.boss.type].boss);
 }
 for(const index of G.stages.map((s,i)=>s.lap?i:-1).filter(i=>i>=0)){
  G.stage.load(index);assert(G.stage.stats().sceneryMeshes>0);
  let frames=0,boss;
  while(!G.stage.done&&frames++<2500){
   const st=G.stage.st;
   if(!st.active&&st.seq[st.ptr])g.p.x=st.seq[st.ptr].at;
   G.stage.tick();
   for(const e of [...G.world.ents])if(e.team===1){
    if(e.def.boss){boss=e;G.bus.emit('bossDown',{boss:e});}
    e.dead=true;G.world.remove(e);
   }
  }
  assert(boss&&G.stage.done);
  assert.deepEqual(Array.from(G.errors),[]);
  G.stage.unload();
 }
}
{
 const {G,p,n,step,key}=fixture();
 const foe=G.foes.spawn('poisonCap',p.x+2,p.z,{entrance:'ready'});
 foe.state='idle';foe.cool=0;G.foes.tick(foe);
 assert.equal(foe.pending.def.proj[0].status,'poison');
 const shot=G.combat.shoot({owner:foe,kind:'shadow',x:p.x,y:.55,z:p.z,dmg:8,status:'poison'});
 G.combat.tick();
 assert(G.ailments.labels(p).includes('毒'));assert(shot.dead);
 const before=n.player.hp;
 step(75);assert(n.player.hp<before);
 G.ailments.hit(p,'sleep',foe);key('ArrowRight');const x=p.x;step(24);key('ArrowRight',false);
 assert(Math.abs(p.x-x)<.18);assert(G.ailments.asleep(p));
 G.ailments.hit(p,'slow',foe);assert(!G.ailments.asleep(p));assert.equal(G.ailments.speed(p),.62);
 G.ailments.clear(p);assert.equal(G.ailments.labels(p),'');
}
{
 const {G,p,step,key}=fixture();
 Object.assign(G.game.diff,{frenzy:true,tactics:true,minWindup:16,attackSpacing:8,punishWindow:19});
 const foe=G.foes.spawn('beetlePup',p.x+.65,p.z,{entrance:'ready'});
 foe.state='idle';foe.cool=0;G.foes.h.face(foe,p);
 assert(G.foes.h.attack(foe,{id:'testWindup',len:45,hits:[]},80));
 const hp=foe.hp,windup=foe.pending;
 key('KeyJ');step();key('KeyJ',false);step(35);
 assert(foe.hp<hp);assert(foe.pending===windup);assert.equal(foe.armorHitsLeft,1);
 assert(!G.combat.absorbStagger(foe,3,false));assert.equal(foe.armorHitsLeft,0);
 const partner=G.foes.spawn('mantisPup',p.x+1.8,p.z,{entrance:'ready'});
 partner.state='idle';partner.cool=0;G.foes.tick(partner);
 assert(partner.vx<0&&Math.abs(partner.vz)>0,'second enemy flanks while first is committed');
}
console.log('PASS five routes, regional scenery and boss progression, spores, sleep and slow, native super armor and flanking');

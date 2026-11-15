'use strict';
const {game}=require('./published_harness.cjs'),{readModule}=require('./input_cpu.cjs');
const vm=require('node:vm'),assert=require('node:assert/strict');
function fixture(){
 const g=game('inu',{foes:[],actualRig:true}),{G}=g;
 G.camera=new g.env.c.THREE.PerspectiveCamera(40,16/9,.1,200);
 Object.assign(G.game.diff,{foeHp:1,foeSpeed:1,think:1,attackers:3});
 for(const f of ['30_foes','31_zako','32_expansion_foes','33_regional_critters','35_bosses_a','36_bosses_b','40_stage','41_round_models','41_round_moves','41_rounds','93_frenzy','95_ailments'])
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
{
 const {G,p}=fixture();
 const laterStages=G.stages.filter(s=>s.lap>1);
 const types=new Set(laterStages.flatMap(s=>s.waves.flatMap(w=>w.foes.map(([id])=>id))));
 const sculpts=new Set(),moves=new Set(),names=new Set(),traces=new Set();
 const mesh=(rig)=>rig.root.children[0].children[0].geometry;
 for(const type of types){
  const rig=G.foes.build(type);
  assert(rig.shape,type);
  sculpts.add(mesh(rig));rig.dispose();
 }
 assert.equal(types.size,20);
 const actionLog=[];
 const area=G.combat.area,shoot=G.combat.shoot,spawn=G.foes.h.spawnMinion;
 G.combat.area=o=>{actionLog.push(['area',o.owner.atk?.t,o.r,o.zr,o.y1,o.fx,o.status]);return area(o);};
 G.combat.shoot=o=>{actionLog.push(['shot',o.owner.atk?.t,o.kind,o.y,o.z,o.vx,o.vz,o.status]);return shoot(o);};
 G.foes.h.spawnMinion=(type,...args)=>{actionLog.push(['summon',type]);return spawn(type,...args);};
 for(const stage of laterStages){
  const boss=G.foes.spawn(stage.boss.type,7,0,{entrance:'ready'});
  sculpts.add(mesh(boss.rig));
  assert.equal(boss.def.roundMoves.length,4);
  for(const move of boss.def.roundMoves){
   p.inv=9999;boss.x=7;boss.y=0;boss.z=0;boss.face=-1;
   G.combat.start(boss,move);
   let hadWarning=false;
   for(let t=0;t<move.len;t++){
    G.combat.tick();
    boss.rig.update(boss);
    hadWarning||=!!boss.roundMarks?.some(cue=>cue.fill);
    boss.x+=boss.vx;boss.z+=boss.vz;
   }
   assert.equal(boss.atk,null,move.name);
   assert.equal(boss.roundMarks?.length||0,0,move.name);
   assert(actionLog.length,move.name);
   if(actionLog.some(entry=>entry[0]==='area'&&entry[5]))assert(hadWarning,move.name);
   for(const ent of [...G.world.ents])if(ent.roundSummoner===boss)G.world.remove(ent);
   traces.add(JSON.stringify(actionLog));actionLog.length=0;
   moves.add(move.id);names.add(move.name);
   G.combat.clear();
  }
  boss.x=p.x+1.15;boss.z=p.z;boss.state='idle';boss.cool=0;boss.def.ai(boss);
  assert.equal(boss.pending.def,boss.def.roundMoves[0]);
  boss.pending=null;boss.state='idle';boss.cool=0;boss.hp=boss.maxHp*.49;
  G.game.diff.frenzy=true;boss._frenzyForm=1;boss._frenzyNext=0;
  assert.equal(G.frenzy.attack(boss),false,'Frenzy preserves the boss-specific sequence');
  boss.def.ai(boss);
  assert.equal(boss.pending.def,boss.def.roundMoves[3]);
  G.world.remove(boss);
 }
 assert.equal(sculpts.size,43);
 assert.equal(moves.size,92);assert.equal(names.size,92);assert.equal(traces.size,92);
 assert.deepEqual(Array.from(G.errors),[]);
}
{
 const {G,p}=fixture();
 const boss=G.foes.spawn('lap2Boss3',7,0,{entrance:'ready'});
 const web=boss.def.roundMoves[1];
 p.x=4;p.z=0;boss.state='idle';
 G.combat.start(boss,web);p.inv=9999;
 for(let t=0;t<22;t++){G.combat.tick();boss.rig.update(boss);}
 assert(boss.roundMarks.some(cue=>cue.group.parent===G.scene),'web warning or strike appears on the battlefield');
 const cues=[...boss.roundMarks];
 G.combat.cancel(boss);boss.onInterrupt();
 assert(cues.every(cue=>cue.group.parent===null));
}
console.log('PASS five routes, regional scenery and boss progression, spores, sleep and slow, native super armor and flanking, and 92 distinct attacks across 23 redrawn bosses');

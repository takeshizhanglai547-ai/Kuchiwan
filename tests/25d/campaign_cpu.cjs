'use strict';
const {game}=require('./published_harness.cjs');
const {setup,readModule}=require('./story_harness.cjs');
const vm=require('node:vm'),assert=require('node:assert/strict');
{
  const g=setup('inu',true),{G}=g,bubbles=[];
  G.fx.text=(text,x,y,z,style,options)=>bubbles.push({text,style,options});
  G.story.beginStage('inu',0,true);
  for(const type of ['garm','shark','ghost','cerbe','slime','dragon','kuroinu','emperor']){
    const b=g.spawn(type);
    b.hp=b.maxHp*.5-1;
    G.bus.emit('hit',{target:b,dmg:1});
    assert.equal(b.phase,1,type);
    assert.equal(G.story.pending,0,type);
    assert.equal(G.story.blocked,false,type);
    assert(bubbles.some(line=>line.style==='say'&&line.options?.ent===b),type+' speech follows the actor');
    G.world.remove(b);
  }
  const b=g.spawn('emperor');
  G.combat.damage(b,b.maxHp*10,{dir:1,power:3});
  assert(b.transforming);
  assert.equal(G.story.pending,0);
  const before=G.game.stageTime;
  g.step(150);
  assert(G.game.stageTime>before);
  assert(!b.transforming&&!b.intangible);
}
const unique=new Set();
for(const hero of ['inu','shima','nuko','guard8','watch','wanden','mack']){
  const rows=game(hero,{foes:[]}).n.equipmentCatalog().filter(w=>w.owner===hero&&!w.default);
  assert.equal(rows.length,15);
  for(const w of rows){assert(w.ultName);assert(!unique.has(w.ultName));unique.add(w.ultName);}
}
const choices=[['inu','katana'],['shima','nunchaku2'],['nuko','grimoire'],['guard8','pilebunker'],['watch','kunai'],['wanden','tachi'],['mack','grenadel']];
for(const [hero,id] of choices){
  const g=game(hero,{foes:[55,115,230,345,460],dim:8,actualRig:true});
  const {G,n,p}=g;
  vm.runInContext(readModule('88_equipment_visuals.js'),g.env.c);
  const fx=[];G.fx.burst=(kind,x,y,z,options)=>fx.push({kind,options});
  const row=n.equipmentCatalog().find(w=>w.id===id);
  assert(row?.eligible&&row.ultName,hero+': '+id);
  assert(n.equipStock(id,true));n.player.dim=8;
  g.key('KeyO');g.step();g.key('KeyO',false);
  assert.equal(n.player.atk?.armory?.id,id,hero);
  assert.equal(n.player.atk.armory.ultimate,true);
  g.step(600);
  assert(fx.some(e=>e.kind==='ring'&&e.options?.scale===1.25),hero+' weapon finisher');
  assert(g.trace().hits.length>0,hero+' weapon damages');
}
console.log('PASS eight attached boss bubbles, live Emperor transformation, seven heroes’ weapon-specific ultimates and finishers');

'use strict';
const {game,root}=require('./published_harness.cjs'),reference=require('./reference_runtime.cjs');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const out=path.join(root,'evidence/commands-20261013/stage2');fs.mkdirSync(out,{recursive:true});
const card=['ArrowUp','ArrowRight','ArrowDown','ArrowLeft'];
const filter=process.argv[2]||'';
function tape(slot,face=1){const f=face>0?1:3,b=face>0?3:1,seq={up:[0],fwd:[f],down:[2],dash:[b,f],hadou:[2,f],dp:[f,2,f],du:[2,0],ult:[0,1,2,3]}[slot];
  const events=[];for(const k of seq)events.push({frame:1,code:card[k],down:true},{frame:1,code:card[k],down:false});
  if(['up','fwd','down','du'].includes(slot))events.push({frame:1,code:card[seq.at(-1)],down:true});
  events.push({frame:1,code:'KeyJ',down:true},{frame:2,code:'KeyJ',down:false});return events;
}
function oracle(hero,events,opts={}){
  return reference(`sndOn=false;gimOn=false;Math.random=()=>.5;setupRoster(${JSON.stringify(hero)});player=players[0];resetPlayer(player,true);player.invuln=0;player.x=240;player.y=LANE;player.facing=${opts.face||1};player.level=${opts.level||1};player.dim=${opts.dim??3};player.dimMax=8;state='play';enemies=[];projectiles=[];hazards=[];items=[];vehicles=[];npcs=[];gf=0;resetCombo();useInput(player.in);
    ${opts.air?"player.state='jump';player.z=120;player.vz=0;":''}
    const type=${JSON.stringify(opts.type||'wolf')};ETYPE[type]={...ETYPE[type],sp:0,score:0};
    for(const dx of ${JSON.stringify(opts.foes||[60])}){spawnEnemy(type,240+dx,LANE);const e=enemies[enemies.length-1];e.hp=e.maxHp=100000;e.thinkCd=1e9;e.moveCd=1e9;}
    const hits=[],actions=[],positions=[],damage=damageEnemy;damageEnemy=function(e,...args){const before=e.hp;damage(e,...args);hits.push({tick:gf,damage:before-e.hp,requested:args[0]});};
    const events=${JSON.stringify(events)},key=(e)=>global.events[e.down?'keydown':'keyup'][0]({code:e.code,preventDefault(){}});
    for(let frame=1;frame<=${opts.frames||180};frame++){
      for(const e of events)if(e.frame===frame)key(e);
      if(hitStop>0){hitStop--;continue;}gf++;const oldState=player.state,oldId=player.atk?.type;
      updatePlayer();saveInput(player.in);updateEnemies();updateProjectiles();updateHazards();updateCombo();particles.length=0;
      if(${!!filter})positions.push({gf,enemies:enemies.map(e=>({x:e.x,y:e.y,z:e.z,vx:e.vx,vz:e.vz,state:e.state,h:e.h})),shots:projectiles.map(p=>({x:p.x,y:p.y,z:p.zz,r:p.r}))});
      if(oldState!==player.state||oldId!==player.atk?.type)actions.push({tick:gf,state:player.state,id:player.atk?.type,dim:player.dim});
    }
    global.result={hits,actions,dim:player.dim,combo:combo.count,damage:hits.reduce((n,h)=>n+h.damage,0),alive:enemies.filter(e=>!e.dead).length,state:player.state,clock:gf,...(${!!filter}?{positions}:{})};`);
}
function candidate(hero,events,opts={}){const g=game(hero,opts),positions=[];let old=-1;
  for(let frame=1;frame<=(opts.frames||180);frame++){for(const e of events)if(e.frame===frame)g.key(e.code,e.down);g.step();
    if(filter&&g.n.clock!==old){old=g.n.clock;positions.push({gf:old,enemies:g.n.enemies.map(e=>({x:e.x,y:e.y,z:e.z,vx:e.vx,vz:e.vz,state:e.state,h:e.h})),shots:g.n.projectiles.map(p=>({x:p.x,y:p.y,z:p.zz,r:p.r}))});}}
  const t=g.trace();return {g,result:{hits:t.hits.map(({tick,damage,requested})=>({tick,damage,requested})),actions:t.actions,
    dim:g.p.dim,combo:g.n.combo.count,damage:t.hits.reduce((n,h)=>n+h.damage,0),alive:g.foes.filter(e=>!e.dead).length,state:g.n.player.state,clock:g.n.clock,...(filter?{positions}:{})}};
}
const results=[];let groups=0;
const shifted=(events,frame)=>events.map(e=>({...e,frame:e.frame+frame-1}));
function compare(name,hero,events,opts={}){
  if(filter&&!name.includes(filter))return;
  const expected=oracle(hero,events,opts),{g,result}=candidate(hero,events,opts);
  if(filter){fs.writeFileSync(path.join(out,'probe.json'),JSON.stringify({name,expected,result},null,2));delete expected.positions;delete result.positions;}
  assert.deepEqual(JSON.parse(JSON.stringify(result)),expected,name);results.push({name,hero,...opts,hits:result.hits,dim:result.dim,damage:result.damage,clock:result.clock});return g;
}
function test(name,fn){const n=results.length;fn();if(filter&&results.length===n){console.log('SKIP '+name);return;}groups++;console.log('PASS '+name);}
if(require.main===module){
test('all seven heroes: every ground command has the same applied damage, hit count/time, stock and state trace',()=>{
  for(const hero of ['inu','shima','nuko','guard8','watch','wanden','mack']){
    for(const slot of ['up','fwd','down','dash','hadou','dp','du'])for(const face of [1,-1])compare(hero+'.'+slot+'.'+face,hero,tape(slot,face),{face,foes:[face*60]});
    if(!filter)console.log('       '+hero+' ground 7 x 2 directions compared');
  }
});
test('all seven heroes: three air commands use the published mechanics and hit timelines',()=>{
  for(const hero of ['inu','shima','nuko','guard8','watch','wanden','mack'])for(const slot of ['dp','hadou','du'])for(const face of [1,-1])
    compare(hero+'.air.'+slot+'.'+face,hero,tape(slot,face),{air:true,face,foes:[face*60]});
});
test('Inu grab, four directional throws and attack+grab use actual published damage and timing',()=>{
  for(const direction of [null,'ArrowUp','ArrowDown','ArrowLeft']){
    const events=[{frame:1,code:'KeyL',down:true},{frame:2,code:'KeyL',down:false}];
    if(direction)events.push({frame:3,code:direction,down:true});events.push({frame:3,code:'KeyJ',down:true},{frame:4,code:'KeyJ',down:false});
    compare('inu.grab.'+direction,'inu',events,{foes:[36],frames:240});
  }
  compare('inu.attack+grab','inu',[{frame:1,code:'KeyL',down:true},{frame:1,code:'KeyJ',down:true},{frame:2,code:'KeyL',down:false},{frame:2,code:'KeyJ',down:false}],{foes:[36]});
});
test('Inu ultimates consume exact stock, including insufficient stock, higher tiers and air chord',()=>{
  for(const level of [1,8,16])for(const dim of [0,1,2,5])for(const air of [false,true])compare('inu.ult.'+level+'.'+dim+'.'+air,'inu',tape('ult'),{level,dim,air,foes:[36,120]});
  compare('inu.air.chord','inu',[{frame:1,code:'KeyL',down:true},{frame:1,code:'KeyJ',down:true},{frame:2,code:'KeyJ',down:false},{frame:2,code:'KeyL',down:false}],{air:true,dim:3});
});
test('level upgrades and held attacks are not aliases or extra automatic presses',()=>{
  for(const level of [3,5,7,10,12,16])for(const slot of ['up','fwd','down','dash','hadou','dp','du'])compare('inu.upgrade.'+level+'.'+slot,'inu',tape(slot),{level});
  for(const release of [8,29,50,90])compare('inu.hold.'+release,'inu',[{frame:1,code:'KeyJ',down:true},{frame:release,code:'KeyJ',down:false}],{frames:200});
});
test('normal/motion, distinct command chain, same command rejection, jump and ultimate cancel retain damage/time',()=>{
  for(const face of [1,-1]){
    const cases={
      normalMotion:[{frame:1,code:'KeyJ',down:true},{frame:2,code:'KeyJ',down:false},...shifted(tape('hadou',face),9)],
      repeatedMotion:[...tape('hadou',face),...shifted(tape('hadou',face),9)],
      chainLimit:[...tape('hadou',face),...shifted(tape('dp',face),9),...shifted(tape('down',face),17),...shifted(tape('up',face),25)],
      jumpCancel:[...tape('hadou',face),{frame:7,code:'Space',down:true},{frame:8,code:'Space',down:false},...shifted(tape('hadou',face),12)],
      ultimateCancel:[...tape('dp',face),...shifted(tape('ult',face),9)],
      directionCharge:[...tape('down',face),{frame:2,code:'KeyJ',down:true},{frame:80,code:'KeyJ',down:false}],
    };
    for(const [name,events]of Object.entries(cases))compare('inu.cancel.'+name+'.'+face,'inu',events,{face,foes:[face*60],frames:240});
    compare('inu.air.chain.'+face,'inu',[...tape('dp',face),...shifted(tape('hadou',face),7),...shifted(tape('du',face),14),...shifted(tape('dp',face),21)],{face,air:true,foes:[face*60],frames:240});
  }
});
test('every hero uses the published ground/air ultimate with sufficient and insufficient stock',()=>{
  for(const hero of ['inu','shima','nuko','guard8','watch','wanden','mack'])for(const dim of [0,5])for(const air of [false,true])
    compare(hero+'.ult.stock.'+dim+'.'+air,hero,tape('ult'),{dim,air,frames:240,foes:[36,120]});
});
fs.writeFileSync(path.join(out,filter?'filtered-comparison.json':'combat-comparison.json'),JSON.stringify({reference:'b5c01428 / f8de624f',filter,groups,cases:results},null,2));
console.log('published/3D combat comparison '+groups+' groups, '+results.length+' cases PASS');
}
module.exports={oracle,candidate,tape,compare};

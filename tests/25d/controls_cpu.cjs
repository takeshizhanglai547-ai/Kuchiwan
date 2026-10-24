'use strict';
const {game,root}=require('./published_harness.cjs'),{oracle,candidate,tape}=require('./published_cpu.cjs');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const heroes=['inu','shima','nuko','guard8','watch','wanden','mack'],cases=[],extras=[];
const clean=x=>JSON.parse(JSON.stringify(x));
function result(g){const t=g.trace();return {hits:t.hits.map(({tick,damage,requested})=>({tick,damage,requested})),actions:t.actions,dim:g.p.dim,combo:g.n.combo.count,damage:t.hits.reduce((n,h)=>n+h.damage,0),alive:g.foes.filter(e=>!e.dead).length,state:g.n.player.state,clock:g.n.clock};}
function motion(hero,slot,face,air){const g=game(hero,{face,air,foes:[face*60]}),f=face>0?'ArrowRight':'ArrowLeft';
 const events=slot==='dp'?[{frame:1,code:f,down:true},{frame:2,code:f,down:false},{frame:2,code:'ArrowDown',down:true},{frame:3,code:f,down:true}]:[{frame:1,code:'ArrowDown',down:true},{frame:2,code:f,down:true},{frame:3,code:'ArrowDown',down:false}];
 events.push({frame:4,code:'KeyJ',down:true},{frame:5,code:'KeyJ',down:false});
 const vectors=slot==='dp'?[[face*50,0],[0,50],[face*35,35]]:[[0,50],[face*35,35],[face*50,0]];let id;
 for(let frame=1;frame<=200;frame++){if(frame<=3)g.G.commands.touchMove(...vectors[frame-1]);if(frame===4){g.G.input.touch.attack=true;g.G.input.latch('attack');}if(frame===5)g.G.input.touch.attack=false;g.step();if(frame===4)id=g.n.player.atk?.type||g.n.player.state;}
 assert.deepEqual(clean(result(g)),oracle(hero,events,{face,air,foes:[face*60],frames:200}),hero+'.diagonal.'+slot+'.'+face+'.'+air);
 assert.equal(g.n.player.sgCd,0);cases.push({hero,slot,face,air,id,diagonal:true,sourceComparison:true});}
for(const hero of heroes)for(const face of [1,-1])for(const air of [false,true]){
 for(const slot of ['hadou','dp'])motion(hero,slot,face,air);
 for(const slot of ['up','down','fwd','du']){const opts={face,air,foes:[face*60]},events=tape(slot,face),{result:r}=candidate(hero,events,opts);assert.deepEqual(clean(r),oracle(hero,events,opts));cases.push({hero,slot,face,air,sourceComparison:true});}
}
// Both keyboard diagonal endings, without releasing the down direction.
{const g=game('inu',{foes:[]});for(const v of [[50,0],[0,50],[0,-50],[35,35]]){g.G.commands.touchMove(...v);g.step();}assert.equal(g.G.commands.preciseMotion(1),null,'opposite direction invalidates old diagonal sequence');g.key('KeyJ');g.step();assert.notEqual(g.n.player.atk?.type,'idragon');}
for(const face of [1,-1]){const g=game('inu',{face,foes:[]}),f=face>0?'ArrowRight':'ArrowLeft';g.key(f);g.step();g.key(f,false);g.key('ArrowDown');g.step();g.key(f);g.step();g.key('KeyJ');g.step();assert.equal(g.n.player.atk.type,'idragon');assert.equal(g.p.dim,3);}
// Priority: 623 wins over the embedded 23/26; neutral stays accessible; one use
// consumes diagonal history so later attacks cannot reuse it.
{const g=game('inu',{foes:[]});for(const v of [[50,0],[0,50],[35,35],[50,0]]){g.G.commands.touchMove(...v);g.step();}g.key('KeyJ');g.step();assert.equal(g.n.player.atk.type,'idragon');g.key('KeyJ',false);g.G.commands.touchEnd();g.step(100);g.key('KeyJ');g.step();assert.equal(g.n.player.atk.type,'c1');}
for(const [slot,delay]of [['dp',10],['hadou',10]]){const g=game('inu',{foes:[]});for(const v of (slot==='dp'?[[50,0],[0,50],[35,35]]:[[0,50],[35,35],[50,0]])){g.G.commands.touchMove(...v);g.step();}g.step(delay);g.G.commands.touchEnd();g.key('KeyJ');g.step();assert.notEqual(g.n.player.atk?.type,slot==='dp'?'idragon':'iwave');assert.equal(g.p.dim,3);}
for(const hero of heroes)for(const air of [false,true])for(const level of [1,6,12,20]){
 const g=game(hero,{air,level,dim:8,foes:[]}),before=g.n.player.dim,cost=g.n.cost(air);g.key('KeyO');g.step();assert.equal(g.p.dim,before-cost,hero+' dedicated ultimate cost');g.step(85);assert.equal(g.p.dim,before-cost,'held ultimate cannot replay');extras.push({hero,air,level,button:'ult',cost});
}
for(const hero of heroes){const g=game(hero,{foes:[]});for(const c of [0,1,2,3])g.G.commands.pushCard(c);g.key('KeyH');g.step();assert.equal(g.p.dim,3,'special must not use stale ultimate');assert.equal(g.n.player.sgCd,540);g.step(100);assert(g.n.player.sgCd<540);assert.equal(g.p.dim,3);extras.push({hero,button:'special',stockCost:0});
 const air=game(hero,{air:true,foes:[]}),hints=[];air.G.bus.on('controlHint',d=>hints.push(d.text));air.key('KeyH');air.step(10);assert.equal(air.p.dim,3);assert.equal(air.trace().actions.filter(a=>a.state==='attack').length,0);assert(hints.some(t=>t.includes('地上')));
 const empty=game(hero,{dim:0,foes:[]}),emptyHints=[];empty.G.bus.on('controlHint',d=>emptyHints.push(d.text));empty.key('KeyO');empty.step(100);assert.equal(empty.p.dim,0);assert.equal(empty.trace().actions.filter(a=>a.state==='attack').length,0,'insufficient ult must not become normal Attack');assert(emptyHints.some(t=>t.includes('足りません')),'clear insufficient-stock feedback');
}
{const g=game('inu',{foes:[]});g.G.hitStop=8;g.key('KeyO');g.step(100);assert.equal(g.p.dim,2,'one buffered dedicated ult');}
{const g=game('inu',{foes:[]});g.key('KeyO');g.step();g.key('KeyO',false);g.step();g.key('KeyO');g.step();assert.equal(g.p.dim,2);assert.equal(g.G.commands.cardSeq.length,0,'rejected repeat must not retain rotation cards');g.key('KeyO',false);g.step(180);g.key('KeyJ');g.step();assert.equal(g.n.player.atk.type,'c1');assert.equal(g.p.dim,2);}
{const g=game('inu',{foes:[]});g.G.hitStop=8;g.key('KeyO');g.step();g.G.combat.damage(g.p,10,{dir:1});g.key('KeyO',false);g.step(100);assert.equal(g.p.dim,3,'damage cancels queued ult');g.key('KeyJ');g.step();assert.notEqual(g.n.player.atk?.type,'dimension');}
for(const hero of heroes)for(const face of [1,-1]){
 const g=game(hero,{face,foes:[face*36],actualRig:true}),hints=[];g.G.bus.on('controlHint',d=>hints.push(d.text));g.key('KeyL');g.step();g.key('KeyL',false);assert.equal(g.n.player.state,'grab');
 g.key(face>0?'ArrowRight':'ArrowLeft');g.key('KeyJ');g.step();assert.equal(g.p.publishedMotion.id,'grabStrike');assert.equal(g.p.rig.st.pubPose.id,'grabStrike');g.key('KeyJ',false);g.step(12);
 assert.equal(g.foes[0].hp,99994);assert.equal(g.n.player.state,'grab');assert.equal(g.p.dim,3);
 g.key('KeyL');g.step();assert.equal(g.n.player.grabEnemy===null,true,'explicit release');assert.notEqual(g.n.player.state,'grab');assert.equal(g.foes[0].grabbedBy,0);assert(hints.some(t=>t.includes('はなした')));extras.push({hero,face,forwardStrike:true,damage:6,release:true});
 for(const direction of [null,'ArrowUp','ArrowDown',face>0?'ArrowLeft':'ArrowRight']){const events=[{frame:1,code:'KeyL',down:true},{frame:2,code:'KeyL',down:false},...(direction?[{frame:4,code:direction,down:true}]:[]),{frame:4,code:'KeyJ',down:true},{frame:5,code:'KeyJ',down:false}],opts={face,foes:[face*36,face*90],frames:240};assert.deepEqual(clean(candidate(hero,events,opts).result),oracle(hero,events,opts));}
}
for(const action of ['timeout','death','remove']){const g=game('inu',{foes:[36]});g.key('KeyL');g.step();g.key('KeyL',false);
 if(action==='death')g.foes[0].dead=true;if(action==='remove')g.G.world.remove(g.foes[0]);g.step(action==='timeout'?185:1);assert.equal(g.n.player.grabEnemy===null,true,action+' must release');assert.notEqual(g.n.player.state,'grab');}
for(const invalid of ['air','inv','spawn','behind']){const g=game('inu',{foes:[36]}),f=g.foes[0],hints=[];g.G.bus.on('controlHint',d=>hints.push(d.text));if(invalid==='air')f.y=2;if(invalid==='inv')f.inv=99;if(invalid==='spawn'){f.state='spawn';f.hittableSpawn=false;}if(invalid==='behind')f.x=g.p.x-.6;g.key('KeyL');g.step();assert.notEqual(g.n.player.state,'grab',invalid);assert(hints.length>0,'invalid feedback');}
{const g=game('inu',{foes:[36],type:'boss'});g.key('KeyL');g.step();assert.equal(g.n.player.state,'grab','original boss grab allowed when vulnerable');}
{const g=game('mack',{dim:1,foes:[]});g.n.player.state='jump';g.n.player.z=0;g.n.player.vz=10;g.key('KeyO');g.step();assert.equal(g.p.dim,0,'jump-start ultimate uses native air cost');}
fs.writeFileSync(path.join(root,'evidence/input-controls-20261024/controls-cpu.json'),JSON.stringify({status:'PASS_CPU',sourceCases:cases,extras,grabLegacyDirections:'neutral/up/down/back match source in both facings; Watch remains theft',adaptations:'forward grab uses original 6-damage small strike, Grab again releases',limits:'CPU input/THREE transforms only; no trusted browser touch or rendered layout; old long-press issue remains pending.'},null,2));
console.log('PASS '+cases.length+' requested-command source cases; diagonal priority/timeouts; dedicated buttons/costs; all grab directions/release/death/immunity');

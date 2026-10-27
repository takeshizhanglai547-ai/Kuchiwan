'use strict';
const {game,root}=require('./published_harness.cjs'),{readModule}=require('./input_cpu.cjs'),vm=require('node:vm'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const cases=[],shots=[];function pass(s){cases.push(s);console.log('PASS '+s);}
function fixture(hero='inu',rig=true){const g=game(hero,{foes:[],actualRig:rig});for(const f of ['30_foes.js','31_zako.js','32_expansion_foes.js'])vm.runInContext(readModule(f),g.env.c,{filename:f});g.G.game.diff={heroDmg:1,heroHp:1,foeHp:1,foeDmg:1,foeSpeed:1,think:1,attackers:3};g.G.foes.init();return g;}
function spawn(g,type,x=9,z=0){const e=g.G.foes.spawn(type,x,z,{entrance:'walk'});e.entered=true;e.state='idle';e.inv=0;e.cool=0;return e;}
function tickFoe(g,e,n=1){for(let i=0;i<n;i++){g.G.time.tick++;g.G.foes.tick(e);g.G.combat.tick();g.G.phys(e);e.rig?.update(e);assert.deepEqual(Array.from(g.G.errors),[]);}}
{
 const g=fixture('inu',true);for(const id of g.G.expansionFoes.ids){const e=spawn(g,id);e.rig.update(e);assert(e.rig.root.children.length>=3);e.rig.root.updateMatrixWorld(true);e.rig.root.traverse(o=>{for(const v of o.matrixWorld.elements)assert(Number.isFinite(v));});assert.equal(e.rig.root.parent,g.G.scene);g.G.world.remove(e);}assert.equal(g.G.expansionFoes.ids.length,8);pass('eight distinctive actual THREE rigs build, animate, share geometry and produce finite rooted matrices');
}
{
 const g=fixture('inu',true),e=spawn(g,'sniper',11),p=g.p;tickFoe(g,e);assert.equal(e.pending.def.id,'sniper_committed');const wait=e.pending.t;assert(wait>=50);const aim={...e.aimPoint};p.z=1.5;g.n.player.x=p.x*60;tickFoe(g,e,wait-1);assert.equal(g.G.combat.projectiles.length,0);assert(e.rig.beam.visible);assert.deepEqual(JSON.parse(JSON.stringify(e.aimPoint)),aim);tickFoe(g,e,3);const pr=g.G.combat.projectiles[0];assert(pr&&pr.vx<0);assert(Math.abs(pr.vz)<1e-10,'shot must not track target new lane');assert.equal(pr.dmg,14);assert.equal(e.rig.beam.visible,false);shots.push({windup:wait,speed:Math.hypot(pr.vx,pr.vz),target:aim});pass('sniper shows at least50-tick aim line, commits original lane, fires only after telegraph and exposes recovery');
}
{
 const g=fixture('inu',true),e=spawn(g,'skyarmor',8);let phase=[],landAt=0,firstTakeoff=0;for(let i=0;i<250;i++){const old=e.skyPhase;tickFoe(g,e);if(old!==e.skyPhase)phase.push({frame:i+1,phase:e.skyPhase});if(e.skyPhase==='recover'&&!landAt){landAt=i+1;assert.equal(e.y,0);assert(e.onGround);assert(e.rig.ring.visible);}if(landAt&&e.skyPhase==='climb'){firstTakeoff=i+1;break;}}assert.deepEqual(phase.slice(0,3).map(p=>p.phase),['aim','dive','recover']);assert(firstTakeoff-landAt>=108);assert.equal(e.intangible,undefined);assert(g.G.expansionFoes.ids.includes(e.type));pass('sky armour warns then dives to committed point, lands grounded and gives108 reachable grab frames before takeoff');
}
{
 const g=fixture(),e=spawn(g,'skyarmor',g.p.x+.6);e.skyPhase='recover';e.skyT=0;e.y=0;e.onGround=true;g.key('KeyL');g.step();assert.equal(g.n.player.state,'grab');assert.equal(e.grabbedBy,1);pass('actual registered skyarmour entity is reachable by the real native Grab button during grounded recovery');
}
{
 const g=fixture(),e=spawn(g,'sniper',10),second=g.G.makeEnt({team:0,x:9,z:0,hp:100,maxHp:100,dead:false});g.G.world.add(second);g.G.coop={enabled:true,players:[g.p,second]};assert(g.G.foes.h.target(e)===second,'must target nearest living P2');second.dead=true;assert(g.G.foes.h.target(e)===g.p,'must fall back to living P1');g.p.dead=true;assert.equal(g.G.foes.h.target(e),null);pass('two-player enemy targeting chooses nearest living hero, falls back after KO, and stops with no targets');
}
{
 const g=fixture();for(const id of ['ashigaru','naginata','shinobi','akoni','ao_oni','taiko_oni']){const e=spawn(g,id,g.p.x+1,0);g.G.foes.tick(e);assert(e.pending,id+' did not choose unique attack');assert.equal(e.pending.def.id,g.G.expansionFoes.moves[id].id);assert(e.pending.t>=28);e.pending=null;g.G.foes.h.release(e);g.G.world.remove(e);}assert.equal(new Set(Object.values(g.G.expansionFoes.moves).map(d=>d.id)).size,6);pass('six Japanese/Oni troop roles commit six different telegraphed melee, fan, ice and double-drum attacks');
}
function attackCase(hero,armor,dir,grab){const g=game(hero,{foes:[36]});vm.runInContext(readModule('30_foes.js'),g.env.c);vm.runInContext(readModule('32_expansion_foes.js'),g.env.c);const f=g.foes[0];f.def={...f.def,grabArmor:armor};g.G.game.diff.heroDmg=1;
 if(grab){g.key('KeyL');g.step();g.key('KeyL',false);g.step(2);assert.equal(g.n.player.state,'grab');if(dir)g.key(dir);g.key('KeyJ');g.step();g.key('KeyJ',false);}else{g.key('KeyJ');g.step();g.key('KeyJ',false);}
 g.step(260);return {damage:100000-f.hp,hits:g.trace().hits,dead:f.dead,ref:g.n.enemies[0]};}
{
 const base=attackCase('inu',false,null,false),armor=attackCase('inu',true,null,false);assert(base.damage>armor.damage&&armor.damage>0,JSON.stringify({base:base.damage,armor:armor.damage,hits:armor.hits}));assert(armor.damage<=Math.max(1,Math.ceil(base.damage*.1)));pass('actual native ordinary Attack on sky armour applies severe reduction before native HP/death resolution');
}
for(const hero of ['inu','shima','nuko','guard8','watch','wanden','mack'])for(const direction of [null,'ArrowRight','ArrowLeft','ArrowUp','ArrowDown']){
 const base=attackCase(hero,false,direction,true),armor=attackCase(hero,true,direction,true);assert(base.damage>0,hero+' no grab damage');assert.equal(armor.damage,base.damage,hero+' '+direction+' grab must ignore sky armour');
}
pass('all35 actual native hero/directional grab followups keep full damage including Mack deferred rocket/drill');
{
 const g=game('inu',{foes:[36,120]});for(const f of ['30_foes.js','32_expansion_foes.js'])vm.runInContext(readModule(f),g.env.c);g.foes[1].def.grabArmor=true;g.key('KeyL');g.step();g.key('KeyL',false);assert.equal(g.n.player.state,'grab');const f=g.foes[1],hp=f.hp;
 g.n.projectiles.push({owner:'player',_pubGrab:false,x:f.x*60-5,y:g.p._publishedCtx.lane,zz:20,vx:.1,vy:0,vzz:0,r:8,dmg:20,life:20,trail:[],spin:0,color:'#fff'});g.step();assert(Math.abs((hp-f.hp)-1)<1e-7,'old ordinary projectile must stay5% while owner holds a different enemy');pass('ordinary projectile provenance cannot inherit full grab damage from owner current grab state');
}
{
 const g=game('inu',{foes:[36]});for(const f of ['30_foes.js','32_expansion_foes.js'])vm.runInContext(readModule(f),g.env.c);const f=g.foes[0];f.def.grabArmor=true;f.hp=f.maxHp=3;g.key('KeyJ');g.step();g.key('KeyJ',false);g.step(30);assert(f.hp>0&&f.hp<3);assert.equal(f.dead,false);assert.equal(g.n.enemies[0].dead,false);pass('actual native pre-hit armour prevents a nominally lethal normal Attack from firing KO prematurely');
}
{
 const g=fixture();const f=spawn(g,'skyarmor');f.hp=10;f.maxHp=10;g.G.combat.damage(f,100,{src:g.p,grab:false});assert.equal(f.hp,5);assert.equal(f.dead,false);g.G.combat.damage(f,5,{src:g.p,grab:true});assert.equal(f.hp,0);assert.equal(f.dead,true);pass('armour chip cannot trigger premature native-style lethal handling; valid grab can finish it');
}
const out=path.join(root,'evidence/expansion-20261026');fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'enemies-cpu.json'),JSON.stringify({status:'PASS_CPU',cases,shots,limits:'Production enemy/combat/native input and THREE transforms in Node VM; no pixels, browser trusted touch or actual device acceptance'},null,2));

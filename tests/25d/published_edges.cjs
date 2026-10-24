'use strict';
const {game,root}=require('./published_harness.cjs');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
let count=0;const results=[];
function test(name,fn){fn();count++;results.push(name);console.log('PASS '+name);}
const attacks=g=>g.trace().actions.filter(a=>a.state==='attack');
test('hitstop freezes the published command clock and cancellation clears queued presses',()=>{
  const g=game('inu',{foes:[]});g.G.hitStop=20;g.motion('hadou');g.key('KeyJ');g.step(4);
  assert.equal(g.n.clock,0);assert.equal(g.n.player.in.pressed.atk,true);
  g.G.input.clear();g.step(80);assert.equal(attacks(g).length,0);
  g.key('KeyJ');g.step();assert.equal(attacks(g).length,1);
});
test('damage clears pending directions and attack without replaying a physically held key',()=>{
  const g=game('inu',{foes:[]});g.motion('hadou');g.key('KeyJ');
  const hp=g.p.hp;assert.equal(g.G.combat.damage(g.p,10,{dir:1}),true);assert.ok(g.p.hp<hp);
  assert.equal(g.G.commands.cardSeq.length,0);assert.equal(g.n.player.in.pressed.atk,false);
  g.step(120);assert.equal(attacks(g).length,0);assert.equal(g.n.player.charge,0);
  g.key('KeyJ',false);g.step();g.key('KeyJ');g.step();assert.equal(attacks(g).length,1);
});
test('blur and repeated keydown after resume do not synthesize a new attack or charge',()=>{
  const g=game('inu',{foes:[]});g.key('KeyJ');g.step(12);g.env.event('blur');
  const before=attacks(g).length;g.env.event('keydown',{code:'KeyJ',repeat:true});g.step(100);
  assert.equal(attacks(g).length,before);assert.equal(g.n.player.charge,0);
  g.key('KeyJ',false);g.step();g.key('KeyJ');g.step();assert.equal(attacks(g).length,before+1);
});
test('stick wobble and short reversals never become a rotation ultimate',()=>{
  const g=game('inu',{foes:[]});for(let i=0;i<80;i++){g.G.commands.touchMove(48,i%2?8:-8);g.step();}
  assert.equal(g.G.commands.rotationReady(),false);g.G.commands.touchEnd();g.key('KeyJ');g.step();
  assert.equal(g.p.dim,3);assert.ok(!['ult','airUlt'].includes(g.n.player.state));
});
test('grab suspends the existing 3D foe immediately, including the hold before any damage',()=>{
  const g=game('inu',{foes:[36]});g.key('KeyL');g.step();assert.equal(g.n.player.state,'grab');
  assert.equal(g.foes[0].grabbedBy,1);assert.equal(g.foes[0].publishedReactive,true);g.key('KeyL',false);g.step(20);
  assert.equal(g.foes[0].publishedReactive,true);
});
test('juggled foes integrate published horizontal and vertical reactions once per tick',()=>{
  const g=game();g.step();const e=g.n.enemies[0];Object.assign(e,{controlled:true,state:'air',x:300,z:40,vx:12,vz:-10});
  g.step();assert.equal(e.x,312);assert.equal(e.z,50);assert.equal(g.foes[0].x,312/60);assert.equal(g.foes[0].y,50/60);
});
test('published flinch interrupts the old 3D attack instead of letting an airborne foe keep hitting',()=>{
  const g=game('inu',{foes:[36]});g.foes[0].atk={def:{},t:0};g.foes[0].pending={};g.key('KeyL');g.step();
  assert.equal(g.foes[0].atk,null);assert.equal(g.foes[0].pending,null);
});
test('intangible and entering 3D foes are neither hit nor grabbed',()=>{
  for(const kind of ['intangible','spawn']){const g=game('inu',{foes:[36]});const t=g.foes[0];if(kind==='intangible')t.intangible=true;else t.state='spawn';
    g.key('KeyL');g.step();assert.notEqual(g.n.player.state,'grab');g.key('KeyL',false);g.key('KeyJ');g.step(60);
    assert.equal(t.hp,100000);assert.equal(t.state,kind==='spawn'?'spawn':'idle');}
});
test('existing 3D shield/block callbacks still reject a canonical hit',()=>{
  const g=game('inu',{foes:[36]});let blocks=0;g.foes[0].def.block=()=>{blocks++;return true;};
  g.key('KeyJ');g.step();g.key('KeyJ',false);g.step(70);assert.ok(blocks>0);assert.equal(g.foes[0].hp,100000);
});
test('ordinary attacks still break existing 3D props once per hit window',()=>{
  const g=game('inu',{foes:[]});let broken=0;g.G.props={break(t){t.dead=true;broken++;}};
  const t=g.G.makeEnt({kind:'prop',team:2,x:g.p.x+.5,z:0,y:0,hp:1,maxHp:1,height:1,radius:.3});g.G.world.add(t);
  g.key('KeyJ');g.step();g.key('KeyJ',false);g.step(70);assert.equal(broken,1);
});
test('the existing difficulty scales outgoing hits and incoming melee/projectiles',()=>{
  const g=game();g.G.game.diff.heroDmg=1.3;g.motion('hadou');g.key('KeyJ');g.step();g.key('KeyJ',false);g.step(80);
  assert.ok(g.trace().hits.some(h=>h.damage===16));
  for(const projectile of [false,true]){const q=game('inu',{foes:[]});q.G.game.diff.foeDmg=.5;const hp=q.p.hp;
    const info=projectile?{projectile:{x:q.p.x,y:0,z:0,r:.3,vx:-.2,vz:0,vy:0}}:{dir:1};q.G.combat.damage(q.p,20,info);assert.equal(hp-q.p.hp,10);}
});
fs.writeFileSync(path.join(root,'evidence/commands-20261013/stage2/input-edges.json'),JSON.stringify({groups:count,results,status:'PASS'},null,2));
console.log('published bridge edge regression '+count+' groups PASS');

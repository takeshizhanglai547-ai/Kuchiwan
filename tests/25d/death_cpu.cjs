'use strict';
const {game,root}=require('./published_harness.cjs');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const g=game('inu',{foes:[]}),{G,p,n}=g;
g.key('ArrowDown');g.key('KeyJ');G.combat.damage(p,999999,{dir:1,power:3});
assert.equal(p.dead,true);assert.equal(n.player.hp,0);g.step(110);
assert.equal(n.player.charge,0);assert.equal(n.player.in.cardSeq.length,0);
const count=g.trace().actions.filter(a=>a.state==='attack').length;
// Exercise the actual native revive bridge invoked by the scene after its KO wait.
// Scene lives/retry buttons require browser coverage and are not simulated here.
p.dead=false;p.hp=p.maxHp;p.inv=180;g.step();
assert.equal(n.player.hp,n.player.maxHp);assert.equal(p.dead,false);g.step(90);
assert.equal(g.trace().actions.filter(a=>a.state==='attack').length,count,'held input replay after revival');
g.key('ArrowDown',false);g.key('KeyJ',false);g.step();g.key('KeyJ');g.step();assert.equal(n.player.state,'attack');
const report={status:'PASS_CPU',deathClearsEdges:true,bridgeReviveRestoresHP:true,heldInputDoesNotReplay:true,freshPressWorks:true,
 limits:'Native death and revive bridge only. Actual scene KO timer, life depletion, game-over/restart UI and touch restart remain unverified in this environment.'};
fs.writeFileSync(path.join(root,'evidence/commands-20261024/death-cpu.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));

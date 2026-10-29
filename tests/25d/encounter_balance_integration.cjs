'use strict';
const {setup,root,readModule}=require('./story_harness.cjs'),vm=require('node:vm'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
if(process.argv.includes('--mutations')){const {spawnSync}=require('node:child_process'),file='92_encounter_balance.js',from="(e.state==='idle'||e.state==='move')",to="e.state==='idle'",code=readModule(file);assert(code.includes(from));new vm.Script(code.replace(from,to));const r=spawnSync(process.execPath,[__filename],{cwd:root,encoding:'utf8',timeout:120000,env:{...process.env,INU25D_CPU_MUTATION:JSON.stringify({file,from,to})}});assert.equal(r.status,1);assert(r.stderr.includes('moving boss discretionary cooldown must receive frequency increase'));const out=path.join(root,'evidence/polish-20261029');fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'encounter-balance-integration-mutations.json'),JSON.stringify({status:'PASS',results:[{name:'moving boss frequency boost removed',killed:true}]},null,2));console.log('PASS real moving-boss frequency regression mutation detected');process.exit(0);}
const cases=[],rows=[];
function env(coop=false,balanced=true){const g=setup();g.G.coop={enabled:coop,players:[g.p],clearInputs(){},restoreCamera(){},grace(){},updateInputs(){}};if(coop){const q=g.G.playerCtl.create('shima',5,.5);g.G.coop.players.push(q);}if(balanced)vm.runInContext(readModule('92_encounter_balance.js'),g.env.c);return g;}
function tick(g,e,n=1){for(let i=0;i<n;i++){g.G.time.tick++;g.G.time.sceneTick++;g.G.foes.tick(e);}}
function finish(g){while(g.G.story.pending||g.G.story.blocked){g.G.hitStop=0;if(!g.G.story.blocked)g.G.story.flush();for(let i=0;i<31;i++)g.G.story.tick();assert(g.G.story.skip());}}
for(const coop of [false,true]){
 {
 const a=env(coop),old=env(coop,false);for(const ctx of [a,old]){ctx.key('ArrowRight');ctx.key('ArrowUp');ctx.step(24);}assert.equal(a.p.x,old.p.x);assert.equal(a.p.z,old.p.z);assert(a.p.x>4);assert(a.p.z!==0);cases.push('real keyboard player walking and depth unchanged '+(coop?'2P-mode':'1P'));
 }
 const g=env(coop),base=env(coop,false),b=g.spawn('emperor'),old=base.spawn('emperor'),factor=g.G.encounterBalance.profile(b).hp,initialMul=b.hpMul;
 assert.equal(b.hp,Math.round(old.hp*factor));
 for(const form of [1,2,3]){if(form>1){b.inv=0;g.G.combat.damage(b,b.maxHp*20,{dir:1,power:3});old.inv=0;base.G.combat.damage(old,old.maxHp*20,{dir:1,power:3});assert.equal(b.form,form);assert.equal(b.maxHp,Math.round((form===3?1050:1000)*initialMul));assert.equal(b.hpMul,initialMul);finish(g);finish(base);}const hp=b.maxHp;b.hp=hp*.5;g.G.bus.emit('hit',{target:b,dmg:1});assert.equal(b.phase,0);b.hp--;g.G.bus.emit('hit',{target:b,dmg:1});assert.equal(b.phase,1);assert.equal(b.maxHp,hp);assert.equal(b.hpMul,initialMul);assert.equal(g.G.story.pending,1);finish(g);g.G.encounterBalance.apply(b);assert.equal(b.maxHp,hp);rows.push({coop,form,maxHP:hp,hpMultiplier:initialMul,unbalancedMaxHP:old.maxHp,durabilityRatio:hp/old.maxHp});}
 b.inv=0;g.G.combat.damage(b,b.maxHp*20,{dir:1,power:3});assert(b.dead);assert.equal(g.G.story.pending,0);cases.push('emperor three real KO transformations / strict-half phases scale once '+(coop?'2P':'1P'));
 for(const type of ['garm','shark','ghost','cerbe','slime','dragon','kuroinu']){const e=g.spawn(type),max=e.maxHp,mul=e.hpMul;e.hp=max*.5;g.G.bus.emit('hit',{target:e,dmg:1});assert.equal(e.phase,0);e.hp--;g.G.bus.emit('hit',{target:e,dmg:1});assert.equal(e.phase,1,type);assert.equal(e.maxHp,max);assert.equal(e.hpMul,mul);finish(g);g.G.encounterBalance.apply(e);assert.equal(e.maxHp,max);}
 cases.push('all seven other bosses phase without HP reapplication '+(coop?'2P':'1P'));
 {
 const a=env(coop),old=env(coop,false),e=a.spawn('garm'),o=old.spawn('garm');for(const [ctx,boss]of [[a,e],[old,o]]){boss.x=ctx.p.x+10;boss.z=ctx.p.z+1;boss.cool=100;tick(ctx,boss,50);}rows.push({coop,movingBossCooldown:{baseline:o.cool,balanced:e.cool,state:e.state}});assert.equal(e.state,'move');assert(e.cool<o.cool-3,'moving boss discretionary cooldown must receive frequency increase');assert.equal(e.vx,o.vx,'frequency does not increase movement speed');assert.equal(e.vz,o.vz);cases.push('real moving boss hover cooldown accelerates without speed change '+(coop?'2P':'1P'));
 }
 function wait(balanced){const a=env(coop,balanced),e=a.spawn('sniper');e.x=a.p.x+5;e.z=a.p.z;e.cool=100;let n=0;while(!e.pending&&n<200){tick(a,e);n++;}assert(e.pending,'real sniper eventually attacks');return {n,windup:e.pending.t,speed:e.def.spd};}
 const regular=wait(false),fast=wait(true);assert(fast.n<regular.n);assert(fast.n>regular.n*.65);assert.equal(fast.windup,regular.windup);assert.equal(fast.speed,regular.speed);rows.push({coop,realSniperFirstTelegraph:{baseline:regular.n,balanced:fast.n,windup:fast.windup}});cases.push('real AI shorter discretionary wait, identical telegraph and walk speed '+(coop?'2P':'1P'));
 {
 const a=env(coop),e=a.spawn('sniper');e.cool=60;e.state='act';e.lastAtk={recover:60};tick(a,e);const end=e.punishUntil;assert.equal(end,a.G.time.tick+a.G.game.diff.punishWindow);const cool=e.cool;tick(a,e,a.G.game.diff.punishWindow-1);assert.equal(e.cool,cool-a.G.game.diff.punishWindow+1);assert.equal(e.vx,0);assert.equal(e.vz,0);assert(!e.pending);cases.push('real act exit preserves entire stationary punish window '+(coop?'2P':'1P'));
 }
 {
 const a=env(coop),e=a.spawn('skyarmor');e.skyPhase='recover';e.skyT=0;e.cool=108;tick(a,e,107);assert.equal(e.skyPhase,'recover');assert.equal(e.skyT,107);assert.equal(e.cool,1);assert.equal(e.y,0);tick(a,e);assert.equal(e.skyPhase,'climb');assert.equal(e.skyT,0);cases.push('actual Sky Armor grounded grab recovery remains108 ticks '+(coop?'2P':'1P'));
 }
}
const out=path.join(root,'evidence/polish-20261029');fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'encounter-balance-integration.json'),JSON.stringify({status:'PASS_ACTUAL_AI_AND_TRANSFORMS',cases,rows,limits:'Real production foe tick/AI, boss damage/transforms and story state in CPU VM; fixed-DPS durability ratios are estimates, not human fight duration or rendered/device acceptance'},null,2));console.log('PASS '+cases.length+' real integration groups');





'use strict';
const {setup,root}=require('./story_harness.cjs'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const types=['garm','shark','ghost','cerbe','slime','dragon','kuroinu','emperor'],cases=[];
function sample(type,form,phase){const g=setup(),{G,n,p}=g,b=g.spawn(type),attacks=[];
 let seed=1337;G.rng=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};G.cam.x=10;G.cam.halfW=10;
 b.form=form;b.phase=phase;b.rageDue=false;b.spdMul=phase?1.2:1;
 n.player.hp=n.player.maxHp=p.hp=p.maxHp=100000;n.player.invuln=p.inv=0;
 const actual=G.foes.h.attack;G.foes.h.attack=function(e,d,w){const ok=actual(e,d,w);if(ok&&e===b)attacks.push({id:d.id,warn:e.pending.t,active:d.hits?.map(h=>h.at)||[],len:d.len});return ok;};
 G.scenes.cpu.tick=()=>{if(G.hitStop>0){G.playerCtl.queue(p);G.hitStop--;return;}G.playerCtl.tick(p);
  for(const e of G.world.ents)if(e.team===1&&!e.publishedReactive){G.foes.tick(e);G.foes.h.alignPublishedLane(e);}
  G.combat.tick();for(const e of G.world.ents)if(e.team===1&&!e.publishedReactive)G.phys(e,G.stage.bounds());};
 g.step(2400);assert.deepEqual(Array.from(G.errors),[],type+' AI errors');assert(attacks.length>=3,type+' must keep fighting, not stall after one move');
 for(const a of attacks)if(a.warn>0)assert(a.warn>=18,'readable boss warning');
 return {attacks,damage:g.trace().hurt.reduce((s,h)=>s+h.damage,0),maxHp:b.maxHp,final:{state:b.state,x:b.x,y:b.y,z:b.z,cool:b.cool,plan:b.plan,pending:b.pending?.t,atk:b.atk?.def?.id,hero:{x:p.x,y:p.y,z:p.z,state:p.state},clock:n.clock}};}
for(const type of types)for(const form of (type==='emperor'?[1,2]:[1])){const first=sample(type,form,0),second=sample(type,form,1);
 const ids0=[...new Set(first.attacks.map(a=>a.id))],ids1=[...new Set(second.attacks.map(a=>a.id))];
 // Movement/spacing can change how often a seeded plan is reachable. Assert
 // actual authored second-phase moves, not a promised damage multiplier.
 const unique=ids1.filter(id=>!ids0.includes(id));
 assert(unique.length>0||second.attacks.length>first.attacks.length,type+' must change patterns or cadence');
 assert.equal(second.maxHp,first.maxHp,'no HP inflation');cases.push({type,form,first:{ids:ids0,commits:first.attacks.length,damage:first.damage,final:first.final},second:{ids:ids1,commits:second.attacks.length,damage:second.damage,final:second.final},newPatterns:unique});
 console.log('PASS '+type+' form '+form+' phase patterns: '+ids1.join(','));}
const probe=setup(),{G}=probe,b=probe.spawn('emperor');b.form=2;b.phase=1;b.rageDue=false;G.cam.x=10;G.cam.halfW=10;G.rng=()=>.999;G.foes.tick(b);assert.equal(b.pending.def.id,'kn_dash2','second-form enraged double dash is reachable');
fs.writeFileSync(path.join(root,'evidence/phase-events-20261024/boss-patterns-cpu.json'),JSON.stringify({status:'PASS_CPU',ticksPerFixture:2400,cases,emperorDoubleDashProbe:true,limits:'Fixed stationary hero and deterministic AI fixture. Applied damage is evidence of simulation only; it is not a human balance or rendered telegraph acceptance.'},null,2));

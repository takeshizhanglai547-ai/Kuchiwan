'use strict';
const {setup,root}=require('./story_harness.cjs'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const rows=[];
for(const phase of [0,1]){
 const g=setup(),{G,p,n}=g,b=g.spawn('emperor');b.form=3;b.def=G.foes.types.emperor._form3;b.phase=phase;b.rageDue=false;b.introDone=true;b.spdMul=phase?1.2:1;G.cam.x=10;G.cam.halfW=10;
 n.player.hp=n.player.maxHp=p.hp=p.maxHp=100000;n.player.invuln=p.inv=0;let seed=8701;G.rng=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
 const attacks=[],attack=G.foes.h.attack;G.foes.h.attack=(e,d,w)=>{const ok=attack(e,d,w);if(ok&&e===b)attacks.push({id:d.id,warning:e.pending.t,len:d.len});return ok;};
 G.scenes.cpu.tick=()=>{if(G.hitStop>0){G.hitStop--;return;}G.playerCtl.tick(p);for(const e of G.world.ents)if(e.team===1&&!e.publishedReactive)G.foes.tick(e);G.combat.tick();for(const e of G.world.ents)if(e.team===1&&!e.publishedReactive)G.phys(e,G.stage.bounds());};g.step(3600);
 assert(attacks.length>=5,'final emperor must not stall');assert(attacks.every(a=>a.id.startsWith('emp3_')));assert(attacks.every(a=>a.warning>=18),'readable final pattern warning');assert(new Set(attacks.map(a=>a.id)).size>=2,'distinct final patterns');assert.deepEqual(Array.from(G.errors),[]);rows.push({phase,attacks,actualDamage:g.trace().hurt.reduce((s,h)=>s+h.damage,0),limits:'stationary hero fixture, not playtest acceptance'});
}
for(const phase of [0,1]){
 const g=setup(),{G}=g,b=g.spawn('emperor');b.form=3;b.phase=phase;b.def=G.foes.types.emperor._form3;const d=G.foes.types.emperor._moves3.cross;d.fn(b,0);assert.equal(b.finalCross.length,3);assert(b.marks.some(m=>m.on));const before=G.combat.areas.length;d.fn(b,41);assert.equal(G.combat.areas.length,before,'no hit before42F telegraph');d.fn(b,42);assert.equal(G.combat.areas.length,before+3);d.fn(b,65);assert.equal(G.combat.areas.length,before+(phase?6:3),'secondphase repeats locked positions, no fresh snap tracking');d.fn(b,70);assert(!b.marks.some(m=>m.on));assert(b.finalCross.every(q=>q.z>=G.cfg.ZMIN&&q.z<=G.cfg.ZMAX));
 const w=G.foes.types.emperor._moves3.wings;const shots=G.combat.projectiles.length;w.fn(b,0);w.fn(b,29);assert.equal(G.combat.projectiles.length,shots);w.fn(b,30);w.fn(b,52);w.fn(b,74);assert.equal(G.combat.projectiles.length,shots+(phase?9:6));w.onEnd(b);assert(!b.lane.on);assert(b.cool>=24);rows.push({phase,lockedCrossTelegraph:42,wingFirstShot:30,wingShots:phase?9:6,recovery:b.cool});
}
const out=path.join(root,'evidence/expansion-20261026');fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'boss-expansion-patterns.json'),JSON.stringify({status:'PASS_CPU',rows,limits:'Actual AI/attacks/collisions on fixed CPU ticks; no rendered telegraph visibility or actual audio/mobile acceptance'},null,2));console.log('PASS final-form actualAI,42F locked cross warnings,30F fan volley warnings,secondphase pressure and recovery');

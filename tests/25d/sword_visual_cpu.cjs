'use strict';
const {game,root}=require('./published_harness.cjs'),{readModule}=require('./input_cpu.cjs');
const vm=require('node:vm'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
function run(withVisual,level){const g=game('inu',{level,foes:[36,96,160],actualRig:true}),{G,env,n}=g,events=[];
 if(withVisual){vm.runInContext(readModule('61_published_swords.js'),env.c);const fn=G.publishedSwords.particle;
  G.publishedSwords.particle=function(f,...args){const used=fn.call(this,f,...args);if(used)events.push({kind:f.k,x:f.x,y:f.y,h:f.h,fall:f.fall,tick:n.clock});return used;};}
 g.motion('du');g.key('KeyJ');g.step();g.key('KeyJ',false);
 let max=0;
 for(let i=0;i<200;i++){g.step();if(withVisual){max=Math.max(max,G.publishedSwords.count);for(const o of G.scene.children)if(o.children.length===4)assert(o.position.toArray().every(Number.isFinite));}}
 if(withVisual){assert(events.some(e=>e.kind==='fsword'));assert(events.some(e=>e.kind==='hsword'));assert.equal(G.publishedSwords.count,0);
  // Every impact must land at the authored nine native ticks after its spawn.
  for(const e of events.filter(e=>e.kind==='hsword'))assert(events.some(f=>f.kind==='fsword'&&f.x===e.x&&f.y===e.y&&e.tick-f.tick===9),'native sword impact time '+JSON.stringify({e,events}));
  G.publishedSwords.particle({k:'fsword',x:300,y:0,h:120,fall:9,life:25},g.p,0,n.clock);assert.equal(G.publishedSwords.count,1);G.bus.emit('scene',{name:'title'});assert.equal(G.publishedSwords.count,0);}
 return {trace:JSON.parse(JSON.stringify(g.trace())),events,max};}
const cases=[];for(const level of [1,5]){const base=run(false,level),visual=run(true,level);assert.deepEqual(visual.trace,base.trace,'display must never alter native hits/actions');cases.push({level,events:visual.events,maxLive:visual.max});}
fs.writeFileSync(path.join(root,'evidence/commands-20261024/swords-cpu.json'),JSON.stringify({status:'PASS_CPU',cases,limits:'THREE objects, native spawn/impact timestamps and lifecycle only. GPU appearance has not been inspected.'},null,2));
console.log('PASS base/upgraded holy sword objects match native nine-tick impacts, preserve damage/actions, expire and clear on scene change');

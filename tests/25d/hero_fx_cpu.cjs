'use strict';
const {scene}=require('./motion_visual_cpu.cjs'),{productionCamera}=require('./motion_projection_cpu.cjs'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const rows=[];
for(const hero of ['inu','shima','nuko','guard8','watch','wanden','mack'])for(const [kind,key,slot]of [['normal','KeyJ'],['command','KeyJ','hadou'],['special','KeyH'],['ultimate','KeyO']]){
 const traces=[];let frames=0;
 for(const before of [true,false]){const g=scene(hero);if(before){const pr=g.G.fx.makeProjectile;vm.runInContext(fs.readFileSync(path.join(__dirname,'fixtures/hero_fx_aef.js'),'utf8'),g.env.c);g.G.fx.makeProjectile=pr;}if(slot)g.motion(slot);g.key(key);g.step();g.key(key,false);
 for(let t=0;t<200;t++){g.step();for(const v of g.G.fx._debug.commandCues())if(v.phase==='active'&&v.root.visible){if(!before){frames++;let strokes=0;for(const q of [v.arc,v.ring,v.beam])if(q.visible){assert(q.children.some(n=>n.name==='cue-light-core'));assert(q.children.some(n=>n.name==='cue-contrast-rim'));strokes++;}if(v.flame.visible)assert(v.flame.children.some(n=>n.name==='cue-flame-core'));assert(strokes||v.flame.visible);assert(v.mat.opacity>=.8&&v.white.opacity>.9);}}}
 traces.push(JSON.parse(JSON.stringify(g.trace())));g.G.bus.emit('scene',{});assert.equal(g.G.fx.stats().commandCues,0);}
 assert.deepEqual(traces[0],traces[1]);if(!(hero==='inu'&&kind==='special'))assert(frames>0,hero+kind);rows.push({hero,kind,activeCueFrames:frames,identicalNativeTrace:true});
}
// A genuine missing-core production fault must fail our geometry predicate.
{const code=fs.readFileSync(path.resolve(__dirname,'../../inu25d/src/60_fx.js'),'utf8');const faulty=code.replace('part.add(rim,core);','part.add(rim);');assert.notEqual(faulty,code);new vm.Script(faulty);const g=scene('inu');vm.runInContext(faulty,g.env.c);g.G.fx.commandCue(g.p,{id:'c1',t:3,act:[1,8],def:{}});assert(!g.G.fx._debug.commandCues()[0].arc.children.some(n=>n.name==='cue-light-core'),'mutant survives');}
const out=path.resolve(__dirname,'../../evidence/hero-fx-20261029');fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'hero-fx-cpu.json'),JSON.stringify({status:'PASS',rows,mutation:'Syntax-valid removal of luminous core detected by same geometry assertion',limits:'Inu dedicated special has no native attack display window; original special particles unchanged. CPU THREE only; no GPU/mobile acceptance.'},null,2));console.log('PASS28 hero/action native traces and stroke lifecycles; missing-core fault detected');


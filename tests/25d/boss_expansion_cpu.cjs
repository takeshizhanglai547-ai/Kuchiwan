'use strict';
const {setup,root,readModule}=require('./story_harness.cjs'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const cases=[],types=['garm','shark','ghost','cerbe','slime','dragon','kuroinu','emperor'];
function finish(g){let count=0;while(g.G.story.blocked||g.G.story.pending){assert(++count<15,'story queue stalled');g.G.hitStop=0;if(!g.G.story.blocked){assert(g.G.story.flush());continue;}g.step(31);assert(g.G.story.skip());}}
function actualRig(g,b){if(b.rig?.root.parent)b.rig.root.removeFromParent();b.rig?.dispose?.();b.rig=g.G.foes.types[b.type].build(b);g.G.scene.add(b.rig.root);return b.rig;}
for(const type of types)for(const form of(type==='emperor'?[1,2,3]:[1])){
 const g=setup(),{G}=g,b=g.spawn(type);b.form=form;if(type==='emperor'&&form>1)b.def=G.foes.types.emperor['_form'+form];const rig=actualRig(g,b),before=rig.root.children.length;
 b.hp=b.maxHp*.5;G.bus.emit('hit',{target:b,dmg:1});assert.equal(b.phase,0,'exactly half '+type);assert.equal(G.story.pending,0);
 b.hp-=1;G.bus.emit('hit',{target:b,dmg:1});assert.equal(b.phase,1);assert.equal(G.story.pending,0);assert(rig.phaseDressing);assert.ok(rig.phaseDressing.parent===(rig.kit?.body||rig.root),'phase dressing must attach to animated body');assert(rig.phaseDressing.children.length>=4);const visual=rig.phaseDressing;G.bossPhaseVisual(b);assert.equal(rig.phaseDressing,visual,'single visual allocation');
 rig.root.updateMatrixWorld(true);const box=new g.env.c.THREE.Box3().setFromObject(rig.root);assert(box.min.toArray().concat(box.max.toArray()).every(Number.isFinite));
 const native=g.n.clock,clock=G.time.tick;g.step(15);assert(g.n.clock>native);assert(G.time.tick>clock);assert(!G.story.blocked);
 b.hp=b.maxHp;G.bus.emit('hit',{target:b,dmg:0});b.hp=1;G.bus.emit('hit',{target:b,dmg:0});assert.equal(G.story.pending,0,'healing no repeat');
 let disposed=0;for(const c of visual.children)c.geometry.addEventListener('dispose',()=>disposed++);rig.dispose();rig.dispose();assert.equal(disposed,visual.children.length);assert.equal(visual.parent,null);assert.deepEqual(Array.from(G.errors),[]);cases.push({type,form,strictHalf:true,singleTrigger:true,realPhaseGeometry:true,pauseSkip:true,ownedDisposal:true});
}
{
 const g=setup(),{G}=g,b=g.spawn('emperor');actualRig(g,b);let events=0;G.bus.on('bossForm',()=>events++);
 for(const expected of [2,3]){b.inv=0;G.combat.damage(b,b.maxHp*10,{dir:1,power:3});assert.equal(b.form,expected);assert(!b.dead);assert(b.hp>0);assert(b.transforming);assert.equal(G.story.pending,0);G.hitStop=0;const native=g.n.clock;g.step(150);assert(g.n.clock>native);assert(!b.transforming);assert(!b.intangible);if(expected===3){assert.equal(b.rig.formSilhouette,'sovereign-winged-twinblade');assert(b.rig.root.getObjectByName('emperor-form3-wings-crown'));const second=b.rig.root.getObjectByName('sovereign-second-blade');assert(second);assert.equal(second.parent,b.rig.kit.armL,'second blade follows animated arm');}}
 b.inv=0;G.combat.damage(b,b.maxHp*10,{dir:1,power:3});assert(b.dead);assert.equal(events,2);assert.equal(G.story.pending,0,'final lethal has no newform');cases.push({emperorThreeForms:true,lethalTransitions:2,finalDefeat:true});
}
for(const hero of ['inu','shima','nuko','guard8','watch','wanden','mack']){const g=setup(hero),{G}=g,spec=G.story.heroes[hero];assert.equal(spec.start.length,9);assert.equal(spec.clear.length,9);for(const index of [7,8]){G.story.beginStage(hero,index);G.story.flush();assert.equal(G.story.active.lines[1],spec.start[index]);finish(g);assert(G.story.clearStage());assert.equal(G.story.clearStage(),false);G.story.flush();assert.equal(G.story.active.lines[1],spec.clear[index]);finish(g);}cases.push({hero,bonusStageEvents:2});}
{
 const g=setup(),{G}=g,b=g.spawn('emperor');G.combat.damage(b,b.maxHp*4,{dir:1,power:3});
 G.story.reset();assert(b.transforming,'stage story reset does not cancel live transformation');
 g.step(150);assert(!b.transforming&&!b.intangible);cases.push({storyResetIndependentOfTransformation:true});
}
{
 const g=setup(),{G}=g,b=g.spawn('emperor');for(const expected of [2,3]){b.inv=0;b.hp=1;b.state='idle';b.x=g.p.x+.6;b.z=g.p.z;g.key('KeyJ');g.step();g.key('KeyJ',false);g.step(150);assert.equal(b.form,expected,'actual native hit transitions');assert(!b.dead);assert.equal(G.story.pending,0);finish(g);g.step(80);}assert.deepEqual(Array.from(G.errors),[]);cases.push({nativeCommandHitTransitionsBothForms:true});
}
const out=path.join(root,'evidence/expansion-20261026');fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'boss-expansion.json'),JSON.stringify({status:'PASS_CPU',cases,limits:'Actual THREE hierarchy/geometry/CPU transitions and synthetic DOM; no rendered pixels, trusted touch or device QA'},null,2));console.log('PASS '+cases.length+' boss expansion groups');

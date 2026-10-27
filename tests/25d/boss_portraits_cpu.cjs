'use strict';
const {setup,root,readModule}=require('./story_harness.cjs'),vm=require('node:vm'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const g=setup(),{G,env}=g,c=env.c;let current={tag:'original-target'},alpha=.7,auto=false,rendered=0,builds=0;
const previous=current;
G.renderer={getRenderTarget:()=>current,getClearAlpha:()=>alpha,getClearColor:o=>o.set(0x123456),setRenderTarget:v=>{current=v;},setClearColor:(v,a)=>{alpha=a;},get autoClear(){return auto;},set autoClear(v){auto=v;},clear(){},render(s,cam){let meshes=0;s.traverse(o=>{if(o.isMesh)meshes++;});assert(meshes>0);assert(cam.position.toArray().every(Number.isFinite));rendered++;},readRenderTargetPixels(rt,x,y,w,h,data){assert.equal(data.length,w*h*4);}};
c.document.createElement=tag=>({width:0,height:0,getContext:()=>({createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4)}),putImageData(){},drawImage(){}}),toDataURL:()=> 'data:image/png;base64,CPU_FIXTURE_ONLY'});
G.foes.build=(type,b)=>{builds++;return G.foes.types[type].build(b);};
vm.runInContext(readModule('83_boss_portraits.js'),c);const cases=[];
for(const type of Object.keys(G.story.bosses))for(const form of (type==='emperor'?[1,2,3]:[1])){
 const boss={...G.makeEnt({type,team:1,def:G.foes.types[type],hp:100,maxHp:100}),form,phase:1};boss.def.init?.(boss,{});boss.form=form;boss.phase=1;
 const url=G.bossPortrait(boss,{size:160});assert(url);const count=builds;assert.equal(G.bossPortrait(boss,{size:160}),url);assert.equal(builds,count,'portrait cache');
 assert.equal(current,previous);assert.equal(alpha,.7);assert.equal(auto,false);cases.push({type,form,actualRigBuilt:true,rendererStateRestored:true,cached:true});
}
assert.equal(rendered,10);assert.deepEqual(Array.from(G.errors),[]);
fs.writeFileSync(path.join(root,'evidence/phase-events-20261024/portraits-cpu.json'),JSON.stringify({status:'PASS_CPU',cases,limits:'Actual THREE boss rigs, camera framing and renderer-state calls against a stub renderer. Pixels are NOT rendered or visually accepted; fixture data URLs are not delivered as art.'},null,2));console.log('PASS ten actual boss/form rigs, finite portrait cameras, render-state restoration and cache (CPU only)');

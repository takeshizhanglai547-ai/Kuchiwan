'use strict';
const {game,root}=require('./published_harness.cjs');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(path.join(root,'inu25d/src/80_ui.js'),'utf8');
const handlers=source.slice(source.indexOf('function btnDown('),source.indexOf('// rolling a thumb'));
const report=[];
const catalog=require('../../evidence/commands-20261024/coverage-source.json');
for(const hero of ['inu','shima','nuko','guard8','watch','wanden','mack']){
 const g=game(hero,{foes:[],actualRig:true}),{G,n,env}=g;
 env.c.T={visible:true,saw:false};
 vm.runInContext(handlers+';globalThis.nativeTouch={btnDown,btnOff};',env.c);
 const button={k:'attack',ids:[],el:{setPointerCapture(){},classList:{add(){},remove(){}}}};
 env.c.nativeTouch.btnDown(button,{pointerId:2,pointerType:'touch',cancelable:true,preventDefault(){},stopPropagation(){}});
 assert.equal(G.input.touch.attack,true);g.step(90);
 const held={charge:n.player.charge,held:n.player.atkHoldF,state:n.player.state};assert.equal(held.charge,1,hero+' actual touch-handler 90 ticks');
 env.c.nativeTouch.btnOff(button);g.step();
 const expected=catalog.rows.find(r=>r.hero===hero&&r.group==='charge'&&r.level===1).id;
 assert.equal(n.player.state==='attack'?n.player.atk?.type:n.player.state,expected,hero+' held-release move');
 assert.equal(g.p.publishedMotion?.id,expected,hero+' charge has a dedicated display clock');
 assert.equal(g.p.rig.st.pubPose?.id||g.p.rig.st.inuPose?.id,expected,hero+' charge has an actual model pose');
 report.push({hero,...held,releasedId:expected,modelPose:g.p.rig.st.pubPose?.id||g.p.rig.st.inuPose?.id});
}
fs.writeFileSync(path.join(root,'evidence/commands-20261024/touch-handlers-cpu.json'),JSON.stringify({status:'PASS_CPU',cases:report,
 limits:'Actual button-down/off functions and actual THREE rigs. No DOM hit testing, browser pointer capture, trusted multitouch events, layout, GPU, or physical phone. The previous browser charge failure remains unresolved.'},null,2));
console.log('PASS seven heroes: actual touch-button handlers hold 90 ticks and release charged attack; browser event chain remains unverified');

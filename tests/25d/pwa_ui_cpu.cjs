'use strict';
const {setup,readModule,root}=require('./story_harness.cjs'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const version=JSON.parse(fs.readFileSync(path.join(root,'inu25d/app/version.json'),'utf8')).version,source=fs.readFileSync(path.join(root,'inu25d/pwa/runtime.js'),'utf8').replace('@@VERSION@@',JSON.stringify(version));
async function fixture(options={}){const g=setup('inu',true),c=g.env.c,create=c.document.createElement,callbacks={},timers=new Map(),state={registers:[],reloads:0,messages:[],latest:options.latest||version,ready:options.ready!==false,repairs:0,applied:0,fail:options.fail||false,updates:0,key:null};let tid=0;
 const all=e=>[e,...(e.children||[]).flatMap(all)];c.document.createElement=tag=>{const e=create(tag);e.dataset={};e.querySelectorAll=selector=>all(e).filter(n=>selector==='button'&&n.tagName==='BUTTON');return e;};c.document.head=c.document.createElement('head');
 vm.runInContext(readModule('91_same_screen_coop.js'),c);g.G.coop.enable('inu','shima');g.G.debug.play('inu',0,'hard');g.step();while(g.G.story.blocked||g.G.story.pending){if(!g.G.story.blocked){g.G.story.flush();continue;}g.step(31);g.G.story.skip();}
 const reg={waiting:null,installing:null,active:null,addEventListener(k,f){callbacks[k]=f;},async update(){state.updates++;}};
 function worker(v){return {postMessage(data,ports){state.messages.push(data);if(data.type==='GET_APP_STATUS'||data.type==='REPAIR_APP_CACHE'){if(data.type==='REPAIR_APP_CACHE'){state.repairs++;state.ready=true;}ports[0].postMessage({type:'APP_STATUS',version:v,ready:state.ready});}else if(data.type==='APPLY_APP_UPDATE'){state.applied++;reg.active=this;reg.waiting=null;callbacks.controllerchange?.();}}};}reg.active=worker(options.savedVersion||version);
 c.navigator.onLine=true;c.navigator.serviceWorker={async register(url,opt){state.registers.push({url:String(url),...opt});if(options.registrationFails)throw Error('Storage blocked');return reg;},ready:Promise.resolve(reg),addEventListener(k,f){callbacks[k]=f;}};
 c.URL=URL;c.location=new URL(options.file?'file:///test/game.html':'https://example.test/Kuchiwan/preview/claude-chiikawa-2-5d-action-game-9o6f03/inu25d/app/game.html?app=1');c.location.reload=()=>state.reloads++;c.matchMedia=()=>({matches:false});c.MessageChannel=class{constructor(){const one=this.port1={onmessage:null,close(){}};this.port2={postMessage(data){queueMicrotask(()=>one.onmessage({data}));}};}};
 c.setTimeout=(fn,ms)=>{const id=++tid;timers.set(id,{fn,ms});return id;};c.clearTimeout=id=>timers.delete(id);c.fetch=async()=>{if(state.fail)throw Error('offline');return {ok:true,json:async()=>({version:state.latest})};};
 const add=c.addEventListener;c.addEventListener=(type,fn,capture)=>{if(type==='keydown'&&capture)state.key=fn;add(type,fn,capture);};vm.runInContext(source,c,{filename:'pwa-runtime.js'});await c.InnuApp.ready;return {...g,state,reg,worker,callbacks,all,app:c.InnuApp,timers};}
(async()=>{const cases=[],pass=s=>{cases.push(s);console.log('PASS '+s);};
 {
  const g=await fixture();assert.equal(g.state.registers.length,1);assert(g.state.registers[0].scope.endsWith('/inu25d/app/'));assert.equal(g.state.registers[0].updateViaCache,'none');assert(g.app.offlineReady);assert(g.app.status.includes('同じ版'));const b=g.all(g.env.c.document.body).find(e=>e.className==='innu-app-button');assert.equal(b.hidden,true);pass('app registration is narrow, bypasses update caches, and hides its menu during combat');
  const [a,p]=g.G.coop.players,stock=[a.dim,p.dim];g.G.coop.press(0,'attack',1);g.G.coop.press(1,'ult',2);g.app.open();assert(g.G.paused);assert(!g.G.coop.channels[0].input.touch.attack);assert(!g.G.coop.channels[1].input.touch.ult);g.app.close();assert(!g.G.paused);g.step();assert.deepEqual([a.dim,p.dim],stock);assert.equal(g.G.published.native(a).player.state,'idle');pass('opening/closing the app menu pauses and clears both players without replaying pending actions');
 }
 {
  const g=await fixture();g.state.latest='e'.repeat(64);g.reg.waiting=g.worker(g.state.latest);await g.app.check();assert.equal(g.state.applied,0);assert.equal(g.state.reloads,0);assert.equal(g.G.sceneName,'play');g.app.open();await g.app.update();assert.equal(g.G.sceneName,'title');assert.equal(g.state.applied,1);assert.equal(g.state.reloads,1);pass('waiting update is announced but activates/reloads only after explicit user action leaves combat');
 }
 {
  const g=await fixture();g.callbacks.message({data:{type:'APP_ACTIVATED',version:'f'.repeat(64)}});g.callbacks.controllerchange();await Promise.resolve();assert.equal(g.state.reloads,0);assert.equal(g.G.sceneName,'play');pass('another tab activating an update never reloads a running game');
 }
 {
  const g=await fixture({savedVersion:'a'.repeat(64)});assert(g.app.status.includes('別の版'));g.state.fail=true;g.env.c.navigator.onLine=false;await g.app.check();assert(g.app.status.includes('オフライン'));assert(g.app.status.includes('a'.repeat(8)));assert.equal(g.state.reloads,0);pass('online body versus older saved release is explicit; offline checks do not trigger reload');
 }
 {
  const g=await fixture({ready:false});assert(!g.app.offlineReady);await g.app.repair();assert.equal(g.state.repairs,1);assert(g.app.offlineReady);pass('missing cache is not described as ready; explicit repair updates readiness');
 }
 {
  const g=await fixture({registrationFails:true});assert(!g.app.offlineReady);assert(g.app.status.includes('保存を完了できません'));assert.equal(g.state.reloads,0);const local=await fixture({file:true});assert.equal(local.state.registers.length,0);assert(local.app.status.includes('公開HTTPS'));pass('blocked storage or file launch degrades gracefully without attempting forbidden registration');
 }
 {
  const g=await fixture();g.app.open();let stopped=0,prevented=0;g.state.key({code:'KeyJ',stopImmediatePropagation(){stopped++;},preventDefault(){prevented++;}});assert.equal(stopped,1);assert.equal(prevented,1);g.state.key({code:'Escape',stopImmediatePropagation(){},preventDefault(){}});assert.equal(g.G.paused,false);pass('modal keyboard handler suppresses game keys and Escape restores the previous pause state');
 }
 const out=path.join(root,'evidence/pwa-20261024');fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'pwa-ui-cpu.json'),JSON.stringify({status:'PASS_CPU_DOM',cases,version,limits:'Production app runtime with actual game input/state, mocked service-worker container/DOM. No browser installation, pixels, real service-worker lifecycle or trusted touch.'},null,2));console.log('PASS '+cases.length+' PWA UI groups');
})().catch(e=>{console.error(e);process.exitCode=1;});

'use strict';
// No browser, renderer, WebGL, network or third-party test dependency.
// The oracle executes the unchanged published input functions, not a copied expectation.
const fs=require('node:fs'), path=require('node:path'), vm=require('node:vm');
const assert=require('node:assert/strict'), crypto=require('node:crypto');
const root=path.resolve(__dirname,'../..');
const raw=Buffer.from(fs.readFileSync(path.join(root,'beltaction.html'),'utf8').replace(/\r\n/g,'\n'));
const blob=crypto.createHash('sha1').update(Buffer.from(`blob ${raw.length}\0`)).update(raw).digest('hex');
assert.equal(blob,'f8de624f45b07f9a4961a365f0274066f92b20ff','reference changed; review the oracle snapshot');
const source=raw.toString('utf8');
function readModule(name){
  let code=fs.readFileSync(path.join(root,'inu25d/src',name),'utf8');
  if(process.env.INU25D_CPU_MUTATION){const m=JSON.parse(process.env.INU25D_CPU_MUTATION);if(m.file===name){
    assert.ok(code.includes(m.from),'mutation target missing');code=code.replace(m.from,m.to);}}
  return code;
}
const inputCode=source.slice(source.indexOf('let keys, K, pressed, dirTaps'),source.indexOf('//  AUDIO  -'));
const touchCode=source.slice(source.indexOf('function bindBtn(id,key,pi)'),source.indexOf("makeStick('stick',0);"));
function environment(){
  const listeners={}, nodes={};
  const node=id=>nodes[id]||(nodes[id]={style:{},listeners:{},querySelector(){return {style:{}};},
    getBoundingClientRect(){return {left:-50,top:-50,width:100,height:100};},
    addEventListener(type,fn){this.listeners[type]=fn;}});
  const c={console:{...console,warn(){}},navigator:{maxTouchPoints:0},performance:{now:()=>0},
    document:{hidden:false,addEventListener(){},getElementById:node},
    addEventListener(type,fn){(listeners[type]||(listeners[type]=[])).push(fn);},
    requestAnimationFrame(){throw Error('unexpected frame loop');}, setTimeout(){},
    innerWidth:844,innerHeight:390,devicePixelRatio:1};
  c.window=c; vm.createContext(c);
  return {c,nodes,node,event(type,data={}){for(const fn of listeners[type]||[])fn(Object.assign({preventDefault(){},target:null,repeat:false},data));}};
}
function pair(){
  const ref=environment(), target=environment();
  Object.assign(ref.c,{gf:0,state:'play',attractOn:false,titleIdle:0,trainMode:false,togglePause(){}});
  vm.runInContext(inputCode+`;players=[{in:makeInput()},{in:makeInput()}];useInput(players[0].in);`+touchCode+`
    makeStick('stick',0);bindBtn('atk','atk',0);bindBtn('jmp','jump',0);bindBtn('dodge','grd',0);bindBtn('grab','grab',0);
    oracle={motion(f){return dpReady(f)?'dp':hadokenReady(f)?'hadou':downUpReady()?'du':null;},
      ground(f){if(rotationReady())return 'ult';const m=this.motion(f);if(m)return m;
        return K.down?'down':K.up?'up':stingerReady(f)?'dash':((f>0&&K.right)||(f<0&&K.left))?'fwd':null;},
      cancel(f){return this.motion(f)||(K.up?'up':K.down?'down':((f>0&&K.right)||(f<0&&K.left))?'fwd':null);},
      snapshot(f){useInput(players[0].in);return {cards:cardSeq,taps:dirTaps,downs:downTaps,rot:stickRot,
        dp:dpReady(f),hadou:hadokenReady(f),du:downUpReady(),dash:stingerReady(f),rotation:rotationReady(),
        ground:this.ground(f),motion:this.motion(f),cancel:this.cancel(f)};}, consume(){consumeCmd();saveInput(players[0].in);}};`,ref.c);
  vm.runInContext(fs.readFileSync(path.join(root,'tests/vendor/three-0.160.0.min.js'),'utf8'),target.c);
  vm.runInContext(readModule('00_core.js'),target.c);
  target.c.G.cam.frame=()=>{};
  const clean=x=>JSON.parse(JSON.stringify(x));
  function compare(face=1){
    const C=target.c.G.commands;
    assert.deepEqual(clean({cards:C.cardSeq,taps:C.dirTaps,downs:C.downTaps,rot:C.stickRot,
      dp:C.dpReady(face),hadou:C.hadouReady(face),du:C.duReady(),dash:C.dashReady(face),rotation:C.rotationReady(),
      ground:C.ground(face),motion:C.motion(face),cancel:C.cancelTarget(face)}),clean(ref.c.oracle.snapshot(face)));
  }
  function frame(n=1){ref.c.gf+=n;if(n)target.c.G.step(n);compare();assert.deepEqual(clean(target.c.G.errors),[]);}
  function key(code,down=true){ref.event(down?'keydown':'keyup',{code});target.event(down?'keydown':'keyup',{code});compare();}
  function tap(code){key(code);key(code,false);}
  function stick(dx,dy){ref.node('stick').listeners.touchmove({preventDefault(){},changedTouches:[{identifier:1,clientX:dx,clientY:dy}]});target.c.G.commands.touchMove(dx,dy);compare();}
  ref.node('stick').listeners.touchstart({preventDefault(){},changedTouches:[{identifier:1,clientX:0,clientY:0}]});
  target.c.G.commands.touchMove(0,0);
  return {ref,target,compare,frame,key,tap,stick,slot:f=>target.c.G.commands.ground(f||1)};
}
module.exports={pair,environment,source,root,readModule};
if(require.main===module){
let count=0;
function test(name,fn){fn();count++;console.log('PASS '+name);}
const card=['ArrowUp','ArrowRight','ArrowDown','ArrowLeft'];
test('seven commands, both facings, consume, and actual back-to-forward dash',()=>{
  for(const face of [1,-1]) for(const [slot,seq] of [['up',[0]],['fwd',[face>0?1:3]],['down',[2]],
    ['dash',face>0?[3,1]:[1,3]],['hadou',face>0?[2,1]:[2,3]],['dp',face>0?[1,2,1]:[3,2,3]],['du',[2,0]],['ult',[0,1,2,3]]]){
    const p=pair();for(const c of seq){p.tap(card[c]);p.frame(2);} if(slot==='du'||slot==='up'||slot==='down'||slot==='fwd')p.key(card[seq.at(-1)]);
    p.compare(face);assert.equal(p.slot(face),slot);p.ref.c.oracle.consume();p.target.c.G.commands.consume();p.compare(face);
  }
  const p=pair();p.tap('ArrowRight');p.frame(2);p.tap('ArrowRight');assert.equal(p.target.c.G.commands.dashReady(1),false);
});
test('key mapping, rapid taps, alias keys and held attacks',()=>{
  const map={attack:['KeyJ','KeyZ'],jump:['Space','KeyI'],dodge:['KeyK','KeyX'],grab:['KeyL','KeyU','ShiftLeft','ShiftRight']};
  for(const [action,codes] of Object.entries(map))for(const code of codes){
    const p=pair();p.key(code);p.key(code,false);p.frame();assert.equal(p.target.c.G.input.btn[action].pressed,true,code);
    p.frame();assert.equal(p.target.c.G.input.btn[action].pressed,false,code);
    p.key(code);p.frame(30);assert.equal(p.target.c.G.input.btn[action].held,30);
    p.key(code,false);p.frame();assert.equal(p.target.c.G.input.btn[action].released,true);
  }
  const p=pair();p.key('KeyA');p.frame();assert.equal(p.target.c.G.input.x,0);assert.equal(p.target.c.G.input.btn.special.down,false);
});
test('published timeout boundaries and overlapping dp/hadou priority',()=>{
  for(const gap of [0,9,10,18,19,20,21,28,29,30,31,34,35,40,41,44,45])for(const age of [0,9,10,12,13,34,35]){
    const p=pair();p.tap('ArrowRight');p.frame(gap);p.tap('ArrowDown');p.frame(gap);p.key('ArrowRight');p.frame(age);p.compare();
  }
  const p=pair();p.tap('ArrowRight');p.tap('ArrowDown');p.key('ArrowRight');assert.equal(p.target.c.G.commands.hadouReady(1),true);assert.equal(p.slot(),'dp');
});
test('touch cardinal/movement thresholds, duplicates, release and clockwise/counterclockwise rotations',()=>{
  for(const face of [1,-1]){
    const p=pair();for(const xy of [[0,0],[16,0],[16.001,0],[27.5,0],[27.501,0],[40,0],[40,1],[0,40],[0,-40],[-40,0],[0,0]]){p.stick(...xy);p.frame(2);p.compare(face);}
    p.ref.node('stick').listeners.touchend({changedTouches:[{identifier:1}]});p.target.c.G.commands.touchEnd();p.compare(face);
  }
  for(const direction of [1,-1]){const p=pair();for(let i=0;i<=24;i++){const a=direction*i*Math.PI/12;p.stick(50*Math.cos(a),50*Math.sin(a));p.frame();}
    assert.equal(p.target.c.G.commands.rotationReady(),true);p.compare();}
});
test('touch buttons retain short press and hold without a separate strong button',()=>{
  for(const [id,action] of [['atk','attack'],['jmp','jump'],['dodge','dodge'],['grab','grab']]){
    const p=pair();p.ref.node(id).listeners.touchstart({preventDefault(){}});p.target.c.G.input.touch[action]=true;p.target.c.G.input.latch(action);
    p.ref.node(id).listeners.touchend({preventDefault(){}});p.target.c.G.input.touch[action]=false;p.frame();assert.equal(p.target.c.G.input.btn[action].pressed,true);
  }
});
test('5,000 deterministic mixed key/touch events match the published histories',()=>{
  let seed=0x1337;const rnd=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed;};const p=pair();
  for(let i=0;i<5000;i++){const r=rnd();if(r%3===0)p.key(card[r%4],!!(r&16));else p.stick((r%121)-60,((r>>>8)%121)-60);p.frame(r%5);p.compare((r&64)?1:-1);}
});
test('blur clears pending edges and stale command history',()=>{
  const p=pair();p.tap('ArrowRight');p.tap('ArrowDown');p.key('KeyJ');p.target.event('blur');p.target.c.G.step();
  assert.equal(p.target.c.G.input.btn.attack.pressed,false);assert.equal(p.target.c.G.commands.ground(1),null);
});
console.log(`CPU input comparison: ${count} groups PASS (reference ${blob}); renderer never created.`);
}

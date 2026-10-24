'use strict';
const {game,root}=require('./published_harness.cjs'),{readModule}=require('./input_cpu.cjs'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const source=readModule('80_ui.js');
function fixture(foes=[]){const g=game('inu',{foes}),c=g.env.c;let W=844,H=390,B=92,prevented=0;
 class Node{constructor(tag){this.tagName=tag;this.children=[];this.listeners={};this.attrs={};this.dataset={};this.style={cssText:'',setProperty(k,v){this[k]=v;}};this.classList={add(){},remove(){},toggle(){}};}
  append(e){this.children.push(e);e.parent=this;}appendChild(e){this.append(e);}setAttribute(k,v){this.attrs[k]=v;}addEventListener(k,f,o){this.listeners[k]={f,o};}setPointerCapture(id){this.capture=id;}
  get offsetWidth(){return Math.max(44,B*Number(this.style.cssText.match(/width:calc\(var\(--b\)\*([\d.]+)/)?.[1]||0));}
  get offsetHeight(){return this.offsetWidth;}get offsetLeft(){return W-10-B*Number(this.style.cssText.match(/right:calc\(var\(--pr\) \+ var\(--b\)\*([\d.]+)/)?.[1]||0)-this.offsetWidth;}
  get offsetTop(){return H-8-B*Number(this.style.cssText.match(/bottom:calc\(var\(--pb\) \+ var\(--b\)\*([\d.]+)/)?.[1]||0)-this.offsetHeight;}
  getBoundingClientRect(){return this.className==='tc x'?{left:0,top:0,width:W,height:H}:{left:this.offsetLeft,top:this.offsetTop,width:this.offsetWidth,height:this.offsetHeight};}}
 c.document.body=new Node('body');c.document.createElement=t=>new Node(t);c.root=new Node('root');c.el=(tag,cls,parent,html)=>{const n=new Node(tag);n.className=cls;n.innerHTML=html||'';parent?.append(n);return n;};
 const svg=source.slice(source.indexOf('const SVG ='),source.indexOf('\n};',source.indexOf('const SVG ='))+3);
 const controls=source.slice(source.indexOf('const T ='),source.indexOf('function touchApply()'));
 vm.runInContext(svg+'\n'+controls+'\nT.visible=true;buildTouch();globalThis.UI={T,TBTN,tbGeom,btnSlide};',c);
 c.document.querySelector=sel=>c.UI.T.btns.find(b=>sel.endsWith('.'+b.k))?.el;
 vm.runInContext(readModule('81_controls_feedback.js'),c);
 function layout(w,h){W=w;H=h;B=Math.round(Math.min(96,h*.235,w*.235));c.innerWidth=w;c.innerHeight=h;c.UI.T.B=B;c.UI.T.R=Math.round(Math.min(56,h*.14,w*.14));vm.runInContext('ghostPos();tbGeom();',c);}
 layout(W,H);
 const event=(id,x=0,y=0,type='pointerdown')=>({pointerId:id,pointerType:'touch',type,clientX:x,clientY:y,cancelable:true,preventDefault(){prevented++;},stopPropagation(){}});
 const down=(k,id)=>{const b=c.UI.T.btns.find(b=>b.k===k);b.el.listeners.pointerdown.f(event(id,b.cx,b.cy));};
 const up=id=>g.env.event('pointerup',event(id,0,0,'pointerup'));
 const stick=(id,x,y,start=false)=>{const T=c.UI.T,e=event(id,T.gx+x*T.R,T.gy+y*T.R,start?'pointerdown':'pointermove');if(start)T.zone.listeners.pointerdown.f(e);else g.env.event('pointermove',e);};
 return {...g,c,layout,down,up,stick,get prevented(){return prevented;}};
}
const layouts=[];
for(const [w,h]of [[390,844],[844,390],[1024,768],[768,1024],[568,320]]){const g=fixture();g.layout(w,h);const b=g.c.UI.T.btns;
 assert.deepEqual(Array.from(b,x=>x.k),['attack','jump','dodge','grab','special','ult']);
 for(const o of b){const r=o.el.getBoundingClientRect();assert(r.left>=0&&r.top>=0&&r.left+r.width<=w&&r.top+r.height<=h);assert(r.width>=44);assert.equal(o.el.attrs.role,'button');assert(o.el.attrs['aria-label']);}
 for(let i=0;i<b.length;i++)for(let j=i+1;j<b.length;j++)assert(Math.hypot(b[i].cx-b[j].cx,b[i].cy-b[j].cy)>b[i].cr+b[j].cr,'buttons overlap');layouts.push({w,h,buttons:6,mathBounds:true});}
{const g=fixture([36]);g.stick(1,0,.85,true);g.step();g.stick(1,.6,.6);g.step();g.stick(1,.85,0);g.step();g.down('attack',2);g.step();assert.equal(g.n.player.atk.type,'iwave');assert.equal(g.p.dim,3);g.up(2);g.up(1);assert(g.prevented>=4);}
{const g=fixture([36]);g.down('grab',2);g.step();g.up(2);assert.equal(g.n.player.state,'grab');assert.equal(g.c.UI.T.btns.find(b=>b.k==='grab').el.attrs['aria-pressed'],'true');
 assert(g.c.document.body.children.some(n=>n.className==='inu-controls-status'&&n.textContent.includes('つかみ中')));
 g.stick(1,.85,0,true);g.step();g.down('attack',3);g.step();g.step(10);assert.equal(g.foes[0].hp,99994);g.up(3);g.up(1);g.down('grab',4);g.step();assert.equal(g.n.player.grabEnemy,null);g.up(4);}
for(const k of ['special','ult']){const g=fixture();g.down(k,2);g.step();assert(k==='special'?g.n.player.sgCd===540:g.p.dim===2);g.up(2);}
{const g=fixture();g.down('attack',9);const u=g.c.UI.T.btns.find(b=>b.k==='ult');g.env.event('pointermove',{pointerId:9,clientX:u.cx,clientY:u.cy,preventDefault(){}});g.step();assert.equal(g.p.dim,3,'sliding onto ultimate must not spend stock');assert.equal(g.G.input.touch.ult,false);g.up(9);}
{const g=fixture();for(const [i,k]of ['grab','special','ult'].entries())g.down(k,i+10);g.env.event('blur');g.step();assert.equal(Object.values(g.G.input.touch).some(x=>x===true),false);}
fs.writeFileSync(path.join(root,'evidence/input-controls-20261024/ui-wiring-cpu.json'),JSON.stringify({status:'PASS_CPU',layouts,actualBuildTouch:true,actualPointerHandlers:true,multitouchJoystickAttack:true,grabStrikeReleaseStatus:true,separateSpecialUltimate:true,noSlideOntoUlt:true,limits:'Executed original component construction and callback wiring with DOM/geometry fixtures. No browser layout engine, trusted pointer capture, real multitouch or physical mobile testing.'},null,2));
console.log('PASS actual six-button construction/handlers, joystick+Attack/Grab, status, release, special/ultimate separation; five viewport geometry fixtures');

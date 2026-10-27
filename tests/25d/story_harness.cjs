'use strict';
const {game,root}=require('./published_harness.cjs'),{readModule}=require('./input_cpu.cjs');
const vm=require('node:vm');
function dom(c){
 const canvas=c.document.createElement;
 class Element{constructor(tag){this.tagName=tag.toUpperCase();this.children=[];this.style={setProperty(k,v){this[k]=v;}};this.listeners={};this.attrs={};this.classList={add(){},remove(){},toggle(){}};}
  append(e){this.children.push(e);e.parent=this;}setAttribute(k,v){this.attrs[k]=v;}addEventListener(k,f){this.listeners[k]=f;}
  focus(){c.document.activeElement=this;}remove(){if(this.parent)this.parent.children=this.parent.children.filter(e=>e!==this);}}
 c.document.body=new Element('body');c.document.createElement=tag=>tag==='canvas'?canvas(tag):new Element(tag);return Element;
}
function setup(hero='inu',play=false){const g=game(hero,{foes:[],actualRig:true}),{G,env}=g,c=env.c;dom(c);
 for(const f of ['30_foes.js','31_zako.js','32_expansion_foes.js','35_bosses_a.js','36_bosses_b.js','40_stage.js','82_story_events.js']){if(f==='82_story_events.js'&&G.story)continue;if(f==='32_expansion_foes.js'&&!require('node:fs').existsSync(require('node:path').join(root,'inu25d/src',f)))continue;vm.runInContext(readModule(f),c,{filename:f});}
 G.foes.init();G.foes.build=()=>({root:new c.THREE.Group(),height:2,update(){},setAlpha(){}});
 G.game.diff={heroDmg:1,heroHp:1,foeDmg:1.1,foeHp:1,foeSpeed:1.08,attackers:3,think:.9,tactics:true,minWindup:18,attackSpacing:12,punishWindow:28,lives:3};
 G.game.heroId=hero;G.story.beginStage(hero,0,true);
 if(play){
  c.location={hash:'#test'};c.localStorage={getItem(){return null;},setItem(){}};
  for(const k of ['follow','unlock','snap','reset','focus'])G.cam[k]=()=>{};
  G.fx.worldFrozen=false;G.pickups={tick(){},spawn(){}};G.heroes.portrait=()=>null;
  G._shown={};G.ui={show(name,data){G._shown[name]=data;},hide(name){delete G._shown[name];},hideAll(){G._shown={};},touch:{show(){},release(){}},frame(){}};
  const stages=G.stages;
  G.stage={done:false,index:0,info:stages[0],load(index){this.index=index;this.info=stages[index];this.done=false;},unload(){},tick(){},frame(){},bounds:()=>({xmin:0,xmax:120,zmin:-2.4,zmax:2})};
  let code=readModule('90_game.js');code=code.replace('G.boot();\n})();','})();').replace('G.boot();\r\n})();','})();');
  vm.runInContext(code,c,{filename:'90_game.js'});G.debug.play(hero,0,'hard');
 }
 return {...g,spawn(type){const e=G.foes.spawn(type,8,0);e.y=0;e.vy=0;e.onGround=true;e.entered=true;e.state='idle';e.inv=0;e.intangible=false;e.introDone=true;e.cool=0;return e;}};
}
module.exports={setup,root,readModule};

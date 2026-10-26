'use strict';
const {environment,root,readModule}=require('./input_cpu.cjs'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
function setup(hero='inu'){
 const env=environment(),c=env.c;vm.runInContext(fs.readFileSync(path.join(root,'tests/vendor/three-0.160.0.min.js'),'utf8'),c);vm.runInContext(readModule('00_core.js'),c);const G=c.G;G.scene=new c.THREE.Group();G.cam.frame=()=>{};
 class Element{constructor(tag){this.tagName=tag.toUpperCase();this.children=[];this.style={};this.listeners={};this.classList={add(){},remove(){}};}append(e){this.children.push(e);e.parent=this;}setAttribute(){}addEventListener(k,f){this.listeners[k]=f;}focus(){c.document.activeElement=this;}remove(){if(this.parent)this.parent.children=this.parent.children.filter(e=>e!==this);}}
 c.document.body=new Element('body');c.document.createElement=tag=>new Element(tag);
 G.heroes={list:[],get:id=>({id,color:'#fff'}),build:()=>({root:new c.THREE.Group(),height:1.3,update(){}})};G.fx={makeProjectile:()=>({obj:new c.THREE.Group(),update(){},dispose(){}})};G.stage={unload(){},titleScene(){}};G.ui={show(){},hide(){},hideAll(){},frame(){}};G.pickups={tick(){}};
 for(const f of ['50_combat.js','55_player.js'])vm.runInContext(readModule(f),c);
 const saved=JSON.stringify({hero:'inu',unlocked:4,diff:'normal',sound:false,custom:'preserve'}),writes=[];c.location={hash:''};c.localStorage={getItem:key=>key==='inu25d_save'?saved:null,setItem:(...a)=>writes.push(a)};
 vm.runInContext(readModule('90_game.js').replace(/G\.boot\(\);\s*\}\)\(\);\s*$/,'})();'),c);
 const p=G.player=G.playerCtl.create(hero,4,0);G.world.add(p);G.sceneName='play';G.scenes.play.tick=()=>{if(G.paused)return;G.playerCtl.tick(p);G.phys(p);G.combat.tick();};
 const key=(code,down=true)=>env.event(down?'keydown':'keyup',{code}),step=(n=1)=>{for(let i=0;i<n;i++){G.step(1);assert.deepEqual(Array.from(G.errors),[]);}};return {G,p,env,key,step,writes,saved};
}
module.exports={setup,root,readModule};

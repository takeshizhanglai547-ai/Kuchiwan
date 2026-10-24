'use strict';
const {environment,root,readModule}=require('./input_cpu.cjs');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
function game(hero='inu',opts={}){
  const env=environment(),c=env.c;
  vm.runInContext(fs.readFileSync(path.join(root,'tests/vendor/three-0.160.0.min.js'),'utf8'),c);
  vm.runInContext(readModule('00_core.js'),c);
  vm.runInContext(readModule('06_motion_inputs.js'),c);
  const G=c.G;G.cam.frame=()=>{};G.cam.viewRange=()=>[0,1280/60];G.scene=new c.THREE.Group();
  if(opts.actualRig){
    const gradient={addColorStop(){}};const ctx=new Proxy({createLinearGradient:()=>gradient,createRadialGradient:()=>gradient,measureText:()=>({width:10})},{get:(o,k)=>k in o?o[k]:(()=>{}),set:(o,k,v)=>(o[k]=v,true)});
    c.document.createElement=()=>({style:{},width:0,height:0,getContext:()=>ctx});
    for(const file of ['10_look.js','20_heroes.js','21_inu_choreography.js','22_published_catalog.js','23_published_motion.js'])vm.runInContext(readModule(file),c);
  }else G.heroes={get:id=>({id}),build:()=>({root:new c.THREE.Group(),height:1.3,update(){}})};
  G.fx={makeProjectile:()=>({obj:new c.THREE.Group(),update(){},dispose(){}})};
  G.game={level:opts.level||1,xp:0,xpNext:100,publishedCarry:null,diff:{heroDmg:1,foeDmg:1},onHeroHit(){}};
  G.stage={bounds:()=>({xmin:0,xmax:200,zmin:-2.4,zmax:2})};
  for(const name of ['50_combat.js','52_published_fighter.js','53_command_reference.js','54_command_moves.js','55_player.js','56_control_actions.js'])
    vm.runInContext(readModule(name),c);
  if(opts.story||process.env.INU25D_WITH_STORY==='1')vm.runInContext(readModule('82_story_events.js'),c);
  const p=G.player=G.playerCtl.create(hero,4,0);G.world.add(p);const n=G.published.native(p);
  n.randomTo(()=>.5);n.reset(hero,opts.seed||1337);n.player.x=240;n.player.facing=opts.face||1;n.player.level=opts.level||1;n.player.dim=opts.dim??3;n.player.dimMax=8;
  p.face=n.player.facing;p.inv=0;p.hp=n.player.hp;p.dead=false;
  if(opts.air){n.player.state='jump';n.player.z=120;n.player.vz=0;p.onGround=false;p.y=2;}
  const foes=[],type=opts.type||'wolf';
  for(const [i,offset]of (opts.foes||[60]).entries()){
    const t=G.makeEnt({kind:'foe',type,publishedType:type,team:1,x:4+offset/60,z:0,y:0,hp:100000,maxHp:100000,
      height:n.stats(type).h/60,radius:n.stats(type).w/120,face:-1,def:{xp:0,boss:!!n.stats(type).boss}});G.world.add(t);foes.push(t);
  }
  G.scenes.cpu={tick(){if(G.hitStop>0){G.playerCtl.queue(p);G.hitStop--;return;}G.playerCtl.tick(p);G.combat.tick();if(opts.actualRig)p.rig.update(p,1/60);}};G.sceneName='play';G.scenes.play=G.scenes.cpu;
  const key=(code,down=true)=>env.event(down?'keydown':'keyup',{code});
  const step=(count=1)=>{G.step(count);assert.deepEqual(Array.from(G.errors),[]);};
  const card=['ArrowUp','ArrowRight','ArrowDown','ArrowLeft'];
  function motion(slot){const f=p.face>0?1:3,b=p.face>0?3:1;
    const seq={up:[0],fwd:[f],down:[2],dash:[b,f],hadou:[2,f],dp:[f,2,f],du:[2,0],ult:[0,1,2,3]}[slot];
    for(const k of seq){key(card[k]);key(card[k],false);}if(['up','fwd','down','du'].includes(slot))key(card[seq.at(-1)]);
  }
  return {G,p,n,foes,env,key,step,motion,trace:()=>G.published.trace(p)};
}
module.exports={game,root};
if(require.main===module){const g=game();g.motion('hadou');g.key('KeyJ');g.step();g.key('KeyJ',false);g.step(100);
  console.log(JSON.stringify({state:g.p.state,hp:g.foes[0].hp,dim:g.p.dim,trace:g.trace()}));}

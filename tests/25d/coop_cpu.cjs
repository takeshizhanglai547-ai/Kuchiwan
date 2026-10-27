'use strict';
const {setup,readModule,root}=require('./story_harness.cjs'),vm=require('node:vm'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
function fixture(a='inu',b='shima'){
 const g=setup(a,true),{G}=g,c=g.env.c,create=c.document.createElement;
 c.document.createElement=(tag)=>{const e=create(tag);e.dataset={};e.getBoundingClientRect=()=>({left:0,top:0,width:100,height:100});e.setPointerCapture=id=>{e.capture=id;};return e;};
 vm.runInContext(readModule('91_same_screen_coop.js'),c,{filename:'91_same_screen_coop.js'});G.coop.enable(a,b);G.debug.play(a,0,'hard');g.step();
 function skip(){let guard=0;while(G.story.blocked||G.story.pending){if(++guard>20)throw Error('cinematic queue stalled');if(!G.story.blocked){G.story.flush();continue;}g.step(31);assert(G.story.skip());}}
 skip();G.hitStop=0;for(const p of G.coop.players){p.inv=0;G.published.native(p).player.invuln=0;}
 return {...g,skip};
}
const report={kind:'Actual input channels, native fighters, play scene and DOM pointer callbacks; CPU fixtures, not trusted mobile touch',cases:[],dispatchComparisons:0};
function record(s){report.cases.push(s);console.log('PASS '+s);}
{
 const g=fixture(),{G}=g,[a,b]=G.coop.players,[one,two]=G.coop.channels;
 assert.notEqual(a,b);assert.notEqual(G.published.native(a),G.published.native(b));assert.equal(a.type,'inu');assert.equal(b.type,'shima');assert.equal(G.world.ents.filter(p=>p.team===0).length,2);
 const x=[a.x,b.x];assert(G.coop.stick(0,101,-50,0));assert(G.coop.stick(1,201,50,0));g.step(8);assert(a.x<x[0]);assert(b.x>x[1]);assert.notDeepEqual(Array.from(one.commands.cardSeq),Array.from(two.commands.cardSeq));
 G.coop.release(101);assert.equal(one.input.touch.x,0);assert.equal(two.input.touch.x,1);assert(!G.coop.release(999));G.coop.release(201);
 assert(G.coop.press(0,'attack',11));assert(G.coop.press(1,'attack',21));g.step();assert.equal(G.published.native(a).player.state,'attack');assert.equal(G.published.native(b).player.state,'attack');
 G.coop.release(11);assert.equal(two.input.touch.attack,true);G.coop.release(21);record('two real heroes move in opposite directions and attack simultaneously; input release isolation');
}
{
 const g=fixture(),{G}=g,[a,b]=G.coop.players;const before=G.published.native(a).player.dim;
 G.coop.press(0,'attack',1);G.coop.press(0,'attack',2);G.coop.release(1);assert.equal(G.coop.channels[0].input.touch.attack,true);G.coop.release(2);assert.equal(G.coop.channels[0].input.touch.attack,false);
 G.coop.stick(1,50,0,50);g.step();G.coop.stick(1,50,50,50);g.step();G.coop.stick(1,50,50,0);G.coop.press(1,'attack',51);g.step();const n=G.published.native(b);assert.equal(n.player.atk.type,'srush');assert.equal(G.published.native(a).player.dim,before);assert.equal(G.coop.channels[0].commands.motion8.length,0);record('P2 diagonal motion history and resources stay separate; multiple fingers own one action safely');
}
{
 const g=fixture(),{G}=g,[a,b]=G.coop.players;a.x=4;b.x=4.1;for(const p of [a,b]){const n=G.published.native(p);n.player.x=p.x*60;n.player.facing=1;p.face=1;}
 const f=G.makeEnt({kind:'foe',type:'wolf',publishedType:'wolf',team:1,x:4.6,z:0,y:0,hp:10000,maxHp:10000,height:1,radius:.3,face:-1,def:{xp:0,boss:false}});G.world.add(f);
 G.coop.press(0,'grab',100);G.coop.press(1,'grab',200);g.step();assert.equal(G.published.native(a).player.state,'grab');assert.notEqual(G.published.native(b).player.state,'grab');assert.equal(f._publishedOwner,a);
 G.coop.release(100);G.coop.release(200);G.coop.press(0,'grab',101);g.step();assert.notEqual(G.published.native(a).player.state,'grab');assert.equal(f.grabbedBy,0);record('shared enemy can be grabbed by only one hero; explicit release frees the target');
}
{
 const g=fixture(),{G}=g,[a,b]=G.coop.players;G.coop.press(0,'attack',1);G.coop.press(1,'jump',2);const boss=g.spawn('garm');boss.hp=boss.maxHp*.4;G.bus.emit('hit',{target:boss,dmg:1});G.bus.emit('hit',{target:boss,dmg:1});G.hitStop=0;g.step();assert(G.story.blocked);assert.equal(G.coop.channels[0].input.touch.attack,false);assert.equal(G.coop.channels[1].input.touch.jump,false);const time=G.game.stageTime;g.step(20);assert.equal(G.game.stageTime,time);assert.equal(G.story.skip(),false);g.step(11);assert(G.story.skip());assert.equal(G.story.pending,0);record('one shared boss phase cinematic pauses both fighters and clears both input owners');
}
{
 const g=fixture(),{G}=g,[a,b]=G.coop.players;const lives=G.game.lives;G.published.native(b).player.hp=0;b.hp=0;b.dead=true;b.coopKo=99;G.coop.afterCombat(G.scenes.play);assert.equal(b.dead,false);assert.equal(G.game.lives,lives-1);assert(a.hp>0);G.hitStop=0;g.step();assert.equal(G.published.native(b).player.hp,b.maxHp);
 G.stage.done=true;G.coop.winGuard();assert(a.inv>=9999&&b.inv>=9999);G.go('play',{stage:1});g.step();assert.equal(G.coop.players.length,2);assert.equal(G.coop.players[1].type,'shima');g.skip();assert.equal(G.game.stageIndex,1);G.go('title');assert.equal(G.coop.enabled,false);record('individual revival uses shared lives; stage changes rebuild two fighters; title resets the session');
}
{
 const g=fixture(),{G}=g;function all(e){return [e,...(e.children||[]).flatMap(all)];}const buttons=all(g.env.c.document.body).filter(e=>e.dataset?.coopAction);assert.equal(buttons.length,12);
 const p1=buttons.find(b=>b.dataset.coopPlayer==='0'&&b.dataset.coopAction==='attack'),p2=buttons.find(b=>b.dataset.coopPlayer==='1'&&b.dataset.coopAction==='grab');let prevented=0;
 const event=id=>({pointerId:id,preventDefault(){prevented++;},stopPropagation(){}});p1.listeners.pointerdown(event(1));p2.listeners.pointerdown(event(2));assert(G.coop.channels[0].input.touch.attack);assert(G.coop.channels[1].input.touch.grab);p1.listeners.pointercancel(event(1));assert(!G.coop.channels[0].input.touch.attack);assert(G.coop.channels[1].input.touch.grab);p2.listeners.pointerup(event(2));assert(!G.coop.channels[1].input.touch.grab);assert(prevented>=4);record('actual twelve-button handlers capture pointer IDs and cancel only their own player/action');
}
{
 const g=fixture('inu','inu'),{G}=g,[a,b]=G.coop.players;for(const p of [a,b]){p.x=4;p.face=1;G.published.native(p).player.x=240;G.published.native(p).player.facing=1;}
 const foe=g.spawn('wanhei');foe.publishedType='wolf';foe.x=4.7;foe.hp=foe.maxHp=10000;foe.z=0;foe.y=0;foe.inv=0;
 G.coop.press(0,'attack',1);G.coop.press(1,'attack',2);g.step();G.coop.release(1);G.coop.release(2);g.step(100);
 const damage=G.published.trace(a).hits.concat(G.published.trace(b).hits).reduce((n,h)=>n+h.damage,0);assert(damage>0);assert.equal(foe.hp,10000-damage,'another native context must never restore lost HP');record('two native fighters share one enemy HP pool without stale-copy healing');
}
{
 const g=fixture(),{G}=g,[a,b]=G.coop.players;const x=[a.x,b.x];g.key('ArrowRight');g.key('KeyA');g.step(8);assert(a.x>x[0]);assert(b.x<x[1]);g.key('ArrowRight',false);g.key('KeyA',false);g.key('KeyF');g.step();assert.equal(G.published.native(b).player.state,'attack');assert.notEqual(G.published.native(a).player.state,'attack');g.key('KeyF',false);record('independent P1 and P2 keyboard bindings dispatch simultaneously');
}
for(const hero of ['inu','shima','nuko','guard8','watch','wanden','mack']){
 const g=fixture('inu',hero),{G}=g;for(let stage=0;stage<G.stages.length;stage++){
  assert.equal(G.game.stageIndex,stage);assert.equal(G.coop.players[1].type,hero);
  const intros=G.story.history.filter(e=>e.run===G.story.run&&e.kind==='intro'&&e.completed);assert.equal(intros.length,2);assert.equal(intros[1].hero,hero);
  G.stage.done=true;G.hitStop=0;g.step(40);g.skip();const clears=G.story.history.filter(e=>e.run===G.story.run&&e.kind==='clear'&&e.completed);assert.equal(clears.length,2);assert.equal(clears[1].hero,hero);
  G.scenes.play.showResult();G._shown.result.onNext();if(stage<G.stages.length-1){g.step();g.skip();}
 }assert.equal(G.sceneName,'ending');record('both heroes receive intro/clear events and progress all nine stages: P2 '+hero);
}
{
 const {game}=require('./published_harness.cjs');
 for(const hero of ['inu','shima','nuko','guard8','watch','wanden','mack'])for(const side of [0,1]){
  const c=fixture(side===0?hero:'inu',side===1?hero:'shima'),G=c.G,p=G.coop.players[side],n=G.published.native(p);
  for(const face of [1,-1])for(const air of [false,true])for(const slot of ['fwd','up','down','du','hadou','dp']){
   G.coop.clearInputs();n.reset(hero,1337);n.randomTo(()=>.5);n.player.x=240;n.player.facing=face;n.player.dim=3;n.player.dimMax=8;p.x=4;p.face=face;p.inv=0;p.dead=false;p.y=air?2:0;p.onGround=!air;
   if(air){n.player.state='jump';n.player.z=120;n.player.vz=0;}G.hitStop=0;
   const one=game(hero,{face,air,foes:[]});const f=face*50,vectors=slot==='dp'?[[f,0],[0,50],[face*35,35]]:slot==='hadou'?[[0,50],[face*35,35],[f,0]]:slot==='du'?[[0,50],[0,-50],[0,-50]]:Array(3).fill(slot==='fwd'?[f,0]:slot==='up'?[0,-50]:[0,50]);
   for(let frame=0;frame<5;frame++){
    if(frame<3){G.coop.stick(side,800,...vectors[frame]);one.G.commands.touchMove(...vectors[frame]);}
    if(frame===3){G.coop.press(side,'attack',801);one.G.input.touch.attack=true;one.G.input.latch('attack');}
    if(frame===4){G.coop.release(801);one.G.input.touch.attack=false;}
    c.step();one.step();
   }
   const snap=r=>({state:r.state,move:r.atk?.type||null,stock:r.dim,charge:r.charge});assert.deepEqual(snap(n.player),snap(one.n.player),[hero,side,face,air,slot].join('/'));G.coop.release(800);report.dispatchComparisons++;
  }
 }
 record('336 command dispatch comparisons across seven heroes, both player seats, both facings and ground/air');
}
report.status='PASS_CPU';fs.mkdirSync(path.join(root,'evidence/coop-20261024'),{recursive:true});fs.writeFileSync(path.join(root,'evidence/coop-20261024/coop-cpu.json'),JSON.stringify(report,null,2));

'use strict';
const {game,root}=require('./published_harness.cjs'),{setup,readModule}=require('./story_harness.cjs');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const cases=[],heroes={inu:1,shima:1.1,nuko:.95,guard8:.82,watch:1.22,wanden:.96,mack:1};
const near=(a,b,label)=>assert(Math.abs(a-b)<1e-8,`${label}: ${a} != ${b}`);
function record(s){cases.push(s);console.log('PASS '+s);}
// Independent original 040cf controller, not the native 2D oracle profile.
const oldFile=path.join(root,'tests/25d/fixtures/old25d-player-040cf.js');
assert(fs.existsSync(oldFile),'retain downloaded exact old public controller for comparison');
assert.equal(crypto.createHash('sha256').update(fs.readFileSync(oldFile,'utf8').replace(/\r\n/g,'\n')).digest('hex'),'670f27e0cbac6edc24a5bc6028e0e32006c4afe086f893c09c394114c0aa461e','old controller oracle changed');
function old(hero){const g=game(hero,{foes:[]});vm.runInContext(fs.readFileSync(oldFile,'utf8'),g.env.c);const p=g.G.player=g.G.playerCtl.create(hero,4,0);g.G.world.clear();g.G.world.add(p);g.G.scenes.play.tick=()=>{g.G.playerCtl.tick(p);g.G.phys(p);};return {...g,p};}
for(const [hero,mul]of Object.entries(heroes))for(const [dx,dz]of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,-1]])for(const touch of [false,true]){
 const a=old(hero),b=game(hero,{foes:[]});
 for(const g of [a,b]){if(touch)g.G.commands.touchMove(dx*40,dz*40);else{if(dx)g.key(dx>0?'ArrowRight':'ArrowLeft');if(dz)g.key(dz>0?'ArrowDown':'ArrowUp');}g.step(20);}
 near(b.p.x,a.p.x,hero+' old walking X');near(b.p.z,a.p.z,hero+' old walking depth');near(b.p.spd,.078*mul,'character trait');assert.equal(b.n.clock,20);assert.equal(b.p.dim,3);if(dz)assert.equal(b.p.anim,'run');
 cases.push(`${hero} ${dx},${dz} ${touch?'touch':'keyboard'} old-controller displacement`);
}
record('168 all-character keyboard/touch 20-tick vectors match original 040cf ground controller exactly');
for(const sign of [-1,1]){const g=game('inu',{foes:[]});g.key(sign>0?'ArrowDown':'ArrowUp');g.step(120);near(g.p.z,sign>0?2:-2.4,'belt boundary');g.key(sign>0?'ArrowDown':'ArrowUp',false);g.step(5);near(g.p.z,sign>0?2:-2.4,'release drift');assert.equal(g.trace().actions.filter(a=>a.state==='attack').length,0);}
record('depth bounds, release and repeated holding never create an unsolicited attack');
for(const hero of Object.keys(heroes)){const g=game(hero,{air:true,foes:[]});g.key('ArrowDown');g.step(8);near(g.p.z,8*g.p.spd*.7,'air depth');g.key('ArrowDown',false);g.step();const z=g.p.z;g.key('KeyJ');g.step(3);near(g.p.z,z,'attack locks lane');}
record('seven airborne depth rates, ground/air transition input and attacking lane lock');
for(const state of ['grab','hurt','down','dead']){const g=game('inu',{foes:[36]});if(state==='grab'){g.key('KeyL');g.step();g.key('KeyL',false);}else{g.n.player.state=state;g.n.player.stun=99;g.n.player.downT=0;if(state==='dead'){g.n.player.hp=0;g.p.hp=0;g.p.dead=true;}}
 const z=g.p.z;g.key('ArrowDown');g.step();near(g.p.z,z,state+' depth locked');}
record('grab, damage, down and death cannot walk the lane');
// A projectile's world lane must stay independent of its moving shooter.
{const g=game('inu',{foes:[]});g.n.projectiles.push({x:400,y:g.p._publishedCtx.lane-60,zz:30,vx:0,vy:0,vzz:0,r:2,dmg:1,life:100,owner:'player',color:'#fff',trail:[],spin:0});const q=g.n.projectiles[0],lane=g.p._publishedCtx.lane;g.key('ArrowDown');g.step(50);near(g.p.z+(q.y-lane)/60,-1,'shot lane');near(g.p.z,2,'shooter at far belt bound');}
record('existing projectile lane does not follow walking shooter');
{const g=game('inu',{foes:[90]});g.step();const e=g.n.enemies[0],f=g.foes[0],z=f.z;e.controlled=true;e.state='walk';e.vx=e.vz=0;g.key('ArrowDown');g.step(30);near(f.z,z,'controlled enemy retains world lane');}
record('controlled enemy world lane is not dragged by walking hero');
for(const hero of Object.keys(heroes))for(const face of [1,-1])for(const air of [false,true])for(const slot of ['up','down','fwd','dash','du','hadou','dp']){
 const a=game(hero,{face,air,foes:[],referenceMovement:true}),b=game(hero,{face,air,foes:[]});b.p.z=face>0?1:-1;
 for(const g of [a,b]){g.motion(slot);g.key('KeyJ');g.step();}
 assert.equal(b.n.player.state,a.n.player.state,hero+' '+slot+' state');assert.equal(b.n.player.atk?.type,a.n.player.atk?.type,hero+' '+slot+' command');near(b.p.dim,a.p.dim,'command stock');near(b.p.z,face>0?1:-1,'directional attack lane lock');
 cases.push(`${hero} ${face} ${air?'air':'ground'} ${slot} production depth command`);
}
record('196 production directional dispatches from nonzero lanes match reference move IDs/state/resources in both facings and air/ground');
for(const z of [-1,1]){const g=game('inu',{foes:[36]});g.p.z=z;g.foes[0].z=z;g.key('KeyL');g.step();assert.equal(g.n.player.state,'grab');g.key('KeyL',false);g.step();g.key('KeyL');g.step();assert.notEqual(g.n.player.state,'grab');near(g.foes[0].z,z,'grab/release lane');}
record('grab entry and release work from front/back lanes without teleporting the victim');
for(const fps of [30,60,120]){const g=game('inu',{foes:[]}),c=g.env.c;let callback;c.requestAnimationFrame=fn=>{callback=fn;};g.key('ArrowRight');g.G.start();for(let i=1;i<=fps*2;i++){const fn=callback;fn(i*1000/fps+.00001);}g.G.stop();assert.equal(g.n.clock,120,'native advances once per fixed tick at '+fps);near(g.p.x,4+120*.078,'FPS independent distance');}
record('actual requestAnimationFrame accumulator: 30/60/120 Hz all advance exactly 120 native ticks and 9.36 units in two seconds');
function coop(){const g=setup('inu',true),{G}=g,c=g.env.c,create=c.document.createElement;c.document.createElement=tag=>{const e=create(tag);e.dataset={};return e;};vm.runInContext(readModule('91_same_screen_coop.js'),g.env.c);G.coop.enable('inu','inu');G.debug.play('inu',0,'hard');let guard=0;while(G.story.blocked||G.story.pending){if(++guard>20)throw Error('story stalled');if(!G.story.blocked){G.story.flush();continue;}g.step(31);G.story.skip();}G.hitStop=0;return g;}
{const g=coop(),{G}=g,[a,b]=G.coop.players;const start=G.coop.players.map(p=>({x:p.x,z:p.z,t:G.published.native(p).clock}));G.coop.stick(0,101,40,-40);G.coop.stick(1,201,-40,40);g.step(10);for(const [i,p]of G.coop.players.entries()){near(Math.abs(p.x-start[i].x),10*.078,'coop X');near(Math.abs(p.z-start[i].z),10*.078*.72,'coop lane');assert.equal(G.published.native(p).clock-start[i].t,10,'no double update');}G.coop.release(101);const z=a.z;g.step();near(a.z,z,'P1 release');assert(b.z>start[1].z);G.coop.release(201);
 G.hitStop=5;G.coop.stick(0,301,0,40);const t=G.published.native(a).clock;g.step(5);near(a.z,z,'hitstop');assert.equal(G.published.native(a).clock,t);G.coop.release(301);G.paused=true;const x=a.x;g.key('ArrowRight');g.step(3);near(a.x,x,'pause');}
record('two simultaneous fighters: opposing X/depth, isolated release, no speed multiplier/double integration, hitstop/pause');
{const g=coop(),{G}=g,[a,b]=G.coop.players,za=a.z,zb=b.z;g.key('ArrowUp');g.key('KeyS');g.step(10);near(a.z,za-10*.078*.72,'P1 keyboard depth');near(b.z,zb+10*.078*.72,'P2 keyboard depth');g.key('ArrowUp',false);g.key('KeyS',false);
 const boss=g.spawn('garm');boss.hp=boss.maxHp*.4;G.bus.emit('hit',{target:boss,dmg:1});G.hitStop=0;g.step();assert(G.story.blocked);const before=G.coop.players.map(p=>({z:p.z,t:G.published.native(p).clock}));g.env.event('keydown',{code:'ArrowDown',stopImmediatePropagation(){}});g.env.event('keydown',{code:'KeyW',stopImmediatePropagation(){}});g.step(10);for(const [i,p]of G.coop.players.entries()){near(p.z,before[i].z,'cinematic lane freeze');assert.equal(G.published.native(p).clock,before[i].t);}assert.equal(G.coop.channels[0].input.touch.z,0);}
record('P1/P2 keyboard depth channels remain independent; shared boss cinematic freezes both lanes and native clocks');
fs.mkdirSync(path.join(root,'evidence/movement-20261025'),{recursive:true});fs.writeFileSync(path.join(root,'evidence/movement-20261025/movement-cpu.json'),JSON.stringify({status:'PASS_CPU',cases,limits:'Production controller/input/fixed loop in Node VM; no browser rendering or trusted iPad touch'},null,2));

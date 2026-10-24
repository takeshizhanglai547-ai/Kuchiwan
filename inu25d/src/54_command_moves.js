// Published fighter bridge; retain the existing 3D scene, foes, props and effects.
// Legacy converter below remains available to historic stage-one tests only.
(function(){'use strict';
const G=window.G;
if(G.publishedFactory){
  const S=60, engines=new WeakMap(), visuals=new Map();
  // Preserve reference pixels across world-unit round trips. A 400px boundary
  // becoming 399.99999999999994 changes strict projectile hit tests by one tick.
  const pixel=(v,previous)=>Number.isFinite(previous)&&Math.abs(v-previous)<1e-8?previous:Math.abs(v-Math.round(v))<1e-9?Math.round(v):v;
  let current=null;
  const animation=(r)=>r.state==='attack'?(r.atk?.def.rise?'specialUp':r.atk?.def.combo?'atk'+Math.min(4,r.atk.def.combo):r.atk?.air?'airAtk':'special'):
    r.state==='jump'?(r.vz>0?'jump':'fall'):r.state==='roll'||r.state==='jdodge'?'dodge':
    r.state==='hurt'?'hurt':r.state==='down'?'down':r.state==='dead'?'ko':r.state==='guard'||r.state==='charge'?'charge':
    r.state==='idle'?(Math.abs(r.vx)>0.1?'run':'idle'):'special';
  function syncHero(p,ctx){const r=ctx.ref.player, oldLevel=p.level||1;
    const bounds=G.stage?.bounds?.()||{xmin:0,xmax:1000,zmin:G.cfg.ZMIN,zmax:G.cfg.ZMAX};
    const originalX=r.x/S;p.x=G.U.clamp(originalX,bounds.xmin+p.radius,bounds.xmax-p.radius);if(p.x!==originalX)r.x=p.x*S;
    p.y=Math.max(0,r.z/S);p.vy=r.vz/S;p.vx=r.vx/S;p.face=r.facing;p.onGround=p.y<=0;
    p.hp=r.hp;p.maxHp=r.maxHp;p.level=r.level;p.xp=r.xp;p.xpNext=r.xpNext;
    p.dim=r.dim;p.dimMax=r.dimMax;p.ult=Math.min(100,100*r.dim/ctx.ref.cost(!p.onGround));p.sp=r.dim;
    p.inv=r.invuln;p.charge=r.charge;p.atkMul=r.atkMul;p.publishedState=r.state;p.refAttack=r.state==='attack'?r.atk:null;
    p.state=r.state==='dead'?'ko':r.state==='jump'?'air':r.state==='roll'||r.state==='jdodge'?'dodge':r.state==='attack'?'atk':r.state;
    p.dead=r.hp<=0;p.atk=null;
    // Read-only display clock. It never selects a move or advances the simulation.
    const pa=r.state==='attack'?r.atk:null;
    p.publishedMotion=pa?{id:pa.type,t:pa.t,hold:pa.hold,holdMax:pa.def.hold||0,air:!!pa.air,def:pa.def,tier:pa.tier||0,
      chargeTicks:pa.chg,time:pa.t+Math.min(pa.chg,pa.def.hold||0),duration:pa.def.dur,act:pa.def.act}:
      r.state==='slide'?{id:'slide',t:r.slideT,time:r.slideT,duration:22,act:[1,15]}:
      r.state==='iaidash'?{id:'iaidash',t:r.iaiT,time:r.iaiT,duration:r.iaiMax,act:[1,r.iaiMax-3]}:
      G.publishedMotion?.describe(r,ctx.ref)||null;
    p.publishedVictim=(r.grabEnemy||ctx.ref.display?.target)?.target||null;
    const anim=animation(r),len=r.atk?.def.dur||28;
    if(p.anim!==anim)G.setAnim(p,anim,len);
    p.animT=r.state==='attack'?r.atk.t+r.atk.chg:p.animT+1;
    if(G.game){G.game.level=r.level;G.game.xp=r.xp;G.game.xpNext=r.xpNext;G.game.combo=ctx.ref.combo.count;
      G.game.publishedCarry=ctx.ref.carry();}
    if(r.level>oldLevel)G.bus.emit('levelUp',{ent:p,level:r.level,hpUp:p.maxHp-(p._lastMaxHp||p.maxHp)});
    p._lastMaxHp=p.maxHp;
  }
  function sourceEnemy(p,ctx,t){let e=ctx.foes.get(t);
    if(!e){const proto=t.publishedType||({cerbe:'cerberus',slime:'slimeboss',emperor:'boss'}[t.type]||t.type);
      e=ctx.ref.enemy(proto,pixel(t.x*S),0,{key:t.id,def:{boss:!!t.def?.boss,w:t.radius*2*S,h:t.height*S,score:(t.def?.xp||0)*10,
        evolveTo:null,slimey:false,bomber:false,zombie:false,t1000:false},values:{hp:t.hp,maxHp:t.maxHp}});
      e.target=t;ctx.foes.set(t,e);}
    if(!e.controlled){e.x=pixel(t.x*S,e.x);e.y=pixel(ctx.lane+(t.z-p.z)*S,e.y);e.z=pixel(t.y*S,e.z);e.vz=pixel(-t.vy*S,e.vz);e.vx=pixel(t.vx*S,e.vx);e.facing=t.face;e.hp=t.hp;e.maxHp=t.maxHp;
      e.dead=!!t.dead;e.state='walk';
      e.protected=t.intangible||t.inv>0||(t.state==='spawn'&&!t.hittableSpawn);e.transform=e.protected?2:0;e.grabbedBy=e.protected?-1:0;}
    return e;
  }
  function syncFoe(p,e){const t=e.target;if(!t||t.removed)return;
    // Existing 3D bosses may replace their phase from onKO; preserve the new living phase.
    if(e.dead&&!t.dead&&t.hp>0){e.hp=t.hp;e.maxHp=t.maxHp;e.dead=false;e.state='walk';e.controlled=false;t.publishedReactive=false;return;}
    t.hp=Math.max(0,e.hp);if(!e.controlled){if(!e.protected)t.x=e.x/S;return;}
    t.x=e.x/S;t.y=Math.max(0,e.z/S);t.z=p.z+(e.y-p._publishedCtx.lane)/S;t.vx=e.vx/S;t.vy=-e.vz/S;
    t.face=e.facing;t.grabbedBy=e.grabbedBy;t.frozen=e.frozen||0;t.publishedReactive=!e.dead&&(e.state!=='walk'||e.frozen>0||e.stun>0);
    t.onGround=t.y<=0;if(t.flashT>0)t.flashT--;if(t.hpShowT>0)t.hpShowT--;
    if(['grabbed','hurt','down','air','blastoff'].includes(e.state)){G.combat.cancel(t);t.pending=null;t.atkArmor=false;}
    if(!t.dead){const st=e.grabbedBy?'grabbed':e.state==='air'?'down':e.state==='walk'?'idle':e.state;
      if(t.state!==st)G.setState(t,st);const anim=e.grabbedBy?'hurt':e.state==='air'||e.state==='down'?'down':e.state==='hurt'?'hurt':'idle';if(t.anim!==anim)G.setAnim(t,anim);}
    if(!t.publishedReactive)e.controlled=false;
  }
  function input(p,ctx){const I=G.input,C=G.commands;
    if(G.commandInputs){ctx.ref.input(G.commandInputs.read(p,ctx));return;}
    ctx.ref.input({left:C.forward(-1),right:C.forward(1),up:C.up(),down:C.down(),attack:I.btn.attack.down,grab:I.btn.grab.down,dodge:I.btn.dodge.down,
      pressed:{attack:I.btn.attack.pressed,grab:I.btn.grab.pressed,jump:I.btn.jump.pressed,dodge:I.btn.dodge.pressed},
      cards:C.cardSeq,taps:C.dirTaps,downs:C.downTaps,rotation:C.stickRot});
  }
  function effects(p,ctx){const active=new Set(ctx.ref.projectiles);
    G.publishedSwords?.tick(ctx.ref.clock);
    for(const [pr,v]of visuals)if(!active.has(pr)){v.obj.parent?.remove(v.obj);v.dispose?.();visuals.delete(pr);}
    for(const pr of active){let v=visuals.get(pr);if(!v){v=G.fx?.makeProjectile?.(pr.wave?'wave':pr.spike?'star':pr.blast?'firework':'ball');
      if(!v)continue;visuals.set(pr,v);G.scene.add(v.obj);}
      const x=pr.x/S,y=Math.max(0,pr.zz)/S,z=p.z+(pr.y-ctx.lane)/S;
      v.obj.position.set(x,y,z);v.update?.({...pr,x,y,z,r:pr.r/S,age:pr.age||0,vx:pr.vx/S,vy:pr.vzz/S,spin:pr.spin});}
    const particles=ctx.ref.drainParticles();let n=0;
    for(const f of particles){if(G.publishedSwords?.particle(f,p,ctx.lane,ctx.ref.clock,ctx.ref.groundHeight?.(f.x)||0))continue;if(n++>=6)continue;const kind=/holy|slash|cres|blade/.test(f.k)?'slash':/ring|shock/.test(f.k)?'ring':/dust/.test(f.k)?'dust':'sparkle';
      G.fx?.burst?.(kind,(f.x||ctx.ref.player.x)/S,Math.max(0,(ctx.lane-(f.y||ctx.lane))/S),p.z,{count:3,color:f.color||f.col});}
  }
  function props(p,ctx,a){const r=ctx.ref.player;
    if(a&&a.t>=a.def.act[0]&&a.t<=a.def.act[1]&&a.def.dmg>0){
      a.propHits||=new Map();const d=a.def,reach=d.reach/S;
      for(const t of G.world.ents){if(t.team!==2||t.dead||t.removed)continue;
        const last=a.propHits.get(t.id);if(last!=null&&(!d.multi||ctx.ref.clock-last<(d.multiGap||8)))continue;
        const dx=(t.x-p.x)*p.face;if((d.omni?Math.abs(dx)>reach+t.radius:dx<-Math.max(16/S,reach*.32)-t.radius||dx>reach+t.radius)||Math.abs(t.z-p.z)>(d.hh||48)/S||t.y+t.height<p.y||t.y>p.y+(d.hh||80)/S)continue;
        a.propHits.set(t.id,ctx.ref.clock);G.combat.damage(t,1,{src:p,dir:p.face,kind:'slash',power:2});}
    }
    for(const pr of ctx.ref.projectiles){if(pr.owner!=='player')continue;pr.propHits||=new Set();
      for(const t of G.world.ents){if(t.team!==2||t.dead||t.removed||pr.propHits.has(t.id))continue;
        if(Math.abs(t.x-pr.x/S)>t.radius+pr.r/S||Math.abs(t.z-p.z-(pr.y-ctx.lane)/S)>.6||t.y>pr.zz/S+pr.r/S||t.y+t.height<pr.zz/S-pr.r/S)continue;
        pr.propHits.add(t.id);G.combat.damage(t,1,{src:p,dir:Math.sign(pr.vx)||p.face,kind:'magic',power:2});}
    }
  }
  const P=G.published={
    attach(p){const ctx={ref:null,foes:new Map(),lane:0,lastId:null,lastState:'idle',p};
      ctx.ref=G.publishedFactory({
        damageScale(){return G.game?.diff?.heroDmg||1;},
        projectile(pr){G.bus.emit('shoot',{ent:p,kind:pr.wave?'wave':pr.spike?'star':pr.blast?'firework':'ball',x:pr.x/S,y:pr.zz/S,z:p.z+(pr.y-ctx.lane)/S});},
        beforeHit(e,args){if(!e.target)return true;const d=ctx.ref.player.atk?.def;
          return !G.combat.publishedBlock(e.target,{src:p,dir:Math.sign(args[1]||p.face),power:args[2]||d?.special||d?.finisher||d?.knock?2:1});},
        hit(e,dmg,args){ctx.trace.hits.push({tick:ctx.ref.clock,target:e.target?.id,damage:dmg,requested:args[0]});
          if(e.target&&!e.protected){e.controlled=true;if(dmg>0)G.combat.publishedHit(e.target,dmg,{src:p,dir:Math.sign(args[1]||p.face),knock:!!args[2],native:e,stop:ctx.ref.freeze});}},
        ult(r,name){G.bus.emit('ult',{ent:p,id:r.kind+'_ult',name,heroId:r.kind});G.fx?.cutin?.(r.kind,name,()=>{});},
        action(a){ctx.trace.actions.push({tick:ctx.ref.clock,...a});}
      });
      ctx.trace={hits:[],actions:[],hurt:[]};ctx.swung=new WeakSet();
      const carry=G.game?.publishedCarry;ctx.ref.reset(p.type,(G.rng()*4294967296)>>>0,carry);ctx.lane=ctx.ref.player.y;
      if(!carry){const r=ctx.ref.player;r.maxHp=Math.round(r.maxHp*(G.game?.diff?.heroHp||1));r.hp=r.maxHp;}
      ctx.ref.player.x=p.x*S;ctx.ref.player.z=p.y*S;ctx.ref.player.facing=p.face;
      ctx.ref.player.level=G.game?.level||1;p._publishedCtx=ctx;p.published=true;engines.set(p,ctx);current=ctx;
      for(const hero in ctx.ref.metadata.base){G.commandMoves.ground[hero]=Object.fromEntries(ctx.ref.metadata.slots.map(slot=>[slot,ctx.ref.catalog(hero,slot,false,1)]));
        G.commandMoves.air[hero]=Object.fromEntries(['dp','hadou','du'].map(slot=>[slot,ctx.ref.catalog(hero,slot,true,1)]));}
      syncHero(p,ctx);return p;
    },
    tick(p){const ctx=engines.get(p);if(!ctx)return;
      const r=ctx.ref.player;if(p.dead){G.input.clearEdges(true);ctx.ref.clearInput();G.commandInputs?.reset(ctx);}
      if(!p.dead&&r.hp<=0){ctx.ref.revive();r.invuln=p.inv||80;G.input.clear();}
      r.invuln=Math.max(r.invuln,p.inv||0);ctx.ref.freeze=0;
      const bounds=G.stage?.bounds?.();ctx.ref.setBounds(Math.max(0,(G.cam?.viewRange?.()[0]||0)*S),bounds?(bounds.xmax-p.radius)*S:undefined);input(p,ctx);
      const living=new Set(G.world.ents.filter(t=>t.team===1&&!t.removed&&!t.dead));
      for(const t of living)sourceEnemy(p,ctx,t);for(const [t,e]of ctx.foes)if(!living.has(t)){ctx.ref.forget(e);ctx.foes.delete(t);}
      G.commandInputs?.before(p,ctx);ctx.ref.step();G.commands.stickRot=ctx.ref.player.in.stickRot;
      const a=r.state==='attack'?r.atk:null;
      if(a&&a.t>=a.def.act[0]&&!ctx.swung.has(a)){ctx.swung.add(a);G.bus.emit('swing',{ent:p,def:a.def,kind:a.def.fist?'blunt':'slash',power:a.def.finisher?3:2});G.fx?.trail?.(p);}
      if(!a)G.fx?.trailStop?.(p);
      // Published DEPTH_SPEED is zero: up/down select moves, not post-move lane drift.
      syncHero(p,ctx);props(p,ctx,a);for(const [t,e]of ctx.foes){
        if(!e.protected&&e.grabbedBy>0)e.controlled=true;
        if(!ctx.ref.enemies.includes(e)){if(!t.dead)G.combat.publishedDefeat(t,{src:p,dir:Math.sign(e.vx)||p.face});ctx.foes.delete(t);continue;}
        syncFoe(p,e);}
      G.hitStop=Math.max(G.hitStop,ctx.ref.freeze);const slow=ctx.ref.takeSlow();if(slow.frames>0)G.slowmo(slow.frames,slow.scale);effects(p,ctx);G.commandInputs?.after(p,ctx);
    },
    queue(p){const ctx=engines.get(p);if(ctx)input(p,ctx);},
    resetInput(p=G.player){const ctx=engines.get(p);ctx?.ref.clearInput();if(ctx)G.commandInputs?.reset(ctx);},
    clock(){return current?.ref.clock??G.time.tick;},
    trace(p=G.player){return engines.get(p)?.trace;},
    native(p=G.player){return engines.get(p)?.ref;},
    receiveDamage(p,amount,info){const ctx=engines.get(p);if(!ctx)return false;const r=ctx.ref.player,before=r.hp;
      if(G.story?.blocked)return false;
      const e=info.src?sourceEnemy(p,ctx,info.src):null;
      if(info.projectile){const q=info.projectile;const pr={x:q.x*S,y:ctx.lane+(q.z-p.z)*S,zz:q.y*S,r:q.r*S,vx:q.vx*S,vy:q.vz*S,vzz:q.vy*S,dmg:amount*(G.game?.diff?.foeDmg||1)/2,color:'#bfe9ff',owner:'enemy'};
        const res=ctx.ref.incomingProjectile(pr);if(res==='reflect'){q.owner=p;q.team=0;q.vx=pr.vx/S;q.vz=pr.vy/S;q.vy=pr.vzz/S;q.dmg=pr.dmg;syncHero(p,ctx);return false;}}
      else ctx.ref.receive(e,amount*(G.game?.diff?.foeDmg||1),{direct:!e,knock:info.power>=3,dir:info.dir,unblock:info.unblockable,zmax:100000});
      syncHero(p,ctx);const dmg=before-r.hp;ctx.trace.hurt.push({tick:ctx.ref.clock,damage:dmg});G.hitStop=Math.max(G.hitStop,ctx.ref.freeze);
      if(r.state==='jdodge')G.bus.emit('dodge',{ent:p,just:true});
      if(dmg>0){G.input.clearEdges(true);ctx.ref.clearEdges();G.commandInputs?.reset(ctx);G.bus.emit('hurt',{ent:p,dmg});if(p.dead)G.bus.emit('heroKO',{ent:p});}
      return dmg>0||r.state==='jdodge'||r.state==='guard'||r.state==='iparry';
    },
    clearVisuals(){for(const v of visuals.values()){v.obj.parent?.remove(v.obj);v.dispose?.();}visuals.clear();},
  };
  G.bus.on('inputReset',()=>P.resetInput());G.bus.on('hidden',()=>{G.input.clear();P.resetInput();G.commands.reset();});
  G.bus.on('scene',d=>{if(d.name!=='play'){P.clearVisuals();P.resetInput();}});
  G.commandMoves={ground:{},air:{},missing:[],get(hero,slot,air,level){const n=current?.ref;if(!n)return null;return n.catalog(hero,slot,air,level);}};
  for(const hero of ['inu','shima','nuko','guard8','watch','wanden','mack']){
    G.commandMoves.ground[hero]=Object.fromEntries(['up','fwd','down','dash','hadou','dp','du'].map(slot=>[slot,{id:slot,published:true}]));
    G.commandMoves.air[hero]=Object.fromEntries(['dp','hadou','du'].map(slot=>[slot,{id:slot,published:true}]));}
  return;
}
const R=G.commandReference, U=G.U;
const ground={}, air={}, missing=[];
function hit(d,o){return Object.assign({at:d.act[0],dur:d.act[1]-d.act[0]+1,x0:0,x1:d.reach/60,
  zr:0.7,y0:0,y1:Math.max(1.3,d.hh/60),dmg:d.dmg,kb:(d.kb||4)/60,up:d.launch?d.launch/60:0,
  power:d.finisher?3:2,kind:d.fist?'blunt':'slash',rehit:d.multi?(d.multiGap||5):0},o);}
function convert(id,slot,isAir){
  const d=R.attacks[id]; if(!d) return null;
  // These require a distinct mechanic, not a generic melee substitute.
  if(d.stolenCast||d.cast||d.zanjin||d.yaegasumi||d.shadowPin||d.flame||d.mkGrenade||d.mkBazooka||d.mkGL||d.mkSnipe||d.mkShotgun||d.stormCall) return null;
  if(isAir && !['aiDp','aiHa','aiDu'].includes(id)) return null;
  const def={id,referenceId:id,name:d.name,len:d.dur,hold:d.hold||0,activeStart:d.act[0],commandSlot:slot,
    airCommand:isAir,rise:!!d.rise,anim:isAir?'airAtk':d.rise?'specialUp':slot==='dash'||slot==='fwd'?'specialDash':'special',
    hits:[],proj:[],areas:[],move:[]};
  if(d.dmg>0&&!d.noMelee){def.hits.push(hit(d,d.omni?{x0:-d.reach/60}:{}));}
  if(d.move)def.move.push({at:0,vx:d.move/60,until:d.act[1]});
  if(d.rise)def.move.push({at:0,vy:(d.riseV||24)/120});
  if(d.shoryu)def.inv=[0,12];
  if(d.pshot){const p=d.pshot;def.proj.push({at:d.act[0],kind:p.style==='spike'?'star':'wave',dmg:p.dmg,
    vx:p.speed/60,r:p.r/60,life:p.life,count:p.count||1,spread:(p.spread||0)/60,oy:0.7,
    pierce:p.pierce||p.multihit?100:0,rehit:p.multihit?(p.hitGap||7):0,homing:p.homing?0.035:0,power:2});}
  if(d.swordFall){const s=d.swordFall;
    for(let i=0;i<s.n;i++){const ox=((i/(s.n-1))-0.5)*s.spread/60;
      def.proj.push({at:d.act[0]+i*2,kind:'wave',ox,oy:5,vx:0.001,vy:-s.fall/60,grav:-0.012,dmg:s.dmg,r:0.25,life:65,power:2,
        boom:{r:0.8,dmg:s.burst,power:2,kind:'slash',up:0.2,fx:'ring'}});}
  }
  if(d.smokeBomb)def.areas.push({at:d.act[0],r:d.reach/60,dmg:3,dizzy:110,kind:'pop',power:1,fx:'poof'});
  if(d.smokeBomb)def.inv=[0,12];
  if(d.wireHook)for(const h of def.hits){h.pull=true;h.noDown=true;}
  if(d.hammerImpact)for(let i=0;i<3;i++)def.areas.push({at:d.act[0]+i*4,r:1.2+i*0.6,dmg:12,power:2,kind:'blunt',up:0.25,fx:'ring'});
  if(d.starRain)for(let i=0;i<6;i++)def.proj.push({at:6+i*4,kind:'star',ox:i*0.3-0.8,oy:4,vx:0.04,vy:-0.18,grav:-0.012,dmg:6,r:0.2,life:45,power:1});
  if(id==='aiDp'){def.move.push({at:0,vy:0.16},{at:14,vy:-0.35,vx:0.2});def.onLand=(p)=>{
    G.combat.area({owner:p,x:p.x,y:0,z:p.z,r:2,dmg:20*(p.atkMul||1),power:3,kind:'slash',up:0.2,fx:'ring'});};}
  if(id==='aiHa')def.proj.push({at:12,kind:'wave',oy:0.6,vx:0.2,vy:-0.10,grav:-0.012,dmg:14,r:0.5,life:60,pierce:100,power:2});
  if(d.airHover)def.fn=(p,t)=>{if(t<d.airHover)p.vy=Math.max(p.vy,0.012);};
  if(!def.hits.length&&!def.proj.length&&!def.areas.length)return null;
  return def;
}
for(const hero in R.ground){ground[hero]={};air[hero]={};
  for(const slot in R.ground[hero]){const id=R.ground[hero][slot],def=convert(id,slot,false);
    if(def)ground[hero][slot]=def;else missing.push({hero,slot,id,air:false});}
  for(const slot in R.air[hero]){const id=R.air[hero][slot],def=convert(id,slot,true);
    if(def)air[hero][slot]=def;else missing.push({hero,slot,id,air:true});}
}
// Dedicated-state Inu moves: retain their own timing/motion rather than aliasing a normal attack.
ground.inu.down={id:'slide',referenceId:null,name:'スライディング',len:23,activeStart:1,commandSlot:'down',anim:'specialDash',
  inv:[0,24],move:[{at:1,vx:10.5/60}],hits:[{at:1,dur:21,x0:0,x1:1.1,zr:0.7,y0:0,y1:0.9,dmg:12,kb:0.15,up:0.15,kind:'blunt',power:2}],
  fn(p){p.vx*=0.9;}};
ground.inu.dash={id:'iaidash',referenceId:null,name:'疾走居合斬り',len:21,activeStart:1,commandSlot:'dash',anim:'specialDash',inv:[0,18],
  move:[{at:1,vx:18/60,until:20}],hits:[{at:1,dur:20,rehit:5,x0:-1.2,x1:1.2,zr:0.8,y0:0,y1:1.5,dmg:11,kb:8/60,up:0.15,power:2,kind:'slash'}]};
G.commandMoves={ground,air,missing:missing.filter(m=>!(m.hero==='inu'&&!m.air&&(m.slot==='down'||m.slot==='dash'))),
  get(hero,slot,inAir){return (inAir?air:ground)[hero]?.[slot]||null;}};
})();

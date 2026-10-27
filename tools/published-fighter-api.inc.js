// Private-scope adapter API. Every named combat action uses the original implementation above.
sndOn=false;gimOn=false;attractOn=false;state='play';hardMode=false;lap=1;
const _pubDamage=damageEnemy, _pubUlt=beginUlt, _pubSteal=bossSteal, _pubSourceTypes=new Map();
let _pubGrabDepth=0;
// Shima's grab rune detonates long after release; retain its grab provenance
// without changing the reference detonation, splash damage or visual clock.
const _pubZankai=zankaiBoom;
zankaiBoom=function(...args){_pubGrabDepth++;try{return _pubZankai.apply(this,args);}finally{_pubGrabDepth--;}};
bossSteal=function(type){return _pubSteal(_pubSourceTypes.get(type)||type);};
damageEnemy=function(e,...args){const scale=_pubHooks.damageScale?.()??1;if(scale!==1)args[0]=Math.round(args[0]*scale);
  const before=e.hp,context={grab:_pubGrabDepth>0||!!_pubActiveProjectile?._pubGrab,projectile:!!_pubActiveProjectile};if(_pubHooks.beforeHit?.(e,args,context)===false)return;_pubDamage(e,...args);
  if(_pubHooks.hit)_pubHooks.hit(e,before-e.hp,args,context);};
beginUlt=function(p,name){_pubUlt(p,name);if(_pubHooks.ult)_pubHooks.ult(p,name||ULT_NAME[p.kind]);};
const _pubCarryKeys=['level','xp','xpNext','maxHp','atkMul','defMul','spdMul','dim','dimMax','weapon','heldWeapon','stolen','ammo'];
// Display events observe real throw entry functions, including instantaneous throws.
// The wrapper calls the unchanged function with the same this/arguments and return value.
let _pubDisplay=null,_pubDisplaySerial=0;
const _pubPunch=punchImpact;
punchImpact=function(e){const before=e.hp;_pubPunch(e);_pubHooks.hit?.(e,before-e.hp,[6,0,false],{grab:true,projectile:false});};
function _pubObserve(id,fn){return function(...args){const prior=new Set(projectiles);_pubGrabDepth++;_pubHooks.grabStart?.(id);
  try{const result=fn.apply(this,args);_pubDisplay={id,at:gf,serial:++_pubDisplaySerial,target:args[0]||null};return result;}
  finally{for(const pr of projectiles)if(!prior.has(pr))pr._pubGrab=true;_pubGrabDepth--;_pubHooks.grabEnd?.(id);}};}
/*@@DISPLAY_WRAPPERS@@*/
return {
  reset(kind,seed,carry){
    _pubSeedTo(seed||1);gf=0;setupRoster(kind);player=players[0];resetPlayer(player,true);player.invuln=0;
    player.x=240;player.y=LANE;player.z=0;player.vz=0;players[1].active=false;state='play';
    enemies=[];projectiles=[];particles=[];hazards=[];items=[];vehicles=[];npcs=[];hitStop=0;slowmo=0;resetCombo();_pubDisplay=null;
    if(carry)for(const k of _pubCarryKeys)if(carry[k]!=null)player[k]=carry[k];player.hp=player.maxHp;
    useInput(player.in);this.clearInput();return player;
  },
  clearInput(){const i=player.in;for(const k in i.keys)i.keys[k]=false;
    for(const k in i.K)i.K[k]=false;for(const k in i.pressed)i.pressed[k]=false;
    i.cardSeq.length=i.dirTaps.length=i.downTaps.length=0;i.stickRot=-999;
    player.charge=0;player.atkHeld=false;player.atkHoldF=0;useInput(i);},
  clearEdges(){const i=player.in;for(const k in i.pressed)i.pressed[k]=false;
    i.cardSeq.length=i.dirTaps.length=i.downTaps.length=0;i.stickRot=-999;player.charge=0;player.atkHeld=false;useInput(i);},
  input(s){const i=player.in;
    i.K.left=s.left;i.K.right=s.right;i.K.up=s.up;i.K.down=s.down;i.K.atk=s.attack;i.K.grab=s.grab;i.K.grd=s.dodge;
    for(const [key,src]of [['atk','attack'],['grab','grab'],['jump','jump'],['grd','dodge']])if(s.pressed[src])i.pressed[key]=true;
    i.cardSeq=s.cards;i.dirTaps=s.taps;i.downTaps=s.downs;i.stickRot=s.rotation;useInput(i);
  },
  enemy(type,x,y,opts){
    const src=ETYPE[type]?type:'wolf';spawnEnemy(src,x,y);const e=enemies[enemies.length-1];
    if(opts){const alias='_pub_'+(opts.key||e.id);_pubSourceTypes.set(alias,src);ETYPE[alias]=Object.assign({},ETYPE[src],opts.def||{});e.type=alias;Object.assign(e,opts.values||{});}
    return e;
  },
  forget(e){if(player.grabEnemy===e){e.dead=true;e.grabbedBy=0;releaseGrab();_pubDisplay=null;}const i=enemies.indexOf(e);if(i>=0)enemies.splice(i,1);},
  gripControl(action){if(player.state!=='grab')return false;
    if(action==='release'){releaseGrab();_pubDisplay=null;return true;}
    if(action==='strike'&&player.grabEnemy&&!player.grabEnemy.dead&&player.grabSub!=='punch'){
      player.grabSub='punch';player.grabAnim=0;_pubDisplay={id:'grabStrike',at:gf,serial:++_pubDisplaySerial,target:player.grabEnemy};return true;}
    return false;
  },
  step(){gf++;const before={state:player.state,id:player.atk?.type,dim:player.dim},previousProjectiles=new Set(projectiles),grabbing=player.state==='grab'||!!player.grabEnemy;
    updatePlayer();saveInput(player.in);_pubReactions();
    for(const pr of projectiles)if(!previousProjectiles.has(pr)){if(grabbing)pr._pubGrab=true;_pubHooks.projectile?.(pr);}
    try{updateProjectiles();}finally{_pubActiveProjectile=null;}updateHazards();updateCombo();
    const after={state:player.state,id:player.atk?.type,dim:player.dim};
    if((before.state!==after.state||before.id!==after.id)&&_pubHooks.action)_pubHooks.action(after,before);
    return after;
  },
  revive(){resetPlayer(player,false);player.active=true;state='play';},
  gainXp(amount){gainXp(amount*10);},
  incomingProjectile(pr){return projVsPlayer(pr,player);},
  receive(e,dmg,info){
    if(info?.direct){hurtPlayer(player,dmg,info.dir||1,!!info.knock, null,info.inv,info.launch);}
    else {const mult=foeAtkMul(e)*(ETYPE[e.type].boss?2:1);hitOnePlayer(player,e,dmg/mult,!!info?.knock,-100000,100000,!!info?.unblock,info?.zmax??100000,info?.inv,info?.launch);}
  },
  get player(){return player;},get enemies(){return enemies;},get projectiles(){return projectiles;},get hazards(){return hazards;},get particles(){return particles;},
  get clock(){return gf;},get freeze(){return hitStop;},set freeze(n){hitStop=n;},
  get combo(){return combo;},get seed(){return _pubSeed;},seedTo:_pubSeedTo,
  get display(){return _pubDisplay;},
  randomTo(fn){Math.random=fn;},
  takeSlow(){const r={frames:slowmo,scale:slowStr};slowmo=0;slowMax=0;return r;},
  drainParticles(){const from=Math.max(0,particles.length-48),r=particles.filter((p,i)=>i>=from||p.k==='fsword'||p.k==='hsword');particles.length=0;return r;},
  groundHeight(x){return groundLift(x);},
  carry(){return Object.fromEntries(_pubCarryKeys.map(k=>[k,player[k]]));},
  cost(air){return ultCost(player,air);},
  setBounds(left,end){camX=Math.max(0,left);if(Number.isFinite(end))WORLD_END=end;},
  catalog(hero,slot,air,level){const p={kind:hero,level:level||1};
    const id=air?airSpecialFor(p,slot):specialFor(p,slot);
    return {id:id||(hero==='nuko'?'nrailchg':slot==='down'?'slide':'iaidash'),def:id?ATK[id]:null};},
  metadata:{base:SPECIAL_BASE,air:AIR_SPECIAL,slots:SPECIAL_SLOTS,upgrades:SPECIAL_UP},
  stats(type){return ETYPE[type]||ETYPE.wolf;},
};

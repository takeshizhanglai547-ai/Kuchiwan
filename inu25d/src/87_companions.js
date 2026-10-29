// Companion roster and bounded 3D assists. Provisional balance: seven equal
// hero draws, 90 game coins, duplicate refund30; Camp owns the atomic wallet/save.
(function(root){'use strict';
const POOL=Object.freeze(['inu','shima','nuko','guard8','watch','wanden','mack']),MAX=3,COST=90,REFUND=30;
function normalize(raw){raw=raw&&typeof raw==='object'?raw:{};const owned=[...new Set((Array.isArray(raw.owned)?raw.owned:[]).map(v=>typeof v==='string'?v:v?.hero).filter(v=>POOL.includes(v)))],party=[];
 for(const v of Array.isArray(raw.party)?raw.party:[]){const hero=typeof v==='string'?v:v?.hero;if(!owned.includes(hero)||party.some(p=>p.hero===hero)||party.length>=MAX)continue;party.push({hero,leaderSlot:Number(v?.leaderSlot)===1?1:0});}return {v:1,owned,party};}
function roll(profile,random=Math.random){const next=normalize(profile),r=typeof random==='function'?random():random;if(!Number.isFinite(r)||r<0||r>1)throw Error('Companion draw requires a finite random value in [0,1]');const hero=POOL[Math.min(POOL.length-1,Math.floor(r*POOL.length))],duplicate=next.owned.includes(hero);
 if(!duplicate){next.owned.push(hero);if(next.party.length<MAX)next.party.push({hero,leaderSlot:0});}return {next,hero,duplicate,refund:duplicate?REFUND:0};}
function equip(profile,hero,leaderSlot=0){const next=normalize(profile);if(!POOL.includes(hero)||!next.owned.includes(hero))return {ok:false,reason:'not-owned',next};const p=next.party.find(p=>p.hero===hero);if(p)p.leaderSlot=Number(leaderSlot)===1?1:0;else{if(next.party.length>=MAX)return {ok:false,reason:'party-full',next};next.party.push({hero,leaderSlot:Number(leaderSlot)===1?1:0});}return {ok:true,next};}
function unequip(profile,hero){const next=normalize(profile),before=next.party.length;next.party=next.party.filter(p=>p.hero!==hero);return {ok:next.party.length!==before,next};}
function createRuntime(G,T){const ents=[],dismissed=new Set();let serial=0,stage=null;
 const humans=()=>G.coop?.enabled?G.coop.players.filter(p=>p&&!p.removed):G.player&&!G.player.removed?[G.player]:[];
 const liveHumans=()=>humans().filter(p=>!p.dead&&p.hp>0);
 const profile=()=>normalize(G.camp?.profile?.()?.companions);
 const bounds=()=>G.stage?.bounds?.()||{xmin:0,xmax:1000,zmin:G.cfg.ZMIN,zmax:G.cfg.ZMAX};
 const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
 function leader(c){const all=humans(),p=all[c.leaderSlot];return p&&!p.dead&&p.hp>0?p:liveHumans()[0]||null;}
 function stop(c){c.vx=c.vz=0;}
 function remove(c){const i=ents.indexOf(c);if(i>=0)ents.splice(i,1);if(!c.removed)G.world.remove(c);}
 function clear(){for(const c of ents.slice())remove(c);dismissed.clear();stage=null;}
 function badge(rig){if(!rig?.root||!T)return;const geometry=new T.TorusGeometry(.36,.025,5,24),material=new T.MeshBasicMaterial({color:0xffdf76,transparent:true,opacity:.85}),ring=new T.Mesh(geometry,material);ring.name='companion-ally-ring';ring.rotation.x=-Math.PI/2;ring.position.y=.035;rig.root.add(ring);const dispose=rig.dispose?.bind(rig);let done=false;rig.dispose=()=>{if(done)return;done=true;ring.removeFromParent();geometry.dispose();material.dispose();dispose?.();};}
 function spawn(spec,index){const all=humans(),p=all[spec.leaderSlot]||liveHumans()[0];if(!p)return null;const b=bounds(),rig=G.heroes?.build?.(spec.hero);if(!rig)return null;badge(rig);
  const c=G.makeEnt({kind:'companion',type:spec.hero,team:0,companion:true,companionId:'ally-'+serial+'-'+spec.hero,leaderSlot:spec.leaderSlot,noSeparation:true,
   x:clamp(p.x-p.face*(.8+index*.4),b.xmin+.25,b.xmax-.25),z:clamp(p.z+(index%2?.55:-.55),b.zmin,b.zmax),rig,radius:.25,height:rig.height||1.3,
   hp:28,maxHp:28,atkMul:.35,sp:0,ult:0,inv:45,weight:1,state:'idle',anim:'idle',onGround:true,assistCd:24+index*12,assistAttack:null});
  rig.root.userData.companionId=c.companionId;G.world.add(c);ents.push(c);return c;
 }
 function syncParty(){const party=profile().party;for(const c of ents.slice()){const spec=party.find(p=>p.hero===c.type);if(!spec)remove(c);else c.leaderSlot=spec.leaderSlot;}
  for(const [i,p]of party.entries())if(!dismissed.has(p.hero)&&!ents.some(c=>c.type===p.hero))spawn(p,i);
 }
 function enter(){clear();serial++;stage=G.game?.stageIndex??0;syncParty();return ents;}
 // External 3D damage must reach every native enemy mirror before syncFoe can
 // write stale HP back. Keep reaction ownership, except an actual form change.
 function reconcile(t,oldForm){for(const p of humans()){const e=p._publishedCtx?.foes?.get(t);if(!e)continue;e.hp=Math.max(0,t.hp);e.maxHp=t.maxHp;e.dead=!!t.dead;if((t.form||1)!==oldForm&&!t.dead){e.state='walk';e.controlled=false;e.grabbedBy=0;t.publishedReactive=false;}}}
 function strike(c,a){const t=G.world.ents.find(e=>e.id===a.targetId);if(!t||t.dead||t.removed||t.intangible||t.team!==1||t.inv>0||Math.abs(t.x-c.x)>1.2+(t.radius||.4)||Math.abs(t.z-c.z)>.65+(t.radius||.4)*.3||t.y>1.6)return;
  const oldForm=t.form||1,before=t.hp;G.combat.damage(t,6*c.atkMul,{src:c,kind:'slash',power:1,dir:c.face,stun:12,kb:.025,noDown:true,stop:1,companion:true});
  if(t.hp!==before||(t.form||1)!==oldForm){reconcile(t,oldForm);G.fx?.burst?.('slash',t.x,t.y+.7,t.z,{count:3,color:'#ffe7a5'});G.bus.emit('companionHit',{ent:c,target:t,damage:Math.max(0,before-t.hp)});}
 }
 function target(c,p){let best=null,dist=Infinity;for(const t of G.world.ents){if(t.team!==1||t.dead||t.removed||t.intangible||t.state==='spawn'||t.inv>0||t.y>1.6)continue;const fromOwner=Math.hypot(t.x-p.x,(t.z-p.z)*1.3);if(fromOwner>6)continue;const d=Math.hypot(t.x-c.x,(t.z-c.z)*1.3);if(d<dist&&d<6){best=t;dist=d;}}return best;}
 function walk(c,x,z){const b=bounds(),dx=clamp(x,b.xmin+c.radius,b.xmax-c.radius)-c.x,dz=clamp(z,b.zmin,b.zmax)-c.z,m=Math.hypot(dx,dz);if(m<.18){stop(c);G.setState(c,'idle');G.setAnim(c,'idle');return;}const speed=Math.min(.06,m);c.vx=dx/m*speed;c.vz=dz/m*speed*.72;if(Math.abs(dx)>.15)c.face=dx>0?1:-1;G.setState(c,'move');G.setAnim(c,'run');}
 function tick(){if(G.sceneName!=='play'||G.paused||G.story?.blocked||G.hitStop>0||G.game?.cutinT>0||G.scenes.play?.over)return false;if(stage===null)enter();syncParty();
  const all=liveHumans();for(const [index,c]of ents.slice().entries()){
   if(c.dead||c.hp<=0){dismissed.add(c.type);c.assistAttack=null;stop(c);c.deadT=(c.deadT||0)+1;G.setAnim(c,'ko');if(c.deadT>=45)remove(c);continue;}
   if(!all.length||G.scenes.play?.cleared){c.assistAttack=null;stop(c);continue;}
   if(c.inv>0)c.inv--;c.stateT++;if(c.assistCd>0)c.assistCd--;
   if(c.state==='hurt'||c.state==='dizzy'){c.assistAttack=null;c.stun=(c.stun||0)-1;c.vx*=.8;c.vz*=.8;if(c.stun<=0){G.setState(c,'idle');G.setAnim(c,'idle');}continue;}
   if(c.state==='down'){c.assistAttack=null;if(c.onGround){c.assistDown=(c.assistDown||0)+1;if(c.assistDown>=26){c.assistDown=0;c.inv=40;G.setState(c,'idle');G.setAnim(c,'idle');}}continue;}
   const p=leader(c);if(!p){stop(c);continue;}c.atkMul=.35*(p.atkMul||1);
   const a=c.assistAttack;if(a){stop(c);a.t++;if(a.t===6)strike(c,a);if(a.t>=18){c.assistAttack=null;G.setState(c,'idle');G.setAnim(c,'idle');}continue;}
   const t=target(c,p);if(t){const dx=t.x-c.x,dz=t.z-c.z;c.face=dx>=0?1:-1;if(Math.abs(dx)<=.95+(t.radius||.4)&&Math.abs(dz)<.55){stop(c);if(c.assistCd<=0){c.assistCd=64;c.assistAttack={targetId:t.id,t:0};G.setState(c,'atk');G.setAnim(c,'atk1',18,.35);}else{G.setState(c,'idle');G.setAnim(c,'idle');}}else walk(c,t.x-c.face*.8,t.z);}
   else{const x=p.x-p.face*(.9+index*.4),z=p.z+(index%2?.55:-.55);if(Math.hypot(c.x-p.x,c.z-p.z)>12){const b=bounds();c.x=c.px=clamp(x,b.xmin+c.radius,b.xmax-c.radius);c.z=c.pz=clamp(z,b.zmin,b.zmax);}walk(c,x,z);}
  }return true;
 }
 return {pool:POOL,maxActive:MAX,cost:COST,duplicateRefund:REFUND,normalize,roll,equip,unequip,enter,tick,clear,ents};
}
const pure={pool:POOL,maxActive:MAX,cost:COST,duplicateRefund:REFUND,normalize,roll,equip,unequip,createRuntime};if(typeof module!=='undefined'&&module.exports)module.exports=pure;if(root?.G)root.G.companions=createRuntime(root.G,root.THREE);
})(typeof window==='undefined'?null:window);

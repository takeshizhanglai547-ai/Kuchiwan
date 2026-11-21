// Black swordsman actions run through the same native fighter as the seven heroes.
(function(){'use strict';
const G=window.G,C='#d9b6dd',clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
const ease=v=>{v=clamp(v);return v*v*(3-2*v);};
const definitions={
 kuro1:{name:'鉄塊・横薙ぎ',dur:27,act:[12,17],dmg:19,combo:1,from:-2.3,to:1.25,lunge:.9},
 kuro2:{name:'黒牙・返し斬り',dur:30,act:[13,19],dmg:23,combo:2,from:1.7,to:-2.0,lunge:1.3},
 kuro3:{name:'鉄塊・断ち落とし',dur:43,act:[20,26],dmg:37,combo:3,from:-2.4,to:1.45,finisher:true,knock:true,kb:15},
 kuroRush:{name:'黒牙・突進斬り',dur:39,act:[11,26],dmg:25,move:11,stinger:true,special:true,multi:true,multiGap:10,from:-.4,to:.4},
 kuroVault:{name:'大剣軸・倒立斬り',dur:56,act:[18,41],dmg:15,special:true,multi:true,multiGap:9,omni:true,from:-2.5,to:2.7},
 kuroImpale:{name:'牙突・壁砕き',dur:112,act:[15,87],dmg:0,special:true,kuroImpale:true,from:-.1,to:.1},
 kuroLow:{name:'地摺り・大剣払い',dur:36,act:[15,23],dmg:28,special:true,from:-2.7,to:1.1,knock:true},
 kuroBreaker:{name:'鉄塊・地裂断',dur:49,act:[24,31],dmg:44,special:true,charged:true,knock:true,finisher:true,from:-2.6,to:1.5,kb:18},
 kuroCharge:{name:'黒天・溜め断ち',dur:51,act:[25,33],dmg:49,charged:true,knock:true,finisher:true,from:-2.8,to:1.7,kb:20},
 kuroRise:{name:'逆牙・斬り上げ',dur:42,act:[12,25],dmg:28,special:true,rise:true,riseV:10,from:1.3,to:-2.1},
 kuroUlt:{name:'黒天・大剣乱舞',dur:88,act:[17,72],dmg:17,ultMove:true,special:true,multi:true,multiGap:10,omni:true,knock:true,from:-3,to:3,reach:160,hh:155,kb:10},
 kuroAir:{name:'黒翼・空中断ち',dur:41,act:[12,27],dmg:27,special:true,from:-2.5,to:1.5,airRise:8,airLand:15},
 kuroFlare:{name:'炉心剣・紅蓮断',dur:54,act:[23,41],dmg:34,ultMove:true,special:true,knock:true,multi:true,multiGap:12,from:-2.3,to:1.7,trail:'#ffb08e'},
 kuroAurora:{name:'暁の剣・天蓋斬',dur:61,act:[19,45],dmg:24,ultMove:true,special:true,multi:true,multiGap:10,omni:true,from:-2.6,to:2.7,trail:'#b9f1e4'}
};
const slots={up:'kuroRise',fwd:'kuroRush',down:'kuroLow',dash:'kuroRush',hadou:'kuroImpale',dp:'kuroRise',du:'kuroVault'};
function install(api){
 for(const [id,def]of Object.entries(definitions))api.ATK[id]={
  reach:128,hh:94,kb:8,len:98,trail:C,pivotY:-57,...def,kuro:true};
 const weapons=[
  ['kuroSlayer','鉄塊の大剣','#9f96ad',1,1],
  ['kuroFurnace','炉心の大剣','#d98a7e',1.15,1.08],
  ['kuroDawn','暁の大剣','#a8d2cb',1.25,1.15]];
 for(const [id,name,col,dmg,reach]of weapons){
  api.WEAPONS[id]={name,col,who:'kuro',snd:'longblade',dmg,reach,kb:1.2,ext:1.5,trail:col,launch:1.2};
  api.WEAPON_COMBO[id]=['kuro1','kuro2','kuro3'];
  api.WEAPON_SPECIAL[id]={fwd:'kuroRush',ult:id==='kuroFurnace'?'kuroFlare':id==='kuroDawn'?'kuroAurora':'kuroUlt',air:'kuroAir'};
 }
 api.SPECIAL_BASE.kuro={...slots};api.SPECIAL_UP.kuro={};
 api.AIR_SPECIAL.kuro={dp:'kuroAir',hadou:'kuroRush',du:'kuroVault'};
 api.AIR_ULT.kuro='kuroUlt';
}
function release(p,ctx,slam=false){
 const grip=p._kuroCarry;if(!grip)return;
 const e=grip.enemy;p._kuroCarry=null;p.grabEnemy=null;
 e.grabbedBy=0;e.controlled=true;e.z=Math.max(0,e.z);
 if(e.dead||!ctx.enemies.includes(e))return;
 ctx.damage(e,Math.round((slam?46:8)*(p.atkMul||1)),p.facing*(slam?12:2),true);
 if(!e.dead)ctx.launch(e,p.facing*(slam?11:2),slam?-14:-5,slam?2:0);
 if(slam){
  G.bus.emit('kuroWallSlam',{player:p,x:p.x/60,face:p.facing});
  G.cam?.shake?.(7,22);
  const target=e.target;
  if(target)G.fx?.burst?.('shock',target.x,.65,target.z,{scale:2.2,color:C});
 }
}
function step(ctx){
 const {p,enemies}=ctx;
 if(p.kind!=='kuro')return false;
 const a=p.state==='attack'?p.atk:null;
 if(p._kuroCarry&&(!a?.def.kuroImpale||p.hp<=0||p._kuroCarry.enemy.protected)){
  release(p,ctx);return false;
 }
 if(!a?.def.kuroImpale)return false;
 // The native hitstop owns the clock. Holding and release cannot advance in pause.
 if(a.hold>0)return false;
 a.t++;p.vx=0;p.z=0;p.vz=0;
 if(p.invuln>0)p.invuln--;if(p.sgCd>0)p.sgCd--;
 if(a.t===15){
  const target=enemies.filter(e=>!e.dead&&!e.protected&&!e.grabbedBy&&!e.target?._frenzyShift&&
   (e.x-p.x)*p.facing>0&&(e.x-p.x)*p.facing<145&&Math.abs(e.y-p.y)<38&&e.z<50)
   .sort((a,b)=>Math.abs(a.x-p.x)-Math.abs(b.x-p.x))[0];
  if(target){
   // Use native damage hooks for immunity, shared ownership and the half-HP threshold.
   ctx.damage(target,Math.round(15*(p.atkMul||1)),0,false);
   if(!target.dead&&!target.protected&&!target.target?._frenzyShift){
    target.grabbedBy=p.pid+1;target.controlled=true;p.grabEnemy=target;
    const bounds=G.stage?.bounds?.(),lo=(bounds?.xmin??ctx.left/60)*60+88,hi=(bounds?.xmax??ctx.right/60)*60-88;
    p._kuroCarry={enemy:target,attack:a,travel:0,wall:clamp(p.facing>0?ctx.right:ctx.left,lo,hi)};
    G.bus.emit('kuroWallTarget',{player:G.player,x:p._kuroCarry.wall/60+p.facing*1.25,z:G.player.z,face:p.facing});
   }
  }
 }
 const grip=p._kuroCarry;
 if(grip&&a.t>=20){
  const wall=grip.wall,speed=Math.max(12.5,Math.abs(wall-p.x)/Math.max(1,86-a.t));
  const next=p.facing>0?Math.min(wall,p.x+speed):Math.max(wall,p.x-speed),delta=Math.abs(next-p.x);
  p.x=next;grip.travel+=delta;
  const e=grip.enemy;e.x=p.x+p.facing*76;e.y=p.y;e.z=45;e.vx=e.vz=0;e.state='grabbed';
  if(delta<.1||a.t>=87){release(p,ctx,true);a.t=88;}
 }else if(!grip&&a.t>=16&&a.t<25)p.x=clamp(p.x+p.facing*5,ctx.left,ctx.right);
 if(!grip&&a.t>29&&a.t<88)a.t=88;
 if(a.t>=a.def.dur){release(p,ctx);p.atk=null;p.state='idle';p.atkHeld=true;}
 return true;
}
function pose(rig,e,Q){
 if(rig.heroId!=='kuro')return null;
 const m=e.publishedMotion;
 if(!m){
  if(e.state==='idle'||e.state==='move'){
   Q.aRz=1.55;Q.aRy=.32;Q.wz=1.15;Q.aLz=1.15;Q.aLy=-.2;Q.lean=.045;
  }
  return null;
 }
 const d=definitions[m.id]||m.def;if(!d?.kuro&&!definitions[m.id])return null;
 const t=m.t||0,start=d.act?.[0]||12,end=d.act?.[1]||25;
 const load=ease(t/start),cut=ease((t-start)/Math.max(5,end-start)),settle=ease((t-end)/Math.max(1,d.dur-end));
 Object.assign(Q,{aRx:.40,aRy:.15,aRz:.3+load*1.85-cut*1.7,aLx:.55,aLy:-.3,aLz:1.8-load*.25+cut*.65,
  wz:2.0-load*2.6+cut*3.1,lean:-.17*load+.37*cut*(1-settle),twist:-.45*load+.94*cut*(1-settle),sq:-.12*load+.08*cut,
  lLz:.35*load-.42*cut,lRz:-.32*load+.58*cut});
 if(m.id==='kuro2') {Q.twist*=-1;Q.wz=1.2+load*1.9-cut*3.0;}
 if(m.id==='kuroRush'){Q.lean=.40;Q.aRz=.89;Q.aLz=1.22;Q.wz=.65+Math.sin(t*.32)*.12;Q.lLz=Math.sin(t*.48)*.55;Q.lRz=-Q.lLz;}
 if(m.id==='kuroVault'){
  const vault=ease((t-9)/18)*(1-ease((t-39)/15));
  Q.roll=Math.PI*vault;Q.y=.73*vault;Q.aRz=2.8;Q.aLz=2.75;Q.wz=-1.2;
  Q.lLz=-.65*vault;Q.lRz=.85*vault;Q.twist=Math.sin(t*.27)*.55*vault;
 }
 if(m.id==='kuroImpale'){
  Q.lean=t<20?.15:.45;Q.aRz=1.13;Q.aLz=1.6;Q.wz=t<20?.2:t<88?-.07:1.85;
  Q.aRy=-.14;Q.wx=.1;Q.y=t>=20&&t<88?.04*Math.sin(t*.9):0;
  Q.lLz=t<88?Math.sin(t*.63)*.8:.5;Q.lRz=-Q.lLz;
 }
 if(m.id==='kuroUlt'||m.id==='kuroAurora'){
  Q.spin=t>=start&&t<=end?Math.sin(t*.15)*.23:0;Q.twist=Math.sin(t*.30)*.85;
  Q.aRz=1.65+Math.sin(t*.3);Q.wz=t*.29;Q.aLz=2.1;Q.y=.12*Math.abs(Math.sin(t*.15));
 }
 return {id:m.id,aim:1,eyes:'open',glow:m.id==='kuroUlt'?.4:.06};
}
const plantTip=new window.THREE.Vector3(),plantGoal=new window.THREE.Vector3();
function postPose(rig,e){
 const m=e.publishedMotion;
 if(m?.id!=='kuroVault'||m.t<16||m.t>40){rig.st.kuroPlant=null;return;}
 rig.root.updateMatrixWorld(true);rig.tip.getWorldPosition(plantTip);
 if(!rig.st.kuroPlant)rig.st.kuroPlant={x:plantTip.x,z:plantTip.z,t:m.t};
 const anchor=rig.st.kuroPlant;
 if(m.t<anchor.t){rig.st.kuroPlant=null;return;}
 anchor.t=m.t;
 plantGoal.set(anchor.x,rig.root.position.y+.045,anchor.z);
 const parent=rig.n.act.parent;parent.worldToLocal(plantTip);parent.worldToLocal(plantGoal);
 rig.n.act.position.add(plantGoal.sub(plantTip));rig.root.updateMatrixWorld(true);
}
G.kuroCombat={install,step,pose,postPose,definitions,slots};
G.playerCtl.MOVES.kuro={...G.playerCtl.MOVES.inu,stats:{hp:1.18,atk:1.2,spd:.91,jump:.96},trail:C};
// Guide rows describe the actual definitions installed in the fighter.
const rows=G.publishedCatalog.rows;
for(const [slot,id]of Object.entries(slots))rows.push({hero:'kuro',group:'ground',slot,id,level:1,name:definitions[id].name,
 command:({up:'↑＋攻撃',fwd:'前＋攻撃',down:'↓＋攻撃',dash:'後ろ→前＋攻撃',hadou:'↓↘→＋攻撃',dp:'→↓↘＋攻撃',du:'↓↑＋攻撃'})[slot],
 duration:definitions[id].dur,active:definitions[id].act,note:id==='kuroImpale'?'前方の敵を大剣で持ち上げ、画面端まで走って叩きつける。途中で被弾すると解放。':''});
for(const [i,id]of ['kuro1','kuro2','kuro3'].entries())rows.push({hero:'kuro',group:'combo',slot:String(i+1),id,level:1,name:definitions[id].name,command:'攻撃を押し直す '+(i+1)+'段目',duration:definitions[id].dur,active:definitions[id].act});
for(const [group,id,command]of [['charge','kuroCharge','攻撃を長押しして離す'],['chord','kuroBreaker','必殺ボタン'],['ground-ultimate','kuroUlt','奥義ボタン／レバー1回転＋攻撃'],['air-command','kuroAir','空中 →↓↘＋攻撃']])
 rows.push({hero:'kuro',group,slot:id,id,level:1,name:definitions[id].name,command,duration:definitions[id].dur,active:definitions[id].act});
G.publishedCatalog.costs.kuro=[{level:1,ground:1,air:1},{level:6,ground:2,air:2}];
})();

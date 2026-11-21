// Sixth journey. A mechanical shell surrounds each rescuable puppy.
(function(){'use strict';
const G=window.G,T=window.THREE,F=G.foes,H=F.h,PI=Math.PI;
const metal='#8e97a5',edge='#d4d6da',dark='#394452',rust='#af7f7c',glow='#ffbc93';
const modelCache=new Map();
function sculpt(shape){
 const g=G.look.geo,parts=[],n=shape==='mechaEmperor'?1.14:1;
 const colors={scout:'#869aaa',hound:'#9b919c',grenadier:'#a49789',bulwark:'#8294a0',drone:'#9c96af',welder:'#afa196',
  crusher:'#9c898d',artillery:'#8b9997',interceptor:'#8c94b1',forgeWarden:'#ad8c83',mechaEmperor:'#696379'};
 const col=colors[shape],boss=['crusher','artillery','interceptor','forgeWarden','mechaEmperor'].includes(shape);
 function part(name,pivot,draw){
  const b=G.look.builder();
  const orb=(c,x,y,z,s)=>b.add(g.sphere(1,16,11),c,[x,y,z],null,s);
  const box=(c,x,y,z,s,rot)=>b.add(g.rbox(...s,Math.min(.045,Math.min(...s)*.38),2),c,[x,y,z],rot);
  const rod=(c,p,q,r)=>{
   const a=new T.Vector3(...p),v=new T.Vector3(...q).sub(a);
   const rot=new T.Euler().setFromQuaternion(new T.Quaternion().setFromUnitVectors(new T.Vector3(0,1,0),v.clone().normalize()));
   b.add(g.cylinder(r,r,v.length(),10),c,a.addScaledVector(v,.5).toArray(),[rot.x,rot.y,rot.z]);
  };
  const plate=(kind,c,x,y,z,s,rot)=>b.add(G.roundForms.plate(kind),c,[x,y,z],rot,s);
  const ring=(c,x,y,z,r,w,rot)=>b.add(g.torus(r,w,6,22),c,[x,y,z],rot);
  draw({b,orb,box,rod,plate,ring});
  const geometry=b.build();geometry.translate(-pivot[0],-pivot[1],-pivot[2]);geometry.userData.shared=true;
  parts.push({name,pivot,geometry});return parts.at(-1);
 }
 const tank=shape==='artillery'||shape==='bulwark',quadruped=shape==='hound',flying=shape==='drone'||shape==='interceptor';
 part('body',[0,0,0],({orb,box,plate,ring})=>{
  orb(dark,-.11,.54,0,[.35*n,.39,.40*n]);
  plate('cuirass',col,.17,.64,0,[.36*n,.34,2.9],[0,PI/2,0]);
  for(const s of [-1,1]){
   plate('shell',edge,-.07,.71,s*.34*n,[.30,.33,.91],[s*.26,0,-.12]);
   plate('shell',col,-.07,.72,s*.386*n,[.26,.28,.80],[s*.26,0,-.12]);
   for(const x of [-.20,-.06,.08])orb(rust,x,.58,s*.421*n,[.023,.025,.012]);
   box(dark,-.11,.37,s*.298,[.38,.083,.095]);
   box(glow,.113,.74,s*.30,[.046,.13,.08]);
  }
  orb('#e3b1ab',.25,.57,0,[.052,.063,.092]);
  box('#b6a2a7',-.28,.485,0,[.12,.27,.60]);
  ring(rust,-.15,.33,0,.298,.023,[PI/2,0,0]);
 });
 const hy=quadruped?.71:1.065,w=shape==='mechaEmperor'?.365:.325;
 part('head',[.12,hy,0],({b,orb,box,plate,ring})=>{
  b.add(G.roundForms.plush,col,[.12,hy,0],null,[w,w*.91,w*1.02]);
  for(const s of [-1,1]){
   orb('#dad0c5',.355,hy-.12,s*.072,[.086,.08,.121]);
   orb(rust,.316,hy-.105,s*.258,[.047,.030,.020]);
   orb(col,-.038,hy+.26,s*.228,[.092,.163,.097]);
   plate('petal',dark,-.009,hy+.315,s*.255,[.054,.105,.42],[0,.12,s*.11]);
   plate('cheek',edge,-.105,hy-.10,s*.268,[.184,.129,1.1],[s*.2,0,-.11]);
   for(let j=0;j<3;j++)box(dark,-.12+j*.071,hy+.058,s*.300,[.045,.075,.027],[0,0,-.21]);
   box(edge,.06,hy+.20,s*.185,[.19,.033,.03],[0,0,-.45]);
  }
  orb(dark,.439,hy-.09,0,[.034,.035,.054]);
  orb(edge,.458,hy-.07,.016,[.010,.009,.017]);
  plate('crest',dark,.205,hy+.22,0,[.279,.073,2.0],[0,PI/2,0]);
  box(rust,-.053,hy+.266,0,[.128,.088,.102]);
  if(boss)ring(edge,-.087,hy+.215,0,.262,.025,[PI/2,0,0]);
  if(shape==='mechaEmperor'){
   for(const s of [-1,1]){
    b.add(G.roundForms.curve([[-.10,hy+.23,s*.20],[-.17,hy+.45,s*.30],[-.05,hy+.59,s*.27]],[[.074,.07],[.055,.057],[.009,.009]],10,9),edge);
    orb('#d3a2db',.21,hy+.295,s*.15,[.043,.045,.039]);
   }
   plate('spear',rust,.141,hy+.36,0,[.195,.21,.85],[0,PI/2,0]);
  }
 });
 const set=F.expressionMeshes('mecha-'+shape,{c:[0,0,0],r:[w*1.045,w*.91,w*1.06],az:.69,el:.12,size:w*.28,style:'yellow',
  eyeColor:shape==='welder'?'#beece0':glow,regional:true,mouth:'bow',mouthEl:-.33,mouthO:{el:-.34},dropAz:1.06,dropEl:.36});
 for(const [name,geometry]of [['idle',set.neutral],['focus',set.angry],['hurt',set.squeeze],['ko',set.x]])
  parts.push({name,pivot:[0,0,0],parent:'head',geometry});
 for(const s of [-1,1])part('leg'+s,[0,.32,s*.21],({orb,box,rod,plate})=>{
  if(tank){
   plate('strap',dark,-.13,.20,s*.33,[.44,.24,1.8]);
   for(const x of [-.42,-.21,0,.21]){
    orb(edge,x,.20,s*.45,[.10,.103,.039]);orb(rust,x,.20,s*.49,[.045,.046,.013]);
   }
  }else if(quadruped){
   for(const x of [-.34,.18]){
    orb(edge,x,.27,s*.28,[.098,.10,.096]);
    rod(col,[x,.30,s*.28],[x+.07,.13,s*.31],.061);
    orb(dark,x+.10,.08,s*.32,[.137,.074,.105]);
   }
  }else{
   orb(dark,-.03,.30,s*.20,[.105,.127,.105]);
   rod(edge,[-.03,.30,s*.20],[.015,.16,s*.22],.062);
   plate('shell',col,.025,.18,s*.28,[.113,.14,.72]);
   orb(dark,.08,.077,s*.23,[.17,.073,.122]);
   for(const x of [.07,.13])box(edge,x,.080,s*.337,[.037,.030,.022]);
  }
 });
 if(quadruped)part('tail',[-.43,.54,0],({b,orb})=>{
  b.add(G.roundForms.curve([[-.43,.54,0],[-.66,.49,0],[-.76,.65,0]],[[.081,.075],[.060,.054],[.013,.015]],10,9),col);
  orb(glow,-.75,.65,0,[.039,.050,.04]);
 });
 for(const s of [-1,1])part('arm'+s,[.02,.73,s*.34*n],({orb,rod,plate,box,ring})=>{
  const cannon=shape==='grenadier'||shape==='artillery'||shape==='mechaEmperor'&&s<0;
  orb(dark,.024,.76,s*.39*n,[.158,.15,.148]);
  plate('shell',col,-.03,.79,s*.46*n,[.217,.23,1.1],[s*.15,0,-.12]);
  rod(edge,[.05,.69,s*.41],[.14,.53,s*.44],.073);
  orb(rust,.14,.525,s*.44,[.087,.085,.084]);
  if(cannon){
   box(col,.28,.58,s*.45,[.41,.21,.24],[0,0,.10]);
   rod(dark,[.20,.63,s*.45],[.57,.66,s*.45],.088);
   ring(edge,.57,.66,s*.45,.084,.019,[0,PI/2,0]);
   for(const z of [-.05,.05])orb(dark,.594,.66,s*.45+z,[.015,.028,.019]);
   for(let i=0;i<3;i++)box(glow,.14+i*.078,.694,s*.579,[.044,.027,.016]);
  }else{
   plate('cuirass',edge,.26,.53,s*.457,[.182,.14,1.6],[0,.10,.05]);
   orb(col,.294,.516,s*.47,[.16,.13,.135]);
   for(const x of [.27,.34])box(dark,x,.545,s*.58,[.045,.059,.026]);
   ring(glow,.29,.532,s*.57,.079,.014);
  }
  if(shape==='bulwark')plate('shield',col,.36,.50,s*.59,[.28,.39,1.06],[0,.2,0]);
  if(shape==='crusher'){
   box(dark,.31,.48,s*.47,[.28,.30,.29]);
   for(let i=0;i<3;i++)box(edge,.35,.49,s*(.59+i*.026),[.28,.048,.035],[0,0,.20]);
  }
  if(shape==='welder'||shape==='forgeWarden'){
   rod(edge,[.16,.51,s*.44],[.52,.59,s*.45],.048);
   orb('#c8e8dc',.535,.60,s*.45,[.04,.047,.046]);
  }
 });
 if(flying||shape==='mechaEmperor')part('pack',[-.34,.66,0],({orb,box,rod,ring,plate})=>{
  box(dark,-.40,.72,0,[.24,.43,.48]);
  for(const s of [-1,1]){
   rod(col,[-.44,.60,s*.25],[-.45,.93,s*.25],.113);
   ring(edge,-.44,.60,s*.25,.102,.022,[PI/2,0,0]);
   orb('#b9eaff',-.44,.56,s*.25,[.078,.036,.079]);
   if(flying)plate('wing',col,-.32,.82,s*.52,[.39,.28,1.20],[s*.64,.18,-.29]);
  }
 });
 if(shape==='mechaEmperor')part('blade',[.28,.51,.49],({plate,rod,orb})=>{
  rod(dark,[.27,.48,.50],[.40,.69,.50],.04);
  plate('katana',edge,.55,.99,.50,[.51,.48,.91],[0,0,-.57]);
  plate('katana','#ad82bd',.58,1.01,.566,[.36,.44,.44],[0,0,-.57]);
  orb(rust,.36,.62,.50,[.10,.073,.14]);
 });
 return {parts,flying,boss};
}
function build(shape,scale=1,height=1.55){
 if(!modelCache.has(shape))modelCache.set(shape,sculpt(shape));
 const spec=modelCache.get(shape),root=new T.Group(),body=new T.Group(),nodes=new Map(),faceNodes=[];
 root.add(body);body.scale.setScalar(scale);
 const mat=G.look.vmat({instance:true,rough:.53,metal:.21,rim:.8}),faceMat=G.look.vmat({instance:true,rough:.65});
 for(const p of spec.parts){
  const mesh=new T.Mesh(p.geometry,p.parent?faceMat:mat);mesh.name=p.name;
  (p.parent?nodes.get(p.parent):body).add(mesh);
  if(p.parent){mesh.visible=p.name==='idle';faceNodes.push(mesh);}
  else{
   mesh.position.fromArray(p.pivot);mesh.castShadow=true;nodes.set(p.name,mesh);
   G.look.outline(mesh,.014,'#34303f');
  }
 }
 let hurtAge=50,lastFlash=0;
 function update(e){
  const age=e.animT||0,a=e.atk,m=a?.def,t=a?.t||0,wind=e.pending?1-e.pending.t/(e.pending.def.windup||32):0;
  if(e.flashT>lastFlash)hurtAge=0;lastFlash=e.flashT;hurtAge++;
  const pain=Math.max(0,1-hurtAge/19),ko=!!e.dead,settle=ko?Math.min(1,(e.deadT||0)/24):0;
  body.rotation.set(0,e.face<0?PI+.38:-.38,(.12*wind+pain*.24+settle*1.10)*(e.face||1));
  body.position.y=(spec.flying?.17+Math.sin(age*.1)*.07:Math.abs(Math.sin(age*.30))*(e.state==='move'?.045:0))+settle*.12;
  const swell=1-(e.rescuePose||0)*.37;body.scale.set(scale*(1+(e.rescuePose||0)*.16),scale*swell,scale);
  const mode=ko?'ko':pain>.28?'hurt':a||e.pending?'focus':'idle';
  for(const f of faceNodes)f.visible=f.name===mode;
  for(const s of [-1,1]){
   const arm=nodes.get('arm'+s),leg=nodes.get('leg'+s);
   arm.rotation.set(0,0,.11*wind+.12*Math.sin(age*.1+s));
   leg.rotation.z=e.state==='move'?Math.sin(age*.31+s)*.31:0;
   if(a){
    if(m.pose==='cast')arm.rotation.z=-.45+Math.sin(t*.4)*.12;
    else arm.rotation.z=-Math.sin(Math.min(1,t/Math.max(1,m.len))**.7*PI)*1.15;
   }
  }
  if(nodes.get('blade'))nodes.get('blade').rotation.z=a?.def.pose==='spin'?t*.25:0;
  const pack=nodes.get('pack');if(pack)pack.rotation.z=e._mechaJet?Math.sin(t*.19)*.1:0;
  if(e._mechaJet){body.rotation.x=Math.sin(t*.21)*.30;body.rotation.y+=t*.39;}
  if(e._frenzyForm){body.rotation.z+=Math.sin(age*.08)*.025;}
  mat.userData.uFlash.value=pain*.6;
 }
 return {root,height,radius:scale*.42,shape,update,
  setAlpha(a){for(const m of [mat,faceMat]){m.transparent=a<1;m.opacity=a;}},
  dispose(){mat.dispose();faceMat.dispose();}};
}
const zone=(at,anchor,x,z,r,zr,fx,dmg,y1=1.2)=>({at,kind:'zone',anchor,x,z,r,zr,fx,dmg,y1});
const ring=(at,x,z,r,zr,fx,dmg,y1)=>zone(at,'target',x,z,r,zr,fx,dmg,y1);
const sweep=(at,x,z,r,zr,fx,dmg,y1)=>zone(at,'boss',x,z,r,zr,fx,dmg,y1);
const shot=(at,projectile,angles,speed,damage,extra={})=>({at,kind:'shot',projectile,angles,speed,damage,...extra});
const dash=(at,frames,speed,reach,fx,damage,extra={})=>({at,kind:'dash',frames,speed,reach,fx,damage,...extra});
const card=(name,pose,windup,recover,...events)=>({name,pose,windup,recover,events,cleanup:land});
const grenade=(at,angles=[0])=>shot(at,'mechaGrenade',angles,.18,9,{height:1.20,vy:.16,grav:-.012,radius:.18,life:85,
 boom:{r:1.14,zr:.86,dmg:14,y1:1.6,power:2,fx:'shock',color:'#ffb887'}});
function land(e){e.gravScale=1;e.vx=e.vy=e.vz=0;e._mechaJet=null;e.onGround=e.y<=.01;}
function jet(e,t,target){
 if(t===0)e._mechaJet={home:{x:e.x,z:e.z},target:{x:target.x,z:target.z}};
 if(!e._mechaJet)return;
 e.gravScale=0;e.vx=e.vy=e.vz=0;e.onGround=false;
 const route=e._mechaJet,b=G.stage?.bounds?.()||{xmin:-100,xmax:200,zmin:G.cfg.ZMIN,zmax:G.cfg.ZMAX};
 if(t<19){
  const left=G.U.clamp(route.target.x-4,b.xmin+.8,b.xmax-.8),k=t/19;
  e.x=G.U.lerp(route.home.x,left,k);e.y=Math.min(2.6,t*.14);return;
 }
 const u=t-19,pass=Math.min(2,Math.floor(u/27)),phase=Math.min(1,(u-pass*27)/22),z=G.U.clamp(route.target.z+(pass-1)*.8,b.zmin+.2,b.zmax-.2);
 const left=G.U.clamp(route.target.x-4,b.xmin+.8,b.xmax-.8),right=G.U.clamp(route.target.x+4,b.xmin+.8,b.xmax-.8);
 e.x=G.U.lerp(pass%2?right:left,pass%2?left:right,phase);e.z=z;
 e.y=Math.max(.30,2.3-Math.sin(phase*PI)*2);e.face=pass%2?-1:1;
 if(u%8===0&&u<76){
  G.fx?.burst?.('slash',e.x,e.y+.65,e.z,{color:'#d8a3f1',scale:2,dir:e.face});
  G.combat.area({owner:e,x:e.x,y:e.y,z:e.z,r:1.2,zr:.66,y0:-.15,y1:1.5,dmg:17,power:2,dur:2,fx:'slash',color:'#ce93e1'});
 }
 if(u%3===0)G.fx?.burst?.('flame',e.x-e.face*.6,e.y+.9,e.z,{color:'#b2eaff',scale:.5});
 if(t>=100)land(e);
}
const jetEvent=(at=14)=>({at,kind:'custom',frames:100,fn:jet});
const rocket=(at,angles=[0])=>shot(at,'mechaFist',angles,.35,19,{height:.8,radius:.25,returnAt:24,life:60});
const catalog={
 crusher:['#eeb7a7',[
  card('瓦礫砕きの二重拳','sweep',34,34,sweep(12,1,0,1.8,.68,'shock',21),sweep(32,1.5,0,1.5,.88,'shock',23)),
  card('装甲ブルドッグ突進','rush',35,40,dash(9,24,.21,1.3,'dustRing',22,{armor:true})),
  card('崩れる高架の瓦礫','cast',39,41,ring(17,-1.8,.6,1.15,.75,'dustRing',17),ring(30,1.8,-.6,1.15,.75,'dustRing',18)),
  card('地裂・四連掘削','sweep',45,51,...[-2,-.7,.7,2].map((x,i)=>ring(18+i*9,x,0,.85,1.1,'shock',20))),
  card('鋼拳・粉砕走破','rush',47,58,dash(9,20,.26,1.4,'shock',24,{armor:true}),rocket(36),sweep(57,0,0,2.4,1.3,'shock',26))]],
 artillery:['#c8d9ad',[
  card('組立ラインの擲弾砲','cast',33,37,grenade(10,[-.12,.12]),grenade(27)),
  card('コンベア逆走','rush',34,40,dash(8,17,.18,1.3,'dustRing',18,{back:true}),shot(31,'bolt',[-.08,0,.08],.29,14)),
  card('照準・三点砲撃','cast',39,44,ring(18,0,-1,1.0,.6,'shock',19),ring(33,0,1,1.0,.6,'shock',19),ring(48,0,0,1.4,.9,'shock',23)),
  card('全砲門・交差射撃','cast',45,53,grenade(13,[-.16,0,.16]),rocket(32,[-.09,.09]),grenade(52)),
  card('工場封鎖・弾幕回廊','cast',49,59,...[10,25,40,55].map((t,i)=>grenade(t,i%2?[-.15,.15]:[0])),sweep(73,0,0,2.1,1.2,'shock',25))]],
 interceptor:['#bfd1f5',[
  card('迎撃ドローンの扇状射撃','cast',30,32,shot(9,'bolt',[-.16,0,.16],.30,14),shot(24,'bolt',[-.08,.08],.35,16)),
  card('廃線・低空すれ違い','rush',35,40,dash(10,22,.25,1.24,'slash',21,{jump:.14})),
  card('踏切レーザー','cast',39,43,ring(18,0,-1.1,3.6,.28,'stars',20,2.5),ring(39,0,1.1,3.6,.28,'stars',20,2.5)),
  card('鉄路の包囲照射','cast',44,52,shot(13,'beam',[0],.32,20,{lane:-1.25}),shot(29,'beam',[0],.32,20,{lane:1.25}),ring(51,0,0,1.2,.9,'shock',23)),
  card('軌道突破・ジェット旋回','spin',49,57,jetEvent(13),sweep(119,0,0,2.2,1.3,'shock',24))]],
 forgeWarden:['#ffc29b',[
  card('溶接アームの赤熱薙ぎ','sweep',34,37,sweep(16,1.2,0,2.0,.9,'flame',23,1.5)),
  card('炉口の三重放熱','cast',38,43,ring(18,-1.7,0,.9,1.1,'flame',18,2),ring(31,0,0,.9,1.1,'flame',18,2),ring(44,1.7,0,.9,1.1,'flame',18,2)),
  card('保守ドッグ出撃','cast',34,45,{at:14,kind:'call',type:'mechaWelder',offsets:[-2,2]},grenade(33)),
  card('炉心過熱・赤熱十字','cast',47,54,ring(20,0,0,3.7,.34,'flame',23),ring(45,0,0,1.05,1.5,'flame',26,2)),
  card('大溶鉱炉・鉄火乱舞','rush',48,58,dash(12,24,.22,1.4,'flame',23,{armor:true}),grenade(44,[-.16,0,.16]),sweep(65,0,0,2.5,1.4,'flame',27))]],
 mechaEmperor:['#d6a5f3',[
  card('義手解放・ロケットパンチ','cast',34,37,rocket(12),rocket(35,[-.08,.08])),
  card('グレネードランチャー乱射','cast',37,43,grenade(10,[-.16,0,.16]),grenade(27,[-.09,.09]),grenade(44,[-.16,0,.16])),
  card('装甲大帝・闇剣二連','sweep',34,36,sweep(14,1.5,-.6,2.3,.63,'slash',24,1.8),sweep(33,1,.6,2.3,.63,'slash',24,1.8)),
  card('ジェット・クルクル闇斬り','spin',52,61,jetEvent(16),
   ring(44,0,-.8,3.9,.34,'slash',12,1.3),ring(71,0,0,3.9,.34,'slash',12,1.3),ring(98,0,.8,3.9,.34,'slash',12,1.3),
   sweep(125,0,0,2.4,1.45,'shock',27)),
  card('終末機関・黒鉄の大号令','cast',49,60,rocket(10,[-.10,.10]),grenade(28,[-.17,0,.17]),{at:47,kind:'call',type:'mechaScout',offsets:[-2.2,2.2]},ring(68,0,0,2.4,1.3,'shock',27))]]
};
for(const [shape,[color,cards]]of Object.entries(catalog))G.roundMoves.register(shape,color,cards.slice(0,4),cards[4],shape==='forgeWarden'?'fire':shape==='interceptor'?'column':null);
const troops=[
 ['mechaScout','錆び耳スカウト','scout',43,'ranged'],
 ['mechaHound','巡回ハウンド','hound',48,'assault'],
 ['mechaGrenadier','擲弾ポチ','grenadier',46,'ranged'],
 ['mechaBulwark','鉄盾ブル','bulwark',65,'assault'],
 ['mechaDrone','プロペラわんこ','drone',39,'ranged'],
 ['mechaWelder','溶接テリア','welder',50,'assault']];
for(const [id,name,shape,hp,squad]of troops){
 const action=shape==='grenadier'?card('擲弾発射','cast',29,37,grenade(9)):
  shape==='scout'||shape==='drone'?card('警戒レーザー','cast',25,29,shot(9,'bolt',shape==='drone'?[-.09,.09]:[0],.26,10)):
  shape==='bulwark'?card('装甲タックル','rush',29,34,dash(8,17,.16,1.05,'shock',15,{armor:true})):
  shape==='welder'?card('溶接アーク','sweep',29,32,sweep(12,.8,0,1.12,.56,'flame',13,1.4)):
  card('鋼牙・飛びつき','rush',27,29,dash(8,14,.20,.95,'slash',13,{jump:.12}));
 G.roundMoves.register(shape,glow,[action,action,action,action],action);
 const move=G.roundMoves.make(shape,id)[0];
 F.define(id,{name,hp,spd:shape==='hound'?.066:.045,height:shape==='hound'?1.23:1.60,radius:.43,weight:1.3,
  armor:shape==='bulwark'?2:1,elite:shape==='bulwark'||shape==='grenadier',squad,
  build:()=>build(shape),ai(e){
   const p=H.target(e);if(!p){H.stop(e);return;}H.face(e,p);
   const reach=squad==='ranged'?5.4:2.05;
   if(Math.abs(e.x-p.x)>reach||Math.abs(e.z-p.z)>.6){H.walkTo(e,p.x-e.face*reach*.72,p.z);return;}
   H.stop(e);if(e.cool<=0&&H.token(e))H.attack(e,move,move.windup);
  },init(e){e.onInterrupt=()=>{land(e);G.roundMoves.marks(e,true);};},
  onKOTick(e){if(e._mechaJet)land(e);G.roundMoves.marks(e,true);}});
}
const stages=[
 ['錆び色の帰還路','廃都の門番クラッシャー','crusher',['mechaScout','mechaHound','mechaBulwark'],
  '戦国の門の向こうは、機械に覆われた未来の王国だった。壊れた装甲から、子犬たちの助けを求める声がする。',
  '門番の装甲がほどけ、子犬が飛び出した。捕らわれた仲間は、東の兵器工場へ運ばれたらしい。'],
 ['わんこ兵器工場','組立砲台アセンブラー','artillery',['mechaGrenadier','mechaScout','mechaWelder'],
  '工場は子犬たちを機械の兵士に変えている。コンベアを止め、組立砲台の制御装置を壊そう。',
  '生産ラインが止まり、子犬たちはチャムの待つ避難所へ。輸送列車の向かう先には巨大な溶鉱炉がある。'],
 ['断絶した磁気鉄道','迎撃機スカイドッグ','interceptor',['mechaDrone','mechaHound','mechaGrenadier'],
  'ちぎれた高架と磁気レールを渡り、炉心へ向かう。空では高速迎撃機が進路をふさいでいる。',
  '迎撃機を包む命令コードが消えた。黒犬士は大剣を担ぎ、仲間とともに溶鉱炉の扉を開く。'],
 ['赤熱する溶鉱炉','炉心番犬ヘファイスト','forgeWarden',['mechaWelder','mechaBulwark','mechaDrone'],
  '機械城を動かす炉心が暴走している。火の筋を見切り、炉心番犬の溶接アームを止めよう。',
  '炉心が静まり、中央の機械城へ道がつながった。義手を鳴らし、メカ・ダークワンワン大帝が待ち構える。'],
 ['終末機関の王座','メカ・ダークワンワン大帝','mechaEmperor',['mechaBulwark','mechaGrenadier','mechaScout'],
  '機械大帝がジェットパックを起動した。闇の命令を断ち切り、最後の一匹まで連れて帰ろう。',
  '大帝の装甲に朝日が差し、最後の子犬が笑顔を見せた。荒れた王国に、みんなで小さな花を植えよう。']];
for(const [index,[name,bossName,shape,ids,intro,epilogue]]of stages.entries()){
 const id='lap6Boss'+(index+1),moves=G.roundMoves.make(shape,id),scale=shape==='mechaEmperor'?1.85:1.59;
 F.define(id,{name:bossName,boss:true,elite:true,hp:shape==='mechaEmperor'?960:650+index*55,spd:.058,height:scale*1.68,radius:.72,
  weight:2.6,poise:112,armor:2,score:2400,xp:105,roundMoves:moves,frenzyStyle:'mecha',frenzyColor:catalog[shape][0],
  build(e){const rig=build(shape,scale,scale*1.68),update=rig.update,dispose=rig.dispose;
   if(e){rig.update=ent=>{update(ent);G.roundMoves.marks(ent);};rig.dispose=()=>{land(e);G.roundMoves.marks(e,true);dispose();};}
   return rig;},
  init(e){e.onInterrupt=()=>{land(e);G.roundMoves.marks(e,true);};},
  onKOTick(e){if(e._mechaJet)land(e);G.roundMoves.marks(e,true);},
  ai(e){
   const p=H.target(e);if(!p){H.stop(e);return;}H.face(e,p);
   const rage=e._frenzyForm===(e.form||1),i=rage&&!e._mechaRaged?3:(e.roundMove||0)%(rage?5:3),move=moves[i];
   if(Math.abs(e.x-p.x)>move.reach||Math.abs(e.z-p.z)>move.lanes){H.walkTo(e,p.x-e.face*Math.min(2,move.reach*.7),p.z);return;}
   H.stop(e);
   if(e.cool<=0&&H.attack(e,move,rage?Math.round(move.windup*.86):move.windup)){
    e.roundMove=i+1;e._mechaRaged=rage;H.say(e,move.name+'！');
   }
  }});
 const theme=G.journeyScenery.theme(G.stage.THEMES.castle,'mecha',index),[a,b,c,arena]=theme.marks;
 G.stages.push({id:'lap6stage'+(index+1),no:G.stages.length+1,lap:6,chapter:index+1,region:'メカワンコ編',journeyStyle:'mecha',
  name,kana:name,intro,epilogue,length:arena+16,bgm:'stage'+(G.stages.length+1),theme,
  waves:[{at:a,width:16,foes:[[ids[0],2],[ids[1],1]]},{at:b,width:17,foes:[[ids[2],2],[ids[0],1]],reward:'bone'},
   {at:c,width:18,foes:[[ids[1],2],[ids[2],1]],then:[[ids[0],1]],reward:'coin'}],
  boss:{type:id,at:arena,x:arena},props:[],
  hints:[{at:8,name:'黒犬士',text:index===4?'噴射音が聞こえたら、光ったレーンの外へ。飛び終わりをねらえ。':'機械の中にも、助けを待つ仲間がいる。光る予告をよく見よう。'}]});
}
G.mechaCampaign={build,troops:troops.map(r=>r[0]),bosses:stages.map((_,i)=>'lap6Boss'+(i+1)),jet,land};
})();

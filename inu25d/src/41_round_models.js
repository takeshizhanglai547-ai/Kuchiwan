// Sculpted silhouettes for the second through fifth journeys. Coordinates face +X.
(function(){'use strict';
const G=window.G,T=window.THREE;
const ink='#4d3d59',cream='#fff2d7',gold='#f8ce79',mint='#a8e8dc',pink='#eda1bb',silver='#d8e6ef';
const cache=new Map();
function sculpt(draw){
 const g=G.look.geo,b=G.look.builder();
 const egg=(x,y,z,rx,ry,rz,c)=>b.add(g.sphere(1,16,10),c,[x,y,z],null,[rx,ry,rz]);
 const box=(x,y,z,a,h,d,c,tilt=0)=>b.add(g.rbox(a,h,d,Math.min(.06,Math.min(a,h,d)*.45),2),c,[x,y,z],[0,0,tilt]);
 const cone=(x,y,z,r,h,c,tilt=0)=>b.add(g.cone(r,h,10),c,[x,y,z],[0,0,tilt]);
 const disk=(x,y,z,r,h,c)=>b.add(g.cylinder(r,r,h,16),c,[x,y,z]);
 const rod=(x,y,z,X,Y,Z,r,c)=>{
  const p=new T.Vector3(x,y,z),q=new T.Vector3(X,Y,Z),delta=q.clone().sub(p);
  const quat=new T.Quaternion().setFromUnitVectors(new T.Vector3(0,1,0),delta.clone().normalize());
  b.add(g.cylinder(r,r,delta.length(),8),c,p.lerp(q,.5).toArray(),new T.Euler().setFromQuaternion(quat).toArray().slice(0,3));
 };
 function face(x,y,w,c,eyes=2){
  egg(x,y,0,w,w*.88,w*.98,c);
  for(const s of [-1,1]){
   const z=s*w*.51;
   egg(x+w*.82,y+w*.1,z,w*.12,w*.18,w*.13,ink);
   egg(x+w*.908,y+w*.16,z+w*.018,w*.045,w*.061,w*.050,'#fff');
   egg(x+w*.77,y-w*.22,z*1.37,w*.09,w*.10,w*.17,pink);
   if(eyes===4)egg(x+w*.78,y+w*.36,z*.68,w*.072,w*.086,w*.080,ink);
  }
  egg(x+w*.98,y-w*.18,0,w*.07,w*.045,w*.095,ink);
 }
 function legs(n,x,y,reach,c,back=.43){
  for(let i=0;i<n;i++)for(const s of [-1,1]){
   const d=(i-(n-1)/2)*.24;
   rod(x+d,y,s*.23,x+d*1.5,y+.15,s*reach,.052,c);
   rod(x+d*1.5,y+.15,s*reach,x+d*1.8-back*.3,.12,s*(reach+.14),.046,c);
   egg(x+d*1.8-back*.3,.10,s*(reach+.14),.088,.069,.084,c);
  }
 }
 function antenna(x,y,c){
  for(const s of [-1,1]){
   rod(x,y,s*.17,x+.12,y+.31,s*.26,.041,ink);
   egg(x+.12,y+.32,s*.26,.08,.077,.08,c);
  }
 }
 function wings(x,y,c,large=false){
  for(const s of [-1,1]){
   egg(x-.25,y+.27,s*.54,large?.55:.36,.13,large?.57:.38,c);
   egg(x-.49,y+.21,s*.51,.25,.11,.34,'#eaf8fe');
   rod(x-.02,y+.29,s*.23,x-.56,y+.3,s*.81,.025,'#c8afd5');
  }
 }
 const crest=(y,c)=>{disk(-.03,y,0,.31,.08,gold);for(const z of [-.19,0,.19])cone(-.03,y+.15,z,.093,.24,c);};
 function beetle(c,extra){
  legs(3,-.18,.43,.44,ink);egg(-.30,.60,0,.65,.44,.51,c);
  for(const z of [-.25,.25])egg(-.43,.73,z,.52,.27,.27,c);
  rod(-.88,.86,0,.08,.96,0,.025,ink);face(.33,.59,.28,cream);
  cone(.61,.69,-.15,.084,.43,gold,-1.25);cone(.61,.69,.15,.084,.43,gold,-1.25);
  if(extra){cone(.19,1.07,0,.14,.48,silver,-.24);crest(1.05,gold);}
 }
 function moth(c,royal){
  egg(-.18,.77,0,.56,.36,.37,c);
  for(const s of [-1,1]){
   egg(-.37,.94,s*.57,.51,.15,.69,c);
   egg(-.20,1.09,s*.76,.23,.036,.31,gold);
   egg(-.22,1.12,s*.76,.105,.027,.16,'#8469aa');
   egg(-.64,.92,s*.58,.31,.13,.43,'#bd94d9');
  }
  face(.20,.94,.33,cream);antenna(.12,1.16,c);
  if(royal)crest(1.40,pink);
 }
 function crab(c,royal){
  legs(3,-.05,.39,.47,'#97778d');egg(-.07,.52,0,.53,.40,.56,c);
  for(const s of [-1,1]){
   egg(.46,.52,s*.48,.28,.18,.23,c);
   cone(.68,.65,s*.55,.142,.27,c,-1.15);
   rod(.14,.71,s*.24,.29,.99,s*.26,.061,c);
   egg(.31,.98,s*.26,.12,.12,.11,cream);
   egg(.407,1.01,s*.26,.047,.070,.065,ink);
  }
  if(royal)crest(1.08,gold);
 }
 function robe(c,hood){
  cone(-.09,.47,0,.49,.80,c);disk(-.04,.32,0,.39,.10,c);
  face(.08,1.01,.37,cream);
  if(hood)egg(-.17,1.14,0,.34,.42,.43,c);
  box(.31,.67,0,.13,.12,.61,gold);
 }
 function fish(c,large){
  egg(-.10,.68,0,.63,.37,.33,c);
  cone(-.77,.67,0,.33,.42,c,Math.PI/2);
  cone(-.17,1,0,.19,.28,c);
  face(.38,.69,large?.34:.23,'#e6f3ef');
  for(const z of [-.33,.33])egg(-.21,.48,z,.31,.09,.21,mint);
 }
 const recipes={
  caterpillar(){for(let i=0;i<5;i++){egg(.08-i*.25,.41+Math.sin(i)*.06,0,.25,.29,.29,i%2?'#a5c987':'#c6dd91');for(const z of [-.21,.21])egg(.12-i*.25,.14,z,.11,.08,.09,'#f3be94');}face(.32,.52,.32,'#d5eaa7');antenna(.27,.73,pink);},
  mantis(){egg(-.39,.58,0,.48,.23,.28,'#79af81');legs(2,-.12,.54,.42,'#659477');egg(.13,.83,0,.20,.39,.22,'#a3c97f');face(.33,1.19,.34,'#bfe28d');antenna(.26,1.43,gold);for(const s of [-1,1]){rod(.20,.79,s*.22,.50,.94,s*.49,.08,'#6c9d75');cone(.62,1.01,s*.46,.13,.40,'#b9edd0',-.65);}},
  bee(){egg(-.13,.64,0,.55,.36,.37,'#efba62');for(const x of [-.47,-.22])egg(x,.64,0,.103,.35,.37,'#a17a72');wings(-.16,.67,'#cfebf3');face(.29,.70,.31,'#ffe098');antenna(.21,.91,gold);},
  spider(){legs(4,-.18,.47,.57,'#8c6baf');egg(-.51,.55,0,.47,.36,.47,'#a586c0');egg(-.41,.86,0,.22,.055,.23,pink);face(.19,.47,.33,'#b79acb',4);},
  beetle(){beetle('#886b9a',false);},
  ant(){legs(3,-.20,.48,.45,'#8b5f70');egg(-.64,.60,0,.35,.34,.34,'#b77c7f');egg(-.15,.5,0,.22,.21,.21,'#d49588');face(.30,.59,.30,'#d39a88');antenna(.28,.78,gold);},
  moth(){moth('#a99ad7',false);},
  scytheKnight(){recipes.mantis();box(.06,.89,0,.15,.38,.45,'#557e73');for(const s of [-1,1]){cone(.68,1.17,s*.62,.155,.61,silver,-.75);egg(.12,.95,s*.29,.24,.16,.24,gold);}},
  queenBee(){recipes.bee();wings(-.32,.89,'#d2dafa',true);crest(1.19,gold);egg(-.47,.55,0,.47,.42,.46,'#e6ab58');for(const x of [-.67,-.43])egg(x,.57,0,.083,.40,.45,'#8f6869');},
  arachne(){legs(4,-.17,.52,.67,'#69557c');egg(-.64,.66,0,.61,.48,.53,'#7f699f');egg(-.58,1.08,0,.26,.058,.25,pink);robe('#ad7daf',true);for(const z of [-.33,.33])egg(.16,.79,z,.15,.20,.14,'#e2b1d1');},
  stag(){beetle('#667095',true);for(const s of [-1,1]){rod(.37,.63,s*.28,.86,.83,s*.53,.10,'#969dc0');rod(.86,.83,s*.53,1.02,1.00,s*.22,.08,silver);cone(.70,.97,s*.35,.075,.21,gold,-.6);}},
  mothQueen(){moth('#bb98de',true);for(const s of [-1,1]){egg(-.56,1.14,s*.81,.45,.16,.52,'#f9aebf');egg(-.68,1.28,s*.92,.20,.045,.20,'#fff0b5');}egg(.02,.56,0,.23,.29,.32,'#f5dc9f');},
  alien(){egg(-.09,.50,0,.25,.44,.28,'#88bea7');face(.09,1.03,.43,'#b4e5bc');for(const s of [-1,1]){egg(-.04,.14,s*.21,.22,.12,.13,'#79aaa2');egg(.39,1.06,s*.29,.073,.17,.10,ink);}antenna(-.05,1.31,mint);},
  rover(){box(-.12,.49,0,.66,.56,.61,'#868cc9');box(.06,.77,0,.43,.28,.52,'#c5c9ef');egg(.31,.78,0,.09,.09,.23,ink);egg(.39,.78,0,.022,.046,.10,mint);for(const z of [-.32,.32]){egg(-.20,.22,z,.32,.22,.10,'#666786');egg(.10,.22,z,.18,.18,.11,'#afb9d4');}},
  saucer(){disk(-.05,.48,0,.65,.11,'#9c92c8');egg(-.05,.51,0,.65,.15,.65,silver);face(.01,.73,.24,'#b9ecbe');egg(-.04,.71,0,.42,.13,.41,'#c6eaf0');for(let i=0;i<8;i++){const a=i*Math.PI/4;egg(.51*Math.cos(a),.49,.51*Math.sin(a),.07,.06,.07,mint);}},
  blob(){egg(-.09,.52,0,.48,.48,.43,'#a8c8ef');face(.18,.65,.30,'#d3c3ed');for(const [x,z] of [[-.4,.34],[-.3,-.4],[.22,.40]])egg(x,.22,z,.23,.17,.21,'#a7b8e9');},
  greyKing(){recipes.alien();cone(-.19,.43,0,.53,.78,'#8278b5');crest(1.56,mint);for(const z of [-.52,.52])egg(-.27,.72,z,.29,.13,.28,'#aac1ed');},
  mothership(){recipes.saucer();egg(-.21,.45,0,.88,.13,.86,'#8d7ebd');for(const z of [-.63,.63])egg(-.30,.51,z,.39,.16,.36,'#9cc7e4');disk(-.18,.29,0,.37,.11,'#b9f8e7');},
  bioCore(){recipes.blob();egg(-.44,.84,0,.45,.48,.49,'#93b7e1');egg(-.38,1.13,0,.24,.26,.29,'#d1b1ec');for(const s of [-1,1]){egg(-.39,.45,s*.53,.33,.25,.27,'#aecaf1');egg(-.23,.56,s*.47,.12,.06,.12,mint);}},
  starEmperor(){recipes.rover();face(.06,1.11,.37,'#d8d0ee');crest(1.42,silver);for(const s of [-1,1]){box(-.25,.62,s*.53,.61,.21,.35,'#7776b3');cone(-.49,1.04,s*.50,.22,.42,'#b3d7ed',-.27);egg(.05,.67,s*.68,.29,.19,.16,'#dcb0e1');}egg(.43,.51,0,.11,.15,.20,mint);},
  jelly(){egg(-.13,.81,0,.46,.37,.45,'#c4b1e8');face(.13,.74,.27,'#dad0ed');for(const z of [-.32,-.13,.13,.32])egg(-.18,.40,z,.09,.34,.09,z>.1?'#d6a9db':'#a5c6e8');},
  hoplite(){robe('#95c3b3',false);disk(-.04,1.24,0,.31,.10,gold);egg(.37,.50,.30,.105,.35,.36,'#d3a96f');rod(.37,.22,-.31,.59,1.48,-.31,.041,'#8f7a88');cone(.58,1.55,-.31,.09,.24,silver,-.15);},
  shark(){fish('#8cc8d8',false);},
  tideCrab(){crab('#eea2a9',false);},
  zeus(){
   robe('#dceaf5',false);
   for(const z of [-.48,0,.48])egg(-.21,.25,z,.56,.20,.36,'#dbe9ef');
   for(const z of [-.24,-.12,0,.12,.24])egg(.29,.81-Math.cos(z*5)*.13,z,.22,.19,.12,'#fff9e8');
   for(const z of [-.35,.35])egg(-.10,1.17,z,.26,.23,.16,silver);
   disk(-.06,1.37,0,.29,.085,gold);
   rod(.42,.35,.49,.64,.74,.49,.07,gold);rod(.64,.74,.49,.43,.69,.49,.07,gold);rod(.43,.69,.49,.81,1.41,.49,.083,gold);
  },
  poseidon(){
   egg(-.38,.51,0,.77,.31,.39,'#70aeb4');egg(-.58,.65,0,.47,.29,.34,'#7bbfc2');
   for(const z of [-.31,.31])egg(-1.08,.68,z,.36,.08,.24,mint);
   egg(.01,.84,0,.37,.41,.34,'#83cfc4');face(.14,1.16,.37,'#e3f1d8');
   for(const z of [-.29,.29]){egg(-.02,1.03,z,.32,.30,.14,'#56a7a7');cone(-.04,1.48,z,.14,.38,'#7ccec3',.24);}
   disk(-.02,1.44,0,.32,.09,gold);egg(.23,1.52,0,.12,.14,.17,'#68b8be');
   rod(.43,.18,.52,.49,1.55,.52,.053,'#b78976');
   for(const z of [.34,.52,.70]){rod(.49,1.21,z,.49,1.63,z,.043,gold);cone(.49,1.67,z,.065,.20,gold);}
  },
  hades(){robe('#605576',true);for(const s of [-1,1]){cone(-.12,1.39,s*.32,.12,.40,'#ae9acc',s*.2);egg(-.3,.29,s*.31,.41,.18,.25,'#7d6b9c');}rod(.37,.15,.46,.49,1.45,.46,.052,ink);for(const z of [.33,.59])cone(.49,1.48,z,.08,.43,mint);},
  banner(){warrior('#a67d98','banner');},
  matchlock(){warrior('#9d8fa6','gun');},
  helmet(){warrior('#a38b77','shield');},
  ninja(){robe('#796d99',true);box(.34,1.02,0,.08,.11,.54,'#867699');for(const z of [-.27,.27])cone(.38,.60,z,.108,.32,silver,-1.0);},
  horse(){mount('#d7b394');warrior('#ac798e','spear',.61);},
  nobunaga(){
   warrior('#8c586a','blade',0,'horns');
   for(const z of [-.48,.48]){egg(-.26,.77,z,.37,.29,.18,'#765065');cone(-.31,1.04,z,.15,.40,'#c56d82',.36);}
   box(-.51,.62,0,.15,1.04,.71,'#a85272',-.26);
   egg(-.21,1.39,0,.26,.19,.33,'#7b5066');
  },
  hideyoshi(){warrior('#d4a557','fan',0,'sun');},
  ieyasu(){warrior('#86a78c','shield',0,'leaf');disk(-.04,.25,0,.52,.15,'#947d72');},
  yoshimoto(){warrior('#af93c4','bow',.34,'court');box(-.14,.31,0,.98,.26,.84,gold);for(const z of [-.43,.43])rod(-.84,.23,z,.83,.23,z,.057,'#906782');},
  kenshin(){robe('#d9d4df',true);box(.26,.58,0,.21,.16,.62,'#857a9a');blade(.63,.91,.41);},
  shingen(){warrior('#b66b71','fan',0,'fur');for(const z of [-.40,.40])egg(-.26,.68,z,.30,.22,.24,'#e5bc8b');},
  masamune(){warrior('#7086b1','gun',0,'moon');egg(.389,1.04,.19,.047,.095,.103,'#65566e');},
  yukimura(){mount('#d9a189');warrior('#c66d79','spear',.59,'coins');},
  motonari(){warrior('#9faa71','bow',0,'arrows');},
  ujiyasu(){warrior('#9e977a','shield',0,'antlers');},
  yoshihiro(){
   warrior('#ad7b87','hammer');
   egg(-.28,.54,0,.47,.48,.59,'#8c576e');
   for(const z of [-.50,.50]){
    egg(-.06,.66,z,.33,.25,.24,'#c38786');
    rod(-.11,1.34,z*.67,-.30,1.64,z,.085,'#9e6c80');
    cone(-.39,1.68,z,.12,.28,cream,.64);
   }
   box(.58,1.21,.43,.46,.33,.35,'#83718e');disk(.57,1.21,.43,.09,.35,gold);
  }
 };
 function blade(x,y,z){rod(x-.22,y-.26,z,x,y,z,.045,ink);box(x+.14,y+.19,z,.16,.52,.045,silver,-.6);}
 function mount(c){
  egg(-.10,.42,0,.68,.32,.36,c);
  face(.62,.65,.25,'#ebc6a4');cone(.51,.91,-.12,.10,.22,c);cone(.51,.91,.12,.10,.22,c);
  for(const x of [-.53,.32])for(const z of [-.24,.24])rod(x,.32,z,x+.06,.10,z,.071,'#936f74');
  box(-.16,.67,0,.49,.11,.69,'#d697a3');
 }
 function warrior(c,gear,lift=0,crestType='plain'){
  const y=lift;
  for(const s of [-1,1])egg(.03,y+.15,s*.19,.22,.13,.16,c);
  egg(-.13,y+.52,0,.39,.41,.45,c);
  for(let i=0;i<3;i++)box(.11,y+.36+i*.11,0,.26,.087,.64,i===0?gold:c);
  face(.06,y+1,.37,cream);egg(-.015,y+1.21,0,.43,.22,.41,c);disk(.03,y+1.18,0,.42,.075,'#77657d');
  const crown=y+1.39;
  if(crestType==='sun'||crestType==='moon'){
   egg(.14,crown,0,.085,.19,.25,gold);if(crestType==='moon')egg(.17,crown+.09,0,.09,.145,.20,c);
  }else if(crestType==='horns'||crestType==='antlers'||crestType==='arrows'){
   for(const s of [-1,1]){rod(.0,crown,s*.20,-.17,crown+.32,s*.32,.055,gold);cone(-.19,crown+.40,s*.32,.074,.24,gold,.22);}
  }else if(crestType==='coins'){
   for(const z of [-.15,0,.15])for(const dy of [-.015,.10])egg(.295,crown+dy,z,.039,.060,.058,gold);
  }else if(crestType==='fur'){
   for(const z of [-.35,-.18,0,.18,.35])egg(-.22,crown-.10,z,.25,.25,.17,silver);
  }else if(crestType==='court'){
   box(-.05,crown+.20,0,.27,.47,.27,'#76637e',.10);
  }else cone(.11,crown,0,.095,.24,gold,-.22);
  if(gear==='spear'||gear==='banner'){
   rod(-.24,y+.18,-.39,-.32,y+1.72,-.39,.045,'#8c7072');
   if(gear==='banner')box(-.57,y+1.44,-.39,.51,.43,.06,pink);
   else cone(-.32,y+1.78,-.39,.11,.27,silver);
  }else if(gear==='gun'){
   box(.47,y+.65,.40,.72,.14,.16,'#9b7782');box(.72,y+.71,.40,.36,.076,.091,ink);
  }else if(gear==='shield'){
   box(.39,y+.55,.32,.20,.67,.57,'#bb927e');box(.51,y+.55,.32,.045,.53,.43,gold);
  }else if(gear==='fan'){
   egg(.62,y+.76,.39,.31,.22,.075,gold);rod(.37,y+.47,.39,.67,y+.88,.39,.043,'#8f687a');
  }else if(gear==='bow'){
   for(const s of [-1,1])rod(.66,y+.65,.4,.49,y+.65+s*.43,.4,.047,gold);
   rod(.49,y+.22,.4,.49,y+1.08,.4,.019,cream);
  }else if(gear==='hammer'){
   rod(.39,y+.24,.42,.54,y+1.18,.42,.06,'#846378');box(.54,y+1.22,.42,.50,.32,.36,'#a9899a');
  }else blade(.67,y+.91,.39);
 }
 draw(recipes);
 const geometry=b.build();geometry.userData.shared=true;
 return geometry;
}

G.roundModels={
 build(shape,scale,height){
  let geometry=cache.get(shape);
  if(!geometry){geometry=sculpt(recipes=>recipes[shape]());cache.set(shape,geometry);}
  const root=new T.Group(),body=new T.Group(),material=G.look.vmat({instance:true,rough:.76});
  const mesh=new T.Mesh(geometry,material);mesh.castShadow=true;body.add(mesh);root.add(body);body.scale.setScalar(scale);
  G.look.outline(mesh,.014);
  const floating=['bee','queenBee','moth','saucer','mothership','jelly','mothQueen'].includes(shape);
  return {root,height,radius:.43*scale,shape,update(e){
   const move=e.atk?.def,pose=move?.pose,frame=e.animT||0,side=e.face||1;
   const knocking=e.dead||e.state==='down';
   body.rotation.y=(side<0?Math.PI:0)+(pose==='spin'?e.atk.t/Math.max(1,move.len-1)*2*Math.PI:0);
   const tilt=e.pending?-.145:pose==='sweep'?Math.sin(frame*.23)*.24:pose==='rush'?.19:pose==='cast'?-.10:0;
   body.rotation.z=side*(knocking?-1.1:tilt);
   body.position.y=knocking?0:floating?.13+Math.sin(frame*.15)*.092:e.state==='move'?Math.abs(Math.sin(frame*.29))*.085:0;
   material.userData.uFlash.value=e.flashT>0?.7:e.armorHitsLeft>0&&(e.pending||e.atk)?.20:0;
  },setAlpha(a){material.transparent=a<1;material.opacity=a;},dispose(){material.dispose();}};
 }
};
})();

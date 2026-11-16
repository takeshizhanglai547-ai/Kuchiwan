// Sculpted silhouettes for the second through fifth journeys. Coordinates face +X.
(function(){'use strict';
const G=window.G,T=window.THREE;
const ink='#4d3d59',cream='#fff2d7',gold='#f8ce79',mint='#a8e8dc',pink='#eda1bb',silver='#d8e6ef';
const cache=new Map();
function sculpt(shape){
 const g=G.look.geo,b=G.look.builder(),parts=[];
 function piece(role,pivot,draw,parent=null){
  const start=b.parts.length;draw();
  const pieces=b.parts.splice(start),builder=G.look.builder();
  const toPivot=new T.Matrix4().makeTranslation(-pivot[0],-pivot[1],-pivot[2]);
  for(const part of pieces)builder.addMatrix(part.g,part.color,toPivot.clone().multiply(part.m));
  const geometry=builder.empty?null:builder.build();
  if(geometry)geometry.userData.shared=true;
  const node={role,pivot,geometry,parent};parts.push(node);return node;
 }
 let faces=0;
 const egg=(x,y,z,rx,ry,rz,c)=>b.add(g.sphere(1,16,10),c,[x,y,z],null,[rx,ry,rz]);
 const box=(x,y,z,a,h,d,c,tilt=0)=>b.add(g.rbox(a,h,d,Math.min(.06,Math.min(a,h,d)*.45),2),c,[x,y,z],[0,0,tilt]);
 const cone=(x,y,z,r,h,c,tilt=0)=>b.add(g.cone(r,h,10),c,[x,y,z],[0,0,tilt]);
 const disk=(x,y,z,r,h,c)=>b.add(g.cylinder(r,r,h,20),c,[x,y,z]);
 const rim=(x,y,z,r,w,c,rot)=>b.add(g.torus(r,w,7,24),c,[x,y,z],rot);
 function studs(x,y,z,n,step,color){
  for(let i=0;i<n;i++)egg(x+(i-(n-1)/2)*step,y,z,.035,.032,.028,color);
 }
 const rod=(x,y,z,X,Y,Z,r,c)=>{
  const p=new T.Vector3(x,y,z),q=new T.Vector3(X,Y,Z),delta=q.clone().sub(p);
  const quat=new T.Quaternion().setFromUnitVectors(new T.Vector3(0,1,0),delta.clone().normalize());
  b.add(g.cylinder(r,r,delta.length(),8),c,p.lerp(q,.5).toArray(),new T.Euler().setFromQuaternion(quat).toArray().slice(0,3));
 };
 const forms=G.roundForms;
 const plate=(kind,color,x,y,z,scale,rot)=>b.add(forms.plate(kind),color,[x,y,z],rot,scale);
 const taper=(color,positions,radii,steps,sides)=>b.add(forms.curve(positions,radii,steps,sides),color);
 const band=(color,points,r=.025)=>taper(color,points,[[r,r],[r,r]],8,7);
 const yRing=[Math.PI/2,0,0],xRing=[0,Math.PI/2,0];
 const loft=(key,color,x,y,z,profile,scale)=>b.add(g.lathe('round-'+key,profile,24),color,[x,y,z],null,scale);
 const stern=new Set(['stag','greyKing','starEmperor','hades','nobunaga','shingen','masamune','yoshihiro']);
 function expression(id,x,y,w,eyes){
  const robot=shape==='rover'||shape==='starEmperor';
  const style=stern.has(shape)||robot||shape==='shark'?'yellow':'dot';
  const size=w*(eyes===4?.252:robot?.308:.292);
  const specs={c:[0,0,0],r:[w*1.041,w*.88,w*1.057],az:.78,el:.19,size,style,tilt:.39,
   eyeColor:shape==='rover'?mint:shape==='shark'?'#b6ede8':undefined,
   mouth:robot?'line':'bow',mouthEl:-.32,mouthO:{el:-.36},dropAz:1.01,dropEl:.37,regional:true};
  const set=G.foes.expressionMeshes(shape+'-'+id,specs);
  for(const [role,geometry] of [['idle',set.neutral],['focus',set.angry],['hurt',set.squeeze],['ko',set.x]]){
   parts.push({role,geometry,parent:id,pivot:[x,y,0]});
  }
 }
 function face(x,y,w,c,eyes=2){
  const id='face'+(++faces),machine=shape==='rover'||shape==='starEmperor';
  piece(id,[x,y,0],()=>{
   b.add(forms.plush,c,[x,y,0],null,[w,w*.88,w*.98]);
   if(!machine){
    for(const side of [-1,1]){
     egg(x+w*.36,y-w*.29,side*w*.755,w*.435,w*.315,w*.238,c);
     egg(x+w*.574,y-w*.22,side*w*.814,w*.088,w*.083,w*.113,'#ef9cab');
     for(let stripe=0;stripe<3;stripe++){
      const z=side*w*(.861+stripe*.019),X=x+w*(.541+stripe*.035);
      rod(X,y-w*.253,z,X+w*.024,y-w*.183,z+side*w*.010,w*.013,'#ffcfcc');
     }
    }
    const muzzle=eyes===4?'#e3c6e4':'#fff3dd';
    for(const side of [-1,1])egg(x+w*.850,y-w*.20,side*w*.12,w*.112,w*.139,w*.205,muzzle);
    egg(x+w*.966,y-w*.117,0,w*.039,w*.054,w*.083,ink);
    egg(x+w*1.004,y-w*.086,-w*.023,w*.014,w*.013,w*.026,'#f7dae3');
    if(shape==='shark')for(const s of [-1,1]){
     band('#557381',[[x+w*.91,y-w*.39,s*w*.31],[x+w*.765,y-w*.48,s*w*.515],[x+w*.564,y-w*.36,s*w*.735]],.013);
     for(const i of [0,1])cone(x+w*(.815-i*.19),y-w*(.39-i*.015),s*w*(.47+i*.206),.028,.069,'#fffbea',.16);
    }
   }
   if(shape==='masamune'){
    band('#54455e',[[x+w*.83,y+w*.16,w*.55],[x+w*.61,y+w*.30,w*.71],[x+w*.21,y+w*.54,w*.85]],.018);
    egg(x+w*.77,y+w*.11,w*.73,.098,.096,.061,'#51445d');
    egg(x+w*.81,y+w*.145,w*.865,.053,.038,.021,'#756785');
   }
   if(eyes===4)for(const side of [-1,1]){
    egg(x+w*.72,y+w*.35,side*w*.48,w*.084,w*.088,w*.087,ink);
    egg(x+w*.79,y+w*.385,side*w*.49,w*.022,w*.024,w*.024,cream);
   }
  });
  expression(id,x,y,w,eyes);
 }
 function legs(n,x,y,reach,c,back=.43){
  for(const s of [-1,1])for(let i=0;i<n;i++){
   const d=(i-(n-1)/2)*.24,kx=x+d*(n===4?1.85:1.5),kz=s*(reach-Math.abs(d)*.25);
   piece('leg'+s,[x+d,y,s*.23],()=>{
    const px=x+d*2-back*.3,pz=s*(reach+.14);
    egg(x+d,y,s*.27,.10,.10,.12,c);
    taper(c,[[x+d,y,s*.24],[kx,y+.15,kz],[px,.11,pz]],[[.072,.072],[.057,.06],[.039,.042]],9);
    egg(kx,y+.126,kz,.060,.057,.067,c);
    egg(px+.031,.094,pz,.103,.067,.084,c);
    egg(px+.075,.097,pz+s*.041,.039,.038,.042,'#dabcce');
   });
  }
 }
 function antenna(x,y,c){
  for(const s of [-1,1]){
   piece('antenna'+s,[x,y,s*.17],()=>{
    taper(ink,[[x,y,s*.17],[x-.06,y+.19,s*.20],[x+.099,y+.33,s*.285]],[[.047,.05],[.031,.032],[.020,.021]],8);
    egg(x+.106,y+.34,s*.29,.077,.074,.072,c);
    egg(x+.137,y+.367,s*.324,.035,.024,.024,cream);
   });
  }
 }
 function wings(x,y,c,large=false){
  for(const s of [-1,1])piece('wing'+s,[x-.14,y+.23,s*.19],()=>{
   const n=large?1.23:1,rot=[s*.63,s*.48,-.32];
   plate('wing','#9eacca',x-.34,y+.32,s*.51,[.51*n,.48*n,.33],rot);
   plate('wing',c,x-.36,y+.36,s*.53,[.44*n,.43*n,.28],rot);
   plate('wing','#edf8ff',x-.44,y+.417,s*.62,[.30*n,.26*n,.17],rot);
   band('#bdadd6',[[x-.02,y+.32,s*.26],[x-.23,y+.45,s*.49],[x-.63,y+.51,s*.77]],.018);
   band('#e9dff6',[[x-.19,y+.397,s*.43],[x-.36,y+.47,s*.51],[x-.51,y+.43,s*.47]],.013);
  });
 }
 const crest=(y,c)=>{disk(-.03,y,0,.31,.08,gold);for(const z of [-.19,0,.19])cone(-.03,y+.15,z,.093,.24,c);};
 function beetle(c,extra){
  legs(3,-.18,.43,.44,ink);egg(-.30,.55,0,.64,.38,.48,'#5e4b67');
  for(const s of [-1,1]){
   const z=s*.245,edge=extra?'#9faccb':'#be9cc2';
   taper(c,[[-.93,.53,z*.53],[-.62,.68,z],[-.22,.69,z], [.14,.58,z*.68]],[[.064,.060],[.33,.27],[.31,.26],[.069,.067]],13,14);
   plate('shell',edge,-.48,.75,s*.437,[.47,.42,.33],[s*.18,0,.08]);
   plate('shell',c,-.49,.77,s*.466,[.39,.35,.30],[s*.18,0,.08]);
   band(edge,[[-.81,.70,s*.33],[-.63,.886,s*.38],[-.32,.91,s*.40],[-.12,.78,s*.36]],.023);
   studs(-.38,.67,s*.512,3,.13,gold);
   taper(gold,[[.34,.51,s*.19],[.57,.63,s*.20],[.71,.72,s*.12]],[[.092,.092],[.064,.060],[.012,.015]],9);
  }
  band(ink,[[-.87,.66,0],[-.65,.92,0],[-.27,1.0,0],[.10,.81,0]],.028);
  face(.33,.59,.28,cream);
  if(extra){plate('shell',gold,-.04,.97,0,[.31,.19,2.9],[Math.PI/2,0,.12]);plate('spear',silver,.16,1.1,0,[.25,.37,1.1],[0,0,-.36]);}
 }
 function moth(c,royal){
  taper(c,[[-.77,.63,0],[-.49,.75,0],[-.20,.86,0],[.10,.87,0]],[[.026,.038],[.23,.25],[.30,.36],[.11,.15]],12,14);
  for(const s of [-1,1])piece('wing'+s,[-.15,.86,s*.22],()=>{
   const n=royal?1.19:1,rot=[s*.65,s*.5,-.23],x=-.41,y=1.03,z=s*.62*n;
   plate('swallow','#785886',x-.15,y-.18,z*.87,[.58*n,.53*n,.53],rot);
   plate('swallow','#cf9cc9',x-.16,y-.139,z*.91,[.54*n,.49*n,.45],rot);
   plate('swallow',royal?'#805c9c':'#7866a0',x,y,z,[.67*n,.63*n,.47],rot);
   plate('swallow',c,x-.012,y+.044,z+s*.036,[.61*n,.56*n,.38],rot);
   egg(x-.22,y+.17,z+s*.19,.19*n,.155*n,.052,royal?'#ffcba6':gold);
   egg(x-.22,y+.17,z+s*.227,.117*n,.10*n,.033,royal?'#b2649d':'#8469aa');
   egg(x-.25,y+.202,z+s*.253,.045*n,.043*n,.015,cream);
   band('#efb9da',[[x+.22,y-.10,z*.60],[x-.13,y-.11,z+s*.14],[x-.44,y-.036,z+s*.274]],.026);
   for(const [dx,dy] of [[-.38,-.01],[-.28,-.07],[-.11,-.095]])egg(x+dx,y+dy,z+s*.23,.047,.029,.024,cream);
  });
  face(.20,.94,.33,cream);antenna(.12,1.16,c);
  if(royal){
   crest(1.40,pink);
   for(const s of [-1,1])plate('petal','#f2bfcb',.01,.72,s*.27,[.24,.18,.65],[s*.2,0,s*.27]);
  }
 }
 function crab(c){
  legs(3,-.05,.39,.47,'#97778d');
  loft('crab-shell',c,-.07,.4,0,[[0,-.16],[.26,-.16],[.45,-.10],[.55,.015],[.57,.13],[.51,.28],[.32,.44],[0,.46]],[.94,1,1.06]);
  for(const s of [-1,1]){
   piece('claw'+s,[.19,.48,s*.36],()=>{
    taper('#c57f95',[[.17,.47,s*.34],[.37,.46,s*.58],[.52,.58,s*.58]],[[.08,.083],[.102,.089],[.13,.113]],9);
    egg(.56,.59,s*.53,.192,.17,.168,c);
    for(const p of [-1,1])taper(p<0?'#db859a':'#f7b2aa',
     [[.53,.59,s*.53],[.70,.60+p*.094,s*.57],[.85,.61+p*.044,s*.53]],[[.136,.112],[.099,.078],[.018,.019]],10);
    egg(.55,.704,s*.625,.068,.025,.031,'#ffd6bb');
   });
   band('#ffc0af',[[-.47,.55,s*.397],[-.20,.59,s*.555],[.04,.57,s*.52]],.036);
   studs(-.22,.65,s*.498,3,.115,'#ffd5b9');
   taper(c,[[.14,.71,s*.24],[.21,.865,s*.31],[.30,.98,s*.26]],[[.08,.075],[.056,.05],[.052,.055]],8);
   egg(.31,.98,s*.26,.109,.108,.109,cream);
   egg(.407,1.01,s*.275,.035,.059,.060,ink);
   egg(.431,1.032,s*.297,.019,.020,.024,cream);
  }
  face(.21,.66,.214,c);
 }
 function robe(c,hood){
  loft('robe',c,-.09,.12,0,[[0,0],[.42,0],[.52,.055],[.50,.12],[.421,.25],[.33,.40],[.28,.55],[.28,.65],[.19,.76],[0,.79]]);
  rim(-.09,.20,0,.492,.030,'#c5a986',yRing);
  for(const s of [-1,1]){
   const edge=hood?'#a696b5':'#dadbc4';
   band(edge,[[.095,.21,s*.406],[.205,.38,s*.297],[.161,.55,s*.240],[.237,.70,s*.116]],.024);
   if(hood)plate('swallow',c,-.28,.57,s*.25,[.41,.44,1.09],[s*.46,0,-.64]);
  }
  face(.08,1.01,.37,cream);
  if(hood){
   egg(-.18,1.105,0,.35,.44,.42,c);
   for(const s of [-1,1])band('#b29fbb',[[-.11,1.50,0],[.055,1.35,s*.27],[.063,1.11,s*.383],[-.03,.87,s*.323]],.027);
  }
  rim(-.05,.641,0,.293,.040,hood?'#97759e':'#cead76',yRing);
  egg(.258,.642,0,.065,.079,.082,gold);
 }
 function fish(c){
  taper(c,[[-.80,.64,0],[-.47,.68,0],[-.07,.69,0],[.46,.66,0]],[[.053,.052],[.228,.227],[.363,.341],[.23,.24]],13,14);
  egg(-.08,.51,0,.52,.20,.305,'#d6eee3');
  piece('tail',[-.57,.65,0],()=>{
   plate('tail','#5b91b0',-.86,.67,0,[.25,.49,1.04],[0,0,Math.PI]);
   plate('tail',c,-.84,.68,.051,[.20,.413,.42],[0,0,Math.PI]);
   egg(-.69,.65,0,.22,.135,.117,c);
  });
  plate('spear','#659dae',-.23,.95,0,[.36,.37,1.22],[0,0,.53]);
  face(.38,.69,.266,'#e6f3ef');
  for(const s of [-1,1]){
   plate('leaf','#76b5c9',-.24,.49,s*.35,[.34,.20,.57],[s*.65,0,-.45]);
   for(const x of [.04,-.05,-.14])band('#47788d',[[x-.04,.63,s*.317],[x-.07,.70,s*.344],[x-.03,.77,s*.33]],.014);
  }
 }
 function mantisArmored(armored){
  const c=armored?'#63948c':'#8ab47d';
  taper(c,[[-.87,.48,0],[-.47,.56,0],[-.11,.70,0],[.13,.82,0]],[[.023,.032],[.22,.27],[.24,.24],[.164,.141]],11,13);
  legs(2,-.12,.54,.43,'#557f68');
  taper('#9fc582',[[.02,.52,0],[.10,.75,0],[.18,1.08,0]],[[.15,.155],[.208,.231],[.135,.169]],8);
  plate('cuirass',armored?'#48736f':'#b9d58b',.205,.84,0,[.24,.25,1.2],xRing);
  face(.33,1.19,.34,'#c9e89e');antenna(.26,1.43,gold);
  for(const s of [-1,1]){
   if(armored){plate('shell',gold,.11,.98,s*.315,[.24,.25,1.36],[s*.1,0,-.14]);plate('leaf','#6d9992',.01,1.035,s*.344,[.16,.16,.6],[s*.2,0,-.22]);}
   piece('claw'+s,[.20,.79,s*.24],()=>{
    taper(c,[[.20,.79,s*.24],[.32,.80,s*.37],[.53,.97,s*.48]],[[.10,.10],[.084,.081],[.065,.062]],9);
    egg(.53,.97,s*.49,.116,.092,.093,armored?gold:'#d5d991');
    const x=armored?.75:.671,y=armored?1.17:1.065,z=s*.49;
    plate('sickle',armored?'#789da9':'#577f73',x,y,z,[armored?.377:.281,armored?.268:.203,1.03],[0,0,.85]);
    plate('sickle',armored?silver:'#d9ecae',x+.012,y-.013,z+s*.076,[armored?.328:.24,armored?.236:.178,.52],[0,0,.85]);
   });
  }
 }
 function apiary(royal){
  const c=royal?'#eaaa63':'#f3ca75',base=royal?'#855968':'#886651';
  taper(c,[[-.92,.52,0],[-.63,.57,0],[-.29,.62,0],[.13,.67,0]],[[.051,.06],[.27,.31],[.365,.395],[.22,.235]],15,16);
  for(const [x,y,r] of [[-.60,.578,.274],[-.34,.615,.355],[-.11,.646,.329]]){
   rim(x,y,0,r,.039,base,xRing);
   rim(x+.035,y+.009,0,r*.986,.017,royal?'#f7c287':'#ffe39b',xRing);
  }
  if(royal){
   plate('cuirass',gold,.097,.81,0,[.297,.236,1.44],xRing);
   crest(1.23,gold);
  }
  taper(royal?'#8d6573':'#9d7560',[[-.82,.53,0],[-.99,.52,0],[-1.10,.59,0]],[[.10,.10],[.052,.057],[.006,.006]],7);
  wings(royal?-.27:-.16,royal?.83:.67,royal?'#d7d5ee':'#c0e6ec',royal);
  face(.28,.71,royal?.36:.31,'#ffe098');antenna(.22,.94,gold);
  for(const s of [-1,1])egg(.12,.37,s*.236,.13,.11,.11,base);
 }
 function arachnid(royal){
  const n=royal?1.22:1,c=royal?'#6e548e':'#a586c0';
  legs(4,-.21,.47*n,.54*n,royal?'#6b507d':'#8c689d');
  taper(c,[[-.99*n,.47,0],[-.71*n,.62*n,0],[-.42*n,.61*n,0],[-.03,.5,0]],[[.035,.045],[.32*n,.41*n],[.36*n,.47*n],[.16,.24]],13,16);
  for(const s of [-1,1]){
   band('#d2acd3',[[-.82*n,.68*n,s*.33*n],[-.59*n,.81*n,s*.38*n],[-.37*n,.81*n,s*.35*n]],.023);
   band('#bb96c9',[[-.69*n,.53*n,s*.45*n],[-.58*n,.75*n,s*.425*n],[-.46*n,.90*n,s*.26*n]],.020);
   egg(-.66*n,.66*n,s*.40*n,.105,.09,.034,'#efaecb');
   egg(-.61*n,.74*n,s*.413*n,.038,.035,.029,cream);
  }
  face(.19,royal?.96:.49,royal?.40:.33,royal?'#e6bedc':'#c6a6da',4);
  if(royal){
   egg(.01,.67,0,.31,.38,.38,'#90719a');
   plate('crest','#e5adc9',.245,.73,0,[.42,.25,1.9],xRing);
   for(const s of [-1,1]){
    plate('swallow','#a8699b',-.28,.61,s*.381,[.40,.31,.87],[s*.42,0,.11]);
    egg(.14,1.27,s*.204,.067,.10,.084,gold);
    band('#e1b3d1',[[-.21,1.10,s*.24],[-.20,1.34,s*.24],[.19,1.26,s*.17]],.027);
   }
   egg(.22,1.32,0,.064,.092,.084,'#fae1a5');
  }
 }
 function pilot(royal){
  const c=royal?'#8475b2':'#82baaa',n=royal?1.14:1;
  loft('flight-jacket',c,-.09,.12,0,[[0,0],[.22,0],[.31,.07],[.35,.19],[.30,.43],[.27,.55],[.21,.65],[0,.70]],[n,1,n]);
  face(.09,1.05,.43,royal?'#d2e6c8':'#b4e5bc');
  for(const s of [-1,1]){
   egg(-.011,.143,s*.214,.23,.123,.132,royal?'#7a5b93':'#629795');
   egg(.035,.17,s*.287,.15,.050,.063,royal?'#aa8bac':'#92ccbd');
   plate('shell',royal?'#c5a7da':'#a3d6c3',-.18,.69,s*.301,[.22,.14,1.52],[s*.23,0,.15]);
   band(royal?'#cfafdb':'#c4e4bb',[[.11,.27,s*.27],[.18,.44,s*.247],[.118,.61,s*.244]],.026);
   if(royal)plate('swallow','#6f5e99',-.37,.48,s*.30,[.36,.38,1.10],[s*.21,0,-.67]);
  }
  if(royal){crest(1.48,mint);egg(.095,1.58,0,.091,.167,.12,'#e5a4ca');}
  else antenna(-.05,1.30,mint);
  egg(.250,.537,0,.072,.128,.135,royal?'#e6cc99':'#447c78');
  egg(.310,.563,0,.030,.072,.080,royal?'#b9e9d5':'#c6e6c5');
 }
 function tank(royal){
  const n=royal?1.26:1,c=royal?'#7772ad':'#8186bf';
  plate('cuirass','#484969',-.12,.47,0,[.596*n,.40,5.2*n],[0,0,.04]);
  plate('cuirass',c,-.12,.51,0,[.561*n,.375,4.9*n],[0,0,.04]);
  for(const s of [-1,1]){
   const z=s*.379*n;
   piece('leg'+s,[-.22,.22,z],()=>{
    plate('strap','#55536b',-.18,.217,z,[.49*n,.245,1.91],[0,0,.035]);
    for(const x of [-.48,-.25,-.02,.21]){
     egg(x*n,.206,z+s*.116,.106,.108,.035,'#a5a7c3');
     egg(x*n,.206,z+s*.148,.052,.054,.022,royal?'#e2bd94':'#8fd7d3');
    }
   });
   plate('wing',royal?'#a59aca':'#aeb7d7',-.16,.60,z,[.48*n,.30,1.38],[s*.17,0,.05]);
   band('#d4c8e7',[[-.53*n,.67,z+s*.04],[-.19,.72,z+s*.055],[.19*n,.684,z+s*.06]],.027);
   if(royal){
    taper('#8577af',[[ -.72,.68,z],[-.42,.81,z],[.06,.80,z],[.32,.78,z]],[[.075,.09],[.20,.21],[.21,.19],[.14,.13]],12);
    rim(.319,.78,z,.128,.040,'#c8b9db',xRing);
    egg(.354,.78,z,.059,.089,.091,mint);
   }
  }
  const y=royal?1.10:.82,w=royal?.337:.273;
  egg(-.06,y,0,w*1.40,w,w*1.34,royal?'#8171aa':'#a7acd7');
  face(.15,y,w,'#63577c');
  band('#b7a7d6',[[.27,y+.13,-w*.83],[.19,y+w*.93,0],[.27,y+.13,w*.83]],.027);
  if(royal)crest(y+.27,silver);else antenna(-.20,y+.12,'#f5c789');
 }
 function saucer(royal){
  const n=royal?1.46:1,c=royal?'#8178ad':'#a4a9ce';
  loft('space-disc',c,-.06,.39,0,[[0,-.16],[.32,-.16],[.46,-.12],[.62,-.02],[.66,.047],[.641,.121],[.53,.18],[.35,.218],[0,.24]],[n,royal?1.39:1,n]);
  rim(-.06,.433,0,.645*n,.039,royal?'#bbb0d9':'#d5c2e7',yRing);
  rim(-.06,.52,0,.575*n,.022,'#e8e8f4',yRing);
  for(let i=0;i<(royal?12:8);i++){
   const a=i*Math.PI/(royal?6:4),x=-.06+Math.cos(a)*.63*n,z=Math.sin(a)*.63*n;
   egg(x,.464,z,.066,.052,.067,'#56577c');
   egg(x+Math.cos(a)*.047,.484,z+Math.sin(a)*.047,.040,.041,.047,i%2===0?'#a5f2dc':'#ffd59b');
  }
  face(.145,royal?.846:.73,royal?.34:.253,'#b9e9c8');
  egg(-.26,royal?.813:.71,0,royal?.48:.34,royal?.22:.17,royal?.42:.31,'#a8bddb');
  band('#e2e8f7',[[.227,.585,-.31*n],[-.045,.788,-.33*n],[-.414,.81,0],[-.045,.788,.33*n],[.227,.585,.31*n]],.027);
  if(royal)for(const s of [-1,1]){
   plate('wing','#9e8cbd',-.26,.58,s*.79,[.48,.29,2.32],[s*.45,s*.55,.17]);
   egg(-.36,.388,s*.80,.294,.13,.22,'#7e93b4');
   egg(-.42,.318,s*.82,.187,.071,.14,mint);
  }
 }
 function gel(royal){
  const n=royal?1.37:1;
  loft('gel',royal?'#8eafd6':'#a9c5eb',-.13,.12,0,[[0,0],[.39,0],[.48,.078],[.53,.20],[.49,.40],[.42,.61],[.29,.73],[.12,.79],[0,.80]],[n,n,n]);
  face(.21,.65*n,.30*n,royal?'#d3b6e5':'#e1cef1');
  for(const [x,z] of [[-.39,-.30],[-.42,.35],[.18,-.32],[.18,.34]]){
   egg(x*n,.229*n,z*n,.24*n,.152*n,.189*n,royal?'#ac9bcf':'#aec5e9');
   egg((x+.033)*n,.337*n,(z+Math.sign(z)*.078)*n,.093*n,.037*n,.052*n,'#daecf2');
  }
  if(royal)for(const s of [-1,1]){
   egg(-.22,.796,s*.45,.252,.26,.245,'#accde3');
   egg(-.18,.82,s*.613,.163,.178,.071,'#cac0ed');
   egg(-.15,.855,s*.666,.087,.109,.036,'#9e87c9');
   band('#bce8e4',[[-.51,.62,s*.525],[-.30,.55,s*.611],[.02,.67,s*.500]],.025);
  }
 }
 const recipes={
  caterpillar(){
   for(let i=4;i>=0;i--){
    const x=.086-i*.257,y=.40+Math.sin(i)*.065,n=1-i*.069;
    egg(x,y,0,.27,.307*n,.315*n,i%2?'#a3c180':'#bfd688');
    for(const s of [-1,1]){
     egg(x+.048,.136,s*.206*n,.111,.085,.10,'#f3be94');
     plate('leaf','#dce8a8',x-.012,y+.037,s*.304*n,[.088,.092,.42],[0,0,-.57]);
    }
   }
   face(.32,.56,.33,'#d9eca9');antenna(.27,.76,pink);
   for(const s of [-1,1])plate('leaf','#799f70',.21,.31,s*.260,[.215,.19,1],[0,s*.26,s*.43]);
  },
  mantis(){mantisArmored(false);},
  bee(){apiary(false);},
  spider(){arachnid(false);},
  beetle(){beetle('#886b9a',false);},
  ant(){
   legs(3,-.20,.48,.45,'#8b5f70');
   taper('#b47779',[[-1.02,.61,0],[-.74,.66,0],[-.51,.57,0],[-.15,.53,0]],[[.026,.04],[.32,.327],[.26,.28],[.10,.10]],13,13);
   egg(-.22,.505,0,.295,.235,.239,'#c6887d');face(.29,.62,.32,'#e6b19a');antenna(.27,.83,gold);
   for(const s of [-1,1]){
    band('#e5aa9f',[[-.80,.759,s*.207],[-.68,.82,s*.251],[-.53,.758,s*.275]],.022);
    taper('#a36371',[[.41,.49,s*.19],[.59,.485,s*.22],[.67,.52,s*.095]],[[.067,.066],[.049,.051],[.009,.010]],8);
   }
  },
  moth(){moth('#a99ad7',false);},
  scytheKnight(){mantisArmored(true);},
  queenBee(){apiary(true);},
  arachne(){arachnid(true);},
  stag(){
   beetle('#626a94',true);
   for(const s of [-1,1])piece('claw'+s,[.37,.63,s*.28],()=>{
    taper('#adb7d1',[[.37,.63,s*.28],[.62,.69,s*.43],[.87,.82,s*.51],[1.10,1.02,s*.24]],[[.135,.135],[.106,.108],[.069,.073],[.013,.013]],13);
    taper('#d1cadb',[[.71,.73,s*.46],[.78,.88,s*.39],[.81,.98,s*.29]],[[.076,.083],[.046,.047],[.010,.010]],8);
    band('#677398',[[.51,.67,s*.365],[.70,.735,s*.48],[.92,.88,s*.46]],.028);
   });
  },
  mothQueen(){moth('#bb98de',true);},
  alien(){pilot(false);},
  rover(){tank(false);},
  saucer(){saucer(false);},
  blob(){gel(false);},
  greyKing(){pilot(true);},
  mothership(){saucer(true);},
  bioCore(){gel(true);},
  starEmperor(){tank(true);},
  jelly(){
   loft('jelly-bell','#bfabdb',-.13,.66,0,[[0,-.10],[.29,-.12],[.445,-.068],[.51,.015],[.48,.16],[.40,.30],[.24,.42],[.11,.46],[0,.47]]);
   for(let i=0;i<10;i++){
    const a=i*Math.PI/5,x=Math.cos(a)*.437,z=Math.sin(a)*.437;
    egg(-.13+x,.634,z,.123,.071,.125,i%2===0?'#e8bedb':'#d7c1e4');
    if(i%2===0)egg(-.13+x*.94,.793,z*.97,.051,.036,.050,'#ece1f2');
   }
   face(.22,.74,.269,'#dad0ed');
   for(const z of [-.32,-.13,.13,.32]){
    piece('feel'+Math.sign(z),[-.18,.65,z],()=>{
     taper(z>.1?'#d6a9db':'#a5c6e8',[[-.18,.65,z],[-.264,.47,z],[-.107,.33,z*1.13],[-.22,.14,z*1.16]],[[.075,.075],[.064,.071],[.052,.055],[.019,.021]],13);
     egg(-.22,.154,z*1.16,.044,.068,.046,mint);
    });
   }
  },
  hoplite(){
   robe('#95c3b3',false);
   egg(-.002,1.261,0,.361,.144,.344,'#b4916f');
   plate('sickle','#e1ac9a',-.10,1.431,0,[.38,.228,1.54],[0,0,.11]);
   egg(.40,.50,.325,.080,.339,.317,'#91795f');
   plate('shield','#ccac75',.372,.51,.490,[.31,.34,1.1],[0,.35,.024]);
   rim(.407,.52,.54,.138,.026,'#edce8f',[0,.34,0]);
   egg(.406,.53,.578,.074,.075,.046,'#e7db9b');
   piece('weapon',[.47,.71,-.31],()=>{
    rod(.37,.22,-.31,.59,1.48,-.31,.040,'#796575');
    egg(.46,.70,-.31,.116,.096,.11,cream);
    plate('spear',silver,.591,1.533,-.31,[.225,.19,.55],[0,0,-.15]);
   });
  },
  shark(){fish('#8cc8d8');},
  tideCrab(){crab('#eea2a9');},
  zeus(){
   robe('#dceaf5',false);
   for(const z of [-.48,0,.48])egg(-.21,.25,z,.50,.17,.33,'#dbe9ef');
   for(const z of [-.22,-.11,0,.11,.22])egg(.29,.78-Math.cos(z*5)*.11,z,.191,.138,.100,'#fff9e8');
   for(const z of [-.30,.30])egg(-.205,1.12,z,.17,.173,.141,silver);
   for(const s of [-1,1])for(let i=0;i<4;i++){
    const a=(.8+i*.35)*s;
    plate('leaf',gold,-.06+Math.cos(a)*.28,1.355+i*.031,Math.sin(a)*.30,[.151,.125,.80],[0,-a,.57]);
   }
   piece('weapon',[.59,.71,.46],()=>{
    plate('bolt','#c18862',.737,.81,.49,[.414,.52,1.32],[0,0,-.08]);
    plate('bolt','#ffda82',.768,.83,.554,[.367,.47,.73],[0,0,-.08]);
    egg(.642,.632,.48,.134,.108,.129,'#fff0ce');
   });
  },
  poseidon(){
   taper('#58a1a8',[[-1.20,.75,0],[-.89,.48,0],[-.49,.43,0],[-.11,.64,0],[.01,1.03,0]],[[.06,.070],[.162,.204],[.30,.378],[.38,.345],[.22,.205]],17,16);
   piece('tail',[-.83,.62,0],()=>plate('tail','#9be1d3',-1.06,.75,0,[.38,.49,1.11],[.60,.10,Math.PI]));
   egg(-.35,.486,0,.53,.20,.323,'#94d8c9');face(.14,1.16,.37,'#eaf4d5');
   for(const s of [-1,1]){
    const z=s*.321;
    for(let i=0;i<4;i++)plate('shell',i%2===0?'#aadbce':'#62aeb0',-.70+i*.178,.465+(.045*i),z,[.176,.17,.60],[s*.34,0,.6]);
    plate('swallow','#72c2bd',-.09,1.04,z,[.32,.28,1.17],[s*.17,0,.55]);
    taper('#79cbbf',[[.10,1.075,z],[.231,.91,z*1.04],[.178,.79,z*.74]],[[.099,.101],[.077,.085],[.008,.009]],9);
   }
   crest(1.42,'#b7e8ce');egg(.278,1.50,0,.064,.100,.105,'#4a9fa9');
   piece('weapon',[.59,.82,.49],()=>{
    rod(.57,.17,.49,.69,1.55,.49,.048,'#9c796f');
    egg(.624,.82,.49,.115,.108,.121,'#a4dbc9');
    for(const s of [-1,1])taper(gold,[[.66,1.237,.49],[.68+s*.15,1.304,.49],[.70+s*.17,1.54,.49],[.71+s*.18,1.66,.49]],[[.049,.043],[.042,.048],[.043,.049],[.007,.008]],11);
    plate('spear','#ffe8a5',.69,1.595,.49,[.168,.225,.79],[0,0,-.035]);
   });
  },
  hades(){
   robe('#574a6b',true);
   for(const s of [-1,1]){
    taper('#a28abc',[[-.13,1.17,s*.32],[-.208,1.43,s*.40],[-.115,1.64,s*.37]],[[.117,.112],[.083,.079],[.008,.009]],10);
    plate('swallow','#796594',-.36,.37,s*.373,[.49,.30,1.3],[s*.23,0,-.34]);
   }
   egg(.266,.758,0,.066,.10,.107,'#413651');
   egg(.312,.77,0,.037,.073,.064,mint);
   piece('weapon',[.42,.67,.46],()=>{
    rod(.37,.15,.46,.49,1.37,.46,.052,ink);
    egg(.42,.67,.46,.115,.108,.115,'#ad9ab8');
    for(const s of [-1,1])taper(s<0?'#7bb2af':mint,[[.49,1.18,.46],[.49+s*.112,1.34,.46],[.49+s*.13,1.59,.46]],[[.076,.046],[.077,.050],[.006,.007]],10);
   });
  },
  banner(){warrior('#a67d98','banner');},
  matchlock(){warrior('#9d8fa6','gun');},
  helmet(){warrior('#a38b77','shield');},
  ninja(){
   robe('#6f6289',true);
   plate('crest','#9480a4',.355,.83,0,[.31,.16,1.03],xRing);
   for(const s of [-1,1]){
    plate('swallow','#9276a7',-.38,1.08,s*.27,[.34,.20,1.02],[s*.31,0,.45]);
    plate('spear',silver,.39,.58,s*.32,[.18,.18,.63],[0,0,-1.02]);
    egg(.296,.51,s*.313,.105,.099,.11,'#574b6d');
   }
  },
  horse(){mount('#d7b394');warrior('#ac798e','spear',.61);},
  nobunaga(){
   warrior('#654056','blade',0,'horns');
   for(const s of [-1,1]){
    plate('swallow','#a34d6e',-.42,.56,s*.365,[.52,.53,1.25],[s*.84,0,-.58]);
    plate('shell','#80485f',-.125,.767,s*.438,[.27,.29,1.26],[s*.28,0,-.45]);
    taper('#d98f9d',[[-.27,.83,s*.42],[-.30,1.02,s*.48],[-.41,1.16,s*.49]],[[.095,.107],[.077,.092],[.008,.009]],10);
   }
  },
  hideyoshi(){warrior('#d4a557','fan',0,'sun');},
  ieyasu(){
   warrior('#759578','shield',0,'leaf');
   for(const s of [-1,1])plate('cuirass','#a69b76',-.24,.26,s*.417,[.32,.29,1.21],[s*.23,0,.16]);
  },
  yoshimoto(){
   warrior('#aa88c3','bow',.34,'court');
   for(const s of [-1,1]){
    plate('strap','#745677',-.15,.332,s*.375,[.57,.27,1.12]);
    plate('strap','#d6aa77',-.15,.354,s*.435,[.53,.216,.85]);
    taper('#906782',[[-.91,.23,s*.473],[-.54,.245,s*.446],[.43,.247,s*.446],[.85,.266,s*.464]],[[.033,.039],[.056,.061],[.056,.061],[.026,.026]],12);
    for(const x of [-.55,.25])egg(x,.375,s*.501,.067,.079,.026,'#f7dea1');
   }
   box(-.14,.20,0,.980,.14,.84,'#84627e');
  },
  kenshin(){
   robe('#dbd6df',true);
   for(const s of [-1,1]){
    plate('swallow','#f1e6ec',-.29,1.13,s*.29,[.36,.28,1.02],[s*.26,0,.57]);
    plate('cuirass','#9688a7',.112,.54,s*.34,[.312,.19,1.13],[s*.22,0,-.32]);
   }
   piece('weapon',[.37,.64,.41],()=>blade(.63,.91,.41));
  },
  shingen(){
   warrior('#b66b71','fan',0,'fur');
   for(const s of [-1,1])for(let i=0;i<4;i++)egg(-.32+i*.076,.76-(i%2)*.095,s*(.39+i*.011),.162,.151,.148,i%2?'#e6c49d':'#f0d6b0');
  },
  masamune(){warrior('#657ca5','gun',0,'moon');},
  yukimura(){mount('#d9a189');warrior('#c66d79','spear',.59,'coins');},
  motonari(){warrior('#9faa71','bow',0,'arrows');},
  ujiyasu(){warrior('#9e977a','shield',0,'antlers');},
  yoshihiro(){
   warrior('#ad7b87','hammer');
   egg(-.27,.52,0,.49,.46,.54,'#87576c');
   for(const s of [-1,1]){
    plate('shell','#be8992',-.16,.69,s*.492,[.35,.30,1.43],[s*.29,0,-.32]);
    taper('#f2d29e',[[-.11,1.34,s*.36],[-.27,1.52,s*.45],[-.41,1.72,s*.47]],[[.111,.106],[.079,.081],[.009,.009]],10);
   }
  }
 };
 function blade(x,y,z){
  rod(x-.24,y-.27,z,x,y,z,.048,ink);
  egg(x-.18,y-.20,z,.118,.109,.108,'#e3c3a9');
  egg(x,y,z,.098,.059,.13,gold);
  plate('katana','#8298ab',x+.203,y+.271,z,[.245,.36,.55],[0,0,-.67]);
  plate('katana','#e9f0f3',x+.224,y+.28,z+.042,[.167,.344,.35],[0,0,-.67]);
 }
 function mount(c){
  taper(c,[[-.80,.40,0],[-.56,.46,0],[-.06,.46,0],[.48,.56,0]],[[.047,.063],[.31,.347],[.333,.365],[.237,.207]],14,14);
  face(.62,.69,.263,'#ebc6a4');
  taper('#a16e76',[[-.72,.53,0],[-.96,.49,0],[-1.04,.31,.047]],[[.078,.087],[.084,.089],[.011,.012]],9);
  for(const s of [-1,1]){
   egg(.515,.939,s*.145,.085,.143,.077,c);
   egg(.57,.960,s*.168,.040,.090,.042,'#e9aa9e');
   for(const x of [-.53,.30]){
    taper(c,[[x,.385,s*.245],[x+.037,.23,s*.265],[x+.094,.108,s*.28]],[[.112,.105],[.076,.081],[.061,.064]],8);
    egg(x+.111,.09,s*.28,.104,.069,.082,'#836172');
   }
   plate('strap','#af697e',-.20,.565,s*.357,[.38,.27,1.27],[s*.26,0,.03]);
   band(gold,[[.13,.55,s*.38],[-.16,.46,s*.407],[-.48,.52,s*.368]],.027);
   band('#98647a',[[.226,.62,s*.287],[.43,.65,s*.275],[.693,.59,s*.242]],.025);
  }
 }
 function warrior(c,gear,lift=0,crestType='plain'){
  const y=lift;
  const trim=crestType==='moon'?'#a8c3df':crestType==='coins'?'#f4c993':gold;
  for(const s of [-1,1])piece('leg'+s,[.03,y+.31,s*.19],()=>{
   egg(-.013,y+.237,s*.22,.197,.21,.160,c);
   egg(.079,y+.107,s*.22,.227,.104,.167,'#645169');
   plate('shell',c,.106,y+.133,s*.33,[.18,.11,.58]);
  });
  loft('armor',c,-.13,y+.17,0,[[0,0],[.32,0],[.42,.07],[.432,.20],[.38,.32],[.39,.52],[.31,.61],[0,.67]],[.95,1,1.11]);
  plate('cuirass','#69566b',.241,y+.55,0,[.34,.31,1.56],xRing);
  plate('cuirass',c,.288,y+.58,0,[.301,.285,1.18],xRing);
  egg(.366,y+.59,0,.049,.095,.103,trim);
  for(const s of [-1,1]){
   for(let i=0;i<3;i++){
    const n=1-i*.10,dy=y+.33+i*.116,z=s*(.365-i*.018);
    plate('cheek',i%2===0?c:'#6a546a',-.097,dy,z,[.32*n,.225,1.16],[s*.205,0,-.03]);
    studs(-.076,dy+.021,z+s*.083,3,.098,trim);
   }
   plate('shell',c,-.174,y+.743,s*.393,[.293,.295,1.53],[s*.36,0,.21]);
   band(trim,[[-.42,y+.738,s*.439],[-.24,y+.809,s*.473],[.048,y+.739,s*.455]],.024);
   egg(.16,y+.577,s*.335,.143,.149,.129,c);
  }
  face(.053,y+1.006,.373,cream);
  loft('kabuto',c,-.042,y+1.129,0,[[0,-.091],[.35,-.087],[.437,-.022],[.432,.073],[.386,.179],[.277,.256],[.14,.299],[0,.301]],[1,1,1.013]);
  rim(-.026,y+1.167,0,.405,.038,'#70576c',yRing);
  plate('crest',trim,.315,y+1.194,0,[.352,.076,1.05],xRing);
  for(const s of [-1,1]){
   for(let i=0;i<3;i++)plate('cheek',i%2?trim:c,-.166,y+1.086-i*.078,s*(.336+i*.032),[.265,.10,1.11],[s*.31,0,.18]);
  }
  const crown=y+1.39;
  if(crestType==='sun'){
   egg(.218,crown+.059,0,.091,.178,.195,gold);
   for(let i=0;i<9;i++){
    const a=(i-4)*.34,z=Math.sin(a),u=Math.cos(a);
    taper('#eab166',[[.188,crown+u*.10,z*.12],[.175,crown+u*.24,z*.26],[.173,crown+u*.39,z*.39]],[[.037,.056],[.027,.043],[.010,.017]],6);
   }
  }else if(crestType==='moon'){
   plate('sickle',gold,.219,crown+.111,0,[.393,.38,1.0],[0,Math.PI/2,0]);
  }else if(crestType==='horns'||crestType==='antlers'){
   for(const s of [-1,1]){
    taper(trim,[[.054,crown-.05,s*.22],[.009,crown+.15,s*.29],[-.095,crown+.32,s*.359],[-.215,crown+.48,s*.36]],[[.071,.091],[.064,.069],[.040,.048],[.009,.009]],11);
    if(crestType==='antlers')for(const h of [0,.13])
     taper('#c8ae86',[[.004,crown+.12+h,s*.29],[-.101,crown+.23+h,s*.39],[-.19,crown+.28+h,s*.49]],[[.045,.042],[.034,.038],[.007,.009]],7);
   }
  }else if(crestType==='arrows'){
   for(let i=0;i<3;i++){
    const z=(i-1)*.106;
    rod(-.46,y+.51,z,-.62+i*.055,y+1.41+i*.066,z,.032,'#88687a');
    plate('leaf','#d9c599',-.61+i*.055,y+1.405+i*.066,z,[.093,.092,.78],[0,0,1.06]);
   }
  }else if(crestType==='coins'){
   for(const z of [-.15,0,.15])for(const dy of [-.015,.10])egg(.295,crown+dy,z,.039,.060,.058,gold);
  }else if(crestType==='fur'){
   for(const z of [-.35,-.18,0,.18,.35])egg(-.22,crown-.10,z,.25,.25,.17,silver);
  }else if(crestType==='leaf'){
   for(const s of [-1,0,1])plate('leaf','#e0c77f',.256,crown+.10-Math.abs(s)*.042,s*.145,[.138,.16,.85],[0,Math.PI/2,1.24+s*.42]);
  }else if(crestType==='court'){
   taper('#655377',[[-.052,crown-.11,0],[-.074,crown+.12,0],[-.10,crown+.36,0]],[[.181,.178],[.145,.170],[.102,.099]],10);
   egg(.029,crown+.326,0,.119,.103,.136,'#8e7299');
  }else cone(.11,crown,0,.095,.24,gold,-.22);
  piece('weapon',[.23,y+.62,.36],()=>{
  if(gear==='spear'||gear==='banner'){
   rod(-.24,y+.18,-.39,-.32,y+1.72,-.39,.045,'#8c7072');
   if(gear==='banner'){
    plate('swallow','#986484',-.582,y+1.40,-.39,[.36,.47,1.06],[0,0,-.10]);
    plate('swallow',pink,-.584,y+1.425,-.445,[.316,.409,.63],[0,0,-.10]);
    blossom(-.576,y+1.426,-.501,.141,cream);
   }else{
    egg(-.275,y+.772,-.39,.106,.115,.102,cream);
    plate('spear',silver,-.323,y+1.791,-.39,[.255,.205,.72],[0,0,.06]);
   }
  }else if(gear==='gun'){
   plate('shell','#9a6e71',.421,y+.648,.42,[.409,.165,1.06],[0,0,.15]);
   rod(.304,y+.721,.423,.908,y+.769,.423,.050,'#61566e');
   for(const x of [.47,.78])rim(x,y+.727,.424,.056,.02,trim,xRing);
   rim(.896,y+.771,.423,.045,.023,silver,xRing);
   for(const x of [.277,.569])egg(x,y+.601,.418,.101,.093,.108,'#e9c5ab');
  }else if(gear==='shield'){
   egg(.303,y+.52,.374,.126,.116,.109,'#e9c5ab');
   plate('shield','#85685f',.39,y+.54,.509,[.335,.435,1.84],[0,.25,-.07]);
   plate('shield',trim,.41,y+.547,.584,[.301,.397,1.10],[0,.25,-.07]);
   plate('shield',c,.428,y+.55,.639,[.258,.334,.76],[0,.25,-.07]);
   rim(.436,y+.571,.696,.115,.025,trim,[0,.25,0]);
   for(const z of [.70,.725])egg(.441,y+.572,z,.071,.065,.025,'#f7dfa1');
  }else if(gear==='fan'){
   plate('fan','#966375',.606,y+.753,.425,[.331,.335,1.24],[0,0,-.31]);
   plate('fan',crestType==='fur'?'#e19b91':gold,.613,y+.758,.489,[.301,.31,.67],[0,0,-.31]);
   for(const dx of [-.19,-.09,0,.10,.20]){
    band('#b98c76',[[.553,y+.63,.541],[.605+dx*.46,y+.78,.54],[.654+dx,y+.944-Math.abs(dx)*.31,.538]],.012);
   }
   egg(.532,y+.584,.443,.106,.098,.100,'#eac6a7');
  }else if(gear==='bow'){
   taper('#bb8a69',[[.46,y+.18,.42],[.625,y+.36,.42],[.718,y+.615,.42],[.620,y+.895,.42],[.471,y+1.112,.42]],[[.024,.028],[.047,.049],[.057,.058],[.041,.044],[.023,.025]],16);
   rod(.46,y+.18,.42,.471,y+1.112,.42,.012,cream);
   egg(.690,y+.629,.411,.106,.107,.101,'#f1cba6');
  }else if(gear==='hammer'){
   rod(.39,y+.24,.42,.54,y+1.22,.42,.061,'#846378');
   egg(.467,y+.63,.425,.132,.131,.131,'#dbb299');
   taper('#8d748b',[[.26,y+1.235,.42],[.37,y+1.23,.42],[.63,y+1.23,.42],[.82,y+1.234,.42]],[[.111,.115],[.18,.188],[.196,.203],[.132,.141]],13);
   for(const x of [.349,.73])rim(x,y+1.23,.42,.155,.033,gold,xRing);
   studs(.548,y+1.248,.625,3,.083,'#e8c8a5');
  }else blade(.67,y+.91,.39);
  });
 }
 // Props sit on the silhouette and repeat on both sides of the belt camera.
 function pin(x,y,z,size,color,kind='star'){
  const s=size;
  const geometry=kind==='heart'?g.heart(.5,.1):g.star(.5,.42,.1);
  b.add(geometry,color,[x,y,z],[0,z<0?Math.PI:0,.12],[s,s,s]);
 }
 function blossom(x,y,z,size,color){
  for(let i=0;i<5;i++){
   const a=i*Math.PI*2/5;
   egg(x+Math.cos(a)*size*.58,y+Math.sin(a)*size*.56,z,size*.49,size*.32,size*.22,color);
  }
  egg(x,y,z+Math.sign(z)*size*.10,size*.32,size*.30,size*.26,gold);
 }
 const details={
  caterpillar(){for(const z of [-.30,.30])blossom(-.31,.58,z,.139,'#f9ef9a');},
  mantis(){for(const z of [-.31,.31]){egg(-.36,.70,z,.22,.057,.12,'#a9d891');rod(-.53,.69,z,-.26,.75,z,.013,'#e1f3af');}},
  bee(){for(const z of [-.31,.31])blossom(.13,.78,z,.121,'#f5a8b2');},
  spider(){for(const z of [-.43,.43])pin(-.54,.59,z,.24,'#e6bded','heart');},
  beetle(){for(const z of [-.33,.33])egg(-.50,.86,z,.22,.057,.09,'#c29dc6');},
  ant(){rod(.45,.23,.38,.63,1.05,.38,.032,'#846572');cone(.64,1.11,.38,.07,.22,'#f8da96',-.17);},
  moth(){for(const z of [-.59,.59])blossom(-.36,.97,z,.20,'#e2baff');},
  scytheKnight(){for(const z of [-.35,.35]){blossom(.12,1.01,z,.225,'#f8eab2');egg(-.23,.68,z,.28,.12,.087,'#6c9e76');}},
  queenBee(){for(const z of [-.41,.41])blossom(.09,1.02,z,.235,'#ffeec0');egg(-.93,.54,0,.18,.11,.17,'#a77c66');},
  arachne(){for(const z of [-.61,.61]){pin(-.62,.74,z,.31,'#efb8df');blossom(-.28,1.29,z*.57,.166,'#f6bbd6');}},
  stag(){for(const z of [-.45,.45]){pin(-.40,.80,z,.39,'#d0d9ef');egg(-.32,1.08,z*.63,.13,.11,.12,'#efc38f');}},
  mothQueen(){for(const z of [-.81,.81]){blossom(-.55,1.24,z,.21,'#fff2c8');pin(-.16,1.03,z*.56,.25,'#d799da','heart');}},
  alien(){for(const z of [-.23,.23])pin(-.06,.45,z,.24,'#e2c0f2');},
  rover(){for(const z of [-.34,.34]){pin(-.18,.6,z,.24,'#ffd396');egg(-.28,.29,z*1.18,.071,.060,.031,'#98e5de');}},
  saucer(){for(const z of [-.61,.61])pin(-.10,.52,z,.19,'#ffe5b6');},
  blob(){for(const z of [-.36,.36])pin(-.03,.49,z,.18,'#ece0ff');},
  greyKing(){for(const z of [-.48,.48])pin(-.29,.73,z,.28,'#f6cb97','heart');egg(-.08,1.68,0,.115,.109,.115,'#e5a4ca');},
  mothership(){for(const z of [-.82,.82])pin(-.30,.51,z,.36,'#adf1e3');},
  bioCore(){for(const z of [-.51,.51])pin(-.46,.91,z*.83,.45,'#f0dcfa','heart');},
  starEmperor(){for(const z of [-.68,.68])pin(-.22,.76,z,.37,'#ffe2a0');},
  jelly(){for(const z of [-.40,.40])pin(-.29,.83,z,.21,'#ffe1ea');},
  hoplite(){for(const z of [-.36,.36])rim(.36,.50,z,.17,.02,'#f0d59b');},
  shark(){for(const z of [-.30,.30])pin(-.09,.67,z,.18,'#def9ec');},
  tideCrab(){for(const z of [-.54,.54])pin(-.18,.58,z,.20,'#ffdbad','heart');},
  zeus(){for(const z of [-.33,.33]){pin(-.13,1.02,z,.27,'#ffdf8a');egg(-.19,1.36,z,.115,.125,.114,'#e5d3ae');}},
  poseidon(){for(const z of [-.34,.34]){blossom(-.36,.56,z,.20,'#eac3d5');pin(.13,1.24,z,.25,'#f9dda2');}},
  hades(){for(const z of [-.40,.40]){pin(-.22,.71,z,.29,'#c8b1e4','heart');egg(-.29,.97,z,.092,.14,.07,mint);}},
  banner(){pin(-.58,1.49,-.435,.30,cream);},
  matchlock(){pin(.23,1.29,.32,.21,'#e5c0e0');},
  helmet(){for(const z of [-.37,.37])blossom(-.13,1.29,z,.144,'#e8bda4');},
  ninja(){for(const z of [-.34,.34])pin(-.17,.58,z,.22,'#e3cde9');},
  horse(){for(const z of [-.37,.37])pin(-.29,.67,z,.22,'#eec49b');},
  nobunaga(){for(const z of [-.55,.55])pin(-.28,.83,z,.29,'#f8d28a');},
  hideyoshi(){for(const z of [-.42,.42])blossom(-.32,.67,z,.20,'#f8e0a1');},
  ieyasu(){for(const z of [-.40,.40])blossom(-.24,1.18,z,.16,'#d7e0aa');},
  yoshimoto(){for(const z of [-.45,.45])pin(-.36,.44,z,.35,'#fbdb9d');},
  kenshin(){for(const z of [-.36,.36])pin(-.19,.81,z,.25,'#e3dde9');},
  shingen(){for(const z of [-.47,.47])pin(-.22,.68,z,.32,'#fff0bc');},
  masamune(){for(const z of [-.42,.42])pin(-.21,.65,z,.29,'#c9e4ff');},
  yukimura(){for(const z of [-.40,.40])pin(-.35,.66,z,.28,'#f8cd8d');},
  motonari(){for(const z of [-.41,.41])blossom(-.25,.65,z,.15,'#dbe29b');},
  ujiyasu(){for(const z of [-.41,.41])pin(-.17,.69,z,.28,'#e9d3a6');},
  yoshihiro(){for(const z of [-.60,.60])pin(-.34,.61,z,.31,'#f6cadd','heart');}
 };
 recipes[shape]();
 const feature=details[shape];
 if(feature)feature();
 const geometry=b.build();geometry.userData.shared=true;
 return {geometry,parts};
}

G.roundModels={
 build(shape,scale,height){
  let spec=cache.get(shape);
  if(!spec){spec=sculpt(shape);cache.set(shape,spec);}
  const shiny=['saucer','mothership','starEmperor','rover','stag','beetle','poseidon'].includes(shape);
  const root=new T.Group(),body=new T.Group(),material=G.look.vmat({instance:true,rough:shiny?.51:.69,metal:shiny?.15:0,rim:.8});
  const faceMaterial=G.look.vmat({instance:true,rough:.8});
  const mesh=new T.Mesh(spec.geometry,material);mesh.castShadow=true;body.add(mesh);root.add(body);body.scale.setScalar(scale);
  const outlineInk=/bee|beetle|mantis|stag|scythe/i.test(shape)?'#493832':'#423143';
  const outlines=[G.look.outline(mesh,.020,outlineInk)],nodes=new Map(),segments=[];
  for(const part of spec.parts){
   const node=new T.Mesh(part.geometry,part.parent?faceMaterial:material);
   node.name=part.role;
   const parent=nodes.get(part.parent)||body;
   parent.add(node);
   if(!part.parent){
    node.position.fromArray(part.pivot);
    node.castShadow=part.role.startsWith('face')||part.role==='weapon';
    if(node.castShadow||part.role.startsWith('claw')||part.role.startsWith('wing'))outlines.push(G.look.outline(node,.012,outlineInk));
    segments.push(node);nodes.set(part.role,node);
   }
   else{node.visible=part.role==='idle';segments.push(node);}
  }
  const motion=G.roundAnimation.make(shape,body,segments,scale);
  return {root,height,radius:.43*scale,shape,hit:motion.hit,
   update(e){motion.update(e);material.userData.uFlash.value=motion.flash;},
   rescueShell:motion.rescueShell,
   setAlpha(a){
    const transparent=a<1;
    for(const m of [material,faceMaterial]){
     if(m.transparent!==transparent){m.transparent=transparent;m.needsUpdate=true;}
     m.opacity=a;
    }
    for(const line of outlines)line.visible=a>.62&&G.quality.tier<2;
   },dispose(){material.dispose();faceMaterial.dispose();}};
 }
};
})();

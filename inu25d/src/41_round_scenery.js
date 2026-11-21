// Stage-specific scenery uses the same chunk batches as the first journey.
(function(){'use strict';
const G=window.G,T=window.THREE,PI=Math.PI,TAU=PI*2;
const routes={
 mecha:[
  ['ruins','scrap','#101a2a','#485563','#a6a6ae','#c1a399',[19,46,72,99]],
  ['foundry','alloy','#18202e','#596a76','#ac9b93','#e6aa6c',[17,45,73,101]],
  ['railway','alloy','#132538','#3e6678','#adbac1','#91d2d8',[22,50,77,105]],
  ['furnace','alloy','#201a2d','#744a52','#d09a79','#ffbc86',[18,47,74,103]],
  ['citadel','alloy','#101826','#34445d','#b691a5','#c5b9e8',[22,49,80,110]]
 ],
 bug:[
  ['flower','meadow','#85bd9a','#e6b6db','#ffe1a9','#a5bd87',[17,42,70,92]],
  ['honey','wax','#604167','#bb834e','#f4b965','#dba068',[19,47,70,94]],
  ['web','forest','#233451','#59608d','#8a79ac','#8387bd',[15,43,66,91]],
  ['burrow','crystal','#412c4f','#855769','#ce8f76','#bc8a76',[22,49,72,95]],
  ['cocoon','castle','#52356f','#8b5ea5','#e9a8cb','#d4a7de',[17,41,65,91]]
 ],
 space:[
  ['moon','moonDust','#090b26','#262046','#533f77','#9a90c7',[18,44,73,97]],
  ['orbit','alloy','#050b28','#172e63','#393975','#a6c4ee',[15,43,69,93]],
  ['reactor','alloy','#0c1538','#294b69','#3b8b8d','#7a97b8',[20,48,75,98]],
  ['observatory','alloy','#090b27','#342257','#724479','#b49ad4',[21,47,70,96]]
 ],
 sea:[
  ['cloud','snow','#71addf','#bddef0','#f6e6d7','#eae2f5',[16,42,68,93]],
  ['reef','crystal','#153b5c','#187387','#77c2b1','#9acdca',[17,45,70,94]],
  ['styx','forest','#212036','#3e4158','#68847d','#8ca7a4',[20,51,75,99]]
 ],
 war:[
  ['inferno','sengoku','#342034','#813a42','#e98959','#ca9973',[18,44,71,95]],
  ['village','sengoku','#68496e','#c3888c','#ffcc8d','#e0bf9d',[16,43,65,92]],
  ['field','meadow','#8796a5','#b4ceaa','#edde9e','#beaeb0',[20,47,76,100]],
  ['rain','sengoku','#293e58','#4d6c83','#7b9295','#a4b4b9',[15,41,69,93]],
  ['mist','sengoku','#6f7193','#b0b5bd','#ebc6a9','#c0b7b7',[18,45,71,94]],
  ['mountain','cobble','#466a84','#759d9d','#dad0ac','#bbba9d',[20,47,74,99]],
  ['snow','snow','#42638f','#9dc8e2','#e3eaf5','#d7eaf7',[17,48,76,99]],
  ['fort','sengoku','#423555','#935f6f','#dba98b','#c89882',[16,41,64,90]],
  ['torii','cobble','#485b8a','#778faf','#f2b1a1','#d8b5ad',[19,48,72,95]],
  ['walls','cobble','#495974','#819390','#cec6a7','#c4b491',[20,45,69,97]],
  ['volcano','sengoku','#2e1631','#6f3949','#de7148','#bf8669',[19,45,73,96]]
 ]
};
function theme(base,style,index){
 const [scene,ground,top,mid,bot,accent,marks]=routes[style][index];
 const space=style==='space',mecha=style==='mecha',dark=space||mecha||['web','burrow','styx','inferno','volcano','cocoon'].includes(scene);
 const particles={...base.particles,a:accent,b:dark?'#fff0dc':'#fff4c9',
   kind:scene==='rain'?'snow':space?'sparkle':scene==='flower'?'petal':scene==='snow'?'snow':'glow'};
 if(scene==='rain')Object.assign(particles,{vel:[-.7,-2.2,.1],n:115,size:.13});
 if(space)Object.assign(particles,{vel:[-.45,.06,.01],n:100,add:1,twinkle:1});
 if(mecha)Object.assign(particles,{kind:'glow',vel:[-.32,.16,.04],n:65,size:.08,add:1,twinkle:1});
 return {...base,ground,exposure:mecha?1.04:base.exposure,rimLook:mecha?['#bad5e0',.36,'#ddad99',.035]:base.rimLook,
  journey:scene,journeyAccent:accent,marks,brow:space?-7.5:-15,
  narrowDeck:space&&scene!=='moon', sky:{...base.sky,top,mid,bot},fog:{color:space?'#4b527c':mid,near:space?50:28,far:space?180:120},
  stars:space?2:mecha?0:(dark?1:0),sun:space?{...base.sun,r:0,glowStr:0}:mecha?{...base.sun,r:.023,glowStr:.12,color:'#f3d6ba',glow:'#b6b2a9'}:base.sun,
  clouds:null,particles,farPar:space?.81:.70,
  light:{...base.light,hemiSky:space?'#b8c9f6':bot,hemiGround:accent,rim:accent,key:dark?'#ffe9e0':'#fff2dc'},
  beltTint:mecha?'#b0b6c2':space?'#c1d7ed':scene==='reef'?'#9ecdc6':scene==='honey'?'#e8c7a0':scene==='styx'?'#b6c0cf':'#fff2eb',
  sideTint:space?'#9daed5':accent};
}
function build(c,p,kit){
 const {journey:id,journeyAccent:a}=c.th,R=c.R;
 const at=(x,z)=>{c.at(x);return c.h(x,z);};
 const mass=(col,x,y,z,s)=>c.S(p.sph,col,[x,y,z],null,s);
 const metal=(col,x,y,z,s,rot)=>c.S(p.rbox2,col,[x,y,z],rot,s);
 const glow=(col,x,y,z,s)=>c.GL(p.sph,col,[x,y,z],null,s);
 const pole=(col,x,y,z,s,rot)=>c.S(p.cyl6,col,[x,y,z],rot,s);
 const loop=(g,col,x,y,z,s,rot)=>c.S(g,col,[x,y,z],rot,s);
 const flora=(x,z,s,color)=>{
  const y=at(x,z),h=2.5*s;
  c.W(p.cyl6,'#759b69',[x,y+h*.48,z],[0,0,-.13],[.12*s,h,.12*s]);
  for(const d of [-1,1])c.W(p.sph,'#8bbb73',[x+d*.41*s,y+h*.49,z],[.3,0,d*.60],[.66*s,.16*s,.33*s]);
  for(let k=0;k<6;k++){const v=k*TAU/6;c.W(p.sph,color,[x+Math.cos(v)*.71*s,y+h+Math.sin(v)*.55*s,z],[0,.2,v],[.60*s,.32*s,.23*s]);}
  mass('#ffd074',x,y+h,z+.28*s,[.43*s,.35*s,.24*s]);
 };
 const hex=(x,y,z,s,fill)=>{
  loop(p.cyl6,'#b67855',x,y,z,[s,.34*s,s],[PI/2,PI/2,0]);
  loop(p.cyl6,fill,x,y,z+.20*s,[.79*s,.30*s,.79*s],[PI/2,PI/2,0]);
  loop(p.cyl6,'#ffe5a2',x,y,z+.37*s,[.66*s,.14*s,.66*s],[PI/2,PI/2,0]);
 };
 const web=(x,y,z,s)=>{
  for(const r of [.4,.71,1])loop(p.ring,'#d9c8e8',x,y,z,[s*r,s*r*.80,.17]);
  for(let k=0;k<4;k++){
   const r=k*PI/4;
   metal('#e6d8ee',x,y,z,[2*s,.036,.034],[0,0,r]);
  }
 };
 const pod=(x,y,z,s)=>{
  metal('#4c608e',x,y,z,[s*1.37,s*1.1,s*1.15],[0,0,-.18]);
  mass('#9eb8d7',x,y+.6*s,z,[s*.62,s*.23,s*.5]);
  for(let i=0;i<3;i++)glow(i===1?'#ffe3aa':'#abf4ff',x+(i-1)*s*.27,y-.22*s,z+s*.59,[.09*s,.07*s,.06*s]);
 };
 const coral=(x,z,s)=>{
  const y=at(x,z);
  for(let j=-2;j<3;j++){
   const h=(1.2+R()*1.75)*s,k=j*.32*s;
   pole(j%2?'#f0a3b9':'#9ed6cc',x+k,y+h*.49,z,[.17*s,h,.17*s],[0,0,-j*.24]);
   mass(j%2?'#f7bbcd':'#b5e8d3',x+k*1.8,y+h*.88,z,[.22*s,.31*s,.18*s]);
  }
  c.halo(x,y+1.5*s,z+.2,'#b9fff6',1.2);
 };
 const column=(x,y,z,h)=>{
  metal('#b9c8c9',x,y+.12,z,[1.25,.24,1.15]);
  pole('#e6e1d8',x,y+h*.5,z,[.47,h,.46]);
  for(const f of [.19,.9])metal('#fff1d0',x,y+h*f,z,[1.1,.22,1]);
 };
 const gate=(x,y,z,s,red=false)=>{
  const c1=red?'#c85d59':'#a88473',c2=red?'#6b4059':'#4c5068';
  for(const dx of [-1.36,1.36])pole(c1,x+dx*s,y+1.33*s,z,[.18*s,2.7*s,.2*s]);
  metal(c1,x,y+2.18*s,z,[3.38*s,.19*s,.22*s]);
  metal(c2,x,y+2.75*s,z,[3.85*s,.25*s,.4*s]);
  for(const dx of [-1.64,1.64])metal(c2,x+dx*s,y+2.85*s,z,[.65*s,.23*s,.45*s],[0,0,Math.sign(dx)*.20]);
 };
 const fort=(x,y,z,s)=>{
  metal('#8e928c',x,y+.58*s,z,[4.7*s,1.16*s,1.65*s]);
  metal('#e6d4bd',x,y+1.71*s,z,[3.75*s,1.18*s,1.6*s]);
  c.S(p.sengokuRoof,'#4f536b',[x,y+2.69*s,z],null,[4.75*s,.96*s,2.13*s]);
  for(const dx of [-1.1,0,1.1]){
   metal('#826962',x+dx*s,y+1.88*s,z+.84*s,[.40*s,.53*s,.07*s]);
   metal('#d8aa7c',x+dx*s,y+1.88*s,z+.89*s,[.30*s,.40*s,.034*s]);
  }
 };
 const lantern=(x,y,z,s)=>{pole('#987e74',x,y+1.23*s,z,[.07*s,2.46*s,.07*s]); glow('#ffd78b',x,y+2.48*s,z,[.23*s,.34*s,.22*s]);c.halo(x,y+2.45*s,z+.12,'#ffb772',1.5*s);};
 const blocks={
  ruins(x,z,s){
   const y=at(x,z);
   for(let i=0;i<3;i++){
    const h=(i===1?3.8:2.2+i*.6)*s,px=x+(i-1)*1.56*s;
    metal('#56616f',px,y+h*.5,z,[1.3*s,h,.86*s],[0,0,(i-1)*.15]);
    for(let j=0;j<3;j++)metal(j===1?'#ffbd90':'#293b4e',px,y+.6+j*.76*s,z+.455*s,[.48*s,.30*s,.05]);
    pole('#aa857d',px+.53*s,y+h+.18,z,[.06,.77*s,.06],[0,0,.34]);
   }
   metal('#8e8f98',x+2.27*s,y+.20,z+.41,[1.36*s,.35*s,.8*s],[0,.13,.24]);
  },
  foundry(x,z,s){
   const y=at(x,z);
   for(const d of [-1,1])metal('#6b7985',x+d*1.8*s,y+2*s,z,[.38*s,4*s,.55*s]);
   metal('#889ba6',x,y+3.8*s,z,[4.4*s,.45*s,.8*s]);
   pole('#a3847f',x,y+2.4*s,z,[.12*s,2.4*s,.12*s]);
   loop(p.ring,'#b2abb3',x,y+1.30*s,z,[.42*s,.42*s,.5]);
   metal('#485a6b',x,y+.38*s,z,[4.3*s,.65*s,1.42*s]);
   for(let i=0;i<4;i++)pole('#b4b0ad',x+(i-1.5)*.9*s,y+.76*s,z,[.32*s,.13*s,.32*s],[PI/2,0,0]);
   glow('#ffd28e',x+1.36*s,y+1.01*s,z+.64,[.23,.12,.08]);
  },
  railway(x,z,s){
   const y=at(x,z);
   for(const d of [-1,1])metal('#86a5b2',x,y+.18,z+d*.72*s,[5*s,.12,.12]);
   metal('#3e5969',x,y+.73*s,z,[3.6*s,1.1*s,1.5*s],[0,0,-.05]);
   for(const dx of [-1.23,1.23])for(const d of [-1,1])pole('#92a7b0',x+dx*s,y+.35*s,z+d*.79*s,[.38*s,.19,.38*s],[PI/2,0,0]);
   for(const dx of [-1,0,1])metal('#ffcf97',x+dx*s,y+1.03*s,z+.79*s,[.42*s,.23*s,.05]);
   metal('#617582',x+1.9*s,y+1.45*s,z,[.39*s,2.9*s,.48*s]);
  },
  furnace(x,z,s){
   const y=at(x,z);
   pole('#595863',x,y+1.65*s,z,[1.32*s,3.3*s,1.32*s]);
   for(const h of [.45,1.45,2.6])loop(p.ring,'#aa8584',x,y+h*s,z,[1.34*s,1.34*s,.22],[PI/2,0,0]);
   glow('#ffc18b',x,y+.74*s,z+1.20*s,[.6*s,.6*s,.17*s]);c.halo(x,y+.7*s,z+1.39*s,'#fba278',1.65*s);
   for(const d of [-1,1])pole('#8c8e99',x+d*1.7*s,y+1.6*s,z,[.23*s,3.2*s,.23*s]);
  },
  citadel(x,z,s){
   const y=at(x,z);
   for(const d of [-1,1]){
    metal('#596579',x+d*1.7*s,y+2.1*s,z,[.72*s,4.2*s,1.0*s],[0,0,d*.10]);
    glow('#d7c8ff',x+d*1.66*s,y+2.6*s,z+.55*s,[.12*s,1.09*s,.055]);
   }
   metal('#73758c',x,y+4.15*s,z,[4.6*s,.68*s,1.1*s]);
   loop(p.ring,'#b3a2c4',x,y+2.65*s,z,[1.13*s,1.13*s,.64],[0,0,.20]);
   glow('#bd9be5',x,y+2.65*s,z-.12,[.63*s,.66*s,.10]);
   for(const d of [-1,1])mass('#858593',x+d*1.4*s,y+.25,z+.88,[.4,.28,.5]);
  },
  flower(x,z,s){flora(x,z,s,'#f6afd2');flora(x+2.2,z-1.3,s*.70,'#fff09f');},
  honey(x,z,s){const y=at(x,z);for(let n=0;n<5;n++)hex(x+(n%3-1)*1.52*s,y+(1+Math.floor(n/3)*1.32)*s,z,s*.88,n%2?'#e79858':'#dfa463');c.halo(x,y+1.6,z,'#ffd985',1.7);},
  web(x,z,s){kit.tree(c,x-1.6,z,s*1.42,'#7c749b','#574d75');kit.tree(c,x+1.8,z,s*1.67,'#8c87ae','#565377');const y=c.h(x,z);web(x,y+2.2*s,z+.34,s*1.48);},
  burrow(x,z,s){const y=at(x,z);mass('#b68d75',x,y+.51*s,z,[2.58*s,1.66*s,1.18*s]);mass('#614552',x,y+.47*s,z+.92,[1.19*s,1.15*s,.40*s]);for(const d of [-1,1])mass('#d4a38a',x+d*s*1.36,y+.36*s,z+.72,[.43*s,.31*s,.43*s]);lantern(x-2,y,z,s*.67);},
  cocoon(x,z,s){const y=at(x,z);for(let i=-1;i<=1;i++){
    const h=(2.5+(i===0?1:.1))*s;pole('#76618a',x+i*1.6,y+h*.60,z,[.075,h*1.20,.075]);
    mass(i?'#dcaacb':'#efc5e0',x+i*1.6,y+h,z,[.55*s,.89*s,.51*s]);
    for(const f of [-.21,.18])loop(p.ring,'#f8dded',x+i*1.6,y+h+f,z,[.50*s,.50*s,.45],[PI/2,.12,0]);
  }},
  moon(x,z,s){const y=at(x,z);for(const d of [-1,1])mass('#9f91b3',x+d*1.55*s,y+.18,z-.5,[1.50*s,.42*s,1*s]);pod(x,y+1.08*s,z,s*1.18);},
  orbit(x,z,s){z=-5.9;const y=at(x,z);
   metal('#667ca6',x,y+.22,z,[.77*s,.44*s,.93*s]);
   metal('#7887b3',x,y+1.5,z,[.48*s,3.0*s,.7*s],[0,0,.15]);
   metal('#6977a9',x+1.23,y+.78,z,[2.8*s,.6*s,1.12*s]);
   for(let j=0;j<4;j++)glow('#a6f3ff',x+j*.63,y+.9,z+.61,[.21,.072,.052]);
   loop(p.ring,'#b5d7ed',x,y+2.9,z-.32,[1.2*s,1.1*s,.55],[.22,.20,.1]);
  },
  reactor(x,z,s){const y=at(x,z);
   metal('#465785',x,y+.28,z,[3.8*s,.56*s,1.80*s]);
   pole('#6da9ac',x,y+1.54*s,z,[.74*s,2.85*s,.74*s]);
   glow('#a5f6ca',x,y+1.76*s,z+.24,[.56*s,.93*s,.55*s]);
   for(const d of [-1,1])metal('#637baa',x+d*1.38*s,y+1.12*s,z,[.36*s,1.86*s,.58*s]);
  },
  observatory(x,z,s){const y=at(x,z);
   loop(p.ring,'#ac94c3',x,y+2.4*s,z,[1.75*s,1.4*s,.52],[.15,0,0]);
   mass('#7f619f',x,y+2.46*s,z-.18,[.60*s,.62*s,.55*s]);
   glow('#e5baf4',x+.24,y+2.63*s,z+.32,[.28*s,.22*s,.2*s]);
   metal('#4b416f',x,y+.63,z,[2.72*s,1.2*s,1.38*s]);
  },
  cloud(x,z,s){const y=at(x,z);for(const d of [-1,1])column(x+d*1.47*s,y,z,3.5*s);metal('#ebdcc3',x,y+3.73*s,z,[4.1*s,.45*s,1.05*s]);c.S(p.pyr,'#e0bcb3',[x,y+4.15*s,z],null,[2.4*s,.62*s,.72*s]);},
  reef(x,z,s){coral(x,z,s);coral(x+2.1,z-1.9,s*.76);
   for(let i=0;i<3;i++)c.FG(p.ring,'#b2dfd4',[x*.32+i*.79,2.2+i*.53,-17],null,[.19,.19,.19]);
   const bx=x+3.45,bz=z-2.70,by=at(bx,bz);
   column(bx,by,bz,2.8*s);column(bx+2.25,by,bz,2.6*s);
   metal('#92bcbc',bx+1.14,by+2.9*s,bz,[3,.39,.8],[0,0,.05]);},
  styx(x,z,s){const y=at(x,z);metal('#62586d',x,y+.27,z,[3.7*s,.38*s,1.4*s]);gate(x,y,z,s*.85);for(const dx of [-.92,1.1])glow('#b7e1db',x+dx,y+.6,z+.6,[.27,.49,.24]);},
  inferno(x,z,s){const y=at(x,z);fort(x,y,z,s);for(const dx of [-1.1,1.1]){glow('#ffae70',x+dx,y+2.32*s,z+.49,[.36,.37,.24]);c.halo(x+dx,y+2.32*s,z+.64,'#eb7766',1.7);}},
  village(x,z,s){const y=at(x,z);fort(x,y,z,s*.78);lantern(x-2,y,z,s);lantern(x+2.1,y,z,s*.80);},
  field(x,z,s){const y=at(x,z);gate(x,y,z,s*.78);for(const d of [-1,1])kit.tree(c,x+d*2.1,z-1.1,s*.75,'#b3ba77','#957a60');},
  rain(x,z,s){const y=at(x,z);gate(x,y,z,s*.84);for(const d of [-1,1])mass('#869faa',x+d*1.5,y+.13,z+.8,[.87,.05,.55]);},
  mist(x,z,s){const y=at(x,z);kit.tree(c,x,z-1,s*1.24,'#a4a4ad','#6f7081');mass('#b5b4bc',x,y+.14,z,[2.8*s,.31*s,.82*s]);lantern(x+1.4,y,z,s*.73);},
  mountain(x,z,s){const y=at(x,z);fort(x,y+.48,z,s);mass('#8a9899',x,y+.32,z,[2.9*s,.80*s,1.23*s]);},
  snow(x,z,s){kit.tree(c,x,z,s*1.43,'#ccddeb','#8a92a4');const y=c.h(x,z);mass('#dfe8ed',x,y+.19,z+.55,[1.65*s,.32,.7]);lantern(x+1.42,y,z,s*.62);},
  fort(x,z,s){const y=at(x,z);fort(x,y,z,s);gate(x+2.20,y,z-.6,s*.63,true);},
  torii(x,z,s){const y=at(x,z);gate(x,y,z,s,true);for(let j=0;j<3;j++)mass('#b8c4d0',x+(j-1)*1.41,y+.07,z+.73,[.62*s,.048,.44]);},
  walls(x,z,s){const y=at(x,z);
   for(let j=0;j<3;j++)for(let i=0;i<5;i++)metal(j%2?'#92988c':'#acaa99',x+(i-2)*.68*s,y+j*.34*s+.18,z,[.63*s,.29*s,1]);
   fort(x,y+.86,z-.75,s*.66);
  },
  volcano(x,z,s){const y=at(x,z);
   for(const d of [-1,1])c.S(p.oct,'#8e6671',[x+d*.97,y+.55,z],[.21,d*.39,.32],[.98*s,1.1*s,.7*s]);
   glow('#ff9e65',x,y+.05,z+.4,[1.04*s,.072,.60*s]);c.halo(x,y+.67,z,'#ff9181',1.65);
  }
 };
 for(let x=-3;x<c.L+8;x+=8.4+R()*4)blocks[id](x,-6.2-R()*2,.67+R()*.42);
 if(c.th.narrowDeck)for(let x=-9;x<c.L+8;x+=4.1){
  const z=-5.24;at(x,z);
  metal('#6d7d9f',x,.14,z,[4.08,.28,.35]);
  metal('#6b87ab',x,.63,z,[.17,1.04,.23]);
  metal('#92a8c3',x,.99,z,[4.06,.08,.12]);
  for(const dx of [-1.20,0,1.20])glow('#92f3f0',x+dx,.20,z+.21,[.22,.048,.039]);
 }
 const bossX=c.def.boss.at+1;
 blocks[id](bossX,-7.2,1.35);blocks[id](bossX+5.8,-10.6,1.03);
 if(c.def.journeyStyle==='space'){
  for(let i=0;i<112;i++){
   const x=-52+R()*(c.L*.35+100),y=-2+R()*33,z=-49-R()*54,s=.035+R()*.15;
   c.FG(i%16===0?p.star:p.dot,i%4===0?'#ccacfa':'#c7e5ff',[x,y,z],null,s);
  }
  for(const x of [-25,11,46,78]){
   const s=4.5+R()*1.8,y=-1.8+R()*3.8,z=-41;
   c.FG(p.can,id==='reactor'?'#377f89':id==='moon'?'#7e6598':'#566bb0',[x,y,z],null,s);
   c.FG(p.ring,'#a986c8',[x,y,z],[-.41,.17,.30],[s*1.49,s*.55,s*.72]);
   for(let j=0;j<4;j++)c.FG(p.lo,'#9385c1',[x+(R()-.5)*s,y+(R()-.5)*s,z+s*.91],null,[s*.12,s*.083,s*.13]);
  }
 }else if(c.def.journeyStyle==='mecha'){
  for(let x=-43;x<c.L*.35+65;x+=5+R()*7){
   const h=5+R()*11,z=-33-R()*20;
   c.F(p.rbox2,'#354354',[x,h*.35-3,z],[0,0,(R()-.5)*.13],[3+R()*4,h,2+R()*2]);
   for(let i=0;i<3;i++)c.F(p.rbox2,i%2?'#bd937d':'#607282',[x,h*.26+i*1.2,z+2.1],null,[.39,.45,.10]);
  }
  for(let x=-6;x<c.L;x+=6.6){
   at(x,-5.3);metal('#626b75',x,.14,-5.3,[4.5,.28,.34]);
   for(let i=0;i<6;i++)metal(i%2?'#e3b782':'#484555',x-1.9+i*.62,.29,-5.09,[.43,.13,.06],[0,0,-.44]);
  }
 }else{
  const backdrop=id==='honey'?'#aa765b':id==='burrow'?'#896a6e':id==='cocoon'?'#9475a5':id==='web'?'#5d6187':c.def.journeyStyle==='bug'?'#819a80':id==='reef'?'#599891':id==='styx'?'#496776':'#7e8398';
  for(let x=-42;x<c.L*.32+56;x+=8+R()*9){
   const y=id==='cloud'?-.1:-7.5,z=-26-R()*21;
   c.F(p.sph,backdrop,[x,y,z],null,[9+R()*7,6+R()*7,6]);
   if(id==='cloud')c.F(p.can,'#eee0e8',[x+3,y+1,z+2],null,[8,3.8,5]);
   if(id==='volcano')c.F(p.cone,'#78556a',[x,y+7,z-3],null,[8,14,8]);
   if(id==='flower')c.F(p.can,'#c0bc92',[x,y+6,z],null,[5,6,4]);
   if(id==='honey'){
    for(let j=0;j<3;j++)c.F(p.cyl6,j%2?'#c78b6c':'#a67065',[x+j*1.95,2.9+(j%2)*1.67,z], [PI/2,PI/2,0],[2.14,.28,2.14]);
   }
  }
 }
}
G.journeyScenery={theme,build};
})();

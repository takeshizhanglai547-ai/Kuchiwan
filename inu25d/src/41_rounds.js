// Additional campaigns from the 2D game, with compact 2.5D encounter layouts.
(function(){'use strict';
const G=window.G,F=G.foes,H=F.h,T=window.THREE;
const worlds=[
 {name:'蟲の世界', style:'bug', base:'forest', color:'#a7d293', foes:['mantisPup','beePup','beetlePup'], stages:[
  ['大輪の花園','大鎌騎士カマリス','town'],['蜂の巣大空洞','女王蜂ビーヴァ','cave'],['蜘蛛糸の森','糸姫アラクネ','forest'],['地底の蟻帝国','大顎公クワガタス','cave'],['蟲の女王の間','蟲の女王チャムルス','castle']]},
 {name:'宇宙人の侵略', style:'space', base:'airship', color:'#a5b3ea', foes:['alienPup','rayPup','ufoPup'], stages:[
  ['墜ちた円盤','グレイ王','airship'],['星間回廊','円盤母艦ディスコ','castle'],['母船コア','増殖体バイオブロブ','cave'],['皇帝の玉座','銀河皇帝エックス','castle']]},
 {name:'ポセイドンと神話の世界', style:'sea', base:'cave', color:'#8bdad2', foes:['coralPup','shellPup','tidePup'], stages:[
  ['オリュンポスの神域','主神ゼウス','snow'],['海神の神殿','海神ポセイドン','cave'],['冥府ステュクスの河','冥王ハデス','forest']]},
 {name:'戦国編', style:'war', base:'sengoku', color:'#ecc097', foes:['bannerPup','matchlockPup','helmetPup'], stages:[
  ['炎上する天守','第六天魔王・信長','onibattle'],['夕暮れの城下町','秀吉','sengoku'],['三方ヶ原の野','家康','town'],['桶狭間の豪雨','義元','forest'],['川中島の朝霧','謙信','sengoku'],['甲斐の山城','信玄','castle'],['奥州の雪原','政宗','snow'],['大坂・真田丸','幸村','sengoku'],['厳島の潮騒','元就','airship'],['小田原の総構え','氏康','castle'],['薩摩の火口','義弘','onibattle']]}
];
const trim=['#fff0d4','#f7a8bc','#f2cf7c','#9edac8','#b6a7e3'];
const names={
 mantisPup:'カマキリわんこ',beePup:'みつばちわんこ',beetlePup:'カブトわんこ',
 alienPup:'おとずれわんこ',rayPup:'ビームわんこ',ufoPup:'円盤わんこ',
 coralPup:'さんごわんこ',shellPup:'貝がらわんこ',tidePup:'潮風わんこ',
 bannerPup:'旗持ちわんこ',matchlockPup:'鉄砲わんこ',helmetPup:'兜わんこ',
 poisonCap:'どくキノコわんこ',sleepCap:'ねむりキノコわんこ',slowCap:'のろのろキノコわんこ'
};
const cache=new Map();
function build(key,style,color,variant,boss=false){
 if(!cache.has(key)){
  const b=G.look.builder(),g=G.look.geo,c=trim[variant%trim.length];
  const orb=(r,fill,x,y,z,size)=>b.add(g.sphere(r,12,8),fill,[x,y,z],null,size);
  const box=(x,y,z,fill,pos,rot)=>b.add(g.box(x,y,z),fill,pos,rot);
  const cone=(r,h,fill,pos,rot)=>b.add(g.cone(r,h,9),fill,pos,rot);
  const disc=(r,h,fill,pos)=>b.add(g.cylinder(r,r,h,12),fill,pos);
  orb(.37,color,-.12,.45,0,[1.15,1,1]);orb(.43,color,.035,.89,0,[1.08,1.02,1.1]);
  orb(.26,'#fff3de',.27,.78,0,[.78,.82,1.16]);orb(.058,'#624658',.48,.81,0,[.58,.72,1]);
  for(const z of [-.24,.24]){
   orb(.16,'#fff1d7',.06,.15,z,[1.15,.67,1]);
   orb(.16,color,-.15,1.14,z*1.29,[.73,1.32,.84]);
   orb(.056,'#504251',.36,.95,z,[.72,1.16,1]);
   orb(.021,'#fffdfa',.387,.974,z+.009);
   orb(.072,'#f4a1b6',.30,.84,z*1.42,[1,.56,.51]);
  }
  if(style==='bug'){
   for(const sign of [-1,1]){
    box(.045,.33,.045,c,[-.055,1.31,sign*.14],[sign*.3,0,-.2]);orb(.07,c,-.03,1.48,sign*.19);
    if(variant%3!==0)orb(.26,variant%3===1?'#ffe9a8':'#c9d3f4',-.32,.75,sign*.31,[1.3,.45,1.14]);
    else cone(.115,.37,'#8fb491',[.35,.52,sign*.29],[0,0,-.38]);
   }
  }else if(style==='space'){
   disc(.46,.09,'#c7c2f0',[0,.62,0]);orb(.18,c,0,1.22,0,[1.13,.5,1.25]);
   for(const z of [-.30,0,.30])orb(.061,'#e7ffff',.32,.62,z);
   if(variant%3===1)box(.58,.13,.17,'#8d7cba',[.37,.55,.28]);
  }else if(style==='sea'){
   for(const z of [-.29,.29])cone(.14,.37,c,[-.09,1.20,z],[Math.sign(z)*.65,0,.2]);
   orb(.30,'#b6aad9',-.38,.51,0,[.74,1.1,1.14]);
   for(let i=0;i<3;i++)orb(.07,'#fff0dc',.21,.52,(i-1)*.16);
   if(boss||variant%3===2){
    box(.045,1.05,.05,'#997db0',[.44,.63,.34],[0,0,-.13]);
    for(const z of [.22,.34,.46])cone(.055,.24,'#fff2b5',[.51,1.24,z],[0,0,-.13]);
   }
  }else if(style==='war'){
   disc(.42,.12,'#786481',[.015,1.14,0]);
   orb(.29,c,.01,1.27,0,[1,.48,1.02]);cone(.075,.27,'#f3c16a',[.21,1.37,0],[0,0,-.25]);
   box(.06,.85,.06,'#8f7166',[-.32,.93,-.25]);box(.07,.33,.37,c,[-.33,1.31,-.29]);
   if(variant%3===1)box(.62,.12,.13,'#977b79',[.32,.53,.30]);
  }else{
   orb(.45,color,0,1.20,0,[1.15,.53,1.12]);
   for(const [x,z] of [[.23,.17],[.09,-.22],[-.25,.12],[-.22,-.24]])orb(.096,'#fff2d7',x,1.35,z,[1,.31,1]);
  }
  if(boss){disc(.32,.09,'#eab973',[-.03,1.51,0]);for(const z of [-.22,0,.22])cone(.10,.24,'#ffe299',[-.03,1.66,z]);}
  const geo=b.build();geo.userData.shared=true;cache.set(key,geo);
 }
 const root=new T.Group(),body=new T.Group(),mat=G.look.vmat({instance:true,rough:.72}),mesh=new T.Mesh(cache.get(key),mat);
 root.add(body);body.add(mesh);body.scale.setScalar(boss?1.75:1);mesh.castShadow=true;G.look.outline(mesh,.017);
 return {root,height:boss?2.7:1.45,radius:boss?.68:.41,update(e){
  body.rotation.y=e.face<0?Math.PI:0;
  body.rotation.z=e.dead||e.state==='down'?-1.1*e.face:e.pending?-.14*e.face:Math.sin(e.animT*.19)*.055;
  body.position.y=e.state==='move'?Math.abs(Math.sin(e.animT*.27))*.11:0;
  mat.userData.uFlash.value=e.flashT>0?.7:e.atkArmor?.22:0;
 },setAlpha(a){mat.transparent=a<1;mat.opacity=a;},dispose(){mat.dispose();}};
}

const hit={at:5,dur:11,x0:0,x1:1.30,zr:.57,y0:0,y1:1.5,dmg:12,power:2};
const ram={id:'roundRam',len:27,recover:31,anim:'run',move:[{at:3,until:16,vx:.17},{at:17,vx:0}],hits:[hit]};
const slash={id:'roundSwipe',len:23,recover:26,anim:'swipe',hits:[{...hit,dur:6}]};
const colors={bug:['#9fca87','#eec970','#a49abb'],space:['#aad9c0','#ad9cda','#a6bee9'],sea:['#e5adaf','#a0cfc2','#a7cbe9'],war:['#d0ab90','#ba9ab0','#db9d99']};
const bolts={bug:'star',space:'bolt',sea:'ice',war:'arrow'};
function shot(id,kind,status,count=1){return {id,len:30,recover:33,anim:'throw',proj:[{at:7,kind,dmg:status?8:12,oy:.78,vx:.23,spread:.075,count,status}]};}
function soldier(id,style,color,i,status){
 const ranged=!!status||i===1, heavy=!status&&i===2;
 const move=ranged?shot(id+'Cast',status?{poison:'shadow',sleep:'note',slow:'ice'}[status]:bolts[style],status):heavy?ram:slash;
 const reach=ranged?5.0:heavy?2.35:1.55;
 F.define(id,{name:names[id],hp:heavy?62:ranged?42:48,spd:heavy?.037:.051,armor:heavy?2:0,elite:heavy,squad:ranged?'ranged':'assault',height:1.45,
   build:()=>build(id,style,color,i),ai(e){
    const p=H.target(e);if(!p){H.stop(e);return;}
    H.face(e,p);
    if(Math.abs(p.x-e.x)>reach||Math.abs(p.z-e.z)>.52){H.walkTo(e,p.x-e.face*reach*.66,p.z);return;}
    H.stop(e);if(e.cool<=0&&H.token(e)&&H.attack(e,move,ranged?31:heavy?31:25)&&status)H.say(e,G.ailments?.label(status)+'の胞子！');
   }});
}
const caps=['poisonCap','sleepCap','slowCap'];
['poison','sleep','slow'].forEach((status,i)=>soldier(caps[i],'cap',['#bb91d3','#8fa9e0','#e5a181'][i],i,status));
// Introduce each status once in the first campaign as well.
for(const [stage,id] of [[2,caps[0]],[3,caps[1]],[5,caps[2]]])
 G.stages[stage].waves[1].foes.push([id,1]);
worlds.forEach(w=>w.foes.forEach((id,i)=>soldier(id,w.style,colors[w.style][i],i)));

function bossDefinition(id,name,w,index){
 const color=colors[w.style][index%3],spread=shot(id+'Volley',bolts[w.style],null,3);
 const charge={...ram,id:id+'Charge',armor:true,len:39,recover:39,
  move:[{at:3,until:21,vx:.22},{at:22,vx:0}],hits:[{...hit,x1:1.95,y1:1.65,zr:.67,dmg:23,power:3,dur:18}]};
 const field={id:id+'Field',len:40,recover:41,anim:'slam',
   areas:[{at:12,r:2.8,zr:1.5,ox:1.0,dmg:22,y1:.88,power:3,kind:w.style==='sea'?'ice':'blunt',fx:'shock'}]};
 const poseidon=name==='海神ポセイドン';
 if(poseidon){field.id=id+'TidalWave';field.areas=[{...field.areas[0],r:4.5,zr:1.20,ox:2.0,dmg:26,fx:'ice'}];}
 const moves=index%3===1?[spread,charge,field]:index%3===2?[field,spread,charge]:[charge,field,spread];
 F.define(id,{name,boss:true,elite:true,hp:410+index*20,spd:.049,height:2.7,radius:.67,weight:2.35,poise:88,score:1600,xp:82,
  build:()=>build(id,w.style,color,index,true),ai(e){
   const p=H.target(e);if(!p){H.stop(e);return;}
   H.face(e,p);
   const dx=Math.abs(p.x-e.x),dz=Math.abs(p.z-e.z);
   if(dx>6.1||dz>1.05){H.walkTo(e,p.x-e.face*2.3,p.z);return;}
   H.stop(e);if(e.cool>0)return;
   const n=e.roundMove||0;
   const attack=poseidon&&n%3===0?field:dx>3.7&&n%2===0?spread:moves[n%3];
   if(H.attack(e,attack,attack===field?42:35)){e.roundMove=n+1;if(poseidon&&attack===field)H.say(e,'大波が来るぞ。飛び越えてみよ！');}
  }});
}

const themes=G.stage.THEMES;
const weather={
 bug:{sky:['#c2b2ec','#eee0b8','#eff0b0'],fog:'#c6cba3',ground:'#789d6d'},
 space:{sky:['#29254d','#6b609e','#b7acd9'],fog:'#756a99',ground:'#676f9c'},
 sea:{sky:['#244e76','#5aafba','#c8e7da'],fog:'#72b6bd',ground:'#659f9d'},
 war:{sky:['#695173','#c48292','#f1be99'],fog:'#ac8392',ground:'#b4987d'}
};
worlds.forEach((w,worldIndex)=>w.stages.forEach(([name,bossName,base],i)=>{
 const lap=worldIndex+2,id='lap'+lap+'Boss'+(i+1),th=themes[base]||themes[w.base],env=weather[w.style];
 bossDefinition(id,bossName,w,i);
 const [a,b,c]=w.foes,mushroom=caps[(i+worldIndex)%caps.length];
 const start=i===0?'扉の向こうに「'+w.name+'」が広がっている。仲間と一緒に新しい道を進もう。':name+'へ着いた。'+bossName+'がこの先で待っている。';
 const clear=i===w.stages.length-1?w.name+'を踏破した。次の旅に備えて、チャムの店へ戻ろう。':bossName+'を退けた。次は「'+w.stages[i+1][0]+'」へ向かおう。';
 G.stages.push({id:'lap'+lap+'stage'+(i+1),no:G.stages.length+1,lap,chapter:i+1,region:w.name,journeyStyle:w.style,name,kana:name,
  intro:start,epilogue:clear,length:108+i,bgm:'stage'+(2+(i+worldIndex)%7),
  theme:{...th,sky:{...th.sky,top:env.sky[0],mid:env.sky[1],bot:env.sky[2]},fog:{...th.fog,color:env.fog},
    particles:{...th.particles,a:w.color,b:'#fff2c7'},roundStyle:w.style,roundColor:w.color},
  waves:[{at:18,width:15,foes:[[a,2],[b,1]]},{at:43,width:16,foes:[[c,1],[mushroom,1],[a,1]],reward:'bone'},
    {at:69,width:17,foes:[[a,1],[b,1],[c,1],[mushroom,1]],then:[[b,1]],reward:'coin'}],
  boss:{type:id,at:91,x:91},hints:[{at:8,name:'モフじい',text:'キノコわんこの胞子に注意。光る予告を見たら奥か手前へよけよう。'}],props:[]});
}));
})();

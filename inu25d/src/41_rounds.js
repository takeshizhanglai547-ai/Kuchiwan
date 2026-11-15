// Additional campaigns from the 2D game, with compact 2.5D encounter layouts.
(function(){'use strict';
const G=window.G,F=G.foes,H=F.h,T=window.THREE;
const worlds=[
 {name:'蟲の世界', style:'bug', base:'forest', color:'#a7d293', stages:[
  ['大輪の花園','大鎌騎士カマリス','town','scytheKnight',['caterpillarPup','mantisPup','mothPup']],
  ['蜂の巣大空洞','女王蜂ビーヴァ','cave','queenBee',['beePup','caterpillarPup','beetlePup']],
  ['蜘蛛糸の森','糸姫アラクネ','forest','arachne',['spiderPup','mothPup','caterpillarPup']],
  ['地底の蟻帝国','大顎公クワガタス','cave','stag',['antPup','beetlePup','spiderPup']],
  ['蟲の女王の間','蟲の女王チャムルス','castle','mothQueen',['mothPup','beePup','beetlePup']]]},
 {name:'宇宙人の侵略', style:'space', base:'airship', color:'#a5b3ea', stages:[
  ['墜ちた円盤','グレイ王','airship','greyKing',['alienPup','rayPup','ufoPup']],
  ['星間回廊','円盤母艦ディスコ','castle','mothership',['ufoPup','rayPup','blobPup']],
  ['母船コア','増殖体バイオブロブ','cave','bioCore',['blobPup','alienPup','rayPup']],
  ['皇帝の玉座','銀河皇帝エックス','castle','starEmperor',['alienPup','ufoPup','blobPup']]]},
 {name:'ポセイドンと神話の世界', style:'sea', base:'cave', color:'#8bdad2', stages:[
  ['オリュンポスの神域','主神ゼウス','snow','zeus',['coralPup','shellPup','tidePup']],
  ['海神の神殿','海神ポセイドン','cave','poseidon',['sharkPup','tidePup','coralPup']],
  ['冥府ステュクスの河','冥王ハデス','forest','hades',['shellPup','sharkPup','coralPup']]]},
 {name:'戦国編', style:'war', base:'sengoku', color:'#ecc097', stages:[
  ['炎上する天守','第六天魔王・信長','onibattle','nobunaga',['matchlockPup','bannerPup','helmetPup']],
  ['夕暮れの城下町','秀吉','sengoku','hideyoshi',['bannerPup','ninjaPup','matchlockPup']],
  ['三方ヶ原の野','家康','town','ieyasu',['helmetPup','matchlockPup','horsePup']],
  ['桶狭間の豪雨','義元','forest','yoshimoto',['bannerPup','ninjaPup','horsePup']],
  ['川中島の朝霧','謙信','sengoku','kenshin',['ninjaPup','horsePup','helmetPup']],
  ['甲斐の山城','信玄','castle','shingen',['horsePup','ninjaPup','bannerPup']],
  ['奥州の雪原','政宗','snow','masamune',['matchlockPup','helmetPup','ninjaPup']],
  ['大坂・真田丸','幸村','sengoku','yukimura',['horsePup','bannerPup','matchlockPup']],
  ['厳島の潮騒','元就','airship','motonari',['bannerPup','matchlockPup','ninjaPup']],
  ['小田原の総構え','氏康','castle','ujiyasu',['helmetPup','bannerPup','matchlockPup']],
  ['薩摩の火口','義弘','onibattle','yoshihiro',['helmetPup','horsePup','ninjaPup']]]}
];
const cache=new Map();
function buildCap(key,color){
 if(!cache.has(key)){
  const b=G.look.builder(),g=G.look.geo;
  const orb=(r,fill,x,y,z,size)=>b.add(g.sphere(r,12,8),fill,[x,y,z],null,size);
  orb(.37,color,-.12,.45,0,[1.15,1,1]);orb(.43,color,.035,.89,0,[1.08,1.02,1.1]);
  orb(.26,'#fff3de',.27,.78,0,[.78,.82,1.16]);orb(.058,'#624658',.48,.81,0,[.58,.72,1]);
  for(const z of [-.24,.24]){
   orb(.16,'#fff1d7',.06,.15,z,[1.15,.67,1]);
   orb(.16,color,-.15,1.14,z*1.29,[.73,1.32,.84]);
   orb(.056,'#504251',.36,.95,z,[.72,1.16,1]);
   orb(.021,'#fffdfa',.387,.974,z+.009);
   orb(.072,'#f4a1b6',.30,.84,z*1.42,[1,.56,.51]);
  }
  orb(.45,color,0,1.20,0,[1.15,.53,1.12]);
  for(const [x,z] of [[.23,.17],[.09,-.22],[-.25,.12],[-.22,-.24]])orb(.096,'#fff2d7',x,1.35,z,[1,.31,1]);
  const geo=b.build();geo.userData.shared=true;cache.set(key,geo);
 }
 const root=new T.Group(),body=new T.Group(),mat=G.look.vmat({instance:true,rough:.72}),mesh=new T.Mesh(cache.get(key),mat);
 root.add(body);body.add(mesh);mesh.castShadow=true;G.look.outline(mesh,.017);
 return {root,height:1.45,radius:.41,update(e){
  body.rotation.y=e.face<0?Math.PI:0;
  body.rotation.z=e.dead||e.state==='down'?-1.1*e.face:e.pending?-.14*e.face:Math.sin(e.animT*.19)*.055;
  body.position.y=e.state==='move'?Math.abs(Math.sin(e.animT*.27))*.11:0;
  mat.userData.uFlash.value=e.flashT>0?.7:e.atkArmor?.22:0;
 },setAlpha(a){mat.transparent=a<1;mat.opacity=a;},dispose(){mat.dispose();}};
}

const minions=[
 // Type, display name, sculpt, maximum HP, height, and attack.
 ['caterpillarPup','いもむしコロン','caterpillar',42,.90,'roll'],
 ['mantisPup','若葉カマキリ','mantis',47,1.52,'claw'],
 ['beePup','はたらきバチ','bee',36,1.13,'star'],
 ['spiderPup','糸つむぎグモ','spider',50,1.05,'web','slow'],
 ['beetlePup','どんぐりカブト','beetle',66,1.39,'ram'],
 ['antPup','ありの槍兵','ant',44,1.12,'claw'],
 ['mothPup','ねむり蛾','moth',40,1.10,'note','sleep'],
 ['alienPup','ねぼすけグレイ','alien',46,1.32,'claw'],
 ['rayPup','光線探査ローバー','rover',50,1.06,'bolt'],
 ['ufoPup','ちび円盤','saucer',40,1.24,'beam'],
 ['blobPup','星くずスライム','blob',53,1.20,'roll'],
 ['coralPup','あかりクラゲ','jelly',39,1.42,'ice','slow'],
 ['shellPup','貝盾のホプリテス','hoplite',60,1.58,'ram'],
 ['tidePup','はさみ潮ガニ','tideCrab',49,1.12,'claw'],
 ['sharkPup','ちび槍ザメ','shark',58,1.19,'roll'],
 ['bannerPup','旗持ちわんこ','banner',47,1.73,'claw'],
 ['matchlockPup','鉄砲わんこ','matchlock',42,1.25,'bolt'],
 ['helmetPup','大兜わんこ','helmet',65,1.50,'ram'],
 ['ninjaPup','手裏剣わんこ','ninja',43,1.47,'star'],
 ['horsePup','若駒武者わんこ','horse',68,2.11,'ram']
];
const hit={at:5,dur:8,x0:0,x1:1.3,zr:.57,y0:0,y1:1.5,dmg:12,power:2};
const melee={
 roll:{len:27,recover:26,anim:'run',move:[{at:3,until:15,vx:.18},{at:16,vx:0}],hits:[{...hit,y1:.92}]},
 ram:{len:33,recover:32,anim:'run',move:[{at:3,until:19,vx:.16},{at:20,vx:0}],hits:[{...hit,dur:13,dmg:15,power:3}]},
 claw:{len:23,recover:24,anim:'swipe',hits:[{...hit,kind:'slash',dur:6}]}
};
function soldier(id,name,shape,hp,height,mode,status){
 const ranged=!melee[mode],heavy=mode==='ram',cap=shape==='cap';
 const move=ranged?{id:id+'Cast',len:30,recover:33,anim:'throw',
    proj:[{at:7,kind:mode,dmg:status?8:12,oy:Math.min(1,height*.66),vx:mode==='bolt'?.29:.23,status}]}:{id:id+'Strike',...melee[mode]};
 const reach=ranged?5.0:heavy||mode==='roll'?2.2:1.45;
 F.define(id,{name,hp,spd:heavy?.037:.051,armor:heavy?2:0,elite:heavy,squad:ranged?'ranged':'assault',height,
  build:()=>cap?buildCap(id,capColors[id]):G.roundModels.build(shape,1,height),ai(e){
   const p=H.target(e);if(!p){H.stop(e);return;}
   H.face(e,p);
   if(Math.abs(p.x-e.x)>reach||Math.abs(p.z-e.z)>.52){H.walkTo(e,p.x-e.face*reach*.66,p.z);return;}
   H.stop(e);if(e.cool<=0&&H.token(e)&&H.attack(e,move,ranged||heavy?31:25)&&cap)H.say(e,G.ailments?.label(status)+'の胞子！');
  }});
}
const capColors={poisonCap:'#bb91d3',sleepCap:'#8fa9e0',slowCap:'#e5a181'};
soldier('poisonCap','どくキノコわんこ','cap',42,1.45,'shadow','poison');
soldier('sleepCap','ねむりキノコわんこ','cap',42,1.45,'note','sleep');
soldier('slowCap','のろのろキノコわんこ','cap',42,1.45,'ice','slow');
for(const [stage,id] of [[2,'poisonCap'],[3,'sleepCap'],[5,'slowCap']])G.stages[stage].waves[1].foes.push([id,1]);
minions.forEach(args=>soldier(...args));

const bossSize={queenBee:[1.85,2.45,.72],arachne:[1.75,2.08,.78],stag:[1.65,2.15,.8],
 mothership:[1.66,2.25,.85],bioCore:[1.75,2.45,.77],poseidon:[1.55,2.68,.72],
 yoshimoto:[1.40,3.05,.81],shingen:[1.65,2.64,.75],yukimura:[1.40,3.05,.81]};
function bossDefinition(id,name,shape,index){
 const moves=G.roundMoves.make(shape,id);
 const [scale,height,radius]=bossSize[shape]||[1.60,2.72,.69];
 F.define(id,{name,boss:true,elite:true,hp:410+index*20,spd:.062,height,radius,weight:2.35,poise:88,score:1600,xp:82,roundMoves:moves,
  build(e){
   const rig=G.roundModels.build(shape,scale,height);
   if(e){
    const update=rig.update,dispose=rig.dispose;
    rig.update=ent=>{update(ent);G.roundMoves.marks(ent);};
    rig.dispose=()=>{G.roundMoves.marks(e,true);dispose();};
   }
   return rig;
  },
  init(e){e.onInterrupt=()=>G.roundMoves.marks(e,true);},
  onKOTick(e){G.roundMoves.marks(e,true);},
  ai(e){
   const p=H.target(e);if(!p){H.stop(e);return;}
   H.face(e,p);
   const enraged=e.hp<e.maxHp*.5,n=e.roundMove||0;
   const move=moves[enraged&&!e.roundEnraged?3:n%(enraged?4:3)];
   if(Math.abs(p.x-e.x)>move.reach||Math.abs(p.z-e.z)>move.lanes){
    H.walkTo(e,p.x-e.face*Math.min(2,move.reach*.68),p.z);return;
   }
   H.stop(e);if(e.cool>0)return;
   if(H.attack(e,move,move.windup)){
    e.roundEnraged=enraged;
    e.roundMove=moves.indexOf(move)+1;
    H.say(e,move.name+'！');
   }
  }});
}

const themes=G.stage.THEMES;
const weather={
 bug:{sky:['#c2b2ec','#eee0b8','#eff0b0'],fog:'#c6cba3',ground:'#789d6d'},
 space:{sky:['#29254d','#6b609e','#b7acd9'],fog:'#756a99',ground:'#676f9c'},
 sea:{sky:['#244e76','#5aafba','#c8e7da'],fog:'#72b6bd',ground:'#659f9d'},
 war:{sky:['#695173','#c48292','#f1be99'],fog:'#ac8392',ground:'#b4987d'}
};
worlds.forEach((w,worldIndex)=>w.stages.forEach(([name,bossName,base,shape,[a,b,c]],i)=>{
 const lap=worldIndex+2,id='lap'+lap+'Boss'+(i+1),th=themes[base]||themes[w.base],env=weather[w.style];
 bossDefinition(id,bossName,shape,i);
 const start=i===0?'扉の向こうに「'+w.name+'」が広がっている。仲間と一緒に新しい道を進もう。':name+'へ着いた。'+bossName+'がこの先で待っている。';
 const clear=i===w.stages.length-1?w.name+'を踏破した。次の旅に備えて、チャムの店へ戻ろう。':bossName+'を退けた。次は「'+w.stages[i+1][0]+'」へ向かおう。';
 G.stages.push({id:'lap'+lap+'stage'+(i+1),no:G.stages.length+1,lap,chapter:i+1,region:w.name,journeyStyle:w.style,name,kana:name,
  intro:start,epilogue:clear,length:108+i,bgm:'stage'+(2+(i+worldIndex)%7),
  theme:{...th,sky:{...th.sky,top:env.sky[0],mid:env.sky[1],bot:env.sky[2]},fog:{...th.fog,color:env.fog},
    particles:{...th.particles,a:w.color,b:'#fff2c7'},roundStyle:w.style,roundColor:w.color},
  waves:[{at:18,width:15,foes:[[a,2],[b,1]]},{at:43,width:16,foes:[[c,2],[a,1]],reward:'bone'},
    {at:69,width:17,foes:[[a,1],[b,1],[c,2]],then:[[b,1]],reward:'coin'}],
  boss:{type:id,at:91,x:91},hints:[{at:8,name:'モフじい',text:'地面が光ったら、その場所から離れよう。ボスの体力が半分を切ると大技が来るぞ。'}],props:[]});
}));
})();

// Each guardian owns a four-move sequence. The fourth move enters the cycle below half HP.
(function(){'use strict';
const G=window.G,H=G.foes.h,T=window.THREE;
const zone=(at,anchor,x,z,r,zr,fx,dmg,y1=.88,status)=>({at,kind:'zone',anchor,x,z,r,zr,fx,dmg,y1,status});
const shot=(at,kind,angles,speed,damage,extra={})=>({at,kind:'shot',projectile:kind,angles,speed,damage,...extra});
const dash=(at,frames,speed,reach,fx,damage,extra={})=>({at,kind:'dash',frames,speed,reach,fx,damage,...extra});
const blink=(at,offset)=>({at,kind:'blink',offset});
const call=(at,type,offsets)=>({at,kind:'call',type,offsets});
const move=(name,pose,windup,recover,...events)=>({name,pose,windup,recover,events});
const ring=(at,x,z,r,zr,fx,dmg,y1,status)=>zone(at,'target',x,z,r,zr,fx,dmg,y1,status);
const sweep=(at,x,z,r,zr,fx,dmg,y1,status)=>zone(at,'boss',x,z,r,zr,fx,dmg,y1,status);
const catalog={
 scytheKnight:['#c9e98f',[
  move('新緑の二枚刃','sweep',29,32,sweep(13,1.3,-.9,2.6,.67,'slash',18,1.6),sweep(27,1.2,.9,2.4,.67,'slash',20,1.6)),
  move('葉隠れの逆袈裟','rush',36,37,blink(8,-2.5),dash(24,11,.21,1.3,'slash',19)),
  move('花園の風刃','cast',30,34,shot(8,'wave',[-.12,0,.12],.21,11),shot(23,'wave',[-.06,.06],.31,13,{height:1.32})),
  move('花嵐・三日月陣','spin',44,56,sweep(16,.5,0,2.8,1.4,'slash',24,1.8),ring(36,1.5,0,1.5,1.2,'petals',21),ring(36,-1.5,0,1.5,1.2,'petals',21))]],
 queenBee:['#ffc467',[
  move('蜜つぼ落とし','cast',36,38,ring(18,0,0,1.6,1.04,'magic',15,.8,'slow'),ring(40,1.8,0,1.5,.87,'magic',16,.8,'slow')),
  move('女王針の急降下','rush',35,48,blink(5,-3.2),dash(19,20,.25,1.4,'stars',24,{jump:.24})),
  move('働きバチの護衛','cast',31,42,call(15,'beePup',[-1.7,1.7]),shot(30,'star',[0],.34,14)),
  move('六角蜜房・封鎖','cast',46,52,...[[-2,-.9],[-2,.9],[0,0],[2,-.9],[2,.9]].map(([x,z],i)=>ring(22+i*4,x,z,1.05,.51,'magic',20,1.1,'slow')))]],
 arachne:['#e9b4fd',[
  move('鈍り糸の三叉','cast',28,30,shot(10,'web',[-.13,0,.13],.17,9,{status:'slow',radius:.42})),
  move('蜘蛛糸の回廊','cast',38,40,ring(20,0,-1.22,4.1,.35,'magic',13,1.3,'slow'),ring(20,0,1.22,4.1,.35,'magic',13,1.3,'slow'),ring(43,0,0,3.8,.43,'magic',18,1.1,'slow')),
  move('糸渡り・背面落とし','rush',33,40,blink(7,2.1),sweep(27,0,0,1.45,.92,'dustRing',24,1.1)),
  move('糸姫の八重結び','spin',47,55,ring(19,2.15,.85,1.7,.7,'magic',19,1.1,'slow'),ring(19,-2.15,-.85,1.7,.7,'magic',19,1.1,'slow'),ring(43,0,0,2.1,1.5,'magic',27,1.1,'slow'))]],
 stag:['#aac4f1',[
  move('大顎すくい上げ','sweep',32,39,sweep(13,1.15,0,1.45,.76,'slash',22,1.95)),
  move('坑道ぶち抜き','rush',38,46,dash(8,27,.23,1.3,'dustRing',23,{armor:true})),
  move('崩落する岩天井','cast',38,39,ring(17,-2,0,1.1,1.5,'dustRing',19),ring(29,0,0,1.1,1.5,'dustRing',19),ring(41,2,0,1.1,1.5,'dustRing',19)),
  move('二連・鋼大顎','rush',43,56,dash(10,19,.27,1.4,'slash',24,{armor:true}),dash(38,17,.26,1.27,'dustRing',23,{back:true}))]],
 mothQueen:['#f1b4ec',[
  move('夢うつつの鱗粉','cast',35,40,shot(9,'note',[-.14,-.06,.06,.14],.15,9,{status:'sleep',radius:.46})),
  move('羽衣の宵舞い','spin',34,37,sweep(14,-.1,0,2.65,1.3,'petals',19,2.1),blink(25,-2.4),sweep(43,0,.15,1.8,.97,'petals',21,1.45)),
  move('月光を集める繭','cast',33,43,call(11,'mothPup',[-2,2]),ring(32,0,0,2.1,.8,'stars',20,1.5)),
  move('月下・満開の羽','spin',47,53,ring(16,0,-1.35,5,.44,'petals',20,1.3),ring(28,0,1.35,5,.44,'petals',20,1.3),shot(49,'star',[-.2,-.1,0,.1,.2],.25,17))]],
 greyKing:['#b9f6cf',[
  move('三色念動弾','cast',30,33,shot(8,'ball',[-.14],.22,13),shot(16,'ice',[0],.28,12),shot(24,'shadow',[.14],.20,13)),
  move('王冠の引力','cast',38,44,ring(19,0,0,2.0,1.35,'magic',13,2.4,'slow'),ring(40,0,0,.95,.68,'stars',26,2.4)),
  move('短距離転送キック','rush',33,39,blink(4,-2.0),dash(22,10,.19,1.2,'shock',22)),
  move('テレパシー包囲網','cast',46,52,shot(8,'shadow',[0],.25,13,{opposite:true}),shot(24,'beam',[0],.32,20),ring(45,0,0,1.9,.96,'magic',24,2.5))]],
 mothership:['#96edff',[
  move('五点照射','cast',36,40,...[-2.6,-1.3,0,1.3,2.6].map((x,i)=>ring(18+5*i,x,i%2?.35:-.35,.62,.91,'stars',17,2.8))),
  move('掃射する観測光線','spin',34,39,shot(8,'beam',[-.17],.30,16),shot(15,'beam',[-.07],.30,16),shot(22,'beam',[.05],.30,16),shot(29,'beam',[.16],.30,16)),
  move('小型円盤の発進','cast',31,42,call(10,'ufoPup',[-2.1,2.1]),sweep(25,0,0,1.5,1.3,'shock',17)),
  move('円盤プレス・軌道変更','rush',44,60,blink(9,0),sweep(28,0,0,2.55,1.55,'shock',28,1.45),blink(43,2.4),sweep(64,0,0,1.7,1.2,'shock',21,1.45))]],
 bioCore:['#bfa8fd',[
  move('三つ子の分裂','cast',33,42,call(15,'blobPup',[-2.2,0,2.2])),
  move('弾む粘液','cast',31,35,shot(9,'ice',[-.08,0,.08],.18,12,{height:1.32,vy:.10,grav:-.009,bounce:true,status:'slow'})),
  move('伸縮プレス','rush',35,39,dash(8,11,.13,2.3,'shock',20,{radius:1.02,jump:.21}),sweep(30,.28,0,1.6,1.26,'shock',16)),
  move('反応炉・増殖の輪','cast',47,52,ring(17,0,0,.88,.72,'magic',14,1.7,'slow'),ring(32,0,0,1.64,1.06,'magic',16,1.7),ring(50,0,0,2.65,1.55,'magic',24,1.7))]],
 starEmperor:['#ffe3aa',[
  move('双砲十字射撃','cast',34,37,shot(9,'bolt',[-.10,.1],.30,16),shot(20,'beam',[0],.42,19,{height:1.15})),
  move('重装履帯の反転','rush',35,42,dash(7,20,.22,1.42,'dustRing',21,{armor:true}),dash(34,12,.18,1.31,'shock',17,{back:true})),
  move('流星の進入路','cast',40,41,ring(18,2,1,1.36,.85,'stars',20),ring(28,0,0,1.36,.9,'stars',20),ring(38,-2,-1,1.36,.85,'stars',20)),
  move('銀河砲・二重衛星','cast',48,57,shot(10,'beam',[-.17,0,.17],.31,19,{opposite:true}),ring(35,0,0,2.25,1.5,'stars',26,2.65),shot(53,'bolt',[-.10,.10],.4,18))]],
 zeus:['#ffe097',[
  move('雷霆の三段落雷','cast',34,39,ring(17,0,0,.86,.72,'stars',18,3),ring(28,-1.5,.7,.86,.72,'stars',18,3),ring(39,1.5,-.7,.86,.72,'stars',18,3)),
  move('雲上の稲妻槍','cast',28,32,shot(8,'bolt',[0],.46,19,{height:1.52}),shot(18,'bolt',[-.09,.09],.34,13,{height:.40})),
  move('雷雲踏み','rush',36,42,dash(9,13,.21,1.22,'shock',17,{jump:.25}),sweep(36,0,0,2.2,1.45,'stars',22)),
  move('天界・雷の五線','cast',48,55,...[-2,-1,0,1,2].map((z,i)=>ring(18+i*7,0,z,3.7,.26,'stars',24,3)))]],
 poseidon:['#a2eff0',[
  move('三叉槍・潮割り','sweep',33,35,sweep(13,1.8,0,2.75,.46,'slash',21,1.45),shot(23,'ice',[-.14,.14],.25,12)),
  move('押し寄せる大波','cast',38,45,...[-1.55,0,1.55].map(z=>shot(11,'tidal',[0],.21,20,{height:.18,lane:z,radius:.43,pierce:3}))),
  move('海獣の入江','cast',33,44,call(11,'sharkPup',[-2.1,2.1]),ring(33,0,0,1.2,1.04,'ice',17,1.4)),
  move('海神・満ち潮と引き潮','spin',46,58,ring(18,0,0,2.8,1.40,'ice',22),shot(33,'tidal',[0],.28,22,{height:.2,opposite:true,pierce:3,radius:.5}),ring(53,0,0,1.15,1.10,'ice',28,2.2))]],
 hades:['#c7a9fb',[
  move('冥府の灯籠','cast',33,38,shot(9,'shadow',[-.08,.08],.16,12,{status:'poison',radius:.48})),
  move('影からの二叉槍','rush',36,42,blink(8,2.35),sweep(24,1.7,0,2.4,.61,'slash',23,1.72)),
  move('ステュクスの番人','cast',36,44,call(13,'tidePup',[-2.2,2.2]),ring(34,0,0,2.7,.39,'magic',21,1.2,'slow')),
  move('冥王・深淵の門','cast',48,60,ring(20,-2.1,-.9,1.62,.67,'magic',20,2.2,'poison'),ring(20,2.1,.9,1.62,.67,'magic',20,2.2,'poison'),blink(32,-.5),sweep(50,0,0,2.1,1.46,'magic',27,2.55))]],
 nobunaga:['#fc9b83',[
  move('天守の火縄斉射','cast',31,38,shot(9,'fire',[-.15,0,.15],.32,13),shot(23,'fire',[-.06,.06],.39,15)),
  move('紅蓮の抜刀','rush',34,41,dash(8,19,.26,1.55,'slash',23,{armor:true}),sweep(32,-1.4,0,2.03,.58,'flame',16)),
  move('天守の火柱','cast',39,43,ring(18,-1.7,0,1.03,1.35,'flame',18,2.4),ring(33,1.6,0,1.03,1.35,'flame',19,2.4)),
  move('第六天魔・三段火線','cast',48,56,shot(10,'fire',[0],.3,18,{opposite:true}),ring(31,0,-1.2,4.4,.36,'flame',21,2.2),ring(54,0,1.2,4.4,.36,'flame',24,2.2))]],
 hideyoshi:['#ffda8e',[
  move('黄金扇の乱れ舞い','spin',28,34,shot(7,'card',[-.20,-.10,0,.10,.20],.23,12)),
  move('一夜城の陣','cast',37,45,call(17,'bannerPup',[-1.5,1.5]),ring(34,0,0,1.45,.9,'shock',18)),
  move('金のつづら落とし','cast',33,40,ring(18,-1.45,1,1.2,.75,'stars',17),ring(29,1.45,-1,1.2,.75,'stars',17),ring(40,0,0,.98,.98,'stars',22)),
  move('天下の黄金吹雪','spin',43,53,sweep(13,0,0,2.5,1.42,'petals',20,2),shot(31,'card',[-.23,-.14,-.05,.05,.14,.23],.28,14),sweep(51,1.2,0,2.0,.9,'stars',25,1.8))]],
 ieyasu:['#d6e5a1',[
  move('葵紋の盾押し','rush',34,42,dash(7,19,.14,1.50,'shock',18,{armor:true,radius:1.03})),
  move('三方ヶ原の待ち伏せ','cast',39,42,ring(20,1.7,-1.15,1.7,.64,'dustRing',17),ring(20,-1.7,1.15,1.7,.64,'dustRing',17),shot(34,'arrow',[0],.35,15)),
  move('重なる槍ぶすま','cast',35,37,shot(8,'arrow',[0],.24,15,{lane:-.85}),shot(17,'arrow',[0],.26,15,{lane:0}),shot(26,'arrow',[0],.28,15,{lane:.85})),
  move('三河の包囲陣','cast',45,60,call(10,'helmetPup',[-2.5,2.5]),shot(31,'arrow',[0],.38,19,{opposite:true}),sweep(54,0,0,2.7,1.46,'shock',25,1.9))]],
 yoshimoto:['#e0b4ed',[
  move('輿上の曲射','cast',29,36,shot(8,'arrow',[-.07,0,.07],.17,15,{height:1.85,vy:.08,grav:-.009})),
  move('雨雲・桶狭間','cast',38,44,...[[-1.7,-.9],[1.7,.9],[0,0]].map(([x,z],i)=>ring(18+i*13,x,z,1.32,.72,'ice',18,1.45))),
  move('輿担ぎの横断','rush',35,41,dash(9,18,.18,1.46,'dustRing',20,{sidestep:.09})),
  move('豪雨の遠矢','cast',47,54,shot(12,'arrow',[0],.26,20,{opposite:true,height:.50}),ring(32,0,0,3.3,.47,'ice',22),shot(52,'arrow',[-.12,.12],.34,17,{height:1.52}))]],
 kenshin:['#e9e5ff',[
  move('白頭巾の一閃','rush',30,34,blink(6,-2.1),dash(22,12,.24,1.28,'slash',23)),
  move('川霧の払い','sweep',33,35,sweep(15,1,0,2.9,1.05,'ice',19,1.4),shot(27,'wave',[-.10,.10],.32,14,{height:.52})),
  move('毘沙門の空斬','rush',36,42,dash(9,15,.17,1.20,'slash',20,{jump:.29}),sweep(39,0,0,1.9,.9,'shock',19,.9)),
  move('朝霧・三方抜刀','spin',45,55,blink(5,2.3),sweep(23,1.4,0,2.25,.62,'slash',24,1.9),blink(33,-2.3),sweep(51,1.4,0,2.25,.62,'slash',24,1.9))]],
 shingen:['#ffc69c',[
  move('風・軍配払い','cast',31,33,shot(8,'wave',[-.12,0,.12],.31,15)),
  move('林・山城の伏兵','cast',33,44,call(13,'ninjaPup',[-2.0,2.0]),ring(32,0,0,1.42,.83,'dustRing',18)),
  move('山・動かぬ陣','sweep',38,41,sweep(18,1,0,2.6,1.3,'shock',23,1.08),sweep(40,0,0,1.7,1.0,'shock',18)),
  move('火・赤備えの突進','rush',45,56,dash(9,23,.24,1.40,'flame',27,{armor:true}),ring(45,-1.9,0,1.55,1.13,'flame',20,1.28),ring(45,1.9,0,1.55,1.13,'flame',20,1.28))]],
 masamune:['#b2d9ff',[
  move('独眼・氷点狙撃','cast',37,40,shot(11,'bolt',[0],.52,23,{height:.78,radius:.22})),
  move('三日月の雪払い','spin',32,36,sweep(12,.6,0,2.4,1.35,'slash',20,1.62),shot(28,'ice',[-.12,0,.12],.22,12,{status:'slow'})),
  move('雪原の移動射撃','rush',31,43,dash(6,15,.13,1,'ice',14,{sidestep:-.08}),shot(21,'bolt',[0],.43,19)),
  move('奥州・凍月砲','cast',47,57,ring(19,0,0,3.6,.52,'ice',19,1.27,'slow'),shot(38,'beam',[0],.56,27,{height:.95}),shot(53,'ice',[-.18,.18],.25,16,{status:'slow'}))]],
 yukimura:['#ffa5a0',[
  move('赤備え・槍疾駆','rush',35,41,dash(9,22,.28,1.48,'slash',24,{armor:true})),
  move('十文字槍の返し','sweep',32,36,sweep(14,1.63,0,2.75,.38,'slash',20,1.82),sweep(32,.7,0,1.66,1.33,'slash',18,1.62)),
  move('真田丸の騎馬隊','cast',34,46,call(16,'horsePup',[-2.0,2.0]),shot(29,'arrow',[-.12,.12],.25,13)),
  move('六文銭・駆け抜け六段','rush',46,58,dash(8,19,.30,1.5,'slash',23),...[0,1,2,3,4,5].map(i=>ring(32+i*5,(i%3-1)*1.35,i<3?-.8:.8,.60,.48,'stars',15)))]],
 motonari:['#dce7a6',[
  move('三本の矢','cast',31,37,shot(9,'arrow',[-.16,0,.16],.32,16)),
  move('引き潮の交差射線','cast',34,38,shot(10,'arrow',[0],.35,15,{opposite:true,lane:-.75}),shot(20,'arrow',[0],.35,15,{lane:.75})),
  move('厳島の潮だまり','cast',39,43,ring(17,0,0,2.4,.8,'ice',16,.7,'slow'),ring(41,0,0,1.25,1.5,'ice',21,.75)),
  move('三矢・潮風の大弓','cast',46,56,shot(14,'arrow',[0],.42,19,{lane:-1.3}),shot(29,'arrow',[0],.46,20,{opposite:true}),shot(44,'arrow',[0],.42,21,{lane:1.3,pierce:3}))]],
 ujiyasu:['#d8ca9d',[
  move('総構え・大盾押し','rush',34,41,dash(8,18,.15,1.53,'shock',20,{armor:true,radius:1.15})),
  move('門の落とし格子','cast',39,44,ring(18,-1.75,0,.82,1.64,'dustRing',19,2.2),ring(18,1.75,0,.82,1.64,'dustRing',19,2.2),ring(43,0,0,1.05,1.38,'dustRing',24,2.3)),
  move('石垣からの飛礫','cast',32,36,shot(10,'rock',[-.13,0,.13],.18,13,{height:1.5,vy:.09,grav:-.013,bounce:true})),
  move('小田原・鉄門崩し','sweep',47,58,sweep(14,0,0,2.5,1.4,'shock',24),dash(30,17,.23,1.64,'dustRing',22,{armor:true}),ring(60,0,0,2.48,.52,'dustRing',26))]],
 yoshihiro:['#ff957d',[
  move('坊主割りの大槌','sweep',35,41,sweep(17,1.5,0,2.3,.88,'shock',25,1.25)),
  move('薩摩の火口弾','cast',34,39,shot(10,'fire',[-.12,0,.12],.18,14,{height:1.42,vy:.145,grav:-.012,bounce:true})),
  move('鬼の返り突撃','rush',37,43,dash(8,17,.23,1.3,'dustRing',20),dash(33,14,.24,1.33,'flame',20,{back:true})),
  move('鬼島津・噴火の大太鼓','spin',48,62,ring(17,0,0,2.0,1.25,'flame',22,2.4),ring(38,-2.3,-1.03,1.52,.83,'flame',21,2.5),ring(38,2.3,1.03,1.52,.83,'flame',21,2.5),sweep(62,0,0,2.9,1.52,'shock',30,1.1))]]
};

// A second technique in the transformed form. These use different safe
// spaces: returning shots, sustained traps, beam lanes and staggered blasts.
const beam=(at,x,z,r,zr,y1=1.12,dmg=23)=>({...ring(at,x,z,r,zr,'shock',dmg,y1),box:true,linger:10});
const trap=(at,x,z,r,zr,fx,dmg,status)=>({...ring(at,x,z,r,zr,fx,dmg,.84,status),linger:24});
const returning=(at,kind,angles,speed,damage,extra={})=>shot(at,kind,angles,speed,damage,{returnAt:19,pierce:2,...extra});
const transformed={
 scytheKnight:move('若葉の返り刃','spin',40,44,returning(12,'wave',[-.18,.18],.30,18),sweep(39,0,0,2.32,.91,'petals',23)),
 queenBee:move('花蜜の落とし穴','cast',40,49,trap(18,1.1,.75,1.18,.58,'magic',15,'slow'),trap(18,-1.1,-.75,1.18,.58,'magic',15,'slow'),shot(42,'star',[-.15,0,.15],.23,15,{height:1.54,vy:.06,grav:-.008,bounce:true})),
 arachne:move('八脚の糸車','spin',43,48,trap(17,0,-.96,3.1,.26,'magic',12,'slow'),trap(31,0,.96,3.1,.26,'magic',12,'slow'),returning(44,'web',[-.07,0,.07],.23,17,{status:'slow',returnAt:13})),
 stag:move('樹液坂の大角返し','rush',41,47,dash(8,18,.25,1.32,'dustRing',19,{armor:true}),{...sweep(33,-1.52,0,2.25,.83,'slash',23,2.28),launch:.40}),
 mothQueen:move('夢紡ぎの羽音','cast',42,48,returning(8,'note',[-.19,-.10,.10,.19],.20,11,{status:'sleep'}),trap(44,0,0,1.44,1.11,'petals',24)),
 greyKing:move('念力・裏返る星','cast',40,47,returning(9,'ball',[-.18,0,.18],.29,17,{returnAt:21}),beam(47,.43,0,2.18,.38,1.50,24)),
 mothership:move('母艦レーザー・三面掃射','cast',42,53,beam(19,0,-1.12,4.7,.22,2.42),beam(30,0,1.12,4.7,.22,2.42),beam(49,0,0,4.7,.26,2.42,27)),
 bioCore:move('核のぜんまい分裂','spin',38,47,call(6,'blobPup',[-2.3,0,2.3]),trap(21,-1.35,.75,1.1,.61,'magic',14,'slow'),trap(29,1.35,-.75,1.1,.61,'magic',14,'slow'),shot(52,'ice',[-.19,.19],.20,19,{vy:.11,grav:-.009,bounce:true})),
 starEmperor:move('双衛星の包囲砲','cast',38,51,returning(9,'beam',[0],.34,17,{lane:-.96}),returning(19,'beam',[0],.34,17,{lane:.96,opposite:true}),beam(51,0,0,4.0,.40,2.1,28)),
 zeus:move('稲妻が走る雲階段','cast',41,47,...[0,1,2,3].map(i=>ring(17+11*i,-2.4+i*1.6,i%2?.7:-.7,.81,.74,'thunder',21,3.25))),
 poseidon:move('三叉槍・返る白波','sweep',41,48,returning(10,'tidal',[0],.24,18,{lane:-.79,height:.23,returnAt:22}),returning(20,'tidal',[0],.24,18,{lane:.79,height:.23,returnAt:22}),ring(47,0,0,2.38,.78,'ice',25,1.33)),
 hades:move('冥門をめぐる鬼火','cast',43,54,trap(17,1.71,0,1.22,1.22,'magic',14,'poison'),trap(17,-1.71,0,1.22,1.22,'magic',14,'poison'),returning(38,'shadow',[-.18,0,.18],.24,18,{opposite:true,status:'poison'})),
 nobunaga:move('火縄七連・追い火','cast',40,48,...[-.24,-.16,-.08,0,.08,.16,.24].map((a,i)=>shot(8+4*i,'fire',[a],.29+i*.025,12)),beam(51,0,0,3.9,.35,1.73,26)),
 hideyoshi:move('金扇・ひらり返し','spin',38,47,returning(10,'card',[-.25,-.13,0,.13,.25],.26,15,{height:1.05}),blink(34,1.65),sweep(52,0,0,2.12,1.11,'stars',23,1.62)),
 ieyasu:move('三葉の盾陣','sweep',38,49,sweep(14,.95,-.85,1.95,.56,'shock',20),sweep(24,.95,.85,1.95,.56,'shock',20),dash(38,22,.19,1.35,'shock',26,{armor:true,radius:.94})),
 yoshimoto:move('にわか雨の五連矢','cast',36,48,...[-1.42,-.7,0,.7,1.42].map((z,i)=>shot(8+i*8,'arrow',[0],.24,16,{lane:z,height:1.57,vy:.13,grav:-.012,opposite:i%2===1}))),
 kenshin:move('月白・影渡り','rush',37,49,blink(7,-2.25),dash(22,12,.25,1.3,'ice',20,{sidestep:.045}),blink(37,2.15),sweep(54,1.32,0,2.22,.77,'slash',24,1.65)),
 shingen:move('山の軍配、風の返し','cast',42,48,sweep(16,0,0,2.9,.89,'dustRing',23),returning(31,'wave',[-.21,0,.21],.25,18,{returnAt:15})),
 masamune:move('三日月・雪煙の十字砲','cast',40,49,beam(19,0,0,.84,1.67,1.8,20),shot(37,'ice',[-.13,.13],.29,12,{status:'slow'}),beam(49,0,0,4.42,.31,1.76,27)),
 yukimura:move('赤駒の跳ね槍','rush',40,51,dash(8,15,.20,1.24,'dustRing',18,{jump:.29,armor:true}),{...sweep(37,0,0,2.27,.78,'shock',24),launch:.34},shot(51,'arrow',[-.15,0,.15],.31,14)),
 motonari:move('三本の矢・潮の巻き返し','cast',39,48,shot(9,'arrow',[0],.48,17,{lane:-1.45}),shot(20,'arrow',[0],.40,17,{lane:0,opposite:true}),returning(31,'arrow',[0],.37,18,{lane:1.45,returnAt:14}),ring(47,0,0,1.57,1.14,'ice',19,.65,'slow')),
 ujiyasu:move('石垣・みっつの通せんぼ','cast',42,51,beam(19,-1.78,0,.55,1.57,2.35,21),beam(19,1.78,0,.55,1.57,2.35,21),shot(37,'rock',[-.17,0,.17],.22,17,{vy:.13,grav:-.012,bounce:true}),dash(48,16,.21,1.35,'dustRing',23)),
 yoshihiro:move('溶岩太鼓の四拍子','spin',42,54,...[[-1.78,0],[0,.9],[1.78,0],[0,-.9]].map(([x,z],i)=>trap(16+i*13,x,z,1.07,.59,'flame',19)),{...sweep(62,0,0,2.5,1.13,'shock',26),launch:.28})
};

const ringGeometry=new T.RingGeometry(.89,1,36);
const discGeometry=new T.CircleGeometry(1,36);
const hexRing=new T.RingGeometry(.89,1,6);
const hexDisc=new T.CircleGeometry(1,6);
const boxDisc=new T.PlaneGeometry(2,2);
const boxBorder=new T.EdgesGeometry(boxDisc);
const beamGeo=new T.BoxGeometry(2,1,2);
const signatures={
 queenBee:'honey',arachne:'web',mothership:'column',zeus:'lightning',
 poseidon:'tide',hades:'gate',nobunaga:'fire',yoshihiro:'fire'
};
function lines(paths){
 const points=[];
 for(const path of paths)for(let i=1;i<path.length;i++)points.push(...path[i-1],...path[i]);
 const geometry=new T.BufferGeometry();
 geometry.setAttribute('position',new T.Float32BufferAttribute(points,3));
 return geometry;
}
const loop=(count,r,y)=>Array.from({length:count+1},(_,i)=>{
 const angle=i*Math.PI*2/count;
 return [Math.cos(angle)*r,y,Math.sin(angle)*r];
});
const impactGeometry={
 honey:lines([loop(6,1,.03),loop(6,.76,.30),loop(6,.57,.54)]),
 web:lines([... [.34,.65,.93].map(radius=>loop(8,radius,.08)),...loop(8,1,.08).slice(0,8).map(point=>[[0,.08,0],point])]),
 column:new T.CylinderGeometry(.24,.84,1,24,1,true),
 lightning:lines([[[.32,1.23,0],[.06,.73,.04],[.36,.74,0],[-.32,.24,-.03],[-.10,.26,0],[0,0,0]],
                  [[-.48,.13,0],[0,0,0],[.55,.15,.12]]]),
 tide:lines([loop(32,.95,.12),loop(32,.62,.27),loop(32,.35,.41)]),
 gate:lines([[[.83,.06,0],[.83,.48,0],[.63,.74,0],[.35,.93,0],[-.35,.93,0],[-.63,.74,0],[-.83,.48,0],[-.83,.06,0]],
              [[.55,.06,0],[.55,.43,0],[.33,.66,0],[-.33,.66,0],[-.55,.43,0],[-.55,.06,0]]]),
 fire:new T.ConeGeometry(.59,1,16,1,true)
};
function impact(e,ev,loc,color,signature){
 const geometry=ev.box?beamGeo:impactGeometry[signature];
 if(!geometry)return;
 const solid=ev.box||signature==='column'||signature==='fire',height=Math.max(.8,ev.y1);
 const options={color,transparent:true,depthWrite:false,opacity:ev.box?.33:solid?.59:1};
 const material=solid?new T.MeshBasicMaterial({...options,side:T.DoubleSide}):new T.LineBasicMaterial(options);
 const group=solid?new T.Mesh(geometry,material):new T.LineSegments(geometry,material);
 group.position.set(loc.x,solid?height*.5:.075,loc.z);
 group.scale.set(ev.r,height,ev.zr);
 group.renderOrder=8;G.scene.add(group);
 (e.roundMarks||=[]).push({group,material,attack:e.atk,expires:ev.at+10});
}
function marker(owner,event,x,z,color,signature){
 const material=new T.MeshBasicMaterial({color,transparent:true,opacity:.96,side:T.DoubleSide,depthWrite:false});
 const fill=material.clone();fill.opacity=.27;
 const group=new T.Group();
 const hex=signature==='honey'&&!event.box;
 group.add(new T.Mesh(event.box?boxDisc:hex?hexDisc:discGeometry,fill));
 const edge=event.box?new T.LineSegments(boxBorder,new T.LineBasicMaterial({color,transparent:true,opacity:.98,depthWrite:false})):new T.Mesh(hex?hexRing:ringGeometry,material);
 group.add(edge);
 group.rotation.x=-Math.PI/2;group.scale.set(event.r,event.zr,1);
 group.position.set(x,.073,z);group.renderOrder=7;G.scene.add(group);
 const cue={group,material,fill,edge:edge.material===material?null:edge.material,attack:owner.atk,expires:event.at};
 (owner.roundMarks||=[]).push(cue);
}
function removeMark(cue){cue.group.removeFromParent();cue.material.dispose();cue.fill?.dispose();cue.edge?.dispose();}
function marks(e,all=false){
 if(!e.roundMarks?.length)return;
 for(let i=e.roundMarks.length-1;i>=0;i--){
  const cue=e.roundMarks[i];
  if(!all&&!e.dead&&!e.removed&&e.atk===cue.attack&&e.atk.t<=cue.expires){
   if(cue.fill)cue.fill.opacity=.27+(Math.sin(e.atk.t*.4)+1)*.052;
   else cue.material.opacity*=.84;
   continue;
  }
  removeMark(cue);e.roundMarks.splice(i,1);
 }
}
const within=(x,z)=>{
 const b=G.stage?.bounds?.()||{};
 return [G.U.clamp(x,(b.xmin??-100)+.65,(b.xmax??100)-.65),G.U.clamp(z,b.zmin??G.cfg.ZMIN,b.zmax??G.cfg.ZMAX)];
};
function shoot(e,ev,target){
 const lane=ev.lane==null?e.z:ev.lane;
 const [x,z]=ev.opposite?within(target.x+Math.sign(target.x-e.x||1)*3.3,ev.lane==null?target.z:lane):
   within(e.x+e.face*.72,lane);
 const angle=ev.lane!=null?0:Math.atan2(target.z-z,Math.max(1.6,Math.abs(target.x-x)));
 const face=Math.sign(target.x-x)||e.face;
 for(const offset of ev.angles){
  const a=angle+offset;
  H.shoot(e,{kind:ev.projectile,x,y:ev.height??.75,z,vx:face*Math.cos(a)*ev.speed,vz:Math.sin(a)*ev.speed,
   vy:ev.vy||0,grav:ev.grav||0,returnAt:ev.returnAt,life:ev.returnAt?59:88,r:ev.radius||.28,dmg:ev.damage,status:ev.status,pierce:ev.pierce||0,onGround:ev.bounce?'bounce':'die'});
 }
}
function compile(card,id,color,signature){
 const {events}=card;
 const dashEvents=events.filter(e=>e.kind==='dash');
 const tracksPlayer=events.some(e=>e.kind==='blink'||e.kind==='shot'||e.anchor==='target');
 return {
  id,name:card.name,motion:events.map(e=>({at:e.at,kind:e.kind,side:Math.sign(e.z||e.sidestep||e.offset||0)})),windup:card.windup,reach:tracksPlayer?6.1:dashEvents.length?3.3:2.65,
  lanes:tracksPlayer?1.35:.67,len:Math.max(...events.map(e=>e.at+(e.frames||e.linger||0)))+12,
  anim:card.pose==='rush'?'run':card.pose==='cast'?'throw':'swipe',pose:card.pose,recover:card.recover,
  armor:dashEvents.some(e=>e.armor),onEnd(e){e.vx=e.vz=0;marks(e,true);},
  fn(e,t){
   const a=e.atk;
   if(!a.roundTarget)a.roundTarget=H.target(e);
   const p=a.roundTarget;
   if(!p||p.dead||p.removed)return;
   a.roundPositions||=new Map();
   for(const ev of events){
    if(ev.kind==='zone'&&t===Math.max(0,ev.at-16)){
     const target=ev.anchor==='boss'?e:p;
     const [x,z]=within(target.x+(ev.anchor==='boss'?e.face:1)*ev.x,target.z+ev.z);
     a.roundPositions.set(ev,{x,z});marker(e,ev,x,z,color,signature);
    }
    if(ev.kind==='dash'&&t>=ev.at&&t<ev.at+ev.frames){
     const face=(ev.back?-1:1)*e.face;
     e.vx=face*ev.speed;e.vz=ev.sidestep||0;
     if(t===ev.at&&ev.jump){e.vy=ev.jump;e.onGround=false;}
     if((t-ev.at)%7===0){
      G.fx?.burst?.(ev.fx,e.x+face*.55,e.y+.4,e.z,{color,scale:1,dir:face});
      G.combat.area({owner:e,x:e.x+face*.5,y:e.y,z:e.z,r:ev.reach,zr:ev.radius||.62,y1:1.35,dmg:ev.damage,power:2,dur:1});
     }
    }
    if(ev.kind==='dash'&&t===ev.at+ev.frames){e.vx=e.vz=0;}
    if(t!==ev.at)continue;
    if(ev.kind==='shot')shoot(e,ev,p);
    else if(ev.kind==='zone'){
     const loc=a.roundPositions.get(ev);
     impact(e,ev,loc,color,signature);
     if(ev.linger>10){
      marker(e,{...ev,at:ev.at+ev.linger},loc.x,loc.z,'#ffc18a',signature);
     }
     G.combat.area({owner:e,...loc,y:0,r:ev.r,zr:ev.zr,y1:ev.y1,dmg:ev.dmg,up:ev.launch??.20,
       power:ev.dmg>=24||ev.launch?3:2,dur:ev.linger||4,box:ev.box,fx:ev.fx,color,status:ev.status});
    }else if(ev.kind==='blink'){
     G.fx?.burst?.('smoke',e.x,.5,e.z,{color});
     [e.x,e.z]=within(p.x+ev.offset*e.face,p.z);
     G.fx?.burst?.('smoke',e.x,.5,e.z,{color});
     H.face(e,p);
    }else if(ev.kind==='call'){
     let summoned=G.world.ents.filter(a=>a.roundSummoner===e&&!a.dead&&!a.removed).length;
     for(const x of ev.offsets){
      if(summoned>=3)break;
      const [sx,sz]=within(e.x+x,e.z+(x<0?-.9:.9));
      const minion=H.spawnMinion(ev.type,sx,sz,{y:2.4,hpMul:.65});
      if(minion){minion.roundSummoner=e;summoned++;}
     }
    }
   }
  }
 };
}
G.roundMoves={
 color:shape=>catalog[shape][0],
 make(shape,id){const [color,cards]=catalog[shape];return [...cards,transformed[shape]].map((card,i)=>compile(card,id+'Move'+(i+1),color,signatures[shape]));},
 marks
};
})();

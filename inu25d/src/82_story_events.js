// Cinematic coordinator. UI age is separate from combat/native clocks. No attack
// definitions or command dispatch are owned here.
(function(){'use strict';const G=window.G;
// Phase dressing owns its geometry/materials; never recolor shared rig resources.
G.bossPhaseVisual=function(e,rig=e?.rig){if(e?._frenzyShift||(!e?.phase&&!e?._frenzyForm)||!rig?.root||rig.phaseDressing)return rig?.phaseDressing||null;
 const T=window.THREE,height=e.height||e.def?.height||2.5,colors={garm:'#ff8e48',shark:'#5cdde8',ghost:'#c283ff',cerbe:'#ff654e',slime:'#7dff80',dragon:'#ffce48',kuroinu:'#b989ff',emperor:e.form===3?'#ffe7a1':'#ff657a'},color=e.def?.frenzyColor||colors[e.type]||'#ffb36c';
 const group=new T.Group();group.name='rage-dressing-'+e.type+'-'+(e.form||1);const parent=rig.kit?.body||rig.root;parent.add(group);
 const mat=new T.MeshStandardMaterial({color,emissive:color,emissiveIntensity:.65,metalness:.35,roughness:.4}),geos=[];
 const add=(geo,x,y,z,rz=0)=>{geos.push(geo);const m=new T.Mesh(geo,mat);m.position.set(x,y,z);m.rotation.z=rz;group.add(m);return m;};
 const style=e.def?.frenzyStyle;
 const n=e.type==='cerbe'||style==='bug'?9:e.type==='ghost'||style==='space'?3:e.type==='slime'?5:7;
 for(let i=0;i<n;i++){
  const a=(i/(n-1)-.5)*Math.PI*.8,yy=height*.7+Math.cos(a)*height*.2,zz=Math.sin(a)*height*.28;
  if(style==='bug'){
   const petal=add(new T.SphereGeometry(height*.067,9,6),-.29,yy,zz);
   petal.scale.set(.65,1.8,.85);petal.rotation.x=a;
  }else if(style==='space'){
   add(new T.OctahedronGeometry(height*.087),0,height*(.6+i*.03), (i-1)*height*.51, i*.52);
  }else if(style==='sea'){
   const pearl=add(new T.SphereGeometry(height*.061,9,6),-.22,yy,zz);
   pearl.scale.y=1.38;
  }else if(e.type==='ghost'||e.type==='slime')add(new T.SphereGeometry(height*.05,8,6),-.13,yy,zz);
  else add(new T.ConeGeometry(height*.045,height*.2,6),-.16,yy,zz,(i-(n-1)/2)*.18);
 }
 const halo=add(new T.TorusGeometry(height*(style==='space'?.55:.25),height*.015,5,32),-.28,height*.68,0);
 if(style==='space'){halo.rotation.x=Math.PI/2+.23;halo.rotation.z=.19;}
 else halo.rotation.y=Math.PI/2;
 group.userData={type:e.type,form:e.form||1,phase:e.phase,distinctParts:n+1};rig.phaseDressing=group;
 const dispose=rig.dispose?.bind(rig);let disposed=false;rig.dispose=()=>{if(disposed)return;disposed=true;group.removeFromParent();for(const g of geos)g.dispose();mat.dispose();dispose?.();};return group;
};
const HEROES={
 kuro:{name:'黒犬士',color:'#b883a2',cue:'大剣を肩から下ろし、無言で仲間の前へ立つ',win:'大剣を背負い、助けた子犬の頭をなでる',
  start:['でかい剣だって、守るために使えばいい。行こう。'],clear:['もう大丈夫だ。いっしょに帰るぞ。']},

 inu:{name:'聖犬士イッヌ',color:'#e1ac36',cue:'剣を胸にかかげ、仲間にうなずく',win:'剣をおさめ、みんなへおじぎ',
  start:['王都のみんなを、ぼくが守る！','夕やみでも、聖剣の光は消えない！','森でこまった子が待ってる。行こう！','水晶の道を、光でてらそう！','飛行艇のみんなを助けに行くよ！','雪の向こうにも、笑顔をとどけよう！','クロイヌも王さまも、必ず助ける！'],
  clear:['町に笑顔がもどったね！','灯りをつけよう。もう大丈夫！','森のみんな、こわかったね。もう安心！','水晶がきれいに光ってる！','空の旅は、なかよく行こうね！','寒かったね。みんなであたたまろう！','光は、みんなのものだよ！']},
 shima:{name:'拳法家シマ',color:'#d78238',cue:'足をふみかえ、左右のこぶしを合わせる',win:'こぶしを合わせて礼、最後にピース',
  start:['準備体操よし！ 町へ急ごう！','夕焼けに負けない、熱いこぶしだ！','木のかげも、見のがさないぞ！','足もと注意！ 気合いで行くぞ！','ゆれる甲板？ ぼくの足わざの出番！','寒いときこそ、拳法でぽかぽか！','最後のけいこだ。全力で行くぞ！'],
  clear:['町を守るけいこ、大成功！','いい汗かいた！ 次も行けるぞ！','森のみんなと、なかよく礼！','すべらず着地！ けいこは大事だ！','空でも足わざ、ばっちりだ！','みんなも体操！ ぽかぽかだろ？','勝っても礼をわすれずに！']},
 nuko:{name:'魔法使いヌコ',color:'#b36dd8',cue:'星の杖で道をなぞり、両手で光を集める',win:'杖で星をえがき、くるりとおじぎ',
  start:['町に、やさしい魔法をかけましょう！','星の灯りで、道をてらすわ！','森の声が聞こえる。助けに行くわ！','水晶さん、力をかしてね！','空と風の魔法なら、まかせて！','雪の結晶が案内してくれるわ！','暗いお城にも、星をとどけるわ！'],
  clear:['町の笑顔が、いちばんの魔法ね！','灯りがいっぱい。きれいね！','森の声が、明るくなったわ！','水晶さん、ありがとう！','空に星をひとつ、プレゼント！','冷たい雪にも、やさしい光ね！','ほら、お城にも星がもどったわ！']},
 guard8:{name:'ガード犬8番',color:'#cf9b4e',cue:'ハンマーを立てて盾になり、一歩前へ',win:'ハンマーを休め、両手をひろげて笑う',
  start:['町のみんなは、ぼくの後ろへ！','暗い道も、どっしり進むよ！','木をいためずに、森を守るぞ！','天井に注意。ぼくが支える！','甲板をこわさず、しっかり守る！','雪道は、ぼくが先に歩くよ！','お城への道は、ぼくが開く！'],
  clear:['よし！ 町のみんな、けがはない？','町の灯り、守りきったぞ！','森も仲間も、みんな無事だ！','水晶を守ったぞ。ほっとした！','船は無事！ 安心して乗ってね！','みんなの足あと、ちゃんとあるね！','これからは、みんなを守るお城だ！']},
 watch:{name:'怪盗ウォッチ',color:'#739fc6',cue:'帽子に手をそえ、カードをかくして一礼',win:'帽子からカードを見せ、幕引きの一礼',
  start:['町の平和、取りもどしてみせよう！','夕やみは、怪盗の舞台さ！','森の迷路？ ぬけ道を見つけるよ！','水晶の光に、合図をかくそう！','空の船に、そっと参上！','雪に足あとを残さず…おっと！','最後の宝物は、みんなの笑顔さ！'],
  clear:['お返ししよう。町の平和をね！','夕やみの舞台、これにて終演！','森の出口はこちら。どうぞ！','光のトリック、大成功！','飛行艇のみなさん、よい旅を！','足あとは…見なかったことに！','最高のお宝は、ここにあったね！']},
 wanden:{name:'侍ワンデン',color:'#ae5146',cue:'さやを引き寄せ、静かに居合いの構え',win:'ゆっくり納刀し、仲間へ深い礼',
  start:['町を守る。それが武士のつとめ。','夕映えの道、心は静かに。','木々の声に耳をすませよう。','水晶の間合い、見切って進む。','ゆれる足場こそ、心をしずめる。','雪の道、一歩ずつ確かに。','クロイヌよ。話は剣のあとだ。'],
  clear:['町の平穏、取りもどした。','夕焼けに、よい知らせを。','森は、静けさを取りもどした。','水晶の光、見事なものだ。','空の旅路に、幸あれ。','雪にも、春はやってくる。','剣をおさめよう。友として。']},
 mack:{name:'保安官マック',color:'#df9251',cue:'帽子を上げ、玩具のポッパーを点検する',win:'ポッパーを回しておさめ、帽子であいさつ',
  start:['町の安全、保安官にまかせな！','夕暮れパトロール、出発だ！','森でも迷子は見のがさないぜ！','水晶洞、足もとよーし！','空のパトロールも、まかせな！','雪でも熱いハートは消えないぜ！','お城のみんな、迎えに来たぜ！'],
  clear:['町の安全、かくにん完了！','パトロール終了！ 明日もよろしく！','森のみんな、道に気をつけな！','水晶洞、異常なーし！','空の安全も、守ったぜ！','あたたかい飲み物で休もうぜ！','事件解決！ みんなでお祝いだ！']}
};
const BONUS_LINES={
 inu:[['城下町のみんな、刀の風から守るよ！','鬼の太鼓にも負けない！ みんなで進もう！'],['刀をおさめて、お城にも笑顔を！','鬼さんとも、最後は仲よくなれたね！']],
 shima:[['足音を消して、武者のすきへ飛びこむよ！','鬼の大行列？ ぼくの身軽さで抜けるよ！'],['お城の石段も、ひとっとびだったね！','鬼の太鼓に合わせて、勝利のステップ！']],
 nuko:[['桜の光で、戦う心をやさしくほどくね。','鬼火の森に、星の魔法を咲かせよう！'],['お城の桜、もう安心して咲けるね。','こわい鬼火が、やさしい灯りになったね！']],
 guard8:[['鉄砲の列も、ぼくのハンマーで受け止める！','鬼の金棒か。重さなら負けないぞ！'],['門は無事だ！ 城下のみんなを守れたね。','金棒の雨を越えた！ みんな、大丈夫かい？']],
 watch:[['忍びの合図を盗んで、城門を開けよう！','鬼の宝箱より、まず仲間の安全さ！'],['城の仕掛けはお見通し。へへ、上出来！','鬼の親分の秘密は、胸にしまっておこう！']],
 wanden:[['武士の間合い、静かに見定めよう。','鬼の力には、心の静けさで応える。'],['刃をおさめよう。城下に風が戻った。','戦は終わりだ。鬼たちにも帰る場所を。']],
 mack:[['城下の巡回、準備よし！ 鉄砲には気をつけな！','鬼の軍勢だって？ 町の平和は渡さないぜ！'],['城下の安全、パトロール完了だ！','鬼合戦、これにて解散！ みんな家へ帰りな！']]
};
for(const [id,[start,clear]]of Object.entries(BONUS_LINES)){HEROES[id].start.push(...start);HEROES[id].clear.push(...clear);}
const BOSSES={garm:['鋼の爪、解放！','連続つっこみと空からの急降下。着地のすきをねらおう。'],shark:['ほんきの がぶがぶ！','連続かみつきに遠くへの水玉。予告の線からよけよう。'],ghost:['三兄弟の ひとだま祭り！','消える突進とひとだま。姿が見えたら反撃しよう。'],cerbe:['三つの声が ひびく！','連続ジャンプと三方向のほえ声。着地を見て動こう。'],slime:['ぷるぷる大あばれ！','ねばねば弾と小さな仲間。着地後のすきがチャンス。'],dragon:['炎のつばさ、全開！','炎の玉と二連の息。予告を見て、着地後をねらおう。'],kuroinu:['こくけんしの 本気！','斬撃と連続の居合い。光る道から外れて反撃しよう。'],emperor:['王の力を 見せよう！','光の柱と包囲弾。足もとの予告を見て動こう。']};
const CHAPTERS=[
 ['王都からの救援要請','王都の守りが破られた。街を取り戻し、街道へ逃れた住民の足跡を追う。','守備隊は街の門を閉じた。夕暮れの城下町から、救援を求める鐘が聞こえる。'],
 ['灯りをつなぐ街道','夕闇の城下町を抜けるには、消された道しるべを一つずつ灯すしかない。','街道の灯りがつながった。森に逃れた隊商を迎えに行ける。'],
 ['月明かりの道しるべ','隊商が月夜の森で消息を絶った。木立の向こうに、ドラキュラの影が走る。','隊商は無事だった。洞窟の水晶が空の船を導くという話を聞く。'],
 ['眠る水晶の航路','水晶の光を取り戻し、雲上の飛行艇へ通じる航路を開く。','水晶の道が空へ伸び、海賊飛行艇の航路を照らした。'],
 ['雲の上の救出作戦','海賊飛行艇は霊峰へ向かっている。甲板を取り戻し、乗客を救う。','船長が礼に雪山の地図をくれた。城に通じる峠は霊峰の奥だ。'],
 ['雪の先の黒い城','雪に埋もれた峠を越える。城の見張りは、その先で待っている。','霊峰の峠を越えた。ダークワンワン城への最後の門が開く。'],
 ['王冠に宿る闇','城を覆う闇の源は王座にある。クロイヌと大帝が最後の道をふさぐ。','王座の闇は晴れた。東の城下では、まだ武者たちが戦を続けている。'],
 ['旗の下のわんこ合戦','神輿と騎馬が街道を封鎖している。組頭と手下が集まる前に攻めよう。','戦旗が下り、鬼の門へ続く道が開いた。城下の人々が帰り始めた。'],
 ['紅蓮の門と最後の太鼓','鬼の太鼓が谷に響く。門を守る軍勢を越え、王国へ帰る道を開く。','太鼓が止まり、王国へ帰る道に朝日が差した。']
];
const queue=[],seen=new Set(),history=[];let active=null,run=0,stage=0,hero='inu',panel=null,parts=null,focus=null,paused=false;
function clearInput(){G.coop?.clearInputs();G.ui?.touch?.release?.();for(const k in G.input.touch)G.input.touch[k]=typeof G.input.touch[k]==='boolean'?false:0;G.input.clear();G.published?.resetInput?.();G.commands.reset();}
function hide(){if(panel){panel.remove();panel=null;parts=null;}focus?.focus?.();focus=null;}
function restore(e,completed){hide();clearInput();if(e?.actor){e.actor.anim=e.oldAnim;e.actor.animT=e.oldAnimT;}
 if(G.cam){G.cam.focusT=0;G.cam.focusZoom=0;if(G.player)G.cam.follow(G.player);}
 if(G.fx)G.fx.worldFrozen=!!G.paused;
 if(completed&&G.player&&!G.player.dead){G.player.inv=Math.max(G.player.inv,24);const n=G.published?.native?.();if(n)n.player.invuln=Math.max(n.player.invuln,24);}
 G.audio?.pause?.(!!G.paused);
 if(completed){G.coop?.restoreCamera();G.coop?.grace();}if(completed)G.bus.emit('storyComplete',{kind:e.kind,key:e.key,run});}
function reset(){if(active)restore(active,false);active=null;paused=false;queue.length=0;seen.clear();hide();}
function enqueue(e){if(seen.has(e.key))return false;seen.add(e.key);queue.push(e);return true;}
function element(tag,parent,text){const e=document.createElement(tag);if(text!=null)e.textContent=text;parent?.append(e);return e;}
const COMIC_CSS=`
.inu-story{position:fixed;inset:0;z-index:12000;display:grid;place-items:center;background:#253343dc;backdrop-filter:blur(7px);-webkit-backdrop-filter:blur(7px);color:#554253;font:16px/1.55 "Hiragino Maru Gothic ProN","Yu Gothic",system-ui,sans-serif;padding:max(12px,env(safe-area-inset-top)) max(12px,env(safe-area-inset-right)) max(12px,env(safe-area-inset-bottom)) max(12px,env(safe-area-inset-left));box-sizing:border-box;touch-action:pan-y}
.inu-story *{box-sizing:border-box}
.inu-story .card{width:min(100%,1050px);max-height:calc(100dvh - 24px - env(safe-area-inset-top) - env(safe-area-inset-bottom));overflow:auto;overscroll-behavior:contain;border:2px solid #79616d;border-radius:14px 22px 15px 23px;background-color:#fffaf1;background-image:radial-gradient(#baa69e26 .65px,transparent .65px);background-size:7px 7px;box-shadow:6px 7px 0 #e1b4bf,11px 14px 0 #47354538,0 25px 90px #131e3273;padding:20px 23px 0;isolation:isolate}
.inu-story .comic-heading{display:flex;align-items:end;gap:14px;padding:0 2px 14px;border-bottom:1.5px solid #d5bfc0;margin-bottom:14px}
.inu-story .chapter{font-size:12px;font-weight:800;letter-spacing:.08em;color:#997382;margin:0 0 4px}
.inu-story h2{font-family:"Yu Mincho","Hiragino Mincho ProN",serif;font-size:clamp(23px,3vmin,33px);line-height:1.25;letter-spacing:.035em;color:#594250;margin:0;font-weight:800;text-wrap:balance}
.inu-story .chapter-kind{margin:0 0 1px auto;flex:none;color:#9c6777;font-size:12px;font-weight:800;letter-spacing:.12em;border-left:1px solid #d6b8bd;padding-left:11px}
.inu-story .comic-strip{display:grid;grid-template-columns:1.05fr 1.18fr;grid-template-rows:238px 137px;gap:13px}
.inu-story .comic-panel{position:relative;min-width:0;overflow:hidden;border:2px solid #6e5664;background:#ede3e1;border-radius:5px 12px 5px 9px;margin:0;isolation:isolate}
.inu-story .comic-panel svg{display:block;width:100%;height:100%}
.inu-story .opening{grid-column:1;grid-row:1 / 3;transform:rotate(-.65deg);background:#d1ddd2}
.inu-story .opening>svg{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.inu-story .location{position:absolute;top:11px;left:11px;max-width:calc(100% - 22px);margin:0;background:#fffaf2ed;border:1px solid #b09b9f;box-shadow:3px 3px 0 #71516516;padding:3px 10px;font-size:12px;font-weight:800;line-height:1.45;transform:rotate(-2deg)}
.inu-story .synopsis{position:absolute;left:12px;right:12px;bottom:12px;margin:0;background:#fffaf2f2;padding:12px 14px;border:1.5px solid #a58a96;box-shadow:3px 4px 0 #78616b22;border-radius:2px 7px 3px 5px;font-size:16px;font-weight:600;line-height:1.8;letter-spacing:.02em;overflow-wrap:anywhere}
.inu-story .hero-panel{background:#fcf2eb;transform:rotate(.55deg)}
.inu-story .hero-panel::before{content:'';position:absolute;inset:0;background:radial-gradient(#d6a5b944 .9px,transparent 1px);background-size:9px 9px;z-index:-1}
.inu-story .hero-art{position:absolute;right:-14px;bottom:-5px;width:68%;height:105%;margin:0}
.inu-story .hero-art svg{object-fit:contain}
.inu-story .character-line{position:absolute;top:17px;left:15px;max-width:58%;margin:0;padding:15px 17px 17px;background:#fffef9;color:#574051;border:2px solid #826270;border-radius:49% 47% 44% 41% / 24% 29% 34% 31%;box-shadow:3px 5px 0 #c3a6af33;font-size:clamp(16px,1.8vmin,21px);font-weight:800;line-height:1.7;letter-spacing:.02em;z-index:2;text-wrap:pretty;overflow-wrap:anywhere}
.inu-story .character-line::after{content:'';position:absolute;right:10px;bottom:-12px;width:19px;height:24px;background:#fffef9;border-right:2px solid #826270;border-bottom:2px solid #826270;transform:skew(18deg) rotate(30deg);clip-path:polygon(15% 0,100% 0,100% 100%)}
.inu-story .speaker{position:absolute;left:15px;bottom:12px;max-width:50%;margin:0;font-size:12px;font-weight:800;letter-spacing:.05em;background:#f8e9dfd9;padding:3px 8px;border-radius:3px}
.inu-story .sound{position:absolute;right:16px;top:8px;font-size:22px;letter-spacing:.10em;font-weight:900;transform:rotate(10deg);color:#bc869c;text-shadow:2px 2px 0 #fff5e8}
.inu-story .after-panel{background:#eff1e4;display:grid;grid-template-columns:1.3fr 1fr;align-items:center;transform:rotate(-.3deg)}
.inu-story .after-art{align-self:stretch;min-width:0;position:relative;overflow:hidden}
.inu-story .after-art svg{width:100%;height:100%;object-fit:cover}
.inu-story .bridge{position:relative;font-size:14px;font-weight:650;line-height:1.75;margin:0;padding:12px 0 12px 14px;z-index:1;overflow-wrap:anywhere}
.inu-story .after-panel .sound{right:5px;top:5px;font-size:15px;color:#8e9e89}
.inu-story .actions{position:sticky;bottom:0;display:flex;gap:12px;justify-content:flex-end;align-items:center;padding:16px 0 17px;background:#fffaf1f5;margin-top:5px;border-top:0;z-index:5}
.inu-story button{appearance:none;font:inherit;font-size:14px;font-weight:750;min-height:46px;min-width:98px;border:1.5px solid #b99daa;border-radius:7px 10px 8px 9px;background:#fbf4f0;color:#7c6675;padding:9px 16px;touch-action:manipulation;cursor:pointer;transition:transform .15s,background .15s}
.inu-story .continue{background:#866076;border-color:#735169;color:#fffaf4;box-shadow:0 3px 0 #543d53;min-width:148px;font-size:16px;letter-spacing:.06em}
.inu-story button:hover{transform:translateY(-1px)}
.inu-story button:active{transform:translateY(2px)}
.inu-story button:disabled{opacity:.45;cursor:default;transform:none}
.inu-story button:focus-visible{outline:3px solid #70acb6;outline-offset:3px}
.inu-story .cue{font-size:12px;line-height:1.5;color:#8f6d7d;margin:0 auto 0 1px;max-width:44%}
.inu-story .key{font-size:10px;letter-spacing:.03em;opacity:.7;display:inline;margin-left:12px}
.inu-story .progress{display:none}
.inu-story .comic-panel{animation:comic-reveal .36s both ease-out}
.inu-story .hero-panel{animation-delay:.12s}
.inu-story .after-panel{animation-delay:.24s}
@keyframes comic-reveal{from{opacity:0;translate:0 8px}to{opacity:1;translate:0 0}}
@media(max-aspect-ratio:4/5){
 .inu-story{padding-left:14px;padding-right:17px}
 .inu-story .card{padding:16px 13px 0;border-radius:12px 19px 11px 17px;box-shadow:4px 5px 0 #e1b4bf,8px 9px 0 #47354538,0 20px 60px #131e3266}
 .inu-story .comic-heading{padding:0 3px 12px;margin-bottom:12px}
 .inu-story h2{font-size:clamp(22px,5.4vw,31px)}
 .inu-story .chapter{font-size:11px}
 .inu-story .chapter-kind{font-size:12px}
 .inu-story .comic-strip{grid-template-columns:1fr;grid-template-rows:clamp(165px,24dvh,255px) clamp(182px,25dvh,260px) auto;gap:12px}
 .inu-story .opening{grid-row:auto;grid-column:auto}
 .inu-story .opening>svg{height:140%;top:-22%}
 .inu-story .synopsis{bottom:10px;left:10px;right:10px;padding:9px 12px;font-size:14px;line-height:1.7}
 .inu-story .location{top:9px;left:9px;font-size:11px}
 .inu-story .hero-art{width:65%;height:112%;right:-15px;bottom:-7px}
 .inu-story .character-line{font-size:16px;max-width:59%;padding:13px 15px 15px;top:17px;left:12px;line-height:1.7}
 .inu-story .speaker{font-size:11px;left:12px;bottom:10px}
 .inu-story .sound{font-size:21px;right:13px}
 .inu-story .after-panel{min-height:108px;grid-template-columns:1.2fr 1fr}
 .inu-story .bridge{font-size:13px;padding:10px 0 10px 12px;line-height:1.75}
 .inu-story .after-art{min-height:108px}
 .inu-story .actions{padding:13px 1px 16px;gap:10px;margin-top:0}
 .inu-story .continue{min-width:138px}
}
@media(max-height:480px) and (min-aspect-ratio:4/5){
 .inu-story{padding-top:max(7px,env(safe-area-inset-top));padding-bottom:max(8px,env(safe-area-inset-bottom))}
 .inu-story .card{max-height:calc(100dvh - 18px - env(safe-area-inset-top) - env(safe-area-inset-bottom));padding:11px 15px 0}
 .inu-story .comic-heading{padding-bottom:8px;margin-bottom:9px}
 .inu-story h2{font-size:22px}
 .inu-story .chapter{font-size:10px;margin-bottom:1px}
 .inu-story .chapter-kind{writing-mode:horizontal-tb;font-size:11px;padding-left:11px;letter-spacing:.06em}
 .inu-story .comic-strip{grid-template-columns:.95fr 1.25fr;grid-template-rows:minmax(125px,37dvh) minmax(68px,20dvh);gap:8px}
 .inu-story .synopsis{font-size:13px;line-height:1.65;padding:8px 10px;left:8px;right:8px;bottom:8px}
 .inu-story .location{top:7px;left:8px;font-size:10px;padding:2px 7px}
 .inu-story .hero-art{width:55%;height:124%;right:0;bottom:-14px}
 .inu-story .character-line{font-size:14px;line-height:1.6;top:9px;left:10px;max-width:59%;padding:10px 14px}
 .inu-story .speaker{bottom:7px;left:10px;font-size:10px;padding:2px 6px}
 .inu-story .sound{font-size:17px;right:8px;top:7px}
 .inu-story .bridge{font-size:12px;line-height:1.6;padding:8px 0 8px 11px}
 .inu-story .after-panel{grid-template-columns:1.7fr 1fr}
 .inu-story .actions{padding:9px 0 11px;gap:9px;margin-top:0}
 .inu-story button{min-height:42px;font-size:12px;padding:7px 13px}
 .inu-story .continue{font-size:14px;min-width:133px}
}
@media(hover:none){.inu-story .key{display:none}}
@media(prefers-reduced-motion:reduce){.inu-story *{animation:none!important;transition:none!important}}
`;
function render(){
 if(!document.createElement||!document.body)return;
 const clear=active.kind==='clear',stop=G.stages?.[stage],art=G.storyComic;
 focus=document.activeElement;
 panel=element('section',document.body);panel.className='inu-story';
 panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');panel.setAttribute('aria-label',active.title);
 const css=element('style',panel);css.textContent=COMIC_CSS;
 const card=element('article',panel);card.className='card';
 const heading=element('header',card);heading.className='comic-heading';
 const title=element('div',heading),chapter=element('p',title);chapter.className='chapter';
 chapter.textContent=(stop?.lap?stop.lap+'周目 · ':'')+'第'+(stop?.chapter||stage+1)+'章';
 element('h2',title,active.title);
 const kind=element('p',heading,clear?'クリアのあと':'出発');kind.className='chapter-kind';
 const strip=element('div',card);strip.className='comic-strip';
 const scene=element('figure',strip);scene.className='journey-plate comic-panel opening';
 const passage=G.storybook?.passage(stage,clear);
 scene.innerHTML=art?.environment(stage,clear?'clear':'intro',clear,true)||passage?.svg||'';
 const location=element('p',scene,stop?.name||active.title);location.className='location';
 const synopsis=element('p',scene);synopsis.className='synopsis';
 const speech=element('figure',strip);speech.className='comic-panel hero-panel';
 const heroArt=element('div',speech);heroArt.className='hero-art';
 heroArt.innerHTML=art?.portrait(hero,clear,stage)||'';
 const line=element('blockquote',speech);line.className='character-line';
 const sound=element('span',speech,clear?'にこっ':hero==='kuro'?'すっ…':'きゅっ');sound.className='sound';sound.setAttribute('aria-hidden','true');
 const speaker=element('figcaption',speech,HEROES[hero]?.name||hero);speaker.className='speaker';
 const after=element('figure',strip);after.className='comic-panel after-panel';
 const bridge=element('p',after);bridge.className='bridge';
 const afterArt=element('div',after);afterArt.className='after-art';afterArt.innerHTML=art?.vignette(hero,clear,stage)||'';
 const actions=element('footer',card);actions.className='actions';
 const cue=element('p',actions);cue.className='cue';cue.setAttribute('role','status');
 const pause=element('button',actions,'一時停止');pause.type='button';
 const skip=element('button',actions,'つづける');skip.className='continue';skip.type='button';
 skip.onclick=e=>{e.preventDefault();G.story.skip();};pause.onclick=e=>{e.preventDefault();G.story.pause(!paused);};
 const bar=element('div',card);bar.className='progress';const fill=element('i',bar);
 parts={synopsis,line,bridge,cue,skip,pause,fill,passage};
 panel.addEventListener('pointerdown',e=>e.stopPropagation());panel.addEventListener('click',e=>e.stopPropagation());
 skip.focus();paint();
}
function paint(){
 if(!parts||!active)return;
 const sentences=active.lines[0].match(/[^。！？]+[。！？]?/g)||[active.lines[0]];
 const first=sentences[0],remaining=sentences.slice(1).join('');
 const set=(node,text)=>{if(node.textContent!==text)node.textContent=text;};
 set(parts.synopsis,first);
 set(parts.bridge,remaining||parts.passage?.caption||active.cue);
 set(parts.line,active.lines[1]);
 set(parts.cue,paused?'一時停止中。P でも再開できます。':'');
 parts.skip.disabled=active.age<30||paused;
 set(parts.pause,paused?'読むのを再開':'一時停止');
 parts.fill.style.width=(Math.min(1,active.age/30)*100)+'%';
}
function finish(){if(!active)return;const e=active;history.push({run,stage,hero,kind:e.kind,key:e.key,age:e.age,completed:true});restore(e,true);active=null;paused=false;}
function begin(e){if(e.hero)hero=e.hero;active=e;e.age=0;e.duration=185;e.actor=e.player||G.player;e.oldAnim=e.actor?.anim;e.oldAnimT=e.actor?.animT;
 clearInput();if(G.fx)G.fx.worldFrozen=true;
 if(e.actor)G.cam?.focus?.(e.actor.x,1.2+(e.actor.height||1.3)*.35,e.actor.z,e.duration,1.2);
 history.push({run,stage,hero,kind:e.kind,key:e.key,started:true});render();G.bus.emit('storyStart',{kind:e.kind,key:e.key,run});}
const START_POSE={inu:{aRz:1.65,wz:1.5,aLz:.7,nod:-.08},shima:{aLz:1.4,aRz:1.5,aLx:.8,aRx:.8,lLz:.3,lRz:-.2},nuko:{aRz:2.3,aLz:1.8,aLx:.6,wz:.2,nod:.2},guard8:{aRz:1.2,wz:1.8,aLz:1.5,lean:.2,lLz:.3},watch:{aLz:2.5,aLy:.2,aRz:.5,twist:-.25,nod:-.12},wanden:{aRz:.55,aRy:1.2,wz:4,aLz:.5,twist:-.4,nod:-.1},mack:{aRz:1.55,wz:-1.5,aLz:2.5,aRx:.4,twist:.2}};
const CLEAR_POSE={inu:{aRz:.6,aRy:1.1,wz:3.8,aLz:.3,nod:-.18,lean:.12},shima:{aLz:1.7,aRz:1.6,aLx:.8,aRx:.7,lean:.12},nuko:{aLz:2.2,aRz:2.7,aLx:.65,wz:.1,nod:.22},guard8:{aLz:1.7,aRz:1.4,aLx:1,aRx:.8,wz:1.8,nod:.08},watch:{aLz:2.55,aLy:.4,aRz:1.3,wz:1.1,lean:.25,nod:-.15},wanden:{aRz:.5,aRy:1.25,wz:4,aLz:.7,twist:-.3,lean:.1,nod:-.22},mack:{aLz:2.6,aRz:.75,wz:1.7,aRy:.6,twist:.3,nod:.1}};
START_POSE.kuro={aRz:1.5,aRy:.3,wz:1.1,aLz:1.2,lean:.06,nod:-.08};
CLEAR_POSE.kuro={aRz:1.7,wz:1.35,aLz:.5,lean:.10,nod:-.17};
G.story={heroes:HEROES,bosses:BOSSES,history,
 get active(){return active;},get blocked(){return !!active;},get pending(){return queue.length;},get paused(){return paused;},get run(){return run;},
 beginStage(id,index,arena=false){reset();run++;hero=id;stage=index;if(arena)return;
  const h=HEROES[hero],stop=G.stages?.[stage];if(!h)return;enqueue({kind:'intro',key:'intro:'+run,title:CHAPTERS[stage]?.[0]||stop?.name||h.name+'、出発！',lines:[CHAPTERS[stage]?.[1]||stop?.intro||h.cue,h.start[stage]||'仲間と一緒なら、きっと先へ行ける！'],cue:h.cue,hero:id,player:G.player});G.coop?.enqueueStories('intro',run,index,enqueue,HEROES);},
 clearStage(){const id=G.game?.heroId||hero,h=HEROES[id];if(!h)return false;const accepted=enqueue({kind:'clear',hero:id,player:G.player,key:'clear:'+run,title:(G.game?.stageName||'王国')+' · 旅の記録',lines:[(G.stages?.[stage+1]?.lap===2&&!G.stages[stage]?.lap?'王国への道が開いた。街道の先に、巨大な花が咲く蟲の世界が現れた。':CHAPTERS[stage]?.[2])||G.stages?.[stage]?.epilogue||h.win,h.clear[stage]||'ひと休みして、次の旅に備えよう。'],cue:h.win});G.coop?.enqueueStories('clear',run,stage,enqueue,HEROES);return accepted;},
 frenzyPhase(boss){return G.frenzy?.observe(boss)||false;},
 bossPhase(boss,phase){
  if(phase===2||!boss||boss.hp<=0||boss.dead||boss.transforming||boss.hp>=boss.maxHp*.5)return false;
  if(G.game?.diff?.frenzy)return this.frenzyPhase(boss);
  const form=boss.form||1;
  if(boss._spokenPhase===form)return false;
  boss._spokenPhase=form;
  if(!(form===2?boss.def.phaseLine2:boss.def.phaseLine))G.foes.h.say(boss,BOSSES[boss.type]?.[0]||'ここからが本番だ！');
  return true;
 },
 flush(){if(active||G.paused||G.game?.cutinT>0||G.fx?.cutinActive||G.hitStop>0||G.sceneName!=='play')return false;
  while(queue.length){const e=queue[0];if(G.scenes.play?.over){queue.shift();continue;}if(G.player?.dead)return false;queue.shift();begin(e);return true;}return false;},
 tick(){if(!active)return;if(active.actor)G.cam?.focus?.(active.actor.x,1.2+(active.actor.height||1.3)*.35,active.actor.z,2,1.2);if(G.input.btn.pause?.pressed){this.pause(!paused);return;}if(paused)return;
  active.age++;if(active.actor?.rig){active.actor.animT++;active.actor.rig.update?.(active.actor,G.cfg.TICK);}
  paint();},
 skip(){if(!active||paused||active.age<30)return false;finish();return true;},
 pause(on){if(!active)return false;paused=!!on;G.audio?.pause?.(paused||!!G.paused);clearInput();paint();return true;},reset,
 pose(rig,e,Q,rest){if(!active||(active.kind==='boss'||active.kind==='form')||e!==active.actor)return null;const def=(active.kind==='intro'?START_POSE:CLEAR_POSE)[hero];if(!def)return null;
  const blend=Math.min(1,active.age/28),sway=Math.sin(active.age*.06)*.035;
  for(const k of Object.keys(Q))if(typeof Q[k]==='number')Q[k]=(rest[k]||0)*(1-blend)+(def[k]??rest[k]??0)*blend;
  Q.nod=(Q.nod||0)+sway;Q.sq=Q.y=Q.fx=0;if(hero==='shima'){Q.lLz=.25*Math.sin(active.age*.12);Q.lRz=-Q.lLz;}if(hero==='nuko')Q.twist=.25*Math.sin(active.age*.035);if(hero==='mack')Q.wz+=(active.age>75?Math.sin(Math.min(1,(active.age-75)/40)*Math.PI*2):0);
  rig.st.storyPose={kind:active.kind,hero,age:active.age};return {id:'story-'+hero+'-'+active.kind,eyes:active.kind==='clear'?'happy':'open'};}
};
window.addEventListener('keydown',e=>{if(!active)return;if(e.code==='Tab'){e.preventDefault();e.stopImmediatePropagation();if(parts)(parts.skip.disabled||document.activeElement===parts.skip?parts.pause:parts.skip).focus();return;}e.stopImmediatePropagation();e.preventDefault();if(e.repeat)return;
 if(e.code==='KeyP'||e.code==='Escape')G.story.pause(!paused);else if(e.code==='Enter'||e.code==='Space')G.story.skip();},true);
G.bus.on('bossPhase',d=>G.story.bossPhase(d.boss,d.phase));
G.bus.on('stageStart',d=>G.story.beginStage(G.game.heroId,d.index,!!G._arena));
G.bus.on('hidden',()=>{if(active)G.story.pause(true);});
G.bus.on('scene',d=>{if(d.name!=='play')reset();});
})();

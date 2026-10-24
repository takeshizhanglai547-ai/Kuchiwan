// Cinematic coordinator. UI age is separate from combat/native clocks. No attack
// definitions or command dispatch are owned here.
(function(){'use strict';const G=window.G;
const HEROES={
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
const BOSSES={garm:['鋼の爪、解放！','連続つっこみと空からの急降下。着地のすきをねらおう。'],shark:['ほんきの がぶがぶ！','連続かみつきに遠くへの水玉。予告の線からよけよう。'],ghost:['三兄弟の ひとだま祭り！','消える突進とひとだま。姿が見えたら反撃しよう。'],cerbe:['三つの声が ひびく！','連続ジャンプと三方向のほえ声。着地を見て動こう。'],slime:['ぷるぷる大あばれ！','ねばねば弾と小さな仲間。着地後のすきがチャンス。'],dragon:['炎のつばさ、全開！','炎の玉と二連の息。予告を見て、着地後をねらおう。'],kuroinu:['こくけんしの 本気！','斬撃と連続の居合い。光る道から外れて反撃しよう。'],emperor:['王の力を 見せよう！','光の柱と包囲弾。足もとの予告を見て動こう。']};
const queue=[],seen=new Set(),history=[];let active=null,run=0,stage=0,hero='inu',panel=null,parts=null,focus=null,paused=false;
function clearInput(){G.ui?.touch?.release?.();for(const k in G.input.touch)G.input.touch[k]=typeof G.input.touch[k]==='boolean'?false:0;G.input.clear();G.published?.resetInput?.();G.commands.reset();}
function valid(e){return !e.boss||(!e.boss.dead&&!e.boss.removed&&e.boss.hp>0&&!e.boss.transforming&&(e.boss.form||1)===e.form);}
function releaseHold(e){if(e?.boss)e.boss._phaseEventHold=false;}
function hide(){if(panel){panel.remove();panel=null;parts=null;}focus?.focus?.();focus=null;}
function restore(e,completed){hide();clearInput();if(e?.actor){e.actor.anim=e.oldAnim;e.actor.animT=e.oldAnimT;}
 if(G.cam){G.cam.focusT=0;G.cam.focusZoom=0;if(G.player)G.cam.follow(G.player);}
 if(G.fx)G.fx.worldFrozen=!!G.paused;
 releaseHold(e);
 if(completed&&G.player&&!G.player.dead){G.player.inv=Math.max(G.player.inv,24);const n=G.published?.native?.();if(n)n.player.invuln=Math.max(n.player.invuln,24);}
 if(completed)G.bus.emit('storyComplete',{kind:e.kind,key:e.key,run});}
function reset(){if(active)restore(active,false);active=null;paused=false;for(const e of queue)releaseHold(e);queue.length=0;seen.clear();hide();}
function enqueue(e){if(seen.has(e.key))return false;seen.add(e.key);queue.push(e);return true;}
function element(tag,parent,text){const e=document.createElement(tag);if(text!=null)e.textContent=text;parent?.append(e);return e;}
function render(){if(!document.createElement||!document.body)return;
 focus=document.activeElement;panel=element('section',document.body);panel.className='inu-story';panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');panel.setAttribute('aria-label',active.title);
 const css=element('style',panel);css.textContent='.inu-story{position:fixed;inset:0;z-index:12000;background:linear-gradient(120deg,#071629c9,#17213499);display:flex;align-items:center;justify-content:center;color:#fff8df;font:clamp(15px,2.4vmin,23px)/1.5 system-ui,sans-serif;padding:max(12px,env(safe-area-inset-top)) max(14px,env(safe-area-inset-right)) max(12px,env(safe-area-inset-bottom)) max(14px,env(safe-area-inset-left));box-sizing:border-box;touch-action:manipulation}.inu-story .card{width:min(100%,960px);max-height:96dvh;overflow:auto;border:3px solid var(--story,#ffd264);border-radius:22px;background:#142a3be8;box-shadow:0 12px 80px #0009;padding:clamp(12px,3vmin,28px);box-sizing:border-box;display:grid;grid-template-columns:minmax(110px,30%) minmax(0,1fr);gap:16px;align-items:center}.inu-story img{width:100%;max-height:48dvh;object-fit:contain;filter:drop-shadow(0 5px 15px #0007)}.inu-story h2{font-size:clamp(22px,4vmin,36px);line-height:1.2;margin:4px 0 12px}.inu-story p{margin:8px 0}.inu-story .cue{font-size:.78em;color:#baddf2}.inu-story .chapter{font-size:.75em;letter-spacing:.12em;color:#ffd777}.inu-story .actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:16px}.inu-story button{font:inherit;font-size:.82em;min-height:44px;border:2px solid #f2ce7c;border-radius:11px;background:#f7e5b7;color:#182f41;padding:8px 16px;touch-action:manipulation}.inu-story button:focus-visible{outline:4px solid #6cd6ff}.inu-story button:disabled{opacity:.5}.inu-story .progress{height:4px;background:#486077;margin-top:12px}.inu-story .progress i{display:block;height:100%;background:#ffd777;width:0}@media(max-aspect-ratio:3/4){.inu-story .card{grid-template-columns:1fr;text-align:center;gap:5px}.inu-story img{max-height:26dvh;max-width:55%;margin:auto}.inu-story .actions{justify-content:center}}@media(max-height:430px){.inu-story .card{padding:10px 16px;gap:12px}.inu-story h2{font-size:23px;margin:2px 0 6px}.inu-story p{margin:5px 0}.inu-story .actions{margin-top:8px}.inu-story .cue{font-size:12px}}@media(prefers-reduced-motion:reduce){.inu-story *{animation:none!important}}';
 const card=element('div',panel);card.className='card';card.style.setProperty('--story',active.boss?'#f3a18c':HEROES[hero]?.color||'#ffd264');
 const image=element('img',card);image.alt=active.boss?(active.boss.def.name||active.boss.type):HEROES[hero]?.name||hero;
 const url=active.boss?G.bossPortrait?.(active.boss,{size:320}):G.heroes?.portrait?.(hero,{size:320,expr:active.kind==='clear'?'happy':'normal'});if(url)image.src=url;else {image.hidden=true;card.style.gridTemplateColumns='minmax(0,1fr)';}
 const body=element('div',card),chapter=element('div',body);chapter.className='chapter';chapter.textContent=active.kind==='boss'?'BOSS · SECOND PHASE':(active.kind==='intro'?'STAGE START':'STAGE CLEAR')+' · '+(stage+1);
 element('h2',body,active.title);const line=element('p',body),cue=element('p',body);cue.className='cue';
 const actions=element('div',body);actions.className='actions';const skip=element('button',actions,'つづける / Enter'),pause=element('button',actions,'一時停止 / P');
 skip.type=pause.type='button';skip.onclick=e=>{e.preventDefault();G.story.skip();};pause.onclick=e=>{e.preventDefault();G.story.pause(!paused);};
 const bar=element('div',body);bar.className='progress';const fill=element('i',bar);parts={line,cue,skip,pause,fill};
 panel.addEventListener('pointerdown',e=>e.stopPropagation());panel.addEventListener('click',e=>e.stopPropagation());skip.focus();paint();}
function paint(){if(!parts||!active)return;parts.line.textContent=active.lines[active.age<75?0:1];parts.cue.textContent=paused?'演出を一時停止中。P またはボタンで再開。':active.cue;
 parts.skip.disabled=active.age<30||paused;parts.pause.textContent=paused?'再開 / P':'一時停止 / P';parts.fill.style.width=(active.age/active.duration*100)+'%';}
function finish(){if(!active)return;const e=active;history.push({run,stage,hero,kind:e.kind,key:e.key,age:e.age,completed:true});restore(e,true);active=null;paused=false;}
function begin(e){active=e;e.age=0;e.duration=e.kind==='boss'?170:185;e.actor=e.boss||G.player;e.oldAnim=e.actor?.anim;e.oldAnimT=e.actor?.animT;
 clearInput();if(G.fx)G.fx.worldFrozen=true;
 if(e.boss){const b=e.boss;b.pending=null;G.combat.cancel(b);b.onInterrupt?.();b.plan=null;b.gplan=null;b.vx=b.vz=0;G.setAnim(b,'roar',170);
  for(const pr of G.combat.projectiles||[])if(pr.owner===b)pr.life=0;}
 if(e.actor)G.cam?.focus?.(e.actor.x,1.2+(e.actor.height||1.3)*.35,e.actor.z,e.duration,1.2);
 history.push({run,stage,hero,kind:e.kind,key:e.key,started:true});render();G.bus.emit('storyStart',{kind:e.kind,key:e.key,run});}
const START_POSE={inu:{aRz:1.65,wz:1.5,aLz:.7,nod:-.08},shima:{aLz:1.4,aRz:1.5,aLx:.8,aRx:.8,lLz:.3,lRz:-.2},nuko:{aRz:2.3,aLz:1.8,aLx:.6,wz:.2,nod:.2},guard8:{aRz:1.2,wz:1.8,aLz:1.5,lean:.2,lLz:.3},watch:{aLz:2.5,aLy:.2,aRz:.5,twist:-.25,nod:-.12},wanden:{aRz:.55,aRy:1.2,wz:4,aLz:.5,twist:-.4,nod:-.1},mack:{aRz:1.55,wz:-1.5,aLz:2.5,aRx:.4,twist:.2}};
const CLEAR_POSE={inu:{aRz:.6,aRy:1.1,wz:3.8,aLz:.3,nod:-.18,lean:.12},shima:{aLz:1.7,aRz:1.6,aLx:.8,aRx:.7,lean:.12},nuko:{aLz:2.2,aRz:2.7,aLx:.65,wz:.1,nod:.22},guard8:{aLz:1.7,aRz:1.4,aLx:1,aRx:.8,wz:1.8,nod:.08},watch:{aLz:2.55,aLy:.4,aRz:1.3,wz:1.1,lean:.25,nod:-.15},wanden:{aRz:.5,aRy:1.25,wz:4,aLz:.7,twist:-.3,lean:.1,nod:-.22},mack:{aLz:2.6,aRz:.75,wz:1.7,aRy:.6,twist:.3,nod:.1}};
G.story={heroes:HEROES,bosses:BOSSES,history,
 get active(){return active;},get blocked(){return !!active;},get pending(){return queue.length;},get paused(){return paused;},get run(){return run;},
 beginStage(id,index,arena=false){reset();run++;hero=id;stage=index;if(arena)return;
  const h=HEROES[hero];if(!h)return;enqueue({kind:'intro',key:'intro:'+run,title:h.name+'、出発！',lines:[h.start[stage],h.cue+'。'+(G.game?.stageName||'')+'へ！'],cue:h.cue});},
 clearStage(){const h=HEROES[hero];if(!h)return false;return enqueue({kind:'clear',key:'clear:'+run,title:h.name+'の ステージクリア！',lines:[h.clear[stage],stage===6?'みんなで王国へ帰ろう！':h.win+'。次の道へ進もう！'],cue:h.win});},
 bossPhase(boss,phase){if(phase===2||!boss||boss.hp<=0||boss.dead||boss.transforming||!(boss.hp<boss.maxHp*.5))return false;
  const form=boss.form||1,key='boss:'+boss.id+':'+form,info=BOSSES[boss.type]||['後半戦、開始！','予告を見て、攻撃の後をねらおう。'];
  const accepted=enqueue({kind:'boss',key,boss,form,title:boss.type==='emperor'&&form===2?'暗黒の剣、覚醒！':info[0],lines:[(boss.form===2?boss.def.phaseLine2:boss.def.phaseLine)||'ここからが、ほんばんだ！',info[1]],cue:(boss.def.short||boss.def.name||boss.type)+(boss.type==='emperor'?' · 第'+form+'形態':'')+' · 後半戦'});
  if(accepted)boss._phaseEventHold=true;return accepted;},
 flush(){if(active||G.paused||G.game?.cutinT>0||G.fx?.cutinActive||G.hitStop>0||G.sceneName!=='play')return false;
  while(queue.length){const e=queue[0];if(!valid(e)||G.scenes.play?.over){releaseHold(e);queue.shift();continue;}if(G.player?.dead)return false;queue.shift();begin(e);return true;}return false;},
 tick(){if(!active)return;if(!valid(active)){finish();return;}if(active.actor)G.cam?.focus?.(active.actor.x,1.2+(active.actor.height||1.3)*.35,active.actor.z,2,1.2);if(G.input.btn.pause?.pressed){this.pause(!paused);return;}if(paused)return;
  active.age++;if(active.actor?.rig){active.actor.animT++;active.actor.rig.update?.(active.actor,G.cfg.TICK);}
  if(active.age>=active.duration){finish();return;}paint();},
 skip(){if(!active||paused||active.age<30)return false;finish();return true;},
 pause(on){if(!active)return false;paused=!!on;clearInput();paint();return true;},reset,
 pose(rig,e,Q,rest){if(!active||active.kind==='boss'||e!==G.player)return null;const def=(active.kind==='intro'?START_POSE:CLEAR_POSE)[hero];if(!def)return null;
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

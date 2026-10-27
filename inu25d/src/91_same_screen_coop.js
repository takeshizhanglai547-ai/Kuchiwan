// Same-screen cooperation. Each hero has a real native fighter and input channel.
(function(){'use strict';const G=window.G,players=[],primary={input:G.input,commands:G.commands};
let enabled=false,ids=['inu','shima'],carry=null,lastStage=-1,controls=null,menu=null,launch=null,inside=false;
const secondary=G.createInputChannel({padIndex:1,active:()=>enabled,keys:{KeyW:'ArrowUp',KeyA:'ArrowLeft',KeyS:'ArrowDown',KeyD:'ArrowRight',KeyF:'KeyJ',KeyR:'Space',KeyG:'KeyK',KeyT:'KeyL',KeyY:'KeyH',KeyB:'KeyO'}});
G.extendMotionCommands(secondary.commands);
const channels=[primary,secondary],mid={x:3,y:0,z:0,face:0,type:'coop-camera'};
const pointers=new Map(),buttonOwners=[new Map(),new Map()],sticks=[null,null];let status=[],markers=[];
function scoped(p,fn){const slot=players.indexOf(p),ch=channels[Math.max(0,slot)];
 const old={player:G.player,input:G.input,commands:G.commands};const stats={};
 if(slot===1&&G.game)for(const k of ['level','xp','xpNext','publishedCarry']){stats[k]=G.game[k];G.game[k]=k==='publishedCarry'?carry:(p[k]??G.game[k]);}
 G.player=p;G.input=ch.input;G.commands=ch.commands;try{return fn();}finally{Object.assign(G,old);if(slot===1&&G.game)Object.assign(G.game,stats);}}
function clearInputs(){for(let i=0;i<2;i++){const ch=channels[i];for(const k in ch.input.touch)ch.input.touch[k]=typeof ch.input.touch[k]==='boolean'?false:0;ch.input.clear();ch.commands.reset();if(players[i])G.published.resetInput(players[i]);buttonOwners[i].clear();sticks[i]=null;}pointers.clear();}
function blocked(){return !enabled||G.sceneName!=='play'||G.paused||G.story?.blocked||G.scenes.play?.over||G.scenes.play?.cleared;}
function press(side,key,pid){if(blocked()||pointers.has(pid))return false;const set=buttonOwners[side].get(key)||new Set();buttonOwners[side].set(key,set);if(!set.size)channels[side].input.latch(key);set.add(pid);channels[side].input.touch[key]=true;pointers.set(pid,{side,key});return true;}
function release(pid){const own=pointers.get(pid);if(!own)return false;const ch=channels[own.side];if(own.key){const set=buttonOwners[own.side].get(own.key);set?.delete(pid);ch.input.touch[own.key]=!!set?.size;}else{sticks[own.side]=null;ch.commands.touchEnd();}pointers.delete(pid);return true;}
function stick(side,pid,x,y){if(blocked())return false;const own=pointers.get(pid);if(own&&(own.side!==side||own.key))return false;if(sticks[side]!==null&&sticks[side]!==pid)return false;sticks[side]=pid;pointers.set(pid,{side});channels[side].commands.touchMove(x,y);return true;}
function nearest(e){let best=players[0],dist=Infinity;for(const p of players){if(p.dead||p.removed)continue;const d=(p.x-e.x)**2+(p.z-e.z)**2;if(d<dist){best=p;dist=d;}}return best;}
function restoreCamera(){if(!enabled||!players.length)return;mid.x=(players[0].x+players[1].x)/2;mid.y=Math.max(players[0].y,players[1].y);mid.z=(players[0].z+players[1].z)/2;G.cam.follow(mid);}
function grace(){for(const p of players)if(!p.dead){p.inv=Math.max(24,p.inv);const n=G.published.native(p);if(n)n.player.invuln=Math.max(24,n.player.invuln);}}
function paint(){if(!enabled||!controls)return;controls.hidden=G.sceneName!=='play'||G.paused||!!G.story?.blocked||G.scenes.play?.over||G.scenes.play?.cleared;
 for(let i=0;i<players.length;i++){const p=players[i];if(markers[i]&&G.camera){const at=G.toScreen(p.x,p.y+p.height+.25,p.z);markers[i].hidden=!at.visible;markers[i].style.left=at.x+'px';markers[i].style.top=at.y+'px';}if(status[i])status[i].textContent='P'+(i+1)+' '+(p.meta?.name||p.type)+'  HP '+Math.ceil(p.hp)+'/'+p.maxHp+'  ◆'+p.dim+(p.dead?'  ふっかつ待ち':p.publishedVictim?'  つかみ中':'');}}
const api=G.coop={get enabled(){return enabled;},players,channels,press,release,stick,clearInputs,scoped,restoreCamera,grace,
 enable(a,b){clearInputs();ids=[a,b];enabled=true;carry=null;lastStage=-1;if(G.game)Object.assign(G.game,{level:1,xp:0,xpNext:60,coins:0,bestCombo:0,ultCarry:0,publishedCarry:null});},
 disable(){clearInputs();enabled=false;players.length=0;carry=null;primary.input.player=null;secondary.input.player=null;if(controls)controls.hidden=true;},
 updateInputs(){secondary.update();},
 enter(p){if(!enabled)return;players.length=0;players.push(p);p.coopSlot=0;primary.input.player=p;
  if(G.game.stageIndex<=lastStage)carry=null;const previous={level:G.game.level,xp:G.game.xp,xpNext:G.game.xpNext,publishedCarry:G.game.publishedCarry};G.game.publishedCarry=carry;if(carry)for(const k of ['level','xp','xpNext'])G.game[k]=carry[k]??G.game[k];let q;try{q=G.playerCtl.create(ids[1],p.x+1.1,.35);}finally{Object.assign(G.game,previous);}
  q.coopSlot=1;players.push(q);secondary.input.player=q;G.world.add(q);clearInputs();buildControls();restoreCamera();},
 exit(){if(!enabled)return;lastStage=G.game.stageIndex;carry=players[1]?G.published.native(players[1]).carry():null;clearInputs();players.length=0;if(controls)controls.hidden=true;},
 tickHeroes(){if(!enabled||players.length!==2)return false;if(inside)return false;inside=true;try{for(const p of players)scoped(p,()=>G.playerCtl.tick(p));}finally{inside=false;}return true;},
 queueHeroes(){if(!enabled)return false;for(const p of players)scoped(p,()=>G.playerCtl.queue(p));return true;},
 tickFoe(e){if(!enabled||!players.length)return false;scoped(nearest(e),()=>{G.foes.tick(e);G.foes.h.alignPublishedLane(e);});return true;},
 afterCombat(scene){if(!enabled||players.length!==2)return;const q=players[1];if(G.stage.done)api.winGuard();
  if(q.dead){q.coopKo=(q.coopKo||0)+1;if(q.coopKo>=100){q.coopKo=0;if(G.game.lives!==Infinity&&!G.stage.done){G.game.lives--;if(G.game.lives<=0){scene.gameOver();return;}}q.dead=false;q.hp=q.maxHp;q.inv=180;q.vy=.12;q.onGround=false;G.game.revives++;G.bus.emit('revive',{ent:q});}}
  else q.coopKo=0;
  // Shared-screen tether is symmetric: neither player can drag the other offscreen.
  const half=Math.max(1.2,(G.cam.halfW||5)-1.2),cx=(players[0].x+q.x)/2;
  for(const p of players){p.x=G.U.clamp(p.x,cx-half,cx+half);const n=G.published.native(p);n.player.x=p.x*60;}
  restoreCamera();paint();},
 winGuard(){if(!enabled)return;for(const p of players){p.inv=Math.max(p.inv,9999);if(p.dead){p.dead=false;p.hp=Math.max(1,Math.ceil(p.maxHp*.5));p.coopKo=0;}}},
 enqueueStories(kind,run,stage,enqueue,heroes){if(!enabled||!players[1])return;const p=players[1],h=heroes[p.type];if(!h)return;enqueue({kind,hero:p.type,player:p,key:kind+':'+run+':p2',title:'P2 '+h.name+(kind==='intro'?'、出発！':'の ステージクリア！'),lines:[(kind==='intro'?h.start:h.clear)[stage],kind==='intro'?h.cue:h.win],cue:kind==='intro'?h.cue:h.win});},
 openMenu,
};
// Damage and pickup callbacks must read the affected hero's channel, never P1's.
const receive=G.published.receiveDamage;G.published.receiveDamage=(p,...args)=>enabled&&players.includes(p)?scoped(p,()=>receive(p,...args)):receive(p,...args);
const pickup=G.pickups.tick;G.pickups.tick=e=>enabled&&players.length?scoped(nearest(e),()=>pickup(e)):pickup(e);
const frame=G.cam.frame.bind(G.cam);G.cam.frame=(...args)=>{if(enabled&&!G.story?.blocked)restoreCamera();return frame(...args);};
const cover=G.cam.rightCover.bind(G.cam);G.cam.rightCover=()=>enabled?0:cover();
function node(tag,parent,text){const e=document.createElement(tag);if(text!=null)e.textContent=text;if(parent)parent.append(e);return e;}
function prevent(e){e.preventDefault();e.stopPropagation();}
function buildControls(){if(!document.body)return;if(controls)controls.remove();controls=node('div',document.body);controls.id='inuCoopControls';status=[];markers=[];
 const style=node('style',controls);style.textContent='#inuCoopControls{position:fixed;inset:0;pointer-events:none;z-index:35;font:600 12px system-ui;color:white;touch-action:none}#inuCoopControls .coop-pad{position:absolute;bottom:max(6px,env(safe-area-inset-bottom));width:49%;height:156px;display:flex;align-items:flex-end;justify-content:space-around;background:linear-gradient(0deg,#071b3877,transparent);border-radius:18px;pointer-events:none}#inuCoopControls .coop-stick{box-sizing:border-box;width:clamp(64px,13vw,108px);height:clamp(64px,13vw,108px);border:3px solid var(--pc);border-radius:50%;background:#102d4588;pointer-events:auto;touch-action:none;display:grid;place-items:center;user-select:none}#inuCoopControls .coop-grid{display:grid;grid-template-columns:repeat(2,minmax(44px,1fr));gap:4px;pointer-events:auto}#inuCoopControls button{box-sizing:border-box;min-width:44px;min-height:44px;font:700 clamp(10px,1.7vw,14px) system-ui;border:2px solid var(--pc);border-radius:12px;color:white;background:#16314ed9;padding:4px;touch-action:none;user-select:none}#inuCoopControls .coop-status{position:absolute;top:max(6px,env(safe-area-inset-top));max-width:46%;background:#102438cf;padding:5px 8px;border-radius:10px;border:2px solid var(--pc);font-size:clamp(10px,1.7vw,15px)}#inuCoopControls .coop-notice{position:absolute;top:50px;left:50%;transform:translateX(-50%);font-size:11px;background:#102438aa;white-space:nowrap;padding:3px 8px;border-radius:8px}@media(min-width:900px){#inuCoopControls .coop-pad{height:190px}#inuCoopControls button{min-height:54px;min-width:60px}}';
 for(let i=0;i<2;i++){const color=i?'#ffb361':'#70d8ff',pad=node('section',controls);pad.className='coop-pad';pad.style.setProperty('--pc',color);pad.style[i?'right':'left']='0';pad.setAttribute('aria-label','P'+(i+1)+' controls');
  const joy=node('div',pad,'P'+(i+1)+' 移動');joy.className='coop-stick';joy.setAttribute('role','application');joy.setAttribute('aria-label','P'+(i+1)+' joystick');
  function move(e){const r=joy.getBoundingClientRect();return stick(i,e.pointerId,(e.clientX-r.left-r.width/2)*100/r.width,(e.clientY-r.top-r.height/2)*100/r.height);}
  joy.addEventListener('pointerdown',e=>{prevent(e);if(move(e))joy.setPointerCapture(e.pointerId);},{passive:false});joy.addEventListener('pointermove',e=>{if(sticks[i]!==e.pointerId)return;prevent(e);move(e);},{passive:false});
  for(const ev of ['pointerup','pointercancel','lostpointercapture'])joy.addEventListener(ev,e=>{prevent(e);release(e.pointerId);},{passive:false});
  const grid=node('div',pad);grid.className='coop-grid';for(const [key,label]of [['attack','攻撃'],['jump','ジャンプ'],['grab','つかむ'],['dodge','よける'],['special','必殺'],['ult','奥義']]){const b=node('button',grid,label);b.type='button';b.setAttribute('aria-label','P'+(i+1)+' '+label);b.dataset.coopAction=key;b.dataset.coopPlayer=String(i);
   b.addEventListener('pointerdown',e=>{prevent(e);if(press(i,key,e.pointerId)){b.setPointerCapture(e.pointerId);G.audio?.unlock?.();}},{passive:false});for(const ev of ['pointerup','pointercancel','lostpointercapture'])b.addEventListener(ev,e=>{prevent(e);release(e.pointerId);},{passive:false});}
  const marker=node('span',controls,'P'+(i+1));marker.style.cssText='position:absolute;transform:translate(-50%,-100%);font:800 14px system-ui;background:#102438cc;border:2px solid '+color+';border-radius:8px;padding:2px 6px';markers.push(marker);
  const label=node('div',controls);label.className='coop-status';label.style.setProperty('--pc',color);label.style[i?'right':'left']='6px';status.push(label);
 }
 const pause=node('button',controls,'II');pause.type='button';pause.setAttribute('aria-label','Pause cooperative game');pause.style.cssText='position:absolute;top:48px;right:8px;pointer-events:auto;--pc:#fff0b0';pause.onclick=e=>{prevent(e);G.scenes.play.pause(!G.paused);};
 const guide=node('button',controls,'技一覧');guide.type='button';guide.style.cssText='position:absolute;top:48px;left:8px;pointer-events:auto;--pc:#fff0b0';guide.onclick=e=>{prevent(e);clearInputs();G.scenes.play.pause(true);G.commandGuide?.open();};
 const note=node('div',controls,'1台で2人協力・横向きがおすすめ');note.className='coop-notice';paint();}
function openMenu(){if(menu)menu.remove();menu=node('section',document.body);menu.setAttribute('role','dialog');menu.setAttribute('aria-modal','true');menu.style.cssText='position:fixed;inset:0;z-index:13000;background:#10243bf5;color:#fff8dd;font:18px system-ui;padding:20px;box-sizing:border-box;overflow:auto;touch-action:manipulation';
 node('h2',menu,'1台の画面で 2人協力');node('p',menu,'スマホ・iPadは横向きがおすすめ。2つの移動スティックと、それぞれの攻撃ボタンを同時に使います。オンライン対戦ではありません。');
 const row=node('div',menu);row.style.cssText='display:flex;gap:18px;flex-wrap:wrap';const selects=[];
 for(let i=0;i<2;i++){const col=node('div',row);col.style.cssText='flex:1;min-width:130px';node('label',col,'P'+(i+1)+' キャラクター');const img=node('img',col);img.style.cssText='display:block;width:90px;height:90px;object-fit:contain';const select=node('select',col);select.style.cssText='font:inherit;min-height:44px;max-width:100%';
  for(const id of G.heroes.ids){const opt=node('option',select,G.heroes.get(id)?.name||G.story.heroes[id]?.name||id);opt.value=id;}select.value=ids[i];const refresh=()=>{img.src=G.heroes.portrait(select.value,{size:160})||'';img.alt=G.story.heroes[select.value]?.name||select.value;};select.onchange=refresh;refresh();selects.push(select);}
 const difficulty=node('select',menu);difficulty.style.cssText='font:inherit;min-height:44px;margin:14px';for(const [key,label]of [['easy','やさしい'],['normal','ふつう'],['hard','つよい']]){const o=node('option',difficulty,label);o.value=key;}difficulty.value=G.game.diffKey;
 const start=node('button',menu,'2人で 出発！');start.style.cssText='font:inherit;min-height:48px;padding:10px 20px';start.onclick=()=>{api.enable(selects[0].value,selects[1].value);menu.remove();menu=null;G.debug.play(selects[0].value,0,difficulty.value);G.ui?.touch?.show(false);};
 const back=node('button',menu,'もどる');back.style.cssText='font:inherit;min-height:44px;margin:10px';back.onclick=()=>{menu.remove();menu=null;};node('p',menu,'キーボード：P1 矢印 / J攻撃 Iジャンプ Kよけ Lつかむ H必殺 O奥義。P2 WASD / F攻撃 Rジャンプ Gよけ Tつかむ Y必殺 B奥義。残機は共有、各自のHPと奥義は別です。');}
function showLaunch(){if(!document.body)return;if(!launch){launch=node('button',document.body,'1台で2人協力');launch.type='button';launch.style.cssText='position:fixed;left:50%;top:max(8px,env(safe-area-inset-top));transform:translateX(-50%);z-index:1000;min-height:44px;border:3px solid #fff0bc;border-radius:14px;background:#234a72;color:white;font:700 16px system-ui;padding:8px 20px;touch-action:manipulation';launch.onclick=openMenu;}launch.hidden=!['title','select'].includes(G.sceneName);}
G.bus.on('scene',d=>{if(d.name==='title')api.disable();showLaunch();paint();});
G.bus.on('storyStart',clearInputs);G.bus.on('pause',clearInputs);G.bus.on('hidden',clearInputs);window.addEventListener('blur',clearInputs);
const releaseTouch=G.ui.touch.release?.bind(G.ui.touch),showTouch=G.ui.touch.show.bind(G.ui.touch);G.ui.touch.release=()=>{releaseTouch?.();if(enabled)clearInputs();};G.ui.touch.show=on=>showTouch(enabled?false:on);
const uiFrame=G.ui.frame.bind(G.ui);G.ui.frame=(...args)=>{const r=uiFrame(...args);paint();return r;};showLaunch();
})();

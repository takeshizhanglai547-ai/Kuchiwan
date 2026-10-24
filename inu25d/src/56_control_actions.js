// Dedicated buttons are separate from directional Attack commands. They feed
// native chord/rotation input once, preserving native animation/cost/cancel logic.
(function(){'use strict';const G=window.G;
const tell=(text)=>G.bus.emit('controlHint',{text});
function cards(C,list){C.cardSeq.splice(0,C.cardSeq.length,...list.map(c=>({c,f:C.now()})));C.stickRot=-999;C.consume8?.();}
G.commandInputs={
 read(p,ctx){const I=G.input,C=G.commands,r=ctx.ref.player,airUlt=r.state==='jump'||(r.state==='attack'&&r.z>6);
  const data={left:C.forward(-1),right:C.forward(1),up:C.up(),down:C.down(),attack:I.btn.attack.down,grab:I.btn.grab.down,dodge:I.btn.dodge.down,
    pressed:{attack:I.btn.attack.pressed,grab:I.btn.grab.pressed,jump:I.btn.jump.pressed,dodge:I.btn.dodge.pressed},cards:C.cardSeq,taps:C.dirTaps,downs:C.downTaps,rotation:C.stickRot};
  const dedicated=I.btn.ult.pressed||I.btn.special.pressed;
  if(dedicated){const ult=I.btn.ult.pressed;
   ctx.ref.clearEdges();C.consume();
   ctx.buttonAction=null;ctx.gripAction=null;ctx.grabAttempt=false;data.pressed.attack=data.pressed.grab=false;
   if(!['idle','walk','attack','jump'].includes(r.state))tell('動作が終わってから使おう');
   else if(r.state==='attack'&&(r.atk?.def.ultMove||r.atk?.def.isUlt))tell('奥義の動作が終わってから使おう');
   else if(!ult&&(r.z>0||r.state==='jump'))tell('必殺ボタンは地上で使います');
   else if(!ult&&r.sgCd>0)tell('必殺の準備まで '+Math.ceil(r.sgCd/60)+'秒');
   else if(ult&&r.dim<ctx.ref.cost(airUlt))tell('奥義ストックが足りません');
   else ctx.buttonAction=ult?'ult':'special';
  }
  if(ctx.buttonAction){data.pressed.attack=true;data.pressed.grab=ctx.buttonAction==='special';data.attack=true;data.grab=ctx.buttonAction==='special';data.up=data.down=data.left=data.right=false;
    cards(C,ctx.buttonAction==='ult'?[0,1,2,3]:[]);data.rotation=-999;
  }else if(r.state==='grab'&&!dedicated){
   if(I.btn.attack.pressed)ctx.gripAction=null;
   if(I.btn.grab.pressed&&!I.btn.attack.pressed){ctx.gripAction='release';data.pressed.grab=false;ctx.ref.clearEdges();}
   else if(I.btn.attack.pressed&&C.forward(r.facing)&&!C.up()&&!C.down()){
    ctx.gripAction='strike';data.pressed.attack=false;ctx.ref.clearEdges();C.consume8?.();}
  }else if(I.btn.attack.pressed&&!dedicated)C.routeMotion?.(r.facing);
  if(I.btn.grab.pressed&&!I.btn.attack.pressed&&!ctx.buttonAction&&r.state!=='grab')ctx.grabAttempt=true;
  ctx.hadCards=C.cardSeq.length>0;data.rotation=C.stickRot;return data;
 },
 before(p,ctx){if(ctx.gripAction){const action=ctx.gripAction;ctx.ref.gripControl(action);ctx.gripAction=null;if(action==='release')tell('つかみを はなした');}},
 after(p,ctx){if(ctx.hadCards&&!G.commands.cardSeq.length)G.commands.consume8?.();ctx.buttonAction=null;
  const r=ctx.ref.player;if(ctx.grabAttempt){ctx.grabAttempt=false;if(r.state==='grab')tell('つかんだ！ 方向＋攻撃で技が変わる');
    else tell(r.z>0?'つかむのは地上で': '正面の地上の敵へ近づこう（無敵・登場中は不可）');}
  G.controlFeedback?.update?.(p,r);
 },
 reset(ctx){ctx.buttonAction=ctx.gripAction=null;ctx.grabAttempt=false;}
};
})();

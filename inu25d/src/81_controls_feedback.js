// Discoverability/status only; the native fighter owns target validity and hits.
(function(){'use strict';const G=window.G;let panel=null,hint='',until=-1,holding=false;
function ensure(){if(panel||!document.body)return;const style=document.createElement('style');style.textContent='.inu-controls-status{position:fixed;top:max(72px,calc(env(safe-area-inset-top) + 62px));left:50%;transform:translateX(-50%);z-index:1800;max-width:min(92vw,720px);padding:7px 13px;border:2px solid #d7a94e;border-radius:12px;background:#fff6d9ed;color:#263d4a;font:700 clamp(12px,2vmin,17px)/1.4 system-ui,sans-serif;text-align:center;pointer-events:none}.inu-controls-status[hidden]{display:none}#iu .tb.grab.grabbing{box-shadow:0 0 0 4px #fff8be,0 0 18px #ffe468}.inu-controls-status strong{color:#9a4b21}@media(max-height:430px){.inu-controls-status{top:max(59px,calc(env(safe-area-inset-top) + 52px));max-width:68vw;padding:4px 9px}}';document.body.append(style);
 panel=document.createElement('div');panel.className='inu-controls-status';panel.setAttribute('role','status');panel.setAttribute('aria-live','polite');panel.hidden=true;document.body.append(panel);}
G.controlFeedback={update(p,r){ensure();if(!panel)return;const grabbed=r.state==='grab'&&r.grabEnemy&&!r.grabEnemy.dead;
 if(holding&&!grabbed&&hint.startsWith('つかんだ')){hint='つかみ技／解放';until=G.commands.now()+70;}holding=!!grabbed;
 const button=document.querySelector?.('#iu .tb.grab');button?.classList.toggle('grabbing',holding);button?.setAttribute('aria-pressed',String(holding));
 const busy=!['idle','walk','attack','jump'].includes(r.state)||(r.state==='attack'&&(r.atk?.def.ultMove||r.atk?.def.isUlt)),airUlt=r.state==='jump'||(r.state==='attack'&&r.z>6);
 const ult=document.querySelector?.('#iu .tb.ult');ult?.classList.toggle('ready',!busy&&r.dim>=G.published.native(p).cost(airUlt));
 const special=document.querySelector?.('#iu .tb.special');special?.setAttribute('aria-disabled',String(busy||r.sgCd>0||r.z>0||r.state==='jump'));
 const label=holding?'つかみ中 '+Math.max(0,Math.ceil(r.grabT/60))+'秒 ｜ 前＋攻撃：小攻撃 ／ 無方向・↑・↓・後ろ＋攻撃：技 ／ つかむ：はなす':G.commands.now()<until?hint:'';
 panel.hidden=!label||G.sceneName!=='play'||G.paused||!!G.story?.blocked;if(panel.textContent!==label)panel.textContent=label;
 }};
G.bus.on('controlHint',d=>{hint=d.text;until=G.commands.now()+120;ensure();});
G.bus.on('scene',()=>{holding=false;hint='';until=-1;if(panel)panel.hidden=true;});
G.bus.on('storyStart',()=>{if(panel)panel.hidden=true;});
})();

// User-facing command reference generated from the actual published dispatch and definitions.
(function(){'use strict';const G=window.G;let panel=null,priorFocus=null;
const names={inu:'イッヌ',shima:'シマ',nuko:'ヌコ',guard8:'ガードワン８号',watch:'ワッチ',wanden:'ワンデン',mack:'マック'};
const groups={ground:'地上コマンド',upgrade:'成長する地上技',combo:'通常コンボ',charge:'ため攻撃', 'air-command':'空中コマンド','air-direction':'空中の方向攻撃','air-rave':'空中連携','grab-entry':'つかむ',throw:'つかみからの技',chord:'地上の同時押し技','ground-ultimate':'地上おうぎ','air-ultimate':'空中おうぎ'};
function node(tag,parent,text){const e=document.createElement(tag);if(text!=null)e.textContent=text;parent?.append(e);return e;}
function close(){if(!panel)return;panel.remove();panel=null;G.input.clear();G.published?.resetInput();G.commands.reset();priorFocus?.focus?.();}
function open(){if(panel)return;priorFocus=document.activeElement;G.input.clear();G.published?.resetInput();
 panel=node('section',document.body);panel.className='inu-command-guide';panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');panel.setAttribute('aria-label','わざとコマンド');
 const style=node('style',panel);style.textContent='.inu-command-guide{position:fixed;inset:4vh max(12px,calc((100vw - 980px)/2));z-index:10000;display:flex;flex-direction:column;background:#fffaf0;color:#263c51;border:3px solid #86bdd2;border-radius:18px;box-shadow:0 8px 35px #172f5177;font:15px/1.55 system-ui,sans-serif;overflow:hidden;touch-action:pan-y}.inu-command-guide header{padding:10px 14px;background:#e5f5ff;display:flex;gap:12px;align-items:center;flex-wrap:wrap}.inu-command-guide h2{font-size:19px;margin:0;flex:1}.inu-command-guide button,.inu-command-guide select{font:inherit;min-height:40px;border:1px solid #7aa6b8;border-radius:9px;background:white;color:#243e50;padding:5px 12px;touch-action:manipulation}.inu-command-guide article{overflow:auto;padding:12px 18px;overscroll-behavior:contain}.inu-command-guide p{margin:5px 0 12px}.inu-command-guide table{border-collapse:collapse;width:100%;font-size:14px}.inu-command-guide th,.inu-command-guide td{text-align:left;border-bottom:1px solid #cbdce2;padding:7px 5px;vertical-align:top}.inu-command-guide h3{margin:14px 0 4px;font-size:16px;color:#315f84}.inu-command-guide .notes{background:#f0f5e6;border-radius:10px;padding:10px}.inu-command-guide small{font-size:12px}.inu-command-guide footer{padding:7px 14px;background:#e5f5ff;font-size:12px}@media(max-height:440px){.inu-command-guide{inset:5px 12px}.inu-command-guide header{padding:5px 10px}.inu-command-guide article{padding:7px 14px}.inu-command-guide header h2{font-size:17px}}';
 const header=node('header',panel);node('h2',header,'わざとコマンド');const hero=node('select',header);hero.setAttribute('aria-label','キャラクター');for(const [id,name]of Object.entries(names)){const o=node('option',hero,name);o.value=id;}hero.value=G.player?.type||G.game?.heroId||'inu';
 const level=node('select',header);level.setAttribute('aria-label','技のレベル');for(const l of [1,3,5,6,7,9,10,12,20]){const o=node('option',level,'Lv '+l);o.value=String(l);}level.value=String([1,3,5,6,7,9,10,12,20].filter(l=>l<=(G.player?.level||1)).at(-1));
 const end=node('button',header,'とじる ×');end.onclick=close;const body=node('article',panel);body.tabIndex=0;
 const draw=()=>{body.replaceChildren();const id=hero.value,lv=Number(level.value),all=G.publishedCatalog.rows.filter(r=>r.hero===id),cost=G.publishedCatalog.costs[id].filter(c=>c.level<=lv).at(-1);
  node('p',body,'矢印は右向きの例。左向きでは前・後ろを入れかえる。左右で横移動、上下で奥・手前へ移動。上下＋攻撃では方向技を選び、技の動作中はレーン移動を止めます。スマホのスティックも同じ操作です。こうげき J/Z、ジャンプ I/Space、よける K/X、つかむ L/U/Shift、必殺 H/C、奥義 O/V。');
  const n=node('div',body);n.className='notes';node('p',n,'スマホ：左レバー＋右の６ボタン。前＋攻撃、↓＋攻撃、↑＋攻撃、↓↑＋攻撃、波動 ↓↘→＋攻撃、昇竜 →↓↘＋攻撃。これらは必殺・奥義ボタンなしで出せます。原作の ↓→／→↓→ も使えます。長いコマンドが単純な方向技より優先です。');
  node('p',n,'通常攻撃は押し直すと連携。長押しして離すとため攻撃。空中はジャンプをもう一度で２段ジャンプ、よけるは１回だけ。');
  node('p',n,'つかみ中：前＋攻撃＝小攻撃（6・保持継続）、無方向・↑・↓・後ろ＋攻撃＝原作の決め技。つかむをもう一度で解放、何もしなくても180Fで解放。原作で同じだった前入力に小攻撃を追加しました。ウォッチは原作通り、無方向／上下／後ろは盗み技です。');
  node('p',n,'ボスも原作通りつかめます。ただし登場中・無敵・変身中・空中の相手は不可。正面の近い地上の敵をねらってください。つかみ中は画面に状態と操作を表示します。');
  node('p',n,'必殺ボタンは地上の攻撃＋つかむ専用技と同じ（ストック消費なし、540F待機）。奥義ボタンは地上／空中の奥義（必要ストックを消費）。不足時は通常攻撃へ化けません。従来の回転＋攻撃、空中の攻撃＋つかむも残しています。');
  node('p',n,'おうぎストック：地上 '+cost.ground+' ／空中 '+cost.air+' 必要。ストック不足では発動しません。');
  node('p',n,'つよい：敵の体力はふつうと同じ。最大3体が左右から包囲し、攻撃開始は12Fずつずれます。雑魚の予告は最低18F、攻撃を避けた後は28Fの反撃機会。残機は3。奥義ストックを温存し、つかみ・投げで集団を崩しましょう。');
  node('p',n,'イベント：ボスの体力が半分未満で後半戦のカットイン。演出中は戦闘と時計が停止します。30F後から「つづける」／Enter／Spaceでスキップ、P／Escで演出だけ一時停止。演出中の攻撃入力は持ち越しません。キャラごとの開始・クリア演出もあります。');
  node('p',n,'追加の敵：狙いイヌの赤い照準は撃つ場所の予告。照準が止まったら上下のラインを変えて回避。スカイアーマーわんこは普通の攻撃を大きく軽減します。空襲後の着地中につかみ、方向＋攻撃で鎧ごと投げましょう。');
  node('p',n,'全9ステージ：戦国和風の足軽・薙刀・忍び、鬼合戦の赤鬼・青鬼・太鼓鬼が登場。ボスは体力半分未満で姿と攻撃が変化。ダークわんわん大帝は第3形態まで、変身ごとにカットシーンが入ります。');
  for(const [group,title]of Object.entries(groups)){let rows=all.filter(r=>r.group===group&&r.level<=lv);
   if(group==='charge')rows=rows.filter(r=>r.level===Math.max(...rows.map(r=>r.level)));
   if(!rows.length)continue;node('h3',body,title);const table=node('table',body),thead=node('thead',table),tr=node('tr',thead);for(const x of ['入力／段','技','発生・持続／備考'])node('th',tr,x);const tb=node('tbody',table);
   for(const r of rows){const tr=node('tr',tb);node('td',tr,r.command);node('td',tr,(r.level>1?'Lv'+r.level+' ':'')+r.name);const notes=[];if(r.active)notes.push('有効 '+r.active[0]+'〜'+r.active[1]+'F');if(r.duration)notes.push('全体 '+r.duration+'F');if(r.note)notes.push(r.note);if(r.hold)notes.push('溜め上限 '+r.hold+'F');node('td',tr,notes.join(' ／ ')||'専用動作');}
  }
  node('h3',body,'つなぎ・押し直し');node('p',body,'通常コンボからは ↓→／→↓→／↓↑ へキャンセル。コマンド技からは別のコマンド枠へ３技まで。同じ枠へは繋ぎ直せません。空中コマンドは空中で繋ぎ、着地すると技を終えます。連打で延長・追加する技も押しっぱなしでは増えません。');
  node('small',body,'1F＝1/60秒。波動 ↓↘→ は下から前20F以内・開始から攻撃28F以内・最後の前から9F以内。昇竜 →↓↘ は各区間20F以内・開始から攻撃40F以内・最後の斜めから9F以内。↓↑は下→上30F以内＋上を保ち34F以内。ダッシュは後ろ→前18F以内＋前から10F以内。押し直さない限り別の技を自動発動しません。');
 };
 hero.onchange=level.onchange=draw;draw();node('footer',panel,'この一覧は2D原本の実際の入力分岐・技定義から生成。技のレベル選択は表示だけです。');end.focus();
}
window.addEventListener('keydown',e=>{if(!panel)return;if(e.code==='Escape'){e.preventDefault();close();}e.stopImmediatePropagation();},true);
G.commandGuide={open,close,get visible(){return !!panel;}};
})();

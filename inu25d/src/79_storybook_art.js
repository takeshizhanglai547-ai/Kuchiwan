// Inline illustrations keep the shop and storybook available offline.
(function(){'use strict';
const G=window.G;
const landmarks=[
 '<path d="M-70 32v-44l30-23 30 23v44m17 0v-55l32-28 32 28v55" fill="#ffdfb2"/><path d="M-79-10l39-31 40 31M-1-21l40-34 39 34" stroke="#b97076" stroke-width="9"/><path d="M-49 32V9h15v23M30 32V2h18v30" fill="#ce9d7f"/>',
 '<path d="M-63 32v-62h126v62M-12 32V1q12-19 24 0v31" fill="#e6b49c"/><path d="M-73-29h146l-18-22H-55Z" fill="#bd8091"/><path d="M-45-20v14m90-14v14" stroke="#ffdc83" stroke-width="9"/>',
 '<path d="M-65 26q-11-22 9-34-6-25 16-32 21 7 18 31 20 9 11 34zM-13 27q-13-29 15-46-2-27 25-36 29 12 20 37 25 17 12 45Z" fill="#88b894"/><path d="M-39 32V-6m64 38V-10" stroke="#8b6959"/><circle cx="59" cy="-51" r="12" fill="#fff1a5"/>',
 '<path d="M-78 32Q-63-46-28-48Q30-66 72 32Z" fill="#a296bf"/><path d="M-40 32Q-33-25-3-24Q23-21 31 32Z" fill="#776b9c"/><path d="M26 33l8-38 14-19 11 26-4 31zM-65 31l-5-20 9-15 12 35z" fill="#a4e3e0"/>',
 '<path d="M-75-16q14-40 75-40 62 0 75 39Q27 9-75-16Z" fill="#e8a5a6"/><path d="M-41-12l16 28h54l16-28M-39 17h78l-20 16h-39z" fill="#e8ba79"/><path d="M-39-42q21 13 12 27m60-29q-16 15-9 29" fill="none" stroke="#fbe8bd" stroke-width="6"/>',
 '<path d="M-79 32l36-65 17 25 34-56 66 96z" fill="#b6bdd8"/><path d="M-59-5l16-28 17 25 34-56 28 39-19-8-10 10-9-13-13 18-10-7-9 13z" fill="#fffdf7"/>',
 '<path d="M-68 33v-63h24v14h20v-40H9v40h20v-21h34v70z" fill="#ac98bd"/><path d="M-30-55l23-18 21 18M-74-31l18-15 18 15M24-37l21-19 23 19" fill="#786d9e"/><path d="M-15 33V9Q0-6 15 9v24" fill="#795e8b"/>',
 '<path d="M-48 32v-66m96 66v-66M-62-17H62M-71-37q70 12 142 0" fill="none" stroke="#c87981" stroke-width="10"/><path d="M-51 21q49-30 98 0" stroke="#f1b7ae" fill="none" stroke-width="4"/>',
 '<path d="M-83 32l41-53 15 13 19-46h33l59 86z" fill="#c28c90"/><path d="M-8-54h33l14 22-13-6-12 12-11-10-11 7-9-7z" fill="#f9a47f"/><path d="M-19 32V2h42v30M-23 2L2-14 27 2" fill="#f5ce9d"/>'
];
const skies=['#c6e6ed','#f2c4bd','#c8c6e8','#d0c0e5','#bbdfe9','#d7e6f1','#cbbad9','#f4cfce','#efbcaa'];
const hills=['#9fc9a1','#bdc79e','#99bb9e','#b2a6c8','#a8c6c7','#bccbd8','#a69bb7','#b6c59a','#c59594'];
const names=['王都','黄昏の城下町','月夜の森','瑠璃の水晶洞','海賊飛行艇','氷雪の霊峰','ダークワンワン城','わんこ合戦','紅蓮の門'];
function passage(index,clear){
 if(index>=names.length||(clear&&G.stages?.[index+1]?.lap)){
  const stages=G.stages||[],current=stages[index],other=stages[index+(clear?1:-1)];
  if(!current)return null;
  const from=(clear?current:other)?.name||'王国',to=(clear?other:current)?.name||'王国へ帰還';
  const panel=({bug:2,space:4,sea:3,war:7})[(clear?other:current)?.journeyStyle||current.journeyStyle]||0;
  return {caption:from+' → '+to,svg:passage(panel,false).svg};
 }
 const from=clear?index:Math.max(0,index-1),to=clear?Math.min(index+1,8):index;
 const start=!clear&&index===0,finish=clear&&index===8;
 const left=start?'王都への街道':names[from],right=finish?'王国へ帰還':names[to];
 return {caption:left+' → '+right,svg:`<svg viewBox="0 0 420 230" aria-hidden="true">
 <defs><pattern id="inu-book-paper" width="21" height="17" patternUnits="userSpaceOnUse"><path d="M2 5l4-1m8 9l4-2m-7-9l2 1" stroke="#775c5d" stroke-opacity=".18" stroke-width=".7"/></pattern></defs>
 <rect width="420" height="230" rx="9" fill="${skies[to]}"/><circle cx="320" cy="47" r="25" fill="#fff1b7" opacity=".82"/>
 <g fill="#fff8eb" opacity=".84"><path d="M23 45q0-12 15-11 8-17 24-3 17-6 25 12zM163 54q6-13 18-12 11-18 25-4 12-1 16 14z"/></g>
 <path d="M0 140Q77 77 155 136Q224 74 291 128Q348 78 420 111V230H0Z" fill="${hills[to]}"/>
 <path d="M0 163Q89 145 142 160Q232 174 296 146Q359 120 420 150V230H0Z" fill="#d8d7a7"/>
 <path d="M57 166q61 43 153 24t147-28" fill="none" stroke="#a98977" stroke-opacity=".48" stroke-width="16" stroke-linecap="round"/>
 <path d="M57 164q61 43 153 24t147-28" fill="none" stroke="#fff1cb" stroke-width="11" stroke-linecap="round"/>
 <g stroke="#796270" stroke-width="3" stroke-linejoin="round" transform="translate(89 131) scale(.70)">${start?'':landmarks[from]}</g>
 <g stroke="#796270" stroke-width="3" stroke-linejoin="round" transform="translate(321 123)">${finish?landmarks[0]:landmarks[to]}</g>
 <g transform="translate(204 176)" stroke="#725463" stroke-width="2"><path d="M-12 10q-4-16 10-17 13 1 11 17z" fill="#f1b9aa"/><path d="M-11-9q-1-13 9-13 10 0 12 11Q7-2-2-3q-8 0-9-6z" fill="#fff0d7"/><path d="M-10-13l-6 3 2 7 5-4m17-8 6 3-1 7-5-4" fill="#d0a394"/></g>
 <path d="M8 207l16-6m18 19 15-6m78 3 16-5m102 5 14-5m104 7 15-6" stroke="#809074" stroke-width="2" opacity=".55"/>
 <rect width="420" height="230" rx="9" fill="url(#inu-book-paper)"/></svg>`};
}
const products={
 sword:'<path d="M29 74l43-43 35-15-14 35-43 43z" fill="#dfecf2"/><path d="M48 75l44-43 15-16-14 35-43 43z" fill="currentColor"/><path d="M33 66l23 23-5 6-24-24z" fill="#e6b66b"/><path d="M37 82l-13 13-7-7 14-14z" fill="#95677f"/>',
 katana:'<path d="M28 73q45-20 82-55-22 43-71 66z" fill="#e8f3f4"/><path d="M33 78q44-22 72-53" fill="none" stroke="currentColor" stroke-width="4"/><path d="M27 69l17 19-5 5-17-19z" fill="#edc783"/><path d="M30 80L15 94l-5-6 13-14z" fill="#8d6377"/>',
 pole:'<path d="M22 90l58-60 6 6-59 60z" fill="#b38566"/><path d="M76 30l36-15-14 33-13-4z" fill="currentColor"/><path d="M88 35l19-15" stroke="#fff6e1"/>',
 gun:'<path d="M22 43h61V33h22v9h14v14h-17l-16 14H57l-8 19H32l7-20H22z" fill="currentColor"/><path d="M25 45h58v12H25zM89 38h14v22H89z" fill="#eee2dc"/><path d="M40 72l-5 13h11l6-13" fill="#a07470"/>',
 heavy:'<path d="M24 91l49-50 8 9-49 50z" fill="#ab795d"/><path d="M53 42l27-29 31 28-29 29z" fill="currentColor"/><path d="M60 41l21-22 7 6-21 22z" fill="#ffe6ad"/><path d="M79 65l28-27" stroke="#886e79"/>',
 magic:'<path d="M28 94l45-53 7 5-45 55z" fill="#ac8465"/><path d="M69 46l-3-16 12-18 21 1 11 17-7 19-20 7z" fill="currentColor"/><path d="M70 31l15 3 14-18m-14 18 7 18m-7-18 23-3" fill="none" stroke="#fff0fa"/>',
 fist:'<path d="M36 79l-7-27 8-16 10 2 7-7 9 4 9-5 9 5 9-3 9 12-1 17-12 20z" fill="currentColor"/><path d="M39 73h51l-7 14H45z" fill="#dbb68c"/><path d="M48 40v16m16-19v18m17-18v17" fill="none" stroke="#f9e8e3"/>',
 chain:'<path d="M24 85Q33 51 73 58Q88 64 96 39" fill="none" stroke="#bd9d94" stroke-width="8" stroke-dasharray="6 4"/><path d="M83 35l1-15 12-7 14 5 7 14-7 13-16 1z" fill="currentColor"/><path d="M15 83l15-5 4 10-15 5z" fill="#b88061"/>',
 fan:'<path d="M59 90L30 35Q66 14 112 32L69 91z" fill="currentColor"/><path d="M63 82L44 33m21 49 1-57m0 57 22-55m-21 55 36-48" stroke="#ffefd3" fill="none"/><circle cx="65" cy="84" r="4" fill="#e2ae6a"/>',
 gadget:'<path d="M42 75l-8-21 12-19 22-4 12-16 11 4 4 17 13 15-10 26z" fill="currentColor"/><path d="M39 49h64l-4 12H43z" fill="#ffe1a9"/><path d="M61 62h18v12H61z" fill="#f5b9bb"/>',
 manju:'<path d="M30 80q-14-6-7-24 15-26 48-26 35 0 46 25 7 19-9 25z" fill="#ffe4b6"/><path d="M36 69q31-15 66 0" fill="none" stroke="#d1a07b"/><path d="M60 51q9-8 19 0" fill="none" stroke="#ce8794"/>'
};
function merchandise(row,family){
 const color=/^#[0-9a-f]{3,8}$/i.test(row.col||'')?row.col:'#eab5c7';
 const bottle={potion:'#ed97ad',fullPotion:'#ad9cd6',energy:'#e8b75d'}[row.id];
 const art=bottle?`<path d="M56 26h24v14q21 11 21 27 0 17-17 17H52q-17 0-17-17 0-16 21-27z" fill="#fff6ea"/><path d="M39 64q15-8 30-2 16 6 29 0v7q-3 11-15 11H54q-13 0-15-11z" fill="${bottle}"/><rect x="53" y="20" width="30" height="10" rx="3" fill="#b78d71"/><path d="M57 50q6-5 12 0m-19 5v11" fill="none" stroke="#fff"/>`:products[family==='cane'?'pole':family]||products.sword;
 const tint=bottle||color;
 const variation=String(row.id||'').split('').reduce((sum,c)=>sum+c.charCodeAt(0),0);
 return `<svg viewBox="0 0 140 105" aria-hidden="true"><ellipse cx="70" cy="88" rx="46" ry="9" fill="#8f625a" opacity=".18"/><g style="color:${tint}" stroke="#775564" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" transform="rotate(${variation%9-4} 70 50)">${art}</g><path d="M112 22l3-7 2 7 7 2-7 2-2 7-3-7-6-2z" fill="#fff2c9" opacity=".83"/></svg>`;
}
G.storybook={passage,merchandise};
})();

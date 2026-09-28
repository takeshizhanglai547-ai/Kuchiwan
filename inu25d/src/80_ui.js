// 80_ui.js — がめん（タイトル・なかまえらび・HUD・ひとやすみ・けっか・やられちゃった・エンディング・よみこみ）と
// スマホの タッチそうさ（うかぶスティック＋おおきな まるボタン）。DOM と CSS だけで作り、3D には さわらない。
// 毎フレームの DOM 書き込みは「値が変わったときだけ」。THREE のオブジェクトは いっさい作らない。
// 重なり順（#ui の中）：てきHPバー(#iuFB) < fx のポップ < HUD 20 < GO 21 < タッチ 30 < ヒント 32 < fx のカットイン 40
//                        < バナー 45 < がめん 60 < よみこみ 70
(function(){ 'use strict';
const G = window.G; const THREE = window.THREE; const U = G.U;   // eslint-disable-line no-unused-vars
const TAU = Math.PI*2;

// ================================================================ look: palette, fonts, text outlines
const FONT = "'M PLUS Rounded 1c','Hiragino Maru Gothic ProN','Hiragino Sans','BIZ UDPGothic','Yu Gothic','Meiryo',sans-serif";
function ring(r, col, n){ const a = []; for(let i=0;i<n;i++){ const t = i/n*TAU; a.push((Math.cos(t)*r).toFixed(3)+'em '+(Math.sin(t)*r).toFixed(3)+'em 0 '+col); } return a.join(','); }
// sticker text: coloured fill + thick white rim + soft drop shadow
const STK   = ring(0.1,'#fff',18)+','+ring(0.055,'#fff',12)+',0 .17em .04em rgba(74,44,20,.4),0 .24em .5em rgba(74,44,20,.28)';
const STK_S = ring(0.09,'#fff',14)+','+ring(0.045,'#fff',8)+',0 .12em .22em rgba(74,44,20,.38)';
const ON_CANDY = ring(0.065,'var(--cd)',12)+',0 .1em 0 var(--cd)';                       // white text on a candy button
const ON_BAR = ring(0.07,'rgba(74,44,20,.78)',10);                                        // white number on a bar
// rank colours from the original table (fallback when G.game has none)
const RANKS = [ [2,'いいね！','#cfd8e6'], [8,'すごい！','#7dd0ff'], [16,'かっこいい！','#7dff5a'], [28,'さいこう！','#ffd24d'], [45,'でんせつ！','#ff9a3a'], [70,'でんせつ！！','#ff5aa0'] ];
const DIFFS = [ { k:'easy', t:'やさしい', cls:'k-mint', n:1 }, { k:'normal', t:'ふつう', cls:'k-sky', n:2 }, { k:'hard', t:'つよい', cls:'k-pink', n:3 } ];

const SVG = {
  paw:'<svg viewBox="0 0 24 24"><ellipse cx="12" cy="15.8" rx="5.4" ry="4.6"/><ellipse cx="4.9" cy="10.2" rx="2.3" ry="2.9" transform="rotate(-18 4.9 10.2)"/><ellipse cx="9.2" cy="5.6" rx="2.3" ry="3"/><ellipse cx="14.8" cy="5.6" rx="2.3" ry="3"/><ellipse cx="19.1" cy="10.2" rx="2.3" ry="2.9" transform="rotate(18 19.1 10.2)"/></svg>',
  up:'<svg viewBox="0 0 24 24"><path d="M12 2.8l9 9.6h-5.4v8.2H8.4v-8.2H3z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
  roll:'<svg viewBox="0 0 24 24"><path d="M19.2 13.8A7.4 7.4 0 1 1 16.2 6.1" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round"/><path d="M20.6 3.2v6.9h-6.9z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>',
  spark:'<svg viewBox="0 0 24 24"><path d="M12 1.5C12.9 8.2 15.8 11.1 22.5 12 15.8 12.9 12.9 15.8 12 22.5 11.1 15.8 8.2 12.9 1.5 12 8.2 11.1 11.1 8.2 12 1.5z"/></svg>',
  star:'<svg viewBox="0 0 24 24"><path d="M12 2.4l2.9 6 6.6.9-4.8 4.6 1.2 6.6L12 17.3l-5.9 3.2 1.2-6.6-4.8-4.6 6.6-.9z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>',
  heart:'<svg viewBox="0 0 24 24"><path d="M12 21.2s-8-4.9-9.9-9.8C.6 7.6 3 4 6.7 4c2.3 0 3.8 1.3 5.3 3.2C13.5 5.3 15 4 17.3 4 21 4 23.4 7.6 21.9 11.4 20 16.3 12 21.2 12 21.2z"/></svg>',
  pause:'<svg viewBox="0 0 24 24"><rect x="5.5" y="4.5" width="4.6" height="15" rx="2.3"/><rect x="13.9" y="4.5" width="4.6" height="15" rx="2.3"/></svg>',
  sndOn:'<svg viewBox="0 0 24 24"><path d="M3 9.2h3.8L12 4.8v14.4l-5.2-4.4H3z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M15.4 8.6a4.8 4.8 0 0 1 0 6.8M18.2 5.8a8.6 8.6 0 0 1 0 12.4" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round"/></svg>',
  sndOff:'<svg viewBox="0 0 24 24"><path d="M3 9.2h3.8L12 4.8v14.4l-5.2-4.4H3z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M15.5 9l5.5 6M21 9l-5.5 6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>',
  crown:'<svg viewBox="0 0 24 24"><path d="M3 8l4.6 4.2L12 4.6l4.4 7.6L21 8l-1.8 10.6H4.8z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
  go:'<svg viewBox="0 0 24 24"><path d="M3.5 8.6h8.2V3.6L21 12l-9.3 8.4v-5H3.5z" stroke="#fff" stroke-width="2.2" stroke-linejoin="round" paint-order="stroke"/></svg>',
  left:'<svg viewBox="0 0 24 24"><path d="M15.5 3.5 6.5 12l9 8.5" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  right:'<svg viewBox="0 0 24 24"><path d="M8.5 3.5l9 8.5-9 8.5" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  play:'<svg viewBox="0 0 24 24"><path d="M7 4.2v15.6L20 12z" stroke="currentColor" stroke-width="2.6" stroke-linejoin="round"/></svg>',
  home:'<svg viewBox="0 0 24 24"><path d="M3 11.5 12 3.8l9 7.7v9H14.6v-5.6H9.4v5.6H3z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>',
  clock:'<svg viewBox="0 0 24 24"><circle cx="12" cy="12.5" r="8.6" fill="none" stroke="currentColor" stroke-width="3"/><path d="M12 7.8v5l3.4 2" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  retry:'<svg viewBox="0 0 24 24"><path d="M5.2 12.4A6.9 6.9 0 1 0 8 6.7" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round"/><path d="M3.6 3.4v6.6h6.6z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>',
};
// dizzy-but-cute puppy for 「やられちゃった…」
const SAD_PUP = '<svg viewBox="0 0 140 110"><g stroke="#4a2c14" stroke-width="3.2" stroke-linejoin="round" stroke-linecap="round">' +
  '<ellipse cx="28" cy="52" rx="15" ry="26" fill="#e7c89a" transform="rotate(22 28 52)"/><ellipse cx="112" cy="52" rx="15" ry="26" fill="#e7c89a" transform="rotate(-22 112 52)"/>' +
  '<ellipse cx="70" cy="60" rx="44" ry="38" fill="#fff4dc"/>' +
  '<path d="M45 55a7 7 0 1 1 7 7a4.6 4.6 0 1 1-4.6-4.6" fill="none"/><path d="M83 55a7 7 0 1 1 7 7a4.6 4.6 0 1 1-4.6-4.6" fill="none"/>' +
  '<ellipse cx="70" cy="70" rx="6" ry="4.4" fill="#4a2c14"/><path d="M61 80q4.5 4 9 0q4.5 4 9 0" fill="none"/></g>' +
  '<ellipse cx="42" cy="75" rx="7" ry="4" fill="#ffa0b8" opacity=".85"/><ellipse cx="98" cy="75" rx="7" ry="4" fill="#ffa0b8" opacity=".85"/>' +
  '<path d="M104 30q6 8 0 12q-6-4 0-12z" fill="#8fd4ff" stroke="#4a8ac0" stroke-width="1.6"/></svg>';

function buildCSS(){
  return `
#iuFB{position:absolute;left:0;top:0;right:0;bottom:0;pointer-events:none;overflow:hidden}
#iuFB .fb{position:absolute;left:0;top:0;width:clamp(34px,7vmin,58px);height:clamp(7px,1.35vmin,10px);border-radius:99px;background:#f1e0cf;
  box-shadow:0 0 0 2px #fff,0 2px 4px rgba(74,44,20,.35);overflow:hidden;visibility:hidden;will-change:transform,opacity}
#iuFB .fbc,#iuFB .fbf{position:absolute;left:0;top:0;right:0;bottom:0;border-radius:99px}
#iuFB .fbc{background:#fff08a}
#iuFB .fbf{background:linear-gradient(180deg,#ffc4d4 0%,#ff7aa0 60%,#f25a86 100%)}
#iu{position:absolute;left:0;top:0;right:0;bottom:0;pointer-events:none;font-family:${FONT};color:#4a2c14;font-weight:800;line-height:1.25;
  font-size:clamp(11px,calc(2.1vmin + 3px),19px);letter-spacing:.02em;--r:56px;--b:96px;
  --pl:max(10px,env(safe-area-inset-left,0px));--pr:max(10px,env(safe-area-inset-right,0px));
  --pt:max(8px,env(safe-area-inset-top,0px));--pb:max(8px,env(safe-area-inset-bottom,0px));
  -webkit-user-select:none;user-select:none;-webkit-touch-callout:none;-webkit-text-size-adjust:none;text-size-adjust:none}
#iu *{box-sizing:border-box}
#iu .x{display:none!important}
#iu button{font:inherit;color:inherit;border:0;margin:0;padding:0;background:none;cursor:pointer;pointer-events:auto;touch-action:manipulation;outline:none;-webkit-tap-highlight-color:transparent}
#iu svg{display:block;width:100%;height:100%;fill:currentColor;overflow:visible}
#iu img{-webkit-user-drag:none;user-select:none}

/* ---- candy buttons ---- */
#iu .cb{position:relative;display:inline-flex;align-items:center;justify-content:center;gap:.4em;min-height:2.5em;padding:.4em 1.3em .45em;border-radius:999px;
  font-weight:900;font-size:1.15em;color:#fff;white-space:nowrap;--c1:#ffc9dd;--c2:#ff8fb8;--cd:#d6558a;
  background:linear-gradient(180deg,var(--c1) 0%,var(--c2) 72%);
  box-shadow:0 0 0 .2em #fff,0 .3em 0 .2em var(--cd),0 .55em .9em .15em rgba(74,44,20,.26);
  text-shadow:${ON_CANDY};transition:transform .16s cubic-bezier(.3,1.8,.5,1),filter .15s}
#iu .cb::before{content:'';position:absolute;left:15%;right:15%;top:.18em;height:.62em;border-radius:999px;background:linear-gradient(180deg,rgba(255,255,255,.85),rgba(255,255,255,0));pointer-events:none}
#iu .cb:hover{filter:brightness(1.06)}
#iu .cb.pr{transform:translateY(.22em) scale(1.05,.86);transition-duration:.06s}
#iu .cb.kf{box-shadow:0 0 0 .2em #fff,0 0 0 .44em #ffd24d,0 .34em 0 .44em #e0a020,0 .6em 1em .3em rgba(74,44,20,.26);transform:scale(1.06)}
#iu .cb .ic{width:1.2em;height:1.2em;flex:none;filter:drop-shadow(0 .09em 0 var(--cd))}
#iu .k-pink{--c1:#ffc9dd;--c2:#ff8fb8;--cd:#d6558a}
#iu .k-mint{--c1:#c8f8e0;--c2:#6fdca8;--cd:#2f9e6c}
#iu .k-sky{--c1:#d2ecff;--c2:#6fbcf6;--cd:#2f7fc4}
#iu .k-sun{--c1:#fff2b0;--c2:#ffcc3a;--cd:#cf8f16}
#iu .k-lav{--c1:#eadcff;--c2:#b594f5;--cd:#7a58c4}
#iu .k-cream{--c1:#ffffff;--c2:#ffecc8;--cd:#d8a860;color:#7a4a1e;text-shadow:none}
#iu .k-cream .ic{filter:none}

/* ---- panels & screens ---- */
#iu .scr{position:absolute;left:0;top:0;right:0;bottom:0;z-index:60;display:flex;align-items:center;justify-content:center}
#iu .dim{pointer-events:auto;background:radial-gradient(ellipse at 50% 45%,rgba(255,248,230,.5) 0%,rgba(255,222,236,.72) 68%,rgba(206,230,255,.82) 100%)}
#iu .pn{position:relative;background:linear-gradient(180deg,#fffef8 0%,#fff6e0 100%);border-radius:1.6em;padding:1em 1.5em 1.25em;pointer-events:auto;
  box-shadow:0 0 0 .28em #fff,0 0 0 .52em #ffd4e4,0 .9em 2em rgba(74,44,20,.26);animation:iuIn .42s cubic-bezier(.3,1.5,.5,1) both}
#iu .hd{font-weight:900;font-size:2.2em;line-height:1.12;color:var(--tc,#ff6fa4);text-shadow:${STK};letter-spacing:.05em;white-space:nowrap}
#iu .sub{font-size:1em;color:#8a5a2e;text-align:center}
#iu .col{display:flex;flex-direction:column;align-items:center;gap:.75em}

/* ---- title ---- */
#iu .title{flex-direction:column;justify-content:space-between;align-items:stretch;padding:calc(var(--pt) + .2em) calc(var(--pr) + .5em) calc(var(--pb) + .7em) calc(var(--pl) + .5em)}
#iu .logo{position:relative;align-self:center;text-align:center;animation:iuBob 3.4s ease-in-out infinite;transform-origin:50% 100%}
#iu .lk{position:relative;display:inline-block;color:#fff;text-shadow:${ring(0.07,'#fff',16)},${ring(0.13,'var(--lr)',20)},0 .2em 0 var(--lr),0 .28em .45em rgba(90,30,50,.35);
  animation:iuHop 2.6s ease-in-out infinite;animation-delay:calc(var(--i)*.09s)}
#iu .lk::after{content:attr(data-t);position:absolute;left:0;top:0;text-shadow:none;color:transparent;-webkit-background-clip:text;background-clip:text;background-image:var(--lg)}
#iu .l1{font-size:2.3em;font-weight:900;letter-spacing:.08em;line-height:1.05;--lr:#e8508c;--lg:linear-gradient(180deg,#fff4f8 0%,#ffb3d0 50%,#ff7fb0 100%)}
#iu .l2{font-size:4.6em;font-weight:900;letter-spacing:.02em;line-height:1.1;margin-top:.24em;--lr:#e0662a;--lg:linear-gradient(180deg,#fffbe0 0%,#ffe36a 40%,#ffae3a 100%)}
#iu .rbw{position:relative;display:inline-block}
#iu .rb{position:absolute;left:0;right:0;top:-.36em;text-align:center;font-style:normal;font-size:.21em;line-height:1;letter-spacing:.35em;color:#d0561a;text-shadow:${ring(0.14,'#fff',12)};z-index:1}
#iu .l3{display:inline-block;margin-top:.45em;font-size:1.15em;font-weight:900;padding:.28em 1.3em .32em;border-radius:999px;background:#fff;color:#e0508a;
  box-shadow:0 0 0 .18em #ffc2d8,0 .3em 0 .18em #f09ab8,0 .5em .9em rgba(74,44,20,.2)}
#iu .tw{position:absolute;width:1.4em;height:1.4em;color:#fff6a0;filter:drop-shadow(0 0 .2em #fff);animation:iuTw 2.2s ease-in-out infinite}
#iu .tbot{display:grid;grid-template-columns:1fr auto 1fr;align-items:end;gap:.6em}
#iu .tdiff{justify-self:start;display:flex;flex-direction:column;gap:.3em;align-items:flex-start;pointer-events:auto}
#iu .tlab{font-size:.85em;color:#fff;padding:0 .3em;text-shadow:${ring(0.1,'#c0602a',12)},0 .12em .2em rgba(74,44,20,.4)}
#iu .chips{display:flex;gap:.35em}
#iu .chip{font-size:.95em;min-height:2.2em;padding:.25em .85em .3em;gap:.2em;--c1:#fff;--c2:#fff4e2;color:#8a5a2e;text-shadow:none;opacity:.92}
#iu .chip .pw{display:flex;gap:.02em}
#iu .chip .pw i{display:block;width:.7em;height:.7em}
#iu .chip.sel{--c1:var(--s1);--c2:var(--s2);--cd:var(--s3);color:#fff;text-shadow:${ON_CANDY};transform:scale(1.1);opacity:1}
#iu .chip.k-mint{--s1:#c8f8e0;--s2:#6fdca8;--s3:#2f9e6c;--cd:#9fd8bc}
#iu .chip.k-sky{--s1:#d2ecff;--s2:#6fbcf6;--s3:#2f7fc4;--cd:#9cc8ea}
#iu .chip.k-pink{--s1:#ffc9dd;--s2:#ff8fb8;--s3:#d6558a;--cd:#eeb0c8}
#iu .play{font-size:2.3em;padding:.3em 1.5em .36em;animation:iuPulse 1.5s ease-in-out infinite}
#iu .play .ic{width:1em;height:1em}
#iu .topts{justify-self:end;display:flex;gap:.4em;align-items:flex-end}
#iu .topts .cb{font-size:.95em;min-height:2.3em;padding:.25em .9em .3em}
#iu .thelp{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:min(36em,calc(100% - 2em));max-height:calc(100% - 1em);overflow:auto;z-index:2}
#iu .thelp .hc{display:flex;gap:1.2em;justify-content:center;flex-wrap:wrap;margin:.6em 0 .8em}
#iu .thelp .hb{min-width:13em}
#iu .thelp h4{margin:0 0 .3em;font-size:1em;color:#e0508a}
#iu .thelp .hr_{display:flex;justify-content:space-between;gap:1em;font-size:.9em;padding:.12em 0;border-bottom:.08em dashed #f3d9b8}
#iu .thelp .hr_ b{color:#3a8ad0;font-weight:900}

/* ---- select ---- */
#iu .select{display:block}
#iu .shead{position:absolute;left:calc(var(--pl) + .3em);right:calc(var(--pr) + .3em);top:calc(var(--pt) + .25em);display:flex;align-items:center;gap:.8em}
#iu .shead .hd{font-size:1.8em;--tc:#ff6fa4}
#iu .back{font-size:.95em;min-height:2.2em;padding:.2em .95em .25em}
#iu .back .ic{width:.9em;height:.9em}
#iu .sinfo{position:absolute;right:calc(var(--pr) + .6em);top:calc(var(--pt) + 3.9em);width:min(20em,40vw);padding:.7em 1em .8em;animation-duration:.3s;font-size:1.08em}
#iu .snm{font-size:1.45em;font-weight:900;color:var(--hc,#e0662a);text-shadow:${STK_S};line-height:1.15}
#iu .ssp{font-size:.78em;color:#a07a50;margin:.1em 0 .25em}
#iu .sds{font-size:.92em;line-height:1.4;color:#4a2c14;margin-bottom:.4em}
#iu .srow{display:flex;align-items:center;justify-content:space-between;gap:.6em;font-size:.9em;padding:.06em 0}
#iu .srow .sl{color:#8a5a2e}
#iu .pws{display:flex;gap:.12em}
#iu .pws i{display:block;width:1.3em;height:1.3em;color:#efe0c8}
#iu .pws i.f{color:var(--hc,#ff8fb8);filter:drop-shadow(0 .06em 0 rgba(74,44,20,.25))}
#iu .smv{display:flex;flex-wrap:wrap;gap:.3em;margin-top:.45em}
#iu .smv span{font-size:.78em;padding:.12em .6em;border-radius:999px;background:#fff;box-shadow:0 0 0 .12em #f3d9b8;white-space:nowrap}
#iu .smv b{color:#b06ad0;margin-right:.3em}
#iu .scards{position:absolute;left:calc(var(--pl) + .3em);right:calc(var(--pr) + 12.5em);bottom:calc(var(--pb) + .5em);display:flex;gap:.5em;justify-content:center;align-items:flex-end}
#iu .card{position:relative;flex:0 1 5.4em;min-width:0;display:flex;flex-direction:column;align-items:center;gap:.1em;padding:.35em .2em .3em;border-radius:1.1em;
  background:linear-gradient(180deg,#fffef8,#fff1d8);box-shadow:0 0 0 .18em #fff,0 .25em 0 .18em #e8c89a,0 .45em .7em rgba(74,44,20,.22);
  transition:transform .18s cubic-bezier(.3,1.7,.5,1);animation:iuIn .4s cubic-bezier(.3,1.5,.5,1) both;animation-delay:calc(var(--i)*.04s)}
#iu .card .cp{position:relative;width:4em;height:4em;max-width:100%;border-radius:50%;overflow:hidden;background:radial-gradient(circle at 50% 35%,#fff 0%,var(--hc2,#ffe8c8) 100%);box-shadow:inset 0 0 0 .16em var(--hc,#ffb070)}
#iu .card .cp img{position:absolute;left:-8%;top:-6%;width:116%;height:116%}
#iu .fbk{position:absolute;left:0;top:0;right:0;bottom:0;display:flex;align-items:center;justify-content:center;font-size:1.6em;font-weight:900;color:#fff;background:var(--hc,#ffb070);text-shadow:${ring(0.06,'rgba(74,44,20,.6)',10)}}
#iu .card .fbk{font-size:1.8em}
#iu .roll .eport .fbk{font-size:3em}
#iu .card .cn{font-size:.8em;font-weight:900;white-space:nowrap;color:#6a3f1a}
#iu .card.on{transform:translateY(-.55em) scale(1.14);z-index:2;box-shadow:0 0 0 .2em #fff,0 0 0 .42em #ffd24d,0 .3em 0 .42em #e0a020,0 .7em 1em rgba(74,44,20,.28)}
#iu .card.on::after{content:'';position:absolute;left:50%;top:-1.05em;width:.9em;height:.7em;margin-left:-.45em;background:#ff6fa4;clip-path:polygon(0 0,100% 0,50% 100%);animation:iuHop 1s ease-in-out infinite;--i:0}
#iu .sgo{position:absolute;right:calc(var(--pr) + .7em);bottom:calc(var(--pb) + 1em);font-size:1.45em;animation:iuPulse 1.5s ease-in-out infinite}

/* ---- HUD ---- */
#iu .hud{position:absolute;left:0;top:0;right:0;bottom:0;z-index:20;font-size:1.06em}
#iu .hl{position:absolute;left:var(--pl);top:var(--pt);display:flex;align-items:flex-start;gap:.35em;will-change:transform}
#iu .pf{position:relative;width:4.3em;height:4.3em;flex:none}
#iu .pfr{position:absolute;left:0;top:0;right:0;bottom:0;border-radius:50%;background:conic-gradient(#ffcf3a calc(var(--xp,0)*1turn),rgba(255,255,255,.7) 0);box-shadow:0 .2em .45em rgba(74,44,20,.32)}
#iu .pfi{position:absolute;left:.3em;top:.3em;right:.3em;bottom:.3em;border-radius:50%;overflow:hidden;border:.16em solid #fff;background:radial-gradient(circle at 50% 30%,#fffdf5 0%,var(--hc2,#ffe0b8) 100%)}
#iu .pfi img{position:absolute;left:-10%;top:-6%;width:120%;height:120%}
#iu .lv{position:absolute;left:50%;bottom:-.55em;transform:translateX(-50%);font-size:.82em;font-weight:900;padding:.02em .55em .06em;border-radius:999px;background:linear-gradient(180deg,#fff2a8,#ffcf3a);color:#7a4a10;white-space:nowrap;
  box-shadow:0 0 0 .16em #fff,0 .18em .3em rgba(74,44,20,.32)}
#iu .lv.pop{animation:iuPopX .5s cubic-bezier(.3,1.8,.5,1)}
#iu .bars{display:flex;flex-direction:column;gap:.38em;padding-top:.3em}
#iu .hpw{position:relative;display:flex;align-items:center}
#iu .heart{position:relative;z-index:2;width:1.75em;height:1.75em;margin-right:-.6em;color:#ff6f96;filter:drop-shadow(.1em 0 0 #fff) drop-shadow(-.1em 0 0 #fff) drop-shadow(0 .1em 0 #fff) drop-shadow(0 -.1em 0 #fff) drop-shadow(0 .12em .1em rgba(74,44,20,.35))}
#iu .heart.low{animation:iuBeat .6s ease-in-out infinite}
#iu .hpb{position:relative;width:12em;height:1.45em;border-radius:999px;background:#f1e0cf;overflow:hidden;
  box-shadow:0 0 0 .2em #fff,0 .24em .42em rgba(74,44,20,.32),inset 0 .14em .2em rgba(74,44,20,.18)}
#iu .hpc,#iu .hpf{position:absolute;left:0;top:0;right:0;bottom:0;border-radius:999px}
#iu .hpc{background:#ff9fb4}
#iu .hpf{background:linear-gradient(180deg,#c2f9dc 0%,#66d9a0 58%,#44bf86 100%)}
#iu .hpf.mid{background:linear-gradient(180deg,#fff3a8 0%,#ffcf3a 58%,#f0ac1c 100%)}
#iu .hpf.low{background:linear-gradient(180deg,#ffc8d6 0%,#ff7096 58%,#ee4f7a 100%);animation:iuBlink .7s ease-in-out infinite}
#iu .hpgl{position:absolute;left:.5em;right:.5em;top:.14em;height:.32em;border-radius:999px;background:rgba(255,255,255,.6)}
#iu .hpn{position:absolute;right:.55em;top:0;bottom:0;display:flex;align-items:center;font-size:.86em;font-weight:900;color:#fff;text-shadow:${ON_BAR}}
#iu .hpw.heal .hpb{box-shadow:0 0 0 .2em #fff,0 0 .6em .25em #9dffb8,0 .24em .42em rgba(74,44,20,.32)}
#iu .r2{display:flex;align-items:center;gap:.4em;padding-left:.95em}
#iu .pips{display:flex;gap:.08em}
#iu .pip{position:relative;width:1.6em;height:1.6em}
#iu .pip i{position:absolute;display:block}
#iu .pip .pb{left:0;top:0;right:0;bottom:0;color:#fff;filter:drop-shadow(0 .1em .1em rgba(74,44,20,.4))}
#iu .pip .pe{left:.2em;top:.2em;right:.2em;bottom:.2em;color:#e2d2bc}
#iu .pip .pfl{left:.2em;top:.2em;right:.2em;bottom:.2em;color:#ffc21a;clip-path:inset(calc((1 - var(--f,0))*100%) 0 0 0)}
#iu .pip.full .pfl{color:#ffae00}
#iu .pip.full{animation:iuTwk 1.8s ease-in-out infinite;animation-delay:calc(var(--i)*.2s)}
#iu .ug{position:relative;width:6.6em;height:1.3em;border-radius:999px;background:#ece0f4;box-shadow:0 0 0 .18em #fff,0 .2em .34em rgba(74,44,20,.3)}
#iu .ugf{position:absolute;left:0;top:0;right:0;bottom:0;border-radius:999px;background:linear-gradient(90deg,#ff9ad0,#c89bff 55%,#7fc8ff)}
#iu .ugl{position:absolute;left:0;right:0;top:50%;transform:translateY(-50%);text-align:center;font-size:.8em;font-weight:900;color:#fff;text-shadow:${ring(0.1,'#8a5ac0',12)};white-space:nowrap}
#iu .ugg{position:absolute;left:-.5em;top:-.5em;right:-.5em;bottom:-.5em;border-radius:999px;opacity:0;background:radial-gradient(ellipse at 50% 50%,rgba(255,240,140,.95) 0%,rgba(255,170,220,.6) 45%,rgba(255,255,255,0) 72%);pointer-events:none}
#iu .ug.full{animation:iuPulse .8s ease-in-out infinite}
#iu .ug.full .ugg{animation:iuGlow .8s ease-in-out infinite}
#iu .ug.full .ugf{background:linear-gradient(90deg,#ff8fb8,#ffd24d,#7fe0b0,#7fc8ff,#c89bff)}
#iu .hr{position:absolute;right:var(--pr);top:var(--pt);display:flex;align-items:center;gap:.55em}
#iu .coins{display:flex;align-items:center;gap:.3em;padding:.12em .8em .12em .22em;border-radius:999px;background:rgba(255,255,255,.93);font-size:1.15em;font-weight:900;color:#9a6410;
  box-shadow:0 0 0 .16em #ffe08a,0 .22em .4em rgba(74,44,20,.28);will-change:transform}
#iu .coin{width:1.45em;height:1.45em;border-radius:50%;flex:none;display:flex;align-items:center;justify-content:center;color:#d8920e;
  background:radial-gradient(circle at 38% 32%,#fff8c0 0%,#ffd63a 45%,#eaa21a 100%);box-shadow:inset 0 0 0 .12em #f7c02a,0 .08em 0 #b8780c}
#iu .coin svg{width:62%;height:62%}
#iu .pz{width:2.75em;height:2.75em;min-height:0;padding:0;border-radius:50%;font-size:1em}
#iu .pz .ic{width:1.15em;height:1.15em}
#iu .combo{position:absolute;right:calc(var(--pr) + .5em);top:calc(var(--pt) + 4.1em);text-align:right;transform-origin:100% 60%;opacity:0;will-change:transform,opacity}
#iu .cn{display:inline-block;font-size:3.5em;font-weight:900;line-height:1;color:var(--rc,#ffd24d);letter-spacing:-.02em;
  text-shadow:${ring(0.035,'#6a3a14',10)},${ring(0.1,'#fff',18)},${ring(0.06,'#fff',12)},0 .14em .05em rgba(74,44,20,.4),0 .2em .4em rgba(74,44,20,.25)}
#iu .cl{display:inline-block;margin-left:.2em;font-size:1.05em;font-weight:900;color:#fff;text-shadow:${ring(0.1,'#e0508a',12)},0 .1em .2em rgba(74,44,20,.4)}
#iu .cr{display:block;margin-top:.1em;font-size:1.35em;font-weight:900;color:var(--rc,#ffd24d);transform:rotate(-5deg);transform-origin:100% 50%;
  text-shadow:${ring(0.04,'#6a3a14',10)},${ring(0.11,'#fff',16)},0 .13em .25em rgba(74,44,20,.35)}
#iu .boss{position:absolute;left:50%;top:var(--pt);z-index:20;width:clamp(12em,calc(100% - 2*(var(--pl) + 19.5em)),30em);transform:translateX(-50%);text-align:center}
#iu .boss.in{animation:iuDrop .5s cubic-bezier(.3,1.6,.5,1)}
#iu .bnm{display:inline-flex;align-items:center;gap:.35em;font-size:1.05em;font-weight:900;color:#8a3aa8;text-shadow:${STK_S};white-space:nowrap;max-width:100%}
#iu .bnm .cr_{width:1.3em;height:1.3em;color:#ffcf3a;filter:drop-shadow(0 .08em 0 #c07e10)}
#iu .btl{font-size:.72em;color:#b06aa8}
#iu .bb{position:relative;height:1.3em;margin-top:.15em;border-radius:999px;background:#ecdcf0;overflow:hidden;box-shadow:0 0 0 .2em #fff,0 .24em .42em rgba(74,44,20,.32),inset 0 .14em .2em rgba(74,44,20,.15)}
#iu .bbc,#iu .bbf{position:absolute;left:0;top:0;right:0;bottom:0;border-radius:999px}
#iu .bbc{background:#fff08a}
#iu .bbf{background:linear-gradient(180deg,#f0d0ff 0%,#bd84f2 58%,#9a5ee0 100%)}
#iu .bb .hpgl{top:.15em}

/* ---- banner / go / hint ---- */
#iu .ban{position:absolute;left:0;right:0;top:36%;z-index:45;text-align:center;visibility:hidden;will-change:transform,opacity;white-space:nowrap}
#iu .bt{display:inline-block;font-weight:900;line-height:1.15;letter-spacing:.03em}
#iu .bt span{position:relative;display:inline-block;color:var(--g2);text-shadow:${ring(0.045,'var(--gr)',12)},${ring(0.11,'#fff',20)},${ring(0.07,'#fff',14)},0 .17em .04em rgba(74,44,20,.35),0 .25em .5em rgba(74,44,20,.25);
  animation:iuHop .9s ease-in-out infinite;animation-delay:calc(var(--i)*.07s)}
#iu .bt span::after{content:attr(data-t);position:absolute;left:0;top:0;text-shadow:none;color:transparent;-webkit-background-clip:text;background-clip:text;background-image:linear-gradient(180deg,#ffffff 0%,var(--g1) 40%,var(--g2) 100%)}
#iu .bt span.sp{width:.3em}
#iu .bs{display:inline-block;margin-top:.35em;font-weight:900;padding:.22em 1.2em .26em;border-radius:999px;background:#fff;color:var(--gr);box-shadow:0 0 0 .16em var(--g1),0 .26em 0 .16em var(--gr),0 .45em .8em rgba(74,44,20,.22)}
#iu .ban.v-stage{--g1:#bfe4ff;--g2:#5fb4f4;--gr:#2f78c0}
#iu .ban.v-go{--g1:#c8f8e0;--g2:#4fd494;--gr:#248a5a}
#iu .ban.v-boss{--g1:#f0d0ff;--g2:#b77cf0;--gr:#7a3ab0}
#iu .ban.v-clear{--g1:#fff2a0;--g2:#ffb42a;--gr:#c86a10}
#iu .ban.v-cheer{--g1:#ffd6e6;--g2:#ff7aa8;--gr:#c83a70}
#iu .goa{position:absolute;right:calc(var(--pr) + .3em);top:40%;z-index:21;display:flex;align-items:center;gap:.05em;font-size:2.5em;font-weight:900;color:#4fd494;
  text-shadow:${ring(0.045,'#248a5a',12)},${ring(0.1,'#fff',18)},0 .14em .3em rgba(74,44,20,.35);animation:iuGo .9s ease-in-out infinite}
#iu .goa .ar{width:1.35em;height:1.35em;filter:drop-shadow(0 .06em 0 #248a5a) drop-shadow(0 .12em .2em rgba(74,44,20,.35))}
#iu .hint{position:absolute;left:50%;bottom:calc(var(--pb) + .5em);z-index:32;width:min(36em,calc(100% - var(--pl) - var(--pr) - 2em));transform:translateX(-50%);
  display:flex;align-items:flex-start;gap:.7em;padding:.55em 1em .65em .6em;border-radius:1.2em;background:#fff;visibility:hidden;will-change:opacity,transform;
  box-shadow:0 0 0 .22em var(--avr,#ffd24d),0 .3em 0 .22em var(--avd,#e0a020),0 .6em 1.1em rgba(74,44,20,.28)}
#iu .hb_{flex:1;min-width:0}
#iu .hn{display:inline-block;font-size:.8em;font-weight:900;padding:.02em .75em .06em;border-radius:999px;background:var(--avr,#ffd24d);color:#fff;text-shadow:${ring(0.08,'var(--avd,#c07e10)',10)};margin-bottom:.2em}
#iu .ht{font-size:1em;line-height:1.45;color:#4a2c14;min-height:1.45em;word-break:normal;overflow-wrap:anywhere}
#iu .av{position:relative;width:3.3em;height:3.3em;flex:none;border-radius:50%;background:var(--avc,#fff3d6);margin:.15em 0 0 .1em;
  box-shadow:0 0 0 .16em #fff,0 0 0 .3em var(--avr,#ffd24d),0 .25em .4em rgba(74,44,20,.3)}
#iu .av i{position:absolute;display:block}
#iu .av .e{top:40%;width:.36em;height:.46em;border-radius:50%;background:radial-gradient(circle at 35% 30%,#fff 0 20%,#2a1a10 24%)}
#iu .av .e.l{left:29%}#iu .av .e.r{right:29%}
#iu .av .bl{top:60%;width:.6em;height:.32em;border-radius:50%;background:#ffa0b8;opacity:.85}
#iu .av .bl.l{left:12%}#iu .av .bl.r{right:12%}
#iu .av .mo{left:50%;top:58%;width:.5em;height:.3em;margin-left:-.25em;border:.1em solid #2a1a10;border-top:0;border-radius:0 0 .3em .3em}
#iu .av.mofu{--avc:#f4ecdc;--avr:#b8d86a;--avd:#6f9a2a}
#iu .av.mofu::before{content:'';position:absolute;left:16%;right:16%;top:24%;height:.42em;background:radial-gradient(ellipse at 25% 60%,#fff 0 45%,transparent 50%),radial-gradient(ellipse at 75% 60%,#fff 0 45%,transparent 50%)}
#iu .av.mofu::after{content:'';position:absolute;left:20%;right:20%;bottom:-6%;height:44%;border-radius:45% 45% 50% 50%;background:#fff;box-shadow:0 0 0 .07em #e2d6c0}
#iu .av.cham{--avc:#ffbd72;--avr:#ff9a3a;--avd:#c0600c}
#iu .av.cham::before,#iu .av.cham::after{content:'';position:absolute;top:-.3em;width:1.05em;height:1.1em;background:#ffbd72;clip-path:polygon(50% 0,100% 100%,0 100%)}
#iu .av.cham::before{left:.05em;transform:rotate(-14deg)}#iu .av.cham::after{right:.05em;transform:rotate(14deg)}
#iu .av.pero{--avc:#fff6f9;--avr:#ff8fb8;--avd:#c8487e}
#iu .av.pero::before{content:'';position:absolute;left:50%;top:-.5em;width:1.4em;height:.8em;margin-left:-.7em;background:linear-gradient(180deg,#fff2a0,#ffc21a);clip-path:polygon(0 100%,0 20%,25% 60%,50% 0,75% 60%,100% 20%,100% 100%)}
#iu .av.pero::after{content:'';position:absolute;right:-.15em;top:.1em;width:1em;height:.75em;background:#ff7ab8;clip-path:polygon(0 0,50% 40%,100% 0,100% 100%,50% 60%,0 100%)}
#iu .av.kuro{--avc:#4a4058;--avr:#b77cf0;--avd:#6a3aa0}
#iu .av.kuro .e{background:radial-gradient(circle at 35% 30%,#fff 0 22%,#ffd24d 26%)}

/* ---- touch controls ---- */
#iu .tc{position:absolute;left:0;top:0;right:0;bottom:0;z-index:30}
#iu .tz{position:absolute;left:0;top:0;bottom:0;width:45%;pointer-events:auto;touch-action:none}
#iu .stk{position:absolute;left:0;top:0;width:calc(var(--r)*2);height:calc(var(--r)*2);margin:calc(var(--r)*-1) 0 0 calc(var(--r)*-1);border-radius:50%;pointer-events:none;opacity:0;will-change:transform;
  background:radial-gradient(circle,rgba(255,255,255,.12) 0%,rgba(255,255,255,.28) 64%,rgba(255,255,255,.55) 100%);box-shadow:0 0 0 .22em rgba(255,255,255,.9),0 .3em .8em rgba(74,44,20,.22)}
#iu .stk.on{opacity:1}
#iu .stk.ghost{opacity:.62}
#iu .stk .ga{position:absolute;width:22%;height:22%;color:rgba(255,255,255,.95);filter:drop-shadow(0 .06em .08em rgba(74,44,20,.4))}
#iu .knob{position:absolute;left:50%;top:50%;width:calc(var(--r)*.98);height:calc(var(--r)*.98);margin:calc(var(--r)*-.49) 0 0 calc(var(--r)*-.49);border-radius:50%;will-change:transform;
  background:radial-gradient(circle at 36% 30%,#ffffff 0%,#ffe2ee 38%,#ff9fc4 100%);box-shadow:0 0 0 .2em #fff,0 .28em .5em rgba(74,44,20,.35)}
#iu .knob::after{content:'';position:absolute;left:22%;top:14%;width:36%;height:22%;border-radius:50%;background:rgba(255,255,255,.85)}
#iu .tb{position:absolute;border-radius:50%;pointer-events:auto;touch-action:none;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#fff;
  background:radial-gradient(circle at 36% 28%,var(--c1,#ffd0e2) 0%,var(--c2,#ff8fb8) 60%,var(--cd,#d6558a) 115%);opacity:.93;
  box-shadow:0 0 0 .2em rgba(255,255,255,.95),0 .3em 0 .2em var(--cd),0 .5em 1em rgba(74,44,20,.3);transition:transform .07s ease-out,opacity .2s}
#iu .tb .ti{width:44%;height:44%;margin-top:-.15em;filter:drop-shadow(0 .08em 0 var(--cd))}
#iu .tb .tl{font-weight:900;line-height:1;margin-top:.12em;white-space:nowrap;text-shadow:${ON_CANDY}}
#iu .tb.on{transform:translateY(.16em) scale(.9,.84);filter:brightness(1.12)}
#iu .tb.dim{opacity:.5;filter:saturate(.35) brightness(1.05)}
#iu .tb .bdg{position:absolute;right:-.3em;top:-.35em;display:flex;align-items:center;gap:.05em;padding:.08em .4em .1em .25em;border-radius:999px;background:#fff;color:#8a5ad8;font-size:.95em;font-weight:900;
  box-shadow:0 0 0 .12em #b594f5,0 .12em .2em rgba(74,44,20,.3)}
#iu .tb .bdg i{display:block;width:.9em;height:.9em}
#iu .tb.ult::before{content:'';position:absolute;left:-.42em;top:-.42em;right:-.42em;bottom:-.42em;border-radius:50%;pointer-events:none;
  background:conic-gradient(#ffcf3a calc(var(--u,0)*1turn),rgba(255,255,255,.45) 0);-webkit-mask:radial-gradient(circle,transparent 63%,#000 64.5%);mask:radial-gradient(circle,transparent 63%,#000 64.5%)}
#iu .tb.ult.ready{opacity:1;filter:none;animation:iuPulse .75s ease-in-out infinite}
#iu .tb.ult.ready::before{background:conic-gradient(#ff8fb8,#ffd24d,#7fe0b0,#7fc8ff,#c89bff,#ff8fb8);animation:iuSpin 1.6s linear infinite}
#iu .tb.ult .glo{position:absolute;left:-.9em;top:-.9em;right:-.9em;bottom:-.9em;border-radius:50%;opacity:0;pointer-events:none;background:radial-gradient(circle,rgba(255,240,150,.9) 0%,rgba(255,190,230,.5) 45%,rgba(255,255,255,0) 70%)}
#iu .tb.ult.ready .glo{animation:iuGlow .75s ease-in-out infinite}
#iu .tb.on.ult.ready{animation:none}

/* ---- pause / result / over / ending / loading ---- */
#iu .pause .pn{min-width:min(22em,90%)}
#iu .pgrid{display:grid;grid-template-columns:1fr 1fr;gap:.9em 1em;margin-top:.9em;width:100%}
#iu .pgrid .cb{font-size:1.05em}
#iu .pgrid .big{grid-column:1 / -1;font-size:1.45em}
#iu .result .pn{display:flex;gap:1.4em;align-items:center;max-width:calc(100% - 2em)}
#iu .rleft{display:flex;flex-direction:column;align-items:center;gap:.3em}
#iu .rright{display:flex;flex-direction:column;align-items:stretch;gap:.45em;min-width:12em}
#iu .rsn{font-size:1em;color:#8a5a2e;background:#fff;padding:.12em .9em;border-radius:999px;box-shadow:0 0 0 .12em #f3d9b8;white-space:nowrap}
#iu .stars{display:flex;gap:.2em;align-items:flex-end;margin:.3em 0 .1em}
#iu .stars i{display:block;width:3.4em;height:3.4em;color:#eadfce;filter:drop-shadow(0 .14em 0 rgba(74,44,20,.18))}
#iu .stars i:nth-child(2){width:4.2em;height:4.2em;margin-bottom:.35em}
#iu .stars i.f{color:#ffcf3a;filter:drop-shadow(0 0 .15em #fff) drop-shadow(0 .14em 0 #d0901a)}
#iu .stars.go i{animation:iuPop .55s cubic-bezier(.3,1.7,.5,1) both}
#iu .stars.go i:nth-child(1){animation-delay:.25s}#iu .stars.go i:nth-child(2){animation-delay:.5s}#iu .stars.go i:nth-child(3){animation-delay:.75s}
#iu .rword{font-size:1.4em;font-weight:900;color:#ff6fa4;text-shadow:${STK_S}}
#iu .rrow{display:flex;justify-content:space-between;align-items:center;gap:1.2em;padding:.3em .9em;border-radius:999px;background:#fff;box-shadow:0 0 0 .12em #f6e0c0;font-size:1.05em}
#iu .rrow .rl{color:#8a5a2e;display:flex;align-items:center;gap:.35em}
#iu .rrow .rl i{display:block;width:1.2em;height:1.2em}
#iu .rrow .rv{font-size:1.2em;font-weight:900;color:#e0662a}
#iu .cham{display:flex;align-items:center;gap:.5em;margin-top:.1em}
#iu .cham .av{width:2.6em;height:2.6em;font-size:.95em}
#iu .cham .bub{position:relative;font-size:.85em;padding:.35em .8em;border-radius:1em;background:#fff4e8;box-shadow:0 0 0 .12em #ffbd72;color:#8a4a10}
#iu .rright .cb{margin-top:.35em;font-size:1.35em}
#iu .over{background:radial-gradient(ellipse at 50% 40%,rgba(255,246,250,.72) 0%,rgba(236,220,255,.85) 70%,rgba(214,232,255,.92) 100%);pointer-events:auto}
#iu .over .pup{position:relative;width:9em;height:7em;animation:iuSway 2.4s ease-in-out infinite}
#iu .over .orb{position:absolute;left:50%;top:18%;width:7em;height:2.2em;margin-left:-3.5em;animation:iuSpin 2.4s linear infinite;transform-origin:50% 50%}
#iu .over .orb i{position:absolute;display:block;width:1em;height:1em;color:#ffd24d;filter:drop-shadow(0 .08em 0 #c89020)}
#iu .over .orb i:nth-child(1){left:0;top:.6em}#iu .over .orb i:nth-child(2){right:0;top:.6em}#iu .over .orb i:nth-child(3){left:3em;top:-.2em}
#iu .over .hd{--tc:#9a7ae0}
#iu .obtn{display:flex;gap:1em;flex-wrap:wrap;justify-content:center;margin-top:.4em}
#iu .obtn .cb{font-size:1.3em}
#iu .ending{display:block;overflow:hidden;pointer-events:auto;background:linear-gradient(180deg,rgba(255,248,232,.7) 0%,rgba(255,248,232,0) 22%,rgba(255,248,232,0) 70%,rgba(255,236,246,.75) 100%)}
#iu .roll{position:absolute;left:0;right:0;top:0;display:flex;flex-direction:column;align-items:center;gap:1.4em;padding:0 1.2em;text-align:center;will-change:transform}
#iu .roll .ln{font-size:1.3em;font-weight:900;color:#6a3f1a;line-height:1.5;max-width:30em;text-shadow:${STK_S}}
#iu .roll .qt{font-size:1.9em;font-weight:900;color:#ff6fa4;line-height:1.4;text-shadow:${STK}}
#iu .roll .who{display:block;font-size:.55em;color:#c8487e}
#iu .roll .th{font-size:1.5em;font-weight:900;color:#3a8ad0;text-shadow:${STK_S}}
#iu .roll .eh{font-size:2.3em;font-weight:900;color:#ffb42a;text-shadow:${STK};line-height:1.6}
#iu .roll .eh rt{font-size:.3em;color:#e0662a;letter-spacing:.2em}
#iu .roll .fin{font-size:2.1em;font-weight:900;color:#ff6fa4;text-shadow:${STK};line-height:1.35;padding:1em 0 2em}
#iu .roll .eport{width:7em;height:7em;border-radius:50%;overflow:hidden;position:relative;background:radial-gradient(circle at 50% 30%,#fff,#ffe6c0);box-shadow:0 0 0 .3em #fff,0 0 0 .55em #ffd24d,0 .6em 1em rgba(74,44,20,.25)}
#iu .roll .eport img{position:absolute;left:-10%;top:-6%;width:120%;height:120%}
#iu .roll .team{display:flex;flex-wrap:wrap;gap:.8em 1.1em;justify-content:center;max-width:34em}
#iu .roll .mate{display:flex;flex-direction:column;align-items:center;gap:.2em;font-size:.9em;font-weight:900;color:#6a3f1a;text-shadow:${STK_S}}
#iu .roll .mate .mp{width:3.6em;height:3.6em;border-radius:50%;overflow:hidden;position:relative;background:var(--hc,#ffd24d);box-shadow:0 0 0 .2em #fff,0 .25em .45em rgba(74,44,20,.25)}
#iu .roll .mate .mp img{position:absolute;left:-10%;top:-6%;width:120%;height:120%}
#iu .roll .mate .mp .fbk{font-size:1.5em}
#iu .eskip{position:absolute;right:calc(var(--pr) + .5em);top:calc(var(--pt) + .4em);font-size:.9em;min-height:2.1em;padding:.2em .9em}
#iu .etitle{position:absolute;left:50%;bottom:calc(var(--pb) + 1.2em);transform:translateX(-50%);font-size:1.5em}
#iu .etitle.show{animation:iuIn .5s cubic-bezier(.3,1.6,.5,1) both}
#iu .loading{z-index:70;pointer-events:auto;flex-direction:column;gap:1em;background:radial-gradient(circle at 50% 42%,#fff8e4 0%,#ffe2c4 55%,#ffc9dc 100%)}
#iu .lpaws{display:flex;gap:.8em}
#iu .lpaws i{display:block;width:2.4em;height:2.4em;color:#ff8fb8;animation:iuHop .9s ease-in-out infinite;animation-delay:calc(var(--i)*.15s);filter:drop-shadow(0 .12em 0 #d6558a)}
#iu .lpaws i:nth-child(2){color:#7fc8ff;filter:drop-shadow(0 .12em 0 #2f7fc4)}#iu .lpaws i:nth-child(3){color:#7fe0b0;filter:drop-shadow(0 .12em 0 #2f9e6c)}

/* ---- layout variants ---- */
#iu.tcon .goa{top:calc(var(--pt) + 4.4em)}
#iu.tcon .hint{left:calc(var(--pl) + var(--r)*2.7 + .4em);right:calc(var(--pr) + var(--b)*2.2);width:auto;transform:none}
#iu.port .hpb{width:10em}
#iu.port .ug{width:5.4em}
#iu.port .boss{top:calc(var(--pt) + 5.6em);width:calc(100% - var(--pl) - var(--pr) - 1.5em)}
#iu.port .combo{top:calc(var(--pt) + 9.2em)}
#iu.port .goa{top:44%}
#iu.port.tcon .hint{left:50%;right:auto;width:calc(100% - var(--pl) - var(--pr) - 1.4em);transform:translateX(-50%);bottom:calc(var(--pb) + var(--b)*2.62)}
#iu.port .l1{font-size:min(2.3em,8vw)}
#iu.port .l2{font-size:min(4.6em,13.5vw)}
#iu.port .tbot{grid-template-columns:1fr 1fr;grid-template-areas:"p p" "d o";row-gap:.9em}
#iu.port .tbot .play{grid-area:p;justify-self:center}
#iu.port .tbot .tdiff{grid-area:d}
#iu.port .tbot .topts{grid-area:o;flex-direction:column;align-items:flex-end}
#iu.port .shead .hd{font-size:1.5em}
#iu.port .sinfo{left:calc(var(--pl) + .6em);right:calc(var(--pr) + .6em);width:auto;top:auto;bottom:calc(var(--pb) + 11em)}
#iu.port .scards{right:calc(var(--pr) + .3em);gap:.3em}
#iu.port .card{flex-basis:4.6em}
#iu.port .card .cp{width:3.3em;height:3.3em}
#iu.port .sgo{right:50%;transform:translateX(50%);bottom:calc(var(--pb) + 5em);animation:none}
#iu.port .result .pn,#iu.short .result .pn{flex-direction:column;gap:.5em}
#iu.short .result .pn{flex-direction:row;gap:1.2em}
#iu.short .pn{padding:.7em 1.2em .9em}
#iu.short .pause .hd,#iu.short .over .hd{font-size:1.8em}
#iu.short .pgrid{gap:.7em .8em;margin-top:.6em}
#iu.short .over .pup{width:7em;height:5.4em}
#iu.short .stars i{width:2.8em;height:2.8em}
#iu.short .stars i:nth-child(2){width:3.4em;height:3.4em}

@keyframes iuBob{0%,100%{transform:translateY(0) rotate(-.6deg)}50%{transform:translateY(-.14em) rotate(.6deg)}}
@keyframes iuHop{0%,55%,100%{transform:translateY(0)}25%{transform:translateY(-.14em) scale(1.03,.97)}}
@keyframes iuPulse{0%,100%{transform:scale(1)}50%{transform:scale(1.06)}}
@keyframes iuBlink{0%,100%{opacity:1}50%{opacity:.6}}
@keyframes iuBeat{0%,100%{transform:scale(1)}30%{transform:scale(1.2)}60%{transform:scale(.95)}}
@keyframes iuGlow{0%,100%{opacity:.35;transform:scale(.94)}50%{opacity:1;transform:scale(1.08)}}
@keyframes iuTw{0%,100%{opacity:.25;transform:scale(.55) rotate(0)}50%{opacity:1;transform:scale(1) rotate(25deg)}}
@keyframes iuTwk{0%,80%,100%{transform:scale(1) rotate(0)}88%{transform:scale(1.2) rotate(12deg)}}
@keyframes iuSpin{to{transform:rotate(1turn)}}
@keyframes iuPop{0%{transform:scale(0) rotate(-40deg);opacity:0}65%{transform:scale(1.3) rotate(10deg);opacity:1}100%{transform:scale(1) rotate(0);opacity:1}}
@keyframes iuPopX{0%{transform:translateX(-50%) scale(1)}40%{transform:translateX(-50%) scale(1.5)}100%{transform:translateX(-50%) scale(1)}}
@keyframes iuIn{0%{transform:scale(.55) translateY(.8em);opacity:0}65%{transform:scale(1.05);opacity:1}100%{transform:scale(1);opacity:1}}
@keyframes iuDrop{0%{transform:translate(-50%,-1.5em) scale(.8);opacity:0}100%{transform:translate(-50%,0) scale(1);opacity:1}}
@keyframes iuGo{0%,100%{transform:translateX(0);opacity:1}50%{transform:translateX(.3em);opacity:.45}}
@keyframes iuSway{0%,100%{transform:rotate(-5deg)}50%{transform:rotate(5deg)}}
@media (prefers-reduced-motion: reduce){
  #iu *,#iu *::before,#iu *::after{animation:none!important;transition:none!important}
  #iu .goa{opacity:1}
}
`;
}

// ================================================================ small helpers
function el(tag, cls, parent, html){ const e = document.createElement(tag); if(cls) e.className = cls; if(html!=null) e.innerHTML = html; if(parent) parent.appendChild(e); return e; }
function txt(e, s){ s = String(s); if(e._t!==s){ e._t = s; e.textContent = s; } }
function show(e, on){ const hid = !on; if(e._hid!==hid){ e._hid = hid; e.classList.toggle('x', hid); } }
function setVar(e, k, v, eps){ const o = e['_v'+k]; if(o==null || Math.abs(o-v) > (eps||0.001)){ e['_v'+k] = v; e.style.setProperty(k, String(+v.toFixed(4))); } }
function clipR(e, f){ f = U.clamp(f,0,1); if(e._clip==null || Math.abs(e._clip-f) > 0.0005){ e._clip = f; e.style.clipPath = 'inset(0 '+((1-f)*100).toFixed(2)+'% 0 0 round 999px)'; } }
function sfx(n){ if(G.audio && G.audio.sfx){ try { G.audio.sfx(n); } catch(_){} } }
function call(fn){ if(typeof fn==='function'){ const a = Array.prototype.slice.call(arguments, 1); try { return fn.apply(null, a); } catch(err){ G.logError('ui callback', err); } } return undefined; }
function heroList(){ return (G.heroes && G.heroes.list) || []; }
function heroMeta(id){ const g = G.heroes && G.heroes.get ? G.heroes.get(id) : null; if(g) return g; for(const h of heroList()) if(h.id===id) return h; return { id, name:String(id||'?'), short:String(id||'?'), color:'#ffb070' }; }
function lighten(hex, k){
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex||'')); if(!m) return '#ffe8c8';
  const n = parseInt(m[1],16); let r=(n>>16)&255, g=(n>>8)&255, b=n&255;
  r = Math.round(r+(255-r)*k); g = Math.round(g+(255-g)*k); b = Math.round(b+(255-b)*k);
  return '#'+((1<<24)|(r<<16)|(g<<8)|b).toString(16).slice(1);
}
function initialOf(h){ const s = String(h.short || h.name || h.id || '?'); return Array.from(s)[0] || '?'; }
function soundState(v){ return v!=null ? v!==false : !(G.audio && G.audio.muted); }
function fmtTime(sec){ sec = Math.max(0, Math.round(sec||0)); const m = Math.floor(sec/60), s = sec%60; return (m ? m+'ふん ' : '') + s + 'びょう'; }

// ---- portraits (G.heroes.portrait → PNG dataURL). Generated lazily, one per frame, so a phone never hitches.
const PSIZE = 160;
const pUrl = {};            // key id|expr → url | null (failed)
const pWait = [];           // { key, id, expr, fns:[] }
function portraitKey(id, expr){ return id+'|'+(expr||'normal'); }
function wantPortrait(id, expr, fn){
  if(!(G.heroes && typeof G.heroes.portrait==='function')){ fn(null); return; }
  const key = portraitKey(id, expr);
  if(key in pUrl){ fn(pUrl[key]); return; }
  for(const w of pWait) if(w.key===key){ w.fns.push(fn); return; }
  pWait.push({ key, id, expr:expr||'normal', fns:[fn] });
}
function portraitStep(){
  const w = pWait.shift(); if(!w) return;
  let url = null;
  try { url = G.heroes.portrait(w.id, { size:PSIZE, expr:w.expr }) || null; } catch(err){ G.logError('ui portrait '+w.id, err); }
  pUrl[w.key] = url;
  for(const f of w.fns){ try { f(url); } catch(err){ G.logError('ui portrait cb', err); } }
}
// fill a round frame: portrait image, or a coloured circle with the hero's initial
function fillPortrait(host, h, expr){
  host.style.setProperty('--hc', h.color || '#ffb070'); host.style.setProperty('--hc2', lighten(h.color, 0.7));
  if(host._pid===h.id+'|'+(expr||'')) return;
  host._pid = h.id+'|'+(expr||'');
  host.innerHTML = '';
  const fb = el('div', 'fbk', host); fb.textContent = initialOf(h);
  const want = host._pid;
  wantPortrait(h.id, expr, (url)=>{
    if(host._pid!==want || !url) return;
    host.innerHTML = '';
    const img = el('img', '', host); img.alt = ''; img.draggable = false; img.src = url;
  });
}
// HUD portrait swaps expressions often: keep one <img> and just change src
function setPortraitSrc(img, fb, id, expr){
  const key = portraitKey(id, expr);
  if(img._key===key) return;
  img._key = key;
  wantPortrait(id, expr, (url)=>{
    if(img._key!==key) return;
    if(url){ if(img.src!==url) img.src = url; img.style.display = ''; fb.style.display = 'none'; }
    else if(expr && expr!=='normal'){ img._key = null; setPortraitSrc(img, fb, id, 'normal'); }
    else { img.style.display = 'none'; fb.style.display = ''; }
  });
}

// ================================================================ state
let ready = false, root = null, fbLayer = null, host = null;
let reduced = false, kbMode = false, emPx = 14;
const S = {};                // screens by name: { el, on, data, nav:[], ni, key(e,code), frame(dt), open(data), close() }
const ORDER = ['loading','pause','over','result','ending','select','title'];   // key focus priority (top first)

function button(parent, cls, html, onTap, sound){
  const b = el('button', 'cb '+cls, parent, html);
  b.type = 'button'; b.tabIndex = -1;
  b.addEventListener('pointerdown', ()=>{ b.classList.add('pr'); });
  const up = ()=> b.classList.remove('pr');
  b.addEventListener('pointerup', up); b.addEventListener('pointerleave', up); b.addEventListener('pointercancel', up);
  b.addEventListener('click', (e)=>{ e.preventDefault(); b.blur(); if(sound!==false) sfx(sound||'select'); if(onTap) onTap(e); });
  return b;
}
function pressFx(b){ b.classList.add('pr'); setTimeout(()=> b.classList.remove('pr'), 110); }
function paintKF(s){ if(!s.nav) return; s.nav.forEach((b, i)=> b.classList.toggle('kf', kbMode && i===s.ni)); }
function clearKF(){ for(const n in S){ const s = S[n]; if(s.nav) for(const b of s.nav) b.classList.remove('kf'); } }
function navKey(s, c, e){
  const list = (s.nav||[]).filter(b=> !b.classList.contains('x') && b.offsetParent!==null);
  if(!list.length) return false;
  let i = Math.max(0, list.indexOf(s.nav[s.ni]));
  if(c==='ArrowDown'||c==='ArrowRight'||c==='KeyS'||c==='KeyD') i = (i+1)%list.length;
  else if(c==='ArrowUp'||c==='ArrowLeft'||c==='KeyW'||c==='KeyA') i = (i+list.length-1)%list.length;
  else if(c==='Enter'||c==='NumpadEnter'||c==='Space'){ if(!e.repeat){ const b = list[i]; pressFx(b); b.click(); } return true; }
  else return false;
  s.ni = s.nav.indexOf(list[i]); paintKF(s); sfx('select');
  return true;
}
function screen(name, cls, build){
  const s = S[name] = { name, el: el('div', 'scr '+cls+' x', root), on:false, data:{}, nav:[], ni:0 };
  build(s);
  return s;
}
function openScreen(name, data){
  const s = S[name]; if(!s) return;
  s.data = data || {};
  s.on = true; show(s.el, true);
  // restart entrance animations
  s.el.querySelectorAll('.pn').forEach(p=>{ p.style.animation = 'none'; void p.offsetWidth; p.style.animation = ''; });
  try { if(s.open) s.open(s.data); } catch(err){ G.logError('ui.open '+name, err); }
  paintKF(s);
}
function closeScreen(name){
  const s = S[name]; if(!s || !s.on) return;
  s.on = false; show(s.el, false);
  try { if(s.close) s.close(); } catch(err){ G.logError('ui.close '+name, err); }
}

// ================================================================ title
function buildTitle(s){
  const e = s.el;
  const logo = el('div', 'logo', e);
  const l1 = el('div', 'l1', logo);
  Array.from('もふもふ').forEach((ch, i)=>{ const sp = el('span', 'lk', l1); sp.textContent = ch; sp.setAttribute('data-t', ch); sp.style.setProperty('--i', i); });
  const l2 = el('div', 'l2', logo);
  const rbw = el('span', 'rbw', l2); el('i', 'rb', rbw).textContent = 'せいけんし';
  Array.from('聖犬士イッヌ').forEach((ch, i)=>{ const sp = el('span', 'lk', i<3 ? rbw : l2); sp.textContent = ch; sp.setAttribute('data-t', ch); sp.style.setProperty('--i', i+4); });
  el('div', '', logo).appendChild(el('div', 'l3', null)).textContent = '〜ワンワンていこくを やっつけろ！〜';
  [[-6,8,0],[103,2,.6],[-3,70,1.1],[100,62,.3],[48,-14,.9]].forEach(p=>{ const t = el('i', 'tw', logo, SVG.spark); t.style.left = p[0]+'%'; t.style.top = p[1]+'%'; t.style.animationDelay = p[2]+'s'; });

  const bot = el('div', 'tbot', e);
  const dcol = el('div', 'tdiff', bot);
  el('div', 'tlab', dcol).textContent = 'むずかしさ';
  const chips = el('div', 'chips', dcol);
  s.chips = DIFFS.map(d=>{
    const b = button(chips, 'chip '+d.cls, '<span>'+d.t+'</span><span class="pw">'+SVG.paw.replace('<svg','<i><svg').replace('</svg>','</svg></i>').repeat(d.n)+'</span>', ()=> setDiff(d.k));
    b.dataset.k = d.k; return b;
  });
  const play = s.play = button(bot, 'play k-pink', '<span class="ic">'+SVG.paw+'</span><span>あそぶ</span>', ()=> call(s.data.onPlay, s.diff), false);
  const opts = el('div', 'topts', bot);
  const snd = s.snd = button(opts, 'k-cream', '', ()=>{ s.sound = !s.sound; paintSound(); call(s.data.onSound, s.sound); });
  const help = button(opts, 'k-cream', '<span>？ あそびかた</span>', ()=> toggleHelp(true));
  s.nav = [play, snd, help];

  // controls help (keyboard + touch)
  const hp = s.help = el('div', 'pn thelp x', e);
  el('div', 'hd', hp).textContent = 'あそびかた';
  hp.firstChild.style.cssText = 'font-size:1.6em;text-align:center;--tc:#3a8ad0';
  const hc = el('div', 'hc', hp);
  const row = (box, a, b)=>{ const r = el('div', 'hr_', box); el('span', '', r).textContent = a; el('b', '', r).textContent = b; };
  const kb = el('div', 'hb', hc); el('h4', '', kb).textContent = 'キーボード';
  row(kb, 'いどう', '← → ↑ ↓ / WASD'); row(kb, 'こうげき', 'J / Z'); row(kb, 'ジャンプ', 'K / スペース'); row(kb, 'よける', 'L / シフト');
  row(kb, 'ひっさつ', 'I / X'); row(kb, 'おうぎ', 'U / C'); row(kb, 'ひとやすみ', 'P / Esc');
  const tb = el('div', 'hb', hc); el('h4', '', tb).textContent = 'スマホ・タブレット';
  row(tb, 'いどう', 'ひだりがわを なぞる'); row(tb, 'こうげき', 'ピンクの ボタン'); row(tb, 'ジャンプ', 'みずいろ'); row(tb, 'よける', 'みどり');
  row(tb, 'ひっさつ', 'むらさき（✦を つかう）'); row(tb, 'おうぎ', 'ひかったら おしてね！'); row(tb, 'ひとやすみ', 'みぎうえの Ⅱ');
  const close = button(hp, 'k-sky', 'とじる', ()=> toggleHelp(false));
  close.style.cssText = 'display:flex;margin:0 auto';
  s.helpClose = close;

  function setDiff(k){ if(!DIFFS.some(d=>d.k===k)) k = 'normal'; s.diff = k; for(const c of s.chips) c.classList.toggle('sel', c.dataset.k===k); }
  function paintSound(){ snd.innerHTML = '<span class="ic">'+(s.sound ? SVG.sndOn : SVG.sndOff)+'</span><span>おと '+(s.sound ? 'オン' : 'オフ')+'</span>'; }
  function toggleHelp(on){ s.helpOn = on; show(hp, on); s.nav = on ? [close] : [play, snd, help]; s.ni = 0; paintKF(s); }
  s.setDiff = setDiff;
  s.open = (d)=>{ setDiff(d.difficulty || 'normal'); s.sound = soundState(d.soundOn); paintSound(); toggleHelp(false); s.ni = 0; };
  s.key = (e, c)=>{
    if(s.helpOn){ if(c==='Escape'||c==='Enter'||c==='NumpadEnter'||c==='Space'){ if(!e.repeat){ sfx('select'); toggleHelp(false); } return true; } return false; }
    if(c==='ArrowLeft'||c==='ArrowRight'||c==='KeyA'||c==='KeyD'){
      const i = DIFFS.findIndex(d=>d.k===s.diff), n = (i + (c==='ArrowLeft'||c==='KeyA' ? -1 : 1) + DIFFS.length) % DIFFS.length;
      setDiff(DIFFS[n].k); sfx('select'); return true;
    }
    return navKey(s, c, e);
  };
}

// ================================================================ select
function paws(v, intScale){
  if(v==null || isNaN(v)) return 3;
  if(intScale) return U.clamp(Math.round(v), 1, 5);
  return U.clamp(Math.round(3 + (v-1)*8), 1, 5);         // stat multipliers: 0.8→1 … 1.0→3 … 1.25+→5
}
const STAT_ROWS = [ ['hp','たいりょく'], ['atk','ちから'], ['spd','はやさ'], ['jump','ジャンプ'] ];
function buildSelect(s){
  const e = s.el;
  const head = el('div', 'shead', e);
  const back = button(head, 'back k-cream', '<span class="ic">'+SVG.left+'</span><span>もどる</span>', ()=> call(s.data.onBack), false);
  el('div', 'hd', head).textContent = 'なかまを えらんでね！';
  const info = s.info = el('div', 'pn sinfo', e);
  s.nm = el('div', 'snm', info); s.sp = el('div', 'ssp', info); s.ds = el('div', 'sds', info);
  s.rows = STAT_ROWS.map(r=>{
    const row = el('div', 'srow', info); el('span', 'sl', row).textContent = r[1];
    const pw = el('span', 'pws', row); const cells = [];
    for(let i=0;i<5;i++) cells.push(el('i', '', pw, SVG.paw));
    return { key:r[0], cells };
  });
  s.mv = el('div', 'smv', info);
  s.cards = el('div', 'scards', e);
  s.go = button(e, 'sgo k-pink', '<span class="ic">'+SVG.paw+'</span><span>このこで いく！</span>', ()=> pick(), false);
  s.back = back;
  s.list = []; s.focus = 0; s.cardEls = [];

  function paint(){
    const h = s.list[s.focus]; if(!h) return;
    s.cardEls.forEach((c, i)=> c.classList.toggle('on', i===s.focus));
    info.style.setProperty('--hc', h.color || '#ff8fb8');
    txt(s.nm, h.name || h.short || h.id);
    txt(s.sp, h.species || '');
    txt(s.ds, h.desc || '');
    const st = h.stats || {};
    for(const r of s.rows){ const n = paws(st[r.key], s.intScale); r.cells.forEach((c, i)=> c.classList.toggle('f', i<n)); }
    s.mv.innerHTML = '';
    const sp = h.specialName || (h.specials && h.specials.n), ul = h.ultName;
    if(sp){ const t = el('span', '', s.mv); el('b', '', t).textContent = 'ひっさつ'; t.appendChild(document.createTextNode(sp)); }
    if(ul){ const t = el('span', '', s.mv); el('b', '', t).textContent = 'おうぎ'; t.appendChild(document.createTextNode(ul)); }
    // restart the little pop on the info card
    info.style.animation = 'none'; void info.offsetWidth; info.style.animation = '';
  }
  function setFocus(i, user){
    const n = s.list.length; if(!n) return;
    i = ((i % n) + n) % n;
    if(i===s.focus && !user) { paint(); return; }
    s.focus = i; paint();
    if(user) call(s.data.onFocus, s.list[i].id);
  }
  function pick(){ const h = s.list[s.focus]; if(h) call(s.data.onPick, h.id); }
  s.open = (d)=>{
    s.list = (d.heroes && d.heroes.length ? d.heroes : heroList()).slice();
    s.intScale = s.list.length>0 && s.list.every(h=> h.stats && Object.keys(h.stats).every(k=> Number.isInteger(h.stats[k]) && h.stats[k]>=1 && h.stats[k]<=5));
    s.cards.innerHTML = ''; s.cardEls = [];
    s.list.forEach((h, i)=>{
      const c = el('button', 'card', s.cards); c.type = 'button'; c.tabIndex = -1; c.style.setProperty('--i', i);
      c.style.setProperty('--hc', h.color || '#ffb070');
      const cp = el('div', 'cp', c); fillPortrait(cp, h, 'normal');
      el('div', 'cn', c).textContent = h.short || h.name || h.id;
      c.addEventListener('click', (ev)=>{ ev.preventDefault(); c.blur(); if(i===s.focus) pick(); else setFocus(i, true); });
      s.cardEls.push(c);
    });
    const i = Math.max(0, s.list.findIndex(h=> h.id===d.selected));
    s.focus = i; paint();
  };
  s.key = (e, c)=>{
    if(c==='ArrowLeft'||c==='KeyA'){ setFocus(s.focus-1, true); return true; }
    if(c==='ArrowRight'||c==='KeyD'){ setFocus(s.focus+1, true); return true; }
    if(c==='Enter'||c==='NumpadEnter'||c==='Space'){ if(!e.repeat){ pressFx(s.go); pick(); } return true; }
    if(c==='Escape'||c==='Backspace'){ if(!e.repeat){ pressFx(back); call(s.data.onBack); } return true; }
    return false;
  };
}

// ================================================================ HUD
const hud = { el:null, on:false, hpF:-1, chip:1, chipWait:0, hurtT:0, healT:0, sp:-1, ult:-1, full:false, lv:-1, xp:-1, coins:-1, coinShow:0, coinT:9,
  combo:0, comboShown:0, comboT:9, comboA:0, rank:'', rankCol:'', type:'', expr:'', hpNum:-1, hpCls:'' };
function buildHUD(){
  const e = hud.el = el('div', 'hud x', root);
  const hl = hud.hl = el('div', 'hl', e);
  const pf = el('div', 'pf', hl);
  hud.pfr = el('div', 'pfr', pf);
  const pfi = hud.pfi = el('div', 'pfi', pf);
  hud.fb = el('div', 'fbk', pfi); hud.img = el('img', '', pfi); hud.img.alt = ''; hud.img.draggable = false; hud.img.style.display = 'none';
  hud.lvEl = el('div', 'lv', pf);
  const bars = el('div', 'bars', hl);
  const hpw = hud.hpw = el('div', 'hpw', bars);
  hud.heart = el('div', 'heart', hpw, SVG.heart);
  const hpb = el('div', 'hpb', hpw);
  hud.hpc = el('div', 'hpc', hpb); hud.hpf = el('div', 'hpf', hpb); el('div', 'hpgl', hpb); hud.hpn = el('div', 'hpn', hpb);
  const r2 = el('div', 'r2', bars);
  const pips = el('div', 'pips', r2);
  hud.pips = [];
  for(let i=0;i<3;i++){ const p = el('div', 'pip', pips); p.style.setProperty('--i', i); el('i', 'pb', p, SVG.spark); el('i', 'pe', p, SVG.spark); const f = el('i', 'pfl', p, SVG.spark); hud.pips.push({ p, f, v:-1 }); }
  const ug = hud.ug = el('div', 'ug', r2);
  el('div', 'ugg', ug); hud.ugf = el('div', 'ugf', ug); hud.ugl = el('div', 'ugl', ug); txt(hud.ugl, 'おうぎ');
  const hr = el('div', 'hr', e);
  const coins = hud.coinsEl = el('div', 'coins', hr);
  el('div', 'coin', coins, SVG.paw); hud.coinN = el('span', '', coins);
  const pz = hud.pz = button(hr, 'pz k-sky', '<span class="ic">'+SVG.pause+'</span>', null, false);
  pz.addEventListener('pointerdown', (ev)=>{ ev.preventDefault(); if(G.input && G.input.latch) G.input.latch('pause'); });
  const combo = hud.comboEl = el('div', 'combo', e);
  hud.cn = el('span', 'cn', combo); hud.cl = el('span', 'cl', combo); txt(hud.cl, 'コンボ'); hud.cr = el('span', 'cr', combo);
}
function hudReset(){
  Object.assign(hud, { hpF:-1, chip:1, chipWait:0, hurtT:0, healT:0, sp:-1, ult:-1, full:false, lv:-1, xp:-1, coins:-1, coinShow:0, coinT:9,
    combo:0, comboShown:0, comboT:9, comboA:0, rank:'', rankCol:'', type:'', expr:'', hpNum:-1, hpCls:'' });
  hud.comboEl.style.opacity = '0'; hud.hl.style.transform = '';
}
function hudFrame(dt){
  const p = G.player, g = G.game || {};
  if(p){
    // portrait (expression follows what is happening)
    if(p.type!==hud.type){ hud.type = p.type; const h = heroMeta(p.type); hud.pfi.style.setProperty('--hc', h.color||'#ffb070'); hud.pfi.style.setProperty('--hc2', lighten(h.color,0.7)); txt(hud.fb, initialOf(h)); hud.img._key = null; hud.expr = ''; }
    const maxHp = Math.max(1, p.maxHp||1), f = U.clamp((p.hp||0)/maxHp, 0, 1);
    if(hud.hpF<0){ hud.hpF = f; hud.chip = f; clipR(hud.hpf, f); clipR(hud.hpc, f); }
    else if(f!==hud.hpF){
      if(f < hud.hpF){ hud.chipWait = 0.42; hud.hurtT = 0.4; } else { hud.chip = Math.max(hud.chip, f); hud.healT = 0.6; clipR(hud.hpc, hud.chip); }
      hud.hpF = f; clipR(hud.hpf, f);
    }
    if(hud.chipWait > 0) hud.chipWait -= dt;
    else if(hud.chip > hud.hpF){ hud.chip = Math.max(hud.hpF, hud.chip - dt*(0.35 + (hud.chip-hud.hpF)*1.5)); clipR(hud.hpc, hud.chip); }
    const cls = f<=0.25 ? 'low' : f<=0.5 ? 'mid' : '';
    if(cls!==hud.hpCls){ hud.hpCls = cls; hud.hpf.className = 'hpf '+cls; hud.heart.classList.toggle('low', cls==='low'); }
    const hpNum = Math.max(0, Math.ceil(p.hp||0)); if(hpNum!==hud.hpNum){ hud.hpNum = hpNum; txt(hud.hpn, hpNum); }
    // hurt wobble / heal glow
    if(hud.hurtT > 0){ hud.hurtT -= dt; const t = 0.4 - hud.hurtT; const a = reduced ? 0 : Math.sin(t*55)*Math.exp(-t*9)*5; hud.hl.style.transform = hud.hurtT>0 ? 'translateX('+a.toFixed(1)+'px)' : ''; }
    if(hud.healT > 0){ hud.healT -= dt; hud.hpw.classList.toggle('heal', hud.healT>0); }
    // ✦ pips (sp 0..3 float, each pip fills from the bottom)
    const sp = U.clamp(+p.sp||0, 0, 3);
    if(Math.abs(sp-hud.sp) > 0.004){
      hud.sp = sp;
      for(let i=0;i<3;i++){ const q = hud.pips[i], v = U.clamp(sp-i, 0, 1); if(Math.abs(v-q.v) > 0.004){ q.v = v; q.p.style.setProperty('--f', v.toFixed(3)); q.p.classList.toggle('full', v>=1); } }
    }
    // おうぎ gauge
    const u = U.clamp(+p.ult||0, 0, 100);
    if(Math.abs(u-hud.ult) > 0.05){ hud.ult = u; clipR(hud.ugf, u/100); }
    const full = u>=100;
    if(full!==hud.full){ hud.full = full; hud.ug.classList.toggle('full', full); txt(hud.ugl, full ? 'おうぎ OK！' : 'おうぎ'); }
    // expression: hurt > happy (ult ready / big combo) > normal
    const expr = hud.hurtT>0 || p.dead ? 'hurt' : (full || (g.combo|0)>=8) ? 'happy' : 'normal';
    if(expr!==hud.expr){ hud.expr = expr; setPortraitSrc(hud.img, hud.fb, p.type, expr); }
  }
  // level + xp ring
  const lv = (p && p.level) || g.level || 1;
  if(lv!==hud.lv){ if(hud.lv>0 && lv>hud.lv && !reduced){ hud.lvEl.classList.remove('pop'); void hud.lvEl.offsetWidth; hud.lvEl.classList.add('pop'); } hud.lv = lv; txt(hud.lvEl, 'Lv '+lv); }
  const xp = (p && p.xp!=null ? p.xp : g.xp) || 0, xpN = (p && p.xpNext) || g.xpNext || 0;
  const xf = xpN>0 ? U.clamp(xp/xpN, 0, 1) : 0;
  if(Math.abs(xf-hud.xp) > 0.002){ hud.xp = xf; setVar(hud.pfr, '--xp', xf); }
  // coins: count up quickly, bump when they grow
  const coins = g.coins|0;
  if(hud.coins<0){ hud.coins = coins; hud.coinShow = coins; txt(hud.coinN, coins); }
  else if(coins!==hud.coins){ if(coins>hud.coins) hud.coinT = 0; hud.coins = coins; }
  if(hud.coinShow!==hud.coins){
    const d = hud.coins - hud.coinShow; hud.coinShow += Math.sign(d)*Math.max(1, Math.ceil(Math.abs(d)*Math.min(1, dt*12)));
    if((d>0 && hud.coinShow>hud.coins) || (d<0 && hud.coinShow<hud.coins)) hud.coinShow = hud.coins;
    txt(hud.coinN, hud.coinShow);
  }
  if(hud.coinT < 0.5){ hud.coinT += dt; const t = hud.coinT, s = reduced ? 1 : 1 + 0.22*Math.exp(-t*10)*Math.cos(t*30); hud.coinsEl.style.transform = t<0.5 ? 'scale('+s.toFixed(3)+')' : ''; }
  // combo counter
  const combo = g.combo|0;
  if(combo!==hud.combo){
    if(combo>=2){ if(combo>hud.combo || hud.comboA<=0) hud.comboT = 0; hud.comboShown = combo; txt(hud.cn, combo); }
    hud.combo = combo;
  }
  let rank = g.comboRank || '', rcol = g.comboColor || '';
  if(combo>=2 && !rank){ for(const r of RANKS) if(combo>=r[0]){ rank = r[1]; rcol = r[2]; } }
  if(combo>=2){
    if(rank!==hud.rank){ hud.rank = rank; txt(hud.cr, rank); if(hud.comboShown) hud.comboT = Math.min(hud.comboT, 0); }
    if(rcol && rcol!==hud.rankCol){ hud.rankCol = rcol; hud.comboEl.style.setProperty('--rc', rcol); }
  }
  const want = combo>=2 ? 1 : 0;
  if(hud.comboA!==want){
    hud.comboA = want ? Math.min(1, hud.comboA + dt*12) : Math.max(0, hud.comboA - dt*3.5);
    hud.comboEl.style.opacity = hud.comboA.toFixed(3);
  }
  if(hud.comboT < 0.6 && hud.comboA>0){
    hud.comboT += dt; const t = hud.comboT;
    const k = reduced ? 0 : Math.exp(-t*8), s = 1 + 0.5*k*Math.cos(t*28), r = -3 + 6*k*Math.sin(t*28);
    hud.comboEl.style.transform = 'scale('+s.toFixed(3)+') rotate('+r.toFixed(2)+'deg)';
  }
}

// ================================================================ boss bar
const boss = { ent:null, el:null, f:-1, chip:1, wait:0, name:'', title:'' };
function buildBoss(){
  const e = boss.el = el('div', 'boss x', root);
  const nm = el('div', 'bnm', e);
  el('i', 'cr_', nm, SVG.crown); boss.nm = el('span', '', nm); boss.tl = el('span', 'btl', nm);
  const bb = el('div', 'bb', e);
  boss.c = el('div', 'bbc', bb); boss.f_ = el('div', 'bbf', bb); el('div', 'hpgl', bb);
}
function bossBar(ent){
  boss.ent = ent || null;
  show(boss.el, !!ent);
  if(ent){ boss.f = -1; boss.el.classList.remove('in'); void boss.el.offsetWidth; boss.el.classList.add('in'); bossFrame(0); }
}
function bossFrame(dt){
  const e = boss.ent; if(!e) return;
  const d = e.def || {};
  txt(boss.nm, d.name || e.name || 'ボス'); txt(boss.tl, d.title || e.title || '');
  const f = U.clamp((e.hp||0)/Math.max(1, e.maxHp||1), 0, 1);
  if(boss.f<0){ boss.f = f; boss.chip = f; clipR(boss.f_, f); clipR(boss.c, f); }
  else if(f!==boss.f){ if(f<boss.f) boss.wait = 0.45; else { boss.chip = Math.max(boss.chip, f); clipR(boss.c, boss.chip); } boss.f = f; clipR(boss.f_, f); }
  if(boss.wait>0) boss.wait -= dt;
  else if(boss.chip > boss.f){ boss.chip = Math.max(boss.f, boss.chip - dt*(0.25 + (boss.chip-boss.f)*1.2)); clipR(boss.c, boss.chip); }
}

// ================================================================ foe mini HP bars (pooled)
const FB_MAX = 20;
const fbs = [];
const _sp = { x:0, y:0, visible:false };
let fbAny = false;
function buildFoeBars(){
  for(let i=0;i<FB_MAX;i++){
    const b = el('div', 'fb', fbLayer); const c = el('div', 'fbc', b); const f = el('div', 'fbf', b);
    fbs.push({ el:b, c, f, ent:null, seen:false, vis:false, fv:-1, chip:1, wait:0, w:44, h:8, x:-1, y:-1, a:-1 });
  }
}
function foeBarsFrame(dt){
  const ents = G.world && G.world.ents; if(!ents || !G.toScreen) return;
  for(const s of fbs) s.seen = false;
  fbAny = false;
  for(let i=0;i<ents.length;i++){
    const e = ents[i];
    if(e.team!==1 || e.dead || !(e.hpShowT>0) || (e.def && e.def.boss) || e===boss.ent) continue;
    let slot = null;
    for(const s of fbs) if(s.ent===e){ slot = s; break; }
    if(!slot){ for(const s of fbs) if(!s.ent){ slot = s; slot.ent = e; slot.fv = -1; break; } }
    if(!slot) continue;
    slot.seen = true;
    const hh = (e.rig && e.rig.height) || e.height || 1.2;
    G.toScreen(e.rig && e.rig.root ? e.rig.root.position.x : e.x, (e.rig && e.rig.root ? e.rig.root.position.y : e.y) + hh + 0.2, e.rig && e.rig.root ? e.rig.root.position.z : e.z, _sp);
    if(!_sp.visible){ if(slot.vis){ slot.vis = false; slot.el.style.visibility = 'hidden'; } continue; }
    if(!slot.vis){ slot.vis = true; slot.el.style.visibility = 'visible'; slot.w = slot.el.offsetWidth || 44; slot.h = slot.el.offsetHeight || 8; }
    fbAny = true;
    const x = Math.round(_sp.x - slot.w/2), y = Math.round(_sp.y - slot.h);
    if(x!==slot.x || y!==slot.y){ slot.x = x; slot.y = y; slot.el.style.transform = 'translate3d('+x+'px,'+y+'px,0)'; }
    const a = e.hpShowT < 20 ? e.hpShowT/20 : 1;
    if(Math.abs(a-slot.a) > 0.02){ slot.a = a; slot.el.style.opacity = a.toFixed(2); }
    const f = U.clamp((e.hp||0)/Math.max(1, e.maxHp||1), 0, 1);
    if(slot.fv<0){ slot.fv = f; slot.chip = f; clipR(slot.f, f); clipR(slot.c, f); }
    else if(f!==slot.fv){ if(f<slot.fv) slot.wait = 0.35; else { slot.chip = Math.max(slot.chip, f); clipR(slot.c, slot.chip); } slot.fv = f; clipR(slot.f, f); }
    if(slot.wait>0) slot.wait -= dt;
    else if(slot.chip > slot.fv){ slot.chip = Math.max(slot.fv, slot.chip - dt*1.2); clipR(slot.c, slot.chip); }
  }
  for(const s of fbs) if(!s.seen && s.ent){ s.ent = null; if(s.vis){ s.vis = false; s.el.style.visibility = 'hidden'; } }
}
function hideFoeBars(){ for(const s of fbs){ s.ent = null; if(s.vis){ s.vis = false; s.el.style.visibility = 'hidden'; } } fbAny = false; }

// ================================================================ banner / GO / hint
const ban = { el:null, t:0, life:0, on:false };
function buildBanner(){ ban.el = el('div', 'ban', root); ban.bt = el('div', 'bt', ban.el); el('br', '', ban.el); ban.bs = el('div', 'bs', ban.el); }
function banner(text, sub, frames){
  if(!ready) return;
  text = text==null ? '' : String(text); sub = sub==null ? '' : String(sub);
  if(!text && !sub){ ban.on = false; ban.el.style.visibility = 'hidden'; return; }
  const bossName = boss.ent && ((boss.ent.def && boss.ent.def.name) || boss.ent.name);
  const v = /GO|ゴー|スタート/.test(text) ? 'v-go' : (/ボス|あらわれ/.test(text) || (bossName && text===bossName)) ? 'v-boss' :
            /クリア|やったね|おめでとう/.test(text) ? 'v-clear' : /がんばれ|チャンス|ナイス/.test(text) ? 'v-cheer' : 'v-stage';
  ban.el.className = 'ban ' + v;
  ban.bt.innerHTML = '';
  const chars = Array.from(text);
  chars.forEach((ch, i)=>{ const s = el('span', ch===' '||ch==='　' ? 'sp' : '', ban.bt); if(ch!==' ' && ch!=='　'){ s.textContent = ch; s.setAttribute('data-t', ch); } s.style.setProperty('--i', i); });
  const w = Math.max(200, (G.view && G.view.w) || innerWidth);
  const n = Math.max(1, chars.length);
  ban.bt.style.fontSize = Math.min(emPx*4.3, w*0.9/(n*1.04)).toFixed(1)+'px';
  ban.bs.textContent = sub; ban.bs.style.display = sub ? '' : 'none';
  ban.bs.style.fontSize = Math.min(emPx*1.35, w*0.8/Math.max(1, Array.from(sub).length*1.05 + 2.4)).toFixed(1)+'px';
  ban.t = 0; ban.life = Math.max(0.5, (frames||120)/60); ban.on = true;
  ban.el.style.visibility = 'visible';
  bannerFrame(0);
}
function bannerFrame(dt){
  if(!ban.on) return;
  ban.t += dt; const t = ban.t, L = ban.life;
  if(t >= L){ ban.on = false; ban.el.style.visibility = 'hidden'; return; }
  let s = 1, o = 1, r = 0;
  if(t < 0.42){ const k = t/0.42; s = reduced ? 1 : 0.25 + 0.75*U.easeOutBack(k); o = Math.min(1, k*3); r = reduced ? 0 : (1-k)*-6; }
  else if(t > L-0.3){ const k = (t-(L-0.3))/0.3; o = 1-k; s = 1 + (reduced ? 0 : k*0.15); }
  ban.el.style.opacity = o.toFixed(3);
  ban.el.style.transform = 'translateY(-50%) scale('+s.toFixed(3)+') rotate('+r.toFixed(2)+'deg)';
}
let goEl = null, goOn = false;
function buildGo(){ goEl = el('div', 'goa x', root); el('span', '', goEl).textContent = 'GO'; el('i', 'ar', goEl, SVG.go); }
function go(on){ goOn = !!on; if(ready) show(goEl, goOn); }

const hint = { el:null, t:0, life:0, on:false, text:'', shown:-1 };
function buildHint(){
  const e = hint.el = el('div', 'hint', root);
  hint.av = el('div', 'av', e, '<i class="e l"></i><i class="e r"></i><i class="bl l"></i><i class="bl r"></i><i class="mo"></i>');
  const b = el('div', 'hb_', e); hint.nm = el('div', 'hn', b); hint.tx = el('div', 'ht', b);
}
function hintShow(name, text, frames){
  if(!ready) return;
  if(!text){ hint.on = false; hint.el.style.visibility = 'hidden'; return; }
  name = name==null ? '' : String(name);
  const who = /モフ/.test(name) ? 'mofu' : /チャム/.test(name) ? 'cham' : /ペロ/.test(name) ? 'pero' : /クロ/.test(name) ? 'kuro' : '';
  hint.av.className = 'av ' + who;
  hint.el.style.setProperty('--avr', ({ mofu:'#b8d86a', cham:'#ff9a3a', pero:'#ff8fb8', kuro:'#b77cf0' })[who] || '#ffd24d');
  hint.el.style.setProperty('--avd', ({ mofu:'#6f9a2a', cham:'#c0600c', pero:'#c8487e', kuro:'#6a3aa0' })[who] || '#c08a10');
  txt(hint.nm, name || 'ヒント'); show(hint.nm, !!name);
  hint.chars = Array.from(String(text)); hint.text = String(text); hint.shown = -1;
  hint.t = 0; hint.life = Math.max(1, (frames||300)/60); hint.on = true;
  hint.el.style.visibility = 'visible';
  hintFrame(0);
}
function hintFrame(dt){
  if(!hint.on) return;
  hint.t += dt; const t = hint.t, L = hint.life;
  if(t >= L){ hint.on = false; hint.el.style.visibility = 'hidden'; return; }
  const n = reduced ? hint.chars.length : Math.min(hint.chars.length, Math.floor(t*38)+1);
  if(n!==hint.shown){ hint.shown = n; hint.tx.textContent = n>=hint.chars.length ? hint.text : hint.chars.slice(0, n).join(''); }
  let o = 1, y = 0;
  if(t < 0.25){ o = t/0.25; y = reduced ? 0 : (1-o)*14; } else if(t > L-0.3){ o = (L-t)/0.3; }
  hint.el.style.opacity = o.toFixed(3);
  const port = root.classList.contains('port'), tcon = root.classList.contains('tcon');
  const base = (tcon && !port) ? '' : 'translateX(-50%) ';
  hint.el.style.transform = base + 'translateY(' + y.toFixed(1) + 'px)';
}

// ================================================================ touch controls
const T = { el:null, wanted:false, visible:false, mode:'auto', saw:false, keyUsed:false, R:56, B:96, inL:10, inB:8, probe:null,
  stick:{ id:null, ox:0, oy:0 }, btns:[], zone:null, base:null, knob:null, spN:-1, spDim:null, ult:-1, ready:null };
const TBTN = [
  { k:'attack',  t:'こうげき', ic:SVG.paw,   cls:'k-pink', s:1.0,  r:.2,   b:.2 },
  { k:'jump',    t:'ジャンプ', ic:SVG.up,    cls:'k-sky',  s:.74,  r:1.34, b:.08 },
  { k:'dodge',   t:'よける',   ic:SVG.roll,  cls:'k-mint', s:.64,  r:1.38, b:.98 },
  { k:'special', t:'ひっさつ', ic:SVG.spark, cls:'k-lav',  s:.7,   r:.34,  b:1.36 },
  { k:'ult',     t:'おうぎ',   ic:SVG.star,  cls:'k-sun',  s:.76,  r:1.24, b:1.76 },
];
function buildTouch(){
  const e = T.el = el('div', 'tc x', root);
  const zone = T.zone = el('div', 'tz', e);
  const base = T.base = el('div', 'stk ghost', e);
  [['left','0','39%'],['right','78%','39%'],['up','39%','0'],['down','39%','78%']].forEach(a=>{
    const i = el('i', 'ga', base, a[0]==='left' ? SVG.left : a[0]==='right' ? SVG.right : SVG.left);
    i.style.left = a[1]; i.style.top = a[2];
    if(a[0]==='up') i.style.transform = 'rotate(90deg)'; if(a[0]==='down') i.style.transform = 'rotate(-90deg)';
  });
  T.knob = el('div', 'knob', base);
  zone.addEventListener('pointerdown', stickDown, { passive:false });
  for(const d of TBTN){
    const b = el('div', 'tb '+d.cls+' '+d.k, e);
    b.dataset.btn = d.k;
    b.style.cssText = 'right:calc(var(--pr) + var(--b)*'+d.r+');bottom:calc(var(--pb) + var(--b)*'+d.b+');width:calc(var(--b)*'+d.s+');height:calc(var(--b)*'+d.s+');font-size:calc(var(--b)*'+(0.155*Math.pow(d.s, 0.45)).toFixed(3)+')';
    if(d.k==='ult') el('i', 'glo', b);
    el('i', 'ti', b, d.ic); el('span', 'tl', b).textContent = d.t;
    const o = { k:d.k, el:b, ids:[] , badge:null, bn:null };
    if(d.k==='special'){ o.badge = el('span', 'bdg', b); el('i', '', o.badge, SVG.spark); o.bn = el('span', '', o.badge); }
    b.addEventListener('pointerdown', (ev)=> btnDown(o, ev), { passive:false });
    T.btns.push(o);
  }
  // no scrolling / zoom / long-press menus on the controls
  const stop = (ev)=>{ if(ev.cancelable) ev.preventDefault(); };
  for(const t of ['touchstart','touchmove','touchend']) e.addEventListener(t, stop, { passive:false });
  e.addEventListener('contextmenu', stop);
  window.addEventListener('pointermove', (ev)=>{ if(ev.pointerId===T.stick.id){ if(ev.cancelable) ev.preventDefault(); stickMove(ev.clientX, ev.clientY); } }, { passive:false });
  const up = (ev)=>{
    if(ev.pointerId===T.stick.id) stickEnd();
    for(const o of T.btns){ const i = o.ids.indexOf(ev.pointerId); if(i>=0){ o.ids.splice(i,1); if(!o.ids.length) btnOff(o); } }
  };
  window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
  zone.addEventListener('lostpointercapture', (ev)=>{ if(ev.pointerId===T.stick.id) stickEnd(); });
  window.addEventListener('blur', touchReleaseAll);
  document.addEventListener('visibilitychange', ()=>{ if(document.hidden) touchReleaseAll(); });
  ghostPos();
}
function ghostPos(){
  // idle hint ring in the bottom-left so kids know where the stick lives (safe-area aware)
  const R = T.R;
  T.gx = T.inL + R*1.35; T.gy = innerHeight - T.inB - R*1.35;
  if(T.stick.id===null){ T.base.style.transform = 'translate3d('+T.gx.toFixed(1)+'px,'+T.gy.toFixed(1)+'px,0)'; T.knob.style.transform = ''; }
}
function stickDown(ev){
  if(!T.visible) return;
  if(ev.cancelable) ev.preventDefault();
  T.saw = ev.pointerType==='touch' || ev.pointerType==='pen' || T.saw;
  const s = T.stick; if(s.id!==null) return;          // one finger drives the stick; others are ignored here
  s.id = ev.pointerId;
  const R = T.R, m = 6;
  s.ox = U.clamp(ev.clientX, R+m, innerWidth - R - m); s.oy = U.clamp(ev.clientY, R+m, innerHeight - R - m);
  try { T.zone.setPointerCapture(ev.pointerId); } catch(_){}
  T.base.classList.remove('ghost'); T.base.classList.add('on');
  stickMove(ev.clientX, ev.clientY);
}
function stickMove(cx, cy){
  const s = T.stick, R = T.R;
  let dx = cx - s.ox, dy = cy - s.oy, d = Math.hypot(dx, dy);
  const follow = R*1.3;
  if(d > follow){ const k = (d-follow)/d; s.ox += dx*k; s.oy += dy*k; dx = cx - s.ox; dy = cy - s.oy; d = follow; }
  const kx = d>0 ? dx/d : 0, ky = d>0 ? dy/d : 0, m = Math.min(1, d/R);
  const a = m < 0.12 ? 0 : (m-0.12)/0.88;                       // 12% dead zone, rescaled so the edge is still 1
  const ti = G.input && G.input.touch;
  if(ti){ ti.x = +(kx*a).toFixed(3); ti.z = +(ky*a).toFixed(3); }  // screen up (dy<0) → z<0 (away from camera)
  const kd = Math.min(d, R);
  T.base.style.transform = 'translate3d('+s.ox.toFixed(1)+'px,'+s.oy.toFixed(1)+'px,0)';
  T.knob.style.transform = 'translate3d('+(kx*kd).toFixed(1)+'px,'+(ky*kd).toFixed(1)+'px,0)';
}
function stickEnd(){
  const s = T.stick; s.id = null;
  const ti = G.input && G.input.touch; if(ti){ ti.x = 0; ti.z = 0; }
  T.base.classList.remove('on'); T.base.classList.add('ghost');
  ghostPos();
}
function btnDown(o, ev){
  if(!T.visible) return;
  if(ev.cancelable) ev.preventDefault();
  ev.stopPropagation();
  T.saw = ev.pointerType==='touch' || ev.pointerType==='pen' || T.saw;
  if(o.ids.indexOf(ev.pointerId)<0) o.ids.push(ev.pointerId);
  try { o.el.setPointerCapture(ev.pointerId); } catch(_){}
  const ti = G.input && G.input.touch; if(ti) ti[o.k] = true;
  if(G.input && G.input.latch) G.input.latch(o.k);
  o.el.classList.add('on');
}
function btnOff(o){ o.ids.length = 0; const ti = G.input && G.input.touch; if(ti) ti[o.k] = false; o.el.classList.remove('on'); }
function touchReleaseAll(){
  if(T.stick.id!==null) stickEnd();
  const ti = G.input && G.input.touch; if(ti){ ti.x = 0; ti.z = 0; }
  for(const o of T.btns) btnOff(o);
}
function touchApply(){
  if(!T.el) return;
  const auto = T.saw || (G.isTouch && !T.keyUsed);
  const vis = !!T.wanted && (T.mode==='on' || (T.mode!=='off' && auto));
  if(vis!==T.visible){
    T.visible = vis; show(T.el, vis); root.classList.toggle('tcon', vis);
    if(!vis) touchReleaseAll(); else ghostPos();
  }
}
function touchFrame(){
  touchApply();
  if(!T.visible) return;
  const p = G.player;
  const sp = p ? Math.floor((+p.sp||0) + 1e-6) : 0;
  const sb = T.btns[3];
  if(sp!==T.spN){ T.spN = sp; txt(sb.bn, sp); }
  const dim = sp < 1; if(dim!==T.spDim){ T.spDim = dim; sb.el.classList.toggle('dim', dim); }
  const ub = T.btns[4], u = p ? U.clamp(+p.ult||0, 0, 100) : 0;
  if(Math.abs(u - T.ult) > 0.3){ T.ult = u; setVar(ub.el, '--u', u/100, 0.002); }
  const rdy = u>=100; if(rdy!==T.ready){ T.ready = rdy; ub.el.classList.toggle('ready', rdy); ub.el.classList.toggle('dim', !rdy); }
}
const touch = {
  show(on){ T.wanted = !!on; if(ready) touchApply(); },
  get mode(){ return T.mode; }, set mode(m){ T.mode = (m==='on'||m==='off') ? m : 'auto'; if(ready) touchApply(); },
  get visible(){ return T.visible; },
  release: touchReleaseAll,
};

// ================================================================ pause
function buildPause(s){
  const pn = el('div', 'pn col', s.el);
  const hd = el('div', 'hd', pn); hd.textContent = 'ひとやすみ'; hd.style.setProperty('--tc', '#3a8ad0');
  el('div', 'sub', pn).textContent = 'ゆっくり やすんでね。じゅんびが できたら「つづける」！';
  const g = el('div', 'pgrid', pn);
  const res = button(g, 'big k-mint', '<span class="ic">'+SVG.play+'</span><span>つづける</span>', ()=> call(s.data.onResume), 'ok');
  const retry = button(g, 'k-sky', '<span class="ic">'+SVG.retry+'</span><span>やりなおす</span>', ()=> call(s.data.onRetry), 'ok');
  const snd = s.snd = button(g, 'k-sun', '', ()=>{ s.sound = !s.sound; paint(); call(s.data.onSound, s.sound); });
  const home = button(g, 'k-pink', '<span class="ic">'+SVG.home+'</span><span>タイトルへ</span>', ()=> call(s.data.onTitle), 'cancel');
  home.style.gridColumn = '1 / -1'; home.style.justifySelf = 'center';
  function paint(){ snd.innerHTML = '<span class="ic">'+(s.sound ? SVG.sndOn : SVG.sndOff)+'</span><span>おと '+(s.sound ? 'オン' : 'オフ')+'</span>'; }
  s.nav = [res, retry, snd, home];
  s.el.classList.add('dim');
  s.open = (d)=>{ s.sound = soundState(d.soundOn); paint(); s.ni = 0; touchReleaseAll(); };
  s.key = (e, c)=> navKey(s, c, e);
}

// ================================================================ result
const CHAM_LINES = [ 'すごいにゃ！ つぎも がんばるにゃ〜', 'かっこよかったにゃ！ コインは だいじに するにゃ', 'やったにゃ！ おうじょさまも よろこんでるにゃ', 'その ちょうしにゃ！ ファイトにゃ〜' ];
function buildResult(s){
  const pn = el('div', 'pn', s.el);
  const L = el('div', 'rleft', pn), R = el('div', 'rright', pn);
  const hd = el('div', 'hd', L); hd.textContent = 'ステージクリア！'; hd.style.setProperty('--tc', '#ffae2a');
  s.sn = el('div', 'rsn', L);
  s.stars = el('div', 'stars', L); s.starEls = [0,1,2].map(()=> el('i', '', s.stars, SVG.star));
  s.word = el('div', 'rword', L);
  const row = (icon, label)=>{ const r = el('div', 'rrow', R); const l = el('span', 'rl', r); el('i', '', l, icon); el('span', '', l).textContent = label; return el('span', 'rv', r); };
  s.vt = row(SVG.clock.replace('<svg','<svg style="color:#6fbcf6"'), 'タイム');
  s.vc = row('<div class="coin" style="width:1.2em;height:1.2em">'+SVG.paw+'</div>', 'コイン');
  s.vb = row(SVG.star.replace('<svg','<svg style="color:#ff8fb8"'), 'さいこうコンボ');
  const ch = s.cham = el('div', 'cham', R);
  el('div', 'av cham', ch, '<i class="e l"></i><i class="e r"></i><i class="bl l"></i><i class="bl r"></i><i class="mo"></i>');
  s.bub = el('div', 'bub', ch);
  s.next = button(R, 'k-pink', '', ()=> call(s.data.onNext), false);
  s.nav = [s.next];
  s.el.classList.add('dim');
  s.open = (d)=>{
    txt(s.sn, d.stageName || '');
    const n = U.clamp(d.stars|0, 0, 3);
    s.starEls.forEach((e, i)=> e.classList.toggle('f', i<n));
    s.stars.classList.remove('go'); void s.stars.offsetWidth; s.stars.classList.add('go');
    txt(s.word, n>=3 ? 'かんぺき！' : n===2 ? 'すごい！' : 'クリア！');
    s.t = 0; s.tv = Math.max(0, d.time||0); s.cv = Math.max(0, d.coins|0); s.bv = Math.max(0, d.bestCombo|0);
    txt(s.vt, fmtTime(0)); txt(s.vc, 0); txt(s.vb, 0);
    txt(s.bub, CHAM_LINES[Math.floor(Math.random()*CHAM_LINES.length)]);
    s.next.innerHTML = '<span>'+(d.last ? 'エンディングへ' : 'つぎへ')+'</span><span class="ic">'+SVG.play+'</span>';
    s.ni = 0; touchReleaseAll();
  };
  s.frame = (dt)=>{
    if(s.t >= 1.6) return;
    s.t += dt; const k = reduced ? 1 : U.easeOutCubic(U.clamp((s.t-0.3)/1.1, 0, 1));
    txt(s.vt, fmtTime(s.tv*k)); txt(s.vc, Math.round(s.cv*k)); txt(s.vb, Math.round(s.bv*k));
  };
  s.key = (e, c)=> navKey(s, c, e);
}

// ================================================================ over
function buildOver(s){
  const c = el('div', 'col', s.el);
  const pup = el('div', 'pup', c, SAD_PUP);
  const orb = el('div', 'orb', pup); for(let i=0;i<3;i++) el('i', '', orb, SVG.star);
  el('div', 'hd', c).textContent = 'やられちゃった…';
  el('div', 'sub', c).textContent = 'だいじょうぶ！ ひとやすみしたら、もういちど がんばろう！';
  const b = el('div', 'obtn', c);
  const retry = button(b, 'k-mint', '<span class="ic">'+SVG.retry+'</span><span>もういちど</span>', ()=> call(s.data.onRetry), 'ok');
  const home = button(b, 'k-cream', '<span class="ic">'+SVG.home+'</span><span>タイトルへ</span>', ()=> call(s.data.onTitle), 'cancel');
  s.nav = [retry, home];
  s.open = ()=>{ s.ni = 0; touchReleaseAll(); };
  s.key = (e, k)=> navKey(s, k, e);
}

// ================================================================ ending
function buildEnding(s){
  const roll = s.roll = el('div', 'roll', s.el);
  s.skip = button(s.el, 'eskip k-cream', '<span>とばす</span><span class="ic">'+SVG.play+'</span>', ()=>{ s.y = s.stopY; }, 'select');
  s.btn = button(s.el, 'etitle k-pink x', '<span class="ic">'+SVG.home+'</span><span>タイトルへ</span>', ()=> call(s.data.onTitle), 'ok');
  s.nav = [s.skip];
  s.open = (d)=>{
    roll.innerHTML = '';
    const me = heroMeta(d.heroId || (G.game && G.game.heroId) || 'inu');
    const line = (cls, t)=>{ const e = el('div', cls, roll); if(t!=null) e.textContent = t; return e; };
    const ep = line('eport'); fillPortrait(ep, me, 'happy');
    line('ln', (me.short || me.name) + 'と なかまたちは、ダークワンワンていこくを やっつけた！');
    line('ln', 'たいていの こころから くらやみが きえて、にっこり えがおに もどったよ。');
    line('ln', 'クロイヌ「やっと めがさめたよ…… ありがとう。」');
    line('ln', 'そらには おおきな にじ。おうさまも ぶじに かえってきた！');
    line('ln', 'おしろの かべから、みんなで はなびを どーん！ どーん！');
    const q = line('qt'); el('span', 'who', q).textContent = 'おうじょ ペロ'; q.appendChild(document.createTextNode('「このひかりは、あなたのものです」'));
    line('ln', 'つよさは、だれかを まもるために ある。');
    const eh = line('eh'); eh.innerHTML = '★ もふもふ<ruby>聖犬士<rt>せいけんし</rt></ruby>でんせつ ★';
    line('th', 'なかまたち');
    const team = line('team');
    for(const h of heroList()){
      const m = el('div', 'mate', team); const mp = el('div', 'mp', m); fillPortrait(mp, h, 'normal');
      el('span', '', m).textContent = h.name || h.short || h.id;
    }
    line('th', 'おうこくの みんな');
    line('ln', 'モフじい ・ チャム ・ おうじょ ペロ ・ おうさま');
    line('ln', 'そして、なかなおりした わんこたち');
    line('ln', '……');
    s.fin = line('fin', 'キミへ——こころからの、ありがとう。');
    s.h = innerHeight; s.y = s.h; s.done = false; s.t = 0;
    s.stopY = 0; s.measured = false;
    roll.style.transform = 'translate3d(0,'+s.y+'px,0)';
    show(s.btn, false); show(s.skip, true); s.btn.classList.remove('show');
    s.nav = [s.skip]; s.ni = 0;
  };
  s.frame = (dt)=>{
    if(!s.measured){ s.measured = true; s.stopY = Math.round(innerHeight*0.42 - (s.fin.offsetTop + s.fin.offsetHeight*0.3)); }
    if(s.done) return;
    s.t += dt;
    const v = Math.max(38, innerHeight*0.085);
    if(s.t > 0.4) s.y -= v*dt;
    if(s.y <= s.stopY){ s.y = s.stopY; s.done = true; show(s.btn, true); s.btn.classList.add('show'); show(s.skip, false); s.nav = [s.btn]; s.ni = 0; paintKF(s); }
    roll.style.transform = 'translate3d(0,'+s.y.toFixed(1)+'px,0)';
  };
  s.key = (e, c)=>{
    if(!s.done && (c==='Enter'||c==='NumpadEnter'||c==='Space'||c==='Escape')){ if(!e.repeat) s.y = s.stopY; return true; }
    return navKey(s, c, e);
  };
}

// ================================================================ loading
function buildLoading(s){
  const p = el('div', 'lpaws', s.el); for(let i=0;i<3;i++){ const e = el('i', '', p, SVG.paw); e.style.setProperty('--i', i); }
  const t = el('div', 'hd', s.el); t.textContent = 'よみこみちゅう…'; t.style.cssText = 'font-size:1.6em;--tc:#e0662a';
}

// ================================================================ keyboard routing
const GAMEKEYS = new Set(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','KeyW','KeyA','KeyS','KeyD','KeyJ','KeyZ','KeyK','Space','KeyL','ShiftLeft','ShiftRight','KeyI','KeyX','KeyU','KeyC']);
function onKey(e){
  if(!ready) return;
  const c = e.code;
  if(GAMEKEYS.has(c) && (T.saw || !T.keyUsed)){ T.keyUsed = true; T.saw = false; touchApply(); }
  if(!kbMode){ kbMode = true; for(const n of ORDER){ if(S[n] && S[n].on){ paintKF(S[n]); break; } } }
  for(const n of ORDER){
    const s = S[n];
    if(s && s.on){ if(s.key){ try { if(s.key(e, c)) e.preventDefault(); } catch(err){ G.logError('ui.key '+n, err); } } return; }
  }
}

// ================================================================ layout
function layout(){
  if(!root) return;
  const w = Math.max(1, innerWidth), h = Math.max(1, innerHeight);
  T.R = Math.round(Math.min(56, h*0.14, w*0.14));
  T.B = Math.round(Math.min(96, h*0.235, w*0.235));
  root.style.setProperty('--r', T.R+'px'); root.style.setProperty('--b', T.B+'px');
  root.classList.toggle('port', h > w);
  root.classList.toggle('short', h <= 480 && w > h);
  // resolved safe-area paddings (custom properties can't be read back as numbers, so measure a probe)
  if(!T.probe){ T.probe = el('div', '', root); T.probe.style.cssText = 'position:absolute;left:var(--pl);top:var(--pt);right:var(--pr);bottom:var(--pb);visibility:hidden;pointer-events:none'; }
  const pr = T.probe.getBoundingClientRect(); T.inL = pr.left || 10; T.inB = (h - pr.bottom) || 8;
  emPx = parseFloat(getComputedStyle(root).fontSize) || 14;
  if(T.el) ghostPos();
  for(const s of fbs) s.vis && (s.w = s.el.offsetWidth || s.w);
}

// ================================================================ public API
function init(){
  if(ready) return;
  host = document.getElementById('ui');
  if(!host){ host = document.createElement('div'); host.id = 'ui'; host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:10'; document.body.appendChild(host); }
  const st = document.createElement('style'); st.id = 'iuStyle'; st.textContent = buildCSS(); document.head.appendChild(st);
  fbLayer = document.createElement('div'); fbLayer.id = 'iuFB'; host.insertBefore(fbLayer, host.firstChild);     // under fx popups
  root = document.createElement('div'); root.id = 'iu'; host.appendChild(root);
  try { const mq = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)'); if(mq){ reduced = mq.matches; const f = (ev)=>{ reduced = ev.matches; }; mq.addEventListener ? mq.addEventListener('change', f) : mq.addListener && mq.addListener(f); } } catch(_){}
  buildFoeBars(); buildHUD(); buildBoss(); buildGo(); buildHint(); buildTouch(); buildBanner();
  screen('title', 'title', buildTitle);
  screen('select', 'select', buildSelect);
  screen('pause', 'pause', buildPause);
  screen('result', 'result', buildResult);
  screen('over', 'over', buildOver);
  screen('ending', 'ending', buildEnding);
  screen('loading', 'loading', buildLoading);
  window.addEventListener('keydown', onKey);
  window.addEventListener('pointerdown', (e)=>{
    if(kbMode){ kbMode = false; clearKF(); }
    if(e.pointerType==='touch' || e.pointerType==='pen'){ if(!T.saw || T.keyUsed){ T.saw = true; T.keyUsed = false; touchApply(); } }
  }, true);
  G.bus.on('resize', layout);
  G.bus.on('hidden', touchReleaseAll);
  ready = true;
  layout();
  touchApply();
}
function uiShow(name, data){
  if(!ready) init();
  data = data || {};
  if(name==='hud'){ hud.on = true; hudReset(); show(hud.el, true); if(G.player) hudFrame(0); return; }
  if(!S[name]) return;
  openScreen(name, data);
}
function uiHide(name){
  if(!ready) return;
  if(name==='hud'){ hud.on = false; show(hud.el, false); hideFoeBars(); return; }
  closeScreen(name);
}
function hideAll(){
  if(!ready) return;
  for(const n in S) closeScreen(n);
  uiHide('hud');
  ban.on = false; ban.el.style.visibility = 'hidden';
  hint.on = false; hint.el.style.visibility = 'hidden';
  go(false); bossBar(null);
  touch.show(false);
}
function frame(dt){
  if(!ready) return;
  dt = (dt>0 && dt<0.25) ? dt : 1/60;
  try { portraitStep(); } catch(err){ G.logError('ui.portrait', err); }
  try { if(hud.on){ hudFrame(dt); foeBarsFrame(dt); } else if(fbAny) hideFoeBars(); } catch(err){ G.logError('ui.hud', err); }
  try { bossFrame(dt); } catch(err){ G.logError('ui.boss', err); }
  try { bannerFrame(dt); hintFrame(dt); } catch(err){ G.logError('ui.banner', err); }
  try { touchFrame(); } catch(err){ G.logError('ui.touch', err); }
  for(const n in S){ const s = S[n]; if(s.on && s.frame){ try { s.frame(dt); } catch(err){ G.logError('ui.frame '+n, err); } } }
}

G.ui = {
  init, frame,
  show: uiShow, hide: uiHide, hideAll,
  banner, bossBar, go, hint: hintShow,
  touch,
  isShown(name){ return name==='hud' ? hud.on : !!(S[name] && S[name].on); },
  // for tests: the screen's root element
  el(name){ return name==='hud' ? hud.el : name==='touch' ? T.el : S[name] ? S[name].el : null; },
};
})();

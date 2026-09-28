// 60_fx.js — エフェクト（子ども向けのアニメ／ゲーム風）。
// ・パーティクル：カメラ向きの四角をインスタンス描画。全粒子で描画コール1回（加算と通常を
//   「乗算済みアルファ」の1つの合成式で描き分ける：通常→先、加算→後の順に書き込む）。
//   形はキャンバスで描いたアトラス1枚（R=形, G=明るさ/白い芯, B=ふちどり）。
// ・武器の軌跡リボン：全員分を1つの動的メッシュにまとめて描画コール1回。
// ・飛び道具の見た目（共有ジオメトリ＋プール）。光る後光はパーティクルの描画に相乗りする。
// ・DOM：ダメージ数字・オノマトペ・「！」・フラッシュ・集中線・おうぎカットイン。
//   すべて frame(dt) で動かす（ヒットストップ中・スロー中・ポーズ中でも止まらない）。
(function(){ 'use strict';
const G = window.G; const THREE = window.THREE; const U = G.U;
const TAU = Math.PI*2;
const rnd = Math.random;
const R = (a,b)=> a + rnd()*(b-a);
const PICK = (arr)=> arr[(rnd()*arr.length)|0];
const clamp = (v,a,b)=> v<a?a:(v>b?b:v);
const smooth = (t,a,b)=>{ if(t<=a) return 0; if(t>=b) return 1; const x=(t-a)/(b-a); return x*x*(3-2*x); };
const backOut = (x)=>{ x = clamp(x,0,1)-1; return 1 + 3.5*x*x*x + 2.5*x*x; };   // 弾むポップ（最大≈1.19）
const cubicOut = (x)=>{ x = 1-clamp(x,0,1); return 1-x*x*x; };
const cubicIn = (x)=>{ x = clamp(x,0,1); return x*x*x; };
function fxs(){ return (G.quality && G.quality.fxScale) || 1; }
function cnt(n){ return Math.max(1, Math.round(n * fxs())); }

// ================================================================ colours (sRGB 0..1, そのまま出力する)
const _col = new THREE.Color();
const colCache = new Map();
function rgb(c){
  if(Array.isArray(c)) return c;
  let v = colCache.get(c);
  if(!v){
    let hx = 0xffffff;
    try { _col.set(c==null ? 0xffffff : c); hx = _col.getHex(); } catch(_){}
    v = [((hx>>16)&255)/255, ((hx>>8)&255)/255, (hx&255)/255];
    colCache.set(c, v);
  }
  return v;
}
function css(c, t, to){ // 色を白(to='w')か黒('k')へ t だけ寄せた CSS 文字列
  const v = rgb(c), w = to==='k' ? 0 : 1; t = t||0;
  return 'rgb('+Math.round((v[0]+(w-v[0])*t)*255)+','+Math.round((v[1]+(w-v[1])*t)*255)+','+Math.round((v[2]+(w-v[2])*t)*255)+')';
}
const CONFETTI = ['#ff5a8a','#ffd23a','#4ad0ff','#7de86a','#b58aff','#ff9a3a','#ffffff'];
const FIREWORK = ['#ff5a8a','#ffd23a','#4ad0ff','#7dff8a','#c58aff','#ff9a3a','#ff7ad8'];

// 攻撃の種類ごとの色とオノマトペ（最後の1つは power 3 用）
const KIND = {
  slash:  { main:'#fff1a0', sub:'#ffffff', oc:'#4ab8ff', ono:['ズバッ！','スパッ！','シャキーン！'] },
  blunt:  { main:'#ff9a2e', sub:'#ffd23a', oc:'#ff7a1a', ono:['ドカッ！','ボコッ！','ドッカーン！'] },
  magic:  { main:'#ff6ad5', sub:'#b58aff', oc:'#d86aff', ono:['キラーン！','ピカッ！','マジカル〜ン！'] },
  ice:    { main:'#6fe6ff', sub:'#e8fdff', oc:'#2aa8ff', ono:['カチーン！','ピキッ！','カッチーン！'] },
  fire:   { main:'#ff8a2a', sub:'#ffd23a', oc:'#ff5a1a', ono:['ボワッ！','メラッ！','ボワワーン！'] },
  thunder:{ main:'#ffe23a', sub:'#fffbe0', oc:'#f0a000', ono:['ビリッ！','バチッ！','ピシャーン！'] },
  star:   { main:'#ffd23a', sub:'#fff6b0', oc:'#ffae00', ono:['キラッ！','ピカッ！','キラリーン！'] },
  pop:    { main:'#ff7ab8', sub:'#7de0ff', oc:'#ff4a9a', ono:['ポンッ！','パンッ！','パッパーン！'] },
  wind:   { main:'#9dffd0', sub:'#ffffff', oc:'#22c8a0', ono:['ビュッ！','ヒュン！','ビュオーン！'] },
};
// ヒーローの色（G.heroes が無い・色が無いときの予備）
const HERO_COL = { inu:'#ff6b5a', shima:'#ff9f2e', nuko:'#b48ae0', guard8:'#5fa0ff', watch:'#e8415a', wanden:'#d0463e', mack:'#f0a02a' };
// 軌跡の色（刃・拳の色。明るい背景でも見える彩度）
const TRAIL_COL = { inu:'#6fd0ff', shima:'#ffb347', nuko:'#d08aff', guard8:'#ffcf5a', watch:'#ff6a8a', wanden:'#ff7a6a', mack:'#ffd23a' };
function heroInfo(id){ try { return (G.heroes && G.heroes.get) ? G.heroes.get(id) : null; } catch(_){ return null; } }
function hexOf(c){ return typeof c==='number' ? '#'+c.toString(16).padStart(6,'0') : c; }
function heroColor(id){ const h = heroInfo(id); return hexOf(h && h.color) || HERO_COL[id] || '#ff7ab8'; }

// ================================================================ atlas (8×4 tiles, 128px)
const ACOLS = 8, AROWS = 4, TS = 128, C = 64;
const T = { glow:0, star:1, spark:2, heart:3, ring:4, puff:5, conf:6, note:7,
            paw:8, streak:9, shard:10, bolt:11, impact:12, crescent:13, flame:14, dot:15,
            plus:16, flare:17, wave:18, note2:19, swirl:20, petal:21, wisp:22, bubble:23 };

function pStar(o, cx, cy, Ro, ri, n, a0){ o.beginPath(); for(let i=0;i<n*2;i++){ const a=a0+i*Math.PI/n, rr=(i&1)?ri:Ro; const x=cx+Math.cos(a)*rr, y=cy+Math.sin(a)*rr; if(i) o.lineTo(x,y); else o.moveTo(x,y); } o.closePath(); }
function pHeart(o, cx, cy, s){ o.beginPath(); o.moveTo(cx, cy+s*0.92);
  o.bezierCurveTo(cx+s*1.3, cy+s*0.02, cx+s*0.95, cy-s*1.1, cx, cy-s*0.42);
  o.bezierCurveTo(cx-s*0.95, cy-s*1.1, cx-s*1.3, cy+s*0.02, cx, cy+s*0.92); o.closePath(); }
function pSpark(o, Rr, k){ o.beginPath(); o.moveTo(C, C-Rr); o.quadraticCurveTo(C+k, C-k, C+Rr, C); o.quadraticCurveTo(C+k, C+k, C, C+Rr);
  o.quadraticCurveTo(C-k, C+k, C-Rr, C); o.quadraticCurveTo(C-k, C-k, C, C-Rr); o.closePath(); }
function pFlame(o, cx, cy, s){ o.beginPath(); o.moveTo(cx+4*s, cy-54*s);
  o.bezierCurveTo(cx+14*s, cy-30*s, cx+36*s, cy-16*s, cx+36*s, cy+12*s);
  o.bezierCurveTo(cx+36*s, cy+36*s, cx+18*s, cy+50*s, cx, cy+50*s);
  o.bezierCurveTo(cx-18*s, cy+50*s, cx-36*s, cy+36*s, cx-36*s, cy+12*s);
  o.bezierCurveTo(cx-36*s, cy-10*s, cx-18*s, cy-22*s, cx-10*s, cy-36*s);
  o.bezierCurveTo(cx-6*s, cy-44*s, cx-2*s, cy-50*s, cx+4*s, cy-54*s); o.closePath(); }
function pPoly(o, pts){ o.beginPath(); for(let i=0;i<pts.length;i+=2){ if(i) o.lineTo(pts[i],pts[i+1]); else o.moveTo(pts[i],pts[i+1]); } o.closePath(); }
function rr(o,x,y,w,h,r){ o.moveTo(x+r,y); o.arcTo(x+w,y,x+w,y+h,r); o.arcTo(x+w,y+h,x,y+h,r); o.arcTo(x,y+h,x,y,r); o.arcTo(x,y,x+w,y,r); o.closePath(); }
// silhouette helpers: sil(o, grow) draws the shape grown by `grow` px
const silPath = (path, base)=> (o,g)=>{ path(o); o.fill(); const w=2*((base||0)+g); if(w>0){ o.lineWidth=w; o.stroke(); } };
const silCircles = (list)=> (o,g)=>{ o.beginPath(); for(const c of list){ o.moveTo(c[0]+c[2]+g, c[1]); o.arc(c[0],c[1],c[2]+g,0,TAU); } o.fill(); };
const IMP_O = [48,40,46,39,48,41,45,39,47,40,46,39];
function pImpact(o, k){ o.beginPath(); for(let i=0;i<24;i++){ const a=-Math.PI/2+i/24*TAU; const r=(i&1) ? (27+(i%3))*k : IMP_O[i>>1]*k; const x=C+Math.cos(a)*r, y=C+Math.sin(a)*r; if(i) o.lineTo(x,y); else o.moveTo(x,y); } o.closePath(); }
const BOLT = [72,8, 34,70, 60,70, 46,120, 96,52, 68,52, 88,8].map(v=> 64+(v-64)*0.85);
const PUFF = [[64,74,30],[38,76,20],[90,76,20],[46,52,22],[80,50,24],[62,36,20]];
const TOES = [[34,54,11],[52,36,12],[76,36,12],[94,54,11]];

function buildAtlas(){
  const W = ACOLS*TS, H = AROWS*TS;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const X = cv.getContext('2d'); X.fillStyle = '#000'; X.fillRect(0,0,W,H);
  const off = document.createElement('canvas'); off.width = off.height = TS;
  const o = off.getContext('2d');
  const CH = { r:'#ff0000', g:'#00ff00', b:'#0000ff' };
  // draw white shapes on a transparent tile, then add them into one colour channel of the atlas
  function L(tile, ch, draw){
    o.setTransform(1,0,0,1,0,0); o.globalCompositeOperation='source-over'; o.globalAlpha=1; o.clearRect(0,0,TS,TS);
    o.fillStyle='#fff'; o.strokeStyle='#fff'; o.lineJoin='round'; o.lineCap='round';
    o.save(); draw(o); o.restore();
    o.setTransform(1,0,0,1,0,0); o.globalAlpha=1; o.globalCompositeOperation='source-in'; o.fillStyle=CH[ch]; o.fillRect(0,0,TS,TS);
    o.globalCompositeOperation='source-over';
    X.globalCompositeOperation='lighter'; X.drawImage(off, (tile%ACOLS)*TS, ((tile/ACOLS)|0)*TS); X.globalCompositeOperation='source-over';
  }
  const radial = (o, cx, cy, r, stops)=>{ const g=o.createRadialGradient(cx,cy,0,cx,cy,r); for(const s of stops) g.addColorStop(s[0], 'rgba(255,255,255,'+s[1]+')'); o.fillStyle=g; o.fillRect(0,0,TS,TS); };
  const vgrad = (o, top, bot)=>{ const g=o.createLinearGradient(0,12,0,116); g.addColorStop(0,'rgba(255,255,255,'+top+')'); g.addColorStop(1,'rgba(255,255,255,'+bot+')'); o.fillStyle=g; o.strokeStyle=g; };
  // 3-channel shape: R = silhouette, G = shading (vertical gradient + white highlight), B = outline ring
  function shape(tile, sil, top, bot, hl, outline){
    L(tile, 'r', o=> sil(o, 1));
    L(tile, 'g', o=>{ vgrad(o, top, bot); sil(o, 0); if(hl){ o.fillStyle='#fff'; o.strokeStyle='#fff'; hl(o); } });
    if(outline) L(tile, 'b', o=>{ sil(o, outline); o.globalCompositeOperation='destination-out'; sil(o, 0); });
  }
  const ell = (x,y,rx,ry,a)=> (o)=>{ o.beginPath(); o.ellipse(x,y,rx,ry,a||0,0,TAU); o.fill(); };

  // 0 glow
  L(T.glow,'r', o=> radial(o,C,C,62,[[0,1],[0.18,0.8],[0.4,0.36],[0.7,0.09],[1,0]]));
  L(T.glow,'g', o=> radial(o,C,C,62,[[0,1],[0.15,0.85],[0.35,0.3],[0.6,0]]));
  // 1 star (rounded, outlined, white core)
  const silStar = silPath(o=> pStar(o,C,C+4,40,19,5,-Math.PI/2), 5);
  shape(T.star, silStar, 0.62, 0.34, o=>{ const g=o.createRadialGradient(C-6,C-2,0,C-6,C-2,24); g.addColorStop(0,'rgba(255,255,255,1)'); g.addColorStop(1,'rgba(255,255,255,0)'); o.fillStyle=g; o.beginPath(); o.arc(C-6,C-2,24,0,TAU); o.fill(); }, 6);
  // 2 sparkle (4-point twinkle)
  L(T.spark,'r', o=>{ pSpark(o,56,8); o.fill(); radial(o,C,C,34,[[0,0.5],[1,0]]); });
  L(T.spark,'g', o=>{ o.globalAlpha=0.5; pSpark(o,56,8); o.fill(); o.globalAlpha=1; radial(o,C,C,24,[[0,1],[0.5,0.7],[1,0]]); });
  L(T.spark,'b', o=>{ o.lineWidth=7; pSpark(o,54,8); o.stroke(); o.globalCompositeOperation='destination-out'; pSpark(o,54,8); o.fill(); });
  // 3 heart
  const silHeart = silPath(o=> pHeart(o,C,C+2,46), 0);
  shape(T.heart, silHeart, 0.62, 0.36, ell(44,46,10,7,-0.6), 6);
  // 4 ring
  L(T.ring,'r', o=>{ o.beginPath(); o.arc(C,C,50,0,TAU); o.globalAlpha=0.35; o.lineWidth=11; o.stroke(); o.globalAlpha=0.7; o.lineWidth=7; o.stroke(); o.globalAlpha=1; o.lineWidth=3.5; o.stroke(); });
  L(T.ring,'g', o=>{ o.beginPath(); o.arc(C,C,50,0,TAU); o.lineWidth=2.5; o.globalAlpha=0.9; o.stroke(); });
  // 5 puff cloud
  const silPuff = silCircles(PUFF);
  shape(T.puff, silPuff, 0.95, 0.3, o=>{ o.globalAlpha=0.9; ell(50,44,10,7,-0.5)(o); ell(76,40,8,5,-0.4)(o); }, 5);
  // 6 confetti
  L(T.conf,'r', o=>{ o.beginPath(); rr(o,26,43,76,42,6); o.fill(); });
  L(T.conf,'g', o=>{ o.globalAlpha=0.55; o.beginPath(); rr(o,26,43,76,42,6); o.fill(); o.globalAlpha=0.95; o.fillRect(30,46,68,9); });
  // 7 note ♪
  const silNote = (o,g)=>{ o.beginPath(); o.ellipse(48,90,21+g,15+g,-0.45,0,TAU); o.fill(); o.beginPath(); o.rect(62-g,22-g,10+2*g,70+g); o.fill();
    o.lineWidth=10+2*g; o.beginPath(); o.moveTo(67,26); o.bezierCurveTo(80,32,100,44,90,70); o.stroke(); };
  shape(T.note, silNote, 0.6, 0.38, ell(42,84,7,5,-0.5), 5);
  // 8 paw
  const silPaw = (o,g)=>{ o.beginPath(); o.ellipse(64,84,27+g,22+g,0,0,TAU); for(const t of TOES){ o.moveTo(t[0]+t[2]+g,t[1]); o.arc(t[0],t[1],t[2]+g,0,TAU); } o.fill(); };
  shape(T.paw, silPaw, 0.62, 0.38, o=>{ ell(54,76,8,5,-0.4)(o); ell(50,32,3,2)(o); ell(72,32,3,2)(o); }, 5);
  // 9 streak (speed line, head at +x)
  L(T.streak,'r', o=>{ o.beginPath(); o.moveTo(6,C); o.quadraticCurveTo(84,8,122,C); o.quadraticCurveTo(84,120,6,C); o.fill();
    o.globalCompositeOperation='source-in'; const g=o.createLinearGradient(6,0,122,0); g.addColorStop(0,'rgba(255,255,255,0)'); g.addColorStop(0.7,'rgba(255,255,255,0.9)'); g.addColorStop(1,'rgba(255,255,255,1)'); o.fillStyle=g; o.fillRect(0,0,TS,TS); });
  L(T.streak,'g', o=>{ const g=o.createLinearGradient(40,0,120,0); g.addColorStop(0,'rgba(255,255,255,0)'); g.addColorStop(1,'rgba(255,255,255,1)'); o.fillStyle=g; o.beginPath(); o.moveTo(40,C); o.quadraticCurveTo(90,36,120,C); o.quadraticCurveTo(90,92,40,C); o.fill(); });
  // 10 shard (ice)
  const SH = [64,14, 84,62, 64,114, 44,62];
  const silShard = silPath(o=> pPoly(o,SH), 0);
  L(T.shard,'r', o=> silShard(o,1));
  L(T.shard,'g', o=>{ o.globalAlpha=0.42; silShard(o,0); o.globalAlpha=0.95; pPoly(o,[64,14,64,114,44,62]); o.fill(); });
  L(T.shard,'b', o=>{ silShard(o,5); o.globalCompositeOperation='destination-out'; silShard(o,0); });
  // 11 bolt
  const silBolt = silPath(o=> pPoly(o,BOLT), 2);
  shape(T.bolt, silBolt, 0.72, 0.5, o=>{ o.globalAlpha=0.9; o.lineWidth=5; o.beginPath(); o.moveTo(BOLT[0]-2,BOLT[1]+8); o.lineTo(BOLT[2]+10,BOLT[3]-4); o.stroke(); }, 5);
  // 12 impact (comic burst: coloured outer, white inner, outline)
  L(T.impact,'r', o=>{ pImpact(o,1); o.fill(); o.lineWidth=2; o.stroke(); });
  L(T.impact,'g', o=>{ o.globalAlpha=0.5; pImpact(o,1); o.fill(); o.globalAlpha=1; pImpact(o,0.62); o.fill(); });
  L(T.impact,'b', o=>{ pImpact(o,1); o.fill(); o.lineWidth=10; o.stroke(); o.globalCompositeOperation='destination-out'; pImpact(o,1); o.fill(); });
  // 13 crescent (slash arc, bulging to +x)
  const cres = (o)=>{ o.beginPath(); o.arc(50,C,52,0,TAU); o.fill(); o.globalCompositeOperation='destination-out'; o.beginPath(); o.arc(30,C,50,0,TAU); o.fill(); o.globalCompositeOperation='source-in'; };
  L(T.crescent,'r', o=>{ cres(o); const g=o.createRadialGradient(50,C,0,50,C,52); g.addColorStop(0.55,'rgba(255,255,255,0.15)'); g.addColorStop(0.9,'rgba(255,255,255,1)'); g.addColorStop(1,'rgba(255,255,255,1)'); o.fillStyle=g; o.fillRect(0,0,TS,TS); });
  L(T.crescent,'g', o=>{ cres(o); const g=o.createRadialGradient(50,C,0,50,C,52); g.addColorStop(0.8,'rgba(255,255,255,0.3)'); g.addColorStop(0.93,'rgba(255,255,255,1)'); g.addColorStop(1,'rgba(255,255,255,1)'); o.fillStyle=g; o.fillRect(0,0,TS,TS); });
  // 14 flame (cute teardrop, yellow core)
  const silFlame = silPath(o=> pFlame(o,C,66,0.92), 0);
  shape(T.flame, silFlame, 0.5, 0.5, o=>{ pFlame(o,C,84,0.48); o.fill(); }, 5);
  // 15 dot / candy ball
  const silDot = silCircles([[C,C,44]]);
  shape(T.dot, silDot, 0.64, 0.34, ell(48,46,12,8,-0.6), 5);
  // 16 plus (heal)
  const silPlus = (o,g)=>{ o.beginPath(); rr(o,48-g,18-g,32+2*g,92+2*g,12+g); rr(o,18-g,48-g,92+2*g,32+2*g,12+g); o.fill(); };
  shape(T.plus, silPlus, 0.66, 0.4, ell(56,30,5,9,0), 5);
  // 17 flare (4-ray lens twinkle)
  const ray = (o, a, len, wid)=>{ const c=Math.cos(a), s=Math.sin(a); o.beginPath(); o.moveTo(C+c*len, C+s*len); o.lineTo(C-s*wid, C+c*wid); o.lineTo(C-c*len, C-s*len); o.lineTo(C+s*wid, C-c*wid); o.closePath(); o.fill(); };
  L(T.flare,'r', o=>{ ray(o,0,58,6); ray(o,Math.PI/2,58,6); ray(o,Math.PI/4,30,4); ray(o,-Math.PI/4,30,4);
    o.globalCompositeOperation='source-in'; radial(o,C,C,58,[[0,1],[0.5,0.8],[1,0.1]]); o.globalCompositeOperation='source-over'; radial(o,C,C,26,[[0,0.8],[1,0]]); });
  L(T.flare,'g', o=> radial(o,C,C,20,[[0,1],[0.6,0.6],[1,0]]));
  // 18 wave (thick soft shock ring)
  L(T.wave,'r', o=> radial(o,C,C,58,[[0,0],[0.55,0],[0.75,0.35],[0.87,1],[0.94,0.5],[1,0]]));
  L(T.wave,'g', o=>{ o.globalAlpha=0.9; o.lineWidth=3; o.beginPath(); o.arc(C,C,50,0,TAU); o.stroke(); });
  // 19 note2 ♫
  const silNote2 = (o,g)=>{ o.beginPath(); o.ellipse(36,92,18+g,13+g,-0.4,0,TAU); o.fill(); o.beginPath(); o.ellipse(86,82,18+g,13+g,-0.4,0,TAU); o.fill();
    o.beginPath(); o.rect(46-g,30-g,8+2*g,62+g); o.rect(96-g,20-g,8+2*g,62+g); o.fill();
    pPoly(o,[46,28,104,18,104,32,46,42]); o.fill(); if(g>0){ o.lineWidth=2*g; o.stroke(); } };
  shape(T.note2, silNote2, 0.6, 0.38, o=>{ ell(30,88,5,4,-0.5)(o); ell(80,78,5,4,-0.5)(o); }, 5);
  // 20 swirl
  L(T.swirl,'r', o=>{ o.lineWidth=9; o.beginPath(); for(let t=0;t<=10.5;t+=0.15){ const r=3+t*4.0, x=C+Math.cos(t)*r, y=C+Math.sin(t)*r; if(t) o.lineTo(x,y); else o.moveTo(x,y); } o.stroke(); });
  L(T.swirl,'g', o=>{ o.globalAlpha=0.7; o.fillRect(0,0,TS,TS); });
  // 21 petal
  const silPetal = silPath(o=>{ o.beginPath(); o.moveTo(64,114); o.bezierCurveTo(24,94,24,40,48,16); o.lineTo(64,30); o.lineTo(80,16); o.bezierCurveTo(104,40,104,94,64,114); o.closePath(); }, 0);
  shape(T.petal, silPetal, 0.5, 0.75, null, 3);
  // 22 wisp (soft smoke)
  L(T.wisp,'r', o=>{ for(const b of [[52,72,36],[78,62,32],[62,46,28]]){ const g=o.createRadialGradient(b[0],b[1],0,b[0],b[1],b[2]); g.addColorStop(0,'rgba(255,255,255,0.85)'); g.addColorStop(1,'rgba(255,255,255,0)'); o.fillStyle=g; o.fillRect(0,0,TS,TS); } });
  L(T.wisp,'g', o=>{ o.globalAlpha=0.32; o.fillRect(0,0,TS,TS); });
  // 23 bubble
  L(T.bubble,'r', o=>{ o.globalAlpha=0.18; o.beginPath(); o.arc(C,C,44,0,TAU); o.fill(); o.globalAlpha=1; o.lineWidth=5; o.stroke(); });
  L(T.bubble,'g', o=>{ o.globalAlpha=0.6; o.lineWidth=5; o.beginPath(); o.arc(C,C,44,0,TAU); o.stroke(); o.globalAlpha=1; o.lineWidth=6; o.beginPath(); o.arc(C,C,33,3.5,4.4); o.stroke(); ell(46,40,4,4)(o); });

  const tex = new THREE.CanvasTexture(cv);
  tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = 1; tex.needsUpdate = true;
  return { tex, canvas: cv };
}

// ================================================================ particle system
// SoA pool. Sizes are world units, velocities units/frame, times in frames (60 Hz).
const MAXP = 600, HALO_MAX = 64, CAP = MAXP + HALO_MAX;
const F_FLUTTER=1, F_FLOOR=2, F_VALIGN=4, F_TWINK=8, F_WOB=16, F_TRAILER=32, F_REST=64, F_STRETCH=128, F_FLIP=256;
const px=new Float32Array(MAXP), py=new Float32Array(MAXP), pz=new Float32Array(MAXP);
const qx=new Float32Array(MAXP), qy=new Float32Array(MAXP), qz=new Float32Array(MAXP);     // velocity
const grav=new Float32Array(MAXP), drag=new Float32Array(MAXP), s0=new Float32Array(MAXP), s1=new Float32Array(MAXP);
const asp=new Float32Array(MAXP), rot=new Float32Array(MAXP), spin=new Float32Array(MAXP);
const cr=new Float32Array(MAXP), cg=new Float32Array(MAXP), cb=new Float32Array(MAXP), ca=new Float32Array(MAXP);
const fin=new Float32Array(MAXP), fout=new Float32Array(MAXP), life=new Float32Array(MAXP), age=new Float32Array(MAXP);
const wob=new Float32Array(MAXP), ph=new Float32Array(MAXP), str=new Float32Array(MAXP), addv=new Float32Array(MAXP);
const tile=new Uint8Array(MAXP), curve=new Uint8Array(MAXP), flags=new Uint16Array(MAXP);
const ARRS = [px,py,pz,qx,qy,qz,grav,drag,s0,s1,asp,rot,spin,cr,cg,cb,ca,fin,fout,life,age,wob,ph,str,addv,tile,curve,flags];
let np = 0, capP = MAXP;
function copyP(d, s){ for(let k=0;k<ARRS.length;k++){ const a=ARRS[k]; a[d]=a[s]; } }

// spawn spec (one reused object — no allocation per particle)
// curve: 0 linear s0→s1, 1 pop (overshoot in, then ease to s1), 2 fast-out s0→s1, 3 bell (s0·sin πt), 4 hold then s1
const S = {};
function sp(t, x, y, z){
  S.tile=t; S.x=x; S.y=y; S.z=z; S.vx=0; S.vy=0; S.vz=0; S.grav=0; S.drag=0;
  S.s0=0.3; S.s1=0.3; S.curve=0; S.asp=1; S.rot=0; S.spin=0;
  S.r=1; S.g=1; S.b=1; S.a=1; S.fin=0; S.fout=0.35; S.life=30; S.add=0; S.flags=0; S.wob=0; S.str=0; S.delay=0;
  return S;
}
function sc_(c){ const v=rgb(c); S.r=v[0]; S.g=v[1]; S.b=v[2]; }
function emit(){
  if(np >= capP) return -1;
  const i = np++;
  px[i]=S.x; py[i]=S.y; pz[i]=S.z; qx[i]=S.vx; qy[i]=S.vy; qz[i]=S.vz; grav[i]=S.grav; drag[i]=S.drag;
  s0[i]=S.s0; s1[i]=S.s1; asp[i]=S.asp; rot[i]=S.rot; spin[i]=S.spin; cr[i]=S.r; cg[i]=S.g; cb[i]=S.b; ca[i]=S.a;
  fin[i]=S.fin; fout[i]=S.fout; life[i]=Math.max(1,S.life); age[i]=-(S.delay||0); wob[i]=S.wob; ph[i]=rnd()*TAU; str[i]=S.str;
  addv[i]=S.add; tile[i]=S.tile; curve[i]=S.curve; flags[i]=S.flags;
  return i;
}

function updateParticles(k){
  let i = 0;
  while(i < np){
    const a0 = age[i], ag = a0 + k;
    if(ag >= life[i]){ np--; if(i<np) copyP(i, np); continue; }
    age[i] = ag;
    if(ag < 0){ i++; continue; }               // still waiting (delay)
    const f = flags[i];
    const dv = drag[i]; if(dv>0){ const m = 1/(1+dv*k); qx[i]*=m; qy[i]*=m; qz[i]*=m; }
    qy[i] += grav[i]*k;
    if(f & F_FLUTTER && qy[i] < -0.032) qy[i] += (-0.032 - qy[i])*Math.min(1, 0.25*k);   // paper falls slowly
    px[i] += qx[i]*k; py[i] += qy[i]*k; pz[i] += qz[i]*k;
    if(f & F_FLOOR && py[i] < 0.03 && qy[i] < 0){
      py[i] = 0.03; qy[i] = -qy[i]*0.25; qx[i]*=0.5; qz[i]*=0.5; spin[i]*=0.4;
      if(qy[i] < 0.012){ qy[i]=0; qx[i]=0; qz[i]=0; grav[i]=0; spin[i]=0; flags[i] = f | F_REST; }
    }
    rot[i] += spin[i]*k;
    if(f & F_TRAILER && ((ag/3)|0) !== ((Math.max(0,a0)/3)|0) && np < capP){
      const x=px[i], y=py[i], z=pz[i], r=cr[i], g=cg[i], b=cb[i];
      sp(T.glow, x, y, z); S.s0=0.2; S.s1=0.05; S.life=16; S.add=0.6; S.a=0.8; S.fout=0.8; S.r=r; S.g=g; S.b=b; S.vy=-0.004; emit();
    }
    i++;
  }
}

// instance buffers
let AP=null, AS=null, AC=null, attrP=null, attrS=null, attrC=null, pGeo=null, pMat=null, pMesh=null, atlas=null;
function put(j, x,y,z, ro, w,h, t, ad, r,g,b,a){
  const o=j*4;
  AP[o]=x; AP[o+1]=y; AP[o+2]=z; AP[o+3]=ro;
  AS[o]=w; AS[o+1]=h; AS[o+2]=t; AS[o+3]=ad;
  AC[o]=r; AC[o+1]=g; AC[o+2]=b; AC[o+3]=a;
}
let camRX=1, camRY=0, camRZ=0, camUX=0, camUY=1, camUZ=0;
function writeParticles(j, pass){
  for(let i=0;i<np;i++){
    const ag = age[i]; if(ag < 0) continue;
    const ad = addv[i]; if((ad >= 0.5 ? 1 : 0) !== pass) continue;
    if(j >= CAP) return j;
    const t = ag/life[i];
    const a0 = s0[i], a1 = s1[i];
    let s;
    switch(curve[i]){
      case 1: if(t < 0.16) s = a0*backOut(t/0.16); else { const q=(t-0.16)/0.84; s = a0 + (a1-a0)*q*q; } break;
      case 2: { const q=1-t; s = a0 + (a1-a0)*(1-q*q*q); } break;
      case 3: s = a0*Math.sin(Math.PI*t); break;
      case 4: s = t < 0.7 ? a0 : a0 + (a1-a0)*(t-0.7)/0.3; break;
      default: s = a0 + (a1-a0)*t;
    }
    let a = ca[i];
    const fi = fin[i]; if(fi>0 && t<fi) a *= t/fi;
    const fo = fout[i]; if(fo>0 && t>1-fo) a *= (1-t)/fo;
    const f = flags[i];
    if(f & F_TWINK) a *= 0.55 + 0.45*Math.sin(ag*0.9 + ph[i]);
    if(a <= 0.003 || s <= 0.001) continue;
    let w = s, h = s*asp[i], ro = rot[i], X = px[i];
    if(f & F_FLUTTER && !(f & F_REST)) w *= 0.2 + 0.8*Math.abs(Math.cos(ag*0.21 + ph[i]));
    if(f & F_WOB) X += Math.sin(ag*0.11 + ph[i]) * wob[i];
    if(f & (F_VALIGN|F_STRETCH)){
      const vx=qx[i], vy=qy[i], vz=qz[i];
      const sx = vx*camRX + vy*camRY + vz*camRZ, sy = vx*camUX + vy*camUY + vz*camUZ;
      if(f & F_VALIGN) ro = Math.atan2(sy, sx) + rot[i];
      if(f & F_STRETCH) w *= 1 + Math.sqrt(sx*sx+sy*sy)*str[i];
    }
    if(f & F_FLIP) w = -w;
    put(j++, X, py[i], pz[i], ro, w, h, tile[i], ad, cr[i], cg[i], cb[i], a);
  }
  return j;
}

const PVS = [
  'attribute vec4 aPos; attribute vec4 aSize; attribute vec4 aCol;',
  'uniform float uBias;',
  'varying vec2 vUv; varying vec4 vCol; varying float vAdd;',
  'void main(){',
  '  vec4 mv = modelViewMatrix * vec4(aPos.xyz, 1.0);',
  '  float c = cos(aPos.w), s = sin(aPos.w);',
  '  vec2 q = position.xy * aSize.xy;',
  '  mv.xy += vec2(c*q.x - s*q.y, s*q.x + c*q.y);',
  '  mv.z += uBias;',                                   // nudge toward the camera so sparks sit in front of the body
  '  gl_Position = projectionMatrix * mv;',
  '  float col = mod(aSize.z, 8.0), row = floor(aSize.z/8.0 + 0.001);',
  '  vec2 l = vec2(uv.x, 1.0 - uv.y) * 0.94 + 0.03;',    // inset: no bleeding from the neighbour tile
  '  vUv = vec2((col + l.x)/8.0, 1.0 - (row + l.y)/4.0);',
  '  vCol = aCol; vAdd = aSize.w;',
  '}'].join('\n');
const PFS = [
  'uniform sampler2D uMap;',
  'varying vec2 vUv; varying vec4 vCol; varying float vAdd;',
  'void main(){',
  '  vec3 t = texture2D(uMap, vUv).rgb;',
  '  float m = max(t.r, t.b);',
  '  float a = m * vCol.a;',
  '  if(a < 0.003) discard;',
  '  vec3 c = vCol.rgb;',
  '  vec3 rgb = t.g < 0.5 ? mix(c*0.72, c, t.g*2.0) : mix(c, vec3(1.0), (t.g-0.5)*1.8);',
  '  vec3 line = mix(c*0.34, vec3(0.23,0.14,0.09), 0.35);',
  '  rgb = mix(rgb, line, clamp(t.b / max(m, 0.001), 0.0, 1.0));',
  '  gl_FragColor = vec4(rgb * a, a * (1.0 - vAdd));',   // premultiplied: add=1 → additive, add=0 → normal blend
  '}'].join('\n');

function buildParticles(){
  atlas = buildAtlas();
  const base = new THREE.PlaneGeometry(1,1);
  pGeo = new THREE.InstancedBufferGeometry();
  pGeo.setIndex(base.index); pGeo.setAttribute('position', base.attributes.position); pGeo.setAttribute('uv', base.attributes.uv);
  AP = new Float32Array(CAP*4); AS = new Float32Array(CAP*4); AC = new Float32Array(CAP*4);
  attrP = new THREE.InstancedBufferAttribute(AP, 4); attrP.setUsage(THREE.DynamicDrawUsage);
  attrS = new THREE.InstancedBufferAttribute(AS, 4); attrS.setUsage(THREE.DynamicDrawUsage);
  attrC = new THREE.InstancedBufferAttribute(AC, 4); attrC.setUsage(THREE.DynamicDrawUsage);
  pGeo.setAttribute('aPos', attrP); pGeo.setAttribute('aSize', attrS); pGeo.setAttribute('aCol', attrC);
  pGeo.instanceCount = 0;
  pMat = new THREE.ShaderMaterial({
    uniforms: { uMap:{ value: atlas.tex }, uBias:{ value: 0.45 } },
    vertexShader: PVS, fragmentShader: PFS,
    transparent: true, depthWrite: false, depthTest: true, side: THREE.DoubleSide,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
  });
  pMesh = new THREE.Mesh(pGeo, pMat);
  pMesh.frustumCulled = false; pMesh.renderOrder = 30; pMesh.visible = false; pMesh.name = 'fxParticles';
}
function markAttr(a, n){
  if(a.clearUpdateRanges){ a.clearUpdateRanges(); a.addUpdateRange(0, n*4); }
  else if(a.updateRange){ a.updateRange.offset = 0; a.updateRange.count = n*4; }
  a.needsUpdate = true;
}

// ================================================================ projectiles
// Each kind: mesh() → Mesh|null (shared geometry/material, built once), halos (glow billboards drawn by the
// particle mesh — no extra draw call), tick(h, p, face) spins/pulses and emits small trail particles.
let fxT = 0;                 // real frames since init (drives halo pulse/spin)
const liveProj = [];
const projPool = {};
const shared = new Map();
function once(key, make){ let v = shared.get(key); if(!v){ v = make(); shared.set(key, v); } return v; }
function basicMat(key, color, extra){ return once('m:'+key, ()=>{ const m = new THREE.MeshBasicMaterial(Object.assign({ color: new THREE.Color(color) }, extra||{})); m.userData.shared = true; return m; }); }
function built(key, fill, opts){   // PartBuilder geometry (cached)
  return once('g:'+key, ()=>{ const b = G.look.builder(); fill(b, G.look.geo); const g = b.build(); g.userData.shared = true; return g; });
}
function toyMesh(geo, mat, outline){
  const m = new THREE.Mesh(geo, mat); m.castShadow = false;
  if(outline && G.look.outline) G.look.outline(m, outline, '#3b2417');
  return m;
}
const HL = (tile, size, color, a, add, extra)=> Object.assign({ tile, size, color, a, add, c:null }, extra||{});
const PDEF = {
  wave: { mesh:null,
    halos:[ HL(T.glow,1.5,'#6fd0ff',0.35,0.6), HL(T.crescent,1.3,'#4ac0ff',0.95,0.45,{asp:1.35,flip:1,pulse:0.06}), HL(T.crescent,1.0,'#ffffff',0.95,1,{asp:1.25,flip:1,ox:0.05}) ],
    tick(h,p,f){ if(h.age%2===0){ sp(T.crescent, p.x - f*0.2, p.y, p.z); S.s0=1.0; S.s1=0.7; S.asp=1.3; S.life=9; S.add=1; S.a=0.55; S.fout=1; S.flags = f<0?F_FLIP:0; sc_('#8fe0ff'); emit(); }
      sp(T.spark, p.x - f*R(0.1,0.5), p.y + R(-0.55,0.55), p.z + R(-0.1,0.1)); S.s0=R(0.14,0.26); S.curve=3; S.life=R(14,22); S.add=1; S.vx=-f*0.01; sc_(PICK(['#ffffff','#bff0ff'])); emit(); } },
  star: { mesh:()=> toyMesh(G.look.geo.star(0.26,0.5,0.12), G.look.mat('#ffd23a',{rough:0.35, emissive:'#ff9a00', emissiveIntensity:0.35}), 0.02),
    halos:[ HL(T.glow,1.1,'#ffe066',0.5,1,{pulse:0.08}) ],
    tick(h,p,f){ h.mesh.rotation.z -= 0.28*f; if(h.age%2===0){ sp(T.spark, p.x - f*0.2, p.y + R(-0.15,0.15), p.z); S.s0=R(0.16,0.28); S.curve=3; S.life=18; S.add=1; S.vy=R(-0.01,0.01); sc_(PICK(['#fff3a0','#ffd23a','#ffffff'])); emit(); } } },
  ball: { mesh:()=> toyMesh(G.look.geo.sphere(0.19,16,12), basicMat('ball','#eafcff')),
    halos:[ HL(T.glow,1.3,'#2a9cff',0.9,0.45,{pulse:0.1}), HL(T.ring,0.8,'#6fd0ff',0.9,0.6,{spin:0.25}), HL(T.glow,0.55,'#ffffff',0.8,1) ],
    tick(h,p,f){ sp(T.spark, p.x - f*R(0.1,0.3), p.y + R(-0.2,0.2), p.z + R(-0.1,0.1)); S.s0=R(0.14,0.26); S.curve=3; S.life=16; S.add=1; S.vx=-f*0.015; sc_(PICK(['#bff0ff','#6fd0ff','#ffffff'])); emit();
      if(h.age%2===0){ sp(T.glow, p.x, p.y, p.z); S.s0=0.6; S.s1=0.15; S.life=10; S.add=0.5; S.a=0.5; S.fout=1; sc_('#3aaeff'); emit(); } } },
  fire: { mesh:()=> toyMesh(G.look.geo.sphere(0.16,14,10), basicMat('fire','#fff3b0')),
    halos:[ HL(T.glow,1.2,'#ff8a1a',0.7,0.5,{pulse:0.12}), HL(T.flame,0.85,'#ff8a2a',1,0,{orient:Math.PI/2,flick:0.1,pulse:0.08,oy:0.02}), HL(T.glow,0.5,'#fff6c0',0.9,1) ],
    tick(h,p,f){ if(h.age%2===0){ sp(T.flame, p.x - f*R(0.15,0.3), p.y + R(-0.1,0.12), p.z); S.s0=R(0.22,0.34); S.s1=0.05; S.curve=1; S.vy=R(0.01,0.025); S.vx=-f*0.01; S.life=R(14,20); S.rot=f*Math.PI/2+R(-0.3,0.3); sc_(PICK(['#ff8a2a','#ffb23a','#ff6a3a'])); emit(); }
      if(rnd()<0.5){ sp(T.spark, p.x - f*0.2, p.y, p.z); S.s0=0.14; S.curve=3; S.life=14; S.add=1; S.vx=-f*R(0,0.02); S.vy=R(0.01,0.03); sc_('#ffe066'); emit(); } } },
  ice: { mesh:()=> toyMesh(built('ice',(b,g)=>{ const o=new THREE.OctahedronGeometry(0.2,0);
      b.add(o,'#bff6ff',[0,0,0],[0,0,-Math.PI/2],[0.8,1.9,0.8]); b.add(o,'#7fe0ff',[-0.16,0.11,0],[0,0,-1.1],[0.45,1.0,0.45]); b.add(o,'#7fe0ff',[-0.16,-0.11,0],[0,0,-2.0],[0.45,1.0,0.45]); }),
      G.look.vmat({rough:0.18, flat:true, emissive:'#1f8fd0', emissiveIntensity:0.35}), 0.015),
    halos:[ HL(T.glow,1.0,'#5fd8ff',0.6,0.5) ],
    tick(h,p,f){ h.mesh.rotation.x += 0.3; h.mesh.scale.x = f; if(h.age%2===0){ sp(T.spark, p.x - f*R(0.1,0.3), p.y + R(-0.1,0.1), p.z); S.s0=R(0.12,0.24); S.curve=3; S.life=18; S.add=1; S.vy=-0.004; sc_(PICK(['#ffffff','#bff6ff'])); emit(); } } },
  bolt: { mesh:()=> toyMesh(G.look.geo.sphere(0.1,10,8), basicMat('bolt','#ffffff')),
    halos:[ HL(T.glow,1.2,'#ffe23a',0.75,1,{pulse:0.15}), HL(T.bolt,0.8,'#ffe23a',1,0,{jitter:0.5,flick:0.2}), HL(T.flare,0.8,'#ffffff',0.8,1,{jitter:0.3}) ],
    tick(h,p,f){ sp(T.spark, p.x + R(-0.2,0.2), p.y + R(-0.2,0.2), p.z); S.s0=R(0.14,0.24); S.curve=3; S.life=10; S.add=1; S.vx=R(-0.03,0.03); S.vy=R(-0.03,0.03); sc_(PICK(['#fff6a0','#ffffff'])); emit(); } },
  cork: { mesh:()=> toyMesh(built('cork',(b,g)=>{ b.add(g.cylinder(0.13,0.17,0.3,14),'#d9a066',[0,0,0],[0,0,-Math.PI/2]); b.add(g.cylinder(0.171,0.171,0.035,14),'#b07a44',[-0.11,0,0],[0,0,-Math.PI/2]); b.add(g.sphere(0.02,6,4),'#8a5a2a',[0.05,0.06,0.09]); b.add(g.sphere(0.018,6,4),'#8a5a2a',[-0.03,-0.05,0.1]); }), G.look.vmat({rough:0.8}), 0.018),
    halos:null,
    tick(h,p,f){ h.mesh.rotation.x += 0.35; h.mesh.scale.x = f; if(h.age%3===0){ sp(T.puff, p.x - f*0.2, p.y, p.z); S.s0=0.16; S.s1=0.3; S.curve=2; S.life=14; S.a=0.7; S.fout=0.7; S.rot=rnd()*TAU; sc_('#ffffff'); emit(); } } },
  card: { mesh:()=>{ const tex = G.look.canvasTex('fx_card', 128, 176, drawCard);
      return toyMesh(once('g:card',()=>{ const g=new THREE.PlaneGeometry(0.34,0.47); g.userData.shared=true; return g; }), basicMat('card','#ffffff',{ map:tex, side:THREE.DoubleSide, alphaTest:0.5 })); },
    halos:[ HL(T.glow,0.7,'#ffffff',0.3,1) ],
    tick(h,p,f){ h.mesh.rotation.y += 0.38; h.mesh.rotation.z = -0.3*f; if(h.age%3===0){ sp(T.spark, p.x - f*0.2, p.y + R(-0.15,0.15), p.z); S.s0=R(0.14,0.22); S.curve=3; S.life=16; S.add=1; sc_(PICK(['#ff5a6a','#ffffff','#ffd23a'])); emit(); } } },
  confetti: { mesh:()=> toyMesh(built('confetti',(b,g)=>{ for(let i=0;i<9;i++){ const a=i/9*TAU; b.add(g.box(0.16,0.1,0.015), CONFETTI[i%6], [Math.cos(a)*0.12, Math.sin(a)*0.12, Math.sin(a*2)*0.05], [a, a*1.3, a*0.7]); } }), G.look.vmat({rough:0.6, side:THREE.DoubleSide})),
    halos:[ HL(T.glow,0.8,'#ffd0f0',0.3,1) ],
    tick(h,p,f){ h.mesh.rotation.x += 0.2; h.mesh.rotation.y += 0.27; h.mesh.rotation.z += 0.13;
      sp(T.conf, p.x - f*R(0,0.2), p.y + R(-0.15,0.15), p.z + R(-0.1,0.1)); S.vx=-f*R(0,0.02); S.vy=R(0,0.03); S.grav=-0.006; S.drag=0.03; S.flags=F_FLUTTER|F_FLOOR; S.s0=S.s1=R(0.12,0.17); S.asp=0.6; S.rot=rnd()*TAU; S.spin=R(-0.2,0.2); S.life=R(50,70); S.fout=0.3; sc_(PICK(CONFETTI)); emit(); } },
  bone: { mesh:()=> toyMesh(built('bone',(b,g)=>{ const c='#fff4e0'; b.add(g.capsule(0.075,0.36,4,10), c, [0,0,0],[0,0,Math.PI/2]); for(const sx of [-1,1]) for(const sy of [-1,1]) b.add(g.sphere(0.09,12,8), c, [sx*0.24, sy*0.065, 0]); }), G.look.vmat({rough:0.6}), 0.018),
    halos:null,
    tick(h,p,f){ h.mesh.rotation.z -= 0.3*f; } },
  note: { mesh:()=> toyMesh(built('note',(b,g)=>{ const c='#ff6fae'; b.add(g.sphere(0.1,12,8), c, [0,0,0],[0,0,0.4],[1.3,0.9,0.7]); b.add(g.box(0.035,0.38,0.035), c, [0.105,0.19,0]); b.add(g.box(0.16,0.05,0.035), c, [0.16,0.34,0],[0,0,-0.5]); }), G.look.vmat({rough:0.45, emissive:'#ff3a8a', emissiveIntensity:0.25}), 0.018),
    halos:[ HL(T.glow,0.8,'#ff9ad0',0.35,1) ],
    tick(h,p,f){ h.mesh.position.y = Math.sin(h.age*0.3)*0.08; h.mesh.rotation.z = Math.sin(h.age*0.2)*0.3;
      if(h.age%5===0){ sp(rnd()<0.5?T.note:T.note2, p.x - f*0.25, p.y + R(-0.1,0.2), p.z); S.s0=R(0.2,0.28); S.s1=S.s0*0.8; S.curve=1; S.vy=0.012; S.life=26; S.flags=F_WOB; S.wob=0.08; sc_(PICK(['#ff6fae','#7fc8ff','#ffb23a','#b58aff'])); emit(); } } },
  firework: { mesh:()=> toyMesh(built('firework',(b,g)=>{ b.add(g.cylinder(0.075,0.075,0.34,12),'#ff5a6a',[0,0,0],[0,0,-Math.PI/2]); b.add(g.cylinder(0.078,0.078,0.07,12),'#ffffff',[0.02,0,0],[0,0,-Math.PI/2]);
      b.add(g.cone(0.08,0.15,12),'#ffd23a',[0.24,0,0],[0,0,-Math.PI/2]); b.add(g.box(0.1,0.02,0.16),'#4ad0ff',[-0.15,0,0]); b.add(g.box(0.1,0.16,0.02),'#4ad0ff',[-0.15,0,0]); }), G.look.vmat({rough:0.5}), 0.016),
    halos:[ HL(T.glow,0.6,'#ffcf6a',0.55,1,{ox:-0.22,flick:0.3}) ],
    tick(h,p,f){ h.mesh.rotation.z = Math.atan2(h.vy||0, h.vx||1);
      const c=Math.cos(h.mesh.rotation.z), s=Math.sin(h.mesh.rotation.z);
      sp(T.spark, p.x - c*0.25, p.y - s*0.25, p.z); S.vx=-c*0.02+R(-0.01,0.01); S.vy=-s*0.02+R(-0.01,0.01); S.s0=R(0.14,0.26); S.curve=3; S.life=R(14,22); S.add=1; sc_(PICK(['#ffd23a','#ff9a3a','#ffffff'])); emit(); } },
  rock: { mesh:()=> toyMesh(once('g:rock',()=>{ const g=new THREE.DodecahedronGeometry(0.22,0); g.userData.shared=true; return g; }), G.look.mat('#a08a74',{rough:0.95, flat:true}), 0.02),
    halos:null,
    tick(h,p,f){ h.mesh.rotation.x += 0.12; h.mesh.rotation.z -= 0.2*f; if(h.age%4===0){ sp(T.puff, p.x - f*0.15, p.y, p.z); S.s0=0.14; S.s1=0.3; S.curve=2; S.life=16; S.a=0.75; S.fout=0.7; S.rot=rnd()*TAU; sc_('#e6d6bc'); emit(); } } },
  shadow: { mesh:()=> toyMesh(built('shadow',(b,g)=>{ b.add(g.sphere(0.2,16,12),'#4a2a78'); b.add(g.sphere(0.042,8,6),'#ffffff',[-0.07,0.03,0.17]); b.add(g.sphere(0.042,8,6),'#ffffff',[0.07,0.03,0.17]); b.add(g.sphere(0.02,6,4),'#ff9ad0',[0,-0.05,0.19]); }), basicMat('shadowv','#ffffff',{vertexColors:true})),
    halos:[ HL(T.glow,1.25,'#9a5aff',0.7,0.5,{pulse:0.12}), HL(T.wisp,0.95,'#5a3a8a',0.45,0,{spin:0.05}) ],
    tick(h,p,f){ if(h.age%2===0){ sp(T.wisp, p.x - f*R(0.1,0.3), p.y + R(-0.1,0.15), p.z - 0.05); S.s0=R(0.3,0.45); S.s1=S.s0*1.5; S.curve=2; S.vy=0.01; S.life=R(20,28); S.a=0.55; S.fout=0.6; S.rot=rnd()*TAU; sc_(PICK(['#6a3aa8','#8a5ac8'])); emit(); }
      if(rnd()<0.4){ sp(T.spark, p.x + R(-0.2,0.2), p.y + R(-0.2,0.2), p.z); S.s0=0.15; S.curve=3; S.life=14; S.add=1; sc_('#e0b0ff'); emit(); } } },
  beam: { mesh:()=> toyMesh(G.look.geo.sphere(0.16,14,10), basicMat('beam','#ffe8e8')),
    halos:[ HL(T.glow,1.2,'#ff2a3a',0.95,0.4,{pulse:0.18}), HL(T.ring,0.65,'#ff6a7a',0.9,0.5,{spin:-0.3}), HL(T.glow,0.45,'#ffffff',0.8,1) ],
    tick(h,p,f){ sp(T.glow, p.x, p.y, p.z); S.s0=0.55; S.s1=0.1; S.life=12; S.add=0.45; S.a=0.6; S.fout=1; sc_('#ff4a5a'); emit(); } },
  heart: { mesh:()=> toyMesh(G.look.geo.heart(0.26,0.12), G.look.mat('#ff6f9f',{rough:0.4, emissive:'#ff2a6a', emissiveIntensity:0.25}), 0.02),
    halos:[ HL(T.glow,0.9,'#ff9ac0',0.45,1,{pulse:0.1}) ],
    tick(h,p,f){ h.mesh.rotation.y = Math.sin(h.age*0.25)*0.6; if(h.age%4===0){ sp(T.heart, p.x - f*0.2, p.y, p.z); S.s0=0.16; S.s1=0.1; S.curve=1; S.vy=0.01; S.life=20; sc_('#ff8fb8'); emit(); } } },
  candy: { mesh:()=> toyMesh(built('candy',(b,g)=>{ b.add(g.sphere(0.14,14,10),'#ff7ab8'); b.add(g.torus(0.1,0.03,6,16),'#ffffff',[0,0,0],[0,Math.PI/2,0]); b.add(g.cone(0.09,0.14,10),'#ffe14d',[0.2,0,0],[0,0,Math.PI/2]); b.add(g.cone(0.09,0.14,10),'#ffe14d',[-0.2,0,0],[0,0,-Math.PI/2]); }), G.look.vmat({rough:0.35}), 0.018),
    halos:[ HL(T.glow,0.7,'#ffd0ea',0.3,1) ],
    tick(h,p,f){ h.mesh.rotation.z -= 0.2*f; if(h.age%4===0){ sp(T.spark, p.x, p.y, p.z); S.s0=0.16; S.curve=3; S.life=14; S.add=1; sc_(PICK(['#ff7ab8','#ffe14d','#ffffff'])); emit(); } } },
};
function drawCard(x, w, h){
  x.clearRect(0,0,w,h);
  x.fillStyle = '#3b2417'; x.beginPath(); rr(x, 2, 2, w-4, h-4, 16); x.fill();
  x.fillStyle = '#fffaf0'; x.beginPath(); rr(x, 7, 7, w-14, h-14, 12); x.fill();
  x.strokeStyle = '#ff5a6a'; x.lineWidth = 4; x.beginPath(); rr(x, 14, 14, w-28, h-28, 8); x.stroke();
  x.fillStyle = '#ff4a5a'; pHeart(x, w/2, h/2+2, 30); x.fill();
  x.fillStyle = '#ffffff'; x.beginPath(); x.ellipse(w/2-14, h/2-12, 7, 4.5, -0.6, 0, TAU); x.fill();
  x.fillStyle = '#ff4a5a'; x.font = '900 26px sans-serif'; x.textAlign='center'; x.textBaseline='middle'; x.fillText('A', 30, 34); x.save(); x.translate(w-30, h-34); x.rotate(Math.PI); x.fillText('A', 0, 0); x.restore();
}
const PROJ_KINDS = Object.keys(PDEF);

function makeProjectile(kind){
  if(!PDEF[kind]) kind = 'ball';
  const D = PDEF[kind];
  const pool = projPool[kind] || (projPool[kind] = []);
  let h = pool.pop();
  if(!h){
    const obj = new THREE.Group(); obj.name = 'fxProj_'+kind;
    let mesh = null;
    try { mesh = D.mesh ? D.mesh() : null; } catch(err){ G.logError('fx.projectile '+kind, err); }
    if(mesh) obj.add(mesh);
    h = { kind, D, obj, mesh: mesh || new THREE.Object3D(), live:false, t:0, age:0, vx:1, vy:0, face:1, scale:1, seed:0, x:0, y:0, z:0 };
    h.update = (p)=> projUpdate(h, p);
    h.dispose = ()=> projDispose(h);
    h.pop = ()=> projPop(h);
  }
  h.live = true; h.t = 0; h.age = 0; h.vx = 1; h.vy = 0; h.face = 1; h.scale = 0.4; h.seed = rnd();
  h.obj.position.set(0,0,0); h.obj.rotation.set(0,0,0); h.obj.scale.setScalar(0.4); h.obj.visible = true;
  h.mesh.position.set(0,0,0); h.mesh.rotation.set(0,0,0); h.mesh.scale.set(1,1,1);
  liveProj.push(h);
  return h;
}
function projUpdate(h, p){
  if(!h.live || !p) return;
  h.age = (typeof p.age === 'number') ? (p.age|0) : h.t; h.t++;
  h.x = p.x||0; h.y = p.y||0; h.z = p.z||0;
  h.obj.position.set(h.x, h.y, h.z);
  if(p.vx) h.vx = p.vx; h.vy = p.vy||0;
  const f = h.face = h.vx < 0 ? -1 : 1;
  let s = h.age < 5 ? 0.4 + 0.6*backOut((h.age+1)/5) : 1;
  if(p.life && p.life - h.age < 6) s *= Math.max(0.25, (p.life - h.age)/6);
  h.scale = s; h.obj.scale.setScalar(s);
  if(np < capP - 8 && h.D.tick){ try { h.D.tick(h, p, f); } catch(err){ G.logError('fx.projectile.tick '+h.kind, err); } }
}
function projDispose(h){
  if(!h.live) return;
  h.live = false;
  if(h.obj.parent) h.obj.parent.remove(h.obj);
  const i = liveProj.indexOf(h); if(i>=0) liveProj.splice(i,1);
  const pool = projPool[h.kind] || (projPool[h.kind] = []);
  if(pool.length < 24) pool.push(h);
}
// small burst where the projectile ends (extra; combat may call h.pop() before dispose())
const POPFX = { wave:'sparkle', star:'stars', ball:'ring', fire:'flame', ice:'ice', bolt:'thunder', cork:'poof', card:'sparkle', confetti:'confetti',
  bone:'stars', note:'notes', firework:'fireworks', rock:'dust', shadow:'smoke', beam:'ring', heart:'hearts', candy:'confetti' };
const POPCOL = { ball:'#6fd0ff', beam:'#ff5a6a', wave:'#bff0ff', card:'#ff5a6a' };
function projPop(h){
  const k = POPFX[h.kind] || 'sparkle';
  burst(k, h.x, h.y, h.z + 0.2, { scale: k==='fireworks' ? 0.5 : 0.7, count: k==='fireworks' ? 1 : (k==='confetti' ? 14 : 0) || undefined, color: POPCOL[h.kind] });
}
const _w = new THREE.Vector3();
function writeHalos(j, pass){
  for(let n=0;n<liveProj.length;n++){
    const h = liveProj[n], o = h.obj, hs = h.D.halos;
    if(!hs || !o.parent || !o.visible) continue;
    let X, Y, Z;
    if(o.parent === G.scene){ X=o.position.x; Y=o.position.y; Z=o.position.z; } else { o.getWorldPosition(_w); X=_w.x; Y=_w.y; Z=_w.z; }
    const sc = h.scale, f = h.face;
    for(let m=0;m<hs.length;m++){
      const L = hs[m];
      if((L.add >= 0.5 ? 1 : 0) !== pass) continue;
      if(j >= CAP) return j;
      if(!L.c) L.c = rgb(L.color);
      let s = L.size*sc, a = L.a;
      if(L.pulse) s *= 1 + L.pulse*Math.sin(fxT*0.4 + h.seed*10);
      if(L.flick) a *= 1 - L.flick*rnd();
      let ro = (L.spin||0)*fxT + h.seed*TAU*(L.spin?1:0);
      if(L.orient) ro = f>0 ? L.orient : -L.orient;
      if(L.jitter) ro += (rnd()*2-1)*L.jitter;
      let w = s; if(L.flip && f<0) w = -w;
      put(j++, X + (L.ox||0)*f*sc, Y + (L.oy||0)*sc, Z, ro, w, s*(L.asp||1), L.tile, L.add, L.c[0], L.c[1], L.c[2], a);
    }
  }
  return j;
}

// ================================================================ timed emitters (confetti rain, sparkle columns, firework shows)
const emitters = [];
function addEmitter(dur, rate, fn, x, y, z, o){
  if(emitters.length >= 16) emitters.shift();
  emitters.push({ t:0, dur, rate, acc:0, fn, x, y, z, o:o||{}, n:0 });
}
function updateEmitters(k){
  for(let i=emitters.length-1;i>=0;i--){
    const e = emitters[i];
    e.acc += e.rate*k*fxs();
    while(e.acc >= 1){ e.acc -= 1; try { e.fn(e); } catch(err){ G.logError('fx.emitter', err); } e.n++; }
    e.t += k;
    if(e.t >= e.dur) emitters.splice(i,1);
  }
}

// ================================================================ bursts
function ang(){ return rnd()*TAU; }
function sparkle(x,y,z,o){
  const n = cnt(o.count||10), s = o.scale||1;
  for(let i=0;i<n;i++){
    const a = ang(), r = R(0.1,0.7)*s;
    sp(T.spark, x+Math.cos(a)*r, y+Math.sin(a)*r*0.9, z+R(-0.2,0.3));
    S.vx = Math.cos(a)*0.01; S.vy = R(0.004,0.02); S.s0 = R(0.2,0.45)*s; S.curve = 3; S.life = R(22,40); S.delay = (R(0,10))|0;
    S.add = 0.45; S.fout = 0; S.rot = R(-0.3,0.3); sc_(o.color || PICK(['#ffe14d','#fff6a8','#ffffff','#ffc0e8'])); emit();
  }
  sp(T.glow, x, y, z); S.s0 = 1.0*s; S.curve = 3; S.life = 18; S.add = 1; S.a = 0.45; S.fout = 0; sc_(o.color || '#fff6c0'); emit();
}
function stars(x,y,z,o){
  const n = cnt(o.count||7), s = o.scale||1;
  for(let i=0;i<n;i++){
    const a = n>1 ? (i/(n-1)-0.5)*2.6 : 0, spd = R(0.08,0.14)*s;
    sp(T.star, x, y, z+0.1); S.vx = Math.sin(a)*spd + (o.dir||0)*0.03; S.vy = Math.cos(a)*spd + 0.03; S.vz = R(-0.02,0.03);
    S.grav = -0.008; S.drag = 0.02; S.s0 = R(0.26,0.38)*s; S.s1 = S.s0*0.55; S.curve = 1; S.spin = R(-0.2,0.2);
    S.life = R(30,42); S.fout = 0.35; sc_(o.color || PICK(['#ffd23a','#ffe66a','#ffc02a'])); emit();
  }
}
function hearts(x,y,z,o){
  const n = cnt(o.count||6), s = o.scale||1;
  for(let i=0;i<n;i++){
    sp(T.heart, x+R(-0.45,0.45)*s, y+R(-0.1,0.35)*s, z+R(0,0.3)); S.vx = R(-0.015,0.015); S.vy = R(0.018,0.04); S.drag = 0.01;
    S.s0 = R(0.26,0.42)*s; S.s1 = S.s0*0.8; S.curve = 1; S.life = R(44,64); S.fout = 0.35; S.flags = F_WOB; S.wob = 0.12;
    S.delay = (R(0,8))|0; S.rot = R(-0.3,0.3); sc_(o.color || PICK(['#ff6f9f','#ff8fb8','#ff5a8a'])); emit();
  }
}
function dust(x,y,z,o){
  const n = cnt(o.count||8), s = o.scale||1, d = o.dir||0;
  for(let i=0;i<n;i++){
    sp(T.puff, x+R(-0.25,0.25)*s, y+R(0.05,0.25), z+R(-0.15,0.15)); S.vx = R(-0.05,0.05)*s + d*R(0.02,0.06); S.vy = R(0.008,0.03); S.vz = R(-0.02,0.02);
    S.drag = 0.06; S.s0 = R(0.22,0.36)*s; S.s1 = S.s0*1.9; S.curve = 2; S.life = R(24,36); S.fout = 0.6; S.a = 0.9; S.rot = ang(); S.spin = R(-0.03,0.03);
    sc_(o.color || '#efe0c2'); emit();
  }
}
function dustRing(x,y,z,o){
  const n = cnt(o.count||12), s = o.scale||1;
  for(let i=0;i<n;i++){
    const a = i/n*TAU + R(-0.2,0.2);
    sp(T.puff, x+Math.cos(a)*0.2*s, y+0.12, z+Math.sin(a)*0.15*s); S.vx = Math.cos(a)*R(0.07,0.1)*s; S.vz = Math.sin(a)*R(0.05,0.08)*s; S.vy = R(0.005,0.02);
    S.drag = 0.08; S.s0 = 0.25*s; S.s1 = 0.55*s; S.curve = 2; S.life = R(24,32); S.fout = 0.6; S.a = 0.9; S.rot = ang(); sc_(o.color || '#efe0c2'); emit();
  }
  sp(T.wave, x, y+0.05, z); S.s0 = 0.4*s; S.s1 = 2.4*s; S.asp = 0.32; S.curve = 2; S.life = 16; S.add = 0.5; S.a = 0.7; S.fout = 0.8; sc_('#fff4d8'); emit();
}
function poof(x,y,z,o){
  const n = cnt(o.count||9), s = o.scale||1;
  for(let i=0;i<n;i++){
    const a = i/n*TAU + R(-0.3,0.3), r = R(0.1,0.3)*s;
    sp(T.puff, x+Math.cos(a)*r, y+Math.sin(a)*r*0.8, z+R(-0.1,0.2)); S.vx = Math.cos(a)*R(0.04,0.08)*s; S.vy = Math.sin(a)*R(0.03,0.06)*s + 0.01; S.vz = R(-0.01,0.03);
    S.drag = 0.12; S.s0 = R(0.45,0.7)*s; S.s1 = S.s0*1.3; S.curve = 1; S.life = R(26,36); S.fout = 0.5; S.rot = ang(); S.spin = R(-0.04,0.04);
    sc_(o.color || PICK(['#ffffff','#fff4fb','#f4f0ff'])); emit();
  }
  sp(T.puff, x, y, z+0.25); S.s0 = 0.95*s; S.s1 = 1.1*s; S.curve = 1; S.life = 22; S.fout = 0.5; S.rot = ang(); sc_(o.color || '#ffffff'); emit();
  sparkle(x, y, z+0.3, { count:5, scale:s, color:'#ffffff' });
}
function ring(x,y,z,o){
  const s = o.scale||1;
  sp(T.ring, x, y, z); S.s0 = 0.25*s; S.s1 = 2.0*s; S.curve = 2; S.life = o.life||16; S.add = 1; S.fout = 0.8; S.asp = o.flat ? 0.32 : 1; sc_(o.color || '#ffffff'); emit();
}
function confetti(x,y,z,o){
  const n = cnt(o.count||36), s = o.scale||1;
  for(let i=0;i<n;i++){
    const a = R(-1.1,1.1), spd = R(0.12,0.24)*s;
    sp(T.conf, x+R(-0.2,0.2), y, z+R(-0.2,0.2)); S.vx = Math.sin(a)*spd + (o.dir||0)*0.05; S.vy = Math.cos(a)*spd; S.vz = R(-0.05,0.06);
    S.grav = -0.0065; S.drag = 0.035; S.flags = F_FLUTTER|F_FLOOR; S.s0 = S.s1 = R(0.18,0.26)*s; S.asp = 0.6; S.rot = ang(); S.spin = R(-0.25,0.25);
    S.life = R(90,130); S.fout = 0.2; sc_(PICK(CONFETTI)); emit();
  }
  stars(x, y, z, { count:4, scale:0.8*s });
}
function shell(cx,cy,cz,color,delay,s,heart){
  const m = cnt(32);
  sp(T.glow, cx, cy, cz); S.s0 = 1.1*s; S.s1 = 1.5*s; S.curve = 2; S.life = 12; S.add = 1; S.a = 0.7; S.fout = 1; S.delay = delay; sc_(color); emit();
  for(let i=0;i<m;i++){
    let dx, dy, spd;
    if(heart){ const t = i/m*TAU, st = Math.sin(t); dx = 16*st*st*st/17; dy = (13*Math.cos(t)-5*Math.cos(2*t)-2*Math.cos(3*t)-Math.cos(4*t))/17; spd = 0.1*s; }
    else { const a = i/m*TAU + R(-0.05,0.05); dx = Math.cos(a); dy = Math.sin(a); spd = R(0.075,0.1)*s; }
    sp(T.spark, cx, cy, cz); S.vx = dx*spd; S.vy = dy*spd; S.vz = R(-0.02,0.02); S.drag = 0.05; S.grav = -0.0025;
    S.s0 = 0.42*s; S.s1 = 0.14*s; S.life = R(48,60); S.fout = 0.4; S.add = 0.5; S.flags = F_TWINK|F_TRAILER; S.delay = delay; sc_(color); emit();
  }
  sp(T.ring, cx, cy, cz); S.s0 = 0.3*s; S.s1 = 3.4*s; S.curve = 2; S.life = 18; S.add = 1; S.a = 0.45; S.fout = 0.8; S.delay = delay; sc_(color); emit();
}
function fireworks(x,y,z,o){
  const n = o.count||3, s = o.scale||1;
  for(let i=0;i<n;i++){
    const hx = n>1 ? x+R(-1.8,1.8)*s : x, hy = n>1 ? y+R(0,1.4)*s : y;
    shell(hx, hy, z+R(-0.5,0.5), o.color || FIREWORK[(i + (rnd()*7|0)) % FIREWORK.length], i*12, s, n>1 && i===1);
  }
}
function heal(x,y,z,o){
  const s = o.scale||1;
  for(let i=0;i<cnt(6);i++){
    sp(T.plus, x+R(-0.5,0.5)*s, y+R(0.1,0.9)*s, z+R(-0.1,0.3)); S.vy = R(0.02,0.035); S.s0 = R(0.22,0.34)*s; S.s1 = S.s0*0.7; S.curve = 1;
    S.life = R(40,54); S.fout = 0.35; S.delay = (R(0,12))|0; sc_(o.color || PICK(['#5fd87a','#8dff8a'])); emit();
  }
  for(let i=0;i<cnt(8);i++){
    sp(T.spark, x+R(-0.55,0.55)*s, y+R(0,0.6), z+R(0,0.3)); S.vy = R(0.02,0.04); S.s0 = R(0.16,0.3)*s; S.curve = 3; S.life = R(26,40); S.add = 1; S.delay = (R(0,14))|0; sc_(PICK(['#cfffc0','#ffffff'])); emit();
  }
  sp(T.wave, x, y+0.05, z); S.s0 = 0.3*s; S.s1 = 1.9*s; S.asp = 0.32; S.curve = 2; S.life = 24; S.add = 0.7; S.fout = 0.7; sc_('#8dff8a'); emit();
  hearts(x, y+0.8*s, z, { count:2, scale:0.7*s });
}
function levelup(x,y,z,o){
  const s = o.scale||1;
  for(let k=0;k<2;k++){ sp(T.wave, x, y+0.06, z); S.s0 = 0.3*s; S.s1 = 2.7*s; S.asp = 0.32; S.curve = 2; S.life = 26; S.add = 0.7; S.fout = 0.7; S.delay = k*10; sc_('#ffe066'); emit(); }
  sp(T.glow, x, y+1.0*s, z); S.s0 = 1.0*s; S.s1 = 1.2*s; S.asp = 2.6; S.life = 44; S.add = 0.8; S.a = 0.35; S.fin = 0.15; S.fout = 0.5; sc_('#ffd23a'); emit();
  sp(T.glow, x, y+0.7*s, z+0.2); S.s0 = 1.4*s; S.s1 = 1.8*s; S.curve = 2; S.life = 16; S.add = 1; S.a = 0.45; S.fout = 1; sc_('#fff0a0'); emit();
  const n = cnt(8);
  for(let i=0;i<n;i++){ const a = i/n*TAU;
    sp(T.star, x+Math.cos(a)*0.3*s, y+0.8*s, z+Math.sin(a)*0.2); S.vx = Math.cos(a)*0.07*s; S.vy = 0.04 + Math.sin(a)*0.03; S.grav = -0.004; S.drag = 0.03;
    S.s0 = 0.3*s; S.s1 = 0.12*s; S.curve = 1; S.spin = R(-0.15,0.15); S.life = 40; S.fout = 0.3; sc_(PICK(['#ffd23a','#ffe66a','#fff3a0'])); emit(); }
  addEmitter(40, 1.6, (e)=>{ const a = ang(), r = R(0.1,0.6)*s;
    sp(T.spark, e.x+Math.cos(a)*r, e.y+R(0,0.3), e.z+Math.sin(a)*r*0.6); S.vy = R(0.04,0.07); S.drag = 0.02; S.s0 = R(0.18,0.32)*s; S.curve = 3; S.life = R(26,36); S.add = 0.5;
    sc_(PICK(['#ffd23a','#ffffff','#fff3a0'])); emit(); }, x, y, z);
}
function shock(x,y,z,o){
  const s = o.scale||1;
  sp(T.wave, x, y+0.05, z); S.s0 = 0.4*s; S.s1 = 4.2*s; S.asp = 0.32; S.curve = 2; S.life = 22; S.add = 0.55; S.a = 0.95; S.fout = 0.7; sc_(o.color||'#fff3c8'); emit();
  sp(T.wave, x, y+0.05, z); S.s0 = 0.3*s; S.s1 = 3.0*s; S.asp = 0.32; S.curve = 2; S.life = 20; S.add = 0.55; S.a = 0.7; S.fout = 0.7; S.delay = 5; sc_(o.color||'#fff3c8'); emit();
  dustRing(x, y, z, { count:14, scale:1.3*s });
  for(let i=0;i<cnt(7);i++){
    sp(T.dot, x+R(-0.5,0.5)*s, y+0.1, z+R(-0.3,0.3)); S.vx = R(-0.08,0.08)*s; S.vy = R(0.12,0.2); S.vz = R(-0.03,0.04); S.grav = -0.012; S.flags = F_FLOOR;
    S.s0 = S.s1 = R(0.12,0.2)*s; S.life = R(36,48); S.fout = 0.3; sc_(PICK(['#a0835e','#c09a6a','#8a6e4e'])); emit();
  }
}
function magic(x,y,z,o){
  const n = cnt(o.count||14), s = o.scale||1;
  for(let i=0;i<n;i++){
    const a = i/n*TAU, c = Math.cos(a), si = Math.sin(a);
    sp(T.spark, x+c*0.15, y+si*0.15, z+0.1); S.vx = (c*0.05 - si*0.07)*s; S.vy = (si*0.05 + c*0.07)*s; S.drag = 0.06;
    S.s0 = R(0.22,0.38)*s; S.curve = 3; S.life = R(26,40); S.add = 1; S.flags = F_TWINK; sc_(o.color || PICK(['#ff7ad8','#c58aff','#ffffff','#8ad8ff'])); emit();
  }
  stars(x, y, z, { count:3, scale:0.7*s, color:'#ff9ae0' });
  sp(T.swirl, x, y, z); S.s0 = 0.5*s; S.s1 = 1.3*s; S.curve = 2; S.spin = 0.22; S.life = 26; S.add = 0.8; S.a = 0.8; S.fout = 0.6; sc_('#e08aff'); emit();
  sp(T.glow, x, y, z); S.s0 = 1.2*s; S.curve = 3; S.life = 18; S.add = 1; S.a = 0.5; sc_('#ff9ae8'); emit();
}
function notes(x,y,z,o){
  const n = cnt(o.count||5), s = o.scale||1;
  for(let i=0;i<n;i++){
    sp(rnd()<0.5?T.note:T.note2, x+R(-0.5,0.5)*s, y+R(0,0.5)*s, z+R(0,0.3)); S.vy = R(0.02,0.035); S.vx = R(-0.01,0.01); S.s0 = R(0.28,0.4)*s; S.s1 = S.s0*0.8;
    S.curve = 1; S.life = R(44,60); S.fout = 0.35; S.flags = F_WOB; S.wob = 0.1; S.rot = R(-0.3,0.3); S.delay = (R(0,10))|0; sc_(o.color || PICK(['#ff6fae','#6fc0ff','#ffb23a','#b58aff'])); emit();
  }
}
function paws(x,y,z,o){
  const n = cnt(o.count||5), s = o.scale||1;
  for(let i=0;i<n;i++){
    sp(T.paw, x+R(-0.7,0.7)*s, y+R(-0.1,0.7)*s, z+R(0,0.3)); S.s0 = R(0.3,0.42)*s; S.s1 = S.s0*0.9; S.curve = 1; S.life = R(30,40); S.fout = 0.35;
    S.rot = R(-0.5,0.5); S.delay = i*4; sc_(o.color || PICK(['#ff9ec4','#ffb8d8','#ff7ab0'])); emit();
  }
}
function smoke(x,y,z,o){
  const n = cnt(o.count||8), s = o.scale||1;
  for(let i=0;i<n;i++){
    sp(T.wisp, x+R(-0.4,0.4)*s, y+R(0,0.8)*s, z+R(-0.1,0.2)); S.vy = R(0.02,0.04); S.vx = R(-0.015,0.015); S.drag = 0.01;
    S.s0 = R(0.5,0.8)*s; S.s1 = S.s0*1.7; S.curve = 2; S.life = R(40,60); S.a = 0.7; S.fin = 0.15; S.fout = 0.6; S.rot = ang(); S.spin = R(-0.02,0.02); S.delay = (R(0,10))|0;
    sc_(o.color || PICK(['#5a3a8a','#6a4a9a','#4a2a78'])); emit();
  }
}
function purify(x,y,z,o){
  const s = o.scale||1;
  smoke(x, y, z, { count:12, scale:s });
  for(let i=0;i<cnt(14);i++){
    sp(T.spark, x+R(-0.8,0.8)*s, y+R(0,1.6)*s, z+R(0,0.4)); S.vy = R(0.01,0.03); S.s0 = R(0.24,0.4)*s; S.curve = 3; S.life = R(30,44); S.add = 1; S.delay = (R(12,36))|0; sc_(PICK(['#ffffff','#fff6c0','#ffd0f0'])); emit();
  }
  sp(T.ring, x, y+0.8*s, z); S.s0 = 0.4*s; S.s1 = 3.2*s; S.curve = 2; S.life = 24; S.add = 1; S.fout = 0.8; S.delay = 16; sc_('#ffffff'); emit();
  sp(T.glow, x, y+0.8*s, z+0.2); S.s0 = 2.4*s; S.curve = 3; S.life = 30; S.add = 1; S.a = 0.6; S.delay = 14; sc_('#fff6e0'); emit();
}
function flames(x,y,z,o){
  const n = cnt(o.count||8), s = o.scale||1;
  for(let i=0;i<n;i++){
    sp(T.flame, x+R(-0.35,0.35)*s, y+R(-0.1,0.3)*s, z+R(0,0.3)); S.vx = R(-0.02,0.02); S.vy = R(0.03,0.06)*s; S.drag = 0.04;
    S.s0 = R(0.3,0.45)*s; S.s1 = 0.06; S.curve = 1; S.life = R(22,32); S.fout = 0.3; S.rot = R(-0.2,0.2); sc_(o.color || PICK(['#ff8a2a','#ffb23a','#ff6a3a'])); emit();
  }
  sparkle(x, y+0.2, z, { count:4, scale:0.7*s, color:'#ffe066' });
}
function iceBurst(x,y,z,o){
  const n = cnt(o.count||9), s = o.scale||1;
  for(let i=0;i<n;i++){
    const a = ang(), spd = R(0.08,0.15)*s;
    sp(T.shard, x, y, z+0.1); S.vx = Math.cos(a)*spd; S.vy = Math.sin(a)*spd + 0.03; S.grav = -0.008; S.drag = 0.04; S.flags = F_VALIGN; S.rot = -Math.PI/2;
    S.s0 = R(0.22,0.34)*s; S.s1 = S.s0*0.5; S.asp = 1; S.life = R(22,30); S.fout = 0.35; sc_(o.color || PICK(['#6fe6ff','#9ff0ff','#4ac8ff'])); emit();
  }
  sparkle(x, y, z, { count:5, scale:0.8*s, color:'#ffffff' });
}
function thunder(x,y,z,o){
  const n = cnt(o.count||4), s = o.scale||1;
  for(let i=0;i<n;i++){
    sp(T.bolt, x+R(-0.45,0.45)*s, y+R(-0.3,0.45)*s, z+0.1); S.s0 = R(0.35,0.55)*s; S.s1 = S.s0*0.8; S.curve = 1; S.life = R(10,16); S.rot = R(-0.6,0.6); S.fout = 0.4; S.delay = i*2; sc_(o.color || '#ffe23a'); emit();
  }
  for(let i=0;i<cnt(8);i++){ const a = ang(), spd = R(0.1,0.18)*s;
    sp(T.streak, x, y, z+0.1); S.vx = Math.cos(a)*spd; S.vy = Math.sin(a)*spd; S.drag = 0.15; S.flags = F_VALIGN; S.s0 = 0.5*s; S.s1 = 0.2*s; S.asp = 0.14; S.life = 10; S.add = 1; sc_('#fffbe0'); emit(); }
}
function coin(x,y,z,o){
  sparkle(x, y, z, { count:6, scale:0.7, color: o.color || '#ffe14d' });
  ring(x, y, z+0.1, { scale:0.6, color: o.color || '#ffd23a', life:14 });
  stars(x, y, z, { count:2, scale:0.6 });
}
function petals(x,y,z,o){
  const n = cnt(o.count||12), s = o.scale||1;
  for(let i=0;i<n;i++){
    sp(T.petal, x+R(-1.2,1.2)*s, y+R(0,1.2)*s, z+R(-0.3,0.5)); S.vx = R(-0.02,0.02); S.vy = R(-0.02,0.02); S.grav = -0.002; S.flags = F_FLUTTER|F_WOB|F_FLOOR; S.wob = 0.2;
    S.s0 = S.s1 = R(0.16,0.24)*s; S.rot = ang(); S.spin = R(-0.08,0.08); S.life = R(80,120); S.fout = 0.3; sc_(o.color || PICK(['#ffb8d0','#ffd0e0','#ff9ec0'])); emit();
  }
}
function kira(x,y,z,o){
  const s = o.scale||1;
  sp(T.flare, x, y, z); S.s0 = 1.5*s; S.curve = 3; S.life = 20; S.add = 1; S.rot = 0.2; S.spin = 0.02; sc_(o.color || '#fffbe0'); emit();
  sp(T.glow, x, y, z); S.s0 = 1.0*s; S.curve = 3; S.life = 16; S.add = 1; S.a = 0.6; sc_(o.color || '#bff0ff'); emit();
}
function guard(x,y,z,o){
  const s = o.scale||1;
  sp(T.ring, x, y, z); S.s0 = 0.3*s; S.s1 = 1.2*s; S.curve = 2; S.life = 12; S.add = 1; S.fout = 0.7; sc_('#bfe8ff'); emit();
  for(let i=0;i<cnt(6);i++){ const a = ang(), spd = R(0.06,0.12)*s;
    sp(T.spark, x, y, z); S.vx = Math.cos(a)*spd; S.vy = Math.sin(a)*spd; S.drag = 0.1; S.s0 = R(0.18,0.3)*s; S.curve = 3; S.life = 14; S.add = 1; sc_(PICK(['#ffffff','#9fe0ff'])); emit(); }
}
function jumpPuff(x,y,z,o){
  const s = o.scale||1;
  for(let i=0;i<cnt(6);i++){ const a = i/6*TAU;
    sp(T.puff, x+Math.cos(a)*0.15, y, z+Math.sin(a)*0.1); S.vx = Math.cos(a)*0.05*s; S.vz = Math.sin(a)*0.035*s; S.vy = -0.005; S.drag = 0.1;
    S.s0 = 0.2*s; S.s1 = 0.4*s; S.curve = 2; S.life = 18; S.fout = 0.6; S.a = 0.9; S.rot = ang(); sc_('#ffffff'); emit(); }
  sp(T.ring, x, y, z); S.s0 = 0.3*s; S.s1 = 1.3*s; S.asp = 0.32; S.curve = 2; S.life = 14; S.add = 0.8; S.fout = 0.7; sc_('#ffffff'); emit();
  sparkle(x, y, z, { count:3, scale:0.6*s });
}

// ---------------------------------------------------------------- anime hit impact
function hitSparks(kind, x,y,z, n, s, d, main){
  switch(kind){
    case 'blunt':
      for(let i=0;i<n;i++){ const a = ang(), spd = R(0.07,0.14)*s;
        sp(T.star, x, y, z); S.vx = Math.cos(a)*spd + d*0.04; S.vy = Math.sin(a)*spd + 0.05; S.vz = R(-0.02,0.03); S.grav = -0.008; S.drag = 0.03;
        S.s0 = R(0.2,0.32)*s; S.s1 = S.s0*0.5; S.curve = 1; S.spin = R(-0.25,0.25); S.life = R(22,30); S.fout = 0.3; sc_(i&1 ? '#ffd23a' : main); emit(); }
      dust(x, y-0.3, z, { count:3, scale:0.7*s, dir:d });
      break;
    case 'magic':
      for(let i=0;i<n;i++){ const a = ang(), spd = R(0.04,0.1)*s;
        sp(T.spark, x, y, z); S.vx = Math.cos(a)*spd + d*0.02; S.vy = Math.sin(a)*spd; S.drag = 0.07; S.s0 = R(0.22,0.4)*s; S.curve = 3; S.life = R(22,34); S.add = 1; S.flags = F_TWINK;
        sc_(PICK(['#ff7ad8','#c58aff','#ffffff'])); emit(); }
      hearts(x, y, z, { count:2, scale:0.6*s, color:'#ff9ae0' });
      break;
    case 'ice': iceBurst(x, y, z, { count:n, scale:s }); break;
    case 'fire': flames(x, y-0.1, z, { count:Math.max(3, n*0.8|0), scale:0.8*s }); break;
    case 'thunder': thunder(x, y, z, { count:Math.max(2, n/3|0), scale:s }); break;
    case 'star': stars(x, y, z, { count:n, scale:s, dir:d }); sparkle(x, y, z, { count:4, scale:0.7*s }); break;
    case 'pop': confetti(x, y, z, { count:n*2, scale:0.7*s, dir:d }); break;
    case 'wind':
      for(let i=0;i<n;i++){ const a = ang(), c = Math.cos(a), si = Math.sin(a);
        sp(T.crescent, x+c*0.3*s, y+si*0.3*s, z); S.vx = -si*0.08*s; S.vy = c*0.08*s; S.drag = 0.08; S.rot = a; S.spin = 0.12; S.s0 = R(0.4,0.6)*s; S.s1 = S.s0*0.6; S.life = 14; S.add = 0.8; S.fout = 0.6; sc_(main); emit(); }
      break;
    default: // slash: pale-gold crescents + white twinkles thrown along the swing
      for(let i=0;i<3;i++){
        sp(T.crescent, x + d*0.1, y + R(-0.25,0.25)*s, z); S.s0 = R(0.8,1.1)*s; S.s1 = S.s0*1.25; S.asp = R(0.9,1.3); S.curve = 2;
        S.rot = R(-0.6,0.6); S.vx = d*0.03; S.life = R(9,12); S.add = 0.8; S.fout = 0.7; S.flags = d<0 ? F_FLIP : 0; sc_(i ? main : '#ffffff'); emit(); }
      for(let i=0;i<n;i++){ const a = ang(), spd = R(0.08,0.17)*s;
        sp(T.spark, x, y, z); S.vx = Math.cos(a)*spd + d*0.07; S.vy = Math.sin(a)*spd*0.8; S.drag = 0.1; S.grav = -0.004;
        S.s0 = R(0.18,0.32)*s; S.curve = 3; S.life = R(14,22); S.add = 1; sc_(PICK(['#ffffff','#fff3a0', main])); emit(); }
  }
}
function impact(x,y,z,kind,power,o){
  o = o || {};
  const K = KIND[kind] || KIND.slash;
  const s = (o.scale||1) * (power>=3 ? 1.65 : power>=2 ? 1.3 : 1);
  const d = o.dir||0, main = o.color || K.main;
  const reduced = !!o.reduced;
  // 1 white core flash
  sp(T.glow, x, y, z); S.s0 = 0.9*s; S.s1 = 1.3*s; S.curve = 2; S.life = power>=2 ? 9 : 7; S.fout = 1; S.add = 1; S.a = 0.85; sc_('#ffffff'); emit();
  // 2 flat comic star that pops out fast and fades
  sp(T.impact, x, y, z); S.s0 = 0.35*s; S.s1 = 1.4*s; S.curve = 2; S.life = 9 + 2*power; S.fout = 0.45; S.rot = R(-0.4,0.4); S.spin = R(-0.02,0.02); sc_(main); emit();
  if(reduced) return;
  // 3 sparks by kind
  hitSparks(kind, x, y, z, cnt(o.count || (power>=3 ? 16 : power>=2 ? 10 : 6)), s, d, main);
  // 4 quick ring
  sp(T.ring, x, y, z); S.s0 = 0.3*s; S.s1 = 1.9*s; S.curve = 2; S.life = 12; S.add = 1; S.a = 0.9; S.fout = 0.8; sc_(main); emit();
  // 5 radial speed lines (power 2+)
  if(power >= 2){
    const m = cnt(power>=3 ? 14 : 9);
    for(let i=0;i<m;i++){ const a = i/m*TAU + R(-0.15,0.15), c = Math.cos(a), si = Math.sin(a), spd = R(0.12,0.2)*s;
      sp(T.streak, x+c*0.35*s, y+si*0.35*s, z); S.vx = c*spd; S.vy = si*spd; S.drag = 0.12; S.flags = F_VALIGN; S.s0 = R(0.8,1.1)*s; S.s1 = 0.4*s; S.asp = 0.12;
      S.life = R(8,11); S.add = 0.85; S.fout = 0.6; sc_(i%3 ? '#ffffff' : main); emit(); }
  }
  // 6 finisher: second ring + big twinkle
  if(power >= 3){
    sp(T.wave, x, y, z); S.s0 = 0.5*s; S.s1 = 2.6*s; S.curve = 2; S.life = 18; S.add = 0.7; S.fout = 0.8; S.delay = 3; sc_(main); emit();
    sp(T.flare, x, y, z+0.05); S.s0 = 1.6*s; S.curve = 3; S.life = 16; S.add = 1; S.rot = R(-0.3,0.3); sc_('#ffffff'); emit();
  }
}

const B = {
  hit:      (x,y,z,o)=> impact(x,y,z, o.kind||'slash', o.power||1, o),
  hitBig:   (x,y,z,o)=> impact(x,y,z, o.kind||'blunt', Math.max(2, o.power||2), o),
  slash:    (x,y,z,o)=>{ const s=o.scale||1, d=o.dir||1;
    for(let i=0;i<cnt(o.count||4);i++){ sp(T.crescent, x + d*i*0.12*s, y + R(-0.2,0.2)*s, z); S.s0 = R(0.9,1.3)*s; S.s1 = S.s0*1.3; S.asp = R(1,1.4); S.curve = 2; S.rot = R(-0.5,0.5);
      S.vx = d*0.05*s; S.life = R(10,14); S.add = 0.8; S.fout = 0.7; S.delay = i*2; S.flags = d<0 ? F_FLIP : 0; sc_(i&1 ? '#ffffff' : (o.color||'#fff1a0')); emit(); }
    sparkle(x + d*0.3*s, y, z, { count:5, scale:0.7*s, color:o.color||'#fff6c0' }); },
  sparkle, stars, hearts, dust, dustRing, poof, ring, confetti, fireworks, heal, levelup, shock, magic,
  notes, paws, smoke, purify, flame: flames, ice: iceBurst, thunder, coin, petals, kira, guard, jump: jumpPuff,
};
function burst(kind, x, y, z, opts){
  if(!ready) return;
  const f = B[kind] || B.sparkle;
  try { f(+x||0, +y||0, +z||0, opts||{}); } catch(err){ G.logError('fx.burst '+kind, err); }
}

// ================================================================ weapon trails (all trails = one dynamic mesh, 1 draw call)
const TR_MAX = 8, TR_S = 12, TR_SUB = 3, TR_PTS = (TR_S-1)*TR_SUB + 1;
const TR_V = TR_MAX*TR_PTS*2, TR_I = TR_MAX*(TR_PTS-1)*6;
const trails = [];
let trGeo=null, trMesh=null, trPos=null, trCol=null, trEdge=null, trIdx=null, trAttrP=null, trAttrC=null, trAttrE=null, trAttrI=null;
const _ta = new THREE.Vector3(), _tb = new THREE.Vector3();
function newTrail(){ return { ent:null, on:false, stopping:false, auto:false, atk:null, autoT:0, n:0, drop:0,
  tx:new Float32Array(TR_S), ty:new Float32Array(TR_S), tz:new Float32Array(TR_S), bx:new Float32Array(TR_S), by:new Float32Array(TR_S), bz:new Float32Array(TR_S),
  r:1, g:1, b:1 }; }
const TVS = ['attribute vec4 aCol; attribute float aEdge; varying vec4 vCol; varying float vEdge;',
  'void main(){ vCol = aCol; vEdge = aEdge; vec4 mv = modelViewMatrix * vec4(position, 1.0); mv.z += 0.25; gl_Position = projectionMatrix * mv; }'].join('\n');
const TFS = ['uniform float uAdd; varying vec4 vCol; varying float vEdge;',
  'void main(){',
  '  float e = vEdge;',
  '  vec3 rgb = mix(vCol.rgb*mix(0.8, 1.05, e), vec3(1.0), smoothstep(0.82, 1.0, e)*0.9);',
  '  float a = vCol.a * (0.12 + 0.88*smoothstep(0.0, 0.7, e));',
  '  if(a < 0.003) discard;',
  '  gl_FragColor = vec4(rgb*a, a*(1.0-uAdd));',
  '}'].join('\n');
function buildTrails(){
  trGeo = new THREE.BufferGeometry();
  trPos = new Float32Array(TR_V*3); trCol = new Float32Array(TR_V*4); trEdge = new Float32Array(TR_V); trIdx = new Uint16Array(TR_I);
  trAttrP = new THREE.BufferAttribute(trPos,3).setUsage(THREE.DynamicDrawUsage);
  trAttrC = new THREE.BufferAttribute(trCol,4).setUsage(THREE.DynamicDrawUsage);
  trAttrE = new THREE.BufferAttribute(trEdge,1).setUsage(THREE.DynamicDrawUsage);
  trAttrI = new THREE.BufferAttribute(trIdx,1).setUsage(THREE.DynamicDrawUsage);
  trGeo.setAttribute('position', trAttrP); trGeo.setAttribute('aCol', trAttrC); trGeo.setAttribute('aEdge', trAttrE); trGeo.setIndex(trAttrI);
  trGeo.setDrawRange(0, 0);
  const mat = new THREE.ShaderMaterial({ uniforms:{ uAdd:{ value:0.3 } }, vertexShader:TVS, fragmentShader:TFS,
    transparent:true, depthWrite:false, depthTest:true, side:THREE.DoubleSide,
    blending:THREE.CustomBlending, blendEquation:THREE.AddEquation, blendSrc:THREE.OneFactor, blendDst:THREE.OneMinusSrcAlphaFactor });
  trMesh = new THREE.Mesh(trGeo, mat); trMesh.frustumCulled = false; trMesh.renderOrder = 29; trMesh.visible = false; trMesh.name = 'fxTrails';
  for(let i=0;i<TR_MAX;i++) trails.push(newTrail());
}
function trailColorOf(ent){
  let c = ent.trailColor;
  if(!c) c = TRAIL_COL[ent.type];
  if(!c){ const h = heroInfo(ent.type); c = hexOf(h && h.color); }
  return rgb(c || '#9fe0ff');
}
function findTrail(ent){ for(const t of trails) if(t.on && t.ent===ent) return t; return null; }
function trail(ent, opts){
  if(!ready || !ent || !ent.rig || !ent.rig.tip || !ent.rig.base) return null;
  let t = findTrail(ent);
  if(!t){
    t = null; for(const q of trails) if(!q.on){ t = q; break; }
    if(!t){ // steal the most faded one
      let best = trails[0]; for(const q of trails) if(q.stopping && (!best.stopping || q.n < best.n)) best = q; t = best;
    }
    t.ent = ent; t.on = true; t.n = 0; t.drop = 0;
  }
  t.stopping = false;
  t.auto = !!(opts && opts.auto); t.atk = opts && opts.atk || null; t.autoT = (opts && opts.frames) || 0;
  const c = trailColorOf(ent); t.r = c[0]; t.g = c[1]; t.b = c[2];
  if(opts && opts.color){ const cc = rgb(opts.color); t.r=cc[0]; t.g=cc[1]; t.b=cc[2]; }
  return t;
}
function trailStop(ent){ const t = findTrail(ent); if(t) t.stopping = true; }
function trShift(t){ t.tx.copyWithin(0,1); t.ty.copyWithin(0,1); t.tz.copyWithin(0,1); t.bx.copyWithin(0,1); t.by.copyWithin(0,1); t.bz.copyWithin(0,1); t.n--; }
function cr1(a, n, i, t){
  const p0=a[i>0?i-1:0], p1=a[i], p2=a[i+1<n?i+1:n-1], p3=a[i+2<n?i+2:n-1];
  const t2=t*t, t3=t2*t;
  return 0.5*((2*p1) + (p2-p0)*t + (2*p0-5*p1+4*p2-p3)*t2 + (3*p1-p0-3*p2+p3)*t3);
}
function updateTrails(k){
  let v = 0, ii = 0;
  for(let q=0;q<trails.length;q++){
    const t = trails[q]; if(!t.on) continue;
    const e = t.ent;
    if(!e || e.removed || !e.rig || !e.rig.tip || !e.rig.base) t.stopping = true;
    if(t.auto && !t.stopping){ t.autoT -= k; if(t.autoT <= 0 || (t.atk && e.atk !== t.atk)) t.stopping = true; }
    if(!t.stopping){
      e.rig.tip.getWorldPosition(_ta); e.rig.base.getWorldPosition(_tb);
      const L = t.n-1;
      const moved = t.n===0 || ((_ta.x-t.tx[L])**2 + (_ta.y-t.ty[L])**2 + (_ta.z-t.tz[L])**2) > 1e-5;
      if(moved){
        if(t.n === TR_S) trShift(t);
        const m = t.n++;
        t.tx[m]=_ta.x; t.ty[m]=_ta.y; t.tz[m]=_ta.z; t.bx[m]=_tb.x; t.by[m]=_tb.y; t.bz[m]=_tb.z;
        if(m>0){ const sp2 = (_ta.x-t.tx[m-1])**2 + (_ta.y-t.ty[m-1])**2; if(sp2 > 0.015 && rnd() < 0.5){
          sp(T.spark, _ta.x, _ta.y, _ta.z+0.1); S.s0 = R(0.16,0.28); S.curve = 3; S.life = 14; S.add = 1; S.r=Math.min(1,t.r*0.5+0.5); S.g=Math.min(1,t.g*0.5+0.5); S.b=Math.min(1,t.b*0.5+0.5); emit(); } }
      } else if(!(G.hitStop > 0)){ t.drop += k; }       // not moving: retract (but freeze during hitstop)
    } else t.drop += k*1.5;
    while(t.drop >= 1 && t.n > 0){ t.drop -= 1; if(t.n > 1 || t.stopping) trShift(t); else break; }
    if(t.stopping && t.n < 2){ t.on = false; t.ent = null; continue; }
    const n = t.n; if(n < 2) continue;
    // ribbon: Catmull-Rom smoothed, oldest end narrow & transparent, newest end = the blade
    const M = (n-1)*TR_SUB + 1, v0 = v;
    for(let m=0;m<M;m++){
      const i = Math.min(n-2, (m/TR_SUB)|0), tt = m===M-1 ? 1 : (m - i*TR_SUB)/TR_SUB;
      const X = cr1(t.tx,n,i,tt), Y = cr1(t.ty,n,i,tt), Z = cr1(t.tz,n,i,tt);
      const bxv = cr1(t.bx,n,i,tt), byv = cr1(t.by,n,i,tt), bzv = cr1(t.bz,n,i,tt);
      const u = m/(M-1), w = 0.2 + 0.8*u, a = Math.pow(u, 1.25)*0.95;
      let o = v*3; trPos[o]=X; trPos[o+1]=Y; trPos[o+2]=Z;
      o = v*4; trCol[o]=t.r; trCol[o+1]=t.g; trCol[o+2]=t.b; trCol[o+3]=a; trEdge[v]=1; v++;
      o = v*3; trPos[o]=X+(bxv-X)*w; trPos[o+1]=Y+(byv-Y)*w; trPos[o+2]=Z+(bzv-Z)*w;
      o = v*4; trCol[o]=t.r; trCol[o+1]=t.g; trCol[o+2]=t.b; trCol[o+3]=a*0.9; trEdge[v]=0; v++;
    }
    for(let m=0;m<M-1;m++){ const a0 = v0 + m*2; trIdx[ii++]=a0; trIdx[ii++]=a0+1; trIdx[ii++]=a0+2; trIdx[ii++]=a0+1; trIdx[ii++]=a0+3; trIdx[ii++]=a0+2; }
  }
  trGeo.setDrawRange(0, ii);
  trMesh.visible = ii > 0;
  if(ii > 0){ updRange(trAttrP, v*3); updRange(trAttrC, v*4); updRange(trAttrE, v); updRange(trAttrI, ii); }
}
function updRange(a, n){
  if(a.clearUpdateRanges){ a.clearUpdateRanges(); a.addUpdateRange(0, n); }
  else if(a.updateRange){ a.updateRange.offset = 0; a.updateRange.count = n; }
  a.needsUpdate = true;
}

// ================================================================ DOM overlay: popups, "!", flash, speed lines, cut-in
function ringShadow(r, col, n){ const a=[]; for(let i=0;i<n;i++){ const t=i/n*TAU; a.push((Math.cos(t)*r).toFixed(3)+'em '+(Math.sin(t)*r).toFixed(3)+'em 0 '+col); } return a.join(','); }
const FONT = "'M PLUS Rounded 1c','Hiragino Maru Gothic ProN','BIZ UDPGothic','Yu Gothic',sans-serif";
function outline(col, r){ r = r||0.085; return ringShadow(r,col,16)+','+ringShadow(r*0.5,col,10)+',0 '+(r*1.6).toFixed(3)+'em 0 '+col; }
function buildCSS(){
  return [
  '.fxL,.fxT{position:absolute;left:0;top:0;right:0;bottom:0;overflow:hidden;pointer-events:none}',
  '.fxT{z-index:40}',
  '.fxp,.fxa{position:absolute;left:0;top:0;white-space:nowrap;line-height:1.08;font-weight:900;visibility:hidden;will-change:transform,opacity;font-family:'+FONT+';letter-spacing:.01em;transform-origin:50% 50%}',
  '.fxp.dmg{font-size:clamp(25px,6.2vmin,48px);color:#ffe45a;letter-spacing:-.02em;text-shadow:'+outline('#3b2417',0.1)+'}',
  '.fxp.hurt{font-size:clamp(21px,5vmin,38px);color:#ffa0c4;text-shadow:'+outline('#5a1a2e',0.1)+'}',
  '.fxp.heal{font-size:clamp(22px,5.4vmin,42px);color:#9dff7a;text-shadow:'+outline('#1f5a2a',0.1)+'}',
  '.fxp.crit,.fxp.lvup{font-size:clamp(32px,8.4vmin,66px);color:#3b2417;text-shadow:'+outline('#3b2417',0.1)+'}',
  '.fxp.lvup{font-size:clamp(24px,6vmin,48px)}',
  '.fxp.crit::after,.fxp.lvup::after{content:attr(data-t);position:absolute;left:0;top:0;text-shadow:none;-webkit-background-clip:text;background-clip:text;color:transparent;' +
    'background-image:linear-gradient(180deg,#fffbd0 0%,#ffd23a 42%,#ff8a1a 78%,#ff5a2a 100%)}',
  '.fxp.lvup::after{background-image:linear-gradient(180deg,#ffffff 0%,#fff27a 34%,#8dff7a 68%,#4ad0ff 100%)}',
  '.fxp.onoma{font-size:clamp(26px,7vmin,54px);color:#fff;letter-spacing:-.03em;text-shadow:'+ringShadow(0.06,'var(--oc)',12)+','+ringShadow(0.13,'#3b2417',18)+','+ringShadow(0.095,'#3b2417',12)+',0 .17em 0 #3b2417}',
  '.fxp.big{font-size:clamp(40px,13vmin,128px);color:#fff;text-shadow:'+ringShadow(0.05,'var(--oc)',12)+','+ringShadow(0.1,'#3b2417',18)+','+ringShadow(0.075,'#3b2417',12)+',0 .12em 0 #3b2417}',
  '.fxp.info{font-size:clamp(15px,3.6vmin,24px);color:#5a3418;background:#fffdf6;border-radius:999px;padding:.4em .9em .35em;box-shadow:0 0 0 .16em #ffcf6a,0 .22em 0 .16em #c98a2a}',
  '.fxp.say{font-size:clamp(15px,3.8vmin,26px);color:#4a2c14;background:#fff;border:.14em solid #3b2417;border-radius:1em;padding:.3em .7em;box-shadow:0 .15em 0 rgba(59,36,23,.35)}',
  '.fxp.say::after{content:"";position:absolute;left:50%;bottom:-.5em;margin-left:-.4em;border-left:.4em solid transparent;border-right:.4em solid transparent;border-top:.5em solid #3b2417}',
  '.fxa{font-size:clamp(20px,4.8vmin,36px);width:1.45em;height:1.45em;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;' +
    'background:radial-gradient(circle at 35% 30%,#ffb08a 0%,#ff5a3a 55%,#e8322a 100%);border:.12em solid #3b2417;box-shadow:0 .1em 0 #3b2417;text-shadow:0 .06em 0 #7a1a0a}',
  '.fxa::after{content:"";position:absolute;left:50%;bottom:-.36em;margin-left:-.2em;border-left:.2em solid transparent;border-right:.2em solid transparent;border-top:.3em solid #3b2417}',
  '.fxf{position:absolute;left:0;top:0;width:100%;height:100%;opacity:0;visibility:hidden}',
  '.fxs{position:absolute;left:0;top:0;width:100%;height:100%;visibility:hidden}',
  '.fxcut{position:absolute;left:0;top:0;width:100%;height:100%;overflow:hidden;display:none;font-family:'+FONT+'}',
  '.fxcut .cdim{position:absolute;left:0;top:0;width:100%;height:100%;background:radial-gradient(ellipse at 50% 50%,rgba(60,20,90,.2),rgba(40,10,70,.62))}',
  '.fxcut .cband{position:absolute;left:-25%;width:150%;top:28%;height:44%;overflow:hidden;border-top:.8vmin solid #fff;border-bottom:.8vmin solid #fff;box-shadow:0 0 0 1vmin rgba(59,36,23,.55)}',
  '.fxcut .cstripe{position:absolute;left:0;top:0;width:100%;height:100%;background-image:repeating-linear-gradient(100deg,rgba(255,255,255,.32) 0 18px,rgba(255,255,255,0) 18px 54px)}',
  '.fxcut .cedge{position:absolute;left:0;top:0;width:100%;height:100%;background:linear-gradient(180deg,rgba(255,255,255,.45) 0%,rgba(255,255,255,0) 22%,rgba(0,0,0,0) 78%,rgba(0,0,0,.18) 100%)}',
  '.fxcut .cport{position:absolute;top:50%}',
  '.fxcut .cport canvas{width:100%;height:100%;display:block}',
  '.fxcut .cname{position:absolute;top:50%;white-space:nowrap;transform-origin:0 50%}',
  '.fxcut .clabel{display:inline-block;font-size:clamp(14px,4vmin,30px);font-weight:900;color:#5a3418;background:#fff27a;border-radius:999px;padding:.12em .7em;box-shadow:0 .15em 0 #c98a2a,0 0 0 .12em #3b2417;margin:0 0 .25em .1em;transform-origin:0 100%}',
  '.fxcut .ctext{font-size:clamp(30px,11vmin,100px);font-weight:900;color:#fff;line-height:1.1;text-shadow:'+ringShadow(0.05,'var(--hcd)',12)+','+ringShadow(0.1,'#3b2417',18)+','+ringShadow(0.075,'#3b2417',12)+',0 .11em 0 #3b2417}',
  '.fxcut .csp{position:absolute;left:0;top:0;width:6vmin;height:6vmin;background:#fff;clip-path:polygon(50% 0,61% 39%,100% 50%,61% 61%,50% 100%,39% 61%,0 50%,39% 39%)}',
  ].join('\n');
}
let uiRoot=null, layer=null, top=null, flashEl=null, speedHost=null;
const POP_MAX = 24, ALERT_MAX = 10;
const pops = [], alerts = [];
const STY = { dmg:52, hurt:48, crit:64, heal:56, info:80, big:100, onoma:46, lvup:90, say:80 };
const _sp = { x:0, y:0, visible:true };
const _pv = new THREE.Vector3();
function project(x, y, z){
  _pv.set(x, y, z).project(G.camera);
  _sp.x = (_pv.x*0.5 + 0.5)*G.view.w; _sp.y = (-_pv.y*0.5 + 0.5)*G.view.h;
  _sp.visible = _pv.z < 1 && _pv.z > -1 && Math.abs(_pv.x) < 3 && Math.abs(_pv.y) < 3;
  return _sp;
}
function buildDOM(){
  uiRoot = document.getElementById('ui');
  if(!uiRoot){ uiRoot = document.createElement('div'); uiRoot.id = 'ui'; uiRoot.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:10'; document.body.appendChild(uiRoot); }
  const st = document.createElement('style'); st.id = 'fxStyle'; st.textContent = buildCSS(); document.head.appendChild(st);
  layer = document.createElement('div'); layer.className = 'fxL'; uiRoot.insertBefore(layer, uiRoot.firstChild);   // under the HUD
  top = document.createElement('div'); top.className = 'fxT'; uiRoot.appendChild(top);                           // over the HUD
  for(let i=0;i<POP_MAX;i++){ const el = document.createElement('div'); el.className = 'fxp'; layer.appendChild(el);
    pops.push({ el, on:false, style:'', t:0, life:1, x:0,y:0,z:0, ox:0, oy:0, vx:0, vy:0, rot0:0, w:0, h:0, ent:null, seed:0, shown:false }); }
  for(let i=0;i<ALERT_MAX;i++){ const el = document.createElement('div'); el.className = 'fxa'; el.textContent = '!'; layer.appendChild(el);
    alerts.push({ el, on:false, ent:null, t:0, life:40, w:0, h:0, shown:false }); }
  // stacking inside the top layer: [cut-in dim] [speed lines] [cut-in band/name] [flash]
  speedHost = document.createElement('div'); speedHost.className = 'fxL'; top.appendChild(speedHost);
  flashEl = document.createElement('div'); flashEl.className = 'fxf'; top.appendChild(flashEl);
}
function vs(){ return clamp((G.view && G.view.h || 720)/720, 0.55, 1.4); }

function text(str, x, y, z, style, opts){
  if(!ready || str==null) return false;
  style = STY[style] ? style : 'info';
  opts = opts || {};
  // free slot, else recycle the oldest (never recycle a 'big' while another is available)
  let p = null, best = null, bestK = -1;
  for(const q of pops){ if(!q.on){ p = q; break; } const kq = q.t/q.life + (q.style==='big' ? -1 : 0); if(kq > bestK){ bestK = kq; best = q; } }
  if(!p) p = best;
  const el = p.el;
  el.className = 'fxp ' + style;
  el.textContent = String(str);
  if(style==='crit' || style==='lvup') el.setAttribute('data-t', String(str)); else el.removeAttribute('data-t');
  const K = vs();
  p.on = true; p.style = style; p.t = 0; p.life = opts.life || STY[style]; p.x = +x||0; p.y = +y||0; p.z = +z||0; p.ent = opts.ent || null;
  p.w = 0; p.h = 0; p.seed = rnd(); p.ox = 0; p.oy = 0; p.shown = false;
  p.rot0 = style==='onoma' ? R(-13,13) : style==='crit' ? -6 : 0;
  p.vx = (style==='dmg'||style==='hurt'||style==='crit') ? R(-1.1,1.1)*K : 0;
  p.vy = style==='dmg' ? -7.2*K : style==='hurt' ? -5.5*K : style==='crit' ? -8.5*K : 0;
  if(style==='onoma'){ p.ox = R(-26,26)*K; p.oy = R(-20,0)*K; }
  const oc = opts.color || (style==='big' ? '#ff8a3a' : '#ff7a1a');
  el.style.setProperty('--oc', oc);
  el.style.opacity = '0';
  return true;
}
function updatePops(k){
  const W = G.view.w, H = G.view.h, K = vs();
  // read phase: measure new popups (one layout for all of them)
  for(const p of pops) if(p.on && !p.w){ p.w = p.el.offsetWidth || 40; p.h = p.el.offsetHeight || 30; }
  for(const p of pops){
    if(!p.on) continue;
    p.t += k;
    const t = p.t, L = p.life, el = p.el;
    if(t >= L){ p.on = false; el.style.visibility = 'hidden'; p.shown = false; continue; }
    let cx, cy;
    if(p.style==='big'){ cx = W/2; cy = H*0.4; }
    else {
      let X = p.x, Y = p.y, Z = p.z;
      if(p.ent){ const e = p.ent, rp = e.rig && e.rig.root ? e.rig.root.position : e; X += rp.x; Y += rp.y; Z += rp.z; if(e.removed) p.ent = null; }
      project(X, Y, Z); cx = _sp.x; cy = _sp.y;
      if(!_sp.visible){ el.style.visibility = 'hidden'; p.shown = false; continue; }
    }
    let s = 1, rot = p.rot0, a = 1, extra = '';
    switch(p.style){
      case 'dmg': case 'hurt': case 'crit': {
        p.vy += 0.55*K*k; p.oy += p.vy*k; p.ox += p.vx*k;
        if(p.oy > 0 && p.vy > 0){ p.oy = 0; p.vy *= -0.42; if(Math.abs(p.vy) < 1.2*K) p.vy = 0; }
        const pk = p.style==='crit' ? 1.65 : 1.4;
        s = t < 6 ? 0.3 + (pk-0.3)*(t/6) : t < 12 ? pk + (1-pk)*((t-6)/6) : 1;
        if(t > L*0.55){ p.oy -= 0.6*K*k; }
        if(p.style==='crit' && t < 12){ p.ox += (rnd()*2-1)*2.5; }
        a = 1 - smooth(t, L-14, L); s *= 1 - 0.25*smooth(t, L-10, L);
        break; }
      case 'onoma':
        s = t < 10 ? 0.2 + 1.25*backOut(t/7) - 0.25*smooth(t,6,10) : 1 + 0.04*Math.sin(t*0.5);
        rot = p.rot0 + Math.sin(t*0.8 + p.seed*6)*8*Math.max(0, 1 - t/26);
        p.oy -= 0.45*K*k; a = 1 - smooth(t, L-10, L); extra = ' skewX(-7deg)';
        break;
      case 'heal': case 'lvup':
        s = t < 8 ? 0.3 + 0.9*backOut(t/8) : 1; p.oy -= (p.style==='heal' ? 1.0 : 0.7)*K*k*Math.max(0.25, 1 - t/L);
        a = 1 - smooth(t, L-14, L); rot = Math.sin(t*0.2)*3;
        break;
      case 'info':
        s = t < 8 ? 0.6 + 0.4*backOut(t/8) : 1; p.oy -= 0.5*K*k; a = smooth(t, 0, 6)*(1 - smooth(t, L-16, L));
        break;
      case 'say':
        s = t < 8 ? backOut(t/8) : 1; rot = Math.sin(t*0.3)*2; a = 1 - smooth(t, L-10, L); p.oy = -8*K;
        break;
      case 'big':
        s = t < 18 ? U.easeOutElastic(t/18) : 1 + 0.25*smooth(t, L-16, L); p.oy = Math.sin(t*0.12)*4*K; a = 1 - smooth(t, L-16, L);
        rot = t < 18 ? (1-t/18)*-8 : 0;
        break;
    }
    // keep inside the screen (never clipped by an edge)
    if(p.w*s > W-12) s = (W-12)/p.w;
    const hw = p.w*s/2 + 6, hh = p.h*s/2 + 6;
    const X = clamp(cx + p.ox, hw, Math.max(hw, W-hw)), Y = clamp(cy + p.oy, hh, Math.max(hh, H-hh));
    el.style.transform = 'translate3d('+(X - p.w/2).toFixed(1)+'px,'+(Y - p.h/2).toFixed(1)+'px,0) scale('+Math.max(0.01,s).toFixed(3)+') rotate('+rot.toFixed(1)+'deg)'+extra;
    el.style.opacity = a.toFixed(3);
    if(!p.shown){ el.style.visibility = 'visible'; p.shown = true; }
  }
}

function alert(ent){
  if(!ready || !ent) return;
  let a = null;
  for(const q of alerts) if(q.on && q.ent===ent){ a = q; break; }
  if(!a) for(const q of alerts) if(!q.on){ a = q; break; }
  if(!a){ a = alerts[0]; for(const q of alerts) if(q.t > a.t) a = q; }
  a.on = true; a.ent = ent; a.t = 0; a.life = 40;
}
function alertClear(ent){ for(const q of alerts) if(q.on && (!ent || q.ent===ent)){ q.on = false; q.el.style.visibility = 'hidden'; q.shown = false; } }
function updateAlerts(k){
  const W = G.view.w, H = G.view.h;
  for(const q of alerts) if(q.on && !q.w){ q.w = q.el.offsetWidth || 36; q.h = q.el.offsetHeight || 36; }
  for(const q of alerts){
    if(!q.on) continue;
    q.t += k;
    const e = q.ent;
    if(q.t >= q.life || !e || e.dead || e.removed){ q.on = false; q.el.style.visibility = 'hidden'; q.shown = false; continue; }
    const rp = e.rig && e.rig.root ? e.rig.root.position : e;
    const hgt = (e.rig && e.rig.height) || e.height || 1.2;
    project(rp.x, rp.y + hgt + 0.3, rp.z);
    if(!_sp.visible){ q.el.style.visibility = 'hidden'; q.shown = false; continue; }
    const t = q.t;
    let s = t < 7 ? backOut(t/7)*1.15 : 1 + 0.06*Math.sin(t*0.9);
    if(t > q.life-5) s *= Math.max(0, (q.life - t)/5);
    const rot = Math.sin(t*0.7)*10*Math.max(0.3, 1 - t/20);
    const hw = q.w*s/2 + 4, hh = q.h*s/2 + 4;
    const X = clamp(_sp.x, hw, W-hw), Y = clamp(_sp.y - q.h*0.5 - 6*s, hh, H-hh);
    q.el.style.transform = 'translate3d('+(X - q.w/2).toFixed(1)+'px,'+(Y - q.h/2).toFixed(1)+'px,0) scale('+Math.max(0.01,s).toFixed(3)+') rotate('+rot.toFixed(1)+'deg)';
    if(!q.shown){ q.el.style.visibility = 'visible'; q.shown = true; }
  }
}

// full-screen flash (kid-safe: at most 3 strong flashes per second, alpha ≤ 0.8)
const fl = { a:0, t:0, dur:1, on:false, starts:[] };
function flash(color, alpha, frames){
  if(!ready) return;
  alpha = clamp(alpha==null ? 0.6 : +alpha, 0, 0.8); frames = Math.max(2, frames||10);
  const now = fxT; fl.starts = fl.starts.filter(s=> now - s < 60);
  if(fl.starts.length >= 3) alpha *= 0.3;
  const cur = fl.on ? fl.a*(1 - fl.t/fl.dur) : 0;
  if(alpha < cur) return;
  fl.starts.push(now);
  fl.a = alpha; fl.t = 0; fl.dur = frames; fl.on = true;
  flashEl.style.background = color || '#ffffff';
  flashEl.style.visibility = 'visible';
}
function updateFlash(k){
  if(!fl.on) return;
  fl.t += k;
  if(fl.t >= fl.dur){ fl.on = false; flashEl.style.opacity = '0'; flashEl.style.visibility = 'hidden'; return; }
  const q = 1 - fl.t/fl.dur;
  flashEl.style.opacity = (fl.a * q * Math.sqrt(q)).toFixed(3);
}

// anime radial speed lines: 3 pre-drawn canvases, swapped every 3 frames (no per-frame drawing)
const sl = { cvs:[], t:0, dur:0, on:false, dirty:true, cur:-1, w:0, h:0 };
function drawSpeed(cv, seed){
  const w = cv.width, h = cv.height, x = cv.getContext('2d');
  let s = seed*9301 + 49297; const rn = ()=>{ s = (s*9301 + 49297) % 233280; return s/233280; };
  x.clearRect(0,0,w,h);
  const cx = w/2, cy = h*0.46, Rr = Math.hypot(w,h)*0.62, ax = w*0.3, ay = h*0.3;
  const g = x.createRadialGradient(cx,cy,Math.min(w,h)*0.3, cx,cy,Rr);
  g.addColorStop(0,'rgba(255,255,255,0)'); g.addColorStop(1,'rgba(255,255,255,0.5)');
  x.fillStyle = g; x.fillRect(0,0,w,h);
  const N = 120, k = Math.max(w,h)/1000;
  for(let i=0;i<N;i++){
    const a = (i + rn())/N*TAU, c = Math.cos(a), si = Math.sin(a);
    const re = 1/Math.sqrt((c/ax)*(c/ax) + (si/ay)*(si/ay));
    const r0 = re*(1.0 + rn()*0.9), wid = (1.5 + rn()*6)*k;
    x.beginPath(); x.moveTo(cx + c*r0, cy + si*r0);
    x.lineTo(cx + c*Rr - si*wid, cy + si*Rr + c*wid); x.lineTo(cx + c*Rr + si*wid, cy + si*Rr - c*wid); x.closePath();
    x.fillStyle = i%7===0 ? 'rgba(255,236,150,0.92)' : 'rgba(255,255,255,0.9)'; x.fill();
    x.strokeStyle = 'rgba(70,40,110,0.18)'; x.lineWidth = 1; x.stroke();
  }
}
function ensureSpeed(){
  const W = G.view.w, H = G.view.h;
  if(!sl.cvs.length){ for(let i=0;i<3;i++){ const c = document.createElement('canvas'); c.className = 'fxs'; speedHost.appendChild(c); sl.cvs.push(c); } }
  if(sl.dirty || sl.w !== W || sl.h !== H){
    const sc = Math.min(1, 1100/Math.max(W,H,1));
    for(let i=0;i<3;i++){ const c = sl.cvs[i]; c.width = Math.max(2, Math.round(W*sc)); c.height = Math.max(2, Math.round(H*sc)); drawSpeed(c, i*17+3); }
    sl.w = W; sl.h = H; sl.dirty = false;
  }
}
function speedLines(frames){
  if(!ready) return;
  ensureSpeed();
  frames = Math.max(4, frames||30);
  if(sl.on){ sl.dur = Math.max(sl.dur - sl.t, frames) + Math.min(sl.t, 6); sl.t = Math.min(sl.t, 6); }
  else { sl.t = 0; sl.dur = frames; sl.on = true; }
}
function updateSpeed(k){
  if(!sl.on) return;
  sl.t += k;
  if(sl.t >= sl.dur){ sl.on = false; for(const c of sl.cvs) c.style.visibility = 'hidden'; sl.cur = -1; return; }
  const idx = ((fxT/3)|0) % 3;
  const op = smooth(sl.t, 0, 4) * (1 - smooth(sl.t, sl.dur-8, sl.dur)) * 0.9;
  for(let i=0;i<3;i++){ const c = sl.cvs[i]; if(i===idx){ c.style.visibility = 'visible'; c.style.opacity = op.toFixed(3); } else if(sl.cur===i || sl.cur<0) c.style.visibility = 'hidden'; }
  sl.cur = idx;
}

// ---------------------------------------------------------------- ult cut-in (~70 frames, driven by frame(dt))
const cut = { on:false, t:0, dur:70, done:null, heroId:null, el:null, dim:null, band:null, stripe:null, port:null, cv:null, name:null, label:null, txt:null,
  sps:[], spd:[], fit:1, pw:0, portrait:false, flashed:false, wd:0, id:0 };
function buildCut(){
  const el = document.createElement('div'); el.className = 'fxcut';
  el.innerHTML = '<div class="cband"><div class="cstripe"></div><div class="cedge"></div></div>' +
    '<div class="cport"><canvas width="256" height="256"></canvas></div><div class="cname"><div class="clabel">おうぎ！</div><div class="ctext"></div></div>';
  // the dim sits under the speed lines (so the lines stay white), the band/portrait/name over them
  const dim = document.createElement('div'); dim.className = 'fxcut'; dim.innerHTML = '<div class="cdim"></div>'; top.insertBefore(dim, speedHost);
  cut.dimWrap = dim; cut.el = el; cut.dim = dim.firstChild; cut.band = el.querySelector('.cband'); cut.stripe = el.querySelector('.cstripe');
  cut.port = el.querySelector('.cport'); cut.cv = el.querySelector('canvas'); cut.name = el.querySelector('.cname'); cut.label = el.querySelector('.clabel'); cut.txt = el.querySelector('.ctext');
  for(let i=0;i<10;i++){ const s = document.createElement('div'); s.className = 'csp'; el.appendChild(s); cut.sps.push(s); cut.spd.push({ x:0, y:0, ph:0, sz:1 }); }
  top.insertBefore(el, flashEl);   // over the speed lines, under the flash
}
function drawPortrait(heroId, col){
  const cv = cut.cv, x = cv.getContext('2d'), S2 = 256;
  x.setTransform(1,0,0,1,0,0); x.clearRect(0,0,S2,S2);
  // ears (dog!) behind the medallion
  x.fillStyle = css(col, 0.35, 'k'); x.strokeStyle = '#3b2417'; x.lineWidth = 8;
  for(const sgn of [-1,1]){ x.beginPath(); x.ellipse(128+sgn*78, 70, 30, 46, sgn*0.5, 0, TAU); x.fill(); x.stroke(); }
  // medallion
  const g = x.createRadialGradient(108,100,10,128,128,112); g.addColorStop(0, css(col,0.55,'w')); g.addColorStop(0.7, css(col,0,'w')); g.addColorStop(1, css(col,0.25,'k'));
  x.fillStyle = g; x.beginPath(); x.arc(128,136,108,0,TAU); x.fill();
  let drew = false, src = null;
  try { if(G.heroes && typeof G.heroes.portrait === 'function') src = G.heroes.portrait(heroId); } catch(err){ G.logError('fx.cutin portrait', err); }
  if(src && src.isTexture) src = src.image;
  const drawSrc = (im)=>{ const sw = im.width||im.videoWidth||256, sh = im.height||im.videoHeight||256, k = Math.max(216/sw, 216/sh);
    x.save(); x.beginPath(); x.arc(128,136,104,0,TAU); x.clip(); x.drawImage(im, 128 - sw*k/2, 136 - sh*k/2, sw*k, sh*k); x.restore(); };
  if(src){
    try {
      if(typeof src === 'string'){ const im = new Image(); im.onload = ()=>{ try { drawSrc(im); ringP(); } catch(_){} }; im.src = src; drew = true; }
      else if((typeof HTMLCanvasElement!=='undefined' && src instanceof HTMLCanvasElement) || (typeof ImageBitmap!=='undefined' && src instanceof ImageBitmap) ||
              (typeof OffscreenCanvas!=='undefined' && src instanceof OffscreenCanvas)){ drawSrc(src); drew = true; }
      else if(typeof HTMLImageElement!=='undefined' && src instanceof HTMLImageElement){
        if(src.complete && src.naturalWidth){ drawSrc(src); drew = true; } else { src.addEventListener('load', ()=>{ try { drawSrc(src); ringP(); } catch(_){} }, { once:true }); drew = true; } }
    } catch(err){ G.logError('fx.cutin portrait draw', err); drew = false; }
  }
  if(!drew){
    const h = heroInfo(heroId);
    const nm = String((h && (h.short || h.name)) || heroId || '?');
    let ch = Array.from(nm)[0] || '?'; if(/[a-z]/.test(ch)) ch = ch.toUpperCase();
    x.font = '900 128px ' + FONT; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.lineJoin = 'round'; x.lineWidth = 16; x.strokeStyle = '#3b2417'; x.strokeText(ch, 128, 144);
    x.fillStyle = '#ffffff'; x.fillText(ch, 128, 144);
    // cheeks
    x.fillStyle = 'rgba(255,150,180,0.8)'; x.beginPath(); x.ellipse(72,176,16,9,0,0,TAU); x.fill(); x.beginPath(); x.ellipse(184,176,16,9,0,0,TAU); x.fill();
  }
  ringP();
  function ringP(){ x.lineWidth = 10; x.strokeStyle = '#ffffff'; x.beginPath(); x.arc(128,136,108,0,TAU); x.stroke();
    x.lineWidth = 5; x.strokeStyle = '#3b2417'; x.beginPath(); x.arc(128,136,114,0,TAU); x.stroke();
    x.fillStyle = '#ffffff'; x.globalAlpha = 0.85; x.beginPath(); x.ellipse(82,86,16,9,-0.7,0,TAU); x.fill(); x.globalAlpha = 1; }
}
function cutin(heroId, name, done){
  if(!ready){ if(typeof done==='function') try { done(); } catch(_){} return; }
  if(!cut.el) buildCut();
  if(cut.on){
    // same ult announced twice (bus 'ult' + direct call in the same moment): merge instead of restarting
    if(cut.heroId === heroId && cut.t < 4){ if(typeof done==='function'){ if(cut.done && cut.done!==done){ const d0 = cut.done; cut.done = ()=>{ d0(); done(); }; } else cut.done = done; } if(name) cut.txt.textContent = name; return; }
    finishCut(true);
  }
  const col = heroColor(heroId);
  cut.on = true; cut.t = 0; cut.done = (typeof done==='function') ? done : null; cut.heroId = heroId; cut.flashed = false; cut.id++;
  cut.band.style.background = 'linear-gradient(180deg,'+css(col,0.45,'w')+' 0%,'+css(col,0,'w')+' 46%,'+css(col,0.3,'k')+' 100%)';
  cut.el.style.setProperty('--hcd', css(col, 0.3, 'k'));
  cut.txt.textContent = name || 'おうぎ！';
  drawPortrait(heroId, col);
  cut.el.style.display = 'block'; cut.dimWrap.style.display = 'block';
  // layout (landscape: portrait left, name right / portrait: portrait top, name below)
  const W = G.view.w, H = G.view.h, mn = Math.min(W,H);
  cut.portrait = H > W*0.95;
  const pw = cut.pw = Math.min(mn*(cut.portrait ? 0.42 : 0.4), 270);
  const ps = cut.port.style; ps.width = pw+'px'; ps.height = pw+'px';
  let avail;
  if(!cut.portrait){ ps.left = (W*0.08)+'px'; ps.top = '50%'; cut.name.style.left = (W*0.08 + pw + mn*0.04)+'px'; cut.name.style.top = '50%'; avail = W - (W*0.08 + pw + mn*0.04) - W*0.04; }
  else { ps.left = ((W-pw)/2)+'px'; ps.top = '38%'; cut.name.style.left = (W*0.05)+'px'; cut.name.style.top = '64%'; avail = W*0.9; }
  cut.name.style.transform = 'none';
  const nw = cut.name.offsetWidth || 1;           // one layout per cut-in
  cut.fit = Math.min(1, avail / nw);
  for(const d of cut.spd){ d.x = R(0.05,0.95)*W; d.y = R(0.25,0.75)*H; d.ph = R(0,TAU); d.sz = R(0.6,1.4); }
  speedLines(64);
  if(cut.wd) clearTimeout(cut.wd);
  const id = cut.id;
  if(!G.testMode) cut.wd = setTimeout(()=>{ if(cut.on && cut.id===id) finishCut(true); }, 4000);   // never leave the game waiting
  updateCut(0);
}
function finishCut(callDone){
  if(!cut.on) return;
  cut.on = false; cut.el.style.display = 'none'; cut.dimWrap.style.display = 'none';
  if(cut.wd){ clearTimeout(cut.wd); cut.wd = 0; }
  const d = cut.done; cut.done = null;
  if(callDone && d){ try { d(); } catch(err){ G.logError('fx.cutin done', err); } }
}
function updateCut(k){
  if(!cut.on) return;
  cut.t += k;
  const t = cut.t, W = G.view.w;
  cut.dim.style.opacity = (smooth(t,0,8)*(1 - smooth(t,60,70))).toFixed(3);
  const exit = t > 58 ? cubicIn((t-58)/12) : 0;
  const bx = t < 10 ? -130*(1 - cubicOut(t/10)) : 130*exit;
  const by = t < 10 ? 0.45 + 0.55*backOut(t/10) : 1;
  cut.band.style.transform = 'translateX('+bx.toFixed(2)+'%) rotate(-7deg) scaleY('+by.toFixed(3)+')';
  cut.stripe.style.backgroundPosition = (-t*22).toFixed(0)+'px 0';
  const q = clamp((t-4)/10, 0, 1);
  const pxv = -W*0.6*(1 - backOut(q)) + W*1.3*exit;
  cut.port.style.transform = 'translate('+pxv.toFixed(1)+'px,calc(-50% + '+(Math.sin(t*0.16)*4).toFixed(1)+'px)) scale('+(0.7 + 0.3*backOut(q)).toFixed(3)+') rotate('+((1-q)*-20).toFixed(1)+'deg)';
  cut.port.style.opacity = q > 0 ? '1' : '0';
  const qn = clamp((t-10)/10, 0, 1);
  const ns = 1 + 1.6*(1 - cubicOut(qn));
  const sh = (t > 10 && t < 18) ? (rnd()*2-1)*5 : 0;
  const nx = W*0.9*exit;
  cut.name.style.transform = 'translate('+(nx+sh).toFixed(1)+'px,calc(-50% + '+(sh*0.6).toFixed(1)+'px)) scale('+(ns*cut.fit).toFixed(3)+')';
  cut.name.style.opacity = qn > 0 ? (Math.min(1, qn*3)*(1 - smooth(t,62,70))).toFixed(3) : '0';
  cut.label.style.transform = 'scale('+backOut(clamp((t-7)/7,0,1)).toFixed(3)+') rotate(-4deg)';
  for(let i=0;i<cut.sps.length;i++){
    const d = cut.spd[i], s = (t > 10 && t < 64) ? Math.max(0, Math.sin(t*0.3 + d.ph))*d.sz : 0;
    cut.sps[i].style.transform = 'translate('+d.x.toFixed(0)+'px,'+d.y.toFixed(0)+'px) scale('+s.toFixed(3)+') rotate('+(t*4).toFixed(0)+'deg)';
  }
  if(!cut.flashed && t >= 11){ cut.flashed = true; flash('#ffffff', 0.3, 8); }
  if(t >= cut.dur) finishCut(true);
}

// ================================================================ bus → effects
let hitsThisFrame = 0;
function headY(e){ return (e.y||0) + ((e.rig && e.rig.height) || e.height || 1.2); }
function onHit(d){
  hitsThisFrame++;
  const tg = d.target;
  const power = d.power||1, kind = KIND[d.kind] ? d.kind : 'slash';
  let x = d.x, y = d.y, z = d.z;
  if(x==null && tg){ x = tg.x; y = tg.y + (tg.height||1.2)*0.55; z = tg.z; }
  if(x==null) return;
  const zr = tg ? Math.min(0.7, (tg.radius||0.4)*0.9) : 0.3;
  const onPlayer = !!(tg && tg.team===0);
  const reduced = hitsThisFrame > 5;                        // budget: many hits in one frame → lighter effects
  if(hitsThisFrame <= 14){
    if(d.blocked) guard(x, y, z+zr, { scale:1 });
    else impact(x, y, z+zr, kind, onPlayer ? Math.min(power,2) : power, { dir:d.dir||0, reduced, scale: onPlayer ? 0.8 : 1 });
  }
  if(d.dmg > 0){
    const hx = tg ? tg.x : x, hz = tg ? tg.z : z, hy = tg ? headY(tg) + 0.15 : y + 0.6;
    text(String(Math.max(1, Math.round(d.dmg))), hx + R(-0.2,0.2), hy, hz, onPlayer ? 'hurt' : (d.crit ? 'crit' : 'dmg'));
  }
  if(!reduced){
    const K = KIND[kind];
    // onomatopoeia beside the impact (the damage number sits above the head)
    const ox = (d.dir||1)*0.6;
    if(d.blocked) text('カキン！', x + ox, y + 0.05, z, 'onoma', { color:'#7fd0ff' });
    else if(power >= 2) text(onPlayer ? 'いたっ！' : K.ono[power>=3 ? K.ono.length-1 : (rnd()*(K.ono.length-1))|0], x + ox, y + 0.05, z, 'onoma', { color: onPlayer ? '#ff5a8a' : K.oc });
    if(power >= 3 && d.src && d.src.team===0) speedLines(12);
  }
}
function onKO(d){
  const e = d.ent || {};
  const x = d.x!=null ? d.x : e.x||0, y = d.y!=null ? d.y : (e.y||0) + 0.6, z = (d.z!=null ? d.z : e.z||0) + 0.3;
  const s = (e.kind==='boss' || e.boss) ? 2 : 1;
  poof(x, y, z, { scale:s });
  sp(T.heart, x, y + 0.25*s, z + 0.15); S.s0 = 0.75*s; S.s1 = 0.6*s; S.curve = 1; S.vy = 0.03; S.life = 60; S.fout = 0.3; S.flags = F_WOB; S.wob = 0.1; S.delay = 6; sc_('#ff5a8a'); emit();
  hearts(x, y, z, { count:3, scale:0.7*s });
  stars(x, y, z, { count:5, scale:0.8*s });
  text('ぽんっ！', x, y + 0.7*s, z, 'onoma', { color:'#ff8fc0' });
}
function onPickup(d){
  const e = d.ent || {};
  const x = d.x!=null ? d.x : e.x||0, y = d.y!=null ? d.y : (e.y||0) + 0.5, z = (d.z!=null ? d.z : e.z||0) + 0.15;
  switch(d.kind){
    case 'coin': coin(x, y, z, {}); break;
    case 'gem': sparkle(x, y, z, { count:10, color:'#8fefff' }); ring(x, y, z, { scale:0.8, color:'#6fe3ff' }); break;
    case 'star': stars(x, y, z, { count:6 }); sparkle(x, y, z, { count:6 }); ring(x, y, z, { scale:0.9, color:'#ffe14d' }); break;
    case 'heart': heal(e.x!=null ? e.x : x, e.y||0, (e.z!=null ? e.z : z)+0.1, {}); hearts(x, y, z, { count:6 }); break;
    case 'bone': case 'cake': heal(e.x!=null ? e.x : x, e.y||0, (e.z!=null ? e.z : z)+0.1, {}); break;
    default: sparkle(x, y, z, { count:8 });
  }
  if((d.kind==='bone' || d.kind==='cake' || d.kind==='heart') && d.value > 0 && e.x!=null) text('+'+Math.round(d.value), e.x, headY(e) + 0.2, e.z, 'heal');
}
function entPos(d){ const e = d && d.ent; return e && e.x!=null ? e : null; }
const HANDLERS = {
  hit: onHit, ko: onKO, pickup: onPickup,
  levelUp(d){ const e = entPos(d); if(!e) return; levelup(e.x, e.y||0, e.z+0.1, {}); text('レベルアップ！', e.x, headY(e) + 0.45, e.z, 'lvup'); },
  land(d){ const e = entPos(d); if(!e || !d.hard) return;
    if((e.weight||1) >= 2.5 || e.kind==='boss') shock(e.x, 0.02, e.z, { scale: clamp((e.radius||1)*0.9, 0.8, 2) });
    else dustRing(e.x, 0.02, e.z, { scale:0.8 }); },
  jump(d){ const e = entPos(d); if(!e || !d.double) return; jumpPuff(e.x, e.y||0, e.z, {}); },
  dodge(d){ const e = entPos(d); if(!e || !d.just) return; kira(e.x, (e.y||0)+0.7, e.z+0.3, {}); sparkle(e.x, (e.y||0)+0.6, e.z+0.2, { count:8, color:'#bff0ff' });
    text('ナイス！', e.x, headY(e) + 0.35, e.z, 'onoma', { color:'#2ab8ff' }); },
  heroKO(d){ const e = entPos(d); if(!e) return; stars(e.x, (e.y||0)+0.8, e.z+0.2, { count:8 }); dust(e.x, 0.05, e.z, { count:6 }); },
  revive(d){ const e = entPos(d); if(!e) return; hearts(e.x, (e.y||0)+0.6, e.z+0.2, { count:7 }); sparkle(e.x, (e.y||0)+0.7, e.z+0.2, { count:12 });
    ring(e.x, 0.05, e.z, { flat:true, scale:1.3, color:'#ffd0ea' }); sp(T.glow, e.x, (e.y||0)+1.0, e.z); S.s0 = 1.1; S.s1 = 1.3; S.asp = 2.6; S.life = 40; S.add = 1; S.a = 0.5; S.fin = 0.2; S.fout = 0.5; sc_('#fff0f8'); emit(); },
  bossDown(d){ const e = d.boss || {}; const x = e.x||G.cam.x, y = (e.y||0), z = (e.z||0)+0.3, h = (e.rig && e.rig.height) || e.height || 3;
    flash('#ffffff', 0.6, 16); purify(x, y, z, { scale: clamp(h/2.5, 1, 2) });
    addEmitter(130, 1/22, ()=>{ const [a,b] = G.cam.viewRange(); fireworks(R(a+1.5, b-1.5), R(3.2, 5.2), R(-1.5,-0.5), { count:1, scale:1.2 }); }, x, y, z);
    fireworks(x, y + h + 1.2, z - 0.5, { count:1, scale:1.1 }); },
  stageClear(){ addEmitter(180, 1.6, (em)=>{ const [a,b] = G.cam.viewRange(), topY = G.cam.y + (b-a)/2/Math.max(0.5, G.camera.aspect) + 1.2;
      sp(T.conf, R(a, b), topY, R(-1.2, 1.6)); S.vx = R(-0.02,0.02); S.vy = R(-0.05,-0.02); S.grav = -0.003; S.flags = F_FLUTTER|F_FLOOR|F_WOB; S.wob = 0.15;
      S.s0 = S.s1 = R(0.16,0.24); S.asp = 0.6; S.rot = ang(); S.spin = R(-0.2,0.2); S.life = 240; S.fout = 0.15; sc_(PICK(CONFETTI)); emit(); }, 0, 0, 0);
    addEmitter(120, 1/30, ()=>{ const [a,b] = G.cam.viewRange(); fireworks(R(a+1.5, b-1.5), R(3.2,5), R(-1.6,-0.6), { count:1 }); }, 0, 0, 0); },
  bossIntro(){ flash('#ffffff', 0.45, 14); },
  bossPhase(d){ const e = d.boss; flash('#ffe0f0', 0.35, 10); if(e){ shock(e.x, 0.02, e.z, { scale:1.3, color:'#ffd0f0' }); smoke(e.x, e.y||0, e.z+0.3, { count:6 }); } },
  shoot(d){ if(d.x==null) return; const k = d.kind;
    if(k==='cork') { poof(d.x, d.y, d.z+0.1, { count:3, scale:0.4 }); text('ポン！', d.x, d.y+0.3, d.z, 'onoma', { color:'#ffb23a' }); }
    else ring(d.x, d.y, d.z+0.1, { scale:0.45, life:10, color: (PDEF[k] && PDEF[k].halos && PDEF[k].halos[0].color) || '#ffffff' }); },
  special(d){ const e = entPos(d); if(!e) return; ring(e.x, (e.y||0)+0.6, e.z+0.2, { scale:0.9, color:'#fff3a0' }); sparkle(e.x, (e.y||0)+0.6, e.z+0.2, { count:6, scale:0.8 }); },
  swing(d){ const e = d.ent; if(!G.fx.autoTrails || !e || !e.rig || !e.rig.tip || !e.rig.base) return;
    if(e.team!==0 && e.kind!=='hero') return;
    if(d.kind && d.kind!=='slash' && d.kind!=='blunt' && d.kind!=='wind' && d.kind!=='fire' && d.kind!=='ice' && d.kind!=='thunder') return;
    const t = findTrail(e); if(t && !t.auto && !t.stopping) return;     // a manual trail is already running
    const len = d.def && d.def.len ? d.def.len : 24;
    trail(e, { auto:true, atk:e.atk || null, frames: Math.max(10, len) }); },
  ult(d){ const id = d.heroId || (d.ent && d.ent.type); if(cut.on && cut.heroId===id && cut.t < 4) return; cutin(id, d.name, null); },
  scene(){ clear(); },
  resize(){ sl.dirty = true; },
  quality(){ capP = Math.max(60, Math.round(MAXP * fxs())); },
};

// ================================================================ lifecycle
let ready = false;
function init(){
  if(ready) return;
  if(!G.scene || !G.camera) return;
  buildParticles(); buildTrails(); buildDOM();
  G.scene.add(pMesh); G.scene.add(trMesh);
  capP = Math.max(60, Math.round(MAXP * fxs()));
  for(const ev in HANDLERS) G.bus.on(ev, HANDLERS[ev]);
  ready = true;
}
function clear(){
  if(!ready) return;
  np = 0; emitters.length = 0;
  for(const t of trails){ t.on = false; t.ent = null; t.n = 0; }
  for(const p of pops){ p.on = false; p.el.style.visibility = 'hidden'; p.shown = false; }
  alertClear();
  fl.on = false; flashEl.style.opacity = '0'; flashEl.style.visibility = 'hidden';
  sl.on = false; for(const c of sl.cvs) c.style.visibility = 'hidden';
  if(cut.on){ cut.on = false; cut.done = null; cut.el.style.display = 'none'; cut.dimWrap.style.display = 'none'; if(cut.wd){ clearTimeout(cut.wd); cut.wd = 0; } }
}
let lastCount = 0;
function frame(dt){
  if(!ready) return;
  const kReal = clamp((dt>0 ? dt : 1/60)*60, 0, 4);
  // world effects follow slow motion a little (but keep animating during hitstop)
  const kw = G.fx.worldFrozen ? 0 : kReal * Math.max(0.4, Math.min(1, G.timeScale || 1));
  fxT += kReal;
  try {
    if(pMesh.parent !== G.scene) G.scene.add(pMesh);
    if(trMesh.parent !== G.scene) G.scene.add(trMesh);
    const e = G.camera.matrixWorld.elements; camRX=e[0]; camRY=e[1]; camRZ=e[2]; camUX=e[4]; camUY=e[5]; camUZ=e[6];
    if(kw > 0){ updateEmitters(kw); updateParticles(kw); }
    let j = writeParticles(0, 0); j = writeHalos(j, 0);
    j = writeParticles(j, 1); j = writeHalos(j, 1);
    lastCount = j;
    pGeo.instanceCount = j; pMesh.visible = j > 0;
    if(j > 0){ markAttr(attrP, j); markAttr(attrS, j); markAttr(attrC, j); }
    updateTrails(kw > 0 ? kw : (G.fx.worldFrozen ? 0 : kReal));
  } catch(err){ G.logError('fx.frame world', err); }
  try {
    updatePops(G.fx.worldFrozen ? 0 : kReal); updateAlerts(kReal); updateFlash(kReal); updateSpeed(kReal); updateCut(kReal);
  } catch(err){ G.logError('fx.frame dom', err); }
  hitsThisFrame = 0;
}
function stats(){
  let tr = 0, po = 0, al = 0; for(const t of trails) if(t.on) tr++; for(const p of pops) if(p.on) po++; for(const a of alerts) if(a.on) al++;
  return { particles: np, cap: capP, instances: lastCount, halos: liveProj.length, projectiles: liveProj.length, trails: tr, texts: po, alerts: al,
    emitters: emitters.length, cutin: cut.on, flash: fl.on, speedLines: sl.on };
}

G.fx = {
  init, frame, clear, stats,
  burst, impact: (x,y,z,kind,power,opts)=>{ if(ready) impact(+x||0,+y||0,+z||0, KIND[kind]?kind:'slash', power||1, opts||{}); },
  trail, trailStop, text, alert, alertClear, flash, speedLines, cutin, makeProjectile,
  autoTrails: true,           // start/stop a trail automatically on the 'swing' event for heroes
  worldFrozen: false,         // true = particles/trails/popups stop advancing (e.g. pause menu); cut-in & flash keep going
  KINDS: Object.keys(B), PROJ_KINDS, HIT_KINDS: Object.keys(KIND), T,
  _debug: { atlas: ()=> atlas && atlas.canvas },
};
})();

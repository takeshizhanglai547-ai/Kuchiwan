// 40_stage.js — ステージ（7つ）：データ・ピクサー風の「おもちゃ箱」みたいな3D背景・進行（ウェーブ／ボス）。
//
// 背景のつくり（描画コールと三角形を抑えるため）：
//   ・空       … カメラに追従する球1枚（グラデーション＋太陽／月＋星のシェーダー）
//   ・地面     … 歩ける帯（belt）1枚＋まわりの地面1枚（どちらも手描きのCanvasTexture＋頂点カラーのむら）
//   ・近景     … x方向16単位の「チャンク」×奥行き2帯ごとに、静止＋風で揺れる部品（solid / sway）を頂点カラーで1メッシュへ、
//                輪郭線も帯ごとに1枚へ結合（glow / deco は別メッシュ）。
//                視錐台カリングで、見えている2〜3チャンクだけが描かれる。
//   ・遠景     … 視差で動く1グループ（far / farGlow）＋雲（InstancedMesh）
//   ・粒       … テーマごとに THREE.Points 1つ（動きは頂点シェーダー、CPUは時刻を渡すだけ）
//   ・灯りの暈 … 提灯・キノコ・水晶・たいまつの光の暈を Points 1つで
// 進行：プレイヤーが wave.at を越えたらカメラを固定→敵を出す→全滅で解除＋「GO→」。最後にボス（7面は中ボス→大ボス）。
(function(){ 'use strict';
const G = window.G; const THREE = window.THREE; const U = G.U;
const TAU = Math.PI*2, PI = Math.PI;
const ZMIN = G.cfg.ZMIN, ZMAX = G.cfg.ZMAX;
const BELT_Z0 = ZMIN - 0.6, BELT_Z1 = ZMAX + 0.8;   // walkable strip incl. a soft margin
const CHUNK = 16;                                    // scenery chunk width (frustum-culling unit; 16 balances draw calls
                                                     // against triangles drawn outside the view: 20 → −2 calls, +3k tris)
const SHADOW_Z = -10.5;                              // scenery behind this depth does not cast shadows

// ================================================================ small helpers (build time only)
function mulberry(seed){ let s = seed>>>0; return ()=>{ s = (s + 0x6D2B79F5)|0; let t = Math.imul(s ^ (s>>>15), 1|s);
  t = (t + Math.imul(t ^ (t>>>7), 61|t)) ^ t; return ((t ^ (t>>>14))>>>0)/4294967296; }; }
const _hc = new THREE.Color(), _hsl = { h:0, s:0, l:0 };
// lighten/darken a hex colour in sRGB HSL
function shade(hex, dl, ds, dh){
  _hc.set(hex); _hc.getHSL(_hsl, THREE.SRGBColorSpace);
  _hc.setHSL((_hsl.h + (dh||0) + 1) % 1, U.clamp(_hsl.s + (ds||0), 0, 1), U.clamp(_hsl.l + (dl||0), 0, 1), THREE.SRGBColorSpace);
  return '#' + _hc.getHexString();
}
function hash2(x, z){ const s = Math.sin(x*127.1 + z*311.7)*43758.5453; return s - Math.floor(s); }
function vnoise(x, z){
  const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi;
  const u = xf*xf*(3-2*xf), v = zf*zf*(3-2*zf);
  const a = hash2(xi,zi), b = hash2(xi+1,zi), c = hash2(xi,zi+1), d = hash2(xi+1,zi+1);
  return a + (b-a)*u + (c-a)*v + (a-b-c+d)*u*v;
}
const pickR = (R, arr)=> arr[Math.floor(R()*arr.length)];

// ================================================================ themes (look & feel per stage)
// sky: gradient by view elevation (the camera looks down ~17°, so the visible "sky" band sits just below
// the horizon — h0/h1 map that band). sun.dir is a world direction; moon:1 draws a cratered moon.
const THEMES = {
  town: {
    sky:{ top:'#3f8fd6', mid:'#7fc0f0', bot:'#dff1f4', h0:-0.20, h1:0.0 },
    sun:{ dir:[-0.42, -0.045, -1], r:0.07, color:'#fff8d8', glow:'#fff1b8', glowR:0.2, glowStr:0.55, moon:0 }, stars:0,
    fog:{ color:'#d6ecf0', near:36, far:135 },
    light:{ hemiSky:'#cfe6ff', hemiGround:'#8fc46a', hemi:1.0, key:'#fff0d8', keyI:2.7, rim:'#c8e6ff', rimI:1.6, fill:'#ffe2f0', fillI:0.45 },
    exposure:1.0, rimLook:['#fff2dc', 0.42, '#ff8a6a', 0.10],
    ground:'meadow', scenery:'town', far:'hills', farPar:0.78, brow:-15,
    clouds:{ n:9, color:'#ffffff', shade:'#dfe9ff', y:[-1.5, 1.8], z:[-70, -95], s:[3.2, 5.5], spd:0.35 },
    particles:{ kind:'petal', n:80, a:'#ffc6dc', b:'#ff8fbd', vel:[0.55,-0.45,0.12], wob:0.5, size:0.2, box:[38, 0.0, 8.5, -12, 7] },
  },
  dusk: {
    sky:{ top:'#7d6cc8', mid:'#f6a24a', bot:'#f7e3bf', h0:-0.20, h1:0.02 },
    sun:{ dir:[0.16, -0.07, -1], r:0.09, color:'#fff0b0', glow:'#ffb45a', glowR:0.28, glowStr:0.95, moon:0 }, stars:0,
    fog:{ color:'#f3cf9e', near:30, far:120 },
    light:{ hemiSky:'#ffd9b8', hemiGround:'#b88c78', hemi:1.25, key:'#ffcf96', keyI:2.35, rim:'#ffb070', rimI:2.1, fill:'#ffb8d8', fillI:0.6 },
    exposure:1.06, rimLook:['#ffd2a0', 0.5, '#ff7a4a', 0.12],
    ground:'cobble', scenery:'dusk', far:'duskTown', farPar:0.75, brow:-15,
    clouds:{ n:8, color:'#ffd0b0', shade:'#c890c0', y:[-0.5, 2.8], z:[-70, -95], s:[3.5, 6], spd:0.25 },
    particles:{ kind:'glow', n:70, a:'#ffd27a', b:'#ff9a4a', vel:[0.12, 0.32, 0.0], wob:0.45, size:0.13, box:[36, 0.2, 7, -9, 5], add:1, twinkle:0.6 },
  },
  forest: {
    sky:{ top:'#1a2a66', mid:'#3d5a9c', bot:'#7f9ccc', h0:-0.20, h1:0.02 },
    sun:{ dir:[-0.2, -0.075, -1], r:0.095, color:'#fff6cf', glow:'#c8dcff', glowR:0.3, glowStr:1.0, moon:1 }, stars:1,
    fog:{ color:'#6f8cc0', near:30, far:115 },
    light:{ hemiSky:'#a6c0ff', hemiGround:'#4e6a8a', hemi:1.45, key:'#dbe6ff', keyI:2.1, rim:'#a8dcff', rimI:2.3, fill:'#d7a8ff', fillI:0.7 },
    exposure:1.16, rimLook:['#c8e6ff', 0.55, '#ff9ad0', 0.08],
    ground:'forest', scenery:'forest', far:'forestFar', farPar:0.72, brow:-16,
    clouds:{ n:5, color:'#8ea6d8', shade:'#5a6ea8', y:[0.5, 2.8], z:[-75, -95], s:[3, 5], spd:0.18 },
    particles:{ kind:'glow', n:60, a:'#eaff8a', b:'#9affc8', vel:[0.06, 0.05, 0.02], wob:0.9, size:0.16, box:[36, 0.2, 5, -10, 5], add:1, twinkle:1 },
  },
  cave: {
    sky:{ top:'#101c44', mid:'#22407e', bot:'#3e6aae', h0:-0.20, h1:0.02 },
    sun:{ dir:[0, -0.3, -1], r:0.0, color:'#ffffff', glow:'#8ae8ff', glowR:0.35, glowStr:0.35, moon:0 }, stars:0.7,
    fog:{ color:'#3b5a9a', near:26, far:100 },
    light:{ hemiSky:'#a8c4ff', hemiGround:'#7a5ab0', hemi:1.45, key:'#e0ecff', keyI:2.0, rim:'#80f0ff', rimI:2.4, fill:'#ff9ad8', fillI:0.8 },
    exposure:1.16, rimLook:['#9ff0ff', 0.55, '#ff8ad0', 0.10],
    ground:'crystal', scenery:'cave', far:'caveFar', farPar:0.7, brow:null,
    clouds:null,
    particles:{ kind:'sparkle', n:70, a:'#bff8ff', b:'#ffb8ec', vel:[0.03, 0.12, 0.0], wob:0.3, size:0.2, box:[36, 0.2, 6, -10, 5], add:1, twinkle:1 },
  },
  airship: {
    sky:{ top:'#4aa6e8', mid:'#8fd0f4', bot:'#fff1d0', h0:-0.24, h1:0.02 },
    sun:{ dir:[0.46, -0.03, -1], r:0.07, color:'#fffbe6', glow:'#fff0c0', glowR:0.22, glowStr:0.65, moon:0 }, stars:0,
    fog:{ color:'#e9f2f0', near:36, far:150 },
    light:{ hemiSky:'#d6eeff', hemiGround:'#e8d4b0', hemi:1.3, key:'#fff4e0', keyI:2.5, rim:'#ffffff', rimI:1.6, fill:'#ffe6d0', fillI:0.45 },
    exposure:1.08, rimLook:['#fff6e6', 0.45, '#ff9a6a', 0.10],
    ground:'deck', scenery:'airship', far:'cloudSea', farPar:0.65, brow:null,
    clouds:{ n:14, color:'#ffffff', shade:'#d8e4ff', y:[-7, 1.5], z:[-26, -80], s:[2.6, 5.5], spd:1.4 },
    particles:{ kind:'snow', n:40, a:'#ffffff', b:'#e6f2ff', vel:[-2.2, 0.05, 0.0], wob:0.2, size:0.22, box:[40, 0.2, 7, -12, 6], opacity:0.55 },
  },
  snow: {
    sky:{ top:'#6aa0dc', mid:'#9fc4e8', bot:'#eef4fb', h0:-0.20, h1:0.02 },
    sun:{ dir:[-0.36, -0.03, -1], r:0.065, color:'#fffdf2', glow:'#fff6e0', glowR:0.2, glowStr:0.45, moon:0 }, stars:0,
    fog:{ color:'#e6eef8', near:30, far:120 },
    light:{ hemiSky:'#dcecff', hemiGround:'#c4d4ee', hemi:1.3, key:'#fff6ec', keyI:2.2, rim:'#cfe8ff', rimI:1.5, fill:'#ffe8f0', fillI:0.4 },
    exposure:0.98, rimLook:['#e8f4ff', 0.42, '#ff9a8a', 0.09],
    ground:'snow', scenery:'snow', far:'mountains', farPar:0.75, brow:-19,
    clouds:{ n:8, color:'#ffffff', shade:'#d0dcf0', y:[-0.5, 2.5], z:[-72, -95], s:[3, 5], spd:0.3 },
    particles:{ kind:'snow', n:110, a:'#ffffff', b:'#dcebff', vel:[0.25, -0.6, 0.05], wob:0.6, size:0.12, box:[38, 0.0, 9, -12, 7] },
  },
  castle: {
    sky:{ top:'#140a30', mid:'#4a2a86', bot:'#9a6ac8', h0:-0.20, h1:0.02 },
    sun:{ dir:[0.34, -0.055, -1], r:0.09, color:'#ffe6f6', glow:'#d69aff', glowR:0.26, glowStr:0.9, moon:1 }, stars:1,
    fog:{ color:'#6e4a9e', near:30, far:115 },
    light:{ hemiSky:'#c4a8ff', hemiGround:'#5e3e82', hemi:1.45, key:'#ffe4f4', keyI:2.05, rim:'#c89aff', rimI:2.3, fill:'#ffa46a', fillI:0.75 },
    exposure:1.14, rimLook:['#e4c8ff', 0.55, '#ff8a5a', 0.10],
    ground:'castle', scenery:'castle', far:'castleFar', farPar:0.72, brow:null,
    clouds:{ n:6, color:'#8a6ab8', shade:'#4a3278', y:[0.5, 2.8], z:[-75, -95], s:[3.5, 5.5], spd:0.2 },
    particles:{ kind:'glow', n:60, a:'#e59aff', b:'#ff9ae0', vel:[0.05, 0.35, 0.0], wob:0.4, size:0.12, box:[36, 0.1, 6, -9, 5], add:1, twinkle:0.7 },
  },
};

// ================================================================ stage data (CONCEPT.md §Stages)
const MOFU = 'モフじい';
G.stages = [
  { id:'s1', no:1, name:'王都郊外', kana:'おうとの まちはずれ', length:96, bgm:'stage1', theme:THEMES.town,
    waves:[
      { at:16, width:16, foes:[['wanhei',3]], reward:'coin' },
      { at:40, width:16, foes:[['wanhei',2],['hyena',1]], then:[['hyena',2]] },
      { at:62, width:16, foes:[['wanhei',2],['pounce',1]], then:[['pounce',1],['hyena',1]], reward:'bone' },
    ],
    boss:{ type:'garm', at:80, x:80 },
    hints:[
      { at:0.5, name:MOFU, text:'ほっほっ、よく きたのう！ スティック（やじるしキー）で うごけるぞい。みぎへ すすむのじゃ！' },
      { at:8, name:MOFU, text:'てきが きたら こうげきボタンを れんだ！ さいごの いちげきで ぽーんと ふっとぶぞ' },
      { at:27, name:MOFU, text:'ジャンプボタンで ぴょーん！ くうちゅうで もういちど おすと 2だんジャンプじゃ' },
      { at:33, name:MOFU, text:'あぶない！と おもったら よけるボタン。ぎりぎりで よけると 「ナイス！」じゃ' },
      { at:50, name:MOFU, text:'✦が あるときは ひっさつボタン！ スティックの むきで わざが かわるぞい' },
      { at:72, name:MOFU, text:'おうぎゲージが ひかったら おうぎボタン！ みんな まとめて おおあばれじゃ！' },
    ],
    props:[ {kind:'crate', x:11, z:-1.6, drop:'coin'}, {kind:'barrel', x:30, z:1.2, drop:'bone'}, {kind:'crate', x:53, z:-0.8, drop:'star'}, {kind:'pot', x:74, z:1.1, drop:'cake'} ],
  },
  { id:'s2', no:2, name:'黄昏の城下町', kana:'たそがれの じょうかまち', length:100, bgm:'stage2', theme:THEMES.dusk,
    waves:[
      { at:16, width:16, foes:[['wanhei',3],['boar',1]] },
      { at:38, width:16, foes:[['shield',2],['wanhei',2]], then:[['bomber',2]], reward:'coin' },
      { at:62, width:16, foes:[['kire',1],['boar',1],['wanhei',2]], then:[['shield',1],['bomber',1],['wanhei',1]], reward:'bone' },
    ],
    boss:{ type:'shark', at:84, x:84 },
    hints:[
      { at:30, name:MOFU, text:'たてを もった てきは、うしろから こうげきするか、ジャンプで とびこえるのじゃ！' },
      { at:55, name:MOFU, text:'「ぷんぷん！」と おこったら つよくなるぞ。よけるボタンで かわすのじゃ' },
    ],
    props:[ {kind:'barrel', x:10, z:-1.2, drop:'coin'}, {kind:'pot', x:29, z:1.0, drop:'bone'}, {kind:'barrel', x:52, z:-1.5, drop:'star'}, {kind:'pot', x:76, z:0.6, drop:'cake'}, {kind:'crate', x:79, z:-1.8, drop:'coin'} ],
  },
  { id:'s3', no:3, name:'月夜の森', kana:'つくよみの もり', length:102, bgm:'stage3', theme:THEMES.forest,
    waves:[
      { at:16, width:16, foes:[['pounce',2],['thrower',2]] },
      { at:38, width:16, foes:[['flyer',2],['pounce',2]], then:[['thrower',1],['flyer',1]], reward:'coin' },
      { at:62, width:17, foes:[['pierrot',1],['pounce',2],['flyer',1]], then:[['thrower',2]], reward:'bone' },
    ],
    boss:{ type:'ghost', at:86, x:86 },
    hints:[
      { at:6, name:MOFU, text:'ほねを なげる てきは、はなれていても とどくぞ。ちかづいて たたくのじゃ' },
      { at:55, name:MOFU, text:'ピエロは ふうせんを よぶぞい。ピエロから さきに ねらうのじゃ！' },
    ],
    props:[ {kind:'pumpkin', x:10, z:-1.4, drop:'coin'}, {kind:'pot', x:31, z:1.1, drop:'bone'}, {kind:'pumpkin', x:54, z:-0.6, drop:'star'}, {kind:'pumpkin', x:78, z:1.2, drop:'cake'} ],
  },
  { id:'s4', no:4, name:'瑠璃の水晶洞', kana:'るりの すいしょうどう', length:104, bgm:'stage4', theme:THEMES.cave,
    waves:[
      { at:16, width:16, foes:[['ari',2],['shield',2]] },
      { at:38, width:16, foes:[['kire',2],['ari',2]], then:[['shield',1],['ari',1]], reward:'coin' },
      { at:62, width:17, foes:[['oni',1],['shield',2],['kire',1]], then:[['ari',2],['kire',1]], reward:'bone' },
    ],
    boss:{ type:'cerbe', at:88, x:88 },
    hints:[
      { at:6, name:MOFU, text:'へいたいアリは じめんに もぐるぞ！ あしもとが もこもこしたら よけるのじゃ' },
      { at:56, name:MOFU, text:'オニボウズの むらさきの わの なかは てきが つよくなる。はやめに たおすのじゃ' },
    ],
    props:[ {kind:'crystal', x:10, z:-1.5, drop:'coin'}, {kind:'crystal', x:31, z:1.2, drop:'bone'}, {kind:'crystal', x:55, z:-0.9, drop:'star'}, {kind:'crystal', x:80, z:1.0, drop:'cake'} ],
  },
  { id:'s5', no:5, name:'海賊飛行艇', kana:'かいぞく ひこうてい', length:106, bgm:'stage5', theme:THEMES.airship,
    waves:[
      { at:16, width:16, foes:[['hyena',3],['bomber',1]] },
      { at:36, width:16, foes:[['boar',2],['flyer',2]], then:[['hyena',2]], reward:'coin' },
      { at:56, width:16, foes:[['thrower',2],['bomber',2],['hyena',1]], then:[['flyer',2]] },
      { at:74, width:16, foes:[['boar',2],['thrower',1],['hyena',2]], then:[['bomber',2],['flyer',1]], reward:'bone' },
    ],
    boss:{ type:'slime', at:90, x:90 },
    hints:[
      { at:6, name:MOFU, text:'たかい そらの うえじゃ！ ひのついた チワワは ぽーんと はじけるから きをつけい' },
    ],
    props:[ {kind:'barrel', x:10, z:-1.6, drop:'coin'}, {kind:'crate', x:28, z:1.3, drop:'bone'}, {kind:'barrel', x:48, z:-1.2, drop:'star'}, {kind:'crate', x:68, z:0.9, drop:'coin'}, {kind:'barrel', x:84, z:-1.0, drop:'cake'} ],
  },
  { id:'s6', no:6, name:'氷雪の霊峰', kana:'ひょうせつの れいほう', length:108, bgm:'stage6', theme:THEMES.snow,
    waves:[
      { at:16, width:16, foes:[['wanhei',3],['pounce',2]] },
      { at:36, width:16, foes:[['mecha',2],['ari',2]], then:[['pounce',2]], reward:'coin' },
      { at:56, width:17, foes:[['oni',1],['wanhei',3]], then:[['mecha',1],['ari',2]] },
      { at:76, width:17, foes:[['oni',1],['mecha',2],['pounce',2]], then:[['wanhei',2],['ari',2]], reward:'bone' },
    ],
    boss:{ type:'dragon', at:92, x:92 },
    hints:[
      { at:6, name:MOFU, text:'さむいのう〜！ メカワンコの あかい たまは ジャンプか よけるで かわすのじゃ' },
      { at:88, name:MOFU, text:'ドラゴンの ほのおは じめんを はしるぞ。ジャンプで とびこえるのじゃ！' },
    ],
    props:[ {kind:'crate', x:10, z:-1.4, drop:'coin'}, {kind:'pot', x:30, z:1.2, drop:'bone'}, {kind:'crate', x:50, z:-0.9, drop:'star'}, {kind:'pot', x:70, z:1.0, drop:'coin'}, {kind:'crate', x:86, z:-1.5, drop:'cake'} ],
  },
  { id:'s7', no:7, name:'ダークワンワン城', kana:'ダークワンワンじょう', length:112, bgm:'stage7', theme:THEMES.castle,
    waves:[
      { at:16, width:16, foes:[['shield',2],['kire',2],['mecha',1]] },
      { at:34, width:16, foes:[['pierrot',1],['oni',1],['mecha',2]], then:[['shield',2],['kire',1]], reward:'coin' },
      { at:70, width:17, foes:[['oni',2],['mecha',2],['kire',2]], then:[['shield',2],['pierrot',1]], reward:'cake' },
    ],
    mid:{ type:'kuroinu', at:52, x:52 },
    boss:{ type:'emperor', at:94, x:94 },
    hints:[
      { at:4, name:MOFU, text:'いよいよ ダークワンワンじょうじゃ！ みんなの ちからを あわせるのじゃ！' },
      { at:48, name:MOFU, text:'あれは クロイヌ…！ むかしは おうこく いちばんの けんしだったのじゃ' },
    ],
    props:[ {kind:'barrel', x:10, z:-1.4, drop:'coin'}, {kind:'pumpkin', x:28, z:1.2, drop:'bone'}, {kind:'crystal', x:46, z:-1.2, drop:'star'}, {kind:'pumpkin', x:64, z:1.0, drop:'cake'}, {kind:'crystal', x:86, z:-1.0, drop:'star'}, {kind:'barrel', x:90, z:1.3, drop:'cake'} ],
  },
];
// fallback names for the boss intro when the boss module has no name/title
const BOSS_NAMES = {
  garm:['てつづめの ガルム','わが てつづめ、うけてみよ！'], shark:['りくザメ リクザメ','じめんの そこから がぶっ！'],
  ghost:['おばけの Tたろう 3きょうだい','ヒヒヒ…3にんで あそんであげる〜'], cerbe:['みつくびの ケルベ','みっつの あたまから にげられないぞ！'],
  slime:['キングスライム','ぷるぷる…たたくほど ふえるぞ！'], dragon:['ひりゅう ヴォルカ','ジャンプで かわせるかな？'],
  kuroinu:['こくけんし クロイヌ','…おまえの けん、みせてもらおう'], emperor:['ダークワンワンたいてい','ワンワンていこくの ちからを おもいしれ！'],
};
// how a foe type comes in when a wave spawns it (the foe def may override)
const ENTRANCE = { ari:'burrow' };

// ================================================================ primitives (CPU-only sources for the part builder;
// never rendered themselves, so they cost no GPU memory)
let P = null;
function prims(){
  if(P) return P;
  const g = G.look.geo;
  P = {
    sph: g.sphere(1, 12, 9), lo: g.sphere(1, 8, 6), dot: g.sphere(1, 6, 4),
    hemi: new THREE.SphereGeometry(1, 14, 6, 0, TAU, 0, PI/2),
    cyl: g.cylinder(1, 1, 1, 10), cyl6: g.cylinder(1, 1, 1, 6), cylHi: g.cylinder(1, 1, 1, 16),
    cone: g.cone(1, 1, 10), cone6: g.cone(1, 1, 6),
    box: g.box(1, 1, 1), rbox: g.rbox(1, 1, 1, 0.2, 3), rbox2: g.rbox(1, 1, 1, 0.12, 2),
    oct: new THREE.OctahedronGeometry(1, 0),
    pyr: new THREE.ConeGeometry(1, 1, 4, 1).rotateY(PI/4), mid: g.sphere(1, 10, 8),
    torus: g.torus(1, 0.22, 5, 14), ring: g.torus(1, 0.08, 4, 12), can: g.sphere(1, 14, 10),
    heart: g.heart(0.5, 0.25), star: g.star(0.5, 0.48, 0.2),
    lathePot: g.lathe('stgPot', [[0,0],[0.7,0],[1,0.4],[0.95,0.8],[0.55,1],[0,1]], 12),
  };
  return P;
}

// ================================================================ build context: chunked layers
// layers per chunk: solid (lit + outline + casts shadow), sway (same, wind-swayed), glow (unlit, bright),
// deco (lit, no outline / shadow). Far: far (lit, fogged) + farGlow (unlit).
function makeCtx(def, seed){
  const L = def.length, x0 = -26, n = Math.ceil((L + 52) / CHUNK);
  const chunks = []; for(let i=0;i<n;i++) chunks.push({});
  const c = {
    L, R: mulberry(seed), chunks, x0, cur: chunks[0],
    far: G.look.builder(), farGlow: G.look.builder(),
    halos: [], spins: [], th: def.theme, def,
    at(x){ this.cur = chunks[U.clamp(Math.floor((x - x0)/CHUNK), 0, n-1)]; return this; },
    // parts far behind the belt (z < SHADOW_Z) go to no-shadow twins of solid/sway: their shadows would fall
    // behind them where nobody looks, and the shadow pass is not free
    add(layer, g, col, p, r, s){
      if((layer==='solid' || layer==='sway') && p && p[2] < SHADOW_Z) layer += 'B';
      const ch = this.cur; (ch[layer] || (ch[layer] = G.look.builder())).add(g, col, p, r, s);
    },
    S(g, col, p, r, s){ this.add('solid', g, col, p, r, s); },
    W(g, col, p, r, s){ this.add('sway', g, col, p, r, s); },
    GL(g, col, p, r, s){ this.add('glow', g, col, p, r, s); },
    D(g, col, p, r, s){ this.add('deco', g, col, p, r, s); },
    F(g, col, p, r, s){ this.far.add(g, col, p, r, s); },
    FG(g, col, p, r, s){ this.farGlow.add(g, col, p, r, s); },
    halo(x, y, z, col, size){ this.halos.push(x, y, z, col, size); },
    spin(kind, x, y, z, s, speed, rotY){ this.spins.push({ kind, x, y, z, s, speed, rotY: rotY||0 }); },
    h(x, z){ return groundH(def.theme, x, z); },
  };
  return c;
}

// ground height (surroundings): gentle toy-like bumps behind/in front of the belt and a soft drop-off ("brow")
// far behind so the far layer and sky show above it
function groundH(th, x, z){
  let y = 0;
  if(z < -4.6){
    const k = U.smooth(-z, 4.6, 8.5);
    y += k*(0.32*Math.sin(x*0.19 + 1.3) + 0.22*Math.sin(x*0.07 + z*0.33) + 0.18*(vnoise(x*0.2, z*0.2) - 0.5));
  } else if(z > BELT_Z1 + 0.9){
    const k = U.smooth(z, BELT_Z1 + 0.9, BELT_Z1 + 3.5);
    y += k*(0.14*Math.sin(x*0.35 + z) + 0.08);
  }
  if(th.brow != null && z < th.brow){
    const t = U.clamp((th.brow - z)/7, 0, 1);
    y -= t*t*(3 - 2*t)*8;
  }
  return y;
}

// ================================================================ scenery kits (add parts to the ctx)
const KIT = {
  // lollipop tree: trunk (solid) + round canopy (sway)
  tree(c, x, z, s, leaf, trunk){
    const y = c.h(x, z) - 0.05, p = prims(), far = z < SHADOW_Z, big = far ? p.sph : p.can, sm = far ? p.lo : p.mid;
    c.at(x);
    c.S(p.cyl6, trunk || '#a8744a', [x, y + 0.75*s, z], null, [0.13*s, 1.5*s, 0.13*s]);
    c.W(big, leaf, [x, y + 1.95*s, z], null, [0.95*s, 0.88*s, 0.95*s]);
    c.W(sm, shade(leaf, 0.06), [x - 0.5*s, y + 1.72*s, z + 0.3*s], null, 0.55*s);
    c.W(sm, shade(leaf, -0.05), [x + 0.52*s, y + 1.82*s, z + 0.12*s], null, 0.5*s);
  },
  // tall forest tree: stacked round canopies
  bigTree(c, x, z, s, leaf, trunk){
    const y = c.h(x, z) - 0.05, p = prims(), far = z < SHADOW_Z, big = far ? p.sph : p.can, sm = far ? p.lo : p.mid;
    c.at(x);
    c.S(p.cyl6, trunk, [x, y + 1.2*s, z], null, [0.2*s, 2.4*s, 0.2*s]);
    c.S(p.cone6, trunk, [x, y + 0.2*s, z], null, [0.42*s, 0.5*s, 0.42*s]);
    c.W(big, leaf, [x, y + 2.7*s, z], null, [1.25*s, 1.1*s, 1.2*s]);
    c.W(sm, shade(leaf, 0.05), [x - 0.7*s, y + 2.3*s, z + 0.4*s], null, 0.75*s);
    c.W(sm, shade(leaf, -0.04), [x + 0.75*s, y + 2.45*s, z + 0.2*s], null, 0.7*s);
    c.W(sm, shade(leaf, 0.08), [x + 0.1*s, y + 3.55*s, z - 0.1*s], null, 0.72*s);
  },
  pine(c, x, z, s, leaf, snow){
    const y = c.h(x, z) - 0.05, p = prims();
    c.at(x);
    c.S(p.cyl6, '#8a5a3a', [x, y + 0.3*s, z], null, [0.14*s, 0.6*s, 0.14*s]);
    for(let i=0;i<3;i++){
      const r = (1.05 - i*0.27)*s, yy = y + (0.9 + i*0.72)*s;
      c.W(p.cone, shade(leaf, i*0.03), [x, yy, z], null, [r, 1.05*s, r]);
      if(snow) c.W(p.cone, snow, [x, yy + 0.3*s, z], null, [r*0.62, 0.5*s, r*0.62]);
    }
  },
  bush(c, x, z, s, col, flower){
    const y = c.h(x, z) - 0.08, p = prims();
    c.at(x);
    c.S(p.mid, col, [x, y + 0.34*s, z], null, [0.62*s, 0.5*s, 0.5*s]);
    c.S(p.lo, shade(col, 0.05), [x - 0.46*s, y + 0.26*s, z + 0.1*s], null, [0.42*s, 0.36*s, 0.4*s]);
    c.S(p.lo, shade(col, -0.04), [x + 0.46*s, y + 0.24*s, z + 0.08*s], null, [0.4*s, 0.34*s, 0.38*s]);
    if(flower){ for(let i=0;i<3;i++){ const a = i*2.1 + x; c.D(p.dot, flower, [x + Math.cos(a)*0.4*s, y + 0.55*s + (i%2)*0.08, z + 0.32*s], null, 0.09*s); } }
  },
  // flat little flower clump (deco only, very cheap)
  flowers(c, x, z, cols, n){
    const p = prims(), y = c.h(x, z);
    c.at(x);
    for(let i=0;i<n;i++){
      const a = i*2.4 + x*1.7, r = 0.18 + (i%3)*0.16, fx = x + Math.cos(a)*r, fz = z + Math.sin(a)*r*0.7;
      const col = cols[i % cols.length], front = z > 0;
      if(front) c.D(p.cyl6, '#5aa04a', [fx, y + 0.11, fz], null, [0.02, 0.22, 0.02]);
      c.D(p.dot, col, [fx, y + (front ? 0.24 : 0.1), fz], [0.3, 0, 0], [0.11, 0.05, 0.11]);
    }
  },
  rock(c, x, z, s, col, layer){
    const p = prims(), y = c.h(x, z);
    c.at(x);
    c.add(layer || 'solid', p.lo, col, [x, y + 0.18*s, z], [0, x, 0.1], [0.6*s, 0.42*s, 0.5*s]);
    c.add(layer || 'solid', p.lo, shade(col, 0.05), [x + 0.38*s, y + 0.12*s, z + 0.15*s], [0, x*2, 0], [0.34*s, 0.26*s, 0.32*s]);
  },
  house(c, x, z, s, wall, roof, winCol){
    const p = prims(), y = c.h(x, z) - 0.1;
    c.at(x);
    const w = 2.2*s, h = 1.7*s, d = 1.9*s, fz = z + d/2;
    c.S(p.rbox, wall, [x, y + h/2, z], null, [w, h, d]);
    c.S(p.hemi, roof, [x, y + h - 0.06, z], null, [w*0.64, 0.95*s, d*0.66]);
    c.S(p.torus, shade(roof, -0.06), [x, y + h - 0.04, z], [PI/2, 0, 0], [w*0.6, d*0.62, 0.5]);
    c.S(p.rbox2, '#a0643a', [x - w*0.2, y + 0.5*s, fz], null, [0.52*s, 1.0*s, 0.14*s]);
    c.S(p.dot, '#ffd24d', [x - w*0.1, y + 0.48*s, fz + 0.08], null, 0.05*s);
    c.S(p.ring, '#ffffff', [x + w*0.22, y + h*0.6, fz + 0.01], null, [0.26*s, 0.26*s, 0.8]);
    c.S(p.cyl, winCol || '#bfe6ff', [x + w*0.22, y + h*0.6, fz - 0.02], [PI/2, 0, 0], [0.24*s, 0.08, 0.24*s]);
    c.S(p.rbox2, '#ff9a7a', [x + w*0.22, y + h*0.32, fz + 0.1], null, [0.6*s, 0.14*s, 0.18*s]);
    c.D(p.dot, '#ff6b8a', [x + w*0.12, y + h*0.4, fz + 0.14], null, 0.07*s);
    c.D(p.dot, '#ffe36a', [x + w*0.3, y + h*0.4, fz + 0.14], null, 0.07*s);
    c.S(p.cyl6, '#e0a080', [x + w*0.26, y + h + 0.7*s, z - 0.25*s], null, [0.15*s, 0.7*s, 0.15*s]);
  },
  fence(c, x, z, posts, col, rail){
    const p = prims(), gap = 0.9;
    c.at(x);
    for(let i=0;i<posts;i++){
      const px = x + i*gap, y = c.h(px, z);
      c.S(p.rbox2, col, [px, y + 0.36, z], null, [0.16, 0.72, 0.12]);
      c.S(p.cone6, col, [px, y + 0.79, z], null, [0.11, 0.16, 0.08]);
    }
    const y = c.h(x, z), len = (posts-1)*gap;
    c.S(p.rbox2, rail, [x + len/2, y + 0.28, z - 0.08], null, [len + 0.2, 0.1, 0.06]);
    c.S(p.rbox2, rail, [x + len/2, y + 0.54, z - 0.08], null, [len + 0.2, 0.1, 0.06]);
  },
  lamp(c, x, z, pole, light, halo){
    const p = prims(), y = c.h(x, z);
    c.at(x);
    c.S(p.cyl6, pole, [x, y + 1.1, z], null, [0.06, 2.2, 0.06]);
    c.S(p.cyl6, pole, [x, y + 0.08, z], null, [0.16, 0.16, 0.16]);
    c.S(p.cone, pole, [x, y + 2.62, z], null, [0.26, 0.2, 0.26]);
    c.GL(p.lo, light, [x, y + 2.36, z], null, [0.17, 0.22, 0.17]);
    if(halo) c.halo(x, y + 2.36, z + 0.1, light, halo);
  },
  // paper lantern (chouchin)
  lantern(c, x, y, z, col, halo){
    const p = prims();
    c.at(x);
    c.GL(p.lo, col, [x, y, z], null, [0.2, 0.26, 0.2]);
    c.S(p.cyl6, '#3a2a2a', [x, y + 0.26, z], null, [0.1, 0.06, 0.1]);
    c.S(p.cyl6, '#3a2a2a', [x, y - 0.26, z], null, [0.1, 0.06, 0.1]);
    if(halo) c.halo(x, y, z + 0.05, col, halo);
  },
  mushroom(c, x, z, s, cap, stem, halo){
    const p = prims(), y = c.h(x, z) - 0.05;
    c.at(x);
    c.S(p.cyl6, stem || '#f4ecd8', [x, y + 0.5*s, z], [0, 0, 0.06], [0.16*s, 1.0*s, 0.16*s]);
    c.GL(p.hemi, cap, [x, y + 0.92*s, z], null, [0.62*s, 0.5*s, 0.62*s]);
    c.GL(p.dot, shade(cap, 0.2, -0.3), [x - 0.22*s, y + 1.22*s, z + 0.3*s], null, 0.09*s);
    c.GL(p.dot, shade(cap, 0.2, -0.3), [x + 0.25*s, y + 1.14*s, z + 0.36*s], null, 0.07*s);
    c.GL(p.dot, shade(cap, 0.2, -0.3), [x + 0.05*s, y + 1.36*s, z + 0.1*s], null, 0.08*s);
    if(halo) c.halo(x, y + 1.05*s, z + 0.2, cap, halo*s);
  },
  crystal(c, x, z, s, col, halo, layer){
    const p = prims(), y = c.h(x, z) - 0.1, L = layer || 'glow';
    c.at(x);
    c.add(L, p.oct, col, [x, y + 0.75*s, z], [0, x, 0.08], [0.32*s, 0.95*s, 0.32*s]);
    c.add(L, p.oct, shade(col, 0.08), [x + 0.34*s, y + 0.42*s, z + 0.12*s], [0, x*2, -0.45], [0.2*s, 0.6*s, 0.2*s]);
    c.add(L, p.oct, shade(col, -0.05), [x - 0.32*s, y + 0.36*s, z + 0.08*s], [0, x*3, 0.5], [0.18*s, 0.5*s, 0.18*s]);
    if(halo) c.halo(x, y + 0.7*s, z + 0.2, col, halo*s);
  },
  flag(c, x, y, z, s, col, pole){
    const p = prims();
    c.at(x);
    c.S(p.cyl6, pole || '#8a6a4a', [x, y + 1.0*s, z], null, [0.04*s, 2.0*s, 0.04*s]);
    c.S(p.dot, '#ffd24d', [x, y + 2.04*s, z], null, 0.07*s);
    c.W(p.rbox2, col, [x + 0.38*s, y + 1.72*s, z], [0, 0, -0.08], [0.72*s, 0.42*s, 0.04]);
  },
  snowman(c, x, z, s){
    const p = prims(), y = c.h(x, z) - 0.05;
    c.at(x);
    c.S(p.sph, '#ffffff', [x, y + 0.42*s, z], null, [0.46*s, 0.42*s, 0.46*s]);
    c.S(p.sph, '#ffffff', [x, y + 0.98*s, z], null, 0.32*s);
    c.S(p.cone6, '#ff8a3a', [x + 0.1*s, y + 0.97*s, z + 0.32*s], [PI/2, 0, 0], [0.05*s, 0.22*s, 0.05*s]);
    c.S(p.dot, '#2a2a3a', [x - 0.1*s, y + 1.06*s, z + 0.28*s], null, 0.035*s);
    c.S(p.dot, '#2a2a3a', [x + 0.14*s, y + 1.06*s, z + 0.26*s], null, 0.035*s);
    c.S(p.torus, '#ff5a6a', [x, y + 0.74*s, z], [PI/2, 0, 0], [0.28*s, 0.28*s, 0.5*s]);
    c.S(p.cyl, '#3a4a8a', [x, y + 1.32*s, z], null, [0.18*s, 0.1*s, 0.18*s]);
    c.S(p.cyl, '#3a4a8a', [x, y + 1.45*s, z], null, [0.13*s, 0.22*s, 0.13*s]);
    c.S(p.dot, '#ffd0d8', [x - 0.2*s, y + 0.96*s, z + 0.24*s], null, [0.06*s, 0.035*s, 0.03*s]);
    c.S(p.dot, '#ffd0d8', [x + 0.24*s, y + 0.96*s, z + 0.2*s], null, [0.06*s, 0.035*s, 0.03*s]);
  },
  // cute stone dog statue on a pedestal (castle)
  dogStatue(c, x, z, s, col){
    const p = prims(), y = c.h(x, z);
    c.at(x);
    c.S(p.rbox, shade(col, -0.08), [x, y + 0.4*s, z], null, [0.9*s, 0.8*s, 0.8*s]);
    c.S(p.sph, col, [x, y + 1.05*s, z], null, [0.34*s, 0.3*s, 0.3*s]);
    c.S(p.sph, col, [x + 0.1*s, y + 1.55*s, z + 0.05*s], null, 0.3*s);
    c.S(p.lo, col, [x + 0.1*s, y + 1.47*s, z + 0.3*s], null, [0.14*s, 0.11*s, 0.1*s]);
    c.S(p.lo, shade(col, -0.1), [x - 0.14*s, y + 1.78*s, z], [0, 0, 0.4], [0.1*s, 0.2*s, 0.08*s]);
    c.S(p.lo, shade(col, -0.1), [x + 0.34*s, y + 1.78*s, z], [0, 0, -0.4], [0.1*s, 0.2*s, 0.08*s]);
    c.S(p.dot, '#ffd24d', [x + 0.1*s, y + 1.2*s, z + 0.3*s], null, 0.07*s);
  },
};

// ================================================================ per-theme scenery layouts
const SCENERY = {
  // ---- stage 1: sunny outskirts of the capital
  town(c){
    const { L, R } = c, p = prims();
    const leaves = ['#58c04a', '#74cc52', '#45ae4c', '#86d45a'];
    const blossom = ['#ff9cc4', '#ffb0d2'];
    const walls = ['#ffe4c4', '#ffd0dc', '#cfe4ff', '#fff0a8', '#d6f2c4'];
    const roofs = ['#ff6a5a', '#4ea6ff', '#ff86c4', '#62c85a', '#ffa832', '#a47aff'];
    // row A — picket fences, flower bushes, lamps, signposts
    for(let x = -22; x < L + 22;){
      const n = 4 + Math.floor(R()*4);
      if(R() < 0.7) KIT.fence(c, x, -4.35, n, '#fff8ec', '#f2d6b6');
      x += n*0.9 + 1.4 + R()*3.2;
    }
    for(let x = -20; x < L + 22; x += 3.0 + R()*3.6) KIT.bush(c, x, -5.3 - R()*0.9, 0.65 + R()*0.45, pickR(R, leaves), R() < 0.6 ? pickR(R, ['#ffffff', '#ff8fbd', '#ffe36a']) : null);
    for(let x = -14; x < L + 20; x += 15 + R()*5) KIT.lamp(c, x, -4.0, '#4a6a5a', '#fff4c0', 0);
    // row B — pastel houses with round roofs, lollipop trees between
    for(let x = -22; x < L + 22;){
      if(R() < 0.5){ KIT.house(c, x, -8.2 - R()*1.4, 0.95 + R()*0.3, pickR(R, walls), pickR(R, roofs)); x += 5 + R()*2.6; }
      else { KIT.tree(c, x, -7.4 - R()*2.2, 1 + R()*0.3, R() < 0.25 ? pickR(R, blossom) : pickR(R, leaves)); x += 2.4 + R()*2.2; }
    }
    // row C — a looser line of trees just before the hill brow (the castle and sky show above it)
    for(let x = -24; x < L + 24; x += 3.2 + R()*3.4) KIT.tree(c, x, -11.2 - R()*2.8, 0.95 + R()*0.45, R() < 0.3 ? pickR(R, blossom) : pickR(R, leaves), '#9a6a44');
    // front — flowers, little bushes, a mushroom or two (all lower than ~0.5)
    for(let x = -14; x < L + 14; x += 1.3 + R()*2.4){
      const z = BELT_Z1 + 1.1 + R()*2.8;
      if(R() < 0.55) KIT.flowers(c, x, z, ['#ffffff', '#ff8fbd', '#ffe36a', '#b48aff'], 3 + Math.floor(R()*3));
      else KIT.bush(c, x, z + 0.4, 0.45 + R()*0.2, pickR(R, leaves), null);
    }
    for(let x = -10; x < L + 12; x += 1.4 + R()*1.8) KIT.flowers(c, x, -4.9 - R()*1.2, ['#ffffff', '#ffe36a', '#ff8fbd'], 2);
    // signpost near the start
    c.at(-3); c.S(p.cyl6, '#9a6a44', [-3, 0.6, -3.9], null, [0.07, 1.2, 0.07]);
    c.S(p.rbox2, '#e8b878', [-2.65, 1.05, -3.85], [0, 0, -0.05], [0.9, 0.32, 0.08]); c.S(p.cone6, '#e8b878', [-2.1, 1.05, -3.85], [0, 0, -PI/2], [0.2, 0.2, 0.08]);
    // windmill (blades spin)
    for(const wx of [26, 70]){
      const z = -13.2, y = c.h(wx, z);
      c.at(wx);
      c.S(p.cyl, '#fff1dc', [wx, y + 1.9, z], null, [0.9, 3.8, 0.9]);
      c.S(p.cone, '#ff7a6b', [wx, y + 4.3, z], null, [1.15, 1.3, 1.15]);
      c.S(p.rbox2, '#a0643a', [wx, y + 0.55, z + 0.86], null, [0.5, 1.0, 0.1]);
      c.spin('windmill', wx, y + 3.6, z + 1.05, 1.0, 0.9);
    }
  },

  // ---- stage 2: castle town at dusk, market stalls & paper lanterns
  dusk(c){
    const { L, R } = c, p = prims();
    const awn = [['#ff6b5b', '#fff1d6'], ['#ffb347', '#fff6e0'], ['#5aa0e0', '#f4f8ff'], ['#7ac86a', '#fffbe6'], ['#ff8ac0', '#fff0f6']];
    // row A — market stalls with striped awnings, goods, pinwheels
    for(let x = -22; x < L + 22; x += 5.5 + R()*3){
      const z = -4.9 - R()*0.5, y = c.h(x, z), a = pickR(R, awn);
      c.at(x);
      c.S(p.rbox2, '#b07a4a', [x, y + 0.45, z], null, [2.2, 0.9, 0.9]);
      c.S(p.rbox2, '#8a5a34', [x, y + 0.93, z], null, [2.3, 0.08, 1.0]);
      for(const sx of [-1, 1]) c.S(p.cyl6, '#7a4a2a', [x + sx*1.05, y + 1.1, z - 0.3], null, [0.06, 2.2, 0.06]);
      for(let i=0;i<5;i++) c.W(p.rbox2, i%2 ? a[1] : a[0], [x - 0.96 + i*0.48, y + 2.1, z + 0.12], [-0.45, 0, 0], [0.48, 0.07, 1.3]);
      for(let i=0;i<5;i++) c.S(p.dot, pickR(R, ['#ff5a4a', '#ffb347', '#9ade6e', '#ffe36a', '#ff8ac0']), [x - 0.8 + i*0.4, y + 1.05, z + 0.15], null, 0.15);
      if(R() < 0.5) c.spin('pinwheel', x + 1.2, y + 1.55, z + 0.5, 0.45, 2.6);
    }
    // lantern strings between poles
    for(let x = -20; x < L + 22; x += 9 + R()*3){
      const z = -4.1, y = c.h(x, z), span = 6.5;
      c.at(x);
      c.S(p.cyl6, '#6a3a22', [x, y + 1.4, z], null, [0.07, 2.8, 0.07]);
      c.S(p.cyl6, '#6a3a22', [x + span, y + 1.4, z], null, [0.07, 2.8, 0.07]);
      for(let i=0;i<5;i++){
        const t = (i + 0.5)/5, lx = x + t*span, ly = y + 2.55 - Math.sin(t*PI)*0.4;
        KIT.lantern(c, lx, ly - 0.22, z, i%2 ? '#ffb347' : '#ff6b5b', 1.1);
      }
    }
    // row B — town houses: white plaster, dark wood, big soft tiled roofs
    for(let x = -22; x < L + 22; x += 4.6 + R()*1.6){
      const z = -8.6 - R()*1.3, y = c.h(x, z) - 0.1, s = 0.95 + R()*0.3, w = 2.8*s, h = 1.9*s;
      c.at(x);
      c.S(p.rbox, '#fff1dc', [x, y + h/2, z], null, [w, h, 1.9*s]);
      c.S(p.box, '#6a4430', [x, y + h*0.45, z + 0.96*s], null, [w*1.02, 0.12, 0.08]);
      for(const sx of [-0.45, 0, 0.45]) c.S(p.box, '#6a4430', [x + sx*w, y + h/2, z + 0.96*s], null, [0.1, h, 0.08]);
      const rc = pickR(R, ['#5a5a86', '#4a6a96', '#8a4a62']);
      c.S(p.rbox2, shade(rc, -0.05), [x, y + h + 0.02, z], null, [w*1.22, 0.14, 2.4*s]);
      c.S(p.pyr, rc, [x, y + h + 0.5*s, z], null, [w*0.8, 0.95*s, 1.62*s]);
      c.S(p.dot, '#ffd24d', [x, y + h + 1.0*s, z], null, [0.12*s, 0.1*s, 0.12*s]);
      c.GL(p.rbox2, '#ffd9a0', [x - w*0.22, y + h*0.72, z + 0.98*s], null, [0.5*s, 0.36*s, 0.05]);
      c.GL(p.rbox2, '#ffd9a0', [x + w*0.22, y + h*0.72, z + 0.98*s], null, [0.5*s, 0.36*s, 0.05]);
      c.W(p.rbox2, pickR(R, ['#3a5a9a', '#9a3a3a', '#3a7a5a']), [x, y + 0.72*s, z + 1.02*s], null, [0.8*s, 0.5*s, 0.04]);
    }
    // row C — autumn-ish round trees & a little pagoda
    for(let x = -24; x < L + 24; x += 3.4 + R()*3.4) KIT.tree(c, x, -11.4 - R()*2.6, 0.95 + R()*0.4, pickR(R, ['#e8a04a', '#d8b050', '#7ab85a', '#f0806a', '#c8c060']), '#7a4a2a');
    for(const px of [30, 78]){
      const z = -13, y = c.h(px, z);
      c.at(px);
      for(let i=0;i<3;i++){
        const r = 1.4 - i*0.3, yy = y + 0.9 + i*1.25;
        c.S(p.rbox, '#fff1dc', [px, yy, z], null, [r*1.3, 1.0, r*1.3]);
        c.S(p.cone, '#4a5a7a', [px, yy + 0.72, z], null, [r*1.25, 0.6, r*1.25]);
      }
      c.S(p.cone6, '#ffd24d', [px, y + 5.0, z], null, [0.1, 0.8, 0.1]);
    }
    // front — potted plants, small crates, noren flowers
    for(let x = -14; x < L + 14; x += 1.8 + R()*2.6){
      const z = BELT_Z1 + 1.2 + R()*2.6, y = c.h(x, z);
      c.at(x);
      if(R() < 0.5){ c.S(p.lathePot, '#d0784a', [x, y, z], null, [0.22, 0.28, 0.22]); c.S(p.sph, '#6ab85a', [x, y + 0.36, z], null, [0.22, 0.17, 0.22]); }
      else KIT.flowers(c, x, z, ['#ffb347', '#ff6b5b', '#fff1d6'], 3);
    }
  },

  // ---- stage 3: moonlit forest with glowing mushrooms
  forest(c){
    const { L, R } = c, p = prims();
    const leaves = ['#2e7a78', '#3a8a82', '#2a6a7a', '#4a9a86'];
    const caps = ['#7ff0ff', '#ff8ad8', '#c69aff', '#9affc8'];
    // row A — ferns, logs, small glowing mushrooms
    for(let x = -20; x < L + 22; x += 2.2 + R()*2.6){
      const z = -4.6 - R()*1.2;
      if(R() < 0.45) KIT.mushroom(c, x, z, 0.5 + R()*0.4, pickR(R, caps), null, 2.0);
      else KIT.bush(c, x, z - 0.3, 0.7 + R()*0.4, pickR(R, ['#3a8a6a', '#4a9a7a', '#2f7a66']), R() < 0.4 ? '#bff8ff' : null);
    }
    for(let x = -12; x < L + 14; x += 13 + R()*6){
      const z = -5.4, y = c.h(x, z);
      c.at(x);
      c.S(p.cyl, '#8a6a52', [x, y + 0.34, z], [0, 0.2, PI/2], [0.34, 2.0, 0.34]);
      c.S(p.cyl, '#e8d0a8', [x + 1.0, y + 0.34, z + 0.2], [0, 0.2, PI/2], [0.28, 0.04, 0.28]);
      KIT.mushroom(c, x - 0.4, z + 0.3, 0.35, pickR(R, caps), null, 0.6);
    }
    // row B — giant glowing mushrooms and tall trees
    for(let x = -22; x < L + 22;){
      const z = -8 - R()*2.2;
      if(R() < 0.35){ KIT.mushroom(c, x, z, 1.7 + R()*0.8, pickR(R, caps), '#e8f0ff', 3.4); x += 4 + R()*2; }
      else { KIT.bigTree(c, x, z, 0.82 + R()*0.22, pickR(R, leaves), '#6a5a5a'); x += 3 + R()*2.4; }
    }
    // tiny house in a tree stump
    for(const hx of [22, 66]){
      const z = -7.4, y = c.h(hx, z);
      c.at(hx);
      c.S(p.cyl, '#a07a5a', [hx, y + 0.8, z], null, [1.1, 1.6, 1.1]);
      c.S(p.cyl, '#e8d0a8', [hx, y + 1.61, z], null, [1.08, 0.04, 1.08]);
      c.S(p.rbox2, '#6a4a3a', [hx - 0.3, y + 0.45, z + 1.05], null, [0.45, 0.8, 0.1]);
      c.GL(p.cyl, '#ffd98a', [hx + 0.4, y + 0.95, z + 1.02], [PI/2, 0, 0], [0.2, 0.06, 0.2]);
      c.halo(hx + 0.4, y + 0.95, z + 1.2, '#ffd98a', 1.4);
      c.S(p.cone6, '#ff8ad8', [hx + 0.2, y + 2.3, z], null, [1.3, 1.4, 1.3]);
    }
    // row C — forest wall
    for(let x = -24; x < L + 24; x += 3.0 + R()*3.0) KIT.bigTree(c, x, -11.6 - R()*3, 0.66 + R()*0.24, pickR(R, leaves), '#5a4a5a');
    for(let x = -20; x < L + 20; x += 7 + R()*6) KIT.mushroom(c, x, -11 - R()*2.5, 1.1 + R()*0.6, pickR(R, caps), '#e8f0ff', 3.0);
    // front — glowing little flowers & mushrooms
    for(let x = -14; x < L + 14; x += 1.5 + R()*2.4){
      const z = BELT_Z1 + 1.1 + R()*2.8;
      if(R() < 0.4) KIT.mushroom(c, x, z, 0.3 + R()*0.15, pickR(R, caps), null, 0.5);
      else KIT.flowers(c, x, z, ['#bff8ff', '#ffc8f0', '#e0d0ff'], 3);
    }
  },

  // ---- stage 4: crystal cave
  cave(c){
    const { L, R } = c;
    const rocks = ['#4a5aa0', '#5a68b4', '#46509a', '#6070b8'];
    const cryst = ['#7ff0ff', '#ff9ad8', '#b48aff', '#a0ffd8'];
    const p = prims();
    for(let x = -22; x < L + 22; x += 1.8 + R()*2.4){
      const z = -4.8 - R()*1.4;
      if(R() < 0.45) KIT.crystal(c, x, z, 0.6 + R()*0.6, pickR(R, cryst), 1.2);
      else KIT.rock(c, x, z, 1.1 + R()*0.9, pickR(R, rocks));
    }
    // row B — rock pillars / stalagmites with crystal clusters
    for(let x = -22; x < L + 22; x += 3.4 + R()*3){
      const z = -8.5 - R()*2.5, y = c.h(x, z), h = 2.4 + R()*2.6, col = pickR(R, rocks);
      c.at(x);
      c.S(p.cone, col, [x, y + h/2, z], [0, x, 0], [0.9 + R()*0.4, h, 0.9]);
      c.S(p.lo, shade(col, 0.04), [x, y + 0.4, z], null, [1.3, 0.8, 1.1]);
      if(R() < 0.7) KIT.crystal(c, x + 0.9, z + 0.8, 0.9 + R()*0.8, pickR(R, cryst), 1.8);
    }
    // row C — big glowing crystals & rock walls
    for(let x = -24; x < L + 24; x += 2.5 + R()*2.6){
      const z = -12 - R()*5;
      if(R() < 0.4) KIT.crystal(c, x, z, 1.8 + R()*1.6, pickR(R, cryst), 3.0);
      else { const y = c.h(x, z), col = pickR(R, rocks); c.at(x); c.S(p.sph, col, [x, y + 1.2, z], [0, x, 0], [1.8 + R(), 2.0 + R()*1.4, 1.4]); }
    }
    // front — small crystals & pebbles
    for(let x = -14; x < L + 14; x += 1.6 + R()*2.4){
      const z = BELT_Z1 + 1.2 + R()*2.6;
      if(R() < 0.5) KIT.crystal(c, x, z, 0.32 + R()*0.18, pickR(R, cryst), 0.6);
      else KIT.rock(c, x, z, 0.5 + R()*0.3, pickR(R, rocks));
    }
  },

  // ---- stage 5: pirate airship deck
  airship(c){
    const { L, R } = c, p = prims();
    const x0 = -30, x1 = L + 30, len = x1 - x0;
    // hull: front side under the deck edge (visible at the bottom) and the back rim
    for(let x = x0; x < x1; x += 10){
      c.at(x + 5);
      c.S(p.box, '#8a4a3a', [x + 5, -1.6, BELT_Z1 + 2.2], null, [10, 3.2, 0.8]);
      c.S(p.box, '#a85a44', [x + 5, 0.06, BELT_Z1 + 2.2], null, [10, 0.2, 0.96]);
      c.S(p.box, '#ffcf5a', [x + 5, -0.3, BELT_Z1 + 2.62], null, [10, 0.12, 0.06]);
      for(let i=0;i<3;i++) { c.S(p.ring, '#ffcf5a', [x + 1.7 + i*3.3, -0.9, BELT_Z1 + 2.62], null, [0.28, 0.28, 0.6]); c.S(p.cyl, '#bfe6ff', [x + 1.7 + i*3.3, -0.9, BELT_Z1 + 2.6], [PI/2, 0, 0], [0.25, 0.05, 0.25]); }
      c.S(p.box, '#8a4a3a', [x + 5, -0.5, -7.9], null, [10, 1.2, 0.6]);
    }
    // back rail
    for(let x = x0; x < x1; x += 1.1){
      c.at(x);
      c.S(p.rbox2, '#c8884a', [x, 0.42, -7.5], null, [0.14, 0.84, 0.14]);
    }
    for(let x = x0; x < x1; x += 10){ c.at(x + 5); c.S(p.box, '#a86a3a', [x + 5, 0.88, -7.5], null, [10, 0.14, 0.2]); }
    // front low rail (never higher than ~0.5)
    for(let x = x0; x < x1; x += 1.3){ c.at(x); c.S(p.rbox2, '#c8884a', [x, 0.24, BELT_Z1 + 1.55], null, [0.12, 0.48, 0.12]); }
    for(let x = x0; x < x1; x += 10){ c.at(x + 5); c.S(p.box, '#a86a3a', [x + 5, 0.5, BELT_Z1 + 1.55], null, [10, 0.1, 0.16]); }
    // masts with sails & flags
    for(let x = -12; x < L + 16; x += 21 + R()*4){
      const z = -6.4;
      c.at(x);
      c.S(p.cyl, '#9a6a3a', [x, 3.3, z], null, [0.2, 6.6, 0.2]);
      c.S(p.cyl, '#8a5a30', [x, 4.2, z + 0.2], [0, 0, PI/2], [0.08, 3.6, 0.08]);
      c.W(p.rbox, '#fff6e0', [x, 3.0, z + 0.35], [0.1, 0, 0], [3.3, 2.2, 0.18]);
      c.W(p.rbox2, '#ff6b5b', [x, 2.7, z + 0.46], [0.1, 0, 0], [3.32, 0.3, 0.06]);
      c.W(p.rbox2, '#ff6b5b', [x, 3.35, z + 0.4], [0.1, 0, 0], [3.32, 0.3, 0.06]);
      c.S(p.heart, '#ffcf5a', [x, 3.05, z + 0.6], null, [0.75, 0.75, 0.4]);
      c.S(p.cyl, '#8a5a30', [x, 1.95, z + 0.2], [0, 0, PI/2], [0.07, 3.2, 0.07]);
      c.S(p.cyl, '#9a6a3a', [x, 5.2, z], null, [0.4, 0.34, 0.4]);
      KIT.flag(c, x, 5.35, z, 0.8, '#2a2a4a', '#9a6a3a');
      // rope ladders
      for(const sx of [-1, 1]) c.S(p.cyl6, '#e0c8a0', [x + sx*1.3, 2.7, z - 0.8], [0.24, 0, sx*0.2], [0.03, 5.6, 0.03]);
    }
    // cargo: barrels, crates, toy cannons, steering wheel, life rings
    for(let x = -20; x < L + 20; x += 4 + R()*4){
      const z = -4.4 - R()*1.6;
      c.at(x);
      const k = R();
      if(k < 0.35){ c.S(p.lathePot, '#c9874a', [x, 0, z], null, [0.42, 0.8, 0.42]); c.S(p.torus, '#6f6a78', [x, 0.3, z], [PI/2, 0, 0], [0.43, 0.43, 0.2]); }
      else if(k < 0.65){ c.S(p.rbox, '#d9a05b', [x, 0.4, z], null, [0.85, 0.8, 0.8]); c.S(p.rbox2, '#9c6230', [x, 0.4, z + 0.41], [0, 0, 0.75], [0.1, 0.9, 0.04]); if(R() < 0.5) c.S(p.rbox, '#e6b06a', [x + 0.2, 1.1, z - 0.1], [0, 0.3, 0], [0.6, 0.6, 0.6]); }
      else if(k < 0.85){
        c.S(p.cylHi, '#4a4a6a', [x, 0.55, z], [0, 0, PI/2 - 0.35], [0.24, 1.2, 0.24]);
        c.S(p.torus, '#ffcf5a', [x + 0.5, 0.75, z], [0, PI/2, 0], [0.26, 0.26, 0.3]);
        for(const sz of [-0.3, 0.3]) c.S(p.cyl, '#8a5a30', [x - 0.1, 0.25, z + sz], [PI/2, 0, 0], [0.26, 0.08, 0.26]);
      } else { c.S(p.torus, '#ffffff', [x, 0.9, -7.2], null, [0.42, 0.42, 0.5]); c.S(p.torus, '#ff6b5b', [x, 0.9, -7.18], [0, 0, PI/4], [0.43, 0.43, 0.2]); }
    }
    // propellers on poles behind the back rail
    for(let x = -1; x < L + 14; x += 21 + R()*4){
      c.at(x);
      c.S(p.cyl, '#8a8aa0', [x, 1.8, -8.3], null, [0.12, 3.2, 0.12]);
      c.S(p.cylHi, '#c8c8d8', [x, 3.4, -8.3], [PI/2, 0, 0], [0.32, 0.6, 0.32]);
      c.spin('propeller', x, 3.4, -7.95, 1.0, 9 + R()*3);
    }
    // the ship's wheel
    c.at(8); c.S(p.torus, '#a86a3a', [8, 1.3, -6.6], null, [0.55, 0.55, 0.6]); c.S(p.cyl, '#9a6a3a', [8, 0.6, -6.7], null, [0.1, 1.2, 0.1]);
    for(let i=0;i<4;i++) c.S(p.cyl6, '#a86a3a', [8, 1.3, -6.6], [0, 0, i*PI/4], [0.04, 1.5, 0.04]);
  },

  // ---- stage 6: snowy peak
  snow(c){
    const { L, R } = c, p = prims();
    const pines = ['#2f7a6a', '#3a8a74', '#2a6a64'];
    for(let x = -22; x < L + 22; x += 2.0 + R()*2.4){
      const z = -4.7 - R()*1.2, k = R();
      if(k < 0.35) KIT.rock(c, x, z, 1 + R()*0.8, '#9aaed0');
      else if(k < 0.6) KIT.pine(c, x, z - 0.4, 0.55 + R()*0.3, pickR(R, pines), '#ffffff');
      else { const y = c.h(x, z); c.at(x); c.S(p.lo, '#ffffff', [x, y + 0.1, z], null, [0.9 + R()*0.6, 0.45, 0.7]); }
    }
    for(let x = -10; x < L + 14; x += 14 + R()*8) KIT.snowman(c, x, -4.3, 0.85 + R()*0.25);
    // ice rocks with icicles
    for(let x = -18; x < L + 20; x += 9 + R()*6){
      const z = -7.4, y = c.h(x, z);
      c.at(x);
      c.S(p.rbox, '#9fb8e0', [x, y + 0.9, z], [0, 0.2, 0], [2.4, 1.8, 1.6]);
      c.S(p.lo, '#ffffff', [x, y + 1.85, z], null, [1.4, 0.35, 1.0]);
      for(let i=0;i<5;i++) c.S(p.cone6, '#dff4ff', [x - 1 + i*0.5, y + 1.5 - (i%2)*0.1, z + 0.82], [PI, 0, 0], [0.09, 0.45 + (i%3)*0.15, 0.09]);
      c.S(p.oct, '#bfeaff', [x + 1.5, y + 0.6, z + 0.4], [0, x, 0.2], [0.3, 0.8, 0.3]);
    }
    // igloo
    for(const ix of [30, 80]){
      const z = -9, y = c.h(ix, z);
      c.at(ix);
      c.S(p.hemi, '#f4f8ff', [ix, y, z], null, 1.5);
      c.S(p.cyl, '#f4f8ff', [ix + 0.4, y + 0.35, z + 1.3], [PI/2, 0, 0], [0.5, 0.8, 0.5]);
      c.S(p.cyl, '#6a7aa0', [ix + 0.4, y + 0.3, z + 1.72], [PI/2, 0, 0], [0.34, 0.04, 0.34]);
    }
    // row B/C — snowy pines
    for(let x = -24; x < L + 24; x += 1.6 + R()*1.8) KIT.pine(c, x, -8.5 - R()*9, 1.1 + R()*0.8, pickR(R, pines), '#ffffff');
    // front — snow mounds & tiny pines
    for(let x = -14; x < L + 14; x += 1.6 + R()*2.6){
      const z = BELT_Z1 + 1.2 + R()*2.6, y = c.h(x, z);
      c.at(x);
      if(R() < 0.6) c.S(p.lo, '#ffffff', [x, y, z], null, [0.6 + R()*0.4, 0.3, 0.5]);
      else KIT.pine(c, x, z + 0.6, 0.28, pickR(R, pines), '#ffffff');
    }
  },

  // ---- stage 7: dark (but cute) castle
  castle(c){
    const { L, R } = c, p = prims();
    const stone = ['#6a5a90', '#5e4e84', '#76669c'];
    const wz = -6.2;
    // inner wall: rounded blocks, running bond
    for(let row = 0; row < 2; row++){
      for(let x = -30 + (row%2)*1.1; x < L + 30; x += 2.2){
        c.at(x);
        c.S(p.rbox, pickR(R, stone), [x, 0.55 + row*1.08, wz], null, [2.14, 1.02, 1.0]);
      }
    }
    for(let x = -30; x < L + 30; x += 1.5){ c.at(x); c.S(p.rbox, '#7e6ea8', [x, 2.52, wz], null, [0.9, 0.7, 1.0]); }
    // banners, torches, candy pillars, dog statues
    for(let x = -24; x < L + 24; x += 7.5){
      c.at(x);
      c.S(p.cyl6, '#ffcf5a', [x, 2.05, wz + 0.58], [0, 0, PI/2], [0.04, 1.4, 0.04]);
      c.W(p.rbox2, '#8a3ad0', [x, 1.35, wz + 0.58], null, [1.1, 1.4, 0.06]);
      c.W(p.cone6, '#8a3ad0', [x, 0.52, wz + 0.58], [PI, 0, 0], [0.55, 0.32, 0.04]);
      c.W(p.star, '#ffd24d', [x, 1.45, wz + 0.64], null, [0.8, 0.8, 0.3]);
      c.W(p.rbox2, '#ffd24d', [x, 1.98, wz + 0.62], null, [1.12, 0.1, 0.04]);
      // torches
      for(const sx of [-3.75]){
        const tx = x + sx;
        c.at(tx);
        c.S(p.cone6, '#3a2a4a', [tx, 1.45, wz + 0.62], [PI, 0, 0], [0.18, 0.5, 0.18]);
        c.S(p.cyl6, '#ffcf5a', [tx, 1.7, wz + 0.62], null, [0.2, 0.06, 0.2]);
        c.GL(p.lo, '#c86aff', [tx, 1.96, wz + 0.62], null, [0.2, 0.3, 0.2]);
        c.GL(p.cone6, '#ffc8ff', [tx, 2.16, wz + 0.62], null, [0.1, 0.34, 0.1]);
        c.halo(tx, 2.0, wz + 0.8, '#c070ff', 2.2);
      }
    }
    for(let x = -20; x < L + 22; x += 15 + R()*5){
      c.at(x);
      for(let i=0;i<5;i++) c.S(p.cyl, i%2 ? '#ffffff' : '#ff8ad0', [x, 0.3 + i*0.6, wz + 1.1], [0, i*0.4, 0], [0.34, 0.6, 0.34]);
      c.GL(p.sph, '#ff9ae8', [x, 3.4, wz + 1.1], null, 0.5);
      c.S(p.torus, '#ffcf5a', [x, 3.0, wz + 1.1], [PI/2, 0, 0], [0.4, 0.4, 0.6]);
      c.halo(x, 3.4, wz + 1.3, '#ff7ae0', 2.6);
      KIT.dogStatue(c, x + 3.6, wz + 1.2, 0.9, '#8a7aa8');
    }
    // towers behind the wall
    for(let x = -22; x < L + 24; x += 9 + R()*5){
      const z = -10.5 - R()*4, h = 5 + R()*3;
      c.at(x);
      c.S(p.cyl, pickR(R, stone), [x, h/2, z], null, [1.2, h, 1.2]);
      c.S(p.cone, pickR(R, ['#4a2a7a', '#6a3a8a', '#3a2a6a']), [x, h + 1.1, z], null, [1.6, 2.2, 1.6]);
      c.S(p.dot, '#ffcf5a', [x, h + 2.3, z], null, 0.14);
      for(let i=0;i<2;i++) c.GL(p.rbox2, '#ffd27a', [x, h*0.45 + i*1.4, z + 1.18], null, [0.36, 0.56, 0.06]);
      KIT.flag(c, x, h + 2.1, z, 0.7, '#8a3ad0', '#6a5a7a');
    }
    // front — candles & purple mushrooms (low)
    for(let x = -14; x < L + 14; x += 1.8 + R()*2.6){
      const z = BELT_Z1 + 1.3 + R()*2.4, y = c.h(x, z);
      c.at(x);
      if(R() < 0.5){
        for(let i=0;i<3;i++){ const cx = x + (i-1)*0.22, h = 0.2 + (i%2)*0.14; c.S(p.cyl6, '#fff1f8', [cx, y + h/2, z + (i%2)*0.1], null, [0.07, h, 0.07]); c.GL(p.dot, '#ffc8ff', [cx, y + h + 0.07, z + (i%2)*0.1], null, [0.05, 0.08, 0.05]); }
        c.halo(x, y + 0.35, z + 0.1, '#d68aff', 0.9);
      } else KIT.mushroom(c, x, z, 0.3, '#c69aff', '#e8e0f8', 0.5);
    }
  },
};

// boss / mid-boss arena range (shared by the decor and the progression)
const ARENA_W = 17;
function arenaRange(def, spot){ const a = Math.max(-2, spot.at - 4), b = Math.min(def.length + 4, a + (spot.width || ARENA_W)); return [a, b]; }
// arena dressing near the boss (and mid-boss): two poles with a string of little pennants between them
function arenaDecor(c, def){
  const p = prims(), th = def.theme;
  const pal = { town:['#ff6b5b','#ffd24d','#5aa0e0','#7ac86a','#ff8ac0'], dusk:['#ff6b5b','#ffb347','#fff1d6','#ff8ac0'],
    forest:['#9a7aff','#7ff0ff','#ff8ad8','#9affc8'], cave:['#7ff0ff','#ff9ad8','#b48aff','#a0ffd8'],
    airship:['#ff6b5b','#ffffff','#5aa0e0','#ffd24d'], snow:['#6ab0ff','#ff6b8a','#ffffff','#ffd24d'], castle:['#8a3ad0','#ffd24d','#ff8ad0','#c89aff'] }[th.scenery] || ['#ff6b5b','#ffd24d'];
  const glowy = th.scenery==='forest' || th.scenery==='cave' || th.scenery==='castle';
  const spots = [def.boss]; if(def.mid) spots.push(def.mid);
  for(const b of spots){
    const [a, e] = arenaRange(def, b), z = -4.25, x0 = a + 1, x1 = e - 1;
    const flat = th.scenery==='airship' || th.scenery==='castle';
    const y0 = flat ? 0 : c.h(x0, z), y1 = flat ? 0 : c.h(x1, z), top = 2.7;
    for(const [x, y] of [[x0, y0], [x1, y1]]){
      c.at(x);
      c.S(p.cyl6, '#7a5236', [x, y + top/2, z], null, [0.07, top, 0.07]);
      c.S(p.sph, pal[0], [x, y + top + 0.08, z], null, 0.13);
    }
    const n = Math.round((x1 - x0)/0.75);
    for(let i=1;i<n;i++){
      const t = i/n, x = U.lerp(x0, x1, t), y = U.lerp(y0, y1, t) + top - 0.12 - Math.sin(t*PI)*0.75, col = pal[i % pal.length];
      c.at(x);
      c.W(p.cone6, col, [x, y - 0.2, z], [PI, PI/6, 0], [0.2, 0.36, 0.05]);
      if(glowy && i % 2===0) c.halo(x, y - 0.2, z + 0.1, col, 0.7);
    }
  }
}

// ================================================================ ground textures (hand-painted canvas)
// belt: 512×384 px covers TILE units of x × the belt depth; surround: 256×256 px = 4×4 units
const TILE = 8;
function wrapBlob(x, W, H, rx, fn){ fn(x); if(x - rx < 0) fn(x + W); if(x + rx > W) fn(x - W); }
function ellipse(g, x, y, rx, ry, col, rot){ g.fillStyle = col; g.beginPath(); g.ellipse(x, y, rx, ry, rot||0, 0, TAU); g.fill(); }
function speckle(g, W, H, R, n, cols, r0, r1, yr, wrapY){
  for(let i=0;i<n;i++){
    const x = R()*W, y = yr ? yr[0]*H + R()*(yr[1]-yr[0])*H : R()*H, r = r0 + R()*(r1 - r0), col = cols[Math.floor(R()*cols.length)];
    wrapBlob(x, W, H, r, (xx)=>{ ellipse(g, xx, y, r, r*0.8, col); if(wrapY){ if(y - r < 0) ellipse(g, xx, y + H, r, r*0.8, col); if(y + r > H) ellipse(g, xx, y - H, r, r*0.8, col); } });
  }
}
function tufts(g, W, H, R, n, cols, yr, wrapY){
  g.lineWidth = 2.2; g.lineCap = 'round';
  for(let i=0;i<n;i++){
    const x = R()*W, y = yr ? yr[0]*H + R()*(yr[1]-yr[0])*H : R()*H, s = 4 + R()*5;
    g.strokeStyle = cols[Math.floor(R()*cols.length)];
    wrapBlob(x, W, H, 8, (xx)=>{
      g.beginPath(); g.moveTo(xx - s*0.6, y - s); g.quadraticCurveTo(xx - s*0.1, y - s*0.3, xx, y);
      g.moveTo(xx + s*0.6, y - s*0.9); g.quadraticCurveTo(xx + s*0.1, y - s*0.3, xx, y);
      g.moveTo(xx, y - s*1.2); g.lineTo(xx, y); g.stroke();
    });
  }
}
function flowerDots(g, W, H, R, n, cols, yr){
  for(let i=0;i<n;i++){
    const x = R()*W, y = yr ? yr[0]*H + R()*(yr[1]-yr[0])*H : R()*H, col = cols[Math.floor(R()*cols.length)], r = 2.4 + R()*1.4;
    wrapBlob(x, W, H, 6, (xx)=>{ for(let k=0;k<5;k++){ const a = k/5*TAU; ellipse(g, xx + Math.cos(a)*r, y + Math.sin(a)*r*0.8, r*0.75, r*0.62, col); } ellipse(g, xx, y, r*0.6, r*0.5, '#ffd84a'); });
  }
}
function pawPrint(g, x, y, s, col){ ellipse(g, x, y, 5*s, 4.2*s, col); for(let k=0;k<4;k++){ const a = -PI*0.5 + (k-1.5)*0.55; ellipse(g, x + Math.cos(a)*7*s, y + Math.sin(a)*6.5*s, 2*s, 2.2*s, col); } }
// wavy path edges (tileable: integer frequencies over the tile)
function pathEdge(u, base, amp, ph){ return base + amp*(Math.sin(u*TAU*2 + ph)*0.6 + Math.sin(u*TAU*5 + ph*2)*0.4); }
function fillPath(g, W, H, top, bot, col){
  g.fillStyle = col; g.beginPath();
  for(let x=0;x<=W;x+=4) g.lineTo(x, top(x/W)*H);
  for(let x=W;x>=0;x-=4) g.lineTo(x, bot(x/W)*H);
  g.closePath(); g.fill();
}
const GROUND = {
  meadow:{
    base:'#78c656',
    surround(g, W, H, R){ g.fillStyle = this.base; g.fillRect(0,0,W,H); speckle(g, W, H, R, 40, ['#70be50', '#84d062'], 8, 18, null, true); tufts(g, W, H, R, 70, ['#5eae44', '#98d86e', '#56a43e'], null, true); flowerDots(g, W, H, R, 7, ['#ffffff', '#ffb0d0', '#fff08a']); },
    belt(g, W, H, R){
      g.fillStyle = this.base; g.fillRect(0,0,W,H);
      speckle(g, W, H, R, 60, ['#70be50', '#84d062'], 8, 18);
      const top = (u)=> pathEdge(u, 0.24, 0.03, 0.4), bot = (u)=> pathEdge(u, 0.8, 0.028, 2.1);
      fillPath(g, W, H, (u)=> top(u) - 0.012, (u)=> bot(u) + 0.012, '#d9b77e');
      fillPath(g, W, H, top, bot, '#efd29c');
      speckle(g, W, H, R, 70, ['#e2c28a', '#f6e0b4', '#dcbc84'], 3, 9, [0.3, 0.75]);
      speckle(g, W, H, R, 26, ['#fff4dc', '#d6b27a'], 2, 4, [0.3, 0.75]);
      tufts(g, W, H, R, 90, ['#5eae44', '#98d86e', '#56a43e'], [0.0, 0.24]); tufts(g, W, H, R, 90, ['#5eae44', '#98d86e', '#56a43e'], [0.8, 1.0]);
      tufts(g, W, H, R, 26, ['#5eae44', '#7cc85a'], [0.2, 0.3]); tufts(g, W, H, R, 26, ['#5eae44', '#7cc85a'], [0.76, 0.84]);
      flowerDots(g, W, H, R, 10, ['#ffffff', '#ffb0d0', '#fff08a'], [0.03, 0.2]); flowerDots(g, W, H, R, 10, ['#ffffff', '#ffb0d0', '#fff08a'], [0.84, 0.97]);
    },
  },
  cobble:{
    base:'#dcb488',
    surround(g, W, H, R){ g.fillStyle = this.base; g.fillRect(0,0,W,H); speckle(g, W, H, R, 60, ['#d2a87c', '#e6c29a', '#caa074'], 4, 12, null, true); speckle(g, W, H, R, 30, ['#b89070', '#f0d4b0'], 2, 4, null, true); },
    belt(g, W, H, R){
      g.fillStyle = this.base; g.fillRect(0,0,W,H); speckle(g, W, H, R, 60, ['#d2a87c', '#e6c29a'], 4, 12);
      const rows = 8, rh = H*0.84/rows, y0 = H*0.08;
      g.fillStyle = '#9a7a60'; g.fillRect(0, y0 - 3, W, H*0.84 + 6);
      for(let r=0;r<rows;r++){
        const off = (r%2)*0.5, cw = W/12;
        for(let i=-1;i<13;i++){
          const x = (i + off)*cw, y = y0 + r*rh, col = pickR(R, ['#d6c2a6', '#c8b294', '#e2d0b4', '#cdb89c', '#d8c0a0']);
          g.fillStyle = col; roundRect(g, x + 2.5, y + 2.5, cw - 5, rh - 5, 9); g.fill();
          g.fillStyle = 'rgba(255,255,255,0.28)'; roundRect(g, x + 6, y + 5, cw*0.5, rh*0.28, 5); g.fill();
        }
      }
    },
  },
  forest:{
    base:'#4f9a86',
    surround(g, W, H, R){ g.fillStyle = this.base; g.fillRect(0,0,W,H); speckle(g, W, H, R, 40, ['#48927e', '#58a490'], 8, 18, null, true); tufts(g, W, H, R, 60, ['#3f8a76', '#6ab8a0'], null, true); flowerDots(g, W, H, R, 6, ['#bff8ff', '#ffc8f0']); },
    belt(g, W, H, R){
      g.fillStyle = this.base; g.fillRect(0,0,W,H); speckle(g, W, H, R, 50, ['#48927e', '#58a490'], 8, 18);
      const top = (u)=> pathEdge(u, 0.22, 0.03, 1.2), bot = (u)=> pathEdge(u, 0.82, 0.03, 0.2);
      fillPath(g, W, H, top, bot, '#7cb89a');
      speckle(g, W, H, R, 50, ['#74b092', '#88c4a6'], 5, 12, [0.26, 0.78]);
      for(let i=0;i<9;i++){ const x = (i + 0.5)*W/9 + (R()-0.5)*14, y = H*(0.42 + (i%2)*0.2); ellipse(g, x, y + 3, 26, 17, '#6a8a9a'); ellipse(g, x, y, 25, 16, '#c8d4e6'); ellipse(g, x - 6, y - 5, 10, 5, '#e6eef8'); }
      tufts(g, W, H, R, 80, ['#3f8a76', '#6ab8a0'], [0, 0.22]); tufts(g, W, H, R, 80, ['#3f8a76', '#6ab8a0'], [0.82, 1]);
      flowerDots(g, W, H, R, 12, ['#bff8ff', '#ffc8f0', '#e8ffa0'], [0.02, 0.18]); flowerDots(g, W, H, R, 12, ['#bff8ff', '#ffc8f0'], [0.85, 0.98]);
    },
  },
  crystal:{
    base:'#5262a8',
    surround(g, W, H, R){ g.fillStyle = this.base; g.fillRect(0,0,W,H); speckle(g, W, H, R, 50, ['#4a5a9e', '#5e6eb6', '#46569a'], 6, 16, null, true); speckle(g, W, H, R, 26, ['#9ff0ff', '#ffb8ec'], 1.5, 3, null, true); },
    belt(g, W, H, R){
      g.fillStyle = this.base; g.fillRect(0,0,W,H);
      const n = 6, cw = W/n, rows = 4, rh = H*0.86/rows, y0 = H*0.07;
      g.fillStyle = '#9ff0ff'; g.fillRect(0, y0 - 2, W, H*0.86 + 4);
      for(let r=0;r<rows;r++) for(let i=-1;i<=n;i++){
        const x = (i + (r%2)*0.5)*cw, y = y0 + r*rh;
        g.fillStyle = pickR(R, ['#7282c8', '#7a8ad2', '#6a7abe', '#8090d8']); roundRect(g, x + 3, y + 3, cw - 6, rh - 6, 14); g.fill();
        g.fillStyle = 'rgba(255,255,255,0.18)'; roundRect(g, x + 8, y + 7, cw*0.55, rh*0.22, 8); g.fill();
      }
      for(let i=0;i<14;i++){ const x = R()*W, y = H*(0.1 + R()*0.8), s = 5 + R()*6; g.fillStyle = pickR(R, ['#bff8ff', '#ffc8f0', '#d8c0ff']); g.beginPath(); g.moveTo(x, y - s*1.6); g.lineTo(x + s*0.6, y); g.lineTo(x, y + s*0.6); g.lineTo(x - s*0.6, y); g.fill(); }
    },
  },
  deck:{
    base:'#d9a066',
    planks(g, W, H, R, wrapY){
      const rh = 26, rows = Math.ceil(H/rh);
      for(let r=0;r<rows;r++){
        let x = -R()*120;
        while(x < W){
          const len = 110 + R()*150, col = pickR(R, ['#d9a066', '#cf9458', '#e2ad72', '#d49a5e']);
          g.fillStyle = col; g.fillRect(x, r*rh, len, rh);
          g.strokeStyle = 'rgba(140,80,40,0.25)'; g.lineWidth = 1.2;
          for(let k=0;k<2;k++){ g.beginPath(); const yy = r*rh + 7 + k*9 + R()*3; g.moveTo(x + 6, yy); g.bezierCurveTo(x + len*0.3, yy - 3, x + len*0.6, yy + 3, x + len - 6, yy); g.stroke(); }
          g.fillStyle = '#8a5530'; g.fillRect(x + len - 2, r*rh, 2.5, rh);
          ellipse(g, x + 7, r*rh + 7, 2, 2, '#7a4a28'); ellipse(g, x + 7, r*rh + rh - 7, 2, 2, '#7a4a28');
          x += len;
        }
        g.fillStyle = '#9a6034'; g.fillRect(0, r*rh + rh - 2, W, 2);
      }
    },
    surround(g, W, H, R){ this.planks(g, W, H, R); },
    belt(g, W, H, R){ this.planks(g, W, H, R); },
  },
  snow:{
    base:'#f2f7ff',
    surround(g, W, H, R){ g.fillStyle = this.base; g.fillRect(0,0,W,H); speckle(g, W, H, R, 30, ['#e4edfa', '#f8fbff'], 10, 24, null, true); speckle(g, W, H, R, 40, ['#ffffff', '#cfe4ff'], 1.2, 2.5, null, true); },
    belt(g, W, H, R){
      g.fillStyle = this.base; g.fillRect(0,0,W,H); speckle(g, W, H, R, 40, ['#e4edfa', '#f8fbff'], 10, 24);
      const top = (u)=> pathEdge(u, 0.25, 0.03, 0.9), bot = (u)=> pathEdge(u, 0.78, 0.03, 1.7);
      fillPath(g, W, H, (u)=> top(u) - 0.015, (u)=> bot(u) + 0.015, '#c9d8f0');
      fillPath(g, W, H, top, bot, '#d6e2f6');
      speckle(g, W, H, R, 40, ['#ccdaf2', '#e0e9f8'], 5, 12, [0.28, 0.75]);
      for(let i=0;i<8;i++){ const x = i*W/8 + 10; pawPrint(g, x, H*0.46, 0.9, '#b4c6e6'); pawPrint(g, x + W/16, H*0.56, 0.9, '#b4c6e6'); }
      speckle(g, W, H, R, 50, ['#ffffff', '#cfe4ff'], 1.2, 2.5);
    },
  },
  castle:{
    base:'#5c4c80',
    tiles(g, W, H, R){
      const s = 64;
      for(let y=0;y<H;y+=s) for(let x=0;x<W;x+=s){
        const odd = ((x/s + y/s) % 2)===1;
        g.fillStyle = '#44365e'; g.fillRect(x, y, s, s);
        g.fillStyle = odd ? '#6a5a92' : '#5c4c80'; roundRect(g, x + 2, y + 2, s - 4, s - 4, 8); g.fill();
        g.fillStyle = 'rgba(255,255,255,0.10)'; roundRect(g, x + 6, y + 5, s*0.55, s*0.2, 5); g.fill();
      }
    },
    surround(g, W, H, R){ this.tiles(g, W, H, R); },
    belt(g, W, H, R){
      this.tiles(g, W, H, R);
      const t = H*0.3, b = H*0.72;
      g.fillStyle = '#ffcc55'; g.fillRect(0, t - 8, W, b - t + 16);
      g.fillStyle = '#b0386a'; g.fillRect(0, t, W, b - t);
      g.fillStyle = '#c84a7e'; g.fillRect(0, t + 6, W, 5); g.fillRect(0, b - 11, W, 5);
      for(let i=0;i<4;i++) pawPrint(g, (i + 0.5)*W/4, (t + b)/2 + 4, 1.6, '#d6609a');
    },
  },
};
function roundRect(g, x, y, w, h, r){ g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
function paintTex(style, which, w, h, seed, repeat){
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const g = cv.getContext('2d'), R = mulberry(seed);
  GROUND[style][which](g, w, h, R);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping; t.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.anisotropy = Math.min(8, G.renderer && G.renderer.capabilities ? G.renderer.capabilities.getMaxAnisotropy() : 1);
  return t;
}

// ================================================================ shaders
const SKY_VS = `varying vec3 vDir;
void main(){ vDir = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }`;
const SKY_FS = `uniform vec3 uTop; uniform vec3 uMid; uniform vec3 uBot; uniform float uH0; uniform float uH1;
uniform vec3 uSunDir; uniform vec3 uSunCol; uniform vec3 uGlowCol; uniform float uSunR; uniform float uGlowR; uniform float uGlowStr;
uniform float uMoon; uniform float uStars; uniform float uTime; uniform float uHdr;
varying vec3 vDir;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main(){
  vec3 d = normalize(vDir);
  float t = clamp((d.y - uH0) / (uH1 - uH0), 0.0, 1.0);
  vec3 col = mix(uBot, uMid, smoothstep(0.0, 0.55, t));
  col = mix(col, uTop, smoothstep(0.5, 1.0, t));
  if(uStars > 0.0){
    vec2 sp = vec2(atan(d.x, -d.z) * 70.0, d.y * 140.0);
    vec2 cell = floor(sp); vec2 f = fract(sp) - 0.5;
    float h = hash(cell);
    float tw = 0.55 + 0.45 * sin(uTime * (1.5 + h * 3.0) + h * 40.0);
    float star = step(0.9, h) * smoothstep(0.16, 0.0, length(f + (vec2(hash(cell + 3.1), hash(cell + 7.7)) - 0.5) * 0.6)) * tw;
    col += vec3(1.0, 0.96, 0.86) * star * uStars * smoothstep(0.15, 0.6, t);
  }
  float cs = clamp(dot(d, uSunDir), -1.0, 1.0);
  float ang = acos(cs);
  col += uGlowCol * uGlowStr * exp(-ang / max(0.001, uGlowR));
  if(uSunR > 0.0){
    float disc = smoothstep(uSunR, uSunR * 0.92, ang);
    vec3 dc = uSunCol;
    if(uMoon > 0.5){
      vec3 r = normalize(cross(vec3(0.0, 1.0, 0.0), uSunDir)); vec3 u = cross(uSunDir, r);
      vec2 q = vec2(dot(d, r), dot(d, u)) / uSunR;
      float cr = smoothstep(0.26, 0.2, length(q - vec2(-0.32, 0.22))) + smoothstep(0.17, 0.11, length(q - vec2(0.36, -0.18)))
               + smoothstep(0.13, 0.08, length(q - vec2(0.08, 0.52))) + smoothstep(0.11, 0.06, length(q - vec2(-0.12, -0.46)));
      dc = mix(dc, dc * 0.84, clamp(cr, 0.0, 1.0));
      dc *= 1.0 - 0.16 * smoothstep(0.2, 1.0, length(q + vec2(0.35, -0.35)));
    } else {
      dc = mix(dc, vec3(1.0), 0.5 * (1.0 - ang / uSunR));
    }
    col = mix(col, dc * uHdr, disc);
  }
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
// ambient particles: positions wrap inside a box that follows the camera (no CPU work per frame)
const PART_VS = `uniform float uTime; uniform vec3 uBoxMin; uniform vec3 uBoxSize; uniform vec3 uVel; uniform float uWob; uniform float uSize; uniform float uPx; uniform float uTwinkle;
attribute vec4 aRnd;
varying float vMix; varying float vAlpha; varying float vRot;
void main(){
  float sp = 0.6 + 0.8 * aRnd.x; float ph = aRnd.y * 6.2831;
  vec3 p = position + uVel * uTime * sp;
  p.x += sin(uTime * 1.3 * sp + ph) * uWob;
  p.y += sin(uTime * 0.9 + ph * 1.7) * uWob * 0.35;
  p.z += cos(uTime * 1.1 * sp + ph) * uWob * 0.6;
  p = uBoxMin + mod(p - uBoxMin, uBoxSize);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(uSize * (0.55 + 0.9 * aRnd.z) * uPx * projectionMatrix[1][1] / max(0.5, -mv.z), 1.0, 80.0);
  vec3 f = (p - uBoxMin) / uBoxSize;
  vAlpha = smoothstep(0.0, 0.08, f.x) * smoothstep(1.0, 0.92, f.x) * smoothstep(0.0, 0.1, f.y) * smoothstep(1.0, 0.85, f.y);
  vAlpha *= mix(1.0, 0.25 + 0.75 * (0.5 + 0.5 * sin(uTime * (2.0 + 3.0 * aRnd.x) + ph * 3.0)), uTwinkle);
  vMix = aRnd.w; vRot = ph + uTime * (aRnd.x - 0.5) * 4.0;
}`;
const PART_FS = `uniform vec3 uColA; uniform vec3 uColB; uniform float uShape; uniform float uOpacity;
varying float vMix; varying float vAlpha; varying float vRot;
void main(){
  vec2 c = gl_PointCoord - 0.5;
  vec3 col = mix(uColA, uColB, vMix); float a = 0.0;
  if(uShape < 0.5){ float d = length(c) * 2.0; a = exp(-d * d * 5.0) + 0.6 * smoothstep(0.4, 0.1, d); col = mix(col, vec3(1.0), smoothstep(0.35, 0.0, d) * 0.6); }
  else if(uShape < 1.5){ float s = sin(vRot), co = cos(vRot); vec2 q = vec2(co * c.x - s * c.y, s * c.x + co * c.y); q.y *= 1.8; q.x += q.y * q.y * 0.8;
    float d = length(q) * 2.0; a = smoothstep(1.0, 0.82, d); col = mix(col, vec3(1.0), 0.35 * (1.0 - d)); }
  else if(uShape < 2.5){ vec2 q = abs(c) * 2.0; float cr = max(0.0, 1.0 - (q.x * 5.0 + q.y * 0.9)) + max(0.0, 1.0 - (q.y * 5.0 + q.x * 0.9));
    float core = exp(-dot(q, q) * 12.0); a = clamp(cr + core, 0.0, 1.0); col = mix(col, vec3(1.0), core); }
  else { float d = length(c) * 2.0; a = smoothstep(1.0, 0.55, d); col = mix(col, vec3(1.0), 0.5 * (1.0 - d)); }
  a *= vAlpha * uOpacity;
  if(a < 0.01) discard;
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
// soft light halos around lamps / mushrooms / crystals / torches (static points, gentle pulse)
const HALO_VS = `uniform float uTime; uniform float uPx; attribute float aSize; attribute float aPh; varying vec3 vCol; varying float vA;
void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(aSize * uPx * projectionMatrix[1][1] / max(0.5, -mv.z), 1.0, 220.0);
  vCol = color; vA = 0.78 + 0.22 * sin(uTime * 2.2 + aPh); }`;
const HALO_FS = `uniform float uStr; varying vec3 vCol; varying float vA;
void main(){ vec2 c = gl_PointCoord - 0.5; float d = length(c) * 2.0; float a = exp(-d * d * 4.0) * smoothstep(1.0, 0.7, d) * vA * uStr;
  if(a < 0.004) discard; gl_FragColor = vec4(vCol, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
// wind sway (vertex shader); amp is the GLSL expression for the sway amount
const swayGLSL = (amp)=> `{ float h_ = max(0.0, position.y - 0.7); float ph_ = position.x * 0.45 + position.z * 0.3;
  transformed.x += sin(uTime * 1.6 + ph_) * ${amp} * h_; transformed.z += cos(uTime * 1.25 + ph_ * 1.3) * ${amp} * 0.5 * h_; }`;

// ================================================================ environment state
const env = {
  built:false, idx:-1, root:null, own:[], sky:null, far:null, farPar:0.75, clouds:null, cloudData:null,
  parts:null, halos:null, spinners:[], time:0, swayU:{ uTime:{ value:0 }, uSway:{ value:0.018 } },
  partU:null, haloU:null, skyU:null, stats:null,
};
const defaults = { saved:false };
function saveDefaults(){
  if(defaults.saved || !G.lights) return;
  const L = G.lights;
  defaults.saved = true;
  defaults.hemiSky = L.hemi.color.clone(); defaults.hemiGround = L.hemi.groundColor.clone(); defaults.hemi = L.hemi.intensity;
  defaults.key = L.key.color.clone(); defaults.keyI = L.key.intensity;
  defaults.rim = L.rim.color.clone(); defaults.rimI = L.rim.intensity;
  defaults.fill = L.fill.color.clone(); defaults.fillI = L.fill.intensity;
  defaults.exposure = G.renderer ? G.renderer.toneMappingExposure : 1.08;
  defaults.fog = G.scene.fog ? { color:G.scene.fog.color.clone(), near:G.scene.fog.near, far:G.scene.fog.far } : null;
  defaults.clear = G.renderer ? G.renderer.getClearColor(new THREE.Color()) : null;
  const u = G.look.uni;
  defaults.rimLook = [u.uRimColor.value.clone(), u.uRimStr.value, u.uWarm.value.clone(), u.uWarmStr.value];
}
function applyTheme(th){
  saveDefaults();
  const L = G.lights, l = th.light;
  if(L){
    L.hemi.color.set(l.hemiSky); L.hemi.groundColor.set(l.hemiGround); L.hemi.intensity = l.hemi;
    L.key.color.set(l.key); L.key.intensity = l.keyI;
    L.rim.color.set(l.rim); L.rim.intensity = l.rimI;
    L.fill.color.set(l.fill); L.fill.intensity = l.fillI;
  }
  if(G.renderer){ G.renderer.toneMappingExposure = th.exposure; G.renderer.setClearColor(new THREE.Color(th.fog.color), 1); }
  if(G.scene.fog){ G.scene.fog.color.set(th.fog.color); G.scene.fog.near = th.fog.near; G.scene.fog.far = th.fog.far; }
  else G.scene.fog = new THREE.Fog(th.fog.color, th.fog.near, th.fog.far);
  G.scene.background = new THREE.Color(th.fog.color);
  const r = th.rimLook; G.look.setRim(r[0], r[1], r[2], r[3]);
}
function restoreDefaults(){
  if(!defaults.saved) return;
  const L = G.lights;
  if(L){
    L.hemi.color.copy(defaults.hemiSky); L.hemi.groundColor.copy(defaults.hemiGround); L.hemi.intensity = defaults.hemi;
    L.key.color.copy(defaults.key); L.key.intensity = defaults.keyI;
    L.rim.color.copy(defaults.rim); L.rim.intensity = defaults.rimI;
    L.fill.color.copy(defaults.fill); L.fill.intensity = defaults.fillI;
  }
  if(G.renderer){ G.renderer.toneMappingExposure = defaults.exposure; if(defaults.clear) G.renderer.setClearColor(defaults.clear, 1); }
  G.scene.background = null;   // scenes that want a colour set their own (viewer / arena do)
  if(defaults.fog && G.scene.fog){ G.scene.fog.color.copy(defaults.fog.color); G.scene.fog.near = defaults.fog.near; G.scene.fog.far = defaults.fog.far; }
  const r = defaults.rimLook; G.look.setRim('#'+r[0].getHexString(), r[1], '#'+r[2].getHexString(), r[3]);
}

function own(x){ env.own.push(x); return x; }
function addObj(o){ env.root.add(o); return o; }

// ---------------------------------------------------------------- sky dome
function buildSky(th){
  const s = th.sky, sun = th.sun;
  const dir = new THREE.Vector3(sun.dir[0], sun.dir[1], sun.dir[2]).normalize();
  env.skyU = {
    uTop:{ value:new THREE.Color(s.top) }, uMid:{ value:new THREE.Color(s.mid) }, uBot:{ value:new THREE.Color(s.bot) },
    uH0:{ value:s.h0 }, uH1:{ value:s.h1 },
    uSunDir:{ value:dir }, uSunCol:{ value:new THREE.Color(sun.color) }, uGlowCol:{ value:new THREE.Color(sun.glow) },
    uSunR:{ value:sun.r }, uGlowR:{ value:sun.glowR }, uGlowStr:{ value:sun.glowStr }, uMoon:{ value:sun.moon||0 },
    uStars:{ value:th.stars||0 }, uTime:{ value:0 }, uHdr:{ value:1 },
  };
  const mat = own(new THREE.ShaderMaterial({ uniforms:env.skyU, vertexShader:SKY_VS, fragmentShader:SKY_FS, side:THREE.BackSide, depthWrite:false, fog:false }));
  const geo = own(new THREE.SphereGeometry(300, 40, 20));
  const m = new THREE.Mesh(geo, mat);
  m.frustumCulled = false; m.renderOrder = -1000; m.name = 'sky';
  env.sky = addObj(m);
}

// ---------------------------------------------------------------- ground (belt + surroundings)
function buildGround(def, th){
  const L = def.length, style = th.ground, gs = GROUND[style];
  const vc = (x, z)=> 0.93 + 0.12*vnoise(x*0.13 + 3.1, z*0.21 + 1.7);
  // belt
  {
    const x0 = -14, x1 = L + 14, nx = Math.ceil((x1 - x0)/2), nz = 6;
    const pos = [], nor = [], uv = [], col = [], idx = [];
    for(let j=0;j<=nz;j++) for(let i=0;i<=nx;i++){
      const x = x0 + (x1 - x0)*i/nx, z = BELT_Z0 + (BELT_Z1 - BELT_Z0)*j/nz, v = vc(x, z);
      pos.push(x, 0, z); nor.push(0, 1, 0); uv.push(x/TILE, (BELT_Z1 - z)/(BELT_Z1 - BELT_Z0)); col.push(v, v, v);
    }
    for(let j=0;j<nz;j++) for(let i=0;i<nx;i++){ const a = j*(nx+1) + i, b = a + 1, c2 = a + nx + 1, d = c2 + 1; idx.push(a, c2, b, b, c2, d); }
    const g = own(new THREE.BufferGeometry());
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx);
    g.computeBoundingSphere();
    const tex = own(paintTex(style, 'belt', 512, 384, 101 + def.no, false));
    const mat = own(G.look.matInstance(0xffffff, { rough:0.92, rim:0, vertexColors:true }));
    mat.map = tex; mat.userData.uRimMul.value = 0; mat.needsUpdate = true;
    const m = new THREE.Mesh(g, mat); m.receiveShadow = true; m.position.y = 0.002; m.name = 'belt';
    addObj(m);
  }
  // surroundings
  {
    const air = th.scenery==='airship';
    const x0 = -60, x1 = L + 60, z0 = air ? -7.7 : (th.brow != null ? th.brow - 9 : -34), z1 = air ? BELT_Z1 + 1.7 : 17;
    const zs = [];
    for(let z = z0; z < BELT_Z0 - 0.3; z += (z < -8 ? 2.5 : 1.2)) zs.push(z);
    zs.push(BELT_Z0 - 0.3, BELT_Z1 + 0.3);
    for(let z = BELT_Z1 + 1; z < z1; z += 1.6) zs.push(z);
    zs.push(z1);
    const nx = Math.ceil((x1 - x0)/3), nz = zs.length - 1;
    const pos = [], uv = [], col = [], idx = [];
    for(let j=0;j<=nz;j++) for(let i=0;i<=nx;i++){
      const x = x0 + (x1 - x0)*i/nx, z = zs[j], y = air ? 0 : groundH(th, x, z) - 0.03, v = vc(x, z);
      pos.push(x, y, z); uv.push(x/4, -z/4);
      const fade = y < -0.5 ? U.clamp(1 + y*0.05, 0.75, 1) : 1;
      col.push(v*fade, v*fade, v*fade);
    }
    for(let j=0;j<nz;j++) for(let i=0;i<nx;i++){ const a = j*(nx+1) + i, b = a + 1, c2 = a + nx + 1, d = c2 + 1; idx.push(a, c2, b, b, c2, d); }
    const g = own(new THREE.BufferGeometry());
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx); g.computeVertexNormals(); g.computeBoundingSphere();
    const tex = own(paintTex(style, 'surround', 256, 256, 201 + def.no, true));
    const mat = own(G.look.matInstance(0xffffff, { rough:0.95, rim:0, vertexColors:true }));
    mat.map = tex; mat.userData.uRimMul.value = 0; mat.needsUpdate = true;
    const m = new THREE.Mesh(g, mat); m.receiveShadow = true; m.position.y = air ? -0.004 : 0; m.name = 'surround';
    addObj(m);
  }
}

// ---------------------------------------------------------------- far layer per theme
const FARS = {
  hills(c){
    const { L, R } = c, p = prims(), span = L*0.3 + 90;
    const greens = ['#7cc862', '#92d476', '#6cbc5a', '#a4dc86'];
    for(let x = -45; x < span; x += 9 + R()*8){ const z = -36 - R()*8; c.F(p.sph, pickR(R, greens), [x, -10.5 - R()*1.5, z], null, [11 + R()*7, 8.5 + R()*2, 7]); }
    for(let x = -50; x < span; x += 12 + R()*8){ const z = -60 - R()*10; c.F(p.lo, pickR(R, ['#94cc98', '#a6d6a6', '#9cd2b6']), [x, -11.5, z], null, [16 + R()*10, 10 + R()*2, 10]); }
    // the royal castle on its hill (the heroes' goal)
    const cx = 12, cz = -74, by = -8.4;
    c.F(p.sph, '#8cc884', [cx, -15.5, cz + 3], null, [20, 9, 12]);
    c.F(p.rbox, '#fff4e0', [cx, by + 1.9, cz], null, [9, 3.8, 4]);
    for(let i=0;i<5;i++) c.F(p.rbox2, '#fff4e0', [cx - 4 + i*2, by + 4.1, cz + 1.6], null, [0.9, 0.7, 0.9]);
    for(const [tx, th, r] of [[-5.2, 6, 1.3], [5.2, 6, 1.3], [-1.9, 8, 1.1], [2.1, 7.2, 1.0], [0.1, 9.2, 1.2]]){
      c.F(p.cyl, '#fff8ec', [cx + tx, by + th/2, cz + 0.5], null, [r, th, r]);
      c.F(p.cone, pickR(R, ['#4e86f0', '#ff6a86', '#5a96ff']), [cx + tx, by + th + r*0.9, cz + 0.5], null, [r*1.3, r*1.9, r*1.3]);
      c.FG(p.rbox2, '#ffe6a0', [cx + tx, by + th*0.72, cz + 0.5 + r], null, [0.4, 0.7, 0.1]);
    }
    c.F(p.rbox2, '#8a5a3a', [cx, by + 1.0, cz + 2.05], null, [1.6, 2.0, 0.2]);
    // little far-away houses on the hills
    for(let i=0;i<6;i++){ const x = -30 + i*22 + R()*8, z = -40 - R()*5; c.F(p.rbox, pickR(R, ['#fff1dc', '#ffe0e8', '#e2f0ff']), [x, -3.2, z], null, [1.4, 1.2, 1.2]); c.F(p.cone6, pickR(R, ['#ff7a6b', '#6cb4ff']), [x, -2.2, z], null, [1.1, 0.8, 1.0]); }
  },
  duskTown(c){
    const { L, R } = c, p = prims(), span = L*0.35 + 90;
    for(let x = -50; x < span; x += 3 + R()*3){
      const z = -38 - R()*8, h = 2.2 + R()*2.2, w = 2.5 + R()*2, b = -6.5;
      c.F(p.rbox2, pickR(R, ['#c48a8a', '#cc98a0', '#b87e86']), [x, b + h/2, z], null, [w, h, 2]);
      c.F(p.pyr, pickR(R, ['#6a4a78', '#7a4a66', '#5a4a80']), [x, b + h + 0.45, z], null, [w*0.78, 1.0, 1.5]);
      if(R() < 0.7) c.FG(p.rbox2, '#ffc070', [x + (R()-0.5)*w*0.5, b + h*0.6, z + 1.02], null, [0.5, 0.4, 0.05]);
    }
    for(let x = -50; x < span; x += 12 + R()*8) c.F(p.lo, pickR(R, ['#c8909a', '#d4a0a0']), [x, -11, -62 - R()*10], null, [14 + R()*8, 10, 8]);
    // Japanese castle
    const cx = 16, cz = -70, by = -9.5;
    c.F(p.rbox, '#8a6a7a', [cx, by + 1.2, cz], null, [9, 2.4, 5]);
    for(let i=0;i<4;i++){
      const w = 7 - i*1.5, yy = by + 3 + i*2.1;
      c.F(p.rbox, '#fff0e0', [cx, yy, cz], null, [w, 1.6, w*0.6]);
      c.F(p.pyr, '#4a4a70', [cx, yy + 1.1, cz], null, [w*0.78, 0.9, w*0.5]);
      c.FG(p.rbox2, '#ffd080', [cx - w*0.25, yy, cz + w*0.3 + 0.02], null, [0.5, 0.5, 0.05]);
      c.FG(p.rbox2, '#ffd080', [cx + w*0.25, yy, cz + w*0.3 + 0.02], null, [0.5, 0.5, 0.05]);
    }
    c.F(p.cone6, '#ffd24d', [cx - 1, by + 12.2, cz], [0, 0, 0.5], [0.3, 1, 0.3]); c.F(p.cone6, '#ffd24d', [cx + 1, by + 12.2, cz], [0, 0, -0.5], [0.3, 1, 0.3]);
  },
  forestFar(c){
    const { L, R } = c, p = prims(), span = L*0.35 + 90;
    for(let x = -50; x < span; x += 3.6 + R()*3){ const z = -34 - R()*8, s = 2.4 + R()*1.8; c.F(p.mid, pickR(R, ['#2a5a78', '#335f86', '#2c5070']), [x, -8.5 + s*0.8, z], null, [s*1.2, s*1.4, s]); }
    for(let x = -50; x < span; x += 5 + R()*3.5){ const z = -52 - R()*10, s = 3.4 + R()*2.5; c.F(p.lo, pickR(R, ['#3a5f92', '#44699c', '#39588a']), [x, -10.5 + s, z], null, [s*1.3, s*1.5, s]); }
    for(let x = -40; x < span; x += 9 + R()*9){ const z = -33 - R()*4; c.FG(p.hemi, pickR(R, ['#5fe0ff', '#ff6ac8', '#b07aff']), [x, -4.2, z], null, [1.3, 1.0, 1.3]); }
  },
  caveFar(c){
    const { L, R } = c, p = prims(), span = L*0.35 + 90;
    for(let x = -50; x < span; x += 4 + R()*4){ const z = -30 - R()*10, h = 6 + R()*7; c.F(p.mid, pickR(R, ['#2c3a78', '#34448a', '#283470']), [x, -7 + h*0.5, z], [0, x, 0], [3 + R()*3, h, 3]); }
    for(let x = -50; x < span; x += 3 + R()*3){ const z = -26 - R()*12, h = 4 + R()*6; c.F(p.cone6, pickR(R, ['#3a4a90', '#2e3c7e']), [x, 9 - h/2 + R()*2, z], [PI, 0, 0], [0.9 + R()*0.8, h, 0.9]); }
    for(let x = -45; x < span; x += 5 + R()*5){ const z = -27 - R()*6, s = 1.5 + R()*2.2, col = pickR(R, ['#7ff0ff', '#ff9ad8', '#b48aff', '#a0ffd8']);
      c.FG(p.oct, col, [x, -3 + s, z], [0, x, 0.1], [s*0.35, s, s*0.35]); c.FG(p.oct, shade(col, 0.1), [x + s*0.4, -3 + s*0.6, z + 0.3], [0, x, -0.5], [s*0.22, s*0.6, s*0.22]);
      c.halo(x, -3 + s, z + 1, col, s*3.2); }
  },
  cloudSea(c){
    const { L, R } = c, p = prims(), span = L*0.35 + 110;
    for(let x = -70; x < span; x += 4 + R()*4){ const z = -14 - R()*60, s = 5 + R()*6; c.F(p.lo, pickR(R, ['#ffffff', '#f4f8ff', '#eef2ff']), [x, -15 - R()*2, z], null, [s*1.4, s*0.55, s]); }
    for(let x = -70; x < span; x += 3.5 + R()*3){ const z = -10 - R()*5, s = 3 + R()*3; c.F(p.lo, pickR(R, ['#ffffff', '#f8f4ff']), [x, -9.5 - R(), z], null, [s*1.4, s*0.6, s]); }
    // floating islands with trees and far airships
    for(let i=0;i<4;i++){
      const x = -30 + i*30 + R()*10, z = -60 - R()*15, y = -3 + R()*3;
      c.F(p.sph, '#c8a078', [x, y - 1.2, z], null, [3.2, 2.4, 2.6]); c.F(p.sph, '#8ed07a', [x, y, z], null, [3.4, 0.9, 2.8]);
      c.F(p.sph, '#6fcf5a', [x - 1, y + 1.4, z], null, 1.0); c.F(p.cyl6, '#9a6a44', [x - 1, y + 0.6, z], null, [0.2, 1.2, 0.2]);
    }
    for(let i=0;i<3;i++){
      const x = -10 + i*35 + R()*10, z = -80 - R()*10, y = 1 + R()*2;
      c.F(p.sph, '#ff9a7a', [x, y + 1.6, z], null, [3, 1.2, 1.2]); c.F(p.rbox, '#8a4a3a', [x, y, z], null, [2.4, 0.6, 0.8]);
    }
  },
  mountains(c){
    const { L, R } = c, p = prims(), span = L*0.35 + 90;
    for(let x = -50; x < span; x += 7 + R()*7){
      const z = -55 - R()*18, h = 12 + R()*9, r = 8 + R()*5, y = -12;
      c.F(p.cone6, pickR(R, ['#a8bede', '#b4c8e6', '#9cb4d8']), [x, y + h/2, z], [0, x, 0], [r, h, r*0.8]);
      c.F(p.cone6, '#ffffff', [x, y + h*0.82, z], [0, x, 0], [r*0.4, h*0.36, r*0.33]);
    }
    for(let x = -50; x < span; x += 5 + R()*5){ const z = -38 - R()*6, s = 2 + R()*2; c.F(p.cone6, '#3a7a74', [x, -3.5 + s, z], null, [s*0.7, s*2, s*0.7]); c.F(p.cone6, '#ffffff', [x, -3.5 + s*1.6, z], null, [s*0.35, s*0.8, s*0.35]); }
    for(let x = -40; x < span; x += 18 + R()*12) c.F(p.rbox, '#cfeaff', [x, -2.5, -34 - R()*5], [0, R(), 0], [5, 3, 3]);
  },
  castleFar(c){
    const { L, R } = c, p = prims(), span = L*0.35 + 90;
    for(let x = -50; x < span; x += 5 + R()*6){
      const z = -32 - R()*20, h = 8 + R()*10, r = 1.3 + R()*1.2, y = -8;
      c.F(p.cyl6, pickR(R, ['#3a2a60', '#44306e', '#32265a']), [x, y + h/2, z], null, [r, h, r]);
      c.F(p.cone6, pickR(R, ['#5a2a8a', '#4a2a7a', '#6a3a9a']), [x, y + h + r*1.2, z], null, [r*1.35, r*2.6, r*1.35]);
      for(let i=0;i<2;i++) if(R() < 0.8) c.FG(p.rbox2, '#ffd27a', [x, y + h*(0.55 + i*0.2), z + r], null, [0.5, 0.8, 0.05]);
    }
    for(let x = -50; x < span; x += 11 + R()*8) c.F(p.sph, pickR(R, ['#3a2a64', '#462e72']), [x, -12, -60 - R()*10], null, [14 + R()*6, 10, 8]);
  },
};

// ---------------------------------------------------------------- clouds (instanced puffs)
function buildClouds(th){
  const cl = th.clouds; if(!cl) return;
  const p = prims(), b = G.look.builder();
  b.add(p.lo, cl.color, [0, 0, 0], null, [1.0, 0.72, 0.7]);
  b.add(p.lo, cl.color, [-0.85, -0.14, 0.05], null, [0.66, 0.52, 0.55]);
  b.add(p.lo, cl.color, [0.9, -0.12, 0.02], null, [0.7, 0.5, 0.55]);
  b.add(p.lo, cl.color, [0.35, 0.34, -0.05], null, [0.58, 0.5, 0.5]);
  b.add(p.lo, cl.shade, [0, -0.36, 0], null, [1.55, 0.26, 0.6]);
  const geo = own(b.build());
  const mat = own(G.look.matInstance(0xffffff, { vertexColors:true, rough:1, rim:0.8 }));
  const R = mulberry(77 + cl.n), n = cl.n;
  const im = new THREE.InstancedMesh(geo, mat, n);
  im.frustumCulled = false; im.castShadow = false; im.receiveShadow = false; im.name = 'clouds';
  const data = [];
  for(let i=0;i<n;i++) data.push({ x: R()*120, y: U.lerp(cl.y[0], cl.y[1], R()), z: U.lerp(cl.z[0], cl.z[1], R()), s: U.lerp(cl.s[0], cl.s[1], R()), spd: cl.spd*(0.6 + R()*0.8) });
  env.clouds = addObj(im); env.cloudData = data;
  own({ dispose(){ im.dispose(); } });
}

// ---------------------------------------------------------------- spinning things (windmill, pinwheel, propeller)
function spinGeo(kind){
  const p = prims(), b = G.look.builder();
  if(kind==='windmill'){
    for(let i=0;i<4;i++){ const a = i*PI/2; b.add(p.rbox2, i%2 ? '#fff8ec' : '#ffd9a0', [Math.cos(a)*1.05, Math.sin(a)*1.05, 0], [0, 0, a], [1.9, 0.45, 0.06]); }
    b.add(p.sph, '#a0643a', [0, 0, 0.05], null, 0.18);
  } else if(kind==='pinwheel'){
    const cols = ['#ff6b5b', '#ffd24d', '#5aa0e0', '#7ac86a'];
    for(let i=0;i<4;i++){ const a = i*PI/2; b.add(p.cone6, cols[i], [Math.cos(a)*0.45, Math.sin(a)*0.45, 0], [0, 0, a + PI/2], [0.28, 0.9, 0.05]); }
    b.add(p.dot, '#ffffff', [0, 0, 0.04], null, 0.09);
  } else {
    for(let i=0;i<3;i++){ const a = i*TAU/3; b.add(p.sph, '#fff1d0', [Math.cos(a)*0.7, Math.sin(a)*0.7, 0], [0, 0, a], [0.72, 0.2, 0.05]); }
    b.add(p.sph, '#ff6b5b', [0, 0, 0.06], null, 0.2);
  }
  return b.build();
}
function buildSpinners(c){
  if(!c.spins.length) return;
  const groups = {};
  for(const s of c.spins) (groups[s.kind] || (groups[s.kind] = [])).push(s);
  for(const kind in groups){
    const list = groups[kind];
    const geo = own(spinGeo(kind));
    const im = new THREE.InstancedMesh(geo, G.look.vmat({ rough:0.7 }), list.length);
    im.frustumCulled = false; im.castShadow = false;
    env.spinners.push({ im, list });
    addObj(im);
    own({ dispose(){ im.dispose(); } });
  }
}

// ---------------------------------------------------------------- merged scenery meshes
// Per chunk and depth band, the static and the wind-swayed parts are ONE mesh (aSway = 1 marks the swaying vertices)
// and all outlined layers share ONE outline hull, so a chunk costs ~6 draw calls instead of 11:
//   near band: solid+sway (casts shadow) · glow · deco · hull      far band (z < SHADOW_Z): solid+sway · hull
let swayMat = null, hullMat = null;
function makeSwayMats(){
  swayMat = own(G.look.matInstance(0xffffff, { vertexColors:true, rough:0.85, rim:0.45 }));
  const base = swayMat.onBeforeCompile;
  swayMat.onBeforeCompile = (sh, r)=>{
    base(sh, r);
    sh.uniforms.uTime = env.swayU.uTime; sh.uniforms.uSway = env.swayU.uSway;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime; uniform float uSway; attribute float aSway;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + swayGLSL('uSway * aSway'));
  };
  swayMat.customProgramCacheKey = ()=> 'inuSoftSway2';
  // the outline hull is pushed out at build time, so this is a plain back-face fill that only adds the wind
  hullMat = own(new THREE.MeshBasicMaterial({ color:new THREE.Color('#3b2417'), side:THREE.BackSide }));
  hullMat.onBeforeCompile = (sh)=>{
    sh.uniforms.uTime = env.swayU.uTime; sh.uniforms.uSway = env.swayU.uSway;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime; uniform float uSway; attribute float aSway;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + swayGLSL('uSway * aSway'));
  };
  hullMat.customProgramCacheKey = ()=> 'inuStageHull1';
}
// concatenate built geometries. list: [geometry, sway 0|1, line width]. Without `hull` the result keeps
// position/normal/colour and gets aSway; with `hull` it is the outline hull: every vertex pushed out along its normal
// by its part's line width (so the thinner glow line shares the geometry), position + aSway only.
function joinGeo(list, hull){
  let nv = 0, ni = 0;
  for(const it of list){ nv += it[0].attributes.position.count; ni += it[0].index.count; }
  const pos = new Float32Array(nv*3), nor = hull ? null : new Float32Array(nv*3), col = hull ? null : new Float32Array(nv*3);
  const sw = new Float32Array(nv), idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
  let vo = 0, io = 0;
  for(const [g, sway, t] of list){
    const P = g.attributes.position.array, N = g.attributes.normal.array, I = g.index.array, n = g.attributes.position.count;
    const S = g.attributes.aSway ? g.attributes.aSway.array : null;
    if(hull){ for(let i=0;i<n*3;i++) pos[vo*3 + i] = P[i] + N[i]*t; }
    else { pos.set(P, vo*3); nor.set(N, vo*3); col.set(g.attributes.color.array, vo*3); }
    if(S) sw.set(S, vo); else if(sway) sw.fill(1, vo, vo + n);
    for(let k=0;k<I.length;k++) idx[io++] = I[k] + vo;
    vo += n;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  if(!hull){ g.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3)); }
  g.setAttribute('aSway', new THREE.BufferAttribute(sw, 1));
  g.setIndex(new THREE.BufferAttribute(idx, 1)); g.computeBoundingSphere();
  return g;
}
const LINE = 0.032, GLOW_LINE = 0.022;
function buildChunks(c){
  const glowMat = own(new THREE.MeshBasicMaterial({ vertexColors:true, toneMapped:false }));
  env.glowMat = glowMat; env.glowPost = null;
  const decoMat = G.look.vmat({ rough:0.9, rim:0.3 });
  makeSwayMats();
  let tris = 0, meshes = 0;
  const count = (g)=>{ tris += (g.index ? g.index.count : g.attributes.position.count)/3; meshes++; };
  const hullMesh = (list, name)=>{
    const o = new THREE.Mesh(own(joinGeo(list, true)), hullMat); o.name = name;
    o.userData.isOutline = true; o.castShadow = false; o.receiveShadow = false; o.visible = G.quality.tier < 2;
    addObj(o);
  };
  for(const ch of c.chunks){
    for(const B of ['', 'B']){
      const parts = [], hull = [];
      if(ch['solid' + B] && !ch['solid' + B].empty) parts.push([ch['solid' + B].build(), 0]);
      if(ch['sway' + B] && !ch['sway' + B].empty) parts.push([ch['sway' + B].build(), 1]);
      if(parts.length){
        const g = own(joinGeo(parts, false)); count(g);
        for(const it of parts) it[0].dispose();
        const m = new THREE.Mesh(g, swayMat); m.name = 'solid' + B; m.castShadow = !B; m.receiveShadow = true;
        addObj(m); hull.push([g, 0, LINE]);
      }
      if(!B && ch.glow && !ch.glow.empty){
        const g = own(ch.glow.build()); count(g);
        const m = new THREE.Mesh(g, glowMat); m.castShadow = false; m.name = 'glow';
        addObj(m); hull.push([g, 0, GLOW_LINE]);
      }
      if(hull.length) hullMesh(hull, 'hull' + B);
    }
    if(ch.deco && !ch.deco.empty){
      const g = own(ch.deco.build()); count(g);
      const m = new THREE.Mesh(g, decoMat); m.castShadow = false; m.receiveShadow = true; m.name = 'deco';
      addObj(m);
    }
  }
  // far layer (parallax group)
  const far = new THREE.Group();
  if(!c.far.empty){ const g = own(c.far.build()); count(g); const m = new THREE.Mesh(g, G.look.vmat({ rough:1, rim:0.6 })); m.frustumCulled = false; m.name = 'far'; far.add(m); }
  if(!c.farGlow.empty){ const g = own(c.farGlow.build()); count(g); const m = new THREE.Mesh(g, glowMat); m.frustumCulled = false; m.name = 'farGlow'; far.add(m); }
  env.far = addObj(far);
  return { tris: Math.round(tris), meshes };
}

// ---------------------------------------------------------------- halos & particles
function buildHalos(c){
  const h = c.halos; if(!h.length) return;
  const n = h.length/5, pos = new Float32Array(n*3), col = new Float32Array(n*3), size = new Float32Array(n), ph = new Float32Array(n);
  const tc = new THREE.Color();
  for(let i=0;i<n;i++){
    pos[i*3] = h[i*5]; pos[i*3+1] = h[i*5+1]; pos[i*3+2] = h[i*5+2];
    tc.set(h[i*5+3]); col[i*3] = tc.r; col[i*3+1] = tc.g; col[i*3+2] = tc.b;
    size[i] = h[i*5+4]; ph[i] = (h[i*5]*1.7 + h[i*5+2]*0.9) % TAU;
  }
  const g = own(new THREE.BufferGeometry());
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aSize', new THREE.BufferAttribute(size, 1)); g.setAttribute('aPh', new THREE.BufferAttribute(ph, 1));
  g.computeBoundingSphere();
  env.haloU = { uTime:{ value:0 }, uPx:{ value:360 }, uStr:{ value: c.th.scenery==='town' || c.th.scenery==='airship' || c.th.scenery==='snow' ? 0.45 : 0.62 } };
  const mat = own(new THREE.ShaderMaterial({ uniforms:env.haloU, vertexShader:HALO_VS, fragmentShader:HALO_FS, vertexColors:true,
    transparent:true, depthWrite:false, blending:THREE.AdditiveBlending, fog:false }));
  const pts = new THREE.Points(g, mat); pts.frustumCulled = false; pts.renderOrder = 5;
  env.halos = addObj(pts);
}
const SHAPES = { glow:0, petal:1, sparkle:2, snow:3 };
function buildParticles(th){
  const pc = th.particles; if(!pc) return;
  const n = pc.n, R = mulberry(991 + n), box = pc.box;   // box: [width, y0, y1, z0, z1]
  const pos = new Float32Array(n*3), rnd = new Float32Array(n*4);
  for(let i=0;i<n;i++){
    pos[i*3] = R()*box[0]; pos[i*3+1] = U.lerp(box[1], box[2], R()); pos[i*3+2] = U.lerp(box[3], box[4], R());
    rnd[i*4] = R(); rnd[i*4+1] = R(); rnd[i*4+2] = R(); rnd[i*4+3] = R();
  }
  const g = own(new THREE.BufferGeometry());
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aRnd', new THREE.BufferAttribute(rnd, 4));
  env.partU = {
    uTime:{ value:0 }, uBoxMin:{ value:new THREE.Vector3(0, box[1], box[3]) }, uBoxSize:{ value:new THREE.Vector3(box[0], box[2]-box[1], box[4]-box[3]) },
    uVel:{ value:new THREE.Vector3(pc.vel[0], pc.vel[1], pc.vel[2]) }, uWob:{ value:pc.wob }, uSize:{ value:pc.size }, uPx:{ value:360 },
    uTwinkle:{ value:pc.twinkle||0 }, uColA:{ value:new THREE.Color(pc.a) }, uColB:{ value:new THREE.Color(pc.b) },
    uShape:{ value:SHAPES[pc.kind]||0 }, uOpacity:{ value:pc.opacity==null ? 1 : pc.opacity },
  };
  const mat = own(new THREE.ShaderMaterial({ uniforms:env.partU, vertexShader:PART_VS, fragmentShader:PART_FS, transparent:true, depthWrite:false,
    blending: pc.add ? THREE.AdditiveBlending : THREE.NormalBlending, fog:false }));
  const pts = new THREE.Points(g, mat); pts.frustumCulled = false; pts.renderOrder = 6;
  env.parts = addObj(pts); env.partN = n; env.partBoxW = box[0];
  applyParticleQuality();
}
function applyParticleQuality(){
  if(!env.parts) return;
  const k = G.quality.tier===0 ? 1 : G.quality.tier===1 ? 0.7 : 0.4;
  env.parts.geometry.setDrawRange(0, Math.max(1, Math.floor(env.partN*k)));
}

// ---------------------------------------------------------------- build / dispose
function buildEnv(i){
  const def = G.stages[i], th = def.theme;
  const t0 = performance.now();
  env.root = new THREE.Group(); env.root.name = 'stageEnv';
  env.own = []; env.spinners = []; env.parts = null; env.halos = null; env.clouds = null; env.cloudData = null;
  applyTheme(th);
  buildSky(th);
  buildGround(def, th);
  const c = makeCtx(def, 1234 + def.no*97);
  SCENERY[th.scenery](c);
  arenaDecor(c, def);
  if(FARS[th.far]) FARS[th.far](c);
  const st = buildChunks(c);
  buildClouds(th);
  buildSpinners(c);
  buildHalos(c);
  buildParticles(th);
  env.farPar = th.farPar;
  G.scene.add(env.root);
  env.built = true; env.idx = i;
  env.stats = { buildMs: Math.round(performance.now() - t0), sceneryTris: st.tris, sceneryMeshes: st.meshes, halos: c.halos.length/5, spinners: c.spins.length };
}
function disposeEnv(){
  if(!env.built) return;
  if(env.root && env.root.parent) env.root.parent.remove(env.root);
  for(const x of env.own){ try { x.dispose(); } catch(err){ G.logError('stage.dispose', err); } }
  env.own = []; env.root = null; env.sky = null; env.far = null; env.clouds = null; env.cloudData = null;
  env.parts = null; env.halos = null; env.spinners = []; env.partU = null; env.haloU = null; env.skyU = null; env.glowMat = null;
  swayMat = null; hullMat = null;
  env.built = false; env.idx = -1;
  restoreDefaults();
}

// ================================================================ progression
const st = {
  def:null, seq:[], ptr:0, active:null, locked:false, lockA:0, lockB:0, clearA:0, maxX:0,
  hintI:0, hintHold:0, propI:0, goOn:false, goX:0, goT:0, title:false, bossDone:false, t:0,
};
const B = { xmin:0, xmax:100, zmin:ZMIN, zmax:ZMAX };   // bounds() result (reused, never allocate per tick)
const HINT_DELAY = 160, HINT_HOLD = 120;              // ticks: 90_game's stage banner runs 150
const GLOW_HDR = 1.6;                                 // glow colour multiplier while 05_post's bloom is active

function resetProgress(def){
  st.def = def; st.ptr = 0; st.active = null; st.locked = false; st.lockA = 0; st.lockB = 0; st.clearA = 0; st.maxX = 0;
  st.hintI = 0; st.hintHold = 0; st.propI = 0; st.goOn = false; st.goX = 0; st.bossDone = false; st.t = 0;
  const seq = [];
  def.waves.forEach((w, i)=> seq.push({ kind:'wave', at:w.at, width:w.width || 16, wave:w, idx:i }));
  if(def.mid) seq.push({ kind:'mid', at:def.mid.at, width:def.mid.width || ARENA_W, type:def.mid.type });
  if(def.boss) seq.push({ kind:'boss', at:def.boss.at, width:def.boss.width || ARENA_W, type:def.boss.type });
  seq.sort((a, b)=> a.at - b.at);
  st.seq = seq;
  def.hints.sort((a, b)=> a.at - b.at); def.props.sort((a, b)=> a.x - b.x);
  G.stage.done = false;
}
function uiGo(on){ if(G.ui && typeof G.ui.go==='function'){ try { G.ui.go(on); } catch(err){ G.logError('stage ui.go', err); } } }
function showHint(h){
  const frames = h.frames || 300;
  if(G.ui && typeof G.ui.hint==='function'){ try { G.ui.hint(h.name, h.text, frames); } catch(err){ G.logError('stage ui.hint', err); } }
  G.bus.emit('hint', { name:h.name, text:h.text, frames });
}
function spawnFoe(type, x, z, opts){
  if(!(G.foes && typeof G.foes.spawn==='function')) return null;
  try { return G.foes.spawn(type, x, z, opts) || null; } catch(err){ G.logError('stage spawn '+type, err); return null; }
}
function lockTo(a, b){ st.locked = true; st.lockA = a; st.lockB = b; G.cam.lock(a, b); }
function unlock(){ st.locked = false; G.cam.unlock(); }
function makeQueue(list, t0){
  const q = []; let t = t0;
  for(const [type, n] of list){
    for(let k=0;k<n;k++){ q.push({ type, t, side: G.rng() < 0.62 ? 1 : -1 }); t += 14 + Math.floor(G.rng()*14); }
  }
  // interleave types a little so a wave doesn't arrive as a single file of the same foe
  for(let i=q.length-1;i>0;i--){ const j = Math.floor(G.rng()*(i+1)); const tt = q[i].type; q[i].type = q[j].type; q[j].type = tt; }
  return q;
}
function spawnQueued(item, a){
  const vr = G.cam.viewRange();
  const def = G.foes && G.foes.types ? G.foes.types[item.type] : null;
  const ent = item.entrance || ENTRANCE[item.type] || (def && def.entrance) || 'walk';
  const px = G.player ? G.player.x : (a.lockA + a.lockB)/2;
  let x, z = U.lerp(ZMIN + 0.3, ZMAX - 0.3, G.rng());
  if(ent==='walk'){
    x = item.side > 0 ? Math.max(vr[1], a.lockB) + 1.0 + G.rng()*1.4 : Math.min(vr[0], a.lockA) - 1.0 - G.rng()*1.4;
  } else {
    for(let k=0;k<8;k++){ x = U.lerp(a.lockA + 1.5, a.lockB - 1.5, G.rng()); if(Math.abs(x - px) > 3) break; }
  }
  const e = spawnFoe(item.type, x, z, { entrance:ent, face: x > px ? -1 : 1 });
  if(e) a.spawned++;
  return e;
}
// an arena never wider than what the camera can show (phones in portrait see ~8 units, 16:9 ~14)
function viewArenaW(){ return Math.max(6, (G.cam.usableW ? G.cam.usableW() : 2*G.cam.halfW) - 0.6); }
function startEvent(ev){
  const d = st.def, L = d.length;
  const vw = viewArenaW();
  // areaA/areaB: the lock this fight started with; a later refitLock (view resized) stays inside it
  if(ev.kind==='wave'){
    const w = Math.min(ev.width, vw);
    let a = ev.at - w*0.4; a = Math.max(-2, a); const b = Math.min(L + 4, a + w);
    lockTo(a, b);
    st.active = { kind:'wave', ev, t:0, qt:0, qi:0, q: makeQueue(ev.wave.foes, 16), then: ev.wave.then || null,
      thenAt: ev.wave.thenAt==null ? 1 : ev.wave.thenAt, spawned:0, lockA:a, lockB:b, areaA:a, areaB:b };
    G.bus.emit('wave', { index:ev.idx, total:d.waves.length, at:ev.at, lockA:a, lockB:b });
  } else {
    let [a, b] = arenaRange(d, ev);
    if(b - a > vw){ const px = G.player ? G.player.x : a; a = U.clamp(px - 1, a, b - vw); b = a + vw; }
    lockTo(a, b);
    const bx = b - 4;
    const e = spawnFoe(ev.type, bx, -0.3, { boss:true, face:-1 });
    const tdef = G.foes && G.foes.types ? G.foes.types[ev.type] : null;
    const nm = BOSS_NAMES[ev.type] || [ev.type, ''];
    st.active = { kind:ev.kind, ev, t:0, ent:e, down:false, goneT:0, doneT:0, lockA:a, lockB:b, areaA:a, areaB:b };
    G.bus.emit('bossIntro', { boss:e, name:(tdef && tdef.name) || nm[0], title:(tdef && tdef.title) || nm[1], mid: ev.kind==='mid', type:ev.type });
  }
}
// the view changed size mid-fight (a phone turned to portrait, a browser bar came in): re-fit the lock to the new
// view width so the hero and every foe stay on screen. It shrinks/grows about its old centre, moves only as far as
// needed to keep the hero (and, in a boss arena, the boss while it fits) inside, and never leaves the lock the
// fight started with (turning back to landscape restores it).
// core's belt clamp then pulls entered foes back inside the new bounds on their next tick.
function refitLock(){
  const a = st.active; if(!st.locked || !a || a.areaB==null) return;
  const w = Math.min(a.areaB - a.areaA, viewArenaW());
  if(Math.abs(w - (st.lockB - st.lockA)) < 0.01) return;
  const p = G.player, e = a.ent, m = 1;
  let lo = st.lockA + (st.lockB - st.lockA - w)*0.5;
  if(e && !e.dead && !e.removed && !e.removeMe) lo = U.clamp(lo, e.x + m - w, e.x - m);
  if(p) lo = U.clamp(lo, p.x + m - w, p.x - m);
  lo = U.clamp(lo, a.areaA, a.areaB - w);
  a.lockA = lo; a.lockB = lo + w;
  lockTo(lo, lo + w);
}
function tickWave(a){
  a.qt++;
  while(a.qi < a.q.length && a.q[a.qi].t <= a.qt){ spawnQueued(a.q[a.qi], a); a.qi++; }
  const alive = G.foesAlive();
  if(a.then && a.qi >= a.q.length && alive <= a.thenAt){ a.q = a.q.concat(makeQueue(a.then, a.qt + 20)); a.then = null; }
  if(!a.then && a.qi >= a.q.length && alive===0 && a.t > 20){
    unlock(); st.active = null; st.clearA = a.lockA;
    G.bus.emit('waveClear', { index:a.ev.idx, total:st.def.waves.length });
    G.bus.emit('go', {});
    uiGo(true); st.goOn = true; st.goX = a.lockB + 1; st.goT = 480;
    const rw = a.ev.wave.reward;
    if(rw && G.pickups && typeof G.pickups.spawn==='function' && G.player){
      try { const n = rw==='coin' ? 5 : 1; for(let i=0;i<n;i++) G.pickups.spawn(rw, G.player.x + 1.2 + i*0.3, U.clamp(G.player.z, ZMIN + 0.3, ZMAX - 0.3)); } catch(err){ G.logError('stage reward', err); }
    }
  }
}
function isBossEnt(e){ return e && e.team===1 && (e.kind==='boss' || e.boss===true || (e.def && e.def.boss)); }
function anyBossAlive(){ const es = G.world.ents; for(let i=0;i<es.length;i++){ const e = es[i]; if(isBossEnt(e) && !e.dead && !e.removed && !e.removeMe) return true; } return false; }
function tickBoss(a){
  const e = a.ent;
  // no foes module / spawn failed: nothing to fight, let the stage finish
  if(!e){ a.doneT++; if(a.doneT > 30) finishBoss(a); return; }
  // fallback when no bossDown arrives: the boss is gone and nothing that is a boss is left for a while
  const gone = e.dead || e.removed || e.removeMe;
  if(gone && !anyBossAlive() && G.foesAlive()===0) a.goneT++; else a.goneT = 0;
  if(a.down) a.doneT++;
  if((a.down && a.doneT >= 20) || a.goneT >= 120) finishBoss(a);
}
function finishBoss(a){
  if(a.kind==='mid'){
    unlock(); st.active = null; st.clearA = a.lockA;
    G.bus.emit('midClear', { boss:a.ent });
    G.bus.emit('go', {}); uiGo(true); st.goOn = true; st.goX = a.lockB + 1; st.goT = 480;
  } else {
    st.active = null; st.bossDone = true; G.stage.done = true;
  }
}
let busBound = false;
function bindBus(){
  if(busBound) return; busBound = true;
  G.bus.on('bossDown', (d)=>{
    const a = st.active; if(!a || (a.kind!=='boss' && a.kind!=='mid')) return;
    const b = d && d.boss;
    if(!b || b===a.ent || isBossEnt(b)) a.down = true;
  });
  G.bus.on('quality', applyParticleQuality);
  G.bus.on('resize', refitLock);
}

// ================================================================ per-frame visuals
const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _s = new THREE.Vector3(), _db = new THREE.Vector2();
function frameEnv(dt){
  if(!env.built) return;
  env.time += dt;
  const t = env.time, cam = G.camera, cx = G.cam.x;
  if(env.sky){ env.sky.position.copy(cam.position); env.skyU.uTime.value = t; }
  // 05_post (bloom) renders to an HDR target and tone-maps in its composite: push glowing things above 1.0 so
  // they bloom there; without post they stay un-tone-mapped at their exact colours
  const post = !!(G.post && G.post.active);
  if(env.glowMat && env.glowPost !== post){
    env.glowPost = post; env.glowMat.color.setScalar(post ? GLOW_HDR : 1);
    if(env.skyU) env.skyU.uHdr.value = post ? 1.8 : 1;
  }
  if(env.far) env.far.position.x = cx*env.farPar;
  env.swayU.uTime.value = t;
  let px = 360;
  if(G.renderer){ G.renderer.getDrawingBufferSize(_db); px = _db.y*0.5; }
  if(env.partU){ env.partU.uTime.value = t; env.partU.uPx.value = px; env.partU.uBoxMin.value.x = cx - env.partBoxW*0.5; }
  if(env.haloU){ env.haloU.uTime.value = t; env.haloU.uPx.value = px; }
  if(env.clouds){
    const d = env.cloudData, W = 150;
    for(let i=0;i<d.length;i++){
      const c = d[i];
      let rel = (c.x + t*c.spd - cx*0.25) % W; if(rel < 0) rel += W;
      _v.set(cx + rel - W*0.5, c.y, c.z); _s.set(c.s, c.s, c.s); _q.identity();
      _m4.compose(_v, _q, _s); env.clouds.setMatrixAt(i, _m4);
    }
    env.clouds.instanceMatrix.needsUpdate = true;
  }
  for(let k=0;k<env.spinners.length;k++){
    const sp = env.spinners[k], list = sp.list;
    for(let i=0;i<list.length;i++){
      const s = list[i];
      _e.set(0, s.rotY, t*s.speed + i); _q.setFromEuler(_e);
      _v.set(s.x, s.y, s.z); _s.set(s.s, s.s, s.s); _m4.compose(_v, _q, _s); sp.im.setMatrixAt(i, _m4);
    }
    sp.im.instanceMatrix.needsUpdate = true;
  }
}

// ================================================================ public API
G.stage = {
  info:null, index:-1, done:false,
  env, st, THEMES,
  init(){ bindBus(); },
  load(i){
    bindBus();
    i = U.clamp(i|0, 0, G.stages.length - 1);
    const def = G.stages[i];
    if(!(env.built && env.idx===i)){ disposeEnv(); buildEnv(i); }
    else applyTheme(def.theme);
    this.info = def; this.index = i; st.title = false;
    resetProgress(def);
    return def;
  },
  unload(){
    if(st.locked) G.cam.unlock();
    disposeEnv();
    this.info = null; this.index = -1; this.done = false;
    st.def = null; st.active = null; st.locked = false; st.goOn = false; st.title = false;
  },
  // pleasant stage-1 backdrop for title / select / ending. The calling scene places the camera;
  // info stays null so core's stage-length camera clamp doesn't pull the title camera around.
  titleScene(){
    this.load(0);
    this.info = null; st.title = true; st.def = null;
    return G.stages[0];
  },
  tick(){
    const d = st.def; if(!d || st.title) return;
    const p = G.player; if(!p) return;
    if(p.x > st.maxX) st.maxX = p.x;
    st.t++;
    // hints wait until the stage-name banner has gone; one message at a time for kids: if the hero already ran
    // past several, only the newest is shown, and each stays at least HINT_HOLD ticks before the next replaces it
    if(st.t > HINT_DELAY && --st.hintHold <= 0){
      let j = -1;
      while(st.hintI < d.hints.length && p.x >= d.hints[st.hintI].at){ j = st.hintI; st.hintI++; }
      if(j >= 0){ showHint(d.hints[j]); st.hintHold = HINT_HOLD; }
    }
    while(st.propI < d.props.length && d.props[st.propI].x < p.x + 22){
      const pr = d.props[st.propI++];
      if(G.props && typeof G.props.spawn==='function'){ try { G.props.spawn(pr.kind, pr.x, pr.z, pr.drop); } catch(err){ G.logError('stage prop', err); } }
    }
    // the GO→ arrow stays until the hero walks out of the old fight area (or the next fight starts / 8 s pass)
    if(st.goOn && (p.x > st.goX || st.active || --st.goT <= 0)){ st.goOn = false; uiGo(false); }
    const a = st.active;
    if(a){
      a.t++;
      if(a.kind==='wave') tickWave(a); else tickBoss(a);
      return;
    }
    const next = st.seq[st.ptr];
    if(next && p.x >= next.at){ st.ptr++; startEvent(next); }
  },
  bounds(){
    const d = st.def;
    B.zmin = ZMIN; B.zmax = ZMAX;
    if(!d){ B.xmin = -1e9; B.xmax = 1e9; return B; }
    if(st.locked){ B.xmin = st.lockA; B.xmax = st.lockB; return B; }
    // can't walk back past the last cleared fight or far behind where you've been; can't run past the next fight
    B.xmin = Math.max(0, st.clearA, st.maxX - 16);
    const next = st.seq[st.ptr];
    B.xmax = next ? next.at + 4 : d.length + 6;
    return B;
  },
  frame(dt){ frameEnv(dt || G.cfg.TICK); },
  // debug / tests
  stats(){ return env.stats; },
  progress(){ const a = st.active; return { ptr:st.ptr, total:st.seq.length, active: a ? a.kind : null, activeIdx: a && a.ev ? (a.ev.idx==null ? -1 : a.ev.idx) : -1,
    locked:st.locked, lockA:st.lockA, lockB:st.lockB, done:G.stage.done, maxX:st.maxX }; },
};
})();

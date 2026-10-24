'use strict';
// Bundle the pinned reference simulation in a private scope. It never owns DOM, audio,
// a canvas, a renderer, event listeners, storage, timers, or the animation loop.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
const raw=Buffer.from(fs.readFileSync(path.join(root,'beltaction.html'),'utf8').replace(/\r\n/g,'\n'));
const hash=crypto.createHash('sha1').update(Buffer.from(`blob ${raw.length}\0`)).update(raw).digest('hex');
if(hash!=='f8de624f45b07f9a4961a365f0274066f92b20ff')throw Error('published reference changed');
const body=raw.toString('utf8').match(/<script>([\s\S]*)<\/script>/)[1];
const at=body.indexOf('function updateEnemies(){'),end=body.indexOf('    if(t.boss){ bossTick',at);
if(at<0||end<0)throw Error('reaction boundary not found');
const separationStart=body.indexOf('  // separation',end),separationEnd=body.indexOf('  updateGait();',separationStart);
if(separationStart<0||separationEnd<0)throw Error('reaction separation boundary not found');
const reactions=body.slice(at,end).replace('function updateEnemies(){','function _pubReactions(){')+'    continue;\n  }\n'+body.slice(separationStart,separationEnd)+'}\n';
const pre=`// Published fighter: generated from main b5c01428, blob ${hash}.
// Regenerate with node tools/published-fighter.cjs. Never edit this generated module.
(function(){'use strict'; const G=window.G;
G.publishedFactory=function(_pubHooks={}){
  let _pubSeed=1; const Math=Object.create(globalThis.Math);
  const _pubSeedTo=n=>{_pubSeed=(n>>>0)||1;};
  Math.random=()=>{_pubSeed=(_pubSeed+0x6D2B79F5)|0;let t=Math.imul(_pubSeed^(_pubSeed>>>15),1|_pubSeed);t=(t+Math.imul(t^(t>>>7),61|t))^t;return ((t^(t>>>14))>>>0)/4294967296;};
  const _pubAbsorb=()=>{let p;const f=function(){return p;};p=new Proxy(f,{get(t,k){if(k===Symbol.toPrimitive)return ()=>0;if(k==='width')return 10;return p;},set(){return true;},apply(){return p;},construct(){return p;}});return p;};
  const _pubNull=_pubAbsorb();
  const document={getElementById:()=>_pubNull,createElement:()=>_pubNull,addEventListener(){}};
  const navigator={maxTouchPoints:0};
  const localStorage={getItem:()=>null,setItem(){},removeItem(){}};
  const addEventListener=()=>{},requestAnimationFrame=()=>{},setTimeout=()=>{},setInterval=()=>{},clearInterval=()=>{};
  const performance={now:()=>0}; const location={hash:''};
  const window=new Proxy({innerWidth:1280,innerHeight:720,devicePixelRatio:1,addEventListener,Math},{has(){return false;}});
`;
const observed=['grabGanzan','beginDunk','beginScrew','beginWheel','grabStraight','grabZankai','beginGiantSwing','beginTriangle',
 'grabZapBlast','grabPsy','grabFreeze','grabGale','grabGuardSlam','grabGuardUpper','grabGuardHammer','grabGuardToss','grabSteal',
 'grabSayaKudaki','grabTenNagashi','grabSuemono','grabHaisha','grabMackGun','grabMackRocket','grabMackDrill','grabMackBuson'];
for(const name of observed)if(!body.includes('function '+name+'('))throw Error('display observer target missing: '+name);
const api=fs.readFileSync(path.join(root,'tools/published-fighter-api.inc.js'),'utf8').replace('/*@@DISPLAY_WRAPPERS@@*/',observed.map(n=>`${n}=_pubObserve('${n}',${n});`).join('\n'));
fs.writeFileSync(path.join(root,'inu25d/src/52_published_fighter.js'),(pre+body+'\n'+reactions+'\n'+api+'\n};})();\n').replace(/[ \t]+$/gm,''));
console.log('wrote isolated published fighter, reference '+hash);

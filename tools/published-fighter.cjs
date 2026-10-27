'use strict';
// Bundle the pinned reference simulation in a private scope. It never owns DOM, audio,
// a canvas, a renderer, event listeners, storage, timers, or the animation loop.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
const raw=Buffer.from(fs.readFileSync(path.join(root,'beltaction.html'),'utf8').replace(/\r\n/g,'\n'));
const hash=crypto.createHash('sha1').update(Buffer.from(`blob ${raw.length}\0`)).update(raw).digest('hex');
if(hash!=='f8de624f45b07f9a4961a365f0274066f92b20ff')throw Error('published reference changed');
let body=raw.toString('utf8').match(/<script>([\s\S]*)<\/script>/)[1];
// Adapt only ordinary input locomotion. Attack lunges, recoil, throws and dive
// trajectories retain the pinned reference's distances and timing.
for(const [from,to] of [
 ['p.x+=mx*SPEED*slow*gmul*(p.spdMul||1);', 'p.x+=_pubHooks.walkX?_pubHooks.walkX(p,mx,slow,gmul):mx*SPEED*slow*gmul*(p.spdMul||1); _pubHooks.laneMove?.(p,false);'],
 ['p.x+=mx*SPEED*(p.jDown?0.3:1.0);', 'p.x+=_pubHooks.airX?_pubHooks.airX(p,mx):mx*SPEED*(p.jDown?0.3:1.0); _pubHooks.laneMove?.(p,true);'],
 ['pr.y=clamp(pr.y+pr.vy,GROUND_TOP-4,GROUND_BOT+4);', 'pr.y=_pubHooks.laneClamp?.(pr.y+pr.vy)??clamp(pr.y+pr.vy,GROUND_TOP-4,GROUND_BOT+4);'],
 ['for(let i=projectiles.length-1;i>=0;i--){ const pr=projectiles[i];', 'for(let i=projectiles.length-1;i>=0;i--){ const pr=projectiles[i]; _pubActiveProjectile=pr;']
]){if(body.split(from).length!==2)throw Error('locomotion boundary changed: '+from);body=body.replace(from,to);}
const at=body.indexOf('function updateEnemies(){'),end=body.indexOf('    if(t.boss){ bossTick',at);
if(at<0||end<0)throw Error('reaction boundary not found');
const separationStart=body.indexOf('  // separation',end),separationEnd=body.indexOf('  updateGait();',separationStart);
if(separationStart<0||separationEnd<0)throw Error('reaction separation boundary not found');
const reactions=(body.slice(at,end).replace('function updateEnemies(){','function _pubReactions(){')+'    continue;\n  }\n'+body.slice(separationStart,separationEnd)+'}\n').replace('e.y=clamp(e.y,GROUND_TOP,GROUND_BOT);','e.y=_pubHooks.laneClamp?.(e.y)??clamp(e.y,GROUND_TOP,GROUND_BOT);');
const pre=`// Published fighter: generated from main b5c01428, blob ${hash}.
// Regenerate with node tools/published-fighter.cjs. Never edit this generated module.
(function(){'use strict'; const G=window.G;
G.publishedFactory=function(_pubHooks={}){
  let _pubActiveProjectile=null;
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

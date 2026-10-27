// Read-only choreography for the published fighter. No simulation, input, damage or resource writes.
(function(){'use strict';const G=window.G,T=window.THREE,TAU=Math.PI*2;
const clamp=x=>Math.max(0,Math.min(1,x)),ease=x=>{x=clamp(x);return x*x*(3-2*x);},mix=(a,b,k)=>a+(b-a)*k;
const catalog=G.publishedCatalog,byHero=new Map();
for(const r of catalog.rows){const k=r.hero+':'+r.id;if(!byHero.has(k)||r.group==='upgrade')byHero.set(k,r);}
// Each command slot chooses a body/weapon action, rather than the previous shared "special" pose.
const slotActions={
inu:{up:'risingSword',fwd:'draw',down:'lowCut',dash:'dashDraw',hadou:'waveCut',dp:'dragonSword',du:'summonSwords'},
shima:{up:'cycloneKick',fwd:'shoulder',down:'dropkick',dash:'corkscrewFists',hadou:'barrage',dp:'flameKick',du:'inchPunch'},
nuko:{up:'risingPalms',fwd:'firePalm',down:'groundSigil',dash:'railAim',hadou:'icePalms',dp:'starRise',du:'thunderCall'},
guard8:{up:'hammerLift',fwd:'hammerSmash',down:'headbutt',dash:'hammerSpin',hadou:'hammerTackle',dp:'heavySmash',du:'meteorSmash'},
watch:{up:'smokeCover',fwd:'wirePull',down:'shadowPin',dash:'heist',hadou:'knifeFan',dp:'frontFlip',du:'stolenCast'},
wanden:{up:'longRise',fwd:'doubleCut',down:'lowSweep',dash:'dashDraw',hadou:'mistDraw',dp:'cleave',du:'absoluteDraw'},
mack:{up:'grenadeLob',fwd:'bazooka',down:'flameSweep',dash:'pileBrace',hadou:'launcher',dp:'sniper',du:'shotgun'}
};
const arms={aLx:.4,aRx:.3,aLz:.4,aRz:.6,wz:1.1};
// Authored anticipation/strike/recovery landmarks. Variants retain their native act/hold windows.
const actions={
risingSword:[{aRz:-.5,wz:2.1,lean:.2},{aRz:2.6,wz:.2,lean:-.12,lLz:.6,lRz:-.3},{aRz:2.4,wz:.4}],
draw:[{aRz:.5,aRy:1.2,wz:4.1,twist:-.5},{aRz:1.4,aRy:-1,wz:.3,twist:.6,lean:.15},{aRz:1.2,aRy:-1.2,wz:.6,twist:.4}],
lowCut:[{aRz:1,aRy:1,wz:3.8,lean:.4},{aRz:.6,aRy:-1,wz:2.1,lean:.45,lLz:.8},{aRz:.8,aRy:-.5,wz:1.8}],
dashDraw:[{aRz:.4,aRy:1.2,wz:4,lean:.35},{aRz:1.2,aRy:-1,wz:.4,lean:.35,lLz:.7,lRz:-.4},{aRz:1.2,wz:.6,lean:.25}],
waveCut:[{aRz:2.6,wz:.9,twist:.4},{aRz:.7,wz:.6,twist:-.5,lean:.25},{aRz:.3,wz:1.1,twist:-.3}],
dragonSword:[{aRz:-.5,wz:2.2,lean:.2},{aRz:2.7,wz:.15,nod:.2,lLz:.8,lRz:-.5},{aRz:2.6,wz:.2,lLz:.5}],
summonSwords:[{aRz:1.4,wz:1.6,aLz:1.3},{aRz:2.6,wz:.5,aLz:2.4,nod:.2},{aRz:2.4,wz:.6,aLz:1.8}],
cycloneKick:[{aRz:1.3,lLz:.6,lRz:.4,lean:.15},{aRz:1.1,aLz:1.3,lRz:1.65,lLz:-.4,lean:-.1},{lRz:1.1,aRz:1.6}],
shoulder:[{aLz:.6,aRz:.4,twist:-.4,lean:.28},{aLz:1.1,aRz:1.4,twist:.6,lean:.55,lLz:.6,lRz:-.3},{aRz:1.2,lean:.3}],
dropkick:[{aLz:1.8,aRz:1.8,lLz:.7,lRz:.8,lean:-.2},{aLz:2,aRz:2,lLz:1.5,lRz:1.5,roll:.55,lean:-.2},{lLz:1.1,lRz:1.2,roll:.3}],
corkscrewFists:[{aLz:.5,aRz:.5,twist:-.4},{aLz:1.55,aRz:1.55,aLx:.8,aRx:.8,lean:.3},{aLz:1,aRz:1,lean:.2}],
barrage:[{aLz:.6,aRz:.8,twist:-.2},{aLz:1.4,aRz:1.6,twist:.4,lean:.2},{aLz:.6,aRz:1.5,lean:.15}],
flameKick:[{lLz:.5,lRz:.5,aRz:1.1,lean:.2},{lRz:1.85,lLz:-.4,aRz:1.5,aLz:1.3,lean:-.15},{lRz:1.5,aRz:1.9}],
inchPunch:[{aRz:1.45,aLz:.8,twist:-.25,lean:-.08},{aRz:1.6,aRy:-.2,aLz:.6,twist:.35,lean:.18},{aRz:1.55,twist:.25}],
risingPalms:[{aLz:.6,aRz:.6,lean:.2},{aLz:2.5,aRz:2.5,aLx:.5,aRx:.5,nod:.2},{aLz:2.1,aRz:2.1}],
firePalm:[{aRz:1,aRy:1,aLz:1.1,twist:-.3},{aRz:1.8,aRy:-.1,aLz:1.1,twist:.35,lean:.18},{aRz:1.6,aRy:.1}],
groundSigil:[{aLz:1.3,aRz:1.3,nod:-.15},{aLz:.5,aRz:.5,lean:.55,nod:-.25,lLz:.4,lRz:.35},{aLz:.9,aRz:.9,lean:.25}],
railAim:[{aLz:1.6,aRz:1.6,twist:-.25,lean:-.1},{aLz:1.6,aRz:1.6,lean:.2,twist:.2},{aLz:1.2,aRz:1.2}],
icePalms:[{aLz:1.1,aRz:1.1,aLy:.8,aRy:.8},{aLz:1.8,aRz:1.8,aLy:-.35,aRy:-.35,lean:.12},{aLz:1.4,aRz:1.4}],
starRise:[{aLz:.3,aRz:.3,nod:-.15},{aLz:2.8,aRz:2.8,nod:.25,lLz:.3,lRz:-.2},{aLz:2.4,aRz:2.4}],
thunderCall:[{aLz:1.1,aRz:1.1,nod:-.18},{aLz:2.7,aRz:2.7,aLx:.8,aRx:.8,nod:.3},{aLz:2.1,aRz:2.1}],
hammerLift:[{aRz:.4,wz:2.7,lean:.25},{aRz:2.7,wz:.2,lean:-.2},{aRz:2.4,wz:.5}],
hammerSmash:[{aRz:2.8,wz:.5,lean:-.2},{aRz:.6,wz:1,lean:.5,nod:-.15,lLz:.5},{aRz:.5,wz:1.2,lean:.3}],
headbutt:[{aLz:1.1,aRz:1.1,nod:.25,lean:-.2},{aLz:1.6,aRz:1.6,nod:-.55,lean:.65,lLz:.4},{nod:-.2,lean:.25}],
hammerSpin:[{aRz:1.2,wz:1.4,twist:-.45},{aRz:1.5,wz:.25,aLz:1.2,lean:.12},{aRz:1.3,wz:.5,twist:.4}],
hammerTackle:[{aRz:1.4,wz:1.8,lean:.2},{aRz:1.6,wz:1.5,lean:.55,lLz:.6,lRz:-.3},{aRz:1.4,lean:.3}],
heavySmash:[{aRz:2.85,wz:.3,lean:-.3,nod:.15},{aRz:.4,wz:1.1,lean:.65,nod:-.2,lLz:.65},{aRz:.3,wz:1.3,lean:.4}],
meteorSmash:[{aRz:2.6,wz:.1,lLz:.4,lean:-.25},{aRz:.2,wz:1.5,lean:.6,nod:-.3,lLz:.75},{aRz:.6,wz:1.2,lean:.35}],
smokeCover:[{aRz:1.2,aLz:1.7,aLx:.8,lean:.1},{aRz:2.3,aLz:2.1,aLx:1,twist:.4},{aRz:.7,aLz:1.5}],
wirePull:[{aRz:.5,aRy:1.2,wz:2.2},{aRz:1.6,aRy:-.3,aLz:1.5,lean:-.15},{aRz:.8,aRy:1.1,aLz:.6,twist:-.4}],
shadowPin:[{aRz:2.1,wz:.7,nod:-.15},{aRz:.2,wz:2,lean:.6,nod:-.25,lLz:.5},{aRz:.5,wz:1.7,lean:.3}],
heist:[{aRz:.3,aLz:.5,lean:.3},{aRz:1.4,aLz:1.7,aLy:-.5,lean:.5,twist:.4},{aLz:.8,aLy:.7,lean:.25}],
knifeFan:[{aRz:1.1,aRy:1.3,wz:2.5},{aRz:1.5,aRy:-.9,wz:.3,twist:.45},{aRz:1.3,aRy:-1.1,wz:.5}],
frontFlip:[{aLz:1.8,aRz:1.8,lLz:.7,lRz:.7},{aLz:1.5,aRz:1.5,lLz:.9,lRz:.9},{aRz:1.8,aLz:1.2,lLz:.4}],
stolenCast:[{aLz:1.5,aRz:1.2,wz:1.8,twist:-.2},{aLz:1.2,aRz:1.9,wz:.1,lean:.15},{aLz:.8,aRz:1.5,wz:.5}],
longRise:[{aRz:.1,wz:2.5,twist:-.25},{aRz:2.6,wz:.25,twist:.4,lean:-.08},{aRz:2.3,wz:.45}],
doubleCut:[{aRz:2.2,aRy:.5,wz:1.1,twist:-.4},{aRz:1.2,aRy:-.8,wz:.4,twist:.5},{aRz:1.4,aRy:.9,wz:.3,twist:-.4}],
lowSweep:[{aRz:1.4,aRy:1.3,wz:2.8,lean:.2},{aRz:.5,aRy:-1,wz:1.9,lean:.5,lLz:.7},{aRz:.7,aRy:-.8,wz:1.5}],
mistDraw:[{aRz:.45,aRy:1.3,wz:4.2,twist:-.5},{aRz:1.4,aRy:-1.2,wz:.15,twist:.6},{aRz:.9,aRy:.9,wz:3.8}],
cleave:[{aRz:2.8,wz:.3,lean:-.15},{aRz:.4,wz:1.3,lean:.4,twist:.2},{aRz:.3,wz:1.5,lean:.25}],
absoluteDraw:[{aRz:.4,aRy:1.3,wz:4.3,twist:-.6,lean:-.1},{aRz:1.8,aRy:-1.2,wz:.1,twist:.7,lean:.2},{aRz:1.5,aRy:-1.3,wz:.2}],
grenadeLob:[{aRz:2.5,aRy:.4,wz:.2,lean:-.12},{aRz:1.4,aRy:-.1,wz:-.2,lean:.2},{aRz:.8,wz:.3}],
bazooka:[{aRz:1.5,wz:-1.5,aLz:1.5,lean:-.18},{aRz:1.7,wz:-1.5,aLz:1.7,lean:-.35},{aRz:1.5,wz:-1.5,lean:.1}],
flameSweep:[{aRz:1.1,wz:-1.1,aLz:1.2,lean:.15},{aRz:1.2,wz:-1.2,aLz:1.2,aRy:-.5,lean:.3},{aRz:1.1,wz:-1.1,aRy:.5}],
pileBrace:[{aRz:.8,wz:-.8,twist:-.4,lean:-.1},{aRz:1.55,wz:-1.55,twist:.45,lean:.4,lLz:.65},{aRz:1.4,wz:-1.4,lean:.2}],
launcher:[{aRz:1.7,wz:-1.2,aLz:1.5,lean:-.08},{aRz:1.9,wz:-1.2,aLz:1.6,lean:-.25},{aRz:1.7,wz:-1.2}],
sniper:[{aRz:1.6,wz:-1.6,aLz:1.55,nod:-.15,lean:.18},{aRz:1.7,wz:-1.7,aLz:1.65,nod:-.13,lean:.05},{aRz:1.6,wz:-1.6,lean:.1}],
shotgun:[{aRz:1.4,wz:-1.4,aLz:1.4,twist:-.2},{aRz:1.7,wz:-1.7,aLz:1.6,lean:-.18,twist:.25},{aRz:1.4,wz:-1.4,twist:.1}]
};
const throwAction={grabGanzan:'cleave',beginDunk:'meteorSmash',beginScrew:'hammerSpin',beginWheel:'frontFlip',grabStraight:'inchPunch',grabZankai:'barrage',beginGiantSwing:'hammerSpin',beginTriangle:'dropkick',grabZapBlast:'thunderCall',grabPsy:'starRise',grabFreeze:'icePalms',grabGale:'wirePull',grabGuardSlam:'meteorSmash',grabGuardUpper:'risingPalms',grabGuardHammer:'heavySmash',grabGuardToss:'wirePull',grabSteal:'heist',grabSayaKudaki:'barrage',grabTenNagashi:'doubleCut',grabSuemono:'cleave',grabHaisha:'absoluteDraw',grabMackGun:'sniper',grabMackRocket:'grenadeLob',grabMackDrill:'pileBrace',grabMackBuson:'shotgun'};
const stateClock={grab:'grabAnim',nrailchg:'railT',nrailfire:'railT',seven:'sevenT',gquake:'gqT',gatling:'gatT',mkraid:'raidT',sgact:'sgT',ichimonji:'imT',mugetsu:'mgT',fworks:'fwT',mkflame:'flT',wthrow:'wtT',mthrow:'mtT',gupper:'gupT',gpound:'gpT',dunk:'dunkT',wheel:'wheelT',screw:'screwT',gswing:'gswingT',tkick:'tkT',iparry:'ipT',dogret:'dgT'};
stateClock.hadou='hadouT';
const a=new T.Vector3(),b=new T.Vector3(),target=new T.Vector3(),box=new T.Box3();
function foot(leg,out){const mesh=leg.children[0];if(!mesh.geometry.boundingBox)mesh.geometry.computeBoundingBox();const q=mesh.geometry.boundingBox;out.set((q.min.x+q.max.x)/2,q.min.y,(q.min.z+q.max.z)/2);return mesh.localToWorld(out);}
function fill(Q,rest,W,S,F,t,start,end,duration){let u,v,k;if(t<start){u=rest;v=W;k=ease(t/Math.max(1,start));}else if(t<=end){u=S;v=F;k=ease((t-start)/Math.max(1,end-start));}else{u=F;v=rest;k=ease((t-end)/Math.max(1,duration-end));}
 for(const key of Object.keys(Q))if(typeof Q[key]==='number')Q[key]=mix(u[key]??rest[key]??0,v[key]??rest[key]??0,k);Q.sq=0;Q.y=Q.fx=0;}
function groundAction(e,m,row){if(throwAction[m.id])return throwAction[m.id];if(row&&['ground','upgrade'].includes(row.group))return slotActions[e.type][row.slot];
 if(m.id==='grabStrike')return {inu:'inchPunch',shima:'barrage',nuko:'firePalm',guard8:'headbutt',watch:'heist',wanden:'inchPunch',mack:'barrage'}[e.type];
 if(row?.group==='charge')return e.type==='shima'?'firePalm':e.type==='nuko'?'railAim':e.type==='mack'?'pileBrace':e.type==='guard8'?'heavySmash':'cleave';
 const d=m.def||{};if(d.charged)return e.type==='mack'?'pileBrace':e.type==='nuko'?'railAim':e.type==='guard8'?'heavySmash':'cleave';
 if(row?.group==='combo')return e.type==='nuko'?'firePalm':e.type==='mack'?'sniper':e.type==='shima'?(Number(row.slot)%2?'barrage':'dropkick'):e.type==='guard8'?(Number(row.slot)%2?'hammerLift':'hammerSmash'):Number(row.slot)%2?'doubleCut':'waveCut';
 if(m.id==='nrailchg'||m.id==='nrailfire')return 'railAim';if(m.id==='mkflame')return 'flameSweep';if(m.id==='ichimonji')return 'absoluteDraw';if(m.id==='mugetsu')return 'mistDraw';if(m.id==='fworks')return 'grenadeLob';return null;}
function airPose(e,m,Q){const d=m.def||{},id=m.id,t=m.t,s=Math.sin(t*.5);
 if(id.includes('rave-')){Q.aRz=1.2+s*.65;Q.wz=1.2-Q.aRz;Q.aRy=Math.cos(t*.4)*.8;Q.lLz=.45;Q.lRz=-.35;Q.twist=s*.35;if(e.type==='shima')Q.lRz=1.2+s*.45;}
 else if(/-up$/.test(id)){Q.aRz=2.6;Q.wz=.15;Q.aLz=1.2;Q.lLz=.7;Q.lRz=-.4;Q.lean=-.12;if(e.type==='mack'){Q.aRz=1.5;Q.wz=-1.5;Q.lean=.6;}}
 else if(/-down$/.test(id)){Q.aRz=.3;Q.wz=2.5;Q.aLz=1.1;Q.lean=.4;Q.lLz=.6;Q.lRz=.6;if(e.type==='mack'){Q.roll=-TAU*ease(t/10);Q.aRz=.2;Q.wz=-1.7;}}
 else if(/-forward$/.test(id)){Q.aRz=2.5-2*ease(t/12);Q.wz=1;Q.aLz=1.2;Q.lean=.55;Q.lRz=1.3;if(e.type==='shima')Q.roll=-TAU*ease(t/18);}
 else {const row=byHero.get(e.type+':'+id),slot=row?.slot;Q.lLz=.65;Q.lRz=-.4;Q.aLz=1.25;
  if(e.type==='inu'){Q.aRz=slot==='dp'?2.7:slot==='hadou'?1.4:1.7;Q.wz=slot==='dp'?-.1:.3;Q.twist=slot==='hadou'?-.4:.3;if(slot==='du')Q.spin=TAU*2*ease(t/m.duration);}
  if(e.type==='shima'){Q.aRz=slot==='hadou'?.3:1.8;Q.lRz=slot==='hadou'?.6:1.75;Q.lean=slot==='hadou'?.65:-.1;if(slot==='du')Q.roll=TAU*ease(t/m.duration);}
  if(e.type==='nuko'){Q.aLz=Q.aRz=slot==='dp'?2.6:slot==='hadou'?.5:1.7;Q.aLx=Q.aRx=.7;Q.nod=slot==='hadou'?-.3:.15;}
  if(e.type==='guard8'){Q.aRz=slot==='dp'?1.6:slot==='hadou'?1.2:2.7;Q.wz=.4;Q.lean=slot==='hadou'?-.3:.1;if(slot==='dp')Q.spin=TAU*3*ease(t/m.duration);}
  if(e.type==='watch'){Q.aRz=slot==='dp'?2.5:.4;Q.aLz=slot==='dp'?2.3:1.5;Q.wz=1.7;Q.lean=slot==='hadou'?.4:-.1;if(slot==='du')Q.spin=-TAU*2*ease(t/m.duration);}
  if(e.type==='wanden'){Q.aRz=slot==='du'?2.6-2.3*ease((t-20)/14):1.3;Q.aRy=slot==='hadou'?-1.1:Math.sin(t*.4);Q.wz=.35;Q.twist=.4*Math.sin(t*.4);}
  if(e.type==='mack'){Q.aRz=1.5;Q.wz=-1.5;Q.aLz=1.5;Q.lean=-.15;Q.aRy=slot==='dp'?-.5:Math.sin(t*.3)*.8;if(slot==='du')Q.spin=TAU*2*ease(t/m.duration);}
 }
 if(d.boltDive||d.dropCut){Q.lean=.55;Q.aRz=.4;Q.wz=2.6;}
}
function ultimate(e,m,Q){const t=m.t,k=ease(t/m.duration),s=Math.sin(t*.7),air=m.air;
 switch(e.type){
 case 'inu':Q.aRz=1.6;Q.wz=.3;Q.aRy=s*1.1;Q.twist=s*.6;Q.aLz=1.1;if(air)Q.spin=TAU*2*k;break;
 case 'shima':Q.aLz=1.4+s*.7;Q.aRz=1.4-s*.7;Q.twist=s*.6;Q.lean=.2;if(air){Q.lRz=1.8;Q.spin=TAU*3*k;}break;
 case 'nuko':Q.aLz=Q.aRz=2.6;Q.aLx=Q.aRx=.5+.3*Math.sin(t*.15);Q.nod=.25;Q.lean=-.1;if(air){Q.lLz=.6;Q.lRz=-.3;}break;
 case 'guard8':Q.aRz=t<24?2.8:.2;Q.wz=t<24?.1:1.5;Q.lean=t<24?-.25:.55;Q.aLz=1.4;Q.lLz=.6;break;
 case 'watch':Q.aRz=1.5;Q.wz=-1.5;Q.aLz=1.5;Q.aRy=Math.sin(t*.34)*.8;Q.lean=.15+.04*Math.sin(t*2);if(air){Q.aRz=.7;Q.wz=-1.5;Q.lLz=.7;}break;
 case 'wanden':Q.aRz=1.2+.7*s;Q.wz=.45;Q.aRy=s*1.2;Q.twist=s*.55;Q.aLz=.8;if(air)Q.roll=-.5;break;
 case 'mack':Q.aRz=air?1.7:2.4;Q.wz=air?-1.7:-1.4;Q.aLz=air?1.7:1;Q.aLx=air?1:.4;Q.nod=air?-.2:.25;if(air)Q.spin=TAU*3*k;break;
 }
}
G.publishedMotion={
 describe(r,ref){const seen=ref.display,elapsed=seen?ref.clock-seen.at:1e6;let id=r.state,t=Number(r[stateClock[r.state]])||0,duration=50,act=[6,30],air=r.z>0;
  if(r.state==='jump'&&r.jAtk>0){id=r.jRave?'rave-'+r.kind+'-'+r.jRave:'air-'+r.kind+'-'+(r.jUp||r.jMkUp?'up':r.jDown||r.jHammer||r.jFire||r.jMkDown?'down':'forward');const row=byHero.get(r.kind+':'+id);duration=row?.duration||r.jMkUp&&38||r.jMkDown&&34||r.jUp&&22||18;t=duration-r.jAtk;if(r.jMkT)t=r.jMkT;act=[3,Math.max(4,duration-3)];}
  else if(!Object.hasOwn(stateClock,r.state)){if(seen&&elapsed<=18&&r.state==='idle'){id=seen.id;t=elapsed;duration=18;act=[2,10];}else return null;}
  if(seen&&['wthrow','mthrow','gupper','gpound','dunk','wheel','screw','gswing','tkick'].includes(r.state)){id=seen.id;t=elapsed;duration={wthrow:36,mthrow:44,gupper:30,gpound:34,dunk:28,wheel:36,screw:50,gswing:[48,64,84,108][r.gsTier||0],tkick:40}[r.state];act=[5,Math.max(8,duration-8)];}
  if(r.state==='grab'){id='grab';duration=180;act=[0,180];}
  if(r.state==='grab'&&r.grabSub==='punch'){id='grabStrike';t=r.grabAnim;duration=9;act=[4,4];}
  if(r.state==='nrailchg'){duration=t+1;act=[duration,duration];}if(r.state==='nrailfire'){duration=r.railDur||32;act=[0,duration];}
  if(r.state==='mkflame'){const max=catalog.defs[r.flId]?.flDur||104,out=r.flT>=max?22:12,end=r.flOut>0?r.flT:max;t=r.flT+(r.flOut>0?out-r.flOut:0);duration=end+out;act=[1,end];}
  if(r.state==='hadou'){duration=t+Math.max(1,r.hadouHold);act=[0,duration];}
  if(r.state==='sgact'){id='chord-'+r.kind;const d=catalog.sg[r.kind],tier=r.sgTier||0;duration=d.dur[tier];act=[d.burst[tier][0],d.burst[tier].at(-1)];}
  if(r.state==='seven'){duration=49;act=[3,48];}if(r.state==='gquake'){duration=70;act=[24,60];}if(r.state==='gatling'){duration=r.gatEndT||120;act=[20,duration-18];}if(r.state==='mkraid'){id='mkRaid';duration=180;act=[30,160];}
  return {id,t,time:t,duration,act,air,serial:seen?.serial||0,tier:r.level>=20?3:r.level>=12?2:r.level>=6?1:0,state:r.state};
 },
 pose(rig,e,Q,rest){const m=e.publishedMotion;if(!e.published||!m)return null;const row=byHero.get(e.type+':'+m.id),d=m.def||catalog.defs[m.id]||{};
  const start=(m.holdMax||0)+(m.act?.[0]||1),end=(m.holdMax||0)+(m.act?.[1]||Math.max(2,m.duration-6)),duration=(m.holdMax||0)+m.duration,t=m.time;
  const family=groundAction(e,m,row),ph=t<start?'wind':t<=end?'active':'follow';
  let W=actions[family]?.[0]||arms,S=actions[family]?.[1]||arms,F=actions[family]?.[2]||arms;
  fill(Q,rest,W,S,F,t,start,end,duration);
  const active=m.t>=m.act[0]&&m.t<=m.act[1],progress=clamp((m.t-m.act[0])/Math.max(1,m.act[1]-m.act[0]));
  if(m.id==='grab'){Q.aRz=1.55;Q.aLz=1.1;Q.aRy=-.1;Q.lean=.1;Q.wz=1;}
  else if(row?.group.includes('ultimate')||['seven','gquake','gatling','mkRaid'].includes(m.id))ultimate(e,m,Q);
  else if(row?.group==='chord'||m.id.startsWith('chord-')){Q.aLz=Q.aRz=e.type==='guard8'?1.3:2.5;Q.aLx=Q.aRx=e.type==='guard8'?.9:.55;Q.lean=e.type==='shima'?.25:e.type==='guard8'?.35:-.1;Q.nod=e.type==='nuko'?.25:0;}
  else if(m.air&&(!throwAction[m.id]))airPose(e,m,Q);
  else if(family){
   if(active){if(['cycloneKick','flameKick','hammerSpin','corkscrewFists'].includes(family))Q.spin=TAU*(d.respin?2:1)*progress;
    if(family==='frontFlip')Q.roll=-TAU*progress;
    if(family==='barrage'){Q.aRz=1.3+.55*Math.sin(m.t*1.2);Q.aLz=1.3-.55*Math.sin(m.t*1.2);Q.twist=.25*Math.sin(m.t*1.2);}
    if(family==='doubleCut'||family==='mistDraw'){Q.aRy=Math.sin(progress*Math.PI*4)*1.05;Q.twist=Q.aRy*.4;}
    if(family==='flameSweep')Q.aRy=Math.sin(m.t*.2)*.5;
    if(family==='thunderCall')Q.aLx=Q.aRx=.6+.12*Math.sin(m.t*.7);
    if(['bazooka','launcher','sniper','shotgun'].includes(family))Q.lean-=.09*Math.exp(-Math.max(0,m.t-m.act[0])*.3);
   }
   // Growth variants have an altered stance and extra rotation when the source adds hits.
   if(row?.group==='upgrade'){Q.twist+=(d.multi ? .1 : .06)*Math.sin(m.t*.5);Q.aLz+=.12;Q.lLz+=.08;}
  }else if(m.id!=='grab')return null;
  if(throwAction[m.id]){const k=clamp(t/duration);if(m.id==='beginScrew')Q.spin=TAU*3*k;if(m.id==='beginWheel')Q.roll=-TAU*2*k;
   if(m.id==='beginGiantSwing'||m.id==='grabGuardSlam')Q.spin=TAU*3*k;
   if(m.id==='grabGuardToss'||m.id==='grabHaisha'||m.id==='grabMackBuson')Q.twist=-Math.PI*ease(k);
   if(m.id==='grabMackGun'){Q.aRz=1.6;Q.wz=-1.6;Q.lean=.12+.07*Math.sin(t*Math.PI/2);}
   if(m.id==='grabSteal'){Q.aLz=1.5;Q.aLy=-.8+.8*ease(k);Q.aRz=.7;Q.lean=.2;}
   if(m.id==='grabTenNagashi')Q.aRz=1.5+Math.sin(t*.63)*1.1;
  }
  Q.sq=Q.y=Q.fx=0;
  if(!rig._pubRest){rig._pubRest={hipY:rig._inuRest?.hipY??rig.n.hips.position.y,legs:rig._inuRest?.legs||[rig.n.legL.position.clone(),rig.n.legR.position.clone()],meshes:[]};rig.root.traverse(o=>{if(o.isMesh&&!o.userData.isOutline)rig._pubRest.meshes.push(o);});}
  const signature=m.id+':'+(m.serial||0);if(!rig.st.pubFeet||rig.st.pubFeet.id!==signature||m.time<rig.st.pubFeet.time){rig.root.updateMatrixWorld(true);rig.st.pubFeet={id:signature,time:m.time,root:rig.root.position.clone(),feet:[foot(rig.n.legL,new T.Vector3()),foot(rig.n.legR,new T.Vector3())]};}rig.st.pubFeet.time=m.time;
  return {id:m.id,family:family||row?.group||m.id,phase:ph,planted:e.y<.02&&Math.abs(e.vx)<.006&&!['beginWheel','beginScrew','beginGiantSwing'].includes(m.id),hipDrop:ph==='wind'?.07:family?.includes('Smash')?.08:.02,aim:e.type==='mack'?.35:1,eyes:ph==='wind'?'sq':'open',glow:(m.tier||0)*.06+(ph==='wind'?.06:0)};
 },
 prepare(rig){const c=rig._pubRest;if(!c)return;rig.n.hips.position.y=c.hipY;rig.n.legL.position.copy(c.legs[0]);rig.n.legR.position.copy(c.legs[1]);},
 settle(rig,e,pose){if(!pose)return;rig.n.sq.scale.set(1,1,1);rig.n.hips.position.y=rig._pubRest.hipY-pose.hipDrop;rig.root.updateMatrixWorld(true);
  if(e.y<.02){box.makeEmpty();for(const mesh of rig._pubRest.meshes)if(mesh.visible)box.expandByObject(mesh);const min=box.min.y-rig.root.position.y;if(min<.012)rig.n.act.position.y+=.012-min;}rig.root.updateMatrixWorld(true);},
 renderFeet(rig,e){const pose=rig.st.pubPose,c=rig._pubRest,state=rig.st.pubFeet;if(!pose||!c||!state||!pose.planted||e.y>=.02)return;
  // Pin contact within the moving actor frame, never to a stale world x/z.
  const dx=rig.root.position.x-state.root.x,dz=rig.root.position.z-state.root.z;for(const f of state.feet){f.x+=dx;f.z+=dz;}state.root.copy(rig.root.position);
  for(const [i,leg]of [rig.n.legL,rig.n.legR].entries()){foot(leg,a);target.copy(state.feet[i]);target.y=.015;leg.parent.worldToLocal(a);leg.parent.worldToLocal(target);leg.position.add(target.sub(a));leg.updateMatrixWorld(true);
   const mesh=leg.children[0];box.copy(mesh.geometry.boundingBox).applyMatrix4(mesh.matrixWorld);if(box.min.y<.012){leg.getWorldPosition(b);target.copy(b);target.y+=.012-box.min.y;leg.parent.worldToLocal(target);leg.position.copy(target);leg.updateMatrixWorld(true);}}
 },
 cameraFocus(e){return e?.published&&e.y>.5&&(e.publishedMotion||e.y>2)?{y:1.05+e.y}:null;},
 coverage(){return catalog.rows.map(r=>({hero:r.hero,id:r.id,group:r.group,action:slotActions[r.hero]?.[r.slot]||throwAction[r.id]||r.group}));}
};
})();

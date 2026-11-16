// Display-only rig animation. Contacts follow the existing attack event clock.
(function(){'use strict';
const G=window.G,U=G.U,PI=Math.PI;
const profiles={
 caterpillar:['coil',1.2],mantis:['shear',1],bee:['sting',1.15],spider:['web',1],beetle:['ram',.93],ant:['jab',.81],moth:['flutter',.86],
 alien:['psychic',1.08],rover:['recoil',.72],saucer:['scan',.80],blob:['coil',1.42],
 jelly:['flutter',1.05],hoplite:['shield',.92],tideCrab:['pinch',.91],shark:['swim',1.09],
 banner:['spear',.83],matchlock:['recoil',.93],helmet:['shield',.82],ninja:['flip',.97],horse:['gallop',1.17],
 scytheKnight:['shear',1.43],queenBee:['sting',1.45],arachne:['web',1.30],stag:['ram',1.34],mothQueen:['flutter',1.28],
 greyKing:['psychic',1.38],mothership:['scan',1.36],bioCore:['coil',1.58],starEmperor:['recoil',1.21],
 zeus:['bolt',1.36],poseidon:['swim',1.35],hades:['wraith',1.22],
 nobunaga:['blade',1.19],hideyoshi:['fan',1.21],ieyasu:['shield',1.26],yoshimoto:['bow',.98],
 kenshin:['flip',1.37],shingen:['fan',.93],masamune:['recoil',1.29],yukimura:['gallop',1.38],
 motonari:['bow',1.29],ujiyasu:['shield',1.4],yoshihiro:['hammer',1.44]
};
const flying=new Set(['bee','queenBee','moth','mothQueen','saucer','mothership','jelly']);
const light=new Set(['coil','flutter','sting','swim','flip','web']);
const C=(x)=>U.clamp(x,0,1);
const ease=(x)=>{x=C(x);return x*x*(3-2*x);};
const envelope=(t,rise,fall)=>t<0?ease(1+t/rise):ease(1-t/fall);
function cue(e,move){
 const t=e.atk?.t||0;
 const events=move?.motion;
 if(!events?.length)return {kind:move?.pose,delta:t-(move?.hits?.[0]?.at??move?.proj?.[0]?.at??7)};
 let best=events[0],distance=1e9;
 for(const event of events){
  const d=Math.abs(t-event.at)*(t<event.at?1.18:1);
  if(d<distance){best=event;distance=d;}
 }
 return {kind:best.kind,delta:t-best.at,side:best.side};
}
function make(shape,body,nodes,scale){
 const [style,strength]=profiles[shape];
 const boosted=(style==='scan'||style==='flutter'||style==='psychic');
 let age=99,hitSide=1,impact=1,flash=0,lastState,deadFrame=-1,shellYaw,shellPitch;
 function hit(direction,power){age=0;hitSide=direction||1;impact=U.clamp(power||1,1,3);}
 function update(e){
  const frame=e.animT||0,side=e.face||1,attack=e.atk?.def||e.pending?.def;
  if(e.dead&&deadFrame<0)deadFrame=e.deadT||0;
  const KO=!!e.dead,down=e.state==='down'||e.state==='getup';
  if(e.state==='hurt'&&lastState!=='hurt'&&age>10)hit(e.hurtDir,1);
  lastState=e.state;
  if(e.flashT>0&&age>28)hit(e.hurtDir,1);
  const pain=KO?0:envelope(age,1,light.has(style)?20:16)*(.78+impact*.10);
  const info=cue(e,attack),delta=info.delta;
  const shift=e._frenzyShift,pace=e.state==='move'||!!e.atk&&['dash','roll','ram'].includes(info.kind);
  const index=e.id||1,beat=frame*(pace?.51:.14)+index*.3;
  const spin=attack?.pose==='spin'&&e.atk?e.atk.t/Math.max(1,attack.len-1)*2*PI:0;
  const wind=e.pending?ease(1-e.pending.t/Math.max(8,attack?.windup||32)):0;
  const strike=e.atk?envelope(delta,7,13):0,drive=e.atk&&delta>=0&&delta<19?envelope(delta,1,20):0;
  const load=wind+Math.max(0,-delta)*strike*.086,action=info.kind;
  let pitch=-.22*load,yaw=.13*load,roll=0,lift=pace?Math.abs(Math.sin(beat))*.072:0,reach=0;
  if(flying.has(shape))lift+=.14+Math.sin(beat)*.084;
  if(e.atk){
   switch(action){
    case 'shot':case 'bolt':case 'zap':case 'recoil':
      pitch=-.26*strike+.20*load;reach=-.16*drive;
      lift+=boosted?.12*strike:0;break;
    case 'blink':case 'flip':
      yaw+=Math.sign(info.side||1)*strike*.54;roll=.75*strike;
      lift+=strike*.22;break;
    case 'call':case 'flutter':case 'web':case 'psychic':
      yaw+=.19*Math.sin(beat*2)*strike;pitch=-strike*.32;
      lift+=strike*.17;reach=strike*.09;break;
    case 'dash':case 'ram':case 'roll':case 'swim':case 'gallop':
      pitch=.40*strike-.26*load;reach=strike*.14;
      if(style==='coil')roll=-ease((e.atk.t-2)/Math.max(10,attack.len-9))*2*PI;
      if(style==='swim'||style==='gallop')lift+=Math.abs(Math.sin(beat*1.42))*.13;
      break;
    default:
      pitch+=(attack.pose==='cast'?-.15:.40)*strike;
      yaw+=(style==='pinch'?-.31:.47)*strike;reach=.12*strike;
      lift+=style==='hammer'?.03*strike:.10*strike;
   }
  }
  const settle=down?(e.state==='getup'?1-ease((e.stateT||0)/24):ease(frame/9+.3)):0;
  const fall=KO?ease(((e.deadT||0)-deadFrame)/11):0;
  const morph=KO?(e.rescuePose||0):0,ready=ease((morph-.61)/.39);
  const buckle=fall*(1-.54*ready);
  const jolt=pain*Math.sin(age*.82);
  body.rotation.set((jolt*.13+buckle*.22)*side,
    (side<0?PI+.48:-.48)+spin+yaw*side-pain*hitSide*.17+buckle*.18,
    (pitch*strength+roll)*side+pain*hitSide*.37-side*(buckle*1.30+settle*1.0));
  body.position.set(side*reach*strength+hitSide*jolt*.11,(lift*(1-fall)*(1-settle))+buckle*.154+
    (shift?Math.sin(shift.age*.045)**2*.29:0)-ready*.085,0);
  const squeeze=(style==='coil'?strike*.25:load*.11)+pain*.15+ready*.38+settle*.13;
  const extent=shift?.08*Math.sin(shift.age*.25):0;
  body.scale.set(scale*(1+squeeze*.74+extent),scale*(1-squeeze+extent),side*scale*(1+squeeze*.46));
  const mood=KO?'ko':pain>.13||down?'hurt':attack?'focus':'idle';
  for(const [i,node] of nodes.entries()){
   const r=node.name,d=r.endsWith('-1')?-1:1,count=beat+i*.91;
   switch(r){
    case 'idle':case 'focus':case 'hurt':case 'ko':
      node.visible=r===mood;break;
    case 'weapon':
      node.rotation.set(.12*strike,
        (style==='fan'||style==='blade'?.98:style==='bow'?.43:.29)*strike-.28*load,
        (style==='hammer'||style==='bolt'?-.89:style==='recoil'?.31:style==='shield'?-.16:.68)*strike-.47*load+pain*.25);
      break;
    case 'wing-1':case 'wing1':
      node.rotation.x=d*(.15*Math.sin(count*3)+.43*strike*Math.sin(count*3.5)+load*.27+buckle*.75);
      node.rotation.z=d*((style==='sting'?.48:.18)*drive);break;
    case 'leg-1':case 'leg1':
      node.rotation.z=(pace?Math.sin(count*1.23)*.30:0)+strike*(style==='web'?-.33:.28)*(i%2?1:-1)+buckle*.75;
      node.rotation.x=d*(.17*load-.23*strike+buckle*.46);break;
    case 'claw-1':case 'claw1':
      node.rotation.y=d*(.56*load-1.04*strike)*(style==='pinch'?1.24:1);
      node.rotation.z=.63*load-.28*strike+buckle*.60;break;
    case 'antenna-1':case 'antenna1':
      node.rotation.z=load*.31-strike*.36+jolt*.47+buckle*.64;
      node.rotation.x=.12*Math.sin(count)+d*(ready*.59-.21*drive);break;
    case 'tail':case 'feel-1':case 'feel1':
      node.rotation.y=(.13+.29*strike)*Math.sin(count*1.37);
      node.rotation.z=(.12+.17*load)*Math.sin(count)+ready*.76;break;
    default:
      node.rotation.z=-(.10*wind+.20*pain)+.22*strike-buckle*.16;
      node.rotation.y=-.20*pain*hitSide*side+ready*.22;break;
   }
  }
  flash=shift?.40+Math.sin(shift.age*.24)*.18:(e.flashT>0?.25:0)+pain*.11+ready*.34;
  age++;
 }
 return {update,hit,get flash(){return flash;},rescueShell(t,side){
  const k=ease(t/14);
  shellYaw??=body.rotation.y;shellPitch??=body.rotation.z;
  body.rotation.z=shellPitch+side*.21*k;
  body.rotation.y=shellYaw+side*.61*k;
 }};
}
G.roundAnimation={make};
G.bus.on('hit',({target,dir,power,dmg})=>{
 if(dmg>0)target?.rig?.hit?.(dir,power);
});
})();

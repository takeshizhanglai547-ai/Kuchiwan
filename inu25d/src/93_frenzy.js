// High difficulty boss moves and the new encounter actors.
(function(){'use strict';
const G=window.G, F=G.foes, H=F.h;
const quake={id:'frenzyQuake',len:34,recover:22,anim:'slam',
  areas:[{at:9,r:2.6,zr:1.35,y1:.85,dmg:14,power:3}],
  fn(e,t){if(t===9)G.fx.burst('shock',e.x,.04,e.z,{scale:2.1,color:'#ff527a'});}};
const volley={id:'frenzyVolley',len:34,recover:22,anim:'slam',
  proj:[{at:7,kind:'shadow',count:3,spread:.065,dmg:9,oy:.65,vx:.23},
        {at:20,kind:'shadow',count:3,spread:.09,dmg:9,oy:.65,vx:.26}]};

G.frenzy={
  awaken(e,form){
    e._frenzyForm=form;
    e._frenzyNext=G.time.tick+34;
    G.bossPhaseVisual(e);
    G.fx.burst('shock',e.x,.03,e.z,{scale:2,color:'#ff526f'});
    G.fx.burst('flame',e.x,e.y+.45,e.z,{count:16,scale:1.6});
  },
  attack(e){
    if(!G.game?.diff?.frenzy||!e.def.boss||e.dead||e.scared||e.transforming)return false;
    const form=e.form||1;
    if(e._frenzyForm!==form||e.cool>0||G.time.tick<e._frenzyNext)return false;
    const p=H.target(e);
    if(!p||H.dist(e,p)>8)return false;
    H.face(e,p);
    const move=H.dist(e,p)<2.25?quake:volley;
    if(H.attack(e,move,move===quake?34:28)){
      H.say(e,move===quake?'狂乱衝撃波！':'影の二連射！');
      e._frenzyNext=G.time.tick+126;
      return true;
    }
    return false;
  },
  tick(){
    for(const e of G.world.ents){
      if(!e.dead&&e.def?.boss&&G.game?.diff?.frenzy&&!e.transforming&&e.hp>0&&e.hp<e.maxHp*.5&&e._frenzyForm!==(e.form||1))G.story.frenzyPhase(e);
      if(e._frenzySpeech&&G.time.tick>=e._frenzySpeech.at){
        const {form}=e._frenzySpeech;
        delete e._frenzySpeech;
        if(!e.dead&&!e.transforming&&form===(e.form||1))this.awaken(e,form);
      }
      if(!e.dead&&e.crew&&ready(e))assemble(e);
      if(e.victim&&(e.dead||e.scared||(!e.atk&&!e.pending)))G.published?.releaseEnemyHold(e.victim,e);
    }
  }
};

const ready=e=>!e.dead&&!e.scared&&!e.intangible&&e.entered&&
  (e.state==='idle'||e.state==='move')&&!e.atk&&!e.pending&&!e.grabbedBy;
function assemble(e){
  const allies=G.world.ents.filter(a=>a.type===e.crew&&ready(a)&&H.dist(e,a)<1.55);
  if(allies.length<2)return;
  const crew=[e,...allies.slice(0,2)];
  const rider=F.spawn(e.crew==='mikoshiCrew'?'mikoshi':'mountedArcher',e.x,e.z,{entrance:'ready'});
  rider.hp=Math.max(1,Math.ceil(rider.maxHp*crew.reduce((sum,a)=>sum+a.hp/a.maxHp,0)/3));
  for(const a of crew){
    H.release(a);a.dead=true;a.intangible=true;a.removeMe=true;
  }
  H.say(rider,rider.def.name+'、合体！');
  G.fx.burst('dustRing',rider.x,.05,rider.z,{scale:1.7});
}
function rendezvous(e){
  const leader=e.crew?e:G.world.ents.find(a=>a.crew===e.type&&!a.dead);
  if(leader&&leader!==e){H.walkTo(e,leader.x+(e.id%2?.65:-.65),leader.z);return;}
  if(leader&&G.world.ents.filter(a=>a.type===e.crew&&!a.dead).length>=2){H.stop(e);return;}
  const p=H.target(e);
  if(!p)return;
  H.face(e,p);
  if(H.dist(e,p)>1.35){H.walkTo(e,p.x-e.face,p.z);return;}
  if(e.cool<=0&&H.token(e))H.attack(e,ram,25);
}
const ram={id:'formationRam',len:28,recover:28,anim:'run',
  move:[{at:2,until:17,vx:.23},{at:18,vx:0}],
  hits:[{at:4,dur:15,x0:0,x1:1.1,zr:.65,y0:0,y1:1.1,dmg:16,power:3}]};
const arrows={id:'mountedBow',len:30,recover:27,anim:'throw',
  proj:[{at:7,kind:'arrow',hitKind:'slash',vx:.30,oy:.85,dmg:12},{at:16,kind:'arrow',hitKind:'slash',vx:.36,oy:.85,dmg:10}]};
function mounted(e){
  const p=H.target(e);
  if(!p)return;
  H.face(e,p);
  const dx=Math.abs(p.x-e.x),dz=Math.abs(p.z-e.z);
  if(dz>.55||dx>6){H.walkTo(e,p.x-e.face*2,p.z);return;}
  H.stop(e);
  if(e.cool>0||!H.token(e))return;
  const bow=e.type==='mountedArcher'&&dx>2.7;
  if(H.attack(e,bow?arrows:ram,bow?28:34))H.say(e,bow?'弓、構え！':'突撃！');
}

const bite={id:'vampireBite',len:63,recover:34,anim:'windup',fn(e,t){
  const p=e.victim;
  if(!p||p.dead)return;
  const b=G.stage.bounds();
  if(t===0){
    G.fx.burst('smoke',e.x,e.y,e.z,{color:'#944ed4'});
    e.x=G.U.clamp(p.x-p.face*.9,b.xmin+e.radius,b.xmax-e.radius);
    e.z=p.z;e.y=.12;e.vy=0;H.face(e,p);
    G.fx.burst('smoke',e.x,.55,e.z,{color:'#944ed4'});
    G.fx.alert(e);
  }
  if(t===19&&H.dist(e,p)<1.35&&p.y<.4&&G.published?.holdByEnemy(p,e))H.say(e,'吸血！ 連打で脱出！');
  if(t===49&&G.published?.releaseEnemyHold(p,e)){
    const before=p.hp;
    G.combat.damage(p,18,{src:e,dir:e.face,kind:'magic',power:2,unblockable:true});
    const taken=before-p.hp;
    if(taken>0){
      const healed=Math.min(e.maxHp-e.hp,taken);
      e.hp+=healed;
      G.fx.burst('hearts',e.x,e.y+1,e.z,{color:'#e8467c',count:9});
      if(healed>0)G.fx.text('+'+healed,e.x,e.y+1.7,e.z,'heal');
    }
  }
}};
function vampire(e){
  const p=H.target(e);
  if(!p)return;
  const time=G.time.tick*.055+e.id;
  e.y=1.4+Math.sin(time)*.52;e.vy=0;e.gravScale=0;e.onGround=false;
  H.walkTo(e,p.x+Math.cos(time*.57)*3.3,p.z+Math.sin(time*.75)*1.25,.075);
  if(e.cool<=0&&H.dist(e,p)<5&&H.token(e)){
    e.victim=p;
    if(H.attack(e,bite,32))H.say(e,'背後にご用心…');
  }
}
function dogRig(type){
  const rider=F.build(type==='vampire'?'shinobi':'naginata');
  const T=window.THREE, g=G.look.geo, b=G.look.builder(), root=new T.Group();
  const flying=type==='vampire', horse=type==='mountedArcher';
  const lift=flying?0:horse?.8:1.17;
  rider.root.position.y=lift;
  const decor=new T.Group();root.add(decor,rider.root);
  if(flying){
    for(const s of [-1,1]){
      b.add(g.cone(.48,.9,3),'#3a194c',[-.24,.86,s*.62],[s*Math.PI/2,0,0],[.7,1,1.1]);
      b.add(g.cone(.06,.23,6),'#fff6ec',[.36,.97,s*.11],[0,0,Math.PI]);
    }
    b.add(g.box(.15,.89,.81),'#7b234c',[-.33,.63,0],[0,0,-.2]);
  }else{
    b.add(g.box(1.48,.17,.94),horse?'#754c39':'#ac283b',[0,.98,0]);
    for(const s of [-1,1]){
      b.add(g.sphere(.29,10,8),horse?'#95705d':'#e6c795',[s*.49,.53,0],null,[1.15,1,.85]);
      b.add(g.sphere(.24,10,8),'#f4d9ad',[s*.56,.76,.04]);
      b.add(g.sphere(.06,8,6),'#473438',[s*.56+.19,.78,.19]);
      b.add(g.box(.16,.38,.18),'#523833',[s*.53,.21,.19]);
    }
    if(!horse){
      b.add(g.box(1.16,.16,.86),'#efc35b',[0,2.92,0]);
      b.add(g.cone(.76,.46,4),'#98253b',[0,3.19,0],[0,Math.PI/4,0]);
      for(const x of [-.46,.46])for(const z of [-.32,.32])b.add(g.box(.07,1.9,.07),'#e8b449',[x,1.98,z]);
    }else{
      b.add(g.sphere(.31,10,8),'#987155',[.77,.87,0],null,[.74,1.28,.85]);
      b.add(g.torus(.38,.026,6,20,Math.PI),'#d5ad73',[.52,1.75,.37],[0,0,-Math.PI/2]);
    }
  }
  const mat=G.look.vmat({instance:true}), mesh=b.mesh({material:mat});decor.add(mesh);
  return {root,height:flying?1.65:lift+1.65,update(e){
    decor.rotation.y=e.face<0?Math.PI:0;
    decor.rotation.x=flying?Math.sin(G.time.tick*.24)*.14:0;
    rider.update(e);
    mat.userData.uFlash.value=e.flashT>0?.65:0;
  },setAlpha(a){rider.setAlpha(a);mat.transparent=a<1;mat.opacity=a;},dispose(){rider.dispose();mesh.geometry.dispose();mat.dispose();}};
}
for(const [type,name] of [['mikoshiCrew','神輿担ぎわんこ'],['horseCrew','騎馬組わんこ']])
  F.define(type,{name,hp:32,build:()=>F.build('ashigaru'),ai:rendezvous});
for(const [type,crew] of [['formationLeader','mikoshiCrew'],['horseLeader','horseCrew']])
  F.define(type,{name:'組頭わんこ',hp:64,armor:1,build:()=>F.build('naginata'),
    init(e){e.crew=crew;},ai:rendezvous});
for(const [type,name] of [['mikoshi','おみこしわんこ'],['mountedArcher','騎馬武者わんこ']])
  F.define(type,{name,hp:139,radius:.7,height:type==='mikoshi'?2.8:2.4,weight:2,armor:2,
    build:()=>dogRig(type),ai:mounted});
F.define('vampire',{name:'ドラキュラわんこ',hp:76,flightAI:true,build:()=>dogRig('vampire'),ai:vampire,
  init(e){e.onInterrupt=()=>{e.gravScale=1;if(e.victim)G.published?.releaseEnemyHold(e.victim,e);};},
  onKOTick(e){e.gravScale=1;}});
})();

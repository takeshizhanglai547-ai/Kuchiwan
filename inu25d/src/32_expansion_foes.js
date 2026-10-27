// Expansion enemies: committed sniper fire, grab-vulnerable aerial armour,
// three Sengoku troops and three Oni troops. No renderer/DOM ownership.
(function(){'use strict';const G=window.G,THREE=window.THREE,H=G.foes.h,U=G.U;
const COLORS={sniper:'#678466',skyarmor:'#8299b6',ashigaru:'#ad493f',naginata:'#523d83',shinobi:'#283b60',akoni:'#db554e',ao_oni:'#5c9ed5',taiko_oni:'#b76d35'};
const rigCache=new Map();
function shape(type){
 const g=G.look.geo,b=G.look.builder(),color=COLORS[type],oni=type.includes('oni'),heavy=type==='skyarmor';
 b.add(g.sphere(.39,12,8),color,[0,.64,0],null,[1,1.13,.85]);
 b.add(g.sphere(.36,12,8),oni?'#f1bf91':'#efe5d7',[.05,1.14,0]);
 for(const z of [-.22,.22]){b.add(g.sphere(.14,8,6),color,[-.1,1.46,z],null,[.65,1.25,.8]);b.add(g.sphere(.16,8,6),'#ebe2d1',[.11,.16,z],null,[1.2,.65,.85]);b.add(g.sphere(.055,8,6),'#202735',[.34,1.22,z*.85]);}
 b.add(g.sphere(.1,8,6),'#fff5dc',[.37,1.05,0],null,[.7,.7,1.2]);b.add(g.sphere(.055,6,5),'#263140',[.46,1.11,0]);
 if(oni){for(const z of [-.17,.17])b.add(g.cone(.09,.33,8),'#ffd76a',[.06,1.55,z],[0,0,-.2]);b.add(g.box(.62,.12,.53),'#343649',[0,.42,0]);}
 else{b.add(g.box(.7,.17,.62),color,[.01,1.43,0]);b.add(g.box(.12,.33,.14),'#ffe286',[.15,1.6,0]);}
 if(heavy){b.add(g.sphere(.48,12,8),'#485871',[0,.7,0],null,[1,1,.9]);b.add(g.box(.85,.22,.54),'#adc5d4',[0,1.03,0]);for(const z of [-.4,.4]){b.add(g.box(.48,.12,.7),'#567690',[-.1,.86,z]);b.add(g.cone(.16,.5,10),'#65e5ff',[-.33,.62,z],[0,0,Math.PI/2]);}}
 if(type==='sniper'){b.add(g.box(1.25,.11,.13),'#28333b',[.64,.96,.06]);b.add(g.cylinder(.085,.085,.35,10),'#101e2a',[.65,1.09,.06],[0,0,Math.PI/2]);b.add(g.box(.35,.23,.18),'#704e35',[.13,.9,.06]);}
 if(type==='ashigaru'||type==='naginata'){b.add(g.cylinder(.035,.035,1.9,8),'#b99166',[.6,.99,.02],[0,0,-.38]);b.add(g.cone(.14,.5,8),'#e7f3ff',[.98,1.85,.02],[0,0,-.38]);}
 if(type==='shinobi'){for(const z of [-.36,.36])b.add(g.cone(.07,.55,8),'#cbdbe4',[.45,.77,z],[0,0,-Math.PI/2]);b.add(g.box(.05,.1,.55),'#d7af61',[-.36,1.15,0]);}
 if(type==='akoni'){b.add(g.cylinder(.035,.035,.9,8),'#74482c',[.47,.74,.23],[0,0,-.4]);b.add(g.sphere(.22,8,6),'#4e4448',[.65,1.13,.23],null,[1,1.8,1]);}
 if(type==='ao_oni')b.add(g.sphere(.22,8,6),'#b5f4ff',[.43,.93,.3],null,[.8,1.3,.8]);
 if(type==='taiko_oni'){b.add(g.cylinder(.34,.34,.38,12),'#65402d',[.4,.74,0],[Math.PI/2,0,0]);for(const z of [-.2,.2])b.add(g.cylinder(.31,.31,.025,12),'#fff1c7',[.4,.74,z],[Math.PI/2,0,0]);}
 return b.build();
}
function rig(type){
 if(!rigCache.has(type)){const geo=shape(type);geo.userData.shared=true;rigCache.set(type,geo);}
 const root=new THREE.Group(),body=new THREE.Group(),mat=G.look.vmat({instance:true,rough:.65}),mesh=new THREE.Mesh(rigCache.get(type),mat);body.add(mesh);root.add(body);mesh.castShadow=true;G.look.outline(mesh,.022);
 const beamGeo=new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(),new THREE.Vector3()]),beamMat=new THREE.LineBasicMaterial({color:0xff5664,transparent:true,opacity:.8,depthWrite:false}),beam=new THREE.Line(beamGeo,beamMat);beam.frustumCulled=false;root.add(beam);
 const ringGeo=new THREE.RingGeometry(.63,.76,32),ringMat=new THREE.MeshBasicMaterial({color:0xff705f,transparent:true,opacity:.8,side:THREE.DoubleSide,depthWrite:false}),ring=new THREE.Mesh(ringGeo,ringMat);ring.rotation.x=-Math.PI/2;root.add(ring);beam.visible=ring.visible=false;
 return {root,body,beam,ring,height:1.65,radius:.43,update(e){body.rotation.y=e.face<0?Math.PI:0;body.position.y=e.state==='move'?Math.abs(Math.sin(G.time.tick*.18))*.04:0;body.rotation.z=e.state==='down'||e.dead?-1.2*e.face:0;mat.userData.uFlash.value=e.flashT>0?.75:0;
   const aim=e.aimPoint,shown=!e.dead&&(!!e.pending&&e.type==='sniper'||e.skyPhase==='aim');beam.visible=!!aim&&shown&&e.type==='sniper';ring.visible=!!aim&&shown||!e.dead&&e.type==='skyarmor'&&e.skyPhase==='recover';
   if(aim){const a=beamGeo.attributes.position;a.setXYZ(0,e.face*.7,.96,0);a.setXYZ(1,aim.x-e.x,.66-e.y,aim.z-e.z);a.needsUpdate=true;beamGeo.computeBoundingSphere();ring.position.set(aim.x-e.x,.035-e.y,aim.z-e.z);}if(e.skyPhase==='recover'){ring.position.set(0,.03-e.y,0);ringMat.color.set('#6fffd2');}else ringMat.color.set('#ff705f');ringMat.opacity=.6+Math.sin(G.time.tick*.45)*.2;},
   setAlpha(a){mat.transparent=a<1;mat.opacity=a;beamMat.opacity=a*.8;ringMat.opacity=a*.8;},dispose(){mat.dispose();beamGeo.dispose();beamMat.dispose();ringGeo.dispose();ringMat.dispose();}};
}
const fire=(e,kind,speed,damage)=>{const t=e.aimPoint;if(!t)return;const x=e.x+e.face*.7,z=e.z,dx=t.x-x,dz=t.z-z,d=Math.max(.01,Math.hypot(dx,dz));H.shoot(e,{kind,x,y:e.y+.8,z,vx:dx/d*speed,vz:dz/d*speed,vy:0,dmg:damage,r:.17,life:100,power:1,stun:20,kb:.09});G.bus.emit('expansionShot',{ent:e,target:{...t},kind});};
const SNIPER_SHOT={id:'sniper_committed',anim:'shoot',len:27,recover:78,fn(e,t){if(t===1)fire(e,'beam',.34,14);}};
function sniperAI(e){const t=H.target(e);if(!t){H.stop(e);return;}if(e.cool>0){H.stop(e);return;}const dx=Math.abs(t.x-e.x);if(dx<3){H.walkTo(e,e.x+(e.x<t.x?-1:1)*2,e.z,.043);return;}if(dx>10){H.walkTo(e,t.x+(e.x<t.x?-7:7),t.z,.035);return;}H.face(e,t);if(H.token(e)){e.aimPoint={x:t.x,z:t.z};H.say(e,'ねらう…！');H.attack(e,SNIPER_SHOT,54);}else H.wait(e,12);}
function skyAI(e){const t=H.target(e);if(!t){H.stop(e);return;}e.vx=e.vz=e.vy=0;e.skyT=(e.skyT||0)+1;
 if(e.skyPhase==='climb'){e.gravScale=0;e.y=Math.min(3,e.skyT*.12);e.onGround=false;if(e.skyT>=28){e.skyPhase='aim';e.skyT=0;e.aimPoint={x:t.x,z:t.z};H.say(e,'急降下に注意！');G.bus.emit('alert',{ent:e});}}
 else if(e.skyPhase==='aim'){e.y=3;if(e.skyT>=36){e.skyPhase='dive';e.skyT=0;e.diveFrom={x:e.x,z:e.z};}}
 else if(e.skyPhase==='dive'){const a=Math.min(1,e.skyT/18);e.x=U.lerp(e.diveFrom.x,e.aimPoint.x,a);e.z=U.lerp(e.diveFrom.z,e.aimPoint.z,a);e.y=3*(1-a);if(a===1){e.y=0;e.onGround=true;e.gravScale=1;e.skyPhase='recover';e.skyT=0;e.cool=0;G.combat.area({owner:e,team:1,x:e.x,y:0,z:e.z,r:1.05,zr:.68,y0:-.1,y1:1.4,dmg:12,dur:2,power:2,kind:'blunt',fx:'shock'});H.say(e,'着地！ つかむチャンス！');G.bus.emit('controlHint',{text:'スカイアーマー着地！ つかむ→方向＋攻撃が有効'});}}
 else {e.y=0;e.gravScale=1;e.onGround=true;if(e.skyT>=108){e.skyPhase='climb';e.skyT=0;e.aimPoint=null;}}
}
const hit=(o)=>Object.assign({at:8,dur:4,x0:0,x1:1.3,zr:.5,y0:0,y1:1.7,dmg:8,kb:.08,stun:18,kind:'slash',power:1},o);
const MOVES={
 ashigaru:{id:'sengoku_spear',anim:'attack',len:32,recover:46,move:[{at:6,vx:.12}],hits:[hit({at:9,x1:2.1,dmg:10})]},
 naginata:{id:'sengoku_sweep',anim:'attack2',len:42,recover:56,hits:[hit({at:14,dur:6,x0:-.2,x1:1.8,zr:1.1,dmg:12,power:2})]},
 shinobi:{id:'sengoku_fan',anim:'shoot',len:30,recover:50,proj:[{at:8,kind:'star',count:3,spread:.05,vx:.24,vy:0,dmg:6,r:.16,life:80}]},
 akoni:{id:'oni_club',anim:'attack2',len:48,recover:60,areas:[{at:18,ox:.9,r:1.4,zr:.8,y0:-.1,y1:1.7,dmg:16,kb:.15,up:.12,power:2,kind:'blunt',fx:'shock'}]},
 ao_oni:{id:'oni_ice',anim:'shoot',len:35,recover:54,proj:[{at:10,kind:'ice',vx:.2,dmg:9,r:.22,life:100}]},
 taiko_oni:{id:'oni_taiko',anim:'attack',len:48,recover:64,areas:[{at:10,ox:0,r:2,zr:1.15,y0:-.1,y1:1.3,dmg:7,power:1,kind:'blunt',fx:'ring'},{at:28,ox:0,r:2,zr:1.15,y0:-.1,y1:1.3,dmg:7,power:1,kind:'blunt',fx:'ring'}]},
};
function troopAI(e){const t=H.target(e);if(!t){H.stop(e);return;}if(e.cool>0){H.stop(e);return;}const ranged=e.type==='shinobi'||e.type==='ao_oni',range=ranged?5.5:e.type==='ashigaru'?2.1:e.type==='taiko_oni'?1.9:1.55,dx=Math.abs(t.x-e.x),dz=Math.abs(t.z-e.z);H.face(e,t);
 if(dx<range&&dz<(e.type==='naginata'?1.1:.65)){if(H.token(e)){H.attack(e,MOVES[e.type],e.type==='akoni'?34:28);}else H.wait(e,10);}
 else {const z=e.type==='shinobi'?U.clamp(t.z+(e.id%2?-.5:.5),G.cfg.ZMIN,G.cfg.ZMAX):t.z;H.walkTo(e,t.x+(e.x<t.x?-range*.75:range*.75),z);}}
G.foes.define('sniper',{name:'狙いイヌ',hp:42,spd:.035,height:1.65,radius:.4,weight:1,score:260,xp:18,build:()=>rig('sniper'),ai:sniperAI});
G.foes.define('skyarmor',{name:'スカイアーマーわんこ',hp:84,spd:.035,height:1.65,radius:.46,weight:1.35,grabArmor:true,flightAI:true,score:350,xp:24,build:()=>rig('skyarmor'),init(e){e.skyPhase='climb';e.skyT=0;},ai:skyAI,onHurt(e,d){e.gravScale=1;if(d.grab){e.skyPhase='recover';e.skyT=0;}if(!d.grab&&(!e.armorHintAt||G.time.tick-e.armorHintAt>90)){e.armorHintAt=G.time.tick;H.say(e,'装甲には つかみ！');}},onKOTick(e){e.gravScale=1;}});
for(const [id,hp,spd]of [['ashigaru',36,.045],['naginata',48,.035],['shinobi',29,.061],['akoni',66,.03],['ao_oni',40,.038],['taiko_oni',56,.03]])G.foes.define(id,{name:{ashigaru:'足軽わんこ',naginata:'薙刀わんこ',shinobi:'忍びイヌ',akoni:'赤鬼わんこ',ao_oni:'青鬼わんこ',taiko_oni:'太鼓鬼わんこ'}[id],hp,spd,height:1.65,radius:.43,weight:id==='akoni'?1.6:1,score:220,xp:15,build:()=>rig(id),ai:troopAI});
G.expansionFoes={ids:Object.keys(COLORS),moves:MOVES,sniperShot:SNIPER_SHOT,skyAI,rig};
})();

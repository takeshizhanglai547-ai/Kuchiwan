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
function simpleRig(type){
 if(!rigCache.has(type)){const geo=shape(type);geo.userData.shared=true;rigCache.set(type,geo);}
 const root=new THREE.Group(),body=new THREE.Group(),mat=G.look.vmat({instance:true,rough:.65}),mesh=new THREE.Mesh(rigCache.get(type),mat);body.add(mesh);root.add(body);mesh.castShadow=true;G.look.outline(mesh,.022);
 const beamGeo=new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(),new THREE.Vector3()]),beamMat=new THREE.LineBasicMaterial({color:0xff5664,transparent:true,opacity:.8,depthWrite:false}),beam=new THREE.Line(beamGeo,beamMat);beam.frustumCulled=false;root.add(beam);
 const ringGeo=new THREE.RingGeometry(.63,.76,32),ringMat=new THREE.MeshBasicMaterial({color:0xff705f,transparent:true,opacity:.8,side:THREE.DoubleSide,depthWrite:false}),ring=new THREE.Mesh(ringGeo,ringMat);ring.rotation.x=-Math.PI/2;root.add(ring);beam.visible=ring.visible=false;
 return {root,body,beam,ring,height:1.65,radius:.43,update(e){body.rotation.y=e.face<0?Math.PI:0;body.position.y=e.state==='move'?Math.abs(Math.sin(G.time.tick*.18))*.04:0;body.rotation.z=e.state==='down'||e.dead?-1.2*e.face:0;mat.userData.uFlash.value=e.flashT>0?.75:0;
   const aim=e.aimPoint,shown=!e.dead&&(!!e.pending&&e.type==='sniper'||e.skyPhase==='aim');beam.visible=!!aim&&shown&&e.type==='sniper';ring.visible=!!aim&&shown||!e.dead&&e.type==='skyarmor'&&e.skyPhase==='recover';
   if(aim){const a=beamGeo.attributes.position;a.setXYZ(0,e.face*.7,.96,0);a.setXYZ(1,aim.x-e.x,.66-e.y,aim.z-e.z);a.needsUpdate=true;beamGeo.computeBoundingSphere();ring.position.set(aim.x-e.x,.035-e.y,aim.z-e.z);}if(e.skyPhase==='recover'){ring.position.set(0,.03-e.y,0);ringMat.color.set('#6fffd2');}else ringMat.color.set('#ff705f');ringMat.opacity=.6+Math.sin(G.time.tick*.45)*.2;},
   setAlpha(a){mat.transparent=a<1;mat.opacity=a;beamMat.opacity=a*.8;ringMat.opacity=a*.8;},dispose(){mat.dispose();beamGeo.dispose();beamMat.dispose();ringGeo.dispose();ringMat.dispose();}};
}
// Articulated additions follow the same large-head, sculpted muzzle, layered
// vertex-colour and inverted-hull language as31_zako. All detail is cached per
// type and rigidly skinned to one of13 bones: one body, face and outline draw.
const polishedCache=new Map(),PI=Math.PI,HP=PI/2;
const BIND=[['root',-1,0,0,0],['body',0,0,.28,0],['head',1,.02,1.04,0],['armF',1,.03,.86,.29],['armB',1,.03,.86,-.29],['legF',0,0,.30,.16],['legB',0,0,.30,-.16],['rifle',3,.08,.81,.32],['wingF',1,-.14,.78,.29],['wingB',1,-.14,.78,-.29],['tail',1,-.28,.40,0],['earF',2,-.03,1.31,.24],['earB',2,-.03,1.31,-.24]];
function polishedBlueprint(type){if(polishedCache.has(type))return polishedCache.get(type);
 const geo=G.look.geo,parts=[],heavy=type==='skyarmor',fur=heavy?'#e8e5d9':'#c9c1ae',cream='#fff4db',ink='#302f35',cloth=heavy?'#657d98':'#52664d',trim=heavy?'#dbe5e8':'#b5b08e',dark=heavy?'#34485e':'#303a32';
 function part(bone,fn){const b=G.look.builder();fn((g,c,p,r,sc)=>b.add(g,c,p,r,sc));parts.push({bone,geo:b.build()});}
 const sphere=(r=.5)=>geo.sphere(r,r<.06?8:r<.2?10:16,r<.06?6:r<.2?8:10),box=(x,y,z)=>geo.box(x,y,z),caps=(r,l)=>geo.capsule(r,l,3,10),cyl=(r,l)=>geo.cylinder(r,r,l,12);
 part(1,add=>{
  add(sphere(),cloth,[0,.35,0],null,[.67,.78,.58]);add(sphere(),heavy?'#b9cbd4':'#75846a',[.16,.35,0],null,[.43,.56,.50]);
  add(geo.torus(.21,.032,12,24),dark,[.01,.70,0],[HP,0,0]);
  if(heavy){for(const z of [-.20,.20]){add(box(.19,.33,.19),'#b9cbd4',[.26,.38,z],[0,0,-.10]);for(let j=0;j<3;j++)add(box(.035,.026,.16),'#405367',[.365,.31+j*.075,z]);}
   add(sphere(),dark,[-.25,.41,0],null,[.34,.48,.44]);add(cyl(.10,.12),'#79ddf2',[.36,.50,0],[0,0,HP]);
   for(const z of [-.29,.29]){add(sphere(.13),trim,[.015,.54,z],null,[1.2,.8,1]);add(box(.20,.14,.08),dark,[.10,.13,z]);}
  }else{add(box(.035,.53,.025),'#d8c18f',[.312,.36,.05]);for(const z of [-.23,.23]){add(box(.11,.19,.12),'#394b39',[.24,.19,z]);add(box(.12,.04,.14),'#a3a080',[.25,.27,z]);}
   add(caps(.027,.55),'#3e3430',[.25,.43,.09],[.25,0,-.65]);for(let j=0;j<4;j++)add(cyl(.016,.10),'#d7b165',[.31,.27+j*.042,-.18],[0,0,.2]);
   add(sphere(.09),'#4b5649',[-.28,.28,.18],null,[1,1.5,.8]);
  }
 });
 part(2,add=>{
  add(sphere(),fur,[.025,.10,0],null,[.76,.69,.75]);
  for(const z of [-.16,.16])add(sphere(.07),heavy?'#c7d2d6':'#e9d9bd',[.29,.015,z],null,[.8,.9,1]);
  add(sphere(),cream,[.29,-.065,0],null,[.33,.21,.36]);add(sphere(.049),ink,[.448,-.018,0],null,[.78,.70,1.1]);add(sphere(.014),'#ffffff',[.478,.003,.019]);
  for(const z of [-.033,.033])add(geo.torus(.035,.009,6,12,PI),ink,[.431,-.118,z],[0,HP,PI]);
  if(heavy){add(new THREE.SphereGeometry(.40,18,10,0,PI*2,0,PI*.47),'#788fa7',[-.025,.18,0],[0,0,-.08]);
   add(geo.torus(.37,.026,12,24),dark,[-.025,.18,0],[HP,0,0]);add(box(.14,.18,.08),'#dce5e4',[.23,.23,.28],[0,0,-.4]);
   for(const z of [-.28,.28]){add(cyl(.085,.055),dark,[.015,.14,z],[HP,0,0]);add(cyl(.046,.058),'#7de1ed',[.015,.14,z],[HP,0,0]);}
  }else{add(sphere(),cloth,[-.025,.35,0],[0,0,.12],[.70,.26,.70]);add(sphere(),dark,[.24,.29,0],[0,0,-.1],[.49,.055,.53]);
   add(caps(.014,.11),'#e8ce7b',[.27,.37,.015],[0,0,HP]);add(sphere(.026),'#e8ce7b',[.27,.39,.015]);
   add(cyl(.085,.04),dark,[.025,.10,.36],[HP,0,0]);add(caps(.014,.18),dark,[.19,.01,.34],[0,0,.8]);add(sphere(.027),'#e0d8b0',[.27,-.05,.32]);
  }
 });
 for(const bone of [11,12])part(bone,add=>{const z=bone===11?1:-1;add(sphere(),heavy?'#657d98':fur,[0,.06,z*.015],[z*.22,0,.1],[.17,.44,.13]);add(sphere(),heavy?'#b4d5d9':'#cf9690',[.043,.07,z*.015],[z*.22,0,.1],[.052,.28,.075]);});
 for(const bone of [3,4])part(bone,add=>{const side=bone===3?1:-1;add(caps(.075,.13),cloth,[0,-.10,side*.015],[side*.10,0,-.20]);add(sphere(.086),trim,[.015,-.23,side*.025],null,[.85,.9,.9]);
  if(heavy){add(sphere(.12),'#a6bacb',[0,.02,side*.035],null,[1.1,.8,1]);add(box(.13,.14,.13),dark,[.04,-.13,side*.04],[0,0,-.2]);}
  else add(box(.09,.10,.12),'#384735',[.045,-.08,side*.045],[0,0,-.2]);
 });
 for(const bone of [5,6])part(bone,add=>{add(caps(.082,.11),dark,[0,-.10,0]);add(sphere(.085),heavy?'#abc1cf':'#78876a',[.045,-.12,0],null,[1,.8,.95]);
  add(sphere(),heavy?'#596d83':'#423d34',[.07,-.235,0],null,[.25,.12,.22]);add(box(.22,.036,.19),heavy?'#33465c':'#2e302d',[.075,-.286,0]);for(const z of [-.065,.065])add(box(.065,.012,.012),trim,[.14,-.22,z]);
 });
 part(10,add=>{add(caps(.048,.16),fur,[-.07,.035,0],[0,0,-.8]);add(sphere(.055),cream,[-.13,.11,0]);});
 if(heavy){for(const bone of [8,9])part(bone,add=>{const side=bone===8?1:-1;
   add(sphere(.12),dark,[0,0,0]);add(box(.38,.075,.55),'#a6bdcf',[-.12,.025,side*.25],[0,side*.13,0]);
   add(box(.28,.06,.40),'#55718c',[-.10,.075,side*.22],[0,side*.13,0]);for(let j=0;j<3;j++)add(box(.21,.019,.052),'#d2dfe4',[-.055,.112,side*(.12+j*.10)]);
   add(cyl(.12,.26),dark,[-.23,-.12,side*.20],[0,0,HP]);add(cyl(.083,.025),'#182b40',[-.374,-.12,side*.20],[0,0,HP]);add(geo.torus(.084,.015,6,16),'#75deed',[-.39,-.12,side*.20],[0,HP,0]);
  });}
 else part(7,add=>{
  add(box(.29,.14,.12),'#705b42',[-.14,-.015,0],[0,0,-.12]);add(box(.30,.11,.105),'#26383b',[.14,.01,0]);add(box(.085,.15,.075),'#2c3937',[.10,-.11,0],[0,0,-.15]);
  add(cyl(.028,.43),'#35474a',[.48,.025,0],[0,0,HP]);add(cyl(.047,.10),'#222e31',[.73,.025,0],[0,0,HP]);for(const z of [-.026,.026])add(box(.06,.020,.018),'#75888a',[.738,.032,z]);
  add(cyl(.052,.28),'#26373a',[.30,.17,0],[0,0,HP]);add(cyl(.073,.065),'#182b32',[.47,.17,0],[0,0,HP]);add(sphere(.052),'#7eb8be',[.508,.17,0],null,[.18,.86,.86]);
  add(cyl(.032,.06),'#6c8582',[.30,.225,0]);for(const x of [.18,.38])add(box(.035,.095,.045),'#2a3836',[x,.09,0]);add(geo.torus(.048,.009,5,12,PI*1.5),'#57635d',[.11,-.07,0]);
 });
 // Merge all authored rigid pieces into one shared skinned body geometry.
 let count=0,indexCount=0;for(const p of parts){count+=p.geo.attributes.position.count;indexCount+=p.geo.index?p.geo.index.count:p.geo.attributes.position.count;}
 const pos=new Float32Array(count*3),normal=new Float32Array(count*3),color=new Float32Array(count*3),skin=new Uint16Array(count*4),weights=new Float32Array(count*4),indices=new Uint32Array(indexCount);let vo=0,io=0;
 for(const p of parts){const q=p.geo.attributes,a=BIND[p.bone];for(let j=0;j<q.position.count;j++){for(let k=0;k<3;k++){pos[(vo+j)*3+k]=q.position.array[j*3+k]+a[k+2];normal[(vo+j)*3+k]=q.normal.array[j*3+k];color[(vo+j)*3+k]=q.color.array[j*3+k];}skin[(vo+j)*4]=p.bone;weights[(vo+j)*4]=1;}
  if(p.geo.index)for(let j=0;j<p.geo.index.count;j++)indices[io++]=vo+p.geo.index.getX(j);else for(let j=0;j<q.position.count;j++)indices[io++]=vo+j;vo+=q.position.count;p.geo.dispose();}
 const merged=new THREE.BufferGeometry();merged.setAttribute('position',new THREE.BufferAttribute(pos,3));merged.setAttribute('normal',new THREE.BufferAttribute(normal,3));merged.setAttribute('color',new THREE.BufferAttribute(color,3));merged.setAttribute('skinIndex',new THREE.Uint16BufferAttribute(skin,4));merged.setAttribute('skinWeight',new THREE.BufferAttribute(weights,4));merged.setIndex(new THREE.BufferAttribute(indices,1));merged.computeBoundingBox();merged.computeBoundingSphere();merged.userData.shared=true;
 const faces={};for(const expr of ['open','aim','hurt','happy']){const b=G.look.builder();for(const side of [-1,1]){const z=side*.19;
   if(expr==='happy'){b.add(geo.torus(.042,.013,6,12,PI),'#302f35',[.376,.115,z],[0,HP,-HP]);}
   else{b.add(sphere(.057),'#fff5d9',[.355,.112,z],null,[.33,1.22,1]);b.add(sphere(.047),ink,[.377,.108,z],null,[.32,expr==='hurt'?.45:1, .76]);b.add(sphere(.015),'#ffffff',[.394,.13,z+.012]);}
   if(expr==='aim')b.add(caps(.014,.083),ink,[.359,.193,z],[side*.48,0,0]);
   if(expr==='hurt')b.add(caps(.012,.063),ink,[.364,.188,z],[side*-.4,0,0]);
  }faces[expr]=b.build();faces[expr].userData.shared=true;}
 const bp={geo:merged,faces,heavy,vertices:count};polishedCache.set(type,bp);return bp;
}
function rig(type){if(type!=='sniper'&&type!=='skyarmor')return simpleRig(type);
 const bp=polishedBlueprint(type),root=new THREE.Group(),turn=new THREE.Group();root.name='expansion-polished-'+type;root.add(turn);const flip=new THREE.Group();turn.add(flip);
 const mat=G.look.vmat({instance:true,rough:bp.heavy?.43:.68,metal:bp.heavy?.28:.02}),faceMat=G.look.vmat({instance:true,rough:.38}),mesh=new THREE.SkinnedMesh(bp.geo,mat),nodes={},bones=[];
 for(let i=0;i<BIND.length;i++){const [name,parent,x,y,z]=BIND[i],b=new THREE.Bone(),par=parent>=0?BIND[parent]:[0,0,0,0,0];b.name=name;b.position.set(x-par[2],y-par[3],z-par[4]);if(parent>=0)bones[parent].add(b);bones.push(b);nodes[name]=b;}
 mesh.add(bones[0]);flip.add(mesh);mesh.castShadow=true;mesh.frustumCulled=false;mesh.updateMatrixWorld(true);const skeleton=new THREE.Skeleton(bones);mesh.bind(skeleton);
 const outline=new THREE.SkinnedMesh(bp.geo,G.look.outlineMat(.018,'#302f35'));outline.bind(skeleton,mesh.bindMatrix);outline.userData.isOutline=true;outline.frustumCulled=false;mesh.add(outline);
 const face=new THREE.Mesh(bp.faces.open,faceMat);nodes.head.add(face);const muzzle=new THREE.Object3D();muzzle.name='rifle-muzzle';muzzle.position.set(.79,.025,0);nodes.rifle.add(muzzle);
 const beamGeo=new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(),new THREE.Vector3()]),beamMat=new THREE.LineBasicMaterial({color:'#ff5664',transparent:true,opacity:.8,depthWrite:false}),beam=new THREE.Line(beamGeo,beamMat);beam.frustumCulled=false;root.add(beam);
 const ringGeo=new THREE.RingGeometry(.63,.76,32),ringMat=new THREE.MeshBasicMaterial({color:'#ff705f',transparent:true,opacity:.8,side:THREE.DoubleSide,depthWrite:false}),ring=new THREE.Mesh(ringGeo,ringMat);ring.rotation.x=-HP;root.add(ring);beam.visible=ring.visible=false;
 const tip=new THREE.Vector3(),point=new THREE.Vector3();let alpha=1;
 const out={root,body:turn,beam,ring,mesh,face,nodes,skeleton,muzzle,height:1.65,radius:.43,modelVersion:2,modelVertices:bp.vertices,pose:null,
  update(e){const clock=G.time.tick,aim=e.aimPoint,aiming=!e.dead&&type==='sniper'&&!!e.pending,recoil=!e.dead&&type==='sniper'&&!!e.atk,recover=type==='skyarmor'&&e.skyPhase==='recover',flight=type==='skyarmor'&&e.skyPhase!=='recover',walking=e.state==='move'||Math.hypot(e.vx||0,e.vz||0)>.005;
   turn.rotation.set(0,e.face<0?-(PI-.62):-.62,0);flip.scale.z=e.face<0?-1:1;for(const b of bones)b.rotation.set(0,0,0);
   const swing=walking?Math.sin(clock*.19)*.43:0,breath=Math.sin(clock*.075)*.012;
   nodes.body.position.y=.28+(walking?Math.abs(Math.sin(clock*.19))*.025:breath);nodes.head.rotation.y=aiming||recoil?.50:-.18;nodes.head.rotation.z=aiming?-.095:recoil?.06:Math.sin(clock*.055)*.02;
   nodes.legF.rotation.z=swing;nodes.legB.rotation.z=-swing;nodes.armF.rotation.z=-swing*.45;nodes.armB.rotation.z=swing*.45;
   nodes.tail.rotation.z=Math.sin(clock*.11)*.15;nodes.earF.rotation.x=.05*Math.sin(clock*.08);nodes.earB.rotation.x=-.05*Math.sin(clock*.08+.7);
   if(type==='sniper'){nodes.body.rotation.z=aiming?-.09:recoil?.08:0;nodes.armF.rotation.z=aiming?.17:recoil?-.08:.02;nodes.armB.rotation.z=aiming?.85:recoil?.6:.14;nodes.armB.rotation.y=aiming?.45:0;nodes.rifle.rotation.z=aiming?-.17:recoil?.13:-.08;nodes.rifle.position.x=.05-(recoil?.035*Math.sin(Math.min(PI,(e.atk?.t||0)*.25)):0);}
   else{const spread=e.skyPhase==='dive'?.4:e.skyPhase==='aim'?.20:flight?.30:-.20;nodes.wingF.rotation.x=spread;nodes.wingB.rotation.x=-spread;nodes.wingF.rotation.z=nodes.wingB.rotation.z=flight?-.05:.16;
    nodes.body.rotation.z=e.skyPhase==='dive'?-.42:recover?.15:0;nodes.armF.rotation.z=nodes.armB.rotation.z=flight?-.38:.12;nodes.legF.rotation.z=nodes.legB.rotation.z=flight?.43:recover?-.12:0;nodes.head.rotation.z=e.skyPhase==='dive'?.15:recover?-.10:0;}
   if(e.state==='down'||e.dead){turn.rotation.z=-1.2*(e.face||1);nodes.wingF.rotation.x=.1;nodes.wingB.rotation.x=-.1;}
   const hurtPose=!e.dead&&e.flashT>0?Math.min(1,e.flashT/8):0;if(hurtPose){nodes.body.rotation.z+=.16*hurtPose;nodes.head.rotation.z-=.18*hurtPose;nodes.armF.rotation.z+=.13*hurtPose;nodes.armB.rotation.z+=.09*hurtPose;}
   face.geometry=bp.faces[e.dead?'happy':e.flashT>0?'hurt':aiming||flight?'aim':'open'];mat.userData.uFlash.value=faceMat.userData.uFlash.value=e.flashT>0?.75:0;outline.visible=alpha>.99&&G.quality.tier<2;
   root.updateMatrixWorld(true);if(type==='sniper'&&aim&&(aiming||recoil)){point.set(aim.x,.66,aim.z);nodes.rifle.parent.worldToLocal(point);point.sub(nodes.rifle.position);nodes.rifle.rotation.y=Math.atan2(-point.z,point.x);nodes.rifle.rotation.z=Math.atan2(point.y,Math.hypot(point.x,point.z));root.updateMatrixWorld(true);}beam.visible=!!aim&&aiming;ring.visible=!e.dead&&(recover||!!aim&&e.skyPhase==='aim');
   if(aim){muzzle.getWorldPosition(tip);root.worldToLocal(tip);point.set(aim.x,.66,aim.z);root.worldToLocal(point);const a=beamGeo.attributes.position;a.setXYZ(0,tip.x,tip.y,tip.z);a.setXYZ(1,point.x,point.y,point.z);a.needsUpdate=true;beamGeo.computeBoundingSphere();ring.position.set(aim.x-e.x,.035-e.y,aim.z-e.z);}
   if(recover){ring.position.set(0,.03-e.y,0);ringMat.color.set('#6fffd2');}else ringMat.color.set('#ff705f');ringMat.opacity=alpha*(.6+Math.sin(clock*.45)*.2);out.pose={aiming,recoil,recover,flight,walking};
  },
  setAlpha(a){alpha=U.clamp(a,0,1);for(const m of [mat,faceMat]){m.transparent=alpha<.999;m.opacity=alpha;}root.visible=alpha>.01;beamMat.opacity=alpha*.8;ringMat.opacity=alpha*.8;},
  dispose(){mat.dispose();faceMat.dispose();skeleton.dispose();beamGeo.dispose();beamMat.dispose();ringGeo.dispose();ringMat.dispose();}
 };return out;
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
G.foes.define('sniper',{name:'狙い撃ちわんこ',hp:42,spd:.035,height:1.65,radius:.4,weight:1,score:260,xp:18,build:()=>rig('sniper'),ai:sniperAI});
G.foes.define('skyarmor',{name:'スカイアーマーわんこ',hp:84,spd:.035,height:1.65,radius:.46,weight:1.35,grabArmor:true,flightAI:true,score:350,xp:24,build:()=>rig('skyarmor'),init(e){e.skyPhase='climb';e.skyT=0;},ai:skyAI,onHurt(e,d){e.gravScale=1;if(d.grab){e.skyPhase='recover';e.skyT=0;}if(!d.grab&&(!e.armorHintAt||G.time.tick-e.armorHintAt>90)){e.armorHintAt=G.time.tick;H.say(e,'装甲には つかみ！');}},onKOTick(e){e.gravScale=1;}});
for(const [id,hp,spd]of [['ashigaru',36,.045],['naginata',48,.035],['shinobi',29,.061],['akoni',66,.03],['ao_oni',40,.038],['taiko_oni',56,.03]])G.foes.define(id,{name:{ashigaru:'足軽わんこ',naginata:'薙刀わんこ',shinobi:'忍びイヌ',akoni:'赤鬼わんこ',ao_oni:'青鬼わんこ',taiko_oni:'太鼓鬼わんこ'}[id],hp,spd,height:1.65,radius:.43,weight:id==='akoni'?1.6:1,score:220,xp:15,build:()=>rig(id),ai:troopAI});
G.expansionFoes={ids:Object.keys(COLORS),moves:MOVES,sniperShot:SNIPER_SHOT,skyAI,rig};
})();

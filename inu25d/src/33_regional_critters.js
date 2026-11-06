// Small original creatures for the nine regions. Their props read at phone scale.
(function(){'use strict';
const G=window.G,T=window.THREE,F=G.foes,H=F.h;
const roster=[
  ['breadPup','こんがりパンわんこ','#e9ad75','#fff2ce','bread',30,'hop'],
  ['lanternKit','ちょうちんこねこ','#f2a9be','#fff4ed','lantern',34,'shot'],
  ['acornMole','どんぐりモグ','#a78872','#f8e5cf','acorn',41,'guard'],
  ['crystalBun','すいしょううさ','#b69bdf','#fff6ff','crystal',33,'shot'],
  ['cloudChick','くものヒヨ','#f1c967','#fff0ae','cloud',31,'hop'],
  ['snowSeal','ゆきだまあざらし','#b9d9ed','#fcfcff','snow',43,'roll'],
  ['ribbonBat','リボンこうもり','#9c8ac3','#f8dcf3','bat',36,'shot'],
  ['mochiTanuki','おもちタヌ','#bd907d','#fff2db','mochi',46,'roll'],
  ['pepperOni','とうがらしこおに','#ef9293','#fff2d4','horns',47,'guard'],
];
const hit={at:5,dur:10,x0:0,x1:1.03,zr:.55,y0:0,y1:1.23,dmg:9,power:1};
const hop={id:'tinyHop',len:25,recover:25,anim:'jump',move:[{at:1,vx:.105,vy:.14},{at:13,vx:0}],hits:[hit]};
const roll={id:'tinyRoll',len:30,recover:30,anim:'run',move:[{at:3,until:19,vx:.17},{at:20,vx:0}],hits:[{...hit,dur:14,dmg:12,power:2}]};
const swat={id:'tinySwat',len:24,recover:26,anim:'swipe',hits:[{...hit,dur:5,dmg:12}]};
const projectile={
  lantern:{kind:'fire',dmg:7,vx:.19},
  crystal:{kind:'ice',dmg:8,vx:.22},
  bat:{kind:'note',dmg:7,vx:.25,count:2,spread:.075}
};
const geometry=new Map();
function meshFor(style,coat,cream){
  if(geometry.has(style))return geometry.get(style);
  const b=G.look.builder(),g=G.look.geo;
  const orb=(r,c,x,y,z,sc)=>b.add(g.sphere(r,12,8),c,[x,y,z],null,sc);
  const box=(x,y,z,c,pos,rot)=>b.add(g.box(x,y,z),c,pos,rot);
  const cone=(r,l,c,pos,rot)=>b.add(g.cone(r,l,7),c,pos,rot);
  orb(.38,coat,-.07,.46,0,[1,.96,1]);orb(.43,coat,.05,.86,0,[1.05,.99,1]);
  orb(.32,cream,.22,.78,0,[.91,.69,1.13]);orb(.24,cream,.10,.43,0,[.9,.89,1]);
  for(const z of [-.25,.25]){
    orb(.16,cream,.05,.14,z,[1.26,.61,.91]);
    orb(.06,'#493540',.35,.91,z,[.68,1.12,.92]);
    orb(.023,'#fff9ee',.375,.934,z+.017);
    orb(.068,'#f6a6b5',.297,.815,z*1.38,[1,.64,.43]);
    if(style==='crystal')orb(.15,coat,-.06,1.28,z*.76,[.73,2.4,.75]);
    else if(style==='lantern'||style==='bat'||style==='horns')cone(.15,.32,coat,[-.04,1.21,z*.82],[0,0,.12]);
    else if(style!=='snow'&&style!=='cloud')orb(.15,coat,-.12,1.12,z,[.85,1,.85]);
  }
  orb(.046,'#704659',.48,.795,0,[.65,.62,1.1]);orb(.035,'#704659',.472,.725,0,[.55,.38,1.4]);
  if(style==='bread'){box(.2,.55,.67,'#c98656',[-.40,.59,0],[0,0,.18]);box(.215,.43,.55,'#ffe1a8',[-.42,.59,0],[0,0,.18]);}
  if(style==='lantern'){orb(.17,'#ffb961',.40,.52,.28,[1,1.2,.88]);box(.21,.05,.21,'#a76b70',[.40,.73,.28]);}
  if(style==='acorn'){orb(.25,'#ae704c',-.35,.67,0,[.92,1.16,1]);orb(.24,'#6f5b4b',-.35,.79,0,[1,.47,1]);}
  if(style==='crystal'){for(const z of [-.14,.08,.26])cone(.1,.35,'#a1e0e4',[-.28,.86,z],[.25,0,.45]);}
  if(style==='cloud'){orb(.13,'#fca46f',.40,.76,0,[1,.53,1.25]);for(const z of [-.31,0,.31])orb(.18,'#fff9ed',-.24,.36,z);}
  if(style==='snow'){orb(.22,'#e5f5fc',-.35,.40,0,[1.2,.58,1.2]);box(.62,.13,.57,'#92b4e2',[.04,.63,0]);}
  if(style==='bat'){for(const z of [-.52,.52])cone(.31,.48,'#b19ad9',[-.20,.72,z],[Math.sign(z)*1.2,0,.3]);orb(.11,'#f5a5c2',.25,.63,.22);}
  if(style==='mochi'){orb(.25,'#fff8e8',-.30,.80,0,[1,.58,1]);orb(.09,'#efa5bd',-.31,.94,.07);}
  if(style==='horns'){for(const z of [-.18,.18])cone(.069,.25,'#fff4a8',[.12,1.25,z],[0,0,-.13]);box(.57,.15,.60,'#ffc785',[.01,.42,0]);}
  const geo=b.build();geo.userData.shared=true;geometry.set(style,geo);return geo;
}
function build(style,coat,cream){
  const root=new T.Group(),body=new T.Group(),mat=G.look.vmat({instance:true,rough:.76});
  const mesh=new T.Mesh(meshFor(style,coat,cream),mat);root.add(body);body.add(mesh);mesh.castShadow=true;G.look.outline(mesh,.016);
  return {root,height:1.34,radius:.38,update(e){
    const move=e.state==='move',act=e.state==='act';
    body.rotation.y=e.face<0?Math.PI:0;
    body.rotation.z=e.dead||e.state==='down'?-1.2*e.face:act&&e.atk?.def===roll?e.animT*.30:move?Math.sin(e.animT*.25)*.08:0;
    body.position.y=move?Math.abs(Math.sin(e.animT*.23))*.08:0;
    mat.userData.uFlash.value=e.flashT>0?.7:0;
  },setAlpha(a){mat.transparent=a<1;mat.opacity=a;},dispose(){mat.dispose();}};
}
for(const [id,name,coat,cream,style,hp,role] of roster){
  const shot=role==='shot',charge=role==='roll',heavy=role==='guard';
  const move=shot?{id:id+'Shot',len:25,recover:30,anim:'throw',proj:[{at:6,oy:.76,r:.22,life:48,...projectile[style]}]}:charge?roll:heavy?swat:hop;
  const range=shot?4.6:charge?2.5:1.55;
  F.define(id,{name,hp,spd:heavy?.034:.051,height:1.34,radius:.38,armor:heavy?1:0,score:150,xp:12,
    build:()=>build(style,coat,cream),ai(e){
      const p=H.target(e);if(!p){H.stop(e);return;}
      H.face(e,p);
      if(Math.abs(p.x-e.x)>range||Math.abs(p.z-e.z)>.58){
        H.walkTo(e,p.x-e.face*range*.7,p.z);return;
      }
      H.stop(e);if(e.cool>0||!H.token(e))return;
      H.attack(e,move,charge?32:shot?29:24);
    }});
}
})();

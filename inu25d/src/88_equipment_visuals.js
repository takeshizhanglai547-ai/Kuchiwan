// Shop equipment is display-only: native weapon IDs own attacks, resources and
// reach. Keep all original wrist/weapon nodes and trail anchors intact.
(function(){'use strict';const G=window.G,T=window.THREE,PI=Math.PI,HP=PI/2,assets=new Map(),catalogs=new Map(),live=new Map(),MAX=128;
const listed=(id,s)=>s.split(' ').includes(id),family=(w)=>{
 const id=w.id;if(listed(id,'revolver smg laserrifle flamer railgun sniper autoshot grenadel minigun plasma harpoon nailgun acidgun coilgun shotcane crossbow flamethr gatling2'))return 'gun';
 if(listed(id,'orb icerod bell tarot broom grimoire flamerod thunderod crystal voodoo censer gravrod mirrorw bloomrod starbow'))return 'magic';
 if(listed(id,'sansetsu nunchaku2 meteorh rope whipchain whip yoyo grapple kusarigama2 wreckball fishhook net'))return 'chain';
 if(listed(id,'bostaff guandao shaolin lance yari naginata2 nagamaki'))return 'pole';
 if(listed(id,'tekko ironfist emeici kali chui'))return 'fist';
 if(listed(id,'ironfan tessen2 chakram boomerang'))return 'fan';
 if(listed(id,'pillar anchor jackdrill bshield chainsaw ramplate pilebunker breaker magnetarm turbine junkarm'))return 'heavy';
 if(listed(id,'kunai smokebomb caltrop sickle bombsatchel lockpick coinpurse'))return 'gadget';
 return w.owner==='wanden'?'katana':w.owner==='watch'?'cane':'sword';
};
function blueprint(hero,w){const key=hero+':'+w.id;if(assets.has(key))return assets.get(key);const g=G.look.geo,b=G.look.builder(),f=family(w),col=w.col||'#d2e3ef',metal='#e6f2f7',dark='#364759',gold='#e2bc66',wood='#776047',reach=Math.max(.8,Math.min(2.1,w.reach||1)),len=(hero==='wanden'?.86:.63)*Math.min(1.35,reach),id=w.id;
 const box=(x,y,z)=>g.box(x,y,z),cyl=(r,h)=>g.cylinder(r,r,h,10),orb=r=>g.sphere(r,12,8),add=(geo,c,p,r,s)=>b.add(geo,c,p,r,s),rod=(r,h,c,p)=>add(cyl(r,h),c,p),ring=(r,t,c,p,rot,arc=PI*2)=>add(g.torus(r,t,6,20,arc),c,p,rot);
 function blade(l,width,curve=0,serrate=false){const shape=new T.Shape();shape.moveTo(-width/2,.09);shape.lineTo(width/2,.09);for(let j=1;j<=7;j++){const y=.09+(l-.09)*j/7,x=width/2+curve*Math.sin(j/7*PI/2)+(serrate&&j%2?width*.34:0);shape.lineTo(x,y);}shape.lineTo(curve,l+.10);for(let j=7;j>=1;j--)shape.lineTo(-width/2+curve*Math.sin(j/7*PI/2),.09+(l-.09)*j/7);shape.closePath();const geo=new T.ExtrudeGeometry(shape,{depth:.023,bevelEnabled:false,steps:1});add(geo,col,[0,0,-.0115]);geo.dispose();}
 if(f==='sword'||f==='katana'||f==='cane'){
  rod(.025,.15,wood,[0,-.015,0]);add(orb(.037),gold,[0,-.10,0]);
  const thin=listed(id,'rapier estoc iaito')?.038:listed(id,'gsword claymore zweihander zanbatou2')?.15:.085,curve=listed(id,'katana sabre falchion khopesh nodachi muramasa tachi otachi')?.10:0;
  if(id==='canesword'||f==='cane'){rod(.027,len,col,[0,len/2,0]);ring(.075,.018,metal,[-.07,0,0],[0,0,PI],PI);}
  else{blade(len,thin,curve,id==='flamberge'||id==='urumi');add(box(id==='rapier'?.07:.20,.033,.055),gold,[0,.075,0]);if(id==='rapier')ring(.12,.014,metal,[.05,-.015,0],[0,0,-.5],PI*1.5);}
  if(id==='khopesh')ring(.18,.045,col,[.03,len*.77,0],[0,0,-.7],PI*1.3);if(id==='jitte')add(box(.035,.19,.03),metal,[.10,.16,0]);
 }else if(f==='pole'){
  rod(.025,len*1.65,wood,[0,len*.35,0]);for(const y of [-.12,.08,len*.80])rod(.032,.045,gold,[0,y,0]);
  if(id!=='bostaff'){add(g.cone(.08,.28,6),col,[0,len*1.18,0],null,[1,1,.28]);if(id==='guandao'||id==='naginata2')ring(.18,.045,col,[.07,len,0],[0,0,-HP],PI);if(id==='shaolin')for(const z of [-.06,.06])ring(.10,.012,gold,[0,len*1.12,z]);}
 }else if(f==='fan'){
  if(id==='chakram')ring(.22,.035,col,[0,.25,0]);else if(id==='boomerang'){add(box(.31,.055,.045),col,[.12,.22,0],[0,0,.55]);add(box(.31,.055,.045),col,[-.12,.22,0],[0,0,-.55]);}
  else{for(let j=0;j<7;j++)add(g.cone(.055,.44,3),j%2?metal:col,[Math.sin((j-3)*.22)*.17,.24,0],[0,0,-(j-3)*.22],[1,1,.25]);rod(.025,.14,dark,[0,-.01,0]);}
 }else if(f==='magic'){
  if(id==='grimoire'){for(const side of [-1,1]){const x=side*.115,rot=[0,-side*.25,0];add(box(.24,.34,.045),col,[x,.22,-.018],rot);add(box(.215,.30,.04),'#fff4d4',[x,.22,.018],rot);for(let j=0;j<4;j++)add(box(.135,.008,.008),dark,[x,.13+j*.055,.048],rot);}rod(.020,.35,gold,[0,.22,0]);add(g.star(.066,.45,.012),gold,[0,.22,.068]);}
  else if(id==='tarot'){add(box(.30,.37,.07),col,[0,.20,0],[0,0,.12]);add(box(.24,.31,.075),'#fff4d4',[0,.20,0],[0,0,.12]);add(g.star(.08,.45,.012),gold,[0,.20,.043]);}
  else if(id==='orb'||id==='crystal'){add(id==='orb'?orb(.18):new T.OctahedronGeometry(.20),col,[0,.30,0]);ring(.23,.013,gold,[0,.30,0],[.5,0,.4]);}
  else if(id==='starbow'){ring(.30,.025,col,[0,.32,0],[0,0,0],PI);add(box(.012,.58,.012),metal,[0,.32,0]);}
  else if(id==='mirrorw'){rod(.027,.30,gold,[0,.08,0]);ring(.16,.023,col,[0,.39,0]);add(g.circle(.14,20),metal,[0,.39,.006]);}
  else{rod(.027,len,wood,[0,len/2-.05,0]);if(id==='broom')for(let j=-2;j<=2;j++)add(g.cone(.037,.30,6),j%2?col:gold,[j*.033,len-.06,0]);
   else if(id==='bell'||id==='censer'){add(g.cone(.13,.17,12),gold,[0,len,0],[0,0,PI]);ring(.10,.012,col,[0,len-.07,0],[HP,0,0]);}
   else{add(id==='voodoo'?orb(.13):new T.OctahedronGeometry(.13),col,[0,len,0]);ring(.19,.012,gold,[0,len,0]);if(id==='bloomrod')for(let j=0;j<6;j++)add(orb(.055),col,[Math.cos(j*PI/3)*.15,len+Math.sin(j*PI/3)*.15,0]);}}
 }else if(f==='chain'){
  rod(.028,.24,dark,[0,.05,0]);const links=id==='sansetsu'||id==='nunchaku2'?3:7;
  for(let j=0;j<links;j++){const y=.16+j*.065,x=Math.sin(j*.6)*.08;if(id==='sansetsu'||id==='nunchaku2')rod(.03,.15,col,[j*.07,.12+j*.12,0]);else ring(.038,.011,col,[x,y,0],j%2?[0,HP,0]:null);}
  if(id==='yoyo'){add(cyl(.13,.065),col,[.02,.64,0],[HP,0,0]);}else if(id==='net'){for(let j=-2;j<=2;j++)add(box(.012,.36,.015),col,[j*.06,.46,0],[0,0,j*.12]);}else{add(orb(id==='wreckball'?.19:.11),col,[.015,.64,0]);if(id==='kusarigama2'||id==='fishhook'||id==='grapple')ring(.14,.026,metal,[.08,.63,0],[0,0,-.7],PI*1.5);}
 }else if(f==='fist'){
  if(id==='kali'){rod(.035,.48,wood,[0,.17,0]);rod(.025,.4,col,[.07,.17,0]);}
  else{add(orb(.12),col,[0,.07,0],null,[.9,1.1,.8]);ring(.10,.025,gold,[0,-.04,0],[HP,0,0]);if(id==='chui')add(orb(.16),gold,[0,.27,0]);if(id==='emeici')for(const x of [-.055,.055])add(g.cone(.025,.30,5),metal,[x,.27,0]);}
 }else if(f==='heavy'){
  rod(.037,len,dark,[0,len*.32,0]);
  if(id==='anchor'){ring(.24,.045,col,[0,len*.62,0],[0,0,PI],PI);add(box(.38,.035,.06),metal,[0,len*.80,0]);}
  else if(id==='bshield'||id==='ramplate'){add(g.rbox(.40,.52,.11,.06,2),col,[0,.29,0]);add(g.cone(.09,.20,4),gold,[0,.30,.15],[HP,0,0]);}
  else if(id==='jackdrill'||id==='pilebunker'||id==='breaker'){add(g.cone(.12,.40,12),col,[0,len+.04,0]);for(let j=0;j<4;j++)ring(.11-j*.02,.016,metal,[0,len-.10+j*.08,0],[HP,0,0]);add(box(.23,.23,.17),gold,[0,.25,0]);}
  else if(id==='chainsaw'){add(g.rbox(.18,.56,.07,.07,2),col,[0,.45,0]);for(let j=0;j<8;j++)for(const x of [-.10,.10])add(g.cone(.028,.06,3),metal,[x,.23+j*.06,0],[0,0,x>0?-HP:HP]);}
  else if(id==='turbine'){ring(.22,.04,col,[0,.40,0]);for(let j=0;j<4;j++)add(box(.24,.055,.05),metal,[Math.cos(j*HP)*.08,.40+Math.sin(j*HP)*.08,0],[0,0,j*HP]);}
  else{add(g.rbox(.36,.26,.22,.035,2),col,[0,len*.73,0]);for(const x of [-.13,.13])rod(.035,.32,metal,[x,len*.73,0]);if(id==='magnetarm')ring(.18,.04,col,[0,len*.94,0],null,PI*1.5);}
 }else if(f==='gun'){
  const long=listed(id,'sniper railgun coilgun laserrifle harpoon'),barrel=long?.78:listed(id,'revolver nailgun')?.32:.49;
  add(g.rbox(.12,.24,.10,.018,2),wood,[.02,-.02,0],[0,0,-.25]);add(g.rbox(.13,.26,.11,.018,2),dark,[-.05,.17,0]);rod(.027,barrel,metal,[-.05,.26+barrel/2,0]);add(cyl(.046,.07),col,[-.05,.28+barrel,0]);
  if(id==='minigun'||id==='gatling2')for(let j=0;j<6;j++){const a=j*PI/3;rod(.020,.47,metal,[-.05+Math.cos(a)*.07,.55,Math.sin(a)*.07]);}else if(id==='revolver'||id==='grenadel')add(cyl(id==='grenadel'?.12:.075,.11),col,[-.05,.17,0],[HP,0,0]);
  else if(id==='autoshot'){rod(.026,.49,col,[.01,.50,.055]);add(box(.08,.22,.08),wood,[-.05,.41,0]);}
  else if(id==='sniper'){add(cyl(.055,.22),dark,[.10,.25,0]);add(cyl(.065,.035),col,[.10,.38,0]);add(box(.16,.04,.05),metal,[.025,.27,0]);}
  else if(listed(id,'coilgun plasma railgun laserrifle')){for(let j=0;j<4;j++)ring(.068,.014,col,[-.05,.35+j*.105,0],[HP,0,0]);}
  else if(listed(id,'flamer flamethr acidgun')){add(cyl(.09,.28),col,[.10,.19,.02]);rod(.013,.35,gold,[.10,.36,.04]);}
  else if(id==='harpoon')add(g.cone(.065,.18,5),col,[-.05,.28+barrel,0]);else if(id==='crossbow')ring(.23,.022,wood,[-.05,.35,0],null,PI);else if(id==='shotcane')ring(.08,.020,gold,[-.08,-.05,0],null,PI);
 }else{
  if(id==='sickle') {rod(.026,.36,wood,[0,.12,0]);ring(.19,.035,col,[.10,.36,0],null,PI);}
  else if(id==='kunai'){blade(.30,.08);ring(.05,.012,metal,[0,-.09,0]);}
  else if(id==='lockpick'){rod(.024,.30,gold,[0,.10,0]);ring(.075,.017,gold,[0,.30,0]);add(box(.10,.024,.03),gold,[.04,-.02,0]);}
  else{add(orb(.17),col,[0,.17,0],null,[1,.9,.65]);ring(.11,.020,wood,[0,.31,0]);if(id==='bombsatchel')rod(.015,.14,gold,[.05,.37,0]);}
 }
 // An etched collar and colour are tied to this canonical ID, while the useful
 // silhouette above comes from its actual weapon class rather than a generic box.
 let seed=0;for(const c of id)seed=(seed*31+c.charCodeAt(0))>>>0;for(let j=0;j<1+seed%3;j++)rod(.033,.012,gold,[0,-.03+j*.025,0]);
 const geo=b.build();geo.userData.shared=true;geo.userData.equipmentId=id;geo.computeBoundingBox();const item={key,geo,family:f,id,refs:0};
 if(assets.size>=MAX)for(const [k,v]of assets)if(!v.refs){v.geo.dispose();assets.delete(k);break;}assets.set(key,item);return item;
}
function clear(p){const v=live.get(p);if(!v)return;v.root.parent?.remove(v.root);v.mat.dispose();v.asset.refs--;for(const [o,visible]of v.hidden)o.visible=visible&&!(v.rig.hideShared&&o.material!==v.rig.mat);live.delete(p);}
function sync(p){const rig=p?.rig,ref=p&&G.published?.native?.(p);if(!rig||rig.disposed||!ref?.equipmentCatalog){clear(p);return null;}let rows=catalogs.get(p.type);if(!rows){rows=new Map(ref.equipmentCatalog().map(w=>[w.id,w]));catalogs.set(p.type,rows);}const w=rows.get(ref.player.weapon),current=live.get(p);
 if(!w||w.default){clear(p);return null;}if(current&&(current.id!==w.id||current.rig!==rig))clear(p);let v=live.get(p);
 if(!v){const parent=rig.n?.wpn||rig.n?.handR||rig.n?.armR;if(!parent)return null;const hidden=[];if(rig.n.wpn)rig.n.wpn.traverse(o=>{if(o.isMesh)hidden.push([o,o.visible]);});const asset=blueprint(p.type,w),root=new T.Group(),mat=G.look.vmat({instance:true,rough:.42,metal:.16}),mesh=new T.Mesh(asset.geo,mat);root.name='equipped-'+w.id;root.userData.equipmentId=w.id;root.userData.family=asset.family;root.add(mesh);mesh.castShadow=true;const outline=G.look.outline(mesh,.012);parent.add(root);asset.refs++;v={id:w.id,rig,root,mat,mesh,outline,asset,hidden};live.set(p,v);}
 // The original staff wrist rests inside the robe silhouette. Present the open
 // spellbook just in front of the palm rather than hiding its pages in the torso.
 v.root.position.z=w.id==='grimoire'?.22:0;
 for(const [o]of v.hidden)o.visible=false;const alpha=rig.alpha??1;v.mat.opacity=alpha;v.mat.transparent=alpha<.999;v.mat.userData.uFlash.value=p.flashT>0?.7:0;v.outline.visible=alpha>.999&&G.quality.tier<2;return v.root;
}
G.equipmentVisual={sync,clear,clearAll(){for(const p of Array.from(live.keys()))clear(p);},family,stats(){return {live:live.size,cached:assets.size,max:MAX};},inspect:p=>live.get(p)||null};G.bus.on('scene',()=>G.equipmentVisual.clearAll());
})();

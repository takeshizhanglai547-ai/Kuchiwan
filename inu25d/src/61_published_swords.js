// Display-only holy sword rain. Native fsword/hsword events own position,
// height, fall time and lifetime; collision remains in the original 2D fighter.
(function(){'use strict';const G=window.G,T=window.THREE,live=[];
const blade=new T.BoxGeometry(.11,1,.045),tip=new T.ConeGeometry(.083,.18,4),guard=new T.BoxGeometry(.46,.11,.08),grip=new T.BoxGeometry(.06,.27,.06);
const edge=new T.BoxGeometry(.16,1,.04),core=new T.BoxGeometry(.032,1,.05),ink=new T.MeshBasicMaterial({color:0x263954}),ivory=new T.MeshBasicMaterial({color:0xffffff});
const silver=new T.MeshBasicMaterial({color:0xfff6d0}),gold=new T.MeshBasicMaterial({color:0xffcc48});
function mesh(geo,mat,parent,y){const m=new T.Mesh(geo,mat);m.position.y=y;parent.add(m);return m;}
function clear(){for(const v of live)v.obj.parent?.remove(v.obj);live.length=0;}
G.publishedSwords={
 particle(f,p,lane,clock,groundHeight=0){if(!['fsword','hsword'].includes(f.k))return false;
  const x=f.x/60,z=p.z+(f.y+groundHeight-lane)/60;
  if(f.k==='hsword')for(let i=live.length-1;i>=0;i--)if(Math.abs(live[i].x-x)<.001&&Math.abs(live[i].z-z)<.001){live[i].obj.parent?.remove(live[i].obj);live.splice(i,1);}
  const h=(f.h||118)/60,obj=new T.Group(),len=Math.max(.2,h-.5);
  const b=mesh(blade,silver,obj,.18+len/2);b.scale.y=len;const rim=new T.Mesh(edge,ink),shine=new T.Mesh(core,ivory);rim.position.z=-.025;shine.position.z=.025;b.add(rim,shine);
  mesh(tip,silver,obj,.09).rotation.z=Math.PI;
  mesh(guard,gold,obj,h-.28);mesh(grip,gold,obj,h-.11);
  G.scene.add(obj);const v={obj,x,z,clock,fall:f.k==='fsword'?f.fall||9:0,drop:(f.drop||430)/60,life:f.life||20};
  live.push(v);this.tick(clock);return true;
 },
 tick(clock){for(let i=live.length-1;i>=0;i--){const v=live[i],age=clock-v.clock;
   if(age>=v.life){v.obj.parent?.remove(v.obj);live.splice(i,1);continue;}
   const u=v.fall?Math.min(1,age/v.fall):1;
   v.obj.position.set(v.x,v.drop*(1-u*u)+.015,v.z);
  }},clear,get count(){return live.length;}
};
G.bus.on('scene',()=>clear());
})();

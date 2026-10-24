// Display-only holy sword rain. Native fsword/hsword events own position,
// height, fall time and lifetime; collision remains in the original 2D fighter.
(function(){'use strict';const G=window.G,T=window.THREE,live=[];
const blade=new T.BoxGeometry(.075,1,.035),tip=new T.ConeGeometry(.064,.18,4),guard=new T.BoxGeometry(.43,.085,.07),grip=new T.BoxGeometry(.06,.27,.06);
const silver=new T.MeshBasicMaterial({color:0xfff6d0}),gold=new T.MeshBasicMaterial({color:0xffcc48});
function mesh(geo,mat,parent,y){const m=new T.Mesh(geo,mat);m.position.y=y;parent.add(m);return m;}
function clear(){for(const v of live)v.obj.parent?.remove(v.obj);live.length=0;}
G.publishedSwords={
 particle(f,p,lane,clock,groundHeight=0){if(!['fsword','hsword'].includes(f.k))return false;
  const x=f.x/60,z=p.z+(f.y+groundHeight-lane)/60;
  if(f.k==='hsword')for(let i=live.length-1;i>=0;i--)if(Math.abs(live[i].x-x)<.001&&Math.abs(live[i].z-z)<.001){live[i].obj.parent?.remove(live[i].obj);live.splice(i,1);}
  const h=(f.h||118)/60,obj=new T.Group(),len=Math.max(.2,h-.5);
  mesh(blade,silver,obj,.18+len/2).scale.y=len;
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

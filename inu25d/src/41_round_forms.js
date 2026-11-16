// Curved forms shared by the articulated models. All resulting actor meshes
// are baked into the existing per-part vertex-colour geometry cache.
(function(){'use strict';
const G=window.G,T=window.THREE;
const profiles={
 leaf:[[-.75,-.18],[-.47,-.34],[.12,-.38],[.92,0],[.27,.38],[-.52,.29]],
 wing:[[-.91,-.11],[-.45,-.33],[.32,-.44],[.84,-.31],[.94,.01],[.68,.31],[.29,.46],[-.27,.40]],
 swallow:[[-.96,-.13],[-.62,-.30],[.09,-.44],[.55,-.29],[.90,-.54],[.73,-.03],[.96,.19],[.69,.48],[.20,.46],[-.42,.26]],
 shell:[[-.97,-.10],[-.77,-.32],[-.38,-.42],[.33,-.39],[.90,-.18],[.89,.17],[.53,.43],[.03,.51],[-.51,.42],[-.91,.24]],
 sickle:[[-.85,-.29],[-.45,-.38],[.08,-.30],[.59,-.02],[.91,.55],[.87,.04],[.64,-.33],[.22,-.57],[-.42,-.62],[-.88,-.45]],
 katana:[[-.28,-.87],[-.23,-.43],[-.12,.35],[.06,.85],[.27,1],[.24,.63],[.18,-.01],[.11,-.84]],
 spear:[[-.20,-1],[-.37,-.38],[-.29,.40],[0,1],[.31,.40],[.37,-.38],[.20,-1]],
 crest:[[-1,.25],[-.68,-.15],[-.31,-.27],[0,-.14],[.35,-.23],[.72,-.08],[1,.25],[.76,-.35],[.38,-.65],[0,-.72],[-.50,-.55],[-.81,-.23]],
 fan:[[-.93,.24],[-.78,.56],[-.37,.73],[0,.78],[.42,.72],[.79,.52],[.94,.19],[.59,-.10],[.22,-.29],[.07,-.68],[-.09,-.68],[-.26,-.28],[-.65,-.07]],
 petal:[[-.64,-.39],[-.41,-.56],[.17,-.44],[.62,-.21],[.91,.11],[.64,.48],[.08,.68],[-.49,.41],[-.71,.05]],
 cuirass:[[-.96,.13],[-.65,.64],[-.22,.77],[.24,.77],[.68,.65],[.98,.16],[.83,-.42],[.37,-.71],[-.39,-.71],[-.86,-.40]],
 cheek:[[-.90,.31],[-.63,.46],[.12,.48],[.66,.22],[.87,-.04],[.41,-.44],[-.24,-.43],[-.64,-.22]],
 shield:[[-.78,-.36],[-.82,.36],[-.64,.76],[0,.93],[.66,.75],[.81,.35],[.73,-.37],[.38,-.71],[0,-.86],[-.40,-.70]],
 strap:[[-.85,-.57],[-.78,.55],[-.54,.69],[.60,.68],[.86,.45],[.84,-.51],[.60,-.66],[-.59,-.68]],
 tail:[[-.87,-.64],[-.63,-.40],[-.25,-.27],[.11,0],[.69,-.46],[.91,-.64],[.65,-.04],[.92,.61],[.36,.40],[.04,.14],[-.30,.30],[-.69,.60]],
 bolt:[[-.24,-.93],[.26,-.33],[-.09,-.35],[.23,.31],[-.11,.28],[.20,.91],[.58,.95],[.28,.52],[.59,.56],[.22,-.13],[.60,-.12]]
};
const plates=new Map();
function plate(kind){
 if(plates.has(kind))return plates.get(kind);
 const points=profiles[kind],path=new T.Shape();
 for(let i=0;i<points.length;i++){
  const a=points[(i+points.length-1)%points.length],b=points[i],c=points[(i+1)%points.length];
  const edge=(p,k)=>b.map((v,d)=>v+(p[d]-v)*k);
  const enter=edge(a,.22),leave=edge(c,.22);
  if(i===0)path.moveTo(...enter);else path.lineTo(...enter);
  path.quadraticCurveTo(...b,...leave);
 }
 path.closePath();
 const geo=new T.ExtrudeGeometry(path,{depth:.045,steps:1,curveSegments:3,bevelThickness:.052,bevelSize:.045,bevelSegments:2});
 geo.translate(0,0,-.0225);geo.userData.shared=true;plates.set(kind,geo);return geo;
}
function curve(points,radii,steps=10,sides=9){
 const a=points.map(p=>new T.Vector3(...p)),path=new T.CatmullRomCurve3(a);
 const frames=path.computeFrenetFrames(steps,false),positions=[],index=[];
 const at=new T.Vector3(),out=new T.Vector3();
 for(let i=0;i<=steps;i++){
  const k=i/steps*(radii.length-1),lo=Math.min(radii.length-2,Math.floor(k)),w=k-lo;
  const [rX,rZ]=radii[lo].map((v,j)=>v*(1-w)+radii[lo+1][j]*w);
  path.getPointAt(i/steps,at);
  for(let j=0;j<sides;j++){
   const angle=j/sides*Math.PI*2;
   out.copy(at).addScaledVector(frames.normals[i],rX*Math.cos(angle)).addScaledVector(frames.binormals[i],rZ*Math.sin(angle));
   positions.push(out.x,out.y,out.z);
   if(i<steps){
    const b=i*sides+j,c=i*sides+(j+1)%sides;
    index.push(b,c,b+sides,c,c+sides,b+sides);
   }
  }
 }
 for(let j=1;j<sides-1;j++)index.push(0,j+1,j,steps*sides,steps*sides+j,steps*sides+j+1);
 const mesh=new T.BufferGeometry();mesh.setAttribute('position',new T.Float32BufferAttribute(positions,3));mesh.setIndex(index);mesh.computeVertexNormals();
 return mesh;
}
// A pear-shaped plush muzzle and a slightly flattened crown. Detail is baked
// by the caller, so there are no textures or network loads in a new fight.
const plush=new T.SphereGeometry(1,22,14);
const vertices=plush.attributes.position;
for(let i=0;i<vertices.count;i++){
 const x=vertices.getX(i),y=vertices.getY(i),z=vertices.getZ(i);
 vertices.setXYZ(i,x*(1-.045*y)+.028*(1-y*y),y+.043*(x*x-z*z),z*(1+.075*(.25-y)));
}
plush.computeVertexNormals();plush.userData.shared=true;
G.roundForms={plate,curve,plush};
})();

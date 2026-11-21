// Offline map illustrations and the physical silhouettes of the new ammunition.
(function(){'use strict';
const G=window.G,T=window.THREE;
const landmarks=[
 '<g fill="#87949e"><path d="M-65 20v-73l25 7v66m-10-81v-38l28 13v105m10 0v-90l30-10v100m8 0v-57l27-15v72"/><path d="M-78 23l22-16 25 10 34-12 25 22" fill="#bda19d"/></g><g stroke="#ffcf9e" stroke-width="5"><path d="M-55-27h9m-1-45h9m23 18h10m-10 22h10m43-5h9"/></g>',
 '<path d="M-75 25v-51l30-24v24l28-24v24l30-24v24h54v51z" fill="#929eaa"/><path d="M-55-38v-45h20v29m62 28v-73h17v73" fill="#ac918e"/><g fill="#ffd49e"><path d="M-58-9h18v15h-18zm39 0h18v15h-18zm39 0h18v15H20z"/></g><path d="M-67 27h130m-126 8h122" stroke="#696e7b"/>',
 '<path d="M-81 29l162-6m-155 14l160-6" stroke="#77848f" stroke-width="8"/><g fill="#9dafb6"><path d="M-64 20v-50h114l18 19v31z"/><path d="M-68-34h112l8 8H-68Z" fill="#657987"/></g><g fill="#edca9f"><path d="M-47-17h18v15h-18zm29 0H0v15h-18zm29 0h18v15H11z"/></g><g fill="#6d6b79"><circle cx="-39" cy="22" r="9"/><circle cx="42" cy="22" r="9"/></g>',
 '<path d="M-51 29V-67Q0-97 51-67v96z" fill="#9b8488"/><path d="M-53-54Q0-33 53-54m-106 40Q0 7 53-14" fill="none" stroke="#bdb0ad" stroke-width="9"/><path d="M-25 29v-30q25-28 50 0v30z" fill="#ffb97d"/><path d="M-77 28v-87m153 87v-87" stroke="#80858e" stroke-width="13"/><path d="M-75-69q-25-22 0-39m149 39q23-23 0-39" stroke="#ccc2b7" stroke-opacity=".6" fill="none" stroke-width="11"/>',
 '<path d="M-71 29v-87l24-17 13 17v31h20v-75h29v75h20v-31l14-17 23 17v87z" fill="#827b94"/><path d="M-22 29v-53q22-24 44 0v53" fill="#443e5c"/><path d="M-46-42v32m90-32v32M0-86v33" stroke="#d3b4f5" stroke-width="6"/><path d="M-21-86l8-25 13 13 14-13 8 25z" fill="#d1b2b6"/>'
];
const dog='<g stroke="#655465" stroke-width="2.2"><path d="M-16 22q-1-24 16-22 18 0 17 22z" fill="#ada3ab"/><ellipse cy="-7" rx="22" ry="20" fill="#e3d6c5"/><path d="M-19-16q-13-16-16-1t16 10m38-9q12-16 16-1T19-7" fill="#8f8597"/><ellipse cx="-8" cy="-7" rx="3" ry="4" fill="#44394d"/><ellipse cx="8" cy="-7" rx="3" ry="4" fill="#44394d"/><path d="M-4 3q4 7 8 0" fill="none"/><path d="M-11 21h9m6 0h9" stroke="#e7d8c5" stroke-width="7"/><path d="M-8-21l3-5h13l2 7" fill="#9b9faa"/></g>';
function mapSvg(){
 const pins=[[156,526],[372,266],[600,475],[852,259],[1044,490]];
 return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 720" preserveAspectRatio="none">'+
 '<defs><linearGradient id="mk-sky" x2="0" y2="1"><stop stop-color="#b8c1cc"/><stop offset="1" stop-color="#e4d6c7"/></linearGradient><pattern id="mk-paper" width="35" height="29" patternUnits="userSpaceOnUse"><path d="M4 9l5-1m15 16l4-2M19 4l2 1" stroke="#856d7a" stroke-opacity=".13" stroke-width="1.3"/></pattern></defs>'+
 '<rect width="1200" height="720" fill="url(#mk-sky)"/><circle cx="1010" cy="102" r="51" fill="#ffe6b1" opacity=".7"/>'+
 '<path d="M0 188l86-68 101 48 99-56 122 63 93-68 108 67 128-79 111 73 112-70 140 94v528H0Z" fill="#8e9aaa" opacity=".55"/>'+
 '<path d="M35 305q47-97 191-85 72-66 178-28 101-57 178-16 163-54 261 15 148-23 214 80 77 60 27 179 52 106-65 166-86 94-225 37-112 57-248 1-99 40-218-4Q123 688 57 576-11 454 35 305Z" fill="#c6b7b4" stroke="#8b7786" stroke-width="6"/>'+
 '<path d="M49 455q151-85 259 12 99 64 213-10 116-64 251 11 110 58 372-40v210H49Z" fill="#abaaa5" opacity=".65"/>'+
 '<path d="M177 131l28 4 16-3m568-8l30 3 27-1M575 636l28 6 27-5" fill="none" stroke="#f5ecda" stroke-width="7" stroke-linecap="round"/>'+
 pins.map(([x,y],i)=>'<g transform="translate('+x+' '+(y-48)+') scale(1.17)" stroke="#6e6272" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">'+landmarks[i]+'</g>').join('')+
 '<g fill="#a99193" stroke="#827886" stroke-width="2">'+[80,280,490,740,940,1120].map((x,i)=>'<path d="M'+x+' '+(340+i%2*220)+'l14-11 24 9-5 13z"/>').join('')+'</g>'+
 '<g transform="translate(705 566) scale(1.15)">'+dog+'</g><g transform="translate(108 270) scale(.92)">'+dog+'</g>'+
 '<path d="M680 569q-11-33-28-19m25 15q21-23 32-10" stroke="#87997d" fill="none" stroke-width="6" stroke-linecap="round"/><circle cx="650" cy="548" r="9" fill="#eab6c5"/>'+
 '<rect width="1200" height="720" fill="url(#mk-paper)"/></svg>';
}
G.mapArt[6]='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(mapSvg());
const originalPassage=G.storybook.passage;
G.storybook.passage=(index,clear)=>{
 const s=G.stages[index],next=G.stages[index+(clear?1:-1)];
 if(s?.lap!==6&&!(clear&&next?.lap===6))return originalPassage(index,clear);
 const from=clear?s:next,to=clear?next:s,chapter=Math.max(0,Math.min(4,(to?.lap===6?to.chapter:s.chapter)-1));
 const left=from?.lap===6?from.chapter-1:-1,right=clear&&!next?-1:chapter;
 const home='<path d="M-45 27v-52l45-30 45 30v52z" fill="#d8b6a8"/><path d="M-54-24L0-65 54-24" fill="none" stroke="#ae8190" stroke-width="10"/>';
 return {caption:(from?.name||'戦国の門')+' → '+(to?.name||'朝日の避難所'),svg:
  '<svg viewBox="0 0 420 230" aria-hidden="true"><rect width="420" height="230" rx="10" fill="#c4c4d0"/><circle cx="348" cy="42" r="25" fill="#ffe1b2"/>'+
  '<path d="M0 117l44-45 53 33 55-48 69 58 63-49 63 37 73-34v161H0z" fill="#8b94a7"/><path d="M0 170q123-58 211 1t209-4v63H0z" fill="#b9afa9"/>'+
  '<path d="M58 182Q210 206 356 172" fill="none" stroke="#ead4b5" stroke-width="12" stroke-linecap="round"/>'+
  '<g transform="translate(87 143) scale(.65)" stroke="#6c5c6e" stroke-width="3" stroke-linejoin="round">'+(left<0?home:landmarks[left])+'</g>'+
  '<g transform="translate(325 145) scale(.83)" stroke="#6c5c6e" stroke-width="3" stroke-linejoin="round">'+(right<0?home:landmarks[right])+'</g>'+
  '<g transform="translate(202 177) scale(.74)">'+dog+'</g><path d="M218 186q10-22 24-13" stroke="#8c9b84" stroke-width="4" fill="none"/></svg>'};
};
const make=G.fx.makeProjectile.bind(G.fx),geometry=new Map();
G.fx.makeProjectile=kind=>{
 if(kind!=='mechaFist'&&kind!=='mechaGrenade')return make(kind);
 if(!geometry.has(kind)){
  const b=G.look.builder(),g=G.look.geo;
  if(kind==='mechaFist'){
   b.add(g.rbox(.38,.28,.31,.06,3),'#a9a2b0',[0,0,0]);
   b.add(g.cylinder(.11,.11,.25,12),'#655d78',[-.22,0,0],[0,0,Math.PI/2]);
   for(let i=0;i<3;i++)b.add(g.rbox(.076,.055,.055,.012,2),'#e6d2c0',[.09,-.08+i*.075,.165]);
   b.add(g.torus(.105,.025,6,18),'#f0b7d8',[-.345,0,0],[0,Math.PI/2,0]);
  }else{
   b.add(g.sphere(.16,12,8),'#6e7f77',[0,0,0],[0,0,.3],[1,1.15,1]);
   for(const y of [-.09,.02,.10])b.add(g.torus(.13,.014,5,14),'#aaadb0',[0,y,0],[Math.PI/2,0,0]);
   b.add(g.rbox(.09,.09,.08,.014,2),'#e8bd8e',[0,.178,0]);
  }
  const geo=b.build();geo.userData.shared=true;geometry.set(kind,geo);
 }
 const obj=new T.Group(),mat=G.look.vmat({instance:true,rough:.45,metal:.2}),mesh=new T.Mesh(geometry.get(kind),mat);
 obj.add(mesh);G.look.outline(mesh,.012,'#3b3545');
 return {obj,update(p){
  obj.rotation.y=-Math.atan2(p.vz,p.vx);
  if(kind==='mechaGrenade')mesh.rotation.z=p.age*.18;
  else if(p.age%3===0)G.fx.burst('flame',p.x-Math.sign(p.vx)*.30,p.y,p.z,{color:'#bdefff',scale:.35});
 },dispose(){mat.dispose();}};
};
G.bus.on('hit',({src,target,kind})=>{
 if(src?.type!=='kuro'||!target||kind==='block')return;
 G.fx.burst('slash',target.x,target.y+target.height*.5,target.z,{color:'#f0cede',scale:1.30,dir:src.face});
 G.fx.burst('spark',target.x,target.y+.6,target.z,{color:'#fbd6a1',count:5});
});
const walls=new Map(),wallGeometry=new T.BoxGeometry(.22,1.46,1.35);
function removeWall(player){const w=walls.get(player);if(!w)return;w.root.removeFromParent();w.material.dispose();walls.delete(player);}
G.bus.on('kuroWallTarget',({player,x,z})=>{
 removeWall(player);
 const root=new T.Group(),material=new T.MeshStandardMaterial({color:'#91828f',roughness:.82,transparent:true,opacity:.84});
 const slab=new T.Mesh(wallGeometry,material);slab.position.y=.73;root.add(slab);root.position.set(x,0,z);
 G.look.outline(slab,.013,'#3d3045');G.scene.add(root);walls.set(player,{root,material,age:0});
});
G.bus.on('kuroWallSlam',()=>G.fx.burst('dustRing',G.player.x,.08,G.player.z,{color:'#d2b4bb',scale:1.7}));
const frame=G.fx.frame.bind(G.fx);
G.fx.frame=dt=>{
 frame(dt);
 if(G.paused||G.story?.blocked)return;
 for(const [p,w]of walls){
  w.age+=dt;
  const native=G.published.native(p)?.player,held=native?._kuroCarry;
  if(!held||w.age>3){w.material.opacity-=dt*2;if(w.material.opacity<=0)removeWall(p);}
 }
};
G.bus.on('scene',()=>{for(const p of walls.keys())removeWall(p);});
})();

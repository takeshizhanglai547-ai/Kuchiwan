(function(){'use strict';
const G=window.G,T=window.THREE;
const rows=new Map();
for(const r of G.publishedCatalog?.rows||[])if(!rows.has(r.hero+':'+r.id))rows.set(r.hero+':'+r.id,r);
const slots=['up','fwd','down','dash','hadou','dp','du'];
const bySlot={
 inu:['rise','draw','slide','dash','wave','risingSpin','swords'],
 shima:['cyclone','fist','kick','flurry','flurry','fireKick','fist'],
 nuko:['magicLift','ember','pillar','rail','frost','lightning','tornado'],
 guard8:['hammerLift','hammer','headbutt','spin','shield','quake','meteor'],
 watch:['smoke','wire','shadow','vault','card','vault','sigil'],
 wanden:['rise','double','lowCut','dash','mist','cleave','draw'],
 mack:['lob','bazooka','flame','drill','launcher','sniper','shotgun']
};
// Shape, tint, scale and stroke pitch. These profiles also drive active poses.
const styles={
 rise:['rise','#a7e6ff',1.16,-1.32],draw:['slash','#ffe2a6',1.32,-.21],slide:['sweep','#efd39b',1.04,.05],
 dash:['dash','#c8f0ff',1.28,-.16],wave:['slash','#87ddff',1.51,-.55],risingSpin:['rise','#e1d0ff',1.46,-1.15],swords:['summon','#fff0a9',1.53,-.42],
 cyclone:['sweep','#ffe0a0',1.29,.29],fist:['impact','#ffb168',1.03,.15],kick:['slash','#ffdb96',1.23,.58],
 flurry:['impact','#ffc45d',1.03,.16],fireKick:['rise','#ff954d',1.21,-1.12],
 magicLift:['summon','#eab4ff',1.08,-.82],ember:['impact','#ff9b73',1.09,.13],pillar:['pillar','#ff8c4a',1.20,-.47],
 rail:['rail','#87f9fc',1.15,0],frost:['sigil','#a2eaff',1.32,0],lightning:['rise','#ffdb69',1.32,-1.12],tornado:['summon','#7fe5e4',1.45,0],
 hammerLift:['rise','#ffe29d',1.18,-1.2],hammer:['slash','#ffc078',1.31,.83],headbutt:['impact','#f1d8a0',1.13,.11],
 spin:['sweep','#e6bbff',1.24,.05],shield:['impact','#8fe4ff',1.19,0],quake:['sweep','#ffc86c',1.48,0],meteor:['pillar','#ff9d65',1.44,.41],
 smoke:['sigil','#bfb4de',1.19,0],wire:['rail','#94f3d7',1,.17],shadow:['sweep','#c1a2ef',1.09,0],
 vault:['rise','#ffc6ec',1.13,-.68],card:['slash','#ffa4db',1.36,.12],sigil:['sigil','#ffda84',1.15,0],
 double:['slash','#c2efff',1.37,-.34],lowCut:['sweep','#7dddf6',1.37,.22],mist:['slash','#c0d3ff',1.48,-.42],cleave:['slash','#e1baf8',1.35,.79],
 lob:['shot','#ffcd85',1.11,-.8],bazooka:['shot','#ff964c',1.42,-.06],flame:['flame','#ff8942',1.23,0],
 drill:['dash','#d8eaff',1.17,.11],launcher:['shot','#ffd38a',1.24,-.39],sniper:['rail','#bcecff',1.1,0],shotgun:['shot','#ffe9a4',1.16,.03]
};
const combo={
 inu:['draw','double','cleave','wave'],shima:['fist','fist','kick','flurry'],nuko:['ember','frost','magicLift','lightning'],
 guard8:['hammer','headbutt','hammerLift','quake'],watch:['wire','card','vault','smoke'],wanden:['draw','lowCut','double','cleave'],
 mack:['sniper','shotgun','sniper','shotgun']
};
const armed={gun:'sniper',fist:'flurry',magic:'lightning',chain:'double',pole:'rise',fan:'wave',heavy:'meteor',gadget:'launcher',katana:'mist',cane:'wire'};
function profile(p,m){
 const type=p.type,row=rows.get(type+':'+(m.id||m.type)),d=m.def||G.publishedCatalog?.defs?.[m.id]||{};
 const group=row?.group,slot=row?.slot,list=bySlot[type]||bySlot.inu;
 const weaponFamily=m.armory&&G.equipmentVisual?.family?.(m.armory);
 let key=armed[weaponFamily]||list[slots.indexOf(slot)];
 if(d.mkGL)key='launcher';
 else if(d.mkBazooka)key='bazooka';
 else if(d.fireCol||d.firetrail&&type==='nuko')key='pillar';
 else if(d.ice&&type==='nuko')key='frost';
 else if(d.mkFlame||m.id==='mkflame')key='flame';
 else if(m.id==='nrailfire'||m.id==='nrailchg')key='rail';
 else if(d.combo)key=(combo[type]||combo.inu)[(d.combo-1)%4];
 else if(!key&&type==='shima'&&d.kick)key='kick';
 if(!key){
  const id=m.id||m.type||'';
  const i=/-down$/.test(id)?2:/-up$/.test(id)?0:group?.includes('ultimate')||d.ultMove?6:/dash|slide/.test(id)?3:1;
  key=list[i];
 }
 const [mode,tint,scale,angle]=styles[key];
 return {key,mode,tint,scale:scale+(m.tier||0)*.045,angle};
}
function burst(kind,x,y,z,options){G.fx?.burst?.(kind,x,y,z,options);}
const strokeFor={
 rise:'slash',slash:'slash',sweep:'dustRing',dash:'windRibbon',summon:'magic',sigil:'magic',rail:'sparkle',
 impact:'shock',flame:'flame',pillar:'flame',shot:'smoke'
};
const elements={frost:'ice',lightning:'thunder',ember:'flame',wire:'sparkle',card:'stars',smoke:'smoke',
 tornado:'windRibbon',fireKick:'flame',shadow:'smoke',swords:'stars',wave:'windRibbon',hammer:'shock',mist:'ice',flurry:'shock'};
function swing(p,a){
 const d=a.def||{},v=profile(p,{id:a.type||a.id,def:d,tier:a.tier,armory:a.armory});
 const x=p.x+p.face*Math.min(1.12,Math.max(.35,(d.reach||47)/85)),z=p.z;
 const y=p.y+(v.mode==='sweep'?.28:v.mode==='rise'?1.05:.72);
 const scale=v.scale*(d.finisher||d.special?1.12:.84);
 burst(strokeFor[v.mode],x,y,z,{color:v.tint,dir:p.face,scale,angle:v.angle,count:4});
 const secondary=elements[v.key];
 if(secondary)burst(secondary,x+p.face*.24,y+(v.mode==='rise'?.29:.07),z,{color:v.tint,dir:p.face,scale:scale*.90,angle:v.angle,count:5});
 if(p.type==='wanden'&&(d.iai||d.finisher||d.special))
  burst('slash',x+p.face*.40,p.y+.9,z,{color:'#ffffff',dir:p.face,count:2,scale:scale*1.12});
}
// Overlay the authored windup/active/recovery poses with matching hand,
// shoulder and foot accents. All offsets are on the displayed rig.
function accent(p,m,Q,pose){
 if(!m?.act||m.id==='grab'||p.dead)return;
 const v=profile(p,m),t=m.t,start=m.act[0],end=m.act[1],span=Math.max(1,end-start);
 const k=G.U.clamp((t-start)/span,0,1),wind=t<start?G.U.clamp(t/Math.max(1,start),0,1):0;
 const beat=t>=start?Math.exp(-Math.max(0,t-start)*.16):0;
 const active=t>=start&&t<=end,arc=active?Math.sin(Math.PI*k):0;
 const follow=t>end?Math.sin(Math.PI*G.U.clamp((t-end)/Math.max(1,m.duration-end),0,1)):0;
 Q.ear+=.15*wind-.23*beat;Q.tail+=.32*arc-.21*follow;Q.mouth=Math.max(Q.mouth,beat*.66);
 switch(v.mode){
  case 'slash':case 'sweep':case 'dash':
   Q.twist-=wind*.19;Q.twist+=.25*beat;Q.wy+=arc*.39+follow*.13;
   Q.nod+=.13*beat-.08*follow;Q.tilt+=-.11*wind+.17*arc;
   Q.aLy+=wind*.14-beat*.21;Q.lRx+=.16*arc;
   break;
  case 'rise':
   Q.nod-=.16*wind;Q.nod+=.22*beat;Q.wz+=arc*.28;Q.aLz+=.12*arc;
   Q.lLz+=.25*beat;Q.lRx+=.22*arc;Q.aLy-=.23*arc;
   break;
  case 'shot':case 'rail':
   Q.lean+=.13*wind-.24*beat;Q.nod-=.18*beat;
   Q.aRx+=.11*wind;Q.wz+=.21*beat;Q.wx+=.22*beat;
   Q.lLz+=.14*wind;Q.lRz-=.13*beat;
   break;
  case 'summon':case 'pillar':case 'sigil':case 'flame':
   Q.aLx+=.15*wind+.27*arc;Q.aRx+=.15*wind+.27*arc;
   Q.nod+=.16*beat-.07*wind;Q.side+=.07*arc*Math.sin(t*.54);
   break;
  default:
   Q.lean+=.18*beat;Q.twist+=.24*beat-.13*wind;
   Q.lLz+=.13*arc;Q.lRz-=.19*arc;Q.aLx+=wind*.22;
 }
 if(pose&&active)pose.glow+=.09*beat;
}
const rings=[new T.TorusGeometry(.74,.055,5,32),new T.TorusGeometry(.74,.027,5,32)];
const cone=new T.ConeGeometry(.52,1.80,10,1,true),spark=new T.OctahedronGeometry(.125);
const spiral=new T.TorusGeometry(1,.053,6,32,Math.PI*1.53);
const flashes=[],vortices=new Map(),activeVortex=new Set();
function dispose(e){e.root.removeFromParent();e.rim.dispose();e.core.dispose();}
function make(name,x,y,z,color){
 if(!G.scene)return null;
 const root=new T.Group(),rim=new T.MeshBasicMaterial({color,transparent:true,opacity:.86,depthWrite:false,side:T.DoubleSide});
 const core=new T.MeshBasicMaterial({color:'#fff7de',transparent:true,opacity:.86,depthWrite:false,side:T.DoubleSide});
 root.name='hero-effect-'+name;root.position.set(x,y,z);G.scene.add(root);
 return {root,rim,core,age:0,name,meshes:[]};
}
function add(e,geo,material){
 const mesh=new T.Mesh(geo,material);mesh.renderOrder=25;e.root.add(mesh);e.meshes.push(mesh);return mesh;
}
function timed(e,life,scale){e.life=life;e.scale=scale;if(flashes.length===12)dispose(flashes.shift());flashes.push(e);}
function explosion(x,z,r,color,grenade){
 const scale=G.U.clamp(r*.68,.68,1.9);
 const tint=grenade==='shrap'?'#ffe1a4':grenade==='fire'?'#ff7650':color||'#ffac58';
 burst('shock',x,.07,z,{color:tint,scale});
 burst('flame',x,.36,z,{color:tint,count:grenade?8:12,scale});
 burst('smoke',x,.75,z,{count:grenade?6:10,scale,color:'#5c4d52'});
 burst(grenade?'stars':'dustRing',x,.2,z,{color:tint,count:grenade?10:6,scale:scale*1.16});
 G.fx?.impact?.(x,.57,z,grenade?'pop':'fire',2,{scale:.8*scale,color:tint});
 const e=make(grenade?'grenade':'bazooka',x,.08,z,tint);
 if(!e)return;
 add(e,rings[0],e.rim).rotation.x=Math.PI/2;
 add(e,rings[1],e.core).rotation.x=Math.PI/2;
 if(grenade){
  for(let i=0;i<7;i++)add(e,spark,i%2?e.core:e.rim);
 }else add(e,cone,e.rim).position.y=.44;
 timed(e,grenade?25:30,scale);
}
function firePillar(x,z){
 burst('shock',x,.06,z,{scale:1.15,color:'#ffb13c'});
 for(let i=0;i<5;i++)burst('flame',x,.25+i*.48,z,{color:i<2?'#ffc04e':'#ff823d',count:4,scale:1.25-i*.14});
 const e=make('fire-column',x,.05,z,'#ff7636');
 if(!e)return;
 add(e,rings[0],e.rim).rotation.x=Math.PI/2;
 add(e,cone,e.rim);add(e,cone,e.core);
 for(let i=0;i<3;i++)add(e,spark,e.rim);
 timed(e,28,1.18);
}
function hazards(p,hazards,lane,units){
 if(p.type!=='nuko')return;
 activeVortex.clear();
 for(const h of hazards){
  if(h.kind!=='ptwister')continue;
  const x=h.x/units,z=p.z+((h.y??lane)-lane)/units;
  activeVortex.add(h);
  let e=vortices.get(h);
  if(!e){
   e=make('tornado',x,.10,z,'#6be3df');
   if(e){e.owner=p;for(let i=0;i<8;i++)add(e,spiral,i%2?e.rim:e.core);vortices.set(h,e);}
  }
  if(e){
   e.root.position.set(x,.09,z);
   const age=h.t||0,strength=Math.min(1,(age+6)/13,(h.life||210)-age>15?1:Math.max(.1,((h.life||210)-age)/15));
   for(let i=0;i<e.meshes.length;i++){
    const m=e.meshes[i],r=(.26+i*.15)*strength;
    m.rotation.set(Math.PI*.46+.11*Math.sin(age*.2+i),0,age*.18+i*1.14);
    m.position.y=i*.36;m.scale.set(r,r,.74);
   }
   e.core.opacity=.80*strength;e.rim.opacity=.72*strength;
  }
  if(h.t%5!==1)continue;
  for(let i=0;i<7;i++){
   const a=h.t*.35+i*1.53,r=.22+i*.17;
   burst('windRibbon',x+Math.cos(a)*r,.28+i*.42,z+Math.sin(a)*r,
    {angle:a,scale:.54+i*.095,color:i%2?'#ddfff5':'#7fe5e4'});
  }
 }
 for(const [h,e] of vortices)if(e.owner===p&&!activeVortex.has(h)){dispose(e);vortices.delete(h);}
}
function frame(delta){
 for(let i=flashes.length-1;i>=0;i--){
  const e=flashes[i],k=(e.age+=delta)/e.life;
  if(k>=1){dispose(e);flashes.splice(i,1);continue;}
  const swell=Math.sin(Math.min(1,k*2)*Math.PI/2),alpha=1-k;
  e.rim.opacity=.86*alpha;e.core.opacity=.95*alpha;
  for(const [j,m] of e.meshes.entries()){
   if(j===0||e.name!=='fire-column'&&j===1){
    m.scale.setScalar(e.scale*(.40+swell*(j===1?1.1:1.31)));continue;
   }
   if(e.name==='fire-column'&&j<3){
    const height=(.37+swell*1.10)*alpha;
    m.position.y=.8*height;m.rotation.y=k*(j===1?7:-6);m.scale.set(j===1?e.scale:.5,height,j===1?e.scale:.5);
   }else if(e.name==='bazooka')m.scale.set(swell*1.33,alpha*.82,swell*1.33);
   else{
    const angle=j*Math.PI*.43,dist=(e.name==='fire-column'?.32:1.8)*swell*e.scale;
    m.position.set(Math.cos(angle)*dist,(e.name==='fire-column'?j*.37:.17)+Math.sin(k*Math.PI)*.82,Math.sin(angle)*dist);
    m.rotation.z=k*5+j;m.scale.setScalar(alpha*1.08);
   }
  }
 }
 for(const [h,e] of vortices)if(e.owner.removed){dispose(e);vortices.delete(h);}
}
G.bus?.on('scene',()=>{for(const e of flashes)dispose(e);flashes.length=0;for(const e of vortices.values())dispose(e);vortices.clear();});
G.heroCombatFx={profile,accent,swing,explosion,firePillar,hazards,frame};
})();

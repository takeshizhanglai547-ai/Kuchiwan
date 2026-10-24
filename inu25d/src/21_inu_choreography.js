// Seven base ground commands for Inu only. Read-only native clock; display transforms only.
(function(){'use strict';const G=window.G,THREE=window.THREE,TAU=Math.PI*2;
const ids=new Set(['shoryu','iai','slide','iaidash','iwave','idragon','iswords']);
const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v)),smooth=x=>{x=clamp(x);return x*x*(3-2*x);};
const lerp=(a,b,t)=>a+(b-a)*t;
const A={
  shoryu:{wind:{aRz:-.4,aRy:-.22,aRx:.35,wz:1.77,aLz:1.05,aLx:.55,lean:.18,twist:.18,nod:-.12},
    strike:{aRz:2.4,aRy:.1,aRx:.25,wz:.67,aLz:.8,aLx:.55,lean:-.1,twist:-.22,nod:.18,lLz:.48,lRz:-.25,mouth:.7},
    follow:{aRz:2.7,aRy:.15,wz:.07,aLz:1.1,lean:-.08,twist:-.18,nod:.18,lLz:.35,lRz:.05}},
  iai:{wind:{aRz:.55,aRy:1.12,aRx:.25,wz:4.02,aLz:.65,aLy:.3,aLx:.42,lean:.12,twist:-.44,nod:-.08},
    strike:{aRz:1.45,aRy:-.8,aRx:.3,wz:.32,aLz:.12,aLx:.7,lean:.2,twist:.5,nod:.02,lLz:.3,lRz:-.16,mouth:.65},
    follow:{aRz:1.3,aRy:-1.2,aRx:.28,wz:.19,aLz:.1,aLx:.65,lean:.12,twist:.42,lLz:.25,lRz:-.1}},
  slide:{wind:{roll:.3,aRz:2.15,wz:.2,aLz:1.7,aLx:.3,lean:.2,lLz:.55,lRz:.6,nod:-.1},
    strike:{roll:.78,aRz:2.15,aRx:.2,wz:.34,aLz:1.85,aLx:.35,lean:.12,lLz:1.25,lRz:1.12,nod:-.12,mouth:.5},
    follow:{roll:.6,aRz:1.9,wz:.25,aLz:1.65,aLx:.4,lean:.1,lLz:1.05,lRz:.9,nod:-.08}},
  iaidash:{wind:{aRz:.5,aRy:1.15,wz:3.92,aLz:.25,aLx:.6,lean:.34,twist:-.3,nod:-.07},
    strike:{aRz:1.45,aRy:-.9,wz:.42,aLz:.1,aLx:.65,lean:.3,twist:.42,lLz:.65,lRz:-.4,mouth:.65},
    follow:{aRz:1.25,aRy:-1.15,wz:.52,aLz:.12,aLx:.65,lean:.25,twist:.4,lLz:-.35,lRz:.68}},
  iwave:{wind:{aRz:2.65,aRy:-.45,aRx:.38,wz:.92,aLz:1.1,aLy:.25,aLx:.48,lean:-.08,twist:.45,nod:.1},
    strike:{aRz:.85,aRy:.48,aRx:.28,wz:.72,aLz:.3,aLx:.65,lean:.24,twist:-.48,nod:-.07,lLz:.2,lRz:-.08,mouth:.6},
    follow:{aRz:.4,aRy:.7,aRx:.25,wz:1.0,aLz:.25,aLx:.55,lean:.17,twist:-.38,lLz:.15,lRz:-.04}},
  idragon:{wind:{aRz:-.55,aRy:-.35,aRx:.32,wz:2.0,aLz:.9,aLx:.55,lean:.2,twist:.24,nod:-.16},
    strike:{aRz:2.6,aRy:.05,aRx:.25,wz:.4,aLz:1.6,aLx:.4,lean:-.13,nod:.24,lLz:.7,lRz:-.4,mouth:.75},
    follow:{aRz:2.75,aRy:.08,wz:0,aLz:1.5,lean:-.05,nod:.16,lLz:.5,lRz:.15}},
  iswords:{wind:{aRz:1.45,aRy:.02,aRx:.22,wz:1.68,aLz:1.25,aLy:.3,aLx:.16,lean:.06,nod:-.1},
    strike:{aRz:2.5,aRy:.02,aRx:.22,wz:.57,aLz:2.3,aLy:.12,aLx:.3,lean:-.1,nod:.25,mouth:.4},
    follow:{aRz:2.55,aRy:.05,aRx:.22,wz:.57,aLz:2.1,aLy:.12,aLx:.3,lean:-.05,nod:.2}}
};
function sample(a,b,k,Q,rest){for(const key of Object.keys(Q)){if(key[0]==='_')continue;Q[key]=lerp(a[key]??rest[key]??0,b[key]??rest[key]??0,k);}Q.sq=Q.y=Q.fx=0;}
const v=new THREE.Vector3(),w=new THREE.Vector3(),local=new THREE.Vector3(),target=new THREE.Vector3(),box=new THREE.Box3();
function point(leg,out){const mesh=leg.children[0];if(!mesh.geometry.boundingBox)mesh.geometry.computeBoundingBox();const b=mesh.geometry.boundingBox;
  out.set((b.min.x+b.max.x)/2,b.min.y,(b.min.z+b.max.z)/2);return mesh.localToWorld(out);}
function cache(rig){if(rig._inuRest)return rig._inuRest;const n=rig.n;
  const c={hipY:n.hips.position.y,legs:[n.legL.position.clone(),n.legR.position.clone()],meshes:[]};
  rig.root.traverse(o=>{if(o.isMesh&&!o.userData.isOutline&&!['eyes','face'].includes(o.name))c.meshes.push(o);});rig._inuRest=c;return c;}
G.inuGroundMotion={
  ids:[...ids],
  pose(rig,e,Q,rest){const m=e.publishedMotion;if(!e.published||e.type!=='inu'||!m||!ids.has(m.id)){rig.st._inuLast=null;return null;}
    const c=cache(rig),old=rig.st._inuLast;
    if(!old||old.id!==m.id||m.time<old.time){rig.root.updateMatrixWorld(true);
      rig.st._inuLast={id:m.id,time:m.time,step:-1,feet:[point(rig.n.legL,new THREE.Vector3()),point(rig.n.legR,new THREE.Vector3())],stepFeet:[new THREE.Vector3(),new THREE.Vector3()]};}
    rig.st._inuLast.time=m.time;
    const def=A[m.id],hold=m.holdMax||0,start=hold+m.act[0],finish=hold+m.act[1],end=hold+m.duration,t=m.time;
    let phase,k,drop=0;
    if(t<start){phase='wind';k=smooth((t+(start===1?1:0))/Math.max(1,start-2));sample(rest,def.wind,k,Q,rest);drop=(m.id==='idragon'?.14:m.id==='slide'?.1:.075)*k;
      if(start>=3&&t>start-2)sample(def.wind,def.strike,smooth((t-start+2)/2),Q,rest);}
    else if(t<=finish){phase='active';k=smooth((t-start)/Math.max(1,finish-start));sample(def.strike,def.follow,k,Q,rest);drop=.015;
      if(m.id==='slide'){sample(def.wind,def.strike,smooth(Math.min(1,t/3)),Q,rest);drop=.06;}
      if(m.id==='iaidash'){const cycle=(m.t%5)/4;sample(def.strike,def.follow,smooth(cycle),Q,rest);drop=.035;}
      if(m.id==='iswords'){sample(def.strike,def.follow,smooth((t-start)/Math.max(1,finish-start)),Q,rest);drop=.005;}
    }else{phase='follow';k=smooth((t-finish)/Math.max(1,end-finish));sample(def.follow,rest,k,Q,rest);drop=.025*(1-k);}
    if(m.id==='idragon'){Q.spin=TAU*smooth((m.t-2)/20);e._inuRiseVisual=true;}
    if(m.id==='shoryu')e._inuRiseVisual=true;
    const stepping=e.y<.02&&m.id==='iai'&&m.t>0;
    if(stepping){const step=(m.t%4)/4;Q.lLz=.48*Math.sin(step*TAU);Q.lRz=-Q.lLz;drop=.025;}
    const planted=e.y<.02&&m.id!=='slide'&&m.id!=='iaidash'&&!stepping;
    return {id:m.id,phase,planted,stepping,stepTick:m.t,hipDrop:drop,aim:m.id==='iswords'?.45:1,eyes:phase==='wind'?'sq':'open',
      glow:m.id==='iswords'&&phase==='active'?.24:phase==='wind'?clamp(m.chargeTicks/45)*.15:0};
  },
  prepare(rig){const c=cache(rig);rig.n.hips.position.y=c.hipY;rig.n.legL.position.copy(c.legs[0]);rig.n.legR.position.copy(c.legs[1]);},
  settle(rig,e,pose){if(!pose)return;const n=rig.n,c=cache(rig);n.sq.scale.set(1,1,1);n.hips.position.y=c.hipY-pose.hipDrop;
    rig.root.updateMatrixWorld(true);
    rig.st._inuActY=n.act.position.y;
    if(e.y<.02){box.makeEmpty();for(const mesh of c.meshes){if(mesh.visible)box.expandByObject(mesh);}const localMin=box.min.y-rig.root.position.y;
      if(localMin<.012)n.act.position.y+=.012-localMin;
    }
    rig.root.updateMatrixWorld(true);
  },
  renderFeet(rig,e){const pose=rig.st.inuPose;if(!pose||e.y>=.02||(!pose.planted&&!pose.stepping))return;
    const n=rig.n,c=cache(rig),state=rig.st._inuLast;
    n.legL.position.copy(c.legs[0]);n.legR.position.copy(c.legs[1]);rig.root.updateMatrixWorld(true);
    const step=Math.floor(pose.stepTick/2),support=step%2;
    if(pose.stepping&&state.step!==step){
      if(state.step<0)v.copy(state.feet[support]);else point(support===0?n.legL:n.legR,v);
      state.step=step;v.y=.015;state.stepFeet[support].copy(v);
    }
    for(const [i,leg]of [n.legL,n.legR].entries()){
      point(leg,v);
      if(pose.planted)target.copy(state.feet[i]);
      else if(i===support)target.copy(state.stepFeet[i]);
      else{target.copy(v);target.y=.095;}
      if(pose.planted||i===support)target.y=.015;
      leg.parent.worldToLocal(v);leg.parent.worldToLocal(target);leg.position.add(target.sub(v));leg.updateMatrixWorld(true);
      // Contact is the lowest shoe corner, not its centre. Lift only the rigid leg
      // group so rotation never pushes a shoe below the floor; do not stretch it.
      const mesh=leg.children[0];box.copy(mesh.geometry.boundingBox).applyMatrix4(mesh.matrixWorld);
      if(box.min.y<.012){leg.getWorldPosition(v);target.copy(v);target.y+=.012-box.min.y;
        leg.parent.worldToLocal(target);leg.position.copy(target);leg.updateMatrixWorld(true);}
    }
    rig.root.updateMatrixWorld(true);
  },
  cameraFocus(e){if(!e?.published||e.type!=='inu')return null;
    const id=e.publishedMotion?.id;if(id==='shoryu'||id==='idragon')e._inuRiseVisual=true;
    if(e.y<.02&&id!=='shoryu'&&id!=='idragon')e._inuRiseVisual=false;
    return e._inuRiseVisual&&e.y>.1?{y:1.05+e.y}:null;}
};
})();

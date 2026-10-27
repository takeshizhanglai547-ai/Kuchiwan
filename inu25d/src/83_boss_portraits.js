// Portraits reuse the actual boss rigs. The render target and renderer state are
// private; there is no screen capture or external image dependency.
(function(){'use strict';const G=window.G,T=window.THREE,cache=new Map(),box=new T.Box3(),center=new T.Vector3(),size=new T.Vector3(),color=new T.Color();let scene,camera,target;
G.bossPortrait=function(boss,opts={}){const R=G.renderer;if(!R||!boss)return null;const px=Math.max(96,Math.min(512,opts.size||320)),key=boss.type+':'+(boss.form||1)+':'+(boss.phase||0)+':'+px;
 if(cache.has(key))return cache.get(key);
 const previous={target:R.getRenderTarget(),alpha:R.getClearAlpha(),auto:R.autoClear};R.getClearColor(color);let rig;
 try{
  if(!scene){scene=new T.Scene();scene.add(new T.HemisphereLight(0xdcefff,0x8c5b46,1.5));const key=new T.DirectionalLight(0xffe0ae,2.5);key.position.set(-4,6,6);scene.add(key);const rim=new T.DirectionalLight(0xb1bfff,1.7);rim.position.set(4,3,-4);scene.add(rim);camera=new T.PerspectiveCamera(29,1,.05,100);}
  const res=px*2;if(!target||target.width!==res){target?.dispose();target=new T.WebGLRenderTarget(res,res,{depthBuffer:true});target.texture.colorSpace=T.SRGBColorSpace;target.texture.internalFormat='RGBA8';target.isXRRenderTarget=true;}
  rig=G.foes.build(boss.type,boss);G.bossPhaseVisual?.(boss,rig);const ent={...boss,rig,x:0,y:0,z:0,px:0,py:0,pz:0,face:1,anim:'roar',animT:32,animLen:80,animHit:.35,state:'act',flashT:0};
  rig.root.position.set(0,0,0);rig.update?.(ent,G.cfg.TICK);scene.add(rig.root);rig.root.updateMatrixWorld(true);box.setFromObject(rig.root);box.getCenter(center);box.getSize(size);
  const extent=Math.max(size.x,size.y,size.z,.5),distance=extent*.65/Math.tan(camera.fov*Math.PI/360);camera.position.copy(center).add(new T.Vector3(distance*.45,distance*.12,distance*.9));camera.lookAt(center);
  R.setRenderTarget(target);R.setClearColor(0x000000,0);R.autoClear=true;R.clear(true,true,true);R.render(scene,camera);
  const buffer=new Uint8Array(res*res*4);R.readRenderTargetPixels(target,0,0,res,res,buffer);
  const big=document.createElement('canvas');big.width=big.height=res;const bx=big.getContext('2d'),image=bx.createImageData(res,res);
  for(let y=0;y<res;y++)image.data.set(buffer.subarray((res-1-y)*res*4,(res-y)*res*4),y*res*4);bx.putImageData(image,0,0);
  const canvas=document.createElement('canvas');canvas.width=canvas.height=px;const cx=canvas.getContext('2d');cx.imageSmoothingEnabled=true;cx.imageSmoothingQuality='high';cx.drawImage(big,0,0,px,px);
  const url=canvas.toDataURL('image/png');cache.set(key,url);return url;
 }catch(err){G.logError('boss portrait '+boss.type,err);return null;}
 finally{R.setRenderTarget(previous.target);R.setClearColor(color,previous.alpha);R.autoClear=previous.auto;if(rig){scene?.remove(rig.root);rig.dispose?.();}}
};
})();

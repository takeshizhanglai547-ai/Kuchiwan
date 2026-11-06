(function(){'use strict';
const G=window.G;
const styles={
  inu:['slash','#ffe37a'], shima:['shock','#ff9d57'], nuko:['magic','#de9cff'],
  guard8:['guard','#8fe9ff'], watch:['notes','#ff89c6'],
  wanden:['slash','#a7d8ff'], mack:['smoke','#ffd098'],
};
function burst(kind,x,y,z,options){G.fx.burst(kind,x,y,z,options);}
G.heroCombatFx={
  swing(p,a){
    const d=a.def;
    const [base,tint]=styles[p.type]||styles.inu;
    const kind=d.firetrail||d.fireCol?'flame':d.ice?'ice':d.kick?'dustRing':d.fist&&p.type==='inu'?'shock':base;
    const x=p.x+p.face*Math.min(1.1,Math.max(.32,(d.reach||48)/100));
    const scale=d.finisher||d.special?1.12:.78;
    burst(kind,x,p.y+.7,p.z,{color:d.trail||tint,dir:p.face,count:p.type==='wanden'?3:4,scale});
    if(p.type==='wanden'&&(d.iai||d.finisher||d.special))
      burst('slash',x+p.face*.4,p.y+.9,p.z,{color:'#ffffff',dir:p.face,count:2,scale:1.22});
  },
  explosion(x,z,r,color,grenade){
    const scale=G.U.clamp(r*.68,.68,1.9);
    burst('shock',x,.07,z,{color,scale});
    burst('flame',x,.36,z,{count:grenade?8:12,scale});
    burst('smoke',x,.75,z,{count:grenade?10:6,scale,color:'#5c4d52'});
    G.fx.impact(x,.57,z,grenade?'pop':'fire',2,{scale:.8*scale,color});
  },
  firePillar(x,z){
    burst('shock',x,.06,z,{scale:1.15,color:'#ffb13c'});
    for(let i=0;i<5;i++)burst('flame',x,.25+i*.48,z,{count:4,scale:1.25-i*.14});
  },
  hazards(p,hazards,lane,units){
    if(p.type!=='nuko')return;
    for(const h of hazards){
      const x=h.x/units,z=p.z+((h.y??lane)-lane)/units;
      if(h.kind==='ptwister'&&h.t%5===1){
        for(let i=0;i<7;i++){
          const a=h.t*.35+i*1.53,r=.22+i*.17;
          burst('windRibbon',x+Math.cos(a)*r,.28+i*.42,z+Math.sin(a)*r,
            {angle:a,scale:.54+i*.095,color:i%2?'#ddfff5':'#7fe5e4'});
        }
      }
    }
  }
};
})();

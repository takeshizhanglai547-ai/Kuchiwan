'use strict';
const {oracle,candidate,tape}=require('./published_cpu.cjs'),{game,root}=require('./published_harness.cjs');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const data=require('../../evidence/commands-20261024/coverage-source.json'),out=path.join(root,'evidence/commands-20261024');
const heroes=['inu','shima','nuko','guard8','watch','wanden','mack'],cases=[];
const clean=v=>JSON.parse(JSON.stringify(v));
function check(name,hero,events,opts={}){const expected=oracle(hero,events,opts),{g,result}=candidate(hero,events,opts);
 try{assert.deepEqual(clean(result),expected,name);}catch(e){fs.writeFileSync(path.join(out,'parity-failure.json'),JSON.stringify({name,opts,events,expected,actual:result},null,2));throw e;}
 cases.push({name,hero,opts,events,hits:result.hits.length,damage:result.damage,dim:result.dim,clock:result.clock});return g;}
const press=(frame,code)=>[{frame,code,down:true},{frame:frame+1,code,down:false}];
for(const hero of heroes){
 for(const row of data.rows.filter(r=>r.hero===hero&&r.group==='upgrade'))for(const face of [1,-1])check(hero+'.upgrade.'+row.id+'.'+face,hero,tape(row.slot,face),{face,level:row.level,foes:[face*36,face*90,face*160],frames:260});
 for(const face of [1,-1])for(const direction of [null,'ArrowUp','ArrowDown',face>0?'ArrowLeft':'ArrowRight']){
  const events=[...press(1,'KeyL'),...(direction?[{frame:4,code:direction,down:true}]:[]),...press(4,'KeyJ')];
  for(const level of [1,12])check(hero+'.throw.'+direction+'.'+face+'.lv'+level,hero,events,{face,level,foes:[face*36,face*96,face*160],frames:320});
 }
 for(const level of [1,6,12,20])check(hero+'.groundChord.lv'+level,hero,[...press(1,'KeyL'),...press(1,'KeyJ'),...press(45,'KeyJ'),...press(70,'KeyJ')],{level,foes:[36,96,160],frames:320});
 for(const face of [1,-1])for(const key of ['ArrowUp','ArrowDown',face>0?'ArrowRight':'ArrowLeft'])check(hero+'.air.direction.'+key+'.'+face,hero,[{frame:1,code:key,down:true},...press(1,'KeyJ'),...press(14,'KeyJ')],{face,air:true,foes:[face*36,face*90],frames:200});
 for(const level of [1,6,12,20])check(hero+'.charge.lv'+level,hero,[{frame:1,code:'KeyJ',down:true},{frame:60,code:'KeyJ',down:false}],{level,foes:[36,90],frames:240});
 check(hero+'.grab.timeout',hero,press(1,'KeyL'),{foes:[36],frames:260});
 // Follow-up after Guard upper; rapid repeated input and grounded→airborne transitions.
 check(hero+'.jump.repeat',hero,[...press(1,'Space'),...press(9,'Space'),...press(14,'KeyJ'),...press(28,'KeyJ'),...press(40,'KeyK'),...press(100,'KeyJ')],{foes:[36,90],frames:220});
 console.log('PASS '+hero+' upgrades / throws into groups / chord tiers / air directions / charges / release / transitions');
}
check('guard8.upper.followUp','guard8',[...press(1,'KeyL'),{frame:4,code:'ArrowUp',down:true},...press(4,'KeyJ'),...press(15,'KeyJ')],{foes:[36,96,160],frames:240});
// These cases load actual 3D hero rigs and invoke update, keeping Canvas/WebGL out of the test.
const poses=[];
for(const hero of heroes)for(const slot of ['up','fwd','down','dash','hadou','dp','du']){
 const g=game(hero,{actualRig:true,foes:[60]}),events=tape(slot);let count=0,seen=new Set();
 for(let f=1;f<=100;f++){for(const e of events)if(e.frame===f)g.key(e.code,e.down);g.step();const p=g.p,rig=p.rig;
  if(p.publishedMotion){const pose=rig.st.inuPose||rig.st.pubPose;if(pose){seen.add(pose.id);count++;for(const v of Object.values(rig.st.P))if(typeof v==='number')assert.ok(Number.isFinite(v),'nonfinite pose');
   assert.ok(Math.abs(rig.n.sq.scale.x-1)<1e-10&&Math.abs(rig.n.sq.scale.y-1)<1e-10,'dedicated motion stretches body');}}
 }
 assert.ok(count>0,'no dedicated rendered rig pose '+hero+'.'+slot);poses.push({hero,slot,ids:[...seen],frames:count});
}
fs.writeFileSync(path.join(out,'parity-extended.json'),JSON.stringify({kind:'source oracle versus CPU 3D bridge; actual rig checks are CPU only',cases,poses,status:'PASS'},null,2));
console.log('PASS extended source parity '+cases.length+' cases; actual CPU rig motions '+poses.length+' commands');

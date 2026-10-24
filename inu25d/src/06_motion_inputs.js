// Eight-way extensions feed the unchanged native command branches. Original
// cardinal shortcuts remain valid. 236 = quarter-circle, 623 = dragon punch.
(function(){'use strict';const G=window.G;G.extendMotionCommands=function(C){const keys=new Set(),history=[];let last=5;
function record(x,y){const d=y>0?(x>0?3:x<0?1:2):y<0?(x>0?9:x<0?7:8):x>0?6:x<0?4:5;
 if(d===last)return;last=d;history.push({d,f:C.now()});if(history.length>20)history.shift();}
C.motion8=history;
C.key8=(code,down,repeat)=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(code)||repeat)return;if(down)keys.add(code);else keys.delete(code);
 record(Number(keys.has('ArrowRight'))-Number(keys.has('ArrowLeft')),Number(keys.has('ArrowDown'))-Number(keys.has('ArrowUp')));};
C.touch8=(x,y,engaged)=>record(engaged?(x>16?1:x< -16?-1:0):0,engaged?(y>16?1:y< -16?-1:0):0);
C.neutral8=()=>record(0,0);C.consume8=()=>{history.length=0;last=5;};C.reset8=()=>{keys.clear();C.consume8();};
function sequence(digits,total,gap,span=total){const now=C.now()+1,r=history.filter(t=>t.d!==5&&now-t.f<=total),end=r.length-1;if(end<2||r[end].d!==digits[2]||now-r[end].f>9)return null;
 for(let j=end-1;j>=1;j--)if(r[j].d===digits[1]&&r[end].f-r[j].f<=gap)
  for(let k=j-1;k>=0;k--)if(r[k].d===digits[0]&&r[j].f-r[k].f<=gap&&r[end].f-r[k].f<=span&&r.slice(k,end+1).every(t=>digits.includes(t.d)))return [r[k],r[j],r[end]];
 return null;}
C.preciseMotion=(face)=>{const f=face>0?6:4,df=face>0?3:1,dp=sequence([f,2,df],40,20);
 if(dp)return {slot:'dp',events:dp};const ha=sequence([2,df,f],28,20,20),future=Object.create(C);future.now=()=>C.now()+1;return ha?{slot:C.dpReady.call(future,face)?'dp':'hadou',events:ha}:null;};
C.routeMotion=(face)=>{const m=C.preciseMotion(face);if(!m)return null;const f=face>0?1:3;
 // The native simulation still selects, cancels, damages and animates the move.
 const cards=m.slot==='dp'?[f,2,f]:[2,f],times=m.slot==='dp'?m.events:m.events.slice(0,1).concat(m.events.slice(-1));
 C.cardSeq.splice(0,C.cardSeq.length,...cards.map((c,i)=>({c,f:times[i].f})));C.stickRot=-999;return m.slot;};
};G.extendMotionCommands(G.commands);})();

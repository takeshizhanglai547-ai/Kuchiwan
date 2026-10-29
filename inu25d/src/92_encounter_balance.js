// Camp equipment/three helpers increase team damage. Scale durability once per
// spawn, and shorten only discretionary idle/reposition cooldown, never attack telegraphs.
(function(){'use strict';const G=window.G,F=G.foes;if(!F)return;
const spawn=F.spawn,tick=F.tick;
function profile(e){const coop=!!G.coop?.enabled,boss=!!e.def?.boss;return {hp:(boss?1.18:1.25)*(coop?(boss?1.4:1.35):1),cool:coop?(boss?.82:.78):(boss?.88:.84),floor:boss?18:12};}
function apply(e){if(!e||e._campBalance)return e;const b=profile(e);e._campBalance=b;e.hp=Math.max(1,Math.round(e.hp*b.hp));e.maxHp=Math.max(e.hp,Math.round(e.maxHp*b.hp));e.hpMul*=b.hp;return e;}
F.spawn=function(...args){return apply(spawn.apply(this,args));};
F.tick=function(e){const b=e?._campBalance;if(b&&e.cool>b.floor&&!e.dead&&!e.removed&&e.entered!==false&&(e.state==='idle'||e.state==='move')&&!e.pending&&!e.atk&&!e.stun&&!e.grabbedBy&&!(e.punishUntil>G.time.tick)&&!(e.def?.flightAI&&e.skyPhase==='recover')&&!e._phaseEventHold&&!(G.hitStop>0)&&!G.paused&&!G.story?.blocked){e._campCoolCredit=(e._campCoolCredit||0)+(1/b.cool-1);const extra=Math.floor(e._campCoolCredit);if(extra){e.cool=Math.max(b.floor+1,e.cool-extra);e._campCoolCredit-=extra;}}return tick.call(this,e);};
G.encounterBalance={profile,apply};
})();

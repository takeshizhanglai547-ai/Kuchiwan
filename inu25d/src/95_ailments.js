// Status timers count only active battle ticks and belong to the individual fighter.
(function(){'use strict';
const G=window.G;
const rules={poison:{name:'毒',ticks:420,color:'#bd8ce9'},sleep:{name:'眠り',ticks:100,color:'#9ecbff'},slow:{name:'鈍足',ticks:300,color:'#ffd497'}};
function show(p,kind){const rule=rules[kind];G.fx?.text?.(rule.name,0,p.height+.26,0,'say',{ent:p,color:rule.color,life:55});}
G.ailments={
 label:kind=>rules[kind]?.name||'',
 labels(p){return Object.keys(p?.ailments||{}).filter(k=>p.ailments[k]>0).map(k=>rules[k].name).join(' / ');},
 asleep:p=>!!p?.ailments?.sleep,
 speed:p=>p?.ailments?.slow>0?.62:1,
 hit(p,kind,source){
   if(p.dead||source?.team!==1)return;
   if(p.ailments?.sleep)delete p.ailments.sleep;
   const rule=rules[kind];
   if(!rule)return;
   p.ailments||={};
   if(kind==='sleep'&&p._sleepGuard>0)return;
   if(!p.ailments[kind]){show(p,kind);if(kind==='poison')p._poisonPulse=60;}
   p.ailments[kind]=rule.ticks;
   if(kind==='sleep')p._sleepGuard=rule.ticks+120;
 },
 tick(p,native){
   if(p.dead){p.ailments=null;p._sleepGuard=0;return;}
   if(p._sleepGuard>0)p._sleepGuard--;
   if(!p.ailments)return;
   for(const kind of Object.keys(p.ailments)){
     if(kind==='poison'&&--p._poisonPulse<=0){
       p._poisonPulse=60;
       const before=native.hp;
       native.hp=Math.max(1,before-Math.max(1,Math.round(native.maxHp*.035)));
       if(native.hp<before)G.fx?.text?.('−'+(before-native.hp),0,p.height+.14,0,'hurt',{ent:p,color:'#bc80d4'});
     }
     if(--p.ailments[kind]<=0)delete p.ailments[kind];
   }
 },
 clear(p){if(p){p.ailments=null;p._sleepGuard=0;}}
};
G.bus.on('revive',({ent})=>G.ailments.clear(ent));
})();

'use strict';
const {fixture}=require('./model_quality_cpu.cjs'),{root,readModule}=require('./input_cpu.cjs'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const rows=[];
for(const coop of [false,true])for(const type of ['wanhei','ashigaru']){
 const g=fixture(),{G}=g;Object.assign(G.game.diff,{foeHp:1,foeSpeed:1,foeDmg:1,think:1,attackers:3,tactics:true,minWindup:18,attackSpacing:12,punishWindow:28});
 let q=null;if(coop){q=G.playerCtl.create('shima',4.2,.3);G.world.add(q);G.coop={enabled:true,players:[g.p,q],updateInputs(){}};}
 const party=['inu','shima','nuko'];G.camp={profile:()=>({companions:{owned:party,party:party.map((hero,i)=>({hero,leaderSlot:coop&&i===1?1:0}))}})};
 vm.runInContext(readModule('87_companions.js'),g.env.c);vm.runInContext(readModule('92_encounter_balance.js'),g.env.c);G.companions.enter();
 const e=G.foes.spawn(type,g.p.x+.8,0);Object.assign(e,{entered:true,state:'idle',onGround:true,y:0,cool:0,inv:0,hp:1000,maxHp:1000});
 // Long-lived, nonblocking observation target and allies keep the full three-helper
 // worst-case pressure active throughout the sample. Damage/timing remain real.
 for(const p of [g.p,q].filter(Boolean)){p.inv=100000;G.published.native(p).player.inv=100000;}
 for(const [i,c]of G.companions.ents.entries()){c.x=e.x-.6;c.z=(i-1)*.1;c.inv=100000;}
 const samples=[],hits=[];let opportunities=0,commitments=0,longestFree=0,free=0;G.bus.on('companionHit',d=>{if(d.target===e)hits.push({tick:G.time.tick,damage:d.damage,actor:d.ent.type});});
 G.scenes.cpu.tick=()=>{if(G.hitStop>0){G.hitStop--;return;}G.playerCtl.tick(g.p);if(q)G.playerCtl.tick(q);if(!e.publishedReactive)G.foes.tick(e);G.companions.tick();G.combat.tick();for(const ent of [e,...G.companions.ents])if(!ent.publishedReactive)G.phys(ent,G.stage.bounds());if(!e.dead&&!e.stun&&!['hurt','down','dizzy'].includes(e.state)){opportunities++;free++;longestFree=Math.max(longestFree,free);}else free=0;if(e.pending||e.atk)commitments++;if(G.time.tick%30===0)samples.push({tick:G.time.tick,hp:e.hp,state:e.state,stun:e.stun||0,pending:e.pending?.def.id||null});};
 const hp=e.hp;g.step(600);assert.equal(G.companions.ents.length,3);assert(hits.length>=6,'three helpers must exert actual pressure');assert(new Set(hits.map(h=>h.actor)).size===3,'every helper must strike');assert(e.hp<hp,'actual target takes damage');assert(opportunities>60,'foe must regain control often');assert(longestFree>=12,'foe gets a contiguous meaningful action window');assert(commitments>0,'actual AI must commit to an attack, not only recover idle');assert(!e.dead);assert.deepEqual(Array.from(G.errors),[]);for(const p of [g.p,q].filter(Boolean)){const mirror=p._publishedCtx.foes.get(e);assert(mirror,'actual native mirror present');assert.equal(mirror.hp,e.hp,'native HP never restores helper damage');}
 rows.push({coop,type,simulatedTicks:600,hits:hits.length,damage:hp-e.hp,freeActionTicks:opportunities,longestFreeWindow:longestFree,attackCommitmentTicks:commitments,samples});console.log('PASS '+type+' '+(coop?'2P':'1P')+' '+hits.length+' assists, '+opportunities+' free ticks, '+commitments+' attack ticks');
}
const out=path.join(root,'evidence/polish-20261029');fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'companion-pressure.json'),JSON.stringify({status:'PASS_ACTUAL_AI_NATIVE_BRIDGE',rows,limits:'CPU actual foe AI, companions, native mirrors and combat; observation foe HP1000 and allies invulnerable to sustain worst-case3-helper pressure. No human attacks. Not human balance/device acceptance.'},null,2));

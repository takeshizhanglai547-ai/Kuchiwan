'use strict';
const {spawnSync}=require('node:child_process'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const faults=[
 {file:'91_same_screen_coop.js',from:'for(const p of players)scoped(p,()=>G.playerCtl.tick(p));',to:'for(const p of players.slice(0,1))scoped(p,()=>G.playerCtl.tick(p));'},
 {file:'91_same_screen_coop.js',from:'G.player=p;G.input=ch.input;',to:'G.player=p;G.input=primary.input;'},
 {file:'91_same_screen_coop.js',from:'for(let i=0;i<2;i++){const ch=channels[i];',to:'for(let i=0;i<1;i++){const ch=channels[i];'},
 {file:'91_same_screen_coop.js',from:'set?.delete(pid);ch.input.touch',to:'set?.clear();ch.input.touch'},
 {file:'54_command_moves.js',from:'||(G.coop?.enabled&&t._publishedOwner&&t._publishedOwner!==p&&t.grabbedBy>0)',to:''},
 {file:'54_command_moves.js',from:'if(e.controlled)t._publishedOwner=p;',to:'if(false)t._publishedOwner=p;'},
];
for(const m of faults){const r=spawnSync(process.execPath,[path.join(__dirname,'coop_cpu.cjs')],{encoding:'utf8',env:{...process.env,INU25D_CPU_MUTATION:JSON.stringify(m)},maxBuffer:2*1024*1024});assert.equal(r.status,1,'mutation survived '+m.from);assert.match(r.stderr,/AssertionError/,'must fail gameplay assertion, not startup');console.log('PASS detected '+m.file+' '+m.from);}
const out=path.resolve(__dirname,'../../evidence/coop-20261024');fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'coop-mutations.json'),JSON.stringify({status:'PASS',faults},null,2));

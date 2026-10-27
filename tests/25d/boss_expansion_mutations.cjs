'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');const root=path.resolve(__dirname,'../..');
const mutations=[
 {name:'emperor loses third form',file:'36_bosses_b.js',from:'if((e.form||1)<3)',to:'if((e.form||1)<2)'},
 {name:'form transition has no cinematic',file:'36_bosses_b.js',from:"G.bus.emit('bossForm',{boss:e,form:e.form});",to:''},
 {name:'phase visual missing',file:'82_story_events.js',from:'parent.add(group);',to:'/* unattached phase visual */'},
 {name:'invalid old event releases newform hold',file:'82_story_events.js',from:"(!e.boss._phaseEventKey||e.boss._phaseEventKey===e.key)",to:'true'},
 {name:'thirdform falls back to old model',file:'36_bosses_b.js',from:'e.form===3?buildSovereign():buildKnight()',to:'buildKnight()'},
];const results=[];
for(const m of mutations){const s=fs.readFileSync(path.join(root,'inu25d/src',m.file),'utf8');assert(s.includes(m.from),'mutation target missing '+m.name);new vm.Script(s.replace(m.from,m.to));const r=spawnSync(process.execPath,[path.join(__dirname,'boss_expansion_cpu.cjs')],{cwd:root,env:{...process.env,INU25D_CPU_MUTATION:JSON.stringify(m)},encoding:'utf8',timeout:120000});const killed=r.status===1&&r.stderr.includes('AssertionError')&&!r.stderr.includes('mutation target missing');assert(killed,m.name+' survived or failed fixture: '+r.stderr.slice(-600));results.push({name:m.name,killed});console.log('PASS detected '+m.name);}
const out=path.join(root,'evidence/expansion-20261026');fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'boss-expansion-mutations.json'),JSON.stringify({status:'PASS',results},null,2));

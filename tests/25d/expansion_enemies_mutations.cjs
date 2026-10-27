'use strict';const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');const root=path.resolve(__dirname,'../..'),results=[];
for(const m of [
 {name:'sniper warning shortened',file:'32_expansion_foes.js',from:'H.attack(e,SNIPER_SHOT,54)',to:'H.attack(e,SNIPER_SHOT,4)',suite:'expansion_enemies_cpu.cjs'},
 {name:'sky grab opportunity removed',file:'32_expansion_foes.js',from:'e.skyT>=108',to:'e.skyT>=8',suite:'expansion_enemies_cpu.cjs'},
 {name:'armour normal damage not reduced',file:'50_combat.js',from:'return info.grab?1:.05;',to:'return 1;',suite:'expansion_enemies_cpu.cjs'},
 {name:'new rig body absent',file:'32_expansion_foes.js',from:'root.add(body);',to:'',suite:'expansion_enemies_cpu.cjs'},
 {name:'co-op nearest target ignored',file:'30_foes.js',from:'if(G.coop?.enabled){let best=',to:'if(false){let best=',suite:'expansion_enemies_cpu.cjs'},
 {name:'bonus stage soundtrack duplicated',file:'40_stage.js',from:"bgm:'stage8'",to:"bgm:'stage7'",suite:'expansion_stages_cpu.cjs'},
 {name:'stage reinforcement queue lost',file:'40_stage.js',from:'a.q = a.q.concat(makeQueue(a.then, a.qt + 20));',to:'a.q = a.q;',suite:'expansion_stages_cpu.cjs'},
]){const code=fs.readFileSync(path.join(root,'inu25d/src',m.file),'utf8');assert(code.includes(m.from),'missing target '+m.name);new vm.Script(code.replace(m.from,m.to));const r=spawnSync(process.execPath,[path.join(__dirname,m.suite)],{cwd:root,encoding:'utf8',timeout:120000,env:{...process.env,INU25D_CPU_MUTATION:JSON.stringify(m)}});const killed=r.status===1&&r.stderr.includes('AssertionError')&&!r.stderr.includes('mutation target missing');assert(killed,m.name+' not detected: '+r.stderr.slice(-400));results.push({name:m.name,killed});console.log('PASS detected '+m.name);}
const out=path.join(root,'evidence/expansion-20261026');fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'enemy-stage-mutations.json'),JSON.stringify({status:'PASS',results},null,2));

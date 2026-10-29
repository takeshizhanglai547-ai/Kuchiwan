'use strict';const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process'),root=path.resolve(__dirname,'../..'),results=[];
for(const [name,file,from,to]of [
 ['tool purchase does not debit wallet','85_camp_state.js','next.coins-=row.cost;','next.coins-=0;'],
 ['tool use does not consume stock','85_camp_state.js','next.tools[id]--;','next.tools[id]-=0;'],
 ['failed storage leaves healing applied','85_camp_state.js','if(!store(next)){n.restoreTool(before);return','if(!store(next)){return'],
 ['tool inventory cap removed','85_camp_state.js','if((s.tools[id]||0)>=9)','if((s.tools[id]||0)>=99)'],
 ['original potion healing amount drifts','52_published_fighter.js','p.hp+60','p.hp+61'],
]){const code=fs.readFileSync(path.join(root,'inu25d/src',file),'utf8');assert(code.includes(from),'missing target '+name);new vm.Script(code.replace(from,to));const r=spawnSync(process.execPath,[path.join(__dirname,'tools_state_cpu.cjs')],{cwd:root,encoding:'utf8',timeout:120000,env:{...process.env,INU25D_CPU_MUTATION:JSON.stringify({file,from,to})}});const killed=r.status===1&&r.stderr.includes('AssertionError')&&!r.stderr.includes('mutation target missing');assert(killed,name+' not detected '+r.stderr.slice(-500));results.push({name,killed});console.log('PASS detected '+name);}
const out=path.join(root,'evidence/polish-20261029');fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'tools-state-mutations.json'),JSON.stringify({status:'PASS',results},null,2));

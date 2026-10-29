'use strict';const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process'),root=path.resolve(__dirname,'../..'),results=[];
for(const [name,file,from,to]of [
 ['native original weapon price drifts','52_published_fighter.js','cost:id===d?0:weaponPrice(id)','cost:id===d?0:weaponPrice(id)+1'],
 ['purchase does not debit wallet','85_camp_state.js','next.coins-=cost;','next.coins-=0;'],
 ['failed storage leaves newly equipped weapon','85_camp_state.js','if(!store(next)){n.restoreEquipment(before);return','if(!store(next)){return'],
 ['stage clear credited repeatedly','85_camp_state.js','delta=Math.max(0,earned-credited)','delta=Math.max(0,earned)'],
 ['same-hero P2 overwrites P1 equipped slot','85_camp_state.js',"next.equipped[(p.coopSlot===1?1:0)+':'+p.type]=id","next.equipped['0:'+p.type]=id"],
 ['native carry exposes live inventory arrays','52_published_fighter.js','Array.isArray(player[k])?player[k].slice():player[k]','player[k]'],
 ['native restore aliases carry inventory arrays','52_published_fighter.js','Array.isArray(carry[k])?carry[k].slice():carry[k]','carry[k]'],
]){const code=fs.readFileSync(path.join(root,'inu25d/src',file),'utf8');assert(code.includes(from),'missing target '+name);new vm.Script(code.replace(from,to));const r=spawnSync(process.execPath,[path.join(__dirname,'camp_state_cpu.cjs')],{cwd:root,encoding:'utf8',timeout:120000,env:{...process.env,INU25D_CPU_MUTATION:JSON.stringify({file,from,to})}});const killed=r.status===1&&r.stderr.includes('AssertionError')&&!r.stderr.includes('mutation target missing');assert(killed,name+' not detected '+r.stderr.slice(-500));results.push({name,killed});console.log('PASS detected '+name);}
const out=path.join(root,'evidence/polish-20261028');fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'camp-state-mutations.json'),JSON.stringify({status:'PASS',results},null,2));

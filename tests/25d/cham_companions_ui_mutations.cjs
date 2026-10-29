'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'../..'),file='86_cham_shop.js',code=fs.readFileSync(path.join(root,'inu25d/src',file),'utf8'),results=[];
for(const [name,from,to]of [
 ['duplicate draw lock removed','if(!s||s.busy)return;setBusy(true);','if(!s)return;setBusy(true);'],
 ['P2 companion assignment ignored','G.camp.party(hero,slot)','G.camp.party(hero,0)'],
 ['incorrect displayed shared party cap','max=G.companions?.maxActive||3','max=6'],
 ['incorrect displayed uniform odds','(100/Math.max(1,pool.length)).toFixed(2)','(100/Math.max(1,pool.length)).toFixed(0)'],
 ['saved draw result hidden','if(data.lastDraw?.hero)','if(false)'],
 ['pending shop survives external scene','if(active)close(false,true)','if(active)close(false)'],
 ['hidden selectors receive keyboard focus','if(n.hidden)return false;','']
]){assert(code.includes(from),'missing mutation '+name);new vm.Script(code.replace(from,to));const r=spawnSync(process.execPath,[path.join(__dirname,'cham_companions_ui_cpu.cjs')],{cwd:root,encoding:'utf8',timeout:60000,env:{...process.env,INU25D_CPU_MUTATION:JSON.stringify({file,from,to})}});const killed=r.status===1&&r.stderr.includes('AssertionError')&&!r.stderr.includes('mutation target missing');assert(killed,name+' survived: '+r.stderr.slice(-500));results.push({name,killed});console.log('PASS detected '+name);}
const out=path.join(root,'evidence/polish-shop-20261028');fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'cham-companions-ui-mutations.json'),JSON.stringify({status:'PASS',results},null,2));

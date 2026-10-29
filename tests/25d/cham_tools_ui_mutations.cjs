'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'../..'),file='86_cham_shop.js',code=fs.readFileSync(path.join(root,'inu25d/src',file),'utf8'),results=[];
for(const [name,from,to]of [
 ['P2 recovery applied toP1','G.camp.useTool(p,row.id)','G.camp.useTool(s.players[0],row.id)'],
 ['client supplied purchase price','G.camp.purchaseTool(row.id)','G.camp.purchaseTool(row.id,row.cost)'],
 ['purchase silently uses inventory','G.camp.purchaseTool(row.id)','(G.camp.purchaseTool(row.id),G.camp.useTool(p,row.id))'],
 ['tool target picker hidden',"for(const e of s.playerTools)e.hidden=s.tab==='companions';","for(const e of s.playerTools)e.hidden=s.tab!=='weapons';"],
 ['tool transaction lock removed',"if(!s||s.busy)return;const p=s.players[s.index];if(action==='use'", "if(!s)return;const p=s.players[s.index];if(action==='use'"],
 ['full target use button enabled','const usable=!!p&&count>0&&row.canUse===true','const usable=!!p&&count>0'],
 ['incorrect manju life claim',"element('p',card,row.description||'');","element('p',card,row.id==='manju'?'残機を1回補充':row.description||'');"]
]){assert(code.includes(from),'missing mutation '+name);new vm.Script(code.replace(from,to));const r=spawnSync(process.execPath,[path.join(__dirname,'cham_tools_ui_cpu.cjs')],{cwd:root,encoding:'utf8',timeout:60000,env:{...process.env,INU25D_CPU_MUTATION:JSON.stringify({file,from,to})}});const killed=r.status===1&&r.stderr.includes('AssertionError')&&!r.stderr.includes('mutation target missing');assert(killed,name+' survived: '+r.stderr.slice(-500));results.push({name,killed});console.log('PASS detected '+name);}
const out=path.join(root,'evidence/polish-shop-20261028');fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'cham-tools-ui-mutations.json'),JSON.stringify({status:'PASS',results},null,2));

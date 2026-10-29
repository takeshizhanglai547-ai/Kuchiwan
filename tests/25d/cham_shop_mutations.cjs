'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'../..'),file='86_cham_shop.js',code=fs.readFileSync(path.join(root,'inu25d/src',file),'utf8'),results=[];
for(const [name,from,to]of [
 ['second player input not released','G.coop?.clearInputs?.();',''],
 ['rapid click transaction lock removed','if(!s||s.busy)return;const p=s.players[s.index];','if(!s)return;const p=s.players[s.index];'],
 ['cancel advances next stage','if(finished&&!s.done)','if(!s.done)'],
 ['P2 selection ignored','active.index=Math.max(0,Math.min(players.length-1,Number(pick.value)||0));','active.index=0;'],
 ['UI supplies trusted purchase price','G.camp.purchase(p,row.id)','G.camp.purchase(p,row.id,row.cost)'],
 ['shop opens during combat',"G.sceneName!=='play'||!G.scenes.play?.cleared||",'']
]){assert(code.includes(from),'missing mutation '+name);new vm.Script(code.replace(from,to));const r=spawnSync(process.execPath,[path.join(__dirname,'cham_shop_ui_cpu.cjs')],{cwd:root,encoding:'utf8',timeout:60000,env:{...process.env,INU25D_CPU_MUTATION:JSON.stringify({file,from,to})}});const killed=r.status===1&&r.stderr.includes('AssertionError')&&!r.stderr.includes('mutation target missing');assert(killed,name+' survived: '+r.stderr.slice(-500));results.push({name,killed});console.log('PASS detected '+name);}
const out=path.join(root,'evidence/polish-shop-20261028');fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'cham-ui-mutations.json'),JSON.stringify({status:'PASS',results},null,2));

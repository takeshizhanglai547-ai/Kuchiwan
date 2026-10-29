'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'../..'),file='86_cham_shop.js',code=fs.readFileSync(path.join(root,'inu25d/src',file),'utf8'),results=[];
for(const [name,from,to]of [
 ['inventory opens in activecombat/gameover',"if(inventory&&(G.sceneName!=='play'||!G.paused||G.scenes.play?.cleared||G.scenes.play?.over||G.story?.blocked))return false;",''],
 ['closing inventory resumes combat','G.scenes.play.pause(s.priorPaused)','G.scenes.play.pause(false)'],
 ['buy buttons appear in pause inventory','if(!s.inventory){const buy=','if(true){const buy='],
 ['stale tool purchase allowed',"if(active?.inventory&&action!=='use')return;",''],
 ['stale weapon purchase allowed','if(active?.inventory)return;const s=active;if(!s||s.busy)return;const p=s.players[s.index];','const s=active;if(!s||s.busy)return;const p=s.players[s.index];'],
 ['stale gacha draw allowed','if(active?.inventory)return;const s=active;if(!s||s.busy)return;setBusy(true);','const s=active;if(!s||s.busy)return;setBusy(true);']
]){assert(code.includes(from),'missing mutation '+name);new vm.Script(code.replace(from,to));const r=spawnSync(process.execPath,[path.join(__dirname,'cham_pause_tools_ui_cpu.cjs')],{cwd:root,encoding:'utf8',timeout:60000,env:{...process.env,INU25D_CPU_MUTATION:JSON.stringify({file,from,to})}});const killed=r.status===1&&r.stderr.includes('AssertionError')&&!r.stderr.includes('mutation target missing');assert(killed,name+' survived: '+r.stderr.slice(-500));results.push({name,killed});console.log('PASS detected '+name);}
const out=path.join(root,'evidence/polish-shop-20261028');fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'cham-pause-tools-ui-mutations.json'),JSON.stringify({status:'PASS',results},null,2));

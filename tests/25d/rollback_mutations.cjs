'use strict';
const {spawnSync}=require('node:child_process'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),vm=require('node:vm');
const root=path.resolve(__dirname,'../..'),results=[];
for(const m of [
 {name:'incorrect restored speed',file:'55_player.js',from:'BASE_SPD = 0.078',to:'BASE_SPD = 0.156',suite:'rollback_cpu.cjs'},
 {name:'lost original save read',file:'90_game.js',from:"localStorage.getItem(SAVE_KEY)",to:"localStorage.removeItem(SAVE_KEY)",suite:'rollback_cpu.cjs'},
 {name:'touch remains held through app menu',file:'inu25d/pwa/runtime.js',from:"t[k]=typeof t[k]==='boolean'?false:0",to:'t[k]=t[k]',suite:'pwa_ui_cpu.cjs',pwa:true},
 {name:'rollback worker stays waiting at title',file:'inu25d/pwa/runtime.js',from:"if(!G||G.sceneName!=='play')requested=true;",to:'',suite:'pwa_ui_cpu.cjs',pwa:true}
]){const file=path.join(root,m.pwa?m.file:'inu25d/src/'+m.file),code=fs.readFileSync(file,'utf8');assert(code.includes(m.from),'missing mutation '+m.name);if(!m.pwa)new vm.Script(code.replace(m.from,m.to));const env={...process.env,[m.pwa?'INU25D_PWA_MUTATION':'INU25D_CPU_MUTATION']:JSON.stringify(m)};const r=spawnSync(process.execPath,[path.join(__dirname,m.suite)],{cwd:root,encoding:'utf8',env,timeout:60000});const killed=r.status===1&&r.stderr.includes('AssertionError')&&!r.stderr.includes('mutation target missing');assert(killed,m.name+' not detected: '+r.stderr.slice(-500));results.push({name:m.name,killed});console.log('PASS detected '+m.name);}
const out=path.join(root,'evidence/rollback-20261026');fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'mutations.json'),JSON.stringify({status:'PASS',results},null,2));

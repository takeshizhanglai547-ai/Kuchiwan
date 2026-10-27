'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'../..'),code=fs.readFileSync(path.join(root,'inu25d/src/70_audio.js'),'utf8'),results=[];
for(const [name,from,to]of [
 ['same transposed melody in two stages','const cloneScore=s=>','SONGS.stage9=JSON.parse(JSON.stringify(SONGS.stage8));SONGS.stage9.key+=12;const cloneScore=s=>'],
 ['retained silent graphs on theme churn','for(const P of E.players.slice()) if(P.stopping) disposePlayer(P);',''],
 ['music voice budget removed','if(!E.offline && P && E.liveMusic>=MAX_MUSIC_VOICES) return;',''],
 ['third emperor form routes to old music',"form>=3?'final3'","form>=3?'final2'"],
 ['paused transport schedules new voices','!P.stopping && !P.done && !musicPaused','!P.stopping && !P.done']
]){assert(code.includes(from),'missing mutation '+name);new vm.Script(code.replace(from,to));const r=spawnSync(process.execPath,[path.join(__dirname,'audio_expansion_cpu.cjs')],{cwd:root,encoding:'utf8',timeout:60000,env:{...process.env,INU25D_AUDIO_MUTATION:JSON.stringify({from,to})}});const killed=r.status===1&&r.stderr.includes('AssertionError')&&!r.stderr.includes('mutation target missing');assert(killed,name+' survived: '+r.stderr.slice(-500));results.push({name,killed});console.log('PASS detected '+name);}
const out=path.join(root,'evidence/expansion-audio');fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'audio-mutations.json'),JSON.stringify({status:'PASS',results},null,2));

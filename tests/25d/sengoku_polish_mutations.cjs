'use strict';const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process'),root=path.resolve(__dirname,'../..'),file='40_stage.js',code=fs.readFileSync(path.join(root,'inu25d/src',file),'utf8'),results=[];
for(const [name,from,to]of [
 ['curved roof replaced by flat slab','sengokuRoof:sengokuRoof()','sengokuRoof:g.box(2,.1,2)'],
 ['roof faces turned inward','if(side)idx.push(a,b,c,b,d,c);else idx.push(a,c,b,b,c,d);','if(side)idx.push(a,c,b,b,c,d);else idx.push(a,b,c,b,d,c);'],
 ['multi-storey castle details removed','const floors=n%2?2:3;','const floors=0;'],
 ['painted road details lost',"ground:'sengoku',scenery:'sengoku'","ground:'cobble',scenery:'sengoku'"],
 ['lantern glow halo layer lost','this.halos.push(x, y, z, col, size);','/* halo omitted */'],
]){assert(code.includes(from),'missing target '+name);new vm.Script(code.replace(from,to));const r=spawnSync(process.execPath,[path.join(__dirname,'sengoku_polish_cpu.cjs')],{cwd:root,encoding:'utf8',timeout:60000,env:{...process.env,INU25D_CPU_MUTATION:JSON.stringify({file,from,to})}});const killed=r.status===1&&r.stderr.includes('AssertionError')&&!r.stderr.includes('mutation target missing');assert(killed,name+' not detected '+r.stderr.slice(-450));results.push({name,killed});console.log('PASS detected '+name);}
const out=path.join(root,'evidence/polish-20261028');fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'sengoku-mutations.json'),JSON.stringify({status:'PASS',results},null,2));

'use strict';
const {spawnSync}=require('node:child_process'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../..'),file='54_command_moves.js',code=fs.readFileSync(path.join(root,'inu25d/src',file),'utf8');
const mutations=[
 ['walk too fast','G.input.x*p.spd*S*slow*walkBuff(r)','G.input.x*p.spd*S*slow*walkBuff(r)*1.5'],
 ['missing depth','G.input.z*p.spd*','0*G.input.z*p.spd*'],
 ['double innate trait','const walkBuff=r=>(r.spdMul||1)/','const walkBuff=r=>(r.spdMul||1)*'],
 ['moving shots follow shooter','for(const q of ctx.ref.projectiles)q.y-=delta;',''],
 ['flat native projectile boundary','laneClamp(y){if(ctx.referenceMovement)return undefined;','laneClamp(y){return undefined;if(ctx.referenceMovement)return undefined;'],
 ['two native advances per tick','G.commandInputs?.before(p,ctx);ctx.ref.step();','G.commandInputs?.before(p,ctx);ctx.ref.step();ctx.ref.step();']
],results=[];
for(const [name,from,to]of mutations){assert(code.includes(from),'missing target '+name);new vm.Script(code.replace(from,to));const r=spawnSync(process.execPath,[path.join(__dirname,'movement_cpu.cjs')],{cwd:root,encoding:'utf8',timeout:120000,env:{...process.env,INU25D_CPU_MUTATION:JSON.stringify({file,from,to})}});const killed=r.status===1&&r.stderr.includes('AssertionError')&&!r.stderr.includes('mutation target missing');results.push({name,killed,status:r.status});assert(killed,name+' not detected: '+r.stderr.slice(-500));console.log('PASS detected '+name);}
fs.writeFileSync(path.join(root,'evidence/movement-20261025/movement-mutations.json'),JSON.stringify({kind:'In-memory syntax-checked regressions caught by production behavioral assertions',results},null,2));

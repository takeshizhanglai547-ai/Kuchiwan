'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'../..'),out=path.join(root,'evidence/commands-20261013/stage2');
const mutations=[
  {name:'reported applied damage doubled',file:'52_published_fighter.js',from:'_pubHooks.hit(e,before-e.hp,args,context)',to:'_pubHooks.hit(e,(before-e.hp)*2,args,context)',suite:'published_cpu.cjs',filter:'inu.air.hadou.1'},
  {name:'enemy reaction progression omitted',file:'52_published_fighter.js',from:'saveInput(player.in);_pubReactions();',to:'saveInput(player.in);',suite:'published_edges.cjs'},
  {name:'stock HUD disconnected from actual stock',file:'54_command_moves.js',from:'p.dim=r.dim;',to:'p.dim=0;',suite:'published_cpu.cjs',filter:'inu.ult.1.2.false'},
  {name:'grab hold fails to suspend target AI',file:'54_command_moves.js',from:'if(!e.protected&&e.grabbedBy>0)e.controlled=true;',to:'if(false)e.controlled=true;',suite:'published_edges.cjs'},
  {name:'damage replays a physically held pending key',file:'54_command_moves.js',from:'G.input.clearEdges(true);ctx.ref.clearEdges();',to:'G.input.clearEdges(false);ctx.ref.clearEdges();',suite:'published_edges.cjs'},
  {name:'input reset leaves native queued press alive',file:'54_command_moves.js',from:"G.bus.on('inputReset',d=>P.resetInput(d.input?.player||G.player));",to:"G.bus.on('inputReset',()=>{});",suite:'published_edges.cjs'},
  {name:'entering foes become grabbable',file:'54_command_moves.js',from:"e.protected=t.intangible||t.inv>0||(t.state==='spawn'&&!t.hittableSpawn)||(G.coop?.enabled&&t._publishedOwner&&t._publishedOwner!==p&&t.grabbedBy>0);",to:'e.protected=false;',suite:'published_edges.cjs'},
  {name:'existing props no longer receive attacks',file:'54_command_moves.js',from:'props(p,ctx,a);',to:'/* props omitted */',suite:'published_edges.cjs'},
];
const results=[];
for(const m of mutations){const code=fs.readFileSync(path.join(root,'inu25d/src',m.file),'utf8');if(!code.includes(m.from))throw Error('missing mutation target '+m.name);
  new vm.Script(code.replace(m.from,m.to));
  const r=spawnSync(process.execPath,[path.join(__dirname,m.suite),...(m.filter?[m.filter]:[])],{cwd:root,encoding:'utf8',timeout:30000,env:{...process.env,INU25D_CPU_MUTATION:JSON.stringify(m)}});
  const killed=r.status===1&&r.stderr.includes('AssertionError')&&!r.stderr.includes('mutation target missing');
  results.push({name:m.name,killed,status:r.status,error:r.error?.message,assertion:r.stderr.split('\n').find(s=>s.includes('AssertionError'))});
  console.log((killed?'PASS killed ':'FAIL ')+m.name);if(!killed)process.exitCode=1;
}
fs.writeFileSync(path.join(out,'mutations.json'),JSON.stringify({kind:'current published bridge; in-memory source mutation, syntax checked before execution',results},null,2));

'use strict';
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.resolve(__dirname,'../..');
module.exports=function reference(body){
  const c={require,process:{env:{NM_TARGET:path.join(root,'beltaction.html')}},console:{...console,warn(){}},
    performance:{now:()=>0},setTimeout(){},setInterval(){},clearInterval(){},Buffer};c.global=c;
  vm.createContext(c);
  const harness=fs.readFileSync(path.join(root,'tests/nm_head.js'),'utf8');
  vm.runInContext(harness+`\nglobal.events={};global.addEventListener=(type,fn)=>{(global.events[type]||(global.events[type]=[])).push(fn);};\n`+
    'eval(code + '+JSON.stringify('\n;'+body)+' );',c,{timeout:10000});
  return JSON.parse(JSON.stringify(c.result));
};
if(require.main===module)console.log(JSON.stringify(module.exports(`sndOn=false;setupRoster('inu');player=players[0];resetPlayer(player,true);state='play';enemies=[];projectiles=[];hazards=[];useInput(player.in);global.result={weapon:player.weapon,state:player.state};`)));

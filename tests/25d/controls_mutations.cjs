'use strict';
const {spawnSync}=require('node:child_process'),path=require('node:path'),fs=require('node:fs'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../..'),faults=[
 {file:'56_control_actions.js',from:'C.routeMotion?.(r.facing)',to:'void 0',suite:'controls_cpu.cjs'},
 {file:'56_control_actions.js',from:"const dedicated=I.btn.ult.pressed||I.btn.special.pressed;",to:'const dedicated=false;',suite:'controls_cpu.cjs'},
 {file:'56_control_actions.js',from:'else if(ult&&r.dim<ctx.ref.cost(airUlt))',to:'else if(false)',suite:'controls_cpu.cjs'},
 {file:'52_published_fighter.js',from:"if(action==='release'){releaseGrab();_pubDisplay=null;return true;}",to:"if(action==='release'){return true;}",suite:'controls_cpu.cjs'},
 {file:'52_published_fighter.js',from:'if(player.grabEnemy===e){e.dead=true;e.grabbedBy=0;releaseGrab();_pubDisplay=null;}',to:'if(false){}',suite:'controls_cpu.cjs'},
 {file:'80_ui.js',from:" || ['special','ult'].includes(hit.k)||['special','ult'].includes(cur.k)",to:'',suite:'controls_ui_cpu.cjs'},
];
for(const m of faults){const r=spawnSync(process.execPath,[path.join(__dirname,m.suite)],{encoding:'utf8',env:{...process.env,INU25D_CPU_MUTATION:JSON.stringify(m)},maxBuffer:2*1024*1024});assert.notEqual(r.status,0,'mutation survived '+m.file);assert.match(r.stderr,/AssertionError/,'must fail behavior '+m.file);m.detected=true;console.log('PASS detected '+m.file+' '+m.from.slice(0,45));}
fs.writeFileSync(path.join(root,'evidence/input-controls-20261024/controls-mutations.json'),JSON.stringify({status:'PASS',faults},null,2));

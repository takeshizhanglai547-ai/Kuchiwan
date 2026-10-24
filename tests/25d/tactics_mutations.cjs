'use strict';
const {spawnSync}=require('node:child_process'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../..'),mutations=[
 {file:'30_foes.js',from:'tactical?d.minWindup:0',to:'0'},
 {file:'30_foes.js',from:'h.release(e);h.wait(e,6);return false;',to:'h.wait(e,6);return false;'},
 {file:'30_foes.js',from:'e.punishUntil=G.time.tick+diff().punishWindow',to:'e.punishUntil=G.time.tick'},
];
for(const m of mutations){const r=spawnSync(process.execPath,[path.join(__dirname,'tactics_cpu.cjs')],{encoding:'utf8',env:{...process.env,INU25D_CPU_MUTATION:JSON.stringify(m)}});
 assert.notEqual(r.status,0);assert.match(r.stderr,/AssertionError/);m.detected=true;}
fs.writeFileSync(path.join(root,'evidence/commands-20261024/tactics-mutations.json'),JSON.stringify(mutations,null,2));
console.log('PASS three difficulty regressions detected by behavior assertions');

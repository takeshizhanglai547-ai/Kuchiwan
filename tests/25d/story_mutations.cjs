'use strict';
const {spawnSync}=require('node:child_process'),path=require('node:path'),fs=require('node:fs'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../..'),faults=[
 {file:'35_bosses_a.js',from:'e.hp < e.maxHp*0.5',to:'e.hp <= e.maxHp*0.5'},
 {file:'36_bosses_b.js',from:'e.hp < e.maxHp*0.5',to:'e.hp <= e.maxHp*0.5'},
 {file:'00_core.js',from:"if(G.sceneName==='play'&&G.story?.blocked)",to:'if(false)'},
 {file:'82_story_events.js',from:'if(seen.has(e.key))return false;',to:'if(false)return false;'},
 {file:'82_story_events.js',from:'if(G.player?.dead)return false;',to:'if(false)return false;'},
 {file:'82_story_events.js',from:'active.age<30)return false;',to:'active.age<0)return false;'},
 {file:'50_combat.js',from:'if(G.story?.blocked)return false;',to:'if(false)return false;'},
 {file:'82_story_events.js',from:'function valid(e){return !e.boss||',to:'function valid(e){return true||!e.boss||'},
];
for(const m of faults){const r=spawnSync(process.execPath,[path.join(__dirname,'story_cpu.cjs')],{encoding:'utf8',env:{...process.env,INU25D_CPU_MUTATION:JSON.stringify(m)},maxBuffer:1024*1024});assert.notEqual(r.status,0,'mutation survived '+m.file);assert.match(r.stderr,/AssertionError/,'must fail behavior, not startup '+m.file);m.detected=true;}
fs.writeFileSync(path.join(root,'evidence/phase-events-20261024/story-mutations.json'),JSON.stringify({status:'PASS',faults},null,2));console.log('PASS eight cinematic/threshold regressions detected by behavior assertions');

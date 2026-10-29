'use strict';
// Reuse the existing CPU triangle rasterizer without changing its source or
// accessing a browser/GPU/screen. These pixels are a model proxy only.
const fs=require('node:fs'),path=require('node:path'),{createRequire}=require('node:module'),root=path.resolve(__dirname,'../..'),tool=path.join(root,'tools/render25d-enemy-model-proxy.cjs');let code=fs.readFileSync(tool,'utf8');
code=code.replace("require('../tests/25d/model_quality_cpu.cjs')",'require('+JSON.stringify(path.join(__dirname,'kosodoro_cpu.cjs'))+')');
code=code.replace(/const panels=.*;\r?\n/,'const panels='+JSON.stringify([['kosodoro','idle',false,'KOSODORO IDLE'],['kosodoro','warn',false,'STEAL WINDUP'],['kosodoro','snatch',false,'SNATCH'],['kosodoro','full',false,'STOLEN POWER'],['kosodoro','dash',false,'DASH'],['kosodoro','hurt',false,'HIT']])+';\n');
code=code.replace("'../evidence/model-polish-20261028'","'../evidence/polish-shop-20261028'").replace("const name=actions?'enemy-model-action-comparison':poses?'enemy-model-animation-poses':'enemy-model-before-after';","const name='kosodoro-model-proxy';").replace('actual THREE skinned-mesh triangle software rasterization; original31models vs saved752 baseline and articulated models','actual THREE articulated Kosodoro mesh triangles across six poses');
new Function('require','__dirname','process',code)(createRequire(tool),path.dirname(tool),process);

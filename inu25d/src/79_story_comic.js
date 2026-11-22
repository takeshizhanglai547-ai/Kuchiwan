// Resolution-independent comic art, shared by all chapter intros and endings.
(function(){'use strict';
const G=window.G,ink='#594656';
const palettes={
 inu:['#fff1d3','#dac299','#749dbb','#bd625e','#d8b15c'],
 shima:['#dfb68c','#a97860','#73a1b4','#6489a4','#e7bf72'],
 nuko:['#fff4df','#dbcfc5','#ad8cc0','#796491','#cba8dc'],
 guard8:['#e5bf88','#b28c6b','#8b9aab','#657686','#d1b47f'],
 watch:['#fff0da','#c6a28b','#89b5bb','#4f808f','#adcdd2'],
 wanden:['#f0ddc4','#ba997c','#a57578','#786175','#d5c6ac'],
 mack:['#e7c596','#b59171','#cc9369','#886d73','#d9ba72'],
 kuro:['#3b3745','#6e6171','#696471','#4a364b','#b8a5b2']
};
const star=(x,y,s=1,color='#f3c887')=>'<path d="M0-13 4-4 13 0 4 4 0 13-4 4-13 0-4-4Z" transform="translate('+x+' '+y+') scale('+s+')" fill="'+color+'" stroke="none"/>';
function character(id,{happy=false,pose='ready',small=false}={}){
 const [fur,ears,cloth,cape,trim]=palettes[id]||palettes.inu;
 const black=id==='kuro',flop=['inu','shima','nuko','wanden','mack','guard8'].includes(id);
 const muzzle=black?'#b4a3ac':'#fff5e4',line=black?'#282631':ink;
 const walking=pose==='walk',celebrate=pose==='cheer';
 const eyes=happy?'<path d="M-30-23q8-12 16 0m28 0q8-12 16 0" fill="none" stroke-width="4.3"/>':
  '<g fill="'+line+'" stroke="none"><ellipse cx="-22" cy="-23" rx="6.4" ry="9"/><ellipse cx="22" cy="-23" rx="6.4" ry="9"/></g><g fill="#fffef7" stroke="none"><circle cx="-24" cy="-27" r="2.4"/><circle cx="20" cy="-27" r="2.4"/><circle cx="-20" cy="-19" r="1"/><circle cx="24" cy="-19" r="1"/></g>';
 const weapon=(()=>{
  if(id==='kuro')return '<g transform="translate(48 54) rotate(24)"><path d="M-11 17V-90l12-24 12 24V17Z" fill="#b7b2c0"/><path d="M-6 10V-89l8-15 6 15V10" fill="#6e6c7b" stroke="none"/><path d="M-11-63 10-72m-20 43 19-9" stroke="#d1c8d0" stroke-width="2"/><path d="M-22 20h46v8h-46Z" fill="#a496a6"/><path d="M-5 29h12v31h-12Z" fill="#725868"/><path d="M-4 34h11m-11 8h11m-11 8h11" stroke="#b9a8ad" stroke-width="2"/></g>';
  if(id==='guard8')return '<g transform="translate(46 43) rotate(23)"><path d="M-5 2h10v77H-5Z" fill="#b38c70"/><rect x="-31" y="-25" width="62" height="38" rx="8" fill="#abb2bd"/><path d="M-23-21v29m46-29v29" stroke="#e7dfcc" stroke-width="5"/></g>';
  if(id==='nuko')return '<g transform="translate(52 30) rotate(14)"><path d="M-3 4h7v92H-3Z" fill="#b39b88"/><path d="m0-34 10 20 23 3-17 17 4 23L0 18-20 29l4-23-17-17 23-3Z" fill="#ead28d"/><circle cy="-1" r="6" fill="#baa6d4" stroke="none"/></g>';
  if(id==='watch')return '<g transform="translate(52 57) rotate(-20)"><path d="M0 0v67" stroke="#b6d5d9" stroke-width="7"/><path d="M0 0q-24-32-29-6" fill="none" stroke="#b6d5d9" stroke-width="7"/><rect x="-65" y="0" width="23" height="32" rx="3" fill="#fff5e4" transform="rotate(22)"/><path d="m-53 5 5 7-5 7-5-7Z" fill="#b66c86" stroke="none"/></g>';
  if(id==='mack')return '<g transform="translate(43 61)"><path d="M-4-10h37V6H12L9 23H-4L0 4H-7Z" fill="#a99490"/><path d="M11-8h21v10H11Z" fill="#d6cfbf" stroke="none"/></g>';
  return '<g transform="translate(50 39) rotate('+(id==='wanden'?21:celebrate?-26:15)+')"><path d="M-6 17V-61l7-18 7 18v78Z" fill="'+(id==='wanden'?'#e7ecdf':'#c5e0df')+'"/><path d="M-18 20h37v7h-37Z" fill="'+trim+'"/><path d="M-4 28h11v31H-4Z" fill="'+cape+'"/><path d="M0-55v66" stroke="#fff9dc" stroke-width="2"/></g>';
 })();
 const hat=id==='mack'?'<path d="M-43-60q-1-34 15-43h49q14 13 14 43Z" fill="#b69a75"/><path d="M-43-65h80v12h-80" fill="#8b7374"/><path d="M-65-53q65 25 130 0l-7-14q-58 13-116 0Z" fill="#d4b88f"/>'+star(0,-70,.45,'#f8dea3'):
  id==='watch'?'<path d="M-39-54V-97h73v43Z" fill="#587889"/><path d="M-39-67h73v11h-73Z" fill="#bf9ba8"/><ellipse cy="-52" rx="57" ry="10" fill="#6b94a0"/>':
  id==='nuko'?'<path d="M-49-56 7-133 38-63Z" fill="#a58cb9"/><path d="m-48-55-15 7q66 23 117-5l-14-9Z" fill="#bfa7d0"/>'+star(5,-89,.47,'#f2d390'):
  id==='guard8'?'<path d="M-39-66q42-53 79 2l-1 12h-77Z" fill="#96a4b0"/><path d="M-8-88h16v36H-8Z" fill="#c1c7c6"/><path d="M-42-57h86" fill="none" stroke="#d7d3c2" stroke-width="5"/>':
  id==='wanden'?'<path d="M-38-67q-5-25 18-28 5-20 25-15 20-3 21 17 20 4 13 29Z" fill="#cbbba6"/><path d="M-41-57q40-15 82 0" fill="none" stroke="#a2787b" stroke-width="10"/>':
  id==='inu'?'<path d="M-37-65q-4-19 13-21 4-19 20-11 14-16 25-1 19-1 21 17" fill="'+fur+'"/><ellipse cy="-111" rx="34" ry="7" fill="none" stroke="#d9b967" stroke-width="4"/>':'';
 return '<g stroke="'+line+'" stroke-width="'+(small?3.3:3)+'" stroke-linecap="round" stroke-linejoin="round">'+
 '<path d="M-23 25q-15 33-25 72 44 17 81-3L21 25Z" fill="'+cape+'"/><path d="M-22 78q-10 20-20 24 6 10 23 6l16-22m15-8q13 14 15 26 18 5 21-5L29 76" fill="'+(black?'#6f6374':ears)+'"/>'+
 '<path d="M-26 25q25-15 51 1l11 53q-29 20-71 0Z" fill="'+cloth+'"/><path d="M-30 60q29 9 60 0v9q-31 9-62-1Z" fill="'+cape+'"/><rect x="-3" y="60" width="13" height="12" rx="2" fill="'+trim+'"/>'+
 '<path d="M-26 32q-27 1-23 26 9 12 20-1m55-24q26 0 23 23-10 13-22 0" fill="'+cloth+'" transform="rotate('+(celebrate?-28:walking?10:0)+' 0 36)"/>'+
 (id==='shima'?'<ellipse cx="-38" cy="56" rx="15" ry="13" fill="'+ears+'"/><ellipse cx="39" cy="56" rx="15" ry="13" fill="'+ears+'"/>':weapon)+
 '<path d="M-59-25q-5-35 18-48 13-12 39-10 31-4 48 14 24 18 15 49-2 37-60 40-56-2-60-45Z" fill="'+fur+'"/>'+
 (flop?'<path d="M-49-57q-25-9-27 14-2 18 15 38 11 8 18-4l7-29m86-19q25-8 26 16 1 18-14 35-13 8-18-6l-4-28" fill="'+ears+'"/>':
 '<path d="M-48-56q-7-20-6-45 19 3 31 30m48 0q15-24 31-32 3 27-6 48" fill="'+fur+'"/><path d="m-45-65-2-20 15 16m16 0 22-18-5 23" fill="'+(black?'#bd8ca1':'#d7b3ab')+'" stroke="none"/>')+
 '<ellipse cy="-4" rx="24" ry="15" fill="'+muzzle+'" stroke="none"/>'+eyes+
 '<g fill="#de9aa9" stroke="none" opacity=".85"><ellipse cx="-37" cy="-8" rx="9" ry="5"/><ellipse cx="37" cy="-8" rx="9" ry="5"/></g>'+
 '<path d="M-5-10q5-4 10 0l-5 5Z" fill="'+line+'" stroke-width="1.5"/><path d="M0-5v5m0 0q-6 8-12 1m12-1q6 8 12 1" fill="none" stroke-width="2.2"/>'+
 (black?'<path d="m21-48 6 13m-9-8 5-2m-2 9 5-2" stroke="#c5a3af" stroke-width="2"/><path d="M-20 24q21 10 41-1l6 22-55 1Z" fill="#aaa1ac"/><path d="m-17 31 29 6m-18 6 24-5" stroke="#d5c4c9" stroke-width="2"/>':'')+
 (id==='shima'?'<path d="M-42-59q42-12 85 0l-1 11q-39-14-82-1Z" fill="#9b665f"/><path d="m39-52 30 7-10 9-23-6" fill="#bb8075"/>':'')+
 (id==='watch'?'<circle cx="-22" cy="-23" r="12" fill="none" stroke="#a4c8ce" stroke-width="2.4"/><circle cx="22" cy="-23" r="12" fill="none" stroke="#a4c8ce" stroke-width="2.4"/><path d="M-10-24h20" stroke-width="2"/>':'')+hat+'</g>';
}
function theme(index){
 const s=G.stages?.[index]||{},journey=s.journeyStyle;
 if(journey)return journey;
 return ['town','dusk','forest','cave','sky','snow','castle','war','volcano'][index%9];
}
const colors={
 town:['#cbe4df','#9abc9c','#f0d5b1'],dusk:['#dcc6d7','#a4acaa','#e4b9a5'],forest:['#b8d1d1','#6f9c94','#d0d2b4'],
 cave:['#b7b9d6','#909cb5','#c5c5dd'],sky:['#badbe3','#96b5c8','#f0d9bf'],snow:['#d2e1e5','#a4b9cd','#edf0e5'],
 castle:['#c3b8d2','#9b9ab7','#d7c0c4'],war:['#e8d0c4','#afbd9d','#d8bd9e'],volcano:['#d9b4b5','#a58490','#edc5a8'],
 bug:['#c8d9c6','#83ac8c','#e2d9a6'],space:['#a5b2d0','#777f9e','#c6beda'],sea:['#b0d5d4','#78a9b1','#d2e3da'],
 mecha:['#b8b9c9','#858e9c','#d2c4b9']
};
function environment(index,id,clear,wide){
 const world=theme(index),[sky,hill,earth]=colors[world],s=G.stages?.[index]||{},motif=s.theme?.journey;
 const prefix='comic-'+index+'-'+id,night=['space','cave','castle','volcano','dusk'].includes(world);
 const hills='<path d="M-20 230Q85 112 226 226Q356 112 483 218Q591 144 750 204V460H-20Z" fill="'+hill+'"/>';
 const cloud='<path d="M0 0q-9-13 7-18 3-20 23-13 17-12 26 5 21-1 21 17Z" fill="#fff9ec" stroke="none"/>';
 const tree=(x,y,n,c=hill)=>'<g transform="translate('+x+' '+y+') scale('+n+')"><path d="M-5-6-8-90 3-97 8-6Z" fill="#a2827a"/><path d="M-39-82q-19-26 6-45-10-37 29-42 27-13 41 12 35 0 37 33 19 34-10 49-18 20-39 6-42 18-64-13Z" fill="'+c+'"/><path d="M-23-127q18-24 39-15" fill="none" stroke="#f9f1d9" stroke-opacity=".4" stroke-width="5"/></g>';
 const house=(x,y,n,c='#e7c5ac')=>'<g transform="translate('+x+' '+y+') scale('+n+')"><path d="M-55 0v-77L0-117l57 40V0Z" fill="'+c+'"/><path d="m-65-75 65-47 66 47-8 10L0-103l-57 39Z" fill="#bd8792"/><path d="M-52-66h104v8H-52Z" fill="#fff0d3" stroke="none"/><path d="M-14 0v-42q14-16 28 0V0" fill="#a28c88"/><path d="M-42-52h15v20h-15Zm68 0h15v20H26Z" fill="#f7e1aa"/><path d="M-2-111v39" fill="none" stroke-width="2"/></g>';
 const flower=(x,y,n,c)=>'<g transform="translate('+x+' '+y+') scale('+n+')"><path d="M0 0q-5-45 0-81" fill="none" stroke="#739884" stroke-width="9"/><path d="M-3-34q-38-28-38-2 14 14 38 12m7-24q30-30 36-9-11 20-36 19" fill="#a1bc8a"/><g fill="'+c+'">'+Array.from({length:5},(_,i)=>'<ellipse cy="-104" rx="17" ry="29" transform="rotate('+(i*72)+' 0 -81)"/>').join('')+'</g><circle cy="-81" r="17" fill="#f2d589"/></g>';
 let scenery='';
 if(['town','dusk'].includes(world)){
  scenery=tree(70,285,1.1,'#9abb9b')+house(460,273,1.05)+house(606,274,.80,'#ddc5bc')+tree(680,294,.67,'#a7bd9b');
  scenery+='<path d="M322 287v-72m-13 12 25-4-2-23-21 3Z" fill="#edc58f"/><path d="M21 300h230m-208-12v27m49-31v23m66-26v23m58-23v22" stroke="#ebdbc0" fill="none" stroke-width="7"/>';
 }else if(world==='forest'||world==='bug'){
  scenery=tree(90,323,1.8,'#8aafa3')+tree(606,310,1.9,'#799f99')+tree(390,257,.8,'#a7bca7');
  if(world==='bug'){
   if(motif==='honey'){
    scenery='<g transform="translate(445 182)" fill="#ebcb92" stroke="#9e7d71" stroke-width="4">'+
     [[-81,-32],[0,-32],[81,-32],[-40,39],[40,39]].map(([x,y])=>'<path transform="translate('+x+' '+y+')" d="m0-46 40 23v46L0 46-40 23v-46Z"/><path transform="translate('+x+' '+y+') scale(.68)" d="m0-46 40 23v46L0 46-40 23v-46Z" fill="#c6a177" stroke="none"/>').join('')+'</g>'+flower(100,316,1.4,'#e4c494');
   }else if(motif==='web'){
    scenery+='<g transform="translate(345 139)" fill="none" stroke="#f4ede0" stroke-width="3">'+
     [31,60,94].map(r=>'<ellipse rx="'+r+'" ry="'+r*.75+'"/>').join('')+
     '<path d="M-110 0h220m-110-87V87m-84-60 168 120m-168 0L84-60"/></g>';
   }else if(motif==='burrow'){
    scenery='<path d="M67 304Q61 117 203 85q159-66 282 52 142-37 203 167Z" fill="#c4a695"/><path d="M201 304q-3-128 129-139 132 4 141 139" fill="#8b7b8c"/><path d="M233 301q5-101 100-106 100 3 104 106" fill="#b29c9e" stroke-width="4"/>'+flower(590,320,.8,'#d4b8c7');
   }else if(motif==='cocoon'){
    scenery+='<path d="M246 23v119m244-119v91" stroke="#b6b3ad" fill="none" stroke-width="3"/><ellipse cx="246" cy="171" rx="30" ry="49" fill="#ddbdd2"/><ellipse cx="490" cy="145" rx="25" ry="41" fill="#e8ced9"/><path d="m219 154 53 29m-51-4 47 23m-47-67 50 29m-1-39 44 22" stroke="#f5e7df" stroke-width="4" fill="none"/>';
   }else scenery+=flower(222,308,1.3,'#e8b5c9')+flower(526,311,1.7,'#e8d1a1')+flower(650,340,.75,'#c5b3d4');
  }
  else scenery+='<path d="M315 284q-14-57 11-98l14 8-5 90Z" fill="#b29b8b"/><path d="m327 200 48-22 35 28-79 18Z" fill="#dbc4ac"/>';
 }else if(world==='cave'){
  scenery='<path d="M0 0h720v150l-90-49-77 44-100-89-91 77-108-64-98 80-70-49-86 46Z" fill="#9399b2"/>';
  for(const [x,y,n]of [[90,298,1.3],[580,306,1.7],[410,267,.7],[666,317,.8]]){
   scenery+='<g transform="translate('+x+' '+y+') scale('+n+')"><path d="m-38 0 5-91 23-43 27 42 8 92Z" fill="#b8ddd8"/><path d="M-10-134v128m0-85 27-1" fill="none" stroke="#f3f6de" stroke-width="3"/><path d="m25 0 9-64 16-22 14 42-6 44Z" fill="#d0bad6"/></g>';
  }
 }else if(world==='sky'){
  scenery='<g transform="translate(445 181) rotate(-6)"><path d="M-154-12q23-118 167-114Q148-111 167-6 31 38-154-12Z" fill="#dfb2b1"/><path d="M-126-25q20-83 132-87 103 4 135 82" fill="none" stroke="#f2ddbc" stroke-width="7"/><path d="M-81 5-49 73m139-68-30 68" fill="none" stroke="#9a8e88" stroke-width="4"/><path d="m-87 73 171-7-40 45-76-2Z" fill="#c39f83"/><path d="M-46 84h80" stroke="#efcf96" stroke-width="5"/></g>';
 }else if(world==='snow'||world==='volcano'){
  scenery='<path d="m-30 300 135-227 84 130 138-179 185 262 99-200 146 218Z" fill="'+(world==='snow'?'#a5b7ca':'#ae8994')+'"/><path d="m47 169 58-96 52 82-35-8-16 27-19-21-17 24Zm228-79 52-66 78 111-35-16-21 17-22-26-19 12Z" fill="'+(world==='snow'?'#f2eee5':'#eab3a0')+'"/>'+tree(615,330,1.3,world==='snow'?'#dce5de':'#a4828e');
 }else if(world==='space'){
  scenery='<g transform="translate(550 113) rotate(-21)"><circle r="65" fill="#d6c3d6"/><ellipse rx="112" ry="19" fill="none" stroke="#eee0bd" stroke-width="12"/><path d="M-31-35q29-17 49-2" fill="none" stroke="#edd8d4" stroke-width="9"/></g><g transform="translate(210 251) rotate(9)"><path d="M-74-8Q-35-48 5-39q46-4 79 31Q6 29-74-8Z" fill="#b1c6d2"/><path d="M-35-20q-9-58 32-64 47 7 40 63" fill="#d8d8db"/><path d="M-65 0q74 22 139-2" fill="none" stroke="#e3ca9c" stroke-width="5"/><g fill="#f6e6b8" stroke="none"><circle cx="-39" cy="4" r="5"/><circle cx="-9" cy="9" r="5"/><circle cx="21" cy="8" r="5"/><circle cx="49" cy="2" r="5"/></g></g>';
 }else if(world==='sea'){
  scenery='<path d="M0 188q105-23 198 4t186-2 190 3 146-3v180H0Z" fill="#8fbfbe" opacity=".6"/>';
  for(const [x,h]of [[100,111],[168,74],[612,150],[662,100]]){
   scenery+='<path d="M'+x+' 304v-'+h+'m0 '+(h*.6)+'-24-25m24 4 25-30" fill="none" stroke="'+(x<200?'#e1a6b1':'#bfc4d1')+'" stroke-width="11"/>';
  }
  scenery+='<g transform="translate(428 251)"><path d="M-90 12h184v17H-90Z" fill="#dccfb4"/><path d="M-72 10v-99m48 99v-99m48 99v-99m48 99v-99" stroke="#e5d9c2" stroke-width="15"/><path d="m-101-91 102-69 104 69Z" fill="#c1bcbb"/><path d="M-69-97h137" stroke="#ede5ca" stroke-width="5"/></g>';
 }else if(world==='mecha'){
  scenery='<g fill="#a6a2af"><path d="M27 296V79L69 61l41 26v208m17 0V132l62-23 34 29v158m331 0V77l43-31 53 35v215m10 0V113l60-19 35 21v181"/></g><g fill="#e8c8aa" stroke="none">'+[54,144,577,665].map(x=>'<path d="M'+x+' 148h17v25h-17Zm0 65h17v22h-17Z"/>').join('')+'</g><path d="M285 293V147m0 20h168v126" stroke="#7f8695" stroke-width="18" fill="none"/><path d="M268 141h202v26H268Z" fill="#b3a9b0"/><path d="M292 298h160" stroke="#b7c2c0" stroke-width="10"/>';
 }else{
  scenery='<g transform="translate(455 282)"><path d="M-113 0v-79h36v-40h156v40h39V0Z" fill="'+(world==='castle'?'#b8a4be':'#e1c5b0')+'"/><path d="m-126-80 24-31h29l-6-8 27-31h108l29 31-8 8h32l26 31Z" fill="'+(world==='castle'?'#897a9f':'#a17a85')+'"/><path d="M-28 0v-47q28-29 56 0V0" fill="#a58e9c"/><path d="M-91-67h19v25h-19Zm164 0h19v25H73Z" fill="#f4e0b8"/></g>'+tree(100,311,1.45,world==='war'?'#dfb4c0':'#a3a9bd');
 }
 let ground='<path d="M-20 296Q124 258 278 298t258-1 204 5v154H-20Z" fill="'+earth+'"/><path d="M250 410q-5-69 134-90t77-57" stroke="#b5a497" stroke-opacity=".45" stroke-width="40" fill="none"/><path d="M250 410q-5-69 134-90t77-57" stroke="#fff0d3" stroke-width="30" fill="none"/>';
 if(world==='space')ground='<path d="M-20 295q134-62 271 6t293-6 196 4v157H-20Z" fill="#c9c4d6"/><g fill="#afa6c1" stroke="none"><ellipse cx="71" cy="339" rx="38" ry="10"/><ellipse cx="559" cy="351" rx="53" ry="15"/></g>';
 if(world==='sea')ground='<path d="M-20 300q164-16 271 5t276-3 213 2v152H-20Z" fill="#d9ddca"/>';
 if(world==='mecha')ground='<path d="M0 300h720v150H0Z" fill="#b2acb4"/><path d="m0 346 720-8M0 387l720-6m-572-78-34 123m208-123-12 123m192-123 19 123" stroke="#8a8797" fill="none" stroke-width="3"/>';
 const lights=night?Array.from({length:13},(_,i)=>star(25+(i*67)%696,24+(i*31)%160,.25+(i%3)*.10,'#fff0c9')).join(''):
  '<g stroke="none" opacity=".8">'+[[-10,74,.8],[240,49,.65],[571,62,.75]].map(([x,y,n])=>'<g transform="translate('+x+' '+y+') scale('+n+')">'+cloud+'</g>').join('')+'</g>';
 const texture='<pattern id="'+prefix+'-grain" width="33" height="25" patternUnits="userSpaceOnUse"><path d="m4 8 3-1m18 13 2-1" stroke="'+ink+'" stroke-width=".8" opacity=".12"/></pattern>';
 return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 420" preserveAspectRatio="'+(wide?'xMidYMid slice':'xMidYMid meet')+'" role="img" aria-label="'+(clear?'仲間を救い、次の道へ向かう':'新しい土地へ出発する')+'漫画の風景"><defs>'+texture+'</defs>'+
  '<rect width="720" height="420" fill="'+sky+'"/>'+(!night?'<circle cx="567" cy="70" r="37" fill="#f7e6b4" stroke="none"/>':'')+
  '<g stroke="'+ink+'" stroke-width="2.8" stroke-linejoin="round" stroke-linecap="round">'+hills+lights+scenery+ground+'</g>'+
  '<g opacity=".6" stroke="#a89a91" stroke-width="2">'+Array.from({length:12},(_,i)=>'<path d="m'+((i*71+17)%720)+' '+(329+(i%3)*24)+' 10-3"/>').join('')+'</g>'+
  '<g transform="translate('+(clear?280:247)+' 265) scale(.47)">'+character('inu',{happy:clear,pose:'walk',small:true})+'</g>'+
  (clear?'<g transform="translate(352 278) scale(.36)">'+character('nuko',{happy:true,small:true})+'</g>':'<g transform="translate(496 241) scale(.32)">'+character('inu',{small:true})+'</g>')+
  (clear?star(326,245,1.1,'#ffedb6')+star(219,283,.63,'#f7dcc1'):'')+
  '<rect width="720" height="420" fill="url(#'+prefix+'-grain)" pointer-events="none"/></svg>';
}
function portrait(hero,clear,index){
 const prefix='comic-face-'+index+(clear?'-clear':'-intro'),[fur,,,cape]=palettes[hero]||palettes.inu;
 return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 340 340" aria-hidden="true">'+
 '<defs><pattern id="'+prefix+'" width="15" height="15" patternUnits="userSpaceOnUse"><circle cx="3" cy="3" r="1.1" fill="'+cape+'" opacity=".12"/></pattern></defs>'+
 '<circle cx="180" cy="168" r="145" fill="'+(clear?'#f7ead0':'#efdee6')+'"/><circle cx="180" cy="168" r="145" fill="url(#'+prefix+')"/>'+
 '<g transform="translate(175 177) rotate('+(clear?-6:4)+') scale(1.29)">'+character(hero,{happy:clear,pose:clear?'cheer':'ready'})+'</g>'+
 star(51,111,.68,'#e6b8bd')+star(289,82,.81,'#ddbd83')+star(290,256,.5,'#e0b5c7')+
 '<path d="m47 237 15-8m-11-11 16-5m216-69 15-4m-14-10 14-7" fill="none" stroke="'+cape+'" stroke-width="3.2" stroke-linecap="round"/></svg>';
}
function vignette(hero,clear,index){
 const world=theme(index),[sky]=colors[world];
 return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 470 220" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><rect width="470" height="220" fill="'+sky+'"/>'+
 '<g stroke="#b8c3ba" fill="none" stroke-width="2" opacity=".65">'+Array.from({length:7},(_,i)=>'<path d="M'+(i*83-70)+' 220 270 12"/>').join('')+'</g>'+
 '<ellipse cx="291" cy="187" rx="123" ry="13" fill="'+ink+'" opacity=".10"/>'+
 '<g transform="translate(287 131) rotate(-7) scale(.88)">'+character(hero,{happy:clear,pose:'walk'})+'</g>'+
 (clear?'<g transform="translate(183 148) rotate(6) scale(.56)">'+character('inu',{happy:true,small:true})+'</g>':'<path d="M80 151h73m-60-16h43m-41 32h33" stroke="#fff4db" stroke-width="6" stroke-linecap="round"/>')+
 star(382,75,.74,'#fff0c1')+'</svg>';
}
G.storyComic={environment,portrait,vignette};
})();

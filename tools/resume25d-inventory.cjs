'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const reference=require('../tests/25d/reference_runtime.cjs');
const root=path.resolve(__dirname,'..'),out=path.join(root,'evidence/commands-20261024');fs.mkdirSync(out,{recursive:true});
const src=fs.readFileSync(path.join(root,'beltaction.html'),'utf8');
const lineOf=s=>{const p=src.indexOf(s);if(p<0)throw Error('source anchor missing: '+s);return src.slice(0,p).split('\n').length;};
const data=reference(`const heroes=['inu','shima','nuko','guard8','watch','wanden','mack'],rows=[],defs={};
function add(hero,group,slot,id,level,name,command){const d=ATK[id];if(d)defs[id]=d;rows.push({hero,group,slot,id,level:level||1,name:name||d?.name||id,command:command||'',duration:d?.dur,active:d?.act,damage:d?.dmg,hold:d?.hold||0,flags:d?Object.keys(d).filter(k=>d[k]===true):[]});}
for(const hero of heroes){setupRoster(hero);player=players[0];resetPlayer(player,true);
for(const slot of ['up','fwd','down','dash','hadou','dp','du'])add(hero,'ground',slot,specialFor(player,slot)||(hero==='nuko'?'nrailchg':slot==='down'?'slide':'iaidash'),1,SPECIAL_BASE_NAME[hero+'.'+slot],{up:'↑＋攻撃',fwd:'前＋攻撃',down:'↓＋攻撃',dash:'後ろ→前＋攻撃',hadou:'↓→前＋攻撃',dp:'前→↓→前＋攻撃',du:'↓↑＋攻撃'}[slot]);
for(const slot of ['dp','hadou','du'])add(hero,'air-command',slot,airSpecialFor(player,slot),1,null,{hadou:'空中 ↓→前＋攻撃',dp:'空中 前→↓→前＋攻撃',du:'空中 ↓↑＋攻撃'}[slot]);
for(const [slot,ups]of Object.entries(SPECIAL_UP[hero]||{}))for(const [lv,id]of ups)add(hero,'upgrade',slot,id,lv,null,'地上 '+slot);
for(let i=1;i<=comboMaxFor(player);i++)add(hero,'combo',String(i),comboMoveFor(player,i),1,null,'攻撃を押し直す '+i+'段目');
for(const level of [1,6,12,20]){player.level=level;add(hero,'charge','hold-release',chargeMoveFor(player),level,null,'攻撃を長押し→離す');}
for(const [i,r]of airRaveOf(player).entries())rows.push({hero,group:'air-rave',slot:String(i+1),id:'rave-'+hero+'-'+(i+1),level:1,name:r.name||'エリアル '+(i+1),command:'空中 無方向＋攻撃を押し直す',duration:r.dur,damage:r.dmg,definition:r});
add(hero,'ground-ultimate','rotation',{inu:'dimension',shima:'seven',nuko:'nmeteor',guard8:'gquake',watch:'gatling',wanden:'dkaiden',mack:'mkRaid'}[hero],1,ULT_NAME[hero],'レバー１回転＋攻撃');
add(hero,'air-ultimate','rotation/chord',AIR_ULT[hero],1,airUltName(hero),'空中 回転＋攻撃／攻撃＋つかむ同時');
rows.push({hero,group:'chord',slot:'attack+grab',id:'chord-'+hero,level:1,name:SG_ACT[hero]?.name||{inu:'一文字斬り',wanden:'無月',mack:'打ち上げ花火'}[hero]||hero,command:'地上 攻撃＋つかむ同時',cooldown:SG_CD,definition:SG_ACT[hero]||null});
}
// Verify dispatch by executing the real input branch, not just its nominal tables.
function invoke(hero,slot,level){setupRoster(hero);player=players[0];resetPlayer(player,true);player.level=level;player.dim=8;player.invuln=0;player.in=makeInput();useInput(player.in);gf=0;state='play';enemies=[];projectiles=[];hazards=[];
const seq={up:[0],fwd:[1],down:[2],dash:[3,1],hadou:[2,1],dp:[1,2,1],du:[2,0],rotation:[0,1,2,3]}[slot];for(const c of seq)cardSeq.push({c,f:0});
K.up=slot==='up'||slot==='du';K.down=slot==='down';K.right=slot==='fwd';pressed.atk=true;K.atk=true;updatePlayer();const id=player.atk?.type||player.state;return {id,state:player.state};}
for(const r of rows)if(['ground','upgrade','ground-ultimate'].includes(r.group)){const actual=invoke(r.hero,r.group==='ground-ultimate'?'rotation':r.slot,r.level);r.declaredId=r.id;r.directInputId=actual.id;r.runtimeState=actual.state;
if(r.group!=='upgrade'){r.id=actual.id;r.name=ATK[r.id]?.name||r.name;const d=ATK[r.id];if(d){defs[r.id]=d;r.duration=d.dur;r.active=d.act;r.damage=d.dmg;r.flags=Object.keys(d).filter(k=>d[k]===true);}}
if(r.group==='upgrade'&&actual.id!==r.id)r.note='単発入力は得物の技が優先。成長技は別コマンドからのキャンセルで使用。';}
global.result={rows,defs,base:SPECIAL_BASE,upgrades:SPECIAL_UP,air:AIR_SPECIAL,airRave:AIR_RAVE,sg:SG_ACT,costs:Object.fromEntries(heroes.map(hero=>[hero,[1,6,12,20].map(level=>({level,ground:ultCost({kind:hero,level},false),air:ultCost({kind:hero,level},true)}))])),evo:[EVO_LV,EVO_NAME]};`);
const grab={
inu:[['grabGanzan','ガンザンリョウザンパ'],['beginDunk','パワーダンク'],['beginScrew','スクリューパイルドライバー'],['beginWheel','地獄グルマ']],
shima:[['grabStraight','正拳突き'],['grabZankai','残悔拳'],['beginGiantSwing','ジャイアントスイング'],['beginTriangle','三角蹴り']],
nuko:[['grabZapBlast','サンダーブラスト'],['grabPsy','サイコバースト'],['grabFreeze','アイスコフィン'],['grabGale','ゲイルスルー']],
guard8:[['grabGuardSlam','地面叩きつけ'],['grabGuardUpper','アッパーカット→追加入力で叩き落とし'],['grabGuardHammer','ハンマープレス'],['grabGuardToss','首根っこ後ろ投げ']],
watch:[['grabSteal','技・武器・小判を盗む']],
wanden:[['grabSayaKudaki','鞘砕き'],['grabTenNagashi','天流し'],['grabSuemono','据物斬り'],['grabHaisha','背車・逆袈裟']],
mack:[['grabMackGun','ゼロ距離早撃ち６射'],['grabMackRocket','ロケット打ち上げ'],['grabMackDrill','ドリル突進'],['grabMackBuson','背負い投げ＋一発']]
};
const dir=['無方向','↑','↓','後ろ'];
for(const [hero,actions]of Object.entries(grab)){
 data.rows.push({hero,group:'grab-entry',id:'grab',slot:'grab',name:'つかみ保持／180Fで解放',level:1,command:'地上 つかむ（前方54px・奥行26px以内／空中の敵不可）',sourceLine:lineOf('function tryGrab()')});
 actions.forEach(([id,name],i)=>data.rows.push({hero,group:'throw',id,slot:i,level:1,name,command:'つかみ中 '+(hero==='watch'?'どの方向でも':dir[i])+'＋攻撃',sourceLine:lineOf('function '+id+'(')}));
}
const airNames={inu:['天翔斬','下突き','兜割'],shima:['昇天脚','地球割パンチ','回転踵落とし'],nuko:['星昇撃','爆裂火球','サンダークラッシュ'],guard8:['ハンマーアッパー','下突き','兜割'],watch:['ツバメ返り','下突き','兜割'],wanden:['天翔斬','下突き','兜割'],mack:['ドリルダッシュ（方向選択可）','レインストーム（連打で延長）','兜割']};
for(const [hero,names]of Object.entries(airNames))names.forEach((name,i)=>data.rows.push({hero,group:'air-direction',id:'air-'+hero+'-'+['up','down','forward'][i],slot:['up','down','forward'][i],name,level:1,command:'空中 '+['↑','↓','前'][i]+'＋攻撃',sourceLine:lineOf('    // air attack')}));
// Shima's release bypasses chargeMoveFor: the real input branch calls beginHadou.
for(const hero of Object.keys(grab))data.rows.push({hero,group:'throw',id:'grabStrike',slot:'forward',level:1,name:'つかみ小攻撃',command:'つかみ中 前＋攻撃',damage:6,duration:9,active:[4,4],sourceLine:lineOf('function punchImpact('),adaptation:true,note:'2.5D追加マッピング。原作で無方向と同じだった前入力を、既存の小攻撃へ接続。保持を続け、ストック消費なし。'});
for(const r of data.rows)if(r.hero==='shima'&&r.group==='charge')Object.assign(r,{id:'hadou',name:'波動拳',duration:18,active:[0,18],damage:16,hold:0,flags:['projectile'],sourceLine:lineOf('function beginHadou()'),note:'長押し→離す。初弾16、追加の攻撃入力で12の弾を計6発まで。最終発射後15Fで終了。ストック消費なし。'});
const anchors={ground:'const SPECIAL_BASE=',upgrade:'const SPECIAL_UP=',combo:'function comboMoveFor(',charge:'function chargeMoveFor(', 'air-command':'const AIR_SPECIAL=', 'air-rave':'const AIR_RAVE=', 'ground-ultimate':'function fireGroundUlt(', 'air-ultimate':'const AIR_ULT=',chord:'function beginSGMove('};
const cmd={up:'↑＋攻撃',fwd:'前＋攻撃',down:'↓＋攻撃',dash:'後ろ→前＋攻撃',hadou:'↓↘→（↓→も可）＋攻撃',dp:'→↓↘（→↓→も可）＋攻撃',du:'↓↑＋攻撃'};
for(const r of data.rows){if(['ground','upgrade'].includes(r.group))r.command=cmd[r.slot];if(r.group==='air-command')r.command='空中 '+cmd[r.slot];if(Array.isArray(r.name))r.name=r.name[0];r.sourceLine??=lineOf(anchors[r.group]);r.behavior=r.adaptation?'2.5D forward-input adaptation using original punchImpact helper':'unchanged 2D fighter connected; per-row interaction verification pending';r.choreography=r.hero==='inu'&&r.group==='ground'?'previous seven dedicated poses preserved':'dedicated motion verification pending';}
const normalized=Buffer.from(src.replace(/\r\n/g,'\n'));
data.reference={url:'https://takeshizhanglai547-ai.github.io/Kuchiwan/beltaction.html',commit:'b5c01428a8b84bf588060a0a87c9cdc981e8a781',blob:crypto.createHash('sha1').update(Buffer.from('blob '+normalized.length+'\0')).update(normalized).digest('hex')};
data.scope='Seven heroes default moves, all command upgrades, aerial directional/rave attacks, grabs/throws, chord moves, stock costs. Picked-up weapon variations are separately present in reference engine but not counted as newly visually verified.';
fs.writeFileSync(path.join(out,'coverage-source.json'),JSON.stringify(data,null,2));
const heads=['hero','group','slot','id','level','name','command','sourceLine','behavior','choreography'],q=v=>'"'+String(v??'').replace(/"/g,'""')+'"';
fs.writeFileSync(path.join(out,'coverage-source.csv'),'\uFEFF'+heads.map(q).join(',')+'\n'+data.rows.map(r=>heads.map(h=>q(r[h])).join(',')).join('\n'));
const catalog={rows:data.rows.map(({behavior,choreography,definition,...r})=>r),defs:data.defs,costs:data.costs,sg:data.sg};
fs.writeFileSync(path.join(root,'inu25d/src/22_published_catalog.js'),'// Generated from the unchanged published 2D source; display metadata only.\n(function(){"use strict";G.publishedCatalog='+JSON.stringify(catalog)+';})();\n');
console.log(JSON.stringify({rows:data.rows.length,groups:Object.fromEntries([...new Set(data.rows.map(r=>r.group))].map(g=>[g,data.rows.filter(r=>r.group===g).length])),defs:Object.keys(data.defs).length,reference:data.reference}));

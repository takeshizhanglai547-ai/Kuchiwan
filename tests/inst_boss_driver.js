const DRIVER = `
global._GC={}; var _g=(n,v)=>{ _GC[n]=(_GC[n]||0)+1; return v; };
process.on("exit",()=>{ const miss=[]; for(let i=1;i<=33;i++) if(!_GC[i]) miss.push(i); console.error("GUARDS total=33 evaluated="+((33)-miss.length)+" NEVER_EVALUATED=["+miss.join(",")+"]"); });

(async()=>{
  const step=(n)=>{ for(let i=0;i<n;i++){ if(global.rafCb){ const cb=global.rafCb; global.rafCb=null; cb(); } } };

  // ===== 1) 腕試しの主役ボスがちゃんと攻撃してくる =====
  if(_g(1,!MV.heroArt)) throw new Error('MV.heroArt missing -> pickBossMove returns null and hero bosses never attack');
  ['hbInu','hbShima','hbNuko','hbGuard8','hbWatch','hbWanden'].forEach(k=>{
    if(_g(2,!ETYPE[k].aggro)) throw new Error(k+' lacks the aggro flag'); });
  setupRoster('shima'); startGame(); state='play'; sndOn=false;
  const p=players[0]; p.x=camX+200;
  enemies.length=0; hazards.length=0; projectiles.length=0;
  spawnEnemy('hbInu', p.x+120, LANE);
  const hb=enemies[0]; hb.hp=hb.maxHp=999999;
  if(_g(3,pickBossMove(hb,120)!=='heroArt')) throw new Error('hero boss has no usable move at close range');
  if(_g(4,pickBossMove(hb,900)!=='heroArt')) throw new Error('hero boss has no usable move at long range');
  const used=new Set(); let starts=0, dmgTaken=0;
  for(let i=0;i<600;i++){
    hitStop=0; slowmo=0; p.invuln=0; p.hp=p.maxHp=999999; p.state=(p.state==='dead')?'idle':p.state;
    const before=p.hp; step(1); dmgTaken+=Math.max(0,before-p.hp);
    if(hb.state==='bmove' && hb.moveT===1){ starts++; if(hb.heroAtk) used.add(hb.heroAtk); }
    if(hb.dead) break;
  }
  if(_g(5,starts<8)) throw new Error('hero boss barely attacked ('+starts+' moves in 600 frames)');
  if(_g(6,used.size<2)) throw new Error('hero boss repeats a single move ('+[...used].join(',')+')');
  if(_g(7,dmgTaken<=0)) throw new Error('hero boss never damaged the player');
  console.log('主役ボス 猛攻 OK (600F中 '+starts+'回の技／'+used.size+'種類／与ダメ '+dmgTaken+')');
  // 体力半分で本気モードに入る
  hb.hp=Math.floor(hb.maxHp*0.4); hb.rage=false; bossTick(hb, ETYPE[hb.type]);
  if(_g(8,!hb.rage)) throw new Error('hero boss does not enrage at half health');
  console.log('主役ボス 本気モード OK (HP55%割れで手数と機動が上がる)');

  // ===== 2) ボスの吹っ飛び耐性（20ヒットの踏ん張り）＋速い復帰 =====
  if(_g(9,BOSS_POISE<20)) throw new Error('BOSS_POISE too low: '+BOSS_POISE);
  enemies.length=0; spawnEnemy('garm', p.x+200, LANE);
  const bs=enemies[0]; bs.hp=bs.maxHp=999999;
  let brokeAt=0;
  for(let i=1;i<=BOSS_POISE;i++){
    bs.state='walk'; bs.z=0; bs.vz=0; bs.noJuggleT=0;
    damageEnemy(bs, 5, 6, true, 0);
    if(!brokeAt && bs.state==='down') brokeAt=i;
  }
  if(_g(10,brokeAt!==BOSS_POISE)) throw new Error('boss knocked down at hit '+brokeAt+' (expected '+BOSS_POISE+')');
  if(_g(11,bs.downTimer>20)) throw new Error('boss recovery too slow: downTimer='+bs.downTimer);
  console.log('ボス 踏ん張り OK ('+(BOSS_POISE-1)+'発は耐え、'+brokeAt+'発目で体勢崩壊／ダウン '+bs.downTimer+'F と短い)');
  // 打ち上げも同じ踏ん張りに従う
  bs.state='walk'; bs.z=0; bs.vz=0; bs.kbHits=0; bs.poiseBreak=0; bs.noJuggleT=0;
  launchEnemy(bs, 14, -12, 3);
  if(_g(12,bs.state==='air')) throw new Error('boss launched while poise was intact');
  bs.poiseBreak=gf+40; launchEnemy(bs, 14, -12, 3);
  if(_g(13,bs.state!=='air')) throw new Error('boss did not launch after the poise broke');
  console.log('ボス 打ち上げ耐性 OK (踏ん張り中は押されるだけ／崩壊後は打ち上がる)');
  // 腕試しの主役ボスは従来どおり素直に吹っ飛ぶ
  enemies.length=0; spawnEnemy('hbWanden', p.x+200, LANE);
  const hb2=enemies[0]; hb2.hp=hb2.maxHp=999999; hb2.noJuggleT=0;
  launchEnemy(hb2, 14, -12, 3);
  if(_g(14,hb2.state!=='air')) throw new Error('hero boss should still tumble like a player');
  console.log('主役ボス 吹っ飛び OK (踏ん張りの対象外で従来どおり吹っ飛ぶ)');

  // ===== 3) タイプ別の大技 =====
  ['megaBeam','skyDive','bladeParry','bladeCounter','bulletHell','boltStrike','megaTornado'].forEach(m=>{
    if(_g(15,!MV[m])) throw new Error('MV.'+m+' missing'); });
  const has=(k,m)=>(BOSSMOVES[k]||[]).includes(m);
  [['darkknight','megaBeam'],['emperorX2','megaBeam'],['chamurus','megaBeam'],['wanmen','megaBeam'],['guard0','megaBeam'],['golux','megaBeam'],['mumei','megaBeam'],['papipoo','megaBeam'],['phantom','megaBeam']]
    .forEach(([k,m])=>{ if(_g(16,!has(k,m))) throw new Error('final boss '+k+' lacks '+m); });
  [['darkknight','skyDive'],['golux','bladeParry'],['ghost','skyDive'],['rival','bladeParry'],['kamaboss','skyDive'],['vesper','bladeParry']]
    .forEach(([k,m])=>{ if(_g(17,!has(k,m))) throw new Error('sword boss '+k+' lacks '+m); });
  [['moloch','bulletHell'],['cactus','bulletHell'],['pirate','bulletHell'],['ufoboss','bulletHell'],['spidboss','bulletHell'],['queenbee','bulletHell']]
    .forEach(([k,m])=>{ if(_g(18,!has(k,m))) throw new Error('shooter boss '+k+' lacks '+m); });
  [['emperor','boltStrike'],['emperor','megaTornado'],['noroinu','boltStrike'],['noroinu','megaTornado'],['emperorX','megaTornado'],['wanmen','boltStrike']]
    .forEach(([k,m])=>{ if(_g(19,!has(k,m))) throw new Error('mage boss '+k+' lacks '+m); });
  console.log('技構成 OK (ラスボス=極太ビーム／剣士=急降下・見切り／飛び道具=弾幕／魔法使い=落雷・竜巻)');
  // 剣鬼ムメイのように bossKind を共有するボスも、種別ごとの技構成が使われる
  enemies.length=0; spawnEnemy('mumei', p.x+200, LANE);
  if(_g(20,!BOSSMOVES.mumei.includes(pickBossMove(enemies[0],120)))) throw new Error('per-type moveset not used for mumei');
  console.log('種別ごとの技構成 OK (bossKind を共有する剣鬼ムメイも専用リストを使う)');

  function runMove(type, name, dur){
    enemies.length=0; hazards.length=0; projectiles.length=0;
    p.x=camX+200; p.y=LANE; p.z=0; p.hp=p.maxHp=999999; p.invuln=0; p.state='idle';
    spawnEnemy(type, p.x+220, LANE);
    const e=enemies[0]; e.hp=e.maxHp=999999; e.facing=-1; e.slammed=false;
    e.state='bmove'; e.moveName=name; e.moveMax=(dur||MV[name].dur);
    for(let f=0; f<e.moveMax; f++){ e.moveT=f; runBossMove(e); }
    return e;
  }
  const ready=()=>{ p.invuln=0; if(p.state==='down'||p.state==='dead'||p.state==='hurt') p.state='idle'; };
  const hurtBy=(fn)=>{ p.hp=p.maxHp=999999; ready(); const b=p.hp; fn(); return b-p.hp; };

  // 極太ビーム
  runMove('boss3','megaBeam');
  const beam=hazards.find(h=>h.kind==='ebeam');
  if(_g(21,!beam)) throw new Error('megaBeam produced no beam');
  const beamDmg=hurtBy(()=>{ for(let i=0;i<12;i++){ ready(); updateHazards(); } });
  if(_g(22,beamDmg<=0)) throw new Error('megaBeam did not hit the player');
  console.log('極太ビーム OK (進路上を薙ぎ払い '+beamDmg+' ダメージ)');

  // 剣士：急降下突進
  const sd=runMove('boss3','skyDive');
  if(_g(23,!sd.slammed)) throw new Error('skyDive never landed');
  if(_g(24,sd.z>1)) throw new Error('skyDive did not return to the ground (z='+sd.z+')');
  console.log('急降下突進 OK (跳び上がって追尾 → 着地で衝撃波)');

  // 剣士：見切り → アニメーション付きカウンター
  enemies.length=0; hazards.length=0;
  p.x=camX+200; p.hp=p.maxHp=999999; p.invuln=0;
  p.state='idle'; p.z=0; spawnEnemy('golux', p.x+110, LANE);
  const gx=enemies[0]; gx.hp=gx.maxHp=999999; gx.parryCd=99999;   // 既存の受動パリィは封じて能動の構えだけ試す
  gx.state='bmove'; gx.moveName='bladeParry'; gx.moveMax=MV.bladeParry.dur;
  gx.moveT=1; runBossMove(gx);
  if(_g(25,!(gx.parryStance>gf))) throw new Error('bladeParry did not enter the stance');
  curHitIsMelee=true; damageEnemy(gx, 10, 5, false, 0); curHitIsMelee=false;
  if(_g(26,gx.moveName!=='bladeCounter')) throw new Error('parry did not trigger the counter (move='+gx.moveName+')');
  const cDmg=hurtBy(()=>{ for(let f=0;f<MV.bladeCounter.dur;f++){ ready(); gx.moveT=f; runBossMove(gx); } });
  if(_g(27,cDmg<=0)) throw new Error('bladeCounter dealt no damage');
  console.log('見切りカウンター OK (構え→近接を受けて返し刃、巨大な一閃で '+cDmg+' ダメージ)');

  // 飛び道具：弾幕
  runMove('cactus','bulletHell');
  if(_g(28,projectiles.length<30)) throw new Error('bulletHell fired only '+projectiles.length+' shots');
  console.log('弾幕 OK ('+projectiles.length+' 発の波状射撃)');

  // 魔法使い：落雷
  runMove('noroinu','boltStrike');
  const bolts=hazards.filter(h=>h.kind==='ebolt');
  if(_g(29,bolts.length<4)) throw new Error('boltStrike dropped only '+bolts.length+' bolts');
  const boltDmg=hurtBy(()=>{ for(let i=0;i<30;i++){ ready(); updateHazards(); } });
  if(_g(30,boltDmg<=0)) throw new Error('boltStrike never connected');
  console.log('落雷 OK ('+bolts.length+' 本を狙って落とし '+boltDmg+' ダメージ)');

  // 魔法使い：巨大竜巻
  runMove('noroinu','megaTornado');
  const tw=hazards.find(h=>h.kind==='etwister');
  if(_g(31,!tw)) throw new Error('megaTornado spawned no twister');
  const pxBefore=p.x;
  const twDmg=hurtBy(()=>{ for(let i=0;i<40;i++){ ready(); updateHazards(); } });
  if(_g(32,twDmg<=0)) throw new Error('megaTornado never connected');
  if(_g(33,Math.abs(p.x-pxBefore)<10)) throw new Error('megaTornado did not pull the player in');
  console.log('巨大竜巻 OK (吸い寄せ '+Math.round(Math.abs(p.x-pxBefore))+'px ＋巻き上げ '+twDmg+' ダメージ)');

  console.log('BOSS AI/POISE TEST PASSED'); process.exit(0);
})().catch(e=>{ console.error('FAIL:', e.message, e.stack); process.exit(1); });
`;
code = code + "\n;" + DRIVER;
(0, eval)(code);

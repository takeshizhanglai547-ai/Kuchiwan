const DRIVER = `
(async()=>{
  const step=(n)=>{ for(let i=0;i<n;i++){ if(global.rafCb){ const cb=global.rafCb; global.rafCb=null; cb(); } } };

  // ===== 1) 蟲の世界の雑魚：新3種＋全7種が蟲ボディ =====
  ['kamakiri','hachibo','kabuto','kumo','dangoro','mukade','hotarubi'].forEach(k=>{
    const T=ETYPE[k]; if(!T||!T.bug||!T.bugKind) throw new Error('bug zako missing/untagged: '+k); });
  if(typeof drawBugFoe!=='function') throw new Error('drawBugFoe missing');
  console.log('BUG ZAKO ROSTER OK (7 kinds with bugKind, dedicated insect body)');

  // ===== 2) 2周目の出現プールは蟲のみ =====
  lap=1; for(let i=0;i<40;i++){ if(!ZAKO_POOL.includes(randZako())) throw new Error('lap1 pool broken'); }
  lap=2; for(let i=0;i<60;i++){ const z=randZako();
    if(!BUG_ZAKO_POOL.includes(z)) throw new Error('lap2 spawned non-insect: '+z); }
  // ゲートのランダム化も蟲のみ（ボスは据え置き）
  const rz=randomizeZako([['wolf',1],['zombiewan',1],['queenbee',1]]);
  for(const [t,n] of rz){ if(ETYPE[t].boss) continue; if(!BUG_ZAKO_POOL.includes(t)) throw new Error('randomizeZako leaked dog in lap2: '+t); }
  if(!rz.some(([t])=>t==='queenbee')) throw new Error('boss entry not preserved');
  console.log('LAP2 SPAWN POOL OK (randZako/randomizeZako insect-only, boss preserved)');

  // 待ち伏せ＆ボス召喚も蟲
  setupRoster('inu'); startGame(); state='play'; lap=2;
  enemies.length=0; triggerAmbush({x:players[0].x+100});
  for(const e of enemies){ if(!ETYPE[e.type].bug&&e.type!=='ari') throw new Error('lap2 ambush spawned dog: '+e.type); }
  enemies.length=0; bSummon({x:players[0].x+100,y:LANE,h:100});
  for(const e of enemies){ if(!ETYPE[e.type].bug) throw new Error('lap2 bSummon spawned dog: '+e.type); }
  console.log('LAP2 AMBUSH/SUMMON OK (insects only, spawned '+enemies.length+' via summon)');
  lap=1;

  // ===== 3) 攻撃＋掴み同時押し必殺技（全5キャラ）=====
  // イッヌ「秘剣・無月」：連続閃で複数の敵にヒット
  setupRoster('inu'); startGame(); state='play'; let p=players[0]; player=p; p.x=camX+300; p.hp=p.maxHp=9999;
  enemies.length=0; for(let k=0;k<3;k++) spawnEnemy('wolf', p.x+100+k*90, LANE);
  enemies.forEach(e=>{e.thinkCd=9999;e.hp=e.maxHp=9999;});
  if(!beginSGMove(p)) throw new Error('mugetsu did not start');
  if(p.state!=='mugetsu') throw new Error('mugetsu state not set');
  if(!(p.sgCd>0)) throw new Error('sgCd not set');
  for(let i=0;i<50;i++){ hitStop=0; slowmo=0; step(1); }
  const mgHit=enemies.filter(e=>e.hp<9999||e.dead).length;
  if(mgHit<3) throw new Error('mugetsu hit only '+mgHit+'/3');
  if(p.state==='mugetsu') throw new Error('mugetsu never ended');
  if(beginSGMove(p)) throw new Error('cooldown not enforced');
  console.log('イッヌ 秘剣・無月 OK (hit '+mgHit+'/3, cooldown enforced)');

  // シマ「虎魂・大喝」：全体スタン＋ダメージ
  setupRoster('shima'); startGame(); state='play'; p=players[0]; player=p; p.x=camX+300; p.hp=p.maxHp=9999;
  enemies.length=0; spawnEnemy('wolf', p.x+200, LANE); const rE=enemies[0]; rE.thinkCd=9999; rE.hp=rE.maxHp=9999; rE.stun=0;
  if(!beginSGMove(p)) throw new Error('roar did not start');
  if(rE.hp>=9999&&!rE.dead) throw new Error('roar dealt no damage');
  if(!(rE.stun>=100)&&!rE.dead) throw new Error('roar did not stun (stun='+rE.stun+')');
  console.log('シマ 虎魂・大喝 OK (dmg='+(9999-rE.hp)+', stun='+rE.stun+')');

  // ヌコ「エレメンタルバースト」：ダメージ＋氷結＋雷の柱
  setupRoster('nuko'); startGame(); state='play'; p=players[0]; player=p; p.x=camX+300; p.hp=p.maxHp=9999;
  enemies.length=0; particles.length=0; spawnEnemy('wolf', p.x+180, LANE); const nE=enemies[0]; nE.thinkCd=9999; nE.hp=nE.maxHp=9999;
  if(!beginSGMove(p)) throw new Error('burst did not start');
  if(nE.hp>=9999&&!nE.dead) throw new Error('burst dealt no damage');
  if(!nE.dead && !(nE.frozen>0)) throw new Error('burst did not freeze');
  if(!particles.some(pp=>pp.k==='laser')) throw new Error('burst spawned no thunder pillars');
  console.log('ヌコ エレメンタルバースト OK (dmg='+(9999-nE.hp)+', frozen='+nE.frozen+', thunder ok)');

  // ガードワン「アイアンウォール」：要塞化で被ダメ軽減＆怯まない
  setupRoster('guard8'); startGame(); state='play'; p=players[0]; player=p; p.x=camX+300; p.hp=p.maxHp=9999; p.defMul=1;
  enemies.length=0; spawnEnemy('wolf', p.x+120, LANE); enemies[0].thinkCd=9999; enemies[0].hp=enemies[0].maxHp=9999;
  if(!beginSGMove(p)) throw new Error('ironwall did not start');
  if(!(p.fortT>0)) throw new Error('fortT not set');
  if(enemies[0].hp>=9999&&!enemies[0].dead) throw new Error('ironwall slam dealt no damage');
  p.invuln=0; const hp0=p.hp; hurtPlayer(p, 50, 1, true); const dmgFort=hp0-p.hp;
  p.fortT=0; p.invuln=0; const hp1=p.hp; hurtPlayer(p, 50, 1, true); const dmgNorm=hp1-p.hp;
  if(!(dmgFort < dmgNorm*0.6)) throw new Error('fort not reducing damage ('+dmgFort+' vs '+dmgNorm+')');
  console.log('ガードワン アイアンウォール OK (被ダメ '+dmgNorm+' -> '+dmgFort+')');

  // ワッチ「銭形乱舞」：前方一掃＋小銭入手
  setupRoster('watch'); startGame(); state='play'; p=players[0]; player=p; p.x=camX+200; p.facing=1; p.hp=p.maxHp=9999;
  enemies.length=0; spawnEnemy('wolf', p.x+150, LANE); spawnEnemy('wolf', p.x+300, LANE);
  enemies.forEach(e=>{e.thinkCd=9999;e.hp=e.maxHp=9999;});
  const c0=coins;
  if(!beginSGMove(p)) throw new Error('zeni did not start');
  const zHit=enemies.filter(e=>e.hp<9999||e.dead).length;
  if(zHit<2) throw new Error('zeni hit only '+zHit+'/2');
  if(!(coins>c0)) throw new Error('zeni gave no coins ('+c0+'->'+coins+')');
  console.log('ワッチ 銭形乱舞 OK (hit '+zHit+'/2, coins '+c0+'->'+coins+')');

  // ===== 4) 入力配線：K.atk保持＋掴み押しで発動する =====
  setupRoster('shima'); startGame(); state='play'; p=players[0]; player=p; p.sgCd=0; p.state='idle'; p.z=0;
  enemies.length=0; spawnEnemy('wolf', p.x+150, LANE); enemies[0].thinkCd=9999;
  p.in.K.atk=true; p.in.pressed.grab=true;
  hitStop=0; slowmo=0; step(1);
  if(!(p.sgCd>0)) throw new Error('atk+grab input did not trigger SG move');
  p.in.K.atk=false;
  console.log('INPUT WIRING OK (K.atk + pressed.grab -> SG move, sgCd='+p.sgCd+')');

  console.log('SG/BUGZAKO TEST PASSED'); process.exit(0);
})().catch(e=>{ console.error('FAIL:', e.message, e.stack); process.exit(1); });
`;
code = code + "\n;" + DRIVER;
(0, eval)(code);

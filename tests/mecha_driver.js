const DRIVER = `
(async()=>{
  const step=(n)=>{ for(let i=0;i<n;i++){ if(global.rafCb){ const cb=global.rafCb; global.rafCb=null; cb(); } } };
  sndOn=false;
  setupRoster('inu'); startGame(); state='play';
  // 六周目を実際に開始できるか
  startNG6(true);
  console.log('lap='+lap+' encounters='+encounters.length+' stage='+stage);
  if(lap!==6) throw new Error('lap が6にならない');
  if(!encounters.length) throw new Error('エンカウンタが積まれていない');
  // 章とマップの整合
  console.log('章 '+MECHA_CH.length+' / マップ '+curWorldLevels().length+'+'+WORLD6_FINAL.length+' / 解禁 '+NG6_UNLOCK);
  // ゲートに書かれた敵IDが全部 ETYPE にあるか
  const miss=[];
  MECHA_CH.forEach(function(b){ b.gates.forEach(function(g){ g.list.forEach(function(q){
    if(!ETYPE[q[0]]) miss.push(q[0]); }); }); });
  if(miss.length) throw new Error('ETYPE に無い敵: '+Array.from(new Set(miss)).join(','));
  // テーマ番号がすべて実在するか
  const badT=MECHA_CH.filter(function(b){ return !STAGE_THEME[b.theme]; }).map(function(b){ return b.name+':'+b.theme; });
  if(badT.length) throw new Error('テーマが無い: '+badT.join(','));
  // 実際に敵を湧かせて殴れるか（雑魚10種＋ボス6種＋中ボス7種）
  const ALL=MECHA_ZAKO_POOL.concat(['mkGolem','mkTurret','mkArc','mkSwarm','mkMirror','mkOmega',
    'mkMScout','mkMArms','mkMCoil','mkMWing','mkMHammer','mkMOld','mkVault']);
  const p=players[0]; player=p; p.hp=p.maxHp=99999; p.invuln=99999; p.atkMul=99;
  const dead=[];
  ALL.forEach(function(k){
    enemies.length=0; projectiles.length=0; particles.length=0;
    p.x=600; p._tx=null; p.facing=1; p.state='idle'; p.atk=null; p.z=0;
    // 盾持ちは正面を通さないのが仕様。背後から殴って「触れるか」だけを見る
    const back=!!(ETYPE[k].guarder||ETYPE[k].phalanx);
    spawnEnemy(k, back?540:660, LANE); const e=enemies[0];
    if(back){ p.facing=-1; }
    if(!e) { dead.push(k+'(湧かない)'); return; }
    const hp0=e.hp;
    for(let f=0;f<120;f++){ hitStop=0; slowmo=0; particles.length=0;
      if(f%14===0){ p.in.pressed.atk=true; }
      e.x=back?540:660; e.vx=0; e.z=0; e.facing=back?1:-1;
      // 盾は「たまたま構え続ける」ことがある（5回に1回の実測）。
      // ここで見たいのは当たり判定が届くかどうかなので、構えは止めておく
      e.guardCd=999; if(e.state==='guard'){ e.state='walk'; e.guardT=0; }
      useInput(p.in); updatePlayer(p); saveInput(p.in); updateEnemies(); updateProjectiles(); }
    if(!(hp0-e.hp>0) && !e.dead) dead.push(k+'(殴れない)');
  });
  if(dead.length) throw new Error('触れない敵: '+dead.join(','));
  console.log('敵 '+ALL.length+'種すべて湧いて殴れる');
  // 描画が例外を出さないか（雑魚・中ボス・ボス）
  ['mkShield','mkGun','mkDrone','mkBomb','mkMScout','mkGolem','mkOmega'].forEach(function(k){
    enemies.length=0; spawnEnemy(k, 660, LANE); const e=enemies[0];
    try{ enemies.forEach(drawEnemy); }catch(err){ throw new Error(k+' の描画で例外: '+err.message); } });
  console.log('描画 OK');
  // 6テーマぶん背景を描く
  for(let t=25;t<=30;t++){ stage=1; STAGE2THEME[1]=t; bgCacheTheme=-1;
    try{ drawBackground(); drawGround(); }catch(err){ throw new Error('テーマ'+t+' の背景で例外: '+err.message); } }
  console.log('背景 25〜30 OK');
  console.log('MECHA TEST PASSED');
  process.exit(0);
})().catch(e=>{ console.error('FAIL:', e.message); process.exit(1); });
`;
code = code + "\n;" + DRIVER;
(0, eval)(code);

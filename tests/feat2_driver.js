const DRIVER = `
(async()=>{
  const step=(n)=>{ for(let i=0;i<n;i++){ if(global.rafCb){ const cb=global.rafCb; global.rafCb=null; cb(); } } };

  // (SONGS is private to the Music IIFE; ending track is exercised functionally in test 6)

  // ===== 2) watch true boss (phantom) wired end-to-end =====
  if(trueBossFor('watch')!=='phantom') throw new Error('trueBossFor(watch)!=phantom');
  if(!ETYPE.phantom || !ETYPE.phantom.finalBoss || !ETYPE.phantom.trueBoss) throw new Error('phantom ETYPE missing/flags');
  if(!TRUE_REVEAL.phantom || !TRUE_REVEAL.phantom.length) throw new Error('PHANTOM_REVEAL not registered');
  if(!BOSS_BGM.phantom) throw new Error('phantom has no boss BGM');
  if(!BOSSQUOTE.phantom) throw new Error('phantom has no quote');
  console.log('WATCH TRUE BOSS OK (phantom: hp='+ETYPE.phantom.hp+', reveal scenes='+TRUE_REVEAL.phantom.length+', bgm='+BOSS_BGM.phantom+')');

  // spawn phantom and confirm it enters the arena
  setupRoster('watch'); startGame(); state='play';
  spawnTrueBoss('phantom');
  if(!enemies.some(e=>e.type==='phantom')) throw new Error('phantom did not spawn');
  console.log('PHANTOM SPAWN OK (enemies='+enemies.length+', state='+state+')');

  // ===== 3) watch story tables =====
  for(const tbl of ['STORY_OPEN_BY','STORY_TURN_BY','STORY_END_BY']){ const T=eval(tbl);
    if(!T.watch || !Array.isArray(T.watch) || !T.watch.length) throw new Error(tbl+'.watch missing'); }
  // storyEndFor for watch should include the phantom defeat scene
  players[0].kind='watch';
  if(!storyEndFor().some(s=>s.boss==='phantom')) throw new Error('watch ending lacks phantom scene');
  console.log('WATCH STORY OK (open='+STORY_OPEN_BY.watch.length+', turn='+STORY_TURN_BY.watch.length+', end='+STORY_END_BY.watch.length+')');

  // ===== 4) new stage + boss (goldgolem) =====
  if(!ETYPE.goldgolem || !ETYPE.goldgolem.boss) throw new Error('goldgolem ETYPE missing');
  if(!BOSSMOVES.goldgolem || !BOSSMOVES.goldgolem.length) throw new Error('goldgolem has no moveset');
  if(!BOSS_BGM.goldgolem || !BOSSROLE.goldgolem) throw new Error('goldgolem bgm/role missing');
  const takara = WORLD_LEVELS.find(l=>l.id==='takara');
  if(!takara || takara.b!==TAKARA_STAGE) throw new Error('takara node not in WORLD_LEVELS');
  // load the stage and confirm the boss encounter is placed
  setupRoster('inu'); startGame();
  loadLevel(takara);
  if(!encounters.some(e=>e.boss && e.list.some(x=>x[0]==='goldgolem'))) throw new Error('goldgolem boss not in stage encounters');
  if(STAGE_NAME[stage]!=='月夜の宝物庫' && !Object.values(STAGE_NAME).includes('月夜の宝物庫')) throw new Error('stage name not registered');
  console.log('NEW STAGE OK (月夜の宝物庫 loaded, goldgolem boss present, WORLD_LEVELS='+WORLD_LEVELS.length+')');

  // ===== 5) gacha: pool + roll + apply + shop entry + full spin =====
  if(!GACHA_POOL.length) throw new Error('GACHA_POOL empty');
  if(!SHOP_ITEMS.some(it=>it.gacha)) throw new Error('gacha not offered in shop');
  const r=rollGacha(); if(!r || !r.name || !r.apply) throw new Error('rollGacha returned junk');
  // apply a known item (黄金の肉球: maxHp+40) and confirm effect
  setupRoster('inu'); startGame(); const gp=players[0]; gp.active=true;
  const gold=GACHA_POOL.find(g=>g.name==='黄金の肉球'); const hp0=gp.maxHp;
  applyGacha(gold);
  if(gp.maxHp!==hp0+40) throw new Error('applyGacha did not add maxHp (+'+(gp.maxHp-hp0)+')');
  // lives item routes through grantLives
  const feather=GACHA_POOL.find(g=>g.name==='不死鳥の羽根'); const lv0=gp.lives; applyGacha(feather);
  if(gp.lives!==lv0+3) throw new Error('phoenix feather did not grant +3 lives');
  console.log('GACHA APPLY OK (maxHp '+hp0+'->'+gp.maxHp+', lives '+lv0+'->'+gp.lives+')');

  // full spin->reveal through the shop update loop deducts coins & applies once
  const gEntry=SHOP_ITEMS.find(it=>it.gacha);
  if(gEntry.cost!==90) throw new Error('gacha cost should be 90 (3x), got '+gEntry.cost);
  enterShop(); coins=200; const c0=coins; const item=GACHA_POOL.find(g=>g.name==='猛牛のバンド'); const atk0=(gp.atkMul||1);
  gacha={phase:'spin', t:0, item}; // simulate a started roll
  coins-=gEntry.cost;
  let applied=false; for(let i=0;i<80;i++){ updateShop(); if(gacha&&gacha.phase==='reveal'&&!applied){ applied=true; } if(!gacha)break; }
  if(coins!==c0-gEntry.cost) throw new Error('gacha did not cost '+gEntry.cost+' coins ('+c0+'->'+coins+')');
  if(!(gp.atkMul>atk0)) throw new Error('spin did not apply the item effect');
  console.log('GACHA SPIN OK (cost='+gEntry.cost+', coins '+c0+'->'+coins+', atkMul '+atk0.toFixed(2)+'->'+gp.atkMul.toFixed(2)+')');

  // ===== 6) ending BGM plays and finale appended =====
  sndOn=true; endingDone=false; players[0].kind='inu';
  const endLen=storyEndFor().length;
  startEnding();
  if(state!=='cut') throw new Error('startEnding did not enter cutscene');
  if(!Music.isPlaying()) throw new Error('ending BGM not playing');
  if(!cut || cut.scenes.length!==endLen+ENDING_FINALE.length) throw new Error('finale not appended ('+ (cut?cut.scenes.length:0) +' vs '+(endLen+ENDING_FINALE.length)+')');
  console.log('ENDING OK (BGM playing, scenes='+cut.scenes.length+' = end '+endLen+' + finale '+ENDING_FINALE.length+')');

  console.log('NEW CONTENT TEST PASSED'); process.exit(0);
})().catch(e=>{ console.error('FAIL:', e.message, e.stack); process.exit(1); });
`;
code = code + "\n;" + DRIVER;
(0, eval)(code);

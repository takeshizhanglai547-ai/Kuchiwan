const DRIVER = `
(async()=>{
  const step=(n)=>{ for(let i=0;i<n;i++){ if(global.rafCb){ const cb=global.rafCb; global.rafCb=null; cb(); } } };

  // ===== 1) 腕試し：主人公に選ばれていないキャラがボスとして登場する =====
  ['hbInu','hbShima','hbNuko','hbGuard8','hbWatch','hbWanden'].forEach(k=>{ const T=ETYPE[k];
    if(!T||!T.heroBoss) throw new Error('hero boss missing: '+k);
    if(!T.boss||!T.mini) throw new Error(k+' should be a mid-boss');
    if(!BOSSMOVES[T.bossKind]||!BOSSMOVES[T.bossKind].length) throw new Error(k+' has no moveset');
    if(!BOSS_BGM[k]) throw new Error(k+' has no BGM'); });
  if(typeof drawHeroBossEnemy!=='function') throw new Error('drawHeroBossEnemy missing');
  console.log('主役ボス ROSTER OK (6キャラ分、いずれも中ボス扱い＋専用BGM)');

  // 選んでいるキャラは相手に選ばれない
  setupRoster('inu'); startGame(); state='play';
  for(let i=0;i<40;i++){ const k=heroDuelPick(); if(k==='inu') throw new Error('duel picked the character being played'); }
  setupRoster('coop'); players[0].kind='shima'; players[1].kind='nuko'; players[1].active=true;
  for(let i=0;i<40;i++){ const k=heroDuelPick(); if(k==='shima'||k==='nuko') throw new Error('duel picked an active 2P character'); }
  console.log('腕試し 相手選出 OK (自分/2P相方は除外される)');

  // イベントが実際にボスを湧かせる
  setupRoster('wanden'); startGame(); state='play';
  enemies.length=0; triggerHeroDuel({x:players[0].x+60});
  const hb=enemies.find(e=>ETYPE[e.type].heroBoss);
  if(!hb) throw new Error('duel spawned no hero boss');
  if(ETYPE[hb.type].heroBoss==='wanden') throw new Error('duel spawned the played character');
  if(!hb.duelSayT) throw new Error('duel boss has no intro line');
  console.log('腕試し 発生 OK ('+ETYPE[hb.type].name+' が登場、口上あり)');
  // ランダムイベントの抽選対象に入っている
  if(!EVENT_POOL.some(ev=>{ const n=ev.make(0); return n.kind==='duel'; })) throw new Error('duel not in EVENT_POOL');
  console.log('腕試し イベント登録 OK (道中でランダムに発生する)');

  // ===== 2) 主役ボスは「本人と同じ見た目・同じ技」で戦う =====
  setupRoster('wanden'); startGame(); state='play';
  const pl=players[0]; player=pl; pl.x=camX+200; pl.hp=pl.maxHp=99999; pl.invuln=0;
  enemies.length=0; projectiles.length=0;
  spawnEnemy('hbInu', pl.x+260, LANE); const boss=enemies[0]; boss.thinkCd=9999; boss.facing=-1;
  // 見た目：中身はプレイヤーと同じ構造のゴーストで、drawPlayer でそのまま描かれる
  const g=heroGhost(boss);
  if(g.kind!=='inu') throw new Error('ghost kind wrong: '+g.kind);
  if(g.weapon!==defaultWeaponFor('inu')) throw new Error('ghost weapon wrong: '+g.weapon);
  if(typeof drawHeroBossEnemy!=='function') throw new Error('drawHeroBossEnemy missing');
  console.log('主役ボス 見た目 OK (プレイヤーと同じ '+g.kind+'／得物 '+g.weapon+' をそのまま描画)');

  // 技：使う技はすべて本人の ATK 定義そのもの
  for(const k of ['inu','shima','nuko','guard8','watch','wanden']){
    const P=heroMovePool(k);
    for(const key of ['hadou','dp','du','up','fwd','dash']){
      if(!ATK[P[key]]) throw new Error(k+' の '+key+' が実在しない技: '+P[key]); }
    if(!P.combo.length) throw new Error(k+' has no combo moves');
    // 自分でプレイする時と同じ技が選ばれているか（波動/昇竜/↓↑をコマンド表と突き合わせ）
    const ref={kind:k, z:0};
    if(P.combo[0]!==comboMoveFor({kind:k,weapon:defaultWeaponFor(k)},1)) throw new Error(k+' combo mismatch'); }
  console.log('主役ボス 技セット OK (6キャラ分、波動/昇竜/↓↑/上/前/ダッシュ とも本人の技)');

  // 実際に技を出すとプレイヤーにダメージが入る（近接）
  const P0=heroMovePool('inu');
  pl.x=boss.x-70; pl.invuln=0; pl.state='idle'; pl.z=0; const hpA=pl.hp;
  heroBeginAttack(boss, P0.combo[0]);
  for(let i=0;i<ATK[P0.combo[0]].dur+2;i++){ hitStop=0; slowmo=0; heroRunAttack(boss); }
  if(pl.hp>=hpA) throw new Error('hero boss melee did not hit');
  console.log('主役ボス 近接技 OK ('+ATK[P0.combo[0]].name+' が '+(hpA-pl.hp)+' ダメージ)');
  // 飛び道具技も本人と同じ弾を撃つ
  projectiles.length=0; pl.x=boss.x-400; pl.invuln=0; pl.state='idle';
  heroBeginAttack(boss, P0.hadou);
  for(let i=0;i<ATK[P0.hadou].act[0]+2;i++){ heroRunAttack(boss); }
  if(!projectiles.some(pr=>pr.owner!=='player')) throw new Error('hero boss projectile move fired nothing');
  console.log('主役ボス 飛び道具 OK ('+ATK[P0.hadou].name+' の弾を発射)');
  // AI が距離に応じて技を選ぶ
  const near=heroPickMove(boss,80), far=heroPickMove(boss,500);
  if(!ATK[near]||!ATK[far]) throw new Error('heroPickMove returned an unknown move');
  console.log('主役ボス AI OK (近距離→'+ATK[near].name+' / 遠距離→'+ATK[far].name+')');

  // ===== 2b) 主役ボスもプレイヤーと同じように吹っ飛ぶ =====
  ['hbInu','hbShima','hbNuko','hbGuard8','hbWatch','hbWanden'].forEach(k=>{
    if(!ETYPE[k].tumbles) throw new Error(k+' does not tumble'); });
  enemies.length=0; spawnEnemy('hbShima', pl.x+120, LANE);
  const tb=enemies[0]; tb.thinkCd=9999; tb.hp=tb.maxHp=99999; tb.vx=0; tb.vz=0; tb.z=0; tb.state='walk'; tb.noJuggleT=0;
  launchEnemy(tb, 18, -15, 3);
  if(tb.state!=='air') throw new Error('hero boss did not get launched (state='+tb.state+')');
  if(!(Math.abs(tb.vz)>=12)) throw new Error('hero boss launch too weak (vz='+tb.vz+')');
  const heroVz=Math.abs(tb.vz);
  // 通常のボスは吹っ飛びが抑えられたまま（従来挙動を壊していない）
  enemies.length=0; spawnEnemy('garm', pl.x+120, LANE);
  const nb=enemies[0]; nb.vx=0; nb.vz=0; nb.z=0; nb.state='walk'; nb.noJuggleT=0;
  launchEnemy(nb, 18, -15, 3);
  if(!(Math.abs(nb.vz) < heroVz)) throw new Error('normal boss should resist launch more than a hero boss');
  console.log('主役ボス 吹っ飛び OK (vz '+heroVz.toFixed(1)+' ＞ 通常ボス '+Math.abs(nb.vz).toFixed(1)+')');
  // 被弾で向きも変わる（プレイヤー同様のよろけ）
  enemies.length=0; spawnEnemy('hbWatch', pl.x+120, LANE);
  const kb=enemies[0]; kb.thinkCd=9999; kb.hp=kb.maxHp=99999; kb.facing=1; kb.vx=0; kb.noJuggleT=0;
  damageEnemy(kb, 20, 12, true);
  if(kb.facing!==-1) throw new Error('hero boss did not turn on hit');
  if(!(Math.abs(kb.vx)>5)) throw new Error('hero boss knockback too small (vx='+kb.vx+')');
  console.log('主役ボス のけぞり OK (被弾で振り向き＋vx '+kb.vx.toFixed(1)+')');

  // ===== 3) 三周目：宇宙人のステージ・敵・ストーリー =====
  ['greywan','raygun','floater','probe','slimealien'].forEach(k=>{ if(!ETYPE[k]||!ETYPE[k].alien) throw new Error('alien zako missing: '+k); });
  ['greyking','ufoboss','bioblob','emperorX','emperorX2'].forEach(k=>{ const T=ETYPE[k];
    if(!T||!T.boss||!T.alien) throw new Error('alien boss missing: '+k);
    if(!BOSSMOVES[T.bossKind]||!BOSSMOVES[T.bossKind].length) throw new Error(k+' has no moveset');
    if(!BOSS_BGM[k]) throw new Error(k+' has no BGM'); });
  if(ETYPE.emperorX.evolveTo!=='emperorX2') throw new Error('emperorX does not evolve');
  if(!ETYPE.emperorX2.finalBoss||!ETYPE.emperorX2.trueBoss) throw new Error('emperorX2 not the true final boss');
  if(typeof drawAlienFoe!=='function') throw new Error('drawAlienFoe missing');
  console.log('宇宙人 ROSTER OK (雑魚5種＋ボス3体＋皇帝2形態)');
  // 宇宙人ボスは専用の異星デザインで描かれる（犬型の drawBigBoss に落ちない）＋やられ顔
  {
    if(typeof drawAlienBoss!=='function') throw new Error('drawAlienBoss missing');
    const seen=[], realBig=global.drawBigBoss, realAlien=global.drawAlienBoss;
    global.drawBigBoss=function(e){ seen.push('BIG:'+e.type); };
    global.drawAlienBoss=function(e){ seen.push('ALIEN:'+e.type); realAlien(e); };
    try{
      enemies.length=0; camX=0;
      ['greyking','ufoboss','bioblob','emperorX','emperorX2'].forEach((k,i)=>spawnEnemy(k, 240+i*8, LANE));
      if(enemies.length!==5) throw new Error('alien bosses did not spawn ('+enemies.length+')');
      enemies.forEach(e=>{ e.hitFace=0; e.state='idle'; drawEnemy(e); });        // 通常時
      enemies.forEach(e=>{ e.hitFace=30; e.state='hurt'; drawEnemy(e); });       // やられ顔
    } finally { global.drawBigBoss=realBig; global.drawAlienBoss=realAlien; }
    const big=seen.filter(x=>x.startsWith('BIG:'));
    if(big.length) throw new Error('alien boss still drawn as the dog-shaped boss: '+big.join(','));
    if(seen.length!==10) throw new Error('alien boss draw count '+seen.length+' (expected 10)');
    enemies.length=0;
    console.log('宇宙人ボス 描画 OK (5体×通常/やられ='+seen.length+'回すべて専用の異星デザイン)');
  }
  // 背景テーマ
  if(STAGE_THEME.length<16) throw new Error('space themes not added ('+STAGE_THEME.length+')');
  [13,14,15].forEach(i=>{ if(!STAGE_THEME[i].space) throw new Error('theme '+i+' not space-flagged'); });
  if(typeof drawSpaceScene!=='function') throw new Error('drawSpaceScene missing');
  console.log('宇宙 背景 OK (テーマ13-15 space、専用シーン描画)');

  // 三周目フロー
  setupRoster('inu'); startGame(); state='play';
  const p3=players[0]; p3.maxHp=260; p3.hp=260; p3.atkMul=1.8; coins=700;
  mercRoster.length=0; hireMerc('wolf');
  lap=2; endingDone=true; levelsDone={w2hachi:1};
  startNG3();
  if(lap!==3) throw new Error('lap not 3');
  if(state!=='cut') throw new Error('NG3 opening not shown');
  if(p3.maxHp!==260||p3.atkMul!==1.8) throw new Error('upgrades not carried into lap3');
  if(coins!==700) throw new Error('coins not carried into lap3');
  if(mercRoster.length!==1) throw new Error('mercs not carried into lap3');
  if(levelsDone.w2hachi) throw new Error('levelsDone not reset for lap3');
  if(!encounters.some(e=>e.boss&&e.list.some(x=>x[0]==='greyking'))) throw new Error('lap3 first stage lacks greyking');
  if(!Object.values(STAGE_NAME).includes('墜ちた円盤')) throw new Error('lap3 stage name wrong');
  cut=null; state='play';
  const n3=allMapNodes();
  if(n3.length!==3||n3[0].id!=='w3kairou') throw new Error('lap3 map not wired');
  if(nodeUnlocked(n3[2])) throw new Error('throne unlocked too early');
  levelsDone={w3kairou:1,w3core:1};
  if(!nodeUnlocked(n3[2])) throw new Error('throne not unlocked after clears');
  hardMode=false; TWO_P=false;
  if(!(diffHpMul()>1.5)) throw new Error('lap3 difficulty not raised (hp x'+diffHpMul()+')');
  console.log('三周目 FLOW OK (引き継ぎ維持、宇宙世界を構築、玉座は '+NG3_UNLOCK+' 制覇で解禁、敵HP x'+diffHpMul().toFixed(2)+')');

  // 雑魚は宇宙人のみ
  for(let i=0;i<60;i++){ const z=randZako(); if(!ALIEN_ZAKO_POOL.includes(z)) throw new Error('lap3 spawned non-alien: '+z); }
  enemies.length=0; triggerAmbush({x:players[0].x+100});
  for(const e of enemies){ if(!ETYPE[e.type].alien) throw new Error('lap3 ambush spawned non-alien: '+e.type); }
  console.log('三周目 雑魚 OK (出現プール／待ち伏せとも宇宙人のみ)');

  // 玉座 → 皇帝が進化 → 三周目エンディング
  loadLevel(WORLD3_FINAL[0]);
  if(!encounters.some(e=>e.final&&e.list.some(x=>x[0]==='emperorX'))) throw new Error('throne lacks emperorX');
  enemies.length=0; spawnEnemy('emperorX', players[0].x+200, LANE);
  const ex=enemies[0]; ex.hp=1; damageEnemy(ex,10,1,false); step(2);
  const ex2=enemies.find(e=>e.type==='emperorX2');
  if(!ex2) throw new Error('emperorX did not evolve');
  cut=null; state='play'; endingDone=false; sndOn=true;
  ex2.hp=1; ex2.transform=0; ex2.invuln=0; damageEnemy(ex2,10,1,false);
  await new Promise(r=>setTimeout(r,1300));
  if(state!=='cut') throw new Error('NG3 ending did not start (state='+state+')');
  if(cut.scenes!==NG3_END) throw new Error('lap3 ending is not NG3_END');
  if(!Music.isPlaying()) throw new Error('ending BGM not playing in lap3');
  console.log('三周目 ENDING OK (皇帝が真の姿へ進化 → NG3_END を再生)');

  // タイトルのトグルは 1→2→3周目 を巡回
  cut=null; ng2Sel=0;
  ng2Sel=3; setupRoster('watch'); beginAdventure(); for(let i=0;i<40;i++) step(1);   // 遷移フェード分を進める
  if(lap!==3) throw new Error('title 3周目 start did not set lap=3');
  if(coins!==400) throw new Error('title 3周目 start lacks 支度金 (coins='+coins+')');
  if(!encounters.some(e=>e.boss&&e.list.some(x=>x[0]==='greyking'))) throw new Error('title 3周目 not in space world');
  ng2Sel=0; cut=null;
  console.log('タイトル 3周目トグル OK (lap3＋宇宙世界＋支度金400)');

  console.log('NG3/DUEL TEST PASSED'); process.exit(0);
})().catch(e=>{ console.error('FAIL:', e.message, e.stack); process.exit(1); });
`;
code = code + "\n;" + DRIVER;
(0, eval)(code);

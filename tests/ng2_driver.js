const DRIVER = `
(async()=>{
  const step=(n)=>{ for(let i=0;i<n;i++){ if(global.rafCb){ const cb=global.rafCb; global.rafCb=null; cb(); } } };

  // ===== 1) insect enemies + bosses exist with bug concept =====
  ['kamakiri','hachibo','kabuto','kumo'].forEach(k=>{ if(!ETYPE[k]||!ETYPE[k].bug) throw new Error('insect zako missing/not bug: '+k); });
  ['kamaboss','queenbee','kuwaboss','spidboss'].forEach(k=>{ const T=ETYPE[k];
    if(!T||!T.boss||!T.bug) throw new Error('insect boss missing/not bug: '+k);
    if(!BOSSMOVES[T.bossKind]||!BOSSMOVES[T.bossKind].length) throw new Error(k+' has no moveset');
    if(!BOSS_BGM[k]) throw new Error(k+' has no BGM'); });
  console.log('INSECT ROSTER OK (4 zako + 4 bosses, all bug-flagged)');

  // ===== 2) cham/chamurus true-boss chain =====
  if(ETYPE.chamboss.evolveTo!=='chamurus') throw new Error('chamboss does not evolve to chamurus');
  if(!ETYPE.chamurus.finalBoss||!ETYPE.chamurus.trueBoss) throw new Error('chamurus not flagged final+true boss');
  if(BOSS_BGM.chamurus!=='bosschamu') throw new Error('chamurus lacks dedicated BGM');
  if(!CHAM_PRE.length||!NG2_OPEN.length||!NG2_END.length) throw new Error('NG2 cutscenes missing');
  console.log('CHAM TRUE BOSS OK (chamboss->chamurus, bgm=bosschamu, cutscenes present)');

  // ===== 3) NG+ world: themes, battle tracks, map =====
  if(STAGE_THEME.length<13) throw new Error('insect themes not added ('+STAGE_THEME.length+')');
  [9,10,11,12].forEach(i=>{ if(!STAGE_THEME[i].bug) throw new Error('theme '+i+' not bug-flagged'); });
  if(WORLD2_LEVELS.length!==3||!WORLD2_FINAL.length) throw new Error('WORLD2 nodes wrong');
  console.log('BUG WORLD OK (themes 9-12 bug, WORLD2 3+1 nodes)');

  // ===== 4) lap-2 flow: startNG2 keeps upgrades, swaps world =====
  setupRoster('inu'); startGame(); state='play';
  const p=players[0]; p.maxHp=200; p.hp=200; p.atkMul=1.5; coins=500;
  levelsDone={yugure:1}; endingDone=true;
  startNG2();
  if(lap!==2) throw new Error('lap not 2');
  if(state!=='cut') throw new Error('NG2 opening cutscene not shown');
  if(p.maxHp!==200||p.atkMul!==1.5) throw new Error('upgrades not carried over');
  if(coins!==500) throw new Error('coins not carried over');
  if(levelsDone.yugure) throw new Error('levelsDone not reset for lap2');
  if(endingDone) throw new Error('endingDone not reset');
  // world rebuilt with insect first stage
  if(!encounters.some(e=>e.boss&&e.list.some(x=>x[0]==='kamaboss'))) throw new Error('lap2 first stage lacks kamaboss');
  if(!Object.values(STAGE_NAME).includes('大輪の花園')) throw new Error('lap2 stage name wrong');
  // map is lap-aware
  cut=null; state='play';
  const nodes=allMapNodes();
  if(nodes.length!==4||nodes[0].id!=='w2hachi') throw new Error('allMapNodes not lap-aware');
  if(nodeUnlocked(nodes[3])) throw new Error('queen chamber unlocked too early');
  levelsDone={w2hachi:1,w2kumo:1,w2ari:1};
  if(!nodeUnlocked(nodes[3])) throw new Error('queen chamber not unlocked after 3 clears');
  console.log('NG2 FLOW OK (carryover kept, insect world built, map gated at '+NG2_UNLOCK+')');
  // difficulty scales up in lap2
  hardMode=false; TWO_P=false;
  if(!(diffHpMul()>1&&diffDmgMul()>1)) throw new Error('lap2 difficulty not raised');
  console.log('NG2 DIFFICULTY OK (hp x'+diffHpMul().toFixed(2)+', dmg x'+diffDmgMul().toFixed(2)+')');

  // ===== 5) queen chamber -> chamboss evolves -> chamurus -> NG2 ending =====
  loadLevel(WORLD2_FINAL[0]);
  if(!encounters.some(e=>e.final&&e.list.some(x=>x[0]==='chamboss'))) throw new Error('queen chamber lacks final chamboss');
  enemies.length=0; spawnEnemy('chamboss', players[0].x+200, LANE);
  const cb=enemies[0]; cb.hp=1;
  damageEnemy(cb, 10, 1, false); step(2);
  const evolved=enemies.find(e=>e.type==='chamurus');
  if(!evolved) throw new Error('chamboss did not evolve into chamurus');
  console.log('CHAM EVOLVE OK (chamboss -> chamurus at hp 0)');
  // kill chamurus -> NG2 ending with lap-2 scenes
  cut=null; state='play'; endingDone=false; sndOn=true;
  evolved.hp=1; evolved.transform=0; evolved.invuln=0;   // 進化演出の無敵を解除してから撃破
  damageEnemy(evolved, 10, 1, false);
  await new Promise(r=>setTimeout(r,1300));
  if(state!=='cut') throw new Error('NG2 ending did not start (state='+state+')');
  if(cut.scenes!==NG2_END) throw new Error('lap2 ending is not NG2_END');
  if(!Music.isPlaying()) throw new Error('ending BGM not playing in lap2');
  console.log('NG2 ENDING OK (NG2_END scenes, ending BGM playing)');

  // ===== 6) mercenary system =====
  cut=null;
  setupRoster('inu'); startGame(); state='play';
  ['wolf','mechawan','onibouzu'].forEach(k=>{ if(!SHOP_ITEMS.some(it=>it.merc===k)) throw new Error('merc item missing: '+k); });
  coins=1000; hireMerc('wolf'); hireMerc('mechawan');
  if(mercRoster.length!==2) throw new Error('hire failed');
  spawnMercs();
  if(mercs.length!==2) throw new Error('mercs did not spawn');
  // merc attacks a nearby enemy
  enemies.length=0; spawnEnemy('corgi', mercs[0].x+50, LANE);
  const foe=enemies[0]; foe.thinkCd=9999; foe.hp=foe.maxHp=9999; foe.state='idle';
  mercs[0].atkCd=0;
  for(let i=0;i<80;i++){ hitStop=0; slowmo=0; foe.state='idle'; foe.thinkCd=9999; updateMercs(); }
  if(foe.hp>=9999) throw new Error('merc never damaged the enemy');
  console.log('MERC ATTACK OK (dealt '+(9999-foe.hp)+' dmg to nearby enemy)');
  // merc takes damage from attacking enemies and can fall
  enemies.length=0; spawnEnemy('wolf', mercs[0].x+20, LANE);
  const atkE=enemies[0]; atkE.hp=atkE.maxHp=99999;
  mercs[0].hp=1; mercs[0].r.hp=1; const rosterLen=mercRoster.length;
  for(let i=0;i<200 && mercRoster.length===rosterLen;i++){ atkE.state='attack'; atkE.x=mercs.length?mercs[0].x+20:atkE.x; mercs.length&&(mercs[0].hurtT=0); updateMercs(); }
  if(mercRoster.length!==rosterLen-1) throw new Error('merc did not fall when hp exhausted');
  console.log('MERC KO OK (fallen merc removed from roster: '+rosterLen+'->'+mercRoster.length+')');
  // shop purchase path + cap
  enterShop(); coins=1000; mercRoster.length=0; gacha=null;
  const mi=SHOP_ITEMS.findIndex(it=>it.merc==='wolf'); shopSel=mi;
  players[0].in.pressed.atk=true; updateShop();
  if(mercRoster.length!==1) throw new Error('shop merc purchase failed');
  const cAfter=coins; if(cAfter!==1000-SHOP_ITEMS[mi].cost) throw new Error('merc price not charged');
  hireMerc('wolf');   // fill to cap (MERC_MAX=2)
  players[0].in.pressed.atk=true; updateShop();
  if(mercRoster.length!==2) throw new Error('merc cap not enforced ('+mercRoster.length+')');
  console.log('MERC SHOP OK (bought via shop, price charged, cap '+MERC_MAX+' enforced)');

  // ===== 7) title-screen NG+ toggle: start lap2 directly with fresh character =====
  ng2Sel=2; setupRoster('shima'); beginAdventure(); for(let i=0;i<40;i++) step(1);   // 遷移フェード分を進める
  if(lap!==2) throw new Error('title NG2 start did not set lap=2');
  if(state!=='cut') throw new Error('title NG2 start skipped opening cutscene');
  if(coins!==200) throw new Error('title NG2 start lacks 支度金 (coins='+coins+')');
  if(!encounters.some(e=>e.boss&&e.list.some(x=>x[0]==='kamaboss'))) throw new Error('title NG2 start not in bug world');
  ng2Sel=0; cut=null;
  // OFF時は従来どおり一周目オープニング（lapはオープニング後のstartGameで1に戻る）
  setupRoster('inu'); beginAdventure(); for(let i=0;i<40;i++) step(1);
  if(state!=='cut') throw new Error('normal start lacks opening');
  { const cb=cut.onDone; cut=null; cb(); }   // カットシーンを完了させてゲーム開始
  if(lap!==1) throw new Error('normal start should be lap1 after opening (lap='+lap+')');
  console.log('TITLE NG2 TOGGLE OK (ON: lap2+bug world+200c / OFF: lap1 opening)');

  console.log('NG2/MERC TEST PASSED'); process.exit(0);
})().catch(e=>{ console.error('FAIL:', e.message, e.stack); process.exit(1); });
`;
code = code + "\n;" + DRIVER;
(0, eval)(code);

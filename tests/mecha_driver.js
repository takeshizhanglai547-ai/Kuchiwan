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
  // ══════════════════════════════════════════════════════════════
  // ここから下は監査で足した検査。上の「例外が出ないか」だけでは
  // 章のテーマ番号の取り違え・マップの空振り・専用の絵が呼ばれない、
  // といった改変が22件中18件そのまま素通りした（2026-08-26 の実測）
  // ══════════════════════════════════════════════════════════════

  // ===== 章とテーマ：6章が「メカのテーマ」を1つずつ使うこと =====
  // 存在検査だけだと、他周回のテーマ番号（例：3＝業火の渓谷）を書いても通ってしまう
  { const th=MECHA_CH.map(function(b){ return b.theme; });
    if(new Set(th).size!==MECHA_CH.length) throw new Error('章どうしでテーマ番号が重複: '+th.join(','));
    MECHA_CH.forEach(function(b){ const T=STAGE_THEME[b.theme];
      if(!T) throw new Error(b.name+' のテーマ'+b.theme+' が無い');
      if(!T.mecha) throw new Error(b.name+' のテーマ'+b.theme+'('+T.land+') は機械の国のテーマではない');
      if(!T.land || !LAND[T.land]) throw new Error(b.name+' のテーマ'+b.theme+' の地形 '+T.land+' が未実装'); });
    const lands=MECHA_CH.map(function(b){ return STAGE_THEME[b.theme].land; });
    if(new Set(lands).size!==lands.length) throw new Error('章どうしで地形が重複: '+lands.join(','));
    console.log('章とテーマ OK ('+lands.join(' / ')+')'); }

  // ===== マップ：6章が過不足なく置かれ、六周目に実際に引かれること =====
  { lap=6;
    if(WORLD6_LEVELS.length!==5) throw new Error('六周目の通常ステージが '+WORLD6_LEVELS.length+' 件');
    if(WORLD6_FINAL.length!==1) throw new Error('六周目の最終ステージが '+WORLD6_FINAL.length+' 件');
    if(curWorldLevels()!==WORLD6_LEVELS) throw new Error('curWorldLevels() が六周目のマップを返さない');
    const all=allMapNodes();
    if(all.length!==6) throw new Error('allMapNodes() が '+all.length+' 件');
    if(all.indexOf(WORLD6_FINAL[0])<0) throw new Error('allMapNodes() に大王座が入っていない');
    const used=all.map(function(n){ return MECHA_CH.indexOf(n.b); });
    if(used.indexOf(-1)>=0) throw new Error('MECHA_CH に無い章がマップに載っている');
    if(new Set(used).size!==MECHA_CH.length) throw new Error('マップに載らない章がある（使われた章 '+new Set(used).size+' / 全 '+MECHA_CH.length+'）');
    if(!WORLD6_FINAL[0].final) throw new Error('大王座に final が立っていない');
    console.log('マップ OK (通常5＋最終1、章6つを過不足なく使用)'); }

  // ===== 開幕の区画と、章ごとの掛け合い =====
  { setupRoster('inu'); startGame(); state='play'; startNG6(true);
    // 地図に入る前に歩く最初の区画は、地図の1つ目のステージと同じ章であること
    if(STAGE_NAME[stage]!==WORLD6_LEVELS[0].b.name)
      throw new Error('六周目の開始区画が地図の一番目と違う: '+STAGE_NAME[stage]+' / '+WORLD6_LEVELS[0].b.name);
    // ステージを出るときの相棒の返し。章名をキーに引くので、章名を変えると黙って既定文へ落ちる
    MECHA_CH.forEach(function(b){ if(!PARTNER_LINE[b.name])
      throw new Error(b.name+' に相棒の返しが無い（PARTNER_LINE のキーと章名がずれている）'); });
    console.log('開幕の区画と掛け合い OK ('+STAGE_NAME[stage]+'から開始)'); }

  // ===== 解禁：規定数まではロック、届いたら開くこと =====
  { lap=6; const fin=WORLD6_FINAL[0];
    if(!(NG6_UNLOCK>=1 && NG6_UNLOCK<=WORLD6_LEVELS.length))
      throw new Error('NG6_UNLOCK='+NG6_UNLOCK+' では大王座に永久に届かない（通常ステージは '+WORLD6_LEVELS.length+' 件）');
    levelsDone={}; if(nodeUnlocked(fin)) throw new Error('制覇0で大王座が開いている');
    for(let i=0;i<NG6_UNLOCK-1;i++) levelsDone[WORLD6_LEVELS[i].id]=1;
    if(nodeUnlocked(fin)) throw new Error('制覇'+(NG6_UNLOCK-1)+'で大王座が開いている');
    levelsDone[WORLD6_LEVELS[NG6_UNLOCK-1].id]=1;
    if(!nodeUnlocked(fin)) throw new Error('制覇'+NG6_UNLOCK+'でも大王座が開かない');
    if(!nodeUnlocked(WORLD6_LEVELS[3])) throw new Error('通常ステージが開いていない');
    levelsDone={};
    console.log('解禁 OK (制覇'+NG6_UNLOCK+'で大王座)'); }

  // ===== 実際に各ステージを読み込んで、ボスと中ボスが道中に立つこと =====
  // 「ETYPE にある」だけでは、どのゲートにも書かれていない敵を見逃す
  { lap=6; keyHeld={}; eventDone={};
    grantKeysFor('w6mon','clear'); grantKeysFor('w6kou','clear');   // 封鎖区画と予備炉心の鍵
    const seenBoss={}, seenMini={}, seenZako={};
    allMapNodes().forEach(function(n){ loadLevel(n);
      encounters.forEach(function(E){ E.list.forEach(function(q){
        if(E.boss) seenBoss[q[0]]=1; else if(E.mini) seenMini[q[0]]=1; else seenZako[q[0]]=1; }); }); });
    ['mkGolem','mkTurret','mkArc','mkSwarm','mkMirror','mkOmega'].forEach(function(k){
      if(!seenBoss[k]) throw new Error('ボス '+k+' はどのステージにも出てこない'); });
    ['mkMScout','mkMArms','mkMCoil','mkMWing','mkMHammer','mkMOld','mkVault'].forEach(function(k){
      if(!seenMini[k]) throw new Error('中ボス '+k+' はどのステージにも出てこない'); });
    MECHA_ZAKO_POOL.forEach(function(k){ if(!seenZako[k]) throw new Error('雑魚 '+k+' はどのゲートにも書かれていない'); });
    console.log('道中 OK (ボス6・中ボス7・雑魚'+MECHA_ZAKO_POOL.length+'すべてが道中に出る)'); }

  // ===== 専用の絵が本当に呼ばれること =====
  // drawEnemy の分岐を消しても「例外が出ない」ので、描画検査だけでは気付けない
  { const realFoe=drawMechaFoe, realKing=drawMechaKing;
    let nf=0, nk=0;
    drawMechaFoe=function(){ nf++; return realFoe.apply(null,arguments); };
    drawMechaKing=function(){ nk++; return realKing.apply(null,arguments); };
    try{
      MECHA_ZAKO_POOL.forEach(function(k){ enemies.length=0; spawnEnemy(k,660,LANE); enemies.forEach(drawEnemy); });
      const zk=nf;
      enemies.length=0; spawnEnemy('mkOmega',660,LANE); enemies.forEach(drawEnemy);
      if(zk!==MECHA_ZAKO_POOL.length) throw new Error('雑魚'+MECHA_ZAKO_POOL.length+'種のうち drawMechaFoe が呼ばれたのは '+zk+' 種');
      if(nk!==1) throw new Error('王機の描画に drawMechaKing が呼ばれていない（'+nk+'回）');
      // 将と中ボスも機械の絵で出ること。既存のボス体型を流用していたころは、
      // 電磁将が青い毛むくじゃらの生き物、鋼牙将が灰色の獣として出ていた
      nk=0; enemies.length=0; spawnEnemy('mkGolem',660,LANE); enemies.forEach(drawEnemy);
      if(nk!==1) throw new Error('将が機械の絵で描かれていない（流用だと獣が出る）');
    } finally { drawMechaFoe=realFoe; drawMechaKing=realKing; }
    console.log('専用の絵 OK (雑魚10種は drawMechaFoe／王機は drawMechaKing)'); }

  // ===== 王機が被弾を絵で返すこと =====
  // 他のボスは hurtEye で顔が歪むが、王機には顔が無い。単眼の色でしか返せないので
  // 「enemyHurt を読んでいるだけで使っていない」状態になりやすい
  { enemies.length=0; spawnEnemy('mkOmega',660,LANE); const e=enemies[0]; e.anim=1.0; gf=40;
    function ops(){ const real=ctx; const out=[];
      ctx=new Proxy(real,{ get(t,k){ const v=t[k];
          if(typeof v==='function') return function(){ return v.apply(t,arguments); }; return v; },
        set(t,k,v){ out.push(k+'='+String(v)); t[k]=v; return true; } });
      try{ drawMechaKing(e); } finally { ctx=real; } return out.join('|'); }
    e.hitFace=0; const calm=ops();
    e.hitFace=8;  const hit=ops();
    e.hitFace=0;
    if(calm===hit) throw new Error('王機が被弾しても絵が何も変わらない（enemyHurt を読んで捨てている）');
    console.log('王機の被弾表現 OK'); }

  // ===== 湧きの周回分岐 =====
  { lap=6; const got={}; for(let i=0;i<400;i++) got[randZako()]=1;
    Object.keys(got).forEach(function(k){ if(MECHA_ZAKO_POOL.indexOf(k)<0) throw new Error('六周目に '+k+' が湧く'); });
    if(Object.keys(got).length<MECHA_ZAKO_POOL.length) throw new Error('湧かない雑魚がある: '+MECHA_ZAKO_POOL.filter(function(k){return !got[k];}).join(','));
    // 召喚（bSummon）も六周目の兵を呼ぶこと
    enemies.length=0; spawnEnemy('mkSwarm',660,LANE); const su=enemies[0];
    su.sumUsed=0; bSummon(su);
    const called=enemies.slice(1).map(function(e){ return e.type; });
    if(!called.length) throw new Error('召喚が1体も呼ばれない');
    called.forEach(function(k){ if(!ETYPE[k].mechaKind) throw new Error('六周目の召喚が '+k+'（他周回の敵）'); });
    console.log('湧き OK (randZako '+Object.keys(got).length+'種／召喚 '+called.join(',')+')'); }

  // ===== 周回まわりの表と幕 =====
  { if(!LAP_DIFF[6]) throw new Error('LAP_DIFF に六周目が無い');
    if(!(LAP_DIFF[6].hp>LAP_DIFF[5].hp)) throw new Error('六周目のHP係数が五周目以下: '+LAP_DIFF[6].hp);
    if(LAP_DIFF[6].hardHp==null) throw new Error('六周目に高難易度の値が無い（難易度名が出せない）');
    lap=6; if(lapDiffName()===null) throw new Error('六周目で難易度名が出ない');
    if(!(NG6_OPEN.length>=5)) throw new Error('六周目の開幕デモが '+NG6_OPEN.length+' 場面しかない');
    if(!(NG6_END.length>=5)) throw new Error('六周目の結末デモが '+NG6_END.length+' 場面しかない');
    // 幕は「呼ばれるか」まで見る。lap>=6 の分岐を消しても例外は出ない
    const realCut=startCutscene; let used=null;
    startCutscene=function(sc,cb){ used=sc; };
    try{ lap=6; endingDone=false; startEnding(); } finally { startCutscene=realCut; endingDone=false; }
    if(used!==NG6_END) throw new Error('六周目の結末に NG6_END が使われていない');
    const n5=nextLap(5), n6=nextLap(6);
    if(!n5 || n5.lap!==6) throw new Error('五周目の次が六周目になっていない');
    if(n6) throw new Error('六周目の先があることになっている');
    console.log('周回まわり OK (難易度 hp'+LAP_DIFF[6].hp+'／開幕'+NG6_OPEN.length+'場面／結末'+NG6_END.length+'場面)'); }

  // ラスボスは三度形を変える（大王座の長老がそう言っている）。
  // 形態が繋がっていないと、台詞が嘘になるうえ最終形態に一生たどり着かない
  { let k='mkOmega', seen=[], guard=0;
    while(k && guard++<10){ const T=ETYPE[k]; if(!T) throw new Error('形態 '+k+' が ETYPE に無い');
      seen.push(k); k=T.evolveTo; }
    if(seen.length!==3) throw new Error('王機の形態が '+seen.length+' 段しかない（'+seen.join('→')+'）');
    const last=ETYPE[seen[seen.length-1]];
    if(!last.finalBoss) throw new Error('最終形態に finalBoss が無い＝エンディングへ繋がらない');
    if(ETYPE[seen[0]].finalBoss) throw new Error('第一形態で finalBoss が立っている＝倒した時点で終わる');
    // 形態ごとに技表・肩書き・名乗り・曲が要る（無いと流用元のものを名乗る）
    seen.forEach(function(q){
      if(!BOSSMOVES[q] || !BOSSMOVES[q].length) throw new Error(q+' に技表が無い');
      if(!BOSSROLE[q]) throw new Error(q+' に肩書きが無い');
      if(!bossQuoteFor(q)) throw new Error(q+' に名乗りが無い');
      if(!BOSS_BGM[q]) throw new Error(q+' に専用BGMが無い'); });
    console.log('王機の三段変身 OK ('+seen.join('→')+')'); }

  // 機械の国のボスは全員が機械の絵で出ること。
  // 既存のボス体型を流用していたころは、電磁将が青い毛むくじゃらの生き物だった
  { const MB=Object.keys(ETYPE).filter(function(k){ return ETYPE[k].mecha && ETYPE[k].boss; });
    if(MB.length<12) throw new Error('機械のボスが '+MB.length+' 体しかない');
    const drew=[];
    MB.forEach(function(k){
      enemies.length=0; spawnEnemy(k, 660, LANE);
      let hit=false; const real=drawMechaKing;
      drawMechaKing=function(e){ hit=true; return real(e); };
      try{ enemies.forEach(drawEnemy); } finally { drawMechaKing=real; }
      if(!hit) drew.push(k); });
    if(drew.length) throw new Error('機械の絵で描かれないボスがいる: '+drew.join(','));
    console.log('機械のボスの絵 OK ('+MB.length+'体すべて専用の絵)'); }

  // 章の背景が章の中身と合っていること。
  // テーマ番号を宣言順で振っていたころは、坑道に昼の空と雲海が出ていた
  { const WANT={'溶鉱炉 第七区':'foundry','電磁の大坑道':'reactor','天空の軌道橋':'tether',
                '中枢炉心「大王座」':'coreroom'};
    const bad=[];
    MECHA_CH.forEach(function(b){ const w=WANT[b.name]; if(!w) return;
      const T=STAGE_THEME[b.theme];
      if(!T || T.land!==w) bad.push(b.name+'→'+(T?T.land:'?')+'（'+w+' のはず）'); });
    if(bad.length) throw new Error('章と背景が食い違っている: '+bad.join(' / '));
    // 屋外の章に屋内テーマ（雲を止めた景）を割り当てていないこと
    const sky=MECHA_CH.filter(function(b){ return b.name==='天空の軌道橋'; })[0];
    const ST=STAGE_THEME[sky.theme];
    if(ST.land==='foundry'||ST.land==='reactor'||ST.land==='coreroom')
      throw new Error('空の章に屋内テーマが割り当たっている（雲も鳥も出ない）');
    console.log('章と背景の対応 OK'); }

  console.log('MECHA TEST PASSED');
  process.exit(0);
})().catch(e=>{ console.error('FAIL:', e.message); process.exit(1); });
`;
code = code + "\n;" + DRIVER;
(0, eval)(code);

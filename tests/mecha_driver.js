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
      // 機械の絵は三種類ある。地上のボスは王機の型、飛ぶボスは砲艦の型、
      // 兵の型をそのまま大きくしたボス（bigFoe）は兵の絵。
      // どれも通らなければ、既存の獣や円盤の絵を流用していることになる
      let hit=false; const rk=drawMechaKing, ra=drawMechaAir, rf=drawMechaFoe;
      drawMechaKing=function(e){ hit=true; return rk(e); };
      drawMechaAir=function(e){ hit=true; return ra(e); };
      drawMechaFoe=function(e,t){ hit=true; return rf(e,t); };
      try{ enemies.forEach(drawEnemy); } finally { drawMechaKing=rk; drawMechaAir=ra; drawMechaFoe=rf; }
      if(!hit) drew.push(k); });
    if(drew.length) throw new Error('機械の絵で描かれないボスがいる: '+drew.join(','));
    // 飛ぶボスは砲艦の絵。地上の型に落ちると、空に玉座が浮くことになる
    ['mkSky','mkMWing'].forEach(function(k){
      enemies.length=0; spawnEnemy(k, 660, LANE);
      let air=false; const ra=drawMechaAir;
      drawMechaAir=function(e){ air=true; return ra(e); };
      try{ enemies.forEach(drawEnemy); } finally { drawMechaAir=ra; }
      if(!air) throw new Error(k+' が砲艦の絵で描かれていない'); });
    console.log('機械のボスの絵 OK ('+MB.length+'体すべて専用の絵／飛ぶ2体は砲艦の型)'); }

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

  // ラストの演出：液体金属。傷が塞がり、倒すと写し取った姿を流してから溶け落ちる
  { const T=ETYPE.mkOmega3;
    if(!T.t1000) throw new Error('最終形態が液体金属になっていない');
    if(typeof drawT1000!=='function') throw new Error('液体金属の描画が無い');
    setupRoster('inu'); startGame(); state='play';
    const p=players[0]; player=p; p.hp=p.maxHp=99999; p.invuln=99999;
    // 1) 液体金属は専用の描画を通る
    { enemies.length=0; p.x=600; p._tx=null; spawnEnemy('mkOmega3', 760, LANE);
      let hit=false; const real=drawT1000;
      drawT1000=function(){ hit=true; return real.apply(null,arguments); };
      try{ enemies.forEach(drawEnemy); } finally { drawT1000=real; }
      if(!hit) throw new Error('最終形態が液体金属の絵で描かれていない'); }
    // 2) 撃たれると銀の飛沫が散る（傷が塞がる演出）
    { enemies.length=0; spawnEnemy('mkOmega3', 760, LANE); const e=enemies[0];
      particles.length=0; e.hurtTimer=12;
      enemies.forEach(drawEnemy);
      const n=particles.length;
      if(!(n>0)) throw new Error('撃たれても飛沫が出ない（傷が塞がって見えない）'); }
    // 3) とどめ：立ったまま形を失い、写し取った姿を流してから床へ広がる
    { enemies.length=0; items.length=0; t1kReset();
      spawnEnemy('mkOmega3', 760, LANE); const e=enemies[0];
      // 殴って倒すのではなく、炉へ落として決着する（イベント戦なのでそれが唯一の道）
      e.hp=1; killEnemy(e);
      if(e.dead) throw new Error('殴りで倒せてしまう（傷が塞がるはず）');
      t1kFall(e);
      if(e.t1kMelt==null) throw new Error('炉へ落ちても溶け落ちる段取りが始まらない');
      if(e.state==='down') throw new Error('液体金属が倒れ込んでいる（斜めの板になる）');
      if(!(e.deadTimer>=130)) throw new Error('溶ける時間が '+e.deadTimer+'F しかない（流れ終わる前に消える）');
      // 実際に段取りが進み、写し取った姿の段階と、床へ広がる段階の両方を通ること
      let sawCopy=false, sawPool=false;
      for(let f=0;f<200 && enemies.length; f++){ hitStop=0; slowmo=0;
        const m=e.t1kMelt||0, mu=Math.min(1,m/96);
        if(m>0 && mu<0.55) sawCopy=true;
        if(mu>=0.55 && mu<1) sawPool=true;
        updateEnemies(); }
      if(!sawCopy) throw new Error('写し取った姿を流す段階を通っていない');
      if(!sawPool) throw new Error('床へ広がる段階まで到達していない');
      if(enemies.length) throw new Error('溶け切っても消えない'); }
    console.log('液体金属のラスト OK (専用の絵／飛沫／立ったまま姿を流して溶け落ちる)'); }

  // ラスボス戦は溶鉱炉へ突き落とすイベント戦。撃って押す以外に決着が無い
  {
 setupRoster('inu'); startGame(); state='play'; gimOn=false;
  const p=players[0]; player=p; p.hp=p.maxHp=99999; p.invuln=99999;
  enemies.length=0; items.length=0; t1kReset();
  p.x=600; p._tx=null; p.facing=1;
  spawnEnemy('mkOmega3', 900, LANE); const e=enemies[0];
  if(!t1k.on) throw new Error('イベント戦が始まらない');
  console.log('炉の位置 '+Math.round(t1k.furnace)+' / ボス '+Math.round(e.x));
  // 火器が湧く
  let got=0;
  for(let f=0;f<900;f++){ hitStop=0; slowmo=0; t1kTick(); updateItems();
    const it=items.filter(function(q){ return q.kind==='evsg'||q.kind==='evgl'; })[0];
    if(it){ got++; items.length=0; } }
  if(got<2) throw new Error('火器が '+got+' 回しか湧かない');
  console.log('火器の湧き '+got+'回');
  // 殴っても倒せない（塞がる）
  e.hp=1; killEnemy(e);
  if(e.dead) throw new Error('殴りで倒せてしまう');
  console.log('殴りでは倒せない（HP '+Math.round(e.hp)+' へ戻る）');
  // 撃つと押せる
  const x0=e.x;
  for(let k=0;k<20;k++) t1kShove(e, 12);
  if(!(e.x>x0+100)) throw new Error('撃っても押せない（'+Math.round(x0)+'→'+Math.round(e.x)+'）');
  console.log('押し込み '+Math.round(x0)+'→'+Math.round(e.x)+' (炉 '+Math.round(t1k.furnace)+')');
  // 炉まで押し切ると落ちる
  for(let k=0;k<80 && !e.t1kFall;k++) t1kShove(e, 20);
  if(!e.t1kFall) throw new Error('炉まで押しても落ちない');
  if(e.t1kMelt==null) throw new Error('落ちても溶け落ちる段取りへ繋がらない');
  console.log('炉へ落下 OK（溶け落ちへ接続）');
  // 実際に拾って撃つところまで通す。t1kShove を直接呼ぶだけでは、
  // 弾と押し込みが繋がっているかを確かめたことにならない
  { enemies.length=0; items.length=0; t1kReset();
    p.x=600; p._tx=null; p.facing=1; p.state='idle'; p.atk=null; p.z=0;
    p.evW=null; p.evAmmo=0;
    spawnEnemy('mkOmega3', 820, LANE); const e2=enemies[0];
    e2.thinkCd=999999; e2.hp=e2.maxHp=999999;
    makeItem(605,'evsg');
    for(let f=0;f<40 && !(p.evAmmo>0); f++){ hitStop=0; slowmo=0; updateItems(); step(1); }
    if(!(p.evAmmo>0)) throw new Error('落ちている火器を拾えない');
    const bx=e2.x;
    for(let f=0;f<60;f++){ hitStop=0; slowmo=0;
      if(f===0) p.in.pressed.atk=true;
      p.x=600; e2.vx=0;
      useInput(p.in); updatePlayer(p); saveInput(p.in); updateProjectiles(); }
    if(!(e2.x>bx+10)) throw new Error('撃っても炉へ寄らない（'+Math.round(bx)+'→'+Math.round(e2.x)+'）');
    // 弾数は有限。撃ち切ったら次を拾いに行く作りなので、減らないと撃ちっぱなしで終わる
    { const a0=p.evAmmo|0;
      for(let f=0;f<200 && (p.evAmmo|0)>0; f++){ hitStop=0; slowmo=0;
        if(f%22===0) p.in.pressed.atk=true;
        p.x=600; useInput(p.in); updatePlayer(p); saveInput(p.in); }
      if((p.evAmmo|0)>0) throw new Error('撃っても弾が減らない（'+a0+'発のまま）');
      if(p.evW) throw new Error('撃ち切っても構えが残っている'); }
    const sx=e2.x;
    // 殴りでは押せない（塞がってしまう）
    for(let f=0;f<80;f++){ hitStop=0; slowmo=0;
      if(f%14===0) p.in.pressed.atk=true;
      p.x=e2.x-70; p._tx=null; p.facing=1; e2.vx=0;
      useInput(p.in); updatePlayer(p); saveInput(p.in); }
    if(e2.x>sx+10) throw new Error('殴りでも炉へ押せてしまう（'+Math.round(sx)+'→'+Math.round(e2.x)+'）');
    console.log('拾って撃つ OK (弾で '+Math.round(e2.x-bx)+'px 押し／殴りでは押せない)'); }
  console.log('溶鉱炉のイベント戦 OK (火器が湧く／殴っては倒せない／撃つと押せる／炉で決着)');
    }

  // 追加した三体：空から撃つ大型機／道を均す圧砕機／倒れても起き上がる鋼の骨
  { if(!ETYPE.mkSky.flyer) throw new Error('大型航空兵器が飛ばない');
    if(!ETYPE.mkDozer.charge) throw new Error('圧砕機が突進しない');
    if(!ETYPE.mkBone.zombie) throw new Error('鋼骨兵が起き上がらない');
    setupRoster('inu'); startGame(); state='play';
    const p=players[0]; player=p; p.hp=p.maxHp=99999; p.invuln=99999; p.atkMul=99;
    // 1) 大型航空兵器は宙に留まる（地面に降りて殴られるだけの的にならない）
    { enemies.length=0; t1kReset(); p.x=600; p._tx=null;
      spawnEnemy('mkSky', 900, LANE); const e=enemies[0];
      e.thinkCd=999999; let hi=0, up=0;
      for(let f=0;f<120;f++){ hitStop=0; slowmo=0; updateEnemies();
        if(e.z>hi) hi=e.z; if(e.z>40) up++; }
      if(!(hi>=100)) throw new Error('大型航空兵器が浮かない（最高 '+Math.round(hi)+'px）');
      // 技によっては一時的に降りるので、最終フレームの高さではなく滞空していた割合で見る
      if(!(up>=90)) throw new Error('大型航空兵器が地上に居る時間が長い（'+up+'/120F）'); }
    // 2) 圧砕機は重い。雑魚の中でいちばん体が大きく、いちばん遅い
    { const Z=MECHA_ZAKO_POOL.map(function(k){ return ETYPE[k]; });
      const wid=Math.max.apply(null, Z.map(function(q){ return q.w; }));
      if(ETYPE.mkDozer.w!==wid) throw new Error('圧砕機が雑魚で最大の体格になっていない');
      const slow=Math.min.apply(null, Z.map(function(q){ return q.sp; }));
      if(ETYPE.mkDozer.sp!==slow) throw new Error('圧砕機が雑魚で最も遅くない'); }
    // 3) 鋼骨兵は一度倒しても起き上がる
    { enemies.length=0; t1kReset();
      spawnEnemy('mkBone', 700, LANE); const e=enemies[0];
      e.hp=1; killEnemy(e);
      if(e.dead) throw new Error('鋼骨兵が一度目で倒れてしまう');
      if(!e.revived) throw new Error('起き上がった印が付いていない');
      e.hp=1; killEnemy(e);
      if(!e.dead) throw new Error('二度目でも倒れない（無限に起き上がる）'); }
    // 4) 三体とも機械の絵で描かれる
    { ['mkDozer','mkBone'].forEach(function(k){
        enemies.length=0; spawnEnemy(k, 660, LANE);
        let hit=false; const rf=drawMechaFoe;
        drawMechaFoe=function(e,t){ hit=true; return rf(e,t); };
        try{ enemies.forEach(drawEnemy); } finally { drawMechaFoe=rf; }
        if(!hit) throw new Error(k+' が機械の絵で描かれていない'); }); }
    console.log('追加の三体 OK (空は浮く／圧砕機は最大最遅／鋼骨兵は一度だけ起き上がる)'); }

  // 実際の戦いの入り口を通す。ここを見ていなかったので、遊ぶと
  // ①イベント戦が始まらない ②形態変化で流用元の台詞が出る の二つが残っていた
  { setupRoster('guard8'); startGame(); state='play';
    const q=players[0]; player=q; q.hp=q.maxHp=99999; q.invuln=99999;
    enemies.length=0; items.length=0; t1kReset();
    // イベント戦は「液体金属になってから」。第一・第二形態では始まらないこと
    spawnEnemy('mkOmega', 900, LANE); const e=enemies[0];
    if(t1k.on) throw new Error('第一形態でイベント戦が始まっている（第三形態の戦いのはず）');
    // 湧いた直後に始めてしまうと、t1kTick が「液体金属が居ない」と見て
    // 次のフレームで自分で消す。回してもイベントが立っていないことまで見る
    for(let f=0;f<30;f++){ hitStop=0; slowmo=0; t1kTick(); }
    if(t1k.on) throw new Error('第一形態でイベント戦が立っている');
    // 形態変化のカットインが「その形態自身」の名乗りを喋ること。
    // bossKind で引くと、体型を流用した形態が流用元（ガードワン零号）を名乗る
    const said=[];
    const realCut=startCutscene;
    startCutscene=function(sc,cb){ sc.forEach(function(x){
      said.push((x.name||'')+'|'+(x.role||'')+'|'+(x.text||'')); }); if(cb)cb(); };
    try{
      e.hp=1; killEnemy(e);                                   // 第一 → 第二
      if(e.type!=='mkOmega2') throw new Error('第二形態へ変わらない（'+e.type+'）');
      for(let f=0;f<30;f++){ hitStop=0; slowmo=0; t1kTick(); }
      if(t1k.on) throw new Error('第二形態でイベント戦が始まっている');
      e.hp=1; killEnemy(e);                                   // 第二 → 第三（液体金属）
      if(e.type!=='mkOmega3') throw new Error('第三形態へ変わらない（'+e.type+'）');
    } finally { startCutscene=realCut; }
    // ここからが本番。進化で辿り着いた第三形態でイベント戦が立ち、消えないこと
    if(!t1k.on) throw new Error('第三形態へ進化してもイベント戦が始まらない');
    if(!(t1k.furnace>e.x)) throw new Error('溶鉱炉が前方に置かれていない');
    { const fx=t1k.furnace;
      let live=0;
      for(let f=0;f<600;f++){ hitStop=0; slowmo=0; t1kTick(); updateItems();
        if(!t1k.on) throw new Error('イベント戦が '+f+'F で消えた（t1kTick が液体金属を見つけられていない）');
        live=Math.max(live, items.filter(function(q){ return q.kind==='evsg'||q.kind==='evgl'; }).length); }
      if(t1k.furnace!==fx) throw new Error('炉の位置が動いている');
      if(!(live>0)) throw new Error('イベント戦の火器が一度も湧かない');
      // 殴っても倒せない（撃って炉へ落とすしかない）
      e.hp=1; killEnemy(e);
      if(e.dead) throw new Error('第三形態が殴りで倒せてしまう（イベント戦になっていない）');
      // 撃てば炉の方へ寄る
      const x0=e.x; t1kShove(e, 30);
      if(!(e.x>x0+10)) throw new Error('撃ち込んでも炉へ寄らない（'+Math.round(x0)+'→'+Math.round(e.x)+'）'); }
    if(said.length<2) throw new Error('形態変化のカットインが出ない（'+said.length+'件）');
    said.forEach(function(x){
      if(x.indexOf('ガードワン')>=0 || x.indexOf('門番')>=0 || x.indexOf('八代目')>=0)
        throw new Error('形態変化で流用元の台詞が出ている: '+x.slice(0,40)); });
    ['mkOmega2','mkOmega3'].forEach(function(k){
      const nm=ETYPE[k].name, ro=BOSSROLE[k];
      if(!said.some(function(x){ return x.indexOf(nm)>=0; }))
        throw new Error(k+' の名乗りがカットインに出ていない');
      if(!ro) throw new Error(k+' に肩書きが無い');
      if(!said.some(function(x){ return x.indexOf(nm)>=0 && x.indexOf(ro)>=0; }))
        throw new Error(k+' の肩書き「'+ro+'」がカットインに出ていない（流用元を引いている）'); });
    if(e.type!=='mkOmega3') throw new Error('第三形態まで進まない（'+e.type+'）');
    console.log('ラスボス戦の入り口 OK (第一形態からイベント戦／形態変化は自分の名乗り)'); }

  // 攻撃を機械に寄せた：撃ち分け三種と、空から突っ込む立体的な攻め
  { setupRoster('inu'); startGame(); state='play';
    const q=players[0]; player=q; q.hp=q.maxHp=99999; q.invuln=99999;
    const fire=function(k){
      enemies.length=0; projectiles.length=0; t1kReset();
      q.x=600; q._tx=null; q.facing=1;
      spawnEnemy(k, 800, LANE); const e=enemies[0];
      e.state='gunFire'; e.gunT=16; e.facing=-1;
      // 弾は飛びながら中身が書き換わる（重力で vzz が反転する）。
      // 見つけた瞬間の値を控える——後から読むと「打ち上がっていない」ことになる
      const seen=[], snap=[];
      for(let f=0;f<40;f++){ hitStop=0; slowmo=0; updateEnemies(); updateProjectiles();
        projectiles.forEach(function(z){ if(z.owner==='enemy' && seen.indexOf(z)<0){ seen.push(z);
          snap.push({vx:z.vx, vzz:z.vzz||0, r:z.r, pierce:!!z.pierce, grav:z.grav||0}); } }); }
      return snap[0]||null; };
    const laser=fire('mkBeam'), how=fire('mkGun'), rock=fire('mkBlink');
    if(!laser||!how||!rock) throw new Error('撃ってこない兵がいる');
    // 光条＝速くて貫通、榴弾＝山なり、ロケット＝遅くて大きい。三つが別物であること
    if(!(laser.pierce)) throw new Error('光条が貫通しない');
    if(!(Math.abs(laser.vx)>=18)) throw new Error('光条が速くない（'+Math.round(Math.abs(laser.vx))+'）');
    if(!(how.grav>0)) throw new Error('榴弾が山なりに落ちない');
    if(!(how.vzz>0)) throw new Error('榴弾が上へ打ち上がらない');
    if(!(rock.r>=16)) throw new Error('ロケットが大きくない（r'+rock.r+'）');
    if(!(Math.abs(rock.vx)<=7)) throw new Error('ロケットが遅くない（'+Math.round(Math.abs(rock.vx))+'）');
    if(Math.abs(laser.vx)<=Math.abs(rock.vx)) throw new Error('光条とロケットの速さが逆');
    // 空中突撃：跳び上がってから落ちてくる
    ['mkFlank','mkDrone'].forEach(function(k){
      enemies.length=0; t1kReset(); q.x=600; q._tx=null;
      spawnEnemy(k, 900, LANE); const e=enemies[0]; e.thinkCd=0;
      let hi=0, dove=false, landed=false;
      for(let f=0;f<240;f++){ hitStop=0; slowmo=0; updateEnemies();
        if(e.z>hi) hi=e.z;
        if(e.state==='dive') dove=true;
        if(dove && e.z<=0) landed=true; }
      if(!dove) throw new Error(k+' が空中突撃をしない');
      if(!(hi>=80)) throw new Error(k+' が '+Math.round(hi)+'px しか上がらない');
      if(!landed) throw new Error(k+' が降りてこない'); });
    console.log('機械の攻め OK (光条は貫通・榴弾は山なり・ロケットは大きく遅い／遊撃機と索敵機は空から突っ込む)'); }

  // 耐久を半分にした。長いだけの戦いにしないための調整
  { const Z=MECHA_ZAKO_POOL.map(function(k){ return ETYPE[k].hp; });
    const avg=Z.reduce(function(a2,b2){ return a2+b2; },0)/Z.length;
    // 五周目の雑魚の平均と比べる。倍以上あると「硬いだけ」に戻る
    const S5=['ashigaru','samurai','taisho','yumihei','teppo','kibahei','ninja']
      .map(function(k){ return ETYPE[k].hp; });
    const avg5=S5.reduce(function(a2,b2){ return a2+b2; },0)/S5.length;
    if(!(avg < avg5*1.4)) throw new Error('六周目の雑魚が硬すぎる（平均 '+Math.round(avg)+' / 五周目 '+Math.round(avg5)+'）');
    if(!(ETYPE.mkOmega3.hp < 800)) throw new Error('ラスボス最終形態が硬すぎる（'+ETYPE.mkOmega3.hp+'）');
    console.log('耐久 OK (六周目の雑魚 平均'+Math.round(avg)+' / 五周目 平均'+Math.round(avg5)+')'); }

  console.log('MECHA TEST PASSED');
  process.exit(0);
})().catch(e=>{ console.error('FAIL:', e.message); process.exit(1); });
`;
code = code + "\n;" + DRIVER;
(0, eval)(code);

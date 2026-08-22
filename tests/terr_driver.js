const DRIVER = `
(async()=>{
  // ═══ 地形（坂道）と落石 ═══
  // 以前はどの区画も同じ正弦のうねりだけで、全ステージが同じ平坦な道だった。
  // 区画ごとの標高と、下り坂の落石トラップを実測する。

  const setup=function(){ sndOn=false; setupRoster('inu'); startGame();
    const p=players[0]; resetPlayer(p,true); player=p;
    p.state='idle'; p.z=0; p.atk=null; p.invuln=0;
    enemies.length=0; projectiles.length=0; hazards.length=0; return p; };
  // 好きな並びの区画を組んでワールドを作り直す
  const build=function(kinds){ resetWorldState();
    addBlocks(kinds.map(function(k,i){ return {theme:0,name:'T'+i,terr:k,noPit:true,gates:[]}; }), null);
    return TERRS; };

  // ===== 1) 区画ごとに地形が変わり、境目は連続している =====
  { const T=build([null,'up',null,'down',null]);
    if(T.length!==5) throw new Error('区画の地形が '+T.length+' 個しか積まれていない');
    if(!(T[1].e1>T[1].e0)) throw new Error('登り坂で標高が上がらない（'+T[1].e0+'→'+T[1].e1+'）');
    if(!(T[3].e1<T[3].e0)) throw new Error('下り坂で標高が下がらない（'+T[3].e0+'→'+T[3].e1+'）');
    // 最初の区画が下り坂でも降りられること（標高に床を置くとここで 0→0 に潰れる）
    { const D=build(['down']);
      if(!(D[0].e1<D[0].e0-160)) throw new Error('先頭の区画だと下り坂が潰れる（'+D[0].e0+'→'+D[0].e1+'）'); }
    build([null,'up',null,'down',null]);
    // 平坦な区画は直前の標高を引き継ぐ（0へ戻すと境目が崖になる）
    if(T[2].e0!==T[1].e1 || T[2].e1!==T[1].e0+T[1].e1-T[1].e0)
      throw new Error('登り坂の次の平地が標高を引き継いでいない（'+T[1].e1+'→'+T[2].e0+'/'+T[2].e1+'）');
    if(T[2].e0!==T[2].e1) throw new Error('terr の無い区画が坂になっている');
    // 登った高さが「大きな坂」と呼べる量か。主役の背丈（約150px）を超えること
    const rise=T[1].e1-T[1].e0;
    if(rise<160) throw new Error('登り坂の高低差が '+rise+'px しかない');
    // ワールド全域で高さが跳ばない＝崖が無い
    let worst=0, wx=0;
    for(let x=0;x<TERRS[TERRS.length-1].x1;x+=7){ const d=Math.abs(terrLift(x+7)-terrLift(x));
      if(d>worst){ worst=d; wx=x; } }
    if(worst>7) throw new Error('x='+wx+' で標高が1歩 '+worst.toFixed(1)+'px 跳んでいる（崖になっている）');
    // 実際に技表どおりの区画（本編のステージ）にも坂が入っていること
    resetWorldState(); buildEncounters();
    const kinds={};
    [CH1, FINAL_CH, BUG_CH, SPACE_CH, MYTH_CH, SENGOKU_CH].forEach(function(ch){
      ch.forEach(function(b){ kinds[b.terr||'flat']=(kinds[b.terr||'flat']||0)+1; }); });
    ['A','B'].forEach(function(k){ SEGS[k].forEach(function(pair){ pair.forEach(function(b){
      kinds[b.terr||'flat']=(kinds[b.terr||'flat']||0)+1; }); }); });
    if(!(kinds.up>=3)) throw new Error('本編に登り坂の区画が '+(kinds.up|0)+' しか無い');
    if(!(kinds.down>=3)) throw new Error('本編に下り坂の区画が '+(kinds.down|0)+' しか無い');
    console.log('区画ごとの地形 OK (登り+'+rise+'px／下り-'+(T[3].e0-T[3].e1)+'px／境目の最大段差 '+worst.toFixed(1)+'px／本編 登り'+kinds.up+'・下り'+kinds.down+'区画)'); }

  // ===== 2) 縦カメラが坂を追う＝主役が画面から抜けない =====
  { const p=setup(); build(['up']);
    const T=TERRS[0], scr=function(){ return LANE - groundLift(p.x) + camY; };
    p.x=T.x0+60; camY=terrLift(p.x); const y0=scr();
    let worst=0;
    for(let k=0;k<260;k++){ p.x=Math.min(T.x1-60, p.x+7); updateCamera();
      const d=Math.abs(scr()-y0); if(d>worst) worst=d; }
    // 坂を登り切っても主役の画面上の高さはほぼ変わらない（追従していれば数十px以内）
    if(worst>70) throw new Error('坂を登ると主役が画面上で '+Math.round(worst)+'px ずれる（縦カメラが追っていない）');
    // 追っている＝camY が標高ぶん動いていること（0 のままなら上のチェックも意味を成さない）
    if(Math.abs(camY-terrLift(p.x))>40) throw new Error('camY が標高を追えていない（'+Math.round(camY)+' vs '+Math.round(terrLift(p.x))+'）');
    if(camY<120) throw new Error('坂の上まで来ても camY が '+Math.round(camY));
    console.log('縦カメラ OK (標高'+Math.round(terrLift(p.x))+'px を登って画面上のブレ '+Math.round(worst)+'px)'); }

  // ===== 3) 下り坂だけに落石が出る =====
  { const roll=function(kind){ const p=setup(); build([kind]);
      const T=TERRS[0]; p.x=T.x0+700; camX=p.x-100; boulderCd=0; hazards.length=0;
      let seen=0;
      for(let f=0;f<900;f++){ tickBoulders(); if(hazards.some(function(h){return h.kind==='boulder';})) seen++; }
      return seen; };
    const dn=roll('down'), up=roll('up'), fl=roll(null);
    if(dn<=0) throw new Error('下り坂で落石が出ない');
    if(up>0) throw new Error('登り坂にも落石が出ている');
    if(fl>0) throw new Error('平坦な区画にも落石が出ている');
    console.log('落石の出現 OK (下り '+dn+'F／登り '+up+'F／平坦 '+fl+'F)'); }

  // ===== 4) 落石は坂を下って加速し、立っていると当たり、跳べば避けられる =====
  { const run=function(jump){ const p=setup(); build(['down']);
      const T=TERRS[0]; p.x=T.x0+900; camX=p.x-420; p.hp=p.maxHp=999; p.invuln=0;
      hazards.length=0; boulderCd=99999;
      spawnBoulder(p.x-360, 1);
      const b=hazards[hazards.length-1], x0=b.x;
      let v0=0, vmax=0, minGap=1e9, hp0=p.hp;
      for(let f=0;f<200;f++){
        if(f===1) v0=b.vx;
        // 岩が目前に来たフレームだけ跳ぶ（実際の回避と同じ間合い）
        if(jump && p.z<=0 && Math.abs(b.x-p.x)<170 && b.x<p.x) p.in.pressed.jump=true;   // 入力から跳ばせる（本編と同じ経路）
        updatePlayer(p); updateHazards();
        if(hazards.indexOf(b)<0) break;
        if(Math.abs(b.vx)>vmax) vmax=Math.abs(b.vx);
        const gap=Math.abs(b.x-p.x); if(gap<minGap) minGap=gap;
        p.invuln=Math.min(p.invuln,0);   // 岩以外の無敵は測定の邪魔になるので毎フレーム剥がす
      }
      return {dx:b.x-x0, v0:Math.abs(v0), vmax:vmax, gap:minGap, dmg:hp0-p.hp}; };
    const a=run(false);
    if(!(a.dx>300)) throw new Error('岩が転がらない（'+Math.round(a.dx)+'px）');
    if(!(a.vmax>a.v0*1.3)) throw new Error('下り坂で加速しない（'+a.v0.toFixed(1)+'→'+a.vmax.toFixed(1)+'）');
    if(!(a.gap<90)) throw new Error('岩が主役まで届いていない（最接近 '+Math.round(a.gap)+'px）');
    if(a.dmg<=0) throw new Error('立っていても岩に当たらない');
    const b=run(true);
    if(!(b.gap<90)) throw new Error('跳んだ側で岩が主役まで届いていない（'+Math.round(b.gap)+'px）');
    if(b.dmg>0) throw new Error('跳んでも岩に当たる（'+b.dmg+'ダメージ）');
    console.log('落石の挙動 OK (転がり '+Math.round(a.dx)+'px・速度 '+a.v0.toFixed(1)+'→'+a.vmax.toFixed(1)+'／立ち '+a.dmg+'ダメージ・跳べば0)'); }

  // ===== 5) 雑魚の登場：空から吊り下ろす／地面を割って出る =====
  { const drop=function(type){ const p=setup(); enemies.length=0; carriers.length=0;
      camX=Math.max(0,p.x-200);
      const e=spawnEnemyEntry(type, p.x+300, p.y, 'drop');
      if(!carriers.length) throw new Error('吊り下ろしなのに運び手が居ない');
      const c=carriers[0];
      const z0=e.z, cx0=c.x;
      let relX=null, land=-1, minGapZ=1e9;
      for(let f=0;f<400;f++){ updateEnemies(); updateCarriers();
        if(relX===null && !e.carried) relX=e.x;
        if(e.carried){ const gap=(c.z-e.z)-(ETYPE[type].h||100); if(gap<minGapZ) minGapZ=gap; }   // 見えている索の長さ
        if(land<0 && e.state==='walk'){ land=f; break; } }
      return {kind:c.kind, z0:z0, cx0:cx0, relX:relX, dropX:c.dropX, land:land, z:e.z, st:e.state, gap:minGapZ}; };
    const big=drop('mastiff'), small=drop('wolf');
    // 吊られている間は宙にあり、指定の位置で切り離され、必ず着地して歩き出す
    if(!(big.z0>140)) throw new Error('吊り下げの高さが '+Math.round(big.z0)+'px しかない');
    if(big.relX===null) throw new Error('切り離されないまま運ばれ続ける');
    if(Math.abs(big.relX-big.dropX)>40) throw new Error('狙った位置で切り離していない（'+Math.round(big.relX)+' vs '+Math.round(big.dropX)+'）');
    if(big.land<0) throw new Error('落とされた敵が着地しない（宙に貼りつく）');
    if(big.z!==0 || big.st!=='walk') throw new Error('着地しても z='+big.z+' state='+big.st);
    // 索の長さ＝機体と敵が重ならない距離。詰まると「掴んでいる」ようにしか見えない
    if(!(big.gap>50)) throw new Error('索の見えている長さが '+Math.round(big.gap)+'px しかない（機体と敵が重なる）');
    // 大きい敵はヘリ、小さい敵はドローン
    if(big.kind!=='heli') throw new Error('大型を運ぶのが '+big.kind);
    if(small.kind!=='drone') throw new Error('小型を運ぶのが '+small.kind);
    // 地面から出てくる型
    const p=setup(); enemies.length=0;
    const e=spawnEnemyEntry('ari', p.x+240, p.y, 'burrow');
    const hp0=e.hp;
    let up=0, land=-1, air=0;
    for(let f=0;f<400;f++){
      if(f<ENT_BURROW-2){ damageEnemy(e, 50, 0, false); }       // 土の下は無敵
      updateEnemies();
      if(f<ENT_BURROW-2 && e.z>0) air++;                         // 出てくる前に浮いていないこと
      if(e.z>up) up=e.z;
      if(e.state==='walk'){ land=f; break; } }
    if(air>0) throw new Error('地割れの間に '+air+'F 浮いている（土の下に居ない）');
    if(e.hp!==hp0) throw new Error('土の下なのに '+(hp0-e.hp)+' ダメージ通っている');
    if(!(up>60)) throw new Error('地面から噴き出す高さが '+Math.round(up)+'px しかない');
    if(land<0) throw new Error('噴き出した敵が着地しない');
    if(land<=ENT_BURROW) throw new Error('地割れの溜め（'+ENT_BURROW+'F）を待たずに出ている（'+land+'F）');
    console.log('登場演出 OK (ヘリ吊り '+Math.round(big.z0)+'px→'+big.land+'F で着地・索'+Math.round(big.gap)
      +'px／小型はドローン／地割れ'+ENT_BURROW+'F 無敵→'+Math.round(up)+'px 噴き出して'+land+'F で着地)'); }

  // ===== 6) 実際の波に3種の登場が混ざる（ボスと飛行する敵は従来どおり横から） =====
  { const tally=function(list, times, gate){ const k={side:0,drop:0,burrow:0};
      for(let w=0;w<times;w++){
        resetWorldState();
        addBlocks([{theme:0,name:'W',noPit:true,gates:[Object.assign({off:400,list:list}, gate||{})]}],null);
        enemies.length=0; carriers.length=0; encIndex=0;
        const p=players[0]; p.x=encounters[0].at-150; camX=Math.max(0,p.x-300);
        updateEncounters();
        for(const e of enemies) k[e.entry||'side']=(k[e.entry||'side']||0)+1; }
      return k; };
    setup();
    const z=tally([['wolf',3]], 40);
    if(!(z.side>0)) throw new Error('横から来る雑魚が居なくなった');
    if(!(z.drop>0)) throw new Error('空から降ってくる雑魚が一体も出ない');
    if(!(z.burrow>0)) throw new Error('地面から出てくる雑魚が一体も出ない');
    if(z.drop+z.burrow > (z.side+z.drop+z.burrow)*0.75)
      throw new Error('横から来る雑魚が少なすぎる（'+z.side+'/'+(z.side+z.drop+z.burrow)+'）');
    // 飛ぶ敵は自分で来るので吊らない／埋めない
    // （通常戦は randomizeZako で種類が差し替わるので、種類が保たれる mini の門で確かめる）
    const fl=tally([['balloon',3]], 14, {mini:true});
    if(fl.side<=0) throw new Error('飛ぶ敵が一体も湧いていない（測れていない）');
    if(fl.drop>0 || fl.burrow>0) throw new Error('飛ぶ敵まで吊り下げ／地中から出している');
    // ボス戦は名乗りの演出が別にあるので従来どおり横から
    const bs=tally([['garm',1]], 10, {boss:true});
    if(bs.side<=0) throw new Error('ボスが湧いていない（測れていない）');
    if(bs.drop>0 || bs.burrow>0) throw new Error('ボスまで吊り下げ／地中から出している');
    console.log('波の登場の混ざり OK (横'+z.side+'／空'+z.drop+'／地中'+z.burrow+'・飛行'+fl.side+'とボス'+bs.side+'は横のみ)'); }

  console.log('TERRAIN TEST PASSED'); process.exit(0);
})().catch(e=>{ console.error('FAIL:', e.message, e.stack); process.exit(1); });
`;
code = code + "\n;" + DRIVER;
(0, eval)(code);

const DRIVER = `
(async()=>{
  const step=(n)=>{ for(let i=0;i<n;i++){ if(global.rafCb){ const cb=global.rafCb; global.rafCb=null; cb(); } } };
  sndOn=false;
  const ZAKO=['ashigaru','samurai','taisho','yumihei','teppo','kibahei','ninja'];
  const BOSS=['nobunaga','hideyoshi','ieyasu'];
  // 描画コールの形を取る物差し。ctx の束縛ごと差し替える（プロキシではメソッドを差せない）
  function shape(fn){
    const real=ctx; let n=0, sig=0;
    const num=v=>{ const x=(typeof v==='number'&&isFinite(v))?Math.round(v*4):0; sig=(sig*31+x)|0; };
    ctx=new Proxy(real,{ get:function(t,k){
      if(k==='fill'||k==='stroke'||k==='fillRect'||k==='fillText'){ return function(){ n++; sig=(sig*131+k.length)|0;
        for(let i=0;i<arguments.length;i++) num(arguments[i]); }; }
      if(k==='moveTo'||k==='lineTo'||k==='arc'||k==='ellipse'||k==='quadraticCurveTo'||k==='rect'||k==='translate'||k==='rotate'){
        return function(){ n++; sig=(sig*17+k.length)|0; for(let i=0;i<arguments.length;i++) num(arguments[i]); }; }
      return t[k]; } });
    try { fn(); } finally { ctx=real; }
    return {n:n, sig:sig}; }

  // ===== 1) 周回としての戦国 =====
  { if(typeof startNG5!=='function') throw new Error('startNG5 が無い');
    const n4=nextLap(4), n5=nextLap(5);
    if(!n4 || n4.lap!==5) throw new Error('四周目クリア後に五周目へ行けない');
    if(n5) throw new Error('五周目の先があることになっている');
    if(n4.label.indexOf('5周目')<0) throw new Error('ラベルが五周目を指していない: '+n4.label);
    setupRoster('inu'); startGame(); state='play';
    n4.go();
    if(lap!==5) throw new Error('lap が5にならない: '+lap);
    if(!encounters.length) throw new Error('戦国のエンカウンタが積まれていない');
    console.log('周回の続き OK (4→5／五周目の先は無し／'+n4.label+')'); }

  // 難易度は四周目より必ず上（最高難度と名乗っている）
  { const at=l=>{ const sv=lap; lap=l; const r=[diffHpMul(),diffDmgMul()]; lap=sv; return r; };
    const a4=at(4), a5=at(5);
    if(!(a5[0]>a4[0])) throw new Error('五周目のHP倍率が四周目以下: '+a4[0]+' → '+a5[0]);
    if(!(a5[1]>a4[1])) throw new Error('五周目の攻撃力倍率が四周目以下: '+a4[1]+' → '+a5[1]);
    console.log('難易度 OK (HP '+a4[0].toFixed(1)+'→'+a5[0].toFixed(1)+' / 攻撃 '+a4[1].toFixed(2)+'→'+a5[1].toFixed(2)+')'); }

  // 五周目のセーブが復元できること
  { const realLS=global.localStorage, mem={};
    global.localStorage={ getItem:k=>(k in mem?mem[k]:null), setItem:(k,v)=>{mem[k]=String(v);}, removeItem:k=>{delete mem[k];} };
    try {
      setupRoster('inu'); startGame(); state='play';
      lap=5; buildEncounters5(); saveProgress(1);
      const sv=loadProgress();
      if(!sv || sv.lap!==5) throw new Error('五周目がセーブに残らない');
      lap=1; startGameAt(sv.stage||1);
      if(lap!==5) throw new Error('セーブから再開すると五周目に戻らない: lap='+lap);
      console.log('五周目のセーブ復元 OK');
    } finally { global.localStorage=realLS; } }

  // 章とワールドマップ
  { if(SENGOKU_CH.length!==3) throw new Error('戦国の章が3つでない: '+SENGOKU_CH.length);
    const bosses=[];
    SENGOKU_CH.forEach(function(ch,i){
      if(!ch.name) throw new Error('章'+i+' に名前が無い');
      const bg=ch.gates.filter(function(g){ return g.boss; });
      if(bg.length!==1) throw new Error('章'+i+' のボス門が1つでない: '+bg.length);
      bosses.push(bg[0].list[0][0]);
      if(STAGE_THEME[ch.theme]===undefined) throw new Error('章'+i+' のテーマ '+ch.theme+' が無い');
      if(!STAGE_THEME[ch.theme].sengoku) throw new Error('章'+i+' が戦国のテーマを指していない'); });
    if(new Set(bosses).size!==3) throw new Error('章ごとのボスが重複している: '+bosses.join(','));
    for(const b of bosses) if(BOSS.indexOf(b)<0) throw new Error('知らないボス: '+b);
    if(new Set(SENGOKU_CH.map(c=>c.theme)).size!==3) throw new Error('章のテーマが重複している');
    // マップ：2ノード＋最終1（最終は規定数クリアで解禁）
    const sv=lap; lap=5;
    if(curWorldLevels()!==WORLD5_LEVELS) throw new Error('五周目のマップが戦国になっていない');
    if(allMapNodes().length!==WORLD5_LEVELS.length+WORLD5_FINAL.length) throw new Error('マップのノード数が合わない');
    const fin=WORLD5_FINAL[0];
    const sd=levelsDone; levelsDone={};
    if(nodeUnlocked(fin)) throw new Error('制覇0でも天守が解禁されている');
    lap=sv; levelsDone=sd;
    console.log('章とマップ OK (3章／ボス '+bosses.join('・')+'／天守は施錠)'); }

  // ===== 2) 雑魚：兵種が7つあり、役割も絵も別 =====
  { for(const k of ZAKO){ const t=ETYPE[k];
      if(!t) throw new Error('雑魚 '+k+' が無い');
      if(!t.sengoku) throw new Error(k+' に sengoku 印が無い＝戦国の絵で描かれない');
      if(!t.sengKind) throw new Error(k+' に兵種が無い');
      if(!t.name) throw new Error(k+' に名前が無い'); }
    if(new Set(ZAKO.map(k=>ETYPE[k].sengKind)).size!==7) throw new Error('兵種が重複している');
    if(new Set(ZAKO.map(k=>ETYPE[k].name)).size!==7) throw new Error('名前が重複している');
    // 役割：それぞれ別のAIの入口を持っていること
    if(!ETYPE.yumihei.gunner || !ETYPE.teppo.gunner) throw new Error('弓と鉄砲が射手になっていない');
    if(!ETYPE.kibahei.rider || ETYPE.kibahei.riderKind!=='horse') throw new Error('騎馬が乗り手になっていない');
    if(!ETYPE.ninja.warper) throw new Error('忍びが背後を取らない');
    if(!ETYPE.taisho.buffer) throw new Error('足軽大将が味方を鼓舞しない');
    if(!ETYPE.samurai.riposte) throw new Error('侍が斬り返さない');
    // 湧きの抽選に入っていること
    if(SENGOKU_ZAKO_POOL.length!==7) throw new Error('抽選プールが7種でない: '+SENGOKU_ZAKO_POOL.length);
    { const sv=lap; lap=5; const seen={};
      for(let i=0;i<400;i++) seen[randZako()]=1;
      lap=sv;
      const miss=ZAKO.filter(k=>!seen[k]);
      if(miss.length) throw new Error('五周目の抽選に出ない兵種: '+miss.join(',')); }
    console.log('兵種 OK (7種／射手・騎馬・忍び・大将・侍が別の役割／抽選にも全部出る)'); }

  // 絵：7種すべてが戦国の描画を通り、しかも形が違うこと
  { setupRoster('inu'); startGame(); state='play'; perfTier=0;
    let via=0; const real=drawSengokuFoe;
    drawSengokuFoe=function(){ via++; return real.apply(null,arguments); };
    const sig={};
    try {
      for(const k of ZAKO){ enemies.length=0; spawnEnemy(k, players[0].x+120, LANE);
        const e=enemies[0]; e.facing=-1; e.anim=1.0; e.state='walk';
        const r=shape(function(){ drawEnemy(e); });
        if(r.n<25) throw new Error(k+' がほとんど描かれていない: '+r.n+'コール');
        sig[k]=r.sig; } }
    finally { drawSengokuFoe=real; }
    if(via!==ZAKO.length) throw new Error('戦国の描画を通らない兵種がある ('+via+'/'+ZAKO.length+')');
    const ks=Object.keys(sig);
    for(let i=0;i<ks.length;i++) for(let j=i+1;j<ks.length;j++)
      if(sig[ks[i]]===sig[ks[j]]) throw new Error('兵種 '+ks[i]+' と '+ks[j]+' が同じ形');
    console.log('兵種の絵 OK (7種すべて drawSengokuFoe を通り、形も全部別)'); }

  // 弓と鉄砲の撃ち分け：色・弾速・構えの長さ・追尾の有無が違うこと
  { setupRoster('inu'); startGame(); state='play';
    const fire=function(k){ enemies.length=0; projectiles.length=0;
      spawnEnemy(k, players[0].x+300, LANE);
      const e=enemies[0]; const t=ETYPE[k];
      e.state='gunFire'; e.gunT=(t.shotWind||18); e.facing=-1;
      const wind=e.gunT;
      let shot=null;
      for(let f=0; f<wind+4 && !shot; f++){ hitStop=0; step(1); if(projectiles.length) shot=projectiles[0]; }
      if(!shot) throw new Error(k+' が撃たない');
      return {wind:wind, spd:Math.abs(shot.vx), col:shot.color, homing:!!shot.homing}; };
    const y=fire('yumihei'), g=fire('teppo'), m=fire('mechawan');
    if(y.homing || g.homing) throw new Error('矢や弾が追尾している（避けようがない）');
    if(!m.homing) throw new Error('前提が崩れている: メカワンコの弾は追尾のはず');
    if(!(g.wind>y.wind)) throw new Error('鉄砲の構えが弓より長くない: 弓'+y.wind+'F 鉄砲'+g.wind+'F');
    if(!(g.spd>y.spd)) throw new Error('鉄砲玉が矢より速くない: '+y.spd+' / '+g.spd);
    if(y.col===g.col) throw new Error('矢と弾が同じ色');
    if(!(ETYPE.teppo.dmg>ETYPE.yumihei.dmg)) throw new Error('鉄砲が弓より痛くない');
    console.log('射撃の撃ち分け OK (弓 '+y.wind+'F/'+y.spd+' 鉄砲 '+g.wind+'F/'+g.spd+'／どちらも直進)'); }

  // 撃った弾が実際に当たること。
  // 「弾が生まれたか」だけを見ていると、レーンがずれていて一度も当たらない弾を
  // 正常と判定してしまう（実際に弓と鉄砲の弾が主役の 50 手前を素通りしていた）
  { const dealt=function(k){
      setupRoster('inu'); startGame(); state='play';
      const p=players[0]; player=p; p.x=camX+200; p.y=LANE; p.hp=p.maxHp=9999; p.invuln=0; p.state='idle'; p.facing=1;
      enemies.length=0; projectiles.length=0; encounters.length=0;
      spawnEnemy(k, camX+560, LANE);
      const e=enemies[0]; e.facing=-1; e.thinkCd=99999; e.state='gunFire'; e.gunT=ETYPE[k].shotWind||18;
      for(let f=0; f<120; f++){ hitStop=0; p.invuln=0; e.thinkCd=99999; step(1); }
      return p.maxHp-p.hp; };
    const dy=dealt('yumihei'), dt=dealt('teppo'), dm=dealt('mechawan');
    if(!(dy>0)) throw new Error('弓の矢が一度も当たらない（レーンがずれている）');
    if(!(dt>0)) throw new Error('鉄砲の弾が一度も当たらない（レーンがずれている）');
    if(!(dm>0)) throw new Error('前提が崩れている: メカワンコの追尾弾は当たるはず');
    if(!(dt>dy)) throw new Error('鉄砲が弓より痛くない（実測）: 弓'+dy+' 鉄砲'+dt);
    console.log('弾が当たること OK (弓 -'+dy+'HP ／ 鉄砲 -'+dt+'HP ／ 追尾弾 -'+dm+'HP)'); }

  // 騎馬は突撃する（止まって殴るだけではない）
  { setupRoster('inu'); startGame(); state='play';
    enemies.length=0; const p=players[0]; player=p; p.hp=p.maxHp=99999; p.invuln=99999;
    p.x=camX+120; spawnEnemy('kibahei', camX+560, LANE);
    const e=enemies[0]; e.thinkCd=0; e.facing=-1;
    let charged=false, x0=e.x;
    for(let f=0;f<200 && !charged;f++){ hitStop=0; e.thinkCd=0; step(1); if(e.state==='bikecharge') charged=true; }
    if(!charged) throw new Error('騎馬が突撃しない');
    for(let f=0;f<40;f++){ hitStop=0; step(1); }
    if(!(Math.abs(e.x-x0)>120)) throw new Error('突撃で駆けていない: '+Math.abs(e.x-x0).toFixed(0)+'px');
    console.log('騎馬の突撃 OK ('+Math.abs(e.x-x0).toFixed(0)+'px 駆け抜ける)'); }

  // ===== 3) 三英傑 =====
  { for(const k of BOSS){ const t=ETYPE[k];
      if(!t) throw new Error('ボス '+k+' が無い');
      if(!t.boss) throw new Error(k+' がボス扱いでない');
      if(!SENGOKU_ART[t.bossKind]) throw new Error(k+' の絵の定義が無い');
      if(!BOSSMOVES[t.bossKind] || !BOSSMOVES[t.bossKind].length) throw new Error(k+' に技が無い');
      if(!BOSS_BGM[k]) throw new Error(k+' に専用BGMが無い');
      for(const mv of BOSSMOVES[t.bossKind]) if(!MV[mv]) throw new Error(k+' の技 '+mv+' が MV に無い'); }
    if(new Set(BOSS.map(k=>ETYPE[k].bossKind)).size!==3) throw new Error('三英傑の種別が重複している');
    if(new Set(BOSS.map(k=>ETYPE[k].name)).size!==3) throw new Error('三英傑の名前が重複している');
    // 専用技：三人がそれぞれ他の二人に無い技を持っていること
    const sets=BOSS.map(k=>new Set(BOSSMOVES[ETYPE[k].bossKind]));
    for(let i=0;i<3;i++){ const own=[...sets[i]].filter(m=>!sets[(i+1)%3].has(m)&&!sets[(i+2)%3].has(m));
      if(own.length<2) throw new Error(BOSS[i]+' に固有の大技が2つ無い: '+own.join(',')); }
    console.log('三英傑 OK (3人／固有の大技と専用BGM)'); }

  // 兜の立物で見分けが付くこと（三人の絵が別であることの根拠）
  { const cnt={}, sig={};
    for(const k of BOSS){ const A=SENGOKU_ART[ETYPE[k].bossKind];
      const r=shape(function(){ cnt[k]=warCrest(A.crest,A,-40,10); });
      sig[k]=r.sig; }
    if(new Set(Object.values(cnt)).size<2) throw new Error('立物の本数が全員同じ: '+JSON.stringify(cnt));
    const ks=Object.keys(sig);
    for(let i=0;i<ks.length;i++) for(let j=i+1;j<ks.length;j++)
      if(sig[ks[i]]===sig[ks[j]]) throw new Error('立物 '+ks[i]+' と '+ks[j]+' が同じ形');
    console.log('兜の立物 OK (信長'+cnt.nobunaga+'本／秀吉'+cnt.hideyoshi+'枚／家康'+cnt.ieyasu+'本、すべて別の形)'); }

  // 三人の全身が別の絵であること
  // perfTier0 だと rimBegin が ctx の束縛をオフスクリーンへ差し替えるので、
  // 追跡している ctx から絵が消える（実測で10コールしか取れなかった）
  { setupRoster('inu'); startGame(); state='play'; perfTier=1;
    let via=0; const real=drawWarlord;
    drawWarlord=function(){ via++; return real.apply(null,arguments); };
    const sig={};
    try { for(const k of BOSS){ enemies.length=0; spawnEnemy(k, players[0].x+180, LANE);
        const e=enemies[0]; e.facing=-1; e.anim=1.0;
        const r=shape(function(){ drawEnemy(e); });
        if(r.n<60) throw new Error(k+' がほとんど描かれていない: '+r.n+'コール');
        sig[k]=r.sig; } }
    finally { drawWarlord=real; }
    if(via!==3) throw new Error('武将の描画を通らないボスがいる ('+via+'/3)');
    const ks=Object.keys(sig);
    for(let i=0;i<ks.length;i++) for(let j=i+1;j<ks.length;j++)
      if(sig[ks[i]]===sig[ks[j]]) throw new Error('武将 '+ks[i]+' と '+ks[j]+' が同じ絵');
    console.log('三英傑の絵 OK (3人すべて drawWarlord を通り、絵も全部別)'); }

  // ===== 4) 大技が実際に効くこと =====
  const setupBoss=function(k,mv){
    setupRoster('inu'); startGame(); state='play'; perfTier=1;
    const p=players[0]; player=p; p.hp=p.maxHp=99999; p.invuln=99999; p.x=camX+160;
    enemies.length=0; projectiles.length=0; hazards.length=0;
    spawnEnemy(k, camX+520, LANE);
    const e=enemies[0]; e.facing=-1; e.hp=e.maxHp=99999;
    e.state='bmove'; e.moveName=mv; e.moveT=0; e.moveMax=MV[mv].dur; e.telegraph=0; e.thinkCd=99999;
    return e; };
  const runMove=function(e,frames){ for(let f=0; f<frames; f++){ hitStop=0; e.thinkCd=99999;
      if(e.state!=='bmove'){ e.state='bmove'; }
      runBossMove(e); e.moveT++; } };

  // 信長：三段撃ち＝三度に分けて、別々の高さへ撃つ
  { const e=setupBoss('nobunaga','teppoVolley');
    const waves=[]; let prev=0;
    for(let f=0; f<MV.teppoVolley.dur; f++){ hitStop=0; runBossMove(e); e.moveT++;
      if(projectiles.length>prev){ waves.push({f:f, n:projectiles.length-prev, z:projectiles[projectiles.length-1].zz}); prev=projectiles.length; } }
    if(waves.length!==3) throw new Error('三段撃ちが三段になっていない: '+waves.length+'段');
    if(new Set(waves.map(w=>Math.round(w.z))).size!==3) throw new Error('三段が同じ高さ＝一度跳べば全部避けられる');
    for(const w of waves) if(w.n<3) throw new Error('一段が3発未満: '+w.n);
    if(projectiles.some(q=>q.homing)) throw new Error('鉄砲玉が追尾している');
    console.log('信長 三段撃ち OK (3段×'+waves[0].n+'発／高さ '+waves.map(w=>Math.round(w.z)).join('/')+')'); }

  // 信長：第六天魔王＝以後の攻撃力が上がる
  { const e=setupBoss('nobunaga','demonKing');
    const before=foeAtkMul(e);
    runMove(e, MV.demonKing.dur);
    const after=foeAtkMul(e);
    if(!(after>before*1.1)) throw new Error('第六天魔王で強くならない: '+before.toFixed(2)+' → '+after.toFixed(2));
    if(!e.rage) throw new Error('激昂していない');
    console.log('信長 第六天魔王 OK (攻撃力 '+before.toFixed(2)+' → '+after.toFixed(2)+')'); }

  // 信長：天下布武＝ガード不能の大薙ぎで実際に当たる
  { const e=setupBoss('nobunaga','tenkaFubu');
    const p=players[0]; p.invuln=0; p.hp=p.maxHp=99999; p.x=e.x-90;
    let hit=false; const realHurt=hurtPlayer;
    hurtPlayer=function(){ hit=true; return realHurt.apply(null,arguments); };
    try { runMove(e, MV.tenkaFubu.dur); } finally { hurtPlayer=realHurt; }
    if(!hit) throw new Error('天下布武が当たらない');
    console.log('信長 天下布武 OK (踏み込んで当たる)'); }

  // 秀吉：中国大返し＝画面を大きく往復する
  { const e=setupBoss('hideyoshi','ogaeshi');
    const x0=e.x; let far=0, turns=0, pf=e.facing;
    runMoveTrack: for(let f=0; f<MV.ogaeshi.dur; f++){ hitStop=0; runBossMove(e); e.moveT++;
      far=Math.max(far, Math.abs(e.x-x0)); if(e.facing!==pf){ turns++; pf=e.facing; } }
    if(!(far>200)) throw new Error('大返しで駆けていない: '+far.toFixed(0)+'px');
    console.log('秀吉 中国大返し OK ('+far.toFixed(0)+'px 往復／向き変え '+turns+'回)'); }

  // 秀吉：一夜城＝兵が湧き、本人も立て直す
  { const e=setupBoss('hideyoshi','ichiyaJo');
    e.hp=Math.round(e.maxHp*0.5); const hp0=e.hp;
    const n0=enemies.length;
    runMove(e, MV.ichiyaJo.dur);
    if(!(enemies.length>n0)) throw new Error('一夜城で兵が湧かない');
    if(!(e.hp>hp0)) throw new Error('一夜城で立て直さない: '+hp0+' → '+e.hp);
    console.log('秀吉 一夜城 OK (兵 +'+(enemies.length-n0)+'／HP '+hp0+' → '+e.hp+')'); }

  // 家康：鶴翼の陣＝左右から挟む
  { const e=setupBoss('ieyasu','kakuyoku');
    const p=players[0]; p.x=camX+400;
    const n0=enemies.length;
    runMove(e, MV.kakuyoku.dur);
    const added=enemies.slice(n0);
    if(added.length<2) throw new Error('鶴翼の陣で両翼が出ない: '+added.length+'体');
    const l=added.filter(o=>o.x<p.x).length, r=added.filter(o=>o.x>p.x).length;
    if(!(l>=1 && r>=1)) throw new Error('片側にしか出ていない（挟めていない）: 左'+l+' 右'+r);
    console.log('家康 鶴翼の陣 OK (左'+l+'体・右'+r+'体で挟む)'); }

  // 家康：三方ヶ原の反攻＝構え中に殴った分だけ返しが重くなる
  { const measure=function(dmgIn){
      const e=setupBoss('ieyasu','mikataGaeshi');
      const p=players[0]; p.invuln=0; p.hp=p.maxHp=999999; p.x=e.x-70;
      let got=0; const realHurt=hurtPlayer;
      hurtPlayer=function(q,d){ got=Math.max(got,d); return realHurt.apply(null,arguments); };
      try { for(let f=0; f<MV.mikataGaeshi.dur; f++){ hitStop=0;
          if(f===10 && dmgIn>0) damageEnemy(e, dmgIn, 0, false);
          runBossMove(e); e.moveT++; } }
      finally { hurtPlayer=realHurt; }
      return got; };
    const plain=measure(0), fed=measure(60);
    if(!(plain>0)) throw new Error('反攻が当たらない');
    if(!(fed>plain)) throw new Error('殴っても返しが重くならない: '+plain+' → '+fed);
    console.log('家康 三方ヶ原の反攻 OK (無傷 '+plain+' ／ 60ダメージ受けた後 '+fed+')'); }

  // ===== 5) 背景の三景 =====
  { const idx=[]; STAGE_THEME.forEach(function(T,i){ if(T.sengoku) idx.push(i); });
    if(idx.length!==3) throw new Error('戦国のテーマが3つでない: '+idx.length);
    const lands=idx.map(i=>STAGE_THEME[i].land), fgs=idx.map(i=>STAGE_THEME[i].fg);
    for(const l of lands) if(!LAND[l]) throw new Error('地形 '+l+' が未実装（既定の尾根に落ちる）');
    if(new Set(lands).size!==3) throw new Error('三景の地形が重複している: '+lands.join(','));
    const sig={};
    for(const l of lands){ const r=shape(function(){ LAND[l](STAGE_THEME[idx[0]]); });
      if(r.n<40) throw new Error('地形 '+l+' がほとんど描かれていない: '+r.n);
      sig[l]=r.sig; }
    const ks=Object.keys(sig);
    for(let i=0;i<ks.length;i++) for(let j=i+1;j<ks.length;j++)
      if(sig[ks[i]]===sig[ks[j]]) throw new Error('地形 '+ks[i]+' と '+ks[j]+' が同じ形');
    // 炎上する天守に白い雲を浮かべない（夜の火事に昼の雲が出る）
    const fire=idx.filter(i=>STAGE_THEME[i].land==='tenshu')[0];
    if(fire==null) throw new Error('天守のテーマが無い');
    let cloudCalls=0; const realCloud=cloud; cloud=function(){ cloudCalls++; };
    try { const sv=STAGE2THEME[stage]; STAGE2THEME[stage]=fire; bgCacheTheme=-1;
      shape(function(){ drawBackground(); });
      STAGE2THEME[stage]=sv; bgCacheTheme=-1; }
    finally { cloud=realCloud; }
    if(cloudCalls>0) throw new Error('炎上する天守に雲が '+cloudCalls+'個 浮いている');
    console.log('戦国の三景 OK ('+lands.join('/')+' が別の形／天守に雲0個)'); }

  console.log('SENGOKU TEST PASSED'); process.exit(0);
})().catch(e=>{ console.error('FAIL:', e.message, e.stack); process.exit(1); });
`;
code = code + "\n;" + DRIVER;
(0, eval)(code);

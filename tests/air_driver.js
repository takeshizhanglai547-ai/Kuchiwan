global.__HTML = html;
const DRIVER = `
(async()=>{
  const step=(n)=>{ for(let i=0;i<n;i++){ if(global.rafCb){ const cb=global.rafCb; global.rafCb=null; cb(); } } };
  const KINDS=['inu','shima','nuko','guard8','watch','wanden','mack'];
  const setup=function(kind){ setupRoster(kind); startGame(); state='play'; gimOn=false;
    const p=players[0]; p.kind=kind; resetPlayer(p,true); player=p;
    p.hp=p.maxHp=99999; p.lives=9; p.invuln=99999; p.level=1;
    p.state='idle'; p.z=0; p.vz=0; p.atk=null; p.x=600; p._tx=null; p.facing=1;
    enemies.length=0; projectiles.length=0; encounters.length=0;
    p.in.keys={}; p.in.K={}; for(const k in p.in.pressed) p.in.pressed[k]=false;
    // 前のスイートで積まれたコマンド入力が残っていると、押した瞬間に必殺技が暴発する
    consumeCmd();
    return p; };
  // 跳んで、指定回数だけ空中で攻撃ボタンを押す
  const raveRun=function(kind, presses, gap){
    const p=setup(kind);
    p.in.pressed.jump=true; step(1);
    if(p.state!=='jump') throw new Error(kind+' が跳べていない');
    const seen=[], xs=[], zs=[];
    let done=0;
    for(let f=0;f<260;f++){
      if(done<presses && p.jAtk<=0 && p.z>20){ p.in.pressed.atk=true; done++; }
      step(1);
      if((p.jRave|0)>0 && seen.indexOf(p.jRave|0)<0) seen.push(p.jRave|0);
      xs.push(p.x); zs.push(p.z);
      if(p.z<=0 && f>6) break; }
    return {seen:seen, p:p, xs:xs, zs:zs};
  };

  // ===== 1) 空中の通常攻撃は、キャラごとの段数を持つコンボになっている =====
  { const want={inu:4, shima:4, nuko:3, watch:4, mack:3, guard8:1, wanden:1};
    KINDS.forEach(function(k){
      const set=AIR_RAVE[k];
      if(!set) throw new Error(k+' の空中コンボが無い');
      if(set.length!==want[k]) throw new Error(k+' の空中コンボが '+set.length+' 段（'+want[k]+'段のはず）');
      const names={};
      set.forEach(function(R){ if(names[R.name]) throw new Error(k+' の空中コンボに同じ段がある: '+R.name); names[R.name]=1;
        if(!(R.dmg>0&&R.reach>0&&R.dur>0)) throw new Error(k+'/'+R.name+' の数値が入っていない'); });
      // 締めの段があること
      if(!set.some(function(R){ return R.fin; })) throw new Error(k+' の空中コンボに締めの段が無い'); });
    // 大ぶりの得物は一段だけ
    if(AIR_RAVE.guard8.length!==1 || AIR_RAVE.wanden.length!==1)
      throw new Error('ガードワン／ワンデンが一段になっていない');
    console.log('空中コンボの段数 OK ('+KINDS.map(function(k){return k+':'+AIR_RAVE[k].length;}).join(' ')+')'); }

  // ===== 2) 押すたびに次の段へ進み、猶予を過ぎると1段目へ戻る =====
  { const r=raveRun('inu', 4);
    if(r.seen.join(',')!=='1,2,3,4') throw new Error('段が順に進まない（'+r.seen.join(',')+'）');
    // 1段しか無いキャラは1のまま
    const g=raveRun('guard8', 3);
    if(g.seen.join(',')!=='1') throw new Error('一段のキャラで段が進んでいる（'+g.seen.join(',')+'）');
    // 間を空けると1段目へ戻る
    { const p=setup('inu');
      p.in.pressed.jump=true; step(1);
      p.in.pressed.atk=true; step(1);
      const first=p.jRave|0;
      for(let f=0;f<RAVE_LINK+40;f++){ p.vz=Math.max(p.vz,0.4); step(1); }   // 落ちないよう浮かせたまま待つ
      p.in.pressed.atk=true; step(1);
      if((p.jRave|0)!==1) throw new Error('猶予を過ぎても段が繋がったまま（'+first+'→'+p.jRave+'）'); }
    console.log('段の繋がり OK (1→2→3→4／猶予切れで1へ戻る)'); }

  // ===== 3) 空中攻撃中も止まらず、前へ流れる（慣性） =====
  { const p=setup('inu');
    p.in.pressed.jump=true; step(1);
    for(let f=0;f<10;f++) step(1);
    const x0=p.x;
    p.in.pressed.atk=true;
    let moved=0, frozen=0;
    for(let f=0;f<14;f++){ const px=p.x; step(1);
      const d=Math.abs(p.x-px); moved+=d; if(d<0.05) frozen++; }
    if(!(moved>18)) throw new Error('空中攻撃中に '+moved.toFixed(1)+'px しか動かない（その場で止まっている）');
    if(frozen>6) throw new Error('空中攻撃中に '+frozen+'F 完全停止している');
    // 高度も固定されない（以前は vz=0 のホバーだった）
    { const q=setup('inu'); q.in.pressed.jump=true; step(1);
      for(let f=0;f<10;f++) step(1);
      q.in.pressed.atk=true; step(1);
      const zs=[]; for(let f=0;f<10;f++){ step(1); zs.push(q.z); }
      const same=zs.every(function(z){ return Math.abs(z-zs[0])<0.01; });
      if(same) throw new Error('空中攻撃中に高度が固定されている（ホバーのまま）'); }
    console.log('慣性 OK (斬っている間に '+Math.round(moved)+'px 前進・高度も動く)'); }

  // ===== 4) 段ごとに実際に敵へ当たる =====
  { KINDS.forEach(function(k){
      const set=AIR_RAVE[k];
      for(let i=0;i<set.length;i++){
        const p=setup(k);
        p.state='jump'; p.z=90; p.vz=0; p.jAtk=0; p.aerial=i; p.raveT=RAVE_LINK; p.jRave=0;
        enemies.length=0; spawnEnemy('wolf', p.x+60, p.y);
        const e=enemies[0]; e.hp=e.maxHp=99999; e.poise=99999; e.thinkCd=99999;
        const hp0=e.hp;
        p.in.pressed.atk=true;
        // 着地すると段はリセットされるので、出た段は回している最中に控えておく
        let sawRave=0;
        for(let f=0;f<40;f++){ hitStop=0; slowmo=0; e.x=p.x+60; e.z=Math.max(e.z,60); e.vx=0;
          p.z=Math.max(p.z,40);                       // 落ちきる前に測り終える
          step(1);
          if((p.jRave|0)>sawRave) sawRave=p.jRave|0; }
        if(sawRave!==i+1) throw new Error(k+' の'+(i+1)+'段目が出ない（出た段='+sawRave+'）');
        if(!(hp0-e.hp>0)) throw new Error(k+' の'+(i+1)+'段目（'+set[i].name+'）が当たらない'); } });
    console.log('全段が命中 OK'); }

  // ===== 5) 空中でもコマンド技が出せる =====
  { const p=setup('inu');
    p.state='jump'; p.z=150; p.vz=0; p.jAtk=0;
    // 波動コマンドを直接成立させる（入力の作り方はコマンド判定の担当）
    const real=hadokenReady; hadokenReady=function(){ return true; };
    try{ p.in.pressed.atk=true; step(1); } finally { hadokenReady=real; }
    if(p.state!=='attack') throw new Error('空中で波動コマンドが出ない（'+p.state+'）');
    if(!p.atk.air) throw new Error('空中から出した技として扱われていない');
    // 地上の技ではなく、空中専用の技が出る
    if(p.atk.type!==airSpecialFor(p,'hadou')) throw new Error('別の技が出ている（'+p.atk.type+'）');
    if(p.atk.type===specialFor(p,'hadou')) throw new Error('地上の波動がそのまま出ている');
    // 技の最中も落ちる（宙に貼りつかない）
    const z0=p.z; let low=z0;
    for(let f=0;f<40;f++){ step(1); if(p.z<low) low=p.z; if(p.state!=='attack') break; }
    if(!(low<z0-10)) throw new Error('空中の技で高度が固まっている（'+Math.round(z0)+'→'+Math.round(low)+'）');
    console.log('空中コマンド技 OK ('+ATK[airSpecialFor(p,'hadou')].name+'・'+Math.round(z0)+'→'+Math.round(low)+'px へ落下)'); }

  // ===== 6) 空中奥義は7キャラぶんあり、地上の奥義と別物 =====
  { KINDS.forEach(function(k){
      const id=AIR_ULT[k]; if(!id) throw new Error(k+' の空中奥義が無い');
      const def=ATK[id]; if(!def) throw new Error(k+' の空中奥義 '+id+' が ATK に無い');
      if(!def.ultMove) throw new Error(id+' が奥義扱いになっていない');
      if(!def.airUlt) throw new Error(id+' に空中奥義の中身が無い');
      if(def.dimBlade) throw new Error(id+' に次元斬専用の dimBlade が付いている');
      if(!def.name || def.name===ULT_NAME[k]) throw new Error(k+' の空中奥義が地上と同じ名前');
      if(airUltName(k)!==def.name) throw new Error(k+' のカットインに出る名前が技名と違う（'+airUltName(k)+'）'); });
    // 技IDも中身も重ならない
    const ids={}; KINDS.forEach(function(k){ if(ids[AIR_ULT[k]]) throw new Error('空中奥義を使い回している: '+AIR_ULT[k]); ids[AIR_ULT[k]]=1; });
    const kinds={}; KINDS.forEach(function(k){ const kk=ATK[AIR_ULT[k]].airUlt;
      if(kinds[kk]) throw new Error('空中奥義の中身が重複している: '+kk); kinds[kk]=1; });
    console.log('空中奥義の登録 OK ('+KINDS.map(function(k){return ATK[AIR_ULT[k]].name;}).join('／')+')'); }

  // ===== 7) 空中奥義が出て、ストックを消費し、敵を減らす =====
  { KINDS.forEach(function(k){
      const p=setup(k);
      p.dimMax=9; p.dim=9; p.level=1;
      p.state='jump'; p.z=210; p.vz=0; p.jAtk=0;
      enemies.length=0;
      const list=[];
      for(let j=0;j<6;j++){ spawnEnemy('wolf', p.x-140+j*60, p.y); const e=enemies[enemies.length-1];
        e.hp=e.maxHp=99999; e.poise=99999; e.thinkCd=99999; list.push(e); }
      const hp0=list.reduce(function(a,e){ return a+e.hp; },0), dim0=p.dim;
      const real=rotationReady; rotationReady=function(){ return true; };
      try{ p.in.pressed.atk=true; step(1); } finally { rotationReady=real; }
      if(!p.atk || p.atk.type!==AIR_ULT[k]) throw new Error(k+' の空中奥義が出ない（'+(p.atk&&p.atk.type)+'）');
      // カットインは地上の奥義名ではなく、空中奥義の名前を出す
      if(ultCut && ultCut.name && ultCut.name!==ATK[AIR_ULT[k]].name)
        throw new Error(k+' のカットインが地上の奥義名のまま（'+ultCut.name+'）');
      if(!(p.dim<dim0)) throw new Error(k+' の空中奥義でストックが減らない');
      for(let f=0;f<200;f++){ hitStop=0; slowmo=0;
        list.forEach(function(e){ e.x=e._fx||(e._fx=e.x); e.vx=0; e.state='walk'; });
        step(1); }
      const dmg=hp0-list.reduce(function(a,e){ return a+e.hp; },0);
      if(!(dmg>0)) throw new Error(k+' の空中奥義（'+ATK[AIR_ULT[k]].name+'）が一体も削らない'); });
    console.log('空中奥義の効果 OK (7キャラとも発動・ストック消費・命中)'); }

  // ===== 8) 空中のコマンド技は地上とは別の技になっている =====
  { const SLOTS=['dp','hadou','du'];
    const ids={};
    KINDS.forEach(function(k){
      SLOTS.forEach(function(sl){
        const p={kind:k};
        const air=airSpecialFor(p, sl), gnd=specialFor(p, sl);
        if(!ATK[air]) throw new Error(k+'/'+sl+' の空中技が ATK に無い（'+air+'）');
        if(air===gnd) throw new Error(k+'/'+sl+' が地上の技のまま（'+air+'）');
        if(ATK[air].name===ATK[gnd].name) throw new Error(k+'/'+sl+' が地上と同じ技名（'+ATK[air].name+'）');
        if(ids[air]) throw new Error('空中技を使い回している: '+air+'（'+ids[air]+' と '+k+'/'+sl+'）');
        ids[air]=k+'/'+sl; }); });
    if(Object.keys(ids).length!==KINDS.length*SLOTS.length)
      throw new Error('空中技が '+Object.keys(ids).length+' 個しかない（'+(KINDS.length*SLOTS.length)+'個のはず）');
    // 3枠とも、キャラごとに別の仕掛けであること。
    // 「どれも叩きつけ」「どれも飛び道具を撃つだけ」「どれも回転するだけ」で
    // 揃ってしまうのを防ぐ（3枠それぞれで実際にそうなっていた）
    ['dp','hadou','du'].forEach(function(sl){
      const fx={}, plain=[];
      KINDS.forEach(function(k){
        const d=ATK[airSpecialFor({kind:k},sl)];
        if(!d.airFx && !d.pshot) plain.push(k+'/'+sl);      // 中身の無いただの一振り
        const id=d.airFx || ('pshot:'+JSON.stringify(d.pshot||{}));
        if(fx[id]) throw new Error(sl+' の中身が '+fx[id]+' と '+k+' で同じ（'+id+'）');
        fx[id]=k; });
      if(plain.length) throw new Error('中身の無い空中技がある: '+plain.join(','));
      // 「飛び道具を1発撃つだけ」で済ませない。7キャラとも専用の仕掛けを持つこと
      const noFx=KINDS.filter(function(k){ return !ATK[airSpecialFor({kind:k},sl)].airFx; });
      if(noFx.length) throw new Error(sl+' に専用の仕掛けが無いキャラがいる: '+noFx.join(','));
      if(Object.keys(fx).length!==KINDS.length)
        throw new Error(sl+' の仕掛けが '+Object.keys(fx).length+' 種類しかない'); });
    // ↓↑が全キャラ「回転」にならないこと（実際にそうなっていて、個性が無いと指摘された）
    { const spin=KINDS.filter(function(k){ return ATK[airSpecialFor({kind:k},'du')].spin; });
      if(spin.length>1) throw new Error('↓↑が '+spin.length+' キャラで回転技（回転で通すのは1人まで）: '+spin.join(',')); }
    // どの枠も「同じ型ばかり」にならないこと。
    // 型は動き方で分ける（上がる／落として叩きつける／急降下／その場で留まる）
    { const shapeOf=function(d){ return d.airMeteor? 'メテオ' : d.airDive? '急降下'
        : (d.rise||d.shoryu)? '上昇' : ((d.airHover|0)>=30? '滞空' : 'その他'); };
      ['dp','hadou','du'].forEach(function(sl){
        const c={};
        KINDS.forEach(function(k){ const sh=shapeOf(ATK[airSpecialFor({kind:k},sl)]);
          (c[sh]=c[sh]||[]).push(k); });
        // 「その他」は分類できなかった寄せ集めなので、偏りの判定からは外す
        // （中身が別物であることは、上の airFx の突き合わせで既に保証している）
        for(const sh in c){ if(sh!=='その他' && c[sh].length>3)
          throw new Error(sl+' の型が「'+sh+'」に偏っている（'+c[sh].length+'キャラ: '+c[sh].join(',')+'）'); } }); }
    // 波動枠が「前へ弾を撃つだけ」にならないこと（1キャラでも残っていれば指摘の再発）
    { const shot=KINDS.filter(function(k){ const d=ATK[airSpecialFor({kind:k},'hadou')]; return !!d.pshot && !d.airFx; });
      if(shot.length) throw new Error('波動が撃つだけのままのキャラがいる: '+shot.join(',')); }
    console.log('空中コマンド技 21種 OK (昇竜・波動・↓↑とも、7キャラそれぞれ別の仕掛け)'); }

  // ===== 9) 空中のコマンド技が実際に出て、敵に届く =====
  { const SLOTS=['dp','hadou','du'];
    const gate={dp:'dpReady', hadou:'hadokenReady', du:'downUpReady'};
    KINDS.forEach(function(k){
      SLOTS.forEach(function(sl){
        const p=setup(k);
        p.state='jump'; p.z=180; p.vz=0; p.jAtk=0;
        enemies.length=0;
        const list=[];
        for(let j=0;j<5;j++){ spawnEnemy('wolf', p.x-60+j*60, p.y); const e=enemies[enemies.length-1];
          e.hp=e.maxHp=99999; e.poise=99999; e.thinkCd=99999; e._fx=e.x; list.push(e); }
        const hp0=list.reduce(function(a2,e){ return a2+e.hp; },0);
        const want=airSpecialFor(p, sl);
        const real=global[gate[sl]]; global[gate[sl]]=function(){ return true; };
        try{ p.in.pressed.atk=true; step(1); } finally { global[gate[sl]]=real; }
        if(!p.atk || p.atk.type!==want) throw new Error(k+'/'+sl+' が空中で出ない（'+(p.atk&&p.atk.type)+'）');
        if(!p.atk.air) throw new Error(k+'/'+sl+' が空中の技として扱われていない');
        for(let f=0;f<140;f++){ hitStop=0; slowmo=0;
          list.forEach(function(e){ e.x=e._fx; e.vx=0; e.state='walk'; e.z=Math.max(e.z,0); });
          step(1); }
        const dmg=hp0-list.reduce(function(a2,e){ return a2+e.hp; },0);
        if(!(dmg>0)) throw new Error(k+'/'+sl+'（'+ATK[want].name+'）が一体も削らない'); }); });
    // 急降下型の技だけは、着地したときに衝撃波を出す（当てられなくても着地に意味を持たせる）
    KINDS.filter(function(k){ return ATK[airSpecialFor({kind:k},'dp')].airDive; }).forEach(function(k){
      const p=setup(k);
      p.state='jump'; p.z=150; p.vz=0; p.jAtk=0;
      enemies.length=0; spawnEnemy('wolf', p.x+300, p.y);   // 近接では届かない位置
      const e=enemies[0]; e.hp=e.maxHp=99999; e.poise=99999; e.thinkCd=99999; e._fx=e.x;
      const want=airSpecialFor(p,'dp');
      const rd=dpReady; dpReady=function(){ return true; };
      try{ p.in.pressed.atk=true; step(1); } finally { dpReady=rd; }
      if(!p.atk || p.atk.type!==want) throw new Error(k+' の急降下技が出ない');
      const realSW=shockwave; let n=0;
      shockwave=function(){ n++; return realSW.apply(null, arguments); };
      try{ for(let f=0;f<140;f++){ hitStop=0; slowmo=0; e.x=e._fx; e.vx=0; step(1); } }
      finally { shockwave=realSW; }
      if(!(n>0)) throw new Error(k+' の急降下技が着地しても衝撃波を出さない'); });
    console.log('空中コマンド技の命中 OK (7キャラ×3枠すべて／急降下は着地で衝撃波)'); }

  // ===== 10) 空中奥義は着地で打ち切られず、低い跳躍からでも成立する =====
  { KINDS.forEach(function(k){
      const run=function(z0){ const p=setup(k); p.dimMax=9; p.dim=9;
        enemies.length=0;
        const list=[];
        for(let j=0;j<8;j++){ spawnEnemy('wolf', p.x-200+j*70, p.y); const e=enemies[enemies.length-1];
          e.hp=e.maxHp=99999; e.poise=99999; e.thinkCd=99999; e._fx=e.x; list.push(e); }
        const hp0=list.reduce(function(a2,e){ return a2+e.hp; },0);
        p.state='jump'; p.z=z0; p.vz=0; p.jAtk=0;
        p.invuln=0;                                  // 奥義そのものが無敵を付けるかを見る
        const real=rotationReady; rotationReady=function(){ return true; };
        try{ p.in.pressed.atk=true; step(1); } finally { rotationReady=real; }
        if(!p.atk || p.atk.type!==AIR_ULT[k]) throw new Error(k+' の空中奥義が z='+z0+' で出ない');
        let ran=0, inv=0;
        for(let f=0;f<220;f++){ hitStop=0; slowmo=0;
          list.forEach(function(e){ e.x=e._fx; e.vx=0; e.state='walk'; });
          if(p.atk && p.atk.type===AIR_ULT[k]){ ran=p.atk.t; if(p.invuln>0) inv++; }
          step(1); }
        return {ran:ran, inv:inv, dmg:hp0-list.reduce(function(a2,e){ return a2+e.hp; },0)}; };
      const def=ATK[AIR_ULT[k]];
      const lo=run(50), hi=run(220);
      // 地面すれすれから出しても、出だしで高さを稼いでから成立する
      if(def.airRise){ const p2=setup(k); p2.dimMax=9; p2.dim=9;
        p2.state='jump'; p2.z=14; p2.vz=0; p2.jAtk=0;
        const r2=rotationReady; rotationReady=function(){ return true; };
        try{ p2.in.pressed.atk=true; step(1); } finally { rotationReady=r2; }
        let peak=p2.z;
        for(let f=0;f<40;f++){ step(1); if(p2.z>peak) peak=p2.z; }
        if(!(peak>=70)) throw new Error(k+' の空中奥義が地面すれすれから出すと上がらない（頂点 '+Math.round(peak)+'px）'); }
      // 低い跳躍からでも当たること（以前は高さが足りずに不発だった）
      if(!(lo.dmg>0)) throw new Error(k+' の空中奥義が低い跳躍（z=50）から一体も削らない');
      if(!(hi.dmg>0)) throw new Error(k+' の空中奥義が高い跳躍から一体も削らない');
      // 高さで結果が別物にならないこと（使い勝手の要）
      const rat=Math.max(lo.dmg,hi.dmg)/Math.max(1,Math.min(lo.dmg,hi.dmg));
      if(rat>2.6) throw new Error(k+' の空中奥義が高さで '+rat.toFixed(1)+'倍も変わる（低'+Math.round(lo.dmg)+'／高'+Math.round(hi.dmg)+'）');
      // 落下してぶつける型を除き、着地で打ち切られず出し切ること
      if(!def.airSlam && hi.ran < def.dur-2)
        throw new Error(k+' の空中奥義が着地で打ち切られる（'+hi.ran+'/'+def.dur+'F）');
      // 出している間は無敵（出際を潰されると1ストックが丸ごと消える）
      if(!(hi.inv>=hi.ran-2)) throw new Error(k+' の空中奥義に無敵が付いていない（'+hi.inv+'/'+hi.ran+'F）'); });
    console.log('空中奥義の使い勝手 OK (低い跳躍でも成立・高さで2.6倍以内・出し切り・全時間無敵)'); }

  // ===== 11) 空中奥義は攻撃＋掴みの同時押しでも出せる =====
  { const p=setup('inu'); p.dimMax=9; p.dim=9;
    p.state='jump'; p.z=170; p.vz=0; p.jAtk=0;
    p.in.pressed.atk=true; p.in.pressed.grab=true; step(1);
    if(!p.atk || p.atk.type!==AIR_ULT.inu) throw new Error('攻撃＋掴みで空中奥義が出ない（'+(p.atk&&p.atk.type)+'）');
    console.log('空中奥義の入力 OK (レバー回し以外に 攻撃＋掴み でも出る)'); }

  // ===== 12) 空中でも回避できる（エアドッジ） =====
  { const p=setup('inu');
    p.in.pressed.jump=true; step(1);
    for(let f=0;f<8;f++) step(1);
    if(p.state!=='jump') throw new Error('跳べていない');
    p.invuln=0;
    const x0=p.x, z0=p.z;
    p.in.K.right=true; p.in.pressed.grd=true; step(1);
    if(!((p.adT|0)>0)) throw new Error('空中で回避が出ない');
    if(!(p.invuln>=ADODGE_INV-1)) throw new Error('空中回避に無敵が付かない（'+p.invuln+'）');
    let moved=0;
    for(let f=0;f<ADODGE_T;f++){ const px=p.x; step(1); moved+=Math.abs(p.x-px); }
    p.in.K.right=false;
    if(!(moved>60)) throw new Error('空中回避で '+Math.round(moved)+'px しか動かない');
    if(!(p.x>x0+40)) throw new Error('入れた向き（右）へ移動していない');
    // 二度目は出ない（着地するまで一度きり）
    p.in.pressed.grd=true; step(1);
    if((p.adT|0)>0) throw new Error('着地せずに二度目の空中回避が出る');
    console.log('空中回避 OK ('+Math.round(moved)+'px 移動・無敵'+ADODGE_INV+'F・空中では一度きり)'); }

  // ===== 13) 上下方向へも回避でき、着地すると回数が戻る =====
  { const p=setup('inu');
    p.in.pressed.jump=true; step(1);
    for(let f=0;f<8;f++) step(1);
    const z0=p.z;
    p.in.K.up=true; p.in.pressed.grd=true; step(1);
    let peak=p.z;
    for(let f=0;f<ADODGE_T;f++){ step(1); if(p.z>peak) peak=p.z; }
    p.in.K.up=false;
    if(!(peak>z0+30)) throw new Error('上へ回避しても上がらない（'+Math.round(z0)+'→'+Math.round(peak)+'）');
    // 着地して跳び直せば、また使える
    for(let f=0;f<200 && p.z>0; f++) step(1);
    for(let f=0;f<20 && p.state!=='idle'; f++) step(1);
    p.in.pressed.jump=true; step(1);
    for(let f=0;f<6;f++) step(1);
    p.in.pressed.grd=true; step(1);
    if(!((p.adT|0)>0)) throw new Error('跳び直しても空中回避が戻らない');
    console.log('空中回避の向きと回数 OK (上へ '+Math.round(peak-z0)+'px／跳び直しで復活)'); }

  // ===== 14) 吹き飛ばしが自分の跳躍に見合う大きさになっている =====
  { const kb=function(type, dmg){
      const p=setup('inu'); p.invuln=0; p.z=0; p.state='idle';
      p.x=camX+W*0.5; p._tx=null; p.facing=-1;
      enemies.length=0; spawnEnemy(type, p.x-50, p.y);
      const e=enemies[0]; e.facing=1; e.x=p.x-50;
      const x0=p.x;
      if(!hitOnePlayer(p, e, dmg, true, 200, 60)) throw new Error(type+' の攻撃が当たらない（測れていない）');
      let peak=0, far=0;
      for(let f=0;f<220;f++){ step(1); if(p.z>peak) peak=p.z;
        const d=Math.abs(p.x-x0); if(d>far) far=d;
        if(p.z<=0 && f>4 && p.state!=='down') break; }
      return {peak:peak, far:far}; };
    // 期待値は直値で置く。定数と比べると、その定数を下げた瞬間に素通りする
    const z=kb('wolf',10);
    if(!(z.peak>180)) throw new Error('雑魚に倒されても '+Math.round(z.peak)+'px しか浮かない');
    if(!(z.far>120)) throw new Error('雑魚に倒されても '+Math.round(z.far)+'px しか飛ばない');
    let bossType=null; for(const k in ETYPE) if(ETYPE[k].boss && !ETYPE[k].heroBoss){ bossType=k; break; }
    const b2=kb(bossType,16);
    if(!(b2.peak>z.peak+80)) throw new Error('ボスの一撃が雑魚と大差ない高さ（'+Math.round(z.peak)+' / '+Math.round(b2.peak)+'）');
    // 吹き飛ばされている最中に受け身が取れること（大きくしたぶん、逃げ道が要る）
    { const p=setup('inu'); p.invuln=0; p.z=0; p.state='idle'; p.x=camX+W*0.5; p._tx=null;
      enemies.length=0; spawnEnemy('wolf', p.x-50, p.y);
      const e=enemies[0]; e.facing=1; e.x=p.x-50;
      hitOnePlayer(p, e, 10, true, 200, 60);
      for(let f=0;f<RECOV_LOCK+2;f++) step(1);
      p.in.pressed.jump=true; step(1);
      if(p.state!=='jump') throw new Error('大きく吹き飛ばされると受け身が取れない（'+p.state+'）');
      // 受け身のあとは空中回避も使える
      p.in.pressed.grd=true; step(1);
      if(!((p.adT|0)>0)) throw new Error('受け身のあとに空中回避が使えない'); }
    console.log('吹き飛ばしの大きさ OK (雑魚 高さ'+Math.round(z.peak)+'px・距離'+Math.round(z.far)
      +'px／'+ETYPE[bossType].name+' 高さ'+Math.round(b2.peak)+'px・距離'+Math.round(b2.far)+'px／受け身と空中回避で復帰可)'); }

  // ===== 15) 作り直した空中奥義（ヌコ・ガードワン）が、独自の仕掛けで戦えている =====
  { const ult=function(k, place){
      const p=setup(k); p.dimMax=9; p.dim=9; p.invuln=0;
      enemies.length=0;
      const list=[];
      place.forEach(function(dx){ spawnEnemy('wolf', p.x+dx, p.y); const e=enemies[enemies.length-1];
        e.hp=e.maxHp=99999; e.poise=99999; e.thinkCd=99999; e._fx=e.x; list.push(e); });
      const hp0=list.reduce(function(a2,e){ return a2+e.hp; },0);
      p.state='jump'; p.z=210; p.vz=0; p.jAtk=0;
      const real=rotationReady; rotationReady=function(){ return true; };
      try{ p.in.pressed.atk=true; step(1); } finally { rotationReady=real; }
      let midAir=0;                       // 着地する前に与えたダメージ
      for(let f=0;f<240;f++){ hitStop=0; slowmo=0;
        list.forEach(function(e){ e.x=e._fx; e.vx=0; e.state='walk'; });
        if(p.z>4) midAir=hp0-list.reduce(function(a2,e){ return a2+e.hp; },0);
        step(1); }
      return {dmg:hp0-list.reduce(function(a2,e){ return a2+e.hp; },0),
              hit:list.filter(function(e){ return e.hp<e.maxHp; }).length, midAir:midAir}; };
    // ヌコ：離れて散らばった敵も、星座で結んでまとめて焼く。
    // 印を打つ→線で結ぶ→締める、の三段が効いていること（何回damageが入ったかで見る）
    const spread=[-320,-210,-110,-30,60,150,250,340];
    const hits=function(k){ const real=damageEnemy; const n={};
      damageEnemy=function(e){ if(e) n[e.id]=(n[e.id]||0)+1; return real.apply(null, arguments); };
      let r; try{ r=ult(k, spread); } finally { damageEnemy=real; }
      const vals=Object.keys(n).map(function(q){ return n[q]; });
      return {r:r, most:vals.length? Math.max.apply(null,vals) : 0}; };
    const nuH=hits('nuko');
    if(nuH.most<4) throw new Error('ヌコの空中奥義が同じ敵へ '+nuH.most+' 回しか入らない（星座で繋いでいない）');
    const nu=nuH.r;
    if(nu.hit<6) throw new Error('ヌコの空中奥義が散らばった敵に '+nu.hit+'/8体 しか届かない');
    if(!(nu.dmg>500)) throw new Error('ヌコの空中奥義が弱い（'+Math.round(nu.dmg)+'）');
    if(!(nu.midAir>0)) throw new Error('ヌコの空中奥義が空中にいる間に何もしていない');
    // ガードワン：落ちている最中も鎖の錨で巻き込み、着地で地面を割る
    const g8=ult('guard8', spread);
    if(g8.hit<6) throw new Error('ガードワンの空中奥義が '+g8.hit+'/8体 にしか届かない');
    if(!(g8.dmg>500)) throw new Error('ガードワンの空中奥義が弱い（'+Math.round(g8.dmg)+'）');
    if(!(g8.midAir>0)) throw new Error('ガードワンの空中奥義が、落ちている間は当てる手段が無い（着地頼み）');
    // 他の主役と比べて極端に劣らないこと
    const others=['inu','wanden','mack'].map(function(k){ return ult(k, spread).dmg; });
    const base=Math.max.apply(null, others);
    if(nu.dmg < base*0.35) throw new Error('ヌコの空中奥義だけ弱すぎる（'+Math.round(nu.dmg)+' / 他 '+Math.round(base)+'）');
    if(g8.dmg < base*0.35) throw new Error('ガードワンの空中奥義だけ弱すぎる（'+Math.round(g8.dmg)+' / 他 '+Math.round(base)+'）');
    console.log('作り直した空中奥義 OK (ヌコ '+Math.round(nu.dmg)+'/'+nu.hit+'体・空中で'+Math.round(nu.midAir)
      +'／ガードワン '+Math.round(g8.dmg)+'/'+g8.hit+'体・空中で'+Math.round(g8.midAir)+')'); }

  // ===== 16) 空中でもう一度だけ跳べる（二段ジャンプ） =====
  { const p=setup('inu');
    p.in.pressed.jump=true; step(1);
    if(p.state!=='jump') throw new Error('跳べていない');
    // 一段目の頂点まで待つ
    let apex1=p.z;
    for(let f=0;f<40;f++){ step(1); if(p.z>apex1) apex1=p.z; if(p.vz<=0) break; }
    const zAt=p.z;
    // 落ち始めてから二段目
    for(let f=0;f<10;f++) step(1);
    const zBefore=p.z;
    p.in.pressed.jump=true; step(1);
    if(!(p.vz>0)) throw new Error('二段ジャンプで上を向かない（vz='+(p.vz||0).toFixed(1)+'）');
    let apex2=p.z;
    for(let f=0;f<40;f++){ step(1); if(p.z>apex2) apex2=p.z; if(p.vz<=0) break; }
    if(!(apex2>zBefore+80)) throw new Error('二段ジャンプで '+Math.round(apex2-zBefore)+'px しか上がらない');
    if(!(apex2>apex1)) throw new Error('二段ジャンプで一段目の頂点を越えられない（'+Math.round(apex1)+'→'+Math.round(apex2)+'）');
    // 三段目は無い
    const z3=p.z; p.in.pressed.jump=true; step(1);
    if(p.vz>0.5) throw new Error('三段目が跳べてしまう');
    // 着地すると回数が戻る。地上から跳び直さず、宙に投げ出された場合でも戻ること
    for(let f=0;f<200 && p.z>0; f++) step(1);
    for(let f=0;f<20 && p.state!=='idle'; f++) step(1);
    if((p.djUsed|0)) throw new Error('着地しても二段ジャンプの回数が戻らない');
    p.state='jump'; p.z=120; p.vz=0; p.jAtk=0;      // 縁から踏み外した想定
    p.in.pressed.jump=true; step(1);
    if(!(p.vz>0)) throw new Error('落下中に二段ジャンプが出せない（着地で戻っていない）');
    console.log('二段ジャンプ OK (一段目 '+Math.round(apex1)+'px → 二段目 '+Math.round(apex2)+'px・空中では一度きり・着地で復活)'); }

  // ===== 17) 二段ジャンプは空中攻撃を割り込んで出せる／回避中は出せない =====
  { const p=setup('inu');
    p.in.pressed.jump=true; step(1);
    for(let f=0;f<8;f++) step(1);
    p.in.pressed.atk=true; step(1);
    if(!((p.jRave|0)>0)) throw new Error('空中攻撃が出ていない（測れていない）');
    p.in.pressed.jump=true; step(1);
    if((p.jRave|0)!==0 || p.jAtk>0) throw new Error('二段ジャンプで空中攻撃を打ち切れない');
    if(!(p.vz>0)) throw new Error('攻撃中は二段ジャンプが出せない');
    // 回避を出している最中は割り込めない
    const q=setup('inu');
    q.in.pressed.jump=true; step(1);
    for(let f=0;f<8;f++) step(1);
    q.in.K.right=true; q.in.pressed.grd=true; step(1);
    if(!((q.adT|0)>0)) throw new Error('空中回避が出ていない（測れていない）');
    q.in.pressed.jump=true; step(1);
    if(q.djUsed) throw new Error('空中回避の最中に二段ジャンプが割り込める');
    q.in.K.right=false;
    // 着地したフレームの入力は通常の跳躍が受け取る。二段目が横取りすると、
    // 地面から跳んだつもりが空中の一回を消費して、そのあと跳べなくなる
    { const r=setup('inu');
      r.state='jump'; r.z=0; r.vz=-6; r.jAtk=0; r.djUsed=false;
      r.in.pressed.jump=true; step(1);
      if(r.djUsed) throw new Error('接地しているのに二段ジャンプが入力を横取りする');
      // そのまま着地→跳躍で、空中の一回はまだ残っている
      for(let f=0;f<20 && r.state!=='idle' && r.z>0; f++) step(1);
      if(r.djUsed) throw new Error('地上へ降りる間に二段ジャンプが消費されている'); }
    console.log('二段ジャンプの割り込み OK (空中攻撃はキャンセルできる／回避中は割り込めない)'); }

  // ===== 18) メテオ技：宙で止まってから落ち、敵を地面へ叩きつけて跳ね返す =====
  { ['guard8'].forEach(function(k){
      const id=airSpecialFor({kind:k},'dp'), def=ATK[id];
      if(!def.airMeteor) throw new Error(k+' の空中昇竜がメテオ技になっていない');
      const p=setup(k);
      p.state='jump'; p.z=230; p.vz=0; p.jAtk=0;
      enemies.length=0;
      const list=[];
      for(let j=0;j<4;j++){ spawnEnemy('wolf', p.x-60+j*44, p.y); const e=enemies[enemies.length-1];
        e.hp=e.maxHp=99999; e.poise=99999; e.thinkCd=99999; e._fx=e.x; list.push(e); }
      const hp0=list.reduce(function(a2,e){ return a2+e.hp; },0);
      const rd=dpReady; dpReady=function(){ return true; };
      try{ p.in.pressed.atk=true; step(1); } finally { dpReady=rd; }
      if(!p.atk || p.atk.type!==id) throw new Error(k+' のメテオ技が出ない');
      // 構えの間は落ちない
      const z0=p.z;
      for(let f=0;f<(def.airHover|0)-1;f++) step(1);
      if(!(p.z > z0-30)) throw new Error(k+' が構えの間に落ちている（'+Math.round(z0)+'→'+Math.round(p.z)+'）');
      // そのあと落ちて着弾する
      let hi=0, bounced=0;
      for(let f=0;f<160;f++){ hitStop=0; slowmo=0;
        list.forEach(function(e){ e.x=e._fx; e.vx=0; });
        step(1);
        list.forEach(function(e){ if((e.vz||0)>2 && e.z>2) bounced++; }); }
      const dmg=hp0-list.reduce(function(a2,e){ return a2+e.hp; },0);
      if(!(dmg>0)) throw new Error(k+' のメテオ技が当たらない');
      if(!(bounced>0)) throw new Error(k+' のメテオ技で敵が跳ね返らない');
      if(p.z>4) throw new Error(k+' のメテオ技が着地しない（z='+Math.round(p.z)+'）'); });
    console.log('メテオ技 OK (ガードワン：構えの間は滞空→落下→着弾で地面バウンド)'); }

  // ===== 19) マックの空中3枠：斜め下マグナム／前方ガトリング／全周掃射 =====
  { const shots=function(sl, gate){
      const p=setup('mack'); p.level=1;
      p.state='jump'; p.z=200; p.vz=0; p.jAtk=0;
      projectiles.length=0; enemies.length=0;
      const real=global[gate]; global[gate]=function(){ return true; };
      try{ p.in.pressed.atk=true; step(1); } finally { global[gate]=real; }
      if(!p.atk || p.atk.type!==airSpecialFor(p,sl)) throw new Error('mack/'+sl+' が出ない');
      // 弾は生きているうちに値が変わる（zFloor で vzz が0に丸められる）。
      // 参照を持ち回さず、見つけた瞬間の値を控える
      const seen=[], snap=[]; let n=0;
      for(let f=0;f<90;f++){ hitStop=0; slowmo=0; step(1);
        projectiles.forEach(function(pr){ if(pr.owner!=='player'||seen.indexOf(pr)>=0) return;
          seen.push(pr); snap.push({dmg:pr.dmg, vx:pr.vx, vzz:pr.vzz, pierce:pr.pierce}); n++; }); }
      return {n:n, list:snap}; };
    // 昇竜＝斜め下へ一発。重くて貫通する
    const mg=shots('dp','dpReady');
    if(mg.n!==1) throw new Error('マグナムが '+mg.n+' 発出ている（重い一発のはず）');
    if(!(mg.list[0].dmg>=40)) throw new Error('マグナムが '+mg.list[0].dmg+' ダメージしかない');
    if(!mg.list[0].pierce) throw new Error('マグナムが貫通しない');
    if(!(mg.list[0].vzz<0)) throw new Error('マグナムが斜め下へ飛ばない（vzz='+mg.list[0].vzz+'）');
    // 波動＝前方へ斉射
    const ga=shots('hadou','hadokenReady');
    if(!(ga.n>=12)) throw new Error('ガトリングの斉射が '+ga.n+' 発しかない');
    if(!ga.list.every(function(pr){ return Math.sign(pr.vx)===Math.sign(ga.list[0].vx); }))
      throw new Error('ガトリングが前方へ揃っていない');
    if(!(ga.list[0].dmg < mg.list[0].dmg*0.4)) throw new Error('斉射の1発がマグナムと変わらない重さ');
    // ↓↑＝全周へ撒く
    const ar=shots('du','downUpReady');
    if(!(ar.n>=10)) throw new Error('全周掃射が '+ar.n+' 発しかない');
    const back=ar.list.filter(function(pr){ return Math.sign(pr.vx)!==Math.sign(ga.list[0].vx); }).length;
    if(!(back>=3)) throw new Error('全周掃射なのに後ろへ '+back+' 発しか飛ばない');
    console.log('マックの空中3枠 OK (マグナム1発'+mg.list[0].dmg+'ダメ貫通／斉射'+ga.n+'発／全周'+ar.n+'発・うち後方'+back+'発)'); }

  // ===== 20) シマの空中昇竜＝蹴り上がり。登る・巻き上げる・締めで二段ジャンプが戻る =====
  { const id=airSpecialFor({kind:'shima'},'dp'), def=ATK[id];
    if(def.airMeteor) throw new Error('シマの空中昇竜がまた落下技になっている');
    const p=setup('shima');
    p.state='jump'; p.z=90; p.vz=0; p.jAtk=0; p.djUsed=true;   // 二段ジャンプは使い切った状態から
    enemies.length=0;
    const list=[];
    for(let j=0;j<3;j++){ spawnEnemy('wolf', p.x-30+j*40, p.y); const e=enemies[enemies.length-1];
      e.hp=e.maxHp=99999; e.poise=99999; e.thinkCd=99999; e._fx=e.x; e.z=0; list.push(e); }
    const hp0=list.reduce(function(a2,e){ return a2+e.hp; },0);
    // 巻き上げの測定用に、蹴りの当たらない真後ろへ1体置く。
    // 前の敵で測ると「殴った衝撃で浮いた」ぶんと区別が付かない
    spawnEnemy('wolf', p.x-80, p.y);
    const back=enemies[enemies.length-1];
    back.hp=back.maxHp=99999; back.poise=99999; back.thinkCd=99999; back._fx=back.x; back.z=0;
    const bhp0=back.hp;
    const rd=dpReady; dpReady=function(){ return true; };
    try{ p.in.pressed.atk=true; step(1); } finally { dpReady=rd; }
    if(!p.atk || p.atk.type!==id) throw new Error('シマの空中昇竜が出ない');
    const z0=p.z;
    let top=p.z, lift=0, dj=true, fin=0;
    for(let f=0;f<70;f++){ hitStop=0; slowmo=0;
      list.forEach(function(e){ e.x=e._fx; e.vx=0; });
      back.x=back._fx; back.vx=0;
      step(1);
      if(p.z>top) top=p.z;
      // 締めの打ち上げ（32フレームあたり）は範囲が広く後ろにも届くので、その手前までで測る
      if(f<26 && back.z>lift) lift=back.z;
      // 締めは蹴りの当たらない後ろの敵まで巻き込んで打ち上げる。
      // 前の敵で測ると多段の吹き飛ばしと区別が付かない
      // 締めは32フレームあたり。落ちて地面で跳ねたぶんを拾わないよう、着地前の窓だけで測る
      if(f>=26 && f<=40 && (back.vz||0)<fin) fin=back.vz;   // 敵の vz は負が上
      // 二段ジャンプは「宙にいるうちに」戻ること。着地でも戻るので、着地後に見ると意味が無い
      if(!p.djUsed && p.z>20) dj=false; }
    const hits=Math.round(hp0-list.reduce(function(a2,e){ return a2+e.hp; },0));
    if(!(top-z0 >= 150)) throw new Error('蹴り上がらない（'+Math.round(top-z0)+'px しか上がらない）');
    if(!(hits>0)) throw new Error('蹴り上がりが当たらない');
    if(bhp0-back.hp > 0) throw new Error('後ろの敵にまで蹴りが当たっている（巻き上げの測定が成立しない）');
    if(!(lift >= 120)) throw new Error('蹴りの当たらない敵を巻き上げていない（'+Math.round(lift)+'px）');
    if(!(fin <= -9)) throw new Error('締めの一蹴りで周りを打ち上げていない（後ろの敵の勢いが '+(-fin).toFixed(1)+'）');
    if(dj) throw new Error('宙にいるうちに二段ジャンプが戻らない（着地するまで戻らない）');
    console.log('シマの空中昇竜 OK ('+def.name+'・'+Math.round(top-z0)+'px 上昇／敵を '+Math.round(lift)+'px 巻き上げ／締めの打ち上げ '+(-fin).toFixed(1)+'／二段ジャンプ復活)'); }

  // ===== 21) シマの空中↓↑＝三角跳び。縦の向きが何度も変わりながら前へ抜ける =====
  { const id=airSpecialFor({kind:'shima'},'du'), def=ATK[id];
    const p=setup('shima');
    p.state='jump'; p.z=140; p.vz=0; p.jAtk=0;
    enemies.length=0;
    const list=[];
    for(let j=0;j<4;j++){ spawnEnemy('wolf', p.x+50+j*60, p.y); const e=enemies[enemies.length-1];
      e.hp=e.maxHp=99999; e.poise=99999; e.thinkCd=99999; e._fx=e.x; e.z=0; list.push(e); }
    const hp0=list.reduce(function(a2,e){ return a2+e.hp; },0);
    const x0=p.x;
    const rd=downUpReady; downUpReady=function(){ return true; };
    try{ p.in.pressed.atk=true; step(1); } finally { downUpReady=rd; }
    if(!p.atk || p.atk.type!==id) throw new Error('シマの空中↓↑が出ない');
    // 実際の高さの上下を数える（vz ではなく z の増減で見る＝実装の変数に寄りかからない）
    let kicks=0, up=null, zp=p.z, far=p.x, dropped=0, hi=p.z;
    for(let f=0;f<80 && p.atk; f++){ hitStop=0; slowmo=0;
      list.forEach(function(e){ e.x=e._fx; e.vx=0; });
      step(1);
      const d=p.z-zp; zp=p.z;
      if(Math.abs(d)>0.4){ const u=(d>0);
        if(up===false && u) kicks++;      // 落ちている途中から上がり直した＝蹴り直し
        if(u && p.z>hi) hi=p.z;
        if(!u) dropped=Math.max(dropped, hi-p.z);
        up=u; }
      if(p.x>far) far=p.x; }
    const hits=Math.round(hp0-list.reduce(function(a2,e){ return a2+e.hp; },0));
    if(!(kicks>=2)) throw new Error('蹴り直しが '+kicks+' 回しかない（三角跳びなら2回以上）');
    if(!(dropped>=40)) throw new Error('間に落ちる区間が '+Math.round(dropped)+'px しかない（上→下→上になっていない）');
    if(!(far-x0 >= 120)) throw new Error('前へ '+Math.round(far-x0)+'px しか進まない');
    if(!(hits>0)) throw new Error('三角跳びが当たらない');
    console.log('シマの空中↓↑ OK ('+def.name+'・蹴り直し '+kicks+'回／間に '+Math.round(dropped)+'px 落ちる／前へ '+Math.round(far-x0)+'px／'+hits+'ダメージ)'); }

  // ===== 22) シマの空中奥義＝引きずり上げてまとめて殴り、最後に地面へ叩き落とす =====
  { const id=AIR_ULT.shima, def=ATK[id];
    const p=setup('shima'); p.dimMax=9; p.dim=9;
    p.state='jump'; p.z=210; p.vz=0; p.jAtk=0;
    enemies.length=0;
    const list=[];
    [-250, 120, 240].forEach(function(dx){ spawnEnemy('wolf', p.x+dx, p.y);
      const e=enemies[enemies.length-1];
      e.hp=e.maxHp=99999; e.poise=99999; e.thinkCd=99999; e.z=0; list.push(e); });
    const far0=Math.abs(list[0].x-p.x);
    const hp0=list.reduce(function(a2,e){ return a2+e.hp; },0);
    const real=rotationReady; rotationReady=function(){ return true; };
    try{ p.in.pressed.atk=true; step(1); } finally { rotationReady=real; }
    if(!p.atk || p.atk.type!==id) throw new Error('シマの空中奥義が出ない');
    let lifted=0, gathered=1e9, slammed=false, hiWhenSlam=0, midDmg=0, prevDmg=0;
    const total=function(){ return Math.round(hp0-list.reduce(function(a2,e){ return a2+e.hp; },0)); };
    const zPrev=list.map(function(){ return 0; });
    for(let f=0;f<150;f++){ hitStop=0; slowmo=0;
      list.forEach(function(e){ e.vx=0; e.state=(e.z>0?'air':'walk'); });
      step(1);
      // 吸い上げ：一番遠い敵が自分の高さの近くまで来ること
      const lo=Math.min.apply(null, list.map(function(e){ return e.z; }));
      if(lo>lifted) lifted=lo;
      const fx=Math.max.apply(null, list.map(function(e){ return Math.abs(e.x-p.x); }));
      if(fx<gathered) gathered=fx;
      // 叩き落とし：自分がまだ宙にいるうちに、全員が地面まで落とされること
      // 叩き落とした瞬間＝高い所にいた敵が1フレームで地面まで落ちたフレーム。
      // 「全員が地面にいる」で見ると、跳ね返って落ち切るまでの数十フレーム後になり、
      // 締めの一撃も宙での連打に数えてしまう
      if(!slammed && p.z>90 && list.some(function(e,ix){
        return zPrev[ix]>100 && e.z<40 && zPrev[ix]-e.z>100; })){   // 跳ね返るので「ちょうど0」では捉えられない
        slammed=true; hiWhenSlam=p.z; midDmg=prevDmg; }
      list.forEach(function(e,ix){ zPrev[ix]=e.z; });
      prevDmg=total(); }
    const dmg=Math.round(hp0-list.reduce(function(a2,e){ return a2+e.hp; },0));
    if(!(lifted >= 120)) throw new Error('宙へ引きずり上げていない（一番低い敵で '+Math.round(lifted)+'px）');
    if(!(gathered <= 120)) throw new Error('手元へ集めていない（一番遠い敵が '+Math.round(gathered)+'px・開始時 '+Math.round(far0)+'px）');
    if(!slammed) throw new Error('自分が宙にいるうちに地面へ叩き落としていない');
    if(!(dmg>0)) throw new Error('シマの空中奥義が削らない');
    if(!(midDmg>0)) throw new Error('宙で殴っていない（叩き落とすまでのダメージが 0）');
    if(def.airSlam || def.airMeteor) throw new Error('シマの空中奥義がまた自分から落ちる型に戻っている');
    console.log('シマの空中奥義 OK ('+def.name+'・'+Math.round(far0)+'px 先の敵を '+Math.round(gathered)
      +'px まで引き寄せ '+Math.round(lifted)+'px 持ち上げ／宙で'+midDmg+'／z='+Math.round(hiWhenSlam)+' から叩き落とし／計'+dmg+'ダメージ)'); }

  // ===== 23) 空中コマンド技どうしがキャンセルで繋がる（枠ごとに1回きり） =====
  { const chainOf=function(k){
      const p=setup(k); p.dimMax=9; p.dim=0;      // 奥義に化けないようストックは空に
      p.state='jump'; p.z=240; p.vz=0; p.jAtk=0; p.airChain={};
      enemies.length=0; projectiles.length=0;
      const seen=[];
      const fire=function(gate){
        const real=global[gate]; global[gate]=function(){ return true; };
        hitStop=0; slowmo=0;                       // 技の演出でフレームが飛ぶと入力が届かない
        try{ p.in.pressed.atk=true; step(1); } finally { global[gate]=real; }
        const t=p.atk && p.atk.type;
        if(t && seen.indexOf(t)<0) seen.push(t);
        return t; };
      const a1=fire('dpReady');
      p.z=Math.max(p.z,200);
      const a2=fire('hadokenReady');
      p.z=Math.max(p.z,200);
      const a3=fire('downUpReady');
      p.z=Math.max(p.z,200);
      const a4=fire('dpReady');                   // 同じ枠は二度目が出ない
      return {p:p, a:[a1,a2,a3,a4], seen:seen}; };
    KINDS.forEach(function(k){
      const r=chainOf(k);
      const want=[airSpecialFor({kind:k},'dp'), airSpecialFor({kind:k},'hadou'), airSpecialFor({kind:k},'du')];
      for(let i=0;i<3;i++) if(r.a[i]!==want[i])
        throw new Error(k+' の空中コマンドが繋がらない（'+(i+1)+'手目 '+r.a[i]+'／'+want[i]+' のはず）');
      if(r.a[3]===want[0] && r.a[2]!==want[0])
        throw new Error(k+' が同じ枠を二度出せてしまう（1回の跳躍で各枠1度きり）'); });
    // 着地すれば繋げる枠が戻る
    { const p=setup('inu'); p.dim=0;
      p.state='jump'; p.z=200; p.vz=0; p.jAtk=0; p.airChain={};
      const r1=dpReady; dpReady=function(){ return true; };
      hitStop=0; slowmo=0;
      try{ p.in.pressed.atk=true; step(1); } finally { dpReady=r1; }
      if(!p.atk) throw new Error('空中コマンドが出ない');
      for(let f=0;f<200 && p.z>0; f++){ hitStop=0; slowmo=0; step(1); }
      for(let f=0;f<30 && p.state!=='idle'; f++){ hitStop=0; slowmo=0; step(1); }
      if(p.airChain && p.airChain.dp) throw new Error('着地しても繋げる枠が戻らない'); }
    console.log('空中コマンドの連携 OK (7キャラとも 昇竜→波動→↓↑ をキャンセルで繋げる／同じ枠は1度きり／着地で戻る)'); }

  // ===== 24) 空中の技からでも奥義キャンセルで割り込める =====
  { KINDS.forEach(function(k){
      const p=setup(k); p.dimMax=9; p.dim=9;
      p.state='jump'; p.z=240; p.vz=0; p.jAtk=0; p.airChain={};
      enemies.length=0; projectiles.length=0;
      const r1=dpReady; dpReady=function(){ return true; };
      hitStop=0; slowmo=0;
      try{ p.in.pressed.atk=true; step(1); } finally { dpReady=r1; }
      if(!p.atk || p.atk.type!==airSpecialFor(p,'dp')) throw new Error(k+' の空中コマンドが出ない');
      const dim0=p.dim;
      // 技の最中に 攻撃＋掴み
      hitStop=0; slowmo=0;
      p.in.K.grab=true; p.in.pressed.atk=true; step(1); p.in.K.grab=false;
      if(!p.atk || p.atk.type!==AIR_ULT[k])
        throw new Error(k+' の空中技から奥義へ割り込めない（'+(p.atk&&p.atk.type)+'）');
      if(!(p.dim<dim0)) throw new Error(k+' の奥義キャンセルでストックを消費していない'); });
    console.log('空中の奥義キャンセル OK (7キャラとも コマンド技の最中に 攻撃＋掴み で空中奥義)'); }

  // ===== 25) ヌコの空中奥義は星印と星座の線が実際に出る =====
  { const p=setup('nuko'); p.dimMax=9; p.dim=9;
    const _pt=perfTier; perfTier=1;      // 本番と同じ粒子上限で見る
    p.state='jump'; p.z=220; p.vz=0; p.jAtk=0;
    enemies.length=0;
    const list=[];
    for(let j=0;j<5;j++){ spawnEnemy('wolf', p.x-160+j*80, p.y); const e=enemies[enemies.length-1];
      e.hp=e.maxHp=99999; e.poise=99999; e.thinkCd=99999; e._fx=e.x; list.push(e); }
    const real=rotationReady; rotationReady=function(){ return true; };
    try{ p.in.pressed.atk=true; step(1); } finally { rotationReady=real; }
    if(!p.atk || p.atk.type!==AIR_ULT.nuko) throw new Error('ヌコの空中奥義が出ない');
    let stars=0, lines=0, bothAt=0, lineLen=0, starF=0, lineF=0, markOnly=0, fin=0;
    for(let f=0;f<170;f++){ hitStop=0; slowmo=0;
      list.forEach(function(e){ e.x=e._fx; e.vx=0; });
      step(1);
      const st=particles.filter(function(q){ return q && q.k==='cstar'; });
      const ln=particles.filter(function(q){ return q && q.k==='cline'; });
      if(st.length>stars) stars=st.length;
      if(ln.length>lines) lines=ln.length;
      ln.forEach(function(q){ const d=Math.hypot(q.x2-q.x, q.y2-q.y); if(d>lineLen) lineLen=d; });
      if(st.length && ln.length) bothAt++;
      if(st.length) starF++;
      if(ln.length) lineF++;
      if(st.length && !ln.length) markOnly++;     // 印を打っている間＝まだ線が無い時間
      // 締めの線は白。粒子の上限を超えると、いちばん見せたい線から捨てられていた
      const wh=ln.filter(function(q){ return q.color==='#ffffff'; }).length;
      if(wh>fin) fin=wh; }
    if(!(stars>=3)) throw new Error('星印が同時に '+stars+' 個しか出ていない（印を付けた敵ぶん出ること）');
    if(!(lines>=2)) throw new Error('星座の線が '+lines+' 本しか出ていない');
    if(!(lineLen>=60)) throw new Error('星座の線が '+Math.round(lineLen)+'px しかない（点を撒いているだけ）');
    if(!(bothAt>=10)) throw new Error('星と線が同時に見えているのが '+bothAt+'F しかない');
    // 締めの一瞬だけ出しても「見えない」ままなので、出ている長さでも見る
    if(!(starF>=45)) throw new Error('星印が見えているのが '+starF+'F しかない（締めの一瞬だけ）');
    if(!(lineF>=45)) throw new Error('星座の線が見えているのが '+lineF+'F しかない（締めの一瞬だけ）');
    if(!(markOnly>=10)) throw new Error('印を打っている間に星が見えていない（'+markOnly+'F）');
    if(!(fin>=3)) throw new Error('締めの星座が '+fin+' 本しか残らない（粒子の上限で捨てられている）');
    perfTier=_pt;
    console.log('ヌコの空中奥義の見た目 OK (星印 同時'+stars+'個/'+starF+'F・線 同時'+lines+'本 最長'+Math.round(lineLen)
      +'px/'+lineF+'F・重なって見える'+bothAt+'F・印だけの間'+markOnly+'F・締めの星座'+fin+'本)'); }

  console.log('AERIAL TEST PASSED'); process.exit(0);
})().catch(e=>{ console.error('FAIL:', e.message, e.stack); process.exit(1); });
`;
code = code + "\n;" + DRIVER;
(0, eval)(code);

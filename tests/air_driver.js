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
    // 昇竜枠は共通の型（急降下＋着地の衝撃波）でよい
    KINDS.forEach(function(k){
      const dp=ATK[airSpecialFor({kind:k},'dp')];
      if(!dp.airDive) throw new Error(k+' の昇竜コマンドが急降下になっていない');
      if(!dp.airShock) throw new Error(k+' の急降下に着地の衝撃波が無い'); });
    // 波動枠と↓↑枠は、キャラごとに別の仕掛けであること。
    // 「どれも飛び道具を撃つだけ」「どれも回転するだけ」で揃ってしまうのを防ぐ
    ['hadou','du'].forEach(function(sl){
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
      if(spin.length>1) throw new Error('↓↑が '+spin.length+' キャラで回転技（回転で通すのは拳法家1人まで）: '+spin.join(',')); }
    // 波動枠が「前へ弾を撃つだけ」にならないこと（1キャラでも残っていれば指摘の再発）
    { const shot=KINDS.filter(function(k){ const d=ATK[airSpecialFor({kind:k},'hadou')]; return !!d.pshot && !d.airFx; });
      if(shot.length) throw new Error('波動が撃つだけのままのキャラがいる: '+shot.join(',')); }
    console.log('空中コマンド技 21種 OK (昇竜＝急降下／波動と↓↑はキャラごとに別の仕掛け)'); }

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
    // 急降下技は、着地したときに衝撃波を出す（当てられなくても着地に意味を持たせる）
    KINDS.forEach(function(k){
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

  console.log('AERIAL TEST PASSED'); process.exit(0);
})().catch(e=>{ console.error('FAIL:', e.message, e.stack); process.exit(1); });
`;
code = code + "\n;" + DRIVER;
(0, eval)(code);

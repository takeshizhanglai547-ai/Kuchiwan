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
    if(p.atk.type!==specialFor(p,'hadou')) throw new Error('別の技が出ている（'+p.atk.type+'）');
    // 技の最中も落ちる（宙に貼りつかない）
    const z0=p.z; let low=z0;
    for(let f=0;f<40;f++){ step(1); if(p.z<low) low=p.z; if(p.state!=='attack') break; }
    if(!(low<z0-10)) throw new Error('空中の技で高度が固まっている（'+Math.round(z0)+'→'+Math.round(low)+'）');
    console.log('空中コマンド技 OK ('+ATK[specialFor(p,'hadou')].name+'・'+Math.round(z0)+'→'+Math.round(low)+'px へ落下)'); }

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

  console.log('AERIAL TEST PASSED'); process.exit(0);
})().catch(e=>{ console.error('FAIL:', e.message, e.stack); process.exit(1); });
`;
code = code + "\n;" + DRIVER;
(0, eval)(code);

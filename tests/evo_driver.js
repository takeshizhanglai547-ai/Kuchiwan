const DRIVER = `
(async()=>{
  const step=(n)=>{ for(let i=0;i<n;i++){ if(global.rafCb){ const cb=global.rafCb; global.rafCb=null; cb(); } } };
  const KINDS=['inu','shima','nuko','guard8','watch','wanden'];

  // ===== 1) 段位の境界 =====
  // 段位は4段（基本／熟練／極／神域）。境界は EVO_LV の3つ
  if(EVO_LV.length!==3) throw new Error('EVO_LV は3つの境界を持つべき（今 '+EVO_LV.length+'）');
  [[1,0],[5,0],[6,1],[11,1],[12,2],[19,2],[20,3],[60,3]].forEach(function(c){
    const t=evoTier({level:c[0]});
    if(t!==c[1]) throw new Error('evoTier(Lv'+c[0]+') = '+t+', expected '+c[1]); });
  if(EVO_NAME.length!==4) throw new Error('段位名が '+EVO_NAME.length+' 個しかない');
  for(let i=1;i<4;i++) if(!EVO_NAME[i]) throw new Error(i+'段目の段位名が空');
  // 威力の倍率は段位ごとに単調増加する（同じ値が並んだら段位が効いていない）
  for(let i=1;i<4;i++){ const a=evoMul({level:i===1?1:EVO_LV[i-2]}), b=evoMul({level:EVO_LV[i-1]});
    if(!(b>a)) throw new Error(i+'段目で威力の倍率が上がらない（'+a+' → '+b+'）'); }
  if(!(evoMul({level:EVO_LV[2]})>=2)) throw new Error('最高段位でも威力が '+evoMul({level:EVO_LV[2]})+' 倍しかない');
  console.log('段位の境界 OK (4段: Lv1-'+(EVO_LV[0]-1)+'=0 / '+EVO_LV[0]+'-'+(EVO_LV[1]-1)+'=1 / '
    +EVO_LV[1]+'-'+(EVO_LV[2]-1)+'=2 / '+EVO_LV[2]+'+=3、倍率 '+[1,EVO_LV[0],EVO_LV[1],EVO_LV[2]].map(function(l){return evoMul({level:l});}).join('/')+')');

  // ===== 2) タメ攻撃が段位で別の技IDに差し替わる =====
  const seen={};
  KINDS.forEach(function(k){
    // 技IDは3種類（基本／剛／極）。神域は極と同じIDで、威力は段位の倍率で伸びる
    const ids=[1,EVO_LV[0],EVO_LV[1]].map(function(lv){ return chargeMoveFor({kind:k,level:lv,weapon:defaultWeaponFor(k)}); });
    if(chargeMoveFor({kind:k,level:EVO_LV[2],weapon:defaultWeaponFor(k)})!==ids[2])
      throw new Error(k+' の神域が極と別のIDになっている（存在しない技IDを引く）');
    ids.forEach(function(id){ if(!ATK[id]) throw new Error(k+' charge move has no ATK def: '+id); });
    if(k!=='nuko'){
      if(ids[0]===ids[1]||ids[1]===ids[2]) throw new Error(k+' charge did not evolve: '+ids.join(' -> '));
      // 上位ほど威力・間合いが上がっていること（定義値そのものを見る）
      for(var i=1;i<3;i++){ const a=ATK[ids[i-1]], b=ATK[ids[i]];
        if(!(b.dmg>a.dmg)) throw new Error(k+' charge dmg did not grow: '+ids[i-1]+'('+a.dmg+') -> '+ids[i]+'('+b.dmg+')');
        if(!(b.reach>a.reach)) throw new Error(k+' charge reach did not grow: '+ids.join(' -> ')); }
    } else { if(ids[0]!==ids[1]||ids[1]!==ids[2]) throw new Error('nuko charge should stay nbeam (段位は nukoCast 側)'); }
    seen[k]=ids; });
  console.log('タメ攻撃の進化 OK (' + seen.inu.join(' → ') + ' 等、威力と間合いが単調増加)');

  // ===== 3) 掴み技：実際に与えたダメージを測る（式を組み直すと自己証明になる）=====
  function throwDamageAt(lv){
    setupRoster('inu'); startGame(); state='play';
    const p=players[0]; player=p; p.level=lv; p.atkMul=1; p.x=camX+400; p.facing=1; p.hp=p.maxHp=99999;
    enemies.length=0; encounters.length=0; particles.length=0;
    spawnEnemy('wolf', p.x+40, LANE); const e=enemies[0];
    e.hp=e.maxHp=999999; e.thinkCd=999999; e.poise=999999; e.stun=999;
    p.state='grab'; p.grabEnemy=e; p.grabT=180; p.grabSub='hold'; p.grabAnim=0;
    e.state='grabbed'; e.grabbedBy=1; e.vx=0; e.vz=0; e.z=0;
    const before=e.hp;
    grabStraight(e);                       // 掴み＋攻撃＝正拳突き（直値22ダメージ）
    return before-e.hp; }
  const t0=throwDamageAt(1), t1=throwDamageAt(8), t2=throwDamageAt(16);
  if(!(t1>t0)) throw new Error('grab throw did not grow at Lv8: '+t0+' -> '+t1);
  if(!(t2>t1)) throw new Error('grab throw did not grow at Lv16: '+t1+' -> '+t2);
  console.log('掴み技の進化 OK (正拳突きの実ダメージ '+t0+' → '+t1+' → '+t2+')');

  // ===== 4) 空中攻撃：実際に与えたダメージを測る =====
  function airDamageAt(lv){
    setupRoster('inu'); startGame(); state='play';
    const p=players[0]; player=p; p.level=lv; p.atkMul=1; p.x=camX+400; p.facing=1; p.hp=p.maxHp=99999;
    enemies.length=0; encounters.length=0; particles.length=0;
    spawnEnemy('wolf', p.x+60, LANE); const e=enemies[0];
    e.hp=e.maxHp=999999; e.thinkCd=999999; e.poise=999999;
    p.state='jump'; p.z=60; p.vz=0; p.jAtk=13; p.jHit=new Set();
    p.jKabuto=false; p.jDown=false; p.jDrop=false; p.jHammer=false; p.jHyaku=false;
    const before=e.hp;
    jumpAttackHit();
    return before-e.hp; }
  const a0=airDamageAt(1), a1=airDamageAt(8), a2=airDamageAt(16);
  if(!(a1>a0)) throw new Error('aerial did not grow at Lv8: '+a0+' -> '+a1);
  if(!(a2>a1)) throw new Error('aerial did not grow at Lv16: '+a1+' -> '+a2);
  // 「極は返す刃で二段」は damageEnemy が実際に2回呼ばれることで裏を取る。
  // 合計ダメージの大小だけでは、倍率が上がっただけでも通ってしまう
  function airHitsAt(lv){
    setupRoster('inu'); startGame(); state='play';
    const p=players[0]; player=p; p.level=lv; p.atkMul=1; p.x=camX+400; p.facing=1; p.hp=p.maxHp=99999;
    enemies.length=0; encounters.length=0; particles.length=0;
    spawnEnemy('wolf', p.x+60, LANE); const e=enemies[0];
    e.hp=e.maxHp=999999; e.thinkCd=999999; e.poise=999999;
    p.state='jump'; p.z=60; p.vz=0; p.jAtk=13; p.jHit=new Set();
    p.jKabuto=false; p.jDown=false; p.jDrop=false; p.jHammer=false; p.jHyaku=false;
    let n=0; const od=damageEnemy; damageEnemy=function(){ n++; return od.apply(null,arguments); };
    try { jumpAttackHit(); } finally { damageEnemy=od; }
    return n; }
  const h1=airHitsAt(8), h2=airHitsAt(16);
  if(h1!==1) throw new Error('熟練の空中斬りは1段のはず: '+h1+'段');
  if(h2!==2) throw new Error('極の空中斬りが返す刃で二段になっていない: '+h2+'段');
  console.log('空中攻撃の進化 OK (実ダメージ '+a0+' → '+a1+' → '+a2+'、段数 熟練'+h1+'→極'+h2+')');

  // 空中技の間合いが段位で伸びる（定義値ではなく、実際に届いた距離で測る）
  {
    function airReach(lv){
      let hit=0;
      for(let gap=40; gap<200; gap+=2){
        setupRoster('inu'); startGame(); state='play';
        const p=players[0]; player=p; p.level=lv; p.atkMul=1; p.x=camX+380; p.facing=1; p.hp=p.maxHp=99999;
        enemies.length=0; encounters.length=0; particles.length=0;
        spawnEnemy('wolf', p.x+gap, LANE); const e=enemies[0];
        e.hp=e.maxHp=999999; e.thinkCd=999999; e.poise=999999;
        p.state='jump'; p.z=60; p.vz=0; p.jAtk=13; p.jHit=new Set();
        p.jKabuto=false; p.jDown=false; p.jDrop=false; p.jHammer=false; p.jHyaku=false;
        const b=e.hp; jumpAttackHit(); if(e.hp<b) hit=gap; }
      return hit; }
    const r0=airReach(1), r2=airReach(16);
    if(!(r2>r0)) throw new Error('空中技の間合いが段位で伸びていない: '+r0+'px → '+r2+'px');
    console.log('空中技の間合い OK (届いた最遠距離 '+r0+'px → '+r2+'px)');
  }

  // ===== 5) 奥義（同時押し）：本編と同じ経路で最後まで走らせて実測する =====
  //  技を丸ごと回すので、段数が増えたぶんも合計に乗る
  function sgRunAt(kind,lv){
    setupRoster(kind); startGame(); state='play';
    const p=players[0]; player=p; p.level=lv; p.atkMul=1; p.x=camX+400; p.facing=1;
    p.hp=p.maxHp=99999; p.sgCd=0;
    enemies.length=0; encounters.length=0; particles.length=0; projectiles.length=0;
    spawnEnemy('wolf', p.x+60, LANE); const e=enemies[0];
    e.hp=e.maxHp=999999; e.thinkCd=999999; e.poise=999999;
    const before=e.hp;
    let segs=0; const ob=sgBurst; sgBurst=function(){ segs++; return ob.apply(null,arguments); };
    try {
      if(!beginSGMove(p)) throw new Error(kind+' の奥義が発動しなかった');
      for(let i=0;i<200 && (p.state==='sgact'||p.state==='ichimonji'||p.state==='mugetsu'||projectiles.length);i++){
        hitStop=0; slowmo=0; step(1); }
    } finally { sgBurst=ob; }
    return {dmg:before-e.hp, segs:segs}; }
  { const r0=sgRunAt('shima',1), r1=sgRunAt('shima',EVO_LV[0]), r2=sgRunAt('shima',EVO_LV[1]), r3=sgRunAt('shima',EVO_LV[2]);
    if(!(r1.dmg>r0.dmg)) throw new Error('SG did not grow at Lv8: '+r0.dmg+' -> '+r1.dmg);
    if(!(r2.dmg>r1.dmg)) throw new Error('SG did not grow at Lv'+EVO_LV[1]+': '+r1.dmg+' -> '+r2.dmg);
    if(!(r3.dmg>r2.dmg)) throw new Error('SG did not grow at Lv'+EVO_LV[2]+': '+r2.dmg+' -> '+r3.dmg);
    // 段数そのものが増えること（威力倍率だけ上げても通らないようにする）
    if(!(r0.segs===1&&r1.segs===2&&r2.segs===3&&r3.segs===4))
      throw new Error('攻撃＋掴みの段数が 1/2/3/4 になっていない: '+[r0,r1,r2,r3].map(function(r){return r.segs;}).join('/'));
    console.log('攻撃＋掴みの進化 OK (虎魂の実ダメージ '+[r0,r1,r2,r3].map(function(r){return r.dmg;}).join(' → ')
      +'、段数 '+[r0,r1,r2,r3].map(function(r){return r.segs;}).join('→')+')');
    // 4キャラすべてが専用ステートに入り、段位で段数が増えること
    ['nuko','guard8','watch'].forEach(function(k){
      const a=sgRunAt(k,1), b=sgRunAt(k,EVO_LV[2]);
      if(a.segs!==1||b.segs!==4) throw new Error(k+' の攻撃＋掴みの段数が 1/4 になっていない: '+a.segs+'/'+b.segs);
      if(!(b.dmg>a.dmg)) throw new Error(k+' の攻撃＋掴みが段位で強くなっていない: '+a.dmg+' -> '+b.dmg); });
    console.log('攻撃＋掴みの段数 OK (ヌコ・ガードワン・ワッチも Lv1で1段 → Lv'+EVO_LV[2]+'で4段)');
    // ワンデンは一閃の本数、イッヌは斬る相手の数が段位で増える
    const w0=sgRunAt('wanden',1), w2=sgRunAt('wanden',EVO_LV[2]);
    if(!(w2.dmg>w0.dmg)) throw new Error('ワンデンの奥義が段位で強くなっていない: '+w0.dmg+' -> '+w2.dmg);
    function cutsOf(lv){ setupRoster('wanden'); startGame(); state='play';
      const q=players[0]; player=q; q.level=lv; q.atkMul=1; q.x=camX+400; q.facing=1; q.sgCd=0; q.hp=q.maxHp=99999;
      enemies.length=0; encounters.length=0; particles.length=0;
      spawnEnemy('wolf', q.x+120, LANE); enemies[0].hp=enemies[0].maxHp=999999; enemies[0].thinkCd=999999;
      beginSGMove(q);
      let mx=0; for(let i=0;i<160 && q.state==='ichimonji';i++){ hitStop=0; slowmo=0; step(1); mx=Math.max(mx,q.imN||0); }
      return mx; }
    const c1=cutsOf(1), c8=cutsOf(EVO_LV[0]), c16=cutsOf(EVO_LV[1]), c20=cutsOf(EVO_LV[2]);
    if(!(c1===1&&c8===2&&c16===3&&c20===4)) throw new Error('大居合の一閃が 1/2/3/4 本になっていない: '+[c1,c8,c16,c20].join('/'));
    function mgTargetsOf(lv){ setupRoster('inu'); startGame(); state='play';
      const q=players[0]; player=q; q.level=lv; q.atkMul=1; q.x=camX+300; q.sgCd=0; q.hp=q.maxHp=99999;
      enemies.length=0; encounters.length=0;
      // 対象上限より多く置く。ちょうど12体だと、上限が undefined になって
      // 「全員を斬る」に化けた場合と区別がつかない
      for(let i=0;i<18;i++){ spawnEnemy('wolf', q.x+60+i*26, LANE); }
      enemies.forEach(function(e){ e.hp=e.maxHp=999999; e.thinkCd=999999; });
      beginSGMove(q); return q.mgList.length; }
    const m1=mgTargetsOf(1), m8=mgTargetsOf(EVO_LV[0]), m16=mgTargetsOf(EVO_LV[1]), m20=mgTargetsOf(EVO_LV[2]);
    if(!(m1===5&&m8===7&&m16===9&&m20===12)) throw new Error('無月の対象が 5/7/9/12 体になっていない: '+[m1,m8,m16,m20].join('/'));
    console.log('ワンデン・イッヌの攻撃＋掴み OK (一閃 '+[c1,c8,c16,c20].join('→')+'本 / 無月 '+[m1,m8,m16,m20].join('→')+'体)'); }

  // ===== 6) ヌコのビームは本数が増える =====
  function beamLanesAt(lv){
    setupRoster('nuko'); startGame(); state='play';
    const p=players[0]; player=p; p.level=lv; p.atkMul=1; p.x=camX+300; p.facing=1;
    enemies.length=0; encounters.length=0; particles.length=0;
    spawnEnemy('wolf', p.x+120, LANE); const e=enemies[0]; e.hp=e.maxHp=999999; e.thinkCd=999999; e.poise=999999;
    const before=e.hp;
    nukoCast(p,6);
    const bolts=particles.filter(function(q){ return q.k==='bolt'; }).length;
    return {bolts:bolts, dmg:before-e.hp}; }
  const b0=beamLanesAt(1), b1=beamLanesAt(8), b2=beamLanesAt(16);
  if(b0.bolts!==1||b1.bolts!==2||b2.bolts!==3) throw new Error('beam lanes should be 1/2/3, got '+b0.bolts+'/'+b1.bolts+'/'+b2.bolts);
  if(!(b1.dmg>b0.dmg)||!(b2.dmg>b1.dmg)) throw new Error('beam damage did not grow: '+b0.dmg+'/'+b1.dmg+'/'+b2.dmg);
  console.log('ヌコのタメ攻撃 OK (雷条 1→2→3本、実ダメージ '+b0.dmg+' → '+b1.dmg+' → '+b2.dmg+')');

  // ===== 7) 昇格の告知が実際に出る =====
  // 以前は EVO_LV.indexOf(lv) を定数と比べるだけで、告知コードを丸ごと消しても緑だった。
  // gainXp を本当に走らせて popText に流れた文字列を見る
  {
    function sayOnLevelUp(from, xp){
      setupRoster('inu'); startGame(); state='play';
      const p=players[0]; player=p; p.atkMul=1; p.level=from; p.xp=0; p.xpNext=100;
      p.x=camX+400; p.hp=p.maxHp=99999;
      enemies.length=0; encounters.length=0; particles.length=0;
      const said=[]; const op=popText; popText=function(x,y,t){ said.push(''+t); };
      try { gainXp(xp); } finally { popText=op; }
      return {said:said, lv:p.level,
              grad:said.filter(function(t){ return t.indexOf('免許皆伝')>=0; }) }; }
    // gainXp の引数はスコア値で、XP はその 1/10。境界の一つ手前から1レベル上げる
    const said=[];
    for(let i=0;i<EVO_LV.length;i++){ const lv=EVO_LV[i];
      const r=sayOnLevelUp(lv-1, 1000);
      if(r.lv!==lv) throw new Error('Lv'+(lv-1)+' から Lv'+lv+' に上がっていない: '+r.lv);
      if(r.grad.length!==1) throw new Error('Lv'+lv+' で免許皆伝の告知が '+r.grad.length+' 回');
      if(r.grad[0].indexOf(EVO_NAME[i+1])<0)
        throw new Error('Lv'+lv+' の告知に段位名「'+EVO_NAME[i+1]+'」が無い: '+r.grad[0]);
      said.push(r.grad[0]); }
    // 段位が変わらないレベルアップでは出さない
    const b=sayOnLevelUp(EVO_LV[0], 1000);
    if(b.grad.length!==0) throw new Error('Lv'+(EVO_LV[0]+1)+' で告知が出ている: '+b.grad.join(' / '));
    const d=sayOnLevelUp(1, 40000000);   // 一気に飛ばしても取りこぼさない
    if(d.grad.length!==EVO_LV.length)
      throw new Error('Lv1 から大量XPで告知が '+d.grad.length+' 回（'+EVO_LV.length+'回であるべき）');
    console.log('昇格の告知 OK ('+said.join(' / ')+' ／段位据え置きのレベルでは無し／一気飛ばしでも'+EVO_LV.length+'回)');
  }

  // ===== 8) 段位で技IDが変わっても、タメ攻撃の開始演出と武器効果が消えないこと =====
  // （文字列一致 type==='charge' で判定していたため、charge2/charge3 になった瞬間に
  //   sfx.heavy・ring・spark とムーンライトソードの光波が全部消えていた）
  {
    const seen=[];
    const oheavy=sfx.heavy, oswing=sfx.swing, omoon=spawnMoonWave;
    function probe(kind,weapon,lv){
      setupRoster(kind); startGame(); state='play';
      const p=players[0]; player=p; p.level=lv; p.atkMul=1; p.x=camX+400; p.facing=1;
      p.weapon=weapon; p.hp=p.maxHp=99999;
      enemies.length=0; encounters.length=0; particles.length=0; projectiles.length=0;
      let heavy=0, moon=0;
      sfx.heavy=function(){ heavy++; }; spawnMoonWave=function(){ moon++; };
      const before=particles.length;
      beginAttack(chargeMoveFor(p));
      sfx.heavy=oheavy; spawnMoonWave=omoon;
      return {id:chargeMoveFor(p), heavy:heavy, moon:moon, fx:particles.length-before}; }
    ['inu','shima','guard8','wanden','watch'].forEach(function(k){
      [1,8,16].forEach(function(lv){
        const r=probe(k,defaultWeaponFor(k),lv);
        if(r.heavy!==1) throw new Error(k+' Lv'+lv+' ('+r.id+') の溜め解放音が鳴っていない: sfx.heavy='+r.heavy);
        if(r.fx<=0)     throw new Error(k+' Lv'+lv+' ('+r.id+') の溜め解放エフェクトが出ていない');
        seen.push(k+':'+r.id); }); });
    // ムーンライトソードの光波は全段位で出ること
    [1,8,16].forEach(function(lv){ const r=probe('inu','moon',lv);
      if(r.moon!==1) throw new Error('ムーンライトソード Lv'+lv+' ('+r.id+') の光波が出ていない'); });
    console.log('タメ攻撃の演出 OK (全段位で解放音・エフェクト・月光波が出る)');
  }

  // ===== 9) タメ攻撃の溜めは無敵を配らないこと（必殺技だけが無敵）=====
  {
    function invulnDuring(kind,mv,lv){
      setupRoster(kind); startGame(); state='play';
      const p=players[0]; player=p; p.level=lv; p.atkMul=1; p.x=camX+400; p.facing=1;
      p.hp=p.maxHp=99999; p.dim=3; p.invuln=0;
      enemies.length=0; encounters.length=0; particles.length=0;
      beginAttack(mv);
      let inv=0, n=0;
      while(p.state==='attack' && n<140){ if(p.invuln>0) inv++; n++; hitStop=0; slowmo=0; step(1); }
      return {inv:inv, n:n}; }
    const c1=invulnDuring('inu','charge',1);
    const c3=invulnDuring('inu','charge3',16);
    const h3=invulnDuring('guard8','chargeHammer3',16);
    if(c1.inv!==0) throw new Error('Lv1 のタメ斬りに無敵が付いている: '+c1.inv+'/'+c1.n);
    if(c3.inv!==0) throw new Error('極・断ち割りに無敵が付いている: '+c3.inv+'/'+c3.n+'F');
    if(h3.inv!==0) throw new Error('極・megaton割りに無敵が付いている: '+h3.inv+'/'+h3.n+'F');
    // 一方、必殺技の溜めには無敵が残っていること
    const s1=invulnDuring('inu','iswords2',16);
    if(!(s1.inv>0)) throw new Error('必殺技の溜めから無敵が消えている: '+s1.inv+'/'+s1.n+'F');
    console.log('溜めの無敵 OK (タメ攻撃 0F / 奥義 '+s1.inv+'F of '+s1.n+'F)');
  }

  // ===== 10) 掴み技のモーションと決まり手が段位で変わる =====
  // ダメージ倍率だけでなく、実際の回転量・跳躍の高さ・技の長さを測る
  {
    function throwRun(kind, key, lv){
      setupRoster(kind); startGame(); state='play';
      const p=players[0]; player=p; p.level=lv; p.atkMul=1; p.x=camX+400; p.facing=1;
      p.hp=p.maxHp=99999; p.defMul=1;
      enemies.length=0; encounters.length=0; particles.length=0; projectiles.length=0;
      spawnEnemy('wolf', p.x+36, LANE); const e=enemies[0];
      e.hp=e.maxHp=999999; e.thinkCd=999999; e.poise=999999; e.stun=999;
      p.state='grab'; p.grabEnemy=e; p.grabT=180; p.grabSub='hold'; p.grabAnim=0;
      e.state='grabbed'; e.grabbedBy=1; e.vx=0; e.vz=0; e.z=0;
      const before=e.hp;
      if(key==='gswing') beginGiantSwing(e);
      else if(key==='screw') beginScrew(e);
      else if(key==='dunk') beginDunk(e);
      else if(key==='wheel') beginWheel(e);
      else if(key==='tkick') beginTriangle(e);
      let n=0, zMax=0, rot=0;
      const st=p.state;
      while(n<300 && p.state===st){ n++; hitStop=0; slowmo=0; step(1);
        zMax=Math.max(zMax, p.z||0);
        rot=Math.max(rot, Math.abs(p.gswingRot||0), Math.abs(p.screwRot||0), Math.abs(p.wheelRot||0)); }
      return {frames:n, zMax:zMax, rot:rot, dmg:before-e.hp}; }

    const gs=[1,8,16].map(function(lv){ return throwRun('inu','gswing',lv); });
    if(!(gs[0].rot<gs[1].rot && gs[1].rot<gs[2].rot))
      throw new Error('ジャイアントスイングの回転量が段位で増えない: '+gs.map(function(r){return r.rot.toFixed(1);}).join('/'));
    if(!(gs[0].frames<gs[2].frames))
      throw new Error('ジャイアントスイングの長さが段位で伸びない: '+gs.map(function(r){return r.frames;}).join('/'));

    const sc=[1,8,16].map(function(lv){ return throwRun('inu','screw',lv); });
    if(!(sc[0].zMax<sc[1].zMax && sc[1].zMax<sc[2].zMax))
      throw new Error('スクリューの舞い上がりが段位で高くならない: '+sc.map(function(r){return Math.round(r.zMax);}).join('/'));

    const dk=[1,8,16].map(function(lv){ return throwRun('inu','dunk',lv); });
    if(!(dk[0].zMax<dk[1].zMax && dk[1].zMax<dk[2].zMax))
      throw new Error('ダンクの跳躍が段位で高くならない: '+dk.map(function(r){return Math.round(r.zMax);}).join('/'));
    if(!(dk[2].dmg>dk[0].dmg))
      throw new Error('ダンクの実ダメージが段位で伸びない: '+dk[0].dmg+' -> '+dk[2].dmg);

    console.log('掴み技のモーション OK (回転 '+gs.map(function(r){return r.rot.toFixed(1);}).join('→')
      +' / スクリューの高さ '+sc.map(function(r){return Math.round(r.zMax);}).join('→')
      +'px / ダンクの高さ '+dk.map(function(r){return Math.round(r.zMax);}).join('→')+'px)');

    // 決まり手：熟練から追い打ちが入り、極では周囲も巻き込む
    function finisherHits(lv){
      setupRoster('inu'); startGame(); state='play';
      const p=players[0]; player=p; p.level=lv; p.atkMul=1; p.x=camX+400; p.facing=1; p.hp=p.maxHp=99999;
      enemies.length=0; encounters.length=0; particles.length=0;
      spawnEnemy('wolf', p.x+36, LANE); const e=enemies[0];
      spawnEnemy('wolf', p.x-90, LANE); const o=enemies[1];   // 巻き込まれる側
      enemies.forEach(function(q){ q.hp=q.maxHp=999999; q.thinkCd=999999; q.poise=999999; q.stun=999; });
      p.state='grab'; p.grabEnemy=e; p.grabT=180; p.grabSub='hold'; p.grabAnim=0;
      e.state='grabbed'; e.grabbedBy=1; e.z=0;
      const b1=e.hp, b2=o.hp;
      grabStraight(e);
      return {main:b1-e.hp, side:b2-o.hp}; }
    const f0=finisherHits(1), f1=finisherHits(8), f2=finisherHits(16);
    if(!(f1.main>f0.main)) throw new Error('熟練で決まり手の追い打ちが入っていない: '+f0.main+' -> '+f1.main);
    if(!(f0.side===0)) throw new Error('Lv1で周囲を巻き込んでいる: '+f0.side);
    if(!(f2.side>0))   throw new Error('極で周囲を巻き込んでいない: '+f2.side);
    console.log('投げの決まり手 OK (本命 '+f0.main+'→'+f1.main+'→'+f2.main+' / 巻き込み '+f0.side+'→'+f1.side+'→'+f2.side+')');
  }

  // ===== 11) タメ攻撃は段位でモーションそのものが変わる =====
  // 技IDが差し替わるだけでは「進化した」と分からない。描画が使う姿勢を実測する
  {
    function chargeMotion(lv){
      setupRoster('inu'); startGame(); state='play';
      const p=players[0]; player=p; p.level=lv; p.atkMul=1; p.x=camX+400; p.facing=1;
      p.hp=p.maxHp=99999; p.poseB=null;
      enemies.length=0; encounters.length=0; particles.length=0;
      const mv=chargeMoveFor(p);
      beginAttack(mv);
      let leanMin=1e9, leanMax=-1e9, extMax=0, sqMin=1e9, n=0;
      while(p.state==='attack' && n<200){ n++; hitStop=0; slowmo=0; step(1);
        if(!p.poseB) continue;
        leanMin=Math.min(leanMin,p.poseB.lean); leanMax=Math.max(leanMax,p.poseB.lean);
        extMax=Math.max(extMax,p.poseB.swExt); sqMin=Math.min(sqMin,p.poseB.sqX); }
      return {id:mv, lean:leanMax-leanMin, ext:extMax, sq:1-sqMin}; }
    const m=[1,8,16].map(chargeMotion);
    if(m[0].id===m[1].id||m[1].id===m[2].id) throw new Error('タメ攻撃の技IDが段位で変わっていない');
    if(!(m[0].lean<m[1].lean && m[1].lean<m[2].lean))
      throw new Error('タメ攻撃の上体の振れ幅が段位で増えない: '+m.map(function(r){return r.lean.toFixed(2);}).join('/'));
    if(!(m[0].ext<m[1].ext && m[1].ext<m[2].ext))
      throw new Error('タメ攻撃の振り抜きの伸びが段位で増えない: '+m.map(function(r){return r.ext.toFixed(1);}).join('/'));
    if(!(m[0].sq<m[2].sq))
      throw new Error('タメ攻撃の踏ん張り（潰れ）が極で増えない: '+m[0].sq.toFixed(3)+' -> '+m[2].sq.toFixed(3));
    console.log('タメ攻撃のモーション OK ('+m.map(function(r){return r.id;}).join('→')
      +'、上体の振れ '+m.map(function(r){return r.lean.toFixed(2);}).join('→')
      +'rad、伸び '+m.map(function(r){return Math.round(r.ext);}).join('→')+')');
  }

  // ===== 12) 空中攻撃も段位でモーションが変わる =====
  // 以前は段位で伸びるのがダメージと間合いだけで、振りは全レベル共通だった
  {
    function airMotion(lv){
      setupRoster('inu'); startGame(); state='play';
      const p=players[0]; player=p; p.level=lv; p.atkMul=1; p.x=camX+400; p.facing=1;
      p.hp=p.maxHp=99999; p.poseB=null;
      enemies.length=0; encounters.length=0; particles.length=0;
      p.state='jump'; p.z=140; p.vz=0; p.jAtk=13; p.jHit=new Set();
      p.jKabuto=false; p.jDown=false; p.jDrop=false; p.jHammer=false; p.jHyaku=false;
      const sw=[]; let n=0;
      while(p.jAtk>0 && n<60){ n++; hitStop=0; slowmo=0; p.vz=0; p.z=140; step(1);
        if(p.poseB) sw.push(p.poseB.swAng); }
      let mn=1e9, mx=-1e9; sw.forEach(function(v){ mn=Math.min(mn,v); mx=Math.max(mx,v); });
      // 切り返しがあるか：最大値に達したあとで戻るか
      let peak=0; sw.forEach(function(v,i){ if(v===mx) peak=i; });
      const back = (peak < sw.length-2) && (sw[sw.length-1] < mx-0.10);
      return {range:mx-mn, back:back, n:sw.length}; }
    const A=[1,8,16].map(airMotion);
    if(!(A[0].range<A[1].range && A[1].range<A[2].range))
      throw new Error('空中斬りの振り幅が段位で増えない: '+A.map(function(r){return r.range.toFixed(2);}).join('/'));
    if(A[0].back) throw new Error('Lv1の空中斬りに切り返しがある（単純な一振りのはず）');
    if(!A[2].back) throw new Error('極の空中斬りに返す刃の切り返しが無い');
    console.log('空中技のモーション OK (振り幅 '+A.map(function(r){return r.range.toFixed(2);}).join('→')
      +'rad、極だけ返す刃で切り返す)');
  }

  // ===== 9) 神域（4段目）まで、全系統が実際に伸びる =====
  // 以前は段位が2段しか無く、コマンド技7枠には段位そのものが乗っていなかった。
  // 「4段階の進化」が名前だけになっていないか、実ダメージで確かめる
  { const hitAt=function(kind, id, lv){
      setupRoster(kind); startGame(); state='play';
      const p=players[0]; player=p; p.level=lv; p.atkMul=1; p.hp=p.maxHp=99999;
      p.state='idle'; p.z=0; p.atk=null; p.invuln=0;
      enemies.length=0; projectiles.length=0; hazards.length=0;
      // 踏み込む技（居合は move:9 で12フレーム前進する）は、近すぎると通り過ぎて当たらない。
      // 距離を散らして置き、合計の与ダメージで比べる
      [90,150,210].forEach(function(d){ spawnEnemy('wolf', p.x+d, p.y);
        const e=enemies[enemies.length-1]; e.hp=e.maxHp=999999; e.thinkCd=9999; });
      const hp0=enemies.reduce(function(a,e){ return a+e.hp; },0);
      beginAttack(id);
      for(let f=0;f<70;f++){ updatePlayer(p); updateProjectiles(); }
      return hp0-enemies.reduce(function(a,e){ return a+e.hp; },0); };
    // コマンド技（イッヌの前攻撃＝居合）を4段位で測る。技IDは Lv7 で一度だけ差し替わる
    const lvs=[1, EVO_LV[0], EVO_LV[1], EVO_LV[2]];
    const dmg=lvs.map(function(lv){ return hitAt('inu','iai',lv); });
    if(dmg[0]<=0) throw new Error('コマンド技が当たっていない（測れていない）');
    for(let i=1;i<4;i++) if(!(dmg[i]>dmg[i-1]))
      throw new Error('コマンド技が'+i+'段目で伸びていない（'+dmg.join(' → ')+'）');
    if(!(dmg[3]>=dmg[0]*1.9)) throw new Error('神域でも '+dmg[0]+'→'+dmg[3]+' しか伸びない');
    // 通常コンボには段位を乗せない（乗せると全体が二重に伸びる）
    const cmb=lvs.map(function(lv){ return hitAt('inu','c1',lv); });
    if(cmb[3]!==cmb[0]) throw new Error('通常コンボにも段位が乗っている（'+cmb.join(' → ')+'）');
    console.log('コマンド技の段位 OK (居合の実ダメージ '+dmg.join(' → ')+'／通常コンボは '+cmb[0]+' のまま)'); }

  // ===== 10) 奥義の消費は2で頭打ち（マックの地上奥義だけは段位ぶん重くなる） =====
  { const LVS=[1,EVO_LV[0],EVO_LV[1],EVO_LV[2]];
    const costs=LVS.map(function(lv){ return ultCost({kind:'inu',level:lv}); });
    // 育てるほど撃てなくなるのを避ける。上げても2まで
    if(!(costs[1]>costs[0])) throw new Error('段位が上がっても消費が変わらない（'+costs.join(' → ')+'）');
    for(let i=0;i<4;i++) if(costs[i]>2)
      throw new Error('奥義の消費が2を超えている（'+costs.join(' → ')+'）');
    if(costs[3]!==costs[1]) throw new Error('2で頭打ちになっていない（'+costs.join(' → ')+'）');
    // 空中奥義も同じ頭打ち。マックも空中は他と同じ
    ['inu','shima','nuko','guard8','watch','wanden','mack'].forEach(function(k){
      LVS.forEach(function(lv){
        const air=ultCost({kind:k,level:lv}, true);
        if(air>2) throw new Error(k+' の空中奥義の消費が '+air+'（2を超えている）'); });
      if(k==='mack') return;
      LVS.forEach(function(lv){
        const g=ultCost({kind:k,level:lv});
        if(g>2) throw new Error(k+' の地上奥義の消費が '+g+'（2を超えている）'); }); });
    // マックの地上奥義（絨毯爆撃）だけは重いままで、段位ぶん増える
    const mk=LVS.map(function(lv){ return ultCost({kind:'mack',level:lv}); });
    for(let i=1;i<4;i++) if(!(mk[i]>mk[i-1]))
      throw new Error('マックの地上奥義が段位で重くならない（'+mk.join(' → ')+'）');
    if(!(mk[0]>costs[0])) throw new Error('マックの地上奥義が他と同じ重さになっている（'+mk.join('/')+'）');
    // 昇格すると受け皿（dimMax）が増え、撃てなくならない
    setupRoster('inu'); startGame(); state='play';
    const p=players[0]; player=p; p.atkMul=1; p.level=EVO_LV[0]-1; p.xp=0; p.xpNext=100;
    p.x=camX+400; p.hp=p.maxHp=99999; enemies.length=0; encounters.length=0;
    const max0=p.dimMax;
    gainXp(1000);
    if(p.level!==EVO_LV[0]) throw new Error('昇格していない（Lv'+p.level+'）');
    if(!(p.dimMax>max0)) throw new Error('昇格しても奥義ストックの上限が増えない（'+max0+' → '+p.dimMax+'）');
    if(p.dimMax<ultCost(p)) throw new Error('上限 '+p.dimMax+' が必要数 '+ultCost(p)+' に届かず、奥義が撃てない');
    console.log('奥義の消費ストック OK (イッヌ '+costs.join(' → ')+'（2で頭打ち）／マックの地上 '+mk.join(' → ')
      +'／昇格で上限 '+max0+'→'+p.dimMax+')'); }

  // ===== 11) 奥義そのものの威力も段位で伸びる（7キャラ全部） =====
  { const ultDmg=function(kind, lv){
      setupRoster(kind); startGame(); state='play';
      const p=players[0]; player=p; p.level=lv; p.atkMul=1; p.x=camX+W*0.4; p.facing=1;
      p.hp=p.maxHp=99999; p.dim=p.dimMax=9; p.state='idle'; p.z=0; p.atk=null; p.invuln=0;
      enemies.length=0; encounters.length=0; projectiles.length=0; particles.length=0; hazards.length=0;
      // 隕石や絨毯爆撃は落ちる位置に乱数が入る。画面幅に散らして当たり外れの振れを小さくする
      for(let i=0;i<9;i++){ spawnEnemy('wolf', camX+80+i*((W-160)/8), LANE);
        const e=enemies[i]; e.hp=e.maxHp=9999999; e.thinkCd=999999; }
      // 配列そのものを合計すると、星KOで敵が取り除かれた瞬間に「HP全部ぶんの与ダメ」に化ける。
      // 実体を捕まえておいて、その HP だけを見る
      const list=enemies.slice();
      const hp0=list.reduce(function(a,e){ return a+e.hp; },0);
      const pin=list.map(function(e){ return e.x; });
      // 一回転コマンドの入力経路は状態依存なので、各キャラの入口を直に叩く
      if(kind==='shima') beginSeven();
      else if(kind==='guard8') beginGuardQuake();
      else if(kind==='watch') beginGatling(p);
      else if(kind==='wanden') beginAttack('dkaiden');
      else if(kind==='mack') beginMackRaid(p);
      else if(kind==='nuko') beginAttack('nmeteor');
      else beginAttack('dimension');
      // 的は動かさない。吹き飛んで判定の帯から出ると、威力ではなく
      // 「何発当たったか」を測ることになり、段位の伸びが見えなくなる
      for(let i=0;i<420;i++){ hitStop=0; slowmo=0; step(1);
        list.forEach(function(e,j){ e.x=pin[j]; e.vx=0; e.z=0; e.vz=0;
          if(e.state==='blastoff'){ e.state='walk'; e.bo=0; } }); }
      return hp0-list.reduce(function(a,e){ return a+e.hp; },0); };
    // 乱数の残りは平均で均す（同じ設定を3回まわす）
    const avg=function(k,lv){ let t=0; for(let i=0;i<3;i++) t+=ultDmg(k,lv); return t/3; };
    const kinds=['inu','shima','nuko','guard8','watch','wanden','mack'], rep=[];
    kinds.forEach(function(k){
      const lo=avg(k,1), hi=avg(k,EVO_LV[2]);
      if(!(lo>0)) throw new Error(k+' の奥義が当たっていない（測れていない）');
      if(!(hi>lo*1.4)) throw new Error(k+' の奥義が段位で伸びない（'+Math.round(lo)+' → '+Math.round(hi)+'）');
      rep.push(k+' '+Math.round(lo)+'→'+Math.round(hi)); });
    console.log('奥義の威力の段位 OK ('+rep.join(' / ')+')'); }

  // ===== 12) 段位が上がるほど演出が濃くなる =====
  // 威力だけ伸ばして演出を据え置くと「数字が増えただけ」になる。
  // 1ヒットぶんに出る粒と輪の数、神域の残像を実測する
  { const fxAt=function(lv){
      setupRoster('inu'); startGame(); state='play';
      const p=players[0]; player=p; p.level=lv; p.atkMul=1; p.x=camX+300; p.facing=1;
      p.hp=p.maxHp=99999; p.state='idle'; p.z=0; p.atk=null; p.invuln=0;
      enemies.length=0; encounters.length=0; particles.length=0;
      spawnEnemy('wolf', p.x+120, LANE); const e=enemies[0]; e.hp=e.maxHp=999999; e.thinkCd=999999;
      // 打撃のときに増える輪だけを数える。particles の総数だと、段位のオーラ（火の粉）で
      // 増えたのか打撃の演出で増えたのかが分からない
      // 「1ヒットあたり何枚の輪が出るか」で見る。総数だと、当たった回数の違いに
      // 演出の濃さが埋もれる（段位で技IDが変わると多段になることがある）
      let rings=0, hits=0; const oring=ring, odmg=damageEnemy;
      ring=function(){ rings++; return oring.apply(null,arguments); };
      damageEnemy=function(){ hits++; return odmg.apply(null,arguments); };
      let after=0;
      try{ beginAttack('iai');
        for(let f=0;f<60;f++){ hitStop=0; updatePlayer(p);
          after+=particles.filter(function(q){ return q.k==='evoAfter'; }).length? 1:0; }
      } finally { ring=oring; damageEnemy=odmg; }
      return {parts:particles.length, rings:rings, hits:hits,
              per:hits?rings/hits:0, after:after}; };
    const a=fxAt(1), b=fxAt(EVO_LV[1]), c=fxAt(EVO_LV[2]);
    if(!(a.hits>0&&b.hits>0&&c.hits>0)) throw new Error('打撃が当たっていない（測れていない）');
    // 1ヒットあたりの輪（実測）：基本1枚／極3枚／神域6枚。
    // 神域は超閃光がさらに輪を重ねるぶん倍になる。段位ごとの上乗せを1つでも外すと
    // 3枚→2枚、6枚→5枚に落ちるので、直値で押さえる
    if(Math.abs(a.per-1)>0.01) throw new Error('基本段位の1ヒットあたりの輪が '+a.per.toFixed(2)+'枚（1枚のはず）');
    if(Math.abs(b.per-3)>0.01) throw new Error('極の1ヒットあたりの輪が '+b.per.toFixed(2)+'枚（3枚のはず）');
    if(Math.abs(c.per-6)>0.01) throw new Error('神域の1ヒットあたりの輪が '+c.per.toFixed(2)+'枚（6枚のはず）');
    if(!(c.parts>a.parts)) throw new Error('神域でも演出の粒が増えない（'+a.parts+' → '+c.parts+'）');
    if(a.after>0) throw new Error('基本段位なのに残像が出ている');
    if(!(c.after>0)) throw new Error('神域なのに残像が出ない');
    console.log('段位の演出 OK (1ヒットあたりの輪 '+a.per.toFixed(1)+' → '+b.per.toFixed(1)+' → '+c.per.toFixed(1)
      +'枚／粒 '+a.parts+' → '+c.parts+'／残像は神域だけ '+c.after+'F)'); }

  console.log('EVOLUTION TEST PASSED'); process.exit(0);
})().catch(e=>{ console.error('FAIL:', e.message, e.stack); process.exit(1); });
`;
code = code + "\n;" + DRIVER;
(0, eval)(code);

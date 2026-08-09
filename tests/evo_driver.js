const DRIVER = `
(async()=>{
  const step=(n)=>{ for(let i=0;i<n;i++){ if(global.rafCb){ const cb=global.rafCb; global.rafCb=null; cb(); } } };
  const KINDS=['inu','shima','nuko','guard8','watch','wanden'];

  // ===== 1) 段位の境界 =====
  if(EVO_LV.length!==2) throw new Error('EVO_LV should have 2 thresholds');
  [[1,0],[7,0],[8,1],[15,1],[16,2],[30,2]].forEach(function(c){
    const t=evoTier({level:c[0]});
    if(t!==c[1]) throw new Error('evoTier(Lv'+c[0]+') = '+t+', expected '+c[1]); });
  console.log('段位の境界 OK (Lv1-7=0 / Lv8-15=1 / Lv16+=2)');

  // ===== 2) タメ攻撃が段位で別の技IDに差し替わる =====
  const seen={};
  KINDS.forEach(function(k){
    const ids=[1,8,16].map(function(lv){ return chargeMoveFor({kind:k,level:lv,weapon:defaultWeaponFor(k)}); });
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
  { const r0=sgRunAt('shima',1), r1=sgRunAt('shima',8), r2=sgRunAt('shima',16);
    if(!(r1.dmg>r0.dmg)) throw new Error('SG did not grow at Lv8: '+r0.dmg+' -> '+r1.dmg);
    if(!(r2.dmg>r1.dmg)) throw new Error('SG did not grow at Lv16: '+r1.dmg+' -> '+r2.dmg);
    // 段数そのものが増えること（威力倍率だけ上げても通らないようにする）
    if(!(r0.segs===1&&r1.segs===2&&r2.segs===3))
      throw new Error('奥義の段数が 1/2/3 になっていない: '+r0.segs+'/'+r1.segs+'/'+r2.segs);
    console.log('奥義の進化 OK (虎魂の実ダメージ '+r0.dmg+' → '+r1.dmg+' → '+r2.dmg+'、段数 '+r0.segs+'→'+r1.segs+'→'+r2.segs+')');
    // 4キャラすべてが専用ステートに入り、段位で段数が増えること
    ['nuko','guard8','watch'].forEach(function(k){
      const a=sgRunAt(k,1), b=sgRunAt(k,16);
      if(a.segs!==1||b.segs!==3) throw new Error(k+' の奥義の段数が 1/3 になっていない: '+a.segs+'/'+b.segs);
      if(!(b.dmg>a.dmg)) throw new Error(k+' の奥義が段位で強くなっていない: '+a.dmg+' -> '+b.dmg); });
    console.log('奥義の段数 OK (ヌコ・ガードワン・ワッチも Lv1で1段 → Lv16で3段)'); }

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
    // gainXp の引数はスコア値で、XP はその 1/10。Lv7 の xpNext は 100 なので 1000 必要
    const a=sayOnLevelUp(7, 1000);      // Lv7 -> Lv8（段位1）
    if(a.lv!==8) throw new Error('Lv7 から Lv8 に上がっていない: '+a.lv);
    if(a.grad.length!==1) throw new Error('Lv8 で免許皆伝の告知が '+a.grad.length+' 回');
    if(a.grad[0].indexOf(EVO_NAME[1])<0) throw new Error('Lv8 の告知に段位名「'+EVO_NAME[1]+'」が無い: '+a.grad[0]);
    const b=sayOnLevelUp(8, 1000);        // Lv8 -> Lv9（段位は変わらない）
    if(b.lv!==9) throw new Error('Lv8 から Lv9 に上がっていない: '+b.lv);
    if(b.grad.length!==0) throw new Error('Lv9 で告知が出ている: '+b.grad.join(' / '));
    const c=sayOnLevelUp(15, 1000);       // Lv15 -> Lv16（段位2）
    if(c.grad.length!==1) throw new Error('Lv16 で免許皆伝の告知が '+c.grad.length+' 回');
    if(c.grad[0].indexOf(EVO_NAME[2])<0) throw new Error('Lv16 の告知に段位名「'+EVO_NAME[2]+'」が無い: '+c.grad[0]);
    const d=sayOnLevelUp(1, 40000000);   // 一気に飛ばしても両方の告知を取りこぼさない
    if(d.grad.length!==2) throw new Error('Lv1 から大量XPで告知が '+d.grad.length+' 回（2回であるべき）');
    console.log('昇格の告知 OK (Lv8『'+a.grad[0]+'』/ Lv9 は無し / Lv16『'+c.grad[0]+'』/ 一気飛ばしでも2回)');
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

  console.log('EVOLUTION TEST PASSED'); process.exit(0);
})().catch(e=>{ console.error('FAIL:', e.message, e.stack); process.exit(1); });
`;
code = code + "\n;" + DRIVER;
(0, eval)(code);

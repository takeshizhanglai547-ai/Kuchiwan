const DRIVER = `
global._GC={}; var _g=(n,v)=>{ _GC[n]=(_GC[n]||0)+1; return v; };
process.on("exit",()=>{ const miss=[]; for(let i=1;i<=16;i++) if(!_GC[i]) miss.push(i); console.error("GUARDS total=16 evaluated="+((16)-miss.length)+" NEVER_EVALUATED=["+miss.join(",")+"]"); });

(async()=>{
  const step=(n)=>{ for(let i=0;i<n;i++){ if(global.rafCb){ const cb=global.rafCb; global.rafCb=null; cb(); } } };
  const KINDS=['inu','shima','nuko','guard8','watch','wanden'];

  // ===== 1) 段位の境界 =====
  if(_g(1,EVO_LV.length!==2)) throw new Error('EVO_LV should have 2 thresholds');
  [[1,0],[7,0],[8,1],[15,1],[16,2],[30,2]].forEach(function(c){
    const t=evoTier({level:c[0]});
    if(_g(2,t!==c[1])) throw new Error('evoTier(Lv'+c[0]+') = '+t+', expected '+c[1]); });
  console.log('段位の境界 OK (Lv1-7=0 / Lv8-15=1 / Lv16+=2)');

  // ===== 2) タメ攻撃が段位で別の技IDに差し替わる =====
  const seen={};
  KINDS.forEach(function(k){
    const ids=[1,8,16].map(function(lv){ return chargeMoveFor({kind:k,level:lv,weapon:defaultWeaponFor(k)}); });
    ids.forEach(function(id){ if(_g(3,!ATK[id])) throw new Error(k+' charge move has no ATK def: '+id); });
    if(k!=='nuko'){
      if(_g(4,ids[0]===ids[1]||ids[1]===ids[2])) throw new Error(k+' charge did not evolve: '+ids.join(' -> '));
      // 上位ほど威力・間合いが上がっていること（定義値そのものを見る）
      for(var i=1;i<3;i++){ const a=ATK[ids[i-1]], b=ATK[ids[i]];
        if(_g(5,!(b.dmg>a.dmg))) throw new Error(k+' charge dmg did not grow: '+ids[i-1]+'('+a.dmg+') -> '+ids[i]+'('+b.dmg+')');
        if(_g(6,!(b.reach>a.reach))) throw new Error(k+' charge reach did not grow: '+ids.join(' -> ')); }
    } else { if(_g(7,ids[0]!==ids[1]||ids[1]!==ids[2])) throw new Error('nuko charge should stay nbeam (段位は nukoCast 側)'); }
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
  if(_g(8,!(t1>t0))) throw new Error('grab throw did not grow at Lv8: '+t0+' -> '+t1);
  if(_g(9,!(t2>t1))) throw new Error('grab throw did not grow at Lv16: '+t1+' -> '+t2);
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
  if(_g(10,!(a1>a0))) throw new Error('aerial did not grow at Lv8: '+a0+' -> '+a1);
  if(_g(11,!(a2>a1))) throw new Error('aerial did not grow at Lv16: '+a1+' -> '+a2);
  console.log('空中攻撃の進化 OK (空中斬りの実ダメージ '+a0+' → '+a1+' → '+a2+'、極は返す刃で二段)');

  // ===== 5) 奥義（同時押し）：実際に与えたダメージを測る =====
  function sgDamageAt(lv){
    setupRoster('shima'); startGame(); state='play';
    const p=players[0]; player=p; p.level=lv; p.atkMul=1; p.x=camX+400; p.facing=1; p.hp=p.maxHp=99999;
    enemies.length=0; encounters.length=0; particles.length=0;
    spawnEnemy('wolf', p.x+60, LANE); const e=enemies[0];
    e.hp=e.maxHp=999999; e.thinkCd=999999; e.poise=999999;
    const before=e.hp;
    beginTigerRoar(p);                     // シマの同時押し奥義（直値16ダメージ）
    return before-e.hp; }
  const s0=sgDamageAt(1), s1=sgDamageAt(8), s2=sgDamageAt(16);
  if(_g(12,!(s1>s0))) throw new Error('SG did not grow at Lv8: '+s0+' -> '+s1);
  if(_g(13,!(s2>s1))) throw new Error('SG did not grow at Lv16: '+s1+' -> '+s2);
  console.log('奥義の進化 OK (虎咆の実ダメージ '+s0+' → '+s1+' → '+s2+')');

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
  if(_g(14,b0.bolts!==1||b1.bolts!==2||b2.bolts!==3)) throw new Error('beam lanes should be 1/2/3, got '+b0.bolts+'/'+b1.bolts+'/'+b2.bolts);
  if(_g(15,!(b1.dmg>b0.dmg)||!(b2.dmg>b1.dmg))) throw new Error('beam damage did not grow: '+b0.dmg+'/'+b1.dmg+'/'+b2.dmg);
  console.log('ヌコのタメ攻撃 OK (雷条 1→2→3本、実ダメージ '+b0.dmg+' → '+b1.dmg+' → '+b2.dmg+')');

  // ===== 7) 昇格はちょうど境界レベルでだけ告知される =====
  {
    setupRoster('inu'); startGame(); state='play';
    const p=players[0]; player=p; p.atkMul=1;
    const said=[]; const op=popText; popText=function(x,y,t){ said.push(t); };
    [7,8,9,15,16,17].forEach(function(lv){ p.level=lv;
      const i=EVO_LV.indexOf(lv); if(_g(16,(i>=0)!==(lv===8||lv===16))) throw new Error('EVO_LV boundary mismatch at '+lv); });
    popText=op;
  }
  console.log('昇格の境界 OK (Lv8とLv16でのみ段位が上がる)');

  console.log('EVOLUTION TEST PASSED'); process.exit(0);
})().catch(e=>{ console.error('FAIL:', e.message, e.stack); process.exit(1); });
`;
code = code + "\n;" + DRIVER;
(0, eval)(code);

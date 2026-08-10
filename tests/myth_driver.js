const DRIVER = `
(async()=>{
  const step=(n)=>{ for(let i=0;i<n;i++){ if(global.rafCb){ const cb=global.rafCb; global.rafCb=null; cb(); } } };

  // ===== 1) 4周目の骨格 =====
  if(!MYTH_CH || MYTH_CH.length!==3) throw new Error('神話の章が3つでない');
  MYTH_CH.forEach(function(c){
    if(!STAGE_THEME[c.theme]) throw new Error(c.name+' のテーマ '+c.theme+' が範囲外');
    if(!STAGE_THEME[c.theme].myth) throw new Error(c.name+' のテーマが神話用でない');
    const bg=c.gates.filter(function(g){ return g.boss; });
    if(bg.length!==1) throw new Error(c.name+' にボス門が1つでない'); });
  ['poseidon','hades','zeus'].forEach(function(k){
    if(!ETYPE[k]) throw new Error('ボス '+k+' が無い');
    if(!ETYPE[k].boss) throw new Error(k+' が boss でない');
    if(!(BOSSMOVES[k]||[]).length) throw new Error(k+' に技表が無い'); });
  MYTH_ZAKO_POOL.forEach(function(k){ if(!ETYPE[k]) throw new Error('雑魚 '+k+' が無い'); });
  if(MYTH_ZAKO_POOL.length!==6) throw new Error('神話の雑魚が6種でない');
  console.log('四周目の骨格 OK (3ステージ / 雑魚6種 / 神3柱、テーマ番号も範囲内)');

  // ===== 2) 難易度は周回で上がる =====
  { const sv=lap;
    const m=[1,2,3,4].map(function(L){ lap=L; return {hp:diffHpMul(), dmg:diffDmgMul()}; });
    lap=sv;
    for(let i=1;i<4;i++){ if(!(m[i].hp>m[i-1].hp)) throw new Error('周'+(i+1)+'でHP倍率が上がらない');
      if(!(m[i].dmg>m[i-1].dmg)) throw new Error('周'+(i+1)+'で攻撃倍率が上がらない'); }
    console.log('周回の難易度 OK (HP '+m.map(function(x){return x.hp.toFixed(2);}).join('→')
      +' / 攻撃 '+m.map(function(x){return x.dmg.toFixed(2);}).join('→')+')'); }

  // ===== 3) 分隊：同時に仕掛ける数が絞られている =====
  // 本編と同じ update() を回し、毎フレーム「攻撃権を持つ個体」を数える
  {
    setupRoster('inu'); startGame(); state='play'; lap=4;
    const p=players[0]; player=p; p.x=camX+420; p.hp=p.maxHp=999999; p.invuln=999999; p.level=20;
    enemies.length=0; encounters.length=0; particles.length=0;
    for(let i=0;i<8;i++) spawnEnemy('mythblade', p.x+120+i*40, LANE);
    enemies.forEach(function(e){ e.hp=e.maxHp=999999; });
    let over=0, n=0, maxHold=0, moved=0;
    const x0=enemies.map(function(e){ return e.x; });
    let idleWorst=0, idleRun=0;
    for(let f=0;f<600;f++){ hitStop=0; slowmo=0; step(1);
      let h=0; enemies.forEach(function(e){ if(e.sqHold>gf) h++; });
      if(h===0){ idleRun++; idleWorst=Math.max(idleWorst,idleRun); } else idleRun=0;
      // squadCap() と比べると、その関数を壊した瞬間に素通りする（自己参照）。
      // 「8体いても同時に仕掛けるのは3体まで」を直値で要求する
      maxHold=Math.max(maxHold,h); if(h>3) over++; n++; }
    enemies.forEach(function(e,i){ if(Math.abs(e.x-x0[i])>30) moved++; });
    if(over>0) throw new Error('8体中4体以上が同時に仕掛けたフレームが '+over+'/'+n);
    if(maxHold>3) throw new Error('同時に仕掛けた最大数が多すぎる: '+maxHold+'体');
    if(!(maxHold>=1)) throw new Error('誰も攻撃権を取っていない（分隊が膠着している）');
    // 膠着の再発防止：無攻撃が長く続く区間が無いこと。
    // 「近い者が優先」だけだと全員が譲り合って永久に誰も出てこない
    if(idleWorst>90) throw new Error('誰も仕掛けない時間が長すぎる: 連続'+idleWorst+'フレーム（膠着）');
    if(!(moved>=6)) throw new Error('順番待ちの個体が動いていない（動いた '+moved+'/8）');
    console.log('分隊の攻撃権 OK (同時に仕掛けるのは最大'+maxHold+'体／上限'+squadCap()+'、8体中'+moved+'体が動いて回り込む、無攻撃の最長'+idleWorst+'F)');
  }

  // ===== 4) 回り込み役は背後を取る =====
  {
    setupRoster('inu'); startGame(); state='play'; lap=4;
    const p=players[0]; player=p; p.x=camX+420; p.facing=1; p.hp=p.maxHp=999999; p.invuln=999999;
    enemies.length=0; encounters.length=0; particles.length=0;
    for(let i=0;i<4;i++) spawnEnemy('mythflank', p.x+150+i*50, LANE);
    enemies.forEach(function(e){ e.hp=e.maxHp=999999; });
    let behind=0;
    for(let f=0;f<420;f++){ hitStop=0; slowmo=0; step(1);
      if(f>180 && enemies.some(function(e){ return !e.dead && e.x < p.x-30; })) behind++; }
    if(!(behind>40)) throw new Error('回り込み役が一度も背後に回らない（'+behind+'フレーム）');
    console.log('回り込み OK (最初は全員前方、'+behind+'フレームで背後を取っていた)');
  }

  // ===== 5) 跳躍突進：高く跳んで、着地に硬直がある =====
  {
    setupRoster('inu'); startGame(); state='play'; lap=4;
    const p=players[0]; player=p; p.x=camX+560; p.facing=-1; p.hp=p.maxHp=999999; p.invuln=0; p.defMul=1;
    enemies.length=0; encounters.length=0; particles.length=0;
    spawnEnemy('mythhop', p.x-320, LANE); const e=enemies[0];
    e.hp=e.maxHp=999999; e.stun=0; e.thinkCd=0; e.sqHold=gf+9999;   // 攻撃権を与える
    let zMax=0, hit=0, leapF=0, landHold=0;
    const hp0=p.hp;
    for(let f=0;f<200;f++){ hitStop=0; slowmo=0; step(1);
      if(e.state==='mythleap'){ leapF++; zMax=Math.max(zMax,e.z||0);
        if(e.z<=0) landHold++; } }
    hit=hp0-p.hp;
    if(!(leapF>0)) throw new Error('跳躍突進が発動しない');
    if(!(zMax>200)) throw new Error('跳躍が低い: '+Math.round(zMax)+'px');
    if(!(landHold>=20)) throw new Error('着地の硬直が短い: '+landHold+'F（反撃の窓が無い）');
    if(!(hit>0)) throw new Error('急降下が当たっていない');
    console.log('跳躍突進 OK (頂点'+Math.round(zMax)+'px、着地硬直'+landHold+'F、'+hit+'ダメージ)');
  }

  // ===== 6) 斬り返し：構え中に殴ると反撃が返る =====
  {
    setupRoster('inu'); startGame(); state='play'; lap=4;
    const p=players[0]; player=p; p.x=camX+400; p.facing=1; p.hp=p.maxHp=999999; p.invuln=0; p.defMul=1;
    enemies.length=0; encounters.length=0; particles.length=0;
    spawnEnemy('mythblade', p.x-40, LANE); const e=enemies[0];
    e.hp=e.maxHp=999999; e.facing=1; e.y=p.y; e.stun=0; e.thinkCd=999999;
    e.state='mythward'; e.mwT=46; e.mwHit=false;
    const before=e.hp;
    damageEnemy(e, 100, 5, true);                    // 構え中に殴る
    const took=before-e.hp;
    if(!(took>0 && took<100)) throw new Error('構え中の被ダメが半減していない: '+took);
    if(!e.mwHit) throw new Error('斬り返しが仕込まれていない');
    const hp0=p.hp;
    for(let f=0;f<70 && p.hp===hp0;f++){ hitStop=0; slowmo=0; step(1); }
    if(!(p.hp<hp0)) throw new Error('斬り返しの反撃が返ってこない');
    console.log('斬り返し OK (被ダメ 100→'+took+'に半減、'+(hp0-p.hp)+'ダメージで返す)');
  }

  // ===== 7) 神託：詰められると跳んで離れる =====
  {
    setupRoster('inu'); startGame(); state='play'; lap=4;
    const p=players[0]; player=p; p.x=camX+400; p.hp=p.maxHp=999999; p.invuln=999999;
    enemies.length=0; encounters.length=0; particles.length=0;
    spawnEnemy('mythseer', p.x+60, LANE); const e=enemies[0];
    e.hp=e.maxHp=999999; e.stun=0; e.thinkCd=0;
    const d0=Math.abs(e.x-p.x);
    let backF=0, dMax=d0;
    for(let f=0;f<160;f++){ hitStop=0; slowmo=0; step(1);
      if(e.state==='mythback') backF++; dMax=Math.max(dMax, Math.abs(e.x-p.x)); }
    if(!(backF>0)) throw new Error('神託が距離を取り直さない');
    if(!(dMax>d0+40)) throw new Error('離れられていない: '+Math.round(d0)+'px → '+Math.round(dMax)+'px');
    console.log('神託の間合い取り OK (距離 '+Math.round(d0)+'px → '+Math.round(dMax)+'px、後退'+backF+'F)');
  }

  console.log('MYTH LAP TEST PASSED'); process.exit(0);
})().catch(e=>{ console.error('FAIL:', e.message, e.stack); process.exit(1); });
`;
code = code + "\n;" + DRIVER;
(0, eval)(code);

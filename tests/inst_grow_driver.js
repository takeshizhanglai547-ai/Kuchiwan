const DRIVER = `
global._GC={}; var _g=(n,v)=>{ _GC[n]=(_GC[n]||0)+1; return v; };
process.on("exit",()=>{ const miss=[]; for(let i=1;i<=27;i++) if(!_GC[i]) miss.push(i); console.error("GUARDS total=27 evaluated="+((27)-miss.length)+" NEVER_EVALUATED=["+miss.join(",")+"]"); });

(async()=>{
  const step=(n)=>{ for(let i=0;i<n;i++){ if(global.rafCb){ const cb=global.rafCb; global.rafCb=null; cb(); } } };
  setupRoster('inu'); startGame(); state='play'; sndOn=false;
  const p=players[0]; player=p;
  const setProgress=(cleared,lv)=>{ levelsDone={}; curWorldLevels().slice(0,cleared).forEach(l=>levelsDone[l.id]=true); p.level=lv; };

  // ===== 1) 成長度は「制覇数」と「主役レベル」の両輪で決まる =====
  setProgress(0,1);
  if(_g(1,foeGrowth()!==0)) throw new Error('growth should start at 0, got '+foeGrowth());
  if(_g(2,Math.abs(foeHpGrow()-1)>1e-9 || Math.abs(foeDmgGrow()-1)>1e-9)) throw new Error('multipliers should start at 1');
  const g0=foeGrowth();
  setProgress(3,1); const gStage=foeGrowth();
  setProgress(0,7); const gLevel=foeGrowth();
  setProgress(3,7); const gBoth=foeGrowth();
  if(_g(3,!(gStage>g0))) throw new Error('clearing stages did not raise growth');
  if(_g(4,!(gLevel>g0))) throw new Error('levelling up did not raise growth');
  if(_g(5,!(gBoth>gStage && gBoth>gLevel))) throw new Error('growth does not combine both axes');
  console.log('成長度 OK (初期0 / 3面制覇='+gStage.toFixed(1)+' / LV7='+gLevel.toFixed(1)+' / 両方='+gBoth.toFixed(1)+')');
  // 上限で頭打ちになる（無限インフレしない）
  setProgress(99,99);
  if(_g(6,foeGrowth()>15.0001)) throw new Error('growth is not capped: '+foeGrowth());
  if(_g(7,foeHpGrow()>4 || foeDmgGrow()>2.5)) throw new Error('multipliers grew out of hand');
  console.log('上限 OK (成長度 '+foeGrowth().toFixed(1)+' で頭打ち／HP×'+foeHpGrow().toFixed(2)+' 攻×'+foeDmgGrow().toFixed(2)+')');

  // ===== 2) 進行に応じて雑魚もボスも実際に硬く・痛くなる =====
  const sampleHp=(type,cleared,lv)=>{ setProgress(cleared,lv); enemies.length=0; spawnEnemy(type, p.x+200, LANE); return enemies[0].maxHp; };
  const zLo=sampleHp('wolf',0,1), zHi=sampleHp('wolf',8,14);
  const bLo=sampleHp('garm',0,1), bHi=sampleHp('garm',8,14);
  if(_g(8,!(zHi>zLo*2))) throw new Error('zako HP barely grew: '+zLo+' -> '+zHi);
  if(_g(9,!(bHi>bLo*1.4))) throw new Error('boss HP barely grew: '+bLo+' -> '+bHi);
  if(_g(10,bHi>bLo*3)) throw new Error('boss HP grew too much: '+bLo+' -> '+bHi);
  console.log('体力 OK (雑魚 '+zLo+'→'+zHi+' ／ボス '+bLo+'→'+bHi+'：ボスは伸びを抑制)');
  // 攻撃力：同じ攻撃が終盤ほど痛い
  const sampleDmg=(cleared,lv)=>{ setProgress(cleared,lv); enemies.length=0; spawnEnemy('wolf', p.x+30, LANE);
    const e=enemies[0]; e.rank=0; e.facing=-1; e.thinkCd=99999;
    p.x=e.x-20; p.y=e.y; p.z=0; p.hp=p.maxHp=99999; p.invuln=0; p.state='idle'; p.defMul=1;
    const b=p.hp; enemyAttackHit(e); return b-p.hp; };
  const dLo=sampleDmg(0,1), dHi=sampleDmg(8,14);
  if(_g(11,dLo<=0||dHi<=0)) throw new Error('zako attack did not connect');
  if(_g(12,!(dHi>dLo*1.5))) throw new Error('zako damage barely grew: '+dLo+' -> '+dHi);
  console.log('攻撃力 OK (同じ雑魚の一撃 '+dLo+'→'+dHi+')');

  // ===== 3) 精鋭（階級）が終盤で湧き、称号ぶんだけ強くなる =====
  setProgress(0,1);
  if(_g(13,foeTier()!==0)) throw new Error('elites should not appear at the very start');
  { enemies.length=0; for(let i=0;i<60;i++) spawnEnemy('wolf', p.x+200, LANE);
    if(_g(14,enemies.some(e=>e.rank>0))) throw new Error('an elite spawned at tier 0'); }
  setProgress(9,16);
  const tier=foeTier();
  if(_g(15,tier<3)) throw new Error('tier too low late in the run: '+tier);
  { enemies.length=0; for(let i=0;i<300;i++) spawnEnemy('wolf', p.x+200, LANE);
    const elites=enemies.filter(e=>e.rank>0);
    if(_g(16,!elites.length)) throw new Error('no elites spawned at tier '+tier);
    if(_g(17,elites.some(e=>e.rank>tier))) throw new Error('elite rank exceeded the tier');
    const plain=enemies.find(e=>!e.rank);
    if(_g(18,plain && !elites.some(e=>e.maxHp>plain.maxHp))) throw new Error('elites are not tougher than plain foes');
    console.log('精鋭 OK (階級'+tier+'／300体中 '+elites.length+' 体が精鋭、最高位 '+FOE_RANK_NAME[Math.max.apply(null,elites.map(e=>e.rank))]+')'); }
  // ボス・乗り物・主役ボスには階級が付かない
  { enemies.length=0; for(let i=0;i<80;i++){ spawnEnemy('garm', p.x+200, LANE); spawnEnemy('bikewan', p.x+200, LANE); spawnEnemy('hbInu', p.x+200, LANE); }
    if(_g(19,enemies.some(e=>e.rank>0))) throw new Error('bosses/vehicles/hero-bosses must not get a rank'); }
  console.log('階級の対象外 OK (ボス・乗り物・腕試しボスには付かない)');
  // 精鋭は攻撃も痛い
  { setProgress(9,16); enemies.length=0; spawnEnemy('wolf', p.x+30, LANE);
    const e=enemies[0]; e.facing=-1; e.thinkCd=99999; p.x=e.x-20; p.y=e.y; p.z=0; p.defMul=1;
    const hit=(rank)=>{ e.rank=rank; p.hp=p.maxHp=99999; p.invuln=0; p.state='idle'; const b=p.hp; enemyAttackHit(e); return b-p.hp; };
    const d0=hit(0), d3=hit(3);
    if(_g(20,!(d3>d0*1.5))) throw new Error('elite damage bonus too small: '+d0+' -> '+d3);
    console.log('精鋭の攻撃 OK (通常 '+d0+' → 鬼神 '+d3+')'); }
  // 精鋭は経験値・スコアの見返りも大きい
  { setProgress(9,16); enemies.length=0; spawnEnemy('wolf', p.x+200, LANE);
    const e=enemies[0]; e.rank=0; p.xp=0; p.level=50; p.xpNext=1e9; score=0; combo.count=0;
    killEnemy(e); const s0=score, x0=p.xp;
    enemies.length=0; spawnEnemy('wolf', p.x+200, LANE);
    const e2=enemies[0]; e2.rank=3; p.xp=0; score=0; combo.count=0;
    killEnemy(e2); if(_g(21,!(score>s0 && p.xp>x0))) throw new Error('elites give no extra reward');
    console.log('精鋭の見返り OK (スコア '+s0+'→'+score+' ／経験値 '+x0+'→'+p.xp+')'); }

  // ===== 4) 機動：終盤ほど動き出しが速い =====
  setProgress(0,1); const think0=enemyThinkMul();
  setProgress(9,16); const think1=enemyThinkMul();
  if(_g(22,!(think1>think0*1.2))) throw new Error('enemies did not get quicker: '+think0+' -> '+think1);
  if(_g(23,foeSpdGrow()>1.4)) throw new Error('speed growth is too extreme');
  console.log('機動 OK (思考速度 ×'+think0.toFixed(2)+'→×'+think1.toFixed(2)+'／機動 ×'+foeSpdGrow().toFixed(2)+')');

  // ===== 5) 階級が上がった瞬間に通知が出る =====
  { setProgress(0,1); lastFoeTier=0; stageBanner=0; stageBannerTxt='';
    checkFoeTierUp();
    if(_g(24,stageBanner!==0)) throw new Error('tier-up notice fired at tier 0');
    setProgress(9,16); checkFoeTierUp();
    if(_g(25,stageBanner<=0 || !/敵が強化された/.test(stageBannerTxt))) throw new Error('tier-up notice did not fire');
    const txt=stageBannerTxt; stageBanner=0; stageBannerTxt='';
    checkFoeTierUp();
    if(_g(26,stageBanner!==0)) throw new Error('tier-up notice repeated without a tier change');
    console.log('通知 OK ("'+txt+'" が階級上昇時のみ1回)'); }

  // ===== 6) 二周目・三周目の周回倍率とも噛み合う =====
  { setProgress(4,10); const g1=foeHpGrow()*diffHpMul();
    lap=3; const g3=foeHpGrow()*diffHpMul(); lap=1;
    if(_g(27,!(g3>g1))) throw new Error('lap multiplier no longer stacks with the growth system'); }
  console.log('周回との併用 OK (周回倍率と成長倍率が両立)');

  console.log('FOE GROWTH TEST PASSED'); process.exit(0);
})().catch(e=>{ console.error('FAIL:', e.message, e.stack); process.exit(1); });
`;
code = code + "\n;" + DRIVER;
(0, eval)(code);

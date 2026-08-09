const DRIVER = `
global._GC={}; var _g=(n,v)=>{ _GC[n]=(_GC[n]||0)+1; return v; };
process.on("exit",()=>{ const miss=[]; for(let i=1;i<=19;i++) if(!_GC[i]) miss.push(i); console.error("GUARDS total=19 evaluated="+((19)-miss.length)+" NEVER_EVALUATED=["+miss.join(",")+"]"); });

(async()=>{
  const step=(n)=>{ for(let i=0;i<n;i++){ if(global.rafCb){ const cb=global.rafCb; global.rafCb=null; cb(); } } };

  // ===== 1) 型の表そのもの =====
  if(_g(1,ATK_VAR.length!==5)) throw new Error('expected 5 attack variants, got '+ATK_VAR.length);
  const ids=ATK_VAR.map(function(v){return v.id;});
  ['swipe','double','thrust','anti','sweep'].forEach(function(id){
    if(_g(2,ids.indexOf(id)<0)) throw new Error('missing variant: '+id); });
  ATK_VAR.forEach(function(v){
    if(_g(3,!v.hits||!v.hits.length)) throw new Error(v.id+' has no hits');
    v.hits.forEach(function(h){ ['t','dmg','reach','lane'].forEach(function(k){
      if(_g(4,typeof h[k]!=='number')) throw new Error(v.id+' hit missing '+k); }); }); });
  if(_g(5,ATK_VAR[1].hits.length!==2)) throw new Error('double should have 2 hits');
  console.log('攻撃の型 OK (単発/二段/踏み込み/対空/足払いの5種、全て多段情報を持つ)');

  // ===== 2) 対空だけが空中の相手に当たる（実際に殴らせてHPを測る）=====
  function tryHitAir(varIdx, pz){
    setupRoster('inu'); startGame(); state='play';
    const p=players[0]; player=p; p.x=camX+400; p.facing=1; p.hp=p.maxHp=99999; p.invuln=0;
    p.state = pz>14 ? 'jump' : 'idle'; p.z=pz; p.vz=0;
    enemies.length=0; encounters.length=0; particles.length=0;
    // hitOnePlayer は sign(p.x-e.x) === e.facing を要求するので、敵は後方に置いて前を向かせる
    spawnEnemy('wolf', p.x-40, LANE); const e=enemies[0];
    e.hp=e.maxHp=999999; e.thinkCd=999999; e.facing=1; e.y=p.y;
    e.atkVar=varIdx;
    const before=p.hp;
    const V=ATK_VAR[varIdx];
    enemyAttackHit(e, V, V.hits[0]);
    return before-p.hp; }
  const gnd0=tryHitAir(0,0), gnd3=tryHitAir(3,0);
  if(_g(6,!(gnd0>0))) throw new Error('swipe should hit a grounded player');
  if(_g(7,!(gnd3>0))) throw new Error('anti-air should also hit a grounded player');
  const air0=tryHitAir(0,70), air4=tryHitAir(4,70), air3=tryHitAir(3,70);
  if(_g(8,air0!==0)) throw new Error('plain swipe must not reach a player at z=70, got '+air0);
  if(_g(9,air4!==0)) throw new Error('sweep must not reach a player at z=70, got '+air4);
  if(_g(10,!(air3>0))) throw new Error('anti-air failed to reach a player at z=70');
  const air3hi=tryHitAir(3,140);
  if(_g(11,air3hi!==0)) throw new Error('anti-air should still miss above its ceiling (z=140), got '+air3hi);
  console.log('対空 OK (z=70 では通常'+air0+' / 足払い'+air4+' / 対空'+air3+'ダメージ、z=140 は対空も届かない)');

  // ===== 3) 踏み込みは間合いが広い =====
  function reachOf(varIdx, gap){
    setupRoster('inu'); startGame(); state='play';
    const p=players[0]; player=p; p.x=camX+400; p.facing=1; p.hp=p.maxHp=99999; p.invuln=0; p.state='idle'; p.z=0;
    enemies.length=0; encounters.length=0; particles.length=0;
    spawnEnemy('wolf', p.x-gap, LANE); const e=enemies[0];
    e.hp=e.maxHp=999999; e.thinkCd=999999; e.facing=1; e.y=p.y;
    const V=ATK_VAR[varIdx]; const before=p.hp;
    enemyAttackHit(e, V, V.hits[0]);
    return before-p.hp; }
  { let rs=0, rt=0;
    for(let g=40; g<260; g+=4){ if(reachOf(0,g)>0) rs=g; }
    for(let g=40; g<260; g+=4){ if(reachOf(2,g)>0) rt=g; }
    if(_g(12,!(rt>rs))) throw new Error('thrust reach ('+rt+') should exceed swipe reach ('+rs+')');
    console.log('踏み込み突き OK (届く距離 単発'+rs+'px → 突き'+rt+'px)'); }

  // ===== 4) 型の選択：空中の相手には対空が主軸になる =====
  {
    setupRoster('inu'); startGame(); state='play';
    const p=players[0]; player=p; p.x=camX+400; p.z=0;
    enemies.length=0; spawnEnemy('wolf', p.x-60, LANE); const e=enemies[0];
    const t=ETYPE[e.type];
    let air=0, gnd=0;
    p.z=80; for(let i=0;i<400;i++){ if(pickAtkVar(e,p,t.atkR*0.5)===3) air++; }
    p.z=0;  for(let i=0;i<400;i++){ if(pickAtkVar(e,p,t.atkR*0.5)===3) gnd++; }
    if(_g(13,!(air>250))) throw new Error('anti-air should dominate vs an airborne player, got '+air+'/400');
    if(_g(14,gnd!==0)) throw new Error('anti-air should never be picked vs a grounded player, got '+gnd+'/400');
    // 地上では単発一辺倒にならず、複数の型が出る
    const seen={};
    for(let i=0;i<600;i++){ seen[pickAtkVar(e,p,t.atkR*0.9)]=1; }
    const kinds=Object.keys(seen).length;
    if(_g(15,kinds<3)) throw new Error('grounded enemies should mix at least 3 variants, got '+kinds);
    console.log('型の選択 OK (空中の相手には対空'+air+'/400、地上では'+kinds+'種が混ざる)');
  }

  // ===== 5) ボスは従来どおり単発（専用の技表を壊さない）=====
  {
    setupRoster('inu'); startGame(); state='play';
    const p=players[0]; player=p; p.x=camX+400; p.z=0;
    enemies.length=0;
    const bossType=Object.keys(ETYPE).filter(function(k){ return ETYPE[k].boss; })[0];
    spawnEnemy(bossType, p.x-80, LANE); const b=enemies[0];
    for(let i=0;i<200;i++){ if(_g(16,pickAtkVar(b,p,40)!==0)) throw new Error('boss must stay on variant 0'); }
    console.log('ボス OK ('+ETYPE[bossType].name+' は従来どおり単発、専用技表は無傷)');
  }

  // ===== 6) 誘い（フェイント）が実際に空振りする =====
  {
    setupRoster('inu'); startGame(); state='play';
    const p=players[0]; player=p; p.x=camX+400; p.facing=1; p.hp=p.maxHp=99999; p.invuln=0; p.state='idle'; p.z=0;
    enemies.length=0; encounters.length=0;
    spawnEnemy('wolf', p.x-50, LANE); const e=enemies[0];
    e.hp=e.maxHp=999999; e.facing=1; e.y=p.y; e.stun=0;
    e.atkVar=0; e.feint=true; e.telegraph=1; e.teleMax=17;
    const hpBefore=p.hp, xBefore=e.x;
    step(3);
    if(_g(17,p.hp!==hpBefore)) throw new Error('a feint must not deal damage');
    if(_g(18,e.state==='attack')) throw new Error('a feint must not enter the attack state');
    if(_g(19,!(e.x<xBefore))) throw new Error('a feint should hop back, x '+xBefore+' -> '+e.x);
    console.log('誘い OK (構えを解いて'+Math.round(xBefore-e.x)+'px 後退、ダメージ0)');
  }

  console.log('FOE ATTACK VARIANT TEST PASSED'); process.exit(0);
})().catch(e=>{ console.error('FAIL:', e.message, e.stack); process.exit(1); });
`;
code = code + "\n;" + DRIVER;
(0, eval)(code);

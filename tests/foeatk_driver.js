const DRIVER = `
(async()=>{
  const step=(n)=>{ for(let i=0;i<n;i++){ if(global.rafCb){ const cb=global.rafCb; global.rafCb=null; cb(); } } };

  // ===== 1) 型の表そのもの =====
  if(ATK_VAR.length!==5) throw new Error('expected 5 attack variants, got '+ATK_VAR.length);
  const ids=ATK_VAR.map(function(v){return v.id;});
  ['swipe','double','thrust','anti','sweep'].forEach(function(id){
    if(ids.indexOf(id)<0) throw new Error('missing variant: '+id); });
  ATK_VAR.forEach(function(v){
    if(!v.hits||!v.hits.length) throw new Error(v.id+' has no hits');
    v.hits.forEach(function(h){ ['t','dmg','reach','lane'].forEach(function(k){
      if(typeof h[k]!=='number') throw new Error(v.id+' hit missing '+k); }); }); });
  if(ATK_VAR[1].hits.length!==2) throw new Error('double should have 2 hits');
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
  if(!(gnd0>0)) throw new Error('swipe should hit a grounded player');
  if(!(gnd3>0)) throw new Error('anti-air should also hit a grounded player');
  const air0=tryHitAir(0,70), air4=tryHitAir(4,70), air3=tryHitAir(3,70);
  if(air0!==0) throw new Error('plain swipe must not reach a player at z=70, got '+air0);
  if(air4!==0) throw new Error('sweep must not reach a player at z=70, got '+air4);
  if(!(air3>0)) throw new Error('anti-air failed to reach a player at z=70');
  const CEIL=ATK_VAR[3].hits[0].z;
  const air3hi=tryHitAir(3,CEIL+30);
  if(air3hi!==0) throw new Error('anti-air should still miss above its ceiling (z='+(CEIL+30)+'), got '+air3hi);
  const air3mid=tryHitAir(3,CEIL-30);
  if(!(air3mid>0)) throw new Error('anti-air should reach just under its ceiling (z='+(CEIL-30)+')');
  console.log('対空 OK (z=70 では通常'+air0+' / 足払い'+air4+' / 対空'+air3+'ダメージ、天井'+CEIL+'px の上は届かない)');

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
    if(!(rt>rs)) throw new Error('thrust reach ('+rt+') should exceed swipe reach ('+rs+')');
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
    if(!(air>250)) throw new Error('anti-air should dominate vs an airborne player, got '+air+'/400');
    if(gnd!==0) throw new Error('anti-air should never be picked vs a grounded player, got '+gnd+'/400');
    // 地上では単発一辺倒にならず、複数の型が出る
    const seen={};
    for(let i=0;i<600;i++){ seen[pickAtkVar(e,p,t.atkR*0.9)]=1; }
    const kinds=Object.keys(seen).length;
    if(kinds<3) throw new Error('grounded enemies should mix at least 3 variants, got '+kinds);
    console.log('型の選択 OK (空中の相手には対空'+air+'/400、地上では'+kinds+'種が混ざる)');
  }

  // ===== 5) ボスは従来どおり単発（専用の技表を壊さない）=====
  {
    setupRoster('inu'); startGame(); state='play';
    const p=players[0]; player=p; p.x=camX+400; p.z=0;
    enemies.length=0;
    const bossType=Object.keys(ETYPE).filter(function(k){ return ETYPE[k].boss; })[0];
    spawnEnemy(bossType, p.x-80, LANE); const b=enemies[0];
    for(let i=0;i<200;i++){ if(pickAtkVar(b,p,40)!==0) throw new Error('boss must stay on variant 0'); }
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
    if(p.hp!==hpBefore) throw new Error('a feint must not deal damage');
    if(e.state==='attack') throw new Error('a feint must not enter the attack state');
    if(!(e.x<xBefore)) throw new Error('a feint should hop back, x '+xBefore+' -> '+e.x);
    console.log('誘い OK (構えを解いて'+Math.round(xBefore-e.x)+'px 後退、ダメージ0)');
  }

  // ===== 7) 二段薙ぎの2発目が無敵に飲まれず実際に入る =====
  // （1発目が既定38Fの無敵を立て、11F後の2発目が常にダメージ0だった）
  {
    function twoHit(){
      setupRoster('inu'); startGame(); state='play';
      const p=players[0]; player=p; p.x=camX+400; p.facing=1; p.hp=p.maxHp=999999; p.invuln=0;
      p.state='idle'; p.z=0; p.defMul=1;
      enemies.length=0; encounters.length=0; particles.length=0;
      spawnEnemy('wolf', p.x-40, LANE); const e=enemies[0];
      e.hp=e.maxHp=999999; e.thinkCd=999999; e.facing=1; e.y=p.y; e.stun=0;
      e.atkVar=1; e.feint=false; e.teleMax=16; e.telegraph=16;
      const seg=[];
      for(let i=0;i<80 && (e.telegraph>0||e.state==='attack');i++){
        const b=p.hp; hitStop=0; slowmo=0; step(1);
        if(p.hp<b) seg.push(b-p.hp); }
      return seg; }
    const seg=twoHit();
    if(seg.length<2) throw new Error('二段の2発目が入っていない: 入った段数='+seg.length+' '+JSON.stringify(seg));
    if(!(seg[1]>0)) throw new Error('二段の2発目のダメージが0');
    console.log('二段薙ぎ OK (1発目'+seg[0]+' + 2発目'+seg[1]+' = 計'+(seg[0]+seg[1])+'ダメージ)');
  }

  // ===== 8) 型の抽選が偏らない（同じ乱数の使い回しで型が消えていた）=====
  {
    setupRoster('inu'); startGame(); state='play';
    const p=players[0]; player=p; p.x=camX+400; p.z=0;
    enemies.length=0; spawnEnemy('wolf', p.x-60, LANE); const e=enemies[0];
    const t=ETYPE[e.type];
    function dist(d){ const c=[0,0,0,0,0];
      for(let i=0;i<20000;i++) c[pickAtkVar(e,p,d)]++;
      return c.map(function(n){ return Math.round(n/200); }); }   // %
    const near=dist(t.atkR*0.20), far=dist(t.atkR*0.90);
    [['近',near],['遠',far]].forEach(function(c){
      const nm=c[0], d=c[1];
      [0,1,2,4].forEach(function(i){
        if(d[i]<5) throw new Error(nm+'距離で型'+i+'('+ATK_VAR[i].id+')が'+d[i]+'%しか出ない'); });
      if(d[3]!==0) throw new Error(nm+'距離で地上の相手に対空が出ている'); });
    console.log('型の抽選 OK (近'+near.join('/')+'% 遠'+far.join('/')+'% ＝単発/二段/突き/対空/足払い)');
  }

  // ===== 9) 対空の天井が跳躍の頂点を覆う =====
  {
    setupRoster('inu'); startGame(); state='play';
    const p=players[0]; player=p; p.x=camX+400; p.facing=1; p.hp=p.maxHp=999999;
    enemies.length=0; encounters.length=0; particles.length=0;
    p.state='jump'; p.vz=17; p.z=0; p.jAtk=0;
    let apex=0, n=0;
    while(p.state==='jump' && n<200){ n++; hitStop=0; slowmo=0; step(1); apex=Math.max(apex,p.z); }
    const ceil=ATK_VAR[3].hits[0].z;
    if(!(ceil>=apex*0.85)) throw new Error('対空の天井'+ceil+'が跳躍の頂点'+apex.toFixed(0)+'に届かない');
    console.log('対空の天井 OK (跳躍の頂点'+apex.toFixed(0)+'px に対して天井'+ceil+'px)');
  }

  // ===== 10) 踏み込み突きが相手を突き抜けない =====
  {
    function gapAfterThrust(guard){
      setupRoster('inu'); startGame(); state='play';
      const p=players[0]; player=p; p.x=camX+430; p.facing=-1; p.hp=p.maxHp=999999;
      p.state = guard?'guard':'idle'; p.guardStart=guard?-99:0; p.z=0; p.invuln=guard?0:999999;
      enemies.length=0; encounters.length=0; particles.length=0;
      spawnEnemy('wolf', p.x-70, LANE); const e=enemies[0];
      e.hp=e.maxHp=999999; e.thinkCd=999999; e.facing=1; e.y=p.y; e.stun=0;
      e.atkVar=2; e.feint=false; e.teleMax=24; e.telegraph=24;
      for(let i=0;i<90 && (e.telegraph>0||e.state==='attack');i++){ hitStop=0; slowmo=0; step(1); }
      return p.x-e.x; }
    const g=gapAfterThrust(true), i=gapAfterThrust(false);
    if(!(g>0)) throw new Error('ガードした側を突き抜けて背後に立つ: gap='+g.toFixed(1));
    if(!(i>0)) throw new Error('無敵の相手を突き抜けて背後に立つ: gap='+i.toFixed(1));
    console.log('踏み込み突き OK (ガード後 gap='+g.toFixed(1)+'px / 無敵後 gap='+i.toFixed(1)+'px、いずれも正面を維持)');
  }

  // ===== 11) 通常雑魚が強制ダウンを乱発しない =====
  // 踏み込み突きに kn:1 が付いていたため、遠間合いでは攻撃の3割が問答無用のダウンになり、
  // 操作不能時間が 29%→36% に伸びていた（ダメージは増えていないのでテンポだけが落ちる）
  {
    const kn=ATK_VAR.map(function(v){ return v.hits.some(function(h){ return h.kn; })?1:0; });
    if(kn[0]||kn[1]||kn[2]) throw new Error('単発・二段・突きに強制ダウンが付いている: '+kn.join(','));
    if(!kn[3]||!kn[4]) throw new Error('対空・足払いは転ばせる役目なので kn を残すこと: '+kn.join(','));
    // 実測：地上の相手に 400 回仕掛けて、ダウンを取る型が選ばれた割合
    setupRoster('inu'); startGame(); state='play';
    const p=players[0]; player=p; p.x=camX+400; p.z=0;
    enemies.length=0; spawnEnemy('wolf', p.x-60, LANE); const e=enemies[0];
    const t=ETYPE[e.type];
    let down=0, N=4000;
    for(let i=0;i<N;i++){ if(kn[pickAtkVar(e,p,t.atkR*0.9)]) down++; }
    const pct=down/N*100;
    if(pct>25) throw new Error('地上の相手へのダウン率が高すぎる: '+pct.toFixed(1)+'%');
    console.log('ダウン率 OK (地上の相手に対して '+pct.toFixed(1)+'%、転ばせるのは対空と足払いのみ)');
  }

  // ===== 12) 型ごとの tele / dur / step が実際に効いている =====
  // 表の値を読むだけでは、実装が V を無視しても気付けない。実際に走らせて測る
  {
    function runVar(vi){
      setupRoster('inu'); startGame(); state='play';
      const p=players[0]; player=p; p.x=camX+480; p.facing=-1; p.hp=p.maxHp=999999; p.invuln=999999;
      p.state='idle'; p.z=0;
      enemies.length=0; encounters.length=0; particles.length=0;
      spawnEnemy('wolf', p.x-40, LANE); const e=enemies[0];   // AI が仕掛ける間合いに置く
      e.hp=e.maxHp=999999; e.facing=1; e.y=p.y; e.stun=0;
      // 構えの長さは実装に決めさせる。ATK_VAR から自分で組み立てて測ると、
      // 実装が V.tele を無視しても気付けない（自己証明になる）
      const opick=pickAtkVar; pickAtkVar=function(){ return vi; };
      e.thinkCd=0; e.stun=0; e.telegraph=0; e.feint=false;
      try { for(let g=0;g<120 && e.telegraph<=0;g++){ hitStop=0; slowmo=0; step(1); } }
      finally { pickAtkVar=opick; }
      if(e.telegraph<=0) throw new Error('型'+vi+' で構えに入らなかった');
      if(e.atkVar!==vi) throw new Error('型'+vi+' が選ばれていない: '+e.atkVar);
      const x0=e.x; let tele=0, atk=0;
      for(let i=0;i<160 && (e.telegraph>0||e.state==='attack');i++){
        if(e.telegraph>0) tele++; else if(e.state==='attack') atk++;
        e.feint=false; hitStop=0; slowmo=0; step(1); }
      return {tele:tele+1, atk:atk, moved:e.x-x0, teleMax:e.teleMax}; }
    const R=[0,1,2,3,4].map(runVar);
    if(!(R[2].tele>R[0].tele)) throw new Error('踏み込み突きの構えが単発より長くない: '+R[2].tele+' vs '+R[0].tele);
    if(!(R[4].tele>R[0].tele)) throw new Error('足払いの構えが単発より長くない: '+R[4].tele+' vs '+R[0].tele);
    if(!(R[1].atk>R[0].atk))   throw new Error('二段の技時間が単発より長くない: '+R[1].atk+' vs '+R[0].atk);
    if(!(R[2].moved>R[0].moved+8)) throw new Error('踏み込み突きが前進していない: '+R[2].moved.toFixed(1)+'px vs 単発'+R[0].moved.toFixed(1)+'px');
    console.log('型ごとの間合いと時間 OK (構え 単発'+R[0].tele+'F/突き'+R[2].tele+'F/足払い'+R[4].tele
      +'F、技時間 単発'+R[0].atk+'F/二段'+R[1].atk+'F、前進 突き'+R[2].moved.toFixed(0)+'px)');
  }

  // ===== 13) 型ごとに敵の振りそのものが変わる =====
  // 構えの色だけ変えても、体が同じ動きなら読み合いにならない。
  // 技の長さは型ごとに違うので、時間を揃えて「同じ進行度での腕の角度」を比べる。
  // 角度の列をそのまま比べると、長さの差だけで列が変わり、式が同じでも差が出てしまう
  {
    function armAt(vi, phase, pr){
      setupRoster('inu'); startGame(); state='play';
      const p=players[0]; player=p; p.x=camX+480; p.facing=-1; p.hp=p.maxHp=999999; p.invuln=999999; p.z=0;
      enemies.length=0; encounters.length=0; particles.length=0;
      spawnEnemy('wolf', p.x-150, LANE); const e=enemies[0];
      e.hp=e.maxHp=999999; e.thinkCd=999999; e.facing=1; e.y=p.y; e.stun=0; e.atkVar=vi;
      // 全ての型で同じ長さ・同じ進行度に固定する
      if(phase==='tele'){ e.teleMax=40; e.telegraph=Math.round(40*(1-pr)); e.state='walk'; }
      else { e.telegraph=0; e.state='attack'; e.atkMax=40; e.atkTimer=Math.round(40*(1-pr)); }
      // drawBeastClaw は limbSeg ではなく生の ctx で描く。
      // limbSeg を張るとプレイヤーの腕を測ってしまい、何も検証できない。
      // ctx のメソッド差し替えも効かない（プロキシ）ので、ctx の束縛ごと入れ替える
      const real=ctx; let ang=null, lx=0, ly=0;
      try {
        ctx = new Proxy(real, { get:function(t,k){
          if(k==='moveTo') return function(x,y){ lx=x; ly=y; return t.moveTo(x,y); };
          if(k==='lineTo') return function(x,y){ if(ang===null) ang=Math.atan2(y-ly,x-lx); return t.lineTo(x,y); };
          const v=t[k]; return (typeof v==='function')? v.bind(t) : v; } });
        drawBeastClaw(e);
      } finally { ctx = real; }
      if(ang===null) throw new Error('型'+vi+' で腕が描かれていない ('+phase+' '+pr+')');
      return Math.round(ang*1000)/1000; }
    const probes=[['tele',0.9],['atk',0.15],['atk',0.5],['atk',0.9]];
    const sig=[0,1,2,3,4].map(function(vi){
      return probes.map(function(q){ return armAt(vi,q[0],q[1]); }).join(','); });
    const uniq={}; sig.forEach(function(v,i){ uniq[v]=(uniq[v]||[]).concat(i); });
    const dup=Object.keys(uniq).filter(function(k){ return uniq[k].length>1; });
    if(dup.length) throw new Error('型ごとに振りが違わない（同じ角度になった型: '
      +dup.map(function(k){ return uniq[k].map(function(i){return ATK_VAR[i].id;}).join('と'); }).join(' / ')+'）');
    // 構えの到達角も型ごとに違うこと（何が来るかを振りかぶりで読ませる）
    const tele=[0,1,2,3,4].map(function(vi){ return armAt(vi,'tele',0.9); });
    if(new Set(tele).size<4) throw new Error('構えの到達角が型ごとに分かれていない: '+tele.join('/'));
    console.log('型ごとの振り OK (構えの到達角 '+tele.join(' / ')+' rad、5型すべて軌跡が異なる)');
  }

  console.log('FOE ATTACK VARIANT TEST PASSED'); process.exit(0);
})().catch(e=>{ console.error('FAIL:', e.message, e.stack); process.exit(1); });
`;
code = code + "\n;" + DRIVER;
(0, eval)(code);

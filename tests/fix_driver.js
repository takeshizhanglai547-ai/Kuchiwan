const DRIVER = `
(async()=>{
  const step=(n)=>{ for(let i=0;i<n;i++){ if(global.rafCb){ const cb=global.rafCb; global.rafCb=null; cb(); } } };

  // ===== 1) 中断されたワンデンの居合で刀が消えたままにならない =====
  {
    setupRoster('wanden'); startGame(); state='play';
    const p=players[0]; player=p; p.x=camX+400; p.facing=1; p.hp=p.maxHp=99999; p.invuln=0;
    enemies.length=0; encounters.length=0; particles.length=0;
    beginAttack('wd3');                                  // 通常コンボ3段目＝抜刀（iai, act[0]=6）
    step(2);
    if(!wandenIaiHold()) throw new Error('抜刀前なのに wandenIaiHold() が false');
    hurtPlayer(p, 30, -1, false, 'flesh');               // 発生前に被弾して中断
    if(p.state==='attack') throw new Error('被弾しても attack のまま');
    if(wandenIaiHold()) throw new Error('中断後も wandenIaiHold() が true のまま＝刀が消えたまま');
    step(240);
    if(wandenIaiHold()) throw new Error('240F 後も wandenIaiHold() が true');
    console.log('居合の中断 OK (被弾で state='+p.state+' へ抜け、刀が戻る)');
  }

  // ===== 2) 昇竜系が始動から終了まで完全無敵になっていない =====
  {
    function invOf(kind,mv){
      setupRoster(kind); startGame(); state='play';
      const p=players[0]; player=p; p.level=20; p.atkMul=1; p.x=camX+400; p.facing=1;
      p.hp=p.maxHp=99999; p.dim=3; p.invuln=0;
      enemies.length=0; encounters.length=0; particles.length=0;
      beginAttack(mv);
      let inv=0,n=0;
      while(p.state==='attack' && n<200){ if(p.invuln>0) inv++; n++; hitStop=0; slowmo=0; step(1); }
      return {inv:inv,n:n}; }
    const out=[];
    [['inu','shoryu'],['inu','idragon'],['inu','idragon2'],['shima','sdrago'],['inu','shoryu2']].forEach(function(c){
      const r=invOf(c[0],c[1]);
      if(r.inv>=r.n) throw new Error(c[1]+' が始動から終了まで完全無敵: '+r.inv+'/'+r.n);
      out.push(c[1]+' '+r.inv+'/'+r.n); });
    // 零距離の一撃は無敵ゼロのまま（それがリスクの本体）
    [['shima','soneinch'],['shima','skuzan']].forEach(function(c){
      const r=invOf(c[0],c[1]);
      if(r.inv!==0) throw new Error(c[1]+' に無敵が付いている: '+r.inv+'/'+r.n);
      out.push(c[1]+' '+r.inv+'/'+r.n); });
    console.log('溜めの無敵の上限 OK (' + out.join(' / ') + ')');
  }

  // ===== 3) 跳躍の腕が3相で実際に動く（描画が使う平滑後の値を見る）=====
  {
    setupRoster('inu'); startGame(); state='play';
    const p=players[0]; player=p; p.x=camX+400; p.facing=1; p.hp=p.maxHp=99999;
    enemies.length=0; encounters.length=0; particles.length=0;
    p.state='jump'; p.vz=17; p.z=0; p.jAtk=0; p.poseB=null;
    let sMin=1e9,sMax=-1e9,bMin=1e9,bMax=-1e9,n=0;
    while(p.state==='jump' && n<200){ n++; hitStop=0; slowmo=0; step(1);
      if(p.poseB){ sMin=Math.min(sMin,p.poseB.swAng); sMax=Math.max(sMax,p.poseB.swAng);
                   bMin=Math.min(bMin,p.poseB.backArm); bMax=Math.max(bMax,p.poseB.backArm); } }
    const sR=sMax-sMin, bR=bMax-bMin;
    if(!(sR>0.30)) throw new Error('跳躍中に武器腕が動いていない: swAng の振れ幅 '+sR.toFixed(3));
    if(!(bR>0.30)) throw new Error('跳躍中に逆腕が動いていない: backArm の振れ幅 '+bR.toFixed(3));
    console.log('跳躍の腕 OK (swAng '+sMin.toFixed(2)+'→'+sMax.toFixed(2)+' 振れ幅'+sR.toFixed(2)+' / backArm 振れ幅'+bR.toFixed(2)+')');
  }

  // ===== 5) 空中でノックダウンされたら必ず着地する =====
  // 既存18スイートはこれを1つも検出しなかった。本物の update() を回して p.z を実測する
  {
    function knockInAir(){
      setupRoster('inu'); startGame(); state='play';
      const p=players[0]; player=p; p.x=camX+430; p.facing=-1; p.hp=p.maxHp=999999; p.invuln=0; p.defMul=1;
      enemies.length=0; encounters.length=0; particles.length=0;
      spawnEnemy('wolf', p.x-40, LANE); const e=enemies[0];
      e.hp=e.maxHp=999999; e.thinkCd=999999; e.facing=1; e.y=p.y; e.stun=0;
      p.state='jump'; p.z=90; p.vz=0; p.jAtk=0;
      const V=ATK_VAR[3];                                  // 対空でたたき落とす
      enemyAttackHit(e, V, V.hits[0]);
      if(p.state!=='down') throw new Error('対空でノックダウンしていない: state='+p.state);
      let n=0, land=-1;
      while(n<400){ n++; hitStop=0; slowmo=0; step(1); if(land<0 && p.z<=0) land=n; }
      return {land:land, z:p.z, st:p.state}; }
    const r=knockInAir();
    if(r.land<0) throw new Error('空中で倒された後、400F 経っても着地しない（z='+r.z.toFixed(1)+' state='+r.st+'）');
    if(r.z>0.01) throw new Error('最終的に浮いたまま: z='+r.z.toFixed(2));
    if(r.st==='down') throw new Error('400F 経っても down のまま抜けられない');
    console.log('空中ノックダウン OK ('+r.land+'F で着地、最終 z='+r.z.toFixed(2)+' state='+r.st+')');
  }

  // ===== 6) 実プレイに近い形で「地上状態なのに浮いている」フレームが出ない =====
  {
    setupRoster('inu'); startGame(); state='play';
    const p=players[0]; player=p; p.x=camX+420; p.hp=p.maxHp=999999; p.defMul=1;
    enemies.length=0; encounters.length=0; particles.length=0;
    for(let i=0;i<3;i++) spawnEnemy('wolf', p.x+120+i*70, LANE);
    enemies.forEach(function(e){ e.hp=e.maxHp=999999; });
    let bad=0, maxZ=0;
    for(let n=0;n<1200;n++){
      if(p.z<=0 && p.state!=='jump') { p.state='jump'; p.vz=17; }   // 着地するたび跳ぶ
      hitStop=0; slowmo=0; step(1);
      const grounded=(p.state==='idle'||p.state==='walk');
      if(grounded && p.z>1){ bad++; maxZ=Math.max(maxZ,p.z); } }
    if(bad>0) throw new Error('地上状態なのに浮いているフレームが '+bad+'/1200（最大 z='+maxZ.toFixed(1)+'）');
    console.log('浮遊の再発なし OK (1200F 中 0 フレーム)');
  }

  // ===== 7) 跳躍3相の「脚」も実際に動く（腕だけ見ていて、脚を定数に戻しても緑だった）=====
  {
    setupRoster('inu'); startGame(); state='play';
    const p=players[0]; player=p; p.x=camX+400; p.facing=1; p.hp=p.maxHp=99999;
    enemies.length=0; encounters.length=0; particles.length=0;
    p.state='jump'; p.vz=17; p.z=0; p.jAtk=0; p.poseB=null;
    const rec=[];
    let n=0;
    while(p.state==='jump' && n<200){ n++; hitStop=0; slowmo=0; step(1);
      if(p.poseB) rec.push({vz:p.vz, z:p.z, kF:p.poseB.kF, kB:p.poseB.kB, thF:p.poseB.thF}); }
    const up=rec.filter(function(r){ return r.vz>7; }), dn=rec.filter(function(r){ return r.vz<-7; });
    if(!up.length||!dn.length) throw new Error('上昇相/落下相のサンプルが取れていない');
    const avg=function(a,k){ return a.reduce(function(s,r){ return s+r[k]; },0)/a.length; };
    const kUp=avg(up,'kF'), kDn=avg(dn,'kF');
    if(!(kUp > kDn+0.4)) throw new Error('跳躍中に脚が畳まれ→伸びていない: 上昇 kF='+kUp.toFixed(2)+' 落下 kF='+kDn.toFixed(2));
    if(!(avg(up,'thF') > avg(dn,'thF')+0.2)) throw new Error('跳躍中に腿が動いていない');
    console.log('跳躍の脚 OK (膝 上昇'+kUp.toFixed(2)+' → 落下'+kDn.toFixed(2)+')');
  }

  // ===== 8) ガトリングの回転立ち上がりの間は撃たない =====
  {
    setupRoster('watch'); startGame(); state='play';
    const p=players[0]; player=p; p.x=camX+400; p.facing=1; p.hp=p.maxHp=99999; p.dim=3;
    enemies.length=0; encounters.length=0; particles.length=0; projectiles.length=0;
    beginGatling(p);
    let first=-1;
    for(let i=1;i<=40;i++){ hitStop=0; slowmo=0; step(1);
      if(first<0 && (p.gatShots||0)>0) first=i; }
    if(first<0) throw new Error('ガトリングが1発も撃っていない');
    // GAT_SPIN と比べると、その定数を0にした瞬間に素通りする（自己参照）。
    // 「立ち上がりとして体感できる長さ」を直値で要求する
    if(!(first>=10)) throw new Error('回転の立ち上がりが短すぎる: 初弾'+first+'F目（10F以上あること）');
    if(!(first<=24)) throw new Error('立ち上がりが長すぎて技として重い: 初弾'+first+'F目');
    console.log('ガトリングの立ち上がり OK (初弾は'+first+'F目＝回転が上がりきってから)');
  }

  // ===== 9) 掴まれた敵が暴れる（押さえ込みの揺れを消しても緑だった）=====
  {
    setupRoster('inu'); startGame(); state='play';
    const p=players[0]; player=p; p.x=camX+420; p.facing=1; p.hp=p.maxHp=99999;
    enemies.length=0; encounters.length=0; particles.length=0;
    spawnEnemy('wolf', p.x+40, LANE); const e=enemies[0];
    e.hp=e.maxHp=99999; e.thinkCd=99999;
    p.state='grab'; p.grabEnemy=e; p.grabT=180; p.grabSub='hold'; p.grabAnim=0;
    e.state='grabbed'; e.grabbedBy=1; e.vx=0; e.vz=0; e.z=0;
    let xm=1e9, xM=-1e9, ym=1e9, yM=-1e9, rm=1e9, rM=-1e9;
    for(let i=0;i<60;i++){ hitStop=0; slowmo=0; step(1);
      xm=Math.min(xm,e.x); xM=Math.max(xM,e.x);
      ym=Math.min(ym,e.strugY||0); yM=Math.max(yM,e.strugY||0);
      rm=Math.min(rm,e.strugR||0); rM=Math.max(rM,e.strugR||0); }
    if(!(xM-xm>1.5)) throw new Error('掴まれた敵が左右に暴れていない: 振れ幅'+(xM-xm).toFixed(2)+'px');
    if(!(yM-ym>1.5)) throw new Error('掴まれた敵が上下に暴れていない: 振れ幅'+(yM-ym).toFixed(2)+'px');
    if(!(rM-rm>0.03)) throw new Error('掴まれた敵が傾いていない: 振れ幅'+(rM-rm).toFixed(3)+'rad');
    if(e.z!==0) throw new Error('掴み中に z を上げている（敵側の重力と影が誤作動する）: z='+e.z);
    console.log('掴みの押さえ込み OK (左右'+(xM-xm).toFixed(1)+'px / 上下'+(yM-ym).toFixed(1)+'px / 傾き'+(rM-rm).toFixed(2)+'rad、z=0を維持)');
  }

  // ===== 10) PI2 を全周のつもりで使い直していないか =====
  // PI2=Math.PI/2 は四分の一回転。i/n*PI2 の形は全周のつもりの誤用（過去に4件あった）
  {
    if(Math.abs(PI2-Math.PI/2)>1e-9) throw new Error('PI2 が四分の一回転でなくなっている: '+PI2);
    if(Math.abs(TAU-Math.PI*2)>1e-9) throw new Error('TAU が一周でなくなっている: '+TAU);
    const srcs=[cutFireworksBursts, drawGatlingGun, drawTitleAurora];
    srcs.forEach(function(fn){
      const t=fn.toString();
      if(t.indexOf('PI2')>=0) throw new Error(fn.name+' が PI2 を使っている（全周なら TAU を使うこと）'); });
    console.log('PI2/TAU OK (全周を扱う描画は TAU を使っている)');
  }

  // ===== 11) ワッチの奥義は、何も奪っていなくても不発にならない =====
  {
    function stealSuper(mv, withStolen){
      setupRoster('watch'); startGame(); state='play';
      const p=players[0]; player=p; p.x=camX+360; p.facing=1; p.hp=p.maxHp=99999; p.dim=3; p.atkMul=1; p.level=1;
      p.stolen = withStolen ? [{name:'テスト技', col:'#fff', cast:function(){}}] : [];
      enemies.length=0; encounters.length=0; particles.length=0; projectiles.length=0;
      spawnEnemy('wolf', p.x+110, LANE); const e=enemies[0];
      e.hp=e.maxHp=999999; e.thinkCd=999999; e.poise=999999;
      const before=e.hp;
      beginAttack(mv);
      for(let i=0;i<160 && (p.state==='attack'||projectiles.length);i++){ hitStop=0; slowmo=0; step(1); }
      return before-e.hp; }
    const base0=stealSuper('wtech', false);
    const up0  =stealSuper('wtech2', false);
    if(!(base0>0)) throw new Error('奪いし奥義が、何も奪っていないと1ダメージも出ない（ゲージを使う技が不発）');
    if(!(up0>0))   throw new Error('二重奪取が、何も奪っていないと1ダメージも出ない');
    console.log('ワッチの奥義 OK (何も奪っていなくても 基本'+base0+' / 上位'+up0+'ダメージ)');
  }

  console.log('CRITIC FIX TEST PASSED'); process.exit(0);
})().catch(e=>{ console.error('FAIL:', e.message, e.stack); process.exit(1); });
`;
code = code + "\n;" + DRIVER;
(0, eval)(code);

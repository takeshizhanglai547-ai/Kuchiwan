global.__HTML = html;
const DRIVER = `
(async()=>{
  const step=(n)=>{ for(let i=0;i<n;i++){ if(global.rafCb){ const cb=global.rafCb; global.rafCb=null; cb(); } } };

  // ===== 1) 吹き飛ばされると宙へ運ばれ、受け身が取れる状態になる =====
  { setupRoster('inu'); startGame(); state='play';
    const p=players[0]; p.hp=p.maxHp=9999; p.invuln=0; p.z=0; p.state='idle'; p.lives=9;
    launchPlayer(p, 1, 4);
    if(p.state!=='down') throw new Error('吹き飛ばしで倒れ状態にならない（'+p.state+'）');
    if(!(p.z>0)) throw new Error('吹き飛ばしても宙へ上がらない（z='+p.z+'）');
    if(!(p.vz>0)) throw new Error('上向きの勢いが付いていない（vz='+p.vz+'）');
    if(!p.tumble) throw new Error('受け身の取れる吹き飛びになっていない');
    if(p.recovUsed) throw new Error('最初から受け身を使ったことになっている');
    console.log('吹き飛ばし OK (z='+Math.round(p.z)+'・vz='+p.vz.toFixed(1)+'・横'+p.vx.toFixed(1)+')'); }

  // ===== 2) 受け身は少し遅れてから取れる。取ると操作が戻り、一度きり =====
  { const setup=function(){ setupRoster('inu'); startGame(); state='play';
      const p=players[0]; p.hp=p.maxHp=9999; p.invuln=0; p.z=0; p.state='idle'; p.lives=9;
      p.in.keys={}; p.in.pressed.jump=false; launchPlayer(p, 1, 4); return p; };
    // 打ち上げ直後は取れない
    { const p=setup();
      for(let f=0;f<RECOV_LOCK-1;f++){ p.in.pressed.jump=true; step(1);
        if(p.state!=='down') throw new Error('打ち上げ直後（'+f+'F）に受け身が取れてしまう'); }
      console.log('受け身の待ち OK ('+RECOV_LOCK+'F は取れない)'); }
    // 待ったあとは取れる
    { const p=setup();
      for(let f=0;f<RECOV_LOCK+2;f++) step(1);
      if(p.state!=='down') throw new Error('待っている間に倒れ状態が終わっている（'+p.state+'）');
      const z0=p.z, iv0=p.invuln;
      p.in.pressed.jump=true; step(1);
      if(p.state!=='jump') throw new Error('受け身を取っても操作が戻らない（'+p.state+'）');
      if(!p.recovUsed) throw new Error('受け身を使ったことになっていない');
      if(p.tumble) throw new Error('受け身のあとも吹き飛び扱いのまま');
      if(!(p.invuln>=RECOV_INV-1)) throw new Error('受け身のあとに無敵が付かない（'+p.invuln+'）');
      if(!(p.vz>0)) throw new Error('受け身で立て直せていない（vz='+p.vz.toFixed(1)+'）');
      // 二度目は取れない（もう一度打ち上げるまで）
      const st=p.state; p.in.pressed.jump=true; step(1);
      if(p.recovUsed!==true) throw new Error('受け身の使用済みが消えている');
      console.log('受け身 OK (z='+Math.round(z0)+' で立て直し・無敵'+p.invuln+'F)'); }
    // 取らなければ落ちて起き上がる
    { const p=setup(); p.in.pressed.jump=false;
      let landed=-1;
      for(let f=0;f<400;f++){ p.in.pressed.jump=false; step(1);
        if(p.z<=0 && p.state!=='down'){ landed=f; break; } }
      if(landed<0) throw new Error('受け身を取らないと落ちてこない');
      if(p.tumble) throw new Error('着地しても吹き飛び扱いのまま');
      console.log('受け身なし OK ('+landed+'Fで着地して復帰)'); } }

  // ===== 3) 吹き飛ばし技を受けたときだけ宙へ運ばれる =====
  { setupRoster('inu'); startGame(); state='play';
    const p=players[0]; p.hp=p.maxHp=9999; p.lives=9;
    p.invuln=0; p.z=0; p.state='idle'; hurtPlayer(p, 10, 1, true, null, null, 0);
    if(p.z>0) throw new Error('普通の倒れで宙へ浮いている');
    if(p.tumble) throw new Error('普通の倒れが吹き飛び扱いになっている');
    p.invuln=0; p.z=0; p.state='idle'; hurtPlayer(p, 10, 1, true, null, null, 4);
    if(!(p.z>0 && p.tumble)) throw new Error('吹き飛ばし技でも宙へ運ばれない');
    console.log('技による使い分け OK (通常の倒れ＝その場／吹き飛ばし＝宙へ)'); }

  // ===== 3b) 本編でも、敵の倒れる一撃で吹き飛ばされる（受け身も取れる） =====
  { const hitBy=function(type, knock){
      setupRoster('inu'); startGame(); state='play'; hardMode=false;
      const p=players[0]; p.hp=p.maxHp=99999; p.lives=9; p.invuln=0; p.z=0; p.vz=0;
      p.state='idle'; p.atk=null; p.x=600; p._tx=null; p.facing=-1; p.guardStart=-999;
      enemies.length=0; spawnEnemy(type, p.x+40, p.y);
      const e=enemies[0]; e.facing=1; e.x=p.x-40;
      if(!hitOnePlayer(p, e, 12, knock, 200, 60)) throw new Error(type+' の攻撃が当たらない（測れていない）');
      return {z:p.z, vz:p.vz||0, vx:p.vx||0, tumble:!!p.tumble, state:p.state}; };
    // 倒れる一撃＝宙へ吹き飛ばされ、受け身が取れる状態になる
    const zk=hitBy('wolf', true);
    if(!(zk.z>0 && zk.vz>0)) throw new Error('本編の雑魚に倒されても宙へ上がらない（z='+Math.round(zk.z)+'）');
    if(!zk.tumble) throw new Error('本編の吹き飛びで受け身が取れない');
    if(zk.state!=='down') throw new Error('吹き飛びが倒れ状態になっていない（'+zk.state+'）');
    // 倒れない一撃＝その場でのけぞるだけ
    const soft=hitBy('wolf', false);
    if(soft.z>0) throw new Error('のけぞりだけの一撃でも宙へ浮いている');
    if(soft.tumble) throw new Error('のけぞりが吹き飛び扱いになっている');
    // 格が上の相手ほど強く飛ばす
    let bossType=null; for(const k in ETYPE) if(ETYPE[k].boss && !ETYPE[k].heroBoss){ bossType=k; break; }
    if(!bossType) throw new Error('ボスの型が見つからない（測れていない）');
    const bs=hitBy(bossType, true);
    if(!(bs.vz>zk.vz)) throw new Error('ボスの一撃が雑魚と同じだけしか飛ばさない（'+bs.vz.toFixed(1)+' vs '+zk.vz.toFixed(1)+'）');
    // 与ダメを揃えて比べる。揃えないと「ボスは元の攻撃力が高いから飛ぶ」だけを見てしまい、
    // 格による差が消えても気付けない
    { enemies.length=0; spawnEnemy('wolf', 600, LANE); const z1=enemies[0];
      enemies.length=0; spawnEnemy(bossType, 600, LANE); const b1=enemies[0];
      const pz=foeLaunchPow(z1, 20), pb=foeLaunchPow(b1, 20);
      if(!(pb>pz+0.5)) throw new Error('同じ与ダメだと格の差が出ない（雑魚 '+pz.toFixed(2)+' / ボス '+pb.toFixed(2)+'）'); }
    console.log('本編の吹き飛び OK (雑魚 vz'+zk.vz.toFixed(1)+'／'+ETYPE[bossType].name+' vz'+bs.vz.toFixed(1)+'／のけぞりは浮かない)'); }

  // ===== 3c) 本編で吹き飛ばされても受け身が取れ、画面の外へは運ばれない =====
  { setupRoster('inu'); startGame(); state='play';
    const p=players[0]; p.hp=p.maxHp=99999; p.lives=9; p.invuln=0; p.z=0;
    p.state='idle'; p.x=camX+60; p._tx=null; p.in.keys={}; p.in.pressed.jump=false;
    enemies.length=0; spawnEnemy('wolf', p.x+60, p.y);
    const e=enemies[0]; e.facing=-1; e.x=p.x+60;                 // 画面の左端へ向けて吹き飛ばす
    hitOnePlayer(p, e, 40, true, 200, 60);
    if(!p.tumble) throw new Error('吹き飛んでいない（測れていない）');
    let minGap=1e9;
    for(let f=0;f<RECOV_LOCK+2;f++){ step(1); const g=p.x-camX; if(g<minGap) minGap=g; }
    // 画面の外へは運ばれない（既存の x クランプが効いている。吹き飛びで抜けないことの確認）
    if(minGap<18) throw new Error('吹き飛びで画面の外（左端から '+Math.round(minGap)+'px）へ運ばれている');
    p.in.pressed.jump=true; step(1);
    if(p.state!=='jump') throw new Error('本編では受け身が取れない（'+p.state+'）');
    console.log('本編の受け身 OK (画面の左端から '+Math.round(minGap)+'px で止まり、跳躍で復帰)'); }

  // ===== 4) 対戦モードの土俵 =====
  { players[0].kind='inu'; players[1].kind='shima'; startVersus();
    if(!vsMode) throw new Error('対戦モードになっていない');
    if(!(players[0].active && players[1].active)) throw new Error('二人とも出場していない');
    if(players[0].kind==='shima'||players[1].kind==='inu') throw new Error('選んだキャラが入れ替わっている');
    if(!(players[0].vsStock===vsStockMax && players[1].vsStock===vsStockMax)) throw new Error('ストックが配られていない');
    if(enemies.length) throw new Error('対戦の土俵に敵が居る（'+enemies.length+'体）');
    if(encounters.length) throw new Error('対戦の土俵に遭遇が仕込まれている');
    if(!(PLATS.length>=2)) throw new Error('浮き床が '+PLATS.length+' 枚しかない');
    if(gimOn) throw new Error('対戦中も仕掛けが湧く設定のまま');
    if(!(Math.abs(players[0].x-players[1].x)>W*0.35)) throw new Error('二人が同じ場所から始まる');
    // 画面は動かさない
    players[0].x=W-40; updateCamera();
    if(camX!==0) throw new Error('対戦で画面が横に動いている（camX='+camX+'）');
    console.log('土俵 OK (床'+PLATS.length+'枚・ストック各'+vsStockMax+'・画面固定)'); }

  // ===== 5) 1Pの攻撃が2Pに当たる（自分には当たらない） =====
  { players[0].kind='inu'; players[1].kind='inu'; startVersus();
    const a=players[0], b=players[1];
    a.x=400; a._tx=null; a.z=0; a.facing=1; a.state='idle'; a.invuln=0;
    b.x=a.x+52; b._tx=null; b.z=0; b.facing=-1; b.state='idle'; b.invuln=0; b.guardStart=-999;
    const ah0=a.hp, bh0=b.hp;
    player=a; beginAttack('c4');
    for(let f=0;f<40;f++){ hitStop=0; slowmo=0; b.x=a.x+52; b.invuln=Math.min(b.invuln,0); step(1); }
    if(!(bh0-b.hp>0)) throw new Error('1Pの攻撃が2Pに当たらない');
    if(a.hp!==ah0) throw new Error('自分の攻撃で自分が減っている');
    console.log('近接 OK (2Pへ '+(bh0-b.hp)+' ダメージ／自分は無傷)'); }

  // ===== 6) ガードすれば防げる =====
  { players[0].kind='inu'; players[1].kind='inu'; startVersus();
    const a=players[0], b=players[1];
    const hit=function(guard){
      a.x=400; a._tx=null; a.z=0; a.facing=1; a.state='idle'; a.atk=null; a.invuln=0;
      b.x=452; b._tx=null; b.z=0; b.facing=-1; b.invuln=0; b.hp=b.maxHp;
      b.state=guard?'guard':'idle'; b.guardStart=-999;
      const h0=b.hp;
      player=a; beginAttack('c1');
      for(let f=0;f<20;f++){ hitStop=0; slowmo=0; b.x=452; b.invuln=0; if(guard) b.state='guard'; step(1); }
      return h0-b.hp; };
    const open=hit(false), gd=hit(true);
    if(!(open>0)) throw new Error('無防備でも当たらない（測れていない）');
    if(gd>0) throw new Error('ガードしても '+gd+' ダメージ通る');
    console.log('ガード OK (無防備 '+open+' → ガード '+gd+')'); }

  // ===== 7) 飛び道具は相手に当たり、撃った本人には当たらない =====
  { players[0].kind='nuko'; players[1].kind='nuko'; startVersus();
    const a=players[0], b=players[1];
    a.x=300; a._tx=null; a.z=0; a.facing=1; a.state='idle'; a.invuln=0;
    b.x=560; b._tx=null; b.z=0; b.facing=-1; b.state='idle'; b.invuln=0; b.guardStart=-999;
    const ah0=a.hp, bh0=b.hp;
    player=a; firePShot(a,{dmg:14,color:'#fff',speed:9,r:16,life:80});
    if(!projectiles.length) throw new Error('弾が出ていない');
    if(projectiles[0].pid!==a.pid) throw new Error('弾に撃った側のpidが入っていない（'+projectiles[0].pid+'）');
    for(let f=0;f<60;f++){ hitStop=0; slowmo=0; a.x=300; b.x=560; b.invuln=0; a.invuln=0; step(1); }
    if(!(bh0-b.hp>0)) throw new Error('弾が相手に当たらない');
    if(a.hp!==ah0) throw new Error('自分の弾が自分に当たっている（飛んでいく途中で）');
    // 自分の弾に自分から突っ込んでも当たらないこと。
    // 弾は前へ飛んでいくので、置いておくだけでは「たまたま離れた」だけになる
    projectiles.length=0; a.hp=a.maxHp; a.invuln=0; b.invuln=99999;
    player=a; firePShot(a,{dmg:14,color:'#fff',speed:9,r:16,life:80});
    const ah1=a.hp;
    for(let f=0;f<40;f++){ hitStop=0; slowmo=0; a.invuln=0;
      const pr=projectiles.filter(function(q){ return q.owner==='player'; })[0];
      if(pr){ a.x=pr.x; a._tx=null; a.y=pr.y; a.z=0; }   // 自分の弾に重なりに行く
      step(1); }
    if(a.hp!==ah1) throw new Error('自分の弾に重なると '+(ah1-a.hp)+' ダメージ受ける');
    console.log('飛び道具 OK (相手へ '+(bh0-b.hp)+' ダメージ／自分は無傷)'); }

  // ===== 8) HPが尽きるとストックが1つ減り、無くなると決着 =====
  { players[0].kind='inu'; players[1].kind='inu'; startVersus();
    const a=players[0], b=players[1];
    const s0=b.vsStock;
    b.invuln=0; b.hp=1; hurtPlayer(b, 999, 1, true, null, null, 0);
    if(b.vsStock!==s0-1) throw new Error('倒してもストックが減らない（'+s0+'→'+b.vsStock+'）');
    if(vsWinner>=0) throw new Error('まだストックが残っているのに決着している');
    // 復帰する
    let back=-1;
    for(let f=0;f<300;f++){ step(1); if(b.state!=='dead'){ back=f; break; } }
    if(back<0) throw new Error('ストックが残っているのに復帰しない');
    // 残りを削り切る
    for(let k=0;k<vsStockMax;k++){ b.invuln=0; b.state='idle'; b.hp=1; hurtPlayer(b, 999, 1, true, null, null, 0); }
    if(vsWinner!==0) throw new Error('ストックを使い切っても1Pの勝ちにならない（'+vsWinner+'）');
    // 待つとタイトルへ戻る
    for(let f=0;f<400 && vsMode; f++) step(1);
    if(vsMode) throw new Error('決着してもモードが終わらない');
    if(state!=='title') throw new Error('決着後にタイトルへ戻らない（'+state+'）');
    console.log('ストック OK ('+back+'Fで復帰／使い切ると1Pの勝ち→タイトルへ)'); }

  // ===== 9) タイトルからキャラを選んで対戦に入れる =====
  { const H2=global.__HTML||'';
    if(H2.indexOf('id="vsBtn"')<0) throw new Error('タイトルに対戦のボタンが無い');
    if(H2.indexOf("getElementById('vsBtn')")<0) throw new Error('対戦のボタンが配線されていない');
    startVsSelect();
    for(let f=0;f<80 && state!=='charsel'; f++) step(1);
    if(state!=='charsel') throw new Error('対戦のキャラ選択へ入れない（'+state+'）');
    if(csMode!=='vs') throw new Error('選択画面が対戦用になっていない（'+csMode+'）');
    // 1Pがワッチ、2Pがマックを選ぶ
    csSel=[CHARS.findIndex(function(c){return c.k==='watch';}), CHARS.findIndex(function(c){return c.k==='mack';})];
    csLock=[false,false];
    players[0].in.pressed.atk=true; players[1].in.pressed.atk=true;
    updateCharSel();
    if(!vsMode) throw new Error('二人とも決定したのに対戦が始まらない');
    if(players[0].kind!=='watch'||players[1].kind!=='mack')
      throw new Error('選んだキャラで始まっていない（'+players[0].kind+'/'+players[1].kind+'）');
    console.log('選択画面 OK (1P ワッチ／2P マックで開始)');
    endVersus(); }

  console.log('VERSUS TEST PASSED'); process.exit(0);
})().catch(e=>{ console.error('FAIL:', e.message, e.stack); process.exit(1); });
`;
code = code + "\n;" + DRIVER;
(0, eval)(code);

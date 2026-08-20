const DRIVER = `
(async()=>{
  const P=function(){ return players[0]; };
  const setup=function(){ sndOn=false; setupRoster('mack'); startGame();
    const p=players[0]; p.kind='mack'; resetPlayer(p,true); player=p;
    p.state='idle'; p.z=0; p.atk=null; p.invuln=0; p.sgCd=0; p.dim=3;
    enemies.length=0; projectiles.length=0; hazards.length=0; return p; };
  const dummyAt=function(dx,dy){ spawnEnemy('wolf', players[0].x+dx, players[0].y+(dy||0));
    const e=enemies[enemies.length-1]; e.hp=e.maxHp=4000; return e; };   // 硬くして与ダメを測る
  const run=function(p,n){ for(let f=0;f<n;f++){ updatePlayer(p); updateProjectiles(); } };
  // 銃口炎はマックの技がすべて通る。ここを差し替えれば「どの技が何発撃ったか」を実測できる
  const shots=function(fn){ const real=mackMuzzle; let n=0, dirs=[];
    mackMuzzle=function(p,dir,hy,col,c){ n++; dirs.push(dir); return real.apply(null,arguments); };
    try{ fn(); } finally { mackMuzzle=real; }
    return {n:n, dirs:dirs}; };

  // ===== 1) キャラとして登録されているか =====
  { if(!CHARS.some(function(c){ return c.k==='mack'; })) throw new Error('キャラ選択にマックが居ない');
    if(TRAIN_HERO.indexOf('mack')<0) throw new Error('トレーニングにマックが居ない');
    if(ATTRACT_KINDS.indexOf('mack')<0) throw new Error('アトラクトにマックが居ない');
    if(!HERO_BOSS_OF.mack || !ETYPE[HERO_BOSS_OF.mack]) throw new Error('腕試しのマックが居ない');
    if(!VOICE.mack) throw new Error('マックの声が無い');
    if(!ULT_NAME.mack) throw new Error('マックの奥義名が無い');
    if(!CRIT_ART.mack) throw new Error('マックの致命の一撃が無い');
    if(!DUEL_LINE.mack) throw new Error('マックの腕試しの口上が無い');
    if(heroNameOf('mack')==='聖犬士イッヌ') throw new Error('マックの表示名がイッヌのまま');
    if(!Object.keys(CHARMS).some(function(k){ return CHARMS[k].who==='mack'; })) throw new Error('マックのお守りが無い');
    console.log('マックの登録 OK (選択画面／トレモ／アトラクト／腕試し／声／奥義名／致命／お守り)'); }

  // ===== 2) リボルバーは6発で弾切れ、次の入力がリロードになる =====
  { const p=setup(); dummyAt(90);
    if(p.ammo!==MK_AMMO) throw new Error('初期弾数が '+p.ammo);
    const ids=[];
    for(let k=1;k<=MK_AMMO;k++){ const id=comboMoveFor(p,k); ids.push(id);
      p.state='idle'; p.atk=null; beginAttack(id); run(p, ATK[id].dur+2); }
    if(p.ammo!==0) throw new Error(MK_AMMO+'発撃っても弾が '+p.ammo+' 残っている');
    if(new Set(ids).size!==MK_AMMO) throw new Error('6連射が同じ技の繰り返しになっている');
    // 弾切れのまま撃つとリロードへ。攻撃ボタンを1回押して確かめる
    p.state='idle'; p.atk=null; p.in.pressed.atk=true; updatePlayer(p);
    if(!p.atk || !p.atk.def.reload) throw new Error('弾切れなのにリロードに入らない（'+(p.atk?p.atk.def.name:'技なし')+'）');
    const rd=ATK.mkReload.dur;
    run(p, rd+2);
    if(p.ammo!==MK_AMMO) throw new Error('リロードしても弾が '+p.ammo);
    if(rd<24) throw new Error('リロードの隙が短すぎる（'+rd+'F）');
    console.log('リボルバーとリロード OK (6連射で弾切れ→リロード'+rd+'F→'+MK_AMMO+'発回復)'); }

  // ===== 3) コマンド技7枠が全部つながっていて、全部ダメージを出す =====
  { const seen={};
    for(const slot of SPECIAL_SLOTS){
      const base=SPECIAL_BASE.mack[slot];
      if(!base || !ATK[base]) throw new Error(slot+' の技が無い: '+base);
      const up=(SPECIAL_UP.mack[slot]||[]).map(function(u){ return u[1]; });
      if(!up.length) throw new Error(slot+' に上位技が無い');
      for(const u of up) if(!ATK[u]) throw new Error(slot+' の上位技 '+u+' が ATK に無い');
      for(const id of [base].concat(up)){
        if(seen[id]) throw new Error(id+' が2つの枠で使い回されている');
        seen[id]=1;
        // グレネードランチャーは割れるまで当たらない（信管が入らない）ので
        // 最低射程がある。その技だけ的を遠くに置く
        const p=setup(); const e=dummyAt(ATK[id].mkGL? 230 : 70); const hp0=e.hp;
        beginAttack(id);
        // 押しっぱなしの技（火炎放射器）は握っていないと1フレームで止まる
        for(let f=0;f<ATK[id].dur+140;f++){ p.in.K.atk=(p.state==='mkflame');
          updatePlayer(p); updateProjectiles(); }
        p.in.K.atk=false;
        const dmg=hp0-e.hp;
        if(dmg<=0) throw new Error(id+'（'+ATK[id].name+'）が一度も当たらない'); } }
    console.log('コマンド技7枠 OK (基本7＋上位7＝14技すべて命中する)'); }

  // ===== 4) ショットガンは近いほど痛い（射程は短い） =====
  { const at=function(dx){ const p=setup(); const e=dummyAt(dx); const hp0=e.hp;
      beginAttack('mkShotgun'); run(p, ATK.mkShotgun.dur+60); return hp0-e.hp; };
    const near=at(20), mid=at(120), far=at(480);
    // 散弾そのものは中距離でも当たる。「鼻先だと束で入る」ぶんが乗っているかを見る
    if(near < mid*1.35) throw new Error('鼻先('+Math.round(near)+')と中距離('+Math.round(mid)+')が変わらない＝至近の束撃ちが乗っていない');
    if(far>0) throw new Error('遠距離('+Math.round(far)+')まで届いている＝ショットガンの落ち方になっていない');
    // 届く距離を実測する。160px→480px と伸ばしてなお「まだ短い」と言われたので、
    // 画面のほぼ端まで届く長さを保つ
    let reach=0; for(let d=40; d<=520; d+=20){ if(at(d)>0) reach=d; }
    if(reach<300) throw new Error('ショットガンの射程が短い（'+reach+'px／300px以上ほしい）');
    if(reach>460) throw new Error('ショットガンの射程が長すぎる（'+reach+'px／460px以下に）');
    // 粒が全部同じ寿命だと遠くでも8発まとまって当たり、遠距離が平らになる。
    // 中距離と比べるだけでは見抜けない（寿命を揃える改変が素通りした）ので、
    // 遠距離どうしを突き合わせて「奥へ行くほど当たる粒が減る」ことを見る
    const midFar=at(220), longFar=at(340);
    if(!(midFar>0 && midFar < mid*0.75))
      throw new Error('距離で減っていない（中距離'+Math.round(mid)+' → 220px '+Math.round(midFar)+'）');
    if(!(longFar>0 && longFar < midFar*0.6))
      throw new Error('遠距離が平らなまま（220px '+Math.round(midFar)+' → 340px '+Math.round(longFar)+'）');
    console.log('ショットガン OK (鼻先 '+Math.round(near)+' / 120px '+Math.round(mid)+' / 220px '+Math.round(midFar)
      +' / 340px '+Math.round(longFar)+' / 届く距離 '+reach+'px ＝鼻先は'+(mid>0?(near/mid).toFixed(2):'∞')+'倍)'); }

  // ===== 5) バズーカは1発で複数の敵を巻き込む =====
  { const p=setup(); const es=[dummyAt(240,-18), dummyAt(268,0), dummyAt(296,18)];
    const hp0=es.map(function(e){ return e.hp; });
    const sh=shots(function(){ beginAttack('mkBazooka'); run(p, ATK.mkBazooka.dur+80); });
    const hit=es.filter(function(e,i){ return hp0[i]-e.hp>0; }).length;
    if(sh.n!==1) throw new Error('バズーカが1発で撃ち終わっていない（'+sh.n+'発）');
    if(hit<3) throw new Error('バズーカの爆発が '+hit+' 体しか巻き込んでいない');
    if(ATK.mkBazooka.dur<40) throw new Error('バズーカに構えが無い（'+ATK.mkBazooka.dur+'F）');
    console.log('バズーカ OK (1発・構え'+ATK.mkBazooka.dur+'F・爆発で'+hit+'体巻き込み)'); }

  // ===== 6) 掴み技4種が別物で、それぞれ効く =====
  { const got={};
    for(const mv of ['gun','rocket','buson','drill']){
      const p=setup(); const e=dummyAt(36); const hp0=e.hp;
      beginMackThrow(e,mv);
      if(p.state!=='mthrow') throw new Error(mv+' で掴み技のステートに入らない');
      run(p, 90);
      got[mv]=hp0-e.hp;
      if(got[mv]<=0) throw new Error('掴み技 '+mv+' が当たらない');
      if(p.state!=='idle') throw new Error('掴み技 '+mv+' が終わらない（state='+p.state+'）'); }
    // ゼロ距離早撃ちは6発。銃口炎の回数で実測する
    { const p=setup(); const e=dummyAt(36);
      const sh=shots(function(){ beginMackThrow(e,'gun'); run(p,90); });
      if(sh.n!==6) throw new Error('ゼロ距離早撃ちが '+sh.n+' 発（6発のはず）'); }
    // ロケットは範囲。掴んでいない別の敵も巻き込む
    { const p=setup(); const e=dummyAt(36); const other=dummyAt(120); const oh=other.hp;
      beginMackThrow(e,'rocket'); run(p,90);
      if(oh-other.hp<=0) throw new Error('ロケットの爆発が周りを巻き込まない'); }
    // ドリルは直線上の別の敵も巻き込む
    { const p=setup(); const e=dummyAt(36); const other=dummyAt(150); const oh=other.hp;
      beginMackThrow(e,'drill'); run(p,90);
      if(oh-other.hp<=0) throw new Error('ドリル突進が直線上の敵を巻き込まない'); }
    console.log('掴み技 OK (早撃ち6射'+Math.round(got.gun)+'／ロケット'+Math.round(got.rocket)
      +'／背負い投げ'+Math.round(got.buson)+'／ドリル'+Math.round(got.drill)+'・巻き込みあり)'); }

  // ===== 7) Fireworks は連打した回数だけ乱射が伸びる =====
  { const fire=function(mash){ const p=setup(); dummyAt(90);
      const sh=shots(function(){ beginFireworks(p);
        for(let f=0;f<220;f++){ if(mash && f>=FW_DRINK && f<FW_DRINK+40 && f%4===0) p.in.pressed.atk=true;
          updatePlayer(p); updateProjectiles(); } });
      return {shots:p.fwShots, muzzle:sh.n, state:p.state}; };
    const a=fire(false), b=fire(true);
    if(a.shots<=0) throw new Error('Fireworks が一度も撃たない');
    if(b.shots<=a.shots) throw new Error('連打しても乱射が伸びない（'+a.shots+'→'+b.shots+'）');
    if(a.state!=='idle') throw new Error('Fireworks が終わらない');
    console.log('Fireworks OK (連打なし '+a.shots+'射 → 連打あり '+b.shots+'射)'); }

  // ===== 8) 空中技3種が別物 =====
  { const air=function(key,mash){ const p=setup();
      const e=dummyAt(key==='down'?30:120, 0); const hp0=e.hp;
      projectiles.length=0; p.state='jump'; p.z=(key==='up'?120:150); p.vz=0; p.jAtk=0; p.jUpUsed=false; p.ammo=MK_AMMO;
      p.in.K.up=(key==='up'); p.in.K.down=(key==='down'); p.in.pressed.atk=true;
      updatePlayer(p);
      const tag=p.jMkUp?'up':p.jMkDown?'down':p.jMkFire?'fwd':'other';
      const z0=p.z, ez0=e.z; let zMax=p.z, ezMax=e.z, shots=0, blast=0;
      // 数えるのは「いま試している技が出ている間」だけ。技が切れたあとの
      // 連打は別の空中技（前へのリボルバー）を出すので、それを数えると
      // 「連打で伸びた」ことにならない
      blast=projectiles.filter(function(q){ return q.blast; }).length;   // 空中↑は爆発する弾を投げる
      const onNow=function(){ return !!(key==='up'? p.jMkUp : key==='down'? p.jMkDown : p.jMkFire); };
      const realM=mackMuzzle; mackMuzzle=function(){ if(onNow()) shots++; return realM.apply(null,arguments); };
      try{ for(let f=0;f<160;f++){
        p.in.K.up=p.in.K.down=false;            // 方向を離す。押しっぱなしだと技が終わるたび出し直され、
                                                 // 「連打で伸びた」のか「2回出した」のか区別できない
        if(mash && f%4===0) p.in.pressed.atk=true;
        // 敵側の物理も回す。回さないと「刃に乗せて一緒に持ち上げる」が効かず、
        // 置き去りにした敵に当たらないだけの結果になる
        updatePlayer(p); updateEnemies(); updateProjectiles();
        if(p.z>zMax) zMax=p.z; if(e.z>ezMax) ezMax=e.z; } }
      finally { mackMuzzle=realM; }
      p.in.K.up=p.in.K.down=false;
      return {tag:tag, dmg:hp0-e.hp, rise:zMax-z0, eRise:ezMax-ez0, ammo:p.ammo, shots:shots, blast:blast}; };
    const u=air('up'), d=air('down'), f=air('fwd');
    if(u.tag!=='up')   throw new Error('空中↑がマック専用の技になっていない（'+u.tag+'）');
    if(d.tag!=='down') throw new Error('空中↓がマック専用の技になっていない（'+d.tag+'）');
    if(f.tag!=='fwd')  throw new Error('空中前がマック専用の技になっていない（'+f.tag+'）');
    for(const q of [['↓',d],['前',f]]) if(q[1].dmg<=0) throw new Error('空中'+q[0]+'が当たらない');
    // 空中では弾倉を減らさない（空中でリロードできないため）
    for(const q of [['↑',u],['↓',d],['前',f]]) if(q[1].ammo!==MK_AMMO)
      throw new Error('空中'+q[0]+'で弾倉が減っている（'+q[1].ammo+'）');
    // 空中↑は「構えてから指定した向きへ突進する」技。何も入れなければ前斜め上
    if(u.rise<50) throw new Error('空中↑で突進していない（上昇 '+Math.round(u.rise)+'px）');
    // 空中↓は連打で乱射が伸びる
    const dm=air('down',true);
    if(dm.shots<=d.shots) throw new Error('空中↓を連打しても撃つ回数が伸びない（'+d.shots+'→'+dm.shots+'）');
    console.log('空中技 OK (前リボルバー'+Math.round(f.dmg)+'／↑ドリルダッシュ '+Math.round(u.rise)+'px・'+Math.round(u.dmg)
      +'／↓乱射 連打なし'+d.shots+'発→連打あり'+dm.shots+'発・弾倉は減らない)'); }

  // ===== 9) 奥義「絨毯爆撃」：爆撃機とドローンを呼び、画面全体を焼く =====
  { const raid=function(mash){ const p=setup(); p.dim=3;
      enemies.length=0; projectiles.length=0;
      // 画面の左端・中央・右端に置く。「画面全体」に届くかを見たいので広く散らす
      for(let k=0;k<6;k++){ const e=dummyAt(-60+k*160, ((k%3)-1)*14); e.hp=e.maxHp=99999; }
      const hp0=enemies.map(function(e){ return e.hp; });
      p.state='idle'; p.z=0; p.atk=null;
      beginMackRaid(p);
      let frames=0, bombs=0, sawBomber=false, drN=0, bxMin=1e9, bxMax=-1e9;
      const seen=new Set();
      for(let f=0;f<420;f++){ if(mash && f%20===0) p.in.pressed.atk=true;
        updatePlayer(p); updateEnemies(); updateProjectiles();
        if(p.bomber){ sawBomber=true;                       // 爆撃機が画面を横切ること
          if(p.bomber.sx<bxMin) bxMin=p.bomber.sx; if(p.bomber.sx>bxMax) bxMax=p.bomber.sx; }
        if(p.drones) drN=Math.max(drN, p.drones.length);
        for(const q of projectiles){ if(seen.has(q))continue; seen.add(q); bombs++; }
        if(p.state==='mkraid') frames++; }
      p.in.pressed.atk=false;
      const hit=enemies.filter(function(e,i){ return hp0[i]-e.hp>0; }).length;
      return {frames:frames, bombs:bombs, n:p.raidN|0, hit:hit, total:enemies.length,
              bomber:sawBomber, run:(bxMax>bxMin? bxMax-bxMin : 0), drone:drN, state:p.state,
              dmg:enemies.reduce(function(a,e,i){ return a+(hp0[i]-e.hp); },0)}; };
    const a=raid(false), b=raid(true);
    if(ULT_NAME.mack!=='絨毯爆撃') throw new Error('奥義の名前が変わっていない: '+ULT_NAME.mack);
    if(!a.bomber) throw new Error('爆撃機が来ていない');
    if(a.drone<2) throw new Error('ドローンが '+a.drone+' 機しか来ていない');
    // 爆撃機が動かなければ、同じ場所に落とすだけで「絨毯」にならない
    if(a.run<400) throw new Error('爆撃機が画面を横切っていない（移動 '+Math.round(a.run)+'px）');
    if(a.bombs<20) throw new Error('投下数が '+a.bombs+' 発しかない');
    // 画面の端から端まで届くこと。1体でも取り残したら「絨毯」ではない
    if(a.hit<a.total) throw new Error('画面全体を焼けていない（'+a.hit+'/'+a.total+'体）');
    // 連打で増援と爆撃が伸びる
    if(b.n<1) throw new Error('連打で増援が来ない');
    if(b.drone<=a.drone) throw new Error('連打してもドローンが増えない（'+a.drone+'→'+b.drone+'機）');
    if(b.frames<=a.frames) throw new Error('連打しても爆撃が長引かない（'+a.frames+'F→'+b.frames+'F）');
    if(b.bombs<=a.bombs) throw new Error('連打しても投下数が増えない（'+a.bombs+'→'+b.bombs+'）');
    // 必ず終わる（呼びっぱなしにならない）
    if(a.state==='mkraid') throw new Error('爆撃が終わらない');
    console.log('奥義 絨毯爆撃 OK (連打なし '+a.frames+'F・'+a.bombs+'発・'+a.hit+'/'+a.total
      +'体に命中 → 連打あり '+b.frames+'F・'+b.bombs+'発・増援×'+b.n+')'); }

  // ===== 10) 後ろ前＝溜めてから正面へ突き出す単発のパイルバンカー（吹き飛ばし付き） =====
  { // ヒット数は damageEnemy を横取りして数える。与ダメの合計から割り戻すと
    // 「1発の威力」を技表から取ることになり、multi を足す改変を素通りさせる
    const pile=function(id, dist){ const p=setup(); const e=dummyAt(dist==null?180:dist);
      const x0=e.x, px0=p.x;
      let first=-1, hits=0, air=false, zmax=0, mx=0, gear='', held=0, f=0;
      const real=damageEnemy;
      damageEnemy=function(tgt){ if(tgt===e){ hits++; if(first<0) first=f; } return real.apply(null,arguments); };
      try{ beginAttack(id);
        for(f=0; f<120; f++){
          if(p.state==='attack' && p.atk && p.atk.def===ATK[id]){
            if(p.atk.hold>0) held++;
            gear=mackGear(p); }
          updatePlayer(p); updateEnemies(); updateProjectiles();
          // 当たるまでは的を動かさない。歩いて寄って来られると、間合いを縮める改変を
          // 「溜めている間に敵が近づいたから当たった」で素通ししてしまう
          if(first<0){ e.x=x0; e.vx=0; }
          if(e.state==='air'||e.state==='blastoff') air=true;   // 16%の確率で星KOに化けるので両方見る
          if(e.z>zmax) zmax=e.z;
          const d=Math.abs(e.x-x0); if(d>mx) mx=d; }
      } finally { damageEnemy=real; }
      return {first:first, hits:hits, air:air, z:Math.round(zmax), mx:Math.round(mx),
              gear:gear, held:held, dmg:Math.round(4000-e.hp), walk:Math.round(Math.abs(p.x-px0))}; };

    const a=pile('mkPileB');
    // 単発であること
    if(a.hits!==1) throw new Error('単発のはずが '+a.hits+' ヒットしている');
    // 溜めてから出ること。構えのフレームが実在し、当たるのも十分あとになる
    if(a.held<8) throw new Error('溜めの構えが '+a.held+'F しかない');
    if(a.first<18) throw new Error('溜めずに '+a.first+'F で当たっている');
    // 突進ではなく「その場で突き出す」。マックが敵まで走っていってはいけない
    if(a.walk>24) throw new Error('突き出しではなく '+a.walk+'px 突進している');
    // 正面へ届くこと（180px 先で動かない的に当たっている）
    if(a.dmg<=0) throw new Error('正面180pxの敵に当たらない（間合いが足りない）');
    // 吹き飛ばし属性。打ち出した敵が浮いて、画面の端まで飛ぶ
    if(!a.air) throw new Error('当てても敵が浮かない（吹き飛ばし属性が無い）: '+JSON.stringify(a));
    if(a.z<40) throw new Error('吹き飛びの高さが '+a.z+'px しかない');
    if(a.mx<400) throw new Error('吹き飛ばした距離が '+a.mx+'px しかない');
    // 握っている得物が杭打ち機であること（ここを見ないと絵だけリボルバーのままになる）
    if(a.gear!=='pile') throw new Error('杭打ち機ではなく '+(a.gear||'なし')+' を握っている');

    // Lv12 の上位技。基本技より重く、こちらも単発のまま
    const b=pile('mkPileB2');
    if(b.hits!==1) throw new Error('上位技が '+b.hits+' ヒットになっている');
    if(b.dmg<=a.dmg) throw new Error('上位技が重くない（'+a.dmg+' → '+b.dmg+'）');
    { const p=setup(); p.level=12;
      if(specialFor(p,'dash')!=='mkPileB2') throw new Error('Lv12で上位技に差し替わらない（'+specialFor(p,'dash')+'）');
      p.level=1;
      if(specialFor(p,'dash')!=='mkPileB') throw new Error('Lv1のダッシュ枠が '+specialFor(p,'dash')); }

    // タメ攻撃はドリル突進のまま。杭に置き換わって使い分けが消えていないこと
    const c=pile('mkCharge');
    if(c.hits<3) throw new Error('タメのドリルが多段でなくなっている（'+c.hits+'ヒット）');
    if(c.gear!=='drill') throw new Error('タメ攻撃の得物が '+(c.gear||'なし')+'（ドリルのはず）');

    // 入力から辿る。後ろ→前と入れて攻撃を押したら杭が出ること。
    // ここを見ないと「技表では杭だが、実際に押すと別の技」を取り逃がす
    { const p=setup(); enemies.length=0; p.facing=1; p.x=200;
      p.in.cardSeq.length=0;
      p.in.cardSeq.push({c:3, f:gf-6});      // 後ろ（左）
      p.in.cardSeq.push({c:1, f:gf-2});      // 前（右）
      p.in.pressed.atk=true; updatePlayer(p);
      if(!(p.state==='attack' && p.atk && p.atk.def.pileB))
        throw new Error('後ろ前＋攻撃で杭が出ない（'+(p.atk?p.atk.def.name:p.state)+'）'); }
    console.log('後ろ前のパイルバンカー OK (溜め'+a.held+'F→'+a.first+'F で単発命中／その場で'+a.walk
      +'px／'+a.z+'px 浮かせて'+a.mx+'px 吹き飛ばし／上位技 '+a.dmg+'→'+b.dmg+'）'); }

  // ===== 11) リボルバーの6発目だけが吹き飛ばす =====
  { const shot=function(id){ const p=setup(); const e=dummyAt(90);
      projectiles.length=0; p.ammo=MK_AMMO; p.state='idle'; p.z=0; p.atk=null;
      const hp0=e.hp; let zMax=0;
      beginAttack(id);
      for(let f=0;f<70;f++){ updatePlayer(p); updateEnemies(); updateProjectiles(); if(e.z>zMax) zMax=e.z; }
      return {dmg:hp0-e.hp, up:zMax, air:(e.state==='air')}; };
    const a1=shot('mk1'), a6=shot('mk6');
    if(a1.dmg<=0||a6.dmg<=0) throw new Error('リボルバーが当たらない');
    if(a1.up>4) throw new Error('1発目まで敵を浮かせている（'+Math.round(a1.up)+'px）＝6発目の特別さが無い');
    if(a6.up<30) throw new Error('6発目が敵を吹き飛ばしていない（'+Math.round(a6.up)+'px）');
    if(a6.dmg<=a1.dmg) throw new Error('6発目が1発目より軽い');
    console.log('6発目の吹き飛ばし OK (1発目 '+Math.round(a1.dmg)+'・浮き'+Math.round(a1.up)
      +'px ／ 6発目 '+Math.round(a6.dmg)+'・浮き'+Math.round(a6.up)+'px)'); }

  // ===== 12) 下攻撃の火炎放射器は、押している間だけ吹き続ける =====
  { const burn=function(hold){ const p=setup(); const e=dummyAt(70); const hp0=e.hp;
      p.state='idle'; p.z=0; p.atk=null;
      p.in.K.down=true; p.in.K.atk=true; p.in.pressed.atk=true;
      updatePlayer(p); p.in.K.down=false;
      let frames=0;
      for(let f=0;f<300;f++){ if(f>=hold) p.in.K.atk=false;
        updatePlayer(p); updateEnemies(); updateProjectiles();
        if(p.state==='mkflame' && (p.flOut|0)<=0) frames++; }
      p.in.K.atk=false;
      return {frames:frames, dmg:hp0-e.hp, state:p.state}; };
    const D=ATK[SPECIAL_BASE.mack.down];
    if(!D || !D.flame) throw new Error('下攻撃が火炎放射器になっていない: '+SPECIAL_BASE.mack.down);
    const shortB=burn(6), longB=burn(400);
    if(shortB.frames<=0) throw new Error('火炎放射器が一度も吹かない');
    if(longB.frames < shortB.frames*3) throw new Error('押しっぱなしでも伸びない（'+shortB.frames+'F→'+longB.frames+'F）');
    if(longB.dmg < shortB.dmg*3) throw new Error('押しっぱなしでも与ダメが伸びない（'+Math.round(shortB.dmg)+'→'+Math.round(longB.dmg)+'）');
    // 無限には吹けない。燃料を使い切れば必ず止まって隙になる
    if(longB.frames > D.flDur+2) throw new Error('燃料の上限を超えて吹き続けている（'+longB.frames+'F）');
    // 「idle に戻る」まで見ると、敵に殴られて hurt になっただけで落ちる。
    // 確かめたいのは「吹きっぱなしにならない」ことだけ
    if(longB.state==='mkflame') throw new Error('火炎放射器が終わらない（吹きっぱなし）');
    // 焼いた敵はしばらく延焼する
    { const p=setup(); const e=dummyAt(70);
      p.in.K.down=true; p.in.K.atk=true; p.in.pressed.atk=true; updatePlayer(p); p.in.K.down=false;
      for(let f=0;f<24;f++){ updatePlayer(p); updateProjectiles(); }
      p.in.K.atk=false;
      if(!(e.burnT>0)) throw new Error('火炎放射器を浴びても延焼しない');
      const h1=e.hp; for(let f=0;f<40;f++) updateEnemies();
      if(e.hp>=h1) throw new Error('延焼中なのに減っていない'); }
    console.log('火炎放射器 OK (すぐ離す '+shortB.frames+'F/'+Math.round(shortB.dmg)+' → 押しっぱなし '
      +longB.frames+'F/'+Math.round(longB.dmg)+'・燃料'+D.flDur+'Fで打ち止め・延焼あり)'); }


  // ===== 13) 空中↑のドリルダッシュは、構えの間に指定した向きへ飛ぶ =====
  { const dash=function(keys, tgt){ const p=setup();
      let e=null;
      if(tgt){ e=dummyAt(tgt.dx, 0); e.z=tgt.z||0; }
      p.state='jump'; p.z=200; p.vz=0; p.jAtk=0; p.facing=1;
      p.in.K.up=true; p.in.pressed.atk=true; updatePlayer(p);   // ↑＋攻撃で構えに入る
      p.in.K.up=false;
      // 構えの間に向きを指定し直す
      for(const kk of Object.keys(keys)) p.in.K[kk]=keys[kk];
      const x0=p.x, z0=p.z; const hp0=e?e.hp:0;
      for(let f=0;f<70;f++){ updatePlayer(p); updateEnemies(); updateProjectiles(); }
      for(const kk of Object.keys(keys)) p.in.K[kk]=false;
      return {dx:p.x-x0, dz:z0-p.z, dmg:e?(hp0-e.hp):0}; };
    // 何も入れなければ前斜め上
    const upF=dash({}, null);
    if(!(upF.dx>60)) throw new Error('既定の向きで前へ進んでいない（'+Math.round(upF.dx)+'px）');
    // 前斜め下：地上の敵へ突っ込める
    const dnF=dash({down:true,right:true}, {dx:150, z:0});
    if(!(dnF.dx>60)) throw new Error('前斜め下で前へ進んでいない（'+Math.round(dnF.dx)+'px）');
    if(dnF.dmg<=0) throw new Error('前斜め下のドリルダッシュが地上の敵に当たらない');
    // 後ろ：来た方向へ引き返せる
    const back=dash({left:true}, null);
    if(!(back.dx<-60)) throw new Error('後ろ入力で後ろへ進んでいない（'+Math.round(back.dx)+'px）');
    // 向きで行き先が変わっていること（同じ所へ飛ぶなら「指定」になっていない）
    if(!(upF.dx-back.dx>200)) throw new Error('前と後ろで行き先が変わらない');
    console.log('ドリルダッシュ OK (既定 前へ'+Math.round(upF.dx)+'px／前斜め下 '+Math.round(dnF.dx)
      +'px・地上の敵に'+Math.round(dnF.dmg)+'／後ろ '+Math.round(back.dx)+'px)'); }

  // ===== 14) 銃とバズーカは専用の発射音・爆発音で鳴る =====
  { const SND=['gun','shotgun','rifle','launch','blast'];
    for(const k of SND) if(typeof sfx[k]!=='function') throw new Error('専用の音が無い: sfx.'+k);
    // どの技がどの音を鳴らしたかを、実際に呼ばれた関数で拾う
    const listen=function(fn){ const real={}, log=[];
      for(const k of SND){ real[k]=sfx[k]; (function(kk){ sfx[kk]=function(x,v){ log.push({k:kk, v:(v==null?1:v)}); }; })(k); }
      try{ fn(); } finally { for(const k of SND) sfx[k]=real[k]; }
      return log; };
    const fire=function(id,frames){ const p=setup(); dummyAt(70);
      p.ammo=MK_AMMO; p.state='idle'; p.z=0; p.atk=null;
      return listen(function(){ beginAttack(id);
        for(let f=0;f<(frames||ATK[id].dur+80);f++){ updatePlayer(p); updateProjectiles(); } }); };
    const kindsOf=function(log){ const o={}; for(const e of log) o[e.k]=(o[e.k]||0)+1; return o; };
    // リボルバー：1〜5発目と6発目で音の重さが変わる
    { const a=fire('mk1'), b=fire('mk6');
      if(!kindsOf(a).gun) throw new Error('リボルバーが銃声で鳴っていない '+JSON.stringify(kindsOf(a)));
      if(!kindsOf(b).gun) throw new Error('6発目が銃声で鳴っていない');
      const va=a.filter(function(e){return e.k==='gun';})[0].v, vb=b.filter(function(e){return e.k==='gun';})[0].v;
      if(!(vb>va)) throw new Error('6発目の銃声が1発目と同じ重さ（'+va+' / '+vb+'）'); }
    // ショットガン／ライフル／バズーカ
    { const k=kindsOf(fire('mkShotgun')); if(!k.shotgun) throw new Error('ショットガンが専用音で鳴っていない '+JSON.stringify(k)); }
    { const k=kindsOf(fire('mkSnipe'));   if(!k.rifle)   throw new Error('ライフル狙撃が専用音で鳴っていない '+JSON.stringify(k)); }
    { const k=kindsOf(fire('mkBazooka',ATK.mkBazooka.dur+120));
      if(!k.launch) throw new Error('バズーカが発射音で鳴っていない '+JSON.stringify(k));
      if(!k.blast)  throw new Error('バズーカの着弾が爆発音で鳴っていない '+JSON.stringify(k)); }
    // 手榴弾も爆発音
    { const k=kindsOf(fire('mkGrenade',ATK.mkGrenade.dur+140));
      if(!k.blast) throw new Error('手榴弾が爆発音で鳴っていない '+JSON.stringify(k)); }
    // 電撃の流用（zap）に戻っていないこと：主要な銃技はすべて銃系の音を出す
    for(const id of ['mk1','mkShotgun','mkGL','mkSnipe','mkBazooka']){
      const k=kindsOf(fire(id));
      if(!(k.gun||k.shotgun||k.rifle||k.launch)) throw new Error(id+' が銃系の音を鳴らしていない'); }
    // 敵側：鉄砲兵は銃声、大筒足軽は砲声
    { const shoot=function(ty){ const p=setup(); enemies.length=0;
        spawnEnemy(ty, p.x+200, p.y); const e=enemies[0];
        // 射撃の状態へ直接入れる。AIが撃つ気になるまで待つと、
        // 出現位置や乱数で撃たないまま終わって「音が無い」と誤判定する
        e.state='gunFire'; e.gunT=8; e.facing=-1;
        return listen(function(){ for(let f=0;f<6;f++){ gf++; updateEnemies(); updateProjectiles(); } }); };
      const t1=kindsOf(shoot('teppo')), t2=kindsOf(shoot('ozutsu'));
      if(!t1.rifle) throw new Error('鉄砲兵が銃声で鳴っていない '+JSON.stringify(t1));
      if(!t2.launch) throw new Error('大筒足軽が砲声で鳴っていない '+JSON.stringify(t2)); }
    console.log('銃とバズーカの音 OK (リボルバー／6発目は重く／ショットガン／ライフル／バズーカ発射＋着弾爆発／手榴弾／鉄砲兵・大筒足軽)'); }

  // ===== 15) 波動コマンドはグレネードランチャー。レベルで弾種が変わり効果も別 =====
  { const p0=setup();
    const tiers=[];
    for(const lv of [1,6,12]){ p0.level=lv; const id=specialFor(p0,'hadou');
      if(!ATK[id]) throw new Error('Lv'+lv+' の波動技が ATK に無い: '+id);
      if(!ATK[id].mkGL) throw new Error('Lv'+lv+' の波動技がグレネードランチャーでない: '+ATK[id].name);
      tiers.push({lv:lv, id:id, kind:ATK[id].mkGL}); }
    p0.level=1;
    const kinds=tiers.map(function(t){ return t.kind; });
    if(new Set(kinds).size!==3) throw new Error('弾種が3つに分かれていない: '+kinds.join('/'));
    if(kinds.indexOf('boom')<0||kinds.indexOf('shrap')<0||kinds.indexOf('fire')<0)
      throw new Error('炸裂弾・榴散弾・火炎弾が揃っていない: '+kinds.join('/'));
    // 撃って、弾種ごとの効き方の違いを実測する
    const shoot=function(id){ const p=setup(); p.level=1;
      enemies.length=0; projectiles.length=0;
      for(let k=0;k<4;k++){ const e=dummyAt(150+k*60, ((k%3)-1)*14); e.hp=e.maxHp=99999; }
      const hp0=enemies.map(function(e){ return e.hp; });
      p.state='idle'; p.z=0; p.atk=null;
      // 敵が歩くと当たる破片の数が実行ごとに倍近く振れる。上下の物理は要るので
      // updateEnemies は回したまま、毎フレーム立ち位置だけ元へ戻して測る
      const px=enemies.map(function(e){ return {x:e.x, y:e.y}; });
      beginAttack(id);
      let zMax=0, maxProj=0;
      for(let f=0;f<130;f++){ updatePlayer(p); updateEnemies(); updateProjectiles();
        enemies.forEach(function(e,i){ if(px[i]){ e.x=px[i].x; e.y=px[i].y; } });
        if(projectiles.length>maxProj) maxProj=projectiles.length;
        for(const e of enemies) if(e.z>zMax) zMax=e.z; }
      return { dmg:enemies.reduce(function(a,e,i){ return a+(hp0[i]-e.hp); },0),
               up:zMax, proj:maxProj,
               burn:enemies.filter(function(e){ return (e.burnT||0)>0; }).length }; };
    const boom=shoot(tiers.filter(function(t){return t.kind==='boom';})[0].id);
    const shrap=shoot(tiers.filter(function(t){return t.kind==='shrap';})[0].id);
    const fire=shoot(tiers.filter(function(t){return t.kind==='fire';})[0].id);
    for(const q of [['炸裂弾',boom],['榴散弾',shrap],['火炎弾',fire]])
      if(q[1].dmg<=0) throw new Error(q[0]+'が当たらない');
    // 炸裂弾＝まとめて吹き飛ばす。爆発そのものにも打ち上げがあるので、
    // 「他の弾種より明らかに高く飛ぶ」ことで見分ける
    if(!(boom.up > Math.max(shrap.up, fire.up)*1.4))
      throw new Error('炸裂弾の吹き飛ばしが他の弾種と変わらない（炸裂'+Math.round(boom.up)
        +' / 榴散'+Math.round(shrap.up)+' / 火炎'+Math.round(fire.up)+'）');
    // 榴散弾＝破片が複数飛ぶ
    if(!(shrap.proj>=5)) throw new Error('榴散弾の破片が出ていない（同時に'+shrap.proj+'発）');
    if(!(shrap.proj>boom.proj)) throw new Error('榴散弾と炸裂弾で弾の出方が変わらない');
    // 火炎弾＝範囲の敵が延焼する
    if(!(fire.burn>=2)) throw new Error('火炎弾で延焼していない（'+fire.burn+'体）');
    if(boom.burn>0) throw new Error('炸裂弾まで延焼している＝弾種が効いていない');
    // 3種の威力がかけ離れていないこと（どれかが一択にならないように）
    const ds=[boom.dmg,shrap.dmg,fire.dmg];
    // 炸裂弾は「打ち上げた敵が後続の子弾の爆風に入るか」で実行ごとに 180〜412 と振れる。
    // 高さまで固定すると吹き飛ばしの検査ができなくなるので、比の上限を緩めて許容する。
    // 見たいのは「どれかが一択にならない」ことだけ
    if(Math.max.apply(null,ds) > Math.min.apply(null,ds)*2.6)
      throw new Error('弾種の威力に開きがありすぎる（'+ds.map(Math.round).join('/')+'）');
    console.log('グレネードランチャー OK (Lv'+tiers.map(function(t){return t.lv+'='+t.kind;}).join('・Lv')
      +'／炸裂 与ダメ'+Math.round(boom.dmg)+'・浮き'+Math.round(boom.up)
      +'px／榴散 '+Math.round(shrap.dmg)+'・破片'+shrap.proj
      +'発／火炎 '+Math.round(fire.dmg)+'・延焼'+fire.burn+'体)'); }

  // ===== 16) グレネードは空中で子弾に分裂し、割れるまでは当たらない =====
  { const fire=function(id, dist){ const p=setup(); p.level=1;
      enemies.length=0; projectiles.length=0;
      const e=dummyAt(dist); e.hp=e.maxHp=99999; const hp0=e.hp;
      p.state='idle'; p.z=0; p.atk=null;
      beginAttack(id);
      let maxN=0, splitSeen=false, before=0;
      for(let f=0;f<130;f++){ before=projectiles.length;
        updatePlayer(p); updateEnemies(); updateProjectiles();
        if(projectiles.length>before+1) splitSeen=true;      // 1発が同じフレームで複数へ増える＝分裂
        if(projectiles.length>maxN) maxN=projectiles.length; }
      return {dmg:hp0-e.hp, maxN:maxN, split:splitSeen}; };
    for(const id of ['mkGL','mkGL2','mkGL3']){
      const far=fire(id, 260);
      if(!far.split) throw new Error(ATK[id].name+' が空中で分裂していない');
      if(far.maxN<3) throw new Error(ATK[id].name+' の子弾が '+far.maxN+' 発しかない');
      if(far.dmg<=0) throw new Error(ATK[id].name+' が当たらない'); }
    // 目の前に敵が居ても、割れる前に直撃して不発になったりしない。
    // 「当たらない」ではなく「必ず割れる」で見る——子弾の爆風は
    // 手前へも届くので、与ダメ0を条件にすると不安定だった
    { const near=fire('mkGL', 55);
      if(!near.split) throw new Error('目の前に敵が居ると分裂せず直撃で終わっている');
      if(near.maxN<3) throw new Error('目の前に敵が居ると子弾が出ない（'+near.maxN+'発）'); }
    console.log('グレネードの分裂 OK (3種とも空中で割れる／目の前に敵が居ても割れる)'); }

  // ===== 17) 爆発のエフェクトが多層になっている =====
  { const p=setup(); enemies.length=0; particles.length=0;
    projExplode(p.x+120, p.y, 150, 10, '#ffae42');
    const kinds={}; for(const q of particles) kinds[q.k]=(kinds[q.k]||0)+1;
    const total=particles.length;
    // 以前は輪2枚＋火花1回＋土煙だけだった
    if(total<30) throw new Error('爆発の粒が '+total+' 個しかない（30個以上ほしい）');
    if((kinds.ring||0)<3) throw new Error('広がる輪が '+(kinds.ring||0)+'枚しかない');
    if(!kinds.scorch) throw new Error('地面の焦げ跡が出ていない');
    if(!kinds.smoke) throw new Error('煙が出ていない');
    if(!kinds.ember) throw new Error('吹き飛ぶ瓦礫が出ていない');
    console.log('爆発のエフェクト OK (粒'+total+'個／輪'+kinds.ring+'枚・煙'+kinds.smoke
      +'・瓦礫'+kinds.ember+'・焦げ跡'+kinds.scorch+')'); }

  console.log('MACK TEST PASSED'); process.exit(0);
})().catch(e=>{ console.error('FAIL:', e.message, e.stack); process.exit(1); });
`;
code = code + "\n;" + DRIVER;
(0, eval)(code);

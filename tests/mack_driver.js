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
        const p=setup(); const e=dummyAt(70); const hp0=e.hp;
        beginAttack(id); run(p, ATK[id].dur+70);
        const dmg=hp0-e.hp;
        if(dmg<=0) throw new Error(id+'（'+ATK[id].name+'）が一度も当たらない'); } }
    console.log('コマンド技7枠 OK (基本7＋上位7＝14技すべて命中する)'); }

  // ===== 4) ショットガンは近いほど痛い（射程は短い） =====
  { const at=function(dx){ const p=setup(); const e=dummyAt(dx); const hp0=e.hp;
      beginAttack('mkShotgun'); run(p, ATK.mkShotgun.dur+30); return hp0-e.hp; };
    const near=at(20), mid=at(88), far=at(230);
    // 散弾そのものは中距離でも当たる。「鼻先だと束で入る」ぶんが乗っているかを見る
    if(near < mid*1.35) throw new Error('鼻先('+Math.round(near)+')と中距離('+Math.round(mid)+')が変わらない＝至近の束撃ちが乗っていない');
    if(far>0) throw new Error('遠距離('+Math.round(far)+')まで届いている＝ショットガンの射程になっていない');
    console.log('ショットガン OK (鼻先 '+Math.round(near)+' / 中距離 '+Math.round(mid)+' / 遠距離 '+Math.round(far)
      +' ＝鼻先は'+(mid>0?(near/mid).toFixed(2):'∞')+'倍)'); }

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
  { const air=function(key){ const p=setup(); const e=dummyAt(key==='down'?30:120, 0); const hp0=e.hp;
      projectiles.length=0; p.state='jump'; p.z=150; p.vz=0; p.jAtk=0; p.jUpUsed=false; p.ammo=MK_AMMO;
      p.in.K.up=(key==='up'); p.in.K.down=(key==='down'); p.in.pressed.atk=true;
      updatePlayer(p);
      const tag=p.jMkUp?'up':p.jMkDown?'down':p.jMkFire?'fwd':'other';
      for(let f=0;f<110;f++){ updatePlayer(p); updateProjectiles(); }
      p.in.K.up=p.in.K.down=false;
      return {tag:tag, dmg:hp0-e.hp}; };
    const u=air('up'), d=air('down'), f=air('fwd');
    if(u.tag!=='up')   throw new Error('空中↑がマック専用の技になっていない（'+u.tag+'）');
    if(d.tag!=='down') throw new Error('空中↓がマック専用の技になっていない（'+d.tag+'）');
    if(f.tag!=='fwd')  throw new Error('空中前がマック専用の技になっていない（'+f.tag+'）');
    for(const q of [['↑',u],['↓',d],['前',f]]) if(q[1].dmg<=0) throw new Error('空中'+q[0]+'が当たらない');
    if(u.dmg<=f.dmg) throw new Error('空中↑のバズーカが空中前のリボルバーより軽い（'+Math.round(u.dmg)+' vs '+Math.round(f.dmg)+'）');
    console.log('空中技 OK (前リボルバー'+Math.round(f.dmg)+'／↑バズーカ'+Math.round(u.dmg)+'／↓乱射'+Math.round(d.dmg)+')'); }

  // ===== 9) 奥義パイルバンカーは前方の一帯を巻き込む =====
  { const p=setup(); const es=[dummyAt(60,-20), dummyAt(110,0), dummyAt(160,20)];
    const hp0=es.map(function(e){ return e.hp; });
    beginAttack('mkpile'); run(p, ATK.mkpile.dur+40);
    const hit=es.filter(function(e,i){ return hp0[i]-e.hp>0; }).length;
    if(hit<3) throw new Error('パイルバンカーが '+hit+' 体しか巻き込まない');
    if(!ATK.mkpile.rise) throw new Error('パイルバンカーが突き上げになっていない');
    console.log('奥義パイルバンカー OK ('+hit+'体巻き込み・突き上げ)'); }

  // ===== 10) 後ろ前のドリル突進は、連打でヒット数と突進距離が伸びる =====
  { // 敵を置くと押し合いと吹き飛びで距離がぶれるので、伸びの計測は敵なしで行う
    const dash=function(mash,id){ const p=setup(); enemies.length=0;
      p.spinCount=1; p.x=140; const x0=p.x;
      let frames=0;
      beginAttack(id);
      for(let f=0;f<400;f++){
        const on=(p.state==='attack' && p.atk && p.atk.def.mkDrill);
        if(!on && frames>0) break;
        if(mash && on && f%5===0) p.in.pressed.atk=true;
        updatePlayer(p); if(on) frames++; }
      return {dist:Math.abs(p.x-x0), frames:frames, n:p.spinCount|0}; };
    const a=dash(false,'mkDrill'), b=dash(true,'mkDrill');
    if(ATK.mkDrill.respinMax<3) throw new Error('ドリルの連打上限が '+ATK.mkDrill.respinMax);
    if(b.n<ATK.mkDrill.respinMax) throw new Error('連打しても '+b.n+' 回までしか繋がらない');
    if(b.frames < a.frames*2.5) throw new Error('連打してもヒット時間が伸びない（'+a.frames+'F→'+b.frames+'F）');
    if(b.dist < a.dist*2.5) throw new Error('連打しても突進距離が伸びない（'+Math.round(a.dist)+'→'+Math.round(b.dist)+'）');
    // タメ攻撃のドリルは伸びない（同じ得物でも使い分けが残っていること）
    const c=dash(false,'mkCharge'), d=dash(true,'mkCharge');
    if(Math.abs(d.dist-c.dist)>2 || d.frames!==c.frames)
      throw new Error('タメのドリルまで連打で伸びている（'+Math.round(c.dist)+'/'+c.frames+'F → '+Math.round(d.dist)+'/'+d.frames+'F）');
    // 入力から辿って確かめる。後ろ→前と入れて攻撃を押したらドリルが出て、
    // かつ連打の種（spinCount）が立っていること。ここを見ないと
    // 「技表ではドリルだが、実際に押すと連打が効かない」を取り逃がす
    { const p=setup(); enemies.length=0; p.facing=1; p.spinCount=0; p.x=200;
      p.in.cardSeq.length=0;
      p.in.cardSeq.push({c:3, f:gf-6});      // 後ろ（左）
      p.in.cardSeq.push({c:1, f:gf-2});      // 前（右）
      p.in.pressed.atk=true; updatePlayer(p);
      if(!(p.state==='attack' && p.atk && p.atk.def.mkDrill))
        throw new Error('後ろ前＋攻撃でドリルが出ない（'+(p.atk?p.atk.def.name:p.state)+'）');
      if((p.spinCount|0)<1) throw new Error('後ろ前で出したドリルに連打が効かない（spinCount='+p.spinCount+'）'); }
    console.log('後ろ前のドリル突進 OK (連打なし '+Math.round(a.dist)+'px/'+a.frames+'F → 連打あり '
      +Math.round(b.dist)+'px/'+b.frames+'F ×'+b.n+'／タメ版は伸びない)'); }

  console.log('MACK TEST PASSED'); process.exit(0);
})().catch(e=>{ console.error('FAIL:', e.message, e.stack); process.exit(1); });
`;
code = code + "\n;" + DRIVER;
(0, eval)(code);

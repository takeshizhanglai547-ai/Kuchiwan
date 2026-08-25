const DRIVER = `
(async()=>{
  const step=(n)=>{ for(let i=0;i<n;i++){ if(global.rafCb){ const cb=global.rafCb; global.rafCb=null; cb(); } } };

  // ===== 1) 基盤：ステータス・武器・選択画面 =====
  if(!WEAPONS.inuboshi) throw new Error('犬干し竿 missing');
  if(!(WEAPONS.inuboshi.reach>=2.3)) throw new Error('犬干し竿 not doubled ('+WEAPONS.inuboshi.reach+')');
  if(!CHARS.some(c=>c.k==='wanden')) throw new Error('wanden not in char select');
  setupRoster('wanden'); startGame(); state='play';
  let p=players[0]; player=p;
  if(p.kind!=='wanden') throw new Error('setupRoster failed');
  if(p.weapon!=='inuboshi') throw new Error('default weapon not 犬干し竿 ('+p.weapon+')');
  if(!(p.atkMul>1 && p.spdMul<1)) throw new Error('wanden stats not technical (atk='+p.atkMul+' spd='+p.spdMul+')');
  console.log('ワンデン BASE OK (犬干し竿 reach x'+WEAPONS.inuboshi.reach+', atkMul='+p.atkMul+', spdMul='+p.spdMul+', lives='+p.lives+')');
  // 一刀流の矜持：他の武器は拾わない
  if(canPick(p,'spear')||canPick(p,'hammer')||canPick(p,'tome')) throw new Error('wanden should refuse foreign weapons');
  if(!canPick(p,'moon')) throw new Error('wanden should accept moon sword');
  console.log('ワンデン 一刀流 OK (異種武器は拒否、聖剣系のみ受容)');

  // ===== 2) 居合パリィ：回避ボタンが前転ではなくパリィになる =====
  p.state='idle'; p.z=0; p.in.pressed.grd=true;
  hitStop=0; slowmo=0; step(1);
  if(p.state!=='iparry') throw new Error('grd did not start iai parry (state='+p.state+')');
  if(!(p.ipWin>0)) throw new Error('parry window not open');
  console.log('居合パリィ OK (回避ボタン→iparry, 受付'+p.ipWin+'F)');
  // 他キャラは従来どおり前転
  setupRoster('inu'); startGame(); state='play'; const ip=players[0]; player=ip;
  ip.state='idle'; ip.z=0; ip.in.pressed.grd=true; hitStop=0; slowmo=0; step(1);
  if(ip.state!=='roll') throw new Error('inu lost rolling dodge (state='+ip.state+')');
  console.log('他キャラ 前転維持 OK (inu -> roll)');

  // ===== 3) パリィ成功 → 秘剣・犬返しの自動カウンター =====
  setupRoster('wanden'); startGame(); state='play'; p=players[0]; player=p;
  p.x=camX+300; p.facing=1; p.hp=p.maxHp=9999; p.invuln=0;
  enemies.length=0; spawnEnemy('wolf', p.x+60, LANE); spawnEnemy('wolf', p.x+130, LANE);
  enemies.forEach(e=>{ e.thinkCd=9999; e.hp=e.maxHp=9999; e.facing=-1; });
  const atkE=enemies[0];
  beginIaiParry(p);
  const hpBefore=p.hp;
  // 受付中に敵の攻撃が到達 → カウンター
  const connected = hitOnePlayer(p, atkE, 40, true, 120, 40, false);
  if(!connected) throw new Error('enemy attack did not resolve against parry');
  if(p.hp!==hpBefore) throw new Error('parry did not negate damage (hp '+hpBefore+'->'+p.hp+')');
  for(let i=0;i<20;i++){ hitStop=0; slowmo=0; step(1); }   // 溜め→一閃の演出を進める
  if(atkE.hp>=9999 && !atkE.dead) throw new Error('犬返し dealt no damage to the parried enemy');
  const mainDmg=9999-atkE.hp;
  const otherDmg=9999-enemies[1].hp;
  if(!(otherDmg>0)) throw new Error('犬返し did not sweep nearby enemies');
  if(!(mainDmg>otherDmg)) throw new Error('parried enemy should take the biggest hit ('+mainDmg+' vs '+otherDmg+')');
  if(p.state==='iparry') throw new Error('counter did not exit parry state');
  if(!(p.invuln>0)) throw new Error('counter gave no recovery invuln');
  console.log('秘剣・犬返し OK (無効化＋主target '+mainDmg+'dmg / 巻き込み '+otherDmg+'dmg, 2体薙ぎ)');

  // ガード不能技もパリィで受けられる
  p.state='idle'; p.invuln=0; p.hp=p.maxHp;
  enemies.length=0; spawnEnemy('wolf', p.x+60, LANE); const ue=enemies[0]; ue.thinkCd=9999; ue.hp=ue.maxHp=9999;
  beginIaiParry(p);
  hitOnePlayer(p, ue, 50, true, 120, 40, true);
  if(p.hp!==p.maxHp) throw new Error('unblockable not parried');
  for(let i=0;i<44;i++){ hitStop=0; slowmo=0; step(1); }   // カウンター演出を終わらせる
  console.log('ガード不能技パリィ OK (ダメージ0で犬返し発動)');

  // ===== 4) パリィ空振り → 構え直しの隙（リスク）=====
  p.state='idle'; p.invuln=0; p.hp=p.maxHp; enemies.length=0;
  beginIaiParry(p);
  for(let i=0;i<PARRY_WIN+1;i++){ hitStop=0; slowmo=0; step(1); }
  if(p.state!=='iparry') throw new Error('whiff did not keep player in recovery');
  if(!(p.ipStance>0)) throw new Error('whiff produced no recovery penalty');
  const stance0=p.ipStance;
  // 硬直中は無防備：攻撃が通る
  spawnEnemy('wolf', p.x+50, LANE); const we=enemies[0]; we.thinkCd=9999; we.facing=-1;
  p.invuln=0; const hp2=p.hp;
  hitOnePlayer(p, we, 30, false, 120, 40, false);
  if(p.hp>=hp2) throw new Error('player was not vulnerable during parry recovery');
  console.log('パリィ空振りリスク OK (構え直し'+stance0+'F, 硬直中に被弾 -'+(hp2-p.hp)+'HP)');
  // 硬直が明ければ復帰
  p.hp=p.maxHp; p.invuln=0; enemies.length=0;
  for(let i=0;i<PARRY_WHIFF+4;i++){ hitStop=0; slowmo=0; step(1); }
  if(p.state==='iparry') throw new Error('never recovered from whiff');
  console.log('パリィ復帰 OK (硬直明けで行動可能 -> '+p.state+')');

  // ===== 5) 飛び道具のパリィ（弾き返し）=====
  p.state='idle'; p.invuln=0; projectiles.length=0; enemies.length=0;
  spawnEnemy('wolf', p.x+200, LANE); const se=enemies[0]; se.thinkCd=9999;
  beginIaiParry(p);
  spawnProj(p.x+40, p.y, -8, 0, {owner:'enemy', dmg:12, color:'#f00', r:8, life:60, zz:40});
  hitStop=0; slowmo=0; step(1);
  if(!projectiles.some(pr=>pr.owner==='player')) throw new Error('projectile not deflected during parry window');
  console.log('飛び道具パリィ OK (敵弾を弾き返して自分の弾に)');

  // ===== 5b) 連続弾き =====
  // 従来は「弾いても受けは延びず、窓が閉じれば空振りと同じ34Fの硬直」だった。
  // 弾幕に対して一発しか返せず、成功しているのに罰される形になっていた
  const shoot=function(px){ spawnProj(px, p.y, -8, 0, {owner:'enemy', dmg:12, color:'#f00', r:8, life:60, zz:40}); };
  // (a) 弾くと受けが継ぎ足される
  { p.state='idle'; p.invuln=0; projectiles.length=0; enemies.length=0; p.facing=1;
    beginIaiParry(p);
    for(let i=0;i<10;i++){ hitStop=0; slowmo=0; step(1); }     // 受けを残り少なくする
    const before=p.ipWin;
    if(!(before<=3)) throw new Error('この節の前提が崩れている: 受けが残りすぎ '+before);
    shoot(p.x+40); hitStop=0; slowmo=0; step(1);
    if(!(p.ipWin>before)) throw new Error('弾いても受けが継ぎ足されない: '+before+' → '+p.ipWin);
    console.log('受けの継ぎ足し OK (残り'+before+'F → '+p.ipWin+'F)'); }
  // (b) 同じ構えで何本も弾ける（従来は窓が閉じて1本まで）
  { p.state='idle'; p.invuln=0; projectiles.length=0; enemies.length=0; p.facing=1; p.hp=p.maxHp;
    beginIaiParry(p);
    let ref=0;
    // 受けが閉じた後に撃つと当然もらうので、開いている間だけ撃つ
    for(let i=0;i<40 && p.state==='iparry';i++){
      if(i%6===0 && p.ipWin>0) shoot(p.x+40);
      hitStop=0; slowmo=0; step(1);
      ref=p.ipRef||0; }
    if(!(ref>=3)) throw new Error('一つの構えで3本以上弾けない: '+ref+'本');
    if(p.hp!==p.maxHp) throw new Error('弾いたのに被弾している');
    console.log('連続弾き OK (一つの構えで '+ref+'本／継ぎ足しの上限つき)'); }
  // (c) 継ぎ足しには上限がある（弾幕の前に立っているだけで無敵にはならない）
  { p.state='idle'; p.invuln=0; projectiles.length=0; enemies.length=0; p.facing=1; p.hp=p.maxHp;
    beginIaiParry(p);
    let f=0;
    for(; f<400 && p.state==='iparry' && p.ipWin>0; f++){ shoot(p.x+40); hitStop=0; slowmo=0; step(1); }
    if(!(p.ipWin<=0)) throw new Error('撃たれ続ける限り受けが閉じない（無敵になっている）: '+f+'F');
    if(!(f<120)) throw new Error('受けが閉じるまで長すぎる: '+f+'F');
    console.log('継ぎ足しの上限 OK ('+f+'F で受けが閉じる／弾いた '+p.ipRef+'本)'); }
  // (d) 弾いて終わった構えの硬直は、空振りよりずっと短い
  { const recover=function(fire){
      p.state='idle'; p.invuln=0; projectiles.length=0; enemies.length=0; p.facing=1; p.hp=p.maxHp;
      beginIaiParry(p);
      for(let i=0;i<3;i++){ if(fire && i===0) shoot(p.x+40); hitStop=0; slowmo=0; step(1); }
      let g=0; while(p.state==='iparry' && g<300){ hitStop=0; slowmo=0; step(1); g++; }
      return g; };
    const whiff=recover(false), ok=recover(true);
    if(!(whiff>=30)) throw new Error('空振りの罰が消えている: '+whiff+'F');
    if(!(ok<whiff*0.5)) throw new Error('弾いても空振りと同じだけ固まる: 空振り'+whiff+'F / 弾き'+ok+'F');
    console.log('弾き後の硬直 OK (空振り '+whiff+'F ／ 弾いた後 '+ok+'F)'); }
  // (e) 弾いた後の硬直中は再入力で繋げられる。空振りの硬直では繋げない
  { const chain=function(fire){
      p.state='idle'; p.invuln=0; projectiles.length=0; enemies.length=0; p.facing=1; p.hp=p.maxHp;
      beginIaiParry(p);
      for(let i=0;i<3;i++){ if(fire && i===0) shoot(p.x+40); hitStop=0; slowmo=0; step(1); }
      while(p.state==='iparry' && p.ipWin>0){ hitStop=0; slowmo=0; step(1); }
      if(!(p.ipStance>0)) throw new Error('硬直に入っていない');
      p.in.pressed.grd=true; useInput(p.in);
      hitStop=0; slowmo=0; step(1);
      return p.ipWin; };
    const okWin=chain(true), whiffWin=chain(false);
    if(!(okWin>0)) throw new Error('弾いた後の硬直中に繋げない');
    if(whiffWin>0) throw new Error('空振りの硬直中にも繋げてしまう（リスクが消える）');
    console.log('繋ぎの再入力 OK (弾いた後は受け'+okWin+'Fで再開／空振り後は繋げない)'); }
  // (f) 繋ぐほど返しが重くなる
  { const dmgAt=function(n){
      p.state='idle'; p.invuln=0; projectiles.length=0; enemies.length=0; p.facing=1;
      beginIaiParry(p);
      let last=0;
      for(let i=0;i<n;i++){ shoot(p.x+40); hitStop=0; slowmo=0; step(1);
        const mine=projectiles.filter(q=>q.owner==='player');
        if(mine.length) last=mine[mine.length-1].dmg; }
      return last; };
    const d1=dmgAt(1), d3=dmgAt(3);
    if(!(d1>0)) throw new Error('弾き返した弾にダメージが無い');
    if(!(d3>d1)) throw new Error('繋いでも返しが重くならない: '+d1+' → '+d3);
    console.log('繋ぎの見返り OK (1本目 '+d1+' → 3本目 '+d3+')'); }

  // ===== 6) 居合の技セット =====
  ['wd1','wd2','wd3','wd4','dtsubame','dnuki','dnukidn','dsuriashi','dyae','dzantetsu','dzetto','dshukuchi','dkaiden'].forEach(k=>{
    if(!ATK[k]) throw new Error('missing ATK '+k); });
  // 通常コンボ：鞘当て→鞘振り返し（納刀のまま）→抜刀→乱れ切り（連打でループ）
  if(!ATK.wd1.sheath || !ATK.wd2.sheath) throw new Error('鞘当て/鞘振り返し should be sheathed');
  if(ATK.wd3.sheath) throw new Error('抜刀 should draw the blade');
  if(ATK.wd4.combo!==3) throw new Error('乱れ切り should loop on repeat (combo='+ATK.wd4.combo+')');
  // ↑攻撃は振り下ろしへ派生する
  if(ATK.dnuki.derive!=='dnukidn') throw new Error('アッパースラッシュ lacks the follow-up cleave');
  // 下攻撃は長大リーチ
  if(!(ATK.dsuriashi.reach>=150)) throw new Error('足元薙ぎ払い not long enough');
  setupRoster('wanden'); startGame(); state='play'; p=players[0]; player=p;
  if(comboMoveFor(p,1)!=='wd1'||comboMoveFor(p,4)!=='wd4') throw new Error('wanden combo not wired');
  if(commandSpecial===undefined) throw new Error('commandSpecial missing');
  console.log('技セット OK (コンボ wd1-4 ＋ コマンド技8種)');
  // 絶刀：超ロングリーチの一閃
  p.x=camX+250; p.facing=1; p.hp=p.maxHp=9999;
  enemies.length=0; spawnEnemy('wolf', p.x+170, LANE); const ze=enemies[0]; ze.thinkCd=9999; ze.hp=ze.maxHp=9999;
  beginAttack('dzetto');
  for(let i=0;i<50;i++){ hitStop=0; slowmo=0; step(1); }
  if(ze.hp>=9999 && !ze.dead) throw new Error('絶刀 did not reach a far enemy');
  console.log('絶刀 OK (170px先の敵に到達, dmg='+(9999-ze.hp)+')');
  // 秘剣・八重霞：前方に斬撃痕を刻み、時間差で炸裂
  p.state='idle'; hazards.length=0; enemies.length=0;
  spawnEnemy('wolf', p.x+135, LANE); spawnEnemy('wolf', p.x+250, LANE);
  enemies.forEach(e=>{ e.thinkCd=9999; e.hp=e.maxHp=9999; });
  beginAttack('dyae');
  for(let i=0;i<16;i++){ hitStop=0; slowmo=0; step(1); }
  if(!hazards.some(h=>h.kind==='kasumi')) throw new Error('八重霞 left no slash marks');
  const marks=hazards.filter(h=>h.kind==='kasumi').length;
  for(let i=0;i<80;i++){ hitStop=0; slowmo=0; step(1); }
  const yHit=enemies.filter(e=>e.hp<9999||e.dead).length;
  if(yHit<1) throw new Error('八重霞 never detonated on anyone');
  if(hazards.some(h=>h.kind==='kasumi')) throw new Error('八重霞 marks never expired');
  console.log('秘剣・八重霞 OK (斬撃痕'+marks+'個を時間差で炸裂, '+yHit+'体に命中)');
  // 無明・斬鉄：振り下ろし＋地割れが疾走
  p.state='idle'; projectiles.length=0; enemies.length=0;
  spawnEnemy('wolf', p.x+330, LANE); const he=enemies[0]; he.thinkCd=9999; he.hp=he.maxHp=9999;
  beginAttack('dzantetsu');
  for(let i=0;i<70;i++){ hitStop=0; slowmo=0; step(1); }
  if(he.hp>=9999 && !he.dead) throw new Error('斬鉄 fissure never reached the far enemy');
  console.log('無明・斬鉄 OK (地割れが遠方の敵に到達, dmg='+(9999-he.hp)+')');
  // 奥義・皆伝：画面中の敵を順に斬る
  p.state='idle'; p.dim=3; enemies.length=0;
  for(let k=0;k<3;k++) spawnEnemy('wolf', camX+200+k*140, LANE);
  enemies.forEach(e=>{ e.thinkCd=9999; e.hp=e.maxHp=99999; });
  beginAttack('dkaiden');
  for(let i=0;i<70;i++){ hitStop=0; slowmo=0; step(1); }
  const kHit=enemies.filter(e=>e.hp<99999||e.dead).length;
  if(kHit<3) throw new Error('皆伝 hit only '+kHit+'/3');
  console.log('奥義・皆伝 OK (画面中の '+kHit+'/3 体を斬り伏せ)');

  // ===== 7) 攻撃＋掴み：大居合・一文字（前方へ長大な横切り一閃）=====
  p.state='idle'; p.sgCd=0; p.invuln=0; p.facing=1; enemies.length=0;
  spawnEnemy('wolf', p.x+140, LANE); spawnEnemy('wolf', p.x+500, LANE);   // 遠くの敵まで届くか
  enemies.forEach(e=>{ e.thinkCd=9999; e.hp=e.maxHp=9999; });
  if(!beginSGMove(p)) throw new Error('一文字 did not start');
  if(p.state!=='ichimonji') throw new Error('一文字 state not set ('+p.state+')');
  for(let i=0;i<20;i++){ hitStop=0; slowmo=0; step(1); }
  const iHit=enemies.filter(e=>e.hp<9999||e.dead).length;
  if(iHit<2) throw new Error('一文字 hit only '+iHit+'/2 (long reach expected)');
  for(let i=0;i<40;i++){ hitStop=0; slowmo=0; step(1); }
  if(p.state==='ichimonji') throw new Error('一文字 never finished');
  console.log('大居合・一文字 OK (140px/500px先の '+iHit+'/2 体を薙ぐ、復帰 -> '+p.state+')');

  // ===== 7b) 掴み技4種（すべて居合オリジナル）=====
  ['grabSayaKudaki','grabTenNagashi','grabSuemono','grabHaisha'].forEach(fn=>{
    if(typeof eval(fn)!=='function') throw new Error('missing grab move '+fn); });
  p.state='idle'; p.invuln=0; enemies.length=0;
  spawnEnemy('wolf', p.x+36, LANE); const ge=enemies[0]; ge.thinkCd=9999; ge.hp=ge.maxHp=99999;
  p.state='grab'; p.grabEnemy=ge; ge.grabbedBy=1;
  grabSuemono(ge);
  // 投げ技は専用アニメーションを持ち、決めのフレームで初めてダメージが入る
  if(p.state!=='wthrow') throw new Error('投げ技 has no animation state ('+p.state+')');
  if(ge.hp<99999) throw new Error('据物斬り damaged before the cut frame');
  let sueFrames=0;
  for(let i=0;i<60 && p.state==='wthrow';i++){ hitStop=0; slowmo=0; step(1); sueFrames++; }
  if(ge.hp>=99999 && !ge.dead) throw new Error('据物斬り dealt no damage');
  if(p.state==='wthrow') throw new Error('投げ技 never finished');
  if(sueFrames<20) throw new Error('据物斬り animation too short ('+sueFrames+'F)');
  console.log('掴み技 OK (4種アニメーション付き、据物斬り '+sueFrames+'F で dmg='+(99999-ge.hp)+')');
  // 残り3種もアニメーションを持ち、最後に必ずダメージが入る
  for(const [fn,nm] of [[grabSayaKudaki,'鞘砕き'],[grabTenNagashi,'天流し'],[grabHaisha,'背車']]){
    p.state='idle'; p.invuln=0; enemies.length=0;
    spawnEnemy('wolf', p.x+36, LANE); const g2=enemies[0]; g2.thinkCd=9999; g2.hp=g2.maxHp=99999;
    p.state='grab'; p.grabEnemy=g2; g2.grabbedBy=1;
    fn(g2);
    if(p.state!=='wthrow') throw new Error(nm+' has no animation state');
    let fr=0; for(let i=0;i<60 && p.state==='wthrow';i++){ hitStop=0; slowmo=0; step(1); fr++; }
    if(g2.hp>=99999 && !g2.dead) throw new Error(nm+' dealt no damage');
    if(fr<12) throw new Error(nm+' animation too short ('+fr+'F)');
    if(g2.grabbedBy) throw new Error(nm+' left the enemy held');
  }
  console.log('投げ技アニメーション OK (鞘砕き/天流し/背車 いずれも演出後に命中し、掴みを解放)');

  // ===== 7c) 秘剣・犬返しのカウンター演出（溜め→巨大一閃→納刀）=====
  p.state='idle'; p.invuln=0; p.facing=1; p.hp=p.maxHp=9999; enemies.length=0;   // 背車で向きが反転しているので正面に戻す
  spawnEnemy('wolf', p.x+70, LANE); const ce=enemies[0]; ce.thinkCd=9999; ce.hp=ce.maxHp=99999; ce.facing=-1;
  beginIaiParry(p);
  hitOnePlayer(p, ce, 40, true, 120, 40, false);
  if(p.state!=='dogret') throw new Error('counter has no animation state ('+p.state+')');
  if(ce.hp<99999) throw new Error('counter damage should wait for the slash frame');
  for(let i=0;i<20;i++){ hitStop=0; slowmo=0; step(1); }
  if(ce.hp>=99999 && !ce.dead) throw new Error('counter slash never landed');
  const cDmg=99999-ce.hp;
  for(let i=0;i<40;i++){ hitStop=0; slowmo=0; step(1); }
  if(p.state==='dogret') throw new Error('counter animation never ended');
  console.log('犬返し 演出 OK (溜め→一閃 dmg='+cDmg+' →納刀、復帰 -> '+p.state+')');

  // ===== 8) ストーリー・真ボス =====
  for(const t of ['STORY_OPEN_BY','STORY_TURN_BY','STORY_END_BY']){ const T=eval(t);
    if(!T.wanden||!T.wanden.length) throw new Error(t+'.wanden missing'); }
  if(trueBossFor('wanden')!=='mumei') throw new Error('wanden true boss not mumei');
  if(!ETYPE.mumei||!ETYPE.mumei.trueBoss) throw new Error('mumei ETYPE missing');
  if(!TRUE_REVEAL.mumei||!BOSS_BGM.mumei||!BOSSQUOTE.mumei||!BOSSMOVES[ETYPE.mumei.bossKind]) throw new Error('mumei not fully wired');
  players[0].kind='wanden';
  if(!storyEndFor().some(s=>s.boss==='mumei')) throw new Error('wanden ending lacks mumei scene');
  setupRoster('wanden'); startGame(); state='play'; spawnTrueBoss('mumei');
  if(!enemies.some(e=>e.type==='mumei')) throw new Error('mumei did not spawn');
  console.log('ストーリー/真ボス OK (剣鬼ムメイ hp='+ETYPE.mumei.hp+', 全ストーリー完備)');

  // ===== 9) オープニングのカットシーンで各自の得物を持っている =====
  cut=null;
  const want={inu:'dagger', shima:'fists', nuko:'wand', guard8:'ghammer', wanden:'inuboshi'};
  for(const k in want){
    players[0].weapon='dagger'; players[0].permWeapon=null;   // 前のプレイの得物が残っている状態を再現
    setupRoster(k==='inu'?'inu':k); startOpening();
    if(state!=='cut') throw new Error('opening cutscene did not start for '+k);
    if(players[0].weapon!==want[k]) throw new Error(k+' holds '+players[0].weapon+' in the opening (want '+want[k]+')');
    cut=null;
  }
  console.log('オープニング武器 OK (全キャラが自分の得物を構える: '+Object.values(want).join('/')+')');

  // ===== 10) 長刀が短剣に戻らないこと（発生していたバグの回帰テスト）=====
  const LONG=k=>k==='inuboshi'||k==='inuboshi2';
  // 生成直後
  if(!LONG(defaultWeaponFor('wanden'))) throw new Error('defaultWeaponFor(wanden) is not the long sword');
  setupRoster('wanden'); startGame(); state='play'; p=players[0]; player=p;
  if(!LONG(p.weapon)) throw new Error('startGame left wanden with '+p.weapon);
  // フィールド読み込み（resetPlayer の非フル復帰）
  loadLevel(WORLD_LEVELS[0]); p=players[0]; player=p;
  if(!LONG(p.weapon)) throw new Error('loadLevel reverted the sword to '+p.weapon);
  // 2周目開始
  cut=null; startNG2(); p=players[0]; player=p;
  if(!LONG(p.weapon)) throw new Error('startNG2 reverted the sword to '+p.weapon);
  cut=null; state='play';
  // リスポーン（残機を消費して復帰）
  p.hp=1; p.invuln=0; p.lives=3; loseLife(p); p=players[0]; player=p;
  if(!LONG(p.weapon)) throw new Error('respawn reverted the sword to '+p.weapon);
  // 拾った武器は持ち続ける（時間切れで戻る作りはやめた）。
  // ただし何も拾っていないときは、必ず犬干し竿に戻ること
  state='play'; p.active=true; p.state='idle'; p.hp=p.maxHp; p.z=0;
  giveWeapon(p,'moon');
  if(p.weaponT!==0) throw new Error('拾った武器に制限時間が付いている（'+p.weaponT+'）');
  for(let i=0;i<200;i++){ hitStop=0; slowmo=0; step(1); }
  if(p.weapon!=='moon') throw new Error('拾った武器が '+p.weapon+' に戻っている（持ち続けるはず）');
  // 別のフィールドへ行っても、やられて復帰しても持ったまま
  loadLevel(WORLD_LEVELS[1]); p=players[0]; player=p;
  if(p.weapon!=='moon') throw new Error('次のステージで '+p.weapon+' に戻っている');
  state='play'; p.hp=1; p.invuln=0; p.lives=3; loseLife(p); p=players[0]; player=p;
  if(p.weapon!=='moon') throw new Error('やられて復帰すると '+p.weapon+' に戻っている');
  // 拾っていない状態では長刀
  p.heldWeapon=null; resetPlayer(p,false);
  if(!LONG(p.weapon)) throw new Error('何も拾っていないのに '+p.weapon+' になっている');
  console.log('長刀の維持 OK (開始/フィールド読込/2周目/リスポーン すべて '+p.weapon+'／拾った武器は次のステージへ持ち越す)');
  // 英雄の武具はワンデンには真打（長刀のまま強化）
  setupRoster('wanden'); startGame(); state='play'; p=players[0]; player=p; p.permWeapon=null;
  coins=999; enterShop(); gacha=null;
  const hi=SHOP_ITEMS.findIndex(it=>it.name==='英雄の武具'); shopSel=hi;
  players[0].in.pressed.atk=true; updateShop();
  if(p.permWeapon!=='inuboshi2') throw new Error('英雄の武具 gave wanden '+p.permWeapon+' (want inuboshi2)');
  if(!(WEAPONS.inuboshi2.reach>=2.4)) throw new Error('真打 is not a long sword');
  console.log('英雄の武具 OK (ワンデンは「'+WEAPONS.inuboshi2.name+'」で長刀のまま強化)');

  // ===== 11) 高速乱れ切り：斜め上→袈裟斬り振り下ろし のループになっていること =====
  setupRoster('wanden'); startGame(); state='play'; p=players[0]; player=p;
  p.x=camX+260; p.facing=1; p.hp=p.maxHp=99999; enemies.length=0;
  spawnEnemy('wolf', p.x+120, LANE); const fe=enemies[0]; fe.thinkCd=9999; fe.hp=fe.maxHp=99999;
  const D=ATK.wd4, SEG=5;
  // 実際に描画へ渡された刀の角度を記録して、振りが上下交互にループしているかを検証する
  const _origBlade=drawBlade, rec=[];
  drawBlade=function(hx,hy,ang,ext){ if(player.state==='attack'&&player.atk&&player.atk.type==='wd4') rec.push({t:player.atk.t, ang}); return _origBlade.apply(this,arguments); };
  beginAttack('wd4');
  let hits=0, prev=fe.hp;
  for(let i=0;i<D.dur+2;i++){ hitStop=0; slowmo=0; step(1); if(fe.hp<prev){ hits++; prev=fe.hp; } }
  drawBlade=_origBlade;
  if(hits<3) throw new Error('乱れ切り landed only '+hits+' hits');
  // 各振り（SEGフレーム）の始点→終点で角度が減れば斬り上げ(斜め上)、増えれば振り下ろし
  const dirs=[];
  for(let idx=0; idx<4; idx++){
    const t0=D.act[0]+idx*SEG, t1=t0+SEG-1;
    const f0=rec.find(r=>r.t===t0), f1=rec.find(r=>r.t===t1);
    if(!f0||!f1) throw new Error('no render sample for swing '+idx+' (t'+t0+'-'+t1+')');
    dirs.push(f1.ang<f0.ang ? 'up' : 'down');
  }
  if(dirs.join(',')!=='up,down,up,down') throw new Error('乱れ切り is not alternating: '+dirs.join(','));
  // 斜め上は刀が上を向き（負の角度）、振り下ろしは下を向く（正の角度）ところまで振り切る
  const upEnd=rec.find(r=>r.t===D.act[0]+SEG-1).ang, dnEnd=rec.find(r=>r.t===D.act[0]+SEG*2-1).ang;
  if(!(upEnd<-0.9)) throw new Error('斬り上げ does not reach a high angle ('+upEnd.toFixed(2)+')');
  if(!(dnEnd>0.9)) throw new Error('振り下ろし does not reach a low angle ('+dnEnd.toFixed(2)+')');
  const swings=dirs.length;
  // 連打でループ：wd4 の次のコンボ段はふたたび wd4
  if(comboMoveFor(p, ATK.wd4.combo+1)!=='wd4') throw new Error('乱れ切り does not loop on repeat');
  console.log('高速乱れ切り OK ('+dirs.join('→')+' の'+swings+'振り [上端'+upEnd.toFixed(2)+'/下端'+dnEnd.toFixed(2)+']、'+hits+'ヒット、連打でループ)');

  // ===== 12) 縮地・残刃：一瞬で移動し、移動後に残撃が遅れて走る =====
  setupRoster('wanden'); startGame(); state='play'; p=players[0]; player=p;
  p.x=camX+180; p.facing=1; p.hp=p.maxHp=99999;
  enemies.length=0; hazards.length=0; particles.length=0; projectiles.length=0;   // 前の技の残り弾を持ち越さない
  // 移動経路の途中に敵を置く（通り過ぎた後に斬られるはず）
  spawnEnemy('wolf', p.x+120, LANE); spawnEnemy('wolf', p.x+240, LANE);
  const zt=[enemies[0], enemies[1]];   // 検証対象はこの2体のみ（前進で新たに湧く敵は数えない）
  zt.forEach(e=>{ e.thinkCd=9999; e.hp=e.maxHp=99999; });
  const sx0=p.x;
  beginAttack('dshukuchi');
  // 発動フレームで一瞬にして移動が完了していること
  for(let i=0;i<ATK.dshukuchi.act[0]+1;i++){ hitStop=0; slowmo=0; step(1); }
  const moved=p.x-sx0;
  if(!(moved>200)) throw new Error('縮地 did not blink forward (moved '+moved.toFixed(0)+'px)');
  // 移動直後は、まだ残撃が炸裂しておらず敵は無傷
  if(zt.some(e=>e.hp<99999)) throw new Error('残撃 damaged enemies during the dash (should come after)');
  const zMarks=hazards.filter(h=>h.kind==='zanjin').length;
  if(zMarks<3) throw new Error('残撃 marks not placed along the path ('+zMarks+')');
  if(!particles.some(pp=>pp.k==='wandenAfter')) throw new Error('no afterimages left along the path');
  // 残撃は通った跡（移動前〜移動後の間）に並ぶ
  const zs=hazards.filter(h=>h.kind==='zanjin').map(h=>h.x);
  if(!(Math.min(...zs)>sx0-10 && Math.max(...zs)<p.x+10)) throw new Error('残撃 are not along the travelled path');
  // 少し遅れて順に炸裂し、経路上の敵を斬る
  for(let i=0;i<40;i++){ hitStop=0; slowmo=0; step(1); }
  const zHit=zt.filter(e=>e.hp<99999||e.dead).length;
  if(zHit<2) throw new Error('残撃 hit only '+zHit+'/2 enemies on the path');
  if(hazards.some(h=>h.kind==='zanjin')) throw new Error('残撃 never resolved');
  console.log('縮地・残刃 OK (一瞬で'+moved.toFixed(0)+'px移動 → 残撃'+zMarks+'閃が遅れて発生、経路上の'+zHit+'/2体を斬る)');

  console.log('WANDEN TEST PASSED'); process.exit(0);
})().catch(e=>{ console.error('FAIL:', e.message, e.stack); process.exit(1); });
`;
code = code + "\n;" + DRIVER;
(0, eval)(code);

const DRIVER = `
(async()=>{
  const step=(n)=>{ for(let i=0;i<n;i++){ if(global.rafCb){ const cb=global.rafCb; global.rafCb=null; cb(); } } };
  sndOn=false;
  // 戦国編は「人気が高いので倍に」という指示で、章3→6・雑魚7→14・武将3→11 に増やした
  const ZAKO=['ashigaru','samurai','taisho','yumihei','teppo','kibahei','ninja',
              'souhei','saika','ozutsu','horo','kunoichi','oodate','hatamoto'];
  const BOSS=['nobunaga','hideyoshi','ieyasu','shingen','kenshin','yoshimoto','mitsuhide'];   // 章のボス
  const MINI=['katsuyori','hisahide','hanbei','kanbei'];                                       // 中ボス
  const LORDS=BOSS.concat(MINI);
  // 描画コールの形を取る物差し。ctx の束縛ごと差し替える（プロキシではメソッドを差せない）
  function shape(fn){
    const real=ctx; let n=0, sig=0;
    const num=v=>{ const x=(typeof v==='number'&&isFinite(v))?Math.round(v*4):0; sig=(sig*31+x)|0; };
    ctx=new Proxy(real,{ get:function(t,k){
      if(k==='fill'||k==='stroke'||k==='fillRect'||k==='fillText'){ return function(){ n++; sig=(sig*131+k.length)|0;
        for(let i=0;i<arguments.length;i++) num(arguments[i]); }; }
      if(k==='moveTo'||k==='lineTo'||k==='arc'||k==='ellipse'||k==='quadraticCurveTo'||k==='rect'||k==='translate'||k==='rotate'){
        return function(){ n++; sig=(sig*17+k.length)|0; for(let i=0;i<arguments.length;i++) num(arguments[i]); }; }
      return t[k]; } });
    try { fn(); } finally { ctx=real; }
    return {n:n, sig:sig}; }

  // ===== 1) 周回としての戦国 =====
  { if(typeof startNG5!=='function') throw new Error('startNG5 が無い');
    const n4=nextLap(4), n5=nextLap(5);
    if(!n4 || n4.lap!==5) throw new Error('四周目クリア後に五周目へ行けない');
    if(n5) throw new Error('五周目の先があることになっている');
    if(n4.label.indexOf('5周目')<0) throw new Error('ラベルが五周目を指していない: '+n4.label);
    setupRoster('inu'); startGame(); state='play';
    n4.go();
    if(lap!==5) throw new Error('lap が5にならない: '+lap);
    if(!encounters.length) throw new Error('戦国のエンカウンタが積まれていない');
    console.log('周回の続き OK (4→5／五周目の先は無し／'+n4.label+')'); }

  // ── 難易度：神話と戦国は「通常＝カジュアル」「高難易度＝従来の値」の二段 ──
  { const at=function(l,hard){ const sl=lap, sh=hardMode, st=TWO_P;
      lap=l; hardMode=hard; TWO_P=false;
      const r=[diffHpMul(), diffDmgMul()];
      lap=sl; hardMode=sh; TWO_P=st; return r; };
    // 高難易度＝従来の値そのもの。ここがずれると「今までどおり遊びたい人」の設定が消える
    const h4=at(4,true), h5=at(5,true);
    if(Math.abs(h4[0]-2.00)>1e-6 || Math.abs(h4[1]-1.70)>1e-6)
      throw new Error('四周目の高難易度が従来の 2.00/1.70 でない: '+h4.join('/'));
    if(Math.abs(h5[0]-2.40)>1e-6 || Math.abs(h5[1]-1.95)>1e-6)
      throw new Error('五周目の高難易度が従来の 2.40/1.95 でない: '+h5.join('/'));
    // 通常はそこから大きく下がっていること（3割以上）
    const c4=at(4,false), c5=at(5,false);
    // 下げ幅は攻撃力に厚く配る（HPを削っても戦いが短くなるだけで死ににくくはならない）。
    // 攻撃力は半分以下、HPは7割以下を要求する
    if(!(c4[1]<=h4[1]*0.55)) throw new Error('四周目の通常攻撃力が十分に下がっていない: '+c4[1]+' / 従来 '+h4[1]);
    if(!(c5[1]<=h5[1]*0.55)) throw new Error('五周目の通常攻撃力が十分に下がっていない: '+c5[1]+' / 従来 '+h5[1]);
    if(!(c4[0]<=h4[0]*0.70)) throw new Error('四周目の通常HPが十分に下がっていない: '+c4[0]+' / 従来 '+h4[0]);
    if(!(c5[0]<=h5[0]*0.70)) throw new Error('五周目の通常HPが十分に下がっていない: '+c5[0]+' / 従来 '+h5[0]);
    // 攻撃力の下げ幅がHPの下げ幅より大きいこと（配分の意図そのもの）
    if(!(c4[1]/h4[1] < c4[0]/h4[0])) throw new Error('四周目：HPのほうを大きく削っている（短くなるだけ）');
    if(!(c5[1]/h5[1] < c5[0]/h5[0])) throw new Error('五周目：HPのほうを大きく削っている（短くなるだけ）');
    // 高難易度では周回の順序が保たれること
    if(!(h5[0]>h4[0] && h5[1]>h4[1])) throw new Error('高難易度で五周目が四周目以下');
    // 通常：HPの順序は保つが、攻撃力だけは五周目を四周目より軽くしている。
    // 遊んだ上での指示で半減させた意図した例外なので、戻したら赤くなるよう固定する
    if(!(c5[0]>c4[0])) throw new Error('通常で五周目のHPが四周目以下: '+c4[0]+' → '+c5[0]);
    if(!(c5[1] <= c4[1]*0.60)) throw new Error('五周目の通常攻撃力が四周目の6割以下に収まっていない: '+c4[1]+' → '+c5[1]);
    if(!(c5[1]>0)) throw new Error('五周目の攻撃力がゼロ');
    // 高難易度の全体係数を二重に掛けていないこと（掛けると従来より更に硬い第三の難易度になる）
    if(!(h4[0]<2.4 && h5[0]<2.9)) throw new Error('高難易度に全体係数が二重に掛かっている: '+h4[0]+' / '+h5[0]);
    // 一〜三周目は従来どおり（hardMode の全体係数がそのまま乗る）
    const n3=at(3,false), q3=at(3,true);
    if(Math.abs(n3[0]-1.60)>1e-6) throw new Error('三周目の通常が変わっている: '+n3[0]);
    if(!(q3[0]>n3[0]*1.3)) throw new Error('三周目の高難易度に全体係数が乗っていない: '+n3[0]+' → '+q3[0]);
    // どちらで遊んでいるかが名前で取れること（画面へ出すのに使う）
    { const sl=lap, sh=hardMode;
      lap=5; hardMode=false; const cn=lapDiffName();
      hardMode=true; const hn=lapDiffName();
      lap=1; const n1=lapDiffName();
      lap=sl; hardMode=sh;
      if(!cn||!hn||cn===hn) throw new Error('カジュアルと高難易度の名前が分かれていない: '+cn+' / '+hn);
      if(n1!==null) throw new Error('一周目にも難易度名が出る（二段になっていない周回）: '+n1); }
    // 倍率を下げても「周回が進むほど手強い」が実際の敵で崩れないこと。
    // 倍率だけを見ていると、素のHPと攻撃力が周回ごとに大きいことを見落とす
    { const mk=function(l,zk){ const sl=lap, sh=hardMode; lap=l; hardMode=false;
        setupRoster('inu'); startGame(); state='play'; lap=l; hardMode=false; levelsDone={};
        const q=players[0]; player=q; q.x=camX+200; q.y=LANE; q.hp=q.maxHp=99999; q.invuln=0; q.state='idle';
        enemies.length=0; encounters.length=0;
        spawnEnemy(zk, camX+300, LANE); const Z=enemies[0];
        q.invuln=0; const h0=q.hp; tryHitPlayer(Z, ETYPE[zk].dmg*ZAKO_DMG, false, 200, 60);
        const r={hp:Z.maxHp, dmg:h0-q.hp}; lap=sl; hardMode=sh; return r; };
      const w=mk(1,'wolf'), a2=mk(3,'greywan'), a4=mk(4,'mythguard'), a5=mk(5,'samurai');
      if(!(a4.hp>a2.hp && a4.dmg>a2.dmg)) throw new Error('通常の四周目が三周目以下になっている: 3周 '+a2.hp+'/'+a2.dmg+' → 4周 '+a4.hp+'/'+a4.dmg);
      if(!(a5.hp>a4.hp)) throw new Error('通常の五周目のHPが四周目以下: '+a4.hp+' → '+a5.hp);
      if(!(a2.hp>w.hp)) throw new Error('前提が崩れている: 三周目は一周目より手強いはず');
      // 五周目の一撃だけは意図して軽い（半減の指示）。実際の敵でも四周目を下回ること
      if(!(a5.dmg < a4.dmg*0.75)) throw new Error('五周目の一撃が半減されていない: 4周 '+a4.dmg+' → 5周 '+a5.dmg);
      console.log('通常の並び OK (雑魚HP '+w.hp+'→'+a2.hp+'→'+a4.hp+'→'+a5.hp
        +'／一撃 '+w.dmg+'→'+a2.dmg+'→'+a4.dmg+'→'+a5.dmg+'＝五周目だけ意図して軽い)'); }
    console.log('難易度の二段 OK (神話 通常 '+c4[0].toFixed(2)+'/'+c4[1].toFixed(2)
      +' 高 '+h4[0].toFixed(2)+'/'+h4[1].toFixed(2)
      +'／戦国 通常 '+c5[0].toFixed(2)+'/'+c5[1].toFixed(2)
      +' 高 '+h5[0].toFixed(2)+'/'+h5[1].toFixed(2)+')'); }

  // 五周目のセーブが復元できること
  { const realLS=global.localStorage, mem={};
    global.localStorage={ getItem:k=>(k in mem?mem[k]:null), setItem:(k,v)=>{mem[k]=String(v);}, removeItem:k=>{delete mem[k];} };
    try {
      setupRoster('inu'); startGame(); state='play';
      lap=5; buildEncounters5(); saveProgress(1);
      const sv=loadProgress();
      if(!sv || sv.lap!==5) throw new Error('五周目がセーブに残らない');
      lap=1; startGameAt(sv.stage||1);
      if(lap!==5) throw new Error('セーブから再開すると五周目に戻らない: lap='+lap);
      console.log('五周目のセーブ復元 OK');
    } finally { global.localStorage=realLS; } }

  // 章とワールドマップ
  { if(SENGOKU_CH.length!==6) throw new Error('戦国の章が6つでない: '+SENGOKU_CH.length);
    const bosses=[], minis=[];
    SENGOKU_CH.forEach(function(ch,i){
      if(!ch.name) throw new Error('章'+i+' に名前が無い');
      const bg=ch.gates.filter(function(g){ return g.boss; });
      if(bg.length!==1) throw new Error('章'+i+' のボス門が1つでない: '+bg.length);
      bosses.push(bg[0].list[0][0]);
      ch.gates.filter(function(g){ return g.mini; }).forEach(function(g){ minis.push(g.list[0][0]); });
      if(STAGE_THEME[ch.theme]===undefined) throw new Error('章'+i+' のテーマ '+ch.theme+' が無い');
      if(!STAGE_THEME[ch.theme].sengoku) throw new Error('章'+i+' が戦国のテーマを指していない'); });
    if(new Set(bosses).size!==6) throw new Error('章ごとのボスが重複している: '+bosses.join(','));
    for(const b of bosses) if(BOSS.indexOf(b)<0) throw new Error('知らない章ボス: '+b);
    if(new Set(SENGOKU_CH.map(c=>c.theme)).size!==6) throw new Error('章のテーマが重複している');
    // 中ボスが道中に出ること。4人全員がどこかの章に居る
    if(new Set(minis).size<5) throw new Error('中ボスの門が5つ未満: '+minis.join(','));
    for(const m of MINI) if(minis.indexOf(m)<0) throw new Error('中ボス '+m+' がどの章にも出ない');
    if(minis.indexOf('mitsuhide')<0) throw new Error('明智光秀が中ボスとして出ない');
    // マップ：2ノード＋最終1（最終は規定数クリアで解禁）
    const sv=lap; lap=5;
    if(curWorldLevels()!==WORLD5_LEVELS) throw new Error('五周目のマップが戦国になっていない');
    if(allMapNodes().length!==WORLD5_LEVELS.length+WORLD5_FINAL.length) throw new Error('マップのノード数が合わない');
    const fin=WORLD5_FINAL[0];
    const sd=levelsDone; levelsDone={};
    if(nodeUnlocked(fin)) throw new Error('制覇0でも天守が解禁されている');
    lap=sv; levelsDone=sd;
    console.log('章とマップ OK ('+SENGOKU_CH.length+'章／ボス '+bosses.join('・')+'／中ボス '+MINI.join('・')+'／天守は施錠)'); }

  // ===== 2) 雑魚：兵種が7つあり、役割も絵も別 =====
  { for(const k of ZAKO){ const t=ETYPE[k];
      if(!t) throw new Error('雑魚 '+k+' が無い');
      if(!t.sengoku) throw new Error(k+' に sengoku 印が無い＝戦国の絵で描かれない');
      if(!t.sengKind) throw new Error(k+' に兵種が無い');
      if(!t.name) throw new Error(k+' に名前が無い'); }
    if(new Set(ZAKO.map(k=>ETYPE[k].sengKind)).size!==ZAKO.length) throw new Error('兵種が重複している');
    if(new Set(ZAKO.map(k=>ETYPE[k].name)).size!==ZAKO.length) throw new Error('名前が重複している');
    // 役割：それぞれ別のAIの入口を持っていること
    if(!ETYPE.yumihei.gunner || !ETYPE.teppo.gunner) throw new Error('弓と鉄砲が射手になっていない');
    if(!ETYPE.kibahei.rider || ETYPE.kibahei.riderKind!=='horse') throw new Error('騎馬が乗り手になっていない');
    if(!ETYPE.ninja.warper) throw new Error('忍びが背後を取らない');
    if(!ETYPE.taisho.buffer) throw new Error('足軽大将が味方を鼓舞しない');
    if(!ETYPE.samurai.riposte) throw new Error('侍が斬り返さない');
    // 湧きの抽選に入っていること
    if(SENGOKU_ZAKO_POOL.length!==14) throw new Error('抽選プールが14種でない: '+SENGOKU_ZAKO_POOL.length);
    // 増補ぶんも役割が重ならないこと
    if(!ETYPE.souhei.rager) throw new Error('薙刀僧兵が激昂しない');
    if(!(ETYPE.saika.shotWind < ETYPE.teppo.shotWind)) throw new Error('雑賀衆が鉄砲より速射でない');
    if(!(ETYPE.ozutsu.shotR > ETYPE.teppo.shotR)) throw new Error('大筒の弾が鉄砲より大きくない');
    if(!(ETYPE.ozutsu.shotWind > ETYPE.teppo.shotWind)) throw new Error('大筒の構えが鉄砲より長くない');
    if(!ETYPE.horo.rider) throw new Error('母衣武者が騎乗していない');
    if(!(ETYPE.horo.sp > ETYPE.kibahei.sp)) throw new Error('母衣武者が騎馬武者より速くない（軽騎兵のはず）');
    if(!(ETYPE.kunoichi.warper && ETYPE.kunoichi.gunner)) throw new Error('くノ一が背後＋吹き矢になっていない');
    if(!ETYPE.oodate.phalanx) throw new Error('大盾武者が盾を構えない');
    if(!ETYPE.hatamoto.flanker) throw new Error('旗本が回り込まない');
    { const sv=lap; lap=5; const seen={};
      for(let i=0;i<400;i++) seen[randZako()]=1;
      lap=sv;
      const miss=ZAKO.filter(k=>!seen[k]);
      if(miss.length) throw new Error('五周目の抽選に出ない兵種: '+miss.join(',')); }
    console.log('兵種 OK ('+ZAKO.length+'種／役割はすべて別／抽選にも全部出る)'); }

  // 絵：7種すべてが戦国の描画を通り、しかも形が違うこと
  { setupRoster('inu'); startGame(); state='play'; perfTier=0;
    let via=0; const real=drawSengokuFoe;
    drawSengokuFoe=function(){ via++; return real.apply(null,arguments); };
    const sig={};
    try {
      for(const k of ZAKO){ enemies.length=0; spawnEnemy(k, players[0].x+120, LANE);
        const e=enemies[0]; e.facing=-1; e.anim=1.0; e.state='walk';
        const r=shape(function(){ drawEnemy(e); });
        if(r.n<25) throw new Error(k+' がほとんど描かれていない: '+r.n+'コール');
        sig[k]=r.sig; } }
    finally { drawSengokuFoe=real; }
    if(via!==ZAKO.length) throw new Error('戦国の描画を通らない兵種がある ('+via+'/'+ZAKO.length+')');
    const ks=Object.keys(sig);
    for(let i=0;i<ks.length;i++) for(let j=i+1;j<ks.length;j++)
      if(sig[ks[i]]===sig[ks[j]]) throw new Error('兵種 '+ks[i]+' と '+ks[j]+' が同じ形');
    console.log('兵種の絵 OK ('+ZAKO.length+'種すべて drawSengokuFoe を通り、形も全部別)'); }

  // 弓と鉄砲の撃ち分け：色・弾速・構えの長さ・追尾の有無が違うこと
  { setupRoster('inu'); startGame(); state='play';
    const fire=function(k){ enemies.length=0; projectiles.length=0;
      spawnEnemy(k, players[0].x+300, LANE);
      const e=enemies[0]; const t=ETYPE[k];
      e.state='gunFire'; e.gunT=(t.shotWind||18); e.facing=-1;
      const wind=e.gunT;
      let shot=null;
      for(let f=0; f<wind+4 && !shot; f++){ hitStop=0; step(1); if(projectiles.length) shot=projectiles[0]; }
      if(!shot) throw new Error(k+' が撃たない');
      return {wind:wind, spd:Math.abs(shot.vx), col:shot.color, homing:!!shot.homing}; };
    const y=fire('yumihei'), g=fire('teppo'), m=fire('mechawan');
    if(y.homing || g.homing) throw new Error('矢や弾が追尾している（避けようがない）');
    if(!m.homing) throw new Error('前提が崩れている: メカワンコの弾は追尾のはず');
    if(!(g.wind>y.wind)) throw new Error('鉄砲の構えが弓より長くない: 弓'+y.wind+'F 鉄砲'+g.wind+'F');
    if(!(g.spd>y.spd)) throw new Error('鉄砲玉が矢より速くない: '+y.spd+' / '+g.spd);
    if(y.col===g.col) throw new Error('矢と弾が同じ色');
    if(!(ETYPE.teppo.dmg>ETYPE.yumihei.dmg)) throw new Error('鉄砲が弓より痛くない');
    console.log('射撃の撃ち分け OK (弓 '+y.wind+'F/'+y.spd+' 鉄砲 '+g.wind+'F/'+g.spd+'／どちらも直進)'); }

  // 撃った弾が実際に当たること。
  // 「弾が生まれたか」だけを見ていると、レーンがずれていて一度も当たらない弾を
  // 正常と判定してしまう（実際に弓と鉄砲の弾が主役の 50 手前を素通りしていた）
  { const dealt=function(k){
      setupRoster('inu'); startGame(); state='play';
      const p=players[0]; player=p; p.x=camX+200; p.y=LANE; p.hp=p.maxHp=9999; p.invuln=0; p.state='idle'; p.facing=1;
      enemies.length=0; projectiles.length=0; encounters.length=0;
      spawnEnemy(k, camX+560, LANE);
      const e=enemies[0]; e.facing=-1; e.thinkCd=99999; e.state='gunFire'; e.gunT=ETYPE[k].shotWind||18;
      for(let f=0; f<120; f++){ hitStop=0; p.invuln=0; e.thinkCd=99999; step(1); }
      return p.maxHp-p.hp; };
    const dy=dealt('yumihei'), dt=dealt('teppo'), dm=dealt('mechawan');
    if(!(dy>0)) throw new Error('弓の矢が一度も当たらない（レーンがずれている）');
    if(!(dt>0)) throw new Error('鉄砲の弾が一度も当たらない（レーンがずれている）');
    if(!(dm>0)) throw new Error('前提が崩れている: メカワンコの追尾弾は当たるはず');
    if(!(dt>dy)) throw new Error('鉄砲が弓より痛くない（実測）: 弓'+dy+' 鉄砲'+dt);
    console.log('弾が当たること OK (弓 -'+dy+'HP ／ 鉄砲 -'+dt+'HP ／ 追尾弾 -'+dm+'HP)'); }

  // 騎馬は突撃する（止まって殴るだけではない）
  { setupRoster('inu'); startGame(); state='play';
    enemies.length=0; const p=players[0]; player=p; p.hp=p.maxHp=99999; p.invuln=99999;
    p.x=camX+120; spawnEnemy('kibahei', camX+560, LANE);
    const e=enemies[0]; e.thinkCd=0; e.facing=-1;
    let charged=false, x0=e.x;
    for(let f=0;f<200 && !charged;f++){ hitStop=0; e.thinkCd=0; step(1); if(e.state==='bikecharge') charged=true; }
    if(!charged) throw new Error('騎馬が突撃しない');
    for(let f=0;f<40;f++){ hitStop=0; step(1); }
    if(!(Math.abs(e.x-x0)>120)) throw new Error('突撃で駆けていない: '+Math.abs(e.x-x0).toFixed(0)+'px');
    console.log('騎馬の突撃 OK ('+Math.abs(e.x-x0).toFixed(0)+'px 駆け抜ける)'); }

  // ===== 3) 三英傑 =====
  { for(const k of BOSS){ const t=ETYPE[k];
      if(!t) throw new Error('ボス '+k+' が無い');
      if(!t.boss) throw new Error(k+' がボス扱いでない');
      if(!SENGOKU_ART[t.bossKind]) throw new Error(k+' の絵の定義が無い');
      if(!BOSSMOVES[t.bossKind] || !BOSSMOVES[t.bossKind].length) throw new Error(k+' に技が無い');
      if(!BOSS_BGM[k]) throw new Error(k+' に専用BGMが無い');
      for(const mv of BOSSMOVES[t.bossKind]) if(!MV[mv]) throw new Error(k+' の技 '+mv+' が MV に無い'); }
    if(new Set(LORDS.map(k=>ETYPE[k].bossKind)).size!==LORDS.length) throw new Error('武将の種別が重複している');
    if(new Set(LORDS.map(k=>ETYPE[k].name)).size!==LORDS.length) throw new Error('武将の名前が重複している');
    for(const m of MINI) if(!ETYPE[m].mini) throw new Error(m+' が中ボス扱いになっていない');
    for(const b of BOSS) if(ETYPE[b].mini) throw new Error(b+' が中ボス扱いになっている（章のボスのはず）');
    // 章のボスは全員、他の誰も持たない技を1つ以上持っていること
    const sets=LORDS.map(k=>new Set(BOSSMOVES[ETYPE[k].bossKind]));
    LORDS.forEach(function(k,i){
      const own=[...sets[i]].filter(m=>!sets.some(function(o,j){ return j!==i && o.has(m); }));
      if(own.length<1) throw new Error(k+' に固有の大技が無い（誰かの使い回し）'); });
    console.log('武将 OK ('+BOSS.length+'人の章ボス＋'+MINI.length+'人の中ボス／全員に固有の大技と専用BGM)'); }

  // 兜の立物で見分けが付くこと（三人の絵が別であることの根拠）
  { const cnt={}, sig={};
    for(const k of LORDS){ const A=SENGOKU_ART[ETYPE[k].bossKind];
      const r=shape(function(){ cnt[k]=warCrest(A.crest,A,-40,10); });
      sig[k]=r.sig; }
    if(new Set(Object.values(cnt)).size<4) throw new Error('立物の本数がほとんど同じ: '+JSON.stringify(cnt));
    const ks=Object.keys(sig);
    for(let i=0;i<ks.length;i++) for(let j=i+1;j<ks.length;j++)
      if(sig[ks[i]]===sig[ks[j]]) throw new Error('立物 '+ks[i]+' と '+ks[j]+' が同じ形');
    console.log('兜の立物 OK ('+ks.length+'人すべて別の形)'); }

  // 三人の全身が別の絵であること
  // perfTier0 だと rimBegin が ctx の束縛をオフスクリーンへ差し替えるので、
  // 追跡している ctx から絵が消える（実測で10コールしか取れなかった）
  { setupRoster('inu'); startGame(); state='play'; perfTier=1;
    let via=0; const real=drawWarlord;
    drawWarlord=function(){ via++; return real.apply(null,arguments); };
    const sig={};
    try { for(const k of LORDS){ enemies.length=0; spawnEnemy(k, players[0].x+180, LANE);
        const e=enemies[0]; e.facing=-1; e.anim=1.0;
        const r=shape(function(){ drawEnemy(e); });
        if(r.n<60) throw new Error(k+' がほとんど描かれていない: '+r.n+'コール');
        sig[k]=r.sig; } }
    finally { drawWarlord=real; }
    if(via!==LORDS.length) throw new Error('武将の描画を通らないボスがいる ('+via+'/'+LORDS.length+')');
    const ks=Object.keys(sig);
    for(let i=0;i<ks.length;i++) for(let j=i+1;j<ks.length;j++)
      if(sig[ks[i]]===sig[ks[j]]) throw new Error('武将 '+ks[i]+' と '+ks[j]+' が同じ絵');
    console.log('武将の絵 OK ('+LORDS.length+'人すべて drawWarlord を通り、絵も全部別)'); }

  // ===== 4) 大技が実際に効くこと =====
  const setupBoss=function(k,mv){
    setupRoster('inu'); startGame(); state='play'; perfTier=1;
    const p=players[0]; player=p; p.hp=p.maxHp=99999; p.invuln=99999; p.x=camX+160;
    enemies.length=0; projectiles.length=0; hazards.length=0;
    spawnEnemy(k, camX+520, LANE);
    const e=enemies[0]; e.facing=-1; e.hp=e.maxHp=99999;
    e.state='bmove'; e.moveName=mv; e.moveT=0; e.moveMax=MV[mv].dur; e.telegraph=0; e.thinkCd=99999;
    return e; };
  const runMove=function(e,frames){ for(let f=0; f<frames; f++){ hitStop=0; e.thinkCd=99999;
      if(e.state!=='bmove'){ e.state='bmove'; }
      runBossMove(e); e.moveT++; } };

  // 信長：三段撃ち＝三度に分けて、別々の高さへ撃つ
  { const e=setupBoss('nobunaga','teppoVolley');
    const waves=[]; let prev=0;
    for(let f=0; f<MV.teppoVolley.dur; f++){ hitStop=0; runBossMove(e); e.moveT++;
      if(projectiles.length>prev){ waves.push({f:f, n:projectiles.length-prev, z:projectiles[projectiles.length-1].zz}); prev=projectiles.length; } }
    if(waves.length!==3) throw new Error('三段撃ちが三段になっていない: '+waves.length+'段');
    if(new Set(waves.map(w=>Math.round(w.z))).size!==3) throw new Error('三段が同じ高さ＝一度跳べば全部避けられる');
    for(const w of waves) if(w.n<3) throw new Error('一段が3発未満: '+w.n);
    if(projectiles.some(q=>q.homing)) throw new Error('鉄砲玉が追尾している');
    console.log('信長 三段撃ち OK (3段×'+waves[0].n+'発／高さ '+waves.map(w=>Math.round(w.z)).join('/')+')'); }

  // 信長：第六天魔王＝以後の攻撃力が上がる
  { const e=setupBoss('nobunaga','demonKing');
    const before=foeAtkMul(e);
    runMove(e, MV.demonKing.dur);
    const after=foeAtkMul(e);
    if(!(after>before*1.1)) throw new Error('第六天魔王で強くならない: '+before.toFixed(2)+' → '+after.toFixed(2));
    if(!e.rage) throw new Error('激昂していない');
    console.log('信長 第六天魔王 OK (攻撃力 '+before.toFixed(2)+' → '+after.toFixed(2)+')'); }

  // 信長：天下布武＝ガード不能の大薙ぎで実際に当たる
  { const e=setupBoss('nobunaga','tenkaFubu');
    const p=players[0]; p.invuln=0; p.hp=p.maxHp=99999; p.x=e.x-90;
    let hit=false; const realHurt=hurtPlayer;
    hurtPlayer=function(){ hit=true; return realHurt.apply(null,arguments); };
    try { runMove(e, MV.tenkaFubu.dur); } finally { hurtPlayer=realHurt; }
    if(!hit) throw new Error('天下布武が当たらない');
    console.log('信長 天下布武 OK (踏み込んで当たる)'); }

  // 秀吉：中国大返し＝画面を大きく往復する
  { const e=setupBoss('hideyoshi','ogaeshi');
    const x0=e.x; let far=0, turns=0, pf=e.facing;
    runMoveTrack: for(let f=0; f<MV.ogaeshi.dur; f++){ hitStop=0; runBossMove(e); e.moveT++;
      far=Math.max(far, Math.abs(e.x-x0)); if(e.facing!==pf){ turns++; pf=e.facing; } }
    if(!(far>200)) throw new Error('大返しで駆けていない: '+far.toFixed(0)+'px');
    console.log('秀吉 中国大返し OK ('+far.toFixed(0)+'px 往復／向き変え '+turns+'回)'); }

  // 秀吉：一夜城＝兵が湧き、本人も立て直す
  { const e=setupBoss('hideyoshi','ichiyaJo');
    e.hp=Math.round(e.maxHp*0.5); const hp0=e.hp;
    const n0=enemies.length;
    runMove(e, MV.ichiyaJo.dur);
    if(!(enemies.length>n0)) throw new Error('一夜城で兵が湧かない');
    if(!(e.hp>hp0)) throw new Error('一夜城で立て直さない: '+hp0+' → '+e.hp);
    console.log('秀吉 一夜城 OK (兵 +'+(enemies.length-n0)+'／HP '+hp0+' → '+e.hp+')'); }

  // 家康：鶴翼の陣＝左右から挟む
  { const e=setupBoss('ieyasu','kakuyoku');
    const p=players[0]; p.x=camX+400;
    const n0=enemies.length;
    runMove(e, MV.kakuyoku.dur);
    const added=enemies.slice(n0);
    if(added.length<2) throw new Error('鶴翼の陣で両翼が出ない: '+added.length+'体');
    const l=added.filter(o=>o.x<p.x).length, r=added.filter(o=>o.x>p.x).length;
    if(!(l>=1 && r>=1)) throw new Error('片側にしか出ていない（挟めていない）: 左'+l+' 右'+r);
    console.log('家康 鶴翼の陣 OK (左'+l+'体・右'+r+'体で挟む)'); }

  // 家康：三方ヶ原の反攻＝構え中に殴った分だけ返しが重くなる
  { const measure=function(dmgIn){
      const e=setupBoss('ieyasu','mikataGaeshi');
      const p=players[0]; p.invuln=0; p.hp=p.maxHp=999999; p.x=e.x-70;
      let got=0; const realHurt=hurtPlayer;
      hurtPlayer=function(q,d){ got=Math.max(got,d); return realHurt.apply(null,arguments); };
      try { for(let f=0; f<MV.mikataGaeshi.dur; f++){ hitStop=0;
          if(f===10 && dmgIn>0) damageEnemy(e, dmgIn, 0, false);
          runBossMove(e); e.moveT++; } }
      finally { hurtPlayer=realHurt; }
      return got; };
    const plain=measure(0), fed=measure(60);
    if(!(plain>0)) throw new Error('反攻が当たらない');
    if(!(fed>plain)) throw new Error('殴っても返しが重くならない: '+plain+' → '+fed);
    console.log('家康 三方ヶ原の反攻 OK (無傷 '+plain+' ／ 60ダメージ受けた後 '+fed+')'); }

  // ===== 4b) 二の矢：三人の戦い方をもう一段はっきりさせる技 =====
  // 信長：本能寺＝床に火柱を並べ、立てる場所を奪う
  { const e=setupBoss('nobunaga','honnoji');
    const p=players[0]; p.x=camX+400;
    hazards.length=0;
    runMove(e, MV.honnoji.dur);
    const fires=hazards.filter(h=>h.kind==='eplant'&&h.art==='fire');
    if(fires.length<4) throw new Error('火柱が並ばない: '+fires.length+'本');
    const xs=fires.map(h=>Math.round(h.x)).sort((a,b)=>a-b);
    if(new Set(xs).size!==fires.length) throw new Error('火柱が同じ場所に重なっている');
    if(!(xs[xs.length-1]-xs[0]>300)) throw new Error('火柱が固まっていて避け放題: 幅'+(xs[xs.length-1]-xs[0]));
    const warns=new Set(fires.map(h=>h.warn));
    if(warns.size<2) throw new Error('全部同時に立つ＝時間差になっていない');
    console.log('信長 本能寺 OK ('+fires.length+'本／幅'+(xs[xs.length-1]-xs[0])+'px／立つ時間差 '+warns.size+'段)'); }

  // 火柱は跳べば越えられる（立つ場所を奪う技であって、避けられない技ではない）
  { const burn=function(z){
      const e=setupBoss('nobunaga','honnoji');
      const p=players[0]; player=p; p.x=camX+400; p.hp=p.maxHp=99999; p.invuln=0;
      hazards.length=0;
      for(let f=0; f<MV.honnoji.dur; f++){ hitStop=0; p.invuln=0; p.z=z;
        runBossMove(e); e.moveT++; updateHazards(); }
      return p.maxHp-p.hp; };
    const onGround=burn(0), inAir=burn(70);
    if(!(onGround>0)) throw new Error('火柱が当たらない');
    if(inAir>0) throw new Error('跳んでも火柱に焼かれる（避けようがない）');
    console.log('火柱の抜け方 OK (地上 -'+onGround+'HP ／ 跳べば 0)'); }

  // 信長：南蛮筒＝長い溜めから極太の一発。跳べば越えられる高さ
  { const e=setupBoss('nobunaga','nanbanZutsu');
    projectiles.length=0;
    let shotAt=-1;
    for(let f=0; f<MV.nanbanZutsu.dur; f++){ hitStop=0; runBossMove(e); e.moveT++;
      if(projectiles.length && shotAt<0) shotAt=f; }
    if(shotAt<0) throw new Error('南蛮筒が撃たない');
    if(!(shotAt>=20)) throw new Error('溜めが短すぎる: '+shotAt+'F');
    const pr=projectiles[0];
    const vol=ETYPE.nobunaga.dmg;
    if(!(pr.r>=20)) throw new Error('極太の弾になっていない: r='+pr.r);
    if(!(pr.dmg>vol)) throw new Error('普段の技より軽い: '+pr.dmg+' vs '+vol);
    if(pr.homing) throw new Error('大筒が追尾している');
    console.log('信長 南蛮筒 OK ('+shotAt+'F 溜め／半径'+pr.r+'／'+pr.dmg+'ダメージ／直進)'); }

  // 秀吉：千成瓢箪＝撒いて時間差で弾ける
  { const e=setupBoss('hideyoshi','hyotan');
    hazards.length=0;
    runMove(e, MV.hyotan.dur);
    const g=hazards.filter(h=>h.kind==='eplant'&&h.art==='gourd');
    if(g.length<3) throw new Error('瓢箪が撒かれない: '+g.length+'個');
    if(new Set(g.map(h=>Math.round(h.x))).size!==g.length) throw new Error('同じ場所に重なっている');
    if(!(g[0].warn>=20)) throw new Error('置いた瞬間に弾ける（予兆が無い）: '+g[0].warn+'F');
    console.log('秀吉 千成瓢箪 OK ('+g.length+'個／'+g[0].warn+'F 後に弾ける)'); }

  // 秀吉：猿飛＝頭上を跳び越えて背後へ回る
  { const e=setupBoss('hideyoshi','saruTobi');
    const p=players[0]; p.x=camX+400; e.x=camX+200; e.facing=1;
    const side0=Math.sign(e.x-p.x);
    let peak=0, crossed=false;
    for(let f=0; f<MV.saruTobi.dur; f++){ hitStop=0; runBossMove(e); e.moveT++;
      peak=Math.max(peak,e.z||0);
      if(Math.sign(e.x-p.x)!==side0 && Math.sign(e.x-p.x)!==0) crossed=true; }
    if(!(peak>60)) throw new Error('跳ばずに走っているだけ: 最高'+peak.toFixed(0));
    if(!crossed) throw new Error('主役を跳び越していない（背後を取れていない）');
    if(e.z!==0) throw new Error('技が終わっても宙に浮いたまま: z='+e.z);
    console.log('秀吉 猿飛 OK (最高'+peak.toFixed(0)+'／主役を跳び越す／着地する)'); }

  // 家康：影武者＝姿を消し、三つの影のどれかから出る
  { const seen=new Set();
    for(let trial=0; trial<24; trial++){
      const e=setupBoss('ieyasu','kagemusha');
      const p=players[0]; p.x=camX+400; e.x=camX+700;
      let hid=false;
      for(let f=0; f<MV.kagemusha.dur; f++){ hitStop=0; runBossMove(e); e.moveT++;
        if(e.vanish>0) hid=true; }
      if(!hid) throw new Error('姿を消していない');
      if(!e.kmX || e.kmX.length!==3) throw new Error('影が3つ立たない');
      seen.add(Math.round(e.x)); }
    if(seen.size<2) throw new Error('毎回同じ影から出てくる（読まれる）: '+[...seen].join(','));
    console.log('家康 影武者 OK (三つの影／出る位置が '+seen.size+'通り)'); }

  // 家康：槍衾＝周囲が槍で埋まり、近づけない
  { const e=setupBoss('ieyasu','yaribusuma');
    hazards.length=0;
    runMove(e, 20);
    const y=hazards.filter(h=>h.kind==='eplant'&&h.art==='yari');
    if(y.length<4) throw new Error('槍衾が立たない: '+y.length+'本');
    const L=y.filter(h=>h.x<e.x).length, R=y.filter(h=>h.x>e.x).length;
    if(!(L>=2 && R>=2)) throw new Error('片側にしか立たない: 左'+L+' 右'+R);
    // 近づけば刺さり、離れていれば無事
    const stab=function(dx){
      const e2=setupBoss('ieyasu','yaribusuma');
      const p=players[0]; player=p; p.hp=p.maxHp=99999; p.invuln=0; p.z=0;
      hazards.length=0;
      for(let f=0; f<MV.yaribusuma.dur; f++){ hitStop=0; p.invuln=0; p.x=e2.x+dx;
        runBossMove(e2); e2.moveT++; updateHazards(); }
      return p.maxHp-p.hp; };
    const near=stab(60), far=stab(340);
    if(!(near>0)) throw new Error('槍衾に近づいても刺さらない');
    if(far>0) throw new Error('離れていても刺さる（引く選択肢が無い）');
    console.log('家康 槍衾 OK ('+y.length+'本 左'+L+'/右'+R+'／近60px -'+near+'HP ／遠340px 0)'); }

  // 三人の技構成が別物であること
  { const T3=['nobunaga','hideyoshi','ieyasu'];
    const sets=T3.map(k=>BOSSMOVES[ETYPE[k].bossKind]);
    for(let i=0;i<3;i++){
      const own=sets[i].filter(m=>!sets[(i+1)%3].includes(m)&&!sets[(i+2)%3].includes(m));
      if(own.length<5) throw new Error(T3[i]+' の固有技が5つ未満: '+own.join(',')); }
    console.log('三英傑の手札 OK (固有技が一人5つ以上／'+sets.map(x=>x.length).join('/')+'手)'); }

  // ===== 4c) 戦闘前の口上 =====
  // 全員が汎用の「いざ尋常に勝負！」に落ちていた
  { const MYTH=['poseidon','hades','zeus'];
    const HERO=['inu','shima','nuko','guard8','watch','wanden'];
    // 増えた武将は汎用の口上まで。主役ごとの言い分けは元の6人ぶん
    { const add=LORDS.filter(k=>['nobunaga','hideyoshi','ieyasu'].indexOf(k)<0);
      const qs=add.map(function(k){ const q=BOSSQUOTE[k];
        if(!q) throw new Error(k+' に口上が無い');
        if(q.indexOf('いざ尋常')>=0) throw new Error(k+' が汎用の口上のまま');
        return q; });
      if(new Set(qs).size!==add.length) throw new Error('増えた武将の口上が重複している');
      console.log('増えた武将の口上 OK ('+add.length+'人ぶん、すべて別)'); }
    const all=[];
    // 主役ごとの言い分けを持つのは神話の三柱と三英傑。増えた武将は汎用のみ（上で検査済み）
    for(const k of MYTH.concat(['nobunaga','hideyoshi','ieyasu'])){
      const q=BOSSQUOTE[k];
      if(!q) throw new Error(k+' に口上が無い');
      if(q.indexOf('いざ尋常')>=0) throw new Error(k+' が汎用の口上のまま');
      all.push(q);
      // 主役ごとの言い分けもあること
      const by=BOSSQUOTE_BY[k];
      if(!by) throw new Error(k+' に主役ごとの口上が無い');
      const sv=players[0].kind, per=[];
      for(const h of HERO){ players[0].kind=h;
        const line=bossQuoteFor(k);
        if(!line) throw new Error(k+' × '+h+' の口上が空');
        if(line===q) throw new Error(k+' が '+h+' 用の口上を持っていない');
        per.push(line); }
      players[0].kind=sv;
      if(new Set(per).size!==HERO.length) throw new Error(k+' の主役別口上が重複している');
      all.push.apply(all, per); }
    if(new Set(all).size!==all.length) throw new Error('口上が他のボスと重複している');
    console.log('戦闘前の口上 OK (6ボス×(汎用＋主役6人)＝'+all.length+'種、すべて別)'); }

  // ===== 4d) 増えた武将の大技が実際に効くこと =====
  // 信玄：風林火山＝四つの相。相ごとに起きることが違う
  { const e=setupBoss('shingen','fuurinkazan');
    const p=players[0]; player=p; p.x=camX+380; p.hp=p.maxHp=99999;
    hazards.length=0; e.hp=Math.round(e.maxHp*0.5);
    const hp0=e.hp; let moved=0, x0=e.x, healed=0, fires=0, guarded=0;
    for(let f=0; f<MV.fuurinkazan.dur; f++){ hitStop=0; const bx=e.x;
      runBossMove(e); e.moveT++;
      moved+=Math.abs(e.x-bx);
      if(e.hp>hp0) healed=e.hp-hp0;
      if(e.guardT>0) guarded++;
      fires=hazards.filter(h=>h.kind==='eplant'&&h.art==='fire').length; }
    if(!(moved>120)) throw new Error('風の相で駆けていない: '+moved.toFixed(0)+'px');
    if(!(healed>0)) throw new Error('林の相で立て直していない');
    if(!(fires>=3)) throw new Error('火の相で火柱が出ない: '+fires+'本');
    if(!(guarded>0)) throw new Error('山の相で構えていない');
    console.log('信玄 風林火山 OK (風 '+moved.toFixed(0)+'px ／ 林 +'+healed+'HP ／ 火 '+fires+'本 ／ 山 '+guarded+'F)'); }

  // 謙信：車懸り＝回りながら前へ出て、当て続ける
  { const e=setupBoss('kenshin','kurumagakari');
    const p=players[0]; player=p; p.invuln=0; p.hp=p.maxHp=99999; p.x=e.x-70;
    let hits=0, spin0=e.spin||0, travel=0;
    const realHurt=hurtPlayer; hurtPlayer=function(){ hits++; return realHurt.apply(null,arguments); };
    try { for(let f=0; f<MV.kurumagakari.dur; f++){ hitStop=0; p.invuln=0; const bx=e.x;
      runBossMove(e); e.moveT++; travel+=Math.abs(e.x-bx); } }
    finally { hurtPlayer=realHurt; }
    // 主役を追って向きを変えるので、正味の移動ではなく走った総距離で見る
    if(!(travel>240)) throw new Error('車懸りで走っていない: '+travel.toFixed(0)+'px');
    if(!((e.spin||0)>spin0+3)) throw new Error('回転していない: '+(e.spin||0).toFixed(1));
    if(!(hits>=3)) throw new Error('連続で当たらない: '+hits+'回');
    console.log('謙信 車懸り OK ('+travel.toFixed(0)+'px 走って '+hits+'回当たる)'); }

  // 義元：上洛の行列＝兵を並べながら悠々と前進する
  { const e=setupBoss('yoshimoto','jouraku');
    const n0=enemies.length, x0=e.x;
    runMove(e, MV.jouraku.dur);
    if(!(enemies.length>n0)) throw new Error('行列に兵が付かない');
    if(!(Math.abs(e.x-x0)>60)) throw new Error('行列が進まない: '+Math.abs(e.x-x0).toFixed(0)+'px');
    console.log('義元 上洛の行列 OK (兵 +'+(enemies.length-n0)+'／'+Math.abs(e.x-x0).toFixed(0)+'px 前進)'); }

  // 光秀：謀反の一閃＝背後を取ってからガード不能
  { const e=setupBoss('mitsuhide','muhon');
    const p=players[0]; player=p; p.invuln=0; p.hp=p.maxHp=99999; p.x=camX+300; p.facing=1;
    const side0=Math.sign(e.x-p.x);
    let hit=false, crossed=false;
    const realHurt=hurtPlayer; hurtPlayer=function(){ hit=true; return realHurt.apply(null,arguments); };
    try { for(let f=0; f<MV.muhon.dur; f++){ hitStop=0; p.invuln=0; runBossMove(e); e.moveT++;
      if(Math.sign(e.x-p.x)===-side0) crossed=true; } }
    finally { hurtPlayer=realHurt; }
    if(!crossed) throw new Error('背後へ回っていない');
    if(!hit) throw new Error('謀反の一閃が当たらない');
    console.log('光秀 謀反の一閃 OK (背後を取って命中)'); }

  // 勝頼：赤備え＝騎馬が三騎、時間差で横切る
  { const e=setupBoss('katsuyori','akazonae');
    hazards.length=0;
    const times=[];
    for(let f=0; f<MV.akazonae.dur; f++){ hitStop=0; const n0=hazards.length;
      runBossMove(e); e.moveT++;
      if(hazards.length>n0) times.push(f); }
    if(times.length!==3) throw new Error('騎馬が三騎でない: '+times.length+'騎');
    if(!(times[2]-times[0]>=24)) throw new Error('三騎が同時に出ている（時間差になっていない）');
    const dirs=new Set(hazards.filter(h=>h.kind==='ebeast').map(h=>Math.sign(h.vx)));
    if(dirs.size<2) throw new Error('全部同じ向きから来る（左右に散っていない）');
    console.log('勝頼 赤備え OK (3騎／出る間隔 '+(times[2]-times[0])+'F／左右から)'); }

  // 久秀：平蜘蛛＝溜めてから大爆発。離れていれば躱せる
  { const boom=function(dx){
      const e=setupBoss('hisahide','hiragumo');
      const p=players[0]; player=p; p.invuln=0; p.hp=p.maxHp=99999; p.x=e.x+dx;
      let got=0; const realHurt=hurtPlayer;
      hurtPlayer=function(q,d){ got=Math.max(got,d); return realHurt.apply(null,arguments); };
      try { for(let f=0; f<MV.hiragumo.dur; f++){ hitStop=0; p.invuln=0; p.x=e.x+dx; runBossMove(e); e.moveT++; } }
      finally { hurtPlayer=realHurt; }
      return got; };
    const near=boom(90), far=boom(320);
    if(!(near>0)) throw new Error('平蜘蛛が当たらない');
    if(far>0) throw new Error('離れていても当たる（溜めの意味が無い）');
    console.log('久秀 平蜘蛛 OK (近90px -'+near+' ／遠320px 0)'); }

  // 半兵衛：采配＝味方を強化する（本人は殴らない）
  { const e=setupBoss('hanbei','saihai');
    spawnEnemy('ashigaru', e.x-80, LANE); const ally=enemies[enemies.length-1];
    ally.buffTill=0;
    runMove(e, MV.saihai.dur);
    if(!(ally.buffTill>gf)) throw new Error('味方が鼓舞されない: buffTill='+ally.buffTill+' gf='+gf);
    console.log('半兵衛 采配 OK (味方の強化が '+(ally.buffTill-gf)+'F 続く)'); }

  // 官兵衛：水攻め＝床が水になり、立っていられなくなる
  { const e=setupBoss('kanbei','mizuzeme');
    const p=players[0]; player=p; p.invuln=0; p.hp=p.maxHp=99999; p.z=0;
    hazards.length=0;
    let pushed=0;
    // 被弾のノックバックも p.vx を動かすので、HPが減らなかったフレームだけを見る。
    // これを分けないと「押し流し」を消しても被弾の反動で素通りする
    for(let f=0; f<MV.mizuzeme.dur; f++){ hitStop=0; p.invuln=0; p.vx=0; p.x=e.x-60; p.z=0;
      const hp0=p.hp;
      runBossMove(e); e.moveT++; updateHazards();
      if(p.hp===hp0) pushed=Math.max(pushed, Math.abs(p.vx)); }
    const w=hazards.filter(h=>h.kind==='eplant'&&h.art==='water');
    if(w.length<3) throw new Error('水が広がらない: '+w.length+'面');
    if(!(pushed>0.5)) throw new Error('水に押し流されない: vx='+pushed.toFixed(2));
    if(!(p.hp<p.maxHp)) throw new Error('水に浸かっても削られない');
    console.log('官兵衛 水攻め OK ('+w.length+'面／押し流し vx='+pushed.toFixed(1)+'／-'+(p.maxHp-p.hp)+'HP)'); }

  // ===== 4e) ラスボスの三段変身 =====
  // 四周目のゼウスと五周目の信長は、倒すたびに次の形態へ進化する
  { const chain=function(k){ const r=[]; let ty=k, g=0;
      while(ty && g++<8){ r.push(ty); ty=ETYPE[ty].evolveTo; } return r; };
    for(const head of ['zeus','nobunaga']){
      const c=chain(head);
      if(c.length!==3) throw new Error(head+' の形態が3つでない: '+c.join('→'));
      // 途中の形態で決着が付いてはいけない（evolveTo が先に見られるので実害はないが、意図の宣言）
      for(let i=0;i<2;i++) if(ETYPE[c[i]].finalBoss) throw new Error(c[i]+' が最終扱いになっている');
      if(!ETYPE[c[2]].finalBoss) throw new Error(c[2]+' が最終扱いでない（エンディングに繋がらない）');
      if(!ETYPE[c[2]].trueBoss) throw new Error(c[2]+' が真ボス扱いでない');
      // 形態が進むほど、速く・重く・間合いが広くなること
      for(let i=1;i<3;i++){
        if(!(ETYPE[c[i]].sp > ETYPE[c[i-1]].sp)) throw new Error(c[i]+' が前の形態より遅い: '+ETYPE[c[i-1]].sp+' → '+ETYPE[c[i]].sp);
        if(!(ETYPE[c[i]].dmg > ETYPE[c[i-1]].dmg)) throw new Error(c[i]+' が前の形態より軽い');
        if(!(ETYPE[c[i]].atkR > ETYPE[c[i-1]].atkR)) throw new Error(c[i]+' が前の形態より間合いが狭い');
        if(!(ETYPE[c[i]].h > ETYPE[c[i-1]].h)) throw new Error(c[i]+' が前の形態より小さい'); }
      // 名前・BGM・口上・肩書きが形態ごとに別であること
      if(new Set(c.map(x=>ETYPE[x].name)).size!==3) throw new Error(head+' の形態名が重複している');
      if(new Set(c.map(x=>BOSS_BGM[x])).size!==3) throw new Error(head+' の形態でBGMが変わらない: '+c.map(x=>BOSS_BGM[x]).join('/'));
      for(const x of c) if(!BOSSQUOTE[x]) throw new Error(x+' に口上が無い（変身デモが「…」になる）');
      if(new Set(c.map(x=>BOSSQUOTE[x])).size!==3) throw new Error(head+' の形態の口上が重複している');
      for(let i=1;i<3;i++) if(!BOSSROLE[c[i]]) throw new Error(c[i]+' に肩書きが無い');
      // 技も形態ごとに変わること
      for(const x of c) if(!BOSSMOVES[ETYPE[x].bossKind]) throw new Error(x+' に技が無い');
      const sets=c.map(x=>BOSSMOVES[ETYPE[x].bossKind].join(','));
      if(new Set(sets).size!==3) throw new Error(head+' の形態で技構成が変わらない');
      console.log('  '+head+' の三段 OK ('+c.map(x=>ETYPE[x].name).join(' → ')+')'); }
    console.log('ラスボスの三段変身 OK (ゼウス・信長とも3形態／速さ・重さ・間合い・体格が段ごとに上がる)'); }

  // 実際に倒すと次の形態へ進化し、三段目で決着すること
  { setupRoster('inu'); startGame(); state='play'; lap=5; hardMode=false;
    const p=players[0]; player=p; p.hp=p.maxHp=99999; p.invuln=99999;
    enemies.length=0; encounters.length=0;
    spawnEnemy('nobunaga', p.x+240, LANE);
    const e=enemies[0]; e.thinkCd=99999;
    const seen=[e.type];
    for(let phase=0; phase<2; phase++){
      const before=e.type;
      e.hp=1; killEnemy(e);
      if(e.type===before) throw new Error(before+' を倒しても進化しない');
      if(e.dead) throw new Error(before+' で決着してしまった（最終形態でないのに）');
      if(!(e.transform>0)) throw new Error('進化の演出（無敵）が入っていない');
      if(e.hp!==e.maxHp) throw new Error('進化後にHPが満タンでない: '+e.hp+'/'+e.maxHp);
      seen.push(e.type); }
    if(seen.join('→')!=='nobunaga→nobunaga2→nobunaga3') throw new Error('進化の順番が違う: '+seen.join('→'));
    // 三段目は本当に死ぬ
    e.hp=1; killEnemy(e);
    if(!e.dead) throw new Error('最終形態を倒しても決着しない');
    console.log('進化の連鎖 OK ('+seen.join(' → ')+'／三段目で決着)'); }

  // 最終形態の絵が武将の絵ではなく専用の魔王の絵であること
  { setupRoster('inu'); startGame(); state='play'; perfTier=1;
    let viaDemon=0, viaLord=0;
    const rd=drawDemonKing, rw=drawWarlord;
    drawDemonKing=function(){ viaDemon++; return rd.apply(null,arguments); };
    drawWarlord=function(){ viaLord++; return rw.apply(null,arguments); };
    const sig={};
    try { for(const k of ['nobunaga','nobunaga2','nobunaga3']){
        enemies.length=0; spawnEnemy(k, players[0].x+200, LANE);
        const e=enemies[0]; e.facing=-1; e.anim=1.0;
        const r=shape(function(){ drawEnemy(e); });
        if(r.n<60) throw new Error(k+' がほとんど描かれていない: '+r.n+'コール');
        sig[k]=r.sig; } }
    finally { drawDemonKing=rd; drawWarlord=rw; }
    if(viaDemon!==1) throw new Error('魔王の絵を通るのが1形態でない: '+viaDemon);
    if(viaLord!==2) throw new Error('武将の絵を通るのが2形態でない: '+viaLord);
    const ks=Object.keys(sig);
    for(let i=0;i<ks.length;i++) for(let j=i+1;j<ks.length;j++)
      if(sig[ks[i]]===sig[ks[j]]) throw new Error('形態 '+ks[i]+' と '+ks[j]+' が同じ絵');
    console.log('三形態の絵 OK (人→鬼は武将の絵／魔王だけ専用の絵／三つとも別の形)'); }

  // 最終形態の三技が効くこと
  { const e=setupBoss('nobunaga3','maouRush');
    const p=players[0]; player=p; p.invuln=0; p.hp=p.maxHp=99999; p.x=e.x-120;
    let travel=0, turns=0, pf=e.facing, hits=0;
    const realHurt=hurtPlayer; hurtPlayer=function(){ hits++; return realHurt.apply(null,arguments); };
    try { for(let f=0; f<MV.maouRush.dur; f++){ hitStop=0; p.invuln=0; const bx=e.x;
      runBossMove(e); e.moveT++; travel+=Math.abs(e.x-bx); if(e.facing!==pf){ turns++; pf=e.facing; } } }
    finally { hurtPlayer=realHurt; }
    if(!(travel>700)) throw new Error('魔王の疾走で走っていない: '+travel.toFixed(0)+'px');
    if(!(turns>=2)) throw new Error('往復していない: 向き変え '+turns+'回');
    if(!(hits>0)) throw new Error('疾走が当たらない');
    console.log('魔王の疾走 OK ('+travel.toFixed(0)+'px 走り／向き変え '+turns+'回／命中)'); }

  { const e=setupBoss('nobunaga3','hellFlame');
    hazards.length=0;
    runMove(e, MV.hellFlame.dur);
    const fires=hazards.filter(h=>h.kind==='eplant'&&h.art==='fire');
    if(fires.length<8) throw new Error('業火の火柱が少ない: '+fires.length+'本');
    const xs=fires.map(h=>h.x);
    if(!(Math.max.apply(null,xs)-Math.min.apply(null,xs) > 700))
      throw new Error('業火が画面の端まで届いていない: 幅'+(Math.max.apply(null,xs)-Math.min.apply(null,xs)).toFixed(0));
    if(new Set(fires.map(h=>h.warn)).size<5) throw new Error('全部同時に立つ（隙間を選べない）');
    console.log('業火 OK ('+fires.length+'本／幅'+(Math.max.apply(null,xs)-Math.min.apply(null,xs)).toFixed(0)+'px／時間差 '+new Set(fires.map(h=>h.warn)).size+'段)'); }

  { const e=setupBoss('nobunaga3','demonDive');
    // 空中のボスは汎用の追尾で毎フレーム2pxだけ寄る。近くに置くとそれだけで届いてしまい、
    // この技の「主役の真上へ一気に寄る」部分を検査できない。遠くに置いて速さで見る
    const p=players[0]; player=p; p.invuln=0; p.hp=p.maxHp=99999; p.x=e.x-400;
    let peak=0, hit=false, near=1e9;
    const realHurt=hurtPlayer; hurtPlayer=function(){ hit=true; return realHurt.apply(null,arguments); };
    try { for(let f=0; f<MV.demonDive.dur; f++){ hitStop=0; p.invuln=0;
      runBossMove(e); e.moveT++; peak=Math.max(peak,e.z||0);
      if((e.z||0)>100) near=Math.min(near, Math.abs(e.x-p.x)); } }
    finally { hurtPlayer=realHurt; }
    if(!(peak>200)) throw new Error('舞い上がっていない: 最高'+peak.toFixed(0));
    // 汎用の追尾だけなら 51フレーム×2px＝102px しか詰められない（残り約300px）
    if(!(near<80)) throw new Error('主役の真上へ寄っていない: 最接近 '+near.toFixed(0)+'px');
    if(e.z!==0) throw new Error('技が終わっても宙に浮いたまま: z='+e.z);
    if(!hit) throw new Error('着地の衝撃が当たらない');
    console.log('天魔墜つ OK (最高'+peak.toFixed(0)+'／真上へ '+near.toFixed(0)+'px まで寄る／着地で命中)'); }

  { const e=setupBoss('zeus3','tenchuu');
    hazards.length=0;
    const waves=[]; let prev=0;
    for(let f=0; f<MV.tenchuu.dur; f++){ hitStop=0; runBossMove(e); e.moveT++;
      if(hazards.length>prev){ waves.push(hazards.length-prev); prev=hazards.length; } }
    if(waves.length!==3) throw new Error('天誅が三波でない: '+waves.length+'波');
    if(!(waves[2]>waves[0])) throw new Error('波を追うごとに本数が増えていない: '+waves.join('/'));
    const xs=hazards.map(h=>h.x);
    if(!(Math.max.apply(null,xs)-Math.min.apply(null,xs) > 600)) throw new Error('落雷が画面全体に散っていない');
    console.log('天誅 OK ('+waves.join('→')+'本の三波／幅'+(Math.max.apply(null,xs)-Math.min.apply(null,xs)).toFixed(0)+'px)'); }

  // ===== 5) 背景の三景 =====
  { const idx=[]; STAGE_THEME.forEach(function(T,i){ if(T.sengoku) idx.push(i); });
    if(idx.length!==6) throw new Error('戦国のテーマが6つでない: '+idx.length);
    const lands=idx.map(i=>STAGE_THEME[i].land), fgs=idx.map(i=>STAGE_THEME[i].fg);
    for(const l of lands) if(!LAND[l]) throw new Error('地形 '+l+' が未実装（既定の尾根に落ちる）');
    if(new Set(lands).size!==6) throw new Error('六景の地形が重複している: '+lands.join(','));
    const sig={};
    for(const l of lands){ const r=shape(function(){ LAND[l](STAGE_THEME[idx[0]]); });
      if(r.n<40) throw new Error('地形 '+l+' がほとんど描かれていない: '+r.n);
      sig[l]=r.sig; }
    const ks=Object.keys(sig);
    for(let i=0;i<ks.length;i++) for(let j=i+1;j<ks.length;j++)
      if(sig[ks[i]]===sig[ks[j]]) throw new Error('地形 '+ks[i]+' と '+ks[j]+' が同じ形');
    // 炎上する天守に白い雲を浮かべない（夜の火事に昼の雲が出る）
    const fire=idx.filter(i=>STAGE_THEME[i].land==='tenshu')[0];
    if(fire==null) throw new Error('天守のテーマが無い');
    let cloudCalls=0; const realCloud=cloud; cloud=function(){ cloudCalls++; };
    try { const sv=STAGE2THEME[stage]; STAGE2THEME[stage]=fire; bgCacheTheme=-1;
      shape(function(){ drawBackground(); });
      STAGE2THEME[stage]=sv; bgCacheTheme=-1; }
    finally { cloud=realCloud; }
    if(cloudCalls>0) throw new Error('炎上する天守に雲が '+cloudCalls+'個 浮いている');
    console.log('戦国の六景 OK ('+lands.join('/')+' が別の形／天守に雲0個)'); }

  // ===== 厚みと迫力（武将・魔王・火柱） =====
  const lum2=function(c){ let r,g2,b;
    if(c.charCodeAt(0)===35){ const n=c.length===4?c[1]+c[1]+c[2]+c[2]+c[3]+c[3]:c.slice(1);
      r=parseInt(n.substr(0,2),16); g2=parseInt(n.substr(2,2),16); b=parseInt(n.substr(4,2),16); }
    else { const i=c.indexOf('('), j=c.lastIndexOf(')');
      if(i<0) return -1;
      const p=c.slice(i+1,j).split(','); r=parseFloat(p[0]); g2=parseFloat(p[1]); b=parseFloat(p[2]);
      if(p.length>3 && parseFloat(p[3])<0.5) return -1; }
    if(!isFinite(r)) return -1;
    return 0.30*r+0.59*g2+0.11*b; };
  const gradSpan2=function(fn){
    const real=ctx; let best=0;
    ctx=new Proxy(real,{ get:function(t,k){
      if(k==='createLinearGradient'){ return function(){
        const ls=[];
        return { addColorStop:function(p,c){ const L=lum2(String(c)); if(L>=0) ls.push(L);
            if(ls.length>1){ const s=Math.max.apply(null,ls)-Math.min.apply(null,ls); if(s>best) best=s; } } }; }; }
      return t[k]; } });
    try{ fn(); } finally { ctx=real; }
    return best; };
  { startNG5(true);
    for(const k of LORDS.concat(['nobunaga2','nobunaga3'])){
      enemies.length=0; spawnEnemy(k,camX+300,LANE);
      const e=enemies[0]; perfTier=1;
      const span=gradSpan2(function(){ drawEnemy(e); });
      if(span<40) throw new Error(k+' の塊がベタ塗りに近い（塗りの明度差 '+Math.round(span)+' / 40以上ほしい）'); }
    enemies.length=0;
    console.log('武将と魔王の塊に厚みがある OK ('+(LORDS.length+2)+'体)'); }

  // 火柱は、焼いた渦のスプライトを高さ200px超で貼ること（以前の炎は120px前後の三角だった）
  { startNG5(true); hazards.length=0; enemies.length=0;
    const sp=fireSprites();
    if(!sp || sp.length<4) throw new Error('炎の渦のスプライトが焼かれていない');
    hazards.push({kind:'eplant', art:'fire', x:camX+300, y:LANE, t:40, warn:16, dur:900, life:9000, dmg:10, col:'#ff8a3a'});
    const real=ctx; let tall=0, wide=0, n=0;
    ctx=new Proxy(real,{ get:function(t,k){
      if(k==='drawImage'){ return function(img,a,b2,c,d){ n++;
        if(d>tall) tall=d; if(c>wide) wide=c; }; }
      return t[k]; } });
    try{ perfTier=1; drawHazards(); } finally { ctx=real; }
    hazards.length=0;
    if(!n) throw new Error('火柱が渦のスプライトを使っていない');
    if(tall<200) throw new Error('火柱が低い（'+Math.round(tall)+' / 200以上ほしい）');
    if(wide<80) throw new Error('火柱が細い（'+Math.round(wide)+' / 80以上ほしい）');
    console.log('火柱が炎の大竜巻になっている OK (高さ'+Math.round(tall)+' 幅'+Math.round(wide)+')'); }

  // ===== 半兵衛の召喚は、この戦いで合計8体まで =====
  { startNG5(true); enemies.length=0; hazards.length=0; projectiles.length=0;
    const pl=players[0]; pl.active=true; pl.state='idle'; pl.x=400; pl.y=LANE; pl.z=0; pl.hp=pl.maxHp;
    spawnEnemy('hanbei', 700, LANE);
    const e=enemies[0];
    if(!e || ETYPE[e.type].bossKind!=='hanbei') throw new Error('半兵衛が出ていない');
    let total=0;
    for(let round=0; round<12; round++){
      for(const mv of ['kakuyoku','saihai']){
        e.state='bmove'; e.moveName=mv; e.moveMax=60;
        for(let f=1; f<=50; f++){ e.moveT=f; runBossMove(e); } }
      // 湧いた兵を数えて片付ける。倒すそばから湧く状況を再現しないと、
      // 同時数の頭打ち(4体)に隠れて「総数が無限」であることが見えない
      for(let i=enemies.length-1;i>=0;i--) if(enemies[i]!==e){ total++; enemies.splice(i,1); } }
    enemies.length=0;
    if(total>8) throw new Error('半兵衛が合計 '+total+' 体呼んだ（8体まで）');
    if(total<4) throw new Error('半兵衛が兵をほとんど呼ばない（合計 '+total+'体）');
    console.log('半兵衛の召喚 OK (12周ぶん回して合計 '+total+' 体)'); }

  // ===== 3ステージ目でラスボス（炎上する天守）を選べる =====
  { startNG5(true);
    const fin=allMapNodes().filter(function(n){ return n.final; })[0];
    const norm=curWorldLevels().filter(function(n){ return !n.final; });
    if(!fin) throw new Error('天守のノードが無い');
    if(norm.length<2) throw new Error('通常ステージが2つ未満');
    levelsDone={};
    if(nodeUnlocked(fin)) throw new Error('制覇0で天守が解禁されている');
    levelsDone[norm[0].id]=true;
    if(nodeUnlocked(fin)) throw new Error('制覇1で天守が解禁されている（2ステージ目で挑めてしまう）');
    levelsDone[norm[1].id]=true;
    if(!nodeUnlocked(fin)) throw new Error('制覇2でも天守が解禁されない（3ステージ目に選べない）');
    if(!nodeEnterable(fin)) throw new Error('天守が解禁されても入れない');
    levelsDone={};
    console.log('天守の解禁 OK (2ステージ制覇＝3ステージ目に選べる)'); }

  console.log('SENGOKU TEST PASSED'); process.exit(0);
})().catch(e=>{ console.error('FAIL:', e.message, e.stack); process.exit(1); });
`;
code = code + "\n;" + DRIVER;
(0, eval)(code);

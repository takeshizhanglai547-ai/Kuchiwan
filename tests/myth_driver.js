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

  // ===== 6) 三柱の神が専用の絵で描かれる =====
  // 汎用の drawBigBoss（ちび犬体型）に落ちていないこと、
  // 神器の穂先が実際に 3本／2本／0本 生えていることを、描画側を差し替えて実測する
  {
    // ── 6-1 振り分け：神は drawGod へ、他のボスは従来どおり ──
    const realGod=drawGod, realBig=drawBigBoss;
    let log=[];
    drawGod=function(e){ log.push('god:'+e.type); };
    drawBigBoss=function(e){ log.push('big:'+e.type); };
    try {
      setupRoster('inu'); startGame(); state='play';
      enemies.length=0; encounters.length=0; particles.length=0;
      ['poseidon','hades','zeus','garm'].forEach(function(k){
        spawnEnemy(k, camX+300, LANE); const e=enemies[enemies.length-1];
        e.state='idle'; e.anim=0; drawEnemy(e); });
    } finally { drawGod=realGod; drawBigBoss=realBig; }
    ['poseidon','hades','zeus'].forEach(function(k){
      if(log.indexOf('god:'+k)<0) throw new Error(k+' が専用描画へ回っていない: '+log.join(' ')); });
    if(log.indexOf('big:garm')<0) throw new Error('神以外のボスまで専用描画へ流れている: '+log.join(' '));
    console.log('神の描画の振り分け OK ('+log.join(' / ')+')');

    // ── 6-2 神器の穂先：本数と開きを、描画が実際に通る godProng で数える ──
    const realProng=godProng;
    function prongsOf(kind){
      const got=[]; const real=ctx;
      godProng=function(x,y,ang,len,w,col){ got.push({x:x,ang:ang,len:len}); };
      try { ctx=new Proxy(real,{ get:function(t,key){
              if(key==='getTransform') return function(){ return {a:1,b:0,c:0,d:1,e:0,f:0}; };
              const v=t[key]; return (typeof v==='function')? v.bind(t) : v; } });
            enemies.length=0; spawnEnemy(kind, camX+300, LANE);
            const e=enemies[0]; e.state='idle'; e.anim=0; drawGod(e); }
      finally { ctx=real; godProng=realProng; }
      return got; }
    const P=prongsOf('poseidon'), H=prongsOf('hades'), Z=prongsOf('zeus');
    if(P.length!==3) throw new Error('ポセイドンの穂先が3本でない: '+P.length+'本');
    if(H.length!==2) throw new Error('ハデスの穂先が2本でない: '+H.length+'本');
    if(Z.length!==0) throw new Error('ゼウスは雷霆なので穂先を持たないはず: '+Z.length+'本');
    { const a=P.map(function(p){ return p.ang; });
      if(!(Math.min.apply(null,a)<-0.1 && Math.max.apply(null,a)>0.1))
        throw new Error('三叉が開いていない（全部同じ向き）: '+a.map(function(v){return v.toFixed(2);}).join(', '));
      if(!(P[0].len>20)) throw new Error('穂先が短すぎる: '+P[0].len); }
    { const a=H.map(function(p){ return p.ang; });
      if(!(a[0]<0 && a[1]>0)) throw new Error('二叉が左右に開いていない: '+a.map(function(v){return v.toFixed(2);}).join(', ')); }
    console.log('神器 OK (三叉3本 開き±'+Math.max.apply(null,P.map(function(p){return p.ang;})).toFixed(2)
      +'rad / 二叉2本 / 雷霆は穂先なし)');

    // ── 6-3 冠は三者三様。「同じ形を色替えしただけ」を弾くため、色の代入は捨てて
    //         座標と呼び出し列＝形だけを突き合わせる ──
    function crownShape(kind){
      const real=ctx, ops=[];
      try { ctx=new Proxy(real,{ get:function(t,key){
              const v=t[key];
              if(typeof v==='function') return function(){ ops.push(key+'('+Array.prototype.slice.call(arguments)
                .map(function(a){ return typeof a==='number'? a.toFixed(1):''; }).join(',')+')'); return v.apply(t,arguments); };
              return v; },
            set:function(t,key,v){ t[key]=v; return true; } });     // fillStyle 等は記録しない
            godCrown(kind, GOD_ART[kind], -158, 15, false); }
      finally { ctx=real; }
      return ops.join('|'); }
    const cw=crownShape('poseidon'), cf=crownShape('hades'), cl=crownShape('zeus');
    if(cw===cl) throw new Error('波冠と月桂冠が同じ形（色替えだけになっている）');
    if(cw===cf) throw new Error('波冠と冥府の炎が同じ形（色替えだけになっている）');
    if(cf===cl) throw new Error('冥府の炎と月桂冠が同じ形（色替えだけになっている）');
    [['波冠',cw],['冥府の炎',cf],['月桂冠',cl]].forEach(function(c){
      if(c[1].length<200) throw new Error(c[0]+' がほとんど描かれていない: '+c[1].length+'文字'); });
    console.log('冠 OK (波冠/冥府の炎/月桂冠 が別々の形、'
      +[cw,cf,cl].map(function(s){return s.length;}).join('/')+'文字)');

    // ── 6-4 重い装飾は perfTier で落ちる ──
    // 呼び出し数の単調減少だけでは、ゲートを1つ外しても他が残るので素通りする。
    // 「tier2 では加算合成を一切使わない」まで要求すると、どのゲートを外しても赤くなる
    function godOps(kind,tier){
      const real=ctx, old=perfTier, ops=[]; let lighter=0; perfTier=tier;
      try { ctx=new Proxy(real,{ get:function(t,key){
              if(key==='getTransform') return function(){ return {a:1,b:0,c:0,d:1,e:0,f:0}; };
              const v=t[key];
              if(typeof v==='function') return function(){ ops.push(key); return v.apply(t,arguments); };
              return v; },
            set:function(t,key,v){ if(key==='globalCompositeOperation'&&v==='lighter') lighter++; t[key]=v; return true; } });
            enemies.length=0; spawnEnemy(kind, camX+300, LANE);
            const e=enemies[0]; e.state='idle'; e.anim=0; drawGod(e); }
      finally { ctx=real; perfTier=old; }
      return {n:ops.length, lighter:lighter}; }
    const t0=godOps('poseidon',0), t1=godOps('poseidon',1), t2=godOps('poseidon',2);
    if(!(t0.n>t1.n && t1.n>t2.n)) throw new Error('perfTier で装飾が落ちていない: '+t0.n+' / '+t1.n+' / '+t2.n);
    if(!(t2.n>60)) throw new Error('tier2 で神の本体まで消えている: '+t2.n+'コール');
    if(t2.lighter!==0) throw new Error('tier2 なのに加算合成が '+t2.lighter+'回 残っている');
    if(!(t0.lighter>=4)) throw new Error('tier0 の加算演出が少なすぎる: '+t0.lighter+'回');
    if(!(t1.lighter<t0.lighter)) throw new Error('tier1 で加算演出が減っていない: '+t0.lighter+' → '+t1.lighter);
    console.log('神の適応品質 OK (描画コール '+t0.n+'→'+t1.n+'→'+t2.n
      +' / 加算合成 '+t0.lighter+'→'+t1.lighter+'→'+t2.lighter+')');
  }

  // ===== 7) 神話の章の音まわり =====
  {
    // 三柱の神は汎用ボス曲ではなく専用曲を引くこと
    ['poseidon','hades','zeus'].forEach(function(k){
      const m=bossMusicFor(k);
      if(m==='boss') throw new Error(k+' が汎用ボス曲のまま: '+m);
      if(m!=='bossmyth') throw new Error(k+' のボス曲が神話用でない: '+m); });
    // 章のテーマ番号が背景テーマ表に収まり、かつ三章で別々であること
    const th=MYTH_CH.map(function(c){ return c.theme; });
    th.forEach(function(t){ if(!(t>=0 && t<STAGE_THEME.length)) throw new Error('テーマ '+t+' が範囲外'); });
    if(new Set(th).size!==3) throw new Error('三章のテーマが重複している: '+th.join(','));
    console.log('神話の音と背景 OK (専用ボス曲 bossmyth／章ごとに別テーマ '+th.join('/')+')');
  }

  // ===== 8) 神話の雑魚が実際に三周目より脅威であること =====
  // 通しプレイの実測で、当初の四周目は三周目と同じ被ダメージ量（1.01倍）しかなく、
  // 違いは「1発が重く、敵が3.6倍固い」だけ＝難しいのではなく長いだけだった。
  // 実際にダメージを決める経路（ZAKO_DMG×階級×難易度）を通して突き合わせる
  {
    const sv=lap;
    const eff=function(L,pool){ lap=L; let d=0,h=0;
      pool.forEach(function(k){ enemies.length=0; spawnEnemy(k,camX+400,LANE);
        const e=enemies[0];
        d+=ETYPE[k].dmg*ZAKO_DMG*zakoBuffMul(e)*foeAtkMul(e);
        h+=ETYPE[k].hp*diffHpMul(); });
      return {d:d/pool.length, h:h/pool.length}; };
    const A=eff(3,ALIEN_ZAKO_POOL), M=eff(4,MYTH_ZAKO_POOL);
    lap=sv; enemies.length=0;
    if(!(M.d>=A.d*1.35)) throw new Error('神話の雑魚が三周目より重くない: 一撃 '
      +M.d.toFixed(1)+' vs '+A.d.toFixed(1)+'（'+(M.d/A.d).toFixed(2)+'倍）');
    // 平均だけを見ると、1体を骨抜きにされても他が埋めて素通りする。
    // 全個体が三周目の平均を上回っていることまで要求する
    { lap=4; let worst=1e9, wk='';
      MYTH_ZAKO_POOL.forEach(function(k){ enemies.length=0; spawnEnemy(k,camX+400,LANE);
        const e=enemies[0], d=ETYPE[k].dmg*ZAKO_DMG*zakoBuffMul(e)*foeAtkMul(e);
        if(d<worst){ worst=d; wk=k; } });
      lap=sv; enemies.length=0;
      // 「平均より上」だけだと、1体を半分にされても 1.1倍 で残って素通りする。
      // 全個体にプール同様の 1.35倍 を要求する
      if(!(worst>=A.d*1.35)) throw new Error(wk+' が三周目の平均の1.35倍に届かない: '
        +worst.toFixed(1)+' vs '+A.d.toFixed(1)+'（'+(worst/A.d).toFixed(2)+'倍）'); }
    // 固さで水増ししていないこと。HPだけ上げると「難しい」ではなく「長い」になる
    if(!(M.h<=A.h*2.2)) throw new Error('神話の雑魚が固すぎる（長いだけになる）: HP '
      +M.h.toFixed(0)+' vs '+A.h.toFixed(0)+'（'+(M.h/A.h).toFixed(2)+'倍）');
    console.log('神話の脅威 OK (一撃 '+(M.d/A.d).toFixed(2)+'倍 / HP '+(M.h/A.h).toFixed(2)+'倍＝上限2.2倍)');
  }

  // ===== 9) 連携の追撃：一発通ったら次の一体へ攻撃権が渡ること =====
  // 単に同時攻撃数を絞るだけだと手数が減って間延びする。
  // 「硬直に重なる2発目」を作るのがこの章の連携の核
  {
    setupRoster('inu'); startGame(); state='play'; lap=4;
    const p=players[0]; player=p; p.x=camX+420; p.hp=p.maxHp=999999; p.invuln=0; p.defMul=1;
    enemies.length=0; encounters.length=0; particles.length=0;
    for(let i=0;i<4;i++) spawnEnemy('mythblade', p.x+60+i*36, LANE);
    enemies.forEach(function(e){ e.hp=e.maxHp=999999; e.facing=-1; e.sqHold=0; e.stun=0; });
    const a=enemies[0];
    const held0=enemies.filter(function(e){ return e.sqHold>gf; }).length;
    const ok=enemyAttackHit(a, ATK_VAR[0], ATK_VAR[0].hits[0]);
    if(!ok) throw new Error('前提が崩れている: 先頭の攻撃が当たっていない');
    const relayed=enemies.filter(function(e){ return e!==a && e.sqHold>gf; }).length;
    if(!(relayed>held0)) throw new Error('攻撃が通っても次の一体へ繋がらない（追撃が無い）');
    // 三周目では起きないこと（神話の章だけの挙動）。
    // 直前の一撃で無敵が残っていると2発目が当たらず、ゲートの有無に関わらず
    // 「繋がらなかった」ことになってしまうので、無敵を解いてから確かめる
    lap=3; enemies.forEach(function(e){ e.sqHold=0; }); p.invuln=0;
    const ok3=enemyAttackHit(a, ATK_VAR[0], ATK_VAR[0].hits[0]);
    if(!ok3) throw new Error('三周目の検査で攻撃が当たっていない（無敵が残っている）');
    const r3=enemies.filter(function(e){ return e!==a && e.sqHold>gf; }).length;
    lap=4;
    if(r3>0) throw new Error('三周目でも追撃が繋がっている（神話専用のはず）');
    // 同時に仕掛ける上限は 3（従来は2で、賢いつもりが手数を削っていた）
    if(squadCap()!==3) throw new Error('神話の同時攻撃の上限が3でない: '+squadCap());
    lap=3; if(squadCap()!==2) throw new Error('三周目の上限まで変わっている: '+squadCap());
    lap=4;
    console.log('連携の追撃 OK (通ると次の一体へ繋がる／三周目では繋がらない／同時上限 神話3・従来2)');
  }

  console.log('MYTH LAP TEST PASSED'); process.exit(0);
})().catch(e=>{ console.error('FAIL:', e.message, e.stack); process.exit(1); });
`;
code = code + "\n;" + DRIVER;
(0, eval)(code);

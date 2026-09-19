const DRIVER = `
(async()=>{
  sndOn=false;
  // ══════════════════════════════════════════════════════════════════
  //  ラスボスの形態変化は「進むほど強い」こと
  //  実測で退行していた：一周目の最終形態が第2形態の脅威 0.33倍、
  //  六周目の装甲解除が第1形態の 0.66倍。HP も据え置き／減少が4か所あった
  // ══════════════════════════════════════════════════════════════════

  // 進化の鎖は evolveTo から作る。手書きの一覧にすると、
  // 新しい多段ボスを足したときに検査から漏れる
  const chains=(function(){
    const head=[], nextOf={}, isNext={};
    for(const k in ETYPE){ const t=ETYPE[k]; if(t && t.evolveTo){ nextOf[k]=t.evolveTo; isNext[t.evolveTo]=true; } }
    for(const k in nextOf) if(!isNext[k]) head.push(k);
    return head.map(function(h){ const c=[h]; let k=h;
      while(nextOf[k] && c.indexOf(nextOf[k])<0){ k=nextOf[k]; c.push(k); } return c; })
      .filter(c=>c.length>1); })();
  if(chains.length<5) throw new Error('多段変身するボスが '+chains.length+' 組しかない');

  // その形態を最後まで見届ける周回。BOSS_LAP に無ければ 1
  const LAP={boss:1, chamboss:2, emperorX:3, zeus:4, nobunaga:5, mkOmega:6};

  // ── 脅威の測り方 ────────────────────────────────────────────
  // 主役を1点に置くと近接型が不当に低く出る（王機の第2形態がこれで 0.30倍に見えた）。
  // 技ごとに間合いを振って「当たったときにどれだけ持っていかれるか」の最大を足し上げる。
  // 期待値を自分で組み立てず、実際に hurtPlayer へ渡された値を横取りして測る
  const DISTS=[70,110,150,200,260,340,440];
  // 大技の多くが rnd() を使うので、固定しないと同じ設定で実測が ±6% 振れる
  // （zeus→zeus2 が走らせるたび 1.13〜1.20 を行き来した）。種を固定して決定論にする
  const seedRandom=function(seed){ let x=seed>>>0;
    Math.random=function(){ x=(x*1664525+1013904223)>>>0; return x/4294967296; }; };
  const realRandom=Math.random;
  const threatOf=function(k, lapN){
    const T=ETYPE[k];
    const moves=(BOSSMOVES[k]||BOSSMOVES[T.bossKind]||[]).filter(m=>MV[m]);   // pickBossMove と同じ引き方
    if(!moves.length) throw new Error(k+' に出せる大技が1つも無い');
    let total=0;
    for(const m of moves){
      let best=0;
      for(const D of DISTS){
        seedRandom(20260919);                       // 形態どうしを同じ種で突き合わせる
        setupRoster('inu'); startGame(); state='play'; perfTier=1; lap=lapN;
        const p=players[0]; player=p; p.hp=p.maxHp=999999; p.invuln=0; p.z=0;
        enemies.length=0; projectiles.length=0; hazards.length=0; particles.length=0;
        spawnEnemy(k, camX+420, LANE);
        const e=enemies[0]; if(!e) throw new Error(k+' が湧かない');
        e.hp=e.maxHp=999999; e.facing=-1;
        let dmg=0;
        const realHurt=hurtPlayer;
        hurtPlayer=function(q,d){ if(q===p) dmg+=d; return realHurt.apply(null,arguments); };
        try {
          e.state='bmove'; e.moveName=m; e.moveT=0; e.moveMax=MV[m].dur; e.telegraph=0; e.thinkCd=99999;
          for(let f=0; f<MV[m].dur+50; f++){
            hitStop=0; slowmo=0;
            p.x=e.x-D; p.y=e.y; p.z=0; p.state='idle'; p.invuln=0; p.hp=p.maxHp; p.vx=0;
            e.thinkCd=99999;
            if(f<MV[m].dur){ runBossMove(e); e.moveT++; }
            updateProjectiles(); updateHazards(); }
        } finally { hurtPlayer=realHurt; Math.random=realRandom; }
        if(dmg>best) best=dmg; }
      total+=best; }
    return total; };

  const movesOf=k=>{ const T=ETYPE[k]; return (BOSSMOVES[k]||BOSSMOVES[T.bossKind]||[]).filter(m=>MV[m]).length; };

  // 下限は直値で置く。検査対象の定数から作ると、定数を下げた瞬間に一緒に下がって素通りする。
  // 耐久には倍率の下限を置かない——六周目には「最終形態のHP < 800」という
  // 別の取り決め（長いだけの戦いにしない）があり、両方は満たせない。
  // 強さは「脅威」（実際に持っていかれる量）で測り、HPは増えていることだけを見る
  const MIN_THREAT=1.15, MIN_DMG=1.05;
  const report=[];
  for(const c of chains){
    const lapN=LAP[c[0]]||1;
    let prev=null, prevK=null;
    for(const k of c){
      const T=ETYPE[k];
      const cur={hp:T.hp, dmg:T.dmg, moves:movesOf(k), threat:threatOf(k,lapN)};
      if(prev){
        const rh=cur.hp/prev.hp, rt=cur.threat/Math.max(1,prev.threat), rd=cur.dmg/prev.dmg;
        if(!(cur.hp>prev.hp)) throw new Error(prevK+' → '+k+' で耐久が伸びていない: '+prev.hp+'→'+cur.hp);
        if(!(rd>=MIN_DMG)) throw new Error(prevK+' → '+k+' で一撃が重くなっていない: 威力 x'+rd.toFixed(2)+'（'+prev.dmg+'→'+cur.dmg+'）');
        if(cur.moves<prev.moves) throw new Error(prevK+' → '+k+' で手数が減っている: '+prev.moves+'手 → '+cur.moves+'手');
        if(!(rt>=MIN_THREAT)) throw new Error(prevK+' → '+k+' で脅威が伸びていない: x'+rt.toFixed(2)+'（'+Math.round(prev.threat)+'→'+Math.round(cur.threat)+'）');
        report.push(prevK+'→'+k+' HPx'+rh.toFixed(2)+' 脅威x'+rt.toFixed(2));
      }
      prev=cur; prevK=k; }
  }
  console.log('形態変化の強化 OK ('+chains.length+'組／'+report.join(' ／ ')+')');

  // ── 最終形態は、その鎖のどの形態よりも強いこと ──
  // 隣どうしだけを見ていると「少し上げて大きく下げる」で素通りする
  for(const c of chains){
    const lapN=LAP[c[0]]||1;
    const th=c.map(k=>threatOf(k,lapN)), hp=c.map(k=>ETYPE[k].hp);
    const last=c.length-1;
    for(let i=0;i<last;i++){
      if(!(th[last]>th[i])) throw new Error(c[last]+' が '+c[i]+' より脅威が低い: '+Math.round(th[last])+' vs '+Math.round(th[i]));
      if(!(hp[last]>hp[i])) throw new Error(c[last]+' が '+c[i]+' より打たれ弱い: '+hp[last]+' vs '+hp[i]); }
  }
  console.log('最終形態 OK (どの鎖でも最終形態が最強)');

  // ── 装甲解除の「装甲投棄」＝捨てた装甲そのものが武器になること ──
  // 第2形態は近接だけの構成で脅威が第1形態の 0.66倍まで落ちていた。
  // この技が「全周へ撒く」「本体が画面を往復する」の両方をやって初めて面を取れる
  { if(!MV.mkPurge) throw new Error('装甲投棄が無い');
    if((BOSSMOVES.mkOmega2||[]).indexOf('mkPurge')<0) throw new Error('装甲解除が装甲投棄を持っていない');
    setupRoster('inu'); startGame(); state='play'; perfTier=1; lap=6;
    const p=players[0]; player=p; p.hp=p.maxHp=999999; p.invuln=99999; p.x=camX+120;
    enemies.length=0; projectiles.length=0;
    spawnEnemy('mkOmega2', camX+520, LANE);
    const e=enemies[0]; e.hp=e.maxHp=999999; e.facing=-1;
    e.state='bmove'; e.moveName='mkPurge'; e.moveT=0; e.moveMax=MV.mkPurge.dur; e.telegraph=0; e.thinkCd=99999;
    let travel=0, plates=null, turns=0, lastFace=e.facing;
    for(let f=0; f<MV.mkPurge.dur; f++){ hitStop=0; e.thinkCd=99999;
      const bx=e.x; runBossMove(e); e.moveT++; travel+=Math.abs(e.x-bx);
      if(e.facing!==lastFace){ turns++; lastFace=e.facing; }
      if(plates===null && projectiles.length) plates=projectiles.slice(); }
    if(!plates || plates.length<8) throw new Error('装甲板が '+((plates&&plates.length)||0)+'枚しか飛ばない');
    // 全周へ撒くこと。前方だけだと後ろへ下がるだけで無効になる
    const back=plates.filter(q=>q.vx>0.5).length, fwd=plates.filter(q=>q.vx<-0.5).length;
    if(!(back>0 && fwd>0)) throw new Error('装甲板が片側にしか飛ばない: 前'+fwd+'/後'+back);
    if(!plates.every(q=>q.pierce)) throw new Error('装甲板が1体で止まる（面を取れない）');
    // spawnProj は渡された印を白紙から組み直すので、通し忘れると既定の光弾に戻る
    // （実際に plate と spin0 を通し忘れて、装甲が球で飛んだ）
    if(!plates.every(q=>q.plate)) throw new Error('装甲板が板の形で描かれない（既定の光弾に戻っている）');
    if(!(travel>300)) throw new Error('本体が往復していない: '+travel.toFixed(0)+'px');
    if(!(turns>=1)) throw new Error('一方向へ走り抜けるだけ（往復になっていない）');
    console.log('装甲投棄 OK (装甲板 '+plates.length+'枚を全周へ／本体は '+travel.toFixed(0)+'px を '+(turns+1)+'往復)'); }

  // ── 進化しても本体の強化が巻き戻らないこと ──
  // evolveBoss は状態を作り直すので、うっかり「怒り」や「成長」を消すと弱くなる
  { setupRoster('inu'); startGame(); state='play'; perfTier=1; lap=1;
    enemies.length=0; spawnEnemy('boss', camX+300, LANE);
    const e=enemies[0]; e.hp=1;
    // 素の ETYPE.hp と比べると、湧きの時点で掛かっている周回補正ぶん下駄を履くので、
    // 「増えた」が偽で通る。進化する直前の実体の値と比べる
    const hp0=e.maxHp, before=e.type;
    evolveBoss(e, ETYPE.boss);
    if(e.type===before) throw new Error('進化していない');
    if(!(e.maxHp>hp0)) throw new Error('進化して最大HPが増えていない: '+hp0+' → '+e.maxHp);
    if(!(e.hp===e.maxHp)) throw new Error('進化直後に満タンになっていない: '+e.hp+'/'+e.maxHp);
    console.log('進化の引き継ぎ OK ('+before+' → '+e.type+' で最大HP '+hp0+' → '+e.maxHp+')'); }

  console.log('BOSS FORM TEST PASSED'); process.exit(0);
})().catch(e=>{ console.error('FAIL:', e.message, e.stack); process.exit(1); });
`;
code = code + "\n;" + DRIVER;
(0, eval)(code);

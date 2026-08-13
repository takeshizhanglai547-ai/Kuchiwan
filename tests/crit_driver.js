const DRIVER = `
(async()=>{
  const step=(n)=>{ for(let i=0;i<n;i++){ if(global.rafCb){ const cb=global.rafCb; global.rafCb=null; cb(); } } };
  sndOn=false;

  // ═══ 1) 体勢崩し → 致命の一撃 ═══════════════════════════════
  // ボスを崩したときに主役側へ見返りが無く、崩れても殴り続けるだけだった
  {
    const HEROES=['inu','shima','nuko','guard8','watch','wanden'];
    HEROES.forEach(function(kind){
      setupRoster(kind); startGame(); state='play'; lap=1;
      const p=players[0]; player=p; p.x=camX+300; p.facing=1;
      p.hp=p.maxHp=999999; p.invuln=0; p.level=20;
      enemies.length=0; encounters.length=0; particles.length=0; hazards.length=0;
      spawnEnemy('garm', p.x+60, LANE); const e=enemies[0];
      e.hp=e.maxHp=4000; e.thinkCd=999999; e.stun=0;
      // 規定回数当てると崩れる
      for(let i=0;i<BOSS_POISE-1;i++) bossPoiseTick(e);
      if(e.state==='bstagger') throw new Error(kind+': 規定回数に満たないのに崩れた');
      bossPoiseTick(e);
      if(e.state!=='bstagger') throw new Error(kind+': '+BOSS_POISE+'発当てても崩れない state='+e.state);
      const ct=critTarget(p);
      if(!ct) throw new Error(kind+': 崩れた相手に致命が届かない');
      const hp0=e.hp;
      // 実際に攻撃ボタンを押して出ること（beginCrit を直接呼ぶと配線を検査できない）
      p.in.pressed.atk=true; hitStop=0; slowmo=0; step(1);
      if(p.state!=='crit') throw new Error(kind+': 攻撃ボタンで致命が出ない state='+p.state);
      const A=CRIT_ART[kind];
      if(!A||!A.name) throw new Error(kind+': 専用の致命が用意されていない');
      for(let f=0; f<A.dur+20; f++){ hitStop=0; slowmo=0; step(1); }
      const rate=(hp0-e.hp)/e.maxHp;
      // 最大HPの1/5級であること（威力が伴わないと崩す動機にならない）
      if(!(rate>=0.18 && rate<=0.24))
        throw new Error(kind+': 致命が最大HPの1/5になっていない '+(rate*100).toFixed(1)+'%');
      if(p.state!=='idle') throw new Error(kind+': 致命のあと状態が戻らない '+p.state);
    });
    console.log('致命の一撃 OK (6キャラすべて専用モーション／最大HPの20%／終了後に復帰)');

    // 崩れていない相手・猶予切れの相手には出ない
    { setupRoster('inu'); startGame(); state='play';
      const p=players[0]; player=p; p.x=camX+300; p.hp=p.maxHp=999999; p.invuln=999999;
      enemies.length=0; spawnEnemy('garm', p.x+50, LANE);
      if(critTarget(p)) throw new Error('崩れていない相手にも致命が出る');
      const e=enemies[0]; e.hp=e.maxHp=4000; e.thinkCd=999999;
      for(let i=0;i<BOSS_POISE;i++) bossPoiseTick(e);
      if(!critTarget(p)) throw new Error('崩した直後に致命が出ない');
      // 間合いの外なら出ない。CRIT_REACH と比べると、その定数を壊した瞬間に
      // 素通りするので直値で離す（画面半分ぶん離れて届くのはおかしい）
      const sx=p.x; p.x=e.x-320;
      if(critTarget(p)) throw new Error('320px 離れていても致命が出る');
      p.x=sx;
      for(let f=0; f<CRIT_WINDOW+10; f++){ hitStop=0; slowmo=0; step(1); }
      if(critTarget(p)) throw new Error('猶予切れでも致命が出る');
      if(e.state==='bstagger') throw new Error('猶予切れでも崩れたまま');
      console.log('致命の条件 OK (崩れていない／間合いの外／猶予切れ では出ない)'); }

    // 崩れている間、ボスは動けない（反撃の窓になっていること）
    { setupRoster('inu'); startGame(); state='play';
      const p=players[0]; player=p; p.x=camX+300; p.hp=p.maxHp=999999; p.invuln=999999;
      enemies.length=0; spawnEnemy('gigas', p.x+200, LANE); const e=enemies[0];
      e.hp=e.maxHp=9000; e.thinkCd=0;
      for(let i=0;i<BOSS_POISE;i++) bossPoiseTick(e);
      const x0=e.x; let acted=0;
      for(let f=0; f<80; f++){ hitStop=0; slowmo=0; step(1);
        if(e.state==='bmove'||e.state==='bwind') acted++; }
      if(acted>0) throw new Error('崩れている間もボスが技を出す: '+acted+'フレーム');
      if(Math.abs(e.x-x0)>40) throw new Error('崩れている間もボスが動く: '+Math.round(Math.abs(e.x-x0))+'px');
      console.log('崩れの窓 OK (80F 動かず・技も出さない)'); }

    // 崩れている間は殴っても浮かない・押されない。
    // 「崩れた＝吹き飛ばせる」は致命の一撃を入れる前の設計で、崩した直後に
    // もう1発入ると air へ移って 308px まで浮き、猶予がまるごと潰れていた
    { setupRoster('inu'); startGame(); state='play';
      const p=players[0]; player=p; p.x=camX+300; p.facing=1; p.hp=p.maxHp=999999; p.invuln=999999;
      enemies.length=0; spawnEnemy('garm', p.x+70, LANE); const e=enemies[0];
      e.hp=e.maxHp=999999; e.thinkCd=999999;
      for(let i=0;i<BOSS_POISE;i++) bossPoiseTick(e);
      const x0=e.x; let zMax=0, critF=0;
      for(let i=0;i<10;i++){                       // 崩れたあとも殴り続ける
        damageEnemy(e, 30, 8, true, 12);
        // フレームを進めないと押されようがない（vx が e.x に反映されない）
        for(let f=0;f<4;f++){ hitStop=0; slowmo=0; step(1); }
        zMax=Math.max(zMax, e.z||0);
        if(critTarget(p)) critF++; }
      if(!(zMax<=1)) throw new Error('崩れているのに浮く: '+zMax.toFixed(0)+'px');
      if(Math.abs(e.x-x0)>4) throw new Error('崩れているのに押される: '+Math.abs(e.x-x0).toFixed(0)+'px');
      if(critF!==10) throw new Error('殴っている途中で致命が狙えなくなる: '+critF+'/10');
      console.log('崩れ中の追撃 OK (10発当てても浮かず '+zMax.toFixed(0)+'px・移動 '
        +Math.abs(e.x-x0).toFixed(0)+'px・常に致命が狙える)'); }
  }

  // ═══ 2) 奥義とタメ攻撃の構えが段位で変わること ═══════════════
  // 従来は威力と振りの回数が増えるだけで、進行度を揃えて測ると 2px しか動かなかった
  {
    // 「進行度の25/50/75%」で比べると、段ごとに振りの回数が違う技では意味が揃わない
    // （1振りの技と3振りの技の50%は別物）。実測でも、そのせいで
    // 「基本↔極 の方が 基本↔熟練 より小さい」という逆転が出ていた。
    // 振り抜きの瞬間という、段が違っても意味の揃う一点で比べる
    const poseAt=function(setup, tWant, tick){
      const want=[tWant];
      const out=[]; const rl=limbSeg, real=ctx; let cur=null;
      // 体の傾き・上下動・伸縮は ctx の変換で掛かるので、limbSeg の引数だけを見ても差が出ない。
      // 変換を積んで、画面上のどこに手足が来るかで比べる
      let M={a:1,b:0,c:0,d:1,e:0,f:0}; const st2=[];
      const mul=function(A,B){ return {a:A.a*B.a+A.c*B.b,b:A.b*B.a+A.d*B.b,c:A.a*B.c+A.c*B.d,
        d:A.b*B.c+A.d*B.d,e:A.a*B.e+A.c*B.f+A.e,f:A.b*B.e+A.d*B.f+A.f}; };
      const xf=function(x,y){ return [M.a*x+M.c*y+M.e, M.b*x+M.d*y+M.f]; };
      limbSeg=function(ax,ay,bx,by,w,col){ if(cur){ const A=xf(ax,ay), B=xf(bx,by);
          cur.push(A[0],A[1],B[0],B[1]); }
        return rl.apply(null,arguments); };
      try { setup();
        let got=0, guard=0;
        while(got<want.length && guard++<600){ hitStop=0; slowmo=0; step(1);
          const now=tick();
          if(now>=want[got]){ got++; cur=[]; M={a:1,b:0,c:0,d:1,e:0,f:0}; st2.length=0;
            try { ctx=new Proxy(real,{ get:function(t,k){ const v=t[k];
                    if(typeof v!=='function') return v;
                    return function(){ const a=arguments;
                      if(k==='save') st2.push(Object.assign({},M));
                      else if(k==='restore'){ if(st2.length) M=st2.pop(); }
                      else if(k==='translate') M=mul(M,{a:1,b:0,c:0,d:1,e:a[0],f:a[1]});
                      else if(k==='scale') M=mul(M,{a:a[0],b:0,c:0,d:a[1],e:0,f:0});
                      else if(k==='rotate'){ const c2=Math.cos(a[0]),s3=Math.sin(a[0]);
                        M=mul(M,{a:c2,b:s3,c:-s3,d:c2,e:0,f:0}); }
                      return v.apply(t,a); }; } });
                  drawPlayer(); } finally { ctx=real; }
            out.push(cur); cur=null; }
          else drawPlayer(); }
        if(got<want.length) throw new Error('技が最後まで進まない（'+got+'/'+want.length+'点しか取れない）'); }
      finally { limbSeg=rl; }
      return out; };
    const gap=function(A,B){ let s=0,n=0;
      for(let i=0;i<Math.min(A.length,B.length);i++){ const a=A[i],b=B[i];
        for(let k=0;k<Math.min(a.length,b.length);k++){ s+=Math.abs(a[k]-b[k]); n++; } }
      return n? s/n : 0; };
    const LV=[1,8,16];
    const res=[];
    ['shima','nuko','guard8','watch'].forEach(function(k){
      const r=LV.map(function(lv){
        const ti=lv>=16?2 : lv>=8?1 : 0, t0=SG_ACT[k].burst[ti][0]+3;   // 1発目の振り抜き
        return poseAt(function(){ setupRoster(k); startGame(); state='play';
          const p=players[0]; player=p; p.x=camX+300; p.facing=1; p.level=lv;
          p.hp=p.maxHp=999999; p.invuln=999999; enemies.length=0; particles.length=0;
          beginSGAct(p,k); }, t0, function(){ return player.sgT||0; }); });
      res.push({n:'奥義:'+k, a:gap(r[0],r[1]), b:gap(r[1],r[2]), c:gap(r[0],r[2])}); });
    [['inu',['charge','charge2','charge3']],
     ['guard8',['chargeHammer','chargeHammer2','chargeHammer3']]].forEach(function(e){
      const r=LV.map(function(lv,i){ const id=e[1][i];
        if(!ATK[id]) throw new Error('タメ攻撃 '+id+' が無い');
        return poseAt(function(){ setupRoster(e[0]); startGame(); state='play';
          const p=players[0]; player=p; p.x=camX+300; p.facing=1; p.level=lv;
          p.hp=p.maxHp=999999; p.invuln=999999; enemies.length=0; particles.length=0;
          beginAttack(id); }, ATK[id].act[0]+3, function(){ return (player.atk&&player.atk.t)||0; }); });
      res.push({n:'タメ:'+e[0], a:gap(r[0],r[1]), b:gap(r[1],r[2]), c:gap(r[0],r[2])}); });
    // 振り抜きの瞬間で揃えたときの実測（改修後）：
    //   奥義:shima 4.2/12.0/15.0   奥義:nuko 6.4/5.3/8.9
    //   奥義:guard8 11.5/7.2/16.9  奥義:watch 14.1/27.5/19.2
    //   タメ:inu 13.2/42.1/35.3    タメ:guard8 5.1/23.0/27.5
    res.forEach(function(r){
      if(!(r.a>=4.0)) throw new Error(r.n+' の 基本↔熟練 で構えがほぼ同じ: '+r.a.toFixed(1)+'px');
      if(!(r.b>=5.0)) throw new Error(r.n+' の 熟練↔極 で構えがほぼ同じ: '+r.b.toFixed(1)+'px');
      // 段位が上がるほど基本形から離れること。
      // これを見ないと「熟練だけ別の構え／極は基本のまま」でも上の2つは通る
      if(!(r.c>r.a)) throw new Error(r.n+' の 極 が 熟練 より基本形から離れていない: '
        +'基本↔熟練 '+r.a.toFixed(1)+'px vs 基本↔極 '+r.c.toFixed(1)+'px'); });
    console.log('段位ごとの構え OK ('+res.map(function(r){
      return r.n+' '+r.a.toFixed(1)+'/'+r.b.toFixed(1)+'/'+r.c.toFixed(1); }).join('  ')+' px 基本↔熟練/熟練↔極/基本↔極)');
  }

  console.log('CRIT / TIER MOTION TEST PASSED'); process.exit(0);
})().catch(e=>{ console.error('FAIL:', e.message, e.stack); process.exit(1); });
`;
code = code + "\n;" + DRIVER;
(0, eval)(code);

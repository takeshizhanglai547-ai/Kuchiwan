const DRIVER = `
(async()=>{
  // ═══ コンボの効果 ═══
  // 以前のコンボは数字が増えるだけで、繋いでも繋がなくても何も変わらなかった。
  // 段位（D/C/B/A/S/SS）に経験値の倍率と演出の濃さを紐づけた、その実測。

  const setup=function(){ sndOn=false; setupRoster('inu'); startGame();
    const p=players[0]; resetPlayer(p,true); player=p;
    p.state='idle'; p.z=0; p.atk=null; p.invuln=0;
    enemies.length=0; projectiles.length=0; hazards.length=0; resetCombo(); return p; };
  const build=function(n){ resetCombo(); for(let i=0;i<n;i++) addCombo(1); };

  // ===== 1) 段位が上がるほど経験値の倍率が上がる =====
  { setup();
    const seen=[];
    for(const n of [1,2,8,16,28,45,70]){ build(n); seen.push([n, comboTier(), +comboXpMul().toFixed(3)]); }
    // 1ヒットは段位なし・倍率1倍
    if(seen[0][1]!==-1) throw new Error('1ヒットで段位が付いている');
    if(seen[0][2]!==1) throw new Error('1ヒットで経験値が '+seen[0][2]+' 倍になっている');
    // 段位がひとつ上がるたびに倍率も上がる（同じ値が並んだら「効いていない」）
    for(let i=2;i<seen.length;i++){
      if(!(seen[i][2]>seen[i-1][2]))
        throw new Error(seen[i-1][0]+'ヒット '+seen[i-1][2]+'倍 → '+seen[i][0]+'ヒット '+seen[i][2]+'倍 で上がっていない'); }
    if(!(seen[seen.length-1][2]>=2)) throw new Error('最高段位でも '+seen[seen.length-1][2]+' 倍しかない');
    console.log('経験値の倍率 OK ('+seen.map(function(q){return q[0]+'hit×'+q[2];}).join(' / ')+')'); }

  // ===== 2) 実際に敵を倒したときの取得経験値が、コンボで増える =====
  { const kill=function(n){ const p=setup(); p.level=1; p.xp=0; p.xpNext=1e9;   // レベルアップさせず素の取得量を測る
      spawnEnemy('wolf', p.x+100, p.y); const e=enemies[0];
      build(n);                                       // コンボを積んでから止めを刺す
      const before=p.xp;
      damageEnemy(e, 99999, 0, true);                 // killEnemy を通す
      return p.xp-before; };
    const lo=kill(1), hi=kill(70);
    if(lo<=0) throw new Error('倒しても経験値が入らない');
    if(!(hi>lo*1.8)) throw new Error('コンボを繋いでも取得経験値が '+lo+'→'+hi+' しか変わらない');
    console.log('倒したときの取得経験値 OK (1hit '+lo+' → 70hit '+hi+')'); }

  // ===== 3) 段位が上がると打撃の火花が増える =====
  { const count=function(n){ const p=setup(); build(n);
      const before=particles.length;
      hitFx(p.x+80, p.y-40, 12, false, '#ffe14d');
      return particles.length-before; };
    const d=count(2), ss=count(70);
    if(d<=0) throw new Error('打撃の粒が出ていない（測れていない）');
    if(!(ss>d*1.3)) throw new Error('段位を上げても打撃の粒が '+d+'→'+ss+' しか増えない');
    console.log('打撃エフェクト OK (D '+d+'粒 → SS '+ss+'粒)'); }

  // ===== 4) 段位が上がった瞬間に画面が反応する =====
  { const p=setup();
    // 段位の境目（8ヒット＝C）をまたぐフレームだけ閃く
    build(7); combo.flare=0; flash=0; shake=0;
    const pops0=particles.length;
    addCombo(1);                                       // ← ここで C へ上がる
    if(!(combo.flare>0)) throw new Error('段位が上がっても閃かない（flare='+combo.flare+'）');
    if(!(flash>0)) throw new Error('段位が上がっても画面が光らない');
    if(!(particles.length>pops0)) throw new Error('段位が上がっても粒が出ない');
    // 段位が変わらないヒットでは閃かない
    combo.flare=0; flash=0; addCombo(1);
    if(combo.flare>0) throw new Error('段位が変わっていないのに閃いている');
    console.log('段位更新の演出 OK (C到達で flare/flash/粒／据え置きヒットでは光らない)'); }

  // ===== 5) 画面のフチが段位の色で灯る（濃さが段位で変わる） =====
  { const real=ctx;
    // 枚数だけだと段位で差が出ないので、上端の帯の厚みを実測する
    const paint=function(n){ setup(); build(n); combo.flare=0;
      let fills=0, topH=0;
      try{ ctx=new Proxy(real,{ get:function(t,k){ const v=t[k];
            if(k==='fillRect') return function(x,y,w,h){ fills++; if(x===0&&y===0&&w===W&&h>topH) topH=h; return v.apply(t,arguments); };   // 上端の帯（横幅いっぱい）だけ拾う。左端の帯も x=0,y=0 なので幅で分ける
            if(typeof v==='function') return function(){ return v.apply(t,arguments); };
            return v; },
          set:function(t,k,v){ t[k]=v; return true; } });
        drawComboGlow();
      } finally { ctx=real; }
      return {n:fills, th:topH}; };
    const none=paint(1), b=paint(16), ss=paint(70);
    if(none.n!==0) throw new Error('段位が付く前からフチが光っている（'+none.n+'枚）');
    if(b.n<=0) throw new Error('B段位でフチが光らない');
    if(!(ss.th>b.th)) throw new Error('段位が上がってもフチの帯が厚くならない（B '+b.th+'px / SS '+ss.th+'px）');
    console.log('画面のフチ OK (段位なし '+none.n+'枚／B 帯'+b.th+'px／SS 帯'+ss.th+'px)'); }

  // ===== 6) コンボが切れたら効果も戻る =====
  { setup(); build(70);
    if(comboXpMul()<=1) throw new Error('積んでも倍率が上がっていない（測れていない）');
    resetCombo();
    if(comboTier()!==-1) throw new Error('切れても段位が '+comboTier());
    if(comboXpMul()!==1) throw new Error('切れても経験値が '+comboXpMul()+' 倍のまま');
    if(comboHeat()!==0) throw new Error('切れても演出の濃さが '+comboHeat());
    console.log('コンボ切れ OK (段位・倍率・濃さがすべて戻る)'); }

  // ===== 7) 演出が描画へ負の寸法を渡さない =====
  // ヘッドレスの ctx は何でも飲み込むので気付けないが、ブラウザの ellipse/arc は
  // 半径が負だと例外を投げてフレームごと落ちる。段位と閃きのあらゆる組み合わせを通す
  { const real=ctx;
    const bad=[];
    const check=function(name,args){ for(let i=0;i<args.length;i++){
        const v=args[i]; if(typeof v==='number' && !isFinite(v)) bad.push(name+' 引数'+i+'='+v); } };
    try{ ctx=new Proxy(real,{ get:function(t,k){ const v=t[k];
          if(k==='ellipse') return function(x,y,rx,ry){ if(rx<0||ry<0) bad.push('ellipse 半径 '+rx.toFixed(1)+'/'+ry.toFixed(1)); check('ellipse',arguments); return v.apply(t,arguments); };
          if(k==='arc') return function(x,y,r){ if(r<0) bad.push('arc 半径 '+r.toFixed(1)); check('arc',arguments); return v.apply(t,arguments); };
          if(k==='fillRect') return function(x,y,w,h){ if(w<0||h<0) bad.push('fillRect 幅高 '+w.toFixed(1)+'/'+h.toFixed(1)); check('fillRect',arguments); return v.apply(t,arguments); };
          if(k==='createLinearGradient') return function(){ check('createLinearGradient',arguments); return v.apply(t,arguments); };
          if(typeof v==='function') return function(){ return v.apply(t,arguments); };
          return v; },
        set:function(t,k,v){ t[k]=v; return true; } });
      for(const n of [1,2,8,16,28,45,70,200]){
        setup(); build(n);
        for(let f=0;f<=40;f++){ combo.flare=f; combo.flareMax=(f>0?combo.flareMax||f:0); drawComboGlow(); }
        // 実際に段位が上がったときの値でも通す
        setup(); resetCombo();
        for(let k=0;k<n;k++){ addCombo(1); drawComboGlow(); } }
    } finally { ctx=real; }
    if(bad.length) throw new Error('描画へ不正な値を渡している: '+bad.slice(0,3).join(' / ')+'（計'+bad.length+'件）');
    console.log('演出の描画引数 OK (段位8通り×閃き0〜40F・段位更新の実値とも負の半径なし)'); }

  // ===== 8) 段位更新の輪は、閃きが消えていく間に小さい→大きいへ広がる =====
  // flare は段位ごとに長さが違う（16〜36F）。決め打ちの数で割ると比が1を超え、
  // 輪の半径が下限に張り付いて「広がらない」（ブラウザでは負の半径で例外にもなる）
  { const real=ctx; const p=setup();
    resetCombo(); for(let k=0;k<70;k++) addCombo(1);     // SS まで積んで最長の閃きを出す
    const fmax=combo.flareMax;
    if(!(fmax>=16)) throw new Error('閃きの長さが '+fmax+'F しかない（測れていない）');
    const radii=[];
    try{ ctx=new Proxy(real,{ get:function(t,k){ const v=t[k];
          if(k==='ellipse') return function(x,y,rx){ if(Math.abs(x-W*0.5)<1) radii.push(rx); return v.apply(t,arguments); };
          if(typeof v==='function') return function(){ return v.apply(t,arguments); };
          return v; }, set:function(t,k,v){ t[k]=v; return true; } });
      for(let f=fmax; f>=1; f--){ combo.flare=f; const n0=radii.length; drawComboGlow();
        if(radii.length===n0) throw new Error('閃きの輪が描かれていない（f='+f+'）'); }
    } finally { ctx=real; }
    for(let i=1;i<radii.length;i++){
      if(!(radii[i]>radii[i-1]))
        throw new Error('閃きの輪が広がらない（'+radii[i-1].toFixed(1)+'→'+radii[i].toFixed(1)+'px で止まっている）'); }
    if(!(radii[0] < W*0.30)) throw new Error('輪の出だしが '+radii[0].toFixed(0)+'px（小さく始まっていない）');
    if(!(radii[radii.length-1] > W*0.60)) throw new Error('輪の終わりが '+radii[radii.length-1].toFixed(0)+'px（広がり切っていない）');
    console.log('段位更新の輪 OK ('+fmax+'F かけて '+radii[0].toFixed(0)+'px → '+radii[radii.length-1].toFixed(0)+'px へ広がる)'); }

  console.log('COMBO TEST PASSED'); process.exit(0);
})().catch(e=>{ console.error('FAIL:', e.message, e.stack); process.exit(1); });
`;
code = code + "\n;" + DRIVER;
(0, eval)(code);

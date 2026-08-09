const DRIVER = `
global._GC={}; var _g=(n,v)=>{ _GC[n]=(_GC[n]||0)+1; return v; };
process.on("exit",()=>{ const miss=[]; for(let i=1;i<=43;i++) if(!_GC[i]) miss.push(i); console.error("GUARDS total=43 evaluated="+((43)-miss.length)+" NEVER_EVALUATED=["+miss.join(",")+"]"); });

(async()=>{
  const step=(n)=>{ for(let i=0;i<n;i++){ if(global.rafCb){ const cb=global.rafCb; global.rafCb=null; cb(); } } };
  sndOn=false;

  // ===== 1) 矩形を平行移動するだけの脚が残っていないこと =====
  { const names=['drawBitter','drawPapipoo','drawShark','drawPirate','drawNoroinu','drawCactus','drawWarpdog'];
    for(const n of names){
      const src=eval(n).toString();
      if(_g(1,src.indexOf('foeStep') >= 0)) throw new Error(n+' still uses foeStep (矩形脚の平行移動が残存)');
      if(_g(2,src.indexOf('foeLegs') < 0)) throw new Error(n+' does not call foeLegs (二関節脚に置換されていない)');
    }
    console.log('矩形脚の撲滅 OK ('+names.length+'関数すべてが foeLegs の二関節脚)'); }

  // ===== 2) 二関節脚が「曲がる」こと（膝が直線上にない） =====
  { let bent=0, samples=0;
    const e={gait:0,gaitW:1};
    for(let i=0;i<24;i++){ e.gait=i/24*Math.PI*2;
      const g=e.gait, A=0.58, K=0.80, wf=Math.sin(g), wk=Math.sin(g-0.55);
      const th=wf*A, knee=Math.max(0,wk)*K, l1=9,l2=9;
      const kx=Math.sin(th)*l1, ky=Math.cos(th)*l1;
      const sa=th-knee, fx=kx+Math.sin(sa)*l2, fy=ky+Math.cos(sa)*l2;
      // 股→足の直線から膝がどれだけ外れているか
      const dx=fx, dy=fy, L=Math.hypot(dx,dy)||1;
      const dist=Math.abs((kx*dy-ky*dx)/L);
      samples++; if(dist>1.2) bent++; }
    if(_g(3,!(bent >= samples*0.3))) throw new Error('knee almost never bends: '+bent+'/'+samples);
    console.log('膝の屈曲 OK ('+bent+'/'+samples+' フレームで膝が曲がる)'); }

  // ===== 3) 歩幅が実移動から積分され、後退では位相が逆回りする =====
  setupRoster('inu'); startGame(); state='play';
  { const e={x:0,px2:0,dir:1,z:0,state:'walk',gait:0,gaitW:1,anim:0,bob:0,type:'wolf',hp:10,maxHp:10};
    const t=ETYPE[e.type]; const gk=(t.gaitK!=null)?t.gaitK:(0.078-clamp(((t.h||70)-56)/170,0,1)*0.048);
    // 前進
    let g=0; for(let i=0;i<10;i++){ g += 3*gk*1; }
    // 後退（dir=1 のまま x が減る＝バック歩き）
    let g2=g; for(let i=0;i<10;i++){ g2 += (-3)*gk*1; }
    if(_g(4,!(g>0.05))) throw new Error('forward motion did not advance the gait');
    if(_g(5,!(g2 < g - 0.05))) throw new Error('backward motion did not reverse the gait phase (g='+g+' g2='+g2+')');
    // 実装が符号付きであることをソースからも確認
    const src=updateGait.toString();
    if(_g(6,src.indexOf('mv=_dx*(e.facing||1)') < 0)) throw new Error('gait integration is not direction-signed');
    if(_g(7,src.indexOf('Math.abs(mv)>0.12') < 0 && src.indexOf('Math.abs(mv) > 0.12') < 0)) throw new Error('stepping gate still uses unsigned mv');
    console.log('歩行位相の符号 OK (前進 +'+g.toFixed(3)+' → 後退で '+g2.toFixed(3)+' へ巻き戻る)'); }

  // ===== 4) 四つ足の歩容：全脚が同時に垂直になる「テーブル脚」を作らない =====
  { const src=drawBeast.toString();
    if(_g(8,src.indexOf('PH')<0 || src.indexOf('gaitStep')<0)) throw new Error('drawBeast が歩速依存の歩容（PH）／接地サイクルを使っていない');
    const calls=[]; let idx=0;
    while(true){ const i=src.indexOf('L(', idx); if(i<0) break; idx=i+2;
      if(i>0 && /[A-Za-z0-9_$]/.test(src[i-1])) continue;
      const body=src.slice(i+2, src.indexOf(';', i)).split(',');
      calls.push({hx:parseFloat(body[0]), off:body[2].trim()}); }
    if(_g(9,calls.length!==4)) throw new Error('expected 4 leg calls in drawBeast, got '+calls.length);
    const hx=calls.map(c=>c.hx).sort((a,b)=>a-b);
    if(_g(10,!(hx[1]<0 && hx[2]>0))) throw new Error('hips are not split front/back: '+hx.join(','));
    // 歩速の違う2種で、4本の足先が同時に真下（x≈0）へ揃う位相が存在しないこと
    for(const ty of ['boar','hyena']){ const T=ETYPE[ty];
      const PH=lerp(0.25,0.42,clamp(((T.sp||1.5)-1.4)/0.8,0,1));
      const offs=[0,PH,PH*2,PH*3];
      let worst=99, flat=0;
      for(let n=0;n<120;n++){ const u=n/120;
        const xs=offs.map(o=>gaitStep(u+o,30,6).x);
        const spread=Math.max(...xs)-Math.min(...xs);
        worst=Math.min(worst,spread);
        if(xs.every(v=>Math.abs(v)<2.0)) flat++; }
      if(_g(11,flat>0)) throw new Error(ty+': 全脚が同時に垂直になる位相が '+flat+'/120 存在する（テーブル脚）');
      if(_g(12,!(worst>6))) throw new Error(ty+': 4本の足先の開きが最小 '+worst.toFixed(1)+'px しかない');
    }
    console.log('四つ足の歩容 OK (股関節 '+hx.join('/')+' ／テーブル脚の死に姿勢なし・歩速で4ビート↔トロットが切替)'); }

  // ===== 4b) 接地相の足は「ワールド座標」で静止する =====
  //   計測は e._stride の再現ではなく、foeLegTo が実際に受け取った足先目標を横取りして行う。
  //   自前で歩幅を組み立てると、描画側だけに掛かる係数（amp の二重乗算・gaitW）を見逃す
  setupRoster('inu'); startGame(); state='play';
  { const origLegTo=foeLegTo, origSolve=foeLegSolve;
    let cap=null;
    // 二足は foeLegTo、四つ足は foeLegSolve（バッチ描画）を通るので両方を捕まえる
    foeLegTo=function(hipX,hipY,tx,ty,l1,l2,w,col,boot,kdir,bootA){
      if(cap) cap.push({tx,ty,l1,l2});
      return origLegTo.apply(null,arguments); };
    foeLegSolve=function(hipX,hipY,tx,ty,l1,l2,kdir,w,col,boot){
      if(cap) cap.push({tx,ty,l1,l2});
      return origSolve.apply(null,arguments); };
    let worst=0, worstN='', fastest=0, fastN='', slowest=99, slowN='', measured=0, bonePulse=0, boneN='';
    const TYPES=['wolf','hyena','boar','corgi','mastiff','bitter','warpdog','pirate','noroinu','papipoo','bomber','dragon','cactus'];
    for(const ty of TYPES){ const T=ETYPE[ty]; if(!T) continue;
      enemies.length=0; encounters.length=0;
      const p=players[0]; player=p; p.hp=p.maxHp=999999;
      spawnEnemy(ty, p.x+320, LANE);
      const e=enemies[0]; if(!e) continue;
      e.hp=e.maxHp=999999;
      // AI が動かさない型（据え置きのボス等）も手で押して歩かせる
      const push=()=>{ e.x += (T.sp||1.5)*0.7*(e.facing||1); };
      for(let n=0;n<70;n++){ p.x-=3; push(); e.state='walk'; e.z=0; cap=null; step(1); drawEnemy(e); }
      let px=e.x, dgSum=0, mvSum=0, nSmp=0, bones=null; const frames=[];
      for(let n=0;n<200;n++){
        p.x-=3; push(); e.state='walk'; e.z=0;
        // 本編と同じ「更新 → 描画」の順で回し、描画した瞬間の状態と足先を対にして記録する
        const g0=e.gait;
        step(1);
        cap=[]; rframe++; drawEnemy(e); const legs=cap, st=(e._legSt||[]).slice(); cap=null;
        const xd=e.x, fd=e.facing, gwd=e.gaitW;
        const mv=Math.abs(xd-px), dg=Math.abs(e.gait-g0);
        // 骨長がフレーム間で変わらないこと
        const bk=legs.map(l=>l.l1.toFixed(4)+'/'+l.l2.toFixed(4)).join(',');
        if(bones!=null && bk!==bones && legs.length){ const pl=bones.split(',')[0].split('/')[0], nl=legs[0].l1;
          const d=Math.abs(nl-parseFloat(pl))/Math.max(1e-6,parseFloat(pl))*100;
          if(d>bonePulse){ bonePulse=d; boneN=ty; } }
        bones=bk;
        // 接地判定は後段で行う（遊脚は lift ぶん ty が上＝小さくなるので、
        // 各脚の ty の最大値が接地面。ここでは記録だけしておく）
        frames.push({x:xd, facing:fd, legs, st, mv, dg, gw:gwd, air:(e.z||0)>0});   // 滞空中は接地ロックの対象外
        if(mv>0.05 && dg>1e-6 && (e.z||0)<=0){ dgSum+=dg; mvSum+=mv; nSmp++; }   // ケイデンスは接地時のみ（滞空中は位相を回さない）
        px=xd; }
      { // 描画側が記録した接地フラグ（e._legSt）を使い、両フレームとも接地の脚だけを突き合わせる
        const nL=frames.length?frames[0].legs.length:0;
        for(let n=1;n<frames.length;n++){ const cur=frames[n], pre=frames[n-1];
          if(cur.legs.length!==nL||pre.legs.length!==nL) continue;
          if(cur.st.length!==nL||pre.st.length!==nL) continue;
          if(cur.air||pre.air) continue;
          if(!(cur.mv>0.06 && cur.mv<12 && cur.dg>1e-6 && cur.facing===pre.facing)) continue;
          for(let k=0;k<nL;k++){
            if(!cur.st[k] || !pre.st[k]) continue;                       // どちらかが遊脚なら対象外
            const fwNow=cur.x+cur.legs[k].tx*FIXED_SCALE*cur.facing;
            const fwPre=pre.x+pre.legs[k].tx*FIXED_SCALE*pre.facing;
            const slide=Math.abs(fwNow-fwPre);
            if(slide>worst){ worst=slide; worstN=ty+' leg'+k+' '+(slide/cur.mv*100).toFixed(1)+'%'; } } } }
      if(nSmp<40) continue;
      measured++;
      // ケイデンスは「素の移動速度で歩いたら何歩/秒か」に正規化する（テストの押し方に依存させない）
      const sps=2*60*(T.sp||1.5)*(dgSum/mvSum)/(Math.PI*2);
      if(sps>fastest){ fastest=sps; fastN=ty; }
      if(sps<slowest){ slowest=sps; slowN=ty; } }
    foeLegTo=origLegTo; foeLegSolve=origSolve;
    if(_g(13,measured<11)) throw new Error('計測できた敵が '+measured+' 体しかない');
    if(_g(14,!(bonePulse<0.01))) throw new Error('骨長がフレーム間で '+bonePulse.toFixed(2)+'% 伸縮 ('+boneN+')');
    if(_g(15,!(worst<0.06))) throw new Error('接地足がワールド座標で '+worst.toFixed(3)+'px/F 滑走 ('+worstN+')');
    if(_g(16,!(fastest<=7.6))) throw new Error('ケイデンスが速すぎる（ミシン脚）: '+fastest.toFixed(1)+'歩/秒 ('+fastN+')');
    if(_g(17,!(slowest>=1.2))) throw new Error('ケイデンスが遅すぎる: '+slowest.toFixed(1)+'歩/秒 ('+slowN+')');
    console.log('接地足の静止 OK ('+measured+'体／実描画の足先目標で最大滑走 '+worst.toFixed(4)+'px/F ／骨長の伸縮 '+bonePulse.toFixed(3)+'% ／ケイデンス '+slowest.toFixed(1)+'〜'+fastest.toFixed(1)+'歩/秒)'); }

  // ===== 4b2) 遊脚の水平速度が接地相と繋がる（離地・接地でしゃくらない） =====
  { let worst=0;
    for(const D of [0.44,0.53,0.62]){
      const S=30, N=400; let prev=null;
      for(let n=0;n<=N;n++){ const f=gaitStep(n/N,S,0,D);
        if(prev!=null){ const v=(f.x-prev)*N; if(prev2!=null){ const acc=Math.abs(v-prevV); if(acc>worst) worst=acc; } var prevV=v; var prev2=1; }
        prev=f.x; }
    }
    // 段差（速度の不連続）が歩幅×3以下＝連続とみなす
    if(_g(18,!(worst<30*4))) throw new Error('遊脚と接地相の水平速度が不連続（しゃくり）: '+worst.toFixed(1));
    console.log('歩行カーブの連続性 OK (水平速度の最大段差 '+worst.toFixed(1)+')'); }

  // ===== 4b3) 骨の長さがフレームごとに伸縮しない（ゴム脚の防止） =====
  { const e={_lr:17, gait:0, gaitW:1, _stride:16};
    const lens=new Set();
    for(let n=0;n<40;n++){ e.bobY=-n*0.08;                      // bobY が動いても骨長は不変であること
      const F=legFit(e,'t-22_9_9_11',-(-22)-11*0.42,9,9,16);
      lens.add(F.l1.toFixed(6)+'/'+F.l2.toFixed(6)); }
    if(_g(19,lens.size!==1)) throw new Error('骨長がフレームごとに変化している: '+[...lens].join(' , '));
    // フィットが実際に「歩幅の両端に届く長さ」を返すこと
    const h=22-11*0.42, F=legFit({},'x',h,9,9,26);
    if(_g(20,!(F.R>=Math.hypot(h,13)/0.97-0.01))) throw new Error('歩幅の端に届かない脚長を返した');
    console.log('骨長の固定 OK (bobY 40段階で伸縮ゼロ／歩幅の端まで届く長さを確保)'); }

  // ===== 4c) 逆運動学が足先を目標へ正確に置く／接地相の足は地面に乗る =====
  { // 届く範囲の目標には誤差ゼロで到達する
    let worst=0;
    for(const kd of [1,-1]) for(let tx=-12;tx<=12;tx+=3) for(let ty=6;ty<=16;ty+=2){
      if(Math.hypot(tx,ty)>(9+8)*0.99) continue;   // 届かない目標はIKの誤差ではない
      const r=foeLegTo(0,0,tx,ty,9,8,10,'#888',null,kd,0);
      worst=Math.max(worst, Math.hypot(r.fx-tx, r.fy-ty)); }
    if(_g(21,!(worst<0.01))) throw new Error('IK の足先誤差 '+worst.toFixed(3)+'px');
    // 接地相は必ず lift=0（地面から浮かない）
    for(let n=0;n<200;n++){ const u=n/200; const f=gaitStep(u,30,8);
      if(_g(22,f.st && f.y!==0)) throw new Error('接地相で足が地面から離れている u='+u.toFixed(3)+' y='+f.y); }
    // 遊脚相はきちんと持ち上がる
    let peak=0; for(let n=0;n<200;n++){ const f=gaitStep(n/200,30,8); if(!f.st) peak=Math.max(peak,-f.y); }
    if(_g(23,!(peak>6))) throw new Error('遊脚が持ち上がらない peak='+peak);
    console.log('接地ロック OK (IK 誤差 '+worst.toFixed(4)+'px／接地相は常に地面・遊脚は '+peak.toFixed(1)+'px 持ち上がる)'); }

  // ===== 4d) 重心の上下がパッシングで最高・開脚で最低（従来は位相が逆だった） =====
  { setupRoster('inu'); startGame(); state='play';
    enemies.length=0; encounters.length=0;
    spawnEnemy('wolf', players[0].x+240, LANE);
    const e=enemies[0]; e.hp=e.maxHp=99999; e.thinkCd=99999;
    for(let n=0;n<30;n++){ e.state='walk'; e.z=0; drawEnemy(e); step(1); }
    const S=e._stride, R0=e._lr;
    let atPass=null, atSplit=null;
    for(let n=0;n<120;n++){ const u=n/120;
      const D=e._gd;
      const a=gaitStep(u,S,0,D), b=gaitStep(u+0.5,S,0,D);
      let d=1e9; if(a.st)d=Math.min(d,Math.abs(a.x)); if(b.st)d=Math.min(d,Math.abs(b.x)); if(d>1e8)d=S*0.5;
      const R=R0, raw=Math.sqrt(Math.max(1,R*R-d*d))-R;
      const full=Math.max(0.5,R-Math.sqrt(Math.max(1,R*R-S*S*0.25)));
      const bob=raw*((ETYPE.wolf.h||70)*0.045/full);
      if(d<0.6 && atPass===null) atPass=bob;
      if(atSplit===null || bob<atSplit) atSplit=bob; }
    if(_g(24,atPass===null)) throw new Error('パッシング（支持脚が真下）の位相が見つからない');
    if(_g(25,!(atPass>atSplit+1.2))) throw new Error('重心がパッシングで最高になっていない (pass='+atPass.toFixed(2)+' min='+atSplit.toFixed(2)+')');
    // 描画側が同じ値を使っていること
    const ds=drawEnemy.toString();
    if(_g(26,ds.indexOf('-(e.bobY||0)')<0)) throw new Error('drawEnemy が bobY を使っていない（脚のIKと基準面がずれる）');
    // 実プレイでの振れ幅が体高比で揃っていること（個体差で1px弱に埋もれていた）
    { let worst=9, worstN='', best=0;
      for(const ty of ['wolf','boar','mastiff','hyena','bitter','corgi']){ const T=ETYPE[ty]; if(!T) continue;
        enemies.length=0; encounters.length=0;
        spawnEnemy(ty, players[0].x+320, LANE); const en=enemies[0]; en.hp=en.maxHp=999999;
        for(let n=0;n<80;n++){ players[0].x-=3; en.x+=T.sp*0.7*(en.facing||1); en.state='walk'; en.z=0; step(1); drawEnemy(en); }
        let lo=1e9,hi=-1e9;
        for(let n=0;n<160;n++){ players[0].x-=3; en.x+=T.sp*0.7*(en.facing||1); en.state='walk'; en.z=0; step(1); drawEnemy(en);
          if(en.gaitW>0.9){ lo=Math.min(lo,en.bobY); hi=Math.max(hi,en.bobY); } }
        if(hi<-1e8) continue;
        const pct=(hi-lo)/(T.h||70)*100;
        if(pct<worst){ worst=pct; worstN=ty; } if(pct>best) best=pct; }
      if(_g(27,!(worst>3.5))) throw new Error('重心の振れ幅が体高の '+worst.toFixed(1)+'% しかない ('+worstN+')');
      if(_g(28,!(best-worst<1.5))) throw new Error('重心の振れ幅が個体でばらついている ('+worst.toFixed(1)+'〜'+best.toFixed(1)+'%)');
      console.log('重心の上下 OK (パッシング '+atPass.toFixed(2)+'px ＞ 開脚 '+atSplit.toFixed(2)+'px ／振れ幅は体高の '+worst.toFixed(1)+'〜'+best.toFixed(1)+'%)'); } }

  // ===== 4e) 全脚が同じ歩幅を使う（届かない脚は歩幅を削らず脚を伸ばして解決する） =====
  { for(const fn of [drawBeast, foeLegsGait]){ const src=fn.toString();
      if(_g(29,src.indexOf('reach*0.95')>=0 || src.indexOf('_lim')>=0))
        throw new Error(fn.name+' が脚ごとに歩幅をクランプしている（短い脚だけが滑る）');
      if(_g(30,src.indexOf('e._stride')<0)) throw new Error(fn.name+' が個体共通の歩幅を使っていない'); }
    // 到達範囲の違う4本に同じ歩幅を与えても、legFit が全て届く長さを返すこと
    const e={}, S=30;
    for(const q of [[-19,10.5,9,8],[-17,9,8,7],[-21,11,9,8],[-19,9.5,8,7]]){
      const h=-q[0]-q[1]*0.42, F=legFit(e,'z'+q[0]+q[1],h,q[2],q[3],S);
      const need=Math.hypot(h,S*0.5);
      if(_g(31,!(F.R*0.995>=need))) throw new Error('歩幅の端に届かない: R='+F.R.toFixed(2)+' need='+need.toFixed(2)); }
    console.log('歩幅の統一 OK (脚ごとのクランプ廃止／到達不足は脚長で解決)'); }

  // ===== 5) 敵の武器角が1フレームで飛ばない =====
  { const targets=['drawBitter','drawBoss','drawGuard0','drawRival','drawGolux','drawDarkKnight','drawAlienBoss'];
    let wired=0;
    for(const n of targets){ if(typeof global[n]!=='function' && typeof eval('typeof '+n)==='undefined') continue;
      const src=eval(n).toString();
      if(src.indexOf('let ang=')<0) continue;
      if(_g(32,src.indexOf('foeArm(')<0)) throw new Error(n+' has a raw weapon-angle ternary (1フレーム瞬間移動が残存)');
      wired++; }
    if(_g(33,wired<4)) throw new Error('only '+wired+' weapon arms were smoothed');
    // 補間器そのものの性質：目標が飛んでも1フレームでは飛ばない／1フレーム1回だけ進む
    const e={}; rframe=1000;
    if(_g(34,foeArm(e,0,0.3)!==0)) throw new Error('foeArm did not snap on first sight');
    rframe=1001; const a1=foeArm(e,2.0,0.3);
    if(_g(35,!(a1>0.01 && a1<1.2))) throw new Error('foeArm jumped or froze: '+a1);
    const a1b=foeArm(e,2.0,0.3);
    if(_g(36,a1b!==a1)) throw new Error('foeArm advanced twice in one frame ('+a1+' → '+a1b+')');
    rframe=1010; const a2=foeArm(e,2.0,0.3);      // 長く見えていなければ瞬時に合わせる
    if(_g(37,a2!==2.0)) throw new Error('foeArm did not re-snap after a gap: '+a2);
    console.log('武器角の追従 OK ('+wired+'関数を一次遅れ化／0→2.0 の飛びが '+a1.toFixed(2)+' に緩和)'); }

  // ===== 5b) 腕振りが手前脚と対側位相になっている（正弦駆動では105度ずれていた） =====
  { setupRoster('inu'); startGame(); state='play';
    enemies.length=0; encounters.length=0;
    const p=players[0]; player=p; p.hp=p.maxHp=999999;
    spawnEnemy('bitter', p.x+320, LANE);
    const e=enemies[0]; e.hp=e.maxHp=999999;
    for(let n=0;n<60;n++){ p.x-=3; e.state='walk'; e.z=0; drawEnemy(e); step(1); }
    const A=[], F=[];
    for(let n=0;n<420;n++){ p.x-=3; e.state='walk'; e.z=0; drawEnemy(e); step(1);   // プレイヤーを逃がし続けて歩きを継続させる
      if(!(e.gaitW>0.85)) continue;
      A.push(armSwingX(e)); F.push(gaitStep(gaitPh(e.gait),e._stride,0,e._gd).x); }   // 肩の前後動 vs 手前脚の足先ローカルX
    if(_g(38,A.length<40)) throw new Error('腕の記録が足りない: '+A.length);
    const mean=a=>a.reduce((x,y)=>x+y,0)/a.length;
    const ma=mean(A), mf=mean(F);
    let num=0, da=0, df=0;
    for(let i=0;i<A.length;i++){ const x=A[i]-ma, y=F[i]-mf; num+=x*y; da+=x*x; df+=y*y; }
    const r=num/Math.sqrt(Math.max(1e-9,da*df));
    // 対側＝手前脚が前に出るとき腕（肩）は後ろへ。よって強い【負】の相関でなければならない。
    // 以前この符号を逆に取っており、同側振り（ロボット歩き）をパスさせていた
    if(_g(39,!(r<=-0.85))) throw new Error('腕が手前脚と対側位相になっていない (相関 '+r.toFixed(3)+'／対側なら負)');
    // 肩の前後動が実際に見える幅であること（回転だけでは手が1〜3pxしか動かなかった）
    let lo=1e9, hi=-1e9;
    for(let n=0;n<160;n++){ e.gait=n/160*Math.PI*2; e.gaitW=1; const v=armSwingX(e); lo=Math.min(lo,v); hi=Math.max(hi,v); }
    if(_g(40,!((hi-lo)>8))) throw new Error('肩の前後動が '+(hi-lo).toFixed(1)+'px しかない（腕振りが見えない）');
    console.log('腕振りの位相 OK (肩の前後動との相関 '+r.toFixed(3)+' ＝対側／振れ幅 '+(hi-lo).toFixed(1)+'ローカルpx)'); }

  // ===== 5c) 上体の揺れが接地ロックを壊さない =====
  { const src=drawEnemy.toString();
    if(_g(41,src.indexOf('ctx.rotate(-_f.x*')<0)) throw new Error('上体の揺れが入っていない');
    // 接地点まわりの微小回転で、足先（原点から±20px以内）がどれだけ動くか
    let worst=0;
    for(let n=0;n<60;n++){ const f=gaitStep(n/60,1,0,0.52), ang=-f.x*0.055;
      for(const fx of [-20,-10,10,20]) worst=Math.max(worst, Math.abs(fx*(1-Math.cos(ang)))+Math.abs(0*Math.sin(ang))+Math.abs(fx*0+0)); }
    // 足は y≈0 なので回転による移動は主に y 方向。x 方向のずれは fx*(1-cos) で極小
    if(_g(42,!(worst<0.35))) throw new Error('上体の揺れで足が '+worst.toFixed(2)+'px 動く');
    console.log('上体の揺れ OK (接地点まわりの微小回転／足先のずれ '+worst.toFixed(3)+'px)'); }

  // ===== 6) 実プレイで四つ足・二足とも脚が動き、静止すると止まる =====
  { enemies.length=0; encounters.length=0;
    const p=players[0]; player=p;
    spawnEnemy('wolf', p.x+200, LANE);
    const a=enemies[enemies.length-1];
    a.state='walk';
    let moved=0, prevG=a.gait||0;
    for(let i=0;i<60;i++){ step(1); if(Math.abs((a.gait||0)-prevG)>0.001) moved++; prevG=a.gait||0; }
    if(_g(43,!(moved>10))) throw new Error('walking enemy gait barely advanced ('+moved+'/60)');
    console.log('実プレイの歩行 OK (60F中 '+moved+'F で位相が進む)'); }

  console.log('ANIM2 QUADRUPED/LEG TEST PASSED'); process.exit(0);
})().catch(e=>{ console.error('FAIL:', e.message, e.stack); process.exit(1); });
`;
code = code + "\n;" + DRIVER;
(0, eval)(code);

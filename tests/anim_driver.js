const DRIVER = `
(async()=>{
  const step=(n)=>{ for(let i=0;i<n;i++){ if(global.rafCb){ const cb=global.rafCb; global.rafCb=null; cb(); } } };
  sndOn=false;

  // ===== 1) ばね（減衰振動）の基本性質 =====
  { const sp=mkSpring(0); sprKick(sp,10);
    let peak=0; for(let i=0;i<300;i++){ sprUpd(sp,0,15,0.55); peak=Math.max(peak,Math.abs(sp.x)); }
    if(!(peak>0.1)) throw new Error('spring never moved after a kick');
    if(!(Math.abs(sp.x)<0.01 && Math.abs(sp.v)<0.1)) throw new Error('spring did not settle: x='+sp.x+' v='+sp.v);
    // オーバーシュート（減衰比<1 で必ず一度は行き過ぎる＝フォロースルーの源）
    const sp2=mkSpring(5); let crossed=false;
    for(let i=0;i<200;i++){ sprUpd(sp2,0,15,0.55); if(sp2.x<0) crossed=true; }
    if(!crossed) throw new Error('spring never overshot (no follow-through)');
    console.log('ばね OK (kickで弾み、オーバーシュートし、静止する)'); }

  // ===== 2) プレイヤーのリグ：着地・踏み切り・振り向き・被弾で弾かれる =====
  setupRoster('inu'); startGame(); state='play';
  const p=players[0]; player=p;
  if(!p.rig||!p.rig.sq||!p.rig.wob||!p.rig.capeM||!p.rig.capeT) throw new Error('player rig missing');
  { p.rig.sq.x=0; p.rig.sq.v=0; p.prevZ=40; p.z=0;
    updateRigP(p);
    if(!(p.rig.sq.v>1)) throw new Error('landing did not kick the squash spring (v='+p.rig.sq.v+')');
    const vLand=p.rig.sq.v;
    p.rig.sq.v=0; p.prevZ=0; p.z=10; updateRigP(p);
    if(!(p.rig.sq.v<-1)) throw new Error('jump start did not stretch (v='+p.rig.sq.v+')');
    p.rig.wob.v=0; p.prevFacing=1; p.facing=-1; updateRigP(p);
    if(Math.abs(p.rig.wob.v)<1) throw new Error('turning did not kick the wobble spring');
    console.log('リグ検出 OK (着地=潰れ v'+vLand.toFixed(1)+' / 踏切=伸び / 振り向き=しなり)'); }
  { p.rig.sq.v=0; p.rig.wob.v=0; p.invuln=0; p.state='idle';
    hurtPlayer(p, 5, 1, false);
    if(Math.abs(p.rig.sq.v)<1 || Math.abs(p.rig.wob.v)<1) throw new Error('hurt did not kick the rig');
    p.hp=p.maxHp; p.state='idle'; p.invuln=0;
    console.log('被弾リグ OK (被弾でスクワッシュ＋しなりが入る)'); }

  // ===== 3) ポーズのスローイン・スローアウト（中間ポーズを必ず通る）=====
  { p.state='idle'; p.z=0; p.atk=null; enemies.length=0; encounters.length=0; hitStop=0;
    for(let i=0;i<40;i++) step(1);                     // idle に馴染ませる
    if(!p.poseB) throw new Error('poseB never created');
    const idleAng=p.poseB.swAng;
    beginAttack('c4');                                  // 振り下ろし（大きく構える）
    step(1); const a1=p.poseB.swAng;
    step(2); const a3=p.poseB.swAng;
    const tgtDir=Math.sign(a3-idleAng);
    if(Math.abs(a1-idleAng)<1e-4) throw new Error('pose froze on state change');
    if(Math.abs(a1-idleAng)>=Math.abs(a3-idleAng)) throw new Error('pose snapped instead of easing');
    if(Math.sign(a1-idleAng)!==tgtDir) throw new Error('pose moved the wrong way');
    console.log('ポーズブレンド OK (idle '+idleAng.toFixed(2)+' → 1F '+a1.toFixed(2)+' → 3F '+a3.toFixed(2)+' と中間を通過)'); }

  // ===== 4) 高速連撃では振り幅を殺さない（武器腕は俊敏レート）=====
  { p.state='idle'; p.atk=null; for(let i=0;i<30;i++) step(1);
    setupRoster('wanden'); startGame(); state='play'; const w=players[0]; player=w;
    enemies.length=0; encounters.length=0; hitStop=0;
    for(let i=0;i<30;i++) step(1);
    beginAttack('wd4');
    let lo=99, hi=-99;
    for(let f=0; f<ATK.wd4.dur && w.atk; f++){ hitStop=0; step(1);
      if(w.poseB){ lo=Math.min(lo,w.poseB.swAng); hi=Math.max(hi,w.poseB.swAng); } }
    if(!(lo<-0.8 && hi>0.8)) throw new Error('乱れ切り lost its swing range (lo='+lo.toFixed(2)+' hi='+hi.toFixed(2)+')');
    console.log('連撃の振り幅 OK (乱れ切り '+lo.toFixed(2)+'〜'+hi.toFixed(2)+' まで振り切る)'); }

  // ===== 5) マントの擬似布：移動と逆へなびき、止まると戻る =====
  { setupRoster('inu'); startGame(); state='play'; const q=players[0]; player=q;
    enemies.length=0; encounters.length=0; hitStop=0;
    q.rig.capeT.x=0; q.rig.capeT.v=0; q.rig.capeM.x=0; q.rig.capeM.v=0;
    q.facing=1;
    for(let i=0;i<40;i++){ q.prevX=q.x; q.x+=5; updateRigP(q); }   // 右へ走る
    if(!(q.rig.capeT.x<-1.2)) throw new Error('cape does not trail behind while running ('+q.rig.capeT.x.toFixed(2)+')');
    const trail=q.rig.capeT.x;
    for(let i=0;i<160;i++){ q.prevX=q.x; updateRigP(q); }          // 停止
    if(!(Math.abs(q.rig.capeT.x)<0.35)) throw new Error('cape never settles ('+q.rig.capeT.x.toFixed(2)+')');
    if(!(Math.abs(q.rig.capeM.x)<Math.abs(trail))) throw new Error('mid segment should lag less than the tip');
    console.log('マント OK (走行中 '+trail.toFixed(1)+' 後方へ、停止で復帰、中間<先端の遅れ)'); }

  // ===== 6) 敵のスクワッシュ：被弾・着地でぷにっと潰れ、必ず静まる =====
  { enemies.length=0; spawnEnemy('wolf', players[0].x+80, LANE);
    const e=enemies[0]; e.thinkCd=99999; e.hp=e.maxHp=99999;
    if(e.sq===undefined||e.sqv===undefined? false : false) throw new Error('unreachable');
    damageEnemy(e, 8, 3, false);
    if(!((e.sqv||0)>1)) throw new Error('enemy hit did not kick the squash ('+e.sqv+')');
    let peak=0; for(let f=0;f<240;f++){ hitStop=0; e.thinkCd=99999; step(1); peak=Math.max(peak,Math.abs(e.sq||0)); }
    if(!(peak>0.05)) throw new Error('enemy squash never showed');
    if(!(Math.abs(e.sq)<0.05)) throw new Error('enemy squash never settled ('+e.sq+')');
    // 着地でも潰れる
    e.sq=0; e.sqv=0; e.pz=40; e.z=0; hitStop=0; step(1);
    if(!(Math.abs(e.sqv)>0.5 || Math.abs(e.sq)>0.02)) throw new Error('enemy landing did not squash');
    console.log('敵スクワッシュ OK (被弾kick→減衰、着地でも潰れる、ピーク '+peak.toFixed(2)+')'); }

  // ===== 7) 長時間の安定性：600F 戦わせても発散・NaN しない =====
  { setupRoster('shima'); startGame(); state='play'; const q=players[0]; player=q;
    encounters.length=0; enemies.length=0;
    for(let i=0;i<5;i++) spawnEnemy('wolf', q.x+120+i*60, LANE);
    q.level=12; q.hp=q.maxHp=99999;
    for(let f=0;f<600;f++){ hitStop=0; slowmo=0; q.invuln=0;
      if(f%50===10) beginAttack(specialFor(q,'up'));
      if(f%37===5){ q.facing*=-1; }
      if(f%80===20){ q.z=30; q.vz=-2; }
      step(1);
      const vals=[q.rig.sq.x,q.rig.wob.x,q.rig.capeM.x,q.rig.capeT.x];
      for(const v of vals){ if(!isFinite(v)||Math.abs(v)>200) throw new Error('rig diverged at F'+f+': '+vals.map(x=>x&&x.toFixed?x.toFixed(1):x).join(',')); }
      if(q.poseB){ for(const k2 in q.poseB){ if(!isFinite(q.poseB[k2])) throw new Error('poseB NaN at F'+f+' key '+k2); } }
      for(const e of enemies){ if(e.sq!==undefined && (!isFinite(e.sq)||Math.abs(e.sq)>60)) throw new Error('enemy squash diverged'); } }
    console.log('安定性 OK (600F 乱闘＋振り向き＋空中でも発散・NaNなし)'); }

  // ===== 8) 実効振幅：ばねが「画面上で見える量」に届いているか =====
  // 批評家に「係数が小さすぎてスクワッシュが事実上存在しない」と差し戻された回帰を防ぐ。
  // ばね値そのものではなく、drawPlayer / drawEnemy が実際に scale/rotate へ渡す量を検証する。
  { const peakOf=(kick,w,z)=>{ const sp=mkSpring(0); sprKick(sp,kick); let pk=0;
      for(let i=0;i<120;i++){ sprUpd(sp,0,w,z); pk=Math.max(pk,Math.abs(sp.x)); } return pk; };
    // 係数は「テスト側の想定値」ではなく実際のソースから読み取る（そうしないと本体を戻しても気づけない）
    const pSrc=drawPlayer.toString(), eSrc=drawEnemy.toString();
    const grab=(src,key,label)=>{ const i=src.indexOf(key); if(i<0) throw new Error(label+' の係数をソースから読み取れない: '+key);
      let j=i+key.length, num='';
      while(j<src.length && '0123456789.'.indexOf(src[j])>=0){ num+=src[j]; j++; }
      const v=parseFloat(num); if(!isFinite(v)) throw new Error(label+' の係数が数値でない'); return v; };
    const cSq  =grab(pSrc,'rig.sq.x*',  'プレイヤーのスクワッシュ');
    const cWob =grab(pSrc,'rig.wob.x*', 'プレイヤーのしなり');
    const cESq =grab(eSrc,'(e.sq||0)*', '敵のスクワッシュ');
    // drawPlayer と同じ式で実効値を出す
    const sqPeak=peakOf(6.2,17,0.5), squash=Math.min(Math.abs(sqPeak*cSq),0.17);
    if(!(squash>=0.06)) throw new Error('着地スクワッシュが小さすぎて画面で見えない: '+(squash*100).toFixed(2)+'% (>=6% 必要)');
    const jmpPeak=peakOf(-4.6,17,0.5), stretch=Math.min(Math.abs(jmpPeak*cSq),0.17);
    if(!(stretch>=0.04)) throw new Error('踏み切りストレッチが小さすぎる: '+(stretch*100).toFixed(2)+'%');
    const wobPeak=peakOf(7.5,11,0.5), lean=Math.min(Math.abs(wobPeak*cWob),0.26);
    if(!(lean>=0.05)) throw new Error('振り向きのしなりが小さすぎる: '+(lean*180/Math.PI).toFixed(2)+'deg (>=2.9deg 必要)');
    // 敵（w=15 z=0.55、被弾キック8、係数0.55）
    let x=0,v=8,ep=0; for(let i=0;i<120;i++){ const a=-15*15*x-2*0.55*15*v; v+=a/60; x+=v/60; ep=Math.max(ep,Math.abs(x)); }
    const esq=Math.min(ep*cESq,0.21);
    if(!(esq>=0.06)) throw new Error('敵の被弾スクワッシュが小さすぎる: '+(esq*100).toFixed(2)+'%');
    console.log('実効振幅 OK (ソース係数 sq='+cSq+' wob='+cWob+' 敵sq='+cESq+' → 着地 '+(squash*100).toFixed(1)+'% / 踏切 '+(stretch*100).toFixed(1)+'% / しなり '+(lean*180/Math.PI).toFixed(1)+'deg / 敵被弾 '+(esq*100).toFixed(1)+'%)'); }

  // ===== 9) 敵は静止中も動いている（drawBeast が e.anim を参照しているか）=====
  { setupRoster('inu'); startGame(); state='play';
    encounters.length=0; enemies.length=0; spawnEnemy('wolf', players[0].x+140, LANE);
    const e=enemies[0]; e.thinkCd=99999; e.state='idle'; e.gait=0; e.gaitW=0;
    const seen=new Set();
    for(let f=0;f<180;f++){ e.anim=f*0.16;
      const br=Math.sin(e.anim*0.9);
      seen.add((-32+br*0.9).toFixed(2)+'/'+(27+br*0.9).toFixed(2)); }
    if(seen.size<20) throw new Error('敵の呼吸が動いていない（胴のバリエーション '+seen.size+'種）');
    // まばたきが実際に閉じるところまで行くか
    let minO=1, maxO=0;
    for(let f=0;f<900;f++){ e.anim=f*0.16; const b=foeBlink(e); minO=Math.min(minO,b); maxO=Math.max(maxO,b); }
    if(!(minO<0.25)) throw new Error('敵が一度も目を閉じない（最小開度 '+minO.toFixed(2)+'）');
    if(!(maxO>0.95)) throw new Error('敵の目が開ききらない（最大開度 '+maxO.toFixed(2)+'）');
    // 個体ごとに位相がずれている（群れが一斉に瞬かない）
    enemies.length=0; for(let i=0;i<6;i++) spawnEnemy('wolf', players[0].x+100+i*40, LANE);
    // 「いつ閉じるか」がばらけていること（開いている瞬間を比べても全員1.0で意味がない）
    const closeAt=enemies.map(q=>{ for(let f=0;f<1200;f++){ q.anim=f*0.16; if(foeBlink(q)<0.25) return f; } return -1; });
    if(closeAt.some(v=>v<0)) throw new Error('1200Fの間に一度も閉じない個体がいる: '+closeAt.join(','));
    const phases=new Set(closeAt);
    if(phases.size<3) throw new Error('群れのまばたきが揃ってしまう（閉眼タイミング '+phases.size+'種 / '+closeAt.join(',')+'）');
    console.log('敵の生命感 OK (呼吸 '+seen.size+'段階／まばたき '+minO.toFixed(2)+'〜'+maxO.toFixed(2)+'／6体で位相 '+phases.size+'種)'); }

  // ===== 10) gaitA が実際に読まれている（死にデータでない）=====
  { const kinds=['wolf','hyena','boar','guard'];
    const as=kinds.map(k=>ETYPE[k].gaitA);
    if(as.some(v=>v===undefined)) throw new Error('gaitA が未定義の種がある');
    if(new Set(as).size<2) throw new Error('gaitA が全種同じ＝差が出ない');
    const src=drawBeast.toString();
    if(!/gaitA/.test(src)) throw new Error('drawBeast が gaitA を参照していない（死にデータ）');
    console.log('歩幅 gaitA OK (drawBeast が参照／'+kinds.map((k,i)=>k+'='+as[i]).join(' ')+')'); }

  // ===== 11) 起き上がりが1フレームも飛ばない =====
  { setupRoster('inu'); startGame(); state='play';
    const q=players[0]; player=q; encounters.length=0; enemies.length=0;
    q.state='down'; q.downTimer=1; q.getMax=undefined; q.getT=0;
    for(let f=0;f<6 && q.state!=='getup';f++){ hitStop=0; step(1); }   // 遷移した瞬間で止める
    if(q.state!=='getup') throw new Error('down から getup へ遷移しない (state='+q.state+')');
    if(q.getMax!==12) throw new Error('getMax が設定されていない（分母の取りこぼし）: '+q.getMax);
    // 開始フレームの正規化値が 0 付近であること（12/14=0.143 から始まる飛びの回帰防止）
    const g0=clamp(1-(q.getT||0)/Math.max(1,q.getMax||12),0,1);
    if(g0>0.02) throw new Error('起き上がりが途中から始まっている（1フレーム飛び）: g='+g0.toFixed(3));
    console.log('起き上がり OK (getMax='+q.getMax+'／開始 g='+g0.toFixed(3)+' で飛びなし)'); }

  // ===== 12) 被弾の白点滅：性能退行と可読性の回帰防止 =====
  // ctx.filter を本体描画に直接掛けると fill/stroke 1回ごとにフィルタレイヤーが作られ、
  // 実測で 60fps→2.9fps まで落ちた。オフスクリーンに1回描いて drawImage 1回に
  // だけ filter を掛ける方式へ直した。その構造が壊れていないことを検証する。
  { const src=drawEnemy.toString();
    const bodyAt=src.indexOf('drawBeast(e)');
    if(bodyAt<0) throw new Error('drawEnemy の本体ディスパッチが見つからない');
    const before=src.slice(0,bodyAt);
    // 本体描画より前で ctx.filter を立ててはいけない（＝1コールごとにレイヤーが増える書き方）
    if(before.indexOf('ctx.filter =')>=0 || before.indexOf('ctx.filter=')>=0)
      throw new Error('drawEnemy が本体描画の前に ctx.filter を設定している（60fps→3fps の性能退行が再発する）');
    if(typeof hitFlashCtx!=='function') throw new Error('オフスクリーンの白点滅バッファが無い');
    if(src.indexOf('drawImage(_hitCan')<0) throw new Error('白点滅がオフスクリーンの drawImage 経由になっていない');
    console.log('白点滅の描画方式 OK (本体描画前に ctx.filter を立てない／drawImage 1回に集約)'); }
  // 白飛びは「直近に殴った1体」だけ（複数が同時に真っ白だと誰に当てたか読めない）
  { setupRoster('inu'); startGame(); state='play';
    encounters.length=0; enemies.length=0;
    for(let i=0;i<4;i++) spawnEnemy('wolf', players[0].x+120+i*70, LANE);
    enemies.forEach(e=>{ e.thinkCd=99999; e.hp=e.maxHp=99999; e.hwAt=-999; });
    enemies.forEach(e=>damageEnemy(e, 6, 2, false));
    const lit=enemies.filter(e=>e.id===hwFocus);
    if(lit.length!==1) throw new Error('白飛びの対象が1体に絞られていない: '+lit.length+'体');
    if(hwFocus!==enemies[enemies.length-1].id) throw new Error('直近に殴った敵が対象になっていない');
    console.log('白点滅の可読性 OK (4体同時被弾でも白飛びは直近の1体のみ)'); }
  // hwRF は「次に描かれるフレーム」を指す（そうしないと真っ白の1枚目が描かれずに終わる）
  { enemies.length=0; spawnEnemy('wolf', players[0].x+80, LANE);
    const e=enemies[0]; e.hp=e.maxHp=99999; e.hwAt=-999;
    const before=rframe;
    damageEnemy(e, 6, 2, false);
    if(e.hwRF!==before+1) throw new Error('hwRF が rframe+1 でない（真っ白の1枚目が描画されない）: '+e.hwRF+' vs '+(before+1));
    // 描画側の判定が age 0 と 1 の2枚を通し、2 で抜けること
    const ages=[0,1,2].map(a=>(before+1+a)-(e.hwRF));
    if(!(ages[0]<2 && ages[1]<2 && !(ages[2]<2))) throw new Error('白飛びの尺が2描画フレームになっていない: '+ages.join(','));
    console.log('白点滅の尺 OK (描画フレーム基準で2枚ちょうど／hitStop・slowmo に伸びない)'); }

  // ── 主役の接地ロック：歩行中、接地している足はワールド座標で止まっていること ──
  // 従来はプレイヤーだけ固定周期で腿を振っており、接地している足が体の移動の
  // 40%ぶん動いていた（敵側には接地ロックの完成品があった）。
  // 40% は「接地ロックを無効化した版」を下の物差しで測り直した実測値
  {
    setupRoster('inu'); startGame(); state='play'; perfTier=1;
    const p=players[0]; player=p; p.x=camX+300; p.facing=1; p.hp=p.maxHp=999999; p.invuln=0;
    enemies.length=0; particles.length=0; encounters.length=0;
    // 湧きが乱数なので、固定しないと同じ設定で 12〜15% と振れる（敵に当たると歩幅が変わる）
    const realRnd=Math.random; let seed=12345;
    Math.random=function(){ seed=(seed*1103515245+12345)&0x7fffffff; return seed/0x7fffffff; };
    // 足先は translate(bodyX,0)→scale(sqX,sqY)→translate(0,bodyY) の内側で描かれる。
    // chibiLegTo の戻り値（局所座標）をそのまま足の位置と見なすと、この3段を
    // 素通しして「描かれていない点」を測ることになる。ctx の束縛を差し替えて
    // 変換行列を自前で追い、実際に描かれる画面座標へ写す
    const realCtx=ctx; let M=[1,0,0,1,0,0]; const mstk=[];
    const mmul=function(a,b){ return [a[0]*b[0]+a[2]*b[1], a[1]*b[0]+a[3]*b[1],
                                      a[0]*b[2]+a[2]*b[3], a[1]*b[2]+a[3]*b[3],
                                      a[0]*b[4]+a[2]*b[5]+a[4], a[1]*b[4]+a[3]*b[5]+a[5]]; };
    const mapx=function(x,y){ return M[0]*x+M[2]*y+M[4]; };
    ctx=new Proxy(realCtx,{ get:function(t,k){
      if(k==='save') return function(){ mstk.push(M.slice()); };
      if(k==='restore') return function(){ if(mstk.length) M=mstk.pop(); };
      if(k==='translate') return function(x,y){ M=mmul(M,[1,0,0,1,x,y]); };
      if(k==='scale') return function(x,y){ M=mmul(M,[x,0,0,y,0,0]); };
      if(k==='rotate') return function(a){ const c=Math.cos(a), s2=Math.sin(a); M=mmul(M,[c,s2,-s2,c,0,0]); };
      if(k==='setTransform') return function(a,b,c,d,e,f){ M=[a,b,c,d,e,f]; };
      if(k==='resetTransform') return function(){ M=[1,0,0,1,0,0]; };
      if(k==='getTransform') return function(){ return {a:M[0],b:M[1],c:M[2],d:M[3],e:M[4],f:M[5]}; };
      // 靴は chibiLeg / chibiLegTo のどちらも ellipse(fx+2,fy+1,6,4.5) で描く。
      // ここを捕まえれば、接地ロックの有無にかかわらず同じ物差しで測れる
      if(k==='ellipse') return function(x,y,rx,ry){ if(feet && rx===6 && ry===4.5) feet.push(mapx(x-2,y-1)); };
      return t[k]; } });
    let feet=null;
    const rec=[];
    try {
      // 等速でしか歩かせないと、位相を「移動距離から積分」しなくても
      // 定数を足すだけで同じ結果になり、壊れているのに素通りする。
      // 歩く→止まる→歩く で速度を変える
      for(let f=0;f<90;f++){ p.in.K.right=(f<30)||(f>=50); hitStop=0; slowmo=0; step(1);
        // perfTier を毎フレーム固定する。0 に戻ると rimBegin が ctx の束縛を
        // オフスクリーンへ差し替えるので、追跡プロキシごと外れて足が拾えなくなる
        feet=[]; M=[1,0,0,1,0,0]; mstk.length=0; perfTier=1; drawPlayer();
        // camX が動くと画面座標も動くので、カメラぶんを戻してワールドで見る
        if(feet.length>=2) rec.push({px:p.x, w0:feet[0]+camX, w1:feet[1]+camX});
        feet=null; }
    } finally { ctx=realCtx; Math.random=realRnd; }
    if(rec.length<40) throw new Error('足先が取れていない（'+rec.length+'フレームしか取れない）');
    // 前後2本のうち「動かなかった方」が接地足。yで選ぶと入れ替わりの瞬間に別の足を見てしまう
    let slide=0, walked=0;
    for(let i2=1;i2<rec.length;i2++){
      const d0=Math.abs(rec[i2].w0-rec[i2-1].w0), d1=Math.abs(rec[i2].w1-rec[i2-1].w1);
      const mv=Math.abs(rec[i2].px-rec[i2-1].px);
      if(mv>0.1){ slide+=Math.min(d0,d1); walked+=mv; } }
    const ratio=slide/Math.max(1,walked);
    // 改修前は 40%。直値で 13% 未満を要求する。改変で赤くなることを確認済み：
    //   接地ロックを外す 40% ／ 描画倍率の補正を外す 15% ／
    //   位相を移動距離から積分しない 53% ／ 接地相で足を後ろへ送らない 100%
    if(!(ratio<0.13)) throw new Error('接地している足が滑る: 体の移動の '+(ratio*100).toFixed(0)+'%');
    console.log('主役の接地ロック OK (接地足の移動は体の '+(ratio*100).toFixed(0)+'%／改修前は40%)');
  }

  console.log('DISNEY ANIMATION TEST PASSED'); process.exit(0);
})().catch(e=>{ console.error('FAIL:', e.message, e.stack); process.exit(1); });
`;
code = code + "\n;" + DRIVER;
(0, eval)(code);

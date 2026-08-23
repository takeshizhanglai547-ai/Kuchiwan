const DRIVER = `
(async()=>{
  // ═══ 服・防具（コスチューム）═══
  // 各キャラ20着。見た目（配色と装飾）が変わり、稀少度ぶん守りが上がる。
  // 敵が落とすか店で買う。

  const setup=function(kind){ sndOn=false; setupRoster(kind); startGame(); state='play';
    const p=players[0]; resetPlayer(p,true); player=p; p.kind=kind;
    p.state='idle'; p.z=0; p.atk=null; p.invuln=0;
    enemies.length=0; projectiles.length=0; items.length=0; return p; };
  const KINDS=['inu','shima','nuko','guard8','watch','wanden','mack'];

  // ===== 1) 7キャラそれぞれに20着ある =====
  { const ids={}, names={};
    KINDS.forEach(function(k){ const L=costumeList(k);
      if(L.length!==20) throw new Error(k+' の服が '+L.length+' 着しかない');
      L.forEach(function(C){
        if(C.kind!==k) throw new Error(C.id+' の持ち主が '+C.kind);
        if(ids[C.id]) throw new Error('IDが重複している: '+C.id);
        ids[C.id]=1;
        if(names[C.name]) throw new Error('名前が重複している: '+C.name);
        names[C.name]=1;
        if(COS_ACC.indexOf(C.acc)<0) throw new Error(C.name+' の装飾 '+C.acc+' が種類表に無い');
        if(!(C.cost>0)) throw new Error(C.name+' の値段が '+C.cost);
        if(!C.pal || !C.pal.a || !C.pal.f) throw new Error(C.name+' に配色が無い'); }); });
    if(Object.keys(ids).length!==140) throw new Error('全体で '+Object.keys(ids).length+' 着（140着であるべき）');
    // 値段は稀少度とともに上がる（同じ並びで安い方が強い、が無いこと）
    KINDS.forEach(function(k){ const L=costumeList(k);
      for(let i=1;i<L.length;i++) if(!(L[i].cost>L[i-1].cost))
        throw new Error(k+' の '+i+'着目で値段が上がらない（'+L[i-1].cost+' → '+L[i].cost+'）'); });
    console.log('服・防具の品目 OK (7キャラ×20着＝'+Object.keys(ids).length+'着、ID・名前とも重複なし)'); }

  // ===== 2) 装飾は1種類に偏らない（全部が同じ見た目では「20種類」にならない） =====
  { const L=costumeList('inu'), use={};
    L.forEach(function(C){ use[C.acc]=(use[C.acc]||0)+1; });
    const kinds=Object.keys(use);
    if(kinds.length<5) throw new Error('装飾が '+kinds.length+' 種類しか使われていない');
    // 配色も全着で違うこと
    const pals={};
    L.forEach(function(C){ const key=C.pal.a+'/'+C.pal.f+'/'+C.pal.ba;
      if(pals[key]) throw new Error('同じ配色が2着ある: '+C.name+' と '+pals[key]);
      pals[key]=C.name; });
    console.log('見た目の作り分け OK (装飾 '+kinds.length+'種類・'+L.length+'着すべて別の配色)'); }

  // ===== 3) 着ると描画の色が変わる =====
  { const real=ctx;
    // 手足の色は limbSeg / chibiLeg に「色」として渡される（fillStyle には
    // グラデーションが入るので、ctx を見ているだけでは配色が捕まらない）。
    // 実装が実際に呼ぶ関数の引数を拾う
    const paint=function(p){ const cols={};
      const oL=limbSeg, oA=poseArm, oLg=chibiLeg, oLt=chibiLegTo;
      limbSeg=function(ax,ay,bx,by,w,col){ if(typeof col==='string') cols[col]=1; return oL.apply(null,arguments); };
      poseArm=function(sx,sy,a,l1,l2,col){ if(typeof col==='string') cols[col]=1; return oA.apply(null,arguments); };
      chibiLeg=function(h,t,k,col,boot){ if(typeof col==='string') cols[col]=1; if(typeof boot==='string') cols[boot]=1; return oLg.apply(null,arguments); };
      chibiLegTo=function(h,tx,ty,col,boot){ if(typeof col==='string') cols[col]=1; if(typeof boot==='string') cols[boot]=1; return oLt.apply(null,arguments); };
      try{ ctx=new Proxy(real,{ get:function(t,k){ const v=t[k];
            if(typeof v==='function') return function(){ return v.apply(t,arguments); };
            return v; },
          set:function(t,k,v){ if(k==='fillStyle'&&typeof v==='string') cols[v]=1; t[k]=v; return true; } });
        player=p; drawPlayer();
      } finally { ctx=real; limbSeg=oL; poseArm=oA; chibiLeg=oLg; chibiLegTo=oLt; }
      return cols; };
    const p=setup('inu');
    const bare=paint(p);
    const C=costumeList('inu')[12];
    gainCostume(p, C.id);
    if(p.wear!==C.id) throw new Error('着ていない（wear='+p.wear+'）');
    const worn=paint(p);
    if(!worn[C.pal.a]) throw new Error('着ても服の色 '+C.pal.a+' が塗られていない');
    if(!worn[C.pal.f]) throw new Error('着ても服の色 '+C.pal.f+' が塗られていない');
    if(bare[C.pal.a]) throw new Error('着る前から服の色が出ている（測れていない）');
    // 別の服に着替えると色も入れ替わる
    const D=costumeList('inu')[3];
    gainCostume(p, D.id);
    const worn2=paint(p);
    if(!worn2[D.pal.a]) throw new Error('着替えても新しい色が出ない');
    if(worn2[C.pal.a]) throw new Error('着替えても前の服の色が残っている');
    console.log('着替えで配色が変わる OK ('+C.name+' → '+D.name+')'); }

  // ===== 4) 装飾が実際に描かれ、キャラ描画からも呼ばれる =====
  { const real=ctx;
    // drawPlayer はリムライトで ctx の束縛ごと差し替わるので、その中の描画は
    // 外から張ったプロキシでは数えられない。装飾の描画そのものは直に呼んで測り、
    // 「キャラ描画から呼ばれているか」は関数を張って別に確かめる
    const shape=function(C){ let n=0;
      try{ ctx=new Proxy(real,{ get:function(t,k){ const v=t[k];
            if(k==='ellipse'||k==='quadraticCurveTo'||k==='fillRect'||k==='lineTo'||k==='arc'||k==='stroke')
              return function(){ n++; return v.apply(t,arguments); };
            if(typeof v==='function') return function(){ return v.apply(t,arguments); };
            return v; }, set:function(t,k,v){ t[k]=v; return true; } });
        drawCosBack(C,0); drawCosFront(C,0);
      } finally { ctx=real; }
      return n; };
    const byAcc={};
    costumeList('inu').forEach(function(C){ if(!byAcc[C.acc]) byAcc[C.acc]=C; });
    if(!byAcc.none) throw new Error('装飾なしの服が無い（比較の基準が取れない）');
    // どの服も胴に上衣を一枚かぶせるので、装飾なしでも0にはならない。
    // 「装飾ぶんの上乗せがあるか」を見る
    const base=shape(byAcc.none);
    if(!(base>0)) throw new Error('装飾なしの服で胴の上衣すら描かれていない');
    const grew=[];
    ['cape','wing','plate','pauldron','scarf','sash','crown','halo'].forEach(function(a){
      const C=byAcc[a]; if(!C) return;
      const n=shape(C);
      if(!(n>base)) throw new Error(a+' を着ても描画が増えない（'+base+' → '+n+'）');
      grew.push(a+' '+n); });
    if(grew.length<8) throw new Error('比べられた装飾が '+grew.length+' 種類しかない');
    // キャラ描画から前後の両方が呼ばれること
    { const p=setup('inu'); const C=byAcc.cape;
      gainCostume(p, C.id);
      let back=0, front=0; const ob=drawCosBack, of=drawCosFront;
      drawCosBack=function(q){ if(q===C) back++; return ob.apply(null,arguments); };
      drawCosFront=function(q){ if(q===C) front++; return of.apply(null,arguments); };
      try{ player=p; drawPlayer(); } finally { drawCosBack=ob; drawCosFront=of; }
      if(back!==1) throw new Error('体の後ろの装飾が '+back+' 回しか呼ばれない');
      if(front!==1) throw new Error('体の前の装飾が '+front+' 回しか呼ばれない');
      // 何も着ていなければ呼ばれない
      p.wear=null; let b2=0;
      drawCosBack=function(){ b2++; return ob.apply(null,arguments); };
      try{ player=p; drawPlayer(); } finally { drawCosBack=ob; }
      if(b2!==0) throw new Error('何も着ていないのに装飾が描かれている'); }
    console.log('装飾の描画 OK (装飾なし '+base+' 回／'+grew.join(' / ')+'／キャラ描画から前後とも呼ばれる)'); }

  // ===== 5) 稀少度ぶん守りが上がる（実際に受けるダメージで測る） =====
  { const tookWith=function(id){ const p=setup('inu');
      p.hp=p.maxHp=99999; p.defMul=1; p.invuln=0;
      if(id) gainCostume(p, id);
      spawnEnemy('wolf', p.x+40, LANE); const e=enemies[0]; e.facing=-1;
      const hp0=p.hp;
      for(let f=0;f<10;f++){ p.invuln=0; enemyAttackHit(e, ATK_VAR[0], ATK_VAR[0].hits[0]); }
      return hp0-p.hp; };
    const L=costumeList('inu');
    const bare=tookWith(null), low=tookWith(L[0].id), high=tookWith(L[19].id);
    if(!(bare>0)) throw new Error('素で殴られていない（測れていない）');
    if(L[0].def!==0) throw new Error('いちばん安い服に守りが付いている');
    if(low!==bare) throw new Error('守り0の服で被ダメージが変わっている（'+bare+' → '+low+'）');
    if(!(high<bare*0.92)) throw new Error('最上位の服でも被ダメージが '+bare+' → '+high+' しか減らない');
    // 店の護符（defMul）と混ざらない：着替えても護符ぶんが消えない
    { const p=setup('inu'); p.hp=p.maxHp=99999; p.defMul=0.5; p.invuln=0;
      gainCostume(p, L[19].id);
      if(Math.abs(p.defMul-0.5)>1e-9) throw new Error('着替えで護符ぶんの守り（defMul）が書き換わっている: '+p.defMul); }
    console.log('服の守り OK (素 '+bare+' → 布の旅装 '+low+' → 神域の衣 '+high+'／護符ぶんは据え置き)'); }

  // ===== 6) 敵から拾える（進行が進むほど良いものが混ざる） =====
  { const p=setup('inu'); stage=1; p.wardrobe=[];
    const early={}; for(let i=0;i<400;i++){ early[costumeById(dropCostumeFor(p)).rare]=1; }
    stage=12; if(typeof lap!=='undefined') lap=3;
    const late={}; for(let i=0;i<400;i++){ late[costumeById(dropCostumeFor(p)).rare]=1; }
    const eMax=Math.max.apply(null,Object.keys(early).map(Number));
    const lMax=Math.max.apply(null,Object.keys(late).map(Number));
    if(!(lMax>eMax)) throw new Error('進行しても良い服が出ない（稀少度 '+eMax+' → '+lMax+'）');
    // まだ持っていないものを優先する（同じ服ばかり拾わせない）
    stage=1; if(typeof lap!=='undefined') lap=1;
    p.wardrobe=costumeList('inu').slice(0,4).map(function(C){ return C.id; });
    let dup=0; for(let i=0;i<200;i++){ if(p.wardrobe.indexOf(dropCostumeFor(p))>=0) dup++; }
    if(dup>0) throw new Error('持っている服を '+dup+'/200 回も落としてくる');
    // 拾うと持ち物に入って、すぐ着る
    p.wardrobe=[]; p.wear=null;
    const id=dropCostumeFor(p);
    if(!gainCostume(p, id)) throw new Error('初めての服なのに「新規」にならない');
    if(p.wardrobe.indexOf(id)<0) throw new Error('拾っても持ち物に入らない');
    if(p.wear!==id) throw new Error('拾ってもすぐ着ない');
    if(gainCostume(p, id)) throw new Error('2着目の同じ服が「新規」になっている');
    console.log('ドロップ OK (序盤の稀少度 最大'+eMax+' → 終盤 最大'+lMax+'／持っている服は落とさない)'); }

  // ===== 7) 店に並び、買うと着られる =====
  { const p=setup('inu'); p.wardrobe=[]; p.wear=null; coins=99999;
    buildShopRows();
    const buyable=shopRows.filter(function(r){ return r.wearId && r.cost>0; });
    if(buyable.length<3) throw new Error('店に並ぶ服が '+buyable.length+' 着しかない');
    const row=buyable[0], before=coins;
    row.buy(); coins-=row.cost;
    if(p.wear!==row.wearId) throw new Error('買っても着ていない');
    if(coins!==before-row.cost) throw new Error('コインの引き落としが合わない');
    // 買ったものは一覧から消え、代わりに「着替え」が並ぶ
    buildShopRows();
    if(shopRows.some(function(r){ return r.wearId===row.wearId && r.cost>0; }))
      throw new Error('買った服がまだ売り物として並んでいる');
    // 別の服を買ってから、着替えの行が出ること
    const other=shopRows.filter(function(r){ return r.wearId && r.cost>0; })[0];
    other.buy(); buildShopRows();
    const change=shopRows.filter(function(r){ return r.wearId===row.wearId && r.cost===0; });
    if(change.length!==1) throw new Error('持っている服への着替えが並ばない（'+change.length+'行）');
    change[0].buy();
    if(p.wear!==row.wearId) throw new Error('着替えの行を選んでも着替わらない');
    // 他キャラの服は並ばない
    const q=setup('mack'); q.wardrobe=[]; buildShopRows();
    if(shopRows.some(function(r){ return r.wearId && r.wearId.indexOf('mack_')!==0; }))
      throw new Error('マックの店にほかのキャラの服が並んでいる');
    console.log('店 OK (買える服 '+buyable.length+'着・購入で即着用・持っている服は着替え行になる)'); }

  console.log('COSTUME TEST PASSED'); process.exit(0);
})().catch(e=>{ console.error('FAIL:', e.message, e.stack); process.exit(1); });
`;
code = code + "\n;" + DRIVER;
(0, eval)(code);

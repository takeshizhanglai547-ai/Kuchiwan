const DRIVER = `
(async()=>{
  // ═══ 背景（DC-8）：テーマごとに「地形そのもの」が違うこと ═══
  // 以前は19テーマ中8テーマが同じギザギザの尾根の色替えで、
  // 「魔界の城」に城が無く「業火の渓谷」に谷が無かった。
  // 色の代入は捨てて、座標と呼び出し列＝形だけを突き合わせる。

  const real=ctx;
  // fn を描かせて、幾何だけの署名と、記録した矩形・線分を返す
  function shape(fn){
    const ops=[], rects=[], pts=[];
    try {
      ctx=new Proxy(real,{ get:function(t,k){
          if(k==='getTransform') return function(){ return {a:1,b:0,c:0,d:1,e:0,f:0}; };
          const v=t[k];
          if(typeof v==='function') return function(){
            const a=Array.prototype.slice.call(arguments);
            ops.push(k+'('+a.map(function(x){ return typeof x==='number'? x.toFixed(1):''; }).join(',')+')');
            if(k==='fillRect') rects.push({x:a[0],y:a[1],w:a[2],h:a[3]});
            if(k==='moveTo'||k==='lineTo') pts.push({x:a[0],y:a[1]});
            return v.apply(t,a); };
          return v; },
        set:function(t,k,v){ t[k]=v; return true; } });   // 色は記録しない
      fn();
    } finally { ctx=real; }
    return {sig:ops.join('|'), rects:rects, pts:pts, n:ops.length};
  }

  // 決定論的に測るため、カメラとフレーム番号を固定する
  camX=1200; gf=300; perfTier=0;

  // ===== 1) 8つの地形が互いに別の形であること =====
  // 地形の関数を直接呼ぶと「実装はあるが呼ばれていない」を見逃す。
  // 本編と同じ入口 drawLand() を通し、テーマごとに絵が変わることを測る
  const LANDS=['forest','gorge','castle','glacier','cavern','colonnade','styx','sunken'];
  const sig={}, size={};
  LANDS.forEach(function(k){
    if(!LAND[k]) throw new Error('地形 '+k+' が実装されていない');
    const T=STAGE_THEME.filter(function(x){ return x.land===k; })[0];
    if(!T) throw new Error('地形 '+k+' を使うテーマが無い');
    const r=shape(function(){ drawLand(T); });
    sig[k]=r.sig; size[k]=r.n;
    if(r.n<40) throw new Error(k+' がほとんど描かれていない: '+r.n+'コール');
    // その地形が実際に選ばれていること（drawLand が従来の尾根へ落ちていない）
    const ridge=shape(function(){ drawRidgeRow(T); }).sig;
    if(r.sig===ridge) throw new Error(k+' のテーマが従来の尾根のまま描かれている'); });
  for(let i=0;i<LANDS.length;i++) for(let j=i+1;j<LANDS.length;j++)
    if(sig[LANDS[i]]===sig[LANDS[j]])
      throw new Error(LANDS[i]+' と '+LANDS[j]+' が同じ形（色替えだけになっている）');
  console.log('地形の描き分け OK (8種すべて別の形／従来の尾根とも別、コール数 '
    +LANDS.map(function(k){return size[k];}).join('/')+')');

  // ===== 2) 「魔界の城」に城があること =====
  // 尾根の色替えに戻ると、天守にあたる大きな矩形が消える
  { const T=STAGE_THEME.filter(function(x){ return x.land==='castle'; })[0];
    const r=shape(function(){ LAND.castle(T); });
    const keep=r.rects.filter(function(q){ return q.w>=90 && q.h>=150; });
    if(!keep.length) throw new Error('天守にあたる大きな矩形が無い（城が描かれていない）: 矩形'+r.rects.length+'個');
    const wall=r.rects.filter(function(q){ return q.w>=250 && q.h>=60 && q.h<=140; });
    if(!wall.length) throw new Error('城壁が無い');
    const merlon=r.rects.filter(function(q){ return q.w<=16 && q.h>=10 && q.h<=20; });
    if(merlon.length<10) throw new Error('狭間が足りない: '+merlon.length+'個');
    console.log('魔界の城 OK (天守'+keep.length+'／城壁'+wall.length+'／狭間'+merlon.length+')'); }

  // ===== 3) 「オリュンポス」が列柱であること =====
  { const T=STAGE_THEME.filter(function(x){ return x.land==='colonnade'; })[0];
    const r=shape(function(){ LAND.colonnade(T); });
    const cols=r.rects.filter(function(q){ return q.w>=18 && q.w<=48 && q.h>=100; });
    if(cols.length<8) throw new Error('柱が足りない: '+cols.length+'本');
    const xs=cols.map(function(q){ return Math.round(q.x); });
    if(new Set(xs).size<8) throw new Error('柱が同じ位置に重なっている');
    // 柱を並べただけでなく、神殿（破風＋エンタブラチュア）が載っていること
    const entab=r.rects.filter(function(q){ return q.w>=250 && q.h<=40; });
    if(!entab.length) throw new Error('神殿のエンタブラチュアが無い（柱が並んでいるだけ）');
    if(r.sig.indexOf('closePath')<0) throw new Error('破風の三角が無い');
    console.log('オリュンポスの列柱 OK ('+cols.length+'本、位置'+new Set(xs).size+'種、神殿の梁あり)'); }

  // ===== 4) 「渓谷」が層で退いていること =====
  // 1枚の壁ではなく、視差の違う複数層で谷を作る
  { const T=STAGE_THEME.filter(function(x){ return x.land==='gorge'; })[0];
    const r=shape(function(){ LAND.gorge(T); });
    const closes=(r.sig.match(/closePath/g)||[]).length;
    if(closes<3) throw new Error('渓谷の壁が3層に満たない: '+closes);
    const ys=r.pts.map(function(p){ return p.y; });
    const span=Math.max.apply(null,ys)-Math.min.apply(null,ys);
    if(!(span>120)) throw new Error('稜線の高低差が乏しい（谷になっていない）: '+span.toFixed(0)+'px');
    console.log('渓谷 OK ('+closes+'層、稜線の高低差 '+span.toFixed(0)+'px)'); }

  // ===== 5) 重い地形は perfTier で落ちること =====
  { const heavy=['forest','cavern'];
    heavy.forEach(function(k){
      const T=STAGE_THEME.filter(function(x){ return x.land===k; })[0];
      const n=[0,1,2].map(function(t){ perfTier=t; return shape(function(){ LAND[k](T); }).n; });
      perfTier=0;
      if(!(n[0]>n[1] && n[1]>n[2])) throw new Error(k+' が perfTier で落ちていない: '+n.join(' / '));
      if(!(n[2]>=30)) throw new Error(k+' が tier2 で消えてしまう: '+n[2]);
      console.log('  '+k+' の適応品質 OK ('+n.join('→')+'コール)'); }); }

  // ===== 6) 前景シルエットの種類が実装済みのものであること =====
  // 綴りを間違えると、既定の「ただの四角い柱」に黙って落ちる
  { const OK=['pipe','stem','branch','pillar','stalac','icicle','dead','kelp','rock','spire','colon','nobori','yari','ashi','duct','gantry','circuit','cable'];
    STAGE_THEME.forEach(function(T,i){
      if(T.fg && OK.indexOf(T.fg)<0) throw new Error('テーマ'+i+' の前景 '+T.fg+' が未実装'); });
    // 実装された種類が本当に別々の形を描くこと（既定へ落ちていないことの実測）
    const T0=STAGE_THEME.filter(function(x){ return x.fg==='colon'; })[0];
    const sg={};
    ['pillar','stalac','icicle','dead','kelp','rock','spire','colon','nobori','yari','ashi','duct','gantry','circuit','cable'].forEach(function(k){
      const save=T0.fg; T0.fg=k;
      const r=shape(function(){ drawFgSilhouettes(T0); });
      T0.fg=save;
      if(r.n<10) throw new Error('前景 '+k+' がほとんど描かれていない: '+r.n);
      sg[k]=r.sig; });
    const ks=Object.keys(sg);
    for(let i=0;i<ks.length;i++) for(let j=i+1;j<ks.length;j++)
      if(sg[ks[i]]===sg[ks[j]]) throw new Error('前景 '+ks[i]+' と '+ks[j]+' が同じ形');
    // 上の白名簿は手で書くので、名簿に足したのに実装を書き忘れると素通りする。
    // 実装の無い kind を1つ描いて「既定の四角い柱」の署名を取り、それと同じ形の
    // ものを落とす（2026-08-26 の監査で duct の実装を消しても全スイート緑だった）
    { const save=T0.fg; T0.fg='__notimplemented__';
      const base=shape(function(){ drawFgSilhouettes(T0); }).sig; T0.fg=save;
      ks.forEach(function(k){ if(sg[k]===base) throw new Error('前景 '+k+' が未実装（既定の四角い柱に落ちている）'); }); }
    console.log('前景シルエット OK ('+ks.length+'種すべて別の形・既定落ちなし)'); }

  // ===== 6b) テーマが指す中景の地形が実装済みであること =====
  // land の綴りを間違えると、黙って既定の尾根 drawRidgeRow に落ちる。
  // fg には白名簿があったが land には何の検査も無く、綴り間違いが素通りしていた
  { const miss=[];
    STAGE_THEME.forEach(function(T,i){ if(T.land && !LAND[T.land]) miss.push('テーマ'+i+':'+T.land); });
    if(miss.length) throw new Error('未実装の中景地形: '+miss.join(', '));
    const kinds={}; STAGE_THEME.forEach(function(T){ if(T.land) kinds[T.land]=1; });
    console.log('中景の地形 OK ('+Object.keys(kinds).length+'種すべて LAND に実装済み)'); }

  // ===== 7) 洞窟と海中に雲と鳥を出さないこと =====
  { const cav=STAGE_THEME.filter(function(x){ return x.land==='cavern'; })[0];
    const sea=STAGE_THEME.filter(function(x){ return x.land==='sunken'; })[0];
    if(cav.stars===0) throw new Error('前提が崩れている: 水晶洞は stars>0 で元から雲が出ない');
    // 海中は stars:0 なので、land を見て抑止していないと雲が湧く
    if(sea.stars!==0) throw new Error('前提が崩れている: 海神は stars:0 のはず');
    const before=birds.length;
    let cloudCalls=0;
    const realCloud=cloud; cloud=function(){ cloudCalls++; };
    try { const sv=STAGE2THEME[stage];
      STAGE2THEME[stage]=STAGE_THEME.indexOf(sea); bgCacheTheme=-1;
      shape(function(){ drawBackground(); });
      STAGE2THEME[stage]=sv; bgCacheTheme=-1; }
    finally { cloud=realCloud; }
    if(cloudCalls>0) throw new Error('海中に雲が '+cloudCalls+'個 出ている');
    if(birds.length>before) throw new Error('海中に鳥が飛んでいる');
    console.log('海中の空 OK (雲0個・鳥0羽)'); }

  // ===== 8) 二つの町テーマが同じ絵になっていないこと =====
  // 残る11テーマを点検した結果、蟲4種は flower/comb/web/shroom、宇宙3種は
  // saucer/corridor/core で分岐していて描き分けられていた。
  // 唯一「王都」と「黄昏の街」だけが城まで含めて同じ絵で、しかも夕暮れなのに
  // 窓が真昼のままだった（灯りの条件が stars だけで、stars:0 の街は点かない）
  {
    const idx=function(f){ for(let i=0;i<STAGE_THEME.length;i++) if(f(STAGE_THEME[i])) return i; return -1; };
    const townIdx=[]; STAGE_THEME.forEach(function(T,i){ if(T.town) townIdx.push(i); });
    if(townIdx.length!==2) throw new Error('町テーマが2つでない: '+townIdx.length);
    const realCastle=drawCastle, realGate=drawMarketGate, realBuild=drawBuildings;
    const seen={};
    const probe=function(i){
      const log={castle:0,gate:0,lit:null};
      drawCastle=function(){ log.castle++; };
      drawMarketGate=function(){ log.gate++; };
      drawBuildings=function(l){ log.lit=!!l; };
      try { const sv=STAGE2THEME[stage];
        STAGE2THEME[stage]=i; bgCacheTheme=-1;
        shape(function(){ drawBackground(); });
        STAGE2THEME[stage]=sv; bgCacheTheme=-1; }
      finally { drawCastle=realCastle; drawMarketGate=realGate; drawBuildings=realBuild; }
      return log; };
    const a=probe(townIdx[0]), b=probe(townIdx[1]);
    // 片方が城、もう片方が市場の門であること（同じ建物を色替えしただけにしない）
    if(!((a.castle&&b.gate)||(a.gate&&b.castle)))
      throw new Error('二つの町が同じ建物を出している: 城'+a.castle+'/'+a.gate+' と 城'+b.castle+'/'+b.gate);
    // 夕暮れの街は窓に灯りが入ること
    const duskI=STAGE_THEME[townIdx[0]].lit? townIdx[0] : (STAGE_THEME[townIdx[1]].lit? townIdx[1] : -1);
    if(duskI<0) throw new Error('灯りの点く町テーマが無い（夕暮れでも真昼の窓のまま）');
    const dusk=probe(duskI);
    if(dusk.lit!==true) throw new Error('灯りを指定した町で窓が点いていない');
    const dayI=(duskI===townIdx[0])?townIdx[1]:townIdx[0];
    if(probe(dayI).lit!==false) throw new Error('昼の町まで窓が点いている');
    console.log('二つの町 OK (片方は城・片方は市場の門／夕暮れだけ窓に灯りが入る)');
  }

  // ===== 焼き込みは画面と同じ密度で作る（1倍で焼いて2倍で貼らない） =====
  //   額縁は 0.9px の線と半径1.0の鋲でできているので、1倍で焼くと拡大時に滲む
  { // ヘッドレスのキャンバスは寸法を返さないので、生成そのものを横取りして
    //   「何画素で焼いたか」を捕まえる
    const old=DPR, realCE=document.createElement;
    const sink=document.createElement('canvas').getContext('2d');
    const bake=function(dpr){ let got=null;
      document.createElement=function(t){ if(t!=='canvas') return realCE.call(document,t);
        const o={ width:0, height:0, getContext:function(){ return sink; } }; got=o; return o; };
      try{ DPR=dpr; _ornCache.clear(); _ornBakes=0;
           const sp=ornSprite(200,60,'gold');
           return {w:got?got.width:0, h:got?got.height:0, lw:sp&&sp._lw, lh:sp&&sp._lh}; }
      finally { document.createElement=realCE; } };
    try{
      const a=bake(1), b=bake(2);
      if(!(a.w>0&&b.w>0)) throw new Error('額縁が焼けていない');
      if(!(b.w===a.w*2 && b.h===a.h*2))
        throw new Error('額縁が画面と同じ密度で焼かれていない（'+a.w+'x'+a.h+' → '+b.w+'x'+b.h+'）');
      if(!(b.lw===a.lw && b.lh===a.lh))
        throw new Error('論理サイズが密度で変わっている（貼る大きさが変わってしまう）');
    } finally { DPR=old; _ornCache.clear(); _ornBakes=0; }
    console.log('焼き込みの密度 OK (額縁は DPR ぶんの画素で焼き、貼る大きさは論理サイズのまま)'); }

  console.log('BACKGROUND LAYOUT TEST PASSED'); process.exit(0);
})().catch(e=>{ console.error('FAIL:', e.message, e.stack); process.exit(1); });
`;
code = code + "\n;" + DRIVER;
(0, eval)(code);

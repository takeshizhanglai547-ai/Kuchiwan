const DRIVER = `
(async()=>{
  const step=(n)=>{ for(let i=0;i<n;i++){ if(global.rafCb){ const cb=global.rafCb; global.rafCb=null; cb(); } } };
  sndOn=false;

  // ===== 1) アトラクトモード（デモ画面）=====
  if(typeof startAttract!=='function'||typeof endAttract!=='function') throw new Error('attract mode missing');
  if(ATTRACT_CARDS.length<4) throw new Error('too few attract cards');
  ATTRACT_CARDS.forEach((c,i)=>{ if(!c.title||!c.sub||!c.col) throw new Error('attract card '+i+' incomplete'); });
  state='title'; attractOn=false; titleIdle=0;
  startAttract();
  if(!attractOn) throw new Error('startAttract did not engage');
  if(state!=='attract') throw new Error('attract should open on a feature card, got '+state);
  const seqKinds=attract.seq.map(x=>x.k).join(',');
  if(!/card,demo/.test(seqKinds)) throw new Error('attract sequence should alternate cards and demos: '+seqKinds);
  console.log('アトラクト 開始 OK (放置 '+ATTRACT_IDLE+'F で起動／構成 '+seqKinds+')');
  // カードが尺で進み、デモへ入る
  for(let i=0;i<ATTRACT_CARD_LEN+2 && state==='attract';i++) updateAttract();
  if(state!=='play') throw new Error('card did not advance into the demo (state='+state+')');
  if(!enemies.length) throw new Error('demo spawned no enemies');
  const dp=players[0];
  if((dp.level||1)<7) throw new Error('demo hero should be levelled so evolved moves show');
  console.log('デモ 起動 OK ('+dp.kind+' LV'+dp.level+'／敵 '+enemies.length+'体／周回 '+lap+')');
  // AI が実際に戦う（前進し、攻撃し、必殺技も見せる）
  { const foes=enemies.slice(); foes.forEach(e=>{ e.thinkCd=99999; e.hp=e.maxHp=99999; });
    let attacked=0, specials=0;
    for(let f=0; f<900; f++){ hitStop=0; slowmo=0;   // デモAIは意図的に乱数で動くので、窓を広げて分散を均す
      // 敵を毎フレーム射程内へ引き戻す。放置すると AI が敵を吹き飛ばして間合いが空き、
      // 攻撃回数が乱数で下振れして偽陰性になる
      foes.forEach((e,ei)=>{ e.thinkCd=99999; if(Math.abs(e.x-dp.x)>110){ e.x=dp.x+(ei%2?70:-70); e.y=dp.y; e.z=0; e.state='walk'; } });
      const before=dp.atk&&dp.atk.type; step(1);
      const after=dp.atk&&dp.atk.type;
      if(after&&after!==before){ attacked++; if([SPECIAL_SLOTS].flat().some(sl=>specialFor(dp,sl)===after)) specials++; } }
    const dealt=foes.reduce((s2,e)=>s2+(e.maxHp-e.hp),0);
    // 奥義に溜めが入って1技あたりが長くなったので、回数の下限を実態に合わせる。
    // 「戦っているか」は回数だけでなく与ダメでも見る
    if(attacked<4) throw new Error('demo AI barely attacked ('+attacked+' moves in 900F)');
    if(specials<1) throw new Error('demo AI never showed a special move');
    if(dealt<=0) throw new Error('demo AI never connected');
    console.log('デモAI OK (900F中 '+attacked+'回の技／うち必殺技 '+specials+'回／与ダメ '+Math.round(dealt)+')'); }
  // デモはプレイヤーのセーブを汚さない
  { let wrote=false; const real=global.localStorage.setItem;
    global.localStorage.setItem=function(){ wrote=true; };
    saveProgress(3);
    global.localStorage.setItem=real;
    if(wrote) throw new Error('demo overwrote the player save'); }
  // デモ中は死んでゲームオーバーにならない
  { dp.hp=1; dp.lives=0; loseLife(dp);
    if(dp.hp<=0||dp.state==='dead') throw new Error('demo ended on a death'); }
  console.log('デモ 安全性 OK (セーブ非破壊／ゲームオーバーしない)');
  // 入力で即タイトルへ戻る
  endAttract();
  if(attractOn||state!=='title') throw new Error('endAttract did not return to the title');
  if(enemies.length) throw new Error('demo enemies were left behind');
  console.log('デモ 復帰 OK (任意入力でタイトルへ／後始末も完了)');

  // ===== 2) オープニングのシネマ演出 =====
  setupRoster('inu'); startOpening();
  if(state!=='cut') throw new Error('opening did not start a cutscene');
  const chapters=cut.scenes.filter(s2=>s2.chapter);
  if(chapters.length<2) throw new Error('opening has no chapter cards');
  if(!chapters[0].chapterSub) throw new Error('chapter card lacks a subtitle');
  console.log('章タイトル OK ('+chapters.map(c=>c.chapter+'「'+c.chapterSub+'」').join(' / ')+')');
  // 章カードは読み進めるものではなく、尺で自動的に流れる
  { cut.i=0; cut.t=0; let guard=0;
    while(cut && cut.i===0 && guard++<CHAPTER_LEN+10) updateCut();
    if(!cut||cut.i!==1) throw new Error('chapter card did not auto-advance'); }
  // 本文はタイプ送り、送るとシーンが進み暗転が入る
  { cut.i=1; cut.t=0; cut.fade=0;
    const len=(cut.scenes[1].text||'').length;
    for(let f=0;f<len*1.3+2;f++) updateCut();
    cutAdvance=true; updateCut();
    if(cut.i!==2) throw new Error('text scene did not advance on input');
    if(!(cut.fade>0)) throw new Error('no fade between scenes'); }
  console.log('シネマ演出 OK (章カードは自動送り／本文は入力送り＋暗転)');
  // スキップは常に効く
  { setupRoster('nuko'); startOpening(); cutSkip=true; updateCut();
    if(cut) throw new Error('skip did not close the opening'); }
  console.log('スキップ OK (どの場面からでもオープニングを飛ばせる)');
  // 全キャラのオープニングに章カードが入っている
  ['inu','shima','nuko','guard8','watch','wanden'].forEach(k=>{
    setupRoster(k); const sc=storyOpenFor();
    if(!sc.some(x=>x.chapter)) throw new Error(k+' opening has no chapter card');
    if(!sc.some(x=>x.text)) throw new Error(k+' opening has no story text'); });
  console.log('全キャラ OK (6人ぶんのオープニングすべてに章カードと本文)');

  // ===== 3) 道中イベントの提示カード =====
  cut=null; state='play'; setupRoster('inu'); startGame(); state='play';
  if(typeof showEventCard!=='function') throw new Error('event card system missing');
  ['duel','ambush','chest','cursed','spring','altar','shrine','portal','merchant','branch'].forEach(k=>{
    if(!EVENT_KIND[k]) throw new Error('event kind missing: '+k);
    if(!EVENT_KIND[k].label||!EVENT_KIND[k].col||!EVENT_KIND[k].icon) throw new Error('event kind '+k+' incomplete'); });
  eventCard=null; showEventCard('chest','宝箱を見つけた','中身は開けてのお楽しみ');
  if(!eventCard||eventCard.label!=='宝箱') throw new Error('event card did not appear');
  for(let f=0;f<EVENT_CARD_LEN+2;f++) updateEventCard();
  if(eventCard) throw new Error('event card never expired');
  console.log('イベントカード OK ('+Object.keys(EVENT_KIND).length+'種／'+EVENT_CARD_LEN+'F で自動的に消える)');
  // 腕試し・待ち伏せが実際にカードを出す
  enemies.length=0; eventCard=null;
  triggerHeroDuel({x:players[0].x+40});
  if(!eventCard||eventCard.kind!=='duel') throw new Error('duel did not raise its event card');
  if(!enemies.length) throw new Error('duel spawned no rival');
  enemies.length=0; eventCard=null;
  triggerAmbush({x:players[0].x});
  if(!eventCard||eventCard.kind!=='ambush') throw new Error('ambush did not raise its event card');
  if(enemies.length<3) throw new Error('ambush spawned too few foes');
  console.log('イベント連動 OK (腕試し＝好敵手が出現／待ち伏せ＝囲まれる、それぞれ専用カード)');
  // 同じNPCで二度出さない
  { const n={kind:'spring', x:players[0].x, face:1, lines:['泉が湧いている。']}; eventCard=null;
    startTalk(n, players[0]); if(!eventCard) throw new Error('NPC did not raise a card');
    dialog=null; state='play'; eventCard=null;
    startTalk(n, players[0]); if(eventCard) throw new Error('NPC card repeated on a second talk');
    dialog=null; state='play'; }
  console.log('重複防止 OK (同じNPCでカードは一度だけ)');
  // デモ中はイベントカードを出さない
  { attractOn=true; eventCard=null; showEventCard('chest','x','y'); attractOn=false;
    if(eventCard) throw new Error('event card shown during the attract demo'); }
  console.log('デモ中の抑制 OK (アトラクト中はイベントカードを出さない)');

  // ===== ワールドマップ：状態が読み分けられ、選ぶ材料が出ていること =====
  { const src=drawMap.toString();
    for(const [k,msg] of [['tierOf','推奨難度★'],['nextId','次の推奨先'],['bossOf','ボスの有無'],['報酬コイン','想定報酬'],['roundRect','ラベルの下敷き']])
      if(src.indexOf(k)<0) throw new Error('ワールドマップに '+msg+' が無い');
    // 情報カード（H-116）とノードのラベルが重ならない高さに収まっていること
    const kIdx=src.indexOf('my*H*');
    if(kIdx<0) throw new Error('ノードのY計算が見つからない');
    const tail=src.slice(kIdx+5), plus=tail.indexOf('+');
    const kY=parseFloat(tail.slice(0,plus)), oY=parseFloat(tail.slice(plus+1));
    if(!(kY>0&&oY>=0)) throw new Error('ノードのY計算を読めない: '+tail.slice(0,20));
    const maxNodeY=0.92*720*kY+oY+41+8;   // ラベル下端
    if(!(maxNodeY < 720-116)) throw new Error('ノードのラベルが情報カードに重なる ('+maxNodeY.toFixed(0)+' vs '+(720-116)+')');
    // 各周回・各進捗で drawMap が例外なく描けること
    setupRoster('inu'); startGame();
    for(const lp of [1,2,3]){ lap=lp;
      const ls=curWorldLevels();
      for(const done of [0, Math.floor(ls.length/2), ls.length]){
        for(const k in levelsDone) delete levelsDone[k];
        for(let i=0;i<done;i++) levelsDone[ls[i].id]=true;
        const nodes=allMapNodes();
        for(let sIdx=0;sIdx<nodes.length;sIdx++){ mapSel=sIdx; drawMap(); } } }
    lap=1; for(const k in levelsDone) delete levelsDone[k]; mapSel=0;
    console.log('ワールドマップ OK (状態表示・推奨難度・情報カード／3周回×3進捗×全ノード選択で例外なし)'); }

  // ===== 技ごとの専用SE と 格闘ゲーム調のエフェクト =====
  { // 1) 専用SEが存在すること
    for(const k of ['tornado','beamCharge','beamFire','thunder','blade','flame','blast'])
      if(typeof sfx[k]!=='function') throw new Error('専用SEが無い: sfx.'+k);
    // 2) それぞれの技に結線されていること（汎用の sfx.big/boss で済ませていない）
    const src=(f)=>f.toString();
    const gsrc=src(updateHazards);
    if(gsrc.indexOf('sfx.tornado')<0) throw new Error('竜巻の持続音が鳴らない');
    if(gsrc.indexOf('sfx.beamFire')<0) throw new Error('ビームの持続音が鳴らない');
    const bsrc=src(runBossMove);
    if(bsrc.indexOf('sfx.beamCharge')<0) throw new Error('ビームの溜め音が鳴らない');
    if(bsrc.indexOf('sfx.thunder')<0) throw new Error('落雷の音が鳴らない');
    if(bsrc.indexOf('sfx.tornado')<0) throw new Error('敵の竜巻に轟音が無い');
    // 3) SEが例外を出さずに鳴ること（無音モードでも経路を通す）
    sndOn=false;
    for(const k of ['tornado','beamCharge','beamFire','thunder','blade','flame','blast']) sfx[k](100);
    // 4) 斬撃の軌跡が多層＋火の粉になっていること
    particles.length=0;
    crescent(400, LANE-50, 90, -0.9, 0.9, '#ffe14d');
    const arcs=particles.filter(p=>p.k==='arc'), embs=particles.filter(p=>p.k==='ember');
    if(arcs.length<3) throw new Error('斬撃の軌跡が多層になっていない（'+arcs.length+'層）');
    if(!arcs.some(p=>p.color==='#ffffff')) throw new Error('白熱した芯の層が無い');
    if(embs.length<4) throw new Error('軌跡に火の粉が散らない（'+embs.length+'個）');
    // 5) 打撃に白い十字フレアが出ること
    particles.length=0; impactBurst(400, LANE-50, '#ffffff', true);
    if(!particles.some(p=>p.k==='flare')) throw new Error('打撃に十字フレアが出ない');
    // 6) 火の粉が更新で動き、寿命で消えること
    particles.length=0; ember(400,LANE-50,3,-4,'#fff');
    const em=particles[0]; const x0=em.x;
    for(let i=0;i<5;i++) updateParticles();
    if(!(Math.abs(em.x-x0)>1)) throw new Error('火の粉が動かない');
    // 7) 必殺技の発動演出：集中線・カメラの寄り・大きなフレア
    particles.length=0; camZoomT=1;
    superFlash(400, LANE-46, '#ffe9a0');
    if(!particles.some(p=>p.k==='speedline')) throw new Error('必殺技に集中線が出ない');
    if(!particles.some(p=>p.k==='flare' && p.R>100)) throw new Error('必殺技に大きなフレアが出ない');
    if(!(camZoomT>1.05)) throw new Error('必殺技でカメラが寄らない (camZoomT='+camZoomT+')');
    // 集中線は生成直後は透明で、数フレーム後に最も濃くなる（立ち上がりが無いと点滅に見える）
    { const sl=particles.find(p=>p.k==='speedline'); let peak=0, peakAt=-1;
      for(let n=0;n<sl.max;n++){ const aa=sl.life/sl.max, la=Math.sin(Math.PI*Math.min(1,(1-aa)*2.2))*0.95;
        if(la>peak){ peak=la; peakAt=n; } updateParticles(); if(sl.life<=0) break; }
      if(!(peak>0.7)) throw new Error('集中線が薄すぎる (peak='+peak.toFixed(2)+')');
      if(!(peakAt>=2)) throw new Error('集中線に立ち上がりが無い (peakAt='+peakAt+')'); }
    camZoomT=1;
    // 8) superFx を持つ技が実際に発動演出を通ること
    { let n=0; for(const k in ATK) if(ATK[k].superFx) n++;
      if(n<20) throw new Error('superFx の技が '+n+' 個しかない');
      const bs=beginAttack.toString();
      if(bs.indexOf('superFlash(')<0) throw new Error('superFx から発動演出が呼ばれていない'); }
    console.log('技のSEとエフェクト OK (専用SE7種／軌跡'+arcs.length+'層＋火の粉'+embs.length+'個／十字フレア／集中線とカメラの寄り)'); }

  // ===== 奥義のモーション：深い溜め・3キーの振り抜き・ばねのキック =====
  { setupRoster('inu'); startGame(); state='play';
    const p=players[0]; player=p; p.hp=p.maxHp=999999; p.level=12; p.dim=9;
    enemies.length=0; encounters.length=0;
    // 1) 溜めを持つ技が9つ以上あること
    let nHold=0; for(const k in ATK) if(ATK[k].hold) nHold++;
    if(nHold<9) throw new Error('溜めを持つ奥義が '+nHold+' 個しかない');
    // 2) 溜め中は a.t が進まず、構えのまま保持されること
    beginAttack('iswords');
    if(!(p.atk && p.atk.hold>0)) throw new Error('溜めフレームが設定されていない');
    const hold0=p.atk.hold;
    for(let i=0;i<hold0;i++){ hitStop=0; slowmo=0; step(1); }
    if(!p.atk) throw new Error('溜め中に技が終わってしまった');
    if(p.atk.t!==0) throw new Error('溜め中に a.t が進んでいる (t='+p.atk.t+')');
    if(!(p.atk.chg>=hold0*0.8 && p.atk.hold===0)) throw new Error('溜めが消化されていない (chg='+p.atk.chg+' hold='+p.atk.hold+' 想定'+hold0+')');
    // 溜めが明けたら進み始める
    hitStop=0; slowmo=0; step(1);
    if(!(p.atk && p.atk.t>=1)) throw new Error('溜けが明けても技が進まない');
    // 3) 発生が「溜め＋act[0]」ぶん遅れること＝技に重みが出ていること
    // 昇竜系は屈み込みから跳ぶので act[0] が2Fと早い。絶対値ではなく
    // 「溜めがどれだけ発生を遅らせているか」で見る
    for(const k of ['soneinch','skuzan','idragon','iswords2']){
      const d=ATK[k]; if(!d) continue;
      const h=d.hold|0, start=h+d.act[0];
      if(!(h>=6)) throw new Error(k+' の溜めが '+h+'F しかない（重みが出ない）');
      if(!(start<=34)) throw new Error(k+' の発生が '+start+'F は遅すぎる（使えない技になる）'); }
    // 4) 振り抜きが単一 easeOut ではなく3キーになっていること
    { // 3キーの振り抜きは、ソース文字列ではなく実際の swAng の軌跡で測る。
  // '1.12' は無関係な sqX にも現れるため、文字列一致では式を消しても通ってしまった
  (function(){
    // 記録は「振り抜きの窓（act）」の中だけに限る。技の終盤には別のポーズ分岐が
    // swAng を動かす技があり、窓の外まで見ると、その戻りを行き過ぎと誤検出する
    const MV='idragon2', def=ATK[MV];
    setupRoster('inu'); startGame(); state='play';
    const p=players[0]; player=p; p.x=camX+400; p.facing=1; p.hp=p.maxHp=99999; p.dim=3; p.level=20;
    enemies.length=0; encounters.length=0; particles.length=0;
    beginAttack(MV);
    const seen=[]; let n=0;
    while(p.state==='attack' && n<220){ n++; hitStop=0; slowmo=0; step(1);
      const a=p.atk; if(!a||!p.poseB) continue;
      if(a.hold>0) continue;
      if(a.t>=def.act[0]-2 && a.t<=def.act[1]+2) seen.push(p.poseB.swAng); }
    if(seen.length<8) throw new Error('3キー: 振り抜きの窓で姿勢が記録できていない '+seen.length);
    const dir=Math.sign(def.to-def.from);            // 振る向き
    const sgn=function(v){ return dir>0? v : -v; };
    let peak=-1e9, peakAt=-1;
    seen.forEach(function(v,k){ if(sgn(v)>peak){ peak=sgn(v); peakAt=k; } });
    const last=sgn(seen[seen.length-1]);
    if(!(peak > last + 0.02)) throw new Error('3キー: 行き過ぎてから押し戻される動きが無い（窓内の最大'+peak.toFixed(3)+' 窓の終わり'+last.toFixed(3)+'）');
    if(peakAt >= seen.length-1) throw new Error('3キー: 最大値が窓の最後＝単調に振り切っているだけ');
    let pre=1e9; seen.slice(0,Math.max(2,Math.round(seen.length*0.25))).forEach(function(v){ pre=Math.min(pre,sgn(v)); });
    if(!(pre < sgn(def.from) + 0.005)) throw new Error('3キー: 振り始めに引く動きが無い（最小'+pre.toFixed(3)+' from'+sgn(def.from).toFixed(3)+'）');
    console.log('3キーの振り抜き OK ('+MV+': 引き'+(sgn(def.from)-pre).toFixed(3)+'rad → 行き過ぎ'+(peak-last).toFixed(3)+'rad → 押し戻し)');
  })(); }
    // 5) 次元斬の紫刃と体ブレが、他の33技へ漏れていないこと
    { const src=drawPlayer.toString();
      if(src.indexOf('p.atk.def.special')>=0 && src.indexOf('dimBlade')<0)
        throw new Error('紫の回転刃が special:true の全技に掛かっている');
      if(!ATK.dimension.dimBlade) throw new Error('次元斬に dimBlade が無い');
      let leak=0; for(const k in ATK) if(ATK[k].dimBlade) leak++;
      if(leak!==1) throw new Error('dimBlade が '+leak+' 技に付いている（次元斬だけのはず）'); }
    p.atk=null; p.state='idle';
    console.log('奥義のモーション OK (溜め'+nHold+'技／溜め中は構えを保持／発生は溜め込みで14〜34F／3キーの振り抜き／紫刃は次元斬のみ)'); }

  // ═══ DC-9 ボスの巨大感 ═══════════════════════════════════════
  // 一周目ラスボスの最終形態は、実測でゲーム中いちばん小さいボスだった
  // （1面ボスのガルムより小さい）。体そのものの高さを測って順序を要求する
  {
    const real=ctx;
    function bodyTop(fn){
      let miny=1e9; const st=[]; let m={a:1,b:0,c:0,d:1,e:0,f:0};
      const mul=function(A,B){ return {a:A.a*B.a+A.c*B.b,b:A.b*B.a+A.d*B.b,c:A.a*B.c+A.c*B.d,
        d:A.b*B.c+A.d*B.d,e:A.a*B.e+A.c*B.f+A.e,f:A.b*B.e+A.d*B.f+A.f}; };
      const put=function(x,y){ if(typeof x!=='number'||typeof y!=='number')return;
        const Y=m.b*x+m.d*y+m.f; if(Y<miny)miny=Y; };
      try { ctx=new Proxy(real,{ get:function(t,k){
          if(k==='getTransform') return function(){ return {a:m.a,b:m.b,c:m.c,d:m.d,e:m.e,f:m.f}; };
          const v=t[k]; if(typeof v!=='function') return v;
          return function(){ const a=Array.prototype.slice.call(arguments);
            if(k==='save') st.push(Object.assign({},m));
            else if(k==='restore'){ if(st.length) m=st.pop(); }
            else if(k==='translate') m=mul(m,{a:1,b:0,c:0,d:1,e:a[0],f:a[1]});
            else if(k==='scale') m=mul(m,{a:a[0],b:0,c:0,d:a[1],e:0,f:0});
            else if(k==='rotate'){ const c=Math.cos(a[0]),s2=Math.sin(a[0]); m=mul(m,{a:c,b:s2,c:-s2,d:c,e:0,f:0}); }
            else if(k==='moveTo'||k==='lineTo') put(a[0],a[1]);
            else if(k==='quadraticCurveTo'){ put(a[0],a[1]); put(a[2],a[3]); }
            else if(k==='arc'){ put(a[0]-a[2],a[1]-a[2]); }
            else if(k==='ellipse'){ put(a[0]-a[2],a[1]-a[3]); }
            else if(k==='fillRect'||k==='strokeRect'||k==='rect'){ put(a[0],a[1]); put(a[0]+a[2],a[1]+a[3]); }
            return v.apply(t,a); }; },
        set:function(t,k,v){ t[k]=v; return true; } });
        fn(); } finally { ctx=real; }
      return miny;
    }
    setupRoster('inu'); startGame(); state='play'; perfTier=1;   // リムのオフスクリーンを外す
    enemies.length=0; encounters.length=0; particles.length=0;
    // プレイヤーを基準にすると、直前のテストで残った姿勢や強化演出で高さが動く。
    // 独立した基準として「1面ボスのガルム」と比べる（そもそもの不具合が
    // 「ラスボスがガルムより小さい」だった）
    const DRAW={garm:drawBigBoss, boss:drawBoss, boss2:drawWolfKing, boss3:drawDarkKnight};
    const HB={};
    Object.keys(DRAW).forEach(function(k){
      enemies.length=0; spawnEnemy(k, camX+400, LANE);
      const e=enemies[0]; e.state='idle'; e.anim=0; e.hp=e.maxHp=99999;
      HB[k]=(-bodyTop(function(){ DRAW[k](e); }))*(ETYPE[k].gsc||1); });
    perfTier=0;
    Object.keys(HB).forEach(function(k){ if(!(HB[k]>40)) throw new Error(k+' の高さが測れていない: '+HB[k].toFixed(1)); });
    if(!(HB.boss3>HB.garm)) throw new Error('一周目ラスボスが1面ボスより小さい: '
      +HB.boss3.toFixed(0)+' vs ガルム '+HB.garm.toFixed(0));
    if(!(HB.boss3>HB.boss2)) throw new Error('最終形態が第二形態より小さい: '
      +HB.boss3.toFixed(0)+' vs 異形狼 '+HB.boss2.toFixed(0));
    if(!(HB.boss3>=HB.garm*1.35)) throw new Error('ラスボスの巨大感が足りない: ガルムの '
      +(HB.boss3/HB.garm).toFixed(2)+'倍しかない');
    // 見た目だけ大きくして当たりが元のままだと、剣が素通りする
    if(!(ETYPE.boss3.w>=100 && ETYPE.boss3.h>=180 && ETYPE.boss3.atkR>=140))
      throw new Error('体格に対して当たり判定が小さいまま: w'+ETYPE.boss3.w+' h'+ETYPE.boss3.h+' atkR'+ETYPE.boss3.atkR);
    // 描画の入口（drawEnemy）が gsc を本当に掛けていること。
    // 体の描画関数を直接呼ぶだけでは「実装はあるが反映されていない」を見逃す。
    // 同じ LANE に置けば depthScale は共通なので、倍率の比がそのまま gsc の比になる
    { const real=ctx;
      const scaleOf=function(k){ let first=null;
        enemies.length=0; spawnEnemy(k, camX+400, LANE);
        const e=enemies[0]; e.state='idle'; e.anim=0; e.hp=e.maxHp=99999;
        try { ctx=new Proxy(real,{ get:function(t,key){
                if(key==='getTransform') return function(){ return {a:1,b:0,c:0,d:1,e:0,f:0}; };
                const v=t[key]; if(typeof v!=='function') return v;
                return function(){ if(key==='scale'&&first===null) first=Math.abs(arguments[1]);
                  return v.apply(t,arguments); }; },
              set:function(t,key,v){ t[key]=v; return true; } });
              drawEnemy(e); } finally { ctx=real; }
        return first; };
      const sB=scaleOf('boss3'), sG=scaleOf('garm');
      if(!sB||!sG) throw new Error('描画の倍率を取れなかった');
      if(!(sB/sG>=1.5)) throw new Error('drawEnemy が体格の倍率を掛けていない: '
        +sB.toFixed(2)+' vs ガルム '+sG.toFixed(2)); }
    console.log('ラスボスの巨大感 OK (体の高さ ガルム'+HB.garm.toFixed(0)+' / 大帝'+HB.boss.toFixed(0)
      +' / 異形狼'+HB.boss2.toFixed(0)+' / 暗黒剣士'+HB.boss3.toFixed(0)+' ＝ガルムの'
      +(HB.boss3/HB.garm).toFixed(2)+'倍)');
  }

  // ═══ DC-9 奥義の残響 ═══════════════════════════════════════
  // 炸裂の次のフレームには何も残らず、大技なのに余韻が無かった
  {
    setupRoster('inu'); startGame(); state='play'; perfTier=0;
    const p=players[0]; player=p; p.x=camX+400;
    particles.length=0; echoT=0;
    const before=particles.length;
    superFlash(p.x,p.y-46,'#ffe9a0');
    if(!(echoT>=40)) throw new Error('残響が始まっていない: echoT='+echoT);
    // 遅れて出る層があること（同時に全部出すと「炸裂」で終わって余韻にならない）
    const late=particles.slice(before).filter(function(q){ return (q.delay|0)>=30; });
    if(late.length<3) throw new Error('遅延して立ち上がる層が足りない: '+late.length+'個');
    // 輪が遅延なしで出ると「炸裂と同時」になり、余韻として働かない
    const rings=particles.slice(before).filter(function(q){ return q.k==='ring'; });
    if(rings.length<2) throw new Error('残響の輪が足りない: '+rings.length+'本');
    rings.forEach(function(q){ if((q.delay|0)<10) throw new Error('残響の輪が遅延していない: delay='+(q.delay|0)); });
    const maxDelay=Math.max.apply(null, particles.slice(before).map(function(q){ return q.delay|0; }));
    if(!(maxDelay>=40)) throw new Error('残響が短すぎる: 最大遅延 '+maxDelay+'F');
    // 長寿命の火の粉が残ること
    const slow=particles.slice(before).filter(function(q){ return q.k==='ember' && q.max>=40; });
    if(slow.length<5) throw new Error('ゆっくり消える火の粉が足りない: '+slow.length+'個');
    // 画面の余韻が減衰して消えること
    const e0=echoT; for(let i=0;i<30;i++) updateEcho();
    if(!(echoT<e0 && echoT>0)) throw new Error('残響の減衰がおかしい: '+e0+' → '+echoT);
    for(let i=0;i<40;i++) updateEcho();
    if(echoT!==0) throw new Error('残響が消えない: '+echoT);
    // 低品質では残響の後処理を出さない
    { const real=ctx; let n=0;
      const cnt=function(){ n=0;
        try { ctx=new Proxy(real,{ get:function(t,k){ const v=t[k];
                if(typeof v==='function') return function(){ n++; return v.apply(t,arguments); };
                return v; }, set:function(t,k,v){ t[k]=v; return true; } });
              drawEcho(); } finally { ctx=real; }
        return n; };
      echoT=echoMax=60; perfTier=0; const a=cnt();
      echoT=echoMax=60; perfTier=2; const b=cnt();
      perfTier=0; echoT=0;
      if(!(a>0)) throw new Error('tier0 で残響が描かれない');
      if(b!==0) throw new Error('tier2 でも残響を描いている: '+b+'コール'); }
    console.log('奥義の残響 OK (echoT '+e0+'F / 遅延層'+late.length+'個・最大'+maxDelay+'F / 長寿命の火の粉'+slow.length+'個)');
  }

  console.log('STEAM POLISH TEST PASSED'); process.exit(0);
})().catch(e=>{ console.error('FAIL:', e.message, e.stack); process.exit(1); });
`;
code = code + "\n;" + DRIVER;
(0, eval)(code);

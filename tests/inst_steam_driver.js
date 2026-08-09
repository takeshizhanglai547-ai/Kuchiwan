const DRIVER = `
global._GC={}; var _g=(n,v)=>{ _GC[n]=(_GC[n]||0)+1; return v; };
process.on("exit",()=>{ const miss=[]; for(let i=1;i<=71;i++) if(!_GC[i]) miss.push(i); console.error("GUARDS total=71 evaluated="+((71)-miss.length)+" NEVER_EVALUATED=["+miss.join(",")+"]"); });

(async()=>{
  const step=(n)=>{ for(let i=0;i<n;i++){ if(global.rafCb){ const cb=global.rafCb; global.rafCb=null; cb(); } } };
  sndOn=false;

  // ===== 1) アトラクトモード（デモ画面）=====
  if(_g(1,typeof startAttract!=='function'||typeof endAttract!=='function')) throw new Error('attract mode missing');
  if(_g(2,ATTRACT_CARDS.length<4)) throw new Error('too few attract cards');
  ATTRACT_CARDS.forEach((c,i)=>{ if(_g(3,!c.title||!c.sub||!c.col)) throw new Error('attract card '+i+' incomplete'); });
  state='title'; attractOn=false; titleIdle=0;
  startAttract();
  if(_g(4,!attractOn)) throw new Error('startAttract did not engage');
  if(_g(5,state!=='attract')) throw new Error('attract should open on a feature card, got '+state);
  const seqKinds=attract.seq.map(x=>x.k).join(',');
  if(_g(6,!/card,demo/.test(seqKinds))) throw new Error('attract sequence should alternate cards and demos: '+seqKinds);
  console.log('アトラクト 開始 OK (放置 '+ATTRACT_IDLE+'F で起動／構成 '+seqKinds+')');
  // カードが尺で進み、デモへ入る
  for(let i=0;i<ATTRACT_CARD_LEN+2 && state==='attract';i++) updateAttract();
  if(_g(7,state!=='play')) throw new Error('card did not advance into the demo (state='+state+')');
  if(_g(8,!enemies.length)) throw new Error('demo spawned no enemies');
  const dp=players[0];
  if(_g(9,(dp.level||1)<7)) throw new Error('demo hero should be levelled so evolved moves show');
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
    if(_g(10,attacked<4)) throw new Error('demo AI barely attacked ('+attacked+' moves in 900F)');
    if(_g(11,specials<1)) throw new Error('demo AI never showed a special move');
    if(_g(12,dealt<=0)) throw new Error('demo AI never connected');
    console.log('デモAI OK (900F中 '+attacked+'回の技／うち必殺技 '+specials+'回／与ダメ '+Math.round(dealt)+')'); }
  // デモはプレイヤーのセーブを汚さない
  { let wrote=false; const real=global.localStorage.setItem;
    global.localStorage.setItem=function(){ wrote=true; };
    saveProgress(3);
    global.localStorage.setItem=real;
    if(_g(13,wrote)) throw new Error('demo overwrote the player save'); }
  // デモ中は死んでゲームオーバーにならない
  { dp.hp=1; dp.lives=0; loseLife(dp);
    if(_g(14,dp.hp<=0||dp.state==='dead')) throw new Error('demo ended on a death'); }
  console.log('デモ 安全性 OK (セーブ非破壊／ゲームオーバーしない)');
  // 入力で即タイトルへ戻る
  endAttract();
  if(_g(15,attractOn||state!=='title')) throw new Error('endAttract did not return to the title');
  if(_g(16,enemies.length)) throw new Error('demo enemies were left behind');
  console.log('デモ 復帰 OK (任意入力でタイトルへ／後始末も完了)');

  // ===== 2) オープニングのシネマ演出 =====
  setupRoster('inu'); startOpening();
  if(_g(17,state!=='cut')) throw new Error('opening did not start a cutscene');
  const chapters=cut.scenes.filter(s2=>s2.chapter);
  if(_g(18,chapters.length<2)) throw new Error('opening has no chapter cards');
  if(_g(19,!chapters[0].chapterSub)) throw new Error('chapter card lacks a subtitle');
  console.log('章タイトル OK ('+chapters.map(c=>c.chapter+'「'+c.chapterSub+'」').join(' / ')+')');
  // 章カードは読み進めるものではなく、尺で自動的に流れる
  { cut.i=0; cut.t=0; let guard=0;
    while(cut && cut.i===0 && guard++<CHAPTER_LEN+10) updateCut();
    if(_g(20,!cut||cut.i!==1)) throw new Error('chapter card did not auto-advance'); }
  // 本文はタイプ送り、送るとシーンが進み暗転が入る
  { cut.i=1; cut.t=0; cut.fade=0;
    const len=(cut.scenes[1].text||'').length;
    for(let f=0;f<len*1.3+2;f++) updateCut();
    cutAdvance=true; updateCut();
    if(_g(21,cut.i!==2)) throw new Error('text scene did not advance on input');
    if(_g(22,!(cut.fade>0))) throw new Error('no fade between scenes'); }
  console.log('シネマ演出 OK (章カードは自動送り／本文は入力送り＋暗転)');
  // スキップは常に効く
  { setupRoster('nuko'); startOpening(); cutSkip=true; updateCut();
    if(_g(23,cut)) throw new Error('skip did not close the opening'); }
  console.log('スキップ OK (どの場面からでもオープニングを飛ばせる)');
  // 全キャラのオープニングに章カードが入っている
  ['inu','shima','nuko','guard8','watch','wanden'].forEach(k=>{
    setupRoster(k); const sc=storyOpenFor();
    if(_g(24,!sc.some(x=>x.chapter))) throw new Error(k+' opening has no chapter card');
    if(_g(25,!sc.some(x=>x.text))) throw new Error(k+' opening has no story text'); });
  console.log('全キャラ OK (6人ぶんのオープニングすべてに章カードと本文)');

  // ===== 3) 道中イベントの提示カード =====
  cut=null; state='play'; setupRoster('inu'); startGame(); state='play';
  if(_g(26,typeof showEventCard!=='function')) throw new Error('event card system missing');
  ['duel','ambush','chest','cursed','spring','altar','shrine','portal','merchant','branch'].forEach(k=>{
    if(_g(27,!EVENT_KIND[k])) throw new Error('event kind missing: '+k);
    if(_g(28,!EVENT_KIND[k].label||!EVENT_KIND[k].col||!EVENT_KIND[k].icon)) throw new Error('event kind '+k+' incomplete'); });
  eventCard=null; showEventCard('chest','宝箱を見つけた','中身は開けてのお楽しみ');
  if(_g(29,!eventCard||eventCard.label!=='宝箱')) throw new Error('event card did not appear');
  for(let f=0;f<EVENT_CARD_LEN+2;f++) updateEventCard();
  if(_g(30,eventCard)) throw new Error('event card never expired');
  console.log('イベントカード OK ('+Object.keys(EVENT_KIND).length+'種／'+EVENT_CARD_LEN+'F で自動的に消える)');
  // 腕試し・待ち伏せが実際にカードを出す
  enemies.length=0; eventCard=null;
  triggerHeroDuel({x:players[0].x+40});
  if(_g(31,!eventCard||eventCard.kind!=='duel')) throw new Error('duel did not raise its event card');
  if(_g(32,!enemies.length)) throw new Error('duel spawned no rival');
  enemies.length=0; eventCard=null;
  triggerAmbush({x:players[0].x});
  if(_g(33,!eventCard||eventCard.kind!=='ambush')) throw new Error('ambush did not raise its event card');
  if(_g(34,enemies.length<3)) throw new Error('ambush spawned too few foes');
  console.log('イベント連動 OK (腕試し＝好敵手が出現／待ち伏せ＝囲まれる、それぞれ専用カード)');
  // 同じNPCで二度出さない
  { const n={kind:'spring', x:players[0].x, face:1, lines:['泉が湧いている。']}; eventCard=null;
    startTalk(n, players[0]); if(_g(35,!eventCard)) throw new Error('NPC did not raise a card');
    dialog=null; state='play'; eventCard=null;
    startTalk(n, players[0]); if(_g(36,eventCard)) throw new Error('NPC card repeated on a second talk');
    dialog=null; state='play'; }
  console.log('重複防止 OK (同じNPCでカードは一度だけ)');
  // デモ中はイベントカードを出さない
  { attractOn=true; eventCard=null; showEventCard('chest','x','y'); attractOn=false;
    if(_g(37,eventCard)) throw new Error('event card shown during the attract demo'); }
  console.log('デモ中の抑制 OK (アトラクト中はイベントカードを出さない)');

  // ===== ワールドマップ：状態が読み分けられ、選ぶ材料が出ていること =====
  { const src=drawMap.toString();
    for(const [k,msg] of [['tierOf','推奨難度★'],['nextId','次の推奨先'],['bossOf','ボスの有無'],['報酬コイン','想定報酬'],['roundRect','ラベルの下敷き']])
      if(_g(38,src.indexOf(k)<0)) throw new Error('ワールドマップに '+msg+' が無い');
    // 情報カード（H-116）とノードのラベルが重ならない高さに収まっていること
    const kIdx=src.indexOf('my*H*');
    if(_g(39,kIdx<0)) throw new Error('ノードのY計算が見つからない');
    const tail=src.slice(kIdx+5), plus=tail.indexOf('+');
    const kY=parseFloat(tail.slice(0,plus)), oY=parseFloat(tail.slice(plus+1));
    if(_g(40,!(kY>0&&oY>=0))) throw new Error('ノードのY計算を読めない: '+tail.slice(0,20));
    const maxNodeY=0.92*720*kY+oY+41+8;   // ラベル下端
    if(_g(41,!(maxNodeY < 720-116))) throw new Error('ノードのラベルが情報カードに重なる ('+maxNodeY.toFixed(0)+' vs '+(720-116)+')');
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
      if(_g(42,typeof sfx[k]!=='function')) throw new Error('専用SEが無い: sfx.'+k);
    // 2) それぞれの技に結線されていること（汎用の sfx.big/boss で済ませていない）
    const src=(f)=>f.toString();
    const gsrc=src(updateHazards);
    if(_g(43,gsrc.indexOf('sfx.tornado')<0)) throw new Error('竜巻の持続音が鳴らない');
    if(_g(44,gsrc.indexOf('sfx.beamFire')<0)) throw new Error('ビームの持続音が鳴らない');
    const bsrc=src(runBossMove);
    if(_g(45,bsrc.indexOf('sfx.beamCharge')<0)) throw new Error('ビームの溜め音が鳴らない');
    if(_g(46,bsrc.indexOf('sfx.thunder')<0)) throw new Error('落雷の音が鳴らない');
    if(_g(47,bsrc.indexOf('sfx.tornado')<0)) throw new Error('敵の竜巻に轟音が無い');
    // 3) SEが例外を出さずに鳴ること（無音モードでも経路を通す）
    sndOn=false;
    for(const k of ['tornado','beamCharge','beamFire','thunder','blade','flame','blast']) sfx[k](100);
    // 4) 斬撃の軌跡が多層＋火の粉になっていること
    particles.length=0;
    crescent(400, LANE-50, 90, -0.9, 0.9, '#ffe14d');
    const arcs=particles.filter(p=>p.k==='arc'), embs=particles.filter(p=>p.k==='ember');
    if(_g(48,arcs.length<3)) throw new Error('斬撃の軌跡が多層になっていない（'+arcs.length+'層）');
    if(_g(49,!arcs.some(p=>p.color==='#ffffff'))) throw new Error('白熱した芯の層が無い');
    if(_g(50,embs.length<4)) throw new Error('軌跡に火の粉が散らない（'+embs.length+'個）');
    // 5) 打撃に白い十字フレアが出ること
    particles.length=0; impactBurst(400, LANE-50, '#ffffff', true);
    if(_g(51,!particles.some(p=>p.k==='flare'))) throw new Error('打撃に十字フレアが出ない');
    // 6) 火の粉が更新で動き、寿命で消えること
    particles.length=0; ember(400,LANE-50,3,-4,'#fff');
    const em=particles[0]; const x0=em.x;
    for(let i=0;i<5;i++) updateParticles();
    if(_g(52,!(Math.abs(em.x-x0)>1))) throw new Error('火の粉が動かない');
    // 7) 必殺技の発動演出：集中線・カメラの寄り・大きなフレア
    particles.length=0; camZoomT=1;
    superFlash(400, LANE-46, '#ffe9a0');
    if(_g(53,!particles.some(p=>p.k==='speedline'))) throw new Error('必殺技に集中線が出ない');
    if(_g(54,!particles.some(p=>p.k==='flare' && p.R>100))) throw new Error('必殺技に大きなフレアが出ない');
    if(_g(55,!(camZoomT>1.05))) throw new Error('必殺技でカメラが寄らない (camZoomT='+camZoomT+')');
    // 集中線は生成直後は透明で、数フレーム後に最も濃くなる（立ち上がりが無いと点滅に見える）
    { const sl=particles.find(p=>p.k==='speedline'); let peak=0, peakAt=-1;
      for(let n=0;n<sl.max;n++){ const aa=sl.life/sl.max, la=Math.sin(Math.PI*Math.min(1,(1-aa)*2.2))*0.95;
        if(la>peak){ peak=la; peakAt=n; } updateParticles(); if(sl.life<=0) break; }
      if(_g(56,!(peak>0.7))) throw new Error('集中線が薄すぎる (peak='+peak.toFixed(2)+')');
      if(_g(57,!(peakAt>=2))) throw new Error('集中線に立ち上がりが無い (peakAt='+peakAt+')'); }
    camZoomT=1;
    // 8) superFx を持つ技が実際に発動演出を通ること
    { let n=0; for(const k in ATK) if(ATK[k].superFx) n++;
      if(_g(58,n<20)) throw new Error('superFx の技が '+n+' 個しかない');
      const bs=beginAttack.toString();
      if(_g(59,bs.indexOf('superFlash(')<0)) throw new Error('superFx から発動演出が呼ばれていない'); }
    console.log('技のSEとエフェクト OK (専用SE7種／軌跡'+arcs.length+'層＋火の粉'+embs.length+'個／十字フレア／集中線とカメラの寄り)'); }

  // ===== 奥義のモーション：深い溜め・3キーの振り抜き・ばねのキック =====
  { setupRoster('inu'); startGame(); state='play';
    const p=players[0]; player=p; p.hp=p.maxHp=999999; p.level=12; p.dim=9;
    enemies.length=0; encounters.length=0;
    // 1) 溜めを持つ技が9つ以上あること
    let nHold=0; for(const k in ATK) if(ATK[k].hold) nHold++;
    if(_g(60,nHold<9)) throw new Error('溜めを持つ奥義が '+nHold+' 個しかない');
    // 2) 溜め中は a.t が進まず、構えのまま保持されること
    beginAttack('iswords');
    if(_g(61,!(p.atk && p.atk.hold>0))) throw new Error('溜めフレームが設定されていない');
    const hold0=p.atk.hold;
    for(let i=0;i<hold0;i++){ hitStop=0; slowmo=0; step(1); }
    if(_g(62,!p.atk)) throw new Error('溜め中に技が終わってしまった');
    if(_g(63,p.atk.t!==0)) throw new Error('溜め中に a.t が進んでいる (t='+p.atk.t+')');
    if(_g(64,!(p.atk.chg>=hold0*0.8 && p.atk.hold===0))) throw new Error('溜めが消化されていない (chg='+p.atk.chg+' hold='+p.atk.hold+' 想定'+hold0+')');
    // 溜めが明けたら進み始める
    hitStop=0; slowmo=0; step(1);
    if(_g(65,!(p.atk && p.atk.t>=1))) throw new Error('溜けが明けても技が進まない');
    // 3) 発生が「溜め＋act[0]」ぶん遅れること＝技に重みが出ていること
    // 昇竜系は屈み込みから跳ぶので act[0] が2Fと早い。絶対値ではなく
    // 「溜めがどれだけ発生を遅らせているか」で見る
    for(const k of ['soneinch','skuzan','idragon','iswords2']){
      const d=ATK[k]; if(!d) continue;
      const h=d.hold|0, start=h+d.act[0];
      if(_g(66,!(h>=6))) throw new Error(k+' の溜めが '+h+'F しかない（重みが出ない）');
      if(_g(67,!(start<=34))) throw new Error(k+' の発生が '+start+'F は遅すぎる（使えない技になる）'); }
    // 4) 振り抜きが単一 easeOut ではなく3キーになっていること
    { const src=drawPlayer.toString();
      if(_g(68,src.indexOf('1.12')<0 || src.indexOf('def.superFx||def.finisher||def.rise')<0))
        throw new Error('振り抜きが3キー化されていない（行き過ぎて戻る動きが無い）'); }
    // 5) 次元斬の紫刃と体ブレが、他の33技へ漏れていないこと
    { const src=drawPlayer.toString();
      if(_g(69,src.indexOf('p.atk.def.special')>=0 && src.indexOf('dimBlade')<0))
        throw new Error('紫の回転刃が special:true の全技に掛かっている');
      if(_g(70,!ATK.dimension.dimBlade)) throw new Error('次元斬に dimBlade が無い');
      let leak=0; for(const k in ATK) if(ATK[k].dimBlade) leak++;
      if(_g(71,leak!==1)) throw new Error('dimBlade が '+leak+' 技に付いている（次元斬だけのはず）'); }
    p.atk=null; p.state='idle';
    console.log('奥義のモーション OK (溜め'+nHold+'技／溜め中は構えを保持／発生は溜め込みで14〜34F／3キーの振り抜き／紫刃は次元斬のみ)'); }

  console.log('STEAM POLISH TEST PASSED'); process.exit(0);
})().catch(e=>{ console.error('FAIL:', e.message, e.stack); process.exit(1); });
`;
code = code + "\n;" + DRIVER;
(0, eval)(code);

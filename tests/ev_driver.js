global.__HTML = html;
const DRIVER = `
(async()=>{
  // 周回が増えるたびに書き換えるのを避け、全周回のノードをまとめて見る。
  // 一周目だけを見ていたので、六周目のイベントを足した途端に「そんなステージは無い」で落ちた
  const ALLNODES=WORLD_LEVELS.concat(WORLD_FINAL, WORLD2_LEVELS, WORLD2_FINAL,
    WORLD3_LEVELS, WORLD3_FINAL, WORLD4_LEVELS, WORLD4_FINAL,
    WORLD5_LEVELS, WORLD5_FINAL, WORLD6_LEVELS, WORLD6_FINAL);
  const nodeOf=function(id){ return ALLNODES.find(function(n){ return n.id===id; }); };

  // ===== 1) イベント表そのものの整合 =====
  { if(STAGE_EVENTS.length<5) throw new Error('ステージ間イベントが '+STAGE_EVENTS.length+' 件しかない');
    const ids={}; ALLNODES.forEach(function(n){ ids[n.id]=1; });
    const keys={}, ats={};
    STAGE_EVENTS.forEach(function(E){
      if(!ids[E.from]) throw new Error(E.key+' の入手先 '+E.from+' というステージが無い');
      if(!ids[E.at]) throw new Error(E.key+' の使用先 '+E.at+' というステージが無い');
      if(E.from===E.at) throw new Error(E.key+' が同じステージで入手して使う（ステージ間になっていない）');
      if(!KEYITEMS[E.key]) throw new Error(E.key+' のキーアイテムが KEYITEMS に無い');
      if(keys[E.key]) throw new Error('キーアイテム '+E.key+' が二重に使われている'); keys[E.key]=1;
      if(ats[E.at]) throw new Error('同じステージ '+E.at+' に二つのイベントがある'); ats[E.at]=1;
      if(E.kind==='boss'){ if(!ETYPE[E.boss]) throw new Error(E.key+' の隠しボス '+E.boss+' が居ない');
        if(!ETYPE[E.boss].boss) throw new Error(E.boss+' がボス扱いになっていない');
        // 名乗りが無いと、既存ボスの使い回しだと丸わかりになる
        const q=bossQuoteFor(E.boss);
        if(!q || q===BOSSQUOTE[ETYPE[E.boss].bossKind]) throw new Error(E.boss+' に専用の名乗りが無い'); }
      else if(E.kind==='gift'){ const C=CHARMS[E.give];
        if(!C) throw new Error(E.key+' の褒美 '+E.give+' が CHARMS に無い');
        if(C.who!=='*') throw new Error(E.give+' が特定キャラ専用（イベントの褒美は誰でも取れるべき）'); }
      else throw new Error(E.key+' の種類が '+E.kind); });
    const nb=STAGE_EVENTS.filter(function(E){ return E.kind==='boss'; }).length;
    const ng=STAGE_EVENTS.filter(function(E){ return E.kind==='gift'; }).length;
    if(nb<2||ng<1) throw new Error('隠しボス '+nb+' 件／褒美 '+ng+' 件（両方無いと「専用アイテムか隠しボス」にならない）');
    console.log('イベント表 OK ('+STAGE_EVENTS.length+'件：隠しボス'+nb+'／専用アイテム'+ng+')'); }

  // ===== 2) 鍵を持っていなければ何も起きない =====
  { setupRoster('inu'); startGame();
    const E=STAGE_EVENTS.find(function(q){ return q.kind==='boss'; });
    keyHeld={}; eventDone={};
    loadLevel(nodeOf(E.at));
    if(encounters.some(function(c){ return c.evKey; })) throw new Error('鍵を持たずに入ったのに隠しボスが居る');
    if(items.some(function(it){ return CHARMS[it.kind]; })) throw new Error('鍵を持たずに入ったのに褒美が落ちている');
    console.log('鍵なし OK (隠しボスも褒美も出ない)'); }

  // ===== 3) 鍵を持って入ると、最後のボスの手前に隠しボスが割り込む =====
  { setupRoster('inu'); startGame();
    const E=STAGE_EVENTS.find(function(q){ return q.kind==='boss'; });
    keyHeld={}; eventDone={}; keyHeld[E.key]=true;
    loadLevel(nodeOf(E.at));
    const hi=encounters.findIndex(function(c){ return c.evKey===E.key; });
    if(hi<0) throw new Error('鍵を持って入ったのに隠しボスが出ない');
    const bi=encounters.findIndex(function(c){ return c.boss; });
    if(!(bi>hi)) throw new Error('隠しボスが最後のボスより後ろにある（戦う前にステージが終わる）');
    if(!encounters[hi].list.some(function(q){ return q[0]===E.boss; })) throw new Error('隠しボスの型がちがう');
    // 出現位置は順番どおりに増えていないと、encIndex 方式では飛ばされる
    for(let i=1;i<encounters.length;i++){
      if(!(encounters[i].at>encounters[i-1].at)) throw new Error('出現位置が '+i+' 番目で逆転している（'+encounters[i-1].at+' → '+encounters[i].at+'）'); }
    console.log('割り込み OK ('+ETYPE[E.boss].name+' が '+hi+'番目・ボスは '+bi+'番目)'); }

  // ===== 4) 隠しボスを倒すと鍵を使い切り、二度目は出ない =====
  { setupRoster('inu'); startGame(); state='play';
    const E=STAGE_EVENTS.find(function(q){ return q.kind==='boss'; });
    keyHeld={}; eventDone={}; keyHeld[E.key]=true;
    loadLevel(nodeOf(E.at));
    const hi=encounters.findIndex(function(c){ return c.evKey===E.key; });
    encIndex=hi; const enc=encounters[hi];
    enc.spawned=true; enemies.length=0; projectiles.length=0;
    const dim0=players[0].dim=0; players[0].dimMax=9;
    const hp0=players[0].hp=10; players[0].maxHp=999;
    updateEncounters();
    if(!enc.cleared) throw new Error('倒しても隠しボス戦が終わらない');
    if(keyHeld[E.key]) throw new Error('倒しても鍵が減らない');
    if(!eventDone[E.key]) throw new Error('倒してもイベントが済みにならない');
    if(!(players[0].hp>hp0)) throw new Error('隠しボス撃破の褒美（回復）が無い');
    if(!(players[0].dim>dim0)) throw new Error('隠しボス撃破の褒美（奥義ストック）が無い');
    if(!items.length) throw new Error('隠しボス撃破でアイテムが落ちない');
    // 二度目に入っても出ない
    loadLevel(nodeOf(E.at));
    if(encounters.some(function(c){ return c.evKey===E.key; })) throw new Error('済んだはずのイベントがまた起きる');
    console.log('撃破と消費 OK (回復・奥義ストック・ドロップつき／再訪では出ない)'); }

  // ===== 5) 褒美のイベントは入口に置かれ、どのキャラでも拾える =====
  { const E=STAGE_EVENTS.find(function(q){ return q.kind==='gift'; });
    ['inu','shima','nuko','guard8','watch','wanden','mack'].forEach(function(kind){
      setupRoster('inu'); startGame(); state='play';
      const p=players[0]; p.kind=kind;
      keyHeld={}; eventDone={}; keyHeld[E.key]=true;
      loadLevel(nodeOf(E.at));
      const it=items.find(function(q){ return q.kind===E.give; });
      if(!it) throw new Error(E.give+' が置かれていない');
      if(!canPick(p, E.give)) throw new Error(kind+' が '+E.give+' を拾えない');
      if(keyHeld[E.key]) throw new Error('褒美を出したのに鍵が残っている');
      if(!eventDone[E.key]) throw new Error('褒美を出したのにイベントが済みにならない');
      // 実際に拾って効果が乗るか
      const hp0=p.maxHp, dm0=p.dimMax;
      p.x=it.x; p.z=0; it.z=0; p.state='idle';
      for(let f=0;f<10 && items.indexOf(it)>=0;f++) updateItems();
      if(items.indexOf(it)>=0) throw new Error(kind+' が近づいても拾えない');
      if(!(p.maxHp>hp0 || p.dimMax>dm0)) throw new Error(kind+' が拾っても何も変わらない'); });
    console.log('専用アイテム OK (7キャラ全員が拾えて効果が乗る)'); }

  // ===== 6) ライバル撃破とステージ制覇で鍵が手に入る =====
  { const RV=STAGE_EVENTS.find(function(q){ return q.on==='rival'; });
    if(!RV) throw new Error('ライバル撃破で手に入る鍵が無い');
    setupRoster('inu'); startGame(); state='play';
    keyHeld={}; eventDone={};
    loadLevel(nodeOf(RV.from));
    const ri=encounters.findIndex(function(c){ return c.rival; });
    if(ri<0) throw new Error(RV.from+' にライバル戦が無い');
    encIndex=ri; const enc=encounters[ri]; enc.spawned=true; enemies.length=0; projectiles.length=0;
    updateEncounters();
    if(!keyHeld[RV.key]) throw new Error('ライバルを倒しても '+KEYITEMS[RV.key].name+' が手に入らない');
    // 制覇でもらう鍵：ボス戦を終わらせる
    const CL=STAGE_EVENTS.find(function(q){ return q.on==='clear'; });
    setupRoster('inu'); startGame(); state='play';
    keyHeld={}; eventDone={};
    loadLevel(nodeOf(CL.from));
    const bi=encounters.findIndex(function(c){ return c.boss; });
    if(bi<0) throw new Error(CL.from+' にボス戦が無い');
    encIndex=bi; const be=encounters[bi]; be.spawned=true; enemies.length=0; projectiles.length=0;
    updateEncounters();
    if(!levelsDone[CL.from]) throw new Error(CL.from+' が制覇済みにならない');
    if(!keyHeld[CL.key]) throw new Error('制覇しても '+KEYITEMS[CL.key].name+' が手に入らない');
    console.log('入手 OK (ライバル撃破＝'+KEYITEMS[RV.key].name+'／制覇＝'+KEYITEMS[CL.key].name+')'); }

  // ===== 7) 鍵と済みイベントはセーブに乗る =====
  { const H=global.__HTML||'';
    if(H.indexOf('keys:keyHeld')<0) throw new Error('鍵がセーブに書かれていない');
    if(H.indexOf('evdone:eventDone')<0) throw new Error('済んだイベントがセーブに書かれていない');
    // ハーネスの localStorage は読み出しが常に null なので、この項目のあいだだけ本物を置く
    const _ls=global.localStorage, _mem={};
    global.localStorage={ getItem:function(k){ return _mem[k]!=null?_mem[k]:null; },
      setItem:function(k,v){ _mem[k]=String(v); }, removeItem:function(k){ delete _mem[k]; } };
    setupRoster('inu'); startGame();
    keyHeld={gear:true}; eventDone={moonkey:true};
    saveProgress(1);
    if(!_mem['kuchiwan_save']) throw new Error('セーブが書き出されていない（測れていない）');
    keyHeld={}; eventDone={};
    startGameAt(2);
    if(!keyHeld.gear) throw new Error('再開すると鍵が消える');
    if(!eventDone.moonkey) throw new Error('再開すると済んだイベントが戻る');
    // 新規開始では消える
    startGame();
    if(Object.keys(keyHeld).some(function(k){ return keyHeld[k]; })) throw new Error('新規開始でも鍵が残っている');
    global.localStorage=_ls;
    console.log('セーブ OK (鍵と済みイベントが再開で戻り、新規では消える)'); }

  console.log('EVENT TEST PASSED'); process.exit(0);
})().catch(e=>{ console.error('FAIL:', e.message, e.stack); process.exit(1); });
`;
code = code + "\n;" + DRIVER;
(0, eval)(code);

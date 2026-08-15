const DRIVER = `
(async()=>{
  const step=(n)=>{ for(let i=0;i<n;i++){ if(global.rafCb){ const cb=global.rafCb; global.rafCb=null; cb(); } } };
  sndOn=false;

  // =====================================================================
  //  1) 三周目クリア後に四周目へ行けること
  // =====================================================================
  // クリア画面の「次の周回」ボタンは lap>=3 で隠されており、四周目「神話」は
  // タイトルのトグルから直接始めるしか手が無かった。
  // DOM を読まずに検証できるよう、判断は nextLap(l) に出してある
  { if(typeof nextLap!=='function') throw new Error('nextLap が無い');
    const n1=nextLap(1), n2=nextLap(2), n3=nextLap(3), n4=nextLap(4), n5=nextLap(5);
    if(!n1||n1.lap!==2) throw new Error('一周目クリア後に二周目へ行けない');
    if(!n2||n2.lap!==3) throw new Error('二周目クリア後に三周目へ行けない');
    if(!n3||n3.lap!==4) throw new Error('三周目クリア後に四周目へ行けない');
    if(!n4||n4.lap!==5) throw new Error('四周目クリア後に五周目へ行けない');
    if(n5) throw new Error('五周目の先があることになっている: '+JSON.stringify(n5.lap));
    // ラベルは周回ごとに別物であること（全部同じだと押しても行き先が分からない）
    const labs=[n1.label,n2.label,n3.label,n4.label];
    if(new Set(labs).size!==4) throw new Error('次の周回のラベルが重複している: '+labs.join(' / '));
    if(n3.label.indexOf('4周目')<0) throw new Error('三周目の次のラベルが四周目を指していない: '+n3.label);
    // go が実際にその周回を始めること
    setupRoster('inu'); startGame(); state='play';
    n3.go();
    if(lap!==4) throw new Error('三周目の次を選んでも lap が4にならない: '+lap);
    if(!encounters.length) throw new Error('四周目のエンカウンタが積まれていない');
    console.log('周回の続き OK (1→2→3→4／四周目の先は無し／'+n3.label+')'); }

  // 四周目の続きからセーブを復元できること（従来 sv.lap>=4 の枝が無く三周目に落ちていた）
  // ヘッドレスの localStorage は何も覚えない作りなので、この節だけ本物に差し替える
  { const realLS=global.localStorage, mem={};
    global.localStorage={ getItem:k=>(k in mem?mem[k]:null), setItem:(k,v)=>{mem[k]=String(v);}, removeItem:k=>{delete mem[k];} };
    try {
    setupRoster('inu'); startGame(); state='play';
    lap=4; buildEncounters4(); saveProgress(1);
    const sv=loadProgress();
    if(!sv || sv.lap!==4) throw new Error('四周目がセーブに残らない: '+JSON.stringify(sv&&sv.lap));
    lap=1; startGameAt(sv.stage||1);
    if(lap!==4) throw new Error('セーブから再開すると四周目に戻らない: lap='+lap);
    console.log('四周目のセーブ復元 OK (lap=4 で再開できる)');
    } finally { global.localStorage=realLS; } }

  // =====================================================================
  //  2) トレーニングモード
  // =====================================================================
  { if(typeof startTraining!=='function') throw new Error('startTraining が無い');
    clearProgress();
    setupRoster('inu'); startTraining();
    if(!trainMode) throw new Error('trainMode が立っていない');
    if(state!=='play') throw new Error('練習が始まっていない: state='+state);
    // 湧きが止まっていること（本編の門が残っていると練習中に雑魚が出る）
    if(encounters.length) throw new Error('練習場に本編のエンカウンタが残っている: '+encounters.length);
    // 的が居ること
    const posts=()=>enemies.filter(e=>!e.dead&&ETYPE[e.type].train).length;
    if(posts()!==1) throw new Error('的が1体立っていない: '+posts());
    console.log('練習の開始 OK (湧き無し／的1体／state=play)'); }

  // 的は反撃しない。何フレーム放置しても主役は削られない
  { const p=players[0]; player=p;
    const hp0=p.hp;
    for(let f=0;f<240;f++){ hitStop=0; step(1); }
    if(p.hp<hp0) throw new Error('的が反撃してきた: HP '+hp0+' → '+p.hp);
    if(!enemies.some(e=>!e.dead&&ETYPE[e.type].train)) throw new Error('的が居なくなった');
    console.log('的の無害さ OK (240F 放置で被ダメージ 0)'); }

  // 主役が死なない（練習が中断されない）
  { const p=players[0]; player=p;
    // (a) 致命傷を受けても練習が続く
    p.hp=1; p.invuln=0; hurtPlayer(p, 99999, 1, false);
    step(2);
    if(p.state==='dead') throw new Error('練習中に死んだ');
    // (b) 削られた分は次のフレームで戻る。ここを見ないと (a) は「死んで復活した」でも通る
    p.hp=p.maxHp; p.invuln=0; const lv0=p.lives;
    hurtPlayer(p, Math.max(5,Math.round(p.maxHp*0.2)), 1, false);
    if(!(p.hp<p.maxHp)) throw new Error('そもそもダメージが入っていない（この節の前提が崩れている）');
    step(2);
    if(p.hp!==p.maxHp) throw new Error('練習中に削られたHPが戻らない: '+p.hp+'/'+p.maxHp);
    if(p.lives<lv0) throw new Error('練習で残機が減った: '+lv0+' → '+p.lives);
    console.log('主役の不死 OK (致命傷でも続行／削られた分は次フレームで満タンへ)'); }

  // 的は倒れない（殴り続けても消えない＝コンボが途中で終わらない）
  { const e=enemies.find(x=>!x.dead&&ETYPE[x.type].train);
    if(!e) throw new Error('的が居ない');
    for(let i=0;i<60;i++) damageEnemy(e, 400, 0, false);
    if(e.dead || e.hp<=0) throw new Error('的が倒れた: hp='+e.hp);
    console.log('的の頑丈さ OK (400ダメージ×60発でも倒れない／残 '+e.hp+')'); }


  // 殴らずに置くと満タンへ戻る（次の練習が同じ条件で始められる）
  { const e=enemies.find(x=>!x.dead&&ETYPE[x.type].train);
    const before=e.hp;
    if(!(before<e.maxHp)) throw new Error('前段で的が削れていない');
    for(let f=0;f<130;f++){ hitStop=0; step(1); }
    if(e.hp!==e.maxHp) throw new Error('放置しても的が回復しない: '+e.hp+'/'+e.maxHp);
    console.log('的の自動回復 OK ('+before+' → 満タン)'); }

  // 万一 的が消えても補充されること（居なくなったまま練習が続くと何も殴れない）
  { for(let i=enemies.length-1;i>=0;i--) if(ETYPE[enemies[i].type].train) enemies.splice(i,1);
    if(enemies.some(x=>ETYPE[x.type].train)) throw new Error('的を消せていない');
    for(let f=0;f<4;f++){ hitStop=0; step(1); }
    const n=enemies.filter(x=>!x.dead&&ETYPE[x.type].train).length;
    if(n!==1) throw new Error('消えた的が補充されない: '+n+'体');
    console.log('的の補充 OK (消しても数フレームで戻る)'); }

  // 記録：最大コンボと最大ダメージが残ること
  { trainReset();
    const e=enemies.find(x=>!x.dead&&ETYPE[x.type].train) || (trainSpawnPosts(), enemies.find(x=>ETYPE[x.type].train));
    for(let i=0;i<12;i++){ addCombo(7); step(1); }
    if(train.maxCombo<12) throw new Error('最大コンボが残らない: '+train.maxCombo);
    if(train.maxDmg<84) throw new Error('最大ダメージが残らない: '+train.maxDmg);
    const mc=train.maxCombo, md=train.maxDmg;
    resetCombo(); step(2);
    if(train.maxCombo!==mc || train.maxDmg!==md) throw new Error('コンボが切れると記録まで消える');
    trainReset();
    if(train.maxCombo!==0 || train.maxDmg!==0) throw new Error('R でリセットされない');
    console.log('記録 OK (最大 '+mc+'HIT / '+md+'ダメージ が切れても残り、リセットで0)'); }

  // 技の履歴：出した技名と前の技からの間隔が残ること
  { trainReset();
    const p=players[0]; player=p; p.state='idle'; p.atk=null; p.z=0;
    beginAttack('c1'); step(9); beginAttack('c2'); step(11); beginAttack('c3');
    if(train.log.length!==3) throw new Error('技の履歴が3件残らない: '+train.log.length);
    if(train.log[0].n!==ATK.c1.name) throw new Error('技名が残らない: '+train.log[0].n);
    if(train.log[1].n!==ATK.c2.name) throw new Error('2手目の技名が違う: '+train.log[1].n);
    // 間隔は「前の技からのフレーム数」。9F と 11F 空けたのだから順に増えていること
    if(train.log[0].gap!==0) throw new Error('1手目に間隔が付いている: '+train.log[0].gap);
    if(train.log[1].gap!==9) throw new Error('2手目の間隔が9Fでない: '+train.log[1].gap);
    if(train.log[2].gap!==11) throw new Error('3手目の間隔が11Fでない: '+train.log[2].gap);
    // 直近7件までで打ち切る（無限に伸びると画面から溢れる）
    for(let i=0;i<10;i++){ beginAttack('c1'); step(3); }
    if(train.log.length>7) throw new Error('履歴が7件を超えて伸びる: '+train.log.length);
    console.log('技の履歴 OK (技名＋前の技からの間隔 9F/11F／直近7件で打ち切り)'); }

  // 的の姿勢と数、段位とキャラの切り替え
  { trainSetPosts(3);
    const posts=()=>enemies.filter(e=>!e.dead&&ETYPE[e.type].train).length;
    if(posts()!==3) throw new Error('的を3体にできない: '+posts());
    trainSetPosts(1);
    if(posts()!==1) throw new Error('的を1体に戻せない: '+posts());
    // 姿勢：歩いて寄ってくる設定では、離して置くと近づいてくる
    const e=enemies.find(x=>ETYPE[x.type].train);
    players[0].x=camX+200; e.x=camX+700; e.homeX=e.x; train.stance=1;
    const d0=Math.abs(e.x-players[0].x);
    for(let f=0;f<90;f++){ hitStop=0; step(1); }
    if(!(Math.abs(e.x-players[0].x)<d0-60)) throw new Error('「歩いて寄ってくる」で近づいてこない');
    // 棒立ちでは寄ってこない
    train.stance=0; e.x=camX+700; e.homeX=e.x; players[0].x=camX+200;
    const d1=Math.abs(e.x-players[0].x);
    for(let f=0;f<90;f++){ hitStop=0; step(1); }
    if(Math.abs(e.x-players[0].x)<d1-40) throw new Error('「棒立ち」なのに寄ってくる');
    // 吹き飛ばしても定位置へ戻る
    e.x=e.homeX-160;
    for(let f=0;f<200;f++){ hitStop=0; step(1); }
    if(Math.abs(e.x-e.homeX)>12) throw new Error('吹き飛ばした的が定位置へ戻らない: '+(e.x-e.homeX).toFixed(0)+'px ずれ');
    console.log('的の設定 OK (1〜3体／寄る・棒立ちで挙動が違う／吹き飛ばしても定位置へ戻る)'); }

  { const lv0=players[0].level|0; trainCycleLevel();
    if((players[0].level|0)===lv0) throw new Error('段位が切り替わらない');
    if(TRAIN_LVL.indexOf(players[0].level|0)<0) throw new Error('段位が想定外の値: '+players[0].level);
    const k0=players[0].kind; trainCycleHero();
    if(players[0].kind===k0) throw new Error('キャラが切り替わらない');
    console.log('段位とキャラ OK (Lv.'+players[0].level+' / '+players[0].kind+')'); }

  // 練習の記録がセーブを汚さないこと
  { const realLS=global.localStorage, mem={};
    global.localStorage={ getItem:k=>(k in mem?mem[k]:null), setItem:(k,v)=>{mem[k]=String(v);}, removeItem:k=>{delete mem[k];} };
    try {
    clearProgress();
    trainMode=false; saveProgress(7);
    if(!loadProgress()) throw new Error('通常時にセーブが書けていない（この節の前提が崩れている）');
    clearProgress();
    trainMode=true; saveProgress(7);
    if(loadProgress()) throw new Error('練習中のセーブがプレイヤーの記録を上書きしている');
    trainMode=false;
    console.log('セーブ保護 OK (通常時は書けて、練習中は書かない)');
    } finally { global.localStorage=realLS; } }

  // 練習を抜けるとタイトルへ戻り、フラグも落ちること
  { setupRoster('inu'); startTraining();
    endTraining();
    if(trainMode) throw new Error('抜けても trainMode が立ったまま');
    if(state!=='title') throw new Error('タイトルへ戻らない: '+state);
    if(enemies.length) throw new Error('的が残っている');
    // 通常開始でも必ず落ちていること
    trainMode=true; startGame();
    if(trainMode) throw new Error('通常のゲーム開始で trainMode が落ちない');
    console.log('練習の終了 OK (タイトルへ戻り／的を片付け／通常開始でも必ず解除)'); }

  console.log('TRAINING TEST PASSED'); process.exit(0);
})().catch(e=>{ console.error('FAIL:', e.message, e.stack); process.exit(1); });
`;
code = code + "\n;" + DRIVER;
(0, eval)(code);

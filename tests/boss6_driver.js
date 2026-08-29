global.__HTML = html;
const DRIVER = `
(async()=>{
  const step=(n)=>{ for(let i=0;i<n;i++){ if(global.rafCb){ const cb=global.rafCb; global.rafCb=null; cb(); } } };

  // ═══ 1) 切り出しステージ：ラスボス戦だけを本編と同じ関門で通す ═══
  { sndOn=false; setupRoster('guard8'); startGame();
    startBossTest('guard8');
    if(state!=='play') throw new Error('試験ステージが始まらない（state='+state+'）');
    const bg=encounters.filter(function(E){ return E.boss; });
    if(bg.length!==1) throw new Error('試験ステージのボス関門が '+bg.length+' 個');
    if(bg[0].list[0][0]!=='mkOmega') throw new Error('試験ステージのボスが王機オメガでない');
    if(encounters.some(function(E){ return !E.boss; }))
      throw new Error('試験ステージに雑魚の関門が残っている（ラスボス戦だけを切り出す）');
    const p=players[0]; player=p; p.hp=p.maxHp=999999;
    const forms=[]; let reached=-1;
    for(let f=0;f<6000;f++){ hitStop=0; slowmo=0;
      p.hp=p.maxHp; p.invuln=999999;
      if(state==='cut') cutAdvance=true;            // 名乗りと形態変化のカットは送る
      step(1);
      const b=enemies.find(function(e){ return !e.dead && ETYPE[e.type] && ETYPE[e.type].boss; });
      if(b){ if(forms.indexOf(b.type)<0) forms.push(b.type);
        if(b.type!=='mkOmega3'){ if(state==='play'){ b.hp=1; killEnemy(b); } }
        else if(reached<0) reached=f; }
      else if(state==='play') p.x+=8;
      if(reached>=0 && f-reached>500) break; }
    if(forms.join('→')!=='mkOmega→mkOmega2→mkOmega3')
      throw new Error('三形態を順に辿れない（'+forms.join('→')+'）');
    if(reached<0) throw new Error('液体金属の形態まで届かない');
    if(!t1k.on) throw new Error('切り出しステージでイベント戦が始まらない');
    const arms=items.filter(function(q){ return q.kind==='evsg'||q.kind==='evgl'; }).length;
    if(!(arms>0)) throw new Error('イベント戦の火器が湧かない');
    const boss=enemies.find(function(e){ return !e.dead && ETYPE[e.type].t1000; });
    if(!boss) throw new Error('液体金属のボスが居ない');
    if(!(t1k.furnace>boss.x)) throw new Error('炉がボスの前方に無い');
    // 殴っても倒せず、撃つと炉へ寄る
    boss.hp=1; killEnemy(boss);
    if(boss.dead) throw new Error('殴りで倒せてしまう（イベント戦になっていない）');
    const x0=boss.x; t1kShove(boss, 30);
    if(!(boss.x>x0+10)) throw new Error('撃ち込んでも炉へ寄らない');
    console.log('切り出しステージ OK ('+forms.join('→')+'／イベント戦 開始・火器'+arms+'個・炉 '+Math.round(t1k.furnace)+'・撃つと寄る)'); }

  // ═══ 2) 本物の大王座：頭から歩いてボス関門まで辿り着き、そこでも始まる ═══
  //   前回の検査は第三形態を直接湧かせていたので、この道筋を一度も通っておらず、
  //   「遊ぶと一度もイベント戦にならない」不具合を素通りさせた
  { sndOn=false; setupRoster('guard8'); startGame(); state='play';
    startNG6(true);
    const node=allMapNodes().find(function(n){ return n.b && n.b.name.indexOf('大王座')>=0; });
    if(!node) throw new Error('大王座のノードが無い');
    loadLevel(node); state='play';
    const p=players[0]; player=p; p.hp=p.maxHp=999999;
    const forms=[]; let reached=-1, stuck=0, last=p.x, arrived=-1;
    for(let f=0;f<20000;f++){ hitStop=0; slowmo=0;
      p.hp=p.maxHp; p.invuln=999999;
      if(state==='cut') cutAdvance=true;
      const b=enemies.find(function(e){ return !e.dead && ETYPE[e.type] && ETYPE[e.type].evolveTo && ETYPE[e.type].mecha; });
      const live=enemies.some(function(e){ return !e.dead; });
      if(!live && state==='play'){
        p.in.K.right=true;                          // 前へ歩く
        // 塔の区間は「足場を4段登って高い地面へ跳び移る」構造なので、歩くだけでは通れない。
        // 接地するたびに跳び、段の手前で高さが足りなければ二段目を使う（人が跳ぶのと同じ手順）
        const need=terrLift(Math.min(WORLD_END-1, p.x+90))-terrLift(p.x);
        if(p.z<=0 && p.state!=='jump') p.in.pressed.jump=true;
        else if(p.state==='jump' && need>20 && zAbs(p)<need+40 && !p.djUsed) p.in.pressed.jump=true;
        last=p.x; }
      step(1);
      const bb=enemies.find(function(e){ return !e.dead && ETYPE[e.type] && ETYPE[e.type].boss && String(e.type).indexOf('mkOmega')===0; });
      if(bb){ if(arrived<0) arrived=f;
        if(forms.indexOf(bb.type)<0) forms.push(bb.type);
        if(bb.type!=='mkOmega3'){ if(state==='play'){ bb.hp=1; killEnemy(bb); } }
        else if(reached<0) reached=f; }
      else { enemies.forEach(function(e){ if(!e.dead && state==='play'){ e.hp=1; killEnemy(e); } }); }
      if(reached>=0 && f-reached>400) break; }
    if(arrived<0) throw new Error('大王座を歩いてもボス関門に辿り着けない（塔の段差を越えられていない可能性）');
    if(forms.join('→')!=='mkOmega→mkOmega2→mkOmega3')
      throw new Error('本編の道筋で三形態を辿れない（'+forms.join('→')+'）');
    if(!t1k.on) throw new Error('本編の道筋ではイベント戦が始まらない');
    const arms=items.filter(function(q){ return q.kind==='evsg'||q.kind==='evgl'; }).length;
    if(!(arms>0)) throw new Error('本編の道筋ではイベント戦の火器が湧かない');
    console.log('本物の大王座 OK (歩いてボス関門へ f='+arrived+'／'+forms.join('→')+'／イベント戦 開始・火器'+arms+'個)'); }

  // ═══ 3) イベントは「液体金属になってから」。前の形態では立たない ═══
  { setupRoster('guard8'); startGame(); state='play';
    enemies.length=0; items.length=0; t1kReset();
    spawnEnemy('mkOmega', 900, LANE); const e=enemies[0];
    for(let f=0;f<40;f++){ hitStop=0; slowmo=0; t1kTick(); }
    if(t1k.on) throw new Error('第一形態でイベント戦が立っている');
    const rc=startCutscene; startCutscene=function(sc,cb){ if(cb)cb(); };
    try{ e.hp=1; killEnemy(e);
      for(let f=0;f<40;f++){ hitStop=0; slowmo=0; t1kTick(); }
      if(t1k.on) throw new Error('第二形態でイベント戦が立っている');
      e.hp=1; killEnemy(e); } finally { startCutscene=rc; }
    if(e.type!=='mkOmega3') throw new Error('第三形態へ進化しない（'+e.type+'）');
    if(!t1k.on) throw new Error('第三形態へ進化してもイベント戦が始まらない');
    // 立ったあと消えないこと。t1kTick が液体金属を見つけられないと自分で落とす
    for(let f=0;f<600;f++){ hitStop=0; slowmo=0; t1kTick(); updateItems();
      if(!t1k.on) throw new Error('イベント戦が '+f+'F で消えた'); }
    console.log('開始の条件 OK (第一・第二では立たない／第三で始まり600F消えない)'); }

  console.log('LAST BOSS TEST PASSED'); process.exit(0);
})().catch(e=>{ console.error('FAIL:', e.message, e.stack); process.exit(1); });
`;
code = code + "\n;" + DRIVER;
(0, eval)(code);

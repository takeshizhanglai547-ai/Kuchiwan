global.__HTML = html;
const DRIVER = `
(async()=>{
  const step=(n)=>{ for(let i=0;i<n;i++){ if(global.rafCb){ const cb=global.rafCb; global.rafCb=null; cb(); } } };
  const KINDS=['inu','shima','nuko','guard8','watch','wanden','mack'];

  // ===== 1) 追加武器は7キャラ×5種。誰の得物かが必ず書いてある =====
  { const by={};
    for(const k in WEAPONS){ const w=WEAPONS[k]; if(!w.who) continue;
      if(KINDS.indexOf(w.who)<0) throw new Error('知らないキャラの武器がある: '+k+' -> '+w.who);
      (by[w.who]=by[w.who]||[]).push(k); }
    KINDS.forEach(function(k){
      const n=(by[k]||[]).length;
      if(n<5) throw new Error(k+' の追加武器が '+n+' 種類しかない'); });
    const total=Object.keys(by).reduce(function(a,k){ return a+by[k].length; },0);
    if(total<35) throw new Error('追加武器が全部で '+total+' 種類しかない');
    // 名前が全部ちがう（表示で見分けがつく）
    const names={}; for(const k in WEAPONS){ const nm=WEAPONS[k].name;
      if(names[nm]) throw new Error('同じ名前の武器が二つある: '+nm); names[nm]=1; }
    console.log('追加武器の数 OK ('+KINDS.map(function(k){return k+':'+by[k].length;}).join(' ')+')'); }

  // ===== 2) ATK の技IDが重複していない（後から書いたほうが黙って上書きする） =====
  { const H=global.__HTML||'';
    const st=H.indexOf('const ATK={'); if(st<0) throw new Error('ATK の定義が見つからない');
    let d=0, en=-1;
    for(let i=H.indexOf('{',st); i<H.length; i++){
      if(H[i]==='{') d++;
      else if(H[i]==='}'){ d--; if(d===0){ en=i; break; } } }
    if(en<0) throw new Error('ATK の終わりが見つからない');
    const body=H.slice(st,en), lines=body.split('\\n'), seen={}, dup=[];
    for(let i=0;i<lines.length;i++){ const L=lines[i];
      if(L.indexOf('  ')!==0 || L.charAt(2)===' ' || L.charAt(2)==='/') continue;
      const c=L.indexOf(':'); if(c<0) continue;
      const key=L.slice(2,c).trim();
      if(!key || key.indexOf(' ')>=0) continue;
      if(L.charAt(c+1)!=='{') continue;
      if(seen[key]) dup.push(key); seen[key]=1; }
    if(dup.length) throw new Error('技IDが重複している（後の定義が前を消す）: '+dup.join(','));
    console.log('技IDの重複なし OK ('+Object.keys(seen).length+'件)'); }

  // ===== 3) どの追加武器にも専用の連撃があり、技IDは全て実在する =====
  { let moves=0; const seen={};
    for(const k in WEAPONS){ if(!WEAPONS[k].who) continue;
      const cs=WEAPON_COMBO[k];
      if(!cs || cs.length<2) throw new Error(k+' に専用の連撃が無い');
      cs.forEach(function(m){
        if(!ATK[m]) throw new Error(k+' の技 '+m+' が ATK に無い');
        if(seen[m]) throw new Error('技 '+m+' を '+seen[m]+' と '+k+' が共有している（専用モーションになっていない）');
        seen[m]=k; moves++; }); }
    if(moves<100) throw new Error('追加武器の専用モーションが '+moves+' しかない');
    console.log('専用モーション OK ('+moves+'種類・共有ゼロ)'); }

  // ===== 4) 拾えるのは持ち主だけ（ワッチだけは魔法の触媒以外を扱える） =====
  { setupRoster('inu'); startGame(); state='play';
    const p=players[0];
    let cross=0;
    for(const k in WEAPONS){ const w=WEAPONS[k]; if(!w.who) continue;
      KINDS.forEach(function(kind){ p.kind=kind;
        const ok=canPick(p,k);
        if(kind===w.who){ if(!ok) throw new Error(kind+' が自分の得物 '+k+' を拾えない'); return; }
        if(kind==='watch'){ if(w.who!=='nuko' && !ok) throw new Error('ワッチが '+k+' を扱えない'); return; }
        if(ok){ cross++; } }); }
    if(cross>0) throw new Error('他人の得物を '+cross+' 件も拾えてしまう');
    p.kind='inu';
    console.log('拾える相手 OK (持ち主のみ／ワッチは魔法以外)'); }

  // ===== 5) 拾った武器の連撃が、キャラ既定の構えより優先される =====
  { setupRoster('inu'); startGame(); state='play';
    const p=players[0];
    ['nuko','wanden','mack'].forEach(function(kind){
      p.kind=kind; const w=WEAPON_OWNER[kind][0], cs=WEAPON_COMBO[w];
      p.weapon=w;
      if(comboMaxFor(p)!==cs.length) throw new Error(kind+' が '+w+' を持っても段数が '+comboMaxFor(p)+' のまま');
      for(let i=1;i<=cs.length;i++){
        if(comboMoveFor(p,i)!==cs[i-1]) throw new Error(kind+' の'+i+'段目が '+comboMoveFor(p,i)+'（'+cs[i-1]+' のはず）'); } });
    p.kind='inu'; p.weapon=null;
    console.log('構えの上書き OK (ヌコ・ワンデン・マックも拾った武器の連撃になる)'); }

  // ===== 6) 追加武器の全ての技が、実際に敵を減らす =====
  { setupRoster('inu'); startGame(); state='play'; hardMode=false;
    const p=players[0];
    const dmgOf=function(kind,weapon,move){
      p.kind=kind; p.weapon=weapon; p.weaponT=99999;
      p.state='idle'; p.atk=null; p.z=0; p.vz=0; p.invuln=99999; p.hp=p.maxHp=9999;
      p.x=600; p._tx=null; p.facing=1; p.comboStep=0; p.comboTimer=0;
      enemies.length=0; projectiles.length=0;
      // 間合いのちがう武器を同じ物差しで測るため、的を横一列に並べる
      const list=[];
      for(let k=0;k<9;k++){ spawnEnemy('wolf', 640+k*26, LANE); const e=enemies[enemies.length-1];
        e.hp=e.maxHp=99999; e.poise=99999; list.push(e); }
      const hp0=list.reduce(function(a,e){ return a+e.hp; },0);
      beginAttack(move);
      const D=ATK[move];
      for(let f=0;f<(D.dur||30)+(D.hold||0)+80;f++){
        hitStop=0; slowmo=0;
        list.forEach(function(e){ e.x=e._fx||(e._fx=e.x); e.vx=0; e.z=0; e.state='walk'; e.hurtTimer=0; });
        updatePlayer(p); updateProjectiles(); }
      return hp0-list.reduce(function(a,e){ return a+e.hp; },0); };
    const weak=[];
    for(const kind in WEAPON_OWNER){ WEAPON_OWNER[kind].forEach(function(w){
      WEAPON_COMBO[w].forEach(function(m){
        const d=dmgOf(kind,w,m);
        if(!(d>0)) weak.push(w+'/'+m); }); }); }
    if(weak.length) throw new Error('当たらない技がある: '+weak.join(','));
    p.kind='inu'; p.weapon=null; enemies.length=0; projectiles.length=0;
    console.log('全ての追加技が命中 OK'); }

  // ===== 7) 武器ごとに持ち姿がちがう（描画コマンドの形で見る） =====
  { setupRoster('inu'); startGame(); state='play';
    const p=players[0]; player=p; p.atk=null;
    // radGrad はグラデーションを使い回すので、初回だけ createRadialGradient が余分に出る。
    // 一度から回ししてから測らないと、測る順番で形がちがうことになる
    const sig=function(w){ p.weapon=w; player.weapon=w;
      gf=0; drawBlade(0,0,0,40);
      const real=ctx; const ops=[];
      ctx=new Proxy(real,{ get(t,k){ const v=t[k];
        if(typeof v==='function'||k==='fillRect'||k==='lineTo'||k==='moveTo'||k==='arc'||k==='ellipse'||k==='quadraticCurveTo'||k==='stroke'||k==='fill'||k==='strokeRect'){
          return function(){ ops.push(String(k)+':'+Array.prototype.slice.call(arguments).map(function(a){
            return (typeof a==='number')? a.toFixed(1) : ''; }).join(',')); return t[k]&&t[k].apply?t[k].apply(t,arguments):undefined; }; }
        return v; }, set(t,k,v){ t[k]=v; return true; } });
      gf=0; drawBlade(0,0,0,40); ctx=real; return ops.join('|'); };
    const bare=sig('dagger');      // 専用の分岐が無いと、既定の短剣に落ちる
    const seen={}, same=[], fell=[];
    for(const kind in WEAPON_OWNER){ WEAPON_OWNER[kind].forEach(function(w){
      const g=sig(w);
      if(!g || g.length<40) throw new Error(w+' の持ち姿が描かれていない（'+g.length+'）');
      if(g===bare) fell.push(w);
      if(seen[g]) same.push(w+'='+seen[g]); seen[g]=w; }); }
    if(fell.length) throw new Error('既定の短剣の形のまま描かれている武器がある: '+fell.join(','));
    if(same.length) throw new Error('持ち姿が同じ武器がある: '+same.join(','));
    p.weapon=null; player.weapon=null;
    console.log('持ち姿 OK ('+Object.keys(seen).length+'種類が全て別の形)'); }

  // ===== 8) 戻ってくる投擲は、行って戻る =====
  { setupRoster('inu'); startGame(); state='play';
    const p=players[0]; p.kind='inu'; p.weapon='chakram'; p.weaponT=99999;
    p.x=600; p._tx=null; p.facing=1; p.state='idle'; p.atk=null; p.invuln=99999;
    enemies.length=0; projectiles.length=0;
    beginAttack('ck3');
    let far=0, back=0, alive=null;
    for(let f=0;f<90;f++){ hitStop=0; slowmo=0; updatePlayer(p); updateProjectiles();
      const pr=projectiles.filter(function(q){ return q.owner==='player'; })[0];
      if(pr){ alive=pr; const d=pr.x-600; if(d>far) far=d; if(far>60 && d<far-40) back=far-d; } }
    if(!(far>80)) throw new Error('投げた輪が '+Math.round(far)+'px しか飛ばない');
    if(!(back>40)) throw new Error('投げた輪が戻ってこない（最遠 '+Math.round(far)+'px から '+Math.round(back)+'px しか帰らない）');
    if(!(back>far*0.7)) throw new Error('投げた輪が手元まで帰ってこない（最遠 '+Math.round(far)+'px に対し '+Math.round(back)+'px）');
    // 帰りすぎて背後へ飛び去らない（画面外で当たり続けるのを防ぐ）
    if(projectiles.some(function(q){ return q.owner==='player' && q.boomer && (q.x-600)<-60; }))
      throw new Error('戻った輪が背後へ抜けていく');
    p.weapon=null; projectiles.length=0;
    console.log('戻る投擲 OK (前へ'+Math.round(far)+'px 進んで '+Math.round(back)+'px 戻る)'); }

  // ===== 9) 追加武器はステージのドロップに混ざる（出場キャラのぶんだけ） =====
  { setupRoster('inu'); startGame(); state='play';
    const p=players[0]; p.kind='inu';
    const got={}; for(let i=0;i<400;i++) got[weaponDropKind()]=1;
    const mine=WEAPON_OWNER['inu'].filter(function(w){ return got[w]; }).length;
    if(mine<3) throw new Error('イッヌの追加武器が '+mine+' 種類しか落ちない');
    const others=[]; for(const kind in WEAPON_OWNER){ if(kind==='inu') continue;
      WEAPON_OWNER[kind].forEach(function(w){ if(got[w]) others.push(w); }); }
    if(others.length) throw new Error('出ていないキャラの得物が落ちる: '+others.join(','));
    console.log('ドロップ OK (イッヌの追加武器'+mine+'種類／他キャラの得物は落ちない)'); }

  // ===== 10) 武器ごとに前攻撃と奥義が別の技になる =====
  { const ws=Object.keys(WEAPON_SPECIAL);
    if(ws.length<40) throw new Error('武器の技が '+ws.length+' 本ぶんしかない');
    // コンボを持つ武器はすべて対象
    Object.keys(WEAPON_COMBO).forEach(function(w){
      if(!WEAPON_SPECIAL[w]) throw new Error(w+' に武器の技が無い'); });
    const ids={}, names={};
    ws.forEach(function(w){ const t=WEAPON_SPECIAL[w];
      ['fwd','ult'].forEach(function(sl){
        const id=t[sl]; if(!id) throw new Error(w+' の '+sl+' が無い');
        const d=ATK[id]; if(!d) throw new Error(w+'/'+sl+' の技 '+id+' が ATK に無い');
        if(ids[id]) throw new Error('技 '+id+' を '+ids[id]+' と '+w+'/'+sl+' が共有している');
        ids[id]=w+'/'+sl;
        if(names[d.name]) throw new Error('同じ技名がある: '+d.name+'（'+names[d.name]+' と '+w+'/'+sl+'）');
        names[d.name]=w+'/'+sl; });
      if(!ATK[t.ult].ultMove) throw new Error(w+' の奥義が奥義扱いになっていない'); });
    console.log('武器ごとの技 OK ('+ws.length+'本×前攻撃と奥義＝'+Object.keys(ids).length+'技・すべて別物)'); }

  // ===== 11) 実際に武器を持つと、前攻撃と奥義がその武器の技になる =====
  { setupRoster('inu'); startGame(); state='play';
    const p=players[0];
    const ws=Object.keys(WEAPON_SPECIAL);
    // 拾っていないときはキャラ本来の技
    p.weapon=defaultWeaponFor('inu'); p.heldWeapon=null;
    if(weaponSpecialFor(p,'fwd')) throw new Error('素の得物でも武器の前攻撃が出る');
    ws.forEach(function(w){ p.weapon=w;
      if(weaponSpecialFor(p,'fwd')!==WEAPON_SPECIAL[w].fwd) throw new Error(w+' の前攻撃が引けない');
      if(weaponSpecialFor(p,'ult')!==WEAPON_SPECIAL[w].ult) throw new Error(w+' の奥義が引けない'); });
    p.weapon=defaultWeaponFor('inu');
    console.log('引き当て OK ('+ws.length+'本とも前攻撃・奥義を引ける／素の得物では出ない)'); }

  // ===== 12) 武器の前攻撃と奥義が、実際に敵を減らす =====
  { setupRoster('inu'); startGame(); state='play'; hardMode=false;
    const p=players[0];
    const hitWith=function(w, move){
      p.kind='inu'; p.weapon=w; p.weaponT=0; p.heldWeapon=w;
      p.state='idle'; p.atk=null; p.z=0; p.vz=0; p.invuln=99999; p.hp=p.maxHp=9999;
      p.dimMax=9; p.dim=9; p.x=600; p._tx=null; p.facing=1; p.comboStep=0; p.spinCount=1;
      enemies.length=0; projectiles.length=0;
      const list=[];
      for(let k=0;k<5;k++){ spawnEnemy('wolf', 570+k*60, LANE); const e=enemies[enemies.length-1];
        e.hp=e.maxHp=99999; e.poise=99999; e.thinkCd=99999; e._fx=e.x; list.push(e); }
      const hp0=list.reduce(function(a2,e){ return a2+e.hp; },0);
      player=p; beginAttack(move);
      const D=ATK[move];
      for(let f=0;f<(D.dur||40)+(D.hold||0)+50;f++){ hitStop=0; slowmo=0; particles.length=0;
        list.forEach(function(e){ e.x=e._fx; e.vx=0; e.z=0; e.state='walk'; e.hurtTimer=0; });
        updatePlayer(p); updateProjectiles(); }
      return hp0-list.reduce(function(a2,e){ return a2+e.hp; },0); };
    const dead=[];
    Object.keys(WEAPON_SPECIAL).forEach(function(w){ const t=WEAPON_SPECIAL[w];
      if(!(hitWith(w,t.fwd)>0)) dead.push(w+'/前');
      if(!(hitWith(w,t.ult)>0)) dead.push(w+'/奥義'); });
    if(dead.length) throw new Error('当たらない武器の技がある: '+dead.join(','));
    p.weapon=defaultWeaponFor('inu'); p.heldWeapon=null; enemies.length=0; projectiles.length=0;
    console.log('武器の技が命中 OK ('+(Object.keys(WEAPON_SPECIAL).length*2)+'技すべて)'); }

  // ===== 13) 指定された2つは、指定どおりの作りになっている =====
  { // ドリルの前攻撃＝突進。連打でヒット数が伸びる
    const dr=ATK[WEAPON_SPECIAL.jackdrill.fwd];
    if(!dr.move) throw new Error('ドリルの前攻撃が突進になっていない');
    if(!dr.respin) throw new Error('ドリルの前攻撃が連打で伸びない');
    { setupRoster('guard8'); startGame(); state='play';
      const p=players[0]; player=p;
      // 突進なので敵を一列に並べる。連打で継ぎ足せば奥まで届いて総ダメージが増える
      const run=function(mash){
        p.weapon='jackdrill'; p.heldWeapon='jackdrill'; p.state='idle'; p.atk=null; p.z=0;
        p.invuln=99999; p.hp=p.maxHp=9999; p.x=600; p._tx=null; p.facing=1; p.spinCount=1;
        enemies.length=0;
        const list=[]; for(let k=0;k<8;k++){ spawnEnemy('wolf', 700+k*90, LANE);
          const e=enemies[enemies.length-1];
          e.hp=e.maxHp=99999; e.poise=99999; e.thinkCd=99999; e._fx=e.x; list.push(e); }
        beginAttack(WEAPON_SPECIAL.jackdrill.fwd);
        for(let f=0;f<170;f++){ hitStop=0; slowmo=0; particles.length=0;
          list.forEach(function(e){ e.x=e._fx; e.vx=0; e.z=0; e.state='walk'; e.hurtTimer=0; });
          if(mash && f%4===0) p.in.pressed.atk=true;
          useInput(p.in); updatePlayer(p); saveInput(p.in); }
        return {hits:list.reduce(function(a2,e){ return a2+(99999-e.hp); },0), spin:p.spinCount|0}; };
      const a1=run(false), a2=run(true);
      if(!(a2.hits > a1.hits)) throw new Error('ドリルを連打してもヒットが伸びない（'+a1.hits+'→'+a2.hits+'）');
      if(!(a2.spin > a1.spin)) throw new Error('連打で突進が継ぎ足されない（×'+a1.spin+'→×'+a2.spin+'）');
      p.weapon=defaultWeaponFor('guard8'); p.heldWeapon=null;
      console.log('ドリルの前攻撃 OK (連打なし '+a1.hits+' → 連打あり '+a2.hits+'／×'+a1.spin+'→×'+a2.spin+')'); } }
  { // 大鎌の奥義＝両手で高速回転して刈り取る
    const sc=ATK[WEAPON_SPECIAL.scythe.ult];
    if(!sc.spin) throw new Error('大鎌の奥義が回転技になっていない');
    if(!sc.omni) throw new Error('大鎌の奥義が全方位になっていない');
    if(!sc.multi) throw new Error('大鎌の奥義が多段になっていない');
    if(!sc.scytheStorm) throw new Error('大鎌の奥義に専用の演出が無い');
    if(!(sc.act[1]-sc.act[0] >= 40)) throw new Error('大鎌の奥義の回転が '+(sc.act[1]-sc.act[0])+'フレームしか続かない');
    console.log('大鎌の奥義 OK ('+sc.name+'・全方位多段回転 '+(sc.act[1]-sc.act[0])+'F)'); }

  // ===== 14) 入力からたどり着く（前攻撃コマンド・奥義コマンドが実際にその技を出す） =====
  { setupRoster('inu'); startGame(); state='play'; hardMode=false;
    const p=players[0]; player=p; enemies.length=0; projectiles.length=0;
    const fire=function(w, slot){
      p.kind='inu'; p.weapon=w; p.heldWeapon=w; p.weaponT=0;
      p.state='idle'; p.atk=null; p.z=0; p.vz=0; p.x=600; p._tx=null; p.facing=1;
      p.hp=p.maxHp=9999; p.invuln=99999; p.dimMax=9; p.dim=9; p.comboStep=0;
      p.grabbed=null; p.sg=null; p.spinCount=0;
      const I=p.in; I.K.right=(slot==='fwd'); I.K.left=false; I.K.up=false; I.K.down=false;
      I.K.grab=false; I.pressed.grab=false; I.pressed.atk=true;
      I.dirTaps.length=0; I.cardSeq.length=0; I.downTaps.length=0;
      I.stickRot=(slot==='ult')? gf : -999;
      useInput(I); updatePlayer(p); saveInput(I);
      I.K.right=false; I.pressed.atk=false; I.stickRot=-999;
      return p.atk && p.atk.type; };
    const bad=[];
    Object.keys(WEAPON_SPECIAL).forEach(function(w){ const t=WEAPON_SPECIAL[w];
      const gf1=fire(w,'fwd'); if(gf1!==t.fwd) bad.push(w+'/前='+gf1);
      const gu=fire(w,'ult');  if(gu!==t.ult) bad.push(w+'/奥義='+gu); });
    if(bad.length) throw new Error('コマンド入力から武器の技が出ない: '+bad.slice(0,6).join(' '));
    // 素の得物に戻せば、本来のキャラの技に戻る
    p.weapon=defaultWeaponFor('inu'); p.heldWeapon=null;
    const back=fire(defaultWeaponFor('inu'),'ult');
    if(WEAPON_SPECIAL[defaultWeaponFor('inu')]) throw new Error('素の得物が武器表に載っている');
    if(!back) throw new Error('素の得物で奥義が出ない');
    p.weapon=defaultWeaponFor('inu'); p.heldWeapon=null; p.dim=0; p.atk=null;
    console.log('コマンド入力 OK (47本とも前攻撃・奥義コマンドから専用技／素の得物は '+back+')'); }

  console.log('WEAPON TEST PASSED'); process.exit(0);
})().catch(e=>{ console.error('FAIL:', e.message, e.stack); process.exit(1); });
`;
code = code + "\n;" + DRIVER;
(0, eval)(code);

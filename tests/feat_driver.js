global.__HTML = html;
const DRIVER = `
(async()=>{
  const step=(n)=>{ for(let i=0;i<n;i++){ if(global.rafCb){ const cb=global.rafCb; global.rafCb=null; cb(); } } };

  // ===== 1) difficulty helpers (hard mode + 2P) =====
  hardMode=false; TWO_P=false;
  if(!(diffHpMul()===1 && diffDmgMul()===1 && enemyLaunchMul()===1 && enemyThinkMul()===1)) throw new Error('normal difficulty not neutral');
  hardMode=true;
  if(!(enemyLaunchMul()<1)) throw new Error('hard mode does not reduce launch');
  if(!(diffDmgMul()>1)) throw new Error('hard mode does not raise damage');
  if(!(enemyThinkMul()>1)) throw new Error('hard mode does not raise attack frequency');
  const hpH=diffHpMul(); TWO_P=true; if(!(diffHpMul()>hpH)) throw new Error('2P does not raise enemy HP further');
  hardMode=false; TWO_P=false;
  console.log('DIFFICULTY HELPERS OK (hard: launch x'+((()=>{hardMode=true;const v=enemyLaunchMul();hardMode=false;return v;})())+', dmg up; 2P: +HP)');

  // ===== 2) hard mode: enemies resist launch =====
  setupRoster('inu'); startGame(); state='play';
  // 一定確率の星KO（吹っ飛びが即KOに化ける）を引くと vz が 0 になるので、素直に吹っ飛んだ試行で比べる
  const launchVz=(hard)=>{ hardMode=hard;
    for(let i=0;i<40;i++){ enemies.length=0; spawnEnemy('wolf', 500, LANE); const e=enemies[0];
      e.vz=0; e.z=0; e.state='walk'; launchEnemy(e, 16, -14, 3);
      if(e.state!=='blastoff') return Math.abs(e.vz); }
    throw new Error('every launch became a star KO'); };
  const normVz=launchVz(false), hardVz=launchVz(true);
  if(!(hardVz < normVz*0.75)) throw new Error('hard mode enemies not launch-resistant (norm='+normVz+' hard='+hardVz+')');
  console.log('HARD-MODE LAUNCH RESIST OK (vz '+normVz.toFixed(0)+' -> '+hardVz.toFixed(0)+')');
  hardMode=false;

  // ===== 3) 2P shared lives =====
  setupRoster('coop'); startGame(); state='play';
  if(!TWO_P) throw new Error('coop did not enable TWO_P');
  if(!(coopLives>0)) throw new Error('coopLives not set on coop start');
  if(players[0].kind==='' || !players[1].active) throw new Error('2P not both active');
  const cl0=coopLives; players[0].hp=1; players[0].invuln=0; loseLife(players[0]);
  if(coopLives!==cl0-1) throw new Error('shared lives not decremented ('+cl0+'->'+coopLives+')');
  // second player death also draws from the same pool
  players[1].hp=1; players[1].invuln=0; loseLife(players[1]);
  if(coopLives!==cl0-2) throw new Error('shared pool not used by both players');
  console.log('2P SHARED LIVES OK (pool '+cl0+' -> '+coopLives+' after both died)');

  // ===== 4) 2P character select flow =====
  setupRoster('coop'); start2PSelect(); for(let i=0;i<40;i++) step(1);   // 画面遷移フェードの中間フレームで charsel に入る
  if(state!=='charsel') throw new Error('start2PSelect did not enter charsel');
  // P1 moves cursor right once, P2 stays; then both confirm
  players[0].in.K={left:false,right:true,up:false,down:false,atk:false,grd:false,grab:false}; csNav[0]=0; updateCharSel();
  const p1pick=csSel[0];
  if(p1pick!==1) throw new Error('P1 cursor did not move (sel='+p1pick+')');
  players[0].in.K.right=false; players[1].in.K={left:false,right:false,up:false,down:false,atk:false,grd:false,grab:false};
  players[0].in.pressed.atk=true; players[1].in.pressed.atk=true; updateCharSel(); for(let i=0;i<40;i++) step(1);   // 決定→本編も遷移フェードを挟む
  if(state==='charsel') throw new Error('did not start after both locked');
  if(players[0].kind!==CHARS[p1pick].k) throw new Error('P1 kind not applied');
  console.log('2P CHAR SELECT OK (P1='+players[0].kind+', P2='+players[1].kind+', started -> '+state+')');

  // ===== 4b) 奥義は通常技・コマンド技のどれからでもキャンセルで出せる =====
  { const cancelFrom=function(kind, move){
      setupRoster(kind); startGame(); state='play';
      const p=players[0]; player=p; p.level=1; p.x=600; p._tx=null; p.facing=1; p.y=LANE;
      p.hp=p.maxHp=99999; p.state='idle'; p.atk=null; p.z=0;
      p.dimMax=9; p.dim=9; ultLocked=false;
      enemies.length=0; encounters.length=0; projectiles.length=0;
      consumeCmd();
      beginAttack(move);
      if(p.state!=='attack') throw new Error(kind+'/'+move+' が出ていない');
      const before=p.atk.type, dim0=p.dim;
      const real=rotationReady; rotationReady=function(){ return true; };
      hitStop=0; slowmo=0;                       // 演出でフレームが飛ぶと入力が届かない
      try{ p.in.pressed.atk=true; step(1); } finally { rotationReady=real; }
      return {before:before, after:(p.atk&&p.atk.type)||p.state, dim0:dim0, dim:p.dim, p:p}; };
    // 通常コンボの1段目から
    { const r=cancelFrom('inu','c1');
      if(r.after===r.before) throw new Error('通常技から奥義へ割り込めない（'+r.after+'）');
      if(!(r.dim<r.dim0)) throw new Error('奥義キャンセルでストックを消費していない'); }
    // コマンド技から（7キャラぶん・地上の↓↑技を起点にする）
    { const KS=['inu','shima','nuko','guard8','watch','wanden','mack'];
      const bad=[];
      KS.forEach(function(k){
        const mv=specialFor({kind:k,level:1},'du');
        if(!ATK[mv]) return;
        const r=cancelFrom(k, mv);
        if(r.after===r.before) bad.push(k+'/'+mv);
        else if(!(r.dim<r.dim0)) bad.push(k+'（ストック未消費）'); });
      if(bad.length) throw new Error('コマンド技から奥義へ割り込めない: '+bad.join(',')); }
    // 奥義から奥義へは繋げない。イッヌは技IDが同じなので、
    // 技名ではなくストックが二重に減っていないかで見る
    { const r=cancelFrom('inu','dimension');
      if(r.after!==r.before) throw new Error('奥義から奥義へ繋がってしまう（'+r.before+'→'+r.after+'）');
      if(r.dim!==r.dim0) throw new Error('奥義から奥義へ繋がってストックが二重に減っている（'+r.dim0+'→'+r.dim+'）'); }
    // ストックが足りなければ技はそのまま続く
    { setupRoster('inu'); startGame(); state='play';
      const p=players[0]; player=p; p.level=1; p.x=600; p._tx=null; p.facing=1;
      p.hp=p.maxHp=99999; p.state='idle'; p.atk=null; p.z=0; p.dimMax=9; p.dim=0;
      enemies.length=0; encounters.length=0; consumeCmd();
      beginAttack('c1');
      const real=rotationReady; rotationReady=function(){ return true; };
      hitStop=0; slowmo=0;
      try{ p.in.pressed.atk=true; step(1); } finally { rotationReady=real; }
      if(!p.atk || p.atk.type!=='c1') throw new Error('ストック0でも奥義に化けている（'+(p.atk&&p.atk.type)+'）');
      if(p.dim<0) throw new Error('ストックが負になっている'); }
    console.log('奥義キャンセル OK (通常技・7キャラのコマンド技から割り込める／奥義からは繋がらない／ストック0なら技が続く)'); }

  // ===== 5) redesigned ↓↑ specials (inu/shima/guard8) =====
  ['iswords','soneinch','gimpact','nthunder'].forEach(k=>{ if(!ATK[k]) throw new Error('missing ATK '+k); });
  // inu 聖剣乱舞: rising holy swords hit forward enemies + spawn hsword particles
  setupRoster('inu'); startGame(); state='play'; const pi=players[0]; player=pi; pi.x=300; pi.hp=pi.maxHp=99999; pi.facing=1;
  enemies.length=0; particles.length=0; spawnEnemy('wolf', pi.x+120, LANE); const iw=enemies[0]; iw.thinkCd=9999; iw.hp=iw.maxHp=9999;
  beginAttack('iswords'); let sawSword=false;
  for(let i=0;i<44;i++){ hitStop=0; step(1); if(particles.some(pp=>pp.k==='hsword')) sawSword=true; }
  if(!sawSword) throw new Error('iswords spawned no holy-sword particles');
  if(iw.hp>=9999) throw new Error('iswords did not hit forward enemy');
  console.log('INU 聖剣 OK (holy swords, dmg='+(9999-iw.hp)+')');
  // ↓↑ は「前方一列」ではなく、天から降ってくる聖剣。前も後ろも削り、締めで外へ弾く
  { const ringRun=function(move){
      setupRoster('inu'); startGame(); state='play';
      const p=players[0]; player=p; p.x=600; p._tx=null; p.facing=1; p.level=1;
      p.hp=p.maxHp=99999; p.state='idle'; p.atk=null; p.z=0; p.y=LANE;
      enemies.length=0; particles.length=0; projectiles.length=0;
      spawnEnemy('wolf', p.x+110, LANE); const fE=enemies[0];
      spawnEnemy('wolf', p.x-110, LANE); const bE=enemies[1];
      [fE,bE].forEach(function(e){ e.hp=e.maxHp=99999; e.poise=99999; e.thinkCd=99999; e._fx=e.x; });
      // 開幕の無敵時間が残っていると、結界の無敵と区別が付かない
      p.invuln=0;
      const D=ATK[move]; beginAttack(move);
      const free=(D.hold|0)+D.act[1];        // 締めの手前までは動かないよう押さえておく
      let inv=0, blades=[], fall=null, stab=null, pairs=0, fvx=0, bvx=0; const seen=new Set();
      const px0=p.x, py0=p.y;
      for(let i=0;i<free+26;i++){ hitStop=0; slowmo=0;
        // カメラが動くと updatePlayer の末尾の clamp で自分が押し出され、
        // 「後ろの敵」が自分より前に来てしまう。左右の判定を測るので自分も固定する
        p.x=px0; p.y=py0;
        // 敵は最後まで位置を固定する。締めの弾きは「自分から見て左右どちらに居るか」で
        // 向きを決めるので、解放した数フレームのあいだに歩いて自分より前へ回り込むと、
        // 後ろの敵まで前へ飛んで測定が壊れる（実測で25回に1回ほど起きていた）
        [fE,bE].forEach(function(e){ e.x=e._fx; e.vz=0; e.z=0; e.hurtTimer=0; });
        if(i<free){ fE.vx=0; bE.vx=0; }
        if(p.invuln>0) inv++;
        step(1);
        if(i>=free){ if(Math.abs(fE.vx)>Math.abs(fvx)) fvx=fE.vx;
                     if(Math.abs(bE.vx)>Math.abs(bvx)) bvx=bE.vx; }
        // 立った聖剣の位置を拾う（技の定数ではなく、実際に生えた本数と位置で測る）。
        // 寿命が尽きた粒子は配列から抜けるので、添字ではなく粒子そのもので重複を避ける
        const now=[];
        for(let q=0;q<particles.length;q++){ const t2=particles[q];
          if(!t2) continue;
          if(t2.k==='hsword' && !seen.has(t2)) now.push(t2.x-p.x);
          // 降下中の剣（fsword）が先に見え、遅れて地面に刺さった剣（hsword）が出ること
          if(t2.k==='fsword' && fall===null) fall=i;
          if(t2.k==='hsword' && stab===null) stab=i;
          if(t2.k==='hsword' && !seen.has(t2)){ seen.add(t2); blades.push(t2.x-p.x); } }
        // 同じフレームに左右へ1本ずつ刺さったか（上位技の「左右同時」はここでしか見えない）
        if(now.some(function(d){ return d>0; }) && now.some(function(d){ return d<0; })) pairs++; }
      return {front:99999-fE.hp, back:99999-bE.hp, inv:inv, blades:blades,
              fvx:fvx, bvx:bvx, fall:fall, stab:stab, pairs:pairs}; };
    const r1=ringRun('iswords');
    if(!(r1.front>0)) throw new Error('降ってきた聖剣が前の敵に当たらない');
    if(!(r1.back>0))  throw new Error('降ってきた聖剣が後ろの敵に当たらない（前方一列のまま）');
    // 地面から生えるのではなく、天から降ってくること
    if(r1.fall===null) throw new Error('降下中の聖剣が一本も出ない（地面から生えているだけ）');
    if(!(r1.stab!==null && r1.stab-r1.fall>=5))
      throw new Error('聖剣が降りきる前に刺さっている（降下 '+r1.fall+'F → 着弾 '+r1.stab+'F）');
    // superFx の出だし20Fぶんだけでは足りない。降らせている間じゅう守られること
    if(!(r1.inv>=40)) throw new Error('降らせている間の無敵が '+r1.inv+'F しか続かない（出だしだけ）');
    if(!(r1.blades.some(function(d){ return d>30; }) && r1.blades.some(function(d){ return d<-30; })))
      throw new Error('聖剣が片側にしか立たない');
    if(!(r1.bvx<-5 && r1.fvx>5))
      throw new Error('締めで外へ弾いていない（後ろ '+r1.bvx.toFixed(1)+' 前 '+r1.fvx.toFixed(1)+'）');
    const r2=ringRun('iswords2');
    const span=function(b){ return Math.max.apply(null, b.map(Math.abs)); };
    // Lv5 は左右同時に降らせる。本数だけ見ると「単に多い」でも通ってしまうので、
    // 同じフレームに左右へ刺さった回数で見る
    if(r1.pairs!==0) throw new Error('Lv1 で左右同時に刺さっている（'+r1.pairs+'回）');
    if(!(r2.pairs>=4)) throw new Error('Lv5 が左右同時になっていない（同時着弾 '+r2.pairs+'回）');
    if(!(r2.blades.length >= r1.blades.length*2))
      throw new Error('Lv5 で本数が倍になっていない（'+r1.blades.length+'→'+r2.blades.length+'本）');
    if(!(span(r2.blades) > span(r1.blades)+20))
      throw new Error('Lv5 で降る範囲が広がっていない（'+Math.round(span(r1.blades))+'→'+Math.round(span(r2.blades))+'px）');
    console.log('INU 断罪の降臨 OK (前'+r1.front+'/後'+r1.back+'・聖剣'+r1.blades.length+'本 幅'+Math.round(span(r1.blades))
      +'px・降下'+(r1.stab-r1.fall)+'F・無敵'+r1.inv+'F・締めで外へ／Lv5 は '+r2.blades.length+'本 幅'+Math.round(span(r2.blades))+'px・左右同時'+r2.pairs+'回)'); }
  // shima one-inch blow: close hit with massive hitstop
  setupRoster('shima'); startGame(); state='play'; const ps=players[0]; player=ps; ps.x=400; ps.hp=ps.maxHp=99999; ps.facing=1;
  enemies.length=0; projectiles.length=0; spawnEnemy('wolf', ps.x+28, LANE); const se=enemies[0]; se.thinkCd=9999; se.hp=se.maxHp=9999;
  hitStop=0; slowmo=0; beginAttack('soneinch'); let sHS=0, sB=false;
  for(let i=0;i<30;i++){ sHS=Math.max(sHS,hitStop); if(se.state==='blastoff')sB=true; hitStop=0; slowmo=0; step(1); }   // 溜め8F＋発生10F を待つ
  if(se.hp>=9999 && !se.dead && !sB) throw new Error('one-inch did not connect');
  if(sHS<24) throw new Error('one-inch hitstop too small ('+sHS+')');
  console.log('SHIMA ワンインチブロー OK (hitstop='+sHS+', blastoff='+sB+')');
  // guard8 メテオインパクト: multi-shockwave big AoE
  setupRoster('guard8'); startGame(); state='play'; const pg=players[0]; player=pg; pg.x=400; pg.hp=pg.maxHp=99999; pg.facing=1;
  enemies.length=0; projectiles.length=0; spawnEnemy('wolf', pg.x+120, LANE); const gw=enemies[0]; gw.thinkCd=9999; gw.hp=gw.maxHp=9999;
  beginAttack('gimpact'); let waves=0;
  for(let i=0;i<40;i++){ hitStop=0; step(1); waves=Math.max(waves, projectiles.filter(pr=>pr.owner==='player'&&pr.wave).length); }
  if(waves<3) throw new Error('gimpact did not spawn multiple shockwaves (saw '+waves+')');
  if(gw.hp>=9999) throw new Error('gimpact did not hit');
  console.log('GUARD8 メテオインパクト OK (shockwaves='+waves+', dmg='+(9999-gw.hp)+')');

  // ===== 6) enemy vehicles (bike/trailer) =====
  ['bikewan','trailerwan'].forEach(k=>{ if(!ETYPE[k]) throw new Error('missing ETYPE '+k); });
  setupRoster('inu'); startGame(); state='play'; const pv=players[0]; player=pv; pv.x=400; pv.hp=pv.maxHp=99999; pv.lives=99; pv.invuln=0;
  enemies.length=0; spawnEnemy('bikewan', pv.x+300, LANE); const bk=enemies[0]; bk.thinkCd=0; bk.stun=0;
  let charged=false, bx0=bk.x;
  for(let i=0;i<140;i++){ step(1); if(bk.state==='bikecharge') charged=true; if(charged) break; }
  if(!charged) throw new Error('bikewan never charged');
  const bxA=bk.x; for(let i=0;i<20;i++){ step(1); } const dashDist=Math.abs(bk.x-bxA);
  if(dashDist<40) throw new Error('bikewan charge did not dash fast ('+Math.round(dashDist)+')');
  console.log('ENEMY BIKE CHARGE OK (dashed '+Math.round(dashDist)+'px in 20f)');
  // trailer armor resists launch (deterministic: armor halves vz AND prevents star-KO blastoff)
  hardMode=false; enemies.length=0; spawnEnemy('trailerwan', pv.x+80, LANE); const tr=enemies[0]; tr.vz=0; tr.z=0; tr.state='walk';
  launchEnemy(tr,16,-14,3);
  if(tr.state==='blastoff') throw new Error('armored trailer star-KO blasted off (should resist)');
  if(!(Math.abs(tr.vz) < 8)) throw new Error('trailer armor not resisting launch (vz='+tr.vz+', expected ~7 from -14x0.5)');
  console.log('ENEMY TRAILER ARMOR OK (launch vz -14 -> '+tr.vz.toFixed(1)+', no star-KO)');

  // ===== 追加武器：死神の大鎌と斬馬刀 =====
  { // 定義が揃っていること
    ['scythe','zanbatou'].forEach(function(k){
      if(!WEAPONS[k]) throw new Error(k+' の武器定義が無い');
      if(!WEAPON_COMBO[k]) throw new Error(k+' のコンボが無い');
      WEAPON_COMBO[k].forEach(function(id){ if(!ATK[id]) throw new Error(k+' のコンボ技 '+id+' が ATK に無い'); }); });
    // 斬馬刀は「一撃が絶大／隙も絶大」。大鎌は「間合いが長い」
    const ax=ATK[WEAPON_COMBO.gaxe[0]], zb=ATK[WEAPON_COMBO.zanbatou[0]], sc=ATK[WEAPON_COMBO.scythe[0]];
    if(!(zb.dmg>ax.dmg*2.5)) throw new Error('斬馬刀の一撃が '+zb.dmg+'（大戦斧 '+ax.dmg+' の2.5倍未満）');
    if(!(zb.act[0]>=20)) throw new Error('斬馬刀の振りかぶりが '+zb.act[0]+'F しかない（隙が大きくない）');
    if(!(zb.dur-zb.act[1]>=12)) throw new Error('斬馬刀の振り抜き後の隙が '+(zb.dur-zb.act[1])+'F しかない');
    if(!(zb.dur>ax.dur*2)) throw new Error('斬馬刀の全体フレームが '+zb.dur+'（大戦斧 '+ax.dur+' の2倍未満）');
    if(!(WEAPONS.zanbatou.reach>WEAPONS.gaxe.reach*1.4)) throw new Error('斬馬刀の間合いが伸びていない');
    if(!(WEAPONS.scythe.reach>WEAPONS.gaxe.reach*1.15)) throw new Error('大鎌の間合いが伸びていない');
    // 実際に持って振ると当たり、斬馬刀のほうが重い
    const swing=function(kind,weapon,id){ setupRoster(kind); startGame(); state='play';
      const p=players[0]; player=p; p.atkMul=1; p.weapon=weapon; p.weaponT=99999;
      p.x=camX+300; p.facing=1; p.state='idle'; p.z=0; p.atk=null; p.invuln=0;
      enemies.length=0; encounters.length=0;
      spawnEnemy('wolf', p.x+150, LANE); const e=enemies[0]; e.hp=e.maxHp=999999; e.thinkCd=999999;
      const hp0=e.hp; beginAttack(id);
      for(let f=0;f<120;f++){ hitStop=0; updatePlayer(p); }
      return hp0-e.hp; };
    const dSc=swing('inu','scythe','sc1'), dZb=swing('inu','zanbatou','zb1'), dAx=swing('guard8','gaxe','ax1');
    if(!(dSc>0)) throw new Error('大鎌が当たらない');
    if(!(dZb>0)) throw new Error('斬馬刀が当たらない');
    if(!(dZb>dAx*2)) throw new Error('斬馬刀の実ダメージが '+dZb+'（大戦斧 '+dAx+' の2倍未満）');
    // 拾える相手：イッヌとワッチは両方、シマは扱えない
    if(!canPick({kind:'inu'},'scythe')) throw new Error('イッヌが大鎌を拾えない');
    if(!canPick({kind:'inu'},'zanbatou')) throw new Error('イッヌが斬馬刀を拾えない');
    if(!canPick({kind:'guard8'},'zanbatou')) throw new Error('ガードワンが斬馬刀を拾えない');
    if(canPick({kind:'shima'},'zanbatou')) throw new Error('シマが斬馬刀を拾えてしまう');
    console.log('追加武器 OK (大鎌 実ダメージ'+dSc+'・間合い'+WEAPONS.scythe.reach
      +'／斬馬刀 '+dZb+'・振りかぶり'+zb.act[0]+'F・全体'+zb.dur+'F／大戦斧 '+dAx+')'); }

  // ===== 斧の見た目：三日月ではなく「斧」の形をしていること =====
  // 以前は柄の先に三日月を1枚置いただけで、棒の先の月にしか見えなかった。
  // 斧に見せる3要素（柄を挟む頭／背の平ら／柄より手元へ垂れる顎）が描かれているかを、
  // 実装が呼ぶ描画命令の座標から確かめる
  { const real=ctx;
    const shape=function(weapon){ setupRoster('guard8'); startGame(); state='play';
      const p=players[0]; player=p; p.weapon=weapon; p.weaponT=99999;
      const rects=[], polys=[];
      try{ ctx=new Proxy(real,{ get:function(t,k){ const v=t[k];
            if(k==='fillRect') return function(x,y,w,h){ rects.push([x,y,w,h]); return v.apply(t,arguments); };
            if(k==='lineTo'||k==='moveTo') return function(x,y){ polys.push([x,y]); return v.apply(t,arguments); };
            if(typeof v==='function') return function(){ return v.apply(t,arguments); };
            return v; }, set:function(t,k,v){ t[k]=v; return true; } });
        drawBlade(0,0,0,30);
      } finally { ctx=real; }
      return {rects:rects, polys:polys}; };
    const a=shape('gaxe');
    if(a.polys.length<6) throw new Error('斧の刃が描かれていない');
    // 頭は柄（y=0）の上下へ大きく張り出す：|y|>=24 の点が上下ともにあること
    const up=a.polys.some(function(q){ return q[1]<=-24; }), dn=a.polys.some(function(q){ return q[1]>=24; });
    if(!up||!dn) throw new Error('斧の刃が柄の上下へ張り出していない（三日月のまま）');
    // 背の平ら（ポール）＝刃の反対側に置かれた縦長の矩形があること
    const poll=a.rects.some(function(r){ return r[3]>=18 && r[2]<=18 && r[0]>0; });
    if(!poll) throw new Error('斧の背の平ら（ポール）が無い');
    console.log('斧の形 OK (柄の上下へ張り出す頭＋背の平ら)'); }

  // ===== 拾った武器・買った武器は次のステージへ持ち越す =====
  { setupRoster('inu'); startGame(); state='play';
    const p=players[0];
    giveWeapon(p,'spear');
    if(p.weaponT!==0) throw new Error('拾った武器に制限時間が付いている（'+p.weaponT+'）');
    for(let f=0;f<400;f++){ hitStop=0; slowmo=0; step(1); }
    if(p.weapon!=='spear') throw new Error('放っておくと '+p.weapon+' に戻る（持ち続けるはず）');
    // 次のステージへ
    loadLevel(WORLD_LEVELS[1]);
    if(players[0].weapon!=='spear') throw new Error('次のステージで '+players[0].weapon+' に戻っている');
    // やられて復帰しても持ったまま
    const q=players[0]; q.hp=1; q.invuln=0; q.lives=3; loseLife(q);
    resetPlayer(q,false);
    if(q.weapon!=='spear') throw new Error('復帰すると '+q.weapon+' に戻っている');
    // 新規開始では手放す
    startGame();
    if(players[0].weapon==='spear') throw new Error('新規開始でも拾った武器を持っている');
    console.log('武器の持ち越し OK (時間で消えない／次のステージ・復帰でも保持／新規開始で手放す)'); }

  // ===== 地図からいつでもチャムの店へ行ける =====
  { setupRoster('inu'); startGame();
    enterMap();
    if(state!=='map') throw new Error('地図へ入れない（'+state+'）');
    players[0].in.pressed.grab=true;
    updateMap();
    for(let f=0;f<80 && state!=='shop'; f++) step(1);
    if(state!=='shop') throw new Error('地図から店へ行けない（'+state+'）');
    if(!shopRows.length) throw new Error('店の品揃えが空');
    console.log('地図から店 OK (掴みボタンでチャムの店・品数'+shopRows.length+')'); }

  // ===== ステージ間の会話が掛け合いになっている =====
  { setupRoster('inu'); startGame(); state='play';
    startStageClearDemo(1);
    if(!cut || !cut.scenes) throw new Error('クリアのデモが始まらない');
    const sc=cut.scenes;
    if(sc.length<3) throw new Error('クリアの会話が '+sc.length+' 場面しかない（掛け合いになっていない）');
    if(!sc.some(function(q){ return q.art==='player'; })) throw new Error('主役のひとことが無い');
    const rep2=sc.filter(function(q){ return q.art==='cham'||q.art==='p2'; });
    if(!rep2.length) throw new Error('受け手（チャム／2P）の返しが無い');
    if(!rep2[0].text || rep2[0].text.length<8) throw new Error('返しが短すぎる');
    // 一周目の13ステージは、7キャラ全員に専用の台詞がある
    const KIND7=['inu','shima','nuko','guard8','watch','wanden','mack'];
    const names=Object.keys(CLEAR_LINE);
    if(names.length<13) throw new Error('クリア台詞のあるステージが '+names.length+' しかない');
    names.forEach(function(nm){ KIND7.forEach(function(k){
      if(!CLEAR_LINE[nm][k]) throw new Error(nm+' に '+k+' の台詞が無い');
      if(!PARTNER_LINE[nm]) throw new Error(nm+' に相棒の返しが無い'); }); });
    // 主役と相棒で同じ文が出ない
    names.forEach(function(nm){ KIND7.forEach(function(k){
      if(CLEAR_LINE[nm][k]===PARTNER_LINE[nm]) throw new Error(nm+'/'+k+' の台詞と返しが同じ'); }); });
    cut=null; state='play';
    console.log('ステージ間の会話 OK ('+names.length+'ステージ×7キャラ＋相棒の返し／'+sc.length+'場面の掛け合い)'); }

  // ===== 死神の大鎌は刃が前を向いている =====
  { setupRoster('inu'); startGame(); state='play';
    const p=players[0]; player=p; p.weapon='scythe'; p.atk=null;
    const real=ctx; const pts=[];
    ctx=new Proxy(real,{ get(t,k){
      if(k==='moveTo'||k==='lineTo'||k==='quadraticCurveTo'||k==='arc'){
        return function(){ const a=Array.prototype.slice.call(arguments);
          if(k==='quadraticCurveTo'){ pts.push([a[0],a[1]]); pts.push([a[2],a[3]]); }
          else pts.push([a[0],a[1]]); return undefined; }; }
      const v=t[k]; return (typeof v==='function')? function(){ return t[k].apply(t,arguments); } : v; },
      set(t,k,v){ t[k]=v; return true; } });
    gf=0; drawBlade(0,0,0,30); ctx=real;
    // 柄の長さ（この先に刃が付く）
    const L=30*1.05+58;
    const blade=pts.filter(function(q){ return q[1] < -30; });   // 刃は柄より上へ張り出す部分
    if(blade.length<3) throw new Error('刃が描かれていない（'+blade.length+'点）');
    const tip=blade.reduce(function(a,b){ return (b[1]<a[1])? b : a; });
    if(!(tip[0] > L)) throw new Error('刃の先が柄より後ろ（x='+tip[0].toFixed(0)+' ／柄の先 '+L.toFixed(0)+'）＝向きが逆');
    console.log('大鎌の向き OK (刃の先が柄の先より '+Math.round(tip[0]-L)+'px 前へ出ている)'); }

  console.log('NEW FEATURES TEST PASSED'); process.exit(0);
})().catch(e=>{ console.error('FAIL:', e.message, e.stack); process.exit(1); });
`;
code = code + "\n;" + DRIVER;
(0, eval)(code);

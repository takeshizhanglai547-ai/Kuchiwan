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

  // ===== 5) redesigned ↓↑ specials (inu/shima/guard8) =====
  ['iswords','soneinch','gimpact','nthunder'].forEach(k=>{ if(!ATK[k]) throw new Error('missing ATK '+k); });
  // inu 聖剣乱舞: rising holy swords hit forward enemies + spawn hsword particles
  setupRoster('inu'); startGame(); state='play'; const pi=players[0]; player=pi; pi.x=300; pi.hp=pi.maxHp=99999; pi.facing=1;
  enemies.length=0; particles.length=0; spawnEnemy('wolf', pi.x+120, LANE); const iw=enemies[0]; iw.thinkCd=9999; iw.hp=iw.maxHp=9999;
  beginAttack('iswords'); let sawSword=false;
  for(let i=0;i<44;i++){ hitStop=0; step(1); if(particles.some(pp=>pp.k==='hsword')) sawSword=true; }
  if(!sawSword) throw new Error('iswords spawned no holy-sword particles');
  if(iw.hp>=9999) throw new Error('iswords did not hit forward enemy');
  console.log('INU 聖剣乱舞 OK (holy swords, dmg='+(9999-iw.hp)+')');
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

  console.log('NEW FEATURES TEST PASSED'); process.exit(0);
})().catch(e=>{ console.error('FAIL:', e.message, e.stack); process.exit(1); });
`;
code = code + "\n;" + DRIVER;
(0, eval)(code);

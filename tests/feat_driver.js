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

  console.log('NEW FEATURES TEST PASSED'); process.exit(0);
})().catch(e=>{ console.error('FAIL:', e.message, e.stack); process.exit(1); });
`;
code = code + "\n;" + DRIVER;
(0, eval)(code);

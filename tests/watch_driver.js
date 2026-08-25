const DRIVER = `
(async()=>{
  const step=(n)=>{ for(let i=0;i<n;i++){ if(global.rafCb){ const cb=global.rafCb; global.rafCb=null; cb(); } } };
  const setCards=(p,arr)=>{ p.in.cardSeq=arr.map((c,i)=>({c,f:gf-(arr.length-1-i)})); useInput(p.in); };

  // ===== 1) combo-cancel into command special =====
  setupRoster('inu'); startGame(); state='play'; const p=players[0]; player=p; p.x=400; p.facing=1; p.hp=p.maxHp=99999; useInput(p.in);
  enemies.length=0; spawnEnemy('wolf',p.x+50,LANE); enemies[0].thinkCd=9999; enemies[0].hp=enemies[0].maxHp=9999;
  beginAttack('c1'); if(p.atk.type!=='c1') throw new Error('c1 combo did not start');
  for(let i=0;i<5;i++){ hitStop=0; step(1); }
  setCards(p,[2,1]); p.in.pressed.atk=true; useInput(p.in); hitStop=0; step(1);
  if(!(p.state==='attack' && p.atk.type==='iwave')) throw new Error('combo did not cancel into hadoken special (got '+(p.atk&&p.atk.type)+')');
  console.log('COMBO-CANCEL OK (c1 -> iwave via ↓→ cancel)');

  // ===== 2) shima one-inch blow: short reach, huge hitstop, screen-edge blastoff =====
  setupRoster('shima'); startGame(); state='play'; const ps=players[0]; player=ps; ps.x=400; ps.facing=1; ps.hp=ps.maxHp=99999;
  enemies.length=0; spawnEnemy('wolf',ps.x+28,LANE); const e1=enemies[0]; e1.thinkCd=9999; e1.hp=e1.maxHp=9999;
  hitStop=0; slowmo=0; beginAttack('soneinch'); let maxHS=0, blast=false;
  for(let i=0;i<30;i++){ maxHS=Math.max(maxHS,hitStop); if(e1.state==='blastoff') blast=true; hitStop=0; slowmo=0; step(1); }   // 溜め8F＋発生10F を待つ
  if(e1.hp>=9999 && !e1.dead && !blast) throw new Error('one-inch did not connect on close enemy');
  if(maxHS<24) throw new Error('one-inch hitstop too small ('+maxHS+')');
  console.log('ONE-INCH BLOW OK (hitstop='+maxHS+', blastoff='+blast+')');
  // extreme short reach: far enemy is NOT hit
  enemies.length=0; spawnEnemy('wolf',ps.x+140,LANE); const e2=enemies[0]; e2.thinkCd=9999; e2.hp=e2.maxHp=9999;
  hitStop=0; slowmo=0; beginAttack('soneinch'); for(let i=0;i<18;i++){ hitStop=0; slowmo=0; step(1); }
  if(e2.hp<9999 || e2.state==='blastoff') throw new Error('one-inch reach too long (hit enemy at +140)');
  console.log('ONE-INCH SHORT REACH OK (enemy at +140 untouched)');

  // ===== 3) ワッチ base character =====
  if(!CHARS.some(c=>c.k==='watch')) throw new Error('watch not in char select');
  setupRoster('watch'); startGame(); state='play'; const w=players[0]; player=w;
  if(w.kind!=='watch') throw new Error('watch roster failed');
  if(!(w.atkMul<1)) throw new Error('watch base attack not low (atkMul='+w.atkMul+')');
  if(!(w.spdMul>1)) throw new Error('watch not nimble');
  console.log('ワッチ BASE OK (atkMul='+w.atkMul+', spdMul='+w.spdMul+', lives='+w.lives+')');

  // ===== 4) ワッチ item-attack specialist =====
  if(!canPick(w,'spear')) throw new Error('watch cannot pick spear');
  if(!canPick(w,'hammer')) throw new Error('watch cannot pick hammer');
  if(canPick(w,'tome')) throw new Error('watch should not pick magic tome');
  // 拾った武器は時間で消えず、次のステージへ持ち越す（制限時間の作りはやめた）
  giveWeapon(w,'spear');
  if(w.weaponT!==0) throw new Error('拾った武器に制限時間が付いている（'+w.weaponT+'）');
  if(w.heldWeapon!=='spear') throw new Error('拾った武器が持ち物として記録されていない（'+w.heldWeapon+'）');
  // weapon damage bonus: same weapon/move/range, watch vs inu — watch's item bonus should net MORE despite its low base
  function dmgWith(kind,weap,ex){ setupRoster(kind); startGame(); state='play'; const q=players[0]; player=q; q.x=400; q.facing=1; q.weapon=weap; q.state='idle';
    enemies.length=0; spawnEnemy('wolf',400+ex,LANE); const e=enemies[0]; e.thinkCd=9999; e.hp=e.maxHp=99999; beginAttack('sp1'); for(let i=0;i<16;i++){ hitStop=0; step(1); } return 99999-e.hp; }
  const wSpear=dmgWith('watch','spear',80), iSpear=dmgWith('inu','spear',80);
  if(!(wSpear>0)) throw new Error('watch spear whiffed');
  if(!(wSpear>iSpear*1.05)) throw new Error('watch weapon bonus not applied (watch='+wSpear.toFixed(1)+' inu='+iSpear.toFixed(1)+')');
  console.log('ワッチ ITEM SPECIALIST OK (weaponT='+w.weaponT+', watch spear '+wSpear.toFixed(1)+' > inu spear '+iSpear.toFixed(1)+' despite low base)');

  // ===== 5) ワッチ grab-steal from zako =====
  setupRoster('watch'); startGame(); state='play'; const w2=players[0]; player=w2; w2.x=400; w2.facing=1; useInput(w2.in);
  enemies.length=0; spawnEnemy('wolf',w2.x+36,LANE); const ge=enemies[0]; ge.thinkCd=9999; ge.hp=ge.maxHp=300;
  tryGrab(); if(w2.state!=='grab') throw new Error('watch grab failed (state='+w2.state+')');
  const b={weapon:w2.weapon, atk:w2.atkMul, coins:coins, hp:ge.hp};
  grabSteal(ge);
  const stole=(w2.weapon!==b.weapon)||(w2.atkMul>b.atk)||(coins>b.coins);
  if(!stole) throw new Error('grab-steal produced nothing');
  if(ge.hp>=b.hp && !ge.dead) throw new Error('grab-steal did not damage enemy');
  console.log('ワッチ GRAB-STEAL OK (got '+(w2.weapon!==b.weapon?'weapon '+w2.weapon:(w2.atkMul>b.atk?'atk buff':'coins'))+')');

  // ===== 6) ワッチ boss-steal signature -> castable via ↓↑ =====
  setupRoster('watch'); startGame(); state='play'; const w3=players[0]; player=w3; w3.x=400; w3.facing=1; w3.hp=w3.maxHp=99999;
  enemies.length=0; spawnEnemy('moloch', w3.x+200, LANE); const boss=enemies[0]; boss.thinkCd=9999;
  damageEnemy(boss, 999999, 2, false, 0);
  if(!(w3.stolen && w3.stolen.length>0)) throw new Error('watch did not steal boss move on kill');
  const sName=w3.stolen[w3.stolen.length-1].name;
  projectiles.length=0; enemies.length=0;
  beginAttack('wtech'); let maxP=0; for(let i=0;i<24;i++){ hitStop=0; slowmo=0; step(1); maxP=Math.max(maxP, projectiles.filter(pr=>pr.owner==='player').length); }
  if(maxP<3) throw new Error('stolen boss move cast produced no projectiles (max='+maxP+')');
  console.log('ワッチ BOSS-STEAL OK (stole \\''+sName+'\\', ↓↑ cast fired projectiles)');
  // stolen persists across field reload (non-full reset)
  const nStolen=w3.stolen.length; resetPlayer(w3,false);
  if(w3.stolen.length!==nStolen) throw new Error('stolen moves lost on field reload');
  console.log('ワッチ STOLEN PERSIST OK ('+w3.stolen.length+' kept across field)');

  // ===== 7) ワッチ original thief moveset (no longer inu's) =====
  ['wc1','wc2','wc3','wc4','wknife','wflip','wsmoke','wdash','wlunge'].forEach(k=>{ if(!ATK[k]) throw new Error('missing watch move '+k); });
  setupRoster('watch'); startGame(); state='play'; const wm=players[0]; player=wm; wm.x=400; wm.facing=1; useInput(wm.in);
  if(comboMoveFor(wm,1)!=='wc1') throw new Error('watch combo not original (got '+comboMoveFor(wm,1)+')');
  setCards(wm,[1,2,1]); if(commandSpecial(wm)!=='wflip') throw new Error('watch DP should be wflip (got '+commandSpecial(wm)+')');
  setCards(wm,[2,1]); if(commandSpecial(wm)!=='wknife') throw new Error('watch hadoken should be wknife (got '+commandSpecial(wm)+')');
  function watchDrive(setup){ wm.state='idle'; wm.z=0; wm.atkHeld=false; wm.atk=null; slowmo=0; hitStop=0; consumeCmd(); wm.in.keys={}; useInput(wm.in); setup(); mapKeysFor(0); useInput(wm.in); wm.in.pressed.atk=true; slowmo=0; hitStop=0; step(1); return wm.atk&&wm.atk.type; }
  const upMv=watchDrive(()=>{ wm.in.keys['_u']=true; });
  if(upMv!=='wsmoke') throw new Error('watch up-attack should be wsmoke (got '+upMv+')');
  const stMv=watchDrive(()=>{ wm.in.cardSeq=[{c:3,f:gf},{c:1,f:gf}]; });
  if(stMv!=='wheist') throw new Error('watch stinger should be wheist (got '+stMv+')');
  const fwMv=watchDrive(()=>{ wm.in.keys['_r']=true; });
  if(fwMv!=='wpistol') throw new Error('watch forward-attack should be wpistol (got '+fwMv+')');
  const dnMv=watchDrive(()=>{ wm.in.keys['_d']=true; });
  if(dnMv!=='wmine') throw new Error('watch down-attack should be wmine (got '+dnMv+')');
  [upMv,stMv,fwMv,dnMv,'wc1','wknife','wflip'].forEach(mv=>{ if(['shoryu','iai','iwave','idragon','iswords','c1'].includes(mv)) throw new Error('watch still using inu move: '+mv); });
  console.log('ワッチ ORIGINAL MOVESET OK (上=wsmoke / ←→=wheist / 前=wpistol / 下=wmine)');

  // ===== 8) 地雷設置：設置→敵が近づくと起爆 =====
  hazards.length=0; wm.state='idle'; wm.z=0; wm.x=400; wm.facing=1; hitStop=0; slowmo=0;
  beginAttack('wmine'); for(let i=0;i<12;i++){ hitStop=0; slowmo=0; step(1); }
  const mine=hazards.find(h=>h.kind==='mine'); if(!mine) throw new Error('地雷 not placed');
  enemies.length=0; spawnEnemy('wolf', 420, LANE); const me=enemies[0]; me.thinkCd=9999; me.hp=me.maxHp=9999;
  let detonated=false; for(let i=0;i<30;i++){ hitStop=0; slowmo=0; step(1); if(!hazards.some(h=>h.kind==='mine')){ detonated=true; break; } }
  if(!detonated) throw new Error('地雷 did not detonate near enemy');
  if(me.hp>=9999 && !me.dead) throw new Error('地雷 explosion dealt no damage');
  console.log('ワッチ 地雷設置 OK (placed, detonated near enemy, dmg='+(9999-me.hp)+')');

  // ===== 9) 二丁拳銃：弾を連射＆命中 =====
  projectiles.length=0; enemies.length=0; wm.state='idle'; wm.x=400; wm.facing=1; hitStop=0; slowmo=0;
  spawnEnemy('wolf', wm.x+110, LANE); const be=enemies[0]; be.thinkCd=9999; be.hp=be.maxHp=9999; const beY=be.y;
  beginAttack('wpistol'); let bulSeen=false;
  for(let i=0;i<30;i++){ hitStop=0; slowmo=0;
    be.state='idle'; be.vx=0; be.vz=0; be.z=0; be.y=beY; be.stun=0;   // 敵を静止させて判定を決定的に
    if(projectiles.some(pr=>pr.owner==='player'))bulSeen=true; step(1); }
  // 至近距離では弾が生成と同フレームで着弾・消滅するため、命中（ダメージ）を主判定にする
  if(be.hp>=9999 && !be.dead && !bulSeen) throw new Error('二丁拳銃 fired no bullets and dealt no damage');
  if(be.hp>=9999 && !be.dead) throw new Error('二丁拳銃 bullets have NO hit detection');
  console.log('ワッチ 二丁拳銃 OK (bullets fired & HIT, dmg='+(9999-be.hp)+')');

  // ===== 10) ロックンロール（ガトリング奥義）：100連射 =====
  setupRoster('watch'); startGame(); state='play'; const wg=players[0]; player=wg; wg.x=400; wg.facing=1; wg.hp=wg.maxHp=99999; wg.dim=3;
  projectiles.length=0; enemies.length=0;
  // 前方の複数の高さ/位置に敵を置き、掃射で命中するか
  for(const dx of [120,200,300]){ spawnEnemy('wolf', wg.x+dx, LANE); }
  enemies.forEach(e=>{ e.thinkCd=9999; e.hp=e.maxHp=99999; });
  beginGatling(wg);
  if(wg.state!=='gatling') throw new Error('ロックンロール did not start');
  const dim0=wg.dim;
  let totalFired=0;
  for(let i=0;i<200 && wg.state==='gatling';i++){ const before=wg.gatShots||0; hitStop=0; slowmo=0; step(1); if((wg.gatShots||0)>before) totalFired=wg.gatShots; }
  if(totalFired<100) throw new Error('ガトリング fired '+totalFired+' rounds, expected 100');
  const hitCount=enemies.filter(e=>e.hp<99999||e.dead).length;
  if(hitCount<1) throw new Error('ロックンロール has NO hit detection (no enemy damaged)');
  console.log('ワッチ ロックンロール OK ('+totalFired+' 連射, HIT '+hitCount+'/3 enemies, returned to '+wg.state+')');

  console.log('WATCH/COMBAT TEST PASSED'); process.exit(0);
})().catch(e=>{ console.error('FAIL:', e.message, e.stack); process.exit(1); });
`;
code = code + "\n;" + DRIVER;
(0, eval)(code);

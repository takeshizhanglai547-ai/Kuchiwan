const DRIVER = `
(async()=>{
  const step=(n)=>{ for(let i=0;i<n;i++){ if(global.rafCb){ const cb=global.rafCb; global.rafCb=null; cb(); } } };

  // ===== 1) new enemy types exist & are damageable =====
  ['zombiewan','skeletwan','mechawan'].forEach(k=>{ if(!ETYPE[k]) throw new Error('missing ETYPE '+k); });
  console.log('NEW ENEMY DEFS OK ('+['zombiewan','skeletwan','mechawan'].map(k=>ETYPE[k].name).join(' / ')+')');

  setupRoster('inu'); startGame(); state='play'; const p=players[0]; player=p; p.x=400; p.hp=p.maxHp=99999; p.lives=99;

  // ===== 2) zombie revives once, then dies =====
  enemies.length=0; spawnEnemy('zombiewan', p.x+100, p.y); const z=enemies[0];
  damageEnemy(z, 99999, 4, true, 0);
  if(z.dead) throw new Error('zombie died on first kill (should revive)');
  if(!z.revived) throw new Error('zombie not marked revived');
  if(z.hp<=0) throw new Error('zombie revived with <=0 hp');
  damageEnemy(z, 99999, 4, true, 0);
  if(!z.dead) throw new Error('zombie did not die on second kill');
  console.log('ZOMBIE REVIVE OK (revived at hp='+Math.round(ETYPE.zombiewan.hp*2*0.5)+', died on 2nd hit)');

  // ===== 3) skeleton throws a bone projectile =====
  enemies.length=0; projectiles.length=0; p.x=400;
  spawnEnemy('skeletwan', p.x+300, p.y); const sk=enemies[0]; sk.thinkCd=0; sk.stun=0;
  let boneSeen=false;
  for(let i=0;i<120 && !boneSeen;i++){ step(1); if(projectiles.some(pr=>pr.owner==='enemy')) boneSeen=true; }
  if(!boneSeen) throw new Error('skeleton never threw a bone projectile');
  console.log('SKELETON BONE THROW OK');

  // ===== 4) mecha fires a red homing bolt =====
  enemies.length=0; projectiles.length=0; p.x=400;
  spawnEnemy('mechawan', p.x+320, p.y); const mc=enemies[0]; mc.thinkCd=0; mc.stun=0;
  let bolt=null;
  for(let i=0;i<160 && !bolt;i++){ step(1); bolt=projectiles.find(pr=>pr.owner==='enemy'&&pr.homing); }
  if(!bolt) throw new Error('mecha never fired a homing bolt');
  console.log('MECHA T-800 GUN OK (homing bolt r='+bolt.r+', color='+bolt.color+')');

  // ===== 5) XP / level up =====
  setupRoster('inu'); startGame(); state='play'; const q=players[0]; player=q; q.x=400; q.hp=q.maxHp=99999; q.lives=99;
  const lv0=q.level, hp0=q.maxHp, atk0=q.atkMul, xpNext0=q.xpNext;
  enemies.length=0;
  // kill a pile of enemies to force a level up
  for(let k=0;k<12;k++){ spawnEnemy('wolf', q.x+120, q.y); const e=enemies[enemies.length-1]; damageEnemy(e,99999,4,true,0); }
  if(q.level<=lv0) throw new Error('no level up after 12 kills (level='+q.level+', xp='+q.xp+'/'+xpNext0+')');
  if(q.maxHp<=hp0) throw new Error('maxHp did not grow on level up');
  if(!(q.atkMul>atk0)) throw new Error('atkMul did not grow on level up');
  console.log('XP/LEVEL OK (Lv'+lv0+'->Lv'+q.level+', maxHp '+hp0+'->'+q.maxHp+', atkMul '+atk0.toFixed(2)+'->'+q.atkMul.toFixed(2)+')');

  // ===== 6) vehicles: mount / trample / dismount / crash =====
  setupRoster('inu'); startGame(); state='play'; const r=players[0]; player=r; r.x=400; r.hp=r.maxHp=99999; r.lives=99;
  vehicles.length=0; enemies.length=0;
  spawnVehicle(r.x+30, 'horse');
  useInput(r.in); r.in.keys={}; r.in.pressed.grab=true;
  const mounted = tryMount(); r.in.pressed.grab=false;
  if(!mounted || r.vehicle!=='horse') throw new Error('failed to mount horse');
  const vh0=r.vehHp;
  console.log('MOUNT OK ('+VEHDEF[r.vehicle].name+', vehHp='+vh0+')');
  // move right fast
  const mx0=r.x; r.in.keys={}; r.in.keys['_r']=true; mapKeysFor(0); useInput(r.in);
  step(6);
  const moved=r.x-mx0; if(moved < SPEED*6*0.9) throw new Error('mounted move too slow ('+Math.round(moved)+')');
  console.log('MOUNT MOVE OK (fast: '+Math.round(moved)+'px in 6f vs on-foot '+Math.round(SPEED*6)+')');
  // horse lance attack (mount-specific weapon)
  hitStop=0; slowmo=0; enemies.length=0; spawnEnemy('wolf', r.x+90, r.y); const le=enemies[0]; le.thinkCd=9999; le.hp=le.maxHp=9999; const lh0=le.hp;
  player=r; useInput(r.in); r.in.keys={}; r.in.pressed.atk=true; step(1);
  if(r.mAtk!=='lance' || r.mAtkT<=0) throw new Error('horse attack did not trigger lance (mAtk='+r.mAtk+')');
  r.in.pressed.atk=false; for(let i=0;i<24;i++){ hitStop=0; step(1); }
  if(le.hp>=lh0 && !le.dead) throw new Error('lance swing did not hit enemy');
  console.log('HORSE LANCE OK (大槍 dmg='+(lh0-le.hp)+')');
  // contact trample (no attack button)
  hitStop=0; enemies.length=0; spawnEnemy('wolf', r.x+40, r.y); const te=enemies[0]; te.thinkCd=9999; const th0=te.hp;
  r.in.keys={}; r.in.keys['_r']=true; mapKeysFor(0); useInput(r.in); r.mAtkT=0; step(8);
  if(te.hp>=th0 && !te.dead) throw new Error('contact trample did not damage enemy');
  console.log('TRAMPLE OK (dmg='+(th0-te.hp)+')');
  // getting hit while mounted -> fall off (落馬) with reduced damage
  hitStop=0; slowmo=0; r.invuln=0; r.maxHp=200; r.hp=200; const fhp0=r.hp;
  hurtPlayer(r, 40, -1, true);
  if(r.vehicle) throw new Error('did not fall off vehicle when hit');
  if(r.hp>=fhp0) throw new Error('fall-off dealt no damage to player');
  if(r.state!=='down') throw new Error('did not tumble on fall-off (state='+r.state+')');
  console.log('FALL-OFF ON HIT OK (落馬, dmg='+(fhp0-r.hp)+' from raw 40 hit)');
  // usage time limit -> auto dismount
  r.state='idle'; r.z=0; r.invuln=0; hitStop=0; slowmo=0; vehicles.length=0;
  spawnVehicle(r.x,'horse'); r.in.pressed.grab=true; useInput(r.in); tryMount(); r.in.pressed.grab=false;
  if(r.vehicle!=='horse') throw new Error('failed to remount for time test');
  if(!(r.vehT>0)) throw new Error('vehT (usage time) not set on mount');
  r.vehT=3; player=r; useInput(r.in); r.in.keys={};
  let tdrop=false; for(let i=0;i<8 && !tdrop;i++){ hitStop=0; step(1); if(!r.vehicle) tdrop=true; }
  if(!tdrop) throw new Error('vehicle did not auto-dismount at time limit');
  console.log('TIME-LIMIT AUTO-DISMOUNT OK (dur horse='+VEHDEF.horse.dur+'f, buggy='+VEHDEF.buggy.dur+'f)');
  // buggy bazooka attack
  hitStop=0; slowmo=0;
  vehicles.length=0; spawnVehicle(r.x, 'buggy'); r.in.pressed.grab=true; useInput(r.in); tryMount(); r.in.pressed.grab=false;
  if(r.vehicle!=='buggy') throw new Error('failed to mount buggy');
  projectiles.length=0; enemies.length=0; spawnEnemy('wolf', r.x+170, r.y); const be=enemies[0]; be.thinkCd=9999; be.hp=be.maxHp=9999; const beh0=be.hp;
  player=r; useInput(r.in); r.in.keys={}; hitStop=0; slowmo=0; r.in.pressed.atk=true; step(1);
  if(!projectiles.some(pr=>pr.owner==='player'&&pr.blast)) throw new Error('bazooka fired no blast projectile');
  for(let i=0;i<44;i++){ hitStop=0; slowmo=0; step(1); }
  if(be.hp>=beh0) throw new Error('bazooka blast did not damage enemy');
  console.log('BUGGY BAZOOKA OK (blast dmg='+(beh0-be.hp)+')');
  // manual dismount
  r.in.keys={}; hitStop=0; slowmo=0; r.in.pressed.grab=true; step(3);
  if(r.vehicle) throw new Error('manual dismount failed');
  console.log('BUGGY MANUAL DISMOUNT OK');

  // ===== 6b) bazooka reliably HITS a SHORT enemy (was flying over) & explodes =====
  setupRoster('inu'); startGame(); state='play'; const bz=players[0]; player=bz; bz.x=400; bz.hp=bz.maxHp=99999; bz.lives=99;
  vehicles.length=0; enemies.length=0; projectiles.length=0;
  spawnVehicle(bz.x,'buggy'); bz.in.pressed.grab=true; useInput(bz.in); tryMount(); bz.in.pressed.grab=false;
  spawnEnemy('corgi', bz.x+150, bz.y); const cg=enemies[0]; cg.thinkCd=9999; cg.hp=cg.maxHp=9999;   // corgi h=60 (shorter than old zz=60)
  if(ETYPE.corgi.h>60) throw new Error('test assumes corgi is short');
  player=bz; useInput(bz.in); bz.in.keys={}; hitStop=0; slowmo=0; bz.in.pressed.atk=true; step(1);
  let sawExplosion=false, hh=cg.hp;
  for(let i=0;i<40;i++){ hitStop=0; slowmo=0; const before=projectiles.length; step(1); if(cg.hp<hh){ sawExplosion=true; } }
  if(cg.hp>=9999) throw new Error('BAZOOKA still whiffs a short enemy (no hit detection)');
  console.log('BAZOOKA HIT+EXPLODE OK (short enemy corgi h='+ETYPE.corgi.h+', dmg='+(9999-cg.hp)+')');

  // ===== 6c) random zako spawns vary across playthroughs =====
  const fixed=[['wolf',1],['corgi',1],['ari',1]];
  const seen=new Set();
  for(let t=0;t<40;t++){ randomizeZako(fixed).forEach(([ty])=>seen.add(ty)); }
  if(seen.size<6) throw new Error('zako randomization not varied enough ('+seen.size+' species)');
  if(!seen.has('zombiewan')&&!seen.has('skeletwan')&&!seen.has('mechawan')) throw new Error('new foes never appear in random zako');
  console.log('RANDOM ZAKO OK ('+seen.size+' distinct species across 40 rolls, incl. new foes)');

  // ===== 6d) character-exclusive charms =====
  const charmIds=Object.keys(CHARMS);
  if(charmIds.length<8) throw new Error('too few charms ('+charmIds.length+')');
  const byWho={}; charmIds.forEach(id=>{ (byWho[CHARMS[id].who]=byWho[CHARMS[id].who]||[]).push(id); });
  ['inu','shima','nuko','guard8'].forEach(k=>{ if(!byWho[k]||byWho[k].length<2) throw new Error(k+' has fewer than 2 charms'); });
  // canPick gating + apply buffs
  setupRoster('nuko'); startGame(); state='play'; const nk=players[0]; player=nk;
  const nkCharm=charmDropKind(); if(!nkCharm||CHARMS[nkCharm].who!=='nuko') throw new Error('charmDropKind gave wrong char charm');
  if(canPick(players[0], 'inuBlade')) throw new Error('nuko can pick inu charm (should be exclusive)');
  if(!canPick(players[0], 'nukoOrb')) throw new Error('nuko cannot pick own charm');
  const natk0=nk.atkMul; CHARMS.nukoOrb.apply(nk); if(!(nk.atkMul>natk0)) throw new Error('nukoOrb did not buff');
  const dim0=nk.dimMax; CHARMS.nukoMoon.apply(nk); if(!(nk.dimMax>dim0)) throw new Error('nukoMoon did not add ult stock');
  console.log('CHARMS OK ('+charmIds.length+' items: '+Object.keys(byWho).map(k=>k+'×'+byWho[k].length).join(', ')+')');

  // ===== 7) open-world integration: new enemies referenced in fields + vehicles spawned =====
  const flat=JSON.stringify(SEGS)+JSON.stringify(FINAL_CH);
  if(!/zombiewan/.test(flat) || !/skeletwan/.test(flat) || !/mechawan/.test(flat)) throw new Error('new enemies not placed in world fields');
  // load a field and confirm vehicles get spawned
  setupRoster('inu'); startGame();
  const node=WORLD_LEVELS.find(l=>l.id==='mori')||WORLD_LEVELS[3];
  loadLevel(node);
  if(vehicles.length<1) throw new Error('loadLevel spawned no vehicles');
  console.log('WORLD INTEGRATION OK (fields reference new foes; '+vehicles.length+' vehicle(s) placed in '+node.id+')');

  // ===== 8) regression: play through a couple fields, no runtime errors =====
  for(const kind of ['inu','nuko','guard8']){
    setupRoster(kind); startGame(); const g=players[0]; let frames=0, fieldsSeen=new Set();
    while(fieldsSeen.size<2 && frames<40000){ if(curLevelId&&state==='play') fieldsSeen.add(curLevelId); frames++;
      if(state==='cut') cutAdvance=true;
      else if(state==='shop'){ if(frames%3===0) exitShop(); }
      else if(state==='map'){ g.in.keys={}; mapKeysFor(0);   // プレイ中の押しっぱなしを持ち込まない（カーソルが勝手に動く）
        const nodes=allMapNodes(); for(let i=0;i<nodes.length;i++){ if(nodeSelectable(nodes[i])){ mapSel=i; break; } } g.in.pressed.atk=true; }
      else if(state==='branch'){ branchSel=0; confirmBranch(); }
      else if(state==='talk'){ if(frames%4===0) g.in.pressed.atk=true; }
      else if(state==='play'){
        enemies.forEach(e=>{ if(!e.dead) damageEnemy(e, 200, 2, false, 0); });
        g.in.keys['ArrowRight']=true; mapKeysFor(0);
        if(g.z<=0 && (overPit(g.x+70)||overPit(g.x+30))) g.in.pressed.jump=true;
        if(aliveCount()===0 && g.z<=0 && (g.state==='idle'||g.state==='walk')){ const n=npcs.find(n=>!n.hidden&&!n.done&&Math.abs(g.x-n.x)<60); if(n&&!n._t){ g.in.pressed.grab=true; n._t=1; } }
        g.hp=g.maxHp; g.lives=9;
      }
      if(global.rafCb){ const cb=global.rafCb; global.rafCb=null; cb(); }
      if(frames%2500===0) await new Promise(rr=>setTimeout(rr,1));
    }
    if(fieldsSeen.size<2) throw new Error(kind+' run stalled, fields='+fieldsSeen.size);
    console.log(kind+' RUN OK (fields='+fieldsSeen.size+', frames='+frames+')');
  }

  console.log('OPEN-WORLD RPG TEST PASSED'); process.exit(0);
})().catch(e=>{ console.error('FAIL:', e.message, e.stack); process.exit(1); });
`;
code = code + "\n;" + DRIVER;
(0, eval)(code);

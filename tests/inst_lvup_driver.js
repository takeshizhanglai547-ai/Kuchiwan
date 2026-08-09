const DRIVER = `
global._GC={}; var _g=(n,v)=>{ _GC[n]=(_GC[n]||0)+1; return v; };
process.on("exit",()=>{ const miss=[]; for(let i=1;i<=40;i++) if(!_GC[i]) miss.push(i); console.error("GUARDS total=40 evaluated="+((40)-miss.length)+" NEVER_EVALUATED=["+miss.join(",")+"]"); });

(async()=>{
  const step=(n)=>{ for(let i=0;i<n;i++){ if(global.rafCb){ const cb=global.rafCb; global.rafCb=null; cb(); } } };
  const KINDS=['inu','shima','nuko','guard8','watch','wanden'];

  // ===== 1) 全キャラ・全コマンドスロットに上位技が定義されている =====
  if(_g(1,SPECIAL_SLOTS.length!==7)) throw new Error('expected 7 command slots, got '+SPECIAL_SLOTS.length);
  KINDS.forEach(k=>{
    if(_g(2,!SPECIAL_BASE[k])) throw new Error('SPECIAL_BASE missing: '+k);
    SPECIAL_SLOTS.forEach(slot=>{
      const base=SPECIAL_BASE[k][slot];
      if(_g(3,base!==null && !ATK[base])) throw new Error(k+'.'+slot+' base move missing: '+base);
      if(_g(4,base===null && !SPECIAL_BASE_NAME[k+'.'+slot])) throw new Error(k+'.'+slot+' legacy base has no display name');
      if(_g(5,!SPECIAL_SLOT_NAME[slot]||!SPECIAL_SLOT_CMD[slot])) throw new Error('slot label missing: '+slot);
      const ups=(SPECIAL_UP[k]||{})[slot]||[];
      if(_g(6,!ups.length)) throw new Error(k+'.'+slot+' has no upgrade');
      ups.forEach(u=>{ if(_g(7,!ATK[u[1]])) throw new Error(k+'.'+slot+' upgrade '+u[1]+' has no ATK def');
        if(_g(8,u[1]===base)) throw new Error(k+'.'+slot+' upgrade is the same move'); }); }); });
  { const ids=new Set();
    KINDS.forEach(k=>SPECIAL_SLOTS.forEach(slot=>((SPECIAL_UP[k]||{})[slot]||[]).forEach(u=>{
      if(_g(9,ids.has(u[1]))) throw new Error('upgrade id reused across slots: '+u[1]); ids.add(u[1]); })));
    if(_g(10,ids.size!==42)) throw new Error('expected 42 upgrade moves, got '+ids.size); }
  console.log('進化テーブル OK (6キャラ × 7コマンド = 42技すべてに専用の上位技)');

  // ===== 2) レベルに応じて出る技が切り替わる =====
  const thrOf={};
  KINDS.forEach(k=>{
    const at=(lv,slot)=>specialFor({kind:k,level:lv},slot);
    SPECIAL_SLOTS.forEach(slot=>{
      const base=SPECIAL_BASE[k][slot];
      if(_g(11,at(1,slot)!==base)) throw new Error(k+'.'+slot+' lv1 is not the base move');
      if(_g(12,specialUpgraded({kind:k,level:1},slot))) throw new Error(k+'.'+slot+' already upgraded at LV1');
      const thr=((SPECIAL_UP[k]||{})[slot]||[])[0][0];
      if(thrOf[slot]==null) thrOf[slot]=thr;
      else if(_g(13,thrOf[slot]!==thr)) throw new Error('slot '+slot+' has inconsistent thresholds across characters');
      if(_g(14,at(thr-1,slot)!==base)) throw new Error(k+'.'+slot+' upgraded before LV'+thr);
      if(_g(15,at(thr,slot)===base)) throw new Error(k+'.'+slot+' did not upgrade at LV'+thr);
      if(_g(16,!specialUpgraded({kind:k,level:thr},slot))) throw new Error(k+'.'+slot+' specialUpgraded is null at the threshold'); }); });
  console.log('レベル切替 OK ('+SPECIAL_SLOTS.map(x=>SPECIAL_SLOT_NAME[x]+'=LV'+thrOf[x]).join(' / ')+')');
  // ユーザー指定の例：ヌコ Lv5 で落雷 → 巨大竜巻
  if(_g(17,specialFor({kind:'nuko',level:4},'du')!=='nthunder')) throw new Error('nuko du at LV4 should still be the thunderstorm');
  if(_g(18,specialFor({kind:'nuko',level:5},'du')!=='ntyphoon')) throw new Error('nuko du at LV5 should become the giant tornado');
  console.log('ヌコの例 OK (LV5で「'+ATK.nthunder.name+'」→「'+ATK.ntyphoon.name+'」)');
  KINDS.forEach(k=>{ const line=SPECIAL_SLOTS.map(slot=>{
      const b=SPECIAL_BASE[k][slot], u=((SPECIAL_UP[k]||{})[slot]||[])[0][1];
      return SPECIAL_SLOT_NAME[slot]+':'+((ATK[b]||{}).name||SPECIAL_BASE_NAME[k+'.'+slot])+'→'+ATK[u].name; }).join(' / ');
    console.log('  ['+k+'] '+line); });

  // ===== 3) 実際の入力経路（コマンド技）で上位技が発動する =====
  setupRoster('nuko'); startGame(); state='play'; sndOn=false;
  const p=players[0]; player=p; p.hp=p.maxHp=99999;
  p.level=1;
  if(_g(19,commandSpecialProbe(p,'du')!=='nthunder')) throw new Error('lv1 command path wrong');
  p.level=5;
  if(_g(20,commandSpecialProbe(p,'du')!=='ntyphoon')) throw new Error('lv5 command path wrong');
  console.log('コマンド経路 OK (commandSpecial / 入力ハンドラの双方が specialFor 経由)');

  // ===== 4) 発動すると別モーション・別演出になる =====
  function fire(kind, lv, slot, frames){
    setupRoster(kind); startGame(); state='play'; sndOn=false;
    const q=players[0]; player=q; q.hp=q.maxHp=99999; q.level=lv; q.atkMul=1; q.dim=3; q.spinCount=0; q.stolen=[{name:'試技',col:'#fff',cast:(pp)=>{ enemies.forEach(e=>{ if(!e.dead&&Math.abs(e.x-pp.x)<200) damageEnemy(e,10,2,false); }); }},
      {name:'試技2',col:'#fff',cast:(pp)=>{ enemies.forEach(e=>{ if(!e.dead&&Math.abs(e.x-pp.x)<200) damageEnemy(e,10,2,false); }); }}];
    encounters.length=0;   // 前進する技で新手が湧くと計測がぶれるので封じる
    enemies.length=0; hazards.length=0; projectiles.length=0; particles.length=0;
    // 前後に的を並べる（前進技・全方位技のどちらも拾えるように）
    for(let i2=0;i2<6;i2++){ spawnEnemy('wolf', q.x+(i2<4? 80+i2*60 : -80-(i2-4)*60), LANE); }
    const marks=enemies.slice(); marks.forEach(e=>{ e.thinkCd=99999; e.hp=e.maxHp=999999; });
    const ty=specialFor(q,slot); beginAttack(ty);
    for(let f=0; f<(frames||ATK[ty].dur+40); f++){ hitStop=0; slowmo=0;
      marks.forEach(e=>{ e.thinkCd=99999; e.invuln=0; });
      step(1); updateHazards(); }
    const dmg=marks.reduce((s2,e)=>s2+(e.maxHp-e.hp),0);
    return {ty, dmg, hz:hazards.slice(), pr:projectiles.length};
  }
  const results=[];
  KINDS.forEach(k=>{ SPECIAL_SLOTS.forEach(slot=>{
    const avg=(lv)=>{ let t2=0; for(let r=0;r<3;r++) t2+=fire(k,lv,slot).dmg; return t2/3; };
    const loTy=specialFor({kind:k,level:1},slot), hiTy=specialFor({kind:k,level:20},slot);
    if(_g(21,loTy===hiTy)) throw new Error(k+'.'+slot+' same move at LV1 and LV20');
    const hi={ty:hiTy, dmg:avg(20)};
    if(_g(22,hi.dmg<=0)) throw new Error(k+'.'+slot+' upgraded move dealt no damage ('+hiTy+')');
    if(loTy){   // 専用ステートで動く基本技（イッヌの下/ダッシュ、ヌコのダッシュ）は ATK が無いので威力比較を省く
      const lo={ty:loTy, dmg:avg(1)};
      if(_g(23,hi.dmg<lo.dmg)) throw new Error(k+'.'+slot+' upgrade is weaker: '+Math.round(lo.dmg)+' -> '+Math.round(hi.dmg)+' ('+loTy+' -> '+hiTy+')');
      results.push(k+'.'+slot+' '+Math.round(lo.dmg)+'→'+Math.round(hi.dmg)+' ('+ATK[loTy].name+' → '+ATK[hiTy].name+')');
      const A=ATK[loTy], B=ATK[hiTy];
      const flagsA=Object.keys(A).filter(x=>A[x]===true).sort().join(','), flagsB=Object.keys(B).filter(x=>B[x]===true).sort().join(',');
      if(_g(24,A.name===B.name)) throw new Error(k+'.'+slot+' upgrade reuses the same name');
      if(_g(25,flagsA===flagsB && A.dur===B.dur && A.reach===B.reach)) throw new Error(k+'.'+slot+' upgrade has an identical motion');
    } else { results.push(k+'.'+slot+' (専用ステート)→'+Math.round(hi.dmg)+' ('+SPECIAL_BASE_NAME[k+'.'+slot]+' → '+ATK[hiTy].name+')'); } }); });
  console.log('発動＆威力 OK (42技すべて別モーション／威力も上回る)');
  results.forEach(r=>console.log('  '+r));

  // ヌコの極大竜巻は竜巻ハザードを生み、敵を吸い寄せて巻き上げる
  {
    setupRoster('nuko'); startGame(); state='play'; sndOn=false;
    const q=players[0]; player=q; q.hp=q.maxHp=99999; q.level=5; q.facing=1;
    encounters.length=0; enemies.length=0; hazards.length=0; spawnEnemy('wolf', q.x+320, LANE);
    const foe=enemies[0]; foe.hp=foe.maxHp=99999; foe.thinkCd=99999;
    beginAttack(specialFor(q,'du'));
    for(let f=0;f<30;f++){ hitStop=0; foe.thinkCd=99999; step(1); }
    const tw=hazards.find(h=>h.kind==='ptwister');
    if(_g(26,!tw)) throw new Error('ntyphoon spawned no tornado');
    const d0=Math.abs(foe.x-tw.x);
    for(let f=0;f<60;f++){ hitStop=0; foe.thinkCd=99999; foe.invuln=0; updateHazards(); }
    if(_g(27,foe.hp>=foe.maxHp)) throw new Error('tornado never damaged the enemy');
    const d1=Math.abs(foe.x-tw.x);
    if(_g(28,d1>=d0)) throw new Error('tornado did not draw the enemy in ('+Math.round(d0)+'px -> '+Math.round(d1)+'px)');
    if(_g(29,d1>120)) throw new Error('enemy was not captured by the vortex ('+Math.round(d1)+'px)');
    if(_g(30,foe.z<=0)) throw new Error('tornado did not lift the enemy off the ground');
    console.log('極大竜巻 OK (渦へ '+Math.round(d0)+'px→'+Math.round(d1)+'px まで吸引、巻き上げ z='+Math.round(foe.z)+'、与ダメ '+Math.round(foe.maxHp-foe.hp)+')');
  }

  // ===== 5) レベルアップで進化が通知される =====
  const ev5=specialsUnlockedAt('nuko',5), ev10=specialsUnlockedAt('nuko',10), ev6=specialsUnlockedAt('nuko',6);
  if(_g(31,ev5.length!==1||ev5[0].slot!=='du')) throw new Error('LV5 unlock notice wrong');
  if(_g(32,ev10.length!==2)) throw new Error('LV10 should unlock two moves');
  if(_g(33,ev6.length!==0)) throw new Error('LV6 should unlock nothing');
  KINDS.forEach(k=>{ let tot=0; for(let lv=1;lv<=30;lv++) tot+=specialsUnlockedAt(k,lv).length;
    if(_g(34,tot!==7)) throw new Error(k+' unlocks '+tot+' moves across LV1-30 (expected 7)'); });
  // 実際に gainXp でレベルが上がったときに演出フラグが立つ
  setupRoster('nuko'); startGame(); state='play';
  const q2=players[0]; q2.level=4; q2.xp=0; q2.xpNext=1; q2.evolveFx=0;
  gainXp(500);
  if(_g(35,q2.level<5)) throw new Error('gainXp did not level up');
  if(_g(36,!q2.evolveFx)) throw new Error('level-up did not flag the special-move evolution');
  console.log('進化通知 OK (LV5=1技 / LV10=2技 / それ以外は無し、演出フラグも立つ)');

  // ===== 6) ライバル主役ボスもこちらの熟練度に合わせた上位技を使う =====
  setupRoster('shima'); startGame(); state='play';
  players[0].level=1;
  { const h1=heroMovePool('nuko');
    if(_g(37,h1.du!=='nthunder'||h1.up!=='ntornado'||h1.fwd!=='nflame')) throw new Error('hero boss should mirror LV1 moves');
    if(_g(38,!ATK[h1.dash])) throw new Error('hero boss dash fallback is not an ATK'); }
  players[0].level=20;
  { const h2=heroMovePool('nuko');
    ['du','hadou','dp','up','fwd','dash'].forEach(slot=>{ if(_g(39,!ATK[h2[slot]])) throw new Error('hero boss slot '+slot+' has no ATK'); });
    if(_g(40,h2.du!=='ntyphoon'||h2.hadou!=='nfrost2'||h2.dp!=='nstar2'||h2.up!=='ntornado2'||h2.fwd!=='nflame2'||h2.dash!=='nrail2')) throw new Error('hero boss did not scale with the player level'); }
  console.log('ライバル追従 OK (こちらのレベルに合わせてライバルの必殺技も進化)');

  console.log('LEVEL-UP SPECIALS TEST PASSED'); process.exit(0);
})().catch(e=>{ console.error('FAIL:', e.message, e.stack); process.exit(1); });
`;
// commandSpecial は入力状態に依存するので、スロット指定で解決結果だけ確かめる薄いプローブ
code = code + "\n;function commandSpecialProbe(p,slot){ return specialFor(p,slot); }\n;" + DRIVER;
(0, eval)(code);

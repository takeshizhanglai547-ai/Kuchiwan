// ボス戦の実難易度を測る道具。runall.sh には入れていない（1回およそ5分）。
//
//   f=$(mktemp /tmp/b_XXXX.js); cat tests/nm_head.js tests/boss_difficulty_probe.js > $f; node $f; rm -f $f
//
// デモAIをボス1体と差し向け、被ダメージ・与ダメージ・撃破所要フレームを測る。
// difficulty_probe.js と同じ注意が要る（毎フレーム満タンへ戻す／乱数を固定する／
// デモAI基準なので比だけを見る）ほか、ボス戦ならではの落とし穴が1つある：
//   召喚された取り巻きへの与ダメを混ぜると、ハデスだけ火力が5倍に見える。
//   ボス本体への分だけを数えること。
//
// 2026-08-11 の実測（三周目のボス: 被ダメ286/1000F・撃破所要 4292〜6261F）
//   ポセイドン 被ダメ579 撃破12492F ／ ハデス 902/11941F ／ ゼウス 767/12510F
const DRIVER = `
(async()=>{
  const step=(n)=>{ for(let i=0;i<n;i++){ if(global.rafCb){ const cb=global.rafCb; global.rafCb=null; cb(); } } };
  sndOn=false;
  const realRandom=Math.random;
  function seed(a){ return function(){ a|=0; a=a+0x6D2B79F5|0;
    let t=Math.imul(a^a>>>15,1|a); t=t+Math.imul(t^t>>>7,61|t)^t;
    return ((t^t>>>14)>>>0)/4294967296; }; }
  // ボス1体と AI を差し向け、被ダメージと撃破までの時間を測る。
  // AI の自動回復は毎フレーム満タンへ戻して無効化し、被弾の総量だけを数える
  function fight(boss, L, sd, frames){
    Math.random=seed(sd);
    setupRoster('inu'); startGame(); state='play'; lap=L;
    const p=players[0]; player=p; p.x=camX+280; p.hp=p.maxHp=800; p.invuln=0; p.lives=99; p.level=20;
    enemies.length=0; encounters.length=0; particles.length=0; hazards.length=0;
    attractOn=true;
    spawnEnemy(boss, p.x+300, LANE);
    const e=enemies[0]; e.thinkCd=0;
    const hp0=e.hp;
    let dmg=0,hits=0,stunF=0,kill=-1,dealt=0; const byMove={};
    const rh=hurtPlayer, rd=damageEnemy;
    hurtPlayer=function(q,d0,dir,kd,cls,iv){ const t2=q||player,b=t2.hp;
      const r=rh.apply(null,arguments); const d=b-t2.hp;
      if(d>0){ dmg+=d; hits++; const m=(e.state==='bmove'||e.state==='bwind')?(e.moveName||'-'):'通常';
        byMove[m]=(byMove[m]||0)+d; } return r; };
    // 召喚された亡者への与ダメが混ざると、ハデスだけ火力が5倍に見える。ボス本体だけを数える
    damageEnemy=function(x,d0){ const b=x.hp; const r=rd.apply(null,arguments);
      if(x===e) dealt+=Math.max(0,b-x.hp); return r; };
    try {
      for(let f=0; f<frames; f++){
        hitStop=0; slowmo=0; step(1);
        p.hp=p.maxHp;
        if(kill<0 && (e.dead||e.hp<=0)) kill=f;
        const st=p.state; if(st==='hurt'||st==='down'||st==='getup') stunF++;
        if(kill>=0) break; }
    } finally { hurtPlayer=rh; damageEnemy=rd; attractOn=false; Math.random=realRandom; }
    const dur=(kill<0?frames:kill);
    return {boss:boss,dur:dur,killed:kill>=0,dmg:dmg,hits:hits,stunF:stunF,
            hp0:hp0,dealt:dealt,byMove:byMove};
  }
  const F=6000, SEEDS=[7,19,31];
  const ROWS=[['poseidon',4],['hades',4],['zeus',4]];
  const agg=[];
  ROWS.forEach(function(r){
    const rs=SEEDS.map(function(sd){ return fight(r[0],r[1],sd,F); });
    const s=function(f){ return rs.reduce(function(a,x){ return a+f(x); },0); };
    const dur=s(function(x){return x.dur;}), dmg=s(function(x){return x.dmg;});
    const mv={}; rs.forEach(function(x){ for(const k in x.byMove) mv[k]=(mv[k]||0)+x.byMove[k]; });
    const top=Object.keys(mv).sort(function(a,b){return mv[b]-mv[a];}).slice(0,3)
      .map(function(k){ return k+':'+Math.round(mv[k]/dmg*100)+'%'; }).join(' ');
    agg.push({name:r[0], lap:r[1], dur:dur/rs.length, dmg:dmg/dur*1000,
      killed:rs.filter(function(x){return x.killed;}).length, n:rs.length,
      hits:s(function(x){return x.hits;})/dur*1000, stun:s(function(x){return x.stunF;})/dur*100,
      dps:s(function(x){return x.dealt;})/dur*1000,
      hp0:rs[0].hp0, top:top}); });
  agg.forEach(function(a){
    console.log(('周'+a.lap+' '+a.name+'            ').slice(0,17)
      +' HP'+String(Math.round(a.hp0)).padStart(5)
      +'  撃破 '+a.killed+'/'+a.n+' 平均'+String(Math.round(a.dur)).padStart(4)+'F'
      +'  被ダメ '+String(Math.round(a.dmg)).padStart(4)+'/1000F'
      +'  被弾 '+a.hits.toFixed(1).padStart(4)
      +'  硬直 '+a.stun.toFixed(1).padStart(4)+'%'
      +'  与ダメ '+String(Math.round(a.dps)).padStart(4)+'/1000F'
      +'  この火力での撃破所要 '+String(Math.round(a.hp0/Math.max(1,a.dps)*1000)).padStart(6)+'F'); });
  const av=function(A,f){ return A.reduce(function(s2,x){return s2+f(x);},0)/A.length; };
  console.log('--- 三周目のボス（別測定）: 被ダメ 286/1000F・撃破所要 4292〜6261F ---');
  console.log('神の平均: 被ダメ '+Math.round(av(agg,function(x){return x.dmg;}))+'/1000F'
    +' = 三周目の '+(av(agg,function(x){return x.dmg;})/286).toFixed(2)+'倍'
    +' / 撃破所要 '+Math.round(av(agg,function(x){return x.hp0/Math.max(1,x.dps)*1000;}))+'F');
  process.exit(0);
})().catch(e=>{ console.error('FAIL:', e.message, e.stack); process.exit(1); });
`;
code = code + "\n;" + DRIVER;
(0, eval)(code);

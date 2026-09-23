// 周回どうしの「難しさ」を決定論で比べる道具。runall.sh には入れていない。
//
//   f=$(mktemp /tmp/p_XXXX.js); cat tests/nm_head.js tests/pressure_probe.js > $f; node $f; rm -f $f
//
// difficulty_probe.js（デモAIに戦わせる）は種ごとの振れが3.4倍あり、
// 12種回しても 10〜20% の差を判定できなかった。実際それで
// 「六周目が0.85〜1.67倍で未収束」という誤った読みをしていた。
// こちらは主役を動かさず（AIの運を混ぜない）、乱数も固定して2つを測る：
//   1体の脅威 ＝ その敵が1000フレームで通せるダメージ（間合い4点の最大）
//   集団の圧   ＝ 決まった配置の6体が1000フレームで通すダメージ
// 同時攻撃数（squadCap）や思考の速さの効きは「集団の圧」にだけ出る。
const DRIVER = `
(async()=>{ sndOn=false;
  const step=(n)=>{ for(let i=0;i<n;i++){ if(global.rafCb){ const cb=global.rafCb; global.rafCb=null; cb(); } } };
  const seedRandom=function(sd){ let x=sd>>>0;
    Math.random=function(){ x=(x*1664525+1013904223)>>>0; return x/4294967296; }; };
  const realRandom=Math.random;
  const POOL={1:ZAKO_POOL, 2:BUG_ZAKO_POOL, 3:ALIEN_ZAKO_POOL,
              4:MYTH_ZAKO_POOL, 5:SENGOKU_ZAKO_POOL, 6:MECHA_ZAKO_POOL};
  const LAPS=(process.env.NM_LAPS||'5,6').split(',').map(Number);

  // ── 1体の脅威 ──
  const T_FR=900;
  const threatOf=function(kind, L){
    let best=0;
    for(const D of [50, 90, 150, 240]){
      seedRandom(20260923);
      setupRoster('inu'); startGame(); state='play'; gimOn=false; lap=L;
      const p=players[0]; player=p; p.hp=p.maxHp=999999; p.invuln=0; p.level=20;
      p.x=600; p._tx=null; p.z=0;
      enemies.length=0; projectiles.length=0; hazards.length=0; particles.length=0;
      spawnEnemy(kind, 600+D, LANE);
      const e=enemies[0]; if(!e) return 0;
      e.entry=null; e.hp=e.maxHp=999999;
      let dmg=0; const rh=hurtPlayer;
      hurtPlayer=function(q){ const t=q||player, b=t.hp; const r=rh.apply(null,arguments);
        if(t===p) dmg+=Math.max(0,b-t.hp); return r; };
      try { for(let f=0; f<T_FR; f++){ hitStop=0; slowmo=0;
          p.hp=p.maxHp; p.invuln=0; p.state='idle'; p.vx=0; p.z=0;
          p.x=600; e.x=600+D; e.y=p.y; e.stun=0;
          if(e.thinkCd>6) e.thinkCd=6;               // 迷わず仕掛けさせる
          step(1); } }
      finally { hurtPlayer=rh; }
      if(dmg>best) best=dmg; }
    Math.random=realRandom;
    return best/T_FR*1000; };

  // ── 集団の圧 ──
  const P_FR=1500, SEEDS=[3,7,11,19,23,29,31,37];
  const pressOf=function(L, sd){
    seedRandom(sd);
    setupRoster('inu'); startGame(); state='play'; gimOn=false; lap=L;
    const p=players[0]; player=p; p.hp=p.maxHp=999999; p.invuln=0; p.level=20;
    p.x=600; p._tx=null; p.z=0;
    enemies.length=0; projectiles.length=0; hazards.length=0; particles.length=0;
    const P=POOL[L], OFF=[-230,-150,-80,80,150,230];
    for(let i=0;i<OFF.length;i++){ spawnEnemy(P[(i*7+sd)%P.length], 600+OFF[i], LANE);
      const e=enemies[enemies.length-1]; e.entry=null; e.hp=e.maxHp=999999; }
    let dmg=0; const rh=hurtPlayer;
    hurtPlayer=function(q){ const t=q||player, b=t.hp; const r=rh.apply(null,arguments);
      if(t===p) dmg+=Math.max(0,b-t.hp); return r; };
    try { for(let f=0; f<P_FR; f++){ hitStop=0; slowmo=0;
        p.hp=p.maxHp; p.invuln=0; p.state='idle'; p.vx=0; p.z=0; p.x=600;
        enemies.forEach(function(e){ if(!e.dead){ e.stun=0; e.hp=e.maxHp; } });
        step(1); } }
    finally { hurtPlayer=rh; Math.random=realRandom; }
    return dmg/P_FR*1000; };

  const res={};
  for(const L of LAPS){
    const rows=POOL[L].map(function(k){ return {k:k, th:threatOf(k,L), hp:ETYPE[k].hp}; });
    const mean=function(f){ return rows.reduce(function(a,r){ return a+f(r); },0)/rows.length; };
    const v=SEEDS.map(function(sd){ return pressOf(L,sd); });
    const pm=v.reduce(function(a,b){return a+b;},0)/v.length;
    res[L]={th:mean(function(r){return r.th;}), hp:mean(function(r){return r.hp;}), press:pm, each:v};
    console.log('周'+L+'  '+rows.length+'種'
      +'  1体の脅威 '+res[L].th.toFixed(0)+'/1000F'
      +'  集団の圧 '+pm.toFixed(0)+'/1000F'
      +'  素のHP平均 '+res[L].hp.toFixed(0));
    console.log('        種ごとの圧 '+v.map(function(x){return x.toFixed(0);}).join('/')); }
  if(LAPS.length>=2){
    const a=res[LAPS[0]], b=res[LAPS[1]];
    console.log('---');
    console.log('周'+LAPS[1]+'/周'+LAPS[0]+'： 1体の脅威 '+(b.th/a.th).toFixed(2)+'倍'
      +' / 集団の圧 '+(b.press/a.press).toFixed(2)+'倍'
      +' / 素のHP '+(b.hp/a.hp).toFixed(2)+'倍'); }
  process.exit(0);
})().catch(e=>{ console.error('FAIL:', e.message, e.stack); process.exit(1); });
`;
code = code + "\n;" + DRIVER;
(0, eval)(code);

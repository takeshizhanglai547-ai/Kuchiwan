// 周回ごとの実難易度を測る道具。runall.sh には入れていない（1回およそ8分かかる）。
//
//   f=$(mktemp /tmp/d_XXXX.js); cat tests/nm_head.js tests/difficulty_probe.js > $f; node $f; rm -f $f
//
// デモAI（attractAI）に戦わせ、被ダメージ・被弾回数・硬直時間・撃破速度を
// 三周目と四周目で突き合わせる。注意点が3つある：
//   1. attractAI は瀕死で全快するので、毎フレーム満タンへ戻して安全網を無効化する
//   2. 乱数を固定しないと同じ設定で数値が倍近く振れる（湧きもAIの選択も乱数）
//   3. デモAIはガードも回避もしない。絶対値ではなく「三周目との比」だけを見ること
const DRIVER = `
(async()=>{
  const step=(n)=>{ for(let i=0;i<n;i++){ if(global.rafCb){ const cb=global.rafCb; global.rafCb=null; cb(); } } };
  sndOn=false;
  // AI の自動回復（瀕死で全快）が計測を壊すので、毎フレーム満タンへ戻して
  // 「常に健康な相手にどれだけ通したか」を数える。回復分は計上しない
  // 実行ごとに数値が倍近く振れたので乱数を固定する。
  // 同じ種で三周目と四周目を走らせれば、湧きもAIの選択も同じ列になる
  const realRandom=Math.random;
  function seed(a){ return function(){ a|=0; a=a+0x6D2B79F5|0;
    let t=Math.imul(a^a>>>15,1|a); t=t+Math.imul(t^t>>>7,61|t)^t;
    return ((t^t>>>14)>>>0)/4294967296; }; }
  function run(L, frames, sd){
    Math.random=seed(sd);
    setupRoster('inu'); startGame(); state='play'; lap=L;
    if(L>=4) buildEncounters4();
    const p=players[0]; player=p;
    p.level=20; p.hp=p.maxHp=800; p.invuln=0; p.lives=99;
    enemies.length=0; encounters.length=0; particles.length=0;
    attractOn=true;
    let dmg=0,hits=0,stunF=0,run2=0,maxStun=0,kills=0,dealt=0,down=0,foeHP=0,nFoe=0;
    const hist=[];
    const rh=hurtPlayer, rd=damageEnemy;
    hurtPlayer=function(q,d0,dir,kd,cls,iv){ const t=q||player,b=t.hp;
      const r=rh.apply(null,arguments); const d=b-t.hp;
      if(d>0){ dmg+=d; hits++; hist.push(d); if(kd) down++; } return r; };
    damageEnemy=function(e,d0){ const b=e.hp; const r=rd.apply(null,arguments);
      dealt+=Math.max(0,b-e.hp); if(e.dead&&!e.__c){ e.__c=1; kills++; } return r; };
    try {
      for(let f=0; f<frames; f++){
        while(enemies.filter(function(e){return !e.dead;}).length<5){
          const k=randZako(); spawnEnemy(k, p.x+((Math.random()<0.5)?-1:1)*(150+Math.random()*130), LANE);
          foeHP+=ETYPE[k].hp*diffHpMul(); nFoe++; }
        hitStop=0; slowmo=0; step(1);
        p.hp=p.maxHp;                        // 回復判定を踏ませない＝AIの安全網を無効化
        const st=p.state;
        if(st==='hurt'||st==='down'||st==='getup'){ stunF++; run2++; maxStun=Math.max(maxStun,run2); } else run2=0;
      }
    } finally { hurtPlayer=rh; damageEnemy=rd; attractOn=false; Math.random=realRandom; }
    hist.sort(function(a,b){return a-b;});
    return {L:L,dmg:dmg,hits:hits,stunF:stunF,maxStun:maxStun,kills:kills,dealt:dealt,
            down:down,frames:frames,med:hist[(hist.length/2)|0]||0,foeHP:foeHP/Math.max(1,nFoe)};
  }
  const F=8000, SEEDS=[11,22,33];
  const agg={};
  [3,4].forEach(function(L){
    const rs=SEEDS.map(function(sd){ return run(L,F,sd); });
    const sum=function(f){ return rs.reduce(function(a,r){ return a+f(r); },0); };
    agg[L]={L:L, frames:F*rs.length, dmg:sum(function(r){return r.dmg;}),
      hits:sum(function(r){return r.hits;}), stunF:sum(function(r){return r.stunF;}),
      kills:sum(function(r){return r.kills;}), down:sum(function(r){return r.down;}),
      maxStun:Math.max.apply(null,rs.map(function(r){return r.maxStun;})),
      foeHP:rs[0].foeHP, med:0,
      each:rs.map(function(r){ return Math.round(r.dmg/r.frames*1000); })};
    agg[L].med=Math.round(agg[L].dmg/agg[L].hits||0); });
  const out=[agg[3],agg[4]];
  out.forEach(function(r){ const k=1000/r.frames;
    console.log('周'+r.L
      +'  被ダメ '+(r.dmg*k).toFixed(0).padStart(4)+'/1000F'
      +'  被弾 '+(r.hits*k).toFixed(1).padStart(4)+'回'
      +'  一撃 '+String(r.med).padStart(3)
      +'  ダウン率 '+(r.down/Math.max(1,r.hits)*100).toFixed(0).padStart(3)+'%'
      +'  硬直 '+(r.stunF/r.frames*100).toFixed(1).padStart(4)+'%（最長'+r.maxStun+'F）'
      +'  撃破 '+(r.kills*k).toFixed(2)+'体/1000F'
      +'  敵HP平均 '+r.foeHP.toFixed(0)
      +'  種別 '+r.each.join('/')); });
  const a=out[0], b=out[1];
  console.log('---');
  console.log('四周目/三周目： 被ダメ '+(b.dmg/Math.max(1,a.dmg)).toFixed(2)+'倍'
    +' / 被弾回数 '+(b.hits/Math.max(1,a.hits)).toFixed(2)+'倍'
    +' / 一撃 '+(b.med/Math.max(1,a.med)).toFixed(2)+'倍'
    +' / 撃破速度 '+(b.kills/Math.max(1,a.kills)).toFixed(2)+'倍'
    +' / 硬直時間 '+(b.stunF/Math.max(1,a.stunF)).toFixed(2)+'倍');
  console.log('HP800なら、四周目は '+(b.dmg/800*(1000/b.frames)).toFixed(2)+'回/1000F、三周目は '+(a.dmg/800*(1000/a.frames)).toFixed(2)+'回/1000F の割合で力尽きる');
  process.exit(0);
})().catch(e=>{ console.error('FAIL:', e.message, e.stack); process.exit(1); });
`;
code = code + "\n;" + DRIVER;
(0, eval)(code);

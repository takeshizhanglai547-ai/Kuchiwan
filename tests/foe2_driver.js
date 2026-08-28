global.__HTML = html;
const DRIVER = `
(async()=>{
  const step=(n)=>{ for(let i=0;i<n;i++){ if(global.rafCb){ const cb=global.rafCb; global.rafCb=null; cb(); } } };
  const setup=function(){ setupRoster('inu'); startGame(); state='play'; gimOn=false;
    const p=players[0]; resetPlayer(p,true); player=p;
    p.hp=p.maxHp=99999; p.lives=9; p.invuln=99999; p.level=1;
    p.state='idle'; p.z=0; p.vz=0; p.atk=null; p.x=600; p._tx=null; p.facing=1;
    enemies.length=0; projectiles.length=0; encounters.length=0; particles.length=0;
    SWELLS.length=0;
    p.in.keys={}; p.in.K={}; for(const k in p.in.pressed) p.in.pressed[k]=false;
    hitStop=0; slowmo=0; consumeCmd(); return p; };
  const put=function(p, type, dx){ spawnEnemy(type, p.x+dx, LANE);
    const e=enemies[enemies.length-1];
    e.hp=e.maxHp=99999; e.poise=99999; e.state='walk'; e.entry=null; e.entT=99; return e; };

  // ── 周ごとに足した新顔。周を増やすときはここへ1行足す ──
  const NEW=[
    {lap:1, name:'一周目', zako:['lancer','hawkdog','drummer','slinger','torchdog','quakedog','houndmaster'],
     boss:['mbVolg','mbSiege','bsGriff'], pool:ZAKO_POOL, stages:[CH1,SEGS,FINAL_CH]},
    {lap:2, name:'二周目', zako:['tonbo','semi','kera','mizusumashi','kamadouma','minomushi','agehachou'],
     boss:['mbYanmar','mbKerad','bsGranAnt'], pool:BUG_ZAKO_POOL, stages:[BUG_CH,BUG_FINAL]},
    {lap:3, name:'三周目', zako:['saucer','gravitor','beamer','crawler','abductor','clonepod','mindwave'],
     boss:['mbVisitor','mbGravion','bsHive'], pool:ALIEN_ZAKO_POOL, stages:[SPACE_CH,SPACE_FINAL]},
    {lap:4, name:'四周目', zako:['mythpeg','mythtitan','mythgorgo','mythcent','mythcerb','mythsiren','mythcyclo'],
     boss:['mbPegas','mbTitan','bsTyphon'], pool:MYTH_ZAKO_POOL, stages:[MYTH_CH]},
  ];
  const ALLZ=[], ALLB=[];
  NEW.forEach(function(N){ ALLZ.push.apply(ALLZ,N.zako); ALLB.push.apply(ALLB,N.boss); });
  const L1Z=ALLZ, L1B=ALLB;

  // ===== 1) 名前・数値・出現先が揃っている =====
  { NEW.forEach(function(N){
      if(N.zako.length+N.boss.length!==10) throw new Error(N.name+' の新顔が '+(N.zako.length+N.boss.length)+' 体しかない');
      N.zako.forEach(function(k){ if(N.pool.indexOf(k)<0) throw new Error(N.name+'：'+k+' が湧きプールに入っていない'); });
      const txt=JSON.stringify(N.stages);
      N.boss.forEach(function(k){ if(txt.indexOf('"'+k+'"')<0) throw new Error(N.name+'：'+k+' がどのステージにも配置されていない'); }); });
    L1Z.concat(L1B).forEach(function(k){
      const t=ETYPE[k];
      if(!t) throw new Error(k+' が ETYPE に無い');
      if(!t.name) throw new Error(k+' に名前が無い');
      if(!(t.hp>0 && t.dmg>0 && t.w>0 && t.h>0)) throw new Error(k+' の数値が入っていない');
      if(!(t.score>0)) throw new Error(k+' にスコアが無い'); });
    // 名乗りの肩書き
    L1B.forEach(function(k){ if(!BOSSROLE[k]) throw new Error(k+' に肩書きが無い'); });
    // 名前が既存と衝突していない
    { const seen={}; for(const k in ETYPE){ const n=ETYPE[k].name; if(!n) continue;
        if(seen[n] && (L1Z.concat(L1B).indexOf(k)>=0)) throw new Error('名前が既存と同じ: '+n);
        seen[n]=k; } }
    console.log('新顔の登録 OK ('+NEW.map(function(N){ return N.name+' '+N.zako.length+'+'+N.boss.length; }).join(' / ')+')'); }

  // ===== 2) 実際に湧いて、殴れて、倒せる =====
  { L1Z.concat(L1B).forEach(function(k){
      const p=setup(); const e=put(p, k, 70);
      e.hp=e.maxHp=200; e.z=0;
      const hp0=e.hp;
      damageEnemy(e, 60, 4, false);
      if(!(e.hp<hp0)) throw new Error(k+' に攻撃が通らない');
      e.hp=1; damageEnemy(e, 60, 4, true);
      if(!e.dead) throw new Error(k+' が倒せない'); });
    console.log('新顔の被弾と撃破 OK ('+(L1Z.length+L1B.length)+'体すべて)'); }

  // ===== 3) 装備ごとに絵が違う（同じ犬の色違いになっていないこと） =====
  //   自前で形を組み立てて比べると、描画側だけの分岐を丸ごと見落とす。
  //   実際に ctx へ飛ぶ呼び出しの並びを横取りして指紋を取る
  { const fingerprint=function(type){
      const p=setup(); const e=put(p, type, 120);
      e.z=0; e.state='walk'; e.anim=1.0; e.bob=0.5; e.gait=0.8; e.gaitW=1;
      const real=ctx; let sig='';
      ctx=new Proxy(real, {
        get(t,k){ const v=t[k];
          if(typeof v==='function') return function(){ sig+=k+':'+Array.prototype.slice.call(arguments)
            .map(function(a){ return (typeof a==='number')? a.toFixed(1) : String(a); }).join(',')+';'; return v.apply(t,arguments); };
          return v; },
        set(t,k,v){ sig+='='+k+':'+v+';'; t[k]=v; return true; } });
      try{ drawEnemy(e); } finally { ctx=real; }
      return sig; };
    // 比較の基準は「同じ家族の既存の1体」。別の家族と比べても差が出て当たり前で、
    // 作り分けの検査にならない
    const BASE={1:'wolf', 2:'kamakiri', 3:'greywan', 4:'mythhop', 5:'ashigaru', 6:'mkShield'};
    const sigs={}, bases={};
    NEW.forEach(function(N){ bases[N.lap]=fingerprint(BASE[N.lap]); });
    NEW.forEach(function(N){ N.zako.concat(N.boss).forEach(function(k){ const f=fingerprint(k);
      if(!(f.length>40)) throw new Error(k+' が何も描いていない');
      if(f===bases[N.lap]) throw new Error(k+' の絵が既存の '+ETYPE[BASE[N.lap]].name+' と完全に同じ');
      sigs[k]=f; }); });
    // 新顔どうしも別物であること（作り分けを忘れると同じ指紋になる）
    const keys=Object.keys(sigs);
    for(let i=0;i<keys.length;i++) for(let j=i+1;j<keys.length;j++)
      if(sigs[keys[i]]===sigs[keys[j]]) throw new Error(keys[i]+' と '+keys[j]+' の絵が同一');
    // 「基準の1体が描かない図形」を自分だけが描いていること。
    // 長さで比べると、基準の方が装飾の多い種（カマキリの 2鎌など）で必ず負ける
    const uniq=function(f, b){ const have={};
      b.split(';').forEach(function(c){ have[c]=(have[c]|0)+1; });
      let n=0; f.split(';').forEach(function(c){ if(have[c]) have[c]--; else n++; });
      return n; };
    NEW.forEach(function(N){ N.zako.concat(N.boss).forEach(function(k){
      const n=uniq(sigs[k], bases[N.lap]);
      if(!(n>=12)) throw new Error(k+' が '+ETYPE[BASE[N.lap]].name+' に無い図形を '+n+' 回しか描いていない（色違いのまま）'); }); });
    console.log('見た目の作り分け OK ('+(L1Z.length+L1B.length)+'体それぞれ別の描画)'); }

  // ===== 4) 飛行兵：高度を保ち、急降下で降りてきて当てる =====
  { const p=setup(); p.invuln=0; p.hp=p.maxHp=99999;
    const e=put(p, 'hawkdog', 300); e.thinkCd=999;
    let zs=[]; for(let f=0;f<60;f++){ hitStop=0; slowmo=0; step(1); zs.push(e.z); }
    const lo=Math.min.apply(null, zs.slice(20));
    if(!(lo>30)) throw new Error('飛行兵が地面に降りている（最低高度 '+Math.round(lo)+'px）');
    // 急降下：高く昇ってから降りてきて、地面近くで当てる。
    // 滑空の距離は決まっているので、届く間合いに置いて自分は動かずに受ける
    const q0=setup(); q0.invuln=0; q0.hp=q0.maxHp=99999; q0.y=LANE;
    const e2=put(q0, 'hawkdog', 150); e2.thinkCd=0; e2.y=LANE;
    let peak=0, low=999, hp0=q0.hp, sawSwoop=false;
    for(let f=0;f<160;f++){ hitStop=0; slowmo=0;
      q0.z=0; q0.invuln=0; q0.vx=0;                 // 逃げずに受ける
      step(1);
      if(e2.state==='swoop'||e2.state==='swoopUp') sawSwoop=true;
      if(e2.z>peak) peak=e2.z; if(e2.state==='swoop') low=Math.min(low,e2.z); }
    const p2=q0;
    if(!sawSwoop) throw new Error('飛行兵が急降下してこない');
    if(!(peak>100)) throw new Error('急降下の前に舞い上がらない（最高 '+Math.round(peak)+'px）');
    if(!(low<40)) throw new Error('急降下しても地面近くまで降りてこない（最低 '+Math.round(low)+'px）');
    if(!(p2.hp<hp0)) throw new Error('急降下が当たらない');
    // 叩き落とせること（浮いたまま無敵の敵にしない）
    { const q=setup(); const f2=put(q, 'hawkdog', 80);
      for(let f=0;f<40;f++){ hitStop=0; slowmo=0; step(1); }
      launchEnemy(f2, 0, -14, 3);
      let landed=false;
      for(let f=0;f<120;f++){ hitStop=0; slowmo=0; step(1); if(f2.z<=1) landed=true; }
      if(!landed) throw new Error('飛行兵を叩き落としても地面に着かない（打ち上げ中も浮き直している）'); }
    console.log('飛行兵 OK (巡航 '+Math.round(Math.min.apply(null,zs.slice(20)))+'px→頂点 '+Math.round(peak)+'px→'+Math.round(low)+'px まで降下して命中・叩き落とせる)'); }

  // ===== 5) 地形兵：予告のあと地面がせり上がり、乗っていると打ち上げられる =====
  { const p=setup(); p.invuln=0; p.hp=p.maxHp=99999;
    const e=put(p, 'quakedog', 260); e.thinkCd=0;
    let warned=false, sw=0, hi=0, hp0=p.hp;
    for(let f=0;f<120;f++){ hitStop=0; slowmo=0;
      p.invuln=0;                                   // その場で受ける
      if(e.state==='quakeWind') warned=true;
      step(1);
      if(SWELLS.length>sw) sw=SWELLS.length;
      if(p.z>hi) hi=p.z; }
    if(!warned) throw new Error('地形兵が構えを見せずに撃ってくる');
    if(!(sw>0)) throw new Error('地形兵が地面を動かさない');
    if(!(hi>40)) throw new Error('せり上がった地面に乗っても '+Math.round(hi)+'px しか浮かない');
    if(!(p.hp<hp0)) throw new Error('地形兵の地鳴りでダメージが入らない');
    // 地形そのものが動いていること（見た目だけの演出にしない）
    { const q=setup(); const e2=put(q, 'quakedog', 260); e2.thinkCd=0;
      let maxLift=0; const bx=q.x;
      for(let f=0;f<120;f++){ hitStop=0; slowmo=0; q.invuln=99999; step(1);
        maxLift=Math.max(maxLift, Math.abs(groundLift(bx)-terrLiftBase(bx))); }
      if(!(maxLift>30)) throw new Error('地面の高さが '+Math.round(maxLift)+'px しか変わらない（うねりが地形に効いていない）'); }
    // 輪の外へ逃げれば当たらない
    { const q=setup(); q.invuln=0; q.hp=q.maxHp=99999;
      const e3=put(q, 'quakedog', 260); e3.thinkCd=0;
      const hp1=q.hp;
      for(let f=0;f<120;f++){ hitStop=0; slowmo=0;
        if(e3.state==='quakeWind') q.x=e3.x+900;     // 予告を見て走って逃げる
        q.invuln=0; step(1); }
      if(q.hp<hp1) throw new Error('予告を見て離れても地鳴りが当たる'); }
    console.log('地形兵 OK (予告→うねり '+sw+'本／乗ると '+Math.round(hi)+'px 打ち上げ／地形の高さが実際に動く／離れれば当たらない)'); }

  console.log('NEW FOES TEST PASSED'); process.exit(0);
})().catch(e=>{ console.error('FAIL:', e.message, e.stack); process.exit(1); });
`;
code = code + "\n;" + DRIVER;
(0, eval)(code);

// 解析ハーネスは tests/bgmlib/ に置く。以前は /tmp のセッション用スクラッチを
// 直接 require していたので、コンテナが作り直されるとこのスイートだけ起動しなかった
const { analyze, unisonCount } = require(require('path').join(__dirname,'bgmlib','analyze.js'));
const HTML=process.env.NM_TARGET || require('path').resolve(__dirname,'..','beltaction.html');
const key=a=>a.join(',');
function leadSecs(mode,idx,lap){
  const r=analyze(HTML,mode,idx,lap,256);
  const leads=r.notes.filter(n=>n.part==='lead' && n.callSrc.indexOf('*1.004')<0);
  // セクションの境目は実測の音位置ではなく、テンポから厳密に割り出す（境界の音を取り違えない）
  const stepDur=60/r.S.bpm/2, span=stepDur*64, t0=0;
  const secs=[[],[],[],[]], half=[[],[],[],[]];
  for(const n of leads){ let s=Math.floor((n.t0-t0+1e-6)/span); s=Math.max(0,Math.min(3,s));
    secs[s].push(Math.round(n.pitch));
    half[s].push((n.t0-t0-s*span+1e-6) < span/2 ? 0 : 1); }
  // 休符位置がセクションごとに違うので、個数ではなく前半／後半の時間で切る
  const firstHalf=i=>secs[i].filter((_,k)=>half[i][k]===0);
  const lastHalf =i=>secs[i].filter((_,k)=>half[i][k]===1);
  return {secs, firstHalf, lastHalf, r};
}
try{
  // ===== 1) 32小節フォームの4セクションが「別の旋律」になっていること =====
  for(const [mode,idx,lap] of [['battle',0,1],['battle',4,1],['battle',9,1],['boss',0,1],['boss3',0,1],['title',0,1],['bosschamu',0,2],
                               ['battle',16,4],['battle',17,4],['battle',18,4],['bossmyth',0,4]]){
    const {secs, firstHalf, lastHalf}=leadSecs(mode,idx,lap);
    const tag=mode+'['+idx+'] lap'+lap;
    if(key(secs[0])===key(secs[2])) throw new Error(tag+': Bセクションの旋律がAと同一（AメロBメロの対比が無い）');
    if(key(secs[0])===key(secs[3])) throw new Error(tag+": B'セクションの旋律がAと同一");
    if(key(secs[2])===key(secs[3])) throw new Error(tag+": B と B' が同一（回帰していない）");
    // Bは調内に収まること
    const pA=new Set(secs[0].map(x=>((x%12)+12)%12));
    const out=[...new Set(secs[2].map(x=>((x%12)+12)%12))].filter(p=>!pA.has(p));
    if(out.length) throw new Error(tag+': Bセクションに調外音 '+out.join('/'));
    // Bの音域が主題から離れすぎないこと（±7半音以内）
    const lo=a=>Math.min(...a), hi=a=>Math.max(...a);
    if(Math.abs(lo(secs[2])-lo(secs[0]))>7 || Math.abs(hi(secs[2])-hi(secs[0]))>7)
      throw new Error(tag+': Bセクションの音域が主題から乖離 '+lo(secs[2])+'-'+hi(secs[2])+' vs '+lo(secs[0])+'-'+hi(secs[0]));
    // B'は前半がB・後半がAの回帰であること
    if(key(firstHalf(3))!==key(firstHalf(2))) throw new Error(tag+": B' 前半が B と一致しない ("+key(firstHalf(3))+" vs "+key(firstHalf(2))+")");
    if(key(lastHalf(3))!==key(lastHalf(0))) throw new Error(tag+": B' 後半が A へ回帰していない ("+key(lastHalf(3))+" vs "+key(lastHalf(0))+")");
  }
  console.log('32小節フォーム OK (A / A\' / B / B\' が全て別の旋律で、B は調内・B\' は主題へ回帰)');

  // ===== 2) 蟲パレット（lap2）でパッドと木琴が完全ユニゾンしないこと =====
  for(const mode of ['bosschamu','boss3','bossalien','bosscosmic','boss']){
    const r=analyze(HTML,mode,0,2,256);
    const u=unisonCount(r.notes,0.35,false,true);
    const pp=u.pairs&&(u.pairs['padxpluck']||u.pairs['pluckxpad']);
    if(pp) throw new Error(mode+' lap2: pad×pluck が '+pp+' 件（マリンバがパッドと同音）');
    if(u.count>460) throw new Error(mode+' lap2: ユニゾン団子 '+u.count+' 件（上限460）');
  }
  console.log('蟲パレットの声部分離 OK (pad×pluck ゼロ／全epic曲でユニゾン460件以下)');

  // ===== 3) 全曲・全周でユニゾンが上限を超えないこと（回帰の網）=====
  let worst=0, worstN='';
  for(let lap=1; lap<=4; lap++){
    for(let i=0;i<19;i++){ const u=unisonCount(analyze(HTML,'battle',i,lap,256).notes,0.35,false,true);
      if(u.count>worst){ worst=u.count; worstN='BATTLE['+i+'] lap'+lap; } }
    for(const m of ['boss','boss2','boss3','bossfast','bossheavy','bosseerie','bossrival','bosscosmic','bossalien','bosschamu','bossmyth','town','title','ending']){
      const u=unisonCount(analyze(HTML,m,0,lap,256).notes,0.35,false,true);
      if(u.count>worst){ worst=u.count; worstN=m+' lap'+lap; } }
  }
  if(worst>460) throw new Error('最悪ユニゾン '+worst+' 件 ('+worstN+') が上限460を超過');
  console.log('全曲ユニゾン OK (最悪 '+worst+' 件 = '+worstN+')');

  // ===== 4) 周回ごとに編成が変わること（従来は打楽器と音色だけで、和声・旋律層は3周とも同一）=====
  { for(const [mode,idx] of [['battle',0],['battle',7],['boss3',0],['bossfast',0]]){
      const seq=[];
      for(const lap of [1,2,3]){
        const r=analyze(HTML,mode,idx,lap,64);
        const b=r.notes.filter(n=>n.part==='bass' && n.kind==='osc' && n.gain>0.1)
          .sort((x,y)=>x.t0-y.t0).map(n=>Math.round(n.pitch)).slice(0,16);
        if(b.length<16) throw new Error(mode+'['+idx+'] lap'+lap+': ベースが16音に満たない');
        seq.push(b.join(',')); }
      const tag=mode+'['+idx+']';
      if(seq[0]===seq[1]) throw new Error(tag+': 1周目と2周目のベースが同一');
      if(seq[0]===seq[2]) throw new Error(tag+': 1周目と3周目のベースが同一');
      if(seq[1]===seq[2]) throw new Error(tag+': 2周目と3周目のベースが同一');
      // どの周回も和音内音だけを踏んでいること（勝手な非和声音を出さない）
      for(const q of seq){ const ns=q.split(',').map(Number);
        const set=new Set(seq[0].split(',').map(Number));
        for(const n of ns) if(!set.has(n)) throw new Error(tag+': 周回で和音外の低音が出ている '+n); } }
    console.log('周回別の編成 OK (ベースの歩き方が1/2/3周目で別々／和音内音のまま)'); }

  // ===== 5) 背景テーマの数だけ戦闘曲があること =====
  // themeIdxFor は STAGE_THEME.length-1 までを返すので、BATTLE がそれより短いと
  // song() が undefined を返し、scheduleStep が毎フレーム例外を投げてBGMが丸ごと消える。
  // 神話の3ステージ（テーマ16〜18）が実際にこれで無音だった（曲が16曲しかなかった）。
  { const fs=require('fs'), html=fs.readFileSync(HTML,'utf8');
    const head=html.indexOf('const STAGE_THEME=[');
    if(head<0) throw new Error('STAGE_THEME が見つからない');
    const blk=html.slice(head), nTheme=(blk.slice(0,blk.indexOf('\n];')).match(/^ {2}\{ /gm)||[]).length;
    if(nTheme<19) throw new Error('STAGE_THEME の数え上げに失敗した: '+nTheme);
    for(let i=0;i<nTheme;i++){
      let n=0;
      try { n=analyze(HTML,'battle',i,4,64).notes.length; }
      catch(e){ throw new Error('テーマ'+i+' の戦闘曲が無い（BGMが例外で止まる）: '+e.message); }
      if(!n) throw new Error('テーマ'+i+' の戦闘曲が1音も鳴らない'); }
    console.log('テーマと曲の対応 OK (背景テーマ'+nTheme+'種すべてに戦闘曲がある)'); }

  // ===== 6) 神には専用のボス曲があること =====
  // SONGS[mode] は無ければ BATTLE[0] へ黙って落ちるので、曲名を消しても音は鳴る。
  // 「汎用ボス曲と違う旋律であること」まで要求しないと、専用曲の削除を検出できない
  { const lead=m=>analyze(HTML,m,0,4,128).notes.filter(n=>n.part==='lead')
      .sort((a,b)=>a.t0-b.t0).map(n=>Math.round(n.pitch)).join(',');
    const my=lead('bossmyth'), gen=lead('boss'), b0=lead('battle');
    if(!my) throw new Error('bossmyth が1音も鳴らない');
    if(my===gen) throw new Error('神のボス曲が汎用ボス曲と同じ旋律');
    if(my===b0) throw new Error('bossmyth が定義されておらず BATTLE[0] へ落ちている');
    console.log('神のボス曲 OK (汎用ボス曲とも BATTLE[0] とも別の旋律、'+my.split(',').length+'音)'); }

  // ===== 二〜五周目：ステージごとに刻みが違うこと =====
// 音階と旋律は章ごとに書き分けてあったのに、刻みが既定のまま横並びだった。
// 聴くとどのステージも同じ運びに聞こえるので、絵に合わせて刻みを与えている
{ const sig={}, dup=[];
  for(let i=9;i<=24;i++){
    const r=analyze(HTML,'battle',i,3,32), S=r.S;
    if(!S.rhy) throw new Error('テーマ'+i+' に刻みの指定が無い（既定の運びのまま）');
    const k=S.rhy.slice(0,8).join(',')+'|'+(S.kit||(S.drive?'drive':'straight'));
    if(sig[k]!=null) dup.push(i+'と'+sig[k]);
    sig[k]=i; }
  // 全16ステージが完全に別々である必要は無いが、半分以上が同じ運びでは章の差が出ない
  if(dup.length>3) throw new Error('刻みが同じステージが多すぎる: '+dup.join(' / '));
  const kinds=Object.keys(sig).length;
  if(kinds<10) throw new Error('二〜五周目の刻みが '+kinds+' 種類しかない（16ステージ）');
  console.log('章ごとの刻み OK ('+kinds+'種類／重なりは '+dup.length+'組)'); }

// ===== 六周目：追跡テーマの作風（3+3+2 の不均等な足取り）=====
// 映画の旋律は使わない。借りたのは「8つの刻みを 3+3+2 に割る足取り」と
// 「金属を叩く打点」だけ。ここではその二つが実際に鳴っているかを測る
{ const STEPS=[0,3,6];
  const rep=[];
  for(let i=25;i<=30;i++){
    const r=analyze(HTML,'battle',i,6,64);
    const sd=60/r.S.bpm/2;
    if(r.S.kit!=='anvil') throw new Error('テーマ'+i+' が金床の刻みになっていない（kit='+r.S.kit+'）');
    const stepOf=n=>Math.round(n.t0/sd)%8;
    const kicks=r.notes.filter(n=>n.part==='kick');
    if(!kicks.length) throw new Error('テーマ'+i+' に打点が無い');
    // 打点が 3+3+2 の頭に寄っていること。均等な 0/2/4/6 や 0/4 では別物になる
    const on=kicks.filter(n=>STEPS.indexOf(stepOf(n))>=0).length;
    const ratio=on/kicks.length;
    if(!(ratio>=0.75)) throw new Error('テーマ'+i+' の打点が 3+3+2 に乗っていない（'+Math.round(ratio*100)+'%）');
    // 4分の均等踏み（2 と 6 が同数）になっていないこと＝行進曲に戻っていない
    const at2=kicks.filter(n=>stepOf(n)===2).length, at3=kicks.filter(n=>stepOf(n)===3).length;
    if(!(at3>at2)) throw new Error('テーマ'+i+' が均等な四つ打ちに戻っている（3拍目'+at3+' vs 2拍目'+at2+'）');
    // 金属の余韻（FMベル）が打点と同じ数だけ乗っていること。
    // 割合で見ると、宇宙パレットが元から鳴らしている FM ベルに薄められて判定が鈍る
    const bells=r.notes.filter(n=>n.part==='fmbell');
    const bon=bells.filter(n=>STEPS.indexOf(stepOf(n))>=0).length;
    if(!(bon>=kicks.length*0.9))
      throw new Error('テーマ'+i+' の金属の余韻が打点に足りない（打'+kicks.length+' に対し '+bon+'）');
    rep.push(i+':'+Math.round(ratio*100)+'%'); }
  // 六曲が互いに別の旋律であること（同じ足取りでも曲は書き分ける）
  { const sig={};
    for(let i=25;i<=30;i++){ const r=analyze(HTML,'battle',i,6,64);
      const k=r.notes.filter(n=>n.part==='lead').map(n=>n.pitch).join(',');
      if(sig[k]) throw new Error('テーマ'+i+' と '+sig[k]+' の旋律が同じ');
      sig[k]=i; } }
  console.log('六周目の足取り OK (3+3+2 の打点 '+rep.join(' ')+'／金属の余韻つき／六曲とも別の旋律)'); }

console.log('BGM FORM/VOICING TEST PASSED');
}catch(e){ console.error('FAIL:', e.message); process.exit(1); }

const DRIVER = `
(async()=>{
  const step=(n)=>{ for(let i=0;i<n;i++){ if(global.rafCb){ const cb=global.rafCb; global.rafCb=null; cb(); } } };

  // ===================================================================
  //  1) キャラクターボイス
  // ===================================================================
  // 外部音源を持てないので合成している。「鳴ったか」だけでなく
  // 「キャラごとに別の声になっているか」を、実際に組まれるノードで見る。
  // ヘッドレスの AudioContext スタブは何も覚えないので、録音するものへ差し替える
  function recorder(){
    const rec={osc:[], bp:[], started:0, t:0};
    const param=()=>({ value:0, _log:[],
      setValueAtTime(v){ this.value=v; this._log.push(v); },
      linearRampToValueAtTime(v){ this._log.push(v); },
      exponentialRampToValueAtTime(v){ this._log.push(v); },
      cancelScheduledValues(){} });
    const node=()=>({ connect(){}, disconnect(){}, gain:param(), frequency:param(), Q:param(), type:'' });
    return { rec, ctx:{
      currentTime:0, state:'running', sampleRate:44100, destination:node(),
      resume(){ return Promise.resolve(); },
      createGain:()=>node(),
      createOscillator(){ const o=node(); rec.osc.push(o);
        o.start=()=>{rec.started++;}; o.stop=()=>{}; return o; },
      createBiquadFilter(){ const b=node(); rec.bp.push(b); return b; },
      createBufferSource(){ const s=node(); s.buffer=null; s.start=()=>{}; s.stop=()=>{}; return s; },
      createStereoPanner:()=>node(),
      createDynamicsCompressor:()=>node(), createDelay:()=>node(),
      createBuffer:()=>({getChannelData:()=>new Float32Array(64)}) } };
  }
  // 声だけを取り出す。sfxOut など他の経路も同じ録音機を通るので、
  // 「バンドパスの中心周波数」の集合を声の指紋として使う
  function speak(kind, line){
    const R=recorder();
    const svA=actx, svS=sndOn, svN=noiseBuf, svG=sfxGain;
    actx=R.ctx; sndOn=true; noiseBuf={}; sfxGain=R.ctx.destination;
    try { _voiceCd=0; gf+=100; playVoice(kind, line, null); }
    finally { actx=svA; sndOn=svS; noiseBuf=svN; sfxGain=svG; }
    return R.rec;
  }

  { const r=speak('inu','atk');
    if(!r.started) throw new Error('声が鳴っていない（オシレータが起動していない）');
    // 共鳴が1本だと「ブザー」にしかならない。母音の色は2本の山の距離で決まるので、
    // VOICE 表の f1 と f2 が両方とも実際に組まれていることを見る
    const fs=r.bp.map(b=>Math.round(b.frequency.value));
    if(fs.indexOf(VOICE.inu.f1)<0) throw new Error('第1フォルマントが立っていない: '+fs.join(','));
    if(fs.indexOf(VOICE.inu.f2)<0) throw new Error('第2フォルマントが立っていない: '+fs.join(','));
    console.log('声の生成 OK (オシレータ '+r.started+'／共鳴 '+VOICE.inu.f1+'Hz と '+VOICE.inu.f2+'Hz)'); }

  // キャラごとに別の声であること。フォルマントの中心が同じなら同じ声に聞こえる
  { const kinds=['inu','shima','nuko','guard8','watch','wanden'];
    const sig={};
    for(const k of kinds){ const r=speak(k,'atk');
      const fs=r.bp.map(b=>Math.round(b.frequency.value));
      if(fs.indexOf(VOICE[k].f1)<0 || fs.indexOf(VOICE[k].f2)<0)
        throw new Error(k+' の共鳴が2本組まれていない: '+fs.join(','));
      sig[k]=fs.slice().sort((a,b)=>a-b).join(','); }
    const uniq=new Set(Object.values(sig));
    if(uniq.size!==kinds.length)
      throw new Error('声が使い回されている（'+uniq.size+'種類しかない）: '+JSON.stringify(sig));
    // VOICE 表そのものも重複していないこと
    const f1=kinds.map(k=>VOICE[k].f1), f2=kinds.map(k=>VOICE[k].f2), f0=kinds.map(k=>VOICE[k].f0);
    if(new Set(f0).size!==6 || new Set(f1).size!==6 || new Set(f2).size!==6)
      throw new Error('VOICE 表に同じ値のキャラがいる');
    // 猫（ヌコ）はいちばん高く、ガードワン8号はいちばん低い＝体格と噛み合っていること
    if(VOICE.nuko.f0!==Math.max.apply(null,f0)) throw new Error('ヌコがいちばん高い声になっていない');
    if(VOICE.guard8.f0!==Math.min.apply(null,f0)) throw new Error('ガードワン8号がいちばん低い声になっていない');
    console.log('声の描き分け OK (6キャラすべて別のフォルマント／f0 '+Math.min.apply(null,f0)+'〜'+Math.max.apply(null,f0)+'Hz)'); }

  // 場面ごとに節の数と高さが違うこと（技・奥義・被弾・撃墜が同じ声だと意味が無い）
  { const n=l=>speak('inu',l).osc.length;
    const atk=n('atk'), ult=n('ult'), hurt=n('hurt'), ko=n('ko');
    if(!(ult>atk)) throw new Error('奥義が技より節が多くない: '+atk+' vs '+ult);
    if(!(ko>hurt)) throw new Error('撃墜が被弾より節が多くない: '+hurt+' vs '+ko);
    if(!(VOICE_LINE.hurt[0][0]>VOICE_LINE.atk[0][0])) throw new Error('悲鳴が技より高くない');
    if(!(VOICE_LINE.ko[1][0]<VOICE_LINE.ko[0][0])) throw new Error('断末魔が高→低に落ちていない');
    console.log('場面の描き分け OK (技'+atk+'節 / 奥義'+ult+'節 / 被弾'+hurt+'節 / 撃墜'+ko+'節)'); }

  // 連打で声が重ならないこと
  { const R=recorder(); const svA=actx, svS=sndOn, svN=noiseBuf, svG=sfxGain;
    actx=R.ctx; sndOn=true; noiseBuf={}; sfxGain=R.ctx.destination;
    try { _voiceCd=0; for(let i=0;i<20;i++){ playVoice('inu','atk',null); gf++; } }
    finally { actx=svA; sndOn=svS; noiseBuf=svN; sfxGain=svG; }
    if(R.rec.started>=20) throw new Error('20連打で20回鳴っている（間隔制限が効いていない）');
    if(R.rec.started<1) throw new Error('一度も鳴っていない');
    console.log('声の間隔制限 OK (20フレーム連打で '+R.rec.started+'回だけ)'); }

  // 通常の小技では喋らない（15分遊んで耳が痛くならないための線引き）
  { const spoke=[];
    const svV=playVoice; playVoice=function(k,l,x){ spoke.push(l); };
    try {
      setupRoster('inu'); startGame(); state='play';
      const p=players[0]; player=p; p.state='idle'; p.atk=null; p.z=0;
      spoke.length=0; beginAttack('c1'); beginAttack('c2'); beginAttack('c3');
      if(spoke.length) throw new Error('通常のジャブで喋っている: '+spoke.join(','));
      spoke.length=0; beginAttack('c4');                       // 4段目＝finisher
      if(!spoke.length) throw new Error('締めの一撃で声が出ない');
      spoke.length=0; beginAttack('dimension');                // 奥義
      if(spoke[0]!=='ult') throw new Error('奥義が ult の声になっていない: '+spoke[0]);
    } finally { playVoice=svV; }
    console.log('声を出す場面 OK (c1〜c3は無言／締めと奥義だけ声が出る)'); }

  // 被弾と撃墜で声が出ること
  { const spoke=[];
    const svV=playVoice; playVoice=function(k,l,x){ spoke.push(l); };
    try {
      setupRoster('shima'); startGame(); state='play';
      const p=players[0]; player=p; p.invuln=0; p.hp=p.maxHp=200; p.state='idle';
      spoke.length=0; hurtPlayer(p, 20, 1, false);
      if(spoke.indexOf('hurt')<0) throw new Error('被弾で声が出ない: '+spoke.join(','));
      spoke.length=0; p.state='idle'; loseLife(p);
      if(spoke.indexOf('ko')<0) throw new Error('撃墜で声が出ない: '+spoke.join(','));
    } finally { playVoice=svV; }
    console.log('被弾・撃墜 OK (hurt と ko が鳴る)'); }

  // ===================================================================
  //  2) 奥義のカットイン
  // ===================================================================
  { if(typeof ultCutIn!=='function' || typeof drawUltCut!=='function') throw new Error('カットインが無い');
    // 6キャラすべてに技名があること（表に穴があると「奥義」とだけ出る）
    const kinds=['inu','shima','nuko','guard8','watch','wanden'];
    for(const k of kinds){ if(!ULT_NAME[k]) throw new Error(k+' の奥義名が無い'); }
    if(new Set(kinds.map(k=>ULT_NAME[k])).size!==6) throw new Error('奥義名が重複している');
    if(new Set(kinds.map(k=>heroColOf(k))).size!==6) throw new Error('カットインの色が重複している');
    console.log('奥義の見出し OK (6キャラ分の技名と色がすべて別)'); }

  // 発動で立ち上がり、決まった尺で必ず消えること（出っぱなしだと画面が塞がる）
  { setupRoster('inu'); startTraining(); perfTier=0;
    const p=players[0]; player=p; p.dim=p.dimMax=5;
    ultCut.t=0;
    beginUlt(p);
    if(ultCut.t<=0) throw new Error('カットインが立ち上がらない');
    if(ultCut.kind!=='inu') throw new Error('カットインのキャラが違う: '+ultCut.kind);
    if(ultCut.name!==ULT_NAME.inu) throw new Error('カットインの技名が違う: '+ultCut.name);
    const t0=ultCut.t;
    let f=0; while(ultCut.t>0 && f<400){ hitStop=0; step(1); f++; }
    if(ultCut.t>0) throw new Error('カットインが消えない（400フレーム経過）');
    // 尺は1秒程度に収める。長いと肝心の奥義のモーションが見えないまま終わる
    // 実測でカットインが消えるまで 1061ms。スローが乗るぶん、フレーム数は1秒より短く取る
    if(t0>44) throw new Error('カットインが '+t0+'フレームある（実時間で1秒を超える）');
    if(t0<20) throw new Error('カットインが '+t0+'フレームしかなく、技名が読めない');
    // スローの掛かりぶんも尺に効く。フレーム数だけ短くしても、
    // スローを長く掛ければ実時間は伸びるので、そちらも押さえる
    { const realSlow=triggerSlow; let slowT=0;
      triggerSlow=function(n){ slowT=Math.max(slowT, n|0); return realSlow.apply(null,arguments); };
      try{ ultCut.t=0; ultCutIn('inu','次元斬','#ffe14d'); } finally { triggerSlow=realSlow; }
      if(slowT>16) throw new Error('カットインのスローが '+slowT+'フレーム（実時間が1秒を超える）');
      ultCut.t=0; }
    // 帯が主役の立つ高さを覆っていないこと。中央に置くと奥義のモーションが隠れる
    { const real=ctx; const ys=[];
      ctx=new Proxy(real,{ get(t,k){
        if(k==='fillRect'){ return function(x,y,w2,h2){ if(h2!==H) ys.push(y+h2); }; }
        if(k==='lineTo'||k==='moveTo'){ return function(x,y){ ys.push(y); }; }
        const v=t[k]; return (typeof v==='function')? function(){ return t[k].apply(t,arguments); } : v; },
        set(t,k,v){ t[k]=v; return true; } });
      ultCutIn('inu','次元斬','#ffe14d'); ultCut.t=Math.round(t0*0.55);
      drawUltCut(); ctx=real;
      const bottom=ys.reduce(function(a2,y){ return Math.max(a2,y); }, 0);
      if(!(bottom < H*0.66)) throw new Error('カットインが画面の '+Math.round(bottom/H*100)+'% まで下りている（主役が隠れる）');
      ultCut.t=0; }
    if(f>90) throw new Error('カットインが長すぎる: '+f+'フレーム');
    if(f<30) throw new Error('カットインが短すぎる: '+f+'フレーム');
    console.log('カットインの尺 OK (立ち上がり '+t0+' → '+f+'フレームで消える)'); }

  // 6キャラ分の発動。キャラごとに別の技名と色になること
  { const seen={};
    const svC=ultCutIn; ultCutIn=function(k,n,c){ seen[k]={n:n,c:c}; return svC.apply(null,arguments); };
    try {
      for(const k of ['inu','shima','nuko','guard8','watch','wanden']){
        setupRoster(k); startTraining(); perfTier=0;
        const p=players[0]; player=p; p.dim=p.dimMax=5; p.state='idle'; p.atk=null; p.z=0;
        ultLocked=false; beginUlt(p); }
    } finally { ultCutIn=svC; }
    const miss=['inu','shima','nuko','guard8','watch','wanden'].filter(k=>!seen[k]);
    if(miss.length) throw new Error('カットインが出ないキャラがいる: '+miss.join(','));
    if(new Set(Object.keys(seen).map(k=>seen[k].n)).size!==6) throw new Error('技名が同じキャラがいる');
    console.log('全キャラの発動 OK (6キャラ: '+Object.keys(seen).map(k=>seen[k].n).join(' / ')+')'); }

  // 奥義の入口は updatePlayer の中で6キャラに分岐している。分岐より前に beginUlt が
  // 入っていないと、どれかのキャラだけ無言・カットイン無しで出てしまう。
  // 実際の入力（→↓←↑の回転コマンド）は再現しにくいので、分岐そのものを検査する
  { const src=updatePlayer.toString();
    const i=src.indexOf('beginSeven()');
    if(i<0) throw new Error('奥義の分岐が updatePlayer に見つからない');
    const head=src.slice(Math.max(0,i-400), i);
    const j=head.lastIndexOf('beginUlt(');
    if(j<0) throw new Error('奥義の分岐の手前で beginUlt を呼んでいない＝一部のキャラで演出が出ない');
    // 分岐の6つの入口がすべてこの1か所より後ろにあること
    const tail=src.slice(i-400+j);
    for(const entry of ['beginSeven()','beginGuardQuake()','beginGatling(','dkaiden','nmeteor','dimension'])
      if(tail.indexOf(entry)<0) throw new Error(entry+' が beginUlt より前にある＝そのキャラだけ演出が出ない');
    console.log('発動口の一本化 OK (6キャラの分岐すべてが beginUlt の後ろ)'); }

  // 重いときは静かに省かれること
  { ultCut.t=0; perfTier=2; ultCutIn('inu','次元斬','#ffe14d');
    if(ultCut.t>0) throw new Error('perfTier2 でもカットインが出る');
    perfTier=0; ultCutIn('inu','次元斬','#ffe14d');
    if(ultCut.t<=0) throw new Error('perfTier0 でカットインが出ない');
    ultCut.t=0;
    console.log('カットインの適応品質 OK (tier2で外れる)'); }

  // 描いていること。ctx の束縛を差し替えて、帯・立ち絵・技名がすべて出るのを確かめる
  { setupRoster('inu'); startTraining(); perfTier=0;
    const p=players[0]; player=p; p.dim=p.dimMax=5;
    const realCtx=ctx; const ops=[]; let txt=[];
    ctx=new Proxy(realCtx,{ get:function(t,k){
      if(k==='fillText') return function(s2){ txt.push(String(s2)); ops.push(k); };
      if(k==='strokeText') return function(){ ops.push(k); };      // 縁取りだけでは字は読めない
      if(k==='clip'||k==='fill'||k==='stroke'||k==='createLinearGradient'){
        const v=t[k]; ops.push(k);
        if(k==='createLinearGradient') return function(){ return {addColorStop:function(){}}; };
        return function(){}; }
      return t[k]; } });
    let drew=0;
    const svP=drawPlayerPortrait; drawPlayerPortrait=function(){ drew++; };
    try { beginUlt(p); for(let i=0;i<16;i++){ hitStop=0; step(1); } ops.length=0; txt=[]; drew=0; drawUltCut(); }
    finally { ctx=realCtx; drawPlayerPortrait=svP; }
    if(ops.indexOf('clip')<0) throw new Error('帯で切り抜いていない＝画面全体が塗り潰される');
    if(!drew) throw new Error('立ち絵を描いていない');
    if(txt.indexOf(ULT_NAME.inu)<0) throw new Error('技名を描いていない: '+txt.join(','));
    if(txt.indexOf(heroNameOf('inu'))<0) throw new Error('キャラ名を描いていない: '+txt.join(','));
    ultCut.t=0;
    console.log('カットインの描画 OK (帯で切り抜き／立ち絵'+1+'枚／「'+ULT_NAME.inu+'」と名前)'); }

  console.log('VOICE / ULT CUT-IN TEST PASSED'); process.exit(0);
})().catch(e=>{ console.error('FAIL:', e.message, e.stack); process.exit(1); });
`;
code = code + "\n;" + DRIVER;
(0, eval)(code);

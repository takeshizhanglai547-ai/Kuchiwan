// 70_audio.js — おと：BGM・効果音・声。WebAudio でその場で合成する（音声ファイルは使わない）。
//  ・BGM はデータ駆動。曲 = {bpm, key, mode, 区間(A/B…)ごとのコード・メロディ・伴奏型・ベース型・ドラム型}。
//    先読みスケジューラ（25ms ごとに AudioContext 時刻で 0.16 秒先まで予約）で鳴らす。ループは継ぎ目なし。
//  ・木琴・鉄琴・チェレスタ・ピチカート・ウクレレ・打楽器は、起動後のひまな時間に JS で波形を焼いておく
//    （1音 = BufferSource + Gain の2ノードだけ）。リード・ベース・ブラスはオシレーター。
//    持続する層（パッド等）は重ねない：色はリズム層と音色の入れ替えで出す（CLAUDE.md の教訓）。
//  ・効果音は同じ名前で 50ms に 3 回まで。重なった2発目以降は音量・音程・発音時刻をずらして同位相の積み上がりを防ぐ。
//  ・AudioContext が無い／止まっている／ミュートのときは何もしない。公開関数は例外を投げない。
//  ・検証用：G.audio.renderOffline(name, sec) は OfflineAudioContext で「同じ楽器コード」を通して焼き、
//    ピーク（リミッタ前後）・RMS・実際に楽器へ渡った音の音名ヒストグラムと調の推定（Krumhansl）を返す。
(function(){ 'use strict';
const G = window.G;
const AC = window.AudioContext || window.webkitAudioContext || null;
const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext || null;

const SR = 44100;          // 焼いた波形のサンプルレート（再生側で自動リサンプル）
const LOOKAHEAD = 0.16;    // 秒
const TICK_MS = 25;
const XFADE = 0.4;
const MUSIC_GAIN = 0.55, SFX_GAIN = 0.85;
const MAX_SFX_VOICES = 48;

const mtof = (m)=> 440*Math.pow(2,(m-69)/12);
const clamp = (v,a,b)=> v<a?a:(v>b?b:v);
const semi = (p)=> 12*Math.log2(p||1);
const nowMs = ()=> (window.performance && performance.now) ? performance.now() : Date.now();
function logErr(where, err){ try{ if(G.logError) G.logError('audio.'+where, err); else console.error(where, err); }catch(_){} }
function mulberry(seed){ let s = seed>>>0; return ()=>{ s = (s + 0x6D2B79F5)|0; let t = Math.imul(s ^ (s>>>15), 1|s); t = (t + Math.imul(t ^ (t>>>7), 61|t)) ^ t; return ((t ^ (t>>>14))>>>0)/4294967296; }; }
function hashStr(s){ let h = 2166136261; for(let i=0;i<s.length;i++){ h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h>>>0; }

// =====================================================================================
//  波形を焼く（純粋な JS。コンテキストに依存しないので、実時間とオフラインで同じデータを使う）
// =====================================================================================
function BQ(type, f, Q){   // RBJ biquad（焼くとき専用）
  const w0 = 2*Math.PI*f/SR, cw = Math.cos(w0), sw = Math.sin(w0), al = sw/(2*Q);
  let b0,b1,b2,a0,a1,a2;
  if(type==='lp'){ b0=(1-cw)/2; b1=1-cw; b2=(1-cw)/2; }
  else if(type==='hp'){ b0=(1+cw)/2; b1=-(1+cw); b2=(1+cw)/2; }
  else { b0=al; b1=0; b2=-al; }
  a0=1+al; a1=-2*cw; a2=1-al;
  b0/=a0; b1/=a0; b2/=a0; a1/=a0; a2/=a0;
  let x1=0,x2=0,y1=0,y2=0;
  return (x)=>{ const y=b0*x+b1*x1+b2*x2-a1*y1-a2*y2; x2=x1; x1=x; y2=y1; y1=y; return y; };
}
function addPartial(buf, f, amp, decay){
  const w = 2*Math.PI*f/SR; if(w >= Math.PI*0.9) return;
  const c2 = 2*Math.cos(w); let s1 = Math.sin(-w), s2 = Math.sin(-2*w);
  let env = amp; const k = Math.exp(-1/(decay*SR));
  for(let i=0;i<buf.length;i++){ const s = c2*s1 - s2; s2 = s1; s1 = s; buf[i] += s*env; env *= k; if(env < 1e-6) break; }
}
function normalize(buf, peak){ let m=0; for(let i=0;i<buf.length;i++){ const a=Math.abs(buf[i]); if(a>m) m=a; } if(m>0){ const k=peak/m; for(let i=0;i<buf.length;i++) buf[i]*=k; } return buf; }
function fadeEdges(buf, nin, nout){ nin=Math.min(nin,buf.length); for(let i=0;i<nin;i++) buf[i]*=i/nin; nout=Math.min(nout,buf.length); const L=buf.length; for(let i=0;i<nout;i++) buf[L-1-i]*=i/nout; }
function genMallet(f, dur, parts, click, rnd){
  const buf = new Float32Array(Math.ceil(dur*SR));
  for(const p of parts) addPartial(buf, f*p[0], p[1], p[2]);
  if(click>0){ const n=Math.floor(0.004*SR), lp=BQ('lp', 5000, 0.7); for(let i=0;i<n;i++) buf[i] += lp(rnd()*2-1)*click*(1-i/n); }
  fadeEdges(buf, 20, Math.floor(0.02*SR));
  return normalize(buf, 0.9);
}
// Karplus-Strong：y[n+N] = g·(y[n]+y[n+1])/2 → 周期 N-0.5
function genKS(f, dur, decayT, bright, extraDecay, rnd){
  const n = Math.ceil(dur*SR), out = new Float32Array(n);
  const N = Math.max(3, Math.round(SR/f + 0.5)); const line = new Float32Array(N);
  let lp=0, mean=0;
  for(let i=0;i<N;i++){ lp += ((rnd()*2-1)-lp)*bright; line[i]=lp; mean+=lp; }
  mean/=N; for(let i=0;i<N;i++) line[i]-=mean;
  const fAct = SR/(N-0.5);
  const g = Math.exp(-1/(decayT*fAct));
  const ek = extraDecay ? Math.exp(-1/(extraDecay*SR)) : 1;
  let idx=0, env=1;
  for(let i=0;i<n;i++){
    const nx = idx+1===N ? 0 : idx+1;
    const a=line[idx], b=line[nx];
    out[i]=a*env; env*=ek;
    line[idx]=g*0.5*(a+b);
    idx=nx;
  }
  fadeEdges(out, 12, Math.floor(0.02*SR));
  normalize(out, 0.9);
  return { data: out, base: 69 + 12*Math.log2(fAct/440) };
}
const DRUM_NAMES = ['k','s','c','sn','h','oh','sh','wb','cb','tb','sl','tk','tm','cr'];
function genDrum(name, rnd){
  const T = (d)=> new Float32Array(Math.ceil(d*SR));
  const N = ()=> rnd()*2-1;
  const TW = 2*Math.PI;
  let b, i, t, ph=0;
  switch(name){
    case 'k': { b=T(0.34); for(i=0;i<b.length;i++){ t=i/SR; ph+=TW*(52+118*Math.exp(-t/0.028))/SR; b[i]=Math.sin(ph)*Math.exp(-t/0.12); }
      const lp=BQ('lp',3000,0.7), n=Math.floor(0.004*SR); for(i=0;i<n;i++) b[i]+=lp(N())*0.35*(1-i/n); break; }
    case 's': { b=T(0.24); const bp=BQ('bp',2800,0.7), hp=BQ('hp',900,0.7);
      for(i=0;i<b.length;i++){ t=i/SR; ph+=TW*(190+40*Math.exp(-t/0.01))/SR; b[i]=Math.sin(ph)*0.55*Math.exp(-t/0.045) + hp(bp(N()))*1.1*Math.exp(-t/0.075); } break; }
    case 'c': { b=T(0.28); const bp=BQ('bp',1350,1.3);
      for(i=0;i<b.length;i++){ t=i/SR; let e=Math.exp(-t/0.0045); if(t>=0.011) e+=Math.exp(-(t-0.011)/0.0045); if(t>=0.022) e+=Math.exp(-(t-0.022)/0.0045); if(t>=0.03) e+=0.7*Math.exp(-(t-0.03)/0.09); b[i]=bp(N())*e; } break; }
    case 'sn': { b=T(0.1); const bp=BQ('bp',2300,2);
      for(i=0;i<b.length;i++){ t=i/SR; b[i]=bp(N())*1.4*Math.exp(-t/0.011) + Math.sin(TW*1750*t)*0.25*Math.exp(-t/0.008); } break; }
    case 'h': { b=T(0.07); const hp=BQ('hp',7200,0.8); for(i=0;i<b.length;i++){ t=i/SR; b[i]=hp(N())*Math.exp(-t/0.014); } break; }
    case 'oh': { b=T(0.4); const hp=BQ('hp',6500,0.8); for(i=0;i<b.length;i++){ t=i/SR; b[i]=hp(N())*Math.exp(-t/0.11); } break; }
    case 'sh': { b=T(0.13); const bp=BQ('bp',5600,1.4); for(i=0;i<b.length;i++){ t=i/SR; const e = t<0.02 ? t/0.02 : Math.exp(-(t-0.02)/0.032); b[i]=bp(N())*e; } break; }
    case 'wb': { b=T(0.12); for(i=0;i<b.length;i++){ t=i/SR; b[i]=Math.sin(TW*1020*t)*Math.exp(-t/0.028)+0.35*Math.sin(TW*2580*t)*Math.exp(-t/0.012); } break; }
    case 'cb': { b=T(0.3); const bp=BQ('bp',900,1.6), tmp=T(0.3);
      for(let h=1;h<=7;h+=2){ addPartial(tmp, 540*h, 1/h, 0.09); addPartial(tmp, 800*h, 1/h, 0.09); }
      for(i=0;i<b.length;i++) b[i]=bp(tmp[i]); break; }
    case 'tb': { b=T(0.26); const hp=BQ('hp',7000,0.8);
      for(i=0;i<b.length;i++){ t=i/SR; b[i]=hp(N())*0.8*Math.exp(-t/0.06); }
      addPartial(b, 6200, 0.12, 0.06); addPartial(b, 7650, 0.12, 0.06); addPartial(b, 9100, 0.12, 0.06); break; }
    case 'sl': { b=T(0.3); const bp=BQ('bp',8200,2.5), on=[0,0.013,0.028,0.044];
      for(i=0;i<b.length;i++){ t=i/SR; let e=0; for(let k=0;k<4;k++){ if(t>=on[k]) e+=Math.exp(-(t-on[k])/0.028)*(1-k*0.18); } b[i]=bp(N())*e; }
      addPartial(b, 5300, 0.1, 0.07); addPartial(b, 6900, 0.08, 0.06); addPartial(b, 8350, 0.06, 0.05); break; }
    case 'tk': { b=T(0.55); const lp=BQ('lp',400,0.8);
      for(i=0;i<b.length;i++){ t=i/SR; ph+=TW*(62+40*Math.exp(-t/0.05))/SR; b[i]=Math.sin(ph)*Math.exp(-t/0.22) + lp(N())*0.5*Math.exp(-t/0.03); } break; }
    case 'tm': { b=T(0.32); for(i=0;i<b.length;i++){ t=i/SR; ph+=TW*(135+70*Math.exp(-t/0.04))/SR; b[i]=Math.sin(ph)*Math.exp(-t/0.12); } break; }
    case 'cr': { b=T(1.3); const hp=BQ('hp',5200,0.7), k=Math.exp(-1/(0.38*SR)); let e=0.8;
      for(i=0;i<b.length;i++){ b[i]=hp(N())*e; e*=k; }
      for(const f of [4130,5310,6720,8240,9660]) addPartial(b, f, 0.05, 0.38); break; }
    default: b=T(0.01);
  }
  fadeEdges(b, 6, 64);
  return normalize(b, 0.9);
}
// 焼く楽器（bases = 焼く音の MIDI。再生時は一番近いものを playbackRate でずらす）
const SAMPLED = {
  marimba:{ bases:[55,67,79], dur:0.8, gain:0.95, ring:0.45, parts:[[1,1,0.3],[3.93,0.22,0.045],[9.2,0.05,0.012]], click:0.04 },
  xylo:   { bases:[67,79,91], dur:0.5, gain:0.7,  ring:0.3,  parts:[[1,1,0.15],[3,0.42,0.05],[6.1,0.12,0.02]], click:0.06 },
  glock:  { bases:[70,82,94], dur:1.4, gain:0.5,  ring:1.0,  parts:[[1,1,0.75],[2.76,0.32,0.22],[5.4,0.16,0.08],[8.93,0.06,0.035]], click:0.02 },
  celesta:{ bases:[67,79,91], dur:1.1, gain:0.7,  ring:0.7,  parts:[[1,1,0.55],[2,0.24,0.28],[3,0.07,0.12],[4.07,0.06,0.06]], click:0.01 },
  pizz:   { bases:[50,62,74], dur:0.5, gain:0.95, ring:0.18, ks:[0.35,0.3,0.2] },   // [減衰秒, 明るさ, 追加減衰秒]
  uke:    { bases:[57,69],    dur:1.2, gain:0.75, ring:0.14, ks:[0.9,0.55,0] },
};
// 焼く作業は小さな仕事に分けて、ひまなときに少しずつ進める（1回の長い停止を作らない）。
// 順番は固定なので、分け方に関係なく同じ乱数列＝同じ波形になる。
let bank = null, bankMs = 0, bankWork = null;
function bankJobs(){
  const rnd = mulberry(0xC0FFEE), part = { inst:{}, drum:{}, noise:null }, jobs = [];
  for(const name in SAMPLED){
    const d = SAMPLED[name]; part.inst[name] = [];
    for(const m of d.bases) jobs.push(()=>{
      if(d.ks){ const k = genKS(mtof(m), d.dur, d.ks[0], d.ks[1], d.ks[2], rnd); part.inst[name].push({ base:k.base, data:k.data }); }
      else part.inst[name].push({ base:m, data: genMallet(mtof(m), d.dur, d.parts, d.click, rnd) });
    });
  }
  for(const k of DRUM_NAMES) jobs.push(()=>{ part.drum[k] = genDrum(k, rnd); });
  jobs.push(()=>{ const nz = new Float32Array(Math.ceil(SR*1.2)); for(let i=0;i<nz.length;i++) nz[i]=rnd()*2-1; part.noise = nz; });
  return { part, jobs, i:0, maxJob:0 };
}
function buildBankStep(budgetMs){
  if(bank) return true;
  if(!bankWork) bankWork = bankJobs();
  const W = bankWork, t0 = nowMs();
  while(W.i < W.jobs.length){
    const t1 = nowMs(); W.jobs[W.i++](); const dt = nowMs()-t1; if(dt > W.maxJob) W.maxJob = dt;
    if(nowMs()-t0 >= budgetMs) break;
  }
  bankMs += nowMs()-t0;
  if(W.i >= W.jobs.length){ bank = W.part; return true; }
  return false;
}
function buildBank(){ if(!bank) buildBankStep(1e9); return bank; }

// =====================================================================================
//  エンジン（AudioContext ごと。実時間とオフラインで同じ構成）
// =====================================================================================
function makeWaves(ctx){
  const mk = (amps)=>{ const n=amps.length+1, re=new Float32Array(n), im=new Float32Array(n); for(let i=1;i<n;i++) im[i]=amps[i-1]; return ctx.createPeriodicWave(re, im); };
  const pulse=[], sq=[];
  for(let n=1;n<=18;n++){ pulse.push(Math.abs(Math.sin(Math.PI*n*0.25))/n*Math.exp(-n/10)); sq.push(n%2 ? Math.exp(-n/8)/n : 0); }
  return { pulse:mk(pulse), sq:mk(sq), flute:mk([1,0.18,0.06,0.02]), bass:mk([0.9,0.5,0.3,0.16,0.08,0.04]) };
}
function toBuf(ctx, data){ const b = ctx.createBuffer(1, data.length, SR); b.getChannelData(0).set(data); return b; }
function makeEngine(ctx, opt){
  opt = opt || {};
  const B = buildBank();
  const E = { ctx, offline: !!opt.offline, dupKinds:{}, live:0, liveMusic:0, liveSfx:0, liveNodes:0, made:0, log:null, players:[] };
  const master = ctx.createGain(); master.gain.value = opt.offline ? 0.8 : (muted ? 0 : volume);
  const lim = ctx.createDynamicsCompressor();
  lim.threshold.value = -6; lim.knee.value = 4; lim.ratio.value = 12; lim.attack.value = 0.002; lim.release.value = 0.16;
  master.connect(lim);
  // 最後の保険：0.7 までは素通し、その上はなめらかに 0.98 で頭打ち（コンプの自動メイクアップ＋速い立ち上がりでも 1.0 を越えない）
  let tail = lim;
  if(ctx.createWaveShaper){
    const ws = ctx.createWaveShaper(), NC = 1024, cv = new Float32Array(NC);
    for(let i=0;i<NC;i++){ const x = i/(NC-1)*2-1, a = Math.abs(x); cv[i] = Math.sign(x)*(a<=0.7 ? a : 0.7 + 0.28*Math.tanh((a-0.7)/0.28)); }
    ws.curve = cv; lim.connect(ws); tail = ws;
  }
  if(opt.quad){
    // オフライン検証：ch0/1 = リミッタ後、ch2/3 = リミッタ前
    const mg = ctx.createChannelMerger(4), s1 = ctx.createChannelSplitter(2), s2 = ctx.createChannelSplitter(2);
    tail.connect(s1); master.connect(s2);
    s1.connect(mg,0,0); s1.connect(mg,1,1); s2.connect(mg,0,2); s2.connect(mg,1,3);
    ctx.destination.channelInterpretation = 'discrete';
    mg.connect(ctx.destination);
  } else tail.connect(ctx.destination);
  const music = ctx.createGain(); music.gain.value = MUSIC_GAIN; music.connect(master);
  const sfxg = ctx.createGain(); sfxg.gain.value = SFX_GAIN; sfxg.connect(master);
  // 小さな部屋：低域を切った送り → フィードバック・ディレイ → 高域を丸める → 音楽バスへ
  const rin = ctx.createGain(), hp = ctx.createBiquadFilter(), dl = ctx.createDelay(1.5), damp = ctx.createBiquadFilter(), fb = ctx.createGain(), wet = ctx.createGain();
  hp.type='highpass'; hp.frequency.value=380; dl.delayTime.value=0.33; damp.type='lowpass'; damp.frequency.value=3200; fb.gain.value=0.28; wet.gain.value=0.3;
  rin.connect(hp); hp.connect(dl); dl.connect(damp); damp.connect(fb); fb.connect(dl); damp.connect(wet); wet.connect(music);
  // 効果音の定位（毎回パナーを作らず、5か所を共有）
  const pans = [];
  if(ctx.createStereoPanner){ for(const p of [-0.6,-0.3,0,0.3,0.6]){ if(p===0){ pans.push(sfxg); continue; } const n=ctx.createStereoPanner(); n.pan.value=p; n.connect(sfxg); pans.push(n); } }
  E.master=master; E.lim=lim; E.music=music; E.sfx=sfxg; E.pans=pans; E.room={ in:rin, dl, fb, wet };
  E.waves = makeWaves(ctx);
  E.bufs = { inst:{}, drum:{}, noise: toBuf(ctx, B.noise) };
  for(const k in B.inst) E.bufs.inst[k] = B.inst[k].map((s)=> ({ base:s.base, buf: toBuf(ctx, s.data) }));
  for(const k in B.drum) E.bufs.drum[k] = toBuf(ctx, B.drum[k]);
  return E;
}
function track(E, src, nodes, sfx, lbl){
  E.live++; E.liveNodes += nodes.length+1; E.made += nodes.length+1; E.nTrack = (E.nTrack||0)+1;
  if(sfx) E.liveSfx++; else E.liveMusic++;
  let ended = false;
  src.onended = ()=>{
    E.nEnded = (E.nEnded||0)+1;
    if(ended){ E.nDup = (E.nDup||0)+1; if(E.dupKinds) E.dupKinds[lbl] = (E.dupKinds[lbl]||0)+1; return; }
    ended = true;
    E.live--; E.liveNodes -= nodes.length+1; if(sfx) E.liveSfx--; else E.liveMusic--;
    for(let i=0;i<nodes.length;i++){ try{ nodes[i].disconnect(); }catch(_){} }
    try{ src.disconnect(); }catch(_){}
  };
}

// ---------------------------------------------------------------- 楽器
function playSample(E, dest, inst, m, t, dur, v, sfx){
  const set = E.bufs.inst[inst]; if(!set) return;
  const def = SAMPLED[inst];
  let b = set[0]; for(let i=1;i<set.length;i++) if(Math.abs(set[i].base-m) < Math.abs(b.base-m)) b = set[i];
  const c = E.ctx, s = c.createBufferSource(), g = c.createGain();
  s.buffer = b.buf;
  const rate = Math.pow(2, (m-b.base)/12); s.playbackRate.value = rate;
  const natural = b.buf.duration/rate;
  const len = Math.min(natural, Math.max(0.05, dur) + def.ring);
  const vv = v*def.gain;
  g.gain.setValueAtTime(vv, t);
  if(len < natural-0.02) g.gain.setTargetAtTime(0, t+len-0.05, 0.018);
  s.connect(g); g.connect(dest);
  s.start(t);
  // バッファの自然な終わりと同じ時刻に stop すると Chrome は ended を2回出す（実測）。短くするときだけ止める
  if(len+0.06 < natural-0.01) s.stop(t+len+0.06);
  track(E, s, [g], sfx, inst);
}
const KIT = { k:0.95, s:0.5, c:0.45, sn:0.42, h:0.2, oh:0.22, sh:0.17, wb:0.32, cb:0.16, tb:0.18, sl:0.26, tk:0.85, tm:0.5, cr:0.24 };
function playDrum(E, dest, name, t, v, sfx){
  const b = E.bufs.drum[name]; if(!b) return;
  const c = E.ctx, s = c.createBufferSource(), g = c.createGain();
  s.buffer = b; g.gain.value = v*(KIT[name]||0.5);
  if(name==='h' || name==='sh' || name==='sl') s.playbackRate.value = 0.97 + Math.random()*0.06;
  s.connect(g); g.connect(dest); s.start(t);
  track(E, s, [g], sfx, 'drum');
}
function playLead(E, dest, inst, m, t, dur, v, last, sfx){
  const c = E.ctx, o = c.createOscillator(), g = c.createGain();
  o.setPeriodicWave(E.waves[inst==='flute' ? 'flute' : inst==='sq' ? 'sq' : 'pulse']);
  const f = mtof(m);
  if(inst==='flute' && last && last.m!==m && Math.abs(t-last.end) < 0.03){
    o.frequency.setValueAtTime(mtof(last.m), t); o.frequency.exponentialRampToValueAtTime(f, t+0.06);
  } else {
    o.frequency.setValueAtTime(f, t);
    o.detune.setValueAtTime(inst==='flute' ? -20 : -35, t); o.detune.linearRampToValueAtTime(0, t+0.03);
  }
  const att = inst==='flute' ? 0.025 : 0.006, d = Math.max(0.06, dur*0.92);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v, t+att);
  g.gain.setTargetAtTime(v*(inst==='flute'?0.85:0.62), t+att, 0.09);
  g.gain.setTargetAtTime(0, t+d, 0.03);
  o.connect(g); g.connect(dest);
  const nodes = [g];
  if(d > 0.26){
    const l = c.createOscillator(), lg = c.createGain();
    l.frequency.value = 5.4; lg.gain.setValueAtTime(0, t); lg.gain.linearRampToValueAtTime(inst==='flute'?16:11, t+Math.min(0.3, d*0.7));
    l.connect(lg); lg.connect(o.detune); l.start(t); l.stop(t+d+0.2); nodes.push(l, lg);
  }
  o.start(t); o.stop(t+d+0.2);
  track(E, o, nodes, sfx, 'lead');
  if(last){ last.m = m; last.end = t+dur; }
}
function playBass(E, dest, m, t, dur, v){
  const c = E.ctx, o = c.createOscillator(), g = c.createGain();
  o.setPeriodicWave(E.waves.bass);
  const f = mtof(m); o.frequency.setValueAtTime(f*1.025, t); o.frequency.exponentialRampToValueAtTime(f, t+0.035);
  const d = Math.max(0.06, dur*0.9);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v, t+0.005);
  g.gain.setTargetAtTime(v*0.5, t+0.005, 0.1); g.gain.setTargetAtTime(0, t+d, 0.025);
  o.connect(g); g.connect(dest); o.start(t); o.stop(t+d+0.15);
  track(E, o, [g], 0, 'bass');
}
function playBrass(E, dest, ms, t, dur, v, sfx){
  const c = E.ctx, arr = Array.isArray(ms) ? ms : [ms];
  const flt = c.createBiquadFilter(), g = c.createGain();
  flt.type='lowpass'; flt.Q.value=1.2;
  const d = Math.max(0.08, dur*0.9), peakF = 900 + 2600*v;
  flt.frequency.setValueAtTime(350, t); flt.frequency.exponentialRampToValueAtTime(peakF, t+0.035); flt.frequency.setTargetAtTime(peakF*0.5, t+0.05, 0.12);
  const vv = v/Math.sqrt(arr.length)*0.55;
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vv, t+0.015);
  g.gain.setTargetAtTime(vv*0.7, t+0.03, 0.15); g.gain.setTargetAtTime(0, t+d, 0.04);
  flt.connect(g); g.connect(dest);
  const oscs = [];
  const add = (m, det)=>{ const o=c.createOscillator(); o.type='sawtooth'; o.frequency.value=mtof(m); o.detune.value=det; o.connect(flt); o.start(t); o.stop(t+d+0.25); oscs.push(o); };
  for(let i=0;i<arr.length;i++) add(arr[i], i%2 ? 7 : -5);
  if(arr.length===1) add(arr[0], 9);
  track(E, oscs[0], [flt, g].concat(oscs.slice(1)), sfx, 'brass');
}
// 曲のイベントを鳴らす（楽器名 → 実装）。オフラインでは実際に渡った音を E.log に記録する（検証用）
function play(E, dest, c, inst, m, t, dur, v, P){
  if(E.log && inst!=='drum'){
    if(Array.isArray(m)){ for(const x of m) E.log.push({ c, m:x, d:dur }); } else E.log.push({ c, m, d:dur });
  }
  if(inst==='drum') return playDrum(E, dest, m, t, v);
  if(SAMPLED[inst]){
    if(Array.isArray(m)){ for(let i=0;i<m.length;i++) playSample(E, dest, inst, m[i], t+i*0.01, dur, v); return; }
    return playSample(E, dest, inst, m, t, dur, v);
  }
  switch(inst){
    case 'pulse': case 'sq': case 'flute': {
      const last = P ? (P.last[c] || (P.last[c] = { m:-1, end:-1 })) : null;
      if(Array.isArray(m)){ for(const x of m) playLead(E, dest, inst, x, t, dur, v*0.6, null); return; }
      return playLead(E, dest, inst, m, t, dur, v, last);
    }
    case 'bass': return playBass(E, dest, m, t, dur, v);
    case 'brass': return playBrass(E, dest, m, t, dur, v);
  }
}

// =====================================================================================
//  曲の書式と翻訳（コンパイル）
//   メロディ：音階の度数。1..7（8=1', 9=2'）、' で1オクターブ上、, で下、b/# で半音。 - = のばす、. = 休み
//   コード：ローマ数字（大文字=長三和音、小文字=短三和音、o=減、7/M7/sus/add9、b で半音下げ）。1小節に "IV/V" で2つ
// =====================================================================================
const MODES = { major:[0,2,4,5,7,9,11], lydian:[0,2,4,6,7,9,11], mixo:[0,2,4,5,7,9,10] };
const ROMAN = ['i','ii','iii','iv','v','vi','vii'];
function parseDeg(tok){
  let i=0, acc=0;
  while(tok[i]==='b' || tok[i]==='#'){ acc += tok[i]==='b' ? -1 : 1; i++; }
  const d = tok.charCodeAt(i)-48; if(!(d>=1 && d<=9)) return null; i++;
  let oct = d>=8 ? 1 : 0;
  for(; i<tok.length; i++){ const ch=tok[i]; if(ch==="'") oct++; else if(ch===',') oct--; else return null; }
  return { acc, deg:(d-1)%7, oct };
}
function degSemi(p, mode, shift, noAcc){
  let deg = p.deg + (shift||0), oct = p.oct;
  while(deg<0){ deg+=7; oct--; } while(deg>6){ deg-=7; oct++; }
  return MODES[mode][deg] + (noAcc ? 0 : p.acc) + 12*oct;
}
function parseChord(tok, mode){
  let i=0, acc=0;
  while(tok[i]==='b' || tok[i]==='#'){ acc += tok[i]==='b' ? -1 : 1; i++; }
  let j=i; while(j<tok.length && 'IViv'.indexOf(tok[j])>=0) j++;
  const rn = tok.slice(i,j), deg = ROMAN.indexOf(rn.toLowerCase()); if(deg<0) return null;
  const up = rn===rn.toUpperCase(), rest = tok.slice(j);
  const dim = rest.indexOf('o')>=0;
  const tones = rest.indexOf('sus')>=0 ? [0,5,7] : dim ? [0,3,6] : [0, up?4:3, 7];
  if(rest.indexOf('M7')>=0) tones.push(11); else if(rest.indexOf('7')>=0) tones.push(dim?9:10);
  if(rest.indexOf('add9')>=0) tones.push(14);
  return { root: MODES[mode][deg]+acc, tones };
}
function voicing(S, ch, lo){
  const out = [];
  for(const t of ch.tones){ const pc = S.key + ch.root + t; out.push(lo + (((pc-lo)%12)+12)%12); }
  out.sort((a,b)=>a-b);
  return out;
}
const COMP = { off:'.x.x.x.x', strum:'x.xu.uxu', march:'..x...x.', pizz8:'a.a.a.a.', arp8:'aaaaaaaa', stab:'x..x..x.', push:'x.x..x.x', jig:'..x..x..x..x', hit:'x-------' };
const COMP_LO = { uke:55, pizz:55, marimba:60, brass:55, glock:72, celesta:67, xylo:67, pulse:60, sq:60, flute:60 };
const BASS = { bounce:'R.5.O.5.', march:'R-..5-..', drive:'RRORRROR', boss:'R.RR.RO5', two:'R-..5-..', fest:'R.R5.5OA', jig:'R-.5-.R-.5-.', slow:'R---5--A', hit:'R-------' };
const DRUMS = {
  march: { k:'X.......X.......', s:'....X..o....X.oo', sh:'o.o.o.o.o.o.o.o.', fill:{ s:'X.ooX.ooX.oXoXXX' } },
  roll:  { k:'X.......X.......|X...............', s:'....o.o.o.o.o.o.|oooooooxxxxxXXXX' },
  pop:   { k:'X.....x.X.......', s:'....X.......X...', h:'..x...x...x...x.', sh:'o.o.o.o.o.o.o.o.', fill:{ k:'X.....x.X.x.....', s:'....X.......XoXX', tm:'........x.x.....' } },
  pop2:  { k:'X.....x.X.....x.', s:'....X.......X...', c:'....x.......x...', h:'x.x.x.x.x.x.x.x.', sh:'.o.o.o.o.o.o.o.o', fill:{ s:'....X...X.XoXXXX', tm:'........x.x.x...' } },
  select:{ k:'X...X...X...X...', c:'....X.......X...', h:'..x...x...x...x.', sh:'.o.o.o.o.o.o.o.o', fill:{ c:'....X.......X.XX', tm:'..........x.x...' } },
  fest:  { tk:'X.......X..x....', c:'....X.......X...', wb:'..x...x...x...xo', sh:'o.o.o.o.o.o.o.o.', fill:{ tk:'X.x.X.x.X.X.XXXX' } },
  fest2: { tk:'X..x....X..x..x.', c:'....X.......X...', wb:'..x...x...x...xo', cb:'x.......x.......', sh:'o.o.o.o.o.o.o.o.', fill:{ tk:'X.x.X.x.X.X.XXXX' } },
  night: { k:'X.......x.......', sn:'....x.......x...', sh:'o.o.o.o.o.o.o.o.', wb:'......o.......o.', fill:{ sn:'....x.......x.x.', wb:'......o...o.o.o.' } },
  cave:  { k:'X..x..x.X.......', s:'....X.......X...', h:'..x...x...x...x.', wb:'x.......x.......', fill:{ s:'....X.......XoXX', tm:'........x.x.....' } },
  cave2: { k:'X..x..x.X..x....', s:'....X.......X...', h:'x.x.x.x.x.x.x.x.', wb:'x...o...x...o...', fill:{ s:'....X...XoXoXXXX', tm:'........x.x.....' } },
  jig:   { k:'X.....X.....', s:'...X.....X..', h:'x.xx.xx.xx.x', fill:{ s:'...X..X.XXXX', tm:'......x.x...' } },
  jig2:  { k:'X.....X.....', s:'...X.....X..', h:'x.xx.xx.xx.x', tb:'...x.....x..', fill:{ s:'...X..X.XXXX', tm:'......x.x...' } },
  snow:  { k:'X.......X.......', c:'....X.......X...', sl:'x.o.x.o.x.o.x.o.', fill:{ sl:'xoxoxoxoxoxoxoxo', c:'....X.......XoX.' } },
  snow2: { k:'X.....x.X.......', c:'....X.......X...', sl:'xoxoxoxoxoxoxoxo', fill:{ c:'....X.......XoXX', tm:'........x.x.....' } },
  castle:{ k:'X..x..x.X..x....', s:'....X.......X...', h:'x.x.x.x.x.x.x.x.', fill:{ s:'....X...XoXoXXXX', tm:'........x.x.x...' } },
  boss:  { k:'X..x..x...X..x..', s:'....X.......X..o', h:'xoxoxoxoxoxoxoxo', fill:{ s:'....X...XoXoXXXX', tm:'........x.x.x.x.' } },
  boss2: { k:'X..x..x...X..x..', s:'....X.......X..o', h:'xoxoxoxoxoxoxoxo', cb:'x.....x.....x...', fill:{ s:'....X...XoXoXXXX', tm:'........x.x.x.x.' } },
  final: { k:'X..x..X.X..x..X.', s:'....X.......X...', h:'xoxoxoxoxoxoxoxo', tk:'X.......X.......', fill:{ s:'....X..oXoXoXXXX', tm:'X.x.X.x.........' } },
  final2:{ k:'X..x..X.X..x..X.', s:'....X.......X..o', h:'xoxoxoxoxoxoxoxo', tk:'X.......X..x....', c:'....x.......x...', fill:{ s:'....X..oXoXoXXXX', tm:'X.x.X.x.X.x.....' } },
  ending:{ k:'X.......x.x.....', sn:'....x.......x...', sh:'o.o.o.o.o.o.o.o.', fill:{ sn:'....x.......x.x.' } },
};
const CHANS = ['lead','m2','chord','bass','drum','fx'];
const MIXDEF = { lead:0.34, m2:0.2, chord:0.24, bass:0.42, drum:0.5, fx:0.3 };
const SENDDEF = { lead:0.18, m2:0.3, chord:0.12, bass:0, drum:0.04, fx:0.35 };

// =====================================================================================
//  曲データ（すべて長調／リディア／ミクソリディア。明るく、区間 A・B で飽きさせない）
// =====================================================================================
const SONGS = {
  // タイトル：あたたかい行進曲（ヘ長調 118）
  title: { bpm:118, key:65, mode:'major', loopFrom:1, room:{ beats:0.75, fb:0.24, wet:0.26 },
    ph:{
      i1:"1' 5 3 5 1' - - - | 7 - 2' - 5' - - -",
      a1:"1 - 3 5 1' - 5 - | 6 - 4 6 1' - 6 -",
      a2:"5 - 3 5 4 3 2 1 | 2 - - - 5, - - -",
      a3:"1 - 3 5 1' - 5 - | 6 - 4 6 1' - 2' -",
      a4:"3' - 2' - 7 - 5 - | 1' - - - . . . .",
      b1:"4 4 6 1' - 6 4 - | 3 3 5 1' - 5 3 -",
      b2:"4 4 6 1' - 2' 1' - | 7 - 2' - 5 - - -",
      b3:"3' - 1' - 6 - 1' - | 6 - 4 - 1' - 6 -",
      b4:"2' - 6 - 4 - 6 - | 7 - 1' 2' 3' 2' 1' 7" },
    sec:{
      I: { ch:"I V", mel:"i1", lead:'glock', comp:'march:pizz', bass:'march', drum:'roll', fill:false, gl:'up', crash:false },
      A: { ch:"I IV I V I IV V I", mel:"a1 a2 a3 a4", lead:'flute', m2:'fill:glock', comp:'march:pizz', bass:'march', drum:'march' },
      B: { ch:"IV I IV V vi IV ii V", mel:"b1 b2 b3 b4", lead:'flute', m2:'arp:marimba', comp:'off:uke', bass:'bounce', drum:'march' },
      A2:{ from:'A', lead:'pulse', m2:'double:glock' },
      B2:{ from:'B', lead:'pulse', m2:'third:marimba', gl:'up' } },
    order:['I','A','B','A2','B2'] },

  // キャラ選択：みじかく元気なループ（ハ長調 128）
  select: { bpm:128, key:72, mode:'major', room:{ beats:0.75, fb:0.2, wet:0.2 },
    ph:{
      a1:"5 . 5 3 5 . 1' . | 6 . 6 5 6 . 1' .",
      a2:"4 . 4 3 4 . 6 . | 5 - 7 - 2' - . .",
      a3:"5 . 5 3 5 . 1' . | 6 . 6 5 6 . 3' .",
      a4:"2' . 1' . 6 . 7 . | 1' - - . . . . .",
      b1:"1' - 6 - 4 - . . | 2' - 7 - 5 - . .",
      b2:"3' - 7 - 5 - . . | 1' - 6 - 3 - . .",
      b3:"4 - 6 - 1' - 4' - | 2' - 7 - 5 - 2' -",
      b4:"3' - 2' 1' 2' - 5 - | 1' - . . . . . ." },
    sec:{
      A:{ ch:"I vi IV V I vi IV/V I", mel:"a1 a2 a3 a4", lead:'marimba', m2:'fill:glock', comp:'off:pizz', bass:'bounce', drum:'select' },
      B:{ ch:"IV V iii vi IV V I I", mel:"b1 b2 b3 b4", lead:'glock', m2:'arp:marimba', comp:'off:pizz', bass:'bounce', drum:'select', gl:'up' } },
    order:['A','B'] },

  // 1: おうとの まちはずれ — はれた日の ぼうけん（ト長調 136）
  stage1: { bpm:136, key:67, mode:'major', room:{ beats:0.75, fb:0.22, wet:0.22 },
    ph:{
      a1:"1 - 2 3 5 - 3 - | 2 - 1 2 5, - - -",
      a2:"3 - 5 6 1' - 6 5 | 4 - 3 4 6 - 1' -",
      a3:"1 - 2 3 5 - 3 - | 2 - 1 2 5 - 7 -",
      a4:"1' - 7 6 4 - 6 - | 5 - - - . . . .",
      b1:". 6 6 1' - 6 1' 3' | . 4 4 6 - 4 6 1'",
      b2:". 5 5 1' - 5 1' 3' | 2' - - - 7 - 5 -",
      b3:". 6 6 1' - 6 1' 3' | . 4 4 6 - 1' 4' 3'",
      b4:"2' - 1' - 7 - 5 - | 5 - 4 - 3 - 2 -" },
    sec:{
      A: { ch:"I V vi IV I V IV I", mel:"a1 a2 a3 a4", lead:'pulse', m2:'fill:glock', comp:'off:uke', bass:'bounce', drum:'pop' },
      B: { ch:"vi IV I V vi IV V V", mel:"b1 b2 b3 b4", lead:'pulse', m2:'arp:marimba', comp:'strum:uke', bass:'bounce', drum:'pop' },
      A2:{ from:'A', lead:'xylo', m2:'double:glock', drum:'pop2' },
      B2:{ from:'B', m2:'third:xylo', drum:'pop2', gl:'up' } },
    order:['A','B','A2','B2'] },

  // 2: たそがれの じょうかまち — おまつり（ニ長調・ヨナ抜き 132）
  stage2: { bpm:132, key:62, mode:'major', m2lo:74, room:{ beats:0.75, fb:0.24, wet:0.24 },
    ph:{
      a1:"1' - 6 5 6 - 5 3 | 5 - 3 2 1 - 2 -",
      a2:"3 - 5 6 1' - 6 5 | 6 - - - 5 - - -",
      a3:"1' - 6 5 6 - 5 3 | 5 - 3 2 1 - 2 3",
      a4:"5 - 3 2 3 - 2 1 | 1 - - - . . . .",
      b1:"6 6 . 6 5 - 3 - | 5 5 . 5 3 - 2 -",
      b2:"3 3 . 3 2 - 1 - | 2 - 3 - 5 - . .",
      b3:"6 6 . 6 1' - 6 - | 5 5 . 5 6 - 5 -",
      b4:"3 - 5 - 6 - 1' - | 2' - - - 1' - 6 -" },
    sec:{
      A: { ch:"I IV I V I IV V I", mel:"a1 a2 a3 a4", lead:'flute', m2:'fill:marimba', comp:'off:pizz', bass:'fest', drum:'fest' },
      B: { ch:"vi V IV I vi V ii V", mel:"b1 b2 b3 b4", lead:'marimba', m2:'double:glock', comp:'off:pizz', bass:'fest', drum:'fest' },
      A2:{ from:'A', m2:'third:marimba', drum:'fest2' },
      B2:{ from:'B', lead:'pulse', m2:'fill:glock', drum:'fest2', gl:'up' } },
    order:['A','B','A2','B2'] },

  // 3: つくよみの もり — まほうの夜（ハ・リディア 124、チェレスタ＋ピチカート）
  stage3: { bpm:124, key:72, mode:'lydian', room:{ beats:0.75, fb:0.32, wet:0.34 },
    ph:{
      a1:"5 - 3 - 1 2 3 5 | 4 - 2 - 6, 1 2 4",
      a2:"5 - 3 - 1 2 3 5 | 6 - - - 4 - - -",
      a3:"5 - 1' - 3' - 1' - | 6 - 4 - 2 - 4 -",
      a4:"5 - 7 - 2' - 7 - | 1' - - - . . . .",
      b1:"1' - - 5 3 - - 5 | 2' - - 6 4 - - 6",
      b2:"7 - - 5 3 - 5 7 | 6 - 4 - 2 - - -",
      b3:"1' - - 5 3 - - 5 | 2' - - 6 4 - 6 1'",
      b4:"7 - 2' - 5' - 2' - | 1' - - - 5 - 3 -" },
    sec:{
      A: { ch:"I II I II I II V I", mel:"a1 a2 a3 a4", lead:'celesta', m2:'fill:glock', comp:'pizz8:pizz', bass:'two', drum:'night', gl:'up' },
      B: { ch:"I II iii II I II V I", mel:"b1 b2 b3 b4", lead:'flute', m2:'arp:celesta', comp:'pizz8:pizz', bass:'two', drum:'night' },
      A2:{ from:'A', m2:'double:glock', comp:'off:pizz' },
      B2:{ from:'B', lead:'glock', m2:'third:celesta', gl:'up' } },
    order:['A','B','A2','B2'] },

  // 4: るりの すいしょうどう — ベルと こだま（イ長調 128）
  stage4: { bpm:128, key:69, mode:'major', room:{ beats:0.75, fb:0.42, wet:0.45 },
    ph:{
      a1:"1' - 5 - 3 - 5 - | 7 - 5 - 3 - 7, -",
      a2:"6 - 1' - 3' - 1' - | 4 - 6 - 1' - 6 -",
      a3:"1' - 5 - 3 - 5 - | 7 - 5 - 3 - 5 -",
      a4:"4 - 6 - 1' - 4' - | 2' - - - 7 - 5 -",
      b1:". 1' . 6 . 4 . 6 | . 2' . 7 . 5 . 7",
      b2:". 3' . 7 . 5 . 7 | . 1' . 6 . 3 . 6",
      b3:". 2' . 6 . 4 . 6 | . 7 . 5 . 2 . 5",
      b4:"1' - 3' - 5' - 3' - | 1' - - - . . . ." },
    sec:{
      A: { ch:"I iii vi IV I iii IV V", mel:"a1 a2 a3 a4", lead:'glock', m2:'fill:marimba', comp:'off:marimba', bass:'bounce', drum:'cave' },
      B: { ch:"IV V iii vi ii V I I", mel:"b1 b2 b3 b4", lead:'xylo', m2:'double:glock', comp:'off:marimba', bass:'bounce', drum:'cave' },
      A2:{ from:'A', m2:'third:xylo', drum:'cave2' },
      B2:{ from:'B', m2:'fill:glock', drum:'cave2', gl:'up' } },
    order:['A','B','A2','B2'] },

  // 5: かいぞく ひこうてい — 6/8 のジグ（ト長調 付点4分=132、B は bVII でミクソリディア風）
  stage5: { bpm:132, key:67, mode:'major', spb:3, bpb:4, room:{ beats:0.5, fb:0.2, wet:0.2 },
    ph:{
      a1:"1 - 3 5 - 3 1' - 7 6 - 5 | 4 - 6 1' - 6 4 - 6 1' - -",
      a2:"5 - 3 1 - 3 5 - 6 5 - 3 | 2 - 3 2 - 1 7, - 1 2 - -",
      a3:"1 - 3 5 - 3 1' - 7 6 - 5 | 4 - 6 1' - 6 4' - 3' 2' - 1'",
      a4:"7 - 1' 2' - 7 5 - 6 7 - 2' | 1' - - 5 - - 1' - - . . .",
      b1:"1' - 1' 1' - 7 1' - 2' 3' - 1' | b7 - b7 b7 - 6 b7 - 1' 2' - b7",
      b2:"6 - 6 6 - 5 6 - 1' 4' - 1' | 5 - 3 1 - 3 5 - - . . .",
      b3:"1' - 1' 1' - 7 1' - 2' 3' - 1' | b7 - b7 b7 - 6 b7 - 1' 2' - 4'",
      b4:"3' - 2' 1' - 6 4 - 6 1' - 6 | 7 - 1' 2' - 1' 7 - 6 5 - -" },
    sec:{
      A: { ch:"I IV I V I IV V I", mel:"a1 a2 a3 a4", lead:'pulse', m2:'fill:xylo', comp:'jig:uke', bass:'jig', drum:'jig' },
      B: { ch:"I bVII IV I I bVII IV V", mel:"b1 b2 b3 b4", lead:'pulse', m2:'third:marimba', comp:'jig:brass', bass:'jig', drum:'jig' },
      A2:{ from:'A', lead:'xylo', m2:'double:glock', drum:'jig2' },
      B2:{ from:'B', lead:'flute', drum:'jig2', gl:'up' } },
    order:['A','B','A2','B2'] },

  // 6: ひょうせつの れいほう — すずの なる ゆきみち（変ロ長調 144）
  stage6: { bpm:144, key:70, mode:'major', room:{ beats:0.75, fb:0.28, wet:0.28 },
    ph:{
      a1:"5 - 5 6 5 - 3 - | 1' - 1' 2' 1' - 6 -",
      a2:"4 - 4 6 4 - 2 - | 5 - 7 - 2' - - -",
      a3:"5 - 5 6 5 - 3 - | 1' - 1' 2' 1' - 6 -",
      a4:"6 - 4 - 2' - 7 - | 1' - - - . . . .",
      b1:"4' - 1' - 6 - 1' - | 3' - 1' - 5 - 1' -",
      b2:"4' - 1' - 6 - 4 - | 5 - 3 - 1 - 3 -",
      b3:"2' - 6 - 4 - 6 - | 2' - 7 - 5 - 7 -",
      b4:"1' - 3' - 5' - 3' - | 2' - - - 7 - - -" },
    sec:{
      A: { ch:"I vi ii V I vi IV/V I", mel:"a1 a2 a3 a4", lead:'celesta', m2:'fill:glock', comp:'off:pizz', bass:'two', drum:'snow' },
      B: { ch:"IV I IV I ii V I V", mel:"b1 b2 b3 b4", lead:'flute', m2:'arp:celesta', comp:'strum:uke', bass:'bounce', drum:'snow' },
      A2:{ from:'A', lead:'glock', m2:'third:celesta', drum:'snow2' },
      B2:{ from:'B', lead:'pulse', m2:'double:glock', drum:'snow2', gl:'up' } },
    order:['A','B','A2','B2'] },

  // 7: ダークワンワンじょう — ゆうかんで わくわく（ニ・ミクソリディア 144）
  stage7: { bpm:144, key:62, mode:'mixo', room:{ beats:0.75, fb:0.24, wet:0.24 },
    ph:{
      a1:"1 - - 5, 1 - 3 - | 2 - - 1 7, - 5, -",
      a2:"4 - - 3 4 - 6 - | 5 - - - 3 - 1 -",
      a3:"1 - - 5, 1 - 3 - | 4 - - 2 7, - 2 -",
      a4:"1' - - 6 4 - 6 - | 1 - - - . . 5, 7,",
      b1:". 6 . 6 1' - 6 - | . 7 . 7 2' - 7 -",
      b2:". 1' . 1' 3' - 1' 5 | 3' - 2' - 1' - 5 -",
      b3:". 6 . 6 1' - 3' - | . 7 . 7 2' - 4' -",
      b4:"3' - 1' - 6 - 4 - | 2' - 7 - 5 - 4 -" },
    sec:{
      A: { ch:"I VII IV I I VII IV I", mel:"a1 a2 a3 a4", lead:'pulse', m2:'double:xylo', comp:'stab:brass', bass:'drive', drum:'castle' },
      B: { ch:"vi VII I I vi VII IV VII", mel:"b1 b2 b3 b4", lead:'brass', m2:'fill:glock', comp:'off:marimba', bass:'drive', drum:'castle' },
      A2:{ from:'A', m2:'third:glock' },
      B2:{ from:'B', m2:'arp:xylo', gl:'up' } },
    order:['A','B','A2','B2'] },

  // ボス：シンコペーションで ぐいぐい（ホ長調 150）
  boss: { bpm:150, key:64, mode:'major', room:{ beats:0.75, fb:0.2, wet:0.18 },
    ph:{
      a1:"1 - 1 5 - 3 - 1 | 4 - 4 1' - 6 - 4",
      a2:"3 - 5 1' - 5 - 3 | 2 - - 7, - 5, - -",
      a3:"1 - 1 5 - 3 - 1 | 4 - 4 1' - 6 - 1'",
      a4:"1' - - b6 2' - - b7 | 3' - 2' - 1' - - -",
      b1:"1' - 1' 6 - 1' - 4' | 2' - 2' 7 - 2' - 5'",
      b2:"3' - 2' 7 - 5 - 7 | 1' - - 6 - - 3 -",
      b3:"4 - 6 1' - 6 1' 4' | 5' - 4' 2' - 7 2' -",
      b4:"6 - 4 6 1' - 4' - | 5' - 4' - 2' - 7 -" },
    sec:{
      A: { ch:"I IV I V I IV bVI/bVII I", mel:"a1 a2 a3 a4", lead:'pulse', m2:'arp:xylo:16', comp:'stab:brass', bass:'boss', drum:'boss' },
      B: { ch:"IV V iii vi IV V IV V", mel:"b1 b2 b3 b4", lead:'pulse', m2:'double:glock', comp:'push:brass', bass:'drive', drum:'boss' },
      A2:{ from:'A', m2:'third:marimba', drum:'boss2' },
      B2:{ from:'B', m2:'fill:xylo', drum:'boss2', gl:'up' } },
    order:['A','B','A2','B2'] },

  // ラスボス：壮大でゆうかん（ハ長調 148、ブラスの刻み）
  final: { bpm:148, key:60, mode:'major', room:{ beats:0.75, fb:0.24, wet:0.22 },
    ph:{
      a1:"1 - - 1 5 - - 5 | 7 - - 7 2' - 7 -",
      a2:"1' - - 1' 3' - 1' - | 7 - - 5 3 - - -",
      a3:"4 - - 6 1' - 4' - | 3' - - 1' 5 - 3 -",
      a4:"6 - 1' - 4' - 3' - | 2' - - - 5 - 7 -",
      b1:". 3' . 3' 3' 2' 1' - | . 1' . 1' 1' 7 6 -",
      b2:". 7 . 7 2' - 5' - | 3' - - - 1' - - -",
      b3:". 3' . 3' 3' 2' 1' - | . 4' . 4' 4' 3' 1' -",
      b4:"2' - 1' - 7 - 2' - | 5' - - - 4' - 2' -" },
    sec:{
      A: { ch:"I V vi iii IV I IV V", mel:"a1 a2 a3 a4", lead:'brass', m2:'arp:xylo', comp:'stab:pizz', bass:'drive', drum:'final' },
      B: { ch:"vi IV V I vi IV V V", mel:"b1 b2 b3 b4", lead:'pulse', m2:'double:glock', comp:'stab:brass', bass:'drive', drum:'final' },
      A2:{ from:'A', m2:'arp:glock:16', drum:'final2' },
      B2:{ from:'B', m2:'third:xylo', drum:'final2', gl:'up' } },
    order:['A','B','A2','B2'] },

  // クリア：勝利のジングル（約4.6秒・くり返さない）
  clear: { bpm:156, key:72, mode:'major', loop:false, room:{ beats:0.75, fb:0.25, wet:0.3 },
    ph:{ j1:"5, . 1 . 3 . 5 . 1' - - - 3' - - - | b3' - - - - - - - 4' - - - - - - - | 5' - - - - - - - - - - - - - - -" },
    sec:{ J:{ ch:"I bVI/bVII I", mel:"j1", mres:4, lead:'pulse', m2:'double:glock', comp:'x-------|x---x---|x-------:brass', bass:'R-------|R---R---|R-------',
      drum:{ k:'X.......X.......|X.......X.......|X...............', s:'....x.......x...|oooooooxxxxxXXXX|................' }, fill:false } },
    order:['J'] },

  // ざんねん：こけちゃった「おっとっと」（約3.6秒・くり返さない、悲しくしない）
  over: { bpm:132, key:65, mode:'major', loop:false, room:{ beats:0.5, fb:0.2, wet:0.22 },
    ph:{ o1:"6 - 5 - 4 - 2 - | 1 - . 5, 1 - - -" },
    sec:{ O:{ ch:"IV/V I", mel:"o1", lead:'flute', m2:'double:marimba', comp:'x.x.x.x.|x...x---:pizz', bass:'R.R.R.R.|R...R---',
      drum:{ k:'X.......X.......|X...X...X.......', s:'....o.......o...|........X.......', wb:'x.x.x.x.x.x.x.x.|x.x.............' }, fill:false } },
    order:['O'] },

  // エンディング：あたたかく、うたえる（ト長調 96）
  ending: { bpm:96, key:67, mode:'major', swing:0.16, room:{ beats:0.75, fb:0.3, wet:0.3 },
    ph:{
      a1:"5 - - 3 1 - 3 5 | 6 - - 4 1' - 6 -",
      a2:"5 - - 3 1 - 2 3 | 2 - - - - - . .",
      a3:"5 - - 3 1 - 3 5 | 6 - - 4 1' - 2' -",
      a4:"7 - - 6 5 - 4 - | 3 - 2 - 1 - - -",
      b1:"4 - 6 - 1' - - 6 | 5 - 7 - 2' - - 7",
      b2:"1' - 7 - 1' - 3' - | 3' - - 2' 1' - - -",
      b3:"4 - 6 - 1' - 4' - | 3' - 2' - 7 - 5 -",
      b4:"1' - - 5 3 - 5 - | 1' - - - . . . ." },
    sec:{
      A: { ch:"I IV I V I IV V I", mel:"a1 a2 a3 a4", lead:'flute', m2:'fill:glock', comp:'strum:uke', bass:'slow', drum:'ending' },
      B: { ch:"IV V I vi IV V I I", mel:"b1 b2 b3 b4", lead:'pulse', m2:'third:celesta', comp:'strum:uke', bass:'slow', drum:'ending' },
      A2:{ from:'A', m2:'third:marimba' },
      B2:{ from:'B', lead:'flute', m2:'fill:glock', gl:'up' } },
    order:['A','B','A2','B2'] },
};

function resolveSec(S, name, depth){
  const s = S.sec[name]; if(!s) return null;
  if(!s.from || (depth||0) > 4) return s;
  const base = resolveSec(S, s.from, (depth||0)+1) || {};
  const out = Object.assign({}, base, s); delete out.from;
  return out;
}
function splitBars(str){ return String(str).split('|'); }
const compiled = {};
function compileSong(name){
  if(compiled[name]) return compiled[name];
  const S = SONGS[name]; if(!S) return null;
  const spb = S.spb||4, bpb = S.bpb||4, SB = spb*bpb;
  const stepDur = 60/S.bpm/spb, beat = 60/S.bpm;
  const tpb = spb===3 ? SB : bpb*2, tokSteps = SB/tpb;     // 伴奏・ベースの1文字 = 8分
  const warn = [], steps = [], starts = [];
  const rnd = mulberry(hashStr(name));
  const push = (st, ev)=>{ (steps[st] || (steps[st] = [])).push(ev); };
  let total = 0;
  S.order.forEach((sn, oi)=>{
    const sec = resolveSec(S, sn);
    if(!sec){ warn.push(name+': no section '+sn); return; }
    const base = total; starts.push(base);
    // ---- コード
    const ctoks = sec.ch.split(/\s+/).filter((x)=> x && x!=='|');
    const bars = ctoks.length, n = bars*SB;
    const chordAt = new Array(n);
    ctoks.forEach((tk, b)=>{
      const parts = tk.split('/');
      parts.forEach((p, k)=>{
        let ch = parseChord(p, S.mode); if(!ch){ warn.push(name+'.'+sn+': bad chord '+p); ch = { root:0, tones:[0,4,7] }; }
        const a = b*SB + Math.round(k*SB/parts.length), z = b*SB + Math.round((k+1)*SB/parts.length);
        for(let s=a; s<z; s++) chordAt[s] = ch;
      });
    });
    // ---- メロディ
    const mres = sec.mres || S.mres || (spb===3 ? 3 : 2), per = spb/mres;
    const notes = [];
    if(sec.mel){
      const toks = [];
      for(const ph of sec.mel.split(/\s+/)){
        if(!ph) continue;
        const src = S.ph[ph]; if(src==null){ warn.push(name+'.'+sn+': no phrase '+ph); continue; }
        for(const t of src.split(/\s+/)) if(t && t!=='|') toks.push(t);
      }
      if(toks.length !== bars*bpb*mres) warn.push(name+'.'+sn+': melody has '+toks.length+' tokens, want '+(bars*bpb*mres));
      let cur = null;
      toks.forEach((tk, k)=>{
        const st = Math.round(k*per);
        if(tk==='-'){ if(cur) cur.d += per; }
        else if(tk==='.'){ cur = null; }
        else { const p = parseDeg(tk); if(!p){ warn.push(name+'.'+sn+': bad note '+tk); cur=null; return; }
          cur = { st, d:per, p, m: S.key + degSemi(p, S.mode) }; notes.push(cur); }
      });
      const li = sec.lead || S.lead || 'pulse';
      for(const nt of notes){
        if(nt.st >= n) continue;
        const acc = (nt.st % SB)===0 ? 0.92 : (nt.st % spb)===0 ? 0.84 : 0.76;
        push(base+nt.st, { c:'lead', i:li, m:nt.m, d:nt.d, v:acc*(0.95+rnd()*0.08) });
      }
    }
    // ---- 対旋律（m2）：fill=メロディのすき間に和音の分散、arp=ずっと分散、double=オクターブ上、third=3度下のハモり
    if(sec.m2){
      const [mode2, inst2, opt2] = sec.m2.split(':');
      if(mode2==='double'){ for(const nt of notes) push(base+nt.st, { c:'m2', i:inst2, m:nt.m+12, d:nt.d, v:0.5 }); }
      else if(mode2==='third'){ for(const nt of notes) push(base+nt.st, { c:'m2', i:inst2, m:S.key+degSemi(nt.p, S.mode, -2, true), d:nt.d, v:0.55 }); }
      else if(mode2==='fill' || mode2==='arp'){
        const slot = opt2==='16' ? 1 : (spb===3 ? 1 : 2);
        const lo = sec.m2lo || S.m2lo || (mode2==='fill' ? S.key+7 : S.key-5);
        const busy = new Uint8Array(n);
        for(const nt of notes){ const e = Math.min(n, nt.st + Math.min(nt.d, spb)); for(let s=nt.st; s<e; s++) busy[s]=1; }
        const emit = (s, k, v)=>{
          const ch = chordAt[s]; const vo = voicing(S, ch, lo); vo.push(vo[0]+12);
          const L = vo.length, per2 = 2*L-2, q = k % per2, idx = q < L ? q : per2-q;
          push(base+s, { c:'m2', i:inst2, m:vo[idx], d:slot, v });
        };
        if(mode2==='arp'){ let k=0; for(let s=0; s<n; s+=slot){ emit(s, k++, 0.42 + ((s%spb)===0 ? 0.08 : 0)); } }
        else {
          // 2スロット以上続く空きだけを、下から上へ駆け上がる分散で埋める（呼びかけと返事）
          let s = 0;
          while(s < n){
            if(busy[s]){ s += slot; continue; }
            let e = s; while(e < n && !busy[e]) e += slot;
            if((e-s)/slot >= 2){ let k=0; for(let q=s; q<e; q+=slot) emit(q, k++, 0.4+0.04*Math.min(k,4)); }
            s = e;
          }
        }
      }
    }
    // ---- 伴奏（コードの刻み）
    if(sec.comp){
      const cs = sec.comp.lastIndexOf(':');
      const pat = cs>=0 ? sec.comp.slice(0, cs) : sec.comp, inst3 = cs>=0 ? sec.comp.slice(cs+1) : 'uke';
      const lines = splitBars(COMP[pat] || pat);
      const lo = sec.chordLo || S.chordLo || COMP_LO[inst3] || 57;
      for(let b=0; b<bars; b++){
        const line = lines[b % lines.length];
        if(line.length !== tpb){ warn.push(name+'.'+sn+': comp line "'+line+'" must be '+tpb); continue; }
        let ak = 0;
        for(let j=0; j<tpb; j++){
          const ch = line[j]; if(ch==='.' || ch==='-') continue;
          let j2 = j+1; while(j2 < tpb && line[j2]==='-') j2++;
          const st = b*SB + j*tokSteps, d = (j2-j)*tokSteps;
          const vo = voicing(S, chordAt[st], lo);
          if(ch==='a'){ push(base+st, { c:'chord', i:inst3, m:vo[ak++ % vo.length], d, v:0.55 }); continue; }
          if(ch==='r'){ push(base+st, { c:'chord', i:inst3, m:vo[0], d, v:0.6 }); continue; }
          const up = ch==='u', v = ch==='X' ? 0.95 : up ? 0.5 : 0.72;
          const notesC = up ? vo.slice(-3).reverse() : vo;
          if(inst3==='brass'){ push(base+st, { c:'chord', i:inst3, m:notesC, d, v }); continue; }
          const gap = inst3==='uke' ? 0.012 : 0.004;
          notesC.forEach((m, k)=> push(base+st, { c:'chord', i:inst3, m, d, v: v*(k===0?1:0.85), o:k*gap }));
        }
      }
    }
    // ---- ベース
    if(sec.bass){
      const lines = splitBars(BASS[sec.bass] || sec.bass);
      const blo = S.bassLo || 45;
      const rootM = (ch)=> blo + ((((S.key + ch.root) - blo)%12)+12)%12;
      for(let b=0; b<bars; b++){
        const line = lines[b % lines.length];
        if(line.length !== tpb){ warn.push(name+'.'+sn+': bass line "'+line+'" must be '+tpb); continue; }
        for(let j=0; j<tpb; j++){
          const t = line[j]; if(t==='.' || t==='-') continue;
          let j2 = j+1; while(j2 < tpb && line[j2]==='-') j2++;
          const st = b*SB + j*tokSteps, d = (j2-j)*tokSteps, ch = chordAt[st], r = rootM(ch);
          let m = r;
          if(t==='5') m = r+7; else if(t==='O') m = r+12; else if(t==='3') m = r+ch.tones[1]; else if(t==='L') m = r-5;
          else if(t==='A'){
            let nx = chordAt[st+tokSteps] || chordAt[(b+1)*SB] || chordAt[0];
            if(nx===ch) nx = chordAt[(b+1)*SB] || chordAt[0];
            const nr = rootM(nx), pcBelow = ((((S.key + nx.root - 2) - S.key)%12)+12)%12;
            m = MODES[S.mode].indexOf(pcBelow)>=0 ? nr-2 : nr-1;
          }
          push(base+st, { c:'bass', i:'bass', m, d, v: j===0 ? 0.95 : 0.8 });
        }
      }
    }
    // ---- ドラム（区間の最終小節はフィル）
    if(sec.drum){
      const ds = typeof sec.drum === 'object' ? sec.drum : DRUMS[sec.drum];
      if(!ds) warn.push(name+'.'+sn+': no drum style '+sec.drum);
      else {
        const insts = Object.keys(ds).filter((k)=> k!=='fill');
        if(ds.fill) for(const k in ds.fill) if(insts.indexOf(k)<0) insts.push(k);
        for(let b=0; b<bars; b++){
          const isFill = b===bars-1 && sec.fill!==false && ds.fill;
          for(const k of insts){
            let src = (isFill && ds.fill[k]!=null) ? ds.fill[k] : ds[k];
            if(src==null) continue;
            const lines = splitBars(src), line = lines[b % lines.length];
            if(line.length !== SB){ warn.push(name+'.'+sn+': drum '+k+' line must be '+SB); continue; }
            for(let j=0; j<SB; j++){
              const ch = line[j], v = ch==='X' ? 1 : ch==='x' ? 0.72 : ch==='o' ? 0.42 : 0;
              if(v) push(base + b*SB + j, { c:'drum', i:'drum', m:k, d:1, v: v*(0.94+rnd()*0.1) });
            }
          }
        }
      }
      if(sec.crash!==false) push(base, { c:'drum', i:'drum', m:'cr', d:1, v:0.75 });
    }
    // ---- 区間の終わりのグリッサンド（鉄琴でキラキラ駆け上がる）
    if(sec.gl){
      const st = (bars-1)*SB + (bpb-1)*spb, up = sec.gl==='up';
      for(let k=0; k<8; k++){
        const dg = up ? 4+k : 11-k;
        push(base+st, { c:'fx', i:sec.glInst||'glock', m: S.key + degSemi({ acc:0, deg:dg%7, oct:Math.floor(dg/7) }, S.mode), d:1, v:0.3+0.04*k, o:k*beat/8 });
      }
    }
    total += n;
  });
  const out = { name, S, spb, bpb, stepDur, L: total, loopStart: starts[S.loopFrom||0]||0, steps, warn,
    loop: S.loop!==false, swing: S.swing||0, bars: total/SB };
  compiled[name] = out;
  return out;
}

// =====================================================================================
//  再生（プレイヤー＝1曲ぶんのチャンネル群。先読みで予約する）
// =====================================================================================
function makePlayer(E, name, t0, fade){
  const song = compileSong(name); if(!song) return null;
  const c = E.ctx, S = song.S;
  const out = c.createGain(), sendG = c.createGain();
  const nodes = [out, sendG];
  for(const gp of [out.gain, sendG.gain]){
    if(fade > 0.02){ gp.setValueAtTime(0, t0); gp.linearRampToValueAtTime(1, t0+fade); } else gp.value = 1;
  }
  out.connect(E.music); sendG.connect(E.room.in);
  const ch = {}, dest = {};
  for(const k of CHANS){
    const g = c.createGain(); g.gain.value = (S.mix && S.mix[k]!=null) ? S.mix[k] : MIXDEF[k]; nodes.push(g);
    const pan = S.pan && S.pan[k]!=null ? S.pan[k] : ({ m2:0.3, chord:-0.25, fx:0.2 })[k] || 0;
    if(pan && c.createStereoPanner){ const p = c.createStereoPanner(); p.pan.value = pan; g.connect(p); p.connect(out); nodes.push(p); } else g.connect(out);
    const send = S.send && S.send[k]!=null ? S.send[k] : SENDDEF[k];
    if(send > 0){ const sg = c.createGain(); sg.gain.value = send; g.connect(sg); sg.connect(sendG); nodes.push(sg); }
    ch[k] = g; dest[k] = g;
  }
  const lp = c.createBiquadFilter(); lp.type='lowpass'; lp.frequency.value = S.leadLP || 3400; lp.Q.value = 0.5; lp.connect(ch.lead); dest.lead = lp; nodes.push(lp);
  const blp = c.createBiquadFilter(); blp.type='lowpass'; blp.frequency.value = 1500; blp.connect(ch.bass); dest.bass = blp; nodes.push(blp);
  // 部屋（ディレイ）を曲のテンポに合わせる
  const r = S.room || {}, R = E.room, at = Math.max(t0, c.currentTime);
  try{
    R.dl.delayTime.setTargetAtTime(clamp((r.beats||0.75)*60/S.bpm, 0.05, 1.4), at, 0.05);
    R.fb.gain.setTargetAtTime(r.fb==null ? 0.26 : r.fb, at, 0.05);
    R.wet.gain.setTargetAtTime(r.wet==null ? 0.28 : r.wet, at, 0.05);
  }catch(_){}
  return { name, song, E, out, sendG, nodes, dest, last:{}, pos:0, nextTime:t0, loops:0, stopping:false, done:false, dead:false };
}
function advance(P){
  const song = P.song;
  P.nextTime += song.stepDur; P.pos++;
  if(P.pos >= song.L){ if(song.loop){ P.pos = song.loopStart; P.loops++; } else P.done = true; }
}
function schedulePlayer(P, until){
  const E = P.E, song = P.song, now = E.ctx.currentTime;
  // 大きく遅れた（メインスレッドが止まった・復帰した）ときは、鳴らさずに今の位置まで進めて同期し直す
  if(!E.offline && P.nextTime < now - 0.08){ let guard = 0; while(P.nextTime < now && !P.done && guard++ < 20000) advance(P); }
  const silent = !E.offline && muted;
  while(P.nextTime < until && !P.done){
    const evs = song.steps[P.pos];
    if(evs && !silent){
      const sw = (song.swing && (P.pos % song.spb)===song.spb/2) ? song.swing*song.stepDur*2 : 0;
      const t = P.nextTime + sw;
      for(let i=0;i<evs.length;i++){
        const e = evs[i];
        try{ play(E, P.dest[e.c], e.c, e.i, e.m, t + (e.o||0), e.d*song.stepDur, e.v, P); }catch(err){ logErr('note '+P.name, err); }
      }
    }
    advance(P);
  }
}
function fadeOutPlayer(P, sec){
  if(P.stopping) return;
  P.stopping = true;
  const t = P.E.ctx.currentTime;
  holdAndFade(P.out.gain, t, sec); holdAndFade(P.sendG.gain, t, sec);
  setTimeout(()=> disposePlayer(P), (sec+2.2)*1000);
}
function disposePlayer(P){
  if(P.dead) return; P.dead = true;
  for(const n of P.nodes){ try{ n.disconnect(); }catch(_){} }
  const L = P.E.players, i = L.indexOf(P); if(i>=0) L.splice(i,1);
}

// =====================================================================================
//  効果音（すべて (E, 出力, 時刻, 音程倍率, 音量倍率, opts)）
// =====================================================================================
function sOsc(E, d, type, f0, f1, t, dur, vol, att){
  const c = E.ctx, o = c.createOscillator(), g = c.createGain();
  if(E.waves[type]) o.setPeriodicWave(E.waves[type]); else o.type = type;
  o.frequency.setValueAtTime(f0, t); if(f1 && f1!==f0) o.frequency.exponentialRampToValueAtTime(f1, t+dur);
  att = Math.min(att||0.004, dur*0.5); vol = Math.max(0.002, vol);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t+att); g.gain.exponentialRampToValueAtTime(0.0005, t+dur);
  o.connect(g); g.connect(d); o.start(t); o.stop(t+dur+0.02);
  track(E, o, [g], 1);
}
function sNoise(E, d, t, dur, vol, ftype, f0, f1, Q, att){
  const c = E.ctx, s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
  s.buffer = E.bufs.noise; f.type = ftype; f.Q.value = Q||1;
  f.frequency.setValueAtTime(f0, t); if(f1 && f1!==f0) f.frequency.exponentialRampToValueAtTime(f1, t+dur);
  att = Math.min(att||0.005, dur*0.7); vol = Math.max(0.002, vol);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t+att); g.gain.exponentialRampToValueAtTime(0.0005, t+dur);
  s.connect(f); f.connect(g); g.connect(d); s.start(t, Math.random()*0.5); s.stop(t+dur+0.02);
  track(E, s, [f, g], 1);
}
function sBell(E, d, inst, m, t, vol){ playSample(E, d, inst, m, t, 0.3, vol, 1); }
function sLead(E, d, m, t, dur, vol){ playLead(E, d, 'sq', m, t, dur, vol, null, 1); }
function boing(E, d, t, p, vol){
  const c = E.ctx, o = c.createOscillator(), g = c.createGain(), l = c.createOscillator(), lg = c.createGain();
  o.type = 'sine'; o.frequency.setValueAtTime(190*p, t); o.frequency.exponentialRampToValueAtTime(330*p, t+0.35);
  l.frequency.value = 17; lg.gain.setValueAtTime(70*p, t); lg.gain.exponentialRampToValueAtTime(3, t+0.4); l.connect(lg); lg.connect(o.frequency);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t+0.01); g.gain.setTargetAtTime(0, t+0.14, 0.09);
  o.connect(g); g.connect(d); o.start(t); l.start(t); o.stop(t+0.55); l.stop(t+0.55);
  track(E, o, [g, l, lg], 1);
}
function roar(E, d, t, p, vol){
  const c = E.ctx, bp = c.createBiquadFilter(), lp = c.createBiquadFilter(), g = c.createGain(), l = c.createOscillator(), lg = c.createGain();
  bp.type='bandpass'; bp.Q.value=2.2; bp.frequency.setValueAtTime(450, t); bp.frequency.linearRampToValueAtTime(1300, t+0.25); bp.frequency.linearRampToValueAtTime(600, t+0.85);
  lp.type='lowpass'; lp.frequency.value=2400;
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t+0.06); g.gain.setValueAtTime(vol, t+0.6); g.gain.linearRampToValueAtTime(0.0001, t+0.95);
  l.frequency.value = 7; lg.gain.value = 45; l.connect(lg);
  const oscs = [];
  const add = (f, type)=>{ const o=c.createOscillator(); o.type=type; o.frequency.setValueAtTime(f*p*0.9, t); o.frequency.linearRampToValueAtTime(f*p*1.25, t+0.2); o.frequency.linearRampToValueAtTime(f*p*0.8, t+0.95); lg.connect(o.detune); o.connect(bp); o.start(t); o.stop(t+1); oscs.push(o); };
  add(105,'sawtooth'); add(158,'sawtooth'); add(210,'square');
  bp.connect(lp); lp.connect(g); g.connect(d); l.start(t); l.stop(t+1);
  track(E, oscs[0], [bp, lp, g, l, lg, oscs[1], oscs[2]], 1);
  sNoise(E, d, t, 0.8, vol*0.18, 'lowpass', 700, 300, 0.8, 0.05);
}
// 途中で音量を 0 へ下ろす。value の読み取りは描画前だと既定値(1)を返すので、cancelAndHold を優先し、無ければ既知の値を使う
function holdAndFade(gp, t, dur, known){
  try{
    if(gp.cancelAndHoldAtTime) gp.cancelAndHoldAtTime(t);
    else { const v = known!=null ? known : gp.value; gp.cancelScheduledValues(t); gp.setValueAtTime(v, t); }
    gp.linearRampToValueAtTime(0, t+dur);
  }catch(_){}
}
let chargeV = null;
function chargeStop(at){
  const V = chargeV; if(!V) return; chargeV = null;
  try{
    const c = V.E.ctx, t = at!=null ? at : c.currentTime;
    holdAndFade(V.g.gain, t, 0.08, V.vol);
    V.o1.stop(t+0.1); V.o2.stop(t+0.1); V.l.stop(t+0.1);
  }catch(_){}
}
function chargeStart(E, d, t, p, vol, stopAt){
  if(chargeV) chargeStop();
  const c = E.ctx, o1 = c.createOscillator(), o2 = c.createOscillator(), g = c.createGain(), l = c.createOscillator(), lg = c.createGain();
  o1.type='triangle'; o2.type='sine';
  o1.frequency.setValueAtTime(220*p, t); o1.frequency.exponentialRampToValueAtTime(523*p, t+1.1);
  o2.frequency.setValueAtTime(330*p, t); o2.frequency.exponentialRampToValueAtTime(784*p, t+1.1);
  l.frequency.value = 9; lg.gain.setValueAtTime(0, t); lg.gain.setValueAtTime(0, t+1.0); lg.gain.linearRampToValueAtTime(vol*0.35, t+1.3); l.connect(lg); lg.connect(g.gain);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t+0.15);
  o1.connect(g); o2.connect(g); g.connect(d);
  const end = t+5;   // 止め忘れの保険
  o1.start(t); o2.start(t); l.start(t); o1.stop(end); o2.stop(end); l.stop(end);
  track(E, o1, [o2, g, l, lg], 1);
  chargeV = { E, o1, o2, l, g, vol };
  if(stopAt!=null) chargeStop(stopAt);
}
const SFX = {
  hit(E,d,t,p,v,o){
    sOsc(E,d,'sine',620*p,190*p,t,0.1,0.6*v); sOsc(E,d,'triangle',1300*p,650*p,t,0.04,0.2*v);
    sNoise(E,d,t,0.035,0.28*v,'bandpass',2600*p,1400*p,1.2,0.002);
    const k = o.kind;
    if(k==='magic' || k==='star') sBell(E,d,'glock',91+semi(p),t+0.02,0.14*v);
    else if(k==='ice') sBell(E,d,'celesta',96+semi(p),t+0.015,0.18*v);
    else if(k==='thunder') sNoise(E,d,t,0.12,0.16*v,'highpass',3000,6000,0.8,0.002);
    else if(k==='fire' || k==='pop') sOsc(E,d,'sine',900*p,1900*p,t+0.02,0.05,0.18*v);
  },
  hitBig(E,d,t,p,v){
    sOsc(E,d,'sine',190*p,46*p,t,0.34,0.85*v); sNoise(E,d,t,0.3,0.5*v,'lowpass',1800*p,240*p,0.7,0.003);
    sOsc(E,d,'triangle',560*p,240*p,t,0.13,0.32*v);
    sBell(E,d,'glock',91+semi(p),t+0.045,0.22*v); sBell(E,d,'glock',98+semi(p),t+0.1,0.16*v);
  },
  slash(E,d,t,p,v){ sNoise(E,d,t,0.14,0.9*v,'bandpass',1100*p,5600*p,2.0,0.02); sBell(E,d,'glock',96+semi(p),t+0.035,0.2*v); },
  swing(E,d,t,p,v){ sNoise(E,d,t,0.18,0.9*v,'bandpass',480*p,1900*p,1.3,0.03); },
  jump(E,d,t,p,v){ sOsc(E,d,'sq',380*p,940*p,t,0.14,0.14*v,0.005); sOsc(E,d,'sine',380*p,940*p,t,0.14,0.24*v); },
  land(E,d,t,p,v){ sOsc(E,d,'sine',150*p,55*p,t,0.12,0.5*v); sNoise(E,d,t,0.08,0.22*v,'lowpass',520*p,200*p,0.7); },
  dodge(E,d,t,p,v){ sNoise(E,d,t,0.15,0.8*v,'bandpass',3400*p,700*p,1.4,0.01); sOsc(E,d,'sine',1400*p,700*p,t,0.1,0.12*v); },
  coin(E,d,t,p,v){ sOsc(E,d,'sq',988*p,988*p,t,0.08,0.24*v,0.002); sOsc(E,d,'sq',1319*p,1319*p,t+0.07,0.32,0.24*v,0.002); },
  heal(E,d,t,p,v){ const s=semi(p); [72,76,79,84].forEach((m,i)=> sBell(E,d,'celesta',m+s,t+i*0.07,0.42*v)); sBell(E,d,'glock',96+s,t+0.28,0.16*v); },
  star(E,d,t,p,v){ const s=semi(p); [84,88,91,96,100].forEach((m,i)=> sBell(E,d,'glock',m+s,t+i*0.045,0.26*v)); sNoise(E,d,t,0.35,0.05*v,'highpass',7000,9000,0.7,0.05); },
  ko(E,d,t,p,v){ boing(E,d,t,p,0.42*v); sOsc(E,d,'sine',900*p,1700*p,t+0.07,0.05,0.22*v); },
  poof(E,d,t,p,v){ sNoise(E,d,t,0.3,0.42*v,'lowpass',1500*p,260*p,0.8,0.01); sOsc(E,d,'sine',700*p,1500*p,t+0.015,0.05,0.25*v); },
  select(E,d,t,p,v){ sOsc(E,d,'triangle',1650*p,1600*p,t,0.045,0.38*v,0.002); playDrum(E,d,'wb',t,0.5*v,1); },
  ok(E,d,t,p,v){ const s=semi(p); sBell(E,d,'marimba',79+s,t,0.55*v); sBell(E,d,'marimba',84+s,t+0.075,0.6*v); sLead(E,d,84+s,t+0.075,0.1,0.07*v); },
  cancel(E,d,t,p,v){ const s=semi(p); sBell(E,d,'marimba',84+s,t,0.5*v); sBell(E,d,'marimba',77+s,t+0.08,0.5*v); },
  go(E,d,t,p,v){ const s=semi(p); for(const k of [0,0.17]){ sBell(E,d,'glock',88+s,t+k,0.45*v); sLead(E,d,76+s,t+k,0.12,0.12*v); } },
  alert(E,d,t,p,v){ sOsc(E,d,'sq',1300*p,1560*p,t,0.09,0.3*v,0.003); },
  levelup(E,d,t,p,v){ const s=semi(p);
    [72,76,79,84].forEach((m,i)=> sLead(E,d,m+s,t+i*0.06,0.09,0.16*v));
    [84,88,91].forEach((m)=> sLead(E,d,m+s,t+0.26,0.42,0.08*v));
    [96,100,103].forEach((m,i)=> sBell(E,d,'glock',m+s,t+0.26+i*0.05,0.2*v)); },
  special(E,d,t,p,v){ sNoise(E,d,t,0.38,0.55*v,'bandpass',400*p,4600*p,1.8,0.2); sOsc(E,d,'sine',300*p,1250*p,t,0.34,0.22*v,0.1); sBell(E,d,'glock',96+semi(p),t+0.3,0.2*v); },
  ult(E,d,t,p,v){ const s=semi(p);
    sNoise(E,d,t,0.75,0.3*v,'bandpass',300*p,5200*p,1.8,0.6); sOsc(E,d,'sawtooth',110*p,440*p,t,0.75,0.06*v,0.6);
    const h = t+0.72;
    playBrass(E,d,[60+s,64+s,67+s,72+s],h,0.5,0.7*v,1); sOsc(E,d,'sine',130*p,40*p,h,0.4,0.55*v);
    playDrum(E,d,'cr',h,0.9*v,1); [84,88,91,96].forEach((m,i)=> sBell(E,d,'glock',m+s,h+0.05+i*0.05,0.18*v)); },
  shoot(E,d,t,p,v){ sOsc(E,d,'sine',520*p,1350*p,t,0.065,0.4*v); sNoise(E,d,t,0.025,0.15*v,'highpass',3000,3000,0.7,0.001); },
  pop(E,d,t,p,v){ sOsc(E,d,'sine',800*p,2100*p,t,0.05,0.4*v); },
  boing(E,d,t,p,v){ boing(E,d,t,p,0.45*v); },
  bossRoar(E,d,t,p,v){ roar(E,d,t,p,0.55*v); },
  clear(E,d,t,p,v){ const s=semi(p);
    const seq = [[67,0,0.09],[72,0.1,0.09],[76,0.2,0.09],[79,0.3,0.16],[76,0.48,0.1],[79,0.6,0.6]];
    for(const q of seq){ sLead(E,d,q[0]+s,t+q[1],q[2],0.16*v); playBrass(E,d,[q[0]-12+s],t+q[1],q[2],0.5*v,1); }
    playBrass(E,d,[60+s,64+s,67+s],t+0.6,0.6,0.6*v,1);
    [84,88,91,96].forEach((m,i)=> sBell(E,d,'glock',m+s,t+0.6+i*0.05,0.2*v)); playDrum(E,d,'cr',t+0.6,0.8*v,1); },
  // ---- 追加（内部でも使う）
  block(E,d,t,p,v){ sOsc(E,d,'triangle',2400*p,2250*p,t,0.08,0.45*v,0.002); sBell(E,d,'glock',100+semi(p),t,0.2*v); },
  just(E,d,t,p,v){ const s=semi(p); [91,96,103].forEach((m,i)=> sBell(E,d,'glock',m+s,t+i*0.035,0.3*v)); sNoise(E,d,t,0.3,0.06*v,'highpass',6000,9000,0.7,0.03); },
  faint(E,d,t,p,v){ sOsc(E,d,'sine',900*p,220*p,t,0.55,0.25*v,0.02); boing(E,d,t+0.5,p*0.8,0.25*v); },
  rank(E,d,t,p,v){ const s=semi(p); sBell(E,d,'glock',84+s,t,0.22*v); sBell(E,d,'glock',91+s,t+0.05,0.22*v); },
  kira(E,d,t,p,v){ sBell(E,d,'glock',96+semi(p),t,0.35*v); },
};

// =====================================================================================
//  声（ちいさな合成チャープ：ノコギリ波をフォルマント2本に通して母音を「い→あ」のように動かす）
// =====================================================================================
const VOICE_DEF = { inu:[300,'sawtooth'], shima:[186,'sawtooth'], nuko:[520,'triangle'], guard8:[148,'sawtooth'], watch:[392,'sawtooth'], wanden:[228,'sawtooth'], mack:[262,'sawtooth'] };
const CHIRP = {
  atk: { dur:0.17, p:[[0,1],[0.035,1.3],[0.17,0.92]], f1:[320,820], f2:[2300,1250], vib:0, vol:1.5 },
  hurt:{ dur:0.24, p:[[0,1.75],[0.03,1.95],[0.24,0.85]], f1:[360,700], f2:[2600,1500], vib:0, vol:1.4 },
  ult: { dur:0.55, p:[[0,1],[0.1,1.35],[0.42,1.5],[0.55,1.2]], f1:[380,860], f2:[2100,1150], vib:1, vol:1.6 },
  wan: { dur:0.15, p:[[0,1.12],[0.05,1.35],[0.15,1.05]], f1:[300,760], f2:[800,1250], vib:0, vol:1.6 },
};
function chirp(E, d, t, f0, type, K, vol){
  const c = E.ctx, o = c.createOscillator(); o.type = type;
  o.frequency.setValueAtTime(f0*K.p[0][1], t);
  for(let i=1;i<K.p.length;i++) o.frequency.linearRampToValueAtTime(f0*K.p[i][1], t+K.p[i][0]);
  const b1 = c.createBiquadFilter(), b2 = c.createBiquadFilter(), g2 = c.createGain(), env = c.createGain();
  b1.type='bandpass'; b2.type='bandpass'; b1.Q.value=3; b2.Q.value=5; g2.gain.value=0.7;
  b1.frequency.setValueAtTime(K.f1[0], t); b1.frequency.exponentialRampToValueAtTime(K.f1[1], t+K.dur*0.45);
  b2.frequency.setValueAtTime(K.f2[0], t); b2.frequency.exponentialRampToValueAtTime(K.f2[1], t+K.dur*0.45);
  // 波形で倍音の量が違うので補正（矩形は強い、三角・正弦は弱い）＋フォルマントを通らない素の音を少し混ぜて下限を作る
  const vv = vol*K.vol*({ square:0.62, triangle:0.9, sine:0.75 }[type] || 1);
  const dry = c.createGain(); dry.gain.value = 0.3; o.connect(dry); dry.connect(env);
  env.gain.setValueAtTime(0, t); env.gain.linearRampToValueAtTime(vv, t+0.015); env.gain.setValueAtTime(vv, t+K.dur*0.6); env.gain.linearRampToValueAtTime(0.0001, t+K.dur);
  o.connect(b1); o.connect(b2); b2.connect(g2); b1.connect(env); g2.connect(env); env.connect(d);
  const nodes = [b1, b2, g2, env, dry];
  if(K.vib){ const l = c.createOscillator(), lg = c.createGain(); l.frequency.value = 7; lg.gain.value = 35; l.connect(lg); lg.connect(o.detune); l.start(t); l.stop(t+K.dur+0.05); nodes.push(l, lg); }
  o.start(t); o.stop(t+K.dur+0.05);
  track(E, o, nodes, 1);
  return env;
}
function voiceParams(heroId){
  let f0 = 0, type = '';
  try{ const h = G.heroes && G.heroes.get && G.heroes.get(heroId); if(h && h.voice){ f0 = +h.voice.f0 || 0; type = h.voice.type || ''; } }catch(_){}
  const def = VOICE_DEF[heroId] || [300,'sawtooth'];
  if(!(f0 > 60 && f0 < 1200)) f0 = def[0];
  const osc = ['sine','square','sawtooth','triangle'].indexOf(type)>=0 ? type : (type==='tri' ? 'triangle' : def[1]);
  return { f0, osc };
}
function renderVoice(E, d, t, heroId, kind, vol){
  const vp = voiceParams(heroId);
  if(kind==='win'){ chirp(E, d, t, vp.f0, vp.osc, CHIRP.wan, vol); return chirp(E, d, t+0.2, vp.f0*1.06, vp.osc, CHIRP.wan, vol); }
  return chirp(E, d, t, vp.f0, vp.osc, CHIRP[kind] || CHIRP.atk, vol);
}

// =====================================================================================
//  状態・公開 API
// =====================================================================================
let ctx = null, E = null, muted = false, volume = 0.8, current = null, want = false, wantAt = 0;
let hidden = false, timer = null, inited = false, suspendedByUs = false, musicPaused = false;
const rl = {};              // 効果音の連打制限：名前 → 直近3回の時刻(ms)
const vlast = {};           // 声：ヒーロー → {t, env}
function running(){ return !!(ctx && E && ctx.state==='running' && !hidden); }
function applyVolume(){
  if(!E) return;
  try{ const t = ctx.currentTime; E.master.gain.cancelScheduledValues(t); E.master.gain.setTargetAtTime(muted ? 0 : volume, t, 0.03); }catch(_){}
}
const pumpStat = { n:0, ms:0, max:0 };
function startTimer(){ if(!timer && E && !E.offline && !hidden) timer = setInterval(pump, TICK_MS); }
function stopTimer(){ if(timer){ clearInterval(timer); timer = null; } }
function pump(){
  try{
    if(!E){ stopTimer(); return; }
    if(hidden || ctx.state!=='running') return;
    const t0 = nowMs();
    const until = ctx.currentTime + LOOKAHEAD;
    const L = E.players;
    for(let i=L.length-1; i>=0; i--){
      const P = L[i];
      if(!P.stopping && !P.done && !musicPaused) schedulePlayer(P, until);
      if(P.done && !P.stopping){ P.stopping = true; setTimeout(()=> disposePlayer(P), 4000); }
    }
    if(!L.length) stopTimer();
    const dt = nowMs()-t0; pumpStat.n++; pumpStat.ms += dt; if(dt > pumpStat.max) pumpStat.max = dt;
  }catch(err){ logErr('pump', err); }
}
function startSong(name){
  want = false;
  if(!E) return;
  const t = ctx.currentTime, S = name && SONGS[name], jingle = !!(S && S.loop===false);
  let had = false;
  for(const P of E.players) if(!P.stopping){ fadeOutPlayer(P, jingle ? 0.12 : XFADE); had = true; }
  if(!S) return;
  const P = makePlayer(E, name, t+0.04, had && !jingle ? XFADE : 0);
  if(!P) return;
  E.players.push(P);
  if(ctx.state==='running' && !hidden && !musicPaused) schedulePlayer(P, t+LOOKAHEAD);
  startTimer();
}
function maybeStartWanted(){
  if(!want || !current || !E) return;
  const S = SONGS[current];
  if(S && S.loop===false && nowMs()-wantAt > 3000){ want = false; return; }   // 古いジングルは今さら鳴らさない
  startSong(current);
}
function onState(){
  try{
    if(!ctx) return;
    if(ctx.state==='running' && !hidden){ suspendedByUs = false; maybeStartWanted(); if(E.players.length) startTimer(); }
  }catch(err){ logErr('state', err); }
}
function unlock(){
  if(!AC) return false;
  try{
    if(ctx && ctx.state==='running') return true;
    if(!ctx){
      buildBank();
      try{ ctx = new AC({ latencyHint:'interactive' }); }catch(_){ ctx = new AC(); }
      E = makeEngine(ctx, null);
      ctx.onstatechange = onState;
      applyVolume();
    }
    try{ if(navigator.audioSession) navigator.audioSession.type = 'playback'; }catch(_){}
    if(!hidden && ctx.state!=='running' && ctx.state!=='closed' && ctx.resume){
      const pr = ctx.resume(); if(pr && pr.then) pr.then(onState, ()=>{});
    }
    // iOS：ジェスチャーの中で同期的に何か鳴らす（1サンプルの無音）
    try{ const s = ctx.createBufferSource(); s.buffer = ctx.createBuffer(1, 1, 22050); s.connect(ctx.destination); s.start(0); }catch(_){}
    onState();
    return ctx.state==='running';
  }catch(err){ logErr('unlock', err); return false; }
}
function bgm(name){
  try{
    if(name===undefined || name==='') name = null;
    if(name!==null && !SONGS[name]) return;
    if(name===current) return;
    current = name; want = name!==null; wantAt = nowMs();
    if(!E) return;                     // 最初のタップ（unlock）で始まる
    startSong(name);
  }catch(err){ logErr('bgm', err); }
}
function panDest(Eg, pan){
  if(!Eg.pans.length || !pan) return Eg.sfx;
  return Eg.pans[clamp(Math.round((clamp(pan,-1,1)*0.6+0.6)/0.3), 0, 4)];
}
const PRIORITY = { ult:1, clear:1, levelup:1, bossRoar:1, go:1, ok:1, cancel:1, select:1, heal:1 };
function sfx(name, opts){
  try{
    const o = opts || {};
    if(name==='charge' && o.stop){ chargeStop(); return; }
    if(!running() || muted) return;
    const fn = SFX[name]; if(!fn && name!=='charge') return;
    const tm = nowMs();
    let r = rl[name]; if(!r) r = rl[name] = [-1e9, -1e9, -1e9];
    let n = 0, oi = 0;
    for(let i=0;i<3;i++){ if(tm - r[i] < 50) n++; if(r[i] < r[oi]) oi = i; }
    if(n >= 3) return;
    r[oi] = tm;
    if(E.liveSfx > MAX_SFX_VOICES && !PRIORITY[name]) return;
    let p = o.pitch==null ? 1 : +o.pitch || 1;
    let v = o.vol==null ? 1 : Math.max(0, +o.vol || 0);
    if(n){ v *= n===1 ? 0.7 : 0.5; p *= 1 + (Math.random()-0.5)*0.06; }
    const t = ctx.currentTime + 0.004 + (o.delay>0 ? +o.delay : 0) + (n ? Math.random()*0.006 : 0);
    const d = panDest(E, o.pan);
    if(name==='charge') chargeStart(E, d, t, p, 0.12*v);
    else fn(E, d, t, p, v, o);
  }catch(err){ logErr('sfx '+name, err); }
}
function voice(heroId, kind){
  try{
    if(!running() || muted || !heroId) return;
    kind = (kind==='atk' || kind==='hurt' || kind==='ult' || kind==='win') ? kind : 'atk';
    const tm = nowMs(), L = vlast[heroId];
    const gap = kind==='atk' ? 220 : 90;
    if(L && tm - L.t < gap) return;
    const t = ctx.currentTime + 0.004;
    if(L && L.env && tm - L.t < 600) holdAndFade(L.env.gain, t, 0.03);
    const env = renderVoice(E, E.sfx, t+0.02, heroId, kind, 0.55);
    vlast[heroId] = { t: tm, env };
  }catch(err){ logErr('voice', err); }
}
function store(k, v){ try{ window.localStorage.setItem(k, v); }catch(_){} }
function load(k){ try{ return window.localStorage.getItem(k); }catch(_){ return null; } }
function setMuted(b){
  try{
    muted = !!b; store('inu25d_mute', muted ? '1' : '0');
    if(muted) chargeStop();
    applyVolume();
    if(G.bus) G.bus.emit('audioMute', { muted });
  }catch(err){ logErr('setMuted', err); }
}
function setVolume(v){
  try{ v = +v; if(!(v>=0)) return; volume = clamp(v, 0, 1); store('inu25d_vol', String(volume)); applyVolume(); }catch(err){ logErr('setVolume', err); }
}
// ポーズ画面：BGM だけを止めて（すっと下げて）、同じ位置から再開する。効果音（メニューの音）は鳴る
function pause(on){
  try{
    on = !!on; if(on===musicPaused) return; musicPaused = on;
    if(!E) return;
    const t = ctx.currentTime;
    E.music.gain.cancelScheduledValues(t); E.music.gain.setTargetAtTime(on ? 0 : MUSIC_GAIN, t, on ? 0.05 : 0.12);
    if(on) chargeStop();
    else for(const P of E.players) if(!P.stopping && !P.done) P.nextTime = t + 0.05;
  }catch(err){ logErr('pause', err); }
}
function pauseAll(){
  if(hidden) return;
  hidden = true; stopTimer(); chargeStop();
  try{ if(ctx && ctx.state==='running'){ suspendedByUs = true; const pr = ctx.suspend(); if(pr && pr.catch) pr.catch(()=>{}); } }catch(_){}
}
function resumeAll(){
  if(!hidden) return;
  hidden = false;
  try{
    if(ctx && ctx.state!=='running' && ctx.state!=='closed'){ const pr = ctx.resume(); if(pr && pr.then) pr.then(onState, ()=>{}); }
    if(E && E.players.length) startTimer();
    onState();
  }catch(_){}
}

// ---------------------------------------------------------------- バスのイベント → 自動で鳴らす
function panX(x){
  const cm = G.cam; if(x==null || !cm || !cm.halfW) return 0;
  return clamp((x - cm.x)/(cm.halfW*1.2), -1, 1);
}
const isHero = (e)=> !!(e && (e.team===0 || e.kind==='hero'));
let comboRank = null, comboCount = 0;
function comboLevel(c){ return c>=45?5 : c>=28?4 : c>=16?3 : c>=8?2 : c>=2?1 : 0; }
function subscribe(){
  if(!G.bus) return;
  const on = (ev, fn)=> G.bus.on(ev, (d)=>{ try{ fn(d||{}); }catch(err){ logErr('bus.'+ev, err); } });
  on('hit', (d)=>{
    const pan = panX(d.x), pw = d.power||1, toHero = isHero(d.target);
    if(d.blocked){ sfx('block', { pan }); return; }
    if(pw>=2 || d.crit) sfx('hitBig', { pan, vol: pw>=3 ? 1 : 0.72, pitch: toHero ? 0.9 : 1 });
    else sfx('hit', { pan, kind:d.kind, pitch: toHero ? 0.82 : 0.95 + Math.random()*0.1 });
    if(d.crit) sfx('kira', { pan, delay:0.04 });
  });
  on('swing', (d)=>{
    const e = d.ent, hero = isHero(e);
    sfx(d.kind==='slash' ? 'slash' : 'swing', { pan: panX(e && e.x), vol: hero ? 0.8 : 0.5, pitch: (d.power>=2 ? 0.85 : 1)*(hero ? 1 : 0.88) });
  });
  on('shoot', (d)=>{ const e = d.ent; sfx('shoot', { pan: panX(d.x!=null ? d.x : e && e.x), vol: isHero(e) ? 0.8 : 0.55, pitch: d.kind==='note' ? 1.3 : d.kind==='rock' ? 0.7 : 1 }); });
  on('jump', (d)=>{ if(isHero(d.ent)) sfx('jump', { pitch: d.double ? 1.3 : 1 }); else sfx('jump', { vol:0.35, pitch:0.8, pan: panX(d.ent && d.ent.x) }); });
  on('land', (d)=>{
    const e = d.ent; if(!e || !d.hard) return;
    if(e.kind==='boss') sfx('hitBig', { vol:0.55, pitch:0.6, pan: panX(e.x) });
    else sfx('land', { vol: isHero(e) ? 0.8 : 0.45, pan: panX(e.x) });
  });
  on('dodge', (d)=>{ sfx('dodge'); if(d.just) sfx('just'); });
  on('pickup', (d)=>{
    const k = d.kind;
    if(k==='coin') sfx('coin'); else if(k==='gem') sfx('coin', { pitch:1.26 });
    else if(k==='star') sfx('star');
    else if(k==='bone' || k==='cake' || k==='heart') sfx('heal', { pitch: k==='heart' ? 1.12 : 1 });
    else sfx('pop');
  });
  on('ko', (d)=>{ sfx('ko', { pan: panX(d.x!=null ? d.x : d.ent && d.ent.x) }); });
  on('heroKO', (d)=>{ sfx('faint'); if(d.ent && d.ent.type) voice(d.ent.type, 'hurt'); });
  on('revive', ()=>{ sfx('heal', { pitch:1.12 }); sfx('star', { delay:0.2 }); });
  on('levelUp', ()=> sfx('levelup'));
  on('special', (d)=>{ sfx('special'); if(isHero(d.ent) && d.ent.type) voice(d.ent.type, 'atk'); });
  on('ult', (d)=>{ sfx('ult'); const id = d.heroId || (d.ent && d.ent.type); if(id) voice(id, 'ult'); });
  on('hurt', (d)=>{ if(isHero(d.ent) && d.ent.type) voice(d.ent.type, 'hurt'); });
  on('go', ()=> sfx('go'));
  on('bossIntro', ()=> sfx('bossRoar'));
  on('bossPhase', ()=> sfx('bossRoar', { vol:0.8, pitch:1.1 }));
  on('bossDown', ()=>{ sfx('hitBig'); sfx('star', { delay:0.3 }); });
  // 最終ボスのあとは 90_game が bgm('clear') のジングルを鳴らす。中ボス（ステージ7のクロイヌ）だけはここでファンファーレ
  on('midClear', ()=> sfx('clear'));
  on('stageClear', ()=> sfx('star'));
  on('combo', (d)=>{
    const c = d.count|0;
    if(c < comboCount || c <= 1){ comboRank = null; }
    if(d.rank!=null && d.rank!=='' && d.rank!==comboRank && c > comboCount && comboLevel(c) > 0) sfx('rank', { pitch: Math.pow(2, 2*(comboLevel(c)-1)/12) });
    comboRank = d.rank==null ? comboRank : d.rank; comboCount = c;
  });
  on('scene', ()=> chargeStop());
  on('hidden', pauseAll);
  on('visible', resumeAll);
}
function init(){
  if(inited) return; inited = true;
  try{
    muted = load('inu25d_mute')==='1';
    const v = parseFloat(load('inu25d_vol')); if(v>=0 && v<=1) volume = v;
    hidden = typeof document!=='undefined' && !!document.hidden;
    subscribe();
    if(typeof document!=='undefined'){
      document.addEventListener('visibilitychange', ()=>{ if(document.hidden) pauseAll(); else resumeAll(); });
      // 最初のジェスチャーで AudioContext を作る／再開する（iOS の中断からの復帰にも使うので外さない。動いていれば何もしない）
      const g = ()=>{ if(!ctx || ctx.state!=='running') unlock(); };
      for(const ev of ['pointerdown','touchstart','touchend','mousedown','keydown','click']) window.addEventListener(ev, g, { capture:true, passive:true });
    }
    // 楽器の波形はひまなときに先に焼いておく（最初のタップで待たせない）
    const idle = window.requestIdleCallback ? (f)=> window.requestIdleCallback(f, { timeout:1500 }) : (f)=> setTimeout(f, 120);
    const step = (dl)=>{
      try{
        const budget = dl && dl.timeRemaining ? Math.max(4, Math.min(12, dl.timeRemaining())) : 8;
        if(!buildBankStep(budget)) idle(step);
      }catch(err){ logErr('bank', err); }
    };
    idle(step);
  }catch(err){ logErr('init', err); }
}

// ---------------------------------------------------------------- 検証（オフラインで焼いて測る）
const PC = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const KMAJ = [6.35,2.23,3.48,2.33,4.38,4.09,2.52,5.19,2.39,3.66,2.29,2.88], KMIN = [6.33,2.68,3.52,5.38,2.60,3.53,2.54,4.75,3.98,2.69,3.34,3.17];
function pearson(a, b){ const n=a.length; let ma=0, mb=0; for(let i=0;i<n;i++){ ma+=a[i]; mb+=b[i]; } ma/=n; mb/=n; let s=0, sa=0, sb=0; for(let i=0;i<n;i++){ const x=a[i]-ma, y=b[i]-mb; s+=x*y; sa+=x*x; sb+=y*y; } return s/Math.sqrt(sa*sb||1); }
function keyFind(h){
  let best = { r:-2 }, bestMaj = -2, bestMin = -2;
  for(let k=0;k<12;k++){
    const rj = [], rn = []; for(let i=0;i<12;i++){ rj.push(KMAJ[(i-k+12)%12]); rn.push(KMIN[(i-k+12)%12]); }
    const a = pearson(h, rj), b = pearson(h, rn);
    if(a > bestMaj) bestMaj = a; if(b > bestMin) bestMin = b;
    if(a > best.r) best = { r:a, key:PC[k], mode:'major' };
    if(b > best.r) best = { r:b, key:PC[k], mode:'minor' };
  }
  return { key: best.key+' '+best.mode, mode: best.mode, r: +best.r.toFixed(3), bestMajorR: +bestMaj.toFixed(3), bestMinorR: +bestMin.toFixed(3) };
}
function histo(list, filter){
  const h = new Array(12).fill(0); let tot = 0;
  for(const n of list){ if(filter && !filter(n)) continue; const w = n.d; h[((Math.round(n.m)%12)+12)%12] += w; tot += w; }
  const pct = {}; for(let i=0;i<12;i++) if(h[i] > 0) pct[PC[i]] = +(100*h[i]/(tot||1)).toFixed(1);
  return { h, pct };
}
function analyze(buf, win){
  const ch = []; for(let i=0;i<buf.numberOfChannels;i++) ch.push(buf.getChannelData(i));
  const n = ch[0].length, W = Math.max(1, Math.floor(buf.sampleRate*(win||0.5)));
  let peak = 0, pre = 0, sum = 0, ws = 0, wc = 0, last = 0; const wins = [];
  const a = ch[0], b = ch[1]||ch[0], c2 = ch[2], d2 = ch[3];
  for(let i=0;i<n;i++){
    const x = a[i], y = b[i], ax = Math.abs(x), ay = Math.abs(y);
    if(ax > peak) peak = ax; if(ay > peak) peak = ay;
    if(ax > 0.001 || ay > 0.001) last = i;
    if(c2){ const p1 = Math.abs(c2[i]), p2 = Math.abs(d2[i]); if(p1 > pre) pre = p1; if(p2 > pre) pre = p2; }
    const e = (x*x + y*y)*0.5; sum += e; ws += e;
    if(++wc === W){ wins.push(Math.sqrt(ws/W)); ws = 0; wc = 0; }
  }
  const rms = Math.sqrt(sum/n);
  return { peak:+peak.toFixed(4), prePeak: c2 ? +pre.toFixed(4) : null, rms:+rms.toFixed(4), rmsDb:+(20*Math.log10(rms||1e-9)).toFixed(1), wins, soundSec:+(last/buf.sampleRate).toFixed(3) };
}
// opts.sfx = [[秒, 効果音名, opts], …] … 曲に効果音を重ねた最悪ケースの計測用（連打制限は通さない＝より厳しい）
async function renderOffline(name, seconds, opts){
  if(!OAC) return { name, error:'no OfflineAudioContext' };
  const song = compileSong(name); if(!song) return { name, error:'unknown song' };
  const t0 = nowMs();
  const loopSec = song.L*song.stepDur;
  seconds = +seconds || Math.min(90, loopSec + (song.loop ? 2 : 1));
  const oc = new OAC(4, Math.ceil(44100*seconds), 44100);
  const E2 = makeEngine(oc, { offline:true, quad:true }); E2.log = [];
  const P = makePlayer(E2, name, 0.02, 0); E2.players.push(P);
  schedulePlayer(P, seconds);
  const extra = (opts && opts.sfx) || [];
  for(const q of extra){
    const o = q[2] || {}, fn = SFX[q[1]]; if(!fn) continue;
    fn(E2, panDest(E2, o.pan), q[0], o.pitch||1, o.vol==null?1:o.vol, o);
  }
  const made = E2.made;
  const buf = await oc.startRendering();
  const A = analyze(buf, 0.5);
  const lead = histo(E2.log, (x)=> x.c==='lead'), all = histo(E2.log, null);
  const winsNoTail = song.loop ? A.wins : A.wins.slice(0, Math.floor(loopSec/0.5));
  return { name, seconds, bpm: song.S.bpm, key: PC[song.S.key%12]+' '+song.S.mode, bars: song.bars, loop: song.loop,
    loopSec:+loopSec.toFixed(2), loopStartSec:+(song.loopStart*song.stepDur).toFixed(2), loops: P.loops,
    peak:A.peak, prePeak:A.prePeak, rms:A.rms, rmsDb:A.rmsDb, soundSec:A.soundSec,
    minWinRms: +Math.min.apply(null, winsNoTail.length ? winsNoTail : [0]).toFixed(4), maxWinRms: +Math.max.apply(null, A.wins.length ? A.wins : [0]).toFixed(4),
    quietWins: winsNoTail.filter((w)=> w < 0.01).length,
    notes: { count: E2.log.length, leadCount: E2.log.filter((x)=> x.c==='lead').length, leadPc: lead.pct, allPc: all.pct, detectedAll: keyFind(all.h), detectedLead: keyFind(lead.h) },
    nodesMade: made, warnings: song.warn, renderMs: Math.round(nowMs()-t0) };
}
async function renderSfxOffline(name, opts){
  if(!OAC) return { name, error:'no OfflineAudioContext' };
  const o = opts || {};
  const secs = o.seconds || 2.5;
  const oc = new OAC(4, Math.ceil(44100*secs), 44100);
  const E2 = makeEngine(oc, { offline:true, quad:true });
  const saved = chargeV; chargeV = null;
  try{
    if(o.voice) renderVoice(E2, E2.sfx, 0.02, o.voice, name, 0.55);
    else if(name==='charge') chargeStart(E2, E2.sfx, 0.02, 1, 0.12, 1.6);
    else if(SFX[name]) SFX[name](E2, E2.sfx, 0.02, o.pitch||1, o.vol==null?1:o.vol, o);
    else return { name, error:'unknown sfx' };
  } finally { chargeV = saved; }
  const buf = await oc.startRendering();
  const A = analyze(buf, 0.05);
  return { name: o.voice ? o.voice+':'+name : name, peak:A.peak, prePeak:A.prePeak, rms:A.rms, soundSec:A.soundSec, nodes:E2.made };
}
function stats(){
  return { ctx: ctx ? ctx.state : (AC ? 'none' : 'unsupported'), time: ctx ? +ctx.currentTime.toFixed(3) : 0,
    current, want, hidden, muted, volume, paused: musicPaused, timer: !!timer,
    players: E ? E.players.map((P)=> ({ name:P.name, pos:P.pos, loops:P.loops, stopping:P.stopping, done:P.done })) : [],
    nTrack: E ? E.nTrack||0 : 0, nEnded: E ? E.nEnded||0 : 0, nDup: E ? E.nDup||0 : 0, dupKinds: E ? E.dupKinds : null,
    live: E ? E.live : 0, liveMusic: E ? E.liveMusic : 0, liveSfx: E ? E.liveSfx : 0, liveNodes: E ? E.liveNodes : 0, made: E ? E.made : 0,
    pumpCalls: pumpStat.n, pumpMsTotal: +pumpStat.ms.toFixed(2), pumpMsMax: +pumpStat.max.toFixed(2),
    bankMs: +bankMs.toFixed(1), bankReady: !!bank, bankMaxJobMs: bankWork ? +bankWork.maxJob.toFixed(1) : null };
}

G.audio = {
  init, unlock, bgm, sfx, voice, setMuted, setVolume, pause,
  get paused(){ return musicPaused; },
  toggleMute(){ setMuted(!muted); return muted; },
  get muted(){ return muted; }, set muted(v){ setMuted(v); },
  get volume(){ return volume; }, set volume(v){ setVolume(v); },
  get current(){ return current; },
  get ready(){ return running(); },
  tracks: Object.keys(SONGS),
  sfxNames: Object.keys(SFX).concat(['charge']),
  renderOffline, renderSfxOffline, stats,
  debug: {
    compile: (n)=>{ const s = compileSong(n); return s ? { name:n, bars:s.bars, steps:s.L, loopSec:+(s.L*s.stepDur).toFixed(2), warn:s.warn } : null; },
    renderVoice: (heroId, kind)=> renderSfxOffline(kind, { voice:heroId }),
    buildBank: ()=>{ buildBank(); return +bankMs.toFixed(1); },
    bankProfile: ()=>{ const W = bankJobs(), out = []; for(const j of W.jobs){ const t = nowMs(); j(); out.push(+(nowMs()-t).toFixed(1)); } return out; },
  },
};
})();

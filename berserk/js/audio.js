'use strict';
/* =====================================================================
 *  audio.js  ── WebAudio だけで鳴らす効果音シンセ + ステップシーケンサ BGM
 *  外部音源ファイルは一切使わない（すべてその場で合成）
 *
 *  効果音:  BK.audio.sfx('hit', {vol:1, pitch:1})
 *  BGM   :  BK.audio.playSong('stage1') / BK.audio.stopSong()
 *  曲定義 :  BK.audio.songs[id] = { bpm, steps(1小節の分割数=16), bars, tracks:[{inst, vol, oct(半音単位の移調: 12=1オクターブ), seq:'記法文字列' | array}] }
 *           記法: 1トークン=1ステップ, 空白区切り。 '.'=休符  '-'=前の音を伸ばす  'x'=打楽器ヒット
 *                 音名 'c3' 'd#3' 'eb2'（オクターブ付き）、和音 'c3+eb3+g3'、強弱 'c3!'(強) 'c3?'(弱)
 *           '|' は見やすさのための小節区切り（無視される）
 * ===================================================================== */
(function (BK) {
  const U = BK.U;
  const A = BK.audio = {
    ctx: null, master: null, sfxBus: null, musBus: null, comp: null,
    muted: BK.save.get('muted', false),
    musicVol: 0.42, sfxVol: 0.9,
    songs: {}, song: null, songId: null,
    _noise: null, _lastSfx: {},
  };

  A.unlock = function () {
    try {
      if (!A.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        A.ctx = new AC();
        A.comp = A.ctx.createDynamicsCompressor();
        A.comp.threshold.value = -14; A.comp.knee.value = 10; A.comp.ratio.value = 5;
        A.comp.attack.value = 0.003; A.comp.release.value = 0.2;
        A.master = A.ctx.createGain();
        A.master.gain.value = A.muted ? 0 : 0.8;
        A.sfxBus = A.ctx.createGain(); A.sfxBus.gain.value = A.sfxVol;
        A.musBus = A.ctx.createGain(); A.musBus.gain.value = A.musicVol;
        A.sfxBus.connect(A.comp); A.musBus.connect(A.comp);
        A.comp.connect(A.master); A.master.connect(A.ctx.destination);
        // ノイズバッファ（2秒）
        const len = A.ctx.sampleRate * 2;
        A._noise = A.ctx.createBuffer(1, len, A.ctx.sampleRate);
        const d = A._noise.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
        // 簡易リバーブ（インパルス応答を合成）
        A.verb = A.ctx.createConvolver();
        const rl = Math.floor(A.ctx.sampleRate * 2.2);
        const ir = A.ctx.createBuffer(2, rl, A.ctx.sampleRate);
        for (let ch = 0; ch < 2; ch++) {
          const b = ir.getChannelData(ch);
          for (let i = 0; i < rl; i++) b[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / rl, 2.6);
        }
        A.verb.buffer = ir;
        A.verbSend = A.ctx.createGain(); A.verbSend.gain.value = 0.28;
        A.verbSend.connect(A.verb); A.verb.connect(A.comp);
        if (A._pendingSong) { const s = A._pendingSong; A._pendingSong = null; A.playSong(s); }
      }
      if (A.ctx.state !== 'running' && A.ctx.state !== 'closed') A.ctx.resume(); // iOS の 'interrupted' からも復帰
    } catch (e) { /* audio unsupported */ }
  };
  A.suspend = function () { try { A.ctx && A.ctx.suspend(); } catch (e) { /* ignore */ } };
  A.resume = function () { try { A.ctx && A.ctx.resume(); } catch (e) { /* ignore */ } };
  A.toggleMute = function () {
    A.muted = !A.muted; BK.save.set('muted', A.muted);
    if (A.master) A.master.gain.setTargetAtTime(A.muted ? 0 : 0.8, A.ctx.currentTime, 0.05);
    return A.muted;
  };
  A.ready = () => !!(A.ctx && A.ctx.state === 'running');

  // ------------------------------------------------------------ primitives
  /** オシレーター1発 */
  A.tone = function (o) {
    const c = A.ctx, t = o.t != null ? o.t : c.currentTime;
    const osc = c.createOscillator();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(Math.max(1, o.f0), t);
    if (o.f1) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.f1), t + (o.slide || o.dur));
    if (o.detune) osc.detune.value = o.detune;
    const g = c.createGain();
    const at = o.attack || 0.004, dur = o.dur || 0.2, v = o.vol == null ? 0.3 : o.vol;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(v, t + at);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node = osc;
    if (o.filter) {
      const f = c.createBiquadFilter();
      f.type = o.filter; f.frequency.value = o.ff || 1200; f.Q.value = o.q || 1;
      if (o.ff1) f.frequency.exponentialRampToValueAtTime(o.ff1, t + dur);
      osc.connect(f); node = f;
    }
    if (o.vib) {
      const l = c.createOscillator(), lg = c.createGain();
      l.frequency.value = o.vib; lg.gain.value = o.vibAmt || 8;
      l.connect(lg); lg.connect(osc.frequency); l.start(t); l.stop(t + dur + 0.05);
    }
    node.connect(g); g.connect(o.dest || A.sfxBus);
    if (o.verb) g.connect(A.verbSend);
    osc.start(t); osc.stop(t + dur + 0.05);
    return osc;
  };
  /** ノイズ1発（フィルタ付き） */
  A.noise = function (o) {
    const c = A.ctx, t = o.t != null ? o.t : c.currentTime;
    const src = c.createBufferSource();
    src.buffer = A._noise;
    src.loop = true;
    src.playbackRate.value = o.rate || 1;
    const f = c.createBiquadFilter();
    f.type = o.filter || 'bandpass';
    f.frequency.setValueAtTime(o.f0 || 1000, t);
    if (o.f1) f.frequency.exponentialRampToValueAtTime(o.f1, t + (o.dur || 0.2));
    f.Q.value = o.q || 1;
    const g = c.createGain();
    const at = o.attack || 0.002, dur = o.dur || 0.2, v = o.vol == null ? 0.3 : o.vol;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(v, t + at);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(o.dest || A.sfxBus);
    if (o.verb) g.connect(A.verbSend);
    src.start(t, Math.random() * 1.5); src.stop(t + dur + 0.05);
  };

  // ---------------------------------------------------------------- SFX
  // 各関数は (p = pitch倍率, v = 音量倍率) を受け取る
  const S = A.sfxDefs = {
    swing(p, v) { A.noise({ filter: 'bandpass', f0: 2600 * p, f1: 500 * p, q: 1.4, dur: 0.14, vol: 0.32 * v }); },
    swingHeavy(p, v) {
      A.noise({ filter: 'bandpass', f0: 1400 * p, f1: 180 * p, q: 1.1, dur: 0.3, vol: 0.45 * v, attack: 0.03 });
      A.tone({ type: 'sine', f0: 110 * p, f1: 50, dur: 0.3, vol: 0.2 * v, attack: 0.03 });
    },
    hit(p, v) {
      A.noise({ filter: 'lowpass', f0: 2600 * p, f1: 300, dur: 0.12, vol: 0.5 * v });
      A.tone({ type: 'sine', f0: 160 * p, f1: 45, dur: 0.14, vol: 0.55 * v });
    },
    hitHeavy(p, v) {
      A.noise({ filter: 'lowpass', f0: 3200 * p, f1: 120, dur: 0.3, vol: 0.7 * v });
      A.tone({ type: 'triangle', f0: 120 * p, f1: 32, dur: 0.34, vol: 0.8 * v });
      A.noise({ filter: 'bandpass', f0: 900 * p, q: 3, dur: 0.12, vol: 0.4 * v });
    },
    slash(p, v) { // 肉を断つ
      A.noise({ filter: 'bandpass', f0: 1800 * p, f1: 700, q: 2, dur: 0.16, vol: 0.5 * v });
      A.tone({ type: 'sine', f0: 140 * p, f1: 50, dur: 0.16, vol: 0.5 * v });
    },
    clang(p, v) {
      [1, 2.76, 5.4, 8.93].forEach((m, i) => A.tone({ type: 'sine', f0: 520 * p * m, dur: 0.5 - i * 0.08, vol: 0.18 * v / (i + 1), verb: true }));
      A.noise({ filter: 'highpass', f0: 3000, dur: 0.06, vol: 0.35 * v });
    },
    shoot(p, v) { // ボウガン
      A.tone({ type: 'triangle', f0: 900 * p, f1: 260, dur: 0.1, vol: 0.35 * v });
      A.noise({ filter: 'highpass', f0: 2500, dur: 0.04, vol: 0.3 * v });
    },
    knife(p, v) { A.noise({ filter: 'bandpass', f0: 4200 * p, f1: 1600, q: 3, dur: 0.1, vol: 0.3 * v }); },
    cannon(p, v) {
      A.noise({ filter: 'lowpass', f0: 1800 * p, f1: 60, dur: 0.9, vol: 0.9 * v, verb: true });
      A.tone({ type: 'sine', f0: 90 * p, f1: 25, dur: 0.7, vol: 0.9 * v });
      A.tone({ type: 'square', f0: 60 * p, f1: 30, dur: 0.25, vol: 0.2 * v, filter: 'lowpass', ff: 400 });
    },
    explode(p, v) {
      A.noise({ filter: 'lowpass', f0: 2400 * p, f1: 80, dur: 0.8, vol: 0.8 * v, verb: true });
      A.tone({ type: 'sine', f0: 70 * p, f1: 28, dur: 0.6, vol: 0.7 * v });
    },
    fire(p, v) { A.noise({ filter: 'bandpass', f0: 600 * p, f1: 1400, q: 0.6, dur: 0.35, vol: 0.35 * v, attack: 0.03 }); },
    magic(p, v) {
      [0, 4, 7, 12].forEach((s, i) => A.tone({ type: 'sine', f0: 660 * p * Math.pow(2, s / 12), dur: 0.35, vol: 0.12 * v, t: A.ctx.currentTime + i * 0.035, verb: true }));
    },
    pickup(p, v) {
      A.tone({ type: 'square', f0: 880 * p, dur: 0.06, vol: 0.12 * v, filter: 'lowpass', ff: 3000 });
      A.tone({ type: 'square', f0: 1320 * p, dur: 0.12, vol: 0.12 * v, t: A.ctx.currentTime + 0.06, filter: 'lowpass', ff: 3000 });
    },
    coin(p, v) {
      A.tone({ type: 'square', f0: 1568 * p, dur: 0.05, vol: 0.1 * v });
      A.tone({ type: 'square', f0: 2093 * p, dur: 0.18, vol: 0.1 * v, t: A.ctx.currentTime + 0.05 });
    },
    heal(p, v) {
      [0, 4, 7, 12, 16].forEach((s, i) => A.tone({ type: 'triangle', f0: 523 * p * Math.pow(2, s / 12), dur: 0.2, vol: 0.16 * v, t: A.ctx.currentTime + i * 0.05, verb: true }));
    },
    jump(p, v) { A.noise({ filter: 'bandpass', f0: 500 * p, f1: 1200, q: 1, dur: 0.12, vol: 0.14 * v }); },
    land(p, v) { A.tone({ type: 'sine', f0: 90 * p, f1: 40, dur: 0.1, vol: 0.3 * v }); A.noise({ filter: 'lowpass', f0: 600, dur: 0.08, vol: 0.15 * v }); },
    thud(p, v) { // 敵が倒れる
      A.tone({ type: 'sine', f0: 80 * p, f1: 35, dur: 0.22, vol: 0.55 * v });
      A.noise({ filter: 'lowpass', f0: 900, f1: 100, dur: 0.25, vol: 0.35 * v });
    },
    hurt(p, v) {
      A.tone({ type: 'sawtooth', f0: 240 * p, f1: 120, dur: 0.2, vol: 0.18 * v, filter: 'bandpass', ff: 800, q: 2 });
      A.noise({ filter: 'lowpass', f0: 1500, f1: 200, dur: 0.12, vol: 0.4 * v });
    },
    growl(p, v) { // 雑魚の断末魔
      A.tone({ type: 'sawtooth', f0: 150 * p, f1: 60, dur: 0.45, vol: 0.2 * v, filter: 'lowpass', ff: 900, vib: 22, vibAmt: 18 });
      A.noise({ filter: 'bandpass', f0: 500 * p, f1: 200, q: 2, dur: 0.4, vol: 0.2 * v });
    },
    roar(p, v) { // ボスの咆哮
      A.tone({ type: 'sawtooth', f0: 110 * p, f1: 55, dur: 1.2, vol: 0.35 * v, filter: 'lowpass', ff: 1200, ff1: 300, vib: 16, vibAmt: 14, verb: true });
      A.tone({ type: 'sawtooth', f0: 82 * p, f1: 40, dur: 1.2, vol: 0.3 * v, filter: 'lowpass', ff: 700, vib: 11, vibAmt: 10 });
      A.noise({ filter: 'bandpass', f0: 700 * p, f1: 250, q: 1.3, dur: 1.1, vol: 0.4 * v, attack: 0.05 });
    },
    spirit(p, v) { // 悪霊のうめき
      A.tone({ type: 'sine', f0: 520 * p, f1: 300, dur: 0.8, vol: 0.12 * v, vib: 6, vibAmt: 30, verb: true, attack: 0.1 });
      A.noise({ filter: 'bandpass', f0: 1400 * p, q: 8, dur: 0.6, vol: 0.12 * v, attack: 0.1 });
    },
    grab(p, v) { A.noise({ filter: 'lowpass', f0: 1200 * p, dur: 0.08, vol: 0.4 * v }); A.tone({ type: 'sine', f0: 200 * p, f1: 120, dur: 0.08, vol: 0.3 * v }); },
    awaken(p, v) {
      A.tone({ type: 'sawtooth', f0: 40 * p, f1: 160, dur: 1.2, vol: 0.4 * v, filter: 'lowpass', ff: 300, ff1: 2400, verb: true, attack: 0.2 });
      A.noise({ filter: 'bandpass', f0: 200, f1: 3000, q: 0.8, dur: 1.2, vol: 0.4 * v, attack: 0.3 });
      S.roar(p * 1.1, v * 0.7);
    },
    select(p, v) { A.tone({ type: 'square', f0: 660 * p, dur: 0.05, vol: 0.08 * v, filter: 'lowpass', ff: 2000 }); },
    confirm(p, v) {
      A.tone({ type: 'sawtooth', f0: 220 * p, dur: 0.5, vol: 0.18 * v, filter: 'lowpass', ff: 2000, ff1: 300, verb: true });
      A.noise({ filter: 'bandpass', f0: 2000 * p, f1: 300, dur: 0.35, vol: 0.3 * v });
      A.tone({ type: 'sine', f0: 110 * p, f1: 55, dur: 0.5, vol: 0.4 * v });
    },
    thunder(p, v) { // 雷鳴
      A.noise({ filter: 'lowpass', f0: 520 * p, f1: 60, dur: 1.0, vol: 0.55 * v, attack: 0.03, rate: 0.5, verb: true });
      A.tone({ type: 'sine', f0: 52 * p, f1: 28, dur: 1.2, vol: 0.35 * v });
    },
    bell(p, v) { // 鐘（ステージ開始など）
      [1, 2.0, 2.76, 4.07, 5.4].forEach((m, i) => A.tone({ type: 'sine', f0: 196 * p * m, dur: 2.2 - i * 0.3, vol: 0.2 * v / (i + 1), verb: true }));
    },
  };

  /** 効果音を鳴らす。同名連打は間引く */
  A.sfx = function (name, opt) {
    if (!A.ctx || A.ctx.state !== 'running' || A.muted) return;
    const fn = S[name];
    if (!fn) return;
    opt = opt || {};
    const now = A.ctx.currentTime, key = opt.pitch ? name + '@' + opt.pitch : name; // 音程違いの重ね鳴らしは間引かない
    if (A._lastSfx[key] && now - A._lastSfx[key] < 0.025) return;
    A._lastSfx[key] = now;
    try { fn((opt.pitch || 1) * U.rand(0.96, 1.04), opt.vol == null ? 1 : opt.vol); } catch (e) { /* ignore */ }
  };

  // ------------------------------------------------------------ music
  const NOTE = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
  function noteToMidi(tok) {
    const m = /^([a-g])([#b]?)(-?\d)$/.exec(tok);
    if (!m) return null;
    let n = NOTE[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
    return 12 * (parseInt(m[3], 10) + 1) + n;
  }
  A.midiHz = m => 440 * Math.pow(2, (m - 69) / 12);
  /** 記法文字列 → ステップ配列 */
  A.parseSeq = function (str) {
    const out = [];
    for (let tok of str.replace(/\|/g, ' ').split(/\s+/)) {
      if (!tok) continue;
      if (tok === '.') { out.push(null); continue; }
      if (tok === '-') { out.push('-'); continue; }
      let vel = 1;
      if (tok.endsWith('!')) { vel = 1.35; tok = tok.slice(0, -1); }
      else if (tok.endsWith('?')) { vel = 0.55; tok = tok.slice(0, -1); }
      if (tok === 'x') { out.push({ n: [0], v: vel }); continue; }
      const ns = tok.split('+').map(noteToMidi).filter(n => n != null);
      out.push(ns.length ? { n: ns, v: vel } : null);
    }
    return out;
  };

  // 楽器: (t, midi, dur(sec), vel, dest)
  const INST = A.inst = {
    kick(t, n, d, v, o) {
      A.tone({ t, type: 'sine', f0: 150, f1: 42, slide: 0.12, dur: 0.35, vol: 0.9 * v, dest: o });
      A.noise({ t, filter: 'lowpass', f0: 1200, dur: 0.03, vol: 0.25 * v, dest: o });
    },
    taiko(t, n, d, v, o) {
      A.tone({ t, type: 'sine', f0: 110, f1: 55, slide: 0.2, dur: 0.6, vol: 0.9 * v, dest: o, verb: true });
      A.noise({ t, filter: 'lowpass', f0: 700, f1: 200, dur: 0.25, vol: 0.4 * v, dest: o });
    },
    snare(t, n, d, v, o) {
      A.noise({ t, filter: 'bandpass', f0: 1800, q: 0.7, dur: 0.18, vol: 0.45 * v, dest: o, verb: true });
      A.tone({ t, type: 'triangle', f0: 220, f1: 150, dur: 0.1, vol: 0.25 * v, dest: o });
    },
    hat(t, n, d, v, o) { A.noise({ t, filter: 'highpass', f0: 7000, dur: 0.045, vol: 0.14 * v, dest: o }); },
    ohat(t, n, d, v, o) { A.noise({ t, filter: 'highpass', f0: 6000, dur: 0.22, vol: 0.12 * v, dest: o }); },
    crash(t, n, d, v, o) { A.noise({ t, filter: 'highpass', f0: 3500, dur: 1.4, vol: 0.2 * v, dest: o, verb: true }); },
    anvil(t, n, d, v, o) { // 金床（鍛冶屋の打撃音）
      [1, 2.76, 5.4].forEach((m, i) => A.tone({ t, type: 'sine', f0: 880 * m, dur: 0.4 - i * 0.1, vol: 0.14 * v / (i + 1), dest: o, verb: true }));
    },
    bass(t, n, d, v, o) {
      const f = A.midiHz(n);
      A.tone({ t, type: 'sawtooth', f0: f, dur: Math.max(0.12, d), vol: 0.34 * v, filter: 'lowpass', ff: 520, q: 4, dest: o });
      A.tone({ t, type: 'sine', f0: f / 2, dur: Math.max(0.12, d), vol: 0.3 * v, dest: o });
    },
    dist(t, n, d, v, o) { // 歪んだギター風パワーコード
      const f = A.midiHz(n);
      [1, 1.5, 2].forEach((m, i) => {
        A.tone({ t, type: 'square', f0: f * m, dur: Math.max(0.1, d), vol: 0.09 * v, detune: i ? 6 : -6, filter: 'lowpass', ff: 1800, q: 2, dest: o });
      });
    },
    pad(t, n, d, v, o) {
      const f = A.midiHz(n);
      [-9, 0, 9].forEach(dt => A.tone({ t, type: 'sawtooth', f0: f, detune: dt, attack: Math.min(0.4, d * 0.4), dur: d + 0.25, vol: 0.06 * v, filter: 'lowpass', ff: 1100, dest: o, verb: true }));
    },
    choir(t, n, d, v, o) { // 「アー」という声のような合唱パッド
      const c = A.ctx, f = A.midiHz(n);
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.11 * v, t + Math.min(0.35, d * 0.5));
      g.gain.setValueAtTime(0.11 * v, t + d);
      g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.5);
      const f1 = c.createBiquadFilter(); f1.type = 'bandpass'; f1.frequency.value = 800; f1.Q.value = 6;
      const f2 = c.createBiquadFilter(); f2.type = 'bandpass'; f2.frequency.value = 1150; f2.Q.value = 7;
      const mix = c.createGain(); mix.gain.value = 2.2;
      [-7, 0, 7].forEach(dt => {
        const os = c.createOscillator(); os.type = 'sawtooth'; os.frequency.value = f; os.detune.value = dt;
        const lf = c.createOscillator(), lg = c.createGain(); lf.frequency.value = 5 + Math.random(); lg.gain.value = 3;
        lf.connect(lg); lg.connect(os.detune);
        os.connect(f1); os.connect(f2);
        os.start(t); os.stop(t + d + 0.6); lf.start(t); lf.stop(t + d + 0.6);
      });
      f1.connect(mix); f2.connect(mix); mix.connect(g); g.connect(o); g.connect(A.verbSend);
    },
    lead(t, n, d, v, o) {
      const f = A.midiHz(n);
      A.tone({ t, type: 'sawtooth', f0: f, dur: d + 0.08, vol: 0.1 * v, filter: 'lowpass', ff: 2600, vib: 5.5, vibAmt: 4, dest: o, verb: true, attack: 0.02 });
      A.tone({ t, type: 'square', f0: f, detune: 7, dur: d + 0.08, vol: 0.05 * v, filter: 'lowpass', ff: 2000, dest: o });
    },
    strings(t, n, d, v, o) {
      const f = A.midiHz(n);
      [-6, 6].forEach(dt => A.tone({ t, type: 'sawtooth', f0: f, detune: dt, attack: 0.08, dur: d + 0.2, vol: 0.07 * v, filter: 'lowpass', ff: 2400, vib: 5, vibAmt: 3, dest: o, verb: true }));
    },
    pluck(t, n, d, v, o) { // リュート / ハープ風
      const f = A.midiHz(n);
      A.tone({ t, type: 'triangle', f0: f, dur: 0.6, vol: 0.2 * v, dest: o, verb: true });
      A.tone({ t, type: 'sawtooth', f0: f, dur: 0.25, vol: 0.06 * v, filter: 'lowpass', ff: 3000, ff1: 400, dest: o });
    },
    bell(t, n, d, v, o) {
      const f = A.midiHz(n);
      [1, 2.4, 3.9].forEach((m, i) => A.tone({ t, type: 'sine', f0: f * m, dur: 1.6 - i * 0.4, vol: 0.1 * v / (i + 1), dest: o, verb: true }));
    },
    organ(t, n, d, v, o) {
      const f = A.midiHz(n);
      [1, 2, 3, 4].forEach((m, i) => A.tone({ t, type: 'sine', f0: f * m, dur: d + 0.1, attack: 0.02, vol: 0.06 * v / (i + 1), dest: o, verb: true }));
    },
  };

  A.playSong = function (id, opt) {
    if (A.songId === id && A.song) return;
    const def = A.songs[id];
    A.stopSong();
    if (!def) return;
    if (!A.ctx) { A._pendingSong = id; return; }
    // 曲データを前処理
    const steps = (def.steps || 16) * (def.bars || 1);
    const tracks = def.tracks.map(tr => {
      let seq = typeof tr.seq === 'string' ? A.parseSeq(tr.seq) : tr.seq;
      return { inst: INST[tr.inst], vol: tr.vol == null ? 1 : tr.vol, seq, oct: tr.oct || 0, len: seq.length };
    });
    const bus = A.ctx.createGain(); bus.gain.value = 0.0001; bus.connect(A.musBus);
    bus.gain.exponentialRampToValueAtTime(1, A.ctx.currentTime + (opt && opt.fade || 0.3));
    A.song = { def, tracks, steps, step: 0, next: A.ctx.currentTime + 0.08, dt: 60 / def.bpm / ((def.steps || 16) / 4), bus, once: !!def.once, done: false };
    A.songId = id;
  };
  A.stopSong = function (fade) {
    if (A.song && A.ctx) {
      const b = A.song.bus, t = A.ctx.currentTime;
      try { b.gain.cancelScheduledValues(t); b.gain.setValueAtTime(b.gain.value, t); b.gain.exponentialRampToValueAtTime(0.0001, t + (fade || 0.25)); } catch (e) { /* ignore */ }
      setTimeout(() => { try { b.disconnect(); } catch (e) { /* ignore */ } }, ((fade || 0.25) + 0.3) * 1000);
    }
    A.song = null; A.songId = null; A._pendingSong = null;
  };
  /** 毎フレーム呼ばれる先読みスケジューラ */
  A.tick = function () {
    const s = A.song;
    if (!s || !A.ctx || A.ctx.state !== 'running' || s.done) return;
    const horizon = A.ctx.currentTime + 0.14;
    if (s.next < A.ctx.currentTime - 0.3) s.next = A.ctx.currentTime + 0.02; // 復帰時の遅延を吸収
    while (s.next < horizon) {
      if (!A.muted) for (const tr of s.tracks) { // ミュート中は音を作らず、曲の位置だけ進める
        if (!tr.inst || !tr.len) continue;
        const ev = tr.seq[s.step % tr.len];
        if (!ev || ev === '-') continue;
        // 音の長さ = 続く '-' の数
        let len = 1;
        while (s.step + len < s.steps && tr.seq[(s.step + len) % tr.len] === '-' && len < tr.len) len++;
        const dur = len * s.dt;
        for (const n of ev.n) {
          try { tr.inst(s.next, n + tr.oct, dur * 0.95, ev.v * tr.vol, s.bus); } catch (e) { /* ignore */ }
        }
      }
      s.step++;
      s.next += s.dt;
      if (s.step >= s.steps) {
        if (s.once) { s.done = true; break; }
        s.step = s.def.loopFrom ? s.def.loopFrom * (s.def.steps || 16) : 0;
      }
    }
  };

  // 仮の曲（audio_music.js で上書きされる）
  A.songs.placeholder = {
    bpm: 120, steps: 16, bars: 1,
    tracks: [
      { inst: 'kick', seq: 'x . . . x . . . x . . . x . . .' },
      { inst: 'bass', seq: 'a1 - - - . . . . f1 - - - . . . .' },
    ],
  };
})(window.BK);

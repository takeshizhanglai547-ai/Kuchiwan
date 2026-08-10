// 独立検証用ハーネス：Music IIFE を録音型フェイク AudioContext に載せる
const fs = require('fs');

function extractMusic(htmlPath) {
  const s = fs.readFileSync(htmlPath, 'utf8');
  const a = s.indexOf('const Music=(()=>{');
  if (a < 0) throw new Error('Music IIFE not found');
  const b = s.indexOf('\n})();', a);
  if (b < 0) throw new Error('end not found');
  const src = s.slice(a, b + 6);
  const startLine = s.slice(0, a).split('\n').length;
  return { src, startLine };
}

class P {
  constructor(v) { this.evts = []; this._v = v; }
  get value() { return this._v; }
  set value(v) { this._v = v; this.evts.push(['s', v, -1e9]); }
  setValueAtTime(v, t) { this.evts.push(['s', v, t]); this._v = v; }
  linearRampToValueAtTime(v, t) { this.evts.push(['l', v, t]); this._v = v; }
  exponentialRampToValueAtTime(v, t) { this.evts.push(['e', v, t]); this._v = v; }
  setTargetAtTime(v, t) { this.evts.push(['s', v, t]); this._v = v; }
  cancelScheduledValues(t) { }
  at(x) {
    const e = this.evts.slice().sort((a, b) => a[2] - b[2]);
    if (!e.length) return this._v;
    if (x <= e[0][2]) return e[0][1];
    let prev = e[0];
    for (let i = 1; i < e.length; i++) {
      const cur = e[i];
      if (x <= cur[2]) {
        const span = cur[2] - prev[2];
        if (span <= 0) return cur[1];
        const r = (x - prev[2]) / span;
        if (cur[0] === 'l') return prev[1] + (cur[1] - prev[1]) * r;
        if (cur[0] === 'e') {
          const a0 = Math.max(prev[1], 1e-9), a1 = Math.max(cur[1], 1e-9);
          return a0 * Math.pow(a1 / a0, r);
        }
        return prev[1];
      }
      prev = cur;
    }
    return prev[1];
  }
  peak() { if (!this.evts.length) return this._v; let m = 0; for (const e of this.evts) m = Math.max(m, e[1]); return m; }
}

class Node {
  constructor(kind) { this.kind = kind; this.outs = []; }
  connect(d) { this.outs.push(d); return d; }
  disconnect() { this.outs.length = 0; }
}

function stackLines() {
  const old = Error.stackTraceLimit; Error.stackTraceLimit = 40;
  const st = new Error().stack.split('\n').slice(1);
  Error.stackTraceLimit = old;
  const out = [];
  for (let l of st) {
    l = l.trim();
    const nm = /^at\s+(?:new\s+)?([^\s(]+)/.exec(l);
    // 行番号は行末（<anonymous>:LINE:COL）を採る
    const pos = /:(\d+):(\d+)\)?\s*$/.exec(l);
    if (pos) out.push({ fn: nm ? nm[1] : '?', line: +pos[1], ev: /<anonymous>/.test(l), raw: l });
  }
  return out;
}

function makeCtx(rec) {
  return {
    currentTime: 0,
    sampleRate: 44100,
    createGain() { const n = new Node('gain'); n.gain = new P(1); return n; },
    createBiquadFilter() {
      const n = new Node('biquad'); n.type = 'lowpass';
      n.frequency = new P(350); n.Q = new P(1); n.gain = new P(0); return n;
    },
    createOscillator() {
      const n = new Node('osc'); n.type = 'sine'; n.frequency = new P(440); n.detune = new P(0);
      n.start = (t) => { n._t0 = t; }; n.stop = (t) => { n._t1 = t; };
      n._stack = stackLines(); rec.nodes.push(n); return n;
    },
    createBufferSource() {
      const n = new Node('buf'); n.buffer = null; n.loop = false; n.playbackRate = new P(1);
      n.start = (t) => { n._t0 = t; }; n.stop = (t) => { n._t1 = t; };
      n._stack = stackLines(); rec.nodes.push(n); return n;
    },
    createBuffer(c, l, sr) { return { length: l, sampleRate: sr, numberOfChannels: c, getChannelData: () => new Float32Array(l) }; },
    createDelay() { const n = new Node('delay'); n.delayTime = new P(0.3); return n; },
    createStereoPanner() { const n = new Node('pan'); n.pan = new P(0); return n; },
  };
}

// 出力バス(musicGain)までのゲイン積（peak）
function gainToBus(node, bus, depth) {
  depth = depth || 0;
  if (depth > 12) return 0;
  if (node === bus) return 1;
  if (!node || !node.outs) return 0;
  let best = 0;
  for (const o of node.outs) {
    const g = gainToBus(o, bus, depth + 1);
    if (g > 0) best = Math.max(best, g * (o.kind === 'gain' ? o.gain.peak() : 1));
  }
  return best;
}
// 経路上の最初の gain ノード（エンベロープ評価用）
function envNode(node, bus, depth) {
  depth = depth || 0;
  if (depth > 12 || !node || !node.outs) return null;
  for (const o of node.outs) {
    if (o.kind === 'gain' && gainToBus(o, bus, 0) > 0) return o;
    const r = envNode(o, bus, depth + 1);
    if (r) return r;
  }
  return null;
}

function instrument(src) {
  const inject = `
  function _run(n){ nextT=0; step=0; loopN=3; for(let i=0;i<n;i++){ scheduleStep(step); step=(step+1)&63; nextT+=curStep; } }
  function _setup(m,idx){ mode=m; themeIdx=idx||0; }
  return {_run,_setup,_song:()=>song(),_SONGS:SONGS,_BATTLE:BATTLE,
    _cline:(S,i)=>{ try{ return cline(S,i); }catch(e){ return null; } },
`;
  const marker = '  return {\n';
  if (src.indexOf(marker) < 0) throw new Error('return marker not found');
  return src.replace(marker, inject);
}

function build(htmlPath, opts) {
  opts = opts || {};
  const { src, startLine } = extractMusic(htmlPath);
  const body = instrument(src);
  const rec = { nodes: [] };
  const ctx = makeCtx(rec);
  const musicGain = ctx.createGain();
  const noiseBuf = ctx.createBuffer(1, 44100, 44100);
  const header = [
    'const actx=ENV.actx, musicGain=ENV.musicGain, noiseBuf=ENV.noiseBuf, musicDelay=null;',
    'const sndOn=true; const lap=ENV.lap; const stage=ENV.stage;',
    'const midi=n=>440*Math.pow(2,(n-69)/12);',
    'function themeIdxFor(st){ return ENV.themeIdx; }',
    'const setInterval=()=>0, clearInterval=()=>0, setTimeout=()=>0;',
    '__PROBE__();',
  ];
  const full = header.join('\n') + '\n' + body + '\nreturn Music;';
  let probeLine = 0;
  const f = new Function('ENV', '__PROBE__', full);
  const M = f({ actx: ctx, musicGain, noiseBuf, lap: opts.lap || 1, stage: 1, themeIdx: opts.themeIdx || 0 },
    () => { probeLine = stackLines().filter(f=>f.ev)[0].line; });
  const srcLine0 = probeLine + 1;   // music src の1行目に対応する報告行番号
  const srcLines = src.split('\n');
  return {
    M, rec, ctx, musicGain, srcLine0, srcLines, htmlStartLine: startLine,
    lineText: (rl) => srcLines[rl - srcLine0] || '',
    htmlLine: (rl) => startLine + (rl - srcLine0),
  };
}

module.exports = { build, gainToBus, envNode, P, extractMusic };

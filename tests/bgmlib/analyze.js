// パート逆引き＋ユニゾン／音域／セクション別イベント数の実測
const { build, gainToBus, envNode } = require('./harness');

const HELPER = {
  strings: 'pad', brass: 'brass', bassN: 'bass', organ: 'organ', choir: 'choir',
  timp: 'timp', kick: 'kick', elecKick: 'kick', snare: 'snare', hat: 'hat',
  crash: 'crash', tom: 'tom', pluck: 'pluck', fmBell: 'fmbell', riser: 'riser',
  softFill: 'softfill', fill: 'fill', stinger: 'stinger',
};

// 呼び出し行のテキスト→パート名（変数名で見分ける）
function classifyBySrc(txt) {
  if (/voice\(midi\(nn\+12\)/.test(txt)) return 'leadoct';          // 旧: リードのオクターブ重複層
  if (/voice\(midi\(nn\)/.test(txt)) return 'lead';
  if (/voice\(midi\(h\)/.test(txt)) return 'harm';
  if (/voice\(midi\(dm/.test(txt)) return 'descant';
  if (/voice\(midi\(cn\)/.test(txt)) return 'counter';
  if (/voice\(midi\(ch\[\(st>>1\)%3\]\+24\)/.test(txt)) return 'counter';  // 旧: 和音なぞりの対旋律
  if (/voice\(midi\(an\)|pluck\(midi\(an\)|fmBell\(midi\(an\)/.test(txt)) return 'arp';
  return null;
}

function analyze(htmlPath, mode, themeIdx, lap, steps) {
  steps = steps || 256;
  const B = build(htmlPath, { lap, themeIdx });
  B.M._setup(mode, themeIdx);
  B.M._run(steps);
  const S = B.M._song();
  const bus = B.musicGain;
  const notes = [];
  const unk = {};
  for (const n of B.rec.nodes) {
    if (n._t0 == null) continue;
    const g = gainToBus(n, bus, 0);
    if (!(g > 0)) continue;
    let part = null, callSrc = '';
    const frames = n._stack.filter(x => x.ev);
    for (const f of frames) {
      const nm = f.fn.replace(/^Object\./, '');
      if (HELPER[nm]) { part = HELPER[nm]; break; }
      const txt = B.lineText(f.line);
      const c = classifyBySrc(txt);
      if (c) { part = c; callSrc = txt.trim(); break; }
      if (nm === 'scheduleStep') { part = 'sched@' + B.htmlLine(f.line); callSrc = txt.trim(); break; }
    }
    if (!part) {
      part = 'unknown';
      unk[frames.map(f => f.fn + '@' + B.htmlLine(f.line)).slice(0, 3).join('<')] = 1;
    }
    const isTonal = n.kind === 'osc';
    const f0 = isTonal ? n.frequency.evts.filter(e => e[2] > -1e8).map(e => e[1])[0] : null;
    const pitch = f0 ? 69 + 12 * Math.log2(f0 / 440) : null;
    const en = envNode(n, bus, 0);
    let tAud = n._t1;
    if (en) {
      const pk = en.gain.peak(), t0 = n._t0, t1 = n._t1;
      for (let i = 0; i <= 60; i++) {
        const x = t0 + (t1 - t0) * i / 60;
        if (x > t0 && en.gain.at(x) < pk * 0.1) { tAud = x; break; }
      }
    }
    notes.push({ part, kind: n.kind, t0: n._t0, t1: n._t1, tAud, pitch, gain: g, env: en, callSrc });
  }
  return { notes, S, B, unk: Object.keys(unk) };
}

function unisonCount(notes, tol, useAud, skipDrums) {
  tol = tol == null ? 0.35 : tol;
  const DRUM = new Set(['kick', 'snare', 'hat', 'crash', 'tom', 'timp', 'riser']);
  let t = notes.filter(n => n.pitch != null);
  if (skipDrums) t = t.filter(n => !DRUM.has(n.part));
  t = t.map(n => ({ part: n.part, pitch: n.pitch, t0: n.t0, e: useAud ? n.tAud : n.t1 }))
    .sort((a, b) => a.t0 - b.t0);
  let c = 0; const pairs = {};
  for (let i = 0; i < t.length; i++) {
    for (let j = i + 1; j < t.length; j++) {
      if (t[j].t0 >= t[i].e) break;
      if (t[i].part === t[j].part) continue;
      if (Math.abs(t[i].pitch - t[j].pitch) <= tol) {
        c++;
        const k = [t[i].part, t[j].part].sort().join('x');
        pairs[k] = (pairs[k] || 0) + 1;
      }
    }
  }
  return { count: c, pairs };
}

function ranges(notes) {
  const r = {};
  for (const n of notes) {
    if (n.pitch == null) continue;
    if (!r[n.part]) r[n.part] = { lo: 999, hi: -999, n: 0 };
    r[n.part].lo = Math.min(r[n.part].lo, n.pitch);
    r[n.part].hi = Math.max(r[n.part].hi, n.pitch);
    r[n.part].n++;
  }
  return r;
}

function sectionCounts(notes, S) {
  const stepDur = 60 / S.bpm / 2;
  const secs = [0, 0, 0, 0];
  for (const n of notes) {
    const st = Math.round(n.t0 / stepDur);
    const sec = Math.floor(st / 64);
    if (sec >= 0 && sec < 4) secs[sec]++;
  }
  return secs;
}

// 同時発音のゲイン線形和のピーク（エンベロープを 5ms 刻みで評価）
function peakGainSum(notes, S, bus) {
  const stepDur = 60 / S.bpm / 2, total = stepDur * 256;
  let peak = 0, at = 0;
  for (let x = 0; x < total; x += 0.005) {
    let s = 0;
    for (const n of notes) {
      if (n.t0 > x || n.t1 < x) continue;
      const e = n.env ? n.env.gain.at(x) : n.gain;
      s += Math.max(0, e);
    }
    if (s > peak) { peak = s; at = x; }
  }
  return { peak, at };
}

module.exports = { analyze, unisonCount, ranges, sectionCounts, peakGainSum };

if (require.main === module) {
  const [, , html, mode, idx, lap] = process.argv;
  const r = analyze(html, mode || 'battle', +(idx || 0), +(lap || 1));
  const u = unisonCount(r.notes, 0.35, false);
  const ua = unisonCount(r.notes, 0.35, true);
  const up = unisonCount(r.notes, 0.35, false, true);
  console.log('mode=' + mode + ' idx=' + idx + ' lap=' + lap + ' notes=' + r.notes.length + ' unk=' + JSON.stringify(r.unk));
  console.log('unison(full)=' + u.count + '  (-20dB窓)=' + ua.count + '  (打楽器除く)=' + up.count);
  console.log('pairs:', Object.entries(u.pairs).sort((a, b) => b[1] - a[1]).map(x => x[0] + ':' + x[1]).join(' '));
  console.log('sections:', sectionCounts(r.notes, r.S).join('/'));
  const rg = ranges(r.notes);
  for (const k of Object.keys(rg).sort()) console.log('  ' + k.padEnd(12), rg[k].lo.toFixed(1), '-', rg[k].hi.toFixed(1), 'n=' + rg[k].n);
}

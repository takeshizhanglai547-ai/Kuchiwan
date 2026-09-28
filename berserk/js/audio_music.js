'use strict';
/* =====================================================================
 *  audio_music.js ── BGM 曲データ（audio.js のステップシーケンサ用）
 *
 *  すべてオリジナル曲。短調／旋法（エオリアン・フリジアン・和声的短音階）で統一。
 *    title     ニ短調      鐘 + 合唱 + 遠い太鼓（A: 鐘の旋律 / B: 弦の旋律）
 *    stage1    ホ短調      行軍する戦太鼓・金床・リード（A: パッド / B: 合唱）
 *    stage2    ヘ・フリジアン  地下牢。半音でうなるベース、水滴、鎖の金属音
 *    stage3    ト短調(和声) 12/8 の疾駆（馬のギャロップ）
 *    stage4    嬰ヘ短調    霧の森。合唱の霧、妖精の鐘、心音のような太鼓
 *    stage5    ハ短調      教会オルガンの聖歌 + 雨（16分の細かいハット）
 *    stage6    イ・フリジアン(+増4度)  蝕。歪んだ刻み、合唱、弔鐘
 *    boss      ホ・フリジアン  歪んだパワーコードのリフ
 *    lastboss  ニ短調(和声) オルガンの分散和音 + 合唱 + 太鼓（2小節の導入後ループ）
 *    clear     ハ短調→ハ長調の短いファンファーレ（once）
 *    gameover  イ短調の短い葬送（once）
 *    ending    イ短調 12/8  リュートの分散和音 + 弦（長いループ）
 *
 *  記法は audio.js 冒頭を参照。ここでは書きやすくするために次のヘルパーを使う:
 *    M('e4/4 g4/2 ./2 x!/4')   音価（ステップ数）付き → 'e4 - - - g4 - . . x! . . .'
 *    H('c4+e4+g4/32', 8)       和音を 8 ステップごとに打ち直す（減衰する楽器用）
 *    R(str, n) / J(a, b, ...)  くり返し / 連結
 *    riff('e2 c3@1', p0, p1)   1小節 = 1ルート音。パターンは半音オフセット（'@n' でパターン選択）
 *  メモ:
 *    ・pad / strings / organ / lead / bass は音の長さの中で指数減衰する（弓・鍵盤の余韻に近い）。
 *      本当に持続するのは choir だけなので、持続和音は choir、動きは他の楽器で作る。
 *    ・choir / pad / strings は1音あたりのノード数が多い → 2分音符以上の長い音だけで使う。
 *    ・各トラックの vol は OfflineAudioContext で描画して測った値で調整済み（1 を超えるのは意図的）。
 *      目安: 旋律 > 和音(合唱) > ベース > 打楽器。スマホのスピーカー（低音が出ない）でも旋律が聞こえるように。
 * ===================================================================== */
(function (BK) {
  const A = BK.audio;
  if (!A) return;

  // ------------------------------------------------------------ 記法ヘルパー
  const PC = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
  const NAMES = ['c', 'c#', 'd', 'd#', 'e', 'f', 'f#', 'g', 'g#', 'a', 'a#', 'b'];
  function midi(s) {
    const m = /^([a-g])([#b]?)(-?\d)$/.exec(s);
    return m ? 12 * (parseInt(m[3], 10) + 1) + PC[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) : null;
  }
  const noteName = n => NAMES[((n % 12) + 12) % 12] + (Math.floor(n / 12) - 1);
  const R = (s, n) => Array(n).fill(s).join(' ');
  const J = (...a) => a.join(' ');

  /** 音価付き記法を展開。'音/ステップ数'（省略時 1）。'.' は休符、'x' は打楽器（伸ばさない） */
  function M(str) {
    const out = [];
    for (const tok of str.split(/\s+/)) {
      if (!tok || tok === '|') continue;
      const i = tok.lastIndexOf('/');
      const head = i < 0 ? tok : tok.slice(0, i);
      const n = i < 0 ? 1 : Math.max(1, parseInt(tok.slice(i + 1), 10) || 1);
      if (head === '.') { for (let k = 0; k < n; k++) out.push('.'); continue; }
      out.push(head);
      const fill = head[0] === 'x' ? '.' : '-';
      for (let k = 1; k < n; k++) out.push(fill);
    }
    return out.join(' ');
  }
  /** 和音を per ステップごとに打ち直す: H('e3+g3/32 c3+e3/16', 8) */
  function H(str, per) {
    const out = [];
    for (const tok of str.split(/\s+/)) {
      if (!tok || tok === '|') continue;
      const i = tok.lastIndexOf('/');
      const head = i < 0 ? tok : tok.slice(0, i);
      const len = i < 0 ? per : parseInt(tok.slice(i + 1), 10) || per;
      for (let k = 0; k < len; k += per) out.push(M(head + '/' + Math.min(per, len - k)));
    }
    return out.join(' ');
  }
  /** ルート音列 × オフセットのパターン → 記法。パターン内の '0+7' は和音、'12!' は強拍 */
  function riff(roots, ...pats) {
    const P = pats.map(p => M(p).split(' '));
    const out = [];
    for (const r of roots.split(/\s+/)) {
      if (!r || r === '|') continue;
      const at = r.indexOf('@');
      const rn = at < 0 ? r : r.slice(0, at);
      const pat = P[at < 0 ? 0 : parseInt(r.slice(at + 1), 10)] || P[0];
      if (rn === '.') { out.push(R('.', pat.length)); continue; }
      const base = midi(rn);
      for (const tok of pat) {
        if (tok === '.' || tok === '-') { out.push(tok); continue; }
        const acc = /[!?]$/.test(tok) ? tok.slice(-1) : '';
        const body = acc ? tok.slice(0, -1) : tok;
        out.push(body.split('+').map(o => noteName(base + parseInt(o, 10))).join('+') + acc);
      }
    }
    return out.join(' ');
  }
  const rest = n => R('.', n);

  const S = A.songs;

  // ================================================================ title
  // ニ短調 72BPM。A: 鐘が主旋律 / B: 弦が歌い、鐘は低く応える。合唱は全編で持続。
  S.title = {
    bpm: 72, steps: 16, bars: 16,
    tracks: [
      { inst: 'choir', vol: 0.31, seq: M(
        'd4+f4+a4/16 d4+f4+bb4/16 d4+g4+bb4/16 c#4+e4+a4/16 d4+f4+a4/16 eb4+g4+bb4/16 e4+g4+c5/16 c#4+e4+a4/16 ' +
        'd4+f4+bb4/16 c4+f4+a4/16 d4+g4+bb4/16 d4+f4+a4/16 eb4+g4+bb4/16 d4+f4+bb4/16 d4+g4+bb4/16 d4+e4+a4/8 c#4+e4+a4/8') },
      { inst: 'bell', vol: 1.9, seq: M(
        'a4/8 d5/4 c5/4 | bb4/12 f4/4 | g4/8 bb4/4 d5/4 | e4/8 a4/4 c#5/4 | ' +
        'd5/8 f5/4 d5/4 | eb5/8 bb4/4 g4/4 | c5/8 bb4/4 g4/4 | a4/16 | ' +
        'bb4?/16 a4?/16 g4?/16 f4?/16 eb4?/16 d4?/16 g4?/16 a4?/16') },
      { inst: 'strings', vol: 3.0, seq: J(rest(128), M(
        'd5/8 c5/4 bb4/4 | a4/8 c5/8 | bb4/8 d5/4 g4/4 | a4/16 | ' +
        'g4/8 bb4/8 | d5/8 f4/8 | g4/8 bb4/4 d5/4 | e5/8 c#5/8')) },
      { inst: 'organ', vol: 1.2, seq: M(
        'd2+d3/16 bb1+bb2/16 g1+g2/16 a1+a2/16 d2+d3/16 eb2+eb3/16 c2+c3/16 a1+a2/16 ' +
        'bb1+bb2/16 a1+a2/16 g1+g2/16 d2+d3/16 eb2+eb3/16 d2+d3/16 g1+g2/16 a1+a2/16') },
      { inst: 'taiko', vol: 0.55, seq: R(J(R(M('x!/12 x?/2 x?/2'), 7), M('x/4 x/4 x/2 x/2 x!/2 x/2')), 2) },
      { inst: 'crash', vol: 1.0, seq: M('x/128') },
    ],
  };

  // ================================================================ stage1
  // 紅い月の城下町。ホ短調 138BPM。戦太鼓で行軍し、B では合唱と金床が加わる。
  const s1bass = riff(
    'e2 e2@2 c2@1 d2@1 e2 e2@2 a1@1 b1@1 | a1@1 a1@1 e2 e2@2 c2@1 d2@1 b1@1 b1@3',
    '0! . 0 0 12 . 0 . 10 . 0 . 7 . 0 .',
    '0! . 0 0 12 . 0 . 7 . 0 . 12 . 0 .',
    '0! . 0 0 12 . 0 . 3 . 5 . 7 . 10 .',
    '0! . 0 0 0 . 0 0 0 . 0 0 0 . 4 .');
  const s1drumBar = 'x! . . . . . x? . x . . . . . x? .';
  const s1drumFill = 'x! . . . x . . . x . x . x! x x x';
  const s1snBar = '. . . . x . . x? . . . . x . . .';
  const s1snFill = '. . . . x . . . x? x? x? x? x x x! x!';
  S.stage1 = {
    bpm: 138, steps: 16, bars: 16,
    tracks: [
      { inst: 'taiko', vol: 0.55, seq: R(J(R(s1drumBar, 7), s1drumFill), 2) },
      { inst: 'snare', vol: 0.9, seq: R(J(R(s1snBar, 7), s1snFill), 2) },
      { inst: 'hat', vol: 3.0, seq: '. . x? . . . x? . . . x? . . . x? x?' },
      { inst: 'crash', vol: 0.9, seq: M('x/128') },
      { inst: 'anvil', vol: 0.8, seq: J(R(M('./16 ./12 x?/4'), 4), R(M('./4 x?/8 x/4'), 8)) },
      { inst: 'bass', vol: 0.9, seq: s1bass },
      { inst: 'pad', vol: 0.9, seq: J(H(
        'g3+b3+e4/32 g3+c4+e4/16 f#3+a3+d4/16 g3+b3+e4/32 a3+c4+e4/16 f#3+b3+d#4/16', 8), rest(128)) },
      { inst: 'choir', vol: 0.38, seq: J(rest(128), M(
        'a3+c4+e4/32 g3+b3+e4/32 g3+c4+e4/16 f#3+a3+d4/16 f#3+b3+d#4/32')) },
      { inst: 'lead', vol: 1.8, seq: M(
        'e4/2 g4/2 b4/4 a4/2 g4/2 f#4/4 | e4/12 ./4 | e4/2 g4/2 c5/4 b4/2 a4/2 g4/4 | a4/8 f#4/4 d4/4 | ' +
        'e5/6 d5/2 b4/4 g4/4 | a4/2 b4/2 g4/4 e4/8 | c5/6 b4/2 a4/4 e4/4 | f#4/4 a4/4 b4/4 d#5/4 | ' +
        'e5/8 d5/4 c5/4 | c5/4 b4/4 a4/8 | b4/6 g4/2 e4/8 | g4/4 a4/4 b4/8 | ' +
        'c5/8 e5/8 | d5/6 c5/2 a4/8 | b4/8 a4/4 f#4/4 | d#4/12 ./4') },
    ],
  };

  // ================================================================ stage2
  // 伯爵の地下牢。ヘ・フリジアン 108BPM。半音でうなるベース、水滴（撥弦）、鎖と金槌。
  const s2snBar = '. . . . . . . . x . . . . . . .';
  const s2snFill = '. . . . . . . . x . . . x? x? x x';
  S.stage2 = {
    bpm: 108, steps: 16, bars: 16,
    tracks: [
      { inst: 'kick', vol: 0.7, seq: 'x! . . . . . x? . . . x . . . . .' },
      { inst: 'snare', vol: 1.1, seq: J(R(s2snBar, 7), s2snFill) },
      { inst: 'taiko', vol: 0.55, seq: M('x!/32') },
      { inst: 'hat', vol: 1.25, seq: 'x . x? . x . x? . x . x? . x . x? x?' },
      { inst: 'anvil', vol: 1.5, seq: M('./26 x?/6') },
      { inst: 'pluck', vol: 1.0, seq: M( // 水滴（和音に合わせて1〜2粒/小節）
        'c6/11 f5?/5 | ./6 ab5/10 | db6/9 bb5?/7 | ./4 gb5/12 | c6/11 f5?/5 | ./6 ab5/7 c6?/3 | db6/9 f5?/7 | ./4 ab5/12 | ' +
        'f5/11 db6?/5 | ./6 bb5/10 | c6/9 ab5?/7 | ./4 f5/12 | db6/11 bb5?/5 | ./6 g5/10 | c6/9 g5?/7 | ./4 e5/12') },
      { inst: 'bass', vol: 1.0, seq: riff(
        'f2 f2 f2 f2@3 f2 f2 f2 f2@3 | db2@1 eb2@1 f2 f2@3 gb2@1 eb2@1 c2@2 c2@2',
        '0! . 0 . 1 . 0 . 12 . 0 . 3 . 1 .',
        '0! . 0 . 7 . 0 . 12 . 0 . 7 . 0 .',
        '0! . 0 . 1 . 4 . 7 . 4 . 1 . 0 .',
        '0! . 0 . 1 . 0 . 12 . 10 . 8 . 7 .') },
      { inst: 'pad', vol: 0.7, seq: H(
        'f3+ab3+c4/32 gb3+bb3+db4/32 f3+ab3+c4/32 f3+ab3+db4/32 ' +
        'f3+ab3+db4/16 g3+bb3+eb4/16 f3+ab3+c4/32 gb3+bb3+db4/16 g3+bb3+eb4/16 e3+g3+c4/32', 16) },
      { inst: 'lead', vol: 1.7, seq: J(rest(64), M(
        'f4/4 gb4/4 f4/8 | eb4/4 db4/4 c4/8 | f4/4 ab4/4 db5/8 | c5/4 bb4/4 ab4/8'), rest(128)) },
      { inst: 'strings', vol: 2.8, seq: J(rest(128), M(
        'ab4/8 f4/8 | g4/8 bb4/8 | c5/12 db5/4 | c5/8 ab4/8 | ' +
        'bb4/8 db5/8 | eb5/8 db5/4 bb4/4 | c5/8 bb4/4 g4/4 | e4/16')) },
    ],
  };

  // ================================================================ stage3
  // 疾駆。ト短調（和声的）12/8 = 1小節12ステップ。馬の蹄のようなギャロップで駆け抜ける。
  S.stage3 = {
    bpm: 138, steps: 12, bars: 16,
    tracks: [
      { inst: 'kick', vol: 0.55, seq: 'x! . x? x . x? x! . x? x . x?' },
      { inst: 'snare', vol: 0.9, seq: R(J(R('. . . x . . . . . x . .', 7), '. . . x . . . x? x? x x! x'), 2) },
      { inst: 'hat', vol: 1.7, seq: 'x x? x? x x? x? x x? x? x x? x?' },
      { inst: 'taiko', vol: 0.5, seq: 'x! . . . . . x . . . . .' },
      { inst: 'crash', vol: 0.9, seq: M('x/96') },
      { inst: 'bass', vol: 0.8, seq: riff(
        'g2 g2@1 eb2 f2 g2 g2@1 c2 d2@2 | eb2 f2 g2 g2@1 c2 eb2 d2 d2@2',
        '0! . 0 0 . 0 12 . 0 7 . 0',
        '0! . 0 3 . 0 5 . 0 7 . 10',
        '0! . 0 0 . 0 0! . 0 0! 0 0') },
      { inst: 'strings', vol: 0.7, seq: H(
        'g3+bb3+d4/24 g3+bb3+eb4/12 a3+c4+f4/12 g3+bb3+d4/24 g3+c4+eb4/12 f#3+a3+d4/12 ' +
        'g3+bb3+eb4/12 a3+c4+f4/12 g3+bb3+d4/24 g3+c4+eb4/12 g3+bb3+eb4/12 f#3+a3+d4/24', 6) },
      { inst: 'pluck', vol: 0.4, seq: J(rest(96), riff(
        'eb3@1 f3@1 g3 g3 c3 eb3@1 d3@1 d3@1',
        '0! 3 7 12 7 3 0 3 7 12 15 12',
        '0! 4 7 12 7 4 0 4 7 12 16 12')) },
      { inst: 'lead', vol: 1.8, seq: M(
        'g4/2 a4/1 bb4/2 c5/1 d5/6 | c5/2 bb4/1 a4/2 bb4/1 g4/6 | g4/2 a4/1 bb4/2 c5/1 eb5/6 | d5/2 c5/1 bb4/2 a4/1 c5/6 | ' +
        'd5/2 eb5/1 d5/2 c5/1 bb4/3 g4/3 | bb4/2 c5/1 d5/2 g5/1 f5/3 d5/3 | eb5/3 d5/3 c5/3 g4/3 | f#4/3 a4/3 c5/3 eb5/3 | ' +
        'g4/3 bb4/3 eb5/6 | d5/3 c5/3 a4/6 | bb4/3 d5/3 g5/6 | f5/3 eb5/3 d5/6 | ' +
        'eb5/6 d5/3 c5/3 | bb4/6 g4/3 bb4/3 | a4/12 | d5/3 c5/3 a4/3 f#4/3') },
    ],
  };

  // ================================================================ stage4
  // 霧の森。嬰ヘ短調 80BPM。合唱の霧、妖精の鐘、遠い心音。B でハープが揺らめく。
  S.stage4 = {
    bpm: 80, steps: 16, bars: 16,
    tracks: [
      { inst: 'taiko', vol: 0.4, seq: M('x/3 x?/13') },
      { inst: 'ohat', vol: 3.0, seq: M('./8 x?/24') },
      { inst: 'bass', vol: 0.55, seq: riff(
        'f#2 d2 b1 c#2 f#2 g2 e2 c#2 | d2 c#2 b1 f#2 g2 f#2 e2 c#2', '0!/8 0?/8') },
      { inst: 'choir', vol: 0.48, seq: M(
        'f#3+c#4/32 f#3+d4/16 f3+g#3/16 f#3+c#4/16 g3+b3/16 e3+b3/16 f3+g#3/16 ' +
        'f#3+a3/16 e3+g#3/16 d3+f#3/16 c#3+f#3/16 d3+g3/16 c#3+f#3/16 e3+g#3/16 f3+g#3/16') },
      { inst: 'bell', vol: 1.25, seq: M(
        'c#6/6 a5?/10 | f#5/6 c#6?/10 | d6/6 f#5?/10 | g#5/6 f5?/10 | c#6/6 g#5?/10 | b5/6 f#5?/10 | b5/6 g5?/10 | c#6/6 g#5?/10 | ' +
        'a5/6 f#5?/10 | g#5/6 e5?/10 | f#5/6 d6?/10 | c#6/6 a5?/10 | b5/6 d6?/10 | a5/6 c#6?/10 | g#5/6 b5?/10 | f5/6 g#5?/10') },
      { inst: 'pluck', vol: 0.65, seq: J(rest(128), riff(
        'd3@1 c#3 b2 f#3 g3@1 f#3 e3@1 c#3@1',
        '0!/2 7/2 12/2 15/2 19/2 15/2 12/2 7/2',
        '0!/2 7/2 12/2 16/2 19/2 16/2 12/2 7/2')) },
      { inst: 'lead', vol: 2.1, seq: J(
        rest(64), M('c#5/8 d5/4 c#5/4 | b4/8 f#5/8 | e5/8 d5/4 b4/4 | f5/8 c#5/8'),
        rest(64), M('d5/8 b4/8 | c#5/8 a4/8 | b4/8 g#4/8 | f4/8 g#4/4 c#5/4')) },
    ],
  };

  // ================================================================ stage5
  // 断罪の塔。ハ短調 96BPM。教会オルガンの聖歌、刑場への行進太鼓、降りしきる雨、弔鐘。
  S.stage5 = {
    bpm: 96, steps: 16, bars: 16,
    tracks: [
      // 雨: 16分で不規則な強弱のハット + ときどき長いノイズ
      { inst: 'hat', vol: 1.8, seq:
        'x? x? x x? x? x? x x? x? x x? x? x? x? x x? x? x x? x? x? x? x? x x? x? x? x x? x? x? x' },
      { inst: 'ohat', vol: 1.7, seq: M('./6 x?/10 ./14 x?/2') },
      { inst: 'taiko', vol: 0.5, seq: R(J(R(M('x!/8 x/8'), 7), M('x!/4 x/4 x/2 x/2 x!/4')), 2) },
      { inst: 'snare', vol: 0.8, seq: M('./12 x?/1 ./1 x?/1 x/1') },
      { inst: 'bell', vol: 1.0, seq: M('c4/32 c4/32 c4/32 c4/32 c4/32 ab3/32 c4/32 c4/32') },
      { inst: 'crash', vol: 0.8, seq: M('./128 x/128') },
      { inst: 'bass', vol: 0.6, seq: riff(
        'c3 ab2 f2 g2 c3 bb2 ab2 g2 | f2 c3 db3 g2 ab2 f2 d3 g2', '0!/8 0/4 12?/4') },
      { inst: 'organ', vol: 0.9, seq: J(H(
        'c4+eb4+g4/16 c4+eb4+ab4/16 c4+f4+ab4/16 b3+d4+g4/16 c4+eb4+g4/16 bb3+d4+f4/16 c4+eb4+ab4/16 b3+d4+g4/16', 8), rest(128)) },
      { inst: 'choir', vol: 0.29, seq: J(rest(128), M(
        'c4+f4+ab4/16 c4+eb4+g4/16 db4+f4+ab4/16 b3+d4+g4/16 c4+eb4+ab4/16 c4+f4+ab4/16 d4+f4+ab4/16 b3+d4+g4/16')) },
      // 聖歌の旋律（オルガン）
      { inst: 'organ', vol: 3.0, seq: M(
        'eb5/8 c5/4 d5/4 | c5/8 bb4/4 ab4/4 | ab4/4 c5/4 f5/4 eb5/4 | d5/8 b4/8 | ' +
        'c5/4 eb5/4 g5/4 f5/4 | f5/8 d5/4 bb4/4 | c5/4 eb5/4 ab4/4 c5/4 | b4/8 d5/8 | ' +
        'c5/8 ab4/4 f4/4 | g4/8 eb5/8 | f5/8 db5/4 ab4/4 | b4/8 d5/4 f5/4 | ' +
        'eb5/8 c5/4 ab4/4 | f4/4 ab4/4 c5/4 f5/4 | ab5/8 f5/4 d5/4 | b4/4 c5/4 d5/8') },
    ],
  };

  // ================================================================ stage6
  // 蝕。イ・フリジアン + 増4度 152BPM。歪んだ刻み、合唱、増4度の弔鐘。B でリードが叫ぶ。
  const s6riff = riff(
    'a2 bb2@1 a2 eb3@1 a2 bb2@1 f2@1 e2@2 | d3@1 eb3@1 a2 a2 f2@1 bb2@1 e2@2 e2@3',
    '0! . 0 0 . 0 0! . 0 0 . 0 1! . 6! .',
    '0! . 0 0 . 0 0! . 0 0 . 0 0! . 0 .',
    '0! . 0 . 0! . 0 . 0! . 1 . 0! . 1 .',
    '0! 0 0 0 0! 0 0 0 0! 0 0 0 0! 0! 0! 0!');
  const s6snBar = '. . . . x! . . . . . . . x! . . .';
  const s6snFill = '. . . . x . . . x x x x x! x! x! x!';
  S.stage6 = {
    bpm: 152, steps: 16, bars: 16,
    tracks: [
      { inst: 'kick', vol: 0.47, seq: 'x! . x x . . x . x! . x x . . x .' },
      { inst: 'taiko', vol: 0.42, seq: 'x! . . . . . . . x! . . . . . . .' },
      { inst: 'snare', vol: 0.7, seq: J(R(s6snBar, 7), s6snFill) },
      { inst: 'hat', vol: 1.6, seq: 'x . x? . x . x? . x . x? . x . x? .' },
      { inst: 'crash', vol: 0.7, seq: M('x/64') },
      { inst: 'dist', vol: 1.5, seq: s6riff },
      { inst: 'bass', vol: 0.6, seq: s6riff },
      { inst: 'choir', vol: 0.34, seq: M(
        'a3+c4+e4/16 bb3+d4+f4/16 a3+c4+e4/16 bb3+eb4+g4/16 a3+c4+e4/16 bb3+d4+f4/16 a3+c4+f4/16 g#3+b3+e4/16 ' +
        'a3+d4+f4/16 bb3+eb4+g4/16 a3+c4+e4/32 a3+c4+f4/16 bb3+d4+f4/16 g#3+b3+e4/32') },
      { inst: 'bell', vol: 1.1, seq: J(M('a4/16 d5?/16 a4/16 eb5?/16 a4/16 d5?/16 c5?/16 e5?/16'), rest(128)) },
      { inst: 'lead', vol: 2.4, seq: J(rest(128), M(
        'd5/6 e5/2 f5/8 | g5/6 f5/2 eb5/8 | e5/8 d5/4 c5/4 | bb4/4 c5/4 a4/8 | ' +
        'a4/4 c5/4 f5/8 | f5/6 eb5/2 d5/8 | e5/4 f5/4 e5/4 d5/4 | g#4/8 b4/4 d5/4')) },
    ],
  };

  // ================================================================ boss
  // ボス戦（共通）。ホ・フリジアン 168BPM。歪んだパワーコードのリフ + 合唱 + リード。
  const bossRiff = riff(
    'e2 e2@2 f2@1 e2 e2 e2@2 g2@1 f2@1 | c2@1 d2@1 e2 e2@2 c2@1 d2@1 f2@1 f2@3',
    '0! . 0 0 . 0 0 . 1! . 0 0 3! . 1 .',
    '0! . 0 0 . 0 0 . 0! . 0 0 . 0 0 .',
    '0! . 0 0 . 0 0 . 6! . 0 0 5! . 3! .',
    '0! . 0 . 0! . 0 . 0! 0 0! 0 0! 0 0! 0');
  const bossSnBar = '. . . . x! . . . . . . . x! . . .';
  const bossSnFill = '. . . . x! . . . x x x x x! x! x! x!';
  S.boss = {
    bpm: 168, steps: 16, bars: 16,
    tracks: [
      { inst: 'kick', vol: 0.45, seq: 'x! . x x . . x . x! . x x . . x .' },
      { inst: 'snare', vol: 0.75, seq: J(R(bossSnBar, 7), bossSnFill) },
      { inst: 'hat', vol: 0.8, seq: 'x . x? . x . x? . x . x? . x . x? .' },
      { inst: 'crash', vol: 0.8, seq: M('x/64') },
      { inst: 'taiko', vol: 0.5, seq: J(rest(128), R(M('x!/8 x/8'), 8)) },
      { inst: 'dist', vol: 1.9, seq: bossRiff },
      { inst: 'bass', vol: 0.65, seq: bossRiff },
      { inst: 'choir', vol: 0.33, seq: J(rest(64), M(
        'e3+b3/32 g3+d4/16 f3+c4/16 ' +
        'c4+e4+g4/16 d4+f4+a4/16 e4+g4+b4/32 c4+e4+g4/16 d4+f4+a4/16 f4+a4+c5/32')) },
      { inst: 'lead', vol: 2.0, seq: J(rest(64), M(
        'b4/6 c5/2 b4/8 | e4/16 | d5/6 c5/2 b4/8 | c5/8 a4/8 | ' +
        'e5/6 d5/2 c5/4 b4/4 | a4/6 b4/2 c5/4 d5/4 | e5/8 f5/4 e5/4 | d5/4 c5/4 b4/8 | ' +
        'g4/4 c5/4 e5/4 g5/4 | f5/6 e5/2 d5/8 | f5/6 e5/2 c5/4 a4/4 | f4/2 e4/2 f4/2 g4/2 a4/2 bb4/2 a4/2 f4/2')) },
    ],
  };

  // ================================================================ lastboss
  // フェムト。ニ短調（和声的）132BPM。2小節の導入（合唱の湧き上がり + 太鼓の連打）の後、
  // A: オルガンの分散和音 / B: オルガン和音 + リードの旋律。合唱と太鼓は全編。
  const lbArp = riff(
    'd3 d3@2 bb2@1 a2@1 d3@2 g2 eb3@1 a2@1',
    '0! 3 7 12 15 12 7 3 0! 3 7 12 15 12 7 3',
    '0! 4 7 12 16 12 7 4 0! 4 7 12 16 12 7 4',
    '15! 12 7 3 7 12 7 3 0! 3 7 12 7 3 0 3');
  const lbTaikoBar = 'x! . . x . . x . x! . . x . . x .';
  const lbTaikoFill = 'x! . . x . . x . x! . x . x! x x! x';
  const lbSnBar = '. . . . x . . . . . . . x . . .';
  const lbSnFill = '. . . . x . . . x? x? x x x x! x! x!';
  S.lastboss = {
    bpm: 132, steps: 16, bars: 18, loopFrom: 2,
    tracks: [
      { inst: 'taiko', vol: 0.5, seq: J(
        M('x?/4 x?/4 x?/4 x?/4 x/2 x/2 x/2 x/2 x/1 x/1 x/1 x/1 x!/1 x!/1 x!/1 x!/1'),
        R(J(R(lbTaikoBar, 7), lbTaikoFill), 2)) },
      { inst: 'snare', vol: 0.7, seq: J(
        M('./16 x?/1 x?/1 x?/1 x?/1 x/1 x/1 x/1 x/1 x/1 x/1 x/1 x/1 x!/1 x!/1 x!/1 x!/1'),
        R(J(R(lbSnBar, 7), lbSnFill), 2)) },
      { inst: 'hat', vol: 2.5, seq: J(rest(32), R('. . x? . . . x? . . . x? . . . x? .', 16)) },
      { inst: 'crash', vol: 1.1, seq: J(rest(32), M('x/128 x/128')) },
      { inst: 'bell', vol: 0.9, seq: J(M('d4/16 d4/16'), M('d4/32 bb3/32 d4/32 g4/32 g4/32 eb4/32 d4/32 f4/32')) },
      { inst: 'bass', vol: 0.9, seq: J(rest(32), riff(
        'd2 d2 bb1 a1 d2 g2 eb2 a1 | g2 d2 eb2 bb1 g2 a1 bb1 a1@1',
        '0! . 0 . 12 . 0 . 0! . 0 . 12 . 0 .',
        '0! 0 0 0 0! 0 0 0 0! 0 0 0 0! 0 0 0')) },
      { inst: 'organ', vol: 1.5, seq: J(
        M('d2+a2+d3/16 a1+e2+a2/16'),
        lbArp,
        H('g3+bb3+d4/16 f3+a3+d4/16 g3+bb3+eb4/16 f3+bb3+d4/16 g3+bb3+d4/16 e3+a3+c#4/16 f3+bb3+d4/16 e3+a3+c#4/16', 8)) },
      { inst: 'choir', vol: 0.34, seq: J(
        M('d3+a3+d4/32'),
        M('d4+f4+a4/32 d4+f4+bb4/16 c#4+e4+a4/16 d4+f4+a4/16 d4+g4+bb4/16 eb4+g4+bb4/16 c#4+e4+a4/16 ' +
          // B はオルガンが和音を持つので合唱は2声に減らす（同時発音数の節約）
          'd4+bb4/16 d4+a4/16 eb4+bb4/16 d4+bb4/16 d4+bb4/16 c#4+a4/16 d4+bb4/16 c#4+a4/16')) },
      { inst: 'lead', vol: 2.5, seq: J(rest(32 + 128), M(
        'd5/8 bb4/4 g4/4 | a4/6 bb4/2 a4/4 f4/4 | g4/8 bb4/4 eb5/4 | d5/8 f5/8 | ' +
        'g5/6 f5/2 d5/4 bb4/4 | c#5/8 e5/4 a4/4 | d5/6 c5/2 bb4/4 d5/4 | e5/8 c#5/8')) },
    ],
  };

  // ================================================================ clear
  // ステージクリア。ハ短調 → ♭VI → ♭VII → ハ長調で終止（約5秒）。
  S.clear = {
    bpm: 104, steps: 16, bars: 2, once: true,
    tracks: [
      { inst: 'lead', vol: 2.6, seq: M('c5/2 eb5/2 g5/4 ab5/4 bb5/4 | c6/16') },
      { inst: 'strings', vol: 1.1, seq: M('c4+eb4+g4/8 c4+eb4+ab4/4 d4+f4+bb4/4 | c4+e4+g4+c5/16') },
      { inst: 'choir', vol: 0.38, seq: M('./16 c4+e4+g4/16') },
      { inst: 'bass', vol: 0.7, seq: M('c3/8 ab2/4 bb2/4 | c2+c3/16') },
      { inst: 'taiko', vol: 0.56, seq: M('x!/2 x/2 x/2 x/2 x!/4 x!/4 | x!/16') },
      { inst: 'snare', vol: 1.0, seq: M('./8 x?/1 x?/1 x/1 x/1 x/1 x/1 x!/1 x!/1 | ./16') },
      { inst: 'crash', vol: 0.7, seq: M('./16 x/16') },
      { inst: 'bell', vol: 1.3, seq: M('./16 c5/16') },
    ],
  };

  // ================================================================ gameover
  // イ短調の短い葬送（約6秒）。
  S.gameover = {
    bpm: 76, steps: 16, bars: 2, once: true,
    tracks: [
      { inst: 'organ', vol: 1.1, seq: M('a3+c4+e4/8 f3+a3+d4/8 | e3+g#3+b3/8 a2+e3+a3/8') },
      { inst: 'choir', vol: 0.42, seq: M('a3+e4/8 a3+d4/8 | g#3+e4/8 a3+e4/8') },
      { inst: 'strings', vol: 2.4, seq: M('e5/4 d5/4 c5/4 a4/4 | g#4/8 a4/8') },
      { inst: 'bell', vol: 1.3, seq: M('a3/16 e4/16') },
      { inst: 'taiko', vol: 0.6, seq: M('x!/8 x?/8 | x/8 x!/8') },
      { inst: 'bass', vol: 0.6, seq: M('a2/8 d2/8 | e2/8 a1/8') },
    ],
  };

  // ================================================================ ending
  // エンディング。イ短調 12/8 63BPM（1小節 約3.8秒 × 16）。リュートの分散和音と弦。
  // B で合唱の柔らかな和音と鐘が加わる。太鼓は使わない。
  S.ending = {
    bpm: 63, steps: 12, bars: 16,
    tracks: [
      { inst: 'pluck', vol: 0.78, seq: riff(
        'a2 f2@1 c3@1 g2@1 a2 f2@1 d3 e2@1 | f2@1 g2@1 e2 a2 d3 g2@1 c3@1 e2@2',
        '0! 7 12 15 12 7 0? 7 12 15 19 15',
        '0! 7 12 16 12 7 0? 7 12 16 19 16',
        '0! 7 12 17 12 7 0? 7 12 16 19 16') },
      { inst: 'bass', vol: 0.45, seq: M(
        'a2/12 f2/12 c3/12 g2/12 a2/12 f2/12 d2/12 e2/12 f2/12 g2/12 e2/12 a2/12 d2/12 g2/12 c3/12 e2/12') },
      { inst: 'strings', vol: 2.7, seq: M(
        'e5/6 d5/3 c5/3 | c5/9 a4/3 | g4/6 c5/3 e5/3 | d5/12 | e5/6 f5/3 e5/3 | c5/6 a4/6 | f5/6 e5/3 d5/3 | b4/6 g#4/6 | ' +
        'a4/6 c5/3 f5/3 | e5/6 d5/6 | b4/9 g4/3 | a4/6 c5/3 e5/3 | f5/9 e5/3 | d5/6 b4/3 d5/3 | e5/6 d5/3 c5/3 | b4/12') },
      { inst: 'choir', vol: 0.45, seq: J(rest(96), M(
        'f3+a3+c4/12 g3+b3+d4/12 e3+g3+b3/12 e3+a3+c4/12 f3+a3+d4/12 g3+b3+d4/12 e3+g3+c4/12 e3+g#3+b3/12')) },
      { inst: 'bell', vol: 1.0, seq: J(rest(96), M('c6/24 b5/24 a5/24 g5/24')) },
    ],
  };
})(window.BK);

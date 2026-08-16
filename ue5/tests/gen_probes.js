/* =============================================================================
   ue5/tests/gen_probes.js — 同値検証用の問い（プローブ）を決定的に生成する。

   ここで作った同じ問いを、Web版(game.js)とUE5コア(C++)の両方に投げ、
   答えが一致するかを実測する。乱数は自前のxorshift32で、C++側と同じ数列。
   ========================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');

let s = 0x1234567;
function u32() { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s; }
function rnd() { return (u32() & 0x00ffffff) / 16777216; }
function rng(a, b) { return a + (b - a) * rnd(); }

const probes = [];

/* 1) 射線：アリーナ全域から全方向へ。遮蔽が弾を止めるかの核心。 */
for (let i = 0; i < 400; i++) {
  const ox = rng(-19, 19), oz = rng(-19, 19), oy = rng(0.15, 2.6);
  const th = rng(0, Math.PI * 2), ph = rng(-0.5, 0.5);
  const cp = Math.cos(ph);
  probes.push({
    k: 'ray',
    ox: ox, oy: oy, oz: oz,
    dx: Math.cos(th) * cp, dy: Math.sin(ph), dz: Math.sin(th) * cp,
    maxT: 60
  });
}
/* 2) 遮蔽の面すれすれを狙う射線（境界条件） */
for (let i = 0; i < 200; i++) {
  const ox = rng(-16, 16), oz = rng(-16, 16);
  const tx = rng(-16, 16), tz = rng(-16, 16);
  const oy = rng(0.9, 1.4), ty = rng(0.9, 1.4);
  const dx = tx - ox, dy = ty - oy, dz = tz - oz;
  const d = Math.hypot(dx, dy, dz) || 1;
  probes.push({ k: 'ray', ox, oy, oz, dx: dx / d, dy: dy / d, dz: dz / d, maxT: d });
}
/* 3) 押し出し：遮蔽にめり込んだ状態からの復帰 */
for (let i = 0; i < 300; i++) {
  probes.push({ k: 'circle', x: rng(-20.5, 20.5), z: rng(-20.5, 20.5), r: 0.40 });
}
/* 4) 遮蔽の吸着：どの面のどの位置に付くか */
for (let i = 0; i < 300; i++) {
  probes.push({ k: 'cover', x: rng(-18, 18), z: rng(-18, 18), d: 1.20 });
}

const out = path.resolve(__dirname, 'probes.json');
fs.writeFileSync(out, JSON.stringify(probes));
console.log('probes: ' + probes.length + ' -> ' + path.relative(path.resolve(__dirname, '..', '..'), out));

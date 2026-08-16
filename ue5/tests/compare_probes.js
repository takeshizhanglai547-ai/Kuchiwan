/* =============================================================================
   ue5/tests/compare_probes.js
   Web版とUE5コアの答えを突き合わせる。ここが「同じゲームである」ことの唯一の根拠。

   許容差について
     Web版は倍精度(JSのNumber)、UE5コアは単精度(float)で計算している。
     したがって完全一致は原理的にあり得ない。距離の相対誤差 1e-4 を上限とする。
     位置は 1mm (0.001m)。これはプレイヤー半径0.40mの400分の1で、
     どの判定にも影響しない大きさ。
     「遮蔽のどの面に付くか」は離散値なので、こちらは完全一致を要求する。
   ========================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');

const D = __dirname;
const probes = JSON.parse(fs.readFileSync(path.join(D, 'probes.json'), 'utf8'));
const web = JSON.parse(fs.readFileSync(path.join(D, 'web_answers.json'), 'utf8'));
const core = JSON.parse(fs.readFileSync(path.join(D, 'core_answers.json'), 'utf8'));

const REL = 1e-4;      // 距離の相対誤差
const ABS = 1e-3;      // 位置の絶対誤差(m)
const T_ABS = 2e-3;    // 面上の媒介変数t

let checked = 0, bad = 0;
const worst = { ray: 0, circle: 0, t: 0 };
const fails = [];

function fail(i, msg) {
  bad++;
  if (fails.length < 12) fails.push('#' + i + ' [' + probes[i].k + '] ' + msg);
}

if (web.length !== core.length || web.length !== probes.length) {
  console.error('回答数が違う: probes=' + probes.length +
    ' web=' + web.length + ' core=' + core.length);
  process.exit(1);
}

for (let i = 0; i < probes.length; i++) {
  const q = probes[i], a = web[i], b = core[i];
  checked++;

  if (q.k === 'ray') {
    // null = 何にも当たらなかった（maxTまで素通り）
    if ((a === null) !== (b === null)) { fail(i, '当否が違う web=' + a + ' core=' + b); continue; }
    if (a === null) continue;
    const e = Math.abs(a - b) / Math.max(1, Math.abs(a));
    if (e > worst.ray) worst.ray = e;
    if (e > REL) fail(i, '距離 web=' + a.toFixed(5) + ' core=' + b.toFixed(5) + ' 相対誤差=' + e.toExponential(2));

  } else if (q.k === 'circle') {
    const e = Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]));
    if (e > worst.circle) worst.circle = e;
    if (e > ABS) fail(i, '押し出し先 web=(' + a[0].toFixed(4) + ',' + a[1].toFixed(4) +
      ') core=(' + b[0].toFixed(4) + ',' + b[1].toFixed(4) + ') 差=' + e.toExponential(2));

  } else if (q.k === 'cover') {
    if ((a === null) !== (b === null)) {
      fail(i, '遮蔽の有無が違う web=' + JSON.stringify(a) + ' core=' + JSON.stringify(b));
      continue;
    }
    if (a === null) continue;
    if (a[0] !== b[0]) { fail(i, '付く面が違う web=面' + a[0] + ' core=面' + b[0]); continue; }
    const e = Math.abs(a[1] - b[1]);
    if (e > worst.t) worst.t = e;
    if (e > T_ABS) fail(i, '面上の位置 web=' + a[1].toFixed(5) + ' core=' + b[1].toFixed(5));
  }
}

/* 形そのものも比べる。箱と面の数が違えば、そもそも同じ地形ではない。 */
const shape = JSON.parse(fs.readFileSync(path.join(D, 'web_shape.json'), 'utf8'));
const coreShape = JSON.parse(fs.readFileSync(path.join(D, 'core_shape.json'), 'utf8'));
let shapeOk = true;
if (shape.boxes.length !== coreShape.boxes.length || shape.faces.length !== coreShape.faces.length) {
  shapeOk = false;
  console.log('  NG  地形の要素数が違う  web boxes=' + shape.boxes.length + ' faces=' + shape.faces.length +
    ' / core boxes=' + coreShape.boxes.length + ' faces=' + coreShape.faces.length);
} else {
  let e = 0;
  for (let i = 0; i < shape.boxes.length; i++)
    for (let j = 0; j < 6; j++) e = Math.max(e, Math.abs(shape.boxes[i][j] - coreShape.boxes[i][j]));
  for (let i = 0; i < shape.faces.length; i++)
    for (let j = 0; j < 8; j++) e = Math.max(e, Math.abs(shape.faces[i][j] - coreShape.faces[i][j]));
  if (e > ABS) { shapeOk = false; console.log('  NG  地形の数値が違う 最大差=' + e.toExponential(2)); }
  else console.log('  OK  地形が一致  boxes=' + shape.boxes.length + ' faces=' + shape.faces.length +
    ' 最大差=' + e.toExponential(2));
}

console.log('  ' + (bad === 0 ? 'OK' : 'NG') + '  問い' + checked + '件を照合  不一致=' + bad);
console.log('      最大誤差: 射線(相対)=' + worst.ray.toExponential(2) +
  ' 押し出し=' + worst.circle.toExponential(2) + 'm' +
  ' 面上位置=' + worst.t.toExponential(2));
if (fails.length) {
  console.log('  不一致の例:');
  fails.forEach(f => console.log('    ' + f));
}

process.exit(bad === 0 && shapeOk ? 0 : 1);

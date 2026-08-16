/* =============================================================================
   ue5/tools/gen_config.js
   Web版 (ashline/game.js) の確定値から UE5 版のコンフィグヘッダを機械生成する。

   なぜ生成するのか
     数値を手で写すと必ずズレる。ズレた瞬間に「同じゲームの別プラットフォーム版」
     ではなく「似ているが手触りの違う別物」になる。Web版は112項目の実行検証で
     手触りが固定されているので、そこを唯一の真実とし、UE5版は그것を読むだけにする。

   使い方:  node ue5/tools/gen_config.js
   出力  :  ue5/AshlineUE/Source/AshlineCore/Public/AshlineConfig.generated.h
   ========================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const SRC = path.join(ROOT, 'ashline', 'game.js');
const OUT = path.join(ROOT, 'ue5', 'AshlineUE', 'Source', 'AshlineCore', 'Public', 'AshlineConfig.generated.h');

const src = fs.readFileSync(SRC, 'utf8');

/* ---- `var NAME = <literal>;` を、括弧の対応を数えて丸ごと取り出す -------- */
function grab(name) {
  const m = new RegExp('(?:^|\\n)var\\s+' + name + '\\s*=\\s*').exec(src);
  if (!m) throw new Error('見つからない: ' + name);
  let i = m.index + m[0].length;
  const open = src[i];
  if (open !== '{' && open !== '[') {
    // 数値・文字列などの単純値
    const end = src.indexOf(';', i);
    return src.slice(i, end);
  }
  const close = open === '{' ? '}' : ']';
  let depth = 0, inStr = null, inLine = false, inBlock = false;
  for (let j = i; j < src.length; j++) {
    const c = src[j], n = src[j + 1];
    if (inLine) { if (c === '\n') inLine = false; continue; }
    if (inBlock) { if (c === '*' && n === '/') { inBlock = false; j++; } continue; }
    if (inStr) { if (c === '\\') { j++; continue; } if (c === inStr) inStr = null; continue; }
    if (c === '/' && n === '/') { inLine = true; j++; continue; }
    if (c === '/' && n === '*') { inBlock = true; j++; continue; }
    if (c === '"' || c === "'") { inStr = c; continue; }
    if (c === open) depth++;
    else if (c === close) { depth--; if (depth === 0) return src.slice(i, j + 1); }
  }
  throw new Error('括弧が閉じない: ' + name);
}

const DEG = Math.PI / 180;
function ev(name) {
  // eslint-disable-next-line no-eval
  return eval('(function(DEG){ return ' + grab(name) + '; })(' + DEG + ')');
}

const CFG = ev('CFG');
const COVERS = ev('COVERS');
const ARENA = ev('ARENA');
const SPAWN = ev('SPAWN');
const ETYPE = ev('ETYPE');
const WAVES = ev('WAVES');
const MAX_ENEMIES = Number(ev('MAX_ENEMIES'));

/* ---- C++ の書き出し ----------------------------------------------------- */
function f(v) {
  if (typeof v !== 'number') throw new Error('数値でない: ' + v);
  if (Number.isInteger(v)) return v.toFixed(1) + 'f';
  return v.toPrecision(12).replace(/0+$/, '').replace(/\.$/, '.0') + 'f';
}
const L = [];
function w(s) { L.push(s); }

w('/* ==========================================================================');
w('   AshlineConfig.generated.h — 自動生成。手で編集しないこと。');
w('   生成元: ashline/game.js   生成器: ue5/tools/gen_config.js');
w('');
w('   単位系: メートル / Y-up / three-style yaw');
w('     yaw y に対する前方向は (-sin y, 0, -cos y)。');
w('     Unreal (cm / Z-up / 左手系) への変換は AshlineBridge が一手に引き受ける。');
w('     コアの内部では絶対に cm を使わない。混ぜた時点で追跡不能になる。');
w('   ========================================================================== */');
w('#pragma once');
w('');
w('namespace Ashline {');
w('namespace Cfg {');
w('');

/* CFG は入れ子の平たい数値オブジェクト。名前空間に落とす。 */
const CFG_ORDER = Object.keys(CFG);
for (const k of CFG_ORDER) {
  const g = CFG[k];
  w('  namespace ' + k + ' {');
  for (const kk of Object.keys(g)) {
    w('    inline constexpr float ' + kk + ' = ' + f(g[kk]) + ';');
  }
  w('  }');
}
w('');

/* アリーナ */
w('  namespace arena {');
w('    inline constexpr float hx = ' + f(ARENA.hx) + ';');
w('    inline constexpr float hz = ' + f(ARENA.hz) + ';');
w('    inline constexpr float wallH = ' + f(ARENA.wallH) + ';');
w('  }');
w('  namespace spawn {');
w('    inline constexpr float x = ' + f(SPAWN.x) + ';');
w('    inline constexpr float z = ' + f(SPAWN.z) + ';');
w('    inline constexpr float yaw = ' + f(SPAWN.yaw) + ';');
w('  }');
w('  inline constexpr int kMaxEnemies = ' + MAX_ENEMIES + ';');
w('');

/* 遮蔽 */
w('  struct CoverDef { float x, z, hx, hz, h; };');
w('  inline constexpr int kCoverCount = ' + COVERS.length + ';');
w('  inline constexpr CoverDef kCovers[kCoverCount] = {');
COVERS.forEach(function (c, i) {
  w('    { ' + [c.x, c.z, c.hx, c.hz, c.h].map(f).join(', ') + ' }' +
    (i + 1 < COVERS.length ? ',' : '') + '   // ' + i);
});
w('  };');
w('');

/* 敵の型 */
const ETK = Object.keys(ETYPE);
w('  enum class EnemyType : int { ' + ETK.map(function (k, i) { return k + ' = ' + i; }).join(', ') +
  ', Count = ' + ETK.length + ' };');
w('  struct EnemyDef {');
w('    float hp, speed, keep, fireRange, dmg, rpm, spread, tell, scale;');
w('    int burst;');
w('  };');
w('  inline constexpr EnemyDef kEnemyDefs[(int)EnemyType::Count] = {');
ETK.forEach(function (k, i) {
  const e = ETYPE[k];
  w('    { ' + [e.hp, e.speed, e.keep, e.fireRange, e.dmg, e.rpm, e.spread, e.tell,
    (e.scale === undefined ? 1 : e.scale)].map(f).join(', ') +
    ', ' + e.burst + ' }' + (i + 1 < ETK.length ? ',' : '') + '   // ' + k);
});
w('  };');
w('  inline constexpr const char* kEnemyNames[(int)EnemyType::Count] = { ' +
  ETK.map(function (k) { return '"' + k + '"'; }).join(', ') + ' };');
w('');

/* 波 */
w('  struct SpawnDef { EnemyType type; float x, z; };');
w('  struct WaveDef { int count; SpawnDef slots[' + Math.max.apply(null, WAVES.map(function (w2) { return w2.length; })) + ']; };');
w('  inline constexpr int kWaveCount = ' + WAVES.length + ';');
w('  inline constexpr WaveDef kWaves[kWaveCount] = {');
WAVES.forEach(function (wv, i) {
  const slots = wv.map(function (s) {
    return '{ EnemyType::' + s.t + ', ' + f(s.x) + ', ' + f(s.z) + ' }';
  }).join(', ');
  w('    { ' + wv.length + ', { ' + slots + ' } }' + (i + 1 < WAVES.length ? ',' : ''));
});
w('  };');
w('');
w('} // namespace Cfg');
w('} // namespace Ashline');
w('');

const text = L.join('\n');
fs.mkdirSync(path.dirname(OUT), { recursive: true });
const prev = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : null;
fs.writeFileSync(OUT, text);

const changed = prev !== text;
console.log('generated ' + path.relative(ROOT, OUT) +
  '  (' + COVERS.length + ' covers / ' + ETK.length + ' enemy types / ' +
  WAVES.length + ' waves)' + (changed ? '  [CHANGED]' : '  [unchanged]'));

/* --check: 生成物が最新かどうかだけを見る。CIとテストから使う。 */
if (process.argv.indexOf('--check') >= 0 && changed) {
  console.error('ERROR: AshlineConfig.generated.h が game.js と一致していなかった（再生成した）');
  process.exit(2);
}

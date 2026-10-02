// tests/audio.test.mjs — pure audio data / logic checks (owner: audio designer).
// The DSP itself needs WebAudio (rendered + inspected by tools/audio_sheet.mjs); here we check
// the contracts: every gameplay sound id exists, mix metadata is sane, motor->booster mapping
// behaves, the score's layer tables are complete.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SFX, PRERENDER_ORDER } from '../src/audio/sfx.js';
import { jetTargets, makeJetTargets } from '../src/audio/beds.js';
import { MIX, LAYER_NAMES, LOOP, BPM, BARS, LAYER_RMS } from '../src/audio/music.js';
import { makeRng, hashStr } from '../src/audio/dsp.js';

// ARCHITECTURE §10 sound ids used by gameplay code
const GAMEPLAY_IDS = ['rifle', 'enemy_gun', 'enemy_laser', 'blade', 'blade_hit', 'missile_launch', 'cannon',
  'explosion_small', 'explosion_large', 'hit_confirm', 'damage_taken', 'stagger', 'qb', 'jump', 'land', 'ab_start',
  'en_depleted', 'repair', 'lock', 'lock_switch', 'objective', 'objective_tick', 'alarm', 'mission_complete',
  'mission_failed', 'ui_select', 'ui_confirm', 'reload'];
const BUSES = new Set(['sfx', 'impact', 'ui', 'stinger', 'voice']);

test('every gameplay sound id has a recipe', () => {
  for (const id of GAMEPLAY_IDS) assert.ok(SFX[id], `missing SFX.${id}`);
});

test('sfx metadata is sane', () => {
  for (const [id, d] of Object.entries(SFX)) {
    assert.equal(typeof d.render, 'function', id);
    assert.ok(BUSES.has(d.bus), `${id} bus ${d.bus}`);
    assert.ok(d.dur > 0 && d.dur <= 6, `${id} dur`);
    assert.ok(d.gain > 0 && d.gain <= 1, `${id} gain`);
    assert.ok(d.prio >= 0 && d.prio <= 10, `${id} prio`);
    assert.ok((d.variants || 1) >= 1 && (d.variants || 1) <= 6, `${id} variants`);
    if (d.duck) assert.ok(d.duck[0] > 0 && d.duck[0] < 1 && d.duck[1] >= 0 && d.duck[2] > 0, `${id} duck`);
    // UI / alert sounds are never spatial (always audible, centred)
    if (d.bus === 'ui' || d.bus === 'stinger') assert.equal(d.spatial, false, `${id} should be non-spatial`);
  }
  // rapid-fire weapons must vary per play (benchmark instant tell: identical repeated sample)
  for (const id of ['rifle', 'enemy_gun', 'missile_launch', 'footstep', 'explosion_small']) {
    assert.ok(SFX[id].variants >= 3 && SFX[id].pv >= 40 && SFX[id].vv > 0, `${id} variance`);
  }
});

test('pre-render order covers every id exactly once', () => {
  assert.equal(new Set(PRERENDER_ORDER).size, PRERENDER_ORDER.length);
  for (const id of Object.keys(SFX)) assert.ok(PRERENDER_ORDER.includes(id), id);
});

test('booster bed follows the motor', () => {
  const x = makeJetTargets();
  const m = { mode: 'idle', speedH: 0, vy: 0, abCharging: false, abCharge: 0, skid: 0 };
  jetTargets(m, x); assert.equal(x.roar, 0);
  m.mode = 'boost'; m.speedH = 30; jetTargets(m, x); const slow = { ...x };
  m.speedH = 85; jetTargets(m, x);
  assert.ok(x.turbF > slow.turbF && x.roarCut > slow.roarCut && x.roar > slow.roar, 'pitch/filter/level rise with speed');
  m.mode = 'ab'; m.speedH = 130; jetTargets(m, x);
  assert.ok(x.roar > slow.roar && x.rumble > 0, 'AB louder with flutter');
  m.abCharging = true; m.abCharge = 0.1; jetTargets(m, x); const c0 = x.turbF;
  m.abCharge = 1; jetTargets(m, x); assert.ok(x.turbF > c0, 'AB wind-up spools up');
  m.mode = 'qb'; m.abCharging = false; jetTargets(m, x); assert.ok(x.roar >= 0.8, 'QB is the loudest burst');
});

test('adaptive score tables are complete and escalate', () => {
  assert.ok(Math.abs(LOOP - BARS * 4 * 60 / BPM) < 1e-9);
  for (const [name, mix] of Object.entries(MIX)) for (const l of LAYER_NAMES) assert.ok(mix[l] !== undefined, `${name}.${l}`);
  for (const l of LAYER_NAMES) assert.ok(LAYER_RMS[l] < -10, l);
  const sum = (s) => LAYER_NAMES.reduce((a, l) => a + MIX[s][l], 0);
  assert.ok(sum('title') < sum('explore') && sum('explore') < sum('combat') && sum('combat') < sum('combat2') && sum('combat2') < sum('boss'));
  assert.equal(MIX.boss.boss, 1); assert.equal(MIX.combat.boss, 0);
});

test('rng is deterministic and seed-sensitive', () => {
  const a = makeRng(hashStr('rifle')), b = makeRng(hashStr('rifle')), c = makeRng(hashStr('cannon'));
  const sa = [a(), a(), a()], sb = [b(), b(), b()], sc = [c(), c(), c()];
  assert.deepEqual(sa, sb); assert.notDeepEqual(sa, sc);
  for (const v of sa) assert.ok(v >= 0 && v < 1);
});

// ---- handler LEDGER voice-over (assets/audio/build_vo.py)
test('every LEDGER radio line has a recorded voice-over in the manifest', async () => {
  const { VO_TABLE } = await import('../src/audio/vo_table.js');
  const { RADIO } = await import('../src/ui/radio.js');
  const { MANIFEST } = await import('../src/manifest.js');
  const fs = await import('node:fs');
  const path = await import('node:path');
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
  assert.ok(VO_TABLE.brief, 'briefing VO missing');
  for (const key of Object.keys(RADIO)) assert.ok(VO_TABLE[key], `no VO for radio line "${key}" (run python3 assets/audio/build_vo.py)`);
  for (const [key, v] of Object.entries(VO_TABLE)) {
    const m = MANIFEST[`sfx_${v.id}`];
    assert.ok(m, `manifest lacks sfx_${v.id}`);
    assert.ok(fs.existsSync(path.join(root, m.url)), `missing ${m.url}`);
    assert.ok(v.dur > 0.5 && v.dur < 40, `${key}: duration ${v.dur}`);
    // edited subtitle text -> audio.js plays the most similar recording; flag it, do not fail
    if (RADIO[key] && RADIO[key].en !== v.en) console.warn(`[vo] "${key}" subtitle changed since the VO build; re-run assets/audio/build_vo.py`);
  }
});

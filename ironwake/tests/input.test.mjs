// tests/input.test.mjs — action sampling edge cases (src/core/input.js), QA r1 regressions:
// presses made while the menus are up never fire on resume; buttons held through the resume
// give no rising edge; the gamepad navigates menus (d-pad, stick edge, B = back).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Input } from '../src/core/input.js';

function bus() {
  const log = [];
  return { log, emit(name, e) { log.push({ name, ...e }); } };
}
const key = (inp, code, down) => inp._onKey({ code, repeat: false, preventDefault() {} }, down);

test('keys pressed while input is disabled (pause menu) are dropped on resume', () => {
  const ev = bus(), inp = new Input(ev);
  inp.enabled = false;
  for (const c of ['KeyQ', 'Space', 'KeyR']) { key(inp, c, true); key(inp, c, false); }
  assert.ok(ev.log.some((e) => e.action === 'fire_lb'), 'menus still receive input:action');
  inp.enabled = true; inp.resume();
  inp.beginStep();
  for (const a of ['fire_lb', 'jump', 'repair']) assert.equal(inp.pressed(a), false, a);
  inp.endStep();
  // a fresh press after the resume still works (tap shorter than a step is latched)
  key(inp, 'KeyQ', true); key(inp, 'KeyQ', false);
  inp.beginStep();
  assert.equal(inp.pressed('fire_lb'), true);
});

test('a button held through the resume is "held", not a new press', () => {
  const inp = new Input(bus());
  inp.enabled = false;
  key(inp, 'Space', true);           // still down when play resumes
  inp.enabled = true; inp.resume();
  inp.beginStep();
  assert.equal(inp.down('jump'), true);
  assert.equal(inp.pressed('jump'), false);
  inp.endStep();
  key(inp, 'Space', false); inp.beginStep(); inp.endStep();
  key(inp, 'Space', true); inp.beginStep();
  assert.equal(inp.pressed('jump'), true, 'next real press is an edge again');
});

test('gamepad navigates menus while input is disabled; stick must recentre after play', () => {
  const ev = bus(), inp = new Input(ev);
  const pad = { connected: true, axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) };
  const had = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { value: { getGamepads: () => [pad] }, configurable: true, writable: true });
  try {
    const actions = () => ev.log.filter((e) => e.source === 'gamepad').map((e) => e.action);
    const tap = (b) => { pad.buttons[b] = { pressed: true, value: 1 }; inp.pollGamepad(); pad.buttons[b] = { pressed: false, value: 0 }; inp.pollGamepad(); };
    inp.enabled = false;
    inp.pollGamepad();
    tap(13); tap(12); tap(15); tap(1);
    assert.deepEqual(actions(), ['look_down', 'look_up', 'look_right', 'quick_boost', 'pause']);
    ev.log.length = 0;
    pad.axes[1] = 1; inp.pollGamepad(); inp.pollGamepad();   // one step per push
    pad.axes[1] = 0; inp.pollGamepad();
    pad.axes[1] = 1; inp.pollGamepad();
    assert.deepEqual(actions(), ['look_down', 'look_down']);
    // in play the d-pad / stick emit nothing for the menus
    ev.log.length = 0; inp.enabled = true;
    tap(13); pad.axes[1] = -1; inp.pollGamepad();
    assert.deepEqual(actions(), []);
    // pause while the stick is still pushed: no menu step until it returns to centre
    inp.enabled = false; inp.pollGamepad(); inp.pollGamepad();
    assert.deepEqual(actions(), []);
    pad.axes[1] = 0; inp.pollGamepad(); pad.axes[1] = -1; inp.pollGamepad();
    assert.deepEqual(actions(), ['look_up']);
  } finally {
    if (had) Object.defineProperty(globalThis, 'navigator', had); else delete globalThis.navigator;
  }
});

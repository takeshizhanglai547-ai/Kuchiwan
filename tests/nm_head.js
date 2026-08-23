const fs = require('fs');
// 対象ファイルは NM_TARGET で渡す（runall.sh が設定する）。
// スイートは mktemp の一時ファイルへ連結して実行するので __dirname は当てにならない。
// 単体で走らせるときのために、カレントからの相対も見る
const html = fs.readFileSync(process.env.NM_TARGET || require('path').resolve('beltaction.html'), 'utf8');
let code = html.match(/<script>([\s\S]*)<\/script>/)[1];
code = code.replace('"use strict";', '');
// ステージの仕掛けは乱数で湧くので、検証中は既定で止める。
// 仕掛けそのものを見るスイート（terr）は driver 側で gimOn=true に戻す
code = code + "\n;gimOn=false;";

function absorber() {
  const fn = function () { return proxy; };
  const proxy = new Proxy(fn, {
    get(t, k) { if (k === Symbol.toPrimitive) return () => 0; if (k === 'width') return 10; return proxy; },
    set() { return true; }, apply() { return proxy; }, construct() { return proxy; },
  });
  return proxy;
}
const uni = absorber();
global.document = { getElementById: () => uni, createElement: () => uni };
global.navigator = { maxTouchPoints: 0 };
global.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
global.rafCb = null;
global.requestAnimationFrame = (cb) => { global.rafCb = cb; };
global.addEventListener = () => {};
const param = { value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, cancelScheduledValues() {} };
const mkNode = () => ({ connect() {}, start() {}, stop() {}, gain: { ...param }, frequency: { ...param }, Q: { ...param }, threshold: { ...param }, knee: { ...param }, ratio: { ...param }, attack: { ...param }, release: { ...param }, delayTime: { ...param }, type: '', buffer: null });
function AudioContextStub() {
  return { currentTime: 0, state: 'running', sampleRate: 44100, resume() { return Promise.resolve(); },
    destination: mkNode(), createGain: mkNode, createOscillator: mkNode, createBiquadFilter: mkNode,
    createBufferSource: mkNode, createDynamicsCompressor: mkNode, createDelay: mkNode,
    createBuffer: () => ({ getChannelData: () => new Float32Array(64) }) };
}
global.window = new Proxy(global, { get(t, k) {
  if (k === 'AudioContext') return AudioContextStub;
  if (k === 'devicePixelRatio') return 1;
  if (k === 'innerWidth') return 1280;
  if (k === 'innerHeight') return 720;
  return t[k];
}, has() { return false; } });

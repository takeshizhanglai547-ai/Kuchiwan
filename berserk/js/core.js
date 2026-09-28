'use strict';
/* =====================================================================
 *  BERSERK 黒い剣士 ─蝕の夜─   core.js
 *  名前空間 / 定数 / ユーティリティ / 画面スケーリング / 入力 / エフェクト /
 *  シーン管理 / メインループ
 *  すべてのファイルは window.BK にぶら下がる（ES Module 不使用 → file:// でも動く）
 * ===================================================================== */
window.BK = window.BK || {};
(function (BK) {
  // ---------------------------------------------------------------- utils
  const U = BK.U = {
    clamp: (v, a, b) => (v < a ? a : v > b ? b : v),
    lerp: (a, b, t) => a + (b - a) * t,
    rand: (a, b) => a + Math.random() * (b - a),
    randi: (a, b) => Math.floor(a + Math.random() * (b - a + 1)),
    chance: p => Math.random() < p,
    choose: arr => arr[Math.floor(Math.random() * arr.length)],
    sign: v => (v < 0 ? -1 : 1),
    approach: (v, t, d) => (v < t ? Math.min(v + d, t) : Math.max(v - d, t)),
    DEG: Math.PI / 180,
    ease: {
      linear: t => t,
      in: t => t * t,
      out: t => 1 - (1 - t) * (1 - t),
      inOut: t => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
      back: t => { const c = 1.9; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); },
      snap: t => 1 - Math.pow(1 - t, 4),
    },
    /** 重み付き抽選: [[weight, value], ...] */
    weighted(list) {
      let sum = 0; for (const [w] of list) sum += w;
      let r = Math.random() * sum;
      for (const [w, v] of list) { r -= w; if (r <= 0) return v; }
      return list[list.length - 1][1];
    },
    /** シード付き乱数（背景の手続き生成用。毎回同じ形になる） */
    srand(seed) {
      let s = (seed >>> 0) || 1;
      return function () { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 100000) / 100000; };
    },
    /** 16進色 → rgba 文字列 */
    rgba(hex, a) {
      const h = hex.replace('#', '');
      const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
      return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
    },
    /** 2色を混ぜる (#rrggbb) */
    mix(c1, c2, t) {
      const a = parseInt(c1.slice(1), 16), b = parseInt(c2.slice(1), 16);
      const r = Math.round(U.lerp((a >> 16) & 255, (b >> 16) & 255, t));
      const g = Math.round(U.lerp((a >> 8) & 255, (b >> 8) & 255, t));
      const bl = Math.round(U.lerp(a & 255, b & 255, t));
      return '#' + ((1 << 24) | (r << 16) | (g << 8) | bl).toString(16).slice(1);
    },
  };

  // ------------------------------------------------------------ constants
  BK.H = 360;            // 論理解像度の高さ（固定）
  BK.W = 640;            // 論理解像度の幅（端末のアスペクト比で 560〜800 に可変）
  BK.FLOOR_TOP = 212;    // 奥行き y=0 の足元が描かれる画面 Y
  BK.DEPTH = 118;        // ベルトの奥行き（y は 0〜DEPTH）
  BK.GRAV = 0.55;        // 重力（z 方向）
  BK.FONT_JP = "'Shippori Mincho B1','Hiragino Mincho ProN','Yu Mincho','Noto Serif JP',serif";
  BK.FONT_GOTH = "'UnifrakturMaguntia','Old English Text MT','Times New Roman',serif";
  BK.frame = 0;          // 固定ステップの通し番号

  // 登録テーブル（各ファイルがここへ定義を追加する）
  BK.heroes = BK.heroes || {};        // id -> hero def
  BK.heroOrder = BK.heroOrder || [];  // キャラ選択画面での並び
  BK.enemyTypes = BK.enemyTypes || {};// id -> enemy / boss def
  BK.stages = BK.stages || [];        // index 0..5 -> stage def
  BK.scenes = BK.scenes || {};

  // ---------------------------------------------------------------- canvas
  const cv = document.getElementById('bk-canvas');
  const ctx = cv.getContext('2d', { alpha: false });
  BK.canvas = cv; BK.ctx = ctx;
  BK.renderScale = 1; BK.cssScale = 1;

  // ノッチ等のセーフエリアを除いた幅を測るための要素（キャンバスをセーフエリア内に収める）
  const safeProbe = document.createElement('div');
  safeProbe.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;top:0;bottom:0;left:env(safe-area-inset-left,0px);right:env(safe-area-inset-right,0px)';
  document.body.appendChild(safeProbe);
  function resize() {
    const vw = safeProbe.getBoundingClientRect().width || window.innerWidth, vh = window.innerHeight;
    const aspect = vw / vh;
    BK.W = Math.round(U.clamp(BK.H * aspect, 560, 800));
    const cssScale = Math.min(vw / BK.W, vh / BK.H);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    // バッキングストアが大きすぎるとスマホで重いので幅 1600px 程度に抑える
    const rs = Math.min(cssScale * dpr, 1600 / BK.W, BK.qualityCap || 9);
    cv.style.width = Math.round(BK.W * cssScale) + 'px';
    cv.style.height = Math.round(BK.H * cssScale) + 'px';
    cv.width = Math.round(BK.W * rs);
    cv.height = Math.round(BK.H * rs);
    BK.renderScale = cv.width / BK.W;
    BK.cssScale = cssScale;
    BK.needsRender = true; // バッキングストア再確保で絵が消えるため
    document.documentElement.style.setProperty('--cv-top', Math.max(0, (vh - BK.H * cssScale) / 2) + 'px');
    updateRotateHint();
  }
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => setTimeout(resize, 200));

  // 縦持ちヒント
  let rotateDismissed = false;
  const rotEl = document.getElementById('bk-rotate');
  function updateRotateHint() {
    if (!rotEl) return;
    const portrait = window.innerHeight > window.innerWidth * 1.05;
    const show = !!(BK.input && BK.input.touchMode && portrait && !rotateDismissed);
    if (show && rotEl.hidden && BK.scene && BK.scene.onHide) BK.scene.onHide(); // プレイ中なら自動ポーズ
    rotEl.hidden = !show;
  }
  BK.rotateHintShown = () => !!rotEl && !rotEl.hidden;
  BK.updateRotateHint = updateRotateHint;
  const rotBtn = document.getElementById('bk-rot-dismiss');
  if (rotBtn) rotBtn.addEventListener('click', () => { rotateDismissed = true; updateRotateHint(); });

  // ------------------------------------------------------------ save data
  BK.save = {
    get(key, def) {
      try { const v = window.localStorage.getItem('bk_berserk_' + key); return v == null ? def : JSON.parse(v); }
      catch (e) { return def; }
    },
    set(key, val) {
      try { window.localStorage.setItem('bk_berserk_' + key, JSON.stringify(val)); } catch (e) { /* storage unavailable */ }
    },
  };

  // ------------------------------------------------------------------ input
  const BTNS = ['atk', 'jmp', 'sht', 'sp', 'awk', 'start', 'pause', 'up', 'down', 'left', 'right'];
  const I = BK.input = {
    src: { kb: {}, touch: {}, pad: {} },
    held: {}, pressed: {}, released: {},
    _pc: {}, _rc: {},
    ax: 0, ay: 0,          // タッチ / パッドのアナログ値 (-1..1)
    dirX: 0, dirY: 0,      // 8方向に量子化した方向
    prevDirX: 0, prevDirY: 0,
    heldFrames: {},        // ボタンを押し続けているフレーム数
    dashTap: 0,            // このフレームでダッシュ入力（→→ / ←←）が成立したら ±1
    duFrame: -999,         // ↓↑ コマンドが成立したフレーム
    stickFull: 0,          // スティックを端まで倒し続けたフレーム数（オートダッシュ用）
    touchMode: false,
    tap: null,             // メニュー用: 論理座標でのタップ {x,y}
    anyKey: false,
    _xRel: { '1': -999, '-1': -999 }, _xPressAt: { '1': -999, '-1': -999 },
    _downAt: -999,
  };
  for (const b of BTNS) { I.held[b] = false; I.pressed[b] = false; I.released[b] = false; I._pc[b] = 0; I._rc[b] = 0; I.heldFrames[b] = 0; }

  I.press = function (src, b) {
    if (!I.src[src][b]) { I.src[src][b] = true; I._pc[b]++; I.anyKey = true; }
  };
  I.release = function (src, b) {
    if (I.src[src][b]) { I.src[src][b] = false; I._rc[b]++; }
  };
  I.releaseAll = function (src) { for (const b of BTNS) I.release(src, b); if (src !== 'kb') { I.ax = 0; I.ay = 0; } };

  /** 固定ステップの頭で1回呼ぶ */
  I.step = function () {
    pollGamepad();
    for (const b of BTNS) {
      const h = !!(I.src.kb[b] || I.src.touch[b] || I.src.pad[b]);
      I.pressed[b] = I._pc[b] > 0;
      I.released[b] = I._rc[b] > 0 && !h;
      I.held[b] = h || I.pressed[b];  // 1フレーム未満の短いタップも「押された」扱いにする
      I._pc[b] = 0; I._rc[b] = 0;
      I.heldFrames[b] = I.held[b] ? I.heldFrames[b] + 1 : 0;
    }
    // 方向（デジタル入力 + アナログ）
    let dx = (I.held.right ? 1 : 0) - (I.held.left ? 1 : 0);
    let dy = (I.held.down ? 1 : 0) - (I.held.up ? 1 : 0);
    const mag = Math.hypot(I.ax, I.ay);
    if (mag > 0.3) {
      // ヒステリシス: 倒している方向は少し戻しただけでは解除しない（指の震えで誤ダッシュしない）
      const hx = I.dirX !== 0 && Math.sign(I.ax) === I.dirX ? 0.24 : 0.38;
      const hy = I.dirY !== 0 && Math.sign(I.ay) === I.dirY ? 0.28 : 0.42;
      dx = Math.abs(I.ax) > hx ? Math.sign(I.ax) : 0;
      dy = Math.abs(I.ay) > hy ? Math.sign(I.ay) : 0;
    }
    I.prevDirX = I.dirX; I.prevDirY = I.dirY;
    I.dirX = dx; I.dirY = dy;
    const f = BK.frame;
    // ダッシュ（同方向2連打）
    I.dashTap = 0;
    if (I.prevDirX !== 0 && I.dirX !== I.prevDirX) I._xRel[I.prevDirX] = f;
    if (I.dirX !== 0 && I.prevDirX !== I.dirX) {
      if (f - I._xRel[I.dirX] <= 14 && f - I._xPressAt[I.dirX] <= 26) I.dashTap = I.dirX;
      I._xPressAt[I.dirX] = f;
    }
    if (!I.dashTap && I._dashCarry) I.dashTap = I._dashCarry;
    I._dashCarry = 0;
    // オートダッシュ用: スティックを横に倒し切っている時間
    const full = (mag > 0.88 && Math.abs(I.ax) > 0.8) || (I.src.kb.run && dx !== 0);
    I.stickFull = full ? I.stickFull + 1 : 0;
    // ↓↑ コマンド
    if (I.dirY === 1) I._downAt = f;
    if (I.dirY === -1 && I.prevDirY !== -1 && f - I._downAt <= 18) I.duFrame = f;
  };
  I.consumeTap = function () { const t = I.tap; I.tap = null; return t; };
  /** ヒットストップ等でゲームが止まったフレームの押下を、次のフレームへ持ち越す */
  I.defer = function () {
    for (const b of ['atk', 'jmp', 'sht', 'sp', 'awk']) if (I.pressed[b]) I._pc[b]++;
    if (I.dashTap) I._dashCarry = I.dashTap;
  };
  /** メニューでの決定 (攻撃 / ジャンプ / Enter / タップ) */
  I.confirm = function () { return I.pressed.atk || I.pressed.start || I.pressed.jmp; };

  // keyboard
  const KEYMAP = {
    ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
    ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down',
    KeyZ: 'atk', KeyJ: 'atk', KeyX: 'jmp', KeyK: 'jmp', Space: 'jmp',
    KeyC: 'sht', KeyL: 'sht', KeyV: 'sp', KeyU: 'sp', KeyB: 'awk', KeyI: 'awk',
    Enter: 'start', Escape: 'pause', KeyP: 'pause', ShiftLeft: 'run', ShiftRight: 'run',
  };
  window.addEventListener('keydown', e => {
    const b = KEYMAP[e.code];
    if (e.code === 'KeyM' && !e.repeat) { BK.audio && BK.audio.toggleMute && BK.audio.toggleMute(); }
    if (!b) return;
    e.preventDefault();
    if (b === 'run') { I.src.kb.run = true; return; }
    I.press('kb', b);
    BK.audio && BK.audio.unlock && BK.audio.unlock();
  });
  window.addEventListener('keyup', e => {
    const b = KEYMAP[e.code];
    if (!b) return;
    if (b === 'run') { I.src.kb.run = false; return; }
    I.release('kb', b);
  });
  window.addEventListener('blur', () => { I.releaseAll('kb'); I.releaseAll('touch'); if (BK.scene && BK.scene.onHide) BK.scene.onHide(); });

  // gamepad (standard mapping)
  const PADMAP = { 0: 'jmp', 1: 'sht', 2: 'atk', 3: 'sp', 5: 'awk', 7: 'awk', 9: 'start', 8: 'pause', 12: 'up', 13: 'down', 14: 'left', 15: 'right' };
  let padSeen = false;
  function pollGamepad() {
    if (!navigator.getGamepads) return;
    let pads;
    try { pads = navigator.getGamepads(); } catch (e) { return; }
    const p = pads && Array.from(pads).find(x => x && x.connected);
    if (!p) { if (padSeen) { I.releaseAll('pad'); padSeen = false; } return; }
    padSeen = true;
    for (const k in PADMAP) {
      const bt = p.buttons[k];
      if (!bt) continue;
      if (bt.pressed) I.press('pad', PADMAP[k]); else I.release('pad', PADMAP[k]);
    }
    const x = p.axes[0] || 0, y = p.axes[1] || 0;
    if (Math.hypot(x, y) > 0.3) { I.ax = x; I.ay = y; } else if (!touchStick.id && touchStick.id !== 0) { I.ax = 0; I.ay = 0; }
  }

  // ---------------------------------------------------------- touch input
  const touchEl = document.getElementById('bk-touch');
  const stickEl = document.getElementById('bk-stick');
  const knobEl = document.getElementById('bk-knob');
  const btnEls = touchEl ? Array.from(touchEl.querySelectorAll('.bk-btn')) : [];
  const touchStick = { id: null, ox: 0, oy: 0 };
  const ptrBtn = new Map();     // pointerId -> button name
  const STICK_R = 52;

  function markTouch() {
    if (!I.touchMode) { I.touchMode = true; updateRotateHint(); }
  }
  function btnAt(cx, cy) {
    let best = null, bestD = 1e9;
    for (const el of btnEls) {
      if (el.classList.contains('bk-hide') || el.offsetParent === null) continue;
      const r = el.getBoundingClientRect();
      const mx = r.left + r.width / 2, my = r.top + r.height / 2, rad = r.width / 2;
      const d = Math.hypot(cx - mx, cy - my) / rad;
      if (d < 1.35 && d < bestD) { bestD = d; best = el; }
    }
    return best;
  }
  function setBtnPtr(id, el) {
    const prev = ptrBtn.get(id);
    const name = el ? el.dataset.btn : null;
    if (prev === name) return;
    if (prev) {
      // 他の指が同じボタンを押していなければ離す
      let still = false;
      for (const [pid, n] of ptrBtn) if (pid !== id && n === prev) still = true;
      if (!still) { I.release('touch', prev); const pe = document.querySelector(`.bk-btn[data-btn="${prev}"]`); pe && pe.classList.remove('on'); }
    }
    if (name) {
      ptrBtn.set(id, name);
      I.press('touch', name);
      el.classList.add('on');
      if (navigator.vibrate && BK.save.get('vibe', true)) { try { navigator.vibrate(8); } catch (e) { /* ignore */ } }
    } else ptrBtn.delete(id);
  }
  function updateStick(cx, cy) {
    let dx = cx - touchStick.ox, dy = cy - touchStick.oy;
    const d = Math.hypot(dx, dy);
    // 指が大きく離れたらスティック中心を追従させる（フローティング）
    if (d > STICK_R * 1.6) {
      const k = (d - STICK_R * 1.6) / d;
      touchStick.ox += dx * k; touchStick.oy += dy * k;
      stickEl.style.left = touchStick.ox + 'px'; stickEl.style.top = touchStick.oy + 'px';
      dx = cx - touchStick.ox; dy = cy - touchStick.oy;
    }
    const dd = Math.hypot(dx, dy);
    const cl = Math.min(dd, STICK_R);
    const nx = dd > 0 ? dx / dd : 0, ny = dd > 0 ? dy / dd : 0;
    knobEl.style.transform = `translate(${nx * cl}px, ${ny * cl}px)`;
    const m = Math.min(1, dd / STICK_R);
    I.ax = nx * m; I.ay = ny * m;
  }
  if (touchEl) {
    touchEl.addEventListener('pointerdown', e => {
      e.preventDefault();
      markTouch();
      BK.audio && BK.audio.unlock && BK.audio.unlock();
      try { touchEl.setPointerCapture(e.pointerId); } catch (er) { /* ignore */ }
      const el = btnAt(e.clientX, e.clientY);
      if (el) { setBtnPtr(e.pointerId, el); return; }
      if (e.clientX < window.innerWidth * 0.5 && touchStick.id === null) {
        touchStick.id = e.pointerId; touchStick.ox = e.clientX; touchStick.oy = e.clientY;
        stickEl.hidden = false;
        stickEl.style.left = e.clientX + 'px'; stickEl.style.top = e.clientY + 'px';
        knobEl.style.transform = 'translate(0px,0px)';
        I.ax = 0; I.ay = 0;
      }
    }, { passive: false });
    touchEl.addEventListener('pointermove', e => {
      e.preventDefault();
      if (e.pointerId === touchStick.id) { updateStick(e.clientX, e.clientY); return; }
      if (ptrBtn.has(e.pointerId)) {
        const el = btnAt(e.clientX, e.clientY);
        if (el && el.dataset.btn !== 'pause') setBtnPtr(e.pointerId, el);
      }
    }, { passive: false });
    const up = e => {
      if (e.pointerId === touchStick.id) {
        touchStick.id = null; stickEl.hidden = true; I.ax = 0; I.ay = 0;
      }
      if (ptrBtn.has(e.pointerId)) setBtnPtr(e.pointerId, null);
    };
    touchEl.addEventListener('pointerup', up);
    touchEl.addEventListener('pointercancel', up);
    touchEl.addEventListener('lostpointercapture', up);
    touchEl.addEventListener('contextmenu', e => e.preventDefault());
  }
  /** プレイ中だけタッチ操作UIを出す */
  BK.setTouchUI = function (on) {
    if (!touchEl) return;
    const show = on && I.touchMode;
    if (touchEl.hidden === !show) return;
    touchEl.hidden = !show;
    if (!show) {
      I.releaseAll('touch'); ptrBtn.clear(); touchStick.id = null; if (stickEl) stickEl.hidden = true;
      btnEls.forEach(b => b.classList.remove('on'));
    }
  };
  BK.setAwakenReady = function (ready, visible) {
    const el = document.getElementById('bk-b-awk');
    if (!el) return;
    el.classList.toggle('ready', !!ready);
    el.classList.toggle('bk-hide', visible === false);
  };

  // canvas tap (menus)
  cv.addEventListener('pointerdown', e => {
    e.preventDefault();
    if (e.pointerType === 'touch' || e.pointerType === 'pen') markTouch();
    BK.audio && BK.audio.unlock && BK.audio.unlock();
    const r = cv.getBoundingClientRect();
    I.tap = { x: (e.clientX - r.left) / r.width * BK.W, y: (e.clientY - r.top) / r.height * BK.H };
    I.anyKey = true;
  }, { passive: false });
  // タッチの pointerdown をユーザー操作と数えないブラウザがある → 指を離した時にも音声を解錠
  ['pointerup', 'touchend', 'click'].forEach(t => window.addEventListener(t, () => { if (BK.audio && BK.audio.unlock) BK.audio.unlock(); }, { capture: true, passive: true }));
  // iOS のダブルタップ拡大・ピンチ拡大を抑止
  document.addEventListener('gesturestart', e => e.preventDefault(), { passive: false });
  document.addEventListener('touchmove', e => { if (e.touches.length > 1 || e.target === cv || touchEl.contains(e.target)) e.preventDefault(); }, { passive: false });
  document.addEventListener('dblclick', e => e.preventDefault());
  if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) I.touchMode = true;

  // --------------------------------------------------------------- camera
  BK.cam = { x: 0, y: 0, sx: 0, sy: 0 };
  /** ワールド座標 → 画面座標 */
  BK.sx = x => x - BK.cam.x + BK.cam.sx;
  BK.sy = (y, z) => BK.FLOOR_TOP + y - (z || 0) + BK.cam.sy;

  // --------------------------------------------------------------- effects
  const fx = BK.fx = {
    parts: [], texts: [],
    shakeT: 0, shakeMag: 0, flashT: 0, flashMax: 1, flashCol: '#ffffff',
    hitstop: 0, slowmo: 0, darken: 0,
    screenFx: [],  // 暗転より手前に描く画面効果 (c) => {}  ※使い終わったら取り除くこと
    reset() { this.parts.length = 0; this.texts.length = 0; this.shakeT = 0; this.flashT = 0; this.hitstop = 0; this.slowmo = 0; this.darken = 0; this.screenFx.length = 0; },
    add(p) {
      if (this.parts.length > 420) { const i = this.parts.findIndex(q => !q.keep); this.parts.splice(i < 0 ? 0 : i, 1); }
      p.life = p.life || 30; p.max = p.life; p.vx = p.vx || 0; p.vy = p.vy || 0; p.vz = p.vz || 0;
      p.g = p.g == null ? 0 : p.g; p.drag = p.drag == null ? 1 : p.drag; p.z = p.z || 0;
      this.parts.push(p); return p;
    },
    shake(mag, t) { if (mag >= this.shakeMag || this.shakeT <= 0) { this.shakeMag = mag; this.shakeT = t || 10; } },
    flash(col, t) { this.flashCol = col || '#fff'; this.flashT = this.flashMax = t || 6; },
    stop(n) { this.hitstop = Math.max(this.hitstop, n); },
    /** 斬撃ヒットの火花 + 血しぶき */
    hitSpark(x, y, z, dir, power, col) {
      const n = 6 + Math.round(power * 4);
      for (let i = 0; i < n; i++) {
        const a = U.rand(-1.1, 1.1) + (dir < 0 ? Math.PI : 0);
        const s = U.rand(2, 5 + power * 3);
        this.add({ type: 'line', x, y, z, vx: Math.cos(a) * s, vz: Math.sin(a) * s * 0.8 + 1, life: U.randi(8, 14), col: i % 3 === 0 ? '#fff4d0' : '#ffb347', size: U.rand(1.2, 2.2), drag: 0.86 });
      }
      this.add({ type: 'burst', x, y, z, life: 7, size: 14 + power * 10, col: '#fff' });
      this.blood(x, y, z, dir, 4 + Math.round(power * 5), col);
    },
    blood(x, y, z, dir, n, col) {
      col = col || '#9e0d14';
      for (let i = 0; i < n; i++) {
        this.add({ type: 'dot', x, y: y + U.rand(-3, 3), z, vx: dir * U.rand(0.5, 4.5), vz: U.rand(1, 5.5), g: 0.32, life: U.randi(22, 40), col, size: U.rand(1.5, 3.6), drag: 0.97, splat: true });
      }
    },
    dust(x, y, n, col) {
      for (let i = 0; i < (n || 6); i++) {
        this.add({ type: 'smoke', x: x + U.rand(-8, 8), y, z: 2, vx: U.rand(-1.4, 1.4), vz: U.rand(0.2, 1.2), life: U.randi(18, 30), size: U.rand(5, 10), col: col || 'rgba(120,105,95,0.45)', drag: 0.92 });
      }
    },
    ring(x, y, z, r, col, life) { this.add({ type: 'ring', x, y, z, size: r, life: life || 16, col: col || '#fff' }); },
    glow(x, y, z, r, col, life) { this.add({ type: 'glow', x, y, z, size: r, life: life || 12, col: col || '#ff6030' }); },
    ember(x, y, z) { this.add({ type: 'dot', x, y, z, vx: U.rand(-0.6, 0.6), vz: U.rand(0.6, 1.6), life: U.randi(30, 60), col: U.choose(['#ff9a3c', '#ff5a1f', '#ffd27a']), size: U.rand(1, 2) }); },
    text(x, y, z, str, col, size) { this.texts.push({ x, y, z, str, col: col || '#fff', size: size || 14, life: 50, max: 50 }); },
    update() {
      if (this.shakeT > 0) {
        this.shakeT--;
        const m = this.shakeMag * (this.shakeT / 10 + 0.3);
        BK.cam.sx = U.rand(-m, m); BK.cam.sy = U.rand(-m, m) * 0.7;
      } else { BK.cam.sx = 0; BK.cam.sy = 0; }
      if (this.flashT > 0) this.flashT--;
      const ps = this.parts;
      for (let i = ps.length - 1; i >= 0; i--) {
        const p = ps[i];
        p.x += p.vx; p.y += p.vy; p.z += p.vz;
        p.vx *= p.drag; p.vy *= p.drag; p.vz = p.vz * p.drag - p.g;
        if (p.g && p.z < 0) {
          p.z = 0; p.vz = 0; p.vx *= 0.3;
          if (p.splat && !p.landed) { p.landed = true; p.life = Math.min(p.life, 90); p.max = Math.max(p.max, p.life); }
        }
        if (--p.life <= 0) ps.splice(i, 1);
      }
      for (let i = this.texts.length - 1; i >= 0; i--) { const t = this.texts[i]; t.z += 0.5; if (--t.life <= 0) this.texts.splice(i, 1); }
    },
    draw(c) {
      for (const p of this.parts) {
        const sx = BK.sx(p.x), sy = BK.sy(p.y, p.z);
        if (sx < -60 || sx > BK.W + 60) continue;
        const k = p.life / p.max;
        switch (p.type) {
          case 'dot':
            c.globalAlpha = p.landed ? Math.min(1, k * 2) * 0.8 : Math.min(1, k * 1.5);
            c.fillStyle = p.col;
            if (p.landed) { c.beginPath(); c.ellipse(sx, sy, p.size * 1.3, p.size * 0.5, 0, 0, 7); c.fill(); }
            else c.fillRect(sx - p.size / 2, sy - p.size / 2, p.size, p.size);
            break;
          case 'line':
            c.globalAlpha = k; c.strokeStyle = p.col; c.lineWidth = p.size;
            c.beginPath(); c.moveTo(sx, sy); c.lineTo(sx - p.vx * 2.2, sy + p.vz * 2.2); c.stroke();
            break;
          case 'smoke':
            c.globalAlpha = k * 0.9; c.fillStyle = p.col;
            c.beginPath(); c.arc(sx, sy, p.size * (1.6 - k * 0.6), 0, 7); c.fill();
            break;
          case 'ring':
            c.globalAlpha = k; c.strokeStyle = p.col; c.lineWidth = 3 * k + 1;
            c.beginPath(); c.ellipse(sx, sy, p.size * (1.2 - k), p.size * (1.2 - k) * 0.45, 0, 0, 7); c.stroke();
            break;
          case 'burst': {
            c.globalAlpha = k; c.fillStyle = p.col;
            const r = p.size * (1.2 - k * 0.6);
            c.beginPath();
            for (let i = 0; i < 8; i++) {
              const a = i / 8 * Math.PI * 2 + p.max, rr = i % 2 ? r * 0.35 : r;
              c.lineTo(sx + Math.cos(a) * rr, sy + Math.sin(a) * rr * 0.8);
            }
            c.closePath(); c.fill();
            break;
          }
          case 'glow': {
            c.globalAlpha = k * 0.85;
            const g = c.createRadialGradient(sx, sy, 0, sx, sy, p.size);
            g.addColorStop(0, p.col); g.addColorStop(1, 'rgba(0,0,0,0)');
            c.fillStyle = g; c.beginPath(); c.arc(sx, sy, p.size, 0, 7); c.fill();
            break;
          }
          case 'custom':
            c.globalAlpha = 1; p.draw(c, sx, sy, k, p);
            break;
        }
      }
      c.globalAlpha = 1;
      for (const t of this.texts) {
        const k = t.life / t.max;
        BK.text(c, t.str, BK.sx(t.x), BK.sy(t.y, t.z), { size: t.size, color: t.col, alpha: Math.min(1, k * 2), stroke: '#000', weight: 800 });
      }
    },
    drawScreen(c) {
      if (this.darken > 0) { c.fillStyle = `rgba(0,0,0,${this.darken})`; c.fillRect(0, 0, BK.W, BK.H); }
      if (this.flashT > 0) {
        c.globalAlpha = (this.flashT / this.flashMax) * 0.75; c.fillStyle = this.flashCol;
        c.fillRect(0, 0, BK.W, BK.H); c.globalAlpha = 1;
      }
    },
  };

  // ----------------------------------------------------------- text helper
  BK.font = (size, weight, fam) => `${weight || 600} ${size}px ${fam || BK.FONT_JP}`;
  /**
   * テキスト描画ヘルパー
   * opt: size, weight, fam, color, align, base, stroke, strokeW, alpha, shadow, maxW
   */
  BK.text = function (c, str, x, y, opt) {
    opt = opt || {};
    c.save();
    c.font = BK.font(opt.size || 14, opt.weight, opt.fam);
    c.textAlign = opt.align || 'center';
    c.textBaseline = opt.base || 'middle';
    if (opt.alpha != null) c.globalAlpha = opt.alpha;
    if (opt.shadow) { c.shadowColor = opt.shadow; c.shadowBlur = opt.shadowBlur || 8; }
    if (opt.stroke) {
      c.lineJoin = 'round'; c.strokeStyle = opt.stroke; c.lineWidth = opt.strokeW || Math.max(2, (opt.size || 14) / 5);
      c.strokeText(str, x, y, opt.maxW);
    }
    c.fillStyle = opt.color || '#fff';
    c.fillText(str, x, y, opt.maxW);
    c.restore();
  };

  // ---------------------------------------------------------------- scenes
  BK.sceneName = '';
  BK.scene = null;
  BK.sceneT = 0;
  BK.setScene = function (name, arg) {
    if (BK.scene && BK.scene.exit) BK.scene.exit();
    BK.sceneName = name;
    BK.scene = BK.scenes[name];
    BK.sceneT = 0;
    if (!BK.scene) throw new Error('unknown scene ' + name);
    if (BK.scene.enter) BK.scene.enter(arg);
  };

  // ------------------------------------------------------------ main loop
  const STEP = 1000 / 60;
  let acc = 0, last = 0, running = false;
  BK.errors = [];
  function frame(now) {
    requestAnimationFrame(frame);
    if (!last) last = now;
    if (BK.halt) { last = now; acc = 0; return; } // テスト用: 自動進行を止めて BK.stepOnce() で1フレームずつ進める
    let dt = now - last; last = now;
    // 自動画質: プレイ中に重いフレーム(24ms超)が続いたら内部解像度を2割下げる（最低 1.0）
    if (BK.sceneName === 'play' && !(BK.turbo > 1) && !document.hidden && dt < 250) {
      BK._slow = dt > 24 ? (BK._slow || 0) + 1 : Math.max(0, (BK._slow || 0) - 2);
      if (BK._slow > 90 && BK.renderScale > 1.05) { BK._slow = 0; BK.qualityCap = Math.max(1, BK.renderScale * 0.8); resize(); }
    }
    if (dt > 250) dt = STEP; // タブ復帰時などの大ジャンプは捨てる
    acc += dt;
    let n = 0;
    if (BK.turbo > 1) acc = STEP * BK.turbo; // テスト用の早送り
    try {
      while (acc >= STEP && n < Math.max(4, BK.turbo || 0)) {
        I.step();
        BK.frame++; BK.sceneT++;
        if (BK.scene && BK.scene.update) BK.scene.update();
        if (BK.audio && BK.audio.tick) BK.audio.tick();
        acc -= STEP; n++;
      }
      if (n >= 4) acc = 0;
      // 90/120Hz 端末では更新の無い rAF が来る。同じ絵を描き直さない
      if (n > 0 || BK.needsRender) { BK.needsRender = false; render(); }
    } catch (err) {
      BK.errors.push(String(err && err.stack || err));
      if (BK.errors.length < 5) console.error(err);
    }
  }
  function render() {
    ctx.setTransform(BK.renderScale, 0, 0, BK.renderScale, 0, 0);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, BK.W, BK.H);
    if (BK.scene && BK.scene.draw) BK.scene.draw(ctx);
  }
  /** テスト用: 1フレームだけ進めて描画する */
  BK.stepOnce = function (noDraw) {
    I.step();
    BK.frame++; BK.sceneT++;
    if (BK.scene && BK.scene.update) BK.scene.update();
    if (!noDraw) render();
  };
  BK.start = function (firstScene) {
    if (running) return;
    running = true;
    resize();
    BK.setScene(firstScene || 'title');
    requestAnimationFrame(frame);
  };
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      I.releaseAll('kb'); I.releaseAll('touch');
      if (BK.scene && BK.scene.onHide) BK.scene.onHide();
      BK.audio && BK.audio.suspend && BK.audio.suspend();
    } else {
      BK.audio && BK.audio.resume && BK.audio.resume();
    }
  });
  resize();
})(window.BK);

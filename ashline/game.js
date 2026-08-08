/* =============================================================================
   ASHLINE — Round 1 : greybox skeleton
   移動 / カメラ / カバー遷移 / 文脈依存アクション / 状態依存エイムアシスト
   見た目は意図的にグレーボックス。骨格の判定を見た目に邪魔させないため。
   ========================================================================== */
(function () {
'use strict';
var T = THREE;

/* ---------- small math helpers ------------------------------------------- */
var DEG = Math.PI / 180;
function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
function lerp(a, b, t) { return a + (b - a) * t; }
/* frame-rate independent smoothing toward b with time-constant tau          */
function smooth(a, b, tau, dt) { return b + (a - b) * Math.exp(-dt / (tau > 1e-6 ? tau : 1e-6)); }
function shortAngle(a) { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; }
function approachAngle(cur, target, rate, dt) {
  var d = shortAngle(target - cur), m = rate * dt;
  return Math.abs(d) <= m ? target : cur + Math.sign(d) * m;
}

/* three-style yaw: yaw y  =>  forward direction (-sin y, 0, -cos y)          */
function yawDirX(y) { return -Math.sin(y); }
function yawDirZ(y) { return -Math.cos(y); }
function dirToYaw(x, z) { return Math.atan2(-x, -z); }

/* =============================================================================
   CFG — 第7節の設計値。すべて実測調整前提。
   ========================================================================== */
var CFG = {
  player: { radius: 0.40, height: 1.80, chest: 1.15, head: 1.62 },

  move: {
    walk: 3.05, strafe: 2.55, back: 2.10,
    accel: 9.5, decel: 13.0,          // 重量：立ち上がり0.32s / 停止に余韻
    sprint: 6.30, sprintAccel: 7.5,
    coverSlide: 1.85,
    faceTurn: 13.0,                   // rad/s : 照準方向への体の追従
    sprintTurn: 5.2
  },

  // §7 遮蔽への吸着：入力から完了まで150〜200ms / 距離1.2m / カメラ0.25s
  cover: {
    snapTime: 0.165, snapDist: 1.20, standOff: 0.44, camBlend: 0.25,
    peekIn: 0.18, peekOut: 0.14, peekLateral: 0.60, peekRise: 0.46,
    enterThresh: 0.55, exitThresh: 0.35, edgeEps: 0.34,   // 端とみなす距離(m)
    lowMaxH: 1.25                     // これ以下は「低い遮蔽」＝上から撃てる
  },

  // §7 低姿勢ダッシュ：FOV 65→78 を0.3秒 / 上下揺れ2.5°・周期0.45秒
  sprintCam: { fovBase: 65, fovSprint: 78, fovTau: 0.30 / 2.2, bobAmp: 2.5 * DEG, bobPeriod: 0.45 },

  // §7 射撃：マズルフラッシュ2F / カメラキック縦1.2°＋横±0.4° / 0.25秒で復帰
  fire: {
    rpm: 640, flashFrames: 2,
    kickPitch: 1.2 * DEG, kickYaw: 0.4 * DEG, kickTau: 0.25 / 3.0,
    spreadStill: 0.30 * DEG, spreadMove: 2.60 * DEG, spreadTau: 0.10,
    mag: 30, reload: 1.60, dmg: 11, dmgHead: 28
  },

  // §7 ヒットストップ：通常40ms / 致命打120ms
  // 連射武器(640rpm=94ms間隔)に40msを毎発かけると体感が4割停止する。
  // 連射武器のみ 16ms に減じ、致命打(頭部)は仕様どおり120msを維持。＝要判断事項として報告。
  hitstop: { light: 0.016, heavy: 0.120, spec: 0.040 },

  // §6 エイムアシスト：作用範囲=画面幅8% / 着弾補正 最大3°
  aim: { magnetFrac: 0.08, snapDeg: 3.0, magnetSlow: 0.55 },

  cam: {
    dist: 3.05, up: 1.42, shoulder: 0.58,
    // 低い遮蔽＝しゃがむのでカメラも下げる／高い遮蔽＝立つので下げない（真っ暗にしない）
    coverDist: 2.60, coverUpLow: 1.26, coverUpHigh: 1.62, coverShoulder: 0.98,
    pitchMin: -50 * DEG, pitchMax: 36 * DEG,
    sens: 0.0042, sensAccel: 0.85, sensRef: 2.4,   // 感度の加速度カーブ
    reticleNdcY: 0.05
  },

  roll: { dist: 3.10, time: 0.55, swapMax: 4.0, swapTime: 0.52 },

  // 障害物の乗り越え。低い遮蔽のみ。跳んでいる間は完全に無防備。
  vault: { range: 1.15, time: 0.58, rise: 0.34, clearance: 0.12 },

  // ダッシュで遮蔽に突っ込んだときの自動吸着
  slam: { dist: 0.95, cone: 0.62 },

  // ブラインドファイア。当てる手段ではなく、頭を出さずに圧をかける手段。
  // ready=0.85 で「銃を上げ切るまで約0.10秒撃てない」＝ブラインドファイアの対価
  blind: { raise: 0.12, lower: 0.10, ready: 0.85, spread: 7.0 * DEG, muzzleUp: 0.25 }
};

/* エイムアシスト強度3段階。静止時の補正量のみ可変。
   移動中の減衰とダッシュ中の無効化は、どの段階でも解除しない（柱1を守るため）。*/
var ASSIST_LEVELS = [
  { name: '弱', snap: 0.45, magnet: 0.40 },
  { name: '標準', snap: 1.00, magnet: 1.00 },
  { name: '強', snap: 1.45, magnet: 1.45 }
];

var SET = { assist: 1, autoFire: false, debug: true };

/* =============================================================================
   ARENA — グレーボックス。多層の遮蔽 + 左右の回り込みルート。
   ========================================================================== */
var COVERS = [
  // x, z, hx, hz, h        （h<=1.25 は低い遮蔽）
  { x: 0, z: 2.0, hx: 2.60, hz: 0.35, h: 1.05 },
  // 高い遮蔽は幅を詰める。長すぎると壁の真ん中で完全に視界を失い、
  // 「隠れる」ではなく「何も見えない」になるため。
  { x: -5.4, z: -0.4, hx: 0.40, hz: 0.95, h: 2.05 },
  { x: 5.4, z: -0.4, hx: 0.40, hz: 0.95, h: 2.05 },
  { x: -3.2, z: -5.2, hx: 1.90, hz: 0.35, h: 1.05 },
  { x: 3.2, z: -5.2, hx: 1.90, hz: 0.35, h: 1.05 },
  { x: 0.0, z: -9.4, hx: 2.30, hz: 0.40, h: 2.05 },
  { x: -8.6, z: 3.4, hx: 0.38, hz: 2.20, h: 1.05 },
  { x: 8.6, z: 3.4, hx: 0.38, hz: 2.20, h: 1.05 },
  { x: -2.3, z: 6.6, hx: 0.75, hz: 0.75, h: 1.05 },
  { x: 2.3, z: 6.6, hx: 0.75, hz: 0.75, h: 2.05 },
  { x: -9.4, z: -6.0, hx: 0.40, hz: 1.60, h: 2.05 },
  { x: 9.4, z: -6.0, hx: 0.40, hz: 1.60, h: 2.05 }
];
var ARENA = { hx: 13.0, hz: 13.0, wallH: 4.2 };
var SPAWN = { x: 0, z: 9.4, yaw: 0 };            // yaw 0 => 向き -Z
var DUMMIES = [{ x: -2.6, z: -11.0 }, { x: 3.4, z: -11.0 }];

/* =============================================================================
   COLLIDERS / COVER FACES
   ========================================================================== */
var boxes = [];   // {minx,minz,maxx,maxz,top,cover}
var faces = [];   // {nx,nz,ax,az,tx,tz,len,cover,low}

function buildWorldData() {
  boxes.length = 0; faces.length = 0;
  for (var i = 0; i < COVERS.length; i++) {
    var c = COVERS[i];
    boxes.push({ minx: c.x - c.hx, maxx: c.x + c.hx, minz: c.z - c.hz, maxz: c.z + c.hz, top: c.h, cover: c });
    var low = c.h <= CFG.cover.lowMaxH;
    // 面の a->b は「壁を向いて立ったときのプレイヤーの左->右」になるよう並べる
    addFace(c, 0, 1, c.x - c.hx, c.z + c.hz, c.x + c.hx, c.z + c.hz, low);
    addFace(c, 0, -1, c.x + c.hx, c.z - c.hz, c.x - c.hx, c.z - c.hz, low);
    addFace(c, 1, 0, c.x + c.hx, c.z + c.hz, c.x + c.hx, c.z - c.hz, low);
    addFace(c, -1, 0, c.x - c.hx, c.z - c.hz, c.x - c.hx, c.z + c.hz, low);
  }
  // 外周壁（遮蔽としては使わない、移動と弾を止めるだけ）
  var A = ARENA, t = 0.6;
  boxes.push({ minx: -A.hx - t, maxx: -A.hx, minz: -A.hz - t, maxz: A.hz + t, top: A.wallH, cover: null });
  boxes.push({ minx: A.hx, maxx: A.hx + t, minz: -A.hz - t, maxz: A.hz + t, top: A.wallH, cover: null });
  boxes.push({ minx: -A.hx - t, maxx: A.hx + t, minz: -A.hz - t, maxz: -A.hz, top: A.wallH, cover: null });
  boxes.push({ minx: -A.hx - t, maxx: A.hx + t, minz: A.hz, maxz: A.hz + t, top: A.wallH, cover: null });
}
function addFace(c, nx, nz, ax, az, bx, bz, low) {
  var dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz);
  faces.push({ nx: nx, nz: nz, ax: ax, az: az, tx: dx / len, tz: dz / len, len: len, cover: c, low: low });
}

/* 円 vs AABB の押し出し（XZ平面） */
function resolveCircle(px, pz, r, out) {
  var moved = false;
  for (var it = 0; it < 3; it++) {
    var any = false;
    for (var i = 0; i < boxes.length; i++) {
      var b = boxes[i];
      var cx = clamp(px, b.minx, b.maxx), cz = clamp(pz, b.minz, b.maxz);
      var dx = px - cx, dz = pz - cz, d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      any = true; moved = true;
      var d = Math.sqrt(d2);
      if (d > 1e-5) { px = cx + dx / d * r; pz = cz + dz / d * r; }
      else {
        // 中心が箱の内側：一番近い面へ逃がす
        var l = px - b.minx, rr = b.maxx - px, u = pz - b.minz, dn = b.maxz - pz;
        var m = Math.min(l, rr, u, dn);
        if (m === l) px = b.minx - r; else if (m === rr) px = b.maxx + r;
        else if (m === u) pz = b.minz - r; else pz = b.maxz + r;
      }
    }
    if (!any) break;
  }
  out.x = px; out.z = pz; return moved;
}

/* Ray vs AABB（3D、スラブ法）。ヒット距離を返す。外れたら Infinity */
function rayBox(ox, oy, oz, dx, dy, dz, b) {
  var t0 = 0, t1 = Infinity, inv, a, bb, tmp;
  // X
  if (Math.abs(dx) < 1e-8) { if (ox < b.minx || ox > b.maxx) return Infinity; }
  else { inv = 1 / dx; a = (b.minx - ox) * inv; bb = (b.maxx - ox) * inv; if (a > bb) { tmp = a; a = bb; bb = tmp; } t0 = Math.max(t0, a); t1 = Math.min(t1, bb); }
  // Y (0 .. top)
  if (Math.abs(dy) < 1e-8) { if (oy < 0 || oy > b.top) return Infinity; }
  else { inv = 1 / dy; a = (0 - oy) * inv; bb = (b.top - oy) * inv; if (a > bb) { tmp = a; a = bb; bb = tmp; } t0 = Math.max(t0, a); t1 = Math.min(t1, bb); }
  // Z
  if (Math.abs(dz) < 1e-8) { if (oz < b.minz || oz > b.maxz) return Infinity; }
  else { inv = 1 / dz; a = (b.minz - oz) * inv; bb = (b.maxz - oz) * inv; if (a > bb) { tmp = a; a = bb; bb = tmp; } t0 = Math.max(t0, a); t1 = Math.min(t1, bb); }
  if (t1 < t0 || t1 < 0) return Infinity;
  return t0 > 0 ? t0 : Infinity;
}
function rayWorld(ox, oy, oz, dx, dy, dz, maxT) {
  var best = maxT === undefined ? Infinity : maxT;
  for (var i = 0; i < boxes.length; i++) {
    var t = rayBox(ox, oy, oz, dx, dy, dz, boxes[i]);
    if (t < best) best = t;
  }
  // 床
  if (dy < -1e-8) { var tf = -oy / dy; if (tf > 0 && tf < best) best = tf; }
  return best;
}

/* =============================================================================
   INPUT — Pointer Events。ポインタ1本ごとに役割を確定させ、途中で変えない。
   ========================================================================== */
var IN = {
  stick: { on: false, id: -1, ox: 0, oy: 0, x: 0, y: 0, mag: 0 },
  look: { on: false, id: -1, px: 0, py: 0, dx: 0, dy: 0, spd: 0 },
  fire: { on: false, id: -1 },
  act: { on: false, id: -1, edge: false }   // edge = このフレームで押された
};
var RECTS = { fire: null, act: null };
var latencyMark = -1;   // 入力遅延計測用

function inRect(r, x, y) { return r && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom; }

function bindInput(el) {
  el.style.touchAction = 'none';
  el.addEventListener('pointerdown', onDown, { passive: false });
  el.addEventListener('pointermove', onMove, { passive: false });
  el.addEventListener('pointerup', onUp, { passive: false });
  el.addEventListener('pointercancel', onUp, { passive: false });
  window.addEventListener('contextmenu', function (e) { e.preventDefault(); });

  function onDown(e) {
    e.preventDefault();
    // iOS Safari は「ユーザー操作の中」でしか音を出せない。最初のタップで必ず解錠する。
    if (SFX && !SFX.__unlocked) { SFX.__unlocked = true; try { SFX.unlock(); SFX.ambience(true); } catch (_) { } }
    if (el.setPointerCapture) { try { el.setPointerCapture(e.pointerId); } catch (_) { } }
    var x = e.clientX, y = e.clientY, W = window.innerWidth;
    latencyMark = performance.now();

    if (inRect(RECTS.act, x, y)) {                     // アクションボタン（カメラは回さない）
      IN.act.on = true; IN.act.id = e.pointerId; IN.act.edge = true; return;
    }
    if (inRect(RECTS.fire, x, y)) {                    // 射撃：押しつつドラッグでカメラも回る
      IN.fire.on = true; IN.fire.id = e.pointerId;
      IN.look.on = true; IN.look.id = e.pointerId; IN.look.px = x; IN.look.py = y; IN.look.dx = 0; IN.look.dy = 0;
      return;
    }
    if (x < W * 0.5 && !IN.stick.on) {                 // 左：可動式スティック（触れた場所が原点）
      IN.stick.on = true; IN.stick.id = e.pointerId; IN.stick.ox = x; IN.stick.oy = y;
      IN.stick.x = 0; IN.stick.y = 0; IN.stick.mag = 0; return;
    }
    if (!IN.look.on) {                                 // 右：カメラ
      IN.look.on = true; IN.look.id = e.pointerId; IN.look.px = x; IN.look.py = y; IN.look.dx = 0; IN.look.dy = 0;
    }
  }
  function onMove(e) {
    e.preventDefault();
    var x = e.clientX, y = e.clientY;
    if (IN.stick.on && e.pointerId === IN.stick.id) {
      var R = UI.stickR, dx = x - IN.stick.ox, dy = y - IN.stick.oy, d = Math.hypot(dx, dy);
      if (d > R) { // 原点を追従させる（指がベースを引きずる）
        IN.stick.ox += dx * (1 - R / d); IN.stick.oy += dy * (1 - R / d);
        dx = x - IN.stick.ox; dy = y - IN.stick.oy; d = R;
      }
      var dead = R * 0.14;
      var m = d < dead ? 0 : (d - dead) / (R - dead);
      IN.stick.mag = clamp(m, 0, 1);
      if (d > 1e-4) { IN.stick.x = dx / d * IN.stick.mag; IN.stick.y = -dy / d * IN.stick.mag; }
      else { IN.stick.x = 0; IN.stick.y = 0; }
    }
    if (IN.look.on && e.pointerId === IN.look.id) {
      IN.look.dx += x - IN.look.px; IN.look.dy += y - IN.look.py;
      IN.look.px = x; IN.look.py = y;
    }
  }
  function onUp(e) {
    e.preventDefault();
    var id = e.pointerId;
    if (IN.stick.on && id === IN.stick.id) { IN.stick.on = false; IN.stick.id = -1; IN.stick.x = 0; IN.stick.y = 0; IN.stick.mag = 0; }
    if (IN.look.on && id === IN.look.id) { IN.look.on = false; IN.look.id = -1; IN.look.dx = 0; IN.look.dy = 0; }
    if (IN.fire.on && id === IN.fire.id) { IN.fire.on = false; IN.fire.id = -1; }
    if (IN.act.on && id === IN.act.id) { IN.act.on = false; IN.act.id = -1; }
  }
}

/* =============================================================================
   PLAYER
   ========================================================================== */
var ST = { FREE: 'FREE', TOCOVER: 'TOCOVER', COVER: 'COVER', ROLL: 'ROLL', SWAP: 'SWAP', VAULT: 'VAULT' };

var P = {
  x: SPAWN.x, y: 0, z: SPAWN.z, vx: 0, vz: 0,
  yaw: SPAWN.yaw,            // 体の向き（three-style）
  state: ST.FREE,
  sprint: false, sprintArmed: false,
  // cover
  face: null, t: 0.5, snapT: 0, snapFrom: null, snapTo: null,
  peek: 0, peekSide: 0,      // -1 左 / +1 右 / 2 上（低い遮蔽の立ち撃ち）
  peekMode: 0,
  // roll / swap
  actT: 0, actDur: 0, ax0: 0, az0: 0, ax1: 0, az1: 0, swapFace: null, swapTgt: 0,
  coverAlignT: 0,
  // combat
  hp: 100, ammo: CFG.fire.mag, reloadT: 0, fireCd: 0, flash: 0,
  // blind fire
  blindT: 0,
  // vault
  vaultTop: 0,
  // anim
  lean: 0, leanV: 0, roll: 0, rollV: 0, stride: 0, crouch: 0, landDip: 0
};

var CAM = {
  yaw: SPAWN.yaw, pitch: 0,
  kickP: 0, kickY: 0,
  fov: CFG.sprintCam.fovBase,
  shoulder: CFG.cam.shoulder, dist: CFG.cam.dist, up: CFG.cam.up,
  bobT: 0, sprintBlend: 0, coverBlend: 0, side: 1,
  px: SPAWN.x, py: CFG.player.chest, pz: SPAWN.z    // 平滑化されたピボット
};

var enemies = [];
var hitstop = 0;
var METRICS = { fps: 60, ms: 16.7, calls: 0, tris: 0, latency: 0, uiOk: true };

/* ---------- cover query --------------------------------------------------- */
function findCover(px, pz, maxD) {
  var best = null, bestScore = Infinity;
  for (var i = 0; i < faces.length; i++) {
    var f = faces[i];
    var rx = px - f.ax, rz = pz - f.az;
    var side = rx * f.nx + rz * f.nz;              // 面の外側にいるか
    if (side < 0.02 || side > maxD) continue;
    var t = (rx * f.tx + rz * f.tz) / f.len;
    if (t < -0.25 || t > 1.25) continue;
    var tc = clamp(t, 0, 1);
    var cx = f.ax + f.tx * f.len * tc, cz = f.az + f.tz * f.len * tc;
    var d = Math.hypot(px - cx, pz - cz);
    if (d > maxD) continue;
    // 面の正面にいるほど優先（横から掠める面を拾わない）
    var score = d + Math.abs(t - tc) * 2.0;
    if (score < bestScore) { bestScore = score; best = f; P.__qt = tc; }
  }
  if (best) return { face: best, t: P.__qt };
  return null;
}
function coverAnchor(f, t, out) {
  var so = CFG.cover.standOff;
  var minT = clamp(CFG.player.radius * 0.55 / f.len, 0, 0.49);
  var tt = clamp(t, minT, 1 - minT);
  out.x = f.ax + f.tx * f.len * tt + f.nx * so;
  out.z = f.az + f.tz * f.len * tt + f.nz * so;
  out.t = tt; out.minT = minT;
  return out;
}
var _anc = { x: 0, z: 0, t: 0, minT: 0 };

/* ---- 乗り越え：低い遮蔽だけ。跳んでいる間は完全に無防備 ---------------- */
function findVault(sx, sy) {
  var fx = yawDirX(CAM.yaw), fz = yawDirZ(CAM.yaw), rx = -fz, rz = fx;
  var wx = rx * sx + fx * sy, wz = rz * sx + fz * sy;
  var wl = Math.hypot(wx, wz);
  if (wl < 1e-5) return null;
  return vaultTargetFor(wx / wl, wz / wl);
}
function vaultTargetFor(wx, wz) {
  var best = null, bestD = Infinity, bt = 0;
  for (var i = 0; i < faces.length; i++) {
    var f = faces[i];
    if (!f.low) continue;                                  // 高い遮蔽は越えられない
    if (wx * f.nx + wz * f.nz > -0.55) continue;           // その面に向かっていること
    var rx = P.x - f.ax, rz = P.z - f.az;
    var side = rx * f.nx + rz * f.nz;
    if (side < 0.02 || side > CFG.vault.range) continue;
    var t = (rx * f.tx + rz * f.tz) / f.len;
    if (t < 0.03 || t > 0.97) continue;                    // 角では跳ばない
    if (side < bestD) { bestD = side; best = f; bt = t; }
  }
  if (!best) return null;
  var c = best.cover;
  var depth = Math.abs(best.nx) > 0.5 ? c.hx * 2 : c.hz * 2;
  var span = depth + CFG.cover.standOff;
  var px = best.ax + best.tx * best.len * bt, pz = best.az + best.tz * best.len * bt;
  var lxp = px - best.nx * span, lzp = pz - best.nz * span;
  // 着地点が塞がっていたら跳ばせない（壁の向こうが埋まっているのに跳ぶのは理不尽）
  var o = { x: 0, z: 0 };
  resolveCircle(lxp, lzp, CFG.player.radius, o);
  if (Math.hypot(o.x - lxp, o.z - lzp) > 0.06) return null;
  return { face: best, lx: lxp, lz: lzp, top: c.h };
}
function startVault(v) {
  P.state = ST.VAULT; P.face = null; P.sprint = false; P.sprintArmed = false;
  P.ax0 = P.x; P.az0 = P.z; P.ax1 = v.lx; P.az1 = v.lz;
  P.actT = 0; P.actDur = CFG.vault.time; P.vaultTop = v.top;
  P.vx = 0; P.vz = 0; P.peek = 0; P.peekMode = 0; P.blindT = 0;
  if (SFX) SFX.vault();
}
function vaultUpdate(dt) {
  P.actT += dt;
  var s = clamp(P.actT / P.actDur, 0, 1);
  // 予備動作(踏み切りで少し溜める) → 主要動作(跳ぶ) → 余韻(着地の沈み込み)
  var k = s < 0.14 ? (s / 0.14) * 0.10
    : 0.10 + 0.90 * (1 - Math.pow(1 - (s - 0.14) / 0.86, 1.8));
  P.x = lerp(P.ax0, P.ax1, k); P.z = lerp(P.az0, P.az1, k);
  P.y = Math.sin(clamp((s - 0.10) / 0.82, 0, 1) * Math.PI) * (P.vaultTop + 0.10);
  P.yaw = approachAngle(P.yaw, dirToYaw(P.ax1 - P.ax0, P.az1 - P.az0), 16, dt);
  P.roll = Math.sin(s * Math.PI) * 0.42;
  if (s >= 1) {
    P.state = ST.FREE; P.y = 0; P.roll = 0; P.landDip = 1;
    P.x = P.ax1; P.z = P.az1; P.vx = 0; P.vz = 0;
  }
}

/* ---- ダッシュで遮蔽に突っ込んだときの自動吸着 -------------------------- */
function findSlamCover() {
  var sp = Math.hypot(P.vx, P.vz);
  if (sp < 2.5) return null;
  var dx = P.vx / sp, dz = P.vz / sp;
  var best = null, bestD = Infinity, bt = 0;
  for (var i = 0; i < faces.length; i++) {
    var f = faces[i];
    // 面に正面から突っ込んでいる時だけ。壁沿いに走り抜ける時に捕まらないように。
    if (dx * f.nx + dz * f.nz > -CFG.slam.cone) continue;
    var rx = P.x - f.ax, rz = P.z - f.az;
    var side = rx * f.nx + rz * f.nz;
    if (side < 0.02 || side > CFG.slam.dist) continue;
    var t = (rx * f.tx + rz * f.tz) / f.len;
    if (t < 0 || t > 1) continue;
    if (side < bestD) { bestD = side; best = f; bt = t; }
  }
  return best ? { face: best, t: bt } : null;
}

/* 吸着カーブ：予備動作(わずかに引く) → 主要動作 → 余韻(小さくオーバーシュート) */
function coverCurve(s) {
  var a = 0.16;
  if (s < a) return -0.055 * Math.sin(Math.PI * s / a);
  var u = (s - a) / (1 - a);
  return (1 - Math.pow(1 - u, 3)) + 0.09 * Math.sin(Math.PI * u) * u * (1 - u);
}

/* =============================================================================
   UPDATE
   ========================================================================== */
function update(dt) {
  if (hitstop > 0) { hitstop -= dt; return; }        // ヒットストップ中は世界を止める
  dt = Math.min(dt, 0.05);

  updateLook(dt);
  var act = IN.act.edge; IN.act.edge = false;

  switch (P.state) {
    case ST.FREE: freeUpdate(dt, act); break;
    case ST.TOCOVER: toCoverUpdate(dt); break;
    case ST.COVER: coverUpdate(dt, act); break;
    case ST.ROLL: rollUpdate(dt); break;
    case ST.SWAP: swapUpdate(dt); break;
    case ST.VAULT: vaultUpdate(dt); break;
  }
  P.landDip = smooth(P.landDip, 0, 0.10, dt);
  // カメラを先に確定させる。照準はカメラから引くので、1フレーム遅れると
  // 「見ている所と当たる所がずれる」＝エイムアシストが嘘をつく。
  updateAnim(dt);
  updateCamera(dt);
  updateWeapon(dt);
  updateEnemies(dt);
}

/* ---------- look ---------------------------------------------------------- */
function updateLook(dt) {
  var dx = IN.look.dx, dy = IN.look.dy;
  IN.look.dx = 0; IN.look.dy = 0;
  if (P.sprint) { dx = 0; dy = 0; }                  // ダッシュ中はカメラを預ける
  if (dx || dy) {
    // 感度の加速度カーブ：速いスワイプほど1pxあたりの回転が増える
    var spd = Math.hypot(dx, dy) / Math.max(dt, 1e-3) / 1000;     // px/ms
    var k = 1 + CFG.cam.sensAccel * clamp(spd / CFG.cam.sensRef, 0, 1);
    var s = CFG.cam.sens * k * magnetSlowdown();
    CAM.yaw -= dx * s;
    CAM.pitch = clamp(CAM.pitch - dy * s, CFG.cam.pitchMin, CFG.cam.pitchMax);
  }
}

/* ---------- FREE ---------------------------------------------------------- */
function freeUpdate(dt, act) {
  var sx = IN.stick.x, sy = IN.stick.y, mag = IN.stick.mag;

  if (act) {
    // 1) 低い障害物が正面にあれば乗り越え（壁に向かってダッシュしても意味がないため優先）
    var v = (mag > 0.35) ? findVault(sx, sy) : null;
    if (v) { startVault(v); vaultUpdate(dt); return; }
    // 2) 移動中ならダッシュ
    if (mag > 0.25) { P.sprint = true; P.sprintArmed = false; }
    else {
      var q = findCover(P.x, P.z, CFG.cover.snapDist);
      // 押したフレームのうちに動き出させる（1フレーム待たせない）
      if (q) { enterCover(q.face, q.t); toCoverUpdate(dt); return; }
      P.sprintArmed = true;                          // 遮蔽が無いときは空振りさせない
    }
  }
  if (P.sprintArmed && mag > 0.25) { P.sprint = true; P.sprintArmed = false; }
  if (!IN.act.on) { P.sprint = false; P.sprintArmed = false; }
  if (mag < 0.12) P.sprint = false;
  if (P.state !== ST.FREE) return;

  // カメラ相対の移動
  var fx = yawDirX(CAM.yaw), fz = yawDirZ(CAM.yaw);
  var rx = -fz, rz = fx;
  var wx = rx * sx + fx * sy, wz = rz * sx + fz * sy;
  var wl = Math.hypot(wx, wz);
  if (wl > 1e-5) { wx /= wl; wz /= wl; }

  var speed;
  if (P.sprint) speed = CFG.move.sprint;
  else {
    // 前後左右で最高速を変える（後退は遅い）
    var fwdAmt = sy, latAmt = Math.abs(sx);
    var sp = fwdAmt >= 0 ? lerp(CFG.move.strafe, CFG.move.walk, clamp(fwdAmt, 0, 1))
      : lerp(CFG.move.strafe, CFG.move.back, clamp(-fwdAmt, 0, 1));
    speed = sp * (1 - 0.15 * latAmt);
  }
  var tvx = wx * speed * mag, tvz = wz * speed * mag;
  var rate = (mag > 0.05) ? (P.sprint ? CFG.move.sprintAccel : CFG.move.accel) : CFG.move.decel;
  var mx = tvx - P.vx, mz = tvz - P.vz, ml = Math.hypot(mx, mz), step = rate * dt;
  if (ml <= step || ml < 1e-6) { P.vx = tvx; P.vz = tvz; }
  else { P.vx += mx / ml * step; P.vz += mz / ml * step; }

  moveAndCollide(dt);

  // ダッシュで遮蔽に突っ込んだら、そのまま貼り付く
  if (P.sprint) {
    var s = findSlamCover();
    if (s) {
      enterCover(s.face, s.t);
      P.landDip = 1;                                 // ぶつかった衝撃を体に出す
      if (SFX) SFX.slam();
      toCoverUpdate(dt);
      return;
    }
  }

  // 体の向き：ダッシュ中は進行方向、通常は照準方向
  if (P.sprint && (Math.abs(P.vx) + Math.abs(P.vz)) > 0.4) {
    P.yaw = approachAngle(P.yaw, dirToYaw(P.vx, P.vz), CFG.move.sprintTurn, dt);
    CAM.yaw = approachAngle(CAM.yaw, P.yaw, 2.6, dt);   // カメラが背後へ回り込む
  } else {
    P.yaw = approachAngle(P.yaw, CAM.yaw, CFG.move.faceTurn, dt);
  }
  P.peek = smooth(P.peek, 0, 0.06, dt);
}

function moveAndCollide(dt) {
  var nx = P.x + P.vx * dt, nz = P.z + P.vz * dt;
  var o = { x: 0, z: 0 };
  resolveCircle(nx, nz, CFG.player.radius, o);
  // 壁ずり：押し戻された分だけ速度を殺す
  if (Math.abs(o.x - nx) > 1e-6) P.vx = 0;
  if (Math.abs(o.z - nz) > 1e-6) P.vz = 0;
  P.x = o.x; P.z = o.z;
}

/* ---------- cover entry / snap ------------------------------------------- */
function enterCover(f, t) {
  coverAnchor(f, t, _anc);
  P.state = ST.TOCOVER; P.face = f; P.t = _anc.t;
  P.snapT = 0; P.snapFrom = { x: P.x, z: P.z }; P.snapTo = { x: _anc.x, z: _anc.z };
  P.sprint = false; P.vx = 0; P.vz = 0;
  P.peek = 0; P.peekMode = 0;
  P.coverAlignT = CFG.cover.camBlend;   // 壁越しを向くまでカメラを寄せ続ける
  if (SFX) SFX.coverIn();
}
function toCoverUpdate(dt) {
  P.snapT += dt;
  var s = clamp(P.snapT / CFG.cover.snapTime, 0, 1), k = coverCurve(s);
  P.x = lerp(P.snapFrom.x, P.snapTo.x, k);
  P.z = lerp(P.snapFrom.z, P.snapTo.z, k);
  var wantYaw = dirToYaw(-P.face.nx, -P.face.nz);     // 壁を向く
  P.yaw = approachAngle(P.yaw, wantYaw, 16.0, dt);
  if (s >= 1) { P.state = ST.COVER; P.x = P.snapTo.x; P.z = P.snapTo.z; }
}

/* ---------- COVER --------------------------------------------------------- */
function coverUpdate(dt, act) {
  var f = P.face;
  // スティックは遮蔽ローカルで解釈する（カメラ相対だと「左を押したら飛び出す」事故が起きる）
  var mag = IN.stick.mag;
  var lx = IN.stick.x, ly = IN.stick.y;   // 画面基準 ≒ 遮蔽基準（カメラは壁越しを向いているため）

  coverAnchor(f, P.t, _anc);
  // 「端にいるか」はt比ではなくメートルで見る（長い壁と細い柱で挙動が変わらないように）
  var eps = CFG.cover.edgeEps;
  var atL = (P.t - _anc.minT) * f.len <= eps;
  var atR = (1 - _anc.minT - P.t) * f.len <= eps;

  if (act) {
    if (mag > 0.35) {
      // 低い遮蔽で前に倒していれば、ロールではなく乗り越え
      var vv = (f.low && ly > 0.50 && Math.abs(lx) < 0.60) ? vaultTargetFor(-f.nx, -f.nz) : null;
      if (vv) { startVault(vv); vaultUpdate(dt); return; }
      startRollOrSwap(lx, ly);
    } else leaveCover();
    if (P.state !== ST.COVER) return;
  }

  /* --- 端からの身体乗り出し / 低い遮蔽からの立ち撃ち ------------------- */
  // 入りは固く、抜けは緩く（ヒステリシス）。撃たれている最中に暴発させないため。
  var wantMode = 0, wantSide = 0;
  var th = P.peekMode ? CFG.cover.exitThresh : CFG.cover.enterThresh;
  var dth = P.peekMode ? 0.34 : 0.55;
  if (mag >= th) {
    if (f.low && ly > dth && Math.abs(lx) < 0.75) { wantMode = 2; wantSide = 0; }
    else if (lx > dth && atR) { wantMode = 1; wantSide = 1; }
    else if (lx < -dth && atL) { wantMode = 1; wantSide = -1; }
  }
  if (wantMode) { P.peekMode = wantMode; P.peekSide = wantSide; }
  var target = wantMode ? 1 : 0;
  P.peek = smooth(P.peek, target, target > P.peek ? CFG.cover.peekIn / 2.2 : CFG.cover.peekOut / 2.2, dt);
  if (P.peek < 0.02 && !wantMode) { P.peek = 0; P.peekMode = 0; }

  /* --- ブラインドファイア：隠れたまま銃だけ上げて撃つ ------------------ */
  // 頭を出さないので当たらない。撃たれ続けている時に「何もできない」を無くすための手段。
  var wantBlind = (wantMode === 0 && P.peek < 0.15 && IN.fire.on);
  P.blindT = smooth(P.blindT, wantBlind ? 1 : 0,
    (wantBlind ? CFG.blind.raise : CFG.blind.lower) / 2.2, dt);
  if (!wantBlind && P.blindT < 0.02) P.blindT = 0;

  /* --- 遮蔽に沿った横移動 -------------------------------------------- */
  if (!wantMode && Math.abs(lx) > 0.12) {
    var dtt = (lx * CFG.move.coverSlide * dt) / f.len;
    P.t = clamp(P.t + dtt, _anc.minT, 1 - _anc.minT);
  }
  coverAnchor(f, P.t, _anc);
  P.x = _anc.x; P.z = _anc.z;
  P.vx = 0; P.vz = 0;

  // 体の向き：隠れている間は壁向き、乗り出したら照準方向
  var hide = dirToYaw(-f.nx, -f.nz);
  var wy = P.peek > 0.35 ? CAM.yaw : hide;
  P.yaw = approachAngle(P.yaw, wy, 11.0, dt);
}

function leaveCover() {
  P.state = ST.FREE; P.face = null; P.peek = 0; P.peekMode = 0; P.blindT = 0;
  P.vx = 0; P.vz = 0;
}

function startRollOrSwap(lx, ly) {
  var f = P.face;
  // 遮蔽ローカル -> ワールド。プレイヤーの前方は -n。
  var wx = f.tx * lx + (-f.nx) * ly, wz = f.tz * lx + (-f.nz) * ly;
  var l = Math.hypot(wx, wz); if (l < 1e-5) return;
  wx /= l; wz /= l;

  // その方向に別の遮蔽があれば乗り換え
  var best = null, bestD = Infinity, bt = 0;
  for (var i = 0; i < faces.length; i++) {
    var g = faces[i];
    if (g.cover === f.cover) continue;
    for (var s = 0.15; s <= 0.85; s += 0.35) {
      var gx = g.ax + g.tx * g.len * s + g.nx * CFG.cover.standOff;
      var gz = g.az + g.tz * g.len * s + g.nz * CFG.cover.standOff;
      var dx = gx - P.x, dz = gz - P.z, d = Math.hypot(dx, dz);
      if (d < 0.8 || d > CFG.roll.swapMax) continue;
      if ((dx / d) * wx + (dz / d) * wz < 0.72) continue;       // 進行方向に限る
      if (rayWorld(P.x, 0.9, P.z, dx / d, 0, dz / d, d - 0.3) < d - 0.35) continue;  // 遮られていない
      if (d < bestD) { bestD = d; best = g; bt = s; }
    }
  }
  P.ax0 = P.x; P.az0 = P.z; P.actT = 0; P.peek = 0; P.peekMode = 0;
  if (best) {
    coverAnchor(best, bt, _anc);
    P.state = ST.SWAP; P.swapFace = best; P.swapTgt = _anc.t;
    P.ax1 = _anc.x; P.az1 = _anc.z;
    // 距離に応じて所要時間を伸ばす（長い乗り換えほど無防備な時間が長い＝判断の対価）
    P.actDur = CFG.roll.swapTime * clamp(bestD / 3.2, 0.55, 1.35);
  } else {
    var dist = CFG.roll.dist;
    var hit = rayWorld(P.x, 0.9, P.z, wx, 0, wz, dist + CFG.player.radius);
    if (hit < dist + CFG.player.radius) dist = Math.max(0.5, hit - CFG.player.radius - 0.05);
    P.state = ST.ROLL; P.ax1 = P.x + wx * dist; P.az1 = P.z + wz * dist;
    P.actDur = CFG.roll.time * clamp(dist / CFG.roll.dist, 0.45, 1);
    P.face = null;
  }
}
function rollUpdate(dt) {
  P.actT += dt;
  var s = clamp(P.actT / P.actDur, 0, 1);
  var k = s < 0.12 ? -0.04 * Math.sin(Math.PI * s / 0.12) : (1 - Math.pow(1 - (s - 0.12) / 0.88, 2.2));
  var nx = lerp(P.ax0, P.ax1, k), nz = lerp(P.az0, P.az1, k);
  var o = { x: 0, z: 0 }; resolveCircle(nx, nz, CFG.player.radius, o);
  P.x = o.x; P.z = o.z;
  P.yaw = approachAngle(P.yaw, dirToYaw(P.ax1 - P.ax0, P.az1 - P.az0), 12, dt);
  P.roll = Math.sin(s * Math.PI) * 0.9;
  if (s >= 1) { P.state = ST.FREE; P.roll = 0; P.vx = 0; P.vz = 0; }
}
function swapUpdate(dt) {
  P.actT += dt;
  var s = clamp(P.actT / P.actDur, 0, 1), k = coverCurve(s);
  P.x = lerp(P.ax0, P.ax1, k); P.z = lerp(P.az0, P.az1, k);
  P.roll = Math.sin(s * Math.PI) * 0.55;
  var wantYaw = dirToYaw(-P.swapFace.nx, -P.swapFace.nz);
  P.yaw = approachAngle(P.yaw, wantYaw, 14, dt);
  if (s >= 1) {
    P.state = ST.COVER; P.face = P.swapFace; P.t = P.swapTgt; P.roll = 0;
    P.x = P.ax1; P.z = P.az1; P.coverAlignT = CFG.cover.camBlend;
  }
}

/* =============================================================================
   AIM / FIRE
   ========================================================================== */
var _aimDir = new T.Vector3(), _tmpV = new T.Vector3();
var aimTarget = null, aimTargetDist = 1, lastShot = null;

/* 着弾補正の上限角。§6の3°を上限に、状態と設定段階で縮める。 */
function snapMaxRad() {
  return CFG.aim.snapDeg * DEG * assistScale() * ASSIST_LEVELS[SET.assist].snap;
}

/* 状態によるエイムアシスト倍率。ここが柱1(止まって撃つ)を守る要。*/
/* どれだけ身を晒しているか。0=完全に隠れている 1=遮蔽なし。
   ラウンド2で敵の命中判定に使う。今はデバッグ表示のみ。 */
function exposure() {
  if (P.state === ST.COVER) {
    if (P.peekMode) return P.peek;
    return P.blindT * 0.22;                 // 腕だけ出している
  }
  if (P.state === ST.TOCOVER) return 1 - P.snapT / CFG.cover.snapTime * 0.85;
  return 1;
}

/* 隠れたまま銃だけ上げている状態か */
function isBlind() {
  return P.state === ST.COVER && P.peekMode === 0 && P.blindT >= CFG.blind.ready;
}

function assistScale() {
  if (P.sprint) return 0;                                   // ダッシュ中は補正ゼロ（かつ射撃不可）
  if (isBlind()) return 0;                                  // 見ていないのだから補正しない
  if (P.state === ST.ROLL || P.state === ST.SWAP || P.state === ST.VAULT) return 0;
  if (P.state === ST.COVER) return 1.0;                     // 遮蔽中・乗り出し中は最大
  var sp = Math.hypot(P.vx, P.vz);
  // 静止0.90 → 全速歩行0.15。走りながらの乱射を最適解にしないための減衰。
  return 0.15 + 0.75 * clamp(1 - sp / CFG.move.walk, 0, 1);
}
function canFire() {
  if (P.sprint) return false;
  if (P.state === ST.ROLL || P.state === ST.SWAP || P.state === ST.TOCOVER || P.state === ST.VAULT) return false;
  if (P.reloadT > 0 || P.ammo <= 0) return false;
  // 隠れたままなら、銃を上げ切った後だけ撃てる（ブラインドファイア）
  if (P.state === ST.COVER && P.peek < 0.5) return isBlind();
  return true;
}
function currentSpread() {
  if (isBlind()) return CFG.blind.spread;                   // 当てる手段ではない
  var sp = Math.hypot(P.vx, P.vz) / CFG.move.walk;
  var base = lerp(CFG.fire.spreadStill, CFG.fire.spreadMove, clamp(sp, 0, 1));
  if (P.state === ST.COVER) base = CFG.fire.spreadStill * 0.75;
  return base;
}

function aimRay() {
  // レティクル位置(NDC)からのカメラレイ
  _aimDir.set(0, CFG.cam.reticleNdcY, 0.5).unproject(camera).sub(camera.position).normalize();
  return _aimDir;
}
function acquireTarget() {
  aimTarget = null;
  var scale = assistScale(); if (scale <= 0) return;
  var R = window.innerWidth * CFG.aim.magnetFrac;
  var best = Infinity;
  for (var i = 0; i < enemies.length; i++) {
    var e = enemies[i]; if (e.dead) continue;
    _tmpV.set(e.x, (e.hb || HB_DEFAULT).chest, e.z).project(camera);
    if (_tmpV.z > 1) continue;
    var sxp = (_tmpV.x * 0.5 + 0.5) * window.innerWidth;
    var syp = (-(_tmpV.y - CFG.cam.reticleNdcY) * 0.5 + 0.5) * window.innerHeight;
    var d = Math.hypot(sxp - window.innerWidth * 0.5, syp - window.innerHeight * 0.5);
    if (d > R) continue;
    // 遮蔽越しの敵は吸着対象にしない
    var dx = e.x - camera.position.x, dy = (e.hb || HB_DEFAULT).chest - camera.position.y, dz = e.z - camera.position.z;
    var dd = Math.hypot(dx, dy, dz);
    if (rayWorld(camera.position.x, camera.position.y, camera.position.z, dx / dd, dy / dd, dz / dd, dd) < dd - 0.2) continue;
    if (d < best) { best = d; aimTarget = e; aimTargetDist = d / R; }
  }
}
function magnetSlowdown() {
  if (!aimTarget) return 1;
  var s = assistScale() * ASSIST_LEVELS[SET.assist].magnet;
  return 1 - CFG.aim.magnetSlow * s * (1 - aimTargetDist);
}

function updateWeapon(dt) {
  if (P.fireCd > 0) P.fireCd -= dt;
  if (P.flash > 0) P.flash -= 1;
  if (P.reloadT > 0) {
    P.reloadT -= dt;
    if (P.reloadT <= 0) { P.ammo = CFG.fire.mag; if (SFX) SFX.reload('in'); }
  } else if (P.ammo <= 0) { P.reloadT = CFG.fire.reload; if (SFX) SFX.reload('out'); }

  acquireTarget();
  var want = IN.fire.on || (SET.autoFire && aimTarget && canFire());
  if (want && canFire() && P.fireCd <= 0) shoot();
}

var FAR = 90;
var _mz = new T.Vector3(), _dir = new T.Vector3(), _rt = new T.Vector3(), _uu = new T.Vector3();

function shoot() {
  P.fireCd = 60 / CFG.fire.rpm;
  P.ammo--; P.flash = CFG.fire.flashFrames;

  var blind = isBlind(), snapApplied = 0, head = false;
  var m, d = _dir, camBlocked = false;

  if (blind) {
    /* 隠れたまま：カメラの射線は使わない。銃だけを遮蔽の上へ出して、
       おおよその方向へばらまく。狙っていないのだから当たらないのが正しい。 */
    m = blindMuzzle(_mz);
    blindDir(d);
  } else {
    /* 1) カメラから着弾点を求める（プレイヤーが見ている先） */
    var a = aimRay();
    d.copy(a);
    if (aimTarget) {   // スナップ補正（最大3°）
      var ahb = aimTarget.hb || HB_DEFAULT;
      var tx = aimTarget.x - camera.position.x, ty = ahb.chest - camera.position.y, tz = aimTarget.z - camera.position.z;
      var tl = Math.hypot(tx, ty, tz); tx /= tl; ty /= tl; tz /= tl;
      var ang = Math.acos(clamp(d.x * tx + d.y * ty + d.z * tz, -1, 1));
      if (ang <= snapMaxRad() && ang > 1e-5) { d.set(tx, ty, tz); snapApplied = ang / DEG; }
    }
    var tW = rayWorld(camera.position.x, camera.position.y, camera.position.z, d.x, d.y, d.z, FAR);
    var tE = Infinity;
    for (var i = 0; i < enemies.length; i++) {
      var e = enemies[i]; if (e.dead) continue;
      var r = enemyRay(e, camera.position.x, camera.position.y, camera.position.z, d.x, d.y, d.z);
      if (r.t < tE) tE = r.t;
    }
    camBlocked = tW < tE;
    var camT = Math.min(tW, tE);
    var ix = camera.position.x + d.x * camT, iy = camera.position.y + d.y * camT, iz = camera.position.z + d.z * camT;

    /* 2) 銃口から着弾点へ向け直す。カメラの射線が通っていても、
          銃が遮蔽の裏にあれば壁に当たる ＝ 遮蔽を撃ち抜かない。 */
    m = muzzlePos(_mz);
    d.set(ix - m.x, iy - m.y, iz - m.z).normalize();
  }

  /* 拡散は最後に、銃口から出る向きに対してかける */
  var sp = currentSpread();
  if (sp > 1e-6) {
    var ra = Math.random() * Math.PI * 2, rr = Math.sqrt(Math.random()) * sp;
    _tmpV.set(Math.abs(d.y) < 0.9 ? 0 : 1, Math.abs(d.y) < 0.9 ? 1 : 0, 0);
    _rt.crossVectors(d, _tmpV).normalize();
    _uu.crossVectors(_rt, d).normalize();
    d.addScaledVector(_rt, Math.cos(ra) * rr).addScaledVector(_uu, Math.sin(ra) * rr).normalize();
  }

  /* 3) 銃口から実際に飛ばす */
  var blocked = rayWorld(m.x, m.y, m.z, d.x, d.y, d.z, FAR);
  var mE = Infinity, mHitE = null, mHead = false;
  for (var j = 0; j < enemies.length; j++) {
    var e2 = enemies[j]; if (e2.dead) continue;
    var r2 = enemyRay(e2, m.x, m.y, m.z, d.x, d.y, d.z);
    if (r2.t < mE) { mE = r2.t; mHitE = e2; mHead = r2.head; }
  }
  var endT, hitEnemy = null;
  if (mE <= blocked) { endT = mE; hitEnemy = mHitE; head = mHead; }
  else endT = blocked;

  var ex = m.x + d.x * endT, ey = m.y + d.y * endT, ez = m.z + d.z * endT;
  var kind = hitEnemy ? (head ? 'head' : 'enemy') : 'world';
  FX.tracer(m.x, m.y, m.z, ex, ey, ez);
  FX.impact(ex, ey, ez, !!hitEnemy, -d.x, -d.y, -d.z, kind);
  if (FX.muzzle) FX.muzzle(m.x, m.y, m.z, d.x, d.y, d.z);
  // 命中音には着弾座標を渡す。渡さないと音が常に正面で鳴り、
  // 「敵の位置が画面を見なくても音で分かる」（柱5）が成立しない。
  if (SFX) { SFX.shot(blind ? 'blind' : 'rifle'); SFX.impact(kind, ex, ey, ez); }
  // 診断用：この1発が何に当たったのか（当たらない不具合の原因を推測しないため）
  lastShot = {
    hit: hitEnemy ? enemies.indexOf(hitEnemy) : -1, head: !!hitEnemy && head,
    blind: blind, camBlockedByWorld: camBlocked, muzzleBlocked: blocked < mE,
    end: { x: ex, y: ey, z: ez }, snapApplied: snapApplied
  };

  if (hitEnemy) {
    damageEnemy(hitEnemy, head ? CFG.fire.dmgHead : CFG.fire.dmg, d.x, d.z, head);
    hitstop = head ? CFG.hitstop.heavy : CFG.hitstop.light;
  }
  // カメラキック（ブラインドファイアは狙っていないので反動の見え方も鈍い）
  CAM.kickP += CFG.fire.kickPitch * (blind ? 0.55 : 1);
  CAM.kickY += (Math.random() * 2 - 1) * CFG.fire.kickYaw * (blind ? 1.6 : 1);
}

function muzzlePos(out) {
  var f = new T.Vector3(yawDirX(P.yaw), 0, yawDirZ(P.yaw));
  var r = new T.Vector3(-f.z, 0, f.x);
  var y = P.y + CFG.player.chest + 0.10 - P.crouch * 0.35 + (P.peekMode === 2 ? P.peek * CFG.cover.peekRise : 0);
  var lat = (P.peekMode === 1 ? P.peekSide * P.peek * CFG.cover.peekLateral : 0);
  out.set(P.x + f.x * 0.42 + r.x * (0.24 + lat), y, P.z + f.z * 0.42 + r.z * (0.24 + lat));
  return out;
}

/* ブラインドファイアの銃口：遮蔽の天端より上へ出す（自分の壁を撃たないため） */
function blindMuzzle(out) {
  var f = P.face;
  out.set(P.x - f.nx * 0.30, f.cover.h + CFG.blind.muzzleUp, P.z - f.nz * 0.30);
  return out;
}
/* ブラインドファイアの向き：遮蔽の正面から±75°まで。俯角仰角はほぼ水平に潰す */
function blindDir(out) {
  var f = P.face;
  var base = dirToYaw(-f.nx, -f.nz);
  var yaw = base + clamp(shortAngle(CAM.yaw - base), -75 * DEG, 75 * DEG);
  var pitch = clamp(CAM.pitch, -5 * DEG, 8 * DEG);
  var cp = Math.cos(pitch);
  return out.set(-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp);
}
/* 当たり判定はモデルの実寸から導く。
   ハードコードすると「見えているのに当たらない／見えないのに当たる」が起きる。
   実際、突撃型は実幅1.38mなのに判定は0.68mで、肩を撃っても当たらなかった。
   銃身は判定に含めない（長い銃を持つ狙撃型の銃口を撃っても当たらないのが正しい）。 */
var HB_DEFAULT = { halfX: 0.34, halfZ: 0.26, bodyTop: 1.52, headTop: 1.86, headHalf: 0.16, chest: 1.15 };

function isUnder(o, root) { while (o) { if (o === root) return true; o = o.parent; } return false; }

function hitboxFromRig(rig) {
  if (!rig || !rig.root) return HB_DEFAULT;
  rig.root.updateMatrixWorld(true);

  /* 胴と脚だけから寸法を取る。腕と銃は含めない。
     全身のバウンディングボックスを使うと、狙撃型の長い銃身が判定に入り、
     体から1.2m外を撃っても当たるようになる（実測で確認した）。
     契約で gun の命名は任意なので、gun を除外するだけでは足りない。 */
  var parts = [];
  if (rig.torso) parts.push({ o: rig.torso, skip: [rig.armR, rig.armL, rig.gun] });
  if (rig.legR) parts.push({ o: rig.legR, skip: [] });
  if (rig.legL) parts.push({ o: rig.legL, skip: [] });
  if (!parts.length) parts.push({ o: rig.root, skip: [rig.gun] });

  var bb = new T.Box3(), any = false, tmp = new T.Box3();
  for (var i = 0; i < parts.length; i++) {
    (function (p) {
      p.o.traverse(function (o) {
        if (!o.isMesh) return;
        for (var k = 0; k < p.skip.length; k++) if (p.skip[k] && isUnder(o, p.skip[k])) return;
        tmp.setFromObject(o);
        if (!any) { bb.copy(tmp); any = true; } else bb.union(tmp);
      });
    })(parts[i]);
  }
  if (!any) return HB_DEFAULT;

  // 見えている輪郭の端を撃って外れるのが最悪なので、実寸に少し余裕を足す
  var PAD = 0.06;
  var h = clamp(bb.max.y + PAD, 1.2, 2.3);
  var halfX = clamp(Math.max(Math.abs(bb.min.x), Math.abs(bb.max.x)) + PAD, 0.22, 0.80);
  var halfZ = clamp(Math.max(Math.abs(bb.min.z), Math.abs(bb.max.z)) + PAD, 0.18, 0.55);
  return {
    halfX: halfX, halfZ: halfZ,
    bodyTop: h * 0.80,                                // 上2割を頭部として扱う
    headTop: h,
    headHalf: clamp(halfX * 0.42, 0.11, 0.22),
    chest: h * 0.62
  };
}

function enemyRay(e, ox, oy, oz, dx, dy, dz) {
  var hb = e.hb || HB_DEFAULT;
  var body = { minx: e.x - hb.halfX, maxx: e.x + hb.halfX, minz: e.z - hb.halfZ, maxz: e.z + hb.halfZ, top: hb.bodyTop };
  var headB = { minx: e.x - hb.headHalf, maxx: e.x + hb.headHalf, minz: e.z - hb.headHalf, maxz: e.z + hb.headHalf, top: hb.headTop };
  // rayBox は y=0..top を仮定するので、頭は下限を持つ専用判定にする
  var tb = rayBox(ox, oy, oz, dx, dy, dz, body);
  var th = rayBoxY(ox, oy, oz, dx, dy, dz, headB, hb.bodyTop, hb.headTop);
  if (th < tb) return { t: th, head: true };
  return { t: tb, head: false };
}
function rayBoxY(ox, oy, oz, dx, dy, dz, b, y0, y1) {
  var t0 = 0, t1 = Infinity, inv, a, bb, tmp;
  if (Math.abs(dx) < 1e-8) { if (ox < b.minx || ox > b.maxx) return Infinity; }
  else { inv = 1 / dx; a = (b.minx - ox) * inv; bb = (b.maxx - ox) * inv; if (a > bb) { tmp = a; a = bb; bb = tmp; } t0 = Math.max(t0, a); t1 = Math.min(t1, bb); }
  if (Math.abs(dy) < 1e-8) { if (oy < y0 || oy > y1) return Infinity; }
  else { inv = 1 / dy; a = (y0 - oy) * inv; bb = (y1 - oy) * inv; if (a > bb) { tmp = a; a = bb; bb = tmp; } t0 = Math.max(t0, a); t1 = Math.min(t1, bb); }
  if (Math.abs(dz) < 1e-8) { if (oz < b.minz || oz > b.maxz) return Infinity; }
  else { inv = 1 / dz; a = (b.minz - oz) * inv; bb = (b.maxz - oz) * inv; if (a > bb) { tmp = a; a = bb; bb = tmp; } t0 = Math.max(t0, a); t1 = Math.min(t1, bb); }
  if (t1 < t0 || t1 < 0) return Infinity;
  return t0 > 0 ? t0 : Infinity;
}

/* =============================================================================
   ENEMY (Round1: 的として立っているだけ)
   ========================================================================== */
function makeEnemy(x, z) {
  return { x: x, z: z, hp: 100, dead: false, respawn: 0, flash: 0, knock: 0, knockX: 0, knockZ: 0, fall: 0, mesh: null };
}
function damageEnemy(e, dmg, dx, dz, head) {
  e.hp -= dmg; e.flash = 1; e.knock = 1; e.knockX = dx; e.knockZ = dz;
  FX.hitMark(head);
  if (e.hp <= 0 && !e.dead) { e.dead = true; e.respawn = 2.4; e.fall = 0; }
}
function updateEnemies(dt) {
  for (var i = 0; i < enemies.length; i++) {
    var e = enemies[i];
    e.flash = Math.max(0, e.flash - dt * 6);
    e.knock = smooth(e.knock, 0, 0.09, dt);
    if (e.dead) {
      e.fall = Math.min(1, e.fall + dt * 3.2);
      e.respawn -= dt;
      if (e.respawn <= 0) { e.dead = false; e.hp = 100; e.fall = 0; }
    }
  }
}

/* =============================================================================
   ANIMATION (procedural, 予備→主要→余韻)
   ========================================================================== */
function updateAnim(dt) {
  var sp = Math.hypot(P.vx, P.vz);
  var st0 = Math.floor(P.stride / Math.PI);
  P.stride += sp * dt * (P.sprint ? 1.55 : 2.05);
  // 足音は歩幅の位相が半周するたび。速度を渡して踏み込みの重さを変えられるようにする
  if (SFX && sp > 0.6 && Math.floor(P.stride / Math.PI) !== st0) SFX.step(sp);

  // 加速度から前傾を作り、バネで戻すことで停止時に余韻(オーバーシュート)が出る
  var f = new T.Vector3(yawDirX(P.yaw), 0, yawDirZ(P.yaw));
  var accF = (P.vx * f.x + P.vz * f.z) / Math.max(CFG.move.sprint, 1);
  var tgtLean = clamp(accF, -1, 1) * (P.sprint ? 0.30 : 0.16);
  var k = 120, c = 15;
  P.leanV += (-(P.lean - tgtLean) * k - P.leanV * c) * dt;
  P.lean += P.leanV * dt;

  var crouchT;
  if (P.state === ST.COVER) crouchT = (P.face && P.face.low) ? (1 - Math.max(P.peek, P.blindT * 0.35)) : 0.15;
  else if (P.state === ST.VAULT) crouchT = 0.35;
  else crouchT = P.sprint ? 0.55 : 0;
  P.crouch = smooth(P.crouch, crouchT, 0.09, dt);
}

/* =============================================================================
   CAMERA
   ========================================================================== */
function updateCamera(dt) {
  // 反動の減衰
  CAM.kickP = smooth(CAM.kickP, 0, CFG.fire.kickTau, dt);
  CAM.kickY = smooth(CAM.kickY, 0, CFG.fire.kickTau, dt);

  // FOV / 揺れ
  CAM.sprintBlend = smooth(CAM.sprintBlend, P.sprint ? 1 : 0, CFG.sprintCam.fovTau, dt);
  CAM.fov = lerp(CFG.sprintCam.fovBase, CFG.sprintCam.fovSprint, CAM.sprintBlend);
  CAM.bobT += dt;
  var bob = Math.sin(CAM.bobT * Math.PI * 2 / CFG.sprintCam.bobPeriod) * CFG.sprintCam.bobAmp * CAM.sprintBlend;

  // 遮蔽ブレンド（0.25秒）
  var inCover = (P.state === ST.COVER || P.state === ST.TOCOVER);
  CAM.coverBlend = smooth(CAM.coverBlend, inCover ? 1 : 0, CFG.cover.camBlend / 2.2, dt);

  // 肩の左右。既定は右肩。端に寄っているときだけ、その端の側へ寄せて視界を稼ぐ。
  var wantSide = 1;
  if (inCover && P.face) {
    if (P.peekMode === 1) wantSide = P.peekSide;
    else if (P.peekMode === 2) wantSide = 1;                  // 低い遮蔽の立ち撃ちは既定の右肩
    else {
      coverAnchor(P.face, P.t, _anc);
      var dL = (P.t - _anc.minT) * P.face.len, dR = (1 - _anc.minT - P.t) * P.face.len;
      wantSide = (dL < 1.0 && dL < dR) ? -1 : 1;
    }
  }
  CAM.side = smooth(CAM.side, wantSide, CFG.cover.camBlend / 2.2, dt);

  var coverUp = (P.face && P.face.low) ? CFG.cam.coverUpLow : CFG.cam.coverUpHigh;
  var shoulder = lerp(CFG.cam.shoulder, CFG.cam.coverShoulder, CAM.coverBlend) * CAM.side;
  var dist = lerp(CFG.cam.dist, CFG.cam.coverDist, CAM.coverBlend);
  var up = lerp(CFG.cam.up, coverUp, CAM.coverBlend) - P.crouch * 0.16;

  // 遮蔽に入ったら、壁越しを見る向きまでカメラを寄せる（0.25秒。§7のブレンド時間）。
  // ただしプレイヤーが自分でスワイプしている間は割り込まない。
  if (P.coverAlignT > 0 && P.face && (P.state === ST.TOCOVER || P.state === ST.COVER)) {
    if (IN.look.on) P.coverAlignT = 0;
    else {
      P.coverAlignT -= dt;
      var tgt = CAM.yaw + shortAngle(dirToYaw(-P.face.nx, -P.face.nz) - CAM.yaw);
      CAM.yaw = smooth(CAM.yaw, tgt, CFG.cover.camBlend / 2.6, dt);
    }
  }

  // ピボットは常に平滑化（吸着の瞬間にカメラがワープしない）
  var lateral = (P.peekMode === 1 ? P.peekSide * P.peek * CFG.cover.peekLateral * 0.8 : 0);
  var fx = yawDirX(P.yaw), fz = yawDirZ(P.yaw), rx = -fz, rz = fx;
  var tx = P.x + rx * lateral, tz = P.z + rz * lateral;
  var tau = (P.state === ST.TOCOVER || P.state === ST.SWAP) ? 0.055 : 0.035;
  CAM.px = smooth(CAM.px, tx, tau, dt);
  CAM.pz = smooth(CAM.pz, tz, tau, dt);
  // 乗り越え中はカメラを体ほど上げない（画面が泳ぐのを避ける）
  CAM.py = smooth(CAM.py, CFG.player.chest + P.y * 0.35
    + (P.peekMode === 2 ? P.peek * CFG.cover.peekRise : 0), 0.05, dt);

  var pitch = clamp(CAM.pitch + CAM.kickP + bob, CFG.cam.pitchMin - 0.2, CFG.cam.pitchMax + 0.2);
  var yaw = CAM.yaw + CAM.kickY;
  camera.rotation.set(pitch, yaw, 0, 'YXZ');
  camera.fov = CAM.fov; camera.updateProjectionMatrix();

  // 注視の支点。CAM.py は胸の高さ（乗り出し分を含む）、up との差でカメラ高を作る
  var pvx = CAM.px, pvy = CAM.py + (up - CFG.player.chest), pvz = CAM.pz;

  // カメラの当たり：支点から所望位置へレイを飛ばし、壁にめり込む分だけ引き寄せる
  _camOff.set(shoulder, 0, dist).applyEuler(camera.rotation);
  var ol = _camOff.length();
  _camDir.copy(_camOff).divideScalar(ol);
  var hit = rayWorld(pvx, pvy, pvz, _camDir.x, _camDir.y, _camDir.z, ol + 0.25);
  var use = Math.min(ol, Math.max(0.55, hit - 0.18));
  camera.position.set(pvx + _camDir.x * use, pvy + _camDir.y * use, pvz + _camDir.z * use);
  camera.updateMatrixWorld(true);   // 照準の投影/逆投影が今フレームの姿勢を使うように
}
var _camOff = new T.Vector3(), _camDir = new T.Vector3();

/* =============================================================================
   RENDER SETUP
   ========================================================================== */
var renderer, scene, camera, playerRig, enemyMeshes = [];
var FX, POST = null, SKY = null, LIGHTS = null, SFX = null, TEX = null;

/* アートモジュールは「あれば使う」。無ければ従来のグレーボックスで動く。
   こうしておかないと、1つでも欠けた瞬間にゲーム全体が起動しなくなる。 */
var ART = (typeof window !== 'undefined' && window.ASH) ? window.ASH : {};
function hasArt(k) { return typeof ART[k] === 'function' || (k === 'world' && ART.world); }

function initRender() {
  var canvas = document.getElementById('gl');
  renderer = new T.WebGLRenderer({ canvas: canvas, antialias: true, powerPreference: 'high-performance', stencil: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = T.PCFShadowMap;
  // トーンマッピングは post があればそちらが最終シェーダで行う（二重適用を避ける）

  scene = new T.Scene();
  camera = new T.PerspectiveCamera(CFG.sprintCam.fovBase, 1, 0.1, 200);
  camera.rotation.order = 'YXZ';
  scene.add(camera);

  var PL = ART.palette;

  /* ---- 空と霧 -------------------------------------------------------- */
  if (hasArt('sky')) {
    SKY = ART.sky(T, scene);
    scene.background = new T.Color(PL.skyZenith);
  } else {
    scene.background = new T.Color(0x2b2f33);
    scene.fog = new T.Fog(0x2b2f33, 26, 62);
  }

  /* ---- 光。applyRim があれば全マテリアルに擬似リム/AOを焼き込む ------- */
  var applyRim = null;
  if (hasArt('light')) {
    LIGHTS = ART.light(T, scene);
    if (LIGHTS && typeof LIGHTS.applyRim === 'function') applyRim = LIGHTS.applyRim;
  } else {
    // グレーボックス段階の暫定ライト（形が読めることを優先）
    scene.add(new T.HemisphereLight(0x9db2c4, 0x3a342e, 0.95));
    var sun = new T.DirectionalLight(0xffe9d0, 1.55);
    sun.position.set(-14, 20, 10);
    sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024);
    var sc = sun.shadow.camera;
    sc.left = -18; sc.right = 18; sc.top = 18; sc.bottom = -18; sc.near = 1; sc.far = 60;
    sun.shadow.bias = -0.0012; sun.shadow.normalBias = 0.03;
    scene.add(sun); scene.add(sun.target);
  }
  function mat(o) { var m = new T.MeshLambertMaterial(o); if (applyRim) applyRim(m); return m; }

  /* ---- テクスチャ ---------------------------------------------------- */
  if (hasArt('tex')) TEX = ART.tex(T);
  var MATS = { tex: TEX };
  function mapOf(k, rx, ry) {
    if (!TEX || !TEX[k]) return null;
    var t = TEX[k].clone(); t.needsUpdate = true;
    t.wrapS = t.wrapT = T.RepeatWrapping; t.repeat.set(rx || 1, ry || 1);
    return t;
  }

  var matFloor = mat({ color: TEX ? 0xffffff : 0x4a4f54, map: mapOf('ground', 14, 14) });
  var matCover = mat({ color: TEX ? 0xffffff : 0x8a9096, map: mapOf('concrete', 2, 2) });
  var matLow = mat({ color: TEX ? 0xffffff : 0xa6a094, map: mapOf('stone', 2, 2) });
  var matWall = mat({ color: TEX ? 0xffffff : 0x3c4145, map: mapOf('concrete', 6, 2) });
  if (TEX) {
    matFloor.color.setHex(PL ? PL.ground : 0xffffff);
    matCover.color.setHex(PL ? PL.concrete : 0xffffff);
    matLow.color.setHex(PL ? PL.stone : 0xffffff);
    matWall.color.setHex(PL ? PL.concreteDark : 0xffffff);
  }

  var floor = new T.Mesh(new T.PlaneGeometry(ARENA.hx * 2 + 1.2, ARENA.hz * 2 + 1.2), matFloor);
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);

  /* ---- 遮蔽と壁。env があれば見た目を差し替える（当たり判定は不変） -- */
  if (hasArt('env')) {
    scene.add(ART.env(T, MATS, COVERS, ARENA));
  } else {
    // グリッド（距離感の手がかり。グレーボックス段階でのみ必要）
    var grid = new T.GridHelper(26, 26, 0x5d6367, 0x565b60);
    grid.position.y = 0.01; grid.material.opacity = 0.5; grid.material.transparent = true;
    scene.add(grid);
    var box1 = new T.BoxGeometry(1, 1, 1);
    for (var i = 0; i < COVERS.length; i++) {
      var c = COVERS[i], low = c.h <= CFG.cover.lowMaxH;
      var m = new T.Mesh(box1, low ? matLow : matCover);
      m.scale.set(c.hx * 2, c.h, c.hz * 2);
      m.position.set(c.x, c.h / 2, c.z);
      m.castShadow = true; m.receiveShadow = true;
      scene.add(m);
    }
    for (var b = 0; b < 4; b++) {
      var bx = boxes[boxes.length - 4 + b];
      var w = new T.Mesh(box1, matWall);
      w.scale.set(bx.maxx - bx.minx, bx.top, bx.maxz - bx.minz);
      w.position.set((bx.minx + bx.maxx) / 2, bx.top / 2, (bx.minz + bx.maxz) / 2);
      w.receiveShadow = true; scene.add(w);
    }
  }
  if (hasArt('debris')) scene.add(ART.debris(T, MATS, ARENA, COVERS));

  /* ---- キャラクター --------------------------------------------------- */
  playerRig = hasArt('player') ? ART.player(T, MATS) : buildFigure(0x39424b, 0x27303a, false);
  scene.add(playerRig.root);
  for (var e = 0; e < enemies.length; e++) {
    // ラウンド1は的のみ。2種の作り分けはラウンド2の遭遇設計で使う。
    var type = (e % 2 === 0) ? 'rusher' : 'marksman';
    var fg = hasArt('enemy') ? ART.enemy(T, MATS, type) : buildFigure(0x6b3a34, 0x4a2622, true);
    scene.add(fg.root); enemyMeshes.push(fg);
    enemies[e].hb = hitboxFromRig(fg);      // 見た目と当たり判定を一致させる
    enemies[e].type = type;
  }

  /* ---- リムを全 Lambert マテリアルに行き渡らせる ----------------------
     影の可否は各モジュールの判断に任せる（空や瓦礫に影を落とさせない）。*/
  if (applyRim) {
    scene.traverse(function (o) {
      if (o.isMesh && o.material && o.material.isMeshLambertMaterial && !o.material.__rim) applyRim(o.material);
    });
  }

  FX = makeFX();

  /* ---- ポストプロセス ------------------------------------------------- */
  if (hasArt('post')) {
    renderer.toneMapping = T.NoToneMapping;      // post 側の最終シェーダで行う
    POST = ART.post(T, renderer, scene, camera);
  } else {
    renderer.toneMapping = T.ACESFilmicToneMapping;
    renderer.toneMappingExposure = ART.palette ? ART.palette.exposure : 1.0;
  }

  /* ---- HUDの見た目 ---------------------------------------------------- */
  if (hasArt('hud')) {
    var st = document.createElement('style');
    st.textContent = ART.hud();
    document.head.appendChild(st);
  }

  /* ---- 音（実際に鳴らせるのは初回タップ後） --------------------------- */
  if (hasArt('audio')) SFX = ART.audio();
}

/* シルエットが別物として読めることを最優先にした簡易フィギュア */
function buildFigure(colA, colB, enemy) {
  var root = new T.Group();
  var body = new T.Group(); root.add(body);
  var mA = new T.MeshLambertMaterial({ color: colA });
  var mB = new T.MeshLambertMaterial({ color: colB });
  var g = new T.BoxGeometry(1, 1, 1);
  function part(p, sx, sy, sz, x, y, z, m) {
    var q = new T.Mesh(g, m || mA); q.scale.set(sx, sy, sz); q.position.set(x, y, z);
    q.castShadow = true; p.add(q); return q;
  }
  var torso = new T.Group(); torso.position.y = 0.98; body.add(torso);
  if (enemy) {
    part(torso, 0.62, 0.66, 0.36, 0, 0, 0);
    part(torso, 0.94, 0.20, 0.40, 0, 0.28, 0, mB);         // 肩の張り出し＝敵の識別記号
    part(torso, 0.26, 0.30, 0.26, 0, 0.55, 0, mB);
    part(torso, 0.10, 0.26, 0.10, 0, 0.80, 0, mB);         // 頭頂の突起
  } else {
    part(torso, 0.50, 0.62, 0.30, 0, 0, 0);
    part(torso, 0.70, 0.16, 0.32, 0, 0.24, 0, mB);
    part(torso, 0.23, 0.26, 0.24, 0, 0.50, 0, mB);
  }
  var armR = new T.Group(); armR.position.set(enemy ? 0.40 : 0.32, 0.14, 0); torso.add(armR);
  part(armR, 0.16, 0.46, 0.16, 0, -0.20, 0, mB);
  var armL = new T.Group(); armL.position.set(enemy ? -0.40 : -0.32, 0.14, 0); torso.add(armL);
  part(armL, 0.16, 0.46, 0.16, 0, -0.20, 0, mB);
  var gun = null, flash = null;
  if (!enemy) {
    // 銃は胴に付けた専用ピボットに載せる。腕の回転で銃口の向きが崩れないようにするため。
    gun = new T.Group(); gun.position.set(0.26, -0.06, 0); torso.add(gun);
    part(gun, 0.12, 0.13, 0.80, 0, 0, 0.34, mB);
    part(gun, 0.10, 0.20, 0.16, 0, -0.13, 0.10, mB);          // グリップ
    flash = new T.Mesh(new T.SphereGeometry(0.13, 6, 5), new T.MeshBasicMaterial({ color: 0xffd9a0 }));
    flash.position.set(0, 0, 0.78); flash.visible = false; gun.add(flash);
  }
  var legR = new T.Group(); legR.position.set(0.15, 0.92, 0); body.add(legR);
  part(legR, 0.19, 0.50, 0.19, 0, -0.25, 0);
  part(legR, 0.17, 0.44, 0.17, 0, -0.70, 0, mB);
  var legL = new T.Group(); legL.position.set(-0.15, 0.92, 0); body.add(legL);
  part(legL, 0.19, 0.50, 0.19, 0, -0.25, 0);
  part(legL, 0.17, 0.44, 0.17, 0, -0.70, 0, mB);
  return { root: root, body: body, torso: torso, armR: armR, armL: armL, legR: legR, legL: legL, gun: gun, flash: flash, mA: mA, mB: mB };
}

/* VFX担当のモジュールがあればそれを使い、無ければ従来の簡易FXに落ちる。
   game.js 側の呼び出し形（tracer / impact / step）は変えず、引数を足すだけにしてある。*/
function makeFX() {
  if (hasArt('vfx')) {
    var v = ART.vfx(T, scene);
    return {
      tracer: v.tracer,
      muzzle: v.muzzle,
      impact: function (x, y, z, isEnemy, nx, ny, nz, kind) { v.impact(x, y, z, nx, ny, nz, kind); },
      hitMark: function (head) { UI.hitMark(head); },
      step: v.step
    };
  }
  return buildFX();
}

function buildFX() {
  var tracerMat = new T.LineBasicMaterial({ color: 0xffe2b0, transparent: true, opacity: 0.9 });
  var tracers = [];
  for (var i = 0; i < 10; i++) {
    var geo = new T.BufferGeometry(); geo.setAttribute('position', new T.BufferAttribute(new Float32Array(6), 3));
    var ln = new T.Line(geo, tracerMat.clone()); ln.visible = false; ln.frustumCulled = false;
    scene.add(ln); tracers.push({ ln: ln, life: 0 });
  }
  var impMat = new T.MeshBasicMaterial({ color: 0xd8cfc0, transparent: true });
  var impMatE = new T.MeshBasicMaterial({ color: 0xff6a4a, transparent: true });
  var imps = [];
  var ig = new T.SphereGeometry(0.09, 5, 4);
  for (var j = 0; j < 10; j++) {
    var mm = new T.Mesh(ig, impMat.clone()); mm.visible = false; scene.add(mm);
    imps.push({ m: mm, life: 0 });
  }
  var ti = 0, ii = 0;
  return {
    tracer: function (x0, y0, z0, x1, y1, z1) {
      var t = tracers[ti = (ti + 1) % tracers.length];
      var a = t.ln.geometry.attributes.position;
      a.array[0] = x0; a.array[1] = y0; a.array[2] = z0;
      a.array[3] = x1; a.array[4] = y1; a.array[5] = z1;
      a.needsUpdate = true; t.ln.visible = true; t.life = 0.055;
    },
    muzzle: null,
    impact: function (x, y, z, isEnemy) {
      var p = imps[ii = (ii + 1) % imps.length];
      p.m.position.set(x, y, z); p.m.visible = true; p.life = 0.16;
      p.m.material.color.setHex(isEnemy ? 0xff7a52 : 0xd8cfc0);
      p.m.scale.setScalar(isEnemy ? 1.5 : 1.0);
    },
    hitMark: function (head) { UI.hitMark(head); },
    step: function (dt) {
      for (var i = 0; i < tracers.length; i++) { var t = tracers[i]; if (t.life > 0) { t.life -= dt; if (t.life <= 0) t.ln.visible = false; } }
      for (var j = 0; j < imps.length; j++) {
        var p = imps[j]; if (p.life > 0) { p.life -= dt; p.m.material.opacity = clamp(p.life / 0.16, 0, 1); if (p.life <= 0) p.m.visible = false; }
      }
    }
  };
}

/* ---------- rig を状態に合わせて動かす ----------------------------------- */
function syncRig() {
  var r = playerRig;
  r.root.position.set(P.x, P.y, P.z);
  r.root.rotation.y = P.yaw + Math.PI;      // three-style yaw -> メッシュの向き

  var lateral = (P.peekMode === 1 ? P.peekSide * P.peek * CFG.cover.peekLateral : 0);
  var rise = (P.peekMode === 2 ? P.peek * CFG.cover.peekRise : 0);
  // landDip = 着地／遮蔽への激突の沈み込み（重量の余韻を画面に出す）
  r.body.position.set(lateral, -P.crouch * 0.32 + rise - P.landDip * 0.16, 0);
  r.body.rotation.z = -P.lean * 0.25 - P.roll * 0.55 + (P.peekMode === 1 ? P.peekSide * P.peek * 0.24 : 0);
  r.body.rotation.x = P.lean + P.roll * 0.9 + P.crouch * 0.18 + P.landDip * 0.30;

  var sp = Math.hypot(P.vx, P.vz);
  var amp = clamp(sp / CFG.move.walk, 0, 1.4) * 0.62;
  r.legR.rotation.x = Math.sin(P.stride) * amp;
  r.legL.rotation.x = -Math.sin(P.stride) * amp;
  r.armL.rotation.x = -Math.sin(P.stride) * amp * 0.5;

  // 構え：撃てる状態なら腕を前に上げ、そうでなければ下ろす
  // （銃は胴に付いているので、腕の角度が銃口の向きを壊すことはない）
  var ready = canFire() || (P.state === ST.FREE && !P.sprint);
  var b = P.blindT;
  if (b > 0.01) {
    // ブラインドファイア：頭は下げたまま、腕と銃だけを遮蔽の上へ突き出す
    var upY = (P.face ? P.face.cover.h + CFG.blind.muzzleUp : 1.3) - 0.98 + P.crouch * 0.32;
    r.armR.rotation.x = lerp(-0.15, -2.35, b);
    r.armR.rotation.z = lerp(0, -0.30, b);
    r.gun.rotation.x = lerp(0.60, 0.05, b);
    r.gun.position.y = lerp(-0.20, upY, b);
    r.gun.position.z = lerp(0, 0.18, b);
  } else {
    r.armR.rotation.x = ready ? -1.25 : -0.15;
    r.armR.rotation.z = ready ? 0.25 : 0;
    r.gun.rotation.x = ready ? 0 : 0.60;
    r.gun.position.y = ready ? -0.06 : -0.20;
    r.gun.position.z = 0;
  }
  // VFXモジュールが銃口炎を出す場合、モデル側の発光は消す。
  // 出す位置が違う（モデルは前方0.78m、弾の発射点は0.42m）ので、二重に出ると嘘になる。
  if (r.flash) r.flash.visible = (P.flash > 0) && !(FX && FX.muzzle);

  for (var i = 0; i < enemies.length; i++) {
    var e = enemies[i], m = enemyMeshes[i];
    m.root.visible = true;
    m.root.position.set(e.x - e.knockX * e.knock * 0.10, 0, e.z - e.knockZ * e.knock * 0.10);
    m.root.rotation.y = Math.PI;
    m.body.rotation.x = e.fall > 0 ? e.fall * 1.5 : -e.knock * 0.22;
    m.body.position.y = e.fall > 0 ? -e.fall * 0.55 : 0;
    var f = e.flash;
    m.mA.color.setHex(f > 0.02 ? 0xffb0a0 : 0x6b3a34);
    m.mB.color.setHex(f > 0.02 ? 0xff9080 : 0x4a2622);
    if (e.dead && e.fall >= 1) m.root.visible = e.respawn > 0.3;
  }
}

/* =============================================================================
   UI
   ========================================================================== */
var UI = {
  stickR: 62,
  els: {},
  init: function () {
    var ids = ['stickBase', 'stickKnob', 'btnFire', 'btnAct', 'actLabel', 'reticle', 'ammo', 'dbg', 'hitmark', 'zoneL', 'zoneR', 'setPanel', 'assistBtn', 'autoBtn', 'sprintTag'];
    for (var i = 0; i < ids.length; i++) this.els[ids[i]] = document.getElementById(ids[i]);
    var self = this;
    document.getElementById('btnSet').addEventListener('pointerdown', function (e) {
      e.stopPropagation(); e.preventDefault();
      var p = self.els.setPanel; p.classList.toggle('open');
    }, { passive: false });
    this.els.assistBtn.addEventListener('pointerdown', function (e) {
      e.stopPropagation(); e.preventDefault();
      SET.assist = (SET.assist + 1) % 3; self.els.assistBtn.textContent = 'エイムアシスト：' + ASSIST_LEVELS[SET.assist].name;
    }, { passive: false });
    this.els.autoBtn.addEventListener('pointerdown', function (e) {
      e.stopPropagation(); e.preventDefault();
      SET.autoFire = !SET.autoFire; self.els.autoBtn.textContent = 'オートファイア：' + (SET.autoFire ? 'ON' : 'OFF');
    }, { passive: false });
    document.getElementById('dbgBtn').addEventListener('pointerdown', function (e) {
      e.stopPropagation(); e.preventDefault();
      SET.debug = !SET.debug;
      self.els.dbg.style.display = SET.debug ? 'block' : 'none';
      self.els.zoneL.style.display = self.els.zoneR.style.display = SET.debug ? 'block' : 'none';
    }, { passive: false });
    this.els.assistBtn.textContent = 'エイムアシスト：' + ASSIST_LEVELS[SET.assist].name;
    this.els.autoBtn.textContent = 'オートファイア：' + (SET.autoFire ? 'ON' : 'OFF');
    this.resize();
  },
  resize: function () {
    var W = window.innerWidth, H = window.innerHeight;
    this.stickR = clamp(Math.min(W, H) * 0.155, 46, 78);
    RECTS.fire = this.els.btnFire.getBoundingClientRect();
    RECTS.act = this.els.btnAct.getBoundingClientRect();
    // §6 準拠チェック：操作要素が画面下35%・左右各45%幅の内側にあるか
    var okY = RECTS.fire.top >= H * 0.65 && RECTS.act.top >= H * 0.65;
    var okX = RECTS.fire.left >= W * 0.55 && RECTS.act.left >= W * 0.55;
    METRICS.uiOk = okY && okX;
    METRICS.uiFire = RECTS.fire; METRICS.uiAct = RECTS.act;
  },
  hitMark: function (head) {
    var h = this.els.hitmark;
    h.className = 'hm ' + (head ? 'head' : 'body');
    h.style.animation = 'none'; void h.offsetWidth; h.style.animation = '';
  },
  frame: function () {
    var e = this.els;
    // スティック
    if (IN.stick.on) {
      var W = window.innerWidth, H = window.innerHeight, R = this.stickR;
      // 描画原点は「画面下35%・左45%幅」の内側へ寄せる（指が戦況を隠さない）
      var ox = clamp(IN.stick.ox, R + 6, W * 0.45 - R - 6);
      var oy = clamp(IN.stick.oy, H * 0.65 + R + 6, H - R - 6);
      e.stickBase.style.display = 'block';
      e.stickBase.style.transform = 'translate(' + (ox - R) + 'px,' + (oy - R) + 'px)';
      e.stickBase.style.width = e.stickBase.style.height = (R * 2) + 'px';
      e.stickKnob.style.display = 'block';
      e.stickKnob.style.transform = 'translate(' + (ox + IN.stick.x * R * 0.72 - R * 0.34) + 'px,' + (oy - IN.stick.y * R * 0.72 - R * 0.34) + 'px)';
      e.stickKnob.style.width = e.stickKnob.style.height = (R * 0.68) + 'px';
    } else { e.stickBase.style.display = 'none'; e.stickKnob.style.display = 'none'; }

    // アクションボタンの文脈ラベル（今押したら何が起きるかを常に表示する）
    var lab = '遮蔽';
    if (P.state === ST.COVER) {
      if (IN.stick.mag > 0.35) {
        lab = (P.face.low && IN.stick.y > 0.50 && Math.abs(IN.stick.x) < 0.60 &&
          vaultTargetFor(-P.face.nx, -P.face.nz)) ? '乗り越え' : 'ロール';
      } else lab = '離脱';
    } else if (P.state === ST.VAULT) lab = '乗り越え';
    else if (P.state === ST.FREE) {
      if (IN.stick.mag > 0.35 && findVault(IN.stick.x, IN.stick.y)) lab = '乗り越え';
      else if (P.sprint || IN.stick.mag > 0.25) lab = 'ダッシュ';
    }
    e.actLabel.textContent = lab;
    e.btnAct.classList.toggle('down', IN.act.on);
    e.btnFire.classList.toggle('down', IN.fire.on);
    e.btnFire.classList.toggle('locked', !canFire());

    // レティクル：拡散を目に見せる（当たらない理由を画面で伝える）
    var sp = currentSpread();
    var px = Math.tan(sp) / Math.tan(camera.fov * DEG / 2) * (window.innerHeight * 0.5);
    e.reticle.style.setProperty('--s', (6 + px) + 'px');
    // レティクルは「撃てない状態」を伝えるために消す。リロード中は消さない。
    // ブラインドファイア中は消さず、大きく開いた形で「狙えていない」ことを見せる。
    var bl = isBlind();
    var hideRet = P.sprint || P.state === ST.ROLL || P.state === ST.SWAP || P.state === ST.VAULT ||
      (P.state === ST.COVER && P.peek < 0.5 && !bl) || P.state === ST.TOCOVER;
    e.reticle.classList.toggle('hide', hideRet);
    e.reticle.classList.toggle('lock', !!aimTarget && !bl);
    e.reticle.classList.toggle('blind', bl);

    e.sprintTag.style.opacity = P.sprint ? '1' : '0';
    e.ammo.textContent = P.reloadT > 0 ? 'RELOAD' : (P.ammo + ' / ' + CFG.fire.mag);
    // 残弾僅少はCSSからは判定できない（textContentを読めない）ので状態をクラスで渡す
    e.ammo.classList.toggle('low', P.reloadT <= 0 && P.ammo <= 8);
    e.ammo.classList.toggle('reloading', P.reloadT > 0);

    if (SET.debug) {
      e.dbg.innerHTML =
        METRICS.fps.toFixed(0) + ' fps &nbsp; ' + METRICS.ms.toFixed(1) + ' ms<br>' +
        'draw ' + METRICS.calls + ' &nbsp; tri ' + (METRICS.tris / 1000).toFixed(1) + 'k<br>' +
        '入力遅延 ' + METRICS.latency.toFixed(1) + ' ms<br>' +
        'state ' + P.state + (P.sprint ? '+SPRINT' : '') + ' peek ' + P.peek.toFixed(2) +
        (P.blindT > 0.01 ? ' blind ' + P.blindT.toFixed(2) : '') + '<br>' +
        'assist ' + assistScale().toFixed(2) + (aimTarget ? ' [LOCK]' : '') +
        ' 露出 ' + exposure().toFixed(2) + '<br>' +
        'UI領域 ' + (METRICS.uiOk ? 'OK' : 'NG');
    }
  }
};

/* =============================================================================
   MAIN LOOP
   ========================================================================== */
var lastT = 0, fpsAcc = 0, fpsN = 0, paused = false;

function resize() {
  var W = window.innerWidth, H = window.innerHeight;
  renderer.setSize(W, H, false);
  if (POST && POST.setSize) POST.setSize(W, H);
  camera.aspect = W / H; camera.updateProjectionMatrix();
  UI.resize();
  document.getElementById('rotate').style.display = (W < H) ? 'flex' : 'none';
}

function frame(now) {
  requestAnimationFrame(frame);
  var dt = lastT ? (now - lastT) / 1000 : 0.016;
  lastT = now;
  dt = Math.min(dt, 0.1);

  // paused は検証専用。一瞬の状態（乗り越えの滞空など）を正確に撮るために止める。
  if (!paused) {
    update(dt); FX.step(dt);
    if (SKY && SKY.update) SKY.update(dt, camera);
    if (LIGHTS && LIGHTS.update) LIGHTS.update(dt);
    if (SFX) SFX.setListener(camera.position.x, camera.position.y, camera.position.z, CAM.yaw);
  }
  syncRig();
  UI.frame();
  // ポストは複数回 render するので、自動リセットのままだと最後のパスの値しか残らない。
  // フレーム頭で自分でリセットし、全パスの合計を数える（§12の予算はこれで見る）。
  renderer.info.autoReset = false;
  renderer.info.reset();
  if (POST && POST.render) POST.render(); else renderer.render(scene, camera);

  METRICS.calls = renderer.info.render.calls;
  METRICS.tris = renderer.info.render.triangles;
  fpsAcc += dt; fpsN++;
  if (fpsAcc > 0.35) { METRICS.fps = fpsN / fpsAcc; METRICS.ms = fpsAcc / fpsN * 1000; fpsAcc = 0; fpsN = 0; }
  if (latencyMark > 0) { METRICS.latency = performance.now() - latencyMark; latencyMark = -1; }
}

function boot() {
  buildWorldData();
  for (var i = 0; i < DUMMIES.length; i++) enemies.push(makeEnemy(DUMMIES[i].x, DUMMIES[i].z));
  initRender();
  UI.init();
  bindInput(document.getElementById('input'));
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', function () { setTimeout(resize, 120); });
  resize();
  document.getElementById('boot').style.display = 'none';
  requestAnimationFrame(frame);

  /* --- 検証用フック（自動テストから駆動する） ------------------------ */
  window.__ASHLINE = {
    P: P, CAM: CAM, IN: IN, CFG: CFG, SET: SET, METRICS: METRICS,
    enemies: enemies, covers: COVERS, faces: faces,
    ST: ST,
    tick: function (dt, n) { n = n || 1; for (var k = 0; k < n; k++) { update(dt); FX.step(dt); } },
    pause: function (v) { paused = !!v; },
    render: function () {
      syncRig(); UI.frame();
      renderer.info.autoReset = false; renderer.info.reset();
      if (POST && POST.render) POST.render(); else renderer.render(scene, camera);
      METRICS.calls = renderer.info.render.calls; METRICS.tris = renderer.info.render.triangles;
    },
    setStick: function (x, y) {
      var m = Math.min(1, Math.hypot(x, y));
      IN.stick.on = m > 0; IN.stick.x = x; IN.stick.y = y; IN.stick.mag = m;
    },
    setFire: function (v) { IN.fire.on = !!v; },
    pressAct: function () { IN.act.on = true; IN.act.edge = true; },
    releaseAct: function () { IN.act.on = false; },
    setLook: function (dx, dy) { IN.look.dx += dx; IN.look.dy += dy; },
    /* 検証用：レティクルをワールド座標へ向ける（カメラ位置がヨーに依存するので数回反復） */
    aimAt: function (x, y, z) {
      var retOff = Math.atan(CFG.cam.reticleNdcY * Math.tan(camera.fov * DEG / 2));
      for (var i = 0; i < 5; i++) {
        var dx = x - camera.position.x, dy = y - camera.position.y, dz = z - camera.position.z;
        CAM.yaw = Math.atan2(-dx, -dz);
        CAM.pitch = clamp(Math.atan2(dy, Math.hypot(dx, dz)) - retOff, CFG.cam.pitchMin, CFG.cam.pitchMax);
        update(1 / 60);
      }
    },
    healEnemies: function () {
      for (var i = 0; i < enemies.length; i++) { enemies[i].hp = 100; enemies[i].dead = false; enemies[i].fall = 0; }
    },
    reload: function () { P.ammo = CFG.fire.mag; P.reloadT = 0; P.fireCd = 0; },
    teleport: function (x, z, yaw) {
      P.x = x; P.y = 0; P.z = z; P.vx = 0; P.vz = 0; P.state = ST.FREE; P.face = null;
      P.peek = 0; P.peekMode = 0; P.sprint = false; P.blindT = 0; P.landDip = 0;
      if (yaw !== undefined) { P.yaw = yaw; CAM.yaw = yaw; }
      CAM.px = x; CAM.pz = z;
    },
    state: function () {
      return {
        state: P.state, sprint: P.sprint, x: P.x, y: P.y, z: P.z, yaw: P.yaw,
        peek: P.peek, peekMode: P.peekMode, peekSide: P.peekSide,
        blind: P.blindT, isBlind: isBlind(), exposure: exposure(),
        vaultTop: P.vaultTop, landDip: P.landDip,
        t: P.t, coverLow: P.face ? P.face.low : null,
        tMax: P.face ? (coverAnchor(P.face, P.t, _anc), 1 - _anc.minT) : null,
        speed: Math.hypot(P.vx, P.vz), ammo: P.ammo, reload: P.reloadT,
        camYaw: CAM.yaw, camPitch: CAM.pitch, fov: CAM.fov, coverBlend: CAM.coverBlend,
        assist: assistScale(), canFire: canFire(), spread: currentSpread(),
        snapMaxDeg: snapMaxRad() / DEG, assistLevel: SET.assist, lastShot: lastShot,
        target: aimTarget ? enemies.indexOf(aimTarget) : -1,
        enemyHp: enemies.map(function (e) { return e.dead ? 0 : e.hp; }),
        hitstop: hitstop, calls: METRICS.calls, tris: METRICS.tris, uiOk: METRICS.uiOk,
        camPos: { x: camera.position.x, y: camera.position.y, z: camera.position.z }
      };
    }
  };
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();

})();

// ==========================================================
//  イッヌ大作戦 ～ ダークワンワン大帝を倒せ ～
//  Metal Slug-style side-scrolling action shooter
// ==========================================================
'use strict';

// ----- Canvas & sizing ------------------------------------
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const VW = 800;
const VH = 450;
canvas.width = VW;
canvas.height = VH;

function fitCanvas() {
  const wrap = document.getElementById('game-wrap');
  const w = wrap.clientWidth;
  const h = wrap.clientHeight;
  const ratio = VW / VH;
  let cw, ch;
  if (w / h > ratio) { ch = h; cw = h * ratio; }
  else { cw = w; ch = w / ratio; }
  canvas.style.width  = cw + 'px';
  canvas.style.height = ch + 'px';
}
window.addEventListener('resize', fitCanvas);
fitCanvas();

// ----- Audio (lightweight WebAudio beeps) -----------------
let audioCtx = null;
function ac() {
  if (!audioCtx) {
    try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
    catch (e) { return null; }
  }
  return audioCtx;
}
function blip(freq, dur, type='square', vol=0.06) {
  const a = ac(); if (!a) return;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.value = vol;
  g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + dur);
  o.connect(g); g.connect(a.destination);
  o.start();
  o.stop(a.currentTime + dur);
}
const SFX = {
  shoot:  () => blip(880, 0.06, 'square', 0.05),
  hit:    () => blip(220, 0.08, 'sawtooth', 0.06),
  enemyDie: () => { blip(660, 0.05, 'square', 0.05); setTimeout(()=>blip(440,0.07,'square',0.05), 50); },
  bomb:   () => { blip(120, 0.25, 'sawtooth', 0.1); setTimeout(()=>blip(80,0.25,'square',0.08), 80); },
  jump:   () => blip(540, 0.08, 'triangle', 0.04),
  damage: () => blip(180, 0.18, 'sawtooth', 0.08),
  bossHit: () => { blip(150, 0.06, 'square', 0.07); blip(300, 0.06, 'square', 0.05); },
  bossRoar: () => { blip(80, 0.4, 'sawtooth', 0.1); setTimeout(()=>blip(60,0.5,'sawtooth',0.08), 100); },
  bite:   () => { blip(420, 0.05, 'square', 0.06); setTimeout(()=>blip(260,0.06,'sawtooth',0.06), 30); },
  win:    () => { [523, 659, 784, 1046].forEach((f,i)=>setTimeout(()=>blip(f,0.18,'square',0.06), i*120)); },
  lose:   () => { [440, 392, 349, 262].forEach((f,i)=>setTimeout(()=>blip(f,0.25,'sawtooth',0.06), i*150)); },
};

// ----- Input ----------------------------------------------
const keys = { left:false, right:false, aimUp:false, aimDown:false, jump:false, shoot:false, bomb:false, melee:false };
const justPressed = { jump:false, bomb:false, melee:false };

function setKey(name, v) {
  if (v && !keys[name]) {
    if (name === 'jump')  justPressed.jump = true;
    if (name === 'bomb')  justPressed.bomb = true;
    if (name === 'melee') justPressed.melee = true;
  }
  keys[name] = v;
}

window.addEventListener('keydown', (e) => {
  switch (e.code) {
    case 'ArrowLeft': case 'KeyA': setKey('left', true); break;
    case 'ArrowRight': case 'KeyD': setKey('right', true); break;
    case 'ArrowUp': case 'KeyW': setKey('aimUp', true); e.preventDefault(); break;
    case 'ArrowDown': case 'KeyS': setKey('aimDown', true); e.preventDefault(); break;
    case 'KeyZ': case 'Space': setKey('jump', true); e.preventDefault(); break;
    case 'KeyX': case 'KeyJ': setKey('shoot', true); break;
    case 'KeyC': case 'KeyK': setKey('bomb', true); break;
    case 'KeyV': case 'KeyL': setKey('melee', true); break;
  }
});
window.addEventListener('keyup', (e) => {
  switch (e.code) {
    case 'ArrowLeft': case 'KeyA': setKey('left', false); break;
    case 'ArrowRight': case 'KeyD': setKey('right', false); break;
    case 'ArrowUp': case 'KeyW': setKey('aimUp', false); break;
    case 'ArrowDown': case 'KeyS': setKey('aimDown', false); break;
    case 'KeyZ': case 'Space': setKey('jump', false); break;
    case 'KeyX': case 'KeyJ': setKey('shoot', false); break;
    case 'KeyC': case 'KeyK': setKey('bomb', false); break;
    case 'KeyV': case 'KeyL': setKey('melee', false); break;
  }
});

// Touch buttons via pointer events (handles multi-touch and avoids mouseleave bugs)
const tbtns = document.querySelectorAll('.tbtn');
tbtns.forEach(btn => {
  const k = btn.dataset.key;
  btn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    try { btn.setPointerCapture(e.pointerId); } catch (_) {}
    setKey(k, true);
    btn.classList.add('active');
    ac();
  });
  const release = (e) => {
    setKey(k, false);
    btn.classList.remove('active');
  };
  btn.addEventListener('pointerup', release);
  btn.addEventListener('pointercancel', release);
  btn.addEventListener('lostpointercapture', release);
  // Block context-menu on long press
  btn.addEventListener('contextmenu', (e) => e.preventDefault());
});

// Virtual joystick for movement + aim (8-way)
(function setupJoystick() {
  const stick = document.getElementById('vstick');
  const knob  = document.getElementById('vstick-knob');
  if (!stick || !knob) return;
  let activeId = null;
  let center = { x: 0, y: 0 };
  const RADIUS = 60;
  const DEADZONE = 16;

  function recalc() {
    const r = stick.getBoundingClientRect();
    center = { x: r.left + r.width/2, y: r.top + r.height/2 };
  }
  function reset() {
    knob.style.transform = 'translate(-50%, -50%)';
    setKey('left', false);  setKey('right', false);
    setKey('aimUp', false); setKey('aimDown', false);
  }
  function update(x, y) {
    let dx = x - center.x, dy = y - center.y;
    const dist = Math.hypot(dx, dy);
    let kx = dx, ky = dy;
    if (dist > RADIUS) { kx = dx / dist * RADIUS; ky = dy / dist * RADIUS; }
    knob.style.transform = `translate(calc(-50% + ${kx}px), calc(-50% + ${ky}px))`;
    setKey('left', false);  setKey('right', false);
    setKey('aimUp', false); setKey('aimDown', false);
    if (dist < DEADZONE) return;
    let ang = Math.atan2(dy, dx);
    if (ang < 0) ang += Math.PI * 2;
    const oct = Math.floor((ang + Math.PI/8) / (Math.PI/4)) % 8;
    switch (oct) {
      case 0: setKey('right', true); break;
      case 1: setKey('right', true); setKey('aimDown', true); break;
      case 2: setKey('aimDown', true); break;
      case 3: setKey('left', true);  setKey('aimDown', true); break;
      case 4: setKey('left', true); break;
      case 5: setKey('left', true);  setKey('aimUp', true); break;
      case 6: setKey('aimUp', true); break;
      case 7: setKey('right', true); setKey('aimUp', true); break;
    }
  }
  stick.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    try { stick.setPointerCapture(e.pointerId); } catch (_) {}
    activeId = e.pointerId;
    recalc();
    ac();
    update(e.clientX, e.clientY);
  });
  stick.addEventListener('pointermove', (e) => {
    if (e.pointerId !== activeId) return;
    e.preventDefault();
    update(e.clientX, e.clientY);
  });
  const endStick = (e) => {
    if (e.pointerId !== activeId) return;
    activeId = null;
    reset();
  };
  stick.addEventListener('pointerup', endStick);
  stick.addEventListener('pointercancel', endStick);
  stick.addEventListener('lostpointercapture', endStick);
  stick.addEventListener('contextmenu', (e) => e.preventDefault());
})();

const isTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);

// ----- Game constants -------------------------------------
const GRAVITY = 0.55;
const BASE_GROUND = 380;
const BOSS_ARENA_START = 5000;

// ----- Terrain --------------------------------------------
// Each segment is a solid block from (x0..x1) at top-y, extending down.
const terrain = [
  { x0: -200, x1: 1100, top: 380 },
  { x0: 1180, x1: 1500, top: 380 },
  { x0: 1500, x1: 1700, top: 320 }, // plateau
  { x0: 1700, x1: 1900, top: 380 },
  { x0: 2000, x1: 2400, top: 380 },
  { x0: 2400, x1: 2520, top: 348 }, // small hill
  { x0: 2520, x1: 2700, top: 380 },
  { x0: 2780, x1: 3100, top: 380 },
  { x0: 3100, x1: 3340, top: 280 }, // tall mountain
  { x0: 3340, x1: 3500, top: 380 },
  { x0: 3600, x1: 4000, top: 380 },
  { x0: 4000, x1: 4170, top: 320 }, // hill
  { x0: 4170, x1: 4400, top: 380 },
  { x0: 4500, x1: 4900, top: 380 },
  { x0: 4900, x1: 9000, top: 380 }, // boss arena and beyond
];

function groundTopAt(x) {
  for (const t of terrain) {
    if (x >= t.x0 && x < t.x1) return t.top;
  }
  return null;
}

function actorRect(a) { return { x:a.x, y:a.y, w:a.w, h:a.h }; }
function rectsOverlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}
function terrainRect(t) {
  return { x: t.x0, y: t.top, w: t.x1 - t.x0, h: VH + 200 - t.top };
}

// Move actor with separate axis collision; sets actor.onGround, actor.bumpedX
function moveActor(a) {
  a.bumpedX = false;
  a.onGround = false;

  // Horizontal
  a.x += a.vx;
  for (const t of terrain) {
    const ar = actorRect(a);
    const tr = terrainRect(t);
    if (rectsOverlap(ar, tr)) {
      if (a.vx > 0) { a.x = t.x0 - a.w; a.bumpedX = true; }
      else if (a.vx < 0) { a.x = t.x1; a.bumpedX = true; }
    }
  }

  // Vertical
  a.y += a.vy;
  for (const t of terrain) {
    const ar = actorRect(a);
    const tr = terrainRect(t);
    if (rectsOverlap(ar, tr)) {
      if (a.vy > 0) {
        a.y = t.top - a.h;
        a.vy = 0;
        a.onGround = true;
      } else if (a.vy < 0) {
        a.y = tr.y + tr.h;
        a.vy = 0;
      }
    }
  }
}

// ----- State ----------------------------------------------
let state = 'title';
let camX = 0;
let score = 0;
let frame = 0;
let announceTimer = 0;

const bullets = [];
const ebullets = [];
const enemies = [];
const bombs = [];
const particles = [];
const pickups = [];

let boss = null;
let bossTriggered = false;

// ----- Helpers --------------------------------------------
function announce(text, dur=90) {
  const el = document.getElementById('announce');
  el.textContent = text;
  el.classList.add('show');
  announceTimer = dur;
}
function spawnParticles(x, y, n, color, speed=3) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const s = Math.random() * speed + 1;
    particles.push({ x, y, vx: Math.cos(a)*s, vy: Math.sin(a)*s - 1, life: 30, color });
  }
}
function clamp(v,a,b) { return Math.max(a, Math.min(b, v)); }

// ----- Player ---------------------------------------------
const player = {
  x: 100, y: BASE_GROUND - 36, w: 30, h: 36,
  vx: 0, vy: 0,
  dir: 1,
  aimX: 1, aimY: 0,
  hp: 100, maxHp: 100,
  bombs: 3,
  cooldown: 0,
  bombCool: 0,
  meleeCool: 0,
  meleeTimer: 0,
  iframes: 0,
  onGround: true,
  bumpedX: false,
  walkAnim: 0,
  lastSafeX: 100, lastSafeY: BASE_GROUND - 36,
  reset() {
    this.x = 100; this.y = BASE_GROUND - this.h;
    this.vx = 0; this.vy = 0; this.dir = 1;
    this.aimX = 1; this.aimY = 0;
    this.hp = this.maxHp; this.bombs = 3;
    this.cooldown = 0; this.bombCool = 0;
    this.meleeCool = 0; this.meleeTimer = 0;
    this.iframes = 0; this.onGround = true; this.bumpedX = false;
    this.walkAnim = 0;
    this.lastSafeX = 100; this.lastSafeY = BASE_GROUND - this.h;
  },
};

function computeAim() {
  let ax = 0, ay = 0;
  if (keys.left)    ax -= 1;
  if (keys.right)   ax += 1;
  if (keys.aimUp)   ay -= 1;
  if (keys.aimDown) ay += 1;
  if (ax === 0 && ay === 0) {
    ax = player.dir; ay = 0;
  } else {
    // Special case: aimDown alone while on ground -> point straight forward
    if (ax === 0 && ay > 0 && player.onGround) {
      ax = player.dir; ay = 0;
    }
  }
  const len = Math.hypot(ax, ay) || 1;
  player.aimX = ax / len;
  player.aimY = ay / len;
}

function playerUpdate() {
  // Horizontal velocity
  let move = 0;
  if (keys.left)  move -= 1;
  if (keys.right) move += 1;
  player.vx = move * 3.2;
  if (move !== 0) {
    player.dir = move;
    player.walkAnim += 0.25;
  } else {
    player.walkAnim = 0;
  }

  // Melee forward lunge: override vx during the start of the bite
  if (player.meleeTimer > 10) {
    player.vx = player.dir * 5.2;
  }

  // Gravity
  player.vy += GRAVITY;
  if (player.vy > 14) player.vy = 14;

  // Move with terrain collision
  moveActor(player);

  // Don't go past camera left edge
  if (player.x < camX + 6) player.x = camX + 6;

  // Track last safe ground position for fall recovery
  if (player.onGround) {
    const top = groundTopAt(player.x + player.w/2);
    if (top !== null) {
      player.lastSafeX = player.x;
      player.lastSafeY = top - player.h;
    }
  }

  // Fall recovery
  if (player.y > VH + 80) {
    damagePlayer(25);
    if (player.hp > 0) {
      player.x = player.lastSafeX;
      player.y = player.lastSafeY - 60;
      player.vx = 0; player.vy = 0;
      player.iframes = 60;
    }
  }

  // Jump
  if (justPressed.jump && player.onGround) {
    player.vy = -11;
    player.onGround = false;
    SFX.jump();
  }
  justPressed.jump = false;

  // Aim
  computeAim();

  // Shoot
  if (player.cooldown > 0) player.cooldown--;
  if (keys.shoot && player.cooldown <= 0 && player.meleeTimer <= 0) {
    const speed = 9.5;
    const muzzleX = player.x + player.w/2 + player.aimX * 14;
    const muzzleY = player.y + player.h*0.45 + player.aimY * 12;
    bullets.push({
      x: muzzleX - 5, y: muzzleY - 2,
      vx: player.aimX * speed, vy: player.aimY * speed,
      life: 70, w: 10, h: 4, ang: Math.atan2(player.aimY, player.aimX),
    });
    player.cooldown = 7;
    SFX.shoot();
    spawnParticles(muzzleX, muzzleY, 3, '#ffeeaa', 1);
  }

  // Bomb
  if (player.bombCool > 0) player.bombCool--;
  if (justPressed.bomb && player.bombs > 0 && player.bombCool <= 0) {
    bombs.push({
      x: player.x + player.w/2, y: player.y + 8,
      vx: 4.5 * player.dir, vy: -7,
      life: 240, w: 14, h: 12,
    });
    player.bombs--;
    player.bombCool = 20;
  }
  justPressed.bomb = false;

  // Melee
  if (player.meleeCool > 0) player.meleeCool--;
  if (player.meleeTimer > 0) {
    player.meleeTimer--;
    // Active hitbox during meleeTimer 14..4
    if (player.meleeTimer >= 4 && player.meleeTimer <= 14) {
      const hb = {
        x: player.x + (player.dir > 0 ? player.w - 6 : -36),
        y: player.y + 2,
        w: 42, h: player.h - 2,
      };
      // Damage enemies
      for (const e of enemies) {
        if (!e.alive || (e.iframes||0) > 0) continue;
        if (rectsOverlap(hb, e)) {
          e.hp -= 3;
          e.iframes = 18;
          // Knockback / throw
          e.vx = player.dir * 5.5;
          e.vy = -5.5;
          spawnParticles(e.x + e.w/2, e.y + e.h/2, 10, '#ffcc55');
          SFX.bite();
          if (e.hp <= 0) {
            e.alive = false;
            score += 120;
            spawnParticles(e.x + e.w/2, e.y + e.h/2, 16, '#ffaa66');
            SFX.enemyDie();
            if (Math.random() < 0.18) {
              pickups.push({ x: e.x + e.w/2 - 8, y: e.y + e.h/2, w: 16, h: 16, vy: -3, kind: 'bone' });
            }
          }
        }
      }
      // Damage boss
      if (boss && boss.state !== 'enter' && rectsOverlap(hb, boss)) {
        if ((boss.iframes||0) <= 0) {
          boss.hp -= 4;
          boss.iframes = 8;
          spawnParticles(player.x + player.w, player.y + player.h/2, 8, '#ff66aa');
          SFX.bossHit();
        }
      }
    }
  }
  if (justPressed.melee && player.meleeCool <= 0 && player.meleeTimer <= 0) {
    player.meleeTimer = 16;
    player.meleeCool = 22;
    SFX.bite();
  }
  justPressed.melee = false;

  // Camera scroll
  const playerScreenX = player.x - camX;
  if (playerScreenX > VW * 0.5 && camX < BOSS_ARENA_START) {
    camX = Math.min(BOSS_ARENA_START, player.x - VW * 0.5);
  }
  if (camX < 0) camX = 0;
  if (camX >= BOSS_ARENA_START) {
    if (player.x + player.w > camX + VW - 20) player.x = camX + VW - 20 - player.w;
  }

  if (player.iframes > 0) player.iframes--;

  if (!bossTriggered && camX >= BOSS_ARENA_START - 1) {
    triggerBoss();
  }
}

function damagePlayer(dmg) {
  if (player.iframes > 0) return;
  player.hp -= dmg;
  player.iframes = 60;
  SFX.damage();
  const wrap = document.getElementById('game-wrap');
  wrap.classList.remove('damage-flash');
  void wrap.offsetWidth;
  wrap.classList.add('damage-flash');
  if (player.hp <= 0) {
    player.hp = 0;
    gameOver(false);
  }
}

// ----- Drawing helpers (cute dog/cat sprites) -------------
function drawDog(x, y, w, h, opts={}) {
  const c = opts.color || '#e8b870';
  const c2 = opts.color2 || '#fff5dd';
  const dir = opts.dir || 1;
  const wag = opts.wag || 0;
  const walk = opts.walk || 0;
  ctx.save();
  ctx.translate(x + w/2, y);
  ctx.scale(dir, 1);

  // Tail
  ctx.strokeStyle = c;
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-w*0.45, h*0.55);
  ctx.quadraticCurveTo(-w*0.62, h*0.30 + Math.sin(wag)*4, -w*0.45, h*0.10);
  ctx.stroke();

  // Body
  ctx.fillStyle = c;
  ctx.beginPath();
  ctx.ellipse(0, h*0.62, w*0.40, h*0.30, 0, 0, Math.PI*2);
  ctx.fill();
  ctx.fillStyle = c2;
  ctx.beginPath();
  ctx.ellipse(0, h*0.72, w*0.30, h*0.18, 0, 0, Math.PI*2);
  ctx.fill();

  // Legs (animated)
  ctx.fillStyle = c;
  const swing = Math.sin(walk) * 4;
  const swing2 = Math.sin(walk + Math.PI) * 4;
  ctx.fillRect(-w*0.30, h*0.85 + Math.max(0,swing),  6, h*0.20 - Math.max(0,swing));
  ctx.fillRect( w*0.10, h*0.85 + Math.max(0,swing2), 6, h*0.20 - Math.max(0,swing2));
  ctx.fillRect(-w*0.10, h*0.85, 6, h*0.20);
  ctx.fillRect( w*0.22, h*0.85, 6, h*0.20);

  // Head
  ctx.fillStyle = c;
  ctx.beginPath();
  ctx.ellipse(w*0.28, h*0.32, w*0.34, h*0.28, 0, 0, Math.PI*2);
  ctx.fill();
  ctx.fillStyle = c2;
  ctx.beginPath();
  ctx.ellipse(w*0.50, h*0.40, w*0.16, h*0.12, 0, 0, Math.PI*2);
  ctx.fill();

  // Nose
  ctx.fillStyle = '#222';
  ctx.beginPath();
  ctx.ellipse(w*0.62, h*0.36, 3, 2.5, 0, 0, Math.PI*2);
  ctx.fill();

  // Eye
  ctx.fillStyle = '#222';
  ctx.beginPath();
  ctx.arc(w*0.34, h*0.28, 2.4, 0, Math.PI*2);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.fillRect(w*0.34 - 0.5, h*0.27 - 1, 1.2, 1.2);

  // Ear
  ctx.fillStyle = c;
  ctx.beginPath();
  ctx.moveTo(w*0.16, h*0.10);
  ctx.lineTo(w*0.28, h*-0.05);
  ctx.lineTo(w*0.32, h*0.18);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#ff9999';
  ctx.beginPath();
  ctx.moveTo(w*0.20, h*0.08);
  ctx.lineTo(w*0.27, h*0.02);
  ctx.lineTo(w*0.28, h*0.14);
  ctx.closePath();
  ctx.fill();

  // Cheek blush
  ctx.fillStyle = '#ff9988';
  ctx.globalAlpha = 0.6;
  ctx.beginPath();
  ctx.arc(w*0.40, h*0.40, 2, 0, Math.PI*2);
  ctx.fill();
  ctx.globalAlpha = 1;

  if (opts.bandana) {
    ctx.fillStyle = '#3388ff';
    ctx.beginPath();
    ctx.moveTo(w*0.05, h*0.50);
    ctx.lineTo(w*0.55, h*0.50);
    ctx.lineTo(w*0.55, h*0.58);
    ctx.lineTo(w*0.05, h*0.58);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.fillRect(w*0.18, h*0.52, 2, 2);
    ctx.fillRect(w*0.40, h*0.52, 2, 2);
  }

  if (opts.gun) {
    ctx.fillStyle = '#444';
    ctx.fillRect(w*0.55, h*0.42, w*0.30, 4);
    ctx.fillStyle = '#888';
    ctx.fillRect(w*0.85, h*0.41, 3, 6);
  }

  ctx.restore();
}

function drawCat(x, y, w, h, opts={}) {
  const c = opts.color || '#bbbbbb';
  const c2 = opts.color2 || '#ffffff';
  const dir = opts.dir || 1;
  const walk = opts.walk || 0;
  ctx.save();
  ctx.translate(x + w/2, y);
  ctx.scale(dir, 1);

  ctx.strokeStyle = c;
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-w*0.40, h*0.55);
  ctx.quadraticCurveTo(-w*0.65, h*0.30, -w*0.55, h*0.05);
  ctx.stroke();

  ctx.fillStyle = c;
  ctx.beginPath();
  ctx.ellipse(0, h*0.62, w*0.36, h*0.28, 0, 0, Math.PI*2);
  ctx.fill();
  ctx.fillStyle = c2;
  ctx.beginPath();
  ctx.ellipse(0, h*0.72, w*0.24, h*0.16, 0, 0, Math.PI*2);
  ctx.fill();

  ctx.fillStyle = c;
  const ls = Math.sin(walk) * 3;
  ctx.fillRect(-w*0.28, h*0.84 + Math.max(0,ls),  5, h*0.18 - Math.max(0,ls));
  ctx.fillRect( w*0.10, h*0.84 + Math.max(0,-ls), 5, h*0.18 - Math.max(0,-ls));
  ctx.fillRect(-w*0.10, h*0.84, 5, h*0.18);
  ctx.fillRect( w*0.22, h*0.84, 5, h*0.18);

  ctx.fillStyle = c;
  ctx.beginPath();
  ctx.arc(w*0.24, h*0.34, w*0.27, 0, Math.PI*2);
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(w*0.06, h*0.16);
  ctx.lineTo(w*0.16, h*-0.05);
  ctx.lineTo(w*0.22, h*0.18);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(w*0.30, h*0.16);
  ctx.lineTo(w*0.40, h*-0.05);
  ctx.lineTo(w*0.42, h*0.18);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#ff99cc';
  ctx.beginPath();
  ctx.moveTo(w*0.10, h*0.13);
  ctx.lineTo(w*0.16, h*0.02);
  ctx.lineTo(w*0.18, h*0.14);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = '#222';
  ctx.beginPath(); ctx.arc(w*0.16, h*0.32, 2, 0, Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.arc(w*0.32, h*0.32, 2, 0, Math.PI*2); ctx.fill();
  ctx.fillStyle = '#ff7799';
  ctx.beginPath();
  ctx.moveTo(w*0.24, h*0.40);
  ctx.lineTo(w*0.20, h*0.43);
  ctx.lineTo(w*0.28, h*0.43);
  ctx.closePath();
  ctx.fill();

  if (opts.bow) {
    ctx.fillStyle = '#ff66aa';
    ctx.beginPath();
    ctx.moveTo(w*0.05, h*0.05);
    ctx.lineTo(w*-0.05, h*-0.02);
    ctx.lineTo(w*-0.05, h*0.12);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(w*0.05, h*0.05);
    ctx.lineTo(w*0.15, h*-0.02);
    ctx.lineTo(w*0.15, h*0.12);
    ctx.closePath();
    ctx.fill();
  }

  if (opts.gun) {
    ctx.fillStyle = '#333';
    ctx.fillRect(w*0.40, h*0.50, w*0.30, 4);
    ctx.fillStyle = '#888';
    ctx.fillRect(w*0.70, h*0.49, 3, 6);
  }

  ctx.restore();
}

// ----- Enemies --------------------------------------------
function spawnEnemy(type, x, y) {
  const e = {
    type, x, y, vx: 0, vy: 0, w: 28, h: 30, hp: 1,
    walk: 0, shootCool: 0, dir: -1, alive: true,
    onGround: false, bumpedX: false, iframes: 0,
    jumpCool: 30,
  };
  switch (type) {
    case 'pug':
      e.w = 30; e.h = 28; e.hp = 1; e.vx = -1.6; break;
    case 'cat':
      e.w = 28; e.h = 32; e.hp = 2; e.shootCool = 60 + Math.random()*60; e.vx = 0; break;
    case 'tank':
      e.w = 40; e.h = 38; e.hp = 6; e.vx = -0.8; e.shootCool = 80 + Math.random()*60; break;
    case 'birb':
      e.w = 34; e.h = 26; e.hp = 1; e.vx = -3.2; e.flyY = y; e.t = 0; break;
    case 'jumper':
      e.w = 26; e.h = 26; e.hp = 1; e.vx = -1.5; e.jumpCool = 30; break;
  }
  enemies.push(e);
  return e;
}

function updateEnemy(e) {
  if (!e.alive) return;
  if (e.iframes > 0) e.iframes--;

  if (e.type === 'birb') {
    // Free flying
    e.t = (e.t || 0) + 1;
    e.x += e.vx;
    e.y = e.flyY + Math.sin(e.t * 0.08) * 18;
    if (Math.random() < 0.014 && Math.abs(e.x - player.x) < 240) {
      ebullets.push({
        x: e.x + e.w/2, y: e.y + e.h,
        vx: 0, vy: 4,
        w: 8, h: 8, life: 140, color: '#88ddff',
      });
    }
    if (e.x + e.w < camX - 80 || e.x > camX + VW + 200) e.alive = false;
    if (rectsOverlap(player, e)) handlePlayerEnemyTouch(e);
    return;
  }

  // Knockback decays
  if (e.iframes > 12) {
    // strong knockback frame; nothing special, gravity handles
  } else {
    // restore intent vx after knockback ends
    if (e.iframes <= 0) {
      // base movement
      switch (e.type) {
        case 'pug': e.vx = -1.6; break;
        case 'cat': e.vx = 0; break;
        case 'tank': e.vx = -0.8; break;
        case 'jumper': e.vx = -1.5; break;
      }
    }
  }

  // gravity
  e.vy += GRAVITY;
  if (e.vy > 14) e.vy = 14;

  moveActor(e);

  // Walking AI: jump if bumped a wall while on ground
  if (e.onGround && e.bumpedX && (e.type === 'pug' || e.type === 'tank' || e.type === 'jumper')) {
    e.vy = -8.5;
  }

  // type behavior
  if (e.type === 'pug')    { e.walk += 0.25; }
  else if (e.type === 'tank')  { e.walk += 0.12; }
  else if (e.type === 'jumper') {
    e.walk += 0.25;
    e.jumpCool--;
    if (e.onGround && e.jumpCool <= 0) {
      e.vy = -8.5;
      e.jumpCool = 50 + Math.random()*30;
    }
  }
  else if (e.type === 'cat') {
    e.walk += 0.05;
    e.shootCool--;
    if (e.shootCool <= 0 && Math.abs(e.x - player.x) < 380) {
      const dx = (player.x + player.w/2) - (e.x + e.w/2);
      const dy = (player.y + player.h/2) - (e.y + e.h/2);
      const dist = Math.hypot(dx,dy) || 1;
      ebullets.push({
        x: e.x + e.w/2, y: e.y + e.h/2,
        vx: dx/dist * 4, vy: dy/dist * 4,
        w: 9, h: 9, life: 140, color: '#ff66aa',
      });
      e.shootCool = 90 + Math.random()*40;
    }
  }
  if (e.type === 'tank') {
    e.shootCool--;
    if (e.shootCool <= 0) {
      ebullets.push({
        x: e.x, y: e.y + e.h*0.5,
        vx: -3.5, vy: 0,
        w: 10, h: 6, life: 160, color: '#ff8844',
      });
      e.shootCool = 70 + Math.random()*30;
    }
  }

  // Despawn off-screen
  if (e.x + e.w < camX - 100 || e.y > VH + 100) e.alive = false;

  if (rectsOverlap(player, e)) handlePlayerEnemyTouch(e);
}

function handlePlayerEnemyTouch(e) {
  // No contact damage during melee active window
  if (player.meleeTimer >= 4 && player.meleeTimer <= 14) return;
  damagePlayer(15);
  if (e.type !== 'tank') {
    e.hp = 0; e.alive = false;
    spawnParticles(e.x + e.w/2, e.y + e.h/2, 12, '#ff8888');
  }
}

function drawEnemy(e) {
  const x = e.x - camX;
  const y = e.y;
  const blink = e.iframes > 0 && (e.iframes % 4 < 2);
  if (blink) ctx.globalAlpha = 0.5;
  if (e.type === 'pug') {
    drawDog(x, y, e.w, e.h, { color:'#d8a468', color2:'#fff0d8', dir:e.dir, walk:e.walk });
  }
  else if (e.type === 'cat') {
    drawCat(x, y, e.w, e.h, { color:'#888888', color2:'#dddddd', dir:e.dir, walk:e.walk, gun:true, bow:true });
  }
  else if (e.type === 'tank') {
    drawDog(x, y, e.w, e.h, { color:'#8a6644', color2:'#ddc098', dir:e.dir, walk:e.walk, gun:true });
    ctx.save();
    ctx.translate(x + e.w/2, y);
    ctx.scale(e.dir, 1);
    ctx.fillStyle = '#556644';
    ctx.beginPath();
    ctx.arc(e.w*0.18, e.h*0.10, e.w*0.20, Math.PI, 0);
    ctx.fill();
    ctx.fillStyle = '#aa3322';
    ctx.fillRect(e.w*0.10, e.h*-0.02, 8, 4);
    ctx.restore();
  }
  else if (e.type === 'birb') {
    drawCat(x, y, e.w, e.h, { color:'#cccccc', color2:'#ffffff', dir:e.dir, walk:0 });
    const flap = Math.sin(e.t * 0.4) * 6;
    ctx.save();
    ctx.translate(x + e.w/2, y + e.h*0.5);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.ellipse(-e.w*0.15, -e.h*0.10 + flap, 12, 5, 0.4, 0, Math.PI*2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse( e.w*0.15, -e.h*0.10 + flap, 12, 5,-0.4, 0, Math.PI*2);
    ctx.fill();
    ctx.restore();
  }
  else if (e.type === 'jumper') {
    drawDog(x, y, e.w, e.h, { color:'#f4c98a', color2:'#fff5dd', dir:e.dir, walk:e.walk });
  }
  ctx.globalAlpha = 1;
}

// ----- Stage / spawning -----------------------------------
const spawnPlan = [];
function buildStage() {
  spawnPlan.length = 0;
  // Place enemies on flat segments only (avoid walls)
  const list = [
    [380, 'pug'],
    [520, 'pug'],
    [700, 'cat'],
    [860, 'pug'],
    [990, 'jumper'],
    [1050, 'birb'],
    [1300, 'tank'],
    [1380, 'pug'],
    [1450, 'cat'],
    [1620, 'birb'],   // flying over plateau
    [1800, 'cat'],
    [1880, 'birb'],
    [2080, 'pug'],
    [2150, 'tank'],
    [2280, 'pug'], [2330, 'jumper'],
    [2580, 'pug'], [2640, 'pug'],
    [2820, 'cat'], [2900, 'tank'],
    [3080, 'birb'],   // over mountain
    [3380, 'jumper'], [3440, 'pug'],
    [3650, 'tank'], [3720, 'cat'],
    [3820, 'jumper'], [3900, 'pug'],
    [3980, 'birb'], [4050, 'birb'],
    [4220, 'tank'], [4280, 'cat'],
    [4520, 'jumper'], [4580, 'pug'], [4640, 'pug'],
    [4780, 'tank'], [4860, 'cat'],
  ];
  for (const item of list) {
    spawnPlan.push({ x: item[0], type: item[1], spawned: false });
  }
}

function tickSpawns() {
  const trigger = camX + VW + 40;
  for (const sp of spawnPlan) {
    if (!sp.spawned && sp.x < trigger) {
      sp.spawned = true;
      let y;
      if (sp.type === 'birb') y = 130 + Math.random()*100;
      else {
        const top = groundTopAt(sp.x) ?? BASE_GROUND;
        y = top - 40;
      }
      const e = spawnEnemy(sp.type, sp.x, y);
      e.dir = -1;
    }
  }
}

// ----- Boss ------------------------------------------------
function triggerBoss() {
  bossTriggered = true;
  document.getElementById('boss-hud').classList.remove('hidden');
  announce('ダークワンワン大帝 登場！', 120);
  SFX.bossRoar();
  boss = {
    x: BOSS_ARENA_START + VW - 150, y: BASE_GROUND - 130,
    w: 110, h: 130,
    hp: 280, maxHp: 280,
    phase: 1,
    state: 'enter',
    timer: 60,
    vx: 0, vy: 0,
    dir: -1,
    iframes: 0,
    floatT: 0,
    angryFlash: 0,
  };
  camX = BOSS_ARENA_START;
}

function updateBoss() {
  if (!boss) return;
  boss.floatT += 0.04;
  boss.timer--;
  if (boss.iframes > 0) boss.iframes--;
  if (boss.angryFlash > 0) boss.angryFlash--;

  const arenaLeft = BOSS_ARENA_START + 80;
  const arenaRight = BOSS_ARENA_START + VW - boss.w - 30;

  if (boss.state === 'enter') {
    boss.y = BASE_GROUND - boss.h;
    if (boss.timer <= 0) { boss.state = 'idle'; boss.timer = 60; }
  }
  else if (boss.state === 'idle') {
    boss.x += Math.sin(boss.floatT) * 0.6;
    if (boss.timer <= 0) {
      const r = Math.random();
      if (boss.phase === 1) boss.state = (r < 0.5) ? 'pawSlam' : 'minionSummon';
      else if (boss.phase === 2) boss.state = (r < 0.45) ? 'boneShower' : (r < 0.8 ? 'pawSlam' : 'minionSummon');
      else boss.state = (r < 0.4) ? 'rushAttack' : (r < 0.75 ? 'boneShower' : 'minionSummon');
      boss.timer = 60;
    }
  }
  else if (boss.state === 'pawSlam') {
    boss.timer--;
    const px = player.x + player.w/2;
    const bx = boss.x + boss.w/2;
    if (boss.timer > 30) {
      boss.vx = (px > bx ? 1 : -1) * 2.4;
      boss.x += boss.vx;
      boss.dir = (px > bx) ? 1 : -1;
    } else if (boss.timer === 30) {
      SFX.bossRoar();
      for (let i = 0; i < 5; i++) {
        ebullets.push({
          x: boss.x + boss.w/2, y: BASE_GROUND - 14,
          vx: -3 - i*0.5, vy: -2 - Math.random()*2,
          w: 10, h: 10, life: 130, color: '#aa66ff',
        });
        ebullets.push({
          x: boss.x + boss.w/2, y: BASE_GROUND - 14,
          vx: 3 + i*0.5, vy: -2 - Math.random()*2,
          w: 10, h: 10, life: 130, color: '#aa66ff',
        });
      }
      spawnParticles(boss.x + boss.w/2, BASE_GROUND, 24, '#aa66ff', 5);
    }
    if (boss.timer <= 0) { boss.state = 'idle'; boss.timer = 50; }
    boss.x = clamp(boss.x, arenaLeft, arenaRight);
  }
  else if (boss.state === 'minionSummon') {
    boss.timer--;
    if (boss.timer === 40 || boss.timer === 20) {
      const types = ['pug','cat','jumper','birb'];
      const t = types[Math.floor(Math.random()*types.length)];
      const sx = boss.x - 20;
      const sy = (t === 'birb') ? 160 : BASE_GROUND - 30;
      const e = spawnEnemy(t, sx, sy);
      e.dir = -1;
      spawnParticles(sx, sy, 14, '#ffaaff');
    }
    if (boss.timer <= 0) { boss.state = 'idle'; boss.timer = 70; }
  }
  else if (boss.state === 'boneShower') {
    boss.timer--;
    if (boss.timer % 8 === 0) {
      const tx = camX + 60 + Math.random() * (VW - 120);
      ebullets.push({
        x: tx, y: -10,
        vx: 0, vy: 4,
        w: 16, h: 8, life: 200, color: '#ddccaa', bone: true,
      });
    }
    if (boss.timer <= 0) { boss.state = 'idle'; boss.timer = 60; }
  }
  else if (boss.state === 'rushAttack') {
    boss.timer--;
    const px = player.x + player.w/2;
    const bx = boss.x + boss.w/2;
    boss.vx = (px > bx ? 1 : -1) * 3.5;
    boss.x += boss.vx;
    boss.dir = (px > bx) ? 1 : -1;
    if (boss.timer % 10 === 0) {
      ebullets.push({
        x: boss.x + boss.w/2, y: boss.y + boss.h/2,
        vx: -2.8, vy: 0, w: 11, h: 11, life: 140, color: '#ff44aa',
      });
      ebullets.push({
        x: boss.x + boss.w/2, y: boss.y + boss.h/2,
        vx: 2.8, vy: 0, w: 11, h: 11, life: 140, color: '#ff44aa',
      });
    }
    if (boss.timer <= 0) { boss.state = 'idle'; boss.timer = 40; }
    boss.x = clamp(boss.x, arenaLeft, arenaRight);
  }

  if (rectsOverlap(player, boss)) damagePlayer(20);

  if (boss.phase === 1 && boss.hp <= boss.maxHp * 0.66) {
    boss.phase = 2;
    boss.angryFlash = 30;
    announce('フェーズ 2 ！', 70);
    SFX.bossRoar();
  } else if (boss.phase === 2 && boss.hp <= boss.maxHp * 0.33) {
    boss.phase = 3;
    boss.angryFlash = 30;
    announce('最終形態 ！', 70);
    SFX.bossRoar();
  }

  if (boss.hp <= 0) {
    SFX.win();
    spawnParticles(boss.x + boss.w/2, boss.y + boss.h/2, 60, '#ffde59', 6);
    spawnParticles(boss.x + boss.w/2, boss.y + boss.h/2, 40, '#ff66aa', 4);
    score += 1000;
    boss = null;
    document.getElementById('boss-hud').classList.add('hidden');
    setTimeout(() => gameOver(true), 800);
  }
}

function drawBoss() {
  if (!boss) return;
  const x = boss.x - camX;
  const y = boss.y + Math.sin(boss.floatT) * 4;
  const w = boss.w, h = boss.h;
  const flash = boss.iframes > 0 && (boss.iframes % 4 < 2);

  ctx.fillStyle = (boss.phase >= 3) ? 'rgba(255,40,120,0.25)'
                 : (boss.phase === 2) ? 'rgba(170,80,255,0.18)'
                 : 'rgba(80,40,160,0.15)';
  ctx.beginPath();
  ctx.ellipse(x + w/2, y + h*0.55, w*0.7, h*0.7, 0, 0, Math.PI*2);
  ctx.fill();

  ctx.save();
  ctx.translate(x + w/2, y);
  ctx.scale(boss.dir, 1);
  const capeC = (boss.phase >= 3) ? '#660033' : '#330055';
  ctx.fillStyle = capeC;
  ctx.beginPath();
  ctx.moveTo(-w*0.2, h*0.20);
  ctx.lineTo(-w*0.55, h*0.95);
  ctx.lineTo(-w*0.10, h*0.85);
  ctx.lineTo(-w*0.05, h*0.30);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#aa0055';
  ctx.fillRect(-w*0.22, h*0.18, w*0.20, 4);
  ctx.restore();

  ctx.fillStyle = flash ? '#fff' : '#3a224f';
  ctx.beginPath();
  ctx.ellipse(x + w/2, y + h*0.65, w*0.42, h*0.32, 0, 0, Math.PI*2);
  ctx.fill();
  ctx.fillStyle = flash ? '#fff' : '#5a3a73';
  ctx.beginPath();
  ctx.ellipse(x + w/2, y + h*0.74, w*0.30, h*0.20, 0, 0, Math.PI*2);
  ctx.fill();

  ctx.fillStyle = flash ? '#fff' : '#2a1740';
  ctx.fillRect(x + w*0.20, y + h*0.85, 10, h*0.18);
  ctx.fillRect(x + w*0.40, y + h*0.85, 10, h*0.18);
  ctx.fillRect(x + w*0.60, y + h*0.85, 10, h*0.18);
  ctx.fillRect(x + w*0.78, y + h*0.85, 10, h*0.18);

  const hx = x + w/2 + boss.dir * w*0.18;
  const hy = y + h*0.30;
  ctx.fillStyle = flash ? '#fff' : '#3a224f';
  ctx.beginPath();
  ctx.ellipse(hx, hy, w*0.32, h*0.24, 0, 0, Math.PI*2);
  ctx.fill();
  ctx.fillStyle = flash ? '#fff' : '#5a3a73';
  ctx.beginPath();
  ctx.ellipse(hx + boss.dir * w*0.20, hy + h*0.05, w*0.15, h*0.10, 0, 0, Math.PI*2);
  ctx.fill();
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.ellipse(hx + boss.dir * w*0.30, hy + h*0.03, 4, 3, 0, 0, Math.PI*2);
  ctx.fill();
  ctx.fillStyle = (boss.angryFlash > 0 && boss.angryFlash%4<2) ? '#fff' : '#ff2244';
  ctx.shadowColor = '#ff2244';
  ctx.shadowBlur = 14;
  ctx.beginPath();
  ctx.arc(hx + boss.dir * w*0.05, hy - h*0.02, 4, 0, Math.PI*2);
  ctx.arc(hx + boss.dir * w*0.18, hy - h*0.02, 4, 0, Math.PI*2);
  ctx.fill();
  ctx.shadowBlur = 0;

  ctx.fillStyle = flash ? '#fff' : '#2a1740';
  ctx.beginPath();
  ctx.moveTo(hx - w*0.10, hy - h*0.18);
  ctx.lineTo(hx + boss.dir * 0.05, hy - h*0.32);
  ctx.lineTo(hx, hy - h*0.10);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(hx + w*0.10, hy - h*0.18);
  ctx.lineTo(hx + boss.dir * w*0.20, hy - h*0.32);
  ctx.lineTo(hx + w*0.05, hy - h*0.10);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = '#ffde59';
  ctx.beginPath();
  ctx.moveTo(hx - w*0.14, hy - h*0.28);
  ctx.lineTo(hx - w*0.08, hy - h*0.40);
  ctx.lineTo(hx - w*0.02, hy - h*0.30);
  ctx.lineTo(hx + w*0.04, hy - h*0.42);
  ctx.lineTo(hx + w*0.10, hy - h*0.30);
  ctx.lineTo(hx + w*0.16, hy - h*0.40);
  ctx.lineTo(hx + w*0.18, hy - h*0.26);
  ctx.lineTo(hx - w*0.14, hy - h*0.26);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#aa7700';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = '#ff2244';
  ctx.beginPath(); ctx.arc(hx + w*0.04, hy - h*0.30, 2.5, 0, Math.PI*2); ctx.fill();
}

// ----- Bullets / bombs / particles ------------------------
function updateBullets() {
  for (const b of bullets) {
    b.x += b.vx; b.y += b.vy; b.life--;
    if (b.life <= 0) b.dead = true;
    // collide with terrain
    for (const t of terrain) {
      const tr = terrainRect(t);
      if (rectsOverlap(b, tr)) { b.dead = true; spawnParticles(b.x, b.y, 4, '#ddd'); break; }
    }
    if (b.dead) continue;
    for (const e of enemies) {
      if (!e.alive) continue;
      if (rectsOverlap(b, e)) {
        e.hp -= 1;
        b.dead = true;
        spawnParticles(b.x, b.y, 4, '#ffeeaa');
        if (e.hp <= 0) {
          e.alive = false;
          spawnParticles(e.x + e.w/2, e.y + e.h/2, 16, '#ffaa66');
          score += 100;
          SFX.enemyDie();
          if (Math.random() < 0.10) {
            pickups.push({ x: e.x + e.w/2 - 8, y: e.y + e.h/2, w: 16, h: 16, vy: -3, kind: 'bone' });
          }
        } else {
          SFX.hit();
        }
        break;
      }
    }
    if (b.dead) continue;
    if (boss && boss.state !== 'enter' && rectsOverlap(b, boss)) {
      boss.hp -= 1;
      boss.iframes = 4;
      b.dead = true;
      spawnParticles(b.x, b.y, 4, '#ff66aa');
      SFX.bossHit();
    }
  }
  for (let i = bullets.length - 1; i >= 0; i--) {
    if (bullets[i].dead || bullets[i].x < camX - 40 || bullets[i].x > camX + VW + 40 ||
        bullets[i].y < -40 || bullets[i].y > VH + 40) bullets.splice(i,1);
  }
}

function updateEbullets() {
  for (const b of ebullets) {
    b.x += b.vx; b.y += b.vy; b.life--;
    if (b.bone) b.vy += 0.05;
    if (b.life <= 0) b.dead = true;
    if (rectsOverlap(b, player)) {
      damagePlayer(8);
      b.dead = true;
      spawnParticles(b.x, b.y, 6, b.color || '#ff8888');
    }
    // Terrain stops some bullets (only ones with vy>0 or bone bullets)
    if (b.bone || b.vy > 0) {
      for (const t of terrain) {
        if (rectsOverlap(b, terrainRect(t))) { b.dead = true; break; }
      }
    }
  }
  for (let i = ebullets.length - 1; i >= 0; i--) {
    const b = ebullets[i];
    if (b.dead || b.x < camX - 40 || b.x > camX + VW + 80 || b.y > VH + 20) ebullets.splice(i,1);
  }
}

function updateBombs() {
  for (const b of bombs) {
    b.vy += GRAVITY;
    b.x += b.vx; b.y += b.vy; b.life--;
    let exploded = false;
    for (const t of terrain) {
      if (rectsOverlap(b, terrainRect(t))) { exploded = true; break; }
    }
    for (const e of enemies) {
      if (e.alive && rectsOverlap(b, e)) { exploded = true; break; }
    }
    if (boss && boss.state !== 'enter' && rectsOverlap(b, boss)) exploded = true;
    if (exploded || b.life <= 0) {
      const ex = b.x + b.w/2, ey = b.y + b.h/2;
      const radius = 70;
      for (const e of enemies) {
        if (!e.alive) continue;
        const dx = (e.x + e.w/2) - ex, dy = (e.y + e.h/2) - ey;
        if (Math.hypot(dx,dy) < radius) {
          e.hp -= 6;
          if (e.hp <= 0) {
            e.alive = false;
            score += 100;
            spawnParticles(e.x + e.w/2, e.y + e.h/2, 18, '#ff8866');
          }
        }
      }
      if (boss && boss.state !== 'enter') {
        const dx = (boss.x + boss.w/2) - ex, dy = (boss.y + boss.h/2) - ey;
        if (Math.hypot(dx,dy) < radius + 20) {
          boss.hp -= 10;
          boss.iframes = 6;
        }
      }
      spawnParticles(ex, ey, 30, '#ffaa44', 5);
      spawnParticles(ex, ey, 18, '#ffffff', 3);
      SFX.bomb();
      b.dead = true;
    }
  }
  for (let i = bombs.length - 1; i >= 0; i--) {
    if (bombs[i].dead) bombs.splice(i,1);
  }
}

function updateParticles() {
  for (const p of particles) {
    p.x += p.vx; p.y += p.vy; p.vy += 0.18; p.life--;
  }
  for (let i = particles.length - 1; i >= 0; i--) {
    if (particles[i].life <= 0) particles.splice(i,1);
  }
}

function updatePickups() {
  for (const p of pickups) {
    p.vy += GRAVITY * 0.6;
    p.y += p.vy;
    // ground via terrain
    const top = groundTopAt(p.x + p.w/2);
    if (top !== null && p.y + p.h >= top) { p.y = top - p.h; p.vy = 0; }
    if (p.y > VH + 80) { p.dead = true; }
    if (rectsOverlap(p, player)) {
      p.dead = true;
      if (p.kind === 'bone') {
        player.bombs = Math.min(9, player.bombs + 1);
        score += 50;
      }
    }
  }
  for (let i = pickups.length - 1; i >= 0; i--) {
    if (pickups[i].dead) pickups.splice(i,1);
  }
}

// ----- Rendering ------------------------------------------
function drawBackground() {
  const dark = camX >= BOSS_ARENA_START - 40;
  const grd = ctx.createLinearGradient(0, 0, 0, VH);
  if (dark) {
    grd.addColorStop(0, '#2a0040');
    grd.addColorStop(0.6, '#660066');
    grd.addColorStop(1, '#220033');
  } else {
    grd.addColorStop(0, '#7ec8f3');
    grd.addColorStop(0.7, '#cfe9ff');
    grd.addColorStop(1, '#e8f5ff');
  }
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, VW, VH);

  // Far hills
  ctx.fillStyle = dark ? '#3a1a55' : '#9bd8a8';
  const off1 = ((camX * 0.2) % 240 + 240) % 240;
  for (let i = -1; i < 6; i++) {
    const cx = i * 240 - off1;
    ctx.beginPath();
    ctx.moveTo(cx, BASE_GROUND - 20);
    ctx.quadraticCurveTo(cx + 120, BASE_GROUND - 110, cx + 240, BASE_GROUND - 20);
    ctx.fill();
  }
  // Mid hills
  ctx.fillStyle = dark ? '#2a0a3f' : '#7cc28a';
  const off2 = ((camX * 0.4) % 200 + 200) % 200;
  for (let i = -1; i < 7; i++) {
    const cx = i * 200 - off2;
    ctx.beginPath();
    ctx.moveTo(cx, BASE_GROUND);
    ctx.quadraticCurveTo(cx + 100, BASE_GROUND - 70, cx + 200, BASE_GROUND);
    ctx.fill();
  }

  if (!dark) {
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    const offc = ((camX * 0.1) % 320 + 320) % 320;
    for (let i = -1; i < 5; i++) {
      const cx = i * 320 - offc + 80;
      const cy = 60 + (i%2)*30;
      ctx.beginPath();
      ctx.arc(cx, cy, 18, 0, Math.PI*2);
      ctx.arc(cx+18, cy-6, 22, 0, Math.PI*2);
      ctx.arc(cx+38, cy, 18, 0, Math.PI*2);
      ctx.fill();
    }
  } else {
    ctx.fillStyle = '#ffeeaa';
    ctx.shadowColor = '#ffeeaa';
    ctx.shadowBlur = 30;
    ctx.beginPath();
    ctx.arc(VW - 90, 80, 36, 0, Math.PI*2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#1a0033';
    ctx.fillRect(60, BASE_GROUND - 130, 100, 130);
    ctx.fillRect(180, BASE_GROUND - 170, 80, 170);
    ctx.fillRect(280, BASE_GROUND - 110, 90, 110);
    for (let i = 0; i < 5; i++) ctx.fillRect(60 + i*20, BASE_GROUND - 145, 12, 15);
    for (let i = 0; i < 4; i++) ctx.fillRect(180 + i*20, BASE_GROUND - 185, 12, 15);
    ctx.fillStyle = '#ff66aa';
    ctx.shadowColor = '#ff66aa'; ctx.shadowBlur = 8;
    ctx.fillRect(95, BASE_GROUND - 90, 10, 14);
    ctx.fillRect(125, BASE_GROUND - 90, 10, 14);
    ctx.fillRect(212, BASE_GROUND - 130, 10, 14);
    ctx.shadowBlur = 0;
  }

  // Terrain blocks
  for (const t of terrain) {
    const sx = t.x0 - camX;
    const sw = t.x1 - t.x0;
    const sy = t.top;
    if (sx + sw < -10 || sx > VW + 10) continue;
    // dirt fill
    ctx.fillStyle = dark ? '#1a0a2a' : '#88553a';
    ctx.fillRect(sx, sy, sw, VH - sy + 50);
    // grass top
    ctx.fillStyle = dark ? '#3a1a55' : '#3da34d';
    ctx.fillRect(sx, sy, sw, 8);
    // small grass tufts
    ctx.fillStyle = dark ? '#5a2a77' : '#5dc35d';
    for (let k = 0; k < sw; k += 32) {
      ctx.fillRect(sx + k + 6, sy - 2, 3, 5);
      ctx.fillRect(sx + k + 12, sy - 1, 2, 3);
    }
    // cliff edges (sides)
    ctx.fillStyle = dark ? '#0a0518' : '#5e3a26';
    if (t.top < BASE_GROUND - 4) {
      // left side stripe
      ctx.fillRect(sx, sy, 4, BASE_GROUND - sy);
      ctx.fillRect(sx + sw - 4, sy, 4, BASE_GROUND - sy);
    }
    // dirt texture dots
    ctx.fillStyle = dark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.10)';
    for (let k = 0; k < sw; k += 24) {
      ctx.fillRect(sx + k + ((k*7)%18), sy + 18 + ((k*3)%30), 2, 2);
    }
  }
}

function drawPlayer() {
  if (player.iframes > 0 && (player.iframes % 6 < 3)) return;
  const x = player.x - camX;
  const y = player.y;
  drawDog(x, y, player.w, player.h, {
    color: '#f4c98a',
    color2: '#fff5dd',
    dir: player.dir,
    walk: player.walkAnim,
    wag: frame * 0.2,
    bandana: true,
    gun: false,
  });
  // Aimed gun
  const cx = x + player.w/2;
  const cy = y + player.h*0.45;
  const ang = Math.atan2(player.aimY, player.aimX);
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(ang);
  ctx.fillStyle = '#3a3a3a';
  ctx.fillRect(2, -2, 16, 4);
  ctx.fillStyle = '#888';
  ctx.fillRect(15, -3, 3, 6);
  ctx.restore();

  // Aim reticle (small dot in aim direction) — visual cue for 8-way aim
  const rcx = cx + player.aimX * 34;
  const rcy = cy + player.aimY * 34;
  ctx.strokeStyle = 'rgba(255,222,89,0.85)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(rcx, rcy, 4, 0, Math.PI*2);
  ctx.moveTo(rcx - 7, rcy); ctx.lineTo(rcx - 3, rcy);
  ctx.moveTo(rcx + 3, rcy); ctx.lineTo(rcx + 7, rcy);
  ctx.moveTo(rcx, rcy - 7); ctx.lineTo(rcx, rcy - 3);
  ctx.moveTo(rcx, rcy + 3); ctx.lineTo(rcx, rcy + 7);
  ctx.stroke();

  // Melee chomp animation
  if (player.meleeTimer > 0) {
    const active = player.meleeTimer >= 4 && player.meleeTimer <= 14;
    const chompCx = x + player.w/2 + player.dir * (active ? 22 : 12);
    const chompCy = y + 14;
    ctx.save();
    ctx.translate(chompCx, chompCy);
    ctx.scale(player.dir, 1);
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(0, -10);
    ctx.lineTo(20, -3);
    ctx.lineTo(2, 0);
    ctx.lineTo(20, 5);
    ctx.lineTo(0, 10);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
    if (active) {
      ctx.strokeStyle = '#ffde59';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(10, -14); ctx.lineTo(26, -5);
      ctx.moveTo(10,  14); ctx.lineTo(26,  5);
      ctx.moveTo(22, 0); ctx.lineTo(32, 0);
      ctx.stroke();
    }
    ctx.restore();
  }
}

function drawBullet(b) {
  ctx.save();
  ctx.translate(b.x - camX + b.w/2, b.y + b.h/2);
  ctx.rotate(b.ang || 0);
  ctx.fillStyle = '#fff8cc';
  ctx.shadowColor = '#ffde59';
  ctx.shadowBlur = 8;
  ctx.fillRect(-b.w/2, -b.h/2, b.w, b.h);
  ctx.shadowBlur = 0;
  ctx.restore();
}

function drawEbullet(b) {
  ctx.save();
  if (b.bone) {
    const bx = b.x - camX, by = b.y;
    ctx.fillStyle = '#fff5dd';
    ctx.shadowColor = '#fff5dd'; ctx.shadowBlur = 6;
    ctx.beginPath(); ctx.arc(bx-2, by, 4, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(bx-2, by+4, 4, 0, Math.PI*2); ctx.fill();
    ctx.fillRect(bx, by-1, 12, 6);
    ctx.beginPath(); ctx.arc(bx+14, by, 4, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(bx+14, by+4, 4, 0, Math.PI*2); ctx.fill();
  } else {
    ctx.fillStyle = b.color || '#ff66aa';
    ctx.shadowColor = b.color || '#ff66aa'; ctx.shadowBlur = 6;
    ctx.beginPath();
    ctx.arc(b.x - camX + b.w/2, b.y + b.h/2, b.w/2, 0, Math.PI*2);
    ctx.fill();
  }
  ctx.restore();
}

function drawBomb(b) {
  const bx = b.x - camX, by = b.y;
  ctx.fillStyle = '#fff5dd';
  ctx.shadowColor = '#000'; ctx.shadowBlur = 4;
  ctx.beginPath(); ctx.arc(bx, by, 5, 0, Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.arc(bx, by+5, 5, 0, Math.PI*2); ctx.fill();
  ctx.fillRect(bx+2, by-1, 12, 8);
  ctx.beginPath(); ctx.arc(bx+16, by, 5, 0, Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.arc(bx+16, by+5, 5, 0, Math.PI*2); ctx.fill();
  ctx.shadowBlur = 0;
}

function drawParticle(p) {
  const a = Math.max(0, p.life / 30);
  ctx.globalAlpha = a;
  ctx.fillStyle = p.color;
  ctx.fillRect(p.x - camX - 2, p.y - 2, 4, 4);
  ctx.globalAlpha = 1;
}

function drawPickup(p) {
  const bx = p.x - camX, by = p.y;
  ctx.fillStyle = '#fff8dd';
  ctx.shadowColor = '#ffde59'; ctx.shadowBlur = 8;
  ctx.beginPath(); ctx.arc(bx, by+2, 4, 0, Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.arc(bx, by+10, 4, 0, Math.PI*2); ctx.fill();
  ctx.fillRect(bx+2, by+3, 12, 6);
  ctx.beginPath(); ctx.arc(bx+16, by+2, 4, 0, Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.arc(bx+16, by+10, 4, 0, Math.PI*2); ctx.fill();
  ctx.shadowBlur = 0;
}

// ----- HUD -----------------------------------------------
function updateHud() {
  document.getElementById('hp-fill').style.width = (player.hp / player.maxHp * 100) + '%';
  document.getElementById('bomb-count').textContent = player.bombs;
  document.getElementById('score-val').textContent = score;
  if (boss) {
    document.getElementById('boss-fill').style.width = Math.max(0, boss.hp / boss.maxHp * 100) + '%';
  }
  if (announceTimer > 0) {
    announceTimer--;
    if (announceTimer <= 0) document.getElementById('announce').classList.remove('show');
  }
}

// ----- Main loop ------------------------------------------
function update() {
  if (state !== 'play') return;
  frame++;
  playerUpdate();
  if (!boss) tickSpawns();
  for (const e of enemies) updateEnemy(e);
  for (let i = enemies.length - 1; i >= 0; i--) if (!enemies[i].alive) enemies.splice(i,1);
  updateBullets();
  updateEbullets();
  updateBombs();
  updateParticles();
  updatePickups();
  if (boss) updateBoss();
}

function render() {
  drawBackground();
  for (const p of pickups) drawPickup(p);
  for (const e of enemies) if (e.alive) drawEnemy(e);
  if (boss) drawBoss();
  drawPlayer();
  for (const b of bullets) drawBullet(b);
  for (const b of ebullets) drawEbullet(b);
  for (const b of bombs) drawBomb(b);
  for (const p of particles) drawParticle(p);
}

function loop() {
  update();
  render();
  if (state === 'play') updateHud();
  requestAnimationFrame(loop);
}

// ----- Game lifecycle -------------------------------------
function startGame() {
  bullets.length = 0;
  ebullets.length = 0;
  enemies.length = 0;
  bombs.length = 0;
  particles.length = 0;
  pickups.length = 0;
  camX = 0;
  score = 0;
  frame = 0;
  bossTriggered = false;
  boss = null;
  player.reset();
  buildStage();
  document.getElementById('title-screen').classList.add('hidden');
  document.getElementById('result-screen').classList.add('hidden');
  document.getElementById('hud').classList.remove('hidden');
  document.getElementById('boss-hud').classList.add('hidden');
  if (isTouch) document.getElementById('touch-controls').classList.remove('hidden');
  state = 'play';
  announce('STAGE START', 70);
  ac();
}

function gameOver(win) {
  state = win ? 'clear' : 'over';
  document.getElementById('hud').classList.add('hidden');
  document.getElementById('touch-controls').classList.add('hidden');
  const t = document.getElementById('result-title');
  const s = document.getElementById('result-score');
  t.textContent = win ? 'STAGE CLEAR！' : 'GAME OVER';
  t.className = 'result-title ' + (win ? 'win' : 'lose');
  s.textContent = `SCORE: ${score}`;
  document.getElementById('result-screen').classList.remove('hidden');
  if (!win) SFX.lose();
}

document.getElementById('start-btn').addEventListener('click', startGame);
document.getElementById('retry-btn').addEventListener('click', startGame);

canvas.addEventListener('touchstart', e => e.preventDefault(), { passive:false });
canvas.addEventListener('touchmove',  e => e.preventDefault(), { passive:false });

requestAnimationFrame(loop);

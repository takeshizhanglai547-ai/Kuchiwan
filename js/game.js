// ============================================================
//  KUCHIWAN: IRON CLASH  –  AC6-style 3D Mech Battle
//  KUCHIWAN (Gundam FA-type) vs IRON GHOST (AC-type)
//  Three.js implementation
// ============================================================
'use strict';

/* ═════════════════════════════════════════
   CONSTANTS
═════════════════════════════════════════ */
const CFG = {
  ARENA_SIZE:     300,
  // Player stats
  PLAYER_HP:      12000,
  PLAYER_SPEED:   20,
  BOOST_SPEED:    55,
  QB_SPEED:       125,
  QB_DURATION:    0.16,
  QB_COOLDOWN:    1.4,
  QB_EN_COST:     18,
  BOOST_MAX:      100,
  BOOST_DRAIN:    22,
  BOOST_REGEN:    14,
  // Player weapons
  RIFLE_SPEED:    100,
  RIFLE_DMG:      150,
  RIFLE_RATE:     0.09,
  MISSILE_SPEED:  62,
  MISSILE_DMG:    450,
  MISSILE_MAX:    36,
  MISSILE_RATE:   0.58,
  // Enemy
  ENEMY_HP:       18000,
  // Camera
  CAM_DIST:       28,
  CAM_HEIGHT:     9,
};

/* ═════════════════════════════════════════
   HELPERS
═════════════════════════════════════════ */
const $ = id => document.getElementById(id);
function lerp(a, b, t) { return a + (b - a) * t; }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function rand(lo, hi) { return lo + Math.random() * (hi - lo); }
function randSign() { return Math.random() < 0.5 ? 1 : -1; }

function makeMat(color, metalness = 0.7, roughness = 0.3) {
  return new THREE.MeshStandardMaterial({ color, metalness, roughness });
}
function makeGlowMat(color, intensity = 1.5) {
  return new THREE.MeshStandardMaterial({
    color, emissive: new THREE.Color(color),
    emissiveIntensity: intensity, metalness: 0, roughness: 1,
  });
}
function makeBox(w, h, d, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  m.castShadow = true;
  return m;
}

/* ═════════════════════════════════════════
   MECH BUILDER
═════════════════════════════════════════ */
const MechBuilder = {

  /* ── KUCHIWAN: Full-Armor Gundam type ──
     White / Dark Navy / Crimson Red
     Wing binders on back, dual arm rifles */
  playerKuchiwan() {
    const g = new THREE.Group();
    const white = makeMat(0xe8eaec, 0.45, 0.35);
    const navy  = makeMat(0x182040, 0.88, 0.18);
    const red   = makeMat(0xbb1020, 0.60, 0.35);
    const dark  = makeMat(0x0a0c18, 0.95, 0.10);
    const gray  = makeMat(0x888898, 0.70, 0.30);
    const teal  = makeGlowMat(0x00ffcc, 1.6);
    const B     = makeBox;

    // ── Torso ──
    g.add(B(2.3, 2.0, 1.3, navy,  0,  0.0,  0));       // main body
    g.add(B(2.0, 0.35, 1.1, white, 0, -0.95,  0));      // waist belt
    g.add(B(1.5, 0.22, 0.06, red,  0,  0.35, 0.67));    // chest stripe
    g.add(B(0.65, 0.55, 0.06, teal, 0,  0.0, 0.67));    // core glow panel
    g.add(B(0.5, 0.12, 0.06, red, -0.6, -0.3, 0.67));   // waist detail L
    g.add(B(0.5, 0.12, 0.06, red,  0.6, -0.3, 0.67));   // waist detail R

    // ── Head ──
    g.add(B(0.95, 0.72, 0.88, white, 0, 1.42, 0));
    g.add(B(0.72, 0.16, 0.06, teal,  0, 1.48, 0.45));   // visor
    g.add(B(0.06, 0.6, 0.06,  white, 0, 2.00, 0.08));   // main antenna
    g.add(B(0.06, 0.4, 0.06,  white, 0.32, 1.88, 0.06));// side antenna L
    g.add(B(0.06, 0.4, 0.06,  white,-0.32, 1.88, 0.06));// side antenna R
    g.add(B(0.78, 0.14, 0.06, navy,  0, 1.12, 0.45));   // chin guard

    // ── Shoulders ──
    g.add(B(1.1, 0.9, 1.2, navy, -1.88, 0.62, 0));
    g.add(B(1.1, 0.9, 1.2, navy,  1.88, 0.62, 0));
    g.add(B(0.85, 0.26, 0.9, red, -1.88, 0.10, 0.48));  // shoulder stripe L
    g.add(B(0.85, 0.26, 0.9, red,  1.88, 0.10, 0.48));  // shoulder stripe R
    g.add(B(0.9, 0.22, 0.85, white, -1.88, 1.08, 0));   // shoulder top L
    g.add(B(0.9, 0.22, 0.85, white,  1.88, 1.08, 0));   // shoulder top R

    // ── Upper Arms ──
    g.add(B(0.55, 1.25, 0.56, white, -1.82, -0.45, 0));
    g.add(B(0.55, 1.25, 0.56, white,  1.82, -0.45, 0));

    // ── Arm Weapons (dual assault rifles) ──
    const makeRifle = (side) => {
      const rg = new THREE.Group();
      rg.add(B(0.28, 0.28, 2.0, dark,  0,  0,    0.85)); // barrel
      rg.add(B(0.11, 0.11, 0.38, teal, 0,  0,    1.82)); // muzzle glow
      rg.add(B(0.38, 0.18, 1.2, navy,  0,  0.22, 0.25)); // magazine rail
      rg.add(B(0.28, 0.28, 0.55, white,0,  0,   -0.12)); // grip block
      rg.add(B(0.18, 0.06, 0.6,  gray, 0, -0.18,  0.6)); // lower rail
      rg.position.set(side * 1.82, -1.18, 0.32);
      return rg;
    };
    const weapL = makeRifle(-1);
    const weapR = makeRifle(1);
    g.add(weapL, weapR);
    g.userData.cannonL = weapL;
    g.userData.cannonR = weapR;

    // ── Legs ──
    g.add(B(0.72, 1.5, 0.78, navy, -0.75, -1.68, 0));   // thigh L
    g.add(B(0.72, 1.5, 0.78, navy,  0.75, -1.68, 0));   // thigh R
    g.add(B(0.78, 0.48, 0.92, white,-0.75, -1.10, 0.26));// knee L
    g.add(B(0.78, 0.48, 0.92, white, 0.75, -1.10, 0.26));// knee R
    g.add(B(0.65, 1.15, 0.70, navy, -0.75, -2.55, 0));  // shin L
    g.add(B(0.65, 1.15, 0.70, navy,  0.75, -2.55, 0));  // shin R
    g.add(B(0.6, 0.3, 0.55, red, -0.75, -3.2, -0.28)); // calf thruster L
    g.add(B(0.6, 0.3, 0.55, red,  0.75, -3.2, -0.28)); // calf thruster R
    g.add(B(0.80, 0.42, 1.18, white,-0.75, -3.28, 0.20));// foot L
    g.add(B(0.80, 0.42, 1.18, white, 0.75, -3.28, 0.20));// foot R
    g.add(B(0.60, 0.28, 0.50, red,  -0.75, -3.15, -0.32));// heel L
    g.add(B(0.60, 0.28, 0.50, red,   0.75, -3.15, -0.32));// heel R

    // ── Back Unit (wing binders + boosters) ──
    const back = new THREE.Group();

    // Central thruster block
    back.add(B(1.9, 1.4, 0.65, dark, 0,  0,  0));
    back.add(B(1.5, 0.55, 0.45, navy, 0, -0.42, 0.22));

    // Left wing binder
    const lBinder = new THREE.Group();
    lBinder.add(B(0.32, 2.8, 0.9, white,    0,  0,  0));   // main panel
    lBinder.add(B(0.22, 2.4, 0.7, red,      0.26, 0.1, 0)); // inner face
    lBinder.add(B(0.32, 0.55, 0.95, dark,   0, -1.5,  0));  // nozzle block
    lBinder.add(B(0.14, 0.14, 0.5, teal,   -0.08, -1.5, 0.52));// nozzle glow
    lBinder.position.set(-1.25, 0.3, 0);
    lBinder.rotation.z = 0.24;
    back.add(lBinder);

    // Right wing binder
    const rBinder = new THREE.Group();
    rBinder.add(B(0.32, 2.8, 0.9, white,     0,  0,  0));
    rBinder.add(B(0.22, 2.4, 0.7, red,      -0.26, 0.1, 0));
    rBinder.add(B(0.32, 0.55, 0.95, dark,    0, -1.5,  0));
    rBinder.add(B(0.14, 0.14, 0.5, teal,    0.08, -1.5, 0.52));
    rBinder.position.set(1.25, 0.3, 0);
    rBinder.rotation.z = -0.24;
    back.add(rBinder);

    // Main booster nozzles
    back.add(B(0.52, 0.52, 0.82, dark, -0.52, -0.42, 0.5));
    back.add(B(0.52, 0.52, 0.82, dark,  0.52, -0.42, 0.5));
    back.add(B(0.28, 0.28, 0.4, teal, -0.52, -0.42, 0.95));
    back.add(B(0.28, 0.28, 0.4, teal,  0.52, -0.42, 0.95));

    back.position.set(0, 0.3, -0.9);
    g.add(back);
    g.userData.backPack = back;
    g.userData.wingL    = lBinder;
    g.userData.wingR    = rBinder;

    return g;
  },

  /* ── IRON GHOST: AC-type armored core ──
     Charcoal gray / Near-black / Accent color by phase
     Angular industrial design, reverse-jointed legs, heavy weapon arms */
  enemyIronGhost(phase) {
    const g = new THREE.Group();

    // Phase palette: blue → purple → red-hot
    const palettes = [
      [0x2c2c36, 0x141418, 0x0055ff],
      [0x1e1825, 0x0e0810, 0x8800ff],
      [0x1e1010, 0x100808, 0xff2200],
    ];
    const [bodyClr, darkClr, accentClr] = palettes[Math.min(phase, 2)];

    const body   = makeMat(bodyClr, 0.92, 0.14);
    const dk     = makeMat(darkClr, 0.96, 0.08);
    const accent = makeGlowMat(accentClr, 2.0);
    const B = makeBox;

    // ── Torso ──
    g.add(B(3.4, 2.8, 2.0, body, 0,  0.0, 0));
    g.add(B(2.6, 0.65, 1.6, dk,  0, -1.45, 0));         // lower abdomen
    g.add(B(1.3, 0.9, 0.14, dk,  0,  0.4, 1.02));       // cockpit recess
    g.add(B(0.65, 0.28, 0.08, accent, 0, 0.42, 1.08));  // cockpit sensor strip
    // Torso side details
    g.add(B(0.4, 2.4, 0.22, dk, -1.72, 0, 0.92));
    g.add(B(0.4, 2.4, 0.22, dk,  1.72, 0, 0.92));

    // ── Head / Sensor unit ──
    g.add(B(1.5, 0.95, 1.3, body, 0, 1.85, 0));
    g.add(B(0.9, 0.25, 0.08, accent, 0, 1.92, 0.66));   // main sensor
    g.add(B(0.14, 0.14, 0.08, accent, -0.55, 1.85, 0.66));
    g.add(B(0.14, 0.14, 0.08, accent,  0.55, 1.85, 0.66));
    g.add(B(1.3, 0.18, 1.0, dk, 0, 2.38, 0));           // top fin

    // ── Heavy Shoulder Plates ──
    g.add(B(2.0, 1.05, 1.6, dk,  -2.9, 0.72, 0));
    g.add(B(2.0, 1.05, 1.6, dk,   2.9, 0.72, 0));
    g.add(B(1.6, 0.28, 1.4, accent, -2.9, 0.15, 0.32));
    g.add(B(1.6, 0.28, 1.4, accent,  2.9, 0.15, 0.32));
    // Shoulder spikes
    g.add(B(0.25, 0.8, 0.25, dk, -2.9, 1.26, -0.4));
    g.add(B(0.25, 0.8, 0.25, dk,  2.9, 1.26, -0.4));

    // ── Arms ──
    g.add(B(0.85, 1.75, 0.85, body, -2.9, -0.58, 0));
    g.add(B(0.85, 1.75, 0.85, body,  2.9, -0.58, 0));

    // ── Right arm: dual heavy cannon ──
    const rCannon = new THREE.Group();
    rCannon.add(B(0.52, 0.52, 3.0, dk,   0,  0.28, 1.2));   // upper barrel
    rCannon.add(B(0.52, 0.52, 3.0, dk,   0, -0.28, 1.2));   // lower barrel
    rCannon.add(B(0.22, 0.22, 0.55, accent, 0, 0.28, 2.65));
    rCannon.add(B(0.22, 0.22, 0.55, accent, 0,-0.28, 2.65));
    rCannon.add(B(0.75, 0.35, 1.6, body,   0, -0.38, 0.5)); // mounting
    rCannon.position.set(2.9, -1.55, 0.35);
    g.add(rCannon);
    g.userData.cannonR = rCannon;

    // ── Left arm: missile pod ──
    const lPod = new THREE.Group();
    lPod.add(B(0.9, 0.9, 1.55, dk, 0, 0, 0.25));
    for (let row = -1; row <= 1; row += 2) {
      for (let col = -1; col <= 1; col += 2) {
        lPod.add(B(0.16, 0.16, 0.55, accent, col * 0.27, row * 0.27, 0.98));
      }
    }
    lPod.position.set(-2.9, -1.55, 0.35);
    g.add(lPod);
    g.userData.cannonL = lPod;

    // ── Digitigrade (reverse-knee) Legs ──
    const makeLeg = (side) => {
      const lg = new THREE.Group();
      lg.add(B(0.95, 2.0, 0.95, body,  0,  0,    0));    // upper thigh
      lg.add(B(1.05, 0.55, 1.05, dk,   0, -1.15, 0.4));  // knee joint
      lg.add(B(0.78, 1.6, 0.72, body,  0, -2.3,  0.55)); // lower shin (angled fwd)
      lg.add(B(0.88, 0.42, 1.15, dk,   0, -3.25, 0.4));  // ankle armor
      lg.add(B(0.72, 0.32, 1.5, body,  0, -3.56, 0.62)); // foot
      lg.add(B(0.52, 0.16, 0.65, accent, 0,-3.56, 1.28));// toe thrust glow
      lg.add(B(0.55, 0.55, 0.65, dk, side*0.6, 0.18,-0.6)); // thigh thruster
      lg.add(B(0.3, 0.3, 0.38, accent, side*0.6, 0.18,-0.98));
      lg.position.set(side * 1.18, -2.1, 0);
      return lg;
    };
    g.add(makeLeg(-1));
    g.add(makeLeg(1));

    // ── Back thruster pack ──
    const tpack = new THREE.Group();
    tpack.add(B(3.8, 1.1, 0.68, dk,  0,  0,  0));
    tpack.add(B(0.85, 1.75, 0.65, body, -1.25, 0.55, 0));
    tpack.add(B(0.85, 1.75, 0.65, body,  1.25, 0.55, 0));
    tpack.add(B(0.55, 0.55, 0.85, dk,  -0.72, -0.25, 0.55));
    tpack.add(B(0.55, 0.55, 0.85, dk,   0.72, -0.25, 0.55));
    tpack.add(B(0.32, 0.32, 0.45, accent, -0.72,-0.25, 1.02));
    tpack.add(B(0.32, 0.32, 0.45, accent,  0.72,-0.25, 1.02));
    tpack.position.set(0, 0.55, -1.2);
    g.add(tpack);

    return g;
  },
};

/* ═════════════════════════════════════════
   PARTICLE SYSTEM
═════════════════════════════════════════ */
class ParticleSystem {
  constructor(scene) {
    this.scene = scene;
    this.pools = { spark: [], explosion: [], boost: [], qb: [], beam: [] };
    this.active = [];
  }

  _getMesh(type) {
    const pool = this.pools[type];
    if (pool.length > 0) return pool.pop();
    let geo, mat;
    if (type === 'spark') {
      geo = new THREE.SphereGeometry(0.08, 4, 4);
      mat = new THREE.MeshBasicMaterial({ color: 0xffaa00 });
    } else if (type === 'explosion') {
      geo = new THREE.SphereGeometry(0.45, 6, 6);
      mat = new THREE.MeshBasicMaterial({ color: 0xff4400 });
    } else if (type === 'boost') {
      geo = new THREE.SphereGeometry(0.12, 4, 4);
      mat = new THREE.MeshBasicMaterial({ color: 0x00aaff });
    } else if (type === 'qb') {
      geo = new THREE.SphereGeometry(0.22, 5, 5);
      mat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    } else {
      geo = new THREE.SphereGeometry(0.18, 6, 6);
      mat = new THREE.MeshBasicMaterial({ color: 0xff00ff });
    }
    return new THREE.Mesh(geo, mat);
  }

  spawn(type, pos, count = 8) {
    for (let i = 0; i < count; i++) {
      const m = this._getMesh(type);
      m.position.copy(pos);
      const speed = type === 'explosion' ? rand(5, 16) : rand(2, 9);
      m.userData = {
        type,
        vel: new THREE.Vector3(randSign()*rand(0.1,1), rand(0.1,1), randSign()*rand(0.1,1))
          .normalize().multiplyScalar(speed),
        life: 1.0,
        decay: rand(1.5, 3.5),
      };
      this.scene.add(m);
      this.active.push(m);
    }
  }

  spawnBoostTrail(pos) {
    if (Math.random() > 0.35) return;
    const m = this._getMesh('boost');
    m.position.copy(pos);
    m.userData = { type: 'boost', vel: new THREE.Vector3(rand(-0.5,0.5),rand(-0.5,0.5),rand(-0.5,0.5)), life: 1.0, decay: 4.5 };
    this.scene.add(m);
    this.active.push(m);
  }

  spawnQBFlash(pos) {
    for (let i = 0; i < 18; i++) {
      const m = this._getMesh('qb');
      m.position.copy(pos);
      const speed = rand(8, 25);
      m.userData = {
        type: 'qb',
        vel: new THREE.Vector3(randSign()*rand(0.2,1), rand(-0.3,0.8), randSign()*rand(0.2,1))
          .normalize().multiplyScalar(speed),
        life: 1.0,
        decay: rand(3, 6),
      };
      this.scene.add(m);
      this.active.push(m);
    }
  }

  update(dt) {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const m = this.active[i];
      const d = m.userData;
      d.life -= d.decay * dt;
      m.position.addScaledVector(d.vel, dt);
      if (d.type !== 'qb') d.vel.y -= 6 * dt;
      m.material.opacity = Math.max(0, d.life);
      m.material.transparent = true;
      m.scale.setScalar(Math.max(0, d.life));
      if (d.life <= 0) {
        this.scene.remove(m);
        this.pools[d.type].push(m);
        this.active.splice(i, 1);
      }
    }
  }
}

/* ═════════════════════════════════════════
   BULLET POOL
═════════════════════════════════════════ */
class BulletPool {
  constructor(scene) {
    this.scene = scene;
    this.pool = [];
    this.active = [];
  }

  _create(type) {
    let mesh;
    if (type === 'player') {
      const geo = new THREE.CylinderGeometry(0.06, 0.06, 0.8, 6);
      geo.rotateX(Math.PI / 2);
      mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x00ffff }));
    } else if (type === 'missile') {
      const geo = new THREE.ConeGeometry(0.15, 0.85, 6);
      geo.rotateX(Math.PI / 2);
      mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xff8800 }));
    } else if (type === 'enemy_rifle') {
      const geo = new THREE.SphereGeometry(0.16, 6, 6);
      mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xff3300 }));
    } else if (type === 'enemy_missile') {
      const geo = new THREE.ConeGeometry(0.18, 0.9, 6);
      geo.rotateX(Math.PI / 2);
      mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xff6600 }));
    } else if (type === 'enemy_beam') {
      const geo = new THREE.CylinderGeometry(0.1, 0.1, 1.6, 6);
      geo.rotateX(Math.PI / 2);
      mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xcc00ff }));
    } else {
      const geo = new THREE.SphereGeometry(0.14, 6, 6);
      mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xffff00 }));
    }
    return { mesh, type, active: false, vel: new THREE.Vector3(), life: 0, dmg: 0, homing: null };
  }

  fire({ type, pos, vel, dmg, life = 4, homing = null }) {
    // Reuse from pool if available
    let b = this.pool.find(x => !x.active && x.type === type);
    if (!b) { b = this._create(type); this.pool.push(b); }
    b.active = true;
    b.vel.copy(vel);
    b.dmg = dmg;
    b.life = life;
    b.homing = homing;
    b.mesh.position.copy(pos);
    this.scene.add(b.mesh);
    this.active.push(b);
    return b;
  }

  retire(b) {
    b.active = false;
    this.scene.remove(b.mesh);
    const idx = this.active.indexOf(b);
    if (idx >= 0) this.active.splice(idx, 1);
  }

  update(dt) {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const b = this.active[i];
      if (b.homing) {
        const dir = b.homing.clone().sub(b.mesh.position).normalize();
        b.vel.lerp(dir.multiplyScalar(b.vel.length()), 0.06);
      }
      b.mesh.position.addScaledVector(b.vel, dt);
      b.life -= dt;
      if (b.life <= 0) this.retire(b);
    }
  }
}

/* ═════════════════════════════════════════
   IRON GHOST  –  Enemy AI
   3 HP phases / 6 behavioral states
   Uses QB to dodge & charge
═════════════════════════════════════════ */
class IronGhost {
  constructor(scene, bullets, particles, playerPos) {
    this.scene     = scene;
    this.bullets   = bullets;
    this.particles = particles;
    this.playerPos = playerPos; // live reference to player.pos Vector3

    this.maxHp = CFG.ENEMY_HP;
    this.hp    = this.maxHp;
    this.phase = 1;
    this.alive = true;
    this.dead  = false;

    this.mesh = MechBuilder.enemyIronGhost(0);
    this.mesh.position.set(0, 8, -60);
    scene.add(this.mesh);

    // AI state machine
    this.state      = 'approach';
    this.stateTimer = 3.0;
    this.orbitAngle = 0;

    // Weapon timers
    this.rifleTimer   = 0;
    this.missileTimer = 0;
    this.beamTimer    = 0;

    // QB (Quick Boost)
    this.qbCooldown = 0;
    this.qbVel      = new THREE.Vector3();
    this.qbTime     = 0;

    // Phase transition
    this.phaseChanging = false;
    this.phaseTimer    = 0;

    // Hover animation
    this.hoverOffset = 0;
    this.patternT    = 0;
  }

  get pos() { return this.mesh.position; }

  _face() {
    const dir = this.playerPos.clone().sub(this.pos);
    dir.y = 0;
    if (dir.length() > 0.1) {
      const angle = Math.atan2(dir.x, dir.z);
      this.mesh.rotation.y = lerp(this.mesh.rotation.y, angle, 0.08);
    }
  }

  _quickBoost(dir) {
    if (this.qbCooldown > 0) return;
    this.qbVel.copy(dir).normalize().multiplyScalar(85);
    this.qbTime     = 0.18;
    this.qbCooldown = 1.2;
    this.particles.spawnQBFlash(this.pos.clone());
  }

  _fireRifle() {
    const dir = this.playerPos.clone().sub(this.pos).normalize();
    const spread = 0.07 / this.phase;
    dir.x += rand(-spread, spread);
    dir.z += rand(-spread, spread);
    dir.normalize();
    const speed = 85 + this.phase * 10;
    const dmg   = 110 + this.phase * 45;
    this.bullets.fire({
      type: 'enemy_rifle',
      pos:  this.pos.clone().add(new THREE.Vector3(0, 0.5, 1.5)),
      vel:  dir.multiplyScalar(speed),
      dmg, life: 5,
    });
    this.particles.spawn('spark', this.pos.clone().add(new THREE.Vector3(0, 0.5, 2)), 2);
  }

  _fireMissile() {
    const count = this.phase >= 2 ? 3 : 2;
    for (let i = 0; i < count; i++) {
      const offset = new THREE.Vector3(rand(-2, 2), rand(-0.5, 0.8), 0);
      const mpos   = this.pos.clone().add(offset).add(new THREE.Vector3(0, 0.5, 0));
      const dir    = this.playerPos.clone().sub(mpos).normalize();
      this.bullets.fire({
        type: 'enemy_missile',
        pos:  mpos,
        vel:  dir.multiplyScalar(60),
        dmg:  320 + this.phase * 80,
        life: 8,
        homing: this.playerPos,  // live reference – true tracking
      });
    }
    this.particles.spawn('explosion', this.pos.clone(), 4);
  }

  _fireBeam() {
    const bursts = this.phase === 3 ? 5 : 3;
    for (let i = 0; i < bursts; i++) {
      setTimeout(() => {
        if (!this.alive) return;
        const dir = this.playerPos.clone().sub(this.pos).normalize();
        dir.x += rand(-0.08, 0.08);
        dir.y += rand(-0.04, 0.04);
        dir.normalize();
        this.bullets.fire({
          type: 'enemy_beam',
          pos:  this.pos.clone().add(new THREE.Vector3(0, 0.5, 1.5)),
          vel:  dir.multiplyScalar(100),
          dmg:  580,
          life: 4,
        });
      }, i * 95);
    }
    this.particles.spawn('explosion', this.pos.clone(), 8);
  }

  // ── States ──────────────────────────────────

  _doApproach(dt) {
    const dist = this.pos.distanceTo(this.playerPos);
    const idealDist = 42;
    const dirTo = this.playerPos.clone().sub(this.pos).normalize();
    if (dist > idealDist) {
      const spd = 13 + this.phase * 4;
      this.pos.addScaledVector(dirTo, spd * dt);
    } else {
      this.state      = 'circle';
      this.stateTimer = rand(4, 8);
      this.orbitAngle = Math.atan2(this.pos.x - this.playerPos.x, this.pos.z - this.playerPos.z);
    }
    this.rifleTimer -= dt;
    if (this.rifleTimer <= 0) {
      this._fireRifle();
      this.rifleTimer = 0.38 / this.phase;
    }
  }

  _doCircle(dt) {
    const speed = (0.38 + this.phase * 0.18) * dt;
    this.orbitAngle += speed * (this.patternT % 2 < 1 ? 1 : -1);
    const r = 38 - this.phase * 4;
    const tx = this.playerPos.x + Math.sin(this.orbitAngle) * r;
    const tz = this.playerPos.z + Math.cos(this.orbitAngle) * r;
    const ty = this.playerPos.y + rand(3, 14);
    this.pos.lerp(new THREE.Vector3(tx, ty, tz), dt * 2.8);

    // Missile volley
    this.missileTimer -= dt;
    if (this.missileTimer <= 0) {
      this._fireMissile();
      this.missileTimer = 2.8 - this.phase * 0.5;
    }
    // Rifle
    this.rifleTimer -= dt;
    if (this.rifleTimer <= 0) {
      this._fireRifle();
      this.rifleTimer = 0.28 / this.phase;
    }
    this.stateTimer -= dt;
    if (this.stateTimer <= 0) {
      if (this.phase >= 2 && Math.random() < 0.45) {
        this.state = 'charge'; this.stateTimer = 3.5;
      } else {
        this.state = 'strafe'; this.stateTimer = rand(2, 4);
      }
    }
  }

  _doStrafe(dt) {
    const toPlayer = this.playerPos.clone().sub(this.pos);
    const perp     = new THREE.Vector3(-toPlayer.z, 0, toPlayer.x).normalize();
    const dir      = perp.clone().multiplyScalar(randSign());
    const spd      = 20 + this.phase * 5;
    this.pos.addScaledVector(dir, spd * dt);
    this.pos.y = lerp(this.pos.y, this.playerPos.y + rand(4, 15), dt * 2);

    // Rapid rifle
    this.rifleTimer -= dt;
    if (this.rifleTimer <= 0) {
      this._fireRifle();
      if (this.phase >= 2) this._fireRifle();
      this.rifleTimer = 0.18 / this.phase;
    }
    // QB in phase 2+
    if (this.phase >= 2 && this.qbCooldown <= 0 && Math.random() < 0.025) {
      this._quickBoost(dir);
    }

    this.stateTimer -= dt;
    if (this.stateTimer <= 0) {
      this.state      = Math.random() < 0.5 ? 'approach' : 'circle';
      this.stateTimer = rand(3, 6);
    }
  }

  _doCharge(dt) {
    const dirTo = this.playerPos.clone().sub(this.pos).normalize();
    const dist  = this.pos.distanceTo(this.playerPos);

    if (dist > 9) {
      const spd = 32 + this.phase * 10;
      this.pos.addScaledVector(dirTo, spd * dt);
      // QB burst at charge start
      if (this.stateTimer > 3.2 && this.qbCooldown <= 0) {
        this._quickBoost(dirTo);
      }
    } else {
      // Close-range burst
      for (let i = 0; i < 6; i++) this._fireRifle();
      this.particles.spawn('explosion', this.pos.clone(), 10);
      this.state      = 'evade';
      this.stateTimer = rand(1.2, 2.5);
      return;
    }

    this.rifleTimer -= dt;
    if (this.rifleTimer <= 0) {
      this._fireRifle();
      this.rifleTimer = 0.12;
    }
    this.stateTimer -= dt;
    if (this.stateTimer <= 0) {
      this.state      = 'circle';
      this.stateTimer = rand(3, 6);
    }
  }

  _doEvade(dt) {
    if (this.stateTimer > (this.phase >= 2 ? 1.5 : 0.8)) {
      const away = this.pos.clone().sub(this.playerPos).normalize();
      away.x += rand(-0.5, 0.5);
      away.z += rand(-0.5, 0.5);
      away.normalize();
      if (this.qbCooldown <= 0) this._quickBoost(away);
    }
    // Counter-fire
    this.rifleTimer -= dt;
    if (this.rifleTimer <= 0) {
      this._fireRifle();
      this.rifleTimer = 0.42;
    }
    this.stateTimer -= dt;
    if (this.stateTimer <= 0) {
      this.state      = this.phase >= 3 ? 'barrage' : 'circle';
      this.stateTimer = rand(4, 7);
    }
  }

  _doBarrage(dt) {
    // Phase 3: all-out relentless assault
    const dist  = this.pos.distanceTo(this.playerPos);
    const dirTo = this.playerPos.clone().sub(this.pos).normalize();

    // Hold medium distance
    if (dist > 38) {
      this.pos.addScaledVector(dirTo, 22 * dt);
    } else if (dist < 18) {
      this.pos.addScaledVector(dirTo, -12 * dt);
    }

    // Constant QB strafing
    if (this.qbCooldown <= 0) {
      const perp = new THREE.Vector3(-dirTo.z, 0, dirTo.x).multiplyScalar(randSign());
      perp.y = rand(-0.3, 0.5);
      this._quickBoost(perp.normalize());
    }

    // Rifle
    this.rifleTimer -= dt;
    if (this.rifleTimer <= 0) {
      this._fireRifle();
      this.rifleTimer = 0.10;
    }
    // Missiles
    this.missileTimer -= dt;
    if (this.missileTimer <= 0) {
      this._fireMissile();
      this.missileTimer = 1.8;
    }
    // Beam
    this.beamTimer -= dt;
    if (this.beamTimer <= 0) {
      this._fireBeam();
      this.beamTimer = 3.5;
    }

    // Random short evade
    this.stateTimer -= dt;
    if (this.stateTimer <= 0) {
      this.stateTimer = rand(2, 4);
    }
  }

  // ── Update ───────────────────────────────────

  update(dt) {
    if (!this.alive) return;
    if (this.phaseChanging) {
      this.phaseTimer -= dt;
      if (this.phaseTimer <= 0) this.phaseChanging = false;
      return;
    }

    this.patternT += dt;

    // QB movement
    if (this.qbTime > 0) {
      this.pos.addScaledVector(this.qbVel, dt);
      this.qbTime -= dt;
    }
    this.qbCooldown = Math.max(0, this.qbCooldown - dt);

    // State machine
    switch (this.state) {
      case 'approach': this._doApproach(dt); break;
      case 'circle':   this._doCircle(dt);   break;
      case 'strafe':   this._doStrafe(dt);   break;
      case 'charge':   this._doCharge(dt);   break;
      case 'evade':    this._doEvade(dt);    break;
      case 'barrage':  this._doBarrage(dt);  break;
    }

    this._face();

    // Hover bob
    this.hoverOffset += dt;
    this.mesh.position.y += Math.sin(this.hoverOffset * 0.9) * 0.012;
    this.mesh.rotation.z  = Math.sin(this.hoverOffset * 0.75) * 0.035;

    // Clamp arena
    const H = CFG.ARENA_SIZE / 2 - 20;
    this.pos.x = clamp(this.pos.x, -H, H);
    this.pos.z = clamp(this.pos.z, -H, H);
    this.pos.y = clamp(this.pos.y, 3, 45);

    // Phase transition
    const hpFrac   = this.hp / this.maxHp;
    const newPhase = hpFrac > 0.66 ? 1 : hpFrac > 0.33 ? 2 : 3;
    if (newPhase !== this.phase) this._changePhase(newPhase);

    // Death
    if (this.hp <= 0 && !this.dead) this._die();
  }

  _changePhase(newPhase) {
    this.phase = newPhase;
    this.phaseChanging = true;
    this.phaseTimer    = 1.8;

    const savedPos = this.pos.clone();
    const savedRot = { y: this.mesh.rotation.y };
    this.scene.remove(this.mesh);
    this.mesh = MechBuilder.enemyIronGhost(newPhase - 1);
    this.mesh.position.copy(savedPos);
    this.mesh.rotation.y = savedRot.y;
    this.scene.add(this.mesh);

    if (newPhase === 2) {
      this.state = 'evade'; this.stateTimer = 2.5;
    } else if (newPhase === 3) {
      this.state = 'barrage'; this.stateTimer = 99;
    }

    for (let i = 0; i < 5; i++) {
      setTimeout(() => this.particles.spawn('explosion', this.pos.clone(), 22), i * 180);
    }
  }

  _die() {
    this.dead  = true;
    this.alive = false;
    for (let i = 0; i < 9; i++) {
      setTimeout(() => this.particles.spawn('explosion', this.pos.clone(), 28), i * 110);
    }
    this.scene.remove(this.mesh);
  }

  takeDamage(amount) {
    if (!this.alive) return;
    this.hp = Math.max(0, this.hp - amount);

    // Reactive QB evade on heavy hits (phase 2+)
    if (amount > 350 && this.phase >= 2 && this.qbCooldown <= 0 && Math.random() < 0.55) {
      const away = this.pos.clone().sub(this.playerPos).normalize();
      away.x += rand(-0.4, 0.4);
      away.normalize();
      this._quickBoost(away);
      if (this.state !== 'barrage') {
        this.state      = 'evade';
        this.stateTimer = rand(1.5, 3);
      }
    }
  }
}

/* ═════════════════════════════════════════
   GAME  (main class)
═════════════════════════════════════════ */
class Game {
  constructor() {
    this._buildScene();
    this._buildEnvironment();
    this._buildPlayer();

    this.bullets   = new BulletPool(this.scene);
    this.particles = new ParticleSystem(this.scene);
    this.enemy     = null;

    this.keys  = {};
    this.mouse = { down: false, rightDown: false };
    this.camYaw   = 0;
    this.camPitch = 0.2;
    this.pointer  = false;

    this.fireTimer    = 0;
    this.missileTimer = 0;
    this._fireSide    = false;

    this.player = {
      hp:      CFG.PLAYER_HP,
      maxHp:   CFG.PLAYER_HP,
      en:      CFG.BOOST_MAX,
      missiles: CFG.MISSILE_MAX,
      vel:     new THREE.Vector3(),
      pos:     new THREE.Vector3(0, 5, 30),
      // QB state
      qbCooldown: 0,
      qbTime:     0,
      qbVel:      new THREE.Vector3(),
      qbReady:    true,
    };
    this.playerMesh.position.copy(this.player.pos);

    this.lockOn = false;

    this.gameState = 'start';
    this.clock     = new THREE.Clock();
    this.shakeTime = 0;

    this._setupEvents();
    this._setupTouchControls();
    this._setupHUD();
    this._loop();
  }

  /* ── Scene ── */
  _buildScene() {
    this.renderer = new THREE.WebGLRenderer({ canvas: $('gameCanvas'), antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x000010);
    this.scene.fog = new THREE.FogExp2(0x000814, 0.005);

    this.camera = new THREE.PerspectiveCamera(68, window.innerWidth / window.innerHeight, 0.1, 1000);

    window.addEventListener('resize', () => {
      this.renderer.setSize(window.innerWidth, window.innerHeight);
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
    });
  }

  _buildEnvironment() {
    // Lighting
    this.scene.add(new THREE.AmbientLight(0x0d1a33, 1.4));

    const sun = new THREE.DirectionalLight(0x99ccff, 2.2);
    sun.position.set(50, 90, 30);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far  = 500;
    sun.shadow.camera.left = sun.shadow.camera.bottom = -160;
    sun.shadow.camera.right = sun.shadow.camera.top   =  160;
    this.scene.add(sun);

    // Accent lights
    const redAcc = new THREE.PointLight(0xff2200, 4, 140);
    redAcc.position.set(0, 25, -70);
    this.scene.add(redAcc);
    const blueAcc = new THREE.PointLight(0x0044ff, 2.5, 100);
    blueAcc.position.set(0, 20, 70);
    this.scene.add(blueAcc);

    // Grid floor
    const grid = new THREE.GridHelper(CFG.ARENA_SIZE, 32, 0x002244, 0x001122);
    grid.position.y = -0.5;
    this.scene.add(grid);

    // Ground plane
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(CFG.ARENA_SIZE, CFG.ARENA_SIZE),
      new THREE.MeshStandardMaterial({ color: 0x030609, roughness: 1 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);

    // Stars
    const starGeo = new THREE.BufferGeometry();
    const starPos = [];
    for (let i = 0; i < 2500; i++) {
      starPos.push(rand(-600,600), rand(30,600), rand(-600,600));
    }
    starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starPos, 3));
    this.scene.add(new THREE.Points(starGeo,
      new THREE.PointsMaterial({ color: 0xffffff, size: 0.5, sizeAttenuation: true })));

    // Industrial structures
    this._buildArenaStructures();
  }

  _buildArenaStructures() {
    const pilMat  = makeMat(0x0a1020, 0.9, 0.3);
    const platMat = makeMat(0x0d1828, 0.85, 0.2);
    const glowMat = makeGlowMat(0x0033aa, 0.8);

    // Corner towers
    const half = CFG.ARENA_SIZE / 2 - 8;
    [[-half, -half], [half, -half], [-half, half], [half, half]].forEach(([x, z]) => {
      const tower = new THREE.Mesh(new THREE.BoxGeometry(4, 60, 4), pilMat);
      tower.position.set(x, 30, z);
      tower.castShadow = true;
      this.scene.add(tower);
      // Tower glow ring
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(3, 0.25, 6, 24),
        makeGlowMat(0x0055ff, 1.0)
      );
      ring.position.set(x, 55, z);
      ring.rotation.x = Math.PI / 2;
      this.scene.add(ring);
    });

    // Floating platforms at mid-height
    const platforms = [
      [0, 12, -30, 20, 1.5, 14],
      [-40, 9, 0,  14, 1.5, 10],
      [40, 9, 0,   14, 1.5, 10],
      [0, 16, 35,  18, 1.5, 12],
      [-25, 20, -55, 16, 1.5, 10],
      [25, 20, -55,  16, 1.5, 10],
    ];
    platforms.forEach(([x, y, z, w, h, d]) => {
      const plat = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), platMat);
      plat.position.set(x, y, z);
      plat.castShadow = true;
      plat.receiveShadow = true;
      this.scene.add(plat);
      // Underside glow
      const gline = new THREE.Mesh(new THREE.BoxGeometry(w - 1, 0.2, d - 1), glowMat);
      gline.position.set(x, y - 0.85, z);
      this.scene.add(gline);
    });

    // Decorative spinning rings
    this.rings = [];
    for (let i = 0; i < 4; i++) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(28 + i * 18, 0.25, 6, 64),
        new THREE.MeshBasicMaterial({ color: 0x001a33, wireframe: true })
      );
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 6 + i * 9;
      ring.userData.rotSpeed = 0.0015 * (i % 2 ? 1 : -1);
      this.scene.add(ring);
      this.rings.push(ring);
    }
  }

  _buildPlayer() {
    this.playerMesh = MechBuilder.playerKuchiwan();
    this.scene.add(this.playerMesh);
    this.playerLight = new THREE.PointLight(0x00ffcc, 1.8, 18);
    this.playerMesh.add(this.playerLight);
  }

  /* ── Events ── */
  _setupEvents() {
    document.addEventListener('keydown', e => {
      this.keys[e.code] = true;
      if (e.code === 'KeyQ' && this.gameState === 'playing') {
        this.lockOn = !this.lockOn;
        if (!this.lockOn) $('lock-ring').style.display = 'none';
      }
      // Quick Boost: E key
      if (e.code === 'KeyE' && this.gameState === 'playing') {
        this._triggerQB();
      }
      e.preventDefault();
    });
    document.addEventListener('keyup', e => { this.keys[e.code] = false; });

    document.addEventListener('mousemove', e => {
      if (!this.pointer) return;
      this.camYaw   -= e.movementX * 0.003;
      this.camPitch  = clamp(this.camPitch - e.movementY * 0.002, -0.4, 0.7);
    });

    document.addEventListener('mousedown', e => {
      if (e.button === 0) this.mouse.down = true;
      if (e.button === 2) this.mouse.rightDown = true;
      e.preventDefault();
    });
    document.addEventListener('mouseup', e => {
      if (e.button === 0) this.mouse.down = false;
      if (e.button === 2) this.mouse.rightDown = false;
    });
    document.addEventListener('contextmenu', e => e.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      this.pointer = document.pointerLockElement === $('gameCanvas');
    });

    $('start-btn').addEventListener('click', () => this._startGame());
    $('retry-btn').addEventListener('click', () => location.reload());
  }

  /* ── Touch Controls ── */
  _setupTouchControls() {
    const isMobile = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
    if (!isMobile) return;

    // Inject mobile controls info into start screen
    const mobileInfo = document.createElement('div');
    mobileInfo.className = 'mobile-ctrl-info';
    mobileInfo.innerHTML = `
      <h3>── タッチ操作 ──</h3>
      <div class="mobile-ctrl-grid">
        <span>左スティック</span><span>移動</span>
        <span>右エリア ドラッグ</span><span>カメラ / 照準</span>
        <span>▲ / ▼</span><span>上昇 / 下降</span>
        <span>FIRE (長押し)</span><span>ライフル射撃</span>
        <span>MSL (長押し)</span><span>ミサイル発射</span>
        <span>QB</span><span>クイックブースト</span>
        <span>BOOST (長押し)</span><span>高速移動</span>
        <span>LOCK</span><span>ロックオン切替</span>
      </div>
    `;
    const startScreen = $('start-screen');
    startScreen.insertBefore(mobileInfo, $('start-btn'));

    // --- Virtual Joystick ---
    const vjoyBase   = $('vjoy-base');
    const vjoyHandle = $('vjoy-handle');
    const JRADIUS    = 42;
    let joyTouchId = null;
    let joyCx = 0, joyCy = 0;

    const updateJoy = (tx, ty) => {
      let dx = tx - joyCx;
      let dy = ty - joyCy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > JRADIUS) { dx = dx / dist * JRADIUS; dy = dy / dist * JRADIUS; }
      vjoyHandle.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
      const th = JRADIUS * 0.3;
      this.keys['KeyW'] = dy < -th;
      this.keys['KeyS'] = dy >  th;
      this.keys['KeyA'] = dx < -th;
      this.keys['KeyD'] = dx >  th;
    };

    const resetJoy = () => {
      joyTouchId = null;
      vjoyHandle.style.transform = 'translate(-50%, -50%)';
      this.keys['KeyW'] = this.keys['KeyS'] = this.keys['KeyA'] = this.keys['KeyD'] = false;
    };

    vjoyBase.addEventListener('touchstart', e => {
      e.preventDefault();
      e.stopPropagation();
      if (joyTouchId !== null) return;
      const t = e.changedTouches[0];
      joyTouchId = t.identifier;
      const r = vjoyBase.getBoundingClientRect();
      joyCx = r.left + r.width / 2;
      joyCy = r.top  + r.height / 2;
      updateJoy(t.clientX, t.clientY);
    }, { passive: false });

    // --- Camera & general touch routing ---
    const buttonIds = new Set();
    const camTouches = {};

    document.addEventListener('touchstart', e => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        if (t.identifier === joyTouchId) continue;
        if (buttonIds.has(t.identifier)) continue;
        const el = document.elementFromPoint(t.clientX, t.clientY);
        if (el && (el.classList.contains('touch-btn') || el.closest('#vjoy-area'))) continue;
        camTouches[t.identifier] = { x: t.clientX, y: t.clientY };
      }
    }, { passive: true });

    document.addEventListener('touchmove', e => {
      e.preventDefault();
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        if (t.identifier === joyTouchId) {
          updateJoy(t.clientX, t.clientY);
        } else if (camTouches[t.identifier]) {
          const prev = camTouches[t.identifier];
          this.camYaw   -= (t.clientX - prev.x) * 0.006;
          this.camPitch  = clamp(this.camPitch - (t.clientY - prev.y) * 0.004, -0.4, 0.7);
          camTouches[t.identifier] = { x: t.clientX, y: t.clientY };
        }
      }
    }, { passive: false });

    const onTouchEnd = e => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        if (t.identifier === joyTouchId) resetJoy();
        delete camTouches[t.identifier];
        buttonIds.delete(t.identifier);
      }
    };
    document.addEventListener('touchend',    onTouchEnd);
    document.addEventListener('touchcancel', onTouchEnd);

    // --- Action Buttons ---
    const addBtn = (id, onStart, onEnd) => {
      const el = $(id);
      if (!el) return;
      el.addEventListener('touchstart', e => {
        e.preventDefault();
        e.stopPropagation();
        for (let i = 0; i < e.changedTouches.length; i++) buttonIds.add(e.changedTouches[i].identifier);
        onStart();
        el.classList.add('active');
      }, { passive: false });
      const end = e => { e.preventDefault(); if (onEnd) onEnd(); el.classList.remove('active'); };
      el.addEventListener('touchend',    end, { passive: false });
      el.addEventListener('touchcancel', end, { passive: false });
    };

    addBtn('btn-up',
      () => { this.keys['Space'] = true; },
      () => { this.keys['Space'] = false; }
    );
    addBtn('btn-down',
      () => { this.keys['ControlLeft'] = true; },
      () => { this.keys['ControlLeft'] = false; }
    );
    addBtn('btn-fire',
      () => { this.mouse.down = true; },
      () => { this.mouse.down = false; }
    );
    addBtn('btn-missile',
      () => { this.mouse.rightDown = true; },
      () => { this.mouse.rightDown = false; }
    );
    addBtn('btn-qb',
      () => { if (this.gameState === 'playing') this._triggerQB(); }
    );
    addBtn('btn-boost',
      () => { this.keys['ShiftLeft'] = true; },
      () => { this.keys['ShiftLeft'] = false; }
    );
    addBtn('btn-lock', () => {
      if (this.gameState !== 'playing') return;
      this.lockOn = !this.lockOn;
      if (!this.lockOn) $('lock-ring').style.display = 'none';
    });
  }

  _startGame() {
    $('start-screen').classList.add('hidden');
    $('hud').classList.remove('hidden');
    this._isMobile = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
    if (this._isMobile) {
      $('touch-controls').classList.remove('hidden');
    } else {
      $('gameCanvas').requestPointerLock();
    }
    this.gameState = 'playing';

    this.enemy = new IronGhost(this.scene, this.bullets, this.particles, this.player.pos);
    $('enemy-status').classList.remove('hidden');
    $('enemy-name-label').textContent = 'IRON GHOST';

    this._setMessage('ENGAGE', 2500);
    setTimeout(() => { if (this.gameState === 'playing') this._setMessage('', 0); }, 2500);
  }

  /* ── HUD ── */
  _setupHUD() {
    this._hudAp         = $('ap-bar');
    this._hudEn         = $('en-bar');
    this._hudQb         = $('qb-bar');
    this._hudApVal      = $('ap-val');
    this._hudEnemyAp    = $('enemy-ap-bar');
    this._hudEnemyApVal = $('enemy-ap-val');
    this._hudMissile    = $('missile-count');
    this._hudPhase      = $('phase-label');
    this._lockRing      = $('lock-ring');
  }

  _updateHUD() {
    const p = this.player;
    this._hudAp.style.width  = (p.hp / p.maxHp * 100) + '%';
    this._hudEn.style.width  = (p.en / CFG.BOOST_MAX * 100) + '%';
    this._hudQb.style.width  = (Math.max(0, 1 - p.qbCooldown / CFG.QB_COOLDOWN) * 100) + '%';
    this._hudApVal.textContent = Math.ceil(p.hp);
    this._hudMissile.textContent = p.missiles;

    if (this.enemy && this.enemy.alive) {
      const frac = this.enemy.hp / this.enemy.maxHp;
      this._hudEnemyAp.style.width  = (frac * 100) + '%';
      this._hudEnemyApVal.textContent = Math.ceil(this.enemy.hp) + ' / ' + this.enemy.maxHp;
      const phaseNames = ['', 'PHASE Ⅰ', 'PHASE Ⅱ', 'PHASE Ⅲ'];
      this._hudPhase.textContent = phaseNames[this.enemy.phase] || '';
    }

    if (this.lockOn && this.enemy && this.enemy.alive) {
      const screen = this._worldToScreen(this.enemy.pos);
      if (screen) {
        this._lockRing.style.display = 'block';
        this._lockRing.style.left = screen.x + 'px';
        this._lockRing.style.top  = screen.y + 'px';
        this._lockRing.className  = 'lock-ring locked';
      }
    } else {
      this._lockRing.style.display = 'none';
    }
  }

  _worldToScreen(pos3d) {
    const v = pos3d.clone().project(this.camera);
    if (v.z > 1) return null;
    return {
      x: (v.x  * 0.5 + 0.5) * window.innerWidth,
      y: (-v.y * 0.5 + 0.5) * window.innerHeight,
    };
  }

  _setMessage(text, duration = 2000) {
    const el = $('center-info');
    el.textContent = text;
    clearTimeout(this._msgTimer);
    if (duration > 0) {
      this._msgTimer = setTimeout(() => { el.textContent = ''; }, duration);
    }
  }

  /* ── Player QB ── */
  _triggerQB() {
    const p = this.player;
    if (p.qbCooldown > 0 || p.en < CFG.QB_EN_COST) return;

    // QB direction = current movement direction, or camera forward if not moving
    const forward = new THREE.Vector3(-Math.sin(this.camYaw), 0, -Math.cos(this.camYaw));
    const right   = new THREE.Vector3( Math.cos(this.camYaw), 0, -Math.sin(this.camYaw));
    const up      = new THREE.Vector3(0, 1, 0);
    const dir     = new THREE.Vector3();

    if (this.keys['KeyW']) dir.add(forward);
    if (this.keys['KeyS']) dir.sub(forward);
    if (this.keys['KeyA']) dir.sub(right);
    if (this.keys['KeyD']) dir.add(right);
    if (this.keys['Space'])                                dir.add(up);
    if (this.keys['ControlLeft'] || this.keys['ControlRight']) dir.sub(up);

    if (dir.length() < 0.1) dir.copy(forward);
    dir.normalize();

    p.qbVel.copy(dir).multiplyScalar(CFG.QB_SPEED);
    p.qbTime     = CFG.QB_DURATION;
    p.qbCooldown = CFG.QB_COOLDOWN;
    p.en         = Math.max(0, p.en - CFG.QB_EN_COST);

    this.particles.spawnQBFlash(p.pos.clone());
  }

  /* ── Player movement ── */
  _updatePlayer(dt) {
    const p   = this.player;
    const fwd = new THREE.Vector3(-Math.sin(this.camYaw), 0, -Math.cos(this.camYaw));
    const rgt = new THREE.Vector3( Math.cos(this.camYaw), 0, -Math.sin(this.camYaw));
    const up  = new THREE.Vector3(0, 1, 0);

    const boosting = (this.keys['ShiftLeft'] || this.keys['ShiftRight']) && p.en > 0;
    const speed    = boosting ? CFG.BOOST_SPEED : CFG.PLAYER_SPEED;
    const move     = new THREE.Vector3();

    if (this.keys['KeyW']) move.add(fwd);
    if (this.keys['KeyS']) move.sub(fwd);
    if (this.keys['KeyA']) move.sub(rgt);
    if (this.keys['KeyD']) move.add(rgt);
    if (this.keys['Space'])                                   move.add(up);
    if (this.keys['ControlLeft'] || this.keys['ControlRight']) move.sub(up);

    if (move.length() > 0) move.normalize().multiplyScalar(speed);

    // QB override
    if (p.qbTime > 0) {
      p.vel.lerp(p.qbVel, 0.6);
      p.qbTime -= dt;
    } else {
      p.vel.lerp(move, dt * 7);
    }
    p.qbCooldown = Math.max(0, p.qbCooldown - dt);

    p.pos.addScaledVector(p.vel, dt);

    // EN management
    if (boosting && move.length() > 0) {
      this.particles.spawnBoostTrail(p.pos.clone().sub(new THREE.Vector3(0, 1, 0)));
      p.en = Math.max(0, p.en - CFG.BOOST_DRAIN * dt);
    } else {
      p.en = Math.min(CFG.BOOST_MAX, p.en + CFG.BOOST_REGEN * dt);
    }

    // Clamp arena
    const H = CFG.ARENA_SIZE / 2 - 12;
    p.pos.x = clamp(p.pos.x, -H, H);
    p.pos.z = clamp(p.pos.z, -H, H);
    p.pos.y = clamp(p.pos.y, 1.8, 55);

    this.playerMesh.position.copy(p.pos);
    this.playerMesh.rotation.y = this.camYaw + Math.PI;

    // Lean animation
    const leanZ = this.keys['KeyA'] ? 0.18 : this.keys['KeyD'] ? -0.18 : 0;
    this.playerMesh.rotation.z = lerp(this.playerMesh.rotation.z, leanZ, 0.1);

    // Wing animation
    const wL = this.playerMesh.userData.wingL;
    const wR = this.playerMesh.userData.wingR;
    if (wL && wR) {
      const spread = (boosting || p.qbTime > 0) ? 0.6 : 0.24;
      wL.rotation.z = lerp(wL.rotation.z, spread, 0.06);
      wR.rotation.z = lerp(wR.rotation.z, -spread, 0.06);
    }
  }

  /* ── Camera ── */
  _updateCamera(dt) {
    const p = this.player.pos;
    const offset = new THREE.Vector3(
       Math.sin(this.camYaw) * CFG.CAM_DIST,
      CFG.CAM_HEIGHT + Math.sin(this.camPitch) * CFG.CAM_DIST,
      -Math.cos(this.camYaw) * CFG.CAM_DIST
    );
    const ideal = p.clone().add(offset);

    if (this.shakeTime > 0) {
      ideal.x += (Math.random() - 0.5) * 0.5 * this.shakeTime;
      ideal.y += (Math.random() - 0.5) * 0.5 * this.shakeTime;
      this.shakeTime = Math.max(0, this.shakeTime - dt * 4);
    }

    this.camera.position.lerp(ideal, dt * 9);
    const lookAt = p.clone().add(new THREE.Vector3(
      -Math.sin(this.camYaw) * 8, 0, Math.cos(this.camYaw) * 8
    ));
    this.camera.lookAt(lookAt);
  }

  /* ── Shooting ── */
  _getFireOrigin(side) {
    const cannon = side === 'L' ? this.playerMesh.userData.cannonL : this.playerMesh.userData.cannonR;
    const pos = new THREE.Vector3();
    cannon.getWorldPosition(pos);
    return pos;
  }

  _getAimDir() {
    if (this.lockOn && this.enemy && this.enemy.alive) {
      return this.enemy.pos.clone().sub(this._getFireOrigin('L')).normalize();
    }
    const dir = new THREE.Vector3(0, 0, -1);
    dir.applyQuaternion(this.camera.quaternion);
    return dir.normalize();
  }

  _updateShooting(dt) {
    this.fireTimer    = Math.max(0, this.fireTimer - dt);
    this.missileTimer = Math.max(0, this.missileTimer - dt);

    // Rifle
    if (this.mouse.down && this.fireTimer <= 0) {
      this.fireTimer = CFG.RIFLE_RATE;
      const dir = this._getAimDir();
      this._fireSide = !this._fireSide;
      const pos = this._getFireOrigin(this._fireSide ? 'L' : 'R');
      this.bullets.fire({ type: 'player', pos, vel: dir.clone().multiplyScalar(CFG.RIFLE_SPEED), dmg: CFG.RIFLE_DMG });
      this.particles.spawn('spark', pos, 2);
    }

    // Missiles
    if (this.mouse.rightDown && this.missileTimer <= 0 && this.player.missiles > 0) {
      this.missileTimer = CFG.MISSILE_RATE;
      this.player.missiles--;
      const basePos = this.playerMesh.position.clone().add(new THREE.Vector3(0, 0.5, 0));
      const dir     = this._getAimDir();
      const homing  = (this.lockOn && this.enemy && this.enemy.alive) ? this.enemy.pos : null;

      for (let s = -1; s <= 1; s += 2) {
        const mPos = basePos.clone().add(new THREE.Vector3(s * 0.7, 0, 0));
        this.bullets.fire({ type: 'missile', pos: mPos, vel: dir.clone().multiplyScalar(CFG.MISSILE_SPEED), dmg: CFG.MISSILE_DMG, life: 7, homing });
      }
      this.shakeTime = 0.3;
      this.particles.spawn('spark', basePos, 4);
    }
  }

  /* ── Collisions ── */
  _checkCollisions() {
    const pPos = this.player.pos;

    for (const b of [...this.bullets.active]) {
      if (!b.active) continue;
      const bPos = b.mesh.position;

      // Player shots → enemy
      if ((b.type === 'player' || b.type === 'missile') && this.enemy && this.enemy.alive) {
        if (bPos.distanceTo(this.enemy.pos) < 5.5) {
          this.enemy.takeDamage(b.dmg);
          this.particles.spawn(b.type === 'missile' ? 'explosion' : 'spark', bPos,
            b.type === 'missile' ? 14 : 4);
          if (b.type === 'missile') this.shakeTime = 0.6;
          this.bullets.retire(b);
        }
      }

      // Enemy shots → player
      if (b.type === 'enemy_rifle' || b.type === 'enemy_missile' || b.type === 'enemy_beam') {
        const radius = b.type === 'enemy_beam' ? 1.0 : b.type === 'enemy_missile' ? 1.4 : 0.8;
        if (bPos.distanceTo(pPos) < radius + 1.5) {
          this.player.hp -= b.dmg;
          this.particles.spawn('spark', pPos.clone(), 6);
          this.shakeTime = 0.7;
          document.body.classList.remove('damage-flash');
          requestAnimationFrame(() => document.body.classList.add('damage-flash'));
          this.bullets.retire(b);
        }
      }
    }
  }

  /* ── State ── */
  _checkGameState() {
    if (this.gameState !== 'playing') return;

    if (this.player.hp <= 0) {
      this.player.hp = 0;
      this.gameState = 'dead';
      this._showResult('MISSION FAILED', '#ff2222');
    }
    if (this.enemy && this.enemy.dead && !this._cleared) {
      this._cleared  = true;
      this.gameState = 'clear';
      this._showResult('MISSION COMPLETE', '#00ffcc');
    }
  }

  _showResult(title, color) {
    $('result-title').textContent = title;
    $('result-title').style.color = color;
    $('result-sub').textContent   = this.gameState === 'clear' ? 'IRON GHOST DESTROYED' : 'AP DEPLETED';
    $('result-screen').classList.remove('hidden');
    document.exitPointerLock();
  }

  /* ── Main Loop ── */
  _loop() {
    requestAnimationFrame(() => this._loop());
    const dt = Math.min(this.clock.getDelta(), 0.05);

    if (this.rings) this.rings.forEach(r => { r.rotation.z += r.userData.rotSpeed; });

    if (this.gameState === 'playing') {
      this._updatePlayer(dt);
      this._updateCamera(dt);
      this._updateShooting(dt);

      if (this.enemy) this.enemy.update(dt);

      this.bullets.update(dt);
      this.particles.update(dt);
      this._checkCollisions();
      this._checkGameState();
      this._updateHUD();
    } else {
      this.camera.position.set(
        Math.sin(Date.now() * 0.00028) * 22,
        14,
        Math.cos(Date.now() * 0.00028) * 22
      );
      this.camera.lookAt(0, 5, 0);
    }

    this.renderer.render(this.scene, this.camera);
  }
}

/* ═════════════════════════════════════════
   INIT
═════════════════════════════════════════ */
window.addEventListener('DOMContentLoaded', () => { window._game = new Game(); });

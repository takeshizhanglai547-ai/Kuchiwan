// ============================================================
//  KUCHIWAN — Quarter-View 3D Mech Shooter
//  Armored-Core-style part assembly + isometric arena combat
//  Single-file Three.js (r134) implementation
// ============================================================
'use strict';

/* ───────────── helpers ───────────── */
const $  = id => document.getElementById(id);
const lerp  = (a, b, t) => a + (b - a) * t;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const rand  = (lo, hi) => lo + Math.random() * (hi - lo);
const randSign = () => (Math.random() < 0.5 ? 1 : -1);
const pick  = arr => arr[(Math.random() * arr.length) | 0];

/* ════════════════════════════════════════════════════════════
   PARTS DATABASE  (Armored-Core-style)
   Each frame part has: ap, def, weight, en(drain)
   Category extras below.
   ════════════════════════════════════════════════════════════ */
const PARTS = {
  head: [
    { id: 'HD-SCOUT',  name: 'SCOUT',   jp: '軽量索敵', ap: 380,  def: 4,  weight: 90,  lock: 1.3, note: '広い索敵 / 軽い' },
    { id: 'HD-GUARD',  name: 'GUARD',   jp: '重装頭部', ap: 720,  def: 9,  weight: 220, lock: 1.0, note: '高装甲 / 重い' },
    { id: 'HD-OPTIC',  name: 'OPTIC',   jp: '照準特化', ap: 500,  def: 6,  weight: 150, lock: 1.55, note: '照準補正 大' },
  ],
  core: [
    { id: 'CR-MID',    name: 'MIDWEIGHT', jp: '標準コア', ap: 2400, def: 14, weight: 900,  enCap: 5200 },
    { id: 'CR-HEAVY',  name: 'FORTRESS',  jp: '重装コア', ap: 3600, def: 22, weight: 1500, enCap: 4400 },
    { id: 'CR-LIGHT',  name: 'ZEPHYR',    jp: '軽量コア', ap: 1700, def: 9,  weight: 560,  enCap: 6200 },
  ],
  arms: [
    { id: 'AR-BAL',    name: 'BALANCE',  jp: '標準腕部', ap: 900,  def: 10, weight: 620,  aim: 1.0,  recoil: 1.0 },
    { id: 'AR-STAB',   name: 'STABLE',   jp: '安定腕部', ap: 1150, def: 14, weight: 980,  aim: 1.35, recoil: 0.6 },
    { id: 'AR-QUICK',  name: 'AGILE',    jp: '軽量腕部', ap: 640,  def: 6,  weight: 380,  aim: 0.85, recoil: 1.3 },
  ],
  legs: [
    { id: 'LG-BIPED',  name: 'BIPED',    jp: '二脚',   ap: 1400, def: 12, weight: 1100, load: 5200, speed: 20, turn: 3.4, jump: 15, type: 'biped' },
    { id: 'LG-REV',    name: 'REVERSE',  jp: '逆関節', ap: 1150, def: 9,  weight: 900,  load: 4400, speed: 24, turn: 4.2, jump: 22, type: 'reverse' },
    { id: 'LG-TANK',   name: 'TANK',     jp: '戦車',   ap: 2600, def: 20, weight: 2200, load: 9000, speed: 15, turn: 2.4, jump: 4,  type: 'tank' },
    { id: 'LG-QUAD',   name: 'QUAD',     jp: '四脚',   ap: 1800, def: 15, weight: 1500, load: 6800, speed: 18, turn: 3.0, jump: 12, type: 'quad' },
  ],
  booster: [
    { id: 'BS-STD',    name: 'STANDARD', jp: '標準',   weight: 240, boostMul: 2.3, drain: 34, quick: 320, note: 'バランス型' },
    { id: 'BS-HI',     name: 'OVERDRIVE',jp: '高出力', weight: 380, boostMul: 3.1, drain: 52, quick: 460, note: '最高速 / 燃費悪' },
    { id: 'BS-ECO',    name: 'ECONOMY',  jp: '省エネ', weight: 200, boostMul: 1.9, drain: 22, quick: 240, note: '低燃費' },
  ],
  generator: [
    { id: 'GN-STD',    name: 'REACTOR-C', jp: '標準炉', weight: 520, output: 480, regen: 0.9, note: 'バランス' },
    { id: 'GN-HI',     name: 'REACTOR-X', jp: '大出力', weight: 880, output: 760, regen: 1.3, note: '高出力 / 重い' },
    { id: 'GN-LT',     name: 'REACTOR-L', jp: '軽量炉', weight: 300, output: 360, regen: 0.7, note: '軽い / 出力低' },
  ],

  /* WEAPONS — right arm (main) */
  rArm: [
    { id: 'RW-RIFLE',  name: 'AR RIFLE',  jp: 'アサルトライフル', weight: 480, ap: 0, def: 0,
      w: { kind: 'gun', dmg: 46, rate: 0.10, speed: 130, spread: 0.02, count: 1, ammo: null, color: 0x00eaff } },
    { id: 'RW-MG',     name: 'GATLING',   jp: 'ガトリング',       weight: 720, ap: 0, def: 0,
      w: { kind: 'gun', dmg: 20, rate: 0.045, speed: 150, spread: 0.06, count: 1, ammo: null, color: 0xffee55 } },
    { id: 'RW-BAZ',    name: 'BAZOOKA',   jp: 'バズーカ',         weight: 900, ap: 0, def: 0,
      w: { kind: 'gun', dmg: 340, rate: 1.15, speed: 85, spread: 0.0, count: 1, ammo: 26, splash: 6, color: 0xff8822, big: true } },
    { id: 'RW-LASER',  name: 'LASER RIFLE',jp: 'レーザーライフル', weight: 560, ap: 0, def: 0,
      w: { kind: 'gun', dmg: 120, rate: 0.34, speed: 220, spread: 0.0, count: 1, ammo: null, en: 120, color: 0xff4fff, beam: true } },
    { id: 'RW-SHOT',   name: 'SHOTGUN',   jp: 'ショットガン',     weight: 640, ap: 0, def: 0,
      w: { kind: 'gun', dmg: 34, rate: 0.7, speed: 110, spread: 0.16, count: 8, ammo: 60, range: 3.2, color: 0xffbb44 } },
  ],
  /* left arm (sub) — includes melee + shield */
  lArm: [
    { id: 'LW-HANDGUN',name: 'HANDGUN',   jp: 'ハンドガン',       weight: 300, ap: 0, def: 0,
      w: { kind: 'gun', dmg: 60, rate: 0.28, speed: 130, spread: 0.02, count: 1, ammo: null, color: 0x66ffcc } },
    { id: 'LW-BLADE',  name: 'PLASMA BLADE',jp: 'プラズマブレード', weight: 260, ap: 0, def: 0,
      w: { kind: 'blade', dmg: 620, rate: 0.55, range: 8, arc: 1.1, en: 160, color: 0x66ffff } },
    { id: 'LW-PULSE',  name: 'PULSE GUN', jp: 'パルスガン',       weight: 340, ap: 0, def: 0,
      w: { kind: 'gun', dmg: 30, rate: 0.09, speed: 120, spread: 0.05, count: 1, ammo: null, en: 26, color: 0x88ddff } },
    { id: 'LW-SHIELD', name: 'PULSE SHIELD',jp: 'パルスシールド',  weight: 420, ap: 260, def: 30,
      w: { kind: 'shield', reduce: 0.5, color: 0x33aaff } },
    { id: 'LW-NONE',   name: 'EMPTY',     jp: '無し',             weight: 0, ap: 0, def: 0, w: null },
  ],
  /* shoulder / back unit */
  shoulder: [
    { id: 'SH-MISSILE',name: 'MISSILE POD',jp: 'ミサイルポッド',  weight: 620, ap: 0, def: 0,
      w: { kind: 'missile', dmg: 130, rate: 1.3, speed: 70, count: 6, ammo: 60, homing: true, color: 0xff9933 } },
    { id: 'SH-CANNON', name: 'BACK CANNON',jp: 'バックキャノン',  weight: 1100, ap: 0, def: 0,
      w: { kind: 'gun', dmg: 520, rate: 2.2, speed: 100, ammo: 16, splash: 8, count: 1, color: 0xffdd33, big: true } },
    { id: 'SH-GRENADE',name: 'GRENADE',   jp: 'グレネード',       weight: 780, ap: 0, def: 0,
      w: { kind: 'gun', dmg: 260, rate: 0.9, speed: 90, ammo: 40, splash: 5, count: 3, spread: 0.14, color: 0xff7744, big: true } },
    { id: 'SH-NONE',   name: 'EMPTY',     jp: '無し',             weight: 0, ap: 0, def: 0, w: null },
  ],
};

const CATEGORIES = [
  { key: 'head',      label: 'HEAD',      jp: '頭部' },
  { key: 'core',      label: 'CORE',      jp: 'コア' },
  { key: 'arms',      label: 'ARMS',      jp: '腕部' },
  { key: 'legs',      label: 'LEGS',      jp: '脚部' },
  { key: 'booster',   label: 'BOOSTER',   jp: 'ブースター' },
  { key: 'generator', label: 'GENERATOR', jp: 'ジェネレータ' },
  { key: 'rArm',      label: 'R-ARM',     jp: '右腕武器' },
  { key: 'lArm',      label: 'L-ARM',     jp: '左腕武器' },
  { key: 'shoulder',  label: 'SHOULDER',  jp: '肩武器' },
];

const PAINTS = [
  { name: 'CYAN',   primary: 0x1a4a6a, secondary: 0x0a2436, accent: 0x00ffcc },
  { name: 'CRIMSON',primary: 0x6a1a22, secondary: 0x2a0a0e, accent: 0xff5544 },
  { name: 'GOLD',   primary: 0x6a5520, secondary: 0x2a2008, accent: 0xffcc33 },
  { name: 'VIOLET', primary: 0x3a1a6a, secondary: 0x160a2a, accent: 0xbb66ff },
  { name: 'JADE',   primary: 0x1a5a3a, secondary: 0x0a2418, accent: 0x44ff99 },
  { name: 'STEEL',  primary: 0x445566, secondary: 0x1a2430, accent: 0xaaccee },
  { name: 'BLOOD',  primary: 0x2a0a0a, secondary: 0x120404, accent: 0xff2200 },
  { name: 'SNOW',   primary: 0xaab4c0, secondary: 0x556070, accent: 0x44ddff },
];

/* default loadout — indices into each category */
function defaultLoadout() {
  return { head: 0, core: 0, arms: 0, legs: 0, booster: 0, generator: 0, rArm: 0, lArm: 0, shoulder: 0, paint: 0 };
}

/* ════════════════════════════════════════════════════════════
   STAT COMPUTATION
   ════════════════════════════════════════════════════════════ */
function partOf(cat, loadout) { return PARTS[cat][loadout[cat]]; }

function computeStats(loadout) {
  const head = partOf('head', loadout);
  const core = partOf('core', loadout);
  const arms = partOf('arms', loadout);
  const legs = partOf('legs', loadout);
  const bst  = partOf('booster', loadout);
  const gen  = partOf('generator', loadout);
  const rArm = partOf('rArm', loadout);
  const lArm = partOf('lArm', loadout);
  const shd  = partOf('shoulder', loadout);

  const frameAP = head.ap + core.ap + arms.ap + legs.ap + (lArm.ap || 0) + (shd.ap || 0);
  const defense = head.def + core.def + arms.def + legs.def + (lArm.def || 0) + (shd.def || 0);

  const weight = head.weight + core.weight + arms.weight + legs.weight +
                 bst.weight + gen.weight + rArm.weight + lArm.weight + shd.weight;
  const load   = legs.load;
  const over   = weight > load;
  const ratio  = weight / load;

  // lighter → faster; overweight → penalty
  const speedMul = over ? clamp(1.05 - (ratio - 1) * 1.4, 0.35, 0.95)
                        : clamp(1.25 - ratio * 0.45, 0.85, 1.25);
  const speed    = legs.speed * speedMul;
  const boost    = speed * bst.boostMul;
  const turn     = legs.turn * (over ? 0.6 : clamp(1.3 - ratio * 0.4, 0.8, 1.25));

  const enCap    = core.enCap;
  const enOutput = gen.output;   // regen/sec base
  const enRegen  = gen.regen;
  const boostDrain = bst.drain;

  return {
    parts: { head, core, arms, legs, bst, gen, rArm, lArm, shd },
    ap: frameAP, defense, weight, load, over, ratio,
    speed, boost, turn, jump: legs.jump, legType: legs.type,
    enCap, enOutput, enRegen, boostDrain,
    quickCost: bst.quick,
    aim: arms.aim, recoil: arms.recoil, lock: head.lock,
    paint: PAINTS[loadout.paint],
  };
}

/* ════════════════════════════════════════════════════════════
   MECH BUILDER — assembles a mech Group from a loadout
   ════════════════════════════════════════════════════════════ */
const MechBuilder = {
  _box(w, h, d, m, x, y, z) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    mesh.position.set(x, y, z);
    mesh.castShadow = true; mesh.receiveShadow = true;
    return mesh;
  },

  assemble(loadout) {
    const paint = PAINTS[loadout.paint];
    const legs  = partOf('legs', loadout);
    const g = new THREE.Group();

    const matPrimary = new THREE.MeshStandardMaterial({ color: paint.primary, metalness: 0.8, roughness: 0.35 });
    const matDark    = new THREE.MeshStandardMaterial({ color: paint.secondary, metalness: 0.9, roughness: 0.25 });
    const matGlow    = new THREE.MeshStandardMaterial({ color: paint.accent, emissive: paint.accent, emissiveIntensity: 1.4, roughness: 1 });
    const box = (w,h,d,m,x,y,z) => g.add(this._box(w,h,d,m,x,y,z));

    // ── LEGS (varies by type) ──
    let hipY = 0;
    const lt = legs.type;
    if (lt === 'tank') {
      hipY = 1.3;
      // treads
      const treadMat = matDark;
      for (const s of [-1, 1]) {
        box(1.0, 1.1, 3.6, treadMat, s * 1.2, 0.55, 0);
        for (let i = -1; i <= 1; i++) box(1.1, 0.5, 0.5, matPrimary, s * 1.2, 0.35, i * 1.1);
      }
      box(2.6, 0.6, 2.2, matPrimary, 0, 1.1, 0);
    } else if (lt === 'quad') {
      hipY = 2.1;
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        const lx = sx * 1.3, lz = sz * 0.9;
        box(0.5, 1.3, 0.5, matPrimary, lx, 1.4, lz);        // thigh
        box(0.4, 1.3, 0.4, matDark,    lx * 1.25, 0.65, lz); // shin
        box(0.7, 0.3, 0.9, matDark,    lx * 1.25, 0.15, lz + 0.1);
      }
      box(2.4, 0.7, 1.8, matPrimary, 0, 2.0, 0);
    } else if (lt === 'reverse') {
      hipY = 2.4;
      for (const s of [-1, 1]) {
        box(0.55, 1.2, 0.6, matPrimary, s * 0.7, 1.9, -0.1);   // thigh
        box(0.5, 1.2, 0.5, matDark,     s * 0.7, 0.95, 0.55);  // reverse shin fwd
        box(0.75, 0.35, 1.3, matDark,   s * 0.7, 0.2, 0.1);    // foot
      }
    } else { // biped
      hipY = 2.4;
      for (const s of [-1, 1]) {
        box(0.7, 1.4, 0.7, matPrimary, s * 0.7, 1.9, 0);   // thigh
        box(0.6, 1.4, 0.6, matDark,    s * 0.7, 0.85, 0);  // shin
        box(0.85, 0.4, 1.1, matDark,   s * 0.7, 0.2, 0.15);// foot
      }
    }

    // ── CORE / TORSO ──
    const coreY = hipY + 1.2;
    box(2.5, 2.1, 1.5, matPrimary, 0, coreY, 0);
    box(2.7, 0.5, 1.7, matDark, 0, coreY + 0.9, 0);   // chest plate
    box(0.9, 0.5, 0.2, matGlow, 0, coreY, 0.75);      // core vent glow

    // ── HEAD ──
    const headY = coreY + 1.7;
    box(0.95, 0.75, 0.9, matDark, 0, headY, 0);
    box(0.78, 0.16, 0.06, matGlow, 0, headY + 0.05, 0.48); // visor
    box(0.2, 0.4, 0.2, matPrimary, 0.45, headY + 0.3, -0.1); // antenna

    // ── SHOULDERS + ARMS ──
    const armY = coreY + 0.5;
    for (const s of [-1, 1]) {
      box(1.0, 0.9, 1.0, matDark, s * 1.85, armY, 0);        // shoulder
      box(0.55, 1.5, 0.55, matPrimary, s * 1.85, armY - 1.2, 0); // upper arm
    }

    // ── WEAPONS ── attach + record muzzles
    const muzzles = {};
    const addWeaponMesh = (slot, part, sideX) => {
      if (!part || !part.w) return;
      const w = part.w;
      const grp = new THREE.Group();
      const wmat = new THREE.MeshStandardMaterial({ color: w.color || paint.accent, metalness: 0.7, roughness: 0.4,
                                                    emissive: w.color || paint.accent, emissiveIntensity: 0.25 });
      const barrelMat = matDark;
      if (w.kind === 'blade') {
        // hilt + energy blade
        grp.add(this._box(0.2, 0.2, 0.7, barrelMat, 0, 0, 0.3));
        const blade = this._box(0.08, 0.5, 2.6, new THREE.MeshBasicMaterial({ color: w.color }), 0, 0, 1.7);
        blade.material.transparent = true; blade.material.opacity = 0.85;
        grp.add(blade);
        grp.userData.blade = blade;
      } else if (w.kind === 'shield') {
        grp.add(this._box(0.25, 2.0, 1.4, wmat, 0, 0, 0.2));
      } else if (w.big) {
        grp.add(this._box(0.5, 0.5, 2.2, barrelMat, 0, 0, 0.7));
        grp.add(this._box(0.62, 0.62, 0.4, wmat, 0, 0, -0.2));
      } else if (w.kind === 'missile') {
        // pod block with cells
        grp.add(this._box(1.0, 0.8, 1.2, barrelMat, 0, 0, 0));
        for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++)
          grp.add(this._box(0.22, 0.22, 0.2, wmat, -0.28 + i * 0.28, -0.2 + j * 0.4, 0.6));
      } else {
        grp.add(this._box(0.28, 0.3, 1.5, barrelMat, 0, 0, 0.55));
        grp.add(this._box(0.14, 0.14, 0.3, wmat, 0, 0, 1.35)); // muzzle tip
      }
      // muzzle marker (invisible)
      const muz = new THREE.Object3D();
      muz.position.set(0, 0, w.kind === 'blade' ? 3.0 : (w.big ? 1.9 : 1.5));
      grp.add(muz);
      muzzles[slot] = muz;

      // placement
      if (slot === 'shoulder') { grp.position.set(sideX * 1.0, coreY + 1.0, -0.7); }
      else { grp.position.set(sideX * 1.85, armY - 2.0, 0.3); }
      g.add(grp);
      g.userData['weapMesh_' + slot] = grp;
    };
    addWeaponMesh('rArm', partOf('rArm', loadout), 1);
    addWeaponMesh('lArm', partOf('lArm', loadout), -1);
    addWeaponMesh('shoulder', partOf('shoulder', loadout), -1);

    // ── BACK BOOSTERS ──
    const boosters = [];
    for (const s of [-1, 1]) {
      const b = this._box(0.5, 1.1, 0.5, matDark, s * 0.8, coreY + 0.2, -0.95);
      const flame = this._box(0.34, 0.34, 0.5, new THREE.MeshBasicMaterial({ color: paint.accent, transparent: true, opacity: 0 }), s * 0.8, coreY - 0.4, -1.2);
      g.add(b); g.add(flame);
      boosters.push(flame);
    }
    g.userData.boosters = boosters;
    g.userData.muzzles = muzzles;
    g.userData.groundY = 0;          // feet at y=0 within group
    g.userData.centerY = coreY;      // approx body center for aiming/hit
    g.userData.height = headY + 0.8;

    return g;
  },

  /* enemy mech — palette by tier, simple angular body */
  enemy(tier, scale = 1) {
    const g = new THREE.Group();
    const cols = [0x774422, 0x883322, 0x992211, 0xaa1111];
    const c = cols[Math.min(tier, cols.length - 1)];
    const mat  = new THREE.MeshStandardMaterial({ color: c, metalness: 0.8, roughness: 0.35 });
    const matD = new THREE.MeshStandardMaterial({ color: 0x221008, metalness: 0.9, roughness: 0.25 });
    const eye  = new THREE.MeshStandardMaterial({ color: 0xff4422, emissive: 0xff3311, emissiveIntensity: 2, roughness: 1 });
    const box = (w,h,d,m,x,y,z) => g.add(this._box(w*scale,h*scale,d*scale,m,x*scale,y*scale,z*scale));

    box(2.0, 1.8, 1.4, mat, 0, 2.4, 0);
    box(0.9, 0.7, 0.8, matD, 0, 3.6, 0);
    box(0.6, 0.16, 0.06, eye, 0, 3.65, 0.42);
    for (const s of [-1, 1]) {
      box(0.9, 0.8, 0.9, matD, s * 1.5, 2.9, 0);
      box(0.5, 1.3, 0.5, mat, s * 1.5, 1.7, 0);
      box(0.6, 1.3, 0.6, mat, s * 0.55, 1.0, 0);
      box(0.7, 0.35, 1.0, matD, s * 0.55, 0.25, 0.1);
    }
    g.userData.centerY = 2.4 * scale;
    g.userData.height  = 4.0 * scale;
    return g;
  },
};

/* ════════════════════════════════════════════════════════════
   PARTICLES
   ════════════════════════════════════════════════════════════ */
class Particles {
  constructor(scene) { this.scene = scene; this.pool = []; this.active = []; }
  _mesh(color, size) {
    let m = this.pool.pop();
    if (!m) m = new THREE.Mesh(new THREE.SphereGeometry(1, 5, 5), new THREE.MeshBasicMaterial({ transparent: true }));
    m.material.color.setHex(color); m.scale.setScalar(size);
    m.visible = true; return m;
  }
  spawn(pos, opts = {}) {
    const n = opts.count || 8;
    const color = opts.color != null ? opts.color : 0xffaa33;
    const spd = opts.speed || 8, size = opts.size || 0.3;
    for (let i = 0; i < n; i++) {
      const m = this._mesh(color, size);
      m.position.copy(pos);
      const dir = new THREE.Vector3(randSign()*rand(0.2,1), rand(0.2,1), randSign()*rand(0.2,1)).normalize();
      m.userData = { vel: dir.multiplyScalar(rand(spd*0.4, spd)), life: 1, decay: rand(1.6, 3.4), grav: opts.grav !== false, size };
      this.scene.add(m); this.active.push(m);
    }
  }
  ring(pos, color, r = 4) {
    const n = 16;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const m = this._mesh(color, 0.28);
      m.position.copy(pos);
      m.userData = { vel: new THREE.Vector3(Math.cos(a), 0.1, Math.sin(a)).multiplyScalar(r), life: 1, decay: 2.6, grav: false, size: 0.28 };
      this.scene.add(m); this.active.push(m);
    }
  }
  update(dt) {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const m = this.active[i], d = m.userData;
      d.life -= d.decay * dt;
      m.position.addScaledVector(d.vel, dt);
      if (d.grav) d.vel.y -= 14 * dt;
      const s = Math.max(0, d.life) * d.size;
      m.scale.setScalar(s);
      m.material.opacity = Math.max(0, d.life);
      if (d.life <= 0) { m.visible = false; this.scene.remove(m); this.pool.push(m); this.active.splice(i, 1); }
    }
  }
}

/* ════════════════════════════════════════════════════════════
   PROJECTILES
   ════════════════════════════════════════════════════════════ */
class Bullets {
  constructor(scene) { this.scene = scene; this.pool = []; this.active = []; }
  _get(spec) {
    let b = this.pool.find(x => !x.on && x.key === spec.key);
    if (b) return b;
    let mesh;
    if (spec.shape === 'missile') {
      const geo = new THREE.ConeGeometry(0.16, 0.9, 6); geo.rotateX(Math.PI / 2);
      mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: spec.color }));
    } else if (spec.shape === 'big') {
      mesh = new THREE.Mesh(new THREE.SphereGeometry(0.36, 8, 8), new THREE.MeshBasicMaterial({ color: spec.color }));
    } else if (spec.shape === 'beam') {
      const geo = new THREE.CylinderGeometry(0.09, 0.09, 1.8, 6); geo.rotateX(Math.PI / 2);
      mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: spec.color }));
    } else {
      const geo = new THREE.CylinderGeometry(0.07, 0.07, 0.7, 6); geo.rotateX(Math.PI / 2);
      mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: spec.color }));
    }
    b = { mesh, key: spec.key, on: false, vel: new THREE.Vector3(), life: 0, dmg: 0, foe: false, splash: 0, homing: null };
    this.pool.push(b); return b;
  }
  fire(o) {
    const spec = { key: (o.foe ? 'F' : 'P') + (o.shape || 'b') + (o.color || 0), shape: o.shape, color: o.color };
    const b = this._get(spec);
    b.on = true; b.foe = !!o.foe; b.dmg = o.dmg; b.life = o.life || 3.5;
    b.splash = o.splash || 0; b.homing = o.homing || null;
    b.vel.copy(o.vel); b.mesh.position.copy(o.pos);
    if (o.vel.lengthSq() > 0) b.mesh.lookAt(o.pos.clone().add(o.vel));
    this.scene.add(b.mesh); this.active.push(b);
    return b;
  }
  retire(b) { b.on = false; this.scene.remove(b.mesh); const i = this.active.indexOf(b); if (i >= 0) this.active.splice(i, 1); }
  update(dt, homeTargets) {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const b = this.active[i];
      if (b.homing) {
        let tgt = null, best = 1e9;
        for (const t of homeTargets) { if (!t.alive) continue; const d = t.pos.distanceTo(b.mesh.position); if (d < best) { best = d; tgt = t; } }
        if (tgt) {
          const dir = tgt.pos.clone().add(new THREE.Vector3(0, tgt.mesh.userData.centerY || 2, 0)).sub(b.mesh.position).normalize();
          b.vel.lerp(dir.multiplyScalar(b.vel.length()), 0.06);
          b.mesh.lookAt(b.mesh.position.clone().add(b.vel));
        }
      }
      b.mesh.position.addScaledVector(b.vel, dt);
      if (b.mesh.position.y < -1) { this.retire(b); continue; }
      b.life -= dt; if (b.life <= 0) this.retire(b);
    }
  }
}

/* ════════════════════════════════════════════════════════════
   ENEMY
   ════════════════════════════════════════════════════════════ */
const ENEMY_TYPES = {
  drone:  { tier: 0, hp: 260,  scale: 0.7, speed: 16, range: 14, fireRate: 1.1, dmg: 70,  score: 100, behavior: 'rush',   color: 0xff5533 },
  gunner: { tier: 1, hp: 420,  scale: 0.9, speed: 10, range: 34, fireRate: 1.4, dmg: 120, score: 180, behavior: 'kite',   color: 0xff7722 },
  tank:   { tier: 2, hp: 1500, scale: 1.3, speed: 6,  range: 40, fireRate: 2.0, dmg: 260, score: 400, behavior: 'siege',  color: 0xffaa22, big: true },
  boss:   { tier: 3, hp: 9000, scale: 2.2, speed: 8,  range: 46, fireRate: 0.9, dmg: 200, score: 3000, behavior: 'boss',  color: 0xff2211, big: true },
};

class Enemy {
  constructor(scene, bullets, particles, typeKey, pos, waveMul = 1) {
    const cfg = ENEMY_TYPES[typeKey];
    this.cfg = cfg; this.typeKey = typeKey;
    this.scene = scene; this.bullets = bullets; this.particles = particles;
    this.maxHp = cfg.hp * waveMul; this.hp = this.maxHp;
    this.mesh = MechBuilder.enemy(cfg.tier, cfg.scale);
    this.mesh.position.copy(pos);
    scene.add(this.mesh);
    this.fireTimer = rand(0.4, cfg.fireRate);
    this.alive = true;
    this.hover = typeKey === 'boss' ? 4 : (typeKey === 'drone' ? 1.2 : 0);
    this.strafe = randSign();
    this.strafeTimer = rand(1, 3);
    this.attackIdx = 0;
    this.mesh.position.y = this.hover;
  }
  get pos() { return this.mesh.position; }

  update(dt, player) {
    if (!this.alive) return;
    const cfg = this.cfg;
    const toP = player.pos.clone().sub(this.pos); toP.y = 0;
    const dist = toP.length();
    const dir = toP.clone().normalize();

    // face player
    const ang = Math.atan2(dir.x, dir.z);
    this.mesh.rotation.y = lerp(this.mesh.rotation.y, ang, 0.12);

    // movement per behavior
    this.strafeTimer -= dt;
    if (this.strafeTimer <= 0) { this.strafe = randSign(); this.strafeTimer = rand(1.2, 3); }
    const side = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(this.strafe);
    let move = new THREE.Vector3();

    if (cfg.behavior === 'rush') {
      move = dir.clone().multiplyScalar(dist > 6 ? 1 : -0.3).add(side.multiplyScalar(0.4));
    } else if (cfg.behavior === 'kite') {
      const want = cfg.range * 0.7;
      move = dir.clone().multiplyScalar(dist > want ? 1 : (dist < want * 0.7 ? -1 : 0)).add(side.multiplyScalar(0.7));
    } else if (cfg.behavior === 'siege') {
      move = dir.clone().multiplyScalar(dist > cfg.range ? 0.8 : 0).add(side.multiplyScalar(0.25));
    } else { // boss
      const want = 24;
      move = dir.clone().multiplyScalar(dist > want ? 0.7 : (dist < want * 0.6 ? -0.6 : 0)).add(side.multiplyScalar(0.9));
    }
    if (move.lengthSq() > 0) move.normalize().multiplyScalar(cfg.speed * dt);
    this.pos.add(move);

    // hover / bob
    if (this.hover > 0) this.pos.y = this.hover + Math.sin(Date.now() * 0.003 + this.strafeTimer) * 0.4;
    // arena clamp
    const H = 138;
    this.pos.x = clamp(this.pos.x, -H, H); this.pos.z = clamp(this.pos.z, -H, H);

    // attacks
    this.fireTimer -= dt;
    if (this.fireTimer <= 0 && dist < cfg.range + 6) {
      this._attack(dir, player);
      this.fireTimer = cfg.fireRate * rand(0.8, 1.2);
    }
  }

  _shoot(pos, vel, dmg, shape, color, splash = 0) {
    this.bullets.fire({ foe: true, pos, vel, dmg, shape, color, splash, life: 4.5 });
  }

  _attack(dir, player) {
    const cfg = this.cfg;
    const origin = this.pos.clone(); origin.y = (this.mesh.userData.centerY || 2);
    const tgt = player.pos.clone(); tgt.y += 1.5;
    const aim = tgt.sub(origin).normalize();

    if (this.typeKey === 'drone') {
      this._shoot(origin, aim.clone().multiplyScalar(90), cfg.dmg, 'b', 0xff5533);
    } else if (this.typeKey === 'gunner') {
      for (let i = -1; i <= 1; i++) {
        const v = aim.clone().applyAxisAngle(new THREE.Vector3(0,1,0), i * 0.12).multiplyScalar(80);
        this._shoot(origin, v, cfg.dmg, 'b', 0xff7722);
      }
    } else if (this.typeKey === 'tank') {
      this._shoot(origin, aim.clone().multiplyScalar(70), cfg.dmg, 'big', 0xffaa22, 5);
      this.particles.spawn(origin, { count: 4, color: 0xff8822, speed: 4 });
    } else { // boss — rotating patterns
      this.attackIdx = (this.attackIdx + 1) % 3;
      if (this.attackIdx === 0) {          // ring
        const n = 20;
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2;
          this._shoot(origin, new THREE.Vector3(Math.cos(a), 0, Math.sin(a)).multiplyScalar(48), cfg.dmg * 0.6, 'b', 0xff3322);
        }
      } else if (this.attackIdx === 1) {   // aimed volley
        for (let i = -2; i <= 2; i++) {
          const v = aim.clone().applyAxisAngle(new THREE.Vector3(0,1,0), i * 0.14).multiplyScalar(75);
          this._shoot(origin, v, cfg.dmg, 'big', 0xff5522, 4);
        }
      } else {                             // spiral
        const base = Date.now() * 0.004;
        for (let i = 0; i < 4; i++) {
          const a = base + i * Math.PI / 2;
          this._shoot(origin, new THREE.Vector3(Math.cos(a), 0, Math.sin(a)).multiplyScalar(55), cfg.dmg * 0.7, 'b', 0xff4422);
        }
      }
    }
  }

  takeDamage(dmg, at) {
    if (!this.alive) return;
    this.hp -= dmg;
    this.particles.spawn(at || this.pos, { count: 4, color: 0xffcc55, speed: 6, size: 0.22 });
    if (this.hp <= 0) this.die();
  }
  die() {
    this.alive = false;
    const p = this.pos.clone(); p.y = this.mesh.userData.centerY || 2;
    this.particles.spawn(p, { count: this.cfg.big ? 40 : 18, color: 0xff6622, speed: this.cfg.big ? 16 : 10, size: 0.5 });
    this.particles.ring(p, 0xffaa33, this.cfg.big ? 8 : 4);
    this.scene.remove(this.mesh);
  }
}

/* ════════════════════════════════════════════════════════════
   GARAGE — assembly UI + rotating preview
   ════════════════════════════════════════════════════════════ */
class Garage {
  constructor(onSortie) {
    this.onSortie = onSortie;
    this.loadout = defaultLoadout();
    this.activeCat = 'head';
    this._buildPreview();
    this._bind();
  }

  _buildPreview() {
    const canvas = $('previewCanvas');
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x02060c, 0.02);
    this.cam = new THREE.PerspectiveCamera(42, 1, 0.1, 200);

    this.scene.add(new THREE.AmbientLight(0x334455, 1.4));
    const key = new THREE.DirectionalLight(0xbfe6ff, 2.2); key.position.set(8, 16, 10); key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024); this.scene.add(key);
    const rim = new THREE.PointLight(0x00ffcc, 2, 40); rim.position.set(-10, 6, -8); this.scene.add(rim);

    const floor = new THREE.Mesh(new THREE.CircleGeometry(9, 48),
      new THREE.MeshStandardMaterial({ color: 0x081420, metalness: 0.6, roughness: 0.5 }));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; this.scene.add(floor);
    const grid = new THREE.GridHelper(18, 18, 0x00ffcc, 0x113344); grid.position.y = 0.02; this.scene.add(grid);

    this.turntable = new THREE.Group(); this.scene.add(this.turntable);
    this._rebuild();
    this._resize();
    addEventListener('resize', () => this._resize());
  }

  _resize() {
    const c = $('previewCanvas');
    const w = c.clientWidth || 600, h = c.clientHeight || 600;
    this.renderer.setSize(w, h, false);
    this.cam.aspect = w / h; this.cam.updateProjectionMatrix();
  }

  _rebuild() {
    if (this.mech) this.turntable.remove(this.mech);
    this.mech = MechBuilder.assemble(this.loadout);
    this.turntable.add(this.mech);
    // frame camera on mech height
    const h = this.mech.userData.height || 8;
    this.cam.position.set(0, h * 0.6, h * 1.7);
    this.cam.lookAt(0, h * 0.45, 0);
  }

  animate(dt) {
    if (!this.visible) return;
    this.turntable.rotation.y += dt * 0.5;
    // booster idle flicker
    this.renderer.render(this.scene, this.cam);
  }

  /* ── UI ── */
  _bind() {
    this._renderCategories();
    this._renderPaints();
    this._renderOptions();
    this._renderStats();
    $('sortie-btn').addEventListener('click', () => this.onSortie(this.loadout, computeStats(this.loadout)));
  }

  show() { this.visible = true; setTimeout(() => this._resize(), 30); }
  hide() { this.visible = false; }

  _renderCategories() {
    const el = $('category-list'); el.innerHTML = '';
    for (const cat of CATEGORIES) {
      const part = partOf(cat.key, this.loadout);
      const row = document.createElement('div');
      row.className = 'cat-row' + (cat.key === this.activeCat ? ' active' : '');
      row.innerHTML = `<span>${cat.label}</span><span class="cat-part">${part.name}</span>`;
      row.onclick = () => { this.activeCat = cat.key; this._renderCategories(); this._renderOptions(); };
      el.appendChild(row);
    }
  }

  _renderPaints() {
    const el = $('paint-list'); el.innerHTML = '';
    PAINTS.forEach((p, i) => {
      const sw = document.createElement('div');
      sw.className = 'swatch' + (i === this.loadout.paint ? ' active' : '');
      sw.style.background = '#' + p.primary.toString(16).padStart(6, '0');
      sw.style.boxShadow = i === this.loadout.paint ? '0 0 8px #' + p.accent.toString(16).padStart(6,'0') : '';
      sw.title = p.name;
      sw.onclick = () => { this.loadout.paint = i; this._renderPaints(); this._rebuild(); };
      el.appendChild(sw);
    });
  }

  _renderOptions() {
    const cat = CATEGORIES.find(c => c.key === this.activeCat);
    $('options-title').textContent = cat.label + ' / ' + cat.jp;
    const el = $('options-list'); el.innerHTML = '';
    PARTS[this.activeCat].forEach((part, i) => {
      const row = document.createElement('div');
      row.className = 'opt-row' + (i === this.loadout[this.activeCat] ? ' selected' : '');
      row.innerHTML = `<div><span class="opt-name">${part.name}</span><span class="opt-mini">${this._partMini(this.activeCat, part)}</span></div>`;
      row.onclick = () => {
        this.loadout[this.activeCat] = i;
        this._renderOptions(); this._renderCategories(); this._renderStats(); this._rebuild();
      };
      el.appendChild(row);
    });
  }

  _partMini(cat, p) {
    const w = 'W:' + (p.weight || 0);
    if (cat === 'legs')      return `${p.jp} ${w} 積載:${p.load} 速:${p.speed}`;
    if (cat === 'booster')   return `${p.jp} ${w} 倍率:${p.boostMul}x 燃費:${p.drain}`;
    if (cat === 'generator') return `${p.jp} ${w} 出力:${p.output}`;
    if (cat === 'core')      return `${p.jp} ${w} AP:${p.ap} EN:${p.enCap}`;
    if (['rArm','lArm','shoulder'].includes(cat)) {
      if (!p.w) return `${p.jp} ${w}`;
      const wd = p.w;
      if (wd.kind === 'blade')  return `${p.jp} ${w} 近接 DMG:${wd.dmg}`;
      if (wd.kind === 'shield') return `${p.jp} ${w} 被弾-${Math.round(wd.reduce*100)}%`;
      if (wd.kind === 'missile')return `${p.jp} ${w} 誘導 DMGx${wd.count} 弾:${wd.ammo}`;
      return `${p.jp} ${w} DMG:${wd.dmg} 連射:${wd.rate}s 弾:${wd.ammo??'∞'}`;
    }
    return `${p.jp} ${w} AP:${p.ap||0}`;
  }

  _renderStats() {
    const s = computeStats(this.loadout);
    const rows = [
      ['AP',        s.ap,      6000, false],
      ['DEFENSE',   s.defense, 120,  false],
      ['SPEED',     Math.round(s.speed*10)/10, 30, false],
      ['BOOST',     Math.round(s.boost),       90, false],
      ['EN CAP',    s.enCap,   7000, false],
      ['EN OUTPUT', s.enOutput,900,  false],
      ['WEIGHT',    s.weight,  s.load, s.over],
    ];
    const el = $('stats-panel'); el.innerHTML = '';
    for (const [name, val, max, warn] of rows) {
      const pct = clamp((val / max) * 100, 0, 100);
      const row = document.createElement('div'); row.className = 'stat-row';
      row.innerHTML =
        `<span class="stat-name">${name}</span>
         <span class="stat-bar-wrap"><span class="stat-bar-fill${warn ? ' warn' : ''}" style="width:${pct}%"></span></span>
         <span class="stat-num">${val}</span>`;
      el.appendChild(row);
    }
    // load line
    const warn = $('warn-line');
    if (s.over) {
      warn.className = '';
      warn.textContent = `⚠ 積載超過 (${s.weight} / ${s.load})  機動力が大幅に低下します`;
    } else {
      warn.className = 'ok';
      warn.textContent = `✓ 積載OK (${s.weight} / ${s.load})  余裕:${s.load - s.weight}`;
    }
    $('frame-tag').textContent = `${s.parts.legs.name} FRAME · ${s.paint.name}`;
  }
}

/* ════════════════════════════════════════════════════════════
   GAME — quarter-view arena combat
   ════════════════════════════════════════════════════════════ */
const ARENA = 150;

class Game {
  constructor() {
    this._buildScene();
    this._buildArena();
    this.bullets = new Bullets(this.scene);
    this.particles = new Particles(this.scene);
    this.enemies = [];
    this.keys = {};
    this.mouseNDC = new THREE.Vector2(0, 0);
    this.mouseScreen = { x: innerWidth / 2, y: innerHeight / 2 };
    this.aimPoint = new THREE.Vector3();
    this.raycaster = new THREE.Raycaster();
    this.groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -1.5);
    this.clock = new THREE.Clock();
    this.state = 'garage';
    this.shake = 0;
    this.score = 0;
    this.wave = 0;
    this._weapTimers = { rArm: 0, lArm: 0, shoulder: 0 };
    this._fireFlags = { rArm: false, lArm: false, shoulder: false };

    this.garage = new Garage((loadout, stats) => this._sortie(loadout, stats));
    this._bindEvents();
    this._loop();
  }

  /* ── scene ── */
  _buildScene() {
    this.renderer = new THREE.WebGLRenderer({ canvas: $('gameCanvas'), antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x03060e);
    this.scene.fog = new THREE.FogExp2(0x03060e, 0.0045);

    // quarter view — perspective from a fixed diagonal, low FOV = iso-ish
    this.camera = new THREE.PerspectiveCamera(38, innerWidth / innerHeight, 0.5, 800);
    this.camOffset = new THREE.Vector3(40, 52, 40);   // diagonal / down = quarter view
    this.camLook = new THREE.Vector3();

    addEventListener('resize', () => {
      this.renderer.setSize(innerWidth, innerHeight);
      this.camera.aspect = innerWidth / innerHeight;
      this.camera.updateProjectionMatrix();
    });
  }

  _buildArena() {
    this.scene.add(new THREE.AmbientLight(0x556677, 1.7));
    const sun = new THREE.DirectionalLight(0xdcefff, 2.8);
    sun.position.set(80, 160, 60); sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 10; sun.shadow.camera.far = 400;
    const S = 180;
    sun.shadow.camera.left = -S; sun.shadow.camera.right = S;
    sun.shadow.camera.top = S; sun.shadow.camera.bottom = -S;
    this.scene.add(sun);
    // warm fill from opposite side so the far faces of mechs aren't pure black
    const fill = new THREE.DirectionalLight(0xff9966, 0.8); fill.position.set(-90, 60, -70);
    this.scene.add(fill);
    this.scene.add(new THREE.HemisphereLight(0x8899bb, 0x1a2230, 1.1));

    // ground
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(ARENA * 2.4, ARENA * 2.4),
      new THREE.MeshStandardMaterial({ color: 0x0a1420, roughness: 0.95, metalness: 0.1 }));
    ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; this.scene.add(ground);
    const grid = new THREE.GridHelper(ARENA * 2, 60, 0x00ffcc, 0x0a2a33);
    grid.material.opacity = 0.5; grid.material.transparent = true; grid.position.y = 0.02;
    this.scene.add(grid);

    // boundary walls (visual)
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x0a1a2a, metalness: 0.7, roughness: 0.4, emissive: 0x002233, emissiveIntensity: 0.5 });
    const wh = 8;
    for (const [w, d, x, z] of [[ARENA*2, 2, 0, -ARENA], [ARENA*2, 2, 0, ARENA], [2, ARENA*2, -ARENA, 0], [2, ARENA*2, ARENA, 0]]) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(w, wh, d), wallMat);
      wall.position.set(x, wh / 2, z); wall.castShadow = true; this.scene.add(wall);
    }
    // scattered obstacles
    const obMat = new THREE.MeshStandardMaterial({ color: 0x14202e, metalness: 0.6, roughness: 0.5 });
    this.obstacles = [];
    const seedPos = [[-60,-40],[70,20],[30,-80],[-90,60],[100,-60],[-30,90],[0,-30],[-70,-90]];
    for (const [x, z] of seedPos) {
      const h = rand(6, 16), w = rand(6, 12);
      const ob = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), obMat);
      ob.position.set(x, h / 2, z); ob.castShadow = true; ob.receiveShadow = true;
      this.scene.add(ob);
      this.obstacles.push({ x, z, r: w * 0.75 });
    }

    // stars
    const sg = new THREE.BufferGeometry(); const sp = [];
    for (let i = 0; i < 1400; i++) sp.push(rand(-600,600), rand(40,400), rand(-600,600));
    sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
    this.scene.add(new THREE.Points(sg, new THREE.PointsMaterial({ color: 0x99bbdd, size: 0.7 })));
  }

  /* ── events ── */
  _bindEvents() {
    addEventListener('keydown', e => {
      this.keys[e.code] = true;
      if (['Space','KeyW','KeyA','KeyS','KeyD','ShiftLeft'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', e => { this.keys[e.code] = false; });
    addEventListener('mousemove', e => {
      this.mouseScreen.x = e.clientX; this.mouseScreen.y = e.clientY;
      this.mouseNDC.x = (e.clientX / innerWidth) * 2 - 1;
      this.mouseNDC.y = -(e.clientY / innerHeight) * 2 + 1;
      if (this.state === 'playing') { $('crosshair').style.left = e.clientX + 'px'; $('crosshair').style.top = e.clientY + 'px'; }
    });
    addEventListener('mousedown', e => {
      if (e.button === 0) this._fireFlags.rArm = true;
      if (e.button === 2) this._fireFlags.lArm = true;
    });
    addEventListener('mouseup', e => {
      if (e.button === 0) this._fireFlags.rArm = false;
      if (e.button === 2) this._fireFlags.lArm = false;
    });
    addEventListener('contextmenu', e => e.preventDefault());

    $('to-garage-btn').onclick = () => this._enterGarage();
    $('back-title-btn').onclick = () => { this.garage.hide(); $('garage-screen').classList.add('hidden'); $('title-screen').classList.remove('hidden'); this.state = 'title'; };
    $('regarage-btn').onclick = () => { $('result-screen').classList.add('hidden'); this._enterGarage(); };
    $('retry-btn').onclick = () => { $('result-screen').classList.add('hidden'); this._sortie(this.loadout, computeStats(this.loadout)); };
  }

  _enterGarage() {
    $('title-screen').classList.add('hidden');
    $('result-screen').classList.add('hidden');
    $('hud').classList.add('hidden');
    $('garage-screen').classList.remove('hidden');
    this.garage.show();
    this.state = 'garage';
  }

  /* ── sortie: build player mech from loadout ── */
  _sortie(loadout, stats) {
    this.loadout = loadout; this.stats = stats;
    $('garage-screen').classList.add('hidden');
    this.garage.hide();
    $('hud').classList.remove('hidden');

    // clean previous
    if (this.playerMesh) this.scene.remove(this.playerMesh);
    for (const e of this.enemies) if (e.alive) this.scene.remove(e.mesh);
    for (const b of [...this.bullets.active]) this.bullets.retire(b);
    this.enemies = [];

    this.playerMesh = MechBuilder.assemble(loadout);
    this.scene.add(this.playerMesh);
    this.pLight = new THREE.PointLight(stats.paint.accent, 2.2, 30);
    this.pLight.position.y = 5; this.playerMesh.add(this.pLight);

    // player state
    this.player = {
      pos: new THREE.Vector3(0, 1.5, 40),
      vel: new THREE.Vector3(),
      yVel: 0,
      hp: stats.ap, maxHp: stats.ap,
      en: stats.enCap, maxEn: stats.enCap,
      facing: Math.PI,
      grounded: true,
      alive: true,
      pos_y_base: 1.5,
    };
    // ammo pools per weapon slot
    this.ammo = {};
    for (const slot of ['rArm', 'lArm', 'shoulder']) {
      const p = partOf(slot, loadout);
      this.ammo[slot] = (p.w && p.w.ammo != null) ? p.w.ammo : null;
    }
    this._weapTimers = { rArm: 0, lArm: 0, shoulder: 0 };
    this._bladeSwing = 0;

    this._setupWeaponHUD();
    this.score = 0; this.wave = 0;
    this.state = 'playing';
    this._nextWave();
    this._msg('MISSION START', 1600);
  }

  _setupWeaponHUD() {
    const label = (slot, elId, ammoId, rowId) => {
      const p = partOf(slot, this.loadout);
      $(elId).textContent = p.w ? p.name : '—';
      const a = this.ammo[slot];
      $(ammoId).textContent = p.w ? (a == null ? '∞' : a) : '—';
      $(rowId).classList.toggle('dry', !p.w);
    };
    label('rArm', 'w-R', 'ammo-R', 'wrow-R');
    label('lArm', 'w-L', 'ammo-L', 'wrow-L');
    label('shoulder', 'w-S', 'ammo-S', 'wrow-S');
  }

  /* ── waves ── */
  _nextWave() {
    this.wave++;
    const w = this.wave;
    const mul = 1 + (w - 1) * 0.15;
    const spawns = [];
    if (w % 4 === 0) {
      spawns.push(['boss', mul * 1.1]);
      for (let i = 0; i < 2; i++) spawns.push(['gunner', mul]);
    } else {
      const drones = 2 + Math.floor(w * 0.8);
      const gunners = Math.floor(w * 0.6);
      const tanks = Math.floor((w - 1) * 0.35);
      for (let i = 0; i < drones; i++) spawns.push(['drone', mul]);
      for (let i = 0; i < gunners; i++) spawns.push(['gunner', mul]);
      for (let i = 0; i < tanks; i++) spawns.push(['tank', mul]);
    }
    for (const [type, m] of spawns) {
      const a = rand(0, Math.PI * 2), r = rand(70, 120);
      const pos = new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r);
      const e = new Enemy(this.scene, this.bullets, this.particles, type, pos, m);
      this.enemies.push(e);
    }
    const boss = spawns.some(s => s[0] === 'boss');
    $('boss-status').classList.toggle('hidden', !boss);
    if (boss) { this.boss = this.enemies.find(e => e.typeKey === 'boss'); $('boss-name').textContent = 'ARMS-FORT · WAVE ' + w; }
    else this.boss = null;
    $('wave-label').textContent = 'WAVE ' + w;
    this._msg('WAVE ' + w + (boss ? ' — BOSS' : ''), 1600);
  }

  /* ── player update ── */
  _updatePlayer(dt) {
    const p = this.player, s = this.stats, k = this.keys;

    // camera-relative ground basis (from camera matrix — robust orientation)
    const camFwd = new THREE.Vector3(); this.camera.getWorldDirection(camFwd); camFwd.y = 0; camFwd.normalize();
    const camRight = new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 0); camRight.y = 0; camRight.normalize();

    const boosting = (k['ShiftLeft'] || k['ShiftRight']) && p.en > 4;
    const spd = boosting ? s.boost : s.speed;

    const mv = new THREE.Vector3();
    if (k['KeyW']) mv.add(camFwd);
    if (k['KeyS']) mv.sub(camFwd);
    if (k['KeyD']) mv.add(camRight);
    if (k['KeyA']) mv.sub(camRight);
    const moving = mv.lengthSq() > 0;
    if (moving) mv.normalize().multiplyScalar(spd);

    p.vel.lerp(mv, dt * 8);
    p.pos.addScaledVector(p.vel, dt);

    // boost EN drain / regen
    if (boosting && moving) {
      p.en = Math.max(0, p.en - s.boostDrain * dt * (s.enCap / 5000));
      this._boostFx(dt, true);
    } else {
      p.en = Math.min(s.enCap, p.en + s.enOutput * s.enRegen * dt);
      this._boostFx(dt, false);
    }

    // jump / hover (Space)
    if (k['Space'] && p.en > 2) {
      if (p.grounded) { p.yVel = s.jump; p.grounded = false; }
      else { p.yVel += 34 * dt; p.en -= 30 * dt; }   // hover thrust
      p.yVel = Math.min(p.yVel, s.jump);
    }
    p.yVel -= 42 * dt;                                 // gravity
    p.pos.y += p.yVel * dt;
    if (p.pos.y <= p.pos_y_base) { p.pos.y = p.pos_y_base; p.yVel = 0; p.grounded = true; }

    // arena + obstacle collision
    const H = ARENA - 6;
    p.pos.x = clamp(p.pos.x, -H, H); p.pos.z = clamp(p.pos.z, -H, H);
    for (const o of this.obstacles) {
      const dx = p.pos.x - o.x, dz = p.pos.z - o.z;
      const d = Math.hypot(dx, dz), min = o.r + 2.5;
      if (d < min && d > 0.001) { const push = (min - d); p.pos.x += (dx / d) * push; p.pos.z += (dz / d) * push; }
    }

    // aim: ray from mouse to ground plane
    this.raycaster.setFromCamera(this.mouseNDC, this.camera);
    const hit = new THREE.Vector3();
    this.groundPlane.constant = -(p.pos_y_base + 0.5);
    if (this.raycaster.ray.intersectPlane(this.groundPlane, hit)) this.aimPoint.copy(hit);

    // face aim
    const aimDir = this.aimPoint.clone().sub(p.pos); aimDir.y = 0;
    if (aimDir.lengthSq() > 0.1) {
      const targetAng = Math.atan2(aimDir.x, aimDir.z);
      let diff = targetAng - p.facing;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      p.facing += diff * clamp(s.turn * dt, 0, 1);
    }

    this.playerMesh.position.copy(p.pos);
    this.playerMesh.position.y = p.pos.y - p.pos_y_base;  // group feet baseline
    this.playerMesh.rotation.y = p.facing;
    // lean
    const leanZ = -p.vel.dot(camRight) * 0.004;
    this.playerMesh.rotation.z = lerp(this.playerMesh.rotation.z, clamp(leanZ, -0.15, 0.15), 0.1);

    if (this._bladeSwing > 0) this._bladeSwing -= dt;
  }

  _boostFx(dt, on) {
    const b = this.playerMesh.userData.boosters;
    if (!b) return;
    for (const f of b) {
      f.material.opacity = lerp(f.material.opacity, on ? rand(0.6, 0.95) : 0, 0.3);
      f.scale.z = on ? rand(1, 2.4) : 1;
    }
  }

  /* ── weapons ── */
  _aimVector(muzzlePos) {
    const t = this.aimPoint.clone(); t.y = muzzlePos.y;
    return t.sub(muzzlePos).normalize();
  }

  _muzzlePos(slot) {
    const muz = this.playerMesh.userData.muzzles[slot];
    const v = new THREE.Vector3();
    if (muz) muz.getWorldPosition(v); else this.playerMesh.getWorldPosition(v);
    return v;
  }

  _updateWeapons(dt) {
    for (const slot of ['rArm', 'lArm', 'shoulder']) {
      this._weapTimers[slot] = Math.max(0, this._weapTimers[slot] - dt);
      const part = partOf(slot, this.loadout);
      if (!part.w) continue;
      const w = part.w;
      // key map: rArm = LMB, lArm = RMB, shoulder = E
      let firing = false;
      if (slot === 'rArm')      firing = this._fireFlags.rArm;
      else if (slot === 'lArm') firing = this._fireFlags.lArm;
      else                      firing = !!this.keys['KeyE'];

      if (w.kind === 'shield') continue;
      if (!firing || this._weapTimers[slot] > 0) continue;
      // ammo
      if (this.ammo[slot] != null && this.ammo[slot] <= 0) { this._flashDry(slot); continue; }
      // EN weapons
      if (w.en && this.player.en < w.en) continue;

      this._fireWeapon(slot, w);
      this._weapTimers[slot] = w.rate;
      if (this.ammo[slot] != null) this.ammo[slot]--;
      if (w.en) this.player.en = Math.max(0, this.player.en - w.en);
      this._flashWeapon(slot);
      this._updateAmmoHUD(slot);
    }
  }

  _fireWeapon(slot, w) {
    const origin = this._muzzlePos(slot);
    const dir = this._aimVector(origin);

    if (w.kind === 'blade') {
      this._bladeSwing = 0.25;
      // damage enemies in arc in front
      const fwd = new THREE.Vector3(Math.sin(this.player.facing), 0, Math.cos(this.player.facing));
      for (const e of this.enemies) {
        if (!e.alive) continue;
        const to = e.pos.clone().sub(this.player.pos); to.y = 0;
        if (to.length() < w.range + 2 && to.normalize().dot(fwd) > Math.cos(w.arc)) {
          e.takeDamage(w.dmg, e.pos.clone().add(new THREE.Vector3(0, e.mesh.userData.centerY, 0)));
        }
      }
      const fx = this.player.pos.clone().add(fwd.multiplyScalar(w.range * 0.6)); fx.y = 3;
      this.particles.spawn(fx, { count: 14, color: w.color, speed: 10, grav: false });
      this.shake = Math.max(this.shake, 0.25);
      return;
    }

    const count = w.count || 1;
    const shape = w.big ? 'big' : (w.beam ? 'beam' : 'b');
    for (let i = 0; i < count; i++) {
      let d = dir.clone();
      if (w.spread) {
        const sp = (count > 1 ? (i / (count - 1) - 0.5) : 0) * w.spread * 2 + rand(-1, 1) * w.spread * 0.4 * this.stats.recoil;
        d.applyAxisAngle(new THREE.Vector3(0, 1, 0), sp);
      }
      const speed = w.speed;
      if (w.kind === 'missile') {
        // spread launch then home
        const launch = d.clone().applyAxisAngle(new THREE.Vector3(0,1,0), (i/(count)-0.5) * 0.6);
        launch.y = 0.4;
        this.bullets.fire({ pos: origin.clone(), vel: launch.normalize().multiplyScalar(speed), dmg: w.dmg, shape: 'missile', color: w.color, life: 5, splash: 3, homing: true });
      } else {
        this.bullets.fire({ pos: origin.clone(), vel: d.multiplyScalar(speed), dmg: w.dmg, shape, color: w.color, life: w.range ? w.range / speed * 8 : 3.5, splash: w.splash || 0 });
      }
    }
    this.particles.spawn(origin, { count: w.big ? 6 : 3, color: w.color, speed: 5, grav: false, size: 0.2 });
    if (w.big) this.shake = Math.max(this.shake, 0.35);
  }

  _flashWeapon(slot) { const r = $('wrow-' + slot[0].toUpperCase()); if (r){ r.classList.add('flash'); setTimeout(()=>r.classList.remove('flash'),60);} }
  _flashDry(slot) { const r = $('wrow-' + slot[0].toUpperCase()); if (r) r.classList.add('dry'); }
  _updateAmmoHUD(slot) {
    const id = { rArm: 'ammo-R', lArm: 'ammo-L', shoulder: 'ammo-S' }[slot];
    const a = this.ammo[slot];
    $(id).textContent = a == null ? '∞' : a;
  }

  /* ── camera ── */
  _updateCamera(dt) {
    const p = this.player.pos;
    const ideal = p.clone().add(this.camOffset);
    if (this.shake > 0) {
      ideal.x += rand(-1, 1) * this.shake * 2;
      ideal.z += rand(-1, 1) * this.shake * 2;
      this.shake = Math.max(0, this.shake - dt * 2.5);
    }
    this.camera.position.lerp(ideal, dt * 6);
    this.camLook.lerp(p, dt * 8);
    this.camera.lookAt(this.camLook.x, this.camLook.y + 3, this.camLook.z);
  }

  /* ── collisions ── */
  _collisions() {
    const p = this.player;
    for (const b of [...this.bullets.active]) {
      if (!b.on) continue;
      const bp = b.mesh.position;
      if (!b.foe) {
        // player bullet vs enemies
        for (const e of this.enemies) {
          if (!e.alive) continue;
          const c = e.pos.clone(); c.y = e.mesh.userData.centerY;
          const hitR = (e.cfg.scale * 2.2) + (b.splash ? b.splash : 0.6);
          if (bp.distanceTo(c) < hitR) {
            e.takeDamage(b.dmg, bp.clone());
            if (b.splash) {
              this.particles.spawn(bp, { count: 12, color: 0xffaa44, speed: 10 });
              for (const e2 of this.enemies) { if (e2 !== e && e2.alive) { const cc = e2.pos.clone(); cc.y = e2.mesh.userData.centerY; if (cc.distanceTo(bp) < b.splash + 2) e2.takeDamage(b.dmg * 0.5, cc); } }
              this.shake = Math.max(this.shake, 0.3);
            }
            this._onEnemyHit(e);
            this.bullets.retire(b);
            break;
          }
        }
      } else {
        // enemy bullet vs player
        const c = p.pos.clone(); c.y += 2.4;
        if (bp.distanceTo(c) < 2.6) {
          this._damagePlayer(b.dmg);
          this.particles.spawn(bp, { count: 6, color: 0x66ddff, speed: 8 });
          if (b.splash) this.shake = Math.max(this.shake, 0.4);
          this.bullets.retire(b);
        }
      }
    }
    // enemy body contact (rush drones) — light continuous damage + knockback
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const d = Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z);
      if (d < e.cfg.scale * 2 + 2.2) {
        this._damagePlayer(e.cfg.dmg * this._dt * 0.6);
        const away = new THREE.Vector3(p.pos.x - e.pos.x, 0, p.pos.z - e.pos.z).normalize();
        e.pos.addScaledVector(away, -0.5);
      }
    }
  }

  _onEnemyHit(e) {
    if (!e.alive) {
      this.score += e.cfg.score;
      $('score-label').textContent = 'SCORE ' + this.score;
    }
  }

  _damagePlayer(dmg) {
    const s = this.stats;
    // shield reduction if equipped and holding RMB
    let reduce = 1;
    const l = partOf('lArm', this.loadout);
    if (l.w && l.w.kind === 'shield' && this._fireFlags.lArm) reduce = 1 - l.w.reduce;
    // defense soak
    const eff = dmg * reduce * (1 - clamp(s.defense / 300, 0, 0.6));
    this.player.hp = Math.max(0, this.player.hp - eff);
    if (eff > 8) {   // real hit — flash + shake (skip trivial contact ticks)
      this.shake = Math.max(this.shake, 0.3);
      document.body.classList.remove('damage-flash');
      void document.body.offsetWidth;
      document.body.classList.add('damage-flash');
    }
    if (this.player.hp <= 0 && this.player.alive) { this.player.alive = false; this._end(false); }
  }

  /* ── HUD ── */
  _updateHUD() {
    const p = this.player, s = this.stats;
    $('ap-bar').style.width = (p.hp / p.maxHp * 100) + '%';
    $('en-bar').style.width = (p.en / s.enCap * 100) + '%';
    $('ap-val').textContent = Math.ceil(p.hp);
    const bf = $('boost-flag');
    bf.textContent = p.en > s.enCap * 0.15 ? 'BOOST READY' : 'EN LOW';
    bf.classList.toggle('empty', p.en <= s.enCap * 0.15);
    const alive = this.enemies.filter(e => e.alive).length;
    $('enemies-left').textContent = 'ENEMIES ' + alive;
    if (this.boss && this.boss.alive) {
      $('boss-bar').style.width = (this.boss.hp / this.boss.maxHp * 100) + '%';
    }
  }

  _msg(t, dur = 1500) { const el = $('center-info'); el.textContent = t; clearTimeout(this._mt); this._mt = setTimeout(() => el.textContent = '', dur); }

  /* ── end ── */
  _end(win) {
    this.state = win ? 'clear' : 'dead';
    $('hud').classList.add('hidden');
    const rs = $('result-screen'); rs.classList.remove('hidden');
    $('result-title').textContent = win ? 'MISSION COMPLETE' : 'DESTROYED';
    $('result-title').style.color = win ? '#00ffcc' : '#ff3344';
    $('result-sub').textContent = win ? 'すべての敵を撃破した' : '機体大破 — AP消失';
    $('result-stats').innerHTML = `WAVE 到達: <b>${this.wave}</b><br>SCORE: <b>${this.score}</b>`;
    if (this.playerMesh) { this.scene.remove(this.playerMesh); }
  }

  /* ── loop ── */
  _loop() {
    requestAnimationFrame(() => this._loop());
    const dt = Math.min(this.clock.getDelta(), 0.05);
    this._dt = dt;

    if (this.state === 'playing') {
      this._updatePlayer(dt);
      this._updateWeapons(dt);
      this._updateCamera(dt);
      for (const e of this.enemies) e.update(dt, this.player);
      this.bullets.update(dt, this.enemies);
      this.particles.update(dt);
      this._collisions();
      this._updateHUD();

      // wave clear check
      if (this.enemies.length && this.enemies.every(e => !e.alive)) {
        this.enemies = [];
        if (this.wave >= 8) { this._end(true); }
        else { this._nextWave(); }
      }
      this.renderer.render(this.scene, this.camera);
    } else if (this.state === 'garage') {
      this.garage && this.garage.animate(dt);
    } else {
      // idle title/result camera drift
      this.camera.position.set(Math.sin(Date.now() * 0.0002) * 60, 55, Math.cos(Date.now() * 0.0002) * 60);
      this.camera.lookAt(0, 4, 0);
      this.renderer.render(this.scene, this.camera);
    }
  }
}

/* ─────────── init ─────────── */
addEventListener('DOMContentLoaded', () => {
  $('title-screen').classList.remove('hidden');
  window._game = new Game();
  window._game.state = 'title';
});

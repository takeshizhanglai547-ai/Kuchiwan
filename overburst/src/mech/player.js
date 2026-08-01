// ============================================================
//  Player — movement physics (QB/AB/hover), EN economy, ACS/stagger,
//  repair kits, lock-on and the third-person camera.
//  [owned by player-movement agent]
//
//  CONTRACT
//    new Player(ctx); .init(); .update(dt); .updateCamera(dt); .reset()
//    fields: root(Object3D) mech pos(Vector3) vel(Vector3) yaw pitch
//            ap apMax en enMax acs acsMax staggered grounded boosting
//            abActive qbTimer lockTarget hardLock repairKits alive
//    .takeDamage({amount, impact, acs, source, point, direct})
//    .aimRay(out?) -> {origin:Vector3, dir:Vector3}   authoritative firing ray
//    .worldMuzzle(name, out) -> Vector3
//
//  EXTRAS (additive, safe for HUD / weapons / enemies to read)
//    .speed .enFrac .apFrac .acsFrac .qbReady(0..1) .enOverload .enLock
//    .repairing .repairProgress .lockList[] .lockAngle .outOfBounds
//    .height .kind('player') .cam (ChaseCamera)
//    .aimPoint(out, maxDist) -> world point under the reticle
//    .targetPoint(entity, out) -> centre-of-mass aim point for any entity
//    .addImpulse(x, y, z)  .knockback(fromVec3, power)
//
//  MOVEMENT MODEL
//    Quake-style: drag is applied first, then acceleration only tops the
//    velocity up TO the wish speed along the wish direction — it never
//    subtracts.  That is what makes a quick boost feel like a real impulse:
//    the overspeed is preserved and bleeds off through drag instead of
//    being lerped away, and reduced drag during the QB window carries it.
// ============================================================
import * as THREE from 'three';
import { CFG } from '../config.js';
import { ACTIONS } from '../core/input.js';
import { clamp, angleDelta, rand } from '../util/math.js';
import { buildPlayerMech } from './mechModel.js';
import { CapsuleSolver } from './playerCollide.js';
import { ChaseCamera } from './playerCamera.js';

const P = CFG.PLAYER;

// ---- feel constants that are local to this system -----------------
const AB_HOLD = 0.15;        // s of held QB before assault boost ignites
const ACCEL_GROUND = 190;    // u/s^2 boost-glide on the deck
const ACCEL_WALK = 118;      // u/s^2 while EN is redlined
const ACCEL_AIR = 112;       // u/s^2 airborne authority
const AIR_VDRAG = 0.42;      // vertical bleed so falls read heavy, not stony
const V_TERMINAL = -155;
const V_ASCEND_MAX = 44;
const QB_TAIL = 150;         // u/s^2 thrust tail during the QB window
const STAGGER_AUTH = 0.22;   // input authority while staggered
const REPAIR_AUTH = 0.42;
const LAND_HARD = 22;        // |vy| that counts as a hard landing
const EYE_H = 8.9;
const WALL_MARGIN = 56;      // soft wall starts this far inside ARENA.RADIUS
const WALL_TURN = 2.1;       // rad/s the boundary is allowed to carve the run
const WALL_YAW = 1.4;        // rad/s the heading follows that carve

// scratch — nothing in the hot path allocates
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _wish = new THREE.Vector3();
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _thr = new THREE.Vector3();
const _exh = new THREE.Vector3();
const _npos = new THREE.Vector3();
const _EMPTY = [];
// reused option bags — the thruster loop runs 12x every frame
const _thrOpt = { radius: 0.5, owner: 'player', seed: 0 };
const _sparkOpt = { count: 10, spread: 0.8, speedMax: 46 };

export class Player {
  constructor(ctx) {
    this.ctx = ctx;
    this.kind = 'player';
    this.height = P.HEIGHT;
    this.radius = P.RADIUS;

    this.pos = new THREE.Vector3(0, 0, 150);
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = -0.06;

    this.ap = P.AP; this.apMax = P.AP;
    this.en = P.EN_CAP; this.enMax = P.EN_CAP;
    this.acs = 0; this.acsMax = P.ACS_CAP;

    this.grounded = true;
    this.boosting = false;
    this.abActive = false;
    this.staggered = false;
    this.alive = true;

    this.qbTimer = 0;
    this.qbCooldown = 0;
    this.qbDirX = 0; this.qbDirZ = -1;

    this.enDelay = 0;
    this.enLock = 0;
    this.enOverload = false;

    this.acsDelay = 0;
    this.staggerTimer = 0;

    this.repairKits = P.REPAIR_KITS;
    this.repairing = false;
    this.repairProgress = 0;

    this.lockTarget = null;
    this.hardLock = false;
    this.lockList = [];
    this.lockAngle = Math.PI;
    this.outOfBounds = false;
    this._boundsWarn = 0;

    this.speed = 0;
    this.thrustLevel = 0;

    // internals
    this._axes = { x: 0, z: 0 };
    this._qbHeld = 0;
    this._prevVy = 0;
    this._t = 0;
    this._legYaw = 0;
    this._bodyYaw = 0;
    this._ray = { origin: new THREE.Vector3(), dir: new THREE.Vector3() };
    this._aimDir = new THREE.Vector3(0, 0, -1);
    this._eye = new THREE.Vector3();
    this._hit = { point: new THREE.Vector3(), normal: new THREE.Vector3(), distance: Infinity };
    this._probe = { point: new THREE.Vector3(), normal: new THREE.Vector3(), distance: Infinity };
    this._lockDirty = false;
    this._visualFrame = -1;
    this._damageVis = 0;
  }

  // ================================================================
  init() {
    const m = buildPlayerMech();
    this.mech = m;
    this.root = m.root;
    this.thrusters = m.thrusters || _EMPTY;
    this.ctx.scene.add(this.root);

    this.solver = new CapsuleSolver(this.ctx.world);
    this.cam = new ChaseCamera(this.ctx, this);

    // we drive every nozzle ourselves — see _driveThrusters()
    if (this.ctx.vfx) this.ctx.vfx.autoThrusters = false;

    // share the world's IBL so the mech sits in the same light as the arena
    const env = this.ctx.scene.environment;
    if (env && m.api.setEnvironment) m.api.setEnvironment(env, 0.85);

    this._placeAtSpawn();
    this.cam.reset();
  }

  // ----------------------------------------------------------------
  reset() {
    this.vel.set(0, 0, 0);
    this.ap = this.apMax;
    this.en = this.enMax;
    this.acs = 0;
    this.acsDelay = 0;
    this.staggerTimer = 0;
    this.staggered = false;
    this.alive = true;
    this.abActive = false;
    this.qbTimer = 0; this.qbCooldown = 0; this._qbHeld = 0;
    this.enDelay = 0; this.enLock = 0; this.enOverload = false;
    this.repairKits = P.REPAIR_KITS;
    this.repairing = false; this.repairProgress = 0;
    this.lockTarget = null; this.hardLock = false;
    this.lockList.length = 0;
    this.outOfBounds = false;
    this._boundsWarn = 0;
    this._damageVis = 0;
    this.mech?.api.setDamage(0);
    this._placeAtSpawn();
    this.cam.reset();
  }

  _placeAtSpawn() {
    const w = this.ctx.world;
    const sp = w?.spawnPoints?.player;
    if (sp) this.pos.copy(sp);
    else this.pos.set(0, 0, 150);
    if (w?.sampleHeight) this.pos.y = w.sampleHeight(this.pos.x, this.pos.z, Infinity) + 0.05;
    this.yaw = this._pickHeading();
    this.pitch = -0.05;
    this._legYaw = this.yaw;
    this._bodyYaw = this.yaw;
    this.grounded = true;
    this.root.position.copy(this.pos);
    this.root.rotation.y = this.yaw;
  }

  /**
   * Insertion heading. An AC is dropped facing its approach route, not a
   * wall.  Aim at the nearest objective (pylon, else the arena centre),
   * then sweep a fan of capsule-wide lane marches and take the longest
   * traversable one, biased hard toward that objective bearing.
   * Runs once per mission start.
   */
  _pickHeading() {
    const w = this.ctx.world;
    let tx = 0, tz = 0;
    const py = w?.spawnPoints?.pylons;
    if (py && py.length) {
      let bd = Infinity;
      for (let i = 0; i < py.length; i++) {
        const dx = py[i].x - this.pos.x, dz = py[i].z - this.pos.z;
        const d = dx * dx + dz * dz;
        if (d < bd) { bd = d; tx = py[i].x; tz = py[i].z; }
      }
    }
    const toObj = Math.atan2(-(tx - this.pos.x), -(tz - this.pos.z));
    if (!w || !w.sampleHeight || !this.solver) return toObj;
    let bestYaw = toObj, bestScore = -Infinity;
    for (let a = -120; a <= 120; a += 6) {
      const rad = (a * Math.PI) / 180;
      const clear = this._laneClear(toObj + rad, 520);
      const score = Math.min(clear, 460) - Math.abs(rad) * 118;
      if (score > bestScore) { bestScore = score; bestYaw = toObj + rad; }
    }
    return bestYaw;
  }

  /**
   * March a capsule along a heading, tracking the walkable surface exactly
   * the way the mover does.  A horizontal raycast lies here — the basin
   * descends, so a ray that clears a terrace wall from the rim would still
   * hit it once the mech has dropped into the bowl.
   */
  _laneClear(yaw, maxDist) {
    const w = this.ctx.world;
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    const STEPD = 5;
    const CORRIDOR = P.RADIUS * 1.32;   // room for the run to wander
    let y = this.pos.y;
    for (let d = STEPD; d <= maxDist; d += STEPD) {
      const x = this.pos.x + fx * d;
      const z = this.pos.z + fz * d;
      if (x * x + z * z > CFG.ARENA.RADIUS * CFG.ARENA.RADIUS) return d;
      const gy = w.sampleHeight(x, z, y + 0.5);
      if (gy - y > 3.5) return d;                   // an unclimbable step
      y = gy;
      if (this.solver.blocked(x, z, y, CORRIDOR, P.HEIGHT)) return d;
    }
    return maxDist;
  }

  // ================================================================
  //  main tick
  // ================================================================
  update(dt) {
    const ctx = this.ctx;
    const inp = ctx.input;
    const d = dt > 0 ? Math.min(dt, 0.1) : 1 / 60;
    this._t += d;

    // ---- look ----------------------------------------------------
    if (this.alive) {
      this.yaw -= inp.dx * CFG.CAM.SENS;
      this.pitch = clamp(this.pitch - inp.dy * CFG.CAM.SENS, CFG.CAM.PITCH_MIN, CFG.CAM.PITCH_MAX);
    }

    // ---- timers --------------------------------------------------
    if (this.qbCooldown > 0) this.qbCooldown -= d;
    if (this.qbTimer > 0) this.qbTimer -= d;
    if (this.enDelay > 0) this.enDelay -= d;
    if (this.acsDelay > 0) this.acsDelay -= d;

    if (this.enLock > 0) {
      this.enLock -= d;
      if (this.enLock <= 0) {
        this.enLock = 0;
        this.enOverload = false;
        this.en = this.enMax * 0.30;
        this.enDelay = 0;
        ctx.bus.emit('hud', { type: 'warning', id: 'en', text: 'EN RESTORED', level: 'info' });
      }
    }

    // ---- stagger -------------------------------------------------
    if (this.staggered) {
      this.staggerTimer -= d;
      if (this.staggerTimer <= 0) { this.staggered = false; this.acs = 0; }
    } else if (this.acs > 0 && this.acsDelay <= 0) {
      this.acs = Math.max(0, this.acs - P.ACS_DECAY * d);
    }

    // ---- repair kit ----------------------------------------------
    this._updateRepair(d, inp);

    // ---- basis ---------------------------------------------------
    _fwd.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    _right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));

    // ---- input ---------------------------------------------------
    const dead = !this.alive;
    const ax = dead ? (this._axes.x = 0, this._axes.z = 0, this._axes) : inp.axes(this._axes);
    let auth = 1;
    if (this.staggered) auth = STAGGER_AUTH;
    else if (this.repairing) auth = REPAIR_AUTH;
    if (dead) auth = 0;

    const qbHeld = !dead && inp.isDown(ACTIONS.QB);
    const qbTap = !dead && inp.wasPressed(ACTIONS.QB);
    const ascend = !dead && auth > 0.5 && inp.isDown(ACTIONS.ASCEND);
    const ascendTap = !dead && auth > 0.5 && inp.wasPressed(ACTIONS.ASCEND);
    const descend = !dead && inp.isDown(ACTIONS.DESCEND);
    this._qbHeld = qbHeld ? this._qbHeld + d : 0;

    const moving = (ax.x !== 0 || ax.z !== 0) && auth > 0;
    _wish.set(0, 0, 0);
    if (moving) {
      _wish.addScaledVector(_fwd, ax.z).addScaledVector(_right, ax.x);
      if (_wish.lengthSq() > 1e-6) _wish.normalize();
    }

    // ---- lock-on -------------------------------------------------
    this._updateLock(d, inp, dead);

    // ---- quick boost ---------------------------------------------
    if (qbTap && !dead && !this.staggered && !this.repairing && this.qbCooldown <= 0 && this.enLock <= 0) {
      this._quickBoost(moving ? _wish.x : -_fwd.x, moving ? _wish.z : -_fwd.z);
    }

    // ---- assault boost -------------------------------------------
    this._updateAssault(d, qbHeld, qbTap, ax, auth);

    // ---- horizontal drive ----------------------------------------
    const walkMode = this.enOverload;
    let wishSpeed, accel;
    if (this.abActive) {
      wishSpeed = P.AB_SPEED;
      accel = P.AB_ACCEL;
      // assault boost tracks the facing; steering authority is deliberately low
      _wish.copy(_fwd).addScaledVector(_right, ax.x * 0.22);
      _wish.y = 0;
      if (_wish.lengthSq() > 1e-6) _wish.normalize();
    } else if (walkMode) {
      wishSpeed = P.WALK_SPEED; accel = this.grounded ? ACCEL_WALK : ACCEL_AIR;
    } else {
      wishSpeed = P.BOOST_SPEED; accel = this.grounded ? ACCEL_GROUND : ACCEL_AIR;
    }
    wishSpeed *= auth === 1 ? 1 : Math.max(0.25, auth);
    accel *= auth;

    // drag first, then top-up: preserves quick-boost overspeed
    let drag;
    if (this.abActive) drag = this.grounded ? 0.9 : 0.55;
    else if (!this.grounded) drag = P.AIR_DRAG;
    else if (moving) drag = walkMode ? P.GROUND_DRAG * 0.62 : P.BOOST_DRAG;
    else drag = P.GROUND_DRAG;
    if (this.qbTimer > 0) drag *= P.QB_DRAG_BOOST;
    if (this.staggered) drag *= 1.6;

    const dk = Math.exp(-drag * d);
    this.vel.x *= dk;
    this.vel.z *= dk;

    if (this.abActive || moving) {
      const cur = this.vel.x * _wish.x + this.vel.z * _wish.z;
      const room = wishSpeed - cur;
      if (room > 0) {
        const add = Math.min(accel * d, room);
        this.vel.x += _wish.x * add;
        this.vel.z += _wish.z * add;
      }
    }

    // quick-boost thrust tail — short, decaying, keeps the burst alive
    if (this.qbTimer > 0) {
      const k = this.qbTimer / P.QB_DURATION;
      const a = QB_TAIL * k * k * d;
      this.vel.x += this.qbDirX * a;
      this.vel.z += this.qbDirZ * a;
    }

    // ---- vertical ------------------------------------------------
    this._prevVy = this.vel.y;
    if (ascend && this._drainEN(P.HOVER_EN_DRAIN, d)) {
      if (ascendTap && this.grounded) this.vel.y = Math.max(this.vel.y, P.JUMP_IMPULSE);
      else this.vel.y += P.HOVER_THRUST * d;
      if (this.vel.y > V_ASCEND_MAX) this.vel.y = V_ASCEND_MAX;
      this.grounded = false;
    } else {
      if (!this.grounded) {
        this.vel.y -= P.GRAVITY * d;
        if (descend) this.vel.y -= P.DESCEND_THRUST * d;
        this.vel.y *= Math.exp(-AIR_VDRAG * d);
        if (this.vel.y < V_TERMINAL) this.vel.y = V_TERMINAL;
      } else if (this.vel.y > 0) {
        this.vel.y -= P.GRAVITY * d;
      }
    }

    // ---- integrate + collide -------------------------------------
    this._move(d, ascend);

    // ---- arena bounds --------------------------------------------
    this._bounds(d);

    // ---- EN recharge ---------------------------------------------
    if (this.enLock <= 0 && this.enDelay <= 0 && this.en < this.enMax) {
      const rate = this.grounded ? P.EN_RECHARGE : P.EN_RECHARGE_AIR;
      this.en = Math.min(this.enMax, this.en + rate * d);
    }

    // ---- derived --------------------------------------------------
    this.speed = Math.hypot(this.vel.x, this.vel.z);
    this.boosting = !this.grounded || this.abActive || this.qbTimer > 0
      || this.speed > P.WALK_SPEED * 1.15;

    this._driveMech(d, moving, ascend, descend);
    this._visualFrame = ctx.frame;
  }

  // ----------------------------------------------------------------
  //  translation with sub-stepping so nothing tunnels at 146 u/s
  // ----------------------------------------------------------------
  _move(d, ascend) {
    const solver = this.solver;
    const wasGrounded = this.grounded;
    const len = Math.hypot(this.vel.x, this.vel.y, this.vel.z) * d;
    const steps = clamp(Math.ceil(len / (P.RADIUS * 0.55)), 1, 8);
    const sdt = d / steps;
    const snap = wasGrounded && !ascend;

    let grounded = false;
    let hitSpeed = 0, hnx = 0, hnz = 0;
    for (let i = 0; i < steps; i++) {
      const py = this.pos.y;
      this.pos.x += this.vel.x * sdt;
      this.pos.y += this.vel.y * sdt;
      this.pos.z += this.vel.z * sdt;

      solver.push(this.pos, this.vel, P.RADIUS, P.HEIGHT);
      if (solver.impactSpeed > hitSpeed) {
        hitSpeed = solver.impactSpeed; hnx = solver.nx; hnz = solver.nz;
      }
      solver.ceiling(this.pos, this.vel, P.RADIUS, P.HEIGHT);
      const g = solver.ground(this.pos, this.vel, py, snap && this.vel.y <= 0.5);
      grounded = g === g;   // NaN check
    }

    if (this.pos.y > CFG.ARENA.CEILING) {
      this.pos.y = CFG.ARENA.CEILING;
      if (this.vel.y > 0) this.vel.y = 0;
    }

    // --- wall slam: bleed ACS-free but shake the frame -------------
    if (hitSpeed > 46) {
      const k = clamp(hitSpeed / 150, 0, 1);
      this._shake(0.28 + k * 0.5, 0.16 + k * 0.12);
      if (this.abActive && k > 0.5) this._endAssault();
      const v = _v.set(this.pos.x - hnx * P.RADIUS, this.pos.y + P.HEIGHT * 0.5,
        this.pos.z - hnz * P.RADIUS);
      _v2.set(hnx, 0, hnz);
      _sparkOpt.count = 8 + ((k * 12) | 0);
      this.ctx.vfx?.sparks?.(v, _v2, _sparkOpt);
    }

    // --- landing ---------------------------------------------------
    if (grounded && !wasGrounded) this._onLand();
    this.grounded = grounded;
  }

  _onLand() {
    const vy = this._prevVy;
    const ctx = this.ctx;
    this.cam.landing(vy);
    if (-vy > LAND_HARD) {
      const k = clamp(-vy / 110, 0, 1);
      _v.copy(this.pos); _v.y += 0.4;
      ctx.vfx?.dust?.(_v, 5 + ((k * 10) | 0), 1.0 + k * 1.4);
      this._shake(0.22 + k * 0.62, 0.18 + k * 0.14);
      if (k > 0.45) {
        _v2.set(rand(-1, 1), rand(0.3, 0.9), rand(-1, 1)).normalize();
        _sparkOpt.count = 6;
        ctx.vfx?.sparks?.(_v, _v2, _sparkOpt);
      }
    }
  }

  _bounds(d) {
    const r = Math.hypot(this.pos.x, this.pos.z);
    // Start pushing back INSIDE the nominal radius: the perimeter structures
    // live right on it, and a 146 u/s slam into a blast wall is a worse
    // "you have left the operation area" than a firm shove.
    const R = CFG.ARENA.RADIUS - WALL_MARGIN;
    // The warning sits further out than the shove, with hysteresis, so a
    // boundary run gets nudged quietly instead of strobing the whole HUD.
    if (this._boundsWarn > 0) this._boundsWarn -= d;
    if (r > CFG.ARENA.RADIUS - 18) {
      this.outOfBounds = true;
      if (this._boundsWarn <= 0) {
        this._boundsWarn = 4.0;
        this.ctx.bus.emit('hud', { type: 'warning', text: 'LEAVING OPERATION AREA', dur: 1.4, amber: true });
      }
    } else if (r <= R) {
      this.outOfBounds = false;
    }
    if (r <= R) return;
    const inv = 1 / Math.max(1e-3, r);
    const nx = -this.pos.x * inv, nz = -this.pos.z * inv;
    const k = clamp((r - R) / 42, 0, 1);

    // Carve, don't brake. Rotate the velocity vector toward the inside at a
    // bounded rate — speed is preserved exactly — and let the mech's own
    // heading follow it a beat later, so a boundary run reads as a banked
    // high-speed turn (the camera rolls into it) instead of a face-plant.
    const spd = Math.hypot(this.vel.x, this.vel.z);
    if (spd > 3) {
      const cur = Math.atan2(this.vel.z, this.vel.x);
      const want = Math.atan2(nz, nx);
      const dA = angleDelta(cur, want);
      const step = clamp(dA, -WALL_TURN * k * d, WALL_TURN * k * d);
      const cs = Math.cos(step), sn = Math.sin(step);
      const vx = this.vel.x, vz = this.vel.z;
      this.vel.x = vx * cs - vz * sn;
      this.vel.z = vx * sn + vz * cs;
      const wantYaw = Math.atan2(-nx, -nz);
      const yStep = WALL_YAW * k * d;
      this.yaw += clamp(angleDelta(this.yaw, wantYaw), -yStep, yStep);
    }
    this.vel.x += nx * 150 * k * d;
    this.vel.z += nz * 150 * k * d;
    const hard = CFG.ARENA.RADIUS + 6;
    if (r > hard) {
      this.pos.x += nx * (r - hard);
      this.pos.z += nz * (r - hard);
      const vn = this.vel.x * nx + this.vel.z * nz;
      if (vn < 0) { this.vel.x -= nx * vn; this.vel.z -= nz * vn; }
    }
  }

  // ================================================================
  //  quick boost — the core verb
  // ================================================================
  _quickBoost(dx, dz) {
    const l = Math.hypot(dx, dz);
    if (l < 1e-4) return;
    dx /= l; dz /= l;

    if (!this._spendEN(P.QB_EN_COST)) return;

    const vel = this.vel;
    const along = vel.x * dx + vel.z * dz;
    // scrub part of the perpendicular so 8-way direction changes are crisp
    const px = vel.x - dx * along, pz = vel.z - dz * along;
    vel.x -= px * 0.42;
    vel.z -= pz * 0.42;
    // hard injection: always at least the full impulse in the new direction
    const target = Math.max(along + P.QB_IMPULSE * 0.52, P.QB_IMPULSE);
    vel.x += dx * (target - along);
    vel.z += dz * (target - along);
    if (this.grounded) vel.y = Math.max(vel.y, 4.5);
    else if (vel.y < 0) vel.y *= 0.42;

    this.qbTimer = P.QB_DURATION;
    this.qbCooldown = P.QB_RELOAD;
    this.qbDirX = dx; this.qbDirZ = dz;
    this.grounded = false;

    // --- signature ------------------------------------------------
    const ctx = this.ctx;
    _v.set(this.pos.x, this.pos.y + P.HEIGHT * 0.56, this.pos.z);
    _v2.set(dx, 0, dz);
    ctx.vfx?.quickBoost?.(_v, _v2, this.root);
    this.cam.quickBoostKick(dx, dz);
    this._shake(0.30, 0.14);
    ctx.bus.emit('hud', { type: 'qb' });
  }

  _updateAssault(d, qbHeld, qbTap, ax, auth) {
    if (this.abActive) {
      const stop = !qbHeld || qbTap || ax.z < 0.2 || this.staggered
        || this.repairing || !this.alive || auth < 1;
      if (stop || !this._drainEN(P.AB_EN_DRAIN, d)) this._endAssault();
      return;
    }
    if (!qbHeld || qbTap || ax.z < 0.5 || auth < 1) return;
    if (this._qbHeld < AB_HOLD || this.qbTimer > 0) return;
    if (this.staggered || this.repairing || this.enLock > 0) return;
    if (this.en < P.AB_IGNITION * 1.1) return;
    if (!this._spendEN(P.AB_IGNITION)) return;
    this.abActive = true;
    this._shake(0.24, 0.30);
    this.ctx.bus.emit('hud', { type: 'ab', on: true });
  }

  _endAssault() {
    if (!this.abActive) return;
    this.abActive = false;
    this.ctx.bus.emit('hud', { type: 'ab', on: false });
  }

  // ================================================================
  //  EN economy — spend, drain, redline lockout
  // ================================================================
  _spendEN(amount) {
    if (this.enLock > 0) return false;
    this.enDelay = P.EN_RECOVERY_DELAY;
    if (amount >= this.en) { this.en = 0; this._redline(); return false; }
    this.en -= amount;
    return true;
  }

  _drainEN(rate, d) {
    if (this.enLock > 0) return false;
    const a = rate * d;
    this.enDelay = P.EN_RECOVERY_DELAY;
    if (a >= this.en) { this.en = 0; this._redline(); return false; }
    this.en -= a;
    return true;
  }

  _redline() {
    if (this.enOverload) return;
    this.enOverload = true;
    this.enLock = P.EN_REDLINE_DELAY;
    this._endAssault();
    this.ctx.bus.emit('hud', { type: 'warning', id: 'en', text: 'EN OVERLOAD', level: 'danger' });
    this.ctx.postfx?.flash?.(0xff3b30, 0.10);
  }

  // ================================================================
  //  repair kit — heals on completion, vulnerable while it runs
  // ================================================================
  _updateRepair(d, inp) {
    if (this.repairing) {
      this.repairProgress += d / P.REPAIR_TIME;
      if (this.repairProgress >= 1) {
        this.repairing = false;
        this.repairProgress = 0;
        this.ap = Math.min(this.apMax, this.ap + P.REPAIR_AMOUNT);
        this._damageVis = clamp(1 - this.ap / this.apMax, 0, 1);
        this.mech?.api.setDamage(this._damageVis * 0.8);
        this.ctx.bus.emit('hud', { type: 'repair', kits: this.repairKits, done: true });
      }
      return;
    }
    if (!this.alive || this.staggered) return;
    if (!inp.wasPressed(ACTIONS.REPAIR)) return;
    if (this.repairKits <= 0) {
      this.ctx.bus.emit('hud', { type: 'warning', id: 'kit', text: 'NO REPAIR KIT', level: 'warn' });
      return;
    }
    this.repairKits--;
    this.repairing = true;
    this.repairProgress = 0;
    this._endAssault();
    this.ctx.bus.emit('hud', { type: 'repair', kits: this.repairKits, done: false });
  }

  // ================================================================
  //  lock-on
  // ================================================================
  _updateLock(d, inp, dead) {
    const ctx = this.ctx;
    if (!dead && inp.wasPressed(ACTIONS.LOCK)) {
      this.hardLock = !this.hardLock;
      this._lockDirty = true;
    }

    // base aim direction (before assist)
    const cp = Math.cos(this.pitch);
    this._aimDir.set(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp);
    this._eye.set(this.pos.x, this.pos.y + EYE_H, this.pos.z);

    const list = ctx.enemies?.alive ? ctx.enemies.alive() : _EMPTY;
    const prev = this.lockTarget;
    let best = null, bestScore = Infinity, bestAng = Math.PI;
    this.lockList.length = 0;
    const cone = this.hardLock ? CFG.LOCK.FOV_HARD : CFG.LOCK.FOV_SOFT;

    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (!e || e.alive === false) continue;
      this.targetPoint(e, _v);
      _v.sub(this._eye);
      const dist = _v.length();
      if (dist > CFG.LOCK.RANGE || dist < 1e-3) continue;
      _v.multiplyScalar(1 / dist);
      const ang = Math.acos(clamp(_v.dot(this._aimDir), -1, 1));
      if (ang > cone) continue;
      if (this.lockList.length < 6) this.lockList.push(e);
      let score = ang + dist * 0.00042;
      if (e === prev) score *= 0.70;                 // sticky selection
      if (score < bestScore) { bestScore = score; best = e; bestAng = ang; }
    }

    this.lockTarget = best;
    this.lockAngle = bestAng;
    if (best !== prev || this._lockDirty) {
      this._lockDirty = false;
      ctx.bus.emit('lock', { targets: this.lockList, hard: this.hardLock && !!best, target: best });
    }
    // NB: hardLock stays armed with no target — it re-acquires on its own.
    // hard lock converges BOTH the aim and the camera onto the target
    if (this.hardLock && best && !dead) {
      this.targetPoint(best, _v).sub(this._eye);
      const flat = Math.hypot(_v.x, _v.z);
      const wantYaw = Math.atan2(-_v.x, -_v.z);
      const wantPitch = clamp(Math.atan2(_v.y, flat), CFG.CAM.PITCH_MIN, CFG.CAM.PITCH_MAX);
      const k = 1 - Math.exp(-(2.0 + CFG.LOCK.ASSIST * 9.0) * d);
      this.yaw += angleDelta(this.yaw, wantYaw) * k;
      this.pitch += (wantPitch - this.pitch) * k;
      const cp2 = Math.cos(this.pitch);
      this._aimDir.set(-Math.sin(this.yaw) * cp2, Math.sin(this.pitch), -Math.cos(this.yaw) * cp2);
    }
  }

  /** centre-of-mass aim point for any entity shape */
  targetPoint(e, out = new THREE.Vector3()) {
    const p = e.pos || e.position || (e.root && e.root.position);
    if (!p) return out.set(0, 0, 0);
    out.copy(p);
    out.y += (e.height !== undefined ? e.height : 7.0) * 0.55;
    return out;
  }

  // ================================================================
  //  firing geometry
  // ================================================================
  /**
   * Authoritative firing ray. Returns a REUSED object — copy the vectors if
   * you need to hold them across calls, or pass your own `out`.
   */
  aimRay(out = this._ray) {
    out.origin.set(this.pos.x, this.pos.y + EYE_H, this.pos.z);
    out.dir.copy(this._aimDir);
    // soft assist: gentle convergence inside the soft cone, never a snap
    const t = this.lockTarget;
    if (t && !this.hardLock && this.lockAngle < CFG.LOCK.FOV_SOFT) {
      this.targetPoint(t, _v).sub(out.origin);
      const l = _v.length();
      if (l > 1e-3) {
        _v.multiplyScalar(1 / l);
        const w = (1 - this.lockAngle / CFG.LOCK.FOV_SOFT) * CFG.LOCK.ASSIST * 0.45;
        out.dir.lerp(_v, w).normalize();
      }
    } else if (t && this.hardLock) {
      this.targetPoint(t, _v).sub(out.origin);
      const l = _v.length();
      if (l > 1e-3) {
        _v.multiplyScalar(1 / l);
        out.dir.lerp(_v, CFG.LOCK.ASSIST).normalize();
      }
    }
    return out;
  }

  /** world point under the reticle (world geometry or the far plane) */
  aimPoint(out = new THREE.Vector3(), maxDist = 900) {
    const r = this.aimRay();
    const w = this.ctx.world;
    const h = w?.raycastWorld ? w.raycastWorld(r.origin, r.dir, maxDist, this._hit) : null;
    if (h) out.copy(h.point);
    else out.copy(r.origin).addScaledVector(r.dir, maxDist);
    return out;
  }

  worldMuzzle(name, out = new THREE.Vector3()) {
    const m = this.mech?.muzzles?.[name];
    if (m) m.getWorldPosition(out);
    else out.set(this.pos.x, this.pos.y + EYE_H, this.pos.z);
    return out;
  }

  // ================================================================
  //  damage / ACS
  // ================================================================
  takeDamage(info) {
    if (!this.alive || !info) return;
    const direct = !!info.direct;
    let amount = info.amount || 0;
    if (this.staggered) amount *= P.DIRECT_HIT_MULT;
    else if (direct) amount *= 1.18;

    this.ap = Math.max(0, this.ap - amount);
    this._damageVis = clamp(1 - this.ap / this.apMax, 0, 1);
    this.mech?.api.setDamage(this._damageVis * 0.8);

    // ACS strain
    const acs = info.acs !== undefined ? info.acs : (info.impact || amount) * 0.55;
    if (!this.staggered) {
      this.acs = Math.min(this.acsMax, this.acs + acs);
      this.acsDelay = P.ACS_DECAY_DELAY;
    }

    // knockback
    const imp = info.impact || 0;
    if (imp > 0 && info.point) {
      _v.set(this.pos.x - info.point.x, 0, this.pos.z - info.point.z);
      const l = _v.length();
      if (l > 1e-3) {
        _v.multiplyScalar(1 / l);
        const kb = Math.min(imp * 0.0075, 16);
        this.vel.x += _v.x * kb;
        this.vel.z += _v.z * kb;
      }
    }

    const ctx = this.ctx;
    const hurt = clamp(amount / 900, 0.08, 0.9);
    this._shake(0.22 + hurt * 0.8, 0.16 + hurt * 0.14);
    ctx.postfx?.flash?.(0xff3b30, 0.05 + hurt * 0.16);
    ctx.bus.emit('damage', { entity: this, amount, isPlayer: true, staggered: this.staggered, source: info.source });

    if (!this.staggered && this.acs >= this.acsMax) this._stagger();
    if (this.ap <= 0) this._die();
  }

  _stagger() {
    this.staggered = true;
    this.staggerTimer = P.STAGGER_TIME;
    this.acs = this.acsMax;
    this._endAssault();
    const ctx = this.ctx;
    ctx.bus.emit('stagger', { entity: this });
    ctx.bus.emit('hud', { type: 'warning', id: 'acs', text: 'ACS FAILURE', level: 'danger' });
    this._shake(1.1, 0.42);
    ctx.postfx?.flash?.(0xffffff, 0.24);
  }

  _die() {
    if (!this.alive) return;
    this.alive = false;
    this.abActive = false;
    this.mech?.api.setDamage(1);
    const ctx = this.ctx;
    _v.set(this.pos.x, this.pos.y + P.HEIGHT * 0.45, this.pos.z);
    ctx.bus.emit('kill', { entity: this, kind: 'player' });
    this._shake(1.6, 0.9);
  }

  /**
   * Screen shake. Routed through the bus (the documented channel) and
   * falls back to a direct postfx call when nothing is listening yet, so
   * the shake works whichever way the post agent wires it up — and never
   * fires twice.
   */
  _shake(amount, duration = 0.2) {
    const bus = this.ctx.bus;
    bus.emit('shake', { amount, duration });
    const l = bus.map.get('shake');
    if (!l || l.length === 0) this.ctx.postfx?.shake?.(amount, duration);
  }

  addImpulse(x, y, z) { this.vel.x += x; this.vel.y += y; this.vel.z += z; }

  knockback(from, power = 1) {
    _v.set(this.pos.x - from.x, 0, this.pos.z - from.z);
    const l = _v.length();
    if (l < 1e-3) return;
    _v.multiplyScalar(power / l);
    this.vel.x += _v.x; this.vel.z += _v.z;
  }

  // ================================================================
  //  mech rig + booster plumes
  // ================================================================
  _driveMech(d, moving, ascend, descend) {
    const mech = this.mech;
    if (!mech) return;
    const api = mech.api;
    const spd = this.speed;

    // legs face travel when gliding, aim when planted — clamped so the
    // frame never turns its back on the camera
    const glide = !this.grounded || spd > P.WALK_SPEED * 1.3;
    let want = this.yaw;
    if (glide && spd > 6) {
      const travel = Math.atan2(-this.vel.x, -this.vel.z);
      want = this.yaw + clamp(angleDelta(this.yaw, travel), -0.85, 0.85);
    }
    this._legYaw += angleDelta(this._legYaw, want) * (1 - Math.exp(-9.5 * d));

    this.root.position.copy(this.pos);
    this.root.rotation.y = this._legYaw;

    const poseGrounded = this.grounded && !glide;
    const poseSpeed = poseGrounded ? Math.min(spd, P.WALK_SPEED * 1.4) : spd * 0.3;
    api.setLegPose(this._t, poseSpeed, poseGrounded, d);
    api.setAim(clamp(angleDelta(this._legYaw, this.yaw), -1.0, 1.0), this.pitch);

    // --- desired exhaust vector (world) ---------------------------
    _thr.set(0, 0, 0);
    if (moving) _thr.addScaledVector(_wish, this.grounded ? 0.5 : 0.62);
    if (this.abActive) _thr.addScaledVector(_fwd, 1.55);
    if (this.qbTimer > 0) {
      const k = this.qbTimer / P.QB_DURATION;
      _thr.x += this.qbDirX * (0.6 + 1.5 * k);
      _thr.z += this.qbDirZ * (0.6 + 1.5 * k);
    }
    if (ascend) _thr.y += 1.35;
    else if (!this.grounded) _thr.y += 0.30;
    if (descend) _thr.y -= 0.45;

    let mag = _thr.length();
    if (mag > 1e-4) _exh.copy(_thr).multiplyScalar(-1 / mag);
    else _exh.set(0, 0, 1).applyAxisAngle(THREE.Object3D.DEFAULT_UP, this._legYaw);
    mag = clamp(mag, 0, 1.9);

    this.thrustLevel = clamp(0.10 + mag * 0.55, 0, 1);
    api.setThrust(this.thrustLevel);

    this._driveThrusters(mag, this.ctx.state === 'playing' ? 0.11 : 0.06);
  }

  _driveThrusters(mag, idle) {
    const vfx = this.ctx.vfx;
    if (!vfx || !vfx.thruster) return;
    const list = this.thrusters;
    for (let i = 0; i < list.length; i++) {
      const t = list[i];
      t.updateWorldMatrix(true, false);
      const e = t.matrixWorld.elements;
      let dx = -e[8], dy = -e[9], dz = -e[10];
      const il = 1 / Math.max(1e-5, Math.hypot(dx, dy, dz));
      dx *= il; dy *= il; dz *= il;
      const ud = t.userData;
      const power = (ud && ud.power) || 1;
      const align = dx * _exh.x + dy * _exh.y + dz * _exh.z;
      let k = idle * power + (align > 0 ? align : 0) * mag * power * 0.85;
      if (k <= 0.035) continue;
      if (k > 1.3) k = 1.3;
      const rad = ((ud && ud.radius) || 0.4) * 1.35;
      _npos.set(e[12] + dx * rad * 0.3, e[13] + dy * rad * 0.3, e[14] + dz * rad * 0.3);
      _v2.set(dx, dy, dz);
      _thrOpt.radius = rad;
      _thrOpt.seed = i * 0.61;
      vfx.thruster(_npos, _v2, k, _thrOpt);
    }
  }

  // ================================================================
  //  camera (main.js calls this every frame, even outside combat)
  // ================================================================
  updateCamera(dt) {
    if (this._visualFrame !== this.ctx.frame && this.mech) {
      // not simulating (title / result): keep the rig alive so the frame
      // is never a dead pose
      const d = dt > 0 ? Math.min(dt, 0.1) : 1 / 60;
      this._t += d;
      this.root.position.copy(this.pos);
      this.root.rotation.y = this._legYaw;
      this.mech.api.setLegPose(this._t, 0, true, d);
      this.mech.api.setAim(0, this.pitch);
      this.mech.api.setThrust(0.13);
    }
    this.cam.update(dt);
  }

  // ---- convenience readouts for the HUD ---------------------------
  get enFrac() { return this.en / this.enMax; }
  get apFrac() { return this.ap / this.apMax; }
  get acsFrac() { return this.acs / this.acsMax; }
  get qbReady() { return this.qbCooldown <= 0 ? 1 : 1 - this.qbCooldown / P.QB_RELOAD; }
}

export default Player;

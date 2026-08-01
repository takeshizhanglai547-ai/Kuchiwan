// ============================================================
//  Player — movement physics (QB/AB/hover), EN economy, stagger,
//  lock-on target selection, third-person camera.
//  [STUB — owned by player-movement agent]
//
//  CONTRACT
//    new Player(ctx); .init(); .update(dt); .updateCamera(dt); .reset()
//    fields: root(Object3D) pos(Vector3) vel(Vector3) yaw pitch
//            ap enMax en acs staggered grounded boosting abActive
//            lockTarget  hardLock  repairKits
//    .takeDamage({amount, impact, acs, source, point})
//    .aimRay() -> {origin:Vector3, dir:Vector3}   authoritative firing ray
//    .worldMuzzle(name, out) -> Vector3
// ============================================================
import * as THREE from 'three';
import { CFG } from '../config.js';
import { ACTIONS } from '../core/input.js';
import { clamp, damp } from '../util/math.js';
import { buildPlayerMech } from './mechModel.js';

export class Player {
  constructor(ctx) {
    this.ctx = ctx;
    this.pos = new THREE.Vector3(0, 0, 120);
    this.vel = new THREE.Vector3();
    this.yaw = Math.PI;
    this.pitch = -0.05;
    this.ap = CFG.PLAYER.AP;
    this.apMax = CFG.PLAYER.AP;
    this.en = CFG.PLAYER.EN_CAP;
    this.enMax = CFG.PLAYER.EN_CAP;
    this.acs = 0;
    this.staggered = false;
    this.grounded = true;
    this.boosting = true;
    this.abActive = false;
    this.qbTimer = 0;
    this.lockTarget = null;
    this.hardLock = false;
    this.repairKits = CFG.PLAYER.REPAIR_KITS;
    this.alive = true;
  }

  init() {
    const m = buildPlayerMech();
    this.mech = m;
    this.root = m.root;
    this.ctx.scene.add(this.root);
    this._camPos = new THREE.Vector3(0, 20, 160);
    this._camLook = new THREE.Vector3();
  }

  reset() {
    this.pos.set(0, 0, 120); this.vel.set(0, 0, 0);
    this.ap = this.apMax; this.en = this.enMax; this.acs = 0;
    this.alive = true; this.staggered = false;
    this.repairKits = CFG.PLAYER.REPAIR_KITS;
  }

  update(dt) {
    const inp = this.ctx.input;
    this.yaw -= inp.dx * CFG.CAM.SENS;
    this.pitch = clamp(this.pitch - inp.dy * CFG.CAM.SENS, CFG.CAM.PITCH_MIN, CFG.CAM.PITCH_MAX);

    const ax = inp.axes();
    const sp = inp.isDown(ACTIONS.QB) ? CFG.PLAYER.BOOST_SPEED : CFG.PLAYER.WALK_SPEED;
    const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const wish = fwd.multiplyScalar(ax.z).add(right.multiplyScalar(ax.x));
    if (wish.lengthSq() > 0) wish.normalize();

    this.vel.x = damp(this.vel.x, wish.x * sp, 8, dt);
    this.vel.z = damp(this.vel.z, wish.z * sp, 8, dt);
    if (inp.isDown(ACTIONS.ASCEND)) this.vel.y += CFG.PLAYER.HOVER_THRUST * dt;
    else this.vel.y -= CFG.PLAYER.GRAVITY * dt;

    this.pos.addScaledVector(this.vel, dt);
    if (this.pos.y <= 0) { this.pos.y = 0; this.vel.y = 0; this.grounded = true; }
    else this.grounded = false;

    this.root.position.copy(this.pos);
    this.root.rotation.y = this.yaw;
  }

  updateCamera(dt) {
    const cam = this.ctx.camera;
    const off = new THREE.Vector3(
      Math.sin(this.yaw) * CFG.CAM.DIST,
      CFG.CAM.HEIGHT - Math.sin(this.pitch) * CFG.CAM.DIST,
      Math.cos(this.yaw) * CFG.CAM.DIST,
    );
    this._camPos.lerp(this.pos.clone().add(off).setY(this.pos.y + CFG.CAM.HEIGHT + 6), 1 - Math.exp(-CFG.CAM.LAG * dt));
    cam.position.copy(this._camPos);
    this._camLook.lerp(this.pos.clone().setY(this.pos.y + 9), 1 - Math.exp(-CFG.CAM.LOOK_LAG * dt));
    cam.lookAt(this._camLook);
  }

  aimRay() {
    const origin = this.pos.clone().setY(this.pos.y + 9);
    const dir = new THREE.Vector3(
      -Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      -Math.cos(this.yaw) * Math.cos(this.pitch),
    ).normalize();
    return { origin, dir };
  }

  worldMuzzle(name, out = new THREE.Vector3()) {
    const m = this.mech?.muzzles?.[name];
    if (m) m.getWorldPosition(out); else out.copy(this.pos).setY(this.pos.y + 9);
    return out;
  }

  takeDamage({ amount = 0 } = {}) {
    this.ap = Math.max(0, this.ap - amount);
    if (this.ap <= 0) this.alive = false;
  }
}

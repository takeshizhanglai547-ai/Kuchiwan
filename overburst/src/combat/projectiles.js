// ============================================================
//  ProjectileSystem — pooled bullets / missiles / beams + hit
//  resolution against player, enemies and world.
//  [STUB — owned by projectiles agent]
//
//  CONTRACT
//    new ProjectileSystem(ctx); .init(); .update(dt); .reset()
//    .spawnBullet({origin, dir, speed, damage, impact, acs, owner, color, tracer})
//    .spawnMissile({origin, dir, target, ...})
//    .spawnBeam({origin, dir, length, damage, owner, color, life})
//    .spawnExplosion({position, radius, damage, owner})
//    owner: 'player' | 'enemy'
//  Emits 'hit' and 'explode' on the bus.
// ============================================================

export class ProjectileSystem {
  constructor(ctx) { this.ctx = ctx; this.active = []; }
  init() {}
  reset() { this.active.length = 0; }
  update() {}
  spawnBullet() {}
  spawnMissile() {}
  spawnBeam() {}
  spawnExplosion() {}
}

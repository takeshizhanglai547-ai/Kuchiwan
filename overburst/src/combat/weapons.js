// ============================================================
//  WeaponSystem — the FIXED loadout. No assembly, by design.
//  R-arm rifle / L-arm pulse blade / R-shoulder missiles / L-shoulder cannon.
//  [STUB — owned by weapons agent]
//
//  CONTRACT
//    new WeaponSystem(ctx); .init(); .update(dt); .reset()
//    .state -> { rifle:{ammo,mag,reloading,cooldown}, blade:{cooldown},
//                missile:{ammo,reloading,locks:[]}, cannon:{ammo,charge,cooldown} }
//    Reads ctx.input actions RIFLE/BLADE/MISSILE/CANNON and
//    ctx.player.aimRay(); spawns through ctx.projectiles; requests VFX.
// ============================================================

export class WeaponSystem {
  constructor(ctx) {
    this.ctx = ctx;
    this.state = {
      rifle: { ammo: 480, mag: 24, reloading: false, cooldown: 0 },
      blade: { cooldown: 0 },
      missile: { ammo: 96, reloading: false, locks: [], lockProgress: 0 },
      cannon: { ammo: 14, charge: 0, cooldown: 0 },
    };
  }
  init() {}
  reset() {}
  update() {}
}

// ============================================================
//  VFX — every particle, trail, flash, explosion and decal.
//  [STUB — owned by vfx agent]
//
//  CONTRACT
//    new VFX(ctx); .init(); .update(dt); .reset()
//    .muzzleFlash(pos, dir, opts)
//    .impact(pos, normal, opts)          sparks + dust + decal
//    .explosion(pos, opts)               {radius, power, color, kind}
//    .thruster(pos, dir, intensity)      per-frame booster plume
//    .trail(id, pos, opts)               persistent ribbon (missiles/QB)
//    .bladeArc(from, to, opts)
//    .shockwave(pos, opts)
//    .debris(pos, opts)
//    .smoke(pos, opts)
//  All calls MUST be allocation-light: pool everything.
// ============================================================

export class VFX {
  constructor(ctx) { this.ctx = ctx; }
  init() {}
  reset() {}
  update() {}
  muzzleFlash() {}
  impact() {}
  explosion() {}
  thruster() {}
  trail() {}
  bladeArc() {}
  shockwave() {}
  debris() {}
  smoke() {}
}

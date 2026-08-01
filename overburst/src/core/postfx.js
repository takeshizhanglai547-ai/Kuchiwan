// ============================================================
//  PostFX — post-processing chain.  [STUB — owned by fx-post agent]
//
//  CONTRACT
//    new PostFX(ctx)
//    .init()                 optional
//    .resize(w, h)
//    .render(dt)             MUST draw the final image to the canvas
//    .shake(amount, dur)     screen shake request (bus 'shake' also routes here)
//    .setSpeedLines(v)       0..1 assault-boost radial blur / speed lines
//    .flash(color, amount)   full-screen impact flash
// ============================================================

export class PostFX {
  constructor(ctx) {
    this.ctx = ctx;
    this.shakeAmount = 0;
    this.speedLines = 0;
  }

  resize(/* w, h */) {}

  shake(amount = 1) { this.shakeAmount = Math.max(this.shakeAmount, amount); }
  setSpeedLines(v) { this.speedLines = v; }
  flash() {}

  render(dt) {
    this.shakeAmount *= Math.max(0, 1 - dt * 6);
    const { renderer, scene, camera } = this.ctx;
    renderer.render(scene, camera);
  }
}

// ============================================================
//  AudioSystem — fully procedural WebAudio.  [STUB — owned by audio agent]
//  No external assets are available: everything is synthesised.
//
//  CONTRACT
//    new AudioSystem(ctx); .init(); .update(dt); .reset(); .resume()
//    .play(name, opts)   name: 'rifle'|'blade'|'missile'|'cannon'|'boost'|
//                              'qb'|'explode'|'hit'|'lock'|'alarm'|'ui'|...
//                        opts: { position:Vector3, volume, pitch }
//    .setMusicIntensity(0..1)
// ============================================================

export class AudioSystem {
  constructor(ctx) { this.ctx = ctx; this.enabled = true; }
  init() {}
  resume() {}
  reset() {}
  update() {}
  play() {}
  setMusicIntensity() {}
}

// ============================================================
//  PostFX — post-processing chain.  [owned by fx-post]
//
//  CONTRACT (unchanged from the stub)
//    new PostFX(ctx)
//    .init()                 optional
//    .resize(w, h)
//    .render(dt)             MUST draw the final image to the canvas
//    .shake(amount, dur)     screen shake request (bus 'shake' also routes here)
//    .setSpeedLines(v)       0..1 assault-boost radial blur / speed lines
//    .flash(color, amount)   full-screen impact flash
//
//  ADDITIONS
//    .hitFreeze(strength, dur)   3-frame impact stall on direct hits/stagger
//    .timeDilate(scale, dur)     generic ctx.timeScale ramp (hitFreeze wraps it)
//    .setQuality(level)          0 = full, 3 = bloom off (perf fallback)
//    .setGrade(partial)          live grade tweaks (debug/tuning)
//    .reset()                    called on mission start
//
//  CHAIN
//    RenderPass (linear HDR, half-float)
//      -> UnrealBloomPass       threshold expressed DISPLAY-referred (0.82) and
//                               converted to the linear cutoff internally, so
//                               only genuine emissives bloom
//      -> CompositePass         exposure + filmic tonemap + grade + all screen FX
//                               + the sRGB encode (see postfxComposite.js)
//      -> FXAAPass              antialias, then straight to the canvas
//
//  WHY FXAA AND NOT SMAA
//    The composite deliberately lays animated film grain and a scan comb over
//    the frame BEFORE the AA pass (that is the order the chain demands). SMAA's
//    pattern-based edge detection latches onto per-pixel noise and turns it to
//    mush; FXAA's local-contrast floor (FXAA_REDUCE_MUL) ignores it. FXAA is
//    also one pass with no render targets and no async area/search texture
//    decode, which matters for both the 60 fps budget and the headless harness.
//
//  COLOUR-SPACE NOTE
//    three disables tone mapping AND the output colour-space transform for any
//    material that renders into a render target. Every pass before the
//    composite therefore works on scene-referred linear HDR, and the composite
//    is the one and only place the image is tonemapped and sRGB-encoded.
//    Do not add an OutputPass.
// ============================================================
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { FXAAPass } from 'three/addons/postprocessing/FXAAPass.js';
import { CFG } from '../config.js';
import { CameraShake } from './postfxShake.js';
import {
  CompositeShader, GRADE_DEFAULTS, displayThresholdToLinear,
} from './postfxComposite.js';

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// perf fallback ladder — bloom resolution scale + radial-blur tap count.
// NOTE: no level ever touches the grade. Degrading must not change the look,
// only the cost.
const QUALITY = [
  { bloom: 1.00, taps: 6, on: true },
  { bloom: 0.55, taps: 5, on: true },
  { bloom: 0.34, taps: 4, on: true },
  { bloom: 0.34, taps: 3, on: false },
];

export class PostFX {
  constructor(ctx) {
    this.ctx = ctx;
    const { renderer, scene, camera } = ctx;
    const FX = CFG.FX;

    // ---- public-ish state -------------------------------------------
    this.speedLines = 0;
    this.shakeAmount = 0;          // kept for the stub's API surface
    this.enabled = true;
    this.quality = 0;

    this._speedTarget = 0;
    this._flash = 0;
    this._time = 0;
    this._last = (typeof performance !== 'undefined' ? performance.now() : Date.now()) * 0.001;

    // time dilation / hit freeze
    this._dilT = 0;
    this._dilDur = 0.08;
    this._dilScale = 1;
    this._freezeCooldown = 0;

    this.shakeRig = new CameraShake();

    // ---- exposure lives here, not in engine -------------------------
    // (the composer path ignores renderer.toneMapping entirely, but keep the
    //  renderer in sync so any direct-to-canvas render matches)
    this.exposure = FX.EXPOSURE;
    renderer.toneMappingExposure = this.exposure;

    // ---- chain ------------------------------------------------------
    const size = renderer.getSize(new THREE.Vector2());
    this.composer = new EffectComposer(renderer);
    this.composer.setPixelRatio(renderer.getPixelRatio());

    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);

    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(Math.max(2, size.x), Math.max(2, size.y)),
      FX.BLOOM_STRENGTH, FX.BLOOM_RADIUS, 1.0,
    );
    this.composer.addPass(this.bloomPass);

    this.compositePass = new ShaderPass(CompositeShader);
    this.compositePass.material.toneMapped = false;
    this.composer.addPass(this.compositePass);

    this.fxaaPass = new FXAAPass();
    this.fxaaPass.material.toneMapped = false;
    this.composer.addPass(this.fxaaPass);

    this.u = this.compositePass.uniforms;
    this.u.uResolution.value = new THREE.Vector2(size.x || 1, size.y || 1);
    this.u.uGain.value = new THREE.Vector3();
    this.u.uOffset.value = new THREE.Vector3();
    this.u.uPower.value = new THREE.Vector3();
    this.u.uShadowTint.value = new THREE.Vector3();
    this.u.uHighTint.value = new THREE.Vector3();
    this.u.uSpeedTint.value = new THREE.Vector3(0.62, 0.72, 0.86);
    this.u.uFlashColor.value = new THREE.Vector3(1, 1, 1);

    this._flashColor = new THREE.Color(1, 1, 1);
    this._tmpColor = new THREE.Color();

    this.grade = Object.assign({}, GRADE_DEFAULTS, CFG.FX.GRADE || {});
    this.applyConfig();

    this._bloomScale = QUALITY[0].bloom;
    this._ew = Math.max(2, Math.round((size.x || 1) * renderer.getPixelRatio()));
    this._eh = Math.max(2, Math.round((size.y || 1) * renderer.getPixelRatio()));

    // ---- adaptive quality -------------------------------------------
    this._ema = 0;
    this._badFor = 0;
    this._goodFor = 0;
    this._adaptive = FX.ADAPTIVE !== false && !this._detectSoftwareRenderer();

    this._bound = false;
  }

  init() {
    if (this._bound) return;
    this._bound = true;
    const bus = this.ctx.bus;

    bus.on('shake', (e) => this.shake(e && e.amount, e && e.duration));

    bus.on('stagger', () => {
      // ART_DIRECTION §3: staggering something lands with a short impact freeze.
      this.hitFreeze(1.0, 0.085);
      this.flash(0xdfe9ff, 0.18);
    });

    bus.on('hit', (e) => {
      if (!e || !e.direct) return;
      const impact = e.impact || 0;
      if (impact < 700) return;                 // rifle chatter must not stall
      if (this._freezeCooldown > 0) return;
      this._freezeCooldown = 0.28;
      this.hitFreeze(Math.min(1, impact / 2200), 0.055);
    });

    bus.on('explode', (e) => this._explodeFlash(e));

    bus.on('state', ({ to }) => {
      if (to !== 'playing') this._releaseDilation();
    });
  }

  reset() {
    this._flash = 0;
    this.speedLines = 0;
    this._speedTarget = 0;
    this.shakeRig.reset();
    this._releaseDilation();
  }

  update() { /* the loop calls render(dt); nothing to do here */ }

  // ------------------------------------------------------------------
  //  configuration
  // ------------------------------------------------------------------
  /** Push CFG.FX + this.grade into the shader uniforms. Cheap; call freely. */
  applyConfig() {
    const FX = CFG.FX;
    const u = this.u;
    const g = this.grade;

    this.exposure = FX.EXPOSURE;
    this.ctx.renderer.toneMappingExposure = this.exposure;

    u.uExposure.value = this.exposure;
    u.uShoulder.value = g.shoulder;
    u.uWhite.value = g.white;
    u.uBleach.value = g.bleach;

    u.uGain.value.fromArray(g.gain);
    u.uOffset.value.fromArray(g.offset);
    u.uPower.value.fromArray(g.power);
    u.uShadowTint.value.fromArray(g.shadowTint);
    u.uHighTint.value.fromArray(g.highTint);
    u.uContrast.value = g.contrast;
    u.uSaturation.value = g.saturation;
    u.uShadowAmt.value = g.shadowAmt;
    u.uHighAmt.value = g.highAmt;

    u.uVignette.value = FX.VIGNETTE;
    u.uEdgeDesat.value = FX.EDGE_DESAT ?? 0.16;
    u.uCA.value = FX.CA;
    u.uGrain.value = FX.GRAIN;
    u.uScan.value = FX.SCAN ?? 0.02;
    u.uSpeedBlur.value = FX.SPEED_BLUR ?? 0.055;

    this.bloomPass.strength = FX.BLOOM_STRENGTH;
    this.bloomPass.radius = FX.BLOOM_RADIUS;
    // BLOOM_THRESHOLD is authored DISPLAY-referred (0.82 == "just under white
    // on screen"). The high pass sees scene-referred HDR, so convert.
    const lin = displayThresholdToLinear(FX.BLOOM_THRESHOLD, this.exposure, g.shoulder, g.white);
    this.bloomPass.threshold = lin;
    if (this.bloomPass.highPassUniforms) {
      this.bloomPass.highPassUniforms.smoothWidth.value = Math.max(0.05, lin * 0.35);
    }
  }

  /** Live grade tweak, e.g. postfx.setGrade({ saturation: 0.7 }). */
  setGrade(partial) {
    Object.assign(this.grade, partial || {});
    this.applyConfig();
  }

  // ------------------------------------------------------------------
  //  effects API
  // ------------------------------------------------------------------
  shake(amount = 0.4, duration = 0.28) {
    const a = clamp01(amount);
    this.shakeAmount = Math.max(this.shakeAmount, a);
    this.shakeRig.add(a, duration);
  }

  setSpeedLines(v) {
    this._speedTarget = clamp01(v || 0);
  }

  /** @param {number|THREE.Color} color  @param {number} amount 0..1 */
  flash(color = 0xffffff, amount = 1) {
    const a = clamp01(amount);
    if (a <= 0) return;
    if (a >= this._flash) {
      this._setFlashColor(color);
      this._flash = a;
    } else {
      this._flash = Math.min(1, this._flash + a * 0.35);
    }
  }

  /** Short impact stall. strength 0..1, duration in REAL seconds. */
  hitFreeze(strength = 1, duration = 0.07) {
    const s = clamp01(strength);
    this.timeDilate(1 - 0.94 * s, duration);
  }

  /** Ramp ctx.timeScale to `scale` for `duration` real seconds, then ease back. */
  timeDilate(scale, duration = 0.12) {
    const sc = Math.min(1, Math.max(0.02, scale));
    if (this._dilT > 0 && sc > this._dilScale) {
      this._dilT = Math.max(this._dilT, duration);
      return;
    }
    this._dilScale = sc;
    this._dilDur = Math.max(0.016, duration);
    this._dilT = this._dilDur;
  }

  setQuality(level) {
    const lv = Math.max(0, Math.min(QUALITY.length - 1, level | 0));
    if (lv === this.quality) return;
    this.quality = lv;
    const q = QUALITY[lv];
    this.bloomPass.enabled = q.on;
    this._bloomScale = q.bloom;
    this._resizeBloom();
    const def = this.compositePass.material.defines;
    if (def.RADIAL_TAPS !== q.taps) {
      def.RADIAL_TAPS = q.taps;
      this.compositePass.material.needsUpdate = true;
    }
  }

  // ------------------------------------------------------------------
  //  resize
  // ------------------------------------------------------------------
  resize(w, h) {
    const width = Math.max(2, w | 0);
    const height = Math.max(2, h | 0);
    const pr = this.ctx.renderer.getPixelRatio();
    this.composer.setPixelRatio(pr);
    this.composer.setSize(width, height);   // also setSize()s every pass

    const ew = Math.max(2, Math.round(width * pr));
    const eh = Math.max(2, Math.round(height * pr));
    this.u.uResolution.value.set(ew, eh);
    this.u.uAspect.value = width / height;
    // keep the scan comb at ~2 CSS pixels regardless of device pixel ratio
    this.u.uScanFreq.value = Math.PI / Math.max(1, pr);

    this._ew = ew;
    this._eh = eh;
    this._resizeBloom();
  }

  _resizeBloom() {
    const s = this._bloomScale || 1;
    const w = Math.max(2, Math.round((this._ew || 2) * s));
    const h = Math.max(2, Math.round((this._eh || 2) * s));
    this.bloomPass.resolution.set(w, h);
    this.bloomPass.setSize(w, h);
  }

  // ------------------------------------------------------------------
  //  frame
  // ------------------------------------------------------------------
  render(dt) {
    const ctx = this.ctx;
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now()) * 0.001;
    let rdt = now - this._last;
    this._last = now;
    if (!(rdt > 0)) rdt = 1 / 60;
    if (rdt > 0.25) rdt = 0.25;              // tab-switch / first frame guard

    this._time += rdt;
    if (this._freezeCooldown > 0) this._freezeCooldown -= rdt;

    // ---- decays (real time: FX must not slow down during a hit-freeze) ----
    this._flash = Math.max(0, this._flash * Math.exp(-rdt * 11) - rdt * 0.30);
    this.shakeAmount *= Math.max(0, 1 - rdt * 6);

    // speed lines ease in fast, out slower — matches AB ignition/decay
    const k = this._speedTarget > this.speedLines ? 9.5 : 4.2;
    this.speedLines += (this._speedTarget - this.speedLines) * Math.min(1, rdt * k);
    if (this.speedLines < 0.002) this.speedLines = 0;

    this._tickDilation(rdt);

    // ---- uniforms ----
    const u = this.u;
    u.uTime.value = this._time;
    u.uFlash.value = this._flash;
    u.uSpeed.value = this.speedLines;
    u.uGrainSeed.value = (this._time * 977.13) % 4096;

    // ---- shake: displace, render, restore ----
    const cam = ctx.camera;
    const shook = this.shakeRig.apply(cam, rdt, CFG.FX.SHAKE_SCALE ?? 1);

    if (this.enabled) {
      this.composer.render(rdt);
    } else {
      ctx.renderer.setRenderTarget(null);
      ctx.renderer.render(ctx.scene, cam);
    }

    if (shook) this.shakeRig.restore(cam);

    this._perf(rdt);
  }

  // ------------------------------------------------------------------
  //  internals
  // ------------------------------------------------------------------
  _tickDilation(rdt) {
    if (this._dilT <= 0) return;
    this._dilT -= rdt;
    if (this._dilT <= 0) { this._releaseDilation(); return; }
    const k = clamp01(this._dilT / this._dilDur);
    // hold the stall for the first ~55 % then ease back to real time
    const hold = k > 0.45 ? 1 : k / 0.45;
    const e = hold * hold;
    this.ctx.timeScale = 1 + (this._dilScale - 1) * e;
  }

  _releaseDilation() {
    this._dilT = 0;
    this._dilScale = 1;
    this.ctx.timeScale = 1;
  }

  _setFlashColor(color) {
    const c = this._flashColor;
    if (color && color.isColor) c.copy(color);
    else if (typeof color === 'number' && isFinite(color)) c.setHex(color >>> 0, THREE.SRGBColorSpace);
    else c.setRGB(1, 1, 1);
    // the flash is composited in display space, so hand the shader sRGB
    this._tmpColor.copy(c).convertLinearToSRGB();
    this.u.uFlashColor.value.set(this._tmpColor.r, this._tmpColor.g, this._tmpColor.b);
  }

  _explodeFlash(e) {
    if (!e || !e.position) return;
    const cam = this.ctx.camera;
    const rad = e.radius || 10;
    const r2 = rad * rad * 26;
    const d2 = cam.position.distanceToSquared(e.position);
    const f = r2 / (d2 + r2);
    const amt = Math.min(0.24, 0.30 * f * (e.power != null ? e.power : 1));
    if (amt > 0.012) this.flash(e.color != null ? e.color : 0xffb473, amt);
  }

  _detectSoftwareRenderer() {
    try {
      if (typeof navigator !== 'undefined' && navigator.webdriver) return true;
      const gl = this.ctx.renderer.getContext();
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      const name = String(
        (dbg && gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) || gl.getParameter(gl.RENDERER) || '',
      );
      return /swiftshader|llvmpipe|softwarerasterizer|software|mesa offscreen/i.test(name);
    } catch (err) {
      return false;
    }
  }

  /** Rolling frame-time average. Degrades bloom resolution rather than dying.
   *  Never touches exposure/grade — a slow machine gets the same picture. */
  _perf(rdt) {
    if (!this._adaptive) return;
    const ms = rdt * 1000;
    this._ema = this._ema <= 0 ? ms : this._ema + (ms - this._ema) * 0.045;
    if (this.ctx.frame < 120) return;         // warm-up: shader compiles etc.

    if (this._ema > 26.5) { this._badFor += rdt; this._goodFor = 0; }
    else if (this._ema < 13.5) { this._goodFor += rdt; this._badFor = 0; }
    else { this._badFor = 0; this._goodFor = 0; }

    if (this._badFor > 1.5 && this.quality < QUALITY.length - 1) {
      this._badFor = 0;
      this.setQuality(this.quality + 1);
    } else if (this._goodFor > 9 && this.quality > 0) {
      this._goodFor = 0;
      this.setQuality(this.quality - 1);
    }
  }

  dispose() {
    this.composer.dispose?.();
    this.bloomPass.dispose?.();
    this.compositePass.dispose?.();
    this.fxaaPass.dispose?.();
  }
}

export default PostFX;

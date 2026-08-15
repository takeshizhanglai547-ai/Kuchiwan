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
//    .setQuality(level)          0 = full, 3 = bloom + AO off (perf fallback)
//    .setGrade(partial)          live grade tweaks (debug/tuning)
//    .reset()                    called on mission start
//
//  CHAIN
//    RenderPass (linear HDR, half-float, + a SHARED DepthTexture)
//      -> SSAOPass (ours)       half-res obscurance from that depth buffer,
//                               consumed by the composite in LINEAR space
//      -> UnrealBloomPass       threshold expressed DISPLAY-referred (0.82) and
//                               converted to the linear cutoff internally, so
//                               only genuine emissives bloom
//      -> CompositePass         AO + exposure + filmic tonemap + grade + all
//                               screen FX + the sRGB encode
//      -> FXAAPass              antialias, then straight to the canvas
//
//  THE SHARED DEPTH TEXTURE
//    RenderPass (r180) has needsSwap=false and draws into `readBuffer`, so
//    which physical target holds the beauty pass depends on how many swapping
//    passes ran before it. Rather than depend on that parity, the composer's
//    two ping-pong targets share ONE DepthTexture — the AO then always reads
//    the depth RenderPass just wrote, whichever target it went to, and adding
//    or removing a pass later cannot silently break it. Every pass after
//    RenderPass has depthTest/depthWrite off, so nothing scribbles on it.
//
//    NOTHING DOWNSTREAM MAY SAMPLE THAT TEXTURE. It is an attachment of the
//    targets the later passes draw into, and sampling an attachment of the
//    bound framebuffer is a feedback loop:
//      GL_INVALID_OPERATION: glDrawArrays: Feedback loop formed between
//      Framebuffer and active Texture
//    ANGLE drops the draw, so the pass writes nothing and the frame is black.
//    The AO pass (which renders into its own depth-less targets, and is
//    therefore safe) packs a reciprocal-encoded linear distance into G of its
//    output; that is where the composite's speed blur gets its depth.
//
//  WHY NOT GTAOPass (it IS vendored — this was tried first)
//    1. The zero-extra-draw-call path is broken in the vendored r180:
//         new GTAOPass(scene, camera, w, h, { depthTexture })
//         -> TypeError: Cannot read properties of undefined (reading
//            'depthTexture')   at GTAOPass.setGBuffer (GTAOPass.js:341:76)
//       Line 341 dereferences `this.normalRenderTarget` unconditionally, but
//       the external-G-buffer branch above it never creates that field.
//    2. Its working path (internal G-buffer) re-renders the ENTIRE scene with
//       MeshNormalMaterial every frame. This game already draws 650-1090 calls;
//       that would roughly double it, which the perf budget forbids.
//    3. Re-pointing it at our depth texture by hand works around (1), but then
//       NORMAL_VECTOR_TYPE drops to 0 and its PoissonDenoise pass calls
//       computeNormalFromDepth() — nine texelFetch() — once per denoise sample,
//       16 samples deep: ~150 depth fetches per output pixel, on top of GTAO's
//       own 18. That is not a 60 fps budget, let alone a software-WebGL one.
//    So: a compact half-res obscurance pass of our own, below. Same input
//    (the shared depth buffer), ~13 fetches per half-res pixel, one bilinear
//    fetch in the composite, and NO extra scene draw calls.
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
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { CFG } from '../config.js';
import { CameraShake } from './postfxShake.js';
import { getTier } from './perfTier.js';
import {
  CompositeShader, GRADE_DEFAULTS, displayThresholdToLinear,
} from './postfxComposite.js';

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// ============================================================
//  The adaptive ladder.
//
//  These are RELATIVE steps, not absolute settings: perfTier.js picks
//  what "full quality" means for this device, and the ladder walks
//  down from there. Expressing them as absolutes is how the old table
//  ended up describing a 0.55 bloom scale on a phone as "one step
//  down" when the phone had no business at 1.00 in the first place.
//
//  NOTE: no level ever touches the grade. Degrading must not change
//  the look, only the cost.
// ============================================================
const QUALITY = [
  { bloomMul: 1.00, tapsDelta: 0,  aoMul: 1.00, aoScaleMul: 1.00, on: true,  res: 1.00 },
  { bloomMul: 0.70, tapsDelta: -1, aoMul: 0.72, aoScaleMul: 1.00, on: true,  res: 1.00 },
  { bloomMul: 0.50, tapsDelta: -2, aoMul: 0.55, aoScaleMul: 0.80, on: true,  res: 1.00 },
  { bloomMul: 0.50, tapsDelta: -3, aoMul: 0.00, aoScaleMul: 0.80, on: false, res: 1.00 },
  // LAST RESORT — and the only rung with real authority.
  //
  // Rungs 0-3 only touch the POST chain, and measurement says the bottom
  // of that is flat: at quality 2 the whole post chain already costs
  // ~6.1 ms of a ~6.3 ms render, i.e. turning AO and bloom completely
  // off from there buys ~nothing. What is left is the RenderPass —
  // 750 draw calls of arena — and nothing above this rung touches it.
  //
  // Render scale does. 0.78 is 61 % of the fragments, for the scene
  // pass AND the AO AND the bloom AND the composite AND FXAA. It is the
  // most visible step on the ladder, which is why it is the last one; a
  // machine that arrives here has already failed at everything cheaper.
  { bloomMul: 0.50, tapsDelta: -3, aoMul: 0.00, aoScaleMul: 0.80, on: false, res: 0.78 },
];

// ---- adaptive controller ------------------------------------------
//  Driven off a ROLLING MEDIAN, never a mean. One 3-second shader
//  compile poisons a mean for its whole time constant and drags the
//  quality down for a stall that is already over; a median over ~0.5 s
//  ignores any minority of outliers completely, which is exactly the
//  right reading of "am I actually missing frames".
const ADAPT = {
  WINDOW: 31,        // frames in the median window (~0.5 s at 60 fps)
  EVERY: 5,          // recompute the median every N frames
  DOWN_MUL: 1.20,    // median > budget * this  -> too slow
  UP_MUL: 0.66,      // median < budget * this  -> room to spare
  DOWN_HOLD: 0.50,   // s of sustained miss before stepping down
  UP_HOLD: 6.0,      // s clean before the FIRST step back up to a rung
  UP_GROWTH: 2.5,    // ...and this much longer for each later attempt at it
  SETTLE: 1.20,      // s of silence after any change (RT realloc etc.)
  MAX_ROUNDTRIPS: 3, // fall off the same rung this often and it is gone
};

// ============================================================
//  Half-res screen-space obscurance.
//
//  Alchemy/SAO-style: reconstruct view position and a view normal from the
//  shared depth buffer, then integrate a spiral of neighbours. Nothing here
//  reads colour, and nothing here re-draws the scene.
//
//  The world scale matters: the mech is 11 units tall, so a 2.2-unit radius is
//  roughly "one shin". That is the scale at which contact darkening reads —
//  foot/ground, knee, shoulder-to-backpack, the base of every pillar and
//  container — without turning into a fake global dirt layer.
// ============================================================
const AO_VERT = /* glsl */`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const AO_FRAG = /* glsl */`
#ifndef AO_SAMPLES
  #define AO_SAMPLES 12
#endif
#define AO_TURNS 7.0

uniform highp sampler2D tDepth;
uniform vec2  uTexel;        // 1 / AO target resolution
uniform vec2  uDepthTexel;   // 1 / depth texture resolution
uniform mat4  uProjInv;
uniform float uProjScale;    // aoRes.y * 0.5 * projectionMatrix[1][1]
uniform float uRadius;
uniform float uBias;
uniform float uIntensity;
uniform float uPower;
uniform float uFadeStart;
uniform float uFadeEnd;
uniform float uFrame;
uniform float uDepthK;
varying vec2 vUv;

vec3 obViewPos(vec2 uv, float dz) {
  vec4 cp = vec4(vec3(uv, dz) * 2.0 - 1.0, 1.0);
  vec4 vp = uProjInv * cp;
  return vp.xyz / vp.w;
}

float obDepth(vec2 uv) { return texture2D(tDepth, uv).x; }

// interleaved gradient noise — a good per-pixel rotation that stays cheap
float obIGN(vec2 p) {
  return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
}

void main() {
  vec2 uv = vUv;
  float d0 = obDepth(uv);
  vec3 P = obViewPos(uv, d0);
  float dist = -P.z;
  // G channel: a reciprocal-encoded linear distance. The COMPOSITE reads its
  // depth from here instead of sampling the depth texture directly — that
  // texture is attached to the composer's ping-pong targets, and sampling it
  // while writing into one of them is a framebuffer feedback loop:
  //   GL_INVALID_OPERATION: glDrawArrays: Feedback loop formed between
  //   Framebuffer and active Texture
  // ANGLE drops the draw entirely, which renders the whole frame black.
  float g = uDepthK / (dist + uDepthK);

  if (d0 >= 0.999995) { gl_FragColor = vec4(1.0, g, 0.0, 1.0); return; }  // sky

  // view normal from depth, picking the closer neighbour on each axis so
  // silhouettes do not smear a bogus normal across the edge
  vec2 t = uDepthTexel;
  vec3 pr = obViewPos(uv + vec2(t.x, 0.0), obDepth(uv + vec2(t.x, 0.0)));
  vec3 pl = obViewPos(uv - vec2(t.x, 0.0), obDepth(uv - vec2(t.x, 0.0)));
  vec3 pu = obViewPos(uv + vec2(0.0, t.y), obDepth(uv + vec2(0.0, t.y)));
  vec3 pd = obViewPos(uv - vec2(0.0, t.y), obDepth(uv - vec2(0.0, t.y)));
  vec3 ex = abs(pr.z - P.z) < abs(P.z - pl.z) ? pr - P : P - pl;
  vec3 ey = abs(pu.z - P.z) < abs(P.z - pd.z) ? pu - P : P - pd;
  vec3 N = cross(ex, ey);
  float nl = length(N);
  if (nl < 1e-7) { gl_FragColor = vec4(1.0, g, 0.0, 1.0); return; }
  N /= nl;
  if (dot(N, P) > 0.0) N = -N;                 // must face the lens

  float srPix = clamp(uRadius * uProjScale / max(0.4, dist), 1.5, 72.0);
  float rot = obIGN(gl_FragCoord.xy + uFrame) * 6.2831853;
  float r2 = uRadius * uRadius;
  float r6 = r2 * r2 * r2;
  float bias = uBias * max(1.0, dist * 0.02);
  float sum = 0.0;

  for (int i = 0; i < AO_SAMPLES; i++) {
    float fi = (float(i) + 0.5) / float(AO_SAMPLES);
    float ang = fi * 6.2831853 * AO_TURNS + rot;
    vec2 suv = uv + vec2(cos(ang), sin(ang)) * (srPix * sqrt(fi)) * uTexel;
    vec3 V = obViewPos(suv, obDepth(suv)) - P;
    float vv = dot(V, V);
    float vn = dot(V, N);
    float f = max(r2 - vv, 0.0);
    sum += f * f * f * max((vn - bias) / (vv + 0.02), 0.0);
  }

  float ao = 1.0 - (sum * uIntensity * 5.0) / (r6 * float(AO_SAMPLES));
  ao = pow(clamp(ao, 0.0, 1.0), uPower);
  // let it go beyond the arena: distant haze must not read as grime
  ao = mix(ao, 1.0, smoothstep(uFadeStart, uFadeEnd, dist));
  gl_FragColor = vec4(ao, g, 0.0, 1.0);
}
`;

const AO_BLUR_FRAG = /* glsl */`
uniform sampler2D tAO;
uniform vec2 uTexel;
varying vec2 vUv;
void main() {
  // 5-tap box (4 diagonal bilinear taps + centre) — the AO is low frequency,
  // this is enough to bury the per-pixel spiral rotation. The packed depth in
  // G is taken from the centre only; blurring a distance across a silhouette
  // would soften exactly the edge the speed blur needs to respect.
  vec2 o = uTexel * 1.5;
  vec4 c0 = texture2D(tAO, vUv);
  float a = c0.r * 0.2;
  a += texture2D(tAO, vUv + vec2( o.x,  o.y)).r * 0.2;
  a += texture2D(tAO, vUv + vec2(-o.x,  o.y)).r * 0.2;
  a += texture2D(tAO, vUv + vec2( o.x, -o.y)).r * 0.2;
  a += texture2D(tAO, vUv + vec2(-o.x, -o.y)).r * 0.2;
  gl_FragColor = vec4(a, c0.g, 0.0, 1.0);
}
`;

class SSAOPass extends Pass {
  /** @param {THREE.Camera} camera @param {THREE.DepthTexture} depthTexture */
  constructor(camera, depthTexture, cfg) {
    super();
    this.needsSwap = false;          // writes only into its own targets
    this.camera = camera;
    this.scale = cfg.SCALE ?? 0.5;
    this._frame = 0;

    const opts = {
      type: THREE.UnsignedByteType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
      stencilBuffer: false,
    };
    this.rtA = new THREE.WebGLRenderTarget(2, 2, opts);
    this.rtB = new THREE.WebGLRenderTarget(2, 2, opts);

    this.aoMaterial = new THREE.ShaderMaterial({
      name: 'OverburstSSAO',
      defines: { AO_SAMPLES: cfg.SAMPLES ?? 12 },
      uniforms: {
        tDepth: { value: depthTexture },
        uTexel: { value: new THREE.Vector2(1, 1) },
        uDepthTexel: { value: new THREE.Vector2(1, 1) },
        uProjInv: { value: new THREE.Matrix4() },
        uProjScale: { value: 500 },
        uRadius: { value: cfg.RADIUS ?? 2.2 },
        uBias: { value: cfg.BIAS ?? 0.035 },
        uIntensity: { value: cfg.INTENSITY ?? 1.0 },
        uPower: { value: cfg.POWER ?? 1.3 },
        uFadeStart: { value: cfg.FADE_START ?? 260 },
        uFadeEnd: { value: cfg.FADE_END ?? 620 },
        uFrame: { value: 0 },
        uDepthK: { value: 64 },
      },
      vertexShader: AO_VERT,
      fragmentShader: AO_FRAG,
      depthTest: false,
      depthWrite: false,
      blending: THREE.NoBlending,
    });

    this.blurMaterial = new THREE.ShaderMaterial({
      name: 'OverburstSSAOBlur',
      uniforms: {
        tAO: { value: this.rtA.texture },
        uTexel: { value: new THREE.Vector2(1, 1) },
      },
      vertexShader: AO_VERT,
      fragmentShader: AO_BLUR_FRAG,
      depthTest: false,
      depthWrite: false,
      blending: THREE.NoBlending,
    });

    this._quad = new FullScreenQuad(this.aoMaterial);
  }

  /** the texture the composite samples */
  get texture() { return this.rtB.texture; }

  setSamples(n) {
    const s = Math.max(4, n | 0);
    if (this.aoMaterial.defines.AO_SAMPLES === s) return;
    this.aoMaterial.defines.AO_SAMPLES = s;
    this.aoMaterial.needsUpdate = true;
  }

  setSize(width, height) {
    const w = Math.max(2, Math.round(width * this.scale));
    const h = Math.max(2, Math.round(height * this.scale));
    this.rtA.setSize(w, h);
    this.rtB.setSize(w, h);
    this.aoMaterial.uniforms.uTexel.value.set(1 / w, 1 / h);
    this.blurMaterial.uniforms.uTexel.value.set(1 / w, 1 / h);
    // the depth texture is full-frame, not AO-res
    this.aoMaterial.uniforms.uDepthTexel.value.set(1 / Math.max(2, width), 1 / Math.max(2, height));
    this._h = h;
  }

  render(renderer) {
    const cam = this.camera;
    const u = this.aoMaterial.uniforms;
    u.uProjInv.value.copy(cam.projectionMatrixInverse);
    // projectionMatrix[1][1] == 1/tan(fov/2); scales world radius -> AO pixels
    u.uProjScale.value = (this._h || 2) * 0.5 * cam.projectionMatrix.elements[5];
    this._frame = (this._frame + 1) % 64;
    u.uFrame.value = this._frame;

    this._quad.material = this.aoMaterial;
    renderer.setRenderTarget(this.rtA);
    renderer.clear(true, false, false);
    this._quad.render(renderer);

    this.blurMaterial.uniforms.tAO.value = this.rtA.texture;
    this._quad.material = this.blurMaterial;
    renderer.setRenderTarget(this.rtB);
    renderer.clear(true, false, false);
    this._quad.render(renderer);
  }

  dispose() {
    this.rtA.dispose();
    this.rtB.dispose();
    this.aoMaterial.dispose();
    this.blurMaterial.dispose();
    this._quad.dispose();
  }
}

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

    // ---- device tier: what "full quality" means on THIS machine -----
    this.tier = (ctx.engine && ctx.engine.tier) || getTier();
    this._baseBloom = this.tier.bloomScale;
    this._baseTaps = this.tier.radialTaps;
    this._baseAoSamples = this.tier.aoSamples;
    this._baseAoScale = this.tier.aoScale;
    this._aoAllowed = this.tier.ao !== false;

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
    const pr = renderer.getPixelRatio();
    const ew0 = Math.max(2, Math.round((size.x || 2) * pr));
    const eh0 = Math.max(2, Math.round((size.y || 2) * pr));

    // ONE depth texture, shared by both ping-pong targets (see header).
    this.depthTexture = new THREE.DepthTexture(ew0, eh0);
    this.depthTexture.format = THREE.DepthFormat;
    this.depthTexture.type = THREE.UnsignedIntType;
    this.depthTexture.minFilter = THREE.NearestFilter;
    this.depthTexture.magFilter = THREE.NearestFilter;

    const rt = new THREE.WebGLRenderTarget(ew0, eh0, {
      type: THREE.HalfFloatType,
      depthBuffer: true,
      stencilBuffer: false,
      depthTexture: this.depthTexture,
    });

    this.composer = new EffectComposer(renderer, rt);
    // RenderTarget.copy() CLONES the depth texture, so the composer's second
    // buffer would otherwise own a different one. Force the share.
    this.composer.renderTarget2.depthTexture = this.depthTexture;
    this.composer.setPixelRatio(pr);

    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);

    this.aoPass = null;
    const AO = FX.AO || {};
    if (AO.ENABLED !== false) {
      // built even on a tier that starts with AO off, so setTier() can
      // hand it back without rebuilding the whole chain. Two tiny render
      // targets when it is disabled; nothing per frame.
      this.aoPass = new SSAOPass(camera, this.depthTexture, Object.assign({}, AO, {
        SCALE: this._baseAoScale,
        SAMPLES: Math.max(4, this._baseAoSamples || AO.SAMPLES || 12),
      }));
      this.aoPass.enabled = this._aoAllowed;
      this.composer.addPass(this.aoPass);
    }

    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(Math.max(2, size.x), Math.max(2, size.y)),
      FX.BLOOM_STRENGTH, FX.BLOOM_RADIUS, 1.0,
    );
    this.composer.addPass(this.bloomPass);

    this.compositePass = new ShaderPass(CompositeShader);
    this.compositePass.material.toneMapped = false;
    this.compositePass.material.depthTest = false;
    this.compositePass.material.depthWrite = false;
    this.composer.addPass(this.compositePass);

    this.fxaaPass = new FXAAPass();
    this.fxaaPass.material.toneMapped = false;
    this.fxaaPass.material.depthTest = false;
    this.fxaaPass.material.depthWrite = false;
    this.composer.addPass(this.fxaaPass);

    this.fxaaPass.enabled = this.tier.fxaa !== false;

    this.u = this.compositePass.uniforms;
    this.u.uResolution.value = new THREE.Vector2(size.x || 1, size.y || 1);
    this.u.uGain.value = new THREE.Vector3();
    this.u.uOffset.value = new THREE.Vector3();
    this.u.uPower.value = new THREE.Vector3();
    this.u.uShadowTint.value = new THREE.Vector3();
    this.u.uHighTint.value = new THREE.Vector3();
    this.u.uLiftTint.value = new THREE.Vector3(0.78, 0.92, 1.17);
    this.u.uSpeedTint.value = new THREE.Vector3(0.62, 0.72, 0.86);
    this.u.uFlashColor.value = new THREE.Vector3(1, 1, 1);
    this.u.tAO.value = this.aoPass ? this.aoPass.texture : null;
    this._setDefine('USE_AO', !!this.aoPass && this._aoAllowed);

    this._flashColor = new THREE.Color(1, 1, 1);
    this._tmpColor = new THREE.Color();

    this.grade = Object.assign({}, GRADE_DEFAULTS, CFG.FX.GRADE || {});
    this.applyConfig();

    this._bloomScale = this._baseBloom;
    this._ew = ew0;
    this._eh = eh0;

    // ---- adaptive quality -------------------------------------------
    //  A ring of raw frame times + a median, NOT an exponential mean.
    this._ring = new Float64Array(ADAPT.WINDOW);
    this._sortBuf = new Float64Array(ADAPT.WINDOW);
    this._ringN = 0;
    this._ringI = 0;
    this._median = 0;
    this._badFor = 0;
    this._goodFor = 0;
    this._settle = 0;
    this._qFloor = 0;                     // ratchet: never climb above this
    this._downs = new Int32Array(QUALITY.length);
    this._steps = { down: 0, up: 0 };
    this.budgetMs = FX.ADAPT_BUDGET_MS || 1000 / (FX.TARGET_FPS || 60);
    this.downHoldS = FX.ADAPT_DOWN_HOLD_S || ADAPT.DOWN_HOLD;
    this.upHoldS = FX.ADAPT_UP_HOLD_S || ADAPT.UP_HOLD;

    // The ladder used to be switched OFF on any software renderer, which
    // is both the machine that needs it most and the reason it had never
    // once been exercised. Now only the automated harness opts out, so
    // its measurements stay deterministic; setAdaptive(true) turns it
    // back on for the tests that have to prove it engages.
    this._adaptive = FX.ADAPTIVE !== false && !this._isHarness();

    this._bound = false;
    this._warmDone = false;

    // normalise every size now that the whole chain exists (the composer was
    // seeded with PIXEL dimensions; resize() re-states everything in CSS ones)
    this.resize(size.x || 2, size.y || 2);
    // and put the whole chain on this device's rung
    this.quality = -1;
    this.setQuality(0, true);
  }

  init() {
    if (this._bound) return;
    this._bound = true;
    const bus = this.ctx.bus;

    // ---- shader warm-up ---------------------------------------------
    // PostFX is constructed and init()ed LAST, so by the time we get here
    // the whole arena, every system and every pool exists — this is the
    // only place in the boot sequence that can see all of it at once.
    // The queue is drained one batch per frame from render(), behind the
    // title screen, with a progress bar.
    const warm = this.ctx.engine && this.ctx.engine.warmup;
    if (warm) {
      // compile against the composer's half-float buffer, not the canvas —
      // see ShaderWarmup._compileBatch.
      warm.compileTarget = this.composer.renderTarget1;
      warm.begin(this.ctx, this._warmTasks());
      // mission.reset() has already run by the time this fires, so the
      // objective pylons and the opening picket now exist. Re-collect and
      // compile them here — a screen transition is the last place a stall
      // is invisible. rewarm() also drains anything the title screen did
      // not get through.
      bus.on('state', ({ to }) => { if (to === 'playing') warm.rewarm(this.ctx); });
    }

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
    this._ringN = 0; this._ringI = 0;
    this._badFor = 0; this._goodFor = 0;
    this._settle = ADAPT.SETTLE;
  }

  // ------------------------------------------------------------------
  //  Warm-up work that only PostFX can do.
  //
  //  Every rung of the ladder flips a #define — RADIAL_TAPS on the
  //  composite, AO_SAMPLES on the obscurance pass, USE_AO on and off —
  //  and each distinct combination is a distinct program. Compiling
  //  those lazily means the adaptive ladder's FIRST ACTION, taken
  //  because the machine is already struggling, is to stall it for a
  //  shader compile. So all four rungs are walked here, at load, each
  //  driven through one real composer frame so the programs are built
  //  against exactly the render-target and colour-space state they will
  //  be used with. Ends on rung 0.
  // ------------------------------------------------------------------
  _warmTasks() {
    const tasks = [];
    for (const lv of [1, 2, 3, 0]) {
      tasks.push({
        label: 'POST TIER ' + lv,
        run: () => {
          this.setQuality(lv, true);
          this.composer.render(1 / 60);
        },
      });
    }
    tasks.push({
      label: 'FRAME',
      run: () => {
        this._settle = 0;
        this._warmDone = true;
        this._ringN = 0; this._ringI = 0;   // don't judge the machine on these
      },
    });
    return tasks;
  }

  update() { /* the loop calls render(dt); nothing to do here */ }

  // ------------------------------------------------------------------
  //  configuration
  // ------------------------------------------------------------------
  _setDefine(name, on) {
    const def = this.compositePass.material.defines;
    const has = Object.prototype.hasOwnProperty.call(def, name);
    if (has === !!on) return;
    if (on) def[name] = ''; else delete def[name];
    this.compositePass.material.needsUpdate = true;
  }

  /** Push CFG.FX + this.grade into the shader uniforms. Cheap; call freely. */
  applyConfig() {
    const FX = CFG.FX;
    const u = this.u;
    const g = this.grade;
    const cam = this.ctx.camera;

    this.exposure = FX.EXPOSURE;
    this.ctx.renderer.toneMappingExposure = this.exposure;

    u.uExposure.value = this.exposure;
    u.uShoulder.value = g.shoulder;
    u.uWhite.value = g.white;
    u.uBleach.value = g.bleach;
    u.uKneeLin.value = g.kneeLin;
    u.uLogK.value = g.logK;

    u.uGain.value.fromArray(g.gain);
    u.uOffset.value.fromArray(g.offset);
    u.uPower.value.fromArray(g.power);
    u.uShadowTint.value.fromArray(g.shadowTint);
    u.uHighTint.value.fromArray(g.highTint);
    u.uLiftTint.value.fromArray(g.liftTint);
    u.uContrast.value = g.contrast;
    u.uContrastToe.value = g.contrastToe;
    u.uSaturation.value = g.saturation;
    u.uShadowAmt.value = g.shadowAmt;
    u.uHighAmt.value = g.highAmt;
    u.uLift.value = g.lift;
    u.uLiftKnee.value = g.liftKnee;

    u.uFloor.value = FX.BLACK_FLOOR ?? 0.026;
    u.uFloorKnee.value = FX.BLACK_FLOOR_KNEE ?? 0.075;

    u.uVignette.value = FX.VIGNETTE;
    u.uEdgeDesat.value = FX.EDGE_DESAT ?? 0.16;
    u.uCA.value = FX.CA;
    u.uCAMix.value = FX.CA_MIX ?? 0.42;
    u.uGrain.value = FX.GRAIN;
    u.uHiDither.value = FX.HI_DITHER ?? 0.006;
    u.uScan.value = FX.SCAN ?? 0.02;
    u.uSpeedBlur.value = FX.SPEED_BLUR ?? 0.055;
    u.uSpeedNear.value = FX.SPEED_NEAR ?? 46;
    u.uSpeedFloor.value = FX.SPEED_FLOOR ?? 0.07;
    u.uSpeedPeak.value = FX.SPEED_PEAK ?? 0.26;

    const AO = FX.AO || {};
    u.uAOAmt.value = AO.AMOUNT ?? 1.0;
    u.uAOEmiss0.value = AO.EMISSIVE_LO ?? 1.6;
    u.uAOEmiss1.value = AO.EMISSIVE_HI ?? 6.0;
    if (this.aoPass) {
      const au = this.aoPass.aoMaterial.uniforms;
      au.uRadius.value = AO.RADIUS ?? 2.2;
      au.uBias.value = AO.BIAS ?? 0.035;
      au.uIntensity.value = AO.INTENSITY ?? 1.0;
      au.uPower.value = AO.POWER ?? 1.3;
      au.uFadeStart.value = AO.FADE_START ?? 260;
      au.uFadeEnd.value = AO.FADE_END ?? 620;
    }

    this.bloomPass.strength = FX.BLOOM_STRENGTH;
    this.bloomPass.radius = FX.BLOOM_RADIUS;
    // W13: the default mip weights [1,.8,.6,.4,.2] combined with radius 0.42
    // give the LOWEST mip almost as much say as the sharpest one — at 720p that
    // mip is ~31x17 px, and its blur kernel's iso-contour is exactly the
    // octagon that showed up around bright cores. Weight the sharp mips.
    const bf = this.bloomPass.compositeMaterial?.uniforms?.bloomFactors?.value;
    const want = FX.BLOOM_MIPS;
    if (bf && want) for (let i = 0; i < bf.length && i < want.length; i++) bf[i] = want[i];

    // BLOOM_THRESHOLD is authored DISPLAY-referred (0.82 == "just under white
    // on screen"). The high pass sees scene-referred HDR, so convert.
    const lin = displayThresholdToLinear(
      FX.BLOOM_THRESHOLD, this.exposure, g.shoulder, g.white, g.kneeLin, g.logK,
    );
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

  /**
   * Move the adaptive ladder. Levels are RELATIVE to the device tier —
   * level 0 is "everything this device was rated for", 3 is the floor.
   * @param {number} level
   * @param {boolean} [force] ignore the anti-oscillation ratchet (warm-up
   *                          and explicit QA overrides use this)
   */
  setQuality(level, force) {
    let lv = Math.max(0, Math.min(QUALITY.length - 1, level | 0));
    if (!force) lv = Math.max(lv, this._qFloor | 0);
    if (lv === this.quality) return;
    this.quality = lv;
    this._settle = ADAPT.SETTLE;
    const q = QUALITY[lv];

    this.bloomPass.enabled = q.on;
    if (q.on) {
      this._bloomScale = Math.max(0.15, this._baseBloom * q.bloomMul);
      this._resizeBloom();
    }

    const taps = Math.max(2, (this._baseTaps | 0) + q.tapsDelta);
    const def = this.compositePass.material.defines;
    if (def.RADIAL_TAPS !== taps) {
      def.RADIAL_TAPS = taps;
      this.compositePass.material.needsUpdate = true;
    }

    if (this.aoPass) {
      const samples = this._aoAllowed
        ? Math.max(0, Math.round(this._baseAoSamples * q.aoMul)) : 0;
      const on = samples >= 4;
      this.aoPass.enabled = on;
      this._setDefine('USE_AO', on);
      if (on) {
        this.aoPass.setSamples(samples);
        const scale = this._baseAoScale * q.aoScaleMul;
        if (Math.abs(this.aoPass.scale - scale) > 1e-4) {
          this.aoPass.scale = scale;
          this.aoPass.setSize(this._ew, this._eh);
        }
      }
    }
    // Render scale is the only rung that reaches the scene pass. It costs a
    // full render-target reallocation, so it is applied last and only when
    // it actually changed.
    const eng = this.ctx.engine;
    if (eng && eng.setRenderScale) eng.setRenderScale(q.res != null ? q.res : 1);

    if (typeof window !== 'undefined') window.__OB_QUALITY = this.quality;
  }

  /** Re-seat the whole chain on a (possibly new) device tier. */
  applyTier(tier) {
    this.tier = tier || (this.ctx.engine && this.ctx.engine.tier) || getTier();
    this._baseBloom = this.tier.bloomScale;
    this._baseTaps = this.tier.radialTaps;
    this._baseAoSamples = this.tier.aoSamples;
    this._baseAoScale = this.tier.aoScale;
    this._aoAllowed = this.tier.ao !== false;
    this.fxaaPass.enabled = this.tier.fxaa !== false;
    const q = this.quality;
    this.quality = -1;
    this.setQuality(q < 0 ? 0 : q, true);
  }

  /** Force a device tier by name or index ('mid', 3, ...). */
  setTier(nameOrIndex) {
    if (this.ctx.engine && this.ctx.engine.setTier) return this.ctx.engine.setTier(nameOrIndex);
    this.applyTier(getTier());
    return this.tier;
  }

  // ------------------------------------------------------------------
  //  adaptive ladder control surface (QA / debug / settings menu)
  // ------------------------------------------------------------------
  setAdaptive(on) {
    this._adaptive = on !== false;
    this._badFor = 0; this._goodFor = 0; this._ringN = 0; this._ringI = 0;
    return this._adaptive;
  }

  /** Pin a quality level and stop the ladder touching it. */
  forceQuality(level) {
    this._adaptive = false;
    this.setQuality(level, true);
    return this.quality;
  }

  /** Frame-budget the ladder measures against, in ms. */
  setBudget(ms) {
    this.budgetMs = Math.max(1, +ms || 16.7);
    this._badFor = 0; this._goodFor = 0;
    return this.budgetMs;
  }

  /** Everything the ladder is thinking, for the harness to assert on. */
  adaptInfo() {
    return {
      adaptive: !!this._adaptive,
      quality: this.quality,
      tier: this.tier.name,
      tierIndex: this.tier.index,
      medianMs: +this._median.toFixed(2),
      budgetMs: +this.budgetMs.toFixed(2),
      downAtMs: +(this.budgetMs * ADAPT.DOWN_MUL).toFixed(2),
      upAtMs: +(this.budgetMs * ADAPT.UP_MUL).toFixed(2),
      badFor: +this._badFor.toFixed(2),
      goodFor: +this._goodFor.toFixed(2),
      downHoldS: this.downHoldS,
      upHoldS: +this._upHoldFor(this.quality - 1).toFixed(2),
      floor: this._qFloor,
      steps: { down: this._steps.down, up: this._steps.up },
      pixelRatio: this.ctx.renderer.getPixelRatio(),
      bloomScale: +this._bloomScale.toFixed(3),
      aoSamples: this.aoPass && this.aoPass.enabled ? this.aoPass.aoMaterial.defines.AO_SAMPLES : 0,
      taps: this.compositePass.material.defines.RADIAL_TAPS,
      fxaa: !!this.fxaaPass.enabled,
    };
  }

  // ------------------------------------------------------------------
  //  resize
  // ------------------------------------------------------------------
  resize(w, h) {
    const width = Math.max(2, w | 0);
    const height = Math.max(2, h | 0);
    const pr = this.ctx.renderer.getPixelRatio();
    const ew = Math.max(2, Math.round(width * pr));
    const eh = Math.max(2, Math.round(height * pr));

    // The shared DepthTexture must track the composer targets exactly or three
    // throws "Attached DepthTexture is initialized to the incorrect size."
    const img = this.depthTexture.image;
    if (img.width !== ew || img.height !== eh) {
      img.width = ew;
      img.height = eh;
      this.depthTexture.dispose();     // force a re-upload at the new size
    }

    this.composer.setPixelRatio(pr);
    this.composer.setSize(width, height);   // also setSize()s every pass

    this.u.uResolution.value.set(ew, eh);
    this.u.uAspect.value = width / height;
    // keep the scan comb at ~2 CSS pixels regardless of device pixel ratio
    this.u.uScanFreq.value = Math.PI / Math.max(1, pr);

    this._ew = ew;
    this._eh = eh;
    this._resizeBloom();
    if (this.aoPass) {
      this.aoPass._w = ew;
      this.aoPass._fullH = eh;
      this.aoPass.setSize(ew, eh);
      this.u.tAO.value = this.aoPass.texture;
    }
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

    // Pin the scene's light counts (see engine.js header) — without this
    // every explosion invalidates the program cache for every lit
    // material in the arena.
    const eng = ctx.engine;
    if (eng && eng.stabiliseLights) eng.stabiliseLights(ctx.frame);

    // One warm-up batch per frame, behind the title screen.
    if (eng && eng.warmup && !eng.warmup.done) eng.warmup.step();

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

  /** The automated harness, not "a slow GPU". Software rasterisers are
   *  exactly the machines the ladder exists for; only Playwright/WebDriver
   *  opts out, so its measurements are not moving underneath it. */
  _isHarness() {
    try {
      return typeof navigator !== 'undefined' && !!navigator.webdriver;
    } catch (err) {
      return false;
    }
  }

  // ------------------------------------------------------------------
  //  THE ADAPTIVE LADDER
  //
  //  Reads a ROLLING MEDIAN of the last ~0.5 s of real frame times. A
  //  median is the whole point: a shader compile, a GC pause or an
  //  alt-tab is one sample out of 31 and moves it by nothing, whereas
  //  the exponential mean this replaces would see a single 3-second
  //  compile as ~130 ms of "sustained" frame time for two full seconds
  //  and drop a rung for a stall that had already ended.
  //
  //  Down: median over budget*1.20 for 0.50 s.
  //  Up:   median under budget*0.66 for UP_HOLD s, and UP_HOLD grows
  //        2.5x every time it has to come back down — so a machine that
  //        sits on the boundary converges instead of pumping.
  //  Ratchet: MAX_ROUNDTRIPS falls off the same rung and that rung is
  //        gone for the session (_qFloor). Oscillation is worse than
  //        being one step too conservative; a bloom-resolution change is
  //        a visible pop.
  // ------------------------------------------------------------------
  _perf(rdt) {
    const ms = rdt * 1000;
    // ring is written even when the ladder is off, so adaptInfo() and the
    // HUD can report the real median at any time.
    this._ring[this._ringI] = ms;
    this._ringI = (this._ringI + 1) % ADAPT.WINDOW;
    if (this._ringN < ADAPT.WINDOW) this._ringN++;

    if (this._settle > 0) this._settle -= rdt;
    if ((this.ctx.frame % ADAPT.EVERY) === 0) this._median = this._computeMedian();
    if (typeof window !== 'undefined') window.__OB_MEDIAN = this._median;

    if (!this._adaptive) return;
    // never judge a machine on frames it spent compiling
    const warm = this.ctx.engine && this.ctx.engine.warmup;
    if (warm && !warm.done) return;
    if (this._ringN < ADAPT.WINDOW) return;
    if (this._settle > 0) return;

    const down = this.budgetMs * ADAPT.DOWN_MUL;
    const up = this.budgetMs * ADAPT.UP_MUL;
    const med = this._median;

    if (med > down) { this._badFor += rdt; this._goodFor = 0; }
    else if (med < up) { this._goodFor += rdt; this._badFor = 0; }
    else { this._badFor = 0; this._goodFor = 0; }   // dead band: hold station

    if (this._badFor >= this.downHoldS && this.quality < QUALITY.length - 1) {
      const from = this.quality;
      this._badFor = 0; this._goodFor = 0;
      this._downs[from]++;
      // Fall off the same rung MAX_ROUNDTRIPS times and it is written off
      // for the session. Oscillation is worse than one step too
      // conservative: a bloom-resolution change is a visible pop, and a
      // machine that pumps between two rungs pops forever.
      if (this._downs[from] >= ADAPT.MAX_ROUNDTRIPS) this._qFloor = Math.max(this._qFloor, from + 1);
      this._steps.down++;
      this.setQuality(from + 1, true);
    } else if (this._goodFor >= this._upHoldFor(this.quality - 1) && this.quality > this._qFloor) {
      this._goodFor = 0; this._badFor = 0;
      this._steps.up++;
      this.setQuality(this.quality - 1);
    }
  }

  /** How long the frame time has to stay clean before we try `rung` again.
   *  Each failed attempt at the SAME rung makes the next one 2.5x more
   *  patient, so a machine sitting on the boundary converges instead of
   *  pumping. */
  _upHoldFor(rung) {
    const failed = rung >= 0 ? (this._downs[rung] || 0) : 0;
    return this.upHoldS * Math.pow(ADAPT.UP_GROWTH, Math.max(0, failed - 1));
  }

  _computeMedian() {
    const n = this._ringN;
    if (n <= 0) return 0;
    const b = this._sortBuf;
    for (let i = 0; i < n; i++) b[i] = this._ring[i];
    // insertion sort: n is 31 and almost sorted frame to frame
    for (let i = 1; i < n; i++) {
      const v = b[i];
      let j = i - 1;
      while (j >= 0 && b[j] > v) { b[j + 1] = b[j]; j--; }
      b[j + 1] = v;
    }
    return b[n >> 1];
  }

  dispose() {
    this.composer.dispose?.();
    this.aoPass?.dispose();
    this.bloomPass.dispose?.();
    this.compositePass.dispose?.();
    this.fxaaPass.dispose?.();
    this.depthTexture.dispose();
  }
}

export default PostFX;

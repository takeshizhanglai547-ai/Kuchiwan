// src/render/pipeline.js — HDR render + post-processing chain (owner: render engineer).
//
//   env.preRender(camera)            sky follow, shadow cascades, weather (environment.js)
//   SCENE      layer 0 -> sceneRT    HalfFloat HDR + DepthTexture (MSAA x4 on high)
//   SOFT       layer 1 -> sceneRT    only when something is marked soft: opaque depth is first
//                                    copied to a linear-depth texture the soft shaders sample
//   [stats snapshot]                 scene + shadow draw calls/triangles (budget checks)
//   [slots 'ao', 'pre_bloom']        optional external THREE Pass objects (HDR in/out)
//   MOTION BLUR full res             camera-motion reprojection from depth (high/medium); the
//                                    player rig's projected box stays sharp
//   AO         1/2 res               SAO-style obscurance from depth + 2 depth-aware blurs
//   VOLUME     1/4 res               volumetric sun scattering: ray-march the height fog through
//                                    both shadow cascades (shadow volumes of gantries, conveyors
//                                    and rigs carve shafts into the lit ash at ANY sun angle)
//                                    + 2 depth-aware blurs; bilateral upsample in the composite
//   SHAFTS     1/4 res               sky mask near the sun + 2 radial blurs (only when the
//                                    sun is in front of the camera)
//   EYE ADAPT  64x36 + 1x1           centre-weighted log-average luminance -> partial exposure
//                                    compensation (into-sun frames come down ~0.5 EV)
//   BLOOM      1/2 .. 1/64 res       soft-knee threshold (emissives only) + compressive source
//                                    clamp + 13-tap down / tent up mip chain (tight)
//   COMPOSITE  full res -> LDR       AO (floored), volume, aerial-perspective chroma shift (hue
//                                    toward the haze hue x fog opacity), shafts, bloom, exposure x adaptation,
//                                    edge-only CA (<= 0.5 px), AgX + look (hue-preserving for
//                                    near-primary emissives), split-tone grade (cool shadows,
//                                    warm highlights), toe-protected contrast, vignette, black
//                                    level lift (#1C2126: never #000), grain, sRGB; alpha =
//                                    emissive protection for the resolve
//   SUB-PIXEL RESOLVE full res (r4)  isolated outlier pixels (dotted far lattice / stays, glints,
//                                    glitter) -> their coverage: excess spread over a 3x3 tent
//                                    (2 x 9 taps, high/medium)
//   AA         full res -> screen    SMAA (high/medium; high also has MSAA x4 on hardware GPUs)
//                                    / FXAA (low)
//
// Per-pass cost estimate at 1920x1080 on a mid GPU (GTX 1660 / RX 6600 class), high:
//   scene MSAA x4 +0.8 ms over no-MSAA | near shadow 4096² ~1.0 ms (draw-call bound; far
//   cascade is a one-time bake) | AO 12 taps @ 1/2 ~0.45 ms | volume 24 steps @ 1/4
//   (2 shadow taps/step worst case) ~0.35 ms | shafts @ 1/4 ~0.15 ms | motion blur 8 taps
//   ~0.25 ms | bloom 11 passes ~0.35 ms | composite (+ bilateral volume upsample + per-pixel
//   aerial fog evaluation) ~0.45 ms |
//   eye adaptation ~0.02 ms | sub-pixel resolve ~0.15 ms | SMAA ~0.45 ms  => post ≈ 2.75 ms.
//   medium: no MSAA, near shadow 2048², AO 8 taps, volume 16 steps, shafts 24, blur 6 taps
//   => post ≈ 2.05 ms.
//   low: no AO / volume / shafts / far cascade, FXAA, 1800 ash flakes => post ≈ 0.6 ms.
//
// API (game.pipeline):
//   render(realDt)            called by the engine once per frame
//   setSize(w, h)             CSS pixels (drawing-buffer size is derived from the renderer)
//   setQuality('low'|'medium'|'high')
//   setSlot(name, pass|null)  'ao' | 'pre_bloom' | 'post_bloom' : THREE Pass objects (HDR ping-pong)
//   stats.scene               {calls, triangles} of the SCENE (+shadow) passes only
//   look                      live tunables (exposure, bloom, ao, grade, ...)
//   --- depth access (soft particles, see docs/ARCHITECTURE.md §19) ---
//   SOFT_LAYER                camera layer rendered AFTER the opaque depth copy
//   markSoft(object3d)        put an object (and its children) on SOFT_LAYER and enable the copy
//   depthUniforms             { tIwDepth, uIwDepthParams } — merge into ShaderMaterial uniforms
//   depthTexture              linear view depth (metres, R channel) of the opaque scene
//   sceneDepthTexture         raw DepthTexture of the scene pass (post-process use only)
//   glsl.softDepth            GLSL helpers: iwSceneDepth(), iwSoftFade(fragViewDepth, scale)
import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import * as P from './postfx.js';
import { softwareRendererName, atmosGLSL } from './atmosphere.js';

const QUALITY = {
  low: { msaa: 0, aa: 'fxaa', ao: 0, shafts: 0, bloomMips: 5, mblur: 0, vol: 0, speckle: 0 },
  medium: { msaa: 0, aa: 'smaa', ao: 8, shafts: 24, bloomMips: 6, mblur: 6, vol: 16, speckle: 1 },
  high: { msaa: 4, aa: 'smaa', ao: 12, shafts: 36, bloomMips: 6, mblur: 8, vol: 24, speckle: 1 },
};

/** Art-direction tunables (live: game.pipeline.look). */
const LOOK = {
  exposure: 1.3,
  tonemap: 'agx',
  ao: { radius: 2.8, intensity: 2.4, bias: 0.03, strength: 0.9, floor: 0.38, fade: 240 },
  bloom: { threshold: 1.35, knee: 0.55, intensity: 0.24, clamp: 16, weights: [1.0, 0.72, 0.48, 0.3, 0.18, 0.1] }, // tight: small mips dominate
  // gap = share of the source taken from ash-deck gaps (crepuscular rays, r4)
  shafts: { threshold: 0.45, radius: 0.5, length: 0.96, decay: 0.975, intensity: 2.4, tint: '#FFB27A', gap: 0.8 },
  // volumetric sun scattering: lit = boost of sun-lit in-scatter, occ = removal in shadow
  // dust = extra forward-scattering ash lit by the sun within ~dustRange m (tight HG lobe, so
  // it makes beams between shadows instead of a veil over the whole sun side). r4: the sun sector
  // is thinner (ATMOS.fog.sunDensity 0.58 also scales the dust), so the dust doubles and reaches
  // further (280 m / march 400 m): tower and furnace shadows carve beams in into-sun views
  volume: { lit: 0.25, occ: 1.0, dust: 0.016, dustIso: 0.2, dustRange: 280, maxDist: 400 },
  // lift = display-space black level (sRGB #1C2126 x liftAmt), shadowAmt/Desat = cool split tone
  // below display-linear 0.3, gain = highlight hue at constant luminance
  grade: { lift: '#1C2126', liftAmt: 0.72, shadowAmt: 0.45, shadowDesat: 0.35, gain: '#F2C79A', gainAmt: 0.16, sat: 0.95, contrast: 1.2, hiLift: 0.45 },
  motionBlur: { shutter: 0.5, maxPx: 30, chaseVel: 0.85 },
  // eye adaptation: partial compensation of the centre-weighted log-average luminance toward
  // 'key' (EV range -down..+up). Into-sun frames come down, the storm side stays dark-of-mid.
  autoExposure: { enabled: 1, key: 0.077, strength: 0.65, down: 1.0, up: 0.15, speed: 1.6 },
  aerial: 0.25,   // aerial-perspective chroma shift toward the haze hue (x fog opacity)
  vignette: 0.26,
  ca: 0.006,      // edge-only, capped at 0.5 px in the composite
  grain: 0.02,
  // sub-pixel resolve (before SMAA): gate = |outlier excess| (linear) where it starts / is full,
  // protect = HDR luminance (after exposure) above which emissive cores are left crisp
  speckle: { amount: 1.0, gate: [0.015, 0.05], protect: [3.0, 8.0] },
};

const SOFT_LAYER = 1;

const SOFT_GLSL = /* glsl */`
uniform sampler2D tIwDepth;       // linear view depth of the opaque scene (metres)
uniform vec4 uIwDepthParams;      // 1/width, 1/height (drawing-buffer px), near, far
float iwSceneDepth() { return texture2D(tIwDepth, gl_FragCoord.xy * uIwDepthParams.xy).r; }
// 0 where the particle touches geometry, 1 once it is 'scale' metres in front of it
float iwSoftFade(float fragViewDepth, float scale) {
  return clamp((iwSceneDepth() - fragViewDepth) / max(scale, 1e-3), 0.0, 1.0);
}
`;

function devParams() {
  try { return new URLSearchParams(typeof location !== 'undefined' ? location.search : ''); }
  catch (e) { return new URLSearchParams(''); }
}

export default function pipelineSystem(game) {
  const stats = { scene: { calls: 0, triangles: 0 } };
  const slots = { ao: null, pre_bloom: null, post_bloom: null }; // 'ao' kept for the old contract
  const size = new THREE.Vector2(1, 1);
  const dev = devParams();
  let q = QUALITY.high, qName = 'high';
  let sceneRT, hdrTmpA, hdrTmpB, ldrRT, ldrB = null, spkE = null, aoA, aoB, shA, shB, mbRT, volA, volB, depthLinRT = null;
  let aeLum = null, aeA = null, aeB = null, aeTime = -1e9, aeDebugN = 0, aeLumValid = false;
  const bloomRT = [];
  let quad, smaa = null, fxaaMat, softEnabled = false;
  const M = {};
  const depthUniforms = {
    tIwDepth: { value: null },
    uIwDepthParams: { value: new THREE.Vector4(1, 1, 0.3, 4000) },
  };
  const _sun = new THREE.Vector3(), _fwd = new THREE.Vector3();
  const floatDepth = { type: THREE.HalfFloatType };
  let frameNo = 0;
  const syncPx = new Uint8Array(4);
  const debugView = { ao: 1, bloom: 2, vol: 3, depth: 4 }[dev.get('postdebug')] || 0; // dev only (depth: log2(m)/12, sky = 0)

  function makeRT(w, h, opts = {}) {
    const rt = new THREE.WebGLRenderTarget(Math.max(1, w), Math.max(1, h), {
      type: THREE.HalfFloatType, depthBuffer: false, stencilBuffer: false,
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false, ...opts,
    });
    rt.texture.colorSpace = THREE.NoColorSpace;
    return rt;
  }

  function buildTargets() {
    disposeTargets();
    const W = size.x, H = size.y;
    const depthTex = new THREE.DepthTexture(W, H, THREE.UnsignedIntType);
    depthTex.name = 'iw_scene_depth';
    sceneRT = makeRT(W, H, { depthBuffer: true, depthTexture: depthTex, samples: q.msaa });
    sceneRT.texture.name = 'iw_scene_hdr';
    hdrTmpA = null; hdrTmpB = null; // created on demand by slots
    ldrRT = makeRT(W, H, { type: THREE.UnsignedByteType });
    if (q.speckle) {
      ldrB = makeRT(W, H, { type: THREE.UnsignedByteType });
      spkE = makeRT(W, H, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    }
    const hw = Math.max(1, W >> 1), hh = Math.max(1, H >> 1);
    if (q.ao) {
      aoA = makeRT(hw, hh, { type: THREE.UnsignedByteType });
      aoB = makeRT(hw, hh, { type: THREE.UnsignedByteType });
    }
    if (q.mblur) mbRT = makeRT(W, H);
    if (q.vol) {
      volA = makeRT(Math.max(1, W >> 2), Math.max(1, H >> 2), { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
      volB = makeRT(Math.max(1, W >> 2), Math.max(1, H >> 2), { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
    }
    if (q.shafts) {
      shA = makeRT(Math.max(1, W >> 2), Math.max(1, H >> 2));
      shB = makeRT(Math.max(1, W >> 2), Math.max(1, H >> 2));
    }
    for (let i = 0; i < q.bloomMips; i++) bloomRT.push(makeRT(Math.max(1, W >> (i + 1)), Math.max(1, H >> (i + 1))));
    aeLum = makeRT(64, 36);   // linear: the shaft mask reads it as a smooth local mean
    aeA = makeRT(1, 1, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    aeB = makeRT(1, 1, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    aeTime = -1e9;
    if (softEnabled) makeDepthLin();
    if (smaa) smaa.setSize(W, H);
    if (fxaaMat) fxaaMat.uniforms.resolution.value.set(1 / W, 1 / H);
    depthUniforms.uIwDepthParams.value.x = 1 / W;
    depthUniforms.uIwDepthParams.value.y = 1 / H;
  }
  function makeDepthLin() {
    if (depthLinRT) depthLinRT.dispose();
    depthLinRT = makeRT(size.x, size.y, { type: floatDepth.type, format: THREE.RedFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    depthUniforms.tIwDepth.value = depthLinRT.texture;
  }
  function disposeTargets() {
    for (const rt of [sceneRT, hdrTmpA, hdrTmpB, ldrRT, ldrB, spkE, aoA, aoB, shA, shB, mbRT, volA, volB, depthLinRT, aeLum, aeA, aeB]) if (rt) { if (rt.depthTexture) rt.depthTexture.dispose(); rt.dispose(); }
    sceneRT = hdrTmpA = hdrTmpB = ldrRT = ldrB = spkE = aoA = aoB = shA = shB = mbRT = volA = volB = depthLinRT = aeLum = aeA = aeB = null;
    for (const rt of bloomRT) rt.dispose();
    bloomRT.length = 0;
  }

  function pass(material, target) {
    quad.material = material;
    game.renderer.setRenderTarget(target);
    quad.render(game.renderer);
  }

  function setDepthUniforms(m, cam) {
    const u = m.uniforms;
    u.tDepth.value = sceneRT.depthTexture;
    u.uCam.value.set(cam.near, cam.far);
    const ty = Math.tan(THREE.MathUtils.degToRad(cam.fov) * 0.5) / (cam.zoom || 1);
    u.uTan.value.set(ty * cam.aspect, ty);
  }

  function renderAO(cam) {
    const W = size.x, H = size.y;
    const m = M.ao;
    setDepthUniforms(m, cam);
    const A = api.look.ao;
    m.uniforms.uRes.value.set(W, H);
    m.uniforms.uRadius.value = A.radius;
    m.uniforms.uProjScale.value = (0.5 * H) / m.uniforms.uTan.value.y;
    m.uniforms.uIntensity.value = A.intensity;
    m.uniforms.uBias.value = A.bias;
    m.uniforms.uFade.value = A.fade;
    pass(m, aoA);
    const b = M.aoBlur;
    setDepthUniforms(b, cam);
    b.uniforms.tAO.value = aoA.texture;
    b.uniforms.uStep.value.set(1 / aoA.width, 0);
    pass(b, aoB);
    b.uniforms.tAO.value = aoB.texture;
    b.uniforms.uStep.value.set(0, 1 / aoA.height);
    pass(b, aoA);
    return aoA.texture;
  }

  /** Volumetric sun scattering through the shadow cascades (quarter res). Returns the texture or null. */
  function renderVolume(cam) {
    const env = game.env, sun = env && env.sun, far = env && env.sunFar;
    const nearMap = sun && sun.castShadow && sun.shadow.map ? sun.shadow.map.depthTexture : null;
    const farMap = far && far.castShadow && far.shadow.map ? far.shadow.map.depthTexture : null;
    if (!nearMap && !farMap) return null;
    const m = M.vol, u = m.uniforms, V = api.look.volume;
    setDepthUniforms(m, cam);
    u.tShNear.value = nearMap; u.uHasNear.value = nearMap ? 1 : 0;
    u.tShFar.value = farMap; u.uHasFar.value = farMap ? 1 : 0;
    if (nearMap) u.uShNear.value.copy(sun.shadow.matrix);
    if (farMap) u.uShFar.value.copy(far.shadow.matrix);
    u.uShBias.value.set(sun ? sun.shadow.bias : 0, far ? far.shadow.bias : 0);
    u.uCamWorld.value.copy(cam.matrixWorld);
    u.uCamPos.value.setFromMatrixPosition(cam.matrixWorld);
    u.uFogD0.value = game.scene.fog ? game.scene.fog.density : 0.002;
    u.uMaxDist.value = V.maxDist;
    u.uDustK.value = 1 / Math.max(1, V.dustRange);
    pass(m, volA);
    const b = M.volBlur;
    b.uniforms.tIn.value = volA.texture; b.uniforms.uStep.value.set(1 / volA.width, 0);
    pass(b, volB);
    b.uniforms.tIn.value = volB.texture; b.uniforms.uStep.value.set(0, 1 / volA.height);
    pass(b, volA);
    return volA.texture;
  }

  /** Returns shaft intensity (0 = skipped). */
  function renderShafts(cam, hdrTex) {
    const env = game.env;
    if (!env) return 0;
    cam.getWorldDirection(_fwd);
    const facing = _fwd.dot(env.sunDir);
    if (facing < 0.15) return 0;
    _sun.copy(cam.position).addScaledVector(env.sunDir, 1000).project(cam);
    const sx = _sun.x * 0.5 + 0.5, sy = _sun.y * 0.5 + 0.5;
    const off = Math.max(Math.abs(sx - 0.5), Math.abs(sy - 0.5));
    const vis = THREE.MathUtils.smoothstep(facing, 0.15, 0.55) * (1 - THREE.MathUtils.smoothstep(off, 0.65, 1.1));
    if (vis <= 0.001) return 0;
    const S = api.look.shafts;
    const mk = M.shaftMask;
    mk.uniforms.tScene.value = hdrTex;
    mk.uniforms.tDepth.value = sceneRT.depthTexture;
    mk.uniforms.uSun.value.set(sx, sy);
    mk.uniforms.uAspect.value = cam.aspect;
    mk.uniforms.uThreshold.value = S.threshold;
    mk.uniforms.uRadius.value = S.radius;
    mk.uniforms.tLum.value = aeLumValid ? aeLum.texture : null;
    mk.uniforms.uGap.value = aeLumValid ? S.gap : 0;
    pass(mk, shA);
    const bl = M.shaftBlur;
    bl.uniforms.uSun.value.set(sx, sy);
    bl.uniforms.tIn.value = shA.texture;
    bl.uniforms.uLength.value = S.length;
    bl.uniforms.uDecay.value = S.decay;
    pass(bl, shB);
    bl.uniforms.tIn.value = shB.texture;
    bl.uniforms.uLength.value = S.length * 0.35;
    pass(bl, shA);
    return vis * S.intensity;
  }

  /**
   * Eye adaptation (64x36 log-luminance grid + 1x1 adapt, ~0.02 ms). Returns the 1x1 texture
   * (R = EV offset) or null. Consecutive frames adapt over ~1/speed s (sim time); a time jump
   * (camera cut, harness capture) snaps to the target so captures are deterministic.
   */
  function renderAE(hdrTex) {
    const A = api.look.autoExposure;
    if (!A.enabled || dev.get('ae') === '0') return null;
    const lm = M.aeLum;
    lm.uniforms.tIn.value = hdrTex;
    lm.uniforms.uFoot.value.set(1 / 64, 1 / 36);
    pass(lm, aeLum);
    const t = game.time, dt = t - aeTime;
    const blend = dt > 0 && dt < 0.25 ? 1 - Math.exp(-dt * A.speed) : (dt === 0 ? 0 : 1);
    aeTime = t;
    const ad = M.aeAdapt;
    ad.uniforms.tLum.value = aeLum.texture;
    ad.uniforms.tPrev.value = aeB.texture;
    ad.uniforms.uBlend.value = blend;
    ad.uniforms.uAE.value.set(Math.log2(A.key), A.strength, A.down, A.up);
    pass(ad, aeA);
    const tmp = aeA; aeA = aeB; aeB = tmp;     // aeB = this frame's value
    if (dev.get('aedebug') === '1' && aeDebugN++ < 4) {
      const px = new Uint16Array(4);
      try {
        game.renderer.readRenderTargetPixels(aeB, 0, 0, 1, 1, px);
        console.warn(`[pipeline] auto exposure EV ${THREE.DataUtils.fromHalfFloat(px[0]).toFixed(3)} meanLog2 ${THREE.DataUtils.fromHalfFloat(px[1]).toFixed(3)}`);
      } catch (e) { /* debug only */ }
    }
    return aeB.texture;
  }

  function renderBloom(hdrTex, aeTex) {
    const B = api.look.bloom;
    const pre = M.bloomPre;
    pre.uniforms.tIn.value = hdrTex;
    pre.uniforms.uTexel.value.set(1 / size.x, 1 / size.y);
    pre.uniforms.uExposure.value = api.look.exposure;
    pre.uniforms.tAE.value = aeTex; pre.uniforms.uHasAE.value = aeTex ? 1 : 0;
    const k = Math.max(1e-4, B.threshold * B.knee);
    pre.uniforms.uThreshold.value.set(B.threshold, k, 2 * k, 0.25 / k);
    pre.uniforms.uClamp.value = B.clamp;
    pass(pre, bloomRT[0]);
    const dn = M.bloomDown;
    for (let i = 1; i < bloomRT.length; i++) {
      dn.uniforms.tIn.value = bloomRT[i - 1].texture;
      dn.uniforms.uTexel.value.set(1 / bloomRT[i - 1].width, 1 / bloomRT[i - 1].height);
      pass(dn, bloomRT[i]);
    }
    const up = M.bloomUp;
    const r = game.renderer, ac = r.autoClear;
    r.autoClear = false;
    for (let i = bloomRT.length - 1; i > 0; i--) {
      up.uniforms.tIn.value = bloomRT[i].texture;
      up.uniforms.uTexel.value.set(1 / bloomRT[i].width, 1 / bloomRT[i].height);
      up.uniforms.uWeight.value = B.weights[i] ?? 0.4;
      pass(up, bloomRT[i - 1]);
    }
    r.autoClear = ac;
    return bloomRT[0].texture;
  }

  // Camera motion blur. Previous-frame matrices: the real previous render when frames are
  // consecutive (RAF play); otherwise (harness steps many sim frames between renders) the
  // chase camera's previous pose is synthesized from the player's velocity (translation only).
  const MB = { vp: new THREE.Matrix4(), time: -1e9, pos: new THREE.Vector3(), cur: new THREE.Matrix4(), tmp: new THREE.Matrix4(), box: new THREE.Box2() };
  const _c = new THREE.Vector3(), _p = new THREE.Vector3(), _p2 = new THREE.Vector2();
  const colorCache = new Map();
  /** Parsed THREE.Color for a LOOK hex string (cached: no per-frame parsing/allocation). */
  function col(hex) { let c = colorCache.get(hex); if (!c) colorCache.set(hex, (c = new THREE.Color(hex))); return c; }
  function renderMotionBlur(cam, hdrRT) {
    const L = api.look.motionBlur;
    const t = game.time, dt = t - MB.time;
    cam.updateMatrixWorld();
    MB.cur.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    const pl = game.player, chase = !!(pl && pl.spawned !== false && pl.vel && game.cam && !game.cam.override);
    let prev = null;
    if (dt > 1e-6 && dt <= 1.5 / 60 && MB.pos.distanceTo(cam.position) < 12) prev = MB.vp;
    else if (dt > 1e-6 && chase) {
      MB.tmp.copy(cam.matrixWorld);
      MB.tmp.elements[12] -= pl.vel.x * L.chaseVel / 60;
      MB.tmp.elements[13] -= pl.vel.y * L.chaseVel / 60;
      MB.tmp.elements[14] -= pl.vel.z * L.chaseVel / 60;
      MB.tmp.invert().premultiply(cam.projectionMatrix);
      prev = MB.tmp;
    }
    const m = M.mblur;
    if (prev && L.shutter > 0) {
      setDepthUniforms(m, cam);
      m.uniforms.tScene.value = hdrRT.texture;
      m.uniforms.uCamWorld.value.copy(cam.matrixWorld);
      m.uniforms.uPrevViewProj.value.copy(prev);
      m.uniforms.uScale.value = L.shutter;
      m.uniforms.uMaxPx.value = L.maxPx * (size.y / 1080);
      m.uniforms.uRes.value.copy(size);
      // keep the player's rig sharp: its projected bounding box
      const mk = m.uniforms.uMask.value.set(1, 1, 0, 0);
      if (chase && pl.pos) {
        MB.box.makeEmpty();
        let ok = true;
        for (let i = 0; i < 8 && ok; i++) {
          _p.set(pl.pos.x + ((i & 1) ? 6 : -6), pl.pos.y + ((i & 2) ? 12.5 : -0.5), pl.pos.z + ((i & 4) ? 6 : -6));
          _c.copy(_p).applyMatrix4(cam.matrixWorldInverse);
          if (_c.z > -0.5) { ok = false; break; }
          _p.project(cam);
          MB.box.expandByPoint(_p2.set(_p.x * 0.5 + 0.5, _p.y * 0.5 + 0.5));
        }
        if (ok) mk.set(MB.box.min.x, MB.box.min.y, MB.box.max.x, MB.box.max.y);
      }
      pass(m, mbRT);
    }
    MB.vp.copy(MB.cur); MB.time = t; MB.pos.copy(cam.position);
    return prev && L.shutter > 0 ? mbRT : hdrRT;
  }

  function runSlot(name, readRT) {
    const p = slots[name];
    if (!p || p.enabled === false) return readRT;
    if (!hdrTmpA) { hdrTmpA = makeRT(size.x, size.y); hdrTmpB = makeRT(size.x, size.y); }
    const write = readRT === hdrTmpA ? hdrTmpB : hdrTmpA;
    p.render(game.renderer, write, readRT, 0, false);
    return p.needsSwap === false ? readRT : write;
  }

  const api = {
    name: 'pipeline',
    order: 1000,
    stats,
    look: LOOK,
    SOFT_LAYER,
    depthUniforms,
    glsl: { softDepth: SOFT_GLSL },
    get quality() { return qName; },
    get depthTexture() { return depthLinRT ? depthLinRT.texture : null; },
    get sceneDepthTexture() { return sceneRT ? sceneRT.depthTexture : null; },
    get sceneTexture() { return sceneRT ? sceneRT.texture : null; },
    async init(g) {
      const r = g.renderer;
      if (!r.extensions.has('EXT_color_buffer_float')) floatDepth.type = THREE.HalfFloatType;
      else floatDepth.type = THREE.FloatType;
      quad = new FullScreenQuad(null);
      M.depthCopy = P.depthCopyMaterial();
      M.aoBlur = P.aoBlurMaterial();
      M.shaftMask = P.shaftMaskMaterial();
      M.bloomPre = P.bloomPrefilterMaterial();
      M.bloomDown = P.bloomDownMaterial();
      M.bloomUp = P.bloomUpMaterial();
      M.composite = P.compositeMaterial(atmosGLSL());
      M.volBlur = P.volumeBlurMaterial();
      M.aeLum = P.lumMaterial();
      M.aeAdapt = P.adaptMaterial();
      M.spkE = P.speckleExcessMaterial();
      M.spkS = P.speckleSpreadMaterial();
      fxaaMat = new THREE.ShaderMaterial({ ...FXAAShader, uniforms: THREE.UniformsUtils.clone(FXAAShader.uniforms), depthTest: false, depthWrite: false });
      smaa = new SMAAPass();
      smaa.renderToScreen = true;
      // SMAA 'high' preset (three ships 'medium'): lower luma threshold, longer edge search
      try {
        smaa._materialEdges.defines.SMAA_THRESHOLD = '0.05';
        smaa._materialWeights.defines.SMAA_MAX_SEARCH_STEPS = '16';
        smaa._materialEdges.needsUpdate = true; smaa._materialWeights.needsUpdate = true;
      } catch (e) { /* keep defaults */ }
      // wait for SMAA's embedded lookup textures (data URLs) so the first frame is anti-aliased
      const imgs = [smaa._areaTexture && smaa._areaTexture.image, smaa._searchTexture && smaa._searchTexture.image].filter(Boolean);
      await Promise.all(imgs.map((im) => (im.complete && im.naturalWidth ? null : new Promise((res) => {
        im.addEventListener('load', res, { once: true });
        im.addEventListener('error', res, { once: true });
        setTimeout(res, 4000);
      }))));
      if (dev.get('tonemap')) LOOK.tonemap = dev.get('tonemap');
      if (dev.get('exposure')) LOOK.exposure = Number(dev.get('exposure')) || LOOK.exposure;
      // dev: &look=grade.contrast:1.2,bloom.intensity:0.2
      for (const kv of (dev.get('look') || '').split(',').filter(Boolean)) {
        const [path, val] = kv.split(':');
        const keys = path.split('.'), last = keys.pop();
        let o = LOOK;
        for (const k of keys) o = o && o[k];
        if (o && last in o && Number.isFinite(Number(val))) o[last] = Number(val);
      }
      api.setQuality(g.params.quality);
      g.pipeline = api;
      const cs = r.getSize(new THREE.Vector2());
      api.setSize(cs.x, cs.y);
      // Warm-up while the boot screen is up: bake the static far shadow cascade, compile the
      // scene's programs and flush, so the first real frame does not pay for them.
      try {
        if (g.env && g.env.preRender) g.env.preRender(g.camera);
        r.compile(g.scene, g.camera);
        // fenced async read-back = wait until the GPU finished the queued work (no stall)
        await r.readRenderTargetPixelsAsync(ldrRT, 0, 0, 1, 1, new Uint8Array(4));
      } catch (e) { /* warm-up is optional */ }
    },
    setQuality(name) {
      qName = QUALITY[name] ? name : 'high';
      q = { ...QUALITY[qName] };
      // MSAA on a CPU rasterizer costs ~3x the whole frame (SMAA still anti-aliases edges)
      if (q.msaa && softwareRendererName(game.renderer)) q.msaa = 0;
      if (dev.get('msaa') !== null) q.msaa = Number(dev.get('msaa')) || 0;
      if (dev.get('ao') === '0') q.ao = 0;
      if (dev.get('aa')) q.aa = dev.get('aa');
      if (dev.get('shafts') === '0') q.shafts = 0;
      if (dev.get('vol') === '0') q.vol = 0;
      if (dev.get('speckle') === '0') q.speckle = 0;
      for (const k of ['ao', 'shaftBlur', 'mblur', 'vol']) if (M[k]) { M[k].dispose(); M[k] = null; }
      M.vol = q.vol ? P.volumeMaterial(q.vol, atmosGLSL()) : null;
      M.ao = q.ao ? P.aoMaterial(q.ao) : null;
      M.shaftBlur = q.shafts ? P.shaftBlurMaterial(q.shafts) : null;
      if (dev.get('mblur') === '0') q.mblur = 0;
      M.mblur = q.mblur ? P.motionBlurMaterial(q.mblur) : null;
      if (quad) buildTargets();
    },
    setSlot(name, p) {
      if (!(name in slots)) throw new Error(`[pipeline] unknown slot ${name}`);
      slots[name] = p || null;
      if (p && p.setSize) p.setSize(size.x, size.y);
    },
    markSoft(object) {
      object.traverse((o) => o.layers.set(SOFT_LAYER));
      if (!softEnabled) { softEnabled = true; if (sceneRT) makeDepthLin(); }
    },
    setSize(w, h) {
      const r = game.renderer;
      if (!r) return;
      const db = r.getDrawingBufferSize(new THREE.Vector2());
      const W = Math.max(1, Math.round(db.x)), H = Math.max(1, Math.round(db.y));
      if (W === size.x && H === size.y && sceneRT) return;
      size.set(W, H);
      if (quad) buildTargets();
      for (const k in slots) if (slots[k] && slots[k].setSize) slots[k].setSize(W, H);
    },
    render(realDt) {
      const r = game.renderer, scene = game.scene, cam = game.camera;
      if (!sceneRT) buildTargets();
      if (game.env && game.env.preRender) game.env.preRender(cam);
      frameNo++;
      if (frameNo === 1) { try { r.compile(scene, cam); } catch (e) { /* optional */ } } // actors spawned after init
      const calls0 = r.info.render.calls, tris0 = r.info.render.triangles; // excludes one-off bakes
      // ---- scene (layer 0)
      r.setRenderTarget(sceneRT);
      r.render(scene, cam);
      // ---- soft layer: copy opaque depth, then draw layer-1 objects sampling it
      if (softEnabled) {
        const dc = M.depthCopy;
        setDepthUniforms(dc, cam);
        pass(dc, depthLinRT);
        depthUniforms.uIwDepthParams.value.z = cam.near;
        depthUniforms.uIwDepthParams.value.w = cam.far;
        const ac = r.autoClear, su = r.shadowMap.autoUpdate, mask = cam.layers.mask;
        r.autoClear = false; r.shadowMap.autoUpdate = false;
        cam.layers.set(SOFT_LAYER);
        r.setRenderTarget(sceneRT);
        r.render(scene, cam);
        cam.layers.mask = mask;
        r.autoClear = ac; r.shadowMap.autoUpdate = su;
      }
      stats.scene.calls = r.info.render.calls - calls0;
      stats.scene.triangles = r.info.render.triangles - tris0;

      let hdrRT = runSlot('pre_bloom', runSlot('ao', sceneRT));
      if (M.mblur) hdrRT = renderMotionBlur(cam, hdrRT);
      const L = api.look;
      const aoTex = M.ao ? renderAO(cam) : null;
      const volTex = M.vol ? renderVolume(cam) : null;
      const aeTex = renderAE(hdrRT.texture);     // (before the shafts: its grid = local mean)
      aeLumValid = !!aeTex;
      const shaftI = q.shafts ? renderShafts(cam, hdrRT.texture) : 0;
      const bloomTex = L.bloom.intensity > 0 ? renderBloom(hdrRT.texture, aeTex) : null;
      hdrRT = runSlot('post_bloom', hdrRT);

      // ---- composite
      const c = M.composite, u = c.uniforms;
      const tm = L.tonemap === 'aces' ? 1 : 0;
      if ((c.defines.TONEMAP_ACES ? 1 : 0) !== tm) {
        if (tm) c.defines.TONEMAP_ACES = 1; else delete c.defines.TONEMAP_ACES;
        c.needsUpdate = true;
      }
      u.tScene.value = hdrRT.texture;
      u.tAO.value = aoTex; u.uHasAO.value = aoTex ? 1 : 0; u.uAO.value = L.ao.strength; u.uAOFloor.value = L.ao.floor;
      u.tBloom.value = bloomTex; u.uHasBloom.value = bloomTex ? 1 : 0; u.uBloom.value = L.bloom.intensity;
      u.tShafts.value = shaftI > 0 ? shA.texture : null; u.uHasShafts.value = shaftI > 0 ? 1 : 0;
      setDepthUniforms(c, cam);
      u.tVol.value = volTex; u.uHasVol.value = volTex ? 1 : 0;
      u.uVolLit.value = L.volume.lit; u.uVolOcc.value = L.volume.occ; u.uVolMaxZ.value = L.volume.maxDist * 4;
      u.uVolDust.value = L.volume.dust; u.uDustIso.value = L.volume.dustIso;
      if (game.env && game.env.sun) u.uSunCol.value.copy(game.env.sun.color).multiplyScalar(game.env.sun.intensity);
      u.uCamWorld.value.copy(cam.matrixWorld);
      if (game.scene.fog) { u.uFogColor.value.copy(game.scene.fog.color); u.uFogD0.value = game.scene.fog.density; }
      u.uAerial.value = game.scene.fog && q.vol ? L.aerial : 0; // (medium/high; low skips the per-pixel fog evaluation)
      u.uShaftTint.value.copy(col(L.shafts.tint)).multiplyScalar(shaftI);
      u.tNoise.value = game.env ? game.env.noise : null;
      u.uExposure.value = L.exposure;
      u.tAE.value = aeTex; u.uHasAE.value = aeTex ? 1 : 0;
      u.uCA.value = L.ca;
      u.uVignette.value = L.vignette;
      u.uGrain.value = u.tNoise.value ? L.grain : 0;
      // grain pattern changes per rendered frame but stays deterministic (frame counter)
      u.uGrainOffset.value.set((frameNo * 0.6180339) % 1, (frameNo * 0.7548776) % 1);
      // lift in DISPLAY space (sRGB components of the hex) -> black level of the frame
      u.uLift.value.copy(col(L.grade.lift)).convertLinearToSRGB().multiplyScalar(L.grade.liftAmt);
      // highlight hue at unit luminance
      u.uGain.value.copy(col(L.grade.gain));
      const gm = u.uGain.value.r * 0.2126 + u.uGain.value.g * 0.7152 + u.uGain.value.b * 0.0722;
      u.uGain.value.multiplyScalar(1 / gm);
      u.uGainAmt.value = L.grade.gainAmt;
      u.uShadowTint.value.copy(col(L.grade.lift));
      const sm = Math.max(u.uShadowTint.value.r, u.uShadowTint.value.g, u.uShadowTint.value.b);
      u.uShadowTint.value.multiplyScalar(1 / sm);
      u.uShadowAmt.value = L.grade.shadowAmt;
      u.uShadowDesat.value = L.grade.shadowDesat;
      u.uSat.value = L.grade.sat;
      u.uContrast.value = L.grade.contrast;
      u.uHiLift.value = L.grade.hiLift;
      u.uRes.value.copy(size);
      u.uDebug.value = debugView;
      const aa = q.aa;
      const toLdr = aa === 'smaa' || aa === 'fxaa';
      const spk = toLdr && q.speckle && ldrB && L.speckle.amount > 0;
      u.uProtect.value.set(L.speckle.protect[0], spk ? L.speckle.protect[1] : 0);
      pass(c, toLdr ? ldrRT : null);
      let ldrOut = ldrRT;
      if (spk) {
        // sub-pixel resolve: isolated outliers -> their coverage (see postfx.js)
        const e = M.spkE.uniforms, sp = M.spkS.uniforms;
        e.tIn.value = ldrRT.texture; e.uTexel.value.set(1 / size.x, 1 / size.y);
        e.uGate.value.set(L.speckle.gate[0], L.speckle.gate[1]);
        pass(M.spkE, spkE);
        sp.tIn.value = ldrRT.texture; sp.tE.value = spkE.texture; sp.uTexel.value.set(1 / size.x, 1 / size.y);
        sp.uAmount.value = L.speckle.amount;
        pass(M.spkS, ldrB);
        ldrOut = ldrB;
      }
      if (aa === 'smaa') smaa.render(r, null, ldrOut);
      else if (aa === 'fxaa') { fxaaMat.uniforms.tDiffuse.value = ldrOut.texture; pass(fxaaMat, null); }
      r.setRenderTarget(null);
      // the very first frame compiles the actors' programs and uploads their textures: wait
      // for it here (boot screen still up) instead of stalling the first gameplay frame later
      if (frameNo === 1) r.getContext().finish();
      // harness (manual stepping): finish the frame HERE (1-px read-back = fence) so a capture's
      // GPU work is spent inside the step/render call, not inside page.screenshot's 30 s budget
      // (SwiftShader under shared CPU load). Never in play / RAF mode.
      if (game.manual) {
        try { const gl = r.getContext(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, syncPx); } catch (e) { /* optional */ }
      }
    },
    dispose() {
      disposeTargets();
      for (const k in M) if (M[k]) M[k].dispose();
      if (fxaaMat) fxaaMat.dispose();
      if (smaa) smaa.dispose();
      if (quad) quad.dispose();
    },
  };
  return api;
}

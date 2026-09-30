// src/render/environment.js — sky, height fog, sun + shadow cascades, ambient/IBL, weather
// (owner: render engineer). Look: dusk under an ash storm (AC6_BENCHMARK §3.3, §5).
//
// API (game.env):
//   sun            THREE.DirectionalLight — the key light AND the near shadow cascade
//   sunFar         THREE.DirectionalLight — far cascade (static arena bake; colour 0, shadow only)
//   hemi           THREE.HemisphereLight  — cool sky fill / warm ground bounce
//   focus          THREE.Vector3 the near cascade is centred on (the camera system updates it)
//   sunDir         normalized direction TOWARDS the sun (constant)
//   palette        colours used by fog/sky (other systems may read them)
//   noise          shared 256² RGBA tileable noise texture (userData.shared)
//   weather        { mesh, uniforms } falling ash (hide: game.env.weather.mesh.visible = false)
//   envMap         PMREM texture used as scene.environment
//   setShadowRange(halfSizeMeters)   near cascade half size (default by quality)
//   rebakeFarShadow()                re-render the static far cascade (after arena changes)
//   preRender(camera)                called by the pipeline right before the scene pass
//
// Shadows: near cascade = 4096² (high) / 2048² (medium, low) box around focus, pushed ~R/2
// ahead of the camera, light-aligned, texel-snapped, updated every frame. Far cascade = one
// 4096²/2048² bake of the static arena (no per-frame cost); low quality skips it. Both are
// blended in the lighting chunk (atmosphere.js). Light count is constant (2 directional +
// 1 hemisphere) at every quality level.
import * as THREE from 'three';
import { ATMOS, sunDirection, installAtmosphereChunks, softwareRendererName } from './atmosphere.js';
import { createNoiseTexture, createSky } from './sky.js';
import { createWeather } from './weather.js';

const QUALITY = {
  //        near map, near half size (m), far map, far bake, weather flakes
  low: { nearMap: 2048, nearHalf: 60, farMap: 2048, far: false, flakes: 1800 },
  medium: { nearMap: 2048, nearHalf: 64, farMap: 2048, far: true, flakes: 3800 },
  high: { nearMap: 4096, nearHalf: 70, farMap: 4096, far: true, flakes: 6000 },
};

/**
 * Software rasterizers (SwiftShader, llvmpipe, WARP) render the high pipeline at a few
 * seconds per frame: in normal play (not the test harness) and without an explicit
 * &quality=, drop to 'low' so the game stays playable. Runs in the factory, i.e. before any
 * system's init() reads game.params.quality.
 */
function autoQuality(game) {
  try {
    if (game.params.test) return;
    if (typeof location !== 'undefined' && new URLSearchParams(location.search).has('quality')) return;
    const name = softwareRendererName(game.renderer);
    if (name) {
      game.params.quality = 'low';
      // CPU rasterizers: half resolution is ~2x faster. The canvas is upscaled by the browser.
      game.renderer.setPixelRatio(0.5);
      console.info(`[environment] software renderer (${name}) -> quality=low, pixel ratio 0.5`);
    }
  } catch (e) { /* keep the requested quality */ }
}

export default function environmentSystem(game) {
  autoQuality(game);
  const palette = {
    zenith: new THREE.Color(ATMOS.sky.zenith),
    horizon: new THREE.Color(ATMOS.sky.horizon),
    ground: new THREE.Color(ATMOS.sky.ground),
    fog: new THREE.Color(ATMOS.fog.far),
    sun: new THREE.Color(ATMOS.sun.light),
  };
  const sunDir = sunDirection();
  const focus = new THREE.Vector3();
  const Q = QUALITY[game.params.quality] || QUALITY.high;
  let sun, sunFar, hemi, sky, weather, envRT = null, noise;
  let nearHalf = Q.nearHalf;
  let farBaked = false, farPending = Q.far;
  const nearHY = 22;            // near box half height (m)

  // light-space basis: z towards the sun, x horizontal, y = z × x
  const LZ = sunDir.clone();
  const LX = new THREE.Vector3(0, 1, 0).cross(LZ).normalize();
  const LY = LZ.clone().cross(LX).normalize();
  const AZ = new THREE.Vector3(sunDir.x, 0, sunDir.z).normalize(); // horizontal sun azimuth
  const _c = new THREE.Vector3(), _f = new THREE.Vector3(), _v = new THREE.Vector3();
  const lastCam = new THREE.Vector3(); let lastTime = -1;
  const camVel = new THREE.Vector3();

  /** Ortho extents (light space) of a light-aligned world box: half R across/along, hy up. */
  const _ext = { x: 0, y: 0 };
  function lightExtents(R, hy) {
    const sinEl = Math.abs(sunDir.y), cosEl = Math.sqrt(1 - sinEl * sinEl);
    _ext.x = R; _ext.y = sinEl * R + cosEl * hy;
    return _ext;
  }

  function configureCascade(light, center, R, hy, mapSize, depthBack) {
    const ext = lightExtents(R, hy);
    const tx = (2 * ext.x) / mapSize, ty = (2 * ext.y) / mapSize;
    // snap the centre to the texel grid in light space (no shimmer while moving)
    const cx = center.dot(LX), cy = center.dot(LY);
    _c.copy(center).addScaledVector(LX, Math.round(cx / tx) * tx - cx).addScaledVector(LY, Math.round(cy / ty) * ty - cy);
    const cam = light.shadow.camera;
    cam.left = -ext.x; cam.right = ext.x; cam.top = ext.y; cam.bottom = -ext.y;
    cam.near = 1; cam.far = depthBack + R * 2 + hy * 2;
    cam.updateProjectionMatrix();
    light.target.position.copy(_c);
    light.position.copy(_c).addScaledVector(sunDir, depthBack);
    light.target.updateMatrixWorld();
    light.updateMatrixWorld();
  }

  function bakeFar(g) {
    const arena = g.arena && g.arena.root;
    if (!arena || !sunFar.castShadow) return;
    const b = g.arena.bounds || { minX: -250, maxX: 250, minZ: -250, maxZ: 250 };
    const cxw = (b.minX + b.maxX) / 2, czw = (b.minZ + b.maxZ) / 2;
    const half = Math.max(b.maxX - b.minX, b.maxZ - b.minZ) / 2 + 40;
    // light-aligned square covering the (possibly rotated) arena square
    const R = half * (Math.abs(AZ.x) + Math.abs(AZ.z));
    configureCascade(sunFar, _v.set(cxw, 70, czw), R, 75, Q.farMap, 1800);
    // render ONLY the static arena into the far map (actors/particles hidden for the bake)
    const scene = g.scene, hidden = [];
    for (const c of scene.children) {
      if (c === arena || c.isLight || !c.visible) continue;
      c.visible = false; hidden.push(c);
    }
    // (the near map renders too — it must exist for the lit materials compiled here; it is
    // re-rendered with every actor in the real scene pass right after)
    sunFar.shadow.needsUpdate = true;
    const r = g.renderer, prev = r.getRenderTarget();
    const tiny = new THREE.WebGLRenderTarget(4, 4);
    r.setRenderTarget(tiny);
    r.render(scene, g.camera);
    r.setRenderTarget(prev);
    tiny.dispose();
    for (const c of hidden) c.visible = true;
    farBaked = true;
  }

  const api = {
    name: 'environment',
    order: 20,
    palette, sunDir, focus,
    get sun() { return sun; },
    get sunFar() { return sunFar; },
    get hemi() { return hemi; },
    get sky() { return sky; },
    get weather() { return weather; },
    get noise() { return noise; },
    get envMap() { return envRT ? envRT.texture : null; },
    init(g) {
      installAtmosphereChunks();
      const scene = g.scene;
      scene.background = null;
      scene.fog = new THREE.FogExp2(palette.fog.getHex(), ATMOS.fog.density);
      scene.fog.color.copy(palette.fog);
      noise = createNoiseTexture();

      sky = createSky(noise, scene.fog);
      scene.add(sky.mesh);

      // Lights (constant count at every quality level)
      const A = ATMOS.ambient;
      hemi = new THREE.HemisphereLight(new THREE.Color(A.sky), new THREE.Color(A.ground), A.intensity);
      hemi.name = 'sky_fill';
      scene.add(hemi);

      sun = new THREE.DirectionalLight(palette.sun, ATMOS.sun.intensity);
      sun.name = 'sun';
      sun.castShadow = true;
      sun.shadow.mapSize.set(Q.nearMap, Q.nearMap);
      sun.shadow.bias = -0.00012;
      sun.shadow.normalBias = 0.035;
      sun.shadow.radius = 1.0;
      scene.add(sun); scene.add(sun.target);

      sunFar = new THREE.DirectionalLight(0x000000, 0); // shadow provider only (see atmosphere.js)
      sunFar.name = 'sun_far_cascade';
      sunFar.castShadow = Q.far;
      sunFar.shadow.mapSize.set(Q.farMap, Q.farMap);
      sunFar.shadow.bias = -0.0002;
      sunFar.shadow.normalBias = 0.16;
      sunFar.shadow.radius = 1.6;
      sunFar.shadow.autoUpdate = false;
      sunFar.shadow.needsUpdate = false;
      scene.add(sunFar); scene.add(sunFar.target);
      configureCascade(sun, focus, nearHalf, nearHY, Q.nearMap, 1500);
      configureCascade(sunFar, focus, 300, 75, Q.farMap, 1800);

      // Environment map (IBL) = PMREM of the sky dome (clouds, sun glow, haze horizon).
      const pmrem = new THREE.PMREMGenerator(g.renderer);
      const envScene = new THREE.Scene();
      const envSky = new THREE.Mesh(sky.mesh.geometry, sky.material);
      envSky.frustumCulled = false;
      envScene.add(envSky);
      envRT = pmrem.fromScene(envScene, 0.03, 0.1, 2000);
      scene.environment = envRT.texture;
      scene.environmentIntensity = ATMOS.envIntensity;
      pmrem.dispose();

      // Falling ash (replaces the arena's placeholder flakes, see preRender)
      weather = createWeather(Q.flakes, { sunDir, sunColor: palette.sun.clone().multiplyScalar(ATMOS.sun.intensity * 0.35), ambient: new THREE.Color(A.sky).multiplyScalar(0.9) });
      scene.add(weather.mesh);

      g.env = api;
    },
    setShadowRange(half) {
      nearHalf = half;
      configureCascade(sun, focus, nearHalf, nearHY, sun.shadow.mapSize.x, 1500);
    },
    rebakeFarShadow() { farPending = sunFar.castShadow; farBaked = false; },
    frame() { /* camera-dependent work happens in preRender (after the camera system) */ },
    /** Called by the pipeline after every system's frame(), right before the scene pass. */
    preRender(camera) {
      const g = game;
      sky.mesh.position.copy(camera.position);
      sky.uniforms.uTime.value = g.time;
      sky.uniforms.uFogDensity.value = g.scene.fog ? g.scene.fog.density : ATMOS.fog.density;
      // near cascade: light-aligned box from the ground up past the focus, pushed half a
      // size along the view direction. Height grows in 16 m steps while airborne (a pop,
      // not a continuous texel swim).
      camera.getWorldDirection(_f); _f.y = 0;
      if (_f.lengthSq() < 1e-6) _f.set(0, 0, 1);
      _f.normalize();
      const hy = nearHY + 8 * Math.ceil(Math.max(focus.y - 16, 0) / 16);
      _v.copy(focus).addScaledVector(_f, nearHalf * 0.5);
      _v.y = hy - 6;
      configureCascade(sun, _v, nearHalf, hy, sun.shadow.mapSize.x, 1500);
      if (farPending && !farBaked && g.arena && g.arena.root) bakeFar(g);
      // camera velocity (sim time) for weather streaks
      const t = g.time;
      if (lastTime >= 0 && t > lastTime && t - lastTime < 0.5) {
        camVel.copy(camera.position).sub(lastCam).divideScalar(t - lastTime);
        if (camVel.lengthSq() > 190 * 190) camVel.set(0, 0, 0); // camera cut, not motion
      } else if (lastTime < 0 || t !== lastTime) camVel.set(0, 0, 0);
      lastCam.copy(camera.position); lastTime = t;
      weather.update(camera, t, camVel);
      // the environment owns the atmosphere: the arena's placeholder flakes are replaced
      const aash = g.arena && g.arena.ash;
      if (aash && aash.mesh && aash.mesh.visible && weather.mesh.visible) aash.mesh.visible = false;
    },
    dispose() {
      sky.dispose();
      weather.dispose();
      if (envRT) envRT.dispose();
      if (sun.shadow.map) sun.shadow.map.dispose();
      if (sunFar.shadow.map) sunFar.shadow.map.dispose();
    },
  };
  return api;
}

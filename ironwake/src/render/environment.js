// src/render/environment.js — sky, fog, sun, ambient, shadows, environment map
// (owner: render engineer). PLACEHOLDER look: ash-heavy, low warm sun.
//
// API (game.env):
//   sun            THREE.DirectionalLight (casts shadows; follows game.env.focus)
//   hemi           THREE.HemisphereLight
//   focus          THREE.Vector3 the shadow frustum is centered on (camera system updates it)
//   sunDir         normalized direction TOWARDS the sun
//   palette        colors used by fog/sky (other systems may read them)
//   setShadowRange(halfSizeMeters)
import * as THREE from 'three';

const SKY_VERT = /* glsl */`
varying vec3 vDir;
void main() {
  vDir = normalize((modelMatrix * vec4(position, 0.0)).xyz);
  vec4 p = projectionMatrix * viewMatrix * vec4((modelMatrix * vec4(position, 1.0)).xyz, 1.0);
  gl_Position = p.xyww; // at far plane
}`;
const SKY_FRAG = /* glsl */`
uniform vec3 uZenith; uniform vec3 uHorizon; uniform vec3 uGround; uniform vec3 uSunColor;
uniform vec3 uSunDir; uniform float uSunSize;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col = mix(uHorizon, uZenith, smoothstep(0.0, 0.55, h));
  col = mix(col, uGround, smoothstep(0.0, -0.25, h));
  float s = max(dot(d, uSunDir), 0.0);
  col += uSunColor * (pow(s, 8.0) * 0.35 + pow(s, 64.0) * 0.8);
  col += uSunColor * smoothstep(1.0 - uSunSize, 1.0 - uSunSize * 0.6, s) * 6.0;
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export default function environmentSystem(game) {
  // Colour script from docs/AC6_BENCHMARK.md §5 (dusk, sun smothered behind ash).
  const palette = {
    zenith: new THREE.Color('#2b2f36'),
    horizon: new THREE.Color('#6e6660'),
    ground: new THREE.Color('#3a342e'),
    fog: new THREE.Color('#7a6f66'),
    sun: new THREE.Color('#f2b27a'),
  };
  const sunDir = new THREE.Vector3(-0.45, 0.42, -0.78).normalize();
  const focus = new THREE.Vector3();
  let sun, hemi, sky, envRT, shadowHalf = 110;
  const _tmp = new THREE.Vector3();

  const api = {
    name: 'environment',
    order: 20,
    palette, sunDir, focus,
    get sun() { return sun; },
    get hemi() { return hemi; },
    init(g) {
      const scene = g.scene;
      scene.background = null;
      scene.fog = new THREE.FogExp2(palette.fog.getHex(), 0.0019);

      // Sky dome
      const skyMat = new THREE.ShaderMaterial({
        vertexShader: SKY_VERT, fragmentShader: SKY_FRAG,
        uniforms: {
          uZenith: { value: palette.zenith }, uHorizon: { value: palette.horizon },
          uGround: { value: palette.ground }, uSunColor: { value: palette.sun },
          uSunDir: { value: sunDir }, uSunSize: { value: 0.0009 },
        },
        side: THREE.BackSide, depthWrite: false, depthTest: true, fog: false,
      });
      sky = new THREE.Mesh(new THREE.SphereGeometry(1000, 32, 16), skyMat);
      sky.name = 'sky';
      sky.frustumCulled = false;
      sky.renderOrder = -1000;
      scene.add(sky);

      // Lights
      hemi = new THREE.HemisphereLight(0xb8b0a4, 0x3a342c, 0.9);
      scene.add(hemi);
      sun = new THREE.DirectionalLight(palette.sun.getHex(), 3.2);
      sun.name = 'sun';
      sun.castShadow = true;
      const sm = g.params.quality === 'low' ? 1024 : 2048;
      sun.shadow.mapSize.set(sm, sm);
      sun.shadow.bias = -0.0004;
      sun.shadow.normalBias = 0.6;
      api.setShadowRange(shadowHalf);
      scene.add(sun);
      scene.add(sun.target);

      // Environment map for PBR reflections: PMREM of the sky dome.
      const pmrem = new THREE.PMREMGenerator(g.renderer);
      const envScene = new THREE.Scene();
      const envSky = new THREE.Mesh(sky.geometry, skyMat);
      envScene.add(envSky);
      envRT = pmrem.fromScene(envScene, 0.04);
      scene.environment = envRT.texture;
      scene.environmentIntensity = 0.55;
      pmrem.dispose();

      g.env = api;
    },
    setShadowRange(half) {
      shadowHalf = half;
      const c = sun.shadow.camera;
      c.left = -half; c.right = half; c.top = half; c.bottom = -half;
      c.near = 10; c.far = 900;
      c.updateProjectionMatrix();
    },
    frame() {
      // Keep the sky centered on the camera, and the shadow frustum on the focus point,
      // snapped to shadow texels to avoid shimmering.
      sky.position.copy(game.camera.position);
      const texel = (shadowHalf * 2) / sun.shadow.mapSize.x;
      _tmp.copy(focus);
      _tmp.x = Math.round(_tmp.x / texel) * texel;
      _tmp.z = Math.round(_tmp.z / texel) * texel;
      sun.target.position.copy(_tmp);
      sun.position.copy(_tmp).addScaledVector(sunDir, 400);
      sun.target.updateMatrixWorld();
    },
    dispose() {
      sky.geometry.dispose(); sky.material.dispose();
      if (envRT) envRT.dispose();
    },
  };
  return api;
}

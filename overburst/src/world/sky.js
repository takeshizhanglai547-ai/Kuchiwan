// ============================================================
//  world/sky.js — procedural Rubicon smog sky.
//  Overcast slate overhead, dull amber horizon band, diffuse sun
//  disc buried in haze.  Also generates the IBL used by every
//  material via PMREMGenerator.
// ============================================================
import * as THREE from 'three';
import { fbmField, canvas2d, tex } from './textures.js';

// NOTE: these are authored directly in LINEAR working space (float triples),
// not sRGB hex — ACES tone mapping compresses them on the way to the screen.
export const SKY = {
  zenith: new THREE.Color(0.072, 0.086, 0.108),   // cold slate overhead
  mid: new THREE.Color(0.215, 0.208, 0.196),      // dirty overcast belly
  horizon: new THREE.Color(0.520, 0.336, 0.176),  // dull amber smog band
  hot: new THREE.Color(1.150, 0.760, 0.362),      // sun-side horizon flare
  ground: new THREE.Color(0.048, 0.034, 0.025),   // below the horizon line
  sunColor: new THREE.Color(1.250, 0.930, 0.640),
  // Low raking key from the ENE at ~17 degrees. Chosen so that the two faces
  // a third-person camera usually sees split hard into lit / unlit, and so the
  // shadows rake WSW right across the open basin.
  sunDir: new THREE.Vector3(0.845, 0.358, -0.398).normalize(),
  fog: new THREE.Color(0.152, 0.126, 0.098),
};

const VERT = /* glsl */`
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
}
`;

const FRAG = /* glsl */`
uniform vec3 uZenith, uMid, uHorizon, uHot, uGround, uSun, uSunDir;
uniform float uTime;
uniform sampler2D uNoise;
varying vec3 vDir;

void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  float up = clamp(h, 0.0, 1.0);

  // --- smog stack: warm band hugging the horizon, slate overhead ---
  vec3 col = mix(uHorizon, uMid, pow(clamp(up * 3.4, 0.0, 1.0), 0.62));
  col = mix(col, uZenith, pow(up, 0.72));

  // sun-side warming of the horizon band
  float az = clamp(dot(normalize(vec3(d.x, 0.0, d.z)), normalize(vec3(uSunDir.x, 0.0, uSunDir.z))), 0.0, 1.0);
  col = mix(col, uHot, pow(az, 2.6) * (1.0 - smoothstep(0.02, 0.42, up)) * 0.85);

  // --- broken cloud deck: a flat plane projected overhead ---
  float pl = 0.42 / (up + 0.075);                    // perspective on the deck
  vec2 puv = vec2(atan(d.z, d.x) * 0.15915 * 3.0, pl);
  float n1 = texture2D(uNoise, puv * vec2(1.0, 1.0) + vec2(uTime * 0.0035, uTime * 0.0022)).r;
  float n2 = texture2D(uNoise, puv * vec2(2.6, 2.3) - vec2(uTime * 0.0072, 0.0)).g;
  float clouds = clamp((n1 * 0.68 + n2 * 0.42 - 0.30) * 2.1, 0.0, 1.0);
  float deck = smoothstep(0.0, 0.16, up);
  // heavy bellies, torn brighter gaps
  col *= mix(1.0, 0.44 + clouds * 1.20, deck * 0.92);
  col = mix(col, col * 1.30 + uHot * 0.05, smoothstep(0.5, 0.95, clouds) * deck);

  // --- sun: broad diffuse bloom, weak disc, occluded by cloud ---
  float sd = clamp(dot(d, uSunDir), 0.0, 1.0);
  float disc = smoothstep(0.9975, 0.9994, sd) * 5.0;
  float glow = pow(sd, 44.0) * 1.7 + pow(sd, 7.0) * 0.62 + pow(sd, 2.0) * 0.20;
  float veil = 0.40 + 0.60 * clouds;
  col += uSun * (glow * veil + disc * veil * veil);

  // --- below horizon fades into the ground haze ---
  col = mix(col, uGround, smoothstep(0.0, -0.10, h));

  // faint vertical banding = particulate stratification
  col *= 1.0 + 0.05 * sin(h * 48.0 + n1 * 6.0);

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export class Sky {
  constructor(ctx) {
    this.ctx = ctx;
    this.time = 0;
  }

  build() {
    const noise = this._noiseTexture();
    this.uniforms = {
      uZenith: { value: SKY.zenith.clone() },
      uMid: { value: SKY.mid.clone() },
      uHorizon: { value: SKY.horizon.clone() },
      uHot: { value: SKY.hot.clone() },
      uGround: { value: SKY.ground.clone() },
      uSun: { value: SKY.sunColor.clone() },
      uSunDir: { value: SKY.sunDir.clone() },
      uNoise: { value: noise },
      uTime: { value: 0 },
    };

    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: VERT,
      fragmentShader: FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: true,
      fog: false,
    });

    const geo = new THREE.SphereGeometry(1, 48, 28);
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.scale.setScalar(2600);
    // drawn LAST in the opaque queue: only sky pixels that survived the depth
    // test get shaded, which is a large fill-rate saving in a dense scene.
    this.mesh.renderOrder = 900;
    this.mesh.frustumCulled = false;
    this.mesh.name = 'sky';
    return this.mesh;
  }

  /** Render the sky dome into a PMREM cube so every PBR material gets
   *  a real, matching environment instead of a flat ambient term. */
  buildEnvironment(renderer) {
    let rt = null;
    try {
      const pmrem = new THREE.PMREMGenerator(renderer);
      pmrem.compileEquirectangularShader?.();
      const s = new THREE.Scene();
      const dome = new THREE.Mesh(new THREE.SphereGeometry(20, 32, 20), this.material.clone());
      dome.material.depthTest = true;
      dome.material.depthWrite = true;
      s.add(dome);
      // a warm bounce card standing in for the slag pit + ground
      const floor = new THREE.Mesh(
        new THREE.SphereGeometry(19.5, 24, 12, 0, Math.PI * 2, Math.PI * 0.52, Math.PI * 0.48),
        new THREE.MeshBasicMaterial({ color: 0x3a2a1e, side: THREE.BackSide, toneMapped: false }),
      );
      s.add(floor);
      rt = pmrem.fromScene(s, 0.02, 1, 60);
      dome.geometry.dispose(); dome.material.dispose();
      floor.geometry.dispose(); floor.material.dispose();
      pmrem.dispose();
    } catch (e) {
      rt = null;
    }
    this.envRT = rt;
    return rt ? rt.texture : null;
  }

  _noiseTexture() {
    const S = 256;
    const a = fbmField(S, { octaves: 6, base: 3, seed: 4711 });
    const b = fbmField(S, { octaves: 4, base: 11, seed: 4712 });
    const c = canvas2d(S), g = c.getContext('2d');
    const im = g.createImageData(S, S), d = im.data;
    for (let i = 0, p = 0; i < a.length; i++, p += 4) {
      const v = Math.min(1, Math.max(0, a[i] * 0.78 + b[i] * 0.28));
      d[p] = v * 255; d[p + 1] = (a[i] * 255) | 0; d[p + 2] = (b[i] * 255) | 0; d[p + 3] = 255;
    }
    g.putImageData(im, 0, 0);
    const t = tex(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  }

  update(dt) {
    this.time += dt;
    if (this.uniforms) this.uniforms.uTime.value = this.time;
  }
}

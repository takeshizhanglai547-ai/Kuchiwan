// ============================================================
//  world/sky.js — procedural Rubicon smog sky.
//  Overcast slate overhead, dull amber horizon band, diffuse sun
//  disc buried in haze.  Also generates the IBL used by every
//  material via PMREMGenerator.
// ============================================================
import * as THREE from 'three';
import { fbmField, canvas2d, tex } from './textures.js';

// NOTE: these are authored directly in LINEAR working space (float triples),
// not sRGB hex — the filmic tonemap compresses them on the way to the screen.
//
// The stack, bottom to top: a DULL AMBER smog band pinned to the horizon
// (exp falloff, ~5 deg core), a dirty overcast belly above it, cold slate at
// the zenith.  `fog` is deliberately locked to the value the shader produces
// at h = 0 away from the sun, so the fog line and the sky meet with no band.
export const SKY = {
  zenith: new THREE.Color(0.048, 0.058, 0.078),   // cold slate overhead
  mid: new THREE.Color(0.140, 0.142, 0.147),      // dirty overcast belly
  horizon: new THREE.Color(0.290, 0.208, 0.142),  // dull amber smog band
  hot: new THREE.Color(0.950, 0.530, 0.215),      // sun-side horizon flare
  ground: new THREE.Color(0.215, 0.168, 0.132),   // below the horizon line
  sunColor: new THREE.Color(1.620, 1.230, 0.830),
  // Low raking key from the ENE at ~21 degrees. Chosen so that the two faces
  // a third-person camera usually sees split hard into lit / unlit, and so the
  // shadows rake WSW right across the open basin.
  sunDir: new THREE.Vector3(0.845, 0.358, -0.398).normalize(),
  fog: new THREE.Color(0.250, 0.190, 0.148),
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

  // --- smog stack -------------------------------------------------------
  // exp() falloffs, not pow(): the band gets a tight core with a long soft
  // tail, so there is never a visible edge where it ends. The amber core is
  // deliberately TIGHT (~3 deg) — a third-person camera sits nearly level, so
  // anything wider and the player looks at a pink sky all game instead of a
  // slate one with a warm strip along the bottom.
  float band = exp(-up * 20.0);       // dull amber, pinned to the horizon
  float belly = exp(-up * 2.05);      // dirty overcast mid-band
  vec3 col = mix(uZenith, uMid, belly);
  col = mix(col, uHorizon, band);

  // Sun-side azimuth warming. Deliberately broad (a whole quadrant of the
  // dome) so the frame still reads "the key is over there" when the disc
  // itself is outside the 62 deg FOV.
  vec3 sunAz = normalize(vec3(uSunDir.x, 0.0, uSunDir.z));
  float az = dot(normalize(vec3(d.x, 1e-4, d.z)), sunAz) * 0.5 + 0.5;
  float warm = pow(az, 3.0) * exp(-up * 7.0);
  col = mix(col, uHot, warm * 0.46);

  // --- broken cloud deck: a flat plane projected overhead ---------------
  float pl = 0.50 / (up + 0.055);                    // perspective on the deck
  // integer horizontal repeats — anything else leaves a seam at atan()'s cut
  vec2 puv = vec2(atan(d.z, d.x) * 0.15915, pl);
  float n1 = texture2D(uNoise, puv * vec2(3.0, 0.62) + vec2(uTime * 0.0031, uTime * 0.0019)).r;
  float n2 = texture2D(uNoise, puv * vec2(7.0, 1.45) - vec2(uTime * 0.0067, 0.0)).g;
  float n3 = texture2D(uNoise, puv * vec2(1.0, 0.24) + vec2(uTime * 0.0013, 0.0)).b;
  // three scales so the deck has BIG shapes, not just a grey fizz
  float cl = clamp((n3 * 0.62 + n1 * 0.46 + n2 * 0.30 - 0.44) * 2.35, 0.0, 1.0);
  float deck = smoothstep(0.004, 0.30, up);
  vec3 soot = col * 0.40;                        // heavy soot-loaded belly
  vec3 gap = col * 1.34 + uHot * 0.016;          // torn, lit from behind
  col = mix(col, mix(gap, soot, smoothstep(0.16, 0.80, cl)), deck * 0.90);

  // --- sun: a diffuse disc buried in haze, plus a wide forward scatter --
  float sd = clamp(dot(d, uSunDir), 0.0, 1.0);
  float veil = 1.0 - 0.58 * smoothstep(0.22, 0.84, cl);
  float disc = smoothstep(0.99660, 0.99905, sd);
  float halo = pow(sd, 110.0) * 0.95 + pow(sd, 17.0) * 0.52
             + pow(sd, 4.5) * 0.21 + pow(sd, 1.5) * 0.075;
  col += uSun * (halo * veil + disc * 2.10 * veil * veil);

  // --- below horizon fades into the ground haze -------------------------
  col = mix(col, uGround, smoothstep(0.004, -0.055, h));

  // faint horizontal stratification = particulate layering in the smog
  col *= 1.0 + 0.032 * sin(h * 40.0 + n3 * 5.0);

  // ordered-ish dither: an 8-bit target quantises this gradient into
  // visible steps otherwise, and the grain in the composite is too fine
  // to break them up on its own.
  float dth = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
  col += (dth - 0.5) * 0.0022;

  gl_FragColor = vec4(max(col, 0.0), 1.0);
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
      // a warm bounce card standing in for the slag pit + ground. Kept dark:
      // the arena's contrast comes from the key, not from a bright dome.
      const floor = new THREE.Mesh(
        new THREE.SphereGeometry(19.5, 24, 12, 0, Math.PI * 2, Math.PI * 0.52, Math.PI * 0.48),
        new THREE.MeshBasicMaterial({ color: 0x2a1e15, side: THREE.BackSide, toneMapped: false }),
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

  /** R = mid-scale cloud, G = fine tearing, B = the BIG shapes that stop the
   *  deck reading as an even fizz. Contrast-stretched so B actually has form. */
  _noiseTexture() {
    const S = 256;
    const a = fbmField(S, { octaves: 5, base: 5, seed: 4711 });
    const b = fbmField(S, { octaves: 4, base: 13, seed: 4712 });
    const c0 = fbmField(S, { octaves: 3, base: 2, seed: 4713 });
    const c = canvas2d(S), g = c.getContext('2d');
    const im = g.createImageData(S, S), d = im.data;
    for (let i = 0, p = 0; i < a.length; i++, p += 4) {
      const big = Math.min(1, Math.max(0, (c0[i] - 0.5) * 2.05 + 0.5));
      d[p] = (a[i] * 255) | 0;
      d[p + 1] = (b[i] * 255) | 0;
      d[p + 2] = (big * 255) | 0;
      d[p + 3] = 255;
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

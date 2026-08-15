// ============================================================
//  vfx/contact.js — CONTACT SHADOW / AMBIENT OCCLUSION BLOBS
//
//  WHY THIS EXISTS (measured, not assumed)
//    A live A/B of castShadow on the player root proved the mech DOES
//    cast: the ground where the shadow lands went 52.89 -> 34.17 L
//    (-35.4 %). But the sun sits at 21 degrees elevation, so that shadow
//    lands 29 units away, and the deck AT THE SOLE only moved 27.98 ->
//    26.96 L (-3.6 %). A machine with nothing under its feet reads as a
//    sticker on the floor however good the cast shadow is.
//
//  WHAT IT IS
//    One instanced disc per foot, laid on the deck, drawn with a
//    MULTIPLY blend so it darkens whatever is already there instead of
//    painting a grey sprite over it. It is a projected blob, completely
//    independent of the sun cascade, so it survives any camera bearing,
//    any time of day and any shadow-map budget — including tier 4, where
//    the cascade is a 512 map.
//
//  DECK CONFORMANCE
//    Each instance carries the deck height AND its local gradient
//    (dy/dx, dy/dz, sampled by the CPU at the blob's own radius). The
//    vertex shader tilts the disc onto that plane, so a foot on a ramp,
//    a berm or a terrace edge gets a shadow lying on the slope rather
//    than a circle punched through it. At 1.5 u radius a plane fit is
//    exact to well under a texel.
//
//  BLEND
//    CustomBlending ZERO / SRC_COLOR  ->  dst = dst * src.rgb.
//    Written BEFORE the tonemap (the whole scene draws into the
//    composer's linear half-float target), so a 0.5 multiplier is a
//    physical halving of radiance, not a grey wash on a display value.
//    No tonemapping_fragment / colorspace_fragment include here on
//    purpose: the fragment output IS the multiplier and must not be
//    transformed.
//
//  COST
//    ONE draw call, ONE material, ONE program, both created at init()
//    and parented into the scene before the shader warm-up collects
//    roots — so it is compiled behind the title screen and never on the
//    frame it first appears.
// ============================================================
import * as THREE from 'three';

// Radial tessellation is irrelevant to the falloff (that is analytic in
// the fragment) — RS only controls the silhouette, and the rim opacity
// is 0 there, so 16 segments is already invisible.
function discGeometry(RS = 16, RINGS = 2) {
  const pos = [], uv = [], idx = [];
  for (let j = 0; j <= RINGS; j++) {
    const r = j / RINGS;
    for (let i = 0; i <= RS; i++) {
      const a = (i / RS) * Math.PI * 2;
      pos.push(Math.cos(a) * r, 0, Math.sin(a) * r);
      uv.push(i / RS, r);
    }
  }
  for (let j = 0; j < RINGS; j++) {
    for (let i = 0; i < RS; i++) {
      const a = j * (RS + 1) + i, b = a + 1, c = a + RS + 1, d = c + 1;
      // CCW seen from ABOVE. The disc lies in XZ with +Y up, so the winding
      // that reads correct on a shock ring (which is built in XY and rotated
      // into place by its shader) is inside-out here — get it wrong and the
      // whole field is silently backface-culled from every camera that
      // could ever see it.
      idx.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

const CONTACT_V = /* glsl */`
attribute vec3 iPos;   // contact point ON the deck
attribute vec4 iP0;    // radius, strength, gradX, gradZ
attribute vec2 iP1;    // plateau (0 = pure falloff, 0.5 = flat to half-radius)
uniform float uFogDensity;
uniform vec3 uFogColor;
varying float vR, vS, vC, vFog;
void main() {
  if (iP0.y <= 0.003) { gl_Position = vec4(2.0, 0.0, 0.0, 1.0); return; }
  vec3 local = position * iP0.x;
  // plane fit of the deck under this foot + a hair of lift so the disc
  // never z-fights the polygon it is lying on
  local.y = local.x * iP0.z + local.z * iP0.w + 0.05;
  vec4 mv = viewMatrix * vec4(iPos + local, 1.0);
  gl_Position = projectionMatrix * mv;
  vR = uv.y;
  vS = iP0.y;
  vC = iP1.x;
  float d = -mv.z;
  vFog = 1.0 - exp(-uFogDensity * uFogDensity * d * d);
}
`;

const CONTACT_F = /* glsl */`
uniform vec3 uAbsorb;
varying float vR, vS, vC, vFog;
void main() {
  // Plateau + shoulder, NOT a gaussian. Occlusion under a 2.3 u sole is
  // near-total right under the plate and only opens up once the deck can
  // see sky past it, so the tight FOOT lobe holds its value through the
  // first metre and then falls off hard (plateau ~0.46), while the wide
  // BODY lobe that stops the machine reading as a sticker is a pure
  // falloff (plateau ~0.05) with a third of the strength. The two
  // multiply, because two occluders do.
  float m = 1.0 - smoothstep(vC, 1.0, vR);
  float k = m * vS * (1.0 - vFog);
  if (k < 0.003) discard;
  // multiplier, in LINEAR radiance. uAbsorb leans red so what survives in
  // the shadow is the cool sky bounce — the same split the grade's
  // shadowTint assumes.
  gl_FragColor = vec4(clamp(1.0 - k * uAbsorb, 0.0, 1.0), 1.0);
}
`;

export class ContactField {
  /**
   * @param {number} cap   max simultaneous blobs (2 per legged unit)
   * @param {object} shared the vfx shared uniform block (fog)
   */
  constructor(cap, shared, renderOrder = 2) {
    this.cap = cap;
    this.n = 0;

    const base = discGeometry();
    const g = new THREE.InstancedBufferGeometry();
    g.index = base.index;
    g.setAttribute('position', base.attributes.position);
    g.setAttribute('uv', base.attributes.uv);
    this.arr = {}; this.attrs = [];
    for (const [name, size] of [['iPos', 3], ['iP0', 4], ['iP1', 2]]) {
      const a = new THREE.InstancedBufferAttribute(new Float32Array(cap * size), size);
      a.setUsage(THREE.DynamicDrawUsage);
      g.setAttribute(name, a);
      this.arr[name] = a.array;
      this.attrs.push(a);
    }
    base.dispose();
    g.instanceCount = 0;
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
    this.geo = g;

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uFogDensity: shared.uFogDensity,
        uFogColor: shared.uFogColor,
        uAbsorb: { value: new THREE.Vector3(1.00, 0.955, 0.865) },
      },
      vertexShader: CONTACT_V,
      fragmentShader: CONTACT_F,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.ZeroFactor,
      blendDst: THREE.SrcColorFactor,
      blendEquationAlpha: THREE.AddEquation,
      blendSrcAlpha: THREE.ZeroFactor,
      blendDstAlpha: THREE.OneFactor,
      // the disc sits 5 cm proud; the offset is what keeps it there on a
      // 4000-unit far plane where 5 cm is inside one depth quantum
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    });

    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.renderOrder = renderOrder;
  }

  /** immediate mode: rebuilt from scratch every frame */
  begin() { this.n = 0; }

  /**
   * @param {number} x,y,z  contact point ON the deck
   * @param {number} radius world units
   * @param {number} s      0..1 peak darkening
   * @param {number} gx,gz  deck gradient (dy/dx, dy/dz)
   * @param {number} core   plateau fraction of the radius (0..0.9)
   */
  add(x, y, z, radius, s, gx, gz, core) {
    if (this.n >= this.cap || s <= 0.004) return;
    const i = this.n++, i3 = i * 3, i4 = i * 4, i2 = i * 2, a = this.arr;
    a.iPos[i3] = x; a.iPos[i3 + 1] = y; a.iPos[i3 + 2] = z;
    a.iP0[i4] = radius; a.iP0[i4 + 1] = s; a.iP0[i4 + 2] = gx; a.iP0[i4 + 3] = gz;
    a.iP1[i2] = core; a.iP1[i2 + 1] = 0;
  }

  flush() {
    this.geo.instanceCount = this.n;
    if (this.n > 0) {
      for (const a of this.attrs) {
        a.clearUpdateRanges();
        a.addUpdateRange(0, this.n * a.itemSize);
        a.needsUpdate = true;
      }
    }
  }

  clear() { this.n = 0; this.geo.instanceCount = 0; }
  dispose() { this.geo.dispose(); this.material.dispose(); }
}

export default ContactField;

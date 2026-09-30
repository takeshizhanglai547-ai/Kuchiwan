// src/player/cutout.js — camera occlusion cutout (owner: movement designer).
//
// Thin props (lamp masts, gantry legs, pipes) are merged into big per-material arena meshes, so
// they cannot be faded one by one. Instead every lit arena material gets a tiny fragment prelude
// (chained onto its own onBeforeCompile, cache key extended): a fragment that lies
//   * inside a feathered box around the rig's projected silhouette (view-tangent space), and
//   * clearly IN FRONT of the rig (view depth < rig near side - margin), and
//   * on a non-horizontal surface (floors, lids and roofs are never cut),
// is discarded with an interleaved-gradient screen-door dither. The camera therefore never pops
// in for a mast and the rig is never hidden. One shared uniform block (no per-frame allocation);
// the camera writes it once per rendered frame from the interpolated camera + rig pose.
import * as THREE from 'three';

export const CUT_UNIFORMS = {
  uIwCut: { value: new THREE.Vector4(0, 0, 0, 0) },     // tangent-space centre (x, y), half size (x, y)
  uIwCutP: { value: new THREE.Vector4(0, 1, 0, 0) },    // depth threshold (m), feather (tangent), strength, -
  uIwCutUp: { value: new THREE.Vector3(0, 1, 0) },      // world up in view space
};

const DECL = /* glsl */`
uniform vec4 uIwCut;
uniform vec4 uIwCutP;
uniform vec3 uIwCutUp;
`;
const BODY = /* glsl */`
if ( uIwCutP.z > 0.0 && vViewPosition.z < uIwCutP.x ) {
  vec2 iwT = -vViewPosition.xy / max( vViewPosition.z, 0.05 );
  vec2 iwD = abs( iwT - uIwCut.xy ) - uIwCut.zw;
  float iwM = 1.0 - smoothstep( 0.0, uIwCutP.y, length( max( iwD, vec2( 0.0 ) ) ) );
  iwM *= smoothstep( 0.0, 2.5, uIwCutP.x - vViewPosition.z ) * uIwCutP.z;
  if ( iwM > 0.001 ) {
    vec3 iwN = normalize( cross( dFdx( vViewPosition ), dFdy( vViewPosition ) ) );
    iwM *= 1.0 - smoothstep( 0.62, 0.86, abs( dot( iwN, uIwCutUp ) ) );
    float iwG = fract( 52.9829189 * fract( dot( gl_FragCoord.xy, vec2( 0.06711056, 0.00583715 ) ) ) );
    if ( iwM > iwG ) discard;
  }
}
`;

function patchMaterial(mat) {
  if (!mat || mat.userData.iwCut) return false;
  if (!(mat.isMeshStandardMaterial || mat.isMeshLambertMaterial || mat.isMeshPhongMaterial)) return false;
  mat.userData.iwCut = true;
  const prev = mat.onBeforeCompile;
  const protoKey = THREE.Material.prototype.customProgramCacheKey;
  const prevKey = mat.customProgramCacheKey;
  const ownKey = prevKey !== protoKey;
  const prevSrc = prev ? prev.toString() : '';
  mat.onBeforeCompile = function (sh, renderer) {
    if (prev) prev.call(this, sh, renderer);
    sh.uniforms.uIwCut = CUT_UNIFORMS.uIwCut;
    sh.uniforms.uIwCutP = CUT_UNIFORMS.uIwCutP;
    sh.uniforms.uIwCutUp = CUT_UNIFORMS.uIwCutUp;
    let fs = sh.fragmentShader;
    if (!fs.includes('void main() {') || !fs.includes('#include <clipping_planes_fragment>')) return;
    fs = fs.replace('void main() {', DECL + 'void main() {');
    fs = fs.replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\n' + BODY);
    sh.fragmentShader = fs;
  };
  // keep the original program identity (materials sharing a wrapper must not share a program)
  mat.customProgramCacheKey = function () { return (ownKey ? prevKey.call(this) : prevSrc) + '|iwcut'; };
  mat.needsUpdate = true;
  return true;
}

/** Patch every lit material under `root` (arena). Returns the number of materials patched. */
export function installCutout(root) {
  let n = 0;
  if (!root) return 0;
  root.traverse((o) => {
    if (!o.isMesh || !o.material) return;
    if (Array.isArray(o.material)) { for (const m of o.material) if (patchMaterial(m)) n++; }
    else if (patchMaterial(o.material)) n++;
  });
  return n;
}

const _c = new THREE.Vector3(), _up = new THREE.Vector3();

/**
 * Update the shared uniforms for this frame. `cam` = the rendered camera (matrixWorldInverse
 * current), `rigPos` = rendered feet position, `height` = rig height (m), `strength` 0..1.
 */
export function updateCutout(cam, rigPos, height, C, strength) {
  const P = CUT_UNIFORMS.uIwCutP.value;
  if (strength <= 0.001) { P.z = 0; return; }
  _c.set(rigPos.x, rigPos.y + height * 0.5, rigPos.z).applyMatrix4(cam.matrixWorldInverse);
  const z = -_c.z;
  if (z < 2) { P.z = 0; return; }
  const hw = C.cutHalfWidth + C.cutPad, hh = height * 0.5 + C.cutPad;
  CUT_UNIFORMS.uIwCut.value.set(_c.x / z, _c.y / z, hw / z, hh / z);
  P.x = z - C.cutHalfDepth - C.cutDepthMargin;   // the rig's near side minus a margin
  P.y = C.cutFeather / z;
  P.z = strength * C.cutStrength;
  _up.set(0, 1, 0).transformDirection(cam.matrixWorldInverse);
  CUT_UNIFORMS.uIwCutUp.value.copy(_up);
}

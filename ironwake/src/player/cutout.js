// src/player/cutout.js — camera occlusion cutout (owner: movement designer).
//
// Thin props (lamp masts, gantry legs, pipes) are merged into big per-material arena meshes, so
// they cannot be faded one by one. The chase camera first SLIDES around such props (camera.js
// occluder avoid); whatever no slide clears is cut out here. Every lit arena material gets a tiny
// fragment prelude (chained onto its own onBeforeCompile, cache key extended): a fragment that lies
//   * inside a rounded box around the rig's projected silhouette (view-tangent space), and
//   * clearly IN FRONT of the rig (view depth < rig near side - margin), and
//   * on a non-horizontal surface (floors, lids and roofs are never cut),
// is discarded. Combat r2: the old screen-door dither printed a coarse stipple band on the masts
// (no TAA to resolve it), so the cut is now a HARD, clean-edged hole (SMAA smooths its edge like
// any geometry edge) that irises open with the strength. The rig is never hidden and the camera
// never pops in for a mast.
// NEAR-PROP CUT (r3): thin props the camera passes within ~7 m of (a mast skimming the lens filled a
// quarter of the frame in boost_ground / qb_chase) are cut too: the camera hands over up to two
// thin colliders as view->box matrices (inflated OBBs); fragments inside one of them AND within
// uIwNearP.x m of the eye are discarded, so the prop is eaten from its nearest point outward as the
// camera closes in (no pop). Walls and buildings are never in this set (thin colliders only). One shared uniform block (no per-frame allocation); the camera writes
// it once per rendered frame from the interpolated camera + rig pose.
import * as THREE from 'three';

export const CUT_UNIFORMS = {
  uIwCut: { value: new THREE.Vector4(0, 0, 0, 0) },     // tangent-space centre (x, y), half size (x, y)
  uIwCutP: { value: new THREE.Vector4(0, 0.1, 0, 0) },  // depth threshold (m), corner radius (tangent), strength, -
  uIwCutUp: { value: new THREE.Vector3(0, 1, 0) },      // world up in view space
  uIwNear0: { value: new THREE.Matrix4() },               // view space -> unit box of near prop 0
  uIwNear1: { value: new THREE.Matrix4() },               // ... prop 1
  uIwNearP: { value: new THREE.Vector4(0, 0, 0, 0) },    // eye radius (m), box count, -, -
};

const DECL = /* glsl */`
uniform vec4 uIwCut;
uniform vec4 uIwCutP;
uniform vec3 uIwCutUp;
uniform mat4 uIwNear0;
uniform mat4 uIwNear1;
uniform vec4 uIwNearP;
`;
const BODY = /* glsl */`
{
  // derivatives in uniform control flow (used inside the branch)
  vec3 iwDx = dFdx( vViewPosition ), iwDy = dFdy( vViewPosition );
  if ( uIwCutP.z > 0.0 && vViewPosition.z < uIwCutP.x ) {
    vec2 iwT = -vViewPosition.xy / max( vViewPosition.z, 0.05 );
    // signed distance to the rounded box (half size irises with the strength)
    vec2 iwQ = abs( iwT - uIwCut.xy ) - uIwCut.zw * uIwCutP.z + uIwCutP.y;
    float iwSd = length( max( iwQ, vec2( 0.0 ) ) ) + min( max( iwQ.x, iwQ.y ), 0.0 ) - uIwCutP.y;
    if ( iwSd < 0.0 && abs( dot( normalize( cross( iwDx, iwDy ) ), uIwCutUp ) ) < 0.8 ) discard;
  }
  if ( uIwNearP.y > 0.5 && dot( vViewPosition, vViewPosition ) < uIwNearP.x * uIwNearP.x ) {
    vec4 iwV = vec4( -vViewPosition, 1.0 );
    vec3 iwB = ( uIwNear0 * iwV ).xyz;
    if ( max( max( abs( iwB.x ), abs( iwB.y ) ), abs( iwB.z ) ) < 1.0 ) discard;
    if ( uIwNearP.y > 1.5 ) {
      iwB = ( uIwNear1 * iwV ).xyz;
      if ( max( max( abs( iwB.x ), abs( iwB.y ) ), abs( iwB.z ) ) < 1.0 ) discard;
    }
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
    sh.uniforms.uIwNear0 = CUT_UNIFORMS.uIwNear0;
    sh.uniforms.uIwNear1 = CUT_UNIFORMS.uIwNear1;
    sh.uniforms.uIwNearP = CUT_UNIFORMS.uIwNearP;
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
  const k = Math.min(1, strength * C.cutStrength);
  CUT_UNIFORMS.uIwCut.value.set(_c.x / z, _c.y / z, hw / z, hh / z);
  P.x = z - C.cutHalfDepth - C.cutDepthMargin;   // the rig's near side minus a margin
  P.y = Math.min(hw, hh) * C.cutRound * k / z;    // corner radius (shrinks with the iris)
  P.z = k;
  _up.set(0, 1, 0).transformDirection(cam.matrixWorldInverse);
  CUT_UNIFORMS.uIwCutUp.value.copy(_up);
}

const _near = [], _nm = new THREE.Matrix4(), _nl = new THREE.Vector3(), _nd = new THREE.Vector3();
const _nbest = [null, null], _ndist = [0, 0];
/** Distance from point p to an oriented box collider (0 inside). */
function boxDistance(c, p) {
  _nd.subVectors(p, c.center);
  const lx = Math.max(0, Math.abs(_nd.dot(c.ax)) - c.half.x);
  const ly = Math.max(0, Math.abs(_nd.dot(c.ay)) - c.half.y);
  const lz = Math.max(0, Math.abs(_nd.dot(c.az)) - c.half.z);
  return Math.sqrt(lx * lx + ly * ly + lz * lz);
}
function nearMatrix(c, cam, out, C) {
  // box local (unit cube) -> world: basis * scale(inflated half) at the centre; then -> view; invert
  const h = c.half;
  _nm.makeBasis(c.ax, c.ay, c.az);
  _nm.scale(_nl.set(h.x + C.nearInflate, h.y + C.nearInflateY, h.z + C.nearInflate));
  _nm.setPosition(c.center);
  out.multiplyMatrices(cam.matrixWorldInverse, _nm).invert();
}
/**
 * Near-prop cut: pick up to two THIN colliders (isThin) within C.nearRadius of the rendered camera
 * and hand them to the shader. `isThin` is the camera's classifier (poles, masts, beams).
 */
export function updateNearCut(cam, physics, C, isThin, enabled) {
  const P = CUT_UNIFORMS.uIwNearP.value;
  P.y = 0;
  if (!enabled || !physics || !physics.queryBox) return 0;
  const p = cam.position, R = C.nearRadius;
  const n = physics.queryBox(p.x - R - 2, p.y - R - 40, p.z - R - 2, p.x + R + 2, p.y + R + 40, p.z + R + 2, _near);
  _nbest[0] = _nbest[1] = null;
  for (let i = 0; i < n; i++) {
    const c = _near[i];
    if (!isThin(c)) continue;
    const d = boxDistance(c, p);
    if (d >= R) continue;
    if (!_nbest[0] || d < _ndist[0]) { _nbest[1] = _nbest[0]; _ndist[1] = _ndist[0]; _nbest[0] = c; _ndist[0] = d; }
    else if (!_nbest[1] || d < _ndist[1]) { _nbest[1] = c; _ndist[1] = d; }
  }
  let k = 0;
  if (_nbest[0]) { nearMatrix(_nbest[0], cam, CUT_UNIFORMS.uIwNear0.value, C); k = 1; }
  if (_nbest[1]) { nearMatrix(_nbest[1], cam, CUT_UNIFORMS.uIwNear1.value, C); k = 2; }
  P.x = R + C.nearInflate + 0.5;
  P.y = k;
  return k;
}

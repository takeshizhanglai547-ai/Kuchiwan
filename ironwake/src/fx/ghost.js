// src/fx/ghost.js — quick-boost AFTERIMAGE (owner: weapons/VFX artist).
//
//   fx.ghosts.trigger(rigRoot, strength?)
// Snapshots the rig's current world pose into a pooled copy of its meshes (shared geometry,
// one additive fresnel material per copy) that hangs in the air for ~0.2 s while the rig has
// already snapped away: a brief heat-smear silhouette in the booster colour. The copies are
// built lazily per rig root (skipping flames / skinned meshes) and reused.
import * as THREE from 'three';

const LIFE = 0.16;
const POOL = 2;

const VERT = /* glsl */`
varying float vRim; varying float vViewZ;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vec3 n = normalize(normalMatrix * normal);
  vec3 v = normalize(-mv.xyz);
  vRim = 1.0 - abs(dot(n, v));
  vViewZ = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;
const FRAG = /* glsl */`
uniform vec3 uColor; uniform float uFade;
varying float vRim; varying float vViewZ;
void main() {
  float r = vRim * vRim;
  float a = (0.05 + 0.6 * r) * uFade * smoothstep(0.6, 3.0, vViewZ);
  gl_FragColor = vec4(uColor * a, 0.0);
}`;

export class Ghosts {
  constructor(game) {
    this.game = game;
    this.sets = new Map();   // rigRoot -> [{group, pairs, mat, t, alive}]
    this.soft = null;
  }

  attachSoft(pl) {
    this.soft = pl;
    for (const list of this.sets.values()) for (const s of list) pl.markSoft(s.group);
  }

  _build(root) {
    const list = [];
    for (let k = 0; k < POOL; k++) {
      const mat = new THREE.ShaderMaterial({
        name: 'iw_fx_ghost', vertexShader: VERT, fragmentShader: FRAG,
        uniforms: { uColor: { value: new THREE.Color(1.5, 0.62, 0.2) }, uFade: { value: 0 } },
        transparent: true, depthWrite: false, depthTest: true,
        blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      });
      const group = new THREE.Group();
      group.name = 'fx_ghost';
      const pairs = [];
      root.traverse((o) => {
        if (!o.isMesh || o.isSkinnedMesh || o.isInstancedMesh) return;
        if (o.name.startsWith('flame_') || (o.material && o.material.transparent)) return;
        const g = new THREE.Mesh(o.geometry, mat);
        g.matrixAutoUpdate = false;
        g.frustumCulled = false;
        g.renderOrder = 28;
        group.add(g);
        pairs.push([o, g]);
      });
      group.visible = false;
      this.game.scene.add(group);
      if (this.soft) this.soft.markSoft(group);
      list.push({ group, pairs, mat, t: 0, alive: false, str: 1 });
    }
    this.sets.set(root, list);
    return list;
  }

  trigger(root, strength = 1) {
    if (!root) return;
    const list = this.sets.get(root) || this._build(root);
    const s = list.find((x) => !x.alive) || list.reduce((a, b) => (a.t > b.t ? a : b));
    // world pose from the top of the actor hierarchy (callers syncSim() the actor first)
    let top = root;
    while (top.parent && !top.parent.isScene) top = top.parent;
    top.updateMatrixWorld(true);
    for (const [src, g] of s.pairs) { g.matrix.copy(src.matrixWorld); g.matrixWorldNeedsUpdate = true; }
    s.alive = true; s.t = 0; s.str = strength;
    s.group.visible = true;
  }

  clear() { for (const list of this.sets.values()) for (const s of list) { s.alive = false; s.group.visible = false; } }

  update(dt) {
    for (const list of this.sets.values()) for (const s of list) {
      if (!s.alive) continue;
      s.t += dt;
      if (s.t >= LIFE) { s.alive = false; s.group.visible = false; }
    }
  }

  frame() {
    for (const list of this.sets.values()) for (const s of list) {
      if (!s.alive) continue;
      // fades IN over two frames (the rig has not left its own silhouette yet), then out
      const f = 1 - s.t / LIFE;
      const fin = Math.min(1, Math.max(0, (s.t - 0.01) / 0.025));
      s.mat.uniforms.uFade.value = fin * f * f * 0.7 * s.str;
    }
  }

  dispose() {
    for (const list of this.sets.values()) for (const s of list) { s.mat.dispose(); this.game.scene.remove(s.group); }
    this.sets.clear();
  }
}

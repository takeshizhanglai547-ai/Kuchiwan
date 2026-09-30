// src/render/pipeline.js — post-processing pipeline (owner: render engineer).
//
//   RenderPass (HDR, HalfFloat) -> [stats snapshot] -> [slot 'ao' (SSAO/GTAO, empty now)]
//   -> [slot 'pre_bloom'] -> UnrealBloomPass -> [slot 'post_bloom'] -> OutputPass
//   (tone mapping = renderer.toneMapping, AgX by default; sRGB conversion) -> FXAA
//
// API (game.pipeline):
//   render(realDt)          called by the engine once per frame
//   setSize(w, h)
//   setSlot(name, pass|null) insert/replace a pass in a named slot ('ao','pre_bloom','post_bloom')
//   bloom                   the UnrealBloomPass (tweak strength/radius/threshold)
//   stats.scene             {calls, triangles} of the SCENE pass only (budget checks)
//   setQuality('low'|'medium'|'high')
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import { Pass } from 'three/addons/postprocessing/Pass.js';

/** Records renderer.info right after the scene pass (so post passes aren't counted). */
class StatsSnapshotPass extends Pass {
  constructor(stats) { super(); this.stats = stats; this.needsSwap = false; }
  render(renderer) {
    this.stats.scene.calls = renderer.info.render.calls;
    this.stats.scene.triangles = renderer.info.render.triangles;
  }
}

const SLOT_ORDER = ['render', 'stats', 'ao', 'pre_bloom', 'bloom', 'post_bloom', 'output', 'fxaa'];

export default function pipelineSystem(game) {
  let composer, renderPass, bloom, output, fxaa;
  const slots = {};
  const stats = { scene: { calls: 0, triangles: 0 } };

  function rebuild() {
    // Remove all then re-add in slot order.
    for (const p of [...composer.passes]) composer.removePass(p);
    for (const name of SLOT_ORDER) if (slots[name]) composer.addPass(slots[name]);
  }

  const api = {
    name: 'pipeline',
    order: 1000,
    stats,
    get composer() { return composer; },
    get bloom() { return bloom; },
    init(g) {
      const r = g.renderer;
      const size = r.getSize(new THREE.Vector2());
      composer = new EffectComposer(r);
      renderPass = new RenderPass(g.scene, g.camera);
      bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.5, 0.45, 1.0);
      output = new OutputPass();
      fxaa = new ShaderPass(FXAAShader);
      slots.render = renderPass;
      slots.stats = new StatsSnapshotPass(stats);
      slots.bloom = bloom;
      slots.output = output;
      slots.fxaa = fxaa;
      rebuild();
      api.setQuality(g.params.quality);
      g.pipeline = api;
      api.setSize(size.x, size.y);
    },
    setSlot(name, pass) {
      if (!SLOT_ORDER.includes(name) || name === 'render') throw new Error(`[pipeline] unknown slot ${name}`);
      slots[name] = pass || null;
      rebuild();
    },
    setQuality(q) {
      bloom.enabled = q !== 'low';
      fxaa.enabled = q === 'high';
    },
    setSize(w, h) {
      if (!composer) return;
      const pr = game.renderer.getPixelRatio();
      composer.setPixelRatio(pr);
      composer.setSize(w, h);
      fxaa.material.uniforms.resolution.value.set(1 / (w * pr), 1 / (h * pr));
    },
    render(realDt) {
      composer.render(realDt);
    },
    dispose() {
      composer.dispose();
      bloom.dispose();
      output.dispose();
      fxaa.dispose?.();
    },
  };
  return api;
}

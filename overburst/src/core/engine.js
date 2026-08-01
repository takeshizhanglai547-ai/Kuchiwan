// ============================================================
//  Engine — renderer, camera, scene root, resize, render target
//  plumbing. Post-processing lives in core/postfx.js.
// ============================================================
import * as THREE from 'three';
import { CFG } from '../config.js';

export class Engine {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,           // SMAA/FXAA runs in the post chain
      powerPreference: 'high-performance',
      stencil: false,
      alpha: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = CFG.FX.EXPOSURE;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.info.autoReset = true;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(
      CFG.CAM.FOV, window.innerWidth / window.innerHeight, 0.35, 4000,
    );
    this.camera.position.set(0, 22, 60);

    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
  }

  get width() { return this.renderer.domElement.width; }
  get height() { return this.renderer.domElement.height; }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.postfx) this.postfx.resize(w, h);
  }
}

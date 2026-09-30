// src/ui/tacmap.js — in-engine tactical map for the briefing screen (owner: mission/HUD designer).
//
// renderTacMap(game) renders the live arena ONCE from straight above with an orthographic
// camera (actors hidden, fog off) in two passes into a render target:
//   1. height  — MeshDepthMaterial (RGBA-packed) -> metres above ground per pixel
//   2. albedo  — the normal materials (ground markings, slag channels, roofs)
// and composites them on the CPU into a monochrome "tactical relief" image: hill-shading from
// the height field, bright outlines where structures rise, 10 m contour ticks and a faint
// albedo layer. The result is cached (the arena is static) as a 2D canvas.
// mapProject(world, out) maps a world point to 0..1 map coordinates (x right, y down).
// Orientation: the player's spawn heading points UP on the map.
import * as THREE from 'three';

const N = 560;            // render resolution (square)
const HALF = 262;         // metres from the centre to the map edge (walls at +-250)
const TOP = 340;          // camera height; structures up to ~300 m
let cached = null;

function orthoCam(game) {
  const cam = new THREE.OrthographicCamera(-HALF, HALF, HALF, -HALF, 1, TOP + 20);
  const sp = game.arena && game.arena.spawns && game.arena.spawns.player;
  const yaw = sp ? sp.yaw : 0;
  cam.position.set(0, TOP, 0);
  cam.up.set(Math.sin(yaw), 0, Math.cos(yaw)); // spawn forward = map up
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld(true);
  cam.updateProjectionMatrix();
  return cam;
}

/** World point -> {x, y} in 0..1 map space. */
export function mapProject(game, world, out) {
  if (!cached) return null;
  const v = cached.tmp.copy(world).project(cached.cam);
  out.x = v.x * 0.5 + 0.5;
  out.y = -v.y * 0.5 + 0.5;
  return out;
}

export function mapNorthAngle() { return cached ? cached.northDeg : 0; }

/** Run fn(renderer, scene) with the map render state (actors/particles/sky hidden, fog and
 *  shadow-map updates off, target = rt), then restore everything. */
function withMapState(game, rt, fn) {
  const r = game.renderer, scene = game.scene;
  const hidden = [];
  for (const a of game.actors) if (a.root && a.root.visible) { a.root.visible = false; hidden.push(a.root); }
  // Particles, flames, smoke and the sky dome would smear the height pass: hide every
  // transparent or back-faced (sky) drawable for the passes.
  scene.traverse((o) => {
    if (!o.visible || !(o.isMesh || o.isPoints || o.isSprite || o.isLine)) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    if (o.isPoints || o.isSprite || o.isLine || mats.some((m) => m && (m.transparent || m.side === THREE.BackSide || m.depthWrite === false))) { o.visible = false; hidden.push(o); }
  });
  const prev = { rt: r.getRenderTarget(), bg: scene.background, density: scene.fog && scene.fog.density, override: scene.overrideMaterial,
    clear: new THREE.Color(), alpha: r.getClearAlpha(), auto: r.autoClear, shadow: r.shadowMap.autoUpdate };
  r.getClearColor(prev.clear);
  try {
    if (scene.fog && scene.fog.density !== undefined) scene.fog.density = 0;
    r.shadowMap.autoUpdate = false; // keep the gameplay shadow map; re-rendering it is the slow part
    r.autoClear = true;
    scene.background = null;
    r.setRenderTarget(rt);
    fn(r, scene);
  } finally {
    scene.overrideMaterial = prev.override;
    scene.background = prev.bg;
    if (scene.fog && prev.density !== undefined) scene.fog.density = prev.density;
    r.shadowMap.autoUpdate = prev.shadow;
    r.setRenderTarget(prev.rt);
    r.setClearColor(prev.clear, prev.alpha);
    r.autoClear = prev.auto;
    for (const o of hidden) o.visible = true;
  }
}

/**
 * Incremental map build (each next() call is one bounded chunk of work, so a live briefing
 * screen stays responsive on slow software renderers): 0 = height pass, 1 = albedo pass,
 * 2 = CPU composite. next() returns true when the map is ready (see tacMapCanvas()).
 */
export function createTacMapJob(game) {
  const job = { stage: cached ? 3 : 0, cam: null, height: null, albedo: null, buf: null };
  job.next = () => {
    if (cached) return true;
    if (!game.renderer || !game.scene) return false;
    if (job.stage === 0) {
      job.cam = orthoCam(game);
      job.height = new Float32Array(N * N); job.albedo = new Float32Array(N * N); job.buf = new Uint8Array(N * N * 4);
      const rt = new THREE.WebGLRenderTarget(N, N, { depthBuffer: true });
      const depthMat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
      withMapState(game, rt, (r, scene) => {
        scene.overrideMaterial = depthMat;
        r.setClearColor(0xffffff, 1);
        r.clear();
        r.render(scene, job.cam);
        r.readRenderTargetPixels(rt, 0, 0, N, N, job.buf);
      });
      rt.dispose(); depthMat.dispose();
      const span = job.cam.far - job.cam.near, buf = job.buf;
      for (let i = 0; i < N * N; i++) {
        const d = (buf[i * 4] + buf[i * 4 + 1] / 256 + buf[i * 4 + 2] / 65536) / 256;
        job.height[i] = d >= 0.999 ? 0 : Math.max(0, TOP - (job.cam.near + d * span));
      }
      job.stage = 1;
      return false;
    }
    if (job.stage === 1) {
      const rt = new THREE.WebGLRenderTarget(N, N, { depthBuffer: true });
      withMapState(game, rt, (r, scene) => {
        scene.overrideMaterial = null;
        r.setClearColor(0x000000, 1);
        r.clear();
        r.render(scene, job.cam);
        r.readRenderTargetPixels(rt, 0, 0, N, N, job.buf);
      });
      rt.dispose();
      const buf = job.buf;
      for (let i = 0; i < N * N; i++) job.albedo[i] = (0.3 * buf[i * 4] + 0.59 * buf[i * 4 + 1] + 0.11 * buf[i * 4 + 2]) / 255;
      job.stage = 2;
      return false;
    }
    composite(job.cam, job.height, job.albedo, job.buf);
    job.stage = 3; job.height = job.albedo = job.buf = null;
    return true;
  };
  return job;
}

export function tacMapCanvas() { return cached ? cached.canvas : null; }

/** Build the whole map synchronously (test mode / staged shots). */
export function renderTacMap(game) {
  const job = createTacMapJob(game);
  for (let i = 0; i < 4 && !job.next(); i++);
  return tacMapCanvas();
}

function composite(cam, height, albedo, buf) {
  // ---- composite (rows come bottom-up from readPixels)
  const canvas = document.createElement('canvas');
  canvas.width = N; canvas.height = N;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(N, N);
  const px = img.data;
  const mpp = (2 * HALF) / N; // metres per pixel
  const lx = -0.55, ly = -0.62, lz = 0.56; // light from the upper left
  const H = (x, y) => height[Math.min(N - 1, Math.max(0, y)) * N + Math.min(N - 1, Math.max(0, x))];
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      const h = height[i];
      const gx = (H(x + 1, y) - H(x - 1, y)) / (2 * mpp);
      const gy = (H(x, y + 1) - H(x, y - 1)) / (2 * mpp);
      const gl = Math.hypot(gx, gy);
      // normal (screen y is flipped: readPixels rows are bottom-up)
      const nx = -gx, ny = gy, nz = 1;
      const nl = Math.hypot(nx, ny, nz);
      const shade = Math.max(0, (nx * lx + ny * ly + nz * lz) / nl);
      const edge = Math.min(1, gl * 0.9);                  // structure outlines
      const hn = Math.min(1, h / 60);                      // height tint
      const contour = h > 2 && (h % 10) < mpp * 1.2 * (1 + gl) ? 0.35 : 0;
      const alb = Math.pow(albedo[i], 0.5);
      let v = 0.06 + alb * 0.16 + hn * 0.16 + (shade - 0.56) * 0.35 * Math.min(1, h / 4 + gl) + contour * 0.25;
      v = Math.max(0, Math.min(1, v + edge * 0.55));
      const o = ((N - 1 - y) * N + x) * 4;
      // tint: cold slate-cyan for the display, warm for hot emissives (slag)
      const hot = Math.max(0, (buf[i * 4] - buf[i * 4 + 2]) / 255 - 0.25) * 1.4;
      px[o] = Math.min(255, (v * 0.78 + hot * 0.9) * 255);
      px[o + 1] = Math.min(255, (v * 0.93 + hot * 0.45) * 255);
      px[o + 2] = Math.min(255, (v * 0.98 + hot * 0.1) * 255);
      px[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  // north (world -Z) as an angle on the map, degrees clockwise from up
  const tmp = new THREE.Vector3();
  const o0 = new THREE.Vector3(0, 0, 0).project(cam), n0 = tmp.set(0, 0, -100).project(cam);
  const northDeg = Math.atan2(n0.x - o0.x, n0.y - o0.y) * 180 / Math.PI;
  cached = { canvas, cam, tmp: new THREE.Vector3(), northDeg };
  return canvas;
}

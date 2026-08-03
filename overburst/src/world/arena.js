// ============================================================
//  Arena — level geometry, lighting, sky, atmosphere.
//  Owned by the world agent.
//
//  CONTRACT
//    new Arena(ctx); .init(); .update(dt); .reset()
//    .colliders   -> array of { type:'box'|'cyl', center, half|radius, height, quat? }
//    .sampleHeight(x, z [, yRef]) -> highest walkable surface (number)
//          yRef is the querying entity's Y; surfaces more than ~3u above it are
//          ignored so you can walk *under* catwalks and pipe bridges.
//          Omit it (or pass Infinity) to get the absolute top surface.
//    .raycastWorld(origin, dir, maxDist [, out]) -> {point, normal, distance}|null
//    .spawnPoints -> { player: Vector3, enemies: [...], pylons: [...] }
//
//  EXTRAS (safe to use, additive to the contract)
//    .groundHeight(x, z)                terrain only, ignores platforms
//    .collidersNear(x, z, r, out=[])    bucketed broad-phase query
//    .sunDir  (Vector3)  .fogColor (Color)  .PIT (basin metrics)
// ============================================================
import * as THREE from 'three';
import { CFG } from '../config.js';
import { clamp } from '../util/math.js';
import { buildMaterials } from './materials.js';
import { Sky, SKY } from './sky.js';
import { WorldCollision } from './collision.js';
import { terrainY, buildGround, buildRoadMarkings, buildGroundDecals, PIT } from './ground.js';
import {
  buildBasin, buildSmelter, buildTowers, buildYard, buildRail,
  buildSouth, buildWest, buildBlastWalls, buildPerimeter, buildScatter,
} from './structures.js';
import { Atmosphere } from './atmosphere.js';

// ---- shadow cascade -------------------------------------------------------
// ONE map, but the ortho box is re-fitted to the camera every frame instead of
// being nailed at 320 (= 640 units across = 0.31 u/texel, ~3 texels of slop at
// the contact point).  A chase cam 20 u behind the mech gets SPAN_MIN, which at
// 3072 is 0.065 u/texel — the mech's sole and its shadow finally meet.  A high
// establishing cam opens out to SPAN_MAX so the arena still reads as shadowed.
//
// Two real cascades were prototyped and rejected: three.js returns "lit" for
// anything outside a shadow camera's frustum, so a second DirectionalLight
// leaks its whole intensity into every shadow beyond the near box and paints a
// hard rectangle on the ground.  Cascade blending needs a shader patch on every
// material in the scene (including the mech's, which this agent does not own).
// Re-fitting one box buys the same texel density where it is actually looked at.
const SPAN_MIN = 96;
const SPAN_MAX = 300;
const SHADOW_RES = 3072;
const SUN_DIST = 560;

// Local emissive budget. Seven slots, re-pointed at the most important
// registered emitters every few frames — the slot COUNT never changes, so the
// shader is compiled once and never invalidated. Seven and not more because
// vfx.js keeps its own pool of ~5 explosion/muzzle PointLights in the same
// scene; the per-fragment light loop is shared.
const LIGHT_SLOTS = 7;

export class Arena {
  constructor(ctx) {
    this.ctx = ctx;
    this.colliders = [];
    this.spawnPoints = { player: new THREE.Vector3(0, 0, 150), enemies: [], pylons: [] };
    this.group = new THREE.Group();
    this.group.name = 'arena';
    this.time = 0;
    this.PIT = PIT;
    this.sunDir = SKY.sunDir.clone();
    this.fogColor = SKY.fog.clone();
    this._span = SPAN_MIN;
    this._appliedSpan = -1;
    this._lightTick = 0;
  }

  // ----------------------------------------------------------------
  init() {
    const { scene, renderer } = this.ctx;

    // --- atmosphere colour + sky ---
    // SKY.fog is locked to the value the sky shader produces at the horizon
    // away from the sun, so haze and sky meet without a seam.
    scene.background = SKY.fog.clone();
    scene.fog = new THREE.FogExp2(SKY.fog.clone(), 0.00124);

    this.sky = new Sky(this.ctx);
    scene.add(this.sky.build());
    const env = this.sky.buildEnvironment(renderer);
    if (env) {
      scene.environment = env;
      // The key still does the modelling, but the IBL has to carry the shadow
      // side: at 0.40 every surface turned away from the sun fell to black and
      // ~9 % of a gameplay frame was literally RGB(0,0,0).
      scene.environmentIntensity = 1.18;
    }

    // --- materials ---
    this.materials = buildMaterials();

    // --- lighting -------------------------------------------------
    // Key / sky-fill / bounce. High contrast is still the look, but "deep" is
    // not "void": nothing in frame may fall below the sky term.
    const hemi = new THREE.HemisphereLight(0x000000, 0x000000, 1.0);
    hemi.color.setRGB(0.30, 0.38, 0.54);        // cold sky fill
    hemi.groundColor.setRGB(0.30, 0.19, 0.115); // warm bounce off the ash
    hemi.intensity = 1.85;
    scene.add(hemi);
    this.hemi = hemi;

    // Warm bounce coming BACK off the apron, opposite the key and slightly
    // below the horizon: this is the term that keeps the underside of a pipe
    // bridge or a catwalk from reading as a hole cut in the frame.
    const bounce = new THREE.DirectionalLight(0xffffff, 0.78);
    bounce.color.setRGB(1.0, 0.70, 0.47);
    bounce.castShadow = false;
    bounce.position.set(-SKY.sunDir.x * 300, -120, -SKY.sunDir.z * 300);
    bounce.target.position.set(0, 30, 0);
    scene.add(bounce);
    scene.add(bounce.target);
    this.bounce = bounce;

    const sun = new THREE.DirectionalLight(0xffffff, 8.6);
    sun.color.setRGB(1.0, 0.786, 0.560);        // ~3400 K raking key
    sun.castShadow = true;
    const res = Math.min(SHADOW_RES, renderer?.capabilities?.maxTextureSize || SHADOW_RES);
    sun.shadow.mapSize.set(res, res);
    const sc = sun.shadow.camera;
    sc.near = 20; sc.far = 1150;
    sun.shadow.blurSamples = 8;
    scene.add(sun);
    scene.add(sun.target);
    this.sun = sun;
    this._sunOffset = SKY.sunDir.clone().multiplyScalar(SUN_DIST);
    this._depthRange = sc.far - sc.near;
    this._fitShadow(SPAN_MIN);
    this._updateSun(new THREE.Vector3(0, 0, 60), 1);

    // --- collision world -----------------------------------------
    const col = new WorldCollision(CFG.ARENA.WALL + 60, 44, terrainY);
    this.col = col;

    // --- world accumulator handed to every district builder ------
    const W = {
      M: this.materials, col,
      strobes: [], smoke: [], vents: [], lights: [], pylonSpots: [],
    };
    this.W = W;

    // --- ground + districts --------------------------------------
    const add = (arr) => { for (const m of arr) this.group.add(m); };
    add(buildGround(this.materials));
    this.group.add(buildGroundDecals());
    this.group.add(buildRoadMarkings());

    add(buildBasin(W));
    add(buildSmelter(W));
    add(buildTowers(W));
    add(buildYard(W));
    add(buildRail(W));
    add(buildSouth(W));
    add(buildWest(W));
    add(buildBlastWalls(W));
    add(buildPerimeter(W));
    add(buildScatter(W));

    this.colliders = col.colliders;

    // --- local emissive lights ------------------------------------
    // Every furnace mouth, molten runner, tap spout, window strip and tank
    // spill registers here (22 emitters, up from 6). LIGHT_SLOTS PointLights
    // follow the camera around the arena; the slot COUNT is fixed so the
    // light-count uniform never changes and nothing recompiles.
    this._setupEmitters(W.lights, scene);

    // --- atmosphere ----------------------------------------------
    this.atmo = new Atmosphere(this.ctx, W);
    this.group.add(this.atmo.group);

    scene.add(this.group);

    this._buildSpawnPoints(W);

    this._hit = { point: new THREE.Vector3(), normal: new THREE.Vector3(), distance: Infinity };
    this._near = [];
  }

  // ----------------------------------------------------------------
  _buildSpawnPoints(W) {
    const P = (x, z, dy = 0) => new THREE.Vector3(x, this.sampleHeight(x, z, 6) + dy, z);

    this.spawnPoints.player = P(0, 150, 0.2);

    this.spawnPoints.enemies = [
      P(-92, -96),                 // basin north terrace
      P(104, -70),                 // basin east terrace
      P(196, 88),                  // container yard aisle
      P(268, -108),                // yard north
      P(-206, 96),                 // warehouse approach
      P(-58, 214),                 // rail spur
      P(150, 224),                 // tank farm road
      P(-118, -166),               // smelter apron
      P(46, 116),                  // south of the basin
      P(-282, -108),               // west siding
    ];

    const spots = W.pylonSpots.slice();
    while (spots.length < CFG.MISSION.PYLONS) spots.push(P(0, 0));
    this.spawnPoints.pylons = spots.slice(0, CFG.MISSION.PYLONS).map((v) => v.clone());
  }

  // ----------------------------------------------------------------
  //  shadow cascade fitting
  // ----------------------------------------------------------------
  /** Resize the ortho box and re-derive both bias terms from the new texel
   *  size.  Called only when the span has actually moved by half a texel. */
  _fitShadow(span) {
    const sc = this.sun.shadow.camera;
    sc.left = -span; sc.right = span;
    sc.top = span; sc.bottom = -span;
    sc.updateProjectionMatrix();   // REQUIRED — three never recomputes this for us
    this._appliedSpan = span;

    // texel footprint in world units. Everything below is derived from it, so
    // the offsets shrink automatically as the box tightens.
    const texel = (span * 2) / this.sun.shadow.mapSize.x;
    this._texel = texel;
    // Depth slope: the key rakes at ~21 deg, so a flat apron is lit at ~69 deg
    // off its normal and one texel spans texel*tan(69) ~ 2.6 u of depth. That
    // is the acne threshold; anything past it is pure peter-panning.
    this.sun.shadow.bias = -((texel * 2.7 + 0.02) / this._depthRange);
    // ~1.2 texels along the normal — enough to save grazing vertical faces,
    // small enough that a foot plate still lands on its own shadow. The old
    // value was 0.95 u, i.e. three texels of lateral slide at the contact.
    this.sun.shadow.normalBias = clamp(texel * 1.2, 0.05, 0.30);
  }

  _updateSun(focus, dt) {
    const cam = this.ctx.camera;
    // Fit the box to what the lens can resolve. A chase cam 20 u out needs
    // ~96; a high establishing cam needs reach or the arena stops casting.
    const d = cam ? cam.position.distanceTo(focus) : 60;
    const want = clamp(d * 1.7 + 52 + Math.max(0, focus.y) * 0.55, SPAN_MIN, SPAN_MAX);
    const k = 1 - Math.exp(-dt * 3.2);
    this._span += (want - this._span) * (k > 1 ? 1 : k);

    const span = this._span;
    if (Math.abs(span - this._appliedSpan) > this._texel * 0.75) this._fitShadow(span);

    // Snap the box centre to the texel grid or the shadow crawls as you move.
    const texel = this._texel;
    const fy = Math.max(0, focus.y) * 0.55;
    const cx = Math.round(focus.x / texel) * texel;
    const cy = Math.round(fy / texel) * texel;
    const cz = Math.round(focus.z / texel) * texel;
    this.sun.target.position.set(cx, cy, cz);
    this.sun.position.set(cx + this._sunOffset.x, cy + this._sunOffset.y, cz + this._sunOffset.z);
    this.sun.target.updateMatrixWorld();
  }

  // ----------------------------------------------------------------
  //  local emissive lights
  // ----------------------------------------------------------------
  _setupEmitters(list, scene) {
    // strongest first so the fallback ordering is already sane
    list.sort((a, b) => b.intensity - a.intensity);
    this.emitters = list;
    this.pointLights = [];
    const n = Math.min(LIGHT_SLOTS, list.length);
    for (let i = 0; i < n; i++) {
      const l = list[i];
      const p = new THREE.PointLight(l.color, l.intensity, l.distance, 2.0);
      p.position.set(l.x, l.y, l.z);
      p.castShadow = false;
      scene.add(p);
      this.pointLights.push({ light: p, src: l, want: l, level: 1 });
    }
    // scratch — reused every selection pass, never reallocated
    this._score = new Float32Array(list.length);
    this._pick = new Int32Array(n);
    this._used = new Uint8Array(list.length);
  }

  /** Re-point the eight slots at the most valuable emitters for this camera.
   *  Runs on a 6-frame cadence; O(slots * emitters) with no allocation. */
  _selectEmitters(cam) {
    const E = this.emitters, S = this._score, P = this._pick, U = this._used;
    const n = P.length;
    if (!n) return;
    const cx = cam.position.x, cy = cam.position.y, cz = cam.position.z;
    for (let i = 0; i < E.length; i++) {
      const e = E[i];
      const dx = e.x - cx, dy = e.y - cy, dz = e.z - cz;
      const d2 = dx * dx + dy * dy + dz * dz;
      const reach = (e.distance || 90) * 1.6;
      // intensity discounted by how far outside its own reach the camera is
      S[i] = e.intensity / (1 + d2 / (reach * reach));
      U[i] = 0;
    }
    for (let s = 0; s < n; s++) {
      let best = -1, bv = -1;
      for (let i = 0; i < E.length; i++) {
        if (U[i]) continue;
        if (S[i] > bv) { bv = S[i]; best = i; }
      }
      if (best < 0) { P[s] = P[s] || 0; continue; }
      U[best] = 1;
      P[s] = best;
    }
    // Keep slot -> emitter assignment stable: a slot already holding one of the
    // chosen emitters keeps it, so only genuine swaps ever cross-fade.
    for (let s = 0; s < n; s++) {
      const cur = this.pointLights[s].src;
      for (let t = s; t < n; t++) {
        if (E[P[t]] === cur) { const tmp = P[s]; P[s] = P[t]; P[t] = tmp; break; }
      }
    }
    for (let s = 0; s < n; s++) this.pointLights[s].want = E[P[s]];
  }

  // ----------------------------------------------------------------
  reset() { }

  update(dt) {
    this.time += dt;
    this.sky?.update(dt);
    const cam = this.ctx.camera;
    const focus = this.ctx.player?.pos || cam.position;
    this._updateSun(focus, dt);
    this.atmo?.update(dt, cam);

    // --- emitter slot management ---------------------------------
    if (this.pointLights?.length) {
      if ((this._lightTick = (this._lightTick + 1) % 6) === 0) this._selectEmitters(cam);

      const t2 = this.time;
      const rate = dt * 4.5;
      for (const pl of this.pointLights) {
        // cross-fade: drop the old emitter out before the slot is re-aimed
        if (pl.src !== pl.want) {
          pl.level -= rate;
          if (pl.level <= 0) { pl.level = 0; pl.src = pl.want; pl.light.color.set(pl.src.color); }
        } else if (pl.level < 1) {
          pl.level = Math.min(1, pl.level + rate);
        }
        const e = pl.src;
        pl.light.position.set(e.x, e.y, e.z);
        pl.light.distance = e.distance;
        // per-emitter flicker phase: a furnace bank must not pulse in unison
        const ph = e.phase || 0;
        const f = 0.86 + Math.sin(t2 * 2.3 + ph) * 0.06 + Math.sin(t2 * 5.7 + ph * 1.7) * 0.05
          + Math.sin(t2 * 11.3 + ph * 2.9) * 0.03;
        pl.light.intensity = e.intensity * f * pl.level;
      }
    }

    // furnace / molten breathing
    const t = this.time;
    const flick = 0.86 + Math.sin(t * 2.3) * 0.06 + Math.sin(t * 5.7 + 1.1) * 0.05
      + Math.sin(t * 11.3 + 0.4) * 0.03;
    if (this.materials) {
      // Emissive is a SURFACE, not a light source: the real point lights above
      // do the illuminating now, so the crust no longer has to fake it by
      // out-glowing everything standing on it.
      this.materials.slag.emissiveIntensity = 0.46 * (0.9 + (flick - 0.86) * 1.6);
      this.materials.windows.emissiveIntensity = 1.9 * (0.96 + Math.sin(t * 0.9) * 0.04);
    }
  }

  updateIdle() { }

  // ----------------------------------------------------------------
  //  physics API
  // ----------------------------------------------------------------
  sampleHeight(x, z, yRef = Infinity) {
    return this.col ? this.col.sampleHeight(x, z, yRef) : terrainY(x, z);
  }

  groundHeight(x, z) { return terrainY(x, z); }

  collidersNear(x, z, r = 0, out = this._near) {
    return this.col ? this.col.near(x, z, r, out) : (out.length = 0, out);
  }

  raycastWorld(origin, dir, maxDist = 800, out = null) {
    if (!this.col) return null;
    return this.col.raycast(origin, dir, maxDist, out);
  }

  /** true while the point is inside the playable disc */
  isInside(p, margin = 0) {
    return (p.x * p.x + p.z * p.z) < (CFG.ARENA.RADIUS - margin) ** 2;
  }

  /** 0 outside the soft wall .. 1 deep inside */
  wallFalloff(p) {
    const r = Math.sqrt(p.x * p.x + p.z * p.z);
    return clamp((CFG.ARENA.WALL - r) / (CFG.ARENA.WALL - CFG.ARENA.RADIUS), 0, 1);
  }
}

export default Arena;

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

const SHADOW_SPAN = 320;

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
      // Low on purpose. The AC6 read is ONE hard key and a thin cool fill;
      // a fat IBL term is what flattens an industrial exterior into midtone.
      scene.environmentIntensity = 0.40;
    }

    // --- materials ---
    this.materials = buildMaterials();

    // --- lighting -------------------------------------------------
    // High contrast is the whole look: the key does the work, the fill only
    // keeps the shadow side legible. Anything more and the arena goes flat.
    const hemi = new THREE.HemisphereLight(0x000000, 0x000000, 1.0);
    hemi.color.setRGB(0.26, 0.34, 0.50);        // cold sky fill
    hemi.groundColor.setRGB(0.20, 0.11, 0.06);  // warm bounce off the ash
    hemi.intensity = 0.40;
    scene.add(hemi);
    this.hemi = hemi;

    const sun = new THREE.DirectionalLight(0xffffff, 8.6);
    sun.color.setRGB(1.0, 0.786, 0.560);        // ~3400 K raking key
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = -SHADOW_SPAN; sc.right = SHADOW_SPAN;
    sc.top = SHADOW_SPAN; sc.bottom = -SHADOW_SPAN;
    sc.near = 20; sc.far = 1150;
    sc.updateProjectionMatrix();   // REQUIRED — three never recomputes this for us
    sun.shadow.bias = -0.00055;
    sun.shadow.normalBias = 0.95;
    sun.shadow.blurSamples = 8;
    scene.add(sun);
    scene.add(sun.target);
    this.sun = sun;
    this._sunOffset = SKY.sunDir.clone().multiplyScalar(560);
    this._updateSun(new THREE.Vector3(0, 0, 60));

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

    // --- local emissive lights (kept to 2: shader cost is global) --
    W.lights.sort((a, b) => b.intensity - a.intensity);
    this.pointLights = [];
    for (const l of W.lights.slice(0, 2)) {
      const p = new THREE.PointLight(l.color, l.intensity, l.distance, 2.0);
      p.position.set(l.x, l.y, l.z);
      p.castShadow = false;
      scene.add(p);
      this.pointLights.push({ light: p, base: l.intensity });
    }

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

  _updateSun(focus) {
    const span = SHADOW_SPAN;
    const texel = (span * 2) / this.sun.shadow.mapSize.x;
    const cx = Math.round((focus.x * 0.42) / texel) * texel;
    const cz = Math.round((focus.z * 0.42) / texel) * texel;
    this.sun.target.position.set(cx, 0, cz);
    this.sun.position.set(cx + this._sunOffset.x, this._sunOffset.y, cz + this._sunOffset.z);
    this.sun.target.updateMatrixWorld();
  }

  // ----------------------------------------------------------------
  reset() { }

  update(dt) {
    this.time += dt;
    this.sky?.update(dt);
    const cam = this.ctx.camera;
    const focus = this.ctx.player?.pos || cam.position;
    this._updateSun(focus);
    this.atmo?.update(dt, cam);

    // furnace / molten breathing
    const t = this.time;
    const flick = 0.86 + Math.sin(t * 2.3) * 0.06 + Math.sin(t * 5.7 + 1.1) * 0.05
      + Math.sin(t * 11.3 + 0.4) * 0.03;
    for (const pl of this.pointLights) pl.light.intensity = pl.base * flick;
    if (this.materials) {
      this.materials.slag.emissiveIntensity = 2.4 * (0.9 + (flick - 0.86) * 1.6);
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

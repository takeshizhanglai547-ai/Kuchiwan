// ASHVEIL — the vertical slice level.
//
// Layout runs roughly along +Z. The whole level is built so that the Kilnspire
// (the boss's tower, z ≈ +80) is visible from the spawn ledge (z ≈ -58) and is
// actually reachable — the brief's "distant landmark must be real" rule.
//
//   z -58   spawn ledge, HERO SHOT, broken arch foreground
//   z -40   grand stair down
//   z -34   PLAZA · checkpoint I · first Ash Thralls
//   z -10   ROUTE SPLIT   high ramparts (Ember Shard) | low colonnade (Iron Vigil, Ashplate)
//   z +14   cistern plaza · checkpoint II
//   z +18   THE CISTERN (dungeon, y = -7) · Vessel Fragment · the winch
//   z +24   east bridge — the SHORTCUT the winch opens
//   z +40   fog gate
//   z +58   KILN COURT — VOLGA
//   z +80   the Kilnspire itself

import * as THREE from 'three';
import { WorldBuilder, CollisionWorld } from './build.js';
import { PALETTE, makeGlowTexture } from './materials.js';
import { rng, clamp } from '../core/util.js';

const R = rng(19730501);

export function buildLevel(scene, mats) {
  const b = new WorldBuilder(scene, mats);

  const level = {
    playerSpawn: { x: 0, y: 12.0, z: -57, yaw: 0 },
    bossSpawn: { x: 0, y: 0, z: 68, yaw: Math.PI },
    checkpoints: [],
    items: [],
    triggers: [],
    enemySpawns: [],
    gates: [],
    dynamic: [],
    lights: [],
  };

  // ==========================================================================
  // 1. THE SPAWN LEDGE — the hero shot
  // ==========================================================================
  // Composition: a broken corbel arch frames the foreground, the ledge drops
  // away to the plaza in the mid-ground, and the Kilnspire closes the vista.

  // The mass stops at 11.7 so the terrace slab sits ON it. Previously both tops
  // landed on y=12 exactly, which is coplanar z-fighting waiting to shimmer.
  b.box({ x: 0, y: 6, z: -60, w: 22, h: 5.7, d: 16, mat: 'stoneDark', uv: 2.6 });  // the ledge mass
  b.box({ x: 0, y: 11.7, z: -60, w: 20, h: 0.3, d: 14, mat: 'stone', uv: 2.2 });   // paved shrine terrace

  // a ruined shrine at the player's back, so the first thing behind you is a story
  b.corbelArch({ x: 0, y: 12, z: -64.5, span: 3.4, h: 3.2, depth: 1.4, mat: 'stone', steps: 3 });
  b.cinderEye({ x: 0, y: 16.4, z: -63.7, s: 1.3, lit: true });
  b.box({ x: -4.5, y: 12, z: -64, w: 1.2, h: 4.6, d: 1.2, mat: 'stone', uv: 1.6 });
  b.box({ x: 4.5, y: 12, z: -64, w: 1.2, h: 3.1, d: 1.2, mat: 'stone', uv: 1.6 });  // broken to a stump
  b.rock({ x: 5.4, y: 12, z: -62.6, s: 1.1 });

  // FOREGROUND FRAME: a fallen arch lying across the view. This is the element
  // that gives the opening screenshot depth instead of a flat vista.
  b.box({ x: -6.2, y: 12, z: -55.5, w: 1.5, h: 5.0, d: 1.5, mat: 'stone', uv: 1.8 });
  b.box({ x: 6.2, y: 12, z: -55.5, w: 1.5, h: 5.4, d: 1.5, mat: 'stone', uv: 1.8 });
  b.box({ x: 0, y: 16.6, z: -55.5, w: 14.5, h: 1.2, d: 1.8, mat: 'stone', uv: 2.4, collide: false });
  b.box({ x: -0.5, y: 17.8, z: -55.5, w: 6.0, h: 0.8, d: 1.4, mat: 'stoneDark', uv: 2, collide: false });

  // parapet along the drop, low enough to see over
  for (let x = -9; x <= 9; x += 1.6) {
    if (Math.abs(x) < 2.2) continue;                      // the gap you walk through
    b.box({ x, y: 12, z: -53.4, w: 1.4, h: 0.9 + R.next() * 0.25, d: 0.7, mat: 'stone', uv: 1.2 });
  }

  // three ember lanterns marking the way down — the level's first "go here"
  emberPost(b, level, -2.6, 12, -54.5);
  emberPost(b, level, 2.6, 12, -54.5);

  // corpse of a previous knight, hand pointing down the stair (environmental storytelling)
  corpse(b, 3.2, 12, -57.5, 0.7);

  // ==========================================================================
  // 2. GRAND STAIR down to the plaza
  // ==========================================================================
  // 30 steps descending 12 units over 13 units of Z — steep, but every step is
  // real geometry, so the descent reads as architecture rather than a ramp.
  stairRun(b, 0, 12.0, -53.0, 30, -0.40, 0.44, 7.0, 'stone');

  // side walls of the stair cut, so you cannot walk off it into the void
  b.box({ x: -4.4, y: 0, z: -46, w: 1.6, h: 13, d: 16, mat: 'stoneDark', uv: 2.6 });
  b.box({ x: 4.4, y: 0, z: -46, w: 1.6, h: 13, d: 16, mat: 'stoneDark', uv: 2.6 });

  // ==========================================================================
  // 3. THE PLAZA
  // ==========================================================================
  const PLAZA = { x0: -16, x1: 16, z0: -38, z1: -8 };
  b.box({ x: 0, y: -0.4, z: -23, w: 34, h: 0.4, d: 32, mat: 'ground', uv: 7, ao: 0 });

  // colonnade down both sides — a corridor of columns that funnels the eye north
  for (let z = -35; z <= -11; z += 4.0) {
    for (const sx of [-1, 1]) {
      const broken = R.chance(0.30);
      const h = broken ? 2.0 + R.next() * 2.0 : 5.4;
      b.cylinder({ x: sx * 12.5, y: 0, z, r: 0.62, h, mat: 'column', uv: 2.4 });
      // Blackened-iron banding at base and cap. A second material at the ends is
      // what stops an extruded cylinder reading as an untextured primitive.
      b.box({ x: sx * 12.5, y: 0.02, z, w: 1.42, h: 0.30, d: 1.42, mat: 'ironLight', uv: 1, collide: false });
      if (!broken) {
        b.box({ x: sx * 12.5, y: h - 0.34, z, w: 1.38, h: 0.26, d: 1.38, mat: 'ironLight', uv: 1, collide: false });
        b.box({ x: sx * 12.5, y: h, z, w: 1.8, h: 0.5, d: 1.8, mat: 'stone', uv: 1.6, collide: false });
        // architrave connecting the columns
        b.box({ x: sx * 12.5, y: h + 0.5, z: z + 2, w: 1.3, h: 0.7, d: 4.2, mat: 'stoneDark', uv: 2, collide: false });
      } else {
        b.rock({ x: sx * 12.5 + R.range(-1.2, 1.2), y: 0, z: z + R.range(-1.2, 1.2), s: 1.0 + R.next() });
      }
    }
  }
  // outer walls behind the colonnade
  b.box({ x: -16.5, y: 0, z: -23, w: 2, h: 9, d: 32, mat: 'stoneDark', uv: 2.6 });
  b.box({ x: 16.5, y: 0, z: -23, w: 2, h: 9, d: 32, mat: 'stoneDark', uv: 2.6 });
  b.box({ x: 0, y: 0, z: -39.5, w: 34, h: 9, d: 2, mat: 'stoneDark', uv: 2.6 });   // south wall (behind the stair base)

  // CHECKPOINT I
  emberPillar(b, level, 0, 0, -34.0, 'checkpoint_1', 'Ember Pillar — the Approach');

  // a toppled colossus across the plaza: the single biggest storytelling prop
  b.box({ x: -3.0, y: 0, z: -22, w: 3.2, h: 2.6, d: 11.0, ry: 0.22, mat: 'stone', uv: 2.6 });
  b.box({ x: -4.6, y: 2.6, z: -26.4, w: 2.6, h: 2.2, d: 2.6, ry: 0.22, mat: 'stone', uv: 2, collide: false });
  b.cinderEye({ x: -4.6, y: 3.5, z: -25.1, s: 1.6, ry: 0.22, lit: false });
  b.cylinder({ x: -1.6, y: 0, z: -16.5, r: 0.5, h: 3.4, mat: 'column', uv: 2.4 });   // its severed arm
  b.rock({ x: 0.4, y: 0, z: -18.2, s: 1.4 });
  b.rock({ x: -6.0, y: 0, z: -19.0, s: 1.1 });

  // ash drifts piled against the windward side of everything
  for (let i = 0; i < 26; i++) {
    b.rock({ x: R.range(-14, 14), y: -0.1, z: R.range(-37, -9), s: R.range(0.5, 1.5), mat: 'ground', ry: R.range(0, 6.3) });
  }

  level.enemySpawns.push({ kind: 'thrall', x: 1.5, y: 0, z: -25.5, yaw: Math.PI, group: 'plaza' });
  level.enemySpawns.push({ kind: 'thrall', x: -6.5, y: 0, z: -14.0, yaw: Math.PI * 0.8, group: 'plaza' });

  // ==========================================================================
  // 4. THE SPLIT — north end of the plaza
  // ==========================================================================
  // A wall with two openings. The high road is visibly harder to reach, and the
  // Ember Shard is VISIBLE from below: the reward is advertised before it is earned.
  b.box({ x: 0, y: 0, z: -8, w: 8.0, h: 2.6, d: 2.0, mat: 'stoneDark', uv: 2.6 });   // centre block, low enough to see the Kilnspire over
  b.corbelArch({ x: -9.5, y: 0, z: -8, span: 3.0, h: 4.0, depth: 2.0, mat: 'stone' });  // left opening
  b.corbelArch({ x: 9.5, y: 0, z: -8, span: 3.0, h: 4.0, depth: 2.0, mat: 'stone' });   // right opening
  b.box({ x: -15.5, y: 0, z: -8, w: 4, h: 9, d: 2.0, mat: 'stoneDark', uv: 2.6 });
  b.box({ x: 15.5, y: 0, z: -8, w: 4, h: 9, d: 2.0, mat: 'stoneDark', uv: 2.6 });

  // ---- HIGH ROAD: ramparts (risk → Ember Shard) ----
  // stair up, on the left, climbing north
  stairRun(b, -9.5, 0, -6.5, 18, 0.34, 0.62, 3.2, 'stone');
  b.box({ x: -9.5, y: 6.1, z: 6.5, w: 5.0, h: 0.5, d: 12.0, mat: 'stone', uv: 2.6 });  // rampart walk
  b.box({ x: -12.4, y: 6.6, z: 6.5, w: 0.8, h: 1.5, d: 12.0, mat: 'stone', uv: 2 }); // outer parapet
  for (let z = 1.5; z <= 11.5; z += 2.0) {                                            // merlons
    b.box({ x: -12.4, y: 8.1, z, w: 0.8, h: 0.9, d: 1.0, mat: 'stone', uv: 1.2, collide: false });
  }
  // the rampart is exposed: a Cinder-Caster owns it, and it can hit the low road
  level.enemySpawns.push({ kind: 'caster', x: -9.5, y: 6.6, z: 9.0, yaw: Math.PI, group: 'split' });
  level.items.push({ id: 'ember_shard', kind: 'shard', x: -9.5, y: 6.9, z: 12.0,
                     title: 'EMBER SHARD', sub: 'Attack increased' });
  emberPost(b, level, -11.6, 6.6, 12.0);

  // descent from the rampart into the cistern plaza
  stairRun(b, -9.5, 6.6, 13.5, 12, -0.55, 0.62, 3.2, 'stone');

  // ---- LOW ROAD: the colonnade of vigils (Iron Vigil → Ashplate) ----
  b.box({ x: 9.5, y: -0.4, z: 3, w: 12, h: 0.4, d: 22, mat: 'ground', uv: 7, ao: 0 });
  b.box({ x: 16.0, y: 0, z: 3, w: 2, h: 7, d: 22, mat: 'stoneDark', uv: 2.6 });
  b.box({ x: 3.6, y: 0, z: 3, w: 2, h: 7, d: 22, mat: 'stoneDark', uv: 2.6 });
  for (let z = -4; z <= 10; z += 3.5) {
    b.cylinder({ x: 6.2, y: 0, z, r: 0.5, h: 4.6, mat: 'column', uv: 2.4 });
    b.cylinder({ x: 12.8, y: 0, z, r: 0.5, h: 4.6, mat: 'column', uv: 2.4 });
    b.box({ x: 6.2, y: 0.02, z, w: 1.16, h: 0.26, d: 1.16, mat: 'ironLight', uv: 1, collide: false });
    b.box({ x: 12.8, y: 0.02, z, w: 1.16, h: 0.26, d: 1.16, mat: 'ironLight', uv: 1, collide: false });
  }
  // COLLAPSE the far third of the colonnade so the corridor pinches to the left.
  // The Vigil then holds the far side of the pinch: the fight opens at a
  // chokepoint instead of in fifteen metres of open ground.
  b.box({ x: 12.2, y: 0, z: 5.6, w: 6.6, h: 2.9, d: 3.2, ry: 0.22, mat: 'stoneDark', uv: 2.6 });
  b.box({ x: 11.0, y: 2.9, z: 5.0, w: 3.4, h: 1.5, d: 2.2, ry: -0.4, mat: 'stone', uv: 2, collide: false });
  b.rock({ x: 9.6, y: 0, z: 4.2, s: 1.5, collide: true });
  b.rock({ x: 13.4, y: 0, z: 8.0, s: 1.2 });
  // an alcove holding the Ashplate — you have to leave the path to see it
  b.box({ x: 15.0, y: 0, z: -3.0, w: 3.0, h: 3.4, d: 3.0, mat: 'stone', uv: 2, collide: false });
  b.corbelArch({ x: 14.6, y: 0, z: -4.6, span: 1.6, h: 2.4, depth: 1.0, ry: Math.PI / 2, mat: 'stone', steps: 3 });
  level.items.push({ id: 'ashplate', kind: 'plate', x: 14.6, y: 0.2, z: -2.6,
                     title: 'SCORCHED ASHPLATE', sub: 'Maximum health increased' });
  // The lantern sits OUT on the colonnade line, not inside the alcove: the light
  // advertises the detour, and the detour — not the light — earns the object.
  emberPost(b, level, 12.6, 0, -2.6, 12, 15);
  corpse(b, 13.6, 0, -1.4, 2.1);

  level.enemySpawns.push({ kind: 'vigil', x: 7.8, y: 0, z: 7.4, yaw: Math.PI, group: 'lowroad' });
  level.enemySpawns.push({ kind: 'thrall', x: 11.5, y: 0, z: -3.0, yaw: Math.PI, group: 'lowroad' });

  // ==========================================================================
  // 5. CISTERN PLAZA — checkpoint II, and the mouth of the dungeon
  // ==========================================================================
  b.box({ x: 0, y: -0.4, z: 15, w: 40, h: 0.4, d: 14, mat: 'ground', uv: 7, ao: 0 });
  b.box({ x: -20.5, y: 0, z: 15, w: 2, h: 8, d: 14, mat: 'stoneDark', uv: 2.6 });
  b.box({ x: 20.5, y: 0, z: 15, w: 2, h: 8, d: 14, mat: 'stoneDark', uv: 2.6 });
  b.box({ x: 0, y: 0, z: 8.4, w: 26, h: 8, d: 2, mat: 'stoneDark', uv: 2.6 });     // south wall w/ gaps below
  // openings from the two routes
  b.box({ x: -9.5, y: 0, z: 8.4, w: 5.5, h: 8, d: 2.2, mat: 'stone', collide: false, detail: true });
  b.box({ x: 9.5, y: 0, z: 8.4, w: 5.5, h: 8, d: 2.2, mat: 'stone', collide: false, detail: true });

  emberPillar(b, level, 0, 0, 12.5, 'checkpoint_2', 'Ember Pillar — the Cistern Mouth');

  // ==========================================================================
  // 6. THE CISTERN (dungeon, floor at y = -7)
  // ==========================================================================
  const CY = -7;
  // descent
  stairRun(b, 0, 0, 18.0, 20, -0.37, 0.55, 5.0, 'vault');
  b.box({ x: 0, y: CY - 0.4, z: 30, w: 32, h: 0.4, d: 22, mat: 'ground', uv: 7, ao: 0 });
  // chamber walls
  b.box({ x: -16.5, y: CY, z: 30, w: 2, h: 12, d: 24, mat: 'vault', uv: 4 });
  b.box({ x: 16.5, y: CY, z: 30, w: 2, h: 12, d: 24, mat: 'vault', uv: 4 });
  b.box({ x: 0, y: CY, z: 41.5, w: 34, h: 12, d: 2, mat: 'vault', uv: 4 });
  b.box({ x: -10, y: CY, z: 19.0, w: 14, h: 12, d: 2, mat: 'vault', uv: 4 });
  b.box({ x: 10, y: CY, z: 19.0, w: 14, h: 12, d: 2, mat: 'vault', uv: 4 });
  // ceiling (so it reads as interior and the fog goes dark)
  b.box({ x: 0, y: 4.6, z: 30, w: 34, h: 1.2, d: 24, mat: 'vault', uv: 5, collide: false });

  // forest of piers holding the ceiling — cover, sightline breaks, and ambush geometry
  for (let x = -10; x <= 10; x += 6.6) {
    for (let z = 23; z <= 38; z += 6.0) {
      b.box({ x, y: CY, z, w: 1.5, h: 11.6, d: 1.5, mat: 'vault', uv: 2.6 });
      b.box({ x, y: CY + 8.2, z, w: 2.4, h: 0.6, d: 2.4, mat: 'stone', uv: 2, collide: false });
    }
  }

  // raised ledges around the rim — where the Casters stand, forcing you to
  // choose between the archer above and the thralls below
  b.box({ x: -13.0, y: CY, z: 30, w: 5.0, h: 3.2, d: 20, mat: 'vault', uv: 2.6 });
  b.box({ x: 13.0, y: CY, z: 30, w: 5.0, h: 3.2, d: 20, mat: 'vault', uv: 2.6 });
  stairRun(b, -12.0, CY, 21.5, 9, 0.36, 0.5, 3.0, 'stone');

  // Lantern chain through the cistern. Without these the dungeon is not "dark
  // and atmospheric", it is unnavigable — and a player who cannot read the space
  // cannot make decisions in it.
  emberPost(b, level, -6.6, CY, 22.0, 15, 19);
  emberPost(b, level, 6.6, CY, 27.5, 15, 19);
  emberPost(b, level, -6.6, CY, 34.0, 15, 19);
  emberPost(b, level, 6.6, CY, 39.0, 15, 19);
  emberPost(b, level, 0, CY, 30.0, 13, 18);

  level.enemySpawns.push({ kind: 'thrall', x: -3.0, y: CY, z: 26.0, yaw: Math.PI, group: 'cistern' });
  level.enemySpawns.push({ kind: 'thrall', x: 3.5, y: CY, z: 29.0, yaw: Math.PI, group: 'cistern' });
  level.enemySpawns.push({ kind: 'caster', x: 13.0, y: CY + 3.2, z: 32.0, yaw: -Math.PI / 2, group: 'cistern' });
  level.enemySpawns.push({ kind: 'vigil', x: 0, y: CY, z: 37.0, yaw: Math.PI, group: 'cistern' });

  // The Vessel Fragment: deep, off-path, behind the pier forest, lit by one lantern.
  b.box({ x: -12.5, y: CY + 3.2, z: 38.5, w: 4.0, h: 2.6, d: 4.0, mat: 'stone', uv: 2, collide: false });
  level.items.push({ id: 'vessel', kind: 'vessel', x: -12.5, y: CY + 3.4, z: 38.0,
                     title: 'VESSEL FRAGMENT', sub: 'One more draught of ember' });
  emberPost(b, level, -14.2, CY + 3.2, 37.0, 14, 18);
  corpse(b, -11.0, CY + 3.2, 39.4, 4.0);

  // ---- THE WINCH: opens the east bridge ----
  const winch = new THREE.Group();
  const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 1.6, 10), mats.iron);
  drum.rotation.z = Math.PI / 2; drum.position.y = 1.2; drum.castShadow = true;
  winch.add(drum);
  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 1.4), mats.ironLight);
  handle.position.set(1.0, 1.2, 0); winch.add(handle);
  for (const sx of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.3, 1.6, 0.3), mats.iron);
    post.position.set(sx * 0.95, 0.8, 0); post.castShadow = true; winch.add(post);
  }
  winch.position.set(13.0, CY + 3.2, 24.0);
  scene.add(winch);
  level.dynamic.push({ obj: winch, kind: 'winch' });
  level.triggers.push({ id: 'winch', type: 'winch', x: 13.0, y: CY + 3.2, z: 25.2, r: 2.2,
                        prompt: 'Turn the counterweight winch', once: true, handle });
  emberPost(b, level, 14.6, CY + 3.2, 24.0, 14, 18);

  // cistern exit, north, up to the boss forecourt
  stairRun(b, 0, CY, 40.0, 20, 0.37, 0.55, 5.0, 'vault');

  // ==========================================================================
  // 7. THE SHORTCUT — east bridge, sealed by a portcullis until the winch turns
  // ==========================================================================
  b.box({ x: 18.0, y: -0.4, z: 30, w: 6, h: 0.4, d: 32, mat: 'ground', uv: 7, ao: 0 });
  b.box({ x: 21.5, y: 0, z: 30, w: 1.2, h: 4.0, d: 32, mat: 'stone', uv: 2.6 });
  b.box({ x: 14.6, y: 0, z: 30, w: 1.2, h: 4.0, d: 32, mat: 'stone', uv: 2.6 });
  b.corbelArch({ x: 18.0, y: 0, z: 17.0, span: 3.2, h: 3.6, depth: 1.4, mat: 'stone' });

  // The portcullis is a real, movable object with its own collision.
  const gateGroup = new THREE.Group();
  for (let i = -2; i <= 2; i++) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.18, 3.6, 0.18), mats.iron);
    bar.position.set(i * 0.72, 1.8, 0); bar.castShadow = true; gateGroup.add(bar);
  }
  for (const y of [0.5, 1.8, 3.1]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.16, 0.16), mats.iron);
    rail.position.set(0, y, 0); gateGroup.add(rail);
  }
  gateGroup.position.set(18.0, 0, 17.0);
  scene.add(gateGroup);
  const gateWalls = [
    { x0: 16.2, z0: 17.0, x1: 19.8, z1: 17.0, yMin: 0, yMax: 4.0, off: false },
  ];
  b.walls.push(...gateWalls);
  level.gates.push({ id: 'shortcut', obj: gateGroup, walls: gateWalls, open: false, closedY: 0, openY: 3.7 });

  // ==========================================================================
  // 8. BOSS FORECOURT + FOG GATE
  // ==========================================================================
  b.box({ x: 0, y: -0.4, z: 44, w: 22, h: 0.4, d: 10, mat: 'ground', uv: 7, ao: 0 });
  b.box({ x: -11.5, y: 0, z: 44, w: 2, h: 8, d: 10, mat: 'stoneDark', uv: 2.6 });
  b.box({ x: 11.5, y: 0, z: 44, w: 2, h: 8, d: 10, mat: 'stoneDark', uv: 2.6 });
  b.corbelArch({ x: 0, y: 0, z: 48.5, span: 5.0, h: 5.5, depth: 2.4, mat: 'stone', steps: 5, pierThick: 2.0 });
  b.cinderEye({ x: 0, y: 8.4, z: 47.2, s: 2.2, lit: true });

  // The fog gate is the visual threshold and stays at the arch. Volga does NOT
  // wake here, though. Waking him on the arch meant he walked 18m south to meet
  // the player, who was still standing in the entrance gap — so the whole fight
  // was fought in a 5m slot between two ring-wall segments, with those segments
  // flanking the camera on both sides for its entire duration. The arena was
  // built for this fight and the fight was never in it.
  //
  // The wake trigger is pushed to the arena floor proper. The player crosses the
  // arch, walks in, and is standing in open ground when the encounter starts.
  // Radius 9.0, not 5.5. This trigger is now the only thing that starts the
  // encounter, so it must be impossible to walk past: 9m spans the arena's full
  // usable width at this depth, and the south break is the only way in. A player
  // hugging a wall on the way north must still cross it.
  level.triggers.push({ id: 'fog_gate', type: 'boss', x: 0, y: 0, z: 57.0, r: 9.0,
                        prompt: 'Enter the Kiln Court', once: true });
  level.fogGate = { x: 0, y: 0.1, z: 48.5, w: 5.0, h: 5.5 };

  // ==========================================================================
  // 9. KILN COURT — the arena
  // ==========================================================================
  // Centre pushed north so the arena's southern edge lands exactly on the fog
  // gate: the player walks through the gate and is already inside the ring.
  const AR = { x: 0, z: 66, r: 17.5 };
  level.arena = AR;
  b.box({ x: 0, y: -0.4, z: 66, w: 38, h: 0.4, d: 34, mat: 'ground', uv: 7, ao: 0 });

  // Ring wall with TWO breaks: the southern one is the way in (without it the
  // arena seals its own entrance), the northern one opens onto the caldera so the
  // fight is silhouetted against the glow instead of happening in a grey box.
  for (let a = 0; a < Math.PI * 2; a += 0.30) {
    const nx = Math.sin(a), nz = Math.cos(a);
    if (nz > 0.74) continue;                                   // vista, facing north
    if (nz < -0.55) continue;                                  // entrance, facing south
    const h = 6 + Math.sin(a * 3) * 1.6;
    b.box({ x: AR.x + nx * 17.5, y: 0, z: AR.z + nz * 17.5, w: 3.0, h, d: 2.0, ry: -a, mat: 'stoneDark', uv: 2.6 });
  }
  // kiln mouths around the wall — this is a working furnace hall
  for (const a of [-2.4, -1.6, 1.6, 2.4]) {
    const nx = Math.sin(a), nz = Math.cos(a);
    b.corbelArch({ x: AR.x + nx * 16.0, y: 0, z: AR.z + nz * 16.0, span: 2.0, h: 2.6,
                   depth: 1.2, ry: -a, mat: 'stone', steps: 3 });
    const glow = new THREE.PointLight(PALETTE.caldera, 6, 16, 2);
    glow.position.set(AR.x + nx * 15.4, 1.6, AR.z + nz * 15.4);
    scene.add(glow);
    level.lights.push(glow);
    b.box({ x: AR.x + nx * 15.8, y: 0.1, z: AR.z + nz * 15.8, w: 1.4, h: 1.0, d: 0.4,
            ry: -a, mat: 'ember', collide: false });
  }

  // Four great pillars. They used to stand ~8.5m from centre, which is exactly
  // where a locked-on camera orbits (player circles the boss at ~3.5m, boom sits
  // 5.4m behind), so for most of the fight one of them was parked against the
  // lens. Pushed out past 12.5m they are outside every reachable boom position:
  // they frame the arena and silhouette against the caldera instead of blocking
  // the shot.
  for (const [px, pz] of [[-9.5, 57.5], [9.5, 57.5], [-9.5, 74.5], [9.5, 74.5]]) {
    b.cylinder({ x: px, y: 0, z: pz, r: 1.05, h: 9.0, mat: 'column', uv: 2.4 });
    b.box({ x: px, y: 0.02, z: pz, w: 2.5, h: 0.34, d: 2.5, mat: 'ironLight', uv: 1, collide: false });
    b.box({ x: px, y: 9.0, z: pz, w: 3.0, h: 0.8, d: 3.0, mat: 'stone', uv: 2, collide: false });
  }
  // The fight still needs interior geometry, but it must be geometry the camera
  // can see over. These slag buttresses are 1.6m — high enough to eat Volga's
  // ground sweep and to break a straight charge, low enough that the boom (eye
  // height ~2.2m, looking slightly down) never has one filling the frame.
  for (const [bx, bz, br] of [[-6.4, 61.0, 0.5], [6.4, 61.0, -0.5],
                              [-6.4, 71.2, -0.4], [6.4, 71.2, 0.4]]) {
    b.box({ x: bx, y: 0, z: bz, w: 3.6, h: 1.6, d: 1.5, ry: br, mat: 'stoneDark', uv: 2.6 });
    b.box({ x: bx, y: 1.6, z: bz, w: 3.9, h: 0.22, d: 1.8, ry: br, mat: 'stone', uv: 2.6, collide: false });
  }
  // A broken ring platform across the caldera-facing third: an elevation option
  // for the player, and a break in Volga's ground sweeps.
  b.box({ x: 0, y: 0, z: 76.5, w: 22, h: 1.5, d: 7.0, mat: 'stone', uv: 2.6 });
  b.ramp({ x: -9.5, y: 0, z: 74.0, w: 3.4, len: 5.0, rise: 1.5, ry: Math.PI / 2, mat: 'stone' });
  b.ramp({ x: 9.5, y: 0, z: 74.0, w: 3.4, len: 5.0, rise: 1.5, ry: -Math.PI / 2, mat: 'stone' });
  // A toppled column the player can roll over but a 4.6m boss must path around.
  b.box({ x: -2.0, y: 0, z: 66.0, w: 2.1, h: 1.1, d: 9.0, ry: 0.30, mat: 'stone', uv: 2.6 });

  // Caldera backlight. Sits low and north of the fight, aimed south across the
  // floor, so Volga is rim-lit from behind and his crown separates from the sky.
  // Dim in phase 1; the director ramps it hard at the phase change so the
  // transition is a lighting event and not just a particle puff.
  const arenaGlow = new THREE.PointLight(PALETTE.caldera, 8, 46, 2);
  arenaGlow.position.set(AR.x, 3.4, AR.z + 16.0);
  scene.add(arenaGlow);
  level.lights.push(arenaGlow);
  level.arenaGlow = arenaGlow;
  level.arenaGlowBase = 8;

  // ash and slag banked against the arena's edges
  for (let i = 0; i < 30; i++) {
    const a = R.range(0, 6.28), d = R.range(11, 16.5);
    b.rock({ x: AR.x + Math.sin(a) * d, y: -0.1, z: AR.z + Math.cos(a) * d, s: R.range(0.6, 1.8), mat: 'ground' });
  }

  // ==========================================================================
  // 10. THE KILNSPIRE — the landmark visible from the first frame
  // ==========================================================================
  // Deliberately built from the same corbelled vocabulary, just enormous.
  const SP = { x: 0, z: 92 };
  b.box({ x: SP.x, y: 0, z: SP.z, w: 22, h: 8, d: 22, mat: 'stoneDark', uv: 2.6, collide: false });
  b.box({ x: SP.x, y: 8, z: SP.z, w: 17, h: 14, d: 17, mat: 'stoneDark', uv: 2.6, collide: false });
  b.box({ x: SP.x, y: 22, z: SP.z, w: 13, h: 16, d: 13, mat: 'stone', uv: 2.6, collide: false });
  b.box({ x: SP.x, y: 38, z: SP.z, w: 9.5, h: 14, d: 9.5, mat: 'stone', uv: 2.6, collide: false });
  b.box({ x: SP.x, y: 52, z: SP.z, w: 7, h: 10, d: 7, mat: 'stone', uv: 2.6, collide: false });
  // the crown: four chimneys, still burning
  for (const [ox, oz] of [[-2.4, -2.4], [2.4, -2.4], [-2.4, 2.4], [2.4, 2.4]]) {
    b.cylinder({ x: SP.x + ox, y: 62, z: SP.z + oz, r: 0.85, h: 7, mat: 'stoneDark', collide: false, uv: 3 });
    b.box({ x: SP.x + ox, y: 68.4, z: SP.z + oz, w: 1.5, h: 0.7, d: 1.5, mat: 'ember', collide: false });
  }
  // vertical ember veins running up the tower — reads at any distance
  for (const [ox, oz] of [[-4.2, 4.9], [4.2, 4.9], [0, 4.9]]) {
    b.box({ x: SP.x + ox, y: 22, z: SP.z + oz, w: 0.5, h: 40, d: 0.4, mat: 'emberDim', collide: false });
  }
  const spireLight = new THREE.PointLight(PALETTE.caldera, 300, 160, 2);
  spireLight.position.set(SP.x, 66, SP.z);
  scene.add(spireLight);
  level.lights.push(spireLight);

  // Distant ridgeline, so the world does not end at the arena.
  // Pushed far enough out that fog does almost all the work: at ~250 units these
  // are ~94% fogged, which reads as depth. Any closer and hard-edged boxes read
  // as pale cardboard cut-outs pasted over the sky.
  for (let i = 0; i < 9; i++) {
    const a = R.range(-1.5, 1.5);
    const d = R.range(210, 340);
    const hgt = R.range(30, 90);
    // Heavily darkened via vertex tint so the far ridgeline sits UNDER the fog
    // value instead of floating in front of it as pale cardboard cut-outs.
    b.box({ x: Math.sin(a) * d, y: -6, z: 92 + Math.cos(a) * d * 0.6, w: R.range(14, 42), h: hgt,
            d: R.range(14, 42), ry: R.range(0, 3), mat: 'stoneDark', uv: 2.6, collide: false,
            tint: 0.22, ao: 0 });
  }

  // ==========================================================================
  b.finish();

  // Every lantern and brazier light collected during construction actually
  // enters the scene here. The helpers only build and register them — without
  // this loop the checkpoints and the whole cistern were lit by nothing but
  // ambient, which is exactly what made the dungeon an unreadable black void.
  for (const l of level.lights) scene.add(l);

  level.collision = new CollisionWorld(b.walls, b.platforms);
  level.builder = b;
  return level;
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/**
 * A stair run marching along +Z. `rise` may be negative to descend.
 * Every step is solid all the way down to the lowest tread in the run, so a
 * staircase is never a set of floating slabs with holes to fall through.
 */
function stairRun(b, x, y, z, steps, rise, run, width, mat) {
  const endY = y + rise * steps;
  const base = Math.min(y, endY) - 1.5;
  for (let i = 0; i < steps; i++) {
    const zz = z + (i + 0.5) * run;
    const top = y + rise * (i + 1);
    b.box({ x, y: base, z: zz, w: width, h: top - base, d: run, mat, uv: 1.6, ao: 0.25 });
  }
}

/** A checkpoint: an iron brazier on a stepped plinth, burning. */
function emberPillar(b, level, x, y, z, id, label) {
  b.box({ x, y, z, w: 3.0, h: 0.30, d: 3.0, mat: 'stone', uv: 2, ao: 0.2 });
  b.box({ x, y: y + 0.30, z, w: 2.2, h: 0.30, d: 2.2, mat: 'stone', uv: 2 });
  b.cylinder({ x, y: y + 0.6, z, r: 0.30, h: 1.5, mat: 'iron', uv: 1.5 });
  // Bowl + four uprights, with the ember core sunk INSIDE it. Previously the
  // emissive slab sat proud of the housing and read as an untextured quad.
  b.cylinder({ x, y: y + 2.1, z, r: 0.62, h: 0.34, mat: 'iron', uv: 1.2, taper: 1.5, collide: false });
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2 + Math.PI / 4;
    b.box({ x: x + Math.sin(a) * 0.52, y: y + 2.36, z: z + Math.cos(a) * 0.52,
            w: 0.10, h: 0.34, d: 0.10, ry: -a, mat: 'ironLight', collide: false });
  }
  b.box({ x, y: y + 2.30, z, w: 0.52, h: 0.16, d: 0.52, mat: 'ember', collide: false });
  b.cinderEye({ x, y: y + 1.35, z: z + 0.34, s: 0.9, lit: true });

  level.checkpoints.push({ id, x, y, z, label });
  level.triggers.push({ id, type: 'checkpoint', x, y, z, r: 2.6, prompt: 'Rest at the Ember Pillar' });

  const l = new THREE.PointLight(0xff8a45, 13, 17, 2);
  l.position.set(x, y + 2.5, z);
  level.lights.push(l);
  level.dynamic.push({ obj: l, kind: 'flicker', base: 13 });
}

/**
 * A small ember lantern on a post — the level's wayfinding language.
 * Interiors pass a much larger intensity/range: outdoors the sky does the
 * ambient work, underground these lamps ARE the ambient, and a dungeon the
 * player cannot read is not atmospheric, it is broken.
 */
function emberPost(b, level, x, y, z, intensity = 7, range = 12) {
  b.cylinder({ x, y, z, r: 0.11, h: 2.0, mat: 'iron', uv: 1, collide: false });
  b.box({ x, y: y + 2.0, z, w: 0.34, h: 0.42, d: 0.34, mat: 'iron', collide: false });
  b.box({ x, y: y + 2.06, z, w: 0.22, h: 0.28, d: 0.22, mat: 'ember', collide: false });
  // Slightly desaturated from the pure ember hue: at lantern intensities the
  // fully-saturated orange stains every surface it touches.
  const l = new THREE.PointLight(0xff8a45, intensity, range, 2);
  l.position.set(x, y + 2.2, z);
  level.lights.push(l);
  level.dynamic.push({ obj: l, kind: 'flicker', base: intensity });
}

/**
 * A dead knight. Placed to say something: pointing the way, curled around a
 * doorway they never opened, or slumped where an ambush happens.
 */
function corpse(b, x, y, z, ry) {
  b.box({ x, y: y + 0.05, z, w: 0.55, h: 0.22, d: 1.25, ry, mat: 'iron', uv: 1, collide: false });
  b.box({ x: x + Math.sin(ry) * 0.8, y: y + 0.05, z: z + Math.cos(ry) * 0.8,
          w: 0.28, h: 0.26, d: 0.28, ry, mat: 'iron', collide: false });
  b.box({ x: x - Math.sin(ry) * 0.75, y: y + 0.04, z: z - Math.cos(ry) * 0.75,
          w: 0.5, h: 0.16, d: 0.7, ry, mat: 'cloth', collide: false });
  // their sword, left where it fell
  b.box({ x: x + Math.cos(ry) * 0.7, y: y + 0.03, z: z - Math.sin(ry) * 0.7,
          w: 0.07, h: 0.06, d: 1.0, ry: ry + 0.5, mat: 'ironLight', collide: false });
}

// ---------------------------------------------------------------------------
// Sky, lighting and atmosphere
// ---------------------------------------------------------------------------

export function buildSky(scene, mats, quality = 'high') {
  // Gradient dome. A flat background colour is the single fastest way to make a
  // 3D scene look cheap, so even the sky gets a value ramp.
  const geo = new THREE.SphereGeometry(400, 24, 16);
  const matSky = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      top: { value: new THREE.Color(PALETTE.skyTop) },
      horizon: { value: new THREE.Color(PALETTE.skyHorizon) },
      glow: { value: new THREE.Color(PALETTE.caldera) },
    },
    vertexShader: `
      varying vec3 vDir;
      void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `
      uniform vec3 top, horizon, glow;
      varying vec3 vDir;
      void main(){
        float h = clamp(vDir.y * 1.55 + 0.10, 0.0, 1.0);
        vec3 c = mix(horizon, top, pow(h, 0.60));
        // The caldera burning beyond the north ridge.
        // This is a NARROW band hugging the horizon, not a sunset: the moment it
        // spreads across the upper sky the whole palette turns orange and the
        // ash-grey world it is supposed to contrast with disappears.
        float d = max(0.0, dot(normalize(vec3(vDir.x, max(vDir.y,-0.1), vDir.z)), normalize(vec3(0.0,0.04,1.0))));
        float band = exp(-max(0.0, vDir.y) * 14.0);          // dies off fast with altitude
        c += glow * pow(d, 22.0) * 0.60 * band;
        c += glow * pow(d, 6.0) * 0.045 * band;              // faint wide haze
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  const dome = new THREE.Mesh(geo, matSky);
  dome.frustumCulled = false;
  scene.add(dome);

  // Fog: dense enough to give aerial perspective across 140 units of level,
  // thin enough that the Kilnspire still reads from the spawn ledge.
  // The colour is deliberately close to the sky's horizon value — when fog and
  // sky disagree, distant geometry reads as flat cardboard cut-outs pasted on.
  scene.fog = new THREE.FogExp2(0x272630, 0.0068);

  // --- lights ---
  // KEY: low and raking from the north, the direction of the caldera. Everything
  // in the level is therefore rim-lit from behind as the player walks toward it.
  // Kept modest: this light's job is to carve edges, not to illuminate the world.
  const key = new THREE.DirectionalLight(0xffd0a4, 2.10);
  key.position.set(-24, 26, 70);
  key.castShadow = true;
  const S = 46;
  key.shadow.camera.left = -S; key.shadow.camera.right = S;
  key.shadow.camera.top = S; key.shadow.camera.bottom = -S;
  key.shadow.camera.near = 1; key.shadow.camera.far = 150;
  key.shadow.mapSize.set(quality === 'low' ? 1024 : 2048, quality === 'low' ? 1024 : 2048);
  key.shadow.bias = -0.0016;
  key.shadow.normalBias = 0.035;
  scene.add(key);
  scene.add(key.target);

  // FRONT FILL: cool, shadowless, from the south-west and above.
  //
  // The key rakes from the north because that is where the caldera is, and the
  // player walks north — which means every surface they are looking at is a
  // back-lit silhouette. That is dramatic for one screenshot and unreadable for
  // twenty minutes of play. This second directional does the actual job of
  // revealing form on the faces the camera can see.
  const fill = new THREE.DirectionalLight(0x93a8c8, 1.30);
  fill.position.set(38, 30, -46);
  scene.add(fill);

  // Opposing west fill. With only one fill direction, every surface facing the
  // other way received nothing but ambient and crushed to black — which is what
  // turned the plaza's east wall and the whole cistern into flat voids.
  const fillW = new THREE.DirectionalLight(0x8496b4, 0.70);
  fillW.position.set(-42, 26, -18);
  scene.add(fillW);

  // FILL: cold skylight from above. This carries most of the actual illumination —
  // it is what keeps the world ash-grey-violet instead of letting the warm key
  // stain every surface orange, and it is what makes stone read as stone.
  const hemi = new THREE.HemisphereLight(0x8fa2c0, 0x4a3d44, 3.10);
  scene.add(hemi);

  // A hard floor on the shadows. Pure black reads as "missing geometry" rather
  // than "dark", and it destroys any sense of material in the unlit half of the
  // frame — which, with a key light this low, is most of the frame.
  scene.add(new THREE.AmbientLight(0x424c60, 0.95));

  // A weak warm bounce from the ground, faked with a second directional.
  const bounce = new THREE.DirectionalLight(0x7f4a2a, 0.35);
  bounce.position.set(10, -12, -30);
  scene.add(bounce);

  return { dome, key, hemi, bounce, fill, fillW };
}

// ============================================================
//  EnemyManager — spawning, AI, the boss AC and its phases.
//  [STUB — owned by enemy-ai agent]
//
//  CONTRACT
//    new EnemyManager(ctx); .init(); .update(dt); .reset()
//    .alive() -> Enemy[]        (each: {id, kind, pos, ap, apMax, root, alive,
//                                      takeDamage(info), acs, staggered})
//    .spawn(kind, position, opts) -> Enemy
//    .spawnWave(name)
//    .boss -> Enemy|null
//    .queryHit(origin, dir, maxDist) -> {enemy, point, distance}|null
//  Emits 'kill' and 'phase' on the bus.
// ============================================================
import * as THREE from 'three';
import { buildEnemyMech } from '../mech/mechModel.js';
import { CFG } from '../config.js';

let NEXT_ID = 1;

export class EnemyManager {
  constructor(ctx) { this.ctx = ctx; this.list = []; this.boss = null; }

  init() {}
  reset() {
    for (const e of this.list) if (e.root) this.ctx.scene.remove(e.root);
    this.list.length = 0; this.boss = null;
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      this.spawn('mt', new THREE.Vector3(Math.cos(a) * 90, 0, Math.sin(a) * 90));
    }
  }

  alive() { return this.list.filter((e) => e.alive); }

  spawn(kind, position) {
    const m = buildEnemyMech(kind);
    m.root.position.copy(position);
    this.ctx.scene.add(m.root);
    const stat = CFG.ENEMY[kind.toUpperCase()] || CFG.ENEMY.MT;
    const e = {
      id: NEXT_ID++, kind, root: m.root, mech: m,
      pos: m.root.position, ap: stat.ap, apMax: stat.ap,
      acs: 0, staggered: false, alive: true,
      takeDamage: (info) => {
        e.ap = Math.max(0, e.ap - (info.amount || 0));
        if (e.ap <= 0 && e.alive) { e.alive = false; this.ctx.bus.emit('kill', { entity: e, kind }); }
      },
    };
    this.list.push(e);
    return e;
  }

  spawnWave() {}
  queryHit() { return null; }
  update() {}
}

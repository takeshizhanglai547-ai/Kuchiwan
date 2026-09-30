// src/enemies/enemies.js — enemy manager system (owner: enemy AI designer).
//
// API (game.enemies):
//   spawn(type, spawnPoint {pos, yaw})  -> Enemy      types: 'mt' | 'drone' | 'turret' | 'boss'
//   list                                all live + wreck enemies (array, do not mutate)
//   count(type?, aliveOnly = true)
//   killAll(type?)                      debug: kill instantly (fires normal death events)
//   boss                                the boss instance (persistent, spawned by the mission)
//   clear()                             remove everything (restart)
import * as THREE from 'three';
import { loadTemplates } from './models.js';
import { MT } from './mt.js';
import { Drone } from './drone.js';
import { Turret } from './turret.js';
import { Boss } from './boss.js';
import { MechRig } from '../mech/rig.js';

export default function enemiesSystem(game) {
  let templates = null;
  const list = [];
  const api = {
    name: 'enemies',
    order: 200,
    list,
    boss: null,
    async init(g) {
      templates = await loadTemplates(g);
      const rig = await MechRig.create(g, 'mech_boss', { palette: 'boss' });
      api.boss = new Boss(g, rig);
      g.enemies = api;
    },
    reset() { api.clear(); },

    spawn(type, sp) {
      let e;
      if (type === 'boss') e = api.boss;
      else if (type === 'mt') e = new MT(game, templates.mt);
      else if (type === 'drone') e = new Drone(game, templates.drone);
      else if (type === 'turret') e = new Turret(game, templates.turret);
      else throw new Error(`[enemies] unknown type "${type}"`);
      e.spawn(sp.pos, sp.yaw || 0);
      if (!list.includes(e)) list.push(e);
      game.events.emit('enemy:spawned', { enemy: e, type });
      return e;
    },

    count(type = null, aliveOnly = true) {
      let n = 0;
      for (const e of list) if ((!type || e.type === type) && (!aliveOnly || e.alive)) n++;
      return n;
    },

    killAll(type = null) {
      for (const e of list) if (e.alive && (!type || e.type === type)) { e.invulnerable = false; e.kill(null); }
    },

    clear() {
      for (const e of list) {
        if (e === api.boss) e.despawn();
        else e.dispose();
      }
      list.length = 0;
    },

    update(dt) {
      for (let i = list.length - 1; i >= 0; i--) {
        const e = list[i];
        e.preStep();
        e.update(dt);
        if (!e.alive && e.deadTime > e.corpseTime) {
          list.splice(i, 1);
          if (e === api.boss) e.despawn(); else e.dispose();
        }
      }
    },

    frame(alpha) {
      for (let i = 0; i < list.length; i++) list[i].syncVisual(alpha);
    },

    dispose() {
      api.clear();
      if (api.boss) api.boss.dispose();
    },
  };
  return api;
}

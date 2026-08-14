// Game loop director: checkpoints, death, respawn, enemy reset, progression,
// the boss encounter, and the run's completion state.
//
// This is the file that makes the vertical slice a GAME rather than a sandbox:
// it is responsible for the brief's Definition of Done — a player can explore,
// fight, find an item, open the shortcut, clear the dungeon, reach the boss,
// beat it, and be rewarded, with no developer intervention.

import * as THREE from 'three';
import { Enemy, EnemyDirector } from '../actors/enemy.js';
import { Boss } from '../actors/boss.js';
import { ProjectileSystem } from './combat.js';
import { clamp, clamp01, damp, lerp } from '../core/util.js';
import { PALETTE } from '../world/materials.js';

export class Director {
  constructor(scene, level, mats, fx, audio, hud, player) {
    this.scene = scene;
    this.level = level;
    this.mats = mats;
    this.fx = fx;
    this.audio = audio;
    this.hud = hud;
    this.player = player;

    this.enemies = [];
    this.actors = [player];
    this.enemyDirector = new EnemyDirector();
    this.projectiles = new ProjectileSystem(scene, mats, fx);

    this.taken = new Set();          // item ids already collected (persist through death)
    this.firedTriggers = new Set();  // one-shot triggers
    this.checkpoint = { ...level.playerSpawn };
    this.checkpointId = 'spawn';

    this.state = 'explore';          // explore | boss | dead | victory
    this.deathTimer = 0;
    this.victoryTimer = 0;
    this.musicState = 'ambient';
    this.promptTrigger = null;
    this.itemMeshes = [];
    this.runTime = 0;
    this.bossEverEngaged = false;

    /** Rule flags read by combat resolution — the boss flips these in phase 2. */
    this.rules = { chipThroughGuard: false };

    this._spawnEnemies();
    this._spawnBoss();
    this._spawnItems();
    this._buildFogGate();
  }

  // --- setup ---------------------------------------------------------------

  _spawnEnemies() {
    for (let i = 0; i < this.level.enemySpawns.length; i++) {
      const s = this.level.enemySpawns[i];
      const e = new Enemy(s.kind, this.mats, { spawnIndex: i });
      e.place(s.x, s.y, s.z, s.yaw ?? 0);
      this.scene.add(e.group);
      this.enemies.push(e);
      this.actors.push(e);
    }
  }

  _spawnBoss() {
    const b = new Boss(this.mats, this.fx);
    const s = this.level.bossSpawn;
    b.place(s.x, s.y, s.z, s.yaw ?? Math.PI);
    this.scene.add(b.group);
    this.boss = b;
    this.actors.push(b);
    b.noLock = true;                 // not lockable until the fight begins
  }

  _spawnItems() {
    for (const item of this.level.items) {
      const g = new THREE.Group();
      let mesh;
      if (item.kind === 'shard') {
        mesh = new THREE.Mesh(new THREE.OctahedronGeometry(0.22, 0), this.mats.ember);
      } else if (item.kind === 'vessel') {
        mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.18, 0.34, 8), this.mats.ember);
      } else {
        mesh = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.36, 0.10), this.mats.ember);
      }
      g.add(mesh);
      const light = new THREE.PointLight(PALETTE.ember, 5, 8, 2);
      light.position.y = 0.3;
      g.add(light);
      g.position.set(item.x, item.y + 0.75, item.z);
      this.scene.add(g);
      this.itemMeshes.push({ item, obj: g, mesh, light, baseY: item.y + 0.75 });

      this.level.triggers.push({
        id: item.id, type: 'item', x: item.x, y: item.y, z: item.z, r: 1.7,
        prompt: 'Take ' + item.title, once: true, item,
      });
    }
  }

  _buildFogGate() {
    const f = this.level.fogGate;
    if (!f) return;
    this.fogGateHandle = this.fx.fogGate?.({ x: f.x, y: f.y + f.h / 2, z: f.z },
                                           { x: f.w, y: f.h });
  }

  // --- per-frame ------------------------------------------------------------

  update(dt, ctx) {
    this.runTime += dt;
    this._updateArenaGlow(dt);

    this._updateDynamics(dt);
    this._updateItems(dt);

    if (this.state === 'dead') {
      this.deathTimer += dt;
      // Long enough for the death animation to land, short enough not to punish.
      if (this.deathTimer > 3.4 && (ctx.input.consume('interact') || ctx.input.consume('light') || this.deathTimer > 7)) {
        this.respawn();
      }
      return;
    }

    if (this.state === 'victory') {
      this.victoryTimer += dt;
      if (this.victoryTimer > 2.6) this.hud.screen('victory');
      return;
    }

    this.enemyDirector.update(dt, this.enemies, this.player);
    this._updateTriggers(dt, ctx);
    this._updateMusic(dt);
    this._updateBossFight(dt, ctx);
  }

  _updateDynamics(dt) {
    for (const d of this.level.dynamic) {
      if (d.kind === 'flicker') {
        // Ember light flicker: two detuned sines plus noise, never a clean pulse.
        const t = this.runTime * 1.0 + (d.obj.position.x + d.obj.position.z) * 0.7;
        const f = 0.82 + Math.sin(t * 3.1) * 0.09 + Math.sin(t * 7.7) * 0.05 + Math.random() * 0.06;
        d.obj.intensity = d.base * f;
      }
    }
    // gate animation
    for (const g of this.level.gates) {
      if (g.open && g.obj.position.y < g.openY) {
        g.obj.position.y = Math.min(g.openY, g.obj.position.y + dt * 1.1);
      }
    }
  }

  _updateItems(dt) {
    for (const im of this.itemMeshes) {
      if (this.taken.has(im.item.id)) continue;
      im.obj.position.y = im.baseY + Math.sin(this.runTime * 1.5 + im.item.x) * 0.10;
      im.mesh.rotation.y += dt * 0.9;
      im.light.intensity = 5 + Math.sin(this.runTime * 3 + im.item.z) * 1.2;
      if (Math.random() < 0.05) this.fx.ember(im.obj.position, 1);
    }
  }

  _updateTriggers(dt, ctx) {
    const p = this.player;
    let active = null;
    let bestD = Infinity;

    for (const t of this.level.triggers) {
      if (t.once && this.firedTriggers.has(t.id)) continue;
      if (t.type === 'item' && this.taken.has(t.id)) continue;
      const d = Math.hypot(p.pos.x - t.x, p.pos.z - t.z);
      if (d > t.r) continue;
      if (Math.abs(p.pos.y - t.y) > 3.5) continue;
      if (d < bestD) { bestD = d; active = t; }
    }

    // The boss fog gate fires on touch, not on a prompt — walking through a fog
    // gate IS the commitment, and asking for confirmation would break the moment.
    if (active && active.type === 'boss') {
      this.firedTriggers.add(active.id);
      this._beginBossFight(ctx);
      this.hud.prompt(null);
      this.promptTrigger = null;
      return;
    }

    if (active !== this.promptTrigger) {
      this.promptTrigger = active;
      this.hud.prompt(active ? `E — ${active.prompt}` : null);
    }

    if (active && ctx.input.consume('interact') && p.alive && p.state === 'idle') {
      this._fireTrigger(active, ctx);
    }
  }

  _fireTrigger(t, ctx) {
    if (t.type === 'checkpoint') {
      this.checkpoint = { x: t.x, y: t.y, z: t.z, yaw: this.player.yaw };
      this.checkpointId = t.id;
      this.player.hp = this.player.hpMax;
      this.player.stamina = this.player.staminaMax;
      this.player.flasks = this.player.flasksMax;
      this.audio.play('checkpoint', { pos: this.player.pos });
      this.fx.ember({ x: t.x, y: t.y + 2.4, z: t.z }, 26);
      this.hud.toast('The ember steadies. Ash-bound return.');
      this._resetEnemies();
      this.hud.prompt(null);
      this.promptTrigger = null;
    } else if (t.type === 'item') {
      this.taken.add(t.id);
      this.firedTriggers.add(t.id);
      this._applyItem(t.item);
      this.audio.play('pickup', { pos: this.player.pos });
      this.hud.itemGet(t.item.title, t.item.sub);
      this.fx.ember(this.player.pos, 22);
      const im = this.itemMeshes.find(m => m.item.id === t.item.id);
      if (im) { this.scene.remove(im.obj); }
      this.hud.prompt(null);
      this.promptTrigger = null;
    } else if (t.type === 'winch') {
      this.firedTriggers.add(t.id);
      this._openShortcut(t);
    }
  }

  _applyItem(item) {
    const p = this.player;
    if (item.kind === 'shard') {
      p.emberShards++;
    } else if (item.kind === 'vessel') {
      p.vessels = (p.vessels || 0) + 1;
      p.applyUpgrades();
      p.flasks = p.flasksMax;
    } else if (item.kind === 'plate') {
      p.ashplate++;
      p.applyUpgrades();
      p.hp = Math.min(p.hpMax, p.hp + 30);
    }
    p.applyUpgrades();
    this.hud.setStats?.({
      attack: Math.round(p.attackPower * 100) / 100,
      hp: p.hpMax,
      flasks: p.flasksMax,
    });
  }

  _openShortcut(t) {
    const gate = this.level.gates.find(g => g.id === 'shortcut');
    if (!gate || gate.open) return;
    gate.open = true;
    for (const w of gate.walls) w.off = true;
    this.audio.play('gate', { pos: this.player.pos });
    this.fx.dust({ x: gate.obj.position.x, y: 0.2, z: gate.obj.position.z }, 30);
    this.fx.shake(0.22, 0.7);
    this.hud.toast('Far off, a counterweight falls. The east bridge is open.');
    if (t.handle) t.handleSpin = true;
  }

  // --- boss -----------------------------------------------------------------

  _beginBossFight(ctx) {
    if (this.state === 'boss') return;
    this.state = 'boss';
    this.bossEverEngaged = true;
    this.boss.noLock = false;
    this.boss.begin();
    this.audio.music('boss1');
    this.musicState = 'boss1';
    this.audio.play('boss_roar', { pos: this.boss.pos });
    this.hud.toast('VOLGA, THE KILNWARDEN');
    this.fogGateHandle?.remove?.();
    this.fogGateHandle = null;
  }

  _updateBossFight(dt, ctx) {
    const b = this.boss;
    if (this.state !== 'boss') { this.hud.setBoss(null); return; }
    this.rules.chipThroughGuard = b.phase === 2 && b.alive;
    if (b.alive) {
      this.hud.setBoss({ name: b.name, subtitle: b.subtitle, hp: b.hp, maxHp: b.hpMax, phase: b.phase });
    }
    // Leaving the arena ends the encounter — but only after the player has
    // genuinely left and STAYED out. The original check reset the fight the
    // instant the player crossed a 30 m radius, which a few backsteps near the
    // entrance were enough to trigger mid-fight.
    if (b.alive && this.player.alive) {
      const d = Math.hypot(this.player.pos.x - this.level.arena.x, this.player.pos.z - this.level.arena.z);
      if (d > 38) {
        this._leaveTimer = (this._leaveTimer || 0) + dt;
        if (this._leaveTimer > 2.5) { this._leaveTimer = 0; this._resetBoss(); }
      } else {
        this._leaveTimer = 0;
      }
    }
  }

  onBossPhase(phase) {
    if (phase === 2) {
      this.hud.toast('THE KILN OPENS');
      this.musicState = 'boss2';
      // The transition has to be visible from across the arena, not just on the
      // boss's chest. Ramping the caldera light throws the floor orange and
      // backlights him, so the phase change reads at a glance even when the
      // burst VFX is behind him.
      this._glowRamp = 0;
    }
  }

  /** Eases the arena backlight to its phase-2 level over ~1.4s. */
  _updateArenaGlow(dt) {
    if (this._glowRamp === undefined || this._glowRamp >= 1) return;
    const g = this.level.arenaGlow;
    if (!g) { this._glowRamp = 1; return; }
    this._glowRamp = Math.min(1, this._glowRamp + dt / 1.4);
    const t = this._glowRamp * this._glowRamp * (3 - 2 * this._glowRamp);
    g.intensity = this.level.arenaGlowBase * (1 + t * 2.6);
    g.distance = 46 + t * 22;
  }

  onBossDefeated(boss) {
    this.state = 'victory';
    this.victoryTimer = 0;
    this.rules.chipThroughGuard = false;
    this.hud.setBoss(null);
    this.audio.music('victory');
    this.hud.itemGet("THE KILNWARDEN'S EMBER", 'The fire that outlived a kingdom');
    // The reward is real: it is the biggest single upgrade in the slice.
    this.player.emberShards += 2;
    this.player.applyUpgrades();
    this.hud.setStats?.({
      attack: Math.round(this.player.attackPower * 100) / 100,
      hp: this.player.hpMax, flasks: this.player.flasksMax,
    });
    // The world keeps burning past the arena — the last shot promises more game.
    this.fx.ember({ x: boss.pos.x, y: boss.pos.y + 2, z: boss.pos.z }, 60);
  }

  _resetBoss() {
    this.state = 'explore';
    this._leaveTimer = 0;
    this.boss.reset();
    this.boss.noLock = true;
    this.rules.chipThroughGuard = false;
    this.firedTriggers.delete('fog_gate');
    this.hud.setBoss(null);
    this.projectiles.clear();
    this.audio.music('ambient');
    this.musicState = 'ambient';
    // The boss goes back to phase 1, so the arena lighting must go back with it.
    if (this.level.arenaGlow) {
      this.level.arenaGlow.intensity = this.level.arenaGlowBase;
      this.level.arenaGlow.distance = 46;
    }
    this._glowRamp = undefined;
    if (!this.fogGateHandle) this._buildFogGate();
  }

  // --- death / respawn ------------------------------------------------------

  onPlayerDeath() {
    this.state = 'dead';
    this.deathTimer = 0;
    this.hud.setBoss(null);
    this.hud.setTarget(null);
    this.hud.prompt(null);
    setTimeout(() => { if (this.state === 'dead') this.hud.screen('death'); }, 900);
  }

  respawn() {
    this.hud.screen('none');
    this.state = 'explore';
    this.rules.chipThroughGuard = false;
    this.projectiles.clear();
    this.fx.reset?.();

    const c = this.checkpoint;
    this.player.respawn(c.x, c.y + 0.1, c.z, c.yaw ?? 0);
    this._resetEnemies();
    this.boss.reset();
    this.boss.noLock = true;
    if (!this.fogGateHandle) this._buildFogGate();
    this.firedTriggers.delete('fog_gate');

    this.audio.music('ambient');
    this.musicState = 'ambient';
    this.hud.toast('灰は灰へ  —  ash to ash');
  }

  _resetEnemies() {
    for (const e of this.enemies) e.reset();
    this.enemyDirector.reset();
    this.projectiles.clear();
  }

  // --- music ---------------------------------------------------------------

  _updateMusic(dt) {
    if (this.state === 'boss') {
      const want = this.boss.phase === 2 ? 'boss2' : 'boss1';
      if (this.musicState !== want) { this.musicState = want; this.audio.music(want); }
      return;
    }
    // Combat music engages when something is actually hunting the player.
    let inCombat = false;
    for (const e of this.enemies) {
      if (e.alive && e.awake && e.distanceTo(this.player) < 18) { inCombat = true; break; }
    }
    const want = inCombat ? 'combat' : 'ambient';
    if (this.musicState !== want) {
      this.musicState = want;
      this.audio.music(want);
    }
  }

  // --- queries used by main -------------------------------------------------

  get lockTargets() {
    const out = [];
    for (const e of this.enemies) if (e.alive && e.awake) out.push(e);
    if (this.boss.alive && this.boss.active) out.push(this.boss);
    return out;
  }

  /** Everything that can be hit by a sweep this step. */
  get hittable() {
    const out = [this.player];
    for (const e of this.enemies) if (e.alive) out.push(e);
    if (this.boss.alive && this.boss.active) out.push(this.boss);
    return out;
  }
}

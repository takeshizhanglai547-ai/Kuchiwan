// ============================================================
//  Mission — objectives, wave scripting, timer, win/lose rules,
//  radio chatter, result scoring.  [STUB — owned by mission agent]
//
//  CONTRACT
//    new Mission(ctx); .init(); .update(dt); .reset()
//    .objectives -> [{ id, text, state:'pending'|'active'|'done'|'failed', count, of }]
//    .timeLeft, .score, .phase
//    Emits 'objective' when an objective changes, 'hud' for radio lines,
//    and drives ctx.game.setState('win'|'lose').
// ============================================================
import { CFG } from '../config.js';

export class Mission {
  constructor(ctx) {
    this.ctx = ctx;
    this.objectives = [];
    this.timeLeft = CFG.MISSION.TIME_LIMIT;
    this.score = 0;
    this.phase = 0;
  }

  init() {
    this.ctx.bus.on('kill', () => { this.score += 100; });
  }

  reset() {
    this.timeLeft = CFG.MISSION.TIME_LIMIT;
    this.score = 0; this.phase = 0;
    this.objectives = [
      { id: 'destroy', text: 'DESTROY ALL HOSTILES', state: 'active', count: 0, of: 4 },
    ];
  }

  update(dt) {
    this.timeLeft -= dt;
    const enemies = this.ctx.enemies.alive();
    const o = this.objectives[0];
    if (o) o.count = o.of - enemies.length;
    if (!this.ctx.player.alive) { this.ctx.game.setState('lose'); return; }
    if (this.timeLeft <= 0) { this.ctx.game.setState('lose'); return; }
    if (enemies.length === 0 && this.ctx.time > 1) this.ctx.game.setState('win');
  }
}

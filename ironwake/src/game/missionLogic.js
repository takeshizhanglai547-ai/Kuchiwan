// src/game/missionLogic.js — the stage's objective state machine + rank. Pure (no DOM /
// three.js); unit-tested in tests/mission.test.mjs. Owner: mission/HUD designer.
//
// Stage "OPERATION IRONWAKE" — Halvard Deep Foundry, Pier 7 (single stage):
//   1) destroy the MT squad          (kill 5 'mt')
//   2) destroy 3 relay generators     (kill 3 'turret')
//   3) destroy the hostile frame      (kill 1 'boss')   -> MISSION COMPLETE
//   Player AP 0 -> MISSION FAILED ('destroyed'); optional time limit -> FAILED ('timeout').

export const STAGES = [
  { id: 'mt_squad', title: 'DESTROY THE MT SQUAD', jp: 'MT部隊を撃破せよ', target: 'mt', count: 5 },
  { id: 'relays', title: 'DESTROY RELAY GENERATORS', jp: '中継ジェネレーターを破壊せよ', target: 'turret', count: 3 },
  { id: 'boss', title: 'DESTROY RIVAL RIG "CINDERHOUND"', jp: '敵リグ「シンダーハウンド」を撃破せよ', target: 'boss', count: 1 },
];

export const RANK_TABLE = [['S', 85], ['A', 70], ['B', 55], ['C', 40], ['D', 0]];

/**
 * Score 0..100 from clear time, damage taken, repair kits used.
 *   time:   40 pts at <= parTime, linearly down to 0 at 3 * parTime
 *   damage: 40 pts at 0 damage, 0 at >= 1.5 * apMax
 *   kits:   20 pts minus 7 per kit used
 */
export function computeRank({ time, damageTaken, apMax, kitsUsed, parTime = 300 }) {
  const t = Math.max(0, Math.min(1, (time - parTime) / (2 * parTime)));
  const timeScore = 40 * (1 - t);
  const dmgScore = 40 * (1 - Math.max(0, Math.min(1, damageTaken / (1.5 * apMax))));
  const kitScore = Math.max(0, 20 - 7 * kitsUsed);
  const score = Math.round(timeScore + dmgScore + kitScore);
  let rank = 'D';
  for (const [r, min] of RANK_TABLE) if (score >= min) { rank = r; break; }
  return { score, rank, timeScore, dmgScore, kitScore };
}

export class MissionLogic {
  constructor({ stages = STAGES, timeLimit = 900, parTime = 300 } = {}) {
    this.stages = stages;
    this.timeLimit = timeLimit; // seconds; 0 = none
    this.parTime = parTime;
    this.reset();
  }

  reset() {
    this.stage = 0;
    this.progress = 0;
    this.status = 'active';      // 'active' | 'complete' | 'failed'
    this.failReason = '';
    this.time = 0;
    this.damageTaken = 0;
    this.kitsUsed = 0;
    this.kills = {};
  }

  get current() { return this.stages[this.stage] || null; }
  get active() { return this.status === 'active'; }

  tick(dt) {
    if (!this.active) return null;
    this.time += dt;
    if (this.timeLimit > 0 && this.time >= this.timeLimit) return this.fail('timeout');
    return null;
  }

  /** Record a kill. Returns an event {type:'progress'|'stage'|'complete', ...} or null. */
  onKill(type) {
    this.kills[type] = (this.kills[type] || 0) + 1;
    if (!this.active) return null;
    const cur = this.current;
    if (!cur || cur.target !== type) return null;
    this.progress++;
    if (this.progress < cur.count) return { type: 'progress', stage: this.stage, progress: this.progress, count: cur.count };
    this.stage++;
    this.progress = 0;
    if (this.stage >= this.stages.length) {
      this.status = 'complete';
      return { type: 'complete' };
    }
    return { type: 'stage', stage: this.stage, def: this.current };
  }

  onPlayerDestroyed() { return this.fail('destroyed'); }
  onDamageTaken(n) { if (this.active) this.damageTaken += n; }
  onRepairUsed() { if (this.active) this.kitsUsed++; }

  fail(reason) {
    if (!this.active) return null;
    this.status = 'failed';
    this.failReason = reason;
    return { type: 'failed', reason };
  }

  objective() {
    const c = this.current;
    if (!c) return { title: '', jp: '', progress: 0, count: 0 };
    return { title: c.title, jp: c.jp, progress: this.progress, count: c.count };
  }

  result(apMax) {
    const r = computeRank({ time: this.time, damageTaken: this.damageTaken, apMax, kitsUsed: this.kitsUsed, parTime: this.parTime });
    return {
      status: this.status, reason: this.failReason, time: this.time, damageTaken: this.damageTaken,
      kitsUsed: this.kitsUsed, kills: { ...this.kills },
      score: this.status === 'complete' ? r.score : 0,
      rank: this.status === 'complete' ? r.rank : '-',
      breakdown: r,
    };
  }
}

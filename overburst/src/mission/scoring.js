// ============================================================
//  mission/scoring.js — combat log, point score and the letter rank.
//  [owned by mission agent]
//
//  The result screen (ui/resultScreen.js) computes the DISPLAYED rank from
//  the HUD's own tally, so this reproduces that curve exactly against our
//  independently tracked numbers: mission.result.rank and the letter the
//  player reads can never disagree. On top of it we keep a real point
//  score with a breakdown, which is what `mission.score` reports.
//
//  Nothing here allocates per frame — compute() runs once, at mission end.
// ============================================================
import { CFG } from '../config.js';

const KILL_POINTS = {
  mt: CFG.ENEMY.MT.score,
  drone: CFG.ENEMY.DRONE.score,
  turret: CFG.ENEMY.TURRET.score,
  heli: CFG.ENEMY.HELI.score,
  pylon: CFG.ENEMY.PYLON.score,
  boss: CFG.ENEMY.BOSS.score,
};

export class Scoring {
  constructor() {
    this.reset();
  }

  reset() {
    this.dealt = 0;
    this.taken = 0;
    this.kills = 0;
    this.staggers = 0;
    this.killPoints = 0;
    this.pylons = 0;
    this.kits = 0;
    this.byKind = { mt: 0, drone: 0, turret: 0, heli: 0, pylon: 0, boss: 0 };
    this.live = 0;
  }

  // ---- live feeds (bus driven) --------------------------------
  damageDealt(n) { if (n > 0) { this.dealt += n; this._live(); } }
  damageTaken(n) { if (n > 0) { this.taken += n; this._live(); } }
  stagger() { this.staggers++; this._live(); }

  kill(kind) {
    this.kills++;
    const k = kind && this.byKind[kind] !== undefined ? kind : null;
    if (k) this.byKind[k]++;
    if (k === 'pylon') this.pylons++;
    this.killPoints += (k ? KILL_POINTS[k] : 100) || 100;
    this._live();
  }

  /** running score shown as mission.score while the sortie is in progress */
  _live() {
    this.live = Math.max(0, Math.round(
      this.killPoints
      + this.dealt * 0.05
      + this.staggers * 250
      - this.taken * 0.06,
    ));
  }

  // ---- final report -------------------------------------------
  /**
   * @param {boolean} win
   * @param {number} elapsed   seconds spent in the sortie
   * @param {number} timeLeft  seconds left on the clock
   * @param {number} kits      repair kits consumed
   * @param {string} reason    'boss' | 'timeout' | 'destroyed'
   */
  compute(win, elapsed, timeLeft, kits, reason) {
    this.kits = kits;
    const lim = CFG.MISSION.TIME_LIMIT || 600;
    const apMax = CFG.PLAYER.AP || 1;

    const timeBonus = win ? Math.round(Math.max(0, timeLeft) * 12) : 0;
    const kitCost = kits * 400;
    const damagePts = Math.round(this.dealt * 0.05);
    const staggerPts = this.staggers * 250;
    const takenPts = -Math.round(this.taken * 0.06);
    const score = Math.max(0, Math.round(
      this.killPoints + damagePts + staggerPts + timeBonus + takenPts - kitCost,
    ));

    // --- letter rank: identical curve to ui/resultScreen._rank ---
    let v = 0;
    v += Math.min(38, this.kills * 5.5);                                  // aggression
    v += Math.min(16, this.staggers * 3.2);                               // control
    v += Math.min(26, (1 - Math.min(1, this.taken / apMax)) * 26);        // survivability
    v += Math.min(20, (1 - Math.min(1, elapsed / lim)) * 20);             // speed
    v -= kits * 3;
    if (!win) v *= 0.42;
    const rank = v >= 88 ? 'S' : v >= 76 ? 'A' : v >= 60 ? 'B' : v >= 42 ? 'C' : v >= 22 ? 'D' : 'E';

    return {
      win,
      reason,
      rank,
      rating: Math.round(v),
      score,
      time: elapsed,
      timeLeft: Math.max(0, timeLeft),
      dealt: Math.round(this.dealt),
      taken: Math.round(this.taken),
      kills: this.kills,
      staggers: this.staggers,
      pylons: this.pylons,
      kits,
      byKind: this.byKind,
      breakdown: [
        ['TARGETS', this.killPoints],
        ['DAMAGE DEALT', damagePts],
        ['STAGGERS', staggerPts],
        ['TIME BONUS', timeBonus],
        ['DAMAGE TAKEN', takenPts],
        ['REPAIR KITS', -kitCost],
      ],
    };
  }
}

export default Scoring;

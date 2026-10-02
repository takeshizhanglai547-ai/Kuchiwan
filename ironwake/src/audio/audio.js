// src/audio/audio.js — WebAudio sound system (owner: audio designer).
//
// API (game.audio):
//   unlock()                            create/resume the AudioContext. Must run inside a user
//                                       gesture (menus call it on the first click / key). Until
//                                       then play() is a silent no-op (browser autoplay policy).
//   play(id, {pos?, volume?, pitch?})   one-shot. pos (any {x,y,z}) => 3D pan + distance model +
//                                       air absorption + distance reverb (+ speed-of-sound delay
//                                       for explosions) + line-of-sight OCCLUSION (raycast camera
//                                       -> source past 18 m: darker, quieter, wetter).
//                                       Ids: ARCHITECTURE §10 list + footstep(_steel), boost_ignite,
//                                       missile_lock, missile_alert, ap_warning, kill_confirm,
//                                       impact_metal/ground, ricochet, whiz, radio_open/close,
//                                       distant_clang (sfx.js).
//   loop(id, {volume?, pitch?})         looping variant -> {set({volume,pitch}), stop()}
//   radio(seconds, line?)               handler LEDGER comm transmission. `line` = RADIO key, a
//                                       line object {en} or its subtitle text; without it the line
//                                       is the briefing intel (state 'briefing') or the HUD's
//                                       current subtitle (.rd-en). Plays the recorded voice-over
//                                       (assets/audio/vo/radio_<key>.mp3, built offline by
//                                       assets/audio/build_vo.py: TTS + radio chain) through the
//                                       live comm dressing (static, squelch, RF crackle); a new
//                                       line cuts the previous one. Leaving the briefing / a
//                                       restart cuts it too. Unknown text -> procedural voice.
//   voDuration(line)                    seconds of the recorded line (0 if none) for subtitle sync
//   level()                             0..1 comm-voice level (for UI visualisers)
//   setVolume(0..1) / setMusicVolume(0..1) / stopAll()
//   unlocked (getter), debug()          state for tests / the debug overlay
// Driven automatically every frame (allocation-free): booster roar bed (pitch/filter by speed,
// AB flutter), servo whine from aim slew, footfalls on the rig's walk-cycle plants, boost
// ignition, the rival rig's own spatial booster, incoming-missile alarm, missile-lock pips,
// low-AP warning, Pier 7 ambience + distant foundry clangs, and the adaptive score (music.js:
// layers by game state / mission stage / boss / recent combat activity).
// From the projectile pool / events (no other lane has to call anything): bullet impacts on
// armour / ground / walls (+ ricochet whines), supersonic WHIZ-BYS of enemy rounds that pass
// the player's chest within 9 m, Doppler-shifted rocket-motor emitters on the nearest missiles,
// Doppler + air absorption + occlusion on the rival rig's boosters and enemy machinery loops.
// Mixer, voice limiting, ducking and reverb live in engine.js. Samples: a manifest entry
// 'sfx_<id>' (decoded on unlock) replaces the synth for that id.
import { AudioEngine, MIXER, airCutoff } from './engine.js';
import { makeRng } from './dsp.js';
import { jetTargets, makeJetTargets, dopplerRatio } from './beds.js';
import { makeHit } from '../core/physics.js';
import { VO_TABLE } from './vo_table.js';
import { COMM_BRIEF } from './voice.js';

// subtitle text -> VO key (whitespace / case-insensitive, so a re-flowed line still matches)
const normText = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
const VO_BY_TEXT = new Map(Object.keys(VO_TABLE).map((k) => [normText(VO_TABLE[k].en), k]));
const VO_WAIT_MS = 1500; // a line requested while its sample still decodes waits this long at most
const words = (s) => new Set(normText(s).replace(/[^a-z0-9' ]/g, ' ').split(' ').filter(Boolean));
const VO_WORDS = Object.keys(VO_TABLE).map((k) => [k, words(VO_TABLE[k].en)]);
/** Exact subtitle match, else the most similar recorded line (word Jaccard >= 0.5; a lightly
 *  edited subtitle keeps its voice until the VO is rebuilt), else null. */
function voByText(text) {
  const exact = VO_BY_TEXT.get(normText(text));
  if (exact) return exact;
  const w = words(text);
  let best = null, bestJ = 0.5;
  for (const [k, kw] of VO_WORDS) {
    let inter = 0;
    for (const x of w) if (kw.has(x)) inter++;
    const j = inter / (w.size + kw.size - inter || 1);
    if (j >= bestJ) { bestJ = j; best = k; }
  }
  return best;
}

/** Game-side tunables. */
export const AUDIO_GAME = {
  musicFade: { title: 3, briefing: 2.5, explore: 4, combat: 1.2, explore2: 4, combat2: 1.2, boss: 1.4, aftermath: 3, silent: 1 },
  activityHold: 9,            // s of no firing / hits before the score relaxes to 'explore'
  missileAlertEvery: 0.36,
  lowAp: { frac: 0.25, every: 2.8 },
  clangEvery: [5, 12],        // s between distant foundry clangs
  aftermathAfter: 5.5,        // s after complete/failed before the bed returns
  occlusion: { from: 18, lift: 1.5, stop: 3 }, // LOS test only past `from` m; target lifted / ray stopped short
  whiz: { radius: 9, minDist: 0.9 },           // enemy rounds passing within radius of the player's chest
  ricochetChance: 0.3,        // wall hits (not ground) that also whine off
  bossDoppler: [0.8, 1.3],
  steelAbove: 0.6,            // m: rig feet above the ground slab -> steel-deck footfalls
};
const RAY_OPTS = { ground: true }; // terrain occludes too

export default function audioSystem(game) {
  let ctx = null, E = null;
  const rng = makeRng(0x5EED);
  const jt = makeJetTargets(), bjt = makeJetTargets();
  const clangPos = { x: 0, y: 0, z: 0 };
  // scratch (allocation-free per frame / per play)
  const losHit = makeHit();
  const losO = { x: 0, y: 0, z: 0 }, losD = { x: 0, y: 0, z: 0 }, whizP = { x: 0, y: 0, z: 0 };
  const po = { pos: null, volume: undefined, pitch: undefined, occl: 0 }; // play() opts copy (callers reuse theirs)
  const pRec = new Map(); // projectile pool item -> {x,y,z, ox,oz, done} (created once per pool item)
  const nearR = new Array(MIXER.rockets).fill(null), nearRD = new Float32Array(MIXER.rockets);
  let occlSlot = 0;
  const mview = { mode: 'idle', speedH: 0, vy: 0, abCharging: false, abCharge: 0, skid: 0 }; // reused motor view
  let st = null;
  let visHandler = null, resumeOnShow = false;
  const decoding = new Map(); // sample id -> decode promise (radio lines may arrive mid-decode)
  let radioToken = 0;

  function motorView(m) {
    mview.mode = m.mode; mview.speedH = m.speedH; mview.vy = m.vel ? m.vel.y : 0;
    mview.abCharging = !!m.abCharging; mview.abCharge = m.abCharge || 0; mview.skid = m.skid || 0;
    return mview;
  }
  function resetState() {
    st = {
      lastAimYaw: null, slew: 0, stepIdx: null, lastMode: 'idle', missileNext: 0, lockCount: 0, apNext: 0, bossOccl: 0,
      activity: -99, stage: 0, ended: false, endT: 0, boss: null, clangNext: ctx ? ctx.currentTime + 3 : 0, paused: false,
    };
  }
  resetState();
  const running = () => !!ctx && ctx.state === 'running';

  // ---------------------------------------------------------------- per-frame drivers
  function desiredMusic(now) {
    const s = game.state;
    if (s === 'title' || s === 'boot') return 'title';
    if (s === 'briefing') return 'briefing';
    if (st.ended || s === 'results') return now - st.endT > AUDIO_GAME.aftermathAfter ? 'aftermath' : 'silent';
    const busy = game.rawTime - st.activity < AUDIO_GAME.activityHold;
    const stage = game.mission && game.mission.logic ? game.mission.logic.stage : st.stage;
    if (stage >= 2) return 'boss';
    if (stage >= 1) return busy ? 'combat2' : 'explore2';
    return busy ? 'combat' : 'explore';
  }

  /** Crossfade the score to the state the game is in (frame + every relevant event). */
  function syncMusic() {
    if (!E) return;
    const want = desiredMusic(ctx.currentTime);
    if (want !== E.music.state) E.music.setState(want, AUDIO_GAME.musicFade[want] || 2);
  }

  function silence(x) { x.roar = x.hiss = x.turb = x.whine = x.wind = x.rumble = 0; return x; }

  function updatePlayer(now, realDt) {
    const p = game.player;
    if (!(game.state === 'playing' && p && p.alive && p.motor)) {
      E.jet.set(silence(jt), now, game.state === 'paused' ? 0.05 : 0.25);
      E.servo.set(0, 0, now);
      st.stepIdx = null;
      return;
    }
    const m = p.motor;
    E.jet.set(jetTargets(motorView(m), jt), now, m.mode === 'qb' ? 0.03 : 0.08);
    // servo whine from the aim slew rate (rad/s), plus a little while walking
    const ctl = p.controller;
    if (ctl && typeof ctl.aimYaw === 'number') {
      if (st.lastAimYaw !== null && realDt > 0) {
        let d = ctl.aimYaw - st.lastAimYaw;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        const w = Math.min(8, Math.abs(d) / Math.max(1 / 240, realDt));
        st.slew += (w - st.slew) * Math.min(1, realDt * 12);
      }
      st.lastAimYaw = ctl.aimYaw;
    }
    const walk = m.mode === 'walk' ? 0.35 : 0;
    E.servo.set(Math.min(1, st.slew / 3.5 + walk), Math.min(1, st.slew / 6 + walk * 0.4), now);
    // footfalls: a foot plants every half walk cycle (rigmotion phase); fallback by speed
    const mo = p.rig && p.rig.motion;
    if (m.mode === 'walk' && m.grounded !== false) {
      const ph = mo && typeof mo.walkPhase === 'number' ? mo.walkPhase : game.rawTime * (m.speedH || 0) * 0.9;
      const idx = Math.floor(ph / Math.PI);
      if (st.stepIdx !== null && idx !== st.stepIdx) {
        po.pos = p.pos; po.occl = 0; po.pitch = undefined; po.volume = 0.65 + 0.35 * Math.min(1, (mo && mo.walkAmt) || 1);
        // standing on a structure (container stacks, gantry decks, the carrier) = steel, else slab
        E.play(p.pos.y > AUDIO_GAME.steelAbove ? 'footstep_steel' : 'footstep', po);
      }
      st.stepIdx = idx;
    } else st.stepIdx = null;
    if (m.mode === 'boost' && (st.lastMode === 'walk' || st.lastMode === 'idle')) { po.pos = p.pos; po.occl = 0; po.volume = po.pitch = undefined; E.play('boost_ignite', po); }
    st.lastMode = m.mode;
  }

  // ---------------------------------------------------------------- occlusion
  /** 1 if static geometry blocks the camera -> p line (past AUDIO_GAME.occlusion.from), else 0. */
  function occlusionAt(p, d) {
    const O = AUDIO_GAME.occlusion;
    if (!game.physics || d < O.from) return 0;
    losO.x = E.lx; losO.y = E.ly; losO.z = E.lz;
    const dx = p.x - E.lx, dy = p.y + O.lift - E.ly, dz = p.z - E.lz;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    losD.x = dx / len; losD.y = dy / len; losD.z = dz / len;
    return game.physics.raycast(losO, losD, Math.max(0, len - O.stop), losHit, RAY_OPTS) ? 1 : 0;
  }
  /** play() with line-of-sight occlusion; never mutates the caller's (often reused) opts. */
  function playAt(id, opts) {
    if (!opts || !opts.pos) return E.play(id, opts);
    po.pos = opts.pos; po.volume = opts.volume; po.pitch = opts.pitch;
    po.occl = occlusionAt(opts.pos, E.dist(opts.pos));
    return E.play(id, po);
  }
  /** Distance + occlusion low-pass for a looping 3D emitter (occlusion re-tested round-robin). */
  function emitterLP(slot, p, now, test) {
    const d = E.dist(p);
    if (test) slot.occl = occlusionAt(p, d);
    slot.lp.frequency.setTargetAtTime(airCutoff(d, slot.occl || 0), now, 0.12);
  }

  // ---------------------------------------------------------------- bullet impacts
  function onImpact(e) {
    if (!running() || game.state !== 'playing') return;
    const d = e.def;
    if (!d || d.splashRadius) return;               // explosions are played by projectiles.js
    const pt = e.point, energy = d.projectile === 'energy';
    if (e.actor) {
      const onPlayer = e.actor === game.player;      // damage_taken already plays (player.js)
      po.pos = pt; po.occl = 0; po.volume = onPlayer ? 0.55 : 1; po.pitch = energy ? 0.62 : undefined;
      E.play('impact_metal', po);
    } else {
      po.pos = pt; po.volume = 0.9; po.pitch = energy ? 1.35 : undefined;
      po.occl = occlusionAt(pt, E.dist(pt));
      E.play('impact_ground', po);
      if (!energy && pt.y > 1.5 && rng() < AUDIO_GAME.ricochetChance) { po.volume = 1; po.pitch = undefined; E.play('ricochet', po); }
    }
  }

  // ---------------------------------------------------------------- projectile scan
  // One pass over the live projectile pool per frame (allocation-free after warm-up):
  //  * enemy rounds crossing the plane through the player's chest within AUDIO_GAME.whiz.radius
  //    -> 'whiz' at the crossing point (supersonic snap + air tear)
  //  * the nearest missiles in flight -> pooled rocket emitters with Doppler
  function scanProjectiles(now) {
    const pr = game.projectiles, R = E.rockets, NR = R.length;
    for (let i = 0; i < NR; i++) { nearR[i] = null; nearRD[i] = 1e9; }
    const list = pr && pr.activeList && game.state === 'playing' ? pr.activeList() : null;
    const n = list ? pr.activeCount() : 0;
    const pl = game.player;
    const cx = pl ? pl.pos.x : 0, cy = pl ? pl.pos.y + (pl.aimHeight || 5) * 0.8 : 0, cz = pl ? pl.pos.z : 0;
    const W = AUDIO_GAME.whiz;
    for (let k = 0; k < n; k++) {
      const p = list[k];
      if (p.kind === 'missile') {
        const d = E.dist(p.pos);
        if (d < MIXER.rocketRange && d < nearRD[NR - 1]) {
          let j = NR - 1;
          while (j > 0 && nearRD[j - 1] > d) { nearRD[j] = nearRD[j - 1]; nearR[j] = nearR[j - 1]; j--; }
          nearRD[j] = d; nearR[j] = p;
        }
        continue;
      }
      if (!pl || !pl.alive || p.team === 'player' || (p.kind !== 'bullet' && p.kind !== 'energy')) continue;
      let r = pRec.get(p);
      if (!r) pRec.set(p, r = { x: 0, y: 0, z: 0, ox: NaN, oz: NaN, done: false }); // once per pool item
      if (r.ox !== p.origin.x || r.oz !== p.origin.z) { // a new life of this pool item
        r.ox = p.origin.x; r.oz = p.origin.z; r.done = false;
        r.x = p.origin.x; r.y = p.origin.y; r.z = p.origin.z;
      }
      if (!r.done) {
        const vx = p.vel.x, vy = p.vel.y, vz = p.vel.z, vl = Math.sqrt(vx * vx + vy * vy + vz * vz) || 1;
        const a0 = ((r.x - cx) * vx + (r.y - cy) * vy + (r.z - cz) * vz) / vl;
        const a1 = ((p.pos.x - cx) * vx + (p.pos.y - cy) * vy + (p.pos.z - cz) * vz) / vl;
        if (a0 < 0 && a1 >= 0) { // crossed the chest plane since the last frame
          const s = -a0 / (a1 - a0);
          whizP.x = r.x + (p.pos.x - r.x) * s; whizP.y = r.y + (p.pos.y - r.y) * s; whizP.z = r.z + (p.pos.z - r.z) * s;
          const dd = Math.hypot(whizP.x - cx, whizP.y - cy, whizP.z - cz);
          if (dd < W.radius && dd > W.minDist) {
            po.pos = whizP; po.occl = 0; po.volume = Math.sqrt(1 - dd / W.radius); po.pitch = p.kind === 'energy' ? 0.55 : undefined;
            E.play('whiz', po);
          }
          r.done = true;
        }
      }
      r.x = p.pos.x; r.y = p.pos.y; r.z = p.pos.z;
    }
    for (let i = 0; i < NR; i++) {
      const slot = R[i], p = nearR[i];
      if (!p) { if (slot.p) slot.rk.set(0, 1, now); slot.p = null; continue; }
      const jump = slot.p !== p;
      slot.p = p;
      AudioEngine.setPos(slot.pan, p.pos.x, p.pos.y, p.pos.z, jump ? null : now, 0.02);
      slot.rk.set(p.team === 'player' ? 0.8 : 1, dopplerRatio(p.pos.x, p.pos.y, p.pos.z, p.vel.x, p.vel.y, p.vel.z, E.lx, E.ly, E.lz), now);
      emitterLP(slot, p.pos, now, false);
    }
  }

  function updateBoss(now) {
    const b = st.boss;
    if (!(b && b.alive && b.motor && game.state === 'playing')) { E.bossJet.set(silence(bjt), now, 0.2); return; }
    jetTargets(motorView(b.motor), bjt);
    bjt.wind = 0;
    // Doppler on the rival rig's boosters (QB / AB passes), plus air absorption + occlusion
    const v = b.vel || b.motor.vel;
    if (v) {
      const lo = AUDIO_GAME.bossDoppler[0], hi = AUDIO_GAME.bossDoppler[1];
      const k = Math.min(hi, Math.max(lo, dopplerRatio(b.pos.x, b.pos.y, b.pos.z, v.x, v.y, v.z, E.lx, E.ly, E.lz)));
      bjt.turbF *= k; bjt.whineF *= k; bjt.roarCut *= k;
    }
    E.bossJet.set(bjt, now, 0.08);
    AudioEngine.setPos(E.bossPan, b.pos.x, b.pos.y + 5, b.pos.z, now);
    E.bossLP.frequency.setTargetAtTime(airCutoff(E.dist(b.pos), st.bossOccl), now, 0.12);
  }

  // nearest-N enemy machinery loops + walker footfalls (allocation-free selection)
  const MIXER_EMIT_RANGE = MIXER.emitRange;
  const near = new Array(MIXER.emitters).fill(null), nearD = new Float32Array(MIXER.emitters);
  const stride = new WeakMap(); // enemy -> {acc: metres walked since the last footfall}
  function updateEnemies(now, realDt) {
    const list = game.enemies && game.enemies.list;
    const N = E.emitters.length;
    for (let i = 0; i < N; i++) { near[i] = null; nearD[i] = 1e9; }
    if (list && game.state === 'playing') {
      for (let k = 0; k < list.length; k++) {
        const e = list[k];
        if (!e.alive || e.type === 'boss' || !e.pos) continue;
        const d = E.dist(e.pos);
        if (d > MIXER_EMIT_RANGE) continue;
        if (d < nearD[N - 1]) {
          let j = N - 1;
          while (j > 0 && nearD[j - 1] > d) { nearD[j] = nearD[j - 1]; near[j] = near[j - 1]; j--; }
          nearD[j] = d; near[j] = e;
        }
        // walker footfalls (5 m walkers: lighter, quicker steps than the rig)
        if (e.type === 'mt' && e.vel) {
          let w = stride.get(e);
          if (!w) stride.set(e, w = { acc: 0 }); // once per walker, updated in place
          const sp = Math.hypot(e.vel.x, e.vel.z);
          w.acc += sp * realDt;
          if (w.acc > 3.2) { w.acc = 0; if (sp > 2 && d < 90) { po.pos = e.pos; po.pitch = 1.35; po.volume = 0.6; po.occl = occlusionAt(e.pos, d); E.play('footstep', po); } }
        }
      }
    }
    for (let i = 0; i < N; i++) {
      const slot = E.emitters[i], e = near[i];
      if (!e) { slot.em.set(null, 0, 0, now); slot.actor = null; continue; }
      const jump = slot.actor !== e;
      slot.actor = e;
      AudioEngine.setPos(slot.pan, e.pos.x, e.pos.y + (e.type === 'drone' ? 0 : 3), e.pos.z, jump ? null : now);
      emitterLP(slot, e.pos, now, jump || occlSlot % N === i);
      const sp = e.vel ? Math.hypot(e.vel.x, e.vel.y, e.vel.z) : 0;
      slot.em.set(e.type === 'drone' || e.type === 'mt' || e.type === 'turret' ? e.type : null, e.type === 'mt' ? Math.min(1, 0.45 + sp / 25) : 1, sp, now);
    }
  }

  function updateAlerts(now) {
    if (game.state !== 'playing') return;
    const pr = game.projectiles;
    const inc = pr ? pr.incomingMissiles || 0 : 0;
    if (inc > 0 && now >= st.missileNext) { E.play('missile_alert'); st.missileNext = now + AUDIO_GAME.missileAlertEvery * (inc > 2 ? 0.75 : 1); }
    const lk = game.lockon;
    const n = lk && lk.missileLocks ? lk.missileLocks.length : 0;
    if (n > st.lockCount) E.play('missile_lock');
    st.lockCount = n;
    const p = game.player;
    if (p && p.alive && p.apMax && p.ap / p.apMax < AUDIO_GAME.lowAp.frac && now >= st.apNext) {
      E.play('ap_warning'); st.apNext = now + AUDIO_GAME.lowAp.every;
    }
  }

  function updateAmbience(now) {
    const s = game.state;
    if ((s !== 'playing' && s !== 'title' && s !== 'briefing') || now < st.clangNext || !game.camera) return;
    const [a, b] = AUDIO_GAME.clangEvery;
    st.clangNext = now + a + rng() * (b - a);
    const e = game.camera.matrixWorld.elements;
    const ang = rng() * Math.PI * 2, d = 160 + rng() * 220;
    clangPos.x = e[12] + Math.cos(ang) * d; clangPos.y = 20 + rng() * 40; clangPos.z = e[14] + Math.sin(ang) * d;
    po.pos = clangPos; po.volume = 0.8; po.pitch = undefined; po.occl = 0;
    E.play('distant_clang', po);
  }

  // ---------------------------------------------------------------- comm voice-over
  /** VO_TABLE key for a radio request (see radio() in the header), or null. */
  function voKey(line) {
    if (line && typeof line === 'object') line = line.en;
    if (typeof line === 'string') return VO_TABLE[line] ? line : voByText(line);
    if (game.state === 'briefing') return VO_TABLE.brief ? 'brief' : null;
    const root = game.hud && game.hud.root;
    const el = root && root.querySelector ? root.querySelector('.rd-en') : null;
    return el ? voByText(el.textContent) : null;
  }
  function transmit(seconds, key) {
    const id = key ? VO_TABLE[key].id : null;
    const buf = id ? E.samples.get(id) || null : null;
    E.radio(seconds * 0.85, undefined, buf, key === 'brief' ? COMM_BRIEF : undefined);
  }

  // ---------------------------------------------------------------- system
  const api = {
    name: 'audio',
    order: 950,
    get unlocked() { return running(); },
    init(g) {
      g.audio = api;
      g.events.on('game:state', (e) => {
        st.paused = e.to === 'paused';
        if (!E) return;
        E.setPaused(st.paused);
        // the briefing intel belongs to the briefing screen; title / menus end any transmission
        if (e.from === 'briefing' || e.to === 'title' || e.to === 'briefing') { radioToken++; E.cutRadio(); }
        syncMusic();
      });
      g.events.on('session:start', () => resetState());
      g.events.on('mission:stage', (e) => { st.stage = e.stage; st.activity = game.rawTime; syncMusic(); });
      g.events.on('mission:complete', () => { st.ended = true; st.endT = ctx ? ctx.currentTime : 0; });
      g.events.on('mission:failed', () => { st.ended = true; st.endT = ctx ? ctx.currentTime : 0; });
      g.events.on('weapon:fired', () => { st.activity = game.rawTime; });
      g.events.on('actor:hit', () => { st.activity = game.rawTime; });
      g.events.on('enemy:spawned', (e) => { if (e && e.type === 'boss') st.boss = e.enemy; });
      g.events.on('boss:intro', (e) => { if (e && e.boss) st.boss = e.boss; if (running()) E.play('boss_stinger'); });
      g.events.on('weapon:reloaded', (e) => { if (running() && e.owner === game.player && game.player) { po.pos = game.player.pos; po.volume = po.pitch = undefined; po.occl = 0; E.play('reload', po); } });
      g.events.on('actor:killed', (e) => { if (running() && e.team === 'enemy' && e.by === game.player) E.play('kill_confirm'); });
      g.events.on('projectile:impact', onImpact);
      visHandler = () => {
        if (!ctx) return;
        if (document.hidden) { resumeOnShow = ctx.state === 'running'; if (resumeOnShow) ctx.suspend(); }
        else if (resumeOnShow) ctx.resume();
      };
      document.addEventListener('visibilitychange', visHandler);
    },
    reset() {
      resetState();
      if (E) { E.stopAll(10); E.cutRadio(); } // keep the stingers, cut everything else on restart
      radioToken++;
    },
    unlock() {
      try {
        if (!ctx) {
          const AC = window.AudioContext || window.webkitAudioContext;
          if (!AC) return;
          ctx = new AC({ latencyHint: 'interactive' });
          E = new AudioEngine(ctx);
          st.clangNext = ctx.currentTime + 3;
          syncMusic();
          const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
          if (OAC) E.renderAll(OAC, () => new Promise((res) => setTimeout(res, 0)))
            .catch((err) => console.warn('[audio] offline render failed; live synthesis only:', err && err.message));
          const man = game.assets && game.assets.manifest;
          if (man) for (const id in man) {
            if (!id.startsWith('sfx_')) continue;
            const sid = id.slice(4);
            decoding.set(sid, game.assets.arrayBuffer(id).then((buf) => buf && ctx.decodeAudioData(buf.slice(0)))
              .then((ab) => { if (ab && E) E.samples.set(sid, ab); })
              .catch((e) => console.warn(`[audio] decode failed for ${id}`, e))
              .finally(() => decoding.delete(sid)));
          }
        }
        if (ctx.state === 'suspended') ctx.resume();
      } catch (err) {
        console.warn('[audio] unavailable:', err && err.message);
      }
    },
    play(id, opts) { if (running()) playAt(id, opts); },
    loop(id, opts) { return running() ? E.loop(id, opts) : { set() {}, stop() {} }; },
    radio(seconds = 3, line) {
      if (!running()) return;
      const key = voKey(line);
      const id = key ? VO_TABLE[key].id : null;
      const tok = ++radioToken;
      if (id && !E.samples.has(id) && decoding.has(id)) {
        // first gesture -> briefing opens within milliseconds of unlock(): wait for the decode
        const st0 = game.state;
        Promise.race([decoding.get(id), new Promise((res) => setTimeout(res, VO_WAIT_MS))])
          .then(() => { if (tok === radioToken && E && running() && game.state === st0) transmit(seconds, key); });
        return;
      }
      transmit(seconds, key);
    },
    voDuration(line) { const k = voKey(line); return k ? VO_TABLE[k].dur : 0; },
    level() { return E ? E.level() : 0; },
    setVolume(v) { if (E) E.setVolume(v); },
    setMusicVolume(v) { if (E) E.setMusicVolume(v); },
    setListener() { if (E && game.camera) E.setListenerMatrix(game.camera.matrixWorld.elements); },
    stopAll() { if (E) E.stopAll(); },
    debug() { return E ? E.debug() : { state: 'locked', voices: 0, bank: 0, musicLayers: 0 }; },

    frame(alpha, realDt) {
      if (!running()) return;
      const now = ctx.currentTime;
      // the camera system placed the camera this frame but the renderer refreshes matrixWorld
      // only after every system's frame(): refresh it so the listener is not a frame late
      if (game.camera) { game.camera.updateMatrixWorld(); E.setListenerMatrix(game.camera.matrixWorld.elements); }
      updatePlayer(now, realDt || 1 / 60);
      occlSlot++;
      if (st.boss && st.boss.alive && occlSlot % 8 === 0) st.bossOccl = occlusionAt(st.boss.pos, E.dist(st.boss.pos));
      updateBoss(now);
      updateEnemies(now, realDt || 1 / 60);
      scanProjectiles(now);
      updateAlerts(now);
      updateAmbience(now);
      syncMusic();
    },

    dispose() {
      if (visHandler) document.removeEventListener('visibilitychange', visHandler);
      if (E) E.dispose();
      if (ctx) ctx.close();
      pRec.clear();
      ctx = null; E = null;
    },
  };
  return api;
}

// src/audio/audio.js — WebAudio sound system (owner: audio designer).
//
// API (game.audio):
//   unlock()                            create/resume the AudioContext. Must run inside a user
//                                       gesture (menus call it on the first click / key). Until
//                                       then play() is a silent no-op (browser autoplay policy).
//   play(id, {pos?, volume?, pitch?})   one-shot. pos (any {x,y,z}) => 3D pan + distance model +
//                                       air absorption + distance reverb (+ speed-of-sound delay
//                                       for explosions). Ids: ARCHITECTURE §10 list + footstep,
//                                       boost_ignite, missile_lock, missile_alert, ap_warning,
//                                       kill_confirm, radio_open/close, distant_clang (sfx.js).
//   loop(id, {volume?, pitch?})         looping variant -> {set({volume,pitch}), stop()}
//   radio(seconds)                      handler LEDGER comm transmission (procedural voice)
//   level()                             0..1 comm-voice level (for UI visualisers)
//   setVolume(0..1) / setMusicVolume(0..1) / stopAll()
//   unlocked (getter), debug()          state for tests / the debug overlay
// Driven automatically every frame (allocation-free): booster roar bed (pitch/filter by speed,
// AB flutter), servo whine from aim slew, footfalls on the rig's walk-cycle plants, boost
// ignition, the rival rig's own spatial booster, incoming-missile alarm, missile-lock pips,
// low-AP warning, Pier 7 ambience + distant foundry clangs, and the adaptive score (music.js:
// layers by game state / mission stage / boss / recent combat activity).
// Mixer, voice limiting, ducking and reverb live in engine.js. Samples: a manifest entry
// 'sfx_<id>' (decoded on unlock) replaces the synth for that id.
import { AudioEngine, MIXER } from './engine.js';
import { makeRng } from './dsp.js';
import { jetTargets, makeJetTargets } from './beds.js';

/** Game-side tunables. */
export const AUDIO_GAME = {
  musicFade: { title: 3, briefing: 2.5, explore: 4, combat: 1.2, explore2: 4, combat2: 1.2, boss: 1.4, aftermath: 3, silent: 1 },
  activityHold: 9,            // s of no firing / hits before the score relaxes to 'explore'
  missileAlertEvery: 0.36,
  lowAp: { frac: 0.25, every: 2.8 },
  clangEvery: [5, 12],        // s between distant foundry clangs
  aftermathAfter: 5.5,        // s after complete/failed before the bed returns
};

export default function audioSystem(game) {
  let ctx = null, E = null;
  const rng = makeRng(0x5EED);
  const jt = makeJetTargets(), bjt = makeJetTargets();
  const clangPos = { x: 0, y: 0, z: 0 };
  const mview = { mode: 'idle', speedH: 0, vy: 0, abCharging: false, abCharge: 0, skid: 0 }; // reused motor view
  let st = null;
  let visHandler = null, resumeOnShow = false;

  function motorView(m) {
    mview.mode = m.mode; mview.speedH = m.speedH; mview.vy = m.vel ? m.vel.y : 0;
    mview.abCharging = !!m.abCharging; mview.abCharge = m.abCharge || 0; mview.skid = m.skid || 0;
    return mview;
  }
  function resetState() {
    st = {
      lastAimYaw: null, slew: 0, stepIdx: null, lastMode: 'idle', missileNext: 0, lockCount: 0, apNext: 0,
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
      if (st.stepIdx !== null && idx !== st.stepIdx) E.play('footstep', { pos: p.pos, volume: 0.65 + 0.35 * Math.min(1, (mo && mo.walkAmt) || 1) });
      st.stepIdx = idx;
    } else st.stepIdx = null;
    if (m.mode === 'boost' && (st.lastMode === 'walk' || st.lastMode === 'idle')) E.play('boost_ignite', { pos: p.pos });
    st.lastMode = m.mode;
  }

  function updateBoss(now) {
    const b = st.boss;
    if (!(b && b.alive && b.motor && game.state === 'playing')) { E.bossJet.set(silence(bjt), now, 0.2); return; }
    jetTargets(motorView(b.motor), bjt);
    bjt.wind = 0;
    E.bossJet.set(bjt, now, 0.08);
    AudioEngine.setPos(E.bossPan, b.pos.x, b.pos.y + 5, b.pos.z, now);
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
          if (w.acc > 3.2) { w.acc = 0; if (sp > 2 && d < 90) E.play('footstep', { pos: e.pos, pitch: 1.35, volume: 0.6 }); }
        }
      }
    }
    for (let i = 0; i < N; i++) {
      const slot = E.emitters[i], e = near[i];
      if (!e) { slot.em.set(null, 0, 0, now); slot.actor = null; continue; }
      const jump = slot.actor !== e;
      slot.actor = e;
      AudioEngine.setPos(slot.pan, e.pos.x, e.pos.y + (e.type === 'drone' ? 0 : 3), e.pos.z, jump ? null : now);
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
    E.play('distant_clang', { pos: clangPos, volume: 0.8 });
  }

  // ---------------------------------------------------------------- system
  const api = {
    name: 'audio',
    order: 950,
    get unlocked() { return running(); },
    init(g) {
      g.audio = api;
      g.events.on('game:state', (e) => { st.paused = e.to === 'paused'; if (E) { E.setPaused(st.paused); syncMusic(); } });
      g.events.on('session:start', () => resetState());
      g.events.on('mission:stage', (e) => { st.stage = e.stage; st.activity = game.rawTime; syncMusic(); });
      g.events.on('mission:complete', () => { st.ended = true; st.endT = ctx ? ctx.currentTime : 0; });
      g.events.on('mission:failed', () => { st.ended = true; st.endT = ctx ? ctx.currentTime : 0; });
      g.events.on('weapon:fired', () => { st.activity = game.rawTime; });
      g.events.on('actor:hit', () => { st.activity = game.rawTime; });
      g.events.on('enemy:spawned', (e) => { if (e && e.type === 'boss') st.boss = e.enemy; });
      g.events.on('boss:intro', (e) => { if (e && e.boss) st.boss = e.boss; if (running()) E.play('boss_stinger'); });
      g.events.on('weapon:reloaded', (e) => { if (running() && e.owner === game.player && game.player) E.play('reload', { pos: game.player.pos }); });
      g.events.on('actor:killed', (e) => { if (running() && e.team === 'enemy' && e.by === game.player) E.play('kill_confirm'); });
      visHandler = () => {
        if (!ctx) return;
        if (document.hidden) { resumeOnShow = ctx.state === 'running'; if (resumeOnShow) ctx.suspend(); }
        else if (resumeOnShow) ctx.resume();
      };
      document.addEventListener('visibilitychange', visHandler);
    },
    reset() {
      resetState();
      if (E) E.stopAll(10); // keep the stingers, cut everything else on restart
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
            game.assets.arrayBuffer(id).then((buf) => buf && ctx.decodeAudioData(buf.slice(0)))
              .then((ab) => { if (ab) E.samples.set(id.slice(4), ab); })
              .catch((e) => console.warn(`[audio] decode failed for ${id}`, e));
          }
        }
        if (ctx.state === 'suspended') ctx.resume();
      } catch (err) {
        console.warn('[audio] unavailable:', err && err.message);
      }
    },
    play(id, opts) { if (running()) E.play(id, opts); },
    loop(id, opts) { return running() ? E.loop(id, opts) : { set() {}, stop() {} }; },
    radio(seconds = 3) { if (running()) E.radio(seconds * 0.85); },
    level() { return E ? E.level() : 0; },
    setVolume(v) { if (E) E.setVolume(v); },
    setMusicVolume(v) { if (E) E.setMusicVolume(v); },
    setListener() { if (E && game.camera) E.setListenerMatrix(game.camera.matrixWorld.elements); },
    stopAll() { if (E) E.stopAll(); },
    debug() { return E ? E.debug() : { state: 'locked', voices: 0, bank: 0, musicLayers: 0 }; },

    frame(alpha, realDt) {
      if (!running()) return;
      const now = ctx.currentTime;
      if (game.camera) E.setListenerMatrix(game.camera.matrixWorld.elements);
      updatePlayer(now, realDt || 1 / 60);
      updateBoss(now);
      updateEnemies(now, realDt || 1 / 60);
      updateAlerts(now);
      updateAmbience(now);
      syncMusic();
    },

    dispose() {
      if (visHandler) document.removeEventListener('visibilitychange', visHandler);
      if (E) E.dispose();
      if (ctx) ctx.close();
      ctx = null; E = null;
    },
  };
  return api;
}

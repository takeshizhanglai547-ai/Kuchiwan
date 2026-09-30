// src/audio/audio.js — WebAudio sound system (owner: audio designer). PLACEHOLDER synth.
//
// API (game.audio):
//   unlock()                        create/resume the AudioContext (call from a user gesture;
//                                   menus do this on the first click/key). Before that, play()
//                                   is a silent no-op — browsers forbid autoplay.
//   play(id, {pos?, volume?, pitch?})   one-shot; pos (Vector3) => distance attenuation
//   setVolume(0..1)
//   stopAll()
// Continuous engine sounds (boost / assault boost hum) are driven automatically from the
// player's motor state in frame().
//
// SOUND IDS used by gameplay (keep them; replace the synth with samples by adding manifest
// entries 'sfx_<id>' — they are decoded on unlock and take priority over the synth):
//   rifle, enemy_gun, enemy_laser, blade, blade_hit, missile_launch, cannon,
//   explosion_small, explosion_large, hit_confirm, damage_taken, stagger,
//   qb, jump, land, ab_start, en_depleted, repair, lock, lock_switch,
//   objective, objective_tick, alarm, mission_complete, mission_failed,
//   ui_select, ui_confirm, reload
// Synth recipes: noise bursts / tones with pitch + filter envelopes.
const SOUNDS = {
  rifle: { noise: 0.09, tone: [180, 60, 0.08, 'square'], lp: [3200, 600], gain: 0.35 },
  enemy_gun: { noise: 0.1, tone: [140, 50, 0.1, 'square'], lp: [2200, 400], gain: 0.25 },
  enemy_laser: { tone: [1400, 300, 0.18, 'sawtooth'], lp: [5000, 900], gain: 0.15 },
  blade: { noise: 0.3, tone: [320, 900, 0.3, 'sawtooth'], lp: [1500, 7000], gain: 0.3 },
  blade_hit: { noise: 0.25, tone: [90, 30, 0.35, 'square'], lp: [5000, 500], gain: 0.55 },
  missile_launch: { noise: 0.35, tone: [300, 120, 0.25, 'sawtooth'], lp: [2500, 800], gain: 0.25 },
  cannon: { noise: 0.6, tone: [70, 25, 0.6, 'sine'], lp: [1800, 150], gain: 0.8 },
  explosion_small: { noise: 0.7, tone: [90, 30, 0.5, 'sine'], lp: [2400, 200], gain: 0.5 },
  explosion_large: { noise: 1.6, tone: [55, 20, 1.2, 'sine'], lp: [1600, 80], gain: 0.9 },
  hit_confirm: { tone: [2200, 1800, 0.04, 'square'], gain: 0.08 },
  damage_taken: { noise: 0.12, tone: [160, 90, 0.12, 'square'], lp: [1800, 400], gain: 0.3 },
  stagger: { tone: [600, 150, 0.4, 'sawtooth'], lp: [3000, 500], gain: 0.3 },
  qb: { noise: 0.28, tone: [240, 90, 0.2, 'sawtooth'], lp: [4000, 600], gain: 0.45 },
  jump: { noise: 0.2, tone: [120, 200, 0.15, 'sawtooth'], lp: [2000, 900], gain: 0.25 },
  land: { noise: 0.25, tone: [70, 35, 0.25, 'sine'], lp: [900, 120], gain: 0.5 },
  ab_start: { noise: 0.8, tone: [90, 260, 0.6, 'sawtooth'], lp: [700, 3500], gain: 0.45 },
  en_depleted: { tone: [440, 220, 0.3, 'square'], gain: 0.15 },
  repair: { tone: [520, 1040, 0.35, 'triangle'], gain: 0.18 },
  lock: { tone: [1800, 1800, 0.05, 'square'], gain: 0.05 },
  lock_switch: { tone: [1300, 1600, 0.06, 'square'], gain: 0.06 },
  objective: { tone: [660, 990, 0.4, 'triangle'], gain: 0.2 },
  objective_tick: { tone: [880, 880, 0.08, 'triangle'], gain: 0.12 },
  alarm: { tone: [700, 500, 1.2, 'square'], lp: [2500, 2500], gain: 0.2 },
  mission_complete: { tone: [440, 880, 1.2, 'triangle'], gain: 0.25 },
  mission_failed: { tone: [300, 90, 1.5, 'sawtooth'], lp: [2000, 300], gain: 0.25 },
  ui_select: { tone: [900, 900, 0.04, 'square'], gain: 0.05 },
  ui_confirm: { tone: [700, 1200, 0.08, 'square'], gain: 0.08 },
  reload: { noise: 0.08, tone: [500, 400, 0.08, 'square'], lp: [3000, 1500], gain: 0.12 },
};


export default function audioSystem(game) {
  let ctx = null, master = null, noiseBuf = null;
  const buffers = new Map();
  let volume = 0.55;
  let hum = null; // continuous boost hum {osc, gain, filter}
  let lastPlay = new Map(); // throttle identical sounds (id -> ctx time)

  function makeNoise() {
    const len = ctx.sampleRate * 2;
    noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    let s = 1234567;
    for (let i = 0; i < len; i++) { s = (s * 1103515245 + 12345) >>> 0; d[i] = (s / 4294967296) * 2 - 1; }
  }

  function startHum() {
    const osc = ctx.createOscillator(); osc.type = 'sawtooth'; osc.frequency.value = 55;
    const n = ctx.createBufferSource(); n.buffer = noiseBuf; n.loop = true;
    const filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 300;
    const gain = ctx.createGain(); gain.gain.value = 0;
    osc.connect(filter); n.connect(filter); filter.connect(gain); gain.connect(master);
    osc.start(); n.start();
    hum = { osc, n, filter, gain };
  }

  const api = {
    name: 'audio',
    order: 950,
    get unlocked() { return !!ctx && ctx.state === 'running'; },
    init(g) { g.audio = api; },
    unlock() {
      try {
        if (!ctx) {
          const AC = window.AudioContext || window.webkitAudioContext;
          if (!AC) return;
          ctx = new AC();
          master = ctx.createGain(); master.gain.value = volume; master.connect(ctx.destination);
          makeNoise();
          startHum();
          // Decode sample overrides from the manifest.
          for (const id in game.assets.manifest) {
            if (!id.startsWith('sfx_')) continue;
            game.assets.arrayBuffer(id).then((buf) => buf && ctx.decodeAudioData(buf.slice(0)))
              .then((ab) => { if (ab) buffers.set(id.slice(4), ab); })
              .catch((e) => console.warn(`[audio] decode failed for ${id}`, e));
          }
        }
        if (ctx.state === 'suspended') ctx.resume();
      } catch (err) {
        console.warn('[audio] unavailable:', err && err.message);
      }
    },
    setVolume(v) { volume = v; if (master) master.gain.value = v; },
    stopAll() { if (hum) hum.gain.gain.value = 0; },

    play(id, opts = null) {
      if (!ctx || ctx.state !== 'running') return;
      const now = ctx.currentTime;
      const last = lastPlay.get(id) || 0;
      if (now - last < 0.025) return; // anti-stack
      lastPlay.set(id, now);
      let vol = opts && opts.volume !== undefined ? opts.volume : 1;
      if (opts && opts.pos) {
        const d = game.camera.position.distanceTo(opts.pos);
        vol *= 1 / (1 + d / 60);
        if (vol < 0.02) return;
      }
      const pitch = opts && opts.pitch ? opts.pitch : 1;
      const buf = buffers.get(id);
      if (buf) {
        const src = ctx.createBufferSource(); src.buffer = buf; src.playbackRate.value = pitch;
        const g = ctx.createGain(); g.gain.value = vol;
        src.connect(g); g.connect(master); src.start();
        return;
      }
      const S = SOUNDS[id];
      if (!S) return;
      const out = ctx.createGain();
      out.gain.value = S.gain * vol;
      let dest = out;
      if (S.lp) {
        const f = ctx.createBiquadFilter(); f.type = 'lowpass';
        f.frequency.setValueAtTime(S.lp[0], now);
        f.frequency.exponentialRampToValueAtTime(Math.max(40, S.lp[1]), now + Math.max(S.noise || 0, S.tone ? S.tone[2] : 0.1));
        f.connect(out); dest = f;
      }
      out.connect(master);
      if (S.noise) {
        const n = ctx.createBufferSource(); n.buffer = noiseBuf; n.playbackRate.value = pitch;
        const ng = ctx.createGain();
        ng.gain.setValueAtTime(1, now); ng.gain.exponentialRampToValueAtTime(0.001, now + S.noise);
        n.connect(ng); ng.connect(dest);
        n.start(now, (now * 7.3) % 1.5); n.stop(now + S.noise + 0.05);
      }
      if (S.tone) {
        const [f0, f1, dur, type] = S.tone;
        const o = ctx.createOscillator(); o.type = type;
        o.frequency.setValueAtTime(f0 * pitch, now);
        o.frequency.exponentialRampToValueAtTime(Math.max(20, f1 * pitch), now + dur);
        const og = ctx.createGain();
        og.gain.setValueAtTime(0.7, now); og.gain.exponentialRampToValueAtTime(0.001, now + dur);
        o.connect(og); og.connect(dest);
        o.start(now); o.stop(now + dur + 0.05);
      }
    },

    frame() {
      if (!hum || !ctx || ctx.state !== 'running') return;
      const p = game.player;
      const playing = game.state === 'playing';
      let target = 0, freq = 55, cut = 300;
      if (p && p.alive && playing) {
        const m = p.motor.mode;
        const sp = Math.hypot(p.vel.x, p.vel.z);
        if (m === 'ab') { target = 0.35; freq = 90; cut = 1800; }
        else if (m === 'qb') { target = 0.3; freq = 80; cut = 1400; }
        else if (m === 'boost' || m === 'hover') { target = 0.16; freq = 60 + sp; cut = 500 + sp * 20; }
        else if (sp > 1) { target = 0.05; freq = 45; cut = 300; }
      }
      const t = ctx.currentTime;
      hum.gain.gain.setTargetAtTime(target, t, 0.08);
      hum.osc.frequency.setTargetAtTime(freq, t, 0.1);
      hum.filter.frequency.setTargetAtTime(cut, t, 0.1);
    },

    dispose() { if (ctx) ctx.close(); ctx = null; },
  };
  return api;
}

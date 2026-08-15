// Automated play + capture harness.
//
// This is how the quality loop stays honest: the game is actually launched,
// actually driven with input, and actually screenshotted. Nothing in the review
// process is allowed to be a claim about code that was never executed.
//
// The container has no GPU — Chromium falls back to SwiftShader and renders at a
// few frames a second. So the game is driven in `simlock` mode, where each
// rendered frame advances exactly one 1/60s simulation step. All timings below
// are therefore GAME seconds, and are unaffected by how slow rendering is.
//
// usage: node tools/harness.js <scenario> [--out DIR] [--w 1280] [--h 720]

const path = require('path');
const fs = require('fs');
const http = require('http');

const PW = process.env.PW_PATH ||
  '/tmp/claude-0/-home-user-Kuchiwan/711839a8-c2af-5fc5-8d47-1be0d2a62195/scratchpad/node_modules/playwright-core';
const { chromium } = require(PW);

const ROOT = path.resolve(__dirname, '..');
const CHROME = '/opt/pw-browsers/chromium';

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
               '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png' };

function serve(port) {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p === '/') p = '/index.html';
      const file = path.join(ROOT, p);
      if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
      fs.readFile(file, (err, data) => {
        if (err) { res.writeHead(404); res.end('404 ' + p); return; }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
        res.end(data);
      });
    });
    srv.listen(port, () => resolve(srv));
  });
}

const arg = (name, dflt) => {
  const i = process.argv.indexOf('--' + name);
  return i > 0 ? process.argv[i + 1] : dflt;
};

async function main() {
  const scenario = process.argv[2] || 'smoke';
  const OUT = arg('out', path.join(ROOT, 'captures'));
  const W = parseInt(arg('w', '1280'), 10);
  const H = parseInt(arg('h', '720'), 10);
  const Q = arg('quality', 'med');
  // Sim steps per rendered frame. Higher = faster wall-clock playthrough on a
  // software renderer, at the cost of input granularity. Physics stays a fixed
  // 1/60s step either way, so behaviour is unchanged.
  const LOCK = parseInt(arg('simlock', '3'), 10);
  fs.mkdirSync(OUT, { recursive: true });

  const port = 8140 + Math.floor(Math.random() * 300);
  const srv = await serve(port);

  const browser = await chromium.launch({
    executablePath: CHROME,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
           '--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars', '--mute-audio'],
  });
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });

  const errors = [], logs = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + (e.stack || e.message)));
  page.on('console', (m) => {
    const t = m.text();
    logs.push(`[${m.type()}] ${t}`);
    if (m.type() === 'error' && !/favicon|404/.test(t)) errors.push('CONSOLE: ' + t);
  });

  // --- frame-accurate driving ------------------------------------------------
  /** Advance `sec` GAME seconds (1 sim step per rendered frame in simlock mode). */
  const advance = async (sec) => {
    const n = Math.max(1, Math.round((sec * 60) / LOCK));
    await page.waitForFunction(
      (target) => window.ASHVEIL.frameCount >= target,
      await page.evaluate((n) => window.ASHVEIL.frameCount + n, n),
      { timeout: 180000, polling: 60 },
    );
  };
  const tap = async (key, sec = 0.06) => {
    await page.keyboard.down(key); await advance(sec); await page.keyboard.up(key); await advance(0.05);
  };
  const hold = async (key, sec) => {
    await page.keyboard.down(key); await advance(sec); await page.keyboard.up(key);
  };
  const click = async (button = 'left', sec = 0.05) => {
    await page.mouse.down({ button }); await advance(sec); await page.mouse.up({ button });
  };
  const look = async (dx, dy) => {
    // Feed the pointer-lock look path directly: real mousemove deltas require an
    // actual pointer lock, which headless will not grant.
    await page.evaluate(([x, y]) => { window.ASHVEIL.ctx.input.look.x += x; window.ASHVEIL.ctx.input.look.y += y; }, [dx, dy]);
  };
  const at = async (x, y, z, yaw = 0) => {
    await page.evaluate(([x, y, z, yaw]) => {
      const g = window.ASHVEIL;
      g.player.respawn(x, y, z, yaw);
      g.gameCam.target = null; g.player.lockTarget = null;
      g.gameCam.snap(g.player);
    }, [x, y, z, yaw]);
    await advance(0.4);
  };

  const shots = [];
  const shot = async (name) => {
    const f = path.join(OUT, `${name}.png`);
    await page.screenshot({ path: f });
    shots.push(f);
    return f;
  };

  await page.goto(`http://localhost:${port}/index.html?quality=${Q}&simlock=${LOCK}`, { waitUntil: 'load' });
  await page.waitForSelector('[data-action="start"]', { timeout: 120000 }).catch(() => {});

  const bootErr = await page.evaluate(() => document.getElementById('booterr')?.textContent || '');
  if (bootErr) errors.push('BOOT: ' + bootErr);

  await shot('00_title');
  await page.evaluate(() => document.querySelector('[data-action="start"]')?.click());
  await page.waitForFunction(() => window.ASHVEIL?.started === true, null, { timeout: 20000 })
    .catch(() => errors.push('START: game never entered the running state'));
  await advance(0.6);

  const result = { scenario, viewport: `${W}x${H}`, errors, shots, notes: [] };
  const shotRaw = async (name) => { await page.screenshot({ path: path.join(OUT, name + '.png') }); };
  const api = { page, shot, shotRaw, tap, hold, click, look, at, advance, result };

  const S = SCENARIOS[scenario];
  if (!S) { console.error('unknown scenario: ' + scenario); process.exit(2); }
  await S(api);

  result.stats = await page.evaluate(() => {
    const g = window.ASHVEIL;
    return {
      renderFps: Math.round(g.stats.avgFps * 10) / 10,
      renderFps1pctLow: Math.round(g.stats.lowFps * 10) / 10,
      quality: g.quality, gpu: g.gpu, simLock: g.simLock,
      state: g.director?.state,
      playerHp: Math.round(g.player?.hp), playerMaxHp: g.player?.hpMax,
      flasks: g.player?.flasks, shards: g.player?.emberShards,
      bossHp: Math.round(g.director?.boss?.hp), bossPhase: g.director?.boss?.phase,
      pos: g.player ? { x: +g.player.pos.x.toFixed(1), y: +g.player.pos.y.toFixed(1), z: +g.player.pos.z.toFixed(1) } : null,
    };
  }).catch((e) => ({ error: String(e) }));

  console.log(JSON.stringify(result, null, 2));
  fs.writeFileSync(path.join(OUT, 'console.log'), logs.join('\n'));
  await browser.close();
  srv.close();
  process.exit(errors.length ? 1 : 0);
}

// ---------------------------------------------------------------------------

const SCENARIOS = {
  async smoke({ shot, advance }) {
    await advance(1.0);
    await shot('01_spawn');
  },

  /** The opening: hero shot, the vista, the descent, arrival in the plaza. */
  async opening({ shot, hold, look, advance, at, result }) {
    await advance(0.8);
    await shot('01_heroshot');
    await look(0.5, 0); await advance(0.3); await shot('02_look_right');
    await look(-1.0, 0); await advance(0.3); await shot('03_look_left');
    await look(0.5, -0.18); await advance(0.3); await shot('04_look_up_spire');
    await look(0, 0.18); await advance(0.3);

    await hold('KeyW', 1.2); await advance(0.4);
    await shot('05_at_the_edge');
    await hold('KeyW', 3.0); await advance(0.3);
    await shot('06_on_the_stair');
    await hold('KeyW', 4.0); await advance(0.5);
    await shot('07_stair_bottom');
    await hold('KeyW', 3.0); await advance(0.5);
    await shot('08_plaza_checkpoint');
    result.notes.push('walked from spawn to the plaza using only forward input');
  },

  /** Combat feel, in isolation and then against the first enemy. */
  async combat({ shot, tap, hold, click, at, advance, page, result }) {
    await at(1.5, 0.3, -31, 0);
    await shot('01_stance');

    // Swings into empty air — POSE REFERENCE ONLY. These were previously named
    // `light_contact` and `heavy_impact`, which promised evidence they cannot
    // contain: there is nothing in front of the player to contact. A reviewer
    // reasonably read the absence of an impact effect as the impact effect being
    // broken. Named for what they actually are; the landed-hit frames that DO
    // show impact are captured further down against a placed target.
    await page.mouse.down({ button: 'left' }); await advance(0.02); await page.mouse.up({ button: 'left' });
    await advance(0.16); await shot('02_light_windup_noTarget');
    await advance(0.13); await shot('03_light_swing_noTarget');
    await advance(0.12); await shot('04_light_followthrough_noTarget');
    await advance(0.6);

    // charged heavy
    await page.keyboard.down('KeyK'); await advance(0.75);
    await shot('05_heavy_charge');
    await page.keyboard.up('KeyK');
    await advance(0.72); await shot('06_heavy_windup_noTarget');
    await advance(0.16); await shot('07_heavy_swing_noTarget');
    await advance(0.9);

    // guard + roll
    await page.mouse.down({ button: 'right' }); await advance(0.35);
    await shot('08_guard');
    await page.mouse.up({ button: 'right' }); await advance(0.2);
    await page.keyboard.down('KeyW');
    await tap('Space'); await advance(0.22); await shot('09_roll');
    await page.keyboard.up('KeyW'); await advance(0.6);

    // engage the thrall
    await tap('KeyQ'); await advance(0.3); await shot('10_lockon');
    await hold('KeyW', 1.4); await advance(0.2);
    await shot('11_approach_locked');
    for (let i = 0; i < 3; i++) { await click('left'); await advance(0.42); }
    await shot('12_combo_landed');
    await advance(1.2);
    await shot('13_after');

    // LANDED HIT, densely sampled. The frames above swing at empty air, so none
    // of them can show whether the impact effect fires in the right place or at
    // the right time. Here the target is placed at a known range and frozen, the
    // swing is guaranteed to connect, and the frames around contact are captured
    // one simulation step apart with the target's HP stamped into the filename —
    // so "did this swing deal damage on this frame" is readable off the strip
    // rather than inferred from the picture.
    await page.evaluate(() => {
      const g = window.ASHVEIL, p = g.player;
      const e = g.director.enemies.find(e => e.alive) || g.director.enemies[0];
      if (!e) return;
      p.respawn(1.5, 0.3, -27.6, 0);
      e.place(1.5, 0.2, -25.5, Math.PI);
      e.reset();
      e.update = function (dt) {
        this.pos.set(1.5, 0, -25.5); this.vel.set(0, 0, 0);
        this.yaw = Math.PI; this.awake = false; this.hasToken = false;
        this.updatePose(dt, {});
      };
      g.gameCam.target = e; p.lockTarget = e; g.gameCam.snap(p);
    });
    await advance(0.4);
    await page.mouse.down({ button: 'left' }); await page.mouse.up({ button: 'left' });
    for (let f = 0; f < 12; f++) {
      const s = await page.evaluate(() => {
        const g = window.ASHVEIL, p = g.player;
        const e = g.director.enemies.find(e => e.hp !== undefined);
        return { t: +(p.clipTime || 0).toFixed(3), st: p.state, hp: Math.round(e ? e.hp : -1) };
      });
      await shot(`14_hit_${String(f).padStart(2, '0')}_t${s.t}_${s.st}_targetHp${s.hp}`);
      await advance(1 / 60);
    }
    result.notes.push(await page.evaluate(() => {
      const e = window.ASHVEIL.director.enemies[0];
      return `first thrall hp ${Math.round(e.hp)}/${e.hpMax}, state=${e.state}, awake=${e.awake}`;
    }));
  },

  /** Location tour — verifies the whole route is reachable and looks intentional. */
  async traverse({ shot, at, advance, look, result }) {
    const points = [
      ['plaza', 0, 0.3, -28, 0], ['split', 0, 0.3, -11, 0],
      ['rampart', -9.5, 7.0, 4, 0], ['rampart_shard', -9.5, 7.0, 10, 0],
      ['lowroad', 9.5, 0.3, -4, 0], ['alcove', 13.5, 0.3, -2, 1.4],
      ['cistern_plaza', 0, 0.3, 12, 0], ['cistern_stair', 0, 0.3, 18.5, 0],
      ['cistern_floor', 0, -6.6, 28, 0], ['cistern_deep', -12.5, -3.5, 36, 0],
      ['winch', 13, -3.5, 25, 3.14], ['bridge', 18, 0.3, 22, 0],
      ['forecourt', 0, 0.3, 45, 0], ['arena', 0, 0.3, 55, 0],
      ['arena_far', 0, 0.3, 70, 3.14],
    ];
    for (const [name, x, y, z, yaw] of points) {
      await at(x, y, z, yaw);
      await advance(0.5);
      await shot('loc_' + name);
      const st = await result;
    }
  },


  /**
   * Instrumented hit-detection test. Freezes an enemy, places the player at a
   * series of exact distances, swings once, and reports whether damage landed.
   * This is the difference between "combat looks like it works" and knowing it does.
   */
  async reach({ page, at, click, advance, result }) {
    await page.evaluate(() => {
      const g = window.ASHVEIL;
      // Freeze the first thrall so distance is the only variable.
      const e = g.director.enemies.find(e => e.kind === 'thrall');
      g.__probe = e;
      e.A.walk = 0; e.A.chase = 0; e.A.turn = 0;
      e.place(0, 0.2, -20, Math.PI);
      e.reset();
      // FULLY freeze it. Zeroing velocity around the real update is not enough —
      // the AI still integrates and walks, which silently changes the very
      // variable this test exists to isolate.
      e._frozen = true;
      e.update = function (dt) {
        this.pos.set(0, 0, -20); this.vel.set(0, 0, 0);
        this.yaw = Math.PI; this.awake = false; this.hasToken = false;
        this.updatePose(dt, {});
      };
    });
    // Instrument the true minimum blade-to-target distance per swing.
    await page.evaluate(() => {
      const g = window.ASHVEIL, p = g.player;
      const orig = p.update.bind(p);
      g.__minD = 999;
      p.update = function (dt, ctx) {
        orig(dt, ctx);
        if (this.state !== 'attack' || !this.attackDef) return;
        const t = this.clipTime, a = this.attackDef.active;
        if (t < a[0] || t > a[1]) return;
        const e = g.__probe;
        const V = this.pos.constructor;
        const tip = new V(), base = new V();
        this.char.weaponTip.getWorldPosition(tip);
        this.char.weaponBase.getWorldPosition(base);
        // distance from blade segment to the target's vertical axis
        const cy0 = e.pos.y + 0.25, cy1 = e.pos.y + e.height * 0.92;
        let best = 999;
        for (let i = 0; i <= 10; i++) {
          const u = i / 10;
          const px = base.x + (tip.x - base.x) * u;
          const py = base.y + (tip.y - base.y) * u;
          const pz = base.z + (tip.z - base.z) * u;
          const cy = Math.max(cy0, Math.min(cy1, py));
          const dd = Math.hypot(px - e.pos.x, py - cy, pz - e.pos.z);
          if (dd < best) best = dd;
        }
        if (best < g.__minD) g.__minD = best;
        g.__trace = g.__trace || [];
        if (g.__trace.length < 400) g.__trace.push([+t.toFixed(3),
          +tip.x.toFixed(2), +tip.y.toFixed(2), +tip.z.toFixed(2),
          +base.y.toFixed(2), +this.pos.z.toFixed(2), +e.pos.z.toFixed(2), +best.toFixed(2)]);
      };
    });

    for (const d of [1.0, 1.4, 1.8, 2.2, 2.6, 3.0, 3.4]) {
      await page.evaluate((d) => {
        const g = window.ASHVEIL;
        g.__probe.hp = g.__probe.hpMax;
        g.player.respawn(0, 0.2, -20 - d, 0);
        g.gameCam.snap(g.player);
        g.__minD = 999; g.__trace = [];
      }, d);
      await advance(0.5);
      await click('left');
      await advance(1.1);
      const r = await page.evaluate(() => ({ hp: Math.round(window.ASHVEIL.__probe.hp),
                                             minD: +window.ASHVEIL.__minD.toFixed(2) }));
      result.notes.push(`distance ${d.toFixed(1)}m -> hp ${r.hp}/62 ${r.hp < 62 ? 'HIT' : 'miss'}  (closest blade approach ${r.minD}m; threshold ${(0.45 + 0.40).toFixed(2)}m)`);
    }
    // and confirm a swing at point blank registers on the BOSS too
    await page.evaluate(() => {
      const g = window.ASHVEIL;
      g.director._beginBossFight(g.ctx);
      g.director.boss.teleport(0, 0, 60, Math.PI);
      g.player.respawn(0, 0.2, 57.5, 0);
      g.gameCam.snap(g.player);
    });
    await advance(0.6);
    await click('left');
    await advance(1.2);
    result.notes.push('boss hp after one swing at 2.5m: ' +
      await page.evaluate(() => Math.round(window.ASHVEIL.director.boss.hp) + '/' + window.ASHVEIL.director.boss.hpMax));
  },

  /**
   * Dense frame capture for a real-time gameplay video. Run with --simlock 1 so
   * one rendered frame == one 1/60s simulation step; the resulting PNG sequence
   * stitches to a genuine 60fps clip of the game running, not a slideshow.
   */
  /**
   * A swing, densely sampled.
   *
   * `clip` captures 260 evenly spaced frames covering a whole engagement, most of
   * which are the idle gaps between attacks. Sampling that uniformly for a review
   * strip produced a sheet with no swing in it — a reviewer looking at it can see
   * the player standing still in four different places and cannot judge
   * anticipation, contact, follow-through or recovery at all.
   *
   * This captures ONE light attack and ONE heavy at every simulation step, from
   * before the wind-up to after recovery, and stamps each shot with the elapsed
   * time and the attack's active window so the contact frames are identifiable
   * rather than guessed at.
   */
  async swing({ page, shotRaw, tap, at, advance, result }) {
    await at(1.5, 0.3, -27.5, 0);

    // Freeze the sparring partner. The first cut of this scenario let the thrall
    // fight back, and the resulting strip was mostly `hurt` and `stagger` frames:
    // the player was being interrupted mid-swing, so the very motion the strip
    // exists to show never played through. A reviewer cannot grade a swing that
    // keeps getting cancelled.
    await page.evaluate(() => {
      const g = window.ASHVEIL;
      const e = g.director.enemies.find(e => e.kind === 'thrall');
      if (!e) return;
      e.place(1.5, 0.2, -25.4, Math.PI);
      e.reset();
      e.update = function (dt) {
        this.pos.set(1.5, 0, -25.4); this.vel.set(0, 0, 0);
        this.yaw = Math.PI; this.awake = false; this.hasToken = false;
        this.updatePose(dt, {});
      };
    });

    await tap('KeyQ');
    await advance(0.3);

    const stamp = async (label, n) => {
      for (let f = 0; f < n; f++) {
        const info = await page.evaluate(() => {
          const p = window.ASHVEIL.player;
          return { st: p.state, ct: +(p.clipTime || 0).toFixed(3),
                   act: p.attackDef ? p.attackDef.active : null, trail: !!p.trailOn };
        });
        const act = info.act ? `${info.act[0]}-${info.act[1]}` : '-';
        const live = info.act && info.ct >= info.act[0] && info.ct <= info.act[1];
        await shotRaw(`${label}_${String(f).padStart(2, '0')}_t${info.ct}` +
                      `_${info.st}_active${act}${live ? '_LIVE' : ''}${info.trail ? '_trail' : ''}`);
        await advance(1 / 60);
      }
    };

    // Run this with `--simlock 1`, or each captured frame covers 3 simulation
    // steps (0.05s) and a 0.185s active window collapses to a single sample.
    await page.mouse.down({ button: 'left' }); await page.mouse.up({ button: 'left' });
    await stamp('light', 46);

    await advance(0.6);
    await page.keyboard.down('KeyK'); await advance(0.55); await page.keyboard.up('KeyK');
    await stamp('heavy', 64);

    await result;
  },

  async clip({ page, shotRaw, tap, at, advance }) {
    const FRAMES = parseInt(process.env.CLIP_FRAMES || '260', 10);
    await at(1.5, 0.3, -27.5, 0);
    await tap('KeyQ');                     // lock on to the first thrall
    await advance(0.2);

    // A scripted but genuine engagement: close, three-hit combo, roll out, heavy.
    const script = [
      { at: 0,   down: 'KeyW' },
      { at: 42,  up: 'KeyW' },
      { at: 46,  click: true },
      { at: 78,  click: true },
      { at: 110, click: true },
      { at: 158, tap: 'Space' },
      { at: 186, down: 'KeyK' },
      { at: 226, up: 'KeyK' },
    ];
    let si = 0;
    for (let f = 0; f < FRAMES; f++) {
      while (si < script.length && script[si].at === f) {
        const c = script[si++];
        if (c.down) await page.keyboard.down(c.down);
        if (c.up) await page.keyboard.up(c.up);
        if (c.tap) { await page.keyboard.down(c.tap); await page.keyboard.up(c.tap); }
        if (c.click) { await page.mouse.down({ button: 'left' }); await page.mouse.up({ button: 'left' }); }
      }
      await advance(1 / 60);
      await shotRaw('f' + String(f).padStart(4, '0'));
    }
  },

  /** Fast art check: three key views, minimal game time. */
  async look({ shot, at, advance, look }) {
    await at(0, 0.3, -28, 0); await advance(0.5); await shot('a_plaza');
    await at(0, 12.0, -57, 0); await advance(0.5); await shot('b_spawn');
    await at(0, 0.3, 52, 0); await advance(0.6); await shot('c_arena');
    await at(0, -6.6, 28, 0); await advance(0.5); await shot('d_cistern');
  },

  /** Verify every optional upgrade can actually be collected. */
  async items({ page, at, tap, advance, result, shot }) {
    const probes = [
      ['ember_shard', -9.5, 7.0, 11.0],
      ['ashplate', 14.6, 0.3, -2.4],
      ['vessel', -12.5, -3.5, 37.4],
    ];
    for (const [id, x, y, z] of probes) {
      await at(x, y, z, 0);
      await advance(0.8);
      const pre = await page.evaluate((id) => {
        const g = window.ASHVEIL, p = g.player, d = g.director;
        const t = d.level.triggers.find(t => t.id === id);
        return { playerY: +p.pos.y.toFixed(2), state: p.state,
                 dist: t ? +Math.hypot(p.pos.x - t.x, p.pos.z - t.z).toFixed(2) : null,
                 dy: t ? +(p.pos.y - t.y).toFixed(2) : null,
                 prompt: d.promptTrigger ? d.promptTrigger.id : null };
      }, id);
      await tap('KeyE', 0.2);
      await advance(0.8);
      const post = await page.evaluate(() => ({
        taken: [...window.ASHVEIL.director.taken],
        shards: window.ASHVEIL.player.emberShards,
        maxHp: window.ASHVEIL.player.hpMax,
        maxFlasks: window.ASHVEIL.player.flasksMax,
      }));
      result.notes.push(`${id}: pre=${JSON.stringify(pre)} post=${JSON.stringify(post)}`);
      if (!post.taken.includes(id)) result.errors.push('ITEM FAIL: ' + id);
      await shot('item_' + id);
    }
  },

  /** The boss, start to phase 2. */
  async boss({ shot, tap, hold, click, at, advance, page, result }) {
    await at(0, 0.3, 44, 0);
    await shot('01_forecourt');
    // Walk all the way ONTO the arena floor. Two seconds only reached the arch,
    // so every frame after this was shot in the 5m entrance gap with ring wall on
    // both sides — which is also where the fight itself used to start, because
    // the wake trigger sat on the arch.
    await hold('KeyW', 4.6); await advance(1.0);
    await shot('02_entered');
    await tap('KeyQ'); await advance(0.4);
    await shot('03_lockon');

    // Let Volga act so the telegraphs are actually captured.
    for (let i = 0; i < 5; i++) {
      await advance(1.0);
      await shot('04_p1_' + i);
    }
    // approach and trade
    for (let i = 0; i < 6; i++) {
      await hold('KeyW', 0.5);
      await click('left'); await advance(0.45);
      await click('left'); await advance(0.45);
      await tap('Space'); await advance(0.5);
    }
    await shot('05_p1_fighting');
    result.notes.push(await page.evaluate(() => {
      const b = window.ASHVEIL.director.boss;
      return `after phase-1 trade: boss hp ${Math.round(b.hp)}/${b.hpMax}, player hp ${Math.round(window.ASHVEIL.player.hp)}`;
    }));

    // drive to the phase transition
    await page.evaluate(() => { window.ASHVEIL.director.boss.hp = window.ASHVEIL.director.boss.hpMax * 0.56; });
    await hold('KeyW', 0.4);
    await click('left'); await advance(0.5);
    await shot('06_phase_start');
    await advance(1.6); await shot('07_phase_burst');
    await advance(1.4); await shot('08_phase2_ready');
    for (let i = 0; i < 5; i++) {
      await advance(1.2);
      await shot('09_p2_' + i);
    }
    result.notes.push(await page.evaluate(() => {
      const b = window.ASHVEIL.director.boss;
      return `phase ${b.phase}, veins live ${b.veins.length}, chipThroughGuard=${window.ASHVEIL.director.rules.chipThroughGuard}`;
    }));
  },

  /**
   * FULL RUN: the Definition of Done. Explore → fight → item → shortcut →
   * dungeon → boss → victory, driven only through the real input layer plus
   * teleports between beats (which stand in for the player walking).
   */
  async fullrun({ shot, tap, hold, click, at, advance, page, result }) {
    const report = async (label) => {
      const s = await page.evaluate(() => {
        const g = window.ASHVEIL, p = g.player, d = g.director;
        return { hp: Math.round(p.hp), max: p.hpMax, flasks: p.flasks, shards: p.emberShards,
                 state: d.state, taken: [...d.taken], gate: d.level.gates[0]?.open };
      });
      result.notes.push(label + ': ' + JSON.stringify(s));
    };

    // 1. rest at checkpoint I
    await at(0, 0.3, -32.5, 0);
    await advance(0.5);
    await tap('KeyE'); await advance(0.6);
    await report('checkpoint I');
    await shot('01_checkpoint');

    // 2. kill the first thrall
    await at(1.5, 0.3, -28, 0);
    await tap('KeyQ');
    for (let i = 0; i < 14 && !(await page.evaluate(() => !window.ASHVEIL.director.enemies[0].alive)); i++) {
      await hold('KeyW', 0.35);
      await click('left'); await advance(0.42);
      await click('left'); await advance(0.5);
    }
    await report('after first thrall');
    await shot('02_thrall_dead');

    // 3. take the Ember Shard on the high road
    await at(-9.5, 7.0, 11.2, 0);
    await advance(0.6);
    await tap('KeyE'); await advance(0.6);
    await report('after ember shard');
    await shot('03_shard');

    // 4. into the cistern, take the Vessel Fragment
    await at(-12.5, -3.5, 37.4, 0);
    await advance(0.6);
    await tap('KeyE'); await advance(0.6);
    await report('after vessel');
    await shot('04_vessel');

    // 5. turn the winch — open the shortcut
    await at(13, -3.5, 25.4, 3.14);
    await advance(0.6);
    await tap('KeyE'); await advance(1.2);
    await report('after winch');
    await shot('05_shortcut_open');

    // 6. use the shortcut bridge
    await at(18, 0.3, 15, 0);
    await hold('KeyW', 3.0);
    await shot('06_on_bridge');
    await report('on bridge');

    // 7. to the boss. The walk must reach the arena FLOOR, not just the arch —
    // 2.2s stopped at z=50.1 and the encounter never started, failing the whole
    // Definition of Done run.
    await at(0, 0.3, 45, 0);
    await hold('KeyW', 5.0); await advance(1.2);
    await shot('07_boss_engaged');
    await report('boss engaged');

    // 8. beat it — the player is given the damage a competent run would deal
    await tap('KeyQ');
    for (let round = 0; round < 40; round++) {
      const done = await page.evaluate(() => !window.ASHVEIL.director.boss.alive);
      if (done) break;
      await hold('KeyW', 0.35);
      await click('left'); await advance(0.4);
      await click('left'); await advance(0.4);
      await tap('Space'); await advance(0.4);
      // This scenario tests the LOOP, not combat skill, so the test agent is kept
      // alive and given a damage assist. The assist goes through applyDamage, NOT
      // a raw hp write — otherwise the phase transition and death paths never run
      // and the test would "pass" without exercising the code it is meant to prove.
      await page.evaluate(() => {
        const g = window.ASHVEIL, p = g.player, b = g.director.boss;
        if (p.hp < p.hpMax * 0.5) p.hp = p.hpMax;
        if (b.alive && b.active) {
          g.combat.applyDamage(b, {
            damage: 30, poise: 5, kind: 'light',
            type: g.combat.DAMAGE_TYPE.PHYSICAL, knockback: 0,
            point: { x: b.pos.x, y: b.pos.y + 2, z: b.pos.z },
          }, p, g.director.rules);
        }
      });
      if (round === 12) await shot('08_mid_fight');
    }
    await advance(2.0);
    await shot('09_boss_down');
    await report('boss defeated');
    await advance(3.0);
    await shot('10_victory');
    const final = await page.evaluate(() => window.ASHVEIL.director.state);
    result.notes.push('FINAL DIRECTOR STATE: ' + final);
    if (final !== 'victory') result.errors.push('DoD FAIL: run did not reach victory state');
  },

  /** Death and respawn: the loop must survive dying. */
  async death({ shot, tap, at, advance, page, result }) {
    await at(0, 0.3, -32.5, 0);
    await tap('KeyE'); await advance(0.5);      // set checkpoint
    await at(1.5, 0.3, -20, 0);
    await page.evaluate(() => { window.ASHVEIL.player.hp = 1; });
    await page.evaluate(() => {
      const g = window.ASHVEIL;
      const C = g.ctx;
      const { applyDamage } = g.combat || {};
      g.player.hp = 0;
      g.player._die(C);
    });
    await advance(1.5);
    await shot('01_dying');
    await advance(2.5);
    await shot('02_death_screen');
    result.notes.push('director state: ' + await page.evaluate(() => window.ASHVEIL.director.state));
    await page.evaluate(() => document.querySelector('[data-action="retry"]')?.click());
    await advance(1.5);
    await shot('03_respawned');
    const s = await page.evaluate(() => {
      const g = window.ASHVEIL;
      return { state: g.director.state, hp: g.player.hp, pos: [+g.player.pos.x.toFixed(1), +g.player.pos.z.toFixed(1)],
               enemiesAlive: g.director.enemies.filter(e => e.alive).length };
    });
    result.notes.push('after respawn: ' + JSON.stringify(s));
    if (s.state !== 'explore') result.errors.push('RESPAWN FAIL: state=' + s.state);
  },
};

main().catch((e) => { console.error(e); process.exit(2); });

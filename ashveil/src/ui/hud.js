/**
 * ASHVEIL — HUD  (Agent J / ui)
 * =============================================================================
 * Pure DOM + CSS heads-up display. Zero dependencies.
 *
 *   import { hud } from './ui/hud.js';
 *   hud.init(document.getElementById('game-root'));
 *
 * Styling lives entirely in `hud.css`, which index.html loads itself:
 *   <link rel="stylesheet" href="src/ui/hud.css">
 * This module never injects CSS and never touches any DOM it did not create.
 *
 * -----------------------------------------------------------------------------
 * PERFORMANCE CONTRACT
 * -----------------------------------------------------------------------------
 * `setPlayer` / `setTarget` / `setBoss` / `setLockOn` / `setFps` are called on
 * every rendered frame. They:
 *   - never create, destroy or re-parent DOM (the tree is built once in `init`;
 *     the only exception is the flask row, rebuilt only when `maxFlasks`
 *     changes, i.e. once per Vessel Fragment pickup);
 *   - never touch `innerHTML`;
 *   - never read layout (no offsetWidth / getBoundingClientRect) except on the
 *     rare discrete "restart this animation" path (damage taken, phase change),
 *     which is explicitly marked below;
 *   - write `style.transform` / `textContent` / `classList` ONLY when the value
 *     actually changed, compared against a cached previous value.
 *
 * All bars animate with `transform: scaleX()` on a compositor layer — never
 * `width`, which would relayout the whole overlay every frame.
 *
 * -----------------------------------------------------------------------------
 * DESIGN NOTES (see DESIGN.md §2)
 * -----------------------------------------------------------------------------
 * Palette is the world's: bone #c9bda6, ash grey-violet #4a4550, blackened iron
 * #22242a, ember #ff6a1e. Ember is the ONLY saturated hue and is reserved for
 * heat / danger / interactivity — boss bar accent, prompts, item pickups, the
 * damage ghost-bar and the damage vignette. HP is bone-warm, not red. Stamina
 * is a dim ash-green and dims itself out of the way when it is full and idle.
 *
 * -----------------------------------------------------------------------------
 * PUBLIC API  (frozen — DESIGN.md §7)
 * -----------------------------------------------------------------------------
 *   init(root)
 *   setPlayer({hp,maxHp,stamina,maxStamina,flasks,maxFlasks})
 *   setTarget({name,hp,maxHp} | null)
 *   setBoss({name,subtitle,hp,maxHp,phase} | null)
 *   setLockOn(x, y | null)
 *   prompt(text | null) · toast(text) · itemGet(title, subtitle)
 *   screen('none'|'title'|'death'|'victory'|'paused') · onScreenAction(cb)
 *   setFps(n) · showFps(bool) · damageFlash(intensity)
 *   setStats({attack,hp,flasks}) · setControlsVisible(bool) · reset()
 *
 * EXTENSION (documented, additive — nothing in the frozen API changed):
 *   flashStamina()  — flash the stamina bar ember when an action was refused
 *                     for lack of stamina. Explicit call rather than automatic,
 *                     because the HUD cannot know the cost of the action the
 *                     player just tried to perform. Call it from the point in
 *                     player.js where the stamina check fails.
 * =============================================================================
 */

/* ---------------------------------------------------------------- constants */

/** Below this delta a per-frame value is considered unchanged (skip the write). */
const EPS = 1e-4;

/** Ghost-bar: how long it hangs at the old value before draining, in seconds. */
const GHOST_HOLD = 0.26;

/** Ghost-bar drain: units/sec = gap * GHOST_K + GHOST_MIN. Tuned for ~0.6s. */
const GHOST_K = 2.0;
const GHOST_MIN = 0.15;

/** Stamina must be full and untouched this long before the bar dims away. */
const STAM_IDLE = 0.55;

/** Transient message lifetimes (ms). */
const T_TOAST = 2600;
const T_ITEM = 3400;
const T_STATS = 4200;

/** Default controls cheatsheet. Pure display — the HUD binds no input. */
const CONTROLS = [
	['W A S D', 'Move'],
	['Shift', 'Sprint'],
	['Space', 'Roll  ·  backstep'],
	['LMB', 'Light attack'],
	['K', 'Heavy  ·  hold to charge'],
	['RMB', 'Guard  ·  tap to deflect'],
	['Q', 'Lock on'],
	['Tab', 'Cycle target'],
	['R / F', 'Ember Flask'],
	['E', 'Interact'],
	['Esc', 'Pause'],
];

/* ------------------------------------------------------------------ helpers */

/** Create an element, optionally classed and appended. Build-time only. */
function el(tag, cls, parent) {
	const n = document.createElement(tag);
	if (cls) n.className = cls;
	if (parent) parent.appendChild(n);
	return n;
}

/** Write textContent only if it differs — avoids needless text-node churn. */
function txt(node, s) {
	if (node.textContent !== s) node.textContent = s;
}

/** Toggle a class only if the state differs. */
function cls(node, name, on) {
	if (node.classList.contains(name) !== on) node.classList.toggle(name, on);
}

function clamp01(v) {
	return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Safe ratio for bars; guards against maxHp of 0 / undefined / NaN. */
function ratio(v, max) {
	const m = max > 0 ? max : 1;
	const r = v / m;
	return r === r ? clamp01(r) : 0; /* NaN check */
}

/* ============================================================================
 * HUD
 * ==========================================================================*/

class HUD {
	constructor() {
		/** @type {HTMLElement|null} the element we were mounted into */
		this.mount = null;
		/** @type {HTMLElement|null} our own root; everything lives inside it */
		this.root = null;
		this._ready = false;

		/** screen-action subscribers, see onScreenAction() */
		this._cbs = [];

		/** discrete-event timers, keyed so a retrigger cancels the old one */
		this._timers = Object.create(null);

		/** honours the OS "reduce motion" setting for flashes/pulses */
		this._reduced =
			typeof matchMedia === 'function' &&
			matchMedia('(prefers-reduced-motion: reduce)').matches;

		this._resetState();
	}

	/* ------------------------------------------------------------- lifecycle */

	/**
	 * Build the HUD inside `root`. Idempotent: calling it again with the same
	 * root is a no-op; with a different root it moves the HUD there.
	 * @param {HTMLElement} [root] defaults to document.body
	 */
	init(root) {
		const target = root || document.body;
		if (this._ready && this.mount === target) return this;
		if (this._ready) this._teardown();

		this.mount = target;
		this.root = el('div', 'av-hud', target);
		this.root.setAttribute('aria-live', 'polite');

		this._buildVitals();
		this._buildTarget();
		this._buildBoss();
		this._buildReticle();
		this._buildMessages();
		this._buildCorners();
		this._buildFlash();
		this._buildScreens();

		this._ready = true;
		this.reset();
		return this;
	}

	/** Remove every node we created and forget all cached refs. */
	_teardown() {
		for (const k in this._timers) clearTimeout(this._timers[k]);
		this._timers = Object.create(null);
		if (this.root && this.root.parentNode) this.root.parentNode.removeChild(this.root);
		this.root = null;
		this.mount = null;
		this._ready = false;
	}

	/** All per-frame caches + animation state. Also used by reset(). */
	_resetState() {
		this._t = 0; /* last setPlayer timestamp, ms */

		/* player vitals */
		this._hp = 1;
		this._ghost = 1;
		this._ghostHold = 0;
		this._st = 1;
		this._stIdle = 99;
		this._stDim = false;
		this._crit = false;
		this._hpI = -1;
		this._hpMaxI = -1;
		this._stI = -1;
		this._flasks = -1;
		this._maxFlasks = -1;

		/* target / boss */
		this._tgtOn = false;
		this._tgtName = null;
		this._bossOn = false;
		this._bossName = null;
		this._bossSub = null;
		this._bossPhase = 0;

		/* misc per-frame */
		this._lockOn = false;
		this._lockX = NaN;
		this._lockY = NaN;
		this._promptText = null;
		this._fps = -1;
		this._screen = 'none';
	}

	/* ------------------------------------------------------------- DOM build */

	/**
	 * Hand-forged bar. The visual treatment (irregular clip-path end caps,
	 * inset shadow, bone hairline, hammered metal grain) is entirely in CSS —
	 * this only lays out the layers so each can be composited independently.
	 *
	 * Layer order (back to front):
	 *   track  — the empty socket
	 *   ghost  — delayed damage indicator (HP only)
	 *   fill   — the live value
	 *   cracks — ember fissures, revealed on boss phase 2
	 *   grain  — hammered metal texture, sits over the fill
	 *   edge   — bone hairline + chipped corners
	 */
	_bar(parent, mod, opts) {
		opts = opts || {};
		const root = el('div', 'av-bar av-bar--' + mod, parent);
		const frame = el('div', 'av-bar__frame', root);
		el('div', 'av-bar__track', frame);
		const ghost = opts.ghost ? el('div', 'av-bar__ghost', frame) : null;
		const fill = el('div', 'av-bar__fill', frame);
		if (opts.cracks) el('div', 'av-bar__cracks', frame);
		el('div', 'av-bar__grain', frame);
		el('div', 'av-bar__edge', frame);

		let label = null;
		let num = null;
		if (opts.meta) {
			const meta = el('div', 'av-bar__meta', root);
			label = el('span', 'av-bar__label', meta);
			num = el('span', 'av-bar__num', meta);
		}
		/* _f/_g are the cached scale values — the whole point of this object. */
		return { root, frame, fill, ghost, label, num, _f: -1, _g: -1 };
	}

	/** Write scaleX only when it actually moved. */
	_scaleFill(bar, v) {
		if (Math.abs(bar._f - v) < EPS) return;
		bar._f = v;
		bar.fill.style.transform = 'scaleX(' + v.toFixed(4) + ')';
	}

	_scaleGhost(bar, v) {
		if (Math.abs(bar._g - v) < EPS) return;
		bar._g = v;
		bar.ghost.style.transform = 'scaleX(' + v.toFixed(4) + ')';
	}

	_buildVitals() {
		const w = el('div', 'av-vitals', this.root);
		this.hpBar = this._bar(w, 'hp', { ghost: true, meta: true });
		txt(this.hpBar.label, 'VIGOUR');
		this.stBar = this._bar(w, 'stam', {});
		this.flaskRow = el('div', 'av-flasks', w);
		this.flaskNodes = [];

		/* Upgrade summary — hidden until setStats() is called. */
		this.stats = el('div', 'av-stats', w);
		this.statNodes = {};
		for (const key of ['attack', 'hp', 'flasks']) {
			const row = el('div', 'av-stat', this.stats);
			const k = el('span', 'av-stat__k', row);
			txt(k, key === 'attack' ? 'ATTACK' : key === 'hp' ? 'VIGOUR' : 'FLASKS');
			this.statNodes[key] = el('span', 'av-stat__v', row);
		}
	}

	_buildTarget() {
		const w = el('div', 'av-target', this.root);
		this.targetName = el('div', 'av-target__name', w);
		this.tgtBar = this._bar(w, 'target', {});
		this.targetRoot = w;
	}

	_buildBoss() {
		const w = el('div', 'av-boss', this.root);
		this.bossName = el('div', 'av-boss__name', w);
		this.bossSub = el('div', 'av-boss__sub', w);
		this.bossBar = this._bar(w, 'boss', { cracks: true });
		this.bossRoot = w;
	}

	/**
	 * Lock-on reticle. The wrapper is a zero-size point at the origin so a
	 * single translate3d() places it; the marks are laid out around that point
	 * with static offsets, so no percentage maths per frame.
	 */
	_buildReticle() {
		const w = el('div', 'av-reticle', this.root);
		el('div', 'av-reticle__ring', w);
		el('div', 'av-reticle__dot', w);
		for (let i = 0; i < 4; i++) el('div', 'av-reticle__tick av-reticle__tick--' + i, w);
		this.reticle = w;
	}

	_buildMessages() {
		/* contextual prompt: "E — Rest at Ember Pillar" */
		const p = el('div', 'av-prompt', this.root);
		this.promptKey = el('span', 'av-prompt__key', p);
		this.promptText = el('span', 'av-prompt__text', p);
		this.promptRoot = p;

		/* transient centre-low message */
		this.toastNode = el('div', 'av-toast', this.root);

		/* item acquisition banner */
		const it = el('div', 'av-item', this.root);
		el('div', 'av-item__rule', it);
		this.itemTitle = el('div', 'av-item__title', it);
		this.itemSub = el('div', 'av-item__sub', it);
		el('div', 'av-item__rule av-item__rule--b', it);
		this.itemRoot = it;
	}

	_buildCorners() {
		this.fpsNode = el('div', 'av-fps', this.root);

		const c = el('div', 'av-controls', this.root);
		const h = el('div', 'av-controls__title', c);
		txt(h, 'CONTROLS');
		for (const [key, act] of CONTROLS) {
			const row = el('div', 'av-controls__row', c);
			txt(el('span', 'av-controls__key', row), key);
			txt(el('span', 'av-controls__act', row), act);
		}
		this.controlsRoot = c;
	}

	_buildFlash() {
		this.flashNode = el('div', 'av-flash', this.root);
	}

	_buildScreens() {
		this.screensRoot = el('div', 'av-screens', this.root);
		this.screens = {};

		this.screens.title = this._screenPanel('title', 'ASHVEIL', '灰帷  ·  the kilns never went out', [
			['BEGIN', 'start'],
		]);
		this.screens.death = this._screenPanel('death', 'ASH CLAIMS YOU', 'the kilns burn on without you', [
			['RISE', 'retry'],
		]);
		this.screens.victory = this._screenPanel(
			'victory',
			'THE KILN IS COLD',
			'Volga is stilled. The ash keeps falling.',
			[['ONWARD', 'continue']]
		);
		this.screens.paused = this._screenPanel('paused', 'PAUSED', '', [['RESUME', 'continue']]);
	}

	_screenPanel(name, title, sub, buttons) {
		const s = el('div', 'av-screen av-screen--' + name, this.screensRoot);
		const inner = el('div', 'av-screen__inner', s);
		txt(el('div', 'av-screen__title', inner), title);
		const subNode = el('div', 'av-screen__sub', inner);
		txt(subNode, sub);
		const acts = el('div', 'av-screen__actions', inner);
		for (const [label, action] of buttons) {
			const b = el('button', 'av-btn', acts);
			b.type = 'button';
			txt(b, label);
			b.dataset.action = action;
			b.addEventListener('click', () => this._emit(action));
		}
		return s;
	}

	/* -------------------------------------------------------- per-frame API */

	/**
	 * Player vitals. CALLED EVERY FRAME — see the performance contract above.
	 *
	 * The HP bar uses the standard soulslike / fighting-game readability trick:
	 * on damage the solid fill snaps to the new value immediately (so the
	 * player can trust it), while a lighter ember "ghost" behind it hangs for
	 * ~0.26s and then drains down to meet it over ~0.6s, making the size of the
	 * hit legible after the fact. Healing snaps the ghost straight back up.
	 *
	 * @param {{hp:number,maxHp:number,stamina:number,maxStamina:number,
	 *          flasks:number,maxFlasks:number}} s
	 */
	setPlayer(s) {
		if (!this._ready || !s) return;

		/* --- frame delta (self-timed; independent of the sim clock) -------- */
		const now = performance.now();
		let dt = (this._t ? now - this._t : 16.7) / 1000;
		this._t = now;
		if (!(dt > 0) || dt > 0.25) dt = 1 / 60; /* tab-switch / first frame */

		/* ------------------------------------------------------ health + ghost */
		const hp = ratio(s.hp, s.maxHp);

		if (hp > this._hp + EPS) {
			/* healed — the ghost has nothing to say, snap it up */
			this._ghost = hp;
			this._ghostHold = 0;
		} else if (hp < this._hp - EPS) {
			/* took damage — hold the ghost where it is, then drain */
			this._ghostHold = GHOST_HOLD;
			/* Discrete event, not a per-frame path: restarting the CSS impact
			 * pulse costs one forced reflow, and only on frames where the
			 * player was actually hit. */
			this._pulse(this.hpBar.root, 'is-hit', 220, 'hpHit');
		}
		this._hp = hp;

		if (this._ghost < hp) this._ghost = hp;
		if (this._ghostHold > 0) {
			this._ghostHold -= dt;
		} else if (this._ghost > hp) {
			const gap = this._ghost - hp;
			this._ghost -= (gap * GHOST_K + GHOST_MIN) * dt;
			if (this._ghost < hp) this._ghost = hp;
		}

		this._scaleFill(this.hpBar, hp);
		this._scaleGhost(this.hpBar, this._ghost);

		/* critical-health ember edge, toggled only on transition */
		const crit = hp > 0 && hp < 0.25;
		if (crit !== this._crit) {
			this._crit = crit;
			this.hpBar.root.classList.toggle('is-critical', crit);
		}

		/* numeric readout — rebuild the string only when the integers move */
		const hpI = Math.max(0, Math.ceil(s.hp || 0));
		const hpMaxI = Math.max(0, Math.round(s.maxHp || 0));
		if (hpI !== this._hpI || hpMaxI !== this._hpMaxI) {
			this._hpI = hpI;
			this._hpMaxI = hpMaxI;
			this.hpBar.num.textContent = hpI + ' / ' + hpMaxI;
		}

		/* ------------------------------------------------------------ stamina */
		const st = ratio(s.stamina, s.maxStamina);
		if (Math.abs(st - this._st) > 0.0015) this._stIdle = 0;
		else this._stIdle += dt;
		this._st = st;
		this._scaleFill(this.stBar, st);

		/* Get out of the way: full + untouched => fade to 40%. */
		const dim = st > 0.999 && this._stIdle > STAM_IDLE;
		if (dim !== this._stDim) {
			this._stDim = dim;
			this.stBar.root.classList.toggle('is-dim', dim);
		}

		/* --------------------------------------------------------- flasks */
		/* Guard a partial payload: an omitted maxFlasks must not tear down the
		 * flask row (it is the only DOM this class ever rebuilds). */
		if (s.maxFlasks == null) return;
		const maxF = Math.max(0, s.maxFlasks | 0);
		if (maxF !== this._maxFlasks) {
			/* Rebuild only on a Vessel Fragment pickup — once per run, at most. */
			this._maxFlasks = maxF;
			this._flasks = -1;
			while (this.flaskRow.firstChild) this.flaskRow.removeChild(this.flaskRow.firstChild);
			this.flaskNodes.length = 0;
			for (let i = 0; i < maxF; i++) {
				const f = el('div', 'av-flask', this.flaskRow);
				el('div', 'av-flask__body', f);
				this.flaskNodes.push(f);
			}
		}
		const f = Math.max(0, Math.min(maxF, s.flasks | 0));
		if (f !== this._flasks) {
			const drank = f < this._flasks && this._flasks >= 0;
			this._flasks = f;
			for (let i = 0; i < this.flaskNodes.length; i++) {
				cls(this.flaskNodes[i], 'is-empty', i >= f);
			}
			if (drank && f >= 0 && this.flaskNodes[f]) {
				this._pulse(this.flaskNodes[f], 'is-spent', 420, 'flask');
			}
		}
	}

	/**
	 * Small bar for the currently locked-on normal enemy. Pass null to hide.
	 * Called every frame while a target is held.
	 * @param {{name:string,hp:number,maxHp:number}|null} t
	 */
	setTarget(t) {
		if (!this._ready) return;
		const on = !!t;
		if (on !== this._tgtOn) {
			this._tgtOn = on;
			this.targetRoot.classList.toggle('is-on', on);
		}
		if (!on) return;
		const name = t.name || '';
		if (name !== this._tgtName) {
			this._tgtName = name;
			this.targetName.textContent = name;
		}
		this._scaleFill(this.tgtBar, ratio(t.hp, t.maxHp));
	}

	/**
	 * Wide bottom boss bar. Pass null to hide.
	 * Phase 2 is visually distinct at a glance: the fill turns ember, the
	 * frame gains ember fissures and a hot rim, and the name/subtitle shift
	 * to ember. The transition itself flares once.
	 * @param {{name:string,subtitle?:string,hp:number,maxHp:number,phase?:number}|null} b
	 */
	setBoss(b) {
		if (!this._ready) return;
		const on = !!b;
		if (on !== this._bossOn) {
			this._bossOn = on;
			this.bossRoot.classList.toggle('is-on', on);
			if (!on) this._bossPhase = 0;
		}
		if (!on) return;

		const name = b.name || '';
		if (name !== this._bossName) {
			this._bossName = name;
			this.bossName.textContent = name;
		}
		const sub = b.subtitle || '';
		if (sub !== this._bossSub) {
			this._bossSub = sub;
			this.bossSub.textContent = sub;
			this.bossSub.classList.toggle('is-empty', sub === '');
		}

		const phase = b.phase | 0 || 1;
		if (phase !== this._bossPhase) {
			const rising = this._bossPhase > 0 && phase > this._bossPhase;
			this._bossPhase = phase;
			this.bossRoot.classList.toggle('is-phase2', phase >= 2);
			/* Discrete: fires once per fight, at the kiln-door burst. */
			if (rising) this._pulse(this.bossRoot, 'is-flare', 1100, 'bossFlare');
		}

		this._scaleFill(this.bossBar, ratio(b.hp, b.maxHp));
	}

	/**
	 * Place the lock-on reticle at screen pixel coordinates, or hide it.
	 * Called every frame while locked on.
	 * @param {number|null} x
	 * @param {number|null} [y]
	 */
	setLockOn(x, y) {
		if (!this._ready) return;
		const on = x !== null && x !== undefined && y !== null && y !== undefined && x === x && y === y;
		if (on !== this._lockOn) {
			this._lockOn = on;
			this.reticle.classList.toggle('is-on', on);
		}
		if (!on) return;
		/* Sub-pixel jitter is invisible and costs a compositor commit; round. */
		const rx = Math.round(x);
		const ry = Math.round(y);
		if (rx === this._lockX && ry === this._lockY) return;
		this._lockX = rx;
		this._lockY = ry;
		this.reticle.style.transform = 'translate3d(' + rx + 'px,' + ry + 'px,0)';
	}

	/**
	 * FPS counter value. Called every frame; only writes on integer change.
	 * @param {number} n
	 */
	setFps(n) {
		if (!this._ready) return;
		const v = n | 0;
		if (v === this._fps) return;
		this._fps = v;
		this.fpsNode.textContent = v + ' FPS';
		/* Colour-code the tier: bone = fine, ash = soft, ember = trouble. */
		cls(this.fpsNode, 'is-warn', v < 55 && v >= 40);
		cls(this.fpsNode, 'is-bad', v < 40);
	}

	showFps(on) {
		if (this._ready) this.fpsNode.classList.toggle('is-on', !!on);
	}

	/* ------------------------------------------------------ discrete events */

	/**
	 * Contextual interaction prompt, e.g. "E — Rest at Ember Pillar".
	 * If the text starts with a short key token followed by an em dash or
	 * hyphen, that token is rendered as a keycap chip and the rest as label.
	 * @param {string|null} text pass null (or '') to hide
	 */
	prompt(text) {
		if (!this._ready) return;
		const t = text == null ? '' : String(text);
		if (t === this._promptText) return;
		this._promptText = t;

		if (!t) {
			this.promptRoot.classList.remove('is-on');
			return;
		}
		const m = /^\s*(\S{1,12}?)\s*[—–-]\s*(.+)$/.exec(t);
		if (m) {
			this.promptKey.textContent = m[1];
			this.promptKey.style.display = '';
			this.promptText.textContent = m[2];
		} else {
			this.promptKey.textContent = '';
			this.promptKey.style.display = 'none';
			this.promptText.textContent = t;
		}
		this.promptRoot.classList.add('is-on');
	}

	/**
	 * Transient centre-low message ("SHORTCUT OPENED", "EMBER PILLAR LIT").
	 * A new toast replaces any toast in flight.
	 * @param {string} text
	 */
	toast(text) {
		if (!this._ready || !text) return;
		this.toastNode.textContent = String(text);
		this._pulse(this.toastNode, 'is-on', T_TOAST, 'toast');
	}

	/**
	 * Item acquisition banner — the one place a big ember flourish is allowed.
	 * @param {string} title   e.g. "EMBER SHARD"
	 * @param {string} [subtitle] e.g. "Attack power increased"
	 */
	itemGet(title, subtitle) {
		if (!this._ready) return;
		this.itemTitle.textContent = title == null ? '' : String(title);
		const sub = subtitle == null ? '' : String(subtitle);
		this.itemSub.textContent = sub;
		this.itemSub.classList.toggle('is-empty', sub === '');
		this._pulse(this.itemRoot, 'is-on', T_ITEM, 'item');
	}

	/**
	 * Red-ash vignette pulse. Snap to peak, then fade via the CSS transition.
	 * Under prefers-reduced-motion the peak is heavily attenuated so it reads
	 * as a soft tint rather than a flash.
	 * @param {number} [intensity=1] 0..1
	 */
	damageFlash(intensity) {
		if (!this._ready) return;
		let i = intensity == null ? 1 : clamp01(intensity);
		if (this._reduced) i *= 0.3;
		const n = this.flashNode;
		n.style.transition = 'none';
		n.style.opacity = String(0.16 + 0.74 * i);
		/* Commit the peak, then let the stylesheet's transition carry it out. */
		requestAnimationFrame(() => {
			n.style.transition = '';
			n.style.opacity = '0';
		});
	}

	/**
	 * Flash the stamina bar ember to explain a refused action.
	 * EXTENSION — call this from player.js wherever a stamina check fails.
	 * It is explicit rather than automatic because the HUD has no way to know
	 * the cost of the action that was just attempted.
	 */
	flashStamina() {
		if (!this._ready) return;
		/* Undim first so the flash is never swallowed by the idle fade. */
		this.stBar.root.classList.remove('is-dim');
		this._stDim = false;
		this._stIdle = 0;
		this._pulse(this.stBar.root, 'is-refused', 480, 'stamRefuse');
	}

	/**
	 * Upgrade summary, shown briefly after an Ember Shard / Ashplate /
	 * Vessel Fragment pickup.
	 * @param {{attack?:number|string,hp?:number|string,flasks?:number|string}} s
	 */
	setStats(s) {
		if (!this._ready || !s) return;
		if (s.attack != null) this.statNodes.attack.textContent = String(s.attack);
		if (s.hp != null) this.statNodes.hp.textContent = String(s.hp);
		if (s.flasks != null) this.statNodes.flasks.textContent = String(s.flasks);
		this._pulse(this.stats, 'is-on', T_STATS, 'stats');
	}

	/** Show/hide the controls cheatsheet (bottom-right). */
	setControlsVisible(on) {
		if (this._ready) this.controlsRoot.classList.toggle('is-on', !!on);
	}

	/* -------------------------------------------------------------- screens */

	/**
	 * Full-screen state. Only one screen is ever on. 'none' returns control of
	 * the pointer to the game — the HUD root is pointer-events:none, and only
	 * the active screen re-enables pointer events for its own buttons.
	 * @param {'none'|'title'|'death'|'victory'|'paused'} name
	 */
	screen(name) {
		if (!this._ready) return;
		const n = name || 'none';
		if (n === this._screen) return;
		this._screen = n;
		for (const k in this.screens) this.screens[k].classList.toggle('is-on', k === n);
		this.screensRoot.classList.toggle('is-on', n !== 'none');
		/* While a screen is up the in-world HUD would only be noise. */
		this.root.classList.toggle('is-occluded', n !== 'none');

		const s = this.screens[n];
		if (s) {
			const btn = s.querySelector('.av-btn');
			/* Focus after the fade so the ring does not pop in early. */
			if (btn) this._defer('focus', () => btn.focus({ preventScroll: true }), 260);
		}
	}

	/**
	 * Subscribe to screen button presses. cb receives 'start' | 'retry' |
	 * 'continue'. ('continue' is emitted by both the victory screen and the
	 * pause screen's RESUME button.)
	 * @param {(action:string)=>void} cb
	 * @returns {()=>void} unsubscribe
	 */
	onScreenAction(cb) {
		if (typeof cb !== 'function') return () => {};
		this._cbs.push(cb);
		return () => {
			const i = this._cbs.indexOf(cb);
			if (i >= 0) this._cbs.splice(i, 1);
		};
	}

	_emit(action) {
		for (let i = 0; i < this._cbs.length; i++) {
			try {
				this._cbs[i](action);
			} catch (e) {
				/* A listener must never be able to break the HUD. */
				console.error('[hud] screen action listener threw:', e);
			}
		}
	}

	/* ---------------------------------------------------------------- reset */

	/** Return the HUD to its boot state (used on respawn / new run). */
	reset() {
		if (!this._ready) {
			this._resetState();
			return;
		}
		for (const k in this._timers) clearTimeout(this._timers[k]);
		this._timers = Object.create(null);

		this.setTarget(null);
		this.setBoss(null);
		this.setLockOn(null, null);
		this.prompt(null);
		this.screen('none');

		this.toastNode.classList.remove('is-on');
		this.itemRoot.classList.remove('is-on');
		this.stats.classList.remove('is-on');
		this.hpBar.root.classList.remove('is-hit', 'is-critical');
		this.stBar.root.classList.remove('is-refused', 'is-dim');
		this.bossRoot.classList.remove('is-phase2', 'is-flare');
		this.flashNode.style.transition = 'none';
		this.flashNode.style.opacity = '0';
		/* Re-arm the transition on the next frame. */
		requestAnimationFrame(() => {
			if (this.flashNode) this.flashNode.style.transition = '';
		});

		this._resetState();
		/* Force the next per-frame write to go through by invalidating caches. */
		this.hpBar._f = this.hpBar._g = -1;
		this.stBar._f = -1;
		this.tgtBar._f = -1;
		this.bossBar._f = -1;
	}

	/* ---------------------------------------------------------- internal fx */

	/**
	 * Add `name` to `node` and remove it after `ms`. Retriggering restarts the
	 * CSS animation (which needs one forced reflow — discrete events only).
	 */
	_pulse(node, name, ms, key) {
		const k = key || name;
		if (this._timers[k]) clearTimeout(this._timers[k]);
		if (node.classList.contains(name)) {
			node.classList.remove(name);
			void node.offsetWidth; /* forced reflow: restarts the animation */
		}
		node.classList.add(name);
		this._timers[k] = setTimeout(() => {
			node.classList.remove(name);
			this._timers[k] = 0;
		}, ms);
	}

	/** setTimeout with a named slot so it can be cancelled/replaced. */
	_defer(key, fn, ms) {
		if (this._timers[key]) clearTimeout(this._timers[key]);
		this._timers[key] = setTimeout(() => {
			this._timers[key] = 0;
			fn();
		}, ms);
	}
}

/* ------------------------------------------------------------------ export */

export const hud = new HUD();
export default hud;

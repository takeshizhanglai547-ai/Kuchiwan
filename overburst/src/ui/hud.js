// ============================================================
//  HUD — every piece of 2D interface: combat HUD, title, briefing,
//  objective log, damage numbers, warnings, result screen.
//  [STUB — owned by hud agent]
//
//  CONTRACT
//    new HUD(ctx); .init(); .update(dt); .reset()
//    Owns all DOM inside #ui-root and the styles in ui/hud.css.
//    Reacts to bus: 'state' 'objective' 'damage' 'kill' 'lock' 'hud' 'phase'
//    Must call ctx.game.startMission() from the title screen action.
//    Must render: AP bar, EN bar, boost/QB reload, ammo per weapon,
//    lock reticle + multi-lock boxes, enemy AP + ACS gauge, mission
//    objectives, timer, warnings, damage numbers, result screen.
// ============================================================

export class HUD {
  constructor(ctx) { this.ctx = ctx; }

  init() {
    const root = this.ctx.uiRoot;
    root.innerHTML = `
      <div id="title-screen" class="screen">
        <div class="title-brand">OVERBURST</div>
        <button id="btn-start">START</button>
      </div>
      <div id="combat-hud" class="hidden">
        <div id="ap-bar"><i></i></div>
        <div id="en-bar"><i></i></div>
        <div id="reticle"></div>
      </div>
      <div id="result-screen" class="screen hidden"><div id="result-text"></div></div>`;
    root.querySelector('#btn-start').addEventListener('click', () => {
      this.ctx.game.startMission();
      this.ctx.input.requestLock();
    });
    this.ctx.bus.on('state', ({ to }) => {
      root.querySelector('#title-screen').classList.toggle('hidden', to !== 'title');
      root.querySelector('#combat-hud').classList.toggle('hidden', to !== 'playing');
      root.querySelector('#result-screen').classList.toggle('hidden', to !== 'win' && to !== 'lose');
      if (to === 'win' || to === 'lose') {
        root.querySelector('#result-text').textContent = to === 'win' ? 'MISSION COMPLETE' : 'MISSION FAILED';
      }
    });
  }

  reset() {}

  update() {
    const p = this.ctx.player;
    const root = this.ctx.uiRoot;
    const ap = root.querySelector('#ap-bar i');
    const en = root.querySelector('#en-bar i');
    if (ap) ap.style.width = `${(p.ap / p.apMax) * 100}%`;
    if (en) en.style.width = `${(p.en / p.enMax) * 100}%`;
  }
}

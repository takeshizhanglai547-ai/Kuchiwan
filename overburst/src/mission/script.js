// ============================================================
//  mission/script.js — the written radio script for OP-317 SLAG CROWN.
//  [owned by mission agent]
//
//  Pure data. Every beat is an ordered list of lines; mission.js pushes a
//  whole beat onto the HUD's radio queue and the HUD types them out one
//  after another. Lines are deliberately SHORT — the HUD types at 46
//  chars/s and then holds, so a 70-char line already owns the lower third
//  of the screen for ~3.5 s. Two lines per beat is the ceiling.
//
//  Voices
//    HANDLER   your operator. Terse, tactical, on your side but paid.
//    BASHO     the client. Corporate, cold, counts the invoice not you.
//    NIGHTJAR  the hostile AC. Speaks three times and means all of it.
//
//  `d` is the hold in seconds AFTER the line finishes typing.
// ============================================================

const L = (s, t, d) => ({ s, t, d: d || 2.1 });

export const RADIO = {
  // --- ACT 1 : INFILTRATE -------------------------------------
  open: [
    L('HANDLER', 'OP-317 is live. Frame link good. You are on the deck.', 2.0),
    L('BASHO', 'Basho wants the coolant grid dark. Nothing else is billable.', 2.2),
  ],
  contact: [
    L('HANDLER', 'Contact. Perimeter picket — they have already called it in.', 2.0),
    L('HANDLER', 'Do not stall in the open. Boost through them.', 1.8),
  ],
  act1Done: [
    L('HANDLER', 'Lane is clear. The basin is ahead of you.', 1.8),
    L('BASHO', 'Three coolant pylons. Burn them in any order.', 2.0),
  ],

  // --- ACT 2 : COOLANT PYLONS ---------------------------------
  pylon1: [
    L('BASHO', 'Pylon down. Thermal load is shifting to the other two.', 2.0),
    L('HANDLER', 'They scrambled the air wing. Watch your ceiling.', 1.9),
  ],
  pylon2: [
    L('HANDLER', 'Two dark. The turret grid just came up hot across the yard.', 2.1),
    L('BASHO', 'Finish it. The crown is running on one leg.', 1.9),
  ],
  pylon3: [
    L('BASHO', 'Coolant grid failed. The crown is going critical.', 2.0),
  ],

  // --- ACT 3 : NIGHTJAR ---------------------------------------
  // enemies.forceBoss() already announces the contact; these follow it.
  boss: [
    L('NIGHTJAR', 'Basho sent a wrecker. That is almost polite.', 2.2),
    L('HANDLER', 'Break its ACS before it closes. Impact is your friend.', 2.0),
  ],
  bossPhase2: [
    L('HANDLER', 'It held the strain and reconfigured. Expect missiles.', 2.0),
    L('NIGHTJAR', 'You are slower than the file said.', 1.9),
  ],
  bossPhase3: [
    L('NIGHTJAR', 'Then we do this properly.', 1.7),
    L('HANDLER', 'Blade is live. Stay off its centreline.', 1.8),
  ],
  bossStagger: [
    L('HANDLER', 'ACS failure. Put everything into it — now.', 1.6),
  ],

  // --- pressure ------------------------------------------------
  lowAp: [
    L('HANDLER', 'Your frame is failing. Use a kit or come home in a box.', 2.2),
  ],
  time120: [
    L('BASHO', 'Two minutes to extraction. The window will not wait.', 2.0),
  ],
  time60: [
    L('HANDLER', 'Sixty seconds. Finish it.', 1.6),
  ],
  time30: [
    L('HANDLER', 'Thirty seconds. Get out or get buried here.', 1.8),
  ],

  // --- resolution ----------------------------------------------
  win: [
    L('BASHO', 'Coolant grid dark. Contract satisfied. Payment cleared.', 2.4),
    L('HANDLER', 'The crown is yours. Come home.', 2.2),
  ],
  loseTime: [
    L('BASHO', 'Extraction window closed. Contract void.', 2.4),
  ],
  loseDead: [
    L('HANDLER', 'Frame is gone. Signal lost.', 2.4),
  ],
};

export default RADIO;

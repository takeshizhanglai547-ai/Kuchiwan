// src/ui/radio.js — handler LEDGER's radio lines (original writing; owner: mission/HUD designer).
// Played by game.hud.radio(key) at the mission's key beats (src/game/mission.js decides when).
// Each line: { en, jp, hold } — hold = seconds on screen (subtitles; no voice yet).
export const SPEAKER = { en: 'LEDGER', jp: 'レジャー', tag: 'HANDLER' };

export const RADIO = {
  start: {
    en: 'WAKE-01, you are on the pier. Picket squad dead ahead: five walkers. Take them apart.',
    jp: 'ウェイク01、埠頭に到達。前方にピケット部隊、五機。解体しろ。', hold: 6,
  },
  mt_half: {
    en: 'Three down. Watch your EN. Do not let it hit the red.',
    jp: '三機撃破。ENに注意しろ。枯らすなよ。', hold: 4.5,
  },
  relays: {
    en: 'Squad is scrap. Three relay generators feed the port grid. Cut them.',
    jp: '警備部隊は沈黙。中継ジェネレーター三基が港の防衛網を支えている。断て。', hold: 6,
  },
  relay_last: {
    en: 'One relay left. Grauwerk will not ignore this.',
    jp: '残るは一基。グラウヴェルクも黙ってはいないだろう。', hold: 4.5,
  },
  boss: {
    en: 'Fast heat signature inbound. That is Grauwerk\'s rig, CINDERHOUND. Do not let it corner you.',
    jp: '高速の熱源が接近。グラウヴェルクのリグ、シンダーハウンドだ。追い詰められるな。', hold: 6.5,
  },
  boss_stagger: {
    en: 'It is reeling. Hit it now!',
    jp: '体勢が崩れた。今だ、叩き込め！', hold: 3.2,
  },
  boss_half: {
    en: 'It is bleeding coolant. Stay on it.',
    jp: '冷却材が漏れている。押し切れ。', hold: 4,
  },
  low_ap: {
    en: 'Your frame is coming apart, WAKE-01. Use a repair kit.',
    jp: '機体の損傷が深刻だ。修復キットを使え。', hold: 4.5,
  },
  complete: {
    en: 'Target down. Pier 7 is quiet. Good work. Payment is cleared.',
    jp: '目標沈黙。第7埠頭は制圧した。いい仕事だ。報酬は振り込んでおく。', hold: 6,
  },
  failed: {
    en: 'WAKE-01, respond... Signal lost. Contract void.',
    jp: 'ウェイク01、応答しろ……反応消失。契約は破棄だ。', hold: 6,
  },
  timeout: {
    en: 'Out of time. Grauwerk reinforcements are on the pier. Pull out.',
    jp: '時間切れだ。増援が埠頭に着いた。撤退しろ。', hold: 6,
  },
};

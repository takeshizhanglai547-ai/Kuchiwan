# もふもふ聖犬士イッヌ 〜ワンワン帝国をやっつけろ！〜 — concept bible

Remake of `beltaction.html` (聖犬士イッヌ 〜ワンワン帝国の野望〜). Facts below were extracted from the
original's code (line numbers in the original are in parentheses where useful). Player-facing text must
be kid-friendly: hiragana/katakana + very simple kanji, short sentences, no death words (死, 殺, 血).

## Story (keep)
- ワンダフル王国 — "肉球あふれる" happy dog kingdom full of laughter and sunshine.
- On a moonless night the **ダークワンワン帝国** broke in, captured the King, and "even the stars vanished".
- **王女ペロ** asks the heroes for help: 「どうか、あなただけが たよりなのです」.
- Tutorial elder **モフじい** (stage 1 hints). Cat shopkeeper **チャム** ("〜にゃ") cheers you between stages.
- Rival **黒犬士クロイヌ** — a black-furred version of イッヌ, once the kingdom's best swordsman, swallowed by
  darkness, redeemed at the end ("やっと めがさめたよ…ありがとう").
- Final boss **ダークワンワン大帝** (2 forms here: 大帝 → 暗黒ナイト). When beaten the darkness leaves him.
- Ending: a big rainbow, the King returns, everyone fires 花火 from the castle wall, ペロ: 「このひかりは、あなたのものです」.
- Theme: "つよさは、だれかを まもるためにある".
- Kid tone: defeated foes don't die — dizzy stars → "ぽんっ" smoke puff → a heart pops → they turn into a
  happy puppy that runs off. Bosses get "purified" (dark smoke leaves, they smile, bow, run away).

## Heroes (7 — all dogs; order = select screen). Chibi: head ≈ 55% of height.

| id | name (display) | animal | key colours | silhouette marks | weapon / style |
|---|---|---|---|---|---|
| inu | 聖犬士イッヌ | cream fluffy poodle-ish pup, floppy fluffy ears | fur #fff8e6 / #ead8ad, ears #efe0b8, tabard #fdf6e0 w/ **gold paw emblem** (NOT a red cross), belt #7a5a2a gold buckle, **red cape** #e0503e | gold halo ring floating above head, red cape | short sword "つきのけん" (glowing pale-blue blade). Balanced |
| shima | 拳聖シマダックス | dachshund (long body, long floppy ears, long muzzle) | fur #b07a44, **dark stripes** #3a2210, ears #5e3c20, muzzle #c8966a | round black **sunglasses** w/ white glint, black karate belt, white gi top | bare paws (big round fist-mitts). Fast combos, ki-ball |
| nuko | 魔法使いヌコ | white Maltese girl | fur #ffffff / #efe8f6, purple eyes w/ lashes, pink cheeks | **big pink bow** #ff7ab8, bell-shaped **purple robe** #b48ae0 with gold star brooch, purple boots | star staff (purple #a07ad0 shaft, spinning pink/white star tip). Ranged magic |
| guard8 | ガードワン8ごう | big chow chow (1.25× size) | brown mane #cf8843 / #dd9850, chest ruff #e0a45f, tiny beady eyes, blue-black tongue #5a5a8a | round **silver helmet with 4 round knobs** (#e2e6ee), curled tail | giant hammer (wood shaft #5a3a1c, steel block head #d5d9e2). Slow, heavy, big range |
| watch | 怪盗ワッチ | tiny white chihuahua puppy | fur #ffffff / #d6dde8, **huge upright ears** pink inside #f4b0c4, big round blue eyes | **black top hat** #2a2d38 with red band, **red bow tie**, short black cape | gentleman's cane + throwing playing cards. Quick, tricky |
| wanden | サムライワンデン | cream poodle with a round fluffy topknot | fur #f4e8c4, black kimono #33313d, **vermilion haori** #8c2a24, obi #9c8a5e | **black eyepatch** (left eye), very long katana + long black scabbard | very long katana. Long reach, iai slashes |
| mack | 保安官マック | golden chow chow, small droopy ears | fur #f0bc62, mane #d89a3e, muzzle #f8dca8 | brown **ten-gallon hat** #5c3c1e with star, **red bandana** #b8241c, gold sheriff star, red poncho | toy cork revolver "コルクてっぽう" (pops corks/stars). Ranged |

Specials / ults (kid versions of the originals):

| id | ひっさつ (neutral) | ↑+ひっさつ | →+ひっさつ | おうぎ (ult) |
|---|---|---|---|---|
| inu | しんくうは (crescent wave projectile) | てんしょうざん (rising slash launcher) | しっそういあい (dash slash through foes) | じげんざん — 6 purple blade ribbons spin around him, everything on screen gets slashed |
| shima | はどうけん (blue ki ball) | れっかしょうりゅうきゃく (rising flame kick) | せんぷうきゃく (spinning kick travelling forward, multi-hit) | ひゃくれつ にくきゅうパンチ — he blinks around the whole screen leaving after-images, golden paw hits everywhere, big finish |
| nuko | ひょうけつまだん (3 ice shards, spread) | せいしんしょうか (star pillar that launches) | サンダーボルト (thunder strikes ahead) | ほしふるよる — a giant smiling star spirit appears and rains shooting stars |
| guard8 | ハンマーしょうげきは (shockwave along the ground) | てんしょうハンマー (upward swing launcher) | タックル (armoured charge) | メガトンクエイク — jumps off screen, slams down, the whole screen quakes |
| watch | トランプなげ (3 cards) | けむりだま (smoke puff: nearby foes get dizzy) | スライディング (slide; hit foes drop coins) | かみふぶきロックンロール — giant confetti cannon sweeps the screen |
| wanden | やえがすみ (delayed slashes appear ahead) | つばめがえし (rising slash) | しゅくち (teleport dash slash) | ひけん・めんきょかいでん — he blinks to each foe in turn with white crescent slashes, then "…のうとう。" everything pops |
| mack | スターばくだん (lobbed star bomb, bursts) | ロケットはなび (rising firework) | ドリルダッシュ | はなびだいさくせん — a cute toy plane drops fireworks across the screen |

Voices: synthesized chirps. f0: inu 300 (bright), shima 186 (low growl), nuko 520 (triangle, cat-like),
guard8 148 (heavy), watch 392 (light), wanden 228 (sharp), mack 262 (cheerful). Lines "やあっ！", "とうっ！".

## Controls (kid-friendly)
- Stick: move in x and depth (true belt, unlike the original's single lane).
- こうげき (attack): mash for a 3–5 hit combo; the last hit knocks the foe flying. Hold ~0.5 s then release: ためこうげき.
- ジャンプ: jump, press again in the air for a double jump; landing on a foe's head = ふみつけ bounce.
- こうげき in the air: air slash (up to 3 in one jump), ↓+こうげき in the air = dive.
- よける (dodge): roll with invincibility. Dodging right as an attack lands = ジャストよけ (slow-mo, "ナイス！").
- ひっさつ (special): uses 1 of 3 ✦ pips (refill over time and by hitting). Direction picks the variant.
- おうぎ (ult): button glows when the おうぎゲージ is full (fills by dealing damage / combo). Big cut-in.
- Combo counter with friendly rank words: 2+ "いいね！", 8+ "すごい！", 16+ "かっこいい！", 28+ "さいこう！",
  45+ "でんせつ！" (colours from the original rank table: #cfd8e6, #7dd0ff, #7dff5a, #ffd24d, #ff9a3a, #ff5aa0).
- Level up (けいけんち from foes): HP up + small attack up, "レベルアップ！".
- Difficulty: やさしい / ふつう / つよい. Getting KO'd: "がんばれ！" → revive in place (no game over on やさしい/ふつう;
  on つよい 3 lives then "もういちど" restarts the stage).

## Stages (7) — each: walk right, 3–4 waves (camera locks, "GO→" when clear), then a boss.

| # | name (kana) | look | foes | boss |
|---|---|---|---|---|
| 1 | おうとの まちはずれ (王都郊外) | sunny blue sky #3f8fd6→#eaf4e0, round trees, pastel houses, castle far away, pink petals drifting | wanhei, hyena, pounce, (モフじい hints) | **てつづめのガルム** — slim grey wolf general #b7c0ce, red scarf #ff5a3c, fluffy mane, iron claw gloves. claw combo, lunge, roar (knockback wave), sky dive. 「わが てつづめ、うけてみよ！」 |
| 2 | たそがれの じょうかまち | sunset #f6a24a→#f0e7c8, market stalls, paper lanterns, warm sparks | wanhei, boar, shield, bomber, kire | **りくザメ リクザメ** — blue #5b86b8 shark-dog with red collar; burrows so only the fin shows, fin charge, jump bite, chomp. 「じめんの そこから がぶっ！」 |
| 3 | つくよみの もり | magical night forest: navy #0e1538→#5a6fa0, big moon, fireflies, glowing mushrooms | pounce, thrower (bones), flyer, pierrot+balloon | **おばけのTたろう 3きょうだい** — white sheet ghosts #cfe6ff with brooms; turn see-through (can't be hit) and swoop. 「ヒヒヒ…3にんで あそんであげる〜」 |
| 4 | るりの すいしょうどう | crystal cave #0a1424→#2a5286, glowing crystals pink/cyan/purple, sparkles | ari (burrow), shield, kire, oni | **みつくびの ケルベ** — chubby purple #8a6fc0 dog with 3 heads (each with its own expression); claw combo, dash thrust, calls helpers. 「みっつの あたまから にげられないぞ！」 |
| 5 | かいぞく ひこうてい | airship deck above a sea of clouds, bright afternoon #7ec8f0→#fff1c8, sails, propellers | hyena, boar, bomber, flyer, thrower | **キングスライム** — big green #7dff5a jelly with a tiny crown; bounces and slams; when hit hard it splits into small slimes. 「ぷるぷる…たたくほど ふえるぞ！」 |
| 6 | ひょうせつの れいほう | snowy peak #9fc4e8→#f4f8fc, glaciers, icicles, falling snow | wanhei, oni, ari, pounce, mecha | **ひりゅう ヴォルカ** — red #d6532e baby-ish dragon with wings and horns; fire breath that runs along the ground (jump over it!), dive-bomb. 「ジャンプで かわせるかな？」 |
| 7 | ダークワンワンじょう | purple castle #0a0618→#5a2a8c but candy-dark and cute, torches with purple flames, banners | mecha, shield, oni, kire, pierrot | mid: **こくけんし クロイヌ** (black イッヌ, purple cape, purple blade; copies inu's moves, parries) → final: **ダークワンワンたいてい** (big round black emperor, purple cape w/ white fur trim, gold crown with red gem, red eyes, gold staff with purple orb; dark swipe, orb spread, beam, summon) → form 2 **あんこくナイト** (black armoured knight, red triangle eyes, red light blade; spinning slash, sky slashes rain, beam). 「ワンワンていこくの ちからを おもいしれ！」 |

## Common foes (ダークワンワン帝国の へいたい). Chibi, round, grumpy-cute (yellow angry eyes, thick
brows, black collar with white round studs); on hit: × eyes + blue sweat drop.

| type id | name | look | behaviour |
|---|---|---|---|
| wanhei | わんこへい | grey wolf pup #9aa0ab, pointy ears | basic melee (paw swipe / bite) |
| hyena | ハイエナけん | tan #b9824a, 3 spiky ear tufts, lanky | fast, weak, hit & run |
| boar | イノシシへい | brown boar #84603e, green belly band, little tusks | telegraph then charge along x |
| shield | たてわんこへい | blue-armoured #6f9ad0 dog with a pale-blue oval shield | blocks hits from the front; hit from behind / jump / heavy |
| pounce | ジャンプけん | orange #cf6a36 lean dog | crouch then leap attack from mid range |
| bomber | びっくりチワワ | cream chihuahua with a lit fuse on its head | runs at you and pops into confetti (small area hit, also hurts foes) |
| thrower | ほねなげけん | skeleton-costume dog (kid-cute) | throws bones in an arc from range |
| flyer | タカけん ハヤブサ | dog with bird wings, goggles | hovers at height, swoops down |
| kire | キレボウズ | red round blob-monk, headband, topknot | periodically "ぷんぷん！" → faster & more attacks, then "ふぅ…" |
| pierrot | ピエロボウズ | blue body, white face, red nose, cone hat | keeps distance, calls up to 4 **balloon** foes (red balloons with "O" mouths, float, weak) |
| oni | オニボウズ | big blue ogre-monk, gold horns, tiger-stripe waist cloth, club | heavy slow club smash; purple circle under it powers up nearby foes |
| ari | へいたいアリ | black ant with red scarf and shovel | "もぐった！" burrows and pops up under the player |
| mecha | メカワンコ | robot dog, one red glowing eye | shoots slow red beam balls, armoured (flinches less) |

## Pickups
ほね (small heal), ケーキ (big heal), ハート (full heal, rare), コイン (score), ほし (fills ひっさつ ✦).
Breakable props (たる・はこ・つぼ・かぼちゃ・クリスタル) drop them.

## Look & feel checklist (every visual module)
- Pixar lighting (core does warm key / cool rim / sky fill + ACES). Use `G.look.mat` / builder with vertex
  colours; outline 0.018–0.03 dark warm brown `#3b2417` (chiikawa line).
- Separate lightness into 3 steps before choosing hues (dark cloth / mid fur / light highlights); a
  cream dog on a cream tabard becomes one blob.
- Squash & stretch everywhere: anticipation before attacks, overshoot on landing, jiggle on hit.
- Big readable silhouettes at phone size: the hero is ~12% of screen height.

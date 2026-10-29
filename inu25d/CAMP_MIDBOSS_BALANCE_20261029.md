# Integrated local candidate, 2026-10-29

This specification supersedes the earlier pending-tool/midboss statements in the dated polish notes. Public752 and the original save are preserved. No publication or authentication is performed.

## Confirmed scope and implementation choices

The user clarified **道具** and **中ボスとして扱う**. Kosodoro is a midboss, not a Chinese-art instruction. Returning stolen capacity on defeat was a parent-proposed reasonable interpretation, not a quoted user specification. Numerical caps, retry cleanup and prices for the new companion draw are implementation choices documented below.

## Cham's tools and equipment

The four tools execute the original 2D `SHOP_ITEMS[0..3].buy()` code in the selected player's isolated native context. Prices are read from that same original table:

| Tool | Coins | Actual effect |
| --- | ---: | --- |
| Recovery potion | 18 | HP +60, capped at maximum |
| Full potion | 42 | HP to maximum |
| Energy drink | 22 | Ultimate stock +1, capped |
| Paw manju | 60 | HP and ultimate stock to maximum |

The original manju text mentions a life refill but its actual code does not grant lives; this candidate describes the actual effect. Purchases enter shared inventory, maximum nine of each. This deliberately adapts the original immediate-use shop to stored tools. After-clear shop allows purchases. During combat, pause → **道具を使う** opens a use-only bag with P1/P2 selection. It cannot buy equipment, draw companions or advance stages. Closing retains pause. Dead/foreign targets, full stats, empty stock and active combat reject use without consuming inventory. Saving failure restores native HP/stock and coins; a later presentation refresh failure does not undo a committed effect.

Character weapons keep original pricing, eligibility and native combos/ultimates. Ownership is shared by hero; P1/P2 loadouts remain independent even when both choose the same hero. New visible weapon meshes follow the original weapon root. Existing save fields are preserved; the camp uses a separate versioned key. Unknown future camp versions remain read-only.

## Companions

Provisional game-coin tuning: 90 coins per draw, seven existing heroes each 1/7, duplicate refund 30, three companions total across the human team. Cost, probability, duplicate behavior and cap are shown before drawing. A draw's debit/result is one saved transaction. No real-money currency, accounts or external service. Companions deal basic assistance, can fall for the current stage, cost no human life and return next stage. P2-following choices safely fall back to living P1 when necessary.

## Kosodoro midboss

Stage2 and Sengoku each gain one explicit midboss arena; the original stage7 midboss is preserved. Hood, mask, articulated limbs and a growing loot bag distinguish Kosodoro. Melee snatch, phase-two dash and thrown purse have 36/42/44-frame warnings. Half-HP phase is single-trigger and uses the existing cinematic/visual system.

Only a confirmed positive hit on a living human steals capacity, once per attack/projectile per player. Per hit: up to 10% of clean attack multiplier and 5% of clean maximum HP. Across thieves, the victim keeps at least 60% attack and 70% maximum HP (HP floor at least10 unless the clean maximum is lower). An individual thief cannot grow more than50% above its initial attack/HP. No tool, permanent weapon or move is destroyed.

Each player's exact additive debits are tracked separately. Defeat refunds those debits to current values, preserving levels and equipment earned meanwhile. Current HP is clamped, not fully healed by refund. Retry, title exit, removal or stage transition also settles temporary debits to avoid permanent corruption. This is a safe retry-reset choice; debt is not written into permanent saves. Carry data excludes temporary debits. Ordinary player death/revival during the same encounter retains the debt until settlement. Reflected or stale projectiles and lethal hits cannot create new debt.

## Enemy durability and pressure

One spawn-time multiplier applies to each enemy's existing difficulty/stage-scaled HP: normal foes **1.25**, bosses/midbosses **1.18**. Same-screen co-op additionally multiplies normal foes by **1.35**, bosses by **1.40**. Total new factors: 1P1.25/1.18, 2P1.6875/1.652. Boss transformation uses that same `hpMul`; it is not multiplied again on half-HP or form change.

Discretionary idle/reposition cooldown target ratios are 1P normal0.84/boss0.88, 2P normal0.78/boss0.82. Floors remain12/18 ticks. Attack animation, windup, active frames, movement speed, hitstun, grab, knockdown, guaranteed punish windows and Sky Armor's108-tick grounded opportunity are not accelerated. Cutscenes, pause and hitstop suppress extra countdown. Real-AI probes showed a100-tick sniper wait finishing in86/81 ticks and unchanged49-tick telegraph. A moving Garm's cooldown after50 ticks changed50→44/40 while velocity stayed identical.

These are conservative provisional increases, not a claim of human difficulty acceptance. Existing difficulty, stage and phase modifiers still apply, with separate single-application tests. Tools do not add permanent attack upgrades; equipment and three companions create variable team power, so a single exact fight duration would be misleading.

## Damage-budget evidence and limits

`tools/benchmark25d-camp-dps.cjs` records56 ten-second native Attack-tapping probes: seven heroes, default/example high-price equipment, four distances. A stationary non-retaliating target is deliberately kept within the tested distance; this measures native damage budget rather than a playable encounter. Long weapons can miss at point-blank range. Three ordinary companions nominally add about5.91 damage/second before leader attack, armor, travel or target availability. Human combat uptime and simultaneous target overlap are not measured.

For a fixed effective team DPS `D`, an enemy of HP `H` has the simple estimate `H/D` seconds. For example a900-HP boss becomes1062 in1P,1487 in2P: at20 effective DPS these are53.1/74.4 seconds; at40 DPS26.6/37.2 seconds. These are arithmetic scenarios, not observed fight times. The actual emperor's later forms, armor, telegraphs and reactions require gameplay validation.

Hero effects gain thicker colored strokes, dark edges, light cores and clearer flame/holy blades. CPU phone/tablet comparisons show stronger separation without opaque screen-filling overlays. Actual-hit bursts remain distinct from miss silhouettes. All seven heroes' native action traces are compared. Inu's dedicated special lacks a native attack-display window, so its original special particles are retained rather than inventing a damaging attack.

Browser/WebGL/iPad quality, trusted multitouch, GPU frame rate, installation/offline behavior and audio/balance feel remain unverified. CPU triangle renders and synthetic DOM/native tests do not replace those checks. Previously denied browser/PowerShell paths were not retried or bypassed.

## Final local verification

Final full serial run:61 suites PASS, plus the4-case companion-pressure suite PASS (62-suite coverage). Expanded stage2/Sengoku progression test rerun PASS4 groups. PWA16 cache +10 UI +2 build variants PASS. Release `2594adaf`. This is not a public deployment or device acceptance.

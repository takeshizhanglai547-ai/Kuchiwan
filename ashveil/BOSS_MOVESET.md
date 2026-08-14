# VOLGA, THE KILNWARDEN — moveset & fairness sheet

The brief's requirement for this boss is not difficulty; it is that **for every
attack, we can explain why the player is able to avoid it.** That explanation is
below, per move, with the numbers that back it.

All timings are in seconds, measured from the start of the animation clip.
`telegraph` = the point by which the wind-up pose is fully readable.
`punish` = the window after the attack during which Volga cannot act.

Source of truth: `src/actors/boss.js` (`MOVES` table) and `src/actors/anim.js`.

---

## Identity

A kiln-priest fused to its own furnace. Asymmetric by design: one massive right
arm carrying a 3.2 m iron kiln-rake, one shrivelled left arm, and a working kiln
door set into its chest. 4.6 m tall, built on the same rig as every humanoid in
the game at 2.35× scale.

**Silhouette test**: at any distance, in any lighting, Volga is the only thing in
the game that is (a) that tall, (b) lopsided, and (c) glowing from the torso.
No other actor shares any of those three traits.

**Spectacle move**: the phase transition (below). The kiln door bursts open, the
arena's floor veins light, and the rules of the fight change in the same beat.

---

## Phase 1 — sealed kiln

| Move | Telegraph | Active | Punish | Damage | Why it is avoidable |
|---|---|---|---|---|---|
| **SWEEP** | 0.86 | 0.98–1.22 | **0.83** | 26 | The rake drags back and **low**, and the body coils hard to Volga's right — a pose used by no other move. The arc passes at knee height through a 180° front cone, so it is dodged by rolling *through* it or stepping outside the rake's 5.8 m reach. Reach is the rake's actual length; nothing connects beyond the visible head. |
| **SLAM** | 1.00 | 1.12–1.32 | **1.08** | 34 | Volga rears to its **full height** — the tallest silhouette in the fight — then drives the rake into one spot. It has a 3.4 m shockwave, but the safe ground is everything outside that circle, and the wind-up is a full second. Longest punish window in phase 1: this is the move the fight wants you to learn to farm. |
| **DELAY** | 1.55 | 1.68–1.96 | **0.74** | 32 | The bait. For the first 0.55 s the wind-up is *deliberately* near-identical to SLAM; then it **holds a further second** before falling diagonally. A player who rolls on the visual peak is caught; a player who waits for the arm to actually move is not. The hold is a static pose, not an accelerating one, so the difference is readable rather than reflex-based. |
| **DRAG-STEP** | 0.40 + travel | 1.08–1.42 | **0.78** | 28 | The anti-turtle. Volga crouches low with the rake trailing, then covers ground in a straight, committed line (root motion, 7.2 m/s for 0.64 s). Because the line is fixed at commit time, it is beaten by moving **laterally**, never by running away — which is exactly the lesson it exists to teach. Only used from 5–15 m. |
| **EMBER LANCE** | 0.78 | projectile at 0.90 | **1.05** | 30 | The heal punish. The chest kiln opens and brightens, aimed at the player, for 0.78 s before firing a single projectile on a fixed line. Strafing beats it. Armed for 0.9 s whenever the player drinks, and only fires if the player is 4–22 m away — inside 4 m it would be an unavoidable point-blank hit, so it is simply not chosen there. |

**Repetition guard**: the same move is never selected three times in a row
(`_lastMoveCount >= 2` zeroes its weight). Variation is enforced, not hoped for.

**Tracking honesty**: Volga stops turning toward the player at 60 % of the
telegraph (220 % for DRAG, which is a chase by design). After that point the
attack is committed to a direction. This is what makes the telegraph mean
something — an attack that tracks until the active frame is not a telegraph, it
is an announcement.

---

## Phase transition — at 55 % HP

Not a stat bump. Three things happen at once:

1. **Spectacle** — Volga buckles, then erupts upright; the kiln doors blow open
   (real geometry: `kilnDoorL/R` swing to ±1.25 rad and stay open), a burst fires
   from the chest, the screen shakes, and the music escalates to `boss2`.
2. **Rule change A — the arena becomes hostile.** Volga gains ERUPT: it plants
   the rake and lights five ember veins radiating through the player's position.
   The veins glow for **1.1 s** before they blow, and the gaps between them are
   always walkable. Standing still is what gets punished — not standing anywhere.
3. **Rule change B — guarding stops being a complete answer.** In phase 2 every
   Volga attack becomes `HEAT` damage. With the kiln open
   (`rules.chipThroughGuard`), heat bleeds 32 % of its damage **through a block**.
   The defensive answer shifts from guard to spacing and rolling.

Volga is invulnerable for the 3.4 s transition, and its cooldown range tightens
from 0.85–1.7 s to 0.55–1.15 s — faster, but every telegraph keeps its full
length. **No punish window is shortened in phase 2.**

---

## Phase 2 — open kiln

| Move | Change from phase 1 |
|---|---|
| SWEEP / SLAM / DELAY / DRAG | Identical timings. Damage type becomes HEAT (chips through guard). |
| DELAY | Weight rises 2 → 3: the bait becomes the fight's signature. |
| SLAM | Weight drops 3 → 2 (its long punish window is now rarer). |
| **ERUPT** | New. Telegraph 0.86, veins warn for a further 1.1 s, punish 0.90, 22 damage, unblockable — the one attack a shield was never going to answer. |

---

## Design ledger

**Why the player can win.** Every phase-1 move gives back ≥ 0.74 s of free
attacking. The player's fastest light attack is 0.60 s end to end with active
frames at 0.26 s, so *every* punish window fits at least one full swing, and
SLAM's fits two. The fight is winnable purely by punishing SLAM.

**Why the player can lose.** DELAY exists to kill players who learned SLAM's
timing and stopped watching. DRAG exists to kill players who treat distance as
safety. LANCE exists to kill players who heal on reflex instead of on read.

**Known compromise.** Volga has no ranged option under 4 m other than melee, so a
player who stays glued to its legs and rolls through everything faces a narrower
moveset than one who uses the whole arena. Widening that is the first thing I
would add with more time.

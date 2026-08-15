# AC design bible — the frame itself

Supplements ART_DIRECTION.md. That document covers the world, the VFX and the HUD.
This one covers **the machines**, and it is deliberately much more specific, because
"make it look like Armored Core VI" is not an instruction a builder can check their work
against. Everything here is.

The previous passes produced a *credible industrial walker*. That is not the target. An
Armored Core is a **sleek, aggressive, expensive war machine** — closer to a fighter jet
that stands up than to a construction mech. This document is the difference.

---

## 1. The single most important rule: BIG PLATES, CONCENTRATED DETAIL

This is the thing every attempt so far has got backwards.

An AC is **not** uniformly greebled. Its surface is mostly **large, clean, unbroken
armour planes** — a shoulder shell is one sweeping surface, a thigh is one tapered
volume. The mechanical density is **concentrated** in a few places: the joints, the
vents, the weapon mounts, the booster throats, the waist. The contrast between a calm
plate and a dense mechanical cluster is the entire signature.

Detail sprayed evenly over everything reads as noise, and noise reads as cheap. When in
doubt: **remove greebles from the flat areas and spend them on the joints.**

Rule of thumb per limb: ~70 % clean armour surface, ~30 % concentrated mechanism.

---

## 2. Proportions (player frame, 11 units tall)

Measured from the sole. These are hard targets, not suggestions.

| element | height band | notes |
|---|---|---|
| feet + ankle | 0.0 – 1.0 | wide sole plate, backward-swept heel spur |
| shin | 1.0 – 3.6 | narrow armoured shell over a visible inner frame |
| knee | 3.6 – 4.4 | overhanging armour cap with a **pointed leading tip** |
| thigh | 4.4 – 6.4 | the heaviest single volume on the machine, tapering upward |
| hip / waist | 6.4 – 7.2 | **the narrowest point of the whole frame** |
| core | 7.2 – 10.0 | chest slopes forward and outward toward the shoulders |
| shoulders | 9.0 – 10.6 | widest point; armour sweeps up and back |
| head | 10.0 – 11.0 | **tiny** — about 1/7 of core height, set LOW between the shoulders |

Key silhouette relationships:
- **Shoulder width : waist width ≈ 3.4 : 1.** The waist pinch is the defining line.
- Legs are ~58 % of total height. The machine is leggy, not squat.
- The head is recessed — the shoulders rise past it. Never a head on a neck on top.
- Front view reads as an **arrow / inverted triangle**: wide shoulders, pinched waist,
  then planted wide again at the feet.

---

## 3. Shape language — this is what "stylish" means here

**Angles, not boxes.** Every major volume should be a chamfered, tapered or swept form.
A rectangular prism is only acceptable as an internal frame member that armour hides.

- **Chest**: slopes forward from the waist, with a **V-cut** intake at the sternum and a
  raised central spine. The shoulders are carried on a yoke that reads as a separate
  structure from the chest box.
- **Shoulder armour**: swept back with a **pointed leading edge**, like a fighter's
  intake lip. It overhangs the upper arm. This one form does more for the silhouette
  than anything else on the machine.
- **Forearm**: a tapered armoured shell, wider at the elbow, narrowing toward the muzzle
  end. The weapon unit clamps to it and is often **longer than the arm itself**.
- **Knee cap**: overhangs the shin, comes to a point at the front.
- **Ankle**: swept back into a heel spur; the sole plate is wide and flat with a raised
  toe. Think of a bird's foot loaded onto a hydraulic column.
- **Back units**: stand off the shoulders on **pylons**, angled slightly outward, so
  there is daylight between the unit and the body. That gap is a huge readability win.

**Never**: rounded/soft corners, uniform box stacks, symmetrical detail sprayed evenly,
smooth featureless plastic, or a head that reads as a face.

---

## 4. Joints — the genre tell

Every articulation must show mechanism, at a scale that reads at 20–40 m:

- **Knee**: a visible actuator cylinder running from the thigh to the shin, plus a
  **pivot boss** (a raised cylindrical hub) at the axis, capped with a hex plate.
- **Hip**: a ball housing with a cover plate, plus a hose bundle crossing to the thigh.
- **Shoulder**: a **collar** capping the gap between the yoke and the upper arm, so
  there is no visible hole into the torso, plus a short actuator to the upper arm.
- **Elbow**: a pivot boss and a small actuator.
- **Ankle**: a ribbed rubber boot over the joint, with two visible piston rods.

Hoses are dark, matte, and slightly sagging. Actuator rods are **bare polished metal** —
they are one of the few genuinely shiny things on the machine, and that contrast matters.

---

## 5. Boosters

- **Main**: a cluster of 2–4 large bell nozzles on the **lower back**, angled down and
  back, mounted on a visible backpack block. Bell throats are heat-stained to near-black
  inside with a bright emissive core.
- **Side / vernier**: smaller nozzles at the hips, shoulder blades and outer calves.
  These are what fire during a lateral quick boost, and they must be visible from the
  front and side, not only from behind.
- Every nozzle needs a **visible throat depth** — a flat glowing disc reads as a sticker.

---

## 6. Materials and colour

Three tones, no more:

1. **Body** — the dominant armour colour. Satin, roughness 0.30–0.45. Painted, so it
   catches a soft specular sheen.
2. **Frame** — near-black charcoal at the joints, inner shin, waist, and anything the
   armour covers. Rougher, 0.55–0.7.
3. **Metal** — bare polished steel on actuator rods, pivot bosses, and weapon barrels.
   Roughness 0.15–0.25, metalness 1.0. This is what makes the machine read as *milled*.

Plus **one accent**: player cyan `#4fd9ff`, hostile ACs orange-red `#ff5a2b`, NIGHTJAR
violet `#d93cff`. The accent is confined to the head optic, booster cores, and a small
number of painted seam stripes. Nothing else glows.

**Chamfers must catch light.** A side-facing bevel gets a **roughness drop**, not an
albedo lift, so it throws a moving specular streak. A painted-on bright edge is the
signature of a plastic toy; a specular streak is the signature of milled steel.

Weathering is **restrained** on an AC — this is expensive equipment, maintained between
sorties. Edge wear on chamfers, soot around booster throats and vents, a little grime in
the recesses. Not a rust bucket. (MTs, by contrast, are neglected industrial equipment
and *should* look beaten.)

---

## 7. The enemy AC roster

MTs are cannon fodder. **ACs are duels.** They have AP in the thousands, use the player's
full movement vocabulary — quick boost, assault boost, hover — and must be fought, not
mown down. Encountering one should change the temperature of the mission.

Four hostile frames. Each must be distinguishable **by silhouette alone at 100 m**.

### `ac_light` — "SHRIKE" — lightweight biped
Fast harasser. Reverse-joint legs, minimal armour, twin pulse blades, no back units —
just a low-profile booster pack. Silhouette: thin, forward-leaning, all legs.
Behaviour: constant quick-boosting, closes to blade range, never stands still.
AP ~5,200. The one that teaches you to lead your shots.

### `ac_mid` — "KITE" — standard biped
The baseline duellist, the closest thing to the player's own frame. Rifle + missile rack.
Silhouette: balanced, one back unit on the right pylon.
Behaviour: mid-range trading, strafes, boosts out of your reticle when you commit.
AP ~7,400.

### `ac_heavy` — "BULWARK" — tetrapod
Four legs, no waist pinch, enormous shoulder cannons. Silhouette: wide, low, unmistakable.
Behaviour: barely moves, hovers to stabilise, punishes standing still with heavy shells.
Break it by getting close and staggering it.
AP ~11,000.

### `boss` — "NIGHTJAR" — the apex AC
Already specified. Taller and sleeker than all of them, four back units, reverse-joint
legs, violet optic, three phases. It should read as the same *class* of machine as the
others but obviously the best of them.
AP 24,000.

Hostile ACs get **their own AP bar treatment** in the HUD — an AC is an event, not a
target of opportunity — and an arrival callout on the radio.

# PIANO ROOM REQUIREMENTS — CRITICAL

> ★★★ **This document governs the single most important requirement in the
> project.** The 1F ~17.3 帖 space **must** be delivered as a
> **GRAND PIANO SOUNDPROOF MUSIC ROOM**.
>
> It may **not** be modelled as a general room, spare room, guest room, plain
> western room, or multi-purpose room. This requirement has been lost in
> previous attempts at this model; it is now enforced mechanically by
> `scripts/qa_verify.py`, which fails the build rather than shipping without it.

**Brief sections:** B (absolute priority), C (two grand pianos), D (soundproof
construction), E (visual design).

---

## 1. The requirement in one page

| # | Requirement | Source | Enforced by |
|---:|---|---|---|
| R1 | The 1F 17.3 帖 space is a soundproof music room | brief §B | `QA-CRIT-01` |
| R2 | Two grand pianos are physically installed in it | brief §C | `QA-CRIT-02` |
| R3 | Both instruments have real, catalogue dimensions — no toy models | brief §C | `QA-CRIT-03` |
| R4 | Two performers can play simultaneously | brief §C | `QA-CRIT-04` |
| R5 | Acoustic construction reduces the internal dimensions, and that reduction is computed, not ignored | brief §D | `QA-CRIT-05` |
| R6 | The room is reachable and explorable in the Unreal walkthrough | brief §O | `QA-CRIT-06` |
| R7 | Modelled at residential-salon quality, not as a bare studio | brief §E | `QA-CRIT-07` |

Any single FAIL ⇒ **the project is not complete.** No exceptions, no partial
sign-off.

---

## 2. Why "17.3 帖" is not the answer to "will two grands fit?"

Three separate reasons, all quantified in
[`PIANO_FIT_REPORT.md`](PIANO_FIT_REPORT.md):

1. **帖 is ambiguous.** 17.3 帖 is 28.65 m² or 28.03 m² depending on the
   convention. Several candidate layouts have under 50 mm of slack, so 0.63 m²
   is not noise.
2. **Area does not fix shape.** 28.65 m² is 5.35 × 5.35 m *or* 3.53 × 8.12 m.
   Different rooms, different answers.
3. **The lining eats the room.** A piano-grade acoustic box is built *inside*
   the structural shell. Roughly **11 % of the floor area** and **350 mm of
   ceiling height** disappear. 17.3 帖 on the plan is about 15.3 帖 of playable
   room.

---

## 3. Instrument data (authoritative — `scripts/lib/pianos.py`)

Manufacturer nominal case dimensions. Width is set by the keyboard and barely
varies with model; **length** and **mass** are what change.

| Instrument | Class | Length | Width | Height | Lid open | Rim depth | Mass |
|---|---|---:|---:|---:|---:|---:|---:|
| Yamaha CFX | Concert | 2.750 m | 1.585 m | 1.020 m | 2.00 m | 0.375 m | 500 kg |
| Steinway D-274 | Concert | 2.740 m | 1.560 m | 1.015 m | 1.98 m | 0.370 m | 480 kg |
| Shigeru Kawai SK-EX | Concert | 2.780 m | 1.560 m | 1.020 m | 2.00 m | 0.370 m | 465 kg |
| Yamaha C7X | Semi-concert | 2.270 m | 1.510 m | 1.020 m | 1.90 m | 0.360 m | 405 kg |
| Steinway B-211 | Semi-concert | 2.110 m | 1.480 m | 1.015 m | 1.85 m | 0.355 m | 345 kg |
| Yamaha C5X | Medium | 2.000 m | 1.490 m | 1.010 m | 1.82 m | 0.355 m | 350 kg |
| Yamaha C3X | Medium | 1.860 m | 1.490 m | 1.010 m | 1.80 m | 0.355 m | 320 kg |
| Kawai GX-2 | Medium | 1.800 m | 1.500 m | 1.010 m | 1.78 m | 0.350 m | 326 kg |

88-key playing width is 1.225 m on every instrument above.

**The client has not nominated instruments.** The project default is
C7X + C3X (ASSUMED); the study also evaluates two concert grands as the
worst case. *Nominating the actual instruments is a high-value decision* —
it changes the room by half a metre.

### 3.1 What must be modelled per instrument (brief §C)

Body · lid (with prop) · keyboard (88 keys, individually modelled) · music
desk · legs · castors · pedal lyre and three pedals · fallboard · cheek blocks ·
soundboard and strings visible under an open lid · bench · **seated performer
as a human-scale reference**.

Simplified or toy piano geometry is a `QA-CRIT-03` failure.

---

## 4. Acoustic construction (all ASSUMED — no specification supplied)

| Element | Assumed | Range | Effect |
|---|---:|---|---|
| Inner wall build-up, per side | 150 mm | 120–200 mm | −300 mm on each plan dimension |
| Floating floor (浮床) rise | 150 mm | 100–200 mm | −150 mm ceiling |
| Isolated ceiling (防音天井) drop | 200 mm | 150–250 mm | −200 mm ceiling |
| Target isolation | Dr-50 | Dr-45 marginal for two grands | — |

Assumed build-up, to be confirmed against the real acoustic specification:

- **防振床 / 浮床** — isolators (glass wool or rubber), then a floated deck.
- **二重壁** — independent inner stud frame, air gap, absorbent infill, two
  layers of board, resiliently fixed.
- **遮音層 + 吸音層** — mass for isolation, absorption for internal control.
  These are different jobs; do not let one specification pretend to do both.
- **防音天井** — resiliently hung, isolated from the structure above.
- **防音ドア** — see §6, this is a problem.
- **防音換気** — attenuated supply and extract.
- **防音空調** — isolated penetrations, low-noise unit.
- **音響調整材** — absorption panels, timber louvre diffusion, drapery.

---

## 5. Findings — read these before the drawings are finalised

### 5.1 Volume is the binding constraint, not floor area

Every candidate shape, at every plausible ceiling height, falls short of the
~76 m³ guidance for two grand pianos (≈38 m³ each). The best case tested was
**68.4 m³** at a 3.00 m gross ceiling — still short.

Two grands **will fit on the floor**. The room will still be *small* for them:
loud, and dependent on heavy absorption to stay playable at full dynamic range.

Options, in rough order of cost:

1. Accept it, and budget properly for variable absorption (drapery, panels).
2. Choose smaller instruments — two C3X-class grands instead of two concert grands.
3. Raise the music-room ceiling. A change to the section.
4. Open the room into a void or vaulted ceiling to borrow volume — the most
   effective acoustically, the most disruptive architecturally, and in direct
   tension with isolating the room from the rest of the house.

### 5.2 Room proportion — one candidate is clearly best

Of the shapes tested, **4.550 × 6.370 m gross** (a clean 10 × 14 module room on
a 455 mm grid) has both the largest net floor area *and* the best-behaved
low-frequency mode distribution — one degenerate axial pair against five for a
square room. **If the music-room proportion is still open with Daiwa House,
this is the one to ask for.**

Avoid a square or near-square plan. Avoid anything longer than about 1 : 2.

### 5.3 Ceiling height has a statutory floor, and the lining eats into it

**建築基準法施行令第21条**（居室の天井の高さ）requires a 居室 to have a ceiling
height of **2.1 m or more**.
<https://laws.e-gov.go.jp/law/325CO0000000338>

A music room used continuously for 娯楽・作業 falls within the definition of
居室 in **建築基準法第2条第4号**.
<https://laws.e-gov.go.jp/law/325AC0000000201>

The arithmetic matters here:

| Gross ceiling | − lining (350 mm) | Finished height | 令21条 (≥2.1 m) |
|---:|---:|---:|---|
| 2.400 m | | **2.050 m** | ✗ **below the statutory minimum** |
| 2.500 m | | 2.150 m | ✓ (50 mm spare) |
| 2.720 m | | 2.370 m | ✓ |
| 3.000 m | | 2.650 m | ✓ |

> ⚠️ At a 2.4 m gross ceiling with a 350 mm acoustic build-up, the finished
> music room would be **2.05 m** — below the 令21条 minimum. At a 2.5 m gross
> ceiling the margin is 50 mm, which is inside the tolerance of the build-up
> assumption. **The music-room ceiling height must be checked against the
> acoustic build-up before the 確認申請, not after.**

Two further points to put to Daiwa House:

- **採光 (daylight).** 建築基準法第28条第1項 requires a 住宅の居室 to have an
  effective daylight opening area of at least 1/7 of its floor area — about
  4.1 m² for a 28.65 m² room. A soundproof room naturally wants small or no
  windows. Note that 建築基準法施行令第19条第3項 was relaxed (effective
  2023-04-01) to permit a lower ratio where compliant lighting equipment is
  installed; **confirm the current text and the applicable 告示 on e-Gov, and
  confirm the route with the 確認検査機関.**
- **換気 (ventilation).** 法第28条第2項 requires openings of at least 1/20 of
  floor area, unless mechanical ventilation under 令第20条の2 is provided — which
  a soundproof room will need in any case, alongside the mandatory 24-hour
  ventilation under 令第20条の8.

*This section flags regulatory checkpoints for coordination with the builder.
It is a modelling note, not a legal opinion, and the 確認申請 remains Daiwa
House's responsibility.*

### 5.4 Delivery — a typical acoustic door cannot admit a grand piano

A grand is moved on its bass side on a skid, legs and pedal lyre removed. The
case does not get smaller.

| Instrument | Length on skid | Thickness | Height on skid | Mass |
|---|---:|---:|---:|---:|
| Yamaha C3X | 1.86 m | 0.36 m | 1.64 m | 320 kg |
| Yamaha C7X | 2.27 m | 0.36 m | 1.66 m | 405 kg |
| Yamaha CFX | 2.75 m | 0.38 m | 1.73 m | 500 kg |

Movers' practical minimum clear opening: **800 × 1900 mm**.
A typical single-leaf 防音ドア: **≈750 mm** clear — acoustic doors are heavy and
gasketed, and tend to be *narrower* than ordinary internal doors.

> ⚠️ **This is a plausible show-stopper and it is invisible on a plan.**

Resolution options:

1. Oversize or double-leaf acoustic door.
2. A removable acoustic wall panel, used once at installation.
3. A full-height sliding sash (掃き出し窓) to the garden as the delivery route —
   often the cleanest answer, and it doubles as the room's daylight.
4. Install both instruments before the acoustic lining is closed up — a
   sequencing constraint that must be agreed with Daiwa House in advance.

Also to confirm: the turning geometry from the entrance through the hall to the
room opening for a rigid 2.75 m object, and the floating floor's point-load
capacity under up to ~900 kg of instrument on eight castors.

---

## 6. Layout — the nested duo

Of five layouts evaluated, the **nested duo (対向ネスト配置)** is the only one
that fits two grands in this room with useful margin, and it is also the
correct layout musically: tails interlocked, keyboards opposed, players facing
each other with a clear sightline.

Consequences to model honestly:

- The inner instrument's lid is normally **removed or half-propped**. Two fully
  propped lids in a nested pair block the sightline.
- The two tails pass each other in opposite halves of the room's width — this
  is what makes the layout compact and it must be modelled correctly, not
  approximated with two rectangles.
- Tuning access is at the keyboard end of each instrument; the player zones
  double as tuner zones.

Clearances applied (ASSUMED):

| Clearance | Value |
|---|---:|
| Wall → piano case | 500 mm |
| Piano → piano | 600 mm |
| Bench + player zone, per instrument | 1100 mm deep × 1400 mm wide |
| Bench → other instrument's rim | 100 mm |

---

## 7. Visual design — Luxury Residential Music Salon (brief §E)

Not a studio. The room must read as part of a xevoΣ PREMIUM house.

Natural timber · timber louvre acoustic panels (diffusion that looks like
joinery) · concealed cove lighting · dimmable circuits · picture light ·
score storage and sheet-music shelving · a reflective front wall and an
absorptive rear wall · heavy drapery for variable acoustics · high-quality
timber or carpet floor over the floating deck.

**Everything in this section is an Interior Proposal, not a specification**
(brief §E). Nothing here is in a drawing.

---

## 8. Open questions for the client

1. Which two instruments? (Changes the room by ~0.5 m.)
2. Is the music-room proportion still open? If so, ask for **4.550 × 6.370 m**.
3. What ceiling height is the section giving the music room? — and does it
   clear 令21条 *after* the acoustic build-up?
4. What isolation grade is being bought — Dr-45, Dr-50, Dr-55? This sets the
   build-up thickness and therefore the net room.
5. How do the pianos get in?
6. Are the instruments already owned, or to be purchased? (Affects 2 and 5.)

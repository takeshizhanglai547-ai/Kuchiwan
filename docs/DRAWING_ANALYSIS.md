# DRAWING ANALYSIS — PHASE 1

**Project:** xevoΣ PREMIUM Custom Residence — Photorealistic Digital Twin
**Date:** 2026-09-06
**Phase:** 1 (drawing analysis) — **BLOCKED**

---

## 1. Finding: no drawing set was delivered to this session

The brief (section F) instructs the team to cross-reference an attached set of

- 配置図 (site plan)
- 1階平面図 (1F plan)
- 2階平面図 (2F plan)
- 立面図 (elevations)
- 断面図 (sections)

and states, unambiguously:

> いきなりモデリングを開始しない。
> 図面から確認できない寸法を勝手に確定値として扱ってはならない。

**No drawing files reached this session.** This was verified, not assumed:

| Check | Result |
|---|---|
| Session attachment mount `/mnt/attach` | empty |
| `/mnt/user-data/working` | empty |
| Repository working tree | contains only unrelated prior web-game projects |
| Filesystem-wide search for `*.pdf *.jpg *.jpeg *.png *.dxf *.dwg *.webp` outside system paths | no candidate drawing files |

The brief's own rule therefore governs the response. Modelling a house from an
imagined plan would produce a convincing, photorealistic, **wrong** building —
the single worst possible outcome for a project whose stated purpose is

> 「実際にこの家を建てたらどのように感じるのか」を着工・完成前に
> 可能な限り正確に体験できること

An inaccurate walkthrough is worse than no walkthrough, because it will be
believed. Phase 1 is therefore recorded as **BLOCKED**, and the work that does
not depend on the drawings has been completed instead (§4).

---

## 2. Information classification

Per the brief's CONFIRMED / DERIVED / ASSUMED scheme, extended with
**UNRESOLVED** for values that are required, unknown, and unsafe to invent.

### 2.1 CONFIRMED

Everything here comes from the client brief itself, not from a drawing.

| Item | Value | Source |
|---|---|---|
| Builder / product line | Daiwa House xevoΣ PREMIUM | brief §H |
| The 1F large room is a music room | GRAND PIANO SOUNDPROOF MUSIC ROOM | brief §B |
| Its plan area, as annotated | 17.3 帖 | brief §B |
| Number of grand pianos | 2 | brief §C |
| Simultaneous performers | 2 | brief §C |
| Music room is on floor | 1F | brief §B |
| A double-height void connects 1F LDK to 2F | present | brief §G |
| Stair, balcony, garden present | present | brief §A |
| Landscape design is **not** finalised | proposal only | brief §I |

### 2.2 DERIVED

| Item | Value | Rule |
|---|---|---|
| Music room plan area | 28.65 m² *or* 28.03 m² | 17.3 帖 × 1.6562 or × 1.62 — see §3 |
| Model state | `PLACEHOLDER_MASSING` | any UNRESOLVED entry reachable ⇒ not a twin |

### 2.3 ASSUMED

Recorded in full in [`ASSUMPTIONS.md`](ASSUMPTIONS.md). Summary: acoustic
build-up thicknesses, instrument models, clearances, planning module, eye
height, and the placeholder massing dimensions. **None of these may be
presented to the client as a specification.**

### 2.4 UNRESOLVED — the blocking list

Every entry below is required before Phase 3 (greybox) can produce anything
that deserves to be called a twin. They are encoded as `"status": "UNRESOLVED"`
in [`../params/house_params.json`](../params/house_params.json), and
`scripts/qa_verify.py` fails the build while any of them remains unfilled.

| # | Value | Drawing that carries it |
|---:|---|---|
| 1 | Site boundary polygon, site area | 配置図 |
| 2 | Road side, approach position | 配置図 |
| 3 | True north | 配置図 |
| 4 | Setbacks, GL to 1FL | 配置図 + 断面図 |
| 5 | Building footprint polygon | 1階平面図 |
| 6 | 1F / 2F gross floor areas | 平面図 |
| 7 | Exterior and interior wall thicknesses | 平面図 wall hatch / 仕様書 |
| 8 | **Music room gross internal X and Y** | 1階平面図 |
| 9 | Music room door and window positions | 1階平面図 |
| 10 | Room names, positions, areas (all rooms) | 平面図 |
| 11 | Every opening: position, width, height, sill, type | 平面図 + 立面図 |
| 12 | 1F ceiling height, 1F floor-to-floor | 断面図 |
| 13 | 2F ceiling height | 断面図 |
| 14 | **Music room ceiling height** | 断面図 |
| 15 | Void outline and its relationship to the 2F floor | 2階平面図 + 断面図 |
| 16 | Stair type, going, riser height, riser count, width | 平面図 + 断面図 |
| 17 | Balcony outline, parapet height | 2階平面図 + 立面図 |
| 18 | Roof form, pitch, ridge height, eaves height, eaves projection | 立面図 |
| 19 | Site address (for a physically correct sun path) | — |
| 20 | Acoustic specification for the music room | 仕様書 / 音響仕様 |

**20 blocking items.** Items 8 and 14 are on the CRITICAL path (§B/§C/§D of the
brief) and are the two most valuable single numbers in the whole set.

---

## 3. An ambiguity that exists even in the confirmed data

"17.3 帖" is CONFIRMED, but *帖 is not a unique unit*:

| Convention | m²/帖 | 17.3 帖 |
|---|---:|---:|
| 910 × 1820 mm metric module | 1.6562 | 28.65 m² |
| Minimum permitted for advertising under the 不動産の表示に関する公正競争規約施行規則 | 1.62 | 28.03 m² |
| 京間 (1910 × 955 mm) | 1.824 | 31.56 m² |

A 0.63 m² spread between the two plausible conventions. That is small in the
abstract and *not* small relative to the margins measured in
[`PIANO_FIT_REPORT.md`](PIANO_FIT_REPORT.md) — several candidate layouts there
have single-digit-millimetre slack.

**More importantly, an area does not determine a shape.** 28.65 m² is equally
consistent with 5.35 × 5.35 m and with 3.53 × 8.12 m. Those are different
rooms with different answers for two grand pianos. The aspect ratio of the
music room is the highest-value unknown in this project.

---

## 4. What was completed instead

Work that is genuinely independent of the drawings, and is finished:

| Deliverable | Status |
|---|---|
| `params/house_params.json` — SSOT with per-value provenance | complete |
| `scripts/lib/geom2d.py` — dependency-free 2D geometry | complete |
| `scripts/lib/pianos.py` — grand piano catalogue + parametric plan outline | complete |
| `scripts/lib/acoustics.py` — modal screening, RT60, volume guidance | complete |
| `scripts/acoustic_piano_fit.py` — **the Phase 6 solver** | complete, executed |
| `docs/PIANO_FIT_REPORT.md` + 4 CSVs | generated |
| `docs/PIANO_ROOM_REQUIREMENTS.md` | complete |
| `scripts/build_house.py` — parametric Blender builder | complete, drawing-driven |
| `scripts/qa_verify.py` — dimensional QA incl. CRITICAL gates | complete, executed |
| `Unreal/` — walkthrough spec, modes, cameras, quality presets, config | complete |

The Blender builder and the QA gate are written to consume
`params/house_params.json`. When the drawings arrive, the work is *filling in
the parameter file*, not writing new geometry code — the pipeline is already
built and already tested against the placeholder massing.

---

## 5. Findings that survive the missing drawings

These came out of the Phase 6 solver and are worth acting on before the
drawings are even read. Full detail in
[`PIANO_FIT_REPORT.md`](PIANO_FIT_REPORT.md).

1. **The acoustic lining costs ~11 % of the music room's floor area** — roughly
   2 帖 of the 17.3 帖. Two grand pianos still fit on the floor, in most
   plausible shapes, via the nested duo layout.
2. **Volume, not floor area, is the binding constraint.** Every candidate
   shape at every plausible ceiling height falls short of the ~76 m³ practice
   guidance for two grands. This is a *design decision* — raise the ceiling,
   borrow volume from a void, accept a heavily damped room, or choose smaller
   instruments.
3. **A typical single-leaf acoustic door cannot admit a grand piano.** Acoustic
   doors are narrower than ordinary internal doors, and a grand on its side is
   irreducible. This needs solving on the drawing board.
4. **Room proportion matters and one candidate is clearly best.** Of the shapes
   tested, 4.550 × 6.370 m gross has both the largest net floor and the
   best-behaved low-frequency mode distribution.

Items 2 and 3 are cheap to fix now and expensive to fix on site. They are
worth raising with Daiwa House **before** the drawings are finalised.

---

## 6. Next action

Supply any of the following, in descending order of value:

1. **1階平面図** — unblocks items 5–10, and the CRITICAL music-room shape.
2. **断面図** — unblocks items 12–15, and the CRITICAL ceiling height.
3. **立面図** — unblocks items 11, 18.
4. **2階平面図** — unblocks items 15, 17.
5. **配置図** — unblocks items 1–4.

Photographs of printed drawings are usable provided the dimension strings and
the scale bar are legible. PDF is better. DXF/DWG is best — it makes the
dimension table mechanical rather than transcribed.

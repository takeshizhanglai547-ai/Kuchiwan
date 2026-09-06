# ASSUMPTIONS REGISTER

Every value in this project that is **not** from a drawing. Brief §F requires
CONFIRMED / DERIVED / ASSUMED to be kept apart; this is the ASSUMED column,
in full.

> **None of the values on this page may be presented to the client, to Daiwa
> House, or to anyone else as a specification.** They exist so that the
> pipeline can be built and exercised before the drawings arrive. Each one is
> a question, not an answer.

Machine-readable source of truth: [`../params/house_params.json`](../params/house_params.json).
Enforcement: `scripts/build_house.py` refuses to build on an UNRESOLVED value
unless `--placeholder` is passed, and `scripts/qa_verify.py` reports BLOCKED
rather than PASS.

---

## A. Conventions

| # | Assumption | Value | Why | How to resolve |
|---|---|---|---|---|
| A-1 | 帖 conversion | 1.6562 m²/帖 | 910 × 1820 mm metric module | Ask Daiwa House which convention the plan uses. The alternative (1.62 m², the minimum under the 不動産の表示に関する公正競争規約施行規則) gives 28.03 m² instead of 28.65 m² — a 0.63 m² difference that matters at the margins measured in the piano study. |
| A-2 | Planning module | 455 mm | Half-ken metric grid, standard for Japanese housing | Read the grid off the plan. xevoΣ is a steel-frame system; 455 / 910 / 1000 mm are all possible. |

## B. Structure and fabric

| # | Assumption | Value | Why | How to resolve |
|---|---|---|---|---|
| B-1 | Structure | Steel frame | xevoΣ is Daiwa House's steel-frame line | Drawing title block / 仕様書 |
| B-2 | Exterior wall thickness | 180 mm (placeholder only) | Plausible for a steel-frame external wall | Plan wall hatch |
| B-3 | Interior wall thickness | 105 mm (placeholder only) | Plausible stud partition | Plan wall hatch |
| B-4 | GL to 1FL | 500 mm (placeholder only) | Mid of the usual 400–600 mm | Section |
| B-5 | 1F/2F ceiling height | 2400 mm (placeholder only) | Conservative | Section. **Note:** xevoΣ markets a 2720 mm ceiling grade — that is a *product option*, not a fact about this house, and must not be modelled until the section confirms it. |
| B-6 | Eaves projection | 600 mm (placeholder only) | "Deep eaves" is stated design intent (brief §H) | Elevation / section |

## C. Music room acoustics — the most consequential assumptions

No acoustic specification was supplied. These bound the problem; they do not
describe a design.

| # | Assumption | Value | Range | Consequence if wrong |
|---|---|---|---|---|
| C-1 | Target isolation | Dr-50 | Dr-45 … Dr-55 | Sets everything below. Dr-45 is often sold as "piano capable" and is marginal for two grands. |
| C-2 | Inner wall build-up per side | 150 mm | 120–200 mm | At 200 mm each plan dimension loses 400 mm instead of 300 mm — about 1.4 m² more floor gone. |
| C-3 | Floating floor rise | 150 mm | 100–200 mm | Directly reduces finished ceiling height, which is a **statutory** matter (令21条). |
| C-4 | Isolated ceiling drop | 200 mm | 150–250 mm | As above. |
| C-5 | Acoustic door | single leaf, 750 × 2000 mm clear | — | **Probably a show-stopper for piano delivery.** See `PIANO_ROOM_REQUIREMENTS.md` §5.4. |
| C-6 | Airlock vestibule | none | — | Adding one raises isolation and costs 1.6–2.5 m² of the 28.65 m². |
| C-7 | Ventilation / HVAC | attenuated mechanical, isolated penetrations | — | Required in any case; also relevant to 法28条2項 / 令20条の2. |

## D. Instruments

| # | Assumption | Value | Why | How to resolve |
|---|---|---|---|---|
| D-1 | Piano A | Yamaha C7X (2.27 m) | Semi-concert — realistic upper bound for a residential room | **Ask the client.** This changes the room by half a metre. |
| D-2 | Piano B | Yamaha C3X (1.86 m) | Medium grand | Ask the client. |
| D-3 | Worst case tested | two Yamaha CFX (2.75 m) | Bounds the problem from above | — |
| D-4 | Case dimensions | manufacturer catalogue | Accurate to ~1 cm | Already resolved — see `scripts/lib/pianos.py`. |
| D-5 | Plan outline proportions (tail width 0.30 × case width, bentside from 32 % of length) | modelled | Manufacturers do not publish the bentside curve | Affects nesting efficiency by a few cm. The fit study also reports the rectangular-envelope answer, which cannot be optimistic. |

## E. Clearances

All ASSUMED, all defensible, none from a standard that binds a private house.

| # | Clearance | Value | Rationale |
|---|---|---:|---|
| E-1 | Wall → piano case | 500 mm | Tuning and moving access; a rim hard against a wall is also acoustically poor |
| E-2 | Piano → piano | 600 mm | Shared circulation between the instruments |
| E-3 | Player zone depth | 1100 mm | Bench (360 mm) + seated player + room to stand and leave |
| E-4 | Player zone width | 1400 mm | Wider than the 1225 mm playing width of 88 keys |
| E-5 | Bench → other piano's rim | 100 mm | The bench must not touch the other instrument |
| E-6 | Player zone → wall | 0 mm | The zone already contains stand-and-leave space; charging wall clearance on top would double-count |
| E-7 | Tuner side access | 600 mm | Technician working at the pin block |

## F. Delivery

| # | Assumption | Value | Source |
|---|---|---|---|
| F-1 | Required clear width | 800 mm | Piano movers' practical minimum |
| F-2 | Required clear height | 1900 mm | As above |
| F-3 | Rim depth (thickness on skid) | 350–380 mm | Modelled from case proportions |
| F-4 | Skid adds | 150 mm to height | Typical piano board |

## G. Walkthrough

| # | Assumption | Value | Note |
|---|---|---:|---|
| G-1 | Standing eye height | 1560 mm | Adult in Japan, ~1.70 m stature. **Runtime-adjustable 1400–1800 mm** per brief §O — the adjustability matters more than the default. |
| G-2 | Seated (sofa) eye height | 1150 mm | Required viewpoint, brief §A |
| G-3 | Crouched eye height | 950 mm | |
| G-4 | Walk speed | 1.30 m/s | Real pace; a fast pawn makes rooms feel smaller than they are |
| G-5 | Slow walk | 0.55 m/s | |
| G-6 | Site latitude/longitude | Tokyo 35.68 / 139.77 | **Placeholder only.** Sun studies are not site-correct until the real address is supplied (QA-14). |

## H. Landscape — proposal, not specification

Brief §I states the exterior design is not finalised. The **entire** landscape
model is therefore a proposal: approach, porch, gate post, delivery box,
parking, garden, planting, symbol tree, ground cover, paving, gravel, feature
stone, and all exterior lighting. Option B (water feature, brief §K) is an
alternative, not a recommendation.

## I. Interior — proposal, not specification

Brief §E likewise. The music room's timber, louvre panels, cove lighting,
picture light, score storage and drapery are an Interior Proposal. So is all
furniture — which additionally does duty as human-scale reference.

---

## How an assumption gets retired

1. The drawing arrives.
2. The value is entered in `params/house_params.json` with
   `"status": "CONFIRMED"` and the drawing named in `"source"`.
3. `python3 scripts/qa_verify.py --markdown` is re-run; the corresponding check
   moves from BLOCKED to PASS or FAIL.
4. `python3 scripts/acoustic_piano_fit.py` is re-run if the value touches the
   music room — the report regenerates against the real room instead of the
   candidate set.
5. The assumption is struck from this page.

The project is finished when this page contains only sections H and I.

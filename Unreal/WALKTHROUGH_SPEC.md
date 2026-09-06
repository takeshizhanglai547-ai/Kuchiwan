# UNREAL ENGINE 5 — REALTIME WALKTHROUGH SPECIFICATION

**Brief sections:** N (pipeline), O (UE5 + first-person controller), P (ArchViz
modes), Q (lighting), R (performance), T (QA cameras).

> The stated goal is **not** a set of pretty stills. It is that a person can
> walk the house before it is built and know what it will feel like (brief §A).
> Everything below is subordinate to that: if a feature costs the walkthrough
> its frame rate, the feature loses.

---

## 1. Project setup

| Setting | Value | Why |
|---|---|---|
| Engine | UE 5.4+ | Nanite + Lumen + VSM all mature |
| Template | Blank, C++ | The pawn is C++; everything else is Blueprint |
| Units | 1 uu = 1 cm | Blender is 1 BU = 1 m → **import scale 100** |
| Project name | `XevoTwin` | — |
| Target | High-end desktop PC | brief §R |

**The unit conversion happens in exactly one place** (the Datasmith/FBX import
scale, mirrored by `M2U` in the Python scripts). Never a second time.

---

## 2. Blender → Unreal pipeline (brief §N)

Preferred: **Datasmith** (`.udatasmith`) via the Blender Datasmith exporter —
it preserves the hierarchy, per-object pivots, and material slot names that a
plain FBX round-trip tends to flatten.

Fallback: FBX, with `Apply Transform` on, `-Z forward / Y up`, unit scale 1.0.

Re-import contract — the point is that re-exporting from Blender must **not**
destroy work done in Unreal:

1. **Names are the contract.** `1F_WALL_EXT_NORTH` must stay
   `1F_WALL_EXT_NORTH` across every export. The naming convention in
   `scripts/build_house.py` exists for this reason and must not be changed
   casually.
2. **Pivots at the object's own origin**, never at the world origin — otherwise
   every re-import resets placement.
3. **Material slots are assigned by category in Blender**, and Unreal materials
   are bound to slot *names*. A re-import then re-binds automatically.
4. Keep Unreal-side additions (lights, decals, foliage, cameras, Blueprints) in
   **separate levels** streamed into the master, never in the imported level.
   Then a re-import replaces geometry only.
5. Datasmith re-import: use **Sync** rather than a fresh import; it respects
   the above.

---

## 3. First-person controller (brief §O)

C++ pawn `AArchVizPawn`, spawned by `AArchVizGameMode`.

| Input | Action |
|---|---|
| `W A S D` | Walk |
| Mouse | Look |
| `Shift` (hold) | Slow walk — for looking at detail |
| `C` | Crouch / low viewpoint |
| `Space` | *Not* jump — jumping breaks the illusion. Unbound by default. |
| `E` | Interact: open/close doors, sit |
| `F` | Toggle sitting viewpoint (sofa, piano bench) |
| `Tab` | Mode menu (§4) |
| `1`–`4` | Time of day: Morning / Daytime / Sunset / Night |
| `[` `]` | Eye height −/+ 10 mm |

### Viewpoint heights — from `params/house_params.json`

| Viewpoint | Height | Status |
|---|---:|---|
| Standing eye height | **1.560 m** | ASSUMED — adult in Japan, ~1.70 m stature |
| Adjustable range | 1.400 – 1.800 m | runtime slider, per brief §O |
| Seated (sofa) eye height | 1.150 m | ASSUMED |
| Crouched | 0.950 m | ASSUMED |

Eye height is a **runtime setting, not a constant**. Two people looking at the
same room from 1.50 m and 1.75 m have measurably different opinions about a
kitchen counter and a window sill, and the point of the exercise is to find
that out now.

### Movement

- Walk 1.30 m/s, slow walk 0.55 m/s. Real walking pace; a fast pawn makes
  rooms feel smaller than they are.
- **Capsule radius 0.25 m** so the pawn cannot squeeze through gaps a person
  could not. This is a dimensional check disguised as a collision setting: if
  the walkthrough cannot get past the sofa, neither can the client.
- Stair stepping: max step 0.20 m, walkable floor angle 45°.
- No jump, no fly in WALK mode. Fly is what ARCHITECT mode is for.

---

## 4. ArchViz modes (brief §P)

| # | Mode | Behaviour |
|---:|---|---|
| 1 | **WALK** | First-person, gravity, collision, real walking speed. The default. |
| 2 | **PHOTO** | Pawn frozen; exposure/aperture/focal length exposed; hide UI; high-quality screenshot to `/renders/`. |
| 3 | **ARCHITECT** | Free fly camera, no collision, adjustable speed. For checking geometry, not for selling. |
| 4 | **DAY / NIGHT** | Morning / Daytime / Sunset / Night presets (§5). |
| 5 | **MATERIAL OPTION** | Cycles material variants per surface group (floor, wall, kitchen front, music room finish). Driven by a Data Asset so options can be added without touching code. |
| 6 | **LANDSCAPE OPTION** | Switches Option A (planting-led) / Option B (planting + water feature) as level-streaming sub-levels. Brief §I/§K — both are **proposals**. |

### A mode this project specifically needs

**PROVENANCE overlay.** A toggle that tints every surface by the status of the
parameter that generated it:

| Colour | Meaning |
|---|---|
| neutral | CONFIRMED — from a drawing |
| blue | DERIVED |
| amber | ASSUMED |
| **magenta** | **PLACEHOLDER — this is not your house** |

Without it, a photorealistic render of an assumed dimension is indistinguishable
from a photorealistic render of a real one. Given that the drawing set has not
arrived, this is not a nicety — it is the safety mechanism that stops the model
being believed before it has earned it.

---

## 5. Lighting (brief §Q)

Lumen (software or hardware ray tracing) + Virtual Shadow Maps.

| Preset | Sun altitude | Character |
|---|---|---|
| Morning | low, east | long shafts through the void and the stair |
| Daytime | high | the daylight test — LDK, void, stair, 2F hall, **music room** |
| Sunset | low, west | warm, raking; the eaves read properly |
| Night | none | interior + exterior lighting only |

**The sun path is not yet site-correct.** Latitude, longitude and true north
are UNRESOLVED (`QA-14`). Until the site plan and address arrive, the presets
render but the angles are generic. A daylight study on a guessed north is
worse than no daylight study, so the overlay in §4 must mark it.

Night lighting to model: downlights · pendants · cove/indirect · step and
footlights · exterior wall lights · planting uplights.

Music room lighting is its own problem: dimmable, glare-free from the bench,
a picture light, and **nothing directly above the open lid** (§7 of the piano
requirements).

---

## 6. Performance (brief §R)

Nanite on all architectural geometry and vegetation. Lumen for GI and
reflections. VSM for shadows.

| Preset | Target | Settings |
|---|---|---|
| **ULTRA** | 60 fps @ 4K | Lumen HWRT, VSM high, Nanite, TSR/DLSS Quality |
| **HIGH** | 60 fps @ 1440p | Lumen SWRT, VSM medium, TSR Balanced |
| **PERFORMANCE** | 90+ fps @ 1080p | Lumen SWRT low, reduced VSM, TSR Performance |

Upscaling: TSR by default (vendor-neutral); DLSS/FSR as optional plugins.

Watch items specific to this project:

- **The void is a Lumen stress point.** A double-height space with a large
  opening is exactly where screen-traced GI falls apart. Test it early with
  a real sun angle, and expect to need hardware ray tracing for ULTRA.
- **Two grand pianos are high-polygon and highly specular.** Nanite handles
  the triangles; the reflections are the cost. Keep a reflection capture in
  the music room.
- **Vegetation** (brief §J) must be Nanite-enabled foliage with wind. It is the
  most likely thing to blow the frame budget outdoors.

---

## 7. QA cameras (brief §T)

19 fixed cameras, created by [`Python/setup_cameras.py`](Python/setup_cameras.py).
Positions are resolved from `params/house_params.json`; cameras whose anchor
room is still UNRESOLVED are **skipped and reported**, not guessed.

Current state: **4 of 19 placed** — all four music-room cameras
(`CAM_13`–`CAM_16`), because the music room is the only space whose dimensions
can be derived without the drawings. The remaining 15 wait on the plans.

Each camera exists to be compared against a drawing. `CAM_08` (living → void)
and `CAM_09` (2F → living) are the two that catch section errors, which are the
errors that plan-only modelling produces.

---

## 8. Definition of done

The walkthrough is complete when a person can, in one continuous session
without loading screens or clipping:

enter at the front door → cross the hall → walk the LDK → stand at the kitchen →
sit on the sofa → look up into the void → climb the stair → look down from the
2F → enter each bedroom → step onto the balcony → **enter the music room, walk
between both grand pianos, and sit at each keyboard** → go out to the garden →
walk the full perimeter of the house.

The music room leg of that route is `QA-CRIT-06` and is not optional.

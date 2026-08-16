# OVERBURST / Unreal Engine 5 — architecture contract

The web build (`overburst/`) stays as it is. This is a **separate, parallel** target
sharing the same design: `AC_DESIGN.md` for the frames, `ART_DIRECTION.md` for the world
and VFX, and the same tuning numbers.

Target: **UE 5.4+**, C++ first, Blueprint for content wiring only.

---

## The constraint that shapes everything here

**Unreal Engine is not installed in the authoring container and cannot be.** Nobody
working in this repository through the agent pipeline can compile UE C++, open the
editor, run PIE, or package a build. Any claim that the UE layer "works" would be
unverifiable, and unverifiable claims are worse than no claim.

So the project is split so that the part that decides how the game *feels* is
independently testable:

```
Source/ObCore/        pure C++17. ZERO Unreal types, zero Unreal headers.
                      Movement integration, EN economy, ACS/stagger, ballistics,
                      AI steering, mission state. Compiled and RUN by tests/ with
                      plain g++/clang — every number in it is verified.

Source/OverburstUE/   the Unreal module. Actors, Components, GameMode, Enhanced
                      Input, Niagara/Chaos hooks, UMG. Thin. It OWNS NO GAMEPLAY
                      MATH — it feeds input to ObCore and applies the result.
                      Not compilable here; held to standard by code review.
```

If you are tempted to put a formula in `OverburstUE/`, it belongs in `ObCore/`.
The test suite is the reason.

## Unit convention — the one thing that will bite you

The web build works in **metres** (the mech is 11 units tall). Unreal works in
**centimetres**. `ObCore` is authored in metres, exactly matching the web build's tuning
numbers so the two stay comparable, and the UE layer converts at the boundary:

```cpp
constexpr float OB_M_TO_UU = 100.0f;   // ObCore metres -> Unreal units
```

Convert **once**, at the component boundary. Never sprinkle `* 100` through gameplay code.

---

## ObCore public surface

Header-only where it is cheap to be; `.cpp` where it is not.

| header | contents |
|---|---|
| `ObTypes.h` | `ObVec3`, `ObQuat`, scalar helpers, no dependencies |
| `ObConfig.h` | every tuning constant, mirroring `overburst/src/config.js` 1:1 |
| `ObMovement.h/.cpp` | the mech movement solver: drag-then-accelerate, quick boost impulse, assault boost, hover, gravity, ground/air drag |
| `ObEnergy.h/.cpp` | EN spend/recharge, recovery delay, redline lockout |
| `ObStagger.h/.cpp` | ACS accumulation, decay delay, stagger window, direct-hit multiplier |
| `ObBallistics.h/.cpp` | swept-segment bullets, proportional-navigation missiles, splash falloff |
| `ObAI.h/.cpp` | steering behaviours per enemy class, incl. the AC duelling band |
| `ObMission.h/.cpp` | act progression, objective state, win/lose rules, scoring |
| `ObWorldQuery.h` | **interface** the host implements: `SampleHeight`, `Raycast`, `SweepCapsule`. ObCore never knows what a level is. |

The host (UE, or the test harness) implements `IObWorldQuery`. That is the only seam.

## The movement model — do not "improve" it

Ported verbatim from the web build, which was tuned against Armored Core VI's feel:

> Drag is applied FIRST, then acceleration only tops velocity up TO the wish speed
> along the wish direction — it never subtracts. That is what makes a quick boost feel
> like a real impulse: the overspeed is preserved and bleeds off through drag instead of
> being lerped away, and reduced drag during the QB window carries it.

A `FloatingPawnMovement` or a stock `CharacterMovementComponent` will NOT reproduce this.
The pawn uses ObCore's solver and applies the resulting delta, sweeping for collision.

---

## Unreal module layout

| class | role |
|---|---|
| `AObMechPawn` | the player AC. Owns an `UObMovementComponent` wrapping ObCore. |
| `UObMovementComponent` | ticks ObCore's solver, sweeps the capsule, reports hits back |
| `UObEnergyComponent`, `UObStaggerComponent` | thin wrappers over the ObCore state |
| `UObWeaponComponent` | the fixed loadout; spawns projectiles, drives Niagara |
| `AObProjectile` / pooled subsystem | ballistics visuals; the maths is ObCore's |
| `AObEnemyAC`, `AObEnemyMT`, `AObPylon` | hostiles; AI ticks ObCore steering |
| `AObGameMode`, `UObMissionSubsystem` | act progression, spawning, win/lose |
| `UObHudWidget` (UMG) | the HUD, matching the web build's layout |
| `UObWorldQueryUE` | implements `IObWorldQuery` against `UWorld` line/sweep traces |

**Enhanced Input** for controls, with an `IMC_Overburst` context and one `InputAction`
per verb, so the same mapping serves keyboard/mouse and gamepad.

## Content

No marketplace assets, no downloads. The mech is built as a **hierarchy of static mesh
components from primitive shapes** following `AC_DESIGN.md`, the same approach the web
build takes — so it lands in a fresh engine install with nothing to import. A later pass
can replace it with authored meshes; the rig points are the contract.

---

## Verification — what "done" means here

Two tiers, and they must never be confused with each other.

**Tier 1 — VERIFIED. `unreal/tests/`, compiled and run in CI/container.**
```bash
cd unreal/tests && cmake -B build -G Ninja && cmake --build build && ./build/obtests
```
Covers, with actual numbers: a quick boost produces the specified impulse and the
overspeed decays on the specified curve; EN redline locks out for the specified time;
ACS fills, decays after the delay, and staggers; a direct hit multiplies damage;
missiles converge under proportional navigation; the mission reaches win and lose.
**Every number in a report about ObCore must come from this runner.**

**Tier 2 — REVIEWED ONLY. The Unreal module.**
It compiles nowhere in this pipeline. Claims about it are limited to "this follows UE5
convention and calls ObCore correctly", checked by code review against this document.
Nobody may state that the UE build runs, renders, or performs at any frame rate.
When reporting, say which tier a claim comes from.

## Hard rules

- `ObCore` includes NOTHING from Unreal — not `CoreMinimal.h`, not `UE_LOG`. It must
  compile with `g++ -std=c++17 -Wall -Wextra` with no engine present.
- No exceptions and no RTTI in ObCore (Unreal builds with both off).
- No per-frame heap allocation anywhere in the tick path.
- The Unreal module never duplicates a formula that exists in ObCore.
- Tuning constants live in `ObConfig.h` only, mirroring the web build so the two targets
  can be compared.

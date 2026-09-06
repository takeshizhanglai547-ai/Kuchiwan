# BLENDER

`house_master.blend` is the MASTER for all architectural geometry (brief §G).

It is **generated**, not hand-modelled:

    blender --background --python ../scripts/build_house.py -- --out house_master.blend

The file is not committed. It is reproducible from
`../params/house_params.json` plus the build script, and a binary .blend in git
would immediately drift from the parameter file that is supposed to govern it.

## It will refuse to build

By design. With no drawing set supplied, every building dimension is
UNRESOLVED and the builder stops rather than inventing one:

    $ python3 ../scripts/build_house.py --dry-run
    MUSIC ROOM: BLOCKED
      music_room.gross_internal_x_m is UNRESOLVED. Required source: 1F plan.

To exercise the pipeline anyway, pass `--placeholder`. Everything it produces
is named `PLACEHOLDER_*` and lands in the collection
`00_PLACEHOLDER_DO_NOT_PRESENT`.

## Conventions that must not change

- Metric, 1 Blender Unit = 1 metre.
- Object names are the contract with Unreal: `<LEVEL>_<CATEGORY>_<NAME>`,
  `MUSIC_*`, `PIANO_A_*` / `PIANO_B_*`. Renaming breaks re-import.
- Pivots at each object's own origin, never the world origin.
- Material slots assigned by category, bound by name in Unreal.

# RENDERS

Output from the 19 fixed QA cameras (brief §T), organised per brief §U.

    Exterior/     CAM_01, CAM_02
    Interior/     CAM_03 - CAM_12
    PianoRoom/    CAM_13 - CAM_16   <- CRITICAL
    Day/          CAM_18 and daytime variants
    Night/        CAM_19 and night variants

## Nothing has been rendered yet, and that is deliberate

The drawing set has not been supplied (see `../docs/DRAWING_ANALYSIS.md`).
Rendering the house now would produce photorealistic images of a building
nobody has designed. Those images would be shown to people, and believed.

Fifteen of the nineteen cameras cannot even be placed, because the rooms they
point at are UNRESOLVED — `../Unreal/Python/setup_cameras.py` skips them and
says so rather than guessing a position.

## Naming

    CAM_<nn>_<Name>_<Preset>_<YYYYMMDD>.png
    e.g. CAM_16_Two-Piano-Overview_Daytime_20260906.png

Every render published from a model in `PLACEHOLDER_MASSING` state must carry
the provenance overlay (`WALKTHROUGH_SPEC.md` §4) or be watermarked
`PLACEHOLDER — NOT THIS HOUSE`.

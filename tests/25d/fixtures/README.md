`old25d-player-040cf.js` is the unchanged public 2.5D player controller from
Kuchiwan commit `040cf980ef39488c470cbc6a73ea47652007fa12`, path
`inu25d/src/55_player.js`. SHA256 after LF normalization:
`670f27e0cbac6edc24a5bc6028e0e32006c4afe086f893c09c394114c0aa461e`.

The movement fixture executes this controller and the production adapter with
the same inputs, comparing measured displacement. Command fidelity tests use
the separately pinned original 2D simulation and an explicitly selected flat
reference movement profile; production walking/depth tests never use that profile.

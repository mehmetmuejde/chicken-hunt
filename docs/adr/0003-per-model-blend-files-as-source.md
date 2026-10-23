# 3. Keep one editable .blend file per model as the source of truth

## Status

Accepted

Supersedes [ADR-0002](0002-script-generated-blender-models.md)

## Context

ADR-0002 made `blender/build_weapons.py` the only source of the models: every run rebuilt all of
them, overwrote `blender/weapons.blend` and re-exported the `.glb` files. Models are now also edited
by hand in Blender, and those edits would be lost on the next run of the script. All models sharing
one `.blend` file also made it hard to work on a single model.

## Decision

- Every model has its own Blender file `blender/models/<name>.blend`. These files are versioned and
  are the source of truth for the game assets.
- `blender/build_weapons.py` only creates the first version of a model. It skips every file that
  already exists; regenerating one needs an explicit `--rebuild <name>` (or `--rebuild all`).
- `blender/export_models.py` reads the `.blend` files without saving them and exports
  `public/models/<name>.glb`, optionally with preview renders. Changes in Blender reach the game
  only through this export.
- The model conventions of ADR-0002 stay: metres, +Y barrel direction, +Z up, moving parts as
  separate objects, empties as markers, node names `<Prefix>_<Part>`, animation in code, PBR
  materials converted at runtime. All mesh objects and empties of a file's scene are exported.

## Consequences

- Manual edits are kept; git history is the backup for every committed version.
- The `.blend` files are binary, so changes to them cannot be reviewed as a diff; preview renders
  and the exported node names are the way to review them.
- The generator script and the `.blend` files can drift apart after manual edits. That is
  accepted: once a model exists, its `.blend` file wins.
- New models are still started from code in `build_weapons.py`, then refined in Blender.
- Renaming a node in Blender still breaks the lookup in `src/viewmodel.ts`.

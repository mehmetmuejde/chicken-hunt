# Chicken Hunt

A 3D browser shooting gallery built with Babylon.js, TypeScript and Vite. Chickens fly across a
low-poly countryside; shoot as many as possible in 90 seconds. Farther chickens are worth more points.

## Controls

- **Left click**: shoot (hold it with the MP40, AK-47, MG 42, Gatling and laser)
- **Right click**, **Space** or **R**: reload (all weapons with a magazine, belt or rocket)
- **1**–**9**, **0**, **B** or **mouse wheel**: switch weapons
- **Mouse at the screen edge**: look left/right

## Weapons

| Key | Weapon    | Behaviour                                                                 |
| --- | --------- | ------------------------------------------------------------------------- |
| 1   | Pistol    | 9 mm, 15-round magazine, slide locks back when empty                      |
| 2   | MP40      | WWII submachine gun, 32-round stick magazine                              |
| 3   | Shotgun   | 8 shells, pump action, shells are reloaded one by one                     |
| 4   | M1 Garand | WWII rifle, eight-round clip that flies out with a "ping" after the last shot |
| 5   | AK-47     | Automatic fire, 30-round curved magazine                                  |
| 6   | MG 42     | Fastest gun: 1500 rounds per minute, 200-round belt, slight spread        |
| 7   | Gatling   | Hand-cranked, 500 rounds per round and no reload                          |
| 8   | RPG-7     | Rocket with smoke trail, explodes next to a chicken, on the ground or at the aimed point |
| 9   | Flak 88   | Airburst shell: explodes at the first chicken or at fuse distance, hits everything nearby |
| 0   | Laser     | Continuous beam, energy recharges, roasts chickens                        |
| B   | A-Bomb    | Once per round: call it in by radio, it falls on the aimed point; the rest of the round is a dark, irradiated wasteland |

## Chickens, combos and secrets

- Chickens fly at different speeds; fast ones are worth double.
- **Special chickens:** the golden chicken (+100 points, +5 seconds), the clock chicken with a pocket
  watch (+3 seconds), the bomb chicken (costs
  points and blows up its neighbours), the armoured chicken (helmet and breastplate take a hit) and,
  halfway through each round, the chicken king with a crown and a health bar.
- **Combo:** every third hit in a row raises the multiplier up to ×5. A pause or a missed single shot
  ends the streak.
- **Easter eggs:** a few things in the landscape react when you shoot them — and once per round
  something unusual crosses the sky.

## Scenes, time of day and weather

Six scenes to hunt in: the **farm**, a **moor** with reeds, pools and a boardwalk, a **castle ruin** on
its hill, the **coast** with beach, lighthouse and fishing boat, a desert **canyon** with mesas and
cacti, and a **city** seen from a lookout above the valley — the atomic bomb flattens all of it.

Each round is played by day, at sunset or at night (with a torch that follows the crosshair), in
clear weather, rain, snow or fog. Pick scene, time and weather on the start screen or leave them on
*Random*. The number of chickens in the air is set there too; all settings are stored in the browser.

## How it was built

The game was developed by Mehmet Müjde together with Claude Code as an AI pair programmer: Mehmet
set the direction and made the decisions, Claude Code researched options, wrote the code and the
Blender scripts and checked every step in the browser. It grew in three iterations:

1. **Countryside and chickens.** A Babylon.js scene built entirely from code: terrain shaped by a
   height function and coloured through vertex colours, a vertex-coloured sky dome, instanced
   low-poly trees, barn, windmill and drifting clouds. The chickens are assembled from primitives
   with flapping wings; hits are detected by ray picking against invisible hitboxes.
2. **Visible weapons.** Shotgun and MG 42 are modelled in Blender — not by hand, but by a Python
   script that runs Blender headless, builds every part, exports binary glTF and renders preview
   images for review. Moving parts (pump, top cover, belt) are separate nodes, so the game animates
   them in code: pump stroke with ejected shells, shell-by-shell reloading, belt change.
3. **Heavy weapons and the wasteland.** Flak 88 (seen from the gunner's position, with recoiling
   barrel, opening breech and loading tray), a laser with an energy gauge and a throwable atomic
   bomb with fireball, shock wave and mushroom cloud. After the blast the world switches to a burnt,
   irradiated variant with glowing chickens until the next round.

Technical choices worth knowing:

- **Babylon.js without a framework.** The HUD and menus are plain HTML/CSS on top of the canvas.
  All engine imports go through `src/babylon.ts` with deep module paths, which keeps the bundle at
  about a quarter of the barrel import ([ADR-0001](docs/adr/0001-use-babylonjs-for-3d-browser-game.md)).
- **Editable 3D assets.** Every model starts as code in `blender/build_weapons.py` and is then
  kept as its own Blender file in `blender/models/`, which can be refined by hand; the game assets
  are exported from those files ([ADR-0003](docs/adr/0003-per-model-blend-files-as-source.md)).
- **Real gunshots, everything else generated.** Gunshots are recordings from a shooting range
  (see [Sound credits](#sound-credits)); all other sounds are synthesized with the Web Audio API
  and every texture is drawn at runtime.
- **Game logic separated from visuals.** `WeaponController` only knows ammo, timing and phases and
  emits events; the viewmodel, effects, HUD and sound react to them.

## Development

Requires Node.js 22 or newer.

```sh
npm install
npm run dev        # dev server on http://localhost:5173
npm run typecheck  # TypeScript checks
npm run build      # type check + production build into dist/
npm run preview    # serve the production build
```

## 3D models

Every model has its own Blender file in `blender/models/` (`pistol`, `shotgun`, `ak47`, `mg42`,
`gatling`, `flak88`, `laser`, `nuke`, `mushroom`). These files are the source: open them in Blender (5.1+), edit and save. Keep
the object names (`Shotgun_Pump`, `MG42_Cover`, …), the game looks them up.

Export the changes to `public/models/*.glb` from the project root:

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup \
  --python blender/export_models.py -- --models-dir blender/models --out public/models
```

Add `--only <name> ...` to export single models and `--preview <dir>` to render preview images.

`blender/build_weapons.py` creates the first version of a model from code. It only writes `.blend`
files that do not exist yet; `--rebuild <name>` regenerates one on purpose and replaces manual edits:

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup \
  --python blender/build_weapons.py -- --models-dir blender/models
```

## Structure

| Path              | Purpose                                                        |
| ----------------- | -------------------------------------------------------------- |
| `src/main.ts`     | Entry point: engine, render loop, resize                       |
| `src/game.ts`     | Game state, input, camera, spawning, scoring                   |
| `src/weapons.ts`  | Weapon definitions (capacity, fire rate, reload)               |
| `src/weapon-controller.ts` | Firing, reloading and switching logic                 |
| `src/viewmodel.ts` | First-person weapon: loading, aiming and animations           |
| `src/effects.ts`  | Feathers, flak tracers and bursts, laser beam, smoke           |
| `src/nuke.ts`     | Atomic bomb: flight, fireball, shock wave, mushroom cloud      |
| `src/chicken.ts`  | Chicken model, special variants, flight and fall behaviour     |
| `src/world.ts`    | Sky, light, clouds, terrain and switching between the scenes   |
| `src/scenery/`    | The six scenes: height, ground colours, buildings and props    |
| `src/atmosphere.ts` | Time of day and weather: sky, light, fog, stars, rain, snow, torch |
| `src/eastereggs.ts` | Hidden targets in the landscape                              |
| `src/combo.ts`    | Kill streak and score multiplier                               |
| `src/audio.ts`    | Sound effects synthesized with the Web Audio API               |
| `src/hud.ts`      | DOM overlay: score, timer, ammo, crosshair, start/end screens  |
| `src/config.ts`   | Gameplay tuning values                                         |
| `src/babylon.ts`  | Single import point for Babylon.js (deep imports, tree-shaken) |

Architecture decisions live in `docs/adr/`.

## Sound credits

The samples in `public/sounds/` are cut from these recordings with `tools/cut-sounds.sh`:

| Sound | Recording | Source | Licence |
| ----- | --------- | ------ | ------- |
| Pistol | Walther PPQ, 9 mm | [The Free Firearm Sound Library](https://opengameart.org/content/the-free-firearm-sound-library) by Ben Jaszczak, Brian Nelson, Kevin Heras and Matthew Nanney | [CC0](https://creativecommons.org/publicdomain/zero/1.0/) |
| Shotgun | Benelli Nova, 12 gauge pump action | same library | CC0 |
| AK-47 | AK-47, 7.62×39 | same library | CC0 |
| MP40 | Carl Gustav M45, 9 mm (same era and calibre) | same library | CC0 |
| M1 Garand | Springfield M1917, .30-06 (same cartridge) | same library | CC0 |
| Shotgun pump | [Mossberg 500A - 1 shot and pump](https://freesound.org/s/159710/) by AnthonyChan0 | Freesound | CC0 |
| MG 42 | [MG 42 (Solo) WW2](https://freesound.org/s/338242/) by Lubini | Freesound | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| Gatling | [Gatling Gun Close](https://freesound.org/s/239596/) by mikewest | Freesound | CC0 |
| Flak 88 shot | [Howitzer Artillery Gun Shot Sound Effect 01](https://freesound.org/s/161343/) by qubodup (from a US Army video) | Freesound | CC0 |
| Flak 88 airburst | [Explosion of mine-clearing line charge (MCLC)](https://freesound.org/s/162261/) by qubodup (from a US Government video) | Freesound | CC0 |
| A-Bomb | [Massive Explosion](https://freesound.org/s/741175/) by qubodup | Freesound | CC0 |
| Falling cases | [Bouncing Shell Casings (Various Sizes)](https://freesound.org/s/318964/) by GryffDavid | Freesound | CC0 |
| Pistol and AK-47 magazine, slide | [S&W M&P9 M2.0 handling](https://freesound.org/s/427505/) by AnthonyChan0 | Freesound | CC0 |
| AK-47 charging handle, MG 42 cover | [AK47 chambering](https://freesound.org/s/142892/) by ceremonialchapstick | Freesound | CC0 |
| Shotgun shells loaded | [G35-10-Gun Shots](https://freesound.org/s/438575/) by craigsmith | Freesound | CC0 |
| RPG-7 loading | [Inserting a rocket into an RPG-7 rocket launcher](https://freesound.org/s/725401/) by serøutōnin--deprivəd | Freesound | CC0 |
| Falling bomb | [R12-27-Falling Bombs Whistle](https://freesound.org/s/479924/) by craigsmith | Freesound | CC0 |
| M1 Garand clip ping | [An M1 Garand clip being ejected w/ ping](https://freesound.org/s/725398/) by serøutōnin--deprivəd | Freesound | CC0 |
| M1 Garand reload | [An M1 Garand being reloaded while empty](https://freesound.org/s/725399/) by serøutōnin--deprivəd | Freesound | CC0 |

The MG 42 sample is licensed under CC BY 4.0: "MG 42 (Solo) WW2" by Lubini, cut into a loop and a tail.

## License

[MIT](LICENSE) © 2026 Mehmet Müjde

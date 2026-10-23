# 1. Use Babylon.js for a 3D browser game

## Status

Accepted

## Context

Chicken Hunt is a browser-first shooting gallery: chickens fly across a panoramic countryside and the
player shoots them with the mouse. The browser is the only target platform; download size and start-up
time matter. Options considered: Phaser (2D), Three.js / React Three Fiber (renderer only), PlayCanvas
(editor-centric) and Godot (web export limited to GDScript and the WebGL 2 compatibility renderer).

## Decision

Build the game in 3D with Babylon.js (`@babylonjs/core`), TypeScript and Vite, without React.
Babylon.js ships picking, particles, instancing, fog and cameras out of the box, so the game needs no
further engine dependencies. HUD and menus are plain HTML/CSS on top of the canvas.

All Babylon.js imports go through `src/babylon.ts`, which uses deep module paths plus the required
side-effect imports. Importing from the package barrel bundled the whole engine (about 1.5 MB gzip);
deep imports bring it down to about 0.3 MB gzip.

## Consequences

- 3D depth (distance-based scoring, perspective, parallax) comes for free; the look is low-poly built from
  primitives, so no asset pipeline is needed yet.
- New Babylon.js features must be added to `src/babylon.ts`, including any side-effect import they need;
  a missing one fails at runtime, not at compile time.
- All visuals and sounds are generated in code (meshes from primitives, Web Audio synthesis), so the
  project has no third-party art or audio licenses to manage.

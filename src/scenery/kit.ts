import { Color3, Matrix, type Mesh, MeshBuilder, type Scene, StandardMaterial, type TransformNode, Vector3 } from "../babylon";

export type SceneryId = "farm" | "moor" | "castle" | "coast" | "canyon" | "city";

/** Something that sags or topples instead of burning away when the atomic bomb goes off. */
export interface Collapse {
  node: TransformNode;
  /** Tilt around the z axis and remaining height (1 = untouched) after the blast. */
  tilt: number;
  squash: number;
}

/** Farm parts the easter eggs and the windmill animation need. */
export interface FarmParts {
  barn: TransformNode;
  barnDoor: { hinge: TransformNode; mesh: Mesh };
  windmillRotor: TransformNode;
  windmillParts: Mesh[];
}

/** Everything a scenery builder needs; whatever it creates hangs below `root`. */
export interface SceneryKit {
  scene: Scene;
  root: TransformNode;
  rng: () => number;
  /** Creates a material that turns charred when the world is devastated. */
  material(name: string, color: Color3): StandardMaterial;
  /** Destroyed outright by the atomic bomb (tree crowns, roofs, boats …). */
  burnsAway: TransformNode[];
  collapses: Collapse[];
  height(x: number, z: number): number;
}

export interface SceneryDefinition {
  id: SceneryId;
  name: string;
  /** Height of the landscape. The camera stands at x = 0, z = 0 and looks along +z. */
  height(x: number, z: number): number;
  /** Day colour of the ground at a terrain vertex. */
  color(x: number, y: number, z: number): Color3;
  /** Builds the props; returns the farm parts when the scenery has them. */
  build(kit: SceneryKit): FarmParts | null;
}

export function solidMaterial(scene: Scene, name: string, color: Color3): StandardMaterial {
  const material = new StandardMaterial(name, scene);
  material.diffuseColor = color.clone();
  material.specularColor = Color3.Black();
  return material;
}

/** Low-poly mesh whose origin sits at its base, so instances can be placed directly on the terrain. */
export function baseAnchored(mesh: Mesh, offsetY: number, material: StandardMaterial): Mesh {
  mesh.bakeTransformIntoVertices(Matrix.Translation(0, offsetY, 0));
  mesh.convertToFlatShadedMesh();
  mesh.material = material;
  mesh.isPickable = false;
  return mesh;
}

/** Parents a mesh to `parent`, sets its material and position and keeps it out of picking. */
export function attach(mesh: Mesh, parent: TransformNode, material: StandardMaterial, position: Vector3): Mesh {
  mesh.parent = parent;
  mesh.material = material;
  mesh.position.copyFrom(position);
  mesh.isPickable = false;
  return mesh;
}

/**
 * Places instances of `source` (the source itself first) at the given spots; each spot carries a scale.
 * Returns the placed nodes.
 */
export function instances(source: Mesh, kit: SceneryKit, spots: { position: Vector3; scale: number; rotation: number }[]): TransformNode[] {
  source.parent = kit.root;
  return spots.map((spot, index) => {
    const node = index === 0 ? source : source.createInstance(`${source.name}Instance`);
    node.parent = kit.root;
    node.position.copyFrom(spot.position);
    node.scaling.setAll(spot.scale);
    node.rotation.y = spot.rotation;
    node.isPickable = false;
    return node;
  });
}

/** Random spots in the field of view between `near` and `far`, skipping those `blocked` rejects. */
export function scatter(
  kit: SceneryKit,
  count: number,
  near: number,
  far: number,
  blocked: (x: number, z: number) => boolean = () => false,
  spread = 1.4,
): { position: Vector3; scale: number; rotation: number }[] {
  const spots: { position: Vector3; scale: number; rotation: number }[] = [];
  for (let attempt = 0; attempt < count * 4 && spots.length < count; attempt++) {
    const z = near + kit.rng() * (far - near);
    const x = (kit.rng() * 2 - 1) * (z * spread + 20);
    if (blocked(x, z)) continue;
    spots.push({ position: new Vector3(x, kit.height(x, z) - 0.2, z), scale: 0.8 + kit.rng() * 0.9, rotation: kit.rng() * Math.PI * 2 });
  }
  return spots;
}

/** Smooth 0 → 1 between edge0 and edge1. */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** Pines and round-crowned trees on the given spots; the crowns burn away with the atomic bomb. */
export function plantTrees(
  kit: SceneryKit,
  spots: { position: Vector3; scale: number; rotation: number }[],
  options: { pineShare: number; pine?: Color3; leaves?: Color3; trunk?: Color3 },
): void {
  const { scene } = kit;
  const trunk = baseAnchored(
    MeshBuilder.CreateCylinder("trunk", { height: 2, diameterTop: 0.35, diameterBottom: 0.5, tessellation: 6 }, scene),
    1,
    kit.material("trunk", options.trunk ?? new Color3(0.36, 0.24, 0.14)),
  );
  const pine = baseAnchored(
    MeshBuilder.CreateCylinder("pine", { height: 5, diameterTop: 0, diameterBottom: 2.6, tessellation: 7 }, scene),
    4.2,
    kit.material("pineMaterial", options.pine ?? new Color3(0.13, 0.33, 0.17)),
  );
  const leaves = baseAnchored(
    MeshBuilder.CreateSphere("leaves", { diameter: 3.4, segments: 3 }, scene),
    3.6,
    kit.material("leavesMaterial", options.leaves ?? new Color3(0.27, 0.5, 0.2)),
  );
  const pines = spots.filter(() => kit.rng() < options.pineShare);
  const round = spots.filter((spot) => !pines.includes(spot));
  instances(trunk, kit, spots);
  if (pines.length > 0) kit.burnsAway.push(...instances(pine, kit, pines));
  else pine.dispose();
  if (round.length > 0) kit.burnsAway.push(...instances(leaves, kit, round));
  else leaves.dispose();
}

import { Color3, MeshBuilder, TransformNode, Vector3 } from "../babylon";
import { attach, baseAnchored, instances, type SceneryDefinition, type SceneryKit, scatter, smoothstep } from "./kit";

const MESAS = [
  { x: -70, z: 210, radius: 32, height: 42 },
  { x: 80, z: 260, radius: 40, height: 55 },
  { x: 5, z: 330, radius: 60, height: 48 },
];

/** Flat desert floor between terraced canyon walls that open up towards the back, mesas behind. */
function height(x: number, z: number): number {
  const floor = Math.sin(x * 0.05) * Math.cos(z * 0.04) * 0.8 + Math.min(1, z / 60) * 1.5;
  const side = Math.abs(x) - 55 - z * 0.3;
  const wall = Math.min(48, Math.max(0, side * 1.6));
  // Terraces: the wall climbs in steps like layered sandstone.
  const terraced = Math.floor(wall / 9) * 9 + smoothstep(0, 1, (wall % 9) / 9) * 9;
  let mesas = 0;
  for (const mesa of MESAS) {
    const distance = Math.hypot(x - mesa.x, z - mesa.z);
    mesas = Math.max(mesas, mesa.height * (1 - smoothstep(mesa.radius - 7, mesa.radius, distance)));
  }
  return floor + Math.max(terraced, mesas);
}

function color(x: number, y: number, z: number): Color3 {
  const sand = new Color3(0.82, 0.58, 0.36);
  const red = new Color3(0.66, 0.3, 0.17);
  const pale = new Color3(0.86, 0.68, 0.5);
  if (y < 2.5) return Color3.Lerp(sand, pale, 0.5 + 0.5 * Math.sin(x * 0.07) * Math.cos(z * 0.05));
  // Horizontal bands of rock layers.
  const band = 0.5 + 0.5 * Math.sin(y * 0.55);
  return Color3.Lerp(red, pale, band * 0.6);
}

function createCacti(kit: SceneryKit): void {
  const green = kit.material("cactus", new Color3(0.25, 0.45, 0.22));
  const trunk = baseAnchored(MeshBuilder.CreateCylinder("cactus", { height: 4.5, diameter: 0.7, tessellation: 8 }, kit.scene), 2.25, green);
  const spots = scatter(kit, 70, 14, 200, (x, z) => kit.height(x, z) > 3, 0.9);
  const placed = instances(trunk, kit, spots);
  kit.burnsAway.push(...placed);
  // Arms: two bent cylinders per cactus, children of the trunk so they move and burn with it.
  for (const node of placed) {
    for (const side of [-1, 1]) {
      if (kit.rng() < 0.3) continue;
      const elbow = attach(MeshBuilder.CreateCylinder("cactusArm", { height: 1.2, diameter: 0.5, tessellation: 6 }, kit.scene), node as TransformNode, green, new Vector3(side * 0.7, 2 + kit.rng(), 0));
      elbow.rotation.z = side * (Math.PI / 2);
      attach(MeshBuilder.CreateCylinder("cactusArmUp", { height: 1.4, diameter: 0.45, tessellation: 6 }, kit.scene), elbow, green, new Vector3(-0.2, side * 0.55, 0)).rotation.z = -side * (Math.PI / 2);
    }
  }
}

function createWaterTower(kit: SceneryKit): void {
  const wood = kit.material("waterTowerWood", new Color3(0.45, 0.3, 0.18));
  const tower = new TransformNode("waterTower", kit.scene);
  tower.parent = kit.root;
  tower.position.set(-26, kit.height(-26, 60), 60);
  for (const [x, z] of [[-1.6, -1.6], [1.6, -1.6], [1.6, 1.6], [-1.6, 1.6]]) {
    attach(MeshBuilder.CreateBox("waterTowerLeg", { width: 0.35, height: 7, depth: 0.35 }, kit.scene), tower, wood, new Vector3(x ?? 0, 3.5, z ?? 0));
  }
  attach(MeshBuilder.CreateCylinder("waterTowerTank", { height: 4, diameter: 5, tessellation: 12 }, kit.scene), tower, wood, new Vector3(0, 9, 0));
  const roof = attach(MeshBuilder.CreateCylinder("waterTowerRoof", { height: 1.8, diameterTop: 0, diameterBottom: 5.6, tessellation: 12 }, kit.scene), tower, kit.material("waterTowerRoof", new Color3(0.3, 0.2, 0.14)), new Vector3(0, 11.9, 0));
  kit.burnsAway.push(roof);
  kit.collapses.push({ node: tower, tilt: 0.4, squash: 0.5 });
}

function createBoulders(kit: SceneryKit): void {
  const boulder = baseAnchored(MeshBuilder.CreateSphere("boulder", { diameter: 3, segments: 2 }, kit.scene), 0.9, kit.material("boulder", new Color3(0.6, 0.35, 0.22)));
  instances(boulder, kit, scatter(kit, 40, 20, 260, (x, z) => kit.height(x, z) > 3, 0.9));
}

export const CANYON: SceneryDefinition = {
  id: "canyon",
  name: "Canyon",
  height,
  color,
  build(kit: SceneryKit): null {
    createCacti(kit);
    createWaterTower(kit);
    createBoulders(kit);
    return null;
  },
};

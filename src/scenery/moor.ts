import { Color3, MeshBuilder, TransformNode, Vector3 } from "../babylon";
import { createFence } from "./farm";
import { attach, baseAnchored, instances, plantTrees, type SceneryDefinition, type SceneryKit, scatter } from "./kit";

const WATER_LEVEL = 0.15;

/** Wet lowland: barely any relief near the camera, low hills behind, a ridge far back. */
function height(x: number, z: number): number {
  const ramp = Math.min(1, Math.max(0, z - 12) / 160);
  const hummocks = Math.sin(x * 0.11) * Math.cos(z * 0.09) * 0.6 + Math.sin(x * 0.031 + z * 0.023) * 1.2;
  let result = hummocks * Math.min(1, z / 30) + ramp * (4 + Math.sin(x * 0.02) * 4);
  if (z > 300) result += (z - 300) * 0.22;
  return result;
}

function color(x: number, y: number, z: number): Color3 {
  const moss = new Color3(0.36, 0.42, 0.2);
  const heather = new Color3(0.42, 0.28, 0.36);
  const peat = new Color3(0.25, 0.2, 0.13);
  let result = Color3.Lerp(moss, peat, 0.5 + 0.5 * Math.sin(x * 0.13 + 2) * Math.cos(z * 0.11));
  if (Math.sin(x * 0.04 - z * 0.03) > 0.6) result = Color3.Lerp(result, heather, 0.7);
  if (y < WATER_LEVEL + 0.3) result = Color3.Lerp(result, peat, 0.6);
  return result;
}

function createPools(kit: SceneryKit): void {
  const water = kit.material("moorWater", new Color3(0.1, 0.14, 0.16));
  water.specularColor = new Color3(0.5, 0.5, 0.5);
  water.specularPower = 64;
  // One large sheet at water level: it shows wherever the ground dips below it.
  const sheet = MeshBuilder.CreateGround("moorWater", { width: 900, height: 520 }, kit.scene);
  sheet.material = water;
  sheet.parent = kit.root;
  sheet.position.set(0, WATER_LEVEL, 270);
  sheet.isPickable = false;
}

function createReeds(kit: SceneryKit): void {
  const reed = baseAnchored(
    MeshBuilder.CreateCylinder("reed", { height: 1.8, diameterTop: 0.02, diameterBottom: 0.08, tessellation: 4 }, kit.scene),
    0.9,
    kit.material("reedMaterial", new Color3(0.55, 0.5, 0.25)),
  );
  const spots = scatter(kit, 900, 12, 160, (x, z) => kit.height(x, z) > 0.6, 1.2).map((spot) => ({
    ...spot,
    scale: 0.6 + kit.rng() * 0.8,
  }));
  kit.burnsAway.push(...instances(reed, kit, spots));
}

function createBoardwalk(kit: SceneryKit): void {
  const wood = kit.material("boardwalk", new Color3(0.4, 0.3, 0.2));
  const walk = new TransformNode("boardwalk", kit.scene);
  walk.parent = kit.root;
  for (let i = 0; i < 26; i++) {
    const z = 14 + i * 2.1;
    const x = Math.sin(i * 0.25) * 6 - 4;
    const plank = attach(MeshBuilder.CreateBox("plank", { width: 1.6, height: 0.12, depth: 1.9 }, kit.scene), walk, wood, new Vector3(x, 0.45, z));
    plank.rotation.y = Math.cos(i * 0.25) * 0.25;
    for (const side of [-0.7, 0.7]) {
      attach(MeshBuilder.CreateBox("pile", { width: 0.12, height: 0.9, depth: 0.12 }, kit.scene), walk, wood, new Vector3(x + side, 0.05, z));
    }
  }
  kit.burnsAway.push(walk);
}

function createHut(kit: SceneryKit): void {
  const hut = new TransformNode("peatHut", kit.scene);
  hut.parent = kit.root;
  hut.position.set(24, kit.height(24, 75), 75);
  hut.rotation.y = -0.5;
  attach(MeshBuilder.CreateBox("hutWalls", { width: 5, height: 2.6, depth: 4 }, kit.scene), hut, kit.material("hutWood", new Color3(0.33, 0.24, 0.17)), new Vector3(0, 1.3, 0));
  const roof = attach(
    MeshBuilder.CreateCylinder("hutRoof", { height: 5.6, diameter: 4.4, tessellation: 3 }, kit.scene),
    hut,
    kit.material("hutThatch", new Color3(0.55, 0.45, 0.25)),
    new Vector3(0, 3.3, 0),
  );
  roof.rotation.z = Math.PI / 2;
  kit.burnsAway.push(roof);
  // Stacked peat sods drying next to the hut.
  const peat = kit.material("peatSods", new Color3(0.2, 0.14, 0.09));
  for (let i = 0; i < 6; i++) {
    attach(MeshBuilder.CreateBox("peatSod", { width: 0.6, height: 0.3, depth: 0.3 }, kit.scene), hut, peat, new Vector3(3.4 + (i % 3) * 0.65, 0.15 + Math.floor(i / 3) * 0.3, 1));
  }
  kit.collapses.push({ node: hut, tilt: 0.3, squash: 0.4 });
}

export const MOOR: SceneryDefinition = {
  id: "moor",
  name: "Moor",
  height,
  color,
  build(kit: SceneryKit): null {
    createPools(kit);
    createReeds(kit);
    createBoardwalk(kit);
    createHut(kit);
    createFence(kit, 9);
    // Birches with pale trunks on the drier hummocks, a few pines further back.
    const dry = scatter(kit, 120, 30, 300, (x, z) => kit.height(x, z) < 0.8 || (Math.abs(x - 24) < 8 && Math.abs(z - 75) < 8));
    plantTrees(kit, dry, { pineShare: 0.3, trunk: new Color3(0.85, 0.83, 0.78), leaves: new Color3(0.45, 0.55, 0.22) });
    return null;
  },
};

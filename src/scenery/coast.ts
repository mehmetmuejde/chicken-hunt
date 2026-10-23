import { Color3, MeshBuilder, TransformNode, Vector3 } from "../babylon";
import { attach, baseAnchored, instances, type SceneryDefinition, type SceneryKit, scatter, smoothstep } from "./kit";

const SEA_LEVEL = 0;

/** Dunes in front, a beach running into the sea, rocky headlands on both sides. */
function height(x: number, z: number): number {
  const beach = 1.6 - smoothstep(18, 120, z) * 6;
  const dunes = Math.max(0, 1 - z / 35) * (Math.sin(x * 0.15) * Math.cos(z * 0.2) * 0.7 + 0.4);
  const side = Math.abs(x) - 70;
  const headland = side > 0 ? Math.min(32, side * 0.6) * smoothstep(20, 70, z) * (1 - smoothstep(240, 320, z)) : 0;
  const ripple = Math.sin(x * 0.4) * Math.cos(z * 0.3) * 0.15;
  return beach + dunes + headland + ripple;
}

function color(x: number, y: number, z: number): Color3 {
  const sand = new Color3(0.86, 0.78, 0.55);
  const wetSand = new Color3(0.62, 0.55, 0.38);
  const dune = new Color3(0.55, 0.62, 0.32);
  const rock = new Color3(0.42, 0.4, 0.38);
  let result = sand;
  if (y < SEA_LEVEL + 0.4) result = wetSand;
  if (z < 30 && y > 1.4 && Math.sin(x * 0.3 + z * 0.5) > 0.2) result = Color3.Lerp(sand, dune, 0.7);
  if (y > 4) result = Color3.Lerp(result, rock, Math.min(1, (y - 4) / 6));
  if (y > 22) result = Color3.Lerp(result, dune, 0.5);
  return result;
}

function createSea(kit: SceneryKit): void {
  const water = kit.material("sea", new Color3(0.12, 0.35, 0.5));
  water.specularColor = new Color3(0.6, 0.6, 0.6);
  water.specularPower = 48;
  water.alpha = 0.92;
  const sea = MeshBuilder.CreateGround("sea", { width: 1400, height: 900 }, kit.scene);
  sea.material = water;
  sea.parent = kit.root;
  sea.position.set(0, SEA_LEVEL, 420);
  sea.isPickable = false;
  // A line of surf where the waves reach the beach.
  const foam = MeshBuilder.CreateGround("surf", { width: 140, height: 3 }, kit.scene);
  foam.material = kit.material("surf", new Color3(0.92, 0.95, 0.96));
  foam.parent = kit.root;
  foam.position.set(0, SEA_LEVEL + 0.05, 47);
  foam.isPickable = false;
  kit.burnsAway.push(foam);
}

function createLighthouse(kit: SceneryKit): void {
  const lighthouse = new TransformNode("lighthouse", kit.scene);
  lighthouse.parent = kit.root;
  const x = 95;
  const z = 120;
  lighthouse.position.set(x, kit.height(x, z) - 0.5, z);
  const white = kit.material("lighthouseWhite", new Color3(0.92, 0.92, 0.9));
  const red = kit.material("lighthouseRed", new Color3(0.75, 0.12, 0.1));
  for (let i = 0; i < 4; i++) {
    const bottom = 4.6 - i * 0.5;
    const top = bottom - 0.5;
    attach(
      MeshBuilder.CreateCylinder("lighthouseBand", { height: 5, diameterBottom: bottom, diameterTop: top, tessellation: 12 }, kit.scene),
      lighthouse,
      i % 2 === 0 ? white : red,
      new Vector3(0, 2.5 + i * 5, 0),
    );
  }
  const lamp = kit.material("lighthouseLamp", new Color3(1, 0.92, 0.6));
  lamp.emissiveColor = new Color3(1, 0.9, 0.55);
  attach(MeshBuilder.CreateCylinder("lighthouseLantern", { height: 2.2, diameter: 2.6, tessellation: 10 }, kit.scene), lighthouse, lamp, new Vector3(0, 21.1, 0));
  const cap = attach(MeshBuilder.CreateCylinder("lighthouseCap", { height: 1.6, diameterTop: 0, diameterBottom: 3.2, tessellation: 10 }, kit.scene), lighthouse, red, new Vector3(0, 23, 0));
  kit.burnsAway.push(cap);
  kit.collapses.push({ node: lighthouse, tilt: 0.35, squash: 0.45 });
  // Keeper's cottage at its foot.
  const cottage = attach(MeshBuilder.CreateBox("keeperCottage", { width: 6, height: 3, depth: 4 }, kit.scene), lighthouse, white, new Vector3(-6, 1.5, 2));
  kit.collapses.push({ node: cottage, tilt: 0.1, squash: 0.4 });
}

function createBoat(kit: SceneryKit): void {
  const boat = new TransformNode("fishingBoat", kit.scene);
  boat.parent = kit.root;
  boat.position.set(-30, SEA_LEVEL, 150);
  boat.rotation.y = 0.9;
  const hull = attach(MeshBuilder.CreateBox("boatHull", { width: 3, height: 1.4, depth: 9 }, kit.scene), boat, kit.material("boatHull", new Color3(0.15, 0.3, 0.55)), new Vector3(0, 0.3, 0));
  hull.scaling.x = 1;
  attach(MeshBuilder.CreateBox("boatCabin", { width: 2.2, height: 2, depth: 2.6 }, kit.scene), boat, kit.material("boatCabin", new Color3(0.9, 0.88, 0.82)), new Vector3(0, 1.9, -1.5));
  attach(MeshBuilder.CreateCylinder("boatMast", { height: 7, diameter: 0.2, tessellation: 6 }, kit.scene), boat, kit.material("boatMast", new Color3(0.4, 0.3, 0.2)), new Vector3(0, 4, 2));
  kit.burnsAway.push(boat);
}

function createRocks(kit: SceneryKit): void {
  const rock = baseAnchored(MeshBuilder.CreateSphere("seaRock", { diameter: 4, segments: 2 }, kit.scene), 0.6, kit.material("seaRock", new Color3(0.32, 0.31, 0.3)));
  const spots = [
    { position: new Vector3(40, -1.5, 90), scale: 1.6, rotation: 0.3 },
    { position: new Vector3(48, -1.8, 96), scale: 1.1, rotation: 1.4 },
    { position: new Vector3(-55, -1.5, 85), scale: 1.8, rotation: 2.2 },
    { position: new Vector3(-20, -2, 230), scale: 2.6, rotation: 0.8 },
    { position: new Vector3(70, -1.2, 70), scale: 1.3, rotation: 2.9 },
  ];
  instances(rock, kit, spots);
}

function createDuneGrass(kit: SceneryKit): void {
  // Thin tufts of marram grass: a narrow, pointed blade bundle.
  const grass = baseAnchored(
    MeshBuilder.CreateCylinder("duneGrass", { height: 0.7, diameterTop: 0, diameterBottom: 0.35, tessellation: 4 }, kit.scene),
    0.35,
    kit.material("duneGrass", new Color3(0.62, 0.64, 0.38)),
  );
  const spots = scatter(kit, 260, 8, 32, (x, z) => kit.height(x, z) < 1.2, 2.5).map((spot) => ({ ...spot, scale: 0.5 + kit.rng() * 0.5 }));
  kit.burnsAway.push(...instances(grass, kit, spots));
}

export const COAST: SceneryDefinition = {
  id: "coast",
  name: "Coast",
  height,
  color,
  build(kit: SceneryKit): null {
    createSea(kit);
    createLighthouse(kit);
    createBoat(kit);
    createRocks(kit);
    createDuneGrass(kit);
    return null;
  },
};

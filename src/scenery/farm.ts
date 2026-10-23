import { Color3, type Mesh, MeshBuilder, TransformNode, Vector3 } from "../babylon";
import { type FarmParts, plantTrees, type SceneryDefinition, type SceneryKit, scatter } from "./kit";

/** Flat near the camera, hills further out, mountains at the back. */
function height(x: number, z: number): number {
  const ramp = Math.min(1, Math.max(0, z - 15) / 120);
  const hills =
    Math.sin(x * 0.035) * Math.cos(z * 0.03) * 5 +
    Math.sin(x * 0.013 + z * 0.01 + 1.3) * 7 +
    Math.cos(x * 0.07 + z * 0.05) * 1.5;
  let result = (hills + 6) * ramp;
  if (z > 260) {
    result += (z - 260) * 0.38 * (0.6 + 0.4 * Math.sin(x * 0.02 + 2));
  }
  return result + Math.sin(x * 0.2) * Math.cos(z * 0.25) * 0.3;
}

function color(x: number, y: number, z: number): Color3 {
  const grass = new Color3(0.38, 0.63, 0.25);
  const darkGrass = new Color3(0.24, 0.47, 0.18);
  const wheat = new Color3(0.8, 0.7, 0.34);
  const rock = new Color3(0.5, 0.52, 0.56);
  const snow = new Color3(0.95, 0.96, 1);

  let result = Color3.Lerp(grass, darkGrass, 0.5 + 0.5 * Math.sin(x * 0.09) * Math.cos(z * 0.07));
  if (z > 40 && z < 220 && Math.sin(x * 0.05 + z * 0.012) > 0.75) {
    result = Color3.Lerp(result, wheat, 0.85);
  }
  if (y > 30) result = Color3.Lerp(result, rock, Math.min(1, (y - 30) / 20));
  if (y > 75) result = Color3.Lerp(result, snow, Math.min(1, (y - 75) / 10));
  return result;
}

function createBarn(kit: SceneryKit): { barn: TransformNode; door: { hinge: TransformNode; mesh: Mesh } } {
  const { scene } = kit;
  const barn = new TransformNode("barn", scene);
  barn.parent = kit.root;
  barn.position.set(-30, height(-30, 70) - 0.3, 70);
  barn.rotation.y = 0.4;

  const body = MeshBuilder.CreateBox("barnBody", { width: 8, height: 5, depth: 10 }, scene);
  body.material = kit.material("barnRed", new Color3(0.62, 0.16, 0.12));
  body.position.y = 2.5;

  // A box turned by 45° whose lower half disappears inside the walls forms the gable roof.
  const roof = MeshBuilder.CreateBox("barnRoof", { width: 6, height: 6, depth: 10 }, scene);
  roof.material = kit.material("barnRoofMaterial", new Color3(0.3, 0.22, 0.2));
  roof.rotation.z = Math.PI / 4;
  roof.position.y = 5;
  kit.burnsAway.push(roof);

  // The door hangs on a hinge at its left edge so it can swing open.
  const hinge = new TransformNode("barnDoorHinge", scene);
  hinge.parent = barn;
  hinge.position.set(-1.6, 0, -5.05);
  const door = MeshBuilder.CreateBox("barnDoor", { width: 3.2, height: 3.6, depth: 0.2 }, scene);
  door.material = kit.material("barnDoorMaterial", new Color3(0.92, 0.9, 0.84));
  door.parent = hinge;
  door.position.set(1.6, 1.8, 0);
  door.isPickable = false;

  for (const mesh of [body, roof]) {
    mesh.parent = barn;
    mesh.isPickable = false;
  }
  // The barn is left as a sagging, blackened ruin.
  kit.collapses.push({ node: barn, tilt: 0.22, squash: 0.55 });
  return { barn, door: { hinge, mesh: door } };
}

function createWindmill(kit: SceneryKit): { rotor: TransformNode; parts: Mesh[] } {
  const { scene } = kit;
  const windmill = new TransformNode("windmill", scene);
  windmill.parent = kit.root;
  windmill.position.set(45, height(45, 120) - 0.5, 120);
  windmill.rotation.y = -0.2;

  const tower = MeshBuilder.CreateCylinder("windmillTower", { height: 14, diameterTop: 3, diameterBottom: 5.5, tessellation: 8 }, scene);
  tower.material = kit.material("windmillTowerMaterial", new Color3(0.9, 0.86, 0.76));
  tower.position.y = 7;

  const cap = MeshBuilder.CreateCylinder("windmillCap", { height: 2.6, diameterTop: 0, diameterBottom: 4, tessellation: 8 }, scene);
  cap.material = kit.material("windmillCapMaterial", new Color3(0.35, 0.2, 0.15));
  cap.position.y = 15.3;
  kit.burnsAway.push(cap);

  const rotor = new TransformNode("windmillRotor", scene);
  rotor.parent = windmill;
  rotor.position.set(0, 14.2, -2.2);
  kit.burnsAway.push(rotor);

  const bladeMaterial = kit.material("windmillBladeMaterial", new Color3(0.55, 0.38, 0.24));
  const hub = MeshBuilder.CreateSphere("windmillHub", { diameter: 0.9, segments: 8 }, scene);
  hub.material = bladeMaterial;
  hub.parent = rotor;
  hub.isPickable = false;
  const parts: Mesh[] = [hub];
  for (let i = 0; i < 4; i++) {
    const arm = new TransformNode(`windmillArm${i}`, scene);
    arm.parent = rotor;
    arm.rotation.z = (i * Math.PI) / 2;
    const blade = MeshBuilder.CreateBox(`windmillBlade${i}`, { width: 1.5, height: 8, depth: 0.15 }, scene);
    blade.material = bladeMaterial;
    blade.parent = arm;
    blade.position.set(0.5, 4.6, 0);
    blade.isPickable = false;
    parts.push(blade);
  }

  for (const mesh of [tower, cap]) {
    mesh.parent = windmill;
    mesh.isPickable = false;
  }
  kit.collapses.push({ node: windmill, tilt: -0.12, squash: 0.7 });
  return { rotor, parts };
}

/** Wooden fence across the foreground — shared with the moor. */
export function createFence(kit: SceneryKit, z = 10): void {
  const { scene } = kit;
  const wood = kit.material("fenceWood", new Color3(0.45, 0.31, 0.18));
  const post = MeshBuilder.CreateBox("fencePost", { width: 0.25, height: 1.4, depth: 0.25 }, scene);
  post.material = wood;
  post.isPickable = false;
  post.parent = kit.root;
  post.position.set(-100, kit.height(-100, z) + 0.7, z);
  for (let x = -97; x <= 100; x += 3) {
    const instance = post.createInstance("fencePostInstance");
    instance.parent = kit.root;
    instance.position.set(x, kit.height(x, z) + 0.7 + Math.sin(x) * 0.05, z);
    instance.rotation.z = Math.sin(x * 1.7) * 0.04;
    instance.isPickable = false;
  }
  for (const y of [0.5, 1.05]) {
    const rail = MeshBuilder.CreateBox("fenceRail", { width: 200, height: 0.14, depth: 0.08 }, scene);
    rail.material = wood;
    rail.parent = kit.root;
    rail.position.set(0, kit.height(0, z) + y, z - 0.16);
    rail.isPickable = false;
  }
}

function createHayBales(kit: SceneryKit): void {
  const hay = kit.material("hay", new Color3(0.86, 0.73, 0.36));
  const spots = [new Vector3(-7, 0.9, 14), new Vector3(8, 0.9, 16), new Vector3(10.2, 0.9, 17.5), new Vector3(9.1, 2.4, 16.8)];
  spots.forEach((spot, index) => {
    const bale = MeshBuilder.CreateCylinder(`hayBale${index}`, { diameter: 1.8, height: 1.4, tessellation: 16 }, kit.scene);
    bale.material = hay;
    bale.parent = kit.root;
    bale.rotation.z = Math.PI / 2;
    bale.rotation.y = index * 0.7;
    bale.position.copyFrom(spot);
    bale.isPickable = false;
    kit.burnsAway.push(bale);
  });
}

export const FARM: SceneryDefinition = {
  id: "farm",
  name: "Farm",
  height,
  color,
  build(kit: SceneryKit): FarmParts {
    const spots = scatter(kit, 260, 25, 290, (x, z) => (Math.abs(x + 30) < 12 && Math.abs(z - 70) < 12) || (Math.abs(x - 45) < 8 && Math.abs(z - 120) < 8));
    plantTrees(kit, spots, { pineShare: 0.55 });
    const { barn, door } = createBarn(kit);
    const { rotor, parts } = createWindmill(kit);
    createFence(kit);
    createHayBales(kit);
    return { barn, barnDoor: door, windmillRotor: rotor, windmillParts: parts };
  },
};

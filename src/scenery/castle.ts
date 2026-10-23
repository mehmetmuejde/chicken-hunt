import { Color3, MeshBuilder, type StandardMaterial, TransformNode, Vector3 } from "../babylon";
import { attach, plantTrees, type SceneryDefinition, type SceneryKit, scatter, smoothstep } from "./kit";

const HILL = { x: 10, z: 160, radius: 75, height: 34 };

/** Rolling meadow with a castle hill in the middle and wooded ridges around it. */
function height(x: number, z: number): number {
  const ramp = Math.min(1, Math.max(0, z - 15) / 110);
  const rolling = Math.sin(x * 0.03) * Math.cos(z * 0.025) * 4 + Math.sin(x * 0.012 + z * 0.015) * 6;
  const distance = Math.hypot(x - HILL.x, z - HILL.z);
  const hill = HILL.height * (1 - smoothstep(0, HILL.radius, distance));
  // The top of the castle hill is flattened for the ruin.
  const plateau = Math.min(hill, HILL.height * 0.86);
  let result = (rolling + 5) * ramp + plateau;
  if (z > 280) result += (z - 280) * 0.3;
  return result;
}

function color(x: number, y: number, z: number): Color3 {
  const grass = new Color3(0.36, 0.56, 0.24);
  const darkGrass = new Color3(0.22, 0.4, 0.16);
  const rock = new Color3(0.48, 0.46, 0.43);
  let result = Color3.Lerp(grass, darkGrass, 0.5 + 0.5 * Math.sin(x * 0.08) * Math.cos(z * 0.06));
  const distance = Math.hypot(x - HILL.x, z - HILL.z);
  // Bare rock shows on the steep flanks of the castle hill.
  if (distance > 20 && distance < 55 && y > 10) result = Color3.Lerp(result, rock, 0.55);
  if (y > 60) result = Color3.Lerp(result, rock, Math.min(1, (y - 60) / 20));
  return result;
}

/** Wall from a to b with crenellations; `broken` leaves a gap in the middle. */
function wall(kit: SceneryKit, parent: TransformNode, stone: StandardMaterial, a: Vector3, b: Vector3, wallHeight: number, broken: boolean): void {
  const length = Vector3.Distance(a, b);
  const angle = Math.atan2(b.x - a.x, b.z - a.z);
  const pieces = broken ? [[0, 0.38], [0.62, 1]] : [[0, 1]];
  for (const [from, to] of pieces) {
    const segment = new TransformNode("wallSegment", kit.scene);
    segment.parent = parent;
    const start = Vector3.Lerp(a, b, from ?? 0);
    const end = Vector3.Lerp(a, b, to ?? 1);
    segment.position.copyFrom(Vector3.Center(start, end));
    segment.rotation.y = angle;
    const segmentLength = length * ((to ?? 1) - (from ?? 0));
    // Ruined walls are uneven: every segment ends at a different height.
    const top = wallHeight * (0.7 + kit.rng() * 0.3);
    attach(MeshBuilder.CreateBox("wall", { width: 2, height: top, depth: segmentLength }, kit.scene), segment, stone, new Vector3(0, top / 2, 0));
    for (let i = 0; i < segmentLength / 2.2; i++) {
      if (kit.rng() < 0.25) continue;
      attach(MeshBuilder.CreateBox("merlon", { width: 2, height: 1, depth: 1.1 }, kit.scene), segment, stone, new Vector3(0, top + 0.5, -segmentLength / 2 + 1 + i * 2.2));
    }
    kit.collapses.push({ node: segment, tilt: (kit.rng() - 0.5) * 0.3, squash: 0.35 });
  }
}

function tower(kit: SceneryKit, parent: TransformNode, stone: StandardMaterial, roof: StandardMaterial, position: Vector3, towerHeight: number, roofed: boolean): void {
  const node = new TransformNode("tower", kit.scene);
  node.parent = parent;
  node.position.copyFrom(position);
  attach(MeshBuilder.CreateCylinder("towerBody", { height: towerHeight, diameter: 7, tessellation: 10 }, kit.scene), node, stone, new Vector3(0, towerHeight / 2, 0));
  for (let i = 0; i < 10; i += 2) {
    const angle = (i / 10) * Math.PI * 2;
    attach(MeshBuilder.CreateBox("towerMerlon", { width: 1.2, height: 1.2, depth: 1.2 }, kit.scene), node, stone, new Vector3(Math.cos(angle) * 3.1, towerHeight + 0.6, Math.sin(angle) * 3.1));
  }
  if (roofed) {
    const cone = attach(MeshBuilder.CreateCylinder("towerRoof", { height: 6, diameterTop: 0, diameterBottom: 8, tessellation: 10 }, kit.scene), node, roof, new Vector3(0, towerHeight + 3, 0));
    kit.burnsAway.push(cone);
  }
  kit.collapses.push({ node, tilt: (kit.rng() - 0.5) * 0.4, squash: 0.3 });
}

function createRuin(kit: SceneryKit): void {
  const stone = kit.material("castleStone", new Color3(0.56, 0.54, 0.5));
  const roof = kit.material("castleRoof", new Color3(0.32, 0.18, 0.15));
  const ruin = new TransformNode("castleRuin", kit.scene);
  ruin.parent = kit.root;
  const base = HILL.height * 0.86;
  ruin.position.set(HILL.x, base - 0.5, HILL.z);

  const corners = [new Vector3(-22, 0, -14), new Vector3(22, 0, -14), new Vector3(24, 0, 16), new Vector3(-20, 0, 18)];
  corners.forEach((corner, index) => {
    const next = corners[(index + 1) % corners.length] ?? corner;
    wall(kit, ruin, stone, corner, next, 7, index % 2 === 0);
    tower(kit, ruin, stone, roof, corner, index === 1 ? 16 : 11 + kit.rng() * 3, index === 1);
  });
  // The keep: a tall square tower with a broken top.
  const keep = new TransformNode("keep", kit.scene);
  keep.parent = ruin;
  keep.position.set(2, 0, 4);
  attach(MeshBuilder.CreateBox("keepBody", { width: 10, height: 22, depth: 10 }, kit.scene), keep, stone, new Vector3(0, 11, 0));
  const broken = attach(MeshBuilder.CreateBox("keepBroken", { width: 10, height: 6, depth: 5 }, kit.scene), keep, stone, new Vector3(0, 25, -2.5));
  broken.rotation.x = 0.15;
  attach(MeshBuilder.CreateBox("keepWindow", { width: 1, height: 2.4, depth: 10.2 }, kit.scene), keep, kit.material("castleDark", new Color3(0.08, 0.07, 0.07)), new Vector3(0, 15, 0));
  kit.collapses.push({ node: keep, tilt: 0.12, squash: 0.35 });
  // A flag on the tall tower.
  const flag = attach(MeshBuilder.CreateBox("flag", { width: 3, height: 1.8, depth: 0.05 }, kit.scene), ruin, kit.material("castleFlag", new Color3(0.75, 0.12, 0.1)), new Vector3(23.5, 25.5, -14));
  kit.burnsAway.push(flag);
}

export const CASTLE: SceneryDefinition = {
  id: "castle",
  name: "Castle ruin",
  height,
  color,
  build(kit: SceneryKit): null {
    createRuin(kit);
    const blocked = (x: number, z: number): boolean => Math.hypot(x - HILL.x, z - HILL.z) < 40;
    plantTrees(kit, scatter(kit, 240, 25, 300, blocked), { pineShare: 0.6 });
    return null;
  },
};

import { Color3, DynamicTexture, MeshBuilder, type StandardMaterial, TransformNode, Vector3 } from "../babylon";
import { attach, baseAnchored, instances, plantTrees, type SceneryDefinition, type SceneryKit, scatter, smoothstep } from "./kit";

const VALLEY_DEPTH = 32;
const CITY = { near: 85, far: 320 };
const BLOCK = 22;

/** A lookout hill in front, the city on the valley floor, mountains around it. */
function height(x: number, z: number): number {
  const hill = Math.sin(x * 0.2) * Math.cos(z * 0.3) * 0.25;
  const down = smoothstep(18, 72, z) * VALLEY_DEPTH;
  let result = hill - down;
  // Mountains close the valley at the back and on the sides.
  if (z > 340) result += (z - 340) * 0.55;
  const side = Math.abs(x) - 260 - z * 0.2;
  if (side > 0) result += side * 0.5;
  return result;
}

function isStreet(x: number, z: number): boolean {
  const u = ((x % BLOCK) + BLOCK) % BLOCK;
  const v = ((z % BLOCK) + BLOCK) % BLOCK;
  return u < 5 || v < 5;
}

function color(x: number, y: number, z: number): Color3 {
  const grass = new Color3(0.36, 0.55, 0.24);
  const asphalt = new Color3(0.3, 0.3, 0.32);
  const pavement = new Color3(0.55, 0.54, 0.52);
  const rock = new Color3(0.48, 0.47, 0.45);
  if (z > CITY.near - 10 && z < CITY.far + 10 && y < -VALLEY_DEPTH + 3) {
    return isStreet(x, z) ? asphalt : pavement;
  }
  let result = Color3.Lerp(grass, grass.scale(0.75), 0.5 + 0.5 * Math.sin(x * 0.1) * Math.cos(z * 0.08));
  if (y > 10) result = Color3.Lerp(result, rock, Math.min(1, (y - 10) / 25));
  return result;
}

/** Facade with rows of windows; lit windows glow through the emissive channel at night. */
function facadeMaterial(kit: SceneryKit, name: string, wall: Color3): StandardMaterial {
  const size = 128;
  const texture = new DynamicTexture(`${name}Texture`, { width: size, height: size }, kit.scene, true);
  const ctx = texture.getContext();
  ctx.fillStyle = `rgb(${wall.r * 255}, ${wall.g * 255}, ${wall.b * 255})`;
  ctx.fillRect(0, 0, size, size);
  for (let row = 0; row < 8; row++) {
    for (let column = 0; column < 4; column++) {
      const lit = kit.rng() < 0.35;
      ctx.fillStyle = lit ? "#f4dc8c" : "#1d2630";
      ctx.fillRect(column * 32 + 8, row * 16 + 4, 16, 9);
    }
  }
  texture.update();
  const material = kit.material(name, Color3.White());
  material.diffuseTexture = texture;
  material.emissiveTexture = texture;
  material.emissiveColor = new Color3(0.18, 0.18, 0.18);
  return material;
}

function createBuildings(kit: SceneryKit): void {
  const facades = [
    facadeMaterial(kit, "facadeConcrete", new Color3(0.72, 0.7, 0.66)),
    facadeMaterial(kit, "facadeBrick", new Color3(0.6, 0.32, 0.24)),
    facadeMaterial(kit, "facadeGlass", new Color3(0.36, 0.46, 0.56)),
  ];
  const roof = kit.material("cityRoof", new Color3(0.25, 0.25, 0.27));
  const prototypes = facades.map((facade, index) =>
    baseAnchored(MeshBuilder.CreateBox(`building${index}`, { size: 1 }, kit.scene), 0.5, facade),
  );
  const spots: { position: Vector3; scale: number; rotation: number; width: number; depth: number; height: number; type: number }[] = [];
  const floor = -VALLEY_DEPTH + 0.2;
  // Blocks follow the street grid of the ground colours: a 5 m street, then 17 m of buildings.
  for (let z = Math.ceil(CITY.near / BLOCK) * BLOCK; z < CITY.far; z += BLOCK) {
    const halfWidth = 60 + (z - CITY.near) * 0.7;
    for (let x = -Math.floor(halfWidth / BLOCK) * BLOCK; x < halfWidth; x += BLOCK) {
      // Taller buildings towards the centre of the city.
      const centre = 1 - Math.min(1, Math.hypot(x / 120, (z - 200) / 110));
      const count = 1 + Math.floor(kit.rng() * 2);
      for (let i = 0; i < count; i++) {
        if (kit.rng() < 0.12) continue; // a park or a square
        const width = 6 + kit.rng() * 6;
        const depth = 6 + kit.rng() * 6;
        const tall = 8 + kit.rng() * 14 + centre * centre * 70 * kit.rng();
        const px = x + 5 + width / 2 + kit.rng() * (BLOCK - 5 - width);
        const pz = z + 5 + depth / 2 + kit.rng() * Math.max(0, BLOCK - 5 - depth);
        spots.push({
          position: new Vector3(px, floor, pz),
          scale: 1,
          rotation: 0,
          width,
          depth,
          height: tall,
          type: tall > 45 ? 2 : Math.floor(kit.rng() * 2),
        });
      }
    }
  }
  prototypes.forEach((prototype, type) => {
    const mine = spots.filter((spot) => spot.type === type);
    if (mine.length === 0) {
      prototype.dispose();
      return;
    }
    const placed = instances(prototype, kit, mine);
    placed.forEach((node, index) => {
      const spot = mine[index];
      if (!spot) return;
      node.scaling.set(spot.width, spot.height, spot.depth);
      // Flattened and tilted stumps are all that is left after the bomb.
      kit.collapses.push({ node, tilt: (kit.rng() - 0.5) * 0.25, squash: 0.08 + kit.rng() * 0.2 });
    });
  });
  // Flat roofs with a small structure on the tall ones.
  const roofBox = baseAnchored(MeshBuilder.CreateBox("roofTop", { size: 1 }, kit.scene), 0.5, roof);
  const tops = spots
    .filter((spot) => spot.height > 30)
    .map((spot) => ({ position: spot.position.add(new Vector3(0, spot.height, 0)), scale: 3, rotation: 0 }));
  if (tops.length > 0) kit.burnsAway.push(...instances(roofBox, kit, tops));
  else roofBox.dispose();
}

function createTvTower(kit: SceneryKit): void {
  const tower = new TransformNode("tvTower", kit.scene);
  tower.parent = kit.root;
  tower.position.set(-70, -VALLEY_DEPTH, 250);
  const concrete = kit.material("tvTowerConcrete", new Color3(0.8, 0.8, 0.78));
  attach(MeshBuilder.CreateCylinder("tvShaft", { height: 120, diameterTop: 4, diameterBottom: 9, tessellation: 12 }, kit.scene), tower, concrete, new Vector3(0, 60, 0));
  attach(MeshBuilder.CreateSphere("tvBall", { diameter: 16, segments: 12 }, kit.scene), tower, kit.material("tvBall", new Color3(0.55, 0.6, 0.68)), new Vector3(0, 108, 0));
  const antenna = attach(MeshBuilder.CreateCylinder("tvAntenna", { height: 30, diameterTop: 0.6, diameterBottom: 2, tessellation: 8 }, kit.scene), tower, kit.material("tvAntenna", new Color3(0.8, 0.2, 0.15)), new Vector3(0, 135, 0));
  kit.burnsAway.push(antenna);
  kit.collapses.push({ node: tower, tilt: 0.5, squash: 0.35 });
}

function createChurch(kit: SceneryKit): void {
  const church = new TransformNode("church", kit.scene);
  church.parent = kit.root;
  church.position.set(55, -VALLEY_DEPTH, 140);
  church.rotation.y = 0.3;
  const stone = kit.material("churchStone", new Color3(0.78, 0.74, 0.66));
  attach(MeshBuilder.CreateBox("churchNave", { width: 10, height: 12, depth: 26 }, kit.scene), church, stone, new Vector3(0, 6, 0));
  attach(MeshBuilder.CreateBox("churchTower", { width: 7, height: 30, depth: 7 }, kit.scene), church, stone, new Vector3(0, 15, -15));
  const spire = attach(MeshBuilder.CreateCylinder("churchSpire", { height: 18, diameterTop: 0, diameterBottom: 8, tessellation: 4 }, kit.scene), church, kit.material("churchSpire", new Color3(0.25, 0.45, 0.38)), new Vector3(0, 39, -15));
  spire.rotation.y = Math.PI / 4;
  kit.burnsAway.push(spire);
  kit.collapses.push({ node: church, tilt: -0.2, squash: 0.3 });
}

function createLookout(kit: SceneryKit): void {
  // Stone parapet at the edge of the lookout and a bench.
  const stone = kit.material("parapet", new Color3(0.6, 0.58, 0.54));
  for (let x = -60; x <= 60; x += 6) {
    attach(MeshBuilder.CreateBox("parapet", { width: 6.1, height: 0.9, depth: 0.6 }, kit.scene), kit.root, stone, new Vector3(x, kit.height(x, 11) + 0.45, 11));
  }
  const wood = kit.material("bench", new Color3(0.45, 0.3, 0.18));
  const bench = new TransformNode("bench", kit.scene);
  bench.parent = kit.root;
  bench.position.set(-6, 0, 7);
  attach(MeshBuilder.CreateBox("benchSeat", { width: 2.4, height: 0.12, depth: 0.6 }, kit.scene), bench, wood, new Vector3(0, 0.5, 0));
  attach(MeshBuilder.CreateBox("benchBack", { width: 2.4, height: 0.5, depth: 0.1 }, kit.scene), bench, wood, new Vector3(0, 0.85, 0.3));
  kit.burnsAway.push(bench);
}

export const CITY_SCENERY: SceneryDefinition = {
  id: "city",
  name: "City",
  height,
  color,
  build(kit: SceneryKit): null {
    createBuildings(kit);
    createTvTower(kit);
    createChurch(kit);
    createLookout(kit);
    // Trees on the slopes around the valley and in the parks.
    const slopes = scatter(kit, 160, 20, 340, (x, z) => (z > CITY.near - 5 && z < CITY.far && Math.abs(x) < 60 + (z - CITY.near) * 0.7) || z < 14);
    plantTrees(kit, slopes, { pineShare: 0.4 });
    return null;
  },
};

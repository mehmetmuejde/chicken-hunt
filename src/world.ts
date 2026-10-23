import {
  Color3,
  Color4,
  DirectionalLight,
  HemisphericLight,
  Matrix,
  Mesh,
  MeshBuilder,
  ParticleSystem,
  Scene,
  StandardMaterial,
  type Texture,
  TransformNode,
  Vector3,
  VertexBuffer,
} from "./babylon";
import { createRng, randomRange } from "./random";

const HORIZON = new Color3(0.8, 0.88, 0.93);
const ZENITH = new Color3(0.24, 0.5, 0.86);
const SKY_RADIUS = 700;
const TERRAIN_CENTER_Z = 250;
const CLOUD_WRAP_X = 520;

// After the atomic bomb: dark, burnt and with a sickly green glow on the horizon.
const FALLOUT_HORIZON = new Color3(0.16, 0.19, 0.08);
const FALLOUT_ZENITH = new Color3(0.02, 0.02, 0.03);
const CHARRED = new Color3(0.035, 0.03, 0.028);

interface DriftingCloud {
  mesh: Mesh;
  speed: number;
}

interface MaterialState {
  material: StandardMaterial;
  diffuse: Color3;
  emissive: Color3;
}

interface VertexColors {
  mesh: Mesh;
  normal: number[];
  devastated: number[];
}

/** Scene parts that change when the world is devastated. */
export interface World {
  windmillRotor: TransformNode;
  clouds: DriftingCloud[];
  devastated: boolean;
  materials: MaterialState[];
  cloudMaterial: StandardMaterial;
  vertexColors: VertexColors[];
  /** Destroyed outright (tree crowns, roof, hay, windmill blades). */
  burnsAway: TransformNode[];
  barn: TransformNode;
  sky: HemisphericLight;
  sun: DirectionalLight;
  ash: ParticleSystem;
}

/** Height of the landscape at a world position. Flat near the camera, hills further out, mountains at the back. */
export function terrainHeight(x: number, z: number): number {
  const ramp = Math.min(1, Math.max(0, z - 15) / 120);
  const hills =
    Math.sin(x * 0.035) * Math.cos(z * 0.03) * 5 +
    Math.sin(x * 0.013 + z * 0.01 + 1.3) * 7 +
    Math.cos(x * 0.07 + z * 0.05) * 1.5;
  let height = (hills + 6) * ramp;
  if (z > 260) {
    height += (z - 260) * 0.38 * (0.6 + 0.4 * Math.sin(x * 0.02 + 2));
  }
  return height + Math.sin(x * 0.2) * Math.cos(z * 0.25) * 0.3;
}

export function createWorld(scene: Scene, particleTexture: Texture): World {
  const rng = createRng(7);
  const lights = createLights(scene);
  const materials: MaterialState[] = [];
  const burnsAway: TransformNode[] = [];
  const material = (name: string, color: Color3): StandardMaterial => {
    const created = solidMaterial(scene, name, color);
    materials.push({ material: created, diffuse: color.clone(), emissive: created.emissiveColor.clone() });
    return created;
  };

  const sky = createSky(scene);
  const terrain = createTerrain(scene);
  createTrees(scene, rng, material, burnsAway);
  const barn = createBarn(scene, material, burnsAway);
  const windmillRotor = createWindmill(scene, material, burnsAway);
  createFence(scene, material);
  createHayBales(scene, material, burnsAway);
  const { clouds, cloudMaterial } = createClouds(scene, rng);

  const world: World = {
    windmillRotor,
    clouds,
    devastated: false,
    materials,
    cloudMaterial,
    vertexColors: [sky, terrain],
    burnsAway,
    barn,
    sky: lights.sky,
    sun: lights.sun,
    ash: createAsh(scene, particleTexture),
  };
  setDevastated(world, scene, false);
  return world;
}

export function updateWorld(world: World, dt: number): void {
  if (!world.devastated) world.windmillRotor.rotation.z += dt * 0.6;
  for (const cloud of world.clouds) {
    cloud.mesh.position.x += cloud.speed * dt * (world.devastated ? 0.3 : 1);
    if (cloud.mesh.position.x > CLOUD_WRAP_X) cloud.mesh.position.x = -CLOUD_WRAP_X;
  }
}

/** Switches between the intact countryside and the burnt, irradiated wasteland after the atomic bomb. */
export function setDevastated(world: World, scene: Scene, devastated: boolean): void {
  world.devastated = devastated;
  const horizon = devastated ? FALLOUT_HORIZON : HORIZON;
  scene.clearColor = new Color4(horizon.r, horizon.g, horizon.b, 1);
  scene.fogMode = Scene.FOGMODE_EXP2;
  scene.fogDensity = devastated ? 0.006 : 0.0025;
  scene.fogColor = horizon.clone();

  world.sky.intensity = devastated ? 0.35 : 0.75;
  world.sky.groundColor = devastated ? new Color3(0.2, 0.1, 0.05) : new Color3(0.35, 0.4, 0.3);
  world.sun.intensity = devastated ? 0.35 : 0.9;
  world.sun.diffuse = devastated ? new Color3(0.9, 0.45, 0.25) : new Color3(1, 0.95, 0.85);

  for (const state of world.materials) {
    state.material.diffuseColor = devastated ? Color3.Lerp(state.diffuse, CHARRED, 0.9) : state.diffuse.clone();
    state.material.emissiveColor = devastated ? Color3.Black() : state.emissive.clone();
  }
  world.cloudMaterial.diffuseColor = devastated ? new Color3(0.12, 0.11, 0.1) : Color3.White();
  world.cloudMaterial.emissiveColor = devastated ? new Color3(0.06, 0.07, 0.03) : new Color3(0.72, 0.74, 0.78);

  for (const colors of world.vertexColors) {
    colors.mesh.setVerticesData(VertexBuffer.ColorKind, devastated ? colors.devastated : colors.normal);
  }
  for (const node of world.burnsAway) node.setEnabled(!devastated);

  // The barn is left as a sagging, blackened ruin.
  world.barn.rotation.z = devastated ? 0.22 : 0;
  world.barn.scaling.y = devastated ? 0.55 : 1;

  if (devastated) {
    world.ash.start();
  } else {
    world.ash.stop();
    world.ash.reset();
  }
}

function solidMaterial(scene: Scene, name: string, color: Color3): StandardMaterial {
  const material = new StandardMaterial(name, scene);
  material.diffuseColor = color.clone();
  material.specularColor = Color3.Black();
  return material;
}

type MaterialFactory = (name: string, color: Color3) => StandardMaterial;

function createLights(scene: Scene): { sky: HemisphericLight; sun: DirectionalLight } {
  const sky = new HemisphericLight("skyLight", new Vector3(0, 1, 0), scene);
  sky.diffuse = new Color3(1, 0.98, 0.94);
  const sun = new DirectionalLight("sun", new Vector3(-0.4, -1, 0.5), scene);
  return { sky, sun };
}

function createSky(scene: Scene): VertexColors {
  const sky = MeshBuilder.CreateSphere(
    "sky",
    { diameter: SKY_RADIUS * 2, segments: 32, sideOrientation: Mesh.BACKSIDE },
    scene,
  );
  const positions = sky.getVerticesData(VertexBuffer.PositionKind) ?? [];
  const normal: number[] = [];
  const devastated: number[] = [];
  for (let i = 0; i < positions.length; i += 3) {
    const t = Math.pow(Math.min(1, Math.max(0, positions[i + 1] / SKY_RADIUS / 0.6)), 0.7);
    const day = Color3.Lerp(HORIZON, ZENITH, t);
    const fallout = Color3.Lerp(FALLOUT_HORIZON, FALLOUT_ZENITH, Math.pow(t, 0.5));
    normal.push(day.r, day.g, day.b, 1);
    devastated.push(fallout.r, fallout.g, fallout.b, 1);
  }

  const material = new StandardMaterial("skyMaterial", scene);
  material.disableLighting = true;
  material.emissiveColor = Color3.White();
  material.backFaceCulling = false;
  sky.material = material;
  sky.applyFog = false;
  sky.infiniteDistance = true;
  sky.isPickable = false;
  return { mesh: sky, normal, devastated };
}

function terrainColor(x: number, y: number, z: number): Color3 {
  const grass = new Color3(0.38, 0.63, 0.25);
  const darkGrass = new Color3(0.24, 0.47, 0.18);
  const wheat = new Color3(0.8, 0.7, 0.34);
  const rock = new Color3(0.5, 0.52, 0.56);
  const snow = new Color3(0.95, 0.96, 1);

  let color = Color3.Lerp(grass, darkGrass, 0.5 + 0.5 * Math.sin(x * 0.09) * Math.cos(z * 0.07));
  if (z > 40 && z < 220 && Math.sin(x * 0.05 + z * 0.012) > 0.75) {
    color = Color3.Lerp(color, wheat, 0.85);
  }
  if (y > 30) color = Color3.Lerp(color, rock, Math.min(1, (y - 30) / 20));
  if (y > 75) color = Color3.Lerp(color, snow, Math.min(1, (y - 75) / 10));
  return color;
}

function burntTerrainColor(x: number, y: number, z: number): Color3 {
  const soot = new Color3(0.04, 0.035, 0.03);
  const ash = new Color3(0.16, 0.15, 0.14);
  const ember = new Color3(0.5, 0.14, 0.03);
  const glow = new Color3(0.18, 0.28, 0.06);
  let color = Color3.Lerp(soot, ash, 0.5 + 0.5 * Math.sin(x * 0.11 + 1) * Math.cos(z * 0.09));
  const speck = Math.sin(x * 1.7) * Math.cos(z * 1.3) * Math.sin(x * 0.3 + z * 0.4);
  if (speck > 0.82) color = Color3.Lerp(color, ember, 0.7);
  if (speck < -0.85) color = Color3.Lerp(color, glow, 0.6);
  if (y > 60) color = Color3.Lerp(color, ash, Math.min(1, (y - 60) / 30));
  return color;
}

function createTerrain(scene: Scene): VertexColors {
  const terrain = MeshBuilder.CreateGround(
    "terrain",
    { width: 900, height: 620, subdivisions: 180, updatable: true },
    scene,
  );
  terrain.position.z = TERRAIN_CENTER_Z;
  terrain.updateMeshPositions((positions) => {
    for (let i = 0; i < positions.length; i += 3) {
      positions[i + 1] = terrainHeight(positions[i], positions[i + 2] + TERRAIN_CENTER_Z);
    }
  }, true);

  const positions = terrain.getVerticesData(VertexBuffer.PositionKind) ?? [];
  const normal: number[] = [];
  const devastated: number[] = [];
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i];
    const y = positions[i + 1];
    const z = positions[i + 2] + TERRAIN_CENTER_Z;
    const day = terrainColor(x, y, z);
    const burnt = burntTerrainColor(x, y, z);
    normal.push(day.r, day.g, day.b, 1);
    devastated.push(burnt.r, burnt.g, burnt.b, 1);
  }
  terrain.setVerticesData(VertexBuffer.ColorKind, normal, true);
  // The terrain keeps a white base colour: it is tinted through vertex colours, not the material.
  terrain.material = solidMaterial(scene, "terrainMaterial", Color3.White());
  terrain.isPickable = false;
  return { mesh: terrain, normal, devastated };
}

/** Creates a low-poly mesh whose origin sits at its base, so instances can be placed directly on the terrain. */
function baseAnchored(mesh: Mesh, offsetY: number, material: StandardMaterial): Mesh {
  mesh.bakeTransformIntoVertices(Matrix.Translation(0, offsetY, 0));
  mesh.convertToFlatShadedMesh();
  mesh.material = material;
  mesh.isPickable = false;
  return mesh;
}

function createTrees(scene: Scene, rng: () => number, material: MaterialFactory, burnsAway: TransformNode[]): void {
  const trunk = baseAnchored(
    MeshBuilder.CreateCylinder("trunk", { height: 2, diameterTop: 0.35, diameterBottom: 0.5, tessellation: 6 }, scene),
    1,
    material("trunk", new Color3(0.36, 0.24, 0.14)),
  );
  const pine = baseAnchored(
    MeshBuilder.CreateCylinder("pine", { height: 5, diameterTop: 0, diameterBottom: 2.6, tessellation: 7 }, scene),
    4.2,
    material("pineMaterial", new Color3(0.13, 0.33, 0.17)),
  );
  const leaves = baseAnchored(
    MeshBuilder.CreateSphere("leaves", { diameter: 3.4, segments: 3 }, scene),
    3.6,
    material("leavesMaterial", new Color3(0.27, 0.5, 0.2)),
  );

  const place = (source: Mesh, isFirst: boolean, position: Vector3, scale: number, rotationY: number): TransformNode => {
    const node = isFirst ? source : source.createInstance(`${source.name}Instance`);
    node.position.copyFrom(position);
    node.scaling.setAll(scale);
    node.rotation.y = rotationY;
    node.isPickable = false;
    return node;
  };

  let pinePlaced = false;
  let leavesPlaced = false;
  for (let i = 0; i < 260; i++) {
    const z = randomRange(25, 290, rng);
    const x = randomRange(-z * 1.4 - 20, z * 1.4 + 20, rng);
    if (Math.abs(x + 30) < 12 && Math.abs(z - 70) < 12) continue; // keep the barn free
    if (Math.abs(x - 45) < 8 && Math.abs(z - 120) < 8) continue; // keep the windmill free

    const position = new Vector3(x, terrainHeight(x, z) - 0.2, z);
    const scale = randomRange(0.8, 1.7, rng);
    const rotationY = randomRange(0, Math.PI * 2, rng);
    place(trunk, i === 0, position, scale, rotationY);
    if (rng() < 0.55) {
      burnsAway.push(place(pine, !pinePlaced, position, scale, rotationY));
      pinePlaced = true;
    } else {
      burnsAway.push(place(leaves, !leavesPlaced, position, scale, rotationY));
      leavesPlaced = true;
    }
  }
}

function createBarn(scene: Scene, material: MaterialFactory, burnsAway: TransformNode[]): TransformNode {
  const barn = new TransformNode("barn", scene);
  barn.position.set(-30, terrainHeight(-30, 70) - 0.3, 70);
  barn.rotation.y = 0.4;

  const body = MeshBuilder.CreateBox("barnBody", { width: 8, height: 5, depth: 10 }, scene);
  body.material = material("barnRed", new Color3(0.62, 0.16, 0.12));
  body.position.y = 2.5;

  // A box turned by 45° whose lower half disappears inside the walls forms the gable roof.
  const roof = MeshBuilder.CreateBox("barnRoof", { width: 6, height: 6, depth: 10 }, scene);
  roof.material = material("barnRoofMaterial", new Color3(0.3, 0.22, 0.2));
  roof.rotation.z = Math.PI / 4;
  roof.position.y = 5;
  burnsAway.push(roof);

  const door = MeshBuilder.CreateBox("barnDoor", { width: 3.2, height: 3.6, depth: 0.2 }, scene);
  door.material = material("barnDoorMaterial", new Color3(0.92, 0.9, 0.84));
  door.position.set(0, 1.8, -5.05);

  for (const mesh of [body, roof, door]) {
    mesh.parent = barn;
    mesh.isPickable = false;
  }
  return barn;
}

function createWindmill(scene: Scene, material: MaterialFactory, burnsAway: TransformNode[]): TransformNode {
  const windmill = new TransformNode("windmill", scene);
  windmill.position.set(45, terrainHeight(45, 120) - 0.5, 120);
  windmill.rotation.y = -0.2;

  const tower = MeshBuilder.CreateCylinder(
    "windmillTower",
    { height: 14, diameterTop: 3, diameterBottom: 5.5, tessellation: 8 },
    scene,
  );
  tower.material = material("windmillTowerMaterial", new Color3(0.9, 0.86, 0.76));
  tower.position.y = 7;

  const cap = MeshBuilder.CreateCylinder("windmillCap", { height: 2.6, diameterTop: 0, diameterBottom: 4, tessellation: 8 }, scene);
  cap.material = material("windmillCapMaterial", new Color3(0.35, 0.2, 0.15));
  cap.position.y = 15.3;
  burnsAway.push(cap);

  const rotor = new TransformNode("windmillRotor", scene);
  rotor.parent = windmill;
  rotor.position.set(0, 14.2, -2.2);
  burnsAway.push(rotor);

  const bladeMaterial = material("windmillBladeMaterial", new Color3(0.55, 0.38, 0.24));
  const hub = MeshBuilder.CreateSphere("windmillHub", { diameter: 0.9, segments: 8 }, scene);
  hub.material = bladeMaterial;
  hub.parent = rotor;
  hub.isPickable = false;
  for (let i = 0; i < 4; i++) {
    const arm = new TransformNode(`windmillArm${i}`, scene);
    arm.parent = rotor;
    arm.rotation.z = (i * Math.PI) / 2;
    const blade = MeshBuilder.CreateBox(`windmillBlade${i}`, { width: 1.5, height: 8, depth: 0.15 }, scene);
    blade.material = bladeMaterial;
    blade.parent = arm;
    blade.position.set(0.5, 4.6, 0);
    blade.isPickable = false;
  }

  for (const mesh of [tower, cap]) {
    mesh.parent = windmill;
    mesh.isPickable = false;
  }
  return rotor;
}

function createFence(scene: Scene, material: MaterialFactory): void {
  const wood = material("fenceWood", new Color3(0.45, 0.31, 0.18));
  const z = 10;
  const post = MeshBuilder.CreateBox("fencePost", { width: 0.25, height: 1.4, depth: 0.25 }, scene);
  post.material = wood;
  post.isPickable = false;
  post.position.set(-100, 0.7, z);
  for (let x = -97; x <= 100; x += 3) {
    const instance = post.createInstance("fencePostInstance");
    instance.position.set(x, 0.7 + Math.sin(x) * 0.05, z);
    instance.rotation.z = Math.sin(x * 1.7) * 0.04;
    instance.isPickable = false;
  }
  for (const y of [0.5, 1.05]) {
    const rail = MeshBuilder.CreateBox("fenceRail", { width: 200, height: 0.14, depth: 0.08 }, scene);
    rail.material = wood;
    rail.position.set(0, y, z - 0.16);
    rail.isPickable = false;
  }
}

function createHayBales(scene: Scene, material: MaterialFactory, burnsAway: TransformNode[]): void {
  const hay = material("hay", new Color3(0.86, 0.73, 0.36));
  const spots = [
    new Vector3(-7, 0.9, 14),
    new Vector3(8, 0.9, 16),
    new Vector3(10.2, 0.9, 17.5),
    new Vector3(9.1, 2.4, 16.8),
  ];
  spots.forEach((spot, index) => {
    const bale = MeshBuilder.CreateCylinder(`hayBale${index}`, { diameter: 1.8, height: 1.4, tessellation: 16 }, scene);
    bale.material = hay;
    bale.rotation.z = Math.PI / 2;
    bale.rotation.y = index * 0.7;
    bale.position.copyFrom(spot);
    bale.isPickable = false;
    burnsAway.push(bale);
  });
}

function createClouds(scene: Scene, rng: () => number): { clouds: DriftingCloud[]; cloudMaterial: StandardMaterial } {
  const cloudMaterial = new StandardMaterial("cloudMaterial", scene);
  cloudMaterial.specularColor = Color3.Black();

  const clouds: DriftingCloud[] = [];
  for (let i = 0; i < 14; i++) {
    const puffs: Mesh[] = [];
    const puffCount = 4 + Math.floor(rng() * 3);
    for (let p = 0; p < puffCount; p++) {
      const puff = MeshBuilder.CreateSphere("cloudPuff", { diameter: randomRange(14, 26, rng), segments: 8 }, scene);
      puff.position.set(p * 9 - puffCount * 4.5, randomRange(-2, 4, rng), randomRange(-5, 5, rng));
      puff.scaling.y = 0.55;
      puffs.push(puff);
    }
    const cloud = Mesh.MergeMeshes(puffs, true);
    if (!cloud) continue;
    cloud.material = cloudMaterial;
    cloud.applyFog = false;
    cloud.isPickable = false;
    cloud.position.set(randomRange(-CLOUD_WRAP_X, CLOUD_WRAP_X, rng), randomRange(90, 150, rng), randomRange(320, 520, rng));
    clouds.push({ mesh: cloud, speed: randomRange(1.5, 4, rng) });
  }
  return { clouds, cloudMaterial };
}

/** Grey flakes drifting down in front of the camera after the bomb. */
function createAsh(scene: Scene, texture: Texture): ParticleSystem {
  const ash = new ParticleSystem("ash", 900, scene);
  ash.particleTexture = texture;
  ash.emitter = new Vector3(0, 30, 60);
  ash.minEmitBox = new Vector3(-90, 0, -50);
  ash.maxEmitBox = new Vector3(90, 10, 60);
  ash.color1 = new Color4(0.35, 0.33, 0.3, 0.9);
  ash.color2 = new Color4(0.2, 0.22, 0.12, 0.8);
  ash.colorDead = new Color4(0.1, 0.1, 0.1, 0);
  ash.minSize = 0.15;
  ash.maxSize = 0.45;
  ash.minLifeTime = 6;
  ash.maxLifeTime = 10;
  ash.emitRate = 90;
  ash.direction1 = new Vector3(-0.6, -1, -0.3);
  ash.direction2 = new Vector3(0.6, -1, 0.3);
  ash.minEmitPower = 2;
  ash.maxEmitPower = 4;
  ash.minAngularSpeed = -2;
  ash.maxAngularSpeed = 2;
  ash.gravity = new Vector3(0, -0.5, 0);
  ash.preWarmCycles = 120;
  ash.blendMode = ParticleSystem.BLENDMODE_STANDARD;
  return ash;
}

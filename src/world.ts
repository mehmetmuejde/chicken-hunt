import {
  Color3,
  Color4,
  DirectionalLight,
  HemisphericLight,
  Mesh,
  MeshBuilder,
  ParticleSystem,
  type Scene,
  StandardMaterial,
  type Texture,
  TransformNode,
  Vector3,
  VertexBuffer,
} from "./babylon";
import { createRng, randomRange } from "./random";
import { type Collapse, type FarmParts, SCENERIES, type SceneryId } from "./scenery";
import { solidMaterial } from "./scenery/kit";

const SKY_RADIUS = 700;
const TERRAIN_CENTER_Z = 250;
const CLOUD_WRAP_X = 520;
const CHARRED = new Color3(0.035, 0.03, 0.028);
const SNOW_WHITE = new Color3(0.92, 0.94, 0.98);
const WINDMILL_SPEED = 0.6;
const WINDMILL_BOOST_SPEED = 9;

interface DriftingCloud {
  mesh: Mesh;
  speed: number;
}

interface MaterialState {
  material: StandardMaterial;
  diffuse: Color3;
  emissive: Color3;
}

/** Terrain colour variants, swapped by the atmosphere (snow) and the atomic bomb (burnt). */
export interface TerrainColors {
  mesh: Mesh;
  normal: number[];
  devastated: number[];
  snow: number[];
}

export interface SkyDome {
  mesh: Mesh;
  /** 0 at the horizon … 1 at the zenith, one value per vertex — the atmosphere colours the gradient. */
  heights: number[];
}

/** Collapsing structure with the pose it had before the blast. */
interface CollapseState extends Collapse {
  restTilt: number;
  restScale: number;
}

/** Shared sky, light and clouds plus the currently built scenery. */
export interface World {
  scenery: SceneryId;
  /** Parent of everything the scenery built; disposed when the scenery changes. */
  sceneryRoot: TransformNode;
  clouds: DriftingCloud[];
  devastated: boolean;
  materials: MaterialState[];
  cloudMaterial: StandardMaterial;
  skyDome: SkyDome;
  terrain: TerrainColors;
  /** Destroyed outright (tree crowns, roofs, hay, windmill blades). */
  burnsAway: TransformNode[];
  collapses: CollapseState[];
  /** Barn and windmill — only the farm has them. */
  farm: FarmParts | null;
  /** Seconds the windmill keeps spinning fast after its easter egg was shot. */
  windmillBoost: number;
  sky: HemisphericLight;
  sun: DirectionalLight;
  ash: ParticleSystem;
}

let activeHeight: (x: number, z: number) => number = SCENERIES.farm.height;

/** Height of the landscape of the current scenery at a world position. */
export function terrainHeight(x: number, z: number): number {
  return activeHeight(x, z);
}

export function createWorld(scene: Scene, particleTexture: Texture, scenery: SceneryId): World {
  const lights = createLights(scene);
  const { clouds, cloudMaterial } = createClouds(scene, createRng(7));
  const world: World = {
    scenery,
    sceneryRoot: new TransformNode("scenery", scene),
    clouds,
    devastated: false,
    materials: [],
    cloudMaterial,
    skyDome: createSky(scene),
    terrain: { mesh: new Mesh("terrainPlaceholder", scene), normal: [], devastated: [], snow: [] },
    burnsAway: [],
    collapses: [],
    farm: null,
    windmillBoost: 0,
    sky: lights.sky,
    sun: lights.sun,
    ash: createAsh(scene, particleTexture),
  };
  buildScenery(scene, world, scenery);
  return world;
}

/** Tears down the current scenery and builds `scenery` in its place. */
export function setScenery(world: World, scenery: SceneryId): void {
  if (world.scenery === scenery) return;
  const scene = world.sceneryRoot.getScene();
  world.sceneryRoot.dispose(false, true);
  world.sceneryRoot = new TransformNode("scenery", scene);
  world.scenery = scenery;
  buildScenery(scene, world, scenery);
}

function buildScenery(scene: Scene, world: World, id: SceneryId): void {
  const definition = SCENERIES[id];
  activeHeight = definition.height;
  const materials: MaterialState[] = [];
  const burnsAway: TransformNode[] = [];
  const collapses: Collapse[] = [];
  const farm = definition.build({
    scene,
    root: world.sceneryRoot,
    rng: createRng(11),
    material: (name, color) => {
      const created = solidMaterial(scene, name, color);
      materials.push({ material: created, diffuse: color.clone(), emissive: created.emissiveColor.clone() });
      return created;
    },
    burnsAway,
    collapses,
    height: definition.height,
  });
  // Materials can be tuned after creation (textures, glow): remember their final state.
  for (const state of materials) {
    state.diffuse = state.material.diffuseColor.clone();
    state.emissive = state.material.emissiveColor.clone();
  }
  world.terrain.mesh.dispose(false, true);
  world.terrain = createTerrain(scene, definition.height, definition.color);
  world.materials = materials;
  world.burnsAway = burnsAway;
  world.collapses = collapses.map((collapse) => ({ ...collapse, restTilt: collapse.node.rotation.z, restScale: collapse.node.scaling.y }));
  world.farm = farm;
  setDevastated(world, false);
}

export function updateWorld(world: World, dt: number): void {
  world.windmillBoost = Math.max(0, world.windmillBoost - dt);
  const speed = world.windmillBoost > 0 ? WINDMILL_BOOST_SPEED * Math.min(1, world.windmillBoost) : WINDMILL_SPEED;
  if (world.farm && !world.devastated) world.farm.windmillRotor.rotation.z += dt * Math.max(WINDMILL_SPEED, speed);
  for (const cloud of world.clouds) {
    cloud.mesh.position.x += cloud.speed * dt * (world.devastated ? 0.3 : 1);
    if (cloud.mesh.position.x > CLOUD_WRAP_X) cloud.mesh.position.x = -CLOUD_WRAP_X;
  }
}

/**
 * Switches the structures between the intact countryside and the burnt wasteland after the atomic bomb.
 * Sky, light, fog and terrain colours are handled by the atmosphere.
 */
export function setDevastated(world: World, devastated: boolean): void {
  world.devastated = devastated;
  for (const state of world.materials) {
    state.material.diffuseColor = devastated ? Color3.Lerp(state.diffuse, CHARRED, 0.9) : state.diffuse.clone();
    state.material.emissiveColor = devastated ? Color3.Black() : state.emissive.clone();
    // Textured facades go dark too: their windows no longer glow.
    if (state.material.emissiveTexture) state.material.emissiveTexture.level = devastated ? 0 : 1;
    if (state.material.diffuseTexture) state.material.diffuseTexture.level = devastated ? 0.12 : 1;
  }
  for (const node of world.burnsAway) node.setEnabled(!devastated);
  for (const collapse of world.collapses) {
    collapse.node.rotation.z = collapse.restTilt + (devastated ? collapse.tilt : 0);
    collapse.node.scaling.y = collapse.restScale * (devastated ? collapse.squash : 1);
  }
  if (world.farm) world.farm.barnDoor.hinge.rotation.y = 0;
  world.windmillBoost = 0;

  if (devastated) {
    world.ash.start();
  } else {
    world.ash.stop();
    world.ash.reset();
  }
}

function createLights(scene: Scene): { sky: HemisphericLight; sun: DirectionalLight } {
  const sky = new HemisphericLight("skyLight", new Vector3(0, 1, 0), scene);
  sky.diffuse = new Color3(1, 0.98, 0.94);
  const sun = new DirectionalLight("sun", new Vector3(-0.4, -1, 0.5), scene);
  return { sky, sun };
}

function createSky(scene: Scene): SkyDome {
  const sky = MeshBuilder.CreateSphere(
    "sky",
    { diameter: SKY_RADIUS * 2, segments: 32, sideOrientation: Mesh.BACKSIDE },
    scene,
  );
  const positions = sky.getVerticesData(VertexBuffer.PositionKind) ?? [];
  const heights: number[] = [];
  for (let i = 0; i < positions.length; i += 3) {
    heights.push(Math.min(1, Math.max(0, positions[i + 1] / SKY_RADIUS / 0.6)));
  }

  const material = new StandardMaterial("skyMaterial", scene);
  material.disableLighting = true;
  material.emissiveColor = Color3.White();
  material.backFaceCulling = false;
  sky.material = material;
  sky.applyFog = false;
  sky.infiniteDistance = true;
  sky.isPickable = false;
  return { mesh: sky, heights };
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

function createTerrain(
  scene: Scene,
  height: (x: number, z: number) => number,
  color: (x: number, y: number, z: number) => Color3,
): TerrainColors {
  const terrain = MeshBuilder.CreateGround("terrain", { width: 900, height: 620, subdivisions: 180, updatable: true }, scene);
  terrain.position.z = TERRAIN_CENTER_Z;
  terrain.updateMeshPositions((positions) => {
    for (let i = 0; i < positions.length; i += 3) {
      positions[i + 1] = height(positions[i], positions[i + 2] + TERRAIN_CENTER_Z);
    }
  }, true);

  const positions = terrain.getVerticesData(VertexBuffer.PositionKind) ?? [];
  const normal: number[] = [];
  const devastated: number[] = [];
  const snow: number[] = [];
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i];
    const y = positions[i + 1];
    const z = positions[i + 2] + TERRAIN_CENTER_Z;
    const day = color(x, y, z);
    const burnt = burntTerrainColor(x, y, z);
    const snowy = Color3.Lerp(day, SNOW_WHITE, 0.78 + 0.12 * Math.sin(x * 0.3) * Math.cos(z * 0.2));
    normal.push(day.r, day.g, day.b, 1);
    devastated.push(burnt.r, burnt.g, burnt.b, 1);
    snow.push(snowy.r, snowy.g, snowy.b, 1);
  }
  terrain.setVerticesData(VertexBuffer.ColorKind, normal, true);
  // The terrain keeps a white base colour: it is tinted through vertex colours, not the material.
  terrain.material = solidMaterial(scene, "terrainMaterial", Color3.White());
  terrain.isPickable = false;
  return { mesh: terrain, normal, devastated, snow };
}

function createClouds(scene: Scene, rng: () => number): { clouds: DriftingCloud[]; cloudMaterial: StandardMaterial } {
  const cloudMaterial = new StandardMaterial("cloudMaterial", scene);
  cloudMaterial.specularColor = Color3.Black();
  cloudMaterial.diffuseColor = Color3.White();

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

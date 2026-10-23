import { Color3, Mesh, MeshBuilder, Scene, StandardMaterial, TransformNode, Vector3 } from "./babylon";
import { CAMERA_HEIGHT, CHICKEN_DEPTH, CHICKEN_SCALE, GRAVITY, pointsForDepth } from "./config";
import { randomRange } from "./random";
import { terrainHeight } from "./world";

/** Spawn and exit distance relative to depth — wide enough that chickens never pop in while the camera is panned. */
const SPAWN_EDGE_FACTOR = 2.6;
/** Turns the chicken slightly towards the camera so the face is visible while it crosses the screen. */
const FACE_CAMERA_ANGLE = 0.35;

interface SpeedClass {
  /** Seconds to cross from one spawn edge to the other. */
  crossing: { min: number; max: number };
  points: number;
  flap: number;
  weight: number;
}

const SPEED_CLASSES: readonly SpeedClass[] = [
  { crossing: { min: 14, max: 20 }, points: 1, flap: 0.7, weight: 0.2 },
  { crossing: { min: 7, max: 13 }, points: 1, flap: 1, weight: 0.55 },
  { crossing: { min: 3.5, max: 5.5 }, points: 2, flap: 1.5, weight: 0.25 },
];

type PartKey = "feathers" | "wing" | "tail" | "comb" | "beak" | "eyeWhite" | "pupil";
export type ChickenMaterials = Record<PartKey, StandardMaterial>;
export type ChickenLook = "normal" | "roasted" | "charred" | "irradiated";
export type ChickenPalette = Record<ChickenLook, ChickenMaterials>;

/** shot: bullets/pellets · burn: laser · blast: flak burst or atomic bomb. */
export type HitKind = "shot" | "burn" | "blast";

export interface ChickenSpawn {
  depth: number;
  direction: 1 | -1;
  startX: number;
  exitX: number;
  altitude: number;
  speed: number;
  pointsMultiplier: number;
  flapMultiplier: number;
}

export type ChickenState = "flying" | "falling" | "gone";

function chickenMaterial(scene: Scene, name: string, color: Color3, glow = 0): StandardMaterial {
  const material = new StandardMaterial(name, scene);
  material.diffuseColor = color;
  material.specularColor = new Color3(0.08, 0.08, 0.08);
  material.emissiveColor = color.scale(glow);
  return material;
}

function materialSet(scene: Scene, look: ChickenLook, colors: Record<PartKey, Color3>, glow = 0): ChickenMaterials {
  const entries = Object.entries(colors).map(([key, color]) => [key, chickenMaterial(scene, `chicken-${look}-${key}`, color, glow)]);
  return Object.fromEntries(entries) as ChickenMaterials;
}

export function createChickenPalette(scene: Scene): ChickenPalette {
  const roasted = materialSet(scene, "roasted", {
    feathers: new Color3(0.6, 0.32, 0.1),
    wing: new Color3(0.5, 0.25, 0.08),
    tail: new Color3(0.25, 0.12, 0.05),
    comb: new Color3(0.3, 0.1, 0.05),
    beak: new Color3(0.4, 0.25, 0.1),
    eyeWhite: new Color3(0.5, 0.4, 0.3),
    pupil: new Color3(0.05, 0.03, 0.02),
  });
  for (const material of Object.values(roasted)) {
    material.specularColor = new Color3(0.5, 0.35, 0.2);
    material.specularPower = 24;
  }
  return {
    normal: materialSet(scene, "normal", {
      feathers: new Color3(0.62, 0.34, 0.16),
      wing: new Color3(0.45, 0.24, 0.12),
      tail: new Color3(0.16, 0.11, 0.1),
      comb: new Color3(0.88, 0.1, 0.08),
      beak: new Color3(0.98, 0.72, 0.15),
      eyeWhite: new Color3(1, 1, 1),
      pupil: new Color3(0.02, 0.02, 0.02),
    }),
    roasted,
    charred: materialSet(scene, "charred", {
      feathers: new Color3(0.05, 0.045, 0.04),
      wing: new Color3(0.04, 0.035, 0.03),
      tail: new Color3(0.02, 0.02, 0.02),
      comb: new Color3(0.15, 0.04, 0.02),
      beak: new Color3(0.1, 0.08, 0.05),
      eyeWhite: new Color3(0.3, 0.3, 0.3),
      pupil: new Color3(0.01, 0.01, 0.01),
    }),
    irradiated: materialSet(
      scene,
      "irradiated",
      {
        feathers: new Color3(0.35, 0.85, 0.2),
        wing: new Color3(0.25, 0.7, 0.15),
        tail: new Color3(0.1, 0.35, 0.08),
        comb: new Color3(0.9, 1, 0.2),
        beak: new Color3(0.8, 0.95, 0.3),
        eyeWhite: new Color3(1, 0.2, 0.1),
        pupil: new Color3(1, 1, 0.6),
      },
      0.7,
    ),
  };
}

function pickSpeedClass(): SpeedClass {
  let roll = Math.random();
  for (const speedClass of SPEED_CLASSES) {
    roll -= speedClass.weight;
    if (roll <= 0) return speedClass;
  }
  return SPEED_CLASSES[1];
}

export function createRandomSpawn(): ChickenSpawn {
  const depth = CHICKEN_DEPTH.min + (CHICKEN_DEPTH.max - CHICKEN_DEPTH.min) * Math.pow(Math.random(), 1.3);
  const direction = Math.random() < 0.5 ? 1 : -1;
  const edge = depth * SPAWN_EDGE_FACTOR + 10;
  const speedClass = pickSpeedClass();

  let highestGround = 0;
  for (let x = -edge; x <= edge; x += edge / 15) {
    highestGround = Math.max(highestGround, terrainHeight(x, depth));
  }
  const minAltitude = Math.max(highestGround + 3, CAMERA_HEIGHT + 1);
  const maxAltitude = CAMERA_HEIGHT + depth * 0.32;
  const altitude = minAltitude >= maxAltitude ? minAltitude : randomRange(minAltitude, maxAltitude);

  return {
    depth,
    direction,
    startX: -direction * edge,
    exitX: edge,
    altitude,
    speed: (2 * edge) / randomRange(speedClass.crossing.min, speedClass.crossing.max),
    pointsMultiplier: speedClass.points,
    flapMultiplier: speedClass.flap,
  };
}

export class Chicken {
  readonly root: TransformNode;
  readonly hitbox: Mesh;
  readonly points: number;

  private currentState: ChickenState = "flying";
  private readonly parts: { mesh: Mesh; key: PartKey }[] = [];
  private readonly wings: TransformNode[] = [];
  private readonly velocity = Vector3.Zero();
  private readonly spin = new Vector3(randomRange(-6, 6), 0, randomRange(4, 9));
  private readonly bobAmplitude = randomRange(0.4, 1.6);
  private readonly bobFrequency = randomRange(1.2, 2.4);
  private readonly flapFrequency: number;
  private time = randomRange(0, 10);
  private fallTime = 0;

  constructor(
    scene: Scene,
    private readonly palette: ChickenPalette,
    private readonly spawn: ChickenSpawn,
    readonly irradiated: boolean,
  ) {
    this.points = pointsForDepth(spawn.depth) * spawn.pointsMultiplier;
    this.flapFrequency = randomRange(14, 20) * spawn.flapMultiplier;
    this.root = new TransformNode("chicken", scene);
    this.root.position.set(spawn.startX, spawn.altitude, spawn.depth);
    this.root.scaling.setAll(CHICKEN_SCALE);
    this.root.rotation.y = spawn.direction > 0 ? FACE_CAMERA_ANGLE : Math.PI - FACE_CAMERA_ANGLE;

    this.buildBody(scene);
    this.applyLook(irradiated ? "irradiated" : "normal");

    this.hitbox = MeshBuilder.CreateSphere("chickenHitbox", { diameter: 2.6, segments: 4 }, scene);
    this.hitbox.parent = this.root;
    this.hitbox.isVisible = false;
  }

  get state(): ChickenState {
    return this.currentState;
  }

  get position(): Vector3 {
    return this.root.position;
  }

  get isFast(): boolean {
    return this.spawn.pointsMultiplier > 1;
  }

  update(dt: number): void {
    this.time += dt;
    if (this.currentState === "flying") {
      this.fly(dt);
    } else if (this.currentState === "falling") {
      this.fall(dt);
    }
  }

  /** `push` is the blast direction (unit vector) for blast hits. */
  hit(kind: HitKind = "shot", push?: Vector3): void {
    if (this.currentState !== "flying") return;
    this.currentState = "falling";
    this.hitbox.isPickable = false;
    this.velocity.set(this.spawn.direction * this.spawn.speed * 0.15, 4, 0);
    if (push) this.velocity.addInPlace(push.scale(14));
    if (kind === "burn") this.applyLook("roasted");
    if (kind === "blast") this.applyLook("charred");
    // Splayed wings make the fall read as "hit" at a glance.
    this.wings[0]?.rotation.set(1.3, 0, 0);
    this.wings[1]?.rotation.set(-1.3, 0, 0);
  }

  dispose(): void {
    this.root.dispose();
  }

  private applyLook(look: ChickenLook): void {
    const materials = this.palette[look];
    for (const part of this.parts) part.mesh.material = materials[part.key];
  }

  private fly(dt: number): void {
    const position = this.root.position;
    position.x += this.spawn.direction * this.spawn.speed * dt;
    position.y = this.spawn.altitude + Math.sin(this.time * this.bobFrequency) * this.bobAmplitude;
    this.root.rotation.z = Math.cos(this.time * this.bobFrequency) * 0.12;

    const flap = Math.sin(this.time * this.flapFrequency) * 0.9;
    this.wings[0]?.rotation.set(flap, 0, 0);
    this.wings[1]?.rotation.set(-flap, 0, 0);

    if (this.spawn.direction * position.x > this.spawn.exitX) {
      this.currentState = "gone";
    }
  }

  private fall(dt: number): void {
    this.fallTime += dt;
    this.velocity.y += GRAVITY * dt;
    this.root.position.addInPlace(this.velocity.scale(dt));
    this.root.rotation.addInPlace(this.spin.scale(dt));

    const ground = terrainHeight(this.root.position.x, this.root.position.z);
    if (this.root.position.y < ground - 1 || this.fallTime > 5) {
      this.currentState = "gone";
    }
  }

  private buildBody(scene: Scene): void {
    const add = (mesh: Mesh, key: PartKey, position: Vector3, scaling?: Vector3, parent: TransformNode = this.root): Mesh => {
      mesh.parent = parent;
      mesh.position.copyFrom(position);
      if (scaling) mesh.scaling.copyFrom(scaling);
      mesh.isPickable = false;
      this.parts.push({ mesh, key });
      return mesh;
    };
    const sphere = (diameter: number, segments = 10): Mesh =>
      MeshBuilder.CreateSphere("chickenPart", { diameter, segments }, scene);

    // Local +x is the flight direction.
    add(sphere(1, 12), "feathers", new Vector3(0, 0, 0), new Vector3(1.3, 1, 0.95));
    add(sphere(0.62), "feathers", new Vector3(0.62, 0.48, 0));

    const beak = add(
      MeshBuilder.CreateCylinder("chickenBeak", { height: 0.34, diameterTop: 0, diameterBottom: 0.22, tessellation: 6 }, scene),
      "beak",
      new Vector3(0.98, 0.44, 0),
    );
    beak.rotation.z = -Math.PI / 2;

    for (let i = 0; i < 3; i++) {
      add(sphere(0.2, 6), "comb", new Vector3(0.5 + i * 0.12, 0.8 - Math.abs(i - 1) * 0.04, 0));
    }
    add(sphere(0.16, 6), "comb", new Vector3(0.88, 0.26, 0), new Vector3(0.7, 1.4, 0.7));

    for (const side of [-1, 1]) {
      add(sphere(0.26, 8), "eyeWhite", new Vector3(0.8, 0.58, side * 0.2));
      add(sphere(0.11, 6), "pupil", new Vector3(0.88, 0.58, side * 0.29));
    }

    for (let i = 0; i < 3; i++) {
      const feather = add(sphere(1, 6), "tail", new Vector3(-0.72, 0.28 + i * 0.1, (i - 1) * 0.14), new Vector3(0.55, 0.16, 0.22));
      feather.rotation.z = 0.5 + i * 0.25;
    }

    for (const side of [-1, 1]) {
      const pivot = new TransformNode("chickenWingPivot", scene);
      pivot.parent = this.root;
      pivot.position.set(0, 0.18, side * 0.4);
      add(sphere(1, 8), "wing", new Vector3(-0.05, 0, side * 0.42), new Vector3(0.75, 0.12, 0.9), pivot);
      this.wings.push(pivot);

      const leg = add(
        MeshBuilder.CreateCylinder("chickenLeg", { height: 0.5, diameter: 0.07, tessellation: 5 }, scene),
        "beak",
        new Vector3(-0.36, -0.42, side * 0.16),
      );
      leg.rotation.z = -1.0;
    }
  }
}

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
export type ChickenLook = "normal" | "roasted" | "charred" | "irradiated" | "golden" | "bomb";
export type ChickenPalette = Record<ChickenLook, ChickenMaterials> & { extras: ExtraMaterials };

interface ExtraMaterials {
  steel: StandardMaterial;
  gold: StandardMaterial;
  bombShell: StandardMaterial;
  spark: StandardMaterial;
  clockFace: StandardMaterial;
}

/**
 * normal · golden: rare, fast, bonus points and time · clock: carries a pocket watch, a few seconds more ·
 * bomb: costs points and explodes · armoured: two hits · boss: the chicken king.
 */
export type ChickenVariant = "normal" | "golden" | "clock" | "bomb" | "armored" | "boss";

interface VariantConfig {
  health: number;
  scale: number;
  /** Fixed score instead of the depth-based one (negative = penalty). */
  points?: number;
  pointsFactor: number;
  look: ChickenLook;
  speed?: SpeedClass;
  depth?: { min: number; max: number };
}

const VARIANTS: Record<ChickenVariant, VariantConfig> = {
  normal: { health: 1, scale: 1, pointsFactor: 1, look: "normal" },
  golden: {
    health: 1,
    scale: 0.9,
    points: 100,
    pointsFactor: 1,
    look: "golden",
    speed: { crossing: { min: 3, max: 4.2 }, points: 1, flap: 1.6, weight: 0 },
  },
  clock: { health: 1, scale: 1, pointsFactor: 1, look: "normal" },
  bomb: { health: 1, scale: 1, points: -50, pointsFactor: 1, look: "bomb" },
  armored: { health: 2, scale: 1.05, pointsFactor: 2, look: "normal" },
  boss: {
    health: 14,
    scale: 4,
    points: 500,
    pointsFactor: 1,
    look: "normal",
    speed: { crossing: { min: 26, max: 32 }, points: 1, flap: 0.5, weight: 0 },
    depth: { min: 55, max: 95 },
  },
};

/** Chance per spawned chicken (the boss is scheduled by the game, not rolled). */
export const VARIANT_CHANCES: readonly { variant: ChickenVariant; chance: number }[] = [
  { variant: "golden", chance: 0.04 },
  { variant: "clock", chance: 0.1 },
  { variant: "bomb", chance: 0.07 },
  { variant: "armored", chance: 0.1 },
];

export interface DamageResult {
  killed: boolean;
  /** Armour was knocked off, or the boss took a hit without dying. */
  deflected: boolean;
}

/** shot: bullets/pellets · burn: laser · blast: flak burst or atomic bomb. */
export type HitKind = "shot" | "burn" | "blast";

export interface ChickenSpawn {
  variant: ChickenVariant;
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
    golden: materialSet(
      scene,
      "golden",
      {
        feathers: new Color3(1, 0.78, 0.15),
        wing: new Color3(0.95, 0.65, 0.1),
        tail: new Color3(0.8, 0.5, 0.05),
        comb: new Color3(1, 0.3, 0.1),
        beak: new Color3(1, 0.9, 0.5),
        eyeWhite: new Color3(1, 1, 1),
        pupil: new Color3(0.02, 0.02, 0.02),
      },
      0.35,
    ),
    bomb: materialSet(scene, "bomb", {
      feathers: new Color3(0.18, 0.18, 0.2),
      wing: new Color3(0.12, 0.12, 0.14),
      tail: new Color3(0.05, 0.05, 0.05),
      comb: new Color3(0.9, 0.1, 0.05),
      beak: new Color3(0.9, 0.6, 0.1),
      eyeWhite: new Color3(1, 0.95, 0.9),
      pupil: new Color3(0.6, 0.02, 0.02),
    }),
    extras: createExtras(scene),
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

function createExtras(scene: Scene): ExtraMaterials {
  const steel = chickenMaterial(scene, "chicken-steel", new Color3(0.55, 0.57, 0.6));
  steel.specularColor = new Color3(0.9, 0.9, 0.9);
  steel.specularPower = 64;
  const gold = chickenMaterial(scene, "chicken-gold", new Color3(1, 0.78, 0.2), 0.3);
  gold.specularColor = new Color3(1, 0.9, 0.5);
  gold.specularPower = 48;
  const bombShell = chickenMaterial(scene, "chicken-bomb-shell", new Color3(0.05, 0.05, 0.06));
  bombShell.specularColor = new Color3(0.5, 0.5, 0.5);
  const spark = chickenMaterial(scene, "chicken-spark", new Color3(1, 0.7, 0.2));
  spark.disableLighting = true;
  spark.emissiveColor = new Color3(1, 0.75, 0.25);
  const clockFace = chickenMaterial(scene, "chicken-clock-face", new Color3(1, 1, 0.95));
  clockFace.emissiveColor = new Color3(0.6, 0.6, 0.55);
  return { steel, gold, bombShell, spark, clockFace };
}

function pickSpeedClass(): SpeedClass {
  let roll = Math.random();
  for (const speedClass of SPEED_CLASSES) {
    roll -= speedClass.weight;
    if (roll <= 0) return speedClass;
  }
  return SPEED_CLASSES[1];
}

export function createRandomSpawn(variant: ChickenVariant = "normal"): ChickenSpawn {
  const config = VARIANTS[variant];
  const range = config.depth ?? CHICKEN_DEPTH;
  const depth = range.min + (range.max - range.min) * Math.pow(Math.random(), 1.3);
  const direction = Math.random() < 0.5 ? 1 : -1;
  const edge = depth * SPAWN_EDGE_FACTOR + 10;
  const speedClass = config.speed ?? pickSpeedClass();

  let highestGround = 0;
  for (let x = -edge; x <= edge; x += edge / 15) {
    highestGround = Math.max(highestGround, terrainHeight(x, depth));
  }
  const minAltitude = Math.max(highestGround + 3, CAMERA_HEIGHT + 1);
  const maxAltitude = CAMERA_HEIGHT + depth * 0.32;
  const altitude = minAltitude >= maxAltitude ? minAltitude : randomRange(minAltitude, maxAltitude);

  return {
    variant,
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
  readonly variant: ChickenVariant;
  readonly maxHealth: number;

  private currentState: ChickenState = "flying";
  private health: number;
  private readonly parts: { mesh: Mesh; key: PartKey }[] = [];
  private readonly armor: Mesh[] = [];
  private fuseSpark: Mesh | null = null;
  private flinch = 0;
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
    const config = VARIANTS[spawn.variant];
    this.variant = spawn.variant;
    this.health = config.health;
    this.maxHealth = config.health;
    this.points = config.points ?? pointsForDepth(spawn.depth) * spawn.pointsMultiplier * config.pointsFactor;
    this.flapFrequency = randomRange(14, 20) * spawn.flapMultiplier;
    this.root = new TransformNode("chicken", scene);
    this.root.position.set(spawn.startX, spawn.altitude, spawn.depth);
    this.root.scaling.setAll(CHICKEN_SCALE * config.scale);
    this.root.rotation.y = spawn.direction > 0 ? FACE_CAMERA_ANGLE : Math.PI - FACE_CAMERA_ANGLE;

    this.buildBody(scene);
    this.buildExtras(scene);
    this.applyLook(irradiated && config.look === "normal" ? "irradiated" : config.look);

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

  get healthFraction(): number {
    return Math.max(0, this.health) / this.maxHealth;
  }

  update(dt: number): void {
    this.time += dt;
    this.flinch = Math.max(0, this.flinch - dt * 4);
    if (this.fuseSpark) this.fuseSpark.scaling.setAll(0.7 + Math.random() * 0.8);
    if (this.currentState === "flying") {
      this.fly(dt);
    } else if (this.currentState === "falling") {
      this.fall(dt);
    }
  }

  /** Applies damage; kills the chicken when its health runs out. `push` is the blast direction for blast hits. */
  damage(amount: number, kind: HitKind = "shot", push?: Vector3): DamageResult {
    if (this.currentState !== "flying") return { killed: false, deflected: false };
    this.health -= amount;
    if (this.health > 0) {
      this.flinch = 1;
      this.dropArmor();
      return { killed: false, deflected: true };
    }
    this.hit(kind, push);
    return { killed: true, deflected: false };
  }

  /** `push` is the blast direction (unit vector) for blast hits. */
  hit(kind: HitKind = "shot", push?: Vector3): void {
    if (this.currentState !== "flying") return;
    this.health = 0;
    this.dropArmor();
    this.fuseSpark?.setEnabled(false);
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

  /** The helmet and breastplate fly off after the first hit. */
  private dropArmor(): void {
    for (const piece of this.armor) {
      piece.setParent(null);
      const velocity = new Vector3(randomRange(-3, 3), randomRange(4, 7), randomRange(-3, 3));
      let age = 0;
      const observer = piece.getScene().onBeforeRenderObservable.add(() => {
        const dt = piece.getScene().getEngine().getDeltaTime() / 1000;
        age += dt;
        velocity.y += GRAVITY * dt;
        piece.position.addInPlace(velocity.scale(dt));
        piece.rotation.x += dt * 8;
        if (age > 2) {
          piece.getScene().onBeforeRenderObservable.remove(observer);
          piece.dispose();
        }
      });
    }
    this.armor.length = 0;
  }

  private applyLook(look: ChickenLook): void {
    const materials = this.palette[look];
    for (const part of this.parts) part.mesh.material = materials[part.key];
  }

  private fly(dt: number): void {
    const position = this.root.position;
    position.x += this.spawn.direction * this.spawn.speed * dt;
    position.y = this.spawn.altitude + Math.sin(this.time * this.bobFrequency) * this.bobAmplitude + this.flinch * 0.6;
    this.root.rotation.z = Math.cos(this.time * this.bobFrequency) * 0.12 + this.flinch * 0.4;

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

  private buildExtras(scene: Scene): void {
    const extras = this.palette.extras;
    const attach = (mesh: Mesh, material: StandardMaterial, position: Vector3, scaling?: Vector3): Mesh => {
      mesh.parent = this.root;
      mesh.material = material;
      mesh.position.copyFrom(position);
      if (scaling) mesh.scaling.copyFrom(scaling);
      mesh.isPickable = false;
      return mesh;
    };

    if (this.variant === "armored") {
      const helmet = MeshBuilder.CreateSphere("chickenHelmet", { diameter: 0.74, segments: 10, slice: 0.5 }, scene);
      this.armor.push(attach(helmet, extras.steel, new Vector3(0.6, 0.6, 0)));
      const plate = MeshBuilder.CreateSphere("chickenPlate", { diameter: 1, segments: 10, slice: 0.5 }, scene);
      plate.rotation.z = -Math.PI / 2;
      this.armor.push(attach(plate, extras.steel, new Vector3(0.18, 0, 0), new Vector3(1.05, 1.05, 1.02)));
    }

    if (this.variant === "bomb") {
      attach(MeshBuilder.CreateSphere("chickenBomb", { diameter: 0.6, segments: 10 }, scene), extras.bombShell, new Vector3(0, -0.62, 0));
      const fuse = attach(
        MeshBuilder.CreateCylinder("chickenFuse", { height: 0.25, diameter: 0.05, tessellation: 5 }, scene),
        extras.steel,
        new Vector3(0.05, -0.28, 0),
      );
      fuse.rotation.z = -0.4;
      this.fuseSpark = attach(MeshBuilder.CreateSphere("chickenSpark", { diameter: 0.14, segments: 4 }, scene), extras.spark, new Vector3(0.1, -0.16, 0));
    }

    if (this.variant === "clock") {
      // A golden pocket watch dangling from the feet, face turned to the player.
      const watch = attach(
        MeshBuilder.CreateCylinder("chickenWatch", { height: 0.08, diameter: 0.5, tessellation: 16 }, scene),
        extras.gold,
        new Vector3(0.05, -0.7, 0),
      );
      watch.rotation.x = Math.PI / 2;
      for (const side of [-1, 1]) {
        const face = attach(
          MeshBuilder.CreateCylinder("chickenWatchFace", { height: 0.02, diameter: 0.42, tessellation: 16 }, scene),
          extras.clockFace,
          new Vector3(0.05, -0.7, side * 0.045),
        );
        face.rotation.x = Math.PI / 2;
        const hand = attach(MeshBuilder.CreateBox("chickenWatchHand", { width: 0.03, height: 0.16, depth: 0.01 }, scene), extras.bombShell, new Vector3(0.05, -0.64, side * 0.06));
        hand.rotation.z = 0.6;
      }
      attach(MeshBuilder.CreateCylinder("chickenWatchChain", { height: 0.3, diameter: 0.03, tessellation: 5 }, scene), extras.gold, new Vector3(0.05, -0.38, 0));
    }

    if (this.variant === "boss") {
      // The chicken king wears a crown.
      attach(
        MeshBuilder.CreateCylinder("chickenCrown", { height: 0.18, diameter: 0.42, tessellation: 12 }, scene),
        extras.gold,
        new Vector3(0.6, 0.86, 0),
      );
      for (let i = 0; i < 5; i++) {
        const angle = (i / 5) * Math.PI * 2;
        const spike = attach(
          MeshBuilder.CreateCylinder("chickenCrownSpike", { height: 0.16, diameterTop: 0, diameterBottom: 0.09, tessellation: 4 }, scene),
          extras.gold,
          new Vector3(0.6 + Math.cos(angle) * 0.17, 1.02, Math.sin(angle) * 0.17),
        );
        spike.rotation.y = angle;
      }
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

import {
  type AbstractMesh,
  Color3,
  Mesh,
  MeshBuilder,
  type Scene,
  StandardMaterial,
  TransformNode,
  Vector3,
} from "./babylon";
import { GRAVITY } from "./config";
import { randomRange } from "./random";
import type { FarmParts } from "./scenery";
import { terrainHeight, type World } from "./world";

export type EggSound = "whoosh" | "moo" | "creak" | "windmill";

export interface EggCallbacks {
  sound(kind: EggSound): void;
  /** A chicken escapes from the barn. */
  spawnChicken(position: Vector3): void;
  explode(position: Vector3): void;
}

export interface EasterEgg {
  label: string;
  points: number;
  found: boolean;
  meshes: AbstractMesh[];
}

interface EggBehaviour extends EasterEgg {
  /** Starts the egg's reaction; it was just shot. */
  trigger(): void;
  update(dt: number): void;
  reset(): void;
}

/** Seconds into the round between which the UFO shows up once. */
const UFO_WINDOW = { min: 15, max: 60 } as const;
const UFO_FLIGHT_S = 9;

function material(scene: Scene, name: string, color: Color3, glow = 0): StandardMaterial {
  const created = new StandardMaterial(name, scene);
  created.diffuseColor = color;
  created.specularColor = Color3.Black();
  created.emissiveColor = color.scale(glow);
  return created;
}

function part(mesh: Mesh, parent: TransformNode, mat: StandardMaterial, position: Vector3): Mesh {
  mesh.parent = parent;
  mesh.material = mat;
  mesh.position.copyFrom(position);
  mesh.isPickable = false;
  return mesh;
}

/** Hidden targets in the landscape — each can be found once per round. */
export class EasterEggs {
  private readonly eggs: EggBehaviour[] = [];
  private readonly byMesh = new Map<AbstractMesh, EggBehaviour>();
  private ufoAt = 0;
  private roundTime = 0;

  constructor(
    private readonly scene: Scene,
    private readonly world: World,
    private readonly callbacks: EggCallbacks,
  ) {
    // Scarecrow, windmill, barn door and cow belong to the farm; the UFO turns up everywhere.
    const farm = world.farm;
    if (farm) this.eggs.push(this.createScarecrow(), this.createWindmill(farm), this.createBarnDoor(farm), this.createCow());
    this.eggs.push(this.createUfo());
    for (const egg of this.eggs) for (const mesh of egg.meshes) this.byMesh.set(mesh, egg);
    this.reset();
  }

  isTarget(mesh: AbstractMesh): boolean {
    return this.byMesh.has(mesh);
  }

  find(mesh: AbstractMesh): EasterEgg | undefined {
    return this.byMesh.get(mesh);
  }

  /** Triggers the egg hit by `mesh`; returns it, or undefined when it was already found. */
  trigger(mesh: AbstractMesh): EasterEgg | undefined {
    const egg = this.byMesh.get(mesh);
    if (!egg || egg.found) return undefined;
    egg.found = true;
    for (const target of egg.meshes) target.isPickable = false;
    egg.trigger();
    return egg;
  }

  update(dt: number): void {
    this.roundTime += dt;
    for (const egg of this.eggs) egg.update(dt);
  }

  /** New round: everything back in place, the UFO gets a new arrival time. */
  reset(): void {
    this.roundTime = 0;
    this.ufoAt = randomRange(UFO_WINDOW.min, UFO_WINDOW.max);
    for (const egg of this.eggs) {
      egg.found = false;
      egg.reset();
      for (const mesh of egg.meshes) mesh.isPickable = true;
    }
  }

  private createScarecrow(): EggBehaviour {
    const scene = this.scene;
    const root = new TransformNode("scarecrow", scene);
    root.parent = this.world.sceneryRoot;
    root.position.set(13, terrainHeight(13, 30) - 0.1, 30);
    root.rotation.y = -0.3;
    this.world.burnsAway.push(root);

    const wood = material(scene, "scarecrowWood", new Color3(0.4, 0.27, 0.15));
    const burlap = material(scene, "scarecrowBurlap", new Color3(0.75, 0.62, 0.4));
    const shirt = material(scene, "scarecrowShirt", new Color3(0.62, 0.16, 0.1));
    const hatMaterial = material(scene, "scarecrowHat", new Color3(0.25, 0.18, 0.1));

    const meshes = [
      part(MeshBuilder.CreateBox("scarecrowPost", { width: 0.15, height: 2.6, depth: 0.15 }, scene), root, wood, new Vector3(0, 1.3, 0)),
      part(MeshBuilder.CreateBox("scarecrowArms", { width: 2.2, height: 0.12, depth: 0.12 }, scene), root, wood, new Vector3(0, 1.9, 0)),
      part(MeshBuilder.CreateBox("scarecrowShirt", { width: 0.8, height: 0.9, depth: 0.35 }, scene), root, shirt, new Vector3(0, 1.75, 0)),
      part(MeshBuilder.CreateSphere("scarecrowHead", { diameter: 0.6, segments: 8 }, scene), root, burlap, new Vector3(0, 2.5, 0)),
    ];
    const hat = new TransformNode("scarecrowHat", scene);
    hat.parent = root;
    hat.position.set(0, 2.78, 0);
    meshes.push(
      part(MeshBuilder.CreateCylinder("scarecrowBrim", { height: 0.05, diameter: 1, tessellation: 16 }, scene), hat, hatMaterial, Vector3.Zero()),
      part(MeshBuilder.CreateCylinder("scarecrowCrown", { height: 0.4, diameterTop: 0.35, diameterBottom: 0.5, tessellation: 12 }, scene), hat, hatMaterial, new Vector3(0, 0.2, 0)),
    );

    const hatVelocity = new Vector3();
    let spin = 0;
    return {
      label: "Scarecrow",
      points: 25,
      found: false,
      meshes,
      trigger: () => {
        hatVelocity.set(randomRange(-2, 2), 9, randomRange(-1, 1));
        spin = Math.PI * 4;
        this.callbacks.sound("whoosh");
      },
      update: (dt) => {
        if (spin > 0) {
          const step = Math.min(spin, dt * 12);
          root.rotation.y += step;
          spin -= step;
        }
        if (hatVelocity.lengthSquared() > 0) {
          hatVelocity.y += GRAVITY * 0.4 * dt;
          hat.position.addInPlace(hatVelocity.scale(dt));
          hat.rotation.x += dt * 6;
          if (hat.position.y < 0.05) hatVelocity.setAll(0);
        }
      },
      reset: () => {
        root.rotation.y = -0.3;
        hat.position.set(0, 2.78, 0);
        hat.rotation.setAll(0);
        hatVelocity.setAll(0);
        spin = 0;
      },
    };
  }

  private createWindmill(farm: FarmParts): EggBehaviour {
    return {
      label: "Windmill",
      points: 50,
      found: false,
      meshes: farm.windmillParts,
      trigger: () => {
        this.world.windmillBoost = 6;
        this.callbacks.sound("windmill");
      },
      update: () => undefined,
      reset: () => {
        this.world.windmillBoost = 0;
      },
    };
  }

  private createBarnDoor(farm: FarmParts): EggBehaviour {
    const { hinge, mesh } = farm.barnDoor;
    let opening = 0;
    return {
      label: "Barn door",
      points: 30,
      found: false,
      meshes: [mesh],
      trigger: () => {
        opening = 1;
        this.callbacks.sound("creak");
        this.callbacks.spawnChicken(mesh.getAbsolutePosition().add(new Vector3(0, 1, -3)));
      },
      update: (dt) => {
        if (opening <= 0 || this.world.devastated) return;
        opening = Math.max(0, opening - dt * 1.6);
        hinge.rotation.y = -1.7 * (1 - opening * opening);
      },
      reset: () => {
        opening = 0;
        hinge.rotation.y = 0;
      },
    };
  }

  private createCow(): EggBehaviour {
    const scene = this.scene;
    const root = new TransformNode("cow", scene);
    root.parent = this.world.sceneryRoot;
    const ground = terrainHeight(-14, 26);
    root.position.set(-14, ground, 26);
    root.rotation.y = 0.8;
    this.world.burnsAway.push(root);

    const white = material(scene, "cowWhite", new Color3(0.92, 0.9, 0.86));
    const black = material(scene, "cowBlack", new Color3(0.08, 0.08, 0.08));
    const pink = material(scene, "cowPink", new Color3(0.9, 0.6, 0.6));
    const horn = material(scene, "cowHorn", new Color3(0.85, 0.8, 0.65));

    const meshes = [
      part(MeshBuilder.CreateBox("cowBody", { width: 2.2, height: 1.1, depth: 1 }, scene), root, white, new Vector3(0, 1.25, 0)),
      part(MeshBuilder.CreateBox("cowHead", { width: 0.7, height: 0.65, depth: 0.6 }, scene), root, white, new Vector3(1.35, 1.6, 0)),
      part(MeshBuilder.CreateBox("cowSnout", { width: 0.3, height: 0.35, depth: 0.5 }, scene), root, pink, new Vector3(1.75, 1.45, 0)),
      part(MeshBuilder.CreateBox("cowSpot1", { width: 0.7, height: 0.6, depth: 1.02 }, scene), root, black, new Vector3(-0.4, 1.35, 0)),
      part(MeshBuilder.CreateBox("cowSpot2", { width: 0.4, height: 0.4, depth: 1.02 }, scene), root, black, new Vector3(0.5, 1.1, 0)),
    ];
    for (const side of [-1, 1]) {
      const hornMesh = part(
        MeshBuilder.CreateCylinder("cowHorn", { height: 0.3, diameterTop: 0, diameterBottom: 0.1, tessellation: 6 }, scene),
        root,
        horn,
        new Vector3(1.3, 2.0, side * 0.25),
      );
      hornMesh.rotation.x = side * 0.5;
      meshes.push(hornMesh);
      for (const x of [-0.8, 0.8]) {
        meshes.push(part(MeshBuilder.CreateBox("cowLeg", { width: 0.2, height: 0.75, depth: 0.2 }, scene), root, white, new Vector3(x, 0.38, side * 0.35)));
      }
    }

    let jump = 0;
    let velocity = 0;
    return {
      label: "Cow",
      points: 40,
      found: false,
      meshes,
      trigger: () => {
        jump = 2;
        velocity = 5;
        this.callbacks.sound("moo");
      },
      update: (dt) => {
        if (jump <= 0) return;
        velocity += GRAVITY * 0.5 * dt;
        root.position.y += velocity * dt;
        if (root.position.y <= ground) {
          root.position.y = ground;
          jump--;
          velocity = jump > 0 ? 4 : 0;
        }
      },
      reset: () => {
        jump = 0;
        velocity = 0;
        root.position.y = ground;
      },
    };
  }

  private createUfo(): EggBehaviour {
    const scene = this.scene;
    const root = new TransformNode("ufo", scene);
    // Hangs below the scenery so it is cleaned up with it when the scenery changes.
    root.parent = this.world.sceneryRoot;
    const hull = material(scene, "ufoHull", new Color3(0.6, 0.62, 0.66));
    hull.specularColor = new Color3(0.8, 0.8, 0.8);
    const dome = material(scene, "ufoDome", new Color3(0.3, 0.9, 1), 0.6);
    dome.alpha = 0.85;
    const lights = material(scene, "ufoLights", new Color3(1, 0.9, 0.3), 1);

    const disc = part(MeshBuilder.CreateSphere("ufoDisc", { diameter: 8, segments: 16 }, scene), root, hull, Vector3.Zero());
    disc.scaling.y = 0.22;
    const meshes: Mesh[] = [disc, part(MeshBuilder.CreateSphere("ufoDome", { diameter: 3.2, segments: 12, slice: 0.5 }, scene), root, dome, new Vector3(0, 0.5, 0))];
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2;
      meshes.push(part(MeshBuilder.CreateSphere("ufoLight", { diameter: 0.45, segments: 4 }, scene), root, lights, new Vector3(Math.cos(angle) * 3.6, -0.1, Math.sin(angle) * 3.6)));
    }
    for (const mesh of meshes) mesh.applyFog = false;

    let flight = -1;
    let launched = false;
    const start = new Vector3(-320, 85, 250);
    const end = new Vector3(320, 70, 230);
    const ufo: EggBehaviour = {
      label: "UFO",
      points: 200,
      found: false,
      meshes,
      trigger: () => {
        this.callbacks.explode(root.position.clone());
        flight = -1;
        root.setEnabled(false);
      },
      update: (dt) => {
        if (!launched && !ufo.found && this.roundTime >= this.ufoAt) {
          launched = true;
          flight = 0;
          root.setEnabled(true);
        }
        if (flight < 0) return;
        flight += dt / UFO_FLIGHT_S;
        Vector3.LerpToRef(start, end, flight, root.position);
        root.position.y += Math.sin(flight * 40) * 3;
        root.rotation.y += dt * 3;
        if (flight >= 1) {
          flight = -1;
          root.setEnabled(false);
        }
      },
      reset: () => {
        flight = -1;
        launched = false;
        root.setEnabled(false);
      },
    };
    return ufo;
  }
}

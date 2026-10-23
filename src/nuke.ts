import {
  Color3,
  ImportMeshAsync,
  type Mesh,
  MeshBuilder,
  type Scene,
  StandardMaterial,
  type TransformNode,
  Vector3,
} from "./babylon";
import { NUKE_FALL_TIME_S } from "./weapons";

/** Scale of the mushroom model (about 3.5 units tall) in the world. */
const MUSHROOM_SCALE = 34;
const FIREBALL_RADIUS = 55;
const SHOCKWAVE_RADIUS = 600;
const SHOCKWAVE_DURATION_S = 3;
/** Metres per second the visible shock wave travels; the game uses it to time the hit on the player. */
export const SHOCKWAVE_SPEED = SHOCKWAVE_RADIUS / SHOCKWAVE_DURATION_S;
/** Seconds after impact when the flash is brightest and the world is swapped for the wasteland. */
const DEVASTATION_DELAY_S = 0.25;
const BOMB_SCALE = 6;
/** The bomb comes down from this high and from behind the target, so it falls into view. */
const DROP_HEIGHT = 260;
const DROP_LEAD = 60;

export interface StrikeCallbacks {
  /** The bomb hit the ground. */
  impact(position: Vector3): void;
  /** Peak of the flash — swap the world and kill everything. */
  devastate(position: Vector3): void;
}

interface Strike {
  from: Vector3;
  target: Vector3;
  elapsed: number;
  impacted: boolean;
  devastated: boolean;
  bomb: TransformNode | null;
  callbacks: StrikeCallbacks;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * Math.min(1, Math.max(0, t));
}

/** Atomic bomb: flight, fireball, shock wave and the mushroom cloud that stays for the rest of the round. */
export class NuclearStrike {
  private strike: Strike | null = null;
  private readonly fireball: Mesh;
  private readonly fireballMaterial: StandardMaterial;
  private readonly shockwave: Mesh;
  private readonly shockwaveMaterial: StandardMaterial;
  private readonly cloudMaterial: StandardMaterial;

  private constructor(
    scene: Scene,
    private readonly bombTemplate: TransformNode,
    private readonly mushroom: TransformNode,
    private readonly mushroomParts: Record<"stem" | "cap" | "ring" | "base", TransformNode>,
  ) {
    this.fireballMaterial = new StandardMaterial("fireballMaterial", scene);
    this.fireballMaterial.disableLighting = true;
    this.fireball = MeshBuilder.CreateSphere("fireball", { diameter: 2, segments: 24 }, scene);
    this.fireball.material = this.fireballMaterial;
    this.fireball.applyFog = false;

    this.shockwaveMaterial = new StandardMaterial("shockwaveMaterial", scene);
    this.shockwaveMaterial.disableLighting = true;
    this.shockwaveMaterial.emissiveColor = new Color3(1, 0.9, 0.75);
    this.shockwaveMaterial.backFaceCulling = false;
    this.shockwave = MeshBuilder.CreateTorus("shockwave", { diameter: 2, thickness: 0.08, tessellation: 64 }, scene);
    this.shockwave.material = this.shockwaveMaterial;
    this.shockwave.applyFog = false;

    this.cloudMaterial = new StandardMaterial("mushroomMaterial", scene);
    this.cloudMaterial.specularColor = Color3.Black();
    for (const mesh of mushroom.getChildMeshes()) {
      mesh.material = this.cloudMaterial;
      mesh.applyFog = false;
    }
    for (const node of [this.fireball, this.shockwave, mushroom.getChildMeshes(), bombTemplate.getChildMeshes()].flat()) {
      node.isPickable = false;
    }
    this.reset();
  }

  static async load(scene: Scene): Promise<NuclearStrike> {
    const base = import.meta.env.BASE_URL;
    const [bomb, cloud] = await Promise.all([
      ImportMeshAsync(`${base}models/nuke.glb`, scene),
      ImportMeshAsync(`${base}models/mushroom.glb`, scene),
    ]);
    const bombRoot = bomb.meshes[0];
    const cloudRoot = cloud.meshes[0];
    if (!bombRoot || !cloudRoot) throw new Error("Empty nuke model");
    const find = (name: string): TransformNode => {
      const node = [...cloud.meshes, ...cloud.transformNodes].find((candidate) => candidate.name === name);
      if (!node) throw new Error(`Missing node ${name} in mushroom.glb`);
      return node;
    };
    return new NuclearStrike(scene, bombRoot, cloudRoot, {
      stem: find("Mushroom_Stem"),
      cap: find("Mushroom_Cap"),
      ring: find("Mushroom_Ring"),
      base: find("Mushroom_Base"),
    });
  }

  get isActive(): boolean {
    return this.strike !== null;
  }

  /** Drops the bomb out of the sky onto `target`; `viewer` is where the player stands. */
  drop(target: Vector3, viewer: Vector3, callbacks: StrikeCallbacks): void {
    this.reset();
    const awayFromViewer = target.subtract(viewer);
    awayFromViewer.y = 0;
    awayFromViewer.normalize();
    const from = target.add(awayFromViewer.scale(DROP_LEAD)).addInPlaceFromFloats(0, DROP_HEIGHT, 0);
    const bomb = this.bombTemplate.instantiateHierarchy(null, { doNotInstantiate: true });
    bomb?.setEnabled(true);
    bomb?.scaling.scaleInPlace(BOMB_SCALE);
    this.strike = { from: from.clone(), target: target.clone(), elapsed: 0, impacted: false, devastated: false, bomb, callbacks };
  }

  /** Removes the cloud and everything else so a new round starts with a clean sky. */
  reset(): void {
    this.strike?.bomb?.dispose();
    this.strike = null;
    this.bombTemplate.setEnabled(false);
    this.mushroom.setEnabled(false);
    this.fireball.setEnabled(false);
    this.shockwave.setEnabled(false);
  }

  update(dt: number): void {
    const strike = this.strike;
    if (!strike) return;
    strike.elapsed += dt;

    if (!strike.impacted) {
      this.updateFlight(strike);
      return;
    }

    const t = strike.elapsed - NUKE_FALL_TIME_S;
    if (!strike.devastated && t >= DEVASTATION_DELAY_S) {
      strike.devastated = true;
      strike.callbacks.devastate(strike.target);
    }
    this.updateFireball(strike.target, t);
    this.updateShockwave(strike.target, t);
    this.updateMushroom(strike.target, t);
  }

  private updateFlight(strike: Strike): void {
    const t = Math.min(1, strike.elapsed / NUKE_FALL_TIME_S);
    // Speeds up while it falls, like a real free fall.
    const position = Vector3.Lerp(strike.from, strike.target, t * t);
    if (strike.bomb) {
      strike.bomb.position.copyFrom(position);
      strike.bomb.rotationQuaternion = null;
      // Nose down, slowly spinning around its long axis.
      strike.bomb.rotation.set(Math.PI / 2, strike.elapsed * 0.8, 0);
    }
    if (t < 1) return;
    strike.impacted = true;
    strike.bomb?.dispose();
    strike.bomb = null;
    strike.callbacks.impact(strike.target);
  }

  private updateFireball(target: Vector3, t: number): void {
    const visible = t < 4;
    this.fireball.setEnabled(visible);
    if (!visible) return;
    const grow = Math.min(1, t / 0.9);
    this.fireball.scaling.setAll(FIREBALL_RADIUS * Math.sqrt(grow));
    this.fireball.position.set(target.x, target.y + FIREBALL_RADIUS * 0.4 * grow + t * 6, target.z);
    const cool = Math.min(1, t / 4);
    this.fireballMaterial.emissiveColor = Color3.Lerp(new Color3(1, 1, 0.85), new Color3(0.6, 0.12, 0.02), cool);
    this.fireballMaterial.alpha = 1 - cool * cool;
  }

  private updateShockwave(target: Vector3, t: number): void {
    const visible = t < SHOCKWAVE_DURATION_S;
    this.shockwave.setEnabled(visible);
    if (!visible) return;
    const radius = SHOCKWAVE_RADIUS * (t / SHOCKWAVE_DURATION_S);
    this.shockwave.position.set(target.x, target.y + 2, target.z);
    this.shockwave.scaling.set(radius, 40, radius);
    this.shockwaveMaterial.alpha = 0.8 * (1 - t / SHOCKWAVE_DURATION_S);
  }

  private updateMushroom(target: Vector3, t: number): void {
    const visible = t > 0.4;
    this.mushroom.setEnabled(visible);
    if (!visible) return;
    const rise = Math.min(1, (t - 0.4) / 7);
    const ease = 1 - Math.pow(1 - rise, 3);
    this.mushroom.position.copyFrom(target);
    this.mushroom.rotationQuaternion = null;
    this.mushroom.rotation.y = t * 0.03;
    this.mushroom.scaling.set(MUSHROOM_SCALE, MUSHROOM_SCALE, -MUSHROOM_SCALE);

    // The stem stretches upwards while cap and ring climb with it.
    this.mushroomParts.stem.scaling.set(lerp(0.4, 1, ease), lerp(0.2, 1, ease), lerp(0.4, 1, ease));
    for (const part of [this.mushroomParts.cap, this.mushroomParts.ring]) {
      part.scaling.setAll(lerp(0.35, 1, ease));
    }
    this.mushroomParts.base.scaling.setAll(lerp(0.3, 1.3, ease));

    const glow = Math.max(0, 1 - (t - 0.4) / 9);
    this.cloudMaterial.diffuseColor = Color3.Lerp(new Color3(0.32, 0.27, 0.24), new Color3(0.45, 0.3, 0.2), glow);
    this.cloudMaterial.emissiveColor = Color3.Lerp(new Color3(0.06, 0.05, 0.04), new Color3(1, 0.45, 0.1), glow * glow);
  }
}

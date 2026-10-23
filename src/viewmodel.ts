import {
  type AbstractMesh,
  type Camera,
  Color3,
  DynamicTexture,
  type Engine,
  ImportMeshAsync,
  type Material,
  Mesh,
  MeshBuilder,
  type PBRMaterial,
  Quaternion,
  type Scene,
  StandardMaterial,
  TransformNode,
  Vector3,
} from "./babylon";
import type { WeaponController } from "./weapon-controller";
import { WEAPON_ORDER, WEAPONS, type WeaponDefinition, type WeaponId } from "./weapons";

/** Rendering group drawn after the world with a cleared depth buffer, so the weapon never clips into it. */
const VIEWMODEL_RENDERING_GROUP = 1;
const AIM_DISTANCE = 40;
const AIM_RESPONSE = 18;
const RECOIL_RECOVERY = 10;
const PUMP_TRAVEL = 0.08;
const COVER_OPEN_ANGLE = 1.15;
const FLAK_RECOIL_TRAVEL = 0.55;
const FLAK_BREECH_DROP = 0.22;
const SLIDE_TRAVEL = 0.025;
const AK_BOLT_TRAVEL = 0.07;
const MAG_DROP = 0.22;
/** Barrel spin of the Gatling while firing (rad/s) and how fast it winds down. */
const GATLING_SPIN = 22;
const GATLING_SPIN_DECAY = 2.5;
const DEBRIS_LIFETIME_S = 0.8;
const DEBRIS_GRAVITY = -9;

interface Pose {
  x: number;
  y: number;
  z: number;
  pitch: number;
  roll: number;
}

interface WeaponVisual {
  /** Where the model's origin (back of the receiver / breech) sits, in camera space. */
  hold: Vector3;
  /** The flak is a field gun: shrunk so the breech and barrel fit into view. */
  scale?: number;
  recoil: { back: number; lift: number };
  reloadPose: Pose;
  flashSize: number;
}

const NO_POSE: Pose = { x: 0, y: 0, z: 0, pitch: 0, roll: 0 };

const VISUALS: Record<WeaponId, WeaponVisual> = {
  pistol: {
    hold: new Vector3(0.1, -0.075, 0.32),
    recoil: { back: 0.03, lift: 0.22 },
    reloadPose: { x: -0.04, y: 0.04, z: 0, pitch: -0.25, roll: -0.35 },
    flashSize: 0.1,
  },
  mp40: {
    hold: new Vector3(0.17, -0.15, 0.36),
    recoil: { back: 0.015, lift: 0.04 },
    reloadPose: { x: -0.04, y: 0.02, z: 0, pitch: -0.15, roll: -0.5 },
    flashSize: 0.13,
  },
  shotgun: {
    hold: new Vector3(0.18, -0.16, 0.38),
    recoil: { back: 0.07, lift: 0.16 },
    reloadPose: { x: -0.07, y: 0.08, z: 0, pitch: 0.02, roll: -0.9 },
    flashSize: 0.2,
  },
  m1garand: {
    hold: new Vector3(0.18, -0.16, 0.38),
    recoil: { back: 0.05, lift: 0.14 },
    reloadPose: { x: -0.05, y: 0.06, z: 0, pitch: 0.05, roll: -0.6 },
    flashSize: 0.2,
  },
  ak47: {
    hold: new Vector3(0.18, -0.16, 0.38),
    recoil: { back: 0.02, lift: 0.05 },
    reloadPose: { x: -0.04, y: 0.02, z: 0, pitch: -0.15, roll: -0.5 },
    flashSize: 0.15,
  },
  mg42: {
    hold: new Vector3(0.18, -0.16, 0.38),
    recoil: { back: 0.018, lift: 0.03 },
    reloadPose: { x: -0.03, y: -0.02, z: 0, pitch: -0.12, roll: -0.2 },
    flashSize: 0.13,
  },
  gatling: {
    hold: new Vector3(0.2, -0.18, 0.44),
    scale: 0.6,
    recoil: { back: 0.01, lift: 0.015 },
    reloadPose: NO_POSE,
    flashSize: 0.22,
  },
  rpg7: {
    hold: new Vector3(0.16, -0.12, 0.3),
    recoil: { back: 0.06, lift: 0.12 },
    reloadPose: { x: -0.04, y: -0.06, z: 0, pitch: 0.3, roll: -0.25 },
    flashSize: 0.4,
  },
  flak88: {
    hold: new Vector3(0.36, -0.4, 1.0),
    scale: 0.55,
    recoil: { back: 0, lift: 0.02 },
    reloadPose: NO_POSE,
    flashSize: 2.2,
  },
  laser: {
    hold: new Vector3(0.19, -0.15, 0.42),
    scale: 0.85,
    recoil: { back: 0, lift: 0 },
    reloadPose: NO_POSE,
    flashSize: 0,
  },
  nuke: {
    hold: new Vector3(0.16, -0.16, 0.32),
    recoil: { back: 0, lift: 0 },
    reloadPose: NO_POSE,
    flashSize: 0,
  },
};

interface WeaponRig {
  definition: WeaponDefinition;
  visual: WeaponVisual;
  holder: TransformNode;
  /** glTF root; every part and all debris live in this space. */
  root: TransformNode;
  /** Unit vector along the barrel, in root space. */
  barrel: Vector3;
  muzzle: TransformNode;
  flash: Mesh | null;
  find(part: string): TransformNode | undefined;
  rest: Map<TransformNode, { position: Vector3; rotation: Quaternion }>;
  glow: StandardMaterial[];
  /** Spare copy of a shell/round shown while loading. */
  loadingShell?: TransformNode;
  lastAction: number | null;
}

interface Debris {
  node: TransformNode;
  velocity: Vector3;
  spin: Vector3;
  age: number;
  lifetime: number;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function toStandardMaterial(material: Material, scene: Scene): StandardMaterial {
  // Without an environment map the glTF PBR metals render almost black; a Standard
  // material matches the rest of the low-poly scene and the existing lights.
  const pbr = material as PBRMaterial;
  const standard = new StandardMaterial(`${material.name}Viewmodel`, scene);
  if (material.name.startsWith("Glow")) {
    standard.disableLighting = true;
    standard.emissiveColor = pbr.albedoColor.toGammaSpace();
    return standard;
  }
  const metallic = pbr.metallic ?? 0;
  const roughness = pbr.roughness ?? 0.5;
  standard.diffuseColor = pbr.albedoColor.clone();
  standard.specularColor = Color3.White().scale(0.06 + metallic * 0.45 * (1 - roughness));
  standard.specularPower = 12 + (1 - roughness) * 100;
  standard.emissiveColor = standard.diffuseColor.scale(0.12);
  return standard;
}

function createFlashTexture(scene: Scene): DynamicTexture {
  const size = 128;
  const texture = new DynamicTexture("muzzleFlashTexture", { width: size, height: size }, scene, false);
  const ctx = texture.getContext();
  const center = size / 2;
  const glow = ctx.createRadialGradient(center, center, 0, center, center, center);
  glow.addColorStop(0, "rgba(255,255,230,1)");
  glow.addColorStop(0.25, "rgba(255,210,90,0.95)");
  glow.addColorStop(0.6, "rgba(255,120,20,0.4)");
  glow.addColorStop(1, "rgba(255,80,0,0)");
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = glow;
  ctx.beginPath();
  for (let i = 0; i < 16; i++) {
    const angle = (i / 16) * Math.PI * 2;
    const radius = i % 2 === 0 ? center : center * 0.35;
    const x = center + Math.cos(angle) * radius;
    const y = center + Math.sin(angle) * radius;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
  texture.hasAlpha = true;
  texture.update();
  return texture;
}

/** The first-person weapon: loading, aiming at the crosshair, recoil and the per-weapon animations. */
export class Viewmodel {
  private readonly pivot: TransformNode;
  private readonly rigs = new Map<WeaponId, WeaponRig>();
  private readonly debris: Debris[] = [];
  private readonly aim = new Vector3(0, 0, 0);
  private readonly recoil = { back: 0, lift: 0, roll: 0 };
  private activeId: WeaponId = "shotgun";
  private reloadBlend = 0;
  private flashTimer = 0;
  private time = 0;
  private gatlingSpin = 0;
  private gatlingAngle = 0;
  private casingTemplate: Mesh | null = null;

  private constructor(
    private readonly scene: Scene,
    private readonly engine: Engine,
    private readonly camera: Camera,
  ) {
    this.pivot = new TransformNode("viewmodelPivot", scene);
    this.pivot.parent = camera;
  }

  static async load(scene: Scene, engine: Engine, camera: Camera): Promise<Viewmodel> {
    const viewmodel = new Viewmodel(scene, engine, camera);
    const flashTexture = createFlashTexture(scene);
    const materials = new Map<Material, StandardMaterial>();
    const rigs = await Promise.all(WEAPON_ORDER.map((id) => viewmodel.loadRig(WEAPONS[id], flashTexture, materials)));
    for (const rig of rigs) viewmodel.rigs.set(rig.definition.id, rig);
    viewmodel.show(viewmodel.activeId);
    return viewmodel;
  }

  setVisible(visible: boolean): void {
    this.pivot.setEnabled(visible);
  }

  show(id: WeaponId): void {
    this.activeId = id;
    for (const [rigId, rig] of this.rigs) rig.holder.setEnabled(rigId === id);
  }

  /** World position of the active weapon's muzzle (for tracers and the laser beam). */
  muzzlePosition(): Vector3 | null {
    const rig = this.rigs.get(this.activeId);
    return rig ? rig.muzzle.getAbsolutePosition().clone() : null;
  }

  /** `lastRound`: the shot emptied the weapon (the Garand throws out its clip). */
  fire(weapon: WeaponDefinition, lastRound = false): void {
    const recoil = VISUALS[weapon.id].recoil;
    this.recoil.back += recoil.back;
    this.recoil.lift += recoil.lift * (weapon.fireMode === "auto" ? 0.6 + Math.random() * 0.8 : 1);
    this.recoil.roll += (Math.random() - 0.5) * recoil.lift * 0.5;
    this.flashTimer = weapon.id === "flak88" ? 0.08 : 0.05;

    if (weapon.id === "gatling") this.gatlingSpin = GATLING_SPIN;

    const rig = this.rigs.get(weapon.id);
    if (!rig?.flash) return;
    rig.flash.rotation.z = Math.random() * Math.PI * 2;
    rig.flash.scaling.setAll(0.8 + Math.random() * 0.5);
    // The shotgun ejects its shell during the pump stroke instead.
    if (weapon.id !== "shotgun") this.ejectCasing(rig);
    if (weapon.id === "m1garand" && lastRound) this.ejectClip(rig);
  }

  /** Spent shotgun shell flying out of the ejection port during the pump stroke. */
  ejectShell(): void {
    const rig = this.rigs.get("shotgun");
    const template = rig?.find("Shell");
    const port = rig?.find("EjectPort");
    if (!rig || !template || !port) return;
    const shell = template.instantiateHierarchy(rig.root, { doNotInstantiate: true });
    if (!shell) return;
    shell.setEnabled(true);
    shell.position.copyFrom(port.position);
    const side = Math.sign(port.position.x) || 1;
    this.addDebris(
      shell,
      new Vector3(side * 1.4, 1.3, 0).addInPlace(rig.barrel.scale(-0.4)),
      new Vector3(Math.random() * 10, Math.random() * 10, 8),
    );
  }

  update(dt: number, controller: WeaponController, pointer: { x: number; y: number }, canvas: HTMLCanvasElement): void {
    this.time += dt;
    const rig = this.rigs.get(this.activeId);
    if (!rig) return;

    this.updateAim(dt, pointer, canvas, rig.visual.hold);
    this.updateRecoil(dt);
    this.updateFlash(dt, rig);
    this.updateDebris(dt);

    this.reloadBlend += ((controller.isReloading ? 1 : 0) - this.reloadBlend) * Math.min(1, dt * 10);
    const pose = this.weaponPose(rig, controller);
    const hold = rig.visual.hold;
    const sway = Math.sin(this.time * 1.3) * 0.003;
    const breathe = Math.sin(this.time * 2.1) * 0.002;
    const jitter = controller.isBeaming ? (Math.random() - 0.5) * 0.003 : 0;
    this.pivot.position.set(
      hold.x + sway + pose.x + jitter,
      hold.y + breathe + pose.y - controller.lowered * 0.45 + jitter,
      hold.z + pose.z - this.recoil.back,
    );
    this.pivot.rotation.set(
      this.aim.x - this.recoil.lift + pose.pitch + controller.lowered * 0.7,
      this.aim.y,
      this.recoil.roll + pose.roll,
    );

    this.updateGatlingSpin(dt);
    switch (rig.definition.id) {
      case "pistol":
        this.animatePistol(rig, controller);
        break;
      case "shotgun":
        this.animateShotgun(rig, controller);
        break;
      case "ak47":
        this.animateAk47(rig, controller);
        break;
      case "mp40":
        this.animateMp40(rig, controller);
        break;
      case "m1garand":
        this.animateGarand(rig, controller);
        break;
      case "gatling":
        this.animateGatling(rig);
        break;
      case "rpg7":
        this.animateRpg(rig, controller);
        break;
      case "mg42":
        this.animateMg42(rig, controller);
        break;
      case "flak88":
        this.animateFlak(rig, controller.actionProgress);
        break;
      case "laser":
        this.animateLaser(rig, controller);
        break;
      case "nuke":
        this.animateNuke(rig, controller);
        break;
    }
  }

  private weaponPose(rig: WeaponRig, controller: WeaponController): Pose {
    const reload = rig.visual.reloadPose;
    const b = this.reloadBlend;
    const pose: Pose = { x: reload.x * b, y: reload.y * b, z: reload.z * b, pitch: reload.pitch * b, roll: reload.roll * b };
    if (rig.definition.id === "nuke") {
      // The radio is raised to the face while the strike is called in.
      const p = controller.actionProgress;
      if (p !== null) {
        const raise = Math.sin(Math.PI * p);
        pose.y += 0.06 * raise;
        pose.x -= 0.04 * raise;
        pose.pitch -= 0.25 * raise;
      }
    }
    return pose;
  }

  private async loadRig(
    definition: WeaponDefinition,
    flashTexture: DynamicTexture,
    materials: Map<Material, StandardMaterial>,
  ): Promise<WeaponRig> {
    const result = await ImportMeshAsync(`${import.meta.env.BASE_URL}${definition.model}`, this.scene);
    const root = result.meshes[0];
    if (!root) throw new Error(`Empty model: ${definition.model}`);

    const nodes = new Map<string, TransformNode>();
    for (const node of [...result.meshes, ...result.transformNodes]) nodes.set(node.name, node);
    const find = (part: string): TransformNode | undefined => nodes.get(`${definition.nodePrefix}_${part}`);
    const require = (part: string): TransformNode => {
      const node = find(part);
      if (!node) throw new Error(`Missing node ${definition.nodePrefix}_${part} in ${definition.model}`);
      return node;
    };

    const glow: StandardMaterial[] = [];
    for (const mesh of result.meshes) this.prepareMesh(mesh, materials, glow);

    const body = require("Body");
    const muzzle = require("Muzzle");

    // Turn the model so its barrel points along the camera's forward axis.
    const holder = new TransformNode(`${definition.id}Holder`, this.scene);
    root.parent = holder;
    for (const node of [holder, root, ...root.getDescendants(false)]) {
      if (node instanceof TransformNode) node.computeWorldMatrix(true);
    }
    const forward = muzzle.getAbsolutePosition().subtract(body.getAbsolutePosition());
    forward.y = 0;
    forward.normalize();
    const barrel = Vector3.TransformNormal(forward, root.getWorldMatrix().clone().invert()).normalize();
    holder.rotation.y = -Math.atan2(forward.x, forward.z);
    holder.scaling.setAll(VISUALS[definition.id].scale ?? 1);
    holder.parent = this.pivot;

    const visual = VISUALS[definition.id];
    const flash = visual.flashSize > 0 ? this.createFlash(definition, flashTexture, muzzle, visual.flashSize) : null;

    const rest = new Map<TransformNode, { position: Vector3; rotation: Quaternion }>();
    for (const node of nodes.values()) {
      rest.set(node, { position: node.position.clone(), rotation: (node.rotationQuaternion ?? Quaternion.Identity()).clone() });
    }

    const shellTemplate = find("Shell");
    shellTemplate?.setEnabled(false);
    find("Case")?.setEnabled(false);
    const shellParent = shellTemplate?.parent instanceof TransformNode ? shellTemplate.parent : root;
    const loadingShell = shellTemplate?.instantiateHierarchy(shellParent, { doNotInstantiate: true }) ?? undefined;
    loadingShell?.setEnabled(false);

    return {
      definition,
      visual,
      holder,
      root,
      barrel,
      muzzle,
      flash,
      find,
      rest,
      glow,
      loadingShell,
      lastAction: null,
    };
  }

  private createFlash(definition: WeaponDefinition, texture: DynamicTexture, muzzle: TransformNode, size: number): Mesh {
    const flash = MeshBuilder.CreatePlane(`${definition.id}MuzzleFlash`, { size }, this.scene);
    const material = new StandardMaterial(`${definition.id}MuzzleFlashMaterial`, this.scene);
    material.diffuseTexture = texture;
    material.useAlphaFromDiffuseTexture = true;
    material.emissiveColor = Color3.White();
    material.disableLighting = true;
    material.backFaceCulling = false;
    flash.material = material;
    flash.parent = muzzle;
    flash.billboardMode = Mesh.BILLBOARDMODE_ALL;
    flash.renderingGroupId = VIEWMODEL_RENDERING_GROUP;
    flash.isPickable = false;
    flash.setEnabled(false);
    return flash;
  }

  private prepareMesh(mesh: AbstractMesh, materials: Map<Material, StandardMaterial>, glow: StandardMaterial[]): void {
    mesh.renderingGroupId = VIEWMODEL_RENDERING_GROUP;
    mesh.isPickable = false;
    const source = mesh.material;
    if (!source) return;
    let standard = materials.get(source);
    if (!standard) {
      standard = toStandardMaterial(source, this.scene);
      materials.set(source, standard);
      if (source.name.startsWith("Glow")) glow.push(standard);
    }
    mesh.material = standard;
  }

  private updateAim(dt: number, pointer: { x: number; y: number }, canvas: HTMLCanvasElement, hold: Vector3): void {
    const width = canvas.clientWidth || 1;
    const height = canvas.clientHeight || 1;
    const tanY = Math.tan(this.camera.fov / 2);
    const tanX = tanY * this.engine.getAspectRatio(this.camera);
    const target = new Vector3(((pointer.x / width) * 2 - 1) * tanX, (1 - (pointer.y / height) * 2) * tanY, 1)
      .scaleInPlace(AIM_DISTANCE)
      .subtractInPlace(hold);
    const pitch = -Math.atan2(target.y, Math.hypot(target.x, target.z));
    const yaw = Math.atan2(target.x, target.z);
    const response = 1 - Math.exp(-dt * AIM_RESPONSE);
    this.aim.x += (pitch - this.aim.x) * response;
    this.aim.y += (yaw - this.aim.y) * response;
  }

  private updateRecoil(dt: number): void {
    const recovery = Math.exp(-dt * RECOIL_RECOVERY);
    this.recoil.back *= recovery;
    this.recoil.lift *= recovery;
    this.recoil.roll *= recovery;
  }

  private updateFlash(dt: number, rig: WeaponRig): void {
    this.flashTimer = Math.max(0, this.flashTimer - dt);
    rig.flash?.setEnabled(this.flashTimer > 0);
  }

  private restPosition(rig: WeaponRig, node: TransformNode): Vector3 {
    return rig.rest.get(node)?.position ?? node.position;
  }

  private animateShotgun(rig: WeaponRig, controller: WeaponController): void {
    const pump = rig.find("Pump");
    if (pump) {
      const progress = controller.pumpProgress;
      const travel = progress === null ? 0 : Math.sin(Math.PI * progress) * PUMP_TRAVEL;
      pump.position.copyFrom(this.restPosition(rig, pump)).addInPlace(rig.barrel.scale(-travel));
      // The left hand holds the pump and rides along with it.
      const hand = rig.find("HandLeft");
      hand?.position.copyFrom(this.restPosition(rig, hand)).addInPlace(rig.barrel.scale(-travel));
    }

    const shell = rig.loadingShell;
    const port = rig.find("LoadPort");
    if (!shell || !port) return;
    const progress = controller.reloadProgress;
    const inserting = progress !== null && controller.currentAmmo < (rig.definition.ammo.kind === "magazine" ? rig.definition.ammo.capacity : 0) && progress < 0.9;
    shell.setEnabled(inserting);
    if (!inserting || progress === null) return;
    const start = port.position.add(new Vector3(0.04, -0.07, 0)).addInPlace(rig.barrel.scale(-0.04));
    Vector3.LerpToRef(start, port.position, smoothstep(0.1, 0.85, progress), shell.position);
  }

  /** Slide snaps back with every shot and locks open on an empty magazine until the reload releases it. */
  private animatePistol(rig: WeaponRig, controller: WeaponController): void {
    this.animateMagazine(rig, controller);
    const slide = rig.find("Slide");
    if (!slide) return;
    const reload = controller.reloadProgress;
    const lockedOpen = controller.currentAmmo === 0 && (reload === null || reload < 0.85);
    const travel = lockedOpen ? 1 : this.cycleTravel(controller.actionProgress);
    slide.position.copyFrom(this.restPosition(rig, slide)).addInPlace(rig.barrel.scale(-travel * SLIDE_TRAVEL));
  }

  /** Bolt handle cycles with every shot and is pulled once at the end of the reload. */
  private animateAk47(rig: WeaponRig, controller: WeaponController): void {
    this.animateMagazine(rig, controller);
    const bolt = rig.find("Bolt");
    if (!bolt) return;
    const reload = controller.reloadProgress;
    const charge = reload === null ? 0 : smoothstep(0.82, 0.9, reload) * (1 - smoothstep(0.92, 0.98, reload));
    const travel = Math.max(charge, this.cycleTravel(controller.actionProgress));
    bolt.position.copyFrom(this.restPosition(rig, bolt)).addInPlace(rig.barrel.scale(-travel * AK_BOLT_TRAVEL));
  }

  private animateMp40(rig: WeaponRig, controller: WeaponController): void {
    this.animateMagazine(rig, controller);
    const bolt = rig.find("Bolt");
    if (!bolt) return;
    const reload = controller.reloadProgress;
    const charge = reload === null ? 0 : smoothstep(0.82, 0.9, reload) * (1 - smoothstep(0.92, 0.98, reload));
    const travel = Math.max(charge, this.cycleTravel(controller.actionProgress));
    bolt.position.copyFrom(this.restPosition(rig, bolt)).addInPlace(rig.barrel.scale(-travel * AK_BOLT_TRAVEL));
  }

  /**
   * The operating rod cycles with every shot and stays back on an empty rifle. On reload a fresh clip is
   * pushed down into the receiver from above, then the rod slams forward.
   */
  private animateGarand(rig: WeaponRig, controller: WeaponController): void {
    const reload = controller.reloadProgress;
    const empty = controller.currentAmmo === 0;
    const rod = rig.find("OpRod");
    if (rod) {
      const lockedBack = empty && (reload === null || reload < 0.75);
      const travel = lockedBack ? 1 : this.cycleTravel(controller.actionProgress);
      rod.position.copyFrom(this.restPosition(rig, rod)).addInPlace(rig.barrel.scale(-travel * 0.07));
    }
    const clip = rig.find("Clip");
    if (!clip) return;
    clip.setEnabled(!empty || (reload !== null && reload > 0.25));
    const drop = reload === null || !empty ? 0 : 1 - smoothstep(0.3, 0.65, reload);
    clip.position.copyFrom(this.restPosition(rig, clip)).addInPlaceFromFloats(0, drop * 0.14, 0);
    const hand = rig.find("HandLeft");
    const reach = reload === null ? 0 : smoothstep(0.15, 0.3, reload) * (1 - smoothstep(0.65, 0.8, reload));
    hand?.position.copyFrom(this.restPosition(rig, hand)).addInPlaceFromFloats(0, 0.07 * reach, -0.1 * reach);
  }

  /** The empty en-bloc clip flies up out of the Garand. */
  private ejectClip(rig: WeaponRig): void {
    const template = rig.find("Clip");
    if (!template) return;
    const clip = template.instantiateHierarchy(rig.root, { doNotInstantiate: true });
    if (!clip) return;
    clip.setEnabled(true);
    clip.position.copyFrom(this.restPosition(rig, template));
    this.addDebris(clip, new Vector3(0.4, 2.6, 0).addInPlace(rig.barrel.scale(-0.5)), new Vector3(9, 4, 6), 1.1);
  }

  /** 0..1 travel of a slide or bolt through one fire interval: fast back, slower forward. */
  private cycleTravel(progress: number | null): number {
    if (progress === null) return 0;
    return progress < 0.2 ? progress / 0.2 : 1 - smoothstep(0.2, 0.7, progress);
  }

  /** The empty magazine drops out, a full one comes up from below. */
  private animateMagazine(rig: WeaponRig, controller: WeaponController): void {
    const mag = rig.find("Mag");
    if (!mag) return;
    const reload = controller.reloadProgress;
    const drop = reload === null ? 0 : reload < 0.45 ? smoothstep(0.1, 0.35, reload) : 1 - smoothstep(0.5, 0.85, reload);
    mag.setEnabled(drop < 0.98);
    mag.position.copyFrom(this.restPosition(rig, mag)).addInPlaceFromFloats(0, -drop * MAG_DROP, 0);
    // The support hand fetches the fresh magazine from below and pushes it in.
    const hand = rig.find("HandLeft");
    const reach = reload === null ? 0 : smoothstep(0.3, 0.45, reload) * (1 - smoothstep(0.5, 0.85, reload));
    hand?.position.copyFrom(this.restPosition(rig, hand)).addInPlaceFromFloats(0, -reach * MAG_DROP, 0);
  }

  /** The rocket leaves with the shot; on reload a new one is pushed into the muzzle from the front. */
  private animateRpg(rig: WeaponRig, controller: WeaponController): void {
    const rocket = rig.find("Rocket");
    if (!rocket) return;
    const reload = controller.reloadProgress;
    const loaded = controller.currentAmmo > 0;
    rocket.setEnabled(loaded || (reload !== null && reload > 0.02));
    // The recording has the rocket sliding in right at the start; the rest is cocking.
    const insert = loaded || reload === null ? 0 : 1 - smoothstep(0.05, 0.16, reload);
    const lift = loaded || reload === null ? 0 : 1 - smoothstep(0.02, 0.08, reload);
    rocket.position
      .copyFrom(this.restPosition(rig, rocket))
      .addInPlace(rig.barrel.scale(insert * 0.3))
      .addInPlaceFromFloats(0, -lift * 0.12, 0);
  }

  private updateGatlingSpin(dt: number): void {
    this.gatlingSpin *= Math.exp(-dt * GATLING_SPIN_DECAY);
    this.gatlingAngle = (this.gatlingAngle + this.gatlingSpin * dt) % (Math.PI * 2);
  }

  /** Barrel cluster spins while firing; the hand crank turns with it. */
  private animateGatling(rig: WeaponRig): void {
    const barrels = rig.find("Barrels");
    if (barrels) {
      const rest = rig.rest.get(barrels)?.rotation ?? Quaternion.Identity();
      barrels.rotationQuaternion = rest.multiply(Quaternion.RotationAxis(rig.barrel, this.gatlingAngle));
    }
    const crank = rig.find("Crank");
    if (crank) {
      const rest = rig.rest.get(crank)?.rotation ?? Quaternion.Identity();
      crank.rotationQuaternion = rest.multiply(Quaternion.RotationAxis(Vector3.Right(), this.gatlingAngle * 2));
    }
  }

  private animateMg42(rig: WeaponRig, controller: WeaponController): void {
    const cover = rig.find("Cover");
    const progress = controller.isReloading ? controller.reloadProgress : null;
    if (cover) {
      const open = progress === null ? 0 : smoothstep(0.05, 0.2, progress) * (1 - smoothstep(0.8, 0.95, progress));
      const rest = rig.rest.get(cover)?.rotation ?? Quaternion.Identity();
      cover.rotationQuaternion = rest.multiply(Quaternion.RotationAxis(Vector3.Right(), -open * COVER_OPEN_ANGLE));
    }
    // The old belt end disappears while the cover is open and a fresh one is laid in.
    rig.find("Belt")?.setEnabled(progress === null || progress < 0.3 || progress > 0.55);
  }

  /** Recoil of the barrel, breech opening, empty case thrown out and the next round rammed in. */
  private animateFlak(rig: WeaponRig, progress: number | null): void {
    const p = progress ?? 1;
    const barrel = rig.find("Barrel");
    if (barrel) {
      const recoil = p < 0.06 ? p / 0.06 : 1 - smoothstep(0.06, 0.4, p);
      barrel.position.copyFrom(this.restPosition(rig, barrel)).addInPlace(rig.barrel.scale(-recoil * FLAK_RECOIL_TRAVEL));
    }
    const breech = rig.find("Breech");
    if (breech) {
      const open = smoothstep(0.35, 0.45, p) * (1 - smoothstep(0.82, 0.9, p));
      breech.position.copyFrom(this.restPosition(rig, breech)).addInPlaceFromFloats(0, -open * FLAK_BREECH_DROP, 0);
    }

    const last = rig.lastAction;
    rig.lastAction = progress;
    if (progress !== null && (last === null || last < 0.46) && progress >= 0.46) this.ejectFlakCase(rig);

    const shell = rig.loadingShell;
    const template = rig.find("Shell");
    const port = rig.find("LoadPort");
    if (!shell || !template || !port) return;
    const loading = progress !== null && progress > 0.5 && progress < 0.84;
    shell.setEnabled(loading);
    if (!loading) return;
    // The load port is a child of the barrel; the tray position is in root space.
    const portPosition = Vector3.TransformCoordinates(port.position, (barrel ?? port).getWorldMatrix()).clone();
    const target = Vector3.TransformCoordinates(portPosition, rig.root.getWorldMatrix().clone().invert());
    Vector3.LerpToRef(this.restPosition(rig, template), target, smoothstep(0.55, 0.8, p), shell.position);
  }

  private ejectFlakCase(rig: WeaponRig): void {
    const template = rig.find("Case");
    const shell = rig.find("Shell");
    if (!template || !shell) return;
    const casing = template.instantiateHierarchy(rig.root, { doNotInstantiate: true });
    if (!casing) return;
    casing.setEnabled(true);
    // Leaves the breech where the loaded round went in, flying back past the gunner.
    casing.position.copyFrom(this.restPosition(rig, shell)).addInPlace(rig.barrel.scale(0.7));
    this.addDebris(casing, rig.barrel.scale(-3).addInPlaceFromFloats(0.4, 0.8, 0), new Vector3(0, 0, 2), 1.2);
  }

  private animateLaser(rig: WeaponRig, controller: WeaponController): void {
    const pulse = controller.isBeaming ? 0.9 + Math.random() * 0.4 : 0.35 + controller.energy * 0.55 + Math.sin(this.time * 4) * 0.05;
    for (const material of rig.glow) {
      material.emissiveColor = new Color3(0.2, 0.95, 1).scale(pulse);
    }
  }

  /** The radio's call button glows while the strike is still available. */
  private animateNuke(rig: WeaponRig, controller: WeaponController): void {
    const blink = controller.currentAmmo > 0 && Math.sin(this.time * 6) > 0 ? 1 : 0.25;
    for (const material of rig.glow) {
      if (material.name.startsWith("GlowRed")) material.emissiveColor = new Color3(1, 0.12, 0.08).scale(blink);
    }
  }


  private ejectCasing(rig: WeaponRig): void {
    const port = rig.find("EjectPort");
    if (!port) return;
    if (!this.casingTemplate) {
      const casing = MeshBuilder.CreateCylinder("casing", { height: 0.06, diameter: 0.011, tessellation: 8 }, this.scene);
      const brass = new StandardMaterial("casingBrass", this.scene);
      brass.diffuseColor = new Color3(0.85, 0.65, 0.25);
      brass.specularColor = new Color3(0.6, 0.5, 0.3);
      casing.material = brass;
      casing.renderingGroupId = VIEWMODEL_RENDERING_GROUP;
      casing.isPickable = false;
      casing.setEnabled(false);
      this.casingTemplate = casing;
    }
    const casing = this.casingTemplate.clone("casingInstance", rig.root);
    if (!casing) return;
    casing.setEnabled(true);
    casing.position.copyFrom(port.position);
    this.addDebris(
      casing,
      new Vector3(0.6 + Math.random() * 0.4, -0.6, 0).addInPlace(rig.barrel.scale(-0.2)),
      new Vector3(Math.random() * 20, 0, Math.random() * 20),
    );
  }

  private addDebris(node: TransformNode, velocity: Vector3, spin: Vector3, lifetime = DEBRIS_LIFETIME_S): void {
    // glTF nodes rotate through quaternions; clear it so the Euler spin below applies.
    node.rotationQuaternion = null;
    this.debris.push({ node, velocity, spin, age: 0, lifetime });
  }

  private updateDebris(dt: number): void {
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const piece = this.debris[i];
      if (!piece) continue;
      piece.age += dt;
      piece.velocity.y += DEBRIS_GRAVITY * dt;
      piece.node.position.addInPlace(piece.velocity.scale(dt));
      piece.node.rotation.addInPlace(piece.spin.scale(dt));
      if (piece.age > piece.lifetime) {
        piece.node.dispose();
        this.debris.splice(i, 1);
      }
    }
  }
}

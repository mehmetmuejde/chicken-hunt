import {
  Color3,
  Color4,
  DynamicTexture,
  type Mesh,
  MeshBuilder,
  ParticleSystem,
  Quaternion,
  Scene,
  StandardMaterial,
  Vector3,
} from "./babylon";

const FEATHER_LIFETIME_MS = 2200;
/** Drawn after the world with a cleared depth buffer, like the first-person weapon. */
const OVERLAY_RENDERING_GROUP = 1;

export function createFeatherTexture(scene: Scene): DynamicTexture {
  const texture = new DynamicTexture("featherTexture", { width: 64, height: 64 }, scene, false);
  const ctx = texture.getContext();
  ctx.clearRect(0, 0, 64, 64);
  ctx.fillStyle = "#ffffff";
  ctx.save();
  ctx.translate(32, 32);
  ctx.rotate(0.5);
  ctx.scale(10 / 28, 1);
  ctx.beginPath();
  ctx.arc(0, 0, 28, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  texture.hasAlpha = true;
  texture.update();
  return texture;
}

/** Soft round dot for smoke, sparks and ash. */
export function createSoftTexture(scene: Scene): DynamicTexture {
  const size = 64;
  const texture = new DynamicTexture("softTexture", { width: size, height: size }, scene, false);
  const ctx = texture.getContext();
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.5, "rgba(255,255,255,0.6)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  texture.hasAlpha = true;
  texture.update();
  return texture;
}

/** One-shot burst of feathers. The texture is shared, so it is not disposed with the particle system. */
export function spawnFeathers(scene: Scene, texture: DynamicTexture, position: Vector3): void {
  const feathers = new ParticleSystem("feathers", 40, scene);
  feathers.particleTexture = texture;
  feathers.emitter = position.clone();
  feathers.minEmitBox = new Vector3(-0.4, -0.3, -0.4);
  feathers.maxEmitBox = new Vector3(0.4, 0.3, 0.4);
  feathers.color1 = new Color4(0.62, 0.34, 0.16, 1);
  feathers.color2 = new Color4(0.92, 0.84, 0.7, 1);
  feathers.colorDead = new Color4(0.62, 0.34, 0.16, 0);
  feathers.minSize = 0.3;
  feathers.maxSize = 0.65;
  feathers.minLifeTime = 0.9;
  feathers.maxLifeTime = 1.8;
  feathers.manualEmitCount = 36;
  feathers.direction1 = new Vector3(-1, 0.6, -1);
  feathers.direction2 = new Vector3(1, 2, 1);
  feathers.minEmitPower = 1.5;
  feathers.maxEmitPower = 4.5;
  feathers.gravity = new Vector3(0, -3.5, 0);
  feathers.minAngularSpeed = -6;
  feathers.maxAngularSpeed = 6;
  feathers.blendMode = ParticleSystem.BLENDMODE_STANDARD;
  feathers.start();
  window.setTimeout(() => feathers.dispose(false), FEATHER_LIFETIME_MS);
}

/** A short-lived effect; returns false once it is finished and disposed. */
type Transient = (dt: number) => boolean;

function unlitMaterial(scene: Scene, name: string, color: Color3, alpha = 1): StandardMaterial {
  const material = new StandardMaterial(name, scene);
  material.disableLighting = true;
  material.emissiveColor = color;
  material.alpha = alpha;
  material.backFaceCulling = false;
  return material;
}

function placeBetween(mesh: Mesh, from: Vector3, to: Vector3): void {
  const direction = to.subtract(from);
  const length = direction.length();
  if (length < 1e-4) return;
  mesh.position.copyFrom(from).addInPlace(direction.scale(0.5));
  mesh.scaling.y = length;
  mesh.rotationQuaternion ??= new Quaternion();
  Quaternion.FromUnitVectorsToRef(Vector3.Up(), direction.scaleInPlace(1 / length), mesh.rotationQuaternion);
}

/** Flak tracers and bursts, the laser beam and smoke — everything that lives for a moment in the world. */
export class Effects {
  private readonly transients: Transient[] = [];
  private readonly beamCore: Mesh;
  private readonly beamGlow: Mesh;
  private readonly beamSparks: ParticleSystem;
  private beamTime = 0;

  constructor(
    private readonly scene: Scene,
    private readonly softTexture: DynamicTexture,
  ) {
    // Unit-length cylinders along Y, stretched between muzzle and target every frame.
    // The far end is wider so the beam keeps a visible thickness in the distance.
    this.beamCore = MeshBuilder.CreateCylinder("laserCore", { height: 1, diameterBottom: 0.006, diameterTop: 0.25, tessellation: 8 }, scene);
    this.beamCore.material = unlitMaterial(scene, "laserCoreMaterial", new Color3(0.85, 1, 1));
    this.beamGlow = MeshBuilder.CreateCylinder("laserGlow", { height: 1, diameterBottom: 0.02, diameterTop: 1.1, tessellation: 12 }, scene);
    this.beamGlow.material = unlitMaterial(scene, "laserGlowMaterial", new Color3(0.1, 0.9, 1), 0.35);
    for (const mesh of [this.beamCore, this.beamGlow]) {
      mesh.renderingGroupId = OVERLAY_RENDERING_GROUP;
      mesh.isPickable = false;
      mesh.setEnabled(false);
    }

    this.beamSparks = new ParticleSystem("laserSparks", 200, scene);
    this.beamSparks.particleTexture = softTexture;
    this.beamSparks.emitter = Vector3.Zero();
    this.beamSparks.color1 = new Color4(0.7, 1, 1, 1);
    this.beamSparks.color2 = new Color4(1, 0.8, 0.3, 1);
    this.beamSparks.colorDead = new Color4(1, 0.3, 0, 0);
    this.beamSparks.minSize = 0.2;
    this.beamSparks.maxSize = 0.6;
    this.beamSparks.minLifeTime = 0.15;
    this.beamSparks.maxLifeTime = 0.4;
    this.beamSparks.emitRate = 160;
    this.beamSparks.direction1 = new Vector3(-3, 2, -3);
    this.beamSparks.direction2 = new Vector3(3, 5, 3);
    this.beamSparks.gravity = new Vector3(0, -12, 0);
    this.beamSparks.blendMode = ParticleSystem.BLENDMODE_ADD;
  }

  update(dt: number): void {
    for (let i = this.transients.length - 1; i >= 0; i--) {
      const alive = this.transients[i]?.(dt) ?? false;
      if (!alive) this.transients.splice(i, 1);
    }
  }

  /** Shows the laser beam from `from` to `to`, or hides it when `from` is null. */
  setBeam(from: Vector3 | null, to: Vector3, dt: number): void {
    const active = from !== null;
    this.beamCore.setEnabled(active);
    this.beamGlow.setEnabled(active);
    if (!active) {
      if (this.beamSparks.isStarted()) this.beamSparks.stop();
      return;
    }
    this.beamTime += dt;
    placeBetween(this.beamCore, from, to);
    placeBetween(this.beamGlow, from, to);
    const flicker = 0.85 + Math.sin(this.beamTime * 60) * 0.1 + Math.random() * 0.1;
    this.beamGlow.scaling.x = flicker;
    this.beamGlow.scaling.z = flicker;
    this.beamSparks.emitter = to.clone();
    if (!this.beamSparks.isStarted()) this.beamSparks.start();
  }

  /** Glowing shell flying from the muzzle to the burst point; calls `onArrive` when it gets there. */
  flakTracer(from: Vector3, to: Vector3, duration: number, onArrive: () => void): void {
    const tracer = MeshBuilder.CreateCylinder("flakTracer", { height: 1, diameter: 0.25, tessellation: 6 }, this.scene);
    tracer.material = unlitMaterial(this.scene, "flakTracerMaterial", new Color3(1, 0.75, 0.3));
    tracer.isPickable = false;
    let elapsed = 0;
    this.transients.push((dt) => {
      elapsed += dt;
      const t = Math.min(1, elapsed / duration);
      const head = Vector3.Lerp(from, to, t);
      const tail = Vector3.Lerp(from, to, Math.max(0, t - 0.25));
      placeBetween(tracer, tail, head);
      if (t < 1) return true;
      tracer.material?.dispose();
      tracer.dispose();
      onArrive();
      return false;
    });
  }

  /** Airburst: a bright flash, a black smoke ball and hot fragments. */
  flakBurst(position: Vector3, radius: number): void {
    const flash = MeshBuilder.CreateSphere("flakFlash", { diameter: 1, segments: 8 }, this.scene);
    const flashMaterial = unlitMaterial(this.scene, "flakFlashMaterial", new Color3(1, 0.85, 0.5));
    flash.material = flashMaterial;
    flash.position.copyFrom(position);
    flash.isPickable = false;

    const smoke = new ParticleSystem("flakSmoke", 40, this.scene);
    smoke.particleTexture = this.softTexture;
    smoke.emitter = position.clone();
    smoke.minEmitBox = new Vector3(-radius * 0.2, -radius * 0.2, -radius * 0.2);
    smoke.maxEmitBox = new Vector3(radius * 0.2, radius * 0.2, radius * 0.2);
    smoke.color1 = new Color4(0.08, 0.07, 0.07, 0.95);
    smoke.color2 = new Color4(0.2, 0.18, 0.16, 0.9);
    smoke.colorDead = new Color4(0.25, 0.24, 0.22, 0);
    smoke.minSize = radius * 0.5;
    smoke.maxSize = radius * 1.1;
    smoke.minLifeTime = 2;
    smoke.maxLifeTime = 3.2;
    smoke.manualEmitCount = 30;
    smoke.direction1 = new Vector3(-1, -0.2, -1);
    smoke.direction2 = new Vector3(1, 1, 1);
    smoke.minEmitPower = 1;
    smoke.maxEmitPower = radius * 0.3;
    smoke.addSizeGradient(0, 0.5);
    smoke.addSizeGradient(1, 1.6);
    smoke.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    smoke.start();

    const fragments = new ParticleSystem("flakFragments", 120, this.scene);
    fragments.particleTexture = this.softTexture;
    fragments.emitter = position.clone();
    fragments.color1 = new Color4(1, 0.8, 0.3, 1);
    fragments.color2 = new Color4(1, 0.4, 0.1, 1);
    fragments.colorDead = new Color4(0.2, 0.1, 0, 0);
    fragments.minSize = 0.4;
    fragments.maxSize = 1;
    fragments.minLifeTime = 0.3;
    fragments.maxLifeTime = 0.8;
    fragments.manualEmitCount = 90;
    fragments.direction1 = new Vector3(-1, -1, -1);
    fragments.direction2 = new Vector3(1, 1, 1);
    fragments.minEmitPower = radius * 1.2;
    fragments.maxEmitPower = radius * 2.4;
    fragments.gravity = new Vector3(0, -9, 0);
    fragments.blendMode = ParticleSystem.BLENDMODE_ADD;
    fragments.start();

    let elapsed = 0;
    this.transients.push((dt) => {
      elapsed += dt;
      const flashT = Math.min(1, elapsed / 0.18);
      flash.scaling.setAll(radius * (0.6 + flashT));
      flashMaterial.alpha = 1 - flashT;
      flash.setEnabled(flashT < 1);

      if (elapsed < 3.5) return true;

      flash.dispose();
      flashMaterial.dispose();
      smoke.dispose(false);
      fragments.dispose(false);
      return false;
    });
  }

  /** Small puff of smoke, e.g. from a chicken roasted by the laser. */
  smokePuff(position: Vector3): void {
    const puff = new ParticleSystem("smokePuff", 30, this.scene);
    puff.particleTexture = this.softTexture;
    puff.emitter = position.clone();
    puff.color1 = new Color4(0.3, 0.28, 0.25, 0.8);
    puff.color2 = new Color4(0.15, 0.14, 0.12, 0.8);
    puff.colorDead = new Color4(0.1, 0.1, 0.1, 0);
    puff.minSize = 1;
    puff.maxSize = 2.5;
    puff.minLifeTime = 0.8;
    puff.maxLifeTime = 1.6;
    puff.manualEmitCount = 24;
    puff.direction1 = new Vector3(-0.5, 1, -0.5);
    puff.direction2 = new Vector3(0.5, 2, 0.5);
    puff.minEmitPower = 1;
    puff.maxEmitPower = 2.5;
    puff.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    puff.start();
    let elapsed = 0;
    this.transients.push((dt) => {
      elapsed += dt;
      if (elapsed < 2) return true;
      puff.dispose(false);
      return false;
    });
  }
}

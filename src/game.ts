import { type AbstractMesh, type DynamicTexture, type Engine, Matrix, type Ray, Scene, UniversalCamera, Vector3 } from "./babylon";
import type { Sfx } from "./audio";
import { Chicken, type ChickenPalette, createChickenPalette, createRandomSpawn, type HitKind } from "./chicken";
import {
  CAMERA_FOV,
  CAMERA_HEIGHT,
  CAMERA_PAN_SPEED,
  CAMERA_PITCH,
  CAMERA_YAW_LIMIT,
  GAME_DURATION_S,
  PAN_EDGE,
  SPAWN_INTERVAL_S,
} from "./config";
import { createFeatherTexture, createSoftTexture, Effects, spawnFeathers } from "./effects";
import type { Hud } from "./hud";
import { NuclearStrike } from "./nuke";
import { randomRange } from "./random";
import { loadBirdCount, loadHighscore, saveBirdCount, saveHighscore } from "./storage";
import { Viewmodel } from "./viewmodel";
import { WeaponController } from "./weapon-controller";
import {
  FLAK_BURST_RADIUS,
  FLAK_FUSE_DISTANCE,
  FLAK_SHELL_SPEED,
  LASER_RANGE,
  NUKE_MAX_DISTANCE,
  type WeaponDefinition,
} from "./weapons";
import { createWorld, setDevastated, terrainHeight, updateWorld, type World } from "./world";

type Phase = "menu" | "playing" | "over";

const MAX_FRAME_TIME_S = 0.05;
const CAMERA_BASE = new Vector3(0, CAMERA_HEIGHT, 0);
/** Spawn interval of the base settings is tuned for this many birds; more birds spawn faster. */
const REFERENCE_BIRD_COUNT = 10;
/** Part of the throw motion after which the bomb leaves the hand. */
const THROW_RELEASE = 0.3;
const GEIGER_TICKS_PER_SECOND = 7;

export class Game {
  readonly scene: Scene;
  private readonly camera: UniversalCamera;
  private readonly world: World;
  private readonly palette: ChickenPalette;
  private readonly featherTexture: DynamicTexture;
  private readonly effects: Effects;
  private readonly chickens: Chicken[] = [];
  private readonly chickenByHitbox = new Map<AbstractMesh, Chicken>();
  private readonly weapons: WeaponController;
  private viewmodel: Viewmodel | null = null;
  private nuke: NuclearStrike | null = null;

  private phase: Phase = "menu";
  private score = 0;
  private timeLeft = GAME_DURATION_S;
  private spawnTimer = 0;
  private maxChickens = loadBirdCount();
  private yaw = 0;
  private shake = 0;
  /** Long, slowly fading shake after the atomic bomb. */
  private rumble = 0;
  private elapsed = 0;
  private pendingThrow: number | null = null;
  private pointer = { x: 0, y: 0 };

  constructor(
    private readonly engine: Engine,
    private readonly canvas: HTMLCanvasElement,
    private readonly hud: Hud,
    private readonly sfx: Sfx,
  ) {
    this.scene = new Scene(engine);
    this.camera = new UniversalCamera("camera", CAMERA_BASE.clone(), this.scene);
    this.camera.inputs.clear();
    this.camera.fov = CAMERA_FOV;
    this.camera.minZ = 0.05;
    this.camera.maxZ = 2000;
    this.camera.rotation.set(CAMERA_PITCH, 0, 0);

    const softTexture = createSoftTexture(this.scene);
    this.world = createWorld(this.scene, softTexture);
    this.palette = createChickenPalette(this.scene);
    this.featherTexture = createFeatherTexture(this.scene);
    this.effects = new Effects(this.scene, softTexture);
    this.pointer = { x: canvas.clientWidth / 2, y: canvas.clientHeight / 2 };
    this.weapons = new WeaponController({
      shot: (weapon) => this.onShot(weapon),
      thrown: () => {
        this.pendingThrow = 0;
        this.sfx.nukeThrow();
      },
      beamChanged: (active) => (active ? this.sfx.laserStart() : this.sfx.laserStop()),
      dryFire: () => this.sfx.empty(),
      pump: () => {
        this.sfx.pump();
        this.viewmodel?.ejectShell();
      },
      shellInserted: () => this.sfx.shellInsert(),
      reloadStarted: (weapon) => {
        if (weapon.id === "mg42") this.sfx.coverOpen();
      },
      reloadFinished: (weapon) => {
        if (weapon.id === "mg42") this.sfx.coverClose();
      },
      switched: (weapon) => {
        this.sfx.switchWeapon();
        this.viewmodel?.show(weapon.id);
        this.hud.setWeapon(weapon.id);
      },
    });

    this.bindInput();
    this.hud.bindBirdCount(this.maxChickens, (count) => {
      this.maxChickens = count;
      saveBirdCount(count);
    });
    this.scene.onBeforeRenderObservable.add(() => {
      this.update(Math.min(this.engine.getDeltaTime() / 1000, MAX_FRAME_TIME_S));
    });
    this.hud.showStart(loadHighscore());
    this.loadModels();
  }

  render(): void {
    this.scene.render();
  }

  start(): void {
    this.sfx.unlock();
    this.phase = "playing";
    this.score = 0;
    this.timeLeft = GAME_DURATION_S;
    this.pendingThrow = null;
    this.rumble = 0;
    this.weapons.reset();
    this.nuke?.reset();
    setDevastated(this.world, this.scene, false);
    this.clearChickens();
    this.hud.setScore(0);
    this.hud.setTime(this.timeLeft);
    this.hud.setWeapon(this.weapons.weapon.id);
    this.hud.moveCrosshair(this.pointer.x, this.pointer.y);
    this.hud.showPlaying();
  }

  private loadModels(): void {
    this.hud.setLoading(true);
    Promise.all([
      Viewmodel.load(this.scene, this.engine, this.camera).then((viewmodel) => {
        this.viewmodel = viewmodel;
        viewmodel.show(this.weapons.weapon.id);
      }),
      NuclearStrike.load(this.scene).then((nuke) => {
        this.nuke = nuke;
      }),
    ])
      .catch((error: unknown) => {
        // The game stays playable without the 3D models.
        console.error("Could not load the 3D models", error);
      })
      .finally(() => this.hud.setLoading(false));
  }

  private end(): void {
    this.phase = "over";
    this.weapons.releaseTrigger();
    this.weapons.update(0);
    const best = loadHighscore();
    const isNewBest = this.score > best;
    if (isNewBest) saveHighscore(this.score);
    this.sfx.timeUp();
    this.hud.showEnd(this.score, Math.max(best, this.score), isNewBest);
  }

  private bindInput(): void {
    this.canvas.addEventListener("pointermove", (event) => {
      const rect = this.canvas.getBoundingClientRect();
      this.pointer = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      this.hud.moveCrosshair(this.pointer.x, this.pointer.y);
    });
    this.canvas.addEventListener("pointerdown", (event) => {
      if (this.phase !== "playing") return;
      if (event.button === 0) this.weapons.pressTrigger();
      if (event.button === 2) this.weapons.requestReload();
    });
    const release = (): void => this.weapons.releaseTrigger();
    this.canvas.addEventListener("pointerup", (event) => {
      if (event.button === 0) release();
    });
    this.canvas.addEventListener("pointerleave", release);
    window.addEventListener("blur", release);
    this.canvas.addEventListener("contextmenu", (event) => event.preventDefault());
    this.canvas.addEventListener(
      "wheel",
      (event) => {
        if (this.phase === "playing" && event.deltaY !== 0) this.weapons.cycle(event.deltaY > 0 ? 1 : -1);
      },
      { passive: true },
    );
    const weaponKeys = { Digit1: "shotgun", Digit2: "mg42", Digit3: "flak88", Digit4: "laser", Digit5: "nuke" } as const;
    window.addEventListener("keydown", (event) => {
      if (this.phase !== "playing") return;
      if (event.code === "Space" || event.code === "KeyR") {
        event.preventDefault();
        this.weapons.requestReload();
        return;
      }
      if (event.code in weaponKeys) this.weapons.switchTo(weaponKeys[event.code as keyof typeof weaponKeys]);
    });
    this.hud.startButton.addEventListener("click", () => this.start());
    this.hud.restartButton.addEventListener("click", () => this.start());
  }

  private onShot(weapon: WeaponDefinition): void {
    this.viewmodel?.fire(weapon);
    const aim = this.spreadAim(weapon.spread);

    if (weapon.id === "flak88") {
      this.shake = Math.max(this.shake, 1.6);
      this.sfx.flakShot();
      window.setTimeout(() => this.sfx.flakLoad(), 900);
      this.fireFlak(aim);
      return;
    }

    this.shake = Math.max(this.shake, weapon.fireMode === "auto" ? 0.35 : 1);
    if (weapon.fireMode === "auto") this.sfx.mgShot();
    else this.sfx.shot();
    this.hud.shotFlash(aim.x, aim.y);

    const chicken = this.pickChicken(aim.x, aim.y);
    if (chicken) this.kill(chicken, "shot", aim);
  }

  private fireFlak(aim: { x: number; y: number }): void {
    const ray = this.rayThrough(aim);
    const pick = this.scene.pickWithRay(ray, (mesh) => mesh.isPickable && this.chickenByHitbox.has(mesh));
    const distance = Math.min(pick?.hit ? pick.distance : FLAK_FUSE_DISTANCE, this.groundDistance(ray, FLAK_FUSE_DISTANCE));
    const burst = ray.origin.add(ray.direction.scale(distance));
    const muzzle = this.viewmodel?.muzzlePosition() ?? this.camera.position.clone();
    this.effects.flakTracer(muzzle, burst, distance / FLAK_SHELL_SPEED, () => {
      this.effects.flakBurst(burst, FLAK_BURST_RADIUS);
      this.sfx.flakBurst(distance);
      for (const chicken of this.chickens) {
        const offset = chicken.position.subtract(burst);
        if (chicken.state === "flying" && offset.length() <= FLAK_BURST_RADIUS) {
          this.kill(chicken, "blast", this.project(chicken.position), offset.normalize());
        }
      }
    });
  }

  private updateLaser(dt: number): void {
    if (!this.weapons.isBeaming) {
      this.effects.setBeam(null, Vector3.Zero(), dt);
      return;
    }
    const ray = this.rayThrough(this.pointer);
    const pick = this.scene.pickWithRay(ray, (mesh) => mesh.isPickable && this.chickenByHitbox.has(mesh));
    const chicken = pick?.pickedMesh ? this.chickenByHitbox.get(pick.pickedMesh) : undefined;
    const distance = Math.min(pick?.hit ? pick.distance : LASER_RANGE, this.groundDistance(ray, LASER_RANGE));
    const end = ray.origin.add(ray.direction.scale(distance));
    this.effects.setBeam(this.viewmodel?.muzzlePosition() ?? this.camera.position, end, dt);
    if (chicken) {
      this.kill(chicken, "burn", this.pointer);
      this.effects.smokePuff(chicken.position);
      this.sfx.sizzle();
    }
  }

  private throwBomb(): void {
    const ray = this.rayThrough(this.pointer);
    let distance = this.groundDistance(ray, NUKE_MAX_DISTANCE);
    if (distance >= NUKE_MAX_DISTANCE) distance = NUKE_MAX_DISTANCE * 0.8;
    const aimPoint = ray.origin.add(ray.direction.scale(distance));
    const target = new Vector3(aimPoint.x, terrainHeight(aimPoint.x, aimPoint.z), aimPoint.z);
    const from = this.viewmodel?.muzzlePosition() ?? this.camera.position.clone();
    this.nuke?.launch(from, target, {
      impact: () => {
        this.sfx.nukeBlast();
        this.hud.nukeFlash();
        this.shake = 3;
        this.rumble = 1;
      },
      devastate: (position) => {
        setDevastated(this.world, this.scene, true);
        for (const chicken of this.chickens) {
          if (chicken.state !== "flying") continue;
          const away = chicken.position.subtract(position).normalize();
          this.kill(chicken, "blast", this.project(chicken.position), away);
        }
      },
    });
  }

  private kill(chicken: Chicken, kind: HitKind, at: { x: number; y: number } | null, push?: Vector3): void {
    if (chicken.state !== "flying") return;
    chicken.hit(kind, push);
    this.score += chicken.points;
    this.hud.setScore(this.score);
    if (at) this.hud.popup(`+${chicken.points}`, at.x, at.y);
    if (kind !== "burn") spawnFeathers(this.scene, this.featherTexture, chicken.position);
    if (kind === "shot") this.sfx.squawk();
  }

  private pickChicken(x: number, y: number): Chicken | undefined {
    const pick = this.scene.pick(x, y, (mesh) => mesh.isPickable && this.chickenByHitbox.has(mesh));
    return pick.pickedMesh ? this.chickenByHitbox.get(pick.pickedMesh) : undefined;
  }

  private rayThrough(point: { x: number; y: number }): Ray {
    return this.scene.createPickingRay(point.x, point.y, Matrix.Identity(), this.camera);
  }

  /** Distance along the ray to the terrain, or `max` when it does not hit within that range. */
  private groundDistance(ray: Ray, max: number): number {
    for (let distance = 2; distance < max; distance += 2) {
      const x = ray.origin.x + ray.direction.x * distance;
      const y = ray.origin.y + ray.direction.y * distance;
      const z = ray.origin.z + ray.direction.z * distance;
      if (y <= terrainHeight(x, z)) return distance;
    }
    return max;
  }

  /** Screen position (CSS pixels) of a world point, or null when it is behind the camera. */
  private project(point: Vector3): { x: number; y: number } | null {
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    const projected = Vector3.Project(point, Matrix.IdentityReadOnly, this.scene.getTransformMatrix(), this.camera.viewport.toGlobal(width, height));
    if (projected.z < 0 || projected.z > 1) return null;
    return { x: projected.x, y: projected.y };
  }

  /** Crosshair position plus a random deviation of up to `spread` radians. */
  private spreadAim(spread: number): { x: number; y: number } {
    if (spread === 0) return this.pointer;
    const pixelsPerRadian = this.canvas.clientHeight / 2 / Math.tan(this.camera.fov / 2);
    const angle = Math.random() * Math.PI * 2;
    const distance = Math.sqrt(Math.random()) * spread * pixelsPerRadian;
    return { x: this.pointer.x + Math.cos(angle) * distance, y: this.pointer.y + Math.sin(angle) * distance };
  }

  private update(dt: number): void {
    this.elapsed += dt;
    updateWorld(this.world, dt);
    this.updateCamera(dt);
    this.updateChickens(dt);
    this.effects.update(dt);
    this.nuke?.update(dt);

    if (this.phase === "playing") {
      this.weapons.update(dt);
      this.updateLaser(dt);
      this.updateThrow(dt);
      this.hud.setAmmo(this.weapons.ammoStatus());
      this.timeLeft -= dt;
      this.hud.setTime(this.timeLeft);
      if (this.timeLeft <= 0) this.end();
    } else {
      this.effects.setBeam(null, Vector3.Zero(), dt);
    }
    if (this.world.devastated && Math.random() < GEIGER_TICKS_PER_SECOND * dt) this.sfx.geigerTick();

    this.viewmodel?.setVisible(this.phase === "playing");
    this.viewmodel?.update(dt, this.weapons, this.pointer, this.canvas);
  }

  private updateThrow(dt: number): void {
    if (this.pendingThrow === null) return;
    this.pendingThrow += dt;
    const releaseAt = this.weapons.weapon.fireInterval * THROW_RELEASE;
    if (this.pendingThrow < releaseAt) return;
    this.pendingThrow = null;
    this.throwBomb();
  }

  private updateCamera(dt: number): void {
    if (this.phase === "playing") {
      const width = this.canvas.clientWidth;
      const nx = width > 0 ? this.pointer.x / width : 0.5;
      let panInput = 0;
      if (nx < PAN_EDGE) panInput = -(PAN_EDGE - nx) / PAN_EDGE;
      else if (nx > 1 - PAN_EDGE) panInput = (nx - (1 - PAN_EDGE)) / PAN_EDGE;
      this.yaw += panInput * CAMERA_PAN_SPEED * dt;
    } else {
      this.yaw += (Math.sin(this.elapsed * 0.15) * 0.4 - this.yaw) * Math.min(1, dt * 2);
    }
    this.yaw = Math.max(-CAMERA_YAW_LIMIT, Math.min(CAMERA_YAW_LIMIT, this.yaw));

    this.shake = Math.max(0, this.shake - dt * 8);
    this.rumble = Math.max(0, this.rumble - dt * 0.15);
    const kick = this.shake * this.shake + this.rumble * 0.6;
    this.camera.position.set(
      CAMERA_BASE.x + (Math.random() - 0.5) * kick * 0.12,
      CAMERA_BASE.y + (Math.random() - 0.5) * kick * 0.12,
      CAMERA_BASE.z,
    );
    this.camera.rotation.set(CAMERA_PITCH - kick * 0.02, this.yaw, (Math.random() - 0.5) * this.rumble * 0.01);
  }

  /** A new round starts with an empty sky (and no leftover irradiated chickens). */
  private clearChickens(): void {
    for (const chicken of this.chickens) chicken.dispose();
    this.chickens.length = 0;
    this.chickenByHitbox.clear();
  }

  private updateChickens(dt: number): void {
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0 && this.chickens.length < this.maxChickens) {
      const chicken = new Chicken(this.scene, this.palette, createRandomSpawn(), this.world.devastated);
      this.chickens.push(chicken);
      this.chickenByHitbox.set(chicken.hitbox, chicken);
      const density = REFERENCE_BIRD_COUNT / this.maxChickens;
      this.spawnTimer = randomRange(SPAWN_INTERVAL_S.min, SPAWN_INTERVAL_S.max) * density;
    }

    for (let i = this.chickens.length - 1; i >= 0; i--) {
      const chicken = this.chickens[i];
      chicken.update(dt);
      if (chicken.state === "gone") {
        this.chickenByHitbox.delete(chicken.hitbox);
        chicken.dispose();
        this.chickens.splice(i, 1);
      }
    }
  }
}

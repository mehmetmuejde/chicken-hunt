import { type AbstractMesh, type DynamicTexture, type Engine, Matrix, type Ray, Scene, UniversalCamera, Vector3 } from "./babylon";
import { Atmosphere, type AtmosphereSettings, randomAtmosphere } from "./atmosphere";
import type { Sfx } from "./audio";
import {
  Chicken,
  type ChickenPalette,
  type ChickenVariant,
  createChickenPalette,
  createRandomSpawn,
  type HitKind,
  VARIANT_CHANCES,
} from "./chicken";
import { Combo } from "./combo";
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
import { EasterEggs, type EasterEgg } from "./eastereggs";
import { createFeatherTexture, createSoftTexture, Effects, spawnFeathers } from "./effects";
import type { Hud } from "./hud";
import { NuclearStrike, SHOCKWAVE_SPEED } from "./nuke";
import { randomRange } from "./random";
import {
  type AtmosphereChoice,
  loadAtmosphereChoice,
  loadSceneryChoice,
  loadBirdCount,
  loadHighscore,
  saveAtmosphereChoice,
  saveSceneryChoice,
  saveBirdCount,
  saveHighscore,
} from "./storage";
import { Viewmodel } from "./viewmodel";
import { WeaponController } from "./weapon-controller";
import {
  FLAK_BURST_RADIUS,
  FLAK_FUSE_DISTANCE,
  FLAK_SHELL_SPEED,
  LASER_RANGE,
  NUKE_FALL_TIME_S,
  NUKE_MAX_DISTANCE,
  ROCKET_BLAST_RADIUS,
  ROCKET_PROXIMITY,
  ROCKET_RANGE,
  ROCKET_SPEED,
  WEAPON_KEYS,
  WEAPON_ORDER,
  type WeaponDefinition,
} from "./weapons";
import { SCENERY_IDS, type SceneryId } from "./scenery";
import { createWorld, setDevastated, setScenery, terrainHeight, updateWorld, type World } from "./world";

type Phase = "menu" | "playing" | "over";

const MAX_FRAME_TIME_S = 0.05;
const CAMERA_BASE = new Vector3(0, CAMERA_HEIGHT, 0);
/** Spawn interval of the base settings is tuned for this many birds; more birds spawn faster. */
const REFERENCE_BIRD_COUNT = 10;
/** Part of the throw motion after which the bomb leaves the hand. */
const THROW_RELEASE = 0.3;
const GEIGER_TICKS_PER_SECOND = 7;
const CRICKET_CHIRPS_PER_SECOND = 0.6;

/** Damage per hit; the boss has 14 health, armoured chickens 2, everything else 1. */
const SHOT_DAMAGE = 1;
const FLAK_DAMAGE = 5;
const ROCKET_DAMAGE = 8;
const LASER_DAMAGE_PER_SECOND = 10;
/** The chicken king appears once per round when this much time is left. */
const BOSS_AT_TIME_LEFT_S = 45;
const GOLDEN_TIME_BONUS_S = 5;
const CLOCK_TIME_BONUS_S = 3;
const BOMB_CHICKEN_BLAST_RADIUS = 9;

type Target = { chicken: Chicken } | { egg: AbstractMesh } | null;

export class Game {
  readonly scene: Scene;
  private readonly camera: UniversalCamera;
  private readonly world: World;
  private readonly atmosphere: Atmosphere;
  private readonly palette: ChickenPalette;
  private readonly featherTexture: DynamicTexture;
  private readonly effects: Effects;
  private eggs: EasterEggs;
  private readonly combo = new Combo();
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
  private atmosphereChoice = loadAtmosphereChoice();
  private sceneryChoice = loadSceneryChoice();
  private bossSpawned = false;
  private boss: Chicken | null = null;
  private yaw = 0;
  private shake = 0;
  /** Long, slowly fading shake after the atomic bomb. */
  private rumble = 0;
  private elapsed = 0;
  private pendingThrow: number | null = null;
  /** Seconds until the shock wave of the atomic bomb reaches the player. */
  private shockwaveIn: number | null = null;
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
    this.world = createWorld(this.scene, softTexture, this.pickScenery());
    this.atmosphere = new Atmosphere(this.scene, this.world, softTexture);
    this.palette = createChickenPalette(this.scene);
    this.featherTexture = createFeatherTexture(this.scene);
    this.effects = new Effects(this.scene, softTexture);
    this.eggs = this.createEggs();
    this.pointer = { x: canvas.clientWidth / 2, y: canvas.clientHeight / 2 };
    this.weapons = new WeaponController({
      shot: (weapon) => this.onShot(weapon),
      thrown: () => {
        this.pendingThrow = 0;
        this.sfx.radioCall();
      },
      beamChanged: (active) => (active ? this.sfx.laserStart() : this.sfx.laserStop()),
      dryFire: () => this.sfx.empty(),
      pump: () => {
        this.sfx.pump();
        this.sfx.casingDrop("shell");
        this.viewmodel?.ejectShell();
      },
      shellInserted: () => this.sfx.shellInsert(),
      reloadStarted: (weapon) => {
        if (weapon.ammo.kind === "magazine" && weapon.ammo.reload.kind !== "shells") {
          this.sfx.reload(weapon.id, weapon.ammo.reload.duration);
        }
      },
      reloadFinished: () => undefined,
      switched: (weapon) => {
        this.sfx.cancelReload();
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
    this.hud.bindScenery(this.sceneryChoice, (choice) => {
      this.sceneryChoice = choice;
      saveSceneryChoice(choice);
      // Show the chosen scenery right away behind the menu.
      if (choice !== "random") this.changeScenery(choice);
    });
    this.hud.bindAtmosphere(this.atmosphereChoice, (choice) => {
      this.atmosphereChoice = choice;
      saveAtmosphereChoice(choice);
      this.applyAtmosphere();
    });
    this.applyAtmosphere();
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
    this.shockwaveIn = null;
    this.hud.clearCracks();
    this.rumble = 0;
    this.bossSpawned = false;
    this.boss = null;
    this.combo.break();
    this.weapons.reset();
    this.nuke?.reset();
    this.changeScenery(this.pickScenery());
    setDevastated(this.world, false);
    this.eggs.reset();
    this.clearChickens();
    this.applyAtmosphere();
    this.hud.setScore(0);
    this.hud.setTime(this.timeLeft);
    this.hud.setWeapon(this.weapons.weapon.id);
    this.hud.moveCrosshair(this.pointer.x, this.pointer.y);
    this.hud.showPlaying();
  }

  /** The chosen scenery, or a different one than now when the choice is "random". */
  private pickScenery(): SceneryId {
    if (this.sceneryChoice !== "random") return this.sceneryChoice;
    const others = SCENERY_IDS.filter((id) => id !== this.world?.scenery);
    return others[Math.floor(Math.random() * others.length)] ?? "farm";
  }

  private changeScenery(scenery: SceneryId): void {
    if (scenery === this.world.scenery) return;
    this.clearChickens();
    setScenery(this.world, scenery);
    this.eggs = this.createEggs();
    this.applyAtmosphere();
  }

  private createEggs(): EasterEggs {
    return new EasterEggs(this.scene, this.world, {
      sound: (kind) => {
        if (kind === "moo") this.sfx.moo();
        else if (kind === "creak") this.sfx.creak();
        else this.sfx.whoosh();
      },
      spawnChicken: (position) => this.spawnEscapee(position),
      explode: (position) => {
        this.effects.flakBurst(position, 14);
        this.sfx.flakBurst(60);
      },
    });
  }

  /** Resolves "random" choices and applies time of day and weather, including the ambient sound. */
  private applyAtmosphere(): void {
    const random = randomAtmosphere();
    const choice: AtmosphereChoice = this.atmosphereChoice;
    const settings: AtmosphereSettings = {
      time: choice.time === "random" ? random.time : choice.time,
      weather: choice.weather === "random" ? random.weather : choice.weather,
    };
    this.atmosphere.apply(settings);
    this.updateWeatherSound();
  }

  private updateWeatherSound(): void {
    const weather = this.atmosphere.current.weather;
    const sound = this.phase !== "playing" ? null : weather === "rain" ? "rain" : weather === "clear" ? null : "wind";
    this.sfx.setWeatherSound(sound);
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
    this.updateWeatherSound();
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
    window.addEventListener("keydown", (event) => {
      if (this.phase !== "playing") return;
      if (event.code === "Space" || event.code === "KeyR") {
        event.preventDefault();
        this.weapons.requestReload();
        return;
      }
      const weapon = WEAPON_ORDER[WEAPON_KEYS.indexOf(event.code)];
      if (weapon) this.weapons.switchTo(weapon);
    });
    this.hud.startButton.addEventListener("click", () => this.start());
    this.hud.restartButton.addEventListener("click", () => this.start());
  }

  // ---------------------------------------------------------------------------------------------
  // Shooting
  // ---------------------------------------------------------------------------------------------

  private onShot(weapon: WeaponDefinition): void {
    const lastRound = this.weapons.currentAmmo === 0;
    this.viewmodel?.fire(weapon, lastRound);
    if (weapon.id === "m1garand" && lastRound) this.sfx.garandPing();
    const aim = this.spreadAim(weapon.spread);

    if (weapon.id === "flak88") {
      this.shake = Math.max(this.shake, 1.6);
      this.sfx.flakShot();
      window.setTimeout(() => this.sfx.flakLoad(), 900);
      this.fireFlak(aim);
      return;
    }

    if (weapon.id === "rpg7") {
      this.shake = Math.max(this.shake, 1.3);
      this.sfx.rocketLaunch();
      this.fireRocket(aim);
      return;
    }

    this.shake = Math.max(this.shake, weapon.fireMode === "auto" ? 0.35 : 1);
    this.sfx.gunshot(weapon.id);
    // The shotgun drops its shell on the pump stroke instead.
    if (weapon.id !== "shotgun") this.sfx.casingDrop("brass");
    this.hud.shotFlash(aim.x, aim.y);

    const target = this.pickTarget(this.rayThrough(aim));
    if (target && "chicken" in target) this.damageChicken(target.chicken, SHOT_DAMAGE, "shot", aim);
    else if (target) this.findEgg(target.egg, aim);
    // Missing with single shots costs the streak; machine-gun misses are part of spraying.
    else if (weapon.fireMode === "semi") this.combo.break();
  }

  private fireFlak(aim: { x: number; y: number }): void {
    const ray = this.rayThrough(aim);
    const target = this.pickTarget(ray);
    const targetDistance = target ? this.distanceTo(ray, target) : FLAK_FUSE_DISTANCE;
    const distance = Math.min(targetDistance, this.groundDistance(ray, FLAK_FUSE_DISTANCE));
    const burst = ray.origin.add(ray.direction.scale(distance));
    const muzzle = this.viewmodel?.muzzlePosition() ?? this.camera.position.clone();
    this.effects.flakTracer(muzzle, burst, distance / FLAK_SHELL_SPEED, () => {
      this.effects.flakBurst(burst, FLAK_BURST_RADIUS);
      this.sfx.flakBurst(distance);
      if (target && "egg" in target) this.findEgg(target.egg, this.project(burst));
      const hits = this.blast(burst, FLAK_BURST_RADIUS, FLAK_DAMAGE);
      if (hits === 0 && !(target && "egg" in target)) this.combo.break();
    });
  }

  private fireRocket(aim: { x: number; y: number }): void {
    const ray = this.rayThrough(aim);
    const target = this.pickTarget(ray);
    // Aim the rocket from the muzzle at the point under the crosshair, so it converges with the view.
    const distance = Math.min(target ? this.distanceTo(ray, target) : 150, this.groundDistance(ray, 150));
    const aimPoint = ray.origin.add(ray.direction.scale(distance));
    const muzzle = this.viewmodel?.muzzlePosition() ?? this.camera.position.clone();
    this.effects.smokePuff(muzzle);
    this.effects.rocket(
      muzzle,
      aimPoint.subtract(muzzle),
      ROCKET_SPEED,
      // Without a chicken in the sights the rocket detonates at the aimed point, like a timed fuse.
      target ? ROCKET_RANGE : Vector3.Distance(muzzle, aimPoint),
      (position) => this.rocketStrikes(position),
      (position) => {
        this.effects.flakBurst(position, ROCKET_BLAST_RADIUS);
        this.sfx.flakBurst(Vector3.Distance(position, this.camera.position));
        this.shake = Math.max(this.shake, 0.6);
        if (target && "egg" in target) this.findEgg(target.egg, this.project(position));
        const hits = this.blast(position, ROCKET_BLAST_RADIUS, ROCKET_DAMAGE);
        if (hits === 0 && !(target && "egg" in target)) this.combo.break();
      },
    );
  }

  private rocketStrikes(position: Vector3): boolean {
    if (position.y <= terrainHeight(position.x, position.z) + 0.3) return true;
    const reach = ROCKET_PROXIMITY * ROCKET_PROXIMITY;
    return this.chickens.some((chicken) => chicken.state === "flying" && Vector3.DistanceSquared(chicken.position, position) < reach);
  }

  /** Damages every flying chicken within `radius`; returns how many were hit. */
  private blast(center: Vector3, radius: number, damage: number): number {
    let hits = 0;
    for (const chicken of [...this.chickens]) {
      const offset = chicken.position.subtract(center);
      if (chicken.state !== "flying" || offset.length() > radius) continue;
      hits++;
      this.damageChicken(chicken, damage, "blast", this.project(chicken.position), offset.normalize());
    }
    return hits;
  }

  private updateLaser(dt: number): void {
    if (!this.weapons.isBeaming) {
      this.effects.setBeam(null, Vector3.Zero(), dt);
      return;
    }
    const ray = this.rayThrough(this.pointer);
    const target = this.pickTarget(ray);
    const distance = Math.min(target ? this.distanceTo(ray, target) : LASER_RANGE, this.groundDistance(ray, LASER_RANGE));
    const end = ray.origin.add(ray.direction.scale(distance));
    this.effects.setBeam(this.viewmodel?.muzzlePosition() ?? this.camera.position, end, dt);
    if (target && "chicken" in target) {
      const result = this.damageChicken(target.chicken, LASER_DAMAGE_PER_SECOND * dt, "burn", this.pointer, undefined, false);
      if (result) {
        this.effects.smokePuff(target.chicken.position);
        this.sfx.sizzle();
      }
    } else if (target) {
      this.findEgg(target.egg, this.pointer);
    }
  }

  /** Calls the atomic bomb onto the ground point under the crosshair. */
  private throwBomb(): void {
    const ray = this.rayThrough(this.pointer);
    let distance = this.groundDistance(ray, NUKE_MAX_DISTANCE);
    if (distance >= NUKE_MAX_DISTANCE) distance = NUKE_MAX_DISTANCE * 0.8;
    const aimPoint = ray.origin.add(ray.direction.scale(distance));
    const target = new Vector3(aimPoint.x, terrainHeight(aimPoint.x, aimPoint.z), aimPoint.z);
    this.sfx.bombWhistle(NUKE_FALL_TIME_S);
    this.nuke?.drop(target, this.camera.position, {
      impact: (position) => {
        this.sfx.nukeBlast();
        this.hud.nukeFlash();
        this.shake = 3;
        this.rumble = 1.4;
        this.shockwaveIn = Vector3.Distance(position, this.camera.position) / SHOCKWAVE_SPEED;
      },
      devastate: (position) => {
        setDevastated(this.world, true);
        this.atmosphere.apply(this.atmosphere.current);
        this.blast(position, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY);
      },
    });
  }

  /**
   * Damages a chicken and books the outcome: points × combo, special-bird effects, sounds.
   * Returns true when the chicken died.
   */
  private damageChicken(
    chicken: Chicken,
    amount: number,
    kind: HitKind,
    at: { x: number; y: number } | null,
    push?: Vector3,
    feedbackOnDeflect = true,
  ): boolean {
    const result = chicken.damage(amount, kind, push);
    if (result.deflected && feedbackOnDeflect) {
      this.sfx.clang();
      if (at) this.hud.popup("Clang!", at.x, at.y, "info");
    }
    if (!result.killed) return false;

    if (kind !== "burn") spawnFeathers(this.scene, this.featherTexture, chicken.position);
    if (chicken.variant === "bomb") {
      this.explodeBombChicken(chicken, at);
      return true;
    }

    this.combo.hit();
    const gained = chicken.points * this.combo.multiplier;
    this.addScore(gained);
    if (at) {
      const suffix = this.combo.multiplier > 1 ? ` ×${this.combo.multiplier}` : "";
      this.hud.popup(`+${gained}${suffix}`, at.x, at.y, chicken.variant === "normal" ? "score" : "bonus");
    }
    if (kind === "shot") this.sfx.squawk();
    this.onSpecialKill(chicken.variant, at);
    return true;
  }

  private onSpecialKill(variant: ChickenVariant, at: { x: number; y: number } | null): void {
    if (variant === "golden") {
      this.timeLeft += GOLDEN_TIME_BONUS_S;
      this.sfx.chime();
      if (at) this.hud.popup(`+${GOLDEN_TIME_BONUS_S} s`, at.x, at.y - 40, "bonus");
    }
    if (variant === "clock") {
      this.timeLeft += CLOCK_TIME_BONUS_S;
      this.sfx.chime();
      if (at) this.hud.popup(`+${CLOCK_TIME_BONUS_S} s`, at.x, at.y - 40, "bonus");
    }
    if (variant === "boss") {
      this.hud.showBanner("The chicken king has fallen!");
      this.sfx.chime();
    }
  }

  /** Shooting the bomb chicken costs points, breaks the combo — and blows up its neighbours. */
  private explodeBombChicken(chicken: Chicken, at: { x: number; y: number } | null): void {
    this.combo.break();
    this.addScore(chicken.points);
    if (at) this.hud.popup(`${chicken.points}`, at.x, at.y, "penalty");
    this.effects.flakBurst(chicken.position.clone(), 7);
    this.sfx.flakBurst(Vector3.Distance(chicken.position, this.camera.position));
    this.blast(chicken.position.clone(), BOMB_CHICKEN_BLAST_RADIUS, FLAK_DAMAGE);
  }

  private findEgg(mesh: AbstractMesh, at: { x: number; y: number } | null): void {
    const egg: EasterEgg | undefined = this.eggs.trigger(mesh);
    if (!egg) return;
    this.combo.hit();
    const gained = egg.points * this.combo.multiplier;
    this.addScore(gained);
    this.hud.showBanner(`${egg.label}! +${gained}`);
    if (at) this.hud.popup(`+${gained}`, at.x, at.y, "bonus");
  }

  private addScore(points: number): void {
    this.score = Math.max(0, this.score + points);
    this.hud.setScore(this.score);
  }

  // ---------------------------------------------------------------------------------------------
  // Picking helpers
  // ---------------------------------------------------------------------------------------------

  private readonly isTarget = (mesh: AbstractMesh): boolean =>
    mesh.isPickable && mesh.isEnabled() && (this.chickenByHitbox.has(mesh) || this.eggs.isTarget(mesh));

  private pickTarget(ray: Ray): Target {
    const pick = this.scene.pickWithRay(ray, this.isTarget);
    const mesh = pick?.pickedMesh;
    if (!mesh) return null;
    const chicken = this.chickenByHitbox.get(mesh);
    return chicken ? { chicken } : { egg: mesh };
  }

  private distanceTo(ray: Ray, target: NonNullable<Target>): number {
    const position = "chicken" in target ? target.chicken.position : target.egg.getAbsolutePosition();
    return Vector3.Dot(position.subtract(ray.origin), ray.direction);
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

  // ---------------------------------------------------------------------------------------------
  // Frame update
  // ---------------------------------------------------------------------------------------------

  private update(dt: number): void {
    this.elapsed += dt;
    updateWorld(this.world, dt);
    this.updateCamera(dt);
    this.updateChickens(dt);
    this.effects.update(dt);
    this.nuke?.update(dt);
    this.atmosphere.update(this.camera, this.rayThrough(this.pointer));

    if (this.phase === "playing") {
      this.eggs.update(dt);
      this.weapons.update(dt);
      this.combo.update(dt);
      this.updateLaser(dt);
      this.updateThrow(dt);
      this.updateShockwave(dt);
      this.updateBoss();
      this.hud.setAmmo(this.weapons.ammoStatus());
      this.hud.setCombo(this.combo.multiplier, this.combo.remaining);
      this.timeLeft -= dt;
      this.hud.setTime(this.timeLeft);
      if (this.timeLeft <= 0) this.end();
      this.updateAmbience(dt);
    } else {
      this.effects.setBeam(null, Vector3.Zero(), dt);
    }

    this.viewmodel?.setVisible(this.phase === "playing");
    this.viewmodel?.update(dt, this.weapons, this.pointer, this.canvas);
  }

  private updateAmbience(dt: number): void {
    if (this.world.devastated && Math.random() < GEIGER_TICKS_PER_SECOND * dt) this.sfx.geigerTick();
    if (this.atmosphere.isNight && !this.world.devastated && Math.random() < CRICKET_CHIRPS_PER_SECOND * dt) this.sfx.cricket();
  }

  private updateBoss(): void {
    if (!this.bossSpawned && this.timeLeft <= BOSS_AT_TIME_LEFT_S) {
      this.bossSpawned = true;
      this.boss = this.spawnChicken("boss");
      this.hud.showBanner("The chicken king!");
      this.sfx.bossCall();
    }
    const boss = this.boss;
    if (!boss || boss.state !== "flying") {
      this.hud.setBossBar(null, 0);
      return;
    }
    const above = this.project(boss.position.add(new Vector3(0, 6, 0)));
    this.hud.setBossBar(above, boss.healthFraction);
  }

  /** The shock wave hits: the view jolts and the glass in front of the player cracks. */
  private updateShockwave(dt: number): void {
    if (this.shockwaveIn === null) return;
    this.shockwaveIn -= dt;
    if (this.shockwaveIn > 0) return;
    this.shockwaveIn = null;
    this.shake = Math.max(this.shake, 4.5);
    this.rumble = Math.max(this.rumble, 1.8);
    this.hud.crackScreen();
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

  // ---------------------------------------------------------------------------------------------
  // Chickens
  // ---------------------------------------------------------------------------------------------

  private rollVariant(): ChickenVariant {
    let roll = Math.random();
    for (const { variant, chance } of VARIANT_CHANCES) {
      roll -= chance;
      if (roll < 0) return variant;
    }
    return "normal";
  }

  private spawnChicken(variant: ChickenVariant): Chicken {
    const chicken = new Chicken(this.scene, this.palette, createRandomSpawn(variant), this.world.devastated);
    this.chickens.push(chicken);
    this.chickenByHitbox.set(chicken.hitbox, chicken);
    return chicken;
  }

  /** The chicken that bolts out of the barn when its door is shot open. */
  private spawnEscapee(position: Vector3): void {
    const spawn = createRandomSpawn("normal");
    spawn.direction = 1;
    spawn.depth = position.z;
    spawn.startX = position.x;
    spawn.altitude = position.y + 4;
    spawn.exitX = spawn.depth * 2.6 + 10;
    const chicken = new Chicken(this.scene, this.palette, spawn, this.world.devastated);
    this.chickens.push(chicken);
    this.chickenByHitbox.set(chicken.hitbox, chicken);
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
      this.spawnChicken(this.phase === "playing" ? this.rollVariant() : "normal");
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

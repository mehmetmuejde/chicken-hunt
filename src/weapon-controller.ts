import { PUMP_DELAY_S, SWITCH_TIME_S, WEAPON_ORDER, WEAPONS, type WeaponDefinition, type WeaponId } from "./weapons";

export interface WeaponEvents {
  shot(weapon: WeaponDefinition): void;
  thrown(weapon: WeaponDefinition): void;
  beamChanged(active: boolean): void;
  dryFire(): void;
  pump(): void;
  shellInserted(): void;
  reloadStarted(weapon: WeaponDefinition): void;
  reloadFinished(weapon: WeaponDefinition): void;
  switched(weapon: WeaponDefinition): void;
}

/** What the HUD shows for the current weapon. */
export type AmmoStatus =
  | { kind: "shells"; count: number; capacity: number; hint: string; urgent: boolean }
  | { kind: "counter"; count: number; capacity: number; hint: string; urgent: boolean }
  | { kind: "gauge"; label: string; fill: number; hint: string; urgent: boolean };

type Phase =
  | { kind: "ready" }
  | { kind: "cooldown"; remaining: number; pumped: boolean }
  | { kind: "reloading"; elapsed: number; chamberEmpty: boolean }
  | { kind: "switching"; elapsed: number; target: WeaponId; swapped: boolean };

const RELOAD_HINT = "Right click / Space: reload";

function initialAmmo(weapon: WeaponDefinition): number {
  switch (weapon.ammo.kind) {
    case "magazine":
      return weapon.ammo.capacity;
    case "perRound":
      return weapon.ammo.count;
    case "energy":
      return 1;
    case "unlimited":
      return Number.POSITIVE_INFINITY;
  }
}

/** Fire rate, ammo, reload and weapon switching. Pure game logic — visuals and sound react to events. */
export class WeaponController {
  private currentId: WeaponId = "shotgun";
  /** Weapon to return to after throwing the bomb. */
  private previousId: WeaponId = "shotgun";
  private readonly ammo = {} as Record<WeaponId, number>;
  private phase: Phase = { kind: "ready" };
  private triggerHeld = false;
  private dryFired = false;
  private beaming = false;
  private overheated = false;
  private sinceBeam = 0;

  constructor(private readonly events: WeaponEvents) {
    for (const id of WEAPON_ORDER) this.ammo[id] = initialAmmo(WEAPONS[id]);
  }

  get weapon(): WeaponDefinition {
    return WEAPONS[this.currentId];
  }

  get currentAmmo(): number {
    return this.ammo[this.currentId];
  }

  get isReloading(): boolean {
    return this.phase.kind === "reloading";
  }

  get isBeaming(): boolean {
    return this.beaming;
  }

  /** Laser charge 0..1. */
  get energy(): number {
    return this.ammo.laser;
  }

  /** 0..1 progress through the fire interval after a shot or throw; null when ready. */
  get actionProgress(): number | null {
    if (this.phase.kind !== "cooldown" || this.weapon.fireInterval === 0) return null;
    return Math.min(1, 1 - this.phase.remaining / this.weapon.fireInterval);
  }

  /** 0..1 progress of the running reload (belt) or of the shell being inserted (shotgun); null when not reloading. */
  get reloadProgress(): number | null {
    if (this.phase.kind !== "reloading" || this.weapon.ammo.kind !== "magazine") return null;
    const reload = this.weapon.ammo.reload;
    if (reload.kind === "belt") return Math.min(1, this.phase.elapsed / reload.duration);
    return Math.min(1, this.phase.elapsed / reload.perShell);
  }

  /** 0..1 progress of the pump stroke after a shotgun shot; null when no stroke is running. */
  get pumpProgress(): number | null {
    if (this.currentId !== "shotgun") return null;
    const stroke = this.weapon.fireInterval - PUMP_DELAY_S;
    if (this.phase.kind === "reloading" && this.phase.chamberEmpty && this.currentAmmo === this.capacity) {
      return Math.min(1, this.phase.elapsed / stroke);
    }
    if (this.phase.kind !== "cooldown") return null;
    const elapsed = this.weapon.fireInterval - this.phase.remaining - PUMP_DELAY_S;
    return elapsed < 0 ? null : Math.min(1, elapsed / stroke);
  }

  /** 0 = weapon raised, 1 = fully lowered out of view (during a switch). */
  get lowered(): number {
    if (this.phase.kind !== "switching") return 0;
    const half = SWITCH_TIME_S / 2;
    return this.phase.elapsed < half ? this.phase.elapsed / half : 1 - (this.phase.elapsed - half) / half;
  }

  ammoOf(id: WeaponId): number {
    return this.ammo[id];
  }

  ammoStatus(): AmmoStatus {
    const weapon = this.weapon;
    const count = this.currentAmmo;
    switch (weapon.ammo.kind) {
      case "magazine": {
        const hint = this.isReloading ? "Reloading…" : RELOAD_HINT;
        const urgent = count === 0 && !this.isReloading;
        const capacity = weapon.ammo.capacity;
        return weapon.ammo.reload.kind === "shells"
          ? { kind: "shells", count, capacity, hint, urgent }
          : { kind: "counter", count, capacity, hint, urgent };
      }
      case "unlimited": {
        const progress = this.actionProgress;
        return {
          kind: "gauge",
          label: progress === null ? "Ready" : "Loading",
          fill: progress ?? 1,
          hint: "Shells burst in the air",
          urgent: false,
        };
      }
      case "energy":
        return {
          kind: "gauge",
          label: this.overheated ? "Overheated" : `${Math.round(count * 100)} %`,
          fill: count,
          hint: "Hold to fire",
          urgent: this.overheated,
        };
      case "perRound":
        return {
          kind: "counter",
          count,
          capacity: weapon.ammo.count,
          hint: count > 0 ? "Click to throw — one per round" : "Used — back next round",
          urgent: false,
        };
    }
  }

  reset(): void {
    for (const id of WEAPON_ORDER) this.ammo[id] = initialAmmo(WEAPONS[id]);
    this.phase = { kind: "ready" };
    this.triggerHeld = false;
    this.overheated = false;
    this.setBeaming(false);
  }

  pressTrigger(): void {
    this.triggerHeld = true;
    this.dryFired = false;
    // A shot interrupts a shotgun reload as long as there is something in the tube.
    if (this.phase.kind === "reloading" && this.currentId === "shotgun" && this.currentAmmo > 0) {
      this.phase = { kind: "ready" };
    }
    if (this.weapon.fireMode !== "beam") this.tryFire();
  }

  releaseTrigger(): void {
    this.triggerHeld = false;
  }

  requestReload(): void {
    if (this.weapon.ammo.kind !== "magazine") return;
    if (this.phase.kind !== "ready" && this.phase.kind !== "cooldown") return;
    if (this.currentAmmo === this.weapon.ammo.capacity) return;
    this.phase = { kind: "reloading", elapsed: 0, chamberEmpty: this.currentAmmo === 0 };
    this.events.reloadStarted(this.weapon);
  }

  switchTo(id: WeaponId): void {
    if (id === this.currentId || this.phase.kind === "switching") return;
    this.setBeaming(false);
    this.phase = { kind: "switching", elapsed: 0, target: id, swapped: false };
  }

  cycle(step: 1 | -1): void {
    const index = WEAPON_ORDER.indexOf(this.currentId);
    const next = WEAPON_ORDER[(index + step + WEAPON_ORDER.length) % WEAPON_ORDER.length];
    if (next) this.switchTo(next);
  }

  update(dt: number): void {
    switch (this.phase.kind) {
      case "cooldown":
        this.updateCooldown(dt, this.phase);
        break;
      case "reloading":
        this.updateReload(dt, this.phase);
        break;
      case "switching":
        this.updateSwitch(dt, this.phase);
        break;
      case "ready":
        break;
    }
    this.updateEnergy(dt);
    if (this.phase.kind === "ready" && this.triggerHeld && this.weapon.fireMode === "auto") this.tryFire();
  }

  private get capacity(): number {
    return this.weapon.ammo.kind === "magazine" ? this.weapon.ammo.capacity : 0;
  }

  private tryFire(): void {
    if (this.phase.kind !== "ready") return;
    if (this.currentAmmo <= 0) {
      if (!this.dryFired) this.events.dryFire();
      this.dryFired = true;
      return;
    }
    if (this.weapon.ammo.kind === "magazine" || this.weapon.ammo.kind === "perRound") this.ammo[this.currentId]--;
    this.phase = { kind: "cooldown", remaining: this.weapon.fireInterval, pumped: false };
    if (this.weapon.fireMode === "throw") this.events.thrown(this.weapon);
    else this.events.shot(this.weapon);
  }

  private updateEnergy(dt: number): void {
    const laser = WEAPONS.laser;
    if (laser.ammo.kind !== "energy") return;
    const wantsBeam = this.currentId === "laser" && this.phase.kind === "ready" && this.triggerHeld && !this.overheated;
    this.setBeaming(wantsBeam);

    if (this.beaming) {
      this.sinceBeam = 0;
      this.ammo.laser = Math.max(0, this.ammo.laser - laser.ammo.drainPerSecond * dt);
      if (this.ammo.laser === 0) {
        this.overheated = true;
        this.setBeaming(false);
      }
      return;
    }
    this.sinceBeam += dt;
    if (this.sinceBeam >= laser.ammo.rechargeDelay) {
      this.ammo.laser = Math.min(1, this.ammo.laser + laser.ammo.rechargePerSecond * dt);
    }
    if (this.overheated && this.ammo.laser >= laser.ammo.restartAt) this.overheated = false;
  }

  private setBeaming(active: boolean): void {
    if (active === this.beaming) return;
    this.beaming = active;
    this.events.beamChanged(active);
  }

  private updateCooldown(dt: number, phase: Extract<Phase, { kind: "cooldown" }>): void {
    phase.remaining -= dt;
    if (this.currentId === "shotgun" && !phase.pumped && this.weapon.fireInterval - phase.remaining >= PUMP_DELAY_S) {
      phase.pumped = true;
      this.events.pump();
    }
    if (phase.remaining > 0) return;
    this.phase = { kind: "ready" };
    if (this.weapon.fireMode === "throw" && this.currentAmmo === 0) this.switchTo(this.previousId);
  }

  private updateReload(dt: number, phase: Extract<Phase, { kind: "reloading" }>): void {
    phase.elapsed += dt;
    if (this.weapon.ammo.kind !== "magazine") return;
    const reload = this.weapon.ammo.reload;

    if (reload.kind === "belt") {
      if (phase.elapsed >= reload.duration) {
        this.ammo[this.currentId] = this.capacity;
        this.finishReload();
      }
      return;
    }

    if (this.currentAmmo < this.capacity) {
      if (phase.elapsed >= reload.perShell) {
        phase.elapsed = 0;
        this.ammo[this.currentId]++;
        this.events.shellInserted();
        if (this.currentAmmo === this.capacity && phase.chamberEmpty) this.events.pump();
      }
      return;
    }

    // Tube is full: an empty chamber still needs one pump stroke before the reload is over.
    const strokeTime = this.weapon.fireInterval - PUMP_DELAY_S;
    if (!phase.chamberEmpty || phase.elapsed >= strokeTime) this.finishReload();
  }

  private finishReload(): void {
    this.phase = { kind: "ready" };
    this.events.reloadFinished(this.weapon);
  }

  private updateSwitch(dt: number, phase: Extract<Phase, { kind: "switching" }>): void {
    phase.elapsed += dt;
    if (!phase.swapped && phase.elapsed >= SWITCH_TIME_S / 2) {
      phase.swapped = true;
      if (WEAPONS[this.currentId].fireMode !== "throw") this.previousId = this.currentId;
      this.currentId = phase.target;
      this.events.switched(this.weapon);
    }
    if (phase.elapsed >= SWITCH_TIME_S) this.phase = { kind: "ready" };
  }
}

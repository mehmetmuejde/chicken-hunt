export type WeaponId = "shotgun" | "mg42" | "flak88" | "laser" | "nuke";

interface ShellReload {
  kind: "shells";
  /** Seconds per shell pushed into the tube magazine. */
  perShell: number;
}

interface BeltReload {
  kind: "belt";
  duration: number;
}

type Ammo =
  | { kind: "magazine"; capacity: number; reload: ShellReload | BeltReload }
  /** Every shot is loaded by the crew during the fire interval. */
  | { kind: "unlimited" }
  /** 0..1 charge that drains while firing and recharges after a pause. */
  | { kind: "energy"; drainPerSecond: number; rechargePerSecond: number; rechargeDelay: number; restartAt: number }
  | { kind: "perRound"; count: number };

/**
 * semi: one shot per click · auto: fires while held · beam: continuous ray while held ·
 * throw: thrown once, then the previous weapon comes back.
 */
export type FireMode = "semi" | "auto" | "beam" | "throw";

export interface WeaponDefinition {
  id: WeaponId;
  name: string;
  model: string;
  /** Prefix of the node names inside the model (e.g. "Shotgun_Pump"). */
  nodePrefix: string;
  fireMode: FireMode;
  /** Minimum seconds between two shots, including pump stroke, loading or throwing motion. */
  fireInterval: number;
  /** Random aim deviation in radians. */
  spread: number;
  ammo: Ammo;
}

export const WEAPONS: Record<WeaponId, WeaponDefinition> = {
  shotgun: {
    id: "shotgun",
    name: "Shotgun",
    model: "models/shotgun.glb",
    nodePrefix: "Shotgun",
    fireMode: "semi",
    fireInterval: 0.5,
    spread: 0,
    ammo: { kind: "magazine", capacity: 8, reload: { kind: "shells", perShell: 0.24 } },
  },
  mg42: {
    id: "mg42",
    name: "MG 42",
    model: "models/mg42.glb",
    nodePrefix: "MG42",
    fireMode: "auto",
    fireInterval: 0.075,
    spread: 0.012,
    ammo: { kind: "magazine", capacity: 50, reload: { kind: "belt", duration: 2.6 } },
  },
  flak88: {
    id: "flak88",
    name: "Flak 88",
    model: "models/flak88.glb",
    nodePrefix: "Flak88",
    fireMode: "semi",
    fireInterval: 1.9,
    spread: 0,
    ammo: { kind: "unlimited" },
  },
  laser: {
    id: "laser",
    name: "Laser",
    model: "models/laser.glb",
    nodePrefix: "Laser",
    fireMode: "beam",
    fireInterval: 0,
    spread: 0,
    ammo: { kind: "energy", drainPerSecond: 0.3, rechargePerSecond: 0.2, rechargeDelay: 0.6, restartAt: 0.35 },
  },
  nuke: {
    id: "nuke",
    name: "A-Bomb",
    model: "models/nuke.glb",
    nodePrefix: "Nuke",
    fireMode: "throw",
    fireInterval: 0.7,
    spread: 0,
    ammo: { kind: "perRound", count: 1 },
  },
};

export const WEAPON_ORDER: readonly WeaponId[] = ["shotgun", "mg42", "flak88", "laser", "nuke"];

/** Time to lower one weapon and raise the next. */
export const SWITCH_TIME_S = 0.5;
/** Part of the shotgun's fire interval spent on the recoil before the pump stroke starts. */
export const PUMP_DELAY_S = 0.12;

/** Flak shells burst at the first chicken on the line of fire or at this distance (metres). */
export const FLAK_FUSE_DISTANCE = 90;
export const FLAK_BURST_RADIUS = 11;
/** Slower than a real shell so the tracer stays visible. */
export const FLAK_SHELL_SPEED = 320;

export const LASER_RANGE = 400;
export const NUKE_FLIGHT_TIME_S = 1.6;
export const NUKE_MAX_DISTANCE = 220;

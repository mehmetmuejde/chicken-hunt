export type WeaponId =
  | "pistol"
  | "mp40"
  | "shotgun"
  | "m1garand"
  | "ak47"
  | "mg42"
  | "gatling"
  | "rpg7"
  | "flak88"
  | "laser"
  | "nuke";

interface ShellReload {
  kind: "shells";
  /** Seconds per shell pushed into the tube magazine. */
  perShell: number;
}

interface BeltReload {
  kind: "belt";
  duration: number;
}

/** Detachable magazine: the empty one drops out, a full one is inserted. */
interface SwapReload {
  kind: "swap";
  duration: number;
}

type Ammo =
  | { kind: "magazine"; capacity: number; reload: ShellReload | BeltReload | SwapReload }
  /** Every shot is loaded by the crew during the fire interval. */
  | { kind: "unlimited" }
  /** 0..1 charge that drains while firing and recharges after a pause. */
  | { kind: "energy"; drainPerSecond: number; rechargePerSecond: number; rechargeDelay: number; restartAt: number }
  | { kind: "perRound"; count: number };

/**
 * semi: one shot per click · auto: fires while held · beam: continuous ray while held ·
 * throw: used once per round (the radio calls in the atomic bomb), then the previous weapon comes back.
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
  pistol: {
    id: "pistol",
    name: "Pistol",
    model: "models/pistol.glb",
    nodePrefix: "Pistol",
    fireMode: "semi",
    fireInterval: 0.16,
    spread: 0.004,
    ammo: { kind: "magazine", capacity: 15, reload: { kind: "swap", duration: 1.3 } },
  },
  mp40: {
    id: "mp40",
    name: "MP40",
    model: "models/mp40.glb",
    nodePrefix: "MP40",
    fireMode: "auto",
    // About 550 rounds per minute — slow for a submachine gun, easy to control.
    fireInterval: 0.11,
    spread: 0.014,
    ammo: { kind: "magazine", capacity: 32, reload: { kind: "swap", duration: 2.1 } },
  },
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
  m1garand: {
    id: "m1garand",
    name: "M1 Garand",
    model: "models/m1garand.glb",
    nodePrefix: "M1Garand",
    fireMode: "semi",
    fireInterval: 0.22,
    spread: 0,
    // An eight-round en-bloc clip that is ejected with a "ping" after the last shot.
    ammo: { kind: "magazine", capacity: 8, reload: { kind: "swap", duration: 1.8 } },
  },
  ak47: {
    id: "ak47",
    name: "AK-47",
    model: "models/ak47.glb",
    nodePrefix: "AK47",
    fireMode: "auto",
    fireInterval: 0.1,
    spread: 0.016,
    ammo: { kind: "magazine", capacity: 30, reload: { kind: "swap", duration: 2.0 } },
  },
  mg42: {
    id: "mg42",
    name: "MG 42",
    model: "models/mg42.glb",
    nodePrefix: "MG42",
    fireMode: "auto",
    // The fastest gun in the game: 1500 rounds per minute, a bit above the real MG 42.
    fireInterval: 0.04,
    spread: 0.012,
    ammo: { kind: "magazine", capacity: 200, reload: { kind: "belt", duration: 2.6 } },
  },
  gatling: {
    id: "gatling",
    name: "Gatling",
    model: "models/gatling.glb",
    nodePrefix: "Gatling",
    fireMode: "auto",
    // Matches the cadence of the recorded hand-cranked gun (about 400 rounds per minute).
    fireInterval: 0.147,
    spread: 0.02,
    // One hopper load per round, no reload.
    ammo: { kind: "perRound", count: 500 },
  },
  rpg7: {
    id: "rpg7",
    name: "RPG-7",
    model: "models/rpg7.glb",
    nodePrefix: "RPG7",
    fireMode: "semi",
    fireInterval: 0.6,
    spread: 0,
    // As long as the recorded loading sequence: rocket in, then the hammer is cocked.
    ammo: { kind: "magazine", capacity: 1, reload: { kind: "swap", duration: 4 } },
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
    // The player holds a field radio and calls the bomb onto the point under the crosshair.
    model: "models/radio.glb",
    nodePrefix: "Radio",
    fireMode: "throw",
    fireInterval: 0.7,
    spread: 0,
    ammo: { kind: "perRound", count: 1 },
  },
};

export const WEAPON_ORDER: readonly WeaponId[] = [
  "pistol",
  "mp40",
  "shotgun",
  "m1garand",
  "ak47",
  "mg42",
  "gatling",
  "rpg7",
  "flak88",
  "laser",
  "nuke",
];

/** Keyboard slot of each weapon in WEAPON_ORDER: 1–9 and 0, then B for the bomb. */
export const WEAPON_KEYS: readonly string[] = [
  "Digit1",
  "Digit2",
  "Digit3",
  "Digit4",
  "Digit5",
  "Digit6",
  "Digit7",
  "Digit8",
  "Digit9",
  "Digit0",
  "KeyB",
];

/** "Digit3" → "3", "KeyB" → "B". */
export function keyLabel(code: string): string {
  return code.replace(/^(Digit|Key)/, "");
}

/** Time to lower one weapon and raise the next. */
export const SWITCH_TIME_S = 0.5;
/** Part of the shotgun's fire interval spent on the recoil before the pump stroke starts. */
export const PUMP_DELAY_S = 0.12;

/** Flak shells burst at the first chicken on the line of fire or at this distance (metres). */
export const FLAK_FUSE_DISTANCE = 90;
export const FLAK_BURST_RADIUS = 20;
/** Slower than a real shell so the tracer stays visible. */
export const FLAK_SHELL_SPEED = 320;

/** Rockets fly visibly, explode near a chicken, on the ground or at the end of their range. */
export const ROCKET_SPEED = 110;
export const ROCKET_RANGE = 320;
export const ROCKET_PROXIMITY = 2.5;
export const ROCKET_BLAST_RADIUS = 14;

export const LASER_RANGE = 400;
/** The bomb falls from the sky for this long — the length of the falling whistle. */
export const NUKE_FALL_TIME_S = 4.5;
export const NUKE_MAX_DISTANCE = 220;

import { TIMES_OF_DAY, type TimeOfDay, WEATHERS, type Weather } from "./atmosphere";
import { SCENERY_IDS, type SceneryId } from "./scenery";

const HIGHSCORE_KEY = "chicken-hunt.highscore";

export function loadHighscore(): number {
  try {
    const value = Number(localStorage.getItem(HIGHSCORE_KEY));
    return Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
}

export function saveHighscore(score: number): void {
  try {
    localStorage.setItem(HIGHSCORE_KEY, String(score));
  } catch {
    // Storage can be unavailable (private mode, blocked site data); the score just isn't kept.
  }
}

const BIRD_COUNT_KEY = "chicken-hunt.bird-count";
export const BIRD_COUNT = { min: 3, max: 30, default: 12 } as const;

export function loadBirdCount(): number {
  try {
    const value = Number(localStorage.getItem(BIRD_COUNT_KEY));
    if (Number.isInteger(value) && value >= BIRD_COUNT.min && value <= BIRD_COUNT.max) return value;
  } catch {
    // Fall through to the default.
  }
  return BIRD_COUNT.default;
}

export function saveBirdCount(count: number): void {
  try {
    localStorage.setItem(BIRD_COUNT_KEY, String(count));
  } catch {
    // Storage can be unavailable; the setting then only lasts for this visit.
  }
}

const ATMOSPHERE_KEY = "chicken-hunt.atmosphere";

/** Chosen time of day and weather; "random" picks a new one every round. */
export interface AtmosphereChoice {
  time: TimeOfDay | "random";
  weather: Weather | "random";
}

export function loadAtmosphereChoice(): AtmosphereChoice {
  const fallback: AtmosphereChoice = { time: "random", weather: "random" };
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(ATMOSPHERE_KEY) ?? "null");
    if (!stored || typeof stored !== "object") return fallback;
    const { time, weather } = stored as Record<string, unknown>;
    return {
      time: TIMES_OF_DAY.includes(time as TimeOfDay) ? (time as TimeOfDay) : "random",
      weather: WEATHERS.includes(weather as Weather) ? (weather as Weather) : "random",
    };
  } catch {
    return fallback;
  }
}

export function saveAtmosphereChoice(choice: AtmosphereChoice): void {
  try {
    localStorage.setItem(ATMOSPHERE_KEY, JSON.stringify(choice));
  } catch {
    // Storage can be unavailable; the choice then only lasts for this visit.
  }
}

const SCENERY_KEY = "chicken-hunt.scenery";

/** Chosen scenery; "random" picks a new one every round. */
export type SceneryChoice = SceneryId | "random";

export function loadSceneryChoice(): SceneryChoice {
  try {
    const stored = localStorage.getItem(SCENERY_KEY);
    return SCENERY_IDS.includes(stored as SceneryId) ? (stored as SceneryId) : "random";
  } catch {
    return "random";
  }
}

export function saveSceneryChoice(choice: SceneryChoice): void {
  try {
    localStorage.setItem(SCENERY_KEY, choice);
  } catch {
    // Storage can be unavailable; the choice then only lasts for this visit.
  }
}

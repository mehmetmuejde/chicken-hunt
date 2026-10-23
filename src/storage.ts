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

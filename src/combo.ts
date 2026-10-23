/** Seconds after a kill in which the next kill keeps the streak alive. */
export const COMBO_WINDOW_S = 2.5;
/** Kills per multiplier step. */
const COMBO_STEP = 3;
const COMBO_MAX = 5;

/** Kill streak: every third kill in a row raises the score multiplier, a miss or a pause resets it. */
export class Combo {
  private streak = 0;
  private timer = 0;

  get multiplier(): number {
    return Math.min(COMBO_MAX, 1 + Math.floor(this.streak / COMBO_STEP));
  }

  get count(): number {
    return this.streak;
  }

  /** 1 right after a kill, falling to 0 when the window runs out. */
  get remaining(): number {
    return this.streak > 0 ? this.timer / COMBO_WINDOW_S : 0;
  }

  hit(): void {
    this.streak++;
    this.timer = COMBO_WINDOW_S;
  }

  break(): void {
    this.streak = 0;
    this.timer = 0;
  }

  update(dt: number): void {
    if (this.streak === 0) return;
    this.timer -= dt;
    if (this.timer <= 0) this.break();
  }
}

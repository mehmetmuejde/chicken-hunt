export const GAME_DURATION_S = 90;

export const SPAWN_INTERVAL_S = { min: 0.4, max: 1.1 } as const;
export const CHICKEN_DEPTH = { min: 12, max: 170 } as const;
export const CHICKEN_SCALE = 1.7;
export const GRAVITY = -25;

export const CAMERA_HEIGHT = 3;
export const CAMERA_PITCH = -0.06;
export const CAMERA_FOV = 0.9;
export const CAMERA_YAW_LIMIT = 0.75;
export const CAMERA_PAN_SPEED = 1.6;
/** Fraction of the screen width at each side that pans the camera. */
export const PAN_EDGE = 0.12;

export function pointsForDepth(depth: number): number {
  if (depth < 40) return 5;
  if (depth < 90) return 10;
  return 25;
}

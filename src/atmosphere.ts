import {
  type Camera,
  Color3,
  Color4,
  type DynamicTexture,
  Mesh,
  MeshBuilder,
  ParticleSystem,
  type Ray,
  Scene,
  SpotLight,
  StandardMaterial,
  Vector3,
  VertexBuffer,
  VertexData,
} from "./babylon";
import { createRng } from "./random";
import type { World } from "./world";

export type TimeOfDay = "day" | "sunset" | "night";
export type Weather = "clear" | "rain" | "snow" | "fog";

export const TIMES_OF_DAY: readonly TimeOfDay[] = ["day", "sunset", "night"];
export const WEATHERS: readonly Weather[] = ["clear", "rain", "snow", "fog"];

export interface AtmosphereSettings {
  time: TimeOfDay;
  weather: Weather;
}

interface Preset {
  /** Sky gradient from horizon (0) to zenith (1). */
  sky: readonly { at: number; color: Color3 }[];
  fogDensity: number;
  hemi: { intensity: number; diffuse: Color3; ground: Color3 };
  sun: { direction: Vector3; intensity: number; diffuse: Color3 };
  cloud: { diffuse: Color3; emissive: Color3 };
}

const PRESETS: Record<TimeOfDay | "fallout", Preset> = {
  day: {
    sky: [
      { at: 0, color: new Color3(0.8, 0.88, 0.93) },
      { at: 1, color: new Color3(0.24, 0.5, 0.86) },
    ],
    fogDensity: 0.0025,
    hemi: { intensity: 0.75, diffuse: new Color3(1, 0.98, 0.94), ground: new Color3(0.35, 0.4, 0.3) },
    sun: { direction: new Vector3(-0.4, -1, 0.5), intensity: 0.9, diffuse: new Color3(1, 0.95, 0.85) },
    cloud: { diffuse: Color3.White(), emissive: new Color3(0.72, 0.74, 0.78) },
  },
  sunset: {
    sky: [
      { at: 0, color: new Color3(1, 0.62, 0.32) },
      { at: 0.25, color: new Color3(0.9, 0.42, 0.42) },
      { at: 0.6, color: new Color3(0.42, 0.25, 0.5) },
      { at: 1, color: new Color3(0.14, 0.13, 0.36) },
    ],
    fogDensity: 0.003,
    hemi: { intensity: 0.45, diffuse: new Color3(1, 0.75, 0.6), ground: new Color3(0.3, 0.2, 0.2) },
    sun: { direction: new Vector3(0.9, -0.22, -0.6), intensity: 0.85, diffuse: new Color3(1, 0.55, 0.3) },
    cloud: { diffuse: new Color3(1, 0.75, 0.65), emissive: new Color3(0.6, 0.32, 0.3) },
  },
  night: {
    sky: [
      { at: 0, color: new Color3(0.07, 0.09, 0.17) },
      { at: 1, color: new Color3(0.01, 0.01, 0.04) },
    ],
    fogDensity: 0.004,
    hemi: { intensity: 0.18, diffuse: new Color3(0.5, 0.6, 0.9), ground: new Color3(0.05, 0.05, 0.1) },
    sun: { direction: new Vector3(0.3, -0.8, 0.4), intensity: 0.22, diffuse: new Color3(0.6, 0.7, 1) },
    cloud: { diffuse: new Color3(0.08, 0.09, 0.12), emissive: new Color3(0.02, 0.02, 0.04) },
  },
  // After the atomic bomb: dark, burnt and with a sickly green glow on the horizon.
  fallout: {
    sky: [
      { at: 0, color: new Color3(0.16, 0.19, 0.08) },
      { at: 0.3, color: new Color3(0.07, 0.07, 0.05) },
      { at: 1, color: new Color3(0.02, 0.02, 0.03) },
    ],
    fogDensity: 0.006,
    hemi: { intensity: 0.35, diffuse: new Color3(1, 0.98, 0.94), ground: new Color3(0.2, 0.1, 0.05) },
    sun: { direction: new Vector3(-0.4, -1, 0.5), intensity: 0.35, diffuse: new Color3(0.9, 0.45, 0.25) },
    cloud: { diffuse: new Color3(0.12, 0.11, 0.1), emissive: new Color3(0.06, 0.07, 0.03) },
  },
};

/** How much bad weather greys out the sky and adds fog. */
const WEATHER_EFFECT: Record<Weather, { grey: number; fog: number; light: number }> = {
  clear: { grey: 0, fog: 0, light: 1 },
  rain: { grey: 0.6, fog: 0.002, light: 0.55 },
  snow: { grey: 0.55, fog: 0.003, light: 0.7 },
  fog: { grey: 0.7, fog: 0.011, light: 0.6 },
};

const CELESTIAL_DISTANCE = 600;
const STAR_COUNT = 900;

function gradient(stops: Preset["sky"], t: number): Color3 {
  for (let i = 1; i < stops.length; i++) {
    const from = stops[i - 1];
    const to = stops[i];
    if (from && to && t <= to.at) return Color3.Lerp(from.color, to.color, (t - from.at) / (to.at - from.at));
  }
  return stops[stops.length - 1]?.color ?? Color3.Black();
}

export function randomAtmosphere(): AtmosphereSettings {
  const pick = <T>(values: readonly T[]): T => values[Math.floor(Math.random() * values.length)] as T;
  // Clear weather is the most common so most rounds stay readable.
  return { time: pick(TIMES_OF_DAY), weather: Math.random() < 0.45 ? "clear" : pick(WEATHERS) };
}

/** Time of day and weather: sky, light, fog, celestial bodies, precipitation and the night-time torch. */
export class Atmosphere {
  private settings: AtmosphereSettings = { time: "day", weather: "clear" };
  private readonly torch: SpotLight;
  private readonly stars: Mesh;
  private readonly sunDisc: Mesh;
  private readonly moon: Mesh;
  private readonly rain: ParticleSystem;
  private readonly snow: ParticleSystem;

  constructor(
    private readonly scene: Scene,
    private readonly world: World,
    softTexture: DynamicTexture,
  ) {
    this.torch = new SpotLight("torch", Vector3.Zero(), Vector3.Forward(), 0.38, 6, scene);
    this.torch.diffuse = new Color3(1, 0.93, 0.75);
    this.torch.intensity = 2.6;
    this.torch.range = 260;

    this.stars = this.createStars(scene);
    this.sunDisc = this.createDisc(scene, "sunDisc", softTexture, 90, new Color3(1, 0.85, 0.55));
    this.moon = this.createDisc(scene, "moon", softTexture, 40, new Color3(0.85, 0.9, 1));
    this.rain = this.createRain(scene, softTexture);
    this.snow = this.createSnow(scene, softTexture);
  }

  get current(): AtmosphereSettings {
    return this.settings;
  }

  get isNight(): boolean {
    return this.settings.time === "night";
  }

  apply(settings: AtmosphereSettings): void {
    this.settings = settings;
    const devastated = this.world.devastated;
    const preset = devastated ? PRESETS.fallout : PRESETS[settings.time];
    const weather = WEATHER_EFFECT[settings.weather];
    const grey = (color: Color3): Color3 => {
      const luminance = color.r * 0.3 + color.g * 0.59 + color.b * 0.11;
      return Color3.Lerp(color, new Color3(luminance, luminance, luminance * 1.05), weather.grey);
    };

    const colors: number[] = [];
    for (const height of this.world.skyDome.heights) {
      const color = grey(gradient(preset.sky, Math.pow(height, 0.7)));
      colors.push(color.r, color.g, color.b, 1);
    }
    this.world.skyDome.mesh.setVerticesData(VertexBuffer.ColorKind, colors);

    const horizon = grey(gradient(preset.sky, 0));
    this.scene.clearColor = new Color4(horizon.r, horizon.g, horizon.b, 1);
    this.scene.fogMode = Scene.FOGMODE_EXP2;
    this.scene.fogColor = horizon;
    this.scene.fogDensity = preset.fogDensity + weather.fog;

    const hemi = this.world.sky;
    hemi.intensity = preset.hemi.intensity * (0.85 + 0.15 * weather.light);
    hemi.diffuse = preset.hemi.diffuse.clone();
    hemi.groundColor = preset.hemi.ground.clone();
    const sun = this.world.sun;
    sun.direction = preset.sun.direction.clone();
    sun.intensity = preset.sun.intensity * weather.light;
    sun.diffuse = preset.sun.diffuse.clone();

    this.world.cloudMaterial.diffuseColor = grey(preset.cloud.diffuse);
    this.world.cloudMaterial.emissiveColor = grey(preset.cloud.emissive).scale(weather.light);

    const terrain = this.world.terrain;
    const terrainColors = devastated ? terrain.devastated : settings.weather === "snow" ? terrain.snow : terrain.normal;
    terrain.mesh.setVerticesData(VertexBuffer.ColorKind, terrainColors, true);

    const clearSky = settings.weather === "clear";
    this.stars.setEnabled(settings.time === "night" && clearSky);
    this.moon.setEnabled(settings.time === "night" && settings.weather !== "fog" && !devastated);
    this.sunDisc.setEnabled(settings.time === "sunset" && clearSky && !devastated);
    this.placeCelestial(this.sunDisc, PRESETS.sunset.sun.direction);
    this.placeCelestial(this.moon, new Vector3(-0.5, -0.45, -0.75));

    this.setRunning(this.rain, settings.weather === "rain");
    this.setRunning(this.snow, settings.weather === "snow");
    // Black rain after the bomb.
    this.rain.color1 = devastated ? new Color4(0.1, 0.1, 0.08, 0.7) : new Color4(0.75, 0.82, 0.95, 0.65);
    this.rain.color2 = devastated ? new Color4(0.05, 0.06, 0.04, 0.7) : new Color4(0.65, 0.72, 0.88, 0.5);
    this.torch.setEnabled(settings.time === "night");
  }

  /** Keeps the precipitation around the camera and points the torch at the crosshair. */
  update(camera: Camera, aim: Ray): void {
    const forward = camera.getDirection(Vector3.Forward());
    const ahead = camera.position.add(forward.scale(35));
    (this.rain.emitter as Vector3).set(ahead.x, 30, ahead.z);
    (this.snow.emitter as Vector3).set(ahead.x, 30, ahead.z);
    if (this.torch.isEnabled()) {
      this.torch.position.copyFrom(camera.position).addInPlaceFromFloats(0.3, -0.3, 0);
      this.torch.direction.copyFrom(aim.direction);
    }
  }

  private setRunning(system: ParticleSystem, running: boolean): void {
    if (running && !system.isStarted()) system.start();
    if (!running && system.isStarted()) {
      system.stop();
      system.reset();
    }
  }

  private placeCelestial(mesh: Mesh, lightDirection: Vector3): void {
    mesh.position.copyFrom(lightDirection.normalizeToNew().scale(-CELESTIAL_DISTANCE));
  }

  private createDisc(scene: Scene, name: string, texture: DynamicTexture, size: number, color: Color3): Mesh {
    const disc = MeshBuilder.CreatePlane(name, { size }, scene);
    const material = new StandardMaterial(`${name}Material`, scene);
    material.diffuseTexture = texture;
    material.useAlphaFromDiffuseTexture = true;
    material.emissiveColor = color;
    material.disableLighting = true;
    disc.material = material;
    disc.billboardMode = Mesh.BILLBOARDMODE_ALL;
    disc.infiniteDistance = true;
    disc.applyFog = false;
    disc.isPickable = false;
    return disc;
  }

  private createStars(scene: Scene): Mesh {
    const rng = createRng(42);
    const positions: number[] = [];
    for (let i = 0; i < STAR_COUNT; i++) {
      // Upper hemisphere only, a little above the horizon.
      const azimuth = rng() * Math.PI * 2;
      const elevation = Math.asin(0.08 + rng() * 0.92);
      positions.push(
        Math.cos(elevation) * Math.sin(azimuth) * CELESTIAL_DISTANCE,
        Math.sin(elevation) * CELESTIAL_DISTANCE,
        Math.cos(elevation) * Math.cos(azimuth) * CELESTIAL_DISTANCE,
      );
    }
    const stars = new Mesh("stars", scene);
    const data = new VertexData();
    data.positions = positions;
    data.indices = Array.from({ length: STAR_COUNT }, (_, index) => index);
    data.applyToMesh(stars);
    const material = new StandardMaterial("starsMaterial", scene);
    material.pointsCloud = true;
    material.pointSize = 2;
    material.emissiveColor = new Color3(0.9, 0.92, 1);
    material.disableLighting = true;
    stars.material = material;
    stars.infiniteDistance = true;
    stars.applyFog = false;
    stars.isPickable = false;
    return stars;
  }

  private createRain(scene: Scene, texture: DynamicTexture): ParticleSystem {
    const rain = new ParticleSystem("rain", 4000, scene);
    rain.particleTexture = texture;
    rain.emitter = new Vector3(0, 30, 35);
    rain.minEmitBox = new Vector3(-70, 0, -35);
    rain.maxEmitBox = new Vector3(70, 10, 45);
    rain.direction1 = new Vector3(-0.15, -1, 0);
    rain.direction2 = new Vector3(-0.05, -1, 0.05);
    rain.minEmitPower = 38;
    rain.maxEmitPower = 48;
    rain.minLifeTime = 0.9;
    rain.maxLifeTime = 1.2;
    rain.emitRate = 3200;
    rain.minSize = 1;
    rain.maxSize = 1.3;
    rain.minScaleX = 0.05;
    rain.maxScaleX = 0.08;
    rain.minScaleY = 0.5;
    rain.maxScaleY = 0.8;
    rain.billboardMode = ParticleSystem.BILLBOARDMODE_STRETCHED;
    rain.colorDead = new Color4(0.5, 0.6, 0.8, 0);
    rain.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    return rain;
  }

  private createSnow(scene: Scene, texture: DynamicTexture): ParticleSystem {
    const snow = new ParticleSystem("snow", 3000, scene);
    snow.particleTexture = texture;
    snow.emitter = new Vector3(0, 30, 35);
    snow.minEmitBox = new Vector3(-80, 0, -35);
    snow.maxEmitBox = new Vector3(80, 10, 60);
    snow.direction1 = new Vector3(-0.4, -1, -0.2);
    snow.direction2 = new Vector3(0.4, -1, 0.2);
    snow.minEmitPower = 2;
    snow.maxEmitPower = 4;
    snow.minLifeTime = 8;
    snow.maxLifeTime = 12;
    snow.emitRate = 280;
    snow.minSize = 0.15;
    snow.maxSize = 0.4;
    snow.color1 = new Color4(1, 1, 1, 0.95);
    snow.color2 = new Color4(0.9, 0.93, 1, 0.85);
    snow.colorDead = new Color4(1, 1, 1, 0);
    snow.minAngularSpeed = -1;
    snow.maxAngularSpeed = 1;
    snow.preWarmCycles = 150;
    snow.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    return snow;
  }
}
